# Décaissement de tout règlement (demande du 2026-11-06) : jusqu'ici seul un chèque revenu impayé se décaissait (stdcheque) ; espèces, virement,
# paiement mobile, carte, traite et compensations se décaissent aussi, depuis le portefeuille des règlements (production/decaissements.py).
# - lephare_decaissement : un règlement décaissé (son encaissement est contre-passé par sp_annulation_encaissement, ses quittances redeviennent
#   à encaisser), avec le motif, la date, l'opérateur et la contre-passation créée ;
# - lephare_decaissement_reencaissement : encaissements qui réencaissent un décaissement (le montant réencaissé se lit sur les encaissements
#   non annulés, jamais stocké) ;
# - un réencaissement décaissé à son tour est reporté sur le décaissement ou le chèque impayé d'origine (iddecaissementorigine,
#   idchequeorigine) : la somme n'est pas à réencaisser deux fois.
# Retour : python manage.py migrate production 0212 (efface ces tables ; les contre-passations restent dans stdencaissement).

from django.db import migrations

CREATION = """
CREATE TABLE public.lephare_decaissement (
    iddecaissement serial PRIMARY KEY,
    idencaissement integer NOT NULL UNIQUE,
    idencaissementannulation integer,
    numeropiece varchar(20) NOT NULL DEFAULT '',
    idmodepaiement integer,
    mode varchar(100) NOT NULL DEFAULT '',
    reference varchar(100) NOT NULL DEFAULT '',
    montant numeric(18, 2) NOT NULL CHECK (montant > 0),
    motif varchar(255) NOT NULL,
    datedecaissement date NOT NULL,
    quittances varchar(500) NOT NULL DEFAULT '',
    clients varchar(500) NOT NULL DEFAULT '',
    iddecaissementorigine integer REFERENCES public.lephare_decaissement (iddecaissement),
    idchequeorigine integer,
    idoperateur integer,
    operateur varchar(150) NOT NULL DEFAULT '',
    datecreation timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lephare_decaissement IS 'Règlements décaissés hors chèques du portefeuille : encaissement contre-passé, quittances de nouveau à encaisser';

CREATE TABLE public.lephare_decaissement_reencaissement (
    iddecaissement integer NOT NULL REFERENCES public.lephare_decaissement (iddecaissement),
    idencaissement integer NOT NULL,
    datecreation timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (iddecaissement, idencaissement)
);
"""

SUPPRESSION = """
DROP TABLE IF EXISTS public.lephare_decaissement_reencaissement;
DROP TABLE IF EXISTS public.lephare_decaissement;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0212_sante_consommations"),
    ]

    operations = [migrations.RunSQL(CREATION, SUPPRESSION)]
