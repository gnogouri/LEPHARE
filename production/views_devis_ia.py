"""
Devis Individuelle Accidents : enregistrement complet (création ou « Modifier »).

Un seul appel enregistre, dans une transaction (tout ou rien), l'en-tête du devis,
chaque assuré (une ligne de devis par assuré), ses ayants droit, les lignes
retirées et, pour un groupe, les totaux du devis. Ce sont les procédures
d'URANUS : sp_creation_devis_ia (appelée une fois par assuré),
fn_saisie_ayant_droit_ia et sp_finalisation_devis.

En modification, une ligne marquée « Recalculer: false » n'est pas renvoyée à
sp_creation_devis_ia : ses primes, imposées ou non, restent telles quelles.

Catégories à tarif personnalisé (offres « SPECIFIQUE ») : la prime nette et
l'accessoire saisis pour l'assuré sont passés à la procédure avec la prime TTC,
comme URANUS. La base redéduit l'accessoire de la TTC : celle-ci est donc
calculée ici au franc près, pour que le devis garde l'accessoire saisi.
"""

from datetime import date, datetime
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal, InvalidOperation

from django.db import connection, transaction
from rest_framework import permissions, status
from rest_framework.authentication import BasicAuthentication
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.response import Response

from .ia_montants_imposes import appliquer as appliquer_montants_ia, oublier_si_change, ttc_par_ligne

from institutionnel.authentication import KnoxOrDemoTokenAuthentication

from .incorporation import _verifier_periode_devis, controler_assure_incorpore
from .database import enregistrer_terme_devis, id_duree_pour_procedure
from .import_assures import insert_new_assure
from .models import Devis, DevisDetail, DevisDetGarantie

ID_INTERMEDIAIRE = 1
ID_PRODUIT_IA = 2
ID_AVENANT_AFFAIRE_NOUVELLE = 1


class ErreurDevisIa(Exception):
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
    raise ErreurDevisIa(f"{champ} : date invalide ({valeur!r}).")


def _montant(valeur):
    try:
        montant = Decimal(str(valeur if valeur not in (None, "") else 0))
    except InvalidOperation:
        raise ErreurDevisIa(f"Montant invalide : {valeur!r}.")
    if not montant.is_finite():
        raise ErreurDevisIa(f"Montant invalide : {valeur!r}.")
    return montant


def _code_activite(id_profession):
    """Classe de risque de la profession IA (comme URANUS : code_classe_assure)."""
    from configuration_api.models import ProfessionIa

    profession = ProfessionIa.objects.filter(pk=id_profession).first()
    return (getattr(profession, "code_classe_assure", "") or "01") if profession else "01"


def _libelle_profession(id_profession):
    from configuration_api.models import ProfessionIa

    profession = ProfessionIa.objects.filter(pk=id_profession).first()
    return getattr(profession, "libelle_profession", "") if profession else ""


def _message(exc):
    texte = str(exc)
    return texte.split("\n")[0] if "\n" in texte else texte


def _taux_taxe(cursor, id_compagnie, id_offre, date_effet):
    """Taux de taxe (%) de l'offre IA à la date d'effet (fn_get_taux_taxe)."""
    cursor.execute(
        "SELECT fn_get_taux_taxe(%s, %s, %s, %s)",
        [id_compagnie, ID_PRODUIT_IA, id_offre, date_effet],
    )
    ligne = cursor.fetchone()
    return Decimal(ligne[0] or 0) if ligne else Decimal("0")


def _prime_ttc_imposee(prime_nette, accessoire, taux):
    """TTC dont sp_enregistrement_assure_ia redéduit exactement l'accessoire saisi."""
    taxe = ((prime_nette + accessoire) * taux / 100).quantize(Decimal("1"), ROUND_HALF_UP)
    return prime_nette + accessoire + taxe


# Tarifs CGA et CI-ENERGIES : sp_finalisation_devis calcule l'accessoire assuré par assuré
TARIFS_ACCESSOIRE_PAR_ASSURE = (145, 76)


def _repartir_au_prorata(total, poids):
    """Montant entier réparti au prorata des poids (à parts égales s'ils sont tous nuls), sans
    écart d'arrondi sur le total (méthode des plus forts restes)."""
    if not poids:
        return []
    somme = sum(poids)
    if somme <= 0:
        poids, somme = [Decimal(1)] * len(poids), Decimal(len(poids))
    bruts = [total * p / somme for p in poids]
    parts = [b.to_integral_value(rounding=ROUND_FLOOR) for b in bruts]
    reste = int(total - sum(parts))
    for i in sorted(range(len(bruts)), key=lambda i: bruts[i] - parts[i], reverse=True)[:reste]:
        parts[i] += 1
    return parts


def completer_assures_devis_ia(iddevis, lignes):
    """
    Ajoute à chaque assuré d'un devis IA (lignes sérialisées de fn_assure_ia_info) la profession
    à afficher et sa prime TTC, pour la fiche devis.

    Profession : celle choisie sur la ligne (id 0 = « AUTRE »), à défaut la fonction de la fiche
    de l'assuré, qui porte la colonne FONCTION des fichiers importés (comme les documents IA).

    Prime TTC : tarifs CGA et CI-ENERGIES, prime nette + taxe de la ligne + accessoire et taxe sur
    accessoire de l'assuré (fn_get_accessoire, comme sp_finalisation_devis). Autres tarifs,
    l'accessoire porte sur la prime nette totale : la TTC du devis est répartie au prorata des
    primes nettes (« prime_ttc_au_prorata »), de même quand les TTC par assuré ne retombent pas sur
    celle du devis (primes corrigées après coup).
    """
    from customer.models import Client

    if not lignes:
        return lignes
    fonctions = dict(
        Client.objects.filter(IdClient__in=[l.get("id_assure") for l in lignes])
        .values_list("IdClient", "Fonction")
    )
    for ligne in lignes:
        fonction = (fonctions.get(ligne.get("id_assure")) or "").strip()
        if int(ligne.get("id_profession") or 0) or not fonction:
            ligne["profession"] = ligne.get("libelle_profession") or ""
        else:
            ligne["profession"] = fonction

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT primettc, idcompagnie, dateeffet::date FROM stddevis WHERE iddevis = %s", [iddevis]
        )
        entete = cursor.fetchone()
        if not entete or entete[0] is None:
            return lignes
        ttc_devis = Decimal(entete[0]).quantize(Decimal("1"), ROUND_HALF_UP)
        id_compagnie, date_effet = entete[1], entete[2]
        # Accessoire + taxe sur accessoire propres à chaque ligne (tarifs CGA et CI-ENERGIES seuls)
        cursor.execute(
            """
            SELECT d.iddevisdetail, d.idtarif,
                   CASE WHEN d.idtarif = ANY(%s) THEN
                       (SELECT a.accessoire_compagnie + a.accessoire_intermediaire + a.taxe_sur_accessoire
                        FROM fn_get_accessoire(COALESCE(d.primenette, 0), 2, d.idoffre, %s, %s) AS a)
                   END
            FROM stddevisdetail d
            WHERE d.iddevis = %s
            """,
            [list(TARIFS_ACCESSOIRE_PAR_ASSURE), id_compagnie, date_effet, iddevis],
        )
        frais_lignes = {r[0]: (r[1], r[2]) for r in cursor.fetchall()}
        # Montants gardés du fichier ou du contrat renouvelé : la TTC de chaque assuré est exactement la sienne
        ttc_gardees = ttc_par_ligne(cursor, iddevis, lignes)

    primes_nettes = [_montant(l.get("prime_nette")) for l in lignes]
    ttc = None
    if ttc_gardees:
        ttc = [ttc_gardees[l["id_devis_detail"]].quantize(Decimal("0.01"), ROUND_HALF_UP) for l in lignes]
    elif all(frais_lignes.get(l.get("id_devis_detail"), (0, None))[0] in TARIFS_ACCESSOIRE_PAR_ASSURE for l in lignes):
        ttc = [
            (prime_nette + _montant(ligne.get("taxe")) + Decimal(str(frais_lignes[ligne["id_devis_detail"]][1] or 0)))
            .quantize(Decimal("1"), ROUND_HALF_UP)
            for ligne, prime_nette in zip(lignes, primes_nettes)
        ]
        if sum(ttc) != ttc_devis:
            ttc = None
    au_prorata = ttc is None
    if au_prorata:
        ttc = _repartir_au_prorata(ttc_devis, primes_nettes)
    for ligne, montant in zip(lignes, ttc):
        ligne["prime_ttc"] = float(montant)
        ligne["prime_ttc_au_prorata"] = au_prorata
    return lignes


def _client_existant(cursor, nom, prenoms, date_naissance):
    """Fiche client aux mêmes nom, prénoms et date de naissance (clé unique posée par le déclencheur de stdclient,
    trg_clients_cle_unique) : reprise plutôt que recréée. Sans cela une personne déjà connue (assuré Santé MINENE
    incorporé en IA, ancien assuré, fiche archivée) faisait échouer l'enregistrement sur stdclient_cle_unique_key.
    Les fiches portant une CNI ont une autre clé : une nouvelle fiche reste possible pour elles."""
    cursor.execute(
        "SELECT idclient FROM stdclient WHERE cle_unique = 'COMP-' || LOWER(TRIM(%s)) || '|' || LOWER(TRIM(%s)) || '|' || %s::date::text "
        "ORDER BY idclient LIMIT 1",
        [nom, prenoms, date_naissance],
    )
    ligne = cursor.fetchone()
    return ligne[0] if ligne else 0


def _enregistrer(data):
    assures = data.get("Assures") or []
    if not assures:
        raise ErreurDevisIa("Ajoutez au moins un assuré.")

    flotte = bool(data.get("Flotte"))
    id_devis = int(data.get("IdDevis") or 0)
    incorporation = False
    if id_devis:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT a.codeavenant, b.dateeffet::date, d.dateexpiration::date FROM stddevis d
                   JOIN stdavenant a ON a.idavenant = d.idavenant LEFT JOIN stddevis b ON b.iddevis = d.idoldhist
                   WHERE d.iddevis = %s""",
                [id_devis],
            )
            mouvement = cursor.fetchone()
        incorporation = bool(mouvement) and mouvement[0] == "INC"
    # Incorporation : toujours en groupe, seule l'échéance du contrat est figée
    if incorporation:
        flotte = True
    if not flotte and len(assures) > 1:
        raise ErreurDevisIa(
            "Cette catégorie est individuelle : un seul assuré par devis. "
            "Choisissez une catégorie « groupe » pour assurer plusieurs personnes."
        )

    id_client = int(data.get("IdClient") or 0)
    if not id_client:
        raise ErreurDevisIa("Choisissez le souscripteur.")

    id_compagnie = int(data["IdCompagnie"])
    id_offre = int(data["IdOffre"])
    id_tarif = int(data["IdTarif"])
    # Incorporation : durée déduite des dates, la date d'incorporation étant au choix
    id_duree = 0 if incorporation else id_duree_pour_procedure(data.get("IdDuree"))
    date_effet = _date(data.get("DateEffet"), "Date d'effet")
    date_expiration = _date(data.get("DateExpiration"), "Date d'expiration")
    if incorporation:
        try:
            _verifier_periode_devis("INC", mouvement[1], mouvement[2], date_effet, date_expiration)
        except ValueError as erreur:
            raise ErreurDevisIa(str(erreur))
    date_emission = _date(data.get("DateEmission"), "Date d'émission")
    taux_reduction = _montant(data.get("TauxReduction"))
    numero_police_compagnie = str(data.get("NumeroPoliceCompagnie") or "")
    numero_police_connexe = str(data.get("NumeroPoliceConnexe") or "")

    id_avenant = ID_AVENANT_AFFAIRE_NOUVELLE
    lignes_retirees = set()
    if id_devis:
        devis = Devis.objects.select_for_update().filter(pk=id_devis).first()
        if not devis:
            raise ErreurDevisIa(f"Devis {id_devis} introuvable.")
        if devis.confirme:
            raise ErreurDevisIa(
                "Ce devis est confirmé (déjà en contrat) : il ne peut plus être modifié."
            )
        if devis.produit_id != ID_PRODUIT_IA:
            raise ErreurDevisIa("Ce devis n'est pas un devis Individuelle Accidents.")
        id_avenant = devis.avenant_id or ID_AVENANT_AFFAIRE_NOUVELLE

        existantes = set(
            DevisDetail.objects.filter(iddevis_id=id_devis).values_list(
                "iddevisdetail", flat=True
            )
        )
        gardees = {int(a.get("IdDevisDetail") or 0) for a in assures} - {0}
        inconnues = gardees - existantes
        if inconnues:
            raise ErreurDevisIa(
                f"Assuré(s) introuvable(s) dans ce devis : lignes {sorted(inconnues)}."
            )
        lignes_retirees = existantes - gardees
        if lignes_retirees:
            DevisDetGarantie.objects.filter(IdDevisDet_id__in=lignes_retirees).delete()
            DevisDetail.objects.filter(iddevisdetail__in=lignes_retirees).delete()

    lignes_calculees = 0
    taux_taxe = None
    with connection.cursor() as cursor:
        for rang, assure in enumerate(assures, start=1):
            libelle = f"Assuré n° {rang}"
            id_profession = int(assure.get("IdProfession") or 0)
            date_naissance = _date(assure.get("DateNaissance"), f"{libelle} : date de naissance")

            # Assuré saisi par son nom : fiche existante reprise, sinon fiche client créée comme à l'import URANUS
            id_assure = int(assure.get("IdAssure") or 0)
            if not id_assure:
                nom = str(assure.get("Nom") or "").strip().upper()
                if not nom:
                    raise ErreurDevisIa(f"{libelle} : le nom est obligatoire.")
                prenoms = str(assure.get("Prenoms") or "").strip().upper()
                id_assure = _client_existant(cursor, nom, prenoms, date_naissance)
                if not id_assure:
                    client = insert_new_assure(
                        {
                            "Nom": nom,
                            "Prenoms": prenoms,
                            "DateNaissance": date_naissance,
                            "LieuNaissance": str(assure.get("LieuNaissance") or ""),
                            "AdresseGeographique": str(assure.get("AdresseGeographique") or ""),
                            "NumeroMobile": str(assure.get("Telephone") or ""),
                            "Fonction": _libelle_profession(id_profession),
                            "Sexe": str(assure.get("Sexe") or ""),
                        }
                    )
                    id_assure = client.IdClient
            libelle = f"{libelle} ({assure.get('Nom') or id_assure})"
            if incorporation and not int(assure.get("IdDevisDetail") or 0):
                try:
                    controler_assure_incorpore(cursor, id_devis, id_assure, str(assure.get("Nom") or id_assure).strip())
                except ValueError as erreur:
                    raise ErreurDevisIa(str(erreur))

            # Ayants droit : la liste saisie remplace celle de l'assuré
            ayants = assure.get("AyantsDroit")
            if ayants is not None and assure.get("AyantsDroitModifies", True):
                total = sum(_montant(a.get("Part")) for a in ayants)
                if total > 100:
                    raise ErreurDevisIa(
                        f"{libelle} : le total des parts des ayants droit dépasse 100 % ({total} %)."
                    )
                cursor.execute("DELETE FROM stdayantdroitia WHERE idassure = %s", [id_assure])
                for ayant in ayants:
                    nom_ayant = str(ayant.get("Nom") or "").strip().upper()
                    if not nom_ayant:
                        raise ErreurDevisIa(f"{libelle} : chaque ayant droit doit avoir un nom.")
                    cursor.execute(
                        "SELECT fn_saisie_ayant_droit_ia(%s, %s, %s, %s, %s)",
                        [
                            id_assure,
                            int(ayant.get("IdQualiteAyantDroit") or 0),
                            nom_ayant,
                            str(ayant.get("Prenoms") or "").strip().upper(),
                            _montant(ayant.get("Part")),
                        ],
                    )

            id_devis_detail = int(assure.get("IdDevisDetail") or 0)
            if id_devis and id_devis_detail and not assure.get("Recalculer", True):
                continue  # ligne inchangée : primes conservées
            # Montant gardé (fichier, renouvellement) : il tombe si les capitaux, l'offre changent ou si une autre prime est saisie
            if id_devis and id_devis_detail:
                cursor.execute("SELECT TRIM(matricule) FROM stddevisdetail WHERE iddevisdetail = %s", [id_devis_detail])
                ligne_matricule = cursor.fetchone()
                if ligne_matricule:
                    oublier_si_change(cursor, id_devis, ligne_matricule[0], _montant(assure.get("CapitalDeces")), _montant(assure.get("CapitalIpp")),
                                      id_offre, _montant(assure.get("PrimeNette")))

            # Tarif personnalisé : primes de l'assuré saisies (0 = primes du barème)
            prime_nette = _montant(assure.get("PrimeNette"))
            accessoire = _montant(assure.get("Accessoire"))
            if prime_nette < 0 or accessoire < 0:
                raise ErreurDevisIa(f"{libelle} : la prime nette et l'accessoire ne peuvent pas être négatifs.")
            prime_ttc = Decimal("0")
            if prime_nette > 0:
                if taux_taxe is None:
                    taux_taxe = _taux_taxe(cursor, id_compagnie, id_offre, date_effet)
                prime_ttc = _prime_ttc_imposee(prime_nette, accessoire, taux_taxe)
            else:
                accessoire = Decimal("0")

            try:
                cursor.execute(
                    "CALL sp_creation_devis_ia(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                    "%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                    (
                        ID_INTERMEDIAIRE,
                        id_compagnie,
                        ID_PRODUIT_IA,
                        id_offre,
                        id_avenant,
                        id_client,
                        id_assure,
                        id_profession,
                        flotte,
                        False,
                        date_effet,
                        date_expiration,
                        date_emission,
                        id_tarif,
                        _montant(assure.get("CapitalDeces")),
                        _montant(assure.get("CapitalIpp")),
                        _montant(assure.get("FraisTraitement")),
                        taux_reduction,
                        _code_activite(id_profession),
                        date_naissance,
                        str(assure.get("AdresseGeographique") or ""),
                        numero_police_connexe,
                        numero_police_compagnie,
                        id_duree,
                        prime_nette,
                        accessoire,
                        prime_ttc,
                        id_devis,
                        id_devis_detail,
                        "",
                    ),
                )
            except Exception as exc:
                raise ErreurDevisIa(f"{libelle} : {_message(exc)}")
            ligne = cursor.fetchone()
            id_devis = ligne[0]
            lignes_calculees += 1

        # Groupe : totaux du devis recalculés si une ligne a changé
        if flotte and (lignes_calculees or lignes_retirees):
            cursor.execute(
                "CALL sp_finalisation_devis(%s, %s, %s, %s, %s);",
                [id_devis, id_client, id_client, True, ""],
            )
        # Montants exacts gardés (fichier importé, contrat renouvelé) réappliqués après le calcul
        if lignes_calculees or lignes_retirees:
            appliquer_montants_ia(cursor, id_devis)

    # sp_creation_devis_ia n'a pas de paramètre terme : posé sur le devis après création
    enregistrer_terme_devis(id_devis, data.get("IdTerme"))

    devis = Devis.objects.get(pk=id_devis)
    return {
        "devis_id": devis.iddevis,
        "numero_devis": devis.numerodevis or "",
        "lignes_recalculees": lignes_calculees,
        "lignes_retirees": len(lignes_retirees),
        "totaux": {
            "prime_nette": float(devis.primenette or 0),
            "taxe": float(devis.taxe or 0),
            "accessoire": float(devis.accessoire or 0),
            "prime_ttc": float(devis.primettc or 0),
        },
    }


@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def enregistrer_devis_ia_complet(request):
    """
    POST /api/devisia/enregistrement/

    {
      "IdDevis": 0,                      // id du devis à modifier, 0 pour créer
      "IdCompagnie": 1, "IdTarif": 78, "IdOffre": 7, "Flotte": true,
      "IdClient": 2312,                  // souscripteur
      "DateEffet": "2026-01-01", "DateExpiration": "2026-12-31", "DateEmission": "2026-04-29",
      "IdDuree": 4, "TauxReduction": 0, "NumeroPoliceCompagnie": "",
      "Assures": [
        {"IdDevisDetail": 0, "IdAssure": 0, "Nom": "DAN", "Prenoms": "ALAIN",
         "DateNaissance": "1984-02-16", "IdProfession": 12, "AdresseGeographique": "",
         "CapitalDeces": 5000000, "CapitalIpp": 10000000, "FraisTraitement": 0,
         "Recalculer": true, "AyantsDroitModifies": true,
         "AyantsDroit": [{"IdQualiteAyantDroit": 1, "Nom": "...", "Prenoms": "...", "Part": 50}]}
      ]
    }
    """
    try:
        with transaction.atomic():
            resultat = _enregistrer(request.data)
    except ErreurDevisIa as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except KeyError as exc:
        return Response(
            {"error": f"Champ obligatoire manquant : {exc.args[0]}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception as exc:
        return Response({"error": _message(exc)}, status=status.HTTP_400_BAD_REQUEST)
    code = status.HTTP_200_OK if int(request.data.get("IdDevis") or 0) else status.HTTP_201_CREATED
    return Response(resultat, status=code)


@api_view(["GET"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def taux_taxe_devis_ia(request):
    """
    GET /api/devisia/taux-taxe/?IdCompagnie=1&IdOffre=173&DateEffet=2026-10-01

    Taux de taxe (%) appliqué par la base aux primes imposées de l'offre : l'écran
    affiche ainsi la taxe et la TTC que le devis enregistrera.
    """
    try:
        id_compagnie = int(request.query_params.get("IdCompagnie") or 0)
        id_offre = int(request.query_params.get("IdOffre") or 0)
        date_effet = _date(request.query_params.get("DateEffet"), "Date d'effet")
    except (ValueError, ErreurDevisIa) as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    with connection.cursor() as cursor:
        taux = _taux_taxe(cursor, id_compagnie, id_offre, date_effet)
    return Response({"taux": float(taux)})


@api_view(["GET"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def accessoire_devis_ia(request):
    """
    GET /api/devisia/accessoire/?IdCompagnie=1&IdOffre=173&DateEffet=2026-10-01&PrimeNette=250000

    Accessoire (compagnie + cabinet) et taxe sur accessoire que sp_finalisation_devis posera sur
    un devis IA groupe de cette prime nette totale (fn_get_accessoire, lecture seule) : le
    récapitulatif affiche la prime TTC avant l'enregistrement.
    """
    try:
        id_compagnie = int(request.query_params.get("IdCompagnie") or 0)
        id_offre = int(request.query_params.get("IdOffre") or 0)
        date_effet = _date(request.query_params.get("DateEffet"), "Date d'effet")
        prime_nette = _montant(request.query_params.get("PrimeNette"))
    except (ValueError, ErreurDevisIa) as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT accessoire_compagnie, accessoire_intermediaire, taxe_sur_accessoire "
            "FROM fn_get_accessoire(%s, 2, %s, %s, %s)",
            [prime_nette, id_offre, id_compagnie, date_effet],
        )
        ligne = cursor.fetchone() or (0, 0, 0)
    compagnie, cabinet, taxe = (Decimal(str(v or 0)) for v in ligne)
    return Response({
        "accessoire": float(compagnie + cabinet),
        "accessoire_compagnie": float(compagnie),
        "accessoire_intermediaire": float(cabinet),
        "taxe_accessoire": float(taxe),
    })


@api_view(["GET"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def garanties_devis_ia(request, iddevis):
    """
    GET /api/devisia/<iddevis>/garanties/

    Garanties enregistrées de chaque assuré du devis (stddevisdetgarantie), pour le
    tableau Garantie / Acquise / Capital / P. annuelle / P. nette du récapitulatif.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT g.iddevisdet, g.idgarantie, s.libellesousgarantie, g.acquise,
                   g.capital, g.primeannuelle, g.primenette, g.taxe
            FROM stddevisdetgarantie g
            JOIN stddevisdetail d ON d.iddevisdetail = g.iddevisdet
            LEFT JOIN stdsousgarantie s ON s.idsousgarantie = g.idgarantie
            WHERE d.iddevis = %s AND g.idgarantie <> 0
            ORDER BY g.iddevisdet, g.idgarantie
            """,
            [iddevis],
        )
        lignes = cursor.fetchall()
    return Response(
        [
            {
                "id_devis_detail": l[0],
                "id_garantie": l[1],
                "libelle": (l[2] or "").strip(),
                "acquise": bool(l[3]),
                "capital": float(l[4] or 0),
                "prime_annuelle": float(l[5] or 0),
                "prime_nette": float(l[6] or 0),
                "taxe": float(l[7] or 0),
            }
            for l in lignes
        ]
    )
