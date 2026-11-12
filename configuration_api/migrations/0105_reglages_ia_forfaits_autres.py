# Individuelle Accidents : montants et taux écrits jusqu'ici dans le calcul devenus réglables (Administration >
# Réglages par branche > Individuelle Accidents) :
#   - ia.forfait.<offre>.* : primes et capitaux des offres forfaitaires CGA et CI-ÉNERGIES (fn_garantie_offre_ia) ;
#   - ia.autres.* : barème des compagnies autres que NSIA (AMSA, SUNU…) : taux par classe, majorations d'âge, frais de
#     traitement par tranche de capital (fn_calcul_prime_ia_by_age, fn_web_calcul_taux_classe).
# Valeur d'origine = montant de la fonction (production 0177), donc mêmes calculs.
# Retour : python manage.py migrate configuration_api 0104

from decimal import Decimal

from django.db import migrations

# (clé, valeur d'origine, type, unité, libellé, aide (offre pour les forfaits), ordre)
REGLAGES = [
    ('ia.autres.age_minimum', '12', 'entier', 'ans', "Âge minimum de l'assuré", "En dessous, aucune prime n'est calculée.", 1),
    ('ia.autres.age_majoration_1', '49', 'entier', 'ans', "Première majoration d'âge : au-delà de", '', 2),
    ('ia.autres.coefficient_age_1', '1.3', 'decimal', '×', "Première majoration d'âge : coefficient", 'Primes décès, invalidité et frais de traitement multipliées par ce coefficient.', 3),
    ('ia.autres.age_majoration_2', '65', 'entier', 'ans', "Seconde majoration d'âge : au-delà de", '', 4),
    ('ia.autres.coefficient_age_2', '1.40', 'decimal', '×', "Seconde majoration d'âge : coefficient", '', 5),
    ('ia.autres.age_maximum', '70', 'entier', 'ans', "Âge maximum de l'assuré", "Au-delà, aucune prime n'est calculée.", 6),
    ('ia.autres.taux_minimum_age_2', '2', 'decimal', '‰', "Seconde majoration d'âge : taux décès minimum", 'Taux de la classe porté à ce minimum.', 7),
    ('ia.autres.taux_plafond_invalidite_age_2', '2.5', 'decimal', '‰', 'Seconde majoration d’âge : taux au-delà duquel l’invalidité n’est pas tarifée', '', 8),
    ('ia.autres.taux_classe_01', '1.0', 'decimal', '‰', 'Taux décès et invalidité, classe 01', '', 11),
    ('ia.autres.taux_classe_02', '1.3', 'decimal', '‰', 'Taux décès et invalidité, classe 02', '', 12),
    ('ia.autres.taux_classe_03', '1.7', 'decimal', '‰', 'Taux décès et invalidité, classe 03', '', 13),
    ('ia.autres.taux_classe_04', '2.5', 'decimal', '‰', 'Taux décès et invalidité, classe 04', '', 14),
    ('ia.autres.taux_classe_05', '4.1', 'decimal', '‰', 'Taux décès et invalidité, classe 05', '', 15),
    ('ia.autres.ft_plafond_1', '125000', 'montant', 'F', "Frais de traitement : tranche 1, capital jusqu'à", '', 21),
    ('ia.autres.ft_plafond_2', '250000', 'montant', 'F', "Frais de traitement : tranche 2, capital jusqu'à", '', 22),
    ('ia.autres.ft_plafond_3', '500000', 'montant', 'F', "Frais de traitement : tranche 3, capital jusqu'à", '', 23),
    ('ia.autres.ft_plafond_4', '750000', 'montant', 'F', "Frais de traitement : tranche 4, capital jusqu'à", '', 24),
    ('ia.autres.ft_plafond_5', '1000000', 'montant', 'F', "Frais de traitement : tranche 5, capital jusqu'à", '', 25),
    ('ia.autres.ft_01_1', '4000', 'montant', 'F', 'Frais de traitement classe 01, tranche 1', '', 41),
    ('ia.autres.ft_01_2', '6000', 'montant', 'F', 'Frais de traitement classe 01, tranche 2', '', 42),
    ('ia.autres.ft_01_3', '9500', 'montant', 'F', 'Frais de traitement classe 01, tranche 3', '', 43),
    ('ia.autres.ft_01_4', '12500', 'montant', 'F', 'Frais de traitement classe 01, tranche 4', '', 44),
    ('ia.autres.ft_01_5', '15750', 'montant', 'F', 'Frais de traitement classe 01, tranche 5', '', 45),
    ('ia.autres.ft_02_1', '6000', 'montant', 'F', 'Frais de traitement classe 02, tranche 1', '', 51),
    ('ia.autres.ft_02_2', '10000', 'montant', 'F', 'Frais de traitement classe 02, tranche 2', '', 52),
    ('ia.autres.ft_02_3', '15000', 'montant', 'F', 'Frais de traitement classe 02, tranche 3', '', 53),
    ('ia.autres.ft_02_4', '18000', 'montant', 'F', 'Frais de traitement classe 02, tranche 4', '', 54),
    ('ia.autres.ft_02_5', '21500', 'montant', 'F', 'Frais de traitement classe 02, tranche 5', '', 55),
    ('ia.autres.ft_03_1', '8500', 'montant', 'F', 'Frais de traitement classe 03, tranche 1', '', 61),
    ('ia.autres.ft_03_2', '12500', 'montant', 'F', 'Frais de traitement classe 03, tranche 2', '', 62),
    ('ia.autres.ft_03_3', '18000', 'montant', 'F', 'Frais de traitement classe 03, tranche 3', '', 63),
    ('ia.autres.ft_03_4', '23500', 'montant', 'F', 'Frais de traitement classe 03, tranche 4', '', 64),
    ('ia.autres.ft_03_5', '32000', 'montant', 'F', 'Frais de traitement classe 03, tranche 5', '', 65),
    ('ia.autres.ft_04_1', '11000', 'montant', 'F', 'Frais de traitement classe 04, tranche 1', '', 71),
    ('ia.autres.ft_04_2', '16000', 'montant', 'F', 'Frais de traitement classe 04, tranche 2', '', 72),
    ('ia.autres.ft_04_3', '23500', 'montant', 'F', 'Frais de traitement classe 04, tranche 3', '', 73),
    ('ia.autres.ft_04_4', '30500', 'montant', 'F', 'Frais de traitement classe 04, tranche 4', '', 74),
    ('ia.autres.ft_04_5', '40500', 'montant', 'F', 'Frais de traitement classe 04, tranche 5', '', 75),
    ('ia.forfait.154.prime_deces', '2120', 'montant', 'F', 'Prime décès', 'INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 2K', 1540),
    ('ia.forfait.154.prime_ip', '2120', 'montant', 'F', 'Prime invalidité permanente', 'INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 2K', 1541),
    ('ia.forfait.154.prime_frais_traitement', '0', 'montant', 'F', 'Prime frais de traitement', 'INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 2K', 1542),
    ('ia.forfait.154.capital_deces', '2000000', 'montant', 'F', 'Capital décès', 'INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 2K', 1543),
    ('ia.forfait.154.capital_infirmite', '2000000', 'montant', 'F', 'Capital invalidité permanente', 'INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 2K', 1544),
    ('ia.forfait.154.capital_frais_traitement', '0', 'montant', 'F', 'Capital frais de traitement', 'INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 2K', 1545),
    ('ia.forfait.155.prime_deces', '0', 'montant', 'F', 'Prime décès', 'INDIVIDUELLE ACCIDENTS CGA P/C - SPECIFIQUE', 1550),
    ('ia.forfait.155.prime_ip', '0', 'montant', 'F', 'Prime invalidité permanente', 'INDIVIDUELLE ACCIDENTS CGA P/C - SPECIFIQUE', 1551),
    ('ia.forfait.155.prime_frais_traitement', '0', 'montant', 'F', 'Prime frais de traitement', 'INDIVIDUELLE ACCIDENTS CGA P/C - SPECIFIQUE', 1552),
    ('ia.forfait.155.capital_deces', '0', 'montant', 'F', 'Capital décès', 'INDIVIDUELLE ACCIDENTS CGA P/C - SPECIFIQUE', 1553),
    ('ia.forfait.155.capital_infirmite', '0', 'montant', 'F', 'Capital invalidité permanente', 'INDIVIDUELLE ACCIDENTS CGA P/C - SPECIFIQUE', 1554),
    ('ia.forfait.155.capital_frais_traitement', '0', 'montant', 'F', 'Capital frais de traitement', 'INDIVIDUELLE ACCIDENTS CGA P/C - SPECIFIQUE', 1555),
    ('ia.forfait.156.prime_deces', '6924', 'montant', 'F', 'Prime décès', 'INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 4K', 1560),
    ('ia.forfait.156.prime_ip', '6923', 'montant', 'F', 'Prime invalidité permanente', 'INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 4K', 1561),
    ('ia.forfait.156.prime_frais_traitement', '0', 'montant', 'F', 'Prime frais de traitement', 'INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 4K', 1562),
    ('ia.forfait.156.capital_deces', '4000000', 'montant', 'F', 'Capital décès', 'INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 4K', 1563),
    ('ia.forfait.156.capital_infirmite', '4000000', 'montant', 'F', 'Capital invalidité permanente', 'INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 4K', 1564),
    ('ia.forfait.156.capital_frais_traitement', '0', 'montant', 'F', 'Capital frais de traitement', 'INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 4K', 1565),
    ('ia.forfait.162.prime_deces', '14400', 'montant', 'F', 'Prime décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 30K', 1620),
    ('ia.forfait.162.prime_ip', '14400', 'montant', 'F', 'Prime invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 30K', 1621),
    ('ia.forfait.162.prime_frais_traitement', '0', 'montant', 'F', 'Prime frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 30K', 1622),
    ('ia.forfait.162.capital_deces', '30000000', 'montant', 'F', 'Capital décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 30K', 1623),
    ('ia.forfait.162.capital_infirmite', '30000000', 'montant', 'F', 'Capital invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 30K', 1624),
    ('ia.forfait.162.capital_frais_traitement', '0', 'montant', 'F', 'Capital frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 30K', 1625),
    ('ia.forfait.163.prime_deces', '2400', 'montant', 'F', 'Prime décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 5K', 1630),
    ('ia.forfait.163.prime_ip', '2400', 'montant', 'F', 'Prime invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 5K', 1631),
    ('ia.forfait.163.prime_frais_traitement', '0', 'montant', 'F', 'Prime frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 5K', 1632),
    ('ia.forfait.163.capital_deces', '5000000', 'montant', 'F', 'Capital décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 5K', 1633),
    ('ia.forfait.163.capital_infirmite', '5000000', 'montant', 'F', 'Capital invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 5K', 1634),
    ('ia.forfait.163.capital_frais_traitement', '0', 'montant', 'F', 'Capital frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 5K', 1635),
    ('ia.forfait.165.prime_deces', '36000', 'montant', 'F', 'Prime décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 75K', 1650),
    ('ia.forfait.165.prime_ip', '36000', 'montant', 'F', 'Prime invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 75K', 1651),
    ('ia.forfait.165.prime_frais_traitement', '0', 'montant', 'F', 'Prime frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 75K', 1652),
    ('ia.forfait.165.capital_deces', '75000000', 'montant', 'F', 'Capital décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 75K', 1653),
    ('ia.forfait.165.capital_infirmite', '75000000', 'montant', 'F', 'Capital invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 75K', 1654),
    ('ia.forfait.165.capital_frais_traitement', '0', 'montant', 'F', 'Capital frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 75K', 1655),
    ('ia.forfait.166.prime_deces', '48000', 'montant', 'F', 'Prime décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 100K', 1660),
    ('ia.forfait.166.prime_ip', '48000', 'montant', 'F', 'Prime invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 100K', 1661),
    ('ia.forfait.166.prime_frais_traitement', '0', 'montant', 'F', 'Prime frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 100K', 1662),
    ('ia.forfait.166.capital_deces', '100000000', 'montant', 'F', 'Capital décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 100K', 1663),
    ('ia.forfait.166.capital_infirmite', '100000000', 'montant', 'F', 'Capital invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 100K', 1664),
    ('ia.forfait.166.capital_frais_traitement', '0', 'montant', 'F', 'Capital frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 100K', 1665),
    ('ia.forfait.167.prime_deces', '4800', 'montant', 'F', 'Prime décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 10K', 1670),
    ('ia.forfait.167.prime_ip', '4800', 'montant', 'F', 'Prime invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 10K', 1671),
    ('ia.forfait.167.prime_frais_traitement', '0', 'montant', 'F', 'Prime frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 10K', 1672),
    ('ia.forfait.167.capital_deces', '10000000', 'montant', 'F', 'Capital décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 10K', 1673),
    ('ia.forfait.167.capital_infirmite', '10000000', 'montant', 'F', 'Capital invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 10K', 1674),
    ('ia.forfait.167.capital_frais_traitement', '0', 'montant', 'F', 'Capital frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 10K', 1675),
    ('ia.forfait.168.prime_deces', '12000', 'montant', 'F', 'Prime décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 25K', 1680),
    ('ia.forfait.168.prime_ip', '12000', 'montant', 'F', 'Prime invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 25K', 1681),
    ('ia.forfait.168.prime_frais_traitement', '0', 'montant', 'F', 'Prime frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 25K', 1682),
    ('ia.forfait.168.capital_deces', '25000000', 'montant', 'F', 'Capital décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 25K', 1683),
    ('ia.forfait.168.capital_infirmite', '25000000', 'montant', 'F', 'Capital invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 25K', 1684),
    ('ia.forfait.168.capital_frais_traitement', '0', 'montant', 'F', 'Capital frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 25K', 1685),
    ('ia.forfait.169.prime_deces', '7200', 'montant', 'F', 'Prime décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 15K', 1690),
    ('ia.forfait.169.prime_ip', '7200', 'montant', 'F', 'Prime invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 15K', 1691),
    ('ia.forfait.169.prime_frais_traitement', '0', 'montant', 'F', 'Prime frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 15K', 1692),
    ('ia.forfait.169.capital_deces', '15000000', 'montant', 'F', 'Capital décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 15K', 1693),
    ('ia.forfait.169.capital_infirmite', '15000000', 'montant', 'F', 'Capital invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 15K', 1694),
    ('ia.forfait.169.capital_frais_traitement', '0', 'montant', 'F', 'Capital frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 15K', 1695),
    ('ia.forfait.170.prime_deces', '24000', 'montant', 'F', 'Prime décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 50K', 1700),
    ('ia.forfait.170.prime_ip', '24000', 'montant', 'F', 'Prime invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 50K', 1701),
    ('ia.forfait.170.prime_frais_traitement', '0', 'montant', 'F', 'Prime frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 50K', 1702),
    ('ia.forfait.170.capital_deces', '50000000', 'montant', 'F', 'Capital décès', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 50K', 1703),
    ('ia.forfait.170.capital_infirmite', '50000000', 'montant', 'F', 'Capital invalidité permanente', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 50K', 1704),
    ('ia.forfait.170.capital_frais_traitement', '0', 'montant', 'F', 'Capital frais de traitement', 'INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 50K', 1705),
]


def creer(apps, schema_editor):
    Parametre = apps.get_model("configuration_api", "ParametreGeneral")
    for cle, valeur, type_, unite, libelle, aide, ordre in REGLAGES:
        Parametre.objects.get_or_create(Cle=cle, defaults={
            "Groupe": "ia_forfait" if cle.startswith("ia.forfait.") else "ia_autres", "Libelle": libelle, "Aide": aide or "",
            "Type": type_, "Valeur": valeur, "ValeurOrigine": valeur, "Unite": unite,
            "Minimum": Decimal("0"), "Maximum": None, "Ordre": ordre,
        })


def retirer(apps, schema_editor):
    apps.get_model("configuration_api", "ParametreGeneral").objects.filter(Cle__regex=r"^ia\.(forfait|autres)\.").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("configuration_api", "0104_reglages_moteur_auto"),
    ]

    operations = [
        migrations.RunPython(creer, retirer),
    ]
