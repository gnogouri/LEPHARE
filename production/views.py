import json
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import cast

from django.conf import settings
from django.contrib import messages
from django.contrib.contenttypes.models import ContentType
from dateutil.relativedelta import relativedelta
from django.db import connection, transaction
from django.db.utils import DatabaseError
from django.db.models import F, Prefetch, Q
from django.db.models.expressions import RawSQL
from django.http import FileResponse, Http404
from django.http.response import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django_filters import rest_framework as filters
from institutionnel.authentication import KnoxOrDemoTokenAuthentication
from knox.auth import TokenAuthentication
from rest_framework import generics, permissions, status, viewsets
from rest_framework.authentication import BasicAuthentication
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.decorators import (
    action,
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from autorisations.models import (
    DemandeAutorisation,
    JetonAutorisation,
    TypeOperation,
)
from autorisations.serializers import AnnulerAvecJetonSerializer
from autorisations.tasks import envoyer_notification_nouvelle_demande

# Import des modèles MRH
from configuration_api.models import (
    OffreAutomobileBoisee,
    Option,
    ParametresCalcul,
    Produit,
    SousGarantieForfait,
    SousGarantieMRH,
    UsageHabitation,
)
from configuration_api.serializers import (  # Serializers lecture
    OptionSerializer,
    ParametresCalculSerializer,
    SousGarantieForfaitSerializer,
    SousGarantieMRHSerializer,
    UsageHabitationSerializer,
)
from core.date_parser import parse_date_string
from core.services import ServiceError
from customer.models import Client

from .anti_doublons.importateur import importer_assures_anti_doublons
from .anti_doublons.rapport import ConfigurationImport
from .database import (
    appliquer_garanties_vehicule_flotte,
    archive_quote,
    cancel_car_input,
    consolider_devis_db,
    correction_devis,
    enregistrer_ayant_droit,
    enregistrer_terme_devis,
    execute_maj_manuelle_primes,
    get_assure_ia,
    get_certificat_transport,
    get_contract_car_list,
    get_contract_coverage,
    get_contract_info,
    get_contract_list_for_customer,
    get_contract_list_for_pc,
    get_contract_premium_remittance,
    get_encaissement_recherche,
    get_extended_quotation_info,
    get_quotation_counts,
    get_garantie_souscrite,
    get_info_encaissement,
    get_info_reversement,
    get_info_vehicule,
    get_liste_assure_ia,
    get_quotation_info,
    get_taux_reduction_flotte,
    offre_mrh_compatible,
    policy_modification,
    premium_remittance_validation,
    quotation_completion,
    save_contract,
    save_insured_ia,
    save_plate_number,
    decaisser_cheque_impaye,
    enregistrer_echeancier_cheques,
    save_premium_collection,
    save_premium_collection_cancellation,
    save_premium_remittance,
    save_quotation,
    save_quotation_globaledebanque,
    save_quotation_ia,
    save_quotation_mrh,
    save_quotation_risques_divers,
    save_quotation_tousrisquesinfo,
    save_quotation_voyage,
    unarchive_quote,
)
from .exceltopostgresql import export_excel
from .import_assures import import_ia_insured, insert_new_assure
from sante.models import Adherent, Affilie
from .models import (
    Brouillon,
    AyantDroitIa,
    CertificatTransport,
    Cheque,
    ContractForPremiumCollection,
    Contrat,
    ContratDetail,
    ContratDetGarantie,
    DetailEncaissement,
    DetailQuittance,
    DetailReversement,
    Devis,
    DevisDetail,
    DevisDetGarantie,
    Encaissement,
    ImpositionPrime,
    LogRecord,
    Numero,
    PieceJointe,
    Quittance,
    ReversementCompagnie,
    TarifEcran,
)
from .serializers import (  # Serializers requêtes; Serializers réponses
    BrouillonSerializer,
    AssureIaInfoSerializer,
    AssureIaParDevisOuContratSerializer,
    AvenantAnlRenSerializer,
    AyantDroitIaSerializer,
    CertificatTransportSerializer,
    ChangementImmatriculationSerializer,
    ChequeOperationSerializer,
    ChequeSerializer,
    ChequeListeSerializer,
    DecaissementChequeSerializer,
    EcheancierChequesSerializer,
    ConsolidationDevisClientSerializer,
    ContractForPremiumCollectionSerializer,
    ContratDetailSerializer,
    ContratDetGarantieSerializer,
    ContratSerializer,
    CorrectionDevisSerializer,
    CreationAyantDroitIaSerializer,
    DataInsertionSerializer,
    DemandeContratPourEncaissementSerializer,
    DetailEncaissementSerializer,
    DetailMaisonSerializer,
    DetailQuittanceSerializer,
    DetailReversementSerializer,
    DevisClientSerializer,
    DevisDetailGarantieSerializer,
    DevisDetailSerializer,
    DevisDetGarantieSerializer,
    DevisMRHCalculeResponseSerializer,
    DevisMRHCreateRequestSerializer,
    DevisMRHResponseSerializer,
    DevisSerializer,
    EncaissementGroupeQuittanceSerializer,
    EncaissementResponseSerializer,
    EncaissementSerializer,
    EnregistrementDevisAutoSerializer,
    EnregistrementDevisGlobaleDeBanqueSerializer,
    EnregistrementDevisIaSerializer,
    EnregistrementDevisMrhSerializer,
    EnregistrementDevisRisqquesDiversSerializer,
    EnregistrementDevisTRInfoSerializer,
    EnregistrementDevisVoyageSerializer,
    ExtendedQuotationInfoSerializer,
    FinalisationDevisFlotteSerializer,
    GarantieContratFlotteSerializer,
    GarantiesVehiculeFlotteSerializer,
    GarantieSouscriteSerializer,
    ImportationAssureIaSerializer,
    ImportationTransportSerializer,
    ImpositionPrimeDevisRequestSerializer,
    ImpositionPrimeMaisonRequestSerializer,
    InfoVehiculeSerializer,
    LeveeImpositionRequestSerializer,
    LogRecordSerializer,
    MaisonAjouteeResponseSerializer,
    MaisonAjoutRequestSerializer,
    MaisonCalculeeSerializer,
    MaisonCalculRequestSerializer,
    MaisonModificationRequestSerializer,
    NumeroSerializer,
    OperationSurDevisDetailSerializer,
    OperationSurDevisSerializer,
    PieceJointeSerializer,
    PremiumCollectionInfoSerializer,
    PremiumRemittanceInfoSerializer,
    PrimeUpdateSerializer,
    QuittanceContratSerializer,
    QuittancePropositionSerializer,
    QuittanceSerializer,
    QuotationIaInsertionSerializer,
    QuotationInsertionSerializer,
    ResumeFinancierDevisSerializer,
    ReversementCompagnieSerializer,
    ReversementGroupePrimeInsertSerializer,
    ReversementGroupePrimeValidateSerializer,
    TarifEcranSerializer,
    TransformerSanteEnIASerializer,
    VehiculeContratSerializer,
)
from .services.mrh_calcul_service import MRHCalculService, calculer_date_expiration
from .services.resume_financier_devis import obtenir_resume_financier_devis
from .tasks import send_sms_enregistrement_contrat

logger = logging.getLogger(__name__)


def stored_procedure_result(
    request, post_serializer_cls, stored_proc_caller, qry_res_serializer_cls
):
    json_data = JSONParser().parse(request)
    print("JSON de la requête:", json_data)
    post_serializer = post_serializer_cls(data=json_data)
    if post_serializer.is_valid():
        (err, qryset) = stored_proc_caller(json_data)
        qry_res_serializer = qry_res_serializer_cls(qryset, many=True)
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST
        return JsonResponse(qry_res_serializer.data, status=st, safe=False)
    return JsonResponse(
        post_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


class ContractForPremiumCollectionView(generics.ListCreateAPIView):
    serializer_class = ContractForPremiumCollectionSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get_queryset(self):
        reference_client = self.request.query_params.get(
            "referenceclient", None
        )
        reference_contrat = self.request.query_params.get(
            "referencecontrat", None
        )
        if reference_client:
            reference_client = str(reference_client)
        if reference_contrat:
            reference_contrat = str(reference_contrat)
        (msg, item) = get_contract_list_for_pc(
            reference_client, reference_contrat
        )
        if not msg:
            return item
        else:
            return ContractForPremiumCollection.objects.none()


class EncaissementRechercheView(generics.ListCreateAPIView):
    queryset = Encaissement.objects.filter(~Q(piece_annulee=True)).order_by(
        "-dateencaissement"
    )[:1000]
    serializer_class = EncaissementSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get_queryset(self):
        reference_client = self.request.query_params.get(
            "referenceclient", None
        )
        reference_contrat = self.request.query_params.get(
            "referencecontrat", None
        )
        if reference_client or reference_contrat:
            if reference_client:
                reference_client = str(reference_client)
            if reference_contrat:
                reference_contrat = str(reference_contrat)
            (msg, item) = get_encaissement_recherche(
                reference_client, reference_contrat
            )
            if not msg:
                return item
            else:
                return Encaissement.objects.none()
        return super().get_queryset()


class BrouillonViewSet(viewsets.ModelViewSet):
    """
    Brouillons de saisie (devis non terminés, modifications de contrat) enregistrés en base
    pour être repris depuis n'importe quel poste. Filtres : ?type_brouillon=DEVIS_AUTO,
    ?iddevis=…, ?idcontrat=…
    """

    serializer_class = BrouillonSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Brouillon.objects.select_related("utilisateur").all()
        for champ in ("type_brouillon", "iddevis", "idcontrat"):
            valeur = self.request.query_params.get(champ)
            if valeur:
                qs = qs.filter(**{champ: valeur})
        return qs

    def perform_create(self, serializer):
        serializer.save(utilisateur=self.request.user if self.request.user.is_authenticated else None)


class PieceJointeViewSet(viewsets.ModelViewSet):
    """
    ViewSet pour gérer les pièces jointes
    """

    queryset = PieceJointe.objects.all()
    serializer_class = PieceJointeSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]
    parser_classes = [MultiPartParser, FormParser]

    def perform_destroy(self, instance):
        """Supprimer la pièce jointe et le fichier associé"""
        instance.delete()


# Catégorie(s) CIMA d'un devis : via le tarif de chaque ligne de détail
# (stddevisdetail.idtarif -> stdtarif.idcategorie) ; une flotte peut en porter plusieurs
DEVIS_CATEGORIE_SQL = """
    SELECT string_agg(DISTINCT cat.libellecategorie, ' / ')
    FROM stddevisdetail dd
    JOIN stdtarif t ON t.idtarif = dd.idtarif AND t.idtarif <> 0
    JOIN stdcategorie cat ON cat.idcategorie = t.idcategorie AND cat.idcategorie <> 0
    WHERE dd.iddevis = stddevis.iddevis
"""


# Tables des Conditions Particulières : un contrat émis a ses propres tables de détail et
# de garanties, de même structure que celles du devis
TABLES_CONDITIONS_PARTICULIERES = {
    False: {"entete": "stddevis", "cle": "iddevis", "offre_entete": "d.idoffre",
            "detail": "stddevisdetail", "detail_pk": "iddevisdetail",
            "garantie": "stddevisdetgarantie", "garantie_fk": "iddevisdet",
            "energie": "se.idenergie = dd.essence"},
    True: {"entete": "stdcontrat", "cle": "idcontrat", "offre_entete": "NULL",
           "detail": "stdcontratdetail", "detail_pk": "idcontratdetail",
           "garantie": "stdcontratdetgarantie", "garantie_fk": "idcontratdetail",
           "energie": "se.codeenergie = dd.codecarburant"},
}


def vehicules_conditions_particulieres_flotte(pk, contrat=False):
    """
    Véhicules d'une flotte automobile pour les Conditions Particulières « Liste des véhicules
    en Automobile » (modèle NSIA) : caractéristiques, catégorie / tarif, et chaque garantie
    du véhicule avec son état (acquise), son capital, sa franchise et sa prime nette.
    """
    t = TABLES_CONDITIONS_PARTICULIERES[contrat]
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT dd.{t['detail_pk']}, dd.matricule, m.libellemarque, dd.modelevehicule,
                   tv.libelletype, dd.puissancefiscale, dd.chargeutile, se.libelle,
                   dd.valeurneuve, dd.valeurvenale, dd.nombreplace,
                   tr.idtarif, tr.libelle, cat.codecategorie, cat.libellecategorie
            FROM {t['detail']} dd
            LEFT JOIN stdmarque m ON m.idmarque = dd.idmarque
            LEFT JOIN stdtypevehicule tv ON tv.id = dd.idtypevehicule
            LEFT JOIN stdenergie se ON {t['energie']}
            LEFT JOIN stdtarif tr ON tr.idtarif = dd.idtarif
            LEFT JOIN stdcategorie cat ON cat.idcategorie = tr.idcategorie
            WHERE dd.{t['cle']} = %s
            ORDER BY cat.codecategorie, tr.idtarif, dd.{t['detail_pk']}
            """,
            [pk],
        )
        vehicules = [
            {
                "id": iddetail,
                "immatriculation": matricule,
                "marque": marque,
                "modele": modele,
                "type_vehicule": type_vehicule,
                "puissance": puissance,
                "charge_utile": int(charge or 0),
                "energie": energie,
                "valeur_neuve": int(neuve or 0),
                "valeur_venale": int(venale or 0),
                "nombre_places": places,
                "id_tarif": idtarif,
                "tarif": tarif,
                "code_categorie": code_categorie,
                "categorie": categorie,
                "garanties": [],
            }
            for (iddetail, matricule, marque, modele, type_vehicule, puissance, charge, energie,
                 neuve, venale, places, idtarif, tarif, code_categorie, categorie) in cursor.fetchall()
        ]
        cursor.execute(
            f"""
            SELECT dg.{t['garantie_fk']}, dg.idgarantie, dg.acquise, dg.capital, dg.franchise,
                   dg.deces, dg.primenette
            FROM {t['garantie']} dg
            JOIN {t['detail']} dd ON dd.{t['detail_pk']} = dg.{t['garantie_fk']}
            WHERE dd.{t['cle']} = %s AND dg.idgarantie <> 0
            ORDER BY dg.idgarantie
            """,
            [pk],
        )
        par_vehicule = {v["id"]: v["garanties"] for v in vehicules}
        for iddetail, idgarantie, acquise, capital, franchise, deces, prime in cursor.fetchall():
            par_vehicule[iddetail].append({
                "id_garantie": idgarantie,
                "acquise": bool(acquise),
                "capital": int(capital or 0),
                "franchise": int(franchise or 0),
                "deces": int(deces or 0),
                "prime_nette": int(prime or 0),
            })
    return vehicules


def donnees_conditions_particulieres(objet, contrat=False):
    """
    Données des Conditions Particulières Automobile (modèle NSIA/OREOLE) d'un devis ou d'un
    contrat : références client / quittance avec libellés résolus, et garanties acquises
    regroupées par nature de risque (prime nette cumulée sur tous les véhicules pour une
    flotte). Les valeurs absentes sont renvoyées à null : le document laisse alors la case
    vide au lieu d'inventer une donnée.
    """
    t = TABLES_CONDITIONS_PARTICULIERES[contrat]

    def clean(value):
        # Les fiches importées contiennent des adresses « - » en guise de vide
        if value is None:
            return None
        value = str(value).strip()
        return value if value and value != "-" else None

    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT c.nom, c.prenoms, c.adresse1, c.adresse2, c.mobile, c.telephone, c.fixe,
                   q.libelle, p.libelle,
                   a.nom, a.prenoms, a.adresse1, a.adresse2,
                   i.libelleintermediaire, o.idoffre, o.libelleoffre, av.libelleavenant
            FROM {t['entete']} d
            LEFT JOIN stdclient c ON c.idclient = d.idclient
            LEFT JOIN stdqualite q ON q.idqualite = c.idqualite
            LEFT JOIN stdprofession p ON p.idprofession = c.idprofession
            LEFT JOIN stdclient a ON a.idclient = d.idassure
            LEFT JOIN stdintermediaire i ON i.idintermediaire = d.idintermediaire
            LEFT JOIN stdoffre o ON o.idoffre = {t['offre_entete']}
            LEFT JOIN stdavenant av ON av.idavenant = d.idavenant
            WHERE d.{t['cle']} = %s
            """,
            [objet.pk],
        )
        (
            c_nom, c_prenoms, c_adr1, c_adr2, c_mobile, c_tel, c_fixe,
            titre, profession,
            a_nom, a_prenoms, a_adr1, a_adr2,
            intermediaire, idoffre, libelle_offre, mouvement,
        ) = cursor.fetchone()

        # Offre non spécifiée au niveau du devis (idoffre 0) : on reprend celle
        # des véhicules si elle est unique
        if not idoffre:
            cursor.execute(
                f"""
                SELECT DISTINCT o.libelleoffre FROM {t['detail']} dd
                JOIN stdoffre o ON o.idoffre = dd.idoffre
                WHERE dd.{t['cle']} = %s AND dd.idoffre <> 0
                """,
                [objet.pk],
            )
            offres = [r[0] for r in cursor.fetchall()]
            libelle_offre = offres[0] if len(offres) == 1 else None

        cursor.execute(
            f"""
            SELECT sg.idsousgarantie, sg.libellesousgarantie, dg.capital, dg.franchise,
                   dg.textefranchise, dg.tauxfranchise, dg.minfranchise, dg.maxfranchise,
                   dg.primenette
            FROM {t['detail']} dd
            JOIN {t['garantie']} dg ON dg.{t['garantie_fk']} = dd.{t['detail_pk']}
            -- idgarantie référence une SOUS-garantie (FK vers stdsousgarantie)
            JOIN stdsousgarantie sg ON sg.idsousgarantie = dg.idgarantie
            WHERE dd.{t['cle']} = %s AND dg.idgarantie <> 0 AND dg.acquise
            """,
            [objet.pk],
        )
        lignes = cursor.fetchall()

        cursor.execute(
            f"SELECT count(*) FROM {t['detail']} WHERE {t['cle']} = %s", [objet.pk]
        )
        nb_vehicules = cursor.fetchone()[0]

    def montant(value):
        return f"{int(value):,}".replace(",", " ")

    def texte_franchise(fixe, texte, taux, mini, maxi):
        if clean(texte):
            return clean(texte)
        if taux and taux > 0:
            parts = [f"{taux.normalize():f}%"]
            if mini and mini > 0:
                parts.append(f"minimum {montant(mini)}")
            if maxi and maxi > 0:
                parts.append(f"maximum {montant(maxi)}")
            return " ".join(parts)
        if fixe and fixe > 0:
            return montant(fixe)
        return None

    garanties = {}
    for idg, libelle, capital, fixe, texte, taux, mini, maxi, prime in lignes:
        g = garanties.setdefault(
            idg,
            {
                "id_garantie": idg,
                "nature": libelle,
                "capitaux": set(),
                "franchises": set(),
                "prime_nette": Decimal(0),
                "nb_vehicules": 0,
            },
        )
        g["capitaux"].add(int(capital or 0))
        g["franchises"].add(texte_franchise(fixe, texte, taux, mini, maxi))
        g["prime_nette"] += prime or 0
        g["nb_vehicules"] += 1

    def nom_complet(nom, prenoms):
        return clean(f"{nom or ''} {prenoms or ''}")

    def adresse(adr1, adr2):
        return clean(" ".join(filter(None, [clean(adr1), clean(adr2)])))

    return {
            "client": {
                "titre": clean(titre),
                "nom": nom_complet(c_nom, c_prenoms),
                "adresse": adresse(c_adr1, c_adr2),
                "telephone": clean(c_mobile) or clean(c_tel) or clean(c_fixe),
                "profession": clean(profession),
            },
            "intermediaire": clean(intermediaire),
            "quittance": {
                "numero_police": clean(objet.numeropolice if contrat else objet.numerodevis),
                "assure": nom_complet(a_nom, a_prenoms) or clean(getattr(objet, "nomassure", None)),
                "adresse_assure": adresse(a_adr1, a_adr2),
                "date_effet": objet.dateeffet,
                "date_expiration": objet.dateexpiration,
                "offre": clean(libelle_offre),
                "mouvement": clean(mouvement),
                "duree_jours": objet.duree_terme_jours,
                "date_emission": objet.dateemission,
            },
            "flotte": bool(objet.flotte),
            "nb_vehicules": nb_vehicules,
            # Capitaux / franchises distincts entre véhicules (1 seule valeur en mono) ;
            # 0 et null signifient « non renseigné »
            "garanties": [
                {
                    **g,
                    "capitaux": sorted(g["capitaux"]),
                    "franchises": sorted(g["franchises"], key=lambda f: f or ""),
                    "prime_nette": int(g["prime_nette"]),
                }
                for g in sorted(garanties.values(), key=lambda g: g["nature"])
            ],
            "montants": {
                "accessoire": int(objet.accessoire or 0),
                "taxe": int(objet.taxe or 0),
                "fga": int(objet.fga or 0),
                "cedeao": int(objet.cedeao or 0),
                "prime_ttc_enregistree": int(objet.primettc or 0),
            },
        }


class DevisViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    serializer_class = DevisSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        from django.utils import timezone
        from datetime import timedelta

        queryset = (
            Devis.objects.prefetch_related("piece_jointe")
            .annotate(
                offreboisee=OffreAutomobileBoisee(F("offre__IdOffre")),
                libelle_categorie=RawSQL(DEVIS_CATEGORIE_SQL, []),
            )
            .all()
        )

        # Filtre par défaut de la liste : 3 dernières années. Un devis demandé par son id
        # reste lisible quel que soit son âge (« Modifier », aperçu d'un devis plus ancien).
        if self.action == "list":
            three_years_ago = timezone.now() - timedelta(days=365 * 3)
            queryset = queryset.filter(dateemission__gte=three_years_ago)

        # Filtre par produit
        idproduit = self.request.query_params.get("idproduit")
        if idproduit:
            if "," in str(idproduit):
                ids = [int(x) for x in str(idproduit).split(",") if x.isdigit()]
                queryset = queryset.filter(produit_id__in=ids)
            elif str(idproduit).isdigit():
                queryset = queryset.filter(produit_id=int(idproduit))

        # Filtre par archive
        archive = self.request.query_params.get("archive")
        if archive is not None:
            if str(archive).lower() in ["true", "1"]:
                queryset = queryset.filter(archive=True)
            elif str(archive).lower() in ["false", "0"]:
                queryset = queryset.filter(archive=False)

        # Filtre par confirmation
        confirme = self.request.query_params.get("confirme")
        if confirme is not None:
            if str(confirme).lower() in ["true", "1"]:
                queryset = queryset.filter(confirme=True)
            elif str(confirme).lower() in ["false", "0"]:
                queryset = queryset.filter(confirme=False)

        # Un devis confirmé donne systématiquement lieu à un Contrat (créés ensemble
        # à la confirmation) : sans ce filtre, un devis confirmé est compté une
        # deuxième fois en plus de son contrat déjà émis (Portefeuille des Contrats,
        # onglet « En cours »). sans_contrat=true ne garde que les devis confirmés
        # réellement encore en attente d'émission d'un contrat.
        sans_contrat = self.request.query_params.get("sans_contrat")
        if sans_contrat is not None and str(sans_contrat).lower() in ["true", "1"]:
            queryset = queryset.filter(contrat__isnull=True)

        # Filtre « expiré avant » (Portefeuille des Contrats : devis non confirmés
        # dont l'échéance est dépassée, à faire figurer dans l'onglet « À
        # Renouveler / Échues »). Date ISO (AAAA-MM-JJ).
        dateexpiration_avant = self.request.query_params.get("dateexpiration_avant")
        if dateexpiration_avant:
            queryset = queryset.filter(dateexpiration__date__lt=dateexpiration_avant)

        # Les devis les plus récents en premier
        return queryset.order_by("-dateemission", "-iddevis")

    @action(detail=True, methods=["get"], url_path="garanties")
    def get_garanties(self, request, pk=None):
        """
        Retourne toutes les garanties d'un devis donné, sans duplication.
        """
        devis = cast(Devis, self.get_object())
        garanties = DevisDetGarantie.objects.filter(
            IdDevisDet__iddevis=devis
        ).distinct("IdGarantie_id")
        serializer = DevisDetailGarantieSerializer(garanties, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="conditions-particulieres")
    def conditions_particulieres(self, request, pk=None):
        """Données des Conditions Particulières du devis (voir donnees_conditions_particulieres)."""
        devis = cast(Devis, self.get_object())
        return Response(donnees_conditions_particulieres(devis, contrat=False), status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="vehicules-flotte")
    def vehicules_flotte(self, request, pk=None):
        """Véhicules et garanties d'une flotte (voir vehicules_conditions_particulieres_flotte)."""
        devis = cast(Devis, self.get_object())
        return Response(vehicules_conditions_particulieres_flotte(devis.pk), status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=["post"],
        parser_classes=[MultiPartParser, FormParser],
    )
    def attacher_piece_jointe(self, request, pk=None):
        """
        Attacher une pièce jointe à un devis

        Body (multipart/form-data):
        - fichier: Le fichier à joindre (PDF, JPG, PNG)
        """
        devis = self.get_object()

        if "fichier" not in request.FILES:
            return Response(
                {"erreur": "Aucun fichier fourni"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Créer la pièce jointe
        piece_serializer = PieceJointeSerializer(
            data={"fichier": request.FILES["fichier"]},
            context={"request": request},
        )

        if piece_serializer.is_valid():
            piece_jointe = piece_serializer.save()

            # Attacher au devis
            devis.piece_jointe = piece_jointe
            devis.save()

            # Retourner le devis mis à jour
            devis_serializer = DevisSerializer(
                devis, context={"request": request}
            )
            return Response(devis_serializer.data, status=status.HTTP_200_OK)

        return Response(
            piece_serializer.errors, status=status.HTTP_400_BAD_REQUEST
        )

    @action(detail=True, methods=["get"])
    def telecharger_piece_jointe(self, request, pk=None):
        devis = cast(Devis, self.get_object())
        if not devis.piece_jointe or not devis.piece_jointe.fichier:
            raise Http404("Pas de pièce jointe")

        return FileResponse(
            open(devis.piece_jointe.fichier.path, "rb"),
            as_attachment=True,
            filename=devis.piece_jointe.fichier.name,
        )

    # @action(detail=True, methods=["get"], url_path="piece-jointe")
    @action(detail=True, methods=["get"])
    def obtenir_url_piece_jointe(self, request, pk=None):
        try:
            devis = cast(Devis, self.get_object())
            if not devis.piece_jointe or not devis.piece_jointe.fichier:
                raise Http404("Pas de pièce jointe pour ce devis")

            # Retourner uniquement l’URL sécurisée
            return Response(
                {
                    "id": devis.piece_jointe.pk,
                    "nom_fichier": devis.piece_jointe.fichier.name,
                    "url": devis.piece_jointe.fichier.url,
                }
            )
        except Devis.DoesNotExist:
            raise Http404("Devis introuvable")


class CertificatTransportView(generics.ListCreateAPIView):
    queryset = CertificatTransport.objects.all().order_by("-date_fin_periode")[
        :1000
    ]
    serializer_class = CertificatTransportSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get_queryset(self):
        start_date = self.request.query_params.get("datedebutperiode", None)
        end_date = self.request.query_params.get("datefinperiode", None)
        customer_id = self.request.query_params.get("idclient", None)

        return get_certificat_transport(start_date, end_date, customer_id)


class DevisClientView(generics.ListAPIView):
    queryset = Devis.objects.filter(confirme=True, archive=False)
    serializer_class = DevisClientSerializer

    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get_queryset(self):
        from django.db.models import Count

        id_client = self.request.query_params.get("idclient", None)
        nom_client = self.request.query_params.get("nomclient", None)
        id_produit = self.request.query_params.get("idproduit", None)
        devis_qs = Devis.objects.annotate(
            nombre_objets=Count("details")
        ).filter(confirme=False, archive=False, flotte=False, nombre_objets=1)
        try:
            if nom_client:
                clients = Client.objects.filter(
                    Q(Nom__istartswith=nom_client)
                    | Q(Prenoms__istartswith=nom_client)
                )
                if clients:
                    devis_qs = devis_qs.filter(client__in=clients)
            if id_client:
                client = Client.objects.get(pk=id_client)
                devis_qs = devis_qs.filter(client=client)
            if id_produit:
                produit = Produit.objects.get(pk=id_produit)
                devis_qs = devis_qs.filter(produit=produit)
        except Client.DoesNotExist as ec:
            print(ec)
            devis_qs = devis_qs.filter(iddevis=0)
        except Produit.DoesNotExist as eq:
            print(eq)
            devis_qs = devis_qs.filter(iddevis=0)
        devis_qs = devis_qs.prefetch_related(
            Prefetch(
                "details",
                queryset=DevisDetail.objects.filter(iddevis__in=devis_qs),
            )
        )
        return devis_qs


class ConsolidationDevisView(APIView):
    """
    Vue pour consolider plusieurs devis en un seul.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user_id = request.user.id
        # Validation du format de données
        serializer = ConsolidationDevisClientSerializer(
            data=request.data, many=True
        )
        if not serializer.is_valid():
            return Response(
                {"erreur": "Format de données invalide."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Extraction des IDs de devis
        devis_ids = [item["iddevis"] for item in serializer.validated_data]

        # Vérification du nombre minimum de devis. Il en faut au moins deux.
        if len(devis_ids) < 2:
            return Response(
                {
                    "erreur": (
                        "Au minimum 2 devis sont requis pour la "
                        "consolidation."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Récupération des devis depuis la base de données
        devis_list = Devis.objects.filter(iddevis__in=devis_ids)

        # Vérification que tous les devis existent
        if devis_list.count() != len(devis_ids):
            return Response(
                {"erreur": "Un ou plusieurs devis n'existent pas."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Vérification que tous les devis sont mono
        if devis_list.filter(flotte=True).count() > 0:
            return Response(
                {"erreur": "Tous les devis doivent être mono."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Vérification que tous les devis sont non confirmés et non archivés
        if devis_list.filter(Q(archive=True) | Q(confirme=True)).count() > 0:
            return Response(
                {
                    "erreur": "Tous les devis doivent être non confirmés et non archivés."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Vérification que tous les devis appartiennent au même client
        clients = devis_list.values_list("client", flat=True).distinct()
        if len(clients) > 1:
            return Response(
                {
                    "erreur": "Tous les devis doivent appartenir au même client."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Vérification que tous les devis concernent le même produit
        produits = devis_list.values_list("produit", flat=True).distinct()
        if len(produits) > 1:
            return Response(
                {
                    "erreur": "Tous les devis doivent concerner le même produit."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Vérification que tous les devis concernent la compagnie
        compagnies = devis_list.values_list("compagnie", flat=True).distinct()
        if len(compagnies) > 1:
            return Response(
                {
                    "erreur": "Tous les devis doivent être produits sur la même compagnie."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Vérification que tous les devis concernent le même intermediaire
        intermediaires = devis_list.values_list(
            "intermediaire", flat=True
        ).distinct()
        if len(intermediaires) > 1:
            return Response(
                {
                    "erreur": "Tous les devis doivent être produits pour le même intermédiaire."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Vérification que tous les devis concernent le même assuré
        assures = devis_list.values_list("assure", flat=True).distinct()
        if len(assures) > 1:
            return Response(
                {"erreur": "Tous les devis doivent concerner le même assuré."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Vérification que tous les devis concernent le même avenant
        avenants = devis_list.values_list("avenant", flat=True).distinct()
        if len(avenants) > 1:
            return Response(
                {"erreur": "Tous les devis doivent avoir le même avenant."},
                status=status.HTTP_403_FORBIDDEN,
            )
        dates_effet = devis_list.values_list("dateeffet", flat=True).distinct()
        if len(dates_effet) > 1:
            return Response(
                {
                    "erreur": "Tous les devis doivent avoir la même date d'effet."
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        dates_expiration = devis_list.values_list(
            "dateexpiration", flat=True
        ).distinct()
        if len(dates_expiration) > 1:
            return Response(
                {
                    "erreur": "Tous les devis doivent avoir la même date d'expiration."
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        # Appel de la fonction utilitaire pour consolider les devis
        try:
            id_devis_consolide = consolider_devis_db(user_id, devis_ids)

            return Response(
                {
                    "iddevis": id_devis_consolide,
                    "message": "Devis consolidés avec succès.",
                },
                status=status.HTTP_200_OK,
            )

        except Exception as e:
            return Response(
                {"erreur": f"Erreur lors de la consolidation: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )


class DevisDetailViewSet(viewsets.ModelViewSet):
    queryset = DevisDetail.objects.all()
    serializer_class = DevisDetailSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class DevisDetGarantieViewSet(viewsets.ModelViewSet):
    queryset = DevisDetGarantie.objects.filter(~Q(IdGarantie=0))
    serializer_class = DevisDetGarantieSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class TarifEcranViewSet(viewsets.ModelViewSet):
    queryset = TarifEcran.objects.all()
    serializer_class = TarifEcranSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class ContratViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    queryset = Contrat.objects.prefetch_related("piece_jointe").filter(
        Q(idcontratannulation=0)
    )
    serializer_class = ContratSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @action(detail=True, methods=["get"], url_path="conditions-particulieres")
    def conditions_particulieres(self, request, pk=None):
        """Données des Conditions Particulières du contrat (voir donnees_conditions_particulieres)."""
        contrat = cast(Contrat, self.get_object())
        return Response(donnees_conditions_particulieres(contrat, contrat=True), status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="vehicules-flotte")
    def vehicules_flotte(self, request, pk=None):
        """Véhicules et garanties d'une flotte (voir vehicules_conditions_particulieres_flotte)."""
        contrat = cast(Contrat, self.get_object())
        return Response(vehicules_conditions_particulieres_flotte(contrat.pk, contrat=True), status=status.HTTP_200_OK)

    def get_queryset(self):
        from django.utils import timezone
        from datetime import timedelta

        # Statut du contrat (Portefeuille des Contrats : onglets « En cours »,
        # « À Renouveler / Échues », « Résiliées »). Par défaut (aucun statut
        # demandé), on garde le comportement historique : contrats non résiliés,
        # quelle que soit leur échéance.
        statut = self.request.query_params.get("statut")
        if statut == "resilie":
            # Les résiliés/annulés sont exclus du queryset de base : on repart
            # d'une requête neuve plutôt que d'essayer de retirer ce filtre.
            queryset = Contrat.objects.prefetch_related("piece_jointe").filter(
                ~Q(idcontratannulation=0)
            )
        else:
            queryset = super().get_queryset()
            if statut in ("actif", "echeance"):
                seuil = timezone.now() + timedelta(days=30)
                if statut == "echeance":
                    queryset = queryset.filter(dateexpiration__lte=seuil)
                else:
                    queryset = queryset.filter(
                        Q(dateexpiration__isnull=True) | Q(dateexpiration__gt=seuil)
                    )

        if self.request.query_params.get("a_encaisser") in ("1", "true"):
            # Caisse : même règle que fn_liste_contrat_encaissement (URANUS), la quittance du
            # contrat n'est pas soldée. Sans fenêtre de 3 ans : un devis ancien confirmé
            # aujourd'hui garde sa date d'émission. Derniers contrats confirmés en tête, sinon
            # ils sortent des 200 lignes de la page.
            from django.db.models import Value
            from django.db.models.functions import Coalesce

            queryset = queryset.annotate(
                solde_quittance=F("idquittance__primettc")
                - Coalesce(F("idquittance__mt_encaisse"), Value(Decimal(0)))
            ).filter(
                idquittance__police=F("numeropolice"), solde_quittance__gt=0
            ).order_by("-idcontrat")
        else:
            # Portefeuille des Contrats : seuls les contrats émis durant les 3 dernières
            # années sont affichés (même fenêtre que le Registre des Devis).
            three_years_ago = timezone.now() - timedelta(days=365 * 3)
            queryset = queryset.filter(dateemission__gte=three_years_ago)

        # Filtre par produit (Portefeuille des Contrats : onglets par branche).
        # Le paramètre idproduit peut être un identifiant unique ou une liste
        # séparée par des virgules (ex. "4,7,9" pour MRH/MRP/Tous Dommages).
        idproduit = self.request.query_params.get("idproduit")
        if idproduit:
            if "," in str(idproduit):
                ids = [int(x) for x in str(idproduit).split(",") if x.isdigit()]
                queryset = queryset.filter(idproduit_id__in=ids)
            elif str(idproduit).isdigit():
                queryset = queryset.filter(idproduit_id=int(idproduit))

        # Relations sérialisées (depth=1) et offre boisée chargées dans la même requête :
        # évite 8 à 10 requêtes par contrat sur les listes de 200 lignes
        return queryset.select_related(
            "iddevis", "idcompagnie", "idintermediaire", "idproduit",
            "idclient", "idavenant", "idquittance", "piece_jointe",
        ).annotate(offreboisee_annotee=OffreAutomobileBoisee(F("iddevis__offre__IdOffre")))

    @action(detail=True, methods=["get"], url_path="garanties")
    def get_garanties(self, request, pk=None):
        """
        Retourne toutes les garanties d'un contrat
        donné, sans duplication.
        """
        contrat = cast(Contrat, self.get_object())
        garanties = ContratDetGarantie.objects.filter(
            idcontratdetail__idcontrat=contrat
        ).distinct("idgarantie_id")
        serializer = ContratDetGarantieSerializer(garanties, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=["post"],
        parser_classes=[MultiPartParser, FormParser],
    )
    def attacher_piece_jointe(self, request, pk=None):
        """
        Attacher une pièce jointe à un contrat

        Body (multipart/form-data):
        - fichier: Le fichier à joindre (PDF, JPG, PNG)
        """
        contrat = self.get_object()

        if "fichier" not in request.FILES:
            return Response(
                {"error": "Aucun fichier fourni"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Créer la pièce jointe
        piece_serializer = PieceJointeSerializer(
            data={"fichier": request.FILES["fichier"]},
            context={"request": request},
        )

        if piece_serializer.is_valid():
            piece_jointe = piece_serializer.save()

            # Attacher au contrat
            contrat.piece_jointe = piece_jointe
            contrat.save()

            # Retourner le contrat mis à jour
            contrat_serializer = ContratSerializer(
                contrat, context={"request": request}
            )
            return Response(contrat_serializer.data, status=status.HTTP_200_OK)

        return Response(
            piece_serializer.errors, status=status.HTTP_400_BAD_REQUEST
        )

    @action(detail=True, methods=["get"])
    def telecharger_piece_jointe(self, request, pk=None):
        contrat = cast(Contrat, self.get_object())
        if not contrat.piece_jointe or not contrat.piece_jointe.fichier:
            raise Http404("Pas de pièce jointe")

        return FileResponse(
            open(contrat.piece_jointe.fichier.path, "rb"),
            as_attachment=True,
            filename=contrat.piece_jointe.fichier.name,
        )

    @action(detail=True, methods=["get"])
    def obtenir_url_piece_jointe(self, request, pk=None):
        try:
            contrat = cast(Contrat, self.get_object())
            if not contrat.piece_jointe or not contrat.piece_jointe.fichier:
                raise Http404("Pas de pièce jointe pour ce devis")

            # Retourner uniquement l’URL sécurisée
            return Response(
                {
                    "id": contrat.piece_jointe.pk,
                    "nom_fichier": contrat.piece_jointe.fichier.name,
                    "url": contrat.piece_jointe.fichier.url,
                }
            )
        except Devis.DoesNotExist:
            raise Http404("Devis introuvable")


class ContratRestreintViewSet(viewsets.ModelViewSet):
    queryset = Contrat.objects.filter(Q(idcontratannulation=0)).order_by(
        "-dateemission"
    )[:500]
    serializer_class = ContratSerializer
    permission_classes = [permissions.IsAuthenticated]


class ContratDetailViewSet(viewsets.ModelViewSet):
    queryset = ContratDetail.objects.all()
    serializer_class = ContratDetailSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class ContratDetGarantieViewSet(viewsets.ModelViewSet):
    queryset = ContratDetGarantie.objects.filter(~Q(idgarantie=0))
    serializer_class = ContratDetGarantieSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class AyantDroitMineneView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, numeropolice):
        numeropolice = str(numeropolice).strip()
        assures = Client.objects.filter(Adresse2=numeropolice)
        idassure = -1
        if assures:
            idassure = assures.first().IdClient
        ayant_droits_queryset = AyantDroitIa.objects.filter(id_assure=idassure)
        serializer = AyantDroitIaSerializer(ayant_droits_queryset, many=True)
        # print(serializer.data)
        return Response(
            {"Status": "Succès", "ayantdroits": serializer.data},
            status=status.HTTP_200_OK,
        )


class AyantDroitIaView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idassure):
        # if idassure:
        ayant_droits_queryset = AyantDroitIa.objects.filter(id_assure=idassure)
        # else:
        #    ayant_droits_queryset = AyantDroitIa.objects.all()
        serializer = AyantDroitIaSerializer(ayant_droits_queryset, many=True)
        # print(serializer.data)
        return Response(
            {"Status": "Succès", "ayantdroits": serializer.data},
            status=status.HTTP_200_OK,
        )


class AdherentsSantePourDevisIAView(APIView):
    """
    Retourne les adhérents actifs du contrat Santé MINENE lié au devis IA.
    Utilise le champ numero_police_connexe du devis IA pour retrouver le contrat Santé.
    Chaque adhérent est retourné avec ses affiliés actifs.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, id_devis_ia):
        try:
            devis_ia = Devis.objects.get(pk=id_devis_ia)
        except Devis.DoesNotExist:
            return Response(
                {"Status": "Erreur", "message": "Devis IA introuvable."},
                status=status.HTTP_404_NOT_FOUND,
            )

        numeropolice_sante = devis_ia.numero_police_connexe
        if not numeropolice_sante:
            return Response(
                {"Status": "Erreur", "message": "Aucun numéro de police Santé connexe sur ce devis IA."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        contrat_sante = Contrat.objects.filter(numeropolice=numeropolice_sante).first()
        if not contrat_sante:
            return Response(
                {"Status": "Erreur", "message": f"Aucun contrat Santé trouvé pour la police '{numeropolice_sante}'."},
                status=status.HTTP_404_NOT_FOUND,
            )

        iddevis_sante = contrat_sante.iddevis_id
        adherents = Adherent.objects.filter(devis=iddevis_sante, actif=True)

        result = []
        for adherent in adherents:
            affilies = list(
                Affilie.objects.filter(adherent=adherent, actif=True).values(
                    "idaffilie", "nom", "prenom", "lien", "date_naissance", "sexe"
                )
            )
            result.append({
                "idadherent": adherent.idadherent,
                "nom": adherent.nom,
                "prenom": adherent.prenom,
                "sexe": adherent.sexe,
                "date_naissance": adherent.datenaissanceadherent,
                "affilies": affilies,
            })

        return Response(
            {"Status": "Succès", "adherents": result, "numeropolice_sante": numeropolice_sante},
            status=status.HTTP_200_OK,
        )


class TransformerSanteEnIAView(APIView):
    """
    Transforme les adhérents du contrat Santé MINENE en assurés du devis IA MINENE,
    et les affiliés Santé MINENE en ayants-droits IA MINENE.

    Chaque adhérent actif → Client (assuré IA) lié au devis IA via sp_creation_assure_ia.
    Chaque affilié actif → ayant-droit via sp_saisie_ayant_droit_ia.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = TransformerSanteEnIASerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        id_devis_ia = serializer.validated_data["id_devis_ia"]
        capital_deces = serializer.validated_data["capital_deces"]
        capital_ipp = serializer.validated_data["capital_ipp"]
        frais_traitement = serializer.validated_data["frais_traitement"]
        affilies_qualites = serializer.validated_data.get("affilies_qualites", [])
        qualites_map = {item["idaffilie"]: item["id_qualite"] for item in affilies_qualites}

        try:
            devis_ia = Devis.objects.get(pk=id_devis_ia)
        except Devis.DoesNotExist:
            return Response(
                {"Status": "Erreur", "message": "Devis IA introuvable."},
                status=status.HTTP_404_NOT_FOUND,
            )

        numeropolice_sante = devis_ia.numero_police_connexe
        if not numeropolice_sante:
            return Response(
                {"Status": "Erreur", "message": "Aucun numéro de police Santé connexe sur ce devis IA."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        contrat_sante = Contrat.objects.filter(numeropolice=numeropolice_sante).first()
        if not contrat_sante:
            return Response(
                {"Status": "Erreur", "message": f"Aucun contrat Santé trouvé pour la police '{numeropolice_sante}'."},
                status=status.HTTP_404_NOT_FOUND,
            )

        iddevis_sante = contrat_sante.iddevis_id
        adherents = Adherent.objects.filter(devis=iddevis_sante, actif=True)

        assures_crees = []
        ayants_droits_crees = []
        erreurs = []

        for adherent in adherents:
            # 1. Créer ou trouver le Client (assuré IA) à partir de l'adhérent Santé
            # La vérification du nom évite de retourner le souscripteur Santé en cas
            # de collision de CNI entre le souscripteur et l'adhérent.
            client = _find_or_create_client_from_adherent(adherent)
            if not client:
                erreurs.append({"type": "adherent", "idadherent": adherent.idadherent, "message": "Impossible de créer ou trouver le client pour cet adhérent."})
                continue

            # 2. Lier ce client au devis IA via sp_enregistrement_assure_ia
            # Récupérer id_tarif depuis un DevisDetail existant, sinon 103 (MINENE)
            detail_existant = DevisDetail.objects.filter(iddevis=id_devis_ia).first()
            id_tarif = detail_existant.idtarif if detail_existant else 103

            date_naissance = (
                adherent.datenaissanceadherent if adherent.datenaissanceadherent
                else None
            )
            date_effet = devis_ia.dateeffet.date() if hasattr(devis_ia.dateeffet, 'date') else devis_ia.dateeffet
            date_expiration = devis_ia.dateexpiration.date() if hasattr(devis_ia.dateexpiration, 'date') else devis_ia.dateexpiration

            id_devis_detail_out = 0
            out_message = ""
            err_ia = False
            try:
                with connection.cursor() as cur:
                    cur.execute(
                        "CALL sp_enregistrement_assure_ia(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s);",
                        (
                            devis_ia.compagnie_id,       # id_compagnie
                            devis_ia.produit_id,          # id_produit
                            devis_ia.offre_id,            # id_offre
                            client.IdClient,              # id_assure
                            12,                           # id_profession (défaut)
                            date_effet,                   # date_effet
                            date_expiration,              # date_expiration
                            id_tarif,                     # id_tarif
                            capital_deces,                # capital_deces
                            capital_ipp,                  # capital_ipp
                            frais_traitement,             # frais_traitement
                            0,                            # taux_reduction
                            "01",                         # code_activite
                            date_naissance,               # date_naissance
                            adherent.adresseadherent or "",  # adresse_geographique
                            id_devis_ia,                  # id_devis
                            0,                            # prime_nette
                            0,                            # montant_accessoire
                            0,                            # prime_ttc
                            id_devis_detail_out,          # INOUT id_devis_detail
                            out_message,                  # INOUT out_message
                        ),
                    )
                    connection.commit()
                    row = cur.fetchone()
                    id_devis_detail_out = row[0] if row else 0
                    out_message = row[1] if row and len(row) > 1 else ""
            except Exception as e_ia:
                err_ia = True
                out_message = str(e_ia).split("\n")[0]

            # "déjà enregistré" peut venir d'un RAISE EXCEPTION (err_ia=True) ou d'un out_message (err_ia=False)
            deja_existant = "déjà" in out_message.lower()
            if err_ia and not deja_existant:
                erreurs.append({"type": "assure", "idadherent": adherent.idadherent, "message": out_message})
            else:
                # Succès : nouvellement créé ou déjà présent dans ce devis
                assures_crees.append({"idadherent": adherent.idadherent, "id_assure": client.IdClient, "existant": deja_existant})

            id_assure_ia = client.IdClient

            # 3. Créer les ayants-droits à partir des affiliés de cet adhérent
            affilies = Affilie.objects.filter(adherent=adherent, actif=True)
            for affilie in affilies:
                id_qualite = qualites_map.get(affilie.idaffilie)
                if not id_qualite:
                    erreurs.append({
                        "type": "ayant_droit",
                        "idaffilie": affilie.idaffilie,
                        "message": "Qualité non fournie pour cet affilié.",
                    })
                    continue

                ayant_droit_data = {
                    "IdAssure": id_assure_ia,
                    "IdQualiteAyantDroit": id_qualite,
                    "NomAyantDroit": affilie.nom,
                    "PrenomsAyantDroit": affilie.prenom or affilie.nom,
                    "Part": 0,
                }
                result_ad = enregistrer_ayant_droit(ayant_droit_data)
                if result_ad and result_ad[0].ObjectId > 0:
                    ayants_droits_crees.append({
                        "idaffilie": affilie.idaffilie,
                        "id_ayant_droit": result_ad[0].ObjectId,
                    })
                else:
                    msg = result_ad[0].OutputMessage if result_ad else "Erreur inconnue."
                    erreurs.append({"type": "ayant_droit", "idaffilie": affilie.idaffilie, "message": msg})

        nouveaux = [a for a in assures_crees if not a.get("existant")]
        existants = [a for a in assures_crees if a.get("existant")]
        return Response(
            {
                "Status": "Succès",
                "assures_crees": len(nouveaux),
                "assures_deja_presents": len(existants),
                "ayants_droits_crees": len(ayants_droits_crees),
                "erreurs": len(erreurs),
                "details_erreurs": erreurs,
            },
            status=status.HTTP_200_OK,
        )


def _find_or_create_client_from_adherent(adherent):
    """Trouve ou crée un Client à partir d'un adhérent Santé.

    La recherche par CNI inclut une vérification du nom pour éviter de retourner
    un client différent qui partagerait accidentellement le même numéro CNI
    (ex. : le souscripteur du contrat Santé dont le CNI aurait été saisi par erreur
    sur l'adhérent).
    """
    import re as _re

    def _nom_correspond(candidate):
        """Retourne True si le nom du candidat correspond à celui de l'adhérent."""
        if not candidate or not candidate.Nom or not adherent.nom:
            return True  # Pas d'info suffisante → on accepte le candidat
        return candidate.Nom.strip().upper() == adherent.nom.strip().upper()

    client = None

    # Recherche par CNI avec vérification de nom
    if adherent.numerocni:
        candidate = Client.objects.filter(cle_unique=f"CNI-{adherent.numerocni}").first()
        if candidate and _nom_correspond(candidate):
            client = candidate
        # Sinon : collision CNI avec une personne différente → on crée un nouveau client

    if client is None:
        # Tentative d'insertion. Si le CNI provoque une collision (nom différent),
        # on retente sans CNI pour forcer une clé composite propre à cet adhérent.
        for numerocni_essai in [adherent.numerocni or "", ""]:
            try:
                client = insert_new_assure({
                    "Nom": adherent.nom,
                    "Prenoms": adherent.prenom or "",
                    "NumeroCNI": numerocni_essai,
                    "DateNaissance": adherent.datenaissanceadherent,
                    "Sexe": adherent.sexe or "",
                    "NumeroTelephone": getattr(adherent, "mobile1", "") or "",
                    "NumeroMobile": getattr(adherent, "mobile1", "") or "",
                    "AdressePostale": getattr(adherent, "adresseadherent", "") or "",
                    "AdresseGeographique": getattr(adherent, "adresseadherent", "") or "",
                })
                break  # Insertion réussie
            except Exception as e:
                msg = str(e)
                if "stdclient_cle_unique_key" in msg or "cle_unique" in msg:
                    match = _re.search(r"\(cle_unique\)=\(([^)]+)\)", msg)
                    if match:
                        candidate = Client.objects.filter(cle_unique=match.group(1)).first()
                        if candidate and _nom_correspond(candidate):
                            client = candidate
                            break
                    # Collision avec un nom différent et on a encore le CNI à essayer
                    if numerocni_essai:
                        continue  # Retenter sans CNI
                # Autre erreur ou deuxième tentative épuisée : on abandonne
                break

    return client


def _build_lien_qualite_map():
    """Construit un dict {codelien: id_qualite} en croisant LienJuridiqueSante et QualiteAyantDroit."""
    from configuration_api.models import QualiteAyantDroit, LienJuridiqueSante
    qualite_map = {}
    for lj in LienJuridiqueSante.objects.all():
        # Tentative 1 : code_qualite_ayant_droit commence par le même code
        qualite = QualiteAyantDroit.objects.filter(
            code_qualite_ayant_droit__istartswith=lj.codelien
        ).first()
        if not qualite and len(lj.libellelien) >= 2:
            # Tentative 2 : libelle similaire
            qualite = QualiteAyantDroit.objects.filter(
                libelle_qualite_ayant_droit__icontains=lj.libellelien[:4]
            ).first()
        if qualite:
            qualite_map[lj.codelien] = qualite.id_qualite
    return qualite_map


class CreerDevisIAMineneView(APIView):
    """
    Crée un devis IA MINENE de façon entièrement automatique :
    1. Cherche l'adhérent du contrat Santé via NumeroPoliceConnexe
    2. Crée/trouve le Client correspondant → utilisé comme souscripteur et assuré
    3. Enregistre le devis IA
    4. Transforme automatiquement tous les adhérents → assurés IA
    5. Transforme automatiquement tous les affiliés → ayants-droits IA
       (qualité déterminée à partir du champ lien de l'affilié Santé)
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from .models import DevisDetail, Devis as DevisModel
        from .database import save_quotation_ia

        data = dict(request.data)
        # Normaliser les valeurs (request.data peut renvoyer des listes pour chaque clé)
        data = {k: (v[0] if isinstance(v, list) and len(v) == 1 else v) for k, v in data.items()}

        numeropolice = str(data.get("NumeroPoliceConnexe", "")).strip()
        if not numeropolice:
            return Response({"Status": "Erreur", "message": "NumeroPoliceConnexe requis."}, status=status.HTTP_400_BAD_REQUEST)

        # 1. Contrat Santé
        contrat_sante = Contrat.objects.filter(numeropolice=numeropolice).first()
        if not contrat_sante:
            return Response(
                {"Status": "Erreur", "message": f"Aucun contrat Santé trouvé pour la police '{numeropolice}'."},
                status=status.HTTP_404_NOT_FOUND,
            )

        adherents = list(Adherent.objects.filter(devis=contrat_sante.iddevis_id, actif=True))
        if not adherents:
            return Response({"Status": "Erreur", "message": "Aucun adhérent actif pour ce contrat Santé."}, status=status.HTTP_404_NOT_FOUND)

        # 2. Client principal (souscripteur = assuré du devis IA)
        adherent_principal = adherents[0]
        client_principal = _find_or_create_client_from_adherent(adherent_principal)
        if not client_principal:
            return Response({"Status": "Erreur", "message": "Impossible de trouver/créer le client pour l'adhérent principal."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # 3. Préparer et enregistrer le devis IA
        # Le CLIENT du contrat Santé reste le souscripteur (IdClient) du devis IA.
        # Le premier ADHÉRENT Santé devient l'assuré (IdAssure) du devis IA.
        devis_data = dict(data)
        devis_data["IdClient"] = contrat_sante.idclient_id
        devis_data["IdAssure"] = client_principal.IdClient
        devis_data["Flotte"] = False
        # Date de naissance de l'assuré principal : celle de l'adhérent Santé (l'écran ne la saisit pas)
        if adherent_principal.datenaissanceadherent:
            devis_data["DateNaissance"] = adherent_principal.datenaissanceadherent

        (error, result_list) = save_quotation_ia(devis_data)
        if not result_list:
            return Response({"Status": "Erreur", "message": "Erreur lors de la création du devis IA."}, status=status.HTTP_400_BAD_REQUEST)

        id_devis = result_list[0].IdDevis
        output_msg = result_list[0].OutputMessage or ""
        if error or not id_devis or id_devis <= 0:
            return Response({"Status": "Erreur", "message": output_msg or "Erreur lors de la création du devis IA."}, status=status.HTTP_400_BAD_REQUEST)
        # sp_creation_devis_ia n'a pas de paramètre terme : posé sur le devis après création
        if data.get("IdTerme"):
            enregistrer_terme_devis(id_devis, data.get("IdTerme"))

        # 4. Transformation automatique adhérents → assurés IA / affiliés → ayants-droits IA
        try:
            devis_ia = DevisModel.objects.get(pk=id_devis)
        except DevisModel.DoesNotExist:
            return Response({"Status": "Succès partiel", "iddevis": id_devis, "message": "Devis créé, transformation impossible (devis introuvable)."}, status=status.HTTP_200_OK)

        devis_detail_obj = DevisDetail.objects.filter(iddevis=id_devis).first()
        id_tarif = devis_detail_obj.idtarif if devis_detail_obj else 103

        capital_deces = float(data.get("CapitalDeces", 0))
        capital_ipp = float(data.get("CapitalIpp", 0))
        frais_traitement = float(data.get("FraisTraitement", 0))
        date_effet = devis_ia.dateeffet.date() if hasattr(devis_ia.dateeffet, 'date') else devis_ia.dateeffet
        date_expiration = devis_ia.dateexpiration.date() if hasattr(devis_ia.dateexpiration, 'date') else devis_ia.dateexpiration

        qualite_map = _build_lien_qualite_map()

        assures_crees = []
        ayants_droits_crees = []
        erreurs = []

        for adherent in adherents:
            client = _find_or_create_client_from_adherent(adherent)
            if not client:
                erreurs.append({"type": "adherent", "idadherent": adherent.idadherent, "message": "Client introuvable"})
                continue

            date_naissance = adherent.datenaissanceadherent or date(1970, 1, 1)
            id_devis_detail_out = 0
            out_message = ""
            err_ia = False

            try:
                with connection.cursor() as cur:
                    cur.execute(
                        "CALL sp_enregistrement_assure_ia(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s);",
                        (
                            devis_ia.compagnie_id,
                            devis_ia.produit_id,
                            devis_ia.offre_id,
                            client.IdClient,
                            12,
                            date_effet,
                            date_expiration,
                            id_tarif,
                            capital_deces,
                            capital_ipp,
                            frais_traitement,
                            0,
                            "01",
                            date_naissance,
                            adherent.adresseadherent or "",
                            id_devis,
                            0,
                            0,
                            0,
                            id_devis_detail_out,
                            out_message,
                        ),
                    )
                    connection.commit()
                    row = cur.fetchone()
                    id_devis_detail_out = row[0] if row else 0
                    out_message = row[1] if row and len(row) > 1 else ""
            except Exception as e_ia:
                err_ia = True
                out_message = str(e_ia).split("\n")[0]

            deja_existant = "déjà" in out_message.lower()
            if err_ia and not deja_existant:
                erreurs.append({"type": "assure", "idadherent": adherent.idadherent, "message": out_message})
            else:
                assures_crees.append(adherent.idadherent)

            # Ayants-droits depuis affiliés
            for affilie in Affilie.objects.filter(adherent=adherent, actif=True):
                id_qualite = qualite_map.get(affilie.lien)
                if not id_qualite:
                    continue
                try:
                    enregistrer_ayant_droit({
                        "IdAssure": client.IdClient,
                        "IdQualiteAyantDroit": id_qualite,
                        "NomAyantDroit": affilie.nom,
                        "PrenomsAyantDroit": affilie.prenom or "",
                        "Part": 0,
                    })
                    ayants_droits_crees.append(affilie.idaffilie)
                except Exception as e_ad:
                    erreurs.append({"type": "ayant_droit", "idaffilie": affilie.idaffilie, "message": str(e_ad).split("\n")[0]})

        return Response(
            {
                "Status": "Succès",
                "iddevis": id_devis,
                "assures_crees": len(assures_crees),
                "ayants_droits_crees": len(ayants_droits_crees),
                "erreurs": len(erreurs),
                "details_erreurs": erreurs,
            },
            status=status.HTTP_200_OK,
        )


class ClientDepuisPoliceMineneView(APIView):
    """
    Retourne le client (souscripteur/assuré) correspondant à l'adhérent principal
    du contrat Santé MINENE identifié par son numéro de police.
    Utilisé pour auto-remplir souscripteur/assuré lors de la création d'un devis IA MINENE.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        numeropolice = request.query_params.get("numeropolice", "").strip()
        if not numeropolice:
            return Response(
                {"Status": "Erreur", "message": "Le paramètre 'numeropolice' est requis."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        contrat_sante = Contrat.objects.filter(numeropolice=numeropolice).first()
        if not contrat_sante:
            return Response(
                {"Status": "Erreur", "message": f"Aucun contrat Santé trouvé pour la police '{numeropolice}'."},
                status=status.HTTP_404_NOT_FOUND,
            )

        adherents = Adherent.objects.filter(devis=contrat_sante.iddevis_id, actif=True)
        if not adherents.exists():
            return Response(
                {"Status": "Erreur", "message": "Aucun adhérent actif trouvé pour ce contrat Santé."},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = []
        for adherent in adherents:
            client = None
            if adherent.numerocni:
                cle_unique = f"CNI-{adherent.numerocni}"
                client = Client.objects.filter(cle_unique=cle_unique).first()

            if client is None:
                # Tentative de création du client depuis les données de l'adhérent
                try:
                    client = insert_new_assure({
                        "Nom": adherent.nom,
                        "Prenoms": adherent.prenom or "",
                        "NumeroCNI": adherent.numerocni or "",
                        "DateNaissance": adherent.datenaissanceadherent,
                        "Sexe": adherent.sexe or "",
                        "NumeroTelephone": getattr(adherent, "telephone", "") or "",
                        "NumeroMobile": getattr(adherent, "telephone", "") or "",
                        "AdressePostale": getattr(adherent, "adresseadherent", "") or "",
                        "AdresseGeographique": getattr(adherent, "adresseadherent", "") or "",
                    })
                except Exception as e:
                    msg = str(e)
                    import re
                    match = re.search(r"\(cle_unique\)=\(([^)]+)\)", msg)
                    if match:
                        cle_unique_val = match.group(1)
                        client = Client.objects.filter(cle_unique=cle_unique_val).first()
                    if client is None and adherent.numerocni:
                        client = Client.objects.filter(cle_unique=f"CNI-{adherent.numerocni}").first()

            result.append({
                "idadherent": adherent.idadherent,
                "nom": adherent.nom,
                "prenom": adherent.prenom or "",
                "id_client": client.IdClient if client else None,
                "nom_complet": f"{adherent.nom} {adherent.prenom or ''}".strip(),
            })

        return Response(
            {"Status": "Succès", "adherents": result},
            status=status.HTTP_200_OK,
        )


def import_assures_view(request):
    if request.method == "POST":
        fichier = request.FILES["FichierExcel"]

        # Sauvegarder temporairement
        temp_path = f"/tmp/{fichier.name}"
        with open(temp_path, "wb+") as f:
            for chunk in fichier.chunks():
                f.write(chunk)

        # Configuration
        config = ConfigurationImport()

        # Import avec anti-doublons
        erreur, id_devis, rapport = importer_assures_anti_doublons(
            filepath=temp_path,
            user_id=request.user.id,
            request_post_data=request.POST.dict(),
            config=config,
        )

        # Nettoyer
        import os

        os.remove(temp_path)

        # Messages
        if not erreur:
            messages.success(
                request,
                f"✓ Import réussi! {len(rapport.assures_nouveaux)} créés, "
                f"{len(rapport.assures_ignores)} ignorés",
            )
        else:
            messages.error(request, f"✗ Erreur: {rapport.details_erreur}")

        return redirect("import_resultat")

    return render(request, "import_form.html")


class ImportationAssureIaViewSet(viewsets.ViewSet):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def create(self, request):
        message = {}
        id_devis = 0
        serializer_class = ImportationAssureIaSerializer(data=request.data)
        if (
            "FichierExcel" not in request.FILES
            or not serializer_class.is_valid()
        ):
            if "IdDevis" in request.POST:
                if request.POST["IdDevis"]:
                    id_devis = int(request.POST["IdDevis"])
            message["IdDevis"] = id_devis
            message["messages"] = [
                "Paramètres non conformes",
            ]
            return Response(data=message, status=status.HTTP_400_BAD_REQUEST)
        else:
            (error_ocurred, id_devis) = import_ia_insured(
                request.FILES["FichierExcel"], request.user.id, request.POST
            )
            message["IdDevis"] = id_devis
            if not error_ocurred:
                message["messages"] = [
                    "Importation des assurés réalisée avec succès.",
                ]
                return Response(data=message, status=status.HTTP_202_ACCEPTED)
            else:
                message["messages"] = [
                    "Echec de l'importation des assurés.",
                ]
                return Response(
                    data=message, status=status.HTTP_400_BAD_REQUEST
                )


class LogRecordView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request):
        msg = request.query_params.get("msg", "")
        level_name = request.query_params.get("levelname", "")
        serializer = LogRecordSerializer(
            LogRecord(msg=msg, level_name=level_name)
        )
        print(serializer.data)
        return Response(
            {"Status": "Succès", "data": serializer.data},
            status=status.HTTP_200_OK,
        )


class QuittanceViewSet(viewsets.ModelViewSet):
    queryset = Quittance.objects.all()
    serializer_class = QuittanceSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class DetailQuittanceViewSet(viewsets.ModelViewSet):
    queryset = DetailQuittance.objects.all()
    serializer_class = DetailQuittanceSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class EncaissementViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get_queryset(self):
        if self.action in ["list", "retrieve", "annuler"]:
            return (
                Encaissement.objects.select_related("modepaiement", "banque")
                .prefetch_related("details")
                .filter(Q(piece_annulee=False))
                .order_by("-dateencaissement")
            )

        else:
            return Encaissement.objects.none()

    def list(self, request):
        queryset = self.get_queryset()[:1000]
        serializer = EncaissementSerializer(queryset, many=True)
        return Response(serializer.data)

    def retrieve(self, request, pk=None):
        queryset = self.get_queryset()
        encaissement = get_object_or_404(queryset, pk=pk)
        serializer = EncaissementSerializer(encaissement)
        return Response(serializer.data)

    def create(self, request):
        pass

    def update(self, request, pk=None):
        pass

    def partial_update(self, request, pk=None):
        pass

    def destroy(self, request, pk=None):
        pass

    @action(detail=True, methods=["post"])
    def annuler(self, request, pk=None):
        """
        🆕 Endpoint pour annuler un encaissement avec un jeton d'autorisation

        POST /api/encaissement/{id}/annuler/
        Body: {
            "jeton": "ABC12345"
        }
        """
        encaissement = cast(Encaissement, self.get_object())

        # Vérifier que l'encaissement n'est pas déjà annulé
        if encaissement.piece_annulee:
            return Response(
                {"erreur": "Cet encaissement est déjà annulé"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validation avec le serializer d'autorisation
        serializer = AnnulerAvecJetonSerializer(
            data=request.data,
            context={"request": request, "objet": encaissement},
        )
        serializer.is_valid(raise_exception=True)

        # Récupérer le jeton validé
        jeton_obj = cast(
            JetonAutorisation, serializer.validated_data["jeton_obj"]
        )

        # Transaction atomique pour garantir la cohérence
        try:
            with transaction.atomic():
                # Utiliser le jeton
                jeton_obj.utiliser(
                    ip_address=self.get_client_ip(request),
                    user_agent=request.META.get("HTTP_USER_AGENT", ""),
                )

                # Annuler l'encaissement
                cancellation_data = {
                    "id_encaissement": encaissement.idencaissement,
                    "date_annulation": timezone.now().date(),
                    "motif_annulation": jeton_obj.demande.motif,
                }
                (err, qryset) = save_premium_collection_cancellation(
                    request.user.id, cancellation_data
                )
                data_insertion_serializer = DataInsertionSerializer(
                    qryset,
                    many=True,
                )
                st = status.HTTP_201_CREATED
                if err:
                    transaction.set_rollback(True)
                    st = status.HTTP_400_BAD_REQUEST
                return JsonResponse(
                    data_insertion_serializer.data, status=st, safe=False
                )
        except Exception as error:
            return JsonResponse(
                {
                    "ObjectId": encaissement.idencaissement,
                    "OutputMessage": str(error).split("\n")[0],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

    @staticmethod
    def get_client_ip(request):
        """Récupère l'adresse IP du client"""
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            ip = x_forwarded_for.split(",")[0]
        else:
            ip = request.META.get("REMOTE_ADDR")
        return ip

    @action(detail=True, methods=["post"])
    def demander_annulation(self, request, pk=None):
        """
        🆕 Raccourci pour créer directement une demande d'annulation

        POST /api/encaissement/{id}/demander_annulation/
        Body: {
            "motif": "Erreur de saisie du montant"
        }
        """

        encaissement = cast(Encaissement, self.get_object())

        if encaissement.piece_annulee:
            return Response(
                {"erreur": "Cet encaissement est déjà annulé"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        motif = request.data.get("motif")
        if not motif or len(motif) < 10:
            return Response(
                {"erreur": "Le motif doit contenir au moins 10 caractères"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Créer la demande
        content_type = ContentType.objects.get_for_model(Encaissement)
        demande = DemandeAutorisation.objects.create(
            demandeur=request.user,
            type_operation=TypeOperation.ANNULATION_ENCAISSEMENT,
            objet=f"Annulation encaissement {encaissement.numeropiece}",
            motif=motif,
            content_type=content_type,
            object_id=encaissement.idencaissement,
            metadata={
                "reference": encaissement.numeropiece,
                "montant": str(encaissement.montantencaissement),
            },
        )

        envoyer_notification_nouvelle_demande.delay(demande.id)

        return Response(
            {
                "message": "Demande d'annulation créée avec succès",
                "demande_id": demande.id,
            },
            status=status.HTTP_201_CREATED,
        )


class DetailEncaissementViewSet(viewsets.ModelViewSet):
    queryset = DetailEncaissement.objects.all()
    serializer_class = DetailEncaissementSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get_queryset(self):
        queryset = super().get_queryset()
        # Caisse : règlements d'une quittance, le dernier en tête (réimpression du reçu)
        numeroquittance = self.request.query_params.get("numeroquittance")
        if numeroquittance:
            queryset = queryset.filter(
                numeroquittance_id=numeroquittance,
                encaissement__piece_annulee=False,
            ).order_by("-iddetailencaissement")
        return queryset


class ContractListView(APIView):
    def get(self, request, format=None):
        # Get query params
        start_date_str = request.query_params.get("start_date")
        end_date_str = request.query_params.get("end_date")

        # Default: current year if not provided
        current_year = date.today().year
        if not start_date_str or not end_date_str:
            start_date = date(current_year, 1, 1)
            end_date = date(current_year, 12, 31)
        else:
            start_date = parse_date_string(start_date_str)
            end_date = parse_date_string(end_date_str)
            if not start_date or not end_date:
                return Response(
                    {"error": "Format de date invalide"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Validate range
            if end_date < start_date:
                return Response(
                    {
                        "erreur": "La date de fin doit être postérieure à la date de début."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        contracts = (
            Contrat.objects.filter(
                dateemission__range=(start_date, end_date),
            )
            .filter(
                Q(idcontratannulation__isnull=True) | Q(idcontratannulation=0)
            )
            .select_related("idclient", "iddevis")
            .annotate(
                client=F("idclient__Nom"),
                numerodevis=F("iddevis__numerodevis"),
            )
            .values(
                "client",
                "idcontrat",
                "numerodevis",
                "numeropolice",
                "dateemission",
                "dateeffet",
                "dateexpiration",
                "primenette",
                "accessoire",
                "taxe",
                "primettc",
            )
        )

        return Response(list(contracts))


class ReversementCompagnieNonValideViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def list(self, request):
        queryset = (
            ReversementCompagnie.objects.filter(Q(valide=False))
            .select_related("compagnie", "banque")
            .prefetch_related("details")
            .order_by("-date_reversement")[:1000]
        )
        serializer = ReversementCompagnieSerializer(queryset, many=True)
        return Response(serializer.data)

    def retrieve(self, request, pk=None):
        queryset = (
            ReversementCompagnie.objects.filter(Q(valide=False))
            .select_related("compagnie", "banque")
            .prefetch_related("details")
            .order_by("-date_reversement")
        )
        reversement = get_object_or_404(queryset, pk=pk)
        serializer = ReversementCompagnieSerializer(reversement)
        return Response(serializer.data)

    def create(self, request):
        pass

    def update(self, request, pk=None):
        pass

    def partial_update(self, request, pk=None):
        pass

    def destroy(self, request, pk=None):
        pass


class ReversementCompagnieViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def list(self, request):
        queryset = (
            ReversementCompagnie.objects.filter(Q(valide=True))
            .select_related("compagnie", "mode_reversement", "banque")
            .prefetch_related("details")
            .filter(Q(piece_annulee=False))
            .order_by("-date_reversement")[:1000]
        )
        serializer = ReversementCompagnieSerializer(queryset, many=True)
        return Response(serializer.data)

    def retrieve(self, request, pk=None):
        queryset = (
            ReversementCompagnie.objects.filter(Q(valide=True))
            .select_related("compagnie", "mode_reversement", "banque")
            .prefetch_related("details")
            .filter(Q(piece_annulee=False))
        )
        reversement = get_object_or_404(queryset, pk=pk)
        serializer = ReversementCompagnieSerializer(reversement)
        return Response(serializer.data)

    def create(self, request):
        pass

    def update(self, request, pk=None):
        pass

    def partial_update(self, request, pk=None):
        pass

    def destroy(self, request, pk=None):
        pass


class DetailReversementViewSet(viewsets.ModelViewSet):
    queryset = DetailReversement.objects.all()
    serializer_class = DetailReversementSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


class NumeroViewSet(viewsets.ModelViewSet):
    queryset = Numero.objects.all()
    serializer_class = NumeroSerializer
    permission_classes = [
        permissions.IsAuthenticated,
    ]


# Create a new quotation (Car Insurance)
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def create_quotation(request):
    return stored_procedure_result(
        request,
        EnregistrementDevisAutoSerializer,
        save_quotation,
        QuotationInsertionSerializer,
    )
    # enregistrementdevis_data = JSONParser().parse(request)
    # #print("JSON de la requête:", enregistrementdevis_data)
    # enregistrementdevis_serializer = EnregistrementDevisAutoSerializer(
    #     data=enregistrementdevis_data
    # )
    # if enregistrementdevis_serializer.is_valid():
    #     (err, queryset) = save_quotation(enregistrementdevis_data)
    #     data_insertion_serializer = QuotationInsertionSerializer(queryset, many=True)
    #     st = status.HTTP_201_CREATED
    #     if err:
    #         st = status.HTTP_400_BAD_REQUEST
    #     return JsonResponse(data_insertion_serializer.data, status=st, safe=False)
    # return JsonResponse(
    #     enregistrementdevis_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    # )


# Finalize a quotation (Car & Personal Accident Insurance)
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def finalize_quotation_flotte(request):
    finalisationdevis_data = JSONParser().parse(request)
    ##print("JSON de la requête:", finalisationdevis_data)
    finalisationdevis_serializer = FinalisationDevisFlotteSerializer(
        data=finalisationdevis_data
    )
    if finalisationdevis_serializer.is_valid():
        (err, qryset) = quotation_completion(finalisationdevis_data)
        data_insertion_serializer = DataInsertionSerializer(qryset, many=True)
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST
        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )
    return JsonResponse(
        finalisationdevis_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


# Cancel_car_fleet_input
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def quote_archival(request):
    inputcancelation_data = JSONParser().parse(request)
    ##print("JSON de la requête:", inputcancelation_data)
    inputcancelation_serializer = OperationSurDevisSerializer(
        data=inputcancelation_data
    )
    if inputcancelation_serializer.is_valid():
        (err, qryset) = archive_quote(inputcancelation_data, request.user.id)
        data_insertion_serializer = DataInsertionSerializer(qryset, many=True)
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST

        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )
    return JsonResponse(
        inputcancelation_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


# Unarchive Quote
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def quote_unarchival(request):
    input_data = JSONParser().parse(request)
    input_serializer = OperationSurDevisSerializer(data=input_data)
    if input_serializer.is_valid():
        (err, qryset) = unarchive_quote(input_data, request.user.id)
        data_insertion_serializer = DataInsertionSerializer(qryset, many=True)
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST

        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )

    return JsonResponse(
        input_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


# Car input cancelation
@api_view(["POST"])
# Même authentification que l'enregistrement du devis : avec TokenAuthentication seule, le
# jeton de l'application était refusé (401) et aucun véhicule de flotte n'était jamais retiré.
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def car_input_cancelation(request):
    inputcancelation_data = JSONParser().parse(request)
    ##print("JSON de la requête:", inputcancelation_data)
    inputcancelation_serializer = OperationSurDevisDetailSerializer(
        data=inputcancelation_data
    )
    if inputcancelation_serializer.is_valid():
        (err, qryset) = cancel_car_input(inputcancelation_data)
        data_insertion_serializer = DataInsertionSerializer(qryset, many=True)
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST
        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )
    return JsonResponse(
        inputcancelation_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


# Creation a new quotation (Life Insurance)
@api_view(["POST"])
@authentication_classes([TokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def create_quotation_ia(request):
    enregistrementdevis_ia_data = JSONParser().parse(request)
    # #print("JSON de la requête:", enregistrementdevis_ia_data)
    enregistrementdevis_ia_serializer = EnregistrementDevisIaSerializer(
        data=enregistrementdevis_ia_data
    )
    if enregistrementdevis_ia_serializer.is_valid():
        (error, queryset) = save_quotation_ia(enregistrementdevis_ia_data)
        data_insertion_serializer = QuotationIaInsertionSerializer(
            queryset, many=True
        )
        st = status.HTTP_201_CREATED
        if error:
            st = status.HTTP_400_BAD_REQUEST

        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )

    return JsonResponse(
        enregistrementdevis_ia_serializer.errors,
        status=status.HTTP_400_BAD_REQUEST,
    )


#############################################################################
# Register an Insured (Personal Accident Insurance)
@api_view(["POST"])
@authentication_classes([TokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def create_insured_ia(request):
    enregistrementassure_ia_data = JSONParser().parse(request)
    # #print("JSON de la requête:", enregistrementassure_ia_data)
    enregistrement_serializer = EnregistrementDevisIaSerializer(
        data=enregistrementassure_ia_data
    )
    if enregistrement_serializer.is_valid():
        (err, qryset) = save_insured_ia(enregistrementassure_ia_data)
        data_insertion_serializer = DataInsertionSerializer(qryset, many=True)
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST
        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )
    return JsonResponse(
        enregistrement_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


#############################################################################
# Create a new quotation - Travel Insurance
@api_view(["POST"])
@authentication_classes([TokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def create_quotation_voyage(request):
    enregistrementdevis_voyage_data = JSONParser().parse(request)
    print("JSON de la requête:", enregistrementdevis_voyage_data)
    enregistrementdevis_voyage_serializer = (
        EnregistrementDevisVoyageSerializer(
            data=enregistrementdevis_voyage_data
        )
    )
    if enregistrementdevis_voyage_serializer.is_valid():
        (err, queryset) = save_quotation_voyage(
            enregistrementdevis_voyage_data
        )
        if not err and queryset:
            enregistrer_terme_devis(
                list(queryset)[0].ObjectId,
                enregistrementdevis_voyage_data.get("IdTerme"),
            )
        data_insertion_serializer = DataInsertionSerializer(
            queryset, many=True
        )
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST
        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )
    return JsonResponse(
        enregistrementdevis_voyage_serializer.errors,
        status=status.HTTP_400_BAD_REQUEST,
    )


###########################################################################
# Create new quotation - House Insurance
@api_view(["POST"])
@authentication_classes([TokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def create_quotation_mrh(request):
    enregistrementdevis_mrh_data = JSONParser().parse(request)
    # #print("JSON de la requête:", enregistrementdevis_mrh_data)
    enregistrementdevis_mrh_serializer = EnregistrementDevisMrhSerializer(
        data=enregistrementdevis_mrh_data
    )
    if enregistrementdevis_mrh_serializer.is_valid():
        (err, queryset) = save_quotation_mrh(
            request.user.id, enregistrementdevis_mrh_data
        )
        data_insertion_serializer = DataInsertionSerializer(
            queryset, many=True
        )
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST
        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )
    return JsonResponse(
        enregistrementdevis_mrh_serializer.errors,
        status=status.HTTP_400_BAD_REQUEST,
    )


###########################################################################
# Create new quotation - IT Insurance
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def create_quotation_tousrisquesinfo(request):
    enregistrementdevis_tri_data = JSONParser().parse(request)
    # #print("JSON de la requête:", enregistrementdevis_tri_data)
    enregistrementdevis_tri_serializer = EnregistrementDevisTRInfoSerializer(
        data=enregistrementdevis_tri_data
    )
    if enregistrementdevis_tri_serializer.is_valid():
        (err, queryset) = save_quotation_tousrisquesinfo(
            request.user.id, enregistrementdevis_tri_data
        )
        if not err and queryset:
            enregistrer_terme_devis(
                list(queryset)[0].ObjectId,
                enregistrementdevis_tri_data.get("IdTerme"),
            )
        data_insertion_serializer = DataInsertionSerializer(
            queryset,
            many=True,
        )
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST
        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )
    return JsonResponse(
        enregistrementdevis_tri_serializer.errors,
        status=status.HTTP_400_BAD_REQUEST,
    )


###########################################################################
# Create new quotation - RC
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def create_quotation_risques_divers(request):
    enregistrementdevis_risques_divers_data = JSONParser().parse(request)
    print("JSON de la requête:", enregistrementdevis_risques_divers_data)
    enregistrementdevis_risques_divers_serializer = (
        EnregistrementDevisRisqquesDiversSerializer(
            data=enregistrementdevis_risques_divers_data
        )
    )
    if enregistrementdevis_risques_divers_serializer.is_valid():
        (err, queryset) = save_quotation_risques_divers(
            request.user.id,
            enregistrementdevis_risques_divers_serializer.validated_data,
        )
        if not err and queryset:
            enregistrer_terme_devis(
                list(queryset)[0].ObjectId,
                enregistrementdevis_risques_divers_data.get("IdTerme"),
            )
        data_insertion_serializer = DataInsertionSerializer(
            queryset,
            many=True,
        )
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST
        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )
    return JsonResponse(
        enregistrementdevis_risques_divers_serializer.errors,
        status=status.HTTP_400_BAD_REQUEST,
    )


###########################################################################
# Bank Risk Insurance
@api_view(["POST"])
@authentication_classes([TokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def create_quotation_globaledebanque(request):
    enregistrementdevis_gdb_data = JSONParser().parse(request)
    # #print("JSON de la requête:", enregistrementdevis_gdb_data)
    enregistrementdevis_gdb_serializer = (
        EnregistrementDevisGlobaleDeBanqueSerializer(
            data=enregistrementdevis_gdb_data
        )
    )
    if enregistrementdevis_gdb_serializer.is_valid():
        (err, queryset) = save_quotation_globaledebanque(
            request.user.id, enregistrementdevis_gdb_data
        )
        data_insertion_serializer = DataInsertionSerializer(
            queryset,
            many=True,
        )
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST
        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )
    return JsonResponse(
        enregistrementdevis_gdb_serializer.errors,
        status=status.HTTP_400_BAD_REQUEST,
    )


###########################################################################
# Creation a new beneficiary IA
@api_view(["POST"])
@authentication_classes([TokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def creer_ayant_droit_ia(request):
    creationayantdroit_data = JSONParser().parse(request)
    # #print("JSON de la requête:", creationayantdroit_data)
    creationayantdroit_serializer = CreationAyantDroitIaSerializer(
        data=creationayantdroit_data
    )
    if creationayantdroit_serializer.is_valid():
        data_insertion_serializer = DataInsertionSerializer(
            enregistrer_ayant_droit(creationayantdroit_data), many=True
        )
        return JsonResponse(
            data_insertion_serializer.data,
            status=status.HTTP_201_CREATED,
            safe=False,
        )
    return JsonResponse(
        creationayantdroit_serializer.errors,
        status=status.HTTP_400_BAD_REQUEST,
    )


# Change quotation into contract
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def create_contract(request):
    confirmationdevis_data = JSONParser().parse(request)
    # print("JSON de la requête:", confirmationdevis_data)
    confirmationdevis_serializer = OperationSurDevisSerializer(
        data=confirmationdevis_data
    )
    if confirmationdevis_serializer.is_valid():
        (err, qryset) = save_contract(confirmationdevis_data)
        data_insertion_serializer = DataInsertionSerializer(qryset, many=True)
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST
        elif not settings.DEBUG and settings.URANUS_IN_PRODUCTION:
            send_sms_enregistrement_contrat.delay(
                int(data_insertion_serializer.data[0]["ObjectId"])
            )
        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )

    return JsonResponse(
        confirmationdevis_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


class AssureIaParDevisView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, iddevis):
        (msg, assures) = get_liste_assure_ia(id=iddevis, statut="DEV")
        if not msg:
            serializer = AssureIaParDevisOuContratSerializer(
                assures, many=True
            )
            # print(serializer)
            return JsonResponse(
                serializer.data, status=status.HTTP_200_OK, safe=False
            )
        else:
            return JsonResponse(
                {"Status": "Echec", "Data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


class AssureIaParContratView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idcontrat):
        (msg, assures) = get_liste_assure_ia(id=idcontrat, statut="CNT")
        if not msg:
            serializer = AssureIaParDevisOuContratSerializer(
                assures, many=True
            )
            # print(serializer.data)
            return JsonResponse(
                serializer.data, status=status.HTTP_200_OK, safe=False
            )
        else:
            return JsonResponse(
                {"Status": "Echec", "Data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


class AssureIaInfoView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, iddevis):
        (msg, assureiainfo) = get_assure_ia(iddevis)
        if not msg:
            serializer = AssureIaInfoSerializer(assureiainfo, many=True)
            # print(serializer.data)
            return JsonResponse(
                serializer.data, status=status.HTTP_200_OK, safe=False
            )
        else:
            return JsonResponse(
                {"Status": "Echec", "Data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


class DevisDetailInfoView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, iddevis):
        r_status = status.HTTP_200_OK
        devisdetail = DevisDetail.objects.none()
        try:
            devis = Devis.objects.get(pk=iddevis)
            if devis:
                # Ordre stable : le premier véhicule d'une flotte est celui repris en édition
                devisdetail = DevisDetail.objects.filter(iddevis=devis).order_by("pk")
                if not devisdetail.exists():
                    r_status = status.HTTP_404_NOT_FOUND
        except Devis.DoesNotExist as e_not_exists:
            print(e_not_exists)
            r_status = status.HTTP_404_NOT_FOUND
        except Exception as error:
            print(error)
            r_status = status.HTTP_400_BAD_REQUEST

        serializer = DevisDetailSerializer(devisdetail, many=True)
        return JsonResponse(serializer.data, status=r_status, safe=False)


class ContratDetailInfoView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idcontrat):
        contratdetail = ContratDetail.objects.filter(idcontrat=idcontrat)
        serializer = ContratDetailSerializer(contratdetail, many=True)
        # print(serializer.data)
        return JsonResponse(
            serializer.data, status=status.HTTP_200_OK, safe=False
        )


class QuittancePropositionView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, iddevis):
        (msg, item) = get_quotation_info(iddevis=iddevis)
        if not msg:
            serializer = QuittancePropositionSerializer(item, many=True)
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


###########################################
### Quittance Contrat
class QuittanceContratView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idcontrat):
        (msg, item) = get_contract_info(idcontrat=idcontrat)
        if not msg:
            serializer = QuittanceContratSerializer(item, many=True)
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


###########################################
### Garantie Contrat
class GarantieContratView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idcontrat):
        (msg, item) = get_contract_coverage(idcontrat=idcontrat)
        if not msg:
            serializer = GarantieContratFlotteSerializer(item, many=True)
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


def get_liste_vehicule(id, contrat=True):
    (msg, item) = get_contract_car_list(id=id, contrat=contrat)
    if not msg:
        serializer = VehiculeContratSerializer(item, many=True)
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


###########################################
### Liste Vehicule Contrat
class ListeVehiculeContratView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idcontrat):
        return get_liste_vehicule(id=idcontrat)


###########################################
### Liste Vehicule Devis
class ListeVehiculeDevisView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, iddevis):
        return get_liste_vehicule(id=iddevis, contrat=False)


###########################################
### Liste des quittances à reverser
class ListeContratReversementView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idcompagnie):
        (msg, item) = get_contract_premium_remittance(idcompagnie=idcompagnie)
        if not msg:
            serializer = ContractForPremiumCollectionSerializer(
                item, many=True
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


####################################################################
# fn_info_encaissement
#################################################################
class InfoEncaissementView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, iddetailencaissement):
        (msg, item) = get_info_encaissement(
            detailencaissement=iddetailencaissement
        )
        if not msg:
            serializer = PremiumCollectionInfoSerializer(item, many=True)
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


# fn_get_info_vehicule
class InfoVehiculeView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idcontrat):
        (msg, item) = get_info_vehicule(idcontrat=idcontrat)
        if not msg:
            serializer = InfoVehiculeSerializer(item, many=True)
            return Response(
                {"status": "succès", "data": serializer.data},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


####################################################################
# fn_info_reversement
#################################################################
class InfoReversementView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idreversement):
        (msg, item) = get_info_reversement(reversement=idreversement)
        if not msg:
            serializer = PremiumRemittanceInfoSerializer(item, many=True)
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


#########################################################
class DetailEncaissementListView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idencaissement):
        try:
            encaissement = Encaissement.objects.get(pk=idencaissement)
        except Encaissement.DoesNotExist:
            return Response(
                {"status": "Aucune donnée", "data": ""},
                status=status.HTTP_204_NO_CONTENT,
            )
        else:
            details = DetailEncaissement.objects.filter(
                encaissement=encaissement
            )
            if details.exists():
                serializer = DetailEncaissementSerializer(details, many=True)
                # print(serializer.data)
                return Response(
                    {"status": "Succès", "data": serializer.data},
                    status=status.HTTP_200_OK,
                )
            else:
                return Response(
                    {
                        "status": "Echec",
                        "data": "Incohérence: encaissement sans détails.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )


#########################################################
class DetailReversementListView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, idreversement):
        try:
            reversement = ReversementCompagnie.objects.get(pk=idreversement)
        except ReversementCompagnie.DoesNotExist:
            return Response(
                {"status": "Aucune donnée", "data": ""},
                status=status.HTTP_204_NO_CONTENT,
            )
        else:
            details = DetailReversement.objects.filter(reversement=reversement)
            if details.exists():
                serializer = DetailReversementSerializer(details, many=True)
                # print(serializer.data)
                return Response(
                    {"status": "Succès", "data": serializer.data},
                    status=status.HTTP_200_OK,
                )
            else:
                return Response(
                    {
                        "status": "Echec",
                        "data": "Incohérence: reversement sans détails.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )


class ImportationFichierGUCEViewSet(viewsets.ViewSet):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def create(self, request):
        messages = []
        serializer_class = ImportationTransportSerializer(data=request.data)
        if (
            "fichier_excel" not in request.FILES
            or not serializer_class.is_valid()
        ):
            return Response(status=status.HTTP_400_BAD_REQUEST)
        else:
            (error_occured, messages) = export_excel(
                request.FILES["fichier_excel"],
                request.user.id,
                request.POST["debut_periode"],
                request.POST["fin_periode"],
            )
            data_insertion_serializer = DataInsertionSerializer(
                messages, many=True
            )
            if not error_occured:
                return Response(
                    data=data_insertion_serializer.data,
                    status=status.HTTP_202_ACCEPTED,
                )
            else:
                return Response(
                    data=data_insertion_serializer.data,
                    status=status.HTTP_400_BAD_REQUEST,
                )


class ExtendedQuotationInfoView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, idproduit):
        # Récupération des paramètres de pagination de l'URL
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 50))
        nom_client = request.query_params.get("nom_client", "")
        numero_police = request.query_params.get("numero_police", "")

        # Calcul de l'offset
        limit = page_size
        offset = (page - 1) * page_size

        (msg, devis_list, total_count) = get_extended_quotation_info(
            0,
            numero_police,
            nom_client,
            None,
            None,
            idproduit,
            limit=limit,
            offset=offset,
        )

        if not msg:
            serializer = ExtendedQuotationInfoSerializer(devis_list, many=True)

            # Réponse structurée avec données et méta-pagination
            return Response(
                {
                    "status": "succès",
                    "data": serializer.data,
                    "pagination": {
                        "total_items": total_count,
                        "page_size": limit,
                        "current_page": page,
                        "total_pages": (total_count + limit - 1) // limit,
                    },
                },
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


class QuotationCountsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, idproduit):
        msg, nb_devis, nb_contrats = get_quotation_counts(idproduit)
        if msg:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                "status": "succès",
                "data": {"nb_devis": nb_devis, "nb_contrats": nb_contrats},
            },
            status=status.HTTP_200_OK,
        )


class ExtendedQuotationInfoRechercheView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, champrecherche):
        parameters = str(champrecherche).strip().split("_")
        (id_devis, numero_devis, nom_client, date_debut, date_fin) = (
            0,
            "",
            "",
            None,
            None,
        )
        try:
            if len(parameters) == 5:
                if parameters[0]:
                    id_devis = int(parameters[0])
                if parameters[1]:
                    numero_devis = str(parameters[1])
                if parameters[2]:
                    nom_client = str(parameters[2])
                if parameters[3]:  # "%d-%m-%Y"
                    date_debut = datetime.strptime(
                        str(parameters[3]), "%Y-%m-%d"
                    ).date()
                if parameters[4]:
                    date_fin = datetime.strptime(
                        str(parameters[4]), "%Y-%m-%d"
                    ).date()
        except Exception as error:
            return Response(
                {"status": "Echec", "data": str(error).split(":")[0]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        else:
            (msg, item) = get_extended_quotation_info(
                id_devis, numero_devis, nom_client, date_debut, date_fin
            )
            if not msg:
                serializer = ExtendedQuotationInfoSerializer(item, many=True)
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


class ReductionFlotteDevisView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, iddevis):
        taux_reduction_flotte = get_taux_reduction_flotte(iddevis)
        (statut_msg, statut_code) = (
            ("Succès", status.HTTP_200_OK)
            if taux_reduction_flotte >= 0
            else ("Echec", status.HTTP_400_BAD_REQUEST)
        )
        return Response(
            {
                "Status": statut_msg,
                "TauxReduction": str(taux_reduction_flotte),
            },
            status=statut_code,
        )


class GarantieSouscriteView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get_garantie(self, id_entite, type_entite):
        msg, garanties = get_garantie_souscrite(id_entite, type_entite)
        if not msg:
            serializer = GarantieSouscriteSerializer(garanties, many=True)
            return Response(
                {"Status": "Succès", "Data": serializer.data},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"Status": "Echec", "Data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


class GarantieSouscriteContratView(GarantieSouscriteView):
    def get(self, request, idcontrat):
        return self.get_garantie(idcontrat, "CNT")


class GarantieSouscriteDevisView(GarantieSouscriteView):
    def get(self, request, iddevis):
        return self.get_garantie(iddevis, "DEV")


# Save Premium collection
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def collect_premium(request):
    enregistrementencaissement_data = JSONParser().parse(request)
    print("JSON de la requête:", enregistrementencaissement_data)
    enregistrementencaissement_serializer = (
        EncaissementGroupeQuittanceSerializer(
            data=enregistrementencaissement_data
        )
    )
    enregistrementencaissement_serializer.is_valid(raise_exception=True)
    try:

        result_data = save_premium_collection(
            request.user, enregistrementencaissement_data
        )
        # 3. Réponse de succès utilisant notre structure définie
        output_serializer = EncaissementResponseSerializer(result_data)
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)
    except ServiceError as e:
        # Erreur renvoyée par la procédure SQL (id=0)
        return Response(
            {"erreur": str(e.detail)}, status=status.HTTP_400_BAD_REQUEST
        )
    except DRFValidationError as e:
        # Contrôle métier (chèque, reçu opérateur, compensation, réencaissement)
        return Response(
            {"erreur": _message_erreur(e)}, status=status.HTTP_400_BAD_REQUEST
        )
    except DatabaseError as e:
        # RAISE EXCEPTION de la procédure : son message est la première ligne
        return Response(
            {"erreur": str(e).strip().splitlines()[0]},
            status=status.HTTP_400_BAD_REQUEST,
        )

    except Exception as e:
        # Erreur système inattendue
        return Response(
            {
                "erreur": "Une erreur technique est survenue.",
                "details": str(e),
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# Cancel Premium collection
# @api_view(["POST"])
# @authentication_classes([TokenAuthentication, BasicAuthentication])
# @permission_classes([permissions.IsAuthenticated])
# def cancel_premium_collection(request):
#     annulationencaissement_data = JSONParser().parse(request)
#     # print("JSON de la requête:", enregistrementencaissement_data)
#     annulationencaissement_serializer = AnnulationEncaissementSerializer(
#         data=annulationencaissement_data
#     )
#     if annulationencaissement_serializer.is_valid():
#         (err, qryset) = save_premium_collection_cancellation(
#             request.user.id, annulationencaissement_data
#         )

#         data_insertion_serializer = QuotationInsertionSerializer(
#             qryset,
#             many=True,
#         )
#         st = status.HTTP_201_CREATED
#         if err:
#             st = status.HTTP_400_BAD_REQUEST

#         return JsonResponse(data_insertion_serializer.data, status=st, safe=False)
#     return JsonResponse(
#         annulationencaissement_serializer.errors, status=status.HTTP_400_BAD_REQUEST
#     )


##################################################################################
# Save Premium Remittance
@api_view(["POST"])
@authentication_classes([TokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def remit_premium(request):
    enregistrement_data = JSONParser().parse(request)
    # print("JSON de la requête:", enregistrement_data)
    reversement_serializer = ReversementGroupePrimeInsertSerializer(
        data=enregistrement_data
    )
    if reversement_serializer.is_valid():
        validated_data = reversement_serializer.validated_data
        data_insertion_serializer = DataInsertionSerializer(
            save_premium_remittance(request.user.id, validated_data),
            many=True,
        )
        return JsonResponse(
            data_insertion_serializer.data,
            status=status.HTTP_201_CREATED,
            safe=False,
        )
    return JsonResponse(
        reversement_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


##################################################################################
# Save Premium Remittance
@api_view(["POST"])
@authentication_classes([TokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def validate_premium_remittance(request):
    enregistrement_data = JSONParser().parse(request)
    reversement_serializer = ReversementGroupePrimeValidateSerializer(
        data=enregistrement_data
    )
    if reversement_serializer.is_valid():
        validated_data = reversement_serializer.validated_data
        error, queryset = premium_remittance_validation(
            request.user.id, validated_data
        )
        data_insertion_serializer = DataInsertionSerializer(
            queryset,
            many=True,
        )
        resp_status = status.HTTP_201_CREATED
        if error:
            resp_status = status.HTTP_400_BAD_REQUEST
        return JsonResponse(
            data_insertion_serializer.data, status=resp_status, safe=False
        )
    return JsonResponse(
        reversement_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


##################################################################################
# Change Plate Number
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def change_plate_number(request):
    chgplatenumber_data = JSONParser().parse(request)
    # print("JSON de la requête:", chgplatenumber_data)
    chgplatenumber_serializer = ChangementImmatriculationSerializer(
        data=chgplatenumber_data
    )
    if chgplatenumber_serializer.is_valid():
        (err, qryset) = save_plate_number(request.user.id, chgplatenumber_data)
        data_insertion_serializer = DataInsertionSerializer(
            qryset,
            many=True,
        )
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST
        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )
    return JsonResponse(
        chgplatenumber_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


##################################################################################
# Cancel Policy, Renew Policy or Change Effective Date
@api_view(["POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def modify_policy(request):
    cancelpolicy_data = JSONParser().parse(request)
    print("JSON de la requête:", cancelpolicy_data)
    cancelpolicy_serializer = AvenantAnlRenSerializer(data=cancelpolicy_data)
    if cancelpolicy_serializer.is_valid():
        (err, qryset) = policy_modification(request.user.id, cancelpolicy_data)
        data_insertion_serializer = DataInsertionSerializer(
            qryset,
            many=True,
        )
        st = status.HTTP_201_CREATED
        if err:
            st = status.HTTP_400_BAD_REQUEST
        return JsonResponse(
            data_insertion_serializer.data, status=st, safe=False
        )
    return JsonResponse(
        cancelpolicy_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


##################################################################################
# Renew Policy
# @api_view(["POST"])
# @authentication_classes([TokenAuthentication, BasicAuthentication])
# @permission_classes([permissions.IsAuthenticated])
# def renew_policy(request):
#     renewpolicy_data = JSONParser().parse(request)
#     #print("JSON de la requête:", renewpolicy_data)
#     renewpolicy_serializer = AvenantAnlRenSerializer(data=renewpolicy_data)
#     if renewpolicy_serializer.is_valid():
#         (err, qryset) = policy_cancellation_or_renewal(
#             request.user.id, renewpolicy_data
#         )
#         data_insertion_serializer = DataInsertionSerializer(
#             qryset,
#             many=True,
#         )
#         st = status.HTTP_201_CREATED
#         if err:
#             st = status.HTTP_400_BAD_REQUEST
#         return JsonResponse(data_insertion_serializer.data, status=st, safe=False)
#     return JsonResponse(
#         renewpolicy_serializer.errors, status=status.HTTP_400_BAD_REQUEST
#     )
class ListeContratClientView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def get(self, request, *args, **kwargs):
        idproduit = request.query_params.get("idproduit")
        idclient = request.query_params.get("idclient")
        nomclient = request.query_params.get("nomclient")
        telephoneclient = request.query_params.get("telephoneclient")
        numeropolice = request.query_params.get("numeropolice")
        if idproduit is None:
            idproduit = 0
        if idclient is None:
            idclient = 0

        (msg, item) = get_contract_list_for_customer(
            nom_client=nomclient,
            telephone_client=telephoneclient,
            numero_police=numeropolice,
            id_produit=idproduit,
            id_client=idclient,
        )
        if not msg:
            serializer = ContractForPremiumCollectionSerializer(
                item, many=True
            )
            # print(serializer.data)
            return JsonResponse(
                serializer.data, status=status.HTTP_200_OK, safe=False
            )
        else:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )


#################################################################################
@api_view(["POST"])
@authentication_classes([TokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def get_contracts_for_pc(request):
    contratdemande_data = JSONParser().parse(request)
    contratdemande_serializer = DemandeContratPourEncaissementSerializer(
        data=contratdemande_data
    )
    if contratdemande_serializer.is_valid():
        referenceclient = str(contratdemande_data["referenceclient"])
        referencecontrat = str(contratdemande_data["referencecontrat"])
        (msg, item) = get_contract_list_for_pc(
            referenceclient, referencecontrat
        )
        if not msg:
            serializer = ContractForPremiumCollectionSerializer(
                item, many=True
            )
            return JsonResponse(
                serializer.data, status=status.HTTP_200_OK, safe=False
            )
        else:
            return Response(
                {"status": "Echec", "data": msg},
                status=status.HTTP_400_BAD_REQUEST,
            )
    return JsonResponse(
        contratdemande_serializer.errors, status=status.HTTP_400_BAD_REQUEST
    )


class CorrectionDevisViewSet(viewsets.ViewSet):
    """
    API endpoint pour corriger les devis.
    """

    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def create(self, request):
        """
        Traite la requête POST pour corriger un devis déjà existant.
        """
        serializer = CorrectionDevisSerializer(data=request.data)
        if serializer.is_valid():
            result = correction_devis(serializer.validated_data)
            if result["success"]:
                return Response(
                    {"message": "Devis corrigé avec succès."},
                    status=status.HTTP_201_CREATED,
                )
            else:
                return Response(
                    {"error": result["message"]},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class PrimeUpdateAPIView(APIView):
    """
    Endpoint to manually update prime values by calling the PL/pgSQL stored procedure.
    """

    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def post(self, request, *args, **kwargs):
        serializer = PrimeUpdateSerializer(data=request.data)

        if serializer.is_valid():
            # Extract validated data
            validated_data = serializer.validated_data

            p_numero_devis = validated_data["numero_devis"]
            # sp_maj_manuelle_primes ne fait rien, sans erreur, si le numéro ne désigne pas un devis
            # non archivé ; sur un devis confirmé elle réécrirait la police et sa quittance
            devis = Devis.objects.filter(numerodevis=p_numero_devis, archive=False).first()
            if devis is None:
                return Response(
                    {"message": f"Devis {p_numero_devis} introuvable ou archivé."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if devis.confirme:
                return Response(
                    {"message": f"Le devis {p_numero_devis} est déjà confirmé : ses primes ne peuvent plus être imposées."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            p_prime_annuelle = validated_data["prime_annuelle"]
            p_prime_nette = validated_data["prime_nette"]
            p_accessoire = validated_data["accessoire"]
            p_taxe = validated_data["taxe"]
            p_fga = validated_data["fga"]
            p_cedeao = validated_data["cedeao"]
            p_prime_ttc = validated_data["prime_ttc"]

            try:
                # Call the utility function to execute the stored procedure
                execute_maj_manuelle_primes(
                    p_numero_devis,
                    p_prime_annuelle,
                    p_prime_nette,
                    p_accessoire,
                    p_taxe,
                    p_fga,
                    p_cedeao,
                    p_prime_ttc,
                )

                return Response(
                    {
                        "message": "Mise à jour des primes effectuée avec succès.",
                        "numero_devis": p_numero_devis,
                    },
                    status=status.HTTP_200_OK,
                )

            except Exception as e:
                # Handle database or execution errors
                return Response(
                    {
                        "message": "Les primes n'ont pas pu être imposées.",
                        "details": str(e),
                    },
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class GarantiesVehiculeFlotteAPIView(APIView):
    """
    POST /api/garantiesvehiculeflotte/ : garanties d'un seul véhicule d'une flotte automobile
    (garanties ajoutées, retirées ou à primes imposées), puis totaux du devis recalculés.
    sp_correction_devis ne convient pas : elle applique sa liste à tous les véhicules du devis.
    """

    permission_classes = [
        permissions.IsAuthenticated,
    ]

    def post(self, request, *args, **kwargs):
        serializer = GarantiesVehiculeFlotteSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        donnees = serializer.validated_data

        devis = Devis.objects.filter(pk=donnees["id_devis"], archive=False).first()
        if devis is None:
            return Response(
                {"message": f"Devis {donnees['id_devis']} introuvable ou archivé."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if devis.produit_id != 1 or not devis.flotte:
            return Response(
                {"message": f"Le devis {devis.numerodevis} n'est pas une flotte automobile."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if devis.confirme:
            return Response(
                {"message": f"Le devis {devis.numerodevis} est déjà confirmé : ses garanties ne peuvent plus être modifiées."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not DevisDetail.objects.filter(pk=donnees["id_devis_detail"], iddevis=devis).exists():
            return Response(
                {"message": f"Ce véhicule n'appartient pas au devis {devis.numerodevis}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            primes = appliquer_garanties_vehicule_flotte(
                devis.pk, donnees["id_devis_detail"], donnees["liste_garantie"]
            )
        except Exception as e:
            logger.exception("Garanties du véhicule %s non appliquées", donnees["id_devis_detail"])
            return Response(
                {
                    "message": "Les garanties du véhicule n'ont pas pu être enregistrées.",
                    "details": str(e).split("\n")[0],
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response(
            {"message": "Garanties du véhicule enregistrées.", **primes},
            status=status.HTTP_200_OK,
        )


# ============================================================================
# SECTION 1 : ENDPOINTS DE RÉFÉRENCE (LECTURE SEULE)
# ============================================================================


class UsageHabitationViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet pour lister les usages habitation disponibles.

    GET /api/mrh/usages/
    GET /api/mrh/usages/{code}/
    """

    queryset = UsageHabitation.objects.filter(actif=True).order_by("libelle")
    serializer_class = UsageHabitationSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "code"

    @action(detail=True, methods=["get"])
    def parametres(self, request, code=None):
        """
        Retourne les paramètres de calcul pour un usage spécifique.

        GET /api/mrh/usages/{code}/parametres/
        """
        usage = cast(UsageHabitation, self.get_object())

        try:
            parametres = usage.parametres
            serializer = ParametresCalculSerializer(parametres)
            return Response(serializer.data)
        except ParametresCalcul.DoesNotExist:
            return Response(
                {"erreur": f"Paramètres de calcul non trouvés pour {code}"},
                status=status.HTTP_404_NOT_FOUND,
            )

    @action(detail=True, methods=["get"])
    def garanties(self, request, code=None):
        """
        Retourne les sous-garanties (obligatoires et optionnelles) pour un usage.

        GET /api/mrh/usages/{code}/garanties/
        """
        usage = cast(UsageHabitation, self.get_object())

        # Garanties obligatoires
        sous_garanties_oblig = (
            usage.sous_garanties_liees.filter(obligatoire=True, actif=True)
            .select_related("sous_garantie")
            .order_by("ordre_affichage")
        )

        # Garanties optionnelles
        sous_garanties_opt = (
            usage.sous_garanties_liees.filter(obligatoire=False, actif=True)
            .select_related("sous_garantie")
            .order_by("ordre_affichage")
        )

        return Response(
            {
                "obligatoires": [
                    {
                        "code": gu.sous_garantie.code,
                        "libelle": gu.sous_garantie.libelle,
                        "taux_repartition": gu.taux_repartition,
                    }
                    for gu in sous_garanties_oblig
                ],
                "optionnelles": [
                    {
                        "code": gu.sous_garantie.code,
                        "libelle": gu.sous_garantie.libelle,
                    }
                    for gu in sous_garanties_opt
                ],
            }
        )

    @action(detail=True, methods=["get"])
    def offres(self, request, code=None):
        """
        Retourne les offres pour un usage.

        GET /api/mrh/usages/{code}/offres/
        """
        usage = cast(UsageHabitation, self.get_object())

        offre_mrh_liee = usage.offre
        return Response(
            {
                "id_offre": offre_mrh_liee.IdOffre if offre_mrh_liee else "",
                "libelle_offre": (
                    offre_mrh_liee.LibelleOffre if offre_mrh_liee else ""
                ),
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["get"])
    def options(self, request, code=None):
        """
        Retourne les options applicables à un usage.

        GET /api/mrh/usages/{code}/options/
        """
        usage = self.get_object()

        options = (
            Option.objects.filter(
                usages_applicables__usage=usage,
                usages_applicables__actif=True,
                actif=True,
            )
            .distinct()
            .order_by("type_option", "libelle")
        )

        serializer = OptionSerializer(options, many=True)
        return Response(serializer.data)


class SousGarantieMRHViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet pour lister les sous-garanties MRH.

    GET /api/mrh/sous-garanties/
    GET /api/mrh/sous-garanties/{code}/
    """

    queryset = SousGarantieMRH.objects.filter(actif=True).order_by(
        "type", "libelle"
    )
    serializer_class = SousGarantieMRHSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "code"


class SousGarantieForfaitViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet pour lister les garanties optionnelles à forfait.

    GET /api/mrh/sous-garanties-forfait/
    """

    queryset = SousGarantieForfait.objects.filter(actif=True).select_related(
        "sous_garantie"
    )
    serializer_class = SousGarantieForfaitSerializer
    permission_classes = [IsAuthenticated]


class OptionViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet pour lister les options disponibles.

    GET /api/mrh/options/
    GET /api/mrh/options/{code}/
    """

    queryset = Option.objects.filter(actif=True).order_by(
        "type_option", "libelle"
    )
    serializer_class = OptionSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "code"


# ============================================================================
# MISE A JOUR DU DEVIS
# ============================================================================
class MiseAJourDevis(APIView):
    @action(detail=True, methods=["post"])
    def garanties(self, request, pk=None):
        """
        Met à jour un devis avec les informations.

        GET /api/mrh/devis//garanties/
        """
        usage = cast(UsageHabitation, self.get_object())

        # Garanties obligatoires
        sous_garanties_oblig = (
            usage.sous_garanties_liees.filter(obligatoire=True, actif=True)
            .select_related("sous_garantie")
            .order_by("ordre_affichage")
        )

        # Garanties optionnelles
        sous_garanties_opt = (
            usage.sous_garanties_liees.filter(obligatoire=False, actif=True)
            .select_related("sous_garantie")
            .order_by("ordre_affichage")
        )

        return Response(
            {
                "obligatoires": [
                    {
                        "code": gu.sous_garantie.code,
                        "libelle": gu.sous_garantie.libelle,
                        "taux_repartition": gu.taux_repartition,
                    }
                    for gu in sous_garanties_oblig
                ],
                "optionnelles": [
                    {
                        "code": gu.sous_garantie.code,
                        "libelle": gu.sous_garantie.libelle,
                    }
                    for gu in sous_garanties_opt
                ],
            }
        )


# ============================================================================
# SECTION 2 : ENDPOINT DE CALCUL (SANS ENREGISTREMENT)
# ============================================================================


class CalculMaisonView(APIView):
    """
    Calcule la prime d'une maison SANS l'enregistrer.
    Utile pour des simulations ou devis rapides.

    POST /api/mrh/calcul/maison/

    Body:
    {
        "code_usage": "proprietaire_occupant_total",
        "valeur_batiment": 50000000,
        "valeur_contenu": 10000000,
        "options": ["presence_gardien"],
        "sous_garanties_optionnelles": ["RC_MEMBRE"]
    }

    Response:
    {
        "code_usage": "proprietaire_occupant_total",
        "libelle_usage": "Propriétaire Occupant Total",
        "prime_base": 152000.00,
        "prime_nette_totale": 153680.00,
        "taxe_totale": 27869.60,
        "prime_ttc_totale": 181549.60,
        "sous_garanties": [...],
        "options_appliquees": [...]
    }
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        # Valider les données d'entrée
        serializer = MaisonCalculRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                serializer.errors, status=status.HTTP_400_BAD_REQUEST
            )

        data = serializer.validated_data
        service = MRHCalculService()

        repartition_manuelle = {
            item["code_sous_garantie"]: item["montant"]
            for item in data.get("repartition_manuelle", [])
        } or None

        try:
            # Calculer la prime
            resultat = service.calculer_maison(
                code_usage=data["code_usage"],
                valeur_batiment=data.get("valeur_batiment"),
                valeur_contenu=data.get("valeur_contenu"),
                loyer_mensuel=data.get("loyer_mensuel"),
                capital_rvt=data.get("capital_rvt"),
                options=[
                    opt["code_option"] for opt in data.get("options", [])
                ],
                sous_garanties_optionnelles=[
                    gar["code_sous_garantie"]
                    for gar in data.get("sous_garanties_optionnelles", [])
                ],
                adresse=data.get("adresse"),
                description=data.get("description"),
                repartition_manuelle=repartition_manuelle,
            )

            # Sérialiser la réponse
            response_serializer = MaisonCalculeeSerializer(resultat)
            return Response(
                response_serializer.data, status=status.HTTP_200_OK
            )

        except Exception as e:
            return Response(
                {"error": _message_erreur_mrh(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )


# ============================================================================
# SECTION 3 : ENDPOINTS DE GESTION DE DEVIS
# ============================================================================

# Tarif MRH enregistré par URANUS sur chaque maison (stddevisdetail.idtarif)
ID_TARIF_MRH = 81


def _message_erreur_mrh(exc):
    """Message lisible d'une erreur de calcul/enregistrement MRH."""
    detail = getattr(exc, "detail", None)
    if detail is None:
        detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", None)
    if isinstance(detail, dict):
        return " ; ".join(
            " ".join(str(m) for m in (v if isinstance(v, (list, tuple)) else [v]))
            for v in detail.values()
        )
    if isinstance(detail, (list, tuple)):
        return " ; ".join(str(m) for m in detail)
    return str(detail if detail is not None else exc)


def _montant_mrh(valeur):
    if valeur in (None, ""):
        return None
    return Decimal(str(valeur))


def _codes_mrh(liste, cle):
    """Accepte ["code", ...] ou [{cle: "code"}, ...]."""
    return [
        (element.get(cle) if isinstance(element, dict) else element)
        for element in (liste or [])
        if element
    ]


def _enregistrer_maisons_mrh(devis, maisons, id_tarif=None):
    """
    Calcule et enregistre les maisons du formulaire dans le devis.
    L'offre de chaque maison est celle de son usage (comme dans URANUS).
    Retourne les totaux du devis mis à jour.
    """
    service = MRHCalculService()
    totaux = None
    for maison in maisons:
        code_usage = maison.get("code_usage")
        usage = UsageHabitation.objects.filter(code=code_usage).first()
        if not usage or not usage.offre_id:
            raise ValueError(f"Usage habitation inconnu ou sans offre : {code_usage}")
        resultat = service.calculer_et_enregistrer_maison(
            id_devis=devis.iddevis,
            id_produit=devis.produit_id,
            id_compagnie=devis.compagnie_id,
            id_tarif=id_tarif or ID_TARIF_MRH,
            id_offre=usage.offre_id,
            code_usage=code_usage,
            valeur_batiment=_montant_mrh(maison.get("valeur_batiment")),
            valeur_contenu=_montant_mrh(maison.get("valeur_contenu")),
            loyer_mensuel=_montant_mrh(maison.get("loyer_mensuel")),
            capital_rvt=_montant_mrh(maison.get("capital_rvt")),
            options=_codes_mrh(maison.get("options"), "code_option"),
            sous_garanties_optionnelles=_codes_mrh(
                maison.get("sous_garanties_optionnelles"), "code_sous_garantie"
            ),
            adresse=maison.get("adresse") or "",
        )
        totaux = resultat["totaux_devis"]
    return totaux


def _totaux_devis_mrh(devis):
    """Montants enregistrés sur l'en-tête du devis (après imposition éventuelle)."""
    return {
        "prime_nette_totale": float(devis.primenette or 0),
        "taxe_totale": float(devis.taxe or 0),
        "accessoire": float(devis.accessoire or 0),
        "primettc": float(devis.primettc or 0),
        "prime_imposee": bool(devis.prime_imposee),
    }


def _imposer_mrh(devis, imposition, user):
    """
    Applique l'imposition saisie à l'étape « Récapitulatif » :
    imposition = {"montants_maisons": [PN imposée par maison, dans l'ordre],
                  "montant_taxe": ..., "montant_accessoire": ..., "motif": ...}
    """
    from .models import DevisDetail

    ids_maisons = list(
        DevisDetail.objects.filter(iddevis_id=devis.iddevis)
        .order_by("iddevisdetail")
        .values_list("iddevisdetail", flat=True)
    )
    montants = [_montant_mrh(m) or Decimal("0") for m in imposition.get("montants_maisons") or []]
    if len(montants) != len(ids_maisons):
        raise ValueError("Imposition : une prime imposée est attendue pour chaque maison.")
    resultat = MRHCalculService().imposer_prime_devis(
        id_devis=devis.iddevis,
        montant_impose=sum(montants),
        repartition_maisons=[
            {"id_maison": id_maison, "montant": montant}
            for id_maison, montant in zip(ids_maisons, montants)
        ],
        montant_accessoire=_montant_mrh(imposition.get("montant_accessoire")),
        montant_taxe=_montant_mrh(imposition.get("montant_taxe")) or None,
        user_id=getattr(user, "id", None),
        user_nom=user.get_full_name() if hasattr(user, "get_full_name") else str(user),
        motif=imposition.get("motif") or "",
    )
    if not resultat.get("success", False):
        raise ValueError(resultat.get("message") or resultat.get("erreur") or "Imposition refusée")
    _aligner_garanties_mrh(ids_maisons)
    return resultat


def _aligner_garanties_mrh(ids_maisons):
    """
    Prime imposée : les garanties de chaque maison sont ramenées à sa prime nette, au prorata
    de leurs primes calculées (règle du reliquat de repartir-garanties), la taxe de chaque
    garantie recalculée à son taux. Sans cela, la proposition imprime des garanties dont la
    somme n'est pas la prime nette du devis. La répartition reste ajustable ensuite.
    """
    from .models import DevisDetail, DevisDetGarantie

    service = MRHCalculService()
    with connection.cursor() as cursor:
        cursor.execute("SELECT idsousgarantie, code FROM stdmrh_sous_garantie")
        codes_mrh = dict(cursor.fetchall())
    for maison in DevisDetail.objects.filter(iddevisdetail__in=ids_maisons):
        garanties = list(
            DevisDetGarantie.objects.filter(IdDevisDet_id=maison.iddevisdetail).order_by("pk")
        )
        poids = sum((g.PrimeNette or Decimal("0")) for g in garanties)
        if not garanties or not poids:
            continue
        reste = maison.primenette or Decimal("0")
        for i, garantie in enumerate(garanties):
            if i == len(garanties) - 1:
                prime = reste
            else:
                prime = service._arrondir(maison.primenette * (garantie.PrimeNette or 0) / poids)
                reste -= prime
            taux = service._get_taux_taxe(codes_mrh.get(garantie.IdGarantie_id, ""))
            taxe = service._arrondir(prime * taux)
            DevisDetGarantie.objects.filter(pk=garantie.pk).update(
                PrimeNette=prime, taxe=taxe, primeannuelle=prime + taxe
            )


class DevisMRHViewSet(viewsets.ViewSet):
    """
    ViewSet pour la gestion des devis MRH.

    POST /api/mrh/devis/ - Créer un devis vide
    GET /api/mrh/devis/{id}/ - Récupérer un devis
    PATCH /api/mrh/devis/{id}/finalisation
    GET /api/mrh/devis/ - Lister les devis
    DELETE /api/mrh/devis/{id}/ - Supprimer un devis
    """

    permission_classes = [IsAuthenticated]

    def create(self, request):
        """
        Crée un nouveau devis MRH vide.

        POST /api/mrh/devis/

        Body:
        {
            "idintermediaire": 1,
            "idcompagnie": 1,
            "idproduit": 4,
            "idtarif": 81
            "idoffre": 10,
            "idclient": 123,
            "dateeffet": "2024-01-01T00:00:00Z",
            "observation": "Devis MRH Villa Cocody"
        }
        """
        serializer = DevisMRHCreateRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                serializer.errors, status=status.HTTP_400_BAD_REQUEST
            )

        data = serializer.validated_data
        service = MRHCalculService()
        # Maisons envoyées avec l'en-tête : devis complet enregistré d'un bloc
        maisons = request.data.get("maisons") or []

        try:
            with transaction.atomic():
                # Créer le devis
                id_devis = service.creer_devis(
                    idintermediaire=data["idintermediaire"],
                    idcompagnie=data["idcompagnie"],
                    idproduit=data["idproduit"],
                    idtarif=data["idtarif"],
                    idoffre=data["idoffre"],
                    idclient=data["idclient"],
                    dateeffet=data["dateeffet"],
                    **{
                        k: v
                        for k, v in data.items()
                        if k
                        not in [
                            "idintermediaire",
                            "idcompagnie",
                            "idproduit",
                            "idtarif",
                            "idoffre",
                            "idclient",
                            "dateeffet",
                        ]
                    },
                )

                from .models import Devis  # Import local

                devis = Devis.objects.get(iddevis=id_devis)
                # Téléphone de l'assuré : mobile de sa fiche client, comme à la modification
                numero_telephone_assure = data.get("numerotelephoneassure")
                if numero_telephone_assure:
                    from customer.models import Client

                    Client.objects.filter(IdClient=devis.assure_id).update(
                        Mobile=numero_telephone_assure
                    )
                if maisons:
                    _enregistrer_maisons_mrh(devis, maisons, data["idtarif"])
                if maisons and request.data.get("imposition"):
                    _imposer_mrh(devis, request.data["imposition"], request.user)
                devis.refresh_from_db()

            # Retourner la réponse
            response_data = {
                "devis_id": id_devis,
                "numero_devis": devis.numerodevis or "",
                "statut": "success",
                "message": "Devis créé avec succès",
                "date_creation": devis.dateemission,
            }

            response_serializer = DevisMRHResponseSerializer(response_data)
            return Response(
                {**response_serializer.data, "totaux": _totaux_devis_mrh(devis)},
                status=status.HTTP_201_CREATED,
            )

        except Exception as e:
            return Response(
                {"error": _message_erreur_mrh(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def update(self, request, pk=None):
        """
        Modifie un devis MRH non confirmé avec toutes ses valeurs.

        PUT /api/mrh/devis/{id}/

        Body : mêmes champs d'en-tête que la création + "maisons" (liste
        complète). Les maisons du devis sont recalculées et remplacées ;
        tout est annulé si une maison ne peut pas être calculée.
        """
        from customer.models import Client

        from .models import DevisDetail

        devis = get_object_or_404(Devis, pk=pk)
        if devis.confirme:
            return Response(
                {"error": "Ce devis est confirmé (déjà en contrat) : il ne peut plus être modifié."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = DevisMRHCreateRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                serializer.errors, status=status.HTTP_400_BAD_REQUEST
            )
        data = serializer.validated_data
        maisons = request.data.get("maisons") or []
        if not maisons:
            return Response(
                {"error": "Un devis MRH doit comporter au moins une maison."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                idduree = data.get("idduree") or devis.idduree
                dateexpiration = data.get("dateexpiration") or calculer_date_expiration(
                    date_effet=data["dateeffet"], id_duree=idduree, nombre_jours=0
                )
                devis.compagnie_id = data["idcompagnie"]
                devis.client_id = data["idclient"]
                devis.assure_id = data.get("idassure") or data["idclient"]
                devis.dateeffet = data["dateeffet"]
                devis.dateexpiration = dateexpiration
                # Date d'émission imposée : celle du jour de la modification
                devis.dateemission = timezone.now()
                devis.idduree = idduree
                devis.idterme = data.get("idterme") or devis.idterme
                devis.numero_police_compagnie = data.get("numeropolicecompagnie", "")

                # Impositions en cours closes : le devis est recalculé (une imposition
                # saisie à l'écran est réappliquée plus bas)
                anciennes_maisons = list(
                    DevisDetail.objects.filter(iddevis_id=devis.iddevis).values_list(
                        "iddevisdetail", flat=True
                    )
                )
                user = request.user
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE stdmrh_imposition_prime
                        SET actif = FALSE,
                            date_levee = CURRENT_TIMESTAMP,
                            levee_par_user_id = %s,
                            levee_par_user_nom = %s,
                            motif_levee = %s
                        WHERE actif = TRUE
                          AND ((type_imposition = 'DEVIS' AND id_cible = %s)
                               OR (type_imposition = 'MAISON' AND id_cible = ANY(%s)))
                        """,
                        [
                            getattr(user, "id", None),
                            user.get_full_name() if hasattr(user, "get_full_name") else str(user),
                            "Modification du devis",
                            devis.iddevis,
                            anciennes_maisons,
                        ],
                    )
                devis.prime_imposee = False
                devis.prime_imposee_date = None
                devis.save()

                numero_telephone_assure = data.get("numerotelephoneassure")
                if numero_telephone_assure:
                    Client.objects.filter(IdClient=devis.assure_id).update(
                        Mobile=numero_telephone_assure
                    )

                # Remplace les maisons (garanties supprimées en cascade)
                for ancienne in DevisDetail.objects.filter(iddevis_id=devis.iddevis):
                    ancienne.delete()
                _enregistrer_maisons_mrh(devis, maisons, data["idtarif"])
                if request.data.get("imposition"):
                    _imposer_mrh(devis, request.data["imposition"], request.user)
                devis.refresh_from_db()

            return Response(
                {
                    "devis_id": devis.iddevis,
                    "numero_devis": devis.numerodevis or "",
                    "statut": "success",
                    "message": "Devis modifié avec succès",
                    "totaux": _totaux_devis_mrh(devis),
                },
                status=status.HTTP_200_OK,
            )
        except Exception as e:
            return Response(
                {"error": _message_erreur_mrh(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=False, methods=["post"], url_path="accessoire")
    def accessoire(self, request):
        """
        Accessoire du devis selon la prime nette totale (paliers stdaccessoire).

        POST /api/mrh/devis/accessoire/  {"idcompagnie": 1, "prime_nette": 22563}
        """
        try:
            prime_nette = Decimal(str(request.data.get("prime_nette") or 0))
            idcompagnie = int(request.data.get("idcompagnie") or 0)
            idproduit = int(request.data.get("idproduit") or 4)
        except Exception:
            return Response(
                {"error": "prime_nette et idcompagnie sont requis"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        resultat = MRHCalculService().calculer_accessoire(
            prime_nette_totale=prime_nette,
            id_produit=idproduit,
            id_compagnie=idcompagnie,
        )
        return Response(
            {k: float(v) for k, v in resultat.items()},
            status=status.HTTP_200_OK,
        )

    def partial_update(self, request, pk=None):
        mrh_devis = get_object_or_404(Devis, pk=pk)
        from customer.models import Client

        idassure = request.data.get("idassure", 0)
        idclient = request.data.get("idclient", 0)
        numero_telephone_assure = request.data.get("numerotelephoneassure", "")

        # Pass update_data instead of request.data
        try:
            with transaction.atomic():
                if idclient:
                    mrh_devis.client_id = idclient
                if idassure:
                    mrh_devis.assure_id = idassure
                mrh_devis.save()
                if numero_telephone_assure and idassure:
                    assure = Client.objects.filter(IdClient=idassure).first()
                    assure.Mobile = numero_telephone_assure
                    assure.save()

                return Response(
                    {"message": "Devis enregistré avec succès"},
                    status=status.HTTP_200_OK,
                )
        except Exception as e:
            return Response(
                {"erreur": str(e)}, status=status.HTTP_400_BAD_REQUEST
            )

    def retrieve(self, request, pk=None):
        """
        Récupère les détails d'un devis avec toutes ses maisons.

        GET /api/mrh/devis/{id}/
        """
        from .models import Devis, DevisDetail  # Import local

        try:
            devis = Devis.objects.get(iddevis=pk)
            maisons = DevisDetail.objects.filter(iddevis_id=pk)

            # Construire la réponse
            response_data = {
                "devis_id": devis.iddevis,
                "numero_devis": devis.numerodevis,
                "statut": "success",
                "message": "Devis récupéré avec succès",
                "prime_nette_totale": devis.primenette,
                "taxe_totale": devis.taxe,
                "accessoires": devis.accessoire,
                "prime_ttc_totale": devis.primettc,
                "maisons": [
                    {
                        "maison_id": str(m.iddevisdetail),
                        "code_usage": (
                            m.observation[:30] if m.observation else ""
                        ),  # Approximatif
                        "libelle_usage": (
                            m.observation[:30] if m.observation else ""
                        ),
                        "parametres": {
                            "valeur_batiment": m.valeurneuve,
                            "valeur_contenu": m.valeurvenale,
                        },
                        "prime_nette_totale": m.primenette,
                        "prime_annuelle_totale": m.primeannuelle,
                        "taxe_totale": m.taxeenregistrement,
                        "prime_ttc_totale": m.primenette
                        + m.taxeenregistrement,
                        "sous_garanties": [],  # Peut être enrichi si besoin
                        "options_appliquees": [],
                        "adresse": (
                            m.observation[33:]
                            if len(m.observation or "") > 33
                            else ""
                        ),
                    }
                    for m in maisons
                ],
                "nombre_maisons": maisons.count(),
                "date_calcul": devis.dateemission,
            }

            serializer = DevisMRHCalculeResponseSerializer(response_data)
            return Response(serializer.data, status=status.HTTP_200_OK)

        except Devis.DoesNotExist:
            return Response(
                {"error": f"Devis {pk} non trouvé"},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def list(self, request):
        """
        Liste les devis (avec filtres optionnels).

        GET /api/mrh/devis/?client={id}&statut={statut}
        """
        from .models import Devis  # Import local

        queryset = Devis.objects.all().order_by("-dateemission")

        # Filtres optionnels
        client_id = request.query_params.get("client", None)
        if client_id:
            queryset = queryset.filter(client_id=client_id)

        statut = request.query_params.get("statut", None)
        if statut:
            queryset = queryset.filter(statut=statut)

        # Pagination simple
        page_size = int(request.query_params.get("page_size", 20))
        page = int(request.query_params.get("page", 1))
        start = (page - 1) * page_size
        end = start + page_size

        devis_list = queryset[start:end]

        data = [
            {
                "devis_id": d.iddevis,
                "numero_devis": d.numerodevis,
                "client": d.client_id,
                "date_effet": d.dateeffet,
                "prime_ttc": d.primettc,
                "statut": d.statut,
            }
            for d in devis_list
        ]

        return Response(
            {
                "count": queryset.count(),
                "page": page,
                "page_size": page_size,
                "results": data,
            },
            status=status.HTTP_200_OK,
        )

    def destroy(self, request, pk=None):
        """
        Supprime un devis (et toutes ses maisons en cascade).

        DELETE /api/mrh/devis/{id}/
        """
        from .models import Devis  # Import local

        try:
            devis = Devis.objects.get(iddevis=pk)

            # Vérifier que le devis n'est pas confirmé
            if devis.confirme:
                return Response(
                    {"error": "Impossible de supprimer un devis confirmé"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            devis.delete()

            return Response(
                {"message": f"Devis {pk} supprimé avec succès"},
                status=status.HTTP_204_NO_CONTENT,
            )

        except Devis.DoesNotExist:
            return Response(
                {"error": f"Devis {pk} non trouvé"},
                status=status.HTTP_404_NOT_FOUND,
            )


# ============================================================================
# SECTION 4 : ENDPOINTS DE GESTION DE MAISONS
# ============================================================================


class MaisonViewSet(viewsets.ViewSet):
    """
    ViewSet pour la gestion des maisons dans un devis.

    POST /api/mrh/devis/{devis_id}/maisons/ - Ajouter une maison
    DELETE /api/mrh/devis/{devis_id}/maisons/{maison_id}/ - Supprimer une maison
    PUT /api/mrh/devis/{devis_id}/maisons/{maison_id}/ - Modifier une maison
    """

    permission_classes = [IsAuthenticated]

    def list(self, request, devis_id=None):
        """
        Liste les maisons d'un devis avec leurs garanties.

        GET /api/mrh/devis/{devis_id}/maisons/
        """
        from django.db import connection

        maisons = []
        devis_totaux = {}

        with connection.cursor() as cursor:
            # Totaux du devis (prime_nette, taxe, accessoire, prime_ttc)
            cursor.execute("""
                SELECT primenette, taxe, accessoire, primettc, primeannuelle
                FROM stddevis
                WHERE iddevis = %s
            """, [devis_id])
            row_devis = cursor.fetchone()
            if row_devis:
                devis_totaux = {
                    "prime_nette_totale": float(row_devis[0] or 0),
                    "taxe_totale": float(row_devis[1] or 0),
                    "accessoire": float(row_devis[2] or 0),
                    "prime_ttc_totale": float(row_devis[3] or 0),
                    "prime_annuelle_totale": float(row_devis[4] or 0),
                }

            cursor.execute("""
                SELECT
                    dd.iddevisdetail,
                    dd.modelevehicule AS code_usage,
                    dd.observation,
                    dd.adressecnd,
                    dd.valeurneuve,
                    dd.valeurvenale,
                    dd.chargeutile,
                    dd.valeuraccessoire,
                    dd.primenette,
                    dd.taxeenregistrement,
                    dd.primeannuelle,
                    dd.primeimposee,
                    u.libelle AS usage_libelle,
                    dd.conducteur
                FROM stddevisdetail dd
                LEFT JOIN stdmrh_usage_habitation u ON u.code = dd.modelevehicule
                WHERE dd.iddevis = %s
                ORDER BY dd.iddevisdetail
            """, [devis_id])

            for row in cursor.fetchall():
                (
                    iddevisdetail, code_usage, observation, adresse,
                    valeur_batiment, valeur_contenu, loyer_mensuel, capital_rvt,
                    primenette, taxe, primeannuelle, prime_imposee, usage_libelle,
                    options_json,
                ) = row

                # Options appliquées (JSON stocké dans conducteur à l'enregistrement)
                try:
                    options = [
                        o.get("code_option")
                        for o in json.loads(options_json or "[]")
                        if isinstance(o, dict) and o.get("code_option")
                    ]
                except (TypeError, ValueError):
                    options = []

                pn = float(primenette or 0)
                tx = float(taxe or 0)

                # Récupérer les garanties de cette maison
                cursor.execute("""
                    SELECT
                        dg.idgarantie,
                        g.code,
                        g.libelle,
                        dg.primenette,
                        dg.taxe,
                        dg.primeannuelle,
                        dg.acquise,
                        dg.old_acquise
                    FROM stddevisdetgarantie dg
                    JOIN stdmrh_sous_garantie g ON dg.idgarantie = g.idsousgarantie
                    WHERE dg.iddevisdet = %s
                    ORDER BY g.libelle
                """, [iddevisdetail])

                garanties = [
                    {
                        "id_sous_garantie": r[0],
                        "code_sous_garantie": r[1],
                        "libelle_sous_garantie": r[2],
                        "prime_nette": float(r[3] or 0),
                        "taxe": float(r[4] or 0),
                        "prime_ttc": float(r[5] or 0),
                        "acquise": bool(r[6]),
                        # old_acquise = "0" : garantie optionnelle choisie
                        "optionnelle": str(r[7]) == "0",
                    }
                    for r in cursor.fetchall()
                ]

                maisons.append({
                    "maison_id": iddevisdetail,
                    "code_usage": code_usage,
                    "usage_libelle": usage_libelle or code_usage,
                    "adresse": adresse or "",
                    "parametres": {
                        "valeur_batiment": float(valeur_batiment or 0),
                        "valeur_contenu": float(valeur_contenu or 0),
                        "loyer_mensuel": float(loyer_mensuel or 0),
                        "capital_rvt": float(capital_rvt or 0),
                    },
                    "prime_nette": pn,
                    "taxe": tx,
                    "prime_annuelle": float(primeannuelle or 0),
                    "prime_ttc": pn + tx,
                    "prime_imposee": bool(prime_imposee),
                    "garanties": garanties,
                    "options": options,
                    "sous_garanties_optionnelles": [
                        g["code_sous_garantie"]
                        for g in garanties
                        if g["optionnelle"]
                    ],
                })

        return Response(
            {"maisons": maisons, **devis_totaux},
            status=status.HTTP_200_OK,
        )

    def create(self, request, devis_id=None):
        """
        Ajoute une maison à un devis existant.
        Calcule la prime et enregistre dans la base.
        Met à jour automatiquement les totaux du devis.

        POST /api/mrh/devis/{devis_id}/maisons/

        Body:
        {
            "maison": {
                "code_usage": "proprietaire_occupant_total",
                "id_tarif":81,
                "id_offre": 10,
                "valeur_batiment": 50000000,
                "valeur_contenu": 10000000,
                "options": ["presence_gardien"],
                "sous_garanties_optionnelles": ["RC_MEMBRE"],
                "adresse": "Cocody, Angré"
            }
        }
        """
        from .models import Devis

        # Vérifier que le devis existe
        try:
            devis = Devis.objects.get(iddevis=devis_id)
        except Devis.DoesNotExist:
            return Response(
                {"erreur": f"Devis {devis_id} non trouvé"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Valider les données
        serializer = MaisonAjoutRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                serializer.errors, status=status.HTTP_400_BAD_REQUEST
            )

        data = serializer.validated_data["maison"]
        service = MRHCalculService()

        if not offre_mrh_compatible(data["id_offre"], data["code_usage"]):
            return Response(
                {"erreur": "Offre incompatible avec l'usage"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        repartition_manuelle = {
            item["code_sous_garantie"]: item["montant"]
            for item in data.get("repartition_manuelle", [])
        } or None

        try:
            # Calculer et enregistrer la maison
            resultat = service.calculer_et_enregistrer_maison(
                id_devis=devis_id,
                id_produit=devis.produit_id,
                id_compagnie=devis.compagnie_id,
                id_tarif=data.get("id_tarif"),
                id_offre=data.get("id_offre"),
                code_usage=data["code_usage"],
                valeur_batiment=data.get("valeur_batiment"),
                valeur_contenu=data.get("valeur_contenu"),
                loyer_mensuel=data.get("loyer_mensuel"),
                capital_rvt=data.get("capital_rvt"),
                options=[
                    opt["code_option"] for opt in data.get("options", [])
                ],
                sous_garanties_optionnelles=[
                    gar["code_sous_garantie"]
                    for gar in data.get("sous_garanties_optionnelles", [])
                ],
                adresse=data.get("adresse"),
                description=data.get("description"),
                repartition_manuelle=repartition_manuelle,
            )

            # Construire la réponse
            response_data = {
                "devis_id": devis_id,
                "maison_id": resultat["id_maison"],
                "statut": "success",
                "message": "Maison ajoutée avec succès",
                "calcul": resultat["calcul"],
            }

            response_serializer = MaisonAjouteeResponseSerializer(
                response_data
            )
            return Response(
                response_serializer.data, status=status.HTTP_201_CREATED
            )

        except Exception as e:
            return Response(
                {"error": str(e)}, status=status.HTTP_400_BAD_REQUEST
            )

    def update(self, request, devis_id=None, pk=None):
        """
        Modifier une maison existante dans un devis MRH.

        PUT /api/mrh/devis/{devis_id}/maisons/{maison_id}/

        Permet de modifier les caractéristiques d'une maison :
        - Valeurs (bâtiment, contenu, loyer, RVT)
        - Options (gardien, zone industrielle, etc.)
        - Garanties optionnelles
        - Adresse

        Règles :
        - Si prime maison imposée : erreur (sauf force_recalcul=True)
        - Si prime devis imposée : erreur (sauf force_recalcul=True)
        - Si force_recalcul=True : lève l'imposition automatiquement

        Request body :
        {
            "code_usage": "proprietaire_occupant_total",  // optionnel
            "valeur_batiment": 60000000,  // optionnel
            "valeur_contenu": 12000000,  // optionnel
            "options": ["presence_gardien"],  // optionnel
            "sous_garanties_optionnelles": ["RC_MEMBRE"],  // optionnel
            "force_recalcul": false  // optionnel, défaut false
        }

        Response 200 (succès) :
        {
            "success": true,
            "id_maison": 456,
            "message": "Maison modifiée avec succès",
            "calcul": { ... },
            "totaux_devis": { ... },
            "imposition_levee": false
        }

        Response 400 (prime imposée) :
        {
            "success": false,
            "erreur": "PRIME_MAISON_IMPOSEE",
            "message": "La prime de cette maison est imposée à 150 000,00 FCFA...",
            "prime_imposee": true,
            "montant_impose": 150000.00
        }
        """

        # Validation des données
        serializer = MaisonModificationRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                serializer.errors, status=status.HTTP_400_BAD_REQUEST
            )

        # Vérifier que la maison appartient au devis
        maison = get_object_or_404(DevisDetail, iddevisdetail=pk)
        if maison.iddevis_id != int(devis_id):
            return Response(
                {
                    "erreur": "MAISON_NOT_IN_DEVIS",
                    "message": f"La maison {pk} n'appartient pas au devis {devis_id}",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Appeler le service métier
        service = MRHCalculService()
        try:
            resultat = service.modifier_maison(
                id_maison=pk, **serializer.validated_data
            )

            # Si échec (prime imposée)
            if not resultat.get("success", False):
                return Response(resultat, status=status.HTTP_400_BAD_REQUEST)

            # Succès
            return Response(resultat, status=status.HTTP_200_OK)

        except ValueError as e:
            return Response(
                {"erreur": "VALIDATION_ERROR", "message": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        except Exception as e:
            return Response(
                {
                    "erreur": "INTERNAL_ERROR",
                    "message": f"Erreur lors de la modification : {str(e)}",
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def destroy(self, request, devis_id=None, pk=None):
        """
        Supprime une maison d'un devis.
        Met à jour automatiquement les totaux du devis.

        DELETE /api/mrh/devis/{devis_id}/maisons/{maison_id}/
        """
        from .models import Devis, DevisDetail  # Import local

        try:
            # Vérifier que le devis existe
            devis = Devis.objects.get(iddevis=devis_id)

            # Vérifier que la maison existe et appartient bien au devis
            maison = DevisDetail.objects.get(
                iddevisdetail=pk, iddevis_id=devis_id
            )

            # Supprimer la maison (les garanties seront supprimées en cascade)
            maison.delete()

            # Mettre à jour les totaux du devis
            service = MRHCalculService()
            totaux = service.mettre_a_jour_totaux_devis(
                id_devis=devis_id,
                id_produit=devis.produit_id,
                id_compagnie=devis.compagnie_id,
                inclure_accessoires=True,
            )

            return Response(
                {
                    "message": f"Maison {pk} supprimée avec succès",
                    "totaux_devis": totaux,
                },
                status=status.HTTP_200_OK,
            )

        except Devis.DoesNotExist:
            return Response(
                {"error": f"Devis {devis_id} non trouvé"},
                status=status.HTTP_404_NOT_FOUND,
            )
        except DevisDetail.DoesNotExist:
            return Response(
                {"error": f"Maison {pk} non trouvée dans le devis {devis_id}"},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


# ============================================================================
# SECTION 5 : ENDPOINTS UTILITAIRES
# ============================================================================


class ValidateParametersView(APIView):
    """
    Valide les paramètres pour un usage donné sans faire de calcul.
    Utile pour validation côté frontend.

    POST /api/mrh/validate-parameters/

    Body:
    {
        "code_usage": "proprietaire_occupant_total",
        "valeur_batiment": 50000000,
        "valeur_contenu": 10000000
    }

    Response:
    {
        "valid": true,
        "errors": {}
    }
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = MaisonCalculRequestSerializer(data=request.data)

        if serializer.is_valid():
            return Response(
                {"valid": True, "errors": {}}, status=status.HTTP_200_OK
            )
        else:
            return Response(
                {"valid": False, "errors": serializer.errors},
                status=status.HTTP_200_OK,
            )


class RecalculerDevisView(APIView):
    """
    Recalcule les totaux d'un devis (utile après modification manuelle).

    POST /api/mrh/devis/{devis_id}/recalculer/
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, devis_id):
        from .models import Devis  # Import local

        try:
            devis = Devis.objects.get(iddevis=devis_id)

            service = MRHCalculService()
            totaux = service.mettre_a_jour_totaux_devis(
                id_devis=devis_id,
                id_produit=devis.produit_id,
                id_compagnie=devis.compagnie_id,
                inclure_accessoires=True,
            )

            return Response(
                {"message": "Devis recalculé avec succès", "totaux": totaux},
                status=status.HTTP_200_OK,
            )

        except Devis.DoesNotExist:
            return Response(
                {"erreur": f"Devis {devis_id} non trouvé"},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"erreur": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


"""
Vue pour l'endpoint de résumé financier des devis MRH
======================================================
"""


class ResumeFinancierDevisView(APIView):
    """
    Endpoint pour obtenir le résumé financier complet d'un devis MRH.

    GET /api/mrh/devis/{devis_id}/resume-financier/

    Retourne :
    - Prime nette totale (après options)
    - Prime annuelle (avant options)
    - Accessoires
    - Taxe totale (garanties + accessoire)
    - Prime TTC
    - Liste des garanties acquises avec prime nette et taxe

    Permissions :
    - Utilisateur authentifié

    Exemples d'utilisation :

    curl http://localhost:8000/api/mrh/devis/456/resume-financier/

    Réponse :
    {
        "id_devis": 456,
        "numero_devis": "DEV-MRH-2024-00456",
        "prime_nette_totale": 153680.00,
        "prime_annuelle": 153680.00,
        "accessoire": 5000.00,
        "taxe_totale": 28594.60,
        "prime_ttc": 187274.60,
        "taxe_sous_garanties": 27869.60,
        "taxe_accessoire": 725.00,
        "accessoire_details": {...},
        "statistiques": {...},
        "sous_garanties_acquises": [...]
    }
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, devis_id):
        """
        Récupère le résumé financier complet du devis.

        Args:
            request: Requête HTTP
            devis_id: ID du devis

        Returns:
            Response avec le résumé financier complet
        """
        try:
            # Calculer le résumé financier
            resume = obtenir_resume_financier_devis(devis_id)

            # Sérialiser la réponse
            serializer = ResumeFinancierDevisSerializer(resume)

            return Response(serializer.data, status=status.HTTP_200_OK)

        except ValueError as e:
            # Devis non trouvé
            return Response(
                {"erreur": str(e), "code": "DEVIS_INTROUVABLE"},
                status=status.HTTP_404_NOT_FOUND,
            )

        except Exception as e:
            # Erreur interne
            return Response(
                {
                    "erreur": f"Erreur lors du calcul du résumé financier : {str(e)}",
                    "code": "ERREUR_INTERNE",
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class RepartirGarantiesView(APIView):
    """
    Répartition manuelle des primes par garantie pour une maison existante.

    POST /api/mrh/devis/{devis_id}/repartir-garanties/

    Body:
    {
        "id_maison": 123,
        "garanties": [
            {"code_sous_garantie": "INCENDIE", "montant": 4000},
            {"code_sous_garantie": "DEGAT_EAUX", "montant": 3000}
        ]
    }

    - La taxe est calculée automatiquement par le backend.
    - Les garanties non listées reçoivent le reliquat (total_actuel - somme_listée)
      redistribué proportionnellement à leur poids actuel.
    - Contrainte : somme des montants ≤ total prime nette actuelle de la maison.
    """

    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, devis_id):
        from decimal import Decimal
        from production.models import Devis, DevisDetail, DevisDetGarantie
        from production.services.mrh_calcul_service import MRHCalculService
        from production.services.resume_financier_devis import obtenir_resume_financier_devis

        id_maison = request.data.get("id_maison")
        garanties_data = request.data.get("garanties", [])

        if not id_maison:
            return Response({"erreur": "id_maison requis"}, status=status.HTTP_400_BAD_REQUEST)
        if not garanties_data:
            return Response({"erreur": "Aucune garantie fournie"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            devis = Devis.objects.get(iddevis=devis_id)
        except Devis.DoesNotExist:
            return Response({"erreur": "Devis introuvable"}, status=status.HTTP_404_NOT_FOUND)

        try:
            maison = DevisDetail.objects.get(iddevisdetail=id_maison, iddevis_id=devis_id)
        except DevisDetail.DoesNotExist:
            return Response({"erreur": "Maison introuvable dans ce devis"}, status=status.HTTP_404_NOT_FOUND)

        # Garanties actuelles de la maison
        garanties_actuelles = list(DevisDetGarantie.objects.filter(IdDevisDet_id=id_maison).select_related("IdGarantie"))

        # Référence pour la contrainte et la redistribution :
        # si la prime est imposée, c'est maison.primenette (le montant imposé) qui fait foi,
        # pas la somme des primenettes des garanties (qui peuvent être les anciennes valeurs calculées).
        from decimal import ROUND_HALF_UP
        total_actuel = maison.primenette

        # Construire dict {code_garantie: montant_manuel}
        service = MRHCalculService()
        repartition = {
            item["code_sous_garantie"]: Decimal(str(item["montant"]))
            for item in garanties_data
        }
        capitaux = {
            item["code_sous_garantie"]: Decimal(str(item["capital"]))
            for item in garanties_data
            if item.get("capital") is not None
        }
        franchises = {
            item["code_sous_garantie"]: Decimal(str(item["franchise"]))
            for item in garanties_data
            if item.get("franchise") is not None
        }
        minfranchises = {
            item["code_sous_garantie"]: Decimal(str(item["minfranchise"]))
            for item in garanties_data
            if item.get("minfranchise") is not None
        }
        maxfranchises = {
            item["code_sous_garantie"]: Decimal(str(item["maxfranchise"]))
            for item in garanties_data
            if item.get("maxfranchise") is not None
        }
        tauxfranchises = {
            item["code_sous_garantie"]: Decimal(str(item["tauxfranchise"]))
            for item in garanties_data
            if item.get("tauxfranchise") is not None
        }

        # Validation : somme ≤ prime nette de la maison (calculée ou imposée)
        somme_manuelle = sum(repartition.values())
        total_pour_comparaison = total_actuel.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        if somme_manuelle > total_pour_comparaison:
            return Response(
                {
                    "erreur": (
                        f"La somme des montants ({somme_manuelle}) dépasse "
                        f"la prime nette de la maison ({total_pour_comparaison})."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        reliquat = total_actuel - somme_manuelle

        # Garanties non touchées par la saisie manuelle
        non_touches = [
            g for g in garanties_actuelles
            if g.IdGarantie.CodeSousGarantie not in repartition
        ]

        # Redistribution proportionnelle du reliquat sur les garanties non touchées.
        # Si la prime est imposée, les anciennes PrimeNette des garanties ne sont plus
        # une référence fiable → on utilise les taux de répartition de l'usage si disponibles,
        # sinon redistribution équipondérée.
        sum_poids_non_touches = sum(g.PrimeNette for g in non_touches)

        # Taux de taxe : _get_taux_taxe attend le code MRH (INCENDIE, DOMMAGES_ELECTRIQUES à 25 %),
        # les garanties du devis portent le code standard (1301, 90001…)
        with connection.cursor() as cursor:
            cursor.execute("SELECT idsousgarantie, code FROM stdmrh_sous_garantie")
            codes_mrh = dict(cursor.fetchall())

        # Appliquer les nouveaux montants
        for garantie in garanties_actuelles:
            code = garantie.IdGarantie.CodeSousGarantie

            if code in repartition:
                nouvelle_prime = service._arrondir(repartition[code])
            elif sum_poids_non_touches > 0:
                poids = garantie.PrimeNette / sum_poids_non_touches
                nouvelle_prime = service._arrondir(reliquat * poids)
            elif non_touches:
                # Redistribution équipondérée (cas prime imposée avec garanties à 0)
                nouvelle_prime = service._arrondir(reliquat / Decimal(len(non_touches)))
            else:
                nouvelle_prime = Decimal("0")

            taux_taxe = service._get_taux_taxe(codes_mrh.get(garantie.IdGarantie_id, code))
            nouvelle_taxe = service._arrondir(nouvelle_prime * taux_taxe)

            update_kwargs = {
                "PrimeNette": nouvelle_prime,
                "taxe": nouvelle_taxe,
                "primeannuelle": nouvelle_prime + nouvelle_taxe,
            }
            if code in capitaux:
                update_kwargs["Capital"] = capitaux[code]
            if code in franchises:
                update_kwargs["Franchise"] = franchises[code]
            if code in minfranchises:
                update_kwargs["minfranchise"] = minfranchises[code]
            if code in maxfranchises:
                update_kwargs["maxfranchise"] = maxfranchises[code]
            if code in tauxfranchises:
                update_kwargs["tauxfranchise"] = tauxfranchises[code]

            DevisDetGarantie.objects.filter(pk=garantie.pk).update(**update_kwargs)

        # Recalculer les totaux de la maison
        garanties_maj = DevisDetGarantie.objects.filter(IdDevisDet_id=id_maison)
        prime_nette_maison = sum(g.PrimeNette for g in garanties_maj)
        taxe_maison = sum(g.taxe for g in garanties_maj)
        DevisDetail.objects.filter(iddevisdetail=id_maison).update(
            primenette=prime_nette_maison,
            taxeenregistrement=taxe_maison,
            primeannuelle=prime_nette_maison,
        )

        # Recalculer les totaux du devis
        maisons = DevisDetail.objects.filter(iddevis_id=devis_id)
        prime_nette_totale = sum(m.primenette for m in maisons)
        taxe_maisons = sum(m.taxeenregistrement for m in maisons)

        if devis.prime_imposee:
            # Prime imposée : la répartition ne touche ni la taxe ni l'accessoire imposés
            accessoire = devis.accessoire or Decimal("0")
            taxe_totale = devis.taxe or Decimal("0")
        else:
            accessoire_result = service.calculer_accessoire(
                prime_nette_totale=prime_nette_totale,
                id_produit=devis.produit_id,
                id_compagnie=devis.compagnie_id,
            )
            accessoire = accessoire_result["accessoire"]
            taxe_accessoire = accessoire_result["taxe_accessoire"]
            taxe_totale = taxe_maisons + taxe_accessoire
        primettc = prime_nette_totale + taxe_totale + accessoire

        Devis.objects.filter(iddevis=devis_id).update(
            primenette=prime_nette_totale,
            taxe=taxe_totale,
            accessoire=accessoire,
            primettc=primettc,
        )

        resume = obtenir_resume_financier_devis(devis_id)
        serializer = ResumeFinancierDevisSerializer(resume)
        return Response({"success": True, "resume_financier": serializer.data}, status=status.HTTP_200_OK)


class ChequeFilter(filters.FilterSet):
    # Filtre pour les chèques non épuisés (solde > 0)
    non_epuise = filters.BooleanFilter(method="filter_non_epuise")
    # Filtre par plage de dates
    date_min = filters.DateFilter(field_name="date_saisie", lookup_expr="gte")
    date_max = filters.DateFilter(field_name="date_saisie", lookup_expr="lte")

    class Meta:
        model = Cheque
        fields = [
            "banque",
            "numero_cheque",
            "non_epuise",
            "date_min",
            "date_max",
        ]

    def filter_non_epuise(self, queryset, name, value):
        if value:  # true → non épuisés
            return queryset.filter(solde_disponible__gt=0)
        else:  # false → épuisés
            return queryset.filter(solde_disponible=0)


class CheckChequeStatusView(APIView):
    def get(self, request):
        numero = request.query_params.get("numero_cheque")
        banque_id = request.query_params.get("banque")

        cheque = Cheque.objects.filter(
            numero_cheque=numero, banque_id=banque_id
        ).first()

        if cheque:
            return Response(
                {
                    "existe": True,
                    "montant_initial": cheque.montant_initial,
                    "solde_disponible": cheque.solde_disponible,
                }
            )
        return Response({"existe": False})


class ChequeListView(generics.ListAPIView):
    # Portefeuille des chèques : quittances réglées par chaque chèque et leurs clients,
    # via stdchequeoperation → stddetailencaissement → stdquittance (le tireur n'est pas
    # renseigné en base : nomtireurcheque vaut « 0 »)
    queryset = (
        Cheque.objects.select_related("banque", "client")
        .annotate(
            montant_reencaisse=RawSQL(
                """SELECT SUM(e.montantencaissement) FROM stdencaissement e
                   WHERE e.idchequeimpaye = stdcheque.idcheque
                     AND NOT e.piece_annulee AND e.montantencaissement > 0""",
                [],
            ),
            nombre_operations=RawSQL(
                "SELECT COUNT(*) FROM stdchequeoperation op WHERE op.idcheque = stdcheque.idcheque",
                [],
            ),
            quittances_reglees=RawSQL(
                """SELECT string_agg(DISTINCT de.numeroquittance, ', ')
                   FROM stdchequeoperation op
                   JOIN stddetailencaissement de ON de.idencaissement = op.idencaissement
                   WHERE op.idcheque = stdcheque.idcheque""",
                [],
            ),
            clients=RawSQL(
                """SELECT string_agg(DISTINCT TRIM(cl.nom || ' ' || COALESCE(cl.prenoms, '')), ', ')
                   FROM stdchequeoperation op
                   JOIN stddetailencaissement de ON de.idencaissement = op.idencaissement
                   JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
                   JOIN stdclient cl ON cl.idclient = q.idclient
                   WHERE op.idcheque = stdcheque.idcheque""",
                [],
            ),
        )
        .order_by("-date_saisie")
    )
    serializer_class = ChequeListeSerializer
    filter_backends = (filters.DjangoFilterBackend,)
    filterset_class = ChequeFilter


class ChequeDetailOperationsView(APIView):
    def get(self, request, id_cheque):
        # On récupère le chèque
        cheque = get_object_or_404(Cheque, id_cheque=id_cheque)

        # On récupère toutes les opérations liées
        operations = cheque.operations.all().order_by("-date_saisie")

        # Sérialisation
        cheque_data = ChequeSerializer(cheque).data
        operations_data = ChequeOperationSerializer(operations, many=True).data

        return Response(
            {"chèque": cheque_data, "historique_operations": operations_data}
        )


def _message_erreur(exc):
    """Premier message d'une ValidationError DRF, sans la structure ErrorDetail."""
    detail = exc.detail
    while isinstance(detail, (list, dict)):
        if not detail:
            return "Requête invalide."
        detail = next(iter(detail.values())) if isinstance(detail, dict) else detail[0]
    return str(detail)


class ChequeAlertesView(ChequeListView):
    """
    Chèques de l'échéancier à déposer d'ici un mois (ou déjà échus) : alertes du
    portefeuille et de la cloche de notifications. GET /api/cheques/alertes/
    """

    pagination_class = None
    filter_backends = ()

    def get_queryset(self):
        limite = timezone.localdate() + relativedelta(months=1)
        return (
            super()
            .get_queryset()
            .filter(statut=Cheque.Statut.A_DEPOSER, date_echeance__lte=limite)
            .order_by("date_echeance")
        )


class ChequeEcheancierView(APIView):
    """Chèques remis d'avance par un client avec leurs dates de dépôt. POST /api/cheques/echeancier/"""

    authentication_classes = [KnoxOrDemoTokenAuthentication, BasicAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = EcheancierChequesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        donnees = serializer.validated_data
        try:
            crees = enregistrer_echeancier_cheques(
                donnees["id_client"],
                donnees["id_banque"],
                donnees["cheques"],
                donnees.get("observation", ""),
            )
        except DRFValidationError as e:
            return Response({"erreur": _message_erreur(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "message": f"{len(crees)} chèque(s) ajouté(s) à l'échéancier.",
                "ids": [c.id_cheque for c in crees],
            },
            status=status.HTTP_201_CREATED,
        )


class ChequeDecaissementView(APIView):
    """Chèque revenu impayé : annule ses encaissements. POST /api/cheques/<id>/decaissement/"""

    authentication_classes = [KnoxOrDemoTokenAuthentication, BasicAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id_cheque):
        serializer = DecaissementChequeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        donnees = serializer.validated_data
        try:
            resultat = decaisser_cheque_impaye(
                request.user,
                id_cheque,
                donnees["motif"],
                donnees.get("date_decaissement") or timezone.localdate(),
            )
        except DRFValidationError as e:
            return Response({"erreur": _message_erreur(e)}, status=status.HTTP_400_BAD_REQUEST)
        except ServiceError as e:
            return Response({"erreur": str(e.detail)}, status=status.HTTP_400_BAD_REQUEST)
        except DatabaseError as e:
            return Response(
                {"erreur": str(e).strip().splitlines()[0]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(resultat)


class ChequeQuittancesView(APIView):
    """
    Quittances réglées par un chèque et montants (encaissements d'origine, hors
    contre-passations) : base du réencaissement d'un chèque impayé.
    GET /api/cheques/<id>/quittances/
    """

    def get(self, request, id_cheque):
        get_object_or_404(Cheque, id_cheque=id_cheque)
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT de.numeroquittance, SUM(de.montant_encaissement),
                          MAX(TRIM(cl.nom || ' ' || COALESCE(cl.prenoms, '')))
                   FROM stdchequeoperation op
                   JOIN stdencaissement e ON e.idencaissement = op.idencaissement
                   JOIN stddetailencaissement de ON de.idencaissement = e.idencaissement
                   LEFT JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
                   LEFT JOIN stdclient cl ON cl.idclient = q.idclient
                   WHERE op.idcheque = %s AND e.montantencaissement > 0
                   GROUP BY de.numeroquittance
                   ORDER BY de.numeroquittance""",
                [id_cheque],
            )
            lignes = cursor.fetchall()
        return Response(
            [
                {"numero_quittance": num, "montant": montant, "client": client}
                for num, montant, client in lignes
            ]
        )


class ChequeSuppressionView(APIView):
    """Retire de l'échéancier un chèque à déposer jamais utilisé. DELETE /api/cheques/<id>/"""

    authentication_classes = [KnoxOrDemoTokenAuthentication, BasicAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, id_cheque):
        cheque = get_object_or_404(Cheque, id_cheque=id_cheque)
        if cheque.statut != Cheque.Statut.A_DEPOSER or cheque.operations.exists():
            return Response(
                {"erreur": "Seul un chèque à déposer, jamais encaissé, peut être retiré."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        cheque.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


"""
Vues API pour modification de maison et imposition de prime MRH
================================================================

Ces vues exposent les endpoints REST pour :
1. Imposer la prime d'une maison
2. Imposer la prime d'un devis
3. Lever une imposition
4. Consulter l'historique des impositions
"""


# ============================================================================
# VUE 1 : IMPOSER LA PRIME D'UNE MAISON
# ============================================================================


class ImposerPrimeMaisonView(APIView):
    """
    Imposer la prime NETTE d'une maison.

    POST /api/mrh/devis/{devis_id}/maisons/{maison_id}/imposer-prime/

    Fixe manuellement la prime nette d'une maison.
    La taxe sera recalculée automatiquement.

    Request body :
    {
        "montant_impose": 150000.00,  // Prime NETTE en FCFA
        "motif": "Négociation commerciale - remise de 10 000 FCFA"  // optionnel
    }

    Response 200 :
    {
        "success": true,
        "id_maison": 456,
        "imposition_id": 12,
        "montant_impose": 150000.00,
        "ancien_montant_nette": 160000.00,
        "ancien_montant_ttc": 189200.00,
        "nouvelle_taxe": 27375.00,
        "message": "Prime maison imposée à 150 000,00 FCFA (prime nette)",
        "totaux_devis": { ... }
    }
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, devis_id, maison_id):
        """Impose la prime d'une maison."""

        # Validation
        serializer = ImpositionPrimeMaisonRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                serializer.errors, status=status.HTTP_400_BAD_REQUEST
            )

        # Vérifier que la maison appartient au devis
        maison = get_object_or_404(DevisDetail, iddevisdetail=maison_id)
        if maison.iddevis_id != devis_id:
            return Response(
                {
                    "erreur": "MAISON_NOT_IN_DEVIS",
                    "message": f"La maison {maison_id} n'appartient pas au devis {devis_id}",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Appeler le service
        service = MRHCalculService()

        try:
            resultat = service.imposer_prime_maison(
                id_maison=maison_id,
                montant_impose=serializer.validated_data["montant_impose"],
                user_id=(
                    request.user.id if hasattr(request.user, "id") else None
                ),
                user_nom=(
                    request.user.get_full_name()
                    if hasattr(request.user, "get_full_name")
                    else str(request.user)
                ),
                motif=serializer.validated_data.get("motif"),
            )

            if not resultat.get("success", False):
                return Response(resultat, status=status.HTTP_400_BAD_REQUEST)

            return Response(resultat, status=status.HTTP_201_CREATED)

        except ValueError as e:
            return Response(
                {"erreur": "VALIDATION_ERROR", "message": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        except Exception as e:
            return Response(
                {
                    "erreur": "INTERNAL_ERROR",
                    "message": f"Erreur lors de l'imposition : {str(e)}",
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


# ============================================================================
# VUE 2 : IMPOSER LA PRIME D'UN DEVIS
# ============================================================================


class ImposerPrimeDevisView(APIView):
    """
    Imposer la prime NETTE globale d'un devis.

    POST /api/mrh/devis/{devis_id}/imposer-prime/

    Fixe manuellement la prime nette totale du devis.
    - La prime est répartie proportionnellement sur les maisons
    - La taxe et les accessoires sont recalculés
    - Bloque toute modification des maisons

    Request body :
    {
        "montant_impose": 400000.00,  // Prime NETTE totale en FCFA
        "montant_accessoire": 5000.00,  // Accessoire total en FCFA (optionnel, sinon calculé automatiquement)
        "motif": "Négociation commerciale - accord client"  // optionnel
    }

    Response 201 :
    {
        "success": true,
        "id_devis": 123,
        "imposition_id": 15,
        "montant_impose": 400000.00,
        "ancien_montant_nette": 450000.00,
        "ancien_montant_ttc": 532500.00,
        "nouveau_detail": {
            "primenette": 400000.00,
            "taxe": 73000.00,
            "accessoire": 5000.00,
            "primettc": 478000.00
        },
        "message": "Prime devis imposée à 400 000,00 FCFA (prime nette)",
        "note": "La taxe et les accessoires sont calculés sur cette prime imposée"
    }
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, devis_id):
        """Impose la prime globale d'un devis."""

        # Validation
        serializer = ImpositionPrimeDevisRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                serializer.errors, status=status.HTTP_400_BAD_REQUEST
            )

        # Vérifier que le devis existe
        devis = get_object_or_404(Devis, iddevis=devis_id)

        montant_impose = serializer.validated_data["montant_impose"]
        montant_accessoire = serializer.validated_data.get("montant_accessoire")
        montant_taxe = serializer.validated_data.get("montant_taxe")

        # Appeler le service
        service = MRHCalculService()

        try:
            resultat = service.imposer_prime_devis(
                id_devis=devis_id,
                montant_impose=montant_impose,
                repartition_maisons=serializer.validated_data.get("repartition_maisons", []),
                montant_accessoire=montant_accessoire,
                montant_taxe=montant_taxe,
                user_id=(
                    request.user.id if hasattr(request.user, "id") else None
                ),
                user_nom=(
                    request.user.get_full_name()
                    if hasattr(request.user, "get_full_name")
                    else str(request.user)
                ),
                motif=serializer.validated_data.get("motif"),
            )

            if not resultat.get("success", False):
                return Response(resultat, status=status.HTTP_400_BAD_REQUEST)

            return Response(resultat, status=status.HTTP_201_CREATED)

        except ValueError as e:
            return Response(
                {"erreur": "VALIDATION_ERROR", "message": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        except Exception as e:
            return Response(
                {
                    "erreur": "INTERNAL_ERROR",
                    "message": f"Erreur lors de l'imposition : {str(e)}",
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


# ============================================================================
# VUE 3 : LEVER UNE IMPOSITION
# ============================================================================


class LeverImpositionView(APIView):
    """
    Lever une imposition de prime (maison ou devis).

    DELETE /api/mrh/devis/{devis_id}/imposer-prime/  (devis)
    DELETE /api/mrh/devis/{devis_id}/maisons/{maison_id}/imposer-prime/  (maison)

    Désactive l'imposition et autorise à nouveau les modifications.

    Request body (optionnel) :
    {
        "motif": "Erreur de saisie corrigée"
    }

    Response 200 :
    {
        "success": true,
        "type_imposition": "DEVIS",
        "id_cible": 123,
        "message": "Imposition levée pour DEVIS 123"
    }
    """

    permission_classes = [IsAuthenticated]

    def delete(self, request, devis_id, maison_id=None):
        """Lève une imposition."""

        # Validation
        serializer = LeveeImpositionRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                serializer.errors, status=status.HTTP_400_BAD_REQUEST
            )

        # Déterminer le type et l'ID
        if maison_id:
            # Lever imposition maison
            type_imposition = "MAISON"
            id_cible = maison_id

            # Vérifier que la maison existe et appartient au devis
            maison = get_object_or_404(DevisDetail, iddevisdetail=maison_id)
            if maison.iddevis_id != devis_id:
                return Response(
                    {
                        "erreur": "MAISON_NOT_IN_DEVIS",
                        "message": f"La maison {maison_id} n'appartient pas au devis {devis_id}",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            # Lever imposition devis
            type_imposition = "DEVIS"
            id_cible = devis_id

            # Vérifier que le devis existe
            get_object_or_404(Devis, iddevis=devis_id)

        # Appeler le service
        service = MRHCalculService()

        try:
            resultat = service.lever_imposition(
                type_imposition=type_imposition,
                id_cible=id_cible,
                user_id=(
                    request.user.id if hasattr(request.user, "id") else None
                ),
                user_nom=(
                    request.user.get_full_name()
                    if hasattr(request.user, "get_full_name")
                    else str(request.user)
                ),
                motif_levee=serializer.validated_data.get("motif"),
            )

            return Response(resultat, status=status.HTTP_200_OK)

        except ValueError as e:
            return Response(
                {"erreur": "VALIDATION_ERROR", "message": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        except Exception as e:
            return Response(
                {
                    "erreur": "INTERNAL_ERROR",
                    "message": f"Erreur lors de la levée : {str(e)}",
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


# ============================================================================
# VUE 4 : HISTORIQUE DES IMPOSITIONS
# ============================================================================


class HistoriqueImpositionsView(APIView):
    """
    Consulter l'historique des impositions d'une entité.

    GET /api/mrh/devis/{devis_id}/impositions/  (historique devis)
    GET /api/mrh/devis/{devis_id}/maisons/{maison_id}/impositions/  (historique maison)

    Retourne toutes les impositions (actives et levées) avec détails.

    Response 200 :
    {
        "type_imposition": "DEVIS",
        "id_cible": 123,
        "impositions": [
            {
                "id": 15,
                "montant_impose": 400000.00,
                "ancien_montant_nette": 450000.00,
                "user_nom": "John DOE",
                "date_imposition": "2024-12-18T10:30:00Z",
                "motif": "Négociation commerciale",
                "actif": true,
                "duree_jours": 5
            },
            ...
        ],
        "total": 3,
        "actives": 1,
        "levees": 2
    }
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, devis_id, maison_id=None):
        """Récupère l'historique des impositions."""

        # Déterminer le type et l'ID
        if maison_id:
            type_imposition = "MAISON"
            id_cible = maison_id

            # Vérifier existence
            maison = get_object_or_404(DevisDetail, iddevisdetail=maison_id)
            if maison.iddevis_id != devis_id:
                return Response(
                    {
                        "erreur": "MAISON_NOT_IN_DEVIS",
                        "message": f"La maison {maison_id} n'appartient pas au devis {devis_id}",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            type_imposition = "DEVIS"
            id_cible = devis_id
            get_object_or_404(Devis, iddevis=devis_id)

        # Récupérer l'historique
        impositions = ImpositionPrime.objects.filter(
            type_imposition=type_imposition, id_cible=id_cible
        ).order_by("-date_imposition")

        # Formater les données
        data_impositions = []
        for imp in impositions:
            data_impositions.append(
                {
                    "id": imp.id,
                    "montant_impose": float(imp.montant_impose),
                    "ancien_montant_nette": (
                        float(imp.ancien_montant_nette)
                        if imp.ancien_montant_nette
                        else None
                    ),
                    "ancien_montant_ttc": (
                        float(imp.ancien_montant_ttc)
                        if imp.ancien_montant_ttc
                        else None
                    ),
                    "user_nom": imp.user_nom,
                    "date_imposition": imp.date_imposition.isoformat(),
                    "motif": imp.motif,
                    "actif": imp.actif,
                    "date_levee": (
                        imp.date_levee.isoformat() if imp.date_levee else None
                    ),
                    "levee_par_user_nom": imp.levee_par_user_nom,
                    "motif_levee": imp.motif_levee,
                    "duree_jours": imp.duree_jours,
                }
            )

        # Statistiques
        total = impositions.count()
        actives = impositions.filter(actif=True).count()
        levees = impositions.filter(actif=False).count()

        return Response(
            {
                "type_imposition": type_imposition,
                "id_cible": id_cible,
                "impositions": data_impositions,
                "statistiques": {
                    "total": total,
                    "actives": actives,
                    "levees": levees,
                },
            },
            status=status.HTTP_200_OK,
        )


# ============================================================================
# VUE 6 : STATUT D'IMPOSITION
# ============================================================================


class StatutImpositionView(APIView):
    """
    Vérifier le statut d'imposition d'une entité.

    GET /api/mrh/devis/{devis_id}/statut-imposition/  (statut devis)
    GET /api/mrh/devis/{devis_id}/maisons/{maison_id}/statut-imposition/  (statut maison)

    Retourne si l'entité a une prime imposée et les détails.

    Response 200 :
    {
        "imposee": true,
        "type_imposition": "DEVIS",
        "id_cible": 123,
        "montant_impose": 400000.00,
        "user_nom": "John DOE",
        "date_imposition": "2024-12-18T10:30:00Z",
        "motif": "Négociation commerciale",
        "duree_jours": 5,
        "peut_modifier": false,
        "message": "Prime imposée à 400 000,00 FCFA le 18/12/2024 par John DOE"
    }
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, devis_id, maison_id=None):
        """Vérifie le statut d'imposition."""

        # Déterminer le type et l'ID
        if maison_id:
            type_imposition = "MAISON"
            id_cible = maison_id

            # Récupérer la maison
            maison = get_object_or_404(DevisDetail, iddevisdetail=maison_id)
            if maison.iddevis_id != devis_id:
                return Response(
                    {"erreur": "MAISON_NOT_IN_DEVIS"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            imposee = maison.prime_imposee
            montant = maison.primenette if imposee else None
        else:
            type_imposition = "DEVIS"
            id_cible = devis_id

            # Récupérer le devis
            devis = get_object_or_404(Devis, iddevis=devis_id)
            imposee = devis.prime_imposee
            montant = devis.primenette if imposee else None

        # Si imposée, récupérer les détails
        if imposee:
            imposition = ImpositionPrime.objects.filter(
                type_imposition=type_imposition, id_cible=id_cible, actif=True
            ).first()

            if imposition:
                return Response(
                    {
                        "imposee": True,
                        "type_imposition": type_imposition,
                        "id_cible": id_cible,
                        "montant_impose": float(montant),
                        "user_nom": imposition.user_nom,
                        "date_imposition": imposition.date_imposition.isoformat(),
                        "motif": imposition.motif,
                        "duree_jours": imposition.duree_jours,
                        "peut_modifier": False,
                        "message": (
                            f"Prime imposée à {montant:,.2f} FCFA "
                            f"le {imposition.date_imposition.strftime('%d/%m/%Y')} "
                            f"par {imposition.user_nom}"
                        ),
                    }
                )

        # Pas d'imposition
        return Response(
            {
                "imposee": False,
                "type_imposition": type_imposition,
                "id_cible": id_cible,
                "peut_modifier": True,
                "message": "Aucune imposition active",
            }
        )


"""
Vue pour consulter les détails complets d'une maison MRH
=========================================================
"""


class DetailMaisonView(APIView):
    """
    Consulter les détails complets d'une maison MRH.

    GET /api/mrh/devis/{devis_id}/maisons/{maison_id}/details/

    Retourne toutes les informations sur une maison :
    - Paramètres de calcul (usage, valeurs, loyer, etc.)
    - Liste complète des garanties avec leurs montants
    - Options appliquées
    - Totaux financiers détaillés
    - Statut d'imposition
    - Métadonnées

    Response 200 :
    {
        "id_maison": 456,
        "id_devis": 123,
        "numero_devis": "DEV-MRH-2024-00123",
        "adresse": "Cocody - Riviera Golf",
        "parametres": {
            "code_usage": "proprietaire_occupant_total",
            "libelle_usage": "Propriétaire occupant - Total",
            "valeur_batiment": 50000000.00,
            "valeur_contenu": 10000000.00,
            "loyer_mensuel": null,
            "capital_rvt": null
        },
        "options": [
            {
                "code_option": "presence_gardien",
                "libelle": "Présence d'un gardien",
                "signe": "-",
                "pourcentage": 10.00,
                "impact_financier": -15368.00
            }
        ],
        "sous_garanties": [
            {
                "id_garantie": 101,
                "code_garantie": "INC001",
                "libelle": "Incendie",
                "type": "OBLIGATOIRE",
                "acquise": true,
                "prime_nette": 38000.00,
                "prime_annuelle": 40000.00,
                "taux_taxe": 0.250,
                "taxe": 9500.00,
                "prime_ttc": 47500.00
            },
            ...
        ],
        "nombre_garanties_obligatoires": 7,
        "nombre_garanties_optionnelles": 2,
        "nombre_garanties_total": 9,
        "totaux": {
            "prime_nette_totale": 153680.00,
            "prime_annuelle_totale": 165000.00,
            "taxe_totale": 27869.60,
            "prime_ttc_totale": 181549.60,
            "economie_options": 11320.00
        },
        "imposition": {
            "imposee": false,
            "montant_impose": null,
            "date_imposition": null,
            "user_nom": null,
            "motif": null,
            "duree_jours": null
        },
        "date_creation": "2024-12-18T10:30:00Z",
        "date_modification": "2024-12-18T11:45:00Z",
        "peut_etre_modifiee": true
    }
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, devis_id, maison_id):
        """Récupère les détails complets d'une maison."""

        try:
            # Récupérer la maison
            maison = get_object_or_404(
                DevisDetail.objects.select_related("iddevis"),
                iddevisdetail=maison_id,
            )

            # Vérifier que la maison appartient au devis
            if maison.iddevis_id != devis_id:
                return Response(
                    {
                        "error": "MAISON_NOT_IN_DEVIS",
                        "message": f"La maison {maison_id} n'appartient pas au devis {devis_id}",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Construire les données complètes
            details = self._construire_details(maison)

            # Sérialiser
            serializer = DetailMaisonSerializer(details)

            return Response(serializer.data, status=status.HTTP_200_OK)

        except Exception as e:
            return Response(
                {
                    "error": "INTERNAL_ERROR",
                    "message": f"Erreur lors de la récupération des détails : {str(e)}",
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def _construire_details(self, maison):
        """Construit le dictionnaire complet des détails de la maison."""

        # 1. Récupérer les garanties
        sous_garanties = self._get_garanties(maison)

        # 2. Extraire les paramètres depuis les nouvelles colonnes
        parametres = self._extraire_parametres(maison)

        # 3. Extraire les options depuis JSON
        options = self._extraire_options(maison)

        # 4. Calculer les totaux
        totaux = self._calculer_totaux(maison, sous_garanties)

        # 5. Récupérer les infos d'imposition
        imposition = self._get_imposition_info(maison)

        # 6. Statistiques garanties
        sous_garanties_obligatoires = [
            g for g in sous_garanties if g["type"] == "OBLIGATOIRE"
        ]
        sous_garanties_optionnelles = [
            g for g in sous_garanties if g["type"] == "OPTIONNELLE"
        ]

        return {
            # Identifiants
            "id_maison": maison.iddevisdetail,
            "id_devis": maison.iddevis_id,
            "numero_devis": (
                maison.iddevis.numerodevis if maison.iddevis else None
            ),
            "matricule": maison.matricule or None,
            # Informations générales
            "adresse": maison.adressecnd or "",
            "description": maison.observation,
            # Paramètres
            "parametres": parametres,
            # Options
            "options": options,
            # Garanties
            "sous_garanties": sous_garanties,
            "nombre_sous_garanties_obligatoires": len(
                sous_garanties_obligatoires
            ),
            "nombre_sous_garanties_optionnelles": len(
                sous_garanties_optionnelles
            ),
            "nombre_sous_garanties_total": len(sous_garanties),
            # Totaux
            "totaux": totaux,
            # Imposition
            "imposition": imposition,
            # Dates (non disponibles pour l'instant)
            "date_creation": None,
            "date_modification": None,
            # Métadonnées
            "peut_etre_modifiee": not maison.prime_imposee,
        }

    def _get_garanties(self, maison):
        """Récupère toutes les garanties de la maison avec leurs détails."""

        from django.db import connection

        sous_garanties = []

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT 
                    dg.idgarantie,
                    g.code,
                    g.libelle,
					g.type,
                    dg.acquise,
                    dg.primenette,
                    dg.primeannuelle,
                    dg.taxe,
                    CASE 
                        WHEN dg.taxe > 0 AND dg.primenette > 0 
                        THEN dg.taxe / dg.primenette
                        ELSE 0.145
                    END as taux_taxe
                FROM stddevisdetgarantie dg
                JOIN stdmrh_sous_garantie g ON dg.idgarantie = g.idsousgarantie
                WHERE dg.iddevisdet = %s
                ORDER BY g.libelle
            """,
                [maison.iddevisdetail],
            )

            for row in cursor.fetchall():
                (
                    id_garantie,
                    code,
                    libelle,
                    type_garantie,
                    acquise,
                    prime_nette,
                    prime_annuelle,
                    taxe,
                    taux_taxe,
                ) = row

                prime_nette = (
                    Decimal(str(prime_nette)) if prime_nette else Decimal("0")
                )
                prime_annuelle = (
                    Decimal(str(prime_annuelle))
                    if prime_annuelle
                    else Decimal("0")
                )
                taxe = Decimal(str(taxe)) if taxe else Decimal("0")
                taux_taxe = (
                    Decimal(str(taux_taxe)) if taux_taxe else Decimal("0.145")
                )

                # Déterminer le type (obligatoire ou optionnelle)
                # On considère qu'une garantie avec prime_annuelle = prime_nette est obligatoire
                # et qu'une garantie forfaitaire (sans répartition) est optionnelle
                # type_garantie = tyself._determiner_type_garantie(code, prime_annuelle, prime_nette)

                sous_garanties.append(
                    {
                        "id_sous_garantie": id_garantie,
                        "code_sous_garantie": code,
                        "libelle": libelle,
                        "type": type_garantie,
                        "acquise": bool(acquise),
                        "prime_nette": float(prime_nette),
                        "prime_annuelle": float(prime_annuelle),
                        "taux_taxe": float(taux_taxe),
                        "taxe": float(taxe),
                        "prime_ttc": float(prime_nette + taxe),
                    }
                )

        return sous_garanties

    def _determiner_type_garantie(
        self, code_garantie, prime_annuelle, prime_nette
    ):
        """Détermine si une garantie est obligatoire ou optionnelle."""

        # Les garanties optionnelles à forfait sont facilement identifiables
        codes_optionnels = ["RC_MEMBRE", "BRIS_GLACE", "VOL_AGGRAVE"]

        if any(opt in code_garantie.upper() for opt in codes_optionnels):
            return "OPTIONNELLE"

        return "OBLIGATOIRE"

    def _extraire_parametres(self, maison):
        """Extrait les paramètres de calcul depuis la maison."""

        code_usage = maison.modelevehicule or "proprietaire_occupant_total"

        loyer_mensuel = (
            Decimal(maison.chargeutile)
            if maison.chargeutile and maison.chargeutile > 0
            else None
        )
        capital_rvt = (
            Decimal(maison.valeuraccessoire)
            if maison.valeuraccessoire and maison.valeuraccessoire > 0
            else None
        )

        return {
            "code_usage": code_usage,
            "libelle_usage": self._get_libelle_usage(code_usage),
            "valeur_batiment": Decimal(maison.valeurneuve or 0),
            "valeur_contenu": Decimal(maison.valeurvenale or 0),
            "loyer_mensuel": loyer_mensuel,
            "capital_rvt": capital_rvt,
        }

    def _extraire_code_usage(self, observation):
        """Extrait le code usage depuis l'observation."""

        # Liste des codes usage possibles
        from configuration_api.models import UsageHabitation

        codes_usage = list(
            UsageHabitation.objects.values_list("code", flat=True)
        )

        observation_lower = observation.lower()

        for code in codes_usage:
            if code in observation_lower:
                return code

        # Par défaut
        return "proprietaire_occupant_total"

    def _get_libelle_usage(self, code_usage):
        """Retourne le libellé de l'usage."""

        libelles = {
            "proprietaire_occupant_total": "Propriétaire occupant - Total",
            "proprietaire_occupant_rez": "Propriétaire occupant - Rez-de-chaussée",
            "proprietaire_bailleur": "Propriétaire bailleur",
            "proprietaire_non_occupant": "Propriétaire non occupant",
            "locataire": "Locataire",
            "locataire_saisonnier": "Locataire saisonnier",
            "locaux_commerciaux": "Locaux commerciaux",
            "batiment_usage_mixte": "Bâtiment à usage mixte",
        }

        return libelles.get(code_usage, code_usage)

    def _extraire_options(self, maison):
        """Extrait les options appliquées depuis le JSON."""

        if not maison.conducteur or maison.conducteur.strip() in [
            "",
            "[]",
            "null",
        ]:
            return []

        try:
            codes_options = json.loads(maison.conducteur)
        except (json.JSONDecodeError, TypeError, ValueError):
            # Si le JSON est invalide, retourner liste vide
            return []

        if not codes_options or not isinstance(codes_options, list):
            return []

        # Récupérer les détails des options depuis stdmrhoption
        from django.db import connection

        options = []

        if codes_options:
            codes = [opt["code_option"] for opt in codes_options]
            placeholders = ",".join(["%s"] * len(codes_options))

            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    SELECT code AS code_option, libelle, signe_ajustement AS signe, taux_ajustement AS pourcentage
                    FROM stdmrh_option
                    WHERE code IN ({placeholders})
                    ORDER BY libelle
                """,
                    codes,
                )

                for row in cursor.fetchall():
                    code, libelle, signe, pourcentage = row

                    # Calculer l'impact financier estimé si possible
                    impact = None
                    if pourcentage and maison.primeannuelle:
                        base = float(maison.primeannuelle)
                        pct = float(pourcentage) / 100
                        if signe == "-":
                            impact = -1 * base * pct
                        else:
                            impact = base * pct

                    options.append(
                        {
                            "code_option": code,
                            "libelle": libelle,
                            "signe": signe,
                            "pourcentage": (
                                float(pourcentage) if pourcentage else None
                            ),
                            "impact_financier": impact,
                        }
                    )

        return options

    def _extraire_adresse(self, observation):
        """Extrait l'adresse depuis l'observation."""

        if not observation:
            return ""

        # L'adresse est généralement au début de l'observation
        # Format possible : "Adresse - usage - autres infos"
        parts = observation.split(" - ")
        if parts:
            return parts[0].strip()

        return observation[:100]  # Premiers 100 caractères

    def _calculer_totaux(self, maison, garanties):
        """Calcule les totaux financiers."""

        prime_nette_totale = sum(g["prime_nette"] for g in garanties)
        prime_annuelle_totale = sum(g["prime_annuelle"] for g in garanties)
        taxe_totale = sum(g["taxe"] for g in garanties)

        return {
            "prime_nette_totale": prime_nette_totale,
            "prime_annuelle_totale": prime_annuelle_totale,
            "taxe_totale": taxe_totale,
            "prime_ttc_totale": prime_nette_totale + taxe_totale,
            "economie_options": prime_annuelle_totale - prime_nette_totale,
        }

    def _get_imposition_info(self, maison):
        """Récupère les informations d'imposition."""

        if not maison.prime_imposee:
            return {
                "imposee": False,
                "montant_impose": None,
                "date_imposition": None,
                "user_nom": None,
                "motif": None,
                "duree_jours": None,
            }

        # Récupérer l'imposition active
        imposition = ImpositionPrime.objects.filter(
            type_imposition="MAISON", id_cible=maison.iddevisdetail, actif=True
        ).first()

        if imposition:
            return {
                "imposee": True,
                "montant_impose": float(maison.primenette),
                "date_imposition": imposition.date_imposition,
                "user_nom": imposition.user_nom,
                "motif": imposition.motif,
                "duree_jours": imposition.duree_jours,
            }

        return {
            "imposee": True,
            "montant_impose": float(maison.primenette),
            "date_imposition": maison.prime_imposee_date,
            "user_nom": None,
            "motif": None,
            "duree_jours": None,
        }


# ─────────────────────────────────────────────────────────────────────────────
# EXPORT EXCEL REVERSEMENTS
# ─────────────────────────────────────────────────────────────────────────────
import io
from openpyxl import Workbook
from openpyxl.styles import (
    Font, Alignment, PatternFill, Border, Side, numbers
)
from openpyxl.utils import get_column_letter
from django.http import HttpResponse


def _thin_border():
    thin = Side(style="thin")
    return Border(left=thin, right=thin, top=thin, bottom=thin)


def _apply_header_cell(ws, row, col, value, size=14):
    cell = ws.cell(row=row, column=col, value=value)
    cell.font = Font(bold=True, size=size)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = _thin_border()
    return cell


def _apply_data_cell(ws, row, col, value, bold=False, size=14, number_format=None):
    cell = ws.cell(row=row, column=col, value=value)
    cell.font = Font(bold=bold, size=size)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = _thin_border()
    if number_format:
        cell.number_format = number_format
    return cell


class ExportTableauReversementView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from production.database import get_info_reversement

        compagnie_id = request.query_params.get("compagnie_id")
        date_debut = request.query_params.get("date_debut")
        date_fin = request.query_params.get("date_fin")
        statut = request.query_params.get("statut", "")

        # Récupère les reversements selon les filtres
        qs = ReversementCompagnie.objects.select_related(
            "compagnie", "mode_reversement", "banque"
        ).filter(piece_annulee=False)

        if compagnie_id:
            qs = qs.filter(compagnie__IdCompagnie=compagnie_id)
        if date_debut:
            qs = qs.filter(date_reversement__gte=date_debut)
        if date_fin:
            qs = qs.filter(date_reversement__lte=date_fin)
        if statut == "valide":
            qs = qs.filter(valide=True)
        elif statut == "en_attente":
            qs = qs.filter(valide=False)

        qs = qs.order_by("-date_reversement")

        compagnie_name = "TOUTES COMPAGNIES"
        if compagnie_id:
            first = qs.first()
            if first:
                compagnie_name = first.compagnie.RaisonSociale

        # ── Création du classeur ──────────────────────────────────────────────
        wb = Workbook()
        ws = wb.active
        ws.title = "COMMI-MOIS"

        # Largeurs colonnes (identiques au fichier de référence)
        col_widths = {
            1: 35.5, 2: 33.0, 3: 18.7, 4: 19.7, 5: 18.4,
            6: 23.3, 7: 25.5, 8: 18.4, 9: 19.5, 10: 18.4,
            11: 18.4, 12: 20.1, 13: 21.3, 14: 31.1, 15: 15.1,
            16: 17.1, 17: 19.4, 18: 21.1, 19: 20.1, 20: 31.5,
            21: 23.4,
        }
        for col_idx, width in col_widths.items():
            ws.column_dimensions[get_column_letter(col_idx)].width = width

        ws.row_dimensions[4].height = 30
        ws.row_dimensions[10].height = 40

        # ── Titre (ligne 4, colonnes G–P fusionnées) ──────────────────────────
        ws.merge_cells("G4:P4")
        title_cell = ws["G4"]
        title_cell.value = f"TABLEAU DE REVERSEMENT {compagnie_name}"
        title_cell.font = Font(bold=True, size=16)
        title_cell.alignment = Alignment(horizontal="center", vertical="center")

        # ── Période (ligne 9) ─────────────────────────────────────────────────
        periode = ""
        if date_debut and date_fin:
            periode = f"{date_debut} au {date_fin}"
        elif date_debut:
            periode = f"À partir du {date_debut}"
        elif date_fin:
            periode = f"Jusqu'au {date_fin}"
        else:
            periode = str(date.today().year)

        ws["A9"] = periode
        ws["A9"].font = Font(bold=True, size=14)
        ws["A9"].alignment = Alignment(horizontal="center", vertical="center")

        # ── En-têtes colonnes (ligne 10) ──────────────────────────────────────
        headers = [
            "NOM DU CLIENT", "STRUCTURE / SOUSCRIPTEUR", "DATE DU COURRIER",
            "DATE DE DECHARGE DE LA CIE", "N° DU BORDEREAU", "ASSURANCE",
            "N° POLICE", "EFFET", "EXPIRATION", "PRIME HT", "PRIME TTC",
            "ENCAISSEMENT", "MONTANT REVERSE", "NATURE DU REVERSEMENT",
            "ACC. COURTIER", "TAUX COM %", "COMMISSION A PERCEVOIR",
            "COMMISSION PERCUE", "SOLDE", "CHEQUE DE COMMISSION",
            "OBSERVATION",
        ]
        for col_idx, header in enumerate(headers, start=1):
            _apply_header_cell(ws, 10, col_idx, header, size=14)

        # ── Lignes de données ─────────────────────────────────────────────────
        NUM_FMT = '#,##0'
        PCT_FMT = '0.00%'
        row_num = 11

        totals = {k: 0 for k in range(10, 20)}  # colonnes J(10)–S(19)

        for rev in qs:
            (msg, items) = get_info_reversement(reversement=rev.pk)
            if msg or not items:
                continue

            mode = rev.mode_reversement.libellemodepaiement if rev.mode_reversement else ""
            cheque = ""
            if rev.numero_cheque:
                banque = rev.banque.libelle if rev.banque else ""
                cheque = f"CHQ {banque} N°{rev.numero_cheque}"

            for idx, item in enumerate(items):
                commission = float(item.Commission or 0)
                comm_percue = float(item.CommissionDeduite or 0)
                solde = commission - comm_percue

                _apply_data_cell(ws, row_num, 1, item.NomClient)
                _apply_data_cell(ws, row_num, 2, rev.compagnie.RaisonSociale if idx == 0 else "")
                _apply_data_cell(ws, row_num, 3, rev.date_reversement if idx == 0 else "")
                _apply_data_cell(ws, row_num, 4, rev.date_validation if idx == 0 else "")
                _apply_data_cell(ws, row_num, 5, rev.numero_reversement if idx == 0 else "")
                _apply_data_cell(ws, row_num, 6, item.LibelleProduit)
                _apply_data_cell(ws, row_num, 7, item.NumeroPolice)
                _apply_data_cell(ws, row_num, 8, item.DateEffet)
                _apply_data_cell(ws, row_num, 9, item.DateExpiration)
                _apply_data_cell(ws, row_num, 10, float(item.PrimeHT or 0), bold=True, number_format=NUM_FMT)
                _apply_data_cell(ws, row_num, 11, float(item.PrimeTTC or 0), bold=True, number_format=NUM_FMT)
                _apply_data_cell(ws, row_num, 12, float(item.MontantEncaissement or 0), bold=True, number_format=NUM_FMT)
                _apply_data_cell(ws, row_num, 13, float(item.MontantReversement or 0), bold=True, number_format=NUM_FMT)
                _apply_data_cell(ws, row_num, 14, mode if idx == 0 else "")
                _apply_data_cell(ws, row_num, 15, float(item.AccessoireIntermediaire or 0), bold=True, number_format=NUM_FMT)
                _apply_data_cell(ws, row_num, 16, float(item.TauxCommission or 0) / 100, number_format=PCT_FMT)
                _apply_data_cell(ws, row_num, 17, commission, bold=True, number_format=NUM_FMT)
                _apply_data_cell(ws, row_num, 18, comm_percue, bold=True, number_format=NUM_FMT)
                _apply_data_cell(ws, row_num, 19, solde, bold=True, number_format=NUM_FMT)
                _apply_data_cell(ws, row_num, 20, cheque if idx == 0 else "")
                _apply_data_cell(ws, row_num, 21, "")

                # Cumul totaux
                totals[10] += float(item.PrimeHT or 0)
                totals[11] += float(item.PrimeTTC or 0)
                totals[12] += float(item.MontantEncaissement or 0)
                totals[13] += float(item.MontantReversement or 0)
                totals[15] += float(item.AccessoireIntermediaire or 0)
                totals[17] += commission
                totals[18] += comm_percue
                totals[19] += solde

                row_num += 1

        # ── Ligne TOTAL ───────────────────────────────────────────────────────
        if row_num > 11:
            ws.merge_cells(f"A{row_num}:I{row_num}")
            total_label = ws[f"A{row_num}"]
            total_label.value = "TOTAL"
            total_label.font = Font(bold=True, size=14)
            total_label.alignment = Alignment(horizontal="center", vertical="center")
            total_label.border = _thin_border()

            for col_idx in range(10, 20):
                val = totals.get(col_idx, "")
                fmt = NUM_FMT if col_idx != 16 else PCT_FMT
                _apply_data_cell(ws, row_num, col_idx, val if val != 0 else "", bold=True, number_format=NUM_FMT)
            _apply_data_cell(ws, row_num, 20, "")
            _apply_data_cell(ws, row_num, 21, "")

        # ── Retour du fichier ─────────────────────────────────────────────────
        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        filename = f"Tableau_Reversement_{compagnie_name}_{date.today().strftime('%Y%m%d')}.xlsx"
        response = HttpResponse(
            buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class ExportBordereauReversementView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, idreversement):
        from production.database import get_info_reversement

        try:
            rev = ReversementCompagnie.objects.select_related(
                "compagnie", "mode_reversement", "banque"
            ).get(pk=idreversement)
        except ReversementCompagnie.DoesNotExist:
            return Response({"error": "Reversement introuvable"}, status=404)

        (msg, items) = get_info_reversement(reversement=idreversement)
        if msg:
            return Response({"error": msg}, status=400)

        compagnie_name = rev.compagnie.RaisonSociale

        # ── Création du classeur ──────────────────────────────────────────────
        wb = Workbook()
        ws = wb.active
        ws.title = compagnie_name[:31]

        # Largeurs colonnes (référence BORDEREAU CI-ENERGIEES)
        col_widths = {
            1: 36.2, 2: 32.3, 3: 42.3, 4: 15.7, 5: 24.5, 6: 24.5,
            7: 22.5, 8: 27.5, 9: 27.8, 10: 22.3, 11: 19.3,
            12: 24.2, 13: 22.3, 14: 22.3, 15: 22.3, 16: 23.0,
        }
        for col_idx, width in col_widths.items():
            ws.column_dimensions[get_column_letter(col_idx)].width = width

        FONT_SIZE = 14  # taille adaptée pour A4 paysage

        # ── Titre (ligne 2, D2:K2 fusionnées) ────────────────────────────────
        ws.merge_cells("D2:K2")
        t = ws["D2"]
        t.value = "BORDEREAU DE RECLAMATION DE COMMISSION"
        t.font = Font(bold=True, size=FONT_SIZE + 4)
        t.alignment = Alignment(horizontal="center", vertical="center")
        ws.row_dimensions[2].height = 30

        # ── Compagnie (ligne 5, F5:I5 fusionnées) ────────────────────────────
        ws.merge_cells("F5:I5")
        c = ws["F5"]
        c.value = compagnie_name
        c.font = Font(bold=True, size=FONT_SIZE + 2)
        c.alignment = Alignment(horizontal="center", vertical="center")

        # ── Bordereau N° / date ───────────────────────────────────────────────
        ws["A6"] = "Bordereau N°"
        ws["A6"].font = Font(size=FONT_SIZE)
        ws["B6"] = rev.numero_reversement
        ws["B6"].font = Font(bold=True, size=FONT_SIZE)
        ws["B6"].alignment = Alignment(horizontal="center")

        ws.merge_cells("D7:E7")
        ws["D7"] = f"du  {rev.date_reversement.strftime('%d/%m/%Y') if rev.date_reversement else ''}"
        ws["D7"].font = Font(size=FONT_SIZE)
        ws["D7"].alignment = Alignment(horizontal="center")

        # ── Montant à reverser ────────────────────────────────────────────────
        ws["A8"] = "Montant à reverser"
        ws["A8"].font = Font(size=FONT_SIZE)
        ws["B8"] = float(rev.montant_reversement or 0)
        ws["B8"].font = Font(bold=True, size=FONT_SIZE)
        ws["B8"].number_format = '#,##0'
        ws["B8"].alignment = Alignment(horizontal="center")

        # ── En-têtes (ligne 11) ───────────────────────────────────────────────
        headers = [
            "Nom du client", "Assurance", "N°Police", "Avt",
            "Effet", "Expiration", "Prime HT", "Prime TTC",
            "Encaissement", "Acc. Courtier", "Taux com.(%)",
            "Commission", "Frais gestion", "Com. Déduite",
            "Acc. déduits", "Montant Reversé",
        ]
        ws.row_dimensions[11].height = 30
        for col_idx, header in enumerate(headers, start=1):
            _apply_header_cell(ws, 11, col_idx, header, size=FONT_SIZE)

        # ── Lignes de données ─────────────────────────────────────────────────
        NUM_FMT = '#,##0'
        row_num = 12
        totals = {k: 0.0 for k in range(7, 17)}

        for item in items:
            data = [
                item.NomClient,
                item.LibelleProduit,
                item.NumeroPolice,
                item.NumeroAvenant,
                item.DateEffet,
                item.DateExpiration,
                float(item.PrimeHT or 0),
                float(item.PrimeTTC or 0),
                float(item.MontantEncaissement or 0),
                float(item.AccessoireIntermediaire or 0),
                float(item.TauxCommission or 0),
                float(item.Commission or 0),
                float(item.FraisGestion or 0),
                float(item.CommissionDeduite or 0),
                float(item.AccessoireDeduit or 0),
                float(item.MontantReversement or 0),
            ]
            for col_idx, value in enumerate(data, start=1):
                num_cols = set(range(7, 17))
                fmt = NUM_FMT if col_idx in num_cols else None
                _apply_data_cell(ws, row_num, col_idx, value, number_format=fmt, size=FONT_SIZE)

            for k in range(7, 17):
                totals[k] += data[k - 1]

            row_num += 1

        # ── Ligne TOTAL ───────────────────────────────────────────────────────
        ws.merge_cells(f"E{row_num}:F{row_num}")
        tl = ws[f"E{row_num}"]
        tl.value = "TOTAL"
        tl.font = Font(bold=True, size=FONT_SIZE)
        tl.alignment = Alignment(horizontal="center", vertical="center")
        tl.border = _thin_border()

        for col_idx in range(1, 5):
            _apply_data_cell(ws, row_num, col_idx, "", size=FONT_SIZE)

        for k in range(7, 17):
            _apply_data_cell(ws, row_num, k, totals[k], bold=True, number_format=NUM_FMT, size=FONT_SIZE)

        # ── Signatures ────────────────────────────────────────────────────────
        sig_row = row_num + 5
        ws.merge_cells(f"A{sig_row}:C{sig_row}")
        sig_left = ws[f"A{sig_row}"]
        sig_left.value = "POUR OREOLE ASSURANCES"
        sig_left.font = Font(bold=True, size=FONT_SIZE)
        sig_left.alignment = Alignment(horizontal="left")

        ws.merge_cells(f"L{sig_row}:O{sig_row}")
        sig_right = ws[f"L{sig_row}"]
        sig_right.value = f"POUR {compagnie_name}"
        sig_right.font = Font(bold=True, size=FONT_SIZE)
        sig_right.alignment = Alignment(horizontal="right")

        # ── Retour du fichier ─────────────────────────────────────────────────
        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        filename = f"Bordereau_{rev.numero_reversement}_{date.today().strftime('%Y%m%d')}.xlsx"
        response = HttpResponse(
            buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response
