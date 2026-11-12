"""
Devis « risques divers » (RC, Multirisque Professionnelle) et Tous Dommages : lecture de tout
ce qui a été saisi sur la ligne du devis, pour le bouton « Modifier ».

sp_creation_devis_risques_divers range les capitaux et l'activité sur stddevisdetail
(ValeurNeuve = dommages corporels, ValeurVenale = intoxication alimentaire,
ValeurAccessoire = dommages matériels, Observation = activité) et, pour la RC,
le taux, l'assiette, les participants, le domaine d'activité, la localisation et la
date de début dans stdcomplementdevisdetailrc. Pour Tous Dommages (sp_creation_devis_tousrisquesinfo),
les mêmes colonnes portent les capitaux matériel informatique / frais de reconstitution /
frais supplémentaires, le taux et le montant de prime sont dans stdcomplementdevisdetaildommage
et le capital cautionnement n'est gardé que sur la garantie « CAUTION ».
Aucune API ne les renvoyait ensemble.
"""

from datetime import date

from django.db import connection
from rest_framework import permissions, status
from rest_framework.authentication import BasicAuthentication
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.response import Response

from institutionnel.authentication import KnoxOrDemoTokenAuthentication


def _nombre(valeur):
    return float(valeur) if valeur is not None else 0


@api_view(["GET"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def lire_devis_risques_divers(request, iddevis):
    """GET /api/devisrisquesdivers/<iddevis>/"""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT d.idproduit, dd.iddevisdetail, dd.idtarif, dd.idoffre, dd.tauxreduction,
                   dd.valeurneuve, dd.valeurvenale, dd.valeuraccessoire, dd.observation,
                   rc.tauxprime, rc.assietteprime, rc.nombreparticipants, rc.iddomaineactivite,
                   rc.localisation, rc.datedebut, dm.tauxprime, dm.montantprime,
                   (SELECT MAX(g.capital) FROM stddevisdetgarantie g
                      JOIN stdsousgarantie sg ON sg.idsousgarantie = g.idgarantie
                     WHERE g.iddevisdet = dd.iddevisdetail
                       AND UPPER(TRIM(sg.libellesousgarantie)) = 'CAUTION') AS capital_caution
            FROM stddevis d
            JOIN stddevisdetail dd ON dd.iddevis = d.iddevis
            LEFT JOIN stdcomplementdevisdetailrc rc ON rc.iddevisdetail = dd.iddevisdetail
            LEFT JOIN stdcomplementdevisdetaildommage dm ON dm.iddevisdetail = dd.iddevisdetail
            WHERE d.iddevis = %s
            ORDER BY dd.iddevisdetail
            LIMIT 1
            """,
            [iddevis],
        )
        ligne = cursor.fetchone()
    if not ligne:
        return Response(
            {"error": f"Devis {iddevis} introuvable ou sans ligne."},
            status=status.HTTP_404_NOT_FOUND,
        )
    return Response(
        {
            "IdProduit": ligne[0],
            "IdDevisDetail": ligne[1],
            "IdTarif": ligne[2],
            "IdOffre": ligne[3],
            "TauxReduction": _nombre(ligne[4]),
            "CapitalDommageCorporel": _nombre(ligne[5]),
            "CapitalIntoxicationAlimentaire": _nombre(ligne[6]),
            "CapitalDommageMateriel": _nombre(ligne[7]),
            "Activite": ligne[8] or "",
            "TauxPrime": _nombre(ligne[9]),
            "AssiettePrime": _nombre(ligne[10]),
            "NombreParticipants": int(ligne[11] or 0),
            "IdDomaineActivite": ligne[12] or 0,
            "Localisation": ligne[13] or "",
            "DateDebut": ligne[14].isoformat() if ligne[14] else "",
            # Tous Dommages
            "TauxPrimeDommage": _nombre(ligne[15]),
            "MontantPrime": _nombre(ligne[16]),
            "CapitalCautionnement": _nombre(ligne[17]),
        }
    )


# Valeurs habituelles d'un champ : les plus fréquentes parmi les devis du produit (montant ou taux > 0)
NOMBRE_VALEURS_USUELLES = 6

CHAMPS_USUELS = {
    "Accessoire": "d.accessoire",
    "TauxReduction": "dd.tauxreduction",
    "TauxPrime": "rc.tauxprime",
    "CapitalDommageCorporel": "dd.valeurneuve",
    "CapitalIntoxicationAlimentaire": "dd.valeurvenale",
    "CapitalDommageMateriel": "dd.valeuraccessoire",
}

CHAMPS_USUELS_GARANTIE = {
    "Capital": "g.capital",
    "FranchiseMinimum": "g.minfranchise",
    "FranchiseMaximum": "g.maxfranchise",
    "TauxFranchise": "g.tauxfranchise",
}


@api_view(["GET"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def valeurs_usuelles(request):
    """GET /api/valeursusuelles/?produit=<id> : valeurs proposées dans les listes déroulantes des montants et taux
    saisis à la main (RC et MRH sans barème, décision du 2026-10-28), lues dans les devis déjà enregistrés du
    produit : accessoire, réduction, taux de prime et capitaux du risque, et par sous-garantie capital, franchises
    et taux de franchise. Chaque liste : [{"Valeur", "Nombre"}] du plus fréquent au moins fréquent."""
    try:
        produit = int(request.query_params.get("produit") or 0)
    except ValueError:
        produit = 0
    if not produit:
        return Response({"error": "Produit attendu (?produit=)."}, status=status.HTTP_400_BAD_REQUEST)

    def liste(lignes):
        return [{"Valeur": _nombre(v), "Nombre": n} for v, n in lignes]

    reponse = {}
    garanties = {}
    with connection.cursor() as cursor:
        for cle, colonne in CHAMPS_USUELS.items():
            cursor.execute(
                f"""
                SELECT {colonne}, COUNT(DISTINCT d.iddevis)
                FROM stddevis d
                JOIN stddevisdetail dd ON dd.iddevis = d.iddevis
                LEFT JOIN stdcomplementdevisdetailrc rc ON rc.iddevisdetail = dd.iddevisdetail
                WHERE d.idproduit = %s AND {colonne} > 0
                GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT %s
                """,
                [produit, NOMBRE_VALEURS_USUELLES],
            )
            reponse[cle] = liste(cursor.fetchall())
        for cle, colonne in CHAMPS_USUELS_GARANTIE.items():
            cursor.execute(
                f"""
                SELECT idgarantie, valeur, nombre FROM (
                    SELECT g.idgarantie, {colonne} AS valeur, COUNT(*) AS nombre,
                           ROW_NUMBER() OVER (PARTITION BY g.idgarantie ORDER BY COUNT(*) DESC, {colonne}) AS rang
                    FROM stddevisdetgarantie g
                    JOIN stddevisdetail dd ON dd.iddevisdetail = g.iddevisdet
                    JOIN stddevis d ON d.iddevis = dd.iddevis
                    WHERE d.idproduit = %s AND {colonne} > 0
                    GROUP BY g.idgarantie, {colonne}
                ) t WHERE rang <= %s ORDER BY idgarantie, rang
                """,
                [produit, NOMBRE_VALEURS_USUELLES],
            )
            for idgarantie, valeur, nombre in cursor.fetchall():
                garanties.setdefault(str(idgarantie), {}).setdefault(cle, []).append(
                    {"Valeur": _nombre(valeur), "Nombre": nombre}
                )
    reponse["Garanties"] = garanties
    return Response(reponse)


@api_view(["GET"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def garanties_ajoutables(request, idproduit):
    """GET /api/devisrisquesdivers/garanties/<idproduit>/?date=AAAA-MM-JJ : garanties que l'écran propose d'ajouter au
    devis (« Ajouter une garantie », comme l'Automobile) : le catalogue des garanties « risques divers » d'URANUS
    (stdsousgarantie.saisierd) et celles dont la taxe est réglée pour le produit. TauxTaxe : taux réglé pour le produit à
    la date d'effet, sinon vide (sp_calcul_devis_prime_imposee v2 applique alors le taux habituel du produit)."""
    try:
        jour = date.fromisoformat(str(request.query_params.get("date") or "")[:10])
    except ValueError:
        jour = date.today()
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT sg.idsousgarantie, TRIM(sg.libellesousgarantie), TRIM(COALESCE(sg.codesousgarantie, '')),
                   (SELECT tt.tauxtaxe FROM stdtauxtaxegarantieproduit tt
                     WHERE tt.idproduit = %s AND tt.idgarantie = sg.idsousgarantie AND %s BETWEEN tt.debutvalidite AND tt.finvalidite
                     ORDER BY tt.debutvalidite DESC LIMIT 1)
            FROM stdsousgarantie sg
            WHERE COALESCE(sg.active, TRUE)
              AND (COALESCE(sg.saisierd, FALSE)
                   OR EXISTS (SELECT 1 FROM stdtauxtaxegarantieproduit tt WHERE tt.idproduit = %s AND tt.idgarantie = sg.idsousgarantie))
            """,
            [idproduit, jour, idproduit],
        )
        lignes = cursor.fetchall()
    # Libellés en double (ex. DOMMAGES ÉLECTRIQUES) : le code de la garantie après un tiret les distingue
    occurrences = {}
    for _, libelle, _, _ in lignes:
        occurrences[(libelle or "").upper()] = occurrences.get((libelle or "").upper(), 0) + 1
    garanties = []
    for i, libelle, code, taux in lignes:
        libelle = libelle or f"Garantie {i}"
        if occurrences[libelle.upper()] > 1 and code:
            libelle = f"{libelle} - {code}"
        garanties.append({"IdSousGarantie": i, "LibelleSousGarantie": libelle, "TauxTaxe": _nombre(taux) if taux is not None else None})
    return Response(sorted(garanties, key=lambda g: g["LibelleSousGarantie"]))
