from django.db import connection
from django.db.models import Count, F, Q, Subquery
from django.http.response import JsonResponse
from django_celery_beat.models import (
    ClockedSchedule,
    CrontabSchedule,
    IntervalSchedule,
    PeriodicTask,
    SolarSchedule,
)
from institutionnel.authentication import KnoxOrDemoTokenAuthentication
from rest_framework import permissions, status, viewsets
from rest_framework.authentication import BasicAuthentication
from rest_framework.decorators import (
    action,
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .parametrage import JournalModificationsMixin
from autorisations.permissions import DroitDeLaRoute
from .models import (
    Accessoire,
    AccessoireCourtierParCompagnie,
    Acte,
    AssistanceAutomobile,
    Avenant,
    AvenantProduit,
    Banque,
    Branche,
    Carrosserie,
    Categorie,
    CategoriePermis,
    CollegeSante,
    Commission,
    CommissionProduit,
    Commune,
    Compagnie,
    Continent,
    DelaiAvisEcheance,
    DomaineActiviteRC,
    Energie,
    FormuleSecuriteRoutiere,
    Garantie,
    GarantieRisque,
    GenreVehicule,
    GroupeUtilisateur,
    Intermediaire,
    LienJuridiqueSante,
    Marque,
    Menu,
    MenuParent,
    ModeEncaissement,
    ModeleVehicule,
    Offre,
    OffreAutomobileBoisee,
    OffreCollegeSante,
    OffreDetail,
    OffreGarantie,
    ParametreSite,
    Pays,
    Produit,
    Profession,
    ProfessionIa,
    Qualite,
    QualiteAyantDroit,
    QualiteSouscripteurMrh,
    ReductionFlotte,
    RepartitionPrimeSante,
    StatutJuridique,
    Apporteur,
    Region,
    Risque,
    SecteurActivite,
    SousGarantie,
    SystemeSecurite,
    Tarif,
    TarifDetail,
    TauxTaxeGarantieProduit,
    TypeAssure,
    TypeContratSante,
    TypeReduction,
    TypeSouscripteur,
    TypeVehicule,
    UsageVehicule,
    Utilisateur,
    Ville,
    ZoneCouvertureSante,
    ZoneVoyage,
)
from .serializers import (
    AccessoireCourtierParCompagnieSerializer,
    AccessoireSerializer,
    ActeSerializer,
    AssistanceAutomobileSerializer,
    AvenantSerializer,
    BanqueSerializer,
    BrancheSerializer,
    CarrosserieSerializer,
    CategoriePermisSerializer,
    CategorieSerializer,
    ClockedScheduleSerializer,
    CollegeSanteSerializer,
    CommissionProduitSerializer,
    CommissionSerializer,
    CommuneSerializer,
    CompagnieSerializer,
    ContinentSerializer,
    CrontabScheduleSerializer,
    DelaiAvisEcheanceSerializer,
    DemandeAvenantSerializer,
    DemandeGarantieHabitationSerializer,
    DemandeGarantieIaSerializer,
    DemandeGarantieRisquesDiversSerializer,
    DemandeGarantieSerializer,
    DemandeGarantieVoyageSerializer,
    DomaineActiviteRCSerializer,
    EnergieSerializer,
    EnregistrementOffreGarantieSerializer,
    FormuleSecuriteRoutiereParCompagnieSerializer,
    FormuleSecuriteRoutiereSerializer,
    GarantieParProduitSerializer,
    GarantiePourOffreSerializer,
    GarantieProposeeSerializer,
    GarantieRisqueSerializer,
    GarantieSerializer,
    GenreVehiculeSerializer,
    GroupeUtilisateurSerializer,
    IntermediaireSerializer,
    IntervalScheduleSerializer,
    LienJuridiqueSanteSerializer,
    MarqueSerializer,
    MenuParentSerializer,
    MenuSerializer,
    ModeEncaissementSerializer,
    ModeleVehiculeSerializer,
    OffreCollegeSanteSerializer,
    OffreDetailSerializer,
    OffreGarantieSerializer,
    OffreParProduitSerializer,
    OffreSanteParTarifSerializer,
    OffreSerializer,
    ParametreSiteSerializer,
    PaysSerializer,
    PaysZoneSerializer,
    PeriodicTaskSerializer,
    PrimeCalculationInputSerializer,
    PrimeCalculationOutputSerializer,
    ProduitSerializer,
    ProfessionIaSerializer,
    ProfessionSerializer,
    QualiteAyantDroitSerializer,
    QualiteSerializer,
    QualiteSouscripteurMrhSerializer,
    StatutJuridiqueSerializer,
    ApporteurSerializer,
    ReductionFlotteSerializer,
    RepartitionPrimeSanteSerializer,
    CalculRepartitionPrimeSanteInputSerializer,
    RegionSerializer,
    RisqueSerializer,
    SecteurActiviteSerializer,
    SolarScheduleSerializer,
    SousGarantieSerializer,
    SystemeSecuriteSerializer,
    TarifDetailSerializer,
    TarifParProduitSerializer,
    TarifSerializer,
    TauxTaxeGarantieProduitSerializer,
    TypeAssureSerializer,
    TypeContratSanteSerializer,
    TypeReductionSerializer,
    TypeSouscripteurSerializer,
    TypeVehiculeSerializer,
    UsageVehiculeSerializer,
    UtilisateurSerializer,
    VilleSerializer,
    ZoneCouvertureSanteSerializer,
    ZoneVoyageSerializer,
)
from .utils import (
    get_college_sante_par_offre,
    get_formule_securite_routiere,
    get_garantie_offre,
    get_garantie_offre_ia,
    get_garantie_offre_mrh,
    get_garantie_offre_risques_divers,
    get_garantie_offre_voyage,
    get_garantie_produit,
    get_liste_avenant_produit,
    get_liste_pays_voyage,
    get_offre_par_produit,
    get_offre_sante_par_tarif,
    get_offre_voyage,
    get_tarif_par_produit,
    get_tarif_voyage,
    get_zone_couverture_sante,
    save_offre_garantie,
)


class SettingsModelViewSet(viewsets.ModelViewSet):
    permission_classes_by_action = {
        "create": (
            permissions.IsAuthenticated,
            DroitDeLaRoute,
        ),
        "list": (permissions.IsAuthenticated,),
        "retrieve": (permissions.IsAuthenticated,),
        "update": (
            permissions.IsAuthenticated,
            DroitDeLaRoute,
        ),
        "destroy": (
            permissions.IsAuthenticated,
            DroitDeLaRoute,
        ),
        "search": (permissions.IsAuthenticated,),
    }


class PrimeCalculationView(APIView):
    """
    Vue permettant de calculer :
    - le taux de taxe applicable selon le produit
    - le coût de police basé sur la prime nette
    - le montant de la taxe
    """

    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def post(self, request, *args, **kwargs):
        from decimal import ROUND_HALF_UP, Decimal

        input_serializer = PrimeCalculationInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)

        id_compagnie = input_serializer.validated_data["id_compagnie"]
        id_produit = input_serializer.validated_data["id_produit"]
        prime_nette = input_serializer.validated_data["prime_nette"]
        date_effet = input_serializer.validated_data["date_effet"]
        id_offre = input_serializer.validated_data["id_offre"]

        # 2. Taux de taxe
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT public.fn_get_taux_taxe(%s, %s, %s, %s)",
                [id_compagnie, id_produit, id_offre, date_effet],
            )
            row = cursor.fetchone()
            taux_taxe = row[0] if row is not None else Decimal("0")

        # 3. Accessoires
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT accessoire_compagnie, accessoire_intermediaire "
                "FROM public.fn_get_accessoire(%s, %s, %s, %s, %s)",
                [prime_nette, id_produit, id_offre, id_compagnie, date_effet],
            )
            row = cursor.fetchone()

            accessoire_compagnie = row[0] if row else Decimal("0")
            accessoire_intermediaire = row[1] if row else Decimal("0")

            cout_police = accessoire_compagnie + accessoire_intermediaire

        # 4. Taxe
        base_taxe = (
            (prime_nette + cout_police) * taux_taxe / Decimal("100")
        )  # Arrondi à l’unité (0 décimale), comme round(..., 0) mais en Decimal
        montant_taxe = base_taxe.quantize(Decimal("1"), rounding=ROUND_HALF_UP)

        prime_totale = prime_nette + cout_police + montant_taxe

        output_data = {
            "taux_taxe": taux_taxe,
            "accessoire": cout_police,
            "montant_taxe": montant_taxe,
            "prime_totale": prime_totale,
        }

        output_serializer = PrimeCalculationOutputSerializer(output_data)
        return Response(output_serializer.data, status=status.HTTP_200_OK)


class RepartitionPrimeSanteViewSet(SettingsModelViewSet):
    queryset = RepartitionPrimeSante.objects.all().order_by("avec_apporteur", "libelle")
    serializer_class = RepartitionPrimeSanteSerializer


class CalculRepartitionPrimeSanteView(APIView):
    """
    Calcule la ventilation d'une prime HT Santé (Minéné Santé) entre
    NSIA CI (frais généraux), OREOLE ASSURANCES (commission courtier),
    VITALIS (honoraires de gestion), ADEC (frais de gestion) — ou la
    commission des commerciaux de la compagnie si le contrat est apporté
    par un tiers — à partir du barème actif correspondant.
    """

    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def post(self, request, *args, **kwargs):
        input_serializer = CalculRepartitionPrimeSanteInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)

        prime_ht = input_serializer.validated_data["prime_ht"]
        avec_apporteur = input_serializer.validated_data["avec_apporteur"]

        bareme = (
            RepartitionPrimeSante.objects.filter(
                avec_apporteur=avec_apporteur, actif=True
            )
            .order_by("-date_modification")
            .first()
        )
        if not bareme:
            return Response(
                {
                    "error": "Aucun barème de répartition de la prime Santé actif "
                    "n'est paramétré pour cette variante (avec_apporteur={}).".format(
                        avec_apporteur
                    )
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        repartition = bareme.calculer_repartition(prime_ht)
        repartition["bareme_id"] = bareme.id
        repartition["bareme_libelle"] = bareme.libelle
        repartition["avec_apporteur"] = avec_apporteur

        return Response(repartition, status=status.HTTP_200_OK)


class GarantieViewSet(viewsets.ModelViewSet):
    queryset = Garantie.objects.filter(~Q(IdGarantie=0))
    serializer_class = GarantieSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class DomaineActiviteRCViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated,
    ]
    queryset = DomaineActiviteRC.objects.all()
    serializer_class = DomaineActiviteRCSerializer


class MenuViewSet(viewsets.ModelViewSet):
    queryset = Menu.objects.all()
    serializer_class = MenuSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class MenuParentViewSet(viewsets.ModelViewSet):
    queryset = MenuParent.objects.all()
    serializer_class = MenuParentSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class UtilisateurViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated,
    ]
    queryset = Utilisateur.objects.all()
    serializer_class = UtilisateurSerializer


class GroupeUtilisateurViewSet(viewsets.ModelViewSet):
    queryset = GroupeUtilisateur.objects.all()
    serializer_class = GroupeUtilisateurSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class SousGarantieViewSet(viewsets.ModelViewSet):
    queryset = SousGarantie.objects.filter(~Q(IdSousGarantie=0))
    serializer_class = SousGarantieSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class GarantieRisqueViewSet(viewsets.ModelViewSet):
    queryset = GarantieRisque.objects.all()
    serializer_class = GarantieRisqueSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class CategorieViewSet(viewsets.ModelViewSet):
    queryset = Categorie.objects.all()
    serializer_class = CategorieSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get_queryset(self):
        queryset = super().get_queryset()
        # ?branche=200 : ne garde que les catégories de la branche CIMA (le 1er chiffre
        # du code catégorie correspond à celui du code branche de stdbranche, ex: 201..213 -> 200)
        branche = self.request.query_params.get("branche")
        if branche and self.action == "list":
            queryset = queryset.filter(CodeCategorie__startswith=branche.strip()[:1]).exclude(
                CodeCategorie="000"
            )
        return queryset.order_by("CodeCategorie")


class TarifViewSet(viewsets.ModelViewSet):
    queryset = Tarif.objects.filter(~Q(IdTarif=0))
    serializer_class = TarifSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class QualiteSouscripteurMrhViewSet(viewsets.ModelViewSet):
    queryset = QualiteSouscripteurMrh.objects.all()
    serializer_class = QualiteSouscripteurMrhSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class TarifDetailViewSet(JournalModificationsMixin, viewsets.ModelViewSet):
    # Barème automobile (Administration > Réglages par branche > Automobile > Barème automobile)
    libelle_journal = "Barème automobile"
    queryset = TarifDetail.objects.all()
    serializer_class = TarifDetailSerializer
    filterset_fields = ["IdTarif", "IdGarantie"]
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class BrancheViewSet(viewsets.ModelViewSet):
    queryset = Branche.objects.all()
    serializer_class = BrancheSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class RisqueViewSet(viewsets.ModelViewSet):
    queryset = Risque.objects.all()
    serializer_class = RisqueSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class EnergieViewSet(viewsets.ModelViewSet):
    queryset = Energie.objects.filter(~Q(IdEnergie=0))
    serializer_class = EnergieSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class OffreDetailViewSet(viewsets.ModelViewSet):
    queryset = OffreDetail.objects.all()
    serializer_class = OffreDetailSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class OffreViewSet(viewsets.ModelViewSet):
    queryset = Offre.objects.annotate(
        OffreBoisee=OffreAutomobileBoisee(F("IdOffre")),
        NbGaranties=Count("offregarantie", distinct=True),
    ).filter(~Q(IdOffre=0))
    serializer_class = OffreSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get_queryset(self):
        queryset = super().get_queryset()
        # ?idcompagnie=<id> : ne garde que les offres ayant au moins une garantie
        # liée à cette compagnie (stdoffregarantie), et recompte NbGaranties pour
        # cette compagnie uniquement plutôt que toutes compagnies confondues.
        idcompagnie = self.request.query_params.get("idcompagnie")
        if idcompagnie and self.action == "list":
            queryset = queryset.filter(
                offregarantie__IdCompagnie=idcompagnie
            ).annotate(
                NbGaranties=Count(
                    "offregarantie",
                    filter=Q(offregarantie__IdCompagnie=idcompagnie),
                    distinct=True,
                )
            ).distinct()
        return queryset


class OffreGarantieViewSet(viewsets.ModelViewSet):
    queryset = OffreGarantie.objects.filter(
        ~Q(IdOffre=0) & ~Q(IdSousGarantie=0) & ~Q(IdCompagnie=0)
    )
    serializer_class = OffreGarantieSerializer
    filterset_fields = ["IdOffre", "IdCompagnie", "IdSousGarantie"]
    permission_classes_by_action = {
        "create": (
            permissions.IsAuthenticated,
            DroitDeLaRoute,
        ),
        "list": (permissions.IsAuthenticated,),
        "retrieve": (permissions.IsAuthenticated,),
        "update": (
            permissions.IsAuthenticated,
            DroitDeLaRoute,
        ),
        "destroy": (
            permissions.IsAuthenticated,
            DroitDeLaRoute,
        ),
        "search": (permissions.IsAuthenticated,),
    }


class GenreVehiculeViewSet(viewsets.ModelViewSet):
    queryset = GenreVehicule.objects.filter(~Q(IdGenre=0))
    serializer_class = GenreVehiculeSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class FormuleSecuriteRoutiereViewSet(JournalModificationsMixin, SettingsModelViewSet):
    libelle_journal = "Sécurité routière"
    queryset = FormuleSecuriteRoutiere.objects.all()
    serializer_class = FormuleSecuriteRoutiereSerializer


class AvenantViewSet(viewsets.ModelViewSet):
    queryset = Avenant.objects.filter(~Q(IdAvenant=0))
    serializer_class = AvenantSerializer
    permission_classes_by_action = {
        "create": (
            permissions.IsAuthenticated,
            DroitDeLaRoute,
        ),
        "list": (permissions.IsAuthenticated,),
        "retrieve": (permissions.IsAuthenticated,),
        "update": (
            permissions.IsAuthenticated,
            DroitDeLaRoute,
        ),
        "destroy": (
            permissions.IsAuthenticated,
            DroitDeLaRoute,
        ),
        "search": (permissions.IsAuthenticated,),
    }

    def list(self, request, *args, **kwargs):

        id_produit = request.query_params.get("idproduit")
        contrat_flotte = request.query_params.get("flotte")
        filtre_final = True

        if id_produit is None and contrat_flotte is None:
            filtre_final = False
            queryset = Avenant.objects.filter(~Q(IdAvenant=0))
        elif id_produit is None:
            contrat_flotte = contrat_flotte.lower() in [
                "true",
                "1",
                "yes",
                "vrai",
                "vraie",
                "oui",
                "o",
                "y",
                "v",
                "t",
            ]
            if contrat_flotte:
                avenants_produits = AvenantProduit.objects.filter(
                    Q(flotte=True)
                )
            else:
                avenants_produits = AvenantProduit.objects.filter(Q(mono=True))

            queryset = Avenant.objects.filter(
                IdAvenant__in=Subquery(avenants_produits.values("avenant"))
            )
        elif contrat_flotte is None:
            try:
                id_produit = int(id_produit)
                contrat_produit = Produit.objects.get(pk=id_produit)
                avenants_produits = AvenantProduit.objects.filter(
                    Q(produit=contrat_produit)
                )
                queryset = Avenant.objects.filter(
                    IdAvenant__in=Subquery(avenants_produits.values("avenant"))
                )
            except Exception:
                queryset = Avenant.objects.none()
                filtre_final = False
        else:
            try:
                contrat_flotte = contrat_flotte.lower() in [
                    "true",
                    "1",
                    "yes",
                    "vrai",
                    "vraie",
                    "oui",
                    "o",
                    "y",
                    "v",
                    "t",
                ]
                id_produit = int(id_produit)
                contrat_produit = Produit.objects.get(pk=id_produit)
                if contrat_flotte:
                    avenants_produits = AvenantProduit.objects.filter(
                        Q(produit=contrat_produit) & Q(flotte=True)
                    )
                else:
                    avenants_produits = AvenantProduit.objects.filter(
                        Q(produit=contrat_produit) & Q(mono=True)
                    )
                queryset = Avenant.objects.filter(
                    IdAvenant__in=Subquery(avenants_produits.values("avenant"))
                )
            except Exception:
                queryset = Avenant.objects.none()
                filtre_final = False

        if filtre_final:
            affaire_nouvelle = Avenant.objects.filter(Q(CodeAvenant="AFN"))
            if affaire_nouvelle:
                id_avenant_afn = affaire_nouvelle.first().IdAvenant
                queryset = queryset.filter(~Q(IdAvenant=id_avenant_afn))

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)


class CompagnieViewSet(viewsets.ModelViewSet):
    queryset = Compagnie.objects.filter(~Q(IdCompagnie=0) & Q(Active=True))
    serializer_class = CompagnieSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class CarrosserieViewSet(viewsets.ModelViewSet):
    queryset = Carrosserie.objects.all()
    serializer_class = CarrosserieSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class TypeVehiculeViewSet(viewsets.ModelViewSet):
    queryset = TypeVehicule.objects.filter(~Q(id=0))
    serializer_class = TypeVehiculeSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class TypeAssureViewSet(viewsets.ModelViewSet):
    queryset = TypeAssure.objects.all()
    serializer_class = TypeAssureSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def perform_create(self, serializer):
        data = serializer.validated_data
        serializer.save(
            code_type=data.get('code_type', '').strip().upper(),
            libelle_type=data.get('libelle_type', '').strip().upper(),
        )

    def perform_update(self, serializer):
        data = serializer.validated_data
        serializer.save(
            code_type=data.get('code_type', serializer.instance.code_type).strip().upper(),
            libelle_type=data.get('libelle_type', serializer.instance.libelle_type).strip().upper(),
        )

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        # Vérifier si ce type est utilisé dans les contrats/devis (production)
        try:
            from production.models import Devis
            count = Devis.objects.filter(TypeSouscripteur=instance.code_type).count()
            if count > 0:
                return Response(
                    {"error": f"Impossible de supprimer le type assuré « {instance.libelle_type} » "
                              f"car il est utilisé dans {count} devis/contrat(s)."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except Exception:
            pass
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)


class TypeSouscripteurViewSet(viewsets.ModelViewSet):
    queryset = TypeSouscripteur.objects.all()
    serializer_class = TypeSouscripteurSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def perform_create(self, serializer):
        data = serializer.validated_data
        serializer.save(
            code_type=data.get('code_type', '').strip().upper(),
            libelle_type=data.get('libelle_type', '').strip().upper(),
        )

    def perform_update(self, serializer):
        data = serializer.validated_data
        serializer.save(
            code_type=data.get('code_type', serializer.instance.code_type).strip().upper(),
            libelle_type=data.get('libelle_type', serializer.instance.libelle_type).strip().upper(),
        )

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        # Vérifier si ce type est utilisé dans les contrats/devis
        try:
            from production.models import Devis
            count = Devis.objects.filter(TypeSouscripteur=instance.code_type).count()
            if count > 0:
                return Response(
                    {"error": f"Impossible de supprimer le type souscripteur « {instance.libelle_type} » "
                              f"car il est utilisé dans {count} devis/contrat(s)."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except Exception:
            pass
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProfessionViewSet(viewsets.ModelViewSet):
    queryset = Profession.objects.all().order_by("Libelle")
    serializer_class = ProfessionSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def perform_create(self, serializer):
        libelle = serializer.validated_data.get('Libelle', '').strip()
        code = serializer.validated_data.get('CodeProfession')
        if code:
            code = code.strip().upper()
        else:
            try:
                last = Profession.objects.order_by('-IdProfession').first()
                next_id = (last.IdProfession + 1) if last else 1
                code = f"PROF{str(next_id).zfill(2)}"
            except Exception:
                code = None
        serializer.save(Libelle=libelle, CodeProfession=code)

    def perform_update(self, serializer):
        libelle = serializer.validated_data.get('Libelle', '').strip()
        code = serializer.validated_data.get('CodeProfession')
        if code:
            code = code.strip().upper()
        serializer.save(Libelle=libelle, CodeProfession=code)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        try:
            from customer.models import Client
            client_count = Client.objects.filter(IdProfession=instance.IdProfession).count()
            if client_count > 0:
                return Response(
                    {
                        "error": f"Impossible de supprimer la profession « {instance.Libelle} » "
                                 f"car elle est actuellement rattachée à {client_count} client(s). "
                                 f"Veuillez d'abord retirer cette profession des fiches clients concernées."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except Exception:
            pass
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ActeViewSet(viewsets.ModelViewSet):
    queryset = Acte.objects.all()
    serializer_class = ActeSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class CommissionViewSet(viewsets.ModelViewSet):
    queryset = Commission.objects.all()
    serializer_class = CommissionSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class CommissionProduitViewSet(JournalModificationsMixin, viewsets.ModelViewSet):
    libelle_journal = "Taux de commission"
    queryset = CommissionProduit.objects.filter(~Q(produit=0))
    serializer_class = CommissionProduitSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class TauxTaxeGarantieProduitViewSet(JournalModificationsMixin, viewsets.ModelViewSet):
    libelle_journal = "Taux de taxe"
    queryset = TauxTaxeGarantieProduit.objects.filter(
        ~Q(garantie=0) & ~Q(produit=0)
    )
    serializer_class = TauxTaxeGarantieProduitSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class AccessoireViewSet(JournalModificationsMixin, viewsets.ModelViewSet):
    libelle_journal = "Accessoires compagnie"
    queryset = Accessoire.objects.filter(~Q(produit=0))
    serializer_class = AccessoireSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class PaysViewSet(viewsets.ModelViewSet):
    queryset = Pays.objects.all()
    serializer_class = PaysSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class RegionViewSet(viewsets.ModelViewSet):
    queryset = Region.objects.all()
    serializer_class = RegionSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class VilleViewSet(viewsets.ModelViewSet):
    queryset = Ville.objects.all()
    serializer_class = VilleSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class CommuneViewSet(viewsets.ModelViewSet):
    queryset = Commune.objects.all()
    serializer_class = CommuneSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class IntermediaireViewSet(viewsets.ModelViewSet):
    queryset = Intermediaire.objects.filter(~Q(IdIntermediaire=0))
    serializer_class = IntermediaireSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class QualiteViewSet(viewsets.ModelViewSet):
    queryset = Qualite.objects.all()
    serializer_class = QualiteSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class EcrituresAdministrateur(DroitDeLaRoute):
    """Lecture pour tout utilisateur connecté, écriture selon le droit attribué pour la route (DroitDeLaRoute)."""


class ApporteurViewSet(viewsets.ModelViewSet):
    """Apporteurs d'affaires codifiés : lecture pour tous, création et modification par un
    administrateur. Un apporteur n'est pas supprimé mais désactivé (Actif = False)."""

    queryset = Apporteur.objects.all().order_by("Code")
    serializer_class = ApporteurSerializer
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_permissions(self):
        return [permissions.IsAuthenticated(), EcrituresAdministrateur()]

    def perform_create(self, serializer):
        code = serializer.validated_data.get("Code")
        if not code:
            dernier = (
                Apporteur.objects.filter(Code__startswith="APP-").order_by("-Code").values_list("Code", flat=True).first()
            )
            rang = int(dernier.split("-")[1]) + 1 if dernier and dernier.split("-")[1].isdigit() else 1
            code = f"APP-{rang:04d}"
        serializer.save(Code=code)


class StatutJuridiqueViewSet(viewsets.ModelViewSet):
    # Ordre de saisie du référentiel (sociétés commerciales d'abord, « Autre » en dernier)
    queryset = StatutJuridique.objects.all().order_by("IdStatutJuridique")
    serializer_class = StatutJuridiqueSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class TermeViewSet(viewsets.ViewSet):
    def list(self, request):
        data = [
            {
                "IdTerme": 1,
                "Libelle": "Tacite reconduction",
            },
            {
                "IdTerme": 2,
                "Libelle": "Ferme",
            },
            {
                "IdTerme": 3,
                "Libelle": "Autre",
            },
        ]

        # 3. Return the list directly
        return Response(data)

    def retrieve(self, request, pk=None):
        data = {
            1: {
                "IdTerme": 1,
                "Libelle": "Tacite reconduction",
            },
            2: {
                "IdTerme": 2,
                "Libelle": "Ferme",
            },
            3: {
                "IdTerme": 3,
                "Libelle": "Autre",
            },
        }
        return Response(data.get(pk, {}))

    permission_classes = [
        permissions.IsAuthenticated,
    ]


class SecteurActiviteViewSet(viewsets.ModelViewSet):
    queryset = SecteurActivite.objects.all()
    serializer_class = SecteurActiviteSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def perform_create(self, serializer):
        libelle = serializer.validated_data.get('Libelle', '').strip()
        serializer.save(Libelle=libelle)

    def perform_update(self, serializer):
        libelle = serializer.validated_data.get('Libelle', '').strip()
        serializer.save(Libelle=libelle)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        try:
            from customer.models import Client
            client_count = Client.objects.filter(IdSecteurActivite=instance.IdSecteurActivite).count()
            if client_count > 0:
                return Response(
                    {
                        "error": f"Impossible de supprimer le secteur d'activité « {instance.Libelle} » "
                                 f"car il est actuellement rattaché à {client_count} client(s). "
                                 f"Veuillez d'abord retirer ce secteur des fiches clients concernées."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except Exception as e:
            pass
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)


class QualiteAyantDroitViewSet(viewsets.ModelViewSet):
    queryset = QualiteAyantDroit.objects.all()
    serializer_class = QualiteAyantDroitSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class MarqueViewSet(viewsets.ModelViewSet):
    queryset = Marque.objects.filter(~Q(IdMarque=0))
    serializer_class = MarqueSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class SystemeSecuriteViewSet(viewsets.ModelViewSet):
    queryset = SystemeSecurite.objects.all()
    serializer_class = SystemeSecuriteSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class ModeleVehiculeViewSet(viewsets.ModelViewSet):
    queryset = ModeleVehicule.objects.all()
    serializer_class = ModeleVehiculeSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class UsageVehiculeViewSet(viewsets.ModelViewSet):
    queryset = UsageVehicule.objects.filter(~Q(IdUsage=0)).prefetch_related("Carrosseries__Usages")
    serializer_class = UsageVehiculeSerializer
    permission_classes = [
        permissions.IsAuthenticated,
        # permissions.AllowAny,
    ]


class TypeReductionViewSet(viewsets.ModelViewSet):
    queryset = TypeReduction.objects.all()
    serializer_class = TypeReductionSerializer
    permission_classes = [
        permissions.IsAuthenticated,
        # permissions.AllowAny,
    ]


class ContinentViewSet(viewsets.ModelViewSet):
    queryset = Continent.objects.all()
    serializer_class = ContinentSerializer
    permission_classes = [
        permissions.IsAuthenticated,
        # permissions.AllowAny,
    ]


class ZoneVoyageViewSet(viewsets.ModelViewSet):
    queryset = ZoneVoyage.objects.all()
    serializer_class = ZoneVoyageSerializer
    permission_classes = [
        permissions.IsAuthenticated,
        # permissions.AllowAny,
    ]


class ProduitViewSet(viewsets.ModelViewSet):
    queryset = Produit.objects.filter(~Q(id_produit=0))
    serializer_class = ProduitSerializer
    permission_classes = [
        permissions.IsAuthenticated,
        # permissions.AllowAny,
    ]


class ProfessionIaViewSet(viewsets.ModelViewSet):
    queryset = (
        ProfessionIa.objects.filter(active=True)
        .order_by("libelle_profession")
        .values()
    )
    serializer_class = ProfessionIaSerializer
    permission_classes = [
        permissions.IsAuthenticated,
        # permissions.AllowAny,
    ]


class CategoriePermisViewSet(viewsets.ModelViewSet):
    queryset = CategoriePermis.objects.all().order_by("libelle").values()
    serializer_class = CategoriePermisSerializer
    permission_classes = [
        permissions.IsAuthenticated,
        # permissions.AllowAny,
    ]


# Banque « NEANT » : celle que la caisse enregistre pour un règlement sans banque (espèces, paiement mobile…)
ID_BANQUE_NEANT = 1
# Tables d'URANUS qui désignent une banque (clés étrangères vers stdbanque) : clé renvoyée, libellés singulier et pluriel
UTILISATIONS_BANQUE = (
    ("stdencaissement", "Encaissements", "encaissement", "encaissements"),
    ("stdcheque", "Cheques", "chèque", "chèques"),
    ("stdreversementcompagnie", "Reversements", "reversement", "reversements"),
    ("std_paiement_commission", "PaiementsCommission", "paiement de commissions", "paiements de commissions"),
)


def utilisations_banques(ids=None):
    """{idbanque: {Encaissements, Cheques, Reversements, PaiementsCommission}} : lignes qui désignent chaque banque."""
    resultat = {}
    with connection.cursor() as cursor:
        for table, cle, _, _ in UTILISATIONS_BANQUE:
            cursor.execute(
                f"SELECT idbanque, COUNT(*) FROM {table} WHERE idbanque IS NOT NULL"
                + (" AND idbanque = ANY(%s)" if ids else "") + " GROUP BY idbanque",
                [list(ids)] if ids else [])
            for idbanque, nombre in cursor.fetchall():
                resultat.setdefault(idbanque, {})[cle] = nombre
    return resultat


class BanqueViewSet(JournalModificationsMixin, viewsets.ModelViewSet):
    """Banques des chèques, virements et traites, par ordre alphabétique. Création depuis l'administration (Listes de
    référence > Banques) ou depuis la caisse (bouton « + » de la banque émettrice : droit encaissements.create, règle de
    garde) ; modification et suppression depuis l'administration. « NEANT » n'est ni modifiable ni supprimable ; une
    banque déjà désignée par un encaissement, un chèque, un reversement ou un paiement de commissions n'est pas
    supprimable (elle se renomme)."""

    libelle_journal = "Banques"
    queryset = Banque.objects.all().order_by("libelle")
    serializer_class = BanqueSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def _neant(self):
        return Response({"error": "La banque « NEANT » sert aux règlements sans banque : elle ne se modifie pas."},
                        status=status.HTTP_400_BAD_REQUEST)

    def update(self, request, *args, **kwargs):
        if self.get_object().pk == ID_BANQUE_NEANT:
            return self._neant()
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        banque = self.get_object()
        if banque.pk == ID_BANQUE_NEANT:
            return self._neant()
        utilisations = utilisations_banques([banque.pk]).get(banque.pk, {})
        if utilisations:
            detail = ", ".join(f"{utilisations[cle]} {pluriel if utilisations[cle] > 1 else singulier}"
                               for _, cle, singulier, pluriel in UTILISATIONS_BANQUE if utilisations.get(cle))
            return Response({"error": f"{banque.libelle.strip()} est déjà utilisée ({detail}) : suppression impossible, "
                                      "renommez-la si besoin."}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["get"])
    def utilisations(self, request):
        """GET /api/banque/utilisations/ : {idbanque: {Encaissements, Cheques, Reversements, PaiementsCommission}}."""
        return Response({str(idbanque): valeurs for idbanque, valeurs in utilisations_banques().items()})


class ModeEncaissementViewSet(viewsets.ModelViewSet):
    queryset = (
        ModeEncaissement.objects.all().order_by("ordreaffichage").values()
    )
    serializer_class = ModeEncaissementSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class AccessoireCourtierParCompagnieViewSet(JournalModificationsMixin, viewsets.ModelViewSet):
    libelle_journal = "Accessoires courtier"
    queryset = AccessoireCourtierParCompagnie.objects.all()
    serializer_class = AccessoireCourtierParCompagnieSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class LienJuridiqueSanteViewSet(viewsets.ModelViewSet):
    queryset = (
        LienJuridiqueSante.objects.all().order_by("-libellelien").values()
    )
    serializer_class = LienJuridiqueSanteSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class ZoneCouvertureSanteViewSet(viewsets.ModelViewSet):
    queryset = ZoneCouvertureSante.objects.all()
    serializer_class = ZoneCouvertureSanteSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class CollegeSanteViewSet(viewsets.ModelViewSet):
    queryset = CollegeSante.objects.all()
    serializer_class = CollegeSanteSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class OffreCollegeSanteViewSet(viewsets.ModelViewSet):
    queryset = OffreCollegeSante.objects.all()
    serializer_class = OffreCollegeSanteSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def get_garantie(request):
    garantiedemandee_data = JSONParser().parse(request)
    print("JSON de la requête:", garantiedemandee_data)
    garantiedemandee_serializer = DemandeGarantieSerializer(
        data=garantiedemandee_data
    )
    if garantiedemandee_serializer.is_valid():
        garantieproposee_serializer = GarantieProposeeSerializer(
            get_garantie_offre(garantiedemandee_data), many=True
        )
        return JsonResponse(
            garantieproposee_serializer.data,
            status=status.HTTP_201_CREATED,
            safe=False,
        )
    return JsonResponse(
        garantiedemandee_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def get_garantie_ia(request):
    garantiedemandee_data = JSONParser().parse(request)
    print("JSON de la requête:", garantiedemandee_data)
    garantiedemandee_serializer = DemandeGarantieIaSerializer(
        data=garantiedemandee_data
    )
    if garantiedemandee_serializer.is_valid():
        garantieproposee_serializer = GarantieProposeeSerializer(
            get_garantie_offre_ia(garantiedemandee_data), many=True
        )
        return JsonResponse(
            garantieproposee_serializer.data,
            status=status.HTTP_201_CREATED,
            safe=False,
        )
    return JsonResponse(
        garantiedemandee_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def get_garantie_voyage(request):
    garantiedemandee_data = JSONParser().parse(request)
    # if settings.DEBUG:
    print("JSON de la requête:", garantiedemandee_data)

    garantiedemandee_serializer = DemandeGarantieVoyageSerializer(
        data=garantiedemandee_data
    )
    if garantiedemandee_serializer.is_valid():
        garantieproposee_serializer = GarantieProposeeSerializer(
            get_garantie_offre_voyage(garantiedemandee_data), many=True
        )
        return JsonResponse(
            garantieproposee_serializer.data,
            status=status.HTTP_201_CREATED,
            safe=False,
        )
    return JsonResponse(
        garantiedemandee_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


##########################################################################
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated, DroitDeLaRoute])
def create_offre_garantie(request):
    enregistrementoffregarantie_data = JSONParser().parse(request)
    # print("JSON de la requête:", enregistrementoffregarantie_data)

    serializer = EnregistrementOffreGarantieSerializer(
        data=enregistrementoffregarantie_data
    )
    if serializer.is_valid():
        (code_retour, msg, qset) = save_offre_garantie(
            enregistrementoffregarantie_data
        )
        if code_retour == 0:
            offregarantie_serializer = OffreGarantieSerializer(qset, many=True)
            return JsonResponse(
                offregarantie_serializer.data,
                status=status.HTTP_201_CREATED,
                safe=False,
            )
        else:
            return JsonResponse(
                {"Statut": "Echec", "Data": msg},
                status=status.HTTP_204_NO_CONTENT,
            )
    return JsonResponse(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


##################################################################################
##########################################################################
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated, DroitDeLaRoute])
def get_garantie_par_produit(request):
    demandegarantie_data = JSONParser().parse(request)
    # print("JSON de la requête:", demandegarantie_data)

    serializer = GarantieParProduitSerializer(data=demandegarantie_data)
    if serializer.is_valid():
        qset = get_garantie_produit(demandegarantie_data)
        offregarantie_serializer = GarantiePourOffreSerializer(qset, many=True)
        return JsonResponse(
            offregarantie_serializer.data,
            status=status.HTTP_201_CREATED,
            safe=False,
        )
    return JsonResponse(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


##################################################################################
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def get_garantie_mrh(request):
    garantiedemandee_data = JSONParser().parse(request)
    # print("JSON de la requête:", garantiedemandee_data)

    garantiedemandee_serializer = DemandeGarantieHabitationSerializer(
        data=garantiedemandee_data
    )
    if garantiedemandee_serializer.is_valid():
        garantieproposee_serializer = GarantieProposeeSerializer(
            get_garantie_offre_mrh(garantiedemandee_data), many=True
        )
        return JsonResponse(
            garantieproposee_serializer.data,
            status=status.HTTP_201_CREATED,
            safe=False,
        )
    return JsonResponse(
        garantiedemandee_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


##################################################################################
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def get_garantie_rc(request):
    return get_garantie_risques_divers(id_produit=8, request=request)


##################################################################################
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def get_garantie_mrp(request):
    return get_garantie_risques_divers(id_produit=7, request=request)


def get_garantie_risques_divers(id_produit, request):
    garantiedemandee_data = JSONParser().parse(request)
    garantiedemandee_serializer = DemandeGarantieRisquesDiversSerializer(
        data=garantiedemandee_data
    )
    if garantiedemandee_serializer.is_valid():
        garantieproposee_serializer = GarantieProposeeSerializer(
            get_garantie_offre_risques_divers(
                id_produit, garantiedemandee_data
            ),
            many=True,
        )
        return JsonResponse(
            garantieproposee_serializer.data,
            status=status.HTTP_201_CREATED,
            safe=False,
        )
    return JsonResponse(
        garantiedemandee_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


#####################################################################################
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def get_liste_avenant(request):
    avenantdemande_data = JSONParser().parse(request)
    # print("JSON de la requête:", avenantdemande_data)
    avenantdemande_serializer = DemandeAvenantSerializer(
        data=avenantdemande_data
    )
    if avenantdemande_serializer.is_valid():
        try:
            id_produit = int(avenantdemande_data["IdProduit"])
            flotte = bool(avenantdemande_data["Flotte"])
            (msg, qryset) = get_liste_avenant_produit(id_produit, flotte)
            if msg:
                return Response(
                    {"status": "Echec", "data": msg},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            serializer = AvenantSerializer(qryset, many=True)
            return JsonResponse(
                serializer.data, status=status.HTTP_201_CREATED, safe=False
            )
        except Exception as error:
            print(error)
            return Response(
                {"status": "Echec", "data": str(error)},
                status=status.HTTP_400_BAD_REQUEST,
            )
    return JsonResponse(
        avenantdemande_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


# class AvenantContratView(APIView):
#     permission_classes = [
#         permissions.IsAuthenticated,
#     ]

#     def get(self, request, idcontrat):
#         try:
#             contrat = Contrat.objects.get(pk=idcontrat)
#             if contrat.
#             #formules = AssistanceAutomobile.objects.filter(Q(id_compagnie=idcompagnie))
#             #serializer = AssistanceAutomobileSerializer(formules, many=True)
#         except Exception as error:
#             return Response(
#                 {"status": "Echec", "data": str(error)},
#                 status=status.HTTP_400_BAD_REQUEST,
#             )
#         else:
#             print(serializer.data)
#             return Response(
#                 {"status": "succès", "data": serializer.data},
#                 status=status.HTTP_200_OK,
#             )


#####################################################################################
class OffreParProduitView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, *args, **kwargs):
        idproduit = request.query_params.get("idproduit")
        idtarif = request.query_params.get("idtarif")

        (msg, item) = get_offre_par_produit(
            idproduit=idproduit, idtarif=idtarif
        )
        if not msg:
            serializer = OffreParProduitSerializer(item, many=True)
            # print(serializer.data)
            return Response(
                {"status": "succès", "data": serializer.data},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


#####################################################################################
class OffreVoyageView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, *args, **kwargs):
        idcompagnie = request.query_params.get("idcompagnie")
        idtarif = request.query_params.get("idtarif")
        idzone = request.query_params.get("idzone")
        (msg, item) = get_offre_voyage(
            idcompagnie=idcompagnie, idtarif=idtarif, idzone=idzone
        )
        if not msg:
            serializer = OffreParProduitSerializer(item, many=True)
            # print(serializer.data)
            return Response(
                {"status": "succès", "data": serializer.data},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


##################################################################
class OffreSanteParTarifView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idtarif):
        (msg, item) = get_offre_sante_par_tarif(idtarif=idtarif)
        if not msg:
            serializer = OffreSanteParTarifSerializer(item, many=True)
            # print(serializer.data)
            return Response(
                {"status": "succès", "data": serializer.data},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


##################################################################
class CollegeSanteParOffreView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idoffre):
        (msg, item) = get_college_sante_par_offre(id_offre=idoffre)
        if not msg:
            serializer = CollegeSanteSerializer(item, many=True)
            # print(serializer.data)
            return Response(
                {"status": "succès", "data": serializer.data},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


###########################################################
class ZoneCouvertureOffreView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idzone):
        (msg, item) = get_zone_couverture_sante(idzone=idzone)
        if not msg:
            serializer = ZoneCouvertureSanteSerializer(item, many=True)
            # print(serializer.data)
            return Response(
                {"status": "succès", "data": serializer.data},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


###########################################################
class FormuleSecuriteRoutiereView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idcompagnie):
        (msg, formules) = get_formule_securite_routiere(
            idcompagnie=idcompagnie
        )
        if not msg:
            serializer = FormuleSecuriteRoutiereParCompagnieSerializer(
                formules, many=True
            )
            # print(serializer.data)
            return Response(
                {"status": "succès", "data": serializer.data},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


###########################################################
class AssistanceAutomobileView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idcompagnie):
        try:
            formules = AssistanceAutomobile.objects.filter(
                Q(id_compagnie=idcompagnie) | Q(id_compagnie=0)
            ).order_by("libelle_option")
            serializer = AssistanceAutomobileSerializer(formules, many=True)
        except Exception as error:
            return Response(
                {"status": "Echec", "data": str(error)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        else:
            # print(serializer.data)
            return Response(
                {"status": "succès", "data": serializer.data},
                status=status.HTTP_200_OK,
            )


###########################################################
class PaysZoneView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idcompagnie):
        try:
            (msg, pays) = get_liste_pays_voyage(idcompagnie)
            if not msg:
                serializer = PaysZoneSerializer(pays, many=True)
                return Response(
                    {"status": "Succès", "data": serializer.data},
                    status=status.HTTP_200_OK,
                )
            else:
                return Response(
                    {"status": "Echec", "data": msg},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except Exception as error:
            return Response(
                {"status": "Echec", "data": str(error)},
                status=status.HTTP_400_BAD_REQUEST,
            )


class TarifParProduitView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idproduit):
        (msg, item) = get_tarif_par_produit(idproduit=idproduit)
        if not msg:
            serializer = TarifParProduitSerializer(item, many=True)
            print(serializer.data)
            return Response(
                {"status": "succès", "data": serializer.data},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


class TarifVoyageView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idcompagnie):
        (msg, item) = get_tarif_voyage(idcompagnie=idcompagnie)
        if not msg:
            serializer = TarifParProduitSerializer(item, many=True)
            print(serializer.data)
            return Response(
                {"status": "succès", "data": serializer.data},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


class ReductionFlotteViewSet(JournalModificationsMixin, viewsets.ModelViewSet):
    libelle_journal = "Réductions flotte"
    queryset = ReductionFlotte.objects.all()
    serializer_class = ReductionFlotteSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class DelaiAvisEcheanceViewSet(JournalModificationsMixin, SettingsModelViewSet):
    libelle_journal = "Délais d'avis d'échéance"
    queryset = DelaiAvisEcheance.objects.all()
    serializer_class = DelaiAvisEcheanceSerializer


class ParametreSiteViewSet(SettingsModelViewSet):
    queryset = ParametreSite.objects.all()
    serializer_class = ParametreSiteSerializer


class SolarScheduleViewSet(SettingsModelViewSet):
    queryset = SolarSchedule.objects.all()
    serializer_class = SolarScheduleSerializer


class IntervalScheduleViewSet(SettingsModelViewSet):
    queryset = IntervalSchedule.objects.all()
    serializer_class = IntervalScheduleSerializer


class ClockedScheduleViewSet(SettingsModelViewSet):
    queryset = ClockedSchedule.objects.all()
    serializer_class = ClockedScheduleSerializer


class CrontabScheduleViewSet(SettingsModelViewSet):
    queryset = CrontabSchedule.objects.all()
    serializer_class = CrontabScheduleSerializer


class PeriodicTaskViewSet(SettingsModelViewSet):
    queryset = PeriodicTask.objects.all()
    serializer_class = PeriodicTaskSerializer


class TypeContratSanteViewSet(SettingsModelViewSet):
    queryset = TypeContratSante.objects.all()
    serializer_class = TypeContratSanteSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class IATarifGroupeView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idtarif):
        with connection.cursor() as cursor:
            cursor.execute("SELECT fn_tarif_ia_groupe(%s)", [idtarif])

            row = cursor.fetchone()
            return_value = row[0] if row else None

        # 4. Return to API client
        return Response({"est_tarif_ia_groupe": return_value})


class IATarifPersonnaliseView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idtarif):
        with connection.cursor() as cursor:
            cursor.execute("SELECT fn_tarif_ia_personnalise(%s)", [idtarif])

            row = cursor.fetchone()
            return_value = row[0] if row else None

        # 4. Return to API client
        return Response({"est_tarif_ia_personnalise": return_value})
