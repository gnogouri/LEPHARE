# Santé : changement de formule en cours de contrat (FAMILLE → FAMILLE PLUS après l'agrandissement de la famille,
# incorporation d'un membre). Avenant de modification (MOD) sous la même police : sp_avenant_creation_devis_initial v6
# recopie la composition en vigueur (couvertures, familles, affiliés) ; sante/avenant.py la tarife avant modification
# (référence, table lephare_avenant_sante_reference) ; sp_creation_devis_sante v9 tarife la nouvelle composition comme le
# contrat de la période puis ne garde que l'écart avec la référence, au prorata des jours restants. Le renouvellement
# reprend désormais la composition la plus récente (avenants compris). Retour : python manage.py migrate production 0182

from django.db import migrations, models

from uranus.utils.migrations import load_sql_version


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0182_minene_accessoire_formule"),
    ]

    operations = [
        migrations.CreateModel(
            name="AvenantSanteReference",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("iddevis", models.IntegerField(db_column="iddevis")),
                ("idgarantie", models.IntegerField(db_column="idgarantie")),
                ("montant", models.DecimalField(db_column="montant", decimal_places=4, default=0, max_digits=18)),
                ("datecreation", models.DateTimeField(auto_now_add=True, db_column="datecreation")),
            ],
            options={
                "verbose_name": "Référence d'avenant Santé",
                "verbose_name_plural": "Références d'avenants Santé",
                "db_table": "lephare_avenant_sante_reference",
                "unique_together": {("iddevis", "idgarantie")},
            },
        ),
        migrations.RunSQL(
            load_sql_version(__file__, "procedures/sp_avenant_creation_devis_initial", 6),
            load_sql_version(__file__, "procedures/sp_avenant_creation_devis_initial", 5),
        ),
        migrations.RunSQL(
            load_sql_version(__file__, "procedures/sp_creation_devis_sante", 9),
            load_sql_version(__file__, "procedures/sp_creation_devis_sante", 8),
        ),
    ]
