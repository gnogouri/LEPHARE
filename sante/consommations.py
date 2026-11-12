"""
Suivi des consommations santé (mission OREOLE SANTÉ du 2026-11-05) : relevés du gestionnaire MCI CARE, droits, plafonds, soldes, statistiques,
contrôles et détection des anomalies (cas de fraude possibles ; « fraude » renommée « anomalie » à l'écran le 2026-11-11).

Règles établies sur les relevés d'OREOLE (rapport d'analyse OREOLE SANTÉ - LE PHARE 2026) :
- une ligne = une prestation, NUMERO_PREST unique ; les relevés sont cumulatifs : une prestation déjà connue n'est jamais réimportée ni écrasée,
  un montant changé est noté comme écart ;
- BASE_DECOMPTEE = MT_RECLAME - EXCLUSION - DEPASSEMENT ; MT_REMBOURSE = BASE x (1 - TICKET_MODERATEUR / 100), ramené au plafond de l'acte ;
- date de soins postérieure à la clôture avec un jour au plus 12 : jour et mois inversés à l'export, date retenue corrigée, date d'origine gardée ;
- statut A = assuré principal (matricule bénéficiaire = matricule assuré), C = conjoint, E = enfant ;
- plafond annuel par famille, dentaire par an et par personne, optique par personne tous les 2 ans (barème du collège, lephare_sante_college).
Détection de fraude : dix règles qui produisent des signaux à instruire, jamais une décision automatique.

Routes /api/consommations/* (sante/urls.py) ; droits consommations.view, consommations.import, consommations.fraude.
"""

import datetime as dt
import io
import logging
import re
import unicodedata
from zipfile import BadZipFile
from collections import Counter, defaultdict
from decimal import Decimal

from django.db import DatabaseError, connection, transaction
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from autorisations.rbac import a_le_droit
from production.renouvellement import AUTHENTIFICATION, _lignes

logger = logging.getLogger(__name__)

ZERO = Decimal("0")
TAILLE_MAX = 25 * 1024 * 1024
STATUTS = {"A": "Assuré principal", "C": "Conjoint", "E": "Enfant"}
SEUIL_BONS, SEUIL_PHARMACIE, SEUIL_PLAFOND = 15, Decimal("200000"), Decimal("0.8")
CARENCES = {"MATERNITE": 9, "OPTIQUE": 10}
CARENCE_DEFAUT = 3
DECISIONS = {"A_INSTRUIRE": "À instruire", "JUSTIFIE": "Justifié", "FRAUDE": "Anomalie avérée", "SANS_SUITE": "Sans suite"}

# Relevé de prestations : en-tête du gestionnaire -> colonne ; obligatoires marquées True
COLONNES_PRESTATIONS = {
    "NUMERO_PREST": ("numero_prest", True), "DATE_CLOTURE": ("date_cloture", True), "NUMERO_GARANT": ("numero_garant", False), "GARANT": ("garant", False),
    "SOUSCRIPTEUR": ("souscripteur", False), "NPOL": ("npol", False), "POLICE": ("police", False), "LIBELLE_COLLEGE": ("college", False),
    "MATRICULE_BENEFICIAIRE": ("matricule_beneficiaire", True), "BENEFICIAIRE": ("beneficiaire_brut", False), "NOM ET PRENOMS BENEFICIAIRE": ("beneficiaire", False),
    "STATUT": ("statut", False), "DATE_NAISSANCE": ("date_naissance", False), "MATRICULE_ASSURE": ("matricule_assure", True), "ASSURE": ("assure_brut", False),
    "NOM ET PRENOMS ASSURE": ("assure", False), "CENTRE_PRESCRIPTEUR": ("centre_prescripteur", False), "CODE": ("code_centre", False),
    "CENTRE_EXECUTANT": ("centre_executant", False), "FAMILLE_PRESTATION": ("famille", True), "ACTES": ("acte", False), "MEDECIN": ("medecin", False),
    "DATE_SOINS": ("date_soins", True), "DATE_RECEPTION": ("date_reception", False), "TYPE": ("type", False), "MT_RECLAME": ("mt_reclame", True),
    "BASE_DECOMPTEE": ("base_decomptee", False), "TICKET_MODERATEUR": ("ticket_moderateur", False), "EXCLUSION": ("exclusion", False),
    "DEPASSEMENT": ("depassement", False), "MT_REMBOURSE": ("mt_rembourse", True),
}
COLONNES_EFFECTIF = {
    "MATBENEF": ("matricule_beneficiaire", True), "MATASSURE": ("matricule_assure", True),
    # en-têtes des relevés repris dans les effectifs d'OREOLE (ANALYSE DES SORTANT, feuille BASE EFFECTIF PRECEDENT)
    "MATRICULE_BENEFICIAIRE": ("matricule_beneficiaire", False), "MATRICULE_ASSURE": ("matricule_assure", False),
    "GARANT": ("garant", False), "POLICE": ("police", False),
    "COLLEGE": ("college", False), "NOM BENEFICIARE": ("nom", False), "NOM BENEFICIAIRE": ("nom", False), "PRENOM BENEFICIAIRE": ("prenoms", False),
    "STATUT": ("statut", True), "GENRE": ("genre", False), "DATE NAIS": ("date_naissance", False), "DATE EFFET": ("date_effet", False),
    "DATE SORTIE": ("date_sortie", False),
}
# État des cotisations d'OREOLE (feuille DONNER de l'ETAT) : une ligne par entreprise ; colonnes reconnues par le début de l'en-tête
COLONNES_COTISATIONS = [
    ("entreprise", ("ENTREPRISES",)), ("effectif", ("EFFECTIFS",)), ("options", ("OPTIONS",)), ("prime_ht", ("PRIMES HT PAR ENTREPRISE",)),
    ("prime_ttc", ("PRIMES TTC",)), ("prime_ia", ("PRIMES IA",)), ("prime_afa", ("PRIMES AFA",)),
    ("cotisation_pure", ("COTISATIONS SANTE PURE", "COTISATION SANTE PURE")), ("honoraires", ("HONORAIRES",)), ("commissions", ("COMMISSIONS",)),
    ("apporteurs", ("APPORTEURS",)), ("provision", ("PROVISIONS POUR PAIEMENT", "PROVISION POUR PAIEMENT")),
]
MONTANTS_COTISATIONS = ("prime_ht", "prime_ttc", "prime_ia", "prime_afa", "cotisation_pure", "honoraires", "commissions", "apporteurs", "provision")
SEUIL_ALERTE_PROVISION = Decimal("0.8")
DATES = {"date_cloture", "date_naissance", "date_soins", "date_reception", "date_effet", "date_sortie"}
MONTANTS = {"mt_reclame", "base_decomptee", "ticket_moderateur", "exclusion", "depassement", "mt_rembourse"}
ENTIERS = {"numero_prest", "numero_garant", "npol", "matricule_beneficiaire", "matricule_assure"}

REGLES_FRAUDE = {
    "F01": ("Doublon de facturation", 5, "Même bénéficiaire, date de soins, acte, centre et montant qu'une autre prestation."),
    "F02": ("Acte répété en moins de 15 jours", 2, "Même bénéficiaire, même famille et même acte à moins de 15 jours (consultation, biologie, imagerie, optique, dentaire)."),
    "F03": ("Soins d'une personne non couverte", 4, "Bénéficiaire absent de l'effectif du gestionnaire, ou sorti avant les soins."),
    "F04": ("Soins avant la date d'effet", 4, "Date de soins antérieure à l'adhésion du bénéficiaire."),
    "F05": ("Acte incohérent avec le profil", 4, "Maternité pour un homme ou pour un enfant (statut E)."),
    "F06": ("Nomadisme médical", 3, "Au moins deux consultations le même jour dans des centres différents."),
    "F07": ("Fractionnement de facture", 3, "Au moins trois prestations de la même famille, le même jour, dans le même centre, pour le même bénéficiaire."),
    "F08": ("Montant atypique", 2, "Montant réclamé d'au moins trois fois le montant médian du même acte, et d'au moins 50 000 F."),
    "F09": ("Fréquence anormale", 2, "Au moins cinq consultations dans le même mois pour un bénéficiaire."),
    "F10": ("Identité partagée", 4, "Bénéficiaire rattaché à plusieurs assurés principaux dans les relevés."),
}
SANS_ACCENT_SQL = "UPPER(translate(%s, 'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouuucAAAEEEEIIOOUUUC'))"
FAMILLES_REPETITION = ("CONSULTATION", "BIOLOGIE", "IMAGERIE & EXAMENS SPECIALISES", "OPTIQUE", "DENTAIRE")
NIVEAU_ELEVE, NIVEAU_MOYEN = 15, 8


class ErreurConsommation(Exception):
    """Saisie ou fichier refusé : message affiché tel quel."""


# ------------------------------------------------------------------ outils
def normaliser(texte):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKD", str(texte or "")).encode("ascii", "ignore").decode("ascii").upper()).strip()


def lire_date(valeur):
    if isinstance(valeur, dt.datetime):
        return valeur.date()
    if isinstance(valeur, dt.date):
        return valeur
    if isinstance(valeur, str):
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
            try:
                return dt.datetime.strptime(valeur.strip()[:10], fmt).date()
            except ValueError:
                pass
    return None


def lire_montant(valeur):
    if isinstance(valeur, bool) or valeur in (None, ""):
        return ZERO
    try:
        return Decimal(str(valeur).replace(" ", "").replace(",", "."))
    except Exception:
        return ZERO


def lire_entier(valeur):
    try:
        return int(Decimal(str(valeur).strip()))
    except Exception:
        return None


def date_retenue(soins, cloture):
    """Date de soins postérieure à la clôture, jour au plus 12 : inversion jour/mois de l'export ; sinon la date telle quelle."""
    if soins and cloture and soins > cloture and soins.day <= 12:
        try:
            inverse = dt.date(soins.year, soins.day, soins.month)
        except ValueError:
            return soins
        if inverse <= cloture:
            return inverse
    return soins


def _nombre(v):
    return float(v) if v is not None else 0.0


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


# ------------------------------------------------------------------ lecture des fichiers
def _ligne_xls(livre, feuille, rang):
    """Ligne d'une feuille .xls comme openpyxl la rendrait : dates en datetime, nombres entiers sans « .0 » (matricules), vides à None."""
    import xlrd

    valeurs = []
    for cellule in feuille.row(rang):
        if cellule.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
            valeurs.append(None)
        elif cellule.ctype == xlrd.XL_CELL_DATE:
            try:
                valeurs.append(xlrd.xldate_as_datetime(cellule.value, livre.datemode))
            except (ValueError, OverflowError):
                valeurs.append(None)
        elif cellule.ctype == xlrd.XL_CELL_NUMBER:
            valeurs.append(int(cellule.value) if float(cellule.value).is_integer() else cellule.value)
        else:
            valeurs.append(cellule.value)
    return tuple(valeurs)


def _classeur(contenu):
    """(titre, lignes) de chaque feuille. Effectifs du gestionnaire aussi en ancien format Excel 97 (.xls, modèles EFFECTIF OREOLE et
    EFFECTIF OREOLE CGA reçus le 2026-11-11), lus par xlrd ; sinon classeur .xlsx (openpyxl)."""
    if contenu[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        import xlrd

        try:
            livre = xlrd.open_workbook(file_contents=contenu)
        except Exception as erreur:  # xlrd lève des erreurs propres à chaque défaut du fichier
            raise ErreurConsommation("Fichier .xls illisible : enregistrez-le de nouveau depuis Excel, en .xlsx ou en .xls.") from erreur
        for feuille in livre.sheets():
            yield feuille.name, iter([_ligne_xls(livre, feuille, i) for i in range(feuille.nrows)])
        return
    try:
        classeur = load_workbook(io.BytesIO(contenu), data_only=True, read_only=True)
    except (InvalidFileException, BadZipFile, KeyError, OSError, ValueError) as erreur:
        raise ErreurConsommation("Fichier illisible : un classeur Excel (.xlsx ou .xls) est attendu.") from erreur
    for feuille in classeur.worksheets:
        yield feuille.title, feuille.iter_rows(values_only=True)


def _feuilles(contenu):
    for titre_feuille, lignes in _classeur(contenu):
        tete = []
        for _rang in range(15):
            try:
                ligne = next(lignes)
            except StopIteration:
                break
            noms = [normaliser(v) for v in ligne]
            if "NUMERO_PREST" in noms or "MATBENEF" in noms or "MATRICULE_BENEFICIAIRE" in noms or _est_cotisations(noms):
                tete = noms
                break
        if not tete:
            continue
        if _est_cotisations(tete):
            yield titre_feuille, "COTISATIONS", tete, lignes
            continue
        # Effectifs des analyses d'OREOLE (BASE UNIFIEE, BASE EFFECTIF PRECEDENT / ACTUEL de l'ANALYSE DES SORTANT) : avec la colonne PERIODE,
        # les lignes EXERCICE PRECEDENT forment l'effectif de référence des mouvements et les lignes EXERCICE ACTUEL l'effectif courant ; une
        # feuille d'effectif nommée « ... PRECEDENT » est l'effectif de référence ; une base de travail (colonne SOURCE) sans PERIODE est ignorée
        if "NUMERO_PREST" in tete:
            nature = "PRESTATIONS"
        elif "PERIODE" in tete:
            nature = "EFFECTIF_PERIODES"
        elif "SOURCE" in tete:
            nature = None
        else:
            nature = "EFFECTIF_PRECEDENT" if "PRECEDENT" in normaliser(titre_feuille) else "EFFECTIF"
        if nature:
            yield titre_feuille, nature, tete, lignes


def _est_cotisations(noms):
    """En-tête de l'état des cotisations : ENTREPRISES, une cotisation et une provision. Ni la feuille nominative de l'état, ni la feuille de
    pilotage (CONTRÔLE DE GESTION, colonne CONSOMMATION) : la consommation est celle des relevés importés."""
    return ("ENTREPRISES" in noms and any(n.startswith("COTISATION") for n in noms) and any(n.startswith("PROVISION") for n in noms)
            and not any(n.startswith("CONSOMMATION") for n in noms))


def _lire_cotisations(tete, lignes):
    index = {}
    for cle, prefixes in COLONNES_COTISATIONS:
        for i, nom in enumerate(tete):
            if i not in index.values() and any(nom.startswith(prefixe) for prefixe in prefixes):
                index[cle] = i
                break
    if not {"entreprise", "cotisation_pure", "provision"} <= set(index):
        return None
    cotisations = {}
    for ligne in lignes:
        valeurs = list(ligne) + [None] * len(tete)
        entreprise = " ".join(str(valeurs[index["entreprise"]] or "").split())[:150]
        if not entreprise or normaliser(entreprise).startswith("TOTAL"):
            continue
        c = {"entreprise": entreprise, "effectif": lire_entier(valeurs[index["effectif"]]) if "effectif" in index else None,
             "options": str(valeurs[index["options"]] or "").strip()[:30] if "options" in index else ""}
        for cle in MONTANTS_COTISATIONS:
            c[cle] = lire_montant(valeurs[index[cle]]) if cle in index else ZERO
        if c["cotisation_pure"] or c["provision"]:
            cotisations.setdefault(normaliser(entreprise), c)
    return list(cotisations.values())


def _convertir(tete, ligne, colonnes):
    brut = {}
    for nom, valeur in zip(tete, ligne):
        if nom in colonnes and valeur not in (None, ""):
            cle = colonnes[nom][0]
            brut.setdefault(cle, valeur)
    sortie = {}
    for cle, valeur in brut.items():
        if cle in DATES:
            # 1900 et avant : cellule vide ou zéro d'Excel (DATE SORTIE au 02/01/1900 des bases d'OREOLE), pas une date
            jour = lire_date(valeur)
            sortie[cle] = jour if jour and jour.year > 1900 else None
        elif cle in MONTANTS:
            sortie[cle] = lire_montant(valeur)
        elif cle in ENTIERS:
            sortie[cle] = lire_entier(valeur)
        else:
            sortie[cle] = str(valeur).strip()[:200]
    return sortie


def lire_fichier(contenu):
    """Prestations et effectif lus dans toutes les feuilles reconnues ; aucune écriture."""
    return _lire(contenu)[:4]


def _lire(contenu):
    """Prestations, effectif, feuilles, colonnes manquantes, état des cotisations et effectif de l'exercice précédent du classeur ; aucune écriture."""
    prestations, effectif, feuilles, manquantes, cotisations, precedent = {}, {}, [], [], [], {}
    for titre, nature, tete, lignes in _feuilles(contenu):
        if nature == "COTISATIONS":
            lues = _lire_cotisations(tete, lignes)
            if lues is None:
                manquantes.append(f"{titre} : ENTREPRISES, COTISATIONS SANTE PURE, PROVISIONS POUR PAIEMENT")
                continue
            connues = {normaliser(c["entreprise"]) for c in cotisations}
            cotisations.extend(c for c in lues if normaliser(c["entreprise"]) not in connues)
            feuilles.append({"Feuille": titre, "Nature": nature, "Lignes": len(lues)})
            continue
        colonnes = COLONNES_PRESTATIONS if nature == "PRESTATIONS" else COLONNES_EFFECTIF
        # colonne obligatoire : présente sous l'un de ses noms (MATBENEF ou MATRICULE_BENEFICIAIRE...)
        absentes = [nom for nom, (champ, obligatoire) in colonnes.items()
                    if obligatoire and not any(autre in tete for autre, (champ_autre, _o) in colonnes.items() if champ_autre == champ)]
        if absentes:
            manquantes.append(f"{titre} : {', '.join(absentes)}")
            continue
        nombre = 0
        # matricules bénéficiaires présents sur plusieurs lignes de la feuille : la première est gardée, les autres sont signalées
        # (contrôle Q01 de la qualité de l'effectif, consommations_qualite.py)
        doublons = Counter()
        periode = tete.index("PERIODE") if nature == "EFFECTIF_PERIODES" else None
        for ligne in lignes:
            l = _convertir(tete, ligne, colonnes)
            if nature == "PRESTATIONS":
                if not l.get("numero_prest") or not l.get("matricule_beneficiaire"):
                    continue
                l["beneficiaire"] = l.get("beneficiaire") or l.get("beneficiaire_brut") or ""
                l["assure"] = l.get("assure") or l.get("assure_brut") or ""
                l["date_soins_retenue"] = date_retenue(l.get("date_soins"), l.get("date_cloture"))
                prestations.setdefault(l["numero_prest"], l)
            else:
                if not l.get("matricule_beneficiaire"):
                    continue
                cible = precedent if nature == "EFFECTIF_PRECEDENT" else effectif
                if periode is not None:
                    exercice_ligne = normaliser(ligne[periode] if periode < len(ligne) else "")
                    cible = precedent if "PRECEDENT" in exercice_ligne else effectif if "ACTUEL" in exercice_ligne else None
                    if cible is None:
                        continue
                if l["matricule_beneficiaire"] in cible:
                    doublons[l["matricule_beneficiaire"]] += 1
                cible.setdefault(l["matricule_beneficiaire"], l)
            nombre += 1
        feuille_lue = {"Feuille": titre, "Nature": nature, "Lignes": nombre}
        if doublons:
            sources = {**precedent, **effectif}
            feuille_lue["Doublons"] = [{"Matricule": m, "Lignes": n + 1, "Entreprise": (sources.get(m) or {}).get("police", "")} for m, n in sorted(doublons.items())]
        feuilles.append(feuille_lue)
    if not feuilles:
        raise ErreurConsommation("Aucune feuille reconnue : il faut un relevé de prestations (colonne NUMERO_PREST), un effectif du gestionnaire "
                                 "(colonne MATBENEF) ou l'état des cotisations (colonnes ENTREPRISES, COTISATIONS SANTE PURE, PROVISIONS POUR PAIEMENT)."
                                 + (f" Colonnes obligatoires absentes : {' ; '.join(manquantes)}." if manquantes else ""))
    return prestations, effectif, feuilles, manquantes, cotisations, precedent


def exercice_du_fichier(nom_fichier, prestations=None):
    """Exercice d'un état : année citée dans le nom du fichier (ETAT 2026), sinon année des clôtures, sinon l'année en cours."""
    trouve = re.search(r"(20\d\d)", str(nom_fichier or ""))
    if trouve:
        return int(trouve.group(1))
    annees = [p["date_cloture"].year for p in (prestations or {}).values() if p.get("date_cloture")]
    return max(annees) if annees else dt.date.today().year


def analyser(contenu, cursor, nom_fichier="", exercice=None):
    prestations, effectif, feuilles, manquantes, cotisations, precedent = _lire(contenu)
    connues, ecarts = set(), 0
    if prestations:
        cursor.execute("SELECT numero_prest, mt_reclame, mt_rembourse FROM lephare_sante_prestation WHERE numero_prest = ANY(%s)", [list(prestations)])
        for num, reclame, rembourse in cursor.fetchall():
            connues.add(num)
            p = prestations[num]
            if p.get("mt_reclame", ZERO) != reclame or p.get("mt_rembourse", ZERO) != rembourse:
                ecarts += 1
    clotures = [p["date_cloture"] for p in prestations.values() if p.get("date_cloture")]
    return {
        "Feuilles": feuilles, "ColonnesManquantes": manquantes, "Prestations": len(prestations), "Nouvelles": len(prestations) - len(connues), "Connues": len(connues),
        "MontantsChanges": ecarts, "DatesCorrigees": sum(1 for p in prestations.values() if p.get("date_soins_retenue") != p.get("date_soins")),
        "Effectif": len(effectif), "SortisDates": sum(1 for e in effectif.values() if e.get("date_sortie")), "EffectifPrecedent": len(precedent),
        "Garants": sorted({p.get("garant", "") for p in prestations.values()} | {e.get("garant", "") for e in (*effectif.values(), *precedent.values())} - {""}),
        "ClotureDu": _iso(min(clotures)) if clotures else None, "ClotureAu": _iso(max(clotures)) if clotures else None,
        "Rembourse": _nombre(sum((p.get("mt_rembourse", ZERO) for p in prestations.values()), ZERO)),
        "Cotisations": len(cotisations), "Exercice": int(exercice or exercice_du_fichier(nom_fichier, prestations)),
        "Provisions": _nombre(sum((c["provision"] for c in cotisations), ZERO)),
    }, prestations, effectif, cotisations, precedent


CHAMPS_PRESTATION = ["numero_prest", "date_cloture", "numero_garant", "garant", "souscripteur", "npol", "police", "college", "matricule_beneficiaire", "beneficiaire",
                     "statut", "date_naissance", "matricule_assure", "assure", "centre_prescripteur", "code_centre", "centre_executant", "famille", "acte", "medecin",
                     "date_soins", "date_soins_retenue", "date_reception", "type", "mt_reclame", "base_decomptee", "ticket_moderateur", "exclusion", "depassement", "mt_rembourse"]
# Personnes ajoutées à l'effectif depuis les contrats Oreole Santé de LE PHARE (consommations_souscriptions.py) : import tracé sous ce nom de
# fichier, sans date de situation ; il ne date pas l'effectif courant et un effectif du gestionnaire ne fait pas sortir ces personnes
SOURCE_SOUSCRIPTIONS = "Souscriptions Oreole Santé - LE PHARE"
# Journal d'audit : matricules bénéficiaires en double d'un fichier d'effectif importé (objet = relevé)
ACTION_DOUBLONS = "consommations.import.doublons"
CHAMPS_EFFECTIF = ["matricule_beneficiaire", "matricule_assure", "garant", "police", "college", "nom", "prenoms", "statut", "genre", "date_naissance", "date_effet"]
LONGUEURS = {"garant": 60, "souscripteur": 150, "police": 150, "college": 80, "beneficiaire": 200, "statut": 1, "assure": 200, "centre_prescripteur": 200, "code_centre": 30,
             "centre_executant": 200, "famille": 80, "acte": 20, "medecin": 200, "type": 5, "nom": 100, "prenoms": 150, "genre": 1}


def _valeur(l, champ):
    v = l.get(champ)
    if champ in MONTANTS:
        return v if v is not None else ZERO
    if champ in LONGUEURS:
        return str(v or "")[:LONGUEURS[champ]].upper() if champ in ("statut", "genre") else str(v or "")[:LONGUEURS[champ]]
    return v


def _situations_disponibles(cursor):
    """Migration production 0216 appliquée : effectifs gardés à leur date de situation (mouvements de l'effectif)."""
    cursor.execute("SELECT to_regclass('public.lephare_sante_effectif_situation') IS NOT NULL")
    return bool(cursor.fetchone()[0])


def _nouveau_releve(cursor, user, nature, fichier, garants, lignes, resume=None, situation=None):
    resume = resume or {}
    colonnes = ["nature", "fichier", "garants", "lignes", "nouvelles", "connues", "modifiees", "dates_corrigees", "cloture_du", "cloture_au", "idoperateur", "operateur"]
    operateur = ((user.get_full_name() if hasattr(user, "get_full_name") else "") or getattr(user, "email", "") or "")[:150]
    valeurs = [nature, (fichier or "")[:255], ", ".join(garants)[:150], lignes, resume.get("Nouvelles", 0), resume.get("Connues", 0), resume.get("MontantsChanges", 0),
               resume.get("DatesCorrigees", 0), resume.get("ClotureDu"), resume.get("ClotureAu"), getattr(user, "id", None), operateur]
    if situation:
        colonnes.append("situation")
        valeurs.append(situation)
    cursor.execute(f"INSERT INTO lephare_sante_releve ({', '.join(colonnes)}) VALUES ({', '.join(['%s'] * len(colonnes))}) RETURNING idreleve", valeurs)
    return cursor.fetchone()[0]


def _photographier(cursor, id_releve, effectif):
    """Bénéficiaires d'un effectif importé, gardés à sa date de situation : effectif de référence des mouvements d'une période."""
    cursor.executemany(
        """INSERT INTO lephare_sante_effectif_situation (idreleve, matricule_beneficiaire, matricule_assure, garant, police, statut)
           VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
        [[id_releve, m, e.get("matricule_assure"), _valeur(e, "garant"), _valeur(e, "police"), _valeur(e, "statut")] for m, e in effectif.items()])


def importer(contenu, nom_fichier, user, situation=None, exercice=None):
    """Import idempotent : prestation connue jamais réécrite (écart noté), effectif mis à jour. situation : date de l'effectif, datant les sorties.
    Chaque effectif est aussi gardé à sa date de situation (mouvements de l'effectif du rapport) ; un effectif plus ancien que l'effectif courant
    ne le modifie pas, il sert seulement de référence. Effectif de l'exercice précédent d'une base de travail d'OREOLE : situé au 31/12 de l'année
    précédente. État des cotisations : il remplace celui de son exercice."""
    situation = situation or dt.date.today()
    with transaction.atomic(), connection.cursor() as cursor:
        resume, prestations, effectif, cotisations, precedent = analyser(contenu, cursor, nom_fichier, exercice)
        avec_situations = _situations_disponibles(cursor)
        if (effectif or precedent) and not avec_situations:
            raise ErreurConsommation("Base de données à mettre à jour avant d'importer un effectif : migration production 0216 (mouvements de l'effectif).")
        nature = "PRESTATIONS" if prestations else ("EFFECTIF" if effectif or precedent else "COTISATIONS")
        date_precedent = dt.date(situation.year - 1, 12, 31)
        seul_precedent = bool(precedent) and not (prestations or effectif or cotisations)
        id_releve = _nouveau_releve(
            cursor, user, nature, f"{nom_fichier or ''} - exercice précédent" if seul_precedent else nom_fichier, resume["Garants"],
            len(precedent) if seul_precedent else resume["Prestations"] or resume["Effectif"] or resume["Cotisations"], resume,
            date_precedent if seul_precedent else situation if effectif else None)
        if precedent:
            garants = sorted({e.get("garant", "") for e in precedent.values()} - {""})
            id_precedent = id_releve if seul_precedent else _nouveau_releve(cursor, user, "EFFECTIF", f"{nom_fichier or ''} - exercice précédent", garants,
                                                                            len(precedent), situation=date_precedent)
            _photographier(cursor, id_precedent, precedent)
            resume["EffectifPrecedent"], resume["SituationPrecedent"] = len(precedent), _iso(date_precedent)
        if prestations:
            cursor.execute("SELECT numero_prest, mt_reclame, mt_rembourse, base_decomptee FROM lephare_sante_prestation WHERE numero_prest = ANY(%s)", [list(prestations)])
            for num, reclame, rembourse, base in cursor.fetchall():
                p = prestations.pop(num)
                for champ, ancienne in (("mt_reclame", reclame), ("mt_rembourse", rembourse), ("base_decomptee", base)):
                    if p.get(champ, ZERO) != ancienne:
                        cursor.execute("INSERT INTO lephare_sante_prestation_ecart (numero_prest, idreleve, champ, ancienne, nouvelle) VALUES (%s, %s, %s, %s, %s)",
                                       [num, id_releve, champ, str(ancienne), str(p.get(champ, ZERO))])
            colonnes = ", ".join(CHAMPS_PRESTATION + ["idreleve"])
            marques = ", ".join(["%s"] * (len(CHAMPS_PRESTATION) + 1))
            cursor.executemany(f"INSERT INTO lephare_sante_prestation ({colonnes}) VALUES ({marques}) ON CONFLICT (numero_prest) DO NOTHING",
                               [[_valeur(p, c) for c in CHAMPS_PRESTATION] + [id_releve] for p in prestations.values()])
        if effectif:
            _photographier(cursor, id_releve, effectif)
            cursor.execute("""SELECT max(COALESCE(r.situation, r.dateimport::date)) FROM lephare_sante_effectif e
                              JOIN lephare_sante_releve r ON r.idreleve = e.idreleve WHERE e.garant = ANY(%s) AND r.fichier <> %s""",
                           [sorted({_valeur(e, "garant") for e in effectif.values()}), SOURCE_SOUSCRIPTIONS])
            courant = cursor.fetchone()[0]
            if courant and situation < courant:
                # Effectif plus ancien que l'effectif courant (exercice précédent importé après coup) : référence des mouvements seulement
                resume["Sorties"], resume["Anterieur"] = 0, _iso(courant)
                effectif = {}
        if effectif:
            # Une ligne portant une DATE SORTIE est un bénéficiaire sorti à cette date ; les autres sont actifs
            colonnes = ", ".join(CHAMPS_EFFECTIF + ["actif", "date_sortie", "idreleve"])
            marques = ", ".join(["%s"] * (len(CHAMPS_EFFECTIF) + 3))
            maj = ", ".join(f"{c} = EXCLUDED.{c}" for c in CHAMPS_EFFECTIF[1:] + ["actif", "date_sortie", "idreleve"])
            cursor.executemany(f"""INSERT INTO lephare_sante_effectif ({colonnes}) VALUES ({marques})
                                   ON CONFLICT (matricule_beneficiaire) DO UPDATE SET {maj}, datemaj = now()""",
                               [[_valeur(e, c) for c in CHAMPS_EFFECTIF] + [e.get("date_sortie") is None, e.get("date_sortie"), id_releve] for e in effectif.values()])
            # Effectif complet d'un garant : les bénéficiaires actifs absents du fichier sont sortis à la date de situation de l'effectif
            # (seulement si le fichier reprend au moins la moitié des actifs connus de ce garant : un extrait partiel ne fait sortir personne) ;
            # les personnes ajoutées depuis les souscriptions Oreole Santé de LE PHARE et que le gestionnaire ne liste pas encore restent couvertes
            sorties = 0
            for garant in {e.get("garant", "") for e in effectif.values()}:
                cursor.execute("""SELECT matricule_beneficiaire FROM lephare_sante_effectif WHERE garant = %s AND actif
                                  AND idreleve NOT IN (SELECT idreleve FROM lephare_sante_releve WHERE fichier = %s)""", [garant, SOURCE_SOUSCRIPTIONS])
                actifs = {m for (m,) in cursor.fetchall()}
                presents = {m for m, e in effectif.items() if e.get("garant", "") == garant}
                absents = list(actifs - presents)
                if absents and len(presents & actifs) >= len(actifs) / 2:
                    cursor.execute("UPDATE lephare_sante_effectif SET actif = FALSE, date_sortie = %s, datemaj = now() WHERE matricule_beneficiaire = ANY(%s)",
                                   [situation, absents])
                    sorties += len(absents)
            resume["Sorties"] = sorties
        if cotisations:
            # Un état des cotisations remplace celui de son exercice
            cursor.execute("DELETE FROM lephare_sante_cotisation WHERE exercice = %s", [resume["Exercice"]])
            colonnes = ["exercice", "entreprise", "effectif", "options", *MONTANTS_COTISATIONS, "idreleve"]
            cursor.executemany(
                f"INSERT INTO lephare_sante_cotisation ({', '.join(colonnes)}) VALUES ({', '.join(['%s'] * len(colonnes))})",
                [[resume["Exercice"], c["entreprise"], c["effectif"], c["options"], *[c[m] for m in MONTANTS_COTISATIONS], id_releve] for c in cotisations],
            )
        doublons = [d for f in resume["Feuilles"] for d in f.get("Doublons", [])]
        if doublons:
            # Gardés au journal d'audit de l'import : le rapport et l'écran des contrôles les relisent (aucune colonne libre dans les relevés)
            from autorisations.journal import journaliser

            journaliser(utilisateur=user, module="consommations", action=ACTION_DOUBLONS, objet_type="releve_sante", objet_id=id_releve,
                        description=f"Import {nom_fichier or ''} : {len(doublons)} matricule(s) bénéficiaire(s) en double, première ligne gardée",
                        details={"Doublons": doublons[:500], "Fichier": nom_fichier or ""})
            resume["MatriculesEnDouble"] = len(doublons)
        resume["IdReleve"] = id_releve
        return resume


# ------------------------------------------------------------------ chargement commun
def _charger(cursor, condition="TRUE", parametres=()):
    return _lignes(cursor, f"""
        SELECT p.*, e.statut AS statut_effectif, e.genre, e.date_effet, e.actif AS actif_effectif, e.date_sortie, (e.matricule_beneficiaire IS NOT NULL) AS dans_effectif,
               COALESCE(c.code_bareme, '') AS bareme
        FROM lephare_sante_prestation p
        LEFT JOIN lephare_sante_effectif e ON e.matricule_beneficiaire = p.matricule_beneficiaire
        LEFT JOIN lephare_sante_college c ON c.college = p.college
        WHERE {condition}""", list(parametres))


def _baremes(cursor):
    return {b["code"]: b for b in _lignes(cursor, "SELECT * FROM lephare_sante_bareme")}


def _exercice(cursor):
    cursor.execute("SELECT EXTRACT(YEAR FROM MAX(date_cloture))::int FROM lephare_sante_prestation")
    annee = cursor.fetchone()[0]
    return annee or dt.date.today().year


def _annee(p):
    d = p["date_soins_retenue"] or p["date_cloture"]
    return d.year if d else None


# ------------------------------------------------------------------ fraude
def detecter_fraude(prestations):
    """Signaux par prestation et score par bénéficiaire : somme des poids des règles déclenchées, au plus trois signaux comptés par règle."""
    signaux = []

    def signal(code, p, detail, montant=None):
        lib, poids, _critere = REGLES_FRAUDE[code]
        signaux.append({"Code": code, "Regle": lib, "Poids": poids, "NumeroPrestation": p["numero_prest"], "MatriculeBeneficiaire": p["matricule_beneficiaire"],
                        "MatriculeAssure": p["matricule_assure"], "Beneficiaire": p["beneficiaire"], "Police": p["police"], "Date": _iso(p["date_soins_retenue"]),
                        "Famille": p["famille"], "Acte": p["acte"], "Centre": p["centre_executant"], "Detail": detail,
                        "Montant": _nombre(p["mt_rembourse"] if montant is None else montant)})

    vus, par_benef, assures = {}, defaultdict(list), defaultdict(set)
    for p in prestations:
        par_benef[p["matricule_beneficiaire"]].append(p)
        assures[p["matricule_beneficiaire"]].add(p["matricule_assure"])
        cle = (p["matricule_beneficiaire"], p["date_soins"], p["acte"], p["code_centre"], p["mt_reclame"])
        if cle in vus:
            signal("F01", p, f"Identique à la prestation {vus[cle]}.")
        else:
            vus[cle] = p["numero_prest"]
        soins = p["date_soins_retenue"]
        if not p["dans_effectif"]:
            signal("F03", p, "Inconnu de l'effectif du gestionnaire.")
        elif p["date_sortie"] and soins and soins > p["date_sortie"]:
            signal("F03", p, f"Sorti de l'effectif le {p['date_sortie']:%d/%m/%Y}.")
        if p["date_effet"] and soins and soins < p["date_effet"]:
            signal("F04", p, f"Soins du {soins:%d/%m/%Y}, effet au {p['date_effet']:%d/%m/%Y}.")
        if p["famille"] == "MATERNITE" and (p["statut"] == "E" or p["genre"] == "M"):
            signal("F05", p, "Maternité pour " + ("un enfant." if p["statut"] == "E" else "un bénéficiaire de sexe masculin."))
    for lignes in par_benef.values():
        lignes = sorted((p for p in lignes if p["date_soins_retenue"]), key=lambda p: (p["date_soins_retenue"], p["numero_prest"]))
        dernier = {}
        for p in lignes:
            cle = (p["famille"], p["acte"])
            avant = dernier.get(cle)
            if (avant and p["famille"] in FAMILLES_REPETITION and 0 <= (p["date_soins_retenue"] - avant["date_soins_retenue"]).days < 15
                    and not (avant["mt_reclame"] == p["mt_reclame"] and avant["code_centre"] == p["code_centre"] and avant["date_soins_retenue"] == p["date_soins_retenue"])):
                signal("F02", p, f"{(p['date_soins_retenue'] - avant['date_soins_retenue']).days} jours après la prestation {avant['numero_prest']}.")
            dernier[cle] = p
        par_jour = defaultdict(list)
        for p in lignes:
            par_jour[p["date_soins_retenue"]].append(p)
        for jour, ps in par_jour.items():
            consultations = [p for p in ps if p["famille"] == "CONSULTATION"]
            centres = {p["code_centre"] for p in consultations}
            if len(centres) >= 2:
                for p in consultations:
                    signal("F06", p, f"{len(consultations)} consultations dans {len(centres)} centres le {jour:%d/%m/%Y}.")
            groupes = defaultdict(list)
            for p in ps:
                groupes[(p["famille"], p["code_centre"])].append(p)
            for (famille, _centre), g in groupes.items():
                if len(g) >= 3:
                    for p in g:
                        signal("F07", p, f"{len(g)} prestations {famille.lower()} le même jour dans le même centre.")
        par_mois = defaultdict(list)
        for p in lignes:
            if p["famille"] == "CONSULTATION":
                par_mois[(p["date_soins_retenue"].year, p["date_soins_retenue"].month)].append(p)
        for (annee, mois), ps in par_mois.items():
            if len(ps) >= 5:
                signal("F09", ps[0], f"{len(ps)} consultations en {mois:02d}/{annee}.", montant=sum((x["mt_rembourse"] for x in ps), ZERO))
    par_acte = defaultdict(list)
    for p in prestations:
        if p["mt_reclame"] > 0:
            par_acte[p["acte"]].append(p["mt_reclame"])
    medianes = {a: sorted(v)[len(v) // 2] for a, v in par_acte.items() if len(v) >= 20}
    for p in prestations:
        m = medianes.get(p["acte"])
        if m and p["mt_reclame"] >= 3 * m and p["mt_reclame"] >= 50000:
            signal("F08", p, f"Réclamé {p['mt_reclame']:,.0f} F pour une médiane de {m:,.0f} F (acte {p['acte']}).".replace(",", " "))
    for p in prestations:
        if len(assures[p["matricule_beneficiaire"]]) > 1:
            signal("F10", p, f"Rattaché à {len(assures[p['matricule_beneficiaire']])} assurés principaux.")
    scores = {}
    for s in signaux:
        x = scores.setdefault(s["MatriculeBeneficiaire"], {"MatriculeBeneficiaire": s["MatriculeBeneficiaire"], "Beneficiaire": s["Beneficiaire"], "MatriculeAssure": s["MatriculeAssure"],
                                                           "Police": s["Police"], "Regles": Counter(), "Montant": 0.0, "Signaux": 0})
        x["Regles"][s["Code"]] += 1
        x["Montant"] += s["Montant"]
        x["Signaux"] += 1
    for x in scores.values():
        x["Score"] = sum(REGLES_FRAUDE[c][1] * min(n, 3) for c, n in x["Regles"].items())
        x["Niveau"] = "Élevé" if x["Score"] >= NIVEAU_ELEVE else "Moyen" if x["Score"] >= NIVEAU_MOYEN else "Faible"
        x["Regles"] = dict(x["Regles"])
    return signaux, scores


def fraude(params):
    with connection.cursor() as cursor:
        signaux, scores = detecter_fraude(_charger(cursor))
        decisions = {d["matricule_beneficiaire"]: d for d in _lignes(cursor, "SELECT * FROM lephare_sante_suspicion")}
    niveau = str(params.get("niveau") or "").strip()
    instruction = str(params.get("instruction") or "").strip().upper()
    texte = normaliser(params.get("q"))
    liste = []
    for x in sorted(scores.values(), key=lambda v: (-v["Score"], -v["Montant"])):
        d = decisions.get(x["MatriculeBeneficiaire"])
        x["Instruction"] = d["statut"] if d else "A_INSTRUIRE"
        x["LibelleInstruction"] = DECISIONS[x["Instruction"]]
        x["Observation"], x["InstruitPar"], x["InstruitLe"] = (d["observation"], d["auteur"], _iso(d["datemaj"])) if d else ("", "", None)
        if niveau and x["Niveau"] != niveau:
            continue
        if instruction and x["Instruction"] != instruction:
            continue
        if texte and texte not in normaliser(f"{x['Beneficiaire']} {x['MatriculeBeneficiaire']} {x['Police']}"):
            continue
        liste.append(x)
    resume = []
    for code, (lib, poids, critere) in REGLES_FRAUDE.items():
        siens = [s for s in signaux if s["Code"] == code]
        resume.append({"Code": code, "Regle": lib, "Poids": poids, "Critere": critere, "Signaux": len(siens), "Beneficiaires": len({s["MatriculeBeneficiaire"] for s in siens}),
                       "Montant": sum(s["Montant"] for s in siens)})
    return {"Regles": resume, "Suspicions": liste[:500], "Total": len(liste), "Niveaux": dict(Counter(x["Niveau"] for x in scores.values())),
            "Instructions": dict(Counter(decisions[m]["statut"] for m in scores if m in decisions))}


def signaux_beneficiaire(matricule):
    with connection.cursor() as cursor:
        signaux, scores = detecter_fraude(_charger(cursor))
    return {"Score": scores.get(matricule), "Signaux": [s for s in signaux if s["MatriculeBeneficiaire"] == matricule]}


def instruire(matricule, donnees, user):
    statut_ = str(donnees.get("Statut") or "").strip().upper()
    if statut_ not in DECISIONS:
        raise ErreurConsommation("Choisissez la décision : à instruire, justifié, anomalie avérée ou sans suite.")
    observation = str(donnees.get("Observation") or "").strip()[:500]
    if statut_ in ("JUSTIFIE", "FRAUDE", "SANS_SUITE") and len(observation) < 5:
        raise ErreurConsommation("Précisez l'observation qui motive la décision.")
    auteur = ((user.get_full_name() if hasattr(user, "get_full_name") else "") or getattr(user, "email", "") or "")[:150]
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM lephare_sante_prestation WHERE matricule_beneficiaire = %s LIMIT 1", [matricule])
        if not cursor.fetchone():
            raise ErreurConsommation("Bénéficiaire inconnu des relevés.")
        cursor.execute("""INSERT INTO lephare_sante_suspicion (matricule_beneficiaire, statut, observation, auteur) VALUES (%s, %s, %s, %s)
                          ON CONFLICT (matricule_beneficiaire) DO UPDATE SET statut = EXCLUDED.statut, observation = EXCLUDED.observation, auteur = EXCLUDED.auteur, datemaj = now()""",
                       [matricule, statut_, observation, auteur])
    return {"Message": f"Décision enregistrée : {DECISIONS[statut_].lower()}.", "Statut": statut_}


# ------------------------------------------------------------------ fiche famille
def rechercher(texte):
    texte = str(texte or "").strip()
    if len(texte) < 2:
        return {"Lignes": []}
    # Recherche sur le nom de tout membre de la famille (sans accent), un matricule ou la police ; la famille est nommée par son assuré principal
    with connection.cursor() as cursor:
        motif = f"%{normaliser(texte)}%"
        lignes = _lignes(cursor, f"""
            WITH x AS (
                SELECT matricule_assure, matricule_beneficiaire, police, (nom || ' ' || prenoms) AS nom FROM lephare_sante_effectif
                UNION ALL SELECT matricule_assure, matricule_beneficiaire, police, beneficiaire FROM lephare_sante_prestation),
            trouves AS (
                SELECT DISTINCT matricule_assure FROM x
                WHERE CAST(matricule_assure AS text) LIKE %s OR CAST(matricule_beneficiaire AS text) LIKE %s OR {SANS_ACCENT_SQL % 'x.nom'} LIKE %s
                   OR {SANS_ACCENT_SQL % 'x.police'} LIKE %s)
            SELECT t.matricule_assure,
                   COALESCE((SELECT e.nom || ' ' || e.prenoms FROM lephare_sante_effectif e WHERE e.matricule_beneficiaire = t.matricule_assure),
                            (SELECT MAX(p.assure) FROM lephare_sante_prestation p WHERE p.matricule_assure = t.matricule_assure)) AS nom,
                   (SELECT MAX(x.police) FROM x WHERE x.matricule_assure = t.matricule_assure) AS police,
                   (SELECT COUNT(DISTINCT x.matricule_beneficiaire) FROM x WHERE x.matricule_assure = t.matricule_assure) AS beneficiaires
            FROM trouves t WHERE t.matricule_assure IS NOT NULL ORDER BY 2 LIMIT 25""", [f"%{texte}%", f"%{texte}%", motif, motif])
    return {"Lignes": [{"MatriculeAssure": l["matricule_assure"], "Nom": (l["nom"] or "").strip(), "Police": l["police"], "Beneficiaires": l["beneficiaires"]} for l in lignes]}


def _garanties(bareme):
    """Droits du barème, tels que les documents d'OREOLE les décrivent (lephare_sante_bareme)."""
    if not bareme:
        return []
    return [{"Garantie": libelle, "Plafond": _nombre(bareme[cle]), "Unite": unite} for libelle, cle, unite in (
        ("Plafond annuel toutes prestations", "plafond_annuel_famille", "par famille et par an"),
        ("Chambre d'hospitalisation", "chambre_jour", "par jour"),
        ("Ambulance", "ambulance_cas", "par cas"),
        ("Accouchement simple", "accouchement_simple", "par cas"),
        ("Accouchement gémellaire", "accouchement_gemellaire", "par cas"),
        ("Accouchement chirurgical", "accouchement_chirurgical", "par cas"),
        ("Accouchement hors structure", "accouchement_hors_structure", "par cas"),
        ("Optique adulte", "optique_adulte", "par personne tous les 2 ans"),
        ("Optique enfant", "optique_enfant", "par personne tous les 2 ans"),
        ("Dentaire", "dentaire_an_personne", "par personne et par an"),
    ) if bareme[cle]]


def fiche_famille(matricule_assure):
    with connection.cursor() as cursor:
        baremes = _baremes(cursor)
        exercice = _exercice(cursor)
        membres = _lignes(cursor, """SELECT e.*, COALESCE(c.code_bareme, '') AS bareme FROM lephare_sante_effectif e LEFT JOIN lephare_sante_college c ON c.college = e.college
                                     WHERE e.matricule_assure = %s ORDER BY CASE e.statut WHEN 'A' THEN 0 WHEN 'C' THEN 1 ELSE 2 END, e.date_naissance""", [matricule_assure])
        prestations = _charger(cursor, "p.matricule_assure = %s", [matricule_assure])
        if not membres and not prestations:
            raise ErreurConsommation("Aucun assuré principal ni aucune prestation pour ce matricule.")
        # Fraude sur l'ensemble des relevés : les médianes par acte et les rattachements multiples ne se jugent pas sur une seule famille
        tous_signaux, tous_scores = detecter_fraude(_charger(cursor))
    matricules = {m["matricule_beneficiaire"] for m in membres} | {p["matricule_beneficiaire"] for p in prestations}
    signaux = [s for s in tous_signaux if s["MatriculeBeneficiaire"] in matricules]
    scores = {m: s for m, s in tous_scores.items() if m in matricules}
    principal = next((m for m in membres if m["statut"] == "A"), membres[0] if membres else None)
    code = (principal or {}).get("bareme") or next((p["bareme"] for p in prestations if p["bareme"]), "")
    bareme = baremes.get(code)
    plafond = bareme["plafond_annuel_famille"] if bareme else None
    consomme = sum((p["mt_rembourse"] for p in prestations if _annee(p) == exercice), ZERO)
    if principal and principal["statut"] == "A":
        nom_famille = f"{principal['nom']} {principal['prenoms']}".strip()
    else:
        nom_famille = prestations[0]["assure"] if prestations else ""
    personnes = {m["matricule_beneficiaire"]: m for m in membres}
    for p in prestations:
        personnes.setdefault(p["matricule_beneficiaire"], {"matricule_beneficiaire": p["matricule_beneficiaire"], "nom": p["beneficiaire"], "prenoms": "", "statut": p["statut"],
                                                          "date_naissance": p["date_naissance"], "date_effet": None, "actif": False, "hors_effectif": True})
    lignes_membres = []
    for mat, m in personnes.items():
        siennes = [p for p in prestations if p["matricule_beneficiaire"] == mat]
        dentaire = sum((p["mt_rembourse"] for p in siennes if p["famille"] == "DENTAIRE" and _annee(p) == exercice), ZERO)
        optique = sum((p["mt_rembourse"] for p in siennes if p["famille"] == "OPTIQUE" and _annee(p) in (exercice, exercice - 1)), ZERO)
        pharmacie = sum((p["mt_rembourse"] for p in siennes if p["famille"] == "PHARMACIE" and _annee(p) == exercice), ZERO)
        plafond_dent = bareme["dentaire_an_personne"] if bareme else None
        plafond_opt = (bareme["optique_enfant"] if m.get("statut") == "E" else bareme["optique_adulte"]) if bareme else None
        lignes_membres.append({
            "Matricule": mat, "Nom": f"{m.get('nom') or ''} {m.get('prenoms') or ''}".strip(), "Statut": m.get("statut"), "Lien": STATUTS.get(m.get("statut") or "", "Non déterminé"),
            "DateNaissance": _iso(m.get("date_naissance")), "DateEffet": _iso(m.get("date_effet")), "Actif": bool(m.get("actif")), "HorsEffectif": bool(m.get("hors_effectif")),
            "DateSortie": _iso(m.get("date_sortie")), "Prestations": len(siennes), "Reclame": _nombre(sum((p["mt_reclame"] for p in siennes), ZERO)),
            "Rembourse": _nombre(sum((p["mt_rembourse"] for p in siennes), ZERO)),
            "Dentaire": _nombre(dentaire), "PlafondDentaire": _nombre(plafond_dent) if plafond_dent is not None else None,
            "SoldeDentaire": _nombre(plafond_dent - dentaire) if plafond_dent is not None else None,
            "Optique": _nombre(optique), "PlafondOptique": _nombre(plafond_opt) if plafond_opt is not None else None,
            "SoldeOptique": _nombre(plafond_opt - optique) if plafond_opt is not None else None,
            "AlerteBons": len(siennes) >= SEUIL_BONS, "AlertePharmacie": pharmacie >= SEUIL_PHARMACIE,
            "Score": (scores.get(mat) or {}).get("Score", 0), "Niveau": (scores.get(mat) or {}).get("Niveau"),
        })
    par_famille = defaultdict(lambda: [0, ZERO, ZERO])
    par_mois = defaultdict(lambda: [0, ZERO])
    for p in prestations:
        x = par_famille[p["famille"]]
        x[0] += 1
        x[1] += p["mt_reclame"]
        x[2] += p["mt_rembourse"]
        if p["date_cloture"]:
            m = par_mois[p["date_cloture"].strftime("%Y-%m")]
            m[0] += 1
            m[1] += p["mt_rembourse"]
    total = sum((p["mt_rembourse"] for p in prestations), ZERO)
    return {
        "MatriculeAssure": matricule_assure, "Nom": nom_famille, "Police": (principal or {}).get("police") or (prestations[0]["police"] if prestations else ""),
        "Garant": (principal or {}).get("garant") or (prestations[0]["garant"] if prestations else ""), "College": (principal or {}).get("college") or (prestations[0]["college"] if prestations else ""),
        "Bareme": code, "LibelleBareme": bareme["libelle"] if bareme else "Barème inconnu : collège sans correspondance",
        "Garanties": _garanties(bareme), "Carences": [{"Famille": "Maternité", "Mois": CARENCES["MATERNITE"]}, {"Famille": "Optique", "Mois": CARENCES["OPTIQUE"]},
                                                      {"Famille": "Autres prestations", "Mois": CARENCE_DEFAUT}],
        "Exercice": exercice, "Droits": {
            "PlafondAnnuel": _nombre(plafond) if plafond is not None else None, "ConsommeExercice": _nombre(consomme),
            "Taux": float(consomme / plafond) if plafond else None, "Solde": _nombre(plafond - consomme) if plafond is not None else None,
            "Situation": "Barème inconnu" if plafond is None else "Plafond dépassé" if consomme > plafond else "Alerte" if consomme >= SEUIL_PLAFOND * plafond else "Normal",
        },
        "Totaux": {"Prestations": len(prestations), "Reclame": _nombre(sum((p["mt_reclame"] for p in prestations), ZERO)), "Rembourse": _nombre(total),
                   "ResteACharge": _nombre(sum((p["mt_reclame"] - p["mt_rembourse"] for p in prestations), ZERO))},
        "Beneficiaires": lignes_membres,
        "ParFamille": [{"Famille": k, "Prestations": v[0], "Reclame": _nombre(v[1]), "Rembourse": _nombre(v[2]), "Part": float(v[2] / total) if total else 0}
                       for k, v in sorted(par_famille.items(), key=lambda kv: -kv[1][2])],
        "ParMois": [{"Mois": k, "Prestations": v[0], "Rembourse": _nombre(v[1])} for k, v in sorted(par_mois.items())],
        "Prestations": [{
            "Numero": p["numero_prest"], "DateSoins": _iso(p["date_soins_retenue"]), "DateSoinsOrigine": _iso(p["date_soins"]), "Cloture": _iso(p["date_cloture"]),
            "Beneficiaire": p["beneficiaire"], "MatriculeBeneficiaire": p["matricule_beneficiaire"], "Famille": p["famille"], "Acte": p["acte"], "Centre": p["centre_executant"],
            "Reclame": _nombre(p["mt_reclame"]), "Base": _nombre(p["base_decomptee"]), "TicketModerateur": _nombre(p["ticket_moderateur"]), "Exclusion": _nombre(p["exclusion"]),
            "Depassement": _nombre(p["depassement"]), "Rembourse": _nombre(p["mt_rembourse"]), "Type": p["type"],
        } for p in sorted(prestations, key=lambda p: (p["date_soins_retenue"] or dt.date.min, p["numero_prest"]), reverse=True)[:400]],
        "Signaux": signaux,
    }


# ------------------------------------------------------------------ statistiques et contrôles
def _filtrer(params):
    condition, valeurs = ["TRUE"], []
    for cle, colonne in (("garant", "p.garant"), ("police", "p.police")):
        v = str(params.get(cle) or "").strip()
        if v:
            condition.append(f"{colonne} = %s")
            valeurs.append(v)
    for cle, op in (("du", ">="), ("au", "<=")):
        d = lire_date(params.get(cle))
        if d:
            condition.append(f"p.date_cloture {op} %s")
            valeurs.append(d)
    return " AND ".join(condition), valeurs


def synthese(params):
    with connection.cursor() as cursor:
        condition, valeurs = _filtrer(params)
        prestations = _charger(cursor, condition, valeurs)
        cond_eff, val_eff = ["actif"], []
        for cle in ("garant", "police"):
            v = str(params.get(cle) or "").strip()
            if v:
                cond_eff.append(f"{cle} = %s")
                val_eff.append(v)
        cursor.execute(f"SELECT COUNT(*), COUNT(*) FILTER (WHERE statut = 'A') FROM lephare_sante_effectif WHERE {' AND '.join(cond_eff)}", val_eff)
        effectif, principaux = cursor.fetchone()
        polices = [l["police"] for l in _lignes(cursor, "SELECT DISTINCT police FROM lephare_sante_prestation UNION SELECT DISTINCT police FROM lephare_sante_effectif ORDER BY 1") if l["police"]]
        garants = [l["garant"] for l in _lignes(cursor, "SELECT DISTINCT garant FROM lephare_sante_prestation ORDER BY 1") if l["garant"]]
        releves = _lignes(cursor, "SELECT * FROM lephare_sante_releve ORDER BY idreleve DESC LIMIT 20")
    tot = lambda cle: sum((p[cle] for p in prestations), ZERO)  # noqa: E731
    consommants = len({p["matricule_beneficiaire"] for p in prestations})
    rembourse = tot("mt_rembourse")
    par_famille = defaultdict(lambda: [0, ZERO, ZERO])
    par_mois = defaultdict(lambda: [0, ZERO, ZERO])
    par_police = defaultdict(lambda: {"n": 0, "montant": ZERO, "consommants": set()})
    for p in prestations:
        for cle, x in ((p["famille"], par_famille), (p["date_cloture"].strftime("%Y-%m") if p["date_cloture"] else "", par_mois)):
            y = x[cle]
            y[0] += 1
            y[1] += p["mt_reclame"]
            y[2] += p["mt_rembourse"]
        z = par_police[p["police"]]
        z["n"] += 1
        z["montant"] += p["mt_rembourse"]
        z["consommants"].add(p["matricule_beneficiaire"])
    return {
        "Filtres": {"Garants": garants, "Polices": polices},
        "Indicateurs": {
            "AssuresPrincipaux": principaux, "Beneficiaires": effectif, "Polices": len({p["police"] for p in prestations}), "Prestations": len(prestations), "Consommants": consommants,
            "Reclame": _nombre(tot("mt_reclame")), "Base": _nombre(tot("base_decomptee")), "Exclusions": _nombre(tot("exclusion")), "Depassements": _nombre(tot("depassement")),
            "Rembourse": _nombre(rembourse), "TiersPayant": _nombre(sum((p["mt_rembourse"] for p in prestations if p["type"] == "TP"), ZERO)),
            "HorsTiersPayant": _nombre(sum((p["mt_rembourse"] for p in prestations if p["type"] == "HO"), ZERO)), "ResteACharge": _nombre(tot("mt_reclame") - rembourse),
            "MoyenneParAssure": _nombre(rembourse / principaux) if principaux else None, "MoyenneParBeneficiaire": _nombre(rembourse / effectif) if effectif else None,
            "CoutParConsommant": _nombre(rembourse / consommants) if consommants else None, "CoutParActe": _nombre(rembourse / len(prestations)) if prestations else None,
            "TauxRecours": consommants / effectif if effectif else None, "TauxPriseEnCharge": float(rembourse / tot("mt_reclame")) if tot("mt_reclame") else None,
        },
        "ParFamille": [{"Famille": k, "Prestations": v[0], "Reclame": _nombre(v[1]), "Rembourse": _nombre(v[2]), "Part": float(v[2] / rembourse) if rembourse else 0}
                       for k, v in sorted(par_famille.items(), key=lambda kv: -kv[1][2])],
        "ParMois": [{"Mois": k, "Prestations": v[0], "Reclame": _nombre(v[1]), "Rembourse": _nombre(v[2])} for k, v in sorted(par_mois.items()) if k],
        "TopPolices": [{"Police": k, "Prestations": v["n"], "Rembourse": _nombre(v["montant"]), "Consommants": len(v["consommants"])}
                       for k, v in sorted(par_police.items(), key=lambda kv: -kv[1]["montant"])[:10]],
        "Releves": [{"Id": r["idreleve"], "Nature": r["nature"], "Fichier": r["fichier"], "Garants": r["garants"], "Lignes": r["lignes"], "Nouvelles": r["nouvelles"],
                     "Connues": r["connues"], "Modifiees": r["modifiees"], "DatesCorrigees": r["dates_corrigees"], "ClotureDu": _iso(r["cloture_du"]), "ClotureAu": _iso(r["cloture_au"]),
                     "Operateur": r["operateur"], "Date": _iso(r["dateimport"]), "Situation": _iso(r.get("situation"))} for r in releves],
    }


def entreprises(params):
    with connection.cursor() as cursor:
        condition, valeurs = _filtrer(params)
        prestations = _charger(cursor, condition, valeurs)
        effectif = _lignes(cursor, "SELECT police, statut, COUNT(*) AS n FROM lephare_sante_effectif WHERE actif GROUP BY police, statut")
    eff = defaultdict(Counter)
    for l in effectif:
        eff[l["police"]][l["statut"]] += l["n"]
    total = sum((p["mt_rembourse"] for p in prestations), ZERO)
    par_police = defaultdict(list)
    for p in prestations:
        par_police[p["police"]].append(p)
    lignes = []
    for police in sorted(set(par_police) | set(eff)):
        ps = par_police.get(police, [])
        consommants = len({p["matricule_beneficiaire"] for p in ps})
        rembourse = sum((p["mt_rembourse"] for p in ps), ZERO)
        effectif_police = sum(eff[police].values())
        familles = defaultdict(lambda: ZERO)
        for p in ps:
            familles[p["famille"]] += p["mt_rembourse"]
        lignes.append({
            "Police": police, "Garant": ps[0]["garant"] if ps else "", "Effectif": effectif_police, "Assures": eff[police]["A"], "Conjoints": eff[police]["C"], "Enfants": eff[police]["E"],
            "Consommants": consommants, "TauxRecours": consommants / effectif_police if effectif_police else None, "Prestations": len(ps),
            "Reclame": _nombre(sum((p["mt_reclame"] for p in ps), ZERO)), "Rembourse": _nombre(rembourse), "CoutParConsommant": _nombre(rembourse / consommants) if consommants else None,
            "CoutParActe": _nombre(rembourse / len(ps)) if ps else None, "Part": float(rembourse / total) if total else 0,
            "ParFamille": {k: _nombre(v) for k, v in familles.items()},
        })
    return {"Lignes": sorted(lignes, key=lambda l: -l["Rembourse"])}


def plafonds(params):
    """Consommation face aux plafonds : famille (annuel), personne (dentaire annuel, optique), avec taux et solde."""
    with connection.cursor() as cursor:
        baremes = _baremes(cursor)
        exercice = int(params.get("exercice") or _exercice(cursor))
        prestations = _charger(cursor)
    lignes = []
    familles = defaultdict(lambda: [ZERO, "", "", ""])
    personnes = defaultdict(lambda: {"DENTAIRE": ZERO, "OPTIQUE": ZERO, "statut": "", "bareme": "", "nom": "", "police": "", "assure": None})
    for p in prestations:
        if _annee(p) == exercice:
            f_ = familles[p["matricule_assure"]]
            f_[0] += p["mt_rembourse"]
            f_[1], f_[2], f_[3] = p["bareme"], p["police"], p["assure"]
        if p["famille"] in ("DENTAIRE", "OPTIQUE"):
            x = personnes[p["matricule_beneficiaire"]]
            if _annee(p) == exercice or (p["famille"] == "OPTIQUE" and _annee(p) == exercice - 1):
                x[p["famille"]] += p["mt_rembourse"]
            x["statut"], x["bareme"], x["nom"], x["police"], x["assure"] = p["statut"], p["bareme"], p["beneficiaire"], p["police"], p["matricule_assure"]

    def ligne(niveau, garantie, mat, nom, police, plafond, consomme, assure):
        taux = float(consomme / plafond) if plafond else None
        situation = "Barème inconnu" if not plafond else "Plafond dépassé" if consomme > plafond else "Alerte" if consomme >= SEUIL_PLAFOND * plafond else "Normal"
        return {"Niveau": niveau, "Garantie": garantie, "Matricule": mat, "MatriculeAssure": assure, "Nom": nom, "Police": police, "Plafond": _nombre(plafond) if plafond else None,
                "Consomme": _nombre(consomme), "Taux": taux, "Solde": _nombre(plafond - consomme) if plafond else None, "Situation": situation}

    for mat, (montant, code, police, nom) in familles.items():
        b = baremes.get(code)
        lignes.append(ligne("Famille", "Plafond annuel toutes prestations", mat, nom, police, b["plafond_annuel_famille"] if b else None, montant, mat))
    for mat, x in personnes.items():
        b = baremes.get(x["bareme"])
        if x["DENTAIRE"]:
            lignes.append(ligne("Personne", "Dentaire par an et par personne", mat, x["nom"], x["police"], b["dentaire_an_personne"] if b else None, x["DENTAIRE"], x["assure"]))
        if x["OPTIQUE"]:
            plafond = (b["optique_enfant"] if x["statut"] == "E" else b["optique_adulte"]) if b else None
            lignes.append(ligne("Personne", "Optique tous les 2 ans", mat, x["nom"], x["police"], plafond, x["OPTIQUE"], x["assure"]))
    situation = str(params.get("situation") or "").strip()
    lignes.sort(key=lambda l: -(l["Taux"] or 0))
    return {"Exercice": exercice, "Situations": dict(Counter(l["Situation"] for l in lignes)),
            "Lignes": [l for l in lignes if not situation or l["Situation"] == situation][:1000]}


def controles(code=None):
    """Anomalies des données, chacune avec sa gravité et son explication (mêmes contrôles que le rapport d'analyse).
    Distinctes des signaux de fraude, qui visent les comportements et se jugent à l'instruction."""
    with connection.cursor() as cursor:
        prestations = _charger(cursor)
        exercice = _exercice(cursor)
        ecarts = _lignes(cursor, "SELECT * FROM lephare_sante_prestation_ecart ORDER BY idecart DESC LIMIT 200")
        effectif = _lignes(cursor, "SELECT * FROM lephare_sante_effectif WHERE actif")
        doublons = doublons_importes(cursor)
    anomalies = []

    def ajouter(code, gravite, libelle, explication, p=None, matricule=None, police="", montant=None):
        anomalies.append({"Code": code, "Gravite": gravite, "Anomalie": libelle, "Explication": explication, "NumeroPrestation": p["numero_prest"] if p else None,
                          "Matricule": p["matricule_beneficiaire"] if p else matricule, "Police": p["police"] if p else police,
                          "Montant": _nombre(p["mt_rembourse"]) if p and montant is None else montant})

    vus = set()
    for p in prestations:
        soins = p["date_soins_retenue"]
        cle = (p["matricule_beneficiaire"], p["date_soins"], p["acte"], p["code_centre"], p["mt_reclame"])
        if cle in vus:
            ajouter("DOUBLON", "Élevée", "Doublon probable", "Même bénéficiaire, date de soins, acte, centre et montant réclamé qu'une autre prestation.", p)
        vus.add(cle)
        if not p["dans_effectif"]:
            ajouter("HORS_EFFECTIF", "Élevée", "Bénéficiaire absent de l'effectif", "Matricule bénéficiaire inconnu de l'effectif importé.", p)
        if p["date_soins"] and p["date_cloture"] and p["date_soins"] > p["date_cloture"]:
            corrigee = p["date_soins_retenue"] != p["date_soins"]
            ajouter("DATE_INVERSEE" if corrigee else "SOINS_APRES_CLOTURE", "Faible" if corrigee else "Moyenne", "Date de soins postérieure à la clôture",
                    f"Inversion jour/mois de l'export, date retenue {soins:%d/%m/%Y}." if corrigee else "Date non corrigeable.", p, montant=0)
        if soins and soins.year < exercice:
            ajouter("EXERCICE_PRECEDENT", "Faible", "Soins de l'exercice précédent", f"Soins de {soins.year} payés sur un relevé de {exercice}.", p)
        if p["date_effet"] and soins and soins < p["date_effet"]:
            ajouter("AVANT_EFFET", "Élevée", "Soins avant la date d'effet", f"Soins du {soins:%d/%m/%Y}, effet au {p['date_effet']:%d/%m/%Y}.", p)
        if p["date_naissance"] and soins and p["date_naissance"] > soins:
            ajouter("NAISSANCE", "Moyenne", "Naissance postérieure aux soins", "Date de naissance après la date de soins.", p)
        if p["base_decomptee"] < 0 or p["mt_rembourse"] < 0 or p["mt_reclame"] < 0:
            ajouter("NEGATIF", "Moyenne", "Montant négatif", "Régularisation probable du gestionnaire, à expliquer.", p)
        tm = p["ticket_moderateur"] / 100
        if (abs(p["mt_reclame"] - p["exclusion"] - p["depassement"] - p["base_decomptee"]) > 1 and abs(p["base_decomptee"] * (1 - tm) - p["mt_rembourse"]) > 1
                and abs(p["base_decomptee"] * (1 - tm) - p["depassement"] - p["mt_rembourse"]) > 1):
            ajouter("CALCUL", "Moyenne", "Calcul non reconstitué",
                    "Ni base = réclamé - exclusion - dépassement, ni remboursé = base x (1 - ticket modérateur), dépassement de plafond déduit ou non.", p)
        if p["date_effet"] and soins and soins >= p["date_effet"]:
            mois = (soins.year - p["date_effet"].year) * 12 + soins.month - p["date_effet"].month - (1 if soins.day < p["date_effet"].day else 0)
            carence = CARENCES.get(p["famille"], CARENCE_DEFAUT)
            if mois < carence:
                ajouter("CARENCE", "Moyenne", "Soins pendant la carence",
                        f"{mois} mois depuis la date d'effet ; carence de {carence} mois pour la famille {p['famille'].lower()} (barèmes d'OREOLE, à confirmer selon le contrat).", p)
    for e in ecarts:
        ajouter("MONTANT_CHANGE", "Moyenne", "Montant modifié par un relevé suivant",
                f"{e['champ']} : {e['ancienne']} puis {e['nouvelle']} ; la valeur d'origine est conservée.")
        anomalies[-1]["NumeroPrestation"] = e["numero_prest"]
    # Qualité de l'effectif (attentes de l'équipe actuariat, point 2.3) : mêmes contrôles que le rapport Word
    from .consommations_qualite import A_CORRIGER, controler

    for c in controler(effectif, dt.date.today(), doublons):
        for x in c["Cas"]:
            ajouter(f"EFFECTIF_{c['Code']}", "Moyenne" if c["Gravite"] == A_CORRIGER else "Faible", c["Libelle"],
                    " - ".join(filter(None, [x["Statut"] if x["Statut"] != "-" else "", f"{x['Age']} ans" if x["Age"] is not None else "", x["Detail"]])),
                    matricule=x["Matricule"], police=x["Entreprise"])
    return {"Synthese": [{"Code": c, "Anomalie": next(a["Anomalie"] for a in anomalies if a["Code"] == c), "Gravite": next(a["Gravite"] for a in anomalies if a["Code"] == c),
                          "Nombre": n, "Montant": sum(a["Montant"] or 0 for a in anomalies if a["Code"] == c)} for c, n in Counter(a["Code"] for a in anomalies).most_common()],
            "Lignes": [a for a in anomalies if not code or a["Code"] == code][:2000], "Total": len(anomalies)}


def doublons_importes(cursor, garant=""):
    """Matricules en double des fichiers d'effectif d'où viennent les personnes actives (journal d'audit de leur import, importer())."""
    cursor.execute("SELECT DISTINCT idreleve::text FROM lephare_sante_effectif WHERE actif AND (%s = '' OR garant = %s)", [garant, garant])
    releves = [l[0] for l in cursor.fetchall()]
    if not releves:
        return []
    cursor.execute("""SELECT details_json FROM institutionnel_auditlogcima WHERE action = %s AND objet_type = 'releve_sante' AND objet_id = ANY(%s)""",
                   [ACTION_DOUBLONS, releves])
    vus, doublons = set(), []
    for (details,) in cursor.fetchall():
        for d in (details or {}).get("Doublons", []):
            if d.get("Matricule") not in vus:
                vus.add(d.get("Matricule"))
                doublons.append(d)
    return doublons


# ------------------------------------------------------------------ routes
def _reponse(fonction, *args, code=status.HTTP_200_OK):
    try:
        return Response(fonction(*args), status=code)
    except ErreurConsommation as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except DatabaseError as erreur:
        logger.exception("Consommations santé : erreur de base")
        return Response({"error": str(erreur).split("\n")[0]}, status=status.HTTP_400_BAD_REQUEST)


def _fichier(request):
    fichier = request.FILES.get("fichier")
    if not fichier:
        raise ErreurConsommation("Joignez le fichier Excel du gestionnaire.")
    if fichier.size > TAILLE_MAX:
        raise ErreurConsommation("Fichier trop volumineux : 25 Mo au plus.")
    return fichier.read(), fichier.name


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def vue_analyse(request):
    def executer():
        contenu, _nom = _fichier(request)
        with connection.cursor() as cursor:
            return analyser(contenu, cursor, _nom, request.data.get("exercice") or None)[0]
    return _reponse(executer)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def vue_import(request):
    def executer():
        contenu, nom = _fichier(request)
        situation = lire_date(request.data.get("situation"))
        return importer(contenu, nom, request.user, situation, request.data.get("exercice") or None)
    return _reponse(executer, code=status.HTTP_201_CREATED)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_synthese(request):
    return _reponse(synthese, request.query_params)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_recherche(request):
    return _reponse(rechercher, request.query_params.get("q"))


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_famille(request, matricule):
    def executer():
        fiche = fiche_famille(matricule)
        # Les signaux de fraude ne se lisent qu'avec le droit de la détection ; le niveau reste masqué aussi
        if not a_le_droit(request.user, "consommations.fraude"):
            fiche["Signaux"] = None
            for b in fiche["Beneficiaires"]:
                b["Score"], b["Niveau"] = None, None
        return fiche
    return _reponse(executer)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_entreprises(request):
    return _reponse(entreprises, request.query_params)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_plafonds(request):
    return _reponse(plafonds, request.query_params)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_controles(request):
    return _reponse(controles, request.query_params.get("code") or None)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_fraude(request):
    return _reponse(fraude, request.query_params)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_fraude_beneficiaire(request, matricule):
    return _reponse(signaux_beneficiaire, matricule)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_instruction(request, matricule):
    return _reponse(instruire, matricule, request.data, request.user)
