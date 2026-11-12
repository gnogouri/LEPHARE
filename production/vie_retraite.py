"""
Branche Vie, offre Retraite complémentaire (demande du 2026-11-10) : état mensuel des cotisations du souscripteur, importé
ou saisi, enregistré en devis Vie (production/afa.py, enregistrer).

Fichier de référence : états « ARC » de CI-ENERGIES (dossier OREOLE Vie\\Retraite_complementaire, janvier à octobre 2026) :
titres « ASSURANCE RETRAITE COMPLEMENTAIRE » / « ETAT DES COTISATIONS DU MOIS DE JANVIER 2026 », en-tête sur deux lignes
N° | Matric. | Nom | Prénoms | Cotisations Mensuelles (SALARIES REELS | CI-ENERGIES REELS) | Total Cotisations |
Observations, environ 610 salariés, ligne « Montant Total ». Les colonnes sont reconnues par leur intitulé (part salariale,
part employeur ou patronale, en une ou deux lignes d'en-tête). Les colonnes Nom et Prénoms sont inversées dans les états
de janvier à août 2026 : la colonne où figurent les noms de famille (un mot en capitales) est reconnue et remise en place.

Comme URANUS (police 3100000250296C d'ALLIANZ CI VIE, une affaire nouvelle en 2014 puis un renouvellement par mois) :
un état = un devis d'un mois (du 1er au dernier jour), affaire nouvelle ou mois suivant d'une police existante (devis REN,
même numéro de police), prime = total des cotisations, sans taxe ni prorata. Le devis porte une ligne de détail (le total,
sous-garantie de l'offre : 192 RENTE À TERME) et les salariés sont dans lephare_vie_cotisant ; aucun salarié ne devient
une fiche client (l'état ne donne pas de date de naissance) : il est suivi d'un mois à l'autre par son matricule.

POST /api/afa/retraite/analyse/                   état lu, contrôlé et comparé au mois précédent, rien n'est enregistré
GET  /api/afa/retraite/etat-precedent/?client=&avant=&devis=   dernier état enregistré du souscripteur (saisie à la main)
GET  /api/afa/retraite/modele/                    modèle Excel vierge
"""
import calendar
import io
import logging
import re
import zipfile
from datetime import date
from decimal import Decimal

from django.db import connection
from django.http import HttpResponse
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils.exceptions import InvalidFileException
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from . import vie_offres
from .afa import (ErreurAfa, TAILLE_FICHIER_MAX, _date, _iso, _montant, _nombre, _norme, _polices_vie, _souscripteur,
                  _valeurs_fusionnees)
from .renouvellement import AUTHENTIFICATION

logger = logging.getLogger(__name__)

LIGNES_ENTETE_MAX = 20
LIGNES_VIDES_MAX = 50
MOIS = {"JANVIER": 1, "JANV": 1, "FEVRIER": 2, "FEV": 2, "FEVR": 2, "MARS": 3, "AVRIL": 4, "AVR": 4, "MAI": 5, "JUIN": 6,
        "JUILLET": 7, "JUIL": 7, "AOUT": 8, "SEPTEMBRE": 9, "SEPT": 9, "OCTOBRE": 10, "OCT": 10, "NOVEMBRE": 11, "NOV": 11,
        "DECEMBRE": 12, "DEC": 12}
NOMS_MOIS = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
MOTIF_MOIS = re.compile(r"\b(" + "|".join(sorted(MOIS, key=len, reverse=True)) + r")\s*(\d{4}|\d{2})\b")
ENTETES_MODELE = ["N°", "MATRICULE", "NOM", "PRENOMS", "PART SALARIALE", "PART EMPLOYEUR", "TOTAL COTISATIONS", "OBSERVATIONS"]


# ------------------------------------------------------------------ outils
def fin_de_mois(jour):
    return jour.replace(day=calendar.monthrange(jour.year, jour.month)[1])


def libelle_mois(jour):
    return f"{NOMS_MOIS[jour.month]} {jour.year}" if jour else ""


def mois_du_texte(*textes):
    """1er jour du mois cité dans le premier texte qui en cite un (« ETAT DES COTISATIONS DU MOIS D'OCTOBRE 2026 »,
    « SEPT 26 », « ARC - Août 2026.xlsx »), None sinon."""
    for texte in textes:
        trouve = MOTIF_MOIS.search(_norme(texte))
        if trouve:
            annee = int(trouve.group(2))
            return date(annee + 2000 if annee < 100 else annee, MOIS[trouve.group(1)], 1)
    return None


def _cle(ligne):
    """Clé d'un salarié d'un mois à l'autre : son matricule, sinon son nom complet."""
    matricule = _norme(ligne.get("Matricule")).replace(" ", "")
    return f"M:{matricule}" if matricule else f"N:{_norme(ligne.get('Nom'))} {_norme(ligne.get('Prenoms'))}".strip()


def _texte(valeur, longueur):
    return re.sub(r"\s+", " ", str(valeur or "")).strip().upper()[:longueur]


def _patronyme(valeur):
    """Nom de famille tel que l'écrivent les états : un seul mot, en capitales."""
    texte = str(valeur or "").strip()
    return bool(re.search(r"[A-Za-zÀ-ÿ]", texte)) and texte == texte.upper() and len(texte.split()) == 1


# ------------------------------------------------------------------ lecture du fichier
def _role(texte, sous):
    """Rôle d'une colonne d'après son intitulé (et la ligne d'en-tête suivante, pour les cotisations sur deux lignes)."""
    if not texte and not sous:
        return None
    if "MATRIC" in texte:
        return "matricule"
    if "OBSERV" in texte:
        return "observation"
    if "TOTAL" in texte:
        return "total"
    if "PRENOM" in texte:
        return "nom_complet" if re.search(r"\bNOMS?\b", texte) else "prenoms"
    if re.search(r"\bNOMS?\b", texte):
        return "nom"
    if re.fullmatch(r"N|NO|NUM|NUMERO|N ORDRE", texte):
        return "numero"
    zone = f"{texte} {sous}"
    if re.search(r"SALARI|\bEMPLOYES?\b|OUVRIER", zone) and "EMPLOYEUR" not in zone:
        return "salarie"
    if re.search(r"COTIS|PART|PATRON|EMPLOYEUR|CONTRIBUTION|RETENUE", zone):
        return "employeur"
    return None


def _entete(feuille, fusions):
    """(ligne d'en-tête, {rôle: colonne}, libellé de la colonne employeur) : première ligne où l'on reconnaît le nom et
    les deux parts de cotisation."""
    valeur = lambda l, c: fusions.get((l, c), feuille.cell(l, c).value)  # noqa: E731
    for ligne in range(1, min(feuille.max_row, LIGNES_ENTETE_MAX) + 1):
        colonnes, employeur = {}, ""
        for colonne in range(1, min(feuille.max_column, 40) + 1):
            texte, sous_brut = _norme(valeur(ligne, colonne)), valeur(ligne + 1, colonne)
            sous = _norme(sous_brut) if isinstance(sous_brut, str) else ""
            role = _role(texte, sous)
            if role and role not in colonnes:
                colonnes[role] = colonne
                if role == "employeur" and isinstance(sous_brut, str):
                    employeur = sous_brut
        if ("nom" in colonnes or "nom_complet" in colonnes) and "salarie" in colonnes and "employeur" in colonnes:
            return ligne, colonnes, employeur
    return None, {}, ""


def _employeur(libelle):
    """Nom de l'employeur tiré de l'intitulé de sa colonne (« CI-ENERGIES REELS » -> CI-ENERGIES), vide s'il n'y en a pas."""
    texte = re.sub(r"\b(R[ÉE]ELS?|PARTS?|COTISATIONS?|PATRONALES?|EMPLOYEURS?|MENSUELLES?)\b", " ", str(libelle or ""), flags=re.I)
    texte = re.sub(r"\s+", " ", texte).strip(" -:/")
    return texte if len(_norme(texte)) >= 2 else ""


def lire_fichier(contenu, nom_fichier=""):
    """Lignes de l'état, sans contrôle métier : {Titres, Feuille, Mois, Employeur, Lignes, Totaux du fichier, Inversion}."""
    try:
        classeur = load_workbook(io.BytesIO(contenu), data_only=True)
    except (InvalidFileException, zipfile.BadZipFile, KeyError, OSError, ValueError) as erreur:
        raise ErreurAfa("Fichier illisible : envoyez un classeur Excel (.xlsx).") from erreur
    for feuille in classeur.worksheets:
        fusions = _valeurs_fusionnees(feuille)
        ligne_entete, colonnes, libelle_employeur = _entete(feuille, fusions)
        if not ligne_entete:
            continue
        cellule = lambda l, cle: fusions.get((l, colonnes[cle]), feuille.cell(l, colonnes[cle]).value) if cle in colonnes else None  # noqa: E731
        titres = [t for t in (feuille.cell(l, c).value for l in range(1, ligne_entete) for c in range(1, min(feuille.max_column, 12) + 1))
                  if isinstance(t, str) and t.strip()]
        titres = [t.strip() for t in titres]
        # En-tête sur deux lignes (cellules fusionnées N°, Matric., Nom… jusqu'à la ligne des parts) : les données commencent dessous
        fin_entete = max([p.max_row for p in feuille.merged_cells.ranges if p.min_row == ligne_entete] + [ligne_entete])
        lignes, totaux, vides = [], {}, 0
        for numero in range(fin_entete + 1, feuille.max_row + 1):
            brute = {cle: cellule(numero, cle) for cle in colonnes}
            textes = [str(v) for v in brute.values() if isinstance(v, str)]
            if not str(brute.get("matricule") or "").strip() and any(re.match(r"(MONTANT )?TOTAL", _norme(t)) for t in textes):
                totaux = {"salarie": brute.get("salarie"), "employeur": brute.get("employeur"), "total": brute.get("total")}
                break
            nom = brute.get("nom") or brute.get("nom_complet")
            if not str(nom or "").strip() and not str(brute.get("matricule") or "").strip():
                # Sous-titres des cotisations, lignes de séparation ou numérotées sans salarié
                vides += 1
                if vides >= LIGNES_VIDES_MAX:
                    break
                continue
            vides = 0
            lignes.append(brute | {"Ligne": numero})
        # Colonnes Nom et Prénoms inversées (états de janvier à août 2026) : noms de famille dans la colonne Prénoms
        inversion = False
        if "nom" in colonnes and "prenoms" in colonnes and lignes:
            part_nom = sum(_patronyme(l.get("nom")) for l in lignes) / len(lignes)
            part_prenoms = sum(_patronyme(l.get("prenoms")) for l in lignes) / len(lignes)
            if part_prenoms >= 0.6 and part_nom <= 0.3:
                inversion = True
                for l in lignes:
                    l["nom"], l["prenoms"] = l.get("prenoms"), l.get("nom")
        return {"Titres": titres, "Feuille": feuille.title, "Lignes": lignes, "TotauxFichier": totaux, "Inversion": inversion,
                "Mois": mois_du_texte(*titres, feuille.title, nom_fichier), "Employeur": _employeur(libelle_employeur)}
    raise ErreurAfa("Ligne d'en-tête introuvable : l'état doit comporter au moins les colonnes « Matricule », « Nom », la part "
                    "salariale et la part employeur des cotisations (modèle Retraite complémentaire).")


# ------------------------------------------------------------------ contrôles d'une ligne
# Un salarié peut ne pas cotiser un mois (règle de l'utilisateur du 2026-11-11) : parts vides ou nulles admises, il reste dans
# l'état à 0 F ; dans les états de CI-ENERGIES il est le plus souvent absent du fichier du mois puis y revient (comparer).
SANS_COTISATION = "Aucune cotisation ce mois."


def controler_ligne(ligne):
    """Erreurs (bloquantes) et avertissements d'un salarié saisi ou importé."""
    erreurs, avertissements = [], []
    if not ligne["Nom"]:
        erreurs.append("Nom absent.")
    salarie, employeur = ligne.get("CotisationSalarie"), ligne.get("CotisationEmployeur")
    if (salarie or 0) < 0 or (employeur or 0) < 0:
        erreurs.append("Une cotisation ne peut pas être négative.")
    elif not (salarie or 0) and not (employeur or 0):
        avertissements.append(SANS_COTISATION)
    if not ligne["Matricule"]:
        avertissements.append("Sans matricule, le salarié ne pourra pas être suivi d'un mois à l'autre.")
    return erreurs, avertissements


def _ligne_importee(brute):
    l = {"Ligne": brute["Ligne"], "Erreurs": [], "Avertissements": []}
    nom, prenoms = _texte(brute.get("nom"), 100), _texte(brute.get("prenoms"), 150)
    if "nom_complet" in brute and not nom:
        morceaux = _texte(brute.get("nom_complet"), 250).split(" ")
        nom, prenoms = morceaux[0][:100], " ".join(morceaux[1:])[:150]
    l.update({"Matricule": _texte(brute.get("matricule"), 30), "Nom": nom, "Prenoms": prenoms,
              "Observation": re.sub(r"\s+", " ", str(brute.get("observation") or "")).strip()[:200]})
    montants = {}
    for cle, champ, libelle in (("salarie", "CotisationSalarie", "Part salariale"), ("employeur", "CotisationEmployeur", "Part employeur")):
        try:
            montants[champ] = _montant(brute.get(cle))
        except ValueError as erreur:
            montants[champ] = None
            l["Erreurs"].append(f"{libelle} : {erreur}.")
        l[champ] = _nombre(montants[champ])
    erreurs, avertissements = controler_ligne(l | {"CotisationSalarie": montants["CotisationSalarie"], "CotisationEmployeur": montants["CotisationEmployeur"]})
    if not any(e.startswith("Part ") for e in l["Erreurs"]):
        l["Erreurs"] += erreurs
    l["Avertissements"] += avertissements
    total = (montants["CotisationSalarie"] or 0) + (montants["CotisationEmployeur"] or 0)
    l["Total"] = _nombre(total)
    try:
        total_fichier = _montant(brute.get("total"))
    except ValueError:
        total_fichier = None
    if total_fichier is not None and total_fichier != total:
        l["Avertissements"].append(f"Total du fichier {total_fichier:,.0f} F différent de la somme des deux parts.".replace(",", " "))
    return l


# ------------------------------------------------------------------ état précédent et comparaison
def etat_precedent(cursor, id_client, avant, exclure=0):
    """Dernier état de cotisations enregistré pour le souscripteur avant le mois donné (devis confirmé de préférence à
    mois égal), None s'il n'y en a pas."""
    if not id_client or not vie_offres.tables_presentes(cursor):
        return None
    cursor.execute(
        """
        SELECT d.iddevis, d.numerodevis, d.dateeffet::date, COALESCE(d.confirme, FALSE)
        FROM stddevis d
        JOIN lephare_vie_devis v ON v.iddevis = d.iddevis
        JOIN lephare_vie_offre o ON o.idoffre = v.idoffre AND o.saisie = %s
        WHERE d.idclient = %s AND d.idproduit = 10 AND d.iddevis <> %s AND NOT COALESCE(d.archive, FALSE)
          AND (%s::date IS NULL OR d.dateeffet::date < %s::date)
          AND EXISTS (SELECT 1 FROM lephare_vie_cotisant c WHERE c.iddevis = d.iddevis)
        ORDER BY d.dateeffet DESC, COALESCE(d.confirme, FALSE) DESC, d.iddevis DESC
        LIMIT 1
        """,
        [vie_offres.SAISIE_COTISATION, id_client, exclure or 0, avant, avant],
    )
    ligne = cursor.fetchone()
    if not ligne:
        return None
    id_devis, numero, effet, confirme = ligne
    return {"IdDevis": id_devis, "NumeroDevis": numero, "Mois": _iso(effet), "LibelleMois": libelle_mois(effet), "Confirme": confirme,
            "Cotisants": lire_cotisants(cursor, id_devis), "Connus": sorted(salaries_connus(cursor, id_client, avant, exclure))}


def salaries_connus(cursor, id_client, avant, exclure=0):
    """Salariés (clé matricule, sinon nom) figurant dans au moins un état du souscripteur antérieur au mois donné : un salarié
    absent le mois précédent qui revient reprend ses cotisations, il n'est pas un nouvel entrant."""
    if not id_client or not vie_offres.tables_presentes(cursor):
        return set()
    cursor.execute(
        """
        SELECT DISTINCT c.matricule, c.nom, c.prenoms FROM lephare_vie_cotisant c
        JOIN stddevis d ON d.iddevis = c.iddevis
        JOIN lephare_vie_devis v ON v.iddevis = d.iddevis
        JOIN lephare_vie_offre o ON o.idoffre = v.idoffre AND o.saisie = %s
        WHERE d.idclient = %s AND d.idproduit = 10 AND d.iddevis <> %s AND NOT COALESCE(d.archive, FALSE)
          AND (%s::date IS NULL OR d.dateeffet::date < %s::date)
        """,
        [vie_offres.SAISIE_COTISATION, id_client, exclure or 0, avant, avant],
    )
    return {_cle({"Matricule": m, "Nom": n, "Prenoms": p}) for m, n, p in cursor.fetchall()}


def _total(ligne):
    return (ligne.get("CotisationSalarie") or 0) + (ligne.get("CotisationEmployeur") or 0)


def comparer(lignes, precedent):
    """Écarts avec l'état précédent (par matricule, sinon par nom). Un salarié peut ne pas cotiser un mois : absent du fichier
    (« Sortants » : sans cotisation ce mois, ou parti) ou présent à 0 F (« SansCotisation ») ; à son retour il « reprend »
    (« Reprises » : déjà dans un état antérieur, precedent["Connus"]) ; « Entrants » = jamais vus pour ce souscripteur."""
    if not precedent:
        return None
    avant = {_cle(l): l for l in precedent["Cotisants"]}
    connus = set(precedent.get("Connus") or ()) | avant.keys()
    maintenant = {_cle(l): l for l in lignes if l.get("Nom") or l.get("Matricule")}
    resume = lambda l: {k: l.get(k) for k in ("Matricule", "Nom", "Prenoms", "CotisationSalarie", "CotisationEmployeur")}  # noqa: E731
    modifies = []
    for cle in maintenant.keys() & avant.keys():
        a, m = avant[cle], maintenant[cle]
        if (a["CotisationSalarie"] or 0) != (m.get("CotisationSalarie") or 0) or (a["CotisationEmployeur"] or 0) != (m.get("CotisationEmployeur") or 0):
            modifies.append(resume(m) | {"AncienneSalarie": a["CotisationSalarie"], "AncienneEmployeur": a["CotisationEmployeur"]})
    total_avant = sum(_total(l) for l in precedent["Cotisants"])
    total = sum(_total(l) for l in maintenant.values())
    arrives = maintenant.keys() - avant.keys()
    return {
        "IdDevis": precedent["IdDevis"], "NumeroDevis": precedent["NumeroDevis"], "Mois": precedent["Mois"],
        "LibelleMois": precedent["LibelleMois"], "Confirme": precedent["Confirme"],
        "Salaries": len(avant), "Total": total_avant, "Ecart": total - total_avant,
        "Entrants": [resume(maintenant[c]) for c in sorted(arrives - connus)],
        "Reprises": [resume(maintenant[c]) for c in sorted(arrives & connus)],
        "Sortants": [resume(avant[c]) for c in sorted(avant.keys() - maintenant.keys())],
        "SansCotisation": [resume(maintenant[c]) for c in sorted(maintenant) if not _total(maintenant[c])],
        "Modifies": sorted(modifies, key=lambda l: (l["Nom"], l["Prenoms"])),
    }


def mois_deja_enregistre(cursor, id_client, effet, exclure=0):
    """Devis de cotisations du même souscripteur pour le même mois (hors devis exclu et devis archivés)."""
    if not id_client or not effet or not vie_offres.tables_presentes(cursor):
        return None
    cursor.execute(
        """SELECT d.iddevis, d.numerodevis, COALESCE(d.confirme, FALSE) FROM stddevis d
           JOIN lephare_vie_devis v ON v.iddevis = d.iddevis
           JOIN lephare_vie_offre o ON o.idoffre = v.idoffre AND o.saisie = %s
           WHERE d.idclient = %s AND d.idproduit = 10 AND d.dateeffet::date = %s AND d.iddevis <> %s AND NOT COALESCE(d.archive, FALSE)
           ORDER BY d.iddevis DESC LIMIT 1""",
        [vie_offres.SAISIE_COTISATION, id_client, effet, exclure or 0],
    )
    ligne = cursor.fetchone()
    return {"IdDevis": ligne[0], "NumeroDevis": ligne[1], "Confirme": ligne[2]} if ligne else None


# ------------------------------------------------------------------ analyse (import)
def analyser(contenu, nom_fichier=""):
    fichier = lire_fichier(contenu, nom_fichier)
    lignes = [_ligne_importee(b) for b in fichier["Lignes"]]
    if not lignes:
        raise ErreurAfa("Aucun salarié trouvé sous la ligne d'en-tête du fichier.")
    erreurs, avertissements = [], []
    vus = {}
    for l in lignes:
        if l["Matricule"]:
            if l["Matricule"] in vus:
                l["Erreurs"].append(f"Matricule {l['Matricule']} déjà présent à la ligne {vus[l['Matricule']]} du fichier.")
            else:
                vus[l["Matricule"]] = l["Ligne"]
    if fichier["Inversion"]:
        avertissements.append("Colonnes « Nom » et « Prénoms » inversées dans le fichier : les noms de famille ont été remis dans la colonne Nom.")
    total_salarie = sum(Decimal(str(l["CotisationSalarie"] or 0)) for l in lignes)
    total_employeur = sum(Decimal(str(l["CotisationEmployeur"] or 0)) for l in lignes)
    for cle, libelle, calcule in (("salarie", "parts salariales", total_salarie), ("employeur", "parts employeur", total_employeur),
                                  ("total", "cotisations", total_salarie + total_employeur)):
        try:
            attendu = _montant(fichier["TotauxFichier"].get(cle))
        except ValueError:
            attendu = None
        if attendu is not None and attendu != calcule:
            avertissements.append(f"Total des {libelle} du fichier ({attendu:,.0f} F) différent de la somme des lignes ({calcule:,.0f} F).".replace(",", " "))
    sans_cotisation = sum(1 for l in lignes if SANS_COTISATION in l["Avertissements"])
    if not total_salarie + total_employeur:
        erreurs.append("Aucune cotisation dans cet état : le total du mois est nul.")
    elif sans_cotisation:
        avertissements.append(f"{sans_cotisation} salarié(s) sans cotisation ce mois (0 F) : gardé(s) dans l'état, sans prime.")
    mois = fichier["Mois"]
    if not mois:
        avertissements.append("Mois de l'état non reconnu dans le titre, la feuille ni le nom du fichier : choisissez-le à l'écran.")

    with connection.cursor() as cursor:
        souscripteur = _souscripteur(cursor, fichier["Employeur"]) if fichier["Employeur"] else None
        id_client = souscripteur and souscripteur["IdClient"]
        polices = polices_annotees(cursor, id_client)
        precedent = etat_precedent(cursor, id_client, mois)
        doublon = mois_deja_enregistre(cursor, id_client, mois)
    if doublon:
        avertissements.append(f"L'état de {libelle_mois(mois)} de ce souscripteur est déjà enregistré : devis {doublon['NumeroDevis']}"
                              f"{' confirmé' if doublon['Confirme'] else ''}. Modifiez ce devis plutôt que d'en créer un second.")
    for p in polices:
        if mois and p["DateEffet"] and p["Mensuelle"] and p["DateEffet"] >= _iso(mois):
            avertissements.append(f"La police {p['NumeroPolice']} couvre déjà {libelle_mois(date.fromisoformat(p['DateEffet']))} : "
                                  f"le mois suivant à enregistrer est celui qui suit.")
            break
    if any(l["Erreurs"] for l in lignes):
        erreurs.append(f"{sum(1 for l in lignes if l['Erreurs'])} salarié(s) à corriger : corrigez-les à l'écran ou dans le fichier.")
    return {
        "Titre": next((t for t in fichier["Titres"] if "COTISATION" in _norme(t)), fichier["Titres"][-1] if fichier["Titres"] else ""),
        "Feuille": fichier["Feuille"], "Fichier": nom_fichier, "Mois": _iso(mois), "LibelleMois": libelle_mois(mois),
        "DateEffet": _iso(mois), "DateExpiration": _iso(fin_de_mois(mois)) if mois else None,
        "Employeur": fichier["Employeur"], "Souscripteur": souscripteur, "Polices": polices, "Inversion": fichier["Inversion"],
        "Lignes": lignes, "Erreurs": erreurs, "Avertissements": avertissements, "Comparaison": comparer(lignes, precedent),
        "Totaux": {"Salaries": len(lignes), "Salarie": float(total_salarie), "Employeur": float(total_employeur),
                   "Total": float(total_salarie + total_employeur)},
    }


def polices_annotees(cursor, id_client):
    """Polices Vie du souscripteur avec leur offre (si connue) et leur rythme : une période d'un mois au plus = état mensuel."""
    polices = _polices_vie(cursor, id_client)
    if not polices:
        return polices
    cursor.execute("SELECT idcontrat, iddevis FROM stdcontrat WHERE idcontrat = ANY(%s)", [[p["IdContrat"] for p in polices]])
    devis = dict(cursor.fetchall())
    offres = vie_offres.offres_des_devis(cursor, list(devis.values()))
    for p in polices:
        offre = offres.get(devis.get(p["IdContrat"]))
        p["Offre"] = offre["Libelle"] if offre else ""
        p["CodeOffre"] = offre["Code"] if offre else ""
        p["Mensuelle"] = bool(p["DateEffet"] and p["DateExpiration"]
                              and (date.fromisoformat(p["DateExpiration"]) - date.fromisoformat(p["DateEffet"])).days <= 31)
    return polices


# ------------------------------------------------------------------ renouvellement mensuel (demande du 2026-11-11)
# « Au renouvellement de la Retraite complémentaire, on télécharge chaque mois le fichier des cotisations » : le mois suivant
# d'une police se crée depuis l'écran Vie avec l'état du mois (afa.enregistrer exige le fichier), jamais en recopiant le total
# du mois précédent comme le renouvellement des autres branches (production/renouvellement.py renvoie vers l'écran Vie).
def etat_mensuel_de_police(cursor, base):
    """Police Vie renouvelée chaque mois par l'état des cotisations : de quoi importer l'état du mois suivant, None pour une
    autre police. base : contrat de base de la police (renouvellement._contrat_base). Police reprise d'URANUS sans offre
    connue : Retraite complémentaire si sa période est d'un mois au plus."""
    if base["idproduit"] != 10 or not vie_offres.tables_presentes(cursor):
        return None
    if vie_offres.offres_des_devis(cursor, [base["iddevis"]]):
        offre = vie_offres.offre_du_devis(cursor, base["iddevis"])
        if offre["Saisie"] != vie_offres.SAISIE_COTISATION:
            return None
    else:
        if (base["dateexpiration"] - base["dateeffet"]).days > 31:
            return None
        offre = next((o for o in vie_offres.offres(cursor, actives_seulement=False)
                      if o["Saisie"] == vie_offres.SAISIE_COTISATION and o["Periodicite"] == "MENSUELLE"), None)
        if not offre:
            return None
    dernier = base["dateeffet"].replace(day=1)
    suivant = date(dernier.year + dernier.month // 12, dernier.month % 12 + 1, 1)
    return {
        "IdContrat": base["idcontrat"], "NumeroPolice": base["numeropolice"], "IdClient": base["idclient"], "Client": base["client"],
        "IdCompagnie": base["idcompagnie"], "Compagnie": (base["compagnie"] or "").strip(), "IdOffreVie": offre["IdOffre"],
        "Offre": offre["Libelle"], "DernierMois": _iso(dernier), "LibelleDernierMois": libelle_mois(dernier),
        "MoisSuivant": _iso(suivant), "LibelleMoisSuivant": libelle_mois(suivant),
    }


def message_fichier_exige(effet):
    return (f"Mois suivant de la police : importez l'état des cotisations de {libelle_mois(effet)} reçu du souscripteur, "
            "chaque mois se renouvelle avec son fichier.")


def message_renouvellement(etat):
    return (f"{etat['Offre']} : chaque mois se renouvelle avec l'état des cotisations reçu du souscripteur. Importez l'état de "
            f"{etat['LibelleMoisSuivant']} dans l'écran Vie (bouton « Importer l'état de {etat['LibelleMoisSuivant']} »).")


def verifier_etat_avant_confirmation(cursor, id_devis):
    """Devis d'état des cotisations sans salarié (devis de renouvellement qui n'aurait recopié que le total du mois précédent) :
    pas de confirmation avant l'import de l'état du mois. ValueError sinon (message affiché par l'écran)."""
    if not vie_offres.tables_presentes(cursor):
        return
    cursor.execute("SELECT idproduit, dateeffet::date FROM stddevis WHERE iddevis = %s", [id_devis])
    ligne = cursor.fetchone()
    if not ligne or ligne[0] != 10 or vie_offres.offre_du_devis(cursor, id_devis)["Saisie"] != vie_offres.SAISIE_COTISATION:
        return
    cursor.execute("SELECT 1 FROM lephare_vie_cotisant WHERE iddevis = %s LIMIT 1", [id_devis])
    if not cursor.fetchone():
        raise ValueError(f"État des cotisations de {libelle_mois(ligne[1])} absent : ouvrez le devis dans l'écran Vie et importez le "
                         "fichier du mois avant de le confirmer.")


# ------------------------------------------------------------------ enregistrement (appelé par afa.enregistrer)
def cotisants_saisis(donnees):
    """Salariés envoyés par l'écran, contrôlés comme à l'import ; ErreurAfa au premier problème bloquant."""
    cotisants, matricules = [], {}
    for rang, c in enumerate(donnees.get("Cotisants") or [], 1):
        ligne = {"Rang": rang, "Matricule": _texte(c.get("Matricule"), 30), "Nom": _texte(c.get("Nom"), 100),
                 "Prenoms": _texte(c.get("Prenoms"), 150),
                 "Observation": re.sub(r"\s+", " ", str(c.get("Observation") or "")).strip()[:200]}
        libelle = f"Salarié {rang}{' - ' + ligne['Nom'] if ligne['Nom'] else ''}"
        try:
            ligne["CotisationSalarie"] = _montant(c.get("CotisationSalarie"))
            ligne["CotisationEmployeur"] = _montant(c.get("CotisationEmployeur"))
        except ValueError as erreur:
            raise ErreurAfa(f"{libelle} : {erreur}.") from erreur
        erreurs, _ = controler_ligne(ligne)
        if erreurs:
            raise ErreurAfa(f"{libelle} : {erreurs[0][0].lower()}{erreurs[0][1:]}")
        ligne["CotisationSalarie"] = ligne["CotisationSalarie"] or Decimal(0)
        ligne["CotisationEmployeur"] = ligne["CotisationEmployeur"] or Decimal(0)
        if ligne["Matricule"]:
            if ligne["Matricule"] in matricules:
                raise ErreurAfa(f"{libelle} : matricule {ligne['Matricule']} déjà saisi pour le salarié {matricules[ligne['Matricule']]}.")
            matricules[ligne["Matricule"]] = rang
        cotisants.append(ligne)
    if not cotisants:
        raise ErreurAfa("Ajoutez au moins un salarié, ou importez l'état des cotisations.")
    if not any(c["CotisationSalarie"] or c["CotisationEmployeur"] for c in cotisants):
        raise ErreurAfa("Aucune cotisation dans cet état : le total du mois est nul, il n'y a rien à enregistrer.")
    return cotisants


def controler_periode(offre, entete):
    """État mensuel : du 1er au dernier jour d'un même mois."""
    if offre["Periodicite"] != "MENSUELLE":
        return
    effet, echeance = entete["DateEffet"], entete["DateExpiration"]
    if effet.day != 1 or echeance != fin_de_mois(effet):
        raise ErreurAfa(f"{offre['Libelle']} : l'état couvre un mois entier, du 1er au dernier jour "
                        f"(du {effet:%d/%m/%Y} au {fin_de_mois(effet.replace(day=1)):%d/%m/%Y} pour {libelle_mois(effet)}).")


def ecrire_cotisants(cursor, id_devis, offre, cotisants, id_offre_detail, id_tarif):
    """Ligne de détail unique du devis (total des cotisations, sous-garantie de l'offre) et salariés de l'état."""
    total = sum((c["CotisationSalarie"] + c["CotisationEmployeur"] for c in cotisants), Decimal(0))
    libelle = f"{offre['Libelle'].upper()} - {len(cotisants)} SALARIE{'S' if len(cotisants) > 1 else ''}"[:100]
    cursor.execute("SELECT dateeffet::date FROM stddevis WHERE iddevis = %s", [id_devis])
    effet = cursor.fetchone()[0]
    cursor.execute(
        """
        INSERT INTO stddevisdetail (iddevis, idoffre, idtarif, vehicule, idusage, codeusage, reference, idcarrosserie,
            puissancefiscale, nombreplace, chargeutile, valeurneuve, valeurvenale, valeuraccessoire, remorque, conducteur,
            adressecnd, datemec, datemutation, nummoteur, numchassis, typevehicule, idmarque, matricule, carteverte, essence,
            numpccnd, tauxreduction, primeimposee, primeannuelle, primenette, taxeenregistrement, sexe, observation)
        VALUES (%s, %s, %s, 0, 0, '000', '000', 0, 0, 0, 0, 0, 0, 0, FALSE, %s, '', %s, %s, '', '', '', 0, '', FALSE, 0,
            '', 0, TRUE, %s, %s, 0, '', %s)
        RETURNING iddevisdetail
        """,
        [id_devis, id_offre_detail, id_tarif, libelle, effet, effet, total, total, libelle_mois(effet)[:100]],
    )
    id_detail = cursor.fetchone()[0]
    cursor.execute(
        """
        INSERT INTO stddevisdetgarantie (iddevisdet, idgarantie, acquise, taxe, capital, tauxfranchise, minfranchise,
            maxfranchise, franchise, textefranchise, primeannuelle, primenette, old_acquise, old_primenette)
        VALUES (%s, %s, TRUE, 0, 0, 0, 0, 0, 0, 'NEANT', %s, %s, '1', %s)
        """,
        [id_detail, offre["IdGarantie"], total, total, total],
    )
    cursor.executemany(
        """INSERT INTO lephare_vie_cotisant (iddevis, ordre, matricule, nom, prenoms, cotisation_salarie, cotisation_employeur, observation)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        [[id_devis, c["Rang"], c["Matricule"], c["Nom"], c["Prenoms"], c["CotisationSalarie"], c["CotisationEmployeur"], c["Observation"]]
         for c in cotisants],
    )
    return total


def lire_cotisants(cursor, id_devis):
    if not vie_offres.tables_presentes(cursor):
        return []
    cursor.execute(
        """SELECT matricule, nom, prenoms, cotisation_salarie, cotisation_employeur, observation FROM lephare_vie_cotisant
           WHERE iddevis = %s ORDER BY ordre, id""",
        [id_devis],
    )
    return [{"Matricule": m, "Nom": n, "Prenoms": p, "CotisationSalarie": _nombre(s), "CotisationEmployeur": _nombre(e), "Observation": o}
            for m, n, p, s, e, o in cursor.fetchall()]


def modele_classeur():
    classeur = Workbook()
    feuille = classeur.active
    feuille.title = "COTISATIONS"
    feuille["A1"] = "ASSURANCE RETRAITE COMPLEMENTAIRE"
    feuille["A2"] = "ETAT DES COTISATIONS DU MOIS DE JANVIER 2026"
    for cellule in ("A1", "A2"):
        feuille[cellule].font = Font(bold=True, size=13)
    remplissage = PatternFill("solid", fgColor="EDE9FE")
    for colonne, intitule in enumerate(ENTETES_MODELE, 1):
        cellule = feuille.cell(4, colonne, intitule)
        cellule.font = Font(bold=True)
        cellule.fill = remplissage
        cellule.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        feuille.column_dimensions[cellule.column_letter].width = {1: 6, 2: 14, 3: 22, 4: 30, 8: 28}.get(colonne, 18)
    feuille.cell(5, 1, 1)
    feuille.cell(5, 7, "=E5+F5")
    feuille.cell(7, 1, "Montant Total").font = Font(bold=True)
    for colonne, lettre in ((5, "E"), (6, "F"), (7, "G")):
        feuille.cell(7, colonne, f"=SUM({lettre}5:{lettre}6)").number_format = "#,##0"
        for ligne in (5, 6):
            feuille.cell(ligne, colonne).number_format = "#,##0"
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
        return Response({"error": "Joignez l'état Excel des cotisations."}, status=status.HTTP_400_BAD_REQUEST)
    if fichier.size > TAILLE_FICHIER_MAX:
        return Response({"error": "Fichier trop volumineux (5 Mo au plus)."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        return Response(analyser(fichier.read(), getattr(fichier, "name", "") or ""))
    except ErreurAfa as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def precedent(request):
    try:
        id_client = int(request.query_params.get("client") or 0)
        exclure = int(request.query_params.get("devis") or 0)
        avant = _date(request.query_params.get("avant"))
    except ValueError:
        return Response({"error": "Paramètres illisibles."}, status=status.HTTP_400_BAD_REQUEST)
    with connection.cursor() as cursor:
        return Response({"Etat": etat_precedent(cursor, id_client, avant, exclure)})


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def renouveler(request, idcontrat):
    """Mois suivant d'une police d'état des cotisations : souscripteur, compagnie, offre et mois à importer (écran Vie)."""
    from .renouvellement import ErreurRenouvellement, _contrat_base

    with connection.cursor() as cursor:
        try:
            etat = etat_mensuel_de_police(cursor, _contrat_base(cursor, idcontrat))
        except ErreurRenouvellement as erreur:
            return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    if not etat:
        return Response({"error": "Cette police n'est pas renouvelée par un état mensuel des cotisations."}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"EtatMensuel": etat})


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def modele(request):
    reponse = HttpResponse(modele_classeur(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    reponse["Content-Disposition"] = 'attachment; filename="modele_etat_cotisations_retraite.xlsx"'
    return reponse
