# Date d'incorporation au choix, seule l'échéance reste celle du contrat (demande du 2026-11-03). Un avenant Santé peut
# désormais prendre effet avant un avenant déjà émis : la composition en vigueur n'est plus celle de la date d'effet la plus
# récente, mais celle du dernier avenant émis, qui porte toute la composition.
# - sp_avenant_creation_devis_initial v7 : composition recopiée du dernier contrat émis de la période ; contrat de base
#   départagé par IdContrat à date d'effet égale, comme production.renouvellement._contrat_base.
# Retour : python manage.py migrate production 0200

from django.db import migrations

from uranus.utils.migrations import load_sql_upgrade


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0200_confirmation_ia_minene_plusieurs_adherents"),
    ]

    operations = [
        migrations.RunSQL(*load_sql_upgrade(__file__, "procedures/sp_avenant_creation_devis_initial", from_version=6, to_version=7)),
    ]
