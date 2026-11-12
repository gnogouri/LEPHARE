"""Import des assurés IA dans un devis existant : l'avenant du devis (REN, INC) est gardé. Sans base de données."""

from django.http import QueryDict
from django.test import SimpleTestCase

from .anti_doublons.importateur import donnees_avec_avenant

ID_AFN, ID_REN = 1, 5


class AvenantDuDevisGarde(SimpleTestCase):
    def test_renouvellement_garde_son_avenant(self):
        # L'écran envoyait l'avenant 1 : le devis de renouvellement devenait une affaire nouvelle
        donnees = donnees_avec_avenant({"IdDevis": "26768", "IdAvenant": "1"}, ID_REN)
        self.assertEqual(donnees["IdAvenant"], str(ID_REN))
        self.assertEqual(donnees["IdDevis"], "26768")

    def test_donnees_de_l_ecran_intactes(self):
        envoyees = {"IdDevis": "26768", "IdAvenant": "1"}
        donnees_avec_avenant(envoyees, ID_REN)
        self.assertEqual(envoyees["IdAvenant"], "1")

    def test_formulaire_multipart(self):
        envoyees = QueryDict("IdDevis=26768&IdAvenant=1&IdOffre=7")
        donnees = donnees_avec_avenant(envoyees, ID_REN)
        self.assertEqual(int(donnees.get("IdAvenant")), ID_REN)
        self.assertEqual(donnees.get("IdOffre"), "7")
        self.assertEqual(envoyees.get("IdAvenant"), "1")

    def test_police_connexe_du_devis_si_saisie_vide(self):
        # IA MINENE : l'écran envoyait une police connexe vide, refusée par sp_creation_devis_ia
        donnees = donnees_avec_avenant({"IdDevis": "26758", "IdAvenant": "5", "NumeroPoliceConnexe": ""}, ID_REN, " 1005 ")
        self.assertEqual(donnees["NumeroPoliceConnexe"], "1005")
        self.assertEqual(donnees["IdAvenant"], "5")

    def test_police_connexe_saisie_gardee(self):
        donnees = donnees_avec_avenant({"IdDevis": "26758", "IdAvenant": "5", "NumeroPoliceConnexe": "2002"}, ID_REN, "1005")
        self.assertEqual(donnees["NumeroPoliceConnexe"], "2002")

    def test_affaire_nouvelle_inchangee(self):
        envoyees = {"IdDevis": "0", "IdAvenant": "1"}
        self.assertIs(donnees_avec_avenant(envoyees, None), envoyees)
        self.assertIs(donnees_avec_avenant(envoyees, ID_AFN), envoyees)
