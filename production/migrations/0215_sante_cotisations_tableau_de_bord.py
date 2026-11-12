# Consommations santé, tableau de bord (demande du 2026-11-06 : « un tableau de bord spécial pour suivre les états de consommation avec ces détails ;
# matérialiser dans l'application les besoins auxquels les fichiers répondent ») : contrôle de gestion de l'ETAT 2026 d'OREOLE.
# - lephare_sante_cotisation : état des cotisations par entreprise et par exercice (feuille DONNER de l'ETAT : primes, cotisation santé pure,
#   honoraires MCI, commissions, apporteurs, provision pour paiement des dépenses de santé) ; un nouvel état remplace celui de l'exercice ;
# - lephare_sante_entreprise_police : lien confirmé entre une entreprise de l'état et la police du gestionnaire (sinon lien proposé par les noms) ;
# - lephare_sante_releve : nature COTISATIONS ajoutée.
# Retour : python manage.py migrate production 0214 (efface ces deux tables).

from django.db import migrations

CREATION = """
CREATE TABLE public.lephare_sante_cotisation (
    exercice integer NOT NULL,
    entreprise varchar(150) NOT NULL,
    effectif integer,
    options varchar(30) NOT NULL DEFAULT '',
    prime_ht numeric(16, 2) NOT NULL DEFAULT 0,
    prime_ttc numeric(16, 2) NOT NULL DEFAULT 0,
    prime_ia numeric(16, 2) NOT NULL DEFAULT 0,
    prime_afa numeric(16, 2) NOT NULL DEFAULT 0,
    cotisation_pure numeric(16, 2) NOT NULL DEFAULT 0,
    honoraires numeric(16, 2) NOT NULL DEFAULT 0,
    commissions numeric(16, 2) NOT NULL DEFAULT 0,
    apporteurs numeric(16, 2) NOT NULL DEFAULT 0,
    provision numeric(16, 2) NOT NULL DEFAULT 0,
    idreleve integer REFERENCES public.lephare_sante_releve (idreleve),
    datemaj timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (exercice, entreprise)
);
COMMENT ON TABLE public.lephare_sante_cotisation IS 'État des cotisations santé par entreprise et par exercice (feuille DONNER de l''ETAT OREOLE)';

CREATE TABLE public.lephare_sante_entreprise_police (
    entreprise varchar(150) PRIMARY KEY,
    police varchar(150) NOT NULL DEFAULT '',
    auteur varchar(150) NOT NULL DEFAULT '',
    datemaj timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lephare_sante_entreprise_police IS 'Lien confirmé entre une entreprise de l''état des cotisations et la police du gestionnaire (police vide : aucune)';

ALTER TABLE public.lephare_sante_releve DROP CONSTRAINT IF EXISTS lephare_sante_releve_nature_check;
ALTER TABLE public.lephare_sante_releve ADD CONSTRAINT lephare_sante_releve_nature_check CHECK (nature IN ('PRESTATIONS', 'EFFECTIF', 'COTISATIONS'));
"""

SUPPRESSION = """
DROP TABLE IF EXISTS public.lephare_sante_entreprise_police;
DROP TABLE IF EXISTS public.lephare_sante_cotisation;
ALTER TABLE public.lephare_sante_releve DROP CONSTRAINT IF EXISTS lephare_sante_releve_nature_check;
ALTER TABLE public.lephare_sante_releve ADD CONSTRAINT lephare_sante_releve_nature_check CHECK (nature IN ('PRESTATIONS', 'EFFECTIF'));
"""


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0214_ia_montants_imposes"),
    ]

    operations = [migrations.RunSQL(CREATION, SUPPRESSION)]
