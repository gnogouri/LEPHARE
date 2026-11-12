"""
Lecture des questionnaires remplis par les clients (GET crm/questionnaires/recus/<id>/lecture/).

Word (.docx) : le questionnaire rempli est comparé, ligne par ligne, au modèle vierge du même questionnaire. Ce que
le client a ajouté (sur les pointillés, dans une case vide d'un tableau, après un libellé) est une réponse, rattachée
au libellé qui la précède ; une case cochée (case Word cliquable, ou □ remplacé par X, ☒, ■, ✓) donne l'option
choisie. La lecture ne dépend donc pas de la mise en page de chaque questionnaire.
Excel (.xlsx) : tableau lu sous sa ligne d'en-tête (véhicules : lecteur du formulaire auto de l'import flotte).
PDF, photos et .doc ne se lisent pas : le commercial reprend les informations à la main.

Le résultat donne, pour l'écran : le souscripteur, les réponses par rubrique, les tableaux, et pour le devis de la
branche les données à reprendre (véhicules, assurés, adhérents, capitaux…).
"""

import difflib
import io
import re
import unicodedata
import zipfile
from datetime import date, datetime
from functools import lru_cache

from lxml import etree

from .questionnaires import PAR_CODE, chemin_modele, extension

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
W14 = "{http://schemas.microsoft.com/office/word/2010/wordml}"
MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"

VIDE, COCHE, BORD, POINTS = "☐", "☒", "‖", "⁂"
# Cases dessinées par un caractère : vides (□, Wingdings o / ¨, Segoe UI Symbol) et cochées (☒, ■, ✓, Wingdings þ…)
CASES_VIDES = set("□☐▢◻◽❏❑❒")
CASES_COCHEES = set("☒☑■▣✓✔✗✘⊠⌧")
MARQUES_X = {"x", "X", "✓", "✔", "■", "☒", "☑", "⊠", "oui"}
POINTILLES = re.compile(r"(?:[.…_·]{3,}|…+[.…_·]*|_{2,})")
TITRE = re.compile(r"^\s*(?:[IVX]{1,4}\s*[/.\-–]|\d{1,2}\s*[-–]\s*\d*|[A-H]\s*/|\d{1,2}\s*\)|\d-\d)")
MOTS_SUITE = re.compile(r"^(si oui|si non|lequel|laquelle|lesquels|lesquelles|pr[ée]cis|nature|quantit|nombre|usage|stockage|fr[ée]quence|pression|distance|dans l.affirmative)", re.I)


class LectureImpossible(Exception):
    pass


def _norme(texte):
    texte = str(texte or "").replace("—", " - ").replace("–", "-").replace("’", "'")
    texte = unicodedata.normalize("NFD", texte).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", texte).strip().lower()


def _mots(texte):
    return [m for m in re.findall(r"[a-z0-9]+", _norme(texte)) if len(m) > 1 or m.isdigit()]


# ---------------------------------------------------------------- Word : lignes du document
def _texte_paragraphe(p):
    """Texte propre au paragraphe (cases normalisées en ☐ / ☒) et zones de texte qu'il ancre."""
    morceaux, zones = [], []

    def visiter(e):
        for x in e:
            t = x.tag
            if not isinstance(t, str) or t in (MC + "Fallback", W + "del", W + "pPr", W + "rPr", W + "instrText"):
                continue
            if t == W + "txbxContent":
                zones.append(x)
            elif t == W + "sdt" and x.find(f".//{W14}checkbox") is not None:
                # Case Word cliquable : état « coché », ou symbole coché saisi dans la case
                coche = x.find(f".//{W14}checkbox/{W14}checked")
                symbole = "".join(e.text or "" for e in x.iter(W + "t"))
                morceaux.append(COCHE if (coche is not None and coche.get(W14 + "val") in ("1", "true"))
                                or any(c in CASES_COCHEES for c in symbole) else VIDE)
            elif t == W + "t":
                morceaux.append(x.text or "")
            elif t == W + "tab":
                morceaux.append("    ")
            elif t in (W + "br", W + "cr"):
                morceaux.append(" ")
            elif t == W + "sym" and x.get(W + "char"):
                morceaux.append(chr(0xF000 | (int(x.get(W + "char"), 16) & 0xFF)))
            else:
                visiter(x)

    visiter(p)
    texte = "".join(VIDE if c in CASES_VIDES else COCHE if c in CASES_COCHEES else c for c in "".join(morceaux))
    return texte, zones


def _cellule(tc, lignes_imbriquees):
    textes = []
    for x in tc:
        if x.tag == W + "p":
            t, zones = _texte_paragraphe(x)
            textes.append(t)
            for z in zones:
                _blocs(z, lignes_imbriquees)
        elif x.tag == W + "tbl":
            _table(x, lignes_imbriquees)
        elif x.tag == W + "sdt":
            contenu = x.find(W + "sdtContent")
            if contenu is not None:
                textes.append(_cellule(contenu, lignes_imbriquees))
    return " ".join(t.strip() for t in textes if t.strip())


def _table(tbl, blocs):
    lignes = [tr for tr in tbl.iter(W + "tr") if tr.getparent() is tbl or tr.getparent().getparent() is tbl]
    entete, libelle_precedent = None, ""
    for rang, tr in enumerate(lignes):
        imbriquees = []
        cellules = [_cellule(tc, imbriquees) for tc in tr if tc.tag == W + "tc"]
        if entete is None and rang < 3 and sum(1 for c in cellules if c.strip()) >= 2 and not any(
                POINTILLES.search(c) or VIDE in c or COCHE in c for c in cellules):
            entete = cellules
        # Libellé de la ligne : première case qui a du texte (ni repère ni case à cocher)
        libelle = next((_libelle(c) for c in cellules if re.search(r"[A-Za-z0-9]", _norme(POINTILLES.sub(" ", c)))
                        and VIDE not in c and COCHE not in c), "")
        if not libelle and not any(c.strip() for c in cellules):
            libelle = libelle_precedent
        libelle_precedent = libelle or libelle_precedent
        blocs.append({"type": "ligne", "cellules": cellules, "entete": entete, "libelle_ligne": libelle})
        blocs.extend(imbriquees)


def _blocs(element, blocs):
    for x in element:
        if x.tag == W + "p":
            texte, zones = _texte_paragraphe(x)
            blocs.append({"type": "p", "texte": texte})
            for z in zones:
                _blocs(z, blocs)
        elif x.tag == W + "tbl":
            _table(x, blocs)
        elif isinstance(x.tag, str) and x.tag not in (W + "sectPr", MC + "Fallback"):
            _blocs(x, blocs)
    return blocs


# Fichiers des clients : XML lu sans entités, DTD ni accès réseau (XXE, « billion laughs »), taille décompressée bornée
PARSEUR_XML = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, dtd_validation=False,
                              huge_tree=False)
TAILLE_MAX_XML = 30 * 1024 * 1024


def lignes_docx(contenu):
    try:
        with zipfile.ZipFile(io.BytesIO(contenu)) as z:
            info = z.getinfo("word/document.xml")
            if info.file_size > TAILLE_MAX_XML:
                raise LectureImpossible("Document Word trop volumineux pour être lu.")
            xml = z.read(info)
        if b"<!DOCTYPE" in xml[:4096].upper() or b"<!ENTITY" in xml.upper():
            raise LectureImpossible("Document Word refusé : déclaration DOCTYPE ou ENTITY.")
        racine = etree.fromstring(xml, PARSEUR_XML)
    except LectureImpossible:
        raise
    except Exception:  # noqa: BLE001
        raise LectureImpossible("Document Word illisible : enregistrez-le au format .docx.")
    return _blocs(racine.find(W + "body"), [])


# ---------------------------------------------------------------- jetons d'un texte
SPECIAUX = (VIDE, COCHE, POINTS)


def _jetons_texte(texte):
    """Jetons d'un texte : mots, ☐, ☒, ⁂ (pointillés) ; chacun avec l'espace qui le précède."""
    texte = POINTILLES.sub(f" {POINTS} ", texte or "")
    jetons = []
    for m in re.finditer(rf"[{VIDE}{COCHE}{POINTS}]|[^\s{VIDE}{COCHE}{POINTS}]+", texte):
        avant = texte[:m.start()]
        jetons.append((m.group(), len(avant) - len(avant.rstrip(" \t "))))
    return jetons


def _texte_bloc(bloc):
    return bloc["texte"] if bloc["type"] == "p" else "  ".join(bloc["cellules"])


def _cle(jeton):
    j = jeton[0]
    return j if j in SPECIAUX else _norme(j).strip(":;,.")


def _cles(texte):
    return [k for k in (_cle(j) for j in _jetons_texte(texte)) if k]


def _libelle(texte):
    texte = POINTILLES.sub(" ", texte or "")
    texte = re.sub(r"\s+", " ", texte).strip(" :;-–•▪» ▼")
    return texte[:160]


# ---------------------------------------------------------------- alignement modèle / questionnaire rempli
def _mots_libelle(bloc):
    return set(_mots(POINTILLES.sub(" ", _texte_bloc(bloc)).replace(VIDE, " ").replace(COCHE, " ")))


def _aligner(modele, rempli):
    """Couples (i modèle, j rempli) par programmation dynamique : les libellés du modèle se retrouvent dans la ligne
    remplie, à laquelle le client n'a fait qu'ajouter ses réponses."""
    mm = [_mots_libelle(b) for b in modele]
    mr = [set(_mots(_texte_bloc(b))) for b in rempli]

    def score(i, j):
        if modele[i]["type"] != rempli[j]["type"]:
            return 0
        if modele[i]["type"] == "ligne" and len(modele[i]["cellules"]) != len(rempli[j]["cellules"]):
            return 0
        if not mm[i]:
            return 0.2 if not mr[j] or modele[i]["type"] == "ligne" else 0.05
        part = len(mm[i] & mr[j]) / len(mm[i])
        return part if part >= 0.6 else 0

    n, m = len(modele), len(rempli)
    largeur = max(40, abs(n - m) + 40)
    meilleur = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            if abs(i - j) > largeur:
                meilleur[i][j] = max(meilleur[i + 1][j], meilleur[i][j + 1])
                continue
            s = score(i, j)
            meilleur[i][j] = max(meilleur[i + 1][j], meilleur[i][j + 1], (s + meilleur[i + 1][j + 1]) if s else 0)
    couples, i, j = [], 0, 0
    while i < n and j < m:
        s = score(i, j) if abs(i - j) <= largeur else 0
        if s and meilleur[i][j] == s + meilleur[i + 1][j + 1]:
            couples.append((i, j))
            i, j = i + 1, j + 1
        elif meilleur[i + 1][j] >= meilleur[i][j + 1]:
            i += 1
        else:
            j += 1
    return couples


# ---------------------------------------------------------------- réponses d'un texte (paragraphe ou case)
def _options(jm):
    """Cases du modèle : {indice de la case: texte de l'option} et la question (mots qui précèdent la première
    option). La case va avec les mots dont elle est la plus proche : « Oui □  Non □ » ou « □ 100 %   □ 90 % »."""
    cases = [k for k, (j, _) in enumerate(jm) if j == VIDE]
    if not cases:
        return {}, ""
    bornes = set(cases) | {k for k, (j, _) in enumerate(jm) if j == POINTS}
    options, premiers = {}, {}
    for k in cases:
        apres, x = [], k + 1
        while x < len(jm) and x not in bornes and len(apres) < 6:
            apres.append(x)
            x += 1
        avant, x = [], k - 1
        while x >= 0 and x not in bornes and len(avant) < 6:
            avant.insert(0, x)
            x -= 1
        ecart_apres = jm[k + 1][1] if apres else 99
        ecart_avant = jm[k][1] if avant else 99
        if apres and (ecart_apres <= ecart_avant or not avant):
            cote = apres
            # « □ Côte d'Ivoire      □ Monde » : l'option s'arrête au grand espace
            for rang in range(1, len(apres)):
                if jm[apres[rang]][1] > 2:
                    cote = apres[:rang]
                    break
        else:
            cote = avant[-1:]
            for x in range(len(avant) - 2, -1, -1):
                if jm[avant[x + 1]][1] > 2 or len(cote) >= 3:
                    break
                cote.insert(0, avant[x])
        options[k] = " ".join(jm[x][0] for x in cote)
        premiers[k] = min(cote + [k])
    fin_question = premiers[cases[0]]
    debut_question = max([k for k in range(fin_question) if jm[k][0] == POINTS] + [-1]) + 1
    question = " ".join(j for j, _ in jm[debut_question:fin_question] if j not in SPECIAUX)
    return options, question


def _reponses_texte(texte_m, texte_r, libelle_defaut=""):
    """Réponses d'un texte du modèle rempli par le client : [(libellé, valeur, genre « texte » | « choix »)]."""
    tm, tr = _jetons_texte(texte_m), _jetons_texte(texte_r)
    km, kr = [_cle(j) for j in tm], [_cle(j) for j in tr]
    options, question = _options(tm)
    cochees, ajouts = set(), {}
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, km, kr, autojunk=False).get_opcodes():
        if op == "equal":
            cochees.update(a for a, b in zip(range(i1, i2), range(j1, j2)) if km[a] == VIDE and kr[b] == COCHE)
            continue
        cases_m = [k for k in range(i1, i2) if km[k] == VIDE]
        marques = [b for b in range(j1, j2) if kr[b] == COCHE or tr[b][0] in MARQUES_X]
        cochees.update(k for k, _ in zip(cases_m, marques))
        # « Oui X □ » : marque tapée à côté d'une case restée vide
        if not cases_m and marques:
            proche = next((k for k in (i1, i1 - 1) if 0 <= k < len(km) and km[k] == VIDE), None)
            if proche is not None:
                cochees.add(proche)
        mots = [tr[b][0] for b in range(j1, j2)
                if kr[b] not in SPECIAUX and kr[b] and not (b in marques and tr[b][0] in MARQUES_X)]
        if not mots:
            continue
        # Champ rempli : les pointillés remplacés, sinon ceux qui précèdent (saisie après), sinon ceux qui suivent
        cible = next((k for k in range(i1, i2) if km[k] == POINTS), None)
        if cible is None:
            precedent = next((k for k in range(i1 - 1, -1, -1) if km[k] in (POINTS, VIDE)), None)
            cible = precedent if precedent is not None and km[precedent] == POINTS else None
        if cible is None:
            cible = next((k for k in range(i1, len(km)) if km[k] == POINTS), -1)
        ajouts.setdefault(cible, []).extend(mots)
    reponses = []
    for cible, mots in ajouts.items():
        if cible == -1:
            libelle = " ".join(j for j, _ in tm if j not in SPECIAUX)
        else:
            debut = max([k for k in range(cible) if km[k] in SPECIAUX] + [-1]) + 1
            libelle = " ".join(j for j, _ in tm[debut:cible] if j not in SPECIAUX)
        valeur = re.sub(r"\s+", " ", " ".join(mots)).strip(" :;.")
        if valeur:
            reponses.append((_libelle(libelle) or libelle_defaut, valeur, "texte"))
    if cochees:
        choisies = [options.get(k, "") for k in sorted(cochees)]
        reponses.append((_libelle(question), ", ".join(dict.fromkeys(choisies)), "choix"))
    return reponses


def _a_des_lettres(texte):
    return bool(re.search(r"[a-z]{2}", _norme(texte)))


def _comparer_ligne(bm, br):
    """Réponses d'une ligne (paragraphe, ou ligne de tableau comparée case par case)."""
    if bm["type"] == "p" or br["type"] != "ligne" or len(bm["cellules"]) != len(br["cellules"]):
        return _reponses_texte(_texte_bloc(bm), _texte_bloc(br))
    cellules, entete, ligne = bm["cellules"], bm.get("entete") or [], bm.get("libelle_ligne", "")
    reponses = []
    for c, (cm, cr) in enumerate(zip(cellules, br["cellules"])):
        if _cles(cm) == _cles(cr):
            continue
        titre = _libelle(entete[c]) if c < len(entete) else ""
        if titre and ligne and _norme(titre) != _norme(ligne):
            defaut = f"{ligne} — {titre}"
        else:
            defaut = ligne or titre
        for libelle, valeur, genre in _reponses_texte(cm, cr, defaut):
            if genre == "choix":
                precedentes = [_libelle(x) for x in reversed(cellules[:c]) if x.strip() and VIDE not in x]
                if not valeur.strip(", "):
                    # Case seule dans sa case de tableau : l'option est le texte de la case précédente
                    valeur = next((p for p in precedentes if _a_des_lettres(p)), "")
                if not libelle:
                    libelle = next((p for p in precedentes if _a_des_lettres(p) and _norme(p) != _norme(valeur)), "")
            reponses.append((libelle, valeur, genre))
    return reponses


def lire_docx(contenu, contenu_modele):
    """Réponses du questionnaire Word, par comparaison au modèle vierge : [{section, libelle, valeur, genre, ligne}]."""
    modele, rempli = lignes_docx(contenu_modele), lignes_docx(contenu)
    associes = {j: i for i, j in _aligner(modele, rempli)}
    sections, contextes, section, contexte = {}, {}, "", ""
    for i, b in enumerate(modele):
        contextes[i] = contexte
        if b["type"] == "ligne":
            seule = [c for c in b["cellules"] if c.strip()]
            texte = seule[0] if len(seule) == 1 and len(b["cellules"]) <= 2 else ""
        else:
            texte = b["texte"]
        brut = texte.strip()
        if brut and not POINTILLES.search(brut) and VIDE not in brut and len(brut) < 90 and (
                TITRE.match(brut) or (brut.upper() == brut and len(_mots(brut)) >= 2)):
            section = _libelle(brut)
        sections[i] = section
        # Contexte d'une ligne sans libellé (pointillés seuls, cases d'un tableau) : la dernière ligne qui en a un
        if b["type"] == "p":
            libelle = _libelle(POINTILLES.split(brut)[0]) if brut else ""
            if _a_des_lettres(libelle):
                contexte = libelle
                if not POINTILLES.search(brut) and VIDE not in brut:
                    contextes[i] = contexte
    reponses, derniere, question = [], None, ""
    for j, b in enumerate(rempli):
        if j not in associes:
            # Ligne ajoutée par le client (retour à la ligne dans une réponse) : suite de la réponse précédente
            texte = POINTILLES.sub(" ", _texte_bloc(b)).strip()
            if texte and derniere and derniere["genre"] == "texte":
                derniere["valeur"] = f"{derniere['valeur']} {texte}".strip()
            continue
        i = associes[j]
        for libelle, valeur, genre in _comparer_ligne(modele[i], b):
            libelle = libelle or contextes[i]
            # Sous-question (« Si oui lequel ? », « Nature : », « quantité : ») : rattachée à la question précédente
            suite = bool(re.match(r"^(si oui|si non|dans l.affirmative)", _norme(libelle))) or (
                bool(MOTS_SUITE.match(_norme(libelle))) and len(_mots(libelle)) <= 2)
            if suite and question:
                libelle = f"{question} — {libelle}"
            elif not suite:
                question = libelle.split(" — ")[0]
            if derniere and derniere["libelle"] == libelle and derniere["genre"] == genre == "texte" and derniere["ligne"] in (i, i - 1):
                derniere["valeur"] = f"{derniere['valeur']} {valeur}".strip()
                continue
            derniere = {"section": sections.get(i, ""), "libelle": libelle, "valeur": valeur, "genre": genre, "ligne": i}
            reponses.append(derniere)
    return reponses


@lru_cache(maxsize=16)
def _modele_vierge(code):
    with open(chemin_modele(PAR_CODE[code]), "rb") as f:
        return f.read()


# ---------------------------------------------------------------- Excel : tableaux sous leur en-tête
def lire_tableau_xlsx(contenu, motifs_entete, colonnes):
    """Lignes d'un tableau Excel : en-tête trouvée par motifs (sur une ou deux lignes), colonnes {clé: motif}."""
    import openpyxl

    try:
        classeur = openpyxl.load_workbook(io.BytesIO(contenu), data_only=True, read_only=True)
    except Exception:  # noqa: BLE001
        raise LectureImpossible("Classeur Excel illisible : enregistrez-le au format .xlsx.")
    resultat = []
    for feuille in classeur.worksheets:
        lignes = [list(l) for l in feuille.iter_rows(values_only=True)]
        for n, ligne in enumerate(lignes):
            textes = [_norme(c) for c in ligne]
            # En-tête sur deux lignes (« IDENTIFICATION » puis « NOM ET PRENOMS », « CAPITAUX » puis « DECES »)
            suivante = [_norme(c) for c in lignes[n + 1]] if n + 1 < len(lignes) else []
            if not any(textes) or not all(any(re.search(m, t) for t in textes + suivante) for m in motifs_entete):
                continue
            largeur = max(len(textes), len(suivante))
            cumul = [f"{textes[k] if k < len(textes) else ''} {suivante[k] if k < len(suivante) else ''}".strip() for k in range(largeur)]
            index, pris = {}, set()
            for cle, motif in colonnes.items():
                k = next((k for k, t in enumerate(cumul) if k not in pris and re.search(motif, t)), None)
                if k is not None:
                    index[cle] = k
                    pris.add(k)
            depart = n + 2 if any(suivante) and not any(re.search(r"^\d+$", t) for t in suivante[:1]) else n + 1
            for numero, donnees in enumerate(lignes[depart:], start=depart + 1):
                valeurs = {cle: donnees[k] for cle, k in index.items() if k < len(donnees) and donnees[k] not in (None, "")}
                utiles = {c: v for c, v in valeurs.items() if c != "numero"}
                if not utiles:
                    continue
                resultat.append({"ligne": numero, **valeurs})
            classeur.close()
            return resultat
    classeur.close()
    return None


# ---------------------------------------------------------------- outils de mise en forme
def _date(valeur):
    if isinstance(valeur, datetime):
        return valeur.date().isoformat()
    if isinstance(valeur, date):
        return valeur.isoformat()
    m = re.search(r"(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})", str(valeur or ""))
    if not m:
        return None
    j, mo, a = (int(x) for x in m.groups())
    if a < 100:
        a += 2000 if a <= date.today().year % 100 else 1900
    try:
        return date(a, mo, j).isoformat()
    except ValueError:
        return None


def _montant(valeur):
    if isinstance(valeur, (int, float)):
        return int(round(valeur))
    texte = re.sub(r"(?i)f\s*cfa|fcfa|francs?|xof|f\b", " ", str(valeur or ""))
    m = re.search(r"\d[\d\s.  ]*(?:,\d+)?", texte)
    if not m:
        return 0
    chiffres = re.sub(r"[\s.  ]", "", m.group()).split(",")[0]
    nombre = int(chiffres) if chiffres.isdigit() else 0
    if re.search(r"(?i)\b(milliards?|mds?)\b", texte):
        nombre *= 1_000_000_000
    elif re.search(r"(?i)\b(millions?|m)\b", texte) and nombre < 100_000:
        nombre *= 1_000_000
    return nombre


def _texte(valeur):
    if valeur is None:
        return ""
    if isinstance(valeur, (datetime, date)):
        return (valeur.date() if isinstance(valeur, datetime) else valeur).strftime("%d/%m/%Y")
    if isinstance(valeur, float) and valeur.is_integer():
        return f"{int(valeur):,}".replace(",", " ")
    return str(valeur).strip()


def _telephone(texte):
    m = re.search(r"(?:\+?225[\s.]*)?(?:\d[\s.]?){8,10}", texte or "")
    return m.group().strip() if m else ""


def _email(texte):
    m = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", texte or "")
    return m.group() if m else ""


def _cherche(reponses, *motifs, section=None, genre="texte"):
    for r in reponses:
        if section and not re.search(section, _norme(r["section"])):
            continue
        if genre and r["genre"] != genre:
            continue
        if any(re.search(m, _norme(r["libelle"])) for m in motifs):
            return r["valeur"]
    return ""


def _separer_nom(texte):
    """« SOCIETE X, Treichville, 27 21… » saisi dans un seul champ : (nom, reste)."""
    if len(texte) > 60 or re.search(r",|\s[-–]\s", texte):
        nom = re.split(r",|\s[-–]\s", texte, maxsplit=1)[0].strip()
        return nom, texte[len(nom):].strip(" ,-–")
    return texte, ""


def _souscripteur_generique(reponses):
    motifs_nom = (r"raison sociale", r"^nom ou raison", r"^nom\b(?!.*(jeune|enfant|precedent|assureur|agent))", r"proposant",
                  r"^assure\b", r"nom et adresse")
    source = next((r for r in reponses if r["genre"] == "texte" and any(re.search(m, _norme(r["libelle"])) for m in motifs_nom)), None)
    nom, reste = _separer_nom(source["valeur"] if source else "")
    # Champ « Nom, adresse, téléphone, e-mail » unique : les autres coordonnées se lisent dans le reste de la saisie
    autres = [r for r in reponses if r is not source]
    telephone = _cherche(autres, r"\btel\b", r"telephone", r"cellulaire", r"mobile") or _telephone(reste)
    email = _cherche(autres, r"e-? ?mail", r"courriel") or _email(reste)
    adresse = _cherche(autres, r"adresse postale", r"adresse geographique", r"^adresse", r"situation geographique")
    if not adresse and reste:
        adresse = re.sub(r"\s*,\s*,+", ",", reste.replace(telephone, "").replace(email, "")).strip(" ,-–")
    return {
        "nom": nom,
        "type": "Entreprise" if nom and re.search(r"(?i)\b(sarl|sa|sas|suarl|ets|groupe|societe|soci[ée]t[ée]|entreprise|cie|ltd|gie)\b", nom) else "",
        "adresse": adresse,
        "telephone": telephone,
        "email": email,
        "contact": _cherche(reponses, r"personne a contacter", r"nom et fonction de la personne", r"^contact"),
        "activite": _cherche(reponses, r"nature exacte des activites", r"activite", r"genre du commerce", r"^profession"),
        "registre_commerce": _cherche(reponses, r"registre de commerce", r"rccm"),
    }


def _sections(reponses):
    groupes = []
    for r in reponses:
        if not groupes or groupes[-1]["titre"] != r["section"]:
            groupes.append({"titre": r["section"] or "Réponses", "reponses": []})
        # Séparateur interne « — » (question — colonne) affiché « - »
        groupes[-1]["reponses"].append({"libelle": r["libelle"].replace(" — ", " - "), "valeur": r["valeur"], "genre": r["genre"]})
    return groupes


# ---------------------------------------------------------------- lecture par questionnaire
def _lire_auto(contenu):
    from production.import_flotte import ErreurImportFlotte, lire_formulaire

    try:
        lignes = lire_formulaire(contenu)
    except ErreurImportFlotte as erreur:
        raise LectureImpossible(str(erreur))
    if lignes is None:
        raise LectureImpossible("La fiche de tarification automobile n'a pas été reconnue dans ce classeur.")
    colonnes = [("marque", "Marque"), ("type", "Type"), ("immatriculation", "Immatriculation"),
                ("date_mec", "1re mise en circulation"), ("energie", "Énergie"), ("puissance", "Puissance / charge / cylindrée"),
                ("places", "Places"), ("valeur_neuve", "Valeur neuve"), ("valeur_venale", "Valeur vénale")]
    vehicules = [{"Ligne": l["ligne"], "Genre": ", ".join(l["genres"]),
                  **{libelle: _texte(l["valeurs"].get(cle)) for cle, libelle in colonnes}} for l in lignes]
    return {
        "tableaux": [{"titre": "Véhicules", "colonnes": ["Ligne", "Genre"] + [c for _, c in colonnes], "lignes": vehicules}],
        "devis": {"genre": "auto", "vehicules": len(vehicules)},
        "resume": f"{len(vehicules)} véhicule(s) : {'devis mono' if len(vehicules) == 1 else 'devis flotte'}" if vehicules else "",
    }


def _lire_ia(contenu):
    lignes = lire_tableau_xlsx(contenu, [r"nom", r"naissance"], {
        "numero": r"^n\b|^no\b|^n°|^n$", "nom": r"nom", "naissance": r"naissance", "profession": r"profession",
        "deces": r"deces", "ipt": r"ipt|invalidite|incapacite"})
    if lignes is None:
        raise LectureImpossible("Le tableau des assurés (nom, date de naissance…) n'a pas été trouvé dans ce classeur.")
    personnes = [{"Ligne": l["ligne"], "Nom et prénoms": _texte(l.get("nom")), "Date de naissance": _texte(l.get("naissance")),
                  "Profession": _texte(l.get("profession")), "Capital Décès": _montant(l.get("deces")),
                  "Capital IPT": _montant(l.get("ipt"))} for l in lignes if l.get("nom")]
    return {
        "tableaux": [{"titre": "Personnes à assurer", "colonnes": list(personnes[0].keys()) if personnes else [], "lignes": personnes}],
        "devis": {"genre": "ia", "personnes": len(personnes)},
        "resume": f"{len(personnes)} personne(s) à assurer" if personnes else "",
    }


def _lire_retraite(contenu):
    lignes = lire_tableau_xlsx(contenu, [r"matricule|nom", r"naissance"], {
        "matricule": r"matricule", "embauche": r"embauche", "naissance": r"naissance", "fonction": r"fonction",
        "categorie": r"categorie", "salaire": r"salaire"})
    if lignes is None:
        raise LectureImpossible("Le tableau du personnel n'a pas été trouvé dans ce classeur.")
    personnel = [{"Ligne": l["ligne"], "Matricule": _texte(l.get("matricule")), "Date d'embauche": _texte(l.get("embauche")),
                  "Date de naissance": _texte(l.get("naissance")), "Fonction": _texte(l.get("fonction")),
                  "Catégorie": _texte(l.get("categorie")), "Salaire brut": _montant(l.get("salaire"))} for l in lignes]
    masse = sum(p["Salaire brut"] for p in personnel)
    return {
        "tableaux": [{"titre": "Personnel à couvrir", "colonnes": list(personnel[0].keys()) if personnel else [], "lignes": personnel}],
        "devis": None,
        "resume": f"{len(personnel)} salarié(s), masse salariale {f'{masse:,}'.replace(',', ' ')} F" if personnel else "",
    }


def _personne(reponses, colonne):
    """Assuré ou conjoint du bulletin d'adhésion (colonne « Assuré » / « Conjoint » du tableau)."""
    def champ(motif):
        return _cherche(reponses, rf"^{motif}.* - {_norme(colonne)}$")
    naissance = champ(r"date et lieu de naissance")
    date_n = _date(naissance)
    lieu = re.sub(r"^\s*(?:le\s*)?\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\s*(?:a|à|,)?\s*", "", naissance, flags=re.I).strip() if date_n else ""
    sexe = champ(r"sexe").strip().upper()[:1]
    return {"nom": champ(r"nom\b(?! de jeune)"), "prenoms": champ(r"prenoms"), "nom_jeune_fille": champ(r"nom de jeune fille"),
            "date_naissance": date_n, "lieu_naissance": lieu, "naissance_lue": naissance, "adresse": champ(r"adresse"),
            "date_entree": _date(champ(r"date d.entree")), "sexe": sexe if sexe in ("M", "F") else ""}


def _lire_bulletin(reponses):
    societe = _cherche(reponses, r"^societe adherente")
    adherent = _personne(reponses, "Assuré")
    conjoint = _personne(reponses, "Conjoint")
    enfants = []
    for numero in range(1, 10):
        nom = _cherche(reponses, rf"^{numero} - nom et prenoms$")
        naissance = _cherche(reponses, rf"^{numero} - date et lieu de naissance$")
        sexe = _cherche(reponses, rf"^{numero} - sexe").strip().upper()[:1]
        if nom or naissance:
            parties = nom.split(maxsplit=1)
            enfants.append({"nom": parties[0] if parties else "", "prenoms": parties[1] if len(parties) > 1 else "",
                            "date_naissance": _date(naissance), "naissance_lue": naissance, "sexe": sexe if sexe in ("M", "F") else ""})
    # Réponses « OUI » au questionnaire médical, par personne
    colonnes = {"Assuré": "Assuré", "Conjoint": "Conjoint"}
    colonnes.update({f"{n} enfant": f"enfant {i}" for i, n in enumerate(["1er", "2ème", "3ème", "4ème", "5ème"], start=1)})
    declarations = []
    for r in reponses:
        if r["genre"] == "texte" and re.match(r"^oui\b", _norme(r["valeur"])) and " — " in r["libelle"]:
            question, colonne = r["libelle"].rsplit(" — ", 1)
            if colonne in colonnes:
                declarations.append(f"{colonnes[colonne]} : OUI à « {question.replace(' — ', ' - ')} »")
    personnes = []
    if adherent["nom"]:
        personnes.append({"lien": "A", **adherent})
    if conjoint["nom"]:
        if not conjoint["sexe"] and adherent["sexe"]:
            conjoint["sexe"] = "F" if adherent["sexe"] == "M" else "M"
        personnes.append({"lien": "C", **conjoint})
    for e in enfants:
        if not e["nom"] and adherent["nom"]:
            e["nom"] = adherent["nom"]
        personnes.append({"lien": "E", "adresse": adherent["adresse"], **e})
    avertissements = list(declarations)
    for p in personnes:
        if not p["date_naissance"]:
            avertissements.append(f"{p['nom']} {p['prenoms']} : date de naissance illisible (« {p.get('naissance_lue') or 'absente'} »).")
        if not p["sexe"]:
            avertissements.append(f"{p['nom']} {p['prenoms']} : sexe à préciser avant l'import.")
    libelles = {"A": "Adhérent", "C": "Conjoint", "E": "Enfant"}
    return {
        "souscripteur": {"nom": societe or adherent["nom"], "type": "Entreprise" if societe else "",
                         "adresse": _cherche(reponses, r"^adresse et n. telephone"), "telephone": "", "email": "", "contact": ""},
        "tableaux": [{"titre": "Personnes à assurer", "colonnes": ["Lien", "Nom", "Prénoms", "Date de naissance", "Sexe"],
                      "lignes": [{"Lien": libelles[p["lien"]], "Nom": p["nom"], "Prénoms": p["prenoms"],
                                  "Date de naissance": p["date_naissance"] or p.get("naissance_lue", ""), "Sexe": p["sexe"]} for p in personnes]}],
        "devis": {"genre": "sante_bulletin", "personnes": personnes, "societe": societe},
        "avertissements": avertissements,
        "resume": f"{len(personnes)} personne(s) : adhérent{', conjoint' if conjoint['nom'] else ''}{f', {len(enfants)} enfant(s)' if enfants else ''}" if personnes else "",
    }


def _lire_cotation_sante(reponses):
    population = next((r for r in reponses if re.search(r"population a assurer", _norme(r["libelle"]))), None)
    ligne = population["ligne"] if population else None
    nombres = [r["valeur"] for r in reponses if r["ligne"] == ligne] if ligne is not None else []
    adultes = _montant(nombres[0]) if nombres else 0
    enfants = _montant(nombres[1]) if len(nombres) > 1 else 0
    taux = _cherche(reponses, r"taux de couverture", genre="choix")
    etendue = _cherche(reponses, r"etendue territoriale", genre="choix")
    nom, adresse = _separer_nom(_cherche(reponses, r"nom et adresse postale"))
    return {
        "souscripteur": {
            "nom": nom, "type": "Entreprise",
            "adresse": " - ".join(x for x in (adresse, _cherche(reponses, r"situation geographique")) if x), "telephone": _cherche(reponses, r"cellulaire", r"telephone"),
            "email": _cherche(reponses, r"mail"), "contact": _cherche(reponses, r"personne a contacter"),
            "activite": _cherche(reponses, r"activites professionnelles")},
        "devis": {"genre": "sante_cotation", "adultes": adultes, "enfants": enfants,
                  "taux_couverture": _montant(taux) or None, "etendue": etendue,
                  "monde_entier": bool(re.search(r"monde", _norme(etendue))),
                  "centres": _cherche(reponses, r"centres de soins", genre="choix"),
                  "gestion": _cherche(reponses, r"systeme de gestion", genre="choix")},
        "resume": ", ".join(x for x in [f"{adultes} adulte(s)" if adultes else "", f"{enfants} enfant(s)" if enfants else "",
                                        f"couverture {taux}" if taux else "", etendue] if x),
    }


# Capitaux du questionnaire multirisque → garanties de l'offre MRP (stdsousgarantie)
GARANTIES_MRP = [
    (256, "Incendie et risques assimilés", [r"valeur des batiments", r"matieres premieres", r"produits semi", r"produits finis",
                                             r"produits liquide", r"chambre froide", r"mobilier, materiel"]),
    (40, "Dommages électriques", [r"dommages electriques"]),
    (240, "Bris de machine", [r"bris de machine", r"valeur de remplacement a neuf du materiel \(joindre"]),
    (183, "Tous risques informatique", [r"tous risques informatiques", r"valeur de remplacement a neuf du materiel$"]),
    (140, "Vol par effraction et/ou agression", [r"^caisse \d", r"vol coffre-fort \d"]),
    (83, "Vol transport de fonds", [r"^transport de fonds"]),
    (9, "Bris de glaces", [r"montant a assurer$", r"enseignes lumineuses$"]),
    (158, "Perte d'exploitation après incendie", [r"marge brute"]),
]


def _lire_mrp(reponses):
    capitaux, detail, deja = {}, [], set()
    for r in reponses:
        if r["genre"] != "texte":
            continue
        libelle, section = _norme(r["libelle"]), _norme(r["section"])
        for id_garantie, nom, motifs in GARANTIES_MRP:
            if id_garantie == 9 and "bris de glace" not in section:
                continue
            if id_garantie == 158 and (not re.search(r"incendie", section + " " + libelle) or "158" in deja):
                continue
            if any(re.search(m, libelle) for m in motifs):
                montant = _montant(r["valeur"])
                if montant and id_garantie == 158:
                    deja.add("158")
                if montant:
                    capitaux[id_garantie] = capitaux.get(id_garantie, 0) + montant
                    detail.append(f"{nom} : {r['libelle']} {montant:,} F".replace(",", " "))
                break
    situation = ", ".join(v for v in (_cherche(reponses, r"^ville"), _cherche(reponses, r"quartier"), _cherche(reponses, r"^lot"),
                                       _cherche(reponses, r"ilot"), _cherche(reponses, r"^rue")) if v)
    return {
        "devis": {"genre": "mrp", "capitaux": {str(k): v for k, v in capitaux.items()}, "detail_capitaux": detail,
                  "activite": _cherche(reponses, r"nature exacte des activites"), "situation": situation,
                  "qualite": _cherche(reponses, r"qualite juridique", genre="choix")},
        "resume": f"{len(capitaux)} garantie(s) chiffrée(s)" if capitaux else "",
    }


def _lire_trc(reponses):
    def montant(*motifs):
        return _montant(_cherche(reponses, *motifs))
    ttc = montant(r"cout total previsionnel.* - ttc$", r"cout total.* - ttc$")
    ht = montant(r"cout total previsionnel.* - ht$", r"cout total previsionnel")
    travaux = montant(r"^montant des travaux")
    capital = ttc or ht or travaux
    return {
        "souscripteur": {"contact": _cherche(reponses, r"nom et fonction de la personne")},
        "devis": {"genre": "trc", "code_categorie": "430", "capital": capital,
                  "base_capital": "coût total TTC" if ttc else "coût total HT" if ht else "montant des travaux" if travaux else "",
                  "operation": _cherche(reponses, r"nom de l.operation"), "situation": _cherche(reponses, r"situation geographique"),
                  "debut": _cherche(reponses, r"^travaux : debut", r"debut"), "fin": _cherche(reponses, r"\bfin\b")},
        "resume": f"capital {capital:,} F ({'coût total TTC' if ttc else 'coût total HT' if ht else 'montant des travaux'})".replace(",", " ") if capital else "",
    }


def _oui(valeur):
    return bool(re.match(r"^(oui|yes|x|☒)\b", _norme(valeur)))


def _lire_transport(reponses, terrestre=False):
    """Questionnaires Transport, Facultés et Facultés terrestres : ce que la cotation hors GUCE reprend (mode, type de
    police, marchandise, trajet, valeur, garanties demandées)."""
    def montant(*motifs):
        return _montant(_cherche(reponses, *motifs))

    texte_mode = _norme(_cherche(reponses, r"^mode de transport", r"^modes d.expedition"))
    mode = next((code for code, motif in (("MARITIME", r"marit"), ("AERIEN", r"aer|avion"), ("FERROVIAIRE", r"ferrov|train|rail"),
                                          ("FLUVIAL", r"fluvi|lagun"), ("TERRESTRE", r"terrest|camion|route"))
                 if re.search(motif, texte_mode)), "TERRESTRE" if terrestre else "")
    texte_police = _norme(_cherche(reponses, r"^type de police"))
    type_police = next((code for code, motif in (("ABONNEMENT", r"abonnement|aliment"), ("ANNUELLE", r"annuel"),
                                                 ("VOYAGE", r"voyage")) if re.search(motif, texte_police)), "")
    # Garanties : une ligne par garantie (OUI en regard) ou une seule réponse qui les cite
    demandees = " ".join(_norme(r["libelle"]) for r in reponses
                         if (r["genre"] == "choix" or _oui(r["valeur"])) and not re.search(r"guerre", _norme(r["libelle"])))
    demandees += " " + _norme(_cherche(reponses, r"^garanties demandees", r"^garantie souhaitee"))
    base = next((code for code, motif in (("TOUS_RISQUES", r"tous risques"), ("FAP_SAUF", r"fap|accidents majeurs"),
                                          ("ACCIDENTS_CARACTERISES", r"accidents? caracteris")) if re.search(motif, demandees)), "")
    extensions = []
    if any(re.search(r"guerre", _norme(r["libelle"])) and (r["genre"] == "choix" or _oui(r["valeur"])) for r in reponses):
        extensions.append("GUERRE")
    if any(re.search(r"greves?", _norme(r["libelle"])) and (r["genre"] == "choix" or _oui(r["valeur"])) for r in reponses):
        extensions.append("GREVES")
    if any(re.search(r"chargement et de dechargement", _norme(r["libelle"])) and r["genre"] == "choix" for r in reponses):
        extensions.append("CHARGEMENT")
    nombre_voyages = montant(r"^nombre de voyage")
    valeur_voyage = montant(r"^valeur assuree par voyage", r"^valeur assuree par camion")
    valeur = montant(r"^plein par expedition", r"^valeur maximum du chargement") or valeur_voyage
    chiffre = (montant(r"^quantite totale previsionnelle", r"^chiffre d.affaires", r"valeur approximative des importations")
               or (nombre_voyages * valeur_voyage if nombre_voyages and valeur_voyage else 0))
    ports = _cherche(reponses, r"^ports ou aerodromes")
    embarquement = _cherche(reponses, r"^lieu d.embarquement")
    debarquement = _cherche(reponses, r"^lieu de debarquement")
    m = re.search(r"(?i)embarquement\s*:?\s*([^,;]+)", ports)
    embarquement = embarquement or (m.group(1).strip() if m else "")
    m = re.search(r"(?i)d[ée]barquement\s*:?\s*([^,;]+)", ports)
    debarquement = debarquement or (m.group(1).strip() if m else "")
    devis = {
        "genre": "transport",
        "mode": mode,
        "type_police": type_police,
        "nature": _cherche(reponses, r"^nature exacte des marchandises", r"^nature exacte de la marchandise", r"^nature$"),
        "emballage": _cherche(reponses, r"^nature et qualite des emballages", r"^emballage"),
        "conditionnement": _cherche(reponses, r"^mode de conditionnement", r"^pour les envois en conteneurs", r"^conditionnement"),
        "depart": _cherche(reponses, r"^provenances? des marchandises", r"^origine") or embarquement,
        "embarquement": embarquement,
        "debarquement": debarquement,
        "arrivee": _cherche(reponses, r"^destination finale") or debarquement,
        "valeur": valeur,
        "chiffre_affaires": chiffre,
        "base": base,
        "extensions": extensions,
        "franchise": "avec franchise" if any(re.search(r"tous risques.*franchise", _norme(r["libelle"])) and _oui(r["valeur"])
                                             for r in reponses) else "",
    }
    resume = [x for x in (devis["nature"][:40], f"{devis['depart']} → {devis['arrivee']}" if devis["depart"] and devis["arrivee"] else "",
                          f"{valeur:,} F".replace(",", " ") if valeur else "") if x]
    return {"devis": devis, "resume": ", ".join(resume)}


# ---------------------------------------------------------------- reconnaissance du questionnaire par son contenu
# Un fichier rempli garde les libellés de son modèle : il est rattaché au modèle vierge (même format) dont il
# contient la plus grande part du vocabulaire, avec une avance nette sur le suivant (demande du 2026-10-21 : un
# questionnaire Automobile déposé comme Individuelle Accidents n'était pas lu, donc pas repris dans le devis).
SEUIL_RECONNAISSANCE = 0.6
ECART_RECONNAISSANCE = 0.1


def _texte_fichier(contenu, ext):
    """Texte d'un questionnaire Word ou Excel : libellés du modèle et réponses du client."""
    if ext == "docx":
        return " ".join(_texte_bloc(b) for b in lignes_docx(contenu))
    if ext == "xlsx":
        import openpyxl

        try:
            classeur = openpyxl.load_workbook(io.BytesIO(contenu), data_only=True, read_only=True)
        except Exception:  # noqa: BLE001
            raise LectureImpossible("Classeur Excel illisible : enregistrez-le au format .xlsx.")
        morceaux = []
        try:
            for feuille in classeur.worksheets:
                morceaux.append(feuille.title or "")
                for rang, ligne in enumerate(feuille.iter_rows(values_only=True)):
                    if rang >= 300:
                        break
                    morceaux.extend(c for c in ligne if isinstance(c, str))
        finally:
            classeur.close()
        return " ".join(morceaux)
    return ""


def _vocabulaire(texte):
    """Mots porteurs d'un texte (4 lettres et plus, sans accents) : ceux des libellés d'un questionnaire."""
    return {m for m in _mots(texte) if len(m) >= 4 and not m.isdigit()}


@lru_cache(maxsize=32)
def _vocabulaire_modele(code):
    try:
        return frozenset(_vocabulaire(_texte_fichier(_modele_vierge(code), extension(PAR_CODE[code]["fichier"]))))
    except (LectureImpossible, OSError):
        return frozenset()


def identifier_modele(contenu, ext):
    """Questionnaire reconnu d'après son contenu : (code, part du vocabulaire du modèle retrouvée). Code None si aucun
    modèle du même format ne se détache (PDF, photo, fichier sans rapport, questionnaires trop proches)."""
    if ext not in ("docx", "xlsx"):
        return None, 0.0
    vocabulaire = _vocabulaire(_texte_fichier(contenu, ext))
    scores = sorted(
        ((len(mots & vocabulaire) / len(mots), code) for code, mots in
         ((c, _vocabulaire_modele(c)) for c, m in PAR_CODE.items() if extension(m["fichier"]) == ext) if mots),
        reverse=True,
    )
    if not scores or not vocabulaire:
        return None, 0.0
    meilleur, code = scores[0]
    second = scores[1][0] if len(scores) > 1 else 0.0
    if meilleur >= SEUIL_RECONNAISSANCE and meilleur - second >= ECART_RECONNAISSANCE:
        return code, round(meilleur, 3)
    return None, round(meilleur, 3)


def _description_modele(code, score=None):
    m = PAR_CODE[code]
    return {"code": code, "titre": m["titre"], "branche": m["branche"], "route_devis": m["route_devis"],
            **({"score": score} if score is not None else {})}


def _lire_contenu(code, contenu, ext):
    """Lecture d'un fichier Word ou Excel comme questionnaire `code` (LectureImpossible sinon)."""
    if code == "auto_fiche_tarification":
        return _lire_auto(contenu)
    if code == "individuelle_accidents":
        return _lire_ia(contenu)
    if code == "retraite_complementaire":
        return _lire_retraite(contenu)
    if ext == "docx" and code in PAR_CODE and extension(PAR_CODE[code]["fichier"]) in ("docx", "doc"):
        if extension(PAR_CODE[code]["fichier"]) == "doc":
            raise LectureImpossible("Modèle .doc : lecture automatique impossible.")
        reponses = lire_docx(contenu, _modele_vierge(code))
        lu = {"sections": _sections(reponses), "souscripteur": _souscripteur_generique(reponses)}
        specifique = {
            "sante_bulletin_adhesion": _lire_bulletin,
            "sante_questionnaire_cotation": _lire_cotation_sante,
            "multirisque_professionnelle": _lire_mrp,
            "tous_risques_chantier": _lire_trc,
            "transport_questionnaire": _lire_transport,
            "transport_facultes": _lire_transport,
            "transport_facultes_terrestres": lambda r: _lire_transport(r, terrestre=True),
        }.get(code)
        if specifique:
            propre = specifique(reponses)
            lu["souscripteur"] = {**lu["souscripteur"], **{k: v for k, v in (propre.pop("souscripteur", {}) or {}).items() if v}}
            lu.update(propre)
        lu["reponses"] = len(reponses)
        return lu
    raise LectureImpossible(f"Format .{ext} inattendu pour ce questionnaire.")


MESSAGE_PDF_PHOTO = ("PDF ou photo : la lecture automatique n'est possible que pour les fichiers Word (.docx) et Excel "
                     "(.xlsx). Le devis se fera en reprenant les informations du fichier à la main.")


def _message_ancien_format(ext):
    return (f"Ancien format .{ext} : enregistrez le fichier en .{ext}x (Word ou Excel récent) et déposez-le comme "
            f"nouvelle version pour qu'il soit lu.")


def analyser(contenu, nom_fichier, code_choisi=""):
    """Avant le dépôt (rien n'est enregistré) : questionnaire reconnu d'après le contenu, puis ce que la lecture en tire
    (souscripteur, résumé, avertissements), pour que le commercial voie tout de suite ce qui passera dans le devis."""
    ext = extension(nom_fichier)
    resultat = {"reconnu": None, "lisible": False, "message": "", "resume": "", "souscripteur": {},
                "avertissements": [], "reponses": 0, "lignes": 0, "devis": None}
    if ext in ("pdf", "jpg", "jpeg", "png"):
        resultat["message"] = MESSAGE_PDF_PHOTO
        return resultat
    if ext in ("doc", "xls"):
        resultat["message"] = _message_ancien_format(ext)
        return resultat
    try:
        code, score = identifier_modele(contenu, ext)
        if code:
            resultat["reconnu"] = _description_modele(code, score)
        code = code or code_choisi
        if not code or code not in PAR_CODE:
            resultat["message"] = "Questionnaire non reconnu : choisissez-le dans la liste."
            return resultat
        lu = _lire_contenu(code, contenu, ext)
    except LectureImpossible as erreur:
        resultat["message"] = str(erreur)
        return resultat
    lignes = sum(len(t.get("lignes") or []) for t in lu.get("tableaux") or [])
    resultat.update({
        "resume": lu.get("resume", ""), "souscripteur": {k: v for k, v in (lu.get("souscripteur") or {}).items() if v},
        "avertissements": lu.get("avertissements", []), "reponses": lu.get("reponses", 0), "lignes": lignes,
        "devis": lu.get("devis"),
    })
    resultat["lisible"] = bool(resultat["reponses"] or lignes)
    if not resultat["lisible"]:
        resultat["message"] = "Aucune réponse trouvée : le questionnaire semble vide."
    return resultat


def lire(questionnaire):
    """Lecture d'un QuestionnaireProspect : dict pour l'écran et le devis de la branche."""
    code = questionnaire.modele
    resultat = {"modele": code, "titre": questionnaire.titre, "branche": questionnaire.branche, "lisible": False,
                "message": "", "souscripteur": {}, "sections": [], "tableaux": [], "devis": None, "avertissements": [],
                "resume": "", "reponses": 0}
    ext = extension(questionnaire.fichier.name)
    if ext in ("pdf", "jpg", "jpeg", "png"):
        resultat["message"] = MESSAGE_PDF_PHOTO
        return resultat
    if ext in ("doc", "xls"):
        resultat["message"] = _message_ancien_format(ext)
        return resultat
    questionnaire.fichier.open("rb")
    try:
        contenu = questionnaire.fichier.read()
    finally:
        questionnaire.fichier.close()
    try:
        # Fichier d'un autre questionnaire que celui choisi au dépôt : il est lu comme le questionnaire reconnu, et
        # l'écran propose de le reclasser (le devis s'établit alors dans la bonne branche)
        detecte, score = identifier_modele(contenu, ext)
        if detecte and detecte != code:
            resultat["modele_detecte"] = _description_modele(detecte, score)
            resultat["avertissements"].append(
                f"Ce fichier est le questionnaire « {PAR_CODE[detecte]['titre']} », pas « {questionnaire.titre} » : "
                f"il est lu comme tel ; reclassez-le pour établir le devis dans la bonne branche.")
            code = detecte
        lu = _lire_contenu(code, contenu, ext)
    except LectureImpossible as erreur:
        resultat["message"] = str(erreur)
        return resultat
    lu["avertissements"] = resultat["avertissements"] + list(lu.get("avertissements") or [])
    resultat.update(lu)
    resultat["lisible"] = bool(resultat.get("reponses") or any(t["lignes"] for t in resultat["tableaux"]))
    if not resultat["lisible"] and not resultat["message"]:
        resultat["message"] = "Aucune réponse trouvée : le questionnaire semble vide, ou il ne correspond pas au modèle choisi."
    # Le prospect du suivi commercial complète le souscripteur
    lead = questionnaire.lead
    s = resultat["souscripteur"] = {k: v for k, v in (resultat.get("souscripteur") or {}).items() if v}
    if lead:
        s.setdefault("nom", lead.nom_prospect)
        for cle, champ in (("telephone", "telephone"), ("email", "email"), ("contact", "contact")):
            if getattr(lead, champ, "") and not s.get(cle):
                s[cle] = getattr(lead, champ)
    s.setdefault("nom", questionnaire.prospect_nom)
    if not s.get("type") and re.search(r"(?i)\b(sarl|sa|sas|ets|groupe|soci[ée]t[ée]|entreprise|cie|gie)\b", s.get("nom", "")):
        s["type"] = "Entreprise"
    return resultat
