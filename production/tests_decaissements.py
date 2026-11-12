"""Décaissement de tout règlement : contrôles du motif et de la date, règlements qui ne se décaissent pas. Sans base de données."""

from datetime import date

from django.test import SimpleTestCase

from .decaissements import ErreurDecaissement, controler_saisie, refus_decaissement

ESPECES = {"annule": False, "montant": 50000, "code_mode": "ESP", "cheque": False, "reverse": False}


class SaisieDuDecaissement(SimpleTestCase):
    JOUR = date(2026, 11, 6)

    def test_motif_et_date_retenus(self):
        self.assertEqual(controler_saisie("  Espèces   rendues au client ", "2026-11-05", date(2026, 11, 1), self.JOUR), ("Espèces rendues au client", date(2026, 11, 5)))

    def test_date_par_defaut_aujourd_hui(self):
        self.assertEqual(controler_saisie("Virement rejeté", None, None, self.JOUR)[1], self.JOUR)

    def test_motif_trop_court(self):
        with self.assertRaisesRegex(ErreurDecaissement, "motif"):
            controler_saisie("abc", None, None, self.JOUR)

    def test_date_future_refusee(self):
        with self.assertRaisesRegex(ErreurDecaissement, "postérieure"):
            controler_saisie("Virement rejeté", "2026-11-07", None, self.JOUR)

    def test_date_avant_le_reglement_refusee(self):
        with self.assertRaisesRegex(ErreurDecaissement, "précède"):
            controler_saisie("Virement rejeté", "2026-10-31", date(2026, 11, 1), self.JOUR)

    def test_date_illisible(self):
        with self.assertRaises(ErreurDecaissement):
            controler_saisie("Virement rejeté", "demain", None, self.JOUR)


class ReglementsDecaissables(SimpleTestCase):
    def test_especes_virement_mobile_decaissables(self):
        for code in ("ESP", "VIR", "PYM", "CRD", "TRT", "CMP", ""):
            self.assertEqual(refus_decaissement({**ESPECES, "code_mode": code}), "", code)

    def test_deja_annule(self):
        self.assertIn("déjà annulé", refus_decaissement({**ESPECES, "annule": True}))

    def test_contre_passation(self):
        self.assertIn("contre-passation", refus_decaissement({**ESPECES, "montant": -50000}))
        for code in ("ANL", "CPA", "DMA"):
            self.assertTrue(refus_decaissement({**ESPECES, "code_mode": code}), code)

    def test_cheque_du_portefeuille(self):
        self.assertIn("onglet Chèques", refus_decaissement({**ESPECES, "code_mode": "CHQ", "cheque": True}))

    def test_cheque_sans_portefeuille_decaissable(self):
        # Chèque repris d'URANUS sans fiche au portefeuille : il se décaisse comme un autre règlement
        self.assertEqual(refus_decaissement({**ESPECES, "code_mode": "CHQ", "cheque": False}), "")

    def test_deja_reverse(self):
        self.assertIn("reversé", refus_decaissement({**ESPECES, "reverse": True}))
