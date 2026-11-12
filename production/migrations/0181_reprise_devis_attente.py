# Devis saisis dans les écrans de la vue Production pour une affaire antérieure, en attente de finalisation
# (production/reprise.py) : marqués à l'ouverture du devis enregistré en mode reprise. Retour : migrate production 0180

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0180_reprise_par_devis"),
    ]

    operations = [
        migrations.CreateModel(
            name="RepriseDevis",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("iddevis", models.IntegerField(db_column="iddevis", unique=True)),
                ("creepar", models.CharField(blank=True, db_column="creepar", default="", max_length=150)),
                ("idutilisateur", models.IntegerField(db_column="idutilisateur", null=True)),
                ("datecreation", models.DateTimeField(auto_now_add=True, db_column="datecreation")),
            ],
            options={
                "verbose_name": "Devis d'affaire antérieure à finaliser",
                "verbose_name_plural": "Devis d'affaires antérieures à finaliser",
                "db_table": "lephare_reprise_devis",
            },
        ),
    ]
