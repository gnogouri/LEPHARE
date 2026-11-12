# Incorporation dans une IA MINENE qui ne porte encore qu'une personne (demande du 2026-11-05) : le contrat est de groupe par
# nature, le nouvel adhérent de la police Santé doit pouvoir y entrer. sp_creation_devis_ia v4 : l'offre 66 n'est plus refusée
# comme « police mono ». Retour : v3.

from django.db import migrations

from uranus.utils.migrations import load_sql_upgrade


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0205_oreole_sante"),
    ]

    operations = [
        migrations.RunSQL(*load_sql_upgrade(__file__, "procedures/sp_creation_devis_ia", from_version=3, to_version=4)),
    ]
