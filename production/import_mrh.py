"""MRH : import Excel des maisons d'un devis (demande du 2026-11-10 : « permet l'importation d'un fichier excel lors de
l'incorporation » ; les 45 maisons d'une police se saisissaient une à une).

GET  /api/mrh/import/modele/    modèle vierge : une ligne par maison, liste déroulante des usages, feuille « Usages »
POST /api/mrh/import/analyse/   fichier lu et contrôlé, rien n'est enregistré : chaque maison passe par le moteur MRH de
                                l'écran (valeurs requises par l'usage, garanties de la maison)

Les maisons reconnues s'ajoutent à l'écran MRH (devis neuf, « Modifier » ou incorporation) et s'enregistrent avec lui. La
prime nette de chaque maison et sa taxe, quand le fichier les donne, sont reprises telles quelles : il n'y a pas de barème
MRH, les primes se saisissent à la main. Une seule ligne en erreur et l'écran n'ajoute rien : les totaux restent ceux du
fichier.
"""

import io
import logging
import re
import unicodedata
from decimal import Decimal, InvalidOperation

import openpyxl
from django.http import HttpResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from configuration_api.models import Option, ParametresCalcul, UsageHabitation

from .renouvellement import AUTHENTIFICATION
from .serializers import MaisonCalculeeSerializer
from .services.mrh_calcul_service import MRHCalculService

logger = logging.getLogger(__name__)

TAILLE_FICHIER_MAX = 5 * 1024 * 1024
MAISONS_MAX = 500
LIGNES_MODELE = 500

# (clé, intitulé du modèle, reconnaissance de l'intitulé normalisé d'un fichier)
COLONNES = [
    ("usage", "Usage de l'habitation", lambda c: "usage" in c or c == "occupation"),
    ("adresse", "Adresse de la maison", lambda c: "adresse" in c or "situation" in c or "localisation" in c),
    ("valeur_batiment", "Valeur du bâtiment", lambda c: "batiment" in c or "immeuble" in c),
    ("valeur_contenu", "Valeur du contenu", lambda c: "contenu" in c or "mobilier" in c),
    ("loyer_mensuel", "Loyer mensuel", lambda c: "loyer" in c),
    ("capital_rvt", "Capital RVT", lambda c: "rvt" in c or "recours" in c),
    ("prime_nette", "Prime nette", lambda c: "prime" in c and "ttc" not in c and "brute" not in c or c == "pn"),
    ("taxe", "Taxe", lambda c: c.startswith("taxe")),
    ("garanties", "Garanties facultatives", lambda c: "garantie" in c),
    ("options", "Options", lambda c: "option" in c),
]
CAPITAUX = [
    ("valeur_batiment", "valeur du bâtiment", "param_valeur_batiment_requis"),
    ("valeur_contenu", "valeur du contenu", "param_valeur_contenu_requis"),
    ("loyer_mensuel", "loyer mensuel", "param_loyer_requis"),
    ("capital_rvt", "capital RVT", "param_capital_rvt_requis"),
]


class ErreurImportMrh(Exception):
    """Fichier illisible ou sans liste de maisons : message affiché tel quel."""


def _cle(texte):
    """Texte normalisé pour comparer intitulés et libellés : sans accents ni ponctuation, en minuscules."""
    texte = unicodedata.normalize("NFKD", str(texte or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", texte.lower())


def _montant(valeur, libelle):
    """Montant en francs : nombre Excel ou texte (« 25 000 000 », « 25.000.000 F »). None pour une cellule vide."""
    if valeur is None or (isinstance(valeur, str) and not valeur.strip()):
        return None
    if isinstance(valeur, bool):
        raise ValueError(f"{libelle} : montant illisible.")
    if isinstance(valeur, (int, float, Decimal)):
        montant = Decimal(str(valeur))
    else:
        texte = re.sub(r"(?i)\s| | |f\s*cfa|cfa|fcfa|f$", "", str(valeur))
        if re.fullmatch(r"\d{1,3}([.,]\d{3})+", texte):
            texte = re.sub(r"[.,]", "", texte)
        try:
            montant = Decimal(texte.replace(",", "."))
        except InvalidOperation:
            raise ValueError(f"{libelle} : montant illisible ({valeur}).")
    if montant < 0:
        raise ValueError(f"{libelle} : le montant ne peut pas être négatif.")
    return montant.quantize(Decimal("1"))


def _liste(valeur):
    return [x.strip() for x in re.split(r"[;,/\n]+", str(valeur or "")) if x.strip()]


def _referentiel():
    """Usages actifs avec leur offre : reconnus par code ou par libellé, valeurs requises, options et garanties facultatives."""
    usages = {}
    for usage in UsageHabitation.objects.filter(actif=True).exclude(offre_id=None).order_by("libelle"):
        try:
            parametres = usage.parametres
        except ParametresCalcul.DoesNotExist:
            parametres = None
        options = Option.objects.filter(usages_applicables__usage=usage, usages_applicables__actif=True, actif=True).distinct()
        garanties = usage.sous_garanties_liees.filter(obligatoire=False, actif=True).select_related("sous_garantie")
        usages[usage.code] = {
            "usage": usage,
            "requis": [(cle, libelle) for cle, libelle, champ in CAPITAUX if parametres is not None and getattr(parametres, champ, False)],
            "options": {**{_cle(o.libelle): o.code for o in options}, **{_cle(o.code): o.code for o in options}},
            "garanties": {**{_cle(g.sous_garantie.libelle): g.sous_garantie.code for g in garanties},
                          **{_cle(g.sous_garantie.code): g.sous_garantie.code for g in garanties}},
            "libelles_options": [o.libelle for o in options],
            "libelles_garanties": [g.sous_garantie.libelle for g in garanties],
        }
    reconnaissance = {}
    for code, u in usages.items():
        reconnaissance[_cle(code)] = code
        reconnaissance[_cle(u["usage"].libelle)] = code
    return usages, reconnaissance


def _feuille_et_entete(classeur):
    """Première feuille portant une ligne d'intitulés reconnue (usage et au moins deux autres colonnes)."""
    for feuille in classeur.worksheets:
        for numero, ligne in enumerate(feuille.iter_rows(min_row=1, max_row=25, values_only=True), start=1):
            colonnes = {}
            for indice, valeur in enumerate(ligne):
                c = _cle(valeur)
                if not c:
                    continue
                for cle, _intitule, reconnu in COLONNES:
                    if cle not in colonnes and reconnu(c):
                        colonnes[cle] = indice
                        break
            if "usage" in colonnes and len(colonnes) >= 3:
                return feuille, numero, colonnes
    raise ErreurImportMrh(
        "Aucune liste de maisons reconnue : il faut une ligne d'intitulés avec au moins l'usage de l'habitation et une valeur "
        "(bâtiment, contenu, loyer ou capital RVT). Partez du modèle vierge."
    )


def analyser(contenu):
    """Maisons du fichier, contrôlées et calculées par le moteur MRH, ou erreurs ligne par ligne. N'écrit rien."""
    from .views import _message_erreur_mrh

    try:
        classeur = openpyxl.load_workbook(io.BytesIO(contenu), data_only=True, read_only=True)
    except Exception:
        raise ErreurImportMrh("Fichier illisible : enregistrez-le au format Excel (.xlsx) puis recommencez.")
    feuille, ligne_entete, colonnes = _feuille_et_entete(classeur)
    usages, reconnaissance = _referentiel()
    service = MRHCalculService()
    maisons, erreurs = [], []

    def cellule(ligne, cle):
        indice = colonnes.get(cle)
        return ligne[indice] if indice is not None and indice < len(ligne) else None

    for numero, ligne in enumerate(feuille.iter_rows(min_row=ligne_entete + 1, values_only=True), start=ligne_entete + 1):
        if not any(v not in (None, "") and str(v).strip() for v in ligne):
            continue
        texte_usage = str(cellule(ligne, "usage") or "").strip()
        premiere = next((v for v in ligne if v not in (None, "") and str(v).strip()), "")
        if _cle(texte_usage).startswith("total") or _cle(premiere).startswith("total"):
            break
        if len(maisons) + len(erreurs) >= MAISONS_MAX:
            raise ErreurImportMrh(f"Plus de {MAISONS_MAX} maisons dans le fichier : découpez-le en plusieurs devis.")
        try:
            if not texte_usage:
                raise ValueError("usage de l'habitation manquant.")
            code = reconnaissance.get(_cle(texte_usage))
            if not code:
                raise ValueError(f"usage « {texte_usage} » inconnu : choisissez-le dans la liste du modèle (feuille Usages).")
            reference = usages[code]
            valeurs = {cle: _montant(cellule(ligne, cle), libelle.capitalize()) for cle, libelle, _champ in CAPITAUX}
            if not any(valeurs.values()):
                raise ValueError("aucune valeur assurée : saisissez au moins le bâtiment, le contenu, le loyer ou le capital RVT.")
            manquants = [libelle for cle, libelle in reference["requis"] if not valeurs.get(cle)]
            if manquants:
                raise ValueError(f"{', '.join(manquants)} à renseigner pour l'usage « {reference['usage'].libelle} ».")
            options, garanties = [], []
            for nom in _liste(cellule(ligne, "options")):
                if _cle(nom) not in reference["options"]:
                    raise ValueError(f"option « {nom} » inconnue pour cet usage (possibles : {', '.join(reference['libelles_options']) or 'aucune'}).")
                options.append(reference["options"][_cle(nom)])
            for nom in _liste(cellule(ligne, "garanties")):
                if _cle(nom) not in reference["garanties"]:
                    raise ValueError(f"garantie facultative « {nom} » inconnue pour cet usage "
                                     f"(possibles : {', '.join(reference['libelles_garanties']) or 'aucune'}).")
                garanties.append(reference["garanties"][_cle(nom)])
            prime_nette = _montant(cellule(ligne, "prime_nette"), "Prime nette")
            taxe = _montant(cellule(ligne, "taxe"), "Taxe")
            adresse = re.sub(r"\s+", " ", str(cellule(ligne, "adresse") or "")).strip()
            if len(adresse) > 150:
                raise ValueError("adresse de plus de 150 caractères.")
            try:
                calcul = service.calculer_maison(
                    code_usage=code, valeur_batiment=valeurs["valeur_batiment"], valeur_contenu=valeurs["valeur_contenu"],
                    loyer_mensuel=valeurs["loyer_mensuel"], capital_rvt=valeurs["capital_rvt"],
                    options=options, sous_garanties_optionnelles=garanties, adresse=adresse,
                )
            except Exception as erreur:  # message du moteur, comme à la saisie d'une maison
                raise ValueError(_message_erreur_mrh(erreur))
            maisons.append({
                "Ligne": numero, "code_usage": code, "usage_libelle": reference["usage"].libelle, "offre": reference["usage"].offre_id,
                "adresse": adresse, **{cle: float(valeurs[cle] or 0) for cle, _l, _c in CAPITAUX},
                "options": options, "sous_garanties_optionnelles": garanties,
                "prime_nette_saisie": float(prime_nette) if prime_nette is not None else None,
                "taxe_saisie": float(taxe) if taxe is not None else None,
                "calcul": MaisonCalculeeSerializer(calcul).data,
            })
        except ValueError as erreur:
            erreurs.append({"Ligne": numero, "Message": str(erreur)})

    if not maisons and not erreurs:
        raise ErreurImportMrh("Aucune maison sous la ligne d'intitulés du fichier.")
    primes = [m["prime_nette_saisie"] for m in maisons]
    taxes = [m["taxe_saisie"] for m in maisons]
    return {
        "Feuille": feuille.title, "LigneEntete": ligne_entete,
        "Colonnes": [intitule for cle, intitule, _r in COLONNES if cle in colonnes],
        "Maisons": maisons, "Erreurs": erreurs,
        "Totaux": {
            "Maisons": len(maisons),
            "PrimeNette": sum(p for p in primes if p is not None), "PrimesManquantes": sum(1 for p in primes if p is None),
            "Taxe": sum(taxes) if taxes and all(t is not None for t in taxes) else None,
        },
    }


def modele_classeur():
    """Modèle vierge : feuille « Maisons » (liste déroulante des usages) et feuille « Usages » (valeurs à renseigner,
    garanties facultatives et options possibles de chaque usage)."""
    usages, _r = _referentiel()
    classeur = Workbook()
    feuille = classeur.worksheets[0]
    feuille.title = "Maisons"
    intitules = ["N°"] + [intitule for _cle_colonne, intitule, _r in COLONNES]
    feuille["A1"] = "LISTE DES MAISONS - MULTIRISQUE HABITATION"
    feuille["A1"].font = Font(bold=True, size=13)
    feuille.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(intitules))
    feuille["A2"] = ("Une ligne par maison. Usage : à choisir dans la liste (détail dans la feuille Usages). Montants en francs CFA. "
                     "Prime nette et taxe : facultatives, sinon à saisir à l'écran. Plusieurs garanties ou options : séparées par « ; ».")
    feuille["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    feuille.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(intitules))
    feuille.row_dimensions[2].height = 32
    remplissage = PatternFill("solid", fgColor="DDEBF7")
    largeurs = [6, 34, 40, 18, 18, 16, 16, 16, 14, 34, 30]
    for colonne, intitule in enumerate(intitules, 1):
        cellule = feuille.cell(3, colonne, intitule)
        cellule.font = Font(bold=True)
        cellule.fill = remplissage
        cellule.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        feuille.column_dimensions[cellule.column_letter].width = largeurs[colonne - 1]
    for ligne in range(4, 4 + LIGNES_MODELE):
        for colonne in range(4, 10):
            feuille.cell(ligne, colonne).number_format = "#,##0"
    feuille.freeze_panes = "A4"

    reference = classeur.create_sheet("Usages")
    for colonne, intitule in enumerate(["Usage de l'habitation", "Code", "Valeurs à renseigner", "Garanties facultatives possibles",
                                        "Options possibles"], 1):
        cellule = reference.cell(1, colonne, intitule)
        cellule.font = Font(bold=True)
        cellule.fill = remplissage
    for ligne, u in enumerate(usages.values(), start=2):
        reference.cell(ligne, 1, u["usage"].libelle)
        reference.cell(ligne, 2, u["usage"].code)
        reference.cell(ligne, 3, ", ".join(libelle for _c, libelle in u["requis"]) or "au moins une valeur")
        reference.cell(ligne, 4, " ; ".join(u["libelles_garanties"]))
        reference.cell(ligne, 5, " ; ".join(u["libelles_options"]))
    for lettre, largeur in zip("ABCDE", (36, 34, 34, 60, 60)):
        reference.column_dimensions[lettre].width = largeur
    if usages:
        liste = DataValidation(type="list", formula1=f"=Usages!$A$2:$A${len(usages) + 1}", allow_blank=True,
                               errorTitle="Usage inconnu", error="Choisissez l'usage dans la liste.")
        feuille.add_data_validation(liste)
        liste.add(f"B4:B{3 + LIGNES_MODELE}")
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


# ------------------------------------------------------------------ vues
@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def analyse_import(request):
    fichier = request.FILES.get("fichier_excel") or request.FILES.get("fichier")
    if not fichier:
        return Response({"error": "Joignez le fichier Excel des maisons."}, status=status.HTTP_400_BAD_REQUEST)
    if fichier.size > TAILLE_FICHIER_MAX:
        return Response({"error": "Fichier trop volumineux (5 Mo au plus)."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        return Response(analyser(fichier.read()))
    except ErreurImportMrh as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def modele(request):
    reponse = HttpResponse(modele_classeur(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    reponse["Content-Disposition"] = 'attachment; filename="modele_maisons_mrh.xlsx"'
    return reponse
