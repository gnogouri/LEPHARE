"""
Restauration d'un élément archivé, page Archives (demande du 2026-11-05) : droit archives.restore, contrôlé et journalisé par la garde.

POST /api/archives/<client|sinistre>/<id>/restauration/. Le devis garde sa route (POST /api/desarchivagedevis). Les contrats n'ont pas
d'archivage en base : leur archivage reste propre au navigateur.
"""

from django.db import IntegrityError, connection, transaction
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from institutionnel.models import SinistreDelegue

from .renouvellement import AUTHENTIFICATION

STATUT_CLIENT_ARCHIVE, STATUT_CLIENT_ACTIF = "A", "V"
STATUTS_SINISTRE_ARCHIVE = ("Archivé", "Archivé / Sans suite")
STATUT_SINISTRE_RESTAURE = "En cours d'instruction"


def _erreur(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": message}, status=code)


def _restaurer_client(pk):
    """Le client restauré revient dans la liste des clients (statut autre que « A ») : avec son statut d'avant l'archivage s'il est connu,
    sinon « V ». Sa clé anti-doublon est recalculée par trg_clients_cle_unique ; si une autre fiche porte déjà la même identité (même CNI,
    ou mêmes nom, prénoms et naissance), la fiche restaurée reçoit une clé propre à son identifiant, comme à l'émission d'un contrat sur une
    fiche archivée (customer 0017), au lieu d'être refusée (demande du 2026-11-09 : « les clients restaurés vont dans la liste »)."""
    with connection.cursor() as cursor:
        cursor.execute("""SELECT c.statut, n.statut_avant FROM stdclient c LEFT JOIN lephare_client_nettoyage n ON n.idclient = c.idclient
                          WHERE c.idclient = %s""", [pk])
        ligne = cursor.fetchone()
        if not ligne:
            return _erreur("Client introuvable.", status.HTTP_404_NOT_FOUND)
        if (ligne[0] or "").strip() != STATUT_CLIENT_ARCHIVE:
            return _erreur("Ce client n'est pas archivé.")
        statut = (ligne[1] or "").strip()
        statut = statut if statut and statut != STATUT_CLIENT_ARCHIVE else STATUT_CLIENT_ACTIF
        message = "Il figure de nouveau dans la liste des clients."
        try:
            # Point de sauvegarde : une clé déjà prise n'interrompt pas la transaction de la requête
            with transaction.atomic():
                cursor.execute("UPDATE stdclient SET statut = %s WHERE idclient = %s", [statut, pk])
        except IntegrityError:
            with transaction.atomic():
                cursor.execute("UPDATE stdclient SET statut = %s, cle_unique = 'CLIENT-' || idclient WHERE idclient = %s", [statut, pk])
            message += (" Une autre fiche porte la même identité (CNI, ou nom, prénoms et date de naissance) : vérifiez s'il s'agit de la même "
                        "personne avant d'établir un devis.")
    return Response({"Type": "client", "Id": pk, "Message": message})


def _restaurer_sinistre(pk):
    sinistre = SinistreDelegue.objects.filter(pk=pk).first()
    if not sinistre:
        return _erreur("Sinistre introuvable.", status.HTTP_404_NOT_FOUND)
    if sinistre.statut not in STATUTS_SINISTRE_ARCHIVE:
        return _erreur("Ce sinistre n'est pas archivé.")
    SinistreDelegue.objects.filter(pk=pk).update(statut=STATUT_SINISTRE_RESTAURE)
    return Response({"Type": "sinistre", "Id": pk, "Message": "Sinistre restauré."})


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def restauration(request, type_objet, pk):
    if type_objet == "client":
        return _restaurer_client(pk)
    if type_objet == "sinistre":
        return _restaurer_sinistre(pk)
    return _erreur("Type d'élément à restaurer inconnu.")
