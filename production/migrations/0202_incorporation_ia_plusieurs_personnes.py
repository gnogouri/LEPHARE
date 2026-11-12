# Incorporation d'une personne dans un contrat Individuelle Accidents à plusieurs personnes (demande du 2026-11-03).
# - sp_creation_devis_ia v3 : un contrat hors catégorie groupe qui porte plusieurs personnes (IA MINENE, anciens contrats)
#   n'est plus refusé comme « police mono » ; seul un contrat d'une seule personne l'est encore.
# v3 part de la définition en base : le fichier v2.sql de ce dossier contient en réalité sp_creation_devis (Automobile), il
# ne peut donc pas servir de retour.
# Retour : sans effet sur la procédure (le contrôle reste simplement plus large).

from pathlib import Path

from django.db import migrations

SQL = (Path(__file__).resolve().parent.parent / "sql" / "procedures" / "sp_creation_devis_ia" / "v3.sql").read_text(encoding="utf-8")


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0201_avenant_date_effet_au_choix"),
    ]

    operations = [
        migrations.RunSQL(SQL, migrations.RunSQL.noop),
    ]
