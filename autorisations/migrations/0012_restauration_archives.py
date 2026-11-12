# Restauration des éléments archivés (demande du 2026-11-05) : un droit à part, que l'administrateur accorde depuis Administration > Rôles.
# Au départ, seuls les rôles techniques à accès complet l'ont ; elle dépendait avant des droits de suppression ou d'archivage.

from django.db import migrations

from autorisations.catalogue import synchroniser_droits


CODE = "archives.restore"


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
        ("autorisations", "0011_textes_neutres_interface"),
    ]

    operations = [migrations.RunPython(accorder, retirer)]
