# Suivi des consommations santé (mission OREOLE SANTÉ du 2026-11-05) : relevés de prestations et effectifs du gestionnaire MCI CARE, barèmes par collège,
# instruction des suspicions de fraude. Module sante/consommations.py ; routes /api/consommations/*.
# - lephare_sante_releve : chaque fichier importé (relevé de prestations ou effectif) ;
# - lephare_sante_prestation : une ligne par prestation (NUMERO_PREST unique), date de soins d'origine et date retenue (inversion jour/mois corrigée) ;
# - lephare_sante_prestation_ecart : prestation déjà connue dont un relevé suivant change un montant (signalé, jamais écrasé) ;
# - lephare_sante_effectif : bénéficiaires du gestionnaire (sorties datées à l'import d'un effectif plus récent du même garant) ;
# - lephare_sante_bareme et lephare_sante_college : plafonds des barèmes A et B d'OREOLE et collège -> barème (hypothèse à valider, modifiable) ;
# - lephare_sante_suspicion : décision d'instruction des suspicions de fraude par bénéficiaire.
# Retour : python manage.py migrate production 0211 (efface ces tables et leurs données).

from django.db import migrations

CREATION = """
CREATE TABLE public.lephare_sante_releve (
    idreleve serial PRIMARY KEY,
    nature varchar(12) NOT NULL CHECK (nature IN ('PRESTATIONS', 'EFFECTIF')),
    fichier varchar(255) NOT NULL DEFAULT '',
    garants varchar(150) NOT NULL DEFAULT '',
    lignes integer NOT NULL DEFAULT 0,
    nouvelles integer NOT NULL DEFAULT 0,
    connues integer NOT NULL DEFAULT 0,
    modifiees integer NOT NULL DEFAULT 0,
    dates_corrigees integer NOT NULL DEFAULT 0,
    cloture_du date,
    cloture_au date,
    idoperateur integer,
    operateur varchar(150) NOT NULL DEFAULT '',
    dateimport timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lephare_sante_releve IS 'Fichiers du gestionnaire santé importés : relevés de prestations et effectifs';

CREATE TABLE public.lephare_sante_prestation (
    numero_prest bigint PRIMARY KEY,
    idreleve integer REFERENCES public.lephare_sante_releve (idreleve),
    date_cloture date,
    numero_garant integer,
    garant varchar(60) NOT NULL DEFAULT '',
    souscripteur varchar(150) NOT NULL DEFAULT '',
    npol integer,
    police varchar(150) NOT NULL DEFAULT '',
    college varchar(80) NOT NULL DEFAULT '',
    matricule_beneficiaire bigint,
    beneficiaire varchar(200) NOT NULL DEFAULT '',
    statut char(1) NOT NULL DEFAULT '',
    date_naissance date,
    matricule_assure bigint,
    assure varchar(200) NOT NULL DEFAULT '',
    centre_prescripteur varchar(200) NOT NULL DEFAULT '',
    code_centre varchar(30) NOT NULL DEFAULT '',
    centre_executant varchar(200) NOT NULL DEFAULT '',
    famille varchar(80) NOT NULL DEFAULT '',
    acte varchar(20) NOT NULL DEFAULT '',
    medecin varchar(200) NOT NULL DEFAULT '',
    date_soins date,
    date_soins_retenue date,
    date_reception date,
    type varchar(5) NOT NULL DEFAULT '',
    mt_reclame numeric(14, 2) NOT NULL DEFAULT 0,
    base_decomptee numeric(14, 2) NOT NULL DEFAULT 0,
    ticket_moderateur numeric(6, 2) NOT NULL DEFAULT 0,
    exclusion numeric(14, 2) NOT NULL DEFAULT 0,
    depassement numeric(14, 2) NOT NULL DEFAULT 0,
    mt_rembourse numeric(14, 2) NOT NULL DEFAULT 0,
    datecreation timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lephare_sante_prestation_assure ON public.lephare_sante_prestation (matricule_assure);
CREATE INDEX lephare_sante_prestation_beneficiaire ON public.lephare_sante_prestation (matricule_beneficiaire);
CREATE INDEX lephare_sante_prestation_police ON public.lephare_sante_prestation (police);
CREATE INDEX lephare_sante_prestation_cloture ON public.lephare_sante_prestation (date_cloture);
COMMENT ON TABLE public.lephare_sante_prestation IS 'Prestations de santé des relevés du gestionnaire (données de santé : accès par le droit consommations.view)';

CREATE TABLE public.lephare_sante_prestation_ecart (
    idecart serial PRIMARY KEY,
    numero_prest bigint NOT NULL,
    idreleve integer REFERENCES public.lephare_sante_releve (idreleve),
    champ varchar(40) NOT NULL,
    ancienne varchar(100) NOT NULL DEFAULT '',
    nouvelle varchar(100) NOT NULL DEFAULT '',
    datecreation timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.lephare_sante_effectif (
    matricule_beneficiaire bigint PRIMARY KEY,
    matricule_assure bigint,
    garant varchar(60) NOT NULL DEFAULT '',
    police varchar(150) NOT NULL DEFAULT '',
    college varchar(80) NOT NULL DEFAULT '',
    nom varchar(100) NOT NULL DEFAULT '',
    prenoms varchar(150) NOT NULL DEFAULT '',
    statut char(1) NOT NULL DEFAULT '',
    genre char(1) NOT NULL DEFAULT '',
    date_naissance date,
    date_effet date,
    actif boolean NOT NULL DEFAULT TRUE,
    date_sortie date,
    idreleve integer REFERENCES public.lephare_sante_releve (idreleve),
    datemaj timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lephare_sante_effectif_assure ON public.lephare_sante_effectif (matricule_assure);

CREATE TABLE public.lephare_sante_bareme (
    code varchar(10) PRIMARY KEY,
    libelle varchar(100) NOT NULL,
    plafond_annuel_famille numeric(14, 2) NOT NULL DEFAULT 0,
    chambre_jour numeric(14, 2) NOT NULL DEFAULT 0,
    ambulance_cas numeric(14, 2) NOT NULL DEFAULT 0,
    accouchement_simple numeric(14, 2) NOT NULL DEFAULT 0,
    accouchement_gemellaire numeric(14, 2) NOT NULL DEFAULT 0,
    accouchement_chirurgical numeric(14, 2) NOT NULL DEFAULT 0,
    accouchement_hors_structure numeric(14, 2) NOT NULL DEFAULT 0,
    optique_adulte numeric(14, 2) NOT NULL DEFAULT 0,
    optique_enfant numeric(14, 2) NOT NULL DEFAULT 0,
    dentaire_an_personne numeric(14, 2) NOT NULL DEFAULT 0,
    source varchar(300) NOT NULL DEFAULT ''
);
INSERT INTO public.lephare_sante_bareme VALUES
    ('A', 'Barème A - plafond annuel 2 500 000 F', 2500000, 20000, 20000, 150000, 200000, 300000, 50000, 50000, 40000, 80000,
     'TARIF ET BAREME MICROASSURANCE OREOLE SANTE 264 000 à 436 800 F ; offre particuliers 600 000 F'),
    ('B', 'Barème B - plafond annuel 5 000 000 F', 5000000, 30000, 30000, 200000, 250000, 350000, 80000, 70000, 50000, 100000,
     'TARIF ET BAREME MICROASSURANCE OREOLE SANTE 575 000 F ; 03 OPTIONS (options 2 et 3) ; offre particuliers 850 000 F');

CREATE TABLE public.lephare_sante_college (
    college varchar(80) PRIMARY KEY,
    code_bareme varchar(10) NOT NULL REFERENCES public.lephare_sante_bareme (code),
    justification varchar(300) NOT NULL DEFAULT ''
);
INSERT INTO public.lephare_sante_college VALUES
    ('OPTION 1', 'A', 'Hypothèse : plafonds du barème A observés'),
    ('OPTION 2', 'B', 'Hypothèse : optique plafonnée à 70 000 F'),
    ('OPTION 3', 'A', 'Optique 50 000, dentaire 80 000, maternité 300 000 observés'),
    ('OPTION 3 NOUVEAU BAREME', 'A', 'Hypothèse ; optique observée à 100 000 F, non documentée'),
    ('OPTION 4', 'B', 'Prime HT 300 000 F (offre 575 000 F) ; maternité 350 000 observée ; optique observée à 100 000 F'),
    ('COLLEGE 100% ME', 'A', 'Hypothèse'),
    ('PHCIE 400 000', 'A', 'Offre 400 000 F, barème A');

CREATE TABLE public.lephare_sante_suspicion (
    matricule_beneficiaire bigint PRIMARY KEY,
    statut varchar(15) NOT NULL DEFAULT 'A_INSTRUIRE' CHECK (statut IN ('A_INSTRUIRE', 'JUSTIFIE', 'FRAUDE', 'SANS_SUITE')),
    observation varchar(500) NOT NULL DEFAULT '',
    auteur varchar(150) NOT NULL DEFAULT '',
    datemaj timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lephare_sante_suspicion IS 'Instruction des suspicions de fraude : décision humaine, jamais automatique';
"""

SUPPRESSION = """
DROP TABLE IF EXISTS public.lephare_sante_suspicion;
DROP TABLE IF EXISTS public.lephare_sante_college;
DROP TABLE IF EXISTS public.lephare_sante_bareme;
DROP TABLE IF EXISTS public.lephare_sante_effectif;
DROP TABLE IF EXISTS public.lephare_sante_prestation_ecart;
DROP TABLE IF EXISTS public.lephare_sante_prestation;
DROP TABLE IF EXISTS public.lephare_sante_releve;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0211_oreole_accessoires_chargement"),
    ]

    operations = [migrations.RunSQL(CREATION, SUPPRESSION)]
