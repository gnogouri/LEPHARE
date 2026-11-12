"""Tableau de bord des consommations : état des cotisations, rapprochement entreprise / police, tranches d'âge, score, mouvements de l'effectif,
présentation du rapport Word. Sans base de données."""

import datetime as dt
import io
from decimal import Decimal as D

from django.test import SimpleTestCase
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from openpyxl import Workbook

from .consommations import _lire, exercice_du_fichier
from .consommations_pilotage import entreprises_a_risque, mouvements_effectif, ordre_des_tranches, proposer_liens, repartition, tranche
from .consommations_rapport import BLEU_CIEL, POLICE, Rapport, _chasse, _mots, _ordre_statuts, _souscripteur, _statut

ENTETE = ["Entreprises", " Effectifs par entreprise ", "OPTIONS", "Primes HT par personnes", "Primes HT par entreprise ", "Primes TTC Oreole santé encaisées",
          "Primes IA", "Primes AFA ", "Cotisations santé pure", "Honoraires MCI (11%)", "Commissions (7%)", "Apporteurs d'affaires",
          "Provisions pour paiement de dépenses de santé"]


def classeur(feuilles):
    wb = Workbook()
    wb.remove(wb.active)
    for titre, lignes in feuilles:
        ws = wb.create_sheet(titre)
        for l in lignes:
            ws.append(l)
    tampon = io.BytesIO()
    wb.save(tampon)
    return tampon.getvalue()


class EtatDesCotisations(SimpleTestCase):
    def test_feuille_des_donnees_lue_total_ecarte(self):
        contenu = classeur([("DONNER 2026", [ENTETE, ["SM PUB", 20, 3, 123333, 2466660, 8693180, 120000, 150000, 8423180, 271332.6, 172666.2, 100000, 7879181.2],
                                             ["Total", 20, None, None, 2466660, None, None, None, 8423180, None, None, None, 7879181.2]])])
        cotisations = _lire(contenu)[4]
        self.assertEqual(len(cotisations), 1)
        self.assertEqual(cotisations[0]["entreprise"], "SM PUB")
        self.assertEqual(cotisations[0]["provision"], D("7879181.2"))
        self.assertEqual(cotisations[0]["apporteurs"], D("100000"))
        self.assertEqual(cotisations[0]["effectif"], 20)

    def test_feuille_de_pilotage_ecartee(self):
        pilotage = ["ENTREPRISES", "PRIMES HT", "COTISATION SANTE PURE", "PROVISION POUR PAIEMENT DE DEPENSES", "CONSOMMATION PAR ENTREPRISE"]
        contenu = classeur([("DONNER 2026", [ENTETE, ["SM PUB", 20, 3, 0, 0, 0, 0, 0, 8423180, 0, 0, 0, 7879181.2]]),
                            ("CONTRÔLE", [pilotage, ["SM PUB", 1, 2, 3, 4]])])
        self.assertEqual([c["provision"] for c in _lire(contenu)[4]], [D("7879181.2")])

    def test_exercice_du_nom_du_fichier(self):
        self.assertEqual(exercice_du_fichier("ETAT 2026.xlsx"), 2026)
        self.assertEqual(exercice_du_fichier("ETAT.xlsx", {1: {"date_cloture": __import__("datetime").date(2025, 7, 31)}}), 2025)


class RapprochementDesNoms(SimpleTestCase):
    POLICES = ["PHARMACIE & LABORATOIRE LONGCHAMP", "VISION NOUVELLE EN TECHNOLOGIE (VNT)", "YAM CGA", "CGA LES HIRONDELLES", "OREOLE SANTE", "OREOLE SANTE PLUS",
               "BLOOMFIELD INVESTMENT", "BLOOMFIELD INTELLIGENCE", "TYM MEDICAL SOLUTIONS"]

    def test_propositions(self):
        p = proposer_liens(["PHARMACIE LONGCHAMP", "CGA POUR COMPTE VNT", "OREOLE SANTE", "OREOLE SANTE PLUS", "CGA HIRONDELLES"], self.POLICES, {})
        self.assertEqual(p, {"PHARMACIE LONGCHAMP": "PHARMACIE & LABORATOIRE LONGCHAMP", "CGA POUR COMPTE VNT": "VISION NOUVELLE EN TECHNOLOGIE (VNT)",
                             "OREOLE SANTE": "OREOLE SANTE", "OREOLE SANTE PLUS": "OREOLE SANTE PLUS", "CGA HIRONDELLES": "CGA LES HIRONDELLES"})

    def test_ambiguite_sans_proposition(self):
        self.assertEqual(proposer_liens(["BLOOMFIELD"], self.POLICES, {}), {})

    def test_une_police_pour_une_seule_entreprise(self):
        p = proposer_liens(["TYM MEDICAL", "MEDICAL SERVICE & SARL IDD"], self.POLICES, {})
        self.assertEqual(p, {"TYM MEDICAL": "TYM MEDICAL SOLUTIONS"})

    def test_lien_confirme_prioritaire(self):
        self.assertEqual(proposer_liens(["TYM MEDICAL", "AUTRE"], self.POLICES, {"AUTRE": "TYM MEDICAL SOLUTIONS"}), {})


class TranchesEtScore(SimpleTestCase):
    def test_tranches_du_rapport(self):
        self.assertEqual([tranche(a) for a in (0, 7, 8, 18, 30, 31, 55, 56, None)],
                         ["0-7 ans", "0-7 ans", "8-11 ans", "16-18 ans", "26-30 ans", "31-40 ans", "41-55 ans", "56 ans et plus", "Non renseigné"])

    def test_score_et_alertes(self):
        def p(police, benef, montant):
            return {"police": police, "matricule_beneficiaire": benef, "mt_rembourse": D(montant), "mt_reclame": D(montant), "date_naissance": None}
        prestations = [p("A", 1, 1000), p("A", 2, 1000), p("B", 3, 5000)] + [p("B", 3, 5000) for _ in range(11)]
        lignes, _portefeuille = entreprises_a_risque(prestations, [], None)
        b = next(l for l in lignes if l["Police"] == "B")
        a = next(l for l in lignes if l["Police"] == "A")
        self.assertGreater(b["Score"], 1)
        self.assertIn("Trop d'actes", b["Alertes"])
        self.assertLess(a["Score"], 1)
        self.assertEqual(a["Alertes"], [])
        self.assertIn("Critique", b["Alertes"])

    def test_critique_des_que_le_score_vaut_1(self):
        # Une seule entreprise : ses rapports au portefeuille valent tous 1, le score aussi
        prestations = [{"police": "SEULE", "matricule_beneficiaire": i, "mt_rembourse": D(1000), "mt_reclame": D(1000), "date_naissance": None} for i in range(3)]
        ligne = entreprises_a_risque(prestations, [], None)[0][0]
        self.assertEqual(ligne["Score"], 1)
        self.assertIn("Critique", ligne["Alertes"])

    def test_tranches_dans_l_ordre_des_ages(self):
        """Critique d'OREOLE du 2026-11-09 : 0-7 ans en première ligne, puis 8-11 ans..., quel que soit le montant des dépenses."""
        def p(age_tranche, montant):
            return {"tranche": age_tranche, "matricule_beneficiaire": 1, "mt_rembourse": D(montant), "mt_reclame": D(montant)}
        groupes = repartition([p("41-55 ans", 9000), p("Non renseigné", 5000), p("8-11 ans", 3000), p("0-7 ans", 100), p("56 ans et plus", 7000)], lambda x: x["tranche"])
        self.assertEqual([g["Libelle"] for g in ordre_des_tranches(groupes)], ["0-7 ans", "8-11 ans", "41-55 ans", "56 ans et plus", "Non renseigné"])


def personne(matricule, police="P1", actif=True, effet=dt.date(2020, 1, 1), sortie=None):
    return {"matricule_beneficiaire": matricule, "police": police, "actif": actif, "date_effet": effet, "date_sortie": sortie}


class MouvementsDeLEffectif(SimpleTestCase):
    """Critique d'OREOLE du 2026-11-09 sur le tableau 2 : sortants, nouveaux entrants et maintenus comparés à l'effectif de l'exercice précédent."""

    DU, AU = dt.date(2026, 1, 1), dt.date(2026, 12, 31)

    def test_comparaison_avec_l_effectif_de_reference(self):
        reference = {m: {"police": "P1"} for m in (1, 2, 3, 4)} | {5: {"police": "P2"}}
        # 1 et 2 maintenus, 3 sorti de l'effectif courant, 4 et 5 absents de l'effectif courant ; 6 et 7 nouveaux, 7 avec une date d'effet ancienne
        effectif = [personne(1), personne(2), personne(3, actif=False, sortie=dt.date(2026, 7, 31)), personne(6), personne(7, police="P2", effet=dt.date(2015, 1, 1))]
        m = mouvements_effectif(effectif, reference, self.DU, self.AU)
        self.assertEqual(m["P1"], {"Reference": 4, "Sortants": 2, "Maintenus": 2, "Nouveaux": 1, "Effectif": 3})
        self.assertEqual(m["P2"], {"Reference": 1, "Sortants": 1, "Maintenus": 0, "Nouveaux": 1, "Effectif": 1})
        total = {cle: sum(x[cle] for x in m.values()) for cle in ("Reference", "Sortants", "Maintenus", "Nouveaux", "Effectif")}
        self.assertEqual(total["Reference"] - total["Sortants"], total["Maintenus"])
        self.assertEqual(total["Maintenus"] + total["Nouveaux"], total["Effectif"])

    def test_garant_absent_de_la_reference(self):
        # constat du 2026-11-10 : l'effectif de référence ne porte que le garant OREOLE ; OREOLE CGA suit la règle des dates, sortants inconnus
        reference = {1: {"police": "P1", "garant": "OREOLE"}, 2: {"police": "P1", "garant": "OREOLE"}}
        effectif = [dict(personne(1), garant="OREOLE"), dict(personne(5, police="CGA"), garant="OREOLE CGA"),
                    dict(personne(6, police="CGA", effet=dt.date(2026, 4, 1)), garant="OREOLE CGA")]
        m = mouvements_effectif(effectif, reference, self.DU, self.AU)
        self.assertEqual(m["P1"], {"Reference": 2, "Sortants": 1, "Maintenus": 1, "Nouveaux": 0, "Effectif": 1})
        self.assertEqual(m["CGA"], {"Reference": 1, "Sortants": 0, "Maintenus": 1, "Nouveaux": 1, "Effectif": 2, "SansReference": True})

    def test_sans_reference_dates_d_effet_et_de_sortie(self):
        effectif = [personne(1), personne(2, effet=dt.date(2026, 3, 1)), personne(3, actif=False, sortie=dt.date(2026, 7, 31)),
                    personne(4, actif=False, sortie=dt.date(2025, 6, 30))]
        m = mouvements_effectif(effectif, None, self.DU, self.AU)
        self.assertEqual(m["P1"], {"Reference": 2, "Sortants": 1, "Maintenus": 1, "Nouveaux": 1, "Effectif": 2})


class PresentationDuRapport(SimpleTestCase):
    """Critiques d'OREOLE du 2026-11-09 : Arial Narrow 12, tableaux centrés, en-têtes et totaux en gras sur bleu ciel, souscripteur réel."""

    def relire(self, rapport):
        return Document(io.BytesIO(rapport.octets()))

    def test_tableau_centre_en_arial_narrow_12_entete_et_total_bleu_ciel(self):
        r = Rapport()
        r.titre("I. ANALYSE", 1)
        r.tableau("Essai", ["Libellé", "Montant"], [("A", "1 000"), ("B", "2 000")], total=("Total", "3 000"))
        doc = self.relire(r)
        t = doc.tables[0]
        for rang, fond in ((0, BLEU_CIEL), (1, None), (3, BLEU_CIEL)):
            cellule = t.rows[rang].cells[0]
            ombre = cellule._tc.tcPr.find(qn("w:shd"))
            self.assertEqual(ombre.get(qn("w:fill")) if ombre is not None else None, fond)
            run = cellule.paragraphs[0].runs[0]
            self.assertEqual((run.font.name, run.font.size.pt, bool(run.bold)), (POLICE, 12, fond is not None))
            self.assertEqual(cellule.paragraphs[0].alignment, WD_ALIGN_PARAGRAPH.CENTER)
        legende = next(p for p in doc.paragraphs if p.text.startswith("Tableau 1"))
        self.assertTrue(legende.runs[0].bold)
        # intitulé distinct du tableau (2e envoi d'OREOLE) : ligne à part, sans fond, espacée du tableau
        self.assertIsNone(legende._p.pPr.find(qn("w:shd")))
        self.assertGreater(legende.paragraph_format.space_after.pt, 0)
        self.assertEqual(legende._p.getnext().tag, qn("w:tbl"))
        self.assertTrue(all(run.font.size.pt == 12 and run.font.name == POLICE for p in doc.paragraphs for run in p.runs))

    def test_tableau_trop_large_coupe_en_portrait(self):
        """Consigne du 2026-11-09 : aucune page en paysage ; 12 colonnes de nombres = deux tableaux en portrait sous le même numéro, libellé répété."""
        r = Rapport()
        r.tableau("Large", ["Famille"] + [f"Colonne {i}" for i in range(1, 12)], [["PHARMACIE"] + [f"{i} 234 567" for i in range(1, 12)]],
                  total=["Total"] + ["99 999 999"] * 11)
        r.tableau("Étroit", ["A", "B"], [("1", "2")])
        doc = self.relire(r)
        self.assertEqual([s.orientation for s in doc.sections], [WD_ORIENT.PORTRAIT])
        self.assertEqual([p.text for p in doc.paragraphs if p.text.startswith("Tableau ")], ["Tableau 1 - Large", "Tableau 1 - Large, suite", "Tableau 2 - Étroit"])
        premier, second = doc.tables[0], doc.tables[1]
        entetes = [c.text for c in premier.rows[0].cells] + [c.text for c in second.rows[0].cells[1:]]
        self.assertEqual(entetes, ["Famille"] + [f"Colonne {i}" for i in range(1, 12)])
        self.assertEqual((second.rows[0].cells[0].text, second.rows[-1].cells[0].text), ("Famille", "Total"))
        self.assertEqual(second.rows[-1].cells[1]._tc.tcPr.find(qn("w:shd")).get(qn("w:fill")), BLEU_CIEL)

    def test_tableau_croise_tranches_subdivisees_comme_le_modele(self):
        """Demande du 2026-11-09 : tableau 14 comme le tableau 7 d'OREOLE, chaque tranche subdivisée en Dépenses et NB Actes, en portrait."""
        tranches = ["0-7 ans", "8-11 ans", "12-15 ans", "16-18 ans", "19-21 ans", "22-25 ans", "26-30 ans", "31-40 ans", "41-55 ans", "56 ans et plus"]
        groupes = tranches + ["Total général"]
        lignes = [["HOSPITALISATION"] + ["2 466 501", "13"] * len(groupes), ["MATERNITE"] + ["", ""] * len(groupes)]
        total = ["Total général"] + ["14 113 772", "1 179"] * len(groupes)
        r = Rapport()
        r.tableau_croise("Répartition", "Famille de prestation", "Tranche d'âge", groupes, ["Dépenses", "NB Actes"], lignes, total,
                         groupes_hors_titre=("Total général",))
        doc = self.relire(r)
        self.assertEqual([s.orientation for s in doc.sections], [WD_ORIENT.PORTRAIT])
        self.assertEqual([len(t.columns) for t in doc.tables], [9, 9, 7])  # 4, 4 puis 3 groupes entiers, libellé répété

        def distinctes(rang):
            vues, textes = set(), []
            for c in rang.cells:
                if id(c._tc) not in vues:
                    vues.add(id(c._tc))
                    textes.append(c.text)
            return textes
        premier, dernier = doc.tables[0], doc.tables[-1]
        self.assertEqual(distinctes(premier.rows[0]), ["", "Tranche d'âge"])
        self.assertEqual(distinctes(premier.rows[1]), ["", "0-7 ans", "8-11 ans", "12-15 ans", "16-18 ans"])
        self.assertEqual(distinctes(premier.rows[2]), ["Famille de prestation"] + ["Dépenses", "NB Actes"] * 4)
        self.assertEqual(distinctes(dernier.rows[0]), ["", "Tranche d'âge", "Total général"])
        self.assertEqual([c.text for c in dernier.rows[-1].cells][:3], ["Total général", "14 113 772", "1 179"])
        self.assertEqual(distinctes(dernier.rows[4])[1:3], ["", ""])  # case vide sans dépense

    def test_nombre_jamais_coupe_et_chasse_grasse(self):
        self.assertEqual(_mots("14 113 772"), ["14 113 772"])
        self.assertEqual(_mots("Coût moyen / acte"), ["Coût", "moyen", "/", "acte"])
        self.assertEqual(_mots("0-7 ans"), ["0-", "7", "ans"])
        # en gras, l'espace insécable d'Arial Narrow vaut deux espaces : « 14 113 772 » à espaces insécables est plus large
        self.assertGreater(_chasse("14 113 772", True), _chasse("14 113 772", True))

    def test_statuts_designes_par_leur_appellation_seulement(self):
        """2e envoi d'OREOLE : une seule désignation des statuts, « Assuré », « Conjoint(e) », « Enfant », jamais les lettres."""
        self.assertEqual([_statut(c) for c in ("A", "c", "E", "", None, "X")], ["Assuré", "Conjoint(e)", "Enfant", "Non renseigné", "Non renseigné", "Non renseigné"])
        groupes = [{"Libelle": l} for l in ("Enfant", "Non renseigné", "Assuré", "Conjoint(e)")]
        self.assertEqual([g["Libelle"] for g in _ordre_statuts(groupes)], ["Assuré", "Conjoint(e)", "Enfant", "Non renseigné"])

    def test_souscripteur_lu_dans_le_releve_et_particuliers(self):
        self.assertEqual(_souscripteur({"police": "POLICE X", "souscripteur": "SOCIETE X", "assure": "A"}), "SOCIETE X")
        self.assertEqual(_souscripteur({"police": "POLICE X", "souscripteur": "", "assure": "A"}), "POLICE X")
        self.assertEqual(_souscripteur({"police": "OREOLE SANTE", "souscripteur": "OREOLE SANTE", "assure": "ASSURE PARTICULIER"}), "ASSURE PARTICULIER")
        self.assertEqual(_souscripteur({"police": "OREOLE SANTE PLUS", "souscripteur": "OREOLE SANTE", "assure": "ASSURE PLUS"}), "ASSURE PLUS")
        self.assertEqual(_souscripteur({"police": "OREOLE SANTE PLUS", "souscripteur": "SOCIETE Y", "assure": "B"}), "SOCIETE Y")
