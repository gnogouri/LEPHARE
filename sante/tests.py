from datetime import date

from django.test import SimpleTestCase

from production.renouvellement import ErreurRenouvellement

from .avenant import _membre, _nouvelle_famille, formule_a_la_taille


class MembreIncorporeTests(SimpleTestCase):
    """Nouveau membre d'un avenant d'incorporation Santé (sante/avenant.py)."""

    def test_sans_membre(self):
        self.assertIsNone(_membre(None))
        self.assertIsNone(_membre({}))

    def test_membre_complet(self):
        membre = _membre({"Lien": "e", "Nom": " Kone ", "Prenom": "Awa", "DateNaissance": "2015-01-01", "Sexe": "f",
                          "Certificat": True, "NombrePathologie": "1"})
        self.assertEqual(membre, {"lien": "E", "nom": "KONE", "prenom": "AWA", "sexe": "F", "naissance": date(2015, 1, 1),
                                  "certificat": True, "pathologies": 1})

    def test_valeurs_par_defaut(self):
        membre = _membre({"Lien": "C", "Nom": "Kone", "DateNaissance": "10/05/1990", "Sexe": "M"})
        self.assertEqual((membre["prenom"], membre["certificat"], membre["pathologies"]), ("", False, 0))
        self.assertEqual(membre["naissance"], date(1990, 5, 10))

    def test_saisies_refusees(self):
        complet = {"Lien": "E", "Nom": "Kone", "DateNaissance": "2015-01-01", "Sexe": "M"}
        for modification in ({"Lien": "A"}, {"Nom": " "}, {"DateNaissance": ""}, {"DateNaissance": "31/02/2015"},
                             {"Sexe": ""}, {"Sexe": "X"}, {"NombrePathologie": "deux"}):
            with self.subTest(modification=modification), self.assertRaises(ErreurRenouvellement):
                _membre({**complet, **modification})
        with self.assertRaises(ErreurRenouvellement):
            _membre(["Kone"])


class NouvelleFamilleTests(SimpleTestCase):
    """Famille incorporée par avenant Santé (sante/avenant.py)."""

    ADHERENT = {"Nom": " Kone ", "Prenom": "Issa", "DateNaissance": "1985-03-02", "Sexe": "m", "Matricule": " M12 "}

    def test_sans_famille(self):
        self.assertIsNone(_nouvelle_famille(None))
        self.assertIsNone(_nouvelle_famille({}))

    def test_famille_complete(self):
        famille = _nouvelle_famille({"IdOffre": "18", "Adherent": self.ADHERENT, "Membres": [
            {"Lien": "C", "Nom": "Kone", "Prenom": "Awa", "DateNaissance": "1990-01-01", "Sexe": "F"},
            {"Lien": "E", "Nom": "Kone", "DateNaissance": "2015-01-01", "Sexe": "M"}]})
        self.assertEqual(famille["offre"], 18)
        self.assertEqual(famille["adherent"], {"nom": "KONE", "prenom": "ISSA", "sexe": "M", "naissance": date(1985, 3, 2),
                                               "matricule": "M12", "mobile": "", "pathologies": 0})
        self.assertEqual([m["lien"] for m in famille["membres"]], ["C", "E"])

    def test_adherent_seul(self):
        self.assertEqual(_nouvelle_famille({"IdOffre": 17, "Adherent": self.ADHERENT})["membres"], [])

    def test_saisies_refusees(self):
        for famille in ({"IdOffre": 0, "Adherent": self.ADHERENT}, {"IdOffre": "x", "Adherent": self.ADHERENT},
                        {"IdOffre": 18}, {"IdOffre": 18, "Adherent": {**self.ADHERENT, "Nom": ""}},
                        {"IdOffre": 18, "Adherent": {**self.ADHERENT, "Sexe": "X"}},
                        {"IdOffre": 18, "Adherent": {**self.ADHERENT, "DateNaissance": ""}},
                        {"IdOffre": 18, "Adherent": self.ADHERENT, "Membres": "Awa"},
                        {"IdOffre": 18, "Adherent": self.ADHERENT, "Membres": [{"Lien": "A", "Nom": "X", "DateNaissance": "2015-01-01", "Sexe": "M"}]},
                        {"IdOffre": 18, "Adherent": self.ADHERENT, "Membres": [{}]}):
            with self.subTest(famille=famille), self.assertRaises(ErreurRenouvellement):
                _nouvelle_famille(famille)

    def test_formule_a_la_taille(self):
        minene = [{"IdOffre": 17, "PersonnesMin": 1, "PersonnesMax": 1}, {"IdOffre": 18, "PersonnesMin": 2, "PersonnesMax": 3},
                  {"IdOffre": 19, "PersonnesMin": 4, "PersonnesMax": 6}]
        self.assertEqual(formule_a_la_taille(minene, 17, 1)["IdOffre"], 17)
        self.assertEqual(formule_a_la_taille(minene, 17, 3)["IdOffre"], 18)
        self.assertEqual(formule_a_la_taille(minene, 18, 5)["IdOffre"], 19)
        self.assertIsNone(formule_a_la_taille(minene, 18, 7))
        classique = [{"IdOffre": 40, "PersonnesMin": None, "PersonnesMax": None}]
        self.assertEqual(formule_a_la_taille(classique, 40, 9)["IdOffre"], 40)
        self.assertIsNone(formule_a_la_taille(classique, 41, 1))
