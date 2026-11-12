from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0208_apporteurs_cartes"),
    ]

    operations = [
        migrations.AlterField(
            model_name="brouillon",
            name="type_brouillon",
            field=models.CharField(
                choices=[
                    ("DEVIS_AUTO", "Devis automobile"),
                    ("DEVIS_IA", "Devis Individuelle Accidents"),
                    ("AVENANT", "Modification de contrat"),
                ],
                default="DEVIS_AUTO",
                max_length=30,
            ),
        ),
    ]
