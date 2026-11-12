# Conventions avec les compagnies rattachées au référentiel (stdcompagnie) : la vue de l'administration lit les
# compagnies réelles et enregistre leurs conditions (production/views_conventions.py). Les lignes de démonstration
# existantes restent sans compagnie et ne sont plus affichées. Retour : python manage.py migrate institutionnel 0004

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("institutionnel", "0004_questionnaires_prospects"),
    ]

    operations = [
        migrations.AddField(
            model_name="conventionassureur",
            name="idcompagnie",
            field=models.IntegerField(blank=True, db_column="idcompagnie", null=True, unique=True, verbose_name="Compagnie (référentiel)"),
        ),
        migrations.AddField(
            model_name="conventionassureur",
            name="date_maj",
            field=models.DateTimeField(blank=True, null=True, verbose_name="Dernière mise à jour"),
        ),
        migrations.AddField(
            model_name="conventionassureur",
            name="maj_par",
            field=models.CharField(blank=True, default="", max_length=150, verbose_name="Mis à jour par"),
        ),
    ]
