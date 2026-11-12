"""
RAFAS : valeurs par défaut d'une nouvelle convention et barèmes de prise en charge types, transcrits de l'annexe I de la convention RAFAS EXAT
AGRICULTURE 2024-2025 (reprise telle quelle par l'avenant n°1 2025-2026) : collège 1 (AM/O) et collège 2 (CADRE), taux de 80 %. Chaque collège
d'une convention garde sa copie du barème, modifiable à l'écran.

Une ligne de barème : Rubrique, Prestation, Taux (%), Plafond (F CFA), Observation, Garanti, Accord (entente préalable), Controle :
- OPTIQUE : plafond par bénéficiaire sur deux années civiles ;
- DENTAIRE : soins dentaires, plafond par bénéficiaire et par exercice (l'annexe ne précise pas l'unité : « Plafond 100 000 FCFA ») ;
- PROTHESE_DENTAIRE : prothèses dentaires, plafond par bénéficiaire et par exercice.
"""

DEFAUTS_CONVENTION = {
    "gestionnaire": "VITALIS SANTE", "nature_risque": "SANTE : REGIME AUTOFINANCE", "taux_soins": 80, "taux_hospitalisation": 80,
    "territoire": "Côte d'Ivoire", "composition_famille": "Mr + Mme + 4 enfants", "enfants_max": 4, "age_adulte": 60, "age_enfant": 21,
    "age_etudiant": 25, "preavis_mois": 2, "delai_remboursement_mois": 3, "delai_contestation_jours": 30,
}
DEFAUTS_EXERCICE = {"taux_honoraires": 8.5, "taux_commission": 6.5, "mois_provision": 3, "seuil_alerte_mois": 1}
# Quota d'alerte automatique du barème : à partir du 15e bon de prise en charge, à partir de 200 000 F de frais pharmaceutiques
ALERTE_BONS = 15
ALERTE_PHARMACIE = 200000
PLAFONDS_FAMILLE = {"AM/O": 2500000, "CADRES": 5000000}

TM = "Ticket modérateur 20 %"


def _ligne(rubrique, prestation, taux: "int | None" = 80, plafond=None, observation="", garanti=True, accord=False, controle=""):
    return {"Rubrique": rubrique, "Prestation": prestation, "Taux": taux, "Plafond": plafond, "Observation": observation,
            "Garanti": garanti, "Accord": accord, "Controle": controle}


def bareme_type(categorie):
    """Barème de l'annexe I pour un collège AM/O (collège 1) ou CADRES (collège 2)."""
    cadres = categorie == "CADRES"
    a, h, m, e = "Soins ambulatoires", "Frais d'hospitalisation", "Maternité et accouchement", "Extension de couverture"
    return [
        _ligne(a, "Consultations et visites : généraliste, spécialiste, professeur, urgence ou garde", observation=TM),
        _ligne(a, "Frais pharmaceutiques et produits", observation=TM),
        _ligne(a, "Kinésithérapie et rééducation", observation="Sur accord préalable, 20 séances au plus", accord=True),
        _ligne(a, "Prothèses orthopédiques, auditives et autres prothèses ; radiologie et imagerie (échographie, électrocardiogramme)",
               taux=None, observation="Non garanti", garanti=False),
        _ligne(a, "Imagerie médicale coûteuse : scanner et autres", observation="Sur accord préalable", accord=True),
        _ligne(a, "Analyses biologiques et travaux de laboratoire", observation=TM),
        _ligne(a, "Soins dentaires, radio panoramique et rétro-dentaire", plafond=200000 if cadres else 100000, observation="Plafond",
               controle="DENTAIRE"),
        _ligne(a, "Prothèses dentaires", plafond=60000 if cadres else 50000, observation="Sur accord préalable", accord=True,
               controle="PROTHESE_DENTAIRE"),
        _ligne(h, "Hospitalisation médicale", observation="Frais réels"),
        _ligne(h, "Hospitalisation chirurgicale", observation="Frais réels"),
        _ligne(h, "Hébergement, y compris séjour de la mère en établissement privé", plafond=25000, observation="Par séjour"),
        _ligne(m, "Frais pré et post-natals", observation=TM),
        _ligne(m, "Échographies et analyses biologiques", observation=TM),
        _ligne(m, "Accouchement simple", plafond=200000 if cadres else 75000, observation="Plafond"),
        _ligne(m, "Accouchement multiple", plafond=250000 if cadres else 100000, observation="Plafond"),
        _ligne(m, "Accouchement chirurgical", plafond=400000 if cadres else 250000, observation="Plafond"),
        _ligne(m, "Forfait accouchement hors structure privée", taux=None, plafond=75000 if cadres else 70000, observation="Forfait"),
        _ligne(e, "Optique : verres et monture (dioptries de -0,25 à +0,25 exclues)", plafond=100000 if cadres else 60000,
               observation="Tous les 2 ans calendaires", controle="OPTIQUE"),
        _ligne(e, "Traitements préventifs : bilan de santé", taux=None, observation="Non garanti", garanti=False),
        _ligne(e, "Ambulance ou SAMU", taux=None, plafond=20000, observation="Par évènement"),
        _ligne(e, "Antirétroviraux pris en charge au public", taux=None, observation="Frais réels"),
    ]


def college_type(categorie, libelle=""):
    return {"libelle": libelle, "categorie": categorie, "cotisation": 0, "familles": 0, "plafond_famille": PLAFONDS_FAMILLE[categorie],
            "bareme": bareme_type(categorie)}


def modeles():
    """Valeurs proposées à l'écran pour une nouvelle convention."""
    return {"Convention": DEFAUTS_CONVENTION, "Exercice": DEFAUTS_EXERCICE, "Colleges": {c: college_type(c) for c in ("AM/O", "CADRES")},
            "AlerteBons": ALERTE_BONS, "AlertePharmacie": ALERTE_PHARMACIE}
