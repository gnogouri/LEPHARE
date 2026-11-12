# Incorporation d'un véhicule dans une flotte Automobile en cours (cahier des charges, 2026-11-02) :
# - fn_calcul_taux_prime_fractionnee v3 : sous le réglage de session lephare.incorporation (posé par
#   production/incorporation.py), « prorata » = prime annuelle × jours couverts jusqu'à l'échéance du contrat / 365 (366),
#   au lieu des coefficients de courte durée (332 jours = 93 % au lieu de 90,96 %) ; « forfait » = prime annuelle
#   entière, aucun prorata (affaire à tarif forfaitaire : montant du fichier Excel repris tel quel) ;
# - lephare_incorporation : mode de tarification choisi pour chaque devis d'incorporation (sans ligne : prorata).
# Retour : python manage.py migrate production 0192

from django.db import migrations

from uranus.utils.migrations import load_sql_upgrade

TABLE = """
CREATE TABLE IF NOT EXISTS public.lephare_incorporation (
    iddevis integer PRIMARY KEY,
    idcontrat integer NOT NULL,
    forfaitaire boolean NOT NULL DEFAULT false,
    idutilisateur integer,
    datecreation timestamp with time zone NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lephare_incorporation IS
    'Devis d''incorporation (avenant INC) : forfaitaire = primes du fichier Excel reprises sans prorata';
"""

RETRAIT_TABLE = "DROP TABLE IF EXISTS public.lephare_incorporation;"


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0192_encaissement_reliquat_negligeable"),
    ]

    operations = [
        migrations.RunSQL(*load_sql_upgrade(__file__, "functions/fn_calcul_taux_prime_fractionnee", from_version=2, to_version=3)),
        migrations.RunSQL(TABLE, RETRAIT_TABLE),
    ]
