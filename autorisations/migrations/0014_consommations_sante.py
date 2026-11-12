# Consommations santé (mission OREOLE SANTÉ du 2026-11-05) : relevés du gestionnaire, droits et soldes des assurés, détection de fraude.
# Données de santé : droits dédiés, accordés d'office aux seuls rôles techniques ; la direction les attribue ensuite dans Administration > Rôles.

from django.db import migrations

from autorisations.catalogue import synchroniser_droits

DROITS = ["consommations.view", "consommations.import", "consommations.fraude"]


def accorder(apps, schema_editor):
    Droit = apps.get_model("autorisations", "Droit")
    Role = apps.get_model("autorisations", "Role")
    synchroniser_droits(Droit)
    for role in Role.objects.filter(code__in=["ADMIN_TECH", "DEVELOPPEUR"]):
        role.droits.add(*Droit.objects.filter(code__in=DROITS))


def retirer(apps, schema_editor):
    Droit = apps.get_model("autorisations", "Droit")
    for droit in Droit.objects.filter(code__in=DROITS):
        droit.roles.clear()


class Migration(migrations.Migration):

    dependencies = [
        ("autorisations", "0013_apporteurs_affaires"),
    ]

    operations = [migrations.RunPython(accorder, retirer)]
