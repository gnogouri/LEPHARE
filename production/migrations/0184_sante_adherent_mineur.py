# Santé : un assuré principal mineur n'est plus refusé hors MINENE (sp_saisie_adherent_sante v5). Un contrat groupe Santé
# classique peut couvrir des enfants dans leur propre famille quand leur parent est assuré dans une autre couverture
# (fichiers OIKOCREDIT 100 % CI / 100 % ME) ; en MINENE l'adhérent reste majeur, avec un message explicite.
# Retour : python manage.py migrate production 0183

from django.db import migrations

from uranus.utils.migrations import load_sql_version


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0183_avenant_sante_formule"),
    ]

    operations = [
        migrations.RunSQL(
            load_sql_version(__file__, "procedures/sp_saisie_adherent_sante", 5),
            load_sql_version(__file__, "procedures/sp_saisie_adherent_sante", 4),
        ),
    ]
