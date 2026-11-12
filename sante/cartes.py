"""
Facturation des cartes d'assurance (demande du 2026-11-05) : une carte n'est facturée qu'une fois à une personne.

- Registre lephare_carte_facturation : une ligne par carte, avec la date, le montant, l'opérateur et le motif.
- Une personne est reconnue à son nom, ses prénoms et sa date de naissance, sans accent ni casse, sur toutes les polices.
- Une carte compte comme facturée dès que son devis a donné un contrat non annulé. Un devis non confirmé ne bloque personne, sinon deux
  propositions à la même famille s'empêcheraient ; le contrôle est refait à l'émission.
- Une nouvelle facturation n'est permise qu'avec le motif « Renouvellement pour perte ».
- Personnes comptées mais non nommées dans un fichier (colonne Personnes) : leurs cartes sont suivies par famille. Si leurs noms arrivent
  l'année suivante, ces cartes les couvrent, pour ne pas les facturer deux fois.

Seule la branche Oreole Santé facture des cartes aujourd'hui. Ce module ne dépend pas d'elle.
"""

import re
import unicodedata
from decimal import Decimal

from django.contrib.auth import get_user_model

MOTIF_PREMIERE = "PREMIERE"
MOTIF_PERTE = "PERTE"
LIBELLES_MOTIF = {MOTIF_PREMIERE: "Première facturation", MOTIF_PERTE: "Renouvellement pour perte"}
A_FACTURER = "A_FACTURER"
DEJA_FACTUREE = "DEJA_FACTUREE"
PERTE = "PERTE"
# Verrou du registre pendant une émission : deux devis confirmés en même temps ne peuvent pas facturer la même carte
VERROU_REGISTRE = 880205


class CarteDejaFacturee(Exception):
    """Carte déjà facturée, sans renouvellement pour perte : message affiché tel quel."""


def _normaliser(texte):
    sans_accent = unicodedata.normalize("NFKD", str(texte or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Z0-9]+", " ", sans_accent.upper()).strip()


def cle_personne(nom, prenoms, naissance):
    """Identité d'une personne : mêmes nom, prénoms et date de naissance, quelle que soit la façon de les écrire."""
    jour = naissance.isoformat()[:10] if hasattr(naissance, "isoformat") else str(naissance or "")[:10]
    return f"{_normaliser(nom)}|{_normaliser(prenoms)}|{jour}"


def libelle_personne(personne):
    return f"{personne.get('Nom') or ''} {personne.get('Prenoms') or ''}".strip() or "Personne non nommée"


def _franc(valeur):
    return f"{Decimal(str(valeur or 0)):,.0f}".replace(",", " ")


def message_alerte(personne, derniere=None):
    """Message attendu quand on tente de facturer une carte déjà facturée."""
    detail = ""
    if derniere:
        morceaux = [f"le {derniere['Date'][8:10]}/{derniere['Date'][5:7]}/{derniere['Date'][:4]}" if derniere.get("Date") else "",
                    f"{_franc(derniere.get('Montant'))} F", f"par {derniere['Utilisateur']}" if derniere.get("Utilisateur") else "",
                    f"police {derniere['NumeroPolice']}" if derniere.get("NumeroPolice") else ""]
        detail = f" ({', '.join(m for m in morceaux if m)})"
    return (f"Une facturation de carte existe déjà pour {libelle_personne(personne)}{detail}. "
            "Un renouvellement pour perte est nécessaire pour poursuivre.")


def _ligne_historique(ligne):
    return {
        "IdFacturation": ligne[0], "Cle": ligne[1], "CleFamille": ligne[2], "Anonyme": ligne[3], "Nom": ligne[4], "Prenoms": ligne[5],
        "DateNaissance": ligne[6].isoformat() if ligne[6] else None, "Lien": ligne[7], "IdDevis": ligne[8], "Montant": float(ligne[9] or 0),
        "Motif": ligne[10], "LibelleMotif": LIBELLES_MOTIF.get(ligne[10], ligne[10]), "Observation": ligne[11], "Utilisateur": ligne[12] or "",
        "Date": ligne[13].isoformat() if ligne[13] else None, "NumeroPolice": ligne[14] or "", "IdContrat": ligne[15], "NumeroDevis": (ligne[16] or "").strip(),
        "Effective": bool(ligne[15]),
    }


COLONNES = """f.idfacturation, f.cle, f.clefamille, f.anonyme, f.nom, f.prenoms, f.datenaissance, f.lien, f.iddevis, f.montant, f.motif, f.observation,
              f.operateur, f.dateoperation, c.numeropolice, c.idcontrat, d.numerodevis"""
JOINTURES = """LEFT JOIN LATERAL (SELECT x.idcontrat, x.numeropolice FROM stdcontrat x WHERE x.iddevis = f.iddevis AND COALESCE(x.idcontratannulation, 0) = 0
                                  ORDER BY x.idcontrat DESC LIMIT 1) c ON TRUE
               LEFT JOIN stddevis d ON d.iddevis = f.iddevis"""


def historique(cursor, cles, cles_familles=(), sauf_devis=None):
    """Cartes réellement facturées (contrat non annulé) aux personnes demandées : {clé : [lignes, de la plus récente à la plus ancienne]}."""
    cles, cles_familles = list(cles), list(cles_familles)
    if not cles and not cles_familles:
        return {}
    cursor.execute(
        f"""SELECT {COLONNES} FROM lephare_carte_facturation f {JOINTURES}
            WHERE f.statut = 'V' AND c.idcontrat IS NOT NULL AND f.iddevis <> %s AND (f.cle = ANY(%s) OR (f.anonyme AND f.clefamille = ANY(%s)))
            ORDER BY f.dateoperation DESC, f.idfacturation DESC""",
        [sauf_devis or 0, cles, cles_familles],
    )
    resultat = {}
    for ligne in cursor.fetchall():
        entree = _ligne_historique(ligne)
        resultat.setdefault(entree["Cle"], []).append(entree)
    return resultat


def personnes_de_la_ligne(ligne):
    """Personnes dont la saisie demande une carte. Ajout à une famille existante : seulement les personnes ajoutées."""
    cle_famille = cle_personne(ligne["Nom"], ligne["Prenoms"], ligne["DateNaissance"])
    personnes = []
    if not ligne.get("IdAdherentBase"):
        personnes.append({"Cle": cle_famille, "CleFamille": cle_famille, "Anonyme": False, "Lien": "A", "Nom": ligne["Nom"], "Prenoms": ligne["Prenoms"],
                          "DateNaissance": ligne["DateNaissance"]})
    for ayant in ligne.get("Ayants") or []:
        personnes.append({"Cle": cle_personne(ayant["Nom"], ayant["Prenoms"], ayant["DateNaissance"]), "CleFamille": cle_famille, "Anonyme": False,
                          "Lien": ayant["Lien"], "Nom": ayant["Nom"], "Prenoms": ayant["Prenoms"], "DateNaissance": ayant["DateNaissance"]})
    if not ligne.get("IdAdherentBase"):
        for rang in range(1, max(int(ligne.get("Personnes") or 0) - len(personnes), 0) + 1):
            personnes.append({"Cle": f"{cle_famille}#{rang}", "CleFamille": cle_famille, "Anonyme": True, "Lien": "?", "Nom": ligne["Nom"], "Prenoms": ligne["Prenoms"],
                              "DateNaissance": None})
    return personnes


def evaluer(personnes, cartes, pertes=()):
    """
    État de chaque personne, sans écriture. cartes : {clé : historique} ; pertes : clés choisies en « Renouvellement pour perte ».
    Une carte d'une personne non nommée couvre la première personne de sa famille qui n'a pas de carte à son nom.
    """
    pertes = set(pertes)
    non_nommees = {}
    for lignes in cartes.values():
        for entree in lignes:
            if entree["Anonyme"]:
                non_nommees.setdefault(entree["CleFamille"], []).append(entree)
    # Une personne non nommée garde d'abord la carte de son rang
    for personne in personnes:
        if personne["Anonyme"] and cartes.get(personne["Cle"]):
            non_nommees[personne["CleFamille"]] = [e for e in non_nommees.get(personne["CleFamille"], []) if e["Cle"] != personne["Cle"]]
    resultat = []
    for personne in personnes:
        lignes = cartes.get(personne["Cle"]) or []
        if not lignes and non_nommees.get(personne["CleFamille"]):
            lignes = [non_nommees[personne["CleFamille"]].pop(0)]
        if not lignes:
            etat = A_FACTURER
        elif personne["Cle"] in pertes:
            etat = PERTE
        else:
            etat = DEJA_FACTUREE
        resultat.append({**personne, "Etat": etat, "Historique": lignes})
    return resultat


def preparer_lignes(cursor, lignes, sauf_devis=None, pertes=()):
    """Avant le calcul des primes : pose sur chaque ligne le nombre de cartes à facturer et l'état de chaque personne."""
    personnes_par_rang = {ligne["Rang"]: personnes_de_la_ligne(ligne) for ligne in lignes}
    toutes = [p for personnes in personnes_par_rang.values() for p in personnes]
    cartes = historique(cursor, {p["Cle"] for p in toutes}, {p["CleFamille"] for p in toutes}, sauf_devis)
    for ligne in lignes:
        etats = evaluer(personnes_par_rang[ligne["Rang"]], cartes, pertes)
        ligne["Cartes"] = etats
        ligne["CartesAFacturer"] = sum(1 for e in etats if e["Etat"] in (A_FACTURER, PERTE))


def json_personne(etat):
    derniere = etat["Historique"][0] if etat["Historique"] else None
    naissance = etat["DateNaissance"]
    personne = {"Cle": etat["Cle"], "Personne": "Personne non nommée de la famille " + libelle_personne(etat) if etat["Anonyme"] else libelle_personne(etat),
                "Nom": etat["Nom"], "Prenoms": etat["Prenoms"], "DateNaissance": naissance.isoformat() if hasattr(naissance, "isoformat") else naissance,
                "Lien": etat["Lien"], "Anonyme": etat["Anonyme"], "Etat": etat["Etat"], "Historique": etat["Historique"], "Derniere": derniere}
    if etat["Etat"] == DEJA_FACTUREE:
        personne["Alerte"] = message_alerte({"Nom": personne["Personne"]}, derniere)
    return personne


def synthese(lignes, montant):
    """Réponse de la vérification : personnes déjà facturées, à refacturer pour perte, nombre et montant à facturer."""
    etats = [e for ligne in lignes for e in ligne.get("Cartes", [])]
    a_facturer = sum(1 for e in etats if e["Etat"] in (A_FACTURER, PERTE))
    deja = [json_personne(e) for e in etats if e["Etat"] == DEJA_FACTUREE]
    pertes = [json_personne(e) for e in etats if e["Etat"] == PERTE]
    alerte = ""
    if len(deja) == 1:
        alerte = deja[0]["Alerte"]
    elif deja:
        alerte = (f"Une facturation de carte existe déjà pour {len(deja)} personnes : leur carte n'est pas facturée de nouveau. "
                  "Un renouvellement pour perte est nécessaire pour poursuivre.")
    return {
        "Montant": float(montant or 0), "Personnes": len(etats), "AFacturer": a_facturer, "MontantTotal": float(Decimal(str(montant or 0)) * a_facturer),
        "DejaFacturees": deja, "Pertes": pertes, "Alerte": alerte,
        # Ajouts à une famille existante : hors du calcul de l'aperçu, comptés à part par l'écran
        "MontantAjouts": float(Decimal(str(montant or 0)) * sum(ligne.get("CartesAFacturer", 0) for ligne in lignes if ligne.get("IdAdherentBase"))),
    }


def nom_utilisateur(id_utilisateur):
    compte = get_user_model().objects.filter(pk=id_utilisateur).first() if id_utilisateur else None
    if not compte:
        return ""
    return (compte.get_full_name() or compte.email or "")[:150]


def effacer_du_devis(cursor, id_devis):
    """Devis modifié avant confirmation : ses lignes sont réécrites. Rien n'a encore été réellement facturé."""
    cursor.execute("DELETE FROM lephare_carte_facturation WHERE iddevis = %s", [id_devis])


def annuler_du_devis(cursor, id_devis, motif):
    """Devis supprimé : l'historique reste, la carte n'est plus comptée comme facturée."""
    cursor.execute("UPDATE lephare_carte_facturation SET statut = 'A', observation = %s WHERE iddevis = %s AND statut = 'V'", [motif[:300], id_devis])


def ecrire(cursor, id_devis, etats, montant, id_utilisateur, observation=""):
    """Note au registre les cartes facturées par ce devis : première facturation ou renouvellement pour perte."""
    operateur = nom_utilisateur(id_utilisateur)
    nombre = 0
    for etat in etats:
        if etat["Etat"] not in (A_FACTURER, PERTE):
            continue
        cursor.execute(
            """INSERT INTO lephare_carte_facturation (cle, clefamille, anonyme, nom, prenoms, datenaissance, lien, iddevis, montant, motif, observation, idoperateur, operateur)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [etat["Cle"], etat["CleFamille"], etat["Anonyme"], (etat["Nom"] or "")[:100], (etat["Prenoms"] or "")[:100], etat["DateNaissance"], etat["Lien"], id_devis, montant,
             MOTIF_PERTE if etat["Etat"] == PERTE else MOTIF_PREMIERE, observation[:300], id_utilisateur or None, operateur],
        )
        nombre += 1
    return nombre


def pertes_du_devis(cursor, id_devis):
    """Clés notées en renouvellement pour perte sur ce devis : reprises quand on rouvre un devis non confirmé."""
    cursor.execute("SELECT cle FROM lephare_carte_facturation WHERE iddevis = %s AND motif = 'PERTE' AND statut = 'V'", [id_devis])
    return [ligne[0] for ligne in cursor.fetchall()]


def controler_emission(cursor, id_devis):
    """À l'émission : une première facturation ne doit pas être passée sur un autre contrat depuis l'enregistrement du devis."""
    cursor.execute("SELECT pg_advisory_xact_lock(%s)", [VERROU_REGISTRE])
    cursor.execute("SELECT DISTINCT cle, nom, prenoms FROM lephare_carte_facturation WHERE iddevis = %s AND motif = 'PREMIERE' AND statut = 'V'", [id_devis])
    lignes = cursor.fetchall()
    if not lignes:
        return
    cartes = historique(cursor, {l[0] for l in lignes}, set(), id_devis)
    refus = []
    for cle, nom, prenoms in lignes:
        if cartes.get(cle):
            refus.append(message_alerte({"Nom": nom, "Prenoms": prenoms}, cartes[cle][0]))
    if refus:
        raise CarteDejaFacturee(f"{refus[0]} Modifiez le devis avant de l'émettre." + (f" {len(refus) - 1} autres personnes sont dans le même cas." if len(refus) > 1 else ""))


def registre(cursor, texte="", limite=200):
    """Historique complet, recherche par nom ou par police, avec les lignes de devis non confirmés signalées comme telles."""
    filtre, parametres = "", []
    if texte:
        motif = f"%{_normaliser(texte).replace(' ', '%')}%"
        filtre = "AND (f.cle LIKE %s OR TRIM(COALESCE(c.numeropolice, '')) ILIKE %s OR TRIM(COALESCE(d.numerodevis, '')) ILIKE %s)"
        parametres = [motif, f"%{texte.strip()}%", f"%{texte.strip()}%"]
    cursor.execute(
        f"""SELECT {COLONNES} FROM lephare_carte_facturation f {JOINTURES}
            WHERE f.statut = 'V' {filtre} ORDER BY f.dateoperation DESC, f.idfacturation DESC LIMIT %s""",
        [*parametres, limite],
    )
    return [_ligne_historique(ligne) for ligne in cursor.fetchall()]
