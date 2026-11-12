# Branche Oreole Santé (demande du 2026-11-04, dossier OREOLE SANTE) : package de micro-assurance à prix unique par famille,
# Santé MCI CARE CI + Individuelle Accidents NSIA + Assistance funéraire ALLIANZ CI VIE. Réponses d'OREOLE : cotisation sans
# taxe ; prime HT + accessoires reversés à MCI, frais courtiers gardés par le cabinet ; honoraires 7 % OREOLE et 11 % MCI sur
# la prime HT ; surprime d'affection sur la cotisation totale, surprime d'âge sur la part Santé, supplément en frais courtiers.
#
#   - tarif OREOLE SANTE (catégorie 125, Santé groupe tiers payant) et une offre par prix ;
#   - lephare_oreole_offre : prix, décomposition et barème de chaque offre, modifiables dans l'administration ;
#   - lephare_oreole_package : les trois devis liés (Santé, IA, AFA) ;
#   - lephare_oreole_adherent : détail de la cotisation de chaque adhérent ;
#   - réglages oreole.* ; commission AFA ALLIANZ CI VIE 30 % ; fn_get_taux_commission_offre v2.
#
# Retour : python manage.py migrate production 0204 (refusé si des devis Oreole Santé existent : à supprimer d'abord).

from django.db import migrations

from uranus.utils.migrations import load_sql_upgrade

G1 = {"chambre": 20000, "ambulance": 20000, "simple": 150000, "gemellaire": 200000, "chirurgical": 300000, "hors": 50000,
      "optique_a": 50000, "optique_e": 40000, "dentaire": 80000, "plafond": 2500000}
G2 = {"chambre": 30000, "ambulance": 30000, "simple": 200000, "gemellaire": 250000, "chirurgical": 350000, "hors": 80000,
      "optique_a": 70000, "optique_e": 50000, "dentaire": 100000, "plafond": 5000000}

# Fichiers TARIF ET BAREME MICROASSURANCE OREOLE SANTE : code, cible, nature, libellé, cotisation, prime HT, accessoires, part
# IA, part AFA, offre IA, capital IA, capital AFA, enfant à partir du 5e, soins externes, hospitalisation, barème, réseau.
# Offre 850 000 : capital IA 2 000 000 (prime IA 4 240 F et PDF), chambre 30 000 F (Excel).
OFFRES = [
    ("P600", "P", "PARTICULIER", "Oreole Santé 600 000", 600000, 123333, 10000, 6000, 7500, 154, 2000000, 500000, 50000, 80, 80, G1, "MCI_80"),
    ("P850", "P", "PARTICULIER", "Oreole Plus 850 000", 850000, 242033, 10000, 6000, 15000, 154, 2000000, 1000000, 70000, 80, 100, G2, "MCI_100"),
    ("E436", "E", "GRILLE", "Entreprises 436 800", 436800, 123333, 10000, 6000, 7500, 154, 2000000, 500000, 35000, 80, 80, G1, "MCI_80"),
    ("E594", "E", "GRILLE", "Entreprises 594 000", 594000, 123333, 10000, 6000, 15000, 154, 2000000, 1000000, 47000, 80, 80, G2, "MCI_80"),
    ("E840", "E", "GRILLE", "Entreprises 840 000", 840000, 242033, 10000, 17000, 15000, 156, 4000000, 1000000, 70000, 80, 100, G2, "MCI_100"),
    ("E264", "E", "NEGOCIE", "Entreprise 264 000", 264000, 123333, 10000, 6000, 7500, 154, 2000000, 500000, 35000, 80, 80, G1, "MCI_80"),
    ("E276", "E", "NEGOCIE", "Entreprise 276 000", 276000, 123333, 10000, 6000, 7500, 154, 2000000, 500000, 35000, 80, 100, G1, "MCI_100"),
    ("E303", "E", "NEGOCIE", "Entreprise 303 600", 303600, 123333, 10000, 6000, 7500, 154, 2000000, 500000, 35000, 80, 80, G1, "MCI_80"),
    ("E400", "E", "NEGOCIE", "Entreprise 400 000 Santé seule", 400000, 123333, 10000, 0, 0, None, 0, 0, 35000, 80, 80, G1, "MCI_80"),
    ("E575", "E", "NEGOCIE", "Entreprise 575 000", 575000, 300000, 5000, 17000, 15000, 156, 4000000, 1000000, 70000, 80, 100, G2, "MCI_100"),
]

# (clé, libellé, aide, type, valeur, unité, minimum, maximum)
PARAMETRES = [
    ("oreole.honoraire_cabinet", "Honoraires de gestion OREOLE", "Pourcentage de la prime HT, à réclamer à MCI.", "pourcentage", "7", "%", 0, 100),
    ("oreole.honoraire_gestionnaire", "Honoraires de gestion MCI", "Pourcentage de la prime HT.", "pourcentage", "11", "%", 0, 100),
    ("oreole.gestionnaire", "Gestionnaire Santé", "Nom imprimé sur les contrats Oreole Santé.", "texte", "MCI CARE CI", "", None, None),
    ("oreole.compagnie_sante", "Compagnie Santé", "Compagnie des polices Santé.", "entier", "29", "", 0, 100000),
    ("oreole.compagnie_ia", "Compagnie Individuelle Accidents", "Compagnie des polices IA.", "entier", "1", "", 0, 100000),
    ("oreole.compagnie_afa", "Compagnie Assistance funéraire", "Compagnie des polices AFA.", "entier", "31", "", 0, 100000),
    ("oreole.carte_montant", "Carte d'assurance", "Montant par personne, facturé quand le bouton est coché.", "montant", "3000", "F", 0, 1000000),
    ("oreole.surprime_affection", "Surprime par affection", "Pourcentage de la cotisation totale, par affection déclarée.", "pourcentage", "30", "%", 0, 500),
    ("oreole.affections_max", "Affections au plus", "Nombre maximum d'affections déclarées.", "entier", "3", "", 0, 20),
    ("oreole.surprime_age_1_debut", "Première surprime d'âge : à partir de", "Âge atteint à la date d'effet.", "entier", "60", "ans", 18, 100),
    ("oreole.surprime_age_1_taux", "Première surprime d'âge", "Pourcentage de la part Santé.", "pourcentage", "30", "%", 0, 500),
    ("oreole.surprime_age_2_debut", "Seconde surprime d'âge : à partir de", "Âge atteint à la date d'effet.", "entier", "65", "ans", 18, 100),
    ("oreole.surprime_age_2_taux", "Seconde surprime d'âge", "Pourcentage de la part Santé.", "pourcentage", "50", "%", 0, 500),
    ("oreole.age_max_adulte", "Âge limite signalé", "Au-delà, l'écran signale l'adhérent sans bloquer la saisie.", "entier", "69", "ans", 18, 120),
    ("oreole.carence_maladie", "Carence maladie et soins dentaires", "", "entier", "3", "mois", 0, 60),
    ("oreole.carence_maternite", "Carence grossesse et accouchement", "", "entier", "9", "mois", 0, 60),
    ("oreole.carence_protheses", "Carence prothèses dentaires", "", "entier", "10", "mois", 0, 60),
    ("oreole.carence_optique", "Carence lunetterie et optique", "", "entier", "10", "mois", 0, 60),
    ("oreole.carence_chronique", "Carence maladie chronique", "Si elle survient pour la première fois pendant la période de garantie.", "entier", "12", "mois", 0, 60),
    ("oreole.alerte_bons", "Alerte automatique", "À partir de ce numéro de bon de prise en charge.", "entier", "15", "bons", 0, 1000),
    ("oreole.alerte_pharmacie", "Alerte pharmacie", "À partir de ce montant de frais pharmaceutiques.", "montant", "200000", "F", 0, 100000000),
]

TABLES = """
CREATE TABLE public.lephare_oreole_offre (
    idoffre integer PRIMARY KEY,
    code varchar(10) NOT NULL UNIQUE,
    cible char(1) NOT NULL CHECK (cible IN ('P', 'E')),
    nature varchar(12) NOT NULL DEFAULT 'GRILLE',
    libelle varchar(80) NOT NULL,
    cotisation numeric(14, 2) NOT NULL,
    primeht numeric(14, 2) NOT NULL,
    accessoires numeric(14, 2) NOT NULL DEFAULT 0,
    partia numeric(14, 2) NOT NULL DEFAULT 0,
    partafa numeric(14, 2) NOT NULL DEFAULT 0,
    idoffreia integer,
    capitalia numeric(14, 2) NOT NULL DEFAULT 0,
    capitalafa numeric(14, 2) NOT NULL DEFAULT 0,
    enfantsupplementaire numeric(14, 2) NOT NULL DEFAULT 0,
    tauxsoinsexternes numeric(5, 2) NOT NULL,
    tauxhospitalisation numeric(5, 2) NOT NULL,
    chambreparjour numeric(14, 2) NOT NULL,
    ambulanceparcas numeric(14, 2) NOT NULL,
    accouchementsimple numeric(14, 2) NOT NULL,
    accouchementgemellaire numeric(14, 2) NOT NULL,
    accouchementchirurgical numeric(14, 2) NOT NULL,
    accouchementhorsstructure numeric(14, 2) NOT NULL,
    optiqueadulte numeric(14, 2) NOT NULL,
    optiqueenfant numeric(14, 2) NOT NULL,
    dentaireparpersonne numeric(14, 2) NOT NULL,
    plafondannuel numeric(14, 2) NOT NULL,
    reseau varchar(20) NOT NULL DEFAULT 'MCI_80',
    actif boolean NOT NULL DEFAULT TRUE,
    ordre integer NOT NULL DEFAULT 0,
    datemodification timestamptz NOT NULL DEFAULT now(),
    modifiepar varchar(150) NOT NULL DEFAULT ''
);
COMMENT ON TABLE public.lephare_oreole_offre IS 'Oreole Santé : prix, décomposition et barème de chaque offre';

CREATE TABLE public.lephare_oreole_package (
    iddevis_sante integer PRIMARY KEY,
    iddevis_ia integer,
    iddevis_afa integer,
    cible char(1) NOT NULL DEFAULT 'E',
    acte varchar(3) NOT NULL DEFAULT 'AFN',
    idcontratbase integer,
    prixfamille numeric(14, 2),
    carte boolean NOT NULL DEFAULT FALSE,
    montantcarte numeric(14, 2) NOT NULL DEFAULT 0,
    idapporteur integer,
    apporteurmode varchar(10) NOT NULL DEFAULT '',
    apporteurvaleur numeric(14, 2) NOT NULL DEFAULT 0,
    idoperateur integer,
    datecreation timestamptz NOT NULL DEFAULT now(),
    datemodification timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lephare_oreole_package_ia ON public.lephare_oreole_package (iddevis_ia);
CREATE INDEX lephare_oreole_package_afa ON public.lephare_oreole_package (iddevis_afa);
COMMENT ON TABLE public.lephare_oreole_package IS 'Oreole Santé : les devis liés Santé, IA et AFA d''une souscription';

CREATE TABLE public.lephare_oreole_adherent (
    id serial PRIMARY KEY,
    iddevis integer NOT NULL,
    idadherent integer NOT NULL UNIQUE,
    idclient integer,
    idoffre integer NOT NULL,
    affections integer NOT NULL DEFAULT 0,
    tauxaffection numeric(7, 2),
    tauxage numeric(7, 2),
    surprimeimposee numeric(14, 2) NOT NULL DEFAULT 0,
    cotisationimposee numeric(14, 2) NOT NULL DEFAULT 0,
    enfantsenplus integer NOT NULL DEFAULT 0,
    personnes integer NOT NULL DEFAULT 1,
    beneficiaires varchar(500) NOT NULL DEFAULT '',
    cotisation numeric(14, 2) NOT NULL DEFAULT 0,
    partsante numeric(14, 2) NOT NULL DEFAULT 0,
    partia numeric(14, 2) NOT NULL DEFAULT 0,
    partafa numeric(14, 2) NOT NULL DEFAULT 0,
    primeht numeric(14, 2) NOT NULL DEFAULT 0,
    accessoires numeric(14, 2) NOT NULL DEFAULT 0,
    fraiscourtiers numeric(14, 2) NOT NULL DEFAULT 0,
    surprimeaffection numeric(14, 2) NOT NULL DEFAULT 0,
    surprimeage numeric(14, 2) NOT NULL DEFAULT 0,
    montantenfants numeric(14, 2) NOT NULL DEFAULT 0,
    montantcartes numeric(14, 2) NOT NULL DEFAULT 0,
    idoffreia integer,
    capitalia numeric(14, 2) NOT NULL DEFAULT 0,
    capitalafa numeric(14, 2) NOT NULL DEFAULT 0,
    complement numeric(14, 2) NOT NULL DEFAULT 0
);
CREATE INDEX lephare_oreole_adherent_devis ON public.lephare_oreole_adherent (iddevis);
COMMENT ON TABLE public.lephare_oreole_adherent IS 'Oreole Santé : détail de la cotisation de chaque adhérent ; complement = montant facturé par ce devis';
"""

RETRAIT_TABLES = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.lephare_oreole_package) THEN
        RAISE EXCEPTION 'Des devis Oreole Santé existent : supprimez-les avant ce retour en arrière.';
    END IF;
END $$;
DELETE FROM public.stdoffregarantie WHERE idoffre IN (SELECT idoffre FROM public.lephare_oreole_offre);
DELETE FROM public.stdoffre WHERE idoffre IN (SELECT idoffre FROM public.lephare_oreole_offre);
DELETE FROM public.stdtarif WHERE libelle = 'OREOLE SANTE';
DELETE FROM public.lephare_parametre WHERE cle LIKE 'oreole.%';
DELETE FROM public.stdcommissionproduitcompagnie WHERE idproduit = 10 AND idcompagnie = 31 AND tauxcommission = 30;
DROP TABLE public.lephare_oreole_adherent;
DROP TABLE public.lephare_oreole_package;
DROP TABLE public.lephare_oreole_offre;
"""


def amorcer(apps, schema_editor):
    with schema_editor.connection.cursor() as c:
        c.execute("""
            INSERT INTO public.stdtarif (idtarif, libelle, codeusage, reference, validitemin, validitemax, nataccessoires, idcategorie, codecategorie)
            SELECT COALESCE(MAX(idtarif), 0) + 1, 'OREOLE SANTE', 0, 0, '2000-01-01', '2050-01-01', 1, 4, '125' FROM public.stdtarif
            RETURNING idtarif
        """)
        id_tarif = c.fetchone()[0]
        for ordre, o in enumerate(OFFRES, 1):
            code, cible, nature, libelle, cotisation, ht, acc, ia, afa, offre_ia, cap_ia, cap_afa, enfant, ext, hos, g, reseau = o
            c.execute("""
                INSERT INTO public.stdoffre (actif, anticipation, differe, echeance, entreprise, exoneredeaccess, exoneredetaxes, flotte, gestion,
                    idoffre, jpaiement, libelleoffre, majfract, payement, ppr, renouvelable, visibilite, idtarif, idzonecouverture)
                SELECT TRUE, 45, 0, 'L', %s, FALSE, TRUE, FALSE, FALSE, COALESCE(MAX(idoffre), 0) + 1, 26, %s, 0, 'A', 'S', 'N', 'T', %s, 1
                FROM public.stdoffre
                RETURNING idoffre
            """, [cible == "E", ("OREOLE SANTE " + libelle).upper(), id_tarif])
            id_offre = c.fetchone()[0]
            for sous_garantie in (98, 99, 167):
                c.execute("""
                    INSERT INTO public.stdoffregarantie (idoffregarantie, idoffre, idsousgarantie, franchisemaximum, franchiseminimum, idcompagnie, tauxfranchise, ordreaffichage)
                    SELECT COALESCE(MAX(idoffregarantie), 0) + 1, %s, %s, 0, 0, 29, 0, 0 FROM public.stdoffregarantie
                """, [id_offre, sous_garantie])
            c.execute("""
                INSERT INTO public.lephare_oreole_offre (idoffre, code, cible, nature, libelle, cotisation, primeht, accessoires, partia, partafa,
                    idoffreia, capitalia, capitalafa, enfantsupplementaire, tauxsoinsexternes, tauxhospitalisation, chambreparjour, ambulanceparcas,
                    accouchementsimple, accouchementgemellaire, accouchementchirurgical, accouchementhorsstructure, optiqueadulte, optiqueenfant,
                    dentaireparpersonne, plafondannuel, reseau, ordre)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, [id_offre, code, cible, nature, libelle, cotisation, ht, acc, ia, afa, offre_ia, cap_ia, cap_afa, enfant, ext, hos,
                  g["chambre"], g["ambulance"], g["simple"], g["gemellaire"], g["chirurgical"], g["hors"], g["optique_a"], g["optique_e"],
                  g["dentaire"], g["plafond"], reseau, ordre])
        for ordre, (cle, libelle, aide, type_, valeur, unite, minimum, maximum) in enumerate(PARAMETRES, 1):
            c.execute("""
                INSERT INTO public.lephare_parametre (cle, groupe, libelle, aide, type, valeur, valeurorigine, unite, minimum, maximum, ordre, datemodification, modifiepar)
                VALUES (%s, 'oreole_sante', %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), '')
                ON CONFLICT (cle) DO NOTHING
            """, [cle, libelle, aide, type_, valeur, valeur, unite, minimum, maximum, ordre])
        # Commission AFA des tarifs (30 % de la prime HT) si le couple n'est pas déjà paramétré
        c.execute("""
            INSERT INTO public.stdcommissionproduitcompagnie (idprodcompacommission, tauxcommission, forfait, debutvalidite, finvalidite, idcompagnie, idproduit)
            SELECT (SELECT COALESCE(MAX(idprodcompacommission), 0) + 1 FROM public.stdcommissionproduitcompagnie), 30, 0, '2020-01-01', '2050-12-31', 31, 10
            WHERE NOT EXISTS (SELECT 1 FROM public.stdcommissionproduitcompagnie WHERE idcompagnie = 31 AND idproduit = 10)
        """)


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0204_primes_invalides_devis_non_confirmes"),
    ]

    operations = [
        migrations.RunSQL(TABLES, RETRAIT_TABLES),
        migrations.RunPython(amorcer, migrations.RunPython.noop),
        migrations.RunSQL(*load_sql_upgrade(__file__, "functions/fn_get_taux_commission_offre", from_version=1, to_version=2)),
    ]
