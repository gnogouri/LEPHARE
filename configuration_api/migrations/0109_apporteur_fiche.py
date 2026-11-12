# Fiche de l'apporteur (demande du 2026-11-05) : prénoms, second téléphone, compte de règlement, observations. Rien n'est effacé.
# Dépend de 0107 et 0108 : `migrate configuration_api` les applique aussi.
# Retour : python manage.py migrate configuration_api 0108

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("configuration_api", "0108_module_saisie_afa"),
    ]

    operations = [
        migrations.AddField(
            model_name="apporteur",
            name="Prenoms",
            field=models.CharField(blank=True, db_column="prenoms", default="", max_length=150, verbose_name="Prénoms"),
        ),
        migrations.AddField(
            model_name="apporteur",
            name="Telephone2",
            field=models.CharField(blank=True, db_column="telephone2", default="", max_length=30, verbose_name="Second téléphone"),
        ),
        migrations.AddField(
            model_name="apporteur",
            name="CompteReglement",
            field=models.CharField(blank=True, db_column="comptereglement", default="", max_length=100, verbose_name="Compte bancaire ou mobile money"),
        ),
        migrations.AddField(
            model_name="apporteur",
            name="Observations",
            field=models.CharField(blank=True, db_column="observations", default="", max_length=300),
        ),
        migrations.AlterField(
            model_name="apporteur",
            name="TauxRetrocession",
            field=models.DecimalField(blank=True, db_column="tauxretrocession", decimal_places=2, max_digits=5, null=True, verbose_name="Taux général de commission (%)"),
        ),
    ]
