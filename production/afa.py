"""
Branche Vie, distincte de la Santé : contrats AFA (assurance de groupe, une ligne par assuré), saisie et import Excel.

Format des listes AFA (« EXCEL AFA.xlsx » d'OREOLE, 2026-11-02) : titre en A1, ligne d'en-tête
N° | ACTE | DATE D'EFFET | DATE D'ECHEANCE | SOUSCRIPTEUR | NOMS ET PRENOMS | DATE DE NAISSANCE | EN QUALITE DE |
CAPITAL ASSURE | BENEFICIAIRES | PRIMES TTC, une ligne par assuré (acte, dates, souscripteur et qualité souvent dans
des cellules fusionnées), ligne TOTAL. Les colonnes sont reconnues par leur intitulé. Les primes du fichier sont
reprises telles quelles (affaire forfaitaire, aucun prorata) ; la Vie ne porte pas de taxe.

Enregistrement au format des contrats Vie d'URANUS : produit 10, catégorie et offre « non spécifiées » (0), une ligne
de détail par assuré (matricule = n° de client sur 20 chiffres comme l'IA, nom dans conducteur, date de naissance dans
datemec, capital dans valeurvenale), garantie 231 « DÉCÈS TOUTES CAUSES ». Qualité, bénéficiaires et acte de chaque
assuré : lephare_afa_assure. Confirmation par sp_confirmation_devis (contrat, quittance) comme les autres branches ;
renouvellement d'une police Vie existante : devis REN de sp_avenant_creation_devis_initial, même numéro de police.
Incorporation (2026-11-09) : devis INC créé depuis la fiche du contrat (production/incorporation.py), puis complété ici avec
les seules personnes ajoutées ; souscripteur, compagnie et échéance restent ceux de la police, la date d'incorporation est au
choix dans la période, une personne déjà assurée sous la police est refusée, les primes sont reprises sans prorata.
Offres commerciales (2026-11-10, production/vie_offres.py) : la branche est la Vie, AFA en est une offre ; chaque devis
porte l'offre choisie (IdOffreVie). Offres « capital » (AFA, Temporaire décès) : ce formulaire, sous-garantie de l'offre ;
offre « cotisations » (Retraite complémentaire) : état mensuel des salariés, production/vie_retraite.py.

GET  /api/afa/referentiels/?client=<id>   compagnies, offres commerciales, polices Vie du souscripteur
POST /api/afa/import/analyse/              fichier lu et contrôlé, rien n'est enregistré
POST /api/afa/devis/                       devis Vie de l'offre choisie (IdDevis > 0 : modification)
GET  /api/afa/devis/<iddevis>/             devis AFA tel qu'enregistré
GET  /api/afa/modele/                      modèle Excel vierge
"""
import difflib
import io
import logging
import re
import unicodedata
import zipfile
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.db import DatabaseError, connection, transaction
from django.http import HttpResponse
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils.exceptions import InvalidFileException
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from configuration_api.parametrage import compagnie_par_defaut
from core.date_parser import date_emission_du_jour

from . import vie_offres
from .import_assures import insert_new_assure, traiter_ayants_droit
from .incorporation import _devis_incorporation, _verifier_periode_devis, controler_assure_incorpore
from .renouvellement import AUTHENTIFICATION, ErreurRenouvellement, _contrat_base, _lignes

logger = logging.getLogger(__name__)

ID_PRODUIT_VIE = 10
ID_INTERMEDIAIRE = 1
ID_TARIF_VIE = 0  # « NON SPECIFIE », catégorie 000, comme les contrats Vie d'URANUS
ID_OFFRE_VIE = 0
CODE_CATEGORIE_VIE = "000"
ID_GARANTIE_DECES = 231  # DÉCÈS TOUTES CAUSES
ID_AVENANT_AFN = 1
ID_AVENANT_REN = 2
AGE_MAX = 100
LIGNES_ENTETE_MAX = 15
LIGNES_VIDES_FIN = 3
TAILLE_FICHIER_MAX = 5 * 1024 * 1024
ACTES = {"RENOUVELLEMENT": "Renouvellement", "INCORPORATION": "Incorporation", "AFFAIRE NOUVELLE": "Affaire nouvelle",
         "NOUVELLE": "Affaire nouvelle", "AFN": "Affaire nouvelle", "REN": "Renouvellement", "INC": "Incorporation"}
# Colonnes reconnues par leur intitulé (sans accents ni ponctuation), dans l'ordre d'essai
COLONNES = [
    ("numero", re.compile(r"^(N|NO|NUM|NUMERO|N ORDRE)$")),
    ("acte", re.compile(r"ACTE|MOUVEMENT")),
    ("effet", re.compile(r"EFFET")),
    ("echeance", re.compile(r"ECHEANCE|EXPIRATION")),
    ("souscripteur", re.compile(r"SOUSCRIPTEUR")),
    ("naissance", re.compile(r"NAISSANCE")),
    ("nom", re.compile(r"\bNOMS?\b")),
    ("qualite", re.compile(r"QUALITE")),
    ("capital", re.compile(r"CAPITAL")),
    ("beneficiaire", re.compile(r"BENEFICIAIRE|AYANTS? DROIT")),
    ("prime", re.compile(r"PRIME")),
]
ENTETES_MODELE = ["N°", "ACTE", "DATE D'EFFET", "DATE D'ECHEANCE", "SOUSCRIPTEUR", "NOMS ET PRENOMS", "DATE DE NAISSANCE",
                  "EN QUALITE DE", "CAPITAL ASSURE", "BENEFICIAIRES", "PRIMES TTC"]


class ErreurAfa(Exception):
    pass


# ------------------------------------------------------------------ outils
def _norme(texte):
    texte = unicodedata.normalize("NFD", str(texte or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]+", " ", texte.upper()).strip()


def _iso(valeur):
    if isinstance(valeur, datetime):
        valeur = valeur.date()
    return valeur.isoformat() if isinstance(valeur, date) else None


def _date(valeur):
    """Date d'une cellule ou d'un champ : date Excel, nombre de série, texte JJ/MM/AAAA ou AAAA-MM-JJ."""
    if valeur in (None, ""):
        return None
    if isinstance(valeur, datetime):
        return valeur.date()
    if isinstance(valeur, date):
        return valeur
    if isinstance(valeur, (int, float)) and 1 < valeur < 80000:
        return (datetime(1899, 12, 30) + timedelta(days=int(valeur))).date()
    texte = str(valeur).strip()[:10]
    for format_ in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d.%m.%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(texte, format_).date()
        except ValueError:
            continue
    raise ValueError(f"date illisible « {valeur} »")


def _montant(valeur):
    if valeur in (None, ""):
        return None
    if isinstance(valeur, (int, float, Decimal)):
        return Decimal(str(valeur))
    texte = re.sub(r"[\s  ]|F\s*CFA$|FCFA$|F$", "", str(valeur).strip().upper()).replace(",", ".")
    try:
        return Decimal(texte)
    except InvalidOperation as erreur:
        raise ValueError(f"montant illisible « {valeur} »") from erreur


def _texte(valeur):
    return re.sub(r"\s+", " ", str(valeur or "")).strip().upper()


def _age(naissance, jour):
    if not naissance or not jour:
        return None
    return jour.year - naissance.year - ((jour.month, jour.day) < (naissance.month, naissance.day))


def _acte(valeur):
    norme = _norme(valeur)
    if not norme:
        return ""
    return ACTES.get(norme) or next((libelle for cle, libelle in ACTES.items() if cle in norme), str(valeur).strip().capitalize())


def _matricule(id_client):
    return str(id_client).zfill(20)


def _nombre(valeur):
    return float(valeur) if valeur is not None else None


# ------------------------------------------------------------------ lecture du fichier
def _valeurs_fusionnees(feuille):
    """Valeur de chaque cellule d'une plage fusionnée : celle de la cellule en haut à gauche."""
    valeurs = {}
    for plage in feuille.merged_cells.ranges:
        haut = feuille.cell(plage.min_row, plage.min_col).value
        for ligne in range(plage.min_row, plage.max_row + 1):
            for colonne in range(plage.min_col, plage.max_col + 1):
                valeurs[(ligne, colonne)] = haut
    return valeurs


def _entete(feuille, fusions):
    """(n° de la ligne d'en-tête, {clé: colonne}) : première ligne où l'on reconnaît le nom et deux autres colonnes."""
    for ligne in range(1, min(feuille.max_row, LIGNES_ENTETE_MAX) + 1):
        colonnes = {}
        for colonne in range(1, feuille.max_column + 1):
            intitule = _norme(fusions.get((ligne, colonne), feuille.cell(ligne, colonne).value))
            if not intitule:
                continue
            for cle, motif in COLONNES:
                if cle not in colonnes and motif.search(intitule):
                    colonnes[cle] = colonne
                    break
        if "nom" in colonnes and len(colonnes) >= 3:
            return ligne, colonnes
    return None, {}


def lire_fichier(contenu):
    """Lignes du fichier AFA, sans contrôle métier : {Titre, Lignes [...], TotalCapital, TotalPrime, Colonnes}."""
    try:
        classeur = load_workbook(io.BytesIO(contenu), data_only=True)
    except (InvalidFileException, zipfile.BadZipFile, KeyError, OSError, ValueError) as erreur:
        raise ErreurAfa("Fichier illisible : envoyez un classeur Excel (.xlsx).") from erreur
    for feuille in classeur.worksheets:
        fusions = _valeurs_fusionnees(feuille)
        ligne_entete, colonnes = _entete(feuille, fusions)
        if not ligne_entete:
            continue
        valeur = lambda l, cle: fusions.get((l, colonnes[cle]), feuille.cell(l, colonnes[cle]).value) if cle in colonnes else None  # noqa: E731
        titre = next((str(feuille.cell(l, 1).value).strip() for l in range(1, ligne_entete) if feuille.cell(l, 1).value), "")
        lignes, total_capital, total_prime, vides = [], None, None, 0
        for numero_ligne in range(ligne_entete + 1, feuille.max_row + 1):
            cellules = [fusions.get((numero_ligne, c), feuille.cell(numero_ligne, c).value) for c in range(1, feuille.max_column + 1)]
            if any(_norme(c) == "TOTAL" for c in cellules if isinstance(c, str)):
                total_capital, total_prime = valeur(numero_ligne, "capital"), valeur(numero_ligne, "prime")
                break
            nom = valeur(numero_ligne, "nom")
            if not str(nom or "").strip():
                vides += 1
                if vides >= LIGNES_VIDES_FIN:
                    break
                continue
            vides = 0
            lignes.append({cle: valeur(numero_ligne, cle) for cle in colonnes} | {"Ligne": numero_ligne})
        return {"Titre": titre, "Feuille": feuille.title, "Colonnes": sorted(colonnes), "Lignes": lignes,
                "TotalCapital": total_capital, "TotalPrime": total_prime}
    raise ErreurAfa("Ligne d'en-tête introuvable : le fichier doit comporter au moins les colonnes « NOMS ET PRENOMS », "
                    "« DATE DE NAISSANCE » et « PRIMES TTC » (modèle AFA).")


# ------------------------------------------------------------------ rapprochements avec la base
def _preferences(cursor, ids):
    """Rang de chaque fiche parmi des homonymes : fiche active (statut V), fiche déjà assurée dans un contrat de groupe
    (matricule = n° de client), référence de son groupe au dédoublonnage du 12/10/2026, puis la plus récente. Les fiches
    archivées (statut A) restent candidates : le dédoublonnage a archivé toutes les fiches sans contrat de souscripteur,
    donc les assurés des contrats IA et Vie."""
    if not ids:
        return {}
    cursor.execute("SELECT idclient, COALESCE(statut, '') <> 'A' FROM stdclient WHERE idclient = ANY(%s)", [list(ids)])
    actives = dict(cursor.fetchall())
    cursor.execute("SELECT DISTINCT TRIM(matricule) FROM stdcontratdetail WHERE TRIM(matricule) = ANY(%s)", [[_matricule(i) for i in ids]])
    assurees = {int(m) for (m,) in cursor.fetchall()}
    cursor.execute("SELECT idclient, motif FROM lephare_client_nettoyage WHERE idclient = ANY(%s)", [list(ids)])
    references = {i for i, motif in cursor.fetchall() if re.search(rf"r[ée]f\. #{i}", motif or "")}
    return {i: (actives.get(i, False), i in assurees, i in references, i) for i in ids}


def _clients_par_nom(cursor, nom_complet):
    """Clients dont le nom complet est celui donné, la fiche à retenir d'abord."""
    cle = _norme(nom_complet)
    premier = cle.split(" ")[0] if cle else ""
    if not premier:
        return []
    cursor.execute(
        "SELECT idclient, TRIM(COALESCE(nom, '') || ' ' || COALESCE(prenoms, '')) FROM stdclient WHERE UPPER(TRIM(nom)) LIKE %s",
        [f"{premier}%"],
    )
    candidats = [(i, nom) for i, nom in cursor.fetchall() if _norme(nom) == cle]
    rangs = _preferences(cursor, [i for i, _ in candidats])
    return sorted(candidats, key=lambda c: rangs.get(c[0], ()), reverse=True)


def _souscripteur(cursor, texte):
    """Souscripteur du fichier rapproché d'un client : celui qui a déjà des contrats Vie, sinon le plus récent."""
    if not str(texte or "").strip():
        return None
    candidats = _clients_par_nom(cursor, texte)
    if not candidats:
        return {"Texte": str(texte).strip(), "IdClient": None, "Nom": ""}
    ids = [i for i, _ in candidats]
    cursor.execute("SELECT idclient, COUNT(*) FROM stdcontrat WHERE idproduit = %s AND idclient = ANY(%s) GROUP BY 1",
                   [ID_PRODUIT_VIE, ids])
    contrats = dict(cursor.fetchall())
    # Candidats déjà classés par _clients_par_nom : à égalité de contrats Vie, le premier
    retenu = max(candidats, key=lambda c: (contrats.get(c[0], 0), -ids.index(c[0])))
    return {"Texte": str(texte).strip(), "IdClient": retenu[0], "Nom": retenu[1]}


def _rapprocher_assures(cursor, lignes):
    """Assuré déjà connu (même nom, même date de naissance) : son n° de client ; ressemblance seulement (orthographe,
    date voisine, fiche sans date) : proposition à confirmer à l'écran, jamais retenue d'office."""
    dates = sorted({l["_naissance"] for l in lignes if l.get("_naissance")})
    noms = sorted({l["Nom"] for l in lignes if l.get("Nom")})
    if not dates and not noms:
        return
    cursor.execute(
        """SELECT idclient, TRIM(COALESCE(nom, '') || ' ' || COALESCE(prenoms, '')), datenaissance::date FROM stdclient
           WHERE datenaissance::date = ANY(%s) OR UPPER(TRIM(nom)) = ANY(%s)""",
        [dates, noms],
    )
    candidats = [(i, nom, _norme(nom), naissance) for i, nom, naissance in cursor.fetchall()]
    rangs = _preferences(cursor, [c[0] for c in candidats if c[2] in {_norme(l["NomComplet"]) for l in lignes}]
                         + [c[0] for c in candidats if c[3] in set(dates)])
    for l in lignes:
        cle, naissance = _norme(l["NomComplet"]), l.get("_naissance")
        exacts = [c for c in candidats if c[2] == cle and c[3] == naissance and naissance]
        if exacts:
            retenu = max(exacts, key=lambda c: rangs.get(c[0], (False, False, False, c[0])))
            l["IdClient"] = retenu[0]
            l["ClientConnu"] = {"IdClient": retenu[0], "Nom": retenu[1], "DateNaissance": _iso(retenu[3])}
            continue
        proches = []
        for i, nom, norme, date_fiche in candidats:
            if naissance and date_fiche == naissance:
                ressemblance = difflib.SequenceMatcher(None, cle, norme).ratio()
                if ressemblance >= 0.85:
                    proches.append((ressemblance, i, nom, date_fiche, "orthographe du nom différente"))
            elif norme == cle and date_fiche and naissance and abs((date_fiche - naissance).days) <= 31:
                proches.append((0.9, i, nom, date_fiche, f"date de naissance du {date_fiche:%d/%m/%Y} dans la fiche"))
            elif norme == cle and not date_fiche:
                proches.append((0.8, i, nom, None, "fiche sans date de naissance"))
        if proches:
            _, i, nom, date_fiche, motif = max(proches, key=lambda p: (p[0], rangs.get(p[1], ())))
            l["Proposition"] = {"IdClient": i, "Nom": nom, "DateNaissance": _iso(date_fiche), "Motif": motif}


def _polices_vie(cursor, id_client):
    """Polices Vie du client : contrat de base (affaire nouvelle ou dernier renouvellement) de chaque police."""
    if not id_client:
        return []
    lignes = _lignes(
        cursor,
        """
        SELECT DISTINCT ON (c.numeropolice) c.idcontrat, c.numeropolice, c.idcompagnie, TRIM(co.raisonsociale) AS compagnie,
               c.dateeffet::date AS dateeffet, c.dateexpiration::date AS dateexpiration, c.primettc
        FROM stdcontrat c
        JOIN stdavenant a ON a.idavenant = c.idavenant
        LEFT JOIN stdcompagnie co ON co.idcompagnie = c.idcompagnie
        WHERE c.idclient = %s AND c.idproduit = %s AND COALESCE(c.idcontratannulation, 0) = 0
          AND a.codeavenant IN ('AFN', 'REN', 'RPP', 'TRP')
          AND NOT EXISTS (SELECT 1 FROM stdcontrat r JOIN stdavenant ra ON ra.idavenant = r.idavenant
                          WHERE r.numeropolice = c.numeropolice AND ra.codeavenant = 'RES' AND COALESCE(r.idcontratannulation, 0) = 0)
        ORDER BY c.numeropolice, c.dateeffet DESC, c.idcontrat DESC
        """,
        [id_client, ID_PRODUIT_VIE],
    )
    lignes.sort(key=lambda l: l["dateexpiration"] or date.min, reverse=True)
    return [{"IdContrat": l["idcontrat"], "NumeroPolice": l["numeropolice"], "IdCompagnie": l["idcompagnie"],
             "Compagnie": l["compagnie"] or "", "DateEffet": _iso(l["dateeffet"]), "DateExpiration": _iso(l["dateexpiration"]),
             "PrimeTtc": _nombre(l["primettc"])} for l in lignes]


def _compagnies(cursor):
    """Compagnies auxquelles le cabinet est rattaché (numérotation des devis et des polices) : celle proposée pour la
    Vie d'abord (SANLAM, qui gère la Vie, consigne du 2026-11-02), puis les compagnies Vie, puis les autres."""
    lignes = _lignes(
        cursor,
        """SELECT co.idcompagnie, TRIM(co.raisonsociale) AS libelle FROM stdcompagnie co
           JOIN stdintermediairecompagnie ic ON ic.idcompagnie = co.idcompagnie AND ic.idintermediaire = %s
           ORDER BY co.idcompagnie = %s DESC, (co.raisonsociale ILIKE '%%VIE%%') DESC, co.raisonsociale""",
        [ID_INTERMEDIAIRE, compagnie_par_defaut(ID_PRODUIT_VIE) or 0],
    )
    return [{"IdCompagnie": l["idcompagnie"], "Libelle": l["libelle"]} for l in lignes]


# ------------------------------------------------------------------ analyse (import)
def analyser(contenu):
    fichier = lire_fichier(contenu)
    erreurs, avertissements, lignes = [], [], []
    periodes, souscripteurs, vus = {}, set(), {}
    for brute in fichier["Lignes"]:
        l = {"Ligne": brute["Ligne"], "Numero": brute.get("numero"), "Erreurs": [], "Avertissements": [],
             "IdClient": None, "ClientConnu": None, "Proposition": None}
        nom_complet = _texte(brute.get("nom"))
        morceaux = nom_complet.split(" ")
        l.update({"NomComplet": nom_complet, "Nom": morceaux[0], "Prenoms": " ".join(morceaux[1:]),
                  "Qualite": _texte(brute.get("qualite")) or "ASSURE PRINCIPAL", "Acte": _acte(brute.get("acte")),
                  "Beneficiaires": _texte(brute.get("beneficiaire"))})
        for cle, champ, libelle in (("naissance", "_naissance", "Date de naissance"), ("effet", "_effet", "Date d'effet"),
                                    ("echeance", "_echeance", "Date d'échéance")):
            try:
                l[champ] = _date(brute.get(cle))
            except ValueError as erreur:
                l[champ] = None
                l["Erreurs"].append(f"{libelle} : {erreur}.")
        for cle, champ, libelle in (("capital", "Capital", "Capital assuré"), ("prime", "PrimeTtc", "Prime TTC")):
            try:
                montant = _montant(brute.get(cle))
            except ValueError as erreur:
                montant = None
                l["Erreurs"].append(f"{libelle} : {erreur}.")
            l[champ] = _nombre(montant)
            if montant is None and not any(e.startswith(libelle) for e in l["Erreurs"]):
                l["Erreurs"].append(f"{libelle} absent.")
            elif montant is not None and montant <= 0:
                l["Erreurs"].append(f"{libelle} : le montant doit être positif.")
        if len(morceaux) < 2:
            l["Avertissements"].append("Prénoms absents : vérifiez le nom de l'assuré.")
        if not l["_naissance"] and not any(e.startswith("Date de naissance") for e in l["Erreurs"]):
            l["Erreurs"].append("Date de naissance absente.")
        if not l["_effet"] or not l["_echeance"]:
            if not any(e.startswith("Date d'") for e in l["Erreurs"]):
                l["Erreurs"].append("Dates d'effet et d'échéance du contrat absentes.")
        elif l["_echeance"] < l["_effet"]:
            l["Erreurs"].append("La date d'échéance précède la date d'effet.")
        age = _age(l["_naissance"], l["_effet"] or date.today())
        l["Age"] = age
        if l["_naissance"] and (l["_naissance"] > (l["_effet"] or date.today()) or (age is not None and age > AGE_MAX)):
            l["Erreurs"].append("Date de naissance invraisemblable.")
        if not l["Beneficiaires"]:
            l["Avertissements"].append("Aucun bénéficiaire indiqué.")
        if brute.get("acte") not in (None, "") and l["Acte"] not in ACTES.values():
            l["Avertissements"].append(f"Acte « {brute.get('acte')} » non reconnu (Renouvellement, Incorporation ou Affaire nouvelle).")
        doublon = (_norme(nom_complet), l["_naissance"])
        if doublon in vus:
            l["Erreurs"].append(f"Assuré déjà présent à la ligne {vus[doublon]} du fichier.")
        else:
            vus[doublon] = l["Ligne"]
        if l["_effet"] and l["_echeance"]:
            periodes.setdefault((l["_effet"], l["_echeance"]), []).append(l)
        if str(brute.get("souscripteur") or "").strip():
            souscripteurs.add(_texte(brute.get("souscripteur")))
        lignes.append(l)

    if not lignes:
        raise ErreurAfa("Aucun assuré trouvé sous la ligne d'en-tête du fichier.")
    periode = max(periodes, key=lambda p: len(periodes[p])) if periodes else (None, None)
    for (effet, echeance), concernees in periodes.items():
        if (effet, echeance) != periode:
            for l in concernees:
                l["Erreurs"].append(f"Période du {effet:%d/%m/%Y} au {echeance:%d/%m/%Y}, différente du reste du fichier : "
                                    "à enregistrer dans un devis à part (incorporation).")
    if len(souscripteurs) > 1:
        avertissements.append(f"Plusieurs souscripteurs dans le fichier ({', '.join(sorted(souscripteurs))}) : "
                              "le devis n'en retient qu'un.")
    total_capital = sum(Decimal(str(l["Capital"])) for l in lignes if l["Capital"])
    total_prime = sum(Decimal(str(l["PrimeTtc"])) for l in lignes if l["PrimeTtc"])
    for libelle, calcule, fichier_total in (("primes", total_prime, fichier["TotalPrime"]), ("capitaux", total_capital, fichier["TotalCapital"])):
        try:
            attendu = _montant(fichier_total)
        except ValueError:
            attendu = None
        if attendu is not None and attendu != calcule:
            avertissements.append(f"Total des {libelle} du fichier ({attendu:,.0f} F) différent de la somme des lignes "
                                  f"({calcule:,.0f} F).".replace(",", " "))

    with connection.cursor() as cursor:
        _rapprocher_assures(cursor, lignes)
        souscripteur = _souscripteur(cursor, next(iter(sorted(souscripteurs)), "")) if souscripteurs else None
        polices = _polices_vie(cursor, souscripteur and souscripteur["IdClient"])
    for l in lignes:
        if l["Proposition"]:
            l["Avertissements"].append(f"Assuré peut-être déjà enregistré : {l['Proposition']['Nom']} "
                                       f"({l['Proposition']['Motif']}).".replace("(", "- ").replace(")", ""))
        l["DateNaissance"] = _iso(l.pop("_naissance"))
        l.pop("_effet", None)
        l.pop("_echeance", None)
    if any(l["Erreurs"] for l in lignes):
        erreurs.append(f"{sum(1 for l in lignes if l['Erreurs'])} ligne(s) en erreur : corrigez le fichier ou retirez-les.")
    return {
        "Titre": fichier["Titre"], "Feuille": fichier["Feuille"], "Souscripteur": souscripteur,
        "DateEffet": _iso(periode[0]), "DateExpiration": _iso(periode[1]), "Polices": polices,
        "Lignes": lignes, "Erreurs": erreurs, "Avertissements": avertissements,
        "Totaux": {"Assures": len(lignes), "Capital": float(total_capital), "PrimeTtc": float(total_prime),
                   "Connus": sum(1 for l in lignes if l["IdClient"]), "AVerifier": sum(1 for l in lignes if l["Proposition"])},
    }


# ------------------------------------------------------------------ enregistrement
def _entete_saisie(donnees):
    try:
        id_compagnie = int(donnees.get("IdCompagnie") or 0)
        id_client = int(donnees.get("IdClient") or 0)
        id_devis = int(donnees.get("IdDevis") or 0)
        id_contrat = int(donnees.get("IdContratRenouvele") or 0)
    except (TypeError, ValueError) as erreur:
        raise ErreurAfa("Identifiants du devis illisibles.") from erreur
    try:
        effet, echeance = _date(donnees.get("DateEffet")), _date(donnees.get("DateExpiration"))
        accessoire = _montant(donnees.get("Accessoire")) or Decimal(0)
    except ValueError as erreur:
        raise ErreurAfa(f"{erreur}.") from erreur
    if not id_compagnie:
        raise ErreurAfa("Choisissez la compagnie.")
    if not id_client:
        raise ErreurAfa("Choisissez le souscripteur.")
    if not effet or not echeance:
        raise ErreurAfa("Saisissez les dates d'effet et d'échéance.")
    if echeance < effet:
        raise ErreurAfa("La date d'échéance précède la date d'effet.")
    if accessoire < 0:
        raise ErreurAfa("L'accessoire ne peut pas être négatif.")
    return {"IdDevis": id_devis, "IdCompagnie": id_compagnie, "IdClient": id_client, "IdContratRenouvele": id_contrat,
            "DateEffet": effet, "DateExpiration": echeance, "Accessoire": accessoire,
            "NumeroPoliceCompagnie": str(donnees.get("NumeroPoliceCompagnie") or "").strip()[:50] or None}


def _assures_saisis(donnees, effet):
    assures = []
    for rang, a in enumerate(donnees.get("Assures") or [], 1):
        nom, prenoms = _texte(a.get("Nom")), _texte(a.get("Prenoms"))
        libelle = f"Assuré {rang}{f' ({nom} {prenoms})'.rstrip() if nom else ''}".replace("(", "- ").replace(")", "")
        if not nom:
            raise ErreurAfa(f"Assuré {rang} : nom absent.")
        try:
            naissance = _date(a.get("DateNaissance"))
            capital, prime = _montant(a.get("Capital")), _montant(a.get("PrimeTtc"))
        except ValueError as erreur:
            raise ErreurAfa(f"{libelle} : {erreur}.") from erreur
        if not naissance:
            raise ErreurAfa(f"{libelle} : date de naissance absente.")
        age = _age(naissance, effet)
        if naissance > effet or age > AGE_MAX:
            raise ErreurAfa(f"{libelle} : date de naissance invraisemblable.")
        if not capital or capital <= 0 or not prime or prime <= 0:
            raise ErreurAfa(f"{libelle} : capital et prime doivent être positifs.")
        try:
            id_client = int(a.get("IdClient") or 0)
        except (TypeError, ValueError):
            id_client = 0
        sexe = _texte(a.get("Sexe"))[:1]
        assures.append({"Rang": rang, "IdClient": id_client, "Nom": nom, "Prenoms": prenoms, "DateNaissance": naissance,
                        "Sexe": sexe if sexe in ("M", "F") else "", "Capital": capital, "Prime": prime,
                        "Qualite": _texte(a.get("Qualite"))[:60] or "ASSURE PRINCIPAL",
                        "Beneficiaires": _texte(a.get("Beneficiaires"))[:500], "Acte": _acte(a.get("Acte"))[:30],
                        "Libelle": libelle})
    if not assures:
        raise ErreurAfa("Ajoutez au moins un assuré.")
    return assures


def _client_assure(cursor, assure):
    """N° de client de l'assuré : celui transmis (vérifié), sinon une nouvelle fiche client."""
    if assure["IdClient"]:
        cursor.execute("SELECT datenaissance FROM stdclient WHERE idclient = %s", [assure["IdClient"]])
        ligne = cursor.fetchone()
        if not ligne:
            raise ErreurAfa(f"{assure['Libelle']} : client n° {assure['IdClient']} introuvable.")
        if ligne[0] is None:
            cursor.execute("UPDATE stdclient SET datenaissance = %s WHERE idclient = %s", [assure["DateNaissance"], assure["IdClient"]])
        return assure["IdClient"]
    # Fiche aux mêmes nom, prénoms et date de naissance (clé unique de stdclient) : reprise plutôt qu'en double
    cursor.execute(
        "SELECT idclient FROM stdclient WHERE cle_unique = %s",
        [f"COMP-{assure['Nom'].lower()}|{assure['Prenoms'].lower()}|{assure['DateNaissance'].isoformat()}"],
    )
    existant = cursor.fetchone()
    if existant:
        return existant[0]
    client = insert_new_assure({"Nom": assure["Nom"], "Prenoms": assure["Prenoms"], "DateNaissance": assure["DateNaissance"],
                                "Sexe": assure["Sexe"]})
    return client.IdClient


def _verifier_devis(cursor, id_devis):
    cursor.execute("SELECT idproduit, COALESCE(confirme, FALSE), COALESCE(archive, FALSE) FROM stddevis WHERE iddevis = %s", [id_devis])
    ligne = cursor.fetchone()
    if not ligne or ligne[0] != ID_PRODUIT_VIE:
        raise ErreurAfa(f"Devis Vie n° {id_devis} introuvable.")
    if ligne[1]:
        raise ErreurAfa("Devis déjà confirmé : il ne peut plus être modifié.")
    if ligne[2]:
        raise ErreurAfa("Devis archivé : il ne peut plus être modifié.")


def _devis_affaire_nouvelle(cursor, entete, id_utilisateur):
    cursor.execute("CALL sp_numeroter_avenant(%s, %s, NULL, '')", [ID_AVENANT_AFN, ID_INTERMEDIAIRE])
    numero_avenant = cursor.fetchone()[0]
    cursor.execute("CALL sp_generer_numero_devis(%s, %s, %s, '', '')", [ID_INTERMEDIAIRE, entete["IdCompagnie"], CODE_CATEGORIE_VIE])
    numero_devis, message = cursor.fetchone()
    if not numero_devis:
        raise ErreurAfa(message or "Numéro de devis non attribué : la compagnie n'est pas rattachée au cabinet.")
    cursor.execute(
        """
        INSERT INTO stddevis (idoperateur, idoffre, idintermediaire, idcompagnie, idproduit, idclient, idassure, idavenant,
            numeroavenant, numerodevis, flotte, idaperiteur, coassurance, periode, dateemission, dateeffet, dateexpiration,
            confirme, accessoirecompagnie, idduree, idterme, numeropolicecompagnie, primeimposee)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, %s, FALSE, fn_calcul_periode_contrat(%s::date - %s::date),
            %s, %s, %s, FALSE, 0, fn_calcul_id_duree_contrat(%s::date - %s::date), 1, %s, TRUE)
        RETURNING iddevis
        """,
        [id_utilisateur, ID_OFFRE_VIE, ID_INTERMEDIAIRE, entete["IdCompagnie"], ID_PRODUIT_VIE, entete["IdClient"],
         entete["IdClient"], ID_AVENANT_AFN, numero_avenant, numero_devis, entete["IdCompagnie"],
         entete["DateExpiration"], entete["DateEffet"], date_emission_du_jour(), entete["DateEffet"], entete["DateExpiration"],
         entete["DateExpiration"], entete["DateEffet"], entete["NumeroPoliceCompagnie"]],
    )
    return cursor.fetchone()[0]


def _devis_renouvellement(cursor, entete, id_utilisateur, mensuel=False):
    """Devis REN de la police (même numéro de police à la confirmation), ses lignes reprises remplacées ensuite.
    mensuel : état de cotisations, un renouvellement par mois comme dans URANUS."""
    try:
        base = _contrat_base(cursor, entete["IdContratRenouvele"])
    except ErreurRenouvellement as erreur:
        raise ErreurAfa(str(erreur)) from erreur
    if base["idproduit"] != ID_PRODUIT_VIE:
        raise ErreurAfa("La police à renouveler n'est pas une police Vie.")
    if base["idclient"] != entete["IdClient"]:
        raise ErreurAfa("La police à renouveler appartient à un autre souscripteur.")
    if base["idcompagnie"] != entete["IdCompagnie"]:
        raise ErreurAfa(f"La police {base['numeropolice']} est chez {base['compagnie']} : choisissez cette compagnie pour la renouveler.")
    if entete["DateEffet"] <= base["dateeffet"]:
        if mensuel:
            raise ErreurAfa(f"La police {base['numeropolice']} couvre déjà le mois du {base['dateeffet']:%d/%m/%Y} : "
                            "l'état à enregistrer est celui d'un mois suivant.")
        raise ErreurAfa(f"Le renouvellement doit prendre effet après le {base['dateeffet']:%d/%m/%Y}, début de la période en cours.")
    en_cours = _lignes(
        cursor,
        """SELECT d.numerodevis, d.dateeffet::date AS dateeffet FROM stddevis d JOIN stdavenant a ON a.idavenant = d.idavenant
           WHERE a.codeavenant = 'REN' AND d.idoldhist = %s AND NOT COALESCE(d.confirme, FALSE) AND NOT COALESCE(d.archive, FALSE)""",
        [base["iddevis"]],
    )
    if en_cours:
        if mensuel and en_cours[0]["dateeffet"] == entete["DateEffet"]:
            raise ErreurAfa(f"Le mois du {entete['DateEffet']:%d/%m/%Y} est déjà ouvert sur la police {base['numeropolice']} (devis "
                            f"{en_cours[0]['numerodevis']}) : ouvrez ce devis (Modifier) et importez-y l'état du mois.")
        if mensuel:
            raise ErreurAfa(f"L'état précédent de la police {base['numeropolice']} (devis {en_cours[0]['numerodevis']}) n'est pas encore "
                            "confirmé : confirmez-le d'abord, chaque mois renouvelle la police.")
        raise ErreurAfa(f"Un devis de renouvellement de cette police est déjà en cours ({en_cours[0]['numerodevis']}) : modifiez-le.")
    cursor.execute(
        "CALL sp_avenant_creation_devis_initial(%s, %s, %s, %s, %s, %s, '', 0, '')",
        [id_utilisateur, base["idcontrat"], ID_AVENANT_REN, date_emission_du_jour(), entete["DateEffet"], entete["DateExpiration"]],
    )
    id_devis, message = cursor.fetchone()
    if not id_devis:
        raise ErreurAfa(message or "Le devis de renouvellement n'a pas pu être créé.")
    return id_devis


def _entete_incorporation(cursor, id_devis, entete, incorporation):
    """Devis d'incorporation : échéance de la police, date d'incorporation dans sa période, souscripteur et compagnie
    de la police (repris d'office, l'écran les affiche sans les laisser changer)."""
    try:
        _verifier_periode_devis("INC", incorporation["debut"], incorporation["dateexpiration"], entete["DateEffet"], entete["DateExpiration"])
    except ValueError as erreur:
        raise ErreurAfa(str(erreur)) from erreur
    cursor.execute("SELECT idclient, idcompagnie FROM stddevis WHERE iddevis = %s", [id_devis])
    entete["IdClient"], entete["IdCompagnie"] = cursor.fetchone()
    entete["IdContratRenouvele"] = 0


def _controler_incorpores(cursor, id_devis, assures):
    """Personnes ajoutées seulement : un assuré déjà couvert par la police (période en cours, incorporations comprises)
    est refusé ; acte « Incorporation » par défaut."""
    for assure in assures:
        try:
            controler_assure_incorpore(cursor, id_devis, assure["IdClient"], f"{assure['Nom']} {assure['Prenoms']}".strip())
        except ValueError as erreur:
            raise ErreurAfa(f"Assuré {assure['Rang']} : {erreur}") from erreur
        assure["Acte"] = assure["Acte"] or ACTES["INC"]


def _offre_saisie(cursor, id_offre, id_devis, incorporation):
    """Offre commerciale du devis : celle de la police pour une incorporation, sinon celle choisie à l'écran (aucune
    transmise : celle du devis modifié, sinon AFA, comme pour le package Oreole Santé)."""
    if incorporation:
        offre = vie_offres.offre_du_devis(cursor, id_devis)
        if offre["Saisie"] == vie_offres.SAISIE_COTISATION:
            raise ErreurAfa(f"{offre['Libelle']} : un salarié entrant figure dans l'état des cotisations du mois, pas dans une incorporation.")
        return offre
    if not id_offre and id_devis:
        return vie_offres.offre_du_devis(cursor, id_devis)
    offre = vie_offres.offre_par_id(cursor, id_offre)
    if not offre:
        raise ErreurAfa("Offre commerciale inconnue : choisissez-la dans la liste.")
    if not offre["Actif"] and (not id_devis or vie_offres.offre_du_devis(cursor, id_devis)["IdOffre"] != offre["IdOffre"]):
        raise ErreurAfa(f"L'offre « {offre['Libelle']} » n'est plus proposée (Réglages Vie).")
    return offre


def enregistrer(donnees, id_utilisateur):
    from . import vie_retraite  # import local : vie_retraite reprend les outils de ce module

    entete = _entete_saisie(donnees)
    try:
        id_offre = int(donnees.get("IdOffreVie") or 0)
    except (TypeError, ValueError) as erreur:
        raise ErreurAfa("Offre commerciale illisible.") from erreur
    with transaction.atomic(), connection.cursor() as cursor:
        id_devis = entete["IdDevis"]
        incorporation = None
        if id_devis:
            _verifier_devis(cursor, id_devis)
            incorporation = _devis_incorporation(cursor, id_devis)
            if incorporation:
                _entete_incorporation(cursor, id_devis, entete, incorporation)
        offre = _offre_saisie(cursor, id_offre, id_devis, incorporation)
        cotisations = offre["Saisie"] == vie_offres.SAISIE_COTISATION
        if cotisations:
            if not vie_offres.tables_presentes(cursor):
                raise ErreurAfa(f"{offre['Libelle']} indisponible : la migration {vie_offres.MIGRATION} n'est pas appliquée sur cette base.")
            vie_retraite.controler_periode(offre, entete)
            cotisants = vie_retraite.cotisants_saisis(donnees)
            assures = []
        else:
            assures, cotisants = _assures_saisis(donnees, entete["DateEffet"]), []
        # Incorporation : compagnie de la police, même si elle n'est plus proposée pour les affaires nouvelles
        if not incorporation and entete["IdCompagnie"] not in {c["IdCompagnie"] for c in _compagnies(cursor)}:
            raise ErreurAfa("Compagnie non rattachée au cabinet.")
        cursor.execute("SELECT 1 FROM stdclient WHERE idclient = %s", [entete["IdClient"]])
        if not cursor.fetchone():
            raise ErreurAfa(f"Souscripteur n° {entete['IdClient']} introuvable.")
        fichier = str(donnees.get("Fichier") or "").strip()
        if cotisations:
            doublon = vie_retraite.mois_deja_enregistre(cursor, entete["IdClient"], entete["DateEffet"], id_devis)
            if doublon:
                raise ErreurAfa(f"L'état de {vie_retraite.libelle_mois(entete['DateEffet'])} de ce souscripteur est déjà enregistré "
                                f"(devis {doublon['NumeroDevis']}) : modifiez ce devis.")
            # Mois suivant déjà ouvert sans son état (devis de renouvellement qui n'a recopié que le total du mois précédent) : le fichier aussi
            if id_devis and not incorporation and offre["Periodicite"] == "MENSUELLE" and not fichier:
                cursor.execute("""SELECT a.codeavenant = 'REN', EXISTS (SELECT 1 FROM lephare_vie_cotisant c WHERE c.iddevis = d.iddevis)
                                  FROM stddevis d JOIN stdavenant a ON a.idavenant = d.idavenant WHERE d.iddevis = %s""", [id_devis])
                renouvellement, etat_present = cursor.fetchone()
                if renouvellement and not etat_present:
                    raise ErreurAfa(vie_retraite.message_fichier_exige(entete["DateEffet"]))
        for assure in assures:
            assure["IdClient"] = _client_assure(cursor, assure)
        vus = {}
        for assure in assures:
            if assure["IdClient"] in vus:
                raise ErreurAfa(f"{assure['Libelle']} : même client que l'assuré {vus[assure['IdClient']]}.")
            vus[assure["IdClient"]] = assure["Rang"]

        if incorporation:
            _controler_incorpores(cursor, id_devis, assures)
        elif not id_devis:
            if entete["IdContratRenouvele"]:
                mensuel = cotisations and offre["Periodicite"] == "MENSUELLE"
                # Mois suivant d'une police d'état des cotisations : avec le fichier du souscripteur, chaque mois (demande du 2026-11-11)
                if mensuel and not fichier:
                    raise ErreurAfa(vie_retraite.message_fichier_exige(entete["DateEffet"]))
                id_devis = _devis_renouvellement(cursor, entete, id_utilisateur, mensuel=mensuel)
            else:
                id_devis = _devis_affaire_nouvelle(cursor, entete, id_utilisateur)

        cursor.execute(
            """
            UPDATE stddevis SET idoperateur = %s, idcompagnie = %s, idaperiteur = %s, idclient = %s, idassure = %s, idoffre = %s,
                   flotte = TRUE, coassurance = FALSE, periode = fn_calcul_periode_contrat(%s::date - %s::date),
                   dateemission = %s, dateeffet = %s, dateexpiration = %s, idduree = fn_calcul_id_duree_contrat(%s::date - %s::date),
                   numeropolicecompagnie = %s, primeimposee = TRUE
            WHERE iddevis = %s
            """,
            [id_utilisateur, entete["IdCompagnie"], entete["IdCompagnie"], entete["IdClient"], entete["IdClient"], ID_OFFRE_VIE,
             entete["DateExpiration"], entete["DateEffet"], date_emission_du_jour(), entete["DateEffet"], entete["DateExpiration"],
             entete["DateExpiration"], entete["DateEffet"], entete["NumeroPoliceCompagnie"], id_devis],
        )
        # Lignes remplacées : celles d'une saisie précédente ou reprises de la police par le renouvellement
        cursor.execute("DELETE FROM stddevisdetgarantie WHERE iddevisdet IN (SELECT iddevisdetail FROM stddevisdetail WHERE iddevis = %s)", [id_devis])
        cursor.execute("DELETE FROM stddevisdetail WHERE iddevis = %s", [id_devis])
        cursor.execute("DELETE FROM lephare_afa_assure WHERE iddevis = %s", [id_devis])
        if vie_offres.tables_presentes(cursor):
            cursor.execute("DELETE FROM lephare_vie_cotisant WHERE iddevis = %s", [id_devis])
        prime_nette = sum((a["Prime"] for a in assures), Decimal(0))
        if cotisations:
            prime_nette = vie_retraite.ecrire_cotisants(cursor, id_devis, offre, cotisants, ID_OFFRE_VIE, ID_TARIF_VIE)
        for assure in assures:
            nom = f"{assure['Nom']} {assure['Prenoms']}".strip()[:100]
            cursor.execute(
                """
                INSERT INTO stddevisdetail (iddevis, idoffre, idtarif, vehicule, idusage, codeusage, reference, idcarrosserie,
                    puissancefiscale, nombreplace, chargeutile, valeurneuve, valeurvenale, valeuraccessoire, remorque, conducteur,
                    adressecnd, datemec, datemutation, nummoteur, numchassis, typevehicule, idmarque, matricule, carteverte, essence,
                    numpccnd, tauxreduction, primeimposee, primeannuelle, primenette, taxeenregistrement, sexe, observation)
                VALUES (%s, %s, %s, 0, 0, '000', '000', 0, 0, 0, 0, 0, %s, 0, FALSE, %s, '', %s, %s, '', '', '', 0, %s, FALSE, 0,
                    '', 0, TRUE, %s, %s, 0, %s, %s)
                RETURNING iddevisdetail
                """,
                [id_devis, ID_OFFRE_VIE, ID_TARIF_VIE, assure["Capital"], nom, assure["DateNaissance"], assure["DateNaissance"],
                 _matricule(assure["IdClient"]), assure["Prime"], assure["Prime"], assure["Sexe"], assure["Acte"]],
            )
            id_detail = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO stddevisdetgarantie (iddevisdet, idgarantie, acquise, taxe, capital, tauxfranchise, minfranchise,
                    maxfranchise, franchise, textefranchise, primeannuelle, primenette, old_acquise, old_primenette)
                VALUES (%s, %s, TRUE, 0, %s, 0, 0, 0, 0, 'NEANT', %s, %s, '1', %s)
                """,
                [id_detail, offre["IdGarantie"], assure["Capital"], assure["Prime"], assure["Prime"], assure["Prime"]],
            )
            cursor.execute(
                """INSERT INTO lephare_afa_assure (iddevis, idclient, ordre, qualite, beneficiaires, acte)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                [id_devis, assure["IdClient"], assure["Rang"], assure["Qualite"], assure["Beneficiaires"], assure["Acte"]],
            )
        vie_offres.lier_devis(cursor, id_devis, offre, str(donnees.get("Fichier") or "").strip())
        cursor.execute("SELECT COALESCE(fn_get_taux_commission(%s, %s, %s), 0)", [ID_PRODUIT_VIE, entete["IdCompagnie"], date_emission_du_jour()])
        taux_commission = Decimal(str(cursor.fetchone()[0] or 0))
        cursor.execute(
            """
            UPDATE stddevis SET primeannuelle = %s, primenette = %s, accessoire = %s, accessoirecompagnie = %s,
                   accessoireintermediaire = 0, accessoiregestionnaire = 0, taxe = 0, fga = 0, cedeao = 0, primettc = %s,
                   commissionintermediaire = ROUND(%s * %s / 100, 0)
            WHERE iddevis = %s
            """,
            [prime_nette, prime_nette, entete["Accessoire"], entete["Accessoire"], prime_nette + entete["Accessoire"],
             prime_nette, taux_commission, id_devis],
        )
        devis = lire(cursor, id_devis)
    return devis


# ------------------------------------------------------------------ relecture
def lire(cursor, id_devis):
    """Devis Vie tel qu'enregistré (None pour un autre devis) : en-tête, police renouvelée, assurés."""
    entetes = _lignes(
        cursor,
        """
        SELECT d.iddevis, d.numerodevis, d.idproduit, d.idcompagnie, TRIM(co.raisonsociale) AS compagnie, d.idclient,
               TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS client, d.dateeffet::date AS dateeffet,
               d.dateexpiration::date AS dateexpiration, d.numeropolicecompagnie, d.accessoire, d.primenette, d.primettc,
               COALESCE(d.confirme, FALSE) AS confirme, a.codeavenant, a.libelleavenant,
               (SELECT c.idcontrat FROM stdcontrat c WHERE c.iddevis = d.idoldhist ORDER BY c.idcontrat DESC LIMIT 1) AS idcontratrenouvele,
               (SELECT c.numeropolice FROM stdcontrat c WHERE c.iddevis = d.idoldhist ORDER BY c.idcontrat DESC LIMIT 1) AS policerenouvelee
        FROM stddevis d
        LEFT JOIN stdcompagnie co ON co.idcompagnie = d.idcompagnie
        LEFT JOIN stdclient cl ON cl.idclient = d.idclient
        LEFT JOIN stdavenant a ON a.idavenant = d.idavenant
        WHERE d.iddevis = %s
        """,
        [id_devis],
    )
    if not entetes or entetes[0]["idproduit"] != ID_PRODUIT_VIE:
        return None
    from . import vie_retraite  # import local : vie_retraite reprend les outils de ce module

    e = entetes[0]
    offre = vie_offres.offre_du_devis(cursor, id_devis)
    cotisations = offre["Saisie"] == vie_offres.SAISIE_COTISATION
    lignes = [] if cotisations else _lignes(
        cursor,
        """
        SELECT dd.iddevisdetail, dd.conducteur, dd.datemec::date AS datemec, dd.valeurvenale, dd.primenette, dd.sexe, dd.observation,
               g.capital, cl.idclient, cl.nom, cl.prenoms, cl.datenaissance::date AS datenaissance, x.ordre, x.qualite, x.beneficiaires, x.acte
        FROM stddevisdetail dd
        LEFT JOIN LATERAL (SELECT capital FROM stddevisdetgarantie WHERE iddevisdet = dd.iddevisdetail AND acquise
                           ORDER BY idgarantie = %s DESC LIMIT 1) g ON TRUE
        LEFT JOIN stdclient cl ON cl.idclient = CASE WHEN TRIM(dd.matricule) ~ '^0*[0-9]{1,15}$' THEN TRIM(dd.matricule)::bigint END
        LEFT JOIN lephare_afa_assure x ON x.iddevis = dd.iddevis AND x.idclient = cl.idclient
        WHERE dd.iddevis = %s
        ORDER BY x.ordre NULLS LAST, dd.iddevisdetail
        """,
        [offre["IdGarantie"], id_devis],
    )
    assures = []
    for l in lignes:
        nom, prenoms = (l["nom"] or "").strip(), (l["prenoms"] or "").strip()
        if not nom:
            morceaux = (l["conducteur"] or "").strip().split(" ")
            nom, prenoms = morceaux[0], " ".join(morceaux[1:])
        assures.append({
            "IdClient": l["idclient"], "Nom": nom, "Prenoms": prenoms,
            "DateNaissance": _iso(l["datenaissance"] or l["datemec"]), "Sexe": (l["sexe"] or "").strip(),
            "Qualite": l["qualite"] or "ASSURE PRINCIPAL", "Capital": _nombre(l["capital"] if l["capital"] else l["valeurvenale"]),
            "PrimeTtc": _nombre(l["primenette"]), "Beneficiaires": l["beneficiaires"] or "",
            "Acte": l["acte"] or (l["observation"] or "").strip(),
        })
    return {
        "IdDevis": e["iddevis"], "NumeroDevis": e["numerodevis"], "IdCompagnie": e["idcompagnie"], "Compagnie": e["compagnie"] or "",
        "IdClient": e["idclient"], "Client": e["client"] or "", "DateEffet": _iso(e["dateeffet"]), "DateExpiration": _iso(e["dateexpiration"]),
        "NumeroPoliceCompagnie": e["numeropolicecompagnie"] or "", "Accessoire": _nombre(e["accessoire"]) or 0,
        "PrimeNette": _nombre(e["primenette"]), "PrimeTtc": _nombre(e["primettc"]), "Confirme": e["confirme"],
        "Mouvement": e["codeavenant"] or "", "LibelleMouvement": e["libelleavenant"] or "",
        "IdContratRenouvele": e["idcontratrenouvele"] if e["codeavenant"] == "REN" else None,
        "PoliceRenouvelee": e["policerenouvelee"] if e["codeavenant"] == "REN" else "",
        "Assures": assures,
        "IdOffreVie": offre["IdOffre"], "Offre": offre,
        "Cotisants": vie_retraite.lire_cotisants(cursor, id_devis) if cotisations else [],
        "LibelleMois": vie_retraite.libelle_mois(e["dateeffet"]) if cotisations else "",
    }


def modele_classeur():
    classeur = Workbook()
    feuille = classeur.active
    feuille.title = "AFA"
    feuille["A1"] = "LISTE AFA - SOUSCRIPTEUR"
    feuille["A1"].font = Font(bold=True, size=13)
    feuille.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(ENTETES_MODELE))
    remplissage = PatternFill("solid", fgColor="DDEBF7")
    for colonne, intitule in enumerate(ENTETES_MODELE, 1):
        cellule = feuille.cell(3, colonne, intitule)
        cellule.font = Font(bold=True)
        cellule.fill = remplissage
        cellule.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        feuille.column_dimensions[cellule.column_letter].width = 30 if colonne in (5, 6, 10) else 16
    feuille.cell(4, 1, 1)
    feuille.cell(4, 2, "AFFAIRE NOUVELLE")
    for colonne in (3, 4, 7):
        feuille.cell(4, colonne).number_format = "DD/MM/YYYY"
    feuille.cell(4, 8, "ASSURE PRINCIPAL")
    for colonne in (9, 11):
        feuille.cell(4, colonne).number_format = "#,##0"
    feuille.cell(6, 1, "TOTAL").font = Font(bold=True)
    feuille.cell(6, 9, "=SUM(I4:I5)").number_format = "#,##0"
    feuille.cell(6, 11, "=SUM(K4:K5)").number_format = "#,##0"
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


# ------------------------------------------------------------------ vues
def _id_utilisateur(request):
    return getattr(request.user, "id", None)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def referentiels(request):
    try:
        id_client = int(request.query_params.get("client") or 0)
    except ValueError:
        id_client = 0
    from . import vie_retraite  # import local : vie_retraite reprend les outils de ce module

    with connection.cursor() as cursor:
        return Response({
            "Compagnies": _compagnies(cursor),
            "IdCompagnieDefaut": compagnie_par_defaut(ID_PRODUIT_VIE),
            "Polices": vie_retraite.polices_annotees(cursor, id_client),
            # Offres commerciales de la liste déroulante ; sans la migration 0219 : AFA seule
            "Offres": vie_offres.offres(cursor),
            "OffresReglables": vie_offres.tables_presentes(cursor),
        })


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def analyse_import(request):
    fichier = request.FILES.get("fichier_excel") or request.FILES.get("fichier")
    if not fichier:
        return Response({"error": "Joignez le fichier Excel de la liste AFA."}, status=status.HTTP_400_BAD_REQUEST)
    if fichier.size > TAILLE_FICHIER_MAX:
        return Response({"error": "Fichier trop volumineux (5 Mo au plus)."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        return Response(analyser(fichier.read()))
    except ErreurAfa as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([JSONParser])
def devis(request):
    try:
        resultat = enregistrer(request.data, _id_utilisateur(request))
    except ErreurAfa as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except DatabaseError as erreur:
        logger.exception("Enregistrement d'un devis AFA impossible.")
        return Response({"error": str(erreur).split("\n")[0]}, status=status.HTTP_400_BAD_REQUEST)
    return Response(resultat, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def lecture(request, iddevis):
    with connection.cursor() as cursor:
        resultat = lire(cursor, iddevis)
    if not resultat:
        return Response({"error": f"Devis Vie n° {iddevis} introuvable."}, status=status.HTTP_404_NOT_FOUND)
    return Response(resultat)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def modele(request):
    reponse = HttpResponse(modele_classeur(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    reponse["Content-Disposition"] = 'attachment; filename="modele_liste_afa.xlsx"'
    return reponse
