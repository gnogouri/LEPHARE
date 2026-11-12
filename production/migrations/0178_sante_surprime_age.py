# Santé MINENE : la surprime d'âge est toujours calculée (sauf prime globale imposée). Une « Surprime affection »
# saisie ne remplace plus que la surprime d'affection calculée ; jusqu'ici (sp_creation_devis_sante v7, comme
# URANUS) elle supprimait aussi la surprime d'âge, notamment au « Modifier » d'un devis qui en portait une.
# Retour : python manage.py migrate production 0177

from django.db import migrations

from uranus.utils.migrations import load_sql_version


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0177_ia_reglable"),
    ]

    operations = [
        migrations.RunSQL(
            load_sql_version(__file__, "procedures/sp_creation_devis_sante", 8),
            load_sql_version(__file__, "procedures/sp_creation_devis_sante", 7),
        ),
    ]
