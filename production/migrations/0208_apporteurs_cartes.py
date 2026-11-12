# Demande du 2026-11-05 : deux registres qui n'existaient pas.
#
# 1. Cartes d'assurance (lephare_carte_facturation) : une ligne par carte facturée à une personne, avec la date, le montant, l'opérateur
#    et le motif. Sert à refuser une seconde facturation, sauf renouvellement pour perte (sante/cartes.py). Les cartes déjà facturées
#    sur des packages Oreole Santé sont reprises dans l'historique.
# 2. Apporteurs d'affaires (production/apporteurs.py) :
#    - lephare_affaire_apporteur : apporteurs d'une affaire, avec le taux convenu pour cette affaire (une copie : changer le taux général
#      de l'apporteur ne le modifie pas) ;
#    - lephare_commission_apporteur : commission de chaque quittance de l'affaire, à payer, payée ou annulée ;
#    - lephare_reglement_apporteur et son détail : règlements versés à l'apporteur.
#
# Le devis, le contrat et la quittance sont notés sans clé étrangère : l'historique reste si un devis ou un contrat non encaissé est supprimé.
# Retour : python manage.py migrate production 0207 (efface ces quatre registres et l'historique des cartes).

from django.db import migrations

from sante.cartes import cle_personne

CREATION = """
CREATE TABLE public.lephare_carte_facturation (
    idfacturation serial PRIMARY KEY,
    cle varchar(320) NOT NULL,
    clefamille varchar(320) NOT NULL DEFAULT '',
    anonyme boolean NOT NULL DEFAULT FALSE,
    nom varchar(100) NOT NULL DEFAULT '',
    prenoms varchar(100) NOT NULL DEFAULT '',
    datenaissance date,
    lien char(1) NOT NULL DEFAULT 'A',
    iddevis integer NOT NULL,
    montant numeric(14, 2) NOT NULL DEFAULT 0,
    motif varchar(10) NOT NULL DEFAULT 'PREMIERE' CHECK (motif IN ('PREMIERE', 'PERTE')),
    observation varchar(300) NOT NULL DEFAULT '',
    statut char(1) NOT NULL DEFAULT 'V' CHECK (statut IN ('V', 'A')),
    idoperateur integer,
    operateur varchar(150) NOT NULL DEFAULT '',
    dateoperation timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lephare_carte_facturation_cle ON public.lephare_carte_facturation (cle);
CREATE INDEX lephare_carte_facturation_famille ON public.lephare_carte_facturation (clefamille) WHERE anonyme;
CREATE INDEX lephare_carte_facturation_devis ON public.lephare_carte_facturation (iddevis);
COMMENT ON TABLE public.lephare_carte_facturation IS 'Historique des cartes d''assurance facturées, une ligne par personne et par carte';

CREATE TABLE public.lephare_affaire_apporteur (
    idrattachement serial PRIMARY KEY,
    idapporteur integer NOT NULL REFERENCES public.stdapporteur (idapporteur),
    iddevis integer NOT NULL,
    numerodevis varchar(50) NOT NULL DEFAULT '',
    taux numeric(6, 2) NOT NULL DEFAULT 0 CHECK (taux >= 0 AND taux <= 100),
    assiette varchar(12) NOT NULL DEFAULT 'COMMISSION' CHECK (assiette IN ('COMMISSION', 'PRIME_NETTE', 'FORFAIT')),
    montantforfait numeric(14, 2) NOT NULL DEFAULT 0,
    origine varchar(10) NOT NULL DEFAULT 'SAISIE',
    observation varchar(300) NOT NULL DEFAULT '',
    actif boolean NOT NULL DEFAULT TRUE,
    motifretrait varchar(300) NOT NULL DEFAULT '',
    dateretrait timestamptz,
    retirepar varchar(150) NOT NULL DEFAULT '',
    idoperateur integer,
    operateur varchar(150) NOT NULL DEFAULT '',
    datecreation timestamptz NOT NULL DEFAULT now(),
    datemodification timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lephare_affaire_apporteur_actif ON public.lephare_affaire_apporteur (iddevis, idapporteur) WHERE actif;
CREATE INDEX lephare_affaire_apporteur_apporteur ON public.lephare_affaire_apporteur (idapporteur);
COMMENT ON TABLE public.lephare_affaire_apporteur IS 'Apporteurs d''une affaire et taux convenu pour cette affaire';

CREATE TABLE public.lephare_commission_apporteur (
    idcommission serial PRIMARY KEY,
    idrattachement integer NOT NULL REFERENCES public.lephare_affaire_apporteur (idrattachement),
    idapporteur integer NOT NULL REFERENCES public.stdapporteur (idapporteur),
    idcontrat integer NOT NULL,
    idquittance integer NOT NULL,
    numeropolice varchar(50) NOT NULL DEFAULT '',
    numeroquittance varchar(30) NOT NULL DEFAULT '',
    mouvement varchar(60) NOT NULL DEFAULT '',
    client varchar(250) NOT NULL DEFAULT '',
    dateemission date,
    assiette varchar(12) NOT NULL,
    assiettemontant numeric(14, 2) NOT NULL DEFAULT 0,
    taux numeric(6, 2) NOT NULL DEFAULT 0,
    montant numeric(14, 2) NOT NULL DEFAULT 0,
    statut varchar(10) NOT NULL DEFAULT 'A_PAYER' CHECK (statut IN ('A_PAYER', 'PAYEE', 'ANNULEE')),
    motifannulation varchar(300) NOT NULL DEFAULT '',
    dateannulation timestamptz,
    annulepar varchar(150) NOT NULL DEFAULT '',
    datecreation timestamptz NOT NULL DEFAULT now(),
    datemodification timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lephare_commission_apporteur_unique ON public.lephare_commission_apporteur (idrattachement, idquittance);
CREATE INDEX lephare_commission_apporteur_apporteur ON public.lephare_commission_apporteur (idapporteur, statut);
CREATE INDEX lephare_commission_apporteur_police ON public.lephare_commission_apporteur (numeropolice);
COMMENT ON TABLE public.lephare_commission_apporteur IS 'Commission d''un apporteur sur une quittance : à payer, payée ou annulée';

CREATE TABLE public.lephare_reglement_apporteur (
    idreglement serial PRIMARY KEY,
    numero varchar(20) NOT NULL UNIQUE,
    idapporteur integer NOT NULL REFERENCES public.stdapporteur (idapporteur),
    datereglement date NOT NULL,
    mode varchar(3) NOT NULL CHECK (mode IN ('ESP', 'CHQ', 'VIR', 'MOB')),
    idbanque integer,
    reference varchar(60) NOT NULL DEFAULT '',
    montant numeric(14, 2) NOT NULL,
    observation varchar(300) NOT NULL DEFAULT '',
    statut char(1) NOT NULL DEFAULT 'V' CHECK (statut IN ('V', 'A')),
    motifannulation varchar(300) NOT NULL DEFAULT '',
    dateannulation timestamptz,
    annulepar varchar(150) NOT NULL DEFAULT '',
    idoperateur integer,
    operateur varchar(150) NOT NULL DEFAULT '',
    datecreation timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lephare_reglement_apporteur_apporteur ON public.lephare_reglement_apporteur (idapporteur, datereglement);
COMMENT ON TABLE public.lephare_reglement_apporteur IS 'Règlements versés aux apporteurs d''affaires';

CREATE TABLE public.lephare_detail_reglement_apporteur (
    iddetail serial PRIMARY KEY,
    idreglement integer NOT NULL REFERENCES public.lephare_reglement_apporteur (idreglement),
    idcommission integer NOT NULL REFERENCES public.lephare_commission_apporteur (idcommission),
    montant numeric(14, 2) NOT NULL
);
CREATE UNIQUE INDEX lephare_detail_reglement_apporteur_unique ON public.lephare_detail_reglement_apporteur (idreglement, idcommission);
CREATE INDEX lephare_detail_reglement_apporteur_commission ON public.lephare_detail_reglement_apporteur (idcommission);
COMMENT ON TABLE public.lephare_detail_reglement_apporteur IS 'Commissions soldées par chaque règlement d''apporteur';
"""

SUPPRESSION = """
DROP TABLE IF EXISTS public.lephare_detail_reglement_apporteur;
DROP TABLE IF EXISTS public.lephare_reglement_apporteur;
DROP TABLE IF EXISTS public.lephare_commission_apporteur;
DROP TABLE IF EXISTS public.lephare_affaire_apporteur;
DROP TABLE IF EXISTS public.lephare_carte_facturation;
"""


def reprendre_cartes(apps, schema_editor):
    """Cartes déjà facturées sur les packages Oreole Santé : une ligne par personne. La copie de composition d'un avenant ne facture rien."""
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT a.idadherent, a.nom, a.prenom, a.datenaissance, s.personnes, s.iddevis, p.montantcarte, p.idoperateur, p.datecreation
            FROM lephare_oreole_adherent s
            JOIN lephare_oreole_package p ON p.iddevis_sante = s.iddevis
            JOIN stdadherent a ON a.idadherent = s.idadherent
            WHERE s.montantcartes > 0 AND p.montantcarte > 0 AND (p.acte <> 'INC' OR s.complement > 0)
            ORDER BY a.idadherent
            """
        )
        familles = cursor.fetchall()
        for id_adherent, nom, prenoms, naissance, personnes, id_devis, montant, id_operateur, date_operation in familles:
            cle_famille = cle_personne(nom, prenoms, naissance)
            cursor.execute("SELECT lien, nom, prenom, datenaissance FROM stdaffilie WHERE idadherent = %s AND lien <> 'A' ORDER BY idaffilie", [id_adherent])
            lignes = [("A", nom, prenoms, naissance, cle_famille, False)]
            for lien, nom_ayant, prenoms_ayant, naissance_ayant in cursor.fetchall():
                lignes.append((lien, nom_ayant, prenoms_ayant, naissance_ayant, cle_personne(nom_ayant, prenoms_ayant, naissance_ayant), False))
            for rang in range(1, max((personnes or 0) - len(lignes), 0) + 1):
                lignes.append(("?", nom, prenoms, None, f"{cle_famille}#{rang}", True))
            for lien, nom_ligne, prenoms_ligne, naissance_ligne, cle, anonyme in lignes:
                cursor.execute(
                    """INSERT INTO lephare_carte_facturation (cle, clefamille, anonyme, nom, prenoms, datenaissance, lien, iddevis, montant, motif,
                           observation, idoperateur, dateoperation)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'PREMIERE', 'Reprise des cartes déjà facturées', %s, %s)""",
                    [cle, cle_famille, anonyme, (nom_ligne or "")[:100], (prenoms_ligne or "")[:100], naissance_ligne, lien, id_devis, montant, id_operateur, date_operation],
                )


class Migration(migrations.Migration):

    dependencies = [
        ("configuration_api", "0072_apporteur"),
        ("production", "0207_avenant_minene_accessoire"),
    ]

    operations = [
        migrations.RunSQL(CREATION, SUPPRESSION),
        migrations.RunPython(reprendre_cartes, migrations.RunPython.noop),
    ]
