# Incorporation IA MINENE (demande du 2026-11-03) : la finalisation multipliait la prime par tous les adhérents de la police
# Santé connexe, soit le prix de toute la police pour une seule personne incorporée (100 000 F au lieu de 25 000 F).
# - sp_finalisation_devis v7 : pour un devis d'incorporation, prime d'une personne multipliée par les personnes du devis.
# Retour : python manage.py migrate production 0202

from django.db import migrations

from uranus.utils.migrations import load_sql_upgrade


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0202_incorporation_ia_plusieurs_personnes"),
    ]

    operations = [
        migrations.RunSQL(*load_sql_upgrade(__file__, "procedures/sp_finalisation_devis", from_version=6, to_version=7)),
    ]
