"""
Reste à encaisser d'une quittance : un reliquat de moins de 5 F (1 à 4 F, ou quelques centimes) est compté comme
nul, pour qu'un très faible écart ne bloque ni le solde de la quittance ni ce qui en dépend (attestation, relevé,
impayés, tableaux de bord). Les montants encaissés restent ceux réellement reçus.

Même seuil que sp_enregistrement_encaissement v6 (quittance marquée encaissée) et que l'écran de caisse
(resteAEncaisser, frontend/src/utils/financeUtils.js).
"""
from decimal import Decimal

RELIQUAT_NEGLIGEABLE = Decimal("5")


def reste_a_encaisser(prime_ttc, encaisse):
    """Reste dû sur la quittance, 0 pour un reliquat de moins de 5 F ou un trop-perçu."""
    reste = Decimal(str(prime_ttc or 0)) - Decimal(str(encaisse or 0))
    return reste if reste >= RELIQUAT_NEGLIGEABLE else Decimal(0)


def sql_reste(alias="q"):
    """Même règle en SQL pour la quittance <alias> (stdquittance) : NULL compté comme 0."""
    brut = f"(COALESCE({alias}.primettc, 0) - COALESCE({alias}.mt_encaisse, 0))"
    return f"(CASE WHEN {brut} >= {RELIQUAT_NEGLIGEABLE} THEN {brut} ELSE 0 END)"
