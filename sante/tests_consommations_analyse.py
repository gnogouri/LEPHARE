"""Analyse approfondie des consommations (consommations_analyse.py) : rythme sur tous les mois du relevé, projection, situation des entreprises, foyers, indice de coût,
délais, constats, partie « Analyses complémentaires » du rapport Word. Sans base de données."""

import datetime as dt
import io
from decimal import Decimal as D

from django.test import SimpleTestCase
from docx import Document

from .consommations_analyse import analyser, constats, mois_de_la_periode, rythme_mensuel, situation_provision
from .consommations_rapport import Rapport, _analyses_complementaires

DU, AU = dt.date(2026, 1, 1), dt.date(2026, 12, 31)


def prestation(n, cloture, montant, benef=1, assure=1, police="ALPHA", garant="OREOLE", famille="CONSULTATION", acte="CS", centre="CENTRE A",
               soins=None, reclame=None, statut="A", naissance=dt.date(1980, 5, 1), genre="M", college="OPTION 3"):
    return {"numero_prest": n, "date_cloture": cloture, "garant": garant, "police": police, "matricule_beneficiaire": benef, "beneficiaire": f"B{benef}",
            "matricule_assure": assure, "assure": f"Assuré {assure}", "statut": statut, "date_naissance": naissance, "genre": genre, "famille": famille,
            "acte": acte, "centre_prescripteur": centre, "centre_executant": centre, "code_centre": centre, "medecin": "", "souscripteur": police,
            "college": college, "type": "TP", "date_soins_retenue": soins or cloture - dt.timedelta(days=10), "mt_reclame": D(reclame if reclame is not None else montant),
            "base_decomptee": D(montant), "exclusion": D(0), "depassement": D(0), "mt_rembourse": D(montant)}


def beneficiaire(m, assure, police="ALPHA", statut="A", genre="M", naissance=dt.date(1980, 5, 1), actif=True):
    return {"matricule_beneficiaire": m, "matricule_assure": assure, "garant": "OREOLE", "police": police, "college": "OPTION 3", "nom": f"NOM{m}",
            "prenoms": "Prénom", "statut": statut, "genre": genre, "date_naissance": naissance, "date_effet": dt.date(2025, 1, 1), "actif": actif, "date_sortie": None}


def cotisation(entreprise, provision, prime=0):
    return {"entreprise": entreprise, "effectif": 10, "provision": D(provision), "prime_ht": D(prime), "cotisation_pure": D(0), "honoraires": D(0),
            "commissions": D(0), "apporteurs": D(0)}


def releve_mensuel(mois=7, par_mois=10, montant=1000, suivant=None, police="ALPHA"):
    """par_mois prestations par mois de janvier à `mois`, chacune de `montant` ; `suivant` prestations au mois suivant."""
    lignes, n = [], 0
    for m in range(1, mois + 1):
        for k in range(par_mois):
            n += 1
            lignes.append(prestation(n, dt.date(2026, m, 28), montant, benef=k + 1, assure=k + 1, police=police))
    for k in range(suivant or 0):
        n += 1
        lignes.append(prestation(n, dt.date(2026, mois + 1, 28), montant, benef=k + 1, assure=k + 1, police=police))
    return lignes


class MoisEtRythme(SimpleTestCase):
    def test_mois_de_la_periode_sur_deux_annees(self):
        self.assertEqual(mois_de_la_periode(dt.date(2025, 11, 15), dt.date(2026, 2, 1)), [(2025, 11), (2025, 12), (2026, 1), (2026, 2)])

    def test_dernier_mois_compte_avec_tous_ses_actes(self):
        # demande du 2026-11-10 : un dernier mois de peu d'actes (août 2026, 37 prestations) entre dans le rythme comme les autres
        mois = mois_de_la_periode(DU, AU)
        mensuel = {(2026, m): {"Actes": 100, "Depenses": D(1000)} for m in range(1, 8)}
        mensuel[(2026, 8)] = {"Actes": 3, "Depenses": D(30)}
        self.assertEqual(rythme_mensuel(mensuel, mois), (7, D(7030) / 8))

    def test_releve_vide(self):
        self.assertEqual(rythme_mensuel({}, mois_de_la_periode(DU, AU)), (None, D(0)))

    def test_mois_sans_releve_compte_pour_zero(self):
        mois = mois_de_la_periode(DU, AU)
        mensuel = {(2026, 1): {"Actes": 10, "Depenses": D(300)}, (2026, 3): {"Actes": 10, "Depenses": D(300)}}
        self.assertEqual(rythme_mensuel(mensuel, mois)[1], D(200))

    def test_situation_face_a_la_provision(self):
        self.assertEqual(situation_provision(D(0), D(10), D(20)), "Sans provision")
        self.assertEqual(situation_provision(D(100), D(101), D(150)), "Provision dépassée")
        self.assertEqual(situation_provision(D(100), D(60), D(120)), "Dépassement prévu")
        self.assertEqual(situation_provision(D(100), D(50), D(85)), "À surveiller")
        self.assertEqual(situation_provision(D(100), D(30), D(60)), "Normale")


class Projection(SimpleTestCase):
    def test_projection_au_rythme_de_tous_les_mois(self):
        prestations = releve_mensuel(mois=7, par_mois=10, montant=1000, suivant=1)
        effectif = [beneficiaire(k + 1, k + 1) for k in range(10)]
        a = analyser(prestations, effectif, [(cotisation("ALPHA SA", 200000), "ALPHA", True)], {}, DU, AU)
        s = a["Synthese"]
        self.assertEqual(s["MoisEcoules"], 8)                         # août compte, avec sa seule prestation
        self.assertEqual(s["Rythme"], 8875.0)                         # 71 000 F / 8 mois
        self.assertEqual(s["Projection"], 106500.0)                   # 8 875 F x 12 mois
        self.assertEqual(s["Depenses"], 71000.0)
        self.assertEqual(s["CumulDernierMois"], 71000.0)
        self.assertAlmostEqual(s["Attendu"], 8 / 12)
        self.assertNotIn("MoisPartiel", s)
        self.assertEqual(len(s["Series"]["Depenses"]), 8)
        self.assertNotIn("Partiel", a["Mensuel"][7])
        self.assertFalse(a["Mensuel"][7]["Futur"])
        self.assertTrue(a["Mensuel"][8]["Futur"])
        self.assertEqual(a["Mensuel"][11]["Projete"], 106500.0)
        self.assertEqual(a["Mensuel"][11]["Budget"], 200000.0)
        ligne = a["Entreprises"][0]
        self.assertEqual((ligne["Police"], ligne["Entreprises"], ligne["Situation"]), ("ALPHA", ["ALPHA SA"], "Normale"))

    def test_dernier_mois_lu_sur_le_releve_entier(self):
        # l'entreprise n'a aucun soin en août, mais le relevé d'août existe : août compte pour zéro dans son rythme
        prestations = releve_mensuel(mois=6, par_mois=10, montant=1000)
        prestations.append(prestation(999, dt.date(2026, 7, 28), 1000))
        releve = {(2026, m): 800 for m in range(1, 8)}
        releve[(2026, 8)] = 37
        sans = analyser(prestations, [], [], {}, DU, AU)
        avec = analyser(prestations, [], [], {}, DU, AU, actes_du_releve=releve)
        self.assertEqual(sans["Synthese"]["MoisEcoules"], 7)
        self.assertEqual(avec["Synthese"]["MoisEcoules"], 8)
        self.assertAlmostEqual(avec["Synthese"]["Rythme"], 61000 / 8, places=6)

    def test_depassement_prevu_et_constat(self):
        prestations = releve_mensuel(mois=6, par_mois=10, montant=1000, police="BETA")
        a = analyser(prestations, [], [(cotisation("BETA SARL", 100000), "BETA", False)], {}, DU, AU)
        ligne = a["Entreprises"][0]
        self.assertEqual(ligne["Situation"], "Dépassement prévu")      # 60 000 consommés, 120 000 projetés pour 100 000
        self.assertTrue(ligne["LienPropose"])
        textes = {c["Titre"]: c for c in a["Constats"]}
        self.assertEqual(textes["Dépassements prévus"]["Ton"], "critique")
        self.assertIn("1 entreprise dépasserait sa provision", textes["Dépassements prévus"]["Texte"])
        self.assertEqual(a["Constats"][0]["Ton"], "critique")


class FoyersPrestatairesDelais(SimpleTestCase):
    def setUp(self):
        self.prestations = [
            prestation(1, dt.date(2026, 1, 31), 900000, benef=1, assure=1, centre="CHER", acte="CS", reclame=30000),
            prestation(2, dt.date(2026, 1, 31), 50000, benef=2, assure=2, centre="NORMAL", acte="CS", reclame=10000, soins=dt.date(2025, 9, 1)),
            prestation(3, dt.date(2026, 2, 28), 50000, benef=3, assure=3, centre="NORMAL", acte="CS", reclame=10000, statut="E", genre="F",
                       naissance=dt.date(2020, 1, 1)),
        ]
        self.effectif = [beneficiaire(1, 1), beneficiaire(2, 2), beneficiaire(3, 3, statut="E", genre="F", naissance=dt.date(2020, 1, 1)), beneficiaire(4, 4)]

    def test_foyers_concentration_et_plafond(self):
        a = analyser(self.prestations, self.effectif, [], {"OPTION 3": D("1000000")}, DU, AU)
        f = a["Foyers"]
        self.assertEqual((f["Total"], f["Consommateurs"]), (4, 3))
        self.assertEqual(f["Tranches"][0], {"Libelle": "Aucune consommation", "Foyers": 1, "PartFoyers": 0.25, "Depenses": 0.0, "PartDepenses": 0})
        self.assertEqual(f["PlafondAlerte"], 1)                         # 900 000 F sur un plafond de 1 000 000 F
        self.assertEqual(f["Top"][0]["TauxPlafond"], 0.9)
        self.assertEqual(f["Pareto"][0], {"PartFoyers": 0.0, "PartDepenses": 0})
        self.assertEqual(f["Pareto"][-1]["PartDepenses"], 1.0)

    def test_indice_de_cout_sur_les_medianes_du_portefeuille(self):
        a = analyser(self.prestations, self.effectif, [], {}, DU, AU, medianes_du_releve={"CS": D(10000)})
        centres = {c["Centre"]: c for c in a["Prestataires"]["Centres"]}
        self.assertIsNone(centres["CHER"]["Indice"])                   # moins de 20 actes comparables
        lignes = [prestation(100 + k, dt.date(2026, 3, 31), 1000, benef=1, assure=1, centre="CHER", acte="CS", reclame=15000) for k in range(20)]
        b = analyser(lignes, self.effectif, [], {}, DU, AU, medianes_du_releve={"CS": D(10000)})
        self.assertEqual(b["Prestataires"]["Centres"][0]["Indice"], 150)
        self.assertEqual(b["Prestataires"]["Chers"][0]["Centre"], "CHER")

    def test_delais_et_profil(self):
        a = analyser(self.prestations, self.effectif, [], {}, DU, AU)
        d = a["Delais"]
        self.assertEqual([t["Actes"] for t in d["Tranches"]], [2, 0, 0, 1, 0])   # 10 jours, 10 jours et 152 jours
        self.assertEqual(d["Tardifs"], 1)
        statuts = {x["Statut"]: x for x in a["Profil"]["Statuts"]}
        self.assertEqual((statuts["A"]["Effectif"], statuts["E"]["Effectif"]), (3, 1))
        self.assertEqual(a["Synthese"]["TauxRecours"], 0.75)
        self.assertEqual(a["Synthese"]["NonConsommants"], 1)
        self.assertEqual(a["Decomposition"]["Reclame"], 50000.0)
        self.assertEqual(a["Decomposition"]["TicketEtPlafonds"], 50000 - 1000000.0)
        self.assertEqual([c["Garant"] for c in a["Compagnies"]], ["OREOLE"])


class Phrases(SimpleTestCase):
    def test_elision_et_accords(self):
        base = analyser(releve_mensuel(mois=7, par_mois=10, suivant=1), [], [], {}, DU, AU)
        self.assertNotIn("Relevé partiel", [c["Titre"] for c in base["Constats"]])
        base["Entreprises"] = [{"Situation": "Provision dépassée", "Entreprises": [n], "Police": n, "TauxProjete": 2} for n in "ABCDE"]
        texte = next(c for c in constats(base) if c["Titre"] == "Provisions dépassées")["Texte"]
        self.assertEqual(texte, "5 entreprises ont déjà consommé plus que leur provision : A, B, C et 2 autres.")

    def test_periode_vide(self):
        a = analyser([], [], [], {}, DU, AU)
        self.assertEqual([c["Titre"] for c in a["Constats"]], ["Aucune dépense"])
        self.assertEqual(a["Synthese"]["Projection"], 0.0)


class RapportWord(SimpleTestCase):
    def test_partie_analyses_complementaires(self):
        prestations = releve_mensuel(mois=7, par_mois=10, montant=1000, suivant=1)
        a = analyser(prestations, [beneficiaire(k + 1, k + 1) for k in range(10)], [(cotisation("ALPHA SA", 200000), "ALPHA", True)], {}, DU, AU)
        r = Rapport()
        _analyses_complementaires(r, a, "V")
        document = Document(io.BytesIO(r.octets()))
        textes = [p.text for p in document.paragraphs]
        self.assertIn("V. ANALYSES COMPLÉMENTAIRES", textes)
        self.assertIn("V.8. Délai entre les soins et leur paiement", textes)
        self.assertTrue(any(t.startswith("Projection : Au rythme de 8") and "875 F par mois" in t for t in textes))
        self.assertIn("Mois du relevé pris en compte", [c.text for t in document.tables for row in t.rows for c in row.cells])
        entetes = [[c.text for c in t.rows[0].cells] for t in document.tables]
        self.assertIn(["Indicateur", "Valeur"], entetes)
        self.assertIn(["Niveau de consommation", "Foyers", "% des foyers", "Dépenses", "% des dépenses"], entetes)
