from datetime import date

from django.test import SimpleTestCase

from .incorporation import ErreurRenouvellement, _cle_immatriculation, _verifier_periode, _verifier_periode_devis


class IncorporationPeriodeTests(SimpleTestCase):
    def setUp(self):
        self.jour = date(2026, 10, 31)
        self.debut = date(2026, 1, 1)
        self.echeance = date(2026, 12, 31)

    def test_accepte_une_date_future_dans_la_periode(self):
        _verifier_periode(date(2026, 11, 15), self.debut, self.echeance)

    def test_accepte_une_date_passee_dans_la_periode(self):
        _verifier_periode(date(2026, 4, 1), self.debut, self.echeance)
        _verifier_periode(self.debut, self.debut, self.echeance)
        _verifier_periode(self.echeance, self.debut, self.echeance)

    def test_refuse_une_date_apres_echeance(self):
        with self.assertRaises(ErreurRenouvellement):
            _verifier_periode(date(2027, 1, 1), self.debut, self.echeance)

    def test_refuse_une_date_avant_effet_du_contrat(self):
        with self.assertRaises(ErreurRenouvellement):
            _verifier_periode(date(2025, 12, 31), self.debut, self.echeance)

    def test_refuse_une_date_absente(self):
        with self.assertRaises(ErreurRenouvellement):
            _verifier_periode(None, self.debut, self.echeance)

    def test_devis_incorporation_seule_echeance_figee(self):
        _verifier_periode_devis("INC", self.debut, self.echeance, self.jour, self.echeance)
        _verifier_periode_devis("INC", self.debut, self.echeance, date(2026, 4, 1), self.echeance)
        with self.assertRaises(ValueError):
            _verifier_periode_devis("INC", self.debut, self.echeance, self.jour, self.jour)
        with self.assertRaises(ValueError):
            _verifier_periode_devis("INC", self.debut, self.echeance, date(2025, 12, 31), self.echeance)

    def test_periode_des_autres_mouvements_inchangee(self):
        _verifier_periode_devis("REN", self.debut, self.echeance, self.debut, self.debut)

    def test_immatriculation_comparee_sans_espaces_ni_tirets(self):
        self.assertEqual(_cle_immatriculation(" 5267 ja-01 "), _cle_immatriculation("5267JA01"))
        self.assertNotEqual(_cle_immatriculation("5267JA01"), _cle_immatriculation("5267JA02"))
