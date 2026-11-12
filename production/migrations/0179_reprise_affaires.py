# Reprise des affaires antérieures (production/reprise.py) : table lephare_reprise (une ligne par contrat repris) et
# déclencheur d'arrondi des primes TTC v2, qui laisse la TTC du document pendant une reprise (lephare.reprise = 'on').
# Retour : python manage.py migrate production 0178

from django.db import migrations, models

from uranus.utils.migrations import load_sql_version


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0178_sante_surprime_age"),
    ]

    operations = [
        migrations.CreateModel(
            name="RepriseAffaire",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("idcontrat", models.IntegerField(db_column="idcontrat", unique=True)),
                ("iddevis", models.IntegerField(db_column="iddevis")),
                ("idquittance", models.IntegerField(db_column="idquittance")),
                ("mode", models.CharField(choices=[("saisie", "Saisie"), ("import", "Import Excel")], db_column="mode", default="saisie", max_length=10)),
                ("lot", models.CharField(blank=True, db_column="lot", max_length=40, null=True)),
                ("donnees", models.JSONField(db_column="donnees", default=dict)),
                ("commission_percue", models.BooleanField(db_column="commission_percue", default=False)),
                ("date_commission_percue", models.DateField(blank=True, db_column="date_commission_percue", null=True)),
                ("creepar", models.CharField(blank=True, db_column="creepar", default="", max_length=150)),
                ("idutilisateur", models.IntegerField(db_column="idutilisateur", null=True)),
                ("datecreation", models.DateTimeField(auto_now_add=True, db_column="datecreation")),
            ],
            options={
                "verbose_name": "Affaire antérieure reprise",
                "verbose_name_plural": "Affaires antérieures reprises",
                "db_table": "lephare_reprise",
                "ordering": ["-id"],
            },
        ),
        migrations.RunSQL(
            load_sql_version(__file__, "functions/trg_fn_lephare_arrondi_primettc", 2),
            load_sql_version(__file__, "functions/trg_fn_lephare_arrondi_primettc", 1),
        ),
    ]
