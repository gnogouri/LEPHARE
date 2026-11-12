from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from production.views import _enregistrer_maisons_mrh


class EnregistrerMaisonsMRHTests(SimpleTestCase):
    @patch("production.views.MRHCalculService")
    @patch("production.views.UsageHabitation.objects.filter")
    def test_recalcule_les_totaux_une_seule_fois_pour_plus_de_45_maisons(
        self, filter_usage, service_class
    ):
        filter_usage.return_value.first.return_value = SimpleNamespace(offre_id=10)
        service = service_class.return_value
        totaux = {"primettc": 123}
        service.mettre_a_jour_totaux_devis.return_value = totaux
        devis = SimpleNamespace(iddevis=1, produit_id=4, compagnie_id=2)
        maisons = [{"code_usage": "HAB"} for _ in range(46)]

        resultat = _enregistrer_maisons_mrh(devis, maisons, id_tarif=81)

        self.assertEqual(service.calculer_et_enregistrer_maison.call_count, 46)
        self.assertTrue(
            all(
                appel.kwargs["mettre_a_jour_totaux"] is False
                for appel in service.calculer_et_enregistrer_maison.call_args_list
            )
        )
        service.mettre_a_jour_totaux_devis.assert_called_once_with(
            id_devis=1,
            id_produit=4,
            id_compagnie=2,
            inclure_accessoires=True,
        )
        self.assertEqual(resultat, totaux)
