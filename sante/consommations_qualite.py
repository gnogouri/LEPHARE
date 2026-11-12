"""
Contrôle automatique de la qualité de l'effectif (attentes de l'équipe actuariat, « LE PHARE - LES ATTENTES », 2026-11-11, point 2.3) :
doublons et matricules bénéficiaires non uniques ; incohérences entre bénéficiaires et assurés principaux ; bénéficiaires rattachés à un
assuré principal inexistant ; âges incohérents ou non conformes ; incohérences entre l'âge et le statut ; autres anomalies.

Fonction pure (aucune lecture en base) : effectif actif chargé par consommations_pilotage.charger, date de calcul des âges (fin de période),
matricules en double relevés à l'import (le fichier en garde la première ligne, consommations._lire). Chaque contrôle donne sa gravité
(« À corriger » : donnée fausse ; « À vérifier » : situation possible mais inhabituelle) et ses cas, pour l'annexe du rapport et l'écran.
Limites d'âge retenues (à confirmer selon les conditions des contrats) : assuré principal et conjoint(e) majeurs (18 ans) ; enfant couvert
jusqu'à 21 ans, 25 ans s'il est scolarisé ; plus de 100 ans improbable ; au moins 12 ans d'écart entre un enfant et son assuré principal.
"""
from collections import defaultdict

from .consommations_pilotage import _age

A_CORRIGER, A_VERIFIER = "À corriger", "À vérifier"
STATUTS = {"A": "Assuré", "C": "Conjoint(e)", "E": "Enfant"}
AGE_MAJORITE, AGE_ENFANT, AGE_ENFANT_SCOLARISE, AGE_MAX, ECART_PARENT_MIN = 18, 21, 25, 100, 12

# (code, libellé, gravité) dans l'ordre des attentes
CONTROLES = [
    ("Q01", "Matricule bénéficiaire en double dans le fichier du gestionnaire", A_CORRIGER),
    ("Q02", "Même personne (nom, prénoms, date de naissance) sous plusieurs matricules", A_CORRIGER),
    ("Q03", "Assuré principal dont le matricule bénéficiaire diffère du matricule assuré", A_CORRIGER),
    ("Q04", "Bénéficiaire rattaché à un assuré principal inexistant dans l'effectif", A_CORRIGER),
    ("Q05", "Bénéficiaire et assuré principal dans des entreprises différentes", A_VERIFIER),
    ("Q06", "Date de naissance absente ou illisible", A_CORRIGER),
    ("Q07", "Âge non conforme : né après la date de calcul ou plus de 100 ans", A_CORRIGER),
    ("Q08", "Assuré principal mineur (moins de 18 ans)", A_VERIFIER),
    ("Q09", "Conjoint(e) mineur(e) (moins de 18 ans)", A_VERIFIER),
    ("Q10", "Enfant de plus de 25 ans", A_CORRIGER),
    ("Q11", "Enfant de 22 à 25 ans : scolarité à justifier", A_VERIFIER),
    ("Q12", "Enfant à moins de 12 ans d'écart d'âge de son assuré principal, ou plus âgé que lui", A_VERIFIER),
    ("Q13", "Plusieurs conjoint(e)s pour un même assuré principal", A_VERIFIER),
    ("Q14", "Statut absent ou inconnu (ni assuré, ni conjoint(e), ni enfant)", A_CORRIGER),
    ("Q15", "Nom ou prénoms absents", A_CORRIGER),
    ("Q16", "Date d'effet antérieure à la naissance ou postérieure à la date de calcul", A_VERIFIER),
    ("Q17", "Genre non renseigné", A_VERIFIER),
]
LIBELLES = {code: (libelle, gravite) for code, libelle, gravite in CONTROLES}


def _personne(e, age=None, detail=""):
    return {"Matricule": e.get("matricule_beneficiaire") or "", "MatriculeAssure": e.get("matricule_assure") or "",
            "Nom": " ".join(filter(None, [(e.get("nom") or "").strip(), (e.get("prenoms") or "").strip()])),
            "Entreprise": e.get("police") or "", "Statut": STATUTS.get((e.get("statut") or "").strip().upper(), e.get("statut") or "-"),
            "Age": age, "Detail": detail}


def controler(effectif, au, doublons_fichier=()):
    """[{Code, Libelle, Gravite, Nombre, Cas: [...]}] pour l'effectif actif ; doublons_fichier : [{Matricule, Lignes, Entreprise}] relevés à
    l'import. Genre non renseigné compté chez les garants dont le fichier donne le genre (un fichier sans colonne genre est signalé à part)."""
    actifs = [e for e in effectif if e.get("actif", True)]
    cas = defaultdict(list)
    for d in doublons_fichier:
        cas["Q01"].append({"Matricule": d.get("Matricule", ""), "MatriculeAssure": "", "Nom": "", "Entreprise": d.get("Entreprise", ""), "Statut": "-",
                           "Age": None, "Detail": f"{d.get('Lignes', 2)} lignes dans le fichier, la première est gardée"})
    par_matricule = {e["matricule_beneficiaire"]: e for e in actifs}
    ages = {e["matricule_beneficiaire"]: _age(e.get("date_naissance"), au) for e in actifs}
    principaux = {e["matricule_beneficiaire"]: e for e in actifs if (e.get("statut") or "").upper() == "A"}

    identites = defaultdict(list)
    for e in actifs:
        nom, prenoms = (e.get("nom") or "").strip().upper(), (e.get("prenoms") or "").strip().upper()
        if nom and e.get("date_naissance"):
            identites[(nom, prenoms, e["date_naissance"])].append(e)
    for personnes in identites.values():
        if len(personnes) > 1:
            autres = ", ".join(p["matricule_beneficiaire"] for p in personnes)
            cas["Q02"].extend(_personne(p, ages.get(p["matricule_beneficiaire"]), f"matricules {autres}") for p in personnes)

    conjoints = defaultdict(list)
    # genre contrôlé chez les seuls garants dont le fichier le donne (EFFECTIF OREOLE n'a pas de colonne GENRE, EFFECTIF OREOLE CGA en a une)
    garants_genre = {e.get("garant") or "" for e in actifs if (e.get("genre") or "").strip()}
    for e in actifs:
        m, statut, age = e["matricule_beneficiaire"], (e.get("statut") or "").strip().upper(), ages.get(e["matricule_beneficiaire"])
        assure = e.get("matricule_assure") or ""
        if statut not in STATUTS:
            cas["Q14"].append(_personne(e, age, f"statut « {e.get('statut') or ''} »"))
        if statut == "A" and assure and assure != m:
            cas["Q03"].append(_personne(e, age, f"matricule assuré {assure}"))
        if statut in ("C", "E"):
            principal = principaux.get(assure)
            if principal is None:
                rattache = par_matricule.get(assure)
                cas["Q04"].append(_personne(e, age, f"assuré {assure or 'non indiqué'}" + (f" présent comme {STATUTS.get(rattache.get('statut'), '?').lower()}"
                                                                                       if rattache else " absent de l'effectif")))
            else:
                if (principal.get("police") or "") != (e.get("police") or ""):
                    cas["Q05"].append(_personne(e, age, f"assuré principal dans {principal.get('police') or '-'}"))
                age_principal = ages.get(assure)
                if statut == "E" and age is not None and age_principal is not None and age_principal - age < ECART_PARENT_MIN:
                    cas["Q12"].append(_personne(e, age, f"assuré principal de {age_principal} ans"))
            if statut == "C" and assure:
                conjoints[assure].append(e)
        if not e.get("date_naissance"):
            cas["Q06"].append(_personne(e, None, "date de naissance absente"))
        elif age is not None and (age < 0 or age > AGE_MAX):
            cas["Q07"].append(_personne(e, age, "né après la date de calcul" if age < 0 else f"{age} ans"))
        elif age is not None:
            if statut == "A" and age < AGE_MAJORITE:
                cas["Q08"].append(_personne(e, age))
            elif statut == "C" and age < AGE_MAJORITE:
                cas["Q09"].append(_personne(e, age))
            elif statut == "E" and age > AGE_ENFANT_SCOLARISE:
                cas["Q10"].append(_personne(e, age))
            elif statut == "E" and age > AGE_ENFANT:
                cas["Q11"].append(_personne(e, age))
        if not (e.get("nom") or "").strip() or not (e.get("prenoms") or "").strip():
            cas["Q15"].append(_personne(e, age, "nom absent" if not (e.get("nom") or "").strip() else "prénoms absents"))
        effet, naissance = e.get("date_effet"), e.get("date_naissance")
        if effet and ((naissance and effet < naissance) or effet > au):
            cas["Q16"].append(_personne(e, age, f"date d'effet {effet:%d/%m/%Y}"))
        if (e.get("garant") or "") in garants_genre and not (e.get("genre") or "").strip():
            cas["Q17"].append(_personne(e, age))
    for assure, liste in conjoints.items():
        if len(liste) > 1:
            cas["Q13"].extend(_personne(c, ages.get(c["matricule_beneficiaire"]), f"{len(liste)} conjoint(e)s pour l'assuré {assure}") for c in liste)
    return [{"Code": code, "Libelle": libelle, "Gravite": gravite, "Nombre": len(cas[code]),
             "Cas": sorted(cas[code], key=lambda c: (c["Entreprise"], c["MatriculeAssure"], c["Matricule"]))} for code, libelle, gravite in CONTROLES]


def garants_sans_genre(effectif):
    """Garants dont aucune personne de l'effectif ne porte de genre (fichier du gestionnaire sans colonne GENRE)."""
    par_garant = defaultdict(bool)
    for e in effectif:
        par_garant[e.get("garant") or ""] |= bool((e.get("genre") or "").strip())
    return sorted(g for g, connu in par_garant.items() if g and not connu)


def doublons_fichier(lignes_brutes):
    """Matricules bénéficiaires présents sur plusieurs lignes d'un fichier d'effectif : [{Matricule, Lignes, Entreprise}]."""
    comptes = defaultdict(list)
    for l in lignes_brutes:
        if l.get("matricule_beneficiaire"):
            comptes[l["matricule_beneficiaire"]].append(l)
    return [{"Matricule": m, "Lignes": len(ls), "Entreprise": ls[0].get("police") or ""} for m, ls in sorted(comptes.items()) if len(ls) > 1]
