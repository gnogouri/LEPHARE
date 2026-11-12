# Affaires antérieures soldées (consigne du 2026-10-27 : « toutes les contrats saisis en affaire antérieure sont encaissés
# donc commission perçue ») : quittances reprises encaissées, reste porté au solde des clients retiré, commissions notées
# perçues. La reprise enregistre désormais chaque affaire ainsi (production/reprise.py).
# Retour : python manage.py migrate production 0185 (les données restent soldées)

from django.db import migrations

SQL = """
-- TTC du document gardée : pas d'arrondi à 5 F pendant la mise à jour (trg_fn_lephare_arrondi_primettc v2)
SELECT set_config('lephare.reprise', 'on', true);
WITH restes AS (
    SELECT q.idquittance, q.idclient, q.primettc - COALESCE(q.mt_encaisse, 0) AS reste
    FROM lephare_reprise r JOIN stdquittance q ON q.idquittance = r.idquittance
    WHERE q.primettc - COALESCE(q.mt_encaisse, 0) > 0
), clients AS (
    UPDATE stdclient c SET solde = COALESCE(c.solde, 0) - s.reste
    FROM (SELECT idclient, SUM(reste) AS reste FROM restes GROUP BY idclient) s
    WHERE c.idclient = s.idclient
)
UPDATE stdquittance q SET mt_encaisse = q.primettc, encaissee = true
FROM restes WHERE q.idquittance = restes.idquittance;
UPDATE lephare_reprise SET commission_percue = true WHERE NOT commission_percue;
SELECT set_config('lephare.reprise', 'off', true);
"""


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0185_alerte_echeance_devis"),
    ]

    operations = [
        migrations.RunSQL(SQL, migrations.RunSQL.noop),
    ]
