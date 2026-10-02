"""
Devis Santé : saisie et enregistrement depuis LE PHARE, fidèles à URANUS.

Le parcours est celui d'URANUS (SanteForm) : un devis vide est initialisé
(sp_initialisation_devis_sante), puis les couvertures souscrites (filiales), les
adhérents et leurs affiliés y sont saisis un à un, enfin les primes sont calculées
et le devis numéroté par sp_creation_devis_sante. Les fonctions appelées sont celles
d'URANUS (sante/utils.py) ; seules changent l'authentification (celle du projet,
comme les autres routes LE PHARE : les routes d'écriture d'URANUS exigent un jeton
Knox réel) et la conversion des champs envoyés en multipart (« false » y est une
chaîne, que bool() lirait comme vrai).

La base rattache toute la saisie à l'opérateur qui l'a initialisée : un devis ouvert
par un autre opérateur ne peut être modifié que par lui (message de la procédure).
"""

from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import connection, transaction
from django.db.models import Q
from rest_framework import permissions, status
from rest_framework.authentication import BasicAuthentication
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    parser_classes,
    permission_classes,
)
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from core.date_parser import date_emission_du_jour
from institutionnel.authentication import KnoxOrDemoTokenAuthentication
from production.database import enregistrer_terme_devis
from production.models import Devis

from .models import Adherent, Affilie, FilialeSante
from .serializers import EnregistrementDevisSanteSerializer
from .utils import (
    enregistrer_adherent_sante,
    enregistrer_affilie_sante,
    enregistrer_filiale_sante,
    get_quotation_id,
    save_quotation_sante,
)

ID_PRODUIT_SANTE = 5
ID_INTERMEDIAIRE = 1
ID_AVENANT_AFFAIRE_NOUVELLE = 1
# Gestionnaire des contrats Santé dans URANUS (champ non modifiable de l'écran Contrat)
GESTIONNAIRE_SANTE = "VITALIS SANTE"

AUTHENTIFICATION = [KnoxOrDemoTokenAuthentication, BasicAuthentication]


def _texte(valeur):
    return "" if valeur is None else str(valeur).strip()


def _booleen(valeur):
    if isinstance(valeur, bool):
        return valeur
    return _texte(valeur).lower() in ("true", "1", "on", "oui", "vrai")


def _montant(valeur):
    try:
        return Decimal(_texte(valeur).replace(" ", "") or "0")
    except InvalidOperation:
        return Decimal("0")


def _entier(valeur):
    try:
        return int(Decimal(_texte(valeur) or "0"))
    except (InvalidOperation, ValueError):
        return 0


def _date_jj_mm_aaaa(valeur):
    """Date au format JJ-MM-AAAA attendu par les fonctions d'URANUS ('NA' si absente)."""
    texte = _texte(valeur)[:10]
    if not texte:
        return "NA"
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(texte, fmt).strftime("%d-%m-%Y")
        except ValueError:
            continue
    return texte


def _jour(valeur):
    if isinstance(valeur, datetime):
        return valeur.date().isoformat()
    if isinstance(valeur, date):
        return valeur.isoformat()
    return valeur


def _url_fichier(nom):
    return f"{settings.MEDIA_URL}{nom}" if nom else ""


def _reponse_procedure(err, ligne, champ_id):
    """Réponse d'une fonction d'URANUS (résultat d'insertion) : message de la base tel quel."""
    message = getattr(ligne, "outputmessage", "") if ligne else ""
    identifiant = getattr(ligne, champ_id, 0) if ligne else 0
    if err or not identifiant:
        return Response(
            {"error": message or "Enregistrement refusé par la base."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return Response({"id": identifiant, "message": message}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def initialiser_devis_sante(request):
    """
    POST /api/devissante/initialisation/

    Numéro de saisie d'URANUS : devis vide rattaché à l'opérateur, qui portera les
    couvertures, adhérents et affiliés jusqu'à l'enregistrement.
    """
    message, id_devis = get_quotation_id(request.user.id)
    if not id_devis:
        return Response({"error": message or "Initialisation impossible."}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"devis": id_devis, "message": message}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def enregistrer_filiale(request):
    """
    POST /api/devissante/filiale/

    « Enregistrer le collège » d'URANUS : une couverture souscrite (collège, formule,
    zone) du devis en saisie (sp_saisie_filiale_sante, source « S »).
    """
    data = request.data
    donnees = {
        "idfiliale": _entier(data.get("idfiliale")),
        "devis": _entier(data.get("devis")),
        "college": _entier(data.get("college")),
        "offresante": _entier(data.get("offresante")),
        "zonecouverture": _entier(data.get("zonecouverture")),
        "date_emission": date_emission_du_jour().strftime("%d-%m-%Y"),
        "date_effet": _date_jj_mm_aaaa(data.get("date_effet")),
        "date_expiration": _date_jj_mm_aaaa(data.get("date_expiration")),
        "source": _texte(data.get("source")) or "S",
    }
    if not (donnees["devis"] and donnees["college"] and donnees["offresante"] and donnees["zonecouverture"]):
        return Response(
            {"error": "Choisissez la formule de couverture, le collège et la zone."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if "NA" in (donnees["date_effet"], donnees["date_expiration"]):
        return Response({"error": "Dates d'effet et d'expiration obligatoires."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        err, lignes = enregistrer_filiale_sante(request.user.id, donnees)
    except Exception as exc:  # date mal formée, etc.
        return Response({"error": str(exc).split("\n")[0]}, status=status.HTTP_400_BAD_REQUEST)
    return _reponse_procedure(err, (lignes or [None])[0], "idfiliale")


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def enregistrer_adherent(request):
    """
    POST /api/devissante/adherent/  (multipart, pièce facultative « fichierpiece »)

    Création (idadherent 0) ou modification d'un adhérent : sp_saisie_adherent_sante,
    qui crée aussi l'affilié « A » du chef de famille. Clés d'URANUS ; la surprime est
    lue sous « surprimeappliquee » / « montantsurprime » (l'écran d'URANUS envoyait
    « supprimeappliquee » / « montantsuprime », jamais lus : surprime perdue).
    """
    data = request.data
    donnees = {
        "idadherent": _entier(data.get("idadherent")),
        "filiale": _entier(data.get("filiale")),
        "nom": _texte(data.get("nom")).upper(),
        "prenom": _texte(data.get("prenom")).upper(),
        "sexe": _texte(data.get("sexe")) or "F",
        "cni": _texte(data.get("cni")),
        # URANUS enregistre tous les adhérents saisis à l'écran en VIP
        "vip": "true" if _texte(data.get("vip")) == "" else str(_booleen(data.get("vip"))).lower(),
        "adresse": _texte(data.get("adresse")),
        "mobile1": _texte(data.get("mobile1")),
        "mobile2": _texte(data.get("mobile2")),
        "email": _texte(data.get("email")),
        "devis": _entier(data.get("devis")),
        "dateeffet": _date_jj_mm_aaaa(data.get("dateeffet")),
        "datedebutconsommation": _date_jj_mm_aaaa(data.get("datedebutconsommation")),
        "datenaissance": _date_jj_mm_aaaa(data.get("datenaissance")),
        "matricule": _texte(data.get("matricule")),
        "surprimeappliquee": _booleen(data.get("surprimeappliquee")),
        "montantsurprime": _montant(data.get("montantsurprime")) if _booleen(data.get("surprimeappliquee")) else 0,
        "nombrepathologie": _entier(data.get("nombrepathologie")),
        "numerocmu": _texte(data.get("numerocmu")),
        "groupesanguin": _texte(data.get("groupesanguin")) or "NS",
    }
    if not donnees["nom"]:
        return Response({"error": "Le nom de l'adhérent est obligatoire."}, status=status.HTTP_400_BAD_REQUEST)
    if donnees["datenaissance"] == "NA":
        return Response({"error": "La date de naissance de l'adhérent est obligatoire."}, status=status.HTTP_400_BAD_REQUEST)
    fichier = request.FILES.get("fichierpiece")
    err, lignes = enregistrer_adherent_sante(request.user.id, donnees, fichier)
    return _reponse_procedure(err, (lignes or [None])[0], "idadherent")


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def enregistrer_affilie(request):
    """
    POST /api/devissante/affilie/  (multipart, pièce facultative « fichierpiece »)

    Création (idaffilie 0) ou modification d'un affilié : sp_saisie_affilie_sante
    (âge des enfants, certificat de scolarité, taille de famille MINENE…).
    """
    data = request.data
    surprime = _booleen(data.get("surprimeappliquee"))
    donnees = {
        "idaffilie": _entier(data.get("idaffilie")),
        "adherent": _entier(data.get("adherent")),
        "lien": _texte(data.get("lien")).upper(),
        "nom": _texte(data.get("nom")).upper(),
        "prenom": _texte(data.get("prenom")).upper(),
        "cni": _texte(data.get("cni")),
        "datenaissance": _date_jj_mm_aaaa(data.get("datenaissance")),
        "certificat": _booleen(data.get("certificat")),
        "matricule": _texte(data.get("matricule")),
        "observations": _texte(data.get("observations")) or "RAS",
        "handicape": _booleen(data.get("handicape")),
        "sexe": _texte(data.get("sexe")) or "F",
        "devis": _entier(data.get("devis")),
        "dateeffet": _date_jj_mm_aaaa(data.get("dateeffet")),
        "datedebutconsommation": _date_jj_mm_aaaa(data.get("datedebutconsommation")),
        "surprimeappliquee": surprime,
        "montantsurprime": _montant(data.get("montantsurprime")) if surprime else 0,
        "nombrepathologie": _entier(data.get("nombrepathologie")),
        "numerocmu": _texte(data.get("numerocmu")),
        "groupesanguin": _texte(data.get("groupesanguin")) or "NS",
        "mobile1": _texte(data.get("mobile1")),
        "mobile2": _texte(data.get("mobile2")),
    }
    if donnees["lien"] not in ("C", "E"):
        return Response({"error": "Choisissez le lien de l'affilié (Conjoint(e) ou Enfant)."}, status=status.HTTP_400_BAD_REQUEST)
    if not donnees["nom"]:
        return Response({"error": "Le nom de l'affilié est obligatoire."}, status=status.HTTP_400_BAD_REQUEST)
    if donnees["datenaissance"] == "NA":
        return Response({"error": "La date de naissance de l'affilié est obligatoire."}, status=status.HTTP_400_BAD_REQUEST)
    fichier = request.FILES.get("fichierpiece")
    err, lignes = enregistrer_affilie_sante(request.user.id, donnees, fichier)
    return _reponse_procedure(err, (lignes or [None])[0], "idaffilie")


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def supprimer_objet_saisie(request):
    """
    POST /api/devissante/suppression/  {"type": "ADH" | "AFF" | "FIL", "id_devis": n, "id_objet": n}

    Règles d'URANUS (annuler_saisie_objet_sante) : devis Santé non confirmé ; le chef
    de famille (lien « A ») ne se retire qu'avec son adhérent ; retirer un adhérent
    retire ses affiliés, retirer une filiale retire ses adhérents et leurs affiliés.
    """
    type_objet = _texte(request.data.get("type")).upper()
    id_devis = _entier(request.data.get("id_devis"))
    id_objet = _entier(request.data.get("id_objet"))
    if type_objet not in ("ADH", "AFF", "FIL") or not id_devis or not id_objet:
        return Response({"error": "Suppression mal formulée."}, status=status.HTTP_400_BAD_REQUEST)
    devis = Devis.objects.filter(pk=id_devis).first()
    if not devis:
        return Response({"error": "Devis inexistant !"}, status=status.HTTP_400_BAD_REQUEST)
    if devis.confirme:
        return Response({"error": "Devis déjà confirmé. Opération impossible !"}, status=status.HTTP_400_BAD_REQUEST)
    if devis.produit_id != ID_PRODUIT_SANTE:
        return Response({"error": "Ce devis n'a pas été produit en Santé !"}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        if type_objet == "AFF":
            affilie = Affilie.objects.filter(pk=id_objet, devis=id_devis).first()
            if not affilie:
                return Response({"error": "Affilié inexistant !"}, status=status.HTTP_400_BAD_REQUEST)
            if affilie.lien == "A":
                return Response(
                    {"error": "Cet affilié est un chef de famille : retirez l'adhérent."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            affilie.delete()
        elif type_objet == "ADH":
            adherent = Adherent.objects.filter(pk=id_objet, devis=id_devis).first()
            if not adherent:
                return Response({"error": "Adhérent inexistant !"}, status=status.HTTP_400_BAD_REQUEST)
            Affilie.objects.filter(Q(adherent=adherent) & Q(devis=id_devis)).delete()
            adherent.delete()
        else:
            filiale = FilialeSante.objects.filter(pk=id_objet, devis=id_devis).first()
            if not filiale:
                return Response({"error": "Filiale inexistante !"}, status=status.HTTP_400_BAD_REQUEST)
            adherents = Adherent.objects.filter(Q(filiale=filiale) & Q(devis=id_devis))
            Affilie.objects.filter(Q(adherent__in=adherents) & Q(devis=id_devis)).delete()
            adherents.delete()
            filiale.delete()
    return Response({"message": "Suppression réalisée avec succès"}, status=status.HTTP_200_OK)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def enregistrer_devis_sante(request):
    """
    POST /api/devissante/enregistrement/

    « Enregistrer le devis » d'URANUS : sp_creation_devis_sante calcule les primes
    (MINENE automatique, sinon prime par famille, par affilié ou globale), numérote le
    devis et écrit le complément Santé. TauxReduction est signé (positif = réduction,
    négatif = majoration). La date d'émission est celle du jour.
    """
    data = dict(request.data)
    data.update(
        {
            "IdIntermediaire": ID_INTERMEDIAIRE,
            "IdProduit": ID_PRODUIT_SANTE,
            "IdAvenant": _entier(data.get("IdAvenant")) or ID_AVENANT_AFFAIRE_NOUVELLE,
            "IdAssure": _entier(data.get("IdAssure")) or _entier(data.get("IdClient")),
            "Flotte": False,
            "Coassurance": False,
            "DateEmission": date_emission_du_jour().strftime("%d-%m-%Y"),
            "DateEffet": _date_jj_mm_aaaa(data.get("DateEffet")),
            "DateExpiration": _date_jj_mm_aaaa(data.get("DateExpiration")),
            "GestionnaireSante": _texte(data.get("GestionnaireSante")) or GESTIONNAIRE_SANTE,
        }
    )
    if not _entier(data.get("IdDevis")):
        return Response({"error": "Aucune saisie en cours : enregistrez d'abord une couverture."}, status=status.HTTP_400_BAD_REQUEST)
    if not _entier(data.get("IdClient")):
        return Response({"error": "Choisissez le client."}, status=status.HTTP_400_BAD_REQUEST)
    if "NA" in (data["DateEffet"], data["DateExpiration"]):
        return Response({"error": "Dates d'effet et d'expiration obligatoires."}, status=status.HTTP_400_BAD_REQUEST)

    serializer = EnregistrementDevisSanteSerializer(data=data)
    if not serializer.is_valid():
        return Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
    err, lignes = save_quotation_sante(request.user.id, data)
    ligne = (list(lignes) or [None])[0]
    if err or not ligne or not ligne.ObjectId:
        return Response(
            {"error": (ligne.OutputMessage if ligne else "") or "Devis refusé par la base."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    # sp_creation_devis_sante n'a pas de paramètre terme : posé après création
    enregistrer_terme_devis(ligne.ObjectId, data.get("IdTerme"))
    devis = Devis.objects.get(pk=ligne.ObjectId)
    return Response(
        {
            "devis_id": devis.iddevis,
            "numero_devis": devis.numerodevis or "",
            "message": ligne.OutputMessage,
            "totaux": {
                "prime_nette": float(devis.primenette or 0),
                "taxe": float(devis.taxe or 0),
                "accessoire": float(devis.accessoire or 0),
                "prime_ttc": float(devis.primettc or 0),
            },
        },
        status=status.HTTP_201_CREATED,
    )


def _lignes(cursor, sql, params):
    cursor.execute(sql, params)
    colonnes = [c[0] for c in cursor.description]
    return [{k: _jour(v) if isinstance(v, (date, datetime)) else v for k, v in zip(colonnes, ligne)} for ligne in cursor.fetchall()]


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def lire_devis_sante(request, iddevis):
    """
    GET /api/devissante/<iddevis>/

    Tout ce qui a été saisi sur un devis Santé (en-tête, catégorie et formule, complément
    de primes, couvertures, adhérents, affiliés, garanties calculées) pour « Modifier »
    et l'aperçu. Lu par devis, sans filtre d'opérateur.
    """
    with connection.cursor() as cursor:
        entete = _lignes(
            cursor,
            """
            SELECT d.iddevis, d.numerodevis, d.confirme, COALESCE(d.archive, false) AS archive,
                   d.idproduit, d.idcompagnie, c.raisonsociale AS compagnie, d.idclient,
                   TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS client_nom,
                   d.dateemission::date AS dateemission, d.dateeffet::date AS dateeffet,
                   d.dateexpiration::date AS dateexpiration, d.idduree, d.idterme,
                   COALESCE(d.numeropolicecompagnie, '') AS numeropolicecompagnie,
                   d.primenette, d.taxe, d.accessoire, d.primettc, COALESCE(d.primeimposee, false) AS primeimposee,
                   n.idoperateur AS operateur_saisie, COALESCE(n.saisieencours, false) AS saisie_en_cours
            FROM stddevis d
            LEFT JOIN stdcompagnie c ON c.idcompagnie = d.idcompagnie
            LEFT JOIN stdclient cl ON cl.idclient = d.idclient
            LEFT JOIN stdnumerosaisiesante n ON n.iddevis = d.iddevis
            WHERE d.iddevis = %s
            """,
            [iddevis],
        )
        if not entete:
            return Response({"error": f"Devis {iddevis} introuvable."}, status=status.HTTP_404_NOT_FOUND)
        devis = entete[0]
        if devis["idproduit"] != ID_PRODUIT_SANTE:
            return Response({"error": "Ce devis n'est pas un devis Santé."}, status=status.HTTP_400_BAD_REQUEST)
        devis["operateur_courant"] = devis["operateur_saisie"] == request.user.id

        detail = _lignes(
            cursor,
            """
            SELECT dd.iddevisdetail, dd.idtarif, t.libelle AS libelle_tarif, t.codecategorie,
                   dd.idoffre, o.libelleoffre AS libelle_offre,
                   cs.primefamille, cs.primeaffilie, cs.primeglobale, cs.montantsurprime,
                   cs.montantaccessoiremanuel, cs.tauxreductioncommerciale, cs.idtypecontrat,
                   tc.libelle AS libelle_type_contrat, cs.gestionnairesante
            FROM stddevisdetail dd
            LEFT JOIN stdtarif t ON t.idtarif = dd.idtarif
            LEFT JOIN stdoffre o ON o.idoffre = dd.idoffre
            LEFT JOIN stdcomplementdevisdetailsante cs ON cs.iddevisdetail = dd.iddevisdetail
            LEFT JOIN stdtypecontratsante tc ON tc.idtypecontrat = cs.idtypecontrat
            WHERE dd.iddevis = %s
            ORDER BY dd.iddevisdetail
            LIMIT 1
            """,
            [iddevis],
        )
        filiales = _lignes(
            cursor,
            """
            SELECT f.idfiliale, f.nom_filiale, f.idcollege, co.libellecollege, f.idoffresante,
                   o.libelleoffre AS libelle_offre, o.idtarif, f.idzonecouverture, z.libellezone,
                   f.date_effet, f.date_expiration, f.source
            FROM stdfiliale f
            LEFT JOIN stdcollege co ON co.idcollege = f.idcollege
            LEFT JOIN stdoffre o ON o.idoffre = f.idoffresante
            LEFT JOIN stdzonecouverturesante z ON z.idzone = f.idzonecouverture
            WHERE f.iddevis = %s
            ORDER BY f.idfiliale
            """,
            [iddevis],
        )
        adherents = _lignes(
            cursor,
            """
            SELECT idadherent, idfiliale, nom, prenom, sexe, cni, fichierpiece, vip, adresse,
                   mobile1, mobile2, email, datenaissance, dateadhesion, datedebutconsommation,
                   COALESCE(surprimeappliquee, false) AS surprimeappliquee, montantsurprime,
                   COALESCE(nombrepathologie, 0) AS nombrepathologie, numerocmu, matricule, groupesanguin
            FROM stdadherent
            WHERE iddevis = %s
            ORDER BY idadherent
            """,
            [iddevis],
        )
        affilies = _lignes(
            cursor,
            """
            SELECT a.idaffilie, a.idadherent, a.lien, l.libellelien, a.nom, a.prenom, a.cni,
                   a.fichierpiece, a.datenaissance, a.dateadhesion, a.datedebutconsommation,
                   COALESCE(a.certificat, false) AS certificat, a.matricule, a.observations,
                   COALESCE(a.handicape, false) AS handicape, a.sexe,
                   COALESCE(a.surprimeappliquee, false) AS surprimeappliquee, a.montantsurprime,
                   a.groupesanguin, COALESCE(a.nombrepathologie, 0) AS nombrepathologie, a.numerocmu,
                   a.mobile1, a.mobile2, a.primeannuelle
            FROM stdaffilie a
            LEFT JOIN stdlienjuridique l ON l.codelien = a.lien
            WHERE a.iddevis = %s
            ORDER BY a.idadherent, CASE a.lien WHEN 'A' THEN 0 WHEN 'C' THEN 1 ELSE 2 END, a.idaffilie
            """,
            [iddevis],
        )
        garanties = _lignes(
            cursor,
            """
            SELECT g.idgarantie, s.libellesousgarantie AS libelle, g.primeannuelle, g.primenette, g.taxe
            FROM stddevisdetgarantie g
            JOIN stddevisdetail d ON d.iddevisdetail = g.iddevisdet
            LEFT JOIN stdsousgarantie s ON s.idsousgarantie = g.idgarantie
            WHERE d.iddevis = %s AND g.idgarantie <> 0
            ORDER BY g.idgarantie
            """,
            [iddevis],
        )
    for personne in adherents + affilies:
        personne["fichierpiece"] = _url_fichier(personne.get("fichierpiece"))
    for cle in ("primenette", "taxe", "accessoire", "primettc"):
        devis[cle] = float(devis[cle] or 0)
    return Response(
        {
            "devis": devis,
            "detail": detail[0] if detail else None,
            "filiales": filiales,
            "adherents": adherents,
            "affilies": affilies,
            "garanties": garanties,
        }
    )
