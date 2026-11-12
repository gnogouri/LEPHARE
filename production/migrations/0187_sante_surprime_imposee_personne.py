# Santé MINENE : surprime imposée par personne (demande du 2026-10-27). Un assuré dont la case « Surprime » est cochée avec
# un montant remplace sa surprime calculée (âge et affection) par ce montant annuel ; sans montant, la surprime reste
# calculée automatiquement (sp_creation_devis_sante v10). Retour : python manage.py migrate production 0186

from django.db import migrations

from uranus.utils.migrations import load_sql_version


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0186_reprise_soldee"),
    ]

    operations = [
        migrations.RunSQL(
            load_sql_version(__file__, "procedures/sp_creation_devis_sante", 10),
            load_sql_version(__file__, "procedures/sp_creation_devis_sante", 9),
        ),
    ]
