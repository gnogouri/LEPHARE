# Import IA d'un fichier à cellules vides (2026-11-03, devis 26665 et 26666) : la cellule vide arrivait en « nan » et était
# enregistrée comme montant. Une seule de ces valeurs (NaN) rendait invalides les totaux et faisait planter le cockpit, le
# suivi commercial, le dossier et la fiche du client, le détail et l'impression du devis.
# L'import ne les produit plus (valider_monetaire) ; les valeurs déjà enregistrées, qui ne portent aucune information, sont
# remises à 0 sur les devis non confirmés. Les devis restent en place, à 0 F, à supprimer ou à importer de nouveau.
# Retour : sans effet.

from django.db import migrations

NON_CONFIRME = "SELECT iddevis FROM stddevis WHERE NOT COALESCE(confirme, FALSE)"
TABLES = (
    ("stddevis", f"iddevis IN ({NON_CONFIRME})"),
    ("stddevisdetail", f"iddevis IN ({NON_CONFIRME})"),
    ("stddevisdetgarantie", f"iddevisdet IN (SELECT iddevisdetail FROM stddevisdetail WHERE iddevis IN ({NON_CONFIRME}))"),
)


def remettre_a_zero(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        for table, filtre in TABLES:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = %s AND data_type = 'numeric'",
                [table],
            )
            for (colonne,) in cursor.fetchall():
                cursor.execute(f"UPDATE {table} SET {colonne} = 0 WHERE {colonne} = 'NaN' AND {filtre}")


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0203_finalisation_incorporation_ia_minene"),
    ]

    operations = [migrations.RunPython(remettre_a_zero, migrations.RunPython.noop)]
