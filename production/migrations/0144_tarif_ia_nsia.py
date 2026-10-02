# Applique le tarif Individuelle Accidents NSIA (document « TARIF IA_NSIA CI.xlsx » reçu
# d'OREOLE) aux devis IA de NSIA ASSURANCES (compagnie 1), offres au barème (particulier 6,
# groupe 7, base de répartition des primes imposées 173/174) :
#   - primes : taux décès / invalidité (‰) et frais médicaux (%) de la classe d'activité, sans
#     majoration d'âge (fn_calcul_prime_ia_nsia) ; les autres compagnies gardent le barème
#     d'URANUS (fn_calcul_prime_ia_by_age) ;
#   - accessoires : grille du tarif IA NSIA (fn_get_accessoire_ia_nsia), moitié compagnie /
#     moitié courtier ; MINENE (66), CGA (154-156) et CI-ENERGIES (162-170) inchangés.
# Retour au barème d'URANUS : python manage.py migrate production 0143

from django.db import migrations
from uranus.utils.migrations import load_sql_upgrade, load_sql_version


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0143_encaissement_complements_cheques_echeancier"),
    ]

    operations = [
        migrations.RunSQL(
            sql=load_sql_version(__file__, "functions/fn_calcul_prime_ia_nsia", 1),
            reverse_sql="DROP FUNCTION IF EXISTS public.fn_calcul_prime_ia_nsia(character varying, numeric, numeric, numeric);",
        ),
        migrations.RunSQL(
            sql=load_sql_version(__file__, "functions/fn_get_accessoire_ia_nsia", 1),
            reverse_sql="DROP FUNCTION IF EXISTS public.fn_get_accessoire_ia_nsia(numeric);",
        ),
        migrations.RunSQL(
            *load_sql_upgrade(__file__, "functions/fn_get_accessoire", from_version=2, to_version=3)
        ),
        migrations.RunSQL(
            *load_sql_upgrade(__file__, "functions/fn_garantie_offre_ia", from_version=1, to_version=2)
        ),
    ]
