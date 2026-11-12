# Individuelle Accidents : primes et capitaux des offres forfaitaires CGA / CI-ÉNERGIES et barème des compagnies
# autres que NSIA (taux par classe, majorations d'âge, frais de traitement) lus dans les réglages IA
# (configuration_api 0105) au lieu d'être écrits dans les fonctions. Valeurs d'origine identiques : 16 560 calculs
# (46 offres NSIA, AMSA, SUNU × 5 classes × 6 âges × 6 capitaux × 2) inchangés.
# Retour : python manage.py migrate production 0176

from django.db import migrations

from uranus.utils.migrations import load_sql_version


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0176_moteur_auto_reglable"),
        ("configuration_api", "0105_reglages_ia_forfaits_autres"),
    ]

    operations = [
        migrations.RunSQL(
            load_sql_version(__file__, "functions/fn_garantie_offre_ia", 3),
            load_sql_version(__file__, "functions/fn_garantie_offre_ia", 2),
        ),
        migrations.RunSQL(
            load_sql_version(__file__, "functions/fn_calcul_prime_ia_by_age", 2),
            load_sql_version(__file__, "functions/fn_calcul_prime_ia_by_age", 1),
        ),
        migrations.RunSQL(
            load_sql_version(__file__, "functions/fn_web_calcul_taux_classe", 2),
            load_sql_version(__file__, "functions/fn_web_calcul_taux_classe", 1),
        ),
    ]
