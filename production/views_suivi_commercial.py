"""
Suivi commercial (/user/crm) : activité commerciale réelle de l'exercice, à côté des prospects : devis émis et
transformés en contrats (par chargé d'affaires, auteur du devis, et par branche), devis à relancer, renouvellements
à préparer et questionnaires prospects reçus. Mêmes règles que le cockpit et la cloche.

GET /api/suivi-commercial/ (droit crm.view)
"""
from datetime import date, timedelta

from django.db import connection
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from autorisations.rbac import a_le_droit
from configuration_api.parametrage import valeur_parametre

from . import views_finance
from .views_cockpit import (DEVIS_ENREGISTRE, DEVIS_NON_CONFIRME, QUESTIONNAIRE_TRAITE, _franc, _iso, _lignes, _meme_jour,
                            _une, echeances_polices)
from .views_reprise import AUTHENTIFICATION

DROIT = "crm.view"
# Renouvellements : polices à échoir dans les … jours, ou échues depuis … jours au plus sans renouvellement
RENOUVELLEMENT_JOURS = 60
ECHUES_DEPUIS_JOURS = 30
LIGNES_MAX = 100
SANS_AUTEUR = "Repris d'URANUS"

# Agrégats d'une série de devis émis (saisies enregistrées à prime non nulle)
AGREGATS_DEVIS = f"""
    COUNT(*) AS emis, COUNT(*) FILTER (WHERE COALESCE(d.confirme, FALSE)) AS confirmes,
    COALESCE(SUM(NULLIF(d.primettc, 'NaN')), 0) AS ttc, COALESCE(SUM(NULLIF(d.primettc, 'NaN')) FILTER (WHERE COALESCE(d.confirme, FALSE)), 0) AS ttc_confirme,
    COUNT(*) FILTER (WHERE {DEVIS_NON_CONFIRME} AND d.dateexpiration::date >= %(jour)s) AS en_cours,
    COALESCE(SUM(NULLIF(d.primettc, 'NaN')) FILTER (WHERE {DEVIS_NON_CONFIRME} AND d.dateexpiration::date >= %(jour)s), 0) AS ttc_en_cours
"""


def _taux(part, total):
    return round(part * 100 / total, 1) if total else None


def _telephone(valeur):
    """Numéro du client, sans les valeurs de remplissage des fiches (« NA », « - »…)."""
    valeur = (valeur or "").strip()
    return valeur if any(c.isdigit() for c in valeur) else None


def _serie(l):
    return {
        "Emis": l["emis"], "Confirmes": l["confirmes"], "Taux": _taux(l["confirmes"], l["emis"]),
        "PrimeProposee": _franc(l["ttc"]), "PrimeTransformee": _franc(l["ttc_confirme"]),
        "EnCours": l["en_cours"], "PrimeEnCours": _franc(l["ttc_en_cours"]),
    }


def _cumul(lignes, cle):
    """Regroupe les lignes (auteur, produit) selon cle et additionne les agrégats."""
    groupes = {}
    for l in lignes:
        g = groupes.setdefault(l[cle], {k: 0 for k in ("emis", "confirmes", "ttc", "ttc_confirme", "en_cours", "ttc_en_cours")})
        for k in g:
            g[k] += l[k] or 0
    return groupes


def _devis(cursor, p):
    lignes = _lignes(cursor, f"""
        SELECT d.idoperateur, d.idproduit, {AGREGATS_DEVIS}
        FROM stddevis d
        WHERE {DEVIS_ENREGISTRE} AND d.dateemission::date BETWEEN %(debut)s AND %(jour)s
        GROUP BY 1, 2
    """, p)
    precedent = _une(cursor, f"""
        SELECT COUNT(*) AS emis, COUNT(*) FILTER (WHERE COALESCE(d.confirme, FALSE)) AS confirmes
        FROM stddevis d WHERE {DEVIS_ENREGISTRE} AND d.dateemission::date BETWEEN %(debut_n1)s AND %(jour_n1)s
    """, p)
    noms = {l["id"]: (l["name"] or "").strip() or (l["email"] or "").strip() or f"Utilisateur {l['id']}"
            for l in _lignes(cursor, "SELECT id, name, email FROM account_uranususer WHERE id = ANY(%s)",
                             [[l["idoperateur"] for l in lignes if l["idoperateur"]]])}
    produits = {l["idproduit"]: l["libelleproduit"] for l in _lignes(cursor, "SELECT idproduit, libelleproduit FROM stdproduit")}

    par_produit = _cumul(lignes, "idproduit")
    ensemble = {k: sum(g[k] for g in par_produit.values()) for k in ("emis", "confirmes", "ttc", "ttc_confirme", "en_cours", "ttc_en_cours")}
    par_auteur = [{"IdOperateur": i, "Nom": noms.get(i, SANS_AUTEUR) if i else SANS_AUTEUR, **_serie(g)}
                  for i, g in _cumul(lignes, "idoperateur").items()]
    par_branche = [{"IdProduit": i, "Branche": views_finance._branche(i, produits.get(i)) if i else "Sans branche", **_serie(g)}
                   for i, g in par_produit.items()]
    ordre = lambda e: (-e["Emis"], -e["PrimeTransformee"])  # noqa: E731
    return {
        **_serie(ensemble),
        "Precedent": {"Emis": precedent["emis"], "Confirmes": precedent["confirmes"],
                      "Taux": _taux(precedent["confirmes"], precedent["emis"]), "Au": _iso(p["jour_n1"])},
        "ParAuteur": sorted(par_auteur, key=ordre),
        "ParBranche": sorted(par_branche, key=ordre),
    }


def _a_relancer(cursor, jour):
    """Devis non confirmés dont la validité expire dans les N jours ou a expiré depuis N jours au plus
    (N = « devis.alerte_echeance_jours », réglage de la cloche)."""
    jours = int(valeur_parametre("devis.alerte_echeance_jours", 30))
    condition = f"""{DEVIS_NON_CONFIRME} AND {DEVIS_ENREGISTRE} AND d.dateexpiration::date BETWEEN %(du)s AND %(au)s"""
    p = {"du": jour - timedelta(days=jours), "au": jour + timedelta(days=jours), "jour": jour, "max": LIGNES_MAX}
    compte = _une(cursor, f"""
        SELECT COUNT(*) FILTER (WHERE d.dateexpiration::date >= %(jour)s) AS a_echeance,
               COUNT(*) FILTER (WHERE d.dateexpiration::date < %(jour)s) AS echus, COALESCE(SUM(NULLIF(d.primettc, 'NaN')), 0) AS ttc
        FROM stddevis d WHERE {condition}
    """, p)
    lignes = _lignes(cursor, f"""
        SELECT d.iddevis, d.numerodevis, d.idproduit, d.dateemission::date AS dateemission,
               d.dateexpiration::date AS dateexpiration, d.primettc,
               TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS client,
               NULLIF(TRIM(cl.telephone), '') AS telephone, NULLIF(TRIM(cl.email), '') AS email,
               p.libelleproduit AS produit, co.raisonsociale AS compagnie,
               COALESCE(NULLIF(TRIM(u.name), ''), u.email) AS auteur
        FROM stddevis d
        LEFT JOIN stdclient cl ON cl.idclient = d.idclient
        LEFT JOIN stdproduit p ON p.idproduit = d.idproduit
        LEFT JOIN stdcompagnie co ON co.idcompagnie = d.idcompagnie
        LEFT JOIN account_uranususer u ON u.id = d.idoperateur
        WHERE {condition}
        -- Les plus urgents d'abord : à échéance la plus proche, puis les expirés les plus récents
        ORDER BY (d.dateexpiration::date < %(jour)s), ABS(d.dateexpiration::date - %(jour)s), d.iddevis
        LIMIT %(max)s
    """, p)
    return {
        "Jours": jours, "AEcheance": compte["a_echeance"], "Echus": compte["echus"], "PrimeTtc": _franc(compte["ttc"]),
        "Lignes": [{
            "IdDevis": d["iddevis"], "NumeroDevis": d["numerodevis"], "IdProduit": d["idproduit"],
            "Branche": views_finance._branche(d["idproduit"], d["produit"]) if d["idproduit"] else "",
            "Compagnie": (d["compagnie"] or "").strip(), "Client": d["client"], "Telephone": _telephone(d["telephone"]),
            "Email": d["email"], "Auteur": d["auteur"] or SANS_AUTEUR, "DateEmission": _iso(d["dateemission"]),
            "DateExpiration": _iso(d["dateexpiration"]), "Jours": (d["dateexpiration"] - jour).days,
            "PrimeTtc": _franc(d["primettc"]),
        } for d in lignes],
    }


def _renouvellements(cursor, jour):
    lignes = echeances_polices(cursor, jour - timedelta(days=ECHUES_DEPUIS_JOURS), jour + timedelta(days=RENOUVELLEMENT_JOURS))
    return {
        "AEchoirJours": RENOUVELLEMENT_JOURS, "EchuesDepuisJours": ECHUES_DEPUIS_JOURS,
        "AEchoir": sum(1 for e in lignes if e["dateexpiration"] >= jour),
        "Echues": sum(1 for e in lignes if e["dateexpiration"] < jour),
        "AvecDevis": sum(1 for e in lignes if e["devis_en_cours"]),
        "PrimeTtc": _franc(sum(e["primettc"] or 0 for e in lignes)),
        # Échues d'abord (les plus urgentes), puis à échoir dans l'ordre des dates
        "Lignes": [{
            "IdContrat": e["idcontrat"], "NumeroPolice": e["numeropolice"], "Client": e["client"],
            "Telephone": _telephone(e["telephone"]), "IdProduit": e["idproduit"],
            "Branche": views_finance._branche(e["idproduit"], e["produit"]) if e["idproduit"] else "",
            "Compagnie": (e["compagnie"] or "").strip(), "DateExpiration": _iso(e["dateexpiration"]),
            "Jours": (e["dateexpiration"] - jour).days, "PrimeTtc": _franc(e["primettc"]), "DevisEnCours": e["devis_en_cours"],
        } for e in lignes[:LIGNES_MAX]],
    }


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def suivi_commercial(request):
    if not a_le_droit(request.user, DROIT):
        return Response({"detail": "Droit « Suivi commercial » requis."}, status=status.HTTP_403_FORBIDDEN)
    jour = timezone.localdate()
    p = {"debut": date(jour.year, 1, 1), "jour": jour, "debut_n1": date(jour.year - 1, 1, 1),
         "jour_n1": _meme_jour(jour, jour.year - 1)}
    with connection.cursor() as cursor:
        questionnaires = _une(cursor, """
            SELECT COUNT(*) FILTER (WHERE statut <> %s) AS a_traiter,
                   COUNT(*) FILTER (WHERE date_depot::date >= %s) AS recus_mois,
                   COUNT(*) FILTER (WHERE date_depot::date >= %s) AS recus_exercice
            FROM lephare_questionnaire_prospect
        """, [QUESTIONNAIRE_TRAITE, jour.replace(day=1), p["debut"]])
        return Response({
            "Jour": jour.isoformat(), "Exercice": jour.year, "Du": p["debut"].isoformat(),
            "Devis": _devis(cursor, p),
            "ARelancer": _a_relancer(cursor, jour),
            "Renouvellements": _renouvellements(cursor, jour),
            "Questionnaires": {"ATraiter": questionnaires["a_traiter"], "RecusMois": questionnaires["recus_mois"],
                               "RecusExercice": questionnaires["recus_exercice"]},
        })
