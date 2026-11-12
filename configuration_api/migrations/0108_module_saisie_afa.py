# Formulaire de saisie « afa » (branche Vie séparée de la Santé, 2026-11-02) ajouté aux modules d'un produit. Liste de
# choix seulement : rien ne change en base, la migration peut attendre l'application de la 0107 (taxes Transport).
# L'ouverture de la branche Vie elle-même est faite par la migration production 0194.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("configuration_api", "0107_taxes_transport_par_mode"),
    ]

    operations = [
        migrations.AlterField(
            model_name="produitparametre",
            name="ModuleSaisie",
            field=models.CharField(
                blank=True,
                choices=[
                    ("", "Aucun formulaire"), ("auto", "Automobile"), ("ia", "Individuelle Accidents"), ("voyage", "Voyage"),
                    ("mrh", "Multirisque Habitation"), ("sante", "Santé"), ("transport", "Transport"),
                    ("rc", "Responsabilité Civile"), ("mrp", "Multirisque Professionnelle"), ("tous-dommages", "Tous Dommages"),
                    ("afa", "Vie - AFA"),
                ],
                db_column="modulesaisie",
                default="",
                max_length=30,
            ),
        ),
    ]
