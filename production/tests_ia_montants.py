"""IA : montants exacts du fichier (décomposition HT / accessoire / taxe / TTC) et répartition au franc près. Sans base de données."""

from decimal import Decimal as D

from django.test import SimpleTestCase

from .ia_montants_imposes import decomposer, repartir


class DecompositionDesPrimesDuFichier(SimpleTestCase):
    def test_cga_2_millions(self):
        # 4 240 HT, 6 000 TTC à 14,5 % : accessoire 1 000, taxe 760
        pn, acc, ttc = decomposer(4240, 6000, 14.5)
        self.assertEqual((pn, acc, ttc), (D("4240.00"), D("1000"), D("6000.00")))
        self.assertEqual(ttc - pn - acc, D("760.00"))

    def test_primes_propres_a_chaque_assure(self):
        pn, acc, ttc = decomposer(151058, 184410, 14.5)
        self.assertEqual(acc, D("9999"))
        self.assertEqual(ttc - pn - acc, D("23353.00"))

    def test_centimes_du_fichier_gardes(self):
        pn, _acc, ttc = decomposer("309301.033", "363691.35", 14.5)
        self.assertEqual((pn, ttc), (D("309301.03"), D("363691.35")))

    def test_une_seule_prime_ne_suffit_pas(self):
        self.assertIsNone(decomposer(4240, 0, 14.5))
        self.assertIsNone(decomposer(0, 6000, 14.5))
        self.assertIsNone(decomposer(None, "", 14.5))

    def test_ttc_inferieure_a_la_taxe_sans_accessoire_negatif(self):
        pn, acc, ttc = decomposer(5000, 5100, 14.5)
        self.assertEqual(acc, D("0"))
        self.assertEqual(ttc - pn - acc, D("100.00"))


class Repartition(SimpleTestCase):
    def test_somme_juste_au_franc(self):
        parts = repartir(4240, [2120, 2120, 0])
        self.assertEqual(parts, [D(2120), D(2120), D(0)])
        self.assertEqual(sum(repartir(1000, [1, 1, 1])), D(1000))

    def test_parts_egales_sans_poids(self):
        self.assertEqual(repartir(10, [0, 0]), [D(5), D(5)])

    def test_centimes(self):
        parts = repartir(D("309301.03"), [1, 1], D("0.01"))
        self.assertEqual(sum(parts), D("309301.03"))
