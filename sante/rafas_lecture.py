"""
RAFAS : lecture des fichiers Excel du gestionnaire (VITALIS SANTE), sans écriture en base.

Deux sortes de feuilles sont reconnues par leurs en-têtes (le nom des feuilles change d'un envoi à l'autre) :
- relevé de prestations (« DETAIL DES SINISTRES TP RD », « ETATS PERSONNALISES ») : une ligne par acte, colonnes DateCloture, MatriculeP,
  Remboursé... ; DateCloture = mois de clôture, c'est-à-dire la période comptable du récapitulatif des dépenses par contrat ;
- effectif (« EFFECTIF SEPTEMBRE 2026 », « EFF JAN-AOUT 2025 ») : une ligne par bénéficiaire, colonnes numeroBeneficiaire, codeLienParente...
Les autres feuilles (tableaux croisés, feuilles de travail sans matricule) sont signalées et ignorées.

Constats sur les fichiers d'EXAT AGRICULTURE (2026-11-10) :
- la colonne NPrestations porte parfois le format date dans Excel : le numéro devient une date, voire « #VALUE! » au-delà de l'an 9999. Le
  classeur est donc lu sans conversion des dates (nombres bruts) et seules les colonnes de dates sont converties ;
- les relevés mensuels finissent par une ligne TOTAL (DateCloture = « TOTAL ») qui doublerait les montants : écartée ;
- DateCloture vaut une date (1er du mois) ou un texte « 09/2026 » ; matricules en nombre ou en texte avec zéros en tête ;
- un même classeur peut contenir le relevé d'origine et des feuilles de travail qui le recopient (DEPENSES_EXAT, BASE CONSOLIDEE...) : pour
  chaque mois de clôture et chaque police, la feuille qui compte le plus de lignes est retenue (à égalité, la première du classeur).
"""

import datetime as dt
import io
import re
import unicodedata
import warnings
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from zipfile import BadZipFile

from openpyxl import load_workbook
from openpyxl.utils.datetime import from_excel
from openpyxl.utils.exceptions import InvalidFileException


class ErreurRafas(Exception):
    """Saisie ou fichier refusé : message affiché tel quel."""


MOIS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]
# Noms de mois des fichiers et des feuilles (abrégés ou tronqués par Excel : « SEPTEMBR »)
_MOIS_NOMS = [("JANVIER", 1), ("JANV", 1), ("JAN", 1), ("FEVRIER", 2), ("FEV", 2), ("MARS", 3), ("AVRIL", 4), ("AVR", 4), ("MAI", 5),
              ("JUIN", 6), ("JUILLET", 7), ("JUIL", 7), ("AOUT", 8), ("SEPTEMBRE", 9), ("SEPTEMBR", 9), ("SEPT", 9), ("OCTOBRE", 10),
              ("OCT", 10), ("NOVEMBRE", 11), ("NOV", 11), ("DECEMBRE", 12), ("DEC", 12)]

# En-tête normalisé (majuscules sans accent ni séparateur) -> champ
COLONNES_SINISTRES = {
    "DATECLOTURE": "mois", "CODGAR": "code_garant", "IDPOLICE": "idpolice", "POLICE": "police", "CODECOLLEGE": "code_college",
    "COLLEGE": "college", "MATRICULEP": "matricule", "PATIENT": "patient", "STATUT": "statut", "DATENAISSANCE": "date_naissance",
    "SEXE": "sexe", "MATRICULEA": "matricule_adherent", "ASSURE": "assure", "LOCALITECENTREEXECUTANT": "localite_executant",
    "CENTREEXECUTANT": "centre_executant", "LOCALITECENTREPRESCRIPTEUR": "localite_prescripteur", "CENTREPRESCRIPTEUR": "centre_prescripteur",
    "LIBELLE": "famille", "NPRESTATIONS": "numero", "CODEACTE": "code_acte", "ACTES": "acte", "MEDECIN": "medecin",
    "DATECONSULTATION": "date_consultation", "DATEDESOINS": "date_soins", "TYPEAFFECTION": "affection", "CODEAFFECTION": "code_affection",
    "TYPEPRESTATION": "type_prestation", "RECLAME": "reclame", "TM": "tm", "MONTANTEXCLUS": "exclus", "DEPASSEMENT": "depassement",
    "REMBOURSE": "rembourse", "PARTPATIENT": "part_patient",
    # en-tête de la convention : n° client du souscripteur chez le gestionnaire (« Numero »), libellé du souscripteur
    "NUMERO": "numero_client", "GARANT": "garant_libelle",
}
OBLIGATOIRES_SINISTRES = ("mois", "matricule", "rembourse")
COLONNES_EFFECTIF = {
    "CODEGARANT": "code_garant", "GARANT": "garant", "IDPOLICE": "idpolice", "LIBELLEPOLICE": "police", "IDCOLLEGE": "code_college",
    "LIBELLECOLLEGE": "college", "COLLEGE": "college", "NUMEROADHERENT": "matricule_adherent", "NOMADHERENT": "adherent",
    "NUMEROBENEFICIAIRE": "matricule", "NOMBENEFICIAIRE": "nom_seul", "PRENOMSBENEFICIAIRE": "prenoms", "BENEFICIAIRE": "nom",
    "DATENAISSANCE": "date_naissance", "CODELIENPARENTE": "lien", "SEXE": "sexe", "DATEEFFET": "date_effet", "DATEENTREE": "date_entree",
    "DATESORTIE": "date_sortie", "MOTIFSORTIE": "motif_sortie", "ETATBENEFICIAIRE": "etat", "ETATBENEFICIAIRE2": "etat2",
    "CODEETATBENEFICIAIRE": "etat3", "ZONECONCENTRATION": "zone",
    # en-tête de la convention : n° de police, période de la police
    "NUMEROPOLICE": "numero_police", "DATEEFFETPOLICE": "date_effet_police", "DATEECHEANCE": "date_echeance", "DATEECHEANCEPOLICE": "date_echeance",
}
OBLIGATOIRES_EFFECTIF = ("matricule", "lien")
DATES = {"date_naissance", "date_soins", "date_effet", "date_entree", "date_sortie", "date_effet_police", "date_echeance"}
MONTANTS = {"reclame", "exclus", "depassement", "rembourse", "part_patient"}
ENTIERS = {"idpolice", "code_college", "matricule", "matricule_adherent", "code_affection", "numero_police", "numero_client"}
TEXTES_COURTS = {"sexe": 1, "statut": 1, "lien": 1}
TAILLE_MAX = 30 * 1024 * 1024


# ------------------------------------------------------------------ valeurs
def normaliser(texte):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKD", str(texte or "")).encode("ascii", "ignore").decode("ascii").upper()).strip()


def cle_entete(texte):
    return re.sub(r"[^A-Z0-9]", "", normaliser(texte))


def texte(valeur):
    if valeur is None:
        return ""
    t = re.sub(r"\s+", " ", str(valeur)).strip()
    return "" if t in ("\\N", "NULL", "#VALUE!", "#N/A") else t


def entier(valeur):
    if valeur is None or isinstance(valeur, bool):
        return None
    if isinstance(valeur, (int, float)):
        return int(valeur)
    t = texte(valeur).replace(" ", "")
    if not t:
        return None
    try:
        return int(Decimal(t.replace(",", ".")))
    except (InvalidOperation, ValueError):
        return None


def montant(valeur):
    if valeur is None or isinstance(valeur, bool):
        return 0
    if isinstance(valeur, (int, float)):
        return int(round(valeur))
    t = texte(valeur).replace(" ", "").replace(" ", "").replace(" ", "").replace(",", ".")
    try:
        return int(Decimal(t).quantize(Decimal("1"))) if t else 0
    except (InvalidOperation, ValueError):
        return 0


def _depuis_serie(valeur):
    try:
        resultat = from_excel(valeur)
    except (ValueError, OverflowError, TypeError):
        return None
    return resultat if isinstance(resultat, dt.datetime) and 1900 < resultat.year < 2100 else None


def date_heure(valeur):
    """Date et heure : nombre de série Excel (lecture sans conversion), date Python, ou texte jj/mm/aaaa [hh:mm[:ss]] / aaaa-mm-jj."""
    if valeur is None or isinstance(valeur, bool):
        return None
    if isinstance(valeur, dt.datetime):
        return valeur if 1900 < valeur.year < 2100 else None
    if isinstance(valeur, dt.date):
        return dt.datetime(valeur.year, valeur.month, valeur.day)
    if isinstance(valeur, (int, float)):
        return _depuis_serie(valeur) if 1 < valeur < 80000 else None
    t = texte(valeur)
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            d = dt.datetime.strptime(t[:19] if "%S" in fmt else t[:16] if "%M" in fmt else t[:10], fmt)
            return d if 1900 < d.year < 2100 else None
        except ValueError:
            continue
    return None


def date(valeur):
    d = date_heure(valeur)
    return d.date() if d else None


def mois_cloture(valeur):
    """DateCloture : 1er jour du mois ; texte « 09/2026 » accepté ; « TOTAL » ou vide -> None."""
    if isinstance(valeur, str):
        t = texte(valeur)
        m = re.fullmatch(r"(\d{1,2})[/-](\d{4})", t)
        if m and 1 <= int(m.group(1)) <= 12:
            return dt.date(int(m.group(2)), int(m.group(1)), 1)
    d = date(valeur)
    return dt.date(d.year, d.month, 1) if d else None


def fin_de_mois(jour):
    suivant = dt.date(jour.year + (jour.month == 12), jour.month % 12 + 1, 1)
    return suivant - dt.timedelta(days=1)


def libelle_mois(jour, court=False):
    if not jour:
        return ""
    nom = MOIS_FR[jour.month - 1]
    return f"{nom[:4].rstrip('.')}{'.' if len(nom) > 4 else ''} {str(jour.year)[2:]}" if court else f"{nom} {jour.year}"


def situation_depuis_nom(*noms):
    """Date de situation d'un effectif d'après le nom de la feuille ou du fichier : « AU 31-10-2026 », « SEPTEMBRE 2026 » (fin du mois),
    « JAN-AOUT 2025 » (fin du dernier mois cité). None si rien n'est reconnu."""
    for nom in noms:
        n = normaliser(nom)
        m = re.search(r"(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})", n)
        if m:
            try:
                return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            except ValueError:
                pass
        annee = re.search(r"(20\d{2})", n)
        if annee:
            avant = n[:annee.start()]
            trouves = []
            for libelle, numero in _MOIS_NOMS:
                for occ in re.finditer(rf"(?<![A-Z]){libelle}", avant):
                    trouves.append((occ.start(), numero))
            if trouves:
                return fin_de_mois(dt.date(int(annee.group(1)), max(trouves)[1], 1))
    return None


# ------------------------------------------------------------------ collèges du gestionnaire
def zone_depuis_college(libelle):
    """Zone de concentration des travailleurs d'après le libellé du collège du gestionnaire : « COLLEGE EXAT (AM/O-SAN PEDRO) - 80% »
    -> SAN PEDRO ; « (CADRES-KOT-TAABO) » -> KOT-TAABO ; sans parenthèses : le libellé avant « - », sans « COLLEGE » ni « EMPLOYES USINE »."""
    n = normaliser(libelle)
    m = re.search(r"\(([^)]*)\)", n)
    if m:
        interieur = m.group(1)
        morceaux = re.split(r"\s*-\s*", interieur, maxsplit=1)
        if len(morceaux) == 2 and re.fullmatch(r"(AM/?O|AMO|CADRES?|AM-O)", morceaux[0].strip()):
            return morceaux[1].strip()
        return interieur.strip()
    avant = re.split(r"\s+-\s+", n)[0]
    avant = re.sub(r"^(COLLEGE|EMPLOYES USINE|EMPLOYES)\s+", "", avant).strip()
    return avant


def categorie_depuis_college(libelle, police=""):
    """CADRES si le libellé du collège (à défaut, la police) le dit, sinon AM/O (agents de maîtrise et ouvriers)."""
    return "CADRES" if "CADRE" in (normaliser(libelle) or normaliser(police)) else "AM/O"


_MOTS_VIDES = {"COLLEGE", "SOCIETE", "AM/O", "AMO", "AM", "CADRES", "CADRE", "S/C", "SC", "DE", "DU", "LA", "LE", "ET", "80%", "FAMILLE", "FAMILL", "CI"}


def _mots(t):
    return {m for m in re.split(r"[^A-Z0-9/]+", normaliser(t)) if len(m) > 1 and m not in _MOTS_VIDES}


def proposer_college(colleges, police, libelle):
    """Collège de la convention d'un collège du gestionnaire : parmi ceux de même catégorie (AM/O ou CADRES), celui dont le libellé a le
    plus de mots en commun avec la police et le collège du gestionnaire (à égalité, le premier). colleges : [{code, libelle, categorie}]."""
    if not colleges:
        return None
    categorie = categorie_depuis_college(libelle, police)
    candidats = [c for c in colleges if c["categorie"] == categorie] or list(colleges)
    mots = _mots(f"{police} {libelle}")
    return max(enumerate(candidats), key=lambda x: (len(_mots(x[1]["libelle"]) & mots), -x[0]))[1]["code"]


# ------------------------------------------------------------------ classeur
def _ouvrir(contenu):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            classeur = load_workbook(io.BytesIO(contenu), data_only=True, read_only=True)
    except (BadZipFile, InvalidFileException, KeyError, OSError, ValueError):
        raise ErreurRafas("Fichier illisible : joignez le classeur Excel (.xlsx) reçu du gestionnaire.")
    # Lecture sans conversion des dates : un nombre au format date (NPrestations) garde sa valeur ; les dates sont converties colonne par colonne
    classeur._date_formats = set()
    classeur._timedelta_formats = set()
    return classeur


def _lignes(feuille):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for ligne in feuille.iter_rows(values_only=True):
            yield ligne


def _entete(premieres):
    """Ligne d'en-tête : la première des 15 premières lignes qui reconnaît le plus de colonnes d'une des deux sortes."""
    meilleur = (0, None, None)
    for i, ligne in enumerate(premieres):
        cles = [cle_entete(v) for v in ligne]
        for nature, colonnes in (("SINISTRES", COLONNES_SINISTRES), ("EFFECTIF", COLONNES_EFFECTIF)):
            champs = {colonnes[c] for c in cles if c in colonnes}
            obligatoires = OBLIGATOIRES_SINISTRES if nature == "SINISTRES" else OBLIGATOIRES_EFFECTIF
            if all(o in champs for o in obligatoires) and len(champs) > meilleur[0]:
                meilleur = (len(champs), i, nature)
    return meilleur[1], meilleur[2]


def _convertir(valeur, champ):
    if champ == "mois":
        return mois_cloture(valeur)
    if champ == "date_consultation":
        return date_heure(valeur)
    if champ in DATES:
        return date(valeur)
    if champ in MONTANTS:
        return montant(valeur)
    if champ == "numero":
        if isinstance(valeur, dt.datetime):  # numéro mis au format date par Excel (lecture sans conversion : cas résiduel)
            return int((valeur - dt.datetime(1899, 12, 30)).total_seconds() // 86400)
        return entier(valeur)
    if champ == "tm":
        return float(montant(valeur)) if not isinstance(valeur, float) else round(valeur, 2)
    if champ in ENTIERS:
        return entier(valeur)
    t = texte(valeur)
    if champ in TEXTES_COURTS:
        t = t[:1].upper()
        return "M" if champ == "sexe" and t == "H" else t
    return t


def _lire_feuille(feuille):
    lignes = _lignes(feuille)
    premieres = []
    for ligne in lignes:
        premieres.append(ligne)
        if len(premieres) >= 15:
            break
    rang, nature = _entete(premieres)
    if rang is None:
        return None, None, []
    colonnes = COLONNES_SINISTRES if nature == "SINISTRES" else COLONNES_EFFECTIF
    entete = [colonnes.get(cle_entete(v)) for v in premieres[rang]]
    # premier titre reconnu pour un champ (une feuille peut avoir « College » et « libelleCollege »)
    vus = set()
    for j, champ in enumerate(entete):
        if champ in vus:
            entete[j] = None
        elif champ:
            vus.add(champ)
    resultat = []

    def convertir(ligne):
        d = {}
        for j, champ in enumerate(entete):
            if champ and j < len(ligne):
                d[champ] = _convertir(ligne[j], champ)
        return d

    for ligne in premieres[rang + 1:]:
        resultat.append(convertir(ligne))
    for ligne in lignes:
        resultat.append(convertir(ligne))
    return nature, entete, resultat


def _effectif_propre(d):
    nom = d.get("nom") or " ".join(x for x in (d.get("nom_seul"), d.get("prenoms")) if x)
    garant = d.get("code_garant") or (d.get("garant") if d.get("garant") and " " not in d.get("garant") and len(d.get("garant")) <= 12 else "")
    etat = d.get("etat") or d.get("etat2") or d.get("etat3") or ""
    return {
        "matricule": d.get("matricule"), "matricule_adherent": d.get("matricule_adherent"), "adherent": (d.get("adherent") or "")[:150],
        "nom": nom[:200], "date_naissance": d.get("date_naissance"), "sexe": d.get("sexe") or "", "lien": d.get("lien") or "",
        "idpolice": d.get("idpolice"), "police": (d.get("police") or "")[:150], "code_college": d.get("code_college"),
        "college": (d.get("college") or "")[:150], "date_effet": d.get("date_effet"), "date_entree": d.get("date_entree"),
        "date_sortie": d.get("date_sortie"), "motif_sortie": (d.get("motif_sortie") or "")[:120], "etat": etat[:40],
        "code_garant": garant, "zone": d.get("zone") or "",
        "garant_libelle": d.get("garant") if d.get("garant") and d.get("garant") != garant else "",
        "numero_police": d.get("numero_police"), "date_effet_police": d.get("date_effet_police"), "date_echeance": d.get("date_echeance"),
    }


CHAMPS_PRESTATION = ["mois", "numero", "matricule", "matricule_adherent", "patient", "assure", "statut", "date_naissance", "sexe", "idpolice",
                     "police", "code_college", "college", "localite_executant", "centre_executant", "localite_prescripteur", "centre_prescripteur",
                     "famille", "code_acte", "acte", "medecin", "date_consultation", "date_soins", "affection", "code_affection", "type_prestation",
                     "reclame", "tm", "exclus", "depassement", "rembourse", "part_patient"]
LONGUEURS = {"patient": 150, "assure": 150, "police": 150, "college": 150, "localite_executant": 80, "centre_executant": 150,
             "localite_prescripteur": 80, "centre_prescripteur": 150, "famille": 80, "code_acte": 30, "acte": 150, "medecin": 150, "affection": 60,
             "type_prestation": 4}


def _prestation_propre(d):
    p = {c: d.get(c) for c in CHAMPS_PRESTATION}
    for c, n in LONGUEURS.items():
        p[c] = (p[c] or "")[:n]
    for c in ("statut", "sexe"):
        p[c] = p[c] or ""
    for c in MONTANTS:
        p[c] = p[c] or 0
    p["tm"] = p["tm"] or 0
    p["code_garant"] = d.get("code_garant") or ""
    p["garant_libelle"] = d.get("garant_libelle") or ""
    p["numero_client"] = d.get("numero_client")
    return p


def cle_police(p):
    return p.get("idpolice") if p.get("idpolice") is not None else normaliser(p.get("police"))


def lire_classeur(contenu, nom_fichier=""):
    """Feuilles du classeur : relevés de prestations et effectifs reconnus, feuilles ignorées. Aucune écriture."""
    if not contenu:
        raise ErreurRafas("Fichier vide.")
    if len(contenu) > TAILLE_MAX:
        raise ErreurRafas("Fichier trop volumineux : 30 Mo au plus.")
    classeur = _ouvrir(contenu)
    sinistres, effectifs, ignorees = [], [], []
    try:
        for rang, feuille in enumerate(classeur.worksheets):
            nature, _entete_lu, lignes = _lire_feuille(feuille)
            if nature is None:
                ignorees.append({"Feuille": feuille.title, "Motif": "Ni relevé de prestations ni effectif du gestionnaire (tableau de travail ou sans matricule)."})
                continue
            if nature == "SINISTRES":
                retenues, totaux, sans_matricule = [], 0, 0
                for d in lignes:
                    if not any(v not in (None, "", 0) for v in d.values()):
                        continue
                    if d.get("mois") is None:
                        totaux += 1
                        continue
                    if d.get("matricule") is None:
                        sans_matricule += 1
                        continue
                    retenues.append(_prestation_propre(d))
                sinistres.append({"Feuille": feuille.title, "Rang": rang, "Lignes": retenues, "Totaux": totaux, "SansMatricule": sans_matricule})
            else:
                retenues, sans_matricule = [], 0
                for d in lignes:
                    if not any(v not in (None, "", 0) for v in d.values()):
                        continue
                    if d.get("matricule") is None:
                        sans_matricule += 1
                        continue
                    retenues.append(_effectif_propre(d))
                effectifs.append({"Feuille": feuille.title, "Rang": rang, "Lignes": retenues, "SansMatricule": sans_matricule,
                                  "Situation": situation_depuis_nom(feuille.title, nom_fichier)})
    finally:
        classeur.close()
    return {"Sinistres": sinistres, "Effectifs": effectifs, "Ignorees": ignorees}


def repartir_sinistres(feuilles):
    """Pour chaque (mois de clôture, police), la feuille qui compte le plus de lignes (à égalité, la première du classeur). Renvoie
    {feuille: set((mois, police))} des couples retenus pour chaque feuille."""
    comptes = defaultdict(Counter)
    for f in feuilles:
        for p in f["Lignes"]:
            comptes[(p["mois"], cle_police(p))][f["Feuille"]] += 1
    rangs = {f["Feuille"]: f["Rang"] for f in feuilles}
    retenus = defaultdict(set)
    for couple, compte in comptes.items():
        feuille = sorted(compte.items(), key=lambda x: (-x[1], rangs[x[0]]))[0][0]
        retenus[feuille].add(couple)
    return retenus
