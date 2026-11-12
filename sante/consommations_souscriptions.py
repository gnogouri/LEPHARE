"""Consommations santé : effectif complété par les souscriptions Oreole Santé de LE PHARE (demande du 2026-11-10 : « l'effectif, tu peux
aussi le trouver parmi ceux qui ont souscrit à Oreole Santé »).

Les personnes des contrats Oreole Santé (stdaffilie : adhérent au lien A, conjoint C, enfant E) portent le matricule du gestionnaire : 180 des
184 matricules d'adhérents de la base locale figurent dans son effectif. Celles que l'effectif importé ne connaît pas encore (incorporation ou
affaire saisie après le dernier effectif du gestionnaire) y sont ajoutées :
- période en cours de chaque police : dernier contrat d'affaire nouvelle ou de renouvellement et ses avenants, sans les contrats annulés ;
  une personne présente dans plusieurs avenants est prise dans le plus récent ;
- entreprise, garant et collège : ceux que l'effectif donne aux autres personnes de la même police, sinon le souscripteur, OREOLE et vide ;
- date d'effet = adhésion ; sortie = sortie de la personne, résiliation de la police ou échéance passée sans renouvellement ;
- une personne sans matricule ne peut pas être ajoutée (le relevé désigne les bénéficiaires par leur matricule) : elle est signalée.
L'effectif du gestionnaire fait foi : une personne qu'il connaît n'est jamais modifiée ici, et ses imports suivants mettent à jour les personnes
ajoutées d'ici sans les faire sortir quand il ne les liste pas (consommations.importer). Les ajouts sont tracés comme un import de nature
EFFECTIF, fichier SOURCE_SOUSCRIPTIONS, sans date de situation : ils ne servent jamais d'effectif de référence des mouvements.

GET  /api/consommations/souscriptions/   aperçu, rien n'est enregistré (droit consommations.view)
POST /api/consommations/souscriptions/   ajout à l'effectif (droit consommations.import)
"""

import datetime as dt
import re
from collections import Counter, defaultdict

from django.db import connection, transaction
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from production.renouvellement import AUTHENTIFICATION, _lignes

from .consommations import CHAMPS_EFFECTIF, SOURCE_SOUSCRIPTIONS, _iso, _nouveau_releve, _valeur

GARANT_PAR_DEFAUT = "OREOLE"
ID_PRODUIT_SANTE = 5

SQL_PERSONNES = """
    WITH polices AS (
        SELECT DISTINCT c.numeropolice FROM lephare_oreole_package p JOIN stdcontrat c ON c.iddevis = p.iddevis_sante
        WHERE COALESCE(c.idcontratannulation, 0) = 0),
    contrats AS (
        SELECT c.idcontrat, c.iddevis, c.numeropolice, c.idclient, c.dateeffet::date AS effet, c.dateexpiration::date AS echeance, a.codeavenant
        FROM stdcontrat c JOIN stdavenant a ON a.idavenant = c.idavenant JOIN polices po ON po.numeropolice = c.numeropolice
        WHERE c.idproduit = %s AND COALESCE(c.idcontratannulation, 0) = 0),
    base AS (
        SELECT DISTINCT ON (numeropolice) numeropolice, effet, echeance, idclient FROM contrats WHERE codeavenant IN ('AFN', 'REN')
        ORDER BY numeropolice, effet DESC, idcontrat DESC)
    SELECT k.numeropolice AS police_lephare, k.codeavenant, k.effet AS effet_contrat, b.echeance, b.effet AS debut_periode,
           f.idaffilie, TRIM(COALESCE(f.lien, '')) AS lien, TRIM(COALESCE(f.matricule, '')) AS matricule, f.nom, f.prenom, f.sexe,
           f.datenaissance::date AS date_naissance, f.dateadhesion::date AS adhesion, f.datesortie::date AS sortie, COALESCE(f.actif, TRUE) AS actif,
           TRIM(COALESCE(h.matricule, '')) AS matricule_adherent,
           TRIM(COALESCE(s.nom, '') || ' ' || COALESCE(s.prenoms, '')) AS souscripteur
    FROM contrats k
    JOIN base b ON b.numeropolice = k.numeropolice AND k.effet >= b.effet
    JOIN stdaffilie f ON f.iddevis = k.iddevis
    LEFT JOIN stdadherent h ON h.idadherent = f.idadherent
    LEFT JOIN stdclient s ON s.idclient = b.idclient
    ORDER BY k.effet, k.idcontrat, f.idaffilie
"""


def _matricule(texte):
    """Matricule du gestionnaire : un nombre (zéros de tête sans effet), sinon None."""
    chiffres = re.sub(r"\s", "", str(texte or ""))
    return int(chiffres) if chiffres.isdigit() and int(chiffres) > 0 else None


def _plus_frequent(valeurs):
    valeurs = [v for v in valeurs if v]
    return Counter(valeurs).most_common(1)[0][0] if valeurs else ""


def personnes_souscrites(lignes, effectif, aujourd_hui):
    """Personnes en vigueur des contrats Oreole Santé, au format de l'effectif du gestionnaire, et personnes sans matricule.
    lignes : SQL_PERSONNES (dans l'ordre des contrats) ; effectif : {matricule: ligne de lephare_sante_effectif}."""
    resiliations = {}
    personnes, sans_matricule, par_police = {}, {}, defaultdict(set)
    for l in lignes:
        if l["codeavenant"] == "RES":
            resiliations[l["police_lephare"]] = min(resiliations.get(l["police_lephare"], l["effet_contrat"]), l["effet_contrat"])
    for l in lignes:
        if l["codeavenant"] == "RES":
            continue
        lien = l["lien"].upper()[:1]
        matricule = _matricule(l["matricule"]) or (_matricule(l["matricule_adherent"]) if lien == "A" else None)
        fiche = {
            "police_lephare": l["police_lephare"], "souscripteur": l["souscripteur"], "nom": (l["nom"] or "").strip(), "prenoms": (l["prenom"] or "").strip(),
            "statut": lien if lien in ("A", "C", "E") else "E", "genre": (l["sexe"] or "").strip().upper()[:1],
            "date_naissance": l["date_naissance"], "date_effet": l["adhesion"] or l["effet_contrat"],
            "matricule_assure": _matricule(l["matricule_adherent"]) or matricule,
        }
        sortie = l["sortie"] or resiliations.get(l["police_lephare"]) or (l["echeance"] if l["echeance"] and l["echeance"] < aujourd_hui else None)
        fiche["date_sortie"] = sortie
        fiche["actif"] = bool(l["actif"]) and not (sortie and sortie <= aujourd_hui)
        if not matricule:
            sans_matricule[(fiche["police_lephare"], fiche["nom"].upper(), fiche["prenoms"].upper(), fiche["date_naissance"])] = fiche
            continue
        fiche["matricule_beneficiaire"] = matricule
        personnes[matricule] = fiche          # le contrat le plus récent l'emporte, y compris d'une police à l'autre

    # Entreprise, garant et collège que l'effectif donne aux autres personnes de la même police
    for matricule, fiche in personnes.items():
        par_police[fiche["police_lephare"]].add(matricule)
    for matricules in par_police.values():
        connues = [effectif[m] for m in matricules if m in effectif]
        connues += [e for e in effectif.values() if e.get("matricule_assure") in {personnes[m]["matricule_assure"] for m in matricules}]
        attributs = {cle: _plus_frequent(e.get(cle) for e in connues) for cle in ("police", "garant", "college")}
        for m in matricules:
            p = personnes[m]
            p["police"] = attributs["police"] or p["souscripteur"]
            p["garant"] = attributs["garant"] or GARANT_PAR_DEFAUT
            p["college"] = attributs["college"]
    return personnes, list(sans_matricule.values())


def _egal(a, b):
    """Valeurs égales en base : une colonne de longueur fixe (genre) rend une chaîne vide sous la forme d'un espace."""
    return (a.strip() if isinstance(a, str) else a) == (b.strip() if isinstance(b, str) else b)


def _etat(cursor, aujourd_hui=None):
    """Personnes souscrites, effectif actuel et ce qu'il faudrait écrire. N'écrit rien."""
    aujourd_hui = aujourd_hui or dt.date.today()
    cursor.execute("SELECT to_regclass('public.lephare_oreole_package') IS NOT NULL")
    if not cursor.fetchone()[0]:
        return None
    lignes = _lignes(cursor, SQL_PERSONNES, [ID_PRODUIT_SANTE])
    effectif = {e["matricule_beneficiaire"]: e for e in _lignes(cursor, """
        SELECT e.*, (r.fichier = %s) AS de_souscription FROM lephare_sante_effectif e LEFT JOIN lephare_sante_releve r ON r.idreleve = e.idreleve""",
        [SOURCE_SOUSCRIPTIONS])}
    personnes, sans_matricule = personnes_souscrites(lignes, effectif, aujourd_hui)
    a_ajouter, a_mettre_a_jour, connues = [], [], 0
    for m, p in personnes.items():
        e = effectif.get(m)
        if e is None:
            a_ajouter.append(p)
        elif not e["de_souscription"]:
            connues += 1                       # l'effectif du gestionnaire fait foi
        elif any(not _egal(_valeur(p, c), _valeur(e, c)) for c in CHAMPS_EFFECTIF[1:]) or (p["actif"], p["date_sortie"]) != (e["actif"], e["date_sortie"]):
            a_mettre_a_jour.append(p)
    # Personnes ajoutées d'ici qui ne figurent plus dans aucun contrat en vigueur : sorties à la date du jour
    retirees = [e for m, e in effectif.items() if e["de_souscription"] and e["actif"] and m not in personnes]
    return {"aujourd_hui": aujourd_hui, "personnes": personnes, "sans_matricule": sans_matricule, "a_ajouter": a_ajouter,
            "a_mettre_a_jour": a_mettre_a_jour, "retirees": retirees, "connues": connues}


def _fiche(p):
    return {"Matricule": p.get("matricule_beneficiaire"), "Nom": p["nom"], "Prenoms": p["prenoms"], "Statut": p["statut"], "Entreprise": p.get("police") or p["souscripteur"],
            "PoliceLePhare": p["police_lephare"], "Garant": p.get("garant", ""), "DateEffet": _iso(p["date_effet"]), "DateSortie": _iso(p["date_sortie"]),
            "Actif": p["actif"]}


def apercu():
    with connection.cursor() as cursor:
        etat = _etat(cursor)
    if etat is None:
        return {"Disponible": False, "Message": "La branche Oreole Santé n'est pas installée sur cette base (migration production 0205)."}
    par_entreprise = defaultdict(lambda: {"Personnes": 0, "Connues": 0, "Nouvelles": 0})
    nouvelles = {p["matricule_beneficiaire"] for p in etat["a_ajouter"]}
    for m, p in etat["personnes"].items():
        x = par_entreprise[(p.get("police") or p["souscripteur"], p["police_lephare"])]
        x["Personnes"] += 1
        x["Nouvelles" if m in nouvelles else "Connues"] += 1
    return {
        "Disponible": True, "Polices": len({p["police_lephare"] for p in etat["personnes"].values()}), "Personnes": len(etat["personnes"]),
        "DejaConnues": etat["connues"], "AAjouter": [_fiche(p) for p in etat["a_ajouter"]], "AMettreAJour": len(etat["a_mettre_a_jour"]),
        "Retirees": len(etat["retirees"]), "SansMatricule": [_fiche(p) for p in etat["sans_matricule"]],
        "ParEntreprise": sorted(({"Entreprise": e, "PoliceLePhare": pol, **x} for (e, pol), x in par_entreprise.items()), key=lambda x: x["Entreprise"]),
    }


def ajouter(user):
    """Ajoute à l'effectif les personnes souscrites qu'il ne connaît pas, met à jour celles ajoutées d'ici. Une transaction."""
    with transaction.atomic(), connection.cursor() as cursor:
        etat = _etat(cursor)
        if etat is None:
            raise ValueError("La branche Oreole Santé n'est pas installée sur cette base (migration production 0205).")
        ecritures = etat["a_ajouter"] + etat["a_mettre_a_jour"]
        if not ecritures and not etat["retirees"]:
            return {"Ajoutees": 0, "MisesAJour": 0, "Sorties": 0, "SansMatricule": len(etat["sans_matricule"]), "IdReleve": None}
        garants = sorted({p["garant"] for p in ecritures} | {e["garant"] for e in etat["retirees"]} - {""})
        id_releve = _nouveau_releve(cursor, user, "EFFECTIF", SOURCE_SOUSCRIPTIONS, garants, len(ecritures) + len(etat["retirees"]),
                                    {"Nouvelles": len(etat["a_ajouter"]), "Connues": etat["connues"], "MontantsChanges": len(etat["a_mettre_a_jour"])})
        colonnes = ", ".join(CHAMPS_EFFECTIF + ["actif", "date_sortie", "idreleve"])
        marques = ", ".join(["%s"] * (len(CHAMPS_EFFECTIF) + 3))
        maj = ", ".join(f"{c} = EXCLUDED.{c}" for c in CHAMPS_EFFECTIF[1:] + ["actif", "date_sortie", "idreleve"])
        cursor.executemany(
            f"""INSERT INTO lephare_sante_effectif ({colonnes}) VALUES ({marques})
                ON CONFLICT (matricule_beneficiaire) DO UPDATE SET {maj}, datemaj = now()
                WHERE lephare_sante_effectif.idreleve IN (SELECT idreleve FROM lephare_sante_releve WHERE fichier = %s)""",
            [[_valeur(p, c) for c in CHAMPS_EFFECTIF] + [p["actif"], p["date_sortie"], id_releve, SOURCE_SOUSCRIPTIONS] for p in ecritures])
        if etat["retirees"]:
            cursor.execute("UPDATE lephare_sante_effectif SET actif = FALSE, date_sortie = %s, idreleve = %s, datemaj = now() WHERE matricule_beneficiaire = ANY(%s)",
                           [etat["aujourd_hui"], id_releve, [e["matricule_beneficiaire"] for e in etat["retirees"]]])
        return {"Ajoutees": len(etat["a_ajouter"]), "MisesAJour": len(etat["a_mettre_a_jour"]), "Sorties": len(etat["retirees"]),
                "SansMatricule": len(etat["sans_matricule"]), "IdReleve": id_releve}


@api_view(["GET", "POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_souscriptions(request):
    if request.method == "GET":
        return Response(apercu())
    try:
        return Response(ajouter(request.user))
    except ValueError as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
