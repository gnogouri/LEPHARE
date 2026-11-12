from decimal import Decimal

import pandas as pd
from django.test import SimpleTestCase

from .import_assures import ValidationError, extraire_modele_2, valider_monetaire
from .views_cockpit import _franc


class CelluleVideTests(SimpleTestCase):
    """Une cellule vide d'un fichier Excel arrive en « nan » (pandas) : elle ne doit jamais devenir un montant."""

    def test_cellule_vide_vaut_zero(self):
        for valeur in (float("nan"), "nan", "NaN", "", "  ", None):
            with self.subTest(valeur=valeur):
                self.assertEqual(valider_monetaire(valeur, "PRIME HT"), Decimal("0"))

    def test_montant_conserve(self):
        self.assertEqual(valider_monetaire("1500,50", "PRIME HT"), Decimal("1500.50"))
        self.assertEqual(valider_monetaire(4240, "PRIME HT"), Decimal("4240"))

    def test_valeur_non_numerique_refusee(self):
        for valeur in ("inf", "abc"):
            with self.subTest(valeur=valeur), self.assertRaises(ValidationError):
                valider_monetaire(valeur, "PRIME HT")

    def test_import_primes_ht_et_ttc_au_singulier_ou_pluriel(self):
        for colonne_ht in ("PRIME HT", "PRIMES HT"):
            for colonne_ttc in ("PRIME TTC", "PRIMES TTC"):
                with self.subTest(colonne_ht=colonne_ht, colonne_ttc=colonne_ttc):
                    fichier = pd.DataFrame([{
                        "NOMS ET PRENOMS": "ASSURE TEST",
                        "DATE DE NAISSANCE": "01/01/1990",
                        "FONCTION": "EMPLOYE",
                        "CAPITAL DECES": 1_500_000,
                        "IPT": 1_500_000,
                        "BENEFICIAIRES": "",
                        colonne_ht: 12_278,
                        colonne_ttc: 14_693,
                    }])

                    assure = extraire_modele_2(fichier)[0]

                    self.assertEqual(assure["PrimeHT"], Decimal("12278"))
                    self.assertEqual(assure["PrimeTTC"], Decimal("14693"))


class TotauxTests(SimpleTestCase):
    def test_prime_invalide_comptee_pour_zero(self):
        self.assertEqual(_franc(Decimal("NaN")), 0)
        self.assertEqual(_franc(None), 0)
        self.assertEqual(_franc(Decimal("1500.4")), 1500)
