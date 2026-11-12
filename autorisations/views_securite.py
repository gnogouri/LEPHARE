"""
API de la sécurité de LE PHARE : utilisateur connecté, utilisateurs, rôles, droits, journal d'audit.

Les droits exigés par chaque route sont déclarés dans la garde centrale (garde.REGLES) et chaque
modification y est journalisée avec ses valeurs avant / après ; les vues ci-dessous ne font que
le métier (contrôles de cohérence, garde-fous contre le blocage de l'administration).
"""

import csv
import re
from datetime import datetime, time

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as ErreurDjango
from django.db import transaction
from django.db.models import Count, Q
from django.http import HttpResponse
from django.utils import timezone
from knox.models import AuthToken
from rest_framework import status
from rest_framework.authentication import BasicAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from account.models import UranusUser
from core.exports import ligne_csv
from institutionnel.authentication import KnoxOrDemoTokenAuthentication
from institutionnel.models import AuditLogCima

from .catalogue import MODULES
from .journal import completer_audit, journaliser
from .models import Droit, Role, SecuriteUtilisateur, UtilisateurRole
from .rbac import compte_expire, droits_utilisateur

AUTHENTIFICATION = [KnoxOrDemoTokenAuthentication, BasicAuthentication]
MOTIF_CODE_ROLE = re.compile(r"^[A-Z0-9_]{2,40}$")
PAGE = 50


class Refus(Exception):
    """Saisie refusée : message affiché tel quel."""


def _erreur(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": str(message)}, status=code)


def _auteur(request):
    return getattr(request.user, "email", "") or str(request.user)


def _iso(valeur):
    return valeur.isoformat() if valeur else None


def _securite(utilisateur):
    securite, _ = SecuriteUtilisateur.objects.get_or_create(utilisateur=utilisateur)
    return securite


def _verifier_mot_de_passe(mot_de_passe, utilisateur=None):
    try:
        validate_password(mot_de_passe or "", utilisateur)
    except ErreurDjango as erreur:
        raise Refus(" ".join(erreur.messages))
    if len(mot_de_passe or "") < 8:
        raise Refus("Le mot de passe doit contenir au moins 8 caractères.")


# ------------------------------------------------------------------ représentations
def _role_json(role, complet=False):
    donnees = {
        "id": role.id, "code": role.code, "libelle": role.libelle, "description": role.description,
        "actif": role.actif, "ordre": role.ordre, "droits": sorted(role.droits.values_list("code", flat=True)),
        "nb_utilisateurs": getattr(role, "nb_utilisateurs", None) if hasattr(role, "nb_utilisateurs")
        else role.attributions.count(),
        "date_modification": _iso(role.date_modification), "modifie_par": role.modifie_par,
    }
    if complet:
        donnees["utilisateurs"] = [
            {"id": a.utilisateur_id, "email": a.utilisateur.email, "nom": a.utilisateur.name or "",
             "actif": a.utilisateur.is_active}
            for a in role.attributions.select_related("utilisateur").order_by("utilisateur__name")
        ]
    return donnees


def _utilisateur_json(u, securite=None):
    securite = securite if securite is not None else SecuriteUtilisateur.objects.filter(utilisateur=u).first()
    maintenant = timezone.now()
    return {
        "id": u.id, "email": u.email, "nom": u.name or "", "actif": u.is_active, "administrateur": u.is_admin,
        "expire": compte_expire(u), "date_expiration": _iso(u.expiry_date), "derniere_connexion": _iso(u.last_login),
        "roles": [{"id": a.role_id, "code": a.role.code, "libelle": a.role.libelle, "actif": a.role.actif}
                  for a in u.roles_lephare.select_related("role").order_by("role__ordre")],
        "doit_changer_mot_de_passe": bool(securite and securite.doit_changer_mot_de_passe),
        "verrouille_jusqua": _iso(securite.verrouille_jusqua) if securite and securite.verrouille_jusqua
        and securite.verrouille_jusqua > maintenant else None,
    }


def _droits_effectifs(utilisateur):
    """Catalogue complet avec, pour chaque droit, accordé ou non et par quels rôles."""
    codes = droits_utilisateur(utilisateur)
    par_role = {}
    for role in Role.objects.filter(attributions__utilisateur=utilisateur, actif=True).prefetch_related("droits"):
        for code in role.droits.values_list("code", flat=True):
            par_role.setdefault(code, []).append(role.libelle)
    modules = []
    for droit in Droit.objects.all():
        if not modules or modules[-1]["module"] != droit.module:
            modules.append({"module": droit.module, "libelle": droit.module_libelle, "droits": []})
        modules[-1]["droits"].append({
            "code": droit.code, "libelle": droit.libelle, "accorde": droit.code in codes, "sensible": droit.sensible,
            "par": ["Administrateur (accès complet)"] if utilisateur.is_admin and droit.code in codes
            else par_role.get(droit.code, []),
        })
    return modules


# ------------------------------------------------------------------ utilisateur connecté
@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def moi(request):
    """GET /api/securite/moi/ : identité, rôles et droits effectifs de l'utilisateur connecté."""
    u = request.user
    securite = _securite(u)
    return Response({
        **_utilisateur_json(u, securite),
        "droits": sorted(droits_utilisateur(u)),
        "modules": [{"code": c, "libelle": l} for c, l in MODULES],
    })


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def changer_mon_mot_de_passe(request):
    """POST /api/securite/moi/mot-de-passe/ {ancien, nouveau}"""
    u = request.user
    if not u.check_password(request.data.get("ancien") or ""):
        return _erreur("Mot de passe actuel incorrect.")
    nouveau = request.data.get("nouveau") or ""
    if nouveau == request.data.get("ancien"):
        return _erreur("Le nouveau mot de passe doit être différent de l'ancien.")
    try:
        _verifier_mot_de_passe(nouveau, u)
    except Refus as erreur:
        return _erreur(erreur)
    u.set_password(nouveau)
    u.save(update_fields=["password"])
    securite = _securite(u)
    securite.doit_changer_mot_de_passe = False
    securite.date_changement_mot_de_passe = timezone.now()
    securite.save()
    # Les autres sessions ouvertes sont fermées
    jeton_courant = getattr(request, "auth", None)
    AuthToken.objects.filter(user=u).exclude(pk=getattr(jeton_courant, "pk", None)).delete()
    completer_audit(request, description="Changement de son mot de passe", objet_type="utilisateur", objet_id=u.pk,
                    apres={"email": u.email})
    return Response({"message": "Mot de passe modifié."})


# ------------------------------------------------------------------ utilisateurs
def _ids_roles(ids_roles):
    try:
        return {int(i) for i in ids_roles or []}
    except (TypeError, ValueError):
        raise Refus("Rôle inconnu.")


def _controler_attribution(request, ids_roles):
    """Sans le droit de gérer les rôles, on ne peut attribuer que des rôles dont tous les droits sont déjà
    les siens : un gestionnaire des comptes ne peut pas se donner (ni donner) plus de droits qu'il n'en a."""
    if request.user.is_admin or "roles.manage" in droits_utilisateur(request.user):
        return
    demandes = set(Droit.objects.filter(roles__id__in=_ids_roles(ids_roles)).values_list("code", flat=True))
    en_trop = demandes - droits_utilisateur(request.user)
    if en_trop:
        raise Refus("Ces rôles accordent des droits que vous n'avez pas vous-même "
                    f"({', '.join(sorted(en_trop)[:6])}{'…' if len(en_trop) > 6 else ''}) : "
                    "seul un gestionnaire des rôles peut les attribuer.")


def _controler_cible(request, cible):
    """Sans le droit de gérer les rôles, on ne touche (mot de passe, activation, identité, rôles) qu'aux comptes
    qui n'ont pas plus de droits que soi : impossible de prendre la main sur un compte administrateur."""
    if request.user.is_admin or "roles.manage" in droits_utilisateur(request.user) or cible.pk == request.user.pk:
        return
    # Droits que le compte retrouverait une fois réactivé : tous ses rôles, actifs ou non, quel que soit
    # l'état du compte (un compte désactivé ou expiré n'a aucun droit effectif, mais peut être relancé)
    potentiels = set(Droit.objects.filter(roles__attributions__utilisateur=cible).values_list("code", flat=True))
    if cible.is_admin or potentiels - droits_utilisateur(request.user):
        raise Refus("Ce compte a des droits que vous n'avez pas : seul un gestionnaire des rôles peut le modifier.")


def _appliquer_roles(utilisateur, ids_roles, auteur):
    ids = _ids_roles(ids_roles)
    existants = set(Role.objects.filter(id__in=ids).values_list("id", flat=True))
    if ids - existants:
        raise Refus("Rôle inconnu.")
    UtilisateurRole.objects.filter(utilisateur=utilisateur).exclude(role_id__in=ids).delete()
    for id_role in ids:
        UtilisateurRole.objects.get_or_create(utilisateur=utilisateur, role_id=id_role, defaults={"attribue_par": auteur})


@api_view(["GET", "POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def utilisateurs(request):
    """GET /api/securite/utilisateurs/?q=&role=&etat= ; POST {email, nom, roles, mot_de_passe}"""
    if request.method == "GET":
        liste = UranusUser.objects.all().prefetch_related("roles_lephare__role").order_by("-is_active", "name", "email")
        q = (request.query_params.get("q") or "").strip()
        if q:
            liste = liste.filter(Q(email__icontains=q) | Q(name__icontains=q))
        if request.query_params.get("role"):
            liste = liste.filter(roles_lephare__role_id=request.query_params["role"])
        etat = request.query_params.get("etat")
        if etat == "actifs":
            liste = liste.filter(is_active=True)
        elif etat == "inactifs":
            liste = liste.filter(is_active=False)
        securites = {s.utilisateur_id: s for s in SecuriteUtilisateur.objects.all()}
        return Response([_utilisateur_json(u, securites.get(u.id, False)) for u in liste.distinct()])

    email = UranusUser.objects.normalize_email((request.data.get("email") or "").strip()).lower()
    nom = (request.data.get("nom") or "").strip()[:110]
    try:
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise Refus("Adresse e-mail invalide (elle sert d'identifiant de connexion).")
        if UranusUser.objects.filter(email__iexact=email).exists():
            raise Refus("Un utilisateur existe déjà avec cette adresse e-mail.")
        if not nom:
            raise Refus("Le nom est obligatoire.")
        mot_de_passe = request.data.get("mot_de_passe") or ""
        _verifier_mot_de_passe(mot_de_passe)
        _controler_attribution(request, request.data.get("roles"))
        with transaction.atomic():
            u = UranusUser.objects.create_user(email=email, password=mot_de_passe, name=nom)
            _appliquer_roles(u, request.data.get("roles"), _auteur(request))
            SecuriteUtilisateur.objects.update_or_create(utilisateur=u, defaults={"doit_changer_mot_de_passe": True})
    except Refus as erreur:
        return _erreur(erreur)
    donnees = _utilisateur_json(u)
    completer_audit(request, description=f"Création de l'utilisateur {email}", objet_type="utilisateur",
                    objet_id=u.pk, apres=donnees)
    return Response(donnees, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def utilisateur(request, pk):
    """GET /api/securite/utilisateurs/<id>/ (droits effectifs, activité) ; PATCH {nom, roles, date_expiration}"""
    u = UranusUser.objects.filter(pk=pk).first()
    if not u:
        return _erreur("Utilisateur introuvable.", status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        activite = AuditLogCima.objects.filter(utilisateur=u).order_by("-date_creation")[:25]
        return Response({
            **_utilisateur_json(u),
            "droits_effectifs": _droits_effectifs(u),
            "activite": [_journal_json(e) for e in activite],
        })

    avant = _utilisateur_json(u)
    try:
        _controler_cible(request, u)
        with transaction.atomic():
            if "nom" in request.data:
                nom = (request.data.get("nom") or "").strip()[:110]
                if not nom:
                    raise Refus("Le nom est obligatoire.")
                u.name = nom
            if "date_expiration" in request.data:
                valeur = request.data.get("date_expiration")
                u.expiry_date = timezone.make_aware(datetime.combine(
                    datetime.strptime(valeur[:10], "%Y-%m-%d").date(), time(23, 59))) if valeur else None
            u.save()
            if "roles" in request.data:
                _controler_attribution(request, request.data.get("roles"))
                if u.pk == request.user.pk and not u.is_admin:
                    nouveaux = set(Droit.objects.filter(roles__id__in=request.data.get("roles") or [], roles__actif=True)
                                   .values_list("code", flat=True))
                    if "users.update" not in nouveaux:
                        raise Refus("Vous ne pouvez pas vous retirer à vous-même le droit de modifier les utilisateurs.")
                _appliquer_roles(u, request.data.get("roles"), _auteur(request))
    except (Refus, ValueError) as erreur:
        return _erreur(erreur if isinstance(erreur, Refus) else "Date d'expiration invalide.")
    apres = _utilisateur_json(u)
    completer_audit(request, description=f"Modification de l'utilisateur {u.email}", objet_type="utilisateur",
                    objet_id=u.pk, avant=avant, apres=apres)
    return Response(apres)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def activer_utilisateur(request, pk, operation):
    """POST /api/securite/utilisateurs/<id>/activer|desactiver/"""
    u = UranusUser.objects.filter(pk=pk).first()
    if not u:
        return _erreur("Utilisateur introuvable.", status.HTTP_404_NOT_FOUND)
    actif = operation == "activer"
    if not actif and u.pk == request.user.pk:
        return _erreur("Vous ne pouvez pas désactiver votre propre compte.")
    try:
        _controler_cible(request, u)
    except Refus as erreur:
        return _erreur(erreur, status.HTTP_403_FORBIDDEN)
    avant = _utilisateur_json(u)
    u.is_active = actif
    u.save(update_fields=["is_active"])
    if not actif:
        AuthToken.objects.filter(user=u).delete()  # sessions ouvertes fermées immédiatement
    else:
        securite = _securite(u)
        securite.echecs_connexion = 0
        securite.verrouille_jusqua = None
        securite.save()
    apres = _utilisateur_json(u)
    completer_audit(request, description=f"{'Activation' if actif else 'Désactivation'} de l'utilisateur {u.email}",
                    objet_type="utilisateur", objet_id=u.pk, avant=avant, apres=apres)
    return Response(apres)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def reinitialiser_mot_de_passe(request, pk):
    """POST /api/securite/utilisateurs/<id>/mot-de-passe/ {mot_de_passe} : mot de passe provisoire saisi par
    l'administrateur (jamais affiché ni enregistré en clair), à changer à la prochaine connexion."""
    u = UranusUser.objects.filter(pk=pk).first()
    if not u:
        return _erreur("Utilisateur introuvable.", status.HTTP_404_NOT_FOUND)
    try:
        _controler_cible(request, u)
    except Refus as erreur:
        return _erreur(erreur, status.HTTP_403_FORBIDDEN)
    mot_de_passe = request.data.get("mot_de_passe") or ""
    try:
        _verifier_mot_de_passe(mot_de_passe, u)
    except Refus as erreur:
        return _erreur(erreur)
    u.set_password(mot_de_passe)
    u.save(update_fields=["password"])
    securite = _securite(u)
    securite.doit_changer_mot_de_passe = True
    securite.echecs_connexion = 0
    securite.verrouille_jusqua = None
    securite.save()
    AuthToken.objects.filter(user=u).delete()
    completer_audit(request, description=f"Réinitialisation du mot de passe de {u.email} (provisoire, à changer)",
                    objet_type="utilisateur", objet_id=u.pk, apres={"email": u.email, "doit_changer_mot_de_passe": True})
    return Response(_utilisateur_json(u))


# ------------------------------------------------------------------ rôles
def _lire_role(role, donnees, creation):
    if creation or "code" in donnees:
        code = (donnees.get("code") or "").strip().upper()
        if not MOTIF_CODE_ROLE.match(code):
            raise Refus("Code du rôle : 2 à 40 lettres majuscules, chiffres ou _.")
        if Role.objects.filter(code=code).exclude(pk=role.pk).exists():
            raise Refus("Un rôle porte déjà ce code.")
        role.code = code
    if creation or "libelle" in donnees:
        libelle = (donnees.get("libelle") or "").strip()[:100]
        if not libelle:
            raise Refus("Le libellé du rôle est obligatoire.")
        role.libelle = libelle
    if "description" in donnees:
        role.description = (donnees.get("description") or "").strip()[:1000]
    if "actif" in donnees:
        role.actif = bool(donnees.get("actif"))
    if "ordre" in donnees:
        try:
            role.ordre = max(0, min(999, int(donnees.get("ordre") or 0)))
        except (TypeError, ValueError):
            raise Refus("Ordre : nombre entier attendu.")


def _verifier_administration_preservee(request):
    """Après une modification de rôle, l'administration doit rester accessible à quelqu'un."""
    administrateurs = UranusUser.objects.filter(is_active=True).filter(
        Q(is_admin=True) | Q(roles_lephare__role__actif=True, roles_lephare__role__droits__code="roles.manage")
    )
    if not administrateurs.exists():
        raise Refus("Modification refusée : plus aucun utilisateur actif ne pourrait gérer les rôles.")


@api_view(["GET", "POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def roles(request):
    """GET /api/securite/roles/ ; POST {code, libelle, description, actif, droits}"""
    if request.method == "GET":
        liste = Role.objects.annotate(nb_utilisateurs=Count("attributions")).prefetch_related("droits")
        return Response([_role_json(r) for r in liste])
    role = Role(modifie_par=_auteur(request))
    try:
        with transaction.atomic():
            _lire_role(role, request.data, creation=True)
            role.save()
            role.droits.set(Droit.objects.filter(code__in=request.data.get("droits") or []))
    except Refus as erreur:
        return _erreur(erreur)
    donnees = _role_json(role, complet=True)
    completer_audit(request, description=f"Création du rôle {role.libelle}", objet_type="role", objet_id=role.pk,
                    apres=donnees)
    return Response(donnees, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def role(request, pk):
    """GET / PATCH {libelle, description, actif, droits} / DELETE (rôle sans utilisateur) /api/securite/roles/<id>/"""
    objet = Role.objects.filter(pk=pk).first()
    if not objet:
        return _erreur("Rôle introuvable.", status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response(_role_json(objet, complet=True))
    avant = _role_json(objet, complet=True)
    if request.method == "DELETE":
        if objet.attributions.exists():
            return _erreur("Ce rôle est attribué à des utilisateurs : retirez-le d'abord ou désactivez-le.")
        objet.delete()
        completer_audit(request, description=f"Suppression du rôle {avant['libelle']}", objet_type="role",
                        objet_id=pk, avant=avant)
        return Response(status=status.HTTP_204_NO_CONTENT)
    try:
        with transaction.atomic():
            _lire_role(objet, request.data, creation=False)
            objet.modifie_par = _auteur(request)
            objet.save()
            if "droits" in request.data:
                codes = set(request.data.get("droits") or [])
                inconnus = codes - set(Droit.objects.values_list("code", flat=True))
                if inconnus:
                    raise Refus(f"Droit inconnu : {', '.join(sorted(inconnus))}.")
                objet.droits.set(Droit.objects.filter(code__in=codes))
            _verifier_administration_preservee(request)
    except Refus as erreur:
        return _erreur(erreur)
    apres = _role_json(objet, complet=True)
    ajoutes = sorted(set(apres["droits"]) - set(avant["droits"]))
    retires = sorted(set(avant["droits"]) - set(apres["droits"]))
    completer_audit(
        request, description=f"Modification du rôle {objet.libelle}"
        + (f" - droits ajoutés : {', '.join(ajoutes)}" if ajoutes else "")
        + (f" - droits retirés : {', '.join(retires)}" if retires else ""),
        objet_type="role", objet_id=objet.pk, avant=avant, apres=apres,
    )
    return Response(apres)


# ------------------------------------------------------------------ droits
@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def droits(request):
    """GET /api/securite/droits/ : catalogue par module, avec les rôles qui accordent chaque droit."""
    roles_par_droit = {}
    for r in Role.objects.prefetch_related("droits"):
        for code in r.droits.values_list("code", flat=True):
            roles_par_droit.setdefault(code, []).append({"id": r.id, "libelle": r.libelle, "actif": r.actif})
    modules = []
    for d in Droit.objects.all():
        if not modules or modules[-1]["module"] != d.module:
            modules.append({"module": d.module, "libelle": d.module_libelle, "droits": []})
        modules[-1]["droits"].append({
            "code": d.code, "action": d.action, "libelle": d.libelle, "description": d.description,
            "sensible": d.sensible, "motif_obligatoire": d.motif_obligatoire,
            "separation_taches": d.separation_taches, "separation_possible": d.separation_possible,
            "roles": roles_par_droit.get(d.code, []),
        })
    return Response(modules)


@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def droit(request, code):
    """PATCH /api/securite/droits/<code>/ {motif_obligatoire, separation_taches}"""
    objet = Droit.objects.filter(code=code).first()
    if not objet:
        return _erreur("Droit inconnu.", status.HTTP_404_NOT_FOUND)
    avant = {"motif_obligatoire": objet.motif_obligatoire, "separation_taches": objet.separation_taches}
    if "motif_obligatoire" in request.data:
        objet.motif_obligatoire = bool(request.data["motif_obligatoire"])
    if "separation_taches" in request.data:
        if request.data["separation_taches"] and not objet.separation_possible:
            return _erreur("La séparation des tâches n'est pas disponible pour cette action.")
        objet.separation_taches = bool(request.data["separation_taches"])
    objet.save()
    apres = {"motif_obligatoire": objet.motif_obligatoire, "separation_taches": objet.separation_taches}
    completer_audit(request, description=f"Réglage du droit {objet.code} ({objet.libelle})", objet_type="droit",
                    objet_id=objet.code, avant=avant, apres=apres)
    return Response({"code": objet.code, **apres})


# ------------------------------------------------------------------ journal d'audit
def _journal_json(e, complet=False):
    donnees = {
        "id": e.id, "date": _iso(e.date_creation), "utilisateur_id": e.utilisateur_id, "auteur": e.auteur,
        "module": e.module or e.type_operation.lower(), "action": e.action, "description": e.description,
        "objet_type": e.objet_type, "objet_id": e.objet_id, "resultat": e.resultat or e.statut_conformite,
        "adresse_ip": e.adresse_ip, "motif": e.motif,
        "avec_valeurs": e.valeur_avant is not None or e.valeur_apres is not None,
    }
    if complet:
        donnees.update({
            "methode": e.methode, "chemin": e.chemin, "statut_http": e.statut_http, "valeur_avant": e.valeur_avant,
            "valeur_apres": e.valeur_apres, "details": e.details_json, "type_operation": e.type_operation,
            "reference": e.reference_reglementaire,
        })
    return donnees


def _journal_filtre(params):
    liste = AuditLogCima.objects.all().order_by("-date_creation", "-id")
    if params.get("utilisateur"):
        liste = liste.filter(utilisateur_id=params["utilisateur"])
    if params.get("module"):
        liste = liste.filter(Q(module=params["module"]) | Q(module="", type_operation__iexact=params["module"]))
    if params.get("action"):
        liste = liste.filter(action=params["action"])
    if params.get("resultat"):
        liste = liste.filter(Q(resultat=params["resultat"]) | Q(resultat="", statut_conformite=params["resultat"]))
    if params.get("objet_type"):
        liste = liste.filter(objet_type=params["objet_type"])
    if params.get("objet_id"):
        liste = liste.filter(objet_id=params["objet_id"])
    for cle, operateur in (("du", "gte"), ("au", "lte")):
        if params.get(cle):
            try:
                jour = datetime.strptime(params[cle][:10], "%Y-%m-%d").date()
            except ValueError:
                continue
            borne = timezone.make_aware(datetime.combine(jour, time.min if cle == "du" else time.max))
            liste = liste.filter(**{f"date_creation__{operateur}": borne})
    q = (params.get("q") or "").strip()
    if q:
        liste = liste.filter(Q(description__icontains=q) | Q(auteur__icontains=q) | Q(objet_id__icontains=q)
                             | Q(motif__icontains=q))
    return liste


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def journal(request):
    """GET /api/securite/journal/?utilisateur=&module=&action=&resultat=&du=&au=&q=&page="""
    liste = _journal_filtre(request.query_params)
    try:
        page = max(1, int(request.query_params.get("page") or 1))
    except ValueError:
        page = 1
    total = liste.count()
    lignes = liste[(page - 1) * PAGE: page * PAGE]
    return Response({"total": total, "page": page, "taille_page": PAGE, "resultats": [_journal_json(e) for e in lignes]})


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def entree_journal(request, pk):
    """GET /api/securite/journal/<id>/ : détail avec valeurs avant / après."""
    entree = AuditLogCima.objects.filter(pk=pk).first()
    if not entree:
        return _erreur("Entrée introuvable.", status.HTTP_404_NOT_FOUND)
    return Response(_journal_json(entree, complet=True))


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def filtres_journal(request):
    """GET /api/securite/journal/filtres/ : valeurs proposées dans les filtres du journal."""
    modules = sorted({m for m in AuditLogCima.objects.exclude(module="").values_list("module", flat=True).distinct()})
    actions = sorted({a for a in AuditLogCima.objects.exclude(action="").values_list("action", flat=True).distinct()})
    utilisateurs_ = UranusUser.objects.filter(journal_audit__isnull=False).distinct().order_by("name", "email")
    libelles = dict(MODULES)
    return Response({
        "modules": [{"code": m, "libelle": libelles.get(m, "Sécurité et connexions" if m == "securite" else m)} for m in modules],
        "actions": actions,
        "utilisateurs": [{"id": u.id, "libelle": u.name or u.email} for u in utilisateurs_],
    })


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([IsAuthenticated])
def export_journal(request):
    """GET /api/securite/journal/export/?filtres : journal filtré en CSV (10 000 lignes au plus)."""
    liste = _journal_filtre(request.query_params)[:10000]
    reponse = HttpResponse(content_type="text/csv; charset=utf-8")
    reponse["Content-Disposition"] = f'attachment; filename="journal_audit_{timezone.localdate():%Y%m%d}.csv"'
    reponse.write("﻿")
    ecrivain = csv.writer(reponse, delimiter=";")
    ecrivain.writerow(["Date", "Utilisateur", "Module", "Action", "Description", "Objet", "Identifiant", "Résultat",
                       "Adresse IP", "Motif"])
    nombre = 0
    for e in liste:
        nombre += 1
        # Description, motif, auteur… peuvent contenir une saisie : formules neutralisées (core/exports.py)
        ecrivain.writerow(ligne_csv([
            timezone.localtime(e.date_creation).strftime("%d/%m/%Y %H:%M:%S"), e.auteur, e.module or e.type_operation,
            e.action, e.description, e.objet_type, e.objet_id, e.resultat or e.statut_conformite, e.adresse_ip or "",
            e.motif,
        ]))
    journaliser(request=request, module="audit", action="audit.export",
                description=f"Export du journal d'audit ({nombre} ligne(s))",
                details={"filtres": dict(request.query_params)})
    return reponse
