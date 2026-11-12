# Registre des devis (vue Production) : les devis expirés y restent listés, avec l'onglet « Expirés », s'ils ont été
# émis depuis le 1er janvier de l'année N - k ; k réglable dans Administration > Le cabinet (1 : année en cours et
# année précédente). Retour : python manage.py migrate configuration_api 0105

from decimal import Decimal

from django.db import migrations

CLE = "devis.registre_expires_annees"


def creer(apps, schema_editor):
    apps.get_model("configuration_api", "ParametreGeneral").objects.get_or_create(Cle=CLE, defaults={
        "Groupe": "devis", "Libelle": "Devis expirés affichés au registre",
        "Aide": "Les devis expirés non confirmés restent listés dans la vue Production, onglet « Expirés », s'ils ont été "
                "émis depuis le 1er janvier de l'année en cours moins ce nombre d'années (1 : année en cours et année "
                "précédente ; 0 : année en cours seulement).",
        "Type": "entier", "Valeur": "1", "ValeurOrigine": "1", "Unite": "ans",
        "Minimum": Decimal("0"), "Maximum": Decimal("30"), "Ordre": 2,
    })


def retirer(apps, schema_editor):
    apps.get_model("configuration_api", "ParametreGeneral").objects.filter(Cle=CLE).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("configuration_api", "0105_reglages_ia_forfaits_autres"),
    ]

    operations = [
        migrations.RunPython(creer, retirer),
    ]
