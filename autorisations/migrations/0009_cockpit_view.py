"""Ajoute le droit du cockpit dans les bases déjà initialisées."""

from django.db import migrations

from autorisations.catalogue import synchroniser_droits


def synchroniser_catalogue(apps, schema_editor):
    synchroniser_droits(apps.get_model("autorisations", "Droit"))


class Migration(migrations.Migration):

    dependencies = [
        ("autorisations", "0008_contrat_admin_update"),
    ]

    operations = [
        migrations.RunPython(synchroniser_catalogue, migrations.RunPython.noop),
    ]
