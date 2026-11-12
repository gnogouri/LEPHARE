"""Calcul de la cotisation Oreole Santé, sans base de données : python manage.py test sante.tests_oreole"""
from decimal import Decimal as D

from django.test import SimpleTestCase

from sante.oreole import ErreurOreole, taux_age, tarifer_adherent, ventiler_reglement

REGLES = {"SurprimeAffection": D(30), "Age1Debut": 60, "Age1Taux": D(30), "Age2Debut": 65, "Age2Taux": D(50), "Carte": D(3000)}
OFFRE_436 = {"cotisation": D(436800), "primeht": D(123333), "accessoires": D(10000), "partia": D(6000), "partafa": D(7500), "enfantsupplementaire": D(35000)}
OFFRE_400 = {"cotisation": D(400000), "primeht": D(123333), "accessoires": D(10000), "partia": D(0), "partafa": D(0), "enfantsupplementaire": D(35000)}
OFFRE_575 = {"cotisation": D(575000), "primeht": D(300000), "accessoires": D(5000), "partia": D(17000), "partafa": D(15000), "enfantsupplementaire": D(70000)}


class TarifOreole(SimpleTestCase):
    def test_decomposition_des_fichiers_tarifs(self):
        t = tarifer_adherent(OFFRE_436, {"Age": 40}, REGLES)
        self.assertEqual(t["Cotisation"], 436800)
        self.assertEqual(t["PartSante"], 423300)
        self.assertEqual(t["FraisCourtiers"], 289967)  # 244 209 de frais + 45 758 de la colonne taxes
        t = tarifer_adherent(OFFRE_575, {"Age": 40}, REGLES)
        self.assertEqual(t["PartSante"], 543000)
        self.assertEqual(t["FraisCourtiers"], 238000)

    def test_affection_sur_le_cumul_ia_et_afa_inchangees(self):
        t = tarifer_adherent(OFFRE_436, {"Age": 40, "Affections": 1}, REGLES)
        self.assertEqual(t["Cotisation"], 567840)  # 436 800 x 1,30
        self.assertEqual((t["PartIA"], t["PartAFA"]), (6000, 7500))
        self.assertEqual(t["PrimeHt"], 123333)  # le supplément va aux frais courtiers
        self.assertEqual(t["FraisCourtiers"], 289967 + 131040)

    def test_age_sur_la_part_sante(self):
        t = tarifer_adherent(OFFRE_436, {"Age": 62}, REGLES)
        self.assertEqual(t["SurprimeAge"], 126990)  # 423 300 x 30 %
        self.assertEqual(t["Cotisation"], 563790)
        t = tarifer_adherent(OFFRE_436, {"Age": 66}, REGLES)
        self.assertEqual(t["SurprimeAge"], 211650)  # 423 300 x 50 %

    def test_taux_age_par_tranche(self):
        self.assertEqual(taux_age(59, REGLES), 0)
        self.assertEqual(taux_age(60, REGLES), 30)
        self.assertEqual(taux_age(65, REGLES), 50)
        self.assertEqual(taux_age(None, REGLES), 0)

    def test_taux_saisis_remplacent_les_taux_calcules(self):
        t = tarifer_adherent(OFFRE_436, {"Age": 62, "Affections": 2, "TauxAffection": D(40), "TauxAge": D(0)}, REGLES)
        self.assertEqual(t["Cotisation"], 611520)  # 436 800 x 1,40

    def test_surprime_imposee_remplace_les_surprimes(self):
        t = tarifer_adherent(OFFRE_436, {"Age": 66, "Affections": 1, "SurprimeImposee": D(10000)}, REGLES)
        self.assertEqual(t["Cotisation"], 446800)

    def test_enfants_en_plus(self):
        t = tarifer_adherent(OFFRE_436, {"Age": 40, "EnfantsEnPlus": 2}, REGLES)
        self.assertEqual(t["Cotisation"], 506800)
        self.assertEqual(t["MontantEnfants"], 70000)

    def test_carte_seulement_si_cochee(self):
        self.assertEqual(tarifer_adherent(OFFRE_436, {"Age": 40, "Personnes": 3}, REGLES)["MontantCartes"], 0)
        t = tarifer_adherent(OFFRE_436, {"Age": 40, "Personnes": 3}, REGLES, carte=True)
        self.assertEqual(t["MontantCartes"], 9000)
        self.assertEqual(t["Cotisation"], 445800)

    def test_cotisation_imposee_du_fichier(self):
        t = tarifer_adherent(OFFRE_436, {"Age": 62, "Affections": 1, "CotisationImposee": D(400400)}, REGLES)
        self.assertEqual(t["Cotisation"], 400400)
        self.assertEqual(t["SurprimeAffection"], 0)
        self.assertEqual(t["SurprimeAge"], 0)
        self.assertEqual(t["PartSante"], 386900)

    def test_produit_lie_retire_retire_sa_part(self):
        t = tarifer_adherent(OFFRE_436, {"Age": 40, "PartIA": D(0)}, REGLES)
        self.assertEqual(t["Cotisation"], 430800)
        self.assertEqual(t["PartSante"], 423300)

    def test_prix_negocie(self):
        t = tarifer_adherent(OFFRE_436, {"Age": 40}, REGLES, prix_famille=D(400400))
        self.assertEqual(t["Cotisation"], 400400)
        self.assertEqual(t["FraisCourtiers"], 400400 - 13500 - 133333)

    def test_sante_seule(self):
        t = tarifer_adherent(OFFRE_400, {"Age": 40, "Affections": 1}, REGLES)
        self.assertEqual(t["Cotisation"], 520000)
        self.assertEqual(t["PartSante"], 520000)


class ProduitsDecoches(SimpleTestCase):
    """IA ou AFA décochée : sa part sort de la cotisation totale, dans tous les modes de calcul."""
    REGLES_SAISIE = {**REGLES, "AgeMax": 59, "AffectionsMax": 3}
    OFFRES = {1: {**OFFRE_436, "idoffreia": 154, "capitalia": D(1000000), "capitalafa": D(500000)}}
    CORRESPONDANCES = ({D(0): (None, D(0)), D(6000): (154, D(1000000))}, {D(0): D(0), D(7500): D(500000)})

    def _tarif(self, prix_famille=None, **brut):
        from datetime import date

        from sante.oreole import _ligne_saisie
        ligne, erreurs, _ = _ligne_saisie(1, {"Nom": "ESSAI", "Prenoms": "Un", "DateNaissance": "1986-01-01", "IdOffre": 1, **brut},
                                          self.OFFRES, self.REGLES_SAISIE, date(2026, 1, 1), self.CORRESPONDANCES)
        self.assertEqual(erreurs, [])
        return ligne, tarifer_adherent(self.OFFRES[1], ligne, self.REGLES_SAISIE, prix_famille=prix_famille)

    def test_calcul_normal(self):
        _, t = self._tarif(AvecIA=False, AvecAFA=False)
        self.assertEqual((t["Cotisation"], t["PartSante"], t["PartIA"], t["PartAFA"]), (423300, 423300, 0, 0))
        _, t = self._tarif(AvecAFA=False)
        self.assertEqual((t["Cotisation"], t["PartSante"], t["PartIA"], t["PartAFA"]), (429300, 423300, 6000, 0))

    def test_prix_negocie(self):
        _, t = self._tarif(prix_famille=D(400400), AvecIA=False, AvecAFA=False)
        self.assertEqual((t["Cotisation"], t["PartSante"]), (386900, 386900))

    def test_cotisation_du_fichier(self):
        ligne, t = self._tarif(CotisationImposee=436800, PartIA=6000, PartAFA=7500, AvecIA=False, AvecAFA=False)
        self.assertEqual((t["Cotisation"], t["PartSante"], t["PartIA"], t["PartAFA"]), (423300, 423300, 0, 0))
        self.assertEqual(t["FraisCourtiers"], 289967)  # la part Santé ne gagne rien au retrait
        self.assertEqual((ligne["IdOffreIA"], ligne["CapitalIA"], ligne["CapitalAFA"]), (None, 0, 0))
        _, t = self._tarif(CotisationImposee=436800, PartIA=6000, PartAFA=7500, AvecIA=False)
        self.assertEqual((t["Cotisation"], t["PartSante"], t["PartIA"], t["PartAFA"]), (430800, 423300, 0, 7500))

    def test_cotisation_saisie_sans_part_de_fichier(self):
        _, t = self._tarif(CotisationImposee=436800, AvecAFA=False)
        self.assertEqual((t["Cotisation"], t["PartSante"], t["PartAFA"]), (429300, 423300, 0))

    def test_devis_relu_deja_net_n_est_pas_reduit_deux_fois(self):
        _, t = self._tarif(CotisationImposee=423300, PartIA=0, PartAFA=0, AvecIA=False, AvecAFA=False)
        self.assertEqual(t["Cotisation"], 423300)

    def test_produits_coches_inchanges(self):
        _, t = self._tarif(CotisationImposee=436800, PartIA=6000, PartAFA=7500)
        self.assertEqual((t["Cotisation"], t["PartSante"]), (436800, 423300))


class FichierSansPartsLiees(SimpleTestCase):
    """Effectif importé sans colonne (ou sans montant) IA et AFA : les parts de l'offre s'appliquent, les cases « Émettre » agissent."""
    OFFRES = {
        4: {**OFFRE_575, "idoffre": 4, "code": "E575", "cible": "E", "libelle": "Entreprise 575 000", "idoffreia": 156, "capitalia": D(2000000), "capitalafa": D(1000000)},
    }
    CORRESPONDANCES = ({D(0): (None, D(0)), D(17000): (156, D(2000000))}, {D(0): D(0), D(15000): D(1000000)})
    REGLES_SAISIE = {**REGLES, "AgeMax": 59, "AffectionsMax": 3}

    def _lignes(self, entetes, *rangees):
        from openpyxl import Workbook

        from sante.oreole import _entete_feuille, _lire_groupe
        feuille = Workbook().active
        feuille.append(entetes)
        for rangee in rangees:
            feuille.append(rangee)
        numero, colonnes = _entete_feuille(feuille)
        return _lire_groupe(feuille, numero, colonnes, self.OFFRES)[0]

    def _cotisation(self, importee, **cases):
        from datetime import date

        from sante.oreole import _ligne_saisie
        brut = {**importee, "DateNaissance": "1986-01-01", **cases}
        ligne, erreurs, _ = _ligne_saisie(1, brut, self.OFFRES, self.REGLES_SAISIE, date(2026, 1, 1), self.CORRESPONDANCES)
        self.assertEqual(erreurs, [])
        t = tarifer_adherent(self.OFFRES[4], ligne, self.REGLES_SAISIE)
        return t["Cotisation"], t["PartSante"], t["PartIA"], t["PartAFA"]

    def test_colonnes_absentes(self):
        ligne, plus_cher = self._lignes(["MATRICULE", "NOM", "PRENOMS", "OPTION", "PRIME TTC SANTE"],
                                        ["0000001", "ESSAI", "Un", 4, 575000], ["0000002", "ESSAI", "Deux", 4, 1661000])
        self.assertEqual((ligne["PartIA"], ligne["PartAFA"], ligne["OffreExacte"]), (17000, 15000, True))
        self.assertEqual(self._cotisation(ligne), (575000, 543000, 17000, 15000))
        self.assertEqual(self._cotisation(ligne, AvecIA=False), (558000, 543000, 0, 15000))
        self.assertEqual(self._cotisation(ligne, AvecIA=False, AvecAFA=False), (543000, 543000, 0, 0))
        # Cotisation hors grille : même retrait, la part Santé garde le reste
        self.assertEqual(self._cotisation(plus_cher, AvecIA=False, AvecAFA=False), (1629000, 1629000, 0, 0))

    def test_cellules_vides_ou_zero_ecrit(self):
        vide, zero = self._lignes(["MATRICULE", "NOM", "PRENOMS", "PRIME TTC SANTE", "PRIME IA", "PRIME AFA"],
                                  ["0000001", "ESSAI", "Un", 575000, None, None], ["0000002", "ESSAI", "Deux", 575000, 0, 0])
        self.assertEqual((vide["PartIA"], vide["PartAFA"]), (17000, 15000))
        # Un 0 écrit dans le fichier reste un 0 : famille sans IA ni AFA, rien à retirer
        self.assertEqual((zero["PartIA"], zero["PartAFA"]), (0, 0))
        self.assertEqual(self._cotisation(zero, AvecIA=False, AvecAFA=False), (575000, 575000, 0, 0))


class ReglementCommun(SimpleTestCase):
    QUITTANCES = [
        {"NumeroQuittance": "S", "PrimeTtc": D(423300), "Encaisse": D(0)},
        {"NumeroQuittance": "I", "PrimeTtc": D(6000), "Encaisse": D(0)},
        {"NumeroQuittance": "A", "PrimeTtc": D(7500), "Encaisse": D(0)},
    ]

    @staticmethod
    def _parts(lignes):
        return {l["numero_quittance"]: D(l["montant_encaissement"]) for l in lignes}

    def test_le_total_solde_les_trois_quittances(self):
        self.assertEqual(self._parts(ventiler_reglement(self.QUITTANCES, D(436800))), {"S": D(423300), "I": D(6000), "A": D(7500)})

    def test_un_acompte_au_prorata_sans_ecart(self):
        parts = self._parts(ventiler_reglement(self.QUITTANCES, D(100000)))
        self.assertEqual(sum(parts.values()), D(100000))
        self.assertEqual(parts["I"], D(1373))
        self.assertEqual(parts["A"], D(1717))

    def test_un_acompte_presque_complet_ne_depasse_aucune_part(self):
        parts = self._parts(ventiler_reglement([{"NumeroQuittance": "S", "PrimeTtc": D(50), "Encaisse": D(0)}, {"NumeroQuittance": "I", "PrimeTtc": D(30), "Encaisse": D(0)},
                                                {"NumeroQuittance": "A", "PrimeTtc": D(20), "Encaisse": D(0)}], D(99)))
        self.assertEqual(sum(parts.values()), D(99))
        self.assertLessEqual(parts["S"], D(50))
        self.assertLessEqual(parts["I"], D(30))
        self.assertLessEqual(parts["A"], D(20))

    def test_une_quittance_deja_soldee_est_ecartee(self):
        quittances = [{**self.QUITTANCES[0], "Encaisse": D(423300)}, *self.QUITTANCES[1:]]
        self.assertEqual(self._parts(ventiler_reglement(quittances, D(13500))), {"I": D(6000), "A": D(7500)})

    def test_un_montant_trop_eleve_ou_nul_est_refuse(self):
        with self.assertRaises(ErreurOreole):
            ventiler_reglement(self.QUITTANCES, D(436801))
        with self.assertRaises(ErreurOreole):
            ventiler_reglement(self.QUITTANCES, D(0))
