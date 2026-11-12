# Branche RAFAS (Régime autofinancé d'assurance santé, demande du 2026-11-10 ; modèle : convention RAFAS EXAT AGRICULTURE 2024-2025, avenant
# n°1 2025-2026 et étude « RAPPORT COMPLET EXAT FEVRIER-JUIN 2026 »). Le souscripteur finance lui-même les dépenses de santé de son personnel :
# il met une provision à la disposition du courtier par appels de fonds, le gestionnaire (VITALIS SANTE) traite et paie les prestations, et
# les cotisations par famille de chaque collège servent de base aux honoraires du gestionnaire (8,5 %) et à la commission du courtier (6,5 %,
# chiffre d'affaires d'OREOLE).
# - lephare_rafas_convention / _exercice / _college : convention, périodes (convention de base puis avenants de renouvellement), collèges avec
#   cotisation par famille, nombre de familles, plafond annuel par famille et barème de prise en charge ;
# - lephare_rafas_college_gestionnaire : collèges du gestionnaire (codes de ses fichiers) rattachés à un collège de la convention et à une zone ;
# - lephare_rafas_import, _beneficiaire, _prestation : effectifs (une photo par date de situation) et relevés de prestations du gestionnaire ;
# - lephare_rafas_appel, _versement, _honoraire : fonds du régime (appels de fonds, versements du souscripteur) et honoraires facturés.
# Retour : python manage.py migrate production 0217 (efface les tables).

from django.db import migrations

CREATION = """
CREATE TABLE public.lephare_rafas_convention (
    idconvention serial PRIMARY KEY,
    idclient integer,
    souscripteur varchar(200) NOT NULL,
    adresse varchar(200) NOT NULL DEFAULT '',
    contact varchar(100) NOT NULL DEFAULT '',
    representant varchar(150) NOT NULL DEFAULT '',
    gestionnaire varchar(100) NOT NULL DEFAULT 'VITALIS SANTE',
    code_garant varchar(30) NOT NULL DEFAULT '',
    numero_client varchar(30) NOT NULL DEFAULT '',
    polices varchar(200) NOT NULL DEFAULT '',
    nature_risque varchar(100) NOT NULL DEFAULT 'SANTE : REGIME AUTOFINANCE',
    taux_soins numeric(5, 2) NOT NULL DEFAULT 80,
    taux_hospitalisation numeric(5, 2) NOT NULL DEFAULT 80,
    territoire varchar(100) NOT NULL DEFAULT 'Côte d''Ivoire',
    composition_famille varchar(100) NOT NULL DEFAULT 'Mr + Mme + 4 enfants',
    enfants_max smallint NOT NULL DEFAULT 4,
    age_adulte smallint NOT NULL DEFAULT 60,
    age_enfant smallint NOT NULL DEFAULT 21,
    age_etudiant smallint NOT NULL DEFAULT 25,
    preavis_mois smallint NOT NULL DEFAULT 2,
    delai_remboursement_mois smallint NOT NULL DEFAULT 3,
    delai_contestation_jours smallint NOT NULL DEFAULT 30,
    statut varchar(12) NOT NULL DEFAULT 'EN_VIGUEUR' CHECK (statut IN ('EN_VIGUEUR', 'RESILIEE')),
    observations text NOT NULL DEFAULT '',
    idoperateur integer,
    date_creation timestamptz NOT NULL DEFAULT now(),
    date_modification timestamptz
);
COMMENT ON TABLE public.lephare_rafas_convention IS 'RAFAS : convention de gestion d''un régime autofinancé d''assurance santé';
COMMENT ON COLUMN public.lephare_rafas_convention.code_garant IS 'Code du souscripteur chez le gestionnaire (colonne CodGar de ses fichiers)';

CREATE TABLE public.lephare_rafas_exercice (
    idexercice serial PRIMARY KEY,
    idconvention integer NOT NULL REFERENCES public.lephare_rafas_convention (idconvention) ON DELETE CASCADE,
    rang smallint NOT NULL DEFAULT 0,
    date_effet date NOT NULL,
    date_echeance date NOT NULL CHECK (date_echeance > date_effet),
    taux_honoraires numeric(5, 2) NOT NULL DEFAULT 8.5,
    taux_commission numeric(5, 2) NOT NULL DEFAULT 6.5,
    mois_provision smallint NOT NULL DEFAULT 3,
    seuil_alerte_mois numeric(4, 1) NOT NULL DEFAULT 1,
    date_signature date,
    observations text NOT NULL DEFAULT '',
    UNIQUE (idconvention, date_effet)
);
COMMENT ON COLUMN public.lephare_rafas_exercice.rang IS '0 : convention de base ; n : avenant de renouvellement n';

CREATE TABLE public.lephare_rafas_college (
    idcollege serial PRIMARY KEY,
    idexercice integer NOT NULL REFERENCES public.lephare_rafas_exercice (idexercice) ON DELETE CASCADE,
    code varchar(40) NOT NULL,
    libelle varchar(150) NOT NULL,
    categorie varchar(10) NOT NULL DEFAULT 'AM/O' CHECK (categorie IN ('AM/O', 'CADRES')),
    cotisation numeric(14, 0) NOT NULL DEFAULT 0 CHECK (cotisation >= 0),
    familles integer NOT NULL DEFAULT 0 CHECK (familles >= 0),
    plafond_famille numeric(14, 0),
    bareme jsonb NOT NULL DEFAULT '[]'::jsonb,
    ordre smallint NOT NULL DEFAULT 0,
    UNIQUE (idexercice, code)
);
COMMENT ON COLUMN public.lephare_rafas_college.code IS 'Code stable du collège d''un exercice à l''autre (lien des collèges du gestionnaire)';

CREATE TABLE public.lephare_rafas_college_gestionnaire (
    idconvention integer NOT NULL REFERENCES public.lephare_rafas_convention (idconvention) ON DELETE CASCADE,
    code_college integer NOT NULL,
    libelle varchar(150) NOT NULL DEFAULT '',
    police varchar(150) NOT NULL DEFAULT '',
    idpolice integer,
    college varchar(40) NOT NULL DEFAULT '',
    categorie varchar(10) NOT NULL DEFAULT '',
    zone varchar(60) NOT NULL DEFAULT '',
    PRIMARY KEY (idconvention, code_college)
);

CREATE TABLE public.lephare_rafas_import (
    idimport serial PRIMARY KEY,
    idconvention integer NOT NULL REFERENCES public.lephare_rafas_convention (idconvention) ON DELETE CASCADE,
    nature varchar(10) NOT NULL CHECK (nature IN ('EFFECTIF', 'SINISTRES')),
    fichier varchar(255) NOT NULL DEFAULT '',
    feuille varchar(120) NOT NULL DEFAULT '',
    lignes integer NOT NULL DEFAULT 0,
    situation date,
    mois_du date,
    mois_au date,
    montant numeric(16, 0) NOT NULL DEFAULT 0,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    idoperateur integer,
    operateur varchar(150) NOT NULL DEFAULT '',
    date_import timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.lephare_rafas_import.situation IS 'Effectif : date de situation (effectif à jour au)';

CREATE TABLE public.lephare_rafas_beneficiaire (
    idimport integer NOT NULL REFERENCES public.lephare_rafas_import (idimport) ON DELETE CASCADE,
    matricule bigint NOT NULL,
    matricule_adherent bigint,
    adherent varchar(150) NOT NULL DEFAULT '',
    nom varchar(200) NOT NULL DEFAULT '',
    date_naissance date,
    sexe varchar(1) NOT NULL DEFAULT '',
    lien varchar(1) NOT NULL DEFAULT '',
    idpolice integer,
    police varchar(150) NOT NULL DEFAULT '',
    code_college integer,
    college varchar(150) NOT NULL DEFAULT '',
    date_effet date,
    date_entree date,
    date_sortie date,
    motif_sortie varchar(120) NOT NULL DEFAULT '',
    etat varchar(40) NOT NULL DEFAULT '',
    PRIMARY KEY (idimport, matricule)
);

CREATE TABLE public.lephare_rafas_prestation (
    idprestation bigserial PRIMARY KEY,
    idconvention integer NOT NULL REFERENCES public.lephare_rafas_convention (idconvention) ON DELETE CASCADE,
    idimport integer REFERENCES public.lephare_rafas_import (idimport) ON DELETE SET NULL,
    mois date NOT NULL,
    numero bigint,
    matricule bigint NOT NULL,
    matricule_adherent bigint,
    patient varchar(150) NOT NULL DEFAULT '',
    assure varchar(150) NOT NULL DEFAULT '',
    statut varchar(1) NOT NULL DEFAULT '',
    date_naissance date,
    sexe varchar(1) NOT NULL DEFAULT '',
    idpolice integer,
    police varchar(150) NOT NULL DEFAULT '',
    code_college integer,
    college varchar(150) NOT NULL DEFAULT '',
    localite_executant varchar(80) NOT NULL DEFAULT '',
    centre_executant varchar(150) NOT NULL DEFAULT '',
    localite_prescripteur varchar(80) NOT NULL DEFAULT '',
    centre_prescripteur varchar(150) NOT NULL DEFAULT '',
    famille varchar(80) NOT NULL DEFAULT '',
    code_acte varchar(30) NOT NULL DEFAULT '',
    acte varchar(150) NOT NULL DEFAULT '',
    medecin varchar(150) NOT NULL DEFAULT '',
    date_consultation timestamp,
    date_soins date,
    affection varchar(60) NOT NULL DEFAULT '',
    code_affection integer,
    type_prestation varchar(4) NOT NULL DEFAULT '',
    reclame numeric(14, 0) NOT NULL DEFAULT 0,
    tm numeric(5, 2) NOT NULL DEFAULT 0,
    exclus numeric(14, 0) NOT NULL DEFAULT 0,
    depassement numeric(14, 0) NOT NULL DEFAULT 0,
    rembourse numeric(14, 0) NOT NULL DEFAULT 0,
    part_patient numeric(14, 0) NOT NULL DEFAULT 0
);
CREATE INDEX lephare_rafas_prestation_mois ON public.lephare_rafas_prestation (idconvention, mois);
CREATE INDEX lephare_rafas_prestation_matricule ON public.lephare_rafas_prestation (idconvention, matricule);
COMMENT ON COLUMN public.lephare_rafas_prestation.mois IS 'Mois de clôture du relevé (période comptable du gestionnaire)';

CREATE TABLE public.lephare_rafas_appel (
    idappel serial PRIMARY KEY,
    idexercice integer NOT NULL REFERENCES public.lephare_rafas_exercice (idexercice) ON DELETE CASCADE,
    numero varchar(30) NOT NULL UNIQUE,
    date_appel date NOT NULL,
    objet varchar(200) NOT NULL DEFAULT '',
    montant numeric(16, 0) NOT NULL CHECK (montant > 0),
    date_limite date,
    observations text NOT NULL DEFAULT '',
    idoperateur integer,
    date_creation timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.lephare_rafas_versement (
    idversement serial PRIMARY KEY,
    idexercice integer NOT NULL REFERENCES public.lephare_rafas_exercice (idexercice) ON DELETE CASCADE,
    idappel integer REFERENCES public.lephare_rafas_appel (idappel) ON DELETE SET NULL,
    date_versement date NOT NULL,
    montant numeric(16, 0) NOT NULL CHECK (montant > 0),
    mode varchar(20) NOT NULL DEFAULT 'VIREMENT',
    reference varchar(60) NOT NULL DEFAULT '',
    banque varchar(80) NOT NULL DEFAULT '',
    observations text NOT NULL DEFAULT '',
    idoperateur integer,
    date_creation timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.lephare_rafas_honoraire (
    idhonoraire serial PRIMARY KEY,
    idexercice integer NOT NULL REFERENCES public.lephare_rafas_exercice (idexercice) ON DELETE CASCADE,
    beneficiaire varchar(12) NOT NULL CHECK (beneficiaire IN ('COURTIER', 'GESTIONNAIRE')),
    numero varchar(30) NOT NULL DEFAULT '',
    periode_du date NOT NULL,
    periode_au date NOT NULL CHECK (periode_au >= periode_du),
    base numeric(16, 0) NOT NULL DEFAULT 0,
    taux numeric(5, 2) NOT NULL DEFAULT 0,
    montant numeric(16, 0) NOT NULL CHECK (montant >= 0),
    date_emission date NOT NULL,
    date_paiement date,
    mode varchar(20) NOT NULL DEFAULT '',
    reference varchar(60) NOT NULL DEFAULT '',
    observations text NOT NULL DEFAULT '',
    idoperateur integer,
    date_creation timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lephare_rafas_honoraire_emission ON public.lephare_rafas_honoraire (beneficiaire, date_emission);
COMMENT ON TABLE public.lephare_rafas_honoraire IS 'RAFAS : honoraires du gestionnaire et commission du courtier (chiffre d''affaires du cabinet)';
"""

SUPPRESSION = """
DROP TABLE IF EXISTS public.lephare_rafas_honoraire;
DROP TABLE IF EXISTS public.lephare_rafas_versement;
DROP TABLE IF EXISTS public.lephare_rafas_appel;
DROP TABLE IF EXISTS public.lephare_rafas_prestation;
DROP TABLE IF EXISTS public.lephare_rafas_beneficiaire;
DROP TABLE IF EXISTS public.lephare_rafas_import;
DROP TABLE IF EXISTS public.lephare_rafas_college_gestionnaire;
DROP TABLE IF EXISTS public.lephare_rafas_college;
DROP TABLE IF EXISTS public.lephare_rafas_exercice;
DROP TABLE IF EXISTS public.lephare_rafas_convention;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0217_mrh_usage_adresse_longueur"),
    ]

    operations = [migrations.RunSQL(CREATION, SUPPRESSION)]
