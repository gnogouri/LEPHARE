# Branche RAFAS (régime autofinancé d'assurance santé, demande du 2026-11-10) : conventions, fonds du régime, fichiers du gestionnaire et
# analyse des dépenses de santé. Données de santé et finances du souscripteur : droits dédiés, accordés d'office aux seuls rôles techniques ;
# la direction les attribue ensuite dans Administration > Rôles.

from django.db import migrations

from autorisations.catalogue import synchroniser_droits

DROITS = ["rafas.view", "rafas.manage", "rafas.import"]


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
        ("autorisations", "0014_consommations_sante"),
    ]

    operations = [migrations.RunPython(accorder, retirer)]
