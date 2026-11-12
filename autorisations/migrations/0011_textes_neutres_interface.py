from django.db import migrations


DESCRIPTION_DROIT_AVANT = "Tables internes, numérotation, tâches planifiées, menus d'URANUS."
DESCRIPTION_DROIT_APRES = "Tables internes, numérotation, tâches planifiées et menus de l'application."
DESCRIPTION_ROLE_AVANT = (
    "Production complète (clients, devis, contrats, caisse, sinistres, imports) "
    "sans paramétrage ; rôle donné aux comptes repris d'URANUS non administrateurs."
)
DESCRIPTION_ROLE_APRES = (
    "Production complète (clients, devis, contrats, caisse, sinistres, imports) "
    "sans paramétrage ; attribué aux comptes importés non administrateurs."
)


def nettoyer_descriptions(apps, schema_editor):
    Droit = apps.get_model("autorisations", "Droit")
    Role = apps.get_model("autorisations", "Role")
    Droit.objects.filter(code="parametrage.technique", description=DESCRIPTION_DROIT_AVANT).update(
        description=DESCRIPTION_DROIT_APRES
    )
    Role.objects.filter(code="GESTIONNAIRE", description=DESCRIPTION_ROLE_AVANT).update(
        description=DESCRIPTION_ROLE_APRES
    )


def restaurer_descriptions(apps, schema_editor):
    Droit = apps.get_model("autorisations", "Droit")
    Role = apps.get_model("autorisations", "Role")
    Droit.objects.filter(code="parametrage.technique", description=DESCRIPTION_DROIT_APRES).update(
        description=DESCRIPTION_DROIT_AVANT
    )
    Role.objects.filter(code="GESTIONNAIRE", description=DESCRIPTION_ROLE_APRES).update(
        description=DESCRIPTION_ROLE_AVANT
    )


class Migration(migrations.Migration):

    dependencies = [
        ("autorisations", "0010_suppression_devis_contrat"),
    ]

    operations = [
        migrations.RunPython(nettoyer_descriptions, restaurer_descriptions),
    ]
