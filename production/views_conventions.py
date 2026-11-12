"""
Conventions avec les compagnies (Administration > Conventions avec les compagnies), refaites le 2026-10-28 sur les
données réelles (demande : « actualise les informations de cette vue »). L'ancienne vue affichait quatre conventions
de démonstration (codes partenaires et taux de commission inventés) et des chiffres écrits dans l'écran.

GET /api/conventions-compagnies/                une ligne par compagnie du référentiel : coordonnées et responsables,
                                                code intermédiaire du cabinet, taux de commission en vigueur par
                                                branche, part du cabinet dans les accessoires, destinataire des
                                                courriers, activité (contrats en vigueur, émissions de l'exercice,
                                                primes à reverser, commissions dues, payées et en attente), conditions
                                                de la convention si elles ont été renseignées.
PUT /api/conventions-compagnies/<idcompagnie>/  conditions de la convention : mandat d'encaissement, délai de
                                                reversement, plafond de délégation des sinistres, participation
                                                bénéficiaire, dates, statut.

Primes à reverser et commissions : mêmes calculs que les écrans des reversements et des commissions (views_finance),
donc mêmes montants.
"""

from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.db import connection, transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from autorisations.rbac import a_le_droit
from institutionnel.models import ConventionAssureur

from . import views_finance
from .views_bordereaux import reglages_compagnie
from .views_reprise import AUTHENTIFICATION

ID_INTERMEDIAIRE = 1
# Droit de la page (Administration > Conventions avec les compagnies), contrôlé aussi par la garde centrale
DROIT = "parametrage.update"
STATUTS = ("Actif", "En négociation", "Suspendu", "Résilié")


class ErreurConvention(Exception):
    """Conditions refusées : message affiché tel quel."""


def _lignes(sql, params=None):
    with connection.cursor() as cursor:
        cursor.execute(sql, params or [])
        colonnes = [c[0] for c in cursor.description]
        return [dict(zip(colonnes, l)) for l in cursor.fetchall()]


def _franc(valeur):
    return float(round(Decimal(str(valeur or 0))))


def _iso(valeur):
    return valeur.date().isoformat() if isinstance(valeur, datetime) else valeur.isoformat() if isinstance(valeur, date) else None


def _texte(valeur):
    return " ".join(str(valeur or "").split())


def _convention_json(c):
    pb = c.participation_beneficiaire if isinstance(c.participation_beneficiaire, dict) else {}
    return {
        "EncaissementDelegue": bool(c.encaissement_delegue),
        "DelaiReversementJours": c.delai_reversement_jours,
        "PlafondDelegationSinistre": _franc(c.plafond_delegation_sinistre),
        "ParticipationBeneficiaire": {
            "Active": bool(pb.get("Active")), "Taux": pb.get("Taux"), "SeuilSp": pb.get("SeuilSp"),
        },
        "DateEffet": _iso(c.date_effet), "DateRenouvellement": _iso(c.date_renouvellement), "Statut": c.statut,
        "DateMaj": _iso(c.date_maj), "MajPar": c.maj_par or "",
    }


def _a_reverser_par_compagnie():
    """Primes encaissées à reverser : lignes de l'écran des reversements (toutes compagnies), par compagnie."""
    par_compagnie = {}
    for l in views_finance.encaissements_a_reverser():
        r = par_compagnie.setdefault(l["IdCompagnie"], {"Nombre": 0, "Montant": 0.0, "PlusAncien": None})
        r["Nombre"] += 1
        r["Montant"] += float(l["ResteAReverser"])
        if l["DateEncaissement"] and (not r["PlusAncien"] or l["DateEncaissement"] < r["PlusAncien"]):
            r["PlusAncien"] = l["DateEncaissement"]
    return par_compagnie


def _commissions_par_compagnie(jour):
    """Commissions des primes reversées : récapitulatif de l'écran des commissions, par compagnie."""
    recap = views_finance.recapitulatif_commissions(jour=jour)
    return {c["IdCompagnie"]: c for c in recap["ParCompagnie"]}


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def conventions_compagnies(request):
    if not a_le_droit(request.user, DROIT):
        return Response({"error": "Droit « parametrage.update » requis."}, status=status.HTTP_403_FORBIDDEN)
    jour = timezone.localdate()
    exercice = jour.year
    compagnies = _lignes("""
        SELECT c.idcompagnie, TRIM(c.raisonsociale) AS raisonsociale, COALESCE(c.active, TRUE) AS active,
               COALESCE(c.etranger, FALSE) AS etranger, TRIM(COALESCE(c.adresse1, '')) AS adresse,
               TRIM(COALESCE(c.telephone, '')) AS telephone, TRIM(COALESCE(c.mobile, '')) AS mobile,
               TRIM(COALESCE(c.respprodauto, '')) AS respprodauto, TRIM(COALESCE(c.respprodrd, '')) AS respprodrd,
               TRIM(COALESCE(c.respsinauto, '')) AS respsinauto, TRIM(COALESCE(c.respsinrd, '')) AS respsinrd,
               TRIM(COALESCE(ic.codeintermediaire, '')) AS codeintermediaire,
               public.fn_lephare_part_accessoires_cabinet(c.idcompagnie) AS part_accessoires
        FROM stdcompagnie c
        LEFT JOIN stdintermediairecompagnie ic ON ic.idcompagnie = c.idcompagnie AND ic.idintermediaire = %s
        WHERE c.idcompagnie > 0
        ORDER BY TRIM(c.raisonsociale)
    """, [ID_INTERMEDIAIRE])
    # Taux de commission du cabinet en vigueur aujourd'hui, par branche (dernière période ouverte)
    taux = {}
    for t in _lignes("""
        SELECT DISTINCT ON (cm.idcompagnie, cm.idproduit) cm.idcompagnie, cm.idproduit,
               TRIM(COALESCE(p.libelleproduit, '')) AS branche, cm.tauxcommission, cm.forfait, cm.debutvalidite
        FROM stdcommissionproduitcompagnie cm
        LEFT JOIN stdproduit p ON p.idproduit = cm.idproduit
        WHERE %s BETWEEN cm.debutvalidite::date AND COALESCE(cm.finvalidite::date, DATE '2999-12-31')
        ORDER BY cm.idcompagnie, cm.idproduit, cm.debutvalidite DESC
    """, [jour]):
        taux.setdefault(t["idcompagnie"], []).append({
            "IdProduit": t["idproduit"], "Branche": t["branche"], "Taux": float(t["tauxcommission"] or 0),
            "Forfait": _franc(t["forfait"]), "Depuis": _iso(t["debutvalidite"]),
        })
    # Activité : polices en vigueur aujourd'hui, émissions de l'exercice
    activite = {a["idcompagnie"]: a for a in _lignes("""
        SELECT c.idcompagnie,
               COUNT(DISTINCT c.numeropolice) FILTER (
                   WHERE %s BETWEEN c.dateeffet::date AND c.dateexpiration::date AND COALESCE(c.idcontratannulation, 0) = 0
                     AND a.codeavenant <> 'RES') AS en_vigueur,
               COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM c.dateemission) = %s AND COALESCE(c.idcontratannulation, 0) = 0) AS emis,
               COALESCE(SUM(c.primettc) FILTER (
                   WHERE EXTRACT(YEAR FROM c.dateemission) = %s AND COALESCE(c.idcontratannulation, 0) = 0), 0) AS primes,
               MAX(c.dateemission)::date AS derniere_emission
        FROM stdcontrat c JOIN stdavenant a ON a.idavenant = c.idavenant
        GROUP BY c.idcompagnie
    """, [jour, exercice, exercice])}
    a_reverser = _a_reverser_par_compagnie()
    commissions = _commissions_par_compagnie(jour)
    conventions = {c.idcompagnie: c for c in ConventionAssureur.objects.filter(idcompagnie__isnull=False)}

    resultat = []
    for c in compagnies:
        idc = c["idcompagnie"]
        reglages = reglages_compagnie(idc, c["raisonsociale"])
        act = activite.get(idc, {})
        com = commissions.get(idc) or {}
        rev = a_reverser.get(idc) or {"Nombre": 0, "Montant": 0.0, "PlusAncien": None}
        resultat.append({
            "IdCompagnie": idc, "Compagnie": c["raisonsociale"], "Active": c["active"], "Etranger": c["etranger"],
            "CodeIntermediaire": c["codeintermediaire"],
            "Coordonnees": {
                "Adresse": c["adresse"], "Telephone": c["telephone"], "Mobile": c["mobile"],
                "ResponsableProductionAuto": c["respprodauto"], "ResponsableProductionRisquesDivers": c["respprodrd"],
                "ResponsableSinistresAuto": c["respsinauto"], "ResponsableSinistresRisquesDivers": c["respsinrd"],
            },
            "Taux": sorted(taux.get(idc, []), key=lambda t: t["IdProduit"] or 0),
            "PartAccessoiresCabinet": float(c["part_accessoires"]) if c["part_accessoires"] is not None else None,
            "PartAccessoiresReglee": reglages["PartAccessoiresCourtier"] not in (None, ""),
            "Courrier": {k: reglages[k] for k in ("NomBordereau", "Destinataire", "Service", "Ville", "AttentionDe")},
            "Activite": {
                "ContratsEnVigueur": int(act.get("en_vigueur") or 0), "ContratsExercice": int(act.get("emis") or 0),
                "PrimesExercice": _franc(act.get("primes")), "DerniereEmission": _iso(act.get("derniere_emission")),
                "AReverser": {"Nombre": rev["Nombre"], "Montant": _franc(rev["Montant"]), "PlusAncien": rev["PlusAncien"]},
                "Commissions": {
                    "Dues": _franc(com.get("CommissionDue")), "Payees": _franc(com.get("CommissionPayee")),
                    "EnAttente": _franc(com.get("EnAttente")), "TauxRecouvrement": com.get("TauxRecouvrement") or 0.0,
                },
            },
            "Convention": _convention_json(conventions[idc]) if idc in conventions else None,
        })
    return Response({"Exercice": exercice, "Situation": jour.isoformat(), "Compagnies": resultat,
                     "Statuts": list(STATUTS)})


def _montant(valeur, libelle):
    try:
        nombre = Decimal(str(valeur if valeur not in (None, "") else 0).replace(" ", "").replace(",", "."))
    except InvalidOperation as erreur:
        raise ErreurConvention(f"{libelle} : nombre attendu.") from erreur
    if nombre < 0:
        raise ErreurConvention(f"{libelle} : montant négatif.")
    return nombre


def _pourcentage(valeur, libelle):
    if valeur in (None, ""):
        return None
    nombre = _montant(valeur, libelle)
    if nombre > 100:
        raise ErreurConvention(f"{libelle} : 100 % au plus.")
    return float(nombre)


def _jour(valeur, libelle):
    if valeur in (None, ""):
        return None
    try:
        return datetime.strptime(str(valeur)[:10], "%Y-%m-%d").date()
    except ValueError as erreur:
        raise ErreurConvention(f"{libelle} : date illisible.") from erreur


@api_view(["PUT"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def convention_compagnie(request, id_compagnie):
    if not a_le_droit(request.user, DROIT):
        return Response({"error": "Droit « parametrage.update » requis."}, status=status.HTTP_403_FORBIDDEN)
    d = request.data
    lignes = _lignes("""SELECT TRIM(c.raisonsociale) AS raisonsociale, TRIM(COALESCE(ic.codeintermediaire, '')) AS code
                        FROM stdcompagnie c LEFT JOIN stdintermediairecompagnie ic
                          ON ic.idcompagnie = c.idcompagnie AND ic.idintermediaire = %s
                        WHERE c.idcompagnie = %s""", [ID_INTERMEDIAIRE, id_compagnie])
    if not lignes:
        return Response({"error": "Compagnie introuvable."}, status=status.HTTP_404_NOT_FOUND)
    try:
        delai = int(_montant(d.get("DelaiReversementJours"), "Délai de reversement"))
        if delai > 365:
            raise ErreurConvention("Délai de reversement : 365 jours au plus.")
        statut = _texte(d.get("Statut")) or "Actif"
        if statut not in STATUTS:
            raise ErreurConvention(f"Statut : {', '.join(STATUTS)}.")
        effet, renouvellement = _jour(d.get("DateEffet"), "Date d'effet"), _jour(d.get("DateRenouvellement"), "Date de renouvellement")
        if effet and renouvellement and renouvellement < effet:
            raise ErreurConvention("La date de renouvellement précède la date d'effet.")
        pb = d.get("ParticipationBeneficiaire") if isinstance(d.get("ParticipationBeneficiaire"), dict) else {}
        participation = {
            "Active": bool(pb.get("Active")),
            "Taux": _pourcentage(pb.get("Taux"), "Participation bénéficiaire : taux"),
            "SeuilSp": _pourcentage(pb.get("SeuilSp"), "Participation bénéficiaire : seuil S/P"),
        }
        valeurs = dict(
            compagnie=lignes[0]["raisonsociale"][:100], code_partenaire=(lignes[0]["code"] or "")[:60],
            encaissement_delegue=bool(d.get("EncaissementDelegue")), delai_reversement_jours=delai,
            plafond_delegation_sinistre=_montant(d.get("PlafondDelegationSinistre"), "Plafond de délégation des sinistres"),
            participation_beneficiaire=participation, date_effet=effet, date_renouvellement=renouvellement, statut=statut,
            date_maj=timezone.now(), maj_par=(getattr(request.user, "email", "") or "")[:150],
        )
    except ErreurConvention as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        convention, _ = ConventionAssureur.objects.update_or_create(
            idcompagnie=id_compagnie, defaults={**valeurs, "code_convention": f"CNV-{id_compagnie:03d}"})
    return Response({"IdCompagnie": id_compagnie, "Convention": _convention_json(convention),
                     "message": f"Convention avec {valeurs['compagnie']} enregistrée."})
