"""
Réglages Automobile dans l'admin : dépréciation des véhicules (tableau de la CIEAMI), et calcul de la valeur
vénale demandé par les écrans (saisie d'un véhicule, import du formulaire, renouvellement).

- Tableau (lephare_depreciation_classe) : une ligne par genre de véhicule, taux par âge en mois ; une case
  peut porter deux taux (« 30/35 »).
- Règles de classement (lephare_depreciation_regle) : ligne du tableau retenue pour un véhicule.
- Paramètres auto.depreciation.* : taux retenu entre deux, valeur au-delà de 10 ans, valeur minimum.
Le calcul lui-même est fait par la base (fn_lephare_depreciation), comme au renouvellement.

Lecture pour tout utilisateur connecté, modification réservée aux administrateurs (droit tarifs.update),
chaque modification inscrite au journal d'audit.
"""

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.db import DatabaseError, connection, transaction
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from .models import (
    AutoRegleGarantie, AutoRegleInteraction, Compagnie, DepreciationClasse, DepreciationRegle, ParametreGeneral, PoolTpvTranche,
    TarifAutoGrille, TarifAutoGrilleLigne,
)
from .serializers import DemandeGarantieSerializer
from .utils import parametres_garantie_offre, tarification_demandee
from .parametrage import ErreurParametrage, _auteur, _cache, _journal, _parametre_json, _reponse_erreur, _texte, _valider_parametre
from .views_grilles_voyage import AUTHENTIFICATION, EstAdministrateur

PREFIXE = "auto.depreciation."
CHOIX_TAUX = {"plus_faible": "Le plus faible", "plus_eleve": "Le plus élevé", "moyenne": "La moyenne"}
VEHICULES_MAX = 500


def _lignes(sql, params=None):
    with connection.cursor() as cursor:
        cursor.execute(sql, params or [])
        colonnes = [c[0] for c in cursor.description]
        return [dict(zip(colonnes, ligne)) for ligne in cursor.fetchall()]


def _classe_json(c):
    return {
        "Code": c.Code, "Libelle": c.Libelle, "Kilometrage": c.Kilometrage, "Ordre": c.Ordre,
        "Taux": {k: [float(x) for x in v] for k, v in sorted((c.Taux or {}).items(), key=lambda kv: int(kv[0]))},
        "ModifiePar": c.ModifiePar,
        "DateModification": c.DateModification.isoformat() if c.DateModification else None,
    }


def _regle_json(r):
    return {
        "Id": r.id, "Ordre": r.Ordre, "Classe": r.Classe_id, "IdGenre": r.IdGenre, "IdTypeVehicule": r.IdTypeVehicule,
        "IdCarrosserie": r.IdCarrosserie, "CodeCategorie": r.CodeCategorie or "", "ChargeUtileSuperieureA": r.ChargeUtileSuperieureA,
    }


def regles_garanties_json():
    """Garanties admises selon l'âge du véhicule (lues aussi au démarrage de l'application)."""
    try:
        return [{
            "Id": r.id, "IdCompagnie": r.IdCompagnie, "IdSousGarantie": r.IdSousGarantie, "AgeMinimum": r.AgeMinimum,
            "AgeMaximum": r.AgeMaximum, "Categories": r.Categories or "", "Commentaire": r.Commentaire or "",
        } for r in AutoRegleGarantie.objects.all()]
    except Exception:  # noqa: BLE001 — base sans la migration configuration_api 0085
        return []


def _referentiels():
    return {
        "Compagnies": _lignes("SELECT idcompagnie AS id, raisonsociale AS libelle FROM stdcompagnie WHERE idcompagnie <> 0 AND COALESCE(active, TRUE) ORDER BY raisonsociale"),
        "SousGaranties": _lignes(
            "SELECT DISTINCT sg.idsousgarantie AS id, sg.libellesousgarantie AS libelle FROM stdsousgarantie sg "
            "JOIN stdoffregarantie og ON og.idsousgarantie = sg.idsousgarantie JOIN stdoffre o ON o.idoffre = og.idoffre "
            "JOIN stdtarif t ON t.idtarif = o.idtarif WHERE t.codecategorie LIKE '2%%' ORDER BY sg.libellesousgarantie"
        ),
        "Genres": _lignes("SELECT idgenre AS id, libellegenre AS libelle FROM stdgenrevehicule WHERE idgenre <> 0 ORDER BY libellegenre"),
        "Types": _lignes("SELECT id, libelletype AS libelle FROM stdtypevehicule WHERE id <> 0 ORDER BY libelletype"),
        "Carrosseries": _lignes("SELECT idcarrosserie AS id, libellecarrosserie AS libelle FROM stdcarrosserie ORDER BY libellecarrosserie"),
        "Categories": _lignes(
            "SELECT DISTINCT ON (codecategorie) codecategorie AS code, libelle FROM stdtarif "
            "WHERE codecategorie LIKE '2%%' ORDER BY codecategorie, idtarif"
        ),
    }


# ------------------------------------------------------------------ lecture
@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def depreciation(request):
    """GET /api/parametrage/auto/depreciation/ : tableau, règles, paramètres et listes de référence."""
    return Response({
        "Classes": [_classe_json(c) for c in DepreciationClasse.objects.all()],
        "Regles": [_regle_json(r) for r in DepreciationRegle.objects.all()],
        "Parametres": [_parametre_json(p) for p in ParametreGeneral.objects.filter(Cle__startswith=PREFIXE)],
        "ChoixTaux": [{"Code": k, "Libelle": v} for k, v in CHOIX_TAUX.items()],
        "ReglesGaranties": regles_garanties_json(),
        **_referentiels(),
    })


# ------------------------------------------------------------------ modifications
def _taux(valeur):
    """{mois: [taux] ou [min, max]} contrôlé ; accepte aussi « 30/35 » en texte par case."""
    if not isinstance(valeur, dict):
        raise ErreurParametrage("Taux : tableau attendu (âge en mois → taux).")
    propre = {}
    for cle, case in valeur.items():
        try:
            mois = int(str(cle).strip())
        except ValueError as erreur:
            raise ErreurParametrage(f"Âge « {cle} » : nombre de mois attendu.") from erreur
        if not 0 < mois <= 600:
            raise ErreurParametrage(f"Âge {mois} mois : entre 1 et 600 mois.")
        if case in (None, "", []):
            continue
        morceaux = case if isinstance(case, list) else str(case).replace(",", ".").split("/")
        try:
            nombres = [Decimal(str(x).strip().replace(",", ".")) for x in morceaux if str(x).strip() != ""]
        except InvalidOperation as erreur:
            raise ErreurParametrage(f"{mois} mois : taux illisible « {case} » (ex. 30 ou 30/35).") from erreur
        if not 1 <= len(nombres) <= 2 or any(not 0 <= n <= 100 for n in nombres):
            raise ErreurParametrage(f"{mois} mois : un ou deux taux entre 0 et 100 % (ex. 30 ou 30/35).")
        propre[str(mois)] = [float(n) for n in sorted(nombres)]
    if not propre:
        raise ErreurParametrage("Renseignez au moins un taux.")
    return propre


@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def classe(request, code):
    """PATCH /api/parametrage/auto/depreciation/classes/<code>/ {Libelle, Kilometrage, Taux}."""
    try:
        ligne = DepreciationClasse.objects.get(Code=code)
    except DepreciationClasse.DoesNotExist:
        return Response({"error": f"Ligne {code} introuvable."}, status=status.HTTP_404_NOT_FOUND)
    avant = _classe_json(ligne)
    try:
        if "Libelle" in request.data:
            ligne.Libelle = _texte(request.data["Libelle"], 100, "Libellé", obligatoire=True)
        if "Kilometrage" in request.data:
            ligne.Kilometrage = _texte(request.data["Kilometrage"], 100, "Kilométrage")
        if "Taux" in request.data:
            ligne.Taux = _taux(request.data["Taux"])
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    ligne.ModifiePar = _auteur(request)
    ligne.save()
    apres = _classe_json(ligne)
    _journal(request, f"Dépréciation : ligne « {ligne.Libelle} » modifiée", {"avant": avant, "apres": apres})
    return Response(apres)


def _entier_ou_vide(valeur, libelle):
    if valeur in (None, ""):
        return None
    try:
        return int(valeur)
    except (TypeError, ValueError) as erreur:
        raise ErreurParametrage(f"{libelle} : nombre entier attendu.") from erreur


@api_view(["PUT"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def regles(request):
    """PUT /api/parametrage/auto/depreciation/regles/ {Regles: [...]} : liste complète, dans l'ordre."""
    liste = request.data.get("Regles")
    if not isinstance(liste, list):
        return _reponse_erreur(ErreurParametrage("Règles : liste attendue."))
    codes = set(DepreciationClasse.objects.values_list("Code", flat=True))
    avant = [_regle_json(r) for r in DepreciationRegle.objects.all()]
    nouvelles = []
    try:
        for i, r in enumerate(liste, start=1):
            if r.get("Classe") not in codes:
                raise ErreurParametrage(f"Règle {i} : ligne du tableau inconnue.")
            regle = DepreciationRegle(
                Ordre=i, Classe_id=r["Classe"],
                IdGenre=_entier_ou_vide(r.get("IdGenre"), f"Règle {i}, genre"),
                IdTypeVehicule=_entier_ou_vide(r.get("IdTypeVehicule"), f"Règle {i}, type"),
                IdCarrosserie=_entier_ou_vide(r.get("IdCarrosserie"), f"Règle {i}, carrosserie"),
                CodeCategorie=_texte(r.get("CodeCategorie"), 3, f"Règle {i}, catégorie"),
                ChargeUtileSuperieureA=_entier_ou_vide(r.get("ChargeUtileSuperieureA"), f"Règle {i}, charge utile"),
            )
            if regle.IdGenre is None and regle.IdTypeVehicule is None and regle.IdCarrosserie is None and not regle.CodeCategorie:
                raise ErreurParametrage(f"Règle {i} : indiquez au moins un genre, un type, une carrosserie ou une catégorie.")
            nouvelles.append(regle)
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    with transaction.atomic():
        DepreciationRegle.objects.all().delete()
        DepreciationRegle.objects.bulk_create(nouvelles)
    apres = [_regle_json(r) for r in DepreciationRegle.objects.all()]
    _journal(request, "Dépréciation : règles de classement modifiées", {"avant": avant, "apres": apres})
    return Response(apres)


@api_view(["PUT"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def regles_garanties(request):
    """PUT /api/parametrage/auto/regles-garanties/ {Regles: [...]} : liste complète des garanties admises selon l'âge."""
    liste = request.data.get("Regles")
    if not isinstance(liste, list):
        return _reponse_erreur(ErreurParametrage("Règles : liste attendue."))
    avant = regles_garanties_json()
    nouvelles = []
    try:
        for i, r in enumerate(liste, start=1):
            compagnie = _entier_ou_vide(r.get("IdCompagnie"), f"Règle {i}, compagnie")
            garantie = _entier_ou_vide(r.get("IdSousGarantie"), f"Règle {i}, garantie")
            minimum = _entier_ou_vide(r.get("AgeMinimum"), f"Règle {i}, âge minimum")
            maximum = _entier_ou_vide(r.get("AgeMaximum"), f"Règle {i}, âge maximum")
            if not compagnie or not garantie:
                raise ErreurParametrage(f"Règle {i} : choisissez la compagnie et la garantie.")
            if minimum is None and maximum is None:
                raise ErreurParametrage(f"Règle {i} : indiquez un âge minimum ou maximum.")
            if minimum is not None and maximum is not None and minimum >= maximum:
                raise ErreurParametrage(f"Règle {i} : l'âge minimum doit être inférieur à l'âge maximum.")
            categories = ",".join(c for c in re.split(r"[\s,;]+", str(r.get("Categories") or "")) if c)
            if categories and not re.fullmatch(r"\d{3}(,\d{3})*", categories):
                raise ErreurParametrage(f"Règle {i} : catégories attendues sous la forme 201, 202.")
            nouvelles.append(AutoRegleGarantie(
                IdCompagnie=compagnie, IdSousGarantie=garantie, AgeMinimum=minimum, AgeMaximum=maximum,
                Categories=categories, Commentaire=_texte(r.get("Commentaire"), 200, f"Règle {i}, commentaire"),
            ))
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    with transaction.atomic():
        AutoRegleGarantie.objects.all().delete()
        AutoRegleGarantie.objects.bulk_create(nouvelles)
    apres = regles_garanties_json()
    _journal(request, "Automobile : garanties admises selon l'âge modifiées", {"avant": avant, "apres": apres})
    return Response(apres)


# ------------------------------------------------------------------ règles entre garanties
TYPES_AVEC_LIEES = ("REQUIERT", "EXCLUE_SI", "OFFERTE_SI", "PRIME_SI", "COUPLEE")
# Règles qui portent une prime annuelle (forfait si une garantie liée est souscrite, minimum de la garantie)
TYPES_AVEC_PRIME = ("PRIME_SI", "PRIME_MINIMUM")


def _libelles_sous_garanties():
    return {l["id"]: (l["libelle"] or "").strip() for l in _lignes(
        "SELECT idsousgarantie AS id, libellesousgarantie AS libelle FROM stdsousgarantie")}


# Règles que le barème peut appliquer lui-même (fn_lephare_regle_auto) aux offres qui contiennent une garantie liée ;
# la prime minimum n'est appliquée que par lui
TYPES_BAREME = ("OFFERTE_SI", "PRIME_SI", "PRIME_MINIMUM")


def interactions_garanties_json(libelles=None):
    """Règles entre garanties (lues aussi au démarrage de l'application, appliquées par l'écran de devis Auto)."""
    try:
        regles = list(AutoRegleInteraction.objects.all())
    except Exception:  # noqa: BLE001 — base sans la migration configuration_api 0090
        return []
    libelles = libelles if libelles is not None else _libelles_sous_garanties()
    return [{
        "Id": r.id, "IdCompagnie": r.IdCompagnie, "IdSousGarantie": r.IdSousGarantie,
        "Libelle": libelles.get(r.IdSousGarantie, f"Garantie {r.IdSousGarantie}"), "Type": r.Type,
        "Liees": r.Liees or "", "LibellesLiees": [libelles.get(int(x), f"Garantie {x}") for x in _codes(r.Liees) if x.isdigit()],
        "Categories": r.Categories or "", "PrimeAnnuelle": None if r.PrimeAnnuelle is None else float(r.PrimeAnnuelle),
        "Commentaire": r.Commentaire or "", "Actif": r.Actif, "Ordre": r.Ordre,
        "AppliqueeBareme": r.Type == "PRIME_MINIMUM" or bool(r.AppliqueeBareme and r.Type in TYPES_BAREME),
    } for r in regles]


@api_view(["GET", "PUT"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def regles_interactions(request):
    """GET /api/parametrage/auto/regles-interactions/ : règles, types, garanties Auto, compagnies ;
    PUT {Regles: [...]} : liste complète des règles entre garanties."""
    libelles = _libelles_sous_garanties()
    if request.method == "GET":
        return Response({
            "Regles": interactions_garanties_json(libelles),
            "Types": [{"Code": c, "Libelle": l} for c, l in AutoRegleInteraction.TYPES],
            "Garanties": _lignes(
                'SELECT DISTINCT sg.idsousgarantie AS "Id", sg.libellesousgarantie AS "Libelle" FROM stdsousgarantie AS sg'
                " JOIN stdoffregarantie AS og ON og.idsousgarantie = sg.idsousgarantie"
                " JOIN stdoffre AS o ON o.idoffre = og.idoffre JOIN stdtarif AS t ON t.idtarif = o.idtarif"
                " WHERE t.codecategorie LIKE %s ORDER BY 2", ["2%"]),
            "Compagnies": _lignes(
                'SELECT DISTINCT c.idcompagnie AS "Id", c.raisonsociale AS "Nom" FROM stdcompagnie AS c'
                " JOIN stdoffregarantie AS og ON og.idcompagnie = c.idcompagnie ORDER BY 2"),
        })
    liste = request.data.get("Regles")
    if not isinstance(liste, list):
        return _reponse_erreur(ErreurParametrage("Règles : liste attendue."))
    avant = interactions_garanties_json(libelles)
    types = dict(AutoRegleInteraction.TYPES)
    nouvelles = []
    try:
        for i, r in enumerate(liste, start=1):
            compagnie = _entier_ou_vide(r.get("IdCompagnie"), f"Règle {i}, compagnie")
            garantie = _entier_ou_vide(r.get("IdSousGarantie"), f"Règle {i}, garantie")
            type_ = str(r.get("Type") or "")
            if not compagnie or not garantie or type_ not in types:
                raise ErreurParametrage(f"Règle {i} : choisissez la compagnie, la garantie et le type de règle.")
            nom = libelles.get(garantie, f"Garantie {garantie}")
            liees = [x for x in _codes(r.get("Liees"))]
            if any(not x.isdigit() for x in liees):
                raise ErreurParametrage(f"{nom} : garanties liées invalides.")
            if type_ in TYPES_AVEC_LIEES and not liees:
                raise ErreurParametrage(f"{nom} : choisissez au moins une garantie liée ({types[type_].lower()}).")
            if str(garantie) in liees:
                raise ErreurParametrage(f"{nom} : une garantie ne peut pas dépendre d'elle-même.")
            categories = ",".join(_codes(r.get("Categories")))
            if categories and not re.fullmatch(r"\d{3}(,\d{3})*", categories):
                raise ErreurParametrage(f"{nom} : catégories attendues sous la forme 201, 202.")
            if type_ == "NON_PROPOSEE" and not categories:
                raise ErreurParametrage(f"{nom} : indiquez les catégories où la garantie n'est pas commercialisée.")
            prime = _nombre(r.get("PrimeAnnuelle")) if r.get("PrimeAnnuelle") not in (None, "") else None
            if type_ == "PRIME_SI" and (prime is None or prime < 0):
                raise ErreurParametrage(f"{nom} : prime annuelle forfaitaire attendue.")
            if type_ == "PRIME_MINIMUM" and (prime is None or prime <= 0):
                raise ErreurParametrage(f"{nom} : prime annuelle minimum attendue.")
            nouvelles.append(AutoRegleInteraction(
                IdCompagnie=compagnie, IdSousGarantie=garantie, Type=type_,
                Liees=",".join(liees) if type_ in TYPES_AVEC_LIEES else "", Categories=categories,
                PrimeAnnuelle=prime if type_ in TYPES_AVEC_PRIME else None,
                Commentaire=_chaine(r.get("Commentaire"), 300), Actif=bool(r.get("Actif", True)), Ordre=i,
                AppliqueeBareme=type_ == "PRIME_MINIMUM" or (bool(r.get("AppliqueeBareme")) and type_ in TYPES_BAREME),
                ModifiePar=_auteur(request),
            ))
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    with transaction.atomic():
        AutoRegleInteraction.objects.all().delete()
        AutoRegleInteraction.objects.bulk_create(nouvelles)
    apres = interactions_garanties_json(libelles)
    _journal(request, "Automobile : règles entre garanties modifiées", {"avant": avant, "apres": apres})
    return Response(apres)


@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def parametre(request, cle):
    """PATCH /api/parametrage/auto/depreciation/parametres/<cle>/ {Valeur} ou {Retablir: true}."""
    parametre_ = ParametreGeneral.objects.filter(Cle=cle, Cle__startswith=PREFIXE).first()
    if not parametre_:
        return Response({"error": f"Réglage {cle} inconnu."}, status=status.HTTP_404_NOT_FOUND)
    avant = parametre_.Valeur
    try:
        if request.data.get("Retablir"):
            parametre_.Valeur = parametre_.ValeurOrigine
        elif cle == "auto.depreciation.taux_retenu":
            valeur = str(request.data.get("Valeur") or "").strip()
            if valeur not in CHOIX_TAUX:
                raise ErreurParametrage(f"Taux retenu : {', '.join(CHOIX_TAUX)} attendu.")
            parametre_.Valeur = valeur
        else:
            parametre_.Valeur = _valider_parametre(parametre_, request.data.get("Valeur"))
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    parametre_.ModifiePar = _auteur(request)
    parametre_.save()
    _cache.pop(cle, None)
    _journal(request, f"Dépréciation : « {parametre_.Libelle} » modifié", {"cle": cle, "avant": avant, "apres": parametre_.Valeur})
    return Response(_parametre_json(parametre_))


# ------------------------------------------------------------------ Pool TPV (catégorie 204)
PREFIXE_POOL = "auto.pool_tpv."


def _pourcentage_texte(nombre):
    """Decimal -> texte sans zéros décimaux inutiles (10 reste 10, 10.50 devient 10.5)."""
    texte = f"{nombre:f}"
    return texte.rstrip("0").rstrip(".") if "." in texte else texte


def _tranche_json(t):
    return {
        "Id": t.id, "PlacesMin": t.PlacesMin, "PlacesMax": t.PlacesMax, "PrimeRcAnnuelle": float(t.PrimeRcAnnuelle),
        "Accessoires": [float(x) for x in (t.Accessoires or [])], "Ordre": t.Ordre,
    }


def _suivi_pool(du=None, au=None):
    """Contrats émis en offre « POOL TPV » : RC + Recours dus au Pool, par police."""
    filtres, params = [], []
    if du:
        filtres.append("c.dateemission::date >= %s")
        params.append(du)
    if au:
        filtres.append("c.dateemission::date <= %s")
        params.append(au)
    return _lignes(
        f"""
        SELECT c.idcontrat AS "IdContrat", c.numeropolice AS "NumeroPolice", c.dateemission::date AS "DateEmission",
               c.dateeffet::date AS "DateEffet", c.dateexpiration::date AS "DateExpiration",
               TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS "Client", co.raisonsociale AS "Compagnie",
               COUNT(DISTINCT cd.idcontratdetail) AS "Vehicules",
               COALESCE(SUM(g.primenette) FILTER (WHERE g.idgarantie = 1), 0) AS "PrimeRc",
               COALESCE(SUM(g.primenette) FILTER (WHERE g.idgarantie = 4), 0) AS "PrimeRecours"
        FROM stdcontrat AS c
        JOIN stdcontratdetail AS cd ON cd.idcontrat = c.idcontrat
        JOIN stddevisdetail AS dd ON dd.iddevis = c.iddevis AND fn_est_offre_pool_tpv(dd.idoffre)
        LEFT JOIN stddevisdetgarantie AS g ON g.iddevisdet = dd.iddevisdetail
        LEFT JOIN stdclient AS cl ON cl.idclient = c.idclient
        LEFT JOIN stdcompagnie AS co ON co.idcompagnie = c.idcompagnie
        WHERE COALESCE(c.idcontratannulation, 0) = 0 {''.join(' AND ' + f for f in filtres)}
        GROUP BY c.idcontrat, cl.nom, cl.prenoms, co.raisonsociale
        ORDER BY c.dateemission DESC, c.idcontrat DESC
        """,
        params,
    )


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def pool_tpv(request):
    """GET /api/parametrage/auto/pool-tpv/?du=&au= : tranches, paramètres et primes dues au Pool."""
    suivi = _suivi_pool(request.query_params.get("du") or None, request.query_params.get("au") or None)
    for ligne in suivi:
        ligne["PrimeRc"], ligne["PrimeRecours"] = float(ligne["PrimeRc"]), float(ligne["PrimeRecours"])
        ligne["TotalPool"] = ligne["PrimeRc"] + ligne["PrimeRecours"]
    return Response({
        "Tranches": [_tranche_json(t) for t in PoolTpvTranche.objects.all()],
        "Parametres": [_parametre_json(p) for p in ParametreGeneral.objects.filter(Cle__startswith=PREFIXE_POOL)],
        "Suivi": suivi,
    })


@api_view(["PUT"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def pool_tpv_tranches(request):
    """PUT /api/parametrage/auto/pool-tpv/tranches/ {Tranches: [...]} : grille complète, dans l'ordre des places."""
    liste = request.data.get("Tranches")
    if not isinstance(liste, list) or not liste:
        return _reponse_erreur(ErreurParametrage("Tranches : liste attendue."))
    avant = [_tranche_json(t) for t in PoolTpvTranche.objects.all()]
    nouvelles = []
    try:
        for i, t in enumerate(sorted(liste, key=lambda x: int(x.get("PlacesMin") or 0)), start=1):
            mini = _entier_ou_vide(t.get("PlacesMin"), f"Tranche {i}, places minimum")
            maxi = _entier_ou_vide(t.get("PlacesMax"), f"Tranche {i}, places maximum")
            if mini is None or mini < 0:
                raise ErreurParametrage(f"Tranche {i} : nombre de places minimum attendu.")
            if maxi is not None and maxi < mini:
                raise ErreurParametrage(f"Tranche {i} : le maximum de places doit être au moins égal au minimum.")
            try:
                prime = Decimal(str(t.get("PrimeRcAnnuelle")).replace(" ", "").replace(",", "."))
            except InvalidOperation as erreur:
                raise ErreurParametrage(f"Tranche {i} : prime RC annuelle attendue.") from erreur
            if prime <= 0:
                raise ErreurParametrage(f"Tranche {i} : prime RC annuelle positive attendue.")
            accessoires = t.get("Accessoires") or []
            if not isinstance(accessoires, list) or len(accessoires) != 12:
                raise ErreurParametrage(f"Tranche {i} : douze accessoires attendus (1 à 12 mois).")
            try:
                accessoires = [float(Decimal(str(a).replace(" ", "").replace(",", ".") or 0)) for a in accessoires]
            except InvalidOperation as erreur:
                raise ErreurParametrage(f"Tranche {i} : accessoire illisible.") from erreur
            if any(a < 0 for a in accessoires):
                raise ErreurParametrage(f"Tranche {i} : accessoires positifs attendus.")
            if nouvelles and nouvelles[-1].PlacesMax is not None and mini <= nouvelles[-1].PlacesMax:
                raise ErreurParametrage(f"Tranche {i} : chevauche la tranche précédente.")
            if nouvelles and nouvelles[-1].PlacesMax is None:
                raise ErreurParametrage("Seule la dernière tranche peut être sans maximum de places.")
            nouvelles.append(PoolTpvTranche(PlacesMin=mini, PlacesMax=maxi, PrimeRcAnnuelle=prime, Accessoires=accessoires,
                                            Ordre=i, ModifiePar=_auteur(request)))
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    with transaction.atomic():
        PoolTpvTranche.objects.all().delete()
        PoolTpvTranche.objects.bulk_create(nouvelles)
    apres = [_tranche_json(t) for t in PoolTpvTranche.objects.all()]
    _journal(request, "Pool TPV : tarif modifié", {"avant": avant, "apres": apres})
    return Response(apres)


@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def pool_tpv_parametre(request, cle):
    """PATCH /api/parametrage/auto/pool-tpv/parametres/<cle>/ {Valeur} ou {Retablir: true}."""
    parametre_ = ParametreGeneral.objects.filter(Cle=cle, Cle__startswith=PREFIXE_POOL).first()
    if not parametre_ or cle == "auto.pool_tpv.offre":
        return Response({"error": f"Réglage {cle} inconnu ou non modifiable."}, status=status.HTTP_404_NOT_FOUND)
    avant = parametre_.Valeur
    try:
        if request.data.get("Retablir"):
            parametre_.Valeur = parametre_.ValeurOrigine
        elif cle == "auto.pool_tpv.fractions":
            morceaux = [m.strip().replace(",", ".") for m in str(request.data.get("Valeur") or "").split("/")]
            try:
                nombres = [Decimal(m) for m in morceaux]
            except InvalidOperation as erreur:
                raise ErreurParametrage("Fractions : douze pourcentages séparés par « / » attendus.") from erreur
            if len(nombres) != 12 or any(not 0 < n <= 100 for n in nombres) or nombres != sorted(nombres):
                raise ErreurParametrage("Fractions : douze pourcentages croissants entre 0 et 100, séparés par « / ».")
            parametre_.Valeur = "/".join(_pourcentage_texte(n) for n in nombres)
        else:
            parametre_.Valeur = _valider_parametre(parametre_, request.data.get("Valeur"))
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    parametre_.ModifiePar = _auteur(request)
    parametre_.save()
    _cache.pop(cle, None)
    _journal(request, f"Pool TPV : « {parametre_.Libelle} » modifié", {"cle": cle, "avant": avant, "apres": parametre_.Valeur})
    return Response(_parametre_json(parametre_))


# ------------------------------------------------------------------ calcul pour les écrans
def _date(valeur):
    if not valeur:
        return None
    if isinstance(valeur, (date, datetime)):
        return valeur if isinstance(valeur, date) else valeur.date()
    texte = str(valeur).strip()[:10]
    for format_ in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(texte, format_).date()
        except ValueError:
            continue
    return None


def _nombre(valeur):
    try:
        return Decimal(str(valeur).replace(" ", "").replace(",", ".")) if valeur not in (None, "") else None
    except InvalidOperation:
        return None


def calculer_valeurs_venales(vehicules, date_effet_defaut=None):
    """[{Cle?, IdGenre, IdTypeVehicule, IdCarrosserie, CodeCategorie | IdTarif, ChargeUtile, ValeurNeuve, DateMec,
    DateEffet?}] → mêmes clés + Classe, Libelle, AgeMois, TauxMinimum, TauxMaximum, Taux, ValeurVenale, Explication."""
    resultats = []
    with connection.cursor() as cursor:
        for v in vehicules[:VEHICULES_MAX]:
            categorie = str(v.get("CodeCategorie") or "").strip()
            if not categorie and v.get("IdTarif"):
                cursor.execute("SELECT codecategorie FROM stdtarif WHERE idtarif = %s", [int(v["IdTarif"])])
                ligne = cursor.fetchone()
                categorie = (ligne[0] or "").strip() if ligne else ""
            entier = lambda x: int(x) if str(x or "").strip().lstrip("-").isdigit() else None  # noqa: E731
            cursor.execute(
                "SELECT classe, libelle, age_mois, taux_minimum, taux_maximum, taux, valeur_venale, explication "
                "FROM fn_lephare_depreciation(%s, %s, %s, %s, %s, %s, %s, %s)",
                [entier(v.get("IdGenre")), entier(v.get("IdTypeVehicule")), entier(v.get("IdCarrosserie")), categorie,
                 _nombre(v.get("ChargeUtile")) or 0, _nombre(v.get("ValeurNeuve")) or 0, _date(v.get("DateMec")),
                 _date(v.get("DateEffet")) or _date(date_effet_defaut) or date.today()],
            )
            r = cursor.fetchone()
            resultats.append({
                "Cle": v.get("Cle"), "Classe": r[0], "Libelle": r[1], "AgeMois": r[2],
                "TauxMinimum": None if r[3] is None else float(r[3]), "TauxMaximum": None if r[4] is None else float(r[4]),
                "Taux": None if r[5] is None else float(r[5]),
                "ValeurVenale": None if r[6] is None else int(r[6]), "Explication": r[7],
            })
    return resultats


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def valeur_venale(request):
    """POST /api/auto/valeur-venale/ {Vehicules: [...], DateEffet} : valeurs vénales du tableau (n'écrit rien)."""
    vehicules = request.data.get("Vehicules")
    if not isinstance(vehicules, list):
        return Response({"error": "Vehicules : liste attendue."}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"Vehicules": calculer_valeurs_venales(vehicules, request.data.get("DateEffet"))})


# Garantie ajoutée à un véhicule (devis Automobile) : offres essayées au plus, NSIA Auto Plus
OFFRES_ESSAYEES_MAX = 12
ID_SOUS_GARANTIE_NSIA_AUTO_PLUS = 175


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def prime_garantie(request):
    """POST /api/auto/prime-garantie/ {demande de /api/offregarantie, IdSousGarantie} : primes d'une garantie ajoutée
    à un véhicule, pour pré-remplir la saisie (n'écrit rien).

    Le moteur (fn_garantie_offre) ne tarife que les garanties d'une offre : la garantie est calculée avec une offre
    active de la compagnie qui la contient (l'offre du véhicule d'abord, puis celles de sa grille et de sa catégorie),
    pour le même véhicule, la même période et les mêmes réductions. L'offre du véhicule fait foi si elle contient la
    garantie ; sinon la première prime nette non nulle est retenue. Le taux de taxe de la garantie est joint, pour
    taxer une prime saisie à la main."""
    try:
        id_sous_garantie = int(request.data.get("IdSousGarantie"))
    except (TypeError, ValueError):
        return Response({"error": "IdSousGarantie : garantie attendue."}, status=status.HTTP_400_BAD_REQUEST)
    demande = DemandeGarantieSerializer(data=request.data)
    if not demande.is_valid():
        return Response(demande.errors, status=status.HTTP_400_BAD_REQUEST)
    donnees = dict(request.data)
    # NSIA Auto Plus n'est tarifée par le moteur que demandée (case « NSIA Auto Plus »)
    if id_sous_garantie == ID_SOUS_GARANTIE_NSIA_AUTO_PLUS:
        donnees["NsiaAutoPlus"] = True
    try:
        parametres = parametres_garantie_offre(donnees)
    except (KeyError, TypeError, ValueError, InvalidOperation) as erreur:
        return Response({"error": f"Demande incomplète : {erreur}."}, status=status.HTTP_400_BAD_REQUEST)
    id_compagnie, id_offre, id_tarif, date_effet = parametres[0], parametres[1], parametres[2], parametres[11]

    offres = _lignes(
        "SELECT o.idoffre, o.libelleoffre FROM stdoffre AS o"
        " LEFT JOIN stdtarif AS t ON t.idtarif = o.idtarif"
        " WHERE o.actif AND EXISTS (SELECT 1 FROM stdoffregarantie AS og"
        "   WHERE og.idoffre = o.idoffre AND og.idcompagnie = %s AND og.idsousgarantie = %s)"
        " ORDER BY o.idoffre = %s DESC, o.idtarif = %s DESC NULLS LAST,"
        " t.codecategorie = (SELECT codecategorie FROM stdtarif WHERE idtarif = %s) DESC NULLS LAST, o.idoffre"
        " LIMIT %s",
        [id_compagnie, id_sous_garantie, id_offre, id_tarif, id_tarif, OFFRES_ESSAYEES_MAX],
    )
    retenue = None
    erreur_moteur = None
    for offre in offres:
        parametres[1] = offre["idoffre"]
        try:
            # Devis d'incorporation : prorata des jours restants, ou prime entière (affaire forfaitaire)
            with tarification_demandee(donnees), transaction.atomic(), connection.cursor() as cursor:
                cursor.callproc("fn_garantie_offre", parametres)
                colonnes = [c[0] for c in cursor.description]
                lignes = [dict(zip(colonnes, ligne)) for ligne in cursor.fetchall()]
        except DatabaseError as erreur:
            # Refus du moteur (ex. valeur accessoire supérieure à la valeur vénale) : le même pour toutes les offres
            erreur_moteur = str(erreur).split("\n")[0]
            break
        ligne = next((l for l in lignes if l["idsousgarantie"] == id_sous_garantie), None)
        if ligne is None:
            continue
        # L'offre du véhicule fait foi : une garantie peut y être comprise dans une autre, à prime nulle (bris de
        # glace avec les dommages). Ailleurs, la première prime nette (celle facturée) non nulle est retenue.
        if retenue is None or offre["idoffre"] == id_offre or ligne["primenette"]:
            retenue = (offre, ligne)
        if offre["idoffre"] == id_offre or ligne["primenette"]:
            break

    taux = _lignes(
        "SELECT tauxtaxe FROM stdtauxtaxegarantieproduit WHERE idproduit = 1 AND idgarantie = %s"
        " AND %s BETWEEN debutvalidite AND finvalidite ORDER BY debutvalidite DESC LIMIT 1",
        [id_sous_garantie, date_effet],
    )
    reponse = {
        "IdSousGarantie": id_sous_garantie,
        "TauxTaxe": float(taux[0]["tauxtaxe"]) if taux else 0.0,
        "Trouvee": retenue is not None,
    }
    if retenue is None:
        reponse["Message"] = erreur_moteur or (
            "Garantie tarifée par aucune offre de cette compagnie : primes à saisir." if not offres
            else "Garantie non retenue par le tarif pour ce véhicule : primes à saisir."
        )
        return Response(reponse)
    offre, ligne = retenue
    nombre = lambda cle: float(ligne[cle] or 0)  # noqa: E731
    reponse.update({
        "IdOffre": offre["idoffre"], "Offre": offre["libelleoffre"],
        "Capital": nombre("capital"), "PrimeAnnuelle": nombre("primeannuelle"), "PrimeNette": nombre("primenette"),
        "Taxe": nombre("taxe"), "TauxFranchise": nombre("tauxfranchise"), "FranchiseMinimum": nombre("franchiseminimum"),
        "FranchiseMaximum": nombre("franchisemaximum"), "TexteFranchise": ligne["franchisetexte"] or "",
    })
    return Response(reponse)


# ------------------------------------------------------------------ tarifs à lecture directe
# Grilles de primes toutes faites d'une compagnie (NSIA : VP essence, VP diesel, TPC, TPM ; documents d'OREOLE du
# 16/10/2026) : pour les offres choisies, la tranche du véhicule et la durée donnent directement prime nette,
# accessoires, taxes, FGA, CEDEAO et TTC, sans saisie. Hors grille (autre offre, autre durée, véhicule hors tranche),
# le devis est calculé au barème (fn_garantie_offre).
CLE_COEFFICIENTS = "auto.coefficients_duree"
MONTANTS_TARIF = ("PrimeNette", "Accessoire", "Taxe", "Fga", "Cedeao", "PrimeTtc")
ECART_TTC_TOLERE = Decimal("2")  # composantes arrondies une à une par la compagnie : TTC à 1 F de leur somme


def _chaine(valeur, longueur):
    return ("" if valeur is None else str(valeur).strip())[:longueur]


def _codes(texte):
    return [x.strip() for x in re.split(r"[,;\s]+", str(texte or "")) if x.strip()]


def _ligne_tarif_json(l):
    return {
        "Id": l.id, "Libelle": l.Libelle, "BorneMin": l.BorneMin, "BorneMax": l.BorneMax, "Usages": l.Usages,
        "DureeMois": l.DureeMois, "Ordre": l.Ordre, **{m: float(getattr(l, m)) for m in MONTANTS_TARIF},
    }


def _grille_json(g):
    return {
        "Id": g.id, "IdCompagnie": g.IdCompagnie, "Libelle": g.Libelle, "Categories": g.Categories, "IdEnergie": g.IdEnergie,
        "Critere": g.Critere, "Offres": g.Offres, "Actif": g.Actif, "Source": g.Source, "Ordre": g.Ordre,
        "DateModification": g.DateModification.isoformat() if g.DateModification else None, "ModifiePar": g.ModifiePar,
        "Lignes": [_ligne_tarif_json(l) for l in g.lignes.all()],
    }


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def tarifs_directs(request):
    """GET /api/parametrage/auto/tarifs-directs/ : grilles, offres Automobile par compagnie, énergies, coefficients."""
    return Response({
        "Grilles": [_grille_json(g) for g in TarifAutoGrille.objects.prefetch_related("lignes")],
        "Compagnies": _lignes(
            'SELECT DISTINCT c.idcompagnie AS "Id", c.raisonsociale AS "Nom" FROM stdcompagnie AS c'
            " JOIN stdoffregarantie AS og ON og.idcompagnie = c.idcompagnie ORDER BY 2"
        ),
        "Offres": _lignes(
            'SELECT DISTINCT og.idcompagnie AS "IdCompagnie", o.idoffre AS "Id", o.libelleoffre AS "Libelle",'
            ' o.actif AS "Actif", TRIM(t.codecategorie) AS "Categorie"'
            " FROM stdoffre AS o JOIN stdoffregarantie AS og ON og.idoffre = o.idoffre"
            " JOIN stdtarif AS t ON t.idtarif = o.idtarif WHERE t.codecategorie LIKE %s ORDER BY 5, 2",
            ["2%"],
        ),
        "Energies": _lignes('SELECT idenergie AS "Id", libelle AS "Libelle" FROM stdenergie WHERE idenergie > 0 ORDER BY 1'),
        "Parametres": [_parametre_json(p) for p in ParametreGeneral.objects.filter(Cle=CLE_COEFFICIENTS)],
    })


def _montant_tarif(valeur, libelle):
    montant = _nombre(valeur)
    if montant is None or montant < 0:
        raise ErreurParametrage(f"{libelle} : montant positif ou nul attendu.")
    return montant.quantize(Decimal("1"))


def _lire_grille(donnees):
    """Grille saisie dans l'admin -> (champs de l'en-tête, lignes non enregistrées), contrôlée."""
    try:
        id_compagnie = int(donnees.get("IdCompagnie"))
    except (TypeError, ValueError) as erreur:
        raise ErreurParametrage("Compagnie : à choisir.") from erreur
    if not _lignes("SELECT 1 FROM stdcompagnie WHERE idcompagnie = %s", [id_compagnie]):
        raise ErreurParametrage("Compagnie inconnue.")
    libelle = _chaine(donnees.get("Libelle"), 100)
    if not libelle:
        raise ErreurParametrage("Nom de la grille : à renseigner.")
    categories = _codes(donnees.get("Categories"))
    if not categories or any(not re.fullmatch(r"\d{3}", c) for c in categories):
        raise ErreurParametrage("Catégories : codes à trois chiffres séparés par des virgules (ex. 201).")
    energie = str(donnees.get("IdEnergie") or "").strip()
    energie = int(energie) if energie.isdigit() and int(energie) > 0 else None
    critere = str(donnees.get("Critere") or "PUISSANCE")
    if critere not in dict(TarifAutoGrille.CRITERES):
        raise ErreurParametrage("Critère des tranches : puissance fiscale ou charge utile.")
    offres = _codes(donnees.get("Offres"))
    if any(not o.isdigit() for o in offres):
        raise ErreurParametrage("Offres : identifiants d'offres attendus.")
    unite = "CV" if critere == "PUISSANCE" else "kg"
    infini = float("inf")

    lignes, vues = [], {}
    for i, l in enumerate(donnees.get("Lignes") or [], start=1):
        nom = _chaine(l.get("Libelle"), 60)
        if not nom:
            raise ErreurParametrage(f"Ligne {i} : nom de la tranche à renseigner.")
        try:
            duree = int(l.get("DureeMois"))
        except (TypeError, ValueError) as erreur:
            raise ErreurParametrage(f"{nom} : durée en mois attendue.") from erreur
        if not 1 <= duree <= 12:
            raise ErreurParametrage(f"{nom} : durée de 1 à 12 mois.")
        usages = ",".join(_codes(l.get("Usages")))
        mini = _entier_ou_vide(l.get("BorneMin"), f"{nom}, minimum")
        maxi = _entier_ou_vide(l.get("BorneMax"), f"{nom}, maximum")
        if not usages:
            if mini is None or mini < 0:
                raise ErreurParametrage(f"{nom} ({duree} mois) : minimum ({unite}) attendu.")
            if maxi is not None and maxi < mini:
                raise ErreurParametrage(f"{nom} ({duree} mois) : le maximum doit être au moins égal au minimum.")
        montants = {m: _montant_tarif(l.get(m), f"{nom} ({duree} mois), {m}") for m in MONTANTS_TARIF}
        if montants["PrimeNette"] <= 0:
            raise ErreurParametrage(f"{nom} ({duree} mois) : prime nette attendue.")
        somme = sum(montants[m] for m in MONTANTS_TARIF if m != "PrimeTtc")
        if abs(montants["PrimeTtc"] - somme) > ECART_TTC_TOLERE:
            raise ErreurParametrage(
                f"{nom} ({duree} mois) : la prime TTC ({montants['PrimeTtc']:,.0f} F) ne correspond pas à la somme des "
                f"montants ({somme:,.0f} F).".replace(",", " "))
        # Tranches d'une même durée sans chevauchement ; une seule ligne par usage
        for autre in vues.get(duree, []):
            if usages or autre["usages"]:
                if usages and autre["usages"] and set(usages.split(",")) & set(autre["usages"].split(",")):
                    raise ErreurParametrage(f"{nom} et {autre['nom']} ({duree} mois) : même usage deux fois.")
                continue
            if mini <= (infini if autre["maxi"] is None else autre["maxi"]) and autre["mini"] <= (infini if maxi is None else maxi):
                raise ErreurParametrage(f"{nom} chevauche {autre['nom']} ({duree} mois).")
        vues.setdefault(duree, []).append({"nom": nom, "mini": mini, "maxi": maxi, "usages": usages})
        lignes.append(TarifAutoGrilleLigne(Libelle=nom, BorneMin=None if usages else mini, BorneMax=None if usages else maxi,
                                           Usages=usages, DureeMois=duree, Ordre=i, **montants))
    if not lignes:
        raise ErreurParametrage("La grille doit compter au moins une tranche.")
    entete = dict(IdCompagnie=id_compagnie, Libelle=libelle, Categories=",".join(categories), IdEnergie=energie,
                  Critere=critere, Offres=",".join(offres), Actif=bool(donnees.get("Actif", True)),
                  Source=_chaine(donnees.get("Source"), 200))
    return entete, lignes


def _enregistrer_grille(request, grille, entete, lignes):
    avant = _grille_json(grille) if grille.pk else None
    with transaction.atomic():
        for champ, valeur in entete.items():
            setattr(grille, champ, valeur)
        grille.ModifiePar = _auteur(request)
        if not grille.pk:
            grille.Ordre = TarifAutoGrille.objects.filter(IdCompagnie=grille.IdCompagnie).count() + 1
        grille.save()
        grille.lignes.all().delete()
        for ligne in lignes:
            ligne.Grille = grille
        TarifAutoGrilleLigne.objects.bulk_create(lignes)
    apres = _grille_json(TarifAutoGrille.objects.prefetch_related("lignes").get(pk=grille.pk))
    _journal(request, f"Tarif à lecture directe « {grille.Libelle} » {'modifié' if avant else 'créé'}", {"avant": avant, "apres": apres})
    return apres


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def tarifs_directs_grilles(request):
    """POST /api/parametrage/auto/tarifs-directs/grilles/ {en-tête, Lignes: [...]} : nouvelle grille."""
    try:
        entete, lignes = _lire_grille(request.data)
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    return Response(_enregistrer_grille(request, TarifAutoGrille(), entete, lignes), status=status.HTTP_201_CREATED)


@api_view(["PUT", "DELETE"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def tarifs_directs_grille(request, id_tarif):
    """PUT /api/parametrage/auto/tarifs-directs/grilles/<id>/ : grille complète (en-tête et tranches) ; DELETE : retrait."""
    grille = TarifAutoGrille.objects.filter(pk=id_tarif).first()
    if not grille:
        return Response({"error": "Grille introuvable."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        avant = _grille_json(grille)
        grille.delete()
        _journal(request, f"Tarif à lecture directe « {avant['Libelle']} » supprimé", {"avant": avant, "apres": None})
        return Response(status=status.HTTP_204_NO_CONTENT)
    try:
        entete, lignes = _lire_grille(request.data)
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    return Response(_enregistrer_grille(request, grille, entete, lignes))


@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def tarifs_directs_parametre(request, cle):
    """PATCH /api/parametrage/auto/tarifs-directs/parametres/<cle>/ {Valeur} ou {Retablir: true} : coefficients de durée."""
    parametre_ = ParametreGeneral.objects.filter(Cle=cle).first() if cle == CLE_COEFFICIENTS else None
    if not parametre_:
        return Response({"error": f"Réglage {cle} inconnu ou non modifiable ici."}, status=status.HTTP_404_NOT_FOUND)
    avant = parametre_.Valeur
    try:
        if request.data.get("Retablir"):
            parametre_.Valeur = parametre_.ValeurOrigine
        else:
            morceaux = [m.strip().replace(",", ".") for m in str(request.data.get("Valeur") or "").split("/")]
            try:
                nombres = [Decimal(m) for m in morceaux]
            except InvalidOperation as erreur:
                raise ErreurParametrage("Coefficients : treize pourcentages séparés par « / » attendus.") from erreur
            if len(nombres) != 13 or any(not 0 < n <= 100 for n in nombres) or nombres != sorted(nombres):
                raise ErreurParametrage("Coefficients : treize pourcentages croissants entre 0 et 100, séparés par « / » "
                                        "(15 jours ou moins, puis 1 à 12 mois).")
            parametre_.Valeur = "/".join(_pourcentage_texte(n) for n in nombres)
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    parametre_.ModifiePar = _auteur(request)
    parametre_.save()
    _cache.pop(cle, None)
    _journal(request, f"Automobile : « {parametre_.Libelle} » modifié", {"cle": cle, "avant": avant, "apres": parametre_.Valeur})
    return Response(_parametre_json(parametre_))


def duree_en_mois(date_effet, date_expiration):
    """Durée d'un contrat comptée comme les coefficients de prime (fn_calcul_taux_prime_fractionnee) : mois entiers
    entre l'effet et l'échéance, un mois entamé comptant pour un mois ; None au-delà d'un an."""
    from dateutil.relativedelta import relativedelta

    if not date_effet or not date_expiration or date_expiration < date_effet:
        return None
    ecart = relativedelta(date_expiration, date_effet)
    mois = ecart.years * 12 + ecart.months
    if mois > 12 or (mois == 12 and ecart.days > 0):
        return None
    return min(mois + (1 if ecart.days > 0 else 0), 12) or 1


def chercher_tarif_direct(id_compagnie, id_offre, id_tarif, id_energie, puissance, charge_utile, id_usage, date_effet, date_expiration):
    """Ligne d'un tarif à lecture directe applicable au véhicule ({grille, ligne, duree, annuelle}), ou None et le motif."""
    duree = duree_en_mois(date_effet, date_expiration)
    if duree is None:
        return None, "Durée du contrat hors des tarifs à lecture directe."
    categorie = _lignes("SELECT TRIM(codecategorie) AS c FROM stdtarif WHERE idtarif = %s", [id_tarif])
    categorie = categorie[0]["c"] if categorie else ""
    code_usage = _lignes("SELECT TRIM(codeusage) AS c FROM stdusage WHERE idusage = %s", [id_usage]) if id_usage else []
    code_usage = code_usage[0]["c"] if code_usage else ""
    grilles = [
        g for g in TarifAutoGrille.objects.filter(IdCompagnie=id_compagnie, Actif=True).prefetch_related("lignes")
        if str(id_offre) in _codes(g.Offres) and categorie in _codes(g.Categories)
        and (g.IdEnergie is None or g.IdEnergie == id_energie)
    ]
    if not grilles:
        return None, "Aucun tarif à lecture directe pour cette compagnie, cette offre et ce véhicule."
    for grille in grilles:
        valeur = puissance if grille.Critere == "PUISSANCE" else charge_utile
        lignes = list(grille.lignes.all())
        usages_cibles = {u for l in lignes for u in _codes(l.Usages)}

        def tranche(l, duree_, valeur=valeur, lignes_usages=usages_cibles):
            if l.DureeMois != duree_:
                return False
            # Usage visé par une ligne (tracteur routier) : cette ligne, quelle que soit la tranche
            if code_usage and code_usage in lignes_usages:
                return code_usage in _codes(l.Usages)
            return (not l.Usages and valeur is not None and l.BorneMin is not None and l.BorneMin <= valeur
                    and (l.BorneMax is None or valeur <= l.BorneMax))

        ligne = next((l for l in lignes if tranche(l, duree)), None)
        if ligne is None:
            continue
        annuelle = next((l for l in lignes if tranche(l, 12)), None)
        return {"grille": grille, "ligne": ligne, "duree": duree, "annuelle": annuelle}, ""
    return None, f"Véhicule ou durée ({duree} mois) absents du tarif à lecture directe."


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def tarif_direct(request):
    """POST /api/auto/tarif-direct/ {demande de /api/offregarantie} : primes du tarif à lecture directe applicable au
    véhicule (n'écrit rien). {Trouve: false, Motif} si l'offre, la durée ou le véhicule ne relèvent d'aucune grille."""
    d = request.data
    entier = lambda cle: int(_nombre(d.get(cle)) or 0)  # noqa: E731
    resultat, motif = chercher_tarif_direct(
        entier("IdCompagnie"), entier("IdOffre"), entier("IdTarif"), entier("CodeCarburant"),
        entier("Puissance"), entier("Tonnage"), entier("CodeUsage"), _date(d.get("DateEffet")), _date(d.get("DateExpiration")),
    )
    if not resultat:
        return Response({"Trouve": False, "Motif": motif})
    grille, ligne, annuelle = resultat["grille"], resultat["ligne"], resultat["annuelle"]
    compagnie = _lignes("SELECT raisonsociale AS n FROM stdcompagnie WHERE idcompagnie = %s", [grille.IdCompagnie])
    nom_compagnie = (compagnie[0]["n"] or "").strip() if compagnie else ""
    return Response({
        "Trouve": True, "IdGrille": grille.id, "Grille": grille.Libelle, "IdLigne": ligne.id, "Tranche": ligne.Libelle,
        "DureeMois": resultat["duree"], "Compagnie": nom_compagnie, "Source": grille.Source,
        "PrimeAnnuelle": float(annuelle.PrimeNette if annuelle else ligne.PrimeNette),
        **{m: float(getattr(ligne, m)) for m in MONTANTS_TARIF},
        "Message": f"Tarif {nom_compagnie} à lecture directe : {grille.Libelle}, {ligne.Libelle}, {resultat['duree']} mois",
    })


# ------------------------------------------------------------------ Montants du moteur (fn_lephare_auto_constante)
# Montants et taux écrits jusqu'ici dans les fonctions du moteur (fn_garantie_offre_cat*_nsia/amsa/sunu) :
# réglages auto.moteur.<compagnie>.<groupe>.<code>, valeur d'origine = montant de la fonction (production 0176).
PREFIXE_MOTEUR = "auto.moteur."
GROUPES_MOTEUR = [
    ("cat1", "Promenade et affaires, engins de chantier", "201, 212"),
    ("cat2", "Transport pour propre compte", "202"),
    ("cat3", "Transport public de marchandises", "203, 209"),
    ("cat5", "Deux et trois roues", "205"),
]


def _moteur_json(p):
    _, _, compagnie, groupe, code = p.Cle.split(".", 4)
    return {**_parametre_json(p), "IdCompagnie": int(compagnie), "GroupeMoteur": groupe, "Code": code}


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def moteur(request):
    """GET /api/parametrage/auto/moteur/ : montants et taux du moteur, par compagnie et groupe de catégories."""
    parametres = [_moteur_json(p) for p in ParametreGeneral.objects.filter(Cle__startswith=PREFIXE_MOTEUR).order_by("Ordre", "Cle")]
    ids = sorted({p["IdCompagnie"] for p in parametres})
    noms = dict(Compagnie.objects.filter(IdCompagnie__in=ids).values_list("IdCompagnie", "RaisonSociale"))
    return Response({
        "Compagnies": [{"IdCompagnie": i, "Nom": noms.get(i, f"Compagnie {i}")} for i in ids],
        "Groupes": [{"Code": c, "Libelle": l, "Categories": cat} for c, l, cat in GROUPES_MOTEUR],
        "Parametres": parametres,
    })


@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def moteur_parametre(request, cle):
    """PATCH /api/parametrage/auto/moteur/<cle>/ {Valeur} ou {Retablir: true}."""
    parametre_ = ParametreGeneral.objects.filter(Cle=cle, Cle__startswith=PREFIXE_MOTEUR).first()
    if not parametre_:
        return Response({"error": f"Réglage {cle} inconnu."}, status=status.HTTP_404_NOT_FOUND)
    avant = parametre_.Valeur
    try:
        parametre_.Valeur = parametre_.ValeurOrigine if request.data.get("Retablir") else _valider_parametre(parametre_, request.data.get("Valeur"))
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    parametre_.ModifiePar = _auteur(request)
    parametre_.save()
    _cache.pop(cle, None)
    _, _, compagnie, groupe, _ = cle.split(".", 4)
    nom = Compagnie.objects.filter(IdCompagnie=int(compagnie)).values_list("RaisonSociale", flat=True).first() or compagnie
    categories = dict((c, cat) for c, _, cat in GROUPES_MOTEUR).get(groupe, groupe)
    _journal(request, f"Moteur Automobile {nom} ({categories}) : « {parametre_.Libelle} » modifié",
             {"cle": cle, "avant": avant, "apres": parametre_.Valeur})
    return Response(_moteur_json(parametre_))
