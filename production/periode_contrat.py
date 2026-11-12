"""
Période d'un contrat et ses mouvements (demande du 2026-11-02 : « après incorporation, les documents du contrat concerné
doivent se mettre à jour en prenant compte de l'incorporé »).

Un contrat de base (affaire nouvelle, renouvellement, reprise ou transfert de portefeuille) couvre une période ; les
avenants émis sous la même police pendant cette période la complètent : incorporation d'un véhicule (INC), modification
Santé (MOD : incorporation d'un membre, changement de formule), retrait (RET)… Les documents qui décrivent le contenu
de la police (conditions particulières, liste des véhicules ou des assurés, état des cotisations, facture MINENE) se
font sur la période : objets à jour, incorporés compris et retirés écartés, et primes de la période (contrat et
avenants). Les pièces d'une quittance (quittance CIMA, facture de prime, relevé de compte) restent celles du contrat.

GET /api/contrat/<idcontrat>/periode/ (contrats.view)
"""
from django.db import connection
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from .renouvellement import AUTHENTIFICATION, _iso, _lignes

CODES_BASE = ("AFN", "REN", "RPP", "TRP")
# Mouvements qui n'entrent pas dans les primes de la période : annulations (le contrat annulé est déjà écarté) et
# résiliation
CODES_HORS_PERIODE = ("ANL", "ANP", "RES")


def periode_contrat(cursor, id_contrat):
    """Période d'un contrat : contrat de base (lui-même, ou pour un avenant celui dont la période contient sa date
    d'effet), contrats de la période (base et avenants non annulés), mouvements et totaux. None si introuvable."""
    contrat = _lignes(cursor, """
        SELECT c.idcontrat, c.iddevis, c.numeropolice, c.idproduit, c.dateeffet::date AS dateeffet, a.codeavenant
        FROM stdcontrat c JOIN stdavenant a ON a.idavenant = c.idavenant WHERE c.idcontrat = %s""", [id_contrat])
    if not contrat:
        return None
    contrat = contrat[0]
    base = _lignes(cursor, f"""
        SELECT c.idcontrat, c.iddevis, c.dateeffet::date AS dateeffet, c.dateexpiration::date AS dateexpiration
        FROM stdcontrat c JOIN stdavenant a ON a.idavenant = c.idavenant
        WHERE c.numeropolice = %s AND a.codeavenant IN {CODES_BASE} AND COALESCE(c.idcontratannulation, 0) = 0
          AND c.dateeffet::date <= %s
        ORDER BY (c.idcontrat = %s) DESC, c.dateeffet DESC, c.idcontrat DESC
        LIMIT 1""", [contrat["numeropolice"], contrat["dateeffet"], id_contrat])
    if not base or not base[0]["dateexpiration"]:
        return None
    base = base[0]
    contrats = _lignes(cursor, f"""
        SELECT c.idcontrat, c.iddevis, a.codeavenant, a.libelleavenant, c.numeroavenant, c.dateeffet::date AS dateeffet,
               COALESCE(c.primenette, 0) AS primenette, COALESCE(c.fga, 0) AS fga, COALESCE(c.cedeao, 0) AS cedeao,
               COALESCE(c.accessoire, 0) AS accessoire, COALESCE(c.taxe, 0) AS taxe,
               COALESCE(c.accessoiregestionnaire, 0) AS fraisgestion, COALESCE(c.primettc, 0) AS primettc,
               q.numeroquittance, COALESCE(q.mt_encaisse, 0) AS encaisse
        FROM stdcontrat c
        JOIN stdavenant a ON a.idavenant = c.idavenant
        LEFT JOIN stdquittance q ON q.idquittance = c.idquittance
        WHERE c.numeropolice = %s AND COALESCE(c.idcontratannulation, 0) = 0 AND a.codeavenant NOT IN {CODES_HORS_PERIODE}
          AND (c.idcontrat = %s OR (a.codeavenant NOT IN {CODES_BASE} AND c.dateeffet::date BETWEEN %s AND %s))
        ORDER BY (c.idcontrat = %s) DESC, c.dateeffet, c.idcontrat""",
        [contrat["numeropolice"], base["idcontrat"], base["dateeffet"], base["dateexpiration"], base["idcontrat"]])
    total = {
        "PrimeNette": sum(c["primenette"] for c in contrats), "Fga": sum(c["fga"] for c in contrats),
        "Cedeao": sum(c["cedeao"] for c in contrats), "Accessoire": sum(c["accessoire"] for c in contrats),
        "TaxeEnregistrement": sum(c["taxe"] for c in contrats), "FraisGestionMinene": sum(c["fraisgestion"] for c in contrats),
        "PrimeTtc": sum(c["primettc"] for c in contrats),
    }
    totaux = {cle: float(valeur) for cle, valeur in total.items()}
    # Mêmes définitions que l'en-tête de quittance (fn_quittance_contrat) : prime hors FGA, frais = reste de la TTC
    totaux["PrimeNetteHorsFga"] = totaux["PrimeNette"] - totaux["Fga"]
    totaux["FraisGestion"] = totaux["PrimeTtc"] - totaux["PrimeNette"] - totaux["Accessoire"] - totaux["TaxeEnregistrement"]
    # Santé : familles en vigueur, celles du dernier contrat émis de la période qui en porte (incorporations comprises),
    # comme le renouvellement et l'avenant (sante.avenant._dernier_devis)
    cursor.execute("""SELECT c.iddevis FROM stdcontrat c WHERE c.idcontrat = ANY(%s)
                        AND EXISTS (SELECT 1 FROM stdadherent ad WHERE ad.iddevis = c.iddevis)
                      ORDER BY c.idcontrat DESC LIMIT 1""", [[c["idcontrat"] for c in contrats]])
    composition = cursor.fetchone()
    return {
        "IdContrat": contrat["idcontrat"], "CodeAvenant": contrat["codeavenant"], "IdProduit": contrat["idproduit"],
        "NumeroPolice": contrat["numeropolice"], "EstBase": contrat["idcontrat"] == base["idcontrat"],
        "IdContratBase": base["idcontrat"], "IdDevisBase": base["iddevis"],
        "IdDevisComposition": composition[0] if composition else None,
        "DateEffet": _iso(base["dateeffet"]), "DateExpiration": _iso(base["dateexpiration"]),
        "Contrats": [c["idcontrat"] for c in contrats],
        "Mouvements": [{
            "IdContrat": c["idcontrat"], "IdDevis": c["iddevis"], "Avenant": c["codeavenant"],
            "LibelleAvenant": (c["libelleavenant"] or "").strip(), "NumeroAvenant": (c["numeroavenant"] or "").strip(),
            "DateEffet": _iso(c["dateeffet"]), "PrimeTtc": float(c["primettc"]), "NumeroQuittance": c["numeroquittance"],
        } for c in contrats if c["idcontrat"] != base["idcontrat"]],
        "Totaux": totaux,
        "Encaisse": float(sum(c["encaisse"] for c in contrats)),
        "Quittances": [c["numeroquittance"] for c in contrats if c["numeroquittance"]],
    }


def objets_periode(cursor, periode):
    """Objets assurés de la période (véhicules d'une flotte) : une ligne par matricule, la plus récente, du contrat de
    base et des avenants de la période (incorporations comprises), sans les objets retirés ou annulés depuis ; comme
    fn_liste_objets_assures, mais bornée à la période du contrat et non à la période en cours de la police."""
    return [l["idcontratdetail"] for l in _lignes(cursor, """
        SELECT L.idcontratdetail FROM (
            SELECT DISTINCT ON (TRIM(COALESCE(cd.matricule, ''))) TRIM(COALESCE(cd.matricule, '')) AS matricule,
                   cd.idcontratdetail, c.dateeffet AS date_ligne
            FROM stdcontratdetail cd JOIN stdcontrat c ON c.idcontrat = cd.idcontrat
            WHERE c.idcontrat = ANY(%(contrats)s)
            ORDER BY TRIM(COALESCE(cd.matricule, '')), c.dateeffet DESC, c.idcontrat DESC, cd.idcontratdetail DESC
        ) AS L
        WHERE NOT EXISTS (SELECT 1 FROM stdcontratdetail sd JOIN stdcontrat sr ON sr.idcontrat = sd.idcontrat
                          JOIN stdavenant ar ON ar.idavenant = sr.idavenant
                          WHERE sr.numeropolice = %(police)s AND ar.codeavenant IN ('ANL', 'ANP', 'RET', 'RES')
                            AND TRIM(COALESCE(sd.matricule, '')) = L.matricule AND L.matricule <> ''
                            AND sr.dateeffet >= L.date_ligne AND sr.dateeffet::date <= %(fin)s)
        ORDER BY L.idcontratdetail""",
        {"contrats": periode["Contrats"], "police": periode["NumeroPolice"], "fin": periode["DateExpiration"]})]


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def periode(request, idcontrat):
    """GET /api/contrat/<idcontrat>/periode/ : période du contrat, mouvements et primes de la période."""
    with connection.cursor() as cursor:
        donnees = periode_contrat(cursor, idcontrat)
    if donnees is None:
        return Response({"error": "Contrat introuvable ou sans période."}, status=status.HTTP_404_NOT_FOUND)
    return Response(donnees)
