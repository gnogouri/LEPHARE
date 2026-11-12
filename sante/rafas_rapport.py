"""
RAFAS : rapport Word d'analyse des dépenses santé d'un régime autofinancé, au plan de l'étude d'OREOLE « RAPPORT COMPLET EXAT FEVRIER-JUIN
2026 » : I. effectifs (population, comparatif avec l'année précédente, tranches d'âge, zones de concentration), II. dépenses (recours, statuts,
tranches, mois, zones, localités et centres, affections, familles de prestation, actes, familles les plus dépensières), III. comparatif des
dépenses avec les mêmes mois de l'année précédente, IV. incohérences et actions à mener, V. situation du fonds du régime.

Mise en forme commune au rapport des consommations (sante/consommations_rapport.py : gabarit OREOLE, Arial Narrow 12, tableaux centrés, tout
en portrait, statuts en mots). Mêmes chiffres que l'écran (sante/rafas_analyse.py). Données de santé : droit rafas.view, export journalisé.
"""

import datetime as dt

from django.http import HttpResponse
from rest_framework import permissions
from rest_framework.decorators import api_view, authentication_classes, permission_classes

from autorisations.journal import journaliser
from production.renouvellement import AUTHENTIFICATION

from .consommations_rapport import TOTAL, Rapport, _f, _p
from .rafas import _reponse, charger_analyse, fonds
from .rafas_lecture import ErreurRafas, libelle_mois

LIGNES_CONTROLE = 40
GENRES = {"F": "Femmes", "M": "Hommes", "Total": "Total"}


def _d(iso):
    return dt.date.fromisoformat(iso[:10]).strftime("%d/%m/%Y") if iso else ""


def _ratio(v):
    return "-" if v is None else f"{v:.2f}".replace(".", ",")


def _mois_long(iso):
    return libelle_mois(dt.date.fromisoformat(iso[:10])) if iso else ""


def _valeur(v):
    if isinstance(v, bool):
        return "Oui" if v else "Non"
    if isinstance(v, (int, float)):
        return _f(v) if abs(v) >= 1000 or isinstance(v, int) else _ratio(v)
    if isinstance(v, str) and len(v) == 10 and v[4] == "-" and v[7] == "-":
        return _d(v)
    return "" if v is None else str(v)


# ------------------------------------------------------------------ I. effectifs
def _effectifs(r, a):
    e = a["Effectifs"]
    situation = _d(a["Situation"]["Date"]) if a.get("Situation") else "-"
    reference = _d(a["Reference"]["Date"]) if a.get("Reference") else None
    r.titre("I. ANALYSE DES EFFECTIFS", 1)
    r.titre(f"I.1. Description de la population au {situation}", 2)
    if e["Mouvements"]:
        r.tableau(f"Effectif global consolidé par collège au {situation}",
                  ["Collège", "Présents les deux années", f"Total au {reference}", "Nouveaux", "Sortis", f"Total au {situation}", "Taux de maintien",
                   "Taux de sortie", "Taux d'adhésion"],
                  [(l["Libelle"], _f(l["Presents"]), _f(l["TotalRef"]), _f(l["Nouveaux"]), _f(l["Sortis"]), _f(l["Total"]), _p(l["TauxMaintien"]),
                    _p(l["TauxSortie"]), _p(l["TauxAdhesion"])) for l in e["Mouvements"][:-1]],
                  total=[TOTAL] + [(_f if i < 5 else _p)(v) for i, v in enumerate(list(e["Mouvements"][-1].values())[1:])])
        t = e["Mouvements"][-1]
        r.para(f"Au {situation}, l'effectif compte {_f(t['Total'])} bénéficiaires contre {_f(t['TotalRef'])} au {reference} : "
               f"{_f(t['Nouveaux'])} nouveaux bénéficiaires et {_f(t['Sortis'])} sortis de l'effectif.")
    else:
        r.para("Effectif de l'année précédente non importé : les mouvements (nouveaux, sortis, maintenus) ne peuvent pas être calculés.", italique=True)
        r.tableau(f"Effectif par collège au {situation}", ["Collège", "Femmes", "Hommes", "Total", "%"],
                  [(l["Libelle"], _f(l["F"]), _f(l["M"]), _f(l["Total"]), _p(l["Part"])) for l in e["ParCollege"][:-1]],
                  total=(TOTAL, _f(e["ParCollege"][-1]["F"]), _f(e["ParCollege"][-1]["M"]), _f(e["ParCollege"][-1]["Total"]), _p(1)))
    if e["TotalRef"] is not None:
        r.titre("I.2. Comparatif de l'effectif avec l'année précédente", 2)
        lignes = e["ParCollege"]
        r.tableau("Comparatif de l'effectif global", ["Collège", f"Femmes {reference}", f"Hommes {reference}", f"Total {reference}", "%",
                                                       f"Femmes {situation}", f"Hommes {situation}", f"Total {situation}", "%", "Écart", "Évolution"],
                  [(l["Libelle"], _f(l["FRef"]), _f(l["MRef"]), _f(l["TotalRef"]), _p(l["PartRef"]), _f(l["F"]), _f(l["M"]), _f(l["Total"]), _p(l["Part"]),
                    _f(l["Ecart"]), _p(l["Evolution"])) for l in lignes[:-1]],
                  total=[TOTAL] + [(_p if k in ("PartRef", "Part", "Evolution") else _f)(lignes[-1][k]) for k in
                                   ("FRef", "MRef", "TotalRef", "PartRef", "F", "M", "Total", "Part", "Ecart", "Evolution")])
        r.tableau("Comparatif par statut", ["Statut", "Genre", reference, "%", situation, "%", "Écart", "Évolution"],
                  [(l["Statut"], GENRES.get(l["Genre"], l["Genre"]), _f(l["Ref"]), _p(l["PartRef"]), _f(l["Nombre"]), _p(l["Part"]), _f(l["Ecart"]), _p(l["Evolution"]))
                   for l in e["ParStatut"]], marques=[i for i, l in enumerate(e["ParStatut"]) if l["Genre"] == "Total"])
    r.titre("I.3. Répartition par tranche d'âge et par sexe", 2)
    categories = e["Categories"]
    entetes = ["Tranche d'âge"] + [f"{c} {g}" for c in categories for g in ("Femmes", "Hommes", "Total")] + ["Effectif", "%"]
    r.tableau(f"Effectif par tranche d'âge, collège et sexe (âge au {a['Periode']['AgeAu']})", entetes,
              [[l["Tranche"]] + [_f(l[c][k]) for c in categories for k in ("F", "M", "Total")] + [_f(l["Total"]), _p(l["Part"])] for l in e["ParTranche"]],
              total=[TOTAL] + [_f(sum(l[c][k] for l in e["ParTranche"])) for c in categories for k in ("F", "M", "Total")] + [_f(e["Total"]), _p(1)])
    if e["TotalRef"] is not None:
        r.tableau("Comparatif par tranche d'âge et par sexe", ["Tranche d'âge", "Genre", reference, situation, "Écart", "Évolution"],
                  [(l["Tranche"], GENRES.get(l["Genre"], l["Genre"]), _f(l["Ref"]), _f(l["Nombre"]), _f(l["Ecart"]), _p(l["Evolution"])) for l in e["TranchesComparees"]],
                  marques=[i for i, l in enumerate(e["TranchesComparees"]) if l["Genre"] == "Total"])
    r.titre("I.4. Répartition par zone de concentration des travailleurs", 2)
    r.tableau("Zone de concentration par sexe et collège", ["Zone"] + [f"{c} {g}" for c in categories for g in ("Femmes", "Hommes", "Total", "%")] + ["Total", "%"],
              [[z["Zone"]] + [x for c in categories for x in (_f(z[c]["F"]), _f(z[c]["M"]), _f(z[c]["Total"]), _p(z[c]["Part"]))] + [_f(z["Total"]), _p(z["Part"])]
               for z in e["ParZone"]],
              total=[TOTAL] + [x for c in categories for x in (_f(sum(z[c]["F"] for z in e["ParZone"])), _f(sum(z[c]["M"] for z in e["ParZone"])),
                                                              _f(sum(z[c]["Total"] for z in e["ParZone"])), _p(1))] + [_f(e["Total"]), _p(1)])
    statuts = ("Assuré", "Conjoint(e)", "Enfant")
    r.tableau("Zone de concentration par statut et collège", ["Zone"] + [f"{s} {c}" for s in statuts for c in categories + ["Total"]] + ["Total"],
              [[z["Zone"]] + [_f(z[s][c]) for s in statuts for c in categories + ["Total"]] + [_f(z["Total"])] for z in e["ZoneStatut"]],
              total=[TOTAL] + [_f(sum(z[s][c] for z in e["ZoneStatut"])) for s in statuts for c in categories + ["Total"]] + [_f(e["Total"])])
    r.tableau("Zone de concentration par sexe et statut", ["Zone"] + [f"{s} {g}" for s in statuts for g in ("F", "M", "Total")] + ["Total"],
              [[z["Zone"]] + [_f(z[s][g]) for s in statuts for g in ("F", "M", "Total")] + [_f(z["Total"])] for z in e["ZoneStatut"]],
              total=[TOTAL] + [_f(sum(z[s][g] for z in e["ZoneStatut"])) for s in statuts for g in ("F", "M", "Total")] + [_f(e["Total"])])
    if e["ParZone"]:
        principales = e["ParZone"][:2]
        r.para(" ; ".join(f"{z['Zone']} : {_f(z['Total'])} bénéficiaires, {_p(z['Part'])} de l'effectif" for z in principales) + ".")


# ------------------------------------------------------------------ II. dépenses
def _recours(r, legende, lignes, total):
    r.tableau(legende, ["Statut", "Ayant exposé des frais", "Nombre d'actes", "N'ayant pas exposé", "Effectif", "Taux de recours", "Actes par bénéficiaire"],
              [(l["Libelle"], _f(l["Consommants"]), _f(l["Actes"]), _f(l["NonConsommants"]), _f(l["Effectif"]), _p(l["TauxRecours"]), _ratio(l["Ratio"]))
               for l in lignes],
              total=(total["Libelle"], _f(total["Consommants"]), _f(total["Actes"]), _f(total["NonConsommants"]), _f(total["Effectif"]), _p(total["TauxRecours"]),
                     _ratio(total["Ratio"])))


def _centres(r, legende, colonne, lignes, total_depenses, total_actes):
    r.tableau(legende, [colonne, "Localité", "Dépenses", "%", "Actes", "% des actes", "Coût moyen par acte"],
              [(l["Libelle"], l.get("Localite") or "", _f(l["Depenses"]), _p(l["Part"]), _f(l["Actes"]), _p(l["PartActes"]), _f(l["CoutParActe"])) for l in lignes],
              total=("Total", "", _f(sum(l["Depenses"] for l in lignes)), _p(sum(l["Depenses"] for l in lignes) / total_depenses if total_depenses else None),
                     _f(sum(l["Actes"] for l in lignes)), _p(sum(l["Actes"] for l in lignes) / total_actes if total_actes else None),
                     _f(sum(l["Depenses"] for l in lignes) / max(1, sum(l["Actes"] for l in lignes)))))


def _depenses(r, a):
    s, d = a["Synthese"], a["Depenses"]
    total, actes = s["Depenses"], s["Actes"]
    periode = a["Periode"]
    r.titre("II. ANALYSE DES DÉPENSES", 1)
    r.titre("II.1. Bénéficiaires ayant effectivement exposé des frais", 2)
    for bloc in d["Recours"]:
        _recours(r, f"Recours aux soins : {bloc['College']}", bloc["Lignes"], bloc["Total"])
    rt = d["RecoursTotal"]
    r.para(f"Sur {_f(rt['Effectif'])} bénéficiaires, {_f(rt['Consommants'])} ont exposé des frais, soit un taux de recours global de {_p(rt['TauxRecours'])}. "
           f"Chaque bénéficiaire ayant consommé a généré en moyenne {_ratio(s['ActesParConsommant'])} actes sur la période.")
    r.titre("II.2. Répartition des dépenses par statut", 2)
    r.tableau("Dépenses par statut", ["Statut", "Effectif", "%", "Ayant exposé", "%", "Dépenses", "% des dépenses", "Actes", "Coût moyen par acte"],
              [(l["Libelle"], _f(l["Effectif"]), _p(l["PartEffectif"]), _f(l["Consommants"]), _p(l["PartConsommants"]), _f(l["Depenses"]), _p(l["Part"]),
                _f(l["Actes"]), _f(l["CoutParActe"])) for l in d["ParStatut"]],
              total=(TOTAL, _f(s["Effectif"]), _p(1), _f(s["Consommants"]), _p(1), _f(total), _p(1), _f(actes), _f(s["CoutParActe"])))
    for bloc in d["StatutParCollege"]:
        t = bloc["Total"]
        r.tableau(f"Dépenses par statut : {bloc['College']}", ["Statut", "Ayant exposé", "Dépenses", "%", "Actes", "Coût moyen par acte"],
                  [(l["Libelle"], _f(l["Consommants"]), _f(l["Depenses"]), _p(l["Part"]), _f(l["Actes"]), _f(l["CoutParActe"])) for l in bloc["Lignes"]],
                  total=(t["Libelle"], _f(t["Consommants"]), _f(t["Depenses"]), _p(1), _f(t["Actes"]), _f(t["CoutParActe"])))
    r.titre("II.3. Analyse des dépenses par tranche d'âge", 2)
    tr = [l for l in d["Tranches"] if l["Effectif"] or l["Actes"]]
    r.tableau("Recours aux soins par tranche d'âge", ["Tranche d'âge", "Ayant exposé", "N'ayant pas exposé", "Effectif", "Actes", "Taux de recours", "Actes par bénéficiaire"],
              [(l["Libelle"], _f(l["Consommants"]), _f(l["NonConsommants"]), _f(l["Effectif"]), _f(l["Actes"]), _p(l["TauxRecours"]), _ratio(l["Ratio"])) for l in tr],
              total=(TOTAL, _f(rt["Consommants"]), _f(rt["NonConsommants"]), _f(rt["Effectif"]), _f(actes), _p(rt["TauxRecours"]), _ratio(rt["Ratio"])))
    r.tableau("Dépenses par tranche d'âge", ["Tranche d'âge", "Dépenses", "%", "Actes", "Coût moyen par acte"],
              [(l["Libelle"], _f(l["Depenses"]), _p(l["Part"]), _f(l["Actes"]), _f(l["CoutParActe"])) for l in tr],
              total=(TOTAL, _f(total), _p(1), _f(actes), _f(s["CoutParActe"])))
    r.titre("II.4. Évolution mensuelle des dépenses", 2)
    codes = [c for c in a["Colleges"] if any(m["ParCollege"].get(c["Code"]) for m in d["Mensuel"])]
    r.tableau("Dépenses mensuelles par collège", ["Mois"] + [c["Libelle"] for c in codes] + ["Dépenses", "%", "Actes"],
              [[m["Libelle"]] + [_f(m["ParCollege"].get(c["Code"], 0)) for c in codes] + [_f(m["Depenses"]), _p(m["Part"]), _f(m["Actes"])] for m in d["Mensuel"]],
              total=[TOTAL] + [_f(sum(m["ParCollege"].get(c["Code"], 0) for m in d["Mensuel"])) for c in codes] + [_f(total), _p(1), _f(actes)])
    r.para(f"Les dépenses de la période s'élèvent à {_f(total)} F pour {_f(actes)} actes.")
    r.titre("II.5. Répartition des dépenses par zone de concentration", 2)
    z = d["Zones"]
    r.tableau("Recours aux soins par zone", ["Zone", "Ayant exposé", "N'ayant pas exposé", "Effectif", "Actes", "Taux de recours", "Actes par bénéficiaire"],
              [(l["Libelle"], _f(l["Consommants"]), _f(l["NonConsommants"]), _f(l["Effectif"]), _f(l["Actes"]), _p(l["TauxRecours"]), _ratio(l["Ratio"])) for l in z])
    r.tableau("Dépenses par zone", ["Zone", "Ayant exposé", "Dépenses", "%", "Actes", "Coût moyen par acte"],
              [(l["Libelle"], _f(l["Consommants"]), _f(l["Depenses"]), _p(l["Part"]), _f(l["Actes"]), _f(l["CoutParActe"])) for l in z],
              total=(TOTAL, _f(s["Consommants"]), _f(total), _p(1), _f(actes), _f(s["CoutParActe"])))
    r.tableau("Évolution mensuelle des dépenses par zone", ["Zone"] + [m["Libelle"] for m in periode["Mois"]] + ["Total"],
              [[l["Libelle"]] + [_f(v) for v in l["Mensuel"]] + [_f(l["Depenses"])] for l in z],
              total=[TOTAL] + [_f(m["Depenses"]) for m in d["Mensuel"]] + [_f(total)])
    if z:
        r.para(f"{z[0]['Libelle']} domine avec {_f(z[0]['Depenses'])} F ({_p(z[0]['Part'])}) pour {_f(z[0]['Actes'])} actes et un taux de recours de "
               f"{_p(z[0]['TauxRecours'])}.")
    r.titre("II.6. Localités et 20 premiers centres prescripteurs", 2)
    r.repartition("Dépenses par localité du centre prescripteur", "Localité", d["LocalitesPrescripteurs"], total=True)
    _centres(r, "20 premiers centres prescripteurs", "Centre prescripteur", d["Prescripteurs"], total, actes)
    r.titre("II.7. Localités et 20 premiers centres exécutants", 2)
    r.repartition("Dépenses par localité du centre exécutant", "Localité", d["LocalitesExecutants"], total=True)
    _centres(r, "20 premiers centres exécutants", "Centre exécutant", d["Executants"], total, actes)
    r.titre("II.8. Répartition des dépenses par affection et statut", 2)
    statuts = ("Assuré", "Conjoint(e)", "Enfant")
    r.tableau_croise("Dépenses par affection et statut", "Affection", "Statut", list(statuts) + [TOTAL], ["Dépenses", "NB actes"],
                     [[l["Affection"]] + [x for k in list(statuts) + ["Total"] for x in (_f(l[k]["Depenses"]), _f(l[k]["Actes"]))] for l in d["AffectionStatut"]],
                     [TOTAL] + [x for k in statuts for x in (_f(sum(l[k]["Depenses"] for l in d["AffectionStatut"])), _f(sum(l[k]["Actes"] for l in d["AffectionStatut"])))]
                     + [_f(total), _f(actes)], groupes_hors_titre=(TOTAL,))
    r.titre("II.9. Répartition des dépenses par affection et tranche d'âge", 2)
    tranches = d["TranchesAffection"]
    r.tableau_croise("Dépenses par affection et tranche d'âge", "Affection", "Tranche d'âge", tranches + [TOTAL], ["Dépenses", "NB actes"],
                     [[l["Affection"]] + [x for t in tranches for x in (_f(l["Tranches"][t]["Depenses"]) if l["Tranches"][t]["Actes"] else "",
                                                                         _f(l["Tranches"][t]["Actes"]) if l["Tranches"][t]["Actes"] else "")]
                      + [_f(l["Total"]["Depenses"]), _f(l["Total"]["Actes"])] for l in d["AffectionTranche"]],
                     [TOTAL] + [x for t in tranches for x in (_f(sum(l["Tranches"][t]["Depenses"] for l in d["AffectionTranche"])),
                                                              _f(sum(l["Tranches"][t]["Actes"] for l in d["AffectionTranche"])))] + [_f(total), _f(actes)],
                     groupes_hors_titre=(TOTAL,))
    r.titre("II.10. Dépenses mensuelles par famille de prestation", 2)
    r.tableau("Dépenses mensuelles par famille de prestation", ["Famille de prestation"] + [m["Libelle"] for m in periode["Mois"]] + ["Total"],
              [[l["Famille"]] + [_f(v) for v in l["Valeurs"]] + [_f(l["Total"])] for l in d["FamillesMois"]],
              total=[TOTAL] + [_f(m["Depenses"]) for m in d["Mensuel"]] + [_f(total)])
    r.titre("II.11. Répartition par famille de prestation", 2)
    r.repartition("Dépenses par famille de prestation", "Famille de prestation", d["Familles"], total=True)
    if d["Familles"]:
        f = d["Familles"][0]
        r.para(f"{f['Libelle'].capitalize()} : premier poste de dépenses, {_p(f['Part'])} des dépenses pour {_p(f['PartActes'])} des actes.")
    r.titre("II.12. Les 20 actes médicaux les plus remboursés", 2)
    r.repartition("20 actes les plus remboursés", "Acte médical", d["Actes"], total=True)
    r.titre("II.13. Les 5 familles les plus dépensières", 2)
    lignes, marques = [], []
    for f in d["TopFamilles"]:
        for l in f["Lignes"]:
            lignes.append((f["Assure"], l["Patient"], l["Famille"], _f(l["Depenses"]), _f(l["Actes"])))
        marques.append(len(lignes))
        lignes.append((f"Total {f['Assure']}", "", "", _f(f["Depenses"]), _f(f["Actes"])))
    tot5 = sum(f["Depenses"] for f in d["TopFamilles"])
    r.tableau("5 familles les plus dépensières", ["Assuré", "Patient", "Famille de prestation", "Dépenses", "Actes"], lignes, marques=marques,
              total=("Total des dépenses", "", "", _f(tot5), _f(sum(f["Actes"] for f in d["TopFamilles"]))))
    if d["TopFamilles"]:
        r.para(f"Les 5 familles les plus consommatrices totalisent {_f(tot5)} F, soit {_p(tot5 / total if total else None)} des dépenses. Elles nécessitent un suivi.")
    fs = d["FamillesSeuil"]
    r.titre(f"II.14. Familles dont les dépenses dépassent {_f(fs['Seuil'])} F ({len(fs['Familles'])} familles)", 2)
    lignes, marques = [], []
    for f in fs["Familles"]:
        for l in f["Lignes"]:
            lignes.append((f["Assure"], l["Patient"], _f(l["Depenses"]), _p(l["Part"]), _f(l["Actes"]), _p(l["PartActes"]), _f(l["CoutParActe"])))
        marques.append(len(lignes))
        lignes.append((f"Sous-total {f['Assure']}", "", _f(f["Depenses"]), _p(f["Part"]), _f(f["Actes"]), _p(f["PartActes"]), _f(f["CoutParActe"])))
    if lignes:
        r.tableau(f"Familles au-delà de {_f(fs['Seuil'])} F", ["Assuré", "Patient", "Dépenses", "%", "Actes", "% des actes", "Coût moyen par acte"], lignes, marques=marques,
                  total=(TOTAL, "", _f(fs["Depenses"]), _p(fs["Part"]), _f(fs["Actes"]), _p(fs["PartActes"]), _f(fs["CoutParActe"])))
        r.para(f"Les {len(fs['Familles'])} familles à forte consommation totalisent {_f(fs['Depenses'])} F, soit {_p(fs['Part'])} des dépenses pour "
               f"{_p(fs['PartActes'])} des actes ; coût moyen par acte {_f(fs['CoutParActe'])} F.")
    else:
        r.para("Aucune famille au-delà du seuil sur la période.", italique=True)


def _comparatif(r, a):
    c = a["Comparatif"]
    if not c.get("Disponible"):
        return
    ref = a["ReferenceDepenses"]
    p1 = f"{_mois_long(ref['Du'])} - {_mois_long(ref['Au'])}"
    p2 = f"{_mois_long(a['Periode']['Du'])} - {_mois_long(a['Periode']['Au'])}"
    r.titre(f"III. COMPARATIF DES DÉPENSES {p1.upper()} ET {p2.upper()}", 1)

    def tableau(legende, serie):
        t = serie["Total"]
        r.tableau(legende, ["Mois", f"Dépenses {p1}", "Actes", f"Dépenses {p2}", "Actes", "Écart dépenses", "Écart actes", "Évolution dépenses", "Évolution actes"],
                  [(l["Libelle"].split(" ")[0], _f(l["DepensesRef"]), _f(l["ActesRef"]), _f(l["Depenses"]), _f(l["Actes"]), _f(l["Ecart"]), _f(l["EcartActes"]),
                    _p(l["Evolution"]), _p(l["EvolutionActes"])) for l in serie["Mois"]],
                  total=(TOTAL, _f(t["DepensesRef"]), _f(t["ActesRef"]), _f(t["Depenses"]), _f(t["Actes"]), _f(t["Ecart"]), _f(t["EcartActes"]),
                         _p(t["Evolution"]), _p(t["EvolutionActes"])))
        return t

    r.titre("III.1. Comparatif général des dépenses", 2)
    t = tableau("Comparatif général des dépenses", c["Global"])
    if t["DepensesRef"]:
        r.para(f"Les dépenses {'progressent' if t['Ecart'] >= 0 else 'reculent'} de {_p(abs(t['Evolution'] or 0))} ({_f(t['Ecart'])} F) et les actes "
               f"{'augmentent' if t['EcartActes'] >= 0 else 'diminuent'} de {_p(abs(t['EvolutionActes'] or 0))}.")
    r.titre("III.2. Comparatif par collège", 2)
    for bloc in c["ParCollege"]:
        tableau(f"Comparatif des dépenses : {bloc['College']}", bloc)


def _controles(r, a):
    r.titre("IV. ANALYSE DES INCOHÉRENCES ET ACTIONS À MENER", 1)
    r.para("Contrôles de l'effectif et des dépenses de la période ; plafonds du barème contrôlés sur l'exercice. Chaque constat est à instruire avec le "
           "gestionnaire : aucun n'est une décision.", italique=True)
    numero = 0
    for k in a["Controles"]:
        if not k["Nombre"]:
            continue
        numero += 1
        r.titre(f"IV.{numero}. {k['Titre']} ({_f(k['Nombre'])})", 2)
        r.para(k["Description"] + (f" Montant concerné : {_f(k['Montant'])} F." if k.get("Montant") else ""))
        r.tableau(k["Titre"], k["Colonnes"], [[_valeur(v) for v in ligne] for ligne in k["Lignes"][:LIGNES_CONTROLE]])
        if k["Nombre"] > LIGNES_CONTROLE:
            r.para(f"{_f(k['Nombre'] - LIGNES_CONTROLE)} autres cas sont listés à l'écran, onglet Contrôles.", italique=True)
        r.para(f"Action à mener : {k['Action']}")
    if not numero:
        r.para("Aucune incohérence relevée sur la période.", italique=True)


def _fonds(r, f, numero):
    b = f["Budget"]
    r.titre(f"{numero}. SITUATION DU FONDS DU RÉGIME", 1)
    e = f["Exercice"]
    r.para(f"Exercice du {_d(e['date_effet'])} au {_d(e['date_echeance'])}. Honoraires du gestionnaire : {_ratio(float(e['taux_honoraires']))} % des cotisations ; "
           f"commission du courtier : {_ratio(float(e['taux_commission']))} %.")
    r.tableau("Cotisations par collège", ["Collège", "Cotisation par famille", "Familles de la convention", "Cotisations", "Familles de l'effectif", "Cotisations sur l'effectif"],
              [(c["Libelle"], _f(c["Cotisation"]), _f(c["Familles"]), _f(c["Budget"]), _f(c["FamillesReelles"]), _f(c["BudgetReel"])) for c in f["Colleges"]],
              total=(TOTAL, "", _f(sum(c["Familles"] for c in f["Colleges"])), _f(b["Cotisations"]),
                     _f(sum(c["FamillesReelles"] or 0 for c in f["Colleges"])) if f["BudgetReel"] else "-", _f((f["BudgetReel"] or {}).get("Cotisations"))))
    reel = f["BudgetReel"] or {}
    r.tableau("Budget de l'exercice", ["Poste", "Sur les familles de la convention", "Sur l'effectif"], [
        ("Cotisations", _f(b["Cotisations"]), _f(reel.get("Cotisations"))), ("Honoraires du gestionnaire", _f(b["Honoraires"]), _f(reel.get("Honoraires"))),
        ("Commission du courtier", _f(b["Commission"]), _f(reel.get("Commission"))), ("Enveloppe des sinistres", _f(b["Enveloppe"]), _f(reel.get("Enveloppe"))),
        ("Dépenses remboursées à ce jour", _f(f["Depenses"]), _f(f["Depenses"])), ("Part de l'enveloppe consommée", _p(f["TauxEnveloppe"]), _p(f["TauxEnveloppeReel"])),
    ])
    r.tableau("Dépenses mensuelles du régime", ["Mois", "Dépenses", "Actes", "Cumul"],
              [(m["Libelle"], _f(m["Depenses"]), _f(m["Actes"]), _f(m["Cumul"])) for m in f["Mensuel"] if m["Depenses"] is not None])
    r.tableau("Mouvements du fonds", ["Poste", "Montant"], [
        ("Versements du souscripteur", _f(f["Versements"])), ("Dépenses remboursées", _f(f["Depenses"])),
        ("Honoraires du gestionnaire réglés", _f(f["HonorairesRegles"]["GESTIONNAIRE"])), ("Commission du courtier réglée", _f(f["HonorairesRegles"]["COURTIER"])),
        ("Solde du fonds", _f(f["Solde"])), ("Rythme mensuel moyen des dépenses", _f(f["Rythme"])), ("Projection des dépenses à l'échéance", _f(f["Projection"])),
    ])
    if f["Appels"]:
        r.tableau("Appels de fonds", ["Numéro", "Date", "Objet", "Montant", "Versé", "Reste"],
                  [(x["numero"], _d(x["date_appel"]), x["objet"], _f(x["montant"]), _f(x["verse"]), _f(x["reste"])) for x in f["Appels"]],
                  total=(TOTAL, "", "", _f(sum(x["montant"] for x in f["Appels"])), _f(sum(x["verse"] for x in f["Appels"])), _f(sum(x["reste"] for x in f["Appels"]))))
    if f["Alerte"]:
        r.para(f"Le solde du fonds est sous le seuil d'alerte ; appel de fonds conseillé : {_f(f['AppelConseille'])} F.")


def produire(idconvention, params):
    a = charger_analyse(idconvention, params)
    if not a["Synthese"]["Actes"] and not a["Synthese"]["Effectif"]:
        raise ErreurRafas("Aucune donnée sur cette période : importez d'abord l'effectif et les relevés du gestionnaire.")
    c = a["Convention"]
    r = Rapport()
    r.titre(f"SOCIÉTÉ {c['souscripteur'].upper()}", 0)
    r.titre(f"RAPPORT D'ANALYSE DES DÉPENSES SANTÉ {a['Periode']['Au'][:4]}", 0)
    r.para(f"Régime autofinancé d'assurance santé (RAFAS) - période : {a['Periode']['Libelle']}", centre=True)
    r.para(f"Gestionnaire : {c['gestionnaire']}" + (f" - polices {c['polices']}" if c.get("polices") else ""), centre=True)
    colleges = [x["Libelle"] for x in a["Colleges"] if not a["Selection"] or x["Code"] in a["Selection"]]
    nb_mois = len(a["Periode"]["Mois"])
    r.para(f"L'analyse porte sur la période de {a['Periode']['Libelle'].lower()}, soit {nb_mois} mois de clôture des relevés du gestionnaire, pour "
           f"{', '.join(colleges) if colleges else 'tous les collèges'}. Elle examine la population sous plusieurs angles, analyse les dépenses et détecte les "
           "incohérences (âge, statut, doublons, prescriptions) afin de garantir la fiabilité des données du régime.")
    r.para("Source : effectifs et relevés de prestations du gestionnaire importés dans LE PHARE ; dépenses = montants remboursés ; âges au 31 décembre de "
           "l'année de fin de période. Document contenant des données de santé : diffusion restreinte.", italique=True)
    _effectifs(r, a)
    _depenses(r, a)
    _comparatif(r, a)
    _controles(r, a)
    numero = "V"  # IV : incohérences ; III (comparatif) absent sans relevé de l'année précédente, la numérotation du modèle est gardée
    if a.get("Exercice"):
        try:
            _fonds(r, fonds(idconvention, {"exercice": a["Exercice"]["idexercice"]}), numero)
        except ErreurRafas:
            pass
    nom = f"RAPPORT RAFAS {c['souscripteur'].upper()} {a['Periode']['Du'][:7]} a {a['Periode']['Au'][:7]}.docx".replace("/", "-")
    return r.octets(), nom, a


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_rapport(request, idconvention):
    """GET /api/rafas/conventions/<id>/rapport/?du=&au=&colleges=&seuil= : rapport Word de la période."""
    try:
        contenu, nom, a = produire(idconvention, request.query_params)
    except ErreurRafas:
        return _reponse(produire, idconvention, request.query_params)
    journaliser(request=request, module="rafas", action="rafas.rapport", objet_type="rapport_rafas", objet_id=str(idconvention),
                description=f"Export du rapport RAFAS {a['Convention']['souscripteur']} de {a['Periode']['Libelle'].lower()} ({a['Synthese']['Actes']} actes).")
    reponse = HttpResponse(contenu, content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    reponse["Content-Disposition"] = f'attachment; filename="{nom}"'
    return reponse
