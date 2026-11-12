"""
Graphiques du rapport Word des consommations santé (attentes de l'équipe actuariat du 2026-11-11 : « tableaux et graphiques »).

Dessinés avec Pillow (aucune dépendance de plus), en PNG haute définition insérés à 16 cm de large. Police Arial Narrow comme le texte du
rapport ; à défaut Liberation Sans Narrow ou DejaVu Sans (serveur Linux), sinon la police vectorielle de Pillow.
Palette validée de l'écran (index.css, --cs-viz-*, mode clair, le rapport s'imprime) : catégories toujours dans le même ordre (Assuré bleu,
Conjoint(e) orange, Enfant vert ; Masculin bleu, Féminin orange), gris pour « Non renseigné » et « Autres ». Barres fines aux extrémités
arrondies, fines séparations blanches entre segments empilés, grille discrète, valeurs écrites en encre (jamais dans la couleur de la série),
légende dès deux séries. Chaque fonction renvoie les octets du PNG, ou None sans donnée.
"""
import io
import math
import os
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

LARGEUR_CM = 16
PX_PAR_CM = 112.5                  # 1 800 px pour 16 cm, environ 285 points par pouce
LARGEUR = int(LARGEUR_CM * PX_PAR_CM)
COULEURS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
GRIS = "#a8a6a0"
ENCRE, ENCRE_2, GRILLE, AXE, FOND = "#111827", "#4b5563", "#e5e7eb", "#cbd5e1", "#ffffff"
NON_RENSEIGNE = {"Non renseigné", "Autres", "Autre"}
POLICES = {
    False: ["ARIALN.TTF", "arialn.ttf", "LiberationSansNarrow-Regular.ttf", "DejaVuSansCondensed.ttf", "DejaVuSans.ttf"],
    True: ["ARIALNB.TTF", "arialnb.ttf", "LiberationSansNarrow-Bold.ttf", "DejaVuSansCondensed-Bold.ttf", "DejaVuSans-Bold.ttf"],
}
DOSSIERS = [os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts"), "/usr/share/fonts/truetype/msttcorefonts",
            "/usr/share/fonts/truetype/liberation", "/usr/share/fonts/truetype/liberation2", "/usr/share/fonts/truetype/dejavu",
            "/usr/share/fonts/TTF", "/usr/share/fonts/dejavu", "/Library/Fonts"]
MARGE = 24


@lru_cache(maxsize=32)
def police(taille_pt, gras=False):
    px = max(8, round(taille_pt * 0.03528 * PX_PAR_CM))
    for nom in POLICES[gras]:
        for dossier in DOSSIERS:
            chemin = os.path.join(dossier, nom)
            if os.path.exists(chemin):
                return ImageFont.truetype(chemin, px)
    try:
        return ImageFont.load_default(size=px)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def nombre(v):
    return f"{round(v or 0):,}".replace(",", " ")


def pourcent(v):
    return f"{(v or 0) * 100:.1f} %".replace(".", ",")


def _largeur(texte, fonte):
    return fonte.getbbox(texte)[2] if texte else 0


def _couper(texte, fonte, largeur):
    """Texte tenu dans la largeur : coupé avec « … » au besoin."""
    if _largeur(texte, fonte) <= largeur:
        return texte
    while texte and _largeur(texte + "…", fonte) > largeur:
        texte = texte[:-1]
    return texte.rstrip() + "…"


def _lignes(texte, fonte, largeur, maximum=2):
    """Texte réparti sur deux lignes au plus (libellés sous les colonnes)."""
    mots, lignes, courante = str(texte).split(), [], ""
    for mot in mots:
        essai = f"{courante} {mot}".strip()
        if _largeur(essai, fonte) <= largeur or not courante:
            courante = essai
        else:
            lignes.append(courante)
            courante = mot
    lignes.append(courante)
    if len(lignes) > maximum:
        lignes = lignes[:maximum - 1] + [_couper(" ".join(lignes[maximum - 1:]), fonte, largeur)]
    return [_couper(l, fonte, largeur) for l in lignes]


def couleur_de(libelle, rang):
    return GRIS if libelle in NON_RENSEIGNE else COULEURS[rang % len(COULEURS)]


def _png(image):
    tampon = io.BytesIO()
    image.save(tampon, format="PNG", optimize=True, dpi=(round(PX_PAR_CM * 2.54), round(PX_PAR_CM * 2.54)))
    return tampon.getvalue()


def _barre(dessin, x0, y0, x1, y1, couleur, rayon=8, cote="droite"):
    """Rectangle à l'extrémité arrondie (côté valeur), ancré sur la ligne de base."""
    if x1 - x0 < 1 or y1 - y0 < 1:
        return
    rayon = max(0, min(rayon, (x1 - x0) / 2, (y1 - y0) / 2))
    dessin.rounded_rectangle([x0, y0, x1, y1], radius=rayon, fill=couleur)
    # côté de la ligne de base à angles droits
    if cote == "droite":
        dessin.rectangle([x0, y0, min(x1, x0 + rayon), y1], fill=couleur)
    else:  # haut : base en bas
        dessin.rectangle([x0, max(y0, y1 - rayon), x1, y1], fill=couleur)


def _legende(dessin, series, y, x=MARGE):
    fonte = police(9)
    for rang, (nom, couleur) in enumerate(series):
        dessin.rounded_rectangle([x, y + 8, x + 30, y + 38], radius=6, fill=couleur)
        dessin.text((x + 42, y), nom, font=fonte, fill=ENCRE_2)
        x += 42 + _largeur(nom, fonte) + 48
    return y + 56


def barres(libelles, valeurs, format_valeur=nombre, couleur=None, couleurs=None, maximum=25):
    """Barres horizontales triées par l'appelant ; au-delà de « maximum » libellés, le reste est regroupé dans « Autres »."""
    donnees = [(str(l or "Non renseigné"), float(v or 0)) for l, v in zip(libelles, valeurs)]
    if not donnees or not any(v for _l, v in donnees):
        return None
    if len(donnees) > maximum:
        donnees = donnees[:maximum - 1] + [("Autres", sum(v for _l, v in donnees[maximum - 1:]))]
    fonte, fonte_valeur = police(9), police(9)
    pas, epaisseur = 64, 38
    hauteur = MARGE * 2 + pas * len(donnees)
    image = Image.new("RGB", (LARGEUR, hauteur), FOND)
    dessin = ImageDraw.Draw(image)
    colonne = min(int(LARGEUR * 0.42), max(_largeur(l, fonte) for l, _v in donnees) + 16)
    textes = [format_valeur(v) for _l, v in donnees]
    reserve = max(_largeur(t, fonte_valeur) for t in textes) + 24
    x0, x1 = MARGE + colonne, LARGEUR - MARGE - reserve
    haut = max(v for _l, v in donnees) or 1
    for graduation in range(1, 5):
        x = x0 + (x1 - x0) * graduation / 4
        dessin.line([x, MARGE, x, hauteur - MARGE], fill=GRILLE, width=2)
    dessin.line([x0, MARGE - 4, x0, hauteur - MARGE + 4], fill=AXE, width=2)
    for rang, ((libelle, valeur), texte) in enumerate(zip(donnees, textes)):
        y = MARGE + rang * pas
        dessin.text((MARGE + colonne - 16, y + pas / 2), _couper(libelle, fonte, colonne - 16), font=fonte, fill=ENCRE, anchor="rm")
        fin = x0 + (x1 - x0) * max(valeur, 0) / haut
        teinte = GRIS if libelle in NON_RENSEIGNE else (couleurs[rang] if couleurs else couleur or COULEURS[0])
        _barre(dessin, x0, y + (pas - epaisseur) / 2, fin, y + (pas + epaisseur) / 2, teinte)
        dessin.text((fin + 12, y + pas / 2), texte, font=fonte_valeur, fill=ENCRE_2, anchor="lm")
    return _png(image)


def colonnes(libelles, valeurs, format_valeur=nombre, couleur=None, hauteur_trace=620):
    """Colonnes verticales (tranches d'âge, mois) ; valeur au-dessus de chaque colonne."""
    donnees = [(str(l or "Non renseigné"), float(v or 0)) for l, v in zip(libelles, valeurs)]
    if not donnees or not any(v for _l, v in donnees):
        return None
    fonte, fonte_valeur = police(8.5), police(8.5)
    pas = (LARGEUR - 2 * MARGE) / len(donnees)
    lignes = [_lignes(l, fonte, pas - 10) for l, _v in donnees]
    hauteur_libelles = 40 * max(len(l) for l in lignes) + 16
    haut_trace = MARGE + 50
    hauteur = haut_trace + hauteur_trace + hauteur_libelles + MARGE
    image = Image.new("RGB", (LARGEUR, int(hauteur)), FOND)
    dessin = ImageDraw.Draw(image)
    base = haut_trace + hauteur_trace
    haut = max(v for _l, v in donnees) or 1
    for graduation in range(1, 5):
        y = base - hauteur_trace * graduation / 4
        dessin.line([MARGE, y, LARGEUR - MARGE, y], fill=GRILLE, width=2)
    dessin.line([MARGE, base, LARGEUR - MARGE, base], fill=AXE, width=2)
    epaisseur = min(pas * 0.56, 120)
    for rang, ((libelle, valeur), texte) in enumerate(zip(donnees, lignes)):
        centre = MARGE + pas * (rang + 0.5)
        sommet = base - hauteur_trace * max(valeur, 0) / haut
        teinte = GRIS if libelle in NON_RENSEIGNE else couleur or COULEURS[0]
        _barre(dessin, centre - epaisseur / 2, sommet, centre + epaisseur / 2, base, teinte, cote="haut")
        dessin.text((centre, sommet - 10), format_valeur(valeur), font=fonte_valeur, fill=ENCRE_2, anchor="ms")
        for n, ligne in enumerate(texte):
            dessin.text((centre, base + 14 + 40 * n), ligne, font=fonte, fill=ENCRE, anchor="ma")
    return _png(image)


def empilees(libelles, series, format_total=nombre, horizontal=True, maximum=20):
    """Barres empilées : series = [(nom, [valeurs par libellé])] dans l'ordre fixe des catégories ; total écrit au bout de chaque barre."""
    series = [(nom, [float(v or 0) for v in vals]) for nom, vals in series if any(vals)]
    if not libelles or not series:
        return None
    libelles = [str(l or "Non renseigné") for l in libelles][:maximum]
    totaux = [sum(vals[i] for _n, vals in series) for i in range(len(libelles))]
    couleurs = [couleur_de(nom, rang) for rang, (nom, _v) in enumerate(series)]
    fonte = police(9)
    image = Image.new("RGB", (LARGEUR, 10), FOND)
    haut = max(totaux) or 1
    if horizontal:
        pas, epaisseur = 64, 38
        hauteur = MARGE + 56 + pas * len(libelles) + MARGE
        image = Image.new("RGB", (LARGEUR, hauteur), FOND)
        dessin = ImageDraw.Draw(image)
        y_trace = _legende(dessin, zip([n for n, _v in series], couleurs), MARGE)
        colonne = min(int(LARGEUR * 0.40), max(_largeur(l, fonte) for l in libelles) + 16)
        reserve = max(_largeur(format_total(t), fonte) for t in totaux) + 24
        x0, x1 = MARGE + colonne, LARGEUR - MARGE - reserve
        for graduation in range(1, 5):
            x = x0 + (x1 - x0) * graduation / 4
            dessin.line([x, y_trace, x, hauteur - MARGE], fill=GRILLE, width=2)
        dessin.line([x0, y_trace - 4, x0, hauteur - MARGE + 4], fill=AXE, width=2)
        for i, libelle in enumerate(libelles):
            y = y_trace + i * pas
            dessin.text((x0 - 16, y + pas / 2), _couper(libelle, fonte, colonne - 16), font=fonte, fill=ENCRE, anchor="rm")
            x = x0
            for rang, (_nom, vals) in enumerate(series):
                largeur = (x1 - x0) * vals[i] / haut
                if largeur >= 1:
                    dernier = all(not s[1][i] for s in series[rang + 1:])
                    _barre(dessin, x, y + (pas - epaisseur) / 2, x + largeur - (0 if dernier else 3), y + (pas + epaisseur) / 2, couleurs[rang],
                           rayon=8 if dernier else 0)
                    x += largeur
            dessin.text((x + 12, y + pas / 2), format_total(totaux[i]), font=fonte, fill=ENCRE_2, anchor="lm")
        return _png(image)
    # colonnes empilées
    pas = (LARGEUR - 2 * MARGE) / len(libelles)
    lignes = [_lignes(l, police(8.5), pas - 10) for l in libelles]
    hauteur_trace = 620
    hauteur = MARGE + 56 + 50 + hauteur_trace + 40 * max(len(l) for l in lignes) + 16 + MARGE
    image = Image.new("RGB", (LARGEUR, int(hauteur)), FOND)
    dessin = ImageDraw.Draw(image)
    y_trace = _legende(dessin, zip([n for n, _v in series], couleurs), MARGE) + 50
    base = y_trace + hauteur_trace
    for graduation in range(1, 5):
        y = base - hauteur_trace * graduation / 4
        dessin.line([MARGE, y, LARGEUR - MARGE, y], fill=GRILLE, width=2)
    dessin.line([MARGE, base, LARGEUR - MARGE, base], fill=AXE, width=2)
    epaisseur = min(pas * 0.56, 120)
    for i, libelle in enumerate(libelles):
        centre = MARGE + pas * (i + 0.5)
        y = base
        for rang, (_nom, vals) in enumerate(series):
            h = hauteur_trace * vals[i] / haut
            if h >= 1:
                dernier = all(not s[1][i] for s in series[rang + 1:])
                _barre(dessin, centre - epaisseur / 2, y - h + (0 if dernier else 3), centre + epaisseur / 2, y, couleurs[rang], rayon=8 if dernier else 0,
                       cote="haut")
                y -= h
        dessin.text((centre, y - 10), format_total(totaux[i]), font=police(8.5), fill=ENCRE_2, anchor="ms")
        for n, ligne in enumerate(lignes[i]):
            dessin.text((centre, base + 14 + 40 * n), ligne, font=police(8.5), fill=ENCRE, anchor="ma")
    return _png(image)


def anneau(parts, format_valeur=nombre):
    """Part de chaque catégorie (4 au plus, dans l'ordre fixe) : anneau à gauche, légende avec valeurs et parts à droite."""
    parts = [(str(l or "Non renseigné"), float(v or 0)) for l, v in parts if v]
    total = sum(v for _l, v in parts)
    if not parts or not total:
        return None
    hauteur = 640
    image = Image.new("RGB", (LARGEUR, hauteur), FOND)
    dessin = ImageDraw.Draw(image)
    rayon, cx, cy = 270, MARGE + 300, hauteur / 2
    angle = -90.0
    rang_couleur = 0
    for libelle, valeur in parts:
        couleur = GRIS if libelle in NON_RENSEIGNE else COULEURS[rang_couleur % len(COULEURS)]
        rang_couleur += 0 if libelle in NON_RENSEIGNE else 1
        etendue = 360 * valeur / total
        dessin.pieslice([cx - rayon, cy - rayon, cx + rayon, cy + rayon], angle, angle + etendue, fill=couleur)
        if len(parts) > 1:  # séparation blanche entre les parts
            for a in (angle,):
                x, y = cx + rayon * math.cos(math.radians(a)), cy + rayon * math.sin(math.radians(a))
                dessin.line([cx, cy, x, y], fill=FOND, width=6)
        angle += etendue
    dessin.ellipse([cx - rayon * 0.58, cy - rayon * 0.58, cx + rayon * 0.58, cy + rayon * 0.58], fill=FOND)
    dessin.text((cx, cy - 6), format_valeur(total), font=police(11, True), fill=ENCRE, anchor="ms")
    dessin.text((cx, cy + 40), "au total", font=police(8.5), fill=ENCRE_2, anchor="ms")
    x, y = cx + rayon + 110, cy - len(parts) * 52
    rang_couleur = 0
    for libelle, valeur in parts:
        couleur = GRIS if libelle in NON_RENSEIGNE else COULEURS[rang_couleur % len(COULEURS)]
        rang_couleur += 0 if libelle in NON_RENSEIGNE else 1
        dessin.rounded_rectangle([x, y + 12, x + 34, y + 46], radius=7, fill=couleur)
        dessin.text((x + 52, y), _couper(libelle, police(10, True), LARGEUR - x - 80), font=police(10, True), fill=ENCRE)
        dessin.text((x + 52, y + 50), f"{format_valeur(valeur)} - {pourcent(valeur / total)}", font=police(9), fill=ENCRE_2)
        y += 104
    return _png(image)
