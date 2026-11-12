import io
from datetime import datetime
from decimal import Decimal
from unittest import mock

import pandas as pd
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from openpyxl import Workbook

from .views_transport_guce import ErreurBordereau, _enregistrer_certificats, lire_bordereau

ENTETE_REPRISE = [
    "Statut", "No. Requête", "Date Requête", "Référence Certificat", "Date Certificat", "Numéro Police d'Assurance", None,
    "Numero FDI", "Date FDI", None, "Code Assureur", "Assureur", "Adresse Assureur", "Code souscripteur", "Souscripteur",
    "Adresse souscripteur", "Code Assuré", "Assuré", "Adresse assuré", " intermediaire", "CODE Intermediaire",
    "Moyen de Transport", "Date Debut Voyage", "Voyage", "Description Commerciale ", "Marque de Colis",
    "Numero Document Transport", "Réf precedente", "Réf subséquent", "Valeur CAF FDI", "Valeur Assurance", None,
    "Prime Nette", "Accessories", "Montant Taxe", "Taux Taxe", "Prime Totale",
]
DEBUT_VOYAGE = datetime(2026, 8, 2)


def ligne_reprise(numero, prime_nette, taxe, decalee):
    """Certificat de la liste reprise à la main : sans la cellule « Code Intermediaire » si elle est décalée."""
    debut = [
        "APPROUVE", numero, datetime(2026, 8, 21), f"REF{numero}", datetime(2026, 8, 21), "FAX278736", None, None, None, None,
        6362, "SUNU ASSURANCES IARD CI", "01 BP 3803 ABIDJAN", "0902223E", "DHL GLOBAL FORWARDING CI", "18 BP 3221 ABIDJAN",
        "4104288G", "BAKER HUGHES", None, "OREOLE",
    ]
    fin = [
        "SS984", DEBUT_VOYAGE, "Norvege(OSLO)/Cote d'Ivoire(ABIDJAN)", "GEANBOX", "LTA 923", "923-03998971", None, None, 100.5,
        37968500, None, prime_nette, 2500, taxe, 7, prime_nette + 2500 + taxe,
    ]
    return debut + fin if decalee else debut + ["1005723Y"] + fin


def classeur_repris(lignes, nombre, totaux=True):
    """Liste GUCE au format du fichier reçu : titres, en-tête, ligne des totaux puis certificats."""
    classeur = Workbook()
    feuille = classeur.active
    feuille.cell(4, 2, "LISTE DES CERTIFICATS D'ASSURANCE")
    feuille.cell(6, 2, "Date certificat entre 16/08/2026 et 31/08/2026")
    feuille.cell(9, 2, f"TOTAL GENERAL                   Nombre de certificats d'Assurance :   {nombre}")
    for colonne, intitule in enumerate(ENTETE_REPRISE, 2):
        feuille.cell(10, colonne, intitule)
    if totaux:
        total = {"Prime Totale": sum(l[-1] for l in lignes), "Prime Nette": sum(l[-5] for l in lignes),
                 "Accessories": sum(l[-4] for l in lignes), "Montant Taxe": sum(l[-3] for l in lignes),
                 "Valeur Assurance": sum(l[-7] for l in lignes)}
        for intitule, montant in total.items():
            feuille.cell(11, ENTETE_REPRISE.index(intitule) + 2, montant)
    for rang, ligne in enumerate(lignes, 12):
        for colonne, valeur in enumerate(ligne, 2):
            feuille.cell(rang, colonne, valeur)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return SimpleUploadedFile("GUCE CI.xlsx", tampon.getvalue())


@mock.patch("production.views_transport_guce.part_afs_ci", return_value=Decimal("500"))
class ListeRepriseTests(SimpleTestCase):
    def test_lignes_decalees_lues_comme_les_lignes_alignees(self, _part):
        alignee = ligne_reprise("INS1", 75937, 5490.59, decalee=False)
        decalee = ligne_reprise("INS2", 5000, 525, decalee=True)
        df, titre, periode, controle = lire_bordereau(classeur_repris([alignee, decalee], 2))
        self.assertEqual(titre, "LISTE DES CERTIFICATS D'ASSURANCE")
        self.assertEqual(periode[0].isoformat(), "2026-08-16")
        self.assertEqual(controle["Nombre"], 2)
        self.assertEqual(controle["Totaux"]["primettc"], 75937 + 2500 + 5490.59 + 5000 + 2500 + 525)

        lignes = df.dropna(subset=["numerorequete"]).set_index("numerorequete")
        for numero, prime_nette, taxe in (("INS1", 75937, 5490.59), ("INS2", 5000, 525)):
            ligne = lignes.loc[numero]
            self.assertEqual(ligne["primenette"], prime_nette)
            self.assertEqual(ligne["accessoire"], 2500)
            self.assertEqual(ligne["taxe"], taxe)
            self.assertEqual(ligne["primettc"], prime_nette + 2500 + taxe)
            self.assertEqual(ligne["valeurassurance"], 37968500)
            self.assertEqual(ligne["moyentransport"], "SS984")
            self.assertEqual(pd.Timestamp(ligne["datedebutvoyage"]), pd.Timestamp(DEBUT_VOYAGE))
            self.assertEqual(ligne["voyage"], "Norvege(OSLO)/Cote d'Ivoire(ABIDJAN)")
            self.assertEqual(ligne["numerodocumenttransport"], "923-03998971")
            self.assertEqual(ligne["accessoireafsci"], -500)
        self.assertEqual(lignes.loc["INS2", "intermediaire"], "OREOLE")

    def test_toutes_les_lignes_alignees_lues_sans_decalage(self, _part):
        df, _, _, _ = lire_bordereau(classeur_repris([ligne_reprise("INS1", 5000, 525, decalee=False)], 1))
        ligne = df.dropna(subset=["numerorequete"]).iloc[0]
        self.assertEqual(ligne["primettc"], 8025)
        self.assertEqual(ligne["moyentransport"], "SS984")

    def test_ligne_decalee_aux_montants_faux_refusee(self, _part):
        fausse = ligne_reprise("INS1", 5000, 525, decalee=True)
        fausse[-1] = 9999
        # Rien n'est deviné : la ligne reste en place et ses primes tombent dans une colonne sans titre
        with self.assertRaisesMessage(ErreurBordereau, "colonne sans titre"):
            lire_bordereau(classeur_repris([fausse], 1, totaux=False))

    def test_cellules_vides_ecrites_en_texte_vide_sur_les_colonnes_obligatoires(self, _part):
        alignee = ligne_reprise("INS1", 5000, 525, decalee=False)
        alignee[19] = None  # intermédiaire en blanc, comme les premières lignes du fichier reçu
        df, _, _, _ = lire_bordereau(classeur_repris([alignee], 1))
        df = df.dropna(subset=["numerorequete"])
        curseur = mock.Mock()
        curseur.fetchone.return_value = None
        _enregistrer_certificats(curseur, df, datetime(2026, 8, 16).date(), datetime(2026, 8, 31).date(),
                                 {"DHL GLOBAL FORWARDING CI": 2690})
        requete, valeurs = curseur.execute.call_args_list[-1].args
        ecrit = dict(zip(requete.split("(")[1].split(")")[0].split(", "), valeurs))
        self.assertEqual(ecrit["intermediaire"], "")
        self.assertEqual(ecrit["adresseassure"], "")
        self.assertEqual(ecrit["moyentransport"], "SS984")
        self.assertIsNone(ecrit["numerofdi"])
        self.assertEqual(ecrit["idclienturanus"], 2690)

    def test_colonne_inconnue_toujours_refusee(self, _part):
        classeur = Workbook()
        feuille = classeur.active
        for colonne, intitule in enumerate(ENTETE_REPRISE + ["Colonne en trop"], 1):
            feuille.cell(1, colonne, intitule)
        feuille.cell(2, 2, "INS1")
        tampon = io.BytesIO()
        classeur.save(tampon)
        with self.assertRaisesMessage(ErreurBordereau, "Colonne en trop"):
            lire_bordereau(SimpleUploadedFile("autre.xlsx", tampon.getvalue()))
