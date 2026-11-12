"""
Réglages Santé MINENE dans l'admin : tout ce qui fixe le tarif et les imprimés MINENE SANTÉ.

- Formules (lephare_sante_formule, une par offre MINENE) : prime de base, taille de la famille, taux de
  couverture et plafonds du barème de soins. Lues par la base (fn_get_prime_base_minene_sante,
  fn_minene_personnes_max) et par le barème annexé aux conditions particulières.
- Paramètres sante.minene.* (lephare_parametre) : IA et RC chef de famille, surprimes et âges, délais
  de carence, suivi des remboursements, clause d'ajustement. Lus par la base
  (fn_lephare_parametre_nombre) et par les imprimés.
- Répartition de la prime (stdrepartitionprimesante) : parts NSIA, OREOLE (taux de commission du cabinet
  sur la Santé MINENE, fn_get_taux_commission_offre), VITALIS, ADEC et forfaits ADEC IA / RC.

Lecture pour tout utilisateur connecté, modification réservée aux administrateurs (droit tarifs.update),
chaque modification inscrite au journal d'audit.
"""

from decimal import Decimal, InvalidOperation

from django.db import connection, transaction
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from .models import ParametreGeneral, RepartitionPrimeSante, SanteFormuleMinene
from .parametrage import (
    ErreurParametrage,
    _auteur,
    _cache,
    _journal,
    _parametre_json,
    _reponse_erreur,
    _texte,
    _valider_parametre,
)
from .views_grilles_voyage import AUTHENTIFICATION, EstAdministrateur

PREFIXE = "sante.minene."

# (champ, libellé, type, minimum, maximum) ; type : texte (longueur max en maximum), entier, montant, pourcentage
CHAMPS_FORMULE = [
    ("Option", "Option", "texte", None, 40),
    ("Composition", "Composition de la famille", "texte", None, 200),
    ("PersonnesMin", "Personnes au moins", "entier", 1, 20),
    ("PersonnesMax", "Personnes au plus", "entier", 1, 20),
    ("PrimeBase", "Prime de base", "montant", 1, None),
    ("TauxSoinsExternes", "Taux soins externes", "pourcentage", 0, 100),
    ("TauxHospitalisation", "Taux hospitalisation", "pourcentage", 0, 100),
    ("ChambreParJour", "Chambre d'hospitalisation (par jour)", "montant", 0, None),
    ("AmbulanceParCas", "Ambulance / SAMU (par cas)", "montant", 0, None),
    ("AccouchementSimple", "Accouchement simple", "montant", 0, None),
    ("AccouchementGemellaire", "Accouchement gémellaire", "montant", 0, None),
    ("AccouchementChirurgical", "Accouchement par voie chirurgicale", "montant", 0, None),
    ("AccouchementHorsStructure", "Forfait accouchement hors structure privée", "montant", 0, None),
    ("OptiqueAdulte", "Optique adulte", "montant", 0, None),
    ("OptiqueEnfant", "Optique enfant", "montant", 0, None),
    ("DentaireParPersonne", "Soins et prothèses dentaires (par an et par personne)", "montant", 0, None),
    ("PlafondAnnuel", "Plafond annuel par famille", "montant", 1, None),
]

# Répartition de la prime Santé : (champ, libellé, nature)
CHAMPS_REPARTITION = [
    ("taux_frais_generaux_compagnie", "Frais généraux NSIA", "taux"),
    ("taux_commission_courtier", "Commission OREOLE ASSURANCES", "taux"),
    ("taux_honoraire_gestionnaire", "Honoraires de gestion VITALIS", "taux"),
    ("taux_frais_gestion_adec", "Frais de gestion ADEC", "taux"),
    ("taux_autres_frais_gestion", "Autres frais de gestion", "taux"),
    ("taux_commission_commerciaux", "Commission des commerciaux NSIA", "taux"),
    ("frais_gestion_adec_forfait_ia", "Frais de gestion ADEC - IA, par adhérent", "forfait"),
    ("frais_gestion_adec_forfait_rc", "Frais de gestion ADEC - RC chef de famille, par adhérent", "forfait"),
]


def _nombre(valeur):
    return None if valeur is None else float(valeur)


def _libelles_offres():
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT o.idoffre, o.libelleoffre, COALESCE(o.actif, FALSE), t.libelle
            FROM stdoffre o LEFT JOIN stdtarif t ON t.idtarif = o.idtarif
            WHERE o.idoffre IN (SELECT idoffre FROM lephare_sante_formule)
            """
        )
        return {ligne[0]: ligne[1:] for ligne in cursor.fetchall()}


def formule_json(formule, offres=None):
    libelle, actif, tarif = (offres or {}).get(formule.IdOffre, ("", True, ""))
    donnees = {"IdOffre": formule.IdOffre, "LibelleOffre": libelle, "OffreActive": bool(actif), "Tarif": tarif, "Ordre": formule.Ordre}
    for champ, _, type_, _, _ in CHAMPS_FORMULE:
        valeur = getattr(formule, champ)
        donnees[champ] = valeur if type_ in ("texte", "entier") else _nombre(valeur)
    donnees.update({
        "ModifiePar": formule.ModifiePar,
        "DateModification": formule.DateModification.isoformat() if formule.DateModification else None,
    })
    return donnees


def formules_pour_impression():
    """Formules lues par les imprimés (GET /api/parametrage/) ; liste vide si la table manque."""
    try:
        return [formule_json(f) for f in SanteFormuleMinene.objects.all()]
    except Exception:  # noqa: BLE001 — base sans la migration configuration_api 0083
        return []


def _repartition_json(r):
    donnees = {"Id": r.id, "Libelle": r.libelle, "AvecApporteur": r.avec_apporteur, "Actif": r.actif}
    for champ, _, _ in CHAMPS_REPARTITION:
        donnees[champ] = _nombre(getattr(r, champ))
    donnees["ProvisionSinistres"] = round(100 - sum(float(getattr(r, c) or 0) for c, _, n in CHAMPS_REPARTITION if n == "taux"), 2)
    donnees["DateModification"] = r.date_modification.isoformat() if r.date_modification else None
    return donnees


def _decimal(valeur, libelle, minimum=None, maximum=None, vide_permis=False):
    if valeur is None or str(valeur).strip() == "":
        if vide_permis:
            return None
        raise ErreurParametrage(f"{libelle} : valeur à renseigner.")
    try:
        nombre = Decimal(str(valeur).replace(" ", "").replace(",", "."))
    except InvalidOperation as erreur:
        raise ErreurParametrage(f"{libelle} : nombre attendu.") from erreur
    if minimum is not None and nombre < minimum:
        raise ErreurParametrage(f"{libelle} : {minimum} au minimum.")
    if maximum is not None and nombre > maximum:
        raise ErreurParametrage(f"{libelle} : {maximum} au maximum.")
    return nombre


# ------------------------------------------------------------------ lecture
@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def sante(request):
    """GET /api/parametrage/sante/ : formules, paramètres MINENE et répartition de la prime."""
    offres = _libelles_offres()
    return Response({
        "Formules": [formule_json(f, offres) for f in SanteFormuleMinene.objects.all()],
        "Parametres": [_parametre_json(p) for p in ParametreGeneral.objects.filter(Cle__startswith=PREFIXE)],
        "Repartitions": [_repartition_json(r) for r in RepartitionPrimeSante.objects.order_by("avec_apporteur", "id")],
    })


# ------------------------------------------------------------------ modifications
@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def formule(request, id_offre):
    """PATCH /api/parametrage/sante/formules/<id_offre>/ : champs de CHAMPS_FORMULE."""
    try:
        ligne = SanteFormuleMinene.objects.get(IdOffre=id_offre)
    except SanteFormuleMinene.DoesNotExist:
        return Response({"error": f"Formule {id_offre} introuvable."}, status=status.HTTP_404_NOT_FOUND)
    offres = _libelles_offres()
    avant = formule_json(ligne, offres)
    try:
        for champ, libelle, type_, minimum, maximum in CHAMPS_FORMULE:
            if champ not in request.data:
                continue
            valeur = request.data[champ]
            if type_ == "texte":
                valeur = _texte(valeur, maximum, libelle, obligatoire=(champ == "Option"))
            elif type_ == "entier":
                nombre = _decimal(valeur, libelle, minimum, maximum)
                if nombre != nombre.to_integral_value():
                    raise ErreurParametrage(f"{libelle} : nombre entier attendu.")
                valeur = int(nombre)
            else:
                valeur = _decimal(valeur, libelle, minimum, maximum)
            setattr(ligne, champ, valeur)
        if ligne.PersonnesMin > ligne.PersonnesMax:
            raise ErreurParametrage("Le nombre de personnes au moins doit être inférieur ou égal au nombre au plus.")
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    ligne.ModifiePar = _auteur(request)
    ligne.save()
    apres = formule_json(ligne, offres)
    _journal(request, f"Formule MINENE « {apres['LibelleOffre'] or id_offre} » modifiée", {"avant": avant, "apres": apres})
    return Response(apres)


@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def parametre(request, cle):
    """PATCH /api/parametrage/sante/parametres/<cle>/ {Valeur} ou {Retablir: true} (clés sante.minene.*)."""
    parametre_ = ParametreGeneral.objects.filter(Cle=cle, Cle__startswith=PREFIXE).first()
    if not parametre_:
        return Response({"error": f"Réglage {cle} inconnu."}, status=status.HTTP_404_NOT_FOUND)
    avant = parametre_.Valeur
    try:
        parametre_.Valeur = parametre_.ValeurOrigine if request.data.get("Retablir") else _valider_parametre(parametre_, request.data.get("Valeur"))
        _controler_coherence(cle, parametre_.Valeur)
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    parametre_.ModifiePar = _auteur(request)
    parametre_.save()
    _cache.pop(cle, None)
    _journal(request, f"Réglage Santé MINENE « {parametre_.Libelle} » modifié", {"cle": cle, "avant": avant, "apres": parametre_.Valeur})
    return Response(_parametre_json(parametre_))


def _valeur(cle, defaut):
    p = ParametreGeneral.objects.filter(Cle=cle).first()
    try:
        return Decimal(str(p.Valeur).replace(",", ".")) if p and str(p.Valeur).strip() else Decimal(defaut)
    except InvalidOperation:
        return Decimal(defaut)


def _controler_coherence(cle, valeur):
    """Tranches d'âge et franchise : l'ordre des bornes doit rester cohérent avec les autres réglages."""
    bornes = {
        # clé : (clé qui doit être inférieure ou égale, clé qui doit être supérieure ou égale, défauts)
        "sante.minene.surprime_age_1_debut": (None, "sante.minene.surprime_age_2_debut"),
        "sante.minene.surprime_age_2_debut": ("sante.minene.surprime_age_1_debut", "sante.minene.age_max_adulte"),
        "sante.minene.age_max_adulte": ("sante.minene.surprime_age_2_debut", None),
        "sante.minene.age_max_enfant": (None, "sante.minene.age_max_enfant_certificat"),
        "sante.minene.age_max_enfant_certificat": ("sante.minene.age_max_enfant", None),
        "sante.minene.rc_franchise_minimum": (None, "sante.minene.rc_franchise_maximum"),
        "sante.minene.rc_franchise_maximum": ("sante.minene.rc_franchise_minimum", None),
    }
    if cle not in bornes:
        return
    defauts = {
        "sante.minene.surprime_age_1_debut": 61, "sante.minene.surprime_age_2_debut": 65, "sante.minene.age_max_adulte": 69,
        "sante.minene.age_max_enfant": 21, "sante.minene.age_max_enfant_certificat": 25,
        "sante.minene.rc_franchise_minimum": 20000, "sante.minene.rc_franchise_maximum": 200000,
    }
    nombre = Decimal(str(valeur))
    inferieure, superieure = bornes[cle]
    if inferieure and nombre < _valeur(inferieure, defauts[inferieure]):
        libelle = ParametreGeneral.objects.get(Cle=inferieure).Libelle
        raise ErreurParametrage(f"Valeur inférieure à « {libelle} » ({_valeur(inferieure, defauts[inferieure]):f}).")
    if superieure and nombre > _valeur(superieure, defauts[superieure]):
        libelle = ParametreGeneral.objects.get(Cle=superieure).Libelle
        raise ErreurParametrage(f"Valeur supérieure à « {libelle} » ({_valeur(superieure, defauts[superieure]):f}).")


@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def repartition(request, id_repartition):
    """PATCH /api/parametrage/sante/repartitions/<id>/ : taux (% de la prime HT) et forfaits ADEC."""
    try:
        ligne = RepartitionPrimeSante.objects.get(pk=id_repartition)
    except RepartitionPrimeSante.DoesNotExist:
        return Response({"error": f"Répartition {id_repartition} introuvable."}, status=status.HTTP_404_NOT_FOUND)
    avant = _repartition_json(ligne)
    try:
        if "Libelle" in request.data:
            ligne.libelle = _texte(request.data["Libelle"], 150, "Libellé", obligatoire=True)
        for champ, libelle, nature in CHAMPS_REPARTITION:
            if champ not in request.data:
                continue
            if nature == "taux":
                # Parts propres à une variante (ADEC et autres frais sans apporteur, commerciaux avec) : vides permises
                setattr(ligne, champ, _decimal(request.data[champ], libelle, Decimal(0), Decimal(100),
                                               vide_permis=champ not in ("taux_frais_generaux_compagnie", "taux_commission_courtier", "taux_honoraire_gestionnaire")))
            else:
                setattr(ligne, champ, _decimal(request.data[champ], libelle, Decimal(0)))
        total = sum((getattr(ligne, c) or Decimal(0)) for c, _, n in CHAMPS_REPARTITION if n == "taux")
        if total > 100:
            raise ErreurParametrage(f"Les parts dépassent la prime : {total:f} % (100 % au plus, le reste constitue la provision pour sinistres).")
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    with transaction.atomic():
        ligne.save()
    apres = _repartition_json(ligne)
    _journal(request, f"Répartition de la prime Santé « {ligne.libelle} » modifiée", {"avant": avant, "apres": apres})
    return Response(apres)
