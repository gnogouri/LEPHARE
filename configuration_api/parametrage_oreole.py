"""
Réglages Oreole Santé dans l'admin : prix, décomposition et barème de chaque offre (lephare_oreole_offre), réglages oreole.*
(honoraires, compagnies, carte d'assurance, surprimes, carences). Lecture pour tout utilisateur connecté, modification avec le
droit tarifs.update, chaque modification inscrite au journal d'audit.
"""
from decimal import Decimal

from django.db import connection
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from .models import ParametreGeneral
from .parametrage import ErreurParametrage, _auteur, _cache, _journal, _parametre_json, _reponse_erreur, _texte, _valider_parametre
from .parametrage_sante import _decimal
from .views_grilles_voyage import AUTHENTIFICATION, EstAdministrateur

PREFIXE = "oreole."

# (champ JSON, colonne, libellé, type, minimum, maximum)
CHAMPS_OFFRE = [
    ("Libelle", "libelle", "Libellé", "texte", None, 80),
    ("Cotisation", "cotisation", "Cotisation", "montant", 1, None),
    ("PrimeHt", "primeht", "Prime HT", "montant", 0, None),
    ("Accessoires", "accessoires", "Accessoires", "montant", 0, None),
    ("PartIA", "partia", "Part IA", "montant", 0, None),
    ("PartAFA", "partafa", "Part AFA", "montant", 0, None),
    ("CapitalIA", "capitalia", "Capital IA", "montant", 0, None),
    ("CapitalAFA", "capitalafa", "Capital AFA", "montant", 0, None),
    ("EnfantSupplementaire", "enfantsupplementaire", "Enfant à partir du 5e", "montant", 0, None),
    ("SoinsExternes", "tauxsoinsexternes", "Soins externes", "pourcentage", 0, 100),
    ("Hospitalisation", "tauxhospitalisation", "Hospitalisation", "pourcentage", 0, 100),
    ("Chambre", "chambreparjour", "Chambre par jour", "montant", 0, None),
    ("Ambulance", "ambulanceparcas", "Ambulance par cas", "montant", 0, None),
    ("AccouchementSimple", "accouchementsimple", "Accouchement simple", "montant", 0, None),
    ("AccouchementGemellaire", "accouchementgemellaire", "Accouchement gémellaire", "montant", 0, None),
    ("AccouchementChirurgical", "accouchementchirurgical", "Accouchement chirurgical", "montant", 0, None),
    ("AccouchementHorsStructure", "accouchementhorsstructure", "Hors structure privée", "montant", 0, None),
    ("OptiqueAdulte", "optiqueadulte", "Optique adulte", "montant", 0, None),
    ("OptiqueEnfant", "optiqueenfant", "Optique enfant", "montant", 0, None),
    ("Dentaire", "dentaireparpersonne", "Dentaire par personne", "montant", 0, None),
    ("Plafond", "plafondannuel", "Plafond annuel", "montant", 1, None),
    ("Reseau", "reseau", "Réseau de soins", "texte", None, 20),
]


def _offres():
    from sante.oreole import offre_json, offres_oreole

    with connection.cursor() as cursor:
        return [offre_json(o) for o in offres_oreole(cursor).values()]


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def oreole(request):
    """GET /api/parametrage/oreole/ : offres, réglages, compagnies proposées."""
    with connection.cursor() as cursor:
        cursor.execute(
            """SELECT c.idcompagnie, TRIM(c.raisonsociale) FROM stdcompagnie c
               JOIN stdintermediairecompagnie i ON i.idcompagnie = c.idcompagnie AND i.idintermediaire = 1
               WHERE COALESCE(c.active, TRUE) ORDER BY 2""")
        compagnies = [{"IdCompagnie": l[0], "Libelle": l[1]} for l in cursor.fetchall()]
    return Response({
        "Offres": _offres(),
        "Parametres": [_parametre_json(p) for p in ParametreGeneral.objects.filter(Cle__startswith=PREFIXE).order_by("Ordre")],
        "Compagnies": compagnies,
    })


@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def offre(request, id_offre):
    """PATCH /api/parametrage/oreole/offres/<id_offre>/ : champs de CHAMPS_OFFRE, Actif."""
    modifications, journal = {}, {}
    try:
        for champ, colonne, libelle, type_, minimum, maximum in CHAMPS_OFFRE:
            if champ not in request.data:
                continue
            if type_ == "texte":
                valeur = _texte(request.data[champ], maximum, libelle, obligatoire=(champ == "Libelle"))
            else:
                valeur = _decimal(request.data[champ], libelle, Decimal(minimum) if minimum is not None else None,
                                  Decimal(maximum) if maximum is not None else None)
            modifications[colonne] = valeur
            journal[champ] = str(valeur)
        if "Actif" in request.data:
            modifications["actif"] = request.data["Actif"] in (True, "true", "1", 1)
            journal["Actif"] = modifications["actif"]
    except ErreurParametrage as erreur:
        return _reponse_erreur(erreur)
    with connection.cursor() as cursor:
        cursor.execute("SELECT cotisation, primeht, accessoires, partia, partafa FROM lephare_oreole_offre WHERE idoffre = %s", [id_offre])
        ligne = cursor.fetchone()
        if not ligne:
            return Response({"error": f"Offre {id_offre} introuvable."}, status=status.HTTP_404_NOT_FOUND)
        cotisation, prime_ht, accessoires, part_ia, part_afa = (modifications.get(c, v) for c, v in zip(("cotisation", "primeht", "accessoires", "partia", "partafa"), ligne))
        if prime_ht + accessoires + part_ia + part_afa > cotisation:
            return Response({"error": "La cotisation doit couvrir la prime HT, les accessoires et les parts IA et AFA."}, status=status.HTTP_400_BAD_REQUEST)
        if modifications:
            colonnes = ", ".join(f"{c} = %s" for c in modifications)
            cursor.execute(f"UPDATE lephare_oreole_offre SET {colonnes}, datemodification = now(), modifiepar = %s WHERE idoffre = %s",
                           [*modifications.values(), _auteur(request), id_offre])
    _journal(request, f"Offre Oreole Santé n° {id_offre} modifiée", journal)
    return Response(next(o for o in _offres() if o["IdOffre"] == id_offre))


@api_view(["PATCH"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def parametre(request, cle):
    """PATCH /api/parametrage/oreole/parametres/<cle>/ {Valeur} ou {Retablir: true} (clés oreole.*)."""
    parametre_ = ParametreGeneral.objects.filter(Cle=cle, Cle__startswith=PREFIXE).first()
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
    _journal(request, f"Réglage Oreole Santé « {parametre_.Libelle} » modifié", {"cle": cle, "avant": avant, "apres": parametre_.Valeur})
    return Response(_parametre_json(parametre_))
