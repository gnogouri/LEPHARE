# Branche de production MRP ouverte à la saisie (demande de l'utilisateur du 2026-10-28) : bouton « Devis MRP » du
# registre et formulaire /user/quotes/mrp, primes, accessoire et taxe saisis à la main (pas encore de barème MRP),
# et onglet « MRP » propre dans le registre (ses devis étaient rangés sous MRH). Placée dans production pour ne pas
# entraîner la migration configuration_api 0107 (taxes Transport par mode), encore en attente.

from django.db import migrations

ID_PRODUIT_MRP = 7


def ouvrir(apps, schema_editor):
    ProduitParametre = apps.get_model("configuration_api", "ProduitParametre")
    ProduitParametre.objects.filter(IdProduit=ID_PRODUIT_MRP).update(SaisieOuverte=True, ModuleSaisie="mrp", Onglet="MRP")


def fermer(apps, schema_editor):
    ProduitParametre = apps.get_model("configuration_api", "ProduitParametre")
    ProduitParametre.objects.filter(IdProduit=ID_PRODUIT_MRP).update(SaisieOuverte=False, Onglet="MRH")


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0189_mrh_usage_location"),
        ("configuration_api", "0106_registre_devis_expires"),
    ]

    operations = [
        migrations.RunPython(ouvrir, fermer),
    ]
