"""Suivi des consommations santé : lecture des relevés du gestionnaire, dates de soins, règles de fraude. Sans base de données."""

import datetime as dt
import io
from decimal import Decimal as D

from django.test import SimpleTestCase
from openpyxl import Workbook

from .consommations import ErreurConsommation, REGLES_FRAUDE, date_retenue, detecter_fraude, lire_fichier, normaliser

ENTETE_PRESTATIONS = ["DATE_CLOTURE", "NUMERO_PREST", "NUMERO_GARANT", "GARANT", "SOUSCRIPTEUR", "NPOL", "POLICE", "LIBELLE_COLLEGE", "MATRICULE_BENEFICIAIRE",
                      "BENEFICIAIRE", "STATUT", "DATE_NAISSANCE", "MATRICULE_ASSURE", "ASSURE", "CENTRE_PRESCRIPTEUR", "CODE", "CENTRE_EXECUTANT",
                      "FAMILLE_PRESTATION", "ACTES", "MEDECIN", "DATE_SOINS", "DATE_RECEPTION", "TYPE", "MT_RECLAME", "BASE_DECOMPTEE", "TICKET_MODERATEUR",
                      "EXCLUSION", "DEPASSEMENT", "MT_REMBOURSE"]
ENTETE_EFFECTIF = ["GARANT", "POLICE", "COLLEGE", "MATASSURE", "NOM ASSURE", "PRENOM ASSURE", "MATBENEF", "NOM BENEFICIARE", "PRENOM BENEFICIAIRE", "STATUT",
                   "DATE EFFET", "DATE NAIS", "GENRE"]


def ligne_prestation(numero, benef=1000001, assure=1000001, soins=dt.datetime(2026, 7, 3), cloture=dt.datetime(2026, 7, 31), famille="CONSULTATION", acte="C",
                     centre="CS1", reclame=10000, rembourse=8000):
    return [cloture, numero, 312, "OREOLE", "SOCIETE X", 1, "POLICE X", "OPTION 1", benef, "BENEF", "A", dt.datetime(1990, 1, 1), assure, "ASSURE",
            "PRESCRIPTEUR", centre, "CENTRE", famille, acte, "MEDECIN", soins, cloture, "TP", reclame, reclame, 20, 0, 0, rembourse]


def classeur(feuilles):
    wb = Workbook()
    wb.remove(wb.active)
    for titre, lignes in feuilles:
        ws = wb.create_sheet(titre)
        for l in lignes:
            ws.append(l)
    tampon = io.BytesIO()
    wb.save(tampon)
    return tampon.getvalue()


def prestation(numero, benef=1, assure=1, soins=dt.date(2026, 7, 3), famille="CONSULTATION", acte="C", centre="CS1", reclame=10000, rembourse=8000, **autres):
    p = {"numero_prest": numero, "matricule_beneficiaire": benef, "matricule_assure": assure, "beneficiaire": "B", "police": "P", "date_soins": soins,
         "date_soins_retenue": soins, "famille": famille, "acte": acte, "code_centre": centre, "centre_executant": centre, "mt_reclame": D(reclame),
         "mt_rembourse": D(rembourse), "statut": "A", "genre": "F", "dans_effectif": True, "date_effet": dt.date(2026, 1, 1), "date_sortie": None}
    p.update(autres)
    return p


def codes(signaux):
    return sorted({s["Code"] for s in signaux})


class DateDeSoins(SimpleTestCase):
    def test_inversion_jour_mois_corrigee(self):
        # 07/03 lu comme 3 juillet alors que la clôture est au 30 avril : c'est le 7 mars
        self.assertEqual(date_retenue(dt.date(2026, 7, 3), dt.date(2026, 4, 30)), dt.date(2026, 3, 7))

    def test_date_normale_inchangee(self):
        self.assertEqual(date_retenue(dt.date(2026, 3, 7), dt.date(2026, 4, 30)), dt.date(2026, 3, 7))

    def test_jour_superieur_a_12_non_corrigeable(self):
        self.assertEqual(date_retenue(dt.date(2026, 7, 20), dt.date(2026, 4, 30)), dt.date(2026, 7, 20))

    def test_inversion_encore_posterieure_gardee(self):
        self.assertEqual(date_retenue(dt.date(2026, 9, 10), dt.date(2026, 8, 31)), dt.date(2026, 9, 10))


class LectureDesRelevés(SimpleTestCase):
    def test_prestations_et_effectif_du_meme_classeur(self):
        contenu = classeur([
            ("EFFECTIF", [ENTETE_EFFECTIF, ["OREOLE", "POLICE X", "OPTION 1", 1000001, "N", "P", 1000001, "N", "P", "A", dt.datetime(2026, 1, 1), dt.datetime(1990, 1, 1), "F"]]),
            ("DEPENSES", [ENTETE_PRESTATIONS, ligne_prestation(11), ligne_prestation(12), ["TOTAL", None]]),
            ("EXTRAIT", [ENTETE_PRESTATIONS, ligne_prestation(11)]),
        ])
        prestations, effectif, feuilles, manquantes = lire_fichier(contenu)
        self.assertEqual(sorted(prestations), [11, 12])
        self.assertEqual(list(effectif), [1000001])
        self.assertEqual(effectif[1000001]["date_effet"], dt.date(2026, 1, 1))
        self.assertEqual(prestations[11]["mt_rembourse"], D("8000"))
        self.assertEqual(prestations[11]["beneficiaire"], "BENEF")
        self.assertEqual(manquantes, [])
        self.assertEqual([f["Nature"] for f in feuilles], ["EFFECTIF", "PRESTATIONS", "PRESTATIONS"])

    def test_date_inversee_retenue_a_la_lecture(self):
        contenu = classeur([("DEPENSES", [ENTETE_PRESTATIONS, ligne_prestation(11, soins=dt.datetime(2026, 7, 3), cloture=dt.datetime(2026, 4, 30))])])
        p = lire_fichier(contenu)[0][11]
        self.assertEqual(p["date_soins"], dt.date(2026, 7, 3))
        self.assertEqual(p["date_soins_retenue"], dt.date(2026, 3, 7))

    def test_base_de_travail_avec_source_ignoree(self):
        contenu = classeur([("SORTIS", [["SOURCE"] + ENTETE_EFFECTIF, ["JUIN", "OREOLE", "POLICE X", "OPTION 1", 1, "N", "P", 1, "N", "P", "A", None, None, "F"]])])
        with self.assertRaises(ErreurConsommation):
            lire_fichier(contenu)

    def test_base_de_travail_avec_periode_lue_en_deux_effectifs(self):
        """Base unifiée d'OREOLE : EXERCICE PRECEDENT = effectif de référence, EXERCICE ACTUEL = effectif courant ; DATE SORTIE au 02/01/1900 = vide."""
        entete = ["SOURCE"] + ENTETE_EFFECTIF + ["DATE SORTIE", "PERIODE"]

        def ligne(source, matricule, periode):
            return [source, "OREOLE", "POLICE X", "OPTION 1", matricule, "N", "P", matricule, "N", "P", "A", dt.datetime(2020, 1, 1), dt.datetime(1990, 1, 1), "F",
                    dt.datetime(1900, 1, 2), periode]
        contenu = classeur([("BASE UNIFIEE", [entete, ligne("BASE EFFECTIF", 1, "EXERCICE PRECEDENT"), ligne("BASE EFFECTIF", 2, "EXERCICE PRECEDENT"),
                                               ligne("OREOLE ET CGA", 2, "EXERCICE ACTUEL"), ligne("OREOLE ET CGA", 3, "EXERCICE ACTUEL"), ligne("AUTRE", 4, "")])])
        from .consommations import _lire
        _prestations, effectif, feuilles, _manquantes, _cotisations, precedent = _lire(contenu)
        self.assertEqual(sorted(precedent), [1, 2])
        self.assertEqual(sorted(effectif), [2, 3])
        self.assertIsNone(effectif[3]["date_sortie"])
        self.assertEqual(feuilles[0]["Nature"], "EFFECTIF_PERIODES")

    def test_classeur_analyse_des_sortants(self):
        """Classeur ANALYSE DES SORTANT d'OREOLE : BASE EFFECTIF PRECEDENT (en-têtes MATRICULE_BENEFICIAIRE / MATRICULE_ASSURE) = référence,
        BASE EFFECTIF ACTUEL = effectif courant, tableau croisé TCD écarté."""
        precedent = ["GARANT", "POLICE", "MATRICULE_ASSURE", "MATRICULE_BENEFICIAIRE", "NOM BENEFICIARE", "STATUT", "DATE EFFET", "DATE NAIS", "GENRE", "PERIODE"]
        actuel = ["GARANT", "POLICE", "MATASSURE", "MATBENEF", "NOM BENEFICIARE", "STATUT", "DATE EFFET", "DATE NAIS", "GENRE", "DATE SORTIE", "PERIODE"]
        contenu = classeur([
            ("BASE EFFECTIF PRECEDENT", [precedent, ["OREOLE", "P1", 1, 1, "N", "A", None, None, "F", "EXERCICE PRECEDENT"],
                                         ["OREOLE", "P1", 1, 2, "N", "E", None, None, "M", "EXERCICE PRECEDENT"]]),
            ("BASE EFFECTIF ACTUEL", [actuel, ["OREOLE", "P1", 1, 1, "N", "A", None, None, "F", dt.datetime(1900, 1, 2), "EXERCICE ACTUEL"],
                                      ["OREOLE", "P1", 1, 3, "N", "E", None, None, "F", dt.datetime(1900, 1, 2), "EXERCICE ACTUEL"]]),
            ("TCD", [[None], [None], [None], ["POLICE", "MATBENEF", "STATUT", "EXERCICE ACTUEL", "EXERCICE PRECEDENT"], ["P1", 1, "A", 1, 1]]),
        ])
        from .consommations import _lire
        _prestations, effectif, feuilles, manquantes, _cotisations, reference = _lire(contenu)
        self.assertEqual(sorted(reference), [1, 2])
        self.assertEqual(reference[2]["matricule_assure"], 1)
        self.assertEqual(sorted(effectif), [1, 3])
        self.assertTrue(all(e["date_sortie"] is None for e in effectif.values()))
        self.assertEqual([m.split(" :")[0] for m in manquantes], ["TCD"])

    def test_feuille_d_effectif_precedent_sans_colonne_periode(self):
        contenu = classeur([("EFFECTIF PRECEDENT", [ENTETE_EFFECTIF, ["OREOLE", "P1", "OPTION 1", 5, "N", "P", 5, "N", "P", "A", None, None, "F"]])])
        from .consommations import _lire
        resultat = _lire(contenu)
        self.assertEqual((list(resultat[1]), list(resultat[5]), resultat[2][0]["Nature"]), ([], [5], "EFFECTIF_PRECEDENT"))

    def test_colonne_obligatoire_absente_signalee(self):
        entete = [c for c in ENTETE_PRESTATIONS if c != "MT_REMBOURSE"]
        with self.assertRaisesRegex(ErreurConsommation, "MT_REMBOURSE"):
            lire_fichier(classeur([("DEPENSES", [entete, ligne_prestation(11)[:-1]])]))

    def test_fichier_illisible(self):
        with self.assertRaises(ErreurConsommation):
            lire_fichier(b"pas un classeur")

    def test_en_tete_sans_accent_ni_casse(self):
        self.assertEqual(normaliser("  Nom  bénéficiaire "), "NOM BENEFICIAIRE")


class DetectionDeFraude(SimpleTestCase):
    def test_doublon(self):
        signaux, scores = detecter_fraude([prestation(1), prestation(2)])
        self.assertEqual([s["NumeroPrestation"] for s in signaux if s["Code"] == "F01"], [2])
        self.assertNotIn("F02", codes(signaux))
        self.assertEqual(scores[1]["Score"], REGLES_FRAUDE["F01"][1])

    def test_acte_repete_en_moins_de_15_jours(self):
        signaux, _ = detecter_fraude([prestation(1), prestation(2, soins=dt.date(2026, 7, 10))])
        self.assertEqual(codes(signaux), ["F02"])
        signaux, _ = detecter_fraude([prestation(1), prestation(2, soins=dt.date(2026, 7, 20))])
        self.assertEqual(signaux, [])

    def test_personne_non_couverte_et_soins_avant_effet(self):
        signaux, _ = detecter_fraude([prestation(1, dans_effectif=False, date_effet=None), prestation(2, benef=2, date_effet=dt.date(2026, 8, 1))])
        self.assertEqual(codes(signaux), ["F03", "F04"])

    def test_soins_apres_sortie(self):
        signaux, _ = detecter_fraude([prestation(1, date_sortie=dt.date(2026, 6, 30))])
        self.assertEqual(codes(signaux), ["F03"])

    def test_maternite_incoherente(self):
        signaux, _ = detecter_fraude([prestation(1, famille="MATERNITE", genre="M"), prestation(2, benef=2, famille="MATERNITE", statut="E")])
        self.assertEqual([s["Code"] for s in signaux], ["F05", "F05"])

    def test_nomadisme_et_frequence(self):
        jour = [prestation(1, centre="A"), prestation(2, centre="B", reclame=12000)]
        signaux, _ = detecter_fraude(jour)
        self.assertIn("F06", codes(signaux))
        mois = [prestation(i, soins=dt.date(2026, 7, 1 + 6 * i), acte=f"C{i}") for i in range(5)]
        self.assertIn("F09", codes(detecter_fraude(mois)[0]))

    def test_fractionnement(self):
        signaux, _ = detecter_fraude([prestation(i, famille="PHARMACIE", acte=f"PH{i}", reclame=1000 + i) for i in range(3)])
        self.assertEqual(codes(signaux), ["F07"])

    def test_montant_atypique(self):
        courantes = [prestation(i, benef=100 + i, acte="X", reclame=20000) for i in range(25)]
        signaux, _ = detecter_fraude(courantes + [prestation(99, benef=999, acte="X", reclame=90000)])
        self.assertEqual([(s["Code"], s["NumeroPrestation"]) for s in signaux], [("F08", 99)])

    def test_identite_partagee(self):
        signaux, _ = detecter_fraude([prestation(1, assure=1), prestation(2, assure=2, soins=dt.date(2026, 8, 20))])
        self.assertEqual(codes(signaux), ["F10"])

    def test_score_plafonne_a_trois_signaux_par_regle_et_niveau(self):
        # quatre doublons, un par mois : seul F01 se déclenche, quatre fois, compté trois fois
        doublons = [prestation(10 * mois + i, soins=dt.date(2026, mois, 5)) for mois in range(1, 5) for i in range(2)]
        signaux, scores = detecter_fraude(doublons)
        self.assertEqual(codes(signaux), ["F01"])
        self.assertEqual(scores[1]["Regles"]["F01"], 4)
        self.assertEqual(scores[1]["Score"], 3 * REGLES_FRAUDE["F01"][1])
        self.assertEqual(scores[1]["Niveau"], "Élevé")

    def test_aucun_signal_sur_un_parcours_ordinaire(self):
        parcours = [prestation(1), prestation(2, famille="PHARMACIE", acte="PH", reclame=15000), prestation(3, soins=dt.date(2026, 8, 25))]
        self.assertEqual(detecter_fraude(parcours), ([], {}))
