"""Incorporation d'un véhicule dans une police Automobile flotte, ou d'une personne dans un contrat Individuelle Accidents
à plusieurs personnes (demande du 2026-11-03), dans un contrat Vie AFA (demande du 2026-11-09) ou d'une maison dans un
contrat MRH (demande du 2026-11-10).

IA : la personne se saisit dans l'écran IA, sa prime est le tarif de l'offre (fn_garantie_offre_ia), comme les incorporations
IA d'URANUS ; le Prorata et le mode forfaitaire ci-dessous ne concernent que l'Automobile.
Vie AFA : la personne se saisit ou s'importe dans l'écran AFA (production/afa.py), sa prime est reprise telle quelle,
sans prorata (tarif forfaitaire). La police AFA du package Oreole Santé s'incorpore depuis la branche Oreole Santé.
MRH : la maison se saisit dans l'écran MRH ; sa prime nette, la taxe et l'accessoire y sont saisis à la main comme pour
tout devis MRH (pas de barème), donc sans prorata calculé ici.

Le devis d'incorporation (avenant INC) garde l'échéance du contrat principal ; sa date d'effet est la date
d'incorporation. Prime du véhicule : prime annuelle au prorata des jours couverts jusqu'à l'échéance
(jours / 365 ou 366), ou, pour une affaire à tarif forfaitaire, prime annuelle entière sans prorata et prime
nette du fichier Excel reprise telle quelle par l'écran Auto. Le mode est gardé dans lephare_incorporation et
transmis aux moteurs NSIA par le réglage de session lephare.incorporation (fn_calcul_taux_prime_fractionnee v3).
"""

import logging
import re
from contextlib import contextmanager

from django.db import DatabaseError, connection, transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from . import vie_offres
from .renouvellement import AUTHENTIFICATION, ErreurRenouvellement, _contrat_base, _date, _iso, _lignes

ID_PRODUIT_AUTO = 1
ID_PRODUIT_IA = 2
ID_PRODUIT_MRH = 4
ID_PRODUIT_VIE = 10
PRODUITS_INCORPORATION = (ID_PRODUIT_AUTO, ID_PRODUIT_IA, ID_PRODUIT_MRH, ID_PRODUIT_VIE)
OFFRE_IA_MINENE = 66
MODULES = {ID_PRODUIT_AUTO: "auto", ID_PRODUIT_IA: "ia", ID_PRODUIT_MRH: "mrh", ID_PRODUIT_VIE: "afa"}
MODE_PRORATA = "prorata"
MODE_FORFAIT = "forfait"
logger = logging.getLogger(__name__)

# En-tête recopié du contrat par sp_avenant_creation_devis_initial : primes de toute la flotte quand elles étaient
# imposées ; le devis d'incorporation ne porte que les véhicules ajoutés, tarifés à leur enregistrement
SQL_ENTETE_A_ZERO = """
    UPDATE stddevis SET primeannuelle = 0, primenette = 0, accessoire = 0, taxe = 0, fga = 0, cedeao = 0, primettc = 0,
           accessoirecompagnie = 0, accessoiregestionnaire = 0, accessoireintermediaire = 0, commissionaperiteur = 0,
           commissiongestionnaire = 0, commissionintermediaire = 0, primeimposee = false, primeimposeedate = NULL
    WHERE iddevis = %s
"""


def _verifier_periode(date_effet, debut, expiration):
    """Date d'incorporation au choix, passée ou future, dans la période du contrat (demande du 2026-11-03)."""
    if not date_effet:
        raise ErreurRenouvellement("Saisissez la date d'incorporation.")
    if date_effet > expiration or date_effet < debut:
        raise ErreurRenouvellement(
            f"La date d'incorporation doit être comprise dans la période du contrat, du {debut:%d/%m/%Y} "
            f"au {expiration:%d/%m/%Y}."
        )


def _verifier_periode_devis(code_avenant, debut_contrat, expiration_stockee, effet_demande, expiration_demandee):
    """Devis d'incorporation : seule l'échéance est figée ; la date d'incorporation reste dans la période du contrat."""
    if code_avenant != "INC":
        return
    if expiration_stockee != expiration_demandee:
        raise ValueError("L'échéance d'un devis d'incorporation reste celle du contrat.")
    if debut_contrat and not debut_contrat <= effet_demande <= expiration_stockee:
        raise ValueError(
            f"La date d'incorporation doit être comprise dans la période du contrat, du {debut_contrat:%d/%m/%Y} "
            f"au {expiration_stockee:%d/%m/%Y}."
        )


def _personnes(cursor, police):
    """Personnes ou véhicules de la période en cours de la police, incorporations comprises."""
    cursor.execute("SELECT COUNT(*) FROM fn_liste_objets_assures(%s)", [police])
    return cursor.fetchone()[0]


def _ia_minene(cursor, id_devis):
    """IA rattachée à une police Santé MINENE (offre 66) : contrat de groupe par nature, même à une seule personne."""
    cursor.execute("SELECT 1 FROM stddevisdetail WHERE iddevis = %s AND idoffre = %s LIMIT 1", [id_devis, OFFRE_IA_MINENE])
    return bool(cursor.fetchone())


def _afa_oreole(cursor, police):
    """Police AFA du package Oreole Santé : la branche Oreole Santé incorpore dans ses trois polices à la fois."""
    cursor.execute("SELECT to_regclass('lephare_oreole_package') IS NOT NULL")
    if not cursor.fetchone()[0]:
        return False
    cursor.execute(
        """SELECT 1 FROM lephare_oreole_package p JOIN stdcontrat c ON c.iddevis = p.iddevis_afa
           WHERE c.numeropolice = %s LIMIT 1""",
        [police],
    )
    return bool(cursor.fetchone())


def _contrat_flottant(cursor, id_contrat):
    base = _contrat_base(cursor, id_contrat)
    if base["idproduit"] == ID_PRODUIT_IA:
        if not base["flotte"] and _personnes(cursor, base["numeropolice"]) <= 1 and not _ia_minene(cursor, base["iddevis"]):
            raise ErreurRenouvellement("Contrat individuel : l'incorporation est réservée aux contrats à plusieurs personnes.")
    elif base["idproduit"] == ID_PRODUIT_VIE:
        # AFA : contrat de groupe par nature, même à une seule personne ; Retraite complémentaire : les entrants figurent
        # dans l'état des cotisations du mois suivant (production/vie_retraite.py), pas d'incorporation
        offre = vie_offres.offre_du_devis(cursor, base["iddevis"])
        if offre["Saisie"] == vie_offres.SAISIE_COTISATION:
            raise ErreurRenouvellement(
                f"{offre['Libelle']} : un salarié entrant s'ajoute à l'état des cotisations du mois suivant, pas par une incorporation."
            )
        if _afa_oreole(cursor, base["numeropolice"]):
            raise ErreurRenouvellement(
                "Police AFA du package Oreole Santé : incorporez la personne depuis le bloc Oreole Santé du contrat Santé, "
                "qui ajoute aussi sa part Santé et IA."
            )
    elif base["idproduit"] == ID_PRODUIT_MRH:
        pass  # MRH : une maison s'ajoute à tout contrat en cours, même à une seule maison
    elif base["idproduit"] != ID_PRODUIT_AUTO or not base["flotte"]:
        raise ErreurRenouvellement(
            "L'incorporation est réservée aux flottes Automobile, aux contrats Individuelle Accidents à plusieurs personnes, "
            "aux contrats MRH et aux contrats Vie AFA."
        )
    return base


def _devis_en_cours(cursor, id_devis_base):
    return _lignes(cursor, """
        SELECT d.iddevis AS "IdDevis", d.numerodevis AS "NumeroDevis",
               d.dateeffet::date AS "DateEffet", d.dateexpiration::date AS "DateExpiration",
               COALESCE(i.forfaitaire, FALSE) AS "Forfaitaire"
        FROM stddevis d
        JOIN stdavenant a ON a.idavenant = d.idavenant
        LEFT JOIN lephare_incorporation i ON i.iddevis = d.iddevis
        WHERE a.codeavenant = 'INC' AND d.idoldhist = %s
          AND NOT COALESCE(d.confirme, FALSE) AND NOT COALESCE(d.archive, FALSE)
        ORDER BY d.iddevis DESC
    """, [id_devis_base])


def _devis_incorporation(cursor, id_devis):
    """Devis d'incorporation Automobile, IA, MRH ou Vie (None pour tout autre devis) : période, mode et police du contrat."""
    lignes = _lignes(cursor, """
        SELECT d.iddevis, d.dateeffet::date AS dateeffet, d.dateexpiration::date AS dateexpiration, d.idoldhist,
               COALESCE(i.forfaitaire, FALSE) AS forfaitaire, d.idproduit,
               (SELECT c.dateeffet::date FROM stdcontrat c WHERE c.iddevis = d.idoldhist ORDER BY c.idcontrat DESC LIMIT 1) AS debut,
               (SELECT c.numeropolice FROM stdcontrat c WHERE c.iddevis = d.idoldhist ORDER BY c.idcontrat DESC LIMIT 1) AS police,
               (SELECT c.idcontrat FROM stdcontrat c WHERE c.iddevis = d.idoldhist ORDER BY c.idcontrat DESC LIMIT 1) AS idcontrat
        FROM stddevis d
        JOIN stdavenant a ON a.idavenant = d.idavenant
        LEFT JOIN lephare_incorporation i ON i.iddevis = d.iddevis
        WHERE d.iddevis = %s AND a.codeavenant = 'INC' AND d.idproduit = ANY(%s)
    """, [id_devis, list(PRODUITS_INCORPORATION)])
    return lignes[0] if lignes else None


def mode_incorporation(cursor, id_devis):
    """« prorata » ou « forfait » pour un devis d'incorporation Automobile, None sinon."""
    if not id_devis:
        return None
    devis = _devis_incorporation(cursor, id_devis)
    if not devis:
        return None
    return MODE_FORFAIT if devis["forfaitaire"] else MODE_PRORATA


@contextmanager
def tarification_incorporation(mode):
    """Moteurs Automobile appelés dans ce bloc : prorata au jour (incorporation) ou prime annuelle entière (affaire
    forfaitaire). Réglage de session remis à vide en sortie (les appelants ferment parfois la connexion)."""
    if mode not in (MODE_PRORATA, MODE_FORFAIT):
        yield
        return
    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config('lephare.incorporation', %s, false)", [mode])
    try:
        yield
    finally:
        if connection.connection is not None:
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT set_config('lephare.incorporation', '', false)")
            except DatabaseError:
                # Transaction en échec : le réglage disparaît avec elle ou avec la connexion fermée par l'appelant
                logger.warning("Réglage lephare.incorporation non remis à vide.")


def _cle_immatriculation(matricule):
    return re.sub(r"[\s-]+", "", str(matricule or "")).upper()


def controler_vehicule_incorpore(cursor, id_devis, matricule):
    """Un véhicule déjà assuré dans la flotte (période en cours, incorporations comprises) ne s'incorpore pas."""
    devis = _devis_incorporation(cursor, id_devis)
    if not devis or not devis["police"]:
        return
    cle = _cle_immatriculation(matricule)
    cursor.execute("SELECT matricule FROM fn_liste_objets_assures(%s)", [devis["police"]])
    if cle and any(_cle_immatriculation(m) == cle for (m,) in cursor.fetchall()):
        raise ValueError(f"Le véhicule {matricule} est déjà assuré dans la flotte {devis['police']} : il ne peut pas être incorporé.")


def controler_assure_incorpore(cursor, id_devis, id_assure, nom):
    """Une personne déjà assurée sous la police (période en cours, incorporations comprises) ne s'incorpore pas."""
    devis = _devis_incorporation(cursor, id_devis)
    if not devis or not devis["police"]:
        return
    # Même fiche, ou fiche homonyme de la même personne (mêmes nom, prénoms et date de naissance)
    cursor.execute(
        """SELECT 1 FROM fn_liste_objets_assures(%s) l
           JOIN stdclient c ON LPAD(c.idclient::text, 20, '0') = TRIM(l.matricule)
           JOIN stdclient n ON n.idclient = %s
           WHERE c.idclient = n.idclient OR (LOWER(TRIM(c.nom)) = LOWER(TRIM(n.nom))
                 AND LOWER(TRIM(COALESCE(c.prenoms, ''))) = LOWER(TRIM(COALESCE(n.prenoms, '')))
                 AND c.datenaissance IS NOT DISTINCT FROM n.datenaissance)
           LIMIT 1""",
        [devis["police"], id_assure],
    )
    if cursor.fetchone():
        raise ValueError(f"{nom} est déjà assuré(e) dans la police {devis['police']} : cette personne ne peut pas être incorporée.")


def verifier_incorporation_non_vide(cursor, id_devis):
    """Un devis d'incorporation sans véhicule ni personne ne se confirme pas : sp_confirmation_devis en faisait un
    avenant à 0 F avec sa quittance numérotée (constaté le 2026-11-10 après un import refusé). Les autres devis ne
    sont pas concernés (un devis repris d'URANUS peut n'avoir que son en-tête)."""
    cursor.execute(
        """SELECT a.codeavenant = 'INC', EXISTS (SELECT 1 FROM stddevisdetail x WHERE x.iddevis = d.iddevis)
           FROM stddevis d JOIN stdavenant a ON a.idavenant = d.idavenant WHERE d.iddevis = %s""",
        [id_devis],
    )
    ligne = cursor.fetchone()
    if ligne and ligne[0] and not ligne[1]:
        raise ValueError(
            "Ce devis d'incorporation ne contient encore aucune personne, aucun véhicule ni aucune maison : "
            "ajoutez-les puis enregistrez le devis avant de le confirmer."
        )


def _id_avenant_incorporation():
    with connection.cursor() as cursor:
        cursor.execute("SELECT idavenant FROM stdavenant WHERE codeavenant = 'INC'")
        ligne = cursor.fetchone()
    return ligne[0] if ligne else None


def _duree_annuelle(cursor, effet):
    cursor.execute("SELECT fn_get_duree_annuelle_contrat(%s)", [effet])
    return int(cursor.fetchone()[0] or 365)


@api_view(["GET", "POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def incorporation(request, pk):
    try:
        if request.method == "GET":
            with connection.cursor() as cursor:
                base = _contrat_flottant(cursor, pk)
                devis = _devis_en_cours(cursor, base["iddevis"])
                for ligne in devis:
                    ligne["DateEffet"] = _iso(ligne["DateEffet"])
                    ligne["DateExpiration"] = _iso(ligne["DateExpiration"])
                return Response({
                    "Contrat": {
                        "IdContrat": base["idcontrat"], "NumeroPolice": base["numeropolice"],
                        "Client": base["client"], "Compagnie": base["compagnie"],
                        "DateEffet": _iso(base["dateeffet"]), "DateExpiration": _iso(base["dateexpiration"]),
                        "Produit": base["produit"], "Module": MODULES[base["idproduit"]],
                        "Personnes": _personnes(cursor, base["numeropolice"]),
                    },
                    "DevisEnCours": devis,
                })

        with transaction.atomic(), connection.cursor() as cursor:
            base = _contrat_flottant(cursor, pk)
            forfaitaire = base["idproduit"] == ID_PRODUIT_AUTO and request.data.get("Forfaitaire") in (True, "true", "1", 1)
            en_cours = _devis_en_cours(cursor, base["iddevis"])
            if en_cours:
                raise ErreurRenouvellement(
                    f"Un devis d'incorporation est déjà en cours ({en_cours[0]['NumeroDevis']}) : "
                    "terminez-le ou supprimez-le d'abord."
                )
            effet = _date(request.data.get("DateEffet"))
            _verifier_periode(effet, base["dateeffet"], base["dateexpiration"])
            cursor.execute("SELECT idavenant FROM stdavenant WHERE codeavenant = 'INC'")
            avenant = cursor.fetchone()
            if not avenant:
                raise ErreurRenouvellement("Le mouvement d'incorporation n'est pas configuré.")
            cursor.execute(
                "CALL sp_avenant_creation_devis_initial(%s, %s, %s, %s, %s, %s, '', 0, '')",
                [request.user.id, base["idcontrat"], avenant[0], timezone.localdate(), effet, base["dateexpiration"]],
            )
            id_devis, message = cursor.fetchone()
            if not id_devis:
                raise ErreurRenouvellement(message or "Le devis d'incorporation n'a pas pu être créé.")
            cursor.execute(
                """SELECT d.numerodevis, d.dateeffet::date, d.dateexpiration::date, d.flotte, a.codeavenant
                   FROM stddevis d JOIN stdavenant a ON a.idavenant = d.idavenant WHERE d.iddevis = %s""",
                [id_devis],
            )
            devis = cursor.fetchone()
            if not devis or devis[1] != effet or devis[2] != base["dateexpiration"] or devis[4] != "INC" or (
                base["idproduit"] == ID_PRODUIT_AUTO and not devis[3]
            ):
                raise ErreurRenouvellement("L'échéance du contrat n'a pas été conservée : création du devis annulée.")
            numero = devis[0]
            cursor.execute(SQL_ENTETE_A_ZERO, [id_devis])
            # IA : l'incorporation se saisit en groupe (sp_creation_devis_ia), même sous un contrat hors catégorie groupe ;
            # police connexe reprise (obligatoire en MINENE, non recopiée par sp_avenant_creation_devis_initial).
            # MRH : le devis garde l'indicateur de la police (une maison ajoutée ne fait pas une flotte)
            cursor.execute(
                """UPDATE stddevis d SET flotte = (d.idproduit <> 4 OR COALESCE(b.flotte, FALSE)),
                          numeropoliceconnexe = b.numeropoliceconnexe
                   FROM stddevis b WHERE d.iddevis = %s AND b.iddevis = d.idoldhist""",
                [id_devis],
            )
            if base["idproduit"] in (ID_PRODUIT_VIE, ID_PRODUIT_MRH):
                # AFA, MRH : le devis ne porte que les personnes ou maisons ajoutées, saisies ensuite dans leur écran
                cursor.execute(
                    "DELETE FROM stddevisdetgarantie WHERE iddevisdet IN (SELECT iddevisdetail FROM stddevisdetail WHERE iddevis = %s)",
                    [id_devis],
                )
                cursor.execute("DELETE FROM stddevisdetail WHERE iddevis = %s", [id_devis])
            cursor.execute(
                "INSERT INTO lephare_incorporation (iddevis, idcontrat, forfaitaire, idutilisateur) VALUES (%s, %s, %s, %s)",
                [id_devis, base["idcontrat"], forfaitaire, request.user.id],
            )
        return Response({
            "IdDevis": id_devis, "NumeroDevis": numero, "Module": MODULES[base["idproduit"]],
            "DateEffet": _iso(effet), "DateExpiration": _iso(base["dateexpiration"]), "Forfaitaire": forfaitaire,
            "Message": message,
        }, status=status.HTTP_201_CREATED)
    except (ErreurRenouvellement, ValueError) as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except DatabaseError:
        logger.exception("Erreur SQL lors de la préparation d'une incorporation pour le contrat %s.", pk)
        return Response(
            {"error": "Impossible de préparer l'incorporation pour le moment. Réessayez ou contactez votre administrateur."},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def devis_incorporation(request, iddevis):
    """GET /api/incorporation/devis/<iddevis>/ : période et mode de tarification d'un devis d'incorporation, pour
    l'écran Auto ({"Incorporation": false} pour tout autre devis)."""
    with connection.cursor() as cursor:
        devis = _devis_incorporation(cursor, iddevis)
        if not devis:
            return Response({"Incorporation": False})
        jours = (devis["dateexpiration"] - devis["dateeffet"]).days + 1
        annee = _duree_annuelle(cursor, devis["dateeffet"])
        # Valeurs reprises de la police pour un devis d'incorporation encore sans objet assuré
        reprise = _lignes(cursor, """
            SELECT idtarif, idoffre, COALESCE(tauxreduction, 0) AS tauxreduction FROM stddevisdetail
            WHERE iddevis = %s ORDER BY iddevisdetail LIMIT 1""", [devis["idoldhist"]])
        personnes = _personnes(cursor, devis["police"]) if devis["police"] else 0
    return Response({
        "IdProduit": devis["idproduit"], "Personnes": personnes, "IdAvenant": _id_avenant_incorporation(),
        "IdTarif": reprise[0]["idtarif"] if reprise else None, "IdOffre": reprise[0]["idoffre"] if reprise else None,
        "TauxReduction": float(reprise[0]["tauxreduction"]) if reprise else 0,
        "Incorporation": True, "IdDevis": devis["iddevis"], "IdContrat": devis["idcontrat"], "NumeroPolice": devis["police"] or "",
        "DateEffet": _iso(devis["dateeffet"]), "DateExpiration": _iso(devis["dateexpiration"]),
        "DateEffetContrat": _iso(devis["debut"]),
        "Forfaitaire": devis["forfaitaire"], "Mode": MODE_FORFAIT if devis["forfaitaire"] else MODE_PRORATA,
        "JoursCouverts": jours, "JoursAnnee": annee, "Prorata": round(min(1, jours / annee), 6),
    })
