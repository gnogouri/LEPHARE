# Droit distinct pour l'édition administrative des contrats. Il est attribué au départ aux seuls
# rôles techniques à accès complet ; l'administrateur peut ensuite l'accorder depuis Administration > Rôles.

from django.db import migrations

from autorisations.catalogue import synchroniser_droits


CODE = "contrats.admin_update"


def accorder(apps, schema_editor):
    Droit = apps.get_model("autorisations", "Droit")
    Role = apps.get_model("autorisations", "Role")
    synchroniser_droits(Droit)
    droit = Droit.objects.get(code=CODE)
    for role in Role.objects.filter(code__in=["ADMIN_TECH", "DEVELOPPEUR"]):
        role.droits.add(droit)


def retirer(apps, schema_editor):
    Droit = apps.get_model("autorisations", "Droit")
    for droit in Droit.objects.filter(code=CODE):
        droit.roles.clear()


class Migration(migrations.Migration):

    dependencies = [
        ("autorisations", "0007_reprise_affaires"),
    ]

    operations = [migrations.RunPython(accorder, retirer)]
