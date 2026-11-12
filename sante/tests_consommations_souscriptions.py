"""Effectif complété par les souscriptions Oreole Santé de LE PHARE (consommations_souscriptions.py, demande du 2026-11-10). Sans base de données."""

import datetime as dt

from django.test import SimpleTestCase

from .consommations_souscriptions import _matricule, personnes_souscrites

AUJOURD_HUI = dt.date(2026, 11, 10)


def ligne(matricule, lien="A", police="P1", adherent=None, avenant="AFN", effet=dt.date(2026, 1, 1), echeance=dt.date(2026, 12, 31), sortie=None, actif=True,
          nom="NOM", prenom="PRENOM"):
    return {"police_lephare": police, "codeavenant": avenant, "effet_contrat": effet, "echeance": echeance, "debut_periode": effet, "idaffilie": 1,
            "lien": lien, "matricule": matricule, "nom": nom, "prenom": prenom, "sexe": "M", "date_naissance": dt.date(1980, 1, 1), "adhesion": None,
            "sortie": sortie, "actif": actif, "matricule_adherent": adherent if adherent is not None else matricule, "souscripteur": "SOCIETE X SARL"}


class PersonnesSouscrites(SimpleTestCase):
    def test_matricule_du_gestionnaire(self):
        self.assertEqual(_matricule(" 0012345 "), 12345)
        self.assertIsNone(_matricule("A12"))
        self.assertIsNone(_matricule(""))

    def test_entreprise_garant_college_repris_des_autres_personnes_de_la_police(self):
        effectif = {111: {"matricule_beneficiaire": 111, "matricule_assure": 111, "police": "SOCIETE X", "garant": "OREOLE CGA", "college": "OPTION 3"}}
        personnes, sans = personnes_souscrites([ligne("111"), ligne("222"), ligne("333", lien="E", adherent="222")], effectif, AUJOURD_HUI)
        self.assertEqual(sans, [])
        self.assertEqual({m: (p["police"], p["garant"], p["college"]) for m, p in personnes.items()},
                         {m: ("SOCIETE X", "OREOLE CGA", "OPTION 3") for m in (111, 222, 333)})
        self.assertEqual((personnes[333]["statut"], personnes[333]["matricule_assure"]), ("E", 222))

    def test_police_inconnue_de_l_effectif(self):
        personnes, _sans = personnes_souscrites([ligne("444", police="P2")], {}, AUJOURD_HUI)
        self.assertEqual((personnes[444]["police"], personnes[444]["garant"], personnes[444]["college"]), ("SOCIETE X SARL", "OREOLE", ""))

    def test_sans_matricule_signale(self):
        personnes, sans = personnes_souscrites([ligne("", lien="C", adherent="")], {}, AUJOURD_HUI)
        self.assertEqual(personnes, {})
        self.assertEqual(len(sans), 1)

    def test_sorties(self):
        lignes = [ligne("1", sortie=dt.date(2026, 6, 30)), ligne("2", police="P2", echeance=dt.date(2026, 3, 31)),
                  ligne("3", police="P3"), ligne("", police="P3", avenant="RES", effet=dt.date(2026, 9, 1)), ligne("4")]
        personnes, _sans = personnes_souscrites(lignes, {}, AUJOURD_HUI)
        self.assertEqual({m: (p["actif"], p["date_sortie"]) for m, p in personnes.items()}, {
            1: (False, dt.date(2026, 6, 30)),       # sortie de la personne
            2: (False, dt.date(2026, 3, 31)),       # échéance passée sans renouvellement
            3: (False, dt.date(2026, 9, 1)),        # police résiliée
            4: (True, None),
        })

    def test_contrat_le_plus_recent_l_emporte(self):
        lignes = [ligne("5", police="ANCIENNE"), ligne("5", police="NOUVELLE", effet=dt.date(2026, 6, 1))]
        personnes, _sans = personnes_souscrites(lignes, {}, AUJOURD_HUI)
        self.assertEqual(personnes[5]["police_lephare"], "NOUVELLE")
