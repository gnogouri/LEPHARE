"""
Branche Oreole Santé (demande du 2026-11-04, dossier « OREOLE SANTE ») : package de micro-assurance à prix unique par famille.

Une cotisation réunit trois polices liées, saisies une seule fois :
- Santé, gérée par MCI CARE CI (produit 5, tarif OREOLE SANTE, catégorie 125) ;
- Individuelle Accidents NSIA (produit 2, offres CGA 154 et 156, capital 2 ou 4 millions) ;
- Assistance funéraire ALLIANZ CI VIE (produit 10, format AFA de production/afa.py).

Règles données par OREOLE :
- Cotisation sans taxe (« il s'agit de cotisations et non de prime ») sur la part Santé. L'IA reste taxée par son offre.
- Décomposition de la part Santé : prime HT (reversée à MCI) + chargement pour sinistres à payer (frais courtiers dans le code, gardés).
  Les accessoires de 10 000 F sont passés au chargement le 2026-11-05 (migration 0211) : le champ reste, à 0.
  Honoraires 7 % OREOLE (à réclamer) et 11 % MCI, calculés sur la prime HT.
- Enregistrement : prime HT en prime nette, accessoires en accessoirecompagnie, frais courtiers en accessoireintermediaire,
  7 % en commissionintermediaire, 11 % en commissiongestionnaire, taxe 0.
- Surprime d'affection sur la cotisation totale, surprime d'âge sur la part Santé. L'IA et l'AFA ne changent jamais.
- Tout supplément (surprime, majoration, enfant en plus, carte) revient aux frais courtiers : la prime HT reste celle de l'offre.
- Prix forfaitaire : ni prorata ni ristourne. Carte d'assurance facturée par personne si le bouton est coché.
- Retirer un produit lié retire sa part du package. Adhérent obligatoire, conjoint et enfants facultatifs.

Devis Santé écrit directement (comme production/afa.py) : sp_creation_devis_sante tarife les offres Santé classiques et MINENE,
et ses règles (taxe, accessoires, prime saisie) ne s'appliquent pas ici. L'écran Santé refuse donc ces devis (voir est_oreole).

GET  /api/oreole/referentiels/                 offres, réglages, compagnies
POST /api/oreole/apercu/                       calcul sans écriture
POST /api/oreole/devis/                        enregistre les devis du package (IdDevis : modification)
GET  /api/oreole/devis/<iddevis>/              package relu
POST /api/oreole/devis/<iddevis>/emission/     confirme les devis liés en une seule transaction
GET  /api/oreole/polices/                      polices et produits liés (accueil)
GET  /api/oreole/contrat/<idcontrat>/          bloc de la fiche contrat
POST /api/oreole/contrat/<idcontrat>/emission/ émet un produit lié manquant, sans ressaisie
GET  /api/oreole/contrat/<idcontrat>/preparation/?acte=REN|INC  données pour renouveler ou incorporer
POST /api/oreole/import/analyse/               classeur des effectifs lu et contrôlé, rien n'est enregistré
GET  /api/oreole/modele/                       modèle Excel
"""
import io
import logging
import re
from collections import Counter
from datetime import date, datetime, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal, InvalidOperation

from django.db import DatabaseError, connection, transaction
from django.http import HttpResponse
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils.exceptions import InvalidFileException
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from configuration_api.parametrage import valeur_parametre
from core.date_parser import date_emission_du_jour
from production import afa as module_afa
from production.apporteurs import rattacher_apporteur_package
from production.database import save_contract
from production.renouvellement import AUTHENTIFICATION, ErreurRenouvellement, _contrat_base, _lignes
from production.reste_encaissement import reste_a_encaisser

from . import cartes as module_cartes

logger = logging.getLogger(__name__)

ID_PRODUIT_SANTE, ID_PRODUIT_IA, ID_PRODUIT_VIE = 5, 2, 10
ID_INTERMEDIAIRE = 1
ID_AVENANT_AFN, ID_AVENANT_REN, ID_AVENANT_INC, ID_AVENANT_MOD = 1, 2, 3, 11
ID_TARIF_IA_CGA = 145
ID_COLLEGE_DEFAUT = 7  # Employé : le collège n'a pas d'effet sur le prix
ID_ZONE_COTE_IVOIRE = 1
CODE_CATEGORIE_SANTE, CODE_CATEGORIE_IA = "125", "119"
GARANTIE_SANTE, GARANTIE_SURPRIME_AFFECTION, GARANTIE_SURPRIME_AGE = 98, 99, 167
TYPE_PARTICULIER, TYPE_SOCIETE = 1, 2
ACTES = ("AFN", "REN", "INC")
ENFANTS_COMPRIS = 4
TAILLE_FICHIER_MAX = 8 * 1024 * 1024
ZERO = Decimal(0)
# Option de l'effectif (numérotation MCI, contraire aux tarifs) : offre proposée quand la prime ne désigne aucune offre
CODE_PAR_OPTION = {1: "E840", 2: "E594", 3: "E436", 4: "E575"}


class ErreurOreole(Exception):
    """Refus affiché tel quel à l'opérateur."""


# ------------------------------------------------------------------ outils
def _decimal(valeur, defaut=ZERO):
    if valeur in (None, "", False):
        return defaut
    try:
        nombre = Decimal(str(valeur).replace(" ", "").replace(" ", "").replace(" ", "").replace(",", "."))
    except (InvalidOperation, ValueError) as erreur:
        raise ErreurOreole(f"Montant illisible : {valeur}.") from erreur
    if not nombre.is_finite():
        raise ErreurOreole(f"Montant illisible : {valeur}.")
    return nombre


def _optionnel(valeur):
    return None if valeur in (None, "") else _decimal(valeur)


def _entier(valeur, defaut=0):
    try:
        return int(valeur or defaut)
    except (TypeError, ValueError):
        return defaut


def _franc(valeur):
    return Decimal(valeur).quantize(Decimal(1), rounding=ROUND_HALF_UP)


def _texte(valeur):
    return re.sub(r"\s+", " ", str(valeur if valeur is not None else "")).strip()


def _date(valeur):
    if not valeur:
        return None
    if isinstance(valeur, datetime):
        return valeur.date()
    if isinstance(valeur, date):
        return valeur
    texte = str(valeur).strip()[:10]
    for format_ in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(texte, format_).date()
        except ValueError:
            continue
    raise ErreurOreole(f"Date illisible : {valeur}.")


def _iso(valeur):
    if not valeur:
        return None
    return (valeur.date() if isinstance(valeur, datetime) else valeur).isoformat()


def _age(naissance, jour):
    if not naissance or not jour:
        return None
    return jour.year - naissance.year - ((jour.month, jour.day) < (naissance.month, naissance.day))


def _nombre(valeur):
    return float(valeur or 0)


# ------------------------------------------------------------------ réglages et offres
def reglages():
    def nombre(cle, defaut):
        return _decimal(valeur_parametre(cle, defaut), Decimal(defaut))

    return {
        "HonoraireCabinet": nombre("oreole.honoraire_cabinet", 7),
        "HonoraireGestionnaire": nombre("oreole.honoraire_gestionnaire", 11),
        "Gestionnaire": str(valeur_parametre("oreole.gestionnaire", "MCI CARE CI")),
        "CompagnieSante": int(nombre("oreole.compagnie_sante", 29)),
        "CompagnieIA": int(nombre("oreole.compagnie_ia", 1)),
        "CompagnieAFA": int(nombre("oreole.compagnie_afa", 31)),
        "Carte": nombre("oreole.carte_montant", 3000),
        "SurprimeAffection": nombre("oreole.surprime_affection", 30),
        "AffectionsMax": int(nombre("oreole.affections_max", 3)),
        "Age1Debut": int(nombre("oreole.surprime_age_1_debut", 60)),
        "Age1Taux": nombre("oreole.surprime_age_1_taux", 30),
        "Age2Debut": int(nombre("oreole.surprime_age_2_debut", 65)),
        "Age2Taux": nombre("oreole.surprime_age_2_taux", 50),
        "AgeMax": int(nombre("oreole.age_max_adulte", 69)),
        "Carences": {
            "Maladie": int(nombre("oreole.carence_maladie", 3)), "Maternite": int(nombre("oreole.carence_maternite", 9)),
            "Protheses": int(nombre("oreole.carence_protheses", 10)), "Optique": int(nombre("oreole.carence_optique", 10)),
            "Chronique": int(nombre("oreole.carence_chronique", 12)),
        },
        "AlerteBons": int(nombre("oreole.alerte_bons", 15)),
        "AlertePharmacie": nombre("oreole.alerte_pharmacie", 200000),
    }


COLONNES_OFFRE = """idoffre, code, cible, nature, libelle, cotisation, primeht, accessoires, partia, partafa, idoffreia, capitalia,
    capitalafa, enfantsupplementaire, tauxsoinsexternes, tauxhospitalisation, chambreparjour, ambulanceparcas, accouchementsimple,
    accouchementgemellaire, accouchementchirurgical, accouchementhorsstructure, optiqueadulte, optiqueenfant, dentaireparpersonne,
    plafondannuel, reseau, actif, ordre"""


def offres_oreole(cursor, actives=False):
    return {
        o["idoffre"]: o for o in _lignes(
            cursor, f"SELECT {COLONNES_OFFRE} FROM lephare_oreole_offre {'WHERE actif' if actives else ''} ORDER BY ordre, idoffre")
    }


def offre_json(o):
    return {
        "IdOffre": o["idoffre"], "Code": o["code"], "Cible": o["cible"], "Nature": o["nature"], "Libelle": o["libelle"],
        "Cotisation": _nombre(o["cotisation"]), "PrimeHt": _nombre(o["primeht"]), "Accessoires": _nombre(o["accessoires"]),
        "PartIA": _nombre(o["partia"]), "PartAFA": _nombre(o["partafa"]),
        "PartSante": _nombre(o["cotisation"] - o["partia"] - o["partafa"]),
        "FraisCourtiers": _nombre(o["cotisation"] - o["partia"] - o["partafa"] - o["primeht"] - o["accessoires"]),
        "IdOffreIA": o["idoffreia"], "CapitalIA": _nombre(o["capitalia"]), "CapitalAFA": _nombre(o["capitalafa"]),
        "EnfantSupplementaire": _nombre(o["enfantsupplementaire"]), "SoinsExternes": _nombre(o["tauxsoinsexternes"]),
        "Hospitalisation": _nombre(o["tauxhospitalisation"]), "Chambre": _nombre(o["chambreparjour"]),
        "Ambulance": _nombre(o["ambulanceparcas"]), "AccouchementSimple": _nombre(o["accouchementsimple"]),
        "AccouchementGemellaire": _nombre(o["accouchementgemellaire"]), "AccouchementChirurgical": _nombre(o["accouchementchirurgical"]),
        "AccouchementHorsStructure": _nombre(o["accouchementhorsstructure"]), "OptiqueAdulte": _nombre(o["optiqueadulte"]),
        "OptiqueEnfant": _nombre(o["optiqueenfant"]), "Dentaire": _nombre(o["dentaireparpersonne"]),
        "Plafond": _nombre(o["plafondannuel"]), "Reseau": o["reseau"], "Actif": o["actif"],
    }


def est_oreole(cursor, id_devis):
    """Devis Santé tarifé par cette branche, quel que soit son acte."""
    cursor.execute("SELECT 1 FROM lephare_oreole_package WHERE iddevis_sante = %s", [id_devis])
    return bool(cursor.fetchone())


# ------------------------------------------------------------------ calcul de la cotisation
def taux_age(age, regles):
    if age is None or age < regles["Age1Debut"]:
        return ZERO
    return regles["Age2Taux"] if age >= regles["Age2Debut"] else regles["Age1Taux"]


def tarifer_adherent(offre, ligne, regles, prix_famille=None, carte=False):
    """
    Cotisation annuelle d'une famille, sans écriture.

    offre : cotisation, primeht, accessoires, partia, partafa, enfantsupplementaire (Decimal).
    ligne : Age, Affections, TauxAffection, TauxAge, SurprimeImposee, CotisationImposee, EnfantsEnPlus, Personnes, PartIA, PartAFA.
    Un produit lié retiré (part à 0) retire sa part du package. Tout supplément va aux frais courtiers.
    """
    part_ia = offre["partia"] if ligne.get("PartIA") is None else ligne["PartIA"]
    part_afa = offre["partafa"] if ligne.get("PartAFA") is None else ligne["PartAFA"]
    base = (prix_famille or offre["cotisation"]) - (offre["partia"] - part_ia) - (offre["partafa"] - part_afa)
    base_sante = base - part_ia - part_afa

    taux_aff = ligne.get("TauxAffection")
    if taux_aff is None:
        taux_aff = Decimal(ligne.get("Affections") or 0) * regles["SurprimeAffection"]
    taux_ag = ligne.get("TauxAge")
    if taux_ag is None:
        taux_ag = taux_age(ligne.get("Age"), regles)

    surprime_affection = base * taux_aff / 100
    surprime_age = base_sante * taux_ag / 100
    imposee = ligne.get("SurprimeImposee") or ZERO
    if imposee > 0:
        surprime_affection, surprime_age = imposee, ZERO
    enfants = Decimal(ligne.get("EnfantsEnPlus") or 0) * offre["enfantsupplementaire"]
    # Cartes à facturer : le registre écarte les personnes déjà facturées (sante/cartes.py) ; sans contrôle préalable, toute la famille
    nombre_cartes = ligne.get("CartesAFacturer")
    if nombre_cartes is None:
        nombre_cartes = ligne.get("Personnes") or 1
    cartes = (Decimal(nombre_cartes) * regles["Carte"]) if carte else ZERO

    cotisation_imposee = ligne.get("CotisationImposee") or ZERO
    if cotisation_imposee > 0:
        surprime_affection, surprime_age, enfants = ZERO, ZERO, ZERO
        cotisation = cotisation_imposee + cartes
    else:
        cotisation = base + surprime_affection + surprime_age + enfants + cartes

    cotisation = _franc(cotisation)
    part_sante = cotisation - part_ia - part_afa
    frais = part_sante - offre["primeht"] - offre["accessoires"]
    return {
        "Cotisation": cotisation, "PartSante": part_sante, "PartIA": part_ia, "PartAFA": part_afa,
        "PrimeHt": offre["primeht"], "Accessoires": offre["accessoires"], "FraisCourtiers": frais,
        "SurprimeAffection": _franc(surprime_affection), "SurprimeAge": _franc(surprime_age), "MontantEnfants": _franc(enfants),
        "MontantCartes": _franc(cartes), "TauxAffection": taux_aff, "TauxAge": taux_ag,
        "PrixOffre": offre["cotisation"], "Ecart": cotisation - offre["cotisation"],
    }


def _correspondances_liees(offres):
    """Montant de la part IA ou AFA -> offre IA et capital, lus sur les offres : le classeur des effectifs donne le montant."""
    ia, afa = {ZERO: (None, ZERO)}, {ZERO: ZERO}
    for o in offres.values():
        if o["partia"] > 0:
            ia[Decimal(o["partia"]).normalize()] = (o["idoffreia"], o["capitalia"])
        if o["partafa"] > 0:
            afa[Decimal(o["partafa"]).normalize()] = o["capitalafa"]
    return ia, afa


def _ligne_saisie(rang, brut, offres, regles, effet, correspondances, offre_defaut=None):
    """Ligne contrôlée et complétée : (ligne, erreurs, avertissements)."""
    erreurs, avertissements = [], []
    nom, prenoms = _texte(brut.get("Nom"))[:100], _texte(brut.get("Prenoms"))[:100]
    libelle = f"{nom} {prenoms}".strip() or f"Adhérent {rang}"
    if not nom:
        erreurs.append("nom absent")
    try:
        naissance = _date(brut.get("DateNaissance"))
    except ErreurOreole:
        naissance = None
        erreurs.append("date de naissance illisible")
    else:
        if not naissance:
            erreurs.append("date de naissance absente")
    age = _age(naissance, effet)
    if naissance and (naissance > effet or age > 100):
        erreurs.append("date de naissance invraisemblable")
    elif age is not None and age < 18:
        avertissements.append(f"{age} ans : vérifiez la date de naissance")
    elif age is not None and age > regles["AgeMax"]:
        avertissements.append(f"{age} ans à la date d'effet, au-delà de {regles['AgeMax']} ans")

    id_offre = _entier(brut.get("IdOffre")) or (offre_defaut or 0)
    offre = offres.get(id_offre)
    if not offre:
        erreurs.append("offre à choisir")

    ayants = []
    for ayant in brut.get("Ayants") or []:
        lien = _texte(ayant.get("Lien")).upper()[:1]
        nom_ayant = _texte(ayant.get("Nom"))[:100]
        if not nom_ayant and not _texte(ayant.get("Prenoms")):
            continue
        if lien not in ("C", "E"):
            erreurs.append(f"{nom_ayant} : lien à préciser")
            continue
        try:
            naissance_ayant = _date(ayant.get("DateNaissance"))
        except ErreurOreole:
            naissance_ayant = None
            erreurs.append(f"{nom_ayant} : date de naissance illisible")
        ayants.append({"Lien": lien, "Nom": nom_ayant, "Prenoms": _texte(ayant.get("Prenoms"))[:100], "DateNaissance": naissance_ayant,
                       "Sexe": _texte(ayant.get("Sexe"))[:1].upper()})
    if sum(1 for a in ayants if a["Lien"] == "C") > 1:
        erreurs.append("un seul conjoint par famille")
    enfants_declares = sum(1 for a in ayants if a["Lien"] == "E")

    try:
        affections = _entier(brut.get("Affections"))
        taux_affection, taux_age_saisi = _optionnel(brut.get("TauxAffection")), _optionnel(brut.get("TauxAge"))
        surprime = _decimal(brut.get("SurprimeImposee"))
        cotisation_imposee = _decimal(brut.get("CotisationImposee"))
        part_ia_saisie, part_afa_saisie = _optionnel(brut.get("PartIA")), _optionnel(brut.get("PartAFA"))
    except ErreurOreole as erreur:
        erreurs.append(str(erreur))
        affections, taux_affection, taux_age_saisi, surprime, cotisation_imposee = 0, None, None, ZERO, ZERO
        part_ia_saisie, part_afa_saisie = None, None
    if affections < 0 or affections > regles["AffectionsMax"]:
        erreurs.append(f"affections : de 0 à {regles['AffectionsMax']}")
    if surprime < 0 or cotisation_imposee < 0:
        erreurs.append("montant négatif")

    enfants_en_plus = max(_entier(brut.get("EnfantsEnPlus")), enfants_declares - ENFANTS_COMPRIS, 0)
    personnes = max(_entier(brut.get("Personnes")), 1 + len(ayants), 1)
    ligne = {
        "Rang": rang, "Libelle": libelle, "IdClient": _entier(brut.get("IdClient")), "IdAdherentBase": _entier(brut.get("IdAdherentBase")),
        "Matricule": _texte(brut.get("Matricule"))[:50], "Nom": nom, "Prenoms": prenoms, "DateNaissance": naissance,
        "Sexe": _texte(brut.get("Sexe"))[:1].upper(), "Age": age, "IdOffre": id_offre, "Affections": affections,
        "TauxAffection": taux_affection, "TauxAge": taux_age_saisi, "SurprimeImposee": surprime, "CotisationImposee": cotisation_imposee,
        "EnfantsEnPlus": enfants_en_plus, "Personnes": personnes, "Ayants": ayants, "Beneficiaires": _texte(brut.get("Beneficiaires"))[:500],
        "AvecIA": brut.get("AvecIA", True) not in (False, "false", "0", 0), "AvecAFA": brut.get("AvecAFA", True) not in (False, "false", "0", 0),
        "IdOffreIA": None, "CapitalIA": ZERO, "CapitalAFA": ZERO, "PartIA": None, "PartAFA": None,
    }
    if offre:
        ia, afa = correspondances
        part_ia = offre["partia"] if part_ia_saisie is None else part_ia_saisie
        part_afa = offre["partafa"] if part_afa_saisie is None else part_afa_saisie
        retrait = ZERO
        if not ligne["AvecIA"]:
            retrait += part_ia
            part_ia = ZERO
        if not ligne["AvecAFA"]:
            retrait += part_afa
            part_afa = ZERO
        # Cotisation imposée (fichier ou saisie) = cumul des trois produits : la part d'un produit non émis en sort aussi
        if retrait > 0 and cotisation_imposee > 0:
            if cotisation_imposee <= retrait:
                erreurs.append(f"cotisation de {_franc(cotisation_imposee)} F inférieure aux parts IA et AFA retirées")
            else:
                ligne["CotisationImposee"] = cotisation_imposee - retrait
        if part_ia == offre["partia"]:
            ligne["IdOffreIA"], ligne["CapitalIA"] = (offre["idoffreia"], offre["capitalia"]) if part_ia > 0 else (None, ZERO)
        else:
            trouve = ia.get(Decimal(part_ia).normalize() if part_ia else ZERO)
            if trouve is None:
                erreurs.append(f"part IA de {_franc(part_ia)} F : aucune offre à ce montant")
            else:
                ligne["IdOffreIA"], ligne["CapitalIA"] = trouve
        if part_afa == offre["partafa"]:
            ligne["CapitalAFA"] = offre["capitalafa"] if part_afa > 0 else ZERO
        else:
            capital = afa.get(Decimal(part_afa).normalize() if part_afa else ZERO)
            if capital is None:
                erreurs.append(f"part AFA de {_franc(part_afa)} F : aucune offre à ce montant")
            else:
                ligne["CapitalAFA"] = capital
        ligne["PartIA"], ligne["PartAFA"] = part_ia, part_afa
    return ligne, [f"{libelle} : {e}" for e in erreurs], [f"{libelle} : {a}" for a in avertissements]


def _lire_saisie(cursor, donnees):
    """Entête et lignes contrôlées du package : ErreurOreole si une ligne est refusée."""
    cible = _texte(donnees.get("Cible")).upper()[:1] or "E"
    if cible not in ("P", "E"):
        raise ErreurOreole("Choisissez une famille ou un groupe.")
    effet, echeance = _date(donnees.get("DateEffet")), _date(donnees.get("DateExpiration"))
    if not effet:
        raise ErreurOreole("Saisissez la date d'effet.")
    if not echeance:
        echeance = effet.replace(year=effet.year + 1) - timedelta(days=1)
    if echeance < effet:
        raise ErreurOreole("La date d'échéance précède la date d'effet.")
    regles = reglages()
    offres = offres_oreole(cursor)
    correspondances = _correspondances_liees(offres)
    prix_famille = _optionnel(donnees.get("PrixFamille"))
    if prix_famille is not None and prix_famille <= 0:
        raise ErreurOreole("Le prix négocié doit être positif.")
    offre_defaut = _entier(donnees.get("IdOffre"))
    carte = donnees.get("Carte") in (True, "true", "1", 1)

    lignes, valides, erreurs, avertissements = [], [], [], []
    for rang, brut in enumerate(donnees.get("Adherents") or [], 1):
        if isinstance(brut, dict):
            brut = {**brut}
            if donnees.get("AvecIA") in (False, "false", "0", 0):
                brut["AvecIA"] = False
            if donnees.get("AvecAFA") in (False, "false", "0", 0):
                brut["AvecAFA"] = False
        ligne, refus, alertes = _ligne_saisie(rang, brut, offres, regles, effet, correspondances, offre_defaut)
        erreurs += refus
        avertissements += alertes
        if not refus and ligne["IdOffre"] in offres:
            valides.append(ligne)
        lignes.append(ligne)
    # Carte déjà facturée à une personne : pas de nouvelle facturation, sauf renouvellement pour perte choisi pour cette personne
    if carte:
        module_cartes.preparer_lignes(cursor, valides, _entier(donnees.get("IdDevis")), donnees.get("CartesPerte") or ())
    for ligne in valides:
        tarif = tarifer_adherent(offres[ligne["IdOffre"]], ligne, regles, prix_famille=prix_famille, carte=carte)
        if tarif["FraisCourtiers"] < 0:
            erreurs.append(f"{ligne['Libelle']} : cotisation de {tarif['Cotisation']} F inférieure à la part de MCI")
        ligne["Tarif"] = tarif
    if not lignes:
        erreurs.append("Ajoutez au moins un adhérent.")
    cles = Counter((l["Nom"].upper(), l["Prenoms"].upper(), l["DateNaissance"]) for l in lignes if l["Nom"])
    for (nom, prenoms, naissance), nombre in cles.items():
        if nombre > 1:
            erreurs.append(f"{nom} {prenoms} : saisi {nombre} fois.".replace("  ", " "))
    if erreurs:
        raise ErreurOreole(" ; ".join(erreurs[:12]) + (f" ; et {len(erreurs) - 12} autres." if len(erreurs) > 12 else ""))
    return {
        "Cible": cible, "IdClient": _entier(donnees.get("IdClient")), "DateEffet": effet, "DateExpiration": echeance, "PrixFamille": prix_famille,
        "Carte": carte, "IdDevis": _entier(donnees.get("IdDevis")), "NumeroPoliceCompagnie": _texte(donnees.get("NumeroPoliceCompagnie"))[:50] or None,
        "IdApporteur": _entier(donnees.get("IdApporteur")) or None, "ApporteurMode": _texte(donnees.get("ApporteurMode")).upper()[:10],
        "ApporteurValeur": _decimal(donnees.get("ApporteurValeur")), "Acte": _texte(donnees.get("Acte")).upper() or "AFN",
        "IdContratBase": _entier(donnees.get("IdContratBase")), "Regles": regles, "Offres": offres,
    }, lignes, avertissements


def _totaux(lignes, regles):
    tarifs = [l["Tarif"] for l in lignes if "Tarif" in l]
    somme = lambda cle: sum((t[cle] for t in tarifs), ZERO)  # noqa: E731
    prime_ht = somme("PrimeHt")
    return {
        "Familles": len(lignes), "Cotisation": somme("Cotisation"), "PartSante": somme("PartSante"), "PartIA": somme("PartIA"),
        "PartAFA": somme("PartAFA"), "PrimeHt": prime_ht, "Accessoires": somme("Accessoires"), "FraisCourtiers": somme("FraisCourtiers"),
        "SurprimeAffection": somme("SurprimeAffection"), "SurprimeAge": somme("SurprimeAge"), "MontantEnfants": somme("MontantEnfants"),
        "MontantCartes": somme("MontantCartes"), "Ecart": somme("Ecart"),
        "HonoraireCabinet": _franc(prime_ht * regles["HonoraireCabinet"] / 100),
        "HonoraireGestionnaire": _franc(prime_ht * regles["HonoraireGestionnaire"] / 100),
        "PartMCI": prime_ht + somme("Accessoires"),
    }


def _nombres(dico):
    return {c: (_nombre(v) if isinstance(v, Decimal) else v) for c, v in dico.items()}


def apercu(donnees):
    with connection.cursor() as cursor:
        entete, lignes, avertissements = _lire_saisie(cursor, donnees)
    totaux = _totaux(lignes, entete["Regles"])
    return {
        "Lignes": [{"Rang": l["Rang"], "Libelle": l["Libelle"], "Age": l["Age"], "Tarif": _nombres(l["Tarif"])} for l in lignes],
        "Totaux": _nombres(totaux), "Avertissements": avertissements,
        "Apporteur": _nombre(_remuneration_apporteur(entete, totaux)),
    }


def verifier_cartes(donnees):
    """Historique des personnes saisies, familles existantes comprises : qui serait facturé, qui l'est déjà. N'écrit rien."""
    with connection.cursor() as cursor:
        entete, lignes, _avertissements = _lire_saisie(cursor, {**donnees, "Carte": True})
    return module_cartes.synthese(lignes, entete["Regles"]["Carte"])


def _remuneration_apporteur(entete, totaux):
    """Rémunération de l'apporteur selon sa convention : montant par famille, ou taux sur la prime HT."""
    if not entete.get("IdApporteur") or not entete.get("ApporteurValeur"):
        return ZERO
    if entete["ApporteurMode"] == "FAMILLE":
        return _franc(entete["ApporteurValeur"] * totaux["Familles"])
    return _franc(totaux["PrimeHt"] * entete["ApporteurValeur"] / 100)


# ------------------------------------------------------------------ écriture du devis Santé
def _numero(cursor, id_avenant, id_compagnie, categorie):
    cursor.execute("CALL sp_numeroter_avenant(%s, %s, NULL, '')", [id_avenant, ID_INTERMEDIAIRE])
    numero_avenant = cursor.fetchone()[0]
    cursor.execute("CALL sp_generer_numero_devis(%s, %s, %s, '', '')", [ID_INTERMEDIAIRE, id_compagnie, categorie])
    numero_devis, message = cursor.fetchone()
    if not numero_devis:
        raise ErreurOreole(message or "Numéro de devis non attribué : la compagnie n'est pas rattachée au cabinet.")
    return numero_avenant, numero_devis


def _nouveau_devis(cursor, entete, id_produit, id_compagnie, categorie, id_offre, flotte, imposee, id_utilisateur):
    numero_avenant, numero_devis = _numero(cursor, ID_AVENANT_AFN, id_compagnie, categorie)
    cursor.execute(
        """
        INSERT INTO stddevis (idoperateur, idoffre, idintermediaire, idcompagnie, idproduit, idclient, idassure, idavenant,
            numeroavenant, numerodevis, flotte, idaperiteur, coassurance, periode, dateemission, dateeffet, dateexpiration,
            confirme, accessoirecompagnie, idduree, idterme, numeropolicecompagnie, primeimposee)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE, fn_calcul_periode_contrat(%s::date - %s::date),
            %s, %s, %s, FALSE, 0, fn_calcul_id_duree_contrat(%s::date - %s::date), 1, %s, %s)
        RETURNING iddevis
        """,
        [id_utilisateur, id_offre, ID_INTERMEDIAIRE, id_compagnie, id_produit, entete["IdClient"], entete["IdClient"], ID_AVENANT_AFN,
         numero_avenant, numero_devis, flotte, id_compagnie, entete["DateExpiration"], entete["DateEffet"], date_emission_du_jour(),
         entete["DateEffet"], entete["DateExpiration"], entete["DateExpiration"], entete["DateEffet"], entete["NumeroPoliceCompagnie"], imposee],
    )
    return cursor.fetchone()[0]


def _verifier_modifiable(cursor, id_devis, id_produit):
    cursor.execute("SELECT idproduit, COALESCE(confirme, FALSE), COALESCE(archive, FALSE) FROM stddevis WHERE iddevis = %s", [id_devis])
    ligne = cursor.fetchone()
    if not ligne or ligne[0] != id_produit:
        raise ErreurOreole(f"Devis n° {id_devis} introuvable.")
    if ligne[1]:
        raise ErreurOreole("Ce devis est déjà confirmé : il ne se modifie plus.")
    if ligne[2]:
        raise ErreurOreole("Ce devis est archivé.")


def _vider_composition(cursor, id_devis):
    cursor.execute("DELETE FROM lephare_oreole_adherent WHERE iddevis = %s", [id_devis])
    cursor.execute("DELETE FROM stdaffilie WHERE iddevis = %s", [id_devis])
    cursor.execute("DELETE FROM stdadherent WHERE iddevis = %s", [id_devis])
    cursor.execute("DELETE FROM stdfiliale WHERE iddevis = %s", [id_devis])


def _filiale(cursor, entete, id_devis, id_offre, id_utilisateur):
    cursor.execute(
        """INSERT INTO stdfiliale (iddevis, police, nom_filiale, actif, date_souscription, date_effet, date_expiration, source, datemaj,
               idcollege, idoffresante, idoperateur, idzonecouverture)
           VALUES (%s, '', '', TRUE, %s, %s, %s, 'S', now(), %s, %s, %s, %s) RETURNING idfiliale""",
        [id_devis, date_emission_du_jour(), entete["DateEffet"], entete["DateExpiration"], ID_COLLEGE_DEFAUT, id_offre, id_utilisateur, ID_ZONE_COTE_IVOIRE],
    )
    return cursor.fetchone()[0]


def _ecrire_adherent(cursor, entete, id_devis, id_filiale, ligne, id_utilisateur, complement=None):
    tarif = ligne["Tarif"]
    cursor.execute(
        """INSERT INTO stdadherent (matricule, surprimeappliquee, montantsurprime, nombrepathologie, numerocmu, groupesanguin, nom, prenom, sexe,
               cni, vip, adresse, mobile1, mobile2, email, datenaissance, dateadhesion, datesortie, actif, datemaj, iddevis,
               datedebutconsommation, idfiliale, idoperateur)
           VALUES (%s, %s, %s, %s, '', 'NS', %s, %s, %s, '', FALSE, '', '', '', '', %s, %s, NULL, TRUE, now(), %s, %s, %s, %s)
           RETURNING idadherent""",
        [ligne["Matricule"], bool(ligne["SurprimeImposee"]), ligne["SurprimeImposee"], ligne["Affections"], ligne["Nom"], ligne["Prenoms"], ligne["Sexe"],
         ligne["DateNaissance"], entete["DateEffet"], id_devis, entete["DateEffet"], id_filiale, id_utilisateur],
    )
    id_adherent = cursor.fetchone()[0]
    _ecrire_affilie(cursor, entete, id_devis, id_adherent, id_utilisateur, "A", ligne["Nom"], ligne["Prenoms"], ligne["DateNaissance"], ligne["Sexe"],
                    ligne["Matricule"], tarif["PartSante"], ligne["Affections"], ligne["SurprimeImposee"])
    for ayant in ligne["Ayants"]:
        _ecrire_affilie(cursor, entete, id_devis, id_adherent, id_utilisateur, ayant["Lien"], ayant["Nom"], ayant["Prenoms"], ayant["DateNaissance"],
                        ayant["Sexe"], "", ZERO, 0, ZERO)
    cursor.execute(
        """INSERT INTO lephare_oreole_adherent (iddevis, idadherent, idclient, idoffre, affections, tauxaffection, tauxage, surprimeimposee,
               cotisationimposee, enfantsenplus, personnes, beneficiaires, cotisation, partsante, partia, partafa, primeht, accessoires, fraiscourtiers,
               surprimeaffection, surprimeage, montantenfants, montantcartes, idoffreia, capitalia, capitalafa, complement)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        [id_devis, id_adherent, ligne.get("IdClient") or None, ligne["IdOffre"], ligne["Affections"], ligne["TauxAffection"], ligne["TauxAge"],
         ligne["SurprimeImposee"], ligne["CotisationImposee"], ligne["EnfantsEnPlus"], ligne["Personnes"], ligne["Beneficiaires"], tarif["Cotisation"],
         tarif["PartSante"], tarif["PartIA"], tarif["PartAFA"], tarif["PrimeHt"], tarif["Accessoires"], tarif["FraisCourtiers"],
         tarif["SurprimeAffection"], tarif["SurprimeAge"], tarif["MontantEnfants"], tarif["MontantCartes"], ligne["IdOffreIA"], ligne["CapitalIA"],
         ligne["CapitalAFA"], tarif["Cotisation"] if complement is None else complement],
    )
    return id_adherent


def _ecrire_affilie(cursor, entete, id_devis, id_adherent, id_utilisateur, lien, nom, prenom, naissance, sexe, matricule, prime, affections, surprime):
    cursor.execute(
        """INSERT INTO stdaffilie (mobile1, mobile2, matricule, surprimeappliquee, montantsurprime, nombrepathologie, numerocmu, groupesanguin, lien, nom,
               prenom, cni, datenaissance, dateadhesion, datesortie, certificat, datectrl, carte_vigueur, ancien_matricule, date_dernier_demande,
               observations, handicape, sexe, actif, primeannuelle, datemaj, iddevis, datedebutconsommation, idadherent, idoperateur)
           VALUES ('', '', %s, %s, %s, %s, '', 'NS', %s, %s, %s, '', %s, %s, NULL, FALSE, NULL, FALSE, '', NULL, 'RAS', FALSE, %s, TRUE, %s, now(), %s, %s, %s, %s)""",
        [matricule, bool(surprime), surprime, affections, lien, nom, prenom, naissance, entete["DateEffet"], sexe, prime, id_devis, entete["DateEffet"],
         id_adherent, id_utilisateur],
    )


def _ecrire_lignes_sante(cursor, entete, id_devis, id_offre, id_tarif, totaux_annuels, facture, type_contrat, gestionnaire):
    """Ligne de détail, garanties et montants du devis. facture : ce que ce devis facture (l'année ou le complément d'un avenant)."""
    cursor.execute("DELETE FROM stddevisdetgarantie WHERE iddevisdet IN (SELECT iddevisdetail FROM stddevisdetail WHERE iddevis = %s)", [id_devis])
    cursor.execute("DELETE FROM stdcomplementdevisdetailsante WHERE iddevisdetail IN (SELECT iddevisdetail FROM stddevisdetail WHERE iddevis = %s)", [id_devis])
    cursor.execute("DELETE FROM stddevisdetail WHERE iddevis = %s", [id_devis])
    cursor.execute(
        """
        INSERT INTO stddevisdetail (iddevis, idoffre, idtarif, vehicule, idusage, codeusage, reference, idcarrosserie, puissancefiscale, nombreplace,
            chargeutile, valeurneuve, valeurvenale, valeuraccessoire, remorque, conducteur, adressecnd, datemec, datemutation, nummoteur, numchassis,
            typevehicule, idmarque, matricule, carteverte, essence, numpccnd, tauxreduction, primeimposee, primeannuelle, primenette, taxeenregistrement,
            sexe, observation)
        VALUES (%s, %s, %s, 1, 0, '000', '000', 0, 0, 0, 0, 0, 0, 0, FALSE, '', '', '1900-01-01', '1900-01-01', '', '', '', 0, '', FALSE, 0, '', 0, TRUE,
            %s, %s, 0, '', '')
        RETURNING iddevisdetail
        """,
        [id_devis, id_offre, id_tarif, totaux_annuels["PrimeHt"], facture["PrimeHt"]],
    )
    id_detail = cursor.fetchone()[0]
    cursor.execute(
        """INSERT INTO stdcomplementdevisdetailsante (primefamille, primeaffilie, primeglobale, montantsurprime, montantaccessoiremanuel,
               tauxreductioncommerciale, idtypecontrat, gestionnairesante, iddevisdetail)
           VALUES (0, 0, %s, 0, 0, 0, %s, %s, %s)""",
        [totaux_annuels["PrimeHt"], type_contrat, gestionnaire[:60], id_detail],
    )
    for garantie, annuelle, nette in (
        (GARANTIE_SANTE, totaux_annuels["PrimeHt"], facture["PrimeHt"]), (GARANTIE_SURPRIME_AFFECTION, ZERO, ZERO), (GARANTIE_SURPRIME_AGE, ZERO, ZERO),
    ):
        cursor.execute(
            """INSERT INTO stddevisdetgarantie (iddevisdet, idgarantie, acquise, taxe, capital, tauxfranchise, minfranchise, maxfranchise, franchise,
                   textefranchise, primeannuelle, primenette, old_acquise, old_primenette)
               VALUES (%s, %s, TRUE, 0, 0, 0, 0, 0, 0, 'NEANT', %s, %s, '1', %s)""",
            [id_detail, garantie, annuelle, nette, nette],
        )
    cursor.execute(
        """UPDATE stddevis SET idoffre = %s, idcompagnie = %s, idaperiteur = %s, idclient = %s, idassure = %s, flotte = FALSE,
               dateeffet = %s, dateexpiration = %s, dateemission = %s, periode = fn_calcul_periode_contrat(%s::date - %s::date),
               idduree = fn_calcul_id_duree_contrat(%s::date - %s::date), numeropolicecompagnie = %s, primeimposee = TRUE,
               primeannuelle = %s, primenette = %s, accessoirecompagnie = %s, accessoireintermediaire = %s, accessoire = %s, accessoiregestionnaire = 0,
               taxe = 0, fga = 0, cedeao = 0, primettc = %s, commissionintermediaire = %s, commissiongestionnaire = %s
           WHERE iddevis = %s""",
        [id_offre, entete["Regles"]["CompagnieSante"], entete["Regles"]["CompagnieSante"], entete["IdClient"], entete["IdClient"], entete["DateEffet"],
         entete["DateExpiration"], date_emission_du_jour(), entete["DateExpiration"], entete["DateEffet"], entete["DateExpiration"], entete["DateEffet"],
         entete["NumeroPoliceCompagnie"], totaux_annuels["PrimeHt"], facture["PrimeHt"], facture["Accessoires"], facture["FraisCourtiers"],
         facture["Accessoires"] + facture["FraisCourtiers"], facture["PartSante"], facture["HonoraireCabinet"], facture["HonoraireGestionnaire"], id_devis],
    )


def _offre_principale(lignes):
    return Counter(l["IdOffre"] for l in lignes).most_common(1)[0][0]


def _tarif_oreole(cursor):
    cursor.execute("SELECT idtarif FROM stdtarif WHERE libelle = 'OREOLE SANTE' LIMIT 1")
    ligne = cursor.fetchone()
    if not ligne:
        raise ErreurOreole("Le tarif OREOLE SANTE n'est pas installé : appliquez la migration production 0205.")
    return ligne[0]


# ------------------------------------------------------------------ devis liés IA et AFA
def _identifier_assures(cursor, lignes):
    """N° de client de chaque adhérent (fiche reprise, même archivée, ou créée) : IA et AFA portent sur des clients."""
    vus = {}
    for ligne in lignes:
        if not (ligne["PartIA"] or ligne["PartAFA"]) and not ligne["IdClient"]:
            continue
        ligne["IdClient"] = module_afa._client_assure(cursor, {
            "IdClient": ligne["IdClient"], "Nom": ligne["Nom"], "Prenoms": ligne["Prenoms"], "DateNaissance": ligne["DateNaissance"],
            "Sexe": ligne["Sexe"], "Libelle": ligne["Libelle"],
        })
        if ligne["IdClient"] in vus:
            raise ErreurOreole(f"{ligne['Libelle']} : même fiche client que {vus[ligne['IdClient']]}.")
        vus[ligne["IdClient"]] = ligne["Libelle"]


def _ecrire_ia(cursor, entete, lignes, id_devis, id_utilisateur):
    """Devis IA des adhérents qui en ont une part. Renvoie (iddevis, TTC). Primes des offres CGA, sans prorata."""
    assures = [l for l in lignes if l["PartIA"] and l["IdOffreIA"]]
    regles = entete["Regles"]
    if not assures:
        if id_devis:
            _retirer_devis(cursor, id_devis)
        return None, ZERO
    flotte = len(assures) > 1
    if id_devis:
        _verifier_modifiable(cursor, id_devis, ID_PRODUIT_IA)
        cursor.execute("DELETE FROM stddevisdetgarantie WHERE iddevisdet IN (SELECT iddevisdetail FROM stddevisdetail WHERE iddevis = %s)", [id_devis])
        cursor.execute("DELETE FROM stddevisdetail WHERE iddevis = %s", [id_devis])
        cursor.execute(
            """UPDATE stddevis SET idclient = %s, idassure = %s, flotte = %s, dateeffet = %s, dateexpiration = %s, dateemission = %s,
                   periode = fn_calcul_periode_contrat(%s::date - %s::date), idduree = fn_calcul_id_duree_contrat(%s::date - %s::date),
                   primeimposee = FALSE, primeannuelle = 0, primenette = 0, accessoire = 0, accessoirecompagnie = 0, accessoireintermediaire = 0, taxe = 0, primettc = 0
               WHERE iddevis = %s""",
            [entete["IdClient"], entete["IdClient"], flotte, entete["DateEffet"], entete["DateExpiration"], date_emission_du_jour(), entete["DateExpiration"],
             entete["DateEffet"], entete["DateExpiration"], entete["DateEffet"], id_devis],
        )
    else:
        id_devis = _nouveau_devis(cursor, entete, ID_PRODUIT_IA, regles["CompagnieIA"], CODE_CATEGORIE_IA, assures[0]["IdOffreIA"], flotte, False, id_utilisateur)
    for ligne in assures:
        cursor.execute(
            "CALL sp_enregistrement_assure_ia(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s);",
            [regles["CompagnieIA"], ID_PRODUIT_IA, ligne["IdOffreIA"], ligne["IdClient"], 0, entete["DateEffet"], entete["DateExpiration"], ID_TARIF_IA_CGA,
             ligne["CapitalIA"], ligne["CapitalIA"], 0, 0, "01", ligne["DateNaissance"], "", id_devis, 0, 0, 0, 0, ""],
        )
        cursor.fetchone()
    cursor.execute("CALL sp_finalisation_devis(%s, %s, %s, %s, '')", [id_devis, entete["IdClient"], entete["IdClient"], flotte])
    cursor.fetchone()
    # Le devis IA reste au nom du souscripteur, l'assuré est l'adhérent en ligne
    cursor.execute("SELECT primettc FROM stddevis WHERE iddevis = %s", [id_devis])
    return id_devis, Decimal(cursor.fetchone()[0] or 0)


def _ecrire_afa(cursor, entete, lignes, id_devis, id_utilisateur, id_contrat_renouvele=0):
    assures = [l for l in lignes if l["PartAFA"]]
    if not assures:
        if id_devis:
            _retirer_devis(cursor, id_devis)
        return None, ZERO
    resultat = module_afa.enregistrer({
        "IdDevis": id_devis or 0, "IdCompagnie": entete["Regles"]["CompagnieAFA"], "IdClient": entete["IdClient"], "IdContratRenouvele": id_contrat_renouvele,
        "DateEffet": entete["DateEffet"], "DateExpiration": entete["DateExpiration"], "Accessoire": 0,
        "Assures": [{
            "IdClient": l["IdClient"], "Nom": l["Nom"], "Prenoms": l["Prenoms"], "DateNaissance": l["DateNaissance"], "Sexe": l["Sexe"],
            "Capital": l["CapitalAFA"], "PrimeTtc": l["PartAFA"], "Qualite": "ASSURE PRINCIPAL", "Beneficiaires": l["Beneficiaires"],
        } for l in assures],
    }, id_utilisateur)
    return resultat["IdDevis"], Decimal(str(resultat.get("PrimeTtc") or resultat.get("Totaux", {}).get("PrimeTtc") or 0)) or sum((l["PartAFA"] for l in assures), ZERO)


def _retirer_devis(cursor, id_devis):
    """Produit lié décoché avant confirmation : son devis est archivé, jamais un contrat."""
    cursor.execute("UPDATE stddevis SET archive = TRUE, datearchivage = now() WHERE iddevis = %s AND NOT COALESCE(confirme, FALSE)", [id_devis])


# ------------------------------------------------------------------ enregistrement du package
def enregistrer(donnees, id_utilisateur):
    with transaction.atomic(), connection.cursor() as cursor:
        entete, lignes, avertissements = _lire_saisie(cursor, donnees)
        if not entete["IdClient"]:
            raise ErreurOreole("Choisissez le souscripteur.")
        cursor.execute("SELECT 1 FROM stdclient WHERE idclient = %s", [entete["IdClient"]])
        if not cursor.fetchone():
            raise ErreurOreole(f"Souscripteur n° {entete['IdClient']} introuvable.")
        if entete["Acte"] not in ACTES:
            raise ErreurOreole("Acte non reconnu.")
        _identifier_assures(cursor, lignes)
        if entete["Acte"] == "INC":
            id_devis = _enregistrer_incorporation(cursor, entete, lignes, id_utilisateur)
        else:
            id_devis = _enregistrer_annuel(cursor, entete, lignes, id_utilisateur)
        package = lire(cursor, id_devis)
        package["Avertissements"] = avertissements
        return package


def _package(cursor, id_devis):
    lignes = _lignes(cursor, "SELECT * FROM lephare_oreole_package WHERE iddevis_sante = %s", [id_devis])
    return lignes[0] if lignes else None


def _enregistrer_annuel(cursor, entete, lignes, id_utilisateur):
    """Affaire nouvelle ou renouvellement : la composition et les primes de l'année."""
    regles = entete["Regles"]
    id_tarif = _tarif_oreole(cursor)
    id_devis = entete["IdDevis"]
    existant = _package(cursor, id_devis) if id_devis else None
    if id_devis and not existant:
        raise ErreurOreole(f"Le devis n° {id_devis} n'est pas un devis Oreole Santé.")
    offre_principale = _offre_principale(lignes)
    id_ia, id_afa = (existant["iddevis_ia"], existant["iddevis_afa"]) if existant else (None, None)
    contrat_afa_base = 0
    acte = existant["acte"] if existant else entete["Acte"]
    id_base = existant["idcontratbase"] if existant else entete["IdContratBase"]

    if id_devis:
        _verifier_modifiable(cursor, id_devis, ID_PRODUIT_SANTE)
    elif acte == "REN":
        id_devis, id_ia, id_afa, contrat_afa_base = _devis_renouvellement(cursor, entete, id_utilisateur)
    else:
        id_devis = _nouveau_devis(cursor, entete, ID_PRODUIT_SANTE, regles["CompagnieSante"], CODE_CATEGORIE_SANTE, offre_principale, False, True, id_utilisateur)
    _vider_composition(cursor, id_devis)

    id_ia, ttc_ia = _ecrire_ia(cursor, entete, lignes, id_ia, id_utilisateur)
    id_afa, ttc_afa = _ecrire_afa(cursor, entete, lignes, id_afa, id_utilisateur, contrat_afa_base)
    totaux = _totaux(lignes, regles)

    # Écart d'arrondi de l'IA (taxe et pièce de 5 F) : la cotisation du package reste exacte, les frais courtiers l'absorbent
    if id_ia and ttc_ia != totaux["PartIA"]:
        ajustement = totaux["PartIA"] - ttc_ia
        for cle in ("FraisCourtiers", "PartSante"):
            totaux[cle] += ajustement

    filiales = {}
    for id_offre in sorted({l["IdOffre"] for l in lignes}):
        filiales[id_offre] = _filiale(cursor, entete, id_devis, id_offre, id_utilisateur)
    for ligne in lignes:
        _ecrire_adherent(cursor, entete, id_devis, filiales[ligne["IdOffre"]], ligne, id_utilisateur)

    _ecrire_lignes_sante(cursor, entete, id_devis, offre_principale, id_tarif, totaux, totaux,
                         TYPE_PARTICULIER if entete["Cible"] == "P" else TYPE_SOCIETE, regles["Gestionnaire"])
    _ecrire_package(cursor, entete, id_devis, id_ia, id_afa, acte, id_base, id_utilisateur)
    rattacher_apporteur_package(cursor, id_devis, entete["IdApporteur"], entete["ApporteurMode"], entete["ApporteurValeur"], len(lignes), id_utilisateur)
    _noter_cartes(cursor, entete, id_devis, lignes, id_utilisateur)
    return id_devis


def _noter_cartes(cursor, entete, id_devis, lignes, id_utilisateur):
    """Registre des cartes de ce devis, réécrit à chaque enregistrement tant qu'il n'est pas confirmé."""
    module_cartes.effacer_du_devis(cursor, id_devis)
    if not entete["Carte"]:
        return
    for ligne in lignes:
        module_cartes.ecrire(cursor, id_devis, ligne.get("Cartes") or [], entete["Regles"]["Carte"], id_utilisateur, entete.get("ObservationCarte") or "")


def _ecrire_package(cursor, entete, id_devis, id_ia, id_afa, acte, id_base, id_utilisateur):
    cursor.execute(
        """INSERT INTO lephare_oreole_package (iddevis_sante, iddevis_ia, iddevis_afa, cible, acte, idcontratbase, prixfamille, carte, montantcarte,
               idapporteur, apporteurmode, apporteurvaleur, idoperateur)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (iddevis_sante) DO UPDATE SET iddevis_ia = EXCLUDED.iddevis_ia, iddevis_afa = EXCLUDED.iddevis_afa, cible = EXCLUDED.cible,
               prixfamille = EXCLUDED.prixfamille, carte = EXCLUDED.carte, montantcarte = EXCLUDED.montantcarte, idapporteur = EXCLUDED.idapporteur,
               apporteurmode = EXCLUDED.apporteurmode, apporteurvaleur = EXCLUDED.apporteurvaleur, datemodification = now()""",
        [id_devis, id_ia, id_afa, entete["Cible"], acte, id_base or None, entete["PrixFamille"], entete["Carte"],
         entete["Regles"]["Carte"] if entete["Carte"] else ZERO, entete["IdApporteur"], entete["ApporteurMode"], entete["ApporteurValeur"], id_utilisateur],
    )


# ------------------------------------------------------------------ renouvellement
def _contrat_du_devis(cursor, id_devis):
    if not id_devis:
        return None
    lignes = _lignes(cursor, """SELECT idcontrat, numeropolice, idclient, dateeffet::date AS dateeffet, dateexpiration::date AS dateexpiration
                                FROM stdcontrat WHERE iddevis = %s AND COALESCE(idcontratannulation, 0) = 0 ORDER BY idcontrat DESC LIMIT 1""", [id_devis])
    return lignes[0] if lignes else None


def _base_sante(cursor, id_contrat):
    """Contrat Santé Oreole de base de la période, et son package."""
    try:
        base = _contrat_base(cursor, id_contrat)
    except ErreurRenouvellement as erreur:
        raise ErreurOreole(str(erreur)) from erreur
    package = _package_de_police(cursor, base["numeropolice"])
    if base["idproduit"] != ID_PRODUIT_SANTE or not package:
        raise ErreurOreole("Ce contrat n'est pas une police Santé Oreole.")
    return base, package


def _package_de_police(cursor, numero_police):
    """Dernier package émis d'une police Santé : composition en vigueur."""
    lignes = _lignes(cursor, """
        SELECT p.* FROM lephare_oreole_package p JOIN stdcontrat c ON c.iddevis = p.iddevis_sante
        WHERE c.numeropolice = %s AND COALESCE(c.idcontratannulation, 0) = 0 ORDER BY c.idcontrat DESC LIMIT 1""", [numero_police])
    return lignes[0] if lignes else None


def _devis_renouvellement(cursor, entete, id_utilisateur):
    """Devis REN des polices émises (même numéro à la confirmation) ; un produit lié sans police part en affaire nouvelle."""
    base, package = _base_sante(cursor, entete["IdContratBase"])
    if entete["DateEffet"] <= base["dateeffet"]:
        raise ErreurOreole(f"Le renouvellement doit prendre effet après le {base['dateeffet']:%d/%m/%Y}.")
    en_cours = _lignes(cursor, """SELECT d.numerodevis FROM stddevis d JOIN stdavenant a ON a.idavenant = d.idavenant
                                  WHERE a.codeavenant = 'REN' AND d.idoldhist = %s AND NOT COALESCE(d.confirme, FALSE) AND NOT COALESCE(d.archive, FALSE)""",
                       [base["iddevis"]])
    if en_cours:
        raise ErreurOreole(f"Un devis de renouvellement de cette police est déjà en cours ({en_cours[0]['numerodevis']}) : modifiez-le.")

    def renouveler(id_contrat):
        cursor.execute("CALL sp_avenant_creation_devis_initial(%s, %s, %s, %s, %s, %s, '', 0, '')",
                       [id_utilisateur, id_contrat, ID_AVENANT_REN, date_emission_du_jour(), entete["DateEffet"], entete["DateExpiration"]])
        id_devis, message = cursor.fetchone()
        if not id_devis:
            raise ErreurOreole(message or "Le devis de renouvellement n'a pas pu être créé.")
        return id_devis

    id_sante = renouveler(base["idcontrat"])
    contrat_ia = _base_lie(cursor, package["iddevis_ia"], package)
    contrat_afa = _base_lie(cursor, package["iddevis_afa"], package)
    id_ia = renouveler(contrat_ia["idcontrat"]) if contrat_ia else None
    return id_sante, id_ia, None, (contrat_afa["idcontrat"] if contrat_afa else 0)


def _base_lie(cursor, id_devis, package):
    contrat = _contrat_du_devis(cursor, id_devis)
    if not contrat:
        return None
    try:
        return _contrat_base(cursor, contrat["idcontrat"])
    except ErreurRenouvellement:
        return None


# ------------------------------------------------------------------ incorporation : prime complémentaire, sans prorata
def _enregistrer_incorporation(cursor, entete, lignes, id_utilisateur):
    """
    Avenant sous les mêmes polices. Santé : devis MOD qui reprend toute la composition (dernier avenant émis) et y ajoute les nouveaux
    adhérents ; un adhérent existant (IdAdherentBase) reçoit ses ayants droit et ses enfants en plus. Prime = complément dû en entier.
    IA et AFA : devis INC ne portant que les nouvelles personnes.
    """
    if entete["IdDevis"]:
        raise ErreurOreole("Une incorporation enregistrée se confirme ou se supprime : reprenez-la depuis la fiche du contrat.")
    regles = entete["Regles"]
    base, package = _base_sante(cursor, entete["IdContratBase"])
    if not base["dateeffet"] <= entete["DateEffet"] <= base["dateexpiration"]:
        raise ErreurOreole(f"La date d'incorporation doit être comprise dans la période du contrat, du {base['dateeffet']:%d/%m/%Y} au {base['dateexpiration']:%d/%m/%Y}.")
    entete["DateExpiration"] = base["dateexpiration"]
    entete["IdClient"] = base["idclient"]
    en_cours = _lignes(cursor, """SELECT d.numerodevis FROM stddevis d JOIN stdavenant a ON a.idavenant = d.idavenant
                                  JOIN lephare_oreole_package p ON p.iddevis_sante = d.iddevis
                                  WHERE p.idcontratbase = %s AND p.acte = 'INC' AND NOT COALESCE(d.confirme, FALSE) AND NOT COALESCE(d.archive, FALSE)""",
                       [base["idcontrat"]])
    if en_cours:
        raise ErreurOreole(f"Une incorporation est déjà en cours sur cette police ({en_cours[0]['numerodevis']}) : confirmez-la ou supprimez-la.")

    cursor.execute("CALL sp_avenant_creation_devis_initial(%s, %s, %s, %s, %s, %s, '', 0, '')",
                   [id_utilisateur, base["idcontrat"], ID_AVENANT_MOD, date_emission_du_jour(), entete["DateEffet"], base["dateexpiration"]])
    id_devis, message = cursor.fetchone()
    if not id_devis:
        raise ErreurOreole(message or "Le devis d'avenant n'a pas pu être créé.")
    _recopier_detail_adherents(cursor, package["iddevis_sante"], id_devis, base)

    # Existants : ajouts à la famille ; nouveaux : famille complète
    nouveaux, ajouts = [], []
    for ligne in lignes:
        (ajouts if ligne["IdAdherentBase"] else nouveaux).append(ligne)
    facture_lignes = []
    for ligne in ajouts:
        facture_lignes.append(_ajouter_a_famille(cursor, entete, id_devis, ligne, id_utilisateur))
    filiales = {}
    for ligne in nouveaux:
        if ligne["IdOffre"] not in filiales:
            filiales[ligne["IdOffre"]] = _filiale(cursor, entete, id_devis, ligne["IdOffre"], id_utilisateur)
        _ecrire_adherent(cursor, entete, id_devis, filiales[ligne["IdOffre"]], ligne, id_utilisateur)
        facture_lignes.append({"PrimeHt": ligne["Tarif"]["PrimeHt"], "Accessoires": ligne["Tarif"]["Accessoires"],
                               "FraisCourtiers": ligne["Tarif"]["FraisCourtiers"], "PartSante": ligne["Tarif"]["PartSante"]})

    somme = lambda cle: sum((f[cle] for f in facture_lignes), ZERO)  # noqa: E731
    facture = {"PrimeHt": somme("PrimeHt"), "Accessoires": somme("Accessoires"), "FraisCourtiers": somme("FraisCourtiers"), "PartSante": somme("PartSante")}
    facture["HonoraireCabinet"] = _franc(facture["PrimeHt"] * regles["HonoraireCabinet"] / 100)
    facture["HonoraireGestionnaire"] = _franc(facture["PrimeHt"] * regles["HonoraireGestionnaire"] / 100)
    cursor.execute("SELECT COALESCE(SUM(primeht), 0) FROM lephare_oreole_adherent WHERE iddevis = %s", [id_devis])
    annuels = {"PrimeHt": Decimal(cursor.fetchone()[0] or 0)}
    cursor.execute("SELECT idoffre FROM stddevis WHERE iddevis = %s", [package["iddevis_sante"]])
    id_offre = cursor.fetchone()[0]
    entete["NumeroPoliceCompagnie"] = entete["NumeroPoliceCompagnie"] or _police_compagnie(cursor, package["iddevis_sante"])
    _ecrire_lignes_sante(cursor, entete, id_devis, id_offre, _tarif_oreole(cursor), annuels, facture,
                         TYPE_PARTICULIER if package["cible"] == "P" else TYPE_SOCIETE, regles["Gestionnaire"])

    id_ia = _incorporer_lie(cursor, entete, package["iddevis_ia"], [l for l in nouveaux if l["PartIA"]], ID_PRODUIT_IA, base, id_utilisateur)
    id_afa = _incorporer_lie(cursor, entete, package["iddevis_afa"], [l for l in nouveaux if l["PartAFA"]], ID_PRODUIT_VIE, base, id_utilisateur)
    entete["Cible"] = package["cible"]
    entete["PrixFamille"] = package["prixfamille"]
    _ecrire_package(cursor, entete, id_devis, id_ia, id_afa, "INC", base["idcontrat"], id_utilisateur)
    rattacher_apporteur_package(cursor, id_devis, entete["IdApporteur"], entete["ApporteurMode"], entete["ApporteurValeur"], len(nouveaux), id_utilisateur)
    _noter_cartes(cursor, entete, id_devis, lignes, id_utilisateur)
    return id_devis


def _police_compagnie(cursor, id_devis):
    cursor.execute("SELECT numeropolicecompagnie FROM stddevis WHERE iddevis = %s", [id_devis])
    ligne = cursor.fetchone()
    return ligne[0] if ligne else None


def _recopier_detail_adherents(cursor, id_devis_source, id_devis, base):
    """sp_avenant_creation_devis_initial recopie les familles de la dernière composition émise : leur détail suit, sans rien facturer."""
    cursor.execute(
        """
        INSERT INTO lephare_oreole_adherent (iddevis, idadherent, idclient, idoffre, affections, tauxaffection, tauxage, surprimeimposee, cotisationimposee,
            enfantsenplus, personnes, beneficiaires, cotisation, partsante, partia, partafa, primeht, accessoires, fraiscourtiers, surprimeaffection,
            surprimeage, montantenfants, montantcartes, idoffreia, capitalia, capitalafa, complement)
        SELECT %s, nouveau.idadherent, s.idclient, s.idoffre, s.affections, s.tauxaffection, s.tauxage, s.surprimeimposee, s.cotisationimposee, s.enfantsenplus,
            s.personnes, s.beneficiaires, s.cotisation, s.partsante, s.partia, s.partafa, s.primeht, s.accessoires, s.fraiscourtiers, s.surprimeaffection,
            s.surprimeage, s.montantenfants, s.montantcartes, s.idoffreia, s.capitalia, s.capitalafa, 0
        FROM stdadherent nouveau
        JOIN stdadherent ancien ON ancien.iddevis = %s AND UPPER(TRIM(ancien.nom)) = UPPER(TRIM(nouveau.nom))
             AND UPPER(TRIM(COALESCE(ancien.prenom, ''))) = UPPER(TRIM(COALESCE(nouveau.prenom, '')))
             AND ancien.datenaissance IS NOT DISTINCT FROM nouveau.datenaissance
        JOIN lephare_oreole_adherent s ON s.idadherent = ancien.idadherent
        WHERE nouveau.iddevis = %s
        """,
        [id_devis, id_devis_source, id_devis],
    )


def _ajouter_a_famille(cursor, entete, id_devis, ligne, id_utilisateur):
    """Ajout d'ayants droit à une famille existante : seuls les enfants au-delà du forfait et les cartes font un complément."""
    lignes = _lignes(cursor, """
        SELECT a.idadherent, s.enfantsenplus, s.personnes, s.idoffre, s.fraiscourtiers, s.cotisation, s.partsante, o.enfantsupplementaire
        FROM stdadherent ancien
        JOIN stdadherent a ON a.iddevis = %s AND UPPER(TRIM(a.nom)) = UPPER(TRIM(ancien.nom))
             AND UPPER(TRIM(COALESCE(a.prenom, ''))) = UPPER(TRIM(COALESCE(ancien.prenom, '')))
             AND a.datenaissance IS NOT DISTINCT FROM ancien.datenaissance
        JOIN lephare_oreole_adherent s ON s.idadherent = a.idadherent
        JOIN lephare_oreole_offre o ON o.idoffre = s.idoffre
        WHERE ancien.idadherent = %s""", [id_devis, ligne["IdAdherentBase"]])
    if not lignes:
        raise ErreurOreole(f"{ligne['Libelle']} : famille introuvable dans la composition du contrat.")
    famille = lignes[0]
    cursor.execute("SELECT COUNT(*) FROM stdaffilie WHERE idadherent = %s AND lien = 'E'", [famille["idadherent"]])
    enfants_avant = cursor.fetchone()[0]
    for ayant in ligne["Ayants"]:
        _ecrire_affilie(cursor, entete, id_devis, famille["idadherent"], id_utilisateur, ayant["Lien"], ayant["Nom"], ayant["Prenoms"], ayant["DateNaissance"],
                        ayant["Sexe"], "", ZERO, 0, ZERO)
    enfants_apres = enfants_avant + sum(1 for a in ligne["Ayants"] if a["Lien"] == "E")
    # Carte remplacée sans ajout de personne : seule la carte est due, la composition de la famille ne change pas
    supplement_enfants = 0
    if not ligne.get("CartesSeules"):
        supplement_enfants = max(max(enfants_apres - ENFANTS_COMPRIS, 0), ligne["EnfantsEnPlus"] + famille["enfantsenplus"]) - famille["enfantsenplus"]
        supplement_enfants = max(supplement_enfants, 0)
    complement = Decimal(supplement_enfants) * famille["enfantsupplementaire"]
    personnes_ajoutees = len(ligne["Ayants"])
    montant_cartes = ZERO
    if entete["Carte"]:
        montant_cartes = Decimal(ligne.get("CartesAFacturer", personnes_ajoutees)) * entete["Regles"]["Carte"]
        complement += montant_cartes
    cursor.execute(
        """UPDATE lephare_oreole_adherent SET enfantsenplus = enfantsenplus + %s, personnes = personnes + %s, cotisation = cotisation + %s,
               partsante = partsante + %s, fraiscourtiers = fraiscourtiers + %s, montantcartes = montantcartes + %s, complement = %s WHERE idadherent = %s""",
        [supplement_enfants, personnes_ajoutees, complement, complement, complement, montant_cartes, complement, famille["idadherent"]],
    )
    return {"PrimeHt": ZERO, "Accessoires": ZERO, "FraisCourtiers": complement, "PartSante": complement}


def _incorporer_lie(cursor, entete, id_devis_lie, lignes, id_produit, base, id_utilisateur):
    """Devis INC du produit lié, s'il est émis et si l'incorporation ajoute quelqu'un."""
    contrat = _contrat_du_devis(cursor, id_devis_lie)
    if not lignes or not contrat:
        return None
    try:
        base_lie = _contrat_base(cursor, contrat["idcontrat"])
    except ErreurRenouvellement as erreur:
        raise ErreurOreole(str(erreur)) from erreur
    cursor.execute("CALL sp_avenant_creation_devis_initial(%s, %s, %s, %s, %s, %s, '', 0, '')",
                   [id_utilisateur, base_lie["idcontrat"], ID_AVENANT_INC, date_emission_du_jour(), entete["DateEffet"], base_lie["dateexpiration"]])
    id_devis, message = cursor.fetchone()
    if not id_devis:
        raise ErreurOreole(message or "Le devis d'incorporation n'a pas pu être créé.")
    cursor.execute("DELETE FROM stddevisdetgarantie WHERE iddevisdet IN (SELECT iddevisdetail FROM stddevisdetail WHERE iddevis = %s)", [id_devis])
    cursor.execute("DELETE FROM stddevisdetail WHERE iddevis = %s", [id_devis])
    cursor.execute(
        """UPDATE stddevis d SET flotte = TRUE, numeropoliceconnexe = %s, primeannuelle = 0, primenette = 0, accessoire = 0, accessoirecompagnie = 0,
               accessoiregestionnaire = 0, accessoireintermediaire = 0, commissionintermediaire = 0, taxe = 0, primettc = 0, primeimposee = FALSE
           WHERE d.iddevis = %s""",
        [base["numeropolice"], id_devis],
    )
    entete_lie = {**entete, "DateExpiration": base_lie["dateexpiration"]}
    if id_produit == ID_PRODUIT_IA:
        identifiant, _ttc = _ecrire_ia(cursor, entete_lie, lignes, id_devis, id_utilisateur)
    else:
        identifiant, _ttc = _ecrire_afa(cursor, entete_lie, lignes, id_devis, id_utilisateur)
    return identifiant


# ------------------------------------------------------------------ relecture
def _etat_devis(cursor, id_devis):
    if not id_devis:
        return None
    lignes = _lignes(cursor, """
        SELECT d.iddevis, d.numerodevis, COALESCE(d.confirme, FALSE) AS confirme, COALESCE(d.archive, FALSE) AS archive, d.primettc, d.primenette, d.accessoire,
               d.taxe, d.idcompagnie, co.raisonsociale AS compagnie, c.idcontrat, c.numeropolice, q.numeroquittance, COALESCE(q.mt_encaisse, 0) AS encaisse, q.primettc AS ttcquittance
        FROM stddevis d
        LEFT JOIN stdcompagnie co ON co.idcompagnie = d.idcompagnie
        LEFT JOIN LATERAL (SELECT x.* FROM stdcontrat x WHERE x.iddevis = d.iddevis AND COALESCE(x.idcontratannulation, 0) = 0 ORDER BY x.idcontrat DESC LIMIT 1) c ON TRUE
        LEFT JOIN stdquittance q ON q.idquittance = c.idquittance
        WHERE d.iddevis = %s""", [id_devis])
    if not lignes:
        return None
    l = lignes[0]
    return {
        "IdDevis": l["iddevis"], "NumeroDevis": l["numerodevis"], "Confirme": l["confirme"], "Archive": l["archive"],
        "PrimeTtc": _nombre(l["primettc"]), "PrimeNette": _nombre(l["primenette"]), "Accessoire": _nombre(l["accessoire"]), "Taxe": _nombre(l["taxe"]),
        "IdCompagnie": l["idcompagnie"], "Compagnie": l["compagnie"] or "", "IdContrat": l["idcontrat"], "NumeroPolice": l["numeropolice"],
        "NumeroQuittance": l["numeroquittance"], "Encaisse": _nombre(l["encaisse"]),
        "ResteAEncaisser": _nombre(reste_a_encaisser(l["ttcquittance"], l["encaisse"])) if l["numeroquittance"] else 0,
    }


def lire(cursor, id_devis):
    package = _package(cursor, id_devis)
    if not package:
        raise ErreurOreole(f"Devis Oreole Santé n° {id_devis} introuvable.")
    entetes = _lignes(cursor, """
        SELECT d.iddevis, d.numerodevis, d.idclient, TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS client, d.dateeffet::date AS dateeffet,
               d.dateexpiration::date AS dateexpiration, d.dateemission::date AS dateemission, d.primettc, d.primenette, d.primeannuelle, d.accessoirecompagnie,
               d.accessoireintermediaire, d.commissionintermediaire, d.commissiongestionnaire, d.numeropolicecompagnie, d.idoldhist, d.idoffre,
               a.codeavenant, COALESCE(d.confirme, FALSE) AS confirme
        FROM stddevis d LEFT JOIN stdclient cl ON cl.idclient = d.idclient LEFT JOIN stdavenant a ON a.idavenant = d.idavenant
        WHERE d.iddevis = %s""", [id_devis])
    e = entetes[0]
    adherents = _lignes(cursor, """
        SELECT a.idadherent, a.matricule, a.nom, a.prenom, a.sexe, a.datenaissance, s.idclient, s.idoffre, s.affections, s.tauxaffection, s.tauxage, s.surprimeimposee,
               s.cotisationimposee, s.enfantsenplus, s.personnes, s.beneficiaires, s.cotisation, s.partsante, s.partia, s.partafa, s.primeht, s.accessoires,
               s.fraiscourtiers, s.surprimeaffection, s.surprimeage, s.montantenfants, s.montantcartes, s.idoffreia, s.capitalia, s.capitalafa, s.complement, o.libelle AS offre
        FROM stdadherent a JOIN lephare_oreole_adherent s ON s.idadherent = a.idadherent LEFT JOIN lephare_oreole_offre o ON o.idoffre = s.idoffre
        WHERE a.iddevis = %s ORDER BY a.idadherent""", [id_devis])
    ayants = _lignes(cursor, """SELECT idadherent, lien, nom, prenom, datenaissance, sexe FROM stdaffilie WHERE iddevis = %s AND lien <> 'A' ORDER BY idaffilie""", [id_devis])
    par_adherent = {}
    for ayant in ayants:
        par_adherent.setdefault(ayant["idadherent"], []).append({
            "Lien": ayant["lien"], "Nom": ayant["nom"], "Prenoms": ayant["prenom"], "DateNaissance": _iso(ayant["datenaissance"]), "Sexe": ayant["sexe"],
        })
    lignes = [{
        "IdAdherent": a["idadherent"], "Matricule": a["matricule"] or "", "Nom": a["nom"], "Prenoms": a["prenom"], "Sexe": a["sexe"], "DateNaissance": _iso(a["datenaissance"]),
        "IdClient": a["idclient"], "IdOffre": a["idoffre"], "Offre": a["offre"] or "", "Affections": a["affections"],
        "TauxAffection": None if a["tauxaffection"] is None else _nombre(a["tauxaffection"]), "TauxAge": None if a["tauxage"] is None else _nombre(a["tauxage"]),
        "SurprimeImposee": _nombre(a["surprimeimposee"]), "CotisationImposee": _nombre(a["cotisationimposee"]), "EnfantsEnPlus": a["enfantsenplus"], "Personnes": a["personnes"],
        "Beneficiaires": a["beneficiaires"] or "", "Cotisation": _nombre(a["cotisation"]), "PartSante": _nombre(a["partsante"]), "PartIA": _nombre(a["partia"]),
        "PartAFA": _nombre(a["partafa"]), "PrimeHt": _nombre(a["primeht"]), "Accessoires": _nombre(a["accessoires"]), "FraisCourtiers": _nombre(a["fraiscourtiers"]),
        "SurprimeAffection": _nombre(a["surprimeaffection"]), "SurprimeAge": _nombre(a["surprimeage"]), "MontantEnfants": _nombre(a["montantenfants"]),
        "MontantCartes": _nombre(a["montantcartes"]), "CapitalIA": _nombre(a["capitalia"]), "CapitalAFA": _nombre(a["capitalafa"]), "Complement": _nombre(a["complement"]),
        "Ayants": par_adherent.get(a["idadherent"], []),
    } for a in adherents]
    sante, ia, afa = _etat_devis(cursor, id_devis), _etat_devis(cursor, package["iddevis_ia"]), _etat_devis(cursor, package["iddevis_afa"])
    somme = lambda cle: sum(l[cle] for l in lignes)  # noqa: E731
    regles = reglages()
    produits = [p for p in (sante, ia, afa) if p]
    cursor.execute("SELECT reseau FROM lephare_oreole_offre WHERE idoffre = %s", [e["idoffre"]])
    reseau = cursor.fetchone()
    return {
        "Reseau": reseau[0] if reseau else "MCI_80",
        "IdDevis": id_devis, "NumeroDevis": e["numerodevis"], "Acte": package["acte"], "CodeAvenant": e["codeavenant"], "Cible": package["cible"], "IdClient": e["idclient"],
        "Client": e["client"], "DateEffet": _iso(e["dateeffet"]), "DateExpiration": _iso(e["dateexpiration"]), "DateEmission": _iso(e["dateemission"]),
        "IdOffre": e["idoffre"], "PrixFamille": None if package["prixfamille"] is None else _nombre(package["prixfamille"]), "Carte": package["carte"],
        "MontantCarte": _nombre(package["montantcarte"]), "IdApporteur": package["idapporteur"], "ApporteurMode": package["apporteurmode"],
        "ApporteurValeur": _nombre(package["apporteurvaleur"]), "IdContratBase": package["idcontratbase"], "NumeroPoliceCompagnie": e["numeropolicecompagnie"] or "",
        "Confirme": e["confirme"], "Adherents": lignes, "CartesPerte": module_cartes.pertes_du_devis(cursor, id_devis),
        "Produits": {"Sante": sante, "IA": ia, "AFA": afa},
        "Totaux": {
            "Familles": len(lignes), "Cotisation": sum(p["PrimeTtc"] for p in produits),
            "CotisationAnnuelle": somme("Cotisation"), "PartSante": sante["PrimeTtc"], "PartIA": ia["PrimeTtc"] if ia else 0, "PartAFA": afa["PrimeTtc"] if afa else 0,
            "PrimeHt": _nombre(e["primenette"]), "Accessoires": _nombre(e["accessoirecompagnie"]), "FraisCourtiers": _nombre(e["accessoireintermediaire"]),
            "HonoraireCabinet": _nombre(e["commissionintermediaire"]), "HonoraireGestionnaire": _nombre(e["commissiongestionnaire"]),
            "PartMCI": _nombre(e["primenette"]) + _nombre(e["accessoirecompagnie"]),
            "ResteAEncaisser": sum(p["ResteAEncaisser"] for p in produits),
        },
        "TauxHonoraires": {"Cabinet": _nombre(regles["HonoraireCabinet"]), "Gestionnaire": _nombre(regles["HonoraireGestionnaire"])},
    }


# ------------------------------------------------------------------ encaissement commun
# Le client paie une seule prime : la caisse montre le package sur une ligne et un règlement unique le solde. Les trois
# quittances restent en base, une par compagnie, car chacune reçoit son reversement et sa commission.
def _quittances_des_packages(cursor, id_devis=None, verrou=False):
    """Quittances émises de chaque package, la police Santé d'abord."""
    lignes = _lignes(cursor, f"""
        SELECT p.iddevis_sante, v.produit, c.idcontrat, c.numeropolice, q.numeroquittance, q.dateemission::date AS dateemission, q.primettc,
               COALESCE(q.mt_encaisse, 0) AS encaisse, co.raisonsociale AS compagnie, TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS client,
               (SELECT MAX(de.idencaissement) FROM stddetailencaissement de JOIN stdencaissement e ON e.idencaissement = de.idencaissement
                WHERE de.numeroquittance = q.numeroquittance AND NOT COALESCE(e.piece_annulee, FALSE)) AS dernierencaissement
        FROM lephare_oreole_package p
        CROSS JOIN LATERAL (VALUES (1, 'Sante', p.iddevis_sante), (2, 'IA', p.iddevis_ia), (3, 'AFA', p.iddevis_afa)) AS v(ordre, produit, iddevis)
        JOIN LATERAL (SELECT x.idcontrat, x.numeropolice, x.idquittance, x.idcompagnie FROM stdcontrat x
                      WHERE x.iddevis = v.iddevis AND COALESCE(x.idcontratannulation, 0) = 0 ORDER BY x.idcontrat DESC LIMIT 1) c ON TRUE
        JOIN stdquittance q ON q.idquittance = c.idquittance
        LEFT JOIN stdcompagnie co ON co.idcompagnie = c.idcompagnie
        LEFT JOIN stdclient cl ON cl.idclient = q.idclient
        {"WHERE p.iddevis_sante = %s" if id_devis else ""}
        ORDER BY p.iddevis_sante DESC, v.ordre {"FOR UPDATE OF q" if verrou else ""}""", [id_devis] if id_devis else [])
    groupes = {}
    for l in lignes:
        groupe = groupes.setdefault(l["iddevis_sante"], {
            "IdDevis": l["iddevis_sante"], "Client": l["client"], "NumeroPolice": l["numeropolice"], "NumeroQuittance": l["numeroquittance"],
            "DateEmission": _iso(l["dateemission"]), "DernierEncaissement": None, "Quittances": [],
        })
        if l["dernierencaissement"]:
            groupe["DernierEncaissement"] = max(groupe["DernierEncaissement"] or 0, l["dernierencaissement"])
        groupe["Quittances"].append({
            "Produit": l["produit"], "IdContrat": l["idcontrat"], "NumeroPolice": l["numeropolice"], "NumeroQuittance": l["numeroquittance"], "Compagnie": l["compagnie"] or "",
            "PrimeTtc": Decimal(str(l["primettc"] or 0)), "Encaisse": Decimal(str(l["encaisse"] or 0)),
        })
    return list(groupes.values())


def ventiler_reglement(quittances, montant):
    """Répartit un règlement sur les quittances : tout solde tout ; un acompte va au prorata de ce qui reste dû, sans dépasser le dû de chacune."""
    dues = [(q["NumeroQuittance"], q["PrimeTtc"] - q["Encaisse"]) for q in quittances]
    dues = [(numero, du) for numero, du in dues if du > 0]
    total = sum((du for _numero, du in dues), ZERO)
    if montant <= 0:
        raise ErreurOreole("Le montant du règlement doit être supérieur à zéro.")
    if montant > total:
        raise ErreurOreole(f"Le montant dépasse le reste dû sur ce package : {_franc(total):,.0f} F.".replace(",", " "))
    if montant == total:
        return [{"numero_quittance": numero, "montant_encaissement": str(du)} for numero, du in dues]
    parts = [(montant * du / total).to_integral_value(rounding=ROUND_DOWN) for _numero, du in dues]
    a_placer = montant - sum(parts, ZERO)
    for i, (_numero, du) in enumerate(dues):
        ajout = min(a_placer, du - parts[i])
        parts[i] += ajout
        a_placer -= ajout
    return [{"numero_quittance": numero, "montant_encaissement": str(part)} for (numero, _du), part in zip(dues, parts) if part > 0]


def packages_a_encaisser():
    """Packages dont il reste à encaisser, pour la caisse."""
    with connection.cursor() as cursor:
        groupes = _quittances_des_packages(cursor)
    resultat = []
    for groupe in groupes:
        restes = [reste_a_encaisser(q["PrimeTtc"], q["Encaisse"]) for q in groupe["Quittances"]]
        if not any(restes):
            continue
        resultat.append({
            **groupe,
            "Quittances": [{**q, "PrimeTtc": _nombre(q["PrimeTtc"]), "Encaisse": _nombre(q["Encaisse"]), "Reste": _nombre(reste)} for q, reste in zip(groupe["Quittances"], restes)],
            "PrimeTtc": _nombre(sum((q["PrimeTtc"] for q in groupe["Quittances"]), ZERO)), "Encaisse": _nombre(sum((q["Encaisse"] for q in groupe["Quittances"]), ZERO)),
            "Reste": _nombre(sum(restes, ZERO)),
        })
    return {"Packages": resultat}


# ------------------------------------------------------------------ émission
def _confirmer(cursor, id_devis, police_mere=None):
    """Confirme un devis lié dans la transaction en cours. Une erreur annule tout le package."""
    if police_mere:
        cursor.execute("UPDATE stddevis SET numeropoliceconnexe = %s WHERE iddevis = %s", [police_mere, id_devis])
    erreur, resultat = save_contract({"IdDevis": id_devis})
    ligne = (list(resultat) or [None])[0]
    if erreur or not ligne or not ligne.ObjectId:
        raise ErreurOreole((ligne.OutputMessage if ligne else "") or "La confirmation a été refusée.")
    # Honoraires du gestionnaire : sp_confirmation_devis ne les recopie pas
    cursor.execute("""UPDATE stdcontrat c SET commissiongestionnaire = d.commissiongestionnaire FROM stddevis d
                      WHERE c.idcontrat = %s AND d.iddevis = c.iddevis""", [ligne.ObjectId])
    cursor.execute("SELECT numeropolice FROM stdcontrat WHERE idcontrat = %s", [ligne.ObjectId])
    return ligne.ObjectId, cursor.fetchone()[0]


def emettre(id_devis, produits=None):
    """Confirme les devis du package non encore confirmés. produits : sous-ensemble de {Sante, IA, AFA}, tous par défaut."""
    choisis = set(produits or ("Sante", "IA", "AFA"))
    with transaction.atomic(), connection.cursor() as cursor:
        package = _package(cursor, id_devis)
        if not package:
            raise ErreurOreole(f"Devis Oreole Santé n° {id_devis} introuvable.")
        etat = _etat_devis(cursor, id_devis)
        police = etat["NumeroPolice"]
        emis = []
        if not etat["Confirme"]:
            try:
                module_cartes.controler_emission(cursor, id_devis)
            except module_cartes.CarteDejaFacturee as erreur:
                raise ErreurOreole(str(erreur)) from erreur
            _idc, police = _confirmer(cursor, id_devis)
            emis.append("Santé")
        for cle, id_lie, libelle in (("IA", package["iddevis_ia"], "IA"), ("AFA", package["iddevis_afa"], "AFA")):
            if cle not in choisis or not id_lie:
                continue
            lie = _etat_devis(cursor, id_lie)
            if lie and not lie["Confirme"] and not lie["Archive"]:
                _confirmer(cursor, id_lie, police)
                emis.append(libelle)
        resultat = lire(cursor, id_devis)
        resultat["Emis"] = emis
        return resultat


def package_du_devis(cursor, id_devis):
    """Package dont ce devis est le devis Santé, IA ou AFA."""
    lignes = _lignes(cursor, "SELECT * FROM lephare_oreole_package WHERE iddevis_sante = %s OR iddevis_ia = %s OR iddevis_afa = %s LIMIT 1", [id_devis] * 3)
    return lignes[0] if lignes else None


def package_du_contrat(cursor, id_contrat):
    """Package d'un contrat Santé, IA ou AFA : le dernier émis de la police Santé pour que la fiche montre la composition en vigueur."""
    lignes = _lignes(cursor, """
        SELECT c.iddevis, c.idproduit, c.numeropolice, TRIM(COALESCE(c.numeropoliceconnexe, '')) AS connexe FROM stdcontrat c WHERE c.idcontrat = %s""", [id_contrat])
    if not lignes:
        return None
    c = lignes[0]
    police = c["numeropolice"] if c["idproduit"] == ID_PRODUIT_SANTE else c["connexe"]
    if police:
        package = _package_de_police(cursor, police)
        if package:
            return package
    lies = _lignes(cursor, """SELECT * FROM lephare_oreole_package WHERE iddevis_sante = %s OR iddevis_ia = %s OR iddevis_afa = %s LIMIT 1""", [c["iddevis"]] * 3)
    return lies[0] if lies else None


def emettre_lie(id_contrat, produit, id_utilisateur):
    """Produit lié manquant sur une police émise : devis créé depuis les adhérents, sans ressaisie, puis confirmé."""
    if produit not in ("IA", "AFA"):
        raise ErreurOreole("Produit lié non reconnu.")
    with transaction.atomic(), connection.cursor() as cursor:
        package = package_du_contrat(cursor, id_contrat)
        if not package:
            raise ErreurOreole("Ce contrat n'est pas lié à Oreole Santé.")
        id_devis = package["iddevis_sante"]
        donnees = lire(cursor, id_devis)
        if not donnees["Produits"]["Sante"]["IdContrat"]:
            raise ErreurOreole("Confirmez d'abord le devis Santé.")
        cle_devis = "iddevis_ia" if produit == "IA" else "iddevis_afa"
        id_lie = package[cle_devis]
        lie = _etat_devis(cursor, id_lie)
        if lie and lie["Confirme"]:
            raise ErreurOreole(f"{produit} déjà émise sur cette police.")
        if not (lie and not lie["Archive"]):
            offres = offres_oreole(cursor)
            regles = reglages()
            entete = {"IdClient": donnees["IdClient"], "DateEffet": _date(donnees["DateEffet"]), "DateExpiration": _date(donnees["DateExpiration"]),
                      "NumeroPoliceCompagnie": None, "Regles": regles}
            lignes = []
            for a in donnees["Adherents"]:
                offre = offres[a["IdOffre"]]
                part = offre["partia"] if produit == "IA" else offre["partafa"]
                if part <= 0:
                    continue
                lignes.append({
                    "IdClient": a["IdClient"] or 0, "Nom": a["Nom"], "Prenoms": a["Prenoms"], "DateNaissance": _date(a["DateNaissance"]), "Sexe": a["Sexe"], "Libelle": f"{a['Nom']} {a['Prenoms']}",
                    "PartIA": offre["partia"], "PartAFA": offre["partafa"], "IdOffreIA": offre["idoffreia"], "CapitalIA": offre["capitalia"], "CapitalAFA": offre["capitalafa"],
                    "Beneficiaires": a["Beneficiaires"],
                })
            if not lignes:
                raise ErreurOreole(f"L'offre de ces adhérents ne comprend pas de part {produit}.")
            _identifier_assures(cursor, lignes)
            for ligne in lignes:
                if produit == "IA":
                    ligne["PartAFA"] = ZERO
                else:
                    ligne["PartIA"] = ZERO
            if produit == "IA":
                id_lie, _ttc = _ecrire_ia(cursor, entete, lignes, None, id_utilisateur)
            else:
                id_lie, _ttc = _ecrire_afa(cursor, entete, lignes, None, id_utilisateur)
            cursor.execute(f"UPDATE lephare_oreole_package SET {cle_devis} = %s, datemodification = now() WHERE iddevis_sante = %s", [id_lie, id_devis])
        _confirmer(cursor, id_lie, donnees["Produits"]["Sante"]["NumeroPolice"])
        return lire(cursor, id_devis)


# ------------------------------------------------------------------ liste de l'accueil
def lister_polices(texte="", limite=60):
    motif = f"%{texte}%"
    with connection.cursor() as cursor:
        lignes = _lignes(cursor, """
            SELECT p.iddevis_sante, p.iddevis_ia, p.iddevis_afa, p.cible, p.acte, d.numerodevis, d.idclient, d.primettc, d.dateeffet::date AS dateeffet,
                   d.dateexpiration::date AS dateexpiration, COALESCE(d.confirme, FALSE) AS confirme, COALESCE(d.archive, FALSE) AS archive,
                   TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS client, c.idcontrat, c.numeropolice,
                   (SELECT COUNT(*) FROM lephare_oreole_adherent s WHERE s.iddevis = p.iddevis_sante) AS adherents,
                   (SELECT o.libelle FROM lephare_oreole_offre o WHERE o.idoffre = d.idoffre) AS offre,
                   ia.etat AS etat_ia, ia.ttc AS ttc_ia, afa.etat AS etat_afa, afa.ttc AS ttc_afa
            FROM lephare_oreole_package p
            JOIN stddevis d ON d.iddevis = p.iddevis_sante
            LEFT JOIN stdclient cl ON cl.idclient = d.idclient
            LEFT JOIN LATERAL (SELECT x.idcontrat, x.numeropolice FROM stdcontrat x WHERE x.iddevis = d.iddevis ORDER BY x.idcontrat DESC LIMIT 1) c ON TRUE
            LEFT JOIN LATERAL (SELECT CASE WHEN COALESCE(z.confirme, FALSE) THEN 'EMISE' WHEN COALESCE(z.archive, FALSE) THEN NULL ELSE 'DEVIS' END AS etat, z.primettc AS ttc
                               FROM stddevis z WHERE z.iddevis = p.iddevis_ia) ia ON TRUE
            LEFT JOIN LATERAL (SELECT CASE WHEN COALESCE(z.confirme, FALSE) THEN 'EMISE' WHEN COALESCE(z.archive, FALSE) THEN NULL ELSE 'DEVIS' END AS etat, z.primettc AS ttc
                               FROM stddevis z WHERE z.iddevis = p.iddevis_afa) afa ON TRUE
            WHERE NOT COALESCE(d.archive, FALSE) AND (%s = '' OR TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) ILIKE %s
                  OR d.numerodevis ILIKE %s OR COALESCE(c.numeropolice, '') ILIKE %s)
            ORDER BY p.datemodification DESC
            LIMIT %s""", [texte, motif, motif, motif, limite * 4])
        offres = offres_oreole(cursor)
    # Une ligne par police : son dernier acte (une police renouvelée ou complétée garde son numéro)
    vues, uniques = set(), []
    for l in lignes:
        cle = l["numeropolice"] or f"devis-{l['iddevis_sante']}"
        if cle not in vues:
            vues.add(cle)
            uniques.append(l)
    lignes = uniques
    return {
        "Polices": [{
            "IdDevis": l["iddevis_sante"], "NumeroDevis": l["numerodevis"], "IdContrat": l["idcontrat"], "NumeroPolice": l["numeropolice"], "Client": l["client"],
            "Cible": l["cible"], "Acte": l["acte"], "Offre": l["offre"] or "", "Adherents": l["adherents"], "DateEffet": _iso(l["dateeffet"]), "DateExpiration": _iso(l["dateexpiration"]),
            "Cotisation": _nombre(l["primettc"]) + _nombre(l["ttc_ia"]) + _nombre(l["ttc_afa"]),
            "Sante": "EMISE" if l["confirme"] else "DEVIS", "IA": l["etat_ia"], "AFA": l["etat_afa"],
        } for l in lignes],
        "NombreOffres": len(offres),
    }


# ------------------------------------------------------------------ import du classeur des effectifs
ENTETES = {
    "matricule": "matricule", "nomsetprenoms": "nomcomplet", "nom": "nom", "noms": "nom", "prenom": "prenoms", "prenoms": "prenoms", "statut": "statut",
    "datedenaissance": "naissance", "naissance": "naissance", "option": "option", "cotisation": "cotisation", "cotisationttc": "cotisation", "primettc": "cotisation",
    "primettcsante": "cotisation", "primettcsanteoreole": "cotisation", "primeia": "partia", "primeafa": "partafa", "sexe": "sexe",
    "enfantsenplus": "enfants", "personnes": "personnes", "affections": "affections", "beneficiaires": "beneficiaires",
}


def _norme(texte):
    import unicodedata
    sans_accent = unicodedata.normalize("NFKD", str(texte or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", sans_accent.lower())


def _entete_feuille(feuille):
    for numero, ligne in enumerate(feuille.iter_rows(min_row=1, max_row=15, values_only=True), 1):
        colonnes = {}
        for indice, valeur in enumerate(ligne):
            cle = ENTETES.get(_norme(valeur))
            if cle and cle not in colonnes:
                colonnes[cle] = indice
        if "cotisation" in colonnes and ("nom" in colonnes or "nomcomplet" in colonnes):
            return numero, colonnes
    return None, None


def _offre_de_ligne(offres, cotisation, part_ia, part_afa, option):
    """Offre de la prime du fichier : celle du montant et des parts ; sinon l'offre habituelle de son option, avec une cotisation imposée."""
    par_prix = [o for o in offres.values() if o["cible"] == "E" and o["cotisation"] == cotisation]
    for o in par_prix:
        # Part non donnée par le fichier (None) : celle de l'offre convient
        if part_ia in (None, o["partia"]) and part_afa in (None, o["partafa"]):
            return o, True
    if par_prix:
        return par_prix[0], False
    code = CODE_PAR_OPTION.get(option)
    for o in offres.values():
        if o["code"] == code:
            return o, False
    for o in offres.values():
        if o["code"] == "E436":
            return o, False
    return None, False


def _lire_groupe(feuille, numero_entete, colonnes, offres):
    lignes, anomalies, matricules = [], [], Counter()
    for numero, cellules in enumerate(feuille.iter_rows(min_row=numero_entete + 1, values_only=True), numero_entete + 1):
        def v(cle):
            indice = colonnes.get(cle)
            return cellules[indice] if indice is not None and indice < len(cellules) else None

        premier = _texte(cellules[0] if cellules else "").upper()
        if premier.startswith("TOTAL"):
            break
        if "nomcomplet" in colonnes:
            morceaux = _texte(v("nomcomplet")).split(" ", 1)
            nom, prenoms = morceaux[0], (morceaux[1] if len(morceaux) > 1 else "")
        else:
            nom, prenoms = _texte(v("nom")), _texte(v("prenoms"))
        cotisation_brute = v("cotisation")
        if not nom and not prenoms and cotisation_brute in (None, ""):
            continue
        matricule = _texte(v("matricule"))
        anomalies_ligne = []
        try:
            cotisation = _decimal(cotisation_brute)
        except ErreurOreole:
            cotisation = ZERO
        if cotisation <= 0:
            anomalies_ligne.append("Cotisation absente")
        # Part IA ou AFA : colonne absente ou cellule vide = non donnée, la part de l'offre s'applique (un 0 écrit
        # dans le fichier reste un 0). Lue à 0, elle privait les cases « Émettre » de tout effet sur la cotisation.
        try:
            part_ia, part_afa = _optionnel(v("partia")), _optionnel(v("partafa"))
        except ErreurOreole:
            part_ia, part_afa = None, None
            anomalies_ligne.append("Part IA ou AFA illisible")
        naissance = None
        brute = v("naissance")
        if brute in (None, ""):
            anomalies_ligne.append("Date de naissance vide")
        else:
            try:
                naissance = _date(brute)
            except ErreurOreole:
                anomalies_ligne.append("Date de naissance illisible")
            if naissance and (naissance.year > date.today().year - 16 or naissance.year < 1920):
                anomalies_ligne.append(f"Naissance en {naissance.year}")
                naissance = None
        if not matricule:
            anomalies_ligne.append("Matricule vide")
        elif not re.fullmatch(r"\d{7}", matricule):
            anomalies_ligne.append(f"Matricule à {len(matricule)} caractères")
        if matricule:
            matricules[matricule] += 1
        option = _entier(v("option"))
        offre, exacte = _offre_de_ligne(offres, cotisation, part_ia, part_afa, option)
        if part_ia is None:
            part_ia = offre["partia"] if offre else ZERO
        if part_afa is None:
            part_afa = offre["partafa"] if offre else ZERO
        lignes.append({
            "Feuille": feuille.title, "Ligne": numero, "Matricule": matricule, "Nom": nom, "Prenoms": prenoms, "DateNaissance": _iso(naissance), "DateBrute": str(brute or "")[:20],
            "Sexe": _texte(v("sexe"))[:1].upper(), "Option": option, "Cotisation": _nombre(cotisation), "PartIA": _nombre(part_ia), "PartAFA": _nombre(part_afa),
            "IdOffre": offre["idoffre"] if offre else None, "Offre": offre["libelle"] if offre else "", "PrixOffre": _nombre(offre["cotisation"]) if offre else 0,
            "OffreExacte": exacte,
            # La cotisation du fichier fait foi, même au prix exact d'une offre : pas de surprime d'âge calculée en plus
            "CotisationImposee": _nombre(cotisation),
            "EnfantsEnPlus": _entier(v("enfants")), "Personnes": _entier(v("personnes")), "Affections": _entier(v("affections")), "Beneficiaires": _texte(v("beneficiaires")),
            "Anomalies": anomalies_ligne,
        })
    for ligne in lignes:
        if ligne["Matricule"] and matricules[ligne["Matricule"]] > 1:
            ligne["Anomalies"].append("Matricule en double dans cette feuille")
        for libelle in ligne["Anomalies"]:
            anomalies.append({"Ligne": ligne["Ligne"], "Libelle": libelle})
    return lignes, anomalies


def analyser_classeur(contenu):
    if len(contenu) > TAILLE_FICHIER_MAX:
        raise ErreurOreole("Fichier trop volumineux : 8 Mo au plus.")
    try:
        classeur = load_workbook(io.BytesIO(contenu), data_only=True, read_only=False)
    except (InvalidFileException, OSError, ValueError, KeyError) as erreur:
        raise ErreurOreole("Ce fichier n'est pas un classeur Excel lisible.") from erreur
    groupes, ignorees = [], []
    with connection.cursor() as cursor:
        offres = offres_oreole(cursor)
        if not offres:
            raise ErreurOreole("Les offres Oreole Santé ne sont pas installées : appliquez la migration production 0205.")
        for rang, feuille in enumerate(classeur.worksheets, 1):
            numero_entete, colonnes = _entete_feuille(feuille)
            if not numero_entete:
                ignorees.append(feuille.title)
                continue
            lignes, anomalies = _lire_groupe(feuille, numero_entete, colonnes, offres)
            if not lignes:
                ignorees.append(feuille.title)
                continue
            prix = Counter(l["Cotisation"] for l in lignes)
            hors_offre = sum(1 for l in lignes if not l["OffreExacte"])
            souscripteur = module_afa._souscripteur(cursor, feuille.title)
            groupes.append({
                "Rang": rang, "Feuille": feuille.title, "Lignes": lignes, "Anomalies": anomalies, "Adherents": len(lignes),
                "PrixCourant": prix.most_common(1)[0][0], "HorsOffre": hors_offre, "TotalCotisation": sum(l["Cotisation"] for l in lignes),
                "TotalIA": sum(l["PartIA"] for l in lignes), "TotalAFA": sum(l["PartAFA"] for l in lignes),
                "Souscripteur": souscripteur,
            })
    return {"Groupes": groupes, "Ignorees": ignorees,
            "Totaux": {"Groupes": len(groupes), "Adherents": sum(g["Adherents"] for g in groupes), "Cotisation": sum(g["TotalCotisation"] for g in groupes),
                       "Anomalies": sum(len(g["Anomalies"]) for g in groupes)}}


def modele_classeur():
    classeur = Workbook()
    feuille = classeur.active
    feuille.title = "NOM DE L'ENTREPRISE"
    titres = ["MATRICULE", "NOMS", "PRENOMS", "STATUT", "DATE DE NAISSANCE", "OPTION", "PRIME TTC SANTE", "PRIME IA", "PRIME AFA"]
    feuille.append(titres)
    for cellule in feuille[1]:
        cellule.font = Font(bold=True, color="FFFFFF")
        cellule.fill = PatternFill("solid", fgColor="1E3A5F")
        cellule.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for colonne, largeur in zip("ABCDEFGHI", (13, 24, 30, 9, 16, 9, 16, 11, 11)):
        feuille.column_dimensions[colonne].width = largeur
    sortie = io.BytesIO()
    classeur.save(sortie)
    return sortie.getvalue()


# ------------------------------------------------------------------ préparation d'un renouvellement ou d'une incorporation
def preparation(id_contrat, acte):
    with connection.cursor() as cursor:
        base, package = _base_sante(cursor, id_contrat)
        donnees = lire(cursor, package["iddevis_sante"])
        effet = base["dateexpiration"] + timedelta(days=1)
        retour = {
            "IdContratBase": base["idcontrat"], "NumeroPolice": base["numeropolice"], "Client": base["client"], "IdClient": base["idclient"], "Cible": package["cible"],
            "PeriodeEffet": _iso(base["dateeffet"]), "PeriodeExpiration": _iso(base["dateexpiration"]), "Acte": acte,
            "Adherents": donnees["Adherents"], "IdOffre": donnees["IdOffre"], "PrixFamille": donnees["PrixFamille"], "Carte": donnees["Carte"],
            "IdApporteur": donnees["IdApporteur"], "ApporteurMode": donnees["ApporteurMode"], "ApporteurValeur": donnees["ApporteurValeur"],
        }
        if acte == "REN":
            retour["DateEffet"] = _iso(effet)
            retour["DateExpiration"] = _iso(effet.replace(year=effet.year + 1) - timedelta(days=1))
        else:
            retour["DateEffet"] = _iso(date_emission_du_jour())
            retour["DateExpiration"] = _iso(base["dateexpiration"])
        return retour


# ------------------------------------------------------------------ cartes d'assurance d'une police émise
def _composition_cartes(cursor, package):
    """Familles de la composition en vigueur, chacune avec l'état de ses personnes au registre."""
    composition = lire(cursor, package["iddevis_sante"])["Adherents"]
    familles = [{
        "Rang": rang, "IdAdherentBase": 0, "IdAdherent": a["IdAdherent"], "Nom": a["Nom"], "Prenoms": a["Prenoms"], "DateNaissance": a["DateNaissance"],
        "Personnes": a["Personnes"], "Ayants": a["Ayants"], "IdOffre": a["IdOffre"],
    } for rang, a in enumerate(composition, 1)]
    module_cartes.preparer_lignes(cursor, familles)
    return familles


def cartes_du_contrat(id_contrat):
    with connection.cursor() as cursor:
        package = package_du_contrat(cursor, id_contrat)
        if not package:
            raise ErreurOreole("Ce contrat n'est pas une police Oreole Santé.")
        familles = _composition_cartes(cursor, package)
    personnes = []
    for famille in familles:
        libelle = f"{famille['Nom']} {famille['Prenoms']}".strip()
        for etat in famille["Cartes"]:
            personnes.append({**module_cartes.json_personne(etat), "Famille": libelle})
    return {"Montant": _nombre(reglages()["Carte"]), "Personnes": personnes, "Facturees": sum(1 for p in personnes if p["Historique"])}


def facturer_cartes(id_contrat, donnees, id_utilisateur):
    """
    Carte demandée après l'émission : avenant à la police, quittance du montant des cartes (frais courtiers, rien à reverser).
    Une carte déjà facturée est refusée sans le motif « Renouvellement pour perte ».
    """
    motif = _texte(donnees.get("Motif")).upper()
    choisies = {str(c) for c in donnees.get("Personnes") or []}
    if not choisies:
        raise ErreurOreole("Choisissez au moins une personne.")
    if motif not in (module_cartes.MOTIF_PREMIERE, module_cartes.MOTIF_PERTE):
        raise ErreurOreole("Précisez le motif de la facturation.")
    with transaction.atomic(), connection.cursor() as cursor:
        base, package = _base_sante(cursor, id_contrat)
        # Période pas encore commencée (renouvellement émis à l'avance) : l'avenant prend effet à son début
        jour = max(date_emission_du_jour(), base["dateeffet"])
        if jour > base["dateexpiration"]:
            raise ErreurOreole(f"La période de ce contrat s'est terminée le {base['dateexpiration']:%d/%m/%Y} : facturez la carte sur la police en cours.")
        lignes, trouvees = [], set()
        for famille in _composition_cartes(cursor, package):
            demandes = [e for e in famille["Cartes"] if e["Cle"] in choisies]
            trouvees |= {e["Cle"] for e in demandes}
            for etat in demandes:
                if etat["Historique"] and motif != module_cartes.MOTIF_PERTE:
                    raise ErreurOreole(module_cartes.json_personne(etat)["Alerte"])
                # Perte d'une carte facturée avant ce registre : le motif reste celui que l'utilisateur a choisi
                etat["Etat"] = module_cartes.PERTE if motif == module_cartes.MOTIF_PERTE else module_cartes.A_FACTURER
            if demandes:
                lignes.append({**famille, "IdAdherentBase": famille["IdAdherent"], "Libelle": f"{famille['Nom']} {famille['Prenoms']}".strip(), "Ayants": [], "EnfantsEnPlus": 0,
                               "PartIA": ZERO, "PartAFA": ZERO, "CartesSeules": True, "Cartes": demandes, "CartesAFacturer": len(demandes)})
        if choisies - trouvees:
            raise ErreurOreole("Une personne choisie n'est plus dans la composition de cette police.")
        entete = {
            "Cible": package["cible"], "IdClient": base["idclient"], "DateEffet": jour, "DateExpiration": base["dateexpiration"], "PrixFamille": package["prixfamille"],
            "Carte": True, "IdDevis": 0, "NumeroPoliceCompagnie": None, "IdApporteur": None, "ApporteurMode": "", "ApporteurValeur": ZERO, "Acte": "INC",
            "IdContratBase": base["idcontrat"], "Regles": reglages(), "ObservationCarte": _texte(donnees.get("Observation")),
        }
        id_devis = _enregistrer_incorporation(cursor, entete, lignes, id_utilisateur)
        resultat = emettre(id_devis)
        resultat["CartesFacturees"] = sum(l["CartesAFacturer"] for l in lignes)
        return resultat


# ------------------------------------------------------------------ routes
def _utilisateur(request):
    return getattr(request.user, "id", 0) or 0


def _reponse(fonction, *args, code=status.HTTP_200_OK):
    try:
        return Response(fonction(*args), status=code)
    except ErreurOreole as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except module_afa.ErreurAfa as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except DatabaseError as erreur:
        logger.exception("Oreole Santé : erreur de base")
        return Response({"error": str(erreur).split("\n")[0]}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def referentiels(request):
    def lire_referentiels():
        with connection.cursor() as cursor:
            offres = [offre_json(o) for o in offres_oreole(cursor, actives=True).values()]
            compagnies = _lignes(cursor, "SELECT idcompagnie, raisonsociale FROM stdcompagnie WHERE idcompagnie = ANY(%s)", [[reglages()["CompagnieSante"], reglages()["CompagnieIA"], reglages()["CompagnieAFA"]]])
        regles = _nombres({k: v for k, v in reglages().items() if k != "Carences"})
        return {"Offres": offres, "Reglages": {**regles, "Carences": reglages()["Carences"]},
                "Compagnies": {c["idcompagnie"]: c["raisonsociale"] for c in compagnies}}
    return _reponse(lire_referentiels)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def calcul(request):
    return _reponse(apercu, request.data)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def cartes_verification(request):
    return _reponse(verifier_cartes, request.data)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def cartes_registre(request):
    def lire_registre():
        with connection.cursor() as cursor:
            return {"Lignes": module_cartes.registre(cursor, _texte(request.query_params.get("q")))}
    return _reponse(lire_registre)


@api_view(["GET", "POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def contrat_cartes(request, idcontrat):
    if request.method == "GET":
        return _reponse(cartes_du_contrat, idcontrat)
    return _reponse(facturer_cartes, idcontrat, request.data, _utilisateur(request), code=status.HTTP_201_CREATED)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def devis(request):
    return _reponse(enregistrer, request.data, _utilisateur(request), code=status.HTTP_201_CREATED)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def lecture(request, iddevis):
    def lire_devis():
        with connection.cursor() as cursor:
            return lire(cursor, iddevis)
    return _reponse(lire_devis)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def lien(request, iddevis):
    """Le devis fait-il partie d'un package ? Les écrans Santé, IA et AFA s'en servent pour ouvrir la branche."""
    with connection.cursor() as cursor:
        package = package_du_devis(cursor, iddevis)
    return Response({"Oreole": bool(package), "IdDevis": package["iddevis_sante"] if package else None})


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def emission(request, iddevis):
    return _reponse(emettre, iddevis, request.data.get("Produits"))


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def caisse(request):
    return _reponse(packages_a_encaisser)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def encaissement(request, iddevis):
    """Règlement unique du package : mêmes champs et mêmes contrôles que la caisse, le serveur répartit le montant entre les quittances."""
    from production.views import enregistrer_encaissement

    try:
        montant = Decimal(str(request.data.get("montant_total") or 0))
    except InvalidOperation:
        return Response({"erreur": "Montant du règlement illisible."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        with transaction.atomic(), connection.cursor() as cursor:
            groupes = _quittances_des_packages(cursor, iddevis, verrou=True)
            if not groupes:
                raise ErreurOreole("Aucune quittance émise pour ce package.")
            cursor.execute("""SELECT LOWER(TRIM(libellemodepaiement)), UPPER(TRIM(COALESCE(abregereglement, ''))) FROM stdmodeencaissement
                              WHERE idmodeencaissement = %s""", [_entier(request.data.get("mode_encaissement"))])
            libelle_mode, abrege_mode = cursor.fetchone() or ("", "")
            # Espèces : l'écran les envoie toujours à l'ordre de la compagnie, elles suivent le circuit de la réclamation
            if abrege_mode != "ESP" and (_texte(request.data.get("ordre_reglement")).upper() == "COMPAGNIE" or libelle_mode == "a la compagnie"):
                raise ErreurOreole("Un package Oreole Santé se règle à l'ordre d'OREOLE : le cabinet reverse ensuite la part de chaque compagnie.")
            donnees = {**request.data, "montant_total": str(montant), "liste_quittance": ventiler_reglement(groupes[0]["Quittances"], montant)}
            return enregistrer_encaissement(request.user, donnees)
    except ErreurOreole as erreur:
        return Response({"erreur": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def polices(request):
    return _reponse(lister_polices, _texte(request.query_params.get("q")))


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def contrat(request, idcontrat):
    def lire_contrat():
        with connection.cursor() as cursor:
            package = package_du_contrat(cursor, idcontrat)
            if not package:
                return {"Oreole": False}
            return {"Oreole": True, **lire(cursor, package["iddevis_sante"])}
    return _reponse(lire_contrat)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def contrat_emission(request, idcontrat):
    return _reponse(emettre_lie, idcontrat, _texte(request.data.get("Produit")).upper(), _utilisateur(request))


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def contrat_preparation(request, idcontrat):
    acte = _texte(request.query_params.get("acte")).upper()
    if acte not in ("REN", "INC"):
        return Response({"error": "Acte non reconnu."}, status=status.HTTP_400_BAD_REQUEST)
    return _reponse(preparation, idcontrat, acte)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def analyse_import(request):
    fichier = request.FILES.get("fichier")
    if not fichier:
        return Response({"error": "Choisissez le classeur des effectifs."}, status=status.HTTP_400_BAD_REQUEST)
    return _reponse(analyser_classeur, fichier.read())


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def modele(request):
    reponse = HttpResponse(modele_classeur(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    reponse["Content-Disposition"] = 'attachment; filename="modele_effectif_oreole_sante.xlsx"'
    return reponse
