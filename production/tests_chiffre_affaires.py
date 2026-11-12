"""Chiffre d'affaires du cabinet (courtier : commissions et accessoires, demande du 2026-11-12) : assemblage des lectures,
sans base de données."""
from datetime import date

from django.test import SimpleTestCase

from .chiffre_affaires import assembler

EN_COURS = {"debut": date(2026, 1, 1), "au": date(2026, 11, 12), "debut_n1": date(2025, 1, 1), "au_n1": date(2025, 11, 12)}
CLOS = {"debut": date(2025, 1, 1), "au": date(2025, 12, 31), "debut_n1": date(2024, 1, 1), "au_n1": date(2024, 12, 31)}
SANS_RAFAS = {"Lignes": [], "NonReglee": 0.0}
SANS_APPORTEUR = {"Payees": 0.0, "APayer": 0.0}


def acte(annee, mois, commission, accessoires=0, pn=0, nombre=1, comparable=True):
    return {"annee": annee, "mois": mois, "comparable": comparable, "nombre": nombre, "commission": commission,
            "accessoires": accessoires, "pn": pn}


def percu(source, jour, montant, produit=1, compagnie=1):
    return {"source": source, "jour": jour, "montant": montant, "idproduit": produit, "idcompagnie": compagnie}


class ChiffreAffairesAcquis(SimpleTestCase):
    def test_commissions_et_accessoires_du_cabinet(self):
        ca = assembler(EN_COURS, [acte(2026, 3, 100_000, 5_000, 400_000), acte(2026, 11, 20_000, 1_000, 100_000)], [], SANS_RAFAS, SANS_APPORTEUR)
        self.assertEqual((ca["Total"], ca["Commissions"], ca["Accessoires"]), (126_000, 120_000, 6_000))
        self.assertEqual(ca["TauxMoyen"], 25.2)  # 126 000 sur 500 000 de prime nette
        self.assertEqual(ca["ParMois"][2]["ChiffreAffaires"], 105_000)

    def test_comparaison_a_la_meme_date_de_l_an_dernier(self):
        lignes = [acte(2026, 1, 50_000), acte(2025, 1, 30_000), acte(2025, 12, 70_000, comparable=False)]
        ca = assembler(EN_COURS, lignes, [], SANS_RAFAS, SANS_APPORTEUR)
        self.assertEqual(ca["Precedent"], 30_000)  # décembre 2025 hors de la même période
        self.assertEqual(ca["ParMois"][11]["ChiffreAffairesPrecedent"], 70_000)  # mais dans le graphique

    def test_mois_a_venir_sans_chiffre(self):
        ca = assembler(EN_COURS, [acte(2026, 1, 10_000)], [], SANS_RAFAS, SANS_APPORTEUR)
        self.assertIsNone(ca["ParMois"][11]["ChiffreAffaires"])
        self.assertEqual(ca["ParMois"][10]["ChiffreAffaires"], 0)
        clos = assembler(CLOS, [acte(2025, 12, 10_000)], [], SANS_RAFAS, SANS_APPORTEUR)
        self.assertEqual(clos["ParMois"][11]["ChiffreAffaires"], 10_000)

    def test_montant_invalide_compte_pour_zero(self):
        ca = assembler(EN_COURS, [acte(2026, 2, float("nan"), 2_000)], [], SANS_RAFAS, SANS_APPORTEUR)
        self.assertEqual(ca["Total"], 2_000)

    def test_rafas_dans_le_chiffre_d_affaires(self):
        rafas = {"Lignes": [{"sens": "emis", "jour": date(2026, 6, 30), "nombre": 1, "montant": 650_000, "base": 10_000_000},
                            {"sens": "regle", "jour": date(2026, 7, 15), "nombre": 1, "montant": 650_000, "base": 0},
                            {"sens": "emis", "jour": date(2025, 6, 30), "nombre": 1, "montant": 500_000, "base": 8_000_000}],
                 "NonReglee": 100_000}
        ca = assembler(EN_COURS, [acte(2026, 6, 50_000, pn=200_000)], [], rafas, SANS_APPORTEUR)
        self.assertEqual((ca["Total"], ca["Rafas"], ca["Precedent"]), (700_000, 650_000, 500_000))
        self.assertEqual(ca["TauxMoyen"], 25.0)  # RAFAS à part : pas de prime d'assurance
        self.assertEqual((ca["Percu"]["Rafas"], ca["EnAttente"]["Rafas"]), (650_000, 100_000))
        self.assertEqual(ca["ParMois"][5]["ChiffreAffaires"], 700_000)


class ChiffreAffairesPercu(SimpleTestCase):
    def test_sources_et_repartition(self):
        lignes = [percu("Compagnies", date(2026, 4, 2), 80_000, produit=1, compagnie=7),
                  percu("FraisCourtiers", date(2026, 11, 3), 12_500, produit=5, compagnie=29),
                  percu("Reprises", date(2026, 2, 1), 9_000, produit=1, compagnie=7),
                  percu("Compagnies", date(2025, 4, 2), 40_000), percu("Compagnies", date(2025, 12, 2), 99_000)]
        ca = assembler(EN_COURS, [], lignes, SANS_RAFAS, SANS_APPORTEUR, en_attente={"AReclamer": 15_000, "Reclamees": 5_000})
        self.assertEqual(ca["Percu"], {"Total": 101_500, "Compagnies": 80_000, "FraisCourtiers": 12_500, "Reprises": 9_000, "Rafas": 0})
        self.assertEqual(ca["PercuPrecedent"], 40_000)  # décembre 2025 hors de la même période
        self.assertEqual(ca["PercuParProduit"], {1: 89_000, 5: 12_500})
        self.assertEqual(ca["PercuParCompagnie"], {7: 89_000, 29: 12_500})
        self.assertEqual(ca["ParMois"][3]["Percu"], 80_000)
        self.assertEqual(ca["EnAttente"]["Total"], 20_000)

    def test_net_des_apporteurs(self):
        ca = assembler(EN_COURS, [acte(2026, 5, 300_000)], [], SANS_RAFAS, {"Payees": 25_000, "APayer": 50_000})
        self.assertEqual((ca["Apporteurs"]["Total"], ca["Net"]), (75_000, 225_000))
