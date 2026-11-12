# MINENE Santé : accessoire d'une famille selon la prime de base de sa formule (fn_get_accessoire_sante_minene v3),
# comme le fichier TARIFICATION MINENE SANTE.xlsx (SOLO 9 000 F en 70-80, 12 000 F en 80-80...). Avant : grille appliquée
# à la prime surprimée ou réduite de la famille, qui changeait de tranche. Retour : python manage.py migrate production 0181

from django.db import migrations

from uranus.utils.migrations import load_sql_version


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0181_reprise_devis_attente"),
    ]

    operations = [
        migrations.RunSQL(
            load_sql_version(__file__, "functions/fn_get_accessoire_sante_minene", 3),
            load_sql_version(__file__, "functions/fn_get_accessoire_sante_minene", 2),
        ),
    ]
