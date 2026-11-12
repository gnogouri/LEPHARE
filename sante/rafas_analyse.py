"""
RAFAS : analyse d'une période (plan de l'étude « RAPPORT COMPLET EXAT FEVRIER-JUIN 2026 » d'OREOLE), contrôles et constats.
Fonctions pures : sante/rafas.py charge les données et rend le résultat à l'écran et au rapport Word (mêmes chiffres).

Règles reprises de l'étude :
- période = mois de clôture des relevés (période comptable du gestionnaire), comparée aux mêmes mois de l'année précédente ;
- âge au 31 décembre de l'année de fin de période ; tranches 0-7, 8-11, 12-15, 16-18, 19-21, 22-25, 26-30, 31-40, 41-55, 56 ans et plus ;
- bénéficiaires ayant exposé des frais = matricules distincts du relevé ; taux de recours = ayant exposé / effectif ; dépenses = remboursé ;
- effectif : bénéficiaires de l'effectif du gestionnaire à la date de situation retenue, sauf ceux sortis avant le début de la période ;
  mouvements par comparaison avec l'effectif de l'année précédente (présents les deux années, nouveaux, sortis) ;
- médecins atypiques : ratio actes / patients au-dessus de 3, hors renouvellements de pharmacie sans consultation (bon de prise en charge
  sans acte de consultation) ;
- zone de concentration : tirée du collège du gestionnaire (réglable par collège dans l'onglet Imports).
"""

import datetime as dt
from collections import Counter, defaultdict

from .rafas_lecture import categorie_depuis_college, libelle_mois, normaliser, zone_depuis_college
from .rafas_modeles import ALERTE_BONS, ALERTE_PHARMACIE

STATUTS = {"A": "Assuré", "C": "Conjoint(e)", "E": "Enfant"}
ORDRE_STATUTS = ["Assuré", "Conjoint(e)", "Enfant", "Autre"]
GENRES = ("F", "M")
CATEGORIES = ("AM/O", "CADRES")
NON_RENSEIGNE = "Non renseigné"
TRANCHES = [(0, 7, "0-7 ans"), (8, 11, "8-11 ans"), (12, 15, "12-15 ans"), (16, 18, "16-18 ans"), (19, 21, "19-21 ans"), (22, 25, "22-25 ans"),
            (26, 30, "26-30 ans"), (31, 40, "31-40 ans"), (41, 55, "41-55 ans"), (56, 200, "56 ans et plus")]
TRANCHES_LARGES = [(0, 7, "Âge pédiatrique, 0-7 ans"), (8, 11, "Enfants, 8-11 ans"), (12, 15, "Adolescents, 12-15 ans"), (16, 25, "Jeunes, 16-25 ans"),
                   (26, 40, "Adultes, 26-40 ans"), (41, 55, "Adultes, 41-55 ans"), (56, 200, "56 ans et plus")]
TOP = 20
LIGNES_MAX = 300
SEUIL_FAMILLE = 400000
SEUIL_RATIO_MEDECIN, ACTES_MIN_MEDECIN = 3, 50
SEUIL_ACTES_JOUR = 10
ECART_REPETITION, ECART_HOSPITALISATION = 15, 30
FAMILLES_REPETITION = {"CONSULTATION", "BIOLOGIE", "IMAGERIE & EXAMENS SPECIALISES", "AUTRES EXAMENS", "AUXILIAIRES MEDICAUX", "OPTIQUE", "DENTISTERIE"}
AFFECTIONS_FEMININES = {"GYNECO", "OBSTETRIQUE"}


def div(a, b):
    return a / b if b else None


def age(naissance, annee):
    return annee - naissance.year if naissance else None


def tranche(a, bornes=TRANCHES):
    if a is None or a < 0:
        return NON_RENSEIGNE
    for bas, haut, libelle in bornes:
        if bas <= a <= haut:
            return libelle
    return NON_RENSEIGNE


def ordre_tranches(bornes=TRANCHES):
    return [b[2] for b in bornes] + [NON_RENSEIGNE]


def statut(code):
    return STATUTS.get((code or "").strip().upper(), "Autre")


def mois_entre(du, au):
    resultat, m = [], dt.date(du.year, du.month, 1)
    while m <= au:
        resultat.append(m)
        m = dt.date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    return resultat


def moins_un_an(jour):
    try:
        return jour.replace(year=jour.year - 1)
    except ValueError:  # 29 février
        return jour.replace(year=jour.year - 1, day=28)


def famille_prestation(p):
    return normaliser(p.get("famille")) or "NON RENSEIGNEE"


def _famille_affichee(p):
    return (p.get("famille") or "Non renseignée").strip()


class Contexte:
    """Collèges de la convention, rattachement des collèges du gestionnaire (collège, zone), année de référence des âges."""

    def __init__(self, colleges, liens, annee):
        self.colleges = list(colleges)
        self.par_code = {c["code"]: c for c in self.colleges}
        self.liens = {int(k): v for k, v in (liens or {}).items() if k is not None}
        self.annee = annee

    def libelle(self, code):
        return self.par_code[code]["libelle"] if code in self.par_code else "Collège non rattaché"

    def enrichir(self, x):
        lien = self.liens.get(x.get("code_college")) or {}
        code = lien.get("college") if lien.get("college") in self.par_code else ""
        y = dict(x)
        y["_college"] = code
        y["_categorie"] = self.par_code[code]["categorie"] if code else (lien.get("categorie") or categorie_depuis_college(x.get("college"), x.get("police")))
        y["_zone"] = (lien.get("zone") or zone_depuis_college(x.get("college")) or "Non renseignée").strip()
        y["_age"] = age(x.get("date_naissance"), self.annee)
        y["_tranche"] = tranche(y["_age"])
        y["_large"] = tranche(y["_age"], TRANCHES_LARGES)
        y["_statut"] = statut(x.get("statut") if "statut" in x else x.get("lien"))
        y["_genre"] = (x.get("sexe") or "").upper()[:1] if (x.get("sexe") or "").upper()[:1] in GENRES else ""
        return y


def _garder(lignes, selection):
    return [x for x in lignes if not selection or x["_college"] in selection]


def effectif_de_periode(beneficiaires, du):
    """Bénéficiaires de l'effectif retenu, sauf ceux sortis avant le début de la période."""
    return [b for b in beneficiaires if not b.get("date_sortie") or b["date_sortie"] >= du]


# ------------------------------------------------------------------ briques de calcul
def _groupe():
    return {"Depenses": 0, "Reclame": 0, "Actes": 0, "Consommants": set()}


def _ajouter(g, p):
    g["Depenses"] += p["rembourse"]
    g["Reclame"] += p["reclame"]
    g["Actes"] += 1
    g["Consommants"].add(p["matricule"])


def _ligne_groupe(libelle, g, total_depenses, total_actes, **autres):
    return {"Libelle": libelle, "Depenses": g["Depenses"], "Part": div(g["Depenses"], total_depenses), "Actes": g["Actes"],
            "PartActes": div(g["Actes"], total_actes), "CoutParActe": div(g["Depenses"], g["Actes"]), "Consommants": len(g["Consommants"]), **autres}


def _repartir(prestations, cle, total_depenses, total_actes, ordre=None, limite=None):
    groupes = defaultdict(_groupe)
    for p in prestations:
        _ajouter(groupes[cle(p)], p)
    cles = [k for k in ordre if k in groupes] + [k for k in groupes if k not in ordre] if ordre else sorted(groupes, key=lambda k: -groupes[k]["Depenses"])
    lignes = [_ligne_groupe(k, groupes[k], total_depenses, total_actes) for k in cles]
    return lignes[:limite] if limite else lignes


def _centres(prestations, centre, localite, total_depenses, total_actes):
    groupes, localites = defaultdict(_groupe), defaultdict(Counter)
    for p in prestations:
        nom = p.get(centre) or "Non renseigné"
        _ajouter(groupes[nom], p)
        localites[nom][p.get(localite) or ""] += 1
    lignes = [_ligne_groupe(k, g, total_depenses, total_actes, Localite=localites[k].most_common(1)[0][0]) for k, g in groupes.items()]
    return sorted(lignes, key=lambda l: -l["Depenses"])


def _recours(effectif, prestations, cle, ordre=None):
    """Bénéficiaires ayant exposé des frais, actes, effectif, taux de recours et ratio actes / effectif par groupe."""
    eff = Counter(cle(b) for b in effectif)
    cons, actes, dep = defaultdict(set), Counter(), Counter()
    for p in prestations:
        k = cle(p)
        cons[k].add(p["matricule"])
        actes[k] += 1
        dep[k] += p["rembourse"]
    cles = list(dict.fromkeys(([k for k in ordre if k in eff or k in cons] if ordre else []) + sorted(set(eff) | set(cons), key=lambda k: -eff.get(k, 0))))
    lignes = []
    for k in cles:
        n, c = eff.get(k, 0), len(cons[k])
        lignes.append({"Libelle": k, "Consommants": c, "NonConsommants": max(0, n - c), "Effectif": n, "Actes": actes[k], "Depenses": dep[k],
                       "TauxRecours": div(c, n), "Ratio": div(actes[k], n), "CoutParActe": div(dep[k], actes[k])})
    return lignes


def _total_recours(lignes, libelle="Total général"):
    n, c, a, d = (sum(l[k] for l in lignes) for k in ("Effectif", "Consommants", "Actes", "Depenses"))
    return {"Libelle": libelle, "Consommants": c, "NonConsommants": max(0, n - c), "Effectif": n, "Actes": a, "Depenses": d,
            "TauxRecours": div(c, n), "Ratio": div(a, n), "CoutParActe": div(d, a)}


# ------------------------------------------------------------------ effectifs
def _effectifs(ctx, effectif, reference):
    total = len(effectif)
    total_ref = len(reference) if reference is not None else None
    colleges = [c["code"] for c in ctx.colleges if any(b["_college"] == c["code"] for b in effectif + (reference or []))]
    if any(not b["_college"] for b in effectif + (reference or [])):
        colleges.append("")

    def compte(liste, filtre):
        if liste is None:
            return None
        return sum(1 for b in liste if filtre(b))

    par_college = []
    for code in colleges + ["*"]:
        f = (lambda b, code=code: code == "*" or b["_college"] == code)
        ligne = {"Libelle": "Total général" if code == "*" else ctx.libelle(code), "Code": code}
        for suffixe, liste, tot in (("", effectif, total), ("Ref", reference, total_ref)):
            ligne[f"F{suffixe}"] = compte(liste, lambda b, f=f: f(b) and b["_genre"] == "F")
            ligne[f"M{suffixe}"] = compte(liste, lambda b, f=f: f(b) and b["_genre"] == "M")
            ligne[f"Total{suffixe}"] = compte(liste, f)
            ligne[f"Part{suffixe}"] = div(ligne[f"Total{suffixe}"], tot) if liste is not None else None
        ligne["Ecart"] = ligne["Total"] - ligne["TotalRef"] if reference is not None else None
        ligne["Evolution"] = div(ligne["Ecart"], ligne["TotalRef"]) if reference is not None else None
        par_college.append(ligne)

    mouvements = []
    if reference is not None:
        for code in colleges + ["*"]:
            actuels = {b["matricule"] for b in effectif if code == "*" or b["_college"] == code}
            anciens = {b["matricule"] for b in reference if code == "*" or b["_college"] == code}
            presents, nouveaux, sortis = len(actuels & anciens), len(actuels - anciens), len(anciens - actuels)
            mouvements.append({"Libelle": "Total général" if code == "*" else ctx.libelle(code), "Presents": presents, "TotalRef": len(anciens),
                               "Nouveaux": nouveaux, "Sortis": sortis, "Total": len(actuels), "TauxMaintien": div(presents, len(anciens)),
                               "TauxSortie": div(sortis, len(anciens)), "TauxAdhesion": div(nouveaux, len(anciens))})

    par_statut = []
    for s in ORDRE_STATUTS:
        for g in GENRES + ("*",):
            f = (lambda b, s=s, g=g: b["_statut"] == s and (g == "*" or b["_genre"] == g))
            n, r = compte(effectif, f), compte(reference, f)
            if not n and not r:
                continue
            par_statut.append({"Statut": s, "Genre": "Total" if g == "*" else g, "Nombre": n, "Part": div(n, total), "Ref": r,
                               "PartRef": div(r, total_ref) if r is not None else None, "Ecart": n - r if r is not None else None,
                               "Evolution": div(n - r, r) if r else None})

    categories = [c for c in CATEGORIES if any(b["_categorie"] == c for b in effectif)]
    par_tranche = []
    for t in ordre_tranches():
        ligne = {"Tranche": t}
        for c in categories:
            ligne[c] = {g: compte(effectif, lambda b, c=c, g=g: b["_tranche"] == t and b["_categorie"] == c and b["_genre"] == g) for g in GENRES}
            ligne[c]["Total"] = compte(effectif, lambda b, c=c: b["_tranche"] == t and b["_categorie"] == c)
        ligne["Total"] = compte(effectif, lambda b: b["_tranche"] == t)
        ligne["Part"] = div(ligne["Total"], total)
        if ligne["Total"]:
            par_tranche.append(ligne)

    tranches_comparees = []
    for t in ordre_tranches(TRANCHES_LARGES):
        for g in GENRES + ("*",):
            f = (lambda b, t=t, g=g: b["_large"] == t and (g == "*" or b["_genre"] == g))
            n, r = compte(effectif, f), compte(reference, f)
            if not n and not r:
                continue
            tranches_comparees.append({"Tranche": t, "Genre": "Total" if g == "*" else g, "Nombre": n, "Ref": r,
                                       "Ecart": n - r if r is not None else None, "Evolution": div(n - r, r) if r else None})

    zones = sorted({b["_zone"] for b in effectif}, key=lambda z: -sum(1 for b in effectif if b["_zone"] == z))
    par_zone, zone_statut = [], []
    for z in zones:
        dans = [b for b in effectif if b["_zone"] == z]
        ligne = {"Zone": z, "Total": len(dans), "Part": div(len(dans), total)}
        for c in categories:
            de_c = [b for b in dans if b["_categorie"] == c]
            tot_c = sum(1 for b in effectif if b["_categorie"] == c)
            ligne[c] = {"F": sum(1 for b in de_c if b["_genre"] == "F"), "M": sum(1 for b in de_c if b["_genre"] == "M"), "Total": len(de_c),
                        "Part": div(len(de_c), tot_c)}
        par_zone.append(ligne)
        ls = {"Zone": z, "Total": len(dans)}
        for s in ("Assuré", "Conjoint(e)", "Enfant"):
            de_s = [b for b in dans if b["_statut"] == s]
            ls[s] = {**{c: sum(1 for b in de_s if b["_categorie"] == c) for c in categories},
                     **{g: sum(1 for b in de_s if b["_genre"] == g) for g in GENRES}, "Total": len(de_s)}
        zone_statut.append(ls)
    return {"Total": total, "TotalRef": total_ref, "Categories": categories, "ParCollege": par_college, "Mouvements": mouvements,
            "ParStatut": par_statut, "ParTranche": par_tranche, "TranchesComparees": tranches_comparees, "ParZone": par_zone, "ZoneStatut": zone_statut}


# ------------------------------------------------------------------ dépenses
def _depenses(ctx, effectif, prestations, mois, ref_par_mois, seuil_famille):
    total = sum(p["rembourse"] for p in prestations)
    actes = len(prestations)
    colleges = [c["code"] for c in ctx.colleges if any(p["_college"] == c["code"] for p in prestations)]
    if any(not p["_college"] for p in prestations):
        colleges.append("")

    recours = []
    for code in colleges:
        eff = [b for b in effectif if b["_college"] == code]
        pre = [p for p in prestations if p["_college"] == code]
        lignes = _recours(eff, pre, lambda x: x["_statut"], ORDRE_STATUTS)
        recours.append({"College": ctx.libelle(code), "Code": code, "Lignes": lignes, "Total": _total_recours(lignes, f"Total {ctx.libelle(code)}")})
    recours_total = _total_recours([r["Total"] for r in recours])

    par_statut = []
    eff_statut = Counter(b["_statut"] for b in effectif)
    for l in _repartir(prestations, lambda p: p["_statut"], total, actes, ORDRE_STATUTS):
        par_statut.append({**l, "Effectif": eff_statut.get(l["Libelle"], 0), "PartEffectif": div(eff_statut.get(l["Libelle"], 0), len(effectif)),
                           "PartConsommants": div(l["Consommants"], len({p["matricule"] for p in prestations}))})
    statut_college = []
    for code in colleges:
        pre = [p for p in prestations if p["_college"] == code]
        t = sum(p["rembourse"] for p in pre)
        lignes = _repartir(pre, lambda p: p["_statut"], t, len(pre), ORDRE_STATUTS)
        statut_college.append({"College": ctx.libelle(code), "Lignes": lignes,
                               "Total": _ligne_groupe(f"Total {ctx.libelle(code)}", {"Depenses": t, "Reclame": 0, "Actes": len(pre), "Consommants": {p["matricule"] for p in pre}}, t, len(pre))})

    tranches = _recours(effectif, prestations, lambda x: x["_tranche"], ordre_tranches())
    for l in tranches:
        l["Part"] = div(l["Depenses"], total)

    mensuel = []
    for m in mois:
        du_mois = [p for p in prestations if p["mois"] == m]
        d = sum(p["rembourse"] for p in du_mois)
        ref = ref_par_mois.get(moins_un_an(m)) if ref_par_mois is not None else None
        mensuel.append({"Mois": m.isoformat(), "Libelle": libelle_mois(m), "LibelleCourt": libelle_mois(m, court=True), "Depenses": d,
                        "Part": div(d, total), "Actes": len(du_mois), "Consommants": len({p["matricule"] for p in du_mois}),
                        "ParCollege": {code or "-": sum(p["rembourse"] for p in du_mois if p["_college"] == code) for code in colleges},
                        "DepensesRef": ref["Depenses"] if ref else (0 if ref_par_mois is not None else None),
                        "ActesRef": ref["Actes"] if ref else (0 if ref_par_mois is not None else None)})

    zones = _recours(effectif, prestations, lambda x: x["_zone"])
    for z in zones:
        z["Part"] = div(z["Depenses"], total)
        z["Mensuel"] = [sum(p["rembourse"] for p in prestations if p["_zone"] == z["Libelle"] and p["mois"] == m) for m in mois]
    zones.sort(key=lambda z: -z["Depenses"])

    affections = sorted({p["affection"] or "NON RENSEIGNEE" for p in prestations}, key=lambda a: -sum(p["rembourse"] for p in prestations if (p["affection"] or "NON RENSEIGNEE") == a))
    affection_statut, affection_tranche = [], []
    tranches_presentes = [t for t in ordre_tranches() if any(p["_tranche"] == t for p in prestations)]
    for a in affections:
        de_a = [p for p in prestations if (p["affection"] or "NON RENSEIGNEE") == a]
        affection_statut.append({"Affection": a, **{s: {"Depenses": sum(p["rembourse"] for p in de_a if p["_statut"] == s), "Actes": sum(1 for p in de_a if p["_statut"] == s)}
                                                    for s in ("Assuré", "Conjoint(e)", "Enfant")},
                                 "Total": {"Depenses": sum(p["rembourse"] for p in de_a), "Actes": len(de_a)}})
        affection_tranche.append({"Affection": a, "Tranches": {t: {"Depenses": sum(p["rembourse"] for p in de_a if p["_tranche"] == t),
                                                                   "Actes": sum(1 for p in de_a if p["_tranche"] == t)} for t in tranches_presentes},
                                  "Total": {"Depenses": sum(p["rembourse"] for p in de_a), "Actes": len(de_a)}})

    familles = _repartir(prestations, _famille_affichee, total, actes)
    familles_mois = [{"Famille": f["Libelle"], "Valeurs": [sum(p["rembourse"] for p in prestations if _famille_affichee(p) == f["Libelle"] and p["mois"] == m) for m in mois],
                      "Total": f["Depenses"]} for f in familles]
    actes_top = _repartir(prestations, lambda p: p.get("acte") or "Non renseigné", total, actes, limite=TOP)

    # Familles (foyers) : assuré principal et ses ayants droit
    par_foyer = defaultdict(list)
    for p in prestations:
        par_foyer[p.get("matricule_adherent") or p["matricule"]].append(p)
    foyers = []
    for matricule, ps in par_foyer.items():
        noms = Counter(p.get("assure") for p in ps if p.get("assure"))
        foyers.append({"Matricule": matricule, "Assure": noms.most_common(1)[0][0] if noms else str(matricule), "Depenses": sum(p["rembourse"] for p in ps),
                       "Actes": len(ps), "Lignes": ps})
    foyers.sort(key=lambda f: -f["Depenses"])

    def detail_foyer(f, par_famille):
        groupes = defaultdict(_groupe)
        for p in f["Lignes"]:
            _ajouter(groupes[(p.get("patient") or str(p["matricule"]), _famille_affichee(p) if par_famille else "")], p)
        lignes = [{"Patient": k[0], "Famille": k[1], "Depenses": g["Depenses"], "Actes": g["Actes"], "Part": div(g["Depenses"], total),
                   "PartActes": div(g["Actes"], actes), "CoutParActe": div(g["Depenses"], g["Actes"])} for k, g in groupes.items()]
        return sorted(lignes, key=lambda l: (l["Patient"], -l["Depenses"]))

    top_familles = [{"Assure": f["Assure"], "Matricule": f["Matricule"], "Depenses": f["Depenses"], "Actes": f["Actes"],
                     "Lignes": detail_foyer(f, True)} for f in foyers[:5]]
    au_dessus = [f for f in foyers if f["Depenses"] > seuil_famille]
    familles_seuil = {"Seuil": seuil_famille, "Familles": [{"Assure": f["Assure"], "Matricule": f["Matricule"], "Depenses": f["Depenses"],
                                                            "Part": div(f["Depenses"], total), "Actes": f["Actes"], "PartActes": div(f["Actes"], actes),
                                                            "CoutParActe": div(f["Depenses"], f["Actes"]), "Lignes": detail_foyer(f, False)} for f in au_dessus],
                      "Depenses": sum(f["Depenses"] for f in au_dessus), "Actes": sum(f["Actes"] for f in au_dessus)}
    familles_seuil.update(Part=div(familles_seuil["Depenses"], total), PartActes=div(familles_seuil["Actes"], actes),
                          CoutParActe=div(familles_seuil["Depenses"], familles_seuil["Actes"]))
    # Concentration : part des dépenses portée par les foyers les plus dépensiers
    cumul, concentration = 0, []
    for i, f in enumerate(foyers, start=1):
        cumul += f["Depenses"]
        concentration.append({"PartFoyers": i / len(foyers), "PartDepenses": div(cumul, total) or 0})
    if len(concentration) > 60:
        pas = len(concentration) / 60
        concentration = [concentration[int(i * pas)] for i in range(60)] + [concentration[-1]]

    return {
        "Recours": recours, "RecoursTotal": recours_total, "ParStatut": par_statut, "StatutParCollege": statut_college, "Tranches": tranches,
        "Mensuel": mensuel, "Zones": zones,
        "LocalitesPrescripteurs": _repartir(prestations, lambda p: p.get("localite_prescripteur") or "Non renseignée", total, actes),
        "Prescripteurs": _centres(prestations, "centre_prescripteur", "localite_prescripteur", total, actes)[:TOP],
        "LocalitesExecutants": _repartir(prestations, lambda p: p.get("localite_executant") or "Non renseignée", total, actes),
        "Executants": _centres(prestations, "centre_executant", "localite_executant", total, actes)[:TOP],
        "AffectionStatut": affection_statut, "AffectionTranche": affection_tranche, "TranchesAffection": tranches_presentes,
        "Familles": familles, "FamillesMois": familles_mois, "Actes": actes_top, "TopFamilles": top_familles, "FamillesSeuil": familles_seuil,
        "Foyers": len(foyers), "Concentration": concentration,
    }


def _comparatif(ctx, prestations, prestations_ref, mois):
    if prestations_ref is None:
        return {"Disponible": False}

    def serie(ps, psr):
        lignes = []
        for m in mois:
            r = moins_un_an(m)
            d, a = sum(p["rembourse"] for p in ps if p["mois"] == m), sum(1 for p in ps if p["mois"] == m)
            dr, ar = sum(p["rembourse"] for p in psr if p["mois"] == r), sum(1 for p in psr if p["mois"] == r)
            lignes.append({"Mois": m.isoformat(), "Libelle": libelle_mois(m), "DepensesRef": dr, "ActesRef": ar, "Depenses": d, "Actes": a,
                           "Ecart": d - dr, "EcartActes": a - ar, "Evolution": div(d - dr, dr), "EvolutionActes": div(a - ar, ar)})
        d, a = sum(l["Depenses"] for l in lignes), sum(l["Actes"] for l in lignes)
        dr, ar = sum(l["DepensesRef"] for l in lignes), sum(l["ActesRef"] for l in lignes)
        return {"Mois": lignes, "Total": {"DepensesRef": dr, "ActesRef": ar, "Depenses": d, "Actes": a, "Ecart": d - dr, "EcartActes": a - ar,
                                          "Evolution": div(d - dr, dr), "EvolutionActes": div(a - ar, ar)}}

    codes = [c["code"] for c in ctx.colleges if any(p["_college"] == c["code"] for p in prestations + prestations_ref)]
    return {"Disponible": True, "Global": serie(prestations, prestations_ref),
            "ParCollege": [{"College": ctx.libelle(code), **serie([p for p in prestations if p["_college"] == code],
                                                                   [p for p in prestations_ref if p["_college"] == code])} for code in codes]}


# ------------------------------------------------------------------ contrôles
def _cle_doublon(p):
    return (p["matricule"], p.get("date_soins"), normaliser(p.get("acte")), normaliser(p.get("medecin")), p["reclame"], p["rembourse"])


def _controle(code, titre, gravite, description, action, colonnes, lignes, montant=None, nombre=None):
    return {"Code": code, "Titre": titre, "Gravite": gravite, "Description": description, "Action": action, "Colonnes": colonnes,
            "Lignes": lignes[:LIGNES_MAX], "Nombre": len(lignes) if nombre is None else nombre, "Tronque": len(lignes) > LIGNES_MAX,
            "Montant": montant}


def _d(jour):
    return jour.strftime("%d/%m/%Y") if jour else ""


def controles(ctx, convention, effectif, prestations, tous_beneficiaires, prestations_exercice, colleges_exercice, du, au):
    """Incohérences de l'effectif et des dépenses (partie IV de l'étude), puis contrôles du barème de la convention."""
    resultat = []
    annee = ctx.annee
    age_enfant, age_etudiant, age_adulte = convention.get("age_enfant") or 21, convention.get("age_etudiant") or 25, convention.get("age_adulte") or 60
    enfants_max = convention.get("enfants_max") or 4

    # C01 doublons d'identité : même nom et même date de naissance sous deux matricules
    identites = defaultdict(list)
    for b in effectif:
        if b.get("nom") and b.get("date_naissance"):
            identites[(normaliser(b["nom"]), b["date_naissance"])].append(b)
    lignes = []
    for (_nom, naissance), bs in identites.items():
        if len({b["matricule"] for b in bs}) > 1:
            lignes.append([bs[0].get("adherent") or "", " / ".join(str(b["matricule"]) for b in bs), bs[0]["nom"], _d(naissance),
                           f"{bs[0]['_age']} ans" if bs[0]["_age"] is not None else "", " / ".join(sorted({ctx.libelle(b['_college']) for b in bs}))])
    resultat.append(_controle("C01", "Doublons d'identité", "attention", "Même nom et même date de naissance sous plusieurs matricules de bénéficiaire.",
                              "Demander au gestionnaire de fusionner les fiches et de retirer le matricule en trop.",
                              ["Adhérent", "Matricules", "Bénéficiaire", "Naissance", "Âge", "Collège"], lignes))

    # C02 conjoint mineur, C03 enfant au-delà de l'âge limite, C04 enfant étudiant à justifier, C05 adultes de 60 ans et plus
    def liste(filtre):
        return [[b.get("adherent") or "", str(b["matricule"]), b.get("nom") or "", b["_statut"], _d(b.get("date_naissance")), f"{b['_age']} ans",
                 ctx.libelle(b["_college"])] for b in effectif if b["_age"] is not None and filtre(b)]
    colonnes = ["Adhérent", "Matricule", "Bénéficiaire", "Statut", "Naissance", f"Âge au 31/12/{annee}", "Collège"]
    resultat.append(_controle("C02", "Conjoints mineurs", "attention", "Conjoint de moins de 18 ans au 31 décembre : erreur de statut ou de date de naissance probable.",
                              "Faire corriger le statut ou la date de naissance par le gestionnaire.", colonnes,
                              liste(lambda b: b["_statut"] == "Conjoint(e)" and b["_age"] < 18)))
    resultat.append(_controle("C03", f"Enfants de plus de {age_etudiant} ans", "critique",
                              f"Enfants au-delà de {age_etudiant} ans au 31 décembre : ils ne bénéficient plus du régime (convention, effectif assuré).",
                              "Demander leur retrait au gestionnaire, sauf décision contraire de l'employeur.", colonnes,
                              liste(lambda b: b["_statut"] == "Enfant" and b["_age"] > age_etudiant)))
    resultat.append(_controle("C04", f"Enfants de {age_enfant} à {age_etudiant} ans", "info",
                              f"Un enfant qui atteint {age_enfant} ans sort du régime ; il reste couvert jusqu'à {age_etudiant} ans sur certificat de "
                              "fréquentation (poursuite d'études, à la charge du parent assuré).",
                              "Vérifier que le certificat de fréquentation de l'année est au dossier.", colonnes,
                              liste(lambda b: b["_statut"] == "Enfant" and age_enfant <= b["_age"] <= age_etudiant)))
    resultat.append(_controle("C05", f"Adultes de {age_adulte} ans et plus", "info",
                              f"La convention arrête la garantie à {age_adulte} ans ; à titre exceptionnel, ils restent couverts tant que l'employeur ne demande pas leur retrait.",
                              "Faire confirmer leur maintien par l'employeur.", colonnes,
                              liste(lambda b: b["_statut"] in ("Assuré", "Conjoint(e)") and b["_age"] >= age_adulte)))

    # C06 familles hors composition
    foyers = defaultdict(list)
    for b in effectif:
        foyers[b.get("matricule_adherent") or b["matricule"]].append(b)
    lignes = []
    for m, bs in foyers.items():
        conjoints = sum(1 for b in bs if b["_statut"] == "Conjoint(e)")
        enfants = sum(1 for b in bs if b["_statut"] == "Enfant")
        if conjoints > 1 or enfants > enfants_max:
            lignes.append([bs[0].get("adherent") or "", str(m), conjoints, enfants, len(bs), ctx.libelle(bs[0]["_college"])])
    resultat.append(_controle("C06", "Familles au-delà de la composition prévue", "info",
                              f"La famille est composée de {convention.get('composition_famille') or 'Mr + Mme + 4 enfants'} : plus d'un conjoint ou plus de {enfants_max} enfants.",
                              "Vérifier avec l'employeur les ayants droit admis au-delà de la composition prévue.",
                              ["Adhérent", "Matricule", "Conjoints", "Enfants", "Bénéficiaires", "Collège"], lignes))

    # C07 doublons dans les dépenses
    groupes = defaultdict(list)
    for p in prestations:
        groupes[_cle_doublon(p)].append(p)
    lignes, montant_double = [], 0
    for cle, ps in groupes.items():
        if len(ps) > 1:
            montant_double += sum(p["rembourse"] for p in ps[1:])
            p = ps[0]
            lignes.append([str(p["matricule"]), p.get("patient") or "", p.get("medecin") or "", _d(p.get("date_soins")), p.get("acte") or "", p.get("affection") or "",
                           len(ps), p["reclame"], p["rembourse"], p["rembourse"] * (len(ps) - 1)])
    lignes.sort(key=lambda l: -l[-1])
    resultat.append(_controle("C07", "Doublons dans les dépenses", "critique",
                              "Même bénéficiaire, même date de soins, même acte, même médecin et mêmes montants sur plusieurs lignes du relevé.",
                              "Demander au gestionnaire l'annulation des lignes en double ou leur justification.",
                              ["Matricule", "Patient", "Médecin", "Date de soins", "Acte", "Affection", "Lignes", "Réclamé", "Remboursé", "Remboursé en double"],
                              lignes, montant=montant_double))

    # C08 médecins atypiques (hors renouvellements de pharmacie sans consultation)
    bons_consultation = {(p["matricule"], p.get("date_consultation")) for p in prestations if famille_prestation(p) == "CONSULTATION"}
    renouvellements = [famille_prestation(p) == "PHARMACIE" and (p["matricule"], p.get("date_consultation")) not in bons_consultation for p in prestations]
    nettes = [p for p, r in zip(prestations, renouvellements) if not r]
    retires = Counter(normaliser(p.get("medecin")) for p, r in zip(prestations, renouvellements) if r)
    medecins = defaultdict(list)
    for p in nettes:
        if p.get("medecin"):
            medecins[p["medecin"]].append(p)
    lignes = []
    for nom, ps in medecins.items():
        patients = len({p["matricule"] for p in ps})
        ratio = div(len(ps), patients)
        if len(ps) >= ACTES_MIN_MEDECIN and ratio and ratio > SEUIL_RATIO_MEDECIN:
            centres = Counter(p.get("centre_prescripteur") or "" for p in ps)
            lignes.append([nom, len(ps), patients, len({p.get("date_soins") for p in ps}), sum(p["reclame"] for p in ps), sum(p["rembourse"] for p in ps),
                           round(ratio, 2), centres.most_common(1)[0][0], retires.get(normaliser(nom), 0)])
    lignes.sort(key=lambda l: -l[5])
    resultat.append(_controle("C08", "Médecins aux prescriptions atypiques", "attention",
                              f"Plus de {SEUIL_RATIO_MEDECIN} actes par patient (au moins {ACTES_MIN_MEDECIN} actes), renouvellements de pharmacie sans consultation exclus.",
                              "Faire examiner ces profils par le médecin-conseil du gestionnaire.",
                              ["Médecin", "Actes", "Patients", "Jours", "Réclamé", "Remboursé", "Actes par patient", "Centre principal", "Renouvellements exclus"],
                              lignes, montant=sum(l[5] for l in lignes)))

    # C09 actes nombreux en une journée
    par_jour = defaultdict(list)
    for p in prestations:
        if p.get("date_soins"):
            par_jour[(p["matricule"], p["date_soins"])].append(p)
    lignes = []
    for (matricule, jour), ps in par_jour.items():
        actes_distincts = {normaliser(p.get("acte")) for p in ps}
        if len(actes_distincts) > SEUIL_ACTES_JOUR:
            lignes.append([str(matricule), ps[0].get("patient") or "", _d(jour), len(actes_distincts), sum(p["rembourse"] for p in ps),
                           ", ".join(sorted({p.get("acte") or "" for p in ps})[:30])])
    lignes.sort(key=lambda l: -l[3])
    resultat.append(_controle("C09", f"Plus de {SEUIL_ACTES_JOUR} actes en une journée", "attention",
                              f"Bénéficiaires ayant cumulé plus de {SEUIL_ACTES_JOUR} actes différents le même jour.",
                              "Demander les prescriptions et vérifier la cohérence des bilans réalisés.",
                              ["Matricule", "Patient", "Date", "Actes différents", "Remboursé", "Actes"], lignes, montant=sum(l[4] for l in lignes)))

    # C10 actes répétés en moins de 15 jours (hors pharmacie)
    suites = defaultdict(list)
    for p in prestations:
        if famille_prestation(p) in FAMILLES_REPETITION and p.get("date_soins"):
            suites[(p["matricule"], normaliser(p.get("acte")))].append(p)
    lignes = []
    for (_m, _acte), ps in suites.items():
        ps = sorted(ps, key=lambda p: p["date_soins"])
        for a, b in zip(ps, ps[1:]):
            ecart = (b["date_soins"] - a["date_soins"]).days
            if 0 < ecart <= ECART_REPETITION:
                lignes.append([str(b["matricule"]), b.get("patient") or "", b.get("acte") or "", _d(a["date_soins"]), _d(b["date_soins"]), ecart,
                               a.get("centre_executant") or "", b.get("centre_executant") or "", a["rembourse"] + b["rembourse"]])
    lignes.sort(key=lambda l: (l[5], -l[8]))
    resultat.append(_controle("C10", f"Actes répétés en moins de {ECART_REPETITION} jours", "attention",
                              f"Même acte pour le même bénéficiaire à {ECART_REPETITION} jours au plus (consultations, biologie, imagerie, auxiliaires médicaux, optique, dentaire).",
                              "Vérifier la justification médicale du renouvellement.",
                              ["Matricule", "Patient", "Acte", "1re date", "2e date", "Écart (jours)", "Centre 1", "Centre 2", "Remboursé"], lignes,
                              montant=sum(l[8] for l in lignes)))

    # C11 hospitalisations rapprochées
    hospitalisations = defaultdict(list)
    for p in prestations:
        if famille_prestation(p) == "HOSPITALISATION" and p.get("date_soins"):
            hospitalisations[p["matricule"]].append(p)
    lignes = []
    for _m, ps in hospitalisations.items():
        ps = sorted(ps, key=lambda p: p["date_soins"])
        for a, b in zip(ps, ps[1:]):
            ecart = (b["date_soins"] - a["date_soins"]).days
            if 0 < ecart < ECART_HOSPITALISATION:
                lignes.append([str(b["matricule"]), b.get("patient") or "", _d(a["date_soins"]), _d(b["date_soins"]), ecart, b.get("medecin") or "",
                               a["reclame"], b["reclame"], a["rembourse"], b["rembourse"]])
    resultat.append(_controle("C11", f"Hospitalisations à moins de {ECART_HOSPITALISATION} jours d'intervalle", "attention",
                              "Deux hospitalisations du même bénéficiaire à moins d'un mois d'intervalle.",
                              "Demander les comptes rendus d'hospitalisation.",
                              ["Matricule", "Patient", "1re hospitalisation", "2e hospitalisation", "Écart (jours)", "Médecin", "Réclamé 1", "Réclamé 2",
                               "Remboursé 1", "Remboursé 2"], lignes, montant=sum(l[8] + l[9] for l in lignes)))

    # C12 hospitalisation chirurgicale hors norme
    chirurgie = [p for p in prestations if "CHIRURG" in normaliser(p.get("acte")) and famille_prestation(p) == "HOSPITALISATION"]
    lignes = []
    if len(chirurgie) >= 3:
        for p in chirurgie:
            autres = [q["reclame"] for q in chirurgie if q is not p]
            moyenne = sum(autres) / len(autres)
            if moyenne and p["reclame"] > 2 * moyenne:
                lignes.append([str(p["matricule"]), p.get("patient") or "", ctx.libelle(p["_college"]), p.get("centre_prescripteur") or "", p.get("medecin") or "",
                               p.get("localite_prescripteur") or "", p["reclame"], p["rembourse"], round(moyenne)])
    resultat.append(_controle("C12", "Hospitalisations chirurgicales hors norme", "attention",
                              "Montant réclamé plus de deux fois supérieur à la moyenne des autres hospitalisations chirurgicales de la période.",
                              "Demander la facture détaillée et le compte rendu opératoire.",
                              ["Matricule", "Patient", "Collège", "Centre prescripteur", "Médecin", "Localité", "Réclamé", "Remboursé", "Moyenne des autres"],
                              lignes, montant=sum(l[7] for l in lignes)))

    # C13 incohérences sexe et affection
    lignes = [[str(p["matricule"]), p.get("assure") or "", p.get("patient") or "", p.get("sexe") or "", p.get("affection") or "", p.get("acte") or "",
               p.get("medecin") or "", p["rembourse"]]
              for p in prestations if p.get("sexe") == "M" and (normaliser(p.get("affection")) in AFFECTIONS_FEMININES or famille_prestation(p) == "MATERNITE")]
    resultat.append(_controle("C13", "Incohérences entre le sexe et l'affection", "attention",
                              "Affection gynécologique, obstétrique ou maternité pour un bénéficiaire de sexe masculin : erreur de sexe à la fiche ou de bénéficiaire.",
                              "Faire corriger la fiche du bénéficiaire ou la prestation par le gestionnaire.",
                              ["Matricule", "Assuré", "Patient", "Sexe", "Affection", "Acte", "Médecin", "Remboursé"], lignes, montant=sum(l[7] for l in lignes)))

    # C14 remboursé supérieur au réclamé
    lignes = [[str(p["matricule"]), p.get("patient") or "", p.get("medecin") or "", p.get("acte") or "", _d(p.get("date_soins")), p.get("centre_executant") or "",
               p.get("localite_executant") or "", p["reclame"], p["rembourse"], p["rembourse"] - p["reclame"]] for p in prestations if p["rembourse"] > p["reclame"]]
    resultat.append(_controle("C14", "Remboursé supérieur au montant réclamé", "critique",
                              "Le gestionnaire a remboursé plus que le montant réclamé par le prestataire.",
                              "Demander la régularisation au gestionnaire.",
                              ["Matricule", "Patient", "Médecin", "Acte", "Date de soins", "Centre exécutant", "Localité", "Réclamé", "Remboursé", "Excédent"],
                              lignes, montant=sum(l[9] for l in lignes)))

    # C15 soins hors couverture : bénéficiaire jamais vu dans un effectif importé, ou soins avant l'entrée ou après la sortie
    connus = {}
    for b in tous_beneficiaires:
        connus.setdefault(b["matricule"], []).append(b)
    lignes = []
    for p in prestations:
        fiches = connus.get(p["matricule"])
        motif = None
        if not fiches:
            motif = "Absent des effectifs importés"
        elif p.get("date_soins"):
            entrees = [b.get("date_entree") or b.get("date_effet") for b in fiches if b.get("date_entree") or b.get("date_effet")]
            sorties = [b.get("date_sortie") for b in fiches]
            if entrees and p["date_soins"] < min(entrees):
                motif = f"Soins avant l'entrée du {_d(min(entrees))}"
            elif sorties and all(sorties) and p["date_soins"] > max(sorties):
                motif = f"Soins après la sortie du {_d(max(sorties))}"
        if motif:
            lignes.append([str(p["matricule"]), p.get("patient") or "", _d(p.get("date_soins")), p.get("acte") or "", p["rembourse"], motif])
    resultat.append(_controle("C15", "Soins hors période de couverture", "attention",
                              "Bénéficiaire absent de tous les effectifs importés, ou soins datés avant son entrée ou après sa sortie.",
                              "Vérifier l'affiliation à la date des soins avec le gestionnaire (importez aussi les effectifs antérieurs).",
                              ["Matricule", "Patient", "Date de soins", "Acte", "Remboursé", "Constat"], lignes, montant=sum(l[4] for l in lignes)))

    # Contrôles du barème sur l'exercice de la fin de période
    plafonds = {c["code"]: c for c in colleges_exercice}
    par_foyer = defaultdict(int)
    nom_foyer, college_foyer = {}, {}
    for p in prestations_exercice:
        k = p.get("matricule_adherent") or p["matricule"]
        par_foyer[k] += p["rembourse"]
        nom_foyer.setdefault(k, p.get("assure") or "")
        college_foyer.setdefault(k, p["_college"])
    lignes = []
    for k, total in par_foyer.items():
        c = plafonds.get(college_foyer[k])
        plafond = int(c["plafond_famille"]) if c and c.get("plafond_famille") else None
        if plafond and total >= 0.8 * plafond:
            lignes.append([nom_foyer[k], str(k), ctx.libelle(college_foyer[k]), total, plafond, f"{total / plafond * 100:.0f} %",
                           "Plafond dépassé" if total > plafond else "80 % atteints"])
    lignes.sort(key=lambda l: -l[3] / l[4])
    resultat.append(_controle("C16", "Plafond annuel par famille", "critique" if any(l[6] == "Plafond dépassé" for l in lignes) else "attention",
                              "Familles qui ont consommé 80 % au moins de leur plafond annuel de remboursement sur l'exercice.",
                              "Prévenir l'employeur ; au-delà du plafond, les frais restent à la charge de la famille.",
                              ["Assuré", "Matricule adhérent", "Collège", "Consommé sur l'exercice", "Plafond", "Taux", "Situation"], lignes))

    bons, pharmacie, noms = defaultdict(set), defaultdict(int), {}
    for p in prestations_exercice:
        if p.get("date_consultation"):
            bons[p["matricule"]].add(p["date_consultation"])
        if famille_prestation(p) == "PHARMACIE":
            pharmacie[p["matricule"]] += p["rembourse"]
        noms.setdefault(p["matricule"], p.get("patient") or "")
    lignes = [[str(m), noms[m], len(bons[m]), pharmacie[m]] for m in noms if len(bons[m]) >= ALERTE_BONS or pharmacie[m] >= ALERTE_PHARMACIE]
    lignes.sort(key=lambda l: -l[3])
    resultat.append(_controle("C17", "Quota d'alerte automatique", "info",
                              f"Bénéficiaires ayant atteint le {ALERTE_BONS}e bon de prise en charge ou {ALERTE_PHARMACIE:,} F de frais pharmaceutiques sur l'exercice.".replace(",", " "),
                              "Suivre ces dossiers avec le médecin-conseil du gestionnaire.",
                              ["Matricule", "Patient", "Bons de prise en charge", "Pharmacie remboursée"], lignes))

    def plafond_bareme(code_college, controle):
        c = plafonds.get(code_college)
        for ligne in (c or {}).get("bareme") or []:
            if ligne.get("Controle") == controle and ligne.get("Plafond"):
                return int(ligne["Plafond"])
        return None

    for code, titre, filtre, unite in (
            ("C18", "Plafond optique dépassé", lambda p: famille_prestation(p) == "OPTIQUE", "OPTIQUE"),
            ("C19", "Plafond dentaire dépassé", lambda p: famille_prestation(p) == "DENTISTERIE" and "PROTHESE" not in normaliser(p.get("acte")), "DENTAIRE")):
        cumul, nom, college = defaultdict(int), {}, {}
        for p in prestations_exercice:
            if filtre(p):
                cumul[p["matricule"]] += p["rembourse"]
                nom.setdefault(p["matricule"], p.get("patient") or "")
                college.setdefault(p["matricule"], p["_college"])
        lignes = []
        for m, total in cumul.items():
            plafond = plafond_bareme(college[m], unite)
            if plafond and total > plafond:
                lignes.append([str(m), nom[m], ctx.libelle(college[m]), total, plafond, total - plafond])
        resultat.append(_controle(code, titre, "attention",
                                  "Remboursements de l'exercice au-delà du plafond du barème du collège"
                                  + (" (verres et monture, plafond tous les 2 ans calendaires)." if unite == "OPTIQUE" else " (soins dentaires hors prothèses)."),
                                  "Demander au gestionnaire l'application du plafond du barème.",
                                  ["Matricule", "Patient", "Collège", "Remboursé", "Plafond", "Au-delà du plafond"], lignes, montant=sum(l[5] for l in lignes)))
    return resultat


# ------------------------------------------------------------------ constats
def _pct(v):
    return "-" if v is None else f"{v * 100:.1f} %".replace(".", ",")


def _f(v):
    return f"{round(v):,}".replace(",", " ") + " F"


def _n(v):
    return f"{round(v):,}".replace(",", " ")


def constats(synthese, effectifs, depenses, comparatif, liste_controles):
    c = []
    if effectifs["TotalRef"]:
        ecart = effectifs["Total"] - effectifs["TotalRef"]
        c.append({"Titre": "Effectif", "Ton": "info", "Texte": f"{_n(effectifs['Total'])} bénéficiaires contre {_n(effectifs['TotalRef'])} un an plus tôt "
                  f"({'+' if ecart >= 0 else '-'}{_n(abs(ecart))}, {_pct(div(ecart, effectifs['TotalRef']))})."})
    if synthese["TauxRecours"] is not None and synthese["Actes"]:
        c.append({"Titre": "Recours aux soins", "Ton": "info", "Texte": f"{_n(synthese['Consommants'])} bénéficiaires sur {_n(synthese['Effectif'])} ont exposé des frais, "
                  f"soit un taux de recours de {_pct(synthese['TauxRecours'])}, pour {_n(synthese['Actes'])} actes."})
    if not synthese["Actes"]:
        c.append({"Titre": "Aucune prestation", "Ton": "attention", "Texte": "Aucune prestation des collèges choisis n'est clôturée sur ces mois : importez le relevé du "
                  "gestionnaire ou élargissez la période."})
    if depenses["Familles"] and synthese["Depenses"]:
        f = depenses["Familles"][0]
        c.append({"Titre": "Premier poste", "Ton": "info", "Texte": f"{f['Libelle'].capitalize()} : {_pct(f['Part'])} des dépenses pour {_pct(f['PartActes'])} des actes."})
    if depenses["Zones"] and depenses["Zones"][0]["Depenses"]:
        z = depenses["Zones"][0]
        c.append({"Titre": "Zone la plus consommatrice", "Ton": "info", "Texte": f"{z['Libelle']} : {_f(z['Depenses'])}, {_pct(z['Part'])} des dépenses, "
                  f"taux de recours {_pct(z['TauxRecours'])}."})
    if comparatif.get("Disponible") and comparatif["Global"]["Total"]["DepensesRef"] and synthese["Actes"]:
        t = comparatif["Global"]["Total"]
        hausse = t["Ecart"] > 0
        c.append({"Titre": "Comparaison avec l'année précédente", "Ton": "attention" if hausse and (t["Evolution"] or 0) > 0.1 else "info",
                  "Texte": f"Dépenses {'en hausse' if hausse else 'en baisse'} de {_pct(abs(t['Evolution'] or 0))} ({'+' if hausse else '-'}{_f(abs(t['Ecart']))}), "
                           f"actes {'en hausse' if t['EcartActes'] > 0 else 'en baisse'} de {_pct(abs(t['EvolutionActes'] or 0))}."})
    seuil = depenses["FamillesSeuil"]
    if seuil["Familles"]:
        c.append({"Titre": "Familles à forte consommation", "Ton": "attention", "Texte": f"{len(seuil['Familles'])} familles dépassent {_f(seuil['Seuil'])} : "
                  f"{_f(seuil['Depenses'])}, soit {_pct(seuil['Part'])} des dépenses pour {_pct(seuil['PartActes'])} des actes."})
    if synthese.get("TauxEnveloppe") is not None:
        ton = "critique" if synthese["TauxEnveloppe"] > 1 else "attention" if (synthese.get("TauxProjete") or 0) > 1 else "info"
        c.append({"Titre": "Enveloppe des sinistres", "Ton": ton, "Texte": f"{_pct(synthese['TauxEnveloppe'])} de l'enveloppe annuelle des sinistres consommés"
                  + (f", {_pct(synthese['TauxProjete'])} projetés à l'échéance au rythme actuel." if synthese.get("TauxProjete") is not None else ".")})
    critiques = [k for k in liste_controles if k["Gravite"] == "critique" and k["Nombre"]]
    if critiques:
        c.append({"Titre": "Contrôles", "Ton": "critique", "Texte": "À traiter en priorité : " + " ; ".join(f"{k['Titre'].lower()} ({k['Nombre']})" for k in critiques) + "."})
    return c


# ------------------------------------------------------------------ analyse complète
def analyser(ctx, convention, effectif, prestations, du, au, *, selection=(), reference=None, prestations_ref=None, tous_beneficiaires=(),
             prestations_exercice=(), colleges_exercice=(), enveloppe=None, exercice=None, seuil_famille=SEUIL_FAMILLE):
    """effectif, reference : bénéficiaires (effectif retenu et effectif de l'année précédente) ; prestations : lignes des mois de clôture de la
    période ; prestations_ref : celles des mêmes mois un an plus tôt (None : pas de comparaison) ; prestations_exercice : lignes de l'exercice de
    la fin de période (plafonds). enveloppe : enveloppe annuelle des sinistres de l'exercice (cotisations moins honoraires)."""
    selection = set(selection or ())
    eff = _garder([ctx.enrichir(b) for b in effectif_de_periode(effectif, du)], selection)
    ref = _garder([ctx.enrichir(b) for b in effectif_de_periode(reference, moins_un_an(du))], selection) if reference is not None else None
    pre = _garder([ctx.enrichir(p) for p in prestations], selection)
    pre_ref = _garder([ctx.enrichir(p) for p in prestations_ref], selection) if prestations_ref is not None else None
    pre_ex = _garder([ctx.enrichir(p) for p in prestations_exercice], selection)
    tous = [ctx.enrichir(b) for b in tous_beneficiaires]
    mois = mois_entre(du, au)
    ref_par_mois = None
    if pre_ref is not None:
        ref_par_mois = defaultdict(lambda: {"Depenses": 0, "Actes": 0})
        for p in pre_ref:
            ref_par_mois[p["mois"]]["Depenses"] += p["rembourse"]
            ref_par_mois[p["mois"]]["Actes"] += 1

    effectifs = _effectifs(ctx, eff, ref)
    depenses = _depenses(ctx, eff, pre, mois, ref_par_mois, seuil_famille)
    comparatif = _comparatif(ctx, pre, pre_ref, mois)
    total = sum(p["rembourse"] for p in pre)
    consommants = {p["matricule"] for p in pre}
    matricules = {b["matricule"] for b in eff}
    familles = len({b.get("matricule_adherent") or b["matricule"] for b in eff})
    mois_avec = [m for m in mois if any(p["mois"] == m for p in pre)]
    rythme = div(total, len(mois_avec))
    synthese = {
        "Effectif": len(eff), "Familles": familles, "Consommants": len(consommants), "ConsommantsCouverts": len(consommants & matricules),
        "HorsEffectif": len(consommants - matricules), "TauxRecours": div(len(consommants), len(eff)), "Actes": len(pre), "Depenses": total,
        "Reclame": sum(p["reclame"] for p in pre), "PartPatient": sum(p["part_patient"] for p in pre), "Exclus": sum(p["exclus"] for p in pre),
        "Depassement": sum(p["depassement"] for p in pre), "CoutParActe": div(total, len(pre)), "CoutParBeneficiaire": div(total, len(eff)),
        "CoutParConsommant": div(total, len(consommants)), "CoutParFamille": div(total, familles), "ActesParConsommant": div(len(pre), len(consommants)),
        "TauxPriseEnCharge": div(total, sum(p["reclame"] for p in pre)), "MoisAvecDonnees": len(mois_avec), "Rythme": rythme,
        "Series": {"Depenses": [l["Depenses"] for l in depenses["Mensuel"]], "Actes": [l["Actes"] for l in depenses["Mensuel"]]},
    }
    if enveloppe and exercice:
        consomme = sum(p["rembourse"] for p in pre_ex)
        mois_ex = mois_entre(exercice["date_effet"], exercice["date_echeance"])
        mois_ex_donnees = [m for m in mois_ex if any(p["mois"] == m for p in pre_ex)]
        rythme_ex = div(consomme, len(mois_ex_donnees))
        synthese.update(Enveloppe=enveloppe, ConsommeExercice=consomme, TauxEnveloppe=div(consomme, enveloppe),
                        ProjectionExercice=rythme_ex * len(mois_ex) if rythme_ex else None,
                        TauxProjete=div(rythme_ex * len(mois_ex), enveloppe) if rythme_ex else None,
                        Attendu=div(len(mois_ex_donnees), len(mois_ex)))
    liste = controles(ctx, convention, eff, pre, tous, pre_ex, colleges_exercice, du, au)
    return {
        "Periode": {"Du": du.isoformat(), "Au": au.isoformat(), "Libelle": f"{libelle_mois(du)} à {libelle_mois(au).lower()}" if du.year != au.year or du.month != au.month else libelle_mois(du),
                    "Mois": [{"Mois": m.isoformat(), "Libelle": libelle_mois(m), "LibelleCourt": libelle_mois(m, court=True)} for m in mois],
                    "AgeAu": f"31/12/{ctx.annee}"},
        "Synthese": synthese, "Effectifs": effectifs, "Depenses": depenses, "Comparatif": comparatif, "Controles": liste,
        "Constats": constats(synthese, effectifs, depenses, comparatif, liste),
    }
