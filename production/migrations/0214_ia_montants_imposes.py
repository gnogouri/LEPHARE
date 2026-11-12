# Individuelle Accidents (demande du 2026-11-06) : « au renouvellement tu fais un calcul et à l'import du fichier Excel tu ne prends pas les montants
# exacts du fichier ». Montants connus de chaque assuré gardés à part et réappliqués après chaque calcul du devis (production/ia_montants_imposes.py) :
# - FICHIER : PRIME HT et PRIME TTC du fichier importé (accessoire = TTC / (1 + taux de taxe) - HT, taxe = TTC - HT - accessoire) ;
# - RENOUVELLEMENT : montants de l'assuré sur le contrat renouvelé (reconduits à l'identique).
# Une ligne dont les capitaux ou l'offre changent, ou dont la prime est saisie à la main, perd son montant gardé et repart au tarif.
# Retour : python manage.py migrate production 0213 (les devis gardent leurs montants ; ils ne sont simplement plus réappliqués).

from django.db import migrations

CREATION = """
CREATE TABLE public.lephare_ia_montants_imposes (
    iddevis integer NOT NULL,
    matricule varchar(30) NOT NULL,
    primenette numeric(18, 2) NOT NULL CHECK (primenette >= 0),
    accessoire numeric(18, 2) NOT NULL DEFAULT 0 CHECK (accessoire >= 0),
    primettc numeric(18, 2) NOT NULL CHECK (primettc >= 0),
    capitaldeces numeric(18, 2),
    capitalinfirmite numeric(18, 2),
    idoffre integer,
    source varchar(15) NOT NULL CHECK (source IN ('FICHIER', 'RENOUVELLEMENT')),
    datecreation timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (iddevis, matricule)
);
COMMENT ON TABLE public.lephare_ia_montants_imposes IS 'IA : montants exacts de chaque assuré (fichier importé ou contrat renouvelé), réappliqués après chaque calcul du devis';
"""

SUPPRESSION = "DROP TABLE IF EXISTS public.lephare_ia_montants_imposes;"


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0213_decaissements_reglements"),
    ]

    operations = [migrations.RunSQL(CREATION, SUPPRESSION)]
