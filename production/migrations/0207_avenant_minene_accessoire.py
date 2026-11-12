# Santé MINENE : détail de la prime d'une incorporation (demande du 2026-11-05, police 1186123263204W : 200 000 F TTC = prime nette
# 176 185 F + accessoire 9 000 F + taxes 14 815 F, et non 185 185 F + 0 F + 14 815 F).
# - sp_creation_devis_sante v12 : accessoire du barème appliqué à la prime de l'avenant, pris dans l'écart entre les formules ; le TTC
#   ne change pas. Autres offres Santé : inchangées.
# - Avenant déjà émis de cette police, s'il porte encore l'ancien détail et n'a pas été reversé : même détail sur le devis, le contrat,
#   leurs garanties, la quittance et ses lignes d'encaissement. TTC, encaissé et solde du client ne bougent pas.
# Retour : v11 pour la procédure ; le détail corrigé reste (les valeurs d'avant sont écrites ci-dessus).

from django.db import migrations

from uranus.utils.migrations import load_sql_upgrade

POLICE = "1186123263204W"
PRIME_NETTE, ACCESSOIRE, TAXE_GARANTIE, TAXE = 176185, 9000, 14095, 14815


def corriger_avenant(apps, schema_editor):
    with schema_editor.connection.cursor() as c:
        c.execute(
            """SELECT ct.idcontrat, ct.iddevis, ct.idquittance, COALESCE(ct.taux_commission, 0), q.numeroquittance
               FROM stdcontrat ct JOIN stdavenant a ON a.idavenant = ct.idavenant JOIN stdquittance q ON q.idquittance = ct.idquittance
               WHERE ct.numeropolice = %s AND a.codeavenant = 'MOD' AND COALESCE(ct.idcontratannulation, 0) = 0
                 AND ROUND(ct.primenette) = 185185 AND COALESCE(ct.accessoire, 0) = 0 AND ROUND(ct.taxe) = 14815 AND ROUND(ct.primettc) = 200000
                 AND NOT EXISTS (SELECT 1 FROM stddetailreversement dr JOIN stddetailencaissement de ON de.iddetailencaissement = dr.iddetailencaissement
                                 WHERE de.numeroquittance = q.numeroquittance)""",
            [POLICE],
        )
        for id_contrat, id_devis, id_quittance, taux, numero in c.fetchall():
            commission = round(PRIME_NETTE * float(taux) / 100)
            c.execute(
                """UPDATE stddevisdetgarantie g SET primenette = %s, taxe = %s FROM stddevisdetail d
                   WHERE d.iddevisdetail = g.iddevisdet AND d.iddevis = %s AND g.idgarantie = 98""",
                [PRIME_NETTE, TAXE_GARANTIE, id_devis])
            c.execute("UPDATE stddevisdetail SET primenette = %s, taxeenregistrement = %s WHERE iddevis = %s", [PRIME_NETTE, TAXE_GARANTIE, id_devis])
            c.execute(
                """UPDATE stddevis SET primenette = %s, accessoire = %s, accessoirecompagnie = %s, accessoireintermediaire = 0, taxe = %s,
                   commissionintermediaire = %s WHERE iddevis = %s""",
                [PRIME_NETTE, ACCESSOIRE, ACCESSOIRE, TAXE, commission, id_devis])
            c.execute(
                """UPDATE stdcontratdetgarantie g SET primenette = %s, taxe = %s FROM stdcontratdetail d
                   WHERE d.idcontratdetail = g.idcontratdetail AND d.idcontrat = %s AND g.idgarantie = 98""",
                [PRIME_NETTE, TAXE_GARANTIE, id_contrat])
            c.execute("UPDATE stdcontratdetail SET primenette = %s, taxeenregistrement = %s WHERE idcontrat = %s", [PRIME_NETTE, TAXE_GARANTIE, id_contrat])
            c.execute(
                """UPDATE stdcontrat SET primenette = %s, accessoire = %s, accessoirecompagnie = %s, accessoireintermediaire = 0, taxe = %s,
                   commissionintermediaire = %s WHERE idcontrat = %s""",
                [PRIME_NETTE, ACCESSOIRE, ACCESSOIRE, TAXE, commission, id_contrat])
            c.execute("UPDATE stdquittance SET primenette = %s, accessoire = %s, taxe = %s WHERE idquittance = %s", [PRIME_NETTE, ACCESSOIRE, TAXE, id_quittance])
            # Le contrat partage l'accessoire entre la compagnie et le cabinet (déclencheur) : ses lignes d'encaissement reprennent cette part
            c.execute(
                """UPDATE stddetailencaissement SET comintermediaire = %s,
                   accintermediaire = (SELECT accessoireintermediaire FROM stdcontrat WHERE idcontrat = %s) WHERE numeroquittance = %s""",
                [commission, id_contrat, numero])


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0206_incorporation_ia_minene_une_personne"),
    ]

    operations = [
        migrations.RunSQL(*load_sql_upgrade(__file__, "procedures/sp_creation_devis_sante", from_version=11, to_version=12)),
        migrations.RunPython(corriger_avenant, migrations.RunPython.noop),
    ]
