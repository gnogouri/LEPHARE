# Reprise des affaires antérieures saisies comme un devis (production/reprise.py, reprendre_devis) : les écrans de
# devis de la vue Production, leurs tables et leurs barèmes, puis la confirmation du devis (sp_confirmation_devis) ;
# sp_generation_quittance v2 ne génère rien pendant la reprise (lephare.reprise = 'on'), la reprise crée la quittance
# dans la série « R » de son exercice. Retour : python manage.py migrate production 0179

from django.db import migrations, models

from uranus.utils.migrations import load_sql_version


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0179_reprise_affaires"),
    ]

    operations = [
        migrations.AlterField(
            model_name="repriseaffaire",
            name="mode",
            field=models.CharField(choices=[("saisie", "Saisie"), ("import", "Import Excel"), ("devis", "Écrans de devis")],
                                   db_column="mode", default="saisie", max_length=10),
        ),
        migrations.RunSQL(
            load_sql_version(__file__, "procedures/sp_generation_quittance", 2),
            load_sql_version(__file__, "procedures/sp_generation_quittance", 1),
        ),
    ]
