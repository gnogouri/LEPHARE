# Administration des contrats : corriger la période d'un contrat mettait à jour le contrat et sa quittance, pas son devis.
# Or sp_creation_devis_sante lit la période dans le devis de base : tout avenant Santé sur ce contrat était refusé
# (« L'avenant prend fin à l'échéance du contrat », demande du 2026-11-03, police 1186123263206P).
# La vue aligne désormais le devis ; cette migration réaligne sur leur contrat les devis déjà décalés.
# Retour : sans effet (les dates d'avant restent au journal des corrections).

from django.db import migrations

SQL_ALIGNEMENT = """
    UPDATE stddevis AS d
    SET dateeffet = c.dateeffet, dateexpiration = c.dateexpiration
    FROM stdcontrat AS c
    WHERE c.iddevis = d.iddevis
      AND (c.dateeffet::date <> d.dateeffet::date OR c.dateexpiration::date <> d.dateexpiration::date)
      AND NOT EXISTS (SELECT 1 FROM stdcontrat AS x WHERE x.iddevis = d.iddevis AND x.idcontrat <> c.idcontrat)
"""


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0198_avenant_sante_forfait_sans_prorata"),
    ]

    operations = [
        migrations.RunSQL(SQL_ALIGNEMENT, migrations.RunSQL.noop),
    ]
