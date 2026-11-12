# Tiret long « — » retiré des libellés affichés (demande du 2026-10-27) : libellés et aides des réglages
# (Administration) et variantes de la répartition de la prime MINENE, « a — b » devenant « a - b ». Les valeurs des
# réglages ne changent pas. Retour : python manage.py migrate production 0187 (libellés laissés tels quels)

from django.db import migrations

SQL = """
UPDATE lephare_parametre SET libelle = REPLACE(REPLACE(libelle, ' — ', ' - '), '—', '-') WHERE libelle LIKE '%—%';
UPDATE lephare_parametre SET aide = REPLACE(REPLACE(aide, ' — ', ' - '), '—', '-') WHERE aide LIKE '%—%';
UPDATE stdrepartitionprimesante SET libelle = REPLACE(REPLACE(libelle, ' — ', ' - '), '—', '-') WHERE libelle LIKE '%—%';
"""


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0187_sante_surprime_imposee_personne"),
        ("configuration_api", "0106_registre_devis_expires"),
    ]

    operations = [
        migrations.RunSQL(SQL, migrations.RunSQL.noop),
    ]
