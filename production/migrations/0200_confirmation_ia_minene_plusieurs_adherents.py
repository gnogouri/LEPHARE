# Devis IA MINENE d'une police Santé de plus d'un adhérent : impossible à confirmer (devis 26671, 4 adhérents, 100 000 F).
# CreerDevisIAMineneView crée une ligne par adhérent, mais :
#   - les lignes des adhérents suivants n'avaient ni offre ni tarif (offre lue sur l'en-tête du devis, toujours à 0) :
#     « Une ligne du devis n'a pas de catégorie de tarif » à la confirmation (vue corrigée) ;
#   - le devis n'est pas une flotte : sp_confirmation_devis refusait ensuite « trop d'objets assurés » (v4).
#
#   - sp_confirmation_devis v4 : plusieurs lignes admises sur l'offre IA MINENE ;
#   - devis non confirmés : lignes sans offre complétées d'après la ligne de l'assuré principal, toujours sans prime
#     (la prime du devis reste celle d'un adhérent multipliée par le nombre d'adhérents).
# Retour : python manage.py migrate production 0199 (la procédure revient à la v3 ; les lignes complétées restent).

from django.db import migrations

from uranus.utils.migrations import load_sql_upgrade

COMPLETE_LIGNES = """
UPDATE stddevisdetail AS ligne
SET idoffre = principale.idoffre, idtarif = principale.idtarif
FROM stddevisdetail AS principale
JOIN stddevis AS d ON d.iddevis = principale.iddevis
WHERE principale.iddevis = ligne.iddevis
  AND principale.idoffre = 66
  AND d.idproduit = 2
  AND NOT COALESCE(d.confirme, FALSE)
  AND COALESCE(ligne.idoffre, 0) = 0;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0199_periode_devis_alignee_contrat"),
    ]

    operations = [
        migrations.RunSQL(*load_sql_upgrade(__file__, "procedures/sp_confirmation_devis", from_version=3, to_version=4)),
        migrations.RunSQL(COMPLETE_LIGNES, migrations.RunSQL.noop),
    ]
