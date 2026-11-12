import io
from datetime import date, datetime
from decimal import Decimal
from unittest import mock

from django.test import SimpleTestCase
from openpyxl import Workbook

from .afa import ErreurAfa, _acte, _controler_incorpores, _date, _entete_incorporation, _montant, lire_fichier
from .database import verifier_categorie_police
from .incorporation import ErreurRenouvellement, _contrat_flottant


def classeur_afa(lignes, total=True):
    """Liste AFA au format d'OREOLE : titre, en-tête en ligne 3, acte et dates fusionnés, ligne TOTAL."""
    classeur = Workbook()
    feuille = classeur.active
    feuille["A1"] = "LISTE AFA P/C ATM INFORMATIQUE"
    for colonne, intitule in enumerate(["N°", "ACTE", "DATE D'EFFET", "DATE D'ECHEANCE", "SOUSCRIPTEUR", "NOMS ET PRENOMS",
                                        "DATE DE NAISSANCE", "EN QUALITE DE", "CAPITAL ASSURE", "BENEFICIAIRES", "PRIMES TTC"], 1):
        feuille.cell(3, colonne, intitule)
    for rang, (nom, naissance, prime) in enumerate(lignes, 4):
        feuille.cell(rang, 1, rang - 3)
        feuille.cell(rang, 6, nom)
        feuille.cell(rang, 7, naissance)
        feuille.cell(rang, 9, 500000)
        feuille.cell(rang, 10, "BENEFICIAIRE")
        feuille.cell(rang, 11, prime)
    fin = 3 + len(lignes)
    feuille.cell(4, 2, "RENOUVELLEMENT")
    feuille.cell(4, 3, datetime(2026, 2, 18))
    feuille.cell(4, 4, datetime(2026, 12, 31))
    feuille.cell(4, 5, "ATM INFORMATIQUE")
    for colonne in (2, 3, 4, 5):
        feuille.merge_cells(start_row=4, start_column=colonne, end_row=fin, end_column=colonne)
    if total:
        feuille.cell(fin + 1, 1, "TOTAL")
        feuille.merge_cells(start_row=fin + 1, start_column=1, end_row=fin + 1, end_column=8)
        feuille.cell(fin + 1, 11, sum(p for _, _, p in lignes))
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


class LectureListeAfaTests(SimpleTestCase):
    def test_cellules_fusionnees_reportees_sur_chaque_assure(self):
        fichier = lire_fichier(classeur_afa([("TUO NANGA ABOUBAKAR", datetime(1986, 3, 31), 7500),
                                             ("KONATE MOUSTAPHA", datetime(1993, 6, 15), 7500)]))
        self.assertEqual(len(fichier["Lignes"]), 2)
        for ligne in fichier["Lignes"]:
            self.assertEqual(ligne["acte"], "RENOUVELLEMENT")
            self.assertEqual(ligne["souscripteur"], "ATM INFORMATIQUE")
            self.assertEqual(ligne["effet"], datetime(2026, 2, 18))
        self.assertEqual(fichier["TotalPrime"], 15000)
        self.assertEqual(fichier["Titre"], "LISTE AFA P/C ATM INFORMATIQUE")

    def test_ligne_total_arrete_la_lecture(self):
        fichier = lire_fichier(classeur_afa([("DAO ADAMA", datetime(2000, 6, 19), 7500)]))
        self.assertEqual([l["nom"] for l in fichier["Lignes"]], ["DAO ADAMA"])

    def test_fichier_sans_entete_refuse(self):
        classeur = Workbook()
        classeur.active["A1"] = "rien"
        tampon = io.BytesIO()
        classeur.save(tampon)
        with self.assertRaises(ErreurAfa):
            lire_fichier(tampon.getvalue())

    def test_fichier_illisible_refuse(self):
        with self.assertRaises(ErreurAfa):
            lire_fichier(b"pas un classeur")


class ConversionsAfaTests(SimpleTestCase):
    def test_dates(self):
        self.assertEqual(_date("18/02/2026"), date(2026, 2, 18))
        self.assertEqual(_date("2026-02-18"), date(2026, 2, 18))
        self.assertEqual(_date(46071), date(2026, 2, 18))
        self.assertIsNone(_date(""))
        with self.assertRaises(ValueError):
            _date("31/02/2026")

    def test_montants(self):
        self.assertEqual(_montant("7 500"), Decimal("7500"))
        self.assertEqual(_montant("500 000 F"), Decimal("500000"))
        self.assertEqual(_montant(7500.0), Decimal("7500.0"))
        with self.assertRaises(ValueError):
            _montant("sept mille")

    def test_actes(self):
        self.assertEqual(_acte("RENOUVELLEMENT"), "Renouvellement")
        self.assertEqual(_acte("incorporation"), "Incorporation")
        self.assertEqual(_acte("Affaire nouvelle"), "Affaire nouvelle")
        self.assertEqual(_acte(None), "")


class ConfirmationDevisAfaTests(SimpleTestCase):
    def test_accepte_la_categorie_non_specifiee_pour_afa(self):
        curseur = mock.Mock()
        curseur.fetchone.side_effect = [None, (10, "AFN", 2, 0)]

        verifier_categorie_police(curseur, 123)

    def test_exige_toujours_une_categorie_pour_les_autres_produits(self):
        curseur = mock.Mock()
        curseur.fetchone.side_effect = [None, (1, "AFN", 1, 0)]

        with self.assertRaisesRegex(ValueError, "Une ligne du devis"):
            verifier_categorie_police(curseur, 123)

    def test_exige_toujours_une_ligne_de_detail_pour_afa(self):
        curseur = mock.Mock()
        curseur.fetchone.side_effect = [None, (10, "AFN", 0, 0)]

        with self.assertRaisesRegex(ValueError, "aucune ligne de détail"):
            verifier_categorie_police(curseur, 123)


class IncorporationAfaTests(SimpleTestCase):
    """Incorporation dans un contrat Vie AFA (2026-11-09) : police reprise, période contrôlée, personnes ajoutées seulement."""

    POLICE = {"debut": date(2026, 1, 1), "dateexpiration": date(2026, 12, 31)}

    def entete(self, effet, echeance=date(2026, 12, 31)):
        return {"IdClient": 999, "IdCompagnie": 888, "IdContratRenouvele": 5, "DateEffet": effet, "DateExpiration": echeance}

    def test_souscripteur_et_compagnie_repris_de_la_police(self):
        curseur = mock.Mock()
        curseur.fetchone.return_value = (353, 7)
        entete = self.entete(date(2026, 6, 15))
        _entete_incorporation(curseur, 1, entete, self.POLICE)
        self.assertEqual((entete["IdClient"], entete["IdCompagnie"], entete["IdContratRenouvele"]), (353, 7, 0))

    def test_date_d_incorporation_dans_la_periode(self):
        for effet in (date(2025, 12, 31), date(2027, 1, 1)):
            with self.assertRaisesRegex(ErreurAfa, "période du contrat"):
                _entete_incorporation(mock.Mock(), 1, self.entete(effet), self.POLICE)

    def test_echeance_de_la_police_figee(self):
        with self.assertRaisesRegex(ErreurAfa, "échéance"):
            _entete_incorporation(mock.Mock(), 1, self.entete(date(2026, 6, 15), date(2027, 6, 14)), self.POLICE)

    def test_acte_incorporation_par_defaut(self):
        assures = [{"Rang": 1, "IdClient": 10, "Nom": "A", "Prenoms": "B", "Acte": ""},
                   {"Rang": 2, "IdClient": 11, "Nom": "C", "Prenoms": "D", "Acte": "Affaire nouvelle"}]
        with mock.patch("production.afa.controler_assure_incorpore") as controle:
            _controler_incorpores(mock.Mock(), 1, assures)
        self.assertEqual(controle.call_count, 2)
        self.assertEqual([a["Acte"] for a in assures], ["Incorporation", "Affaire nouvelle"])

    def test_personne_deja_assuree_refusee(self):
        assures = [{"Rang": 3, "IdClient": 10, "Nom": "A", "Prenoms": "B", "Acte": ""}]
        with mock.patch("production.afa.controler_assure_incorpore", side_effect=ValueError("A B est déjà assuré(e) dans la police P.")):
            with self.assertRaisesRegex(ErreurAfa, "Assuré 3 : A B est déjà assuré"):
                _controler_incorpores(mock.Mock(), 1, assures)


class ContratVieIncorporableTests(SimpleTestCase):
    # Offre commerciale de la police (production/vie_offres.py, 2026-11-10) : AFA par défaut
    OFFRE_AFA = {"Code": "AFA", "Libelle": "AFA", "Saisie": "CAPITAL"}

    def base(self, produit, flotte=True):
        return {"idproduit": produit, "flotte": flotte, "numeropolice": "P", "iddevis": 1}

    def test_contrat_vie_incorporable_meme_a_une_personne(self):
        with mock.patch("production.incorporation._contrat_base", return_value=self.base(10, flotte=False)), \
                mock.patch("production.incorporation.vie_offres.offre_du_devis", return_value=self.OFFRE_AFA), \
                mock.patch("production.incorporation._afa_oreole", return_value=False):
            self.assertEqual(_contrat_flottant(mock.Mock(), 1)["idproduit"], 10)

    def test_police_afa_oreole_renvoyee_a_la_branche(self):
        with mock.patch("production.incorporation._contrat_base", return_value=self.base(10)), \
                mock.patch("production.incorporation.vie_offres.offre_du_devis", return_value=self.OFFRE_AFA), \
                mock.patch("production.incorporation._afa_oreole", return_value=True):
            with self.assertRaisesRegex(ErreurRenouvellement, "Oreole Santé"):
                _contrat_flottant(mock.Mock(), 1)

    def test_retraite_complementaire_sans_incorporation(self):
        # Les entrants figurent dans l'état des cotisations du mois suivant
        retraite = {"Code": "RETRAITE", "Libelle": "Retraite complémentaire", "Saisie": "COTISATION"}
        with mock.patch("production.incorporation._contrat_base", return_value=self.base(10)), \
                mock.patch("production.incorporation.vie_offres.offre_du_devis", return_value=retraite):
            with self.assertRaisesRegex(ErreurRenouvellement, "état des cotisations"):
                _contrat_flottant(mock.Mock(), 1)

    def test_autres_produits_toujours_refuses(self):
        # RC (8) ; la MRH (4) s'incorpore depuis le 2026-11-10
        with mock.patch("production.incorporation._contrat_base", return_value=self.base(8)):
            with self.assertRaisesRegex(ErreurRenouvellement, "Vie AFA"):
                _contrat_flottant(mock.Mock(), 1)

    def test_contrat_mrh_incorporable_meme_a_une_maison(self):
        with mock.patch("production.incorporation._contrat_base", return_value=self.base(4, flotte=False)):
            self.assertEqual(_contrat_flottant(mock.Mock(), 1)["idproduit"], 4)
