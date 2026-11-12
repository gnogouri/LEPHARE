"""
Suppression définitive d'un devis ou d'un contrat, par habilitation (demande du 2026-11-03).

- GET    /api/devis/<id>/suppression/ et /api/contrat/<id>/suppression/ : ce qui serait supprimé et ce qui l'empêche
  (n'écrit rien).
- DELETE sur les mêmes routes : droits devis.delete et contrats.delete, motif obligatoire ; la garde garde au journal
  l'état d'avant la suppression (autorisations/garde.py).

Un contrat ne se supprime que si rien n'en dépend : pas d'encaissement (une annulation d'encaissement laisse ses lignes
dans l'historique de caisse), de commission réclamée ou payée, de mouvement plus récent sur la police, de sinistre,
d'attestation éditée. La quittance est retirée du compte du client et le devis revient non confirmé, à corriger puis
confirmer de nouveau ; ?avec_devis=1 le supprime aussi (droit devis.delete). Un devis confirmé garde son contrat : il faut
supprimer le contrat d'abord. Les numéros de police, de quittance et de devis ne sont pas réutilisés.
"""

import logging

from django.db import DatabaseError, connection, transaction
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from autorisations.rbac import a_le_droit

from sante import cartes as registre_cartes

from .apporteurs import commission_payee_du_contrat, retirer_du_devis
from .renouvellement import AUTHENTIFICATION, _lignes
from .reprise import COMPLEMENTS_CONTRAT
from .views_cockpit import _franc

logger = logging.getLogger(__name__)

CODES_BASE = ("AFN", "REN", "RPP", "TRP")
CODES_ANNULATION = ("ANL", "ANP", "RES")
DROIT_DEVIS = "devis.delete"
# Tables rattachées aux objets assurés d'un devis
COMPLEMENTS_DEVIS = ("stdcomplementdevisdetailauto", "stdcomplementdevisdetaildommage", "stdcomplementdevisdetailmrh",
                     "stdcomplementdevisdetailrc", "stdcomplementdevisdetailsante", "stdcomplementdevisdetailvoyage")
# Tables rattachées au devis lui-même, dans l'ordre des dépendances (affilié, adhérent, filiale)
TABLES_DEVIS = ("lephare_avenant_sante_reference", "lephare_incorporation", "lephare_reprise_devis",
                "lephare_sauvegarde_commission_minene", "lephare_afa_assure", "lephare_brouillon", "lephare_transport_affaire",
                "stdarchivagedevis", "stdnumerosaisiesante", "stdaffilie", "stdadherent", "stdfiliale")


class ErreurSuppression(Exception):
    pass


def _existe(cursor, sql, params):
    cursor.execute(sql, params)
    return cursor.fetchone()


def _montant(valeur):
    return f"{_franc(valeur):,}".replace(",", " ")


def _devis(cursor, id_devis):
    lignes = _lignes(cursor, """
        SELECT d.iddevis, d.numerodevis, d.primettc, COALESCE(d.confirme, FALSE) AS confirme, d.iddevisconsolide,
               TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS client
        FROM stddevis d LEFT JOIN stdclient cl ON cl.idclient = d.idclient
        WHERE d.iddevis = %s""", [id_devis])
    return lignes[0] if lignes else None


def _blocages_devis(cursor, devis, contrat_supprime=False):
    """Ce qui empêche de supprimer un devis. contrat_supprime : son contrat part dans la même opération."""
    id_devis = devis["iddevis"]
    blocages = []
    if not contrat_supprime:
        contrat = _existe(cursor, "SELECT numeropolice FROM stdcontrat WHERE iddevis = %s LIMIT 1", [id_devis])
        if contrat:
            blocages.append(f"Ce devis a donné le contrat {contrat[0]} : supprimez d'abord le contrat.")
        elif devis["confirme"]:
            blocages.append("Ce devis est confirmé.")
    enfant = _existe(cursor, "SELECT numerodevis FROM stddevis WHERE idoldhist = %s AND iddevis <> %s LIMIT 1", [id_devis, id_devis])
    if enfant:
        blocages.append(f"Le devis d'avenant ou de renouvellement {enfant[0]} a été établi à partir de ce devis : supprimez-le d'abord.")
    if devis["iddevisconsolide"] or _existe(cursor, """
            SELECT 1 FROM stddevis WHERE iddevisconsolide = %(d)s
            UNION ALL SELECT 1 FROM stddevisdetail WHERE iddevisorigine = %(d)s
            UNION ALL SELECT 1 FROM stdhistoriqueconsolidation WHERE iddevisconsolide = %(d)s OR %(d)s = ANY(iddevissource)
            LIMIT 1""", {"d": id_devis}):
        blocages.append("Ce devis fait partie d'une consolidation : annulez-la d'abord.")
    if _existe(cursor, "SELECT 1 FROM stdimportationcertificatdevis WHERE iddevis = %s LIMIT 1", [id_devis]):
        blocages.append("Ce devis vient d'un import de certificats de transport (GUCE).")
    if _existe(cursor, "SELECT 1 FROM lephare_transport_voyage WHERE iddevisressortie = %s LIMIT 1", [id_devis]):
        blocages.append("Ce devis porte la ressortie de voyages d'une police d'abonnement Transport.")
    return blocages


def _retirer_du_package_oreole(cursor, id_devis):
    """Oreole Santé : le devis Santé emporte le package et ses devis liés non confirmés ; un devis lié sort simplement du package."""
    cursor.execute("SELECT iddevis_ia, iddevis_afa FROM lephare_oreole_package WHERE iddevis_sante = %s", [id_devis])
    lies = cursor.fetchone()
    cursor.execute("DELETE FROM lephare_oreole_adherent WHERE iddevis = %s", [id_devis])
    cursor.execute("DELETE FROM lephare_oreole_package WHERE iddevis_sante = %s", [id_devis])
    cursor.execute("UPDATE lephare_oreole_package SET iddevis_ia = NULL WHERE iddevis_ia = %s", [id_devis])
    cursor.execute("UPDATE lephare_oreole_package SET iddevis_afa = NULL WHERE iddevis_afa = %s", [id_devis])
    for id_lie in lies or ():
        if id_lie and not _existe(cursor, "SELECT 1 FROM stdcontrat WHERE iddevis = %s LIMIT 1", [id_lie]):
            _supprimer_devis(cursor, id_lie)


def _supprimer_devis(cursor, id_devis):
    _retirer_du_package_oreole(cursor, id_devis)
    retirer_du_devis(cursor, id_devis)
    registre_cartes.annuler_du_devis(cursor, id_devis, "Devis supprimé")
    for table in TABLES_DEVIS:
        cursor.execute(f"DELETE FROM {table} WHERE iddevis = %s", [id_devis])
    # Fichier importé de nouveau : plus d'avertissement « déjà importé » pour un devis qui n'existe plus
    cursor.execute("DELETE FROM stdimports_historique WHERE id_devis = %s", [id_devis])
    for table in COMPLEMENTS_DEVIS:
        cursor.execute(f"""DELETE FROM {table} WHERE iddevisdetail IN
                           (SELECT iddevisdetail FROM stddevisdetail WHERE iddevis = %s)""", [id_devis])
    cursor.execute("""DELETE FROM stddevisdetgarantie WHERE iddevisdet IN
                      (SELECT iddevisdetail FROM stddevisdetail WHERE iddevis = %s)""", [id_devis])
    cursor.execute("DELETE FROM stddevisdetail WHERE iddevis = %s", [id_devis])
    cursor.execute("DELETE FROM stddevis WHERE iddevis = %s", [id_devis])


def _contrat(cursor, id_contrat, verrou=False):
    lignes = _lignes(cursor, f"""
        SELECT c.idcontrat, c.iddevis, c.idquittance, c.idclient, c.numeropolice, c.numeropolicecompagnie, c.primettc,
               COALESCE(c.idcontratannulation, 0) AS annule, a.codeavenant, TRIM(a.libelleavenant) AS mouvement,
               TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS client, q.numeroquittance,
               q.primettc AS ttc_quittance, COALESCE(q.mt_encaisse, 0) AS encaisse, d.numerodevis
        FROM stdcontrat c
        JOIN stdavenant a ON a.idavenant = c.idavenant
        LEFT JOIN stdclient cl ON cl.idclient = c.idclient
        LEFT JOIN stdquittance q ON q.idquittance = c.idquittance
        LEFT JOIN stddevis d ON d.iddevis = c.iddevis
        WHERE c.idcontrat = %s {"FOR UPDATE OF c" if verrou else ""}""", [id_contrat])
    return lignes[0] if lignes else None


def _blocages_contrat(cursor, c):
    id_contrat, id_devis, police = c["idcontrat"], c["iddevis"], c["numeropolice"]
    id_quittance, numero_quittance = c["idquittance"], c["numeroquittance"]
    blocages = []
    if c["codeavenant"] in CODES_ANNULATION:
        blocages.append("Ce mouvement annule ou résilie un autre contrat : il ne se supprime pas.")
    if c["annule"]:
        blocages.append("Ce contrat a été annulé ou résilié.")
    if _existe(cursor, "SELECT 1 FROM lephare_reprise WHERE idcontrat = %s LIMIT 1", [id_contrat]):
        blocages.append("Affaire antérieure : supprimez-la depuis la page Affaires antérieures.")
    recent = _lignes(cursor, """
        SELECT TRIM(a.libelleavenant) AS mouvement, c.dateeffet::date AS effet FROM stdcontrat c JOIN stdavenant a ON a.idavenant = c.idavenant
        WHERE c.numeropolice = %s AND c.idcontrat > %s ORDER BY c.idcontrat DESC LIMIT 1""", [police, id_contrat])
    if recent:
        blocages.append(f"Un mouvement plus récent existe sur cette police ({recent[0]['mouvement'].lower()} "
                        f"du {recent[0]['effet']:%d/%m/%Y}) : supprimez-le d'abord.")
    enfant = _existe(cursor, """SELECT numerodevis FROM stddevis WHERE idoldhist = %s AND iddevis <> %s
                                AND NOT COALESCE(confirme, FALSE) AND NOT COALESCE(archive, FALSE) LIMIT 1""", [id_devis, id_devis])
    if enfant:
        blocages.append(f"Le devis d'avenant ou de renouvellement {enfant[0]} est en cours sur ce contrat : supprimez-le d'abord.")
    if _existe(cursor, "SELECT 1 FROM stdcontrat WHERE iddevis = %s AND idcontrat <> %s LIMIT 1", [id_devis, id_contrat]):
        blocages.append("Un autre contrat porte le même devis.")
    if id_quittance:
        if float(c["encaisse"]) or _existe(cursor, "SELECT 1 FROM stddetailencaissement WHERE numeroquittance = %s LIMIT 1", [numero_quittance]):
            blocages.append(f"Des encaissements sont enregistrés sur la quittance {numero_quittance}, et restent dans l'historique de "
                            "caisse même annulés : utilisez l'annulation du contrat.")
        if _existe(cursor, """SELECT 1 FROM std_detail_reclamation_commission WHERE quittance_id = %(q)s
                              UNION ALL SELECT 1 FROM std_detail_paiement_commission WHERE quittance_id = %(q)s LIMIT 1""", {"q": id_quittance}):
            blocages.append("La commission de cette quittance a été réclamée ou payée.")
        apporteur = commission_payee_du_contrat(cursor, id_quittance)
        if apporteur:
            blocages.append(f"La commission de l'apporteur {apporteur} sur cette quittance a été payée : annulez d'abord son règlement.")
        if _existe(cursor, """SELECT 1 FROM stdcontrat WHERE idquittance = %(q)s AND idcontrat <> %(c)s
                              UNION ALL SELECT 1 FROM stdquittance WHERE idquittannul = %(q)s LIMIT 1""", {"q": id_quittance, "c": id_contrat}):
            blocages.append("Cette quittance est liée à un autre contrat ou à une annulation.")
    attestation = _existe(cursor, """SELECT TRIM(attestation) FROM stdcontratdetail
                                     WHERE idcontrat = %s AND TRIM(COALESCE(attestation, '')) <> '' LIMIT 1""", [id_contrat])
    if attestation:
        blocages.append(f"L'attestation {attestation[0]} a été éditée sur ce contrat.")
    # Import GUCE : certificats rattachés au devis, sous la police d'abonnement de la compagnie
    if _existe(cursor, """SELECT 1 FROM stdimportationcertificatdevis WHERE iddevis = %(d)s
                          UNION ALL SELECT 1 FROM stdcertificattransport WHERE TRIM(numeropolice) IN (%(p)s, %(pc)s)
                          UNION ALL SELECT 1 FROM lephare_transport_voyage WHERE idcontrat = %(c)s OR TRIM(numeropolice) = %(p)s LIMIT 1""",
               {"d": id_devis, "p": police.strip(), "pc": (c["numeropolicecompagnie"] or police).strip(), "c": id_contrat}):
        blocages.append("Des certificats ou des voyages de transport sont enregistrés sur cette police.")
    # La police disparaît ou perd une période : sinistres et assurances rattachées (IA, RC MINENE) en dépendent
    if c["codeavenant"] in CODES_BASE:
        if _existe(cursor, "SELECT 1 FROM institutionnel_sinistredelegue WHERE police_num IN (%s, %s) LIMIT 1", [police, c["numeropolicecompagnie"] or police]):
            blocages.append("Un sinistre est déclaré sur cette police.")
        connexe = _existe(cursor, """SELECT numeropolice FROM stdcontrat WHERE TRIM(numeropoliceconnexe) = %s AND numeropolice <> %s
                                     AND COALESCE(idcontratannulation, 0) = 0 LIMIT 1""", [police.strip(), police])
        if connexe:
            blocages.append(f"Le contrat {connexe[0]} est rattaché à cette police : supprimez-le d'abord.")
    return blocages


def _supprimer_contrat(cursor, c):
    id_contrat, id_quittance = c["idcontrat"], c["idquittance"]
    cursor.execute("UPDATE stdcontrat SET idquittance = NULL WHERE idcontrat = %s", [id_contrat])
    if id_quittance:
        cursor.execute("DELETE FROM stddetquittance WHERE idquittance = %s", [id_quittance])
        cursor.execute("DELETE FROM stdquittance WHERE idquittance = %s", [id_quittance])
        # La quittance avait porté sa TTC au compte du client (sp_generation_quittance)
        cursor.execute("UPDATE stdclient SET solde = COALESCE(solde, 0) - %s WHERE idclient = %s", [c["ttc_quittance"] or 0, c["idclient"]])
    for table in COMPLEMENTS_CONTRAT:
        cursor.execute(f"""DELETE FROM {table} WHERE idcontratdetail IN
                           (SELECT idcontratdetail FROM stdcontratdetail WHERE idcontrat = %s)""", [id_contrat])
    cursor.execute("DELETE FROM stdcontratdetail WHERE idcontrat = %s", [id_contrat])
    cursor.execute("DELETE FROM stdcontrat WHERE idcontrat = %s", [id_contrat])
    # Devis de nouveau modifiable et confirmable (confirmé et saisie Santé close par sp_confirmation_devis)
    cursor.execute("UPDATE stddevis SET confirme = FALSE WHERE iddevis = %s", [c["iddevis"]])
    cursor.execute("UPDATE stdnumerosaisiesante SET saisieencours = TRUE, datemaj = CURRENT_TIMESTAMP WHERE iddevis = %s", [c["iddevis"]])


def _refus_base(erreur):
    logger.exception("Suppression refusée par la base : %s", erreur)
    return Response({"error": "Suppression impossible : des données y sont encore rattachées."}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "DELETE"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def suppression_devis(request, iddevis):
    try:
        if request.method == "GET":
            with connection.cursor() as cursor:
                devis = _devis(cursor, iddevis)
                if not devis:
                    return Response({"error": "Devis introuvable."}, status=status.HTTP_404_NOT_FOUND)
                blocages = _blocages_devis(cursor, devis)
            return Response({
                "Reference": (devis["numerodevis"] or "").strip() or f"n° {iddevis}", "Client": devis["client"],
                "PrimeTtc": _franc(devis["primettc"]), "Supprimable": not blocages, "Blocages": blocages,
                "Effets": ["Le devis et toute sa saisie (objets assurés, garanties, familles et assurés) sont supprimés.",
                           "Son numéro n'est pas réutilisé."],
            })
        with transaction.atomic(), connection.cursor() as cursor:
            devis = _devis(cursor, iddevis)
            if not devis:
                raise ErreurSuppression("Devis introuvable.")
            blocages = _blocages_devis(cursor, devis)
            if blocages:
                raise ErreurSuppression(" ".join(blocages))
            _supprimer_devis(cursor, iddevis)
        return Response({"Message": f"Devis {devis['numerodevis']} supprimé.", "NumeroDevis": devis["numerodevis"]})
    except ErreurSuppression as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except DatabaseError as erreur:
        return _refus_base(erreur)


@api_view(["GET", "DELETE"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def suppression_contrat(request, idcontrat):
    try:
        if request.method == "GET":
            with connection.cursor() as cursor:
                c = _contrat(cursor, idcontrat)
                if not c:
                    return Response({"error": "Contrat introuvable."}, status=status.HTTP_404_NOT_FOUND)
                blocages = _blocages_contrat(cursor, c)
                devis = _devis(cursor, c["iddevis"])
                devis_supprimable = bool(devis) and not _blocages_devis(cursor, devis, contrat_supprime=True)
            effets = [f"Le contrat ({c['mouvement'].lower()}) et ses garanties sont supprimés."]
            if c["numeroquittance"]:
                effets.append(f"La quittance {c['numeroquittance']} de {_montant(c['ttc_quittance'])} F est supprimée et retirée du compte du client.")
            effets.append(f"Le devis {c['numerodevis']} revient dans le registre, non confirmé : il peut être corrigé puis confirmé de nouveau.")
            effets.append("Les numéros de police et de quittance ne sont pas réutilisés." if c["codeavenant"] in CODES_BASE
                          else "Le numéro de quittance n'est pas réutilisé.")
            return Response({
                "Reference": c["numeropolice"], "Client": c["client"], "Mouvement": c["mouvement"], "PrimeTtc": _franc(c["primettc"]),
                "NumeroDevis": c["numerodevis"], "Supprimable": not blocages, "Blocages": blocages, "Effets": effets,
                "DevisSupprimable": devis_supprimable,
            })
        avec_devis = str(request.query_params.get("avec_devis") or "") in ("1", "true")
        if avec_devis and not a_le_droit(request.user, DROIT_DEVIS):
            return Response({"error": "Vous n'êtes pas habilité à supprimer le devis."}, status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic(), connection.cursor() as cursor:
            c = _contrat(cursor, idcontrat, verrou=True)
            if not c:
                raise ErreurSuppression("Contrat introuvable.")
            blocages = _blocages_contrat(cursor, c)
            if blocages:
                raise ErreurSuppression(" ".join(blocages))
            _supprimer_contrat(cursor, c)
            if avec_devis:
                devis = _devis(cursor, c["iddevis"])
                blocages_devis = _blocages_devis(cursor, devis, contrat_supprime=True)
                if blocages_devis:
                    raise ErreurSuppression(" ".join(blocages_devis))
                _supprimer_devis(cursor, c["iddevis"])
        return Response({
            "Message": f"Contrat {c['numeropolice']} supprimé.", "NumeroPolice": c["numeropolice"], "NumeroQuittance": c["numeroquittance"],
            "NumeroDevis": c["numerodevis"], "DevisSupprime": avec_devis,
        })
    except ErreurSuppression as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except DatabaseError as erreur:
        return _refus_base(erreur)
