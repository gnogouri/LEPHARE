"""
Paramétrage LE PHARE : réglages qui étaient écrits dans le code et se modifient dans l'admin.

- Règles de gestion et réglages des documents (lephare_parametre) : clé / valeur typée, lue par
  le serveur avec valeur_parametre() et par l'écran via GET /api/parametrage/.
- Identité du cabinet (stdparametresite, table URANUS, une ligne).
- Compagnies (stdcompagnie, table URANUS) et ce que les documents imprimés en reprennent
  (lephare_compagnie_document : logo, pied de page des CP, visa, attestation voyage).
- Produits (stdproduit, table URANUS) et leur place dans LE PHARE (lephare_produit_parametre :
  onglet du registre des devis, formulaire de saisie, saisie ouverte ou non).

Lecture pour tout utilisateur connecté, modification réservée aux administrateurs ; chaque
modification est inscrite au journal d'audit. Une valeur absente ou illisible laisse s'appliquer
la valeur d'origine prévue par l'appelant.
"""

import base64
import binascii
import json
import re
import time
from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import connection, transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from autorisations.journal import completer_audit

from .models import CompagnieDocument, ParametreGeneral, ParametreSite, Produit, ProduitParametre
from .views_grilles_voyage import AUTHENTIFICATION, EstAdministrateur


def regles_garanties_auto():
    from .parametrage_auto import regles_garanties_json

    return regles_garanties_json()


def interactions_garanties_auto():
    from .parametrage_auto import interactions_garanties_json

    return interactions_garanties_json()


def formules_pour_impression():
    """Formules MINENE lues par les imprimés (import différé : parametrage_sante importe ce module)."""
    from .parametrage_sante import formules_pour_impression as lire

    return lire()

# Image en data URL acceptée pour un logo : 600 Ko décodés au plus (l'écran la réduit avant envoi)
TAILLE_IMAGE_MAX = 600 * 1024
MOTIF_IMAGE = re.compile(r"^data:image/(png|jpeg|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$")
CHAMPS_ATTESTATION_TEXTE = ["Convention", "PaysResidence", "Signataire", "Telephone", "Email", "Whatsapp"]
# Adresses des QR codes de l'attestation : portail d'assistance, vérification du certificat ({certificat})
CHAMPS_ATTESTATION_URL = ["PortailAssistance", "VerificationVisa"]


class ErreurParametrage(Exception):
    """Saisie refusée : message affiché tel quel."""


# ------------------------------------------------------------------ lecture côté serveur
def _convertir(type_, valeur):
    """Valeur texte de la base -> valeur Python ; ValueError si illisible."""
    texte = (valeur or "").strip()
    if type_ in ("entier",):
        return int(texte)
    if type_ in ("decimal", "montant", "pourcentage"):
        try:
            return Decimal(texte.replace(",", "."))
        except InvalidOperation as erreur:
            raise ValueError(texte) from erreur
    if type_ == "date":
        return date.fromisoformat(texte)
    if type_ == "booleen":
        return texte.lower() in ("1", "true", "oui", "vrai")
    return valeur or ""


# Valeurs lues gardées quelques secondes : un paramètre peut être lu ligne à ligne (états,
# reversements) sans une requête par ligne ; vidé à chaque modification dans ce processus.
DUREE_CACHE = 10
_cache = {}


def valeur_parametre(cle, defaut=None):
    """Valeur typée d'un paramètre, ou `defaut` s'il manque, est vide ou illisible."""
    maintenant = time.monotonic()
    if cle not in _cache or maintenant - _cache[cle][0] > DUREE_CACHE:
        parametre = ParametreGeneral.objects.filter(Cle=cle).first()
        _cache[cle] = (maintenant, parametre and (parametre.Type, parametre.Valeur))
    lu = _cache[cle][1]
    if not lu or (lu[1] or "").strip() == "":
        return defaut
    try:
        return _convertir(*lu)
    except (ValueError, TypeError):
        return defaut


# ------------------------------------------------------------------ outils
def _auteur(request):
    return getattr(request.user, "email", "") or str(request.user)


def _journal(request, description, details):
    """Précise la ligne du journal d'audit centralisé écrite pour cette requête (valeurs avant / après)."""
    details = details or {}
    completer_audit(
        request, module="parametrage", action="parametrage.update", description=description,
        avant=details.get("avant"), apres=details.get("apres", {k: v for k, v in details.items() if k != "avant"}),
    )


def _texte(valeur, longueur, champ, obligatoire=False):
    texte = "" if valeur is None else str(valeur).strip()
    if obligatoire and not texte:
        raise ErreurParametrage(f"{champ} : valeur obligatoire.")
    if len(texte) > longueur:
        raise ErreurParametrage(f"{champ} : {longueur} caractères au plus.")
    # Textes repris tels quels par des gabarits d'impression HTML : pas de balise possible
    if "<" in texte or ">" in texte:
        raise ErreurParametrage(f"{champ} : les caractères < et > ne sont pas autorisés.")
    return texte


def _image(valeur, champ):
    """Data URL d'image vérifiée (format, base64, taille) ; chaîne vide pour retirer l'image."""
    texte = (valeur or "").strip()
    if not texte:
        return ""
    correspondance = MOTIF_IMAGE.match(texte)
    if not correspondance:
        raise ErreurParametrage(f"{champ} : image PNG, JPEG, GIF, WEBP ou SVG attendue.")
    try:
        contenu = base64.b64decode(correspondance.group(2), validate=False)
    except (binascii.Error, ValueError) as erreur:
        raise ErreurParametrage(f"{champ} : image illisible.") from erreur
    if len(contenu) > TAILLE_IMAGE_MAX:
        raise ErreurParametrage(f"{champ} : image trop lourde ({len(contenu) // 1024} Ko, {TAILLE_IMAGE_MAX // 1024} Ko au plus).")
    if correspondance.group(1) == "svg+xml" and re.search(rb"<script|on\w+\s*=|javascript:", contenu, re.I):
        raise ErreurParametrage(f"{champ} : image SVG refusée (contenu actif).")
    return texte


def _nombre_lisible(nombre):
    texte = f"{nombre:f}"
    return texte.rstrip("0").rstrip(".") if "." in texte else texte


def _valider_parametre(parametre, valeur):
    """Valeur saisie -> texte enregistré, contrôlé selon le type et les bornes du paramètre."""
    if parametre.Type == "image":
        return _image(valeur, parametre.Libelle)
    texte = "" if valeur is None else str(valeur).strip()
    if parametre.Type == "booleen":
        return "true" if texte.lower() in ("1", "true", "oui", "vrai") else "false"
    if texte == "":
        raise ErreurParametrage(f"{parametre.Libelle} : valeur obligatoire (« Rétablir » remet la valeur d'origine).")
    try:
        typee = _convertir(parametre.Type, texte)
    except (ValueError, TypeError) as erreur:
        attendu = {"entier": "nombre entier attendu", "date": "date attendue (jj/mm/aaaa)", "decimal": "nombre attendu",
                   "montant": "montant attendu", "pourcentage": "pourcentage attendu"}.get(parametre.Type, "valeur invalide")
        raise ErreurParametrage(f"{parametre.Libelle} : {attendu}.") from erreur
    if parametre.Type in ("entier", "decimal", "montant", "pourcentage"):
        if parametre.Minimum is not None and typee < parametre.Minimum:
            raise ErreurParametrage(f"{parametre.Libelle} : {_nombre_lisible(parametre.Minimum)} au minimum.")
        if parametre.Maximum is not None and typee > parametre.Maximum:
            raise ErreurParametrage(f"{parametre.Libelle} : {_nombre_lisible(parametre.Maximum)} au maximum.")
        return str(typee)
    if parametre.Type == "date":
        return typee.isoformat()
    return _texte(texte, 2000 if parametre.Type == "texte_long" else 200, parametre.Libelle)


def _parametre_json(p, complet=True):
    donnees = {"Cle": p.Cle, "Type": p.Type, "Valeur": p.Valeur}
    if complet:
        donnees.update({
            "Groupe": p.Groupe, "Libelle": p.Libelle, "Aide": p.Aide, "ValeurOrigine": p.ValeurOrigine,
            "Unite": p.Unite,
            "Minimum": None if p.Minimum is None else float(p.Minimum),
            "Maximum": None if p.Maximum is None else float(p.Maximum),
            "Ordre": p.Ordre,
            "DateModification": p.DateModification.isoformat() if p.DateModification else None,
            "ModifiePar": p.ModifiePar,
        })
    return donnees


def _document_json(d):
    return {
        "IdCompagnie": d.IdCompagnie,
        "Logo": d.Logo,
        "PiedPage": d.PiedPage,
        "Visa": d.Visa,
        "MentionLogo": d.MentionLogo,
        "OrdreCheque": d.OrdreCheque,
        "AttestationVoyage": d.AttestationVoyage or {},
        "Reversement": d.Reversement or {},
    }


def compagnie_par_defaut(id_produit, repli=None):
    """Compagnie proposée à l'ouverture d'un nouveau devis du produit (Administration > Produits), sinon `repli`."""
    p = ProduitParametre.objects.filter(IdProduit=id_produit).first()
    return (p.IdCompagnieDefaut if p and p.IdCompagnieDefaut else None) or repli


def _produits():
    params = {p.IdProduit: p for p in ProduitParametre.objects.all()}
    lignes = []
    for produit in Produit.objects.exclude(id_produit=0).order_by("id_produit"):
        p = params.get(produit.id_produit)
        lignes.append({
            "IdProduit": produit.id_produit,
            "Libelle": produit.libelle_produit,
            "Actif": bool(produit.active),
            "Onglet": p.Onglet if p else "",
            "ModuleSaisie": p.ModuleSaisie if p else "",
            "SaisieOuverte": bool(p and p.SaisieOuverte),
            "ArrondiTtc": p.ArrondiTtc if p else True,
            "IdCompagnieDefaut": p.IdCompagnieDefaut if p else None,
            "Ordre": p.Ordre if p else 99,
        })
    return sorted(lignes, key=lambda x: (x["Ordre"], x["IdProduit"]))


def _reponse_erreur(erreur):
    return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)


# ------------------------------------------------------------------ chargement de l'application
@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def parametrage(request):
    """GET /api/parametrage/ : tout ce que l'écran lit au démarrage (une seule requête)."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT idcompagnie, raisonsociale FROM stdcompagnie WHERE idcompagnie <> 0")
        noms = dict(cursor.fetchall())
    documents = [
        {**_document_json(d), "RaisonSociale": noms.get(d.IdCompagnie, "")}
        for d in CompagnieDocument.objects.all()
    ]
    site = ParametreSite.objects.order_by("id_parametre_site").first()
    return Response({
        "Cabinet": _cabinet_json(site) if site else {},
        "Parametres": {p.Cle: _parametre_json(p, complet=False) for p in ParametreGeneral.objects.all()},
        "Documents": documents,
        "Produits": _produits(),
        "Modules": [{"Code": c, "Libelle": l} for c, l in ProduitParametre.MODULES if c],
        # Formules MINENE SANTÉ : barème de soins imprimé (Réglages Santé MINENE)
        "SanteFormules": formules_pour_impression(),
        # Automobile : garanties admises selon l'âge du véhicule (signalées à la saisie)
        "ReglesGarantiesAuto": regles_garanties_auto(),
        "InteractionsGarantiesAuto": interactions_garanties_auto(),
    })


# ------------------------------------------------------------------ règles de gestion
@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def liste_parametres(request):
    """GET /api/parametrage/parametres/ : paramètres avec libellé, aide, bornes et valeur d'origine."""
    return Response([_parametre_json(p) for p in ParametreGeneral.objects.all()])


@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def modifier_parametre(request, cle):
    """PATCH /api/parametrage/parametres/<cle>/ {Valeur} ou {Retablir: true}."""
    try:
        parametre = ParametreGeneral.objects.get(Cle=cle)
    except ParametreGeneral.DoesNotExist:
        return Response({"error": f"Paramètre {cle} inconnu."}, status=status.HTTP_404_NOT_FOUND)
    avant = parametre.Valeur
    try:
        parametre.Valeur = parametre.ValeurOrigine if request.data.get("Retablir") else _valider_parametre(parametre, request.data.get("Valeur"))
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    parametre.ModifiePar = _auteur(request)
    parametre.save()
    _cache.pop(cle, None)
    # Les images ne sont pas recopiées dans le journal (trop volumineuses)
    trace = (lambda v: f"image ({len(v)} car.)" if v else "aucune") if parametre.Type == "image" else (lambda v: v)
    _journal(request, f"Paramètre « {parametre.Libelle} » modifié", {"cle": cle, "avant": trace(avant), "apres": trace(parametre.Valeur)})
    return Response(_parametre_json(parametre))


# ------------------------------------------------------------------ identité du cabinet
CHAMPS_CABINET = [
    # (champ du modèle, clé JSON, longueur max, obligatoire)
    ("raison_sociale", "RaisonSociale", 50, True),
    ("adresse_geographique", "AdresseGeographique", 100, False),
    ("adresse_postale", "AdressePostale", 50, False),
    ("telephone_fixe", "TelephoneFixe", 20, False),
    ("telephone_mobile", "TelephoneMobile", 20, False),
    ("nom_expediteur_mobile", "NomExpediteurSms", 11, False),
    ("indicatif_pays", "IndicatifPays", 3, True),
    ("prefixe_mobile", "PrefixesMobile", 200, False),
]


def _cabinet_json(site):
    donnees = {cle: getattr(site, champ) or "" for champ, cle, _, _ in CHAMPS_CABINET}
    donnees.update({
        "IdParametreSite": site.id_parametre_site,
        "LongueurNumeroTelephone": site.longueur_numero_telephone,
        "LongueurPrefixeMobile": site.longueur_prefixe_mobile,
    })
    return donnees


@api_view(["GET", "PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def cabinet(request):
    """GET / PATCH /api/parametrage/cabinet/ : identité du cabinet (stdparametresite)."""
    site = ParametreSite.objects.order_by("id_parametre_site").first()
    if not site:
        return Response({"error": "Identité du cabinet absente de la base (stdparametresite)."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response(_cabinet_json(site))
    avant = _cabinet_json(site)
    try:
        for champ, cle, longueur, obligatoire in CHAMPS_CABINET:
            if cle in request.data:
                setattr(site, champ, _texte(request.data[cle], longueur, cle, obligatoire))
        for champ, cle, minimum, maximum in [("longueur_numero_telephone", "LongueurNumeroTelephone", 6, 15),
                                             ("longueur_prefixe_mobile", "LongueurPrefixeMobile", 1, 4)]:
            if cle in request.data:
                try:
                    nombre = int(request.data[cle])
                except (TypeError, ValueError) as erreur:
                    raise ErreurParametrage(f"{cle} : nombre entier attendu.") from erreur
                if not minimum <= nombre <= maximum:
                    raise ErreurParametrage(f"{cle} : entre {minimum} et {maximum}.")
                setattr(site, champ, nombre)
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    if site.indicatif_pays and not site.indicatif_pays.isdigit():
        return _reponse_erreur(ErreurParametrage("Indicatif du pays : chiffres seulement (ex. 225)."))
    site.save()
    _journal(request, "Identité du cabinet modifiée", {"avant": avant, "apres": _cabinet_json(site)})
    return Response(_cabinet_json(site))


# ------------------------------------------------------------------ compagnies
CHAMPS_COMPAGNIE = [
    # (colonne stdcompagnie, clé JSON, longueur max, obligatoire)
    ("raisonsociale", "RaisonSociale", 100, True),
    ("codeasaci", "CodeAsaci", 20, False),
    ("adresse1", "Adresse1", 100, False),
    ("adresse2", "Adresse2", 100, False),
    ("telephone", "Telephone", 20, False),
    ("mobile", "Mobile", 20, False),
    ("fax", "Fax", 20, False),
]
SQL_COMPAGNIES = f"""
    SELECT c.idcompagnie, {', '.join(f'c.{col}' for col, *_ in CHAMPS_COMPAGNIE)}, COALESCE(c.etranger, FALSE),
           COALESCE(c.active, FALSE),
           (SELECT COUNT(*) FROM stdcontrat ct WHERE ct.idcompagnie = c.idcompagnie) AS contrats
    FROM stdcompagnie c
    WHERE c.idcompagnie <> 0
"""


def _longueurs_compagnie():
    """Longueur réelle des colonnes texte de stdcompagnie (la base fait foi, pas le modèle)."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT column_name, character_maximum_length FROM information_schema.columns "
            "WHERE table_name = 'stdcompagnie' AND character_maximum_length IS NOT NULL"
        )
        return dict(cursor.fetchall())


def _compagnie_json(ligne, document=None, complet=True):
    donnees = {"IdCompagnie": ligne[0]}
    for i, (_, cle, _, _) in enumerate(CHAMPS_COMPAGNIE, start=1):
        donnees[cle] = (ligne[i] or "").strip()
    n = len(CHAMPS_COMPAGNIE)
    donnees.update({"Etranger": bool(ligne[n + 1]), "Active": bool(ligne[n + 2]), "Contrats": ligne[n + 3]})
    if document is not None:
        donnees["Documents"] = _document_json(document) if complet else {
            "Logo": bool(document.Logo), "PiedPage": bool(document.PiedPage),
            "AttestationVoyage": bool((document.AttestationVoyage or {}).get("Actif")),
        }
    return donnees


def _lire_compagnie(id_compagnie):
    with connection.cursor() as cursor:
        cursor.execute(SQL_COMPAGNIES + " AND c.idcompagnie = %s", [id_compagnie])
        return cursor.fetchone()


def _valider_attestation(donnees):
    if not isinstance(donnees, dict):
        raise ErreurParametrage("Attestation voyage : données attendues sous forme de fiche.")
    attestation = {"Actif": bool(donnees.get("Actif"))}
    for cle in CHAMPS_ATTESTATION_TEXTE:
        attestation[cle] = _texte(donnees.get(cle), 120, f"Attestation voyage - {cle}")
    for cle in CHAMPS_ATTESTATION_URL:
        adresse = _texte(donnees.get(cle), 250, f"Attestation voyage - {cle}")
        if adresse and not adresse.lower().startswith(("https://", "http://")):
            raise ErreurParametrage(f"Attestation voyage : l'adresse {cle} doit commencer par https://.")
        attestation[cle] = adresse
    for cle, maximum in (("Garanties", 12), ("Exemplaires", 5)):
        liste = [_texte(x, 250, f"Attestation voyage - {cle}") for x in (donnees.get(cle) or []) if str(x or "").strip()]
        if len(liste) > maximum:
            raise ErreurParametrage(f"Attestation voyage : {maximum} {cle.lower()} au plus.")
        attestation[cle] = liste
    if attestation["Actif"]:
        if not attestation["Signataire"]:
            raise ErreurParametrage("Attestation voyage : indiquez le signataire (ex. AMSA ASSURANCES COTE D'IVOIRE).")
        if not attestation["Garanties"]:
            raise ErreurParametrage("Attestation voyage : indiquez au moins une garantie.")
        if not attestation["Exemplaires"]:
            attestation["Exemplaires"] = ["Exemplaire de l'Assuré"]
    return attestation


CHAMPS_REVERSEMENT = ("NomBordereau", "Destinataire", "Service", "Ville", "AttentionDe", "Appellation")


def _valider_reversement(donnees):
    """Reversements et courriers d'une compagnie : part du cabinet dans les accessoires (%, vide : barème des
    accessoires du cabinet) et destinataire des courriers (production/views_bordereaux.py)."""
    if not isinstance(donnees, dict):
        raise ErreurParametrage("Reversements : données attendues sous forme de fiche.")
    reglages = {cle: _texte(donnees.get(cle), 120, f"Reversements - {cle}") for cle in CHAMPS_REVERSEMENT}
    part = donnees.get("PartAccessoiresCourtier")
    if part in (None, ""):
        reglages["PartAccessoiresCourtier"] = None
    else:
        try:
            part = float(str(part).replace(",", "."))
        except ValueError as erreur:
            raise ErreurParametrage("Part du cabinet dans les accessoires : pourcentage attendu.") from erreur
        if not 0 <= part <= 100:
            raise ErreurParametrage("Part du cabinet dans les accessoires : entre 0 et 100 %.")
        reglages["PartAccessoiresCourtier"] = int(part) if part == int(part) else part
    return reglages


@api_view(["GET", "POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def compagnies(request):
    """GET /api/parametrage/compagnies/ (actives et inactives) ; POST : nouvelle compagnie."""
    if request.method == "GET":
        documents = {d.IdCompagnie: d for d in CompagnieDocument.objects.all()}
        with connection.cursor() as cursor:
            cursor.execute(SQL_COMPAGNIES + " ORDER BY COALESCE(c.active, FALSE) DESC, c.raisonsociale")
            lignes = cursor.fetchall()
        return Response([_compagnie_json(l, documents.get(l[0]) or CompagnieDocument(IdCompagnie=l[0]), complet=False) for l in lignes])
    try:
        longueurs = _longueurs_compagnie()
        valeurs = {col: _texte(request.data.get(cle), min(n, longueurs.get(col, n)), cle, obl) for col, cle, n, obl in CHAMPS_COMPAGNIE}
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM stdcompagnie WHERE UPPER(TRIM(raisonsociale)) = UPPER(%s)", [valeurs["raisonsociale"]])
        if cursor.fetchone():
            return _reponse_erreur(ErreurParametrage(f"La compagnie « {valeurs['raisonsociale']} » existe déjà."))
        # Identifiant attribué par la base (colonne identité de stdcompagnie)
        colonnes = list(valeurs)
        cursor.execute(
            f"INSERT INTO stdcompagnie ({', '.join(colonnes)}, idville, etranger, active, datemaj) "
            f"VALUES ({', '.join(['%s'] * len(colonnes))}, 1, %s, TRUE, %s) RETURNING idcompagnie",
            [*[valeurs[c] for c in colonnes], bool(request.data.get("Etranger")), timezone.now()],
        )
        id_compagnie = cursor.fetchone()[0]
    _journal(request, f"Compagnie « {valeurs['raisonsociale']} » créée", {"idcompagnie": id_compagnie, **valeurs})
    return Response(_compagnie_json(_lire_compagnie(id_compagnie), CompagnieDocument(IdCompagnie=id_compagnie)), status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def compagnie(request, id_compagnie):
    """GET / PATCH /api/parametrage/compagnies/<id>/ : identité (stdcompagnie) et documents."""
    ligne = _lire_compagnie(id_compagnie)
    if not ligne:
        return Response({"error": f"Compagnie {id_compagnie} introuvable."}, status=status.HTTP_404_NOT_FOUND)
    document = CompagnieDocument.objects.filter(IdCompagnie=id_compagnie).first() or CompagnieDocument(IdCompagnie=id_compagnie)
    if request.method == "GET":
        return Response(_compagnie_json(ligne, document))

    avant = _compagnie_json(ligne, document)
    try:
        longueurs = _longueurs_compagnie()
        identite = {
            col: _texte(request.data[cle], min(n, longueurs.get(col, n)), cle, obl)
            for col, cle, n, obl in CHAMPS_COMPAGNIE if cle in request.data
        }
        for cle in ("Etranger", "Active"):
            if cle in request.data:
                identite[cle.lower()] = bool(request.data[cle])
        docs = request.data.get("Documents")
        if docs is not None:
            if not isinstance(docs, dict):
                raise ErreurParametrage("Documents : données attendues sous forme de fiche.")
            if "Logo" in docs:
                document.Logo = _image(docs["Logo"], "Logo")
            if "PiedPage" in docs:
                document.PiedPage = _texte(docs["PiedPage"], 2000, "Pied de page")
            if "Visa" in docs:
                document.Visa = _texte(docs["Visa"], 200, "Visa")
            if "MentionLogo" in docs:
                document.MentionLogo = _texte(docs["MentionLogo"], 100, "Mention sous le logo")
            if "OrdreCheque" in docs:
                document.OrdreCheque = _texte(docs["OrdreCheque"], 100, "Chèque à l'ordre de")
            if "AttestationVoyage" in docs:
                document.AttestationVoyage = _valider_attestation(docs["AttestationVoyage"])
            if "Reversement" in docs:
                document.Reversement = _valider_reversement(docs["Reversement"])
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)

    with transaction.atomic():
        if identite:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"UPDATE stdcompagnie SET {', '.join(f'{c} = %s' for c in identite)}, datemaj = %s WHERE idcompagnie = %s",
                    [*identite.values(), timezone.now(), id_compagnie],
                )
        if docs is not None:
            document.save()
    apres = _compagnie_json(_lire_compagnie(id_compagnie), document)
    for donnees in (avant, apres):  # logos non recopiés dans le journal
        donnees["Documents"] = {**donnees["Documents"], "Logo": bool(donnees["Documents"]["Logo"])}
    _journal(request, f"Compagnie « {apres['RaisonSociale']} » modifiée", {"avant": avant, "apres": apres})
    return Response(_compagnie_json(_lire_compagnie(id_compagnie), document))


# ------------------------------------------------------------------ produits
@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def produits(request):
    """GET /api/parametrage/produits/ : produits et leur place dans LE PHARE."""
    return Response({"Produits": _produits(), "Modules": [{"Code": c, "Libelle": l} for c, l in ProduitParametre.MODULES if c]})


@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def produit(request, id_produit):
    """PATCH /api/parametrage/produits/<id>/ {Libelle, Actif, Onglet, ModuleSaisie, SaisieOuverte, ArrondiTtc,
    IdCompagnieDefaut, Ordre}."""
    try:
        ligne = Produit.objects.get(id_produit=id_produit)
    except Produit.DoesNotExist:
        return Response({"error": f"Produit {id_produit} introuvable."}, status=status.HTTP_404_NOT_FOUND)
    param = ProduitParametre.objects.filter(IdProduit=id_produit).first() or ProduitParametre(IdProduit=id_produit, Onglet=ligne.libelle_produit.title())
    avant = next(p for p in _produits() if p["IdProduit"] == id_produit)
    modules = {c for c, _ in ProduitParametre.MODULES}
    try:
        if "Libelle" in request.data:
            ligne.libelle_produit = _texte(request.data["Libelle"], 60, "Libellé", obligatoire=True).upper()
        if "Actif" in request.data:
            ligne.active = bool(request.data["Actif"])
        if "Onglet" in request.data:
            param.Onglet = _texte(request.data["Onglet"], 40, "Onglet du registre", obligatoire=True)
        if "ModuleSaisie" in request.data:
            module = str(request.data["ModuleSaisie"] or "")
            if module not in modules:
                raise ErreurParametrage("Formulaire de saisie inconnu.")
            param.ModuleSaisie = module
        if "SaisieOuverte" in request.data:
            param.SaisieOuverte = bool(request.data["SaisieOuverte"])
        if "ArrondiTtc" in request.data:
            param.ArrondiTtc = bool(request.data["ArrondiTtc"])
        if "IdCompagnieDefaut" in request.data:
            try:
                id_compagnie = int(request.data["IdCompagnieDefaut"] or 0)
            except (TypeError, ValueError) as erreur:
                raise ErreurParametrage("Compagnie proposée : compagnie inconnue.") from erreur
            if id_compagnie:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1 FROM stdcompagnie WHERE idcompagnie = %s AND idcompagnie <> 0", [id_compagnie])
                    if not cursor.fetchone():
                        raise ErreurParametrage("Compagnie proposée : compagnie inconnue.")
            param.IdCompagnieDefaut = id_compagnie or None
        if "Ordre" in request.data:
            try:
                param.Ordre = max(0, min(999, int(request.data["Ordre"])))
            except (TypeError, ValueError) as erreur:
                raise ErreurParametrage("Ordre : nombre entier attendu.") from erreur
        if param.SaisieOuverte and not param.ModuleSaisie:
            raise ErreurParametrage("Choisissez le formulaire de saisie avant d'ouvrir la saisie.")
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    with transaction.atomic():
        ligne.save()
        param.save()
    apres = next(p for p in _produits() if p["IdProduit"] == id_produit)
    _journal(request, f"Produit « {ligne.libelle_produit} » modifié", {"avant": avant, "apres": apres})
    return Response(apres)


# ------------------------------------------------------------------ barèmes (routes d'URANUS)
class JournalModificationsMixin:
    """Inscrit au journal d'audit chaque ajout, modification ou suppression d'une ligne de barème
    (taux de taxe, commissions, accessoires, réductions flotte, sécurité routière, délais)."""

    libelle_journal = "Barème"

    def _donnees(self, instance):
        return json.loads(json.dumps(self.get_serializer(instance).data, default=str))

    def perform_create(self, serializer):
        super().perform_create(serializer)
        _journal(self.request, f"{self.libelle_journal} : ligne ajoutée", {"apres": self._donnees(serializer.instance)})

    def perform_update(self, serializer):
        avant = self._donnees(serializer.instance)
        super().perform_update(serializer)
        _journal(self.request, f"{self.libelle_journal} : ligne modifiée", {"avant": avant, "apres": self._donnees(serializer.instance)})

    def perform_destroy(self, instance):
        avant = self._donnees(instance)
        super().perform_destroy(instance)
        _journal(self.request, f"{self.libelle_journal} : ligne supprimée", {"avant": avant})
