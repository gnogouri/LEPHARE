"""Contrôle de la qualité de l'effectif (attentes de l'équipe actuariat du 2026-11-11, point 2.3) : fonction pure, sans base de données."""
from datetime import date

from django.test import SimpleTestCase

from .consommations_qualite import controler, doublons_fichier, garants_sans_genre

AU = date(2026, 12, 31)


def personne(matricule, statut, naissance, assure=None, police="ALPHA", garant="OREOLE", genre="", nom="NOM", prenoms="PRENOM", effet=None):
    return {"matricule_beneficiaire": matricule, "matricule_assure": assure or matricule, "statut": statut, "date_naissance": naissance,
            "police": police, "garant": garant, "genre": genre, "nom": nom, "prenoms": prenoms, "date_effet": effet, "actif": True}


def cas(controles, code):
    return [c["Matricule"] for c in next(x for x in controles if x["Code"] == code)["Cas"]]


class ControleEffectif(SimpleTestCase):
    def test_famille_conforme(self):
        famille = [personne("1", "A", date(1980, 1, 1)), personne("2", "C", date(1982, 1, 1), "1", nom="NOM", prenoms="CONJOINTE"),
                   personne("3", "E", date(2010, 1, 1), "1", prenoms="ENFANT")]
        self.assertEqual(sum(c["Nombre"] for c in controler(famille, AU)), 0)

    def test_rattachements(self):
        effectif = [personne("1", "A", date(1980, 1, 1)), personne("2", "E", date(2010, 1, 1), "9"),
                    personne("3", "C", date(1985, 1, 1), "1", police="BETA", prenoms="C1"), personne("4", "C", date(1986, 1, 1), "1", prenoms="C2"),
                    personne("5", "A", date(1975, 1, 1), "8", prenoms="P5")]
        c = controler(effectif, AU)
        self.assertEqual(cas(c, "Q04"), ["2"])            # assuré principal 9 inexistant
        self.assertEqual(cas(c, "Q05"), ["3"])            # conjoint dans une autre entreprise
        self.assertEqual(sorted(cas(c, "Q13")), ["3", "4"])  # deux conjoints pour l'assuré 1
        self.assertEqual(cas(c, "Q03"), ["5"])            # assuré principal au matricule assuré différent

    def test_ages_et_statuts(self):
        effectif = [personne("1", "A", date(1960, 1, 1)), personne("2", "E", date(1998, 1, 1), "1", prenoms="E26"),
                    personne("3", "E", date(2003, 6, 1), "1", prenoms="E23"), personne("4", "A", date(2012, 1, 1), prenoms="MINEUR"),
                    personne("5", "E", date(1965, 1, 1), "1", prenoms="AGE"), personne("6", "A", None, prenoms="SANS"),
                    personne("7", "X", date(1990, 1, 1), prenoms="INCONNU"), personne("8", "A", date(1900, 1, 1), prenoms="CENTENAIRE")]
        c = controler(effectif, AU)
        self.assertIn("2", cas(c, "Q10"))
        self.assertEqual(cas(c, "Q11"), ["3"])
        self.assertEqual(cas(c, "Q08"), ["4"])
        self.assertIn("5", cas(c, "Q12"))                 # enfant à 5 ans d'écart de son assuré principal
        self.assertEqual(cas(c, "Q06"), ["6"])
        self.assertEqual(cas(c, "Q14"), ["7"])
        self.assertEqual(cas(c, "Q07"), ["8"])

    def test_doublons_et_identites(self):
        effectif = [personne("1", "A", date(1980, 1, 1)), personne("2", "A", date(1980, 1, 1))]
        c = controler(effectif, AU, doublons_fichier([{"matricule_beneficiaire": "7", "police": "ALPHA"}, {"matricule_beneficiaire": "7"}]))
        self.assertEqual(cas(c, "Q01"), ["7"])
        self.assertEqual(sorted(cas(c, "Q02")), ["1", "2"])

    def test_genre_controle_chez_les_garants_qui_le_donnent(self):
        # EFFECTIF OREOLE n'a pas de colonne GENRE, EFFECTIF OREOLE CGA en a une
        effectif = [personne("1", "A", date(1980, 1, 1), garant="OREOLE"), personne("2", "A", date(1981, 1, 1), garant="OREOLE CGA", genre="M", prenoms="B"),
                    personne("3", "A", date(1982, 1, 1), garant="OREOLE CGA", prenoms="C")]
        self.assertEqual(cas(controler(effectif, AU), "Q17"), ["3"])
        self.assertEqual(garants_sans_genre(effectif), ["OREOLE"])

    def test_date_effet(self):
        effectif = [personne("1", "A", date(1980, 1, 1), effet=date(1979, 1, 1)), personne("2", "A", date(1980, 1, 1), effet=date(2027, 1, 1), prenoms="B")]
        self.assertEqual(sorted(cas(controler(effectif, AU), "Q16")), ["1", "2"])
