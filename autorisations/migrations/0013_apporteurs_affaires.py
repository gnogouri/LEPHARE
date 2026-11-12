# Apporteurs d'affaires (demande du 2026-11-05) : module à part dans Administration > Rôles. Chaque rôle garde ce qu'il pouvait faire :
# créer un apporteur relevait du paramétrage général, voir et régler relève de ceux qui voient et valident les commissions.

from django.db import migrations

from autorisations.catalogue import synchroniser_droits

EQUIVALENCES = {
    "apporteurs.view": "commissions.view",
    "apporteurs.update": "parametrage.update",
    "apporteurs.rattacher": "contrats.update",
    "apporteurs.payer": "commissions.validate",
    "apporteurs.cancel": "commissions.cancel",
}


def accorder(apps, schema_editor):
    Droit = apps.get_model("autorisations", "Droit")
    Role = apps.get_model("autorisations", "Role")
    synchroniser_droits(Droit)
    for code, modele in EQUIVALENCES.items():
        droit = Droit.objects.get(code=code)
        for role in Role.objects.filter(droits__code=modele).distinct():
            role.droits.add(droit)
    for role in Role.objects.filter(code__in=["ADMIN_TECH", "DEVELOPPEUR"]):
        role.droits.add(*Droit.objects.filter(code__in=EQUIVALENCES))


def retirer(apps, schema_editor):
    Droit = apps.get_model("autorisations", "Droit")
    for droit in Droit.objects.filter(code__in=EQUIVALENCES):
        droit.roles.clear()


class Migration(migrations.Migration):

    dependencies = [
        ("autorisations", "0012_restauration_archives"),
    ]

    operations = [migrations.RunPython(accorder, retirer)]
