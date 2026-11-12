# Renouvellement Auto refusé à l'enregistrement : « Véhicule 5267JA01 non enregistré : Les caractéristiques d'un
# véhicule déjà existant ne peuvent changer » (devis 26640 du serveur, 2026-10-29). La police flotte
# 1186201250492L portait une valeur à neuf de 119 500 000 au lieu de 19 500 000 (saisie URANUS 2024, reconduite en
# 2025) ; corrigée au renouvellement, elle était refusée.
#
# sp_enregistrement_vehicule v2 (v1 = définition en base, jamais versionnée jusqu'ici) :
#   - un véhicule repris du contrat précédent (stddevisdetail.idoldhist renseigné) dans un devis de renouvellement
#     (REN) se met à jour comme un véhicule saisi dans le devis : valeur à neuf, puissance, places, énergie, charge
#     utile, date de mise en circulation, marque et immatriculation corrigibles ;
#   - pour les autres avenants, contrôle conservé, mais une valeur absente en base (NULL) vaut 0 et le message nomme
#     les caractéristiques modifiées.
# Retour : python manage.py migrate production 0190

from django.db import migrations

from uranus.utils.migrations import load_sql_upgrade


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0190_mrp_saisie_ouverte"),
    ]

    operations = [
        migrations.RunSQL(*load_sql_upgrade(__file__, "procedures/sp_enregistrement_vehicule", from_version=1, to_version=2)),
    ]
