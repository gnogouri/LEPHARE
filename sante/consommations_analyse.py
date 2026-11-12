"""
Consommations santé : analyse approfondie des relevés du gestionnaire (demande du 2026-11-09 : « pousser encore plus l'analyse, statistiques par
compagnie, famille et autre, quelque chose de logique et compréhensible »).

Une fonction pure, `analyser`, calcule tout ce que montrent les onglets d'analyse de l'écran (vue d'ensemble, entreprises, prestations, assurés et
foyers) et la partie V du rapport Word : les deux lisent donc les mêmes chiffres. Route GET /api/consommations/analyse/ (droit consommations.view).

Conventions communes au tableau de bord et au rapport :
- période et mois selon la date de clôture du relevé (mois où la dépense est payée) ; âges à la fin de la période ;
- dépenses = montant remboursé ; effectif = bénéficiaires actifs de l'effectif du gestionnaire ; foyer = assuré principal et ses bénéficiaires ;
- compagnie = garant du relevé ; entreprise = police du gestionnaire, rattachée à l'entreprise de l'état des cotisations et à sa provision.

Choix d'analyse tranchés le 2026-11-09, à valider avec OREOLE :
- tous les mois du relevé entrent dans le rythme mensuel, le dernier compris avec tous ses actes, même peu nombreux (demande du 2026-11-10 :
  « prendre tous les actes du mois » ; août 2026, 37 prestations, était auparavant écarté comme mois partiel) ;
- projection de fin de période = rythme mensuel moyen jusqu'au dernier mois du relevé, multiplié par le nombre de mois de la période ;
- situation d'une entreprise : provision dépassée, dépassement prévu (projection au-delà de la provision), à surveiller (projection d'au moins 80 %),
  normale ; sans provision quand aucune entreprise de l'état n'est rattachée à la police ;
- indice de coût d'un centre : montant réclamé rapporté au montant médian des mêmes actes dans le portefeuille (100 = médiane), sur les actes vus au moins
  10 fois et pour les centres d'au moins 20 actes comparables ; au-delà de 130, le centre coûte nettement plus cher à acte égal ;
- délai de paiement : de la date de soins, corrigée de l'inversion jour/mois, à la clôture du relevé. La date de réception n'est pas utilisée : sur les
  relevés d'OREOLE de 2026 elle est inversée ou postérieure à la clôture sur 88 % des lignes.
"""

import datetime as dt
from collections import Counter, defaultdict
from decimal import Decimal

from django.db import connection
from rest_framework import permissions
from rest_framework.decorators import api_view, authentication_classes, permission_classes

from production.renouvellement import AUTHENTIFICATION, _lignes

from .consommations import SEUIL_ALERTE_PROVISION, SEUIL_PLAFOND, STATUTS, _iso, _nombre, _reponse
from .consommations_pilotage import MOIS, TRANCHES, _age, _div, _periode, charger, entreprises_a_risque, rapprochement, tranche

ZERO = Decimal("0")
MOIS_COURTS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."]
MIN_ACTES_MEDIANE, MIN_ACTES_CENTRE, INDICE_ELEVE = 10, 20, 130
DELAI_TARDIF = 90
EFFECTIF_MIN_TRANCHE = 20
GENRES = {"M": "Hommes", "F": "Femmes"}
# Consommation annuelle d'un foyer, du plus petit au plus gros consommateur
TRANCHES_FOYER = [(ZERO, ZERO, "Aucune consommation"), (Decimal("0.01"), Decimal("49999.99"), "Moins de 50 000 F"),
                  (Decimal("50000"), Decimal("99999.99"), "50 000 à 100 000 F"), (Decimal("100000"), Decimal("249999.99"), "100 000 à 250 000 F"),
                  (Decimal("250000"), Decimal("499999.99"), "250 000 à 500 000 F"), (Decimal("500000"), Decimal("999999.99"), "500 000 F à 1 million"),
                  (Decimal("1000000"), Decimal("2499999.99"), "1 à 2,5 millions"), (Decimal("2500000"), None, "2,5 millions et plus")]
TRANCHES_DELAI = [(0, 30, "30 jours ou moins"), (31, 60, "31 à 60 jours"), (61, 90, "61 à 90 jours"), (91, 180, "91 à 180 jours"), (181, None, "Plus de 180 jours")]
SITUATIONS = ["Provision dépassée", "Dépassement prévu", "À surveiller", "Normale", "Sans provision"]
TONS = {"critique": 0, "attention": 1, "info": 2, "bon": 3}


# ------------------------------------------------------------------ outils
def _fr(v):
    """Nombre entier à la française, milliers séparés par une espace."""
    return f"{float(v or 0):,.0f}".replace(",", " ")


def _francs(v):
    """Montant lisible dans une phrase : en millions au-delà d'un million."""
    v = float(v or 0)
    if abs(v) >= 1_000_000:
        return f"{v / 1_000_000:,.1f}".replace(",", " ").replace(".", ",") + " millions F"
    return f"{_fr(v)} F"


def _pc(x):
    if x is None:
        return "-"
    x = float(x) * 100
    return (f"{x:.1f}".replace(".", ",") if abs(x) < 10 and round(x) != x else f"{x:.0f}") + " %"


def _liste(noms):
    noms = [n for n in noms if n]
    return noms[0] if len(noms) == 1 else ", ".join(noms[:-1]) + " et " + noms[-1] if noms else ""


def mois_de_la_periode(du, au):
    mois, a, m = [], du.year, du.month
    while (a, m) <= (au.year, au.month):
        mois.append((a, m))
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    return mois


def rythme_mensuel(mensuel, mois):
    """Dernier mois du relevé et rythme mensuel moyen d'une période.
    mensuel : {(année, mois): {"Depenses": Decimal, "Actes": int}} ; mois : les mois de la période, dans l'ordre.
    Tous les mois avec des données comptent, le dernier compris avec tous ses actes, quel qu'en soit le nombre ;
    rythme = dépenses du début de la période au dernier mois avec données / nombre de ces mois (un mois sans relevé compte pour zéro).
    Renvoie (indice du dernier mois avec données, rythme), ou (None, 0)."""
    avec = [i for i, k in enumerate(mois) if (mensuel.get(k) or {}).get("Actes")]
    if not avec:
        return None, ZERO
    dernier = avec[-1]
    depenses = sum(((mensuel.get(mois[i]) or {}).get("Depenses", ZERO) for i in range(dernier + 1)), ZERO)
    return dernier, depenses / (dernier + 1)


def situation_provision(provision, consommation, projection):
    if not provision:
        return "Sans provision"
    if consommation > provision:
        return "Provision dépassée"
    if projection > provision:
        return "Dépassement prévu"
    if projection >= SEUIL_ALERTE_PROVISION * provision:
        return "À surveiller"
    return "Normale"


def _mediane(valeurs):
    v = sorted(valeurs)
    n = len(v)
    if not n:
        return None
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def _centile(valeurs, q):
    v = sorted(valeurs)
    return v[min(len(v) - 1, int(q * len(v)))] if v else None


class _Groupe:
    """Cumuls d'un ensemble de prestations : dépenses, réclamé, actes, consommants, dépenses par mois."""
    __slots__ = ("depenses", "reclame", "actes", "consommants", "mois")

    def __init__(self):
        self.depenses, self.reclame, self.actes, self.consommants, self.mois = ZERO, ZERO, 0, set(), defaultdict(lambda: ZERO)

    def ajouter(self, p):
        self.depenses += p["mt_rembourse"]
        self.reclame += p["mt_reclame"]
        self.actes += 1
        self.consommants.add(p["matricule_beneficiaire"])
        if p["date_cloture"]:
            self.mois[(p["date_cloture"].year, p["date_cloture"].month)] += p["mt_rembourse"]

    def serie(self, mois, jusqu_a):
        return [_nombre(self.mois.get(k, ZERO)) if jusqu_a is not None and i <= jusqu_a else None for i, k in enumerate(mois)]


# ------------------------------------------------------------------ analyse
def analyser(prestations, effectif, liens, plafonds, du, au, actes_du_releve=None, medianes_du_releve=None):
    """Analyse complète d'une période.
    prestations, effectif : lignes de charger() ; liens : [(ligne de l'état des cotisations, police, lien confirmé)] déjà restreints au filtre ;
    plafonds : {collège: plafond annuel par famille} ; du, au : la période ;
    actes_du_releve : {(année, mois): actes} de tout le relevé sur la période, sans filtre. Le dernier mois du relevé est celui du gestionnaire,
    pas celui d'une compagnie ou d'une entreprise : une entreprise sans soins en août compte août pour zéro dans son rythme ;
    medianes_du_releve : {acte: montant réclamé médian} de tout le portefeuille, référence de l'indice de coût des centres quel que soit le filtre."""
    mois = mois_de_la_periode(du, au)
    actifs = [e for e in effectif if e["actif"]]
    matricules_actifs = {e["matricule_beneficiaire"] for e in actifs}
    total = _Groupe()
    for p in prestations:
        total.ajouter(p)
    depenses = total.depenses

    # ---- rythme, projection, trajectoire
    mensuel = defaultdict(lambda: {"Depenses": ZERO, "Actes": 0, "Consommants": set()})
    for p in prestations:
        m = mensuel[(p["date_cloture"].year, p["date_cloture"].month)]
        m["Depenses"] += p["mt_rembourse"]
        m["Actes"] += 1
        m["Consommants"].add(p["matricule_beneficiaire"])
    dernier, rythme = rythme_mensuel(mensuel, mois)
    if actes_du_releve:
        # dernier mois lu sur tout le relevé ; rythme du périmètre filtré sur ces mêmes mois
        dernier, _r = rythme_mensuel({k: {"Actes": n, "Depenses": ZERO} for k, n in actes_du_releve.items()}, mois)
        if dernier is not None:
            rythme = sum(((mensuel.get(mois[i]) or {}).get("Depenses", ZERO) for i in range(dernier + 1)), ZERO) / (dernier + 1)
    ecoules = (dernier + 1) if dernier is not None else 0
    projection = max(rythme * len(mois), depenses) if ecoules else depenses
    provision = sum((c["provision"] or ZERO for c, _p, _c in liens), ZERO)

    lignes_mois, cumul, cumul_dernier = [], ZERO, ZERO
    for i, (a, m) in enumerate(mois):
        x = mensuel.get((a, m))
        cumul += x["Depenses"] if x else ZERO
        if dernier is not None and i == dernier:
            cumul_dernier = cumul
        lignes_mois.append({
            "Cle": f"{a}-{m:02d}", "Libelle": f"{MOIS_COURTS[m - 1]} {a}", "LibelleLong": f"{MOIS[m - 1]} {a}",
            "Depenses": _nombre(x["Depenses"]) if x else 0.0, "Actes": x["Actes"] if x else 0, "Consommants": len(x["Consommants"]) if x else 0,
            "CoutParActe": _div(x["Depenses"], x["Actes"]) if x else None,
            "Futur": dernier is None or i > dernier,
            "Cumul": _nombre(cumul) if dernier is not None and i <= dernier else None,
        })
    for i, l in enumerate(lignes_mois):
        l["Projete"] = _nombre(cumul_dernier + rythme * (i - dernier)) if dernier is not None and i >= dernier else None
        l["Budget"] = _nombre(provision * (i + 1) / len(mois)) if provision else None

    # Tendance : moyenne des derniers mois du relevé face aux mois précédents (3 et 3 au plus)
    tendance = None
    k = min(3, ecoules // 2)
    if k:
        recents = [mensuel.get(mois[i]) for i in range(dernier - k + 1, dernier + 1)]
        avant = [mensuel.get(mois[i]) for i in range(dernier - 2 * k + 1, dernier - k + 1)]
        dep_r, dep_a = sum((x["Depenses"] for x in recents if x), ZERO), sum((x["Depenses"] for x in avant if x), ZERO)
        act_r, act_a = sum(x["Actes"] for x in recents if x), sum(x["Actes"] for x in avant if x)
        tendance = {"Mois": k, "Depenses": _div(dep_r - dep_a, dep_a), "Actes": _div(act_r - act_a, act_a),
                    "CoutParActe": _div(_div(dep_r, act_r) - _div(dep_a, act_a), _div(dep_a, act_a)) if act_r and act_a and dep_a else None}

    # ---- synthèse
    consommants_actifs = total.consommants & matricules_actifs
    foyers_actifs = {e["matricule_assure"] for e in actifs}
    ages = [a for a in (_age(e.get("date_naissance"), au) for e in actifs) if a is not None]
    exclusions = sum((p["exclusion"] or ZERO for p in prestations), ZERO)
    depassements = sum((p["depassement"] or ZERO for p in prestations), ZERO)
    synthese = {
        "Depenses": _nombre(depenses), "Reclame": _nombre(total.reclame), "TauxPriseEnCharge": _div(depenses, total.reclame),
        "ResteACharge": _nombre(total.reclame - depenses), "Actes": total.actes, "Effectif": len(actifs), "Foyers": len(foyers_actifs),
        "TailleFoyer": _div(len(actifs), len(foyers_actifs)), "AgeMoyen": round(sum(ages) / len(ages)) if ages else None,
        "Consommants": len(total.consommants), "ConsommantsCouverts": len(consommants_actifs), "HorsEffectif": len(total.consommants - matricules_actifs),
        "TauxRecours": _div(len(consommants_actifs), len(actifs)), "NonConsommants": len(matricules_actifs - total.consommants),
        "CoutParBeneficiaire": _div(depenses, len(actifs)), "CoutParConsommant": _div(depenses, len(total.consommants)),
        "CoutParActe": _div(depenses, total.actes), "Frequence": _div(total.actes, len(total.consommants)),
        "Provision": _nombre(provision), "TauxProvision": _div(depenses, provision), "Rythme": _nombre(rythme), "Projection": _nombre(projection),
        "TauxProjete": _div(projection, provision), "MoisPeriode": len(mois), "MoisEcoules": ecoules, "Attendu": _div(ecoules, len(mois)),
        "DernierMois": lignes_mois[dernier]["LibelleLong"] if dernier is not None else None,
        "CumulDernierMois": _nombre(cumul_dernier), "TauxDernierMois": _div(cumul_dernier, provision),
        # courbes miniatures : tous les mois du relevé
        "Tendance": tendance, "Series": {cle: [l[cle] for l in lignes_mois[:ecoules]] for cle in ("Depenses", "Actes", "CoutParActe")},
    }
    decomposition = {"Reclame": _nombre(total.reclame), "Exclusions": _nombre(exclusions), "Depassements": _nombre(depassements),
                     "TicketEtPlafonds": _nombre(total.reclame - exclusions - depassements - depenses), "Rembourse": _nombre(depenses)}

    # ---- compagnies (garants)
    par_garant, eff_garant = defaultdict(_Groupe), defaultdict(set)
    for p in prestations:
        par_garant[p["garant"] or ""].ajouter(p)
    for e in actifs:
        eff_garant[e["garant"] or ""].add(e["matricule_beneficiaire"])
    compagnies = []
    for g in sorted(set(par_garant) | set(eff_garant)):
        x, eff = par_garant.get(g) or _Groupe(), eff_garant.get(g, set())
        compagnies.append({"Garant": g or "Non renseigné", "Effectif": len(eff), "Consommants": len(x.consommants), "TauxRecours": _div(len(x.consommants & eff), len(eff)),
                           "Actes": x.actes, "Depenses": _nombre(x.depenses), "Part": _div(x.depenses, depenses) or 0, "CoutParBeneficiaire": _div(x.depenses, len(eff)),
                           "CoutParActe": _div(x.depenses, x.actes), "Polices": len({p["police"] for p in prestations if (p["garant"] or "") == g}),
                           "Serie": x.serie(mois, dernier)})
    compagnies.sort(key=lambda c: -c["Depenses"])

    # ---- entreprises (polices du gestionnaire, avec l'état des cotisations)
    par_police, eff_police = defaultdict(_Groupe), defaultdict(list)
    familles_police = defaultdict(lambda: defaultdict(lambda: ZERO))
    for p in prestations:
        par_police[p["police"] or ""].ajouter(p)
        familles_police[p["police"] or ""][p["famille"] or "Non renseignée"] += p["mt_rembourse"]
    for e in actifs:
        eff_police[e["police"] or ""].append(e)
    etat = defaultdict(list)
    sans_police = []
    for c, police, confirme in liens:
        (etat[police] if police else sans_police).append((c, confirme))
    risque = {l["Police"]: l for l in entreprises_a_risque(prestations, effectif, au)[0]}
    garant_police = {}
    for p in prestations:
        garant_police.setdefault(p["police"], p["garant"])
    for e in actifs:
        garant_police.setdefault(e["police"], e["garant"])

    def ligne_entreprise(police, lignes_etat):
        x, eff = par_police.get(police) or _Groupe(), eff_police.get(police, [])
        statuts = Counter(e["statut"] for e in eff)
        prov = sum((c["provision"] or ZERO for c, _c in lignes_etat), ZERO)
        rythme_e = sum((x.mois.get(mois[i], ZERO) for i in range(dernier + 1)), ZERO) / (dernier + 1) if dernier is not None else ZERO
        proj = max(rythme_e * len(mois), x.depenses)
        familles = familles_police.get(police) or {}
        dominante = max(familles.items(), key=lambda kv: kv[1]) if familles else None
        ages_e = [a for a in (_age(e.get("date_naissance"), au) for e in eff) if a is not None]
        r = risque.get(police) or {}
        mat_eff = {e["matricule_beneficiaire"] for e in eff}
        return {
            "Cle": police or (f"etat:{lignes_etat[0][0]['entreprise']}" if lignes_etat else "sans-police"), "Police": police, "Entreprises": [c["entreprise"] for c, _c in lignes_etat],
            "LienConfirme": bool(lignes_etat) and all(conf for _c, conf in lignes_etat), "LienPropose": any(not conf for _c, conf in lignes_etat) and bool(police),
            "Garant": garant_police.get(police) or "", "Effectif": len(eff), "Assures": statuts.get("A", 0), "Conjoints": statuts.get("C", 0), "Enfants": statuts.get("E", 0),
            "EffectifEtat": sum(c["effectif"] or 0 for c, _c in lignes_etat) or None, "Consommants": len(x.consommants),
            "TauxRecours": _div(len(x.consommants & mat_eff), len(eff)), "Actes": x.actes, "Depenses": _nombre(x.depenses), "Part": _div(x.depenses, depenses) or 0,
            "CoutParBeneficiaire": _div(x.depenses, len(eff)), "CoutParConsommant": _div(x.depenses, len(x.consommants)), "CoutParActe": _div(x.depenses, x.actes),
            "Frequence": _div(x.actes, len(x.consommants)), "AgeMoyen": round(sum(ages_e) / len(ages_e)) if ages_e else None,
            "Provision": _nombre(prov), "PrimeHt": _nombre(sum((c["prime_ht"] or ZERO for c, _c in lignes_etat), ZERO)),
            "CotisationPure": _nombre(sum((c["cotisation_pure"] or ZERO for c, _c in lignes_etat), ZERO)),
            "TauxProvision": _div(x.depenses, prov), "Projection": _nombre(proj), "TauxProjete": _div(proj, prov), "Reste": _nombre(prov - x.depenses) if prov else None,
            "Situation": situation_provision(prov, x.depenses, proj),
            "FamilleDominante": {"Famille": dominante[0], "Part": _div(dominante[1], x.depenses) or 0} if dominante and x.depenses else None,
            "Serie": x.serie(mois, dernier), "Score": r.get("Score"), "Alertes": r.get("Alertes", []),
        }

    entreprises = [ligne_entreprise(police, etat.get(police, [])) for police in sorted((set(par_police) | set(eff_police) | set(etat)) - {""})]
    entreprises += [ligne_entreprise("", [(c, conf)]) for c, conf in sans_police]
    if "" in par_police or "" in eff_police:
        entreprises.append(ligne_entreprise("", []))
    entreprises.sort(key=lambda l: (-l["Depenses"], -l["Provision"]))
    gestion = {cle: _nombre(sum((c[champ] or ZERO for c, _p, _c in liens), ZERO)) for cle, champ in (
        ("PrimeHt", "prime_ht"), ("CotisationPure", "cotisation_pure"), ("Honoraires", "honoraires"), ("Commissions", "commissions"),
        ("Apporteurs", "apporteurs"), ("Provision", "provision"))}
    gestion["Entreprises"] = len(liens)
    gestion["Situations"] = {s: sum(1 for l in entreprises if l["Situation"] == s) for s in SITUATIONS}

    # ---- familles de prestations et actes
    par_famille, actes_famille = defaultdict(_Groupe), defaultdict(lambda: defaultdict(_Groupe))
    for p in prestations:
        f = p["famille"] or "Non renseignée"
        par_famille[f].ajouter(p)
        actes_famille[f][p["acte"] or "Non renseigné"].ajouter(p)
    familles = [{"Famille": f, "Depenses": _nombre(x.depenses), "Part": _div(x.depenses, depenses) or 0, "Actes": x.actes, "PartActes": _div(x.actes, total.actes) or 0,
                 "Consommants": len(x.consommants), "CoutParActe": _div(x.depenses, x.actes), "Reclame": _nombre(x.reclame),
                 "TauxPriseEnCharge": _div(x.depenses, x.reclame), "Serie": x.serie(mois, dernier),
                 "PrincipauxActes": [{"Acte": a, "Actes": y.actes, "Depenses": _nombre(y.depenses)}
                                     for a, y in sorted(actes_famille[f].items(), key=lambda kv: -kv[1].depenses)[:3]]}
                for f, x in sorted(par_famille.items(), key=lambda kv: -kv[1].depenses)]
    reclames_acte = defaultdict(list)
    for p in prestations:
        if p["mt_reclame"] > 0:
            reclames_acte[p["acte"]].append(p["mt_reclame"])
    actes = sorted(((f, a, y) for f, d in actes_famille.items() for a, y in d.items()), key=lambda t: -t[2].depenses)
    liste_actes = [{"Acte": a, "Famille": f, "Actes": y.actes, "Depenses": _nombre(y.depenses), "Part": _div(y.depenses, depenses) or 0,
                    "CoutParActe": _div(y.depenses, y.actes), "MedianeReclame": _nombre(_mediane(reclames_acte.get(a, []))) if reclames_acte.get(a) else None,
                    "Consommants": len(y.consommants)} for f, a, y in actes[:15]]

    # ---- profil des bénéficiaires : tranches d'âge et genre, statut
    libelles_tranches = [t[2] for t in TRANCHES] + ["Non renseigné"]
    eff_tranche = defaultdict(Counter)
    for e in actifs:
        eff_tranche[tranche(_age(e.get("date_naissance"), au))][e.get("genre") or ""] += 1
    conso_tranche = defaultdict(_Groupe)
    for p in prestations:
        conso_tranche[tranche(_age(p["date_naissance"], au))].ajouter(p)
    tranches = []
    for t in libelles_tranches:
        c, x = eff_tranche.get(t, Counter()), conso_tranche.get(t) or _Groupe()
        n = sum(c.values())
        if not n and not x.actes:
            continue
        tranches.append({"Tranche": t, "Hommes": c.get("M", 0), "Femmes": c.get("F", 0), "Effectif": n, "Consommants": len(x.consommants),
                         "TauxRecours": _div(len(x.consommants & matricules_actifs), n), "Actes": x.actes, "Depenses": _nombre(x.depenses),
                         "Part": _div(x.depenses, depenses) or 0, "CoutParBeneficiaire": _div(x.depenses, n), "CoutParActe": _div(x.depenses, x.actes)})
    eff_statut, conso_statut = Counter(e["statut"] or "" for e in actifs), defaultdict(_Groupe)
    for p in prestations:
        conso_statut[p["statut"] or ""].ajouter(p)
    statuts = []
    for s in ["A", "C", "E"] + sorted((set(eff_statut) | set(conso_statut)) - {"A", "C", "E"}):
        x, n = conso_statut.get(s) or _Groupe(), eff_statut.get(s, 0)
        if n or x.actes:
            statuts.append({"Statut": s, "Libelle": STATUTS.get(s, "Non renseigné"), "Effectif": n, "Consommants": len(x.consommants),
                            "TauxRecours": _div(len(x.consommants & matricules_actifs), n), "Actes": x.actes, "Depenses": _nombre(x.depenses),
                            "Part": _div(x.depenses, depenses) or 0, "CoutParBeneficiaire": _div(x.depenses, n)})
    eff_genre, conso_genre = Counter(e.get("genre") or "" for e in actifs), defaultdict(_Groupe)
    for p in prestations:
        conso_genre[p.get("genre") or ""].ajouter(p)
    genres = [{"Genre": g, "Libelle": GENRES.get(g, "Non renseigné"), "Effectif": eff_genre.get(g, 0), "Consommants": len((conso_genre.get(g) or _Groupe()).consommants),
               "Depenses": _nombre((conso_genre.get(g) or _Groupe()).depenses), "Part": _div((conso_genre.get(g) or _Groupe()).depenses, depenses) or 0,
               "CoutParBeneficiaire": _div((conso_genre.get(g) or _Groupe()).depenses, eff_genre.get(g, 0))}
              for g in ["F", "M", ""] if eff_genre.get(g) or g in conso_genre]

    # ---- foyers : concentration, tranches de consommation, plus gros foyers, plafonds
    par_foyer = defaultdict(_Groupe)
    for p in prestations:
        par_foyer[p["matricule_assure"]].ajouter(p)
    membres = defaultdict(list)
    for e in actifs:
        membres[e["matricule_assure"]].append(e)
    foyers = set(par_foyer) | set(membres)
    montants = sorted((par_foyer[f].depenses if f in par_foyer else ZERO for f in foyers), reverse=True)
    pareto, cumul_f = [], [ZERO]
    for v in montants:
        cumul_f.append(cumul_f[-1] + v)
    for k in range(21):
        n = round(len(montants) * k / 20)
        pareto.append({"PartFoyers": k / 20, "PartDepenses": _div(cumul_f[n], depenses) or 0})
    top10 = round(len(montants) * 0.1)
    tranches_foyer = []
    for bas, haut, libelle in TRANCHES_FOYER:
        dedans = [v for v in montants if v >= bas and (haut is None or v <= haut)]
        tranches_foyer.append({"Libelle": libelle, "Foyers": len(dedans), "PartFoyers": _div(len(dedans), len(montants)) or 0,
                               "Depenses": _nombre(sum(dedans, ZERO)), "PartDepenses": _div(sum(dedans, ZERO), depenses) or 0})

    def nom_foyer(f):
        principal = next((e for e in membres.get(f, []) if e["statut"] == "A"), None)
        if principal:
            return f"{principal.get('nom') or ''} {principal.get('prenoms') or ''}".strip()
        return next((p["assure"] for p in prestations if p["matricule_assure"] == f and p["assure"]), "")

    colleges_releve = defaultdict(list)
    for p in prestations:
        if p.get("college"):
            colleges_releve[p["matricule_assure"]].append(p["college"])

    def plafond_foyer(f):
        """Plafond annuel du barème du foyer : collège de l'assuré principal dans l'effectif, sinon d'un membre, sinon du relevé."""
        colleges = [e["college"] for e in membres.get(f, []) if e["statut"] == "A"] + [e["college"] for e in membres.get(f, [])] + colleges_releve.get(f, [])
        return next((plafonds[c] for c in colleges if c in plafonds), None)

    alerte_plafond = depasse_plafond = 0
    for f, x in par_foyer.items():
        plafond = plafond_foyer(f)
        if plafond and x.depenses > plafond:
            depasse_plafond += 1
        elif plafond and x.depenses >= SEUIL_PLAFOND * plafond:
            alerte_plafond += 1
    gros = sorted(par_foyer.items(), key=lambda kv: -kv[1].depenses)[:10]
    top_foyers = []
    for f, x in gros:
        plafond = plafond_foyer(f)
        polices = Counter(p["police"] for p in prestations if p["matricule_assure"] == f)
        top_foyers.append({"MatriculeAssure": f, "Nom": nom_foyer(f), "Police": polices.most_common(1)[0][0] if polices else "",
                           "Beneficiaires": len(membres.get(f, [])) or len(x.consommants), "Consommants": len(x.consommants), "Actes": x.actes,
                           "Depenses": _nombre(x.depenses), "Part": _div(x.depenses, depenses) or 0, "Plafond": _nombre(plafond) if plafond else None,
                           "TauxPlafond": _div(x.depenses, plafond)})
    analyse_foyers = {"Total": len(foyers), "Consommateurs": len(par_foyer), "Pareto": pareto, "Tranches": tranches_foyer,
                      "Top10Pct": {"Foyers": top10, "Part": _div(cumul_f[top10], depenses) or 0},
                      "Moyenne": _div(depenses, len(foyers)), "Mediane": _nombre(_mediane(montants)) if montants else None,
                      "PlafondAlerte": alerte_plafond, "PlafondDepasse": depasse_plafond, "Top": top_foyers}

    # ---- prestataires : centres exécutants, indice de coût à acte égal, prescripteurs
    medianes = medianes_du_releve if medianes_du_releve is not None else {a: _mediane(v) for a, v in reclames_acte.items() if len(v) >= MIN_ACTES_MEDIANE}
    par_centre = defaultdict(lambda: {"g": _Groupe(), "reclame": ZERO, "reference": ZERO, "comparables": 0})
    for p in prestations:
        c = par_centre[p["centre_executant"] or "Non renseigné"]
        c["g"].ajouter(p)
        m = medianes.get(p["acte"])
        if m and p["mt_reclame"] > 0:
            c["reclame"] += p["mt_reclame"]
            c["reference"] += m
            c["comparables"] += 1

    def indice(c):
        return round(float(c["reclame"] / c["reference"]) * 100) if c["comparables"] >= MIN_ACTES_CENTRE and c["reference"] else None

    centres = [{"Centre": nom, "Actes": c["g"].actes, "Beneficiaires": len(c["g"].consommants), "Depenses": _nombre(c["g"].depenses),
                "Part": _div(c["g"].depenses, depenses) or 0, "CoutParActe": _div(c["g"].depenses, c["g"].actes), "Indice": indice(c),
                "ActesCompares": c["comparables"]} for nom, c in sorted(par_centre.items(), key=lambda kv: -kv[1]["g"].depenses)]
    chers = sorted((c for c in centres if c["Indice"] and c["Indice"] >= INDICE_ELEVE), key=lambda c: -c["Indice"])
    par_prescripteur = defaultdict(lambda: {"g": _Groupe(), "executants": set()})
    for p in prestations:
        if p["centre_prescripteur"]:
            c = par_prescripteur[p["centre_prescripteur"]]
            c["g"].ajouter(p)
            c["executants"].add(p["centre_executant"])
    prescripteurs = [{"Centre": nom, "Actes": c["g"].actes, "Depenses": _nombre(c["g"].depenses), "Part": _div(c["g"].depenses, depenses) or 0,
                      "Beneficiaires": len(c["g"].consommants), "Executants": len(c["executants"] - {nom})}
                     for nom, c in sorted(par_prescripteur.items(), key=lambda kv: -kv[1]["g"].depenses)[:10]]
    prestataires = {"Centres": centres[:20], "Nombre": len(centres), "PartTop10": _div(sum((Decimal(str(c["Depenses"])) for c in centres[:10]), ZERO), depenses) or 0,
                    "IndicesCalcules": sum(1 for c in centres if c["Indice"]), "Chers": chers[:5], "Prescripteurs": prescripteurs}

    # ---- délais de paiement : soins (date corrigée) -> clôture du relevé
    delais, incoherents = [], 0
    for p in prestations:
        soins = p.get("date_soins_retenue")
        if soins and p["date_cloture"]:
            d = (p["date_cloture"] - soins).days
            if d < 0:
                incoherents += 1
            else:
                delais.append((d, p["mt_rembourse"]))
    jours = [d for d, _m in delais]
    tranches_delai = []
    for bas, haut, libelle in TRANCHES_DELAI:
        dedans = [(d, m) for d, m in delais if d >= bas and (haut is None or d <= haut)]
        tranches_delai.append({"Libelle": libelle, "Actes": len(dedans), "Part": _div(len(dedans), len(delais)) or 0, "Depenses": _nombre(sum((m for _d, m in dedans), ZERO))})
    analyse_delais = {"Mediane": _mediane(jours), "P90": _centile(jours, 0.9), "Moyenne": round(sum(jours) / len(jours)) if jours else None,
                      "Tranches": tranches_delai, "Tardifs": sum(1 for d in jours if d > DELAI_TARDIF),
                      "DepensesTardives": _nombre(sum((m for d, m in delais if d > DELAI_TARDIF), ZERO)), "Incoherents": incoherents}

    resultat = {
        "Synthese": synthese, "Mensuel": lignes_mois, "Decomposition": decomposition, "Compagnies": compagnies, "Entreprises": entreprises, "Gestion": gestion,
        "Familles": familles, "Actes": liste_actes, "Profil": {"Tranches": tranches, "Statuts": statuts, "Genres": genres}, "Foyers": analyse_foyers,
        "Prestataires": prestataires, "Delais": analyse_delais,
    }
    resultat["Constats"] = constats(resultat)
    return resultat


# ------------------------------------------------------------------ ce qu'il faut retenir
def constats(a):
    """Phrases qui résument l'analyse, de la plus grave à la plus neutre. Ton : critique, attention, info ou bon."""
    s, liste = a["Synthese"], []

    def dire(ton, titre, texte):
        liste.append({"Ton": ton, "Titre": titre, "Texte": texte})

    if not s["Actes"]:
        return [{"Ton": "info", "Titre": "Aucune dépense", "Texte": "Aucune prestation sur la période choisie : importez un relevé ou élargissez la période."}]
    if s["Provision"]:
        # même borne des deux côtés : la consommation et la part de la période arrêtées au dernier mois du relevé
        taux, attendu = s["TauxDernierMois"] or 0, s["Attendu"] or 0
        ton = "critique" if (s["TauxProvision"] or 0) > 1 else "attention" if taux > attendu else "bon"
        dire(ton, "Provisions", f"À fin {(s['DernierMois'] or '').lower()}, {_pc(taux)} des provisions sont consommées pour {_pc(attendu)} de la période écoulée"
             f" : {_francs(s['CumulDernierMois'])} sur {_francs(s['Provision'])}.")
        if s["MoisEcoules"] and s["MoisEcoules"] < s["MoisPeriode"]:
            tp = s["TauxProjete"] or 0
            dire("critique" if tp > 1 else "attention" if tp >= float(SEUIL_ALERTE_PROVISION) else "bon", "Projection",
                 f"Au rythme de {_francs(s['Rythme'])} par mois, la consommation atteindrait {_francs(s['Projection'])} en fin de période, "
                 f"soit {_pc(tp)} des provisions.")
    elif s["MoisEcoules"] and s["MoisEcoules"] < s["MoisPeriode"]:
        dire("info", "Projection", f"Au rythme de {_francs(s['Rythme'])} par mois, la consommation atteindrait {_francs(s['Projection'])} en fin de période. "
             "Importez l'état des cotisations pour la comparer aux provisions.")
    depassees = [l for l in a["Entreprises"] if l["Situation"] == "Provision dépassée"]
    prevues = sorted((l for l in a["Entreprises"] if l["Situation"] == "Dépassement prévu"), key=lambda l: -(l["TauxProjete"] or 0))
    nom = lambda l: (l["Entreprises"][0] if l["Entreprises"] else l["Police"]) or "Sans police"  # noqa: E731
    def premiers(noms):
        reste = len(noms) - 3
        return _liste(noms[:3] + ([f"{reste} autre{'s' if reste > 1 else ''}"] if reste > 0 else []))

    if depassees:
        dire("critique", "Provisions dépassées", f"{len(depassees)} entreprise{'s ont' if len(depassees) > 1 else ' a'} déjà consommé plus que "
             f"{'leur' if len(depassees) > 1 else 'sa'} provision : {premiers([nom(l) for l in depassees])}.")
    if prevues:
        dire("critique", "Dépassements prévus", f"{len(prevues)} entreprise{'s dépasseraient leur' if len(prevues) > 1 else ' dépasserait sa'} provision au rythme actuel : "
             + premiers([f"{nom(l)} à {_pc(l['TauxProjete'])}" for l in prevues]) + ".")
    t = s["Tendance"]
    if t and t["Depenses"] is not None and abs(t["Depenses"]) >= 0.1:
        hausse = t["Depenses"] > 0
        dire("attention" if hausse else "bon", "Tendance", f"Les dépenses des {t['Mois']} derniers mois sont en {'hausse' if hausse else 'baisse'} de "
             f"{_pc(abs(t['Depenses']))} sur les {t['Mois']} mois précédents"
             + (f" ; le coût moyen par acte évolue de {'+' if t['CoutParActe'] > 0 else ''}{_pc(t['CoutParActe'])}." if t["CoutParActe"] is not None else "."))
    f = a["Foyers"]
    if f["PlafondDepasse"] or f["PlafondAlerte"]:
        dire("attention", "Plafonds", (f"{f['PlafondDepasse']} foyer{'s ont' if f['PlafondDepasse'] > 1 else ' a'} dépassé son plafond annuel" if f["PlafondDepasse"] else "")
             + (" et " if f["PlafondDepasse"] and f["PlafondAlerte"] else "")
             + (f"{f['PlafondAlerte']} foyer{'s ont' if f['PlafondAlerte'] > 1 else ' a'} consommé plus de 80 % du sien" if f["PlafondAlerte"] else "") + ".")
    chers = a["Prestataires"]["Chers"]
    if chers:
        dire("attention", "Prestataires", f"{len(chers)} centre{'s coûtent' if len(chers) > 1 else ' coûte'} au moins 30 % de plus que la médiane à acte égal, "
             f"dont {chers[0]['Centre']} à l'indice {chers[0]['Indice']}.")
    fam = a["Familles"][:3]
    if fam:
        dire("info", "Familles de prestations", f"{_liste([x['Famille'].lower() for x in fam]).capitalize()} font {_pc(sum(x['Part'] for x in fam))} des dépenses.")
    if f["Top10Pct"]["Foyers"]:
        dire("info", "Concentration", f"10 % des foyers, soit {_fr(f['Top10Pct']['Foyers'])}, concentrent {_pc(f['Top10Pct']['Part'])} des dépenses.")
    if s["Effectif"]:
        dire("info", "Recours aux soins", f"{_pc(s['TauxRecours'])} des bénéficiaires couverts ont consommé au moins une fois ; "
             f"{_fr(s['NonConsommants'])} n'ont aucune prestation sur la période.")
    tranches = [x for x in a["Profil"]["Tranches"] if x["Effectif"] >= EFFECTIF_MIN_TRANCHE and x["CoutParBeneficiaire"]]
    if tranches and s["CoutParBeneficiaire"]:
        haut = max(tranches, key=lambda x: x["CoutParBeneficiaire"])
        rapport = haut["CoutParBeneficiaire"] / s["CoutParBeneficiaire"]
        if rapport >= 1.2:
            dire("info", "Âge", f"Les {haut['Tranche']} coûtent {_francs(haut['CoutParBeneficiaire'])} par bénéficiaire couvert, "
                 f"{f'{rapport:.1f}'.replace('.', ',')} fois la moyenne du portefeuille.")
    if s["Reclame"]:
        dire("info", "Prise en charge", f"Sur {_francs(s['Reclame'])} réclamés, {_francs(s['Depenses'])} sont remboursés, soit {_pc(s['TauxPriseEnCharge'])} ; "
             f"les assurés gardent {_francs(s['ResteACharge'])} à leur charge.")
    d = a["Delais"]
    if d["Mediane"] is not None:
        dire("info", "Délais de paiement", f"La moitié des soins est payée dans les {_fr(d['Mediane'])} jours ; "
             + (f"{_fr(d['Tardifs'])} prestation{'s l’ont été' if d['Tardifs'] > 1 else ' l’a été'} plus de {DELAI_TARDIF} jours après les soins."
                if d["Tardifs"] else f"aucune ne l'a été plus de {DELAI_TARDIF} jours après les soins."))
    # Ce qui demande une action d'abord (critique, puis attention) ; le reste dans l'ordre du raisonnement : provisions, projection, puis le détail
    return sorted(liste, key=lambda c: min(TONS[c["Ton"]], 2))


# ------------------------------------------------------------------ lecture en base
def plafonds_par_college(cursor):
    return {l["college"]: l["plafond"] for l in _lignes(cursor, """SELECT c.college, b.plafond_annuel_famille AS plafond FROM lephare_sante_college c
                                                                  JOIN lephare_sante_bareme b ON b.code = c.code_bareme""") if l["plafond"]}


def analyse(params):
    with connection.cursor() as cursor:
        exercice, du, au, exercices = _periode(cursor, params)
        garant = str(params.get("garant") or "").strip()
        police = str(params.get("police") or "").strip()
        prestations, effectif = charger(cursor, du, au, garant, police)
        liens, polices = rapprochement(cursor, exercice)
        garants = [l["garant"] for l in _lignes(cursor, "SELECT DISTINCT garant FROM lephare_sante_prestation ORDER BY 1") if l["garant"]]
        if garant:
            polices = [l["police"] for l in _lignes(cursor, """SELECT DISTINCT police FROM lephare_sante_prestation WHERE garant = %s
                                                               UNION SELECT DISTINCT police FROM lephare_sante_effectif WHERE garant = %s ORDER BY 1""", [garant, garant])
                       if l["police"]]
        plafonds = plafonds_par_college(cursor)
        cursor.execute("""SELECT EXTRACT(YEAR FROM date_cloture)::int, EXTRACT(MONTH FROM date_cloture)::int, COUNT(*) FROM lephare_sante_prestation
                          WHERE date_cloture BETWEEN %s AND %s GROUP BY 1, 2""", [du, au])
        actes_du_releve = {(a, m): n for a, m, n in cursor.fetchall()}
        medianes_du_releve = None
        if garant or police:
            # même médiane que _mediane() : percentile_cont 0,5 (moyenne des deux valeurs centrales pour un nombre pair)
            cursor.execute("""SELECT acte, percentile_cont(0.5) WITHIN GROUP (ORDER BY mt_reclame) FROM lephare_sante_prestation
                              WHERE date_cloture BETWEEN %s AND %s AND mt_reclame > 0 GROUP BY acte HAVING COUNT(*) >= %s""", [du, au, MIN_ACTES_MEDIANE])
            medianes_du_releve = {acte: Decimal(str(m)) for acte, m in cursor.fetchall()}
    importees = bool(liens)
    if police:
        liens = [l for l in liens if l[1] == police]
    elif garant:
        vues = {p["police"] for p in prestations} | {e["police"] for e in effectif}
        liens = [l for l in liens if l[1] in vues]
    resultat = analyser(prestations, effectif, liens, plafonds, du, au, actes_du_releve, medianes_du_releve)
    resultat.update({"Exercice": exercice, "Exercices": exercices, "Du": _iso(du), "Au": _iso(au), "Garants": garants, "Polices": polices,
                     "Filtre": {"Garant": garant, "Police": police}, "CotisationsImportees": importees, "Calcule": _iso(dt.datetime.now().replace(microsecond=0))})
    return resultat


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_analyse(request):
    """GET /api/consommations/analyse/?exercice=&du=&au=&garant=&police= : analyse complète de la période (onglets d'analyse de l'écran)."""
    return _reponse(analyse, request.query_params)
