"""Branche RAFAS (demande du 2026-11-10) : lecture des fichiers du gestionnaire, analyse, contrôles et budget. Sans base de données.
Le moteur a été vérifié sur les fichiers réels contre l'étude « RAPPORT COMPLET EXAT FEVRIER-JUIN 2026 » (effectif 2 994, 1 228 consommants,
7 741 actes, 64 900 184 F, mouvements 2 762 / 2 890 / 232 / 128, comparatif 2025 : 43 242 265 F)."""

import datetime as dt
import io

from django.test import SimpleTestCase
from openpyxl import Workbook

from .rafas import budget, code_college, colleges_proposes, nom_police, periode_proposee
from .rafas_analyse import Contexte, analyser, tranche
from .rafas_lecture import (categorie_depuis_college, lire_classeur, mois_cloture, proposer_college, repartir_sinistres, situation_depuis_nom,
                            zone_depuis_college)

ENTETE_SINISTRES = ["DateCloture", "Numero", "CodGar", "Garant", "Souscripteur", "idPolice", "Police", "codeCollege", "College", "MatriculeP", "Patient",
                    "Statut", "dateNaissance", "sexe", "MatriculeA", "Assure", "localitecentreExecutant", "centreExecutant", "LocalitecentrePrescripteur",
                    "centrePrescripteur", "libelle", "NPrestations", "codeActe", "Actes", "Medecin", "dateConsultation", "DatedeSoins", "TypeAffection",
                    "codeAffection", "TypePrestation", "Reclamé", "tm", "MontantExclus", "depassement", "Remboursé", "partPatient"]
COLLEGES = [{"code": "EXAT-CADRES", "libelle": "EXAT AGRICULTURE - CADRES", "categorie": "CADRES", "plafond_famille": 5000000, "bareme": []},
            {"code": "EXAT-AMO", "libelle": "EXAT AGRICULTURE - AM/O", "categorie": "AM/O", "plafond_famille": 100000,
             "bareme": [{"Controle": "OPTIQUE", "Plafond": 60000}]},
            {"code": "CSM-AMO", "libelle": "CLUB SAINT MICHEL - AM/O", "categorie": "AM/O", "plafond_famille": 2500000, "bareme": []}]


def classeur(lignes, titre="DEFINITIF JANVIER-SEPTEMBR 2026"):
    c = Workbook()
    f = c.active
    f.title = titre
    f.append(ENTETE_SINISTRES)
    for l in lignes:
        f.append(l)
    return c


def ligne(mois, numero, matricule=727000101, rembourse=8000, police=727, college=1436):
    return [mois, 98, "EXAT", "SOCIETE EXAT AGRICULTURE", "SOCIETE EXAT AGRICULTURE (COLLEGE AM/O)", police, "SOCIETE EXAT AGRICULTURE AM/O", college,
            "COLLEGE EXAT (AM/O-SAN PEDRO) - 80% CI FAMILL", matricule, "PATIENT", "A", dt.datetime(1980, 5, 1), "M", matricule // 100, "ASSURE",
            "SAN PEDRO", "PHARMACIE X", "SAN PEDRO", "CENTRE Y", "PHARMACIE", numero, "PH", "PHARMACIE USUELLE", "MEDECIN Z",
            dt.datetime(2026, 9, 3, 8, 15), dt.datetime(2026, 9, 3), "PARASITO", 22, "TP", 10000, 20, 0, 0, rembourse, 2000]


class LectureDesFichiers(SimpleTestCase):
    def test_cloture_et_ligne_total(self):
        self.assertEqual(mois_cloture("09/2026"), dt.date(2026, 9, 1))
        self.assertEqual(mois_cloture(dt.datetime(2026, 6, 1)), dt.date(2026, 6, 1))
        self.assertIsNone(mois_cloture("TOTAL"))

    def test_numero_au_format_date_et_total_ecarte(self):
        c = classeur([ligne("09/2026", 3318143), ligne("09/2026", 2979504, matricule=727000102), ["TOTAL"] + [None] * 33 + [16000, 4000]])
        f = c.active
        for rang in (2, 3):
            f.cell(rang, ENTETE_SINISTRES.index("NPrestations") + 1).number_format = "dd/mm/yyyy"  # comme dans les relevés d'EXAT
        tampon = io.BytesIO()
        c.save(tampon)
        lu = lire_classeur(tampon.getvalue(), "DETAIL SINISTRES.xlsx")
        feuille = lu["Sinistres"][0]
        self.assertEqual(feuille["Totaux"], 1)
        self.assertEqual([p["numero"] for p in feuille["Lignes"]], [3318143, 2979504])
        p = feuille["Lignes"][0]
        self.assertEqual((p["mois"], p["date_soins"], p["date_naissance"], p["rembourse"], p["matricule_adherent"]),
                         (dt.date(2026, 9, 1), dt.date(2026, 9, 3), dt.date(1980, 5, 1), 8000, 7270001))
        self.assertEqual(p["date_consultation"], dt.datetime(2026, 9, 3, 8, 15))

    def test_situation_depuis_le_nom(self):
        self.assertEqual(situation_depuis_nom("EFFECTIF AU 31-10-2026.xlsx"), dt.date(2026, 10, 31))
        self.assertEqual(situation_depuis_nom("EFFECTIF SEPTEMBRE 2026"), dt.date(2026, 9, 30))
        self.assertEqual(situation_depuis_nom("EFF JAN-AOUT 2025"), dt.date(2025, 8, 31))
        self.assertEqual(situation_depuis_nom("EFFECTI_EXAT", "BASES INDIVIDUELLES.xlsx"), None)

    def test_zone_categorie_et_college(self):
        self.assertEqual(zone_depuis_college("COLLEGE EXAT (AM/O-SAN PEDRO) - 80% CI FAMILL"), "SAN PEDRO")
        self.assertEqual(zone_depuis_college("COLLEGE EXAT (CADRES-KOT-TAABO) - 80% CI FAMI"), "KOT-TAABO")
        self.assertEqual(zone_depuis_college("COLLEGE EXAT (AM/O - ABIDJAN) - 80% CI FAMILL"), "ABIDJAN")
        self.assertEqual(zone_depuis_college("COLLEGE CLUB SAINT MICHEL - 80% FAMILLE"), "CLUB SAINT MICHEL")
        self.assertEqual(categorie_depuis_college("COLLEGE CLUB SAINT MICHEL - 80% CADRES FAMILL"), "CADRES")
        self.assertEqual(categorie_depuis_college("COLLEGE CLUB SAINT MICHEL - 80% FAMILLE", "CLUB SAINT MICHEL S/C EXAT AGRICULTURE"), "AM/O")
        self.assertEqual(proposer_college(COLLEGES, "CLUB SAINT MICHEL S/C EXAT AGRICULTURE", "COLLEGE CLUB SAINT MICHEL - 80% FAMILLE"), "CSM-AMO")
        self.assertEqual(proposer_college(COLLEGES, "SOCIETE EXAT AGRICULTURE CADRES", "COLLEGE EXAT (CADRES-ABIDJAN) - 80% CI FAMILL"), "EXAT-CADRES")

    def test_feuilles_recopiees(self):
        """Relevé d'origine et feuille de travail qui le recopie : chaque mois et police n'est pris qu'une fois, dans la feuille la plus complète."""
        p = lambda m, police: {"mois": m, "idpolice": police, "police": ""}  # noqa: E731
        feuilles = [{"Feuille": "DEFINITIF", "Rang": 0, "Lignes": [p(dt.date(2026, 2, 1), 727)] * 3 + [p(dt.date(2026, 2, 1), 757)]},
                    {"Feuille": "DEPENSES_EXAT", "Rang": 1, "Lignes": [p(dt.date(2026, 2, 1), 727)] * 3},
                    {"Feuille": "BASE CONSOLIDEE", "Rang": 2, "Lignes": [p(dt.date(2025, 2, 1), 727)] * 2 + [p(dt.date(2026, 2, 1), 727)] * 2}]
        retenus = repartir_sinistres(feuilles)
        self.assertEqual(retenus["DEFINITIF"], {(dt.date(2026, 2, 1), 727), (dt.date(2026, 2, 1), 757)})
        self.assertEqual(retenus["BASE CONSOLIDEE"], {(dt.date(2025, 2, 1), 727)})
        self.assertNotIn("DEPENSES_EXAT", retenus)


def beneficiaire(matricule, lien="A", college=1436, naissance=dt.date(1985, 1, 1), sexe="M", nom=None, sortie=None):
    return {"matricule": matricule, "matricule_adherent": matricule // 100, "adherent": f"ADHERENT {matricule // 100}", "nom": nom or f"BENEF {matricule}",
            "date_naissance": naissance, "sexe": sexe, "lien": lien, "idpolice": 727, "police": "SOCIETE EXAT AGRICULTURE AM/O", "code_college": college,
            "college": "COLLEGE EXAT (AM/O-SAN PEDRO) - 80% CI FAMILL", "date_effet": dt.date(2026, 2, 1), "date_entree": dt.date(2024, 2, 1),
            "date_sortie": sortie, "motif_sortie": "", "etat": ""}


def prestation(matricule, mois, rembourse, famille="PHARMACIE", acte="PHARMACIE USUELLE", jour=None, statut="A", sexe="M", affection="PARASITO", reclame=None,
               medecin="DR A"):
    jour = jour or mois.replace(day=5)
    return {"mois": mois, "numero": None, "matricule": matricule, "matricule_adherent": matricule // 100, "patient": f"P{matricule}", "assure": "ASSURE",
            "statut": statut, "date_naissance": dt.date(1985, 1, 1), "sexe": sexe, "idpolice": 727, "police": "", "code_college": 1436, "college": "",
            "localite_executant": "SAN PEDRO", "centre_executant": "PHARMACIE X", "localite_prescripteur": "SAN PEDRO", "centre_prescripteur": "CENTRE Y",
            "famille": famille, "code_acte": "", "acte": acte, "medecin": medecin, "date_consultation": dt.datetime.combine(jour, dt.time(8)),
            "date_soins": jour, "affection": affection, "code_affection": 1, "type_prestation": "TP", "reclame": reclame if reclame is not None else rembourse,
            "tm": 20, "exclus": 0, "depassement": 0, "rembourse": rembourse, "part_patient": 0}


class Analyse(SimpleTestCase):
    def setUp(self):
        self.ctx = Contexte(COLLEGES, {1436: {"college": "EXAT-AMO", "zone": "SAN PEDRO"}}, 2026)
        self.convention = {"age_enfant": 21, "age_etudiant": 25, "age_adulte": 60, "enfants_max": 4, "composition_famille": "Mr + Mme + 4 enfants"}
        fev, mars = dt.date(2026, 2, 1), dt.date(2026, 3, 1)
        self.effectif = [beneficiaire(727000101), beneficiaire(727000102, "C", sexe="F", naissance=dt.date(2012, 1, 1)),
                         beneficiaire(727000103, "E", naissance=dt.date(1999, 1, 1)), beneficiaire(727000201), beneficiaire(727000301, sortie=dt.date(2026, 1, 15))]
        self.reference = [beneficiaire(727000101), beneficiaire(727000102, "C", sexe="F"), beneficiaire(727000401)]
        self.prestations = [prestation(727000101, fev, 60000), prestation(727000101, fev, 60000),  # doublon
                            prestation(727000102, mars, 30000, famille="OPTIQUE", acte="VERRES", statut="C", sexe="F"),
                            prestation(727000201, mars, 5000, famille="CONSULTATION", acte="CONSULTATION GENERALISTE", affection="GYNECO", reclame=4000)]
        self.reference_prestations = [prestation(727000101, dt.date(2025, 2, 1), 20000)]

    def analyse(self, **options):
        return analyser(self.ctx, self.convention, self.effectif, self.prestations, dt.date(2026, 2, 1), dt.date(2026, 3, 1), reference=self.reference,
                        prestations_ref=self.reference_prestations, tous_beneficiaires=self.effectif + self.reference,
                        prestations_exercice=self.prestations, colleges_exercice=COLLEGES, **options)

    def test_synthese_et_recours(self):
        a = self.analyse()
        s = a["Synthese"]
        # le bénéficiaire sorti avant le début de la période n'est pas compté
        self.assertEqual((s["Effectif"], s["Familles"], s["Consommants"], s["Actes"], s["Depenses"]), (4, 2, 3, 4, 155000))
        self.assertAlmostEqual(s["TauxRecours"], 0.75)
        assure = next(l for l in a["Depenses"]["ParStatut"] if l["Libelle"] == "Assuré")
        self.assertEqual((assure["Consommants"], assure["Depenses"], assure["Actes"]), (2, 125000, 3))

    def test_mouvements_et_comparatif(self):
        a = self.analyse()
        total = a["Effectifs"]["Mouvements"][-1]
        self.assertEqual((total["Presents"], total["TotalRef"], total["Nouveaux"], total["Sortis"], total["Total"]), (2, 3, 2, 1, 4))
        c = a["Comparatif"]["Global"]["Total"]
        self.assertEqual((c["DepensesRef"], c["Depenses"], c["Ecart"]), (20000, 155000, 135000))

    def test_controles(self):
        k = {c["Code"]: c for c in self.analyse()["Controles"]}
        self.assertEqual((k["C07"]["Nombre"], k["C07"]["Montant"]), (1, 60000))          # doublon dans les dépenses
        self.assertEqual(k["C02"]["Nombre"], 1)                                          # conjointe de 14 ans
        self.assertEqual(k["C03"]["Nombre"], 1)                                          # enfant de 27 ans
        self.assertEqual(k["C13"]["Nombre"], 1)                                          # gynécologie pour un homme
        self.assertEqual((k["C14"]["Nombre"], k["C14"]["Montant"]), (1, 1000))           # remboursé au-delà du réclamé
        self.assertEqual(k["C16"]["Nombre"], 1)                                          # famille 7270001 : 120 000 F pour 100 000 F
        self.assertEqual(k["C16"]["Lignes"][0][-1], "Plafond dépassé")
        self.assertEqual(k["C16"]["Gravite"], "critique")

    def test_selection_des_colleges(self):
        a = self.analyse(selection={"EXAT-CADRES"})
        self.assertEqual((a["Synthese"]["Effectif"], a["Synthese"]["Actes"]), (0, 0))

    def test_tranches(self):
        self.assertEqual((tranche(0), tranche(7), tranche(8), tranche(25), tranche(56), tranche(None)), ("0-7 ans", "0-7 ans", "8-11 ans", "22-25 ans",
                                                                                                     "56 ans et plus", "Non renseigné"))


class Budget(SimpleTestCase):
    def test_avenant_1_exat(self):
        colleges = [{"code": "A", "cotisation": 701316, "familles": 38}, {"code": "B", "cotisation": 224400, "familles": 516},
                    {"code": "C", "cotisation": 701316, "familles": 1}, {"code": "D", "cotisation": 303600, "familles": 6}]
        self.assertEqual(budget(colleges, 8.5, 6.5), {"Cotisations": 144963324, "Honoraires": 12321883, "Commission": 9422616, "Enveloppe": 123218825})
        self.assertEqual(budget(colleges, 8.5, 6.5, familles={"B": 2})["Cotisations"], 448800)

    def test_code_de_college(self):
        self.assertEqual(code_college("EXAT AGRICULTURE - AM/O", set()), "EXAT-AGRICULTURE-AM-O")
        self.assertEqual(code_college("EXAT AGRICULTURE - AM/O", {"EXAT-AGRICULTURE-AM-O"}), "EXAT-AGRICULTURE-AM-O-2")


class NouvelleConvention(SimpleTestCase):
    """Proposition d'une convention d'après le fichier du gestionnaire (demande du 2026-11-10 : seules les cotisations restent à saisir)."""

    def test_nom_de_l_entreprise_d_une_police(self):
        self.assertEqual(nom_police("SOCIETE EXAT AGRICULTURE AM/O"), "EXAT AGRICULTURE")
        self.assertEqual(nom_police("SOCIETE EXAT AGRICULTURE CADRES"), "EXAT AGRICULTURE")
        self.assertEqual(nom_police("CLUB SAINT MICHEL S/C EXAT AGRICULTURE"), "CLUB SAINT MICHEL")

    def test_periode_et_rang_de_l_avenant(self):
        b = [{"date_effet_police": None, "date_echeance": dt.date(2027, 1, 31), "date_entree": dt.date(2024, 2, 1)},
             {"date_effet_police": None, "date_echeance": dt.date(2027, 1, 31), "date_entree": dt.date(2025, 6, 3)}]
        self.assertEqual(periode_proposee(b), {"date_effet": dt.date(2026, 2, 1), "date_echeance": dt.date(2027, 1, 31), "rang": 2,
                                               "debut_convention": dt.date(2024, 2, 1)})
        self.assertIsNone(periode_proposee([{"date_entree": dt.date(2024, 2, 1)}]))

    def test_colleges_familles_et_rattachements(self):
        def b(matricule, code, college, police, sortie=None):
            return {"matricule": matricule, "matricule_adherent": matricule // 100, "code_college": code, "college": college, "police": police,
                    "idpolice": 1, "date_sortie": sortie, "zone": ""}
        amo = "SOCIETE EXAT AGRICULTURE AM/O"
        beneficiaires = [b(727000101, 1436, "COLLEGE EXAT (AM/O-SAN PEDRO) - 80% CI FAMILL", amo), b(727000102, 1436, "COLLEGE EXAT (AM/O-SAN PEDRO) - 80% CI FAMILL", amo),
                         b(727000201, 1437, "COLLEGE EXAT (AM/O-SASSANDRA) - 80% CI FAMILL", amo),
                         b(727000301, 1437, "COLLEGE EXAT (AM/O-SASSANDRA) - 80% CI FAMILL", amo, sortie=dt.date(2026, 7, 1)),
                         b(717000101, 1418, "COLLEGE EXAT (CADRES-ABIDJAN) - 80% CI FAMILL", "SOCIETE EXAT AGRICULTURE CADRES"),
                         b(757000101, 1459, "COLLEGE CLUB SAINT MICHEL - 80% FAMILLE", "CLUB SAINT MICHEL S/C EXAT AGRICULTURE")]
        colleges, liens = colleges_proposes(beneficiaires, [], dt.date(2026, 9, 30))
        self.assertEqual([(c["libelle"], c["familles"], c["beneficiaires"]) for c in colleges],
                         [("EXAT AGRICULTURE - CADRES", 1, 1), ("EXAT AGRICULTURE - AM/O", 2, 3), ("CLUB SAINT MICHEL - AM/O", 1, 1)])
        self.assertEqual({l["code_college"]: (l["college_libelle"], l["zone"]) for l in liens}[1437], ("EXAT AGRICULTURE - AM/O", "SASSANDRA"))
