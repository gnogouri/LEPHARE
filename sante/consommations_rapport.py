"""
Rapport d'analyse des dépenses santé (Word), seul export du suivi des consommations (demande du 2026-11-06 : « je voudrais que seul le rapport
puisse être exporté » ; modèle : RAPPORT OREOLE SANTE 2026.docx). Gabarit : sante/modeles/rapport_consommations.docx (en-tête, logo et pied de
page du modèle, corps vidé). Plan du modèle : I. effectifs, II. dépenses, III. entreprises à risque et leurs fiches ; IV. contrôle de gestion
(provision face à la consommation, feuille CONTRÔLE DE GESTION de l'ETAT) quand l'état des cotisations est importé.

Critiques d'OREOLE du 2026-11-09 :
- mise en forme : Arial Narrow 12 points dans tout le corps du document (en-tête et pied de page du gabarit inchangés), informations des
  tableaux centrées, espace entre les tableaux, titres, en-têtes et totaux des tableaux en gras sur le bleu ciel du modèle d'OREOLE (DCE6F1) ;
  toutes les pages en portrait (consigne de l'utilisateur du 2026-11-09) : un tableau trop large pour la page est coupé en tableaux successifs,
  première colonne répétée, sous le même numéro (« suite ») ;
- souscripteur des familles : colonne SOUSCRIPTEUR du relevé, et non la police ; police des particuliers : l'assuré principal ;
- tranches d'âge dans l'ordre des âges, 0-7 ans en premier, toujours suivies de « ans » (tableau 14 compris) ;
- effectif consolidé : sortants, maintenus et nouveaux entrants comptés par comparaison avec l'effectif de l'exercice précédent.
Deuxième envoi du 2026-11-09 (avec le classeur ANALYSE DES SORTANT et le modèle Word) : intitulés des tableaux sur une ligne à part, sans
fond ; statuts désignés par « Assuré », « Conjoint(e) », « Enfant », jamais par les lettres ; tableau 2 aux colonnes du modèle (maintenus,
sortants, nouveaux, effectif de l'exercice) ; libellés des répartitions et « Total général » du modèle ; tableau croisé famille de prestation
par tranche d'âge, dépenses et actes, aussi dans chaque fiche d'entreprise.
Calculs : consommations_pilotage.py. Données de santé : réservé au droit consommations.view, chaque export est inscrit au journal d'audit.
"""

import io
import os
import re
from collections import defaultdict
from decimal import Decimal

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor, Twips

from django.db import connection
from django.http import HttpResponse
from rest_framework import permissions
from rest_framework.decorators import api_view, authentication_classes, permission_classes

from autorisations.journal import journaliser
from production.renouvellement import AUTHENTIFICATION

from . import consommations_graphiques as graphiques
from . import consommations_qualite as qualite
from .consommations import ErreurConsommation, _reponse, doublons_importes, normaliser
from .consommations_analyse import analyse as analyse_periode
from .consommations_pilotage import (MOIS, GENRES, TRANCHES, _age, _div, _periode, charger, date_effectif, effectif_de_reference,
                                     entreprises_a_risque, indicateurs, mouvements_effectif, ordre_des_tranches, repartition, tableau_de_bord, tranche)

GABARIT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "modeles", "rapport_consommations.docx")
ZERO = Decimal("0")
POLICE = "Arial Narrow"
TAILLE = Pt(12)
BLEU_CIEL = "DCE6F1"                          # en-têtes et totaux des tableaux du modèle RAPPORT OREOLE SANTE 2026
BLEU_TITRE = RGBColor(0x36, 0x5F, 0x91)       # titres des parties du modèle
BLEU_SOUS_TITRE = RGBColor(0x4F, 0x81, 0xBD)  # sous-titres du modèle
INSECABLE = " "
MARGE_CELLULE = 40                            # marge gauche et droite du texte d'une cellule (twips, 0,7 mm)
LARGEUR_SOUHAITEE_MAX = 4800                  # largeur souhaitée au plus pour une colonne de texte long (twips, 8,5 cm)
FICHES_MAX = 5
ANNEXE_MAX = 40                               # cas détaillés par contrôle dans l'annexe des anomalies de l'effectif
# Polices du gestionnaire qui regroupent des contrats individuels (ETAT des cotisations : « OREOLE SANTE/ PARTICULIERS ») : le relevé y donne le
# nom de la police comme souscripteur
POLICES_PARTICULIERS = {"OREOLE SANTE", "OREOLE SANTE PLUS"}
TOTAL = "Total général"  # libellé des lignes de total du modèle
# Une seule désignation des statuts dans tout le rapport, les appellations et jamais les lettres A, C, E (critique d'OREOLE du 2026-11-09,
# 2e envoi : « retenir une seule méthode de désignation... sans utiliser les deux simultanément »)
STATUTS_RAPPORT = {"A": "Assuré", "C": "Conjoint(e)", "E": "Enfant"}
ORDRE_STATUTS = ["Assuré", "Conjoint(e)", "Enfant", "Non renseigné"]


def _statut(code):
    return STATUTS_RAPPORT.get((code or "").strip().upper(), "Non renseigné")


def _ordre_statuts(groupes):
    return sorted(groupes, key=lambda g: ORDRE_STATUTS.index(g["Libelle"]) if g["Libelle"] in ORDRE_STATUTS else len(ORDRE_STATUTS))


def _f(v):
    """Montant ou nombre, milliers séparés par une espace ; la largeur des colonnes garde chaque nombre sur une ligne (_mots)."""
    if v is None:
        return "-"
    return f"{round(float(v)):,}".replace(",", " ")


def _p(v):
    return "-" if v is None else f"{float(v) * 100:.2f}{INSECABLE}%".replace(".", ",")


def _ans(v):
    return "-" if v is None else f"{round(v)}{INSECABLE}ans"


def _d(jour):
    return jour.strftime("%d/%m/%Y") if jour else ""


def _moyenne(valeurs):
    return sum(valeurs) / len(valeurs) if valeurs else None


# Chasses d'Arial Narrow, normal et gras, en millièmes de cadratin (ARIALN.TTF et ARIALNB.TTF de Windows, arrondies au-dessus). En gras,
# l'espace insécable est deux fois plus large que l'espace : un total « 14 113 772 » à espaces insécables déborderait d'une colonne calculée
# avec l'espace ordinaire (relevé du 2026-11-09)
_CARACTERES = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ àâäçéèêëîïôöùûüÿœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŒ°«»’–"
_NORMAL = [228, 228, 291, 456, 456, 729, 547, 157, 273, 273, 319, 479, 228, 273, 228, 228, 456, 456, 456, 456, 456, 456, 456, 456, 456, 456, 228, 228, 479, 479, 479,
           456, 832, 547, 547, 592, 592, 547, 501, 638, 592, 228, 410, 547, 456, 683, 592, 638, 547, 638, 592, 547, 501, 592, 547, 774, 547, 547, 501, 228, 228,
           228, 385, 456, 273, 456, 456, 410, 456, 456, 228, 456, 456, 182, 182, 410, 182, 683, 456, 456, 456, 456, 273, 410, 228, 456, 410, 592, 410, 410, 410,
           274, 213, 274, 479, 228, 456, 456, 456, 410, 456, 456, 456, 456, 228, 228, 456, 456, 456, 456, 456, 410, 774, 547, 547, 547, 592, 547, 547, 547, 547,
           228, 228, 638, 638, 592, 592, 592, 820, 400, 456, 456, 182, 456]
_GRAS = [228, 273, 389, 456, 456, 729, 592, 195, 273, 273, 319, 479, 228, 273, 228, 228, 456, 456, 456, 456, 456, 456, 456, 456, 456, 456, 273, 273, 479, 479, 479,
         501, 800, 592, 592, 592, 592, 547, 501, 638, 592, 228, 456, 592, 501, 683, 592, 638, 547, 638, 592, 547, 501, 592, 547, 774, 547, 547, 501, 273, 228,
         273, 479, 456, 273, 456, 501, 456, 501, 456, 273, 501, 501, 228, 228, 456, 228, 729, 501, 501, 501, 501, 319, 456, 273, 501, 456, 638, 456, 456, 410,
         319, 230, 319, 479, 456, 456, 456, 456, 456, 456, 456, 456, 456, 228, 228, 501, 501, 501, 501, 501, 456, 774, 592, 592, 592, 592, 547, 547, 547, 547,
         228, 228, 638, 638, 592, 592, 592, 820, 400, 456, 456, 228, 456]
CHASSES = {c: (n, g) for c, n, g in zip(_CARACTERES, _NORMAL, _GRAS)}
CHASSE_INCONNUE = 840  # caractère hors table : un peu plus que le plus large de la police


def _chasse(texte, gras=False):
    """Largeur d'un texte en Arial Narrow 12 points, en twips (cadratin de 12 points = 240 twips)."""
    return -(-sum(CHASSES.get(c, (CHASSE_INCONNUE, CHASSE_INCONNUE))[1 if gras else 0] for c in texte) * 240 // 1000)


def _mots(texte):
    """Morceaux d'un texte que Word ne coupe pas : un nombre avec ses milliers (« 14 113 772 »), un mot, ou un mot jusqu'à son tiret."""
    return re.findall(r"\d{1,3}(?: \d{3})+(?:,\d+)?|[^ ]+?-(?=[^ ])|[^ ]+", texte) or [""]


def _repartir(mini, souhaite, disponible):
    """Largeurs des colonnes (twips) sur toute la largeur du texte : chaque colonne reçoit au moins son mot le plus long (un nombre ne se coupe
    pas), le reste est partagé selon la largeur souhaitée (texte entier)."""
    if sum(souhaite) <= disponible:
        return [int(s * disponible / sum(souhaite)) for s in souhaite]
    if sum(mini) >= disponible:
        return [int(m * disponible / sum(mini)) for m in mini]
    reste, ecarts = disponible - sum(mini), [s - m for s, m in zip(souhaite, mini)]
    return [int(m + reste * e / sum(ecarts)) for m, e in zip(mini, ecarts)]


def _decouper(mini, disponible):
    """Colonnes de chaque tableau successif, pour tenir dans la largeur d'une page en portrait : la première colonne (libellé) est répétée
    dans chacun et les autres sont partagées en parts égales, à une près. Un seul tableau quand tout tient."""
    autres = list(range(1, len(mini)))
    if sum(mini) <= disponible or len(autres) < 2:
        return [[0] + autres]
    for nombre in range(2, len(autres) + 1):
        taille = -(-len(autres) // nombre)
        paquets = [autres[i:i + taille] for i in range(0, len(autres), taille)]
        if all(mini[0] + sum(mini[j] for j in paquet) <= disponible for paquet in paquets):
            return [[0] + paquet for paquet in paquets]
    return [[0, j] for j in autres]


def _ombre(parent, couleur):
    ombre = OxmlElement("w:shd")
    ombre.set(qn("w:val"), "clear")
    ombre.set(qn("w:color"), "auto")
    ombre.set(qn("w:fill"), couleur)
    parent.append(ombre)


class Rapport:
    def __init__(self):
        self.doc = Document(GABARIT) if os.path.exists(GABARIT) else Document()
        style = self.doc.styles["Normal"]
        style.font.name = POLICE
        style.font.size = TAILLE
        polices = style.element.get_or_add_rPr().get_or_add_rFonts()
        for attribut in ("w:eastAsia", "w:cs"):
            polices.set(qn(attribut), POLICE)
        section = self.doc.sections[0]
        # largeur du texte d'une page A4 en portrait, en twips (1 twip = 635 EMU)
        self.largeur = int((min(section.page_width, section.page_height) - section.left_margin - section.right_margin) / 635)
        self.numero = 0
        self.numero_graphique = 0
        self.anomalies = []                    # contrôles de l'effectif à détailler en annexe

    # ---- graphiques (attentes de l'équipe actuariat du 2026-11-11 : « tableaux et graphiques »)
    def graphique(self, legende, image):
        """Graphique numéroté à part des tableaux (« Graphique N - ... »), centré, à la largeur du texte (16 cm au plus) ; rien sans donnée."""
        if not image:
            return
        self.numero_graphique += 1
        self._legende(f"Graphique {self.numero_graphique} - {legende}")
        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(12)
        p.add_run().add_picture(io.BytesIO(image), width=Cm(min(graphiques.LARGEUR_CM, self.largeur / 567)))

    # ---- texte
    @staticmethod
    def _texte(p, texte, gras=False, italique=False, couleur=None):
        r = p.add_run(texte)
        r.bold, r.italic = gras, italique
        r.font.name, r.font.size = POLICE, TAILLE
        polices = r._element.get_or_add_rPr().get_or_add_rFonts()
        for attribut in ("w:eastAsia", "w:cs"):
            polices.set(qn(attribut), POLICE)
        if couleur is not None:
            r.font.color.rgb = couleur
        return r

    def titre(self, texte, niveau=1):
        """Titre de partie (niveaux 0 et 1) ou de sous-partie (2 et 3)."""
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(18 if niveau <= 1 else 12)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.keep_with_next = True
        if niveau == 0:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        self._texte(p, texte, gras=True, couleur=BLEU_TITRE if niveau <= 1 else BLEU_SOUS_TITRE)

    def para(self, texte, italique=False, centre=False):
        p = self.doc.add_paragraph()
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.keep_with_next = True
        if centre:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        self._texte(p, texte, italique=italique)

    # ---- tableaux
    def tableau(self, legende, entetes, lignes, total=None, marques=()):
        """Tableau numéroté. total : ligne de total ajoutée en bas ; marques : rangs des sous-totaux dans lignes (même présentation que le total).
        Trop large pour une page en portrait : coupé en tableaux successifs sous le même numéro, première colonne répétée."""
        entetes = [str(e) for e in entetes]
        lignes = [["" if v is None else str(v) for v in ligne] for ligne in lignes]
        marques = set(marques)
        if total:
            marques.add(len(lignes))
            lignes.append(["" if v is None else str(v) for v in total])
        colonnes = len(entetes)
        mini, souhaite = [], []
        bord = 2 * MARGE_CELLULE + 20
        for j in range(colonnes):
            textes = [(entetes[j], True)] + [(ligne[j] if j < len(ligne) else "", i in marques) for i, ligne in enumerate(lignes)]
            # Word passe à la ligne après une espace ou un tiret ; la colonne garde chaque nombre entier sur une ligne
            mini.append(max(_chasse(mot, gras) for texte, gras in textes for mot in _mots(texte)) + bord)
            # largeur souhaitée : celle des valeurs ; l'en-tête peut passer à la ligne
            souhaite.append(max(mini[j], min(LARGEUR_SOUHAITEE_MAX, max((_chasse(texte, gras) for texte, gras in textes[1:]), default=0) + bord)))
        self.numero += 1
        for rang_partie, partie in enumerate(_decouper(mini, self.largeur)):
            self._legende(f"Tableau {self.numero} - {legende}" + (", suite" if rang_partie else ""))
            self._grille([entetes[j] for j in partie], [[ligne[j] if j < len(ligne) else "" for j in partie] for ligne in lignes], marques,
                         _repartir([mini[j] for j in partie], [souhaite[j] for j in partie], self.largeur))

    def _legende(self, texte):
        """Intitulé du tableau, distinct de son contenu (critique d'OREOLE du 2026-11-09, 2e envoi : « les intitulés ne doivent pas être
        fusionnés avec les tableaux ») : une ligne en gras au-dessus du tableau, sans fond, séparée de lui, comme dans le modèle."""
        p = self.doc.add_paragraph()
        p.paragraph_format.keep_with_next = True
        p.paragraph_format.space_before = Pt(12)
        p.paragraph_format.space_after = Pt(6)
        self._texte(p, texte, gras=True)

    def _grille(self, entetes, lignes, marques, largeurs):
        t = self.doc.add_table(rows=1 + len(lignes), cols=len(entetes))
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        t.autofit = False
        self._marges(t)
        for j, largeur in enumerate(largeurs):
            t.columns[j].width = Twips(largeur)
        for i, ligne in enumerate([entetes] + lignes):
            rang = t.rows[i]
            proprietes = rang._tr.get_or_add_trPr()
            proprietes.append(OxmlElement("w:cantSplit"))
            if i == 0:
                proprietes.append(OxmlElement("w:tblHeader"))  # en-tête répété en haut de chaque page
            fort = i == 0 or (i - 1) in marques
            for j, cellule in enumerate(rang.cells):
                self._cellule(cellule, ligne[j], largeurs[j], fort)
        espace = self.doc.add_paragraph()
        espace.paragraph_format.space_before = Pt(0)
        espace.paragraph_format.space_after = Pt(6)

    @staticmethod
    def _marges(t):
        marges = OxmlElement("w:tblCellMar")
        for cote in ("left", "right"):
            marge = OxmlElement(f"w:{cote}")
            marge.set(qn("w:w"), str(MARGE_CELLULE))
            marge.set(qn("w:type"), "dxa")
            marges.append(marge)
        proprietes = t._tbl.tblPr
        apparence = proprietes.find(qn("w:tblLook"))
        if apparence is not None:
            apparence.addprevious(marges)
        else:
            proprietes.append(marges)

    def tableau_croise(self, legende, libelle_lignes, titre_groupes, groupes, sous_colonnes, lignes, total, groupes_hors_titre=()):
        """Tableau à en-tête sur trois lignes (modèle OREOLE « Répartition des dépenses par prestation et tranche d'âge ») : le titre des
        groupes sur toute leur largeur, chaque groupe (tranche d'âge) subdivisé en sous-colonnes (Dépenses, NB Actes), le libellé des lignes
        à gauche. lignes et total : [libellé, valeurs du groupe 1..., valeurs du groupe 2...]. groupes_hors_titre (Total général) : groupes
        hors du titre commun, leur libellé sur les deux premières lignes. Trop large pour la page : coupé par groupes entiers, même numéro."""
        n = len(sous_colonnes)
        bord = 2 * MARGE_CELLULE + 20
        corps = lignes + [total]

        def mini(j):
            textes = [(ligne[j], i == len(corps) - 1) for i, ligne in enumerate(corps)] + [(sous_colonnes[(j - 1) % n], True)]
            return max(_chasse(mot, gras) for texte, gras in textes for mot in _mots(texte)) + bord

        largeurs_mini = [max(_chasse(mot, gras) for texte, gras in [(l[0], False) for l in lignes] + [(total[0], True), (libelle_lignes, True)]
                             for mot in _mots(texte)) + bord] + [mini(j) for j in range(1, 1 + n * len(groupes))]
        # chaque groupe garde la place de son libellé
        for k, groupe in enumerate(groupes):
            colonnes = range(1 + k * n, 1 + (k + 1) * n)
            manque = max(_chasse(mot, True) for mot in _mots(groupe)) + bord - sum(largeurs_mini[j] for j in colonnes)
            if manque > 0:
                for j in colonnes:
                    largeurs_mini[j] += -(-manque // n)
        largeur_groupe = [sum(largeurs_mini[1 + k * n:1 + (k + 1) * n]) for k in range(len(groupes))]
        par_tableau = len(groupes)
        while par_tableau > 1 and largeurs_mini[0] + max(sum(largeur_groupe[i:i + par_tableau]) for i in range(0, len(groupes), par_tableau)) > self.largeur:
            par_tableau -= 1
        nombre = -(-len(groupes) // par_tableau)
        taille = -(-len(groupes) // nombre)  # parts égales, à une près
        self.numero += 1
        for rang_partie, debut in enumerate(range(0, len(groupes), taille)):
            partie = list(range(debut, min(debut + taille, len(groupes))))
            colonnes = [0] + [1 + k * n + s for k in partie for s in range(n)]
            utiles = [largeurs_mini[j] for j in colonnes]
            largeurs = _repartir(utiles, utiles, self.largeur)
            self._legende(f"Tableau {self.numero} - {legende}" + (", suite" if rang_partie else ""))
            t = self.doc.add_table(rows=3 + len(corps), cols=len(colonnes))
            t.style = "Table Grid"
            t.alignment = WD_TABLE_ALIGNMENT.CENTER
            t.autofit = False
            self._marges(t)
            for j, largeur in enumerate(largeurs):
                t.columns[j].width = Twips(largeur)
            for i, rang in enumerate(t.rows):
                proprietes = rang._tr.get_or_add_trPr()
                proprietes.append(OxmlElement("w:cantSplit"))
                if i < 3:
                    proprietes.append(OxmlElement("w:tblHeader"))  # en-tête répété en haut de chaque page
                fort = i < 3 or i == len(t.rows) - 1
                for j, cellule in enumerate(rang.cells):
                    self._habiller(cellule, largeurs[j], fort)
            # fusions : coin (deux premières lignes), titre commun, libellé de chaque groupe sur ses sous-colonnes
            t.cell(0, 0).merge(t.cell(1, 0))
            sous_titre = [k for k in partie if groupes[k] not in groupes_hors_titre]
            if sous_titre:
                premiere = 1 + partie.index(sous_titre[0]) * n
                derniere = 1 + (partie.index(sous_titre[-1]) + 1) * n - 1
                self._remplir(t.cell(0, premiere).merge(t.cell(0, derniere)), titre_groupes, True)
            for position, k in enumerate(partie):
                gauche, droite = 1 + position * n, 1 + (position + 1) * n - 1
                if groupes[k] in groupes_hors_titre:
                    self._remplir(t.cell(0, gauche).merge(t.cell(1, droite)), groupes[k], True)
                else:
                    self._remplir(t.cell(1, gauche).merge(t.cell(1, droite)), groupes[k], True)
                for s in range(n):
                    self._remplir(t.cell(2, gauche + s), sous_colonnes[s], True)
            self._remplir(t.cell(2, 0), libelle_lignes, True)
            for i, ligne in enumerate(corps):
                for j, colonne in enumerate(colonnes):
                    self._remplir(t.cell(3 + i, j), ligne[colonne], i == len(corps) - 1)
            espace = self.doc.add_paragraph()
            espace.paragraph_format.space_before = Pt(0)
            espace.paragraph_format.space_after = Pt(6)

    def _cellule(self, cellule, texte, largeur, fort):
        self._habiller(cellule, largeur, fort)
        self._remplir(cellule, texte, fort)

    @staticmethod
    def _habiller(cellule, largeur, fort):
        cellule.width = Twips(largeur)
        if fort:
            _ombre(cellule._tc.get_or_add_tcPr(), BLEU_CIEL)
        cellule.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

    def _remplir(self, cellule, texte, fort):
        p = cellule.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1
        self._texte(p, texte, gras=fort)

    def repartition(self, legende, colonne, groupes, beneficiaires=False, limite=None, total=False):
        groupes = groupes[:limite] if limite else groupes
        # colonnes du modèle d'OREOLE (« Répartition des dépenses par type de prestation ») : dépenses, leur part, actes, leur part, coût moyen
        if beneficiaires:
            entetes = [colonne, "Bénéficiaires", "Dépenses", "% des dépenses", "Nombre d'actes", "% des actes", "Coût moyen par acte"]
            lignes = [(g["Libelle"], _f(g["Beneficiaires"]), _f(g["Depenses"]), _p(g["Part"]), _f(g["Actes"]), _p(g["PartActes"]), _f(g["CoutParActe"])) for g in groupes]
        else:
            entetes = [colonne, "Dépenses", "% des dépenses", "Nombre d'actes", "% des actes", "Coût moyen par acte"]
            lignes = [(g["Libelle"], _f(g["Depenses"]), _p(g["Part"]), _f(g["Actes"]), _p(g["PartActes"]), _f(g["CoutParActe"])) for g in groupes]
        ligne_totale = None
        if total and groupes and not beneficiaires:
            depenses, actes = sum(g["Depenses"] for g in groupes), sum(g["Actes"] for g in groupes)
            ligne_totale = (TOTAL, _f(depenses), _p(1), _f(actes), _p(1), _f(_div(depenses, actes)))
        self.tableau(legende, entetes, lignes, total=ligne_totale)

    def octets(self):
        tampon = io.BytesIO()
        self.doc.save(tampon)
        return tampon.getvalue()


# ------------------------------------------------------------------ contenus
def _particuliers(police):
    nom = normaliser(police)
    return nom in POLICES_PARTICULIERS or "PARTICULIER" in nom


def _souscripteur(p):
    """Souscripteur d'une famille : colonne SOUSCRIPTEUR du relevé (la police n'est pas le souscripteur). Contrats des particuliers, où le
    relevé donne le produit comme souscripteur (OREOLE SANTE, y compris pour la police OREOLE SANTE PLUS) : chaque famille souscrit pour
    elle-même, le souscripteur est l'assuré principal (critique d'OREOLE du 2026-11-09 sur le tableau 28)."""
    souscripteur = (p.get("souscripteur") or "").strip() or p.get("police") or ""
    if _particuliers(souscripteur):
        return (p.get("assure") or "").strip() or souscripteur
    return souscripteur


def _indicateurs_tableau(r, legende, ind, effectif_libelle="Effectif total de bénéficiaires"):
    presence = ([("Bénéficiaires absents de la base des effectifs ayant exposé des frais", _f(ind["Absents"])),
                 ("Bénéficiaires présents dans la base des effectifs sans aucun frais", _f(ind["PresentsSansFrais"]))] if "Absents" in ind
                else [("Bénéficiaires n'ayant pas exposé de frais", _f(ind["NonConsommants"]))])
    r.tableau(legende, ["Indicateur", "Valeur"], [
        (effectif_libelle, _f(ind["Effectif"])), ("Bénéficiaires ayant exposé des frais", _f(ind["Consommants"])),
        *presence, ("Nombre d'actes", _f(ind["Actes"])),
        ("Taux de recours", _p(ind["TauxRecours"])), ("Montant total réclamé", _f(ind["Reclame"])), ("Montant total remboursé", _f(ind["Rembourse"])),
        ("Coût moyen par bénéficiaire", _f(ind["CoutParBeneficiaire"])), ("Coût moyen par acte", _f(ind["CoutParActe"])),
        ("Fréquence moyenne d'actes", "-" if ind["Frequence"] is None else f"{ind['Frequence']:.1f}".replace(".", ",")),
        ("Âge moyen", _ans(ind["AgeMoyen"])),
    ])


def _famille_tranche(r, legende, prestations, au):
    """Dépenses et nombre d'actes par famille de prestation et tranche d'âge, présentés comme le tableau 7 du modèle d'OREOLE (demande du
    2026-11-09) : familles par ordre alphabétique, chaque tranche subdivisée en Dépenses et NB Actes, case vide sans dépense, Total général."""
    tranches = [t[2] for t in TRANCHES]
    depenses = defaultdict(lambda: defaultdict(lambda: ZERO))
    actes = defaultdict(lambda: defaultdict(int))
    for p in prestations:
        famille, groupe = p["famille"] or "Non renseigné", tranche(_age(p["date_naissance"], au))
        depenses[famille][groupe] += p["mt_rembourse"]
        actes[famille][groupe] += 1
    groupes = tranches + (["Non renseigné"] if any("Non renseigné" in v for v in actes.values()) else [])
    familles = sorted(depenses, key=normaliser)

    def valeurs(montant, nombre):
        return [_f(montant), _f(nombre)] if nombre else ["", ""]

    lignes = [[f] + [v for g in groupes for v in valeurs(depenses[f][g], actes[f][g])]
              + valeurs(sum(depenses[f].values(), ZERO), sum(actes[f].values())) for f in familles]
    total = ["Total général"] + [v for g in groupes for v in valeurs(sum((depenses[f][g] for f in familles), ZERO), sum(actes[f][g] for f in familles))] \
        + valeurs(sum((sum(depenses[f].values(), ZERO) for f in familles), ZERO), sum(sum(actes[f].values()) for f in familles))
    r.tableau_croise(legende, "Famille de prestation", "Tranche d'âge", groupes + ["Total général"], ["Dépenses", "NB Actes"], lignes, total,
                     groupes_hors_titre=("Total général",))


def _familles_depensieres(r, legende, prestations, seuil=None, limite=None):
    """Familles (assuré principal) les plus dépensières, avec leurs bénéficiaires, leur souscripteur et leurs familles de prestation, et le total
    de chaque famille (comme le modèle)."""
    par_assure = defaultdict(lambda: ZERO)
    for p in prestations:
        par_assure[p["matricule_assure"]] += p["mt_rembourse"]
    retenus = [m for m, v in sorted(par_assure.items(), key=lambda kv: -kv[1]) if seuil is None or v > seuil][:limite]
    if not retenus:
        r.para("Aucune famille ne dépasse ce seuil sur la période.", italique=True)
        return
    garder = set(retenus)
    detail = defaultdict(lambda: [ZERO, 0])
    noms, souscripteurs = {}, {}
    for p in prestations:
        m = p["matricule_assure"]
        if m in garder:
            d = detail[(m, p["beneficiaire"], p["famille"])]
            d[0] += p["mt_rembourse"]
            d[1] += 1
            noms.setdefault(m, p["assure"])
            souscripteurs.setdefault(m, _souscripteur(p))
    lignes, marques = [], []
    for m in retenus:
        siennes = sorted(((k, v) for k, v in detail.items() if k[0] == m), key=lambda kv: -kv[1][0])
        for (_m, benef, famille), (dep, actes) in siennes:
            lignes.append((f"{noms.get(m, '')} ({m})", benef, souscripteurs.get(m, ""), famille, _f(dep), _f(actes)))
        marques.append(len(lignes))
        lignes.append((f"Total {noms.get(m, '')}".strip(), "", "", "", _f(sum((v[0] for _k, v in siennes), ZERO)), _f(sum(v[1] for _k, v in siennes))))
    r.tableau(legende, ["Nom de l'assuré", "Nom du bénéficiaire", "Souscripteur", "Famille de prestation", "Dépenses", "Nombre d'actes"], lignes, marques=marques)


def _top(r, legende, prestations, cle, colonne, limite=20):
    r.repartition(legende, colonne, repartition(prestations, cle), beneficiaires=True, limite=limite)


def _effectifs(r, effectif, du, au, reference, date_reference, situation, exercice, numero="I", doublons=()):
    actifs = [e for e in effectif if e["actif"]]
    statuts = defaultdict(list)
    for e in actifs:
        statuts[e["statut"]].append(e)
    noms = STATUTS_RAPPORT
    ages = [a for a in (_age(e["date_naissance"], au) for e in actifs) if a is not None]
    mouvements = mouvements_effectif(effectif, reference, du, au)
    # garants sans effectif de référence (OREOLE CGA quand seul l'effectif OREOLE précédent est importé) : sortants inconnus, « - » et non 0
    polices_sans_reference = {p for p, x in mouvements.items() if x.get("SansReference")}
    garants_sans_reference = sorted({e.get("garant") or "" for e in effectif if e["police"] in polices_sans_reference} - {""})

    def sortants(x):
        return _f(x["Sortants"]) if not x.get("SansReference") or x["Sortants"] else "-"

    def somme(cle):
        return sum(x[cle] for x in mouvements.values())

    # sans effectif de référence importé, l'effectif de début de période est estimé (maintenus + sortants datés)
    libelle_reference = f"Effectif de référence au {_d(date_reference)}" if reference is not None else "Effectif en début de période, estimé"
    r.titre(f"{numero}.1. Description de la population assurée", 2)
    r.tableau("Indicateurs clés de l'effectif", ["Indicateur", "Valeur"], [
        ("Effectif total" + (f" au {_d(situation)}" if situation else ""), _f(len(actifs))), ("Nombre d'assurés", _f(len(statuts["A"]))),
        ("Nombre de conjoint(e)s", _f(len(statuts["C"]))), ("Nombre d'enfants", _f(len(statuts["E"]))), ("Âge moyen de l'effectif", _ans(_moyenne(ages))),
        (libelle_reference, _f(somme("Reference"))),
        ("Effectifs sortants" + (f", hors {', '.join(garants_sans_reference)}" if garants_sans_reference else ""), _f(somme("Sortants"))),
        ("Effectifs maintenus", _f(somme("Maintenus"))), ("Nouveaux entrants", _f(somme("Nouveaux"))),
    ])
    if reference is not None:
        r.para(f"Mouvements de l'effectif : l'effectif au {_d(situation)} est comparé à l'effectif de référence au {_d(date_reference)}. Une personne de "
               "la référence absente de l'effectif actuel est sortante, une personne de l'effectif actuel absente de la référence est un nouvel entrant ; "
               "effectif total = effectifs maintenus + nouveaux entrants.")
    else:
        r.para(f"Aucun effectif antérieur au {_d(du)} n'est importé : les nouveaux entrants sont comptés d'après leur date d'effet et les sortants d'après "
               "les sorties datées dans la période. Pour compter tous les sortants, importez l'effectif de l'exercice précédent avec sa date de situation.",
               italique=True)
    # colonnes du modèle (« Effectif global consolidé par entreprise ») et du tableau croisé de l'ANALYSE DES SORTANT : maintenus, sortis,
    # nouveaux, effectif de l'exercice ; entreprises par ordre alphabétique, celles entièrement sorties comprises (effectif 0)
    maintenus = f"Maintenus {date_reference.year}-{exercice}" if reference is not None and date_reference else "Maintenus"
    r.tableau("Effectif consolidé par entreprise", ["Entreprise", maintenus, "Sortants", "Nouveaux entrants", f"Effectif {exercice}"],
              [(p or "Non renseigné", _f(mouvements[p]["Maintenus"]), sortants(mouvements[p]), _f(mouvements[p]["Nouveaux"]), _f(mouvements[p]["Effectif"]))
               for p in sorted(mouvements, key=normaliser)],
              total=(TOTAL, _f(somme("Maintenus")), _f(somme("Sortants")), _f(somme("Nouveaux")), _f(somme("Effectif"))))
    classees = sorted(mouvements, key=lambda p: (-mouvements[p]["Effectif"], normaliser(p)))
    r.graphique("Effectif global consolidé par entreprise", graphiques.barres([p or "Non renseigné" for p in classees],
                                                                             [mouvements[p]["Effectif"] for p in classees]))
    if reference is not None and garants_sans_reference:
        noms = ", ".join(garants_sans_reference)
        r.para(f"« - » dans la colonne Sortants : aucun effectif {noms} antérieur au {_d(du)} n'est importé. Les sortants de ces entreprises ne "
               "peuvent pas être comptés, hors sorties datées, et leurs nouveaux entrants sont comptés d'après leur date d'effet. Importez l'effectif "
               f"{noms} de l'exercice précédent avec sa date de situation pour les compter.", italique=True)
    if reference is not None:
        completes = sum(1 for x in mouvements.values() if not x.get("SansReference") and not x["Sortants"] and x["Effectif"])
        if completes:
            r.para(f"Sortants à 0 : {completes} entreprise{'s ont' if completes > 1 else ' a'} gardé tout {'leur' if completes > 1 else 'son'} "
                   f"effectif du {_d(date_reference)}.", italique=True)

    par_police = defaultdict(lambda: {"A": 0, "C": 0, "E": 0, "Ages": []})
    for e in actifs:
        x = par_police[e["police"]]
        x[e["statut"] if e["statut"] in ("A", "C", "E") else "E"] += 1
        a = _age(e["date_naissance"], au)
        if a is not None:
            x["Ages"].append(a)
    effectif_de = {p: sum(x[s] for s in "ACE") for p, x in par_police.items()}
    r.tableau("Répartition des effectifs par statut et par entreprise", ["Entreprise", noms["A"], noms["C"], noms["E"], "Total", "Âge moyen"],
              [(p or "Non renseigné", _f(par_police[p]["A"]), _f(par_police[p]["C"]), _f(par_police[p]["E"]), _f(effectif_de[p]), _ans(_moyenne(par_police[p]["Ages"])))
               for p in sorted(par_police, key=lambda p: (-effectif_de[p], p))],
              total=(TOTAL, _f(len(statuts["A"])), _f(len(statuts["C"])), _f(len(statuts["E"])), _f(len(actifs)), _ans(_moyenne(ages))))
    principales = sorted(par_police, key=lambda p: (-effectif_de[p], p))[:20]
    r.graphique("Répartition des effectifs par statut et par entreprise" + (", 20 premières entreprises" if len(par_police) > 20 else ""),
                graphiques.empilees([p or "Non renseigné" for p in principales], [(noms[s], [par_police[p][s] for p in principales]) for s in "ACE"]))
    lignes = []
    for s in ("A", "C", "E"):
        a = [x for x in (_age(e["date_naissance"], au) for e in statuts[s]) if x is not None]
        lignes.append((noms[s], _f(len(statuts[s])), _p(_div(len(statuts[s]), len(actifs))), _ans(_moyenne(a))))
    r.tableau("Répartition des effectifs par statut", ["Statut", "Bénéficiaires", "% des bénéficiaires", "Âge moyen"], lignes,
              total=(TOTAL, _f(len(actifs)), _p(1), _ans(_moyenne(ages))))
    r.graphique("Répartition globale des effectifs par statut", graphiques.anneau([(noms[s], len(statuts[s])) for s in "ACE"]))
    par_tranche = defaultdict(lambda: {"A": 0, "C": 0, "E": 0, "Ages": []})
    for e in actifs:
        a = _age(e["date_naissance"], au)
        x = par_tranche[tranche(a)]
        x[e["statut"] if e["statut"] in ("A", "C", "E") else "E"] += 1
        if a is not None:
            x["Ages"].append(a)
    presentes = [t for t in [t[2] for t in TRANCHES] + ["Non renseigné"] if t in par_tranche]
    r.tableau("Répartition des effectifs par tranche d'âge", ["Tranche d'âge", "Bénéficiaires", "% des bénéficiaires", "Âge moyen"],
              [(t, _f(sum(par_tranche[t][s] for s in "ACE")), _p(_div(sum(par_tranche[t][s] for s in "ACE"), len(actifs))), _ans(_moyenne(par_tranche[t]["Ages"])))
               for t in presentes], total=(TOTAL, _f(len(actifs)), _p(1), _ans(_moyenne(ages))))
    r.graphique("Répartition des effectifs par tranche d'âge", graphiques.colonnes(presentes, [sum(par_tranche[t][s] for s in "ACE") for t in presentes]))
    r.tableau("Répartition des effectifs par tranche d'âge et par statut", ["Tranche d'âge", noms["A"], noms["C"], noms["E"], "Total", "% des bénéficiaires"],
              [(t, _f(par_tranche[t]["A"]), _f(par_tranche[t]["C"]), _f(par_tranche[t]["E"]), _f(sum(par_tranche[t][s] for s in "ACE")),
                _p(_div(sum(par_tranche[t][s] for s in "ACE"), len(actifs)))) for t in presentes],
              total=(TOTAL, _f(len(statuts["A"])), _f(len(statuts["C"])), _f(len(statuts["E"])), _f(len(actifs)), _p(1)))
    r.graphique("Répartition des effectifs par tranche d'âge et par statut",
                graphiques.empilees(presentes, [(noms[s], [par_tranche[t][s] for t in presentes]) for s in "ACE"], horizontal=False))
    # Contrôle de cohérence et détection des anomalies (attentes de l'équipe actuariat, point 2.3 : consommations_qualite.py)
    r.titre(f"{numero}.2. Contrôle de cohérence et détection des anomalies", 2)
    _controles_effectif(r, actifs, au, doublons, effectif)


def _controles_effectif(r, actifs, au, doublons, effectif=None, annexe=True):
    """Tableau des 17 contrôles de qualité de l'effectif ; cas détaillés en annexe du rapport (r.annexe_anomalies)."""
    controles = qualite.controler(actifs, au, doublons)
    r.para("Contrôles automatiques réalisés sur l'effectif avant exploitation : unicité des matricules et des personnes, rattachement de chaque "
           "bénéficiaire à son assuré principal, âges plausibles et conformes au statut, données obligatoires. « À corriger » : donnée fausse ; "
           "« À vérifier » : situation possible mais inhabituelle, à confirmer. Limites retenues : assuré principal et conjoint(e) de 18 ans au "
           "moins, enfant couvert jusqu'à 21 ans (25 ans s'il est scolarisé), 12 ans d'écart au moins entre un enfant et son assuré principal.")
    r.tableau("Contrôle de cohérence de l'effectif", ["Contrôle", "Gravité", "Nombre de cas", "Résultat"],
              [(c["Libelle"], c["Gravite"], _f(c["Nombre"]), "Conforme" if not c["Nombre"] else c["Gravite"]) for c in controles],
              total=(TOTAL, "", _f(sum(c["Nombre"] for c in controles)), ""))
    sans_genre = qualite.garants_sans_genre(effectif if effectif is not None else actifs)
    if sans_genre:
        r.para(f"Genre : le fichier d'effectif du garant {', '.join(sans_genre)} n'a pas de colonne genre ; ses bénéficiaires ne sont pas comptés "
               "dans le contrôle du genre et figurent « Non renseigné » dans les répartitions par genre.", italique=True)
    if annexe:
        r.anomalies.extend(c for c in controles if c["Nombre"])
    return controles


def _annexe_anomalies(r, lettre="A"):
    """Détail des cas des contrôles de l'effectif (40 premiers par contrôle), en fin de rapport."""
    if not r.anomalies:
        return
    r.titre(f"ANNEXE {lettre}. DÉTAIL DES ANOMALIES DE L'EFFECTIF", 1)
    r.para("Personnes concernées par chaque contrôle, pour correction par le gestionnaire. Document contenant des données personnelles : "
           "diffusion restreinte.", italique=True)
    for c in r.anomalies:
        cas = c["Cas"][:ANNEXE_MAX]
        r.tableau(f"{c['Libelle']} ({_f(c['Nombre'])} cas{', ' + str(ANNEXE_MAX) + ' premiers' if c['Nombre'] > ANNEXE_MAX else ''})",
                  ["Matricule", "Nom et prénoms", "Entreprise", "Statut", "Âge", "Constat"],
                  [(x["Matricule"], x["Nom"] or "-", x["Entreprise"] or "-", x["Statut"], "-" if x["Age"] is None else _ans(x["Age"]), x["Detail"] or "-")
                   for x in cas])


def _fiche(r, police, prestations, effectif, au):
    ps = [p for p in prestations if p["police"] == police]
    beneficiaires = [e for e in effectif if e["police"] == police and e["actif"]]
    r.titre(f"Fiche d'entreprise : {police}", 3)
    if _particuliers(police):
        r.para("Police des particuliers : chaque famille souscrit pour elle-même, le souscripteur indiqué est l'assuré.", italique=True)
    # Axes du premier module (attentes, troisième module : « mêmes axes d'étude que les deux premiers modules ») : effectif et sa qualité
    statuts = defaultdict(list)
    for e in beneficiaires:
        statuts[e["statut"] if e["statut"] in ("A", "C", "E") else "E"].append(_age(e["date_naissance"], au))
    ages = [a for liste in statuts.values() for a in liste if a is not None]
    r.tableau("Effectif de l'entreprise par statut", ["Statut", "Bénéficiaires", "% des bénéficiaires", "Âge moyen"],
              [(STATUTS_RAPPORT[s], _f(len(statuts[s])), _p(_div(len(statuts[s]), len(beneficiaires))), _ans(_moyenne([a for a in statuts[s] if a is not None])))
               for s in "ACE"], total=(TOTAL, _f(len(beneficiaires)), _p(1) if beneficiaires else "-", _ans(_moyenne(ages))))
    par_tranche = defaultdict(lambda: {"A": 0, "C": 0, "E": 0})
    for e in beneficiaires:
        par_tranche[tranche(_age(e["date_naissance"], au))][e["statut"] if e["statut"] in ("A", "C", "E") else "E"] += 1
    presentes = [t for t in [t[2] for t in TRANCHES] + ["Non renseigné"] if t in par_tranche]
    r.graphique(f"Effectif de {police} par tranche d'âge et par statut",
                graphiques.empilees(presentes, [(STATUTS_RAPPORT[s], [par_tranche[t][s] for t in presentes]) for s in "ACE"], horizontal=False))
    anomalies = [c for c in qualite.controler(beneficiaires, au) if c["Nombre"]]
    if anomalies:
        r.tableau("Anomalies de l'effectif de l'entreprise", ["Contrôle", "Gravité", "Nombre de cas"],
                  [(c["Libelle"], c["Gravite"], _f(c["Nombre"])) for c in anomalies])
    else:
        r.para("Aucune anomalie dans l'effectif de l'entreprise.", italique=True)
    # Axes du second module : dépenses
    _indicateurs_tableau(r, "Indicateurs clés de l'entreprise", _indicateurs(ps, beneficiaires, {e["matricule_beneficiaire"] for e in effectif}, au))
    familles = repartition(ps, lambda p: p["famille"])
    r.repartition("Répartition des dépenses par type de prestation", "Type de prestation", familles, total=True)
    _graphique_repartition(r, f"Dépenses de {police} par type de prestation", familles)
    r.repartition("Répartition des dépenses par statut", "Statut", _ordre_statuts(repartition(ps, lambda p: _statut(p["statut"]))), total=True)
    r.repartition("Répartition des dépenses par tranche d'âge", "Tranche d'âge",
                  ordre_des_tranches(repartition(ps, lambda p: tranche(_age(p["date_naissance"], au)))), total=True)
    # comme les fiches du modèle : dépenses et actes de chaque famille de prestation par tranche d'âge
    _famille_tranche(r, "Répartition des dépenses par tranche d'âge et par famille de prestation", ps, au)
    genres = _genres(ps)
    if any(g["Libelle"] != "Non renseigné" for g in genres):  # genre inconnu de tout l'effectif de l'entreprise : tableau sans objet
        r.repartition("Répartition des dépenses par genre", "Genre", genres, total=True)
    _top(r, "Top 10 des centres prescripteurs", ps, lambda p: p["centre_prescripteur"], "Centre prescripteur", 10)
    _top(r, "Top 10 des centres exécutants", ps, lambda p: p["centre_executant"], "Centre exécutant", 10)
    _familles_depensieres(r, "Top 10 des familles les plus dépensières", ps, limite=10)
    _top(r, "Top 10 des médecins les plus coûteux", ps, lambda p: p["medecin"], "Médecin", 10)


def _analyses_complementaires(r, a, numero):
    """Partie « Analyses complémentaires » (demande du 2026-11-09 : pousser l'analyse plus loin) : les chiffres des onglets d'analyse de l'écran,
    calculés par consommations_analyse.analyser, présentés avec les mêmes règles que le reste du rapport (portrait, Arial Narrow, bleu ciel)."""
    s, f = a["Synthese"], a["Foyers"]
    r.titre(f"{numero}. ANALYSES COMPLÉMENTAIRES", 1)
    r.para("Chiffres identiques à ceux de l'écran Consommations santé de LE PHARE. Tous les mois du relevé comptent, le dernier avec tous ses actes ; "
           "projection au rythme moyen de ces mois ; formules proposées, à valider.", italique=True)

    r.titre(f"{numero}.1. Points à retenir", 2)
    for c in a["Constats"]:
        r.para(f"{c['Titre']} : {c['Texte']}")

    r.titre(f"{numero}.2. Rythme de consommation et projection", 2)
    lignes = [("Mois du relevé pris en compte", _f(s["MoisEcoules"])), ("Rythme mensuel moyen", _f(s["Rythme"])),
              (f"Consommation à fin {(s['DernierMois'] or '').lower()}", _f(s["CumulDernierMois"])), ("Consommation de la période", _f(s["Depenses"])),
              ("Projection en fin de période", _f(s["Projection"]))]
    if s["Provision"]:
        lignes += [("Provisions pour paiement", _f(s["Provision"])), ("Taux de consommation des provisions", _p(s["TauxProvision"])),
                   ("Part de la période écoulée", _p(s["Attendu"])), ("Taux projeté en fin de période", _p(s["TauxProjete"]))]
    r.tableau("Rythme de consommation et projection", ["Indicateur", "Valeur"], lignes)
    suivies = sorted((l for l in a["Entreprises"] if l["Provision"]), key=lambda l: -(l["TauxProjete"] or 0))
    if suivies:
        r.tableau("Projection de fin de période par entreprise", ["Entreprise", "Provision", "Dépenses", "Taux", "Projection", "Taux projeté", "Situation"],
                  [((l["Entreprises"][0] if l["Entreprises"] else l["Police"]) or "-", _f(l["Provision"]), _f(l["Depenses"]), _p(l["TauxProvision"]),
                    _f(l["Projection"]), _p(l["TauxProjete"]), l["Situation"]) for l in suivies])

    r.titre(f"{numero}.3. Dépenses par compagnie", 2)
    r.tableau("Dépenses par compagnie (garant du relevé)", ["Compagnie", "Entreprises", "Bénéficiaires couverts", "Taux de recours", "Dépenses", "% des dépenses",
                                                            "Coût par bénéficiaire"],
              [(c["Garant"], _f(c["Polices"]), _f(c["Effectif"]), _p(c["TauxRecours"]), _f(c["Depenses"]), _p(c["Part"]), _f(c["CoutParBeneficiaire"]))
               for c in a["Compagnies"]],
              total=(TOTAL, _f(sum(c["Polices"] for c in a["Compagnies"])), _f(s["Effectif"]), _p(s["TauxRecours"]), _f(s["Depenses"]), _p(1),
                     _f(s["CoutParBeneficiaire"])))

    r.titre(f"{numero}.4. Coût par bénéficiaire selon l'âge", 2)
    r.tableau("Bénéficiaires couverts et dépenses par tranche d'âge", ["Tranche d'âge", "Hommes", "Femmes", "Bénéficiaires couverts", "Taux de recours",
                                                                       "Dépenses", "Coût par bénéficiaire"],
              [(t["Tranche"], _f(t["Hommes"]), _f(t["Femmes"]), _f(t["Effectif"]), _p(t["TauxRecours"]), _f(t["Depenses"]), _f(t["CoutParBeneficiaire"]))
               for t in a["Profil"]["Tranches"]],
              total=(TOTAL, _f(sum(t["Hommes"] for t in a["Profil"]["Tranches"])), _f(sum(t["Femmes"] for t in a["Profil"]["Tranches"])), _f(s["Effectif"]),
                     _p(s["TauxRecours"]), _f(s["Depenses"]), _f(s["CoutParBeneficiaire"])))

    r.titre(f"{numero}.5. Concentration des dépenses par foyer", 2)
    r.para(f"{_f(f['Total'])} foyers, dont {_f(f['Consommateurs'])} ont consommé sur la période. Les 10 % de foyers les plus consommateurs, soit "
           f"{_f(f['Top10Pct']['Foyers'])}, font {_p(f['Top10Pct']['Part'])} des dépenses ; la consommation médiane d'un foyer est de {_f(f['Mediane'])} F.")
    r.tableau("Foyers par niveau de consommation", ["Niveau de consommation", "Foyers", "% des foyers", "Dépenses", "% des dépenses"],
              [(t["Libelle"], _f(t["Foyers"]), _p(t["PartFoyers"]), _f(t["Depenses"]), _p(t["PartDepenses"])) for t in f["Tranches"]],
              total=(TOTAL, _f(f["Total"]), _p(1), _f(s["Depenses"]), _p(1)))

    r.titre(f"{numero}.6. Du montant réclamé au montant remboursé", 2)
    d = a["Decomposition"]
    r.tableau("Décomposition du montant réclamé", ["Poste", "Montant", "% du réclamé"],
              [(libelle, _f(d[cle]), _p(_div(d[cle], d["Reclame"]))) for libelle, cle in (
                  ("Remboursé", "Rembourse"), ("Ticket modérateur et plafonds", "TicketEtPlafonds"), ("Dépassements", "Depassements"), ("Exclusions", "Exclusions"))],
              total=("Montant réclamé", _f(d["Reclame"]), _p(1)))

    r.titre(f"{numero}.7. Coût des prestataires à acte égal", 2)
    r.para("Indice de coût : montant réclamé par le centre rapporté au montant médian des mêmes actes dans le portefeuille (100 = médiane), sur les actes vus "
           "au moins 10 fois et pour les centres d'au moins 20 actes comparables. Au-delà de 130, le centre coûte nettement plus cher à acte égal : prix plus "
           "élevés ou actes plus lourds, à vérifier avec le gestionnaire.")
    centres = [c for c in a["Prestataires"]["Centres"] if c["Indice"]]
    if centres:
        r.tableau("Indice de coût des centres exécutants les plus sollicités", ["Centre exécutant", "Actes", "Dépenses", "Coût moyen par acte", "Indice de coût"],
                  [(c["Centre"], _f(c["Actes"]), _f(c["Depenses"]), _f(c["CoutParActe"]), _f(c["Indice"])) for c in centres])

    r.titre(f"{numero}.8. Délai entre les soins et leur paiement", 2)
    dl = a["Delais"]
    r.para(f"De la date de soins, corrigée de l'inversion jour/mois, à la clôture du relevé qui les paie : délai médian de {_f(dl['Mediane'])} jours, "
           f"9 soins sur 10 payés en {_f(dl['P90'])} jours au plus. La date de réception des relevés n'est pas utilisée : elle est inversée ou postérieure "
           "à la clôture sur la plupart des lignes du gestionnaire.")
    r.tableau("Prestations par délai de paiement", ["Délai", "Prestations", "% des prestations", "Dépenses"],
              [(t["Libelle"], _f(t["Actes"]), _p(t["Part"]), _f(t["Depenses"])) for t in dl["Tranches"]],
              total=(TOTAL, _f(sum(t["Actes"] for t in dl["Tranches"])), _p(1), _f(sum(t["Depenses"] for t in dl["Tranches"]))))


TYPES_RAPPORT = {
    "effectifs": ("ANALYSE DES EFFECTIFS", "RAPPORT EFFECTIFS SANTE", "rapport des effectifs"),
    "depenses": ("ANALYSE DES DÉPENSES DE SANTÉ", "RAPPORT DEPENSES SANTE", "rapport des dépenses de santé"),
    "global": ("RAPPORT GLOBAL : EFFECTIFS ET DÉPENSES DE SANTÉ", "RAPPORT GLOBAL CONSOMMATIONS SANTE", "rapport global"),
}


def _indicateurs(prestations, actifs, matricules_effectif, au):
    """Indicateurs clés des attentes (point II.1) : ceux du modèle, plus les bénéficiaires absents de la base des effectifs ayant exposé des
    frais et ceux présents dans l'effectif sans aucun frais."""
    ind = indicateurs(prestations, actifs, au)
    consommants = {p["matricule_beneficiaire"] for p in prestations}
    ind["Absents"] = len(consommants - matricules_effectif)
    ind["PresentsSansFrais"] = len({e["matricule_beneficiaire"] for e in actifs} - consommants)
    return ind


def _frequence(v):
    return "-" if v is None else f"{v:.1f}".replace(".", ",")


def _indicateurs_par_entreprise(r, prestations, effectif, au, portefeuille):
    actifs = [e for e in effectif if e["actif"]]
    tous = {e["matricule_beneficiaire"] for e in effectif}
    par_police, eff_police = defaultdict(list), defaultdict(list)
    for p in prestations:
        par_police[p["police"]].append(p)
    for e in actifs:
        eff_police[e["police"]].append(e)
    lignes = []
    for police in sorted(set(par_police) | set(eff_police), key=normaliser):
        ind = _indicateurs(par_police[police], eff_police[police], tous, au)
        lignes.append((police or "Non renseigné", _f(len(eff_police[police])), _f(ind["Consommants"]), _f(ind["Absents"]), _f(ind["PresentsSansFrais"]),
                       _f(ind["Actes"]), _p(ind["TauxRecours"]) if eff_police[police] else "-", _f(ind["Reclame"]), _f(ind["Rembourse"]),
                       _f(ind["CoutParBeneficiaire"]), _f(ind["CoutParActe"]), _frequence(ind["Frequence"])))
    r.tableau("Indicateurs clés par entreprise", ["Entreprise", "Effectif", "Bénéf. avec frais", "Absents de l'effectif avec frais", "Présents sans frais",
                                                  "Actes", "Taux de recours", "Réclamé", "Remboursé", "Coût / bénéf.", "Coût / acte", "Fréquence"], lignes,
              total=(TOTAL, _f(portefeuille["Effectif"]), _f(portefeuille["Consommants"]), _f(portefeuille["Absents"]), _f(portefeuille["PresentsSansFrais"]),
                     _f(portefeuille["Actes"]), _p(portefeuille["TauxRecours"]), _f(portefeuille["Reclame"]), _f(portefeuille["Rembourse"]),
                     _f(portefeuille["CoutParBeneficiaire"]), _f(portefeuille["CoutParActe"]), _frequence(portefeuille["Frequence"])))
    r.para("Taux de recours : bénéficiaires ayant exposé des frais rapportés à l'effectif ; fréquence : actes par bénéficiaire ayant exposé des frais. "
           "« Absents de l'effectif avec frais » : bénéficiaires du relevé inconnus de l'effectif importé, à faire régulariser par le gestionnaire.",
           italique=True)


def _genres(prestations):
    groupes = {g["Libelle"]: g for g in repartition(prestations, lambda p: GENRES.get(p["genre"], "Non renseigné"))}
    return [groupes[l] for l in ("Masculin", "Féminin", "Non renseigné") if l in groupes]


def _prescripteur_executant(r, prestations):
    """Analyse comparative des dépenses selon le centre prescripteur et le centre exécutant (attentes, point II.3)."""
    def lien(p):
        prescripteur, executant = normaliser(p["centre_prescripteur"] or ""), normaliser(p["centre_executant"] or "")
        if not prescripteur:
            return "Non renseigné"
        return "Prescrit et exécuté dans le même centre" if prescripteur == executant else "Prescrit et exécuté dans des centres différents"

    groupes = repartition(prestations, lien)
    r.repartition("Dépenses selon le centre prescripteur et le centre exécutant", "Prescription et exécution", groupes, total=True)
    r.graphique("Dépenses selon le centre prescripteur et le centre exécutant", graphiques.anneau([(g["Libelle"], g["Depenses"]) for g in groupes]))
    couples = repartition([p for p in prestations if p["centre_prescripteur"] and normaliser(p["centre_prescripteur"]) != normaliser(p["centre_executant"] or "")],
                          lambda p: f"{p['centre_prescripteur']} > {p['centre_executant']}")[:20]
    r.tableau("Dépenses prescrites par un centre et exécutées par un autre, 20 premiers couples", ["Prescripteur > exécutant", "Dépenses", "% des dépenses", "Nombre d'actes", "Coût moyen par acte"],
              [(g["Libelle"], _f(g["Depenses"]), _p(g["Part"]), _f(g["Actes"]), _f(g["CoutParActe"])) for g in couples])


def _graphique_repartition(r, legende, groupes, forme="barres"):
    libelles, depenses = [g["Libelle"] for g in groupes], [g["Depenses"] for g in groupes]
    if forme == "anneau":
        r.graphique(legende, graphiques.anneau(list(zip(libelles, depenses))))
    elif forme == "colonnes":
        r.graphique(legende, graphiques.colonnes(libelles, depenses))
    else:
        r.graphique(legende, graphiques.barres(libelles, depenses))


def _famille_tranche_graphique(r, prestations, au):
    """Dépenses par tranche d'âge, empilées par type de prestation : les 3 plus coûteux, les autres regroupés."""
    familles = [g["Libelle"] for g in repartition(prestations, lambda p: p["famille"])]
    retenues = familles[:3]
    tranches = [t[2] for t in TRANCHES]
    series = {f: defaultdict(lambda: ZERO) for f in retenues + ["Autres"]}
    for p in prestations:
        f = p["famille"] if p["famille"] in retenues else "Autres"
        series[f][tranche(_age(p["date_naissance"], au))] += p["mt_rembourse"]
    presentes = [t for t in tranches + ["Non renseigné"] if any(series[f][t] for f in series)]
    r.graphique("Répartition des dépenses par type de prestation et par tranche d'âge",
                graphiques.empilees(presentes, [(f, [float(series[f][t]) for t in presentes]) for f in retenues + (["Autres"] if len(familles) > 3 else [])],
                                    horizontal=False))


def _depenses(r, prestations, effectif, au, exercice, numero="II"):
    """Analyse des dépenses de santé (attentes, deuxième module) : indicateurs du portefeuille et par entreprise, structure des dépenses,
    principaux acteurs et centres médicaux."""
    actifs = [e for e in effectif if e["actif"]]
    portefeuille = _indicateurs(prestations, actifs, {e["matricule_beneficiaire"] for e in effectif}, au)
    r.titre(f"{numero}.1. Indicateurs clés", 2)
    _indicateurs_tableau(r, "Indicateurs clés du portefeuille", portefeuille, "Effectif total assuré")
    _indicateurs_par_entreprise(r, prestations, effectif, au, portefeuille)

    r.titre(f"{numero}.2. Structure des dépenses", 2)
    mensuel = defaultdict(lambda: [ZERO, 0])
    for p in prestations:
        m = mensuel[(p["date_cloture"].year, p["date_cloture"].month)]
        m[0] += p["mt_rembourse"]
        m[1] += 1
    total = sum((v[0] for v in mensuel.values()), ZERO)
    mois = sorted(mensuel.items())
    r.tableau(f"Dépenses mensuelles {exercice}", ["Mois", "Dépenses", "% des dépenses", "Nombre d'actes", "% des actes", "Coût moyen par acte"],
              [(f"{MOIS[m - 1]} {a}", _f(v[0]), _p(_div(v[0], total)), _f(v[1]), _p(_div(v[1], len(prestations))), _f(_div(v[0], v[1])))
               for (a, m), v in mois],
              total=(TOTAL, _f(total), _p(1), _f(len(prestations)), _p(1), _f(_div(total, len(prestations)))))
    r.graphique(f"Dépenses mensuelles {exercice}", graphiques.colonnes([f"{MOIS[m - 1]} {a}" for (a, m), _v in mois], [float(v[0]) for _k, v in mois]))
    par_entreprise = repartition(prestations, lambda p: p["police"])
    r.tableau("Répartition des dépenses par entreprise", ["Entreprise", "Bénéficiaires", "Dépenses", "% des dépenses", "Nombre d'actes", "Coût moyen par bénéficiaire", "Coût moyen par acte"],
              [(g["Libelle"], _f(g["Beneficiaires"]), _f(g["Depenses"]), _p(g["Part"]), _f(g["Actes"]), _f(_div(g["Depenses"], g["Beneficiaires"])), _f(g["CoutParActe"]))
               for g in par_entreprise],
              total=(TOTAL, _f(portefeuille["Consommants"]), _f(total), _p(1), _f(len(prestations)), _f(portefeuille["CoutParBeneficiaire"]), _f(portefeuille["CoutParActe"])))
    _graphique_repartition(r, "Répartition des dépenses par entreprise" + (", 25 premières" if len(par_entreprise) > 25 else ""), par_entreprise)
    familles = repartition(prestations, lambda p: p["famille"])
    r.repartition("Répartition des dépenses par type de prestation", "Type de prestation", familles, total=True)
    _graphique_repartition(r, "Répartition des dépenses par type de prestation", familles)
    statuts = _ordre_statuts(repartition(prestations, lambda p: _statut(p["statut"])))
    r.repartition("Répartition des dépenses par statut", "Statut", statuts, total=True)
    _graphique_repartition(r, "Répartition des dépenses par statut", statuts, "anneau")
    tranches = ordre_des_tranches(repartition(prestations, lambda p: tranche(_age(p["date_naissance"], au))))
    r.repartition("Répartition des dépenses par tranche d'âge", "Tranche d'âge", tranches, total=True)
    _graphique_repartition(r, "Répartition des dépenses par tranche d'âge", tranches, "colonnes")
    _famille_tranche(r, "Répartition des dépenses par type de prestation et par tranche d'âge", prestations, au)
    _famille_tranche_graphique(r, prestations, au)
    genres = _genres(prestations)
    r.repartition("Répartition des dépenses par genre", "Genre", genres, total=True)
    _graphique_repartition(r, "Répartition des dépenses par genre", genres, "anneau")
    sans_genre = qualite.garants_sans_genre(effectif)
    if sans_genre:
        r.para(f"Le fichier d'effectif du garant {', '.join(sans_genre)} ne donne pas le genre : les dépenses de ses bénéficiaires sont comptées "
               "« Non renseigné ».", italique=True)

    r.titre(f"{numero}.3. Principaux acteurs et centres médicaux", 2)
    for legende, cle, colonne in (("Top 20 des centres prescripteurs les plus coûteux", lambda p: p["centre_prescripteur"], "Centre prescripteur"),
                                  ("Top 20 des centres exécutants les plus coûteux", lambda p: p["centre_executant"], "Centre exécutant"),
                                  ("Top 20 des médecins les plus coûteux", lambda p: p["medecin"], "Médecin")):
        _top(r, legende, prestations, cle, colonne)
        _graphique_repartition(r, legende, repartition(prestations, cle)[:20])
    _prescripteur_executant(r, prestations)
    _familles_depensieres(r, "Familles dont le montant remboursé dépasse 1 000 000 F", prestations, seuil=Decimal("1000000"))
    return portefeuille


def _risque(r, prestations, effectif, au, numero="III"):
    """Analyse ciblée des entreprises à risque (attentes, troisième module) : sélection, puis pour chacune les axes des deux premiers modules."""
    r.titre(f"{numero}.1. Sélection des entreprises à risque", 2)
    r.para("Critères : coût moyen par acte supérieur de plus de 30 % à la moyenne du portefeuille ; plus de 10 actes par bénéficiaire ; score égal ou supérieur à 1 (entreprise critique). "
           "Le score est la moyenne des rapports à la moyenne du portefeuille du coût par bénéficiaire, du nombre d'actes par bénéficiaire et du coût par acte "
           "(formule proposée, à valider).")
    risque, _p_ = entreprises_a_risque(prestations, effectif, au)
    r.tableau("Indicateurs et score par entreprise", ["Entreprise", "Bénéf.", "Actes", "Dépenses", "Âge moyen", "Coût / bénéf.", "Actes / bénéf.", "Coût / acte", "Alerte", "Score"],
              [(l["Police"], _f(l["Beneficiaires"]), _f(l["Actes"]), _f(l["Depenses"]), _f(l["AgeMoyen"]), _f(l["CoutParBeneficiaire"]),
                "-" if l["ActesParBeneficiaire"] is None else f"{l['ActesParBeneficiaire']:.1f}".replace(".", ","), _f(l["CoutParActe"]), ", ".join(l["Alertes"]),
                f"{l['Score']:.2f}".replace(".", ",")) for l in risque])
    r.graphique("Score de risque par entreprise (en orange : entreprises à risque)",
                graphiques.barres([l["Police"] for l in risque], [l["Score"] for l in risque], format_valeur=lambda v: f"{v:.2f}".replace(".", ","),
                                  couleurs=[graphiques.COULEURS[1] if l["Alertes"] else graphiques.COULEURS[0] for l in risque]))
    a_risque = [l["Police"] for l in risque if l["Alertes"]][:FICHES_MAX]
    r.titre(f"{numero}.2. Analyse approfondie des entreprises à risque", 2)
    if not a_risque:
        r.para("Aucune entreprise ne répond aux critères sur la période.", italique=True)
    for police in a_risque:
        _fiche(r, police, prestations, effectif, au)


def produire(params):
    """Rapport Word selon les attentes de l'équipe actuariat (2026-11-11) : « effectifs » (premier module), « depenses » (deuxième module) ou
    « global » (les deux, puis l'analyse ciblée des entreprises à risque, le contrôle de gestion et les analyses complémentaires)."""
    nature = str(params.get("type") or "global").strip().lower()
    if nature not in TYPES_RAPPORT:
        raise ErreurConsommation("Rapport inconnu : effectifs, depenses ou global.")
    titre, fichier, _libelle = TYPES_RAPPORT[nature]
    with connection.cursor() as cursor:
        exercice, du, au, _exercices = _periode(cursor, params)
        garant = str(params.get("garant") or "").strip()
        prestations, effectif = charger(cursor, du, au, garant)
        reference, date_reference = effectif_de_reference(cursor, du, garant)
        situation = date_effectif(cursor)
        doublons = doublons_importes(cursor, garant)
    actifs = [e for e in effectif if e["actif"]]
    if nature == "effectifs" and not actifs:
        raise ErreurConsommation("Aucun effectif importé : importez d'abord l'effectif du gestionnaire.")
    if nature == "depenses" and not prestations:
        raise ErreurConsommation("Aucune prestation sur cette période : importez d'abord les relevés de consommation du gestionnaire.")
    if not prestations and not effectif:
        raise ErreurConsommation("Aucune donnée sur cette période : importez d'abord les relevés du gestionnaire.")
    r = Rapport()
    r.titre(f"{titre} {exercice} - OREOLE SANTÉ", 0)
    r.para(f"Du {_d(du)} au {_d(au)}" + (f" - garant {garant}" if garant else ""), centre=True)
    r.para("Source : relevés de prestations et effectif du gestionnaire importés dans LE PHARE ; mois et période selon la date de clôture du relevé ; "
           "âges à la fin de la période. Document contenant des données de santé : diffusion restreinte.", italique=True)

    if nature in ("effectifs", "global"):
        r.titre("I. ANALYSE DES EFFECTIFS", 1)
        r.para("Structure démographique de la population assurée, composition des familles et qualité des données transmises par le gestionnaire.")
        _effectifs(r, effectif, du, au, reference, date_reference, situation, exercice, "I", doublons)
    if nature in ("depenses", "global"):
        numero = "I" if nature == "depenses" else "II"
        r.titre(f"{numero}. ANALYSE DES DÉPENSES DE SANTÉ", 1)
        r.para("Consommation médicale, remboursements et structure des dépenses de santé du portefeuille.")
        _depenses(r, prestations, effectif, au, exercice, numero)
    if nature == "global":
        r.titre("III. ANALYSE CIBLÉE DES ENTREPRISES À RISQUE", 1)
        _risque(r, prestations, effectif, au, "III")
        bord = tableau_de_bord(params)
        if bord["CotisationsImportees"]:
            t = bord["Totaux"]
            r.titre(f"IV. CONTRÔLE DE GESTION {exercice}", 1)
            r.para("Provision pour paiement des dépenses de santé (état des cotisations) face à la consommation des relevés de l'exercice.")
            r.tableau("Pilotage global", ["Indicateur", "Montant"], [
                ("Primes HT", _f(t["PrimeHt"])), ("Cotisations santé pure", _f(t["CotisationPure"])), ("Honoraires du gestionnaire", _f(t["Honoraires"])),
                ("Commissions", _f(t["Commissions"])), ("Apporteurs d'affaires", _f(t["Apporteurs"])), ("Provisions pour paiement des dépenses", _f(t["Provision"])),
                ("Consommation", _f(t["Consommation"])), ("Reste sur les provisions", _f(t["Reste"])), ("Taux de consommation des provisions", _p(t["Taux"])),
                ("Entreprises", _f(t["Entreprises"])),
            ])
            # en-têtes courts : le tableau tient sur la largeur d'une page en portrait (dépenses = consommation des relevés)
            r.tableau("Contrôle de gestion par entreprise", ["Entreprise", "Police du gestionnaire", "Provision", "Dépenses", "Reste", "Taux", "État"],
                      [(l["Entreprise"] or "-", l["Police"] or "-", _f(l["Provision"]), _f(l["Consommation"]), _f(l["Reste"]), _p(l["Taux"]), l["Situation"])
                       for l in bord["Controle"]],
                      total=(TOTAL, "", _f(t["Provision"]), _f(t["Consommation"]), _f(t["Reste"]), _p(t["Taux"]), ""))
        if prestations:
            _analyses_complementaires(r, analyse_periode(params), "V" if bord["CotisationsImportees"] else "IV")
    _annexe_anomalies(r)
    return r.octets(), f"{fichier} {exercice} du {du:%d-%m-%Y} au {au:%d-%m-%Y}.docx", {"Exercice": exercice, "Du": du, "Au": au,
                                                                                        "Prestations": len(prestations), "Type": nature}


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_rapport(request):
    """GET /api/consommations/rapport/?type=effectifs|depenses|global&exercice=&du=&au=&garant= : rapport Word, seul export du suivi."""
    try:
        contenu, nom, resume = produire(request.query_params)
    except ErreurConsommation:
        return _reponse(produire, request.query_params)
    journaliser(request=request, module="consommations", action="consommations.rapport", objet_type="rapport_consommations", objet_id=str(resume["Exercice"]),
                description=f"Export du {TYPES_RAPPORT[resume['Type']][2]} des consommations santé du {resume['Du']:%d/%m/%Y} au {resume['Au']:%d/%m/%Y} "
                            f"({resume['Prestations']} prestations).")
    reponse = HttpResponse(contenu, content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    reponse["Content-Disposition"] = f'attachment; filename="{nom}"'
    return reponse
