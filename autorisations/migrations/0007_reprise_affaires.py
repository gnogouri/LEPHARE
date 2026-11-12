# Droit « Saisir les affaires antérieures » (contrats.reprise, demandé le 2026-10-26 : « tout le monde saisit et pas de
# validation ») : inscrit au catalogue et accordé à tous les rôles ; il se retire à un rôle dans Administration > Rôles.

from django.db import migrations

from autorisations.catalogue import synchroniser_droits

CODE = "contrats.reprise"


def accorder(apps, schema_editor):
    Droit = apps.get_model("autorisations", "Droit")
    Role = apps.get_model("autorisations", "Role")
    synchroniser_droits(Droit)
    droit = Droit.objects.get(code=CODE)
    for role in Role.objects.all():
        role.droits.add(droit)


def retirer(apps, schema_editor):
    Droit = apps.get_model("autorisations", "Droit")
    for droit in Droit.objects.filter(code=CODE):
        droit.roles.clear()


class Migration(migrations.Migration):

    dependencies = [
        ("autorisations", "0006_derogation_age"),
    ]

    operations = [migrations.RunPython(accorder, retirer)]
