from django.http.response import JsonResponse

from rest_framework import viewsets, filters
from rest_framework import permissions
from rest_framework.views import APIView
from rest_framework import status

from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from configuration_api.models import Profession, Qualite, SecteurActivite, Ville
from .activite import annotations_activite, dernieres_operations, dossier_client, synthese_commerciale
from .serializers import ClientSerializer
from .models import Client
from django.db.models import Q
import re
import phonenumbers as pn
from core.views import ResultsOnlyPagination


def valid_email_address(email):
    regex = r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b"
    return re.fullmatch(regex, email)


def valid_phone_number(phone_candidate):
    national_number = ""
    try:
        z = pn.parse(phone_candidate, "CI")
    except pn.phonenumberutil.NumberParseException as error:
        national_number = ""
    else:
        if pn.is_valid_number(z):
            national_number = z.national_number
    return national_number


def identite_client(client):
    """Identité du client avec les libellés des référentiels (jamais leurs identifiants)."""

    def libelle(modele, identifiant):
        if not identifiant:
            return ""
        return modele.objects.filter(pk=identifiant).values_list("Libelle", flat=True).first() or ""

    # Même règle que l'écran (normalizeClient) : « F » ou « 0 » = personne morale
    entreprise = client.Particulier in ("F", "0")
    return {
        "id": client.IdClient,
        "entreprise": entreprise,
        "nom": (client.Nom or "").strip(),
        "prenoms": (client.Prenoms or "").strip(),
        "matricule": client.Matricule or client.numero_assure or "",
        "categorie": getattr(client.idtypeclient, "libelle_type", "") or "",
        "vip": client.Vip == "V",
        "civilite": libelle(Qualite, client.IdQualite),
        "piece_identite": client.CniPat or "",
        "date_naissance": client.DateNaissance,
        "lieu_naissance": client.LieuNaissance or "",
        "telephone": client.Telephone or "",
        "mobile": client.Mobile or "",
        "fixe": client.Fixe or "",
        "fax": client.Fax or "",
        "email": client.Email or "",
        "adresse": client.Adresse1 or "",
        "adresse_complement": client.Adresse2 or "",
        "ville": libelle(Ville, client.IdVille),
        "code_postal": client.CodePostal or "",
        "profession": libelle(Profession, client.IdProfession),
        "secteur_activite": libelle(SecteurActivite, client.IdSecteurActivite),
        "responsable": client.Responsable or "",
        "fonction": client.Fonction or "",
        # Valeur par défaut du modèle quand aucun compte n'a été attribué
        "numero_compte": "" if client.NumeroCompte in (None, "", "XXXXXXX") else client.NumeroCompte,
        "rib": client.Rib or "",
        "exonere_taxes": bool(client.ExonereDeTaxes),
        "exonere_accessoires": bool(client.ExonereDeAccess),
    }


class ClientViewSet(viewsets.ModelViewSet):
    queryset = Client.objects.filter(~Q(IdClient=0)).order_by("Nom", "Prenoms")
    serializer_class = ClientSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["Nom", "Prenoms"]
    pagination_class = ResultsOnlyPagination
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Répertoire des clients : devis en cours, polices en vigueur et total des primes de
        # chaque client, calculés dans la même requête que la liste (voir activite.py)
        return super().get_queryset().annotate(**annotations_activite())

    @action(detail=True, methods=["get"], url_path="fiche")
    def fiche(self, request, pk=None):
        """Données de la fiche client imprimable : identité avec les libellés des
        référentiels (jamais leurs identifiants), synthèse commerciale et dernières opérations."""
        client = get_object_or_404(Client.objects.select_related("idtypeclient"), pk=pk)
        return Response(
            {
                "client": identite_client(client),
                "synthese": synthese_commerciale(client),
                "operations": dernieres_operations(client),
            }
        )

    @action(detail=True, methods=["get"], url_path="dossier")
    def dossier(self, request, pk=None):
        """Dossier 360° du client en une requête : identité, synthèse commerciale, tous ses
        devis en cours et toutes les émissions de ses contrats (filtrés en base par idclient)."""
        client = get_object_or_404(Client.objects.select_related("idtypeclient"), pk=pk)
        return Response(
            {
                "client": identite_client(client),
                "synthese": synthese_commerciale(client),
                **dossier_client(client),
            }
        )


class ClientRestreintViewSet(viewsets.ModelViewSet):
    queryset = Client.objects.filter(~Q(IdClient=0)).order_by("Nom", "Prenoms")[:5000]
    serializer_class = ClientSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["Nom", "Prenoms"]
    pagination_class = ResultsOnlyPagination
    permission_classes = [permissions.IsAuthenticated]


class ClientRechercheView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, champrecherche):
        criteria = str(champrecherche).strip()
        if valid_email_address(criteria):
            clientrecherche = Client.objects.filter(Q(Email=criteria) & ~Q(IdClient=0))
        else:
            phone_number_part = valid_phone_number(criteria)
            if phone_number_part:
                clientrecherche = Client.objects.filter(
                    (
                        Q(Mobile__contains=phone_number_part)
                        | Q(Telephone__contains=phone_number_part)
                        | Q(Fixe__contains=phone_number_part)
                    )
                    & ~Q(IdClient=0)
                )
            else:
                clientrecherche = Client.objects.filter(
                    Q(Nom__icontains=criteria) & ~Q(IdClient=0)
                )
        if clientrecherche:
            clientrecherche = clientrecherche.order_by("Nom", "Prenoms")

        serializer = ClientSerializer(clientrecherche, many=True)

        return JsonResponse(serializer.data, status=status.HTTP_200_OK, safe=False)
