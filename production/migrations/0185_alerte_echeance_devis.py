# Cloche : délai d'alerte des devis non confirmés arrivant à échéance (ou échus depuis), réglable dans Administration >
# Le cabinet (production/views_cockpit.alertes). Retour : python manage.py migrate production 0184

from decimal import Decimal

from django.db import migrations

CLE = "devis.alerte_echeance_jours"


def creer(apps, schema_editor):
    apps.get_model("configuration_api", "ParametreGeneral").objects.get_or_create(Cle=CLE, defaults={
        "Groupe": "devis", "Libelle": "Alerte des devis à échéance",
        "Aide": "La cloche signale les devis non confirmés dont la date d'expiration tombe dans ce nombre de jours, et ceux "
                "échus depuis au plus ce nombre de jours (un devis expiré ne peut plus être confirmé). Les saisies non "
                "enregistrées et les devis à prime nulle sont écartés.",
        "Type": "entier", "Valeur": "30", "ValeurOrigine": "30", "Unite": "jours",
        "Minimum": Decimal("1"), "Maximum": Decimal("120"), "Ordre": 3,
    })


def retirer(apps, schema_editor):
    apps.get_model("configuration_api", "ParametreGeneral").objects.filter(Cle=CLE).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0184_sante_adherent_mineur"),
        ("configuration_api", "0106_registre_devis_expires"),
    ]

    operations = [
        migrations.RunPython(creer, retirer),
    ]
