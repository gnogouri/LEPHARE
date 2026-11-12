"""Apporteurs d'affaires : calcul de la commission, état de règlement et génération des lignes, sans base de données."""

from datetime import date
from decimal import Decimal as D

from django.test import SimpleTestCase

from configuration_api.serializers import _sans_accent

from .apporteurs import ErreurApporteur, _etat_reglement, _synchroniser_lien, assures_par_mouvement, convention, montant_commission


class CurseurEspion:
    """Note les écritures du calcul au lieu de les envoyer à la base."""

    def __init__(self):
        self.ecritures = []

    def execute(self, sql, params=None):
        self.ecritures.append((" ".join(sql.split())[:40], params))

    @property
    def insertions(self):
        return [p for s, p in self.ecritures if s.startswith("INSERT")]

    @property
    def annulations(self):
        return [p for s, p in self.ecritures if "'ANNULEE'" in s or s.startswith("UPDATE lephare_commission_apporteur SET statut")]


def lien(**autres):
    return {"idrattachement": 1, "idapporteur": 7, "iddevis": 100, "taux": D("20"), "assiette": "COMMISSION", "montantforfait": D(0), "idbase": 10, "numeropolice": "P1", **autres}


def mouvement(idcontrat=10, idquittance=500, iddevis=100, commission=D("12345"), prime=D("100000"), annulation=0, code="AFN"):
    return {"idcontrat": idcontrat, "iddevis": iddevis, "idquittance": idquittance, "numeropolice": "P1", "primenette": prime, "commissionintermediaire": commission, "annulation": annulation,
            "code": code, "mouvement": code, "numeroquittance": f"Q{idquittance}", "dateemission": date(2026, 11, 5), "client": ""}


class Montant(SimpleTestCase):
    def test_taux_sur_l_assiette_au_franc(self):
        self.assertEqual(montant_commission(D("12345"), D("20")), 2469)
        self.assertEqual(montant_commission(D("1003"), D("2.5")), 25)

    def test_arrondi_au_franc_superieur_a_partir_de_la_moitie(self):
        self.assertEqual(montant_commission(D("1000"), D("0.05")), 1)

    def test_ristourne_negative(self):
        self.assertEqual(montant_commission(D("-12345"), D("20")), -2469)

    def test_montant_convenu(self):
        self.assertEqual(montant_commission(D("0"), D("0"), D("4000")), 4000)


class EtatDeReglement(SimpleTestCase):
    def test_tous_les_etats(self):
        self.assertEqual(_etat_reglement(False, False, False, False)[0], "EN_ATTENTE")
        self.assertEqual(_etat_reglement(True, False, False, False)[0], "AUCUNE")
        self.assertEqual(_etat_reglement(True, False, True, False)[0], "A_PAYER")
        self.assertEqual(_etat_reglement(True, True, True, False)[0], "PARTIELLE")
        self.assertEqual(_etat_reglement(True, True, False, False)[0], "PAYEE")
        self.assertEqual(_etat_reglement(True, False, False, True)[0], "ANNULEE")


class Generation(SimpleTestCase):
    def appliquer(self, le_lien, mouvements, existantes=None, deja=(), par_id=None):
        curseur = CurseurEspion()
        par_id = par_id if par_id is not None else {m["idcontrat"]: m for m in mouvements}
        _synchroniser_lien(curseur, le_lien, mouvements, par_id, existantes or {}, set(deja))
        return curseur

    def test_commission_du_cabinet_au_taux_convenu(self):
        c = self.appliquer(lien(), [mouvement()])
        self.assertEqual(len(c.insertions), 1)
        self.assertEqual(c.insertions[0][-2], 2469)
        self.assertEqual(c.insertions[0][-3], D("20"))

    def test_prime_nette(self):
        c = self.appliquer(lien(assiette="PRIME_NETTE", taux=D("2.5")), [mouvement()])
        self.assertEqual(c.insertions[0][-2], 2500)

    def test_mouvement_anterieur_au_rattachement_exclu(self):
        c = self.appliquer(lien(idbase=20), [mouvement(idcontrat=10), mouvement(idcontrat=20, idquittance=501)])
        self.assertEqual([p[3] for p in c.insertions], [501])

    def test_avenant_suivant_inclus(self):
        c = self.appliquer(lien(), [mouvement(), mouvement(idcontrat=11, idquittance=501, iddevis=101, code="MOD")])
        self.assertEqual(len(c.insertions), 2)

    def test_montant_convenu_seulement_sur_son_devis(self):
        c = self.appliquer(lien(assiette="FORFAIT", montantforfait=D(4000), taux=D(0)), [mouvement(), mouvement(idcontrat=11, idquittance=501, iddevis=101, code="MOD")])
        self.assertEqual([(p[3], p[-2]) for p in c.insertions], [(500, 4000)])

    def test_commission_nulle_pas_de_ligne(self):
        self.assertEqual(self.appliquer(lien(), [mouvement(commission=D(0))]).insertions, [])

    def test_contrat_annule_a_payer_annule_la_ligne(self):
        ligne = {"idcommission": 9, "statut": "A_PAYER", "montant": D(2469), "taux": D(20), "assiettemontant": D(12345)}
        c = self.appliquer(lien(), [mouvement(annulation=99)], {(1, 500): ligne})
        self.assertEqual(ligne["statut"], "ANNULEE")
        self.assertEqual(c.insertions, [])

    def test_contrat_annule_payee_reprise_negative_meme_sur_une_autre_police(self):
        ligne = {"idcommission": 9, "statut": "PAYEE", "montant": D(2469), "taux": D(20), "assiettemontant": D(12345)}
        annulant = {**mouvement(idcontrat=99, idquittance=900, code="ANL"), "numeropolice": "AUTRE"}
        c = self.appliquer(lien(), [mouvement(annulation=99)], {(1, 500): ligne}, par_id={99: annulant})
        self.assertEqual(len(c.insertions), 1)
        self.assertEqual((c.insertions[0][3], c.insertions[0][-2]), (900, D(-2469)))
        self.assertEqual(c.insertions[0][4], "P1")

    def test_annulation_sans_paiement_pas_de_reprise(self):
        ligne = {"idcommission": 9, "statut": "ANNULEE", "montant": D(2469), "taux": D(20), "assiettemontant": D(12345)}
        c = self.appliquer(lien(), [mouvement(annulation=11), mouvement(idcontrat=11, idquittance=501, code="ANL", commission=D(-12345))], {(1, 500): ligne})
        self.assertEqual(c.insertions, [])

    def test_reprise_retiree_si_le_reglement_est_annule(self):
        origine = {"idcommission": 9, "statut": "ANNULEE", "montant": D(2469), "taux": D(20), "assiettemontant": D(12345)}
        reprise = {"idcommission": 10, "statut": "A_PAYER", "montant": D(-2469), "taux": D(20), "assiettemontant": D(0)}
        c = self.appliquer(lien(), [mouvement(annulation=11), mouvement(idcontrat=11, idquittance=501, code="ANL")], {(1, 500): origine, (1, 501): reprise})
        self.assertEqual([e[0][:6] for e in c.ecritures], ["DELETE"])

    def test_ristourne_negative_a_deduire(self):
        c = self.appliquer(lien(), [mouvement(idcontrat=11, idquittance=501, commission=D(-1000), code="MOD")])
        self.assertEqual(c.insertions[0][-2], -200)

    def test_quittance_deja_payee_sous_un_ancien_rattachement(self):
        self.assertEqual(self.appliquer(lien(), [mouvement()], deja=[(7, 500)]).insertions, [])

    def test_a_payer_suit_le_contrat(self):
        ligne = {"idcommission": 9, "statut": "A_PAYER", "montant": D(100), "taux": D(20), "assiettemontant": D(500)}
        c = self.appliquer(lien(), [mouvement()], {(1, 500): ligne})
        self.assertEqual(c.ecritures[0][1][3], 2469)

    def test_payee_ne_bouge_plus(self):
        ligne = {"idcommission": 9, "statut": "PAYEE", "montant": D(100), "taux": D(20), "assiettemontant": D(500)}
        self.assertEqual(self.appliquer(lien(), [mouvement()], {(1, 500): ligne}).ecritures, [])


class Doublons(SimpleTestCase):
    def test_noms_comparables(self):
        self.assertEqual(_sans_accent("Koné-Essai "), _sans_accent("KONE  ESSAI"))


class TauxOuMontant(SimpleTestCase):
    def test_taux(self):
        self.assertEqual(convention({"Assiette": "COMMISSION", "Taux": "20"}), ("COMMISSION", D("20"), D(0)))

    def test_montant_par_assure(self):
        self.assertEqual(convention({"Assiette": "PAR_ASSURE", "MontantParAssure": "15 000"}), ("PAR_ASSURE", D(0), D(15000)))

    def test_jamais_les_deux(self):
        with self.assertRaisesMessage(ErreurApporteur, "pas les deux"):
            convention({"Assiette": "PAR_ASSURE", "Taux": "10", "MontantParAssure": "15000"})
        with self.assertRaisesMessage(ErreurApporteur, "pas les deux"):
            convention({"Assiette": "COMMISSION", "Taux": "10", "MontantParAssure": "15000"})

    def test_montant_obligatoire_par_assure(self):
        with self.assertRaisesMessage(ErreurApporteur, "montant convenu par assuré"):
            convention({"Assiette": "PAR_ASSURE"})

    def test_mode_actuel_garde_a_la_modification(self):
        self.assertEqual(convention({"MontantParAssure": 5000}, "PAR_ASSURE")[0], "PAR_ASSURE")


def assures(idcontrat, code, adherents=0, afa=0, details=0, prime=D(1000)):
    return {**mouvement(idcontrat=idcontrat, idquittance=idcontrat + 400, code=code, prime=prime), "adherents": adherents, "afa": afa, "details": details}


class ParAssure(SimpleTestCase):
    def test_sante_affaire_puis_incorporation(self):
        n = assures_par_mouvement([assures(10, "AFN", adherents=72), assures(11, "MOD", adherents=75), assures(12, "MOD", adherents=74), assures(13, "REN", adherents=74)])
        self.assertEqual(n, {10: 72, 11: 3, 12: 0, 13: 74})

    def test_ia_une_ligne_par_assure(self):
        n = assures_par_mouvement([assures(10, "AFN", details=72), assures(11, "INC", details=2), assures(12, "MOD", details=72, prime=D(0))])
        self.assertEqual(n, {10: 72, 11: 2, 12: 0})

    def test_vie(self):
        self.assertEqual(assures_par_mouvement([assures(10, "AFN", afa=18, details=1)]), {10: 18})

    def test_commission(self):
        c = CurseurEspion()
        le_lien = lien(assiette="PAR_ASSURE", taux=D(0), montantforfait=D(15000))
        mouvements = [assures(10, "AFN", details=72), assures(11, "INC", details=2)]
        _synchroniser_lien(c, le_lien, mouvements, {m["idcontrat"]: m for m in mouvements}, {}, set())
        self.assertEqual([(p[10], p[-2], p[-1]) for p in c.insertions], [(D(72), D(1080000), D(15000)), (D(2), D(30000), D(15000))])

    def test_nombre_corrige_a_la_main(self):
        c = CurseurEspion()
        ligne = {"idcommission": 9, "statut": "A_PAYER", "montant": D(15000), "taux": D(0), "assiettemontant": D(1), "montantunitaire": D(15000), "assuresmanuel": 2}
        mouvements = [assures(10, "AFN", details=1)]
        _synchroniser_lien(c, lien(assiette="PAR_ASSURE", taux=D(0), montantforfait=D(15000)), mouvements, {10: mouvements[0]}, {(1, 410): ligne}, set())
        self.assertEqual(c.ecritures[0][1][:4], ["PAR_ASSURE", D(2), D(0), D(30000)])
