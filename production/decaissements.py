"""
Décaissement de tout règlement (demande du 2026-11-06). Jusqu'ici, le portefeuille ne décaissait qu'un chèque revenu impayé
(database.decaisser_cheque_impaye). Tout autre règlement se décaisse désormais de la même façon, espèces comprises : virement rejeté,
paiement mobile annulé, espèces rendues au client, erreur de caisse, compensation à défaire.

Décaisser un règlement = contre-passer son encaissement par sp_annulation_encaissement (ligne négative, quittances de nouveau à encaisser,
solde du client rétabli), avec un motif et une date, puis le réencaisser plus tard s'il y a lieu, comme un chèque impayé.
Ne se décaissent pas :
- un règlement déjà reversé à la compagnie (la procédure le refuse aussi) : annuler d'abord le bordereau de reversement ;
- un chèque du portefeuille : il se décaisse par « Impayé », qui traite toutes les quittances du chèque ensemble ;
- une contre-passation (annulation, contrepartie d'annulation, décaissement de prime mal affectée) : elle sort déjà de l'argent.
Le montant réencaissé se lit sur les encaissements liés non annulés : un réencaissement annulé ne compte plus.
Un réencaissement décaissé à son tour est reporté sur son origine (décaissement ou chèque impayé, qui redevient impayé) : la somme n'est
à réencaisser qu'une fois, depuis l'origine.

Routes : GET caisse/reglements/ (règlements décaissables), POST caisse/reglements/<id>/decaissement/ (droit encaissements.cancel, motif),
GET caisse/decaissements/ (historique et quittances à réencaisser). Réencaissement : enregistrementencaissement avec id_decaissement.
"""

import logging
from datetime import date, datetime

from django.db import DatabaseError, connection, transaction
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from .renouvellement import AUTHENTIFICATION, _lignes

logger = logging.getLogger(__name__)

# Contre-passations et mode vide : ils ne se décaissent pas
MODES_EXCLUS = ("ANL", "CPA", "DMA", "RER")
MOTIF_MINIMUM = 5
MAX_LIGNES = 300
# Référence du règlement : numéro du chèque, du virement ou de la traite, bordereau d'espèces, reçu de l'opérateur, compensation, transaction
SQL_REFERENCE = """COALESCE(NULLIF(TRIM(e.numerocheque), ''), NULLIF(TRIM(e.numerobordereau), ''), NULLIF(TRIM(e.numerorecuoperateur), ''),
    NULLIF(TRIM(e.compte_compensation), ''), e.referencetransaction::text, '')"""
SQL_REVERSE = """(EXISTS (SELECT 1 FROM stddetailreversement r JOIN stddetailencaissement d2 ON d2.iddetailencaissement = r.iddetailencaissement
                         WHERE d2.idencaissement = e.idencaissement)
                 OR EXISTS (SELECT 1 FROM stddetailencaissement d3 WHERE d3.idencaissement = e.idencaissement AND COALESCE(d3.montantreglement, 0) > 0))"""
SQL_CHEQUE = "EXISTS (SELECT 1 FROM stdchequeoperation op WHERE op.idencaissement = e.idencaissement)"


class ErreurDecaissement(Exception):
    """Saisie refusée : message affiché tel quel."""


def _nombre(valeur):
    return float(valeur) if valeur is not None else 0.0


def _iso(valeur):
    return valeur.isoformat() if hasattr(valeur, "isoformat") else valeur


def _date(valeur, defaut=None):
    if valeur in (None, ""):
        return defaut
    if isinstance(valeur, datetime):
        return valeur.date()
    if isinstance(valeur, date):
        return valeur
    texte = str(valeur).strip()[:10]
    for format_ in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(texte, format_).date()
        except ValueError:
            pass
    raise ErreurDecaissement(f"Date illisible : {valeur}.")


def _operateur(user):
    return ((getattr(user, "name", "") or (user.get_full_name() if hasattr(user, "get_full_name") else "") or getattr(user, "email", "") or ""))[:150]


def controler_saisie(motif, date_decaissement, date_encaissement, aujourd_hui=None):
    """Motif et date du décaissement : motif d'au moins 5 caractères ; date ni future, ni antérieure au règlement."""
    motif = " ".join(str(motif or "").split())
    if len(motif) < MOTIF_MINIMUM:
        raise ErreurDecaissement("Précisez le motif de l'annulation (5 caractères au moins).")
    jour = _date(date_decaissement, aujourd_hui or date.today())
    if jour > (aujourd_hui or date.today()):
        raise ErreurDecaissement("La date de l'annulation ne peut pas être postérieure à aujourd'hui.")
    if date_encaissement and jour < date_encaissement:
        raise ErreurDecaissement(f"La date de l'annulation précède celle du règlement ({date_encaissement:%d/%m/%Y}).")
    return motif[:230], jour


def refus_decaissement(reglement):
    """Raison pour laquelle ce règlement ne se décaisse pas, ou chaîne vide."""
    if reglement.get("annule"):
        return "Ce règlement est déjà annulé."
    if (reglement.get("montant") or 0) <= 0:
        return "Ce mouvement est une contre-passation : il ne s'annule pas."
    if (reglement.get("code_mode") or "") in MODES_EXCLUS:
        return "Ce mode (annulation, contrepartie, décaissement de prime mal affectée) ne s'annule pas."
    if reglement.get("cheque"):
        return "Ce règlement est un chèque du portefeuille : annulez-le dans l'onglet Chèques (bouton Annuler)."
    if reglement.get("reverse"):
        return "Ce règlement est déjà reversé à la compagnie : annulez d'abord le bordereau de reversement."
    return ""


# ------------------------------------------------------------------ lectures
def _sql_reglements(conditions):
    return f"""
        SELECT e.idencaissement, TRIM(e.numeropiece) AS numeropiece, e.dateencaissement::date AS dateencaissement, e.montantencaissement AS montant,
               COALESCE(e.piece_annulee, FALSE) AS annule, e.idmodepaiement, TRIM(COALESCE(m.libellemodepaiement, '')) AS mode,
               TRIM(COALESCE(m.abregereglement, '')) AS code_mode, {SQL_REFERENCE} AS reference, NULLIF(TRIM(e.nomtireurcheque), '') AS emetteur,
               u.name AS operateur, {SQL_REVERSE} AS reverse, {SQL_CHEQUE} AS cheque,
               STRING_AGG(DISTINCT TRIM(de.numeroquittance), ', ') AS quittances, STRING_AGG(DISTINCT TRIM(q.numeropolice), ', ') AS polices,
               STRING_AGG(DISTINCT NULLIF(TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')), ''), ', ') AS clients
        FROM stdencaissement e
        LEFT JOIN stdmodeencaissement m ON m.idmodeencaissement = e.idmodepaiement
        LEFT JOIN stddetailencaissement de ON de.idencaissement = e.idencaissement
        LEFT JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
        LEFT JOIN stdclient cl ON cl.idclient = q.idclient
        LEFT JOIN account_uranususer u ON u.id = e.idutilisateur
        WHERE {" AND ".join(conditions)}
        GROUP BY e.idencaissement, m.libellemodepaiement, m.abregereglement, u.name"""


def _json_reglement(r):
    refus = refus_decaissement(r)
    return {"IdEncaissement": r["idencaissement"], "NumeroPiece": r["numeropiece"] or "", "Date": _iso(r["dateencaissement"]), "Montant": _nombre(r["montant"]),
            "IdMode": r["idmodepaiement"], "Mode": r["mode"], "CodeMode": r["code_mode"], "Reference": r["reference"] or "", "Emetteur": r["emetteur"] or "",
            "Operateur": r["operateur"] or "", "Quittances": r["quittances"] or "", "Polices": r["polices"] or "", "Clients": r["clients"] or "",
            "Reverse": bool(r["reverse"]), "Decaissable": not refus, "Refus": refus}


def reglements(parametres):
    """Règlements encaissés hors chèques du portefeuille, les plus récents d'abord ; chacun dit s'il se décaisse et sinon pourquoi."""
    conditions = ["NOT COALESCE(e.piece_annulee, FALSE)", "e.montantencaissement > 0", f"COALESCE(m.abregereglement, '') NOT IN {MODES_EXCLUS}", f"NOT {SQL_CHEQUE}"]
    valeurs = []
    texte = " ".join(str(parametres.get("q") or "").split())
    if len(texte) >= 2:
        motif = "%" + texte.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        champs = ["e.numeropiece", "e.numerocheque", "e.numerobordereau", "e.numerorecuoperateur", "e.compte_compensation", "e.referencetransaction::text",
                  "e.nomtireurcheque", "de.numeroquittance", "q.numeropolice", "TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, ''))"]
        possibles = [f"{c} ILIKE %s" for c in champs]
        valeurs += [motif] * len(champs)
        if texte.replace(" ", "").isdigit():
            possibles.append("e.montantencaissement = %s")
            valeurs.append(int(texte.replace(" ", "")))
        conditions.append(f"e.idencaissement IN (SELECT e.idencaissement FROM stdencaissement e LEFT JOIN stddetailencaissement de ON de.idencaissement = e.idencaissement "
                          f"LEFT JOIN stdquittance q ON q.numeroquittance = de.numeroquittance LEFT JOIN stdclient cl ON cl.idclient = q.idclient "
                          f"WHERE {' OR '.join(possibles)})")
    mode = str(parametres.get("mode") or "").strip()
    if mode.isdigit():
        conditions.append("e.idmodepaiement = %s")
        valeurs.append(int(mode))
    du, au = _date(parametres.get("du")), _date(parametres.get("au"))
    if du:
        conditions.append("e.dateencaissement::date >= %s")
        valeurs.append(du)
    if au:
        conditions.append("e.dateencaissement::date <= %s")
        valeurs.append(au)
    # Les règlements à afficher sont choisis d'abord (filtres, ordre, plafond), puis eux seuls sont joints à leurs
    # quittances et clients : la requête agrégeait tous les encaissements de la base avant d'en garder 300
    ordre = "ORDER BY e.dateencaissement DESC, e.idencaissement DESC"
    choisis = (f"e.idencaissement IN (SELECT e.idencaissement FROM stdencaissement e "
               f"LEFT JOIN stdmodeencaissement m ON m.idmodeencaissement = e.idmodepaiement "
               f"WHERE {' AND '.join(conditions)} {ordre} LIMIT %s)")
    with connection.cursor() as cursor:
        lignes = _lignes(cursor, f"{_sql_reglements([choisis])} {ordre}", valeurs + [MAX_LIGNES + 1])
        modes = _lignes(cursor, f"""SELECT idmodeencaissement AS id, TRIM(libellemodepaiement) AS libelle FROM stdmodeencaissement
                                   WHERE COALESCE(abregereglement, '') NOT IN {MODES_EXCLUS} ORDER BY COALESCE(ordreaffichage, '99'), libellemodepaiement""")
    return {"Reglements": [_json_reglement(r) for r in lignes[:MAX_LIGNES]], "Tronque": len(lignes) > MAX_LIGNES,
            "Modes": [{"Id": m["id"], "Libelle": m["libelle"]} for m in modes]}


def decaissements(parametres):
    """Historique des décaissements, avec les quittances du règlement d'origine et le montant déjà réencaissé."""
    statut = str(parametres.get("statut") or "").strip().upper()
    with connection.cursor() as cursor:
        lignes = _lignes(cursor, """
            SELECT d.*, COALESCE((SELECT SUM(e.montantencaissement) FROM lephare_decaissement_reencaissement r JOIN stdencaissement e ON e.idencaissement = r.idencaissement
                                  WHERE r.iddecaissement = d.iddecaissement AND NOT COALESCE(e.piece_annulee, FALSE) AND e.montantencaissement > 0), 0) AS reencaisse
            FROM lephare_decaissement d ORDER BY d.datedecaissement DESC, d.iddecaissement DESC LIMIT 500""")
        details = {}
        if lignes:
            for q in _lignes(cursor, """
                    SELECT de.idencaissement, TRIM(de.numeroquittance) AS numero, de.montant_encaissement AS montant, TRIM(q.numeropolice) AS police,
                           NULLIF(TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')), '') AS client,
                           GREATEST(COALESCE(q.primettc, 0) - COALESCE(q.mt_encaisse, 0), 0) AS reste
                    FROM stddetailencaissement de LEFT JOIN stdquittance q ON q.numeroquittance = de.numeroquittance LEFT JOIN stdclient cl ON cl.idclient = q.idclient
                    WHERE de.idencaissement = ANY(%s) AND de.montant_encaissement > 0 ORDER BY de.iddetailencaissement""", [[l["idencaissement"] for l in lignes]]):
                details.setdefault(q["idencaissement"], []).append({"Numero": q["numero"], "Police": q["police"] or "", "Client": q["client"] or "",
                                                                     "Montant": _nombre(q["montant"]), "ResteDu": _nombre(q["reste"])})
    resultat = []
    for l in lignes:
        reste = max(_nombre(l["montant"]) - _nombre(l["reencaisse"]), 0)
        code = "REENCAISSE" if reste <= 0 else "A_REENCAISSER"
        libelle = "Réencaissé" if code == "REENCAISSE" else "À réencaisser"
        if l["iddecaissementorigine"] or l["idchequeorigine"]:
            # Réencaissement décaissé : la somme se réencaisse depuis son origine, qui redevient à réencaisser
            reste, code = 0.0, "REPORTE"
            libelle = (f"Reporté sur l'annulation n° {l['iddecaissementorigine']}" if l["iddecaissementorigine"]
                       else "Reporté sur le chèque annulé")
        if statut and statut != code:
            continue
        resultat.append({"IdDecaissement": l["iddecaissement"], "IdEncaissement": l["idencaissement"], "NumeroPiece": l["numeropiece"], "Mode": l["mode"],
                         "Reference": l["reference"], "Montant": _nombre(l["montant"]), "Reencaisse": _nombre(l["reencaisse"]), "ResteAReencaisser": reste,
                         "Statut": code, "LibelleStatut": libelle, "Motif": l["motif"],
                         "Date": _iso(l["datedecaissement"]), "Quittances": details.get(l["idencaissement"], []), "Clients": l["clients"], "Operateur": l["operateur"],
                         "SaisiLe": _iso(l["datecreation"])})
    return {"Decaissements": resultat}


# ------------------------------------------------------------------ écritures
def decaisser(user, id_encaissement, motif, date_decaissement):
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("SELECT idencaissement FROM stdencaissement WHERE idencaissement = %s FOR UPDATE", [id_encaissement])
        if not cursor.fetchone():
            raise ErreurDecaissement("Règlement introuvable.")
        lignes = _lignes(cursor, _sql_reglements(["e.idencaissement = %s"]), [id_encaissement])
        reglement = lignes[0]
        refus = refus_decaissement(reglement)
        if refus:
            raise ErreurDecaissement(refus)
        motif, jour = controler_saisie(motif, date_decaissement, reglement["dateencaissement"])
        # Ce règlement réencaissait-il un décaissement ou un chèque impayé ?
        cursor.execute("SELECT iddecaissement FROM lephare_decaissement_reencaissement WHERE idencaissement = %s LIMIT 1", [id_encaissement])
        origine = cursor.fetchone()
        origine = origine[0] if origine else None
        cursor.execute("SELECT idchequeimpaye FROM stdencaissement WHERE idencaissement = %s", [id_encaissement])
        cheque_origine = cursor.fetchone()[0]
        cursor.execute("CALL sp_annulation_encaissement(%s, %s, %s, %s, %s, %s);", [id_encaissement, user.id, jour, f"Annulation : {motif}"[:255], 0, ""])
        ligne = cursor.fetchone()
        if not ligne or not ligne[0]:
            raise ErreurDecaissement((ligne[1] if ligne and ligne[1] else "L'annulation n'a pas pu être enregistrée.").split("\n")[0])
        cursor.execute(
            """INSERT INTO lephare_decaissement (idencaissement, idencaissementannulation, numeropiece, idmodepaiement, mode, reference, montant, motif,
                                                 datedecaissement, quittances, clients, iddecaissementorigine, idchequeorigine, idoperateur, operateur)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING iddecaissement""",
            [id_encaissement, ligne[0], (reglement["numeropiece"] or "")[:20], reglement["idmodepaiement"], (reglement["mode"] or "")[:100],
             (reglement["reference"] or "")[:100], reglement["montant"], motif, jour, (reglement["quittances"] or "")[:500], (reglement["clients"] or "")[:500],
             origine, cheque_origine, getattr(user, "id", None), _operateur(user)],
        )
        id_decaissement = cursor.fetchone()[0]
        if cheque_origine:
            # Le chèque impayé n'est plus entièrement réencaissé : il redevient impayé
            cursor.execute("""UPDATE stdcheque c SET statut = 'IMPAYE' WHERE c.idcheque = %s AND c.statut = 'REENCAISSE'
                                AND COALESCE((SELECT SUM(e.montantencaissement) FROM stdencaissement e WHERE e.idchequeimpaye = c.idcheque
                                              AND NOT COALESCE(e.piece_annulee, FALSE) AND e.montantencaissement > 0), 0) < COALESCE(c.montantimpaye, 0)""",
                           [cheque_origine])
    montant = f"{reglement['montant']:,.0f}".replace(",", " ")
    return {"IdDecaissement": id_decaissement, "IdEncaissementAnnulation": ligne[0], "Montant": _nombre(reglement["montant"]),
            "Message": f"Règlement {reglement['mode'].lower()} de {montant} F annulé : ses quittances sont de nouveau à encaisser."}


def verrouiller_pour_reencaissement(cursor, id_decaissement):
    """Décaissement à réencaisser (appelé par database.save_premium_collection) : verrouillé jusqu'à la fin de l'encaissement."""
    cursor.execute("SELECT iddecaissement, montant FROM lephare_decaissement WHERE iddecaissement = %s FOR UPDATE", [id_decaissement])
    ligne = cursor.fetchone()
    if not ligne:
        raise ErreurDecaissement("Annulation introuvable.")
    cursor.execute("""SELECT COALESCE(SUM(e.montantencaissement), 0) FROM lephare_decaissement_reencaissement r JOIN stdencaissement e ON e.idencaissement = r.idencaissement
                      WHERE r.iddecaissement = %s AND NOT COALESCE(e.piece_annulee, FALSE) AND e.montantencaissement > 0""", [id_decaissement])
    if cursor.fetchone()[0] >= ligne[1]:
        raise ErreurDecaissement("Cette annulation est déjà entièrement réencaissée.")


def lier_reencaissement(cursor, id_decaissement, id_encaissement):
    cursor.execute("INSERT INTO lephare_decaissement_reencaissement (iddecaissement, idencaissement) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                   [id_decaissement, id_encaissement])


# ------------------------------------------------------------------ routes
def _reponse(fonction, *args, code=status.HTTP_200_OK):
    try:
        return Response(fonction(*args), status=code)
    except ErreurDecaissement as erreur:
        return Response({"erreur": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except DatabaseError as erreur:
        logger.exception("Décaissement : erreur de base")
        return Response({"erreur": str(erreur).split("\n")[0]}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_reglements(request):
    return _reponse(reglements, request.query_params)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_decaissements(request):
    return _reponse(decaissements, request.query_params)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def vue_decaissement(request, id_encaissement):
    return _reponse(decaisser, request.user, id_encaissement, request.data.get("motif"), request.data.get("date_decaissement"), code=status.HTTP_201_CREATED)
