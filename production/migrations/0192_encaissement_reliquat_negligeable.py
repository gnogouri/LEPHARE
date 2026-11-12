# Petits écarts dans les encaissements (cahier des charges, 2026-11-02) : un reste à payer de 1 à 4 F (ou de quelques
# centimes) est compté comme nul, pour qu'un très faible écart ne bloque ni le solde de la quittance ni la suite.
# - sp_enregistrement_encaissement v6 : quittance marquée encaissée dès que le reste après l'encaissement est
#   inférieur à 5 F (Mt_Encaisse garde le montant reçu) ;
# - quittances déjà encaissées à un reliquat près (15 en base le 2026-11-02, reprises d'URANUS) : marquées encaissées.
# Calculs du reste côté application : production/reste_encaissement.py.
# Retour : python manage.py migrate production 0191 (les quittances reviennent à « non encaissée »)

from django.db import migrations

from uranus.utils.migrations import load_sql_upgrade

RELIQUATS = "q.primettc - COALESCE(q.mt_encaisse, 0) > 0 AND q.primettc - COALESCE(q.mt_encaisse, 0) < 5 AND COALESCE(q.mt_encaisse, 0) > 0"

QUITTANCES_SOLDEES = f"UPDATE stdquittance q SET encaissee = true WHERE NOT COALESCE(q.encaissee, false) AND {RELIQUATS};"
QUITTANCES_NON_SOLDEES = f"UPDATE stdquittance q SET encaissee = false WHERE q.encaissee AND {RELIQUATS};"


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0191_renouvellement_auto_caracteristiques"),
    ]

    operations = [
        migrations.RunSQL(*load_sql_upgrade(__file__, "procedures/sp_enregistrement_encaissement", from_version=5, to_version=6)),
        migrations.RunSQL(QUITTANCES_SOLDEES, QUITTANCES_NON_SOLDEES),
    ]
