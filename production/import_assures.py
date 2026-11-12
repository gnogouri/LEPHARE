"""
Module d'importation des assurés en Individuelle Accidents depuis un fichier Excel.

Ce module gère deux formats de fichiers Excel différents et permet d'importer
les assurés et leurs bénéficiaires dans la base de données.
"""

import copy
import logging
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Dict, List, Optional, Tuple

import pandas as pd
from django.db import connection, transaction

from .iautils import unpack_ia_quotation_post_data

"""
Module d'importation des assurés en Individuelle Accidents depuis un fichier Excel.

Ce module gère deux formats de fichiers Excel différents et permet d'importer
les assurés et leurs bénéficiaires dans la base de données.
"""

# Configuration du logger
logger = logging.getLogger(__name__)

# Constantes
DATE_FORMAT = "%d/%m/%Y"  # Format de date attendu dans le fichier Excel
CAPITAL_FIELDS = ["CapitalDeces", "CapitalInfirmite", "CapitalTraitement"]
QUALITE_AYANT_DROIT_INCONNUE = 0
SEXE_MASCULIN = 1
SEXE_FEMININ = 2

# Codes des offres IA CGA
OFFRE_CGA_4K = 156  # CGA - CAPITAL: 4M FCFA
OFFRE_CGA_2K = 154  # CGA - CAPITAL: 2M FCFA
# Codes des offres IA CI ENERGIES
OFFRE_CI_EN_100K = 166
OFFRE_CI_EN_75K = 165
OFFRE_CI_EN_50K = 170
OFFRE_CI_EN_30K = 162
OFFRE_CI_EN_25K = 168
OFFRE_CI_EN_15K = 169
OFFRE_CI_EN_10K = 167
OFFRE_CI_EN_5K = 163
# Codes des offres IA spécifiques (non déterminées par capital/prix)
OFFRE_SPECIFIQUE_PARTICULIER = 173
OFFRE_SPECIFIQUE_GROUPE = 174
# Codes des offres IA standard
OFFRE_STANDARD_PARTICULIER = 6
OFFRE_STANDARD_GROUPE = 7

# Intitulés possibles des colonnes de prime (le modèle 2 d'OREOLE écrit « PRIMES HT/TTC ») : sans
# elle, l'offre CGA (capital + prime) n'était pas reconnue et l'offre de l'écran était appliquée
ALIAS_PRIME_HT = ["Prime HT", "PRIME HT", "PRIMES HT", "Primes HT"]
ALIAS_PRIME_TTC = ["Prime TTC", "PRIME TTC", "PRIMES TTC", "Primes TTC"]
ALIAS_FRAIS_MEDICAUX = ["FRAIS MEDICAUX", "Frais médicaux", "FRAIS MÉDICAUX", "FRAIS DE TRAITEMENT", "Frais de traitement"]
# Colonnes d'en-tête du contrat (modèle 2), contrôlées contre la saisie de l'écran
COLONNES_ENTETE_FICHIER = {
    "Acte": "ACTE",
    "Periode": "PERIODE",
    "Echeance": "DATE D'ECHEANCE",
    "Souscripteur": "SOUSCRIPTEUR",
}

importation_col_list = [
    "Nom",
    "Prenoms",
    "NumeroCNI",
    "DateNaissance",
    "LieuNaissance",
    "Sexe",
    "NumeroTelephone",
    "NumeroMobile",
    "Qualite",
    "Beneficiaire",
    "AdressePostale",
    "AdresseGeographique",
    "Email",
    "CapitalDeces",
    "CapitalInfirmite",
    "CapitalTraitement",
]


class ValidationError(Exception):
    """Exception levée lors d'une erreur de validation des données."""

    pass


# =====================================================================
# FONCTIONS DE VALIDATION ET DE NETTOYAGE
# =====================================================================


def valider_monetaire(valeur, champ: str) -> Decimal:
    """
    Valide et convertit une valeur monétaire en Decimal.

    Args:
        valeur: La valeur à convertir (peut être None, str, int, float, Decimal)
        champ: Le nom du champ (pour les messages d'erreur)

    Returns:
        Decimal: La valeur convertie en Decimal

    Raises:
        ValidationError: Si la valeur n'est pas numérique
    """
    # Cellule vide du fichier : « nan » (pandas), que Decimal accepterait comme un nombre et qui rendrait le devis invalide
    if valeur is None or str(valeur).strip().lower() in ("", "nan"):
        return Decimal("0.00")

    try:
        # Normalisation: remplacement de la virgule par un point
        valeur_str = str(valeur).replace(",", ".").strip()
        montant = Decimal(valeur_str)
    except (InvalidOperation, ValueError) as e:
        raise ValidationError(
            f"Valeur non numérique pour {champ}: '{valeur}' - {str(e)}"
        )
    if not montant.is_finite():
        raise ValidationError(f"Valeur non numérique pour {champ}: '{valeur}'")
    return montant


def montant_facultatif(row, aliases, champ: str) -> Decimal:
    """Colonne lue en complément (primes des modèles 1 et 3, frais médicaux) : une cellule non numérique compte pour 0 au lieu de refuser
    tout l'import, comme avant que ces colonnes soient lues."""
    try:
        return valider_monetaire(get_col_value(row, aliases) or 0.0, champ)
    except ValidationError:
        return Decimal("0.00")


def valider_entier(valeur, champ: str, defaut: int = 0) -> int:
    """
    Valide et convertit une valeur en entier.

    Args:
        valeur: La valeur à convertir
        champ: Le nom du champ (pour les messages d'erreur)
        defaut: Valeur par défaut si la valeur est vide

    Returns:
        int: La valeur convertie

    Raises:
        ValidationError: Si la valeur n'est pas un entier valide
    """
    if valeur is None or str(valeur).strip() == "":
        return defaut

    try:
        valeur_str = str(valeur).strip().replace(",", ".")
        # Gère les nombres décimaux en les arrondissant
        return int(float(valeur_str))
    except (ValueError, TypeError, OverflowError) as e:
        raise ValidationError(
            f"Valeur non entière pour {champ}: '{valeur}' - {str(e)}"
        )


def nettoyer_chaine(valeur: str, mise_en_majuscule: bool = True) -> str:
    """
    Nettoie et normalise une chaîne de caractères.

    Args:
        valeur: La chaîne à nettoyer
        mise_en_majuscule: Si True, applique upper() sur chaque mot

    Returns:
        str: La chaîne nettoyée
    """
    if valeur is None or str(valeur).strip() == "":
        return ""

    # Suppression des espaces multiples et normalisation
    chaine_nettoyee = " ".join(str(valeur).strip().split())

    if mise_en_majuscule:
        return chaine_nettoyee.upper()

    return chaine_nettoyee


def valider_date(date_valeur, champ: str = "Date") -> Optional[datetime.date]:
    """
    Valide une date selon le format régional attendu.

    Args:
        date_valeur: La valeur de date à valider
        champ: Le nom du champ (pour les messages d'erreur)

    Returns:
        datetime.date ou None: La date convertie ou None si vide

    Raises:
        ValidationError: Si la date n'est pas au format attendu
    """
    if date_valeur is None or str(date_valeur).strip() == "":
        return None
    from .iautils import convert_to_date

    try:
        date_str = str(date_valeur).strip()
        return convert_to_date(date_str)
    except (ValueError, TypeError) as e:
        raise ValidationError(
            f"Date invalide pour {champ}: '{date_valeur}'. "
            f"Erreur: {str(e)}"
        )


def valider_email(email: str) -> str:
    """
    Valide le format d'une adresse email.

    Args:
        email: L'adresse email à valider

    Returns:
        str: L'email nettoyé (ou chaîne vide si invalide/vide)
    """
    if not email or str(email).strip() == "":
        return ""

    email_nettoye = str(email).strip().lower()

    # Pattern basique de validation d'email
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"

    if re.match(pattern, email_nettoye):
        return email_nettoye
    else:
        logger.warning(f"Format d'email invalide: {email}")
        return ""


def valider_sexe(sexe: str) -> str:
    """
    Valide et normalise le sexe.

    Args:
        sexe: Le sexe à valider (M, F, Masculin, Féminin, etc.)

    Returns:
        str: 'M' ou 'F'

    Raises:
        ValidationError: Si le sexe n'est pas reconnu
    """
    if not sexe or str(sexe).strip() == "":
        raise ValidationError("Le sexe est obligatoire")

    sexe_normalise = str(sexe).strip().upper()

    # Accepte différentes variantes
    if sexe_normalise in ["M", "MASCULIN", "HOMME", "H"]:
        return "M"
    elif sexe_normalise in ["F", "FEMININ", "FÉMININ", "FEMME"]:
        return "F"
    else:
        raise ValidationError(
            f"Sexe non reconnu: '{sexe}'. Valeurs acceptées: M, F, Masculin, Féminin"
        )


def valider_parts_beneficiaires(beneficiaires: List[Dict]) -> None:
    """
    Valide les parts des bénéficiaires : quand l'assuré en a précisé (part > 0), leur somme doit
    faire 100 % ; quand aucune n'est précisée, les bénéficiaires restent sans part.

    Args:
        beneficiaires: Liste des bénéficiaires avec leurs parts

    Raises:
        ValidationError: Si des parts sont précisées et que leur somme n'est pas égale à 100 %
    """
    if not beneficiaires:
        return

    parts = [Decimal(str(ben.get("Part") or 0)) for ben in beneficiaires]
    if not any(parts):
        return
    total_parts = sum(parts)

    if total_parts != Decimal("100.00"):
        raise ValidationError(
            f"La somme des parts des bénéficiaires doit être égale à 100%. "
            f"Somme actuelle: {total_parts}%"
        )


# =====================================================================
# FONCTIONS UTILITAIRES
# =====================================================================


def get_col_value(row: pd.Series, aliases: List[str]):
    """
    Retourne la valeur d'une colonne en testant plusieurs alias possibles.

    Args:
        row: La ligne pandas
        aliases: Liste des noms de colonnes possibles

    Returns:
        La valeur de la première colonne trouvée, ou None

    Example:
        >>> get_col_value(row, ["CapitalDeces", "CAPITAL DECES"])
    """
    for alias in aliases:
        if alias in row and pd.notna(row[alias]):
            return row[alias]
    return None


def determiner_offre(capital_deces, prime_ttc=0, categorie="") -> int:
    """
    Détermine l'ID de l'offre en fonction du Capital Décès et de la Prime TTC.

    Args:
        capital_deces: Le capital décès
        prime_ttc: La prime TTC

    Returns:
        int: L'ID de l'offre (0 si aucune correspondance)

    TODO:

        Je dois penser à l'utilisation d'une table de configuration en base de données.
    """
    if categorie:
        categorie = categorie.strip()

    if capital_deces is None or (prime_ttc is None and categorie is None):
        return 0
    try:
        cap = Decimal(str(capital_deces).replace(",", "."))
        prime = Decimal(str(prime_ttc).replace(",", "."))
    except (InvalidOperation, TypeError, ValueError):
        logger.warning(
            f"Impossible de déterminer l'offre: capital={capital_deces}, prime={prime_ttc}"
        )
        return 0
    if categorie is None or categorie == "":
        if cap == Decimal("4000000") and prime == Decimal("17000"):
            return OFFRE_CGA_4K
        elif cap == Decimal("2000000") and prime == Decimal("6000"):
            return OFFRE_CGA_2K
        else:
            logger.info(
                f"Aucune offre correspondante pour capital={cap}, prime={prime}"
            )
            return 0
    else:  # CI ENERGIES
        if cap == Decimal("100000000"):
            return OFFRE_CI_EN_100K
        elif cap == Decimal("75000000"):
            return OFFRE_CI_EN_75K
        elif cap == Decimal("50000000"):
            return OFFRE_CI_EN_50K
        elif cap == Decimal("30000000"):
            return OFFRE_CI_EN_30K
        elif cap == Decimal("25000000"):
            return OFFRE_CI_EN_25K
        elif cap == Decimal("15000000"):
            return OFFRE_CI_EN_15K
        elif cap == Decimal("10000000"):
            return OFFRE_CI_EN_10K
        elif cap == Decimal("5000000"):
            return OFFRE_CI_EN_5K
        else:
            logger.info(
                f"Aucune offre correspondante pour capital={cap}, prime={prime}"
            )
            return 0


# Part précisée en fin de nom : « 50% », « 50 % », « (33,5%) »
MOTIF_PART_PRECISEE = re.compile(r"\(?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*%\s*\)?\s*$")


def traiter_ayants_droit(chaine):
    """
    Traite une chaîne contenant des ayants-droits séparés par '/'.
    Retourne une liste de dictionnaires avec 'Nom', 'Prenoms' et 'Part'.
    """
    chaine = nettoyer_chaine(chaine)
    if chaine in (
        "AYANT DROIT",
        "AYANT-DROIT",
        "AYANTS DROIT",
        "AYANTS-DROIT",
        "AYANTS DROITS",
        "AYANTS-DROITS",
        "AYANTS",
    ):
        return []
    # 1. Découper la chaîne en liste
    ayants_droit = chaine.split("/")

    # 2. Nettoyer les espaces superflus
    ayants_droit = [ayant.strip() for ayant in ayants_droit if ayant.strip()]

    # 3. Transformer chaque ayant-droit en dictionnaire {nom, prenoms, part}. La part n'est retenue que
    #    si le fichier la précise (ex. « KOUAME JEAN 50% ») : sinon le bénéficiaire reste sans part
    #    (0 en base), au lieu d'une répartition à parts égales que l'assuré n'a pas demandée.
    resultats = []
    for ayant in ayants_droit:
        part = 0
        precisee = MOTIF_PART_PRECISEE.search(ayant)
        if precisee:
            part = float(precisee.group(1).replace(",", "."))
            ayant = ayant[: precisee.start()].strip()
        morceaux = ayant.split()
        if not morceaux:
            continue
        nom = morceaux[0]
        prenoms = " ".join(morceaux[1:]) if len(morceaux) > 1 else ""
        resultats.append({"Nom": nom, "Prenoms": prenoms, "Part": part})

    return resultats


# =====================================================================
# EXTRACTION DES DONNÉES DEPUIS EXCEL
# =====================================================================


def est_ligne_blanche(row: pd.Series) -> bool:
    """
    Détermine si une ligne est considérée comme vide/blanche.

    Args:
        row: La ligne pandas à vérifier

    Returns:
        bool: True si la ligne est vide
    """
    # Récupération des valeurs de nom selon le modèle de fichier
    nom = (
        str(
            get_col_value(row, ["Nom", "NOMS ET PRENOMS", "Nom et prénoms"])
            or ""
        )
        .strip()
        .lower()
    )
    prenoms = str(row.get("Prenoms", "")).strip().lower()

    valeurs_vides = {"", "na", "n/a", "n-a", "nan"}

    return nom in valeurs_vides and prenoms in valeurs_vides


def extraire_modele_1(df: pd.DataFrame) -> List[Dict]:
    """
    Extrait les assurés du fichier Excel de type Modèle 1.

    Modèle 1: Lignes d'assurés (Qualite='A') suivies de leurs bénéficiaires (Qualite='B')

    Args:
        df: Le DataFrame pandas

    Returns:
        List[Dict]: Liste des assurés avec leurs bénéficiaires

    Raises:
        ValidationError: Si les données sont invalides
    """
    assures = []
    current_assure = None
    numero_ligne = 2  # Ligne 1 = en-tête

    for _, row in df.iterrows():
        try:
            qualite = str(row.get("Qualite", "")).strip().upper()

            if qualite == "A":  # Assuré
                # Validation des champs obligatoires
                nom = nettoyer_chaine(row.get("Nom", ""))
                prenoms = nettoyer_chaine(row.get("Prenoms", ""))

                if not nom or not prenoms:
                    raise ValidationError(
                        f"Ligne {numero_ligne}: Nom et Prénoms sont obligatoires pour un assuré"
                    )

                sexe = valider_sexe(row.get("Sexe", ""))

                current_assure = {
                    "NumeroLigne": numero_ligne,
                    "Nom": nom,
                    "Prenoms": prenoms,
                    "NumeroCNI": nettoyer_chaine(
                        row.get("NumeroCNI", ""), mise_en_majuscule=False
                    ),
                    "DateNaissance": valider_date(
                        row.get("DateNaissance"), "DateNaissance"
                    ),
                    "LieuNaissance": nettoyer_chaine(
                        row.get("LieuNaissance", "")
                    ),
                    "Sexe": sexe,
                    "NumeroTelephone": nettoyer_chaine(
                        row.get("NumeroTelephone", ""), mise_en_majuscule=False
                    ),
                    "NumeroMobile": nettoyer_chaine(
                        row.get("NumeroMobile", ""), mise_en_majuscule=False
                    ),
                    "AdressePostale": nettoyer_chaine(
                        row.get("AdressePostale", "")
                    ),
                    "AdresseGeographique": nettoyer_chaine(
                        row.get("AdresseGeographique", "")
                    ),
                    "Email": valider_email(row.get("Email", "")),
                    "CapitalDeces": valider_monetaire(
                        row.get("CapitalDeces"), "CapitalDeces"
                    ),
                    "CapitalInfirmite": valider_monetaire(
                        row.get("CapitalInfirmite"), "CapitalInfirmite"
                    ),
                    "CapitalTraitement": valider_monetaire(
                        row.get("CapitalTraitement"), "CapitalTraitement"
                    ),
                    "Offre": row.get("Offre", 0),
                    "Fonction": nettoyer_chaine(
                        get_col_value(row, ["Fonction", "FONCTION", "fonction"]) or ""
                    ),
                    # Primes du fichier quand il en porte (gardées puis réappliquées exactement, production/ia_montants_imposes.py)
                    "PrimeHT": montant_facultatif(row, ALIAS_PRIME_HT, "PRIME HT"),
                    "Accessoire": Decimal("0.00"),
                    "PrimeTTC": montant_facultatif(row, ALIAS_PRIME_TTC, "PRIME TTC"),
                    "Beneficiaires": [],
                }

                assures.append(current_assure)

            elif qualite == "B":  # Bénéficiaire
                if current_assure is None:
                    raise ValidationError(
                        f"Ligne {numero_ligne}: Bénéficiaire trouvé sans assuré associé"
                    )

                nom_beneficiaire = nettoyer_chaine(row.get("Nom", ""))

                if not nom_beneficiaire:
                    raise ValidationError(
                        f"Ligne {numero_ligne}: Le nom du bénéficiaire est obligatoire"
                    )

                beneficiaire = {
                    "Nom": nom_beneficiaire,
                    "Prenoms": nettoyer_chaine(row.get("Prenoms", "")),
                    "Lien": valider_entier(
                        row.get("Lien"),
                        "Lien",
                        defaut=QUALITE_AYANT_DROIT_INCONNUE,
                    ),
                    "Part": valider_monetaire(row.get("Part", 0.0), "Part"),
                }

                current_assure["Beneficiaires"].append(beneficiaire)

            elif qualite:  # Qualité non reconnue
                logger.warning(
                    f"Ligne {numero_ligne}: Qualité non reconnue '{qualite}' - ligne ignorée"
                )

        except ValidationError as e:
            raise ValidationError(f"Ligne {numero_ligne}: {str(e)}")

        numero_ligne += 1

    # Validation des parts pour chaque assuré
    for assure in assures:
        try:
            valider_parts_beneficiaires(assure["Beneficiaires"])
        except ValidationError as e:
            raise ValidationError(
                f"Assuré '{assure['Nom']} {assure['Prenoms']}' (ligne {assure['NumeroLigne']}): {str(e)}"
            )

    return assures


def extraire_modele_2(df: pd.DataFrame) -> List[Dict]:
    """
    Extrait les assurés du fichier Excel de type Modèle 2.

    Modèle 2: Une ligne par assuré avec un seul bénéficiaire dans la colonne BENEFICIAIRES

    Args:
        df: Le DataFrame pandas

    Returns:
        List[Dict]: Liste des assurés avec leurs bénéficiaires

    Raises:
        ValidationError: Si les données sont invalides
    """
    assures = []
    numero_ligne = 2  # Ligne 1 = en-tête

    for _, row in df.iterrows():
        try:
            nom_complet = nettoyer_chaine(row.get("NOMS ET PRENOMS", ""))

            if not nom_complet:
                raise ValidationError("Le nom est obligatoire pour un assuré")

            # Tentative de séparation nom/prénoms (au cas où)
            parties = nom_complet.split(maxsplit=1)
            nom = parties[0] if len(parties) > 0 else nom_complet
            prenoms = parties[1] if len(parties) > 1 else ""

            assure = {
                "NumeroLigne": numero_ligne,
                "Nom": nom,
                "Prenoms": prenoms,
                "NumeroCNI": "",
                "DateNaissance": valider_date(
                    row.get("DATE DE NAISSANCE"), "DATE DE NAISSANCE"
                ),
                "LieuNaissance": "",
                "Sexe": "",  # Non disponible dans ce modèle
                "NumeroTelephone": "",
                "NumeroMobile": "",
                "AdressePostale": "",
                "AdresseGeographique": "",
                "Email": "",
                "Fonction": nettoyer_chaine(
                    get_col_value(row, ["FONCTION", "Fonction", "fonction"]) or ""
                ),
                "CapitalDeces": valider_monetaire(
                    row.get("CAPITAL DECES"), "CAPITAL DECES"
                ),
                "CapitalInfirmite": valider_monetaire(row.get("IPT"), "IPT"),
                "CapitalTraitement": montant_facultatif(row, ALIAS_FRAIS_MEDICAUX, "FRAIS MEDICAUX"),
                "PrimeHT": valider_monetaire(
                    get_col_value(row, ALIAS_PRIME_HT) or 0.0, "PRIME HT"
                ),
                "Accessoire": Decimal("0.00"),
                "PrimeTTC": valider_monetaire(
                    get_col_value(row, ALIAS_PRIME_TTC) or 0.0, "PRIME TTC"
                ),
                "Offre": row.get("Offre", 0),
                "Beneficiaires": [],
                # En-tête du contrat porté par le fichier (contrôlé contre l'écran à l'import)
                "EnteteFichier": {
                    cle: row.get(colonne) for cle, colonne in COLONNES_ENTETE_FICHIER.items()
                    if colonne in row and pd.notna(row.get(colonne))
                },
            }

            # Ajout des bénéficiaires si présents
            beneficiaires = traiter_ayants_droit(row.get("BENEFICIAIRES", ""))
            if beneficiaires:
                for beneficiaire in beneficiaires:
                    beneficiaire["Lien"] = QUALITE_AYANT_DROIT_INCONNUE
                    assure["Beneficiaires"].append(beneficiaire)

            assures.append(assure)

        except ValidationError as e:
            raise ValidationError(f"Ligne {numero_ligne}: {str(e)}")

        numero_ligne += 1

    return assures


def extraire_modele_3(df: pd.DataFrame) -> List[Dict]:
    """
    Extrait les assurés du fichier Excel de type Modèle 3.

    Modèle 2: Une ligne par assuré avec indication du matricule et de la catégorie

    Args:
        df: Le DataFrame pandas

    Returns:
        List[Dict]: Liste des assurés sans leurs bénéficiaires

    Raises:
        ValidationError: Si les données sont invalides
    """
    assures = []
    numero_ligne = 2  # Ligne 1 = en-tête

    for _, row in df.iterrows():
        try:
            nom_complet = nettoyer_chaine(row.get("Nom et prénoms", ""))

            if not nom_complet:
                raise ValidationError("Le nom est obligatoire pour un assuré")

            # Tentative de séparation nom/prénoms (au cas où)
            parties = nom_complet.split(maxsplit=1)
            nom = parties[0] if len(parties) > 0 else nom_complet
            prenoms = parties[1] if len(parties) > 1 else ""

            assure = {
                "NumeroLigne": numero_ligne,
                "Nom": nom,
                "Prenoms": prenoms,
                "NumeroCNI": "",
                "DateNaissance": valider_date(
                    row.get("Date de naissance"), "Date de naissance"
                ),
                "LieuNaissance": "",
                "Sexe": "",  # Non disponible dans ce modèle
                "NumeroTelephone": "",
                "NumeroMobile": "",
                "AdressePostale": "",
                "AdresseGeographique": "",
                "Email": "",
                "Fonction": nettoyer_chaine(
                    get_col_value(row, ["Fonction", "FONCTION", "fonction"]) or ""
                ),
                "CapitalDeces": valider_monetaire(
                    row.get("Capitaux Décès"), "Capitaux Décès"
                ),
                "CapitalInfirmite": valider_monetaire(
                    row.get("Capitaux IPT"), "Capitaux IPT"
                ),
                "CapitalTraitement": Decimal("0.00"),
                # Primes lues si le fichier en porte (souvent absentes de ce modèle : forfait de la catégorie)
                "PrimeHT": montant_facultatif(row, ALIAS_PRIME_HT, "PRIME HT"),
                "Accessoire": Decimal("0.00"),
                "PrimeTTC": montant_facultatif(row, ALIAS_PRIME_TTC, "PRIME TTC"),
                "Offre": row.get("Offre", 0),
                "Beneficiaires": [],
            }

            # Pas de bénéficiares dans ce modèles

            assures.append(assure)

        except ValidationError as e:
            raise ValidationError(f"Ligne {numero_ligne}: {str(e)}")

        numero_ligne += 1

    return assures


def lire_formulaire_oreole(filepath: str) -> Optional[pd.DataFrame]:
    """
    Formulaire « Assurance Individuelle Accidents » d'OREOLE (questionnaire prospect rempli par le client) : titre
    puis en-tête sur deux lignes (N°, NOM ET PRENOMS, DATE DE NAISSANCE, PROFESSION, CAPITAUX DECES / IPT), une
    personne par ligne. Renvoie les colonnes du modèle 3 (Nom et prénoms, Date de naissance, Fonction, Capitaux
    Décès, Capitaux IPT), ou None si le fichier n'est pas à ce format.
    """
    import unicodedata
    from itertools import zip_longest

    import openpyxl

    def norme(valeur):
        texte = unicodedata.normalize("NFD", str(valeur or "")).encode("ascii", "ignore").decode("ascii")
        return re.sub(r"\s+", " ", texte).strip().lower()

    try:
        classeur = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
    except Exception:  # noqa: BLE001 - fichier illisible : la lecture pandas donnera le message d'erreur
        return None
    try:
        for feuille in classeur.worksheets:
            lignes = [list(l) for l in feuille.iter_rows(values_only=True)]
            for n in range(min(len(lignes) - 1, 30)):
                haut, bas = [norme(c) for c in lignes[n]], [norme(c) for c in lignes[n + 1]]
                cumul = [f"{a} {b}".strip() for a, b in zip_longest(haut, bas, fillvalue="")]
                if n == 0 or not any("naissance" in c for c in cumul) or not any("nom" in c and "pren" in c for c in cumul):
                    continue
                index = {}
                for k, c in enumerate(cumul):
                    if "nom" in c and "pren" in c:
                        index.setdefault("nom", k)
                    elif "naissance" in c:
                        index.setdefault("naissance", k)
                    elif "profession" in c or "fonction" in c:
                        index.setdefault("fonction", k)
                    elif "deces" in c:
                        index.setdefault("deces", k)
                    elif "ipt" in c or "invalidite" in c or "incapacite" in c:
                        index.setdefault("ipt", k)
                if "nom" not in index:
                    continue

                def valeur(ligne, cle):
                    k = index.get(cle)
                    return ligne[k] if k is not None and k < len(ligne) else None

                personnes = [
                    {"Nom et prénoms": str(valeur(l, "nom")).strip(), "Date de naissance": valeur(l, "naissance"),
                     "Fonction": valeur(l, "fonction") or "", "Capitaux Décès": valeur(l, "deces") or 0,
                     "Capitaux IPT": valeur(l, "ipt") or 0}
                    for l in lignes[n + 2:] if str(valeur(l, "nom") or "").strip()
                ]
                return pd.DataFrame(personnes, columns=["Nom et prénoms", "Date de naissance", "Fonction", "Capitaux Décès", "Capitaux IPT"])
        return None
    finally:
        classeur.close()


def extraire_assures(filepath: str, id_offre: int = 0) -> List[Dict]:
    """
    Lit le fichier Excel, détecte le format, et extrait les assurés.

    Cette fonction gère automatiquement les deux modèles de fichiers Excel.

    Args:
        filepath: Chemin vers le fichier Excel
        id_offre: Identifiant de l'offre

    Returns:
        List[Dict]: Liste des assurés normalisés avec leurs bénéficiaires

    Raises:
        ValidationError: Si le fichier est invalide ou mal formaté
        FileNotFoundError: Si le fichier n'existe pas
    """
    try:
        # Lecture du fichier Excel (formulaire OREOLE du questionnaire prospect : en-tête sous le titre)
        formulaire = lire_formulaire_oreole(filepath)
        df = formulaire if formulaire is not None else pd.read_excel(filepath)

        # Nettoyage des noms de colonnes
        df.columns = [col.strip() for col in df.columns]

        logger.info(
            f"Fichier Excel chargé: {len(df)} lignes, colonnes: {list(df.columns)}"
        )

        # Filtrage des lignes blanches
        df = df[~df.apply(est_ligne_blanche, axis=1)]
        df = df.dropna(how="all")

        logger.info(f"Après filtrage des lignes vides: {len(df)} lignes")

        if df.empty:
            raise ValidationError(
                "Le fichier ne contient aucune donnée valide"
            )

        # Remplacer les NaN par une chaîne vide
        if "Catégorie" in df.columns:
            df["Catégorie"] = df["Catégorie"].fillna("")

        # Colonnes d'en-tête du contrat fusionnées sur toutes les lignes (modèle 2 : acte,
        # période, échéance, souscripteur) : la valeur n'est lue que sur la première ligne
        for colonne in COLONNES_ENTETE_FICHIER.values():
            if colonne in df.columns:
                df[colonne] = df[colonne].ffill()

        # Création de la colonne 'Offre' (si elle n'existe pas)
        if id_offre in (
            OFFRE_STANDARD_PARTICULIER,
            OFFRE_STANDARD_GROUPE,
            OFFRE_SPECIFIQUE_PARTICULIER,
            OFFRE_SPECIFIQUE_GROUPE,
        ):
            df["Offre"] = id_offre
            logger.info(f"Colonne 'Offre' ajoutée avec la valeur: {id_offre}")
        elif "Offre" not in df.columns:
            if "Catégorie" in df.columns:
                df["Offre"] = df.apply(
                    lambda row: determiner_offre(
                        get_col_value(
                            row,
                            [
                                "CapitalDeces",
                                "CAPITAL DECES",
                                "Capitaux Décès",
                            ],
                        ),
                        0,  # Prime TTC non indiquée dans le fichier Excel mais connu dans le paramétrage de l'application
                        get_col_value(row, ["Catégorie"]),
                    ),
                    axis=1,
                )
            else:
                df["Offre"] = df.apply(
                    lambda row: determiner_offre(
                        get_col_value(
                            row,
                            [
                                "CapitalDeces",
                                "CAPITAL DECES",
                                "Capitaux Décès",
                            ],
                        ),
                        get_col_value(row, ALIAS_PRIME_TTC),
                        None,
                    ),
                    axis=1,
                )

        # Détection du format de fichier
        if "Qualite" in df.columns:
            logger.info("Format détecté: Modèle 1 (avec colonne Qualite)")
            assures = extraire_modele_1(df)
        elif "NOMS ET PRENOMS" in df.columns and "BENEFICIAIRES" in df.columns:
            logger.info(
                "Format détecté: Modèle 2 (NOMS ET PRENOMS / BENEFICIAIRES)"
            )
            assures = extraire_modele_2(df)
        elif (
            "Matricule" in df.columns
            and "Nom et prénoms" in df.columns
            and "Catégorie" in df.columns
        ):
            logger.info(
                "Format détecté: Modèle 3 (Matricule / Nom et prénoms / Catégorie)"
            )
            assures = extraire_modele_3(df)
        elif formulaire is not None:
            logger.info("Format détecté: formulaire Individuelle Accidents d'OREOLE (questionnaire prospect)")
            assures = extraire_modele_3(df)
        else:
            raise ValidationError(
                f"Format de fichier non reconnu. Colonnes trouvées: {list(df.columns)}"
            )

        logger.info(f"Extraction réussie: {len(assures)} assurés trouvés")

        return assures

    except FileNotFoundError:
        raise FileNotFoundError(f"Fichier non trouvé: {filepath}")
    except pd.errors.EmptyDataError:
        raise ValidationError("Le fichier Excel est vide")
    except Exception as e:
        logger.error(f"Erreur lors de l'extraction: {str(e)}", exc_info=True)
        raise ValidationError(
            f"Erreur lors de la lecture du fichier Excel: {str(e)}"
        )


def insert_new_assure(donnee_assure):
    """
    Crée un nouvel assuré dans la base de données.

    ✅ AMÉLIORATION : Accepte maintenant cle_unique et numero_assure
    pour éviter que le trigger PostgreSQL ne régénère ces valeurs.

    Args:
        donnee_assure: Dictionnaire contenant les données de l'assuré
                       Peut inclure 'cle_unique' et 'numero_assure'

    Returns:
        Client: L'objet Client créé
    """
    from configuration_api.models import TypeAssure
    from customer.models import Client

    typeassure = TypeAssure.objects.get(pk=1)
    numerocompte = "NUMERO-COMPTE"
    creecie = "V"
    datenaissance = donnee_assure.get("DateNaissance")
    lieunaissance = donnee_assure.get("LieuNaissance", "")
    statut = "V"
    numerocni = donnee_assure.get("NumeroCNI", "")
    particulier = "V"
    email = donnee_assure.get("Email", "")
    idprofession = 12

    # Gestion du sexe : sans sexe dans le fichier, civilité non renseignée (« Monsieur » par
    # défaut se trompait pour les femmes et faisait prendre l'assuré pour un homonyme au
    # prochain import)
    sexe = donnee_assure.get("Sexe", "")
    if sexe == "M":
        idqualite = SEXE_MASCULIN
    elif sexe == "F":
        idqualite = SEXE_FEMININ
    else:
        idqualite = None

    telephone = donnee_assure.get("NumeroTelephone", "")
    mobile = donnee_assure.get("NumeroMobile", "")
    adresse1 = donnee_assure.get("AdressePostale", "")
    adresse2 = donnee_assure.get("AdresseGeographique", "")
    vip = "V"
    fonction = donnee_assure.get("Fonction", "")
    prenoms = donnee_assure.get("Prenoms", "")
    nom = donnee_assure.get("Nom")

    # ✅ AMÉLIORATION : Récupérer cle_unique et numero_assure
    cle_unique = donnee_assure.get("cle_unique")
    numero_assure = donnee_assure.get("numero_assure")

    # Préparer les données de création
    creation_data = {
        "Nom": nom,
        "Prenoms": prenoms,
        "Vip": vip,
        "Adresse1": adresse1,
        "Adresse2": adresse2,
        "Telephone": telephone,
        "Mobile": mobile,
        "IdQualite": idqualite,
        "IdProfession": idprofession,
        "Email": email,
        "Particulier": particulier,
        "CniPat": numerocni,
        "Statut": statut,
        "DateNaissance": datenaissance,
        "LieuNaissance": lieunaissance,
        "CreeCie": creecie,
        "NumeroCompte": numerocompte,
        "idtypeassure": typeassure,
        "Fonction": fonction,
    }

    # ✅ AMÉLIORATION : Ajouter cle_unique si fournie
    # Cela empêche le trigger de la régénérer
    if cle_unique:
        creation_data["cle_unique"] = cle_unique

    # ✅ AMÉLIORATION : Ajouter NumeroAssure si fourni
    # (utilisé en cas d'homonymie)
    if numero_assure:
        creation_data["numero_assure"] = numero_assure

    # Créer l'assuré
    assure = Client.objects.create(**creation_data)

    return assure


def get_entete_devis(request_post_data: dict, flotte: bool = True) -> dict:
    """
    Prépare l'en-tête du devis.

    Args:
        request_post_data: Données de la requête POST
        flotte: True si c'est une flotte (plusieurs assurés)

    Returns:
        dict: En-tête du devis
    """

    entete_devis = copy.deepcopy(request_post_data)
    entete_devis["IdDevis"] = entete_devis.get("IdDevis", 0)
    entete_devis["IdProduit"] = 2
    entete_devis["IdProfession"] = 0
    entete_devis["Flotte"] = flotte
    entete_devis["Coassurance"] = False
    entete_devis["IdDevisDetail"] = 0
    entete_devis["CodeActivite"] = "01"

    return entete_devis


def enregistrer_devis_ia(
    entete_devis: dict, assure: dict, id_assure: int, lignes_existantes: dict = None
) -> int:
    """
    Enregistre le devis en Individuelle Accidents.

    Args:
        entete_devis: En-tête du devis
        assure: Données de l'assuré
        id_assure: ID de l'assuré

    Returns:
        int: ID du devis créé
    """
    try:
        id_devis = 0
        donnee_devis = copy.deepcopy(entete_devis)
        # Import dans un devis d'incorporation : pas d'une personne déjà assurée sous la police
        if int(donnee_devis.get("IdDevis") or 0):
            from .incorporation import controler_assure_incorpore

            with connection.cursor() as cursor:
                controler_assure_incorpore(cursor, int(donnee_devis["IdDevis"]), id_assure, assure.get("Nom") or id_assure)
        donnee_devis["IdAssure"] = id_assure
        donnee_devis["CapitalDeces"] = assure["CapitalDeces"]
        donnee_devis["CapitalIpp"] = assure["CapitalInfirmite"]
        donnee_devis["FraisTraitement"] = assure["CapitalTraitement"]
        donnee_devis["DateNaissance"] = assure["DateNaissance"]
        donnee_devis["AdresseGeographique"] = assure.get(
            "AdresseGeographique", ""
        )
        donnee_devis["PrimeNette"] = assure.get("PrimeHT", 0)
        donnee_devis["Accessoire"] = assure.get("Accessoire", 0)
        donnee_devis["PrimeTTC"] = assure.get("PrimeTTC", 0)

        if assure["Offre"] != 0:
            donnee_devis["IdOffre"] = assure["Offre"]

        # Assuré déjà inscrit au devis avant l'import (renouvellement : lignes recopiées du contrat ; même fichier importé deux fois) : sa ligne
        # est mise à jour, sp_enregistrement_assure_ia refusant une seconde ligne (« Cet assuré est déjà enregistré dans ce devis ! »). Ligne
        # reprise une seule fois : une personne en double dans le fichier reste refusée.
        matricule = str(id_assure).zfill(20)
        if lignes_existantes and matricule in lignes_existantes:
            from .ia_montants_imposes import _decimal, oublier_si_change

            donnee_devis["IdDevisDetail"] = lignes_existantes.pop(matricule)
            # Montant reconduit du contrat : il tombe si le fichier change les capitaux, l'offre ou la prime
            with connection.cursor() as cursor:
                oublier_si_change(cursor, int(donnee_devis["IdDevis"]), matricule, _decimal(assure["CapitalDeces"]),
                                  _decimal(assure["CapitalInfirmite"]), int(donnee_devis.get("IdOffre") or 0), assure.get("PrimeHT"))

        save_quotation_arg = unpack_ia_quotation_post_data(donnee_devis)

        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_creation_devis_ia(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                save_quotation_arg,
            )
            row = cursor.fetchone()
            id_devis = row[0] if row else 0

        logger.info(f"Devis créé: ID {id_devis} pour assuré ID {id_assure}")

        return id_devis

    except Exception as e:
        # ✅ L'exception remonte et déclenche le rollback
        logger.error(f"Erreur création devis: {str(e)}", exc_info=True)
        raise ValidationError(f"Erreur lors de la création du devis: {str(e)}")


def enregistrer_beneficiaire(id_client: int, beneficiaire: Dict) -> None:
    """
    Enregistre un bénéficiaire/ayant-droit pour un assuré.

    Args:
        id_client: ID de l'assuré
        beneficiaire: Données du bénéficiaire

    Raises:
        ValidationError: Si l'enregistrement échoue
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT fn_saisie_ayant_droit_ia(%s, %s, %s, %s, %s);",
                (
                    id_client,
                    beneficiaire["Lien"],
                    beneficiaire["Nom"],
                    beneficiaire["Prenoms"],
                    float(beneficiaire["Part"]),
                ),
            )
            result = cursor.fetchone()
            if result:
                logger.debug(f"Bénéficiaire créé avec ID: {result[0]}")

        logger.debug(
            f"Bénéficiaire créé: {beneficiaire['Nom']} {beneficiaire['Prenoms']} "
            f"pour client ID {id_client}"
        )

    except Exception as e:
        raise ValidationError(
            f"Erreur lors de l'enregistrement du bénéficiaire "
            f"{beneficiaire['Nom']}: {str(e)}"
        )


def enregistrer_assures(request_post_data: dict, assures: List[Dict]) -> int:
    """
    Enregistre les assurés et leurs ayants-droit dans la base de données.

    Utilise une transaction atomique STRICTE pour garantir la cohérence.
    """
    if not assures:
        raise ValidationError("Aucun assuré à enregistrer")

    id_devis_initial = int(request_post_data.get("IdDevis", 0) or 0)
    entete_devis = get_entete_devis(
        request_post_data=request_post_data,
        flotte=(len(assures) > 1) or (id_devis_initial > 0)
    )

    id_devis = 0
    assures_enregistres = 0

    try:
        # ✅ TRANSACTION ATOMIQUE STRICTE
        # Tout ou rien : si une exception est levée, TOUT est rollback
        with transaction.atomic():
            for assure_data in assures:
                try:
                    logger.info(
                        f"Traitement de l'assuré: {assure_data.get('Nom', 'INCONNU')} "
                        f"{assure_data.get('Prenoms', '')} "
                        f"(ligne {assure_data.get('NumeroLigne', '?')})"
                    )

                    # Création de l'assuré
                    assure = insert_new_assure(assure_data)
                    logger.debug(f"Assuré créé avec ID: {assure.IdClient}")

                    # Création des bénéficiaires
                    for idx, ben in enumerate(
                        assure_data.get("Beneficiaires", []), 1
                    ):
                        logger.debug(
                            f"Traitement du bénéficiaire {idx}/{len(assure_data['Beneficiaires'])}"
                        )
                        enregistrer_beneficiaire(assure.IdClient, ben)

                    # Enregistrement du devis
                    logger.debug("Création du devis...")
                    id_devis = enregistrer_devis_ia(
                        entete_devis, assure_data, assure.IdClient
                    )
                    entete_devis["IdDevis"] = id_devis

                    assures_enregistres += 1
                    logger.info(
                        f"✓ Assuré enregistré avec succès: {assure_data['Nom']} "
                        f"(ID Client: {assure.IdClient}, ID Devis: {id_devis})"
                    )

                except Exception as e:
                    # ✅ Enrichissement du contexte et relance
                    # L'exception va déclencher le rollback de TOUTE la transaction
                    logger.error(
                        f"❌ Erreur lors du traitement de l'assuré "
                        f"'{assure_data.get('Nom', 'INCONNU')} {assure_data.get('Prenoms', '')}' "
                        f"(ligne {assure_data.get('NumeroLigne', '?')}): {str(e)}",
                        exc_info=True,
                    )
                    raise ValidationError(
                        f"Erreur lors de l'enregistrement de l'assuré "
                        f"'{assure_data.get('Nom', 'INCONNU')} {assure_data.get('Prenoms', '')}' "
                        f"(ligne {assure_data.get('NumeroLigne', '?')}): {str(e)}"
                    )

        # ✅ Si on arrive ici, TOUT a réussi
        logger.info(
            f"✓✓✓ Import réussi: {assures_enregistres} assurés enregistrés. "
            f"Dernier ID devis: {id_devis}"
        )

        return id_devis

    except Exception as e:
        # ✅ Le rollback a déjà été fait par transaction.atomic()
        logger.error(
            f"❌❌❌ Échec de l'import - ROLLBACK effectué. "
            f"Erreur: {str(e)}",
            exc_info=True,
        )
        raise


# =====================================================================
# POINT D'ENTRÉE PRINCIPAL
# =====================================================================


def import_ia_insured(
    filename: str, user_id: int, request_post_data: dict
) -> Tuple[bool, int]:
    """
    Point d'entrée principal pour l'importation des assurés.

    Args:
        filename: Chemin vers le fichier Excel
        user_id: ID de l'utilisateur effectuant l'import
        request_post_data: Données de la requête POST

    Returns:
        Tuple[bool, int]: (erreur_survenue, id_devis)
            - erreur_survenue: True si une erreur s'est produite
            - id_devis: ID du devis (initial si erreur, nouveau sinon)
    """
    id_devis_initial = int(request_post_data.get("IdDevis", 0))
    id_offre = int(request_post_data.get("IdOffre", 0))

    try:
        logger.info(
            f"Début de l'import du fichier: {filename} par utilisateur ID {user_id}"
        )

        # Extraction des assurés depuis le fichier Excel
        assures = extraire_assures(filename, id_offre)

        if not assures:
            logger.warning("Aucun assuré trouvé dans le fichier")
            return (True, id_devis_initial)

        # Enregistrement en base de données
        id_devis = enregistrer_assures(
            assures=assures, request_post_data=request_post_data
        )

        logger.info(f"Import terminé avec succès. ID devis: {id_devis}")

        return (False, id_devis)

    except ValidationError as e:
        logger.error(f"Erreur de validation: {str(e)}")
        # Retourner l'erreur pour affichage à l'utilisateur
        return (True, id_devis_initial)

    except FileNotFoundError as e:
        logger.error(f"Fichier non trouvé: {str(e)}")
        return (True, id_devis_initial)

    except Exception as e:
        logger.error(
            f"Erreur inattendue lors de l'import: {str(e)}", exc_info=True
        )
        return (True, id_devis_initial)
