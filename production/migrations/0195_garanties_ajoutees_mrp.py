# Garanties ajoutées ou retirées d'un devis MRP, comme dans l'Automobile (demande du 2026-11-02). L'écran envoie déjà la
# liste des garanties cochées à sp_creation_devis_risques_divers (sp_inserer_garanties_devis_rc enregistre toute garantie
# de la liste et retire les autres) ; mais la répartition de la prime nette imposée (sp_calcul_devis_prime_imposee)
# ne touchait que les garanties ayant un taux de taxe réglé pour le produit : une garantie ajoutée hors de l'offre gardait
# une prime et une taxe nulles.
# - sp_calcul_devis_prime_imposee v1 = définition d'URANUS relevée en base ; v2 = toutes les garanties du devis reçoivent
#   leur part, au taux de la garantie ou, à défaut, au taux habituel du produit (14,5 % pour la MRP). Garanties ayant un
#   taux : calcul inchangé (RC : toutes ses garanties d'offre ont un taux).
# Retour : python manage.py migrate production 0194

from django.db import migrations

from uranus.utils.migrations import load_sql_upgrade


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0194_branche_vie_afa"),
    ]

    operations = [
        migrations.RunSQL(*load_sql_upgrade(__file__, "procedures/sp_calcul_devis_prime_imposee", from_version=1, to_version=2)),
    ]
