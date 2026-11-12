# Fiche de l'apporteur : montant général par assuré, à la place du taux général (jamais les deux), proposé au rattachement à une affaire.
# Retour : python manage.py migrate configuration_api 0109

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("configuration_api", "0109_apporteur_fiche"),
    ]

    operations = [
        migrations.AddField(
            model_name="apporteur",
            name="MontantParAssure",
            field=models.DecimalField(blank=True, db_column="montantparassure", decimal_places=2, max_digits=14, null=True, verbose_name="Montant général par assuré (F)"),
        ),
    ]
