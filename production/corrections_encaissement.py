"""
Correction d'un encaissement saisi par erreur (demande du 2026-11-11 : « souvent lors de l'encaissement l'utilisateur se trompe de
client à encaisser, de numéro de référence du chèque ou autre : permets l'annulation »).

Trois cas, du plus léger au plus lourd :
1. RÉFÉRENCES : n° du chèque (du virement, de la traite), banque, montant initial du chèque, émetteur, dates d'émission et de
   réception, bordereau d'espèces, reçu de l'opérateur, compensation, ordre du règlement. Montant, client et quittances ne changent
   pas : corrigé sur place (le chèque du portefeuille et toutes les pièces qu'il règle avec lui), avant et après au journal d'audit.
2. ANNULER ET RÉAFFECTER : mauvais client, mauvaise quittance, mauvais montant ou mauvais mode. La pièce est contre-passée
   (sp_annulation_encaissement : ligne négative, quittances de nouveau à encaisser, solde du client rétabli), son chèque libéré, puis le
   bon encaissement est enregistré (database.save_premium_collection) dans la même transaction : tout ou rien.
3. ANNULER : saisie en double ou sans objet. Contre-passation seule : l'argent n'a pas été reçu deux fois, il n'y a rien à
   réencaisser, à la différence de l'annulation du Portefeuille des règlements (production/decaissements.py) où l'argent sort.

Qui : l'auteur de la saisie le jour même (droit encaissements.create, il corrige sa propre erreur aussitôt), sinon un responsable
(droit encaissements.cancel). Motif obligatoire. Refus : pièce déjà annulée, contre-passation, reversée à la compagnie, commission
réclamée, chèque déclaré impayé ; réaffectation d'un paiement mobile DistriPay (sa transaction ne sert qu'une fois).
Trace : motif « Correction : … » sur la pièce annulée, entrée « encaissements.correction » au journal d'audit (avant, après, pièces).

Routes : GET caisse/encaissements/du-jour/, GET caisse/encaissements/<id>/correction/,
POST caisse/encaissements/<id>/correction/references/, POST caisse/encaissements/<id>/correction/annulation/.
"""

import logging
import re
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as ErreurDjango
from django.db import DatabaseError, connection, transaction
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import APIException
from rest_framework.response import Response

from autorisations.journal import journaliser
from autorisations.rbac import a_le_droit
from core.date_parser import date_emission_du_jour

from .decaissements import MODES_EXCLUS, SQL_REFERENCE, SQL_REVERSE
from .renouvellement import AUTHENTIFICATION, _lignes

logger = logging.getLogger(__name__)

ACTION_JOURNAL = "encaissements.correction"
MOTIF_MINIMUM = 5
ORDRES = ("CABINET", "COMPAGNIE")
# Champs de référence corrigeables : (clé de l'API, colonne de stdencaissement, longueur, libellé)
CHAMPS_TEXTE = {
    "numero": ("numerocheque", 50, "Numéro"),
    "nom_emetteur": ("nomtireurcheque", 50, "Émetteur"),
    "numero_bordereau": ("numerobordereau", 50, "N° de bordereau"),
    "numero_recu_operateur": ("numerorecuoperateur", 50, "Reçu de l'opérateur"),
    "reference_compensation": ("compte_compensation", 50, "Référence de la compensation"),
    "motif_compensation": ("motifcompensation", 255, "Motif de la compensation"),
}


class ErreurCorrection(Exception):
    """Correction refusée : message affiché tel quel."""


# ------------------------------------------------------------------ outils
def _nombre(valeur):
    return float(valeur) if valeur is not None else 0.0


def _iso(valeur):
    return valeur.isoformat() if hasattr(valeur, "isoformat") else valeur


def _texte(valeur, longueur):
    return " ".join(str(valeur or "").split())[:longueur]


def _date(valeur, libelle):
    if valeur in (None, ""):
        return None
    if isinstance(valeur, datetime):
        return valeur.date()
    if isinstance(valeur, date):
        return valeur
    for format_ in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(str(valeur).strip()[:10], format_).date()
        except ValueError:
            pass
    raise ErreurCorrection(f"{libelle} illisible : {valeur}.")


def _montant(valeur, libelle):
    try:
        return Decimal(str(valeur).replace(" ", "").replace(" ", "").replace(",", "."))
    except (InvalidOperation, ValueError) as erreur:
        raise ErreurCorrection(f"{libelle} illisible.") from erreur


def _motif(valeur):
    motif = " ".join(str(valeur or "").split())
    if len(motif) < MOTIF_MINIMUM:
        raise ErreurCorrection("Précisez le motif de la correction (5 caractères au moins).")
    return motif[:200]


def _message(erreur):
    """Message lisible d'une erreur d'enregistrement (ValidationError de DRF ou de Django, ServiceError, base)."""
    detail = getattr(erreur, "detail", None) or getattr(erreur, "messages", None) or str(erreur)
    if isinstance(detail, dict):
        detail = next(iter(detail.values()), "")
    while isinstance(detail, (list, tuple)) and detail:
        detail = detail[0]
    return str(detail).split("\n")[0] or "Enregistrement refusé."


def _heure(moment):
    """Heure de saisie (« » si la base ne garde que la date : minuit)."""
    if not hasattr(moment, "strftime"):
        return ""
    if hasattr(moment, "tzinfo") and moment.tzinfo is not None:
        from django.utils import timezone

        moment = timezone.localtime(moment)
    heure = moment.strftime("%H:%M")
    return "" if heure == "00:00" else heure


def _distripay(reference):
    try:
        uuid.UUID(str(reference))
        return True
    except (TypeError, ValueError):
        return False


# ------------------------------------------------------------------ lecture
def _fiche(cursor, id_encaissement, verrou=False):
    lignes = _lignes(cursor, f"""
        SELECT e.idencaissement, TRIM(e.numeropiece) AS numeropiece, e.dateencaissement::date AS dateencaissement,
               COALESCE(e.created_at, e.datesaisie) AS datesaisie,
               e.montantencaissement AS montant, COALESCE(e.piece_annulee, FALSE) AS annule, e.idmodepaiement,
               TRIM(COALESCE(m.libellemodepaiement, '')) AS mode, UPPER(TRIM(COALESCE(m.abregereglement, ''))) AS code_mode,
               COALESCE(m.banque, FALSE) AS mode_bancaire, COALESCE(m.compensation, FALSE) AS mode_compensation,
               e.idbanque, TRIM(COALESCE(b.libelle, '')) AS banque, TRIM(COALESCE(e.numerocheque, '')) AS numerocheque,
               TRIM(COALESCE(e.nomtireurcheque, '')) AS nomtireurcheque, e.datecheque, e.datereceptioncheque,
               TRIM(COALESCE(e.numerobordereau, '')) AS numerobordereau, TRIM(COALESCE(e.numerorecuoperateur, '')) AS numerorecuoperateur,
               TRIM(COALESCE(e.compte_compensation, '')) AS compte_compensation, TRIM(COALESCE(e.motifcompensation, '')) AS motifcompensation,
               COALESCE(e.ordrereglement, 'CABINET') AS ordrereglement, e.idutilisateur, u.name AS operateur, e.idchequeimpaye,
               TRIM(COALESCE(e.referencereencaissement, '')) AS referencereencaissement, e.referencetransaction::text AS referencetransaction,
               {SQL_REFERENCE} AS reference, {SQL_REVERSE} AS reverse
        FROM stdencaissement e
        LEFT JOIN stdmodeencaissement m ON m.idmodeencaissement = e.idmodepaiement
        LEFT JOIN stdbanque b ON b.idbanque = e.idbanque
        LEFT JOIN account_uranususer u ON u.id = e.idutilisateur
        WHERE e.idencaissement = %s {"FOR UPDATE OF e" if verrou else ""}""", [id_encaissement])
    if not lignes:
        raise ErreurCorrection("Encaissement introuvable.")
    f = lignes[0]
    f["quittances"] = _lignes(cursor, """
        SELECT de.iddetailencaissement, TRIM(de.numeroquittance) AS numero, de.montant_encaissement AS montant, q.idquittance,
               TRIM(COALESCE(q.numeropolice, '')) AS police, NULLIF(TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')), '') AS client
        FROM stddetailencaissement de
        LEFT JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
        LEFT JOIN stdclient cl ON cl.idclient = q.idclient
        WHERE de.idencaissement = %s ORDER BY de.iddetailencaissement""", [id_encaissement])
    cheques = _lignes(cursor, f"""
        SELECT c.idcheque, TRIM(c.numerocheque) AS numero, c.idbanque, c.montantinitial, c.soldedisponible, c.statut, c.dateecheance, c.datedepot,
               op.idoperation, op.montantoperation, op.dateoperation,
               (SELECT COUNT(*) FROM stdchequeoperation o2 JOIN stdencaissement e2 ON e2.idencaissement = o2.idencaissement
                WHERE o2.idcheque = c.idcheque AND o2.idencaissement <> op.idencaissement AND NOT COALESCE(e2.piece_annulee, FALSE)) AS autres
        FROM stdchequeoperation op JOIN stdcheque c ON c.idcheque = op.idcheque
        WHERE op.idencaissement = %s {"FOR UPDATE OF c" if verrou else ""}""", [id_encaissement])
    f["cheque"] = cheques[0] if cheques else None
    numeros = [q["numero"] for q in f["quittances"]]
    cursor.execute("""SELECT EXISTS (SELECT 1 FROM std_detail_reclamation_commission d JOIN std_reclamation_commission r ON r.id = d.reclamation_id
                                     JOIN stdquittance q ON q.idquittance = d.quittance_id
                                     WHERE q.numeroquittance = ANY(%s) AND r.statut <> 'ANNULEE')""", [numeros])
    f["commission_reclamee"] = bool(cursor.fetchone()[0])
    cursor.execute("SELECT iddecaissement FROM lephare_decaissement_reencaissement WHERE idencaissement = %s LIMIT 1", [id_encaissement]) \
        if _table(cursor, "lephare_decaissement_reencaissement") else cursor.execute("SELECT NULL WHERE FALSE")
    ligne = cursor.fetchone()
    f["iddecaissement"] = ligne[0] if ligne else None
    return f


def _table(cursor, nom):
    cursor.execute("SELECT to_regclass(%s) IS NOT NULL", [f"public.{nom}"])
    return bool(cursor.fetchone()[0])


def _refus_commun(f):
    if f["annule"]:
        return "Cette pièce est déjà annulée."
    if (f["montant"] or 0) <= 0:
        return "Ce mouvement est une contre-passation : il ne se corrige pas."
    if f["code_mode"] in MODES_EXCLUS:
        return "Ce mode (annulation, contrepartie, décaissement de prime mal affectée) ne se corrige pas."
    if f["cheque"] and f["cheque"]["statut"] in ("IMPAYE", "REENCAISSE"):
        return "Le chèque de cette pièce est annulé dans le Portefeuille des règlements : il s'y réencaisse."
    return ""


def droits(user, f):
    """{References | Annulation | Reaffectation: raison du refus, vide si permis} pour cet utilisateur."""
    responsable = a_le_droit(user, "encaissements.cancel")
    auteur_du_jour = (f["idutilisateur"] == getattr(user, "id", None) and f["dateencaissement"] == date_emission_du_jour()
                      and a_le_droit(user, "encaissements.create"))
    commun = _refus_commun(f)
    habilitation = "" if responsable or auteur_du_jour else (
        "Seul l'auteur de la saisie peut la corriger le jour même ; ensuite, un responsable (droit « Annuler un encaissement »).")
    references = commun or habilitation or ("Pièce déjà reversée à la compagnie : seul un responsable en corrige les références."
                                            if f["reverse"] and not responsable else "")
    annulation = commun or habilitation or (
        "Pièce déjà reversée à la compagnie : annulez d'abord le bordereau de reversement." if f["reverse"] else
        "La commission de cette quittance est déjà réclamée à la compagnie." if f["commission_reclamee"] else "")
    reaffectation = annulation or ("Paiement mobile DistriPay : sa transaction ne sert qu'une fois. Annulez la pièce puis encaissez de "
                                   "nouveau depuis la caisse." if f["code_mode"] == "PYM" and _distripay(f["referencetransaction"]) else "")
    return {"References": references, "Annulation": annulation, "Reaffectation": reaffectation}


def _historique(cursor, id_encaissement):
    return [{"Date": _iso(l["date_creation"]), "Auteur": l["auteur"] or "", "Description": l["description"] or "", "Motif": l["motif"] or ""}
            for l in _lignes(cursor, """
                SELECT date_creation, auteur, description, motif FROM institutionnel_auditlogcima
                WHERE action = %s AND objet_type = 'encaissement'
                  AND (objet_id = %s OR details_json->>'Nouveau' = %s OR details_json->>'Origine' = %s)
                ORDER BY date_creation DESC LIMIT 20""", [ACTION_JOURNAL, str(id_encaissement), str(id_encaissement), str(id_encaissement)])]


def fiche(user, id_encaissement):
    with connection.cursor() as cursor:
        f = _fiche(cursor, id_encaissement)
        historique = _historique(cursor, id_encaissement)
    c = f["cheque"]
    return {
        "IdEncaissement": f["idencaissement"], "NumeroPiece": f["numeropiece"] or "", "DateSaisie": _iso(f["dateencaissement"]),
        "Heure": _heure(f["datesaisie"]), "Operateur": f["operateur"] or "",
        "Montant": _nombre(f["montant"]), "IdMode": f["idmodepaiement"], "Mode": f["mode"], "CodeMode": f["code_mode"],
        "Bancaire": bool(f["mode_bancaire"]), "Compensation": bool(f["mode_compensation"]), "Annule": bool(f["annule"]), "Reverse": bool(f["reverse"]),
        "Reference": f["reference"] or "",
        "References": {
            "IdBanque": f["idbanque"] or 1, "Banque": f["banque"], "Numero": f["numerocheque"], "NomEmetteur": f["nomtireurcheque"],
            "DateCheque": _iso(f["datecheque"]), "DateReceptionCheque": _iso(f["datereceptioncheque"]), "NumeroBordereau": f["numerobordereau"],
            "NumeroRecuOperateur": f["numerorecuoperateur"], "ReferenceCompensation": f["compte_compensation"],
            "MotifCompensation": f["motifcompensation"], "Ordre": f["ordrereglement"],
        },
        "Cheque": {"IdCheque": c["idcheque"], "Numero": c["numero"], "MontantInitial": _nombre(c["montantinitial"]),
                   "SoldeDisponible": _nombre(c["soldedisponible"]), "Statut": c["statut"], "Echeancier": bool(c["dateecheance"]),
                   "AutresPieces": c["autres"]} if c else None,
        "Quittances": [{"IdDetailEncaissement": q["iddetailencaissement"], "Numero": q["numero"], "Police": q["police"], "Client": q["client"] or "",
                        "Montant": _nombre(q["montant"])} for q in f["quittances"]],
        "Reencaissement": bool(f["idchequeimpaye"] or f["iddecaissement"]),
        "Refus": droits(user, f),
        "Historique": historique,
    }


def encaissements_du_jour(user, tous=False):
    """Pièces saisies aujourd'hui (les siennes ; toute la caisse pour un responsable qui le demande), à corriger depuis la caisse."""
    tous = tous and a_le_droit(user, "encaissements.cancel")
    with connection.cursor() as cursor:
        lignes = _lignes(cursor, f"""
            SELECT e.idencaissement, TRIM(e.numeropiece) AS numeropiece, COALESCE(e.created_at, e.datesaisie) AS datesaisie,
                   e.montantencaissement AS montant,
                   TRIM(COALESCE(m.libellemodepaiement, '')) AS mode, {SQL_REFERENCE} AS reference, u.name AS operateur,
                   STRING_AGG(DISTINCT TRIM(de.numeroquittance), ', ') AS quittances,
                   STRING_AGG(DISTINCT NULLIF(TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')), ''), ', ') AS clients
            FROM stdencaissement e
            LEFT JOIN stdmodeencaissement m ON m.idmodeencaissement = e.idmodepaiement
            LEFT JOIN stddetailencaissement de ON de.idencaissement = e.idencaissement
            LEFT JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
            LEFT JOIN stdclient cl ON cl.idclient = q.idclient
            LEFT JOIN account_uranususer u ON u.id = e.idutilisateur
            WHERE e.dateencaissement::date = %s AND NOT COALESCE(e.piece_annulee, FALSE) AND e.montantencaissement > 0
              AND COALESCE(UPPER(TRIM(m.abregereglement)), '') NOT IN {MODES_EXCLUS} {"" if tous else "AND e.idutilisateur = %s"}
            GROUP BY e.idencaissement, m.libellemodepaiement, u.name
            ORDER BY e.idencaissement DESC LIMIT 200""",
            [date_emission_du_jour()] + ([] if tous else [user.id]))
    return {"Encaissements": [{
        "IdEncaissement": l["idencaissement"], "NumeroPiece": l["numeropiece"] or "",
        "Heure": _heure(l["datesaisie"]), "Montant": _nombre(l["montant"]),
        "Mode": l["mode"], "Reference": l["reference"] or "", "Quittances": l["quittances"] or "", "Clients": l["clients"] or "",
        "Operateur": l["operateur"] or "",
    } for l in lignes], "Tous": tous}


# ------------------------------------------------------------------ 1. références
def corriger_references(user, id_encaissement, donnees):
    motif = _motif(donnees.get("motif"))
    with transaction.atomic(), connection.cursor() as cursor:
        f = _fiche(cursor, id_encaissement, verrou=True)
        refus = droits(user, f)["References"]
        if refus:
            raise ErreurCorrection(refus)
        cheque = f["cheque"]
        bancaire, especes = bool(f["mode_bancaire"]), f["code_mode"] == "ESP"
        nouveau, avant, apres = {}, {}, {}

        def changer(colonne, libelle, ancien, valeur):
            if (ancien or None) != (valeur or None):
                nouveau[colonne] = valeur
                avant[libelle], apres[libelle] = _iso(ancien) if ancien is not None else "", _iso(valeur) if valeur is not None else ""

        for cle, (colonne, longueur, libelle) in CHAMPS_TEXTE.items():
            if cle not in donnees:
                continue
            permis = {"numero": bancaire, "numero_bordereau": especes, "numero_recu_operateur": f["code_mode"] == "PYM",
                      "reference_compensation": f["mode_compensation"], "motif_compensation": f["mode_compensation"]}.get(cle, True)
            if not permis:
                continue
            valeur = _texte(donnees.get(cle), longueur)
            if cle in ("numero", "numero_bordereau", "numero_recu_operateur", "reference_compensation"):
                valeur = re.sub(r"[^\w \-/.]", "", valeur, flags=re.UNICODE).upper()
            changer(colonne, libelle, f[{"numero": "numerocheque", "nom_emetteur": "nomtireurcheque", "numero_bordereau": "numerobordereau",
                                         "numero_recu_operateur": "numerorecuoperateur", "reference_compensation": "compte_compensation",
                                         "motif_compensation": "motifcompensation"}[cle]], valeur)
        if bancaire and "id_banque" in donnees:
            id_banque = int(donnees.get("id_banque") or 1)
            cursor.execute("SELECT TRIM(libelle) FROM stdbanque WHERE idbanque = %s", [id_banque])
            libelle_banque = cursor.fetchone()
            if not libelle_banque:
                raise ErreurCorrection("Banque inconnue.")
            if id_banque != (f["idbanque"] or 1):
                nouveau["idbanque"] = id_banque
                avant["Banque"], apres["Banque"] = f["banque"], libelle_banque[0]
        if f["code_mode"] == "CHQ":
            if "date_cheque" in donnees:
                changer("datecheque", "Date d'émission du chèque", f["datecheque"], _date(donnees.get("date_cheque"), "Date d'émission"))
            if "date_reception_cheque" in donnees:
                reception = _date(donnees.get("date_reception_cheque"), "Date de réception")
                if not reception:
                    raise ErreurCorrection("La date de réception du chèque est à renseigner.")
                if reception > f["dateencaissement"]:
                    raise ErreurCorrection(f"La date de réception ne peut pas dépasser la date de saisie ({f['dateencaissement']:%d/%m/%Y}).")
                changer("datereceptioncheque", "Date de réception du chèque", f["datereceptioncheque"], reception)
        if "ordre" in donnees and bancaire and not especes and f["mode"].strip().lower() != "a la compagnie":
            ordre = str(donnees.get("ordre") or "").strip().upper()
            if ordre not in ORDRES:
                raise ErreurCorrection("Ordre du règlement inconnu.")
            if ordre == "COMPAGNIE" and ordre != f["ordrereglement"]:
                cursor.execute("""SELECT COUNT(DISTINCT COALESCE(ct.idcompagnie, q.idaperiteur)) FROM stdquittance q
                                  LEFT JOIN LATERAL (SELECT c.idcompagnie FROM stdcontrat c WHERE c.idquittance = q.idquittance ORDER BY c.idcontrat LIMIT 1) ct ON TRUE
                                  WHERE q.numeroquittance = ANY(%s)""", [[q["numero"] for q in f["quittances"]]])
                if cursor.fetchone()[0] > 1:
                    raise ErreurCorrection("Un règlement à l'ordre d'une compagnie ne peut régler que des primes de cette compagnie.")
            changer("ordrereglement", "À l'ordre de", f["ordrereglement"], ordre)

        # Contrôles des références obligatoires, comme à l'encaissement
        final = {c: nouveau.get(c, f.get({"idbanque": "idbanque"}.get(c, c))) for c in ("numerocheque", "idbanque", "numerorecuoperateur", "motifcompensation")}
        if f["code_mode"] == "CHQ" and ((final["idbanque"] or 1) <= 1 or not final["numerocheque"]):
            raise ErreurCorrection("Un chèque porte sa banque et son numéro.")
        if f["code_mode"] == "PYM" and "numerorecuoperateur" in nouveau and nouveau["numerorecuoperateur"]:
            cursor.execute("""SELECT 1 FROM stdencaissement WHERE UPPER(TRIM(numerorecuoperateur)) = %s AND idencaissement <> %s
                              AND NOT COALESCE(piece_annulee, FALSE) LIMIT 1""", [nouveau["numerorecuoperateur"], id_encaissement])
            if cursor.fetchone():
                raise ErreurCorrection("Ce numéro de reçu de l'opérateur a déjà servi pour un autre encaissement.")
        if f["mode_compensation"] and not final["motifcompensation"]:
            raise ErreurCorrection("Le motif de la compensation doit être précisé.")

        # Chèque du portefeuille : numéro, banque et montant initial portés par le chèque et par toutes les pièces qu'il règle
        pieces = [id_encaissement]
        maj_cheque = {}
        if cheque:
            if "numerocheque" in nouveau or "idbanque" in nouveau:
                numero, banque = nouveau.get("numerocheque", cheque["numero"]), nouveau.get("idbanque", cheque["idbanque"])
                cursor.execute("SELECT 1 FROM stdcheque WHERE TRIM(numerocheque) = %s AND idbanque = %s AND idcheque <> %s",
                               [numero, banque, cheque["idcheque"]])
                if cursor.fetchone():
                    raise ErreurCorrection(f"Un autre chèque n° {numero} de cette banque est déjà au portefeuille : si c'est le même, annulez cette "
                                           "pièce et réaffectez-la sur ce chèque.")
                maj_cheque.update({"numerocheque": numero, "idbanque": banque})
            if donnees.get("montant_initial_cheque") not in (None, ""):
                initial = _montant(donnees.get("montant_initial_cheque"), "Montant initial du chèque")
                if initial != cheque["montantinitial"]:
                    utilise = cheque["montantinitial"] - cheque["soldedisponible"]
                    if initial <= 0 or initial < utilise:
                        raise ErreurCorrection(f"Le montant initial ne peut pas être inférieur à ce que le chèque règle déjà ({utilise:,.0f} F)."
                                               .replace(",", " "))
                    maj_cheque.update({"montantinitial": initial, "soldedisponible": initial - utilise})
                    avant["Montant initial du chèque"], apres["Montant initial du chèque"] = _nombre(cheque["montantinitial"]), _nombre(initial)
            if "numerocheque" in nouveau or "idbanque" in nouveau:
                cursor.execute("""SELECT op.idencaissement FROM stdchequeoperation op JOIN stdencaissement e ON e.idencaissement = op.idencaissement
                                  WHERE op.idcheque = %s AND NOT COALESCE(e.piece_annulee, FALSE)""", [cheque["idcheque"]])
                pieces = sorted({id_encaissement, *(l[0] for l in cursor.fetchall())})
        if not avant:
            raise ErreurCorrection("Aucune référence modifiée.")
        if maj_cheque:
            cursor.execute(f"UPDATE stdcheque SET {', '.join(f'{c} = %s' for c in maj_cheque)} WHERE idcheque = %s",
                           [*maj_cheque.values(), cheque["idcheque"]])
        if nouveau:
            colonnes = dict(nouveau)
            cursor.execute(f"UPDATE stdencaissement SET {', '.join(f'{c} = %s' for c in colonnes)}, updated_at = now() WHERE idencaissement = %s",
                           [*colonnes.values(), id_encaissement])
            communs = {c: v for c, v in nouveau.items() if c in ("numerocheque", "idbanque")}
            if communs and len(pieces) > 1:
                cursor.execute(f"UPDATE stdencaissement SET {', '.join(f'{c} = %s' for c in communs)}, updated_at = now() "
                               f"WHERE idencaissement = ANY(%s) AND idencaissement <> %s", [*communs.values(), pieces, id_encaissement])
        description = (f"Pièce {f['numeropiece']} : références corrigées ({', '.join(avant)})"
                       + (f", reportées sur les {len(pieces) - 1} autre(s) pièce(s) du même chèque" if len(pieces) > 1 else ""))
        journaliser(utilisateur=user, module="encaissements", action=ACTION_JOURNAL, objet_type="encaissement", objet_id=id_encaissement,
                    description=description, avant=avant, apres=apres, motif=motif,
                    details={"Type": "REFERENCES", "Origine": id_encaissement, "Pieces": pieces}, type_operation="ENCAISSEMENT")
    return {"Message": description + ".", "Pieces": pieces, "Avant": avant, "Apres": apres}


# ------------------------------------------------------------------ 2 et 3. annulation, réaffectation
def _liberer_cheque(cursor, f):
    """Annulation de la pièce : le chèque retrouve le montant qu'elle consommait. Plus aucune pièce : un chèque de l'échéancier
    redevient à déposer ; un chèque créé par cette saisie disparaît (il reviendra s'il est encaissé de nouveau)."""
    c = f["cheque"]
    if not c:
        return
    cursor.execute("DELETE FROM stdchequeoperation WHERE idoperation = %s", [c["idoperation"]])
    cursor.execute("SELECT COUNT(*) FROM stdchequeoperation WHERE idcheque = %s", [c["idcheque"]])
    if cursor.fetchone()[0]:
        cursor.execute("UPDATE stdcheque SET soldedisponible = LEAST(montantinitial, soldedisponible + %s) WHERE idcheque = %s",
                       [c["montantoperation"], c["idcheque"]])
    elif c["dateecheance"]:
        cursor.execute("""UPDATE stdcheque SET soldedisponible = montantinitial, statut = 'A_DEPOSER',
                          datedepot = CASE WHEN datedepot = %s THEN NULL ELSE datedepot END WHERE idcheque = %s""", [c["dateoperation"], c["idcheque"]])
    else:
        cursor.execute("DELETE FROM stdcheque WHERE idcheque = %s", [c["idcheque"]])


def _instrument(f, saisi):
    """Moyen de paiement du nouvel encaissement : celui de la pièce annulée, sinon celui corrigé à l'écran."""
    if saisi:
        return dict(saisi)
    c = f["cheque"]
    return {
        "mode_encaissement": f["idmodepaiement"], "banque": f["idbanque"] or 1, "numero_cheque": f["numerocheque"],
        "montant_initial_cheque": c["montantinitial"] if c else None, "numero_bordereau": f["numerobordereau"],
        "numero_recu_operateur": f["numerorecuoperateur"], "reference_compensation": f["compte_compensation"],
        "motif_compensation": f["motifcompensation"], "ordre_reglement": f["ordrereglement"],
        "date_cheque": _iso(f["datecheque"]) or "", "date_reception_cheque": _iso(f["datereceptioncheque"]) or "",
        "nom_emetteur": f["nomtireurcheque"],
    }


def annuler(user, id_encaissement, donnees):
    from .database import save_premium_collection

    motif = _motif(donnees.get("motif"))
    reaffectation = donnees.get("reaffectation") or None
    liste, quittances_apres = [], []
    with transaction.atomic(), connection.cursor() as cursor:
        f = _fiche(cursor, id_encaissement, verrou=True)
        refus = droits(user, f)["Reaffectation" if reaffectation else "Annulation"]
        if refus:
            raise ErreurCorrection(refus)
        quittances_avant = [{"Quittance": q["numero"], "Police": q["police"], "Client": q["client"] or "", "Montant": _nombre(q["montant"])}
                            for q in f["quittances"]]
        nouveau = None
        if reaffectation:
            liste = [{"numero_quittance": str(q.get("numero_quittance") or "").strip(),
                      "montant_encaissement": str(_montant(q.get("montant_encaissement"), "Montant"))}
                     for q in (reaffectation.get("liste_quittance") or [])]
            liste = [q for q in liste if q["numero_quittance"] and Decimal(q["montant_encaissement"]) > 0]
            if not liste:
                raise ErreurCorrection("Choisissez la bonne quittance et le montant à encaisser.")
        texte = f"Correction : {motif}"
        cursor.execute("CALL sp_annulation_encaissement(%s, %s, %s, %s, %s, %s);", [id_encaissement, user.id, date_emission_du_jour(), texte[:255], 0, ""])
        ligne = cursor.fetchone()
        if not ligne or not ligne[0]:
            raise ErreurCorrection((ligne[1] if ligne and ligne[1] else "L'annulation n'a pas pu être enregistrée.").split("\n")[0])
        id_contre_passation = ligne[0]
        _liberer_cheque(cursor, f)
        if f["idchequeimpaye"]:
            # Le chèque impayé que cette pièce réencaissait redevient impayé (réencaissé de nouveau par la réaffectation, s'il y a lieu)
            cursor.execute("""UPDATE stdcheque c SET statut = 'IMPAYE' WHERE c.idcheque = %s AND c.statut = 'REENCAISSE'
                                AND COALESCE((SELECT SUM(e.montantencaissement) FROM stdencaissement e WHERE e.idchequeimpaye = c.idcheque
                                              AND NOT COALESCE(e.piece_annulee, FALSE) AND e.montantencaissement > 0), 0) < COALESCE(c.montantimpaye, 0)""",
                           [f["idchequeimpaye"]])
        if reaffectation:
            charge = _instrument(f, reaffectation.get("instrument"))
            charge.update({"liste_quittance": liste, "montant_total": str(sum(Decimal(q["montant_encaissement"]) for q in liste))})
            if f["idchequeimpaye"]:
                charge.update({"id_cheque_impaye": f["idchequeimpaye"], "reference_reencaissement": f["referencereencaissement"] or f["numeropiece"]})
            if f["iddecaissement"]:
                charge.update({"id_decaissement": f["iddecaissement"], "reference_reencaissement": f["referencereencaissement"] or f["numeropiece"]})
            try:
                resultat = save_premium_collection(user, charge)
            except (APIException, ErreurDjango, ValueError, KeyError) as erreur:
                raise ErreurCorrection(f"Nouvel encaissement refusé, rien n'est annulé : {_message(erreur)}") from erreur
            nouveau = _lignes(cursor, """SELECT e.idencaissement, TRIM(e.numeropiece) AS numeropiece, e.montantencaissement AS montant,
                                                (SELECT MIN(iddetailencaissement) FROM stddetailencaissement d WHERE d.idencaissement = e.idencaissement) AS iddetail
                                         FROM stdencaissement e WHERE e.idencaissement = %s""", [resultat["id_encaissement"]])[0]
            cursor.execute("UPDATE stdencaissement SET motifannulation = %s WHERE idencaissement = %s",
                           [f"{texte} - remplacée par la pièce {nouveau['numeropiece']}"[:255], id_encaissement])
            cursor.execute("""SELECT TRIM(de.numeroquittance), de.montant_encaissement, TRIM(COALESCE(q.numeropolice, '')),
                                     NULLIF(TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')), '')
                              FROM stddetailencaissement de LEFT JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
                              LEFT JOIN stdclient cl ON cl.idclient = q.idclient WHERE de.idencaissement = %s""", [nouveau["idencaissement"]])
            quittances_apres = [{"Quittance": n, "Police": p, "Client": c or "", "Montant": _nombre(m)} for n, m, p, c in cursor.fetchall()]
        montant = f"{f['montant']:,.0f}".replace(",", " ")
        if nouveau:
            description = (f"Pièce {f['numeropiece']} ({f['mode'].lower()}, {montant} F) annulée et réaffectée : nouvelle pièce "
                           f"{nouveau['numeropiece']} sur {', '.join(q['Quittance'] for q in quittances_apres)}")
        else:
            description = f"Pièce {f['numeropiece']} ({f['mode'].lower()}, {montant} F) annulée : saisie en double ou sans objet"
        journaliser(utilisateur=user, module="encaissements", action=ACTION_JOURNAL, objet_type="encaissement", objet_id=id_encaissement,
                    description=description, avant={"Pièce": f["numeropiece"], "Quittances": quittances_avant},
                    apres={"Pièce": nouveau["numeropiece"], "Quittances": quittances_apres} if nouveau else {"Annulée": True},
                    motif=motif, type_operation="ENCAISSEMENT",
                    details={"Type": "REAFFECTATION" if nouveau else "ANNULATION", "Origine": id_encaissement,
                             "ContrePassation": id_contre_passation, "Nouveau": nouveau["idencaissement"] if nouveau else None})
    return {
        "Message": description + ".", "IdContrePassation": id_contre_passation,
        "Nouveau": {"IdEncaissement": nouveau["idencaissement"], "NumeroPiece": nouveau["numeropiece"], "Montant": _nombre(nouveau["montant"]),
                    "IdDetailEncaissement": nouveau["iddetail"]} if nouveau else None,
    }


# ------------------------------------------------------------------ routes
def _reponse(fonction, *args, code=status.HTTP_200_OK):
    try:
        return Response(fonction(*args), status=code)
    except ErreurCorrection as erreur:
        return Response({"erreur": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except DatabaseError as erreur:
        logger.exception("Correction d'encaissement : erreur de base")
        return Response({"erreur": str(erreur).split("\n")[0]}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_du_jour(request):
    if not a_le_droit(request.user, "encaissements.view"):
        return Response({"erreur": "Accès refusé : droit « Consulter la caisse » requis."}, status=status.HTTP_403_FORBIDDEN)
    return _reponse(encaissements_du_jour, request.user, str(request.query_params.get("tous") or "") in ("1", "true"))


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_fiche(request, id_encaissement):
    # Défense en profondeur : la garde centrale exige déjà ce droit (autorisations/garde.py), qui ouvre aussi l'état des encaissements
    if not a_le_droit(request.user, "encaissements.view"):
        return Response({"erreur": "Accès refusé : droit « Consulter la caisse » requis."}, status=status.HTTP_403_FORBIDDEN)
    return _reponse(fiche, request.user, id_encaissement)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_references(request, id_encaissement):
    return _reponse(corriger_references, request.user, id_encaissement, request.data)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_annulation(request, id_encaissement):
    return _reponse(annuler, request.user, id_encaissement, request.data, code=status.HTTP_201_CREATED)
