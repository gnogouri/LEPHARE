# Oreole Santé (demande du 2026-11-05) : « supprime le montant Accessoire de 10000 et est à rajouter au chargement pour sinistre à payer ».
# Les accessoires de chaque offre passent à 0 ; la cotisation ne change pas, le chargement pour sinistres à payer (frais courtiers, ce qui
# reste de la part Santé) augmente d'autant. La part de MCI devient la seule prime HT. Même règle pour l'offre 575 000 (5 000 F d'accessoires).
# Devis et contrats déjà émis : inchangés. Devis non confirmés : nouveau calcul au prochain enregistrement.
# Retour : python manage.py migrate production 0210 (remet les accessoires de la migration 0205).

from django.db import migrations

ACCESSOIRES_0205 = {"E575": 5000}
ACCESSOIRES_DEFAUT = 10000


def retirer(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("""UPDATE lephare_oreole_offre SET accessoires = 0, datemodification = now(), modifiepar = 'Migration 0211 : accessoires au chargement'
                          WHERE accessoires <> 0""")


def remettre(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT idoffre, code FROM lephare_oreole_offre")
        for id_offre, code in cursor.fetchall():
            cursor.execute("UPDATE lephare_oreole_offre SET accessoires = %s, datemodification = now(), modifiepar = 'Retour de la migration 0211' WHERE idoffre = %s",
                           [ACCESSOIRES_0205.get(code, ACCESSOIRES_DEFAUT), id_offre])


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0210_apporteurs_par_assure"),
    ]

    operations = [migrations.RunPython(retirer, remettre)]
