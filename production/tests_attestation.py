from datetime import date
from types import SimpleNamespace

from django.test import SimpleTestCase

from .views_attestation import _ligne_attestation


class DatesDemandeAttestationAutoTests(SimpleTestCase):
    def setUp(self):
        self.client = SimpleNamespace(
            idtypeclient=SimpleNamespace(code_type="PP"),
            Nom="Client",
            Prenoms="Test",
            Email="client@example.test",
            Mobile="0102030405",
            Telephone="",
            CodePostal="",
        )
        self.detail = SimpleNamespace(
            idtarif=1,
            idusage=SimpleNamespace(code_usage_asaci="USAGE", CodeUsage=""),
            essence=SimpleNamespace(CodeEnergie="ESS"),
            idgenrevehicule=SimpleNamespace(CodeGenre="GENRE"),
            idmarque=SimpleNamespace(LibelleMarque="MARQUE"),
            idtypevehicule=SimpleNamespace(code_type="TYPE"),
            matricule="1234 AB 01",
            numchassis="CHASSIS",
            modelevehicule="MODELE",
            nombreplace=5,
            garanties=SimpleNamespace(all=lambda: []),
        )
        self.tarifs = {
            1: SimpleNamespace(code_categorie_asaci="CATEGORIE", IdCategorie=None, CodeCategorie=""),
        }

    def test_utilise_les_dates_corrigees_du_contrat(self):
        devis = SimpleNamespace(
            dateeffet=date(2025, 1, 1),
            dateexpiration=date(2025, 12, 31),
            numero_police_compagnie="POLICE-CIE",
        )
        contrat = SimpleNamespace(
            dateeffet=date(2026, 3, 1),
            dateexpiration=date(2027, 2, 28),
            numeropolice="POLICE",
        )

        ligne = _ligne_attestation(
            devis, self.detail, contrat, self.client, self.client, self.tarifs
        )

        self.assertEqual(ligne[-2:], ["2026-03-01", "2027-02-28"])

    def test_utilise_les_dates_du_devis_sans_contrat(self):
        devis = SimpleNamespace(
            dateeffet=date(2025, 1, 1),
            dateexpiration=date(2025, 12, 31),
            numero_police_compagnie="POLICE-CIE",
        )

        ligne = _ligne_attestation(
            devis, self.detail, None, self.client, self.client, self.tarifs
        )

        self.assertEqual(ligne[-2:], ["2025-01-01", "2025-12-31"])
