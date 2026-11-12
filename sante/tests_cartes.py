"""Facturation des cartes d'assurance : reconnaissance d'une personne et état de chaque carte, sans base de données."""

from datetime import date
from decimal import Decimal as D

from django.test import SimpleTestCase

from .cartes import A_FACTURER, DEJA_FACTUREE, PERTE, cle_personne, evaluer, message_alerte, personnes_de_la_ligne, synthese
from .oreole import tarifer_adherent

CARTE_DEJA = {"Cle": "X", "CleFamille": "F", "Anonyme": False, "Montant": 3000, "Date": "2026-05-04T10:00:00", "Utilisateur": "A", "NumeroPolice": "P1"}


def personne(cle, famille="F", anonyme=False):
    return {"Cle": cle, "CleFamille": famille, "Anonyme": anonyme, "Lien": "A", "Nom": "N", "Prenoms": "P", "DateNaissance": None}


class CleDePersonne(SimpleTestCase):
    def test_sans_accent_ni_casse_ni_ponctuation(self):
        self.assertEqual(cle_personne("Koné", "Awa-Marie", date(1990, 1, 2)), cle_personne("KONE", " awa  marie ", "1990-01-02"))

    def test_une_autre_date_est_une_autre_personne(self):
        self.assertNotEqual(cle_personne("KONE", "AWA", "1990-01-02"), cle_personne("KONE", "AWA", "1990-01-03"))

    def test_sans_date(self):
        self.assertEqual(cle_personne("KONE", "AWA", None), "KONE|AWA|")


class PersonnesDeLaLigne(SimpleTestCase):
    LIGNE = {"Nom": "KONE", "Prenoms": "AWA", "DateNaissance": date(1990, 1, 2), "Personnes": 3, "IdAdherentBase": 0,
             "Ayants": [{"Lien": "C", "Nom": "KONE", "Prenoms": "ALI", "DateNaissance": date(1988, 1, 1)}]}

    def test_adherent_ayant_et_personne_non_nommee(self):
        personnes = personnes_de_la_ligne(self.LIGNE)
        self.assertEqual([p["Lien"] for p in personnes], ["A", "C", "?"])
        self.assertEqual(personnes[2]["Cle"], "KONE|AWA|1990-01-02#1")
        self.assertTrue(personnes[2]["Anonyme"])

    def test_ajout_a_une_famille_existante_seulement_les_ajoutes(self):
        personnes = personnes_de_la_ligne({**self.LIGNE, "IdAdherentBase": 12})
        self.assertEqual([p["Lien"] for p in personnes], ["C"])


class EtatDesCartes(SimpleTestCase):
    def test_jamais_facturee(self):
        self.assertEqual(evaluer([personne("A")], {})[0]["Etat"], A_FACTURER)

    def test_deja_facturee(self):
        etat = evaluer([personne("A")], {"A": [{**CARTE_DEJA, "Cle": "A"}]})[0]
        self.assertEqual(etat["Etat"], DEJA_FACTUREE)
        self.assertEqual(etat["Historique"][0]["Montant"], 3000)

    def test_perte_choisie_pour_cette_personne_seulement(self):
        cartes = {"A": [{**CARTE_DEJA, "Cle": "A"}], "B": [{**CARTE_DEJA, "Cle": "B"}]}
        etats = evaluer([personne("A"), personne("B")], cartes, pertes=["A"])
        self.assertEqual([e["Etat"] for e in etats], [PERTE, DEJA_FACTUREE])

    def test_perte_sans_facturation_reste_une_premiere(self):
        self.assertEqual(evaluer([personne("A")], {}, pertes=["A"])[0]["Etat"], A_FACTURER)

    def test_carte_non_nommee_couvre_la_personne_nommee_ensuite(self):
        cartes = {"F#1": [{**CARTE_DEJA, "Cle": "F#1", "Anonyme": True}]}
        etats = evaluer([personne("A"), personne("B")], cartes)
        self.assertEqual([e["Etat"] for e in etats], [DEJA_FACTUREE, A_FACTURER])

    def test_personne_non_nommee_garde_sa_carte(self):
        cartes = {"F#1": [{**CARTE_DEJA, "Cle": "F#1", "Anonyme": True}]}
        etats = evaluer([personne("F#1", anonyme=True), personne("A")], cartes)
        self.assertEqual([e["Etat"] for e in etats], [DEJA_FACTUREE, A_FACTURER])

    def test_une_carte_ne_couvre_pas_une_autre_famille(self):
        cartes = {"G#1": [{**CARTE_DEJA, "Cle": "G#1", "CleFamille": "G", "Anonyme": True}]}
        self.assertEqual(evaluer([personne("A")], cartes)[0]["Etat"], A_FACTURER)


class Alerte(SimpleTestCase):
    def test_message_attendu(self):
        message = message_alerte({"Nom": "KONE", "Prenoms": "AWA"}, CARTE_DEJA)
        self.assertIn("existe déjà pour KONE AWA", message)
        self.assertIn("le 04/05/2026, 3 000 F, par A, police P1", message)
        self.assertTrue(message.endswith("Un renouvellement pour perte est nécessaire pour poursuivre."))

    def test_synthese(self):
        ligne = {"Rang": 1, "IdAdherentBase": 0, "CartesAFacturer": 1, "Cartes": [
            {**personne("A"), "Etat": A_FACTURER, "Historique": []},
            {**personne("B"), "Etat": DEJA_FACTUREE, "Historique": [{**CARTE_DEJA, "Cle": "B"}]},
        ]}
        resultat = synthese([ligne], D(3000))
        self.assertEqual((resultat["AFacturer"], resultat["MontantTotal"]), (1, 3000))
        self.assertEqual(len(resultat["DejaFacturees"]), 1)
        self.assertIn("renouvellement pour perte", resultat["Alerte"])
        self.assertEqual(resultat["MontantAjouts"], 0)

    def test_montant_des_ajouts_a_part(self):
        ligne = {"Rang": 1, "IdAdherentBase": 9, "CartesAFacturer": 2, "Cartes": []}
        self.assertEqual(synthese([ligne], D(3000))["MontantAjouts"], 6000)


class PrimeAvecCartes(SimpleTestCase):
    OFFRE = {"cotisation": D(436800), "primeht": D(123333), "accessoires": D(10000), "partia": D(6000), "partafa": D(7500), "enfantsupplementaire": D(35000)}
    REGLES = {"SurprimeAffection": D(30), "Age1Debut": 60, "Age1Taux": D(30), "Age2Debut": 65, "Age2Taux": D(50), "Carte": D(3000)}

    def test_seules_les_cartes_a_facturer_entrent_dans_la_prime(self):
        t = tarifer_adherent(self.OFFRE, {"Age": 40, "Personnes": 4, "CartesAFacturer": 1}, self.REGLES, carte=True)
        self.assertEqual(t["MontantCartes"], 3000)
        self.assertEqual(t["Cotisation"], 439800)

    def test_aucune_carte_a_facturer(self):
        t = tarifer_adherent(self.OFFRE, {"Age": 40, "Personnes": 4, "CartesAFacturer": 0}, self.REGLES, carte=True)
        self.assertEqual(t["MontantCartes"], 0)
        self.assertEqual(t["Cotisation"], 436800)
