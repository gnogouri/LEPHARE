"""MRH : import Excel des maisons (production/import_mrh.py) et devis d'incorporation vide refusé à la confirmation
(demandes du 2026-11-10). Sans base de données."""

import io
from decimal import Decimal
from unittest import mock

import openpyxl
from django.test import SimpleTestCase

from .import_mrh import ErreurImportMrh, _cle, _feuille_et_entete, _montant
from .incorporation import verifier_incorporation_non_vide


def classeur(*lignes):
    c = openpyxl.Workbook()
    for ligne in lignes:
        c.active.append(list(ligne))
    return c


class MontantsEtIntitules(SimpleTestCase):
    def test_montants_ecrits_de_plusieurs_facons(self):
        self.assertEqual(_montant(25000000, "x"), Decimal(25000000))
        self.assertEqual(_montant("25 000 000", "x"), Decimal(25000000))
        self.assertEqual(_montant("25.000.000 F", "x"), Decimal(25000000))
        self.assertEqual(_montant("8 000 000 FCFA", "x"), Decimal(8000000))
        self.assertIsNone(_montant("  ", "x"))
        self.assertIsNone(_montant(None, "x"))

    def test_montant_negatif_ou_illisible_refuse(self):
        with self.assertRaisesRegex(ValueError, "négatif"):
            _montant(-5, "Prime nette")
        with self.assertRaisesRegex(ValueError, "illisible"):
            _montant("douze", "Prime nette")

    def test_libelles_compares_sans_accents_ni_ponctuation(self):
        self.assertEqual(_cle("Propriétaire Non-Occupant Meublé"), "proprietairenonoccupantmeuble")
        self.assertEqual(_cle("proprietaire_non_occupant_meuble"), "proprietairenonoccupantmeuble")

    def test_ligne_d_intitules_reconnue_sous_un_titre(self):
        c = classeur(["Liste des maisons du client"], [],
                     ["N°", "Qualité de l'occupant / usage", "Situation géographique", "Bâtiment", "Contenu", "Prime nette annuelle", "Prime TTC"])
        feuille, ligne, colonnes = _feuille_et_entete(c)
        self.assertEqual(ligne, 3)
        self.assertEqual(colonnes, {"usage": 1, "adresse": 2, "valeur_batiment": 3, "valeur_contenu": 4, "prime_nette": 5})

    def test_fichier_sans_liste_de_maisons(self):
        with self.assertRaisesRegex(ErreurImportMrh, "Aucune liste de maisons"):
            _feuille_et_entete(classeur(["Nom", "Prénoms", "Date de naissance"]))


class IncorporationVide(SimpleTestCase):
    def curseur(self, ligne):
        c = mock.Mock()
        c.fetchone.return_value = ligne
        return c

    def test_devis_d_incorporation_sans_objet_refuse(self):
        with self.assertRaisesRegex(ValueError, "ne contient encore aucune"):
            verifier_incorporation_non_vide(self.curseur((True, False)), 1)

    def test_autres_devis_non_concernes(self):
        verifier_incorporation_non_vide(self.curseur((True, True)), 1)     # incorporation avec ses maisons
        verifier_incorporation_non_vide(self.curseur((False, False)), 1)   # devis repris d'URANUS, en-tête seul
        verifier_incorporation_non_vide(self.curseur(None), 1)


class AdresseTropLongue(SimpleTestCase):
    """Erreur vue en production le 2026-11-09 : « valeur trop longue pour le type character varying(50) » (adresse d'une maison)."""

    def test_message_lisible_a_la_place_de_l_erreur_de_la_base(self):
        from .views import _message_erreur_mrh
        message = _message_erreur_mrh(Exception("ERREUR: valeur trop longue pour le type character varying(50)"))
        self.assertIn("50 caractères au plus", message)
        self.assertIn("adresse", message)
        self.assertIn("150 caractères", _message_erreur_mrh(Exception("value too long for type character varying(150)")))

    @mock.patch("production.views.MRHCalculService")
    @mock.patch("production.views.UsageHabitation.objects.filter")
    def test_adresse_de_plus_de_150_caracteres_refusee_avant_la_base(self, filtre, service):
        from types import SimpleNamespace

        from .views import _enregistrer_maisons_mrh
        filtre.return_value.first.return_value = SimpleNamespace(offre_id=10)
        maisons = [{"code_usage": "locataire", "adresse": "Cocody"}, {"code_usage": "locataire", "adresse": "x" * 151}]
        with self.assertRaisesRegex(ValueError, "Maison 2 : l'adresse compte 151 caractères, 150 au plus"):
            _enregistrer_maisons_mrh(SimpleNamespace(iddevis=1, produit_id=4, compagnie_id=1), maisons)


class ClasseurReel(SimpleTestCase):
    def test_lecture_d_un_classeur_enregistre(self):
        c = classeur(["Usage de l'habitation", "Adresse", "Valeur du contenu", "Loyer mensuel"], ["Location Totale", "Yopougon", 5000000, 200000])
        tampon = io.BytesIO()
        c.save(tampon)
        lu = openpyxl.load_workbook(io.BytesIO(tampon.getvalue()), read_only=True, data_only=True)
        _feuille, ligne, colonnes = _feuille_et_entete(lu)
        self.assertEqual((ligne, sorted(colonnes)), (1, ["adresse", "loyer_mensuel", "usage", "valeur_contenu"]))
