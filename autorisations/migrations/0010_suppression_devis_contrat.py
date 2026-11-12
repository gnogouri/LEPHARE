# Suppression définitive d'un devis ou d'un contrat (demande du 2026-11-03 : « par habilitation »). Droits attribués au
# départ aux seuls rôles techniques à accès complet ; l'administrateur les accorde ensuite depuis Administration > Rôles.

from django.db import migrations

from autorisations.catalogue import synchroniser_droits


CODES = ("devis.delete", "contrats.delete")


def accorder(apps, schema_editor):
    Droit = apps.get_model("autorisations", "Droit")
    Role = apps.get_model("autorisations", "Role")
    synchroniser_droits(Droit)
    for droit in Droit.objects.filter(code__in=CODES):
        for role in Role.objects.filter(code__in=["ADMIN_TECH", "DEVELOPPEUR"]):
            role.droits.add(droit)


def retirer(apps, schema_editor):
    Droit = apps.get_model("autorisations", "Droit")
    for droit in Droit.objects.filter(code__in=CODES):
        droit.roles.clear()


class Migration(migrations.Migration):

    dependencies = [
        ("autorisations", "0009_cockpit_view"),
    ]

    operations = [migrations.RunPython(accorder, retirer)]
