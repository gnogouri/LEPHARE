"""
Branche RAFAS : Régime autofinancé d'assurance santé (demande du 2026-11-10 ; modèle : convention RAFAS EXAT AGRICULTURE 2024-2025, avenant n°1
2025-2026, étude « RAPPORT COMPLET EXAT FEVRIER-JUIN 2026 »).

Le souscripteur (EXAT AGRICULTURE) finance lui-même les dépenses de santé de son personnel. Le gestionnaire (VITALIS SANTE) gère les
bénéficiaires, traite et paie les prestations et transmet ses états ; le courtier (OREOLE) conseille, suit le fonds et analyse les dépenses.
- Convention : souscripteur, gestionnaire, polices du gestionnaire, période de 12 mois reconduite par avenant de renouvellement (exercices),
  taux de couverture, règles d'âge et de composition de la famille, collèges avec cotisation annuelle par famille, nombre de familles, plafond
  annuel par famille et barème de prise en charge.
- Budget d'un exercice = somme des cotisations (cotisation par famille x familles) ; honoraires du gestionnaire (8,5 %) et commission du
  courtier (6,5 %, chiffre d'affaires d'OREOLE, demande du 2026-11-10) sur ces cotisations ; le reste est l'enveloppe des sinistres.
- Appels de fonds : la provision que le souscripteur met à la disposition du courtier pour faire face aux dépenses de santé, demandée en début
  d'année puis ajustée selon les dépenses. Solde du fonds = versements reçus - dépenses remboursées (relevés du gestionnaire) - honoraires
  réglés. Appel conseillé quand le solde passe sous le seuil d'alerte (mois de dépenses au rythme moyen).
- Fichiers du gestionnaire : effectifs et relevés de prestations (sante/rafas_lecture.py) ; analyse et contrôles (sante/rafas_analyse.py) ;
  rapport Word (sante/rafas_rapport.py).

Routes /api/rafas/* (sante/urls.py) ; droits rafas.view, rafas.manage, rafas.import (autorisations/garde.py).
"""

import datetime as dt
import json
import logging
import re
from collections import Counter, defaultdict
from decimal import Decimal

from django.db import DatabaseError, connection, transaction
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from production.renouvellement import AUTHENTIFICATION

from .rafas_analyse import Contexte, analyser, mois_entre, moins_un_an
from .rafas_lecture import (CHAMPS_PRESTATION, ErreurRafas, categorie_depuis_college, cle_police, fin_de_mois, libelle_mois, lire_classeur, normaliser,
                            proposer_college, repartir_sinistres, zone_depuis_college)
from .rafas_modeles import DEFAUTS_CONVENTION, DEFAUTS_EXERCICE, PLAFONDS_FAMILLE, modeles

logger = logging.getLogger(__name__)

CHAMPS_CONVENTION = {
    "idclient": int, "souscripteur": str, "adresse": str, "contact": str, "representant": str, "gestionnaire": str, "code_garant": str,
    "numero_client": str, "polices": str, "nature_risque": str, "taux_soins": Decimal, "taux_hospitalisation": Decimal, "territoire": str,
    "composition_famille": str, "enfants_max": int, "age_adulte": int, "age_enfant": int, "age_etudiant": int, "preavis_mois": int,
    "delai_remboursement_mois": int, "delai_contestation_jours": int, "statut": str, "observations": str,
}
LONGUEURS_CONVENTION = {"souscripteur": 200, "adresse": 200, "contact": 100, "representant": 150, "gestionnaire": 100, "code_garant": 30,
                        "numero_client": 30, "polices": 200, "nature_risque": 100, "territoire": 100, "composition_famille": 100, "statut": 12}
CHAMPS_EXERCICE = {"rang": int, "date_effet": dt.date, "date_echeance": dt.date, "taux_honoraires": Decimal, "taux_commission": Decimal,
                   "mois_provision": int, "seuil_alerte_mois": Decimal, "date_signature": dt.date, "observations": str}
MODES = ("VIREMENT", "CHEQUE", "ESPECES", "MOBILE", "COMPENSATION")
PREFIXES = {"APPEL": "RAF-AF", "COURTIER": "RAF-FC", "GESTIONNAIRE": "RAF-HG"}


# ------------------------------------------------------------------ outils
def _lignes(cursor, sql, params=None):
    cursor.execute(sql, params or [])
    colonnes = [c[0] for c in cursor.description]
    return [dict(zip(colonnes, l)) for l in cursor.fetchall()]


def _une(cursor, sql, params=None):
    l = _lignes(cursor, sql, params)
    return l[0] if l else None


def _json(v):
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: _json(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_json(x) for x in v]
    if isinstance(v, set):
        return [_json(x) for x in sorted(v, key=str)]
    return v


def _date(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    t = str(v or "").strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return dt.datetime.strptime(t, fmt).date()
        except ValueError:
            continue
    return None


def _mois(v):
    """« 2026-06 », « 2026-06-15 » ou une date -> 1er du mois."""
    t = str(v or "").strip()
    m = re.fullmatch(r"(\d{4})-(\d{1,2})", t)
    if m:
        return dt.date(int(m.group(1)), int(m.group(2)), 1)
    d = _date(t)
    return dt.date(d.year, d.month, 1) if d else None


def _decimal(v, nom, mini=None, maxi=None):
    try:
        d = Decimal(str(v).replace(" ", "").replace(",", ".")) if v not in (None, "") else None
    except Exception:
        raise ErreurRafas(f"{nom} : nombre attendu.")
    if d is not None and ((mini is not None and d < mini) or (maxi is not None and d > maxi)):
        raise ErreurRafas(f"{nom} : valeur hors limites ({mini} à {maxi}).")
    return d


def _entier(v, nom, mini=0, maxi=None):
    d = _decimal(v, nom, mini, maxi)
    return int(d) if d is not None else None


def _operateur(user):
    return ((user.get_full_name() if hasattr(user, "get_full_name") else "") or getattr(user, "email", "") or "")[:150]


def code_college(libelle, existants):
    base = re.sub(r"[^A-Z0-9]+", "-", normaliser(libelle)).strip("-")[:36] or "COLLEGE"
    code, n = base, 2
    while code in existants:
        code, n = f"{base}-{n}", n + 1
    return code


def budget(colleges, taux_honoraires, taux_commission, familles=None):
    """Cotisations (familles x cotisation par famille), honoraires du gestionnaire, commission du courtier et enveloppe des sinistres.
    familles : {code collège: nombre} pour calculer sur l'effectif réel au lieu des familles de la convention."""
    cotisations = sum(Decimal(c["cotisation"] or 0) * (familles.get(c["code"], 0) if familles is not None else (c["familles"] or 0)) for c in colleges)
    honoraires = (cotisations * Decimal(taux_honoraires or 0) / 100).quantize(Decimal("1"))
    commission = (cotisations * Decimal(taux_commission or 0) / 100).quantize(Decimal("1"))
    return {"Cotisations": int(cotisations), "Honoraires": int(honoraires), "Commission": int(commission), "Enveloppe": int(cotisations - honoraires - commission)}


def _tables_presentes(cursor):
    cursor.execute("SELECT to_regclass('public.lephare_rafas_convention') IS NOT NULL")
    return cursor.fetchone()[0]


# ------------------------------------------------------------------ lecture des conventions
def _exercices(cursor, idconvention):
    exercices = _lignes(cursor, "SELECT * FROM lephare_rafas_exercice WHERE idconvention = %s ORDER BY date_effet", [idconvention])
    colleges = _lignes(cursor, """SELECT c.* FROM lephare_rafas_college c JOIN lephare_rafas_exercice e ON e.idexercice = c.idexercice
                                  WHERE e.idconvention = %s ORDER BY c.ordre, c.idcollege""", [idconvention])
    par_exercice = defaultdict(list)
    for c in colleges:
        c["bareme"] = c["bareme"] if isinstance(c["bareme"], list) else json.loads(c["bareme"] or "[]")
        par_exercice[c["idexercice"]].append(c)
    for e in exercices:
        e["colleges"] = par_exercice[e["idexercice"]]
        e["budget"] = budget(e["colleges"], e["taux_honoraires"], e["taux_commission"])
    return exercices


def exercice_du_jour(exercices, jour):
    """Exercice en cours au jour donné, sinon le dernier commencé, sinon le premier."""
    for e in exercices:
        if e["date_effet"] <= jour <= e["date_echeance"]:
            return e
    passes = [e for e in exercices if e["date_effet"] <= jour]
    return passes[-1] if passes else (exercices[0] if exercices else None)


def _liens(cursor, idconvention):
    return {l["code_college"]: l for l in _lignes(cursor, "SELECT * FROM lephare_rafas_college_gestionnaire WHERE idconvention = %s ORDER BY code_college", [idconvention])}


def _colleges_convention(exercices):
    """Collèges de toutes les périodes (le plus récent libellé l'emporte), dans l'ordre du dernier exercice."""
    vus = {}
    for e in exercices:
        for c in e["colleges"]:
            vus[c["code"]] = {"code": c["code"], "libelle": c["libelle"], "categorie": c["categorie"]}
    return list(vus.values())


def _situation(cursor, idconvention, au=None):
    """Effectif retenu : celui dont la date de situation est la plus proche avant la fin de période (sinon le premier après)."""
    imports = _lignes(cursor, """SELECT idimport, situation, lignes, fichier, feuille FROM lephare_rafas_import
                                 WHERE idconvention = %s AND nature = 'EFFECTIF' AND situation IS NOT NULL ORDER BY situation""", [idconvention])
    if not imports:
        return None, imports
    if au is None:
        return imports[-1], imports
    avant = [i for i in imports if i["situation"] <= au]
    return (avant[-1] if avant else imports[0]), imports


def _beneficiaires(cursor, idimport):
    return _lignes(cursor, "SELECT * FROM lephare_rafas_beneficiaire WHERE idimport = %s", [idimport])


def _familles_reelles(cursor, convention_id, liens, jour=None):
    """Familles (adhérents distincts) de l'effectif le plus récent, par collège de la convention, hors sortis."""
    situation, _imports = _situation(cursor, convention_id)
    if not situation:
        return None, None
    jour = jour or dt.date.today()
    familles = defaultdict(set)
    for b in _lignes(cursor, "SELECT matricule, matricule_adherent, code_college, date_sortie FROM lephare_rafas_beneficiaire WHERE idimport = %s",
                     [situation["idimport"]]):
        if b["date_sortie"] and b["date_sortie"] < jour:
            continue
        code = (liens.get(b["code_college"]) or {}).get("college") or ""
        familles[code].add(b["matricule_adherent"] or b["matricule"])
    return {k: len(v) for k, v in familles.items()}, situation


def _prestations(cursor, idconvention, du, au, champs=None):
    champs = champs or CHAMPS_PRESTATION
    lignes = _lignes(cursor, f"SELECT {', '.join(champs)} FROM lephare_rafas_prestation WHERE idconvention = %s AND mois BETWEEN %s AND %s",
                     [idconvention, du, au])
    for p in lignes:
        for c in ("reclame", "exclus", "depassement", "rembourse", "part_patient"):
            if c in p:
                p[c] = int(p[c] or 0)
        if "tm" in p:
            p["tm"] = float(p["tm"] or 0)
    return lignes


def _depenses_par_mois(cursor, idconvention, du, au):
    return {l["mois"]: {"Depenses": int(l["d"] or 0), "Actes": l["n"], "Reclame": int(l["r"] or 0)} for l in _lignes(cursor, """
        SELECT mois, SUM(rembourse) AS d, SUM(reclame) AS r, COUNT(*) AS n FROM lephare_rafas_prestation
        WHERE idconvention = %s AND mois BETWEEN %s AND %s GROUP BY mois""", [idconvention, du, au])}


def _finances(cursor, exercice):
    appels = _lignes(cursor, """SELECT a.*, COALESCE((SELECT SUM(v.montant) FROM lephare_rafas_versement v WHERE v.idappel = a.idappel), 0) AS verse
                                FROM lephare_rafas_appel a WHERE a.idexercice = %s ORDER BY a.date_appel, a.idappel""", [exercice["idexercice"]])
    versements = _lignes(cursor, """SELECT v.*, a.numero AS numero_appel FROM lephare_rafas_versement v LEFT JOIN lephare_rafas_appel a ON a.idappel = v.idappel
                                    WHERE v.idexercice = %s ORDER BY v.date_versement, v.idversement""", [exercice["idexercice"]])
    honoraires = _lignes(cursor, "SELECT * FROM lephare_rafas_honoraire WHERE idexercice = %s ORDER BY date_emission, idhonoraire", [exercice["idexercice"]])
    return appels, versements, honoraires


def situation_fonds(cursor, convention, exercice, liens=None, jour=None):
    """Fonds d'un exercice : budget (convention et effectif réel), dépenses mensuelles, versements, honoraires, solde, alerte et appel conseillé."""
    jour = jour or dt.date.today()
    liens = liens if liens is not None else _liens(cursor, convention["idconvention"])
    mois = mois_entre(exercice["date_effet"], exercice["date_echeance"])
    par_mois = _depenses_par_mois(cursor, convention["idconvention"], mois[0], mois[-1])
    appels, versements, honoraires = _finances(cursor, exercice)
    familles, situation = _familles_reelles(cursor, convention["idconvention"], liens, jour)
    b_conv = exercice["budget"]
    b_reel = budget(exercice["colleges"], exercice["taux_honoraires"], exercice["taux_commission"], familles) if familles is not None else None
    depenses = sum(m["Depenses"] for m in par_mois.values())
    avec = [m for m in mois if m in par_mois]
    rythme = depenses / len(avec) if avec else None
    verse = sum(int(v["montant"]) for v in versements)
    regle = {b: sum(int(h["montant"]) for h in honoraires if h["beneficiaire"] == b and h["date_paiement"]) for b in ("GESTIONNAIRE", "COURTIER")}
    emis = {b: sum(int(h["montant"]) for h in honoraires if h["beneficiaire"] == b) for b in ("GESTIONNAIRE", "COURTIER")}
    solde = verse - depenses - regle["GESTIONNAIRE"] - regle["COURTIER"]
    seuil = float(exercice["seuil_alerte_mois"] or 0) * rythme if rythme else None
    proposition = None
    if rythme:
        manque = int(exercice["mois_provision"] or 0) * rythme - solde
        proposition = int(-(-manque // 100000) * 100000) if manque > 0 else 0
    elif not versements:
        proposition = int(round((b_reel or b_conv)["Cotisations"] * (exercice["mois_provision"] or 0) / 12, -5)) or None
    mois_restants = len([m for m in mois if m > (avec[-1] if avec else dt.date(jour.year, jour.month, 1))])
    cumul, serie = 0, []
    for m in mois:
        d = par_mois.get(m)
        cumul += d["Depenses"] if d else 0
        serie.append({"Mois": m.isoformat(), "Libelle": libelle_mois(m), "LibelleCourt": libelle_mois(m, court=True), "Depenses": d["Depenses"] if d else None,
                      "Actes": d["Actes"] if d else None, "Cumul": cumul if (d or (avec and m <= avec[-1])) else None,
                      "Prorata": round((b_reel or b_conv)["Enveloppe"] * (mois.index(m) + 1) / len(mois))})
    echeance = exercice["date_echeance"]
    preavis = dt.date(echeance.year, echeance.month, 1) - dt.timedelta(days=1)
    for _ in range(max(0, int(convention.get("preavis_mois") or 0) - 1)):
        preavis = dt.date(preavis.year, preavis.month, 1) - dt.timedelta(days=1)
    jours_exercice = (exercice["date_echeance"] - exercice["date_effet"]).days + 1
    return {
        "Exercice": {k: exercice[k] for k in ("idexercice", "rang", "date_effet", "date_echeance", "taux_honoraires", "taux_commission", "mois_provision",
                                              "seuil_alerte_mois")},
        "JoursExercice": jours_exercice,
        "Colleges": [{"Code": c["code"], "Libelle": c["libelle"], "Categorie": c["categorie"], "Cotisation": int(c["cotisation"]), "Familles": c["familles"],
                      "FamillesReelles": familles.get(c["code"], 0) if familles is not None else None,
                      "Budget": int(c["cotisation"]) * c["familles"],
                      "BudgetReel": int(c["cotisation"]) * familles.get(c["code"], 0) if familles is not None else None} for c in exercice["colleges"]],
        "FamillesNonRattachees": familles.get("", 0) if familles else 0,
        "SituationEffectif": situation["situation"] if situation else None,
        "Budget": b_conv, "BudgetReel": b_reel,
        "Mensuel": serie, "Depenses": depenses, "MoisAvecDonnees": len(avec), "Rythme": rythme,
        "Projection": rythme * len(mois) if rythme else None, "TauxEnveloppe": depenses / b_conv["Enveloppe"] if b_conv["Enveloppe"] else None,
        "TauxEnveloppeReel": depenses / b_reel["Enveloppe"] if b_reel and b_reel["Enveloppe"] else None,
        "Versements": verse, "HonorairesRegles": regle, "HonorairesEmis": emis, "Solde": solde, "Seuil": seuil,
        "Alerte": bool(seuil is not None and solde < seuil) or (not versements and depenses > 0),
        "AppelConseille": proposition, "MoisRestants": mois_restants,
        "BesoinEcheance": max(0, int((rythme or 0) * mois_restants + (emis["GESTIONNAIRE"] - regle["GESTIONNAIRE"]) + (emis["COURTIER"] - regle["COURTIER"]) - solde)) if rythme else None,
        "Echeance": echeance, "Preavis": preavis, "JoursAvantEcheance": (echeance - jour).days, "JoursAvantPreavis": (preavis - jour).days,
        "Appels": [{**a, "reste": int(a["montant"]) - int(a["verse"])} for a in appels], "ListeVersements": versements, "Honoraires": honoraires,
    }


CONDITIONS = ("gestionnaire", "nature_risque", "taux_soins", "taux_hospitalisation", "territoire", "composition_famille", "enfants_max", "age_adulte",
              "age_enfant", "age_etudiant", "preavis_mois", "delai_remboursement_mois", "delai_contestation_jours")
CONDITIONS_EXERCICE = ("taux_honoraires", "taux_commission", "mois_provision", "seuil_alerte_mois")


def modeles_proposes(cursor):
    """Valeurs d'une nouvelle convention (demande du 2026-11-10 : « il y a des valeurs qui n'ont pas besoin d'être saisies ») : conditions de la
    dernière convention enregistrée (gestionnaire, couverture, règles de la famille, préavis et délais ; honoraires, commission et fonds de son
    dernier exercice ; plafond et barème de son dernier collège de chaque catégorie), à défaut celles de la convention RAFAS EXAT."""
    m = modeles()
    m["Source"] = None
    if not _tables_presentes(cursor):
        return m
    derniere = _une(cursor, f"""SELECT idconvention, souscripteur, {', '.join(CONDITIONS)} FROM lephare_rafas_convention
                                ORDER BY date_creation DESC, idconvention DESC LIMIT 1""")
    if not derniere:
        return m
    m["Source"] = derniere["souscripteur"]
    m["Convention"] = {**m["Convention"], **{k: derniere[k] for k in CONDITIONS if derniere[k] not in (None, "")}}
    exercice = _une(cursor, f"SELECT idexercice, {', '.join(CONDITIONS_EXERCICE)} FROM lephare_rafas_exercice WHERE idconvention = %s ORDER BY date_effet DESC LIMIT 1",
                    [derniere["idconvention"]])
    if exercice:
        m["Exercice"] = {**m["Exercice"], **{k: exercice[k] for k in CONDITIONS_EXERCICE if exercice[k] is not None}}
        for c in _lignes(cursor, "SELECT categorie, plafond_famille, bareme FROM lephare_rafas_college WHERE idexercice = %s ORDER BY ordre DESC", [exercice["idexercice"]]):
            bareme = c["bareme"] if isinstance(c["bareme"], list) else json.loads(c["bareme"] or "[]")
            if c["categorie"] in m["Colleges"] and bareme:
                m["Colleges"][c["categorie"]] = {**m["Colleges"][c["categorie"]], "plafond_famille": c["plafond_famille"], "bareme": bareme}
    return m


def liste_conventions():
    with connection.cursor() as cursor:
        if not _tables_presentes(cursor):
            raise ErreurRafas("Les tables RAFAS n'existent pas encore : appliquez la migration production 0218 (python manage.py migrate production).")
        conventions = _lignes(cursor, "SELECT * FROM lephare_rafas_convention ORDER BY statut, souscripteur")
        resultat = []
        jour = dt.date.today()
        proposes = modeles_proposes(cursor)
        for c in conventions:
            exercices = _exercices(cursor, c["idconvention"])
            e = exercice_du_jour(exercices, jour)
            ligne = {"Convention": c, "Exercices": len(exercices), "Exercice": None, "Fonds": None}
            if e:
                fonds = situation_fonds(cursor, c, e, jour=jour)
                ligne["Exercice"] = {k: e[k] for k in ("idexercice", "rang", "date_effet", "date_echeance")}
                ligne["Fonds"] = {k: fonds[k] for k in ("Budget", "BudgetReel", "Depenses", "TauxEnveloppe", "TauxEnveloppeReel", "Solde", "Alerte",
                                                        "AppelConseille", "Versements", "Echeance", "Preavis", "JoursAvantEcheance", "JoursAvantPreavis",
                                                        "SituationEffectif", "MoisAvecDonnees", "Rythme", "Projection")}
                ligne["Fonds"]["Familles"] = sum(x["Familles"] for x in fonds["Colleges"])
                ligne["Fonds"]["FamillesReelles"] = sum(x["FamillesReelles"] or 0 for x in fonds["Colleges"]) if fonds["BudgetReel"] else None
                ligne["Fonds"]["CommissionEmise"] = fonds["HonorairesEmis"]["COURTIER"]
            ligne["Beneficiaires"] = (_une(cursor, """SELECT COUNT(*) AS n FROM lephare_rafas_beneficiaire WHERE idimport = (
                SELECT idimport FROM lephare_rafas_import WHERE idconvention = %s AND nature = 'EFFECTIF' AND situation IS NOT NULL
                ORDER BY situation DESC LIMIT 1)""", [c["idconvention"]]) or {}).get("n")
            resultat.append(ligne)
    return _json({"Conventions": resultat, "Modeles": proposes})


def lire_convention(idconvention):
    with connection.cursor() as cursor:
        c = _une(cursor, "SELECT * FROM lephare_rafas_convention WHERE idconvention = %s", [idconvention])
        if not c:
            raise ErreurRafas("Convention RAFAS introuvable.")
        exercices = _exercices(cursor, idconvention)
        liens = _liens(cursor, idconvention)
        imports = _lignes(cursor, """SELECT idimport, nature, fichier, feuille, lignes, situation, mois_du, mois_au, montant, details, operateur, date_import
                                     FROM lephare_rafas_import WHERE idconvention = %s ORDER BY date_import DESC, idimport DESC""", [idconvention])
        mois = [l["mois"] for l in _lignes(cursor, "SELECT DISTINCT mois FROM lephare_rafas_prestation WHERE idconvention = %s ORDER BY mois", [idconvention])]
        client = None
        if c["idclient"]:
            client = _une(cursor, "SELECT idclient, TRIM(CONCAT_WS(' ', nom, prenoms)) AS nom FROM stdclient WHERE idclient = %s", [c["idclient"]])
        e = exercice_du_jour(exercices, dt.date.today())
        fonds = situation_fonds(cursor, c, e, liens) if e else None
        proposes = modeles_proposes(cursor)
    effectifs = [i for i in imports if i["nature"] == "EFFECTIF"]
    return _json({"Convention": c, "Client": client, "Exercices": exercices, "ExerciceCourant": e["idexercice"] if e else None,
                  "Liens": list(liens.values()), "Imports": imports, "MoisDisponibles": mois,
                  "Situations": sorted(({"IdImport": i["idimport"], "Situation": i["situation"], "Lignes": i["lignes"], "Feuille": i["feuille"]} for i in effectifs
                                        if i["situation"]), key=lambda x: x["Situation"]),
                  "Fonds": fonds, "Modeles": proposes})


# ------------------------------------------------------------------ écritures : convention, exercices, collèges
def _valeurs(donnees, champs, longueurs=None):
    v = {}
    for nom, type_ in champs.items():
        if nom not in donnees:
            continue
        x = donnees[nom]
        if type_ is str:
            v[nom] = str(x or "").strip()[:(longueurs or {}).get(nom, 10000)]
        elif type_ is int:
            v[nom] = _entier(x, nom, mini=0) if x not in (None, "") else None
        elif type_ is Decimal:
            v[nom] = _decimal(x, nom, Decimal(0), Decimal(100) if nom.startswith("taux") else Decimal(1000))
        elif type_ is dt.date:
            v[nom] = _date(x) if x else None
    return v


def _valider_colleges(colleges):
    if not colleges:
        raise ErreurRafas("Ajoutez au moins un collège avec sa cotisation par famille.")
    libelles = set()
    propres = []
    for i, c in enumerate(colleges, start=1):
        libelle = str(c.get("libelle") or "").strip()[:150]
        if not libelle:
            raise ErreurRafas(f"Collège {i} : libellé obligatoire.")
        if normaliser(libelle) in libelles:
            raise ErreurRafas(f"Collège « {libelle} » en double.")
        libelles.add(normaliser(libelle))
        categorie = c.get("categorie") if c.get("categorie") in PLAFONDS_FAMILLE else categorie_depuis_college(libelle)
        bareme = c.get("bareme") if isinstance(c.get("bareme"), list) else []
        propres.append({"code": str(c.get("code") or "").strip()[:40], "libelle": libelle, "categorie": categorie,
                        "cotisation": _entier(c.get("cotisation") or 0, f"Cotisation du collège {libelle}"),
                        "familles": _entier(c.get("familles") or 0, f"Familles du collège {libelle}"),
                        "plafond_famille": _entier(c.get("plafond_famille"), f"Plafond du collège {libelle}") if c.get("plafond_famille") not in (None, "") else None,
                        "bareme": [_ligne_bareme(l) for l in bareme][:60], "ordre": i})
    return propres


def _ligne_bareme(l):
    def nombre(x):
        try:
            return float(x) if x not in (None, "") else None
        except (TypeError, ValueError):
            return None
    return {"Rubrique": str(l.get("Rubrique") or "")[:80], "Prestation": str(l.get("Prestation") or "")[:200], "Taux": nombre(l.get("Taux")),
            "Plafond": nombre(l.get("Plafond")), "Observation": str(l.get("Observation") or "")[:200], "Garanti": bool(l.get("Garanti", True)),
            "Accord": bool(l.get("Accord", False)), "Controle": str(l.get("Controle") or "")[:30]}


def _enregistrer_colleges(cursor, idexercice, colleges, codes_convention):
    existants = {l["code"]: l["idcollege"] for l in _lignes(cursor, "SELECT code, idcollege FROM lephare_rafas_college WHERE idexercice = %s", [idexercice])}
    gardes = set()
    # code stable : celui du collège de même libellé dans la convention, sinon un nouveau code unique
    deja = dict(codes_convention)
    for c in colleges:
        code = c["code"] if c["code"] in existants or c["code"] in deja.values() else deja.get(normaliser(c["libelle"])) or code_college(c["libelle"], set(deja.values()) | gardes)
        deja[normaliser(c["libelle"])] = code
        gardes.add(code)
        valeurs = [c["libelle"], c["categorie"], c["cotisation"], c["familles"], c["plafond_famille"], json.dumps(c["bareme"], ensure_ascii=False), c["ordre"]]
        if code in existants:
            cursor.execute("""UPDATE lephare_rafas_college SET libelle = %s, categorie = %s, cotisation = %s, familles = %s, plafond_famille = %s,
                              bareme = %s::jsonb, ordre = %s WHERE idcollege = %s""", valeurs + [existants[code]])
        else:
            cursor.execute("""INSERT INTO lephare_rafas_college (libelle, categorie, cotisation, familles, plafond_famille, bareme, ordre, idexercice, code)
                              VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)""", valeurs + [idexercice, code])
    retires = [i for code, i in existants.items() if code not in gardes]
    if retires:
        cursor.execute("DELETE FROM lephare_rafas_college WHERE idcollege = ANY(%s)", [retires])


def _codes_convention(cursor, idconvention):
    return {normaliser(l["libelle"]): l["code"] for l in _lignes(cursor, """SELECT c.libelle, c.code FROM lephare_rafas_college c
        JOIN lephare_rafas_exercice e ON e.idexercice = c.idexercice WHERE e.idconvention = %s ORDER BY e.date_effet""", [idconvention])}


def _verifier_periode(cursor, idconvention, debut, fin, idexercice=None):
    if not debut or not fin or fin <= debut:
        raise ErreurRafas("Période : la date d'échéance doit suivre la date d'effet.")
    if (fin - debut).days > 731:
        raise ErreurRafas("Période de plus de deux ans : vérifiez les dates.")
    chevauche = _une(cursor, """SELECT date_effet, date_echeance FROM lephare_rafas_exercice WHERE idconvention = %s AND idexercice <> %s
                                AND date_effet <= %s AND date_echeance >= %s""", [idconvention, idexercice or 0, fin, debut])
    if chevauche:
        raise ErreurRafas(f"Cette période chevauche l'exercice du {chevauche['date_effet']:%d/%m/%Y} au {chevauche['date_echeance']:%d/%m/%Y}.")


def _ecrire_exercice(cursor, idconvention, donnees, idexercice=None):
    v = _valeurs(donnees, CHAMPS_EXERCICE)
    colleges = _valider_colleges(donnees.get("colleges") or [])
    if idexercice:
        actuel = _une(cursor, "SELECT * FROM lephare_rafas_exercice WHERE idexercice = %s AND idconvention = %s", [idexercice, idconvention])
        if not actuel:
            raise ErreurRafas("Exercice introuvable.")
        actuel.update({k: x for k, x in v.items() if x is not None or k in ("date_signature", "observations")})
        _verifier_periode(cursor, idconvention, actuel["date_effet"], actuel["date_echeance"], idexercice)
        cursor.execute("""UPDATE lephare_rafas_exercice SET rang = %s, date_effet = %s, date_echeance = %s, taux_honoraires = %s, taux_commission = %s,
                          mois_provision = %s, seuil_alerte_mois = %s, date_signature = %s, observations = %s WHERE idexercice = %s""",
                       [actuel["rang"], actuel["date_effet"], actuel["date_echeance"], actuel["taux_honoraires"], actuel["taux_commission"],
                        actuel["mois_provision"], actuel["seuil_alerte_mois"], actuel["date_signature"], actuel["observations"] or "", idexercice])
    else:
        complet = {**DEFAUTS_EXERCICE, **{k: x for k, x in v.items() if x is not None}}
        _verifier_periode(cursor, idconvention, complet.get("date_effet"), complet.get("date_echeance"))
        if complet.get("rang") is None:
            complet["rang"] = (_une(cursor, "SELECT COALESCE(MAX(rang) + 1, 0) AS r FROM lephare_rafas_exercice WHERE idconvention = %s", [idconvention]) or {}).get("r", 0)
        cursor.execute("""INSERT INTO lephare_rafas_exercice (idconvention, rang, date_effet, date_echeance, taux_honoraires, taux_commission,
                          mois_provision, seuil_alerte_mois, date_signature, observations) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING idexercice""",
                       [idconvention, complet["rang"], complet["date_effet"], complet["date_echeance"], complet["taux_honoraires"], complet["taux_commission"],
                        complet["mois_provision"], complet["seuil_alerte_mois"], complet.get("date_signature"), complet.get("observations") or ""])
        idexercice = cursor.fetchone()[0]
    _enregistrer_colleges(cursor, idexercice, colleges, _codes_convention(cursor, idconvention))
    return idexercice


def enregistrer_convention(donnees, user, idconvention=None):
    v = _valeurs(donnees.get("Convention") or {}, CHAMPS_CONVENTION, LONGUEURS_CONVENTION)
    if "statut" in v and v["statut"] not in ("EN_VIGUEUR", "RESILIEE"):
        raise ErreurRafas("Statut inconnu.")
    if v.get("code_garant") is not None:
        v["code_garant"] = v["code_garant"].upper()
    with transaction.atomic(), connection.cursor() as cursor:
        if idconvention:
            if not _une(cursor, "SELECT 1 AS x FROM lephare_rafas_convention WHERE idconvention = %s", [idconvention]):
                raise ErreurRafas("Convention RAFAS introuvable.")
            if "souscripteur" in v and not v["souscripteur"]:
                raise ErreurRafas("Souscripteur obligatoire.")
            if v:
                cursor.execute(f"UPDATE lephare_rafas_convention SET {', '.join(f'{k} = %s' for k in v)}, date_modification = now() WHERE idconvention = %s",
                               [*v.values(), idconvention])
        else:
            complet = {**DEFAUTS_CONVENTION, **{k: x for k, x in v.items() if x not in (None, "") or k in ("observations",)}}
            if not complet.get("souscripteur"):
                raise ErreurRafas("Souscripteur obligatoire.")
            if not donnees.get("Exercice"):
                raise ErreurRafas("Période et collèges de la convention obligatoires.")
            colonnes = list(complet) + ["idoperateur"]
            cursor.execute(f"INSERT INTO lephare_rafas_convention ({', '.join(colonnes)}) VALUES ({', '.join(['%s'] * len(colonnes))}) RETURNING idconvention",
                           [*complet.values(), getattr(user, "id", None)])
            idconvention = cursor.fetchone()[0]
            _ecrire_exercice(cursor, idconvention, donnees["Exercice"])
            _liens_proposes(cursor, idconvention, donnees.get("Liens") or [])
    return lire_convention(idconvention)


def _liens_proposes(cursor, idconvention, liens):
    """Collèges du gestionnaire rattachés dès la création (proposition d'après le fichier) : collège désigné par son libellé dans la convention."""
    codes = _codes_convention(cursor, idconvention)
    for l in liens:
        code = _entier(l.get("code_college"), "Code du collège du gestionnaire", mini=None)
        if code is None:
            continue
        cursor.execute("""INSERT INTO lephare_rafas_college_gestionnaire (idconvention, code_college, libelle, police, idpolice, college, categorie, zone)
                          VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                       [idconvention, code, str(l.get("libelle") or "")[:150], str(l.get("police") or "")[:150], _entier(l.get("idpolice"), "Police", mini=None),
                        codes.get(normaliser(l.get("college_libelle")), ""), l.get("categorie") if l.get("categorie") in PLAFONDS_FAMILLE else "",
                        str(l.get("zone") or "").strip().upper()[:60]])


def enregistrer_exercice(idconvention, donnees, idexercice=None):
    with transaction.atomic(), connection.cursor() as cursor:
        if not _une(cursor, "SELECT 1 AS x FROM lephare_rafas_convention WHERE idconvention = %s", [idconvention]):
            raise ErreurRafas("Convention RAFAS introuvable.")
        _ecrire_exercice(cursor, idconvention, donnees, idexercice)
    return lire_convention(idconvention)


def renouveler(idconvention, donnees):
    """Avenant de renouvellement : nouvel exercice de 12 mois à la suite du dernier, mêmes collèges, cotisations et barèmes ; familles de la
    convention reprises, ou celles de l'effectif le plus récent si demandé (donnees.familles = 'effectif')."""
    with transaction.atomic(), connection.cursor() as cursor:
        exercices = _exercices(cursor, idconvention)
        if not exercices:
            raise ErreurRafas("Aucun exercice à renouveler.")
        dernier = exercices[-1]
        effet = dernier["date_echeance"] + dt.timedelta(days=1)
        try:
            echeance = effet.replace(year=effet.year + 1) - dt.timedelta(days=1)
        except ValueError:
            echeance = dt.date(effet.year + 1, 2, 28)
        familles = None
        if donnees.get("familles") == "effectif":
            familles, _situation_eff = _familles_reelles(cursor, idconvention, _liens(cursor, idconvention))
        colleges = [{**{k: c[k] for k in ("code", "libelle", "categorie", "cotisation", "plafond_famille", "bareme")},
                     "familles": familles.get(c["code"], 0) if familles is not None else c["familles"]} for c in dernier["colleges"]]
        _ecrire_exercice(cursor, idconvention, {
            "rang": dernier["rang"] + 1, "date_effet": effet, "date_echeance": echeance, "taux_honoraires": dernier["taux_honoraires"],
            "taux_commission": dernier["taux_commission"], "mois_provision": dernier["mois_provision"], "seuil_alerte_mois": dernier["seuil_alerte_mois"],
            "colleges": colleges})
    return lire_convention(idconvention)


def supprimer_exercice(idconvention, idexercice):
    with transaction.atomic(), connection.cursor() as cursor:
        lie = _une(cursor, """SELECT (SELECT COUNT(*) FROM lephare_rafas_appel WHERE idexercice = %(e)s) + (SELECT COUNT(*) FROM lephare_rafas_versement WHERE idexercice = %(e)s)
                              + (SELECT COUNT(*) FROM lephare_rafas_honoraire WHERE idexercice = %(e)s) AS n""", {"e": idexercice})
        if lie and lie["n"]:
            raise ErreurRafas("Cet exercice porte des appels de fonds, des versements ou des honoraires : supprimez-les d'abord.")
        if (_une(cursor, "SELECT COUNT(*) AS n FROM lephare_rafas_exercice WHERE idconvention = %s", [idconvention]) or {}).get("n", 0) <= 1:
            raise ErreurRafas("Une convention garde au moins un exercice.")
        cursor.execute("DELETE FROM lephare_rafas_exercice WHERE idexercice = %s AND idconvention = %s", [idexercice, idconvention])
    return lire_convention(idconvention)


def enregistrer_liens(idconvention, lignes):
    with transaction.atomic(), connection.cursor() as cursor:
        codes = {c["code"] for c in _colleges_convention(_exercices(cursor, idconvention))}
        for l in lignes or []:
            code = _entier(l.get("code_college"), "Code du collège", mini=None)
            if code is None:
                continue
            college = str(l.get("college") or "")
            if college and college not in codes:
                raise ErreurRafas("Collège de la convention inconnu.")
            cursor.execute("""UPDATE lephare_rafas_college_gestionnaire SET college = %s, zone = %s, categorie = %s
                              WHERE idconvention = %s AND code_college = %s""",
                           [college, str(l.get("zone") or "").strip().upper()[:60], l.get("categorie") if l.get("categorie") in PLAFONDS_FAMILLE else "",
                            idconvention, code])
    return lire_convention(idconvention)


# ------------------------------------------------------------------ import des fichiers du gestionnaire
def _propositions_liens(colleges, liens, lignes):
    """Collèges du gestionnaire rencontrés dans le fichier et pas encore rattachés : collège de la convention, catégorie et zone proposés
    (zone de la colonne « Zone Concentration » du fichier quand elle existe)."""
    zones = defaultdict(Counter)
    vus = {}
    for x in lignes:
        code = x.get("code_college")
        if code is None:
            continue
        vus.setdefault(code, x)
        if x.get("zone"):
            zones[code][normaliser(x["zone"])] += 1
    nouveaux = []
    for code, x in sorted(vus.items()):
        if code in liens:
            continue
        nouveaux.append({"code_college": code, "libelle": (x.get("college") or "")[:150], "police": (x.get("police") or "")[:150], "idpolice": x.get("idpolice"),
                         "college": proposer_college(colleges, x.get("police") or "", x.get("college") or "") or "",
                         "categorie": categorie_depuis_college(x.get("college"), x.get("police")),
                         "zone": (zones[code].most_common(1)[0][0] if zones[code] else zone_depuis_college(x.get("college")))[:60]})
    return nouveaux


def _lire(idconvention, contenu, nom):
    lecture = lire_classeur(contenu, nom)
    with connection.cursor() as cursor:
        convention = _une(cursor, "SELECT * FROM lephare_rafas_convention WHERE idconvention = %s", [idconvention])
        if not convention:
            raise ErreurRafas("Convention RAFAS introuvable.")
        exercices = _exercices(cursor, idconvention)
        liens = _liens(cursor, idconvention)
    return lecture, convention, exercices, liens


def effectif_propose(f):
    """Feuille d'effectif cochée d'office : un matricule n'y figure qu'une fois (tolérance de 1 %). Les feuilles de travail qui réunissent deux
    périodes (EFFECTIF_CONDENSÉ, EFFECTIF FUSION des études d'OREOLE) répètent les matricules : signalées, non cochées."""
    doublons = len(f["Lignes"]) - len({b["matricule"] for b in f["Lignes"]})
    return doublons <= max(5, len(f["Lignes"]) // 100), doublons


def _garant(convention, lecture):
    garants = Counter(x.get("code_garant") for f in lecture["Sinistres"] + lecture["Effectifs"] for x in f["Lignes"] if x.get("code_garant"))
    code = (convention["code_garant"] or "").upper()
    return code, garants


def _resume_feuilles(lecture, code):
    """Feuilles reconnues d'un classeur : mois et montants des relevés (feuilles recopiées non cochées), effectifs (situation, familles)."""
    retenus = repartir_sinistres(lecture["Sinistres"])
    feuilles = []
    for f in lecture["Sinistres"]:
        couples = retenus.get(f["Feuille"], set())
        autres = [p for p in f["Lignes"] if code and p.get("code_garant") and p["code_garant"].upper() != code]
        par_mois = defaultdict(lambda: {"Lignes": 0, "Rembourse": 0, "Retenu": False})
        for p in f["Lignes"]:
            m = par_mois[p["mois"]]
            m["Lignes"] += 1
            m["Rembourse"] += p["rembourse"]
            m["Retenu"] = m["Retenu"] or (p["mois"], cle_police(p)) in couples
        feuilles.append({"Feuille": f["Feuille"], "Nature": "SINISTRES", "Lignes": len(f["Lignes"]), "Totaux": f["Totaux"], "SansMatricule": f["SansMatricule"],
                         "AutreGarant": len(autres), "Rembourse": sum(p["rembourse"] for p in f["Lignes"]), "Proposee": bool(couples),
                         "Mois": [{"Mois": m, "Libelle": libelle_mois(m), **v} for m, v in sorted(par_mois.items())],
                         "Polices": sorted({p.get("police") or "" for p in f["Lignes"]})})
    for f in lecture["Effectifs"]:
        autres = [b for b in f["Lignes"] if code and b.get("code_garant") and b["code_garant"].upper() != code]
        propose, doublons = effectif_propose(f)
        feuilles.append({"Feuille": f["Feuille"], "Nature": "EFFECTIF", "Lignes": len(f["Lignes"]), "SansMatricule": f["SansMatricule"], "AutreGarant": len(autres),
                         "Doublons": doublons, "Situation": f["Situation"], "Proposee": propose, "Beneficiaires": len({b["matricule"] for b in f["Lignes"]}),
                         "Motif": "" if propose else f"{doublons} matricules en double : feuille de travail qui réunit plusieurs périodes, à ne pas importer comme effectif.",
                         "Familles": len({b.get("matricule_adherent") or b["matricule"] for b in f["Lignes"]}),
                         "Liens": dict(Counter(b["lien"] or "?" for b in f["Lignes"])), "Sorties": sum(1 for b in f["Lignes"] if b.get("date_sortie"))})
    return feuilles


def analyser_import(idconvention, contenu, nom):
    lecture, convention, exercices, liens = _lire(idconvention, contenu, nom)
    code, garants = _garant(convention, lecture)
    feuilles = _resume_feuilles(lecture, code)
    toutes = [x for f in lecture["Sinistres"] + lecture["Effectifs"] for x in f["Lignes"]]
    mois_existants = []
    with connection.cursor() as cursor:
        mois_fichier = sorted({p["mois"] for f in lecture["Sinistres"] for p in f["Lignes"]})
        if mois_fichier:
            mois_existants = [l["mois"] for l in _lignes(cursor, "SELECT DISTINCT mois FROM lephare_rafas_prestation WHERE idconvention = %s AND mois = ANY(%s) ORDER BY mois",
                                                         [idconvention, mois_fichier])]
        situations = {l["situation"] for l in _lignes(cursor, "SELECT situation FROM lephare_rafas_import WHERE idconvention = %s AND nature = 'EFFECTIF'", [idconvention])}
    return _json({"Fichier": nom, "Feuilles": feuilles, "Ignorees": lecture["Ignorees"], "CodeGarant": code, "Garants": dict(garants),
                  "GarantPropose": garants.most_common(1)[0][0] if not code and garants else None,
                  "NouveauxColleges": _propositions_liens(_colleges_convention(exercices), liens, toutes),
                  "MoisRemplaces": [libelle_mois(m) for m in mois_existants],
                  "SituationsExistantes": sorted(s for s in situations if s)})


def importer(idconvention, contenu, nom, choix, user):
    """choix : {"feuilles": [noms], "situations": {feuille: date}}. Relevé : chaque (mois de clôture, police) du fichier remplace les lignes déjà
    importées pour ce mois et cette police. Effectif : une photo par date de situation, qui remplace celle de même date."""
    lecture, convention, exercices, liens = _lire(idconvention, contenu, nom)
    code, garants = _garant(convention, lecture)
    retenus_defaut = repartir_sinistres(lecture["Sinistres"])
    choisies = set(choix.get("feuilles") or [f["Feuille"] for f in lecture["Sinistres"] if retenus_defaut.get(f["Feuille"])]
                   + [f["Feuille"] for f in lecture["Effectifs"] if effectif_propose(f)[0]])
    situations = choix.get("situations") or {}
    sinistres = [f for f in lecture["Sinistres"] if f["Feuille"] in choisies]
    effectifs = [f for f in lecture["Effectifs"] if f["Feuille"] in choisies]
    if not sinistres and not effectifs:
        raise ErreurRafas("Aucune feuille à importer : choisissez au moins un relevé ou un effectif.")
    if not code and len(garants) == 1:
        code = next(iter(garants))
    garde = (lambda x: not code or not x.get("code_garant") or x["code_garant"].upper() == code)
    retenus = repartir_sinistres(sinistres)
    operateur = _operateur(user)
    compte = {"Prestations": 0, "Remplacees": 0, "Rembourse": 0, "Beneficiaires": 0, "Effectifs": [], "Ecartees": 0}
    toutes = [x for f in sinistres + effectifs for x in f["Lignes"]]
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM lephare_rafas_convention WHERE idconvention = %s FOR UPDATE", [idconvention])
        if code and not convention["code_garant"]:
            cursor.execute("UPDATE lephare_rafas_convention SET code_garant = %s WHERE idconvention = %s", [code, idconvention])
        for l in _propositions_liens(_colleges_convention(exercices), liens, toutes):
            cursor.execute("""INSERT INTO lephare_rafas_college_gestionnaire (idconvention, code_college, libelle, police, idpolice, college, categorie, zone)
                              VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                           [idconvention, l["code_college"], l["libelle"], l["police"], l["idpolice"], l["college"], l["categorie"], l["zone"]])
        for f in sinistres:
            couples = retenus.get(f["Feuille"], set())
            lignes = [p for p in f["Lignes"] if (p["mois"], cle_police(p)) in couples and garde(p)]
            compte["Ecartees"] += sum(1 for p in f["Lignes"] if not garde(p))
            if not lignes:
                continue
            mois = sorted({p["mois"] for p in lignes})
            cursor.execute("""INSERT INTO lephare_rafas_import (idconvention, nature, fichier, feuille, lignes, mois_du, mois_au, montant, details, idoperateur, operateur)
                              VALUES (%s, 'SINISTRES', %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s) RETURNING idimport""",
                           [idconvention, nom[:255], f["Feuille"][:120], len(lignes), mois[0], mois[-1], sum(p["rembourse"] for p in lignes),
                            json.dumps({"Mois": [m.isoformat() for m in mois], "Polices": sorted({p.get("police") or "" for p in lignes})}, ensure_ascii=False),
                            getattr(user, "id", None), operateur])
            idimport = cursor.fetchone()[0]
            par_police = defaultdict(set)
            for p in lignes:
                par_police[p["mois"]].add(p.get("idpolice"))
            for m, polices in par_police.items():
                avec = [x for x in polices if x is not None]
                cursor.execute("""DELETE FROM lephare_rafas_prestation WHERE idconvention = %s AND mois = %s
                                  AND (idpolice = ANY(%s::int[]) OR (%s AND idpolice IS NULL))""", [idconvention, m, avec, None in polices])
                compte["Remplacees"] += cursor.rowcount
            colonnes = CHAMPS_PRESTATION + ["idconvention", "idimport"]
            cursor.executemany(f"INSERT INTO lephare_rafas_prestation ({', '.join(colonnes)}) VALUES ({', '.join(['%s'] * len(colonnes))})",
                               [[p[c] for c in CHAMPS_PRESTATION] + [idconvention, idimport] for p in lignes])
            compte["Prestations"] += len(lignes)
            compte["Rembourse"] += sum(p["rembourse"] for p in lignes)
        # Effectifs : une photo par date de situation ; plusieurs feuilles de même date dans le fichier (une par police) sont réunies
        par_situation = defaultdict(list)
        for f in effectifs:
            situation = _date(situations.get(f["Feuille"])) or f["Situation"]
            if not situation:
                raise ErreurRafas(f"Feuille « {f['Feuille']} » : indiquez la date de situation de l'effectif (effectif à jour au).")
            par_situation[situation].append(f)
        for situation, groupe in sorted(par_situation.items()):
            par_matricule, lues = {}, 0
            for f in groupe:
                lues += len(f["Lignes"])
                for b in f["Lignes"]:
                    if garde(b):
                        par_matricule[b["matricule"]] = b
                    else:
                        compte["Ecartees"] += 1
            cursor.execute("DELETE FROM lephare_rafas_import WHERE idconvention = %s AND nature = 'EFFECTIF' AND situation = %s", [idconvention, situation])
            cursor.execute("""INSERT INTO lephare_rafas_import (idconvention, nature, fichier, feuille, lignes, situation, details, idoperateur, operateur)
                              VALUES (%s, 'EFFECTIF', %s, %s, %s, %s, %s::jsonb, %s, %s) RETURNING idimport""",
                           [idconvention, nom[:255], ", ".join(f["Feuille"] for f in groupe)[:120], len(par_matricule), situation,
                            json.dumps({"Familles": len({b.get('matricule_adherent') or b['matricule'] for b in par_matricule.values()}),
                                        "Doublons": lues - len(par_matricule) - sum(1 for f in groupe for b in f["Lignes"] if not garde(b))}),
                            getattr(user, "id", None), operateur])
            idimport = cursor.fetchone()[0]
            champs = ["matricule", "matricule_adherent", "adherent", "nom", "date_naissance", "sexe", "lien", "idpolice", "police", "code_college", "college",
                      "date_effet", "date_entree", "date_sortie", "motif_sortie", "etat"]
            cursor.executemany(f"INSERT INTO lephare_rafas_beneficiaire (idimport, {', '.join(champs)}) VALUES (%s, {', '.join(['%s'] * len(champs))})",
                               [[idimport] + [b[c] for c in champs] for b in par_matricule.values()])
            compte["Beneficiaires"] += len(par_matricule)
            compte["Effectifs"].append({"Feuilles": [f["Feuille"] for f in groupe], "Situation": situation, "Beneficiaires": len(par_matricule)})
        # imports de relevé dont toutes les lignes ont été remplacées : retirés de l'historique
        cursor.execute("""DELETE FROM lephare_rafas_import i WHERE i.idconvention = %s AND i.nature = 'SINISTRES'
                          AND NOT EXISTS (SELECT 1 FROM lephare_rafas_prestation p WHERE p.idimport = i.idimport)""", [idconvention])
    return _json({**compte, "Convention": lire_convention(idconvention)})


# ------------------------------------------------------------------ nouvelle convention d'après un fichier du gestionnaire
def nom_police(police):
    """Nom de l'entreprise d'une police du gestionnaire : « SOCIETE EXAT AGRICULTURE AM/O » -> EXAT AGRICULTURE ;
    « CLUB SAINT MICHEL S/C EXAT AGRICULTURE » -> CLUB SAINT MICHEL."""
    n = re.split(r"\s+S/C\s+", normaliser(police))[0]
    n = re.sub(r"[\s(-]*(AM/?O|AM-O|CADRES?)\)?$", "", n).strip(" -")
    return re.sub(r"^SOCIETE\s+", "", n) or "COLLEGE"


def _frequent(valeurs):
    compte = Counter(v for v in valeurs if v not in (None, ""))
    return compte.most_common(1)[0][0] if compte else None


def periode_proposee(beneficiaires):
    """Période de la police d'après l'effectif (dateEffetPolice, sinon dateEcheance - 1 an + 1 jour) ; rang de l'avenant = années depuis la
    première entrée du même jour et du même mois que l'effet (début de la convention)."""
    effet = _frequent(b.get("date_effet_police") for b in beneficiaires)
    echeance = _frequent(b.get("date_echeance") for b in beneficiaires)
    if not effet and echeance:
        effet = moins_un_an(echeance) + dt.timedelta(days=1)
    if not effet:
        return None
    if not echeance or echeance <= effet:
        try:
            echeance = effet.replace(year=effet.year + 1) - dt.timedelta(days=1)
        except ValueError:
            echeance = dt.date(effet.year + 1, 2, 28)
    entrees = [b["date_entree"] for b in beneficiaires if b.get("date_entree") and b["date_entree"] <= effet
               and (b["date_entree"].month, b["date_entree"].day) == (effet.month, effet.day)]
    debut = min(entrees) if entrees else effet
    return {"date_effet": effet, "date_echeance": echeance, "rang": effet.year - debut.year, "debut_convention": debut}


def colleges_proposes(beneficiaires, prestations, situation=None):
    """Collèges de la convention d'après les collèges du gestionnaire : un par entreprise et par catégorie (EXAT AGRICULTURE - CADRES...),
    familles = adhérents distincts de l'effectif (sortis exclus), bénéficiaires ; rattachement de chaque collège du gestionnaire et sa zone."""
    sources = beneficiaires or prestations
    par_code, zones = {}, defaultdict(Counter)
    for x in sources:
        if x.get("code_college") is None:
            continue
        par_code.setdefault(x["code_college"], x)
        if x.get("zone"):
            zones[x["code_college"]][normaliser(x["zone"])] += 1
    groupes, liens = {}, []
    for code, x in sorted(par_code.items()):
        categorie = categorie_depuis_college(x.get("college"), x.get("police"))
        entreprise = nom_police(x.get("police") or x.get("college"))
        libelle = f"{entreprise} - {categorie}"
        g = groupes.setdefault(libelle, {"libelle": libelle, "entreprise": entreprise, "categorie": categorie, "codes": [], "familles": set(),
                                         "beneficiaires": 0, "lignes": 0})
        g["codes"].append(code)
        liens.append({"code_college": code, "libelle": (x.get("college") or "")[:150], "police": (x.get("police") or "")[:150], "idpolice": x.get("idpolice"),
                      "college_libelle": libelle, "categorie": categorie,
                      "zone": (zones[code].most_common(1)[0][0] if zones[code] else zone_depuis_college(x.get("college")))[:60]})
    groupe_de = {code: g for g in groupes.values() for code in g["codes"]}
    for b in beneficiaires:
        g = groupe_de.get(b.get("code_college"))
        if g and not (b.get("date_sortie") and situation and b["date_sortie"] <= situation):
            g["familles"].add(b.get("matricule_adherent") or b["matricule"])
            g["beneficiaires"] += 1
    for p in prestations:
        g = groupe_de.get(p.get("code_college"))
        if g:
            g["lignes"] += 1
    poids = Counter()
    for g in groupes.values():
        poids[g["entreprise"]] += g["beneficiaires"] or g["lignes"]
    ordre = sorted(groupes.values(), key=lambda g: (-poids[g["entreprise"]], g["entreprise"], g["categorie"] != "CADRES"))
    return [{"libelle": g["libelle"], "categorie": g["categorie"], "familles": len(g["familles"]), "beneficiaires": g["beneficiaires"],
             "codes": g["codes"]} for g in ordre], liens


SANS_ACCENT_CLIENT = "UPPER(translate(CONCAT_WS(' ', nom, prenoms), 'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouuucAAAEEEEIIOOUUUC'))"
SANS_ACCENT_SOUSCRIPTEUR = "UPPER(translate(TRIM(souscripteur), 'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouuucAAAEEEEIIOOUUUC'))"


def _client_du_portefeuille(cursor, nom):
    mots = [m for m in re.split(r"[^A-Z0-9]+", normaliser(nom)) if len(m) > 2 and m not in {"SOCIETE", "SARL", "LES", "DES", "COLLEGE"}]
    if not mots:
        return None
    lignes = _lignes(cursor, f"""SELECT idclient, TRIM(CONCAT_WS(' ', nom, prenoms)) AS nom, COALESCE(adresse1, '') AS adresse,
                                        COALESCE(NULLIF(TRIM(telephone), ''), NULLIF(TRIM(mobile), ''), '') AS telephone
                                 FROM stdclient WHERE COALESCE(statut, '') <> 'A' AND {' AND '.join([f'{SANS_ACCENT_CLIENT} LIKE %s'] * len(mots))}
                                 ORDER BY idclient DESC LIMIT 3""", [f"%{m}%" for m in mots])
    return lignes[0] if lignes else None


def proposer_convention(contenu, nom):
    """Nouvelle convention d'après un fichier du gestionnaire (effectif et, ou, relevé de prestations) : souscripteur, code, n° client, polices,
    période, rang de l'avenant, collèges avec leurs familles, rattachements et zones ; conditions types ; client du portefeuille ; convention
    existante du même souscripteur. Aucune écriture : la création suit, puis l'import du même fichier."""
    lecture = lire_classeur(contenu, nom)
    effectifs = [f for f in lecture["Effectifs"] if effectif_propose(f)[0] and f["Lignes"]]
    sinistres = [f for f in lecture["Sinistres"] if f["Lignes"]]
    if not effectifs and not sinistres:
        raise ErreurRafas("Ce classeur ne contient ni effectif ni relevé de prestations du gestionnaire : choisissez le fichier VITALIS (effectif ou détail des sinistres).")
    effectif = max(effectifs, key=lambda f: (f["Situation"] or dt.date.min, len(f["Lignes"]))) if effectifs else None
    # un matricule en double dans l'effectif compte une fois, comme à l'import (la dernière ligne l'emporte)
    beneficiaires = list({b["matricule"]: b for b in effectif["Lignes"]}.values()) if effectif else []
    retenus = repartir_sinistres(sinistres)
    prestations = [p for f in sinistres for p in f["Lignes"] if (p["mois"], cle_police(p)) in retenus.get(f["Feuille"], set())]
    toutes = beneficiaires + prestations
    code = (_frequent(x.get("code_garant") for x in toutes) or "").upper()
    polices = {}
    for x in toutes:
        cle = x.get("idpolice") if x.get("idpolice") is not None else normaliser(x.get("police"))
        police = polices.setdefault(cle, {"Numero": None, "Libelle": x.get("police") or "", "Beneficiaires": 0, "Prestations": 0})
        police["Numero"] = police["Numero"] or x.get("numero_police")
        police["Beneficiaires" if "lien" in x else "Prestations"] += 1
    polices = sorted(polices.values(), key=lambda p: (str(p["Numero"] or ""), p["Libelle"]))
    libelle = _frequent(x.get("garant_libelle") for x in toutes)
    souscripteur = (re.sub(r"^SOCIETE\s+", "", normaliser(libelle)) if libelle
                    else nom_police(max(polices, key=lambda p: p["Beneficiaires"] + p["Prestations"])["Libelle"]))
    situation = effectif["Situation"] if effectif else None
    colleges, liens = colleges_proposes(beneficiaires, prestations, situation)
    periode = periode_proposee(beneficiaires)
    with connection.cursor() as cursor:
        m = modeles_proposes(cursor)
        existante = None
        if _tables_presentes(cursor):
            existante = _une(cursor, f"""SELECT idconvention, souscripteur, CASE WHEN %s <> '' AND UPPER(code_garant) = %s THEN 'code' ELSE 'nom' END AS motif
                                         FROM lephare_rafas_convention
                                         WHERE (%s <> '' AND UPPER(code_garant) = %s) OR {SANS_ACCENT_SOUSCRIPTEUR} = %s ORDER BY idconvention LIMIT 1""",
                             [code, code, code, code, souscripteur])
        client = _client_du_portefeuille(cursor, souscripteur)
    for c in colleges:
        c.update(cotisation="", plafond_famille=m["Colleges"][c["categorie"]]["plafond_famille"], bareme=m["Colleges"][c["categorie"]]["bareme"])
    mois = sorted({p["mois"] for p in prestations})
    return _json({
        "Fichier": nom, "Feuilles": _resume_feuilles(lecture, code), "Ignorees": lecture["Ignorees"],
        "Convention": {**m["Convention"], "souscripteur": souscripteur, "code_garant": code,
                       "numero_client": str(_frequent(p.get("numero_client") for p in prestations) or ""),
                       "polices": "/".join(str(p["Numero"]) for p in polices if p["Numero"]),
                       "adresse": (client or {}).get("adresse", ""), "contact": (client or {}).get("telephone", ""), "idclient": (client or {}).get("idclient")},
        "Exercice": {**m["Exercice"], **(periode or {})}, "Colleges": colleges, "Liens": liens, "Polices": polices,
        "Situation": situation, "Beneficiaires": len(beneficiaires), "Familles": len({b.get("matricule_adherent") or b["matricule"] for b in beneficiaires}),
        "Prestations": len(prestations), "MoisReleves": [libelle_mois(x) for x in (mois[0], mois[-1])] if mois else [],
        "Client": client, "Existante": existante, "Modeles": m,
    })


def supprimer_import(idconvention, idimport):
    with transaction.atomic(), connection.cursor() as cursor:
        i = _une(cursor, "SELECT nature FROM lephare_rafas_import WHERE idimport = %s AND idconvention = %s", [idimport, idconvention])
        if not i:
            raise ErreurRafas("Import introuvable.")
        if i["nature"] == "SINISTRES":
            cursor.execute("DELETE FROM lephare_rafas_prestation WHERE idimport = %s", [idimport])
        cursor.execute("DELETE FROM lephare_rafas_import WHERE idimport = %s", [idimport])
    return lire_convention(idconvention)


# ------------------------------------------------------------------ analyse, effectif, famille
def _contexte(cursor, idconvention, au):
    convention = _une(cursor, "SELECT * FROM lephare_rafas_convention WHERE idconvention = %s", [idconvention])
    if not convention:
        raise ErreurRafas("Convention RAFAS introuvable.")
    exercices = _exercices(cursor, idconvention)
    liens = _liens(cursor, idconvention)
    return convention, exercices, liens, Contexte(_colleges_convention(exercices), liens, au.year)


def periode_par_defaut(cursor, idconvention, exercices):
    """Exercice en cours : de son premier mois au dernier mois de clôture importé (sinon le mois courant)."""
    e = exercice_du_jour(exercices, dt.date.today())
    if not e:
        return None, None
    du = dt.date(e["date_effet"].year, e["date_effet"].month, 1)
    fin = dt.date(e["date_echeance"].year, e["date_echeance"].month, 1)
    dernier = (_une(cursor, "SELECT MAX(mois) AS m FROM lephare_rafas_prestation WHERE idconvention = %s AND mois BETWEEN %s AND %s",
                    [idconvention, du, fin]) or {}).get("m")
    return du, dernier or min(fin, dt.date(dt.date.today().year, dt.date.today().month, 1))


def charger_analyse(idconvention, params):
    with connection.cursor() as cursor:
        exercices = _exercices(cursor, idconvention)
        du, au = _mois(params.get("du")), _mois(params.get("au"))
        if not du or not au:
            du_defaut, au_defaut = periode_par_defaut(cursor, idconvention, exercices)
            du, au = du or du_defaut, au or au_defaut
        if not du or not au:
            raise ErreurRafas("Aucun exercice : enregistrez d'abord la période de la convention.")
        if au < du:
            du, au = au, du
        if len(mois_entre(du, au)) > 24:
            raise ErreurRafas("Période de 24 mois au plus.")
        convention, exercices, liens, ctx = _contexte(cursor, idconvention, au)
        selection = [c for c in str(params.get("colleges") or "").split(",") if c]
        situation, imports = _situation(cursor, idconvention, fin_de_mois(au))
        if params.get("situation"):
            choisie = [i for i in imports if str(i["idimport"]) == str(params["situation"])]
            situation = choisie[0] if choisie else situation
        effectif = _beneficiaires(cursor, situation["idimport"]) if situation else []
        reference, reference_info = None, None
        if situation:
            cible = moins_un_an(situation["situation"])
            anterieurs = [i for i in imports if i["situation"] <= situation["situation"] - dt.timedelta(days=180)]
            if anterieurs:
                proche = min(anterieurs, key=lambda i: abs((i["situation"] - cible).days))
                reference = _beneficiaires(cursor, proche["idimport"])
                reference_info = proche
        prestations = _prestations(cursor, idconvention, du, au)
        du_ref, au_ref = moins_un_an(du), moins_un_an(au)
        prestations_ref = _prestations(cursor, idconvention, du_ref, au_ref)
        exercice = next((e for e in exercices if e["date_effet"] <= fin_de_mois(au) and e["date_echeance"] >= au), None) or exercice_du_jour(exercices, au)
        prestations_ex, enveloppe, colleges_ex = [], None, []
        if exercice:
            prestations_ex = _prestations(cursor, idconvention, dt.date(exercice["date_effet"].year, exercice["date_effet"].month, 1),
                                          dt.date(exercice["date_echeance"].year, exercice["date_echeance"].month, 1))
            enveloppe = exercice["budget"]["Enveloppe"]
            colleges_ex = exercice["colleges"]
        tous = _lignes(cursor, """SELECT b.matricule, b.date_entree, b.date_effet, b.date_sortie FROM lephare_rafas_beneficiaire b
                                  JOIN lephare_rafas_import i ON i.idimport = b.idimport WHERE i.idconvention = %s""", [idconvention])
        mois_disponibles = [l["mois"] for l in _lignes(cursor, "SELECT DISTINCT mois FROM lephare_rafas_prestation WHERE idconvention = %s ORDER BY mois", [idconvention])]
    try:
        seuil = int(params.get("seuil") or 400000)
    except (TypeError, ValueError):
        seuil = 400000
    a = analyser(ctx, convention, effectif, prestations, du, au, selection=selection, reference=reference,
                 prestations_ref=prestations_ref if prestations_ref else None, tous_beneficiaires=tous, prestations_exercice=prestations_ex,
                 colleges_exercice=colleges_ex, enveloppe=enveloppe, exercice=exercice, seuil_famille=seuil)
    a["Convention"] = {"idconvention": convention["idconvention"], "souscripteur": convention["souscripteur"], "gestionnaire": convention["gestionnaire"],
                       "polices": convention["polices"]}
    a["Selection"] = selection
    a["Colleges"] = [{"Code": c["code"], "Libelle": c["libelle"], "Categorie": c["categorie"]} for c in ctx.colleges]
    a["Situation"] = {"IdImport": situation["idimport"], "Date": situation["situation"]} if situation else None
    a["Reference"] = {"IdImport": reference_info["idimport"], "Date": reference_info["situation"]} if reference is not None else None
    a["ReferenceDepenses"] = {"Du": du_ref, "Au": au_ref, "Disponible": bool(prestations_ref)}
    a["Situations"] = [{"IdImport": i["idimport"], "Date": i["situation"], "Lignes": i["lignes"]} for i in imports]
    a["MoisDisponibles"] = mois_disponibles
    a["Exercice"] = {k: exercice[k] for k in ("idexercice", "rang", "date_effet", "date_echeance")} if exercice else None
    a["Seuil"] = seuil
    return _json(a)


def liste_effectif(idconvention, params):
    with connection.cursor() as cursor:
        jour = dt.date.today()
        convention, exercices, liens, ctx = _contexte(cursor, idconvention, jour)
        situation, imports = _situation(cursor, idconvention)
        if params.get("situation"):
            choisie = [i for i in imports if str(i["idimport"]) == str(params["situation"])]
            situation = choisie[0] if choisie else situation
        if not situation:
            return {"Lignes": [], "Total": 0, "Situation": None, "Situations": []}
        ctx.annee = situation["situation"].year
        lignes = [ctx.enrichir(b) for b in _beneficiaires(cursor, situation["idimport"])]
    q = normaliser(params.get("q"))
    college, lien, zone = params.get("college") or "", (params.get("lien") or "").upper(), normaliser(params.get("zone"))
    if q:
        lignes = [b for b in lignes if q in normaliser(f"{b['nom']} {b['adherent']} {b['matricule']} {b['matricule_adherent']}")]
    if college:
        lignes = [b for b in lignes if b["_college"] == college]
    if lien:
        lignes = [b for b in lignes if b["lien"] == lien]
    if zone:
        lignes = [b for b in lignes if normaliser(b["_zone"]) == zone]
    lignes.sort(key=lambda b: (b["adherent"], b["lien"] != "A", b["lien"], b["nom"]))
    try:
        page = max(1, int(params.get("page") or 1))
    except (TypeError, ValueError):
        page = 1
    taille = 50
    extrait = lignes[(page - 1) * taille:page * taille]
    return _json({"Total": len(lignes), "Page": page, "Taille": taille, "Situation": situation["situation"],
                  "Situations": [{"IdImport": i["idimport"], "Date": i["situation"]} for i in imports],
                  "Zones": sorted({b["_zone"] for b in lignes}),
                  "Lignes": [{"Matricule": b["matricule"], "MatriculeAdherent": b["matricule_adherent"], "Adherent": b["adherent"], "Nom": b["nom"],
                              "Statut": b["_statut"], "Sexe": b["sexe"], "Naissance": b["date_naissance"], "Age": b["_age"], "College": ctx.libelle(b["_college"]),
                              "Zone": b["_zone"], "Entree": b["date_entree"], "Sortie": b["date_sortie"], "Motif": b["motif_sortie"]} for b in extrait]})


def fiche_famille(idconvention, matricule_adherent):
    with connection.cursor() as cursor:
        jour = dt.date.today()
        convention, exercices, liens, ctx = _contexte(cursor, idconvention, jour)
        situation, _imports = _situation(cursor, idconvention)
        membres = _lignes(cursor, "SELECT * FROM lephare_rafas_beneficiaire WHERE idimport = %s AND matricule_adherent = %s",
                          [situation["idimport"], matricule_adherent]) if situation else []
        e = exercice_du_jour(exercices, jour)
        du = dt.date(e["date_effet"].year, e["date_effet"].month, 1) if e else dt.date(jour.year, 1, 1)
        au = dt.date(e["date_echeance"].year, e["date_echeance"].month, 1) if e else dt.date(jour.year, 12, 1)
        prestations = _lignes(cursor, f"""SELECT {', '.join(CHAMPS_PRESTATION)} FROM lephare_rafas_prestation
                                          WHERE idconvention = %s AND matricule_adherent = %s AND mois BETWEEN %s AND %s ORDER BY date_soins DESC NULLS LAST""",
                              [idconvention, matricule_adherent, du, au])
    ctx.annee = jour.year
    membres = [ctx.enrichir(b) for b in membres]
    prestations = [ctx.enrichir(p) for p in prestations]
    college = (membres or prestations or [{}])[0].get("_college")
    c = next((x for x in (e or {}).get("colleges", []) if x["code"] == college), None)
    total = sum(int(p["rembourse"]) for p in prestations)
    par_membre = defaultdict(lambda: {"Depenses": 0, "Actes": 0})
    for p in prestations:
        par_membre[p["matricule"]]["Depenses"] += int(p["rembourse"])
        par_membre[p["matricule"]]["Actes"] += 1
    familles = Counter(p.get("famille") or "" for p in prestations)
    return _json({
        "Matricule": matricule_adherent, "Adherent": (membres[0]["adherent"] if membres else (prestations[0]["assure"] if prestations else "")),
        "College": ctx.libelle(college), "Plafond": c["plafond_famille"] if c else None, "Consomme": total,
        "Taux": total / int(c["plafond_famille"]) if c and c["plafond_famille"] else None,
        "Exercice": {"Du": du, "Au": au},
        "Membres": [{"Matricule": b["matricule"], "Nom": b["nom"], "Statut": b["_statut"], "Sexe": b["sexe"], "Naissance": b["date_naissance"], "Age": b["_age"],
                     "Entree": b["date_entree"], "Sortie": b["date_sortie"], **par_membre.get(b["matricule"], {"Depenses": 0, "Actes": 0})} for b in membres],
        "Familles": [{"Famille": f, "Depenses": sum(int(p["rembourse"]) for p in prestations if (p.get("famille") or "") == f), "Actes": n} for f, n in familles.most_common()],
        "Prestations": [{"Date": p["date_soins"], "Patient": p["patient"], "Famille": p["famille"], "Acte": p["acte"], "Centre": p["centre_executant"],
                         "Medecin": p["medecin"], "Reclame": int(p["reclame"]), "Rembourse": int(p["rembourse"])} for p in prestations[:200]],
    })


# ------------------------------------------------------------------ fonds : appels, versements, honoraires
def fonds(idconvention, params):
    with connection.cursor() as cursor:
        c = _une(cursor, "SELECT * FROM lephare_rafas_convention WHERE idconvention = %s", [idconvention])
        if not c:
            raise ErreurRafas("Convention RAFAS introuvable.")
        exercices = _exercices(cursor, idconvention)
        e = next((x for x in exercices if str(x["idexercice"]) == str(params.get("exercice"))), None) or exercice_du_jour(exercices, dt.date.today())
        if not e:
            raise ErreurRafas("Aucun exercice.")
        resultat = situation_fonds(cursor, c, e)
    resultat["Convention"] = {k: c[k] for k in ("idconvention", "souscripteur", "gestionnaire", "polices", "adresse", "representant", "code_garant")}
    resultat["ExercicesListe"] = [{"idexercice": x["idexercice"], "rang": x["rang"], "date_effet": x["date_effet"], "date_echeance": x["date_echeance"]} for x in exercices]
    return _json(resultat)


def _exercice_de(cursor, idexercice):
    e = _une(cursor, """SELECT e.*, c.souscripteur FROM lephare_rafas_exercice e JOIN lephare_rafas_convention c ON c.idconvention = e.idconvention
                        WHERE e.idexercice = %s""", [idexercice])
    if not e:
        raise ErreurRafas("Exercice introuvable.")
    return e


def _numero(cursor, table, prefixe, annee):
    cursor.execute(f"LOCK TABLE {table} IN SHARE ROW EXCLUSIVE MODE")
    motif = f"{prefixe}-{annee}-"
    dernier = _une(cursor, f"SELECT MAX(SUBSTRING(numero FROM %s)::int) AS n FROM {table} WHERE numero LIKE %s", [rf"^{re.escape(motif)}(\d+)$", motif + "%"])
    return f"{motif}{((dernier or {}).get('n') or 0) + 1:03d}"


def creer_appel(idexercice, d, user):
    montant = _entier(d.get("montant"), "Montant", mini=1)
    jour = _date(d.get("date_appel")) or dt.date.today()
    if not montant:
        raise ErreurRafas("Montant de l'appel de fonds obligatoire.")
    with transaction.atomic(), connection.cursor() as cursor:
        e = _exercice_de(cursor, idexercice)
        numero = _numero(cursor, "lephare_rafas_appel", PREFIXES["APPEL"], jour.year)
        cursor.execute("""INSERT INTO lephare_rafas_appel (idexercice, numero, date_appel, objet, montant, date_limite, observations, idoperateur)
                          VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING idappel""",
                       [idexercice, numero, jour, str(d.get("objet") or "Provision pour dépenses de santé")[:200], montant, _date(d.get("date_limite")),
                        str(d.get("observations") or ""), getattr(user, "id", None)])
        idappel = cursor.fetchone()[0]
    return {"IdAppel": idappel, "Numero": numero, **fonds(e["idconvention"], {"exercice": idexercice})}


def supprimer_appel(idappel):
    with transaction.atomic(), connection.cursor() as cursor:
        a = _une(cursor, "SELECT a.idexercice, e.idconvention FROM lephare_rafas_appel a JOIN lephare_rafas_exercice e ON e.idexercice = a.idexercice WHERE idappel = %s", [idappel])
        if not a:
            raise ErreurRafas("Appel de fonds introuvable.")
        if _une(cursor, "SELECT 1 AS x FROM lephare_rafas_versement WHERE idappel = %s LIMIT 1", [idappel]):
            raise ErreurRafas("Des versements sont rattachés à cet appel : supprimez-les d'abord.")
        cursor.execute("DELETE FROM lephare_rafas_appel WHERE idappel = %s", [idappel])
    return fonds(a["idconvention"], {"exercice": a["idexercice"]})


def creer_versement(idexercice, d, user):
    montant = _entier(d.get("montant"), "Montant", mini=1)
    if not montant:
        raise ErreurRafas("Montant du versement obligatoire.")
    jour = _date(d.get("date_versement"))
    if not jour:
        raise ErreurRafas("Date du versement obligatoire.")
    mode = str(d.get("mode") or "VIREMENT").upper()
    if mode not in MODES:
        raise ErreurRafas("Mode de versement inconnu.")
    with transaction.atomic(), connection.cursor() as cursor:
        e = _exercice_de(cursor, idexercice)
        idappel = _entier(d.get("idappel"), "Appel", mini=1) if d.get("idappel") else None
        if idappel:
            a = _une(cursor, """SELECT montant, COALESCE((SELECT SUM(montant) FROM lephare_rafas_versement WHERE idappel = %s), 0) AS verse
                                FROM lephare_rafas_appel WHERE idappel = %s AND idexercice = %s""", [idappel, idappel, idexercice])
            if not a:
                raise ErreurRafas("Appel de fonds introuvable dans cet exercice.")
            if montant > int(a["montant"]) - int(a["verse"]):
                raise ErreurRafas(f"Le versement dépasse le reste à verser de l'appel ({int(a['montant']) - int(a['verse']):,} F).".replace(",", " "))
        cursor.execute("""INSERT INTO lephare_rafas_versement (idexercice, idappel, date_versement, montant, mode, reference, banque, observations, idoperateur)
                          VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                       [idexercice, idappel, jour, montant, mode, str(d.get("reference") or "")[:60], str(d.get("banque") or "")[:80],
                        str(d.get("observations") or ""), getattr(user, "id", None)])
    return fonds(e["idconvention"], {"exercice": idexercice})


def supprimer_versement(idversement):
    with transaction.atomic(), connection.cursor() as cursor:
        v = _une(cursor, """SELECT v.idexercice, e.idconvention FROM lephare_rafas_versement v JOIN lephare_rafas_exercice e ON e.idexercice = v.idexercice
                            WHERE idversement = %s""", [idversement])
        if not v:
            raise ErreurRafas("Versement introuvable.")
        cursor.execute("DELETE FROM lephare_rafas_versement WHERE idversement = %s", [idversement])
    return fonds(v["idconvention"], {"exercice": v["idexercice"]})


def creer_honoraire(idexercice, d, user):
    beneficiaire = str(d.get("beneficiaire") or "").upper()
    if beneficiaire not in ("COURTIER", "GESTIONNAIRE"):
        raise ErreurRafas("Bénéficiaire : courtier ou gestionnaire.")
    du, au = _date(d.get("periode_du")), _date(d.get("periode_au"))
    if not du or not au or au < du:
        raise ErreurRafas("Période de facturation invalide.")
    montant = _entier(d.get("montant"), "Montant", mini=0)
    if montant is None:
        raise ErreurRafas("Montant obligatoire.")
    jour = _date(d.get("date_emission")) or dt.date.today()
    with transaction.atomic(), connection.cursor() as cursor:
        e = _exercice_de(cursor, idexercice)
        numero = str(d.get("numero") or "").strip()[:30] or _numero(cursor, "lephare_rafas_honoraire", PREFIXES[beneficiaire], jour.year)
        cursor.execute("""INSERT INTO lephare_rafas_honoraire (idexercice, beneficiaire, numero, periode_du, periode_au, base, taux, montant, date_emission,
                          observations, idoperateur) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                       [idexercice, beneficiaire, numero, du, au, _entier(d.get("base") or 0, "Base"), _decimal(d.get("taux") or 0, "Taux", Decimal(0), Decimal(100)),
                        montant, jour, str(d.get("observations") or ""), getattr(user, "id", None)])
    return fonds(e["idconvention"], {"exercice": idexercice})


def regler_honoraire(idhonoraire, d):
    with transaction.atomic(), connection.cursor() as cursor:
        h = _une(cursor, """SELECT h.idexercice, e.idconvention FROM lephare_rafas_honoraire h JOIN lephare_rafas_exercice e ON e.idexercice = h.idexercice
                            WHERE idhonoraire = %s""", [idhonoraire])
        if not h:
            raise ErreurRafas("Facture introuvable.")
        paye = d.get("date_paiement")
        jour = _date(paye) if paye else None
        if paye and not jour:
            raise ErreurRafas("Date de règlement invalide.")
        mode = str(d.get("mode") or "").upper()
        if jour and mode not in MODES:
            raise ErreurRafas("Mode de règlement inconnu.")
        cursor.execute("UPDATE lephare_rafas_honoraire SET date_paiement = %s, mode = %s, reference = %s WHERE idhonoraire = %s",
                       [jour, mode if jour else "", str(d.get("reference") or "")[:60] if jour else "", idhonoraire])
    return fonds(h["idconvention"], {"exercice": h["idexercice"]})


def supprimer_honoraire(idhonoraire):
    with transaction.atomic(), connection.cursor() as cursor:
        h = _une(cursor, """SELECT h.idexercice, h.date_paiement, e.idconvention FROM lephare_rafas_honoraire h
                            JOIN lephare_rafas_exercice e ON e.idexercice = h.idexercice WHERE idhonoraire = %s""", [idhonoraire])
        if not h:
            raise ErreurRafas("Facture introuvable.")
        if h["date_paiement"]:
            raise ErreurRafas("Facture réglée : annulez d'abord le règlement.")
        cursor.execute("DELETE FROM lephare_rafas_honoraire WHERE idhonoraire = %s", [idhonoraire])
    return fonds(h["idconvention"], {"exercice": h["idexercice"]})


# ------------------------------------------------------------------ chiffre d'affaires (tableau de bord de la direction)
def commissions_rafas(cursor, debut, au, debut_n1=None, au_n1=None):
    """Commission du courtier sur les régimes autofinancés : facturée (date d'émission) et encaissée (date de règlement) sur la période ;
    chiffre d'affaires du cabinet (demande du 2026-11-10). Zéro tant que la migration production 0218 n'est pas appliquée."""
    vide = {"Nombre": 0, "Base": 0, "Commission": 0, "CommissionN1": 0, "Percue": 0}
    if not _tables_presentes(cursor):
        return vide
    l = _une(cursor, """SELECT COUNT(*) FILTER (WHERE date_emission BETWEEN %(debut)s AND %(au)s) AS nombre,
                               COALESCE(SUM(base) FILTER (WHERE date_emission BETWEEN %(debut)s AND %(au)s), 0) AS base,
                               COALESCE(SUM(montant) FILTER (WHERE date_emission BETWEEN %(debut)s AND %(au)s), 0) AS commission,
                               COALESCE(SUM(montant) FILTER (WHERE date_emission BETWEEN %(debut_n1)s AND %(au_n1)s), 0) AS commission_n1,
                               COALESCE(SUM(montant) FILTER (WHERE date_paiement BETWEEN %(debut)s AND %(au)s), 0) AS percue
                        FROM lephare_rafas_honoraire WHERE beneficiaire = 'COURTIER'""",
             {"debut": debut, "au": au, "debut_n1": debut_n1 or debut, "au_n1": au_n1 or debut - dt.timedelta(days=1)})
    return {"Nombre": l["nombre"], "Base": int(l["base"]), "Commission": int(l["commission"]), "CommissionN1": int(l["commission_n1"]), "Percue": int(l["percue"])}


# ------------------------------------------------------------------ vues
def _reponse(fonction, *args, code=status.HTTP_200_OK):
    try:
        return Response(fonction(*args), status=code)
    except ErreurRafas as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except DatabaseError as erreur:
        logger.exception("RAFAS : erreur de base")
        texte = str(erreur).split("\n")[0]
        if "lephare_rafas" in texte and ("does not exist" in texte or "n'existe pas" in texte):
            texte = "Les tables RAFAS n'existent pas encore : appliquez la migration production 0218."
        return Response({"error": texte}, status=status.HTTP_400_BAD_REQUEST)


def _fichier(request):
    fichier = request.FILES.get("fichier")
    if not fichier:
        raise ErreurRafas("Joignez le classeur Excel du gestionnaire.")
    return fichier.read(), fichier.name


def _choix(request):
    brut = request.data.get("choix")
    try:
        return json.loads(brut) if isinstance(brut, str) and brut else (brut or {})
    except ValueError:
        raise ErreurRafas("Choix d'import illisible.")


@api_view(["GET", "POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_conventions(request):
    if request.method == "POST":
        return _reponse(enregistrer_convention, request.data, request.user, code=status.HTTP_201_CREATED)
    return _reponse(liste_conventions)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def vue_proposition(request):
    """POST /api/rafas/conventions/proposition/ : nouvelle convention proposée d'après un fichier du gestionnaire, sans écriture."""
    def executer():
        contenu, nom = _fichier(request)
        return proposer_convention(contenu, nom)
    return _reponse(executer)


@api_view(["GET", "PUT"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_convention(request, idconvention):
    if request.method == "PUT":
        return _reponse(enregistrer_convention, request.data, request.user, idconvention)
    return _reponse(lire_convention, idconvention)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_exercices(request, idconvention):
    if request.data.get("renouvellement"):
        return _reponse(renouveler, idconvention, request.data, code=status.HTTP_201_CREATED)
    return _reponse(enregistrer_exercice, idconvention, request.data, code=status.HTTP_201_CREATED)


@api_view(["PUT", "DELETE"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_exercice(request, idconvention, idexercice):
    if request.method == "DELETE":
        return _reponse(supprimer_exercice, idconvention, idexercice)
    return _reponse(enregistrer_exercice, idconvention, request.data, idexercice)


@api_view(["PUT"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_liens(request, idconvention):
    return _reponse(enregistrer_liens, idconvention, request.data.get("Liens"))


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def vue_import_analyse(request, idconvention):
    def executer():
        contenu, nom = _fichier(request)
        return analyser_import(idconvention, contenu, nom)
    return _reponse(executer)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def vue_import(request, idconvention):
    def executer():
        contenu, nom = _fichier(request)
        return importer(idconvention, contenu, nom, _choix(request), request.user)
    return _reponse(executer, code=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_supprimer_import(request, idconvention, idimport):
    return _reponse(supprimer_import, idconvention, idimport)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_analyse(request, idconvention):
    return _reponse(charger_analyse, idconvention, request.query_params)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_effectif(request, idconvention):
    return _reponse(liste_effectif, idconvention, request.query_params)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_famille(request, idconvention, matricule):
    return _reponse(fiche_famille, idconvention, matricule)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_fonds(request, idconvention):
    return _reponse(fonds, idconvention, request.query_params)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_appels(request, idexercice):
    return _reponse(creer_appel, idexercice, request.data, request.user, code=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_appel(request, idappel):
    return _reponse(supprimer_appel, idappel)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_versements(request, idexercice):
    return _reponse(creer_versement, idexercice, request.data, request.user, code=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_versement(request, idversement):
    return _reponse(supprimer_versement, idversement)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_honoraires(request, idexercice):
    return _reponse(creer_honoraire, idexercice, request.data, request.user, code=status.HTTP_201_CREATED)


@api_view(["PUT", "DELETE"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_honoraire(request, idhonoraire):
    if request.method == "DELETE":
        return _reponse(supprimer_honoraire, idhonoraire)
    return _reponse(regler_honoraire, idhonoraire, request.data)
