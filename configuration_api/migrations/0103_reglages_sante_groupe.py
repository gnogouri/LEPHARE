# Santé hors MINENE : seuils du contrat groupe (taxe « contrats groupe » au lieu du taux individuel), écrits
# jusqu'ici dans sp_creation_devis_sante (plus de 5 adhérents ou de 25 personnes assurées), réglables dans
# Administration > Réglages par branche > Santé. Retour : python manage.py migrate configuration_api 0102

from decimal import Decimal

from django.db import migrations

PARAMETRES = [
    {
        "Cle": "sante.groupe_adherents", "Libelle": "Contrat groupe : au-delà de ce nombre d'adhérents",
        "Aide": "Un devis Santé hors MINENE qui compte plus d'adhérents (familles) est un contrat groupe : sa taxe suit "
                "le taux « contrats groupe » d'Administration > Taxes (3 % à l'origine) au lieu du taux individuel (8 %).",
        "Valeur": "5", "Unite": "adhérents", "Ordre": 2,
    },
    {
        "Cle": "sante.groupe_affilies", "Libelle": "Contrat groupe : ou au-delà de ce nombre de personnes assurées",
        "Aide": "Adhérents compris. Le devis est aussi un contrat groupe s'il assure plus de personnes que ce nombre, "
                "quel que soit le nombre d'adhérents.",
        "Valeur": "25", "Unite": "personnes", "Ordre": 3,
    },
]


def creer(apps, schema_editor):
    Parametre = apps.get_model("configuration_api", "ParametreGeneral")
    for p in PARAMETRES:
        Parametre.objects.get_or_create(Cle=p["Cle"], defaults={
            "Groupe": "sante", "Libelle": p["Libelle"], "Aide": p["Aide"], "Type": "entier",
            "Valeur": p["Valeur"], "ValeurOrigine": p["Valeur"], "Unite": p["Unite"],
            "Minimum": Decimal("0"), "Maximum": Decimal("100000"), "Ordre": p["Ordre"],
        })


def retirer(apps, schema_editor):
    apps.get_model("configuration_api", "ParametreGeneral").objects.filter(Cle__in=[p["Cle"] for p in PARAMETRES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("configuration_api", "0102_accessoires_offres_ia_part_amsa"),
    ]

    operations = [
        migrations.RunPython(creer, retirer),
    ]
