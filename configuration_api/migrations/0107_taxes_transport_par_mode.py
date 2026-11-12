# Taxe Transport hors GUCE : un taux par mode, au lieu d'un taux unique de 7 %.
# Retour : python manage.py migrate configuration_api 0106

from decimal import Decimal

from django.db import migrations

TAUX = [
    ("maritime", "Maritime", "0"),
    ("fluvial", "Fluvial", "0"),
    ("aerien", "Aérien", "7"),
    ("terrestre", "Terrestre", "14.5"),
    ("ferroviaire", "Ferroviaire", "14.5"),
]
CLE_TAUX_COMMUN = "transport.taux_taxe"


def creer(apps, schema_editor):
    Parametre = apps.get_model("configuration_api", "ParametreGeneral")
    for ordre, (mode, libelle, valeur) in enumerate(TAUX, start=10):
        Parametre.objects.get_or_create(
            Cle=f"transport.taux_taxe_{mode}",
            defaults={
                "Groupe": "transport_tarif",
                "Libelle": f"Taxe Transport - {libelle}",
                "Aide": f"Taux de taxe appliqué à la prime nette et aux accessoires pour le transport {libelle.lower()}.",
                "Type": "pourcentage",
                "Valeur": valeur,
                "ValeurOrigine": valeur,
                "Unite": "%",
                "Minimum": Decimal("0"),
                "Maximum": Decimal("100"),
                "Ordre": ordre,
            },
        )
    Parametre.objects.filter(Cle=CLE_TAUX_COMMUN).update(
        Groupe="transport_legacy",
        Libelle="Ancien taux commun de taxe Transport",
        Aide="Remplacé par les taux réglés séparément pour chaque mode de transport.",
    )


def retirer(apps, schema_editor):
    Parametre = apps.get_model("configuration_api", "ParametreGeneral")
    Parametre.objects.filter(Cle__in=[f"transport.taux_taxe_{mode}" for mode, _, _ in TAUX]).delete()
    Parametre.objects.filter(Cle=CLE_TAUX_COMMUN).update(
        Groupe="transport_tarif",
        Libelle="Taxe sur les contrats Transport",
        Aide="Appliquée à la prime nette et aux accessoires (7 % sur les certificats GUCE), sauf affaire exonérée.",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("configuration_api", "0106_registre_devis_expires"),
    ]

    operations = [
        migrations.RunPython(creer, retirer),
    ]
