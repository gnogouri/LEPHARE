# Branche Vie : offres commerciales (demande du 2026-11-10 : « la branche de production est VIE, AFA est une offre
# commerciale ; une liste déroulante pour les offres : AFA, Retraite complémentaire, Temporaire décès… »).
# - lephare_vie_offre : offres proposées à la saisie d'un devis Vie, réglables dans l'administration (Réglages Vie) ;
#   « saisie » choisit le formulaire : CAPITAL = un assuré par ligne avec capital, prime et bénéficiaires (AFA, Temporaire
#   décès) ; COTISATION = un salarié par ligne avec sa part et celle de l'employeur (Retraite complémentaire, état mensuel
#   des cotisations importé ou saisi) ; idgarantie = sous-garantie des lignes du devis (231 DÉCÈS TOUTES CAUSES, 192 RENTE
#   À TERME comme les contrats de retraite de CI-ENERGIES repris d'URANUS).
# - lephare_vie_devis : offre de chaque devis Vie (un devis sans ligne est un devis AFA, comme ceux d'avant cette migration).
# - lephare_vie_cotisant : salariés d'un état de cotisations (matricule, nom, prénoms, part salariale, part employeur) ;
#   le devis porte une seule ligne de détail (total), comme les états mensuels d'URANUS.
# - Primes Vie exclues de l'arrondi à 5 F : la prime d'un état de cotisations doit être celle du fichier, au franc près.
# Retour : python manage.py migrate production 0218 (tables supprimées, arrondi des primes Vie rétabli).

from django.db import migrations

CREATION = """
CREATE TABLE IF NOT EXISTS public.lephare_vie_offre (
    idoffre serial PRIMARY KEY,
    code varchar(30) NOT NULL UNIQUE,
    libelle varchar(100) NOT NULL,
    saisie varchar(12) NOT NULL DEFAULT 'CAPITAL' CHECK (saisie IN ('CAPITAL', 'COTISATION')),
    periodicite varchar(16) NOT NULL DEFAULT 'ANNUELLE' CHECK (periodicite IN ('ANNUELLE', 'SEMESTRIELLE', 'TRIMESTRIELLE', 'MENSUELLE')),
    idgarantie integer NOT NULL DEFAULT 231,
    description varchar(500) NOT NULL DEFAULT '',
    actif boolean NOT NULL DEFAULT TRUE,
    ordre smallint NOT NULL DEFAULT 0,
    modifie_par varchar(150) NOT NULL DEFAULT '',
    date_modification timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lephare_vie_offre IS 'Offres commerciales de la branche Vie proposées à la saisie des devis (AFA, Retraite complémentaire, Temporaire décès…)';
COMMENT ON COLUMN public.lephare_vie_offre.saisie IS 'CAPITAL : assurés avec capital, prime et bénéficiaires ; COTISATION : salariés avec part salariale et part employeur';
COMMENT ON COLUMN public.lephare_vie_offre.idgarantie IS 'Sous-garantie (stdsousgarantie) portée par les lignes du devis';

INSERT INTO public.lephare_vie_offre (code, libelle, saisie, periodicite, idgarantie, description, ordre) VALUES
    ('AFA', 'AFA', 'CAPITAL', 'ANNUELLE', 231,
     'Contrat de groupe : un assuré par ligne avec son capital, sa prime et ses bénéficiaires ; liste Excel au modèle AFA.', 1),
    ('RETRAITE', 'Retraite complémentaire', 'COTISATION', 'MENSUELLE', 192,
     'État mensuel des cotisations : part salariale et part employeur de chaque salarié ; état Excel du souscripteur.', 2),
    ('TEMPORAIRE_DECES', 'Temporaire décès', 'CAPITAL', 'ANNUELLE', 231,
     'Capital versé en cas de décès pendant la durée du contrat : un assuré par ligne avec son capital, sa prime et ses bénéficiaires.', 3)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.lephare_vie_devis (
    iddevis integer PRIMARY KEY,
    idoffre integer NOT NULL REFERENCES public.lephare_vie_offre (idoffre),
    fichier varchar(200) NOT NULL DEFAULT '',
    date_creation timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lephare_vie_devis IS 'Offre commerciale de chaque devis Vie (sans ligne : AFA) et fichier importé';

CREATE TABLE IF NOT EXISTS public.lephare_vie_cotisant (
    id serial PRIMARY KEY,
    iddevis integer NOT NULL,
    ordre integer NOT NULL DEFAULT 0,
    matricule varchar(30) NOT NULL DEFAULT '',
    nom varchar(100) NOT NULL DEFAULT '',
    prenoms varchar(150) NOT NULL DEFAULT '',
    cotisation_salarie numeric(14, 2) NOT NULL DEFAULT 0 CHECK (cotisation_salarie >= 0),
    cotisation_employeur numeric(14, 2) NOT NULL DEFAULT 0 CHECK (cotisation_employeur >= 0),
    observation varchar(200) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS lephare_vie_cotisant_devis ON public.lephare_vie_cotisant (iddevis, ordre);
COMMENT ON TABLE public.lephare_vie_cotisant IS 'Salariés d''un état de cotisations Vie (Retraite complémentaire) : part salariale et part employeur';

UPDATE public.lephare_produit_parametre SET arrondittc = FALSE WHERE idproduit = 10;
"""

SUPPRESSION = """
UPDATE public.lephare_produit_parametre SET arrondittc = TRUE WHERE idproduit = 10;
DROP TABLE IF EXISTS public.lephare_vie_cotisant;
DROP TABLE IF EXISTS public.lephare_vie_devis;
DROP TABLE IF EXISTS public.lephare_vie_offre;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0218_rafas"),
    ]

    operations = [migrations.RunSQL(CREATION, SUPPRESSION)]
