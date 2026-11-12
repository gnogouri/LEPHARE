"""
Consommations santé : tableau de bord et analyse des dépenses (demande du 2026-11-06 : « un tableau de bord spécial pour suivre les états de
consommation avec ces détails ; matérialiser dans l'application les besoins auxquels les fichiers répondent »).

Ce que les fichiers d'OREOLE calculent, refait ici sur les données importées :
- ETAT 2026, feuille CONTRÔLE DE GESTION : par entreprise, provision pour paiement des dépenses de santé face à la consommation, reste et
  couverture (provision / consommation), totaux (primes HT, cotisation santé pure, honoraires MCI, commissions, apporteurs) ;
- ETAT FINANCIER : consommation mois par mois et par entreprise ;
- RAPPORT OREOLE SANTE 2026 : effectifs (statut, tranche d'âge, anomalies), dépenses (mois, entreprise, famille, statut, âge, centres, médecins),
  entreprises à risque (score et alertes) et fiche de chaque entreprise à risque (production du rapport Word : consommations_rapport.py).
Mois et période : date de clôture du relevé (mois où la dépense est payée). Âge : à la fin de la période.
Lien entreprise de l'état / police du gestionnaire : confirmé par l'utilisateur, sinon proposé d'après les noms (mots rares d'abord).
Score de risque (critères du rapport modèle) : moyenne des rapports à la moyenne du portefeuille du coût par bénéficiaire, des actes par
bénéficiaire et du coût par acte ; « Critique » dès que le score atteint 1 (consigne du 2026-11-09), « Trop d'actes » au-delà de 10 actes par bénéficiaire, « Coût par acte élevé »
au-delà de 30 % de la moyenne. Formule proposée, à valider (le modèle ne la décrit pas).
"""

import datetime as dt
import re
from collections import Counter, defaultdict
from decimal import Decimal

from django.db import connection, transaction
from rest_framework import permissions
from rest_framework.decorators import api_view, authentication_classes, permission_classes

from production.renouvellement import AUTHENTIFICATION, _lignes

from .consommations import ErreurConsommation, SEUIL_ALERTE_PROVISION, SOURCE_SOUSCRIPTIONS, _iso, _nombre, _reponse, lire_date, normaliser

ZERO = Decimal("0")
MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]
TRANCHES = [(0, 7, "0-7 ans"), (8, 11, "8-11 ans"), (12, 15, "12-15 ans"), (16, 18, "16-18 ans"), (19, 21, "19-21 ans"), (22, 25, "22-25 ans"),
            (26, 30, "26-30 ans"), (31, 40, "31-40 ans"), (41, 55, "41-55 ans"), (56, 200, "56 ans et plus")]
STATUTS = {"A": "Assuré principal", "C": "Conjoint", "E": "Enfant"}
GENRES = {"M": "Masculin", "F": "Féminin"}
GENERIQUES = {"POUR", "COMPTE", "SARL", "SA", "ET", "DE", "DU", "LES", "LA", "LE", "DES", "EN"}
SEUIL_ACTES = 10
SEUIL_SCORE_CRITIQUE = 1
SEUIL_COUT_ACTE = Decimal("1.3")


# ------------------------------------------------------------------ outils
def _age(naissance, jour):
    if not naissance or not jour:
        return None
    return jour.year - naissance.year - ((jour.month, jour.day) < (naissance.month, naissance.day))


def tranche(age):
    if age is None:
        return "Non renseigné"
    return next((libelle for bas, haut, libelle in TRANCHES if bas <= age <= haut), "Non renseigné")


def ordre_des_tranches(groupes):
    """Répartition par tranche d'âge dans l'ordre croissant des âges (0-7 ans d'abord), « Non renseigné » en dernier (critique d'OREOLE du
    2026-11-09 : ordre chronologique, pas l'ordre des dépenses)."""
    ordre = [t[2] for t in TRANCHES] + ["Non renseigné"]
    return sorted(groupes, key=lambda g: ordre.index(g["Libelle"]) if g["Libelle"] in ordre else len(ordre))


def _div(a, b):
    return float(a) / float(b) if b else None


def _mots(texte):
    return {m for m in re.split(r"[^A-Z0-9]+", normaliser(texte)) if len(m) > 1 and m not in GENERIQUES}


def proposer_liens(entreprises, polices, confirmes):
    """Police proposée pour chaque entreprise d'après les noms : mots rares d'abord, un mot de plus pénalise un peu, nom identique gagne ;
    une police ne sert qu'une fois, les liens confirmés passent avant. Égalité ou rapprochement trop faible : aucune proposition."""
    df = Counter(m for p in polices for m in _mots(p))
    prises = {p for p in confirmes.values() if p}
    candidats = []
    for e in entreprises:
        if e in confirmes:
            continue
        notes = []
        for p in polices:
            if normaliser(e) == normaliser(p):
                notes.append((100.0, p))
                continue
            commun = _mots(e) & _mots(p)
            if commun:
                notes.append((sum(1 / df[m] for m in commun) / (1 + 0.1 * len(_mots(p) - _mots(e))), p))
        notes.sort(reverse=True)
        if notes and notes[0][0] >= 0.5 and not (len(notes) > 1 and abs(notes[0][0] - notes[1][0]) < 1e-9):
            candidats.append((notes[0][0], e, notes[0][1]))
    propositions = {}
    for _note, e, p in sorted(candidats, reverse=True):
        if p not in prises:
            propositions[e] = p
            prises.add(p)
    return propositions


# ------------------------------------------------------------------ données de la période
def _periode(cursor, params):
    """Exercice et période : du/au donnés, sinon l'exercice entier (dernier exercice des relevés ou des cotisations)."""
    cursor.execute("""SELECT DISTINCT a FROM (SELECT EXTRACT(YEAR FROM date_cloture)::int AS a FROM lephare_sante_prestation
                      UNION SELECT exercice FROM lephare_sante_cotisation) x WHERE a IS NOT NULL ORDER BY a""")
    exercices = [r[0] for r in cursor.fetchall()]
    try:
        exercice = int(params.get("exercice") or 0) or (exercices[-1] if exercices else dt.date.today().year)
    except (TypeError, ValueError):
        raise ErreurConsommation("Exercice illisible.")
    du = lire_date(params.get("du")) or dt.date(exercice, 1, 1)
    au = lire_date(params.get("au")) or dt.date(exercice, 12, 31)
    if au < du:
        raise ErreurConsommation("La fin de la période précède son début.")
    return exercice, du, au, exercices


def charger(cursor, du, au, garant="", police=""):
    condition, valeurs = "p.date_cloture BETWEEN %s AND %s", [du, au]
    cond_eff, val_eff = ["TRUE"], []
    for cle, v in (("garant", garant), ("police", police)):
        if v:
            condition += f" AND p.{cle} = %s"
            valeurs.append(v)
            cond_eff.append(f"{cle} = %s")
            val_eff.append(v)
    prestations = _lignes(cursor, f"""
        SELECT p.numero_prest, p.date_cloture, p.garant, p.police, p.matricule_beneficiaire, p.beneficiaire, p.matricule_assure, p.assure, p.statut,
               COALESCE(p.date_naissance, e.date_naissance) AS date_naissance, COALESCE(NULLIF(e.genre, ''), '') AS genre, p.famille, p.acte,
               p.centre_prescripteur, p.centre_executant, p.code_centre, p.medecin, p.souscripteur, p.college, p.type, p.date_soins_retenue,
               p.mt_reclame, p.base_decomptee, p.exclusion, p.depassement, p.mt_rembourse
        FROM lephare_sante_prestation p LEFT JOIN lephare_sante_effectif e ON e.matricule_beneficiaire = p.matricule_beneficiaire
        WHERE {condition}""", valeurs)
    effectif = _lignes(cursor, f"SELECT * FROM lephare_sante_effectif WHERE {' AND '.join(cond_eff)}", val_eff)
    return prestations, effectif


def rapprochement(cursor, exercice):
    """État des cotisations de l'exercice et police du gestionnaire de chaque entreprise : lien confirmé, sinon proposé d'après les noms.
    Renvoie [(ligne de l'état, police ou "", lien confirmé)] et la liste des polices connues."""
    cotisations = _lignes(cursor, "SELECT * FROM lephare_sante_cotisation WHERE exercice = %s ORDER BY entreprise", [exercice])
    confirmes = {l["entreprise"]: l["police"] for l in _lignes(cursor, "SELECT entreprise, police FROM lephare_sante_entreprise_police")}
    polices = sorted({l["police"] for l in _lignes(cursor, "SELECT DISTINCT police FROM lephare_sante_prestation UNION SELECT DISTINCT police FROM lephare_sante_effectif")
                      if l["police"]})
    propositions = proposer_liens([c["entreprise"] for c in cotisations], polices, confirmes)
    liens = [(c, confirmes.get(c["entreprise"], propositions.get(c["entreprise"], "")) or "", c["entreprise"] in confirmes) for c in cotisations]
    return liens, polices


def effectif_de_reference(cursor, du, garant=""):
    """Effectif de référence des mouvements d'une période : pour chaque garant, le dernier effectif importé dont la date de situation précède le
    début de la période (l'effectif de l'exercice précédent pour un exercice entier). Renvoie ({matricule: ligne}, date de situation), ou
    (None, None) sans effectif antérieur ou avant la migration production 0216."""
    cursor.execute("SELECT to_regclass('public.lephare_sante_effectif_situation') IS NOT NULL")
    if not cursor.fetchone()[0]:
        return None, None
    condition, valeurs = "r.situation < %s", [du]
    if garant:
        condition += " AND s.garant = %s"
        valeurs.append(garant)
    lignes = _lignes(cursor, f"""
        WITH dernier AS (
            SELECT DISTINCT ON (s.garant) s.garant, s.idreleve, r.situation
            FROM lephare_sante_effectif_situation s JOIN lephare_sante_releve r ON r.idreleve = s.idreleve
            WHERE {condition}
            ORDER BY s.garant, r.situation DESC, s.idreleve DESC)
        SELECT s.matricule_beneficiaire, s.garant, s.police, s.statut, d.situation
        FROM dernier d JOIN lephare_sante_effectif_situation s ON s.idreleve = d.idreleve AND s.garant = d.garant""", valeurs)
    if not lignes:
        return None, None
    return {l["matricule_beneficiaire"]: l for l in lignes}, max(l["situation"] for l in lignes)


def date_effectif(cursor):
    """Date de situation de l'effectif courant : la plus récente des imports qui l'ont mis à jour (date d'import avant la migration 0216)."""
    cursor.execute("SELECT to_regclass('public.lephare_sante_effectif_situation') IS NOT NULL")
    situation = "COALESCE(r.situation, r.dateimport::date)" if cursor.fetchone()[0] else "r.dateimport::date"
    # les ajouts depuis les souscriptions Oreole Santé de LE PHARE ne datent pas l'effectif du gestionnaire
    cursor.execute(f"""SELECT max({situation}) FROM lephare_sante_releve r
                       WHERE r.idreleve IN (SELECT DISTINCT idreleve FROM lephare_sante_effectif WHERE actif) AND r.fichier <> %s""",
                   [SOURCE_SOUSCRIPTIONS])
    return cursor.fetchone()[0]


def mouvements_effectif(effectif, reference, du, au):
    """Mouvements de l'effectif par police : effectif de référence, sortants, maintenus, nouveaux entrants, effectif actuel.
    Avec un effectif de référence, comparaison des deux effectifs comme l'analyse d'OREOLE du premier semestre 2026 : sortant = dans la
    référence et plus actif, nouvel entrant = actif absent de la référence, maintenu = dans les deux. Sans référence : date d'effet dans la
    période = nouvel entrant, sortie datée dans la période = sortant.
    La comparaison se fait garant par garant : un garant absent de l'effectif de référence (OREOLE CGA, quand seul l'effectif OREOLE de
    l'exercice précédent est importé) suit la règle des dates, et ses polices portent « SansReference » ; auparavant tous ses bénéficiaires
    passaient pour nouveaux entrants et ses sortants s'affichaient à 0 au lieu d'être inconnus (constat du 2026-11-10)."""
    actifs = {e["matricule_beneficiaire"]: e for e in effectif if e["actif"]}
    par_police = defaultdict(lambda: {"Reference": 0, "Sortants": 0, "Maintenus": 0, "Nouveaux": 0, "Effectif": 0})
    garants_compares = {r.get("garant") for r in reference.values()} if reference is not None else set()
    sans_reference = set()
    for e in effectif:
        if reference is not None and e.get("garant") in garants_compares:
            continue
        x = par_police[e["police"]]
        sans_reference.add(e["police"])
        if e["actif"]:
            x["Effectif"] += 1
            x["Nouveaux" if e.get("date_effet") and e["date_effet"] >= du else "Maintenus"] += 1
        elif e.get("date_sortie") and du <= e["date_sortie"] <= au:
            x["Sortants"] += 1
    for police in sans_reference:
        par_police[police]["Reference"] = par_police[police]["Maintenus"] + par_police[police]["Sortants"]
    if reference is not None:
        for matricule, e in actifs.items():
            if e.get("garant") not in garants_compares:
                continue
            x = par_police[e["police"]]
            x["Effectif"] += 1
            x["Maintenus" if matricule in reference else "Nouveaux"] += 1
        for matricule, r in reference.items():
            x = par_police[r["police"]]
            x["Reference"] += 1
            if matricule not in actifs:
                x["Sortants"] += 1
        for police in sans_reference:
            par_police[police]["SansReference"] = True
    return {police: x for police, x in par_police.items() if any(x.values())}


def repartition(prestations, cle):
    """Dépenses, % et actes par valeur de cle(p), avec coût moyen par acte, triées par dépenses."""
    groupes = defaultdict(lambda: {"Depenses": ZERO, "Actes": 0, "Beneficiaires": set(), "Reclame": ZERO})
    for p in prestations:
        g = groupes[cle(p)]
        g["Depenses"] += p["mt_rembourse"]
        g["Reclame"] += p["mt_reclame"]
        g["Actes"] += 1
        g["Beneficiaires"].add(p["matricule_beneficiaire"])
    total = sum((g["Depenses"] for g in groupes.values()), ZERO)
    actes = sum(g["Actes"] for g in groupes.values())
    return [{"Libelle": k or "Non renseigné", "Depenses": _nombre(g["Depenses"]), "Part": _div(g["Depenses"], total) or 0, "Actes": g["Actes"],
             "PartActes": _div(g["Actes"], actes) or 0, "CoutParActe": _div(g["Depenses"], g["Actes"]), "Beneficiaires": len(g["Beneficiaires"]),
             "Reclame": _nombre(g["Reclame"])}
            for k, g in sorted(groupes.items(), key=lambda kv: -kv[1]["Depenses"])]


def indicateurs(prestations, beneficiaires, jour):
    """Indicateurs clés du rapport modèle pour un ensemble de prestations et de bénéficiaires."""
    consommants = {p["matricule_beneficiaire"] for p in prestations}
    rembourse = sum((p["mt_rembourse"] for p in prestations), ZERO)
    ages = [a for a in (_age(b.get("date_naissance"), jour) for b in beneficiaires) if a is not None]
    effectif = len(beneficiaires) or len(consommants)
    return {"Effectif": effectif, "Consommants": len(consommants), "NonConsommants": max(effectif - len(consommants), 0), "Actes": len(prestations),
            "TauxRecours": _div(len(consommants), effectif), "Reclame": _nombre(sum((p["mt_reclame"] for p in prestations), ZERO)),
            "Rembourse": _nombre(rembourse), "CoutParBeneficiaire": _div(rembourse, len(consommants)), "CoutParActe": _div(rembourse, len(prestations)),
            "Frequence": _div(len(prestations), len(consommants)), "AgeMoyen": round(sum(ages) / len(ages)) if ages else None}


def entreprises_a_risque(prestations, effectif, jour):
    """Tableau des entreprises (police du gestionnaire) avec score et alertes, comme la partie III du rapport modèle."""
    par_police = defaultdict(list)
    for p in prestations:
        par_police[p["police"]].append(p)
    eff_police = defaultdict(list)
    for e in effectif:
        eff_police[e["police"]].append(e)
    portefeuille = indicateurs(prestations, [], jour)
    lignes = []
    for police, ps in par_police.items():
        ind = indicateurs(ps, [], jour)
        ages = [a for a in (_age(p["date_naissance"], jour) for p in {p["matricule_beneficiaire"]: p for p in ps}.values()) if a is not None]
        rapports = [r for r in (_div(ind["CoutParBeneficiaire"], portefeuille["CoutParBeneficiaire"]), _div(ind["Frequence"], portefeuille["Frequence"]),
                                _div(ind["CoutParActe"], portefeuille["CoutParActe"])) if r is not None]
        score = round(sum(rapports) / len(rapports), 2) if rapports else 0
        alertes = []
        # Critique dès que le score atteint 1 (consigne du 2026-11-09)
        if score >= SEUIL_SCORE_CRITIQUE:
            alertes.append("Critique")
        if (ind["Frequence"] or 0) > SEUIL_ACTES:
            alertes.append("Trop d'actes")
        if portefeuille["CoutParActe"] and (ind["CoutParActe"] or 0) > float(SEUIL_COUT_ACTE) * portefeuille["CoutParActe"]:
            alertes.append("Coût par acte élevé")
        lignes.append({"Police": police, "Beneficiaires": ind["Consommants"], "Effectif": len(eff_police.get(police, [])), "Actes": ind["Actes"],
                       "Depenses": ind["Rembourse"], "AgeMoyen": round(sum(ages) / len(ages)) if ages else None, "CoutParBeneficiaire": ind["CoutParBeneficiaire"],
                       "ActesParBeneficiaire": ind["Frequence"], "CoutParActe": ind["CoutParActe"], "Score": score, "Alertes": alertes})
    return sorted(lignes, key=lambda l: -l["Depenses"]), portefeuille


# ------------------------------------------------------------------ tableau de bord
def tableau_de_bord(params):
    with connection.cursor() as cursor:
        exercice, du, au, exercices = _periode(cursor, params)
        garant = str(params.get("garant") or "").strip()
        prestations, effectif = charger(cursor, du, au, garant)
        liens, polices = rapprochement(cursor, exercice)
        garants = [l["garant"] for l in _lignes(cursor, "SELECT DISTINCT garant FROM lephare_sante_prestation ORDER BY 1") if l["garant"]]
    cotisations = [c for c, _police, _confirme in liens]
    conso = defaultdict(lambda: {"Total": ZERO, "Mois": defaultdict(lambda: ZERO), "Actes": 0, "Beneficiaires": set()})
    for p in prestations:
        c = conso[p["police"]]
        c["Total"] += p["mt_rembourse"]
        c["Mois"][p["date_cloture"].month] += p["mt_rembourse"]
        c["Actes"] += 1
        c["Beneficiaires"].add(p["matricule_beneficiaire"])
    eff = Counter(e["police"] for e in effectif if e["actif"])

    def situation(provision, consommation):
        if not provision:
            return "Sans provision"
        if consommation > provision:
            return "Provision dépassée"
        return "Alerte" if consommation >= SEUIL_ALERTE_PROVISION * provision else "Normal"

    controle, polices_liees = [], set()
    for c, police, confirme in liens:
        polices_liees.add(police)
        k = conso.get(police) if police else None
        consommation = k["Total"] if k else ZERO
        controle.append({
            "Entreprise": c["entreprise"], "Police": police, "LienConfirme": confirme, "LienPropose": bool(police) and not confirme,
            "EffectifEtat": c["effectif"], "Beneficiaires": eff.get(police, 0) if police else 0, "PrimeHt": _nombre(c["prime_ht"]),
            "CotisationPure": _nombre(c["cotisation_pure"]), "Honoraires": _nombre(c["honoraires"]), "Commissions": _nombre(c["commissions"]),
            "Apporteurs": _nombre(c["apporteurs"]), "Provision": _nombre(c["provision"]), "Consommation": _nombre(consommation),
            "Reste": _nombre(c["provision"] - consommation), "Taux": _div(consommation, c["provision"]), "Couverture": _div(c["provision"], consommation),
            "Mois": {m: _nombre(v) for m, v in (k["Mois"].items() if k else [])}, "Actes": k["Actes"] if k else 0,
            "Consommants": len(k["Beneficiaires"]) if k else 0, "Situation": situation(c["provision"], consommation),
        })
    # Polices qui consomment sans état de cotisation rapproché
    for police, k in conso.items():
        if police not in polices_liees:
            controle.append({"Entreprise": "", "Police": police, "LienConfirme": False, "LienPropose": False, "EffectifEtat": None, "Beneficiaires": eff.get(police, 0),
                             "PrimeHt": 0.0, "CotisationPure": 0.0, "Honoraires": 0.0, "Commissions": 0.0, "Apporteurs": 0.0, "Provision": 0.0,
                             "Consommation": _nombre(k["Total"]), "Reste": -_nombre(k["Total"]), "Taux": None, "Couverture": None,
                             "Mois": {m: _nombre(v) for m, v in k["Mois"].items()}, "Actes": k["Actes"], "Consommants": len(k["Beneficiaires"]),
                             "Situation": "Sans état de cotisation"})
    controle.sort(key=lambda l: (-(l["Taux"] or 0) if l["Provision"] else 1, -l["Consommation"]))
    total = lambda cle: sum(l[cle] for l in controle)  # noqa: E731
    provision, consommation = total("Provision"), total("Consommation")
    risque, _portefeuille = entreprises_a_risque(prestations, effectif, au)
    mensuel = defaultdict(lambda: [ZERO, 0])
    for p in prestations:
        m = mensuel[(p["date_cloture"].year, p["date_cloture"].month)]
        m[0] += p["mt_rembourse"]
        m[1] += 1
    total_mois = sum((v[0] for v in mensuel.values()), ZERO)
    return {
        "Exercice": exercice, "Exercices": exercices, "Du": _iso(du), "Au": _iso(au), "Garants": garants, "Polices": polices,
        "Totaux": {"PrimeHt": total("PrimeHt"), "CotisationPure": total("CotisationPure"), "Honoraires": total("Honoraires"), "Commissions": total("Commissions"),
                   "Apporteurs": total("Apporteurs"), "Provision": provision, "Consommation": consommation, "Reste": provision - consommation,
                   "Taux": _div(consommation, provision), "Entreprises": len(cotisations),
                   "EnDepassement": sum(1 for l in controle if l["Situation"] == "Provision dépassée"),
                   "EnAlerte": sum(1 for l in controle if l["Situation"] == "Alerte"), "SansEtat": sum(1 for l in controle if l["Situation"] == "Sans état de cotisation")},
        "Indicateurs": indicateurs(prestations, [e for e in effectif if e["actif"]], au),
        "Controle": controle,
        "Mensuel": [{"Mois": f"{MOIS[m - 1]} {a}", "Depenses": _nombre(v[0]), "Part": _div(v[0], total_mois) or 0, "Actes": v[1], "CoutParActe": _div(v[0], v[1])}
                    for (a, m), v in sorted(mensuel.items())],
        "Familles": repartition(prestations, lambda p: p["famille"]),
        "Executants": repartition(prestations, lambda p: p["centre_executant"])[:15],
        "Risque": risque,
        "CotisationsImportees": bool(cotisations),
    }


def lier_entreprise(donnees, user):
    entreprise = " ".join(str(donnees.get("Entreprise") or "").split())
    police = str(donnees.get("Police") or "").strip()
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM lephare_sante_cotisation WHERE entreprise = %s LIMIT 1", [entreprise])
        if not cursor.fetchone():
            raise ErreurConsommation("Entreprise inconnue de l'état des cotisations.")
        if police:
            cursor.execute("SELECT 1 FROM lephare_sante_prestation WHERE police = %s UNION SELECT 1 FROM lephare_sante_effectif WHERE police = %s LIMIT 1", [police, police])
            if not cursor.fetchone():
                raise ErreurConsommation("Police inconnue des relevés et de l'effectif du gestionnaire.")
        auteur = ((user.get_full_name() if hasattr(user, "get_full_name") else "") or getattr(user, "email", "") or "")[:150]
        cursor.execute("""INSERT INTO lephare_sante_entreprise_police (entreprise, police, auteur) VALUES (%s, %s, %s)
                          ON CONFLICT (entreprise) DO UPDATE SET police = EXCLUDED.police, auteur = EXCLUDED.auteur, datemaj = now()""", [entreprise, police, auteur])
    return {"Message": f"{entreprise} : " + (f"lié à la police {police}." if police else "aucune police du gestionnaire.")}


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_tableau_de_bord(request):
    return _reponse(tableau_de_bord, request.query_params)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_lien(request):
    return _reponse(lier_entreprise, request.data, request.user)
