"""
Réglages Vie dans l'admin (Réglages par branche > Vie) : offres commerciales proposées en liste déroulante à la saisie
d'un devis Vie (demande du 2026-11-10 : AFA, Retraite complémentaire, Temporaire décès…), table lephare_vie_offre de la
migration production 0219 (production/vie_offres.py).

Pour chaque offre : libellé de la liste, formulaire de saisie (assurés avec capital et prime, ou cotisations salarié et
employeur), périodicité (Mensuelle : un état par mois, du 1er au dernier jour), sous-garantie portée par les lignes du
devis, description affichée sous la liste, ordre et activation. Une offre déjà utilisée n'est jamais supprimée : elle se
désactive (les devis qui la portent la gardent).

GET  /api/parametrage/vie/offres/            offres (actives et inactives), formulaires, périodicités, sous-garanties Vie
POST /api/parametrage/vie/offres/            nouvelle offre
PUT  /api/parametrage/vie/offres/<id>/       offre modifiée
DELETE /api/parametrage/vie/offres/<id>/     offre jamais utilisée supprimée
Lecture pour tout utilisateur connecté, écriture selon le droit tarifs.update (autorisations/garde.py), journal d'audit.
"""

import re
import unicodedata

from django.db import connection, transaction
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from production import vie_offres

from .parametrage import ErreurParametrage, _auteur, _journal, _reponse_erreur, _texte
from .views_grilles_voyage import AUTHENTIFICATION, EstAdministrateur

MOTIF_GARANTIES_VIE = r"(DECES|RENTE|CAPITAL A TERME|CARRIERE|RETRAITE|EPARGNE|OBSEQUE|INVALIDITE|PREVOYANCE)"


def _garanties(cursor):
    """Sous-garanties proposées pour une offre Vie : décès, rente et capital à terme, fin de carrière… et celles déjà retenues."""
    cursor.execute(
        """SELECT idsousgarantie, TRIM(libellesousgarantie) FROM stdsousgarantie
           WHERE idgarantie = 17 OR idsousgarantie IN (SELECT idgarantie FROM lephare_vie_offre)
              OR translate(UPPER(libellesousgarantie), 'ÉÈÊËÀÂÎÏÔÛÙÇ', 'EEEEAAIIOUUC') ~ %s
           ORDER BY 2""",
        [MOTIF_GARANTIES_VIE],
    )
    return [{"IdGarantie": i, "Libelle": l} for i, l in cursor.fetchall()]


def _utilisations(cursor):
    cursor.execute("SELECT idoffre, COUNT(*) FROM lephare_vie_devis GROUP BY 1")
    return dict(cursor.fetchall())


def _liste(cursor):
    utilisations = _utilisations(cursor)
    return [o | {"Devis": utilisations.get(o["IdOffre"], 0)} for o in vie_offres.offres(cursor, actives_seulement=False)]


def _code(cursor, libelle, id_offre=0):
    """Code stable d'une nouvelle offre tiré de son libellé (RETRAITE_COMPLEMENTAIRE), rendu unique si besoin."""
    base = unicodedata.normalize("NFD", libelle).encode("ascii", "ignore").decode().upper()
    base = re.sub(r"[^A-Z0-9]+", "_", base).strip("_")[:26] or "OFFRE"
    code, rang = base, 1
    while True:
        cursor.execute("SELECT 1 FROM lephare_vie_offre WHERE code = %s AND idoffre <> %s", [code, id_offre])
        if not cursor.fetchone():
            return code
        rang += 1
        code = f"{base}_{rang}"


def _saisie(cursor, donnees, id_offre=0):
    libelle = _texte(donnees.get("Libelle"), 100, "Libellé", obligatoire=True)
    if "(" in libelle or ")" in libelle:
        raise ErreurParametrage("Libellé : sans parenthèses, il apparaît tel quel dans la liste déroulante.")
    cursor.execute("SELECT 1 FROM lephare_vie_offre WHERE UPPER(TRIM(libelle)) = UPPER(%s) AND idoffre <> %s", [libelle, id_offre])
    if cursor.fetchone():
        raise ErreurParametrage(f"Une offre « {libelle} » existe déjà.")
    saisie = str(donnees.get("Saisie") or "").strip().upper()
    if saisie not in vie_offres.SAISIES:
        raise ErreurParametrage("Formulaire de saisie : assurés avec capital et prime, ou cotisations salarié et employeur.")
    periodicite = str(donnees.get("Periodicite") or "").strip().upper()
    if periodicite not in vie_offres.PERIODICITES:
        raise ErreurParametrage("Périodicité : annuelle, semestrielle, trimestrielle ou mensuelle.")
    try:
        id_garantie = int(donnees.get("IdGarantie") or 0)
        ordre = int(donnees.get("Ordre") or 0)
    except (TypeError, ValueError) as erreur:
        raise ErreurParametrage("Garantie et ordre : nombres attendus.") from erreur
    cursor.execute("SELECT 1 FROM stdsousgarantie WHERE idsousgarantie = %s", [id_garantie])
    if not cursor.fetchone():
        raise ErreurParametrage("Choisissez la garantie portée par les lignes du devis.")
    if not 0 <= ordre <= 999:
        raise ErreurParametrage("Ordre : entre 0 et 999.")
    return {"Libelle": libelle, "Saisie": saisie, "Periodicite": periodicite, "IdGarantie": id_garantie, "Ordre": ordre,
            "Description": _texte(donnees.get("Description"), 500, "Description"), "Actif": bool(donnees.get("Actif", True))}


def _reponse(cursor, **extra):
    return Response({"Offres": _liste(cursor), "Garanties": _garanties(cursor), "Reglable": True,
                     "Saisies": [{"Code": c, "Libelle": l} for c, l in vie_offres.SAISIES.items()],
                     "Periodicites": [{"Code": c, "Libelle": l} for c, l in vie_offres.PERIODICITES.items()]} | extra)


def _sans_migration():
    return Response({"error": f"Offres Vie non réglables : la migration {vie_offres.MIGRATION} n'est pas appliquée sur cette base."},
                    status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def offres(request):
    with connection.cursor() as cursor:
        if not vie_offres.tables_presentes(cursor):
            if request.method == "GET":
                return Response({"Offres": vie_offres.offres(cursor), "Garanties": [], "Saisies": [], "Periodicites": [], "Reglable": False,
                                 "Message": f"Migration {vie_offres.MIGRATION} à appliquer : seule l'offre AFA est proposée."})
            return _sans_migration()
        if request.method == "GET":
            return _reponse(cursor)
        try:
            offre = _saisie(cursor, request.data)
        except ErreurParametrage as erreur:
            return _reponse_erreur(erreur)
        with transaction.atomic():
            cursor.execute(
                """INSERT INTO lephare_vie_offre (code, libelle, saisie, periodicite, idgarantie, description, actif, ordre, modifie_par)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING idoffre""",
                [_code(cursor, offre["Libelle"]), offre["Libelle"], offre["Saisie"], offre["Periodicite"], offre["IdGarantie"],
                 offre["Description"], offre["Actif"], offre["Ordre"], _auteur(request)],
            )
            id_offre = cursor.fetchone()[0]
        apres = vie_offres.offre_par_id(cursor, id_offre)
        _journal(request, f"Offre Vie « {offre['Libelle']} » créée", {"avant": None, "apres": apres})
        return _reponse(cursor, Offre=apres)


@api_view(["PUT", "DELETE"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EstAdministrateur])
def offre(request, id_offre):
    with connection.cursor() as cursor:
        if not vie_offres.tables_presentes(cursor):
            return _sans_migration()
        avant = vie_offres.offre_par_id(cursor, id_offre)
        if not avant:
            return Response({"error": f"Offre Vie n° {id_offre} introuvable."}, status=status.HTTP_404_NOT_FOUND)
        utilisations = _utilisations(cursor).get(id_offre, 0)
        if request.method == "DELETE":
            if utilisations:
                return _reponse_erreur(ErreurParametrage(f"L'offre « {avant['Libelle']} » porte {utilisations} devis : désactivez-la plutôt."))
            if avant["Actif"] and len(vie_offres.offres(cursor)) <= 1:
                return _reponse_erreur(ErreurParametrage("Gardez au moins une offre proposée à la saisie."))
            cursor.execute("DELETE FROM lephare_vie_offre WHERE idoffre = %s", [id_offre])
            _journal(request, f"Offre Vie « {avant['Libelle']} » supprimée", {"avant": avant, "apres": None})
            return _reponse(cursor)
        try:
            offre_saisie = _saisie(cursor, request.data, id_offre)
            if utilisations and offre_saisie["Saisie"] != avant["Saisie"]:
                raise ErreurParametrage(f"L'offre porte déjà {utilisations} devis : son formulaire de saisie ne peut plus changer "
                                        "(créez une autre offre).")
            if avant["Actif"] and not offre_saisie["Actif"] and len(vie_offres.offres(cursor)) <= 1:
                raise ErreurParametrage("Gardez au moins une offre proposée à la saisie.")
        except ErreurParametrage as erreur:
            return _reponse_erreur(erreur)
        cursor.execute(
            """UPDATE lephare_vie_offre SET libelle = %s, saisie = %s, periodicite = %s, idgarantie = %s, description = %s, actif = %s,
                   ordre = %s, modifie_par = %s, date_modification = now() WHERE idoffre = %s""",
            [offre_saisie["Libelle"], offre_saisie["Saisie"], offre_saisie["Periodicite"], offre_saisie["IdGarantie"],
             offre_saisie["Description"], offre_saisie["Actif"], offre_saisie["Ordre"], _auteur(request), id_offre],
        )
        apres = vie_offres.offre_par_id(cursor, id_offre)
        _journal(request, f"Offre Vie « {apres['Libelle']} » modifiée", {"avant": avant, "apres": apres})
        return _reponse(cursor, Offre=apres)
