"""
Devis Assurance Voyage : enregistrement (création ou « Modifier ») et relecture complète.

L'enregistrement passe par la procédure d'URANUS sp_creation_devis_voyage (en-tête, ligne,
complément voyage, garanties et primes). La prime vient de la grille de la base
(fn_garantie_offre_voyage -> fn_calcul_prime_voyage_by_age : zone de destination x durée x âge,
par offre pour NSIA, par tarif pour AMSA), l'accessoire de fn_get_accessoire.
La route d'URANUS (enregistrementdevisvoyage) exige un jeton Knox réel : LE PHARE passe par
celle-ci, comme pour l'IA et la Santé.

Contrôles faits ici, dans la même transaction (tout ou rien) :
- durée du voyage (expiration - effet) d'au moins 1 jour : la procédure prépare le message
  « durée du voyage incorrecte » puis l'écrase et enregistre un devis à 0 F ;
- pays de destination rattaché à une zone de la compagnie, offre de la formule et de la zone ;
- prime nulle (âge ou durée hors de la grille) : rien n'est enregistré ;
- numéro de police compagnie : reçu par la procédure mais jamais écrit, il est posé ici ;
- devis repris sans complément voyage : le complément est créé (la procédure ne fait qu'un UPDATE).
"""

from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.db import connection, transaction
from rest_framework import permissions, status
from rest_framework.authentication import BasicAuthentication
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.response import Response

from core.date_parser import date_emission_du_jour
from institutionnel.authentication import KnoxOrDemoTokenAuthentication

from .database import enregistrer_terme_devis

ID_INTERMEDIAIRE = 1
ID_PRODUIT_VOYAGE = 3
ID_AVENANT_AFFAIRE_NOUVELLE = 1
TAUX_REDUCTION_MAX = Decimal("35")


class ErreurDevisVoyage(Exception):
    """Erreur de saisie à afficher telle quelle à l'utilisateur."""


def _date(valeur, champ):
    if isinstance(valeur, date):
        return valeur
    texte = str(valeur or "").strip()[:10]
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(texte, fmt).date()
        except ValueError:
            continue
    raise ErreurDevisVoyage(f"{champ} : date invalide ({valeur!r}).")


def _entier(valeur, champ, obligatoire=True):
    try:
        nombre = int(valeur or 0)
    except (TypeError, ValueError):
        raise ErreurDevisVoyage(f"{champ} : valeur invalide ({valeur!r}).")
    if obligatoire and nombre <= 0:
        raise ErreurDevisVoyage(f"{champ} : à renseigner.")
    return nombre


def _texte(valeur, longueur):
    return str(valeur or "").strip()[:longueur]


def _nombre(valeur):
    return float(valeur) if valeur is not None else 0


def _iso(valeur):
    if valeur is None:
        return None
    if isinstance(valeur, datetime):
        valeur = valeur.date()
    return valeur.isoformat()


def _une_ligne(cursor, sql, params):
    cursor.execute(sql, params)
    return cursor.fetchone()


def _zone_destination(cursor, id_compagnie, id_pays):
    ligne = _une_ligne(
        cursor,
        """
        SELECT z.id_zone, z.libelle_zone
        FROM stdzonevoyagepays zp
        JOIN stdzonevoyage z ON z.id_zone = zp.id_zone
        WHERE z.id_compagnie = %s AND zp.id_pays = %s
        LIMIT 1
        """,
        [id_compagnie, id_pays],
    )
    return (ligne[0], ligne[1]) if ligne else (None, None)


def _lire_saisie(donnees):
    saisie = {
        "id_devis": _entier(donnees.get("IdDevis"), "Devis", obligatoire=False),
        "id_compagnie": _entier(donnees.get("IdCompagnie"), "Compagnie"),
        "id_tarif": _entier(donnees.get("IdTarif"), "Formule"),
        "id_offre": _entier(donnees.get("IdOffre"), "Offre"),
        "id_client": _entier(donnees.get("IdClient"), "Souscripteur"),
        "id_assure": _entier(donnees.get("IdAssure") or donnees.get("IdClient"), "Assuré"),
        "id_pays_destination": _entier(donnees.get("IdPaysDestination"), "Pays de destination"),
        "id_pays_voyageur": _entier(donnees.get("IdPaysVoyageur"), "Nationalité"),
        "date_effet": _date(donnees.get("DateEffet"), "Date d'effet"),
        "date_expiration": _date(donnees.get("DateExpiration"), "Date d'expiration"),
        "date_naissance": _date(donnees.get("DateNaissance"), "Date de naissance"),
        "reference_contrat": _texte(donnees.get("ReferenceContrat"), 50),
        "numero_attestation": _texte(donnees.get("NumeroAttestation"), 30),
        "numero_passeport": _texte(donnees.get("NumeroPasseport"), 30),
        "numero_police_compagnie": _texte(donnees.get("NumeroPoliceCompagnie"), 60),
        "schengen": bool(donnees.get("Schengen")),
        "id_terme": donnees.get("IdTerme"),
    }
    try:
        saisie["taux_reduction"] = Decimal(str(donnees.get("TauxReduction") or 0))
    except InvalidOperation:
        raise ErreurDevisVoyage("Réduction : valeur invalide.")
    if not Decimal("0") <= saisie["taux_reduction"] <= TAUX_REDUCTION_MAX:
        raise ErreurDevisVoyage("La réduction doit être comprise entre 0 et 35 %.")
    if (saisie["date_expiration"] - saisie["date_effet"]).days < 1:
        raise ErreurDevisVoyage(
            "La durée du voyage est incorrecte : la date d'expiration doit suivre la date d'effet d'au moins un jour."
        )
    if saisie["date_naissance"] > date.today():
        raise ErreurDevisVoyage("La date de naissance ne peut pas être dans le futur.")
    return saisie


def _controler(cursor, saisie):
    """Contrôles de cohérence avant l'appel de la procédure. Renvoie l'avenant à conserver."""
    id_avenant = ID_AVENANT_AFFAIRE_NOUVELLE
    if saisie["id_devis"]:
        devis = _une_ligne(
            cursor,
            "SELECT idproduit, confirme, idavenant FROM stddevis WHERE iddevis = %s",
            [saisie["id_devis"]],
        )
        if not devis:
            raise ErreurDevisVoyage("Devis inexistant : modification impossible.")
        if devis[0] != ID_PRODUIT_VOYAGE:
            raise ErreurDevisVoyage("Ce devis n'est pas un devis Voyage.")
        if devis[1]:
            raise ErreurDevisVoyage("Devis déjà confirmé (contrat émis) : modification impossible.")
        if not _une_ligne(cursor, "SELECT 1 FROM stddevisdetail WHERE iddevis = %s", [saisie["id_devis"]]):
            raise ErreurDevisVoyage(
                "Ce devis repris d'URANUS n'a pas de ligne de détail en base : il ne peut pas être modifié."
            )
        # Un devis de renouvellement garde son mouvement (la procédure réécrit IdAvenant)
        id_avenant = devis[2] or ID_AVENANT_AFFAIRE_NOUVELLE

    for champ, libelle in (("id_client", "Souscripteur"), ("id_assure", "Assuré")):
        if not _une_ligne(cursor, "SELECT 1 FROM stdclient WHERE idclient = %s", [saisie[champ]]):
            raise ErreurDevisVoyage(f"{libelle} introuvable (client n° {saisie[champ]}).")
    if not _une_ligne(cursor, "SELECT 1 FROM stdpays WHERE id_pays = %s", [saisie["id_pays_voyageur"]]):
        raise ErreurDevisVoyage("Nationalité inconnue.")

    id_zone, _ = _zone_destination(cursor, saisie["id_compagnie"], saisie["id_pays_destination"])
    if not id_zone:
        raise ErreurDevisVoyage(
            "Ce pays de destination n'est rattaché à aucune zone de voyage de la compagnie choisie."
        )
    cursor.execute(
        "SELECT id_offre FROM fn_liste_offre_voyage(%s, %s, %s)",
        [saisie["id_compagnie"], saisie["id_tarif"], id_zone],
    )
    if saisie["id_offre"] not in {ligne[0] for ligne in cursor.fetchall()}:
        raise ErreurDevisVoyage("Cette offre n'est pas proposée pour la formule et la destination choisies.")
    return id_avenant


def enregistrer_devis_voyage(donnees):
    saisie = _lire_saisie(donnees)
    with transaction.atomic(), connection.cursor() as cursor:
        id_avenant = _controler(cursor, saisie)
        cursor.execute(
            "CALL sp_creation_devis_voyage(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
            [
                ID_INTERMEDIAIRE,
                saisie["id_compagnie"],
                ID_PRODUIT_VOYAGE,
                saisie["id_offre"],
                id_avenant,
                saisie["id_client"],
                saisie["id_assure"],
                False,
                False,
                saisie["date_effet"],
                saisie["date_expiration"],
                date_emission_du_jour(),
                saisie["id_tarif"],
                saisie["id_pays_destination"],
                saisie["id_pays_voyageur"],
                saisie["reference_contrat"],
                saisie["numero_attestation"],
                saisie["schengen"],
                saisie["numero_passeport"],
                saisie["taux_reduction"],
                saisie["date_naissance"],
                saisie["numero_police_compagnie"],
                saisie["id_devis"],
                "",
            ],
        )
        id_devis, message = cursor.fetchone()
        if not id_devis:
            raise ErreurDevisVoyage(message or "Le devis n'a pas été enregistré.")

        ligne = _une_ligne(
            cursor,
            "SELECT iddevisdetail FROM stddevisdetail WHERE iddevis = %s ORDER BY iddevisdetail LIMIT 1",
            [id_devis],
        )
        if ligne and not _une_ligne(
            cursor, "SELECT 1 FROM stdcomplementdevisdetailvoyage WHERE iddevisdetail = %s", [ligne[0]]
        ):
            cursor.execute(
                """
                INSERT INTO stdcomplementdevisdetailvoyage(iddevisdetail, numeroattestation, numeropasseport,
                    idpaysdestination, idpaysvoyageur, referencecontrat, visaschengen)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    ligne[0],
                    saisie["numero_attestation"],
                    saisie["numero_passeport"],
                    saisie["id_pays_destination"],
                    saisie["id_pays_voyageur"],
                    saisie["reference_contrat"],
                    saisie["schengen"],
                ],
            )
        cursor.execute(
            "UPDATE stddevis SET numeropolicecompagnie = %s WHERE iddevis = %s",
            [saisie["numero_police_compagnie"] or None, id_devis],
        )

        totaux = _une_ligne(
            cursor,
            "SELECT numerodevis, primeannuelle, primenette, accessoire, taxe, primettc FROM stddevis WHERE iddevis = %s",
            [id_devis],
        )
        if not totaux or not totaux[2] or totaux[2] <= 0:
            raise ErreurDevisVoyage(
                "Aucune prime au tarif pour ces paramètres (âge de l'assuré, durée ou zone hors de la grille) : "
                "le devis n'a pas été enregistré."
            )
        enregistrer_terme_devis(id_devis, saisie["id_terme"])

    return {
        "ObjectId": id_devis,
        "OutputMessage": message or "Devis enregistré avec succès.",
        "NumeroDevis": totaux[0],
        "PrimeAnnuelle": _nombre(totaux[1]),
        "PrimeNette": _nombre(totaux[2]),
        "Accessoire": _nombre(totaux[3]),
        "Taxe": _nombre(totaux[4]),
        "PrimeTtc": _nombre(totaux[5]),
    }


@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def enregistrer_devis_voyage_vue(request):
    """POST /api/devisvoyage/enregistrement/ (IdDevis > 0 : modification)"""
    try:
        resultat = enregistrer_devis_voyage(request.data)
    except ErreurDevisVoyage as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as erreur:  # message de la base (RAISE EXCEPTION de la procédure)
        message = str(erreur).split("\n")[0]
        return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)
    return Response(resultat, status=status.HTTP_201_CREATED)


def _personne(cursor, id_client):
    ligne = _une_ligne(
        cursor,
        """
        SELECT idclient, TRIM(nom || ' ' || COALESCE(prenoms, '')), telephone, mobile, adresse1,
               adresse2, datenaissance
        FROM stdclient WHERE idclient = %s
        """,
        [id_client],
    )
    if not ligne:
        return None
    return {
        "IdClient": ligne[0],
        "Nom": ligne[1],
        "Telephone": ligne[2] or ligne[3] or "",
        "Adresse": ligne[4] or "",
        "AdresseGeographique": ligne[5] or "",
        "DateNaissance": _iso(ligne[6]),
    }


@api_view(["GET"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def lire_devis_voyage(request, iddevis):
    """GET /api/devisvoyage/<iddevis>/ : tout ce qui a été saisi et calculé sur le devis."""
    with connection.cursor() as cursor:
        entete = _une_ligne(
            cursor,
            """
            SELECT d.iddevis, d.numerodevis, d.idproduit, d.confirme, COALESCE(d.archive, FALSE), d.idavenant,
                   d.idcompagnie, d.idclient, d.idassure, d.dateemission, d.dateeffet, d.dateexpiration,
                   d.idterme, d.idduree, d.numeropolicecompagnie, d.primeannuelle, d.primenette,
                   d.accessoire, d.taxe, d.primettc
            FROM stddevis d WHERE d.iddevis = %s
            """,
            [iddevis],
        )
        if not entete:
            return Response({"error": f"Devis {iddevis} introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if entete[2] != ID_PRODUIT_VOYAGE:
            return Response({"error": "Ce devis n'est pas un devis Voyage."}, status=status.HTTP_400_BAD_REQUEST)

        detail = _une_ligne(
            cursor,
            """
            SELECT dd.iddevisdetail, dd.idoffre, o.libelleoffre, dd.idtarif, t.libelle, dd.tauxreduction,
                   dd.datemec, c.idpaysdestination, pd.libelle_pays, c.idpaysvoyageur, pv.nationalite,
                   c.referencecontrat, c.numeroattestation, c.numeropasseport, c.visaschengen,
                   c.idcomplement
            FROM stddevisdetail dd
            LEFT JOIN stdoffre o ON o.idoffre = dd.idoffre
            LEFT JOIN stdtarif t ON t.idtarif = dd.idtarif
            LEFT JOIN stdcomplementdevisdetailvoyage c ON c.iddevisdetail = dd.iddevisdetail
            LEFT JOIN stdpays pd ON pd.id_pays = c.idpaysdestination
            LEFT JOIN stdpays pv ON pv.id_pays = c.idpaysvoyageur
            WHERE dd.iddevis = %s
            ORDER BY dd.iddevisdetail
            LIMIT 1
            """,
            [iddevis],
        )
        garanties = []
        id_zone, libelle_zone = None, None
        if detail:
            if detail[7]:
                id_zone, libelle_zone = _zone_destination(cursor, entete[6], detail[7])
            cursor.execute(
                """
                SELECT g.idgarantie, sg.libellesousgarantie, g.acquise, g.capital, g.maxfranchise,
                       g.primeannuelle, g.primenette, g.taxe
                FROM stddevisdetgarantie g
                LEFT JOIN stdsousgarantie sg ON sg.idsousgarantie = g.idgarantie
                WHERE g.iddevisdet = %s
                ORDER BY g.idgarantie
                """,
                [detail[0]],
            )
            garanties = [
                {
                    "IdSousGarantie": g[0],
                    "LibelleSousGarantie": g[1] or f"Garantie n° {g[0]}",
                    "Acquise": bool(g[2]),
                    "Capital": _nombre(g[3]),
                    "Franchise": _nombre(g[4]),
                    "PrimeAnnuelle": _nombre(g[5]),
                    "PrimeNette": _nombre(g[6]),
                    "Taxe": _nombre(g[7]),
                }
                for g in cursor.fetchall()
            ]
        client = _personne(cursor, entete[7])
        assure = client if entete[8] == entete[7] else _personne(cursor, entete[8])

    return Response(
        {
            "IdDevis": entete[0],
            "NumeroDevis": entete[1],
            "Confirme": bool(entete[3]),
            "Archive": bool(entete[4]),
            "IdAvenant": entete[5],
            "IdCompagnie": entete[6],
            "IdClient": entete[7],
            "IdAssure": entete[8],
            "DateEmission": _iso(entete[9]),
            "DateEffet": _iso(entete[10]),
            "DateExpiration": _iso(entete[11]),
            "IdTerme": entete[12],
            "IdDuree": entete[13],
            "NumeroPoliceCompagnie": entete[14] or "",
            "PrimeAnnuelle": _nombre(entete[15]),
            "PrimeNette": _nombre(entete[16]),
            "Accessoire": _nombre(entete[17]),
            "Taxe": _nombre(entete[18]),
            "PrimeTtc": _nombre(entete[19]),
            "Detail": {
                "IdDevisDetail": detail[0],
                "IdOffre": detail[1],
                "LibelleOffre": detail[2] or "",
                "IdTarif": detail[3],
                "LibelleTarif": detail[4] or "",
                "TauxReduction": _nombre(detail[5]),
                "DateNaissance": _iso(detail[6]),
            } if detail else None,
            "Complement": {
                "IdPaysDestination": detail[7],
                "LibellePaysDestination": detail[8] or "",
                "IdPaysVoyageur": detail[9],
                "Nationalite": detail[10] or "",
                "ReferenceContrat": detail[11] or "",
                "NumeroAttestation": detail[12] or "",
                "NumeroPasseport": (detail[13] or "").strip(),
                "Schengen": bool(detail[14]),
            } if detail and detail[15] else None,
            "IdZone": id_zone,
            "LibelleZone": libelle_zone or "",
            "Garanties": garanties,
            "Client": client,
            "Assure": assure,
        }
    )
