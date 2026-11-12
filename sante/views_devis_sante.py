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

import json
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

from autorisations.rbac import a_le_droit
from configuration_api.models import SanteFormuleMinene
from .oreole import est_oreole
from configuration_api.parametrage import valeur_parametre
from core.date_parser import date_emission_du_jour
from institutionnel.authentication import KnoxOrDemoTokenAuthentication
from production.database import enregistrer_terme_devis
from production.models import Devis
from production.periode_contrat import periode_contrat

from . import import_classique
from .avenant import DROIT_DEROGATION_AGE, detail_avenant_modification
from .models import Adherent, Affilie, FilialeSante
from .serializers import EnregistrementDevisSanteSerializer
from .utils import (
    enregistrer_adherent_sante,
    enregistrer_affilie_sante,
    enregistrer_filiale_sante,
    apercu_devis_sante,
    bordereau_primes_sante,
    assures_hors_limites_age,
    OFFRES_MINENE,
    get_quotation_id,
    import_insured,
    load_people_data_from_excel,
    save_quotation_sante,
)

ID_PRODUIT_SANTE = 5
# Colonnes du fichier d'import (modèle d'URANUS), en minuscules comme les lit load_people_data_from_excel
COLONNES_IMPORT = (
    "nom", "prenoms", "numerocni", "datenaissance", "numerocmu", "sexe", "numerotelephone", "lienparente", "dateeffet",
    "dateentree", "adresseadherent", "emailadherent", "nombreaffection", "matricule", "groupesanguin",
)
ID_INTERMEDIAIRE = 1
ID_AVENANT_AFFAIRE_NOUVELLE = 1
# Gestionnaire des contrats Santé : réglage « sante.gestionnaire » (Administration > Le cabinet & règles de gestion),
# VITALIS SANTE à défaut ; imposé en MINENE, saisi à l'écran pour les autres offres (demande du 2026-10-27)
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
    err, lignes = enregistrer_adherent_sante(
        request.user.id, donnees, fichier, derogation_age=a_le_droit(request.user, DROIT_DEROGATION_AGE),
        date_reference=data.get("dateeffetdevis"),
    )
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
    err, lignes = enregistrer_affilie_sante(
        request.user.id, donnees, fichier, derogation_age=a_le_droit(request.user, DROIT_DEROGATION_AGE),
        date_reference=data.get("dateeffetdevis"),
    )
    return _reponse_procedure(err, (lignes or [None])[0], "idaffilie")


def _lignes_personnes(personnes):
    """Lignes d'import (colonnes du fichier Excel d'URANUS) depuis la liste JSON des personnes d'un bulletin
    d'adhésion : [{lien A|C|E, nom, prenoms, date_naissance AAAA-MM-JJ, sexe M|F, adresse, telephone, email,
    date_entree, matricule}]. Chaque adhérent (A) précède sa famille."""
    try:
        liste = json.loads(personnes) if isinstance(personnes, str) else personnes
    except ValueError:
        raise ValueError("Liste des personnes illisible.")
    if not isinstance(liste, list) or not liste:
        raise ValueError("Aucune personne à importer.")
    if len(liste) > 500:
        raise ValueError("500 personnes au plus par import.")
    lignes = []
    for rang, p in enumerate(liste, start=1):
        if not isinstance(p, dict):
            raise ValueError(f"Personne n° {rang} illisible.")
        lien = _texte(p.get("lien")).upper()
        if lien not in ("A", "C", "E"):
            raise ValueError(f"Personne n° {rang} : lien « {lien} » inconnu (A, C ou E).")
        if rang == 1 and lien != "A":
            raise ValueError("La première personne doit être l'adhérent (lien A).")
        sexe = _texte(p.get("sexe")).upper()[:1]
        if sexe not in ("M", "F"):
            raise ValueError(f"{_texte(p.get('nom'))} {_texte(p.get('prenoms'))} : précisez le sexe (M ou F).")
        if not _texte(p.get("nom")) or not _texte(p.get("date_naissance")):
            raise ValueError(f"Personne n° {rang} : nom et date de naissance obligatoires.")
        valeur = lambda cle: _texte(p.get(cle)) or "NA"  # noqa: E731
        lignes.append({
            "nom": _texte(p.get("nom")), "prenoms": valeur("prenoms"), "numerocni": "NA",
            "datenaissance": _texte(p.get("date_naissance")), "numerocmu": "NA", "sexe": sexe,
            "numerotelephone": valeur("telephone"), "lienparente": lien, "dateeffet": "NA", "dateentree": valeur("date_entree"),
            "adresseadherent": valeur("adresse"), "emailadherent": valeur("email"), "nombreaffection": "0",
            "matricule": valeur("matricule"), "groupesanguin": "", "_ligne": rang,
        })
    return lignes


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def importer_affilies(request):
    """
    POST /api/devissante/importation/  (multipart : devis, filiale, date_effet, fichier_excel ; ou personnes : liste
    JSON des personnes lues dans les bulletins d'adhésion reçus, vérifiées à l'écran)

    Adhérents et affiliés d'un fichier Excel (modèle d'URANUS), ligne par ligne, par les procédures de saisie. Les
    âges s'apprécient à la date d'effet du devis saisie à l'écran (date_effet). Un assuré au-delà des limites d'âge des conditions est admis par dérogation si l'utilisateur est habilité
    (droit devis.derogation_age), refusé sinon. Les lignes acceptées restent enregistrées même si d'autres sont
    refusées. MINENE (classer, par défaut) : chaque famille du fichier va dans la formule de sa taille (Réglages Santé
    MINENE : SOLO 1 personne, FAMILLE 2 à 3, FAMILLE PLUS 4 à 6) de la même offre commerciale, couverture créée au
    besoin avec le collège et la zone de celle choisie. Réponse : {Importes, Derogations, Refuses, Ignores, Derogation,
    Classement: [{Formule, Familles}], Lignes: [{Ligne, Nom, Lien, Statut, Message}]}.
    """
    devis = _entier(request.data.get("devis"))
    filiale = _entier(request.data.get("filiale"))
    fichier = request.FILES.get("fichier_excel")
    personnes = request.data.get("personnes")
    if not (devis and filiale):
        return Response({"error": "Choisissez la couverture (filiale) des personnes importées."}, status=status.HTTP_400_BAD_REQUEST)
    if personnes:
        # Personnes lues dans les bulletins d'adhésion reçus (questionnaires prospects), vérifiées à l'écran
        try:
            lignes = _lignes_personnes(personnes)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    elif not fichier:
        return Response({"error": "Choisissez le fichier Excel."}, status=status.HTTP_400_BAD_REQUEST)
    else:
        try:
            lignes = load_people_data_from_excel(fichier, index=0)
        except KeyError as manque:
            return Response({"error": f"Colonne {manque} absente de la 1re ligne du fichier."}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # fichier illisible
            return Response({"error": f"Fichier Excel illisible : {str(exc).splitlines()[0]}"}, status=status.HTTP_400_BAD_REQUEST)
    if not lignes:
        return Response({"error": "Le fichier ne contient aucune personne (lignes 2 et suivantes)."}, status=status.HTTP_400_BAD_REQUEST)
    manquantes = [c for c in COLONNES_IMPORT if c not in lignes[0]]
    if manquantes:
        return Response(
            {"error": "Colonnes absentes de la 1re ligne du fichier : " + ", ".join(manquantes) + "."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    derogation = a_le_droit(request.user, DROIT_DEROGATION_AGE)
    details = []
    classer = _texte(request.data.get("classer")).lower() not in ("0", "false", "non")
    try:
        groupes, classement = _familles_par_formule(request.user.id, devis, filiale, lignes) if classer else ([(filiale, lignes)], [])
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    erreurs, messages = 0, []
    for filiale_famille, lignes_famille in groupes:
        e, m = import_insured(
            None, request.user.id, devis, request.data.get("date_effet"), filiale_famille,
            derogation_age=derogation, details=details, lignes=lignes_famille,
        )
        erreurs += e
        messages += m
    if erreurs and not details:
        texte = next((m.get("message") for m in messages if isinstance(m, dict) and m.get("message")), "")
        return Response({"error": f"Import interrompu : {texte or 'erreur inattendue'}."}, status=status.HTTP_400_BAD_REQUEST)
    compte = lambda statut: sum(1 for d in details if d["Statut"] == statut)  # noqa: E731
    return Response({
        "Importes": compte("importé") + compte("dérogation"),
        "Derogations": compte("dérogation"),
        "Refuses": compte("refusé"),
        "Ignores": compte("ignoré"),
        "Derogation": derogation,
        "Classement": classement,
        "Lignes": details,
    })


def _jj_mm_aaaa(iso):
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%d-%m-%Y")


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def importer_classique(request):
    """
    POST /api/devissante/importation/classique/  (multipart : devis, fichier_excel, date_effet, date_expiration,
    college : collège des couvertures dont le fichier ne cite pas le collège, analyser=1 : contrôle sans écriture)

    Import Santé classique au modèle d'OREOLE (sante/import_classique.py) : couvertures déduites de la colonne COLLEGE
    (formule de l'offre, collège), créées au besoin ; familles importées par les procédures de saisie ; réponse avec
    les valeurs à reporter à l'écran : DateEffet, DateExpiration, PrimeGlobale, MontantSurprime, TypeContrat.
    L'import MINENE (modèle d'URANUS, barème) reste importer_affilies.
    """
    fichier = request.FILES.get("fichier_excel")
    if not fichier:
        return Response({"error": "Choisissez le fichier Excel."}, status=status.HTTP_400_BAD_REQUEST)
    college_defaut = _entier(request.data.get("college")) or import_classique.ID_COLLEGE_PAR_DEFAUT
    try:
        with connection.cursor() as cursor:
            analyse = import_classique.analyser(cursor, fichier, college_defaut)
    except import_classique.ErreurImport as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:  # fichier illisible
        return Response({"error": f"Fichier Excel illisible : {str(exc).splitlines()[0]}"}, status=status.HTTP_400_BAD_REQUEST)
    familles = analyse.pop("_familles")
    reponse = {**analyse, "Importes": 0, "Derogations": 0, "Refuses": 0, "Ignores": 0, "Lignes": []}
    if _texte(request.data.get("analyser")).lower() in ("1", "true", "oui"):
        return Response(reponse)

    devis = _entier(request.data.get("devis"))
    if not devis:
        return Response({"error": "Devis Santé non initialisé."}, status=status.HTTP_400_BAD_REQUEST)
    if not familles:
        return Response({**reponse, "error": "Aucune famille importable : corrigez les lignes signalées."}, status=status.HTTP_400_BAD_REQUEST)
    effet = analyse["DateEffet"] or _texte(request.data.get("date_effet"))[:10]
    expiration = analyse["DateExpiration"] or _texte(request.data.get("date_expiration"))[:10]
    if not effet or not expiration:
        return Response({"error": "Date d'effet introuvable : renseignez DATE D'ENTREE ou la date d'effet du devis."},
                        status=status.HTTP_400_BAD_REQUEST)
    # Couvertures du fichier : celle du devis de même formule, collège et zone, sinon créée aux dates du fichier
    couvertures = {}
    for famille in familles:
        id_offre, libelle, id_zone, id_college = famille["couverture"]
        cle = (id_offre, id_zone, id_college)
        if cle in couvertures:
            continue
        existante = FilialeSante.objects.filter(devis=devis, offresante_id=id_offre, college_id=id_college,
                                                zonecouverture_id=id_zone).first()
        if existante:
            couvertures[cle] = existante.idfiliale
            continue
        err, resultat = enregistrer_filiale_sante(request.user.id, {
            "idfiliale": 0, "devis": devis, "college": id_college, "offresante": id_offre, "zonecouverture": id_zone,
            "date_effet": _jj_mm_aaaa(effet), "date_expiration": _jj_mm_aaaa(expiration), "source": "S",
        })
        ligne_resultat = (resultat or [None])[0]
        if err or not ligne_resultat or not ligne_resultat.idfiliale:
            return Response({"error": f"Couverture « {libelle} » non créée : "
                                      f"{getattr(ligne_resultat, 'outputmessage', '') or 'refus de la base'}."},
                            status=status.HTTP_400_BAD_REQUEST)
        couvertures[cle] = ligne_resultat.idfiliale
    derogation = a_le_droit(request.user, DROIT_DEROGATION_AGE)
    details, erreurs, messages = [], 0, []
    for famille in familles:
        id_offre, _, id_zone, id_college = famille["couverture"]
        e, m = import_insured(None, request.user.id, devis, effet, couvertures[(id_offre, id_zone, id_college)],
                              derogation_age=derogation, details=details, lignes=famille["lignes"])
        erreurs += e
        messages += m
    if erreurs and not details:
        texte = next((m.get("message") for m in messages if isinstance(m, dict) and m.get("message")), "")
        return Response({"error": f"Import interrompu : {texte or 'erreur inattendue'}."}, status=status.HTTP_400_BAD_REQUEST)
    compte = lambda statut: sum(1 for d in details if d["Statut"] == statut)  # noqa: E731
    return Response({
        **reponse, "DateEffet": effet, "DateExpiration": expiration, "Derogation": derogation,
        "Importes": compte("importé") + compte("dérogation"), "Derogations": compte("dérogation"),
        "Refuses": compte("refusé"), "Ignores": compte("ignoré"), "Lignes": details,
    })


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def modele_import_classique(request):
    """GET /api/devissante/importation/classique/modele/ : modèle d'OREOLE du fichier d'import Santé classique."""
    import io

    from django.http import HttpResponse

    tampon = io.BytesIO()
    import_classique.modele().save(tampon)
    reponse = HttpResponse(tampon.getvalue(),
                           content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    reponse["Content-Disposition"] = 'attachment; filename="FICHIER IMPORT SANTE CLASSIQUE.xlsx"'
    return reponse


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def bordereau_primes(request, iddevis):
    """GET /api/devissante/<iddevis>/bordereau/ : bordereau récapitulatif des primes par assuré (sante.utils)."""
    donnees = bordereau_primes_sante(iddevis)
    if donnees is None:
        return Response({"error": "Devis Santé introuvable."}, status=status.HTTP_404_NOT_FOUND)
    return Response(donnees)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def bordereau_primes_contrat(request, idcontrat):
    """GET /api/devissante/contrat/<idcontrat>/bordereau/?document= : bordereau des primes (MINENE : état des
    cotisations) d'un contrat. Contrat de base d'une période : familles en vigueur, incorporations comprises, primes et
    encaissements de la période (production.periode_contrat, demande du 2026-11-02). Avenant : son propre bordereau
    (montants de l'avenant), sauf la facture MINENE (document=facture), qui couvre toute la période de la police."""
    with connection.cursor() as cursor:
        periode = periode_contrat(cursor, idcontrat)
        cursor.execute("SELECT iddevis FROM stdcontrat WHERE idcontrat = %s", [idcontrat])
        devis_contrat = (cursor.fetchone() or [None])[0]
    if periode is None or not devis_contrat:
        return Response({"error": "Contrat Santé introuvable."}, status=status.HTTP_404_NOT_FOUND)
    if periode["EstBase"] or request.query_params.get("document") == "facture":
        donnees = bordereau_primes_sante(periode["IdDevisComposition"] or periode["IdDevisBase"], periode=periode)
    else:
        donnees = bordereau_primes_sante(devis_contrat)
    if donnees is None:
        return Response({"error": "Contrat Santé introuvable."}, status=status.HTTP_404_NOT_FOUND)
    return Response(donnees)


def _familles_par_formule(user_id, devis, filiale, lignes):
    """MINENE : familles du fichier (un adhérent « A » et les lignes qui le suivent) rangées dans la formule de leur
    taille, de la même offre commerciale que la couverture choisie ; couverture créée avec le collège, la zone et les
    dates de celle-ci quand le devis n'en a pas pour cette formule. Hors MINENE : tout dans la couverture choisie.
    Renvoie ([(filiale, lignes)], [{Formule, Familles}])."""
    choisie = FilialeSante.objects.filter(pk=filiale, devis=devis).first()
    if not choisie or choisie.offresante_id not in OFFRES_MINENE:
        return [(filiale, lignes)], []
    with connection.cursor() as cursor:
        cursor.execute(
            """SELECT o.idoffre, o.libelleoffre FROM stdoffre o
               WHERE o.actif AND o.idtarif = (SELECT idtarif FROM stdoffre WHERE idoffre = %s) AND o.idoffre = ANY(%s)""",
            [choisie.offresante_id, list(OFFRES_MINENE)],
        )
        libelles = dict(cursor.fetchall())
    formules = [(f.IdOffre, f.PersonnesMin, f.PersonnesMax) for f in SanteFormuleMinene.objects.filter(IdOffre__in=list(libelles))]
    familles = []
    for ligne in lignes:
        if str(ligne.get("lienparente", "")).strip().upper() == "A" or not familles:
            familles.append([])
        familles[-1].append(ligne)
    couvertures = {choisie.offresante_id: filiale}
    groupes, compte = [], {}
    for famille in familles:
        taille = len(famille)
        offre = next((o for o, mini, maxi in sorted(formules, key=lambda f: f[1]) if mini <= taille <= maxi), choisie.offresante_id)
        if offre not in couvertures:
            existante = FilialeSante.objects.filter(devis=devis, offresante_id=offre, college_id=choisie.college_id,
                                                    zonecouverture_id=choisie.zonecouverture_id).first()
            if existante:
                couvertures[offre] = existante.idfiliale
            else:
                err, resultat = enregistrer_filiale_sante(user_id, {
                    "idfiliale": 0, "devis": devis, "college": choisie.college_id, "offresante": offre,
                    "zonecouverture": choisie.zonecouverture_id, "date_effet": choisie.dateeffet.strftime("%d-%m-%Y"),
                    "date_expiration": choisie.dateexpiration.strftime("%d-%m-%Y"), "source": "S",
                })
                ligne_resultat = (resultat or [None])[0]
                if err or not ligne_resultat or not ligne_resultat.idfiliale:
                    raise ValueError(f"Couverture « {libelles.get(offre, offre)} » non créée : "
                                     f"{getattr(ligne_resultat, 'outputmessage', '') or 'refus de la base'}.")
                couvertures[offre] = ligne_resultat.idfiliale
        groupes.append((couvertures[offre], famille))
        compte[offre] = compte.get(offre, 0) + 1
    return groupes, [{"Formule": libelles.get(o, str(o)), "Familles": n} for o, n in compte.items()]


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
    data, erreur = _donnees_devis(request)
    if erreur:
        return erreur
    with connection.cursor() as curseur_oreole:
        if est_oreole(curseur_oreole, _entier(data.get("IdDevis"))):
            return Response({"error": "Ce devis Oreole Santé se modifie depuis l'écran Oreole Santé."}, status=status.HTTP_400_BAD_REQUEST)
    # Limites d'âge des conditions vérifiées à la date d'effet définitive (elle a pu changer depuis la saisie des
    # assurés) : au-delà, seul un utilisateur habilité enregistre le devis
    try:
        date_effet = datetime.strptime(data["DateEffet"], "%d-%m-%Y").date()
    except ValueError:
        return Response({"error": "Date d'effet illisible."}, status=status.HTTP_400_BAD_REQUEST)
    hors_limites = assures_hors_limites_age(_entier(data["IdDevis"]), date_effet)
    texte_hors_limites = " ; ".join(f"{nom} ({age} ans, {limite} au plus)" for nom, age, limite in hors_limites)
    if hors_limites and not a_le_droit(request.user, DROIT_DEROGATION_AGE):
        return Response(
            {"error": f"Limite d'âge dépassée au {date_effet:%d/%m/%Y} : {texte_hors_limites}. Seul un utilisateur "
                      "habilité (« Déroger à la limite d'âge ») peut enregistrer ce devis."},
            status=status.HTTP_400_BAD_REQUEST,
        )
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
            "message": ligne.OutputMessage
            + (f" Dérogation à la limite d'âge : {texte_hors_limites}." if hors_limites else ""),
            "totaux": {
                "prime_nette": float(devis.primenette or 0),
                "taxe": float(devis.taxe or 0),
                "accessoire": float(devis.accessoire or 0),
                "prime_ttc": float(devis.primettc or 0),
            },
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def apercu_devis_sante_vue(request):
    """
    POST /api/devissante/apercu/ (mêmes données que l'enregistrement)

    Primes du devis en saisie calculées par la base sans rien enregistrer : totaux, garanties et, en MINENE, détail
    par famille (formule, prime de base du barème, surprimes d'âge et d'affection, accessoire). L'écran l'appelle
    dès que la saisie change (import d'un fichier, adhérent ajouté, dates, primes…).
    """
    data, erreur = _donnees_devis(request, client_obligatoire=False)
    if erreur:
        return erreur
    # Seul l'opérateur qui a ouvert la saisie du devis en voit le calcul (la base ne tarife que ses assurés)
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM stdnumerosaisiesante WHERE iddevis = %s AND idoperateur = %s", [_entier(data["IdDevis"]), request.user.id])
        if not cursor.fetchone():
            return Response({"error": "Saisie ouverte par un autre opérateur : calcul indisponible."}, status=status.HTTP_403_FORBIDDEN)
    message, apercu = apercu_devis_sante(request.user.id, data)
    if apercu is None:
        return Response({"error": message or "Calcul impossible."}, status=status.HTTP_400_BAD_REQUEST)
    return Response(apercu)


def _donnees_devis(request, client_obligatoire=True):
    """Données de sp_creation_devis_sante depuis celles de l'écran : (données, None) ou (None, réponse d'erreur)."""
    data = dict(request.data)
    # Devis d'avenant (renouvellement…) : il garde son avenant, sinon sa confirmation ouvrirait une nouvelle police.
    # Un devis initialisé par sp_initialisation_devis_sante porte l'affaire nouvelle.
    avenant_devis = Devis.objects.filter(pk=_entier(data.get("IdDevis"))).values_list("avenant_id", flat=True).first() or 0
    data.update(
        {
            "IdIntermediaire": ID_INTERMEDIAIRE,
            "IdProduit": ID_PRODUIT_SANTE,
            "IdAvenant": avenant_devis if avenant_devis > ID_AVENANT_AFFAIRE_NOUVELLE
            else (_entier(data.get("IdAvenant")) or ID_AVENANT_AFFAIRE_NOUVELLE),
            "IdAssure": _entier(data.get("IdAssure")) or _entier(data.get("IdClient")),
            "Flotte": False,
            "Coassurance": False,
            "DateEmission": date_emission_du_jour().strftime("%d-%m-%Y"),
            "DateEffet": _date_jj_mm_aaaa(data.get("DateEffet")),
            "DateExpiration": _date_jj_mm_aaaa(data.get("DateExpiration")),
            "GestionnaireSante": _texte(data.get("GestionnaireSante"))[:60] or valeur_parametre("sante.gestionnaire", GESTIONNAIRE_SANTE),
        }
    )
    if not _entier(data.get("IdDevis")):
        return None, Response({"error": "Aucune saisie en cours : enregistrez d'abord une couverture."}, status=status.HTTP_400_BAD_REQUEST)
    # Formule du devis = celle d'une de ses couvertures : l'écran envoie la formule restée choisie dans
    # la liste, qui peut ne pas avoir été enregistrée (devis 25011 : famille FAMILLE enregistrée en SOLO).
    # La base tarife chaque famille MINENE selon la formule de sa propre couverture.
    formules = sorted(
        {f for f in FilialeSante.objects.filter(devis=_entier(data["IdDevis"])).values_list("offresante_id", flat=True) if f}
    )
    if formules and _entier(data.get("IdOffre")) not in formules:
        data["IdOffre"] = formules[0]
    # MINENE : gestionnaire du réglage, quoi que l'écran envoie
    if _entier(data.get("IdOffre")) in OFFRES_MINENE:
        data["GestionnaireSante"] = valeur_parametre("sante.gestionnaire", GESTIONNAIRE_SANTE)
    if not _entier(data.get("IdClient")):
        if client_obligatoire:
            return None, Response({"error": "Choisissez le client."}, status=status.HTTP_400_BAD_REQUEST)
        # Aperçu avant le choix du client : la base calcule sans lui (rien n'est enregistré)
        data["IdClient"] = data["IdAssure"] = 0
    if "NA" in (data["DateEffet"], data["DateExpiration"]):
        return None, Response({"error": "Dates d'effet et d'expiration obligatoires."}, status=status.HTTP_400_BAD_REQUEST)

    serializer = EnregistrementDevisSanteSerializer(data=data)
    if not serializer.is_valid():
        return None, Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
    return data, None


def _lignes(cursor, sql, params):
    cursor.execute(sql, params)
    colonnes = [c[0] for c in cursor.description]
    return [{k: _jour(v) if isinstance(v, (date, datetime)) else v for k, v in zip(colonnes, ligne)} for ligne in cursor.fetchall()]


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def continuer_saisie(request, iddevis):
    """
    POST /api/devissante/<iddevis>/continuer/

    Un collègue continue une saisie Santé commencée par un autre (demande du 2026-11-05) : la base n'accepte les
    modifications que de l'opérateur de la saisie, donc la saisie, les couvertures, les adhérents et les affiliés du devis
    passent au compte connecté. Devis ni confirmé ni archivé ; droit devis.update, opération tracée au journal (garde).
    """
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(
            "SELECT idproduit, COALESCE(confirme, FALSE), COALESCE(archive, FALSE) FROM stddevis WHERE iddevis = %s FOR UPDATE",
            [iddevis],
        )
        ligne = cursor.fetchone()
        if not ligne:
            return Response({"error": f"Devis {iddevis} introuvable."}, status=status.HTTP_404_NOT_FOUND)
        produit, confirme, archive = ligne
        refus = None
        if produit != ID_PRODUIT_SANTE:
            refus = "Ce devis n'est pas un devis Santé."
        elif confirme:
            refus = "Ce devis est déjà confirmé : sa saisie ne peut plus être continuée."
        elif archive:
            refus = "Ce devis est archivé : désarchivez-le pour continuer sa saisie."
        elif est_oreole(cursor, iddevis):
            refus = "Devis Oreole Santé : il se continue depuis la branche Oreole Santé."
        if refus:
            return Response({"error": refus}, status=status.HTTP_400_BAD_REQUEST)
        utilisateur = request.user.id
        for table in ("stdfiliale", "stdadherent", "stdaffilie"):
            cursor.execute(f"UPDATE {table} SET idoperateur = %s WHERE iddevis = %s AND idoperateur IS DISTINCT FROM %s", [utilisateur, iddevis, utilisateur])
        cursor.execute("SELECT 1 FROM stdnumerosaisiesante WHERE iddevis = %s FOR UPDATE", [iddevis])
        if cursor.fetchone():
            cursor.execute("UPDATE stdnumerosaisiesante SET idoperateur = %s, saisieencours = TRUE, datemaj = CURRENT_TIMESTAMP WHERE iddevis = %s", [utilisateur, iddevis])
        else:
            cursor.execute(
                """INSERT INTO stdnumerosaisiesante (datecreation, datemaj, saisieencours, iddevis, idoperateur)
                   VALUES (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, TRUE, %s, %s)""", [iddevis, utilisateur])
    return Response({"IdDevis": iddevis, "Message": "Saisie reprise : vous pouvez continuer ce devis."})


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
                   n.idoperateur AS operateur_saisie, COALESCE(n.saisieencours, false) AS saisie_en_cours,
                   (SELECT u.name FROM account_uranususer u WHERE u.id = n.idoperateur) AS operateur_saisie_nom,
                   av.codeavenant AS code_avenant,
                   -- Renouvellement : taux d'ajustement de l'an dernier, déjà appliqué à la prime de base MINENE
                   (SELECT cp.tauxreductioncommerciale FROM stddevisdetail dp
                    JOIN stdcomplementdevisdetailsante cp ON cp.iddevisdetail = dp.iddevisdetail
                    WHERE dp.iddevis = d.idoldhist ORDER BY dp.iddevisdetail LIMIT 1) AS taux_reduction_precedent
            FROM stddevis d
            LEFT JOIN stdavenant av ON av.idavenant = d.idavenant
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
        # Saisie d'un collègue ou sans saisie ouverte : continuable tant que le devis n'est ni confirmé ni archivé (continuer_saisie)
        devis["peut_continuer"] = not devis["operateur_courant"] and not devis["confirme"] and not devis["archive"]

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
        # Avenant de modification (changement de formule, incorporation) : police, période, jours restants
        avenant = detail_avenant_modification(cursor, iddevis)
    for personne in adherents + affilies:
        personne["fichierpiece"] = _url_fichier(personne.get("fichierpiece"))
    for cle in ("primenette", "taxe", "accessoire", "primettc"):
        devis[cle] = float(devis[cle] or 0)
    if devis["taux_reduction_precedent"] is not None:
        devis["taux_reduction_precedent"] = float(devis["taux_reduction_precedent"])
    return Response(
        {
            "devis": devis,
            "detail": detail[0] if detail else None,
            "filiales": filiales,
            "adherents": adherents,
            "affilies": affilies,
            "garanties": garanties,
            "avenant": avenant,
        }
    )
