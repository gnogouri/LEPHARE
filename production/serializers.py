from datetime import timedelta
from decimal import Decimal
from typing import Any, cast

from dateutil.relativedelta import relativedelta
from django.db.models import F
from django.utils import timezone
from rest_framework import serializers

# Import des modèles MRH
from configuration_api.models import (
    Banque,
    Compagnie,
    GenreVehicule,
    Marque,
    ModeEncaissement,
    OffreAutomobileBoisee,
    Option,
    OptionUsage,
    ParametresCalcul,
    SousGarantie,
    SousGarantieMRH,
    SousGarantieUsage,
    Tarif,
    TypeVehicule,
    UsageHabitation,
)
from core.serializers import (
    DynamicFieldsSerializer,
    EnregistrementDevisBaseSerializer,
)
from core.validators import ErrorMessage, validate_contrat_validity_period
from customer.models import Client

from .models import (
    Brouillon,
    AssistanceAutomobile,
    AssureIaInfo,
    AssureIaParDevisOuContrat,
    AyantDroitIa,
    CertificatTransport,
    Cheque,
    ChequeOperation,
    ComplementContratDetailAuto,
    ComplementContratDetailSante,
    ComplementDevisDetailAuto,
    ComplementDevisDetailDommage,
    ComplementDevisDetailMrh,
    ComplementDevisDetailRC,
    ComplementDevisDetailSante,
    ComplementDevisDetailVoyage,
    ContractForPremiumCollection,
    Contrat,
    ContratDetail,
    ContratDetGarantie,
    DataInsertionResult,
    DemandeContratPourEncaissement,
    DetailEncaissement,
    DetailQuittance,
    DetailReversement,
    Devis,
    DevisDetail,
    DevisDetGarantie,
    Encaissement,
    EncaissementGroupeQuittance,
    EncaissementQuittance,
    EnregistrementEncaissement,
    ExtendedDevisInfo,
    GarantieContratFlotte,
    GarantieSouscrite,
    ImportsHistorique,
    InfoVehicule,
    LogRecord,
    Numero,
    PieceJointe,
    PremiumCollectionInfo,
    PremiumRemittanceInfo,
    Quittance,
    QuittanceFn,
    QuotationInsertionResult,
    ReversementCompagnie,
    ReversementGroupePrime,
    ReversementPrime,
    TarifEcran,
    VehiculeContrat,
)


def get_libelle_option(id_detail, entite="CNT"):
    try:
        if entite.upper() == "CNT":
            contrat_detail = ContratDetail.objects.get(pk=id_detail)
            complement_info = ComplementContratDetailAuto.objects.filter(
                contrat_detail=contrat_detail
            )
            if complement_info.count() > 0:
                complement = complement_info[0]
                # Guard against a missing assistance_automobile relation
                if getattr(complement, "assistance_automobile", None):
                    id_option_assistance = (
                        complement.assistance_automobile.id_option
                    )
                    try:
                        option = AssistanceAutomobile.objects.get(
                            pk=id_option_assistance
                        )
                        return option.libelle_option
                    except AssistanceAutomobile.DoesNotExist:
                        return ""
                else:
                    return ""
            else:
                return ""
        elif entite.upper() == "DEV":
            devis_detail = DevisDetail.objects.get(pk=id_detail)
            complement_info = ComplementDevisDetailAuto.objects.filter(
                devis_detail=devis_detail
            )
            if complement_info.count() > 0:
                complement = complement_info[0]
                # Guard against a missing assistance_automobile relation
                if getattr(complement, "assistance_automobile", None):
                    id_option_assistance = (
                        complement.assistance_automobile.id_option
                    )
                    try:
                        option = AssistanceAutomobile.objects.get(
                            pk=id_option_assistance
                        )
                        return option.libelle_option
                    except AssistanceAutomobile.DoesNotExist:
                        return ""
                else:
                    return ""
            else:
                return ""
        else:
            return ""
    except Exception as error:
        print(error)
        return ""


class ImportationTransportSerializer(serializers.Serializer):
    fichier_excel = serializers.FileField(
        max_length=None,
        allow_empty_file=False,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le fichier Excel",
            field_type="fichier",
            gender_number="ms",
        ),
    )
    debut_periode = serializers.DateField(
        format="%d-%m-%Y",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La date de début de la période d'émission",
            field_type="date",
            gender_number="fs",
        ),
    )
    fin_periode = serializers.DateField(
        format="%d-%m-%Y",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La date de fin de la période d'émission",
            field_type="date",
            gender_number="fs",
        ),
    )

    def validate(self, data):
        date_debut_periode = data.get("debut_periode")
        date_fin_periode = data.get("fin_periode")
        if date_debut_periode is not None and date_fin_periode is not None:
            if date_debut_periode > date_fin_periode:
                raise serializers.ValidationError(
                    {
                        "Début Période": "Le début de la période d'émission ne peut être postérieur à la fin de la période."
                    }
                )

        return data


class ContractForPremiumCollectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContractForPremiumCollection
        exclude = [
            "id",
        ]


class PremiumCollectionInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PremiumCollectionInfo
        exclude = [
            "id",
        ]


class PremiumRemittanceInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PremiumRemittanceInfo
        exclude = [
            "id",
        ]


class DevisDetailGarantieSerializer(serializers.ModelSerializer):
    class Meta:
        model = DevisDetGarantie
        fields = "__all__"

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        capital = representation["Capital"]
        deces = representation["deces"]
        ipp = representation["ipp"]
        ft = representation["fraismed"]
        idsousgarantie = instance.IdGarantie.pk
        if idsousgarantie == 22:
            textecapital = get_libelle_option(
                int(representation["IdDevisDet"]), "DEV"
            )
        elif (
            int(float(deces)) > 0 or int(float(ipp)) > 0 or int(float(ft)) > 0
        ):
            textecapital = (
                "Décès: "
                + f"{int(float(deces)):,}".replace(",", " ")
                + ", IPP: "
                + f"{int(float(ipp)):,}".replace(",", " ")
                + ", FT: "
                + f"{int(float(ft)):,}".replace(",", " ")
            )
        else:
            textecapital = f"{int(float(capital)):,}".replace(",", " ")
        representation["textecapital"] = textecapital
        representation["libellegarantie"] = (
            instance.IdGarantie.LibelleSousGarantie
        )
        return representation


class DevisDetGarantieSerializer(DevisDetailGarantieSerializer):
    class Meta:
        model = DevisDetGarantie
        fields = "__all__"
        depth = 1


class DevisDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = DevisDetail
        fields = "__all__"
        depth = 1

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        representation["codecategorie"] = ""
        representation["libellecategorie"] = ""
        # Détail des garanties réellement enregistrées pour ce devis (stddevisdetgarantie) :
        # sans ça, rouvrir un devis en édition n'a aucun moyen de retrouver les garanties/primes
        # telles qu'elles ont été acquises/imposées à l'origine, et ne peut que recalculer à neuf.
        representation["garanties_enregistrees"] = DevisDetailGarantieSerializer(
            instance.garanties.all(), many=True
        ).data
        devis = instance.iddevis
        if devis:
            if devis.produit.id_produit == 1:  # Automobile
                complementinfo = ComplementDevisDetailAuto.objects.filter(
                    devis_detail=instance
                )
                if complementinfo.count() > 0:
                    representation["bns"] = complementinfo[0].bns
                    representation["formule_securite_routiere"] = (
                        complementinfo[
                            0
                        ].formule_securite_routiere.libelle_formule
                    )
                    if complementinfo[0].assistance_automobile:
                        representation["assistance_automobie"] = (
                            complementinfo[0].assistance_automobile.id_option
                        )
                    else:
                        representation["assistance_automobie"] = None
                    representation["carburant_autre_matiere"] = complementinfo[
                        0
                    ].carburant_autre_matiere
                    representation["transport_eleves"] = complementinfo[
                        0
                    ].transport_eleves
                    representation["transport_employes"] = complementinfo[
                        0
                    ].transport_employes
                    representation["transport_passager_supplementaire"] = (
                        complementinfo[0].transport_passager_supplementaire
                    )
            elif devis.produit.id_produit in (
                2,
                3,
            ):  # Individuelle Accident ou Voyage
                representation["date_naissance"] = representation["datemec"]
                representation["capital_ipp"] = representation["valeurneuve"]
                representation["capital_deces"] = representation[
                    "valeurvenale"
                ]
                representation["frais_traitement"] = representation[
                    "valeuraccessoire"
                ]
                if devis.produit.id_produit == 2:
                    id_assure = int(representation["matricule"])
                    representation["id_assure"] = id_assure
                    assureinfo = Client.objects.get(pk=id_assure)
                    representation["nom_assure"] = assureinfo.Nom
                    representation["prenoms_assure"] = assureinfo.Prenoms
                if devis.produit.id_produit == 3:
                    complementinfo = (
                        ComplementDevisDetailVoyage.objects.filter(
                            devis_detail=instance
                        )
                    )
                    if complementinfo.count() > 0:
                        representation["id_pays_destination"] = complementinfo[
                            0
                        ].pays_destination.id_pays
                        representation["id_pays_voyageur"] = complementinfo[
                            0
                        ].pays_voyageur.id_pays
                        representation["reference_contrat"] = complementinfo[
                            0
                        ].reference_contrat
                        representation["numero_attestation"] = complementinfo[
                            0
                        ].numero_attestation
                        representation["schengen"] = complementinfo[
                            0
                        ].visa_schengen
                        representation["numero_passeport"] = complementinfo[
                            0
                        ].numero_passeport
            elif devis.produit.id_produit == 4:  # Multirisque Habitation
                complementinfo = ComplementDevisDetailMrh.objects.filter(
                    devis_detail=instance
                )
                if complementinfo.count() > 0:
                    representation["presence_gardien"] = complementinfo[
                        0
                    ].presence_gardien
                    representation["occupant_locataire"] = complementinfo[
                        0
                    ].occupant_locataire
                    representation["valeur_loyer"] = complementinfo[
                        0
                    ].valeur_loyer
                    representation["valeur_contenu"] = complementinfo[
                        0
                    ].valeur_contenu
                    representation["valeur_objet_precieux"] = complementinfo[
                        0
                    ].valeur_objet_precieux
                    representation["valeur_materiel"] = complementinfo[
                        0
                    ].valeur_materiel
                    representation["valeur_degat_batiment"] = complementinfo[
                        0
                    ].valeur_degat_batiment
                    representation["valeur_degat_contenu"] = complementinfo[
                        0
                    ].valeur_degat_contenu
                    representation["localisation"] = complementinfo[
                        0
                    ].localisation
            elif devis.produit.id_produit == 5:  # Santé
                complementinfo = ComplementDevisDetailSante.objects.filter(
                    devis_detail=instance
                )
                if complementinfo.count() > 0:
                    representation["prime_famille"] = complementinfo[
                        0
                    ].prime_famille
                    representation["prime_affilie"] = complementinfo[
                        0
                    ].prime_affilie
                    representation["prime_globale"] = complementinfo[
                        0
                    ].prime_globale
                    representation["montant_surprime"] = complementinfo[
                        0
                    ].montant_surprime
                    representation["montant_accessoire_manuel"] = (
                        complementinfo[0].montant_accessoire_manuel
                    )
                    representation["gestionnaire_sante"] = complementinfo[
                        0
                    ].gestionnaire_sante
                    representation["taux_reduction_commerciale"] = (
                        complementinfo[0].taux_reduction_commerciale
                    )
                    representation["type_contrat"] = complementinfo[
                        0
                    ].type_contrat.id_type_contrat

                tarif = Tarif.objects.get(pk=instance.idtarif)
                if tarif:
                    representation["codecategorie"] = tarif.CodeCategorie
                    representation["libellecategorie"] = (
                        tarif.IdCategorie.LibelleCategorie
                    )
            elif devis.produit.id_produit == 6:  # Transport
                pass
            elif devis.produit.id_produit == 7:  # Multirisque Professionnelle
                pass
            elif devis.produit.id_produit == 8:  # Responsabilité Civile

                complementinfo = ComplementDevisDetailRC.objects.filter(
                    devis_detail=instance
                )
                if complementinfo.count() > 0:
                    representation["taux_prime"] = complementinfo[0].taux_prime
                    representation["assiette_prime"] = complementinfo[
                        0
                    ].assiette_prime
                    representation["nombre_participants"] = complementinfo[
                        0
                    ].nombre_participants
                    representation["id_domaine_activite"] = complementinfo[
                        0
                    ].id_domaine_activite
                    representation["id_activite"] = complementinfo[
                        0
                    ].id_activite
                    representation["localisation"] = complementinfo[
                        0
                    ].localisation
                    representation["date_debut"] = complementinfo[0].date_debut
                    representation["activite"] = representation["observation"]

            elif devis.produit.id_produit == 9:  # Tous Dommages
                if devis.offre.IdOffre == 32:
                    representation["capital_materiel_informatique"] = (
                        representation["valeurneuve"]
                    )
                    representation["capital_frais_reconstitution"] = (
                        representation["valeurvenale"]
                    )
                    representation["capital_frais_supplementaire"] = (
                        representation["valeuraccessoire"]
                    )
                elif devis.offre.IdOffre == 33:
                    representation["capital_detournement_usage_faux"] = (
                        representation["valeurneuve"]
                    )
                    representation["capital_dommages_confondus"] = (
                        representation["valeurvenale"]
                    )
                    representation[
                        "capital_deterioration_mobiliere_immobiliere"
                    ] = representation["valeuraccessoire"]
                complementinfo = ComplementDevisDetailDommage.objects.filter(
                    devis_detail=instance
                )
                if complementinfo.count() > 0:
                    representation["taux_prime"] = complementinfo[0].taux_prime
                    representation["montant_prime"] = complementinfo[
                        0
                    ].montant_prime

        return representation


class CertificatTransportSerializer(serializers.ModelSerializer):
    class Meta:
        model = CertificatTransport
        fields = "__all__"


class PieceJointeSerializer(serializers.ModelSerializer):
    """Serializer pour les pièces jointes"""

    url = serializers.SerializerMethodField()

    class Meta:
        model = PieceJointe
        fields = [
            "id",
            "fichier",
            "url",
            "nom_original",
            "type_fichier",
            "taille",
            "date_upload",
        ]
        read_only_fields = [
            "id",
            "nom_original",
            "type_fichier",
            "taille",
            "date_upload",
        ]

    def get_url(self, obj):
        """Retourner l'URL complète du fichier"""
        request = self.context.get("request")
        if obj.fichier and request:
            return request.build_absolute_uri(obj.fichier.url)
        return None

    def create(self, validated_data):
        """Créer une pièce jointe avec métadonnées extraites du fichier"""
        fichier = validated_data.get("fichier")
        if fichier:
            validated_data["nom_original"] = fichier.name
            validated_data["type_fichier"] = fichier.content_type
            validated_data["taille"] = fichier.size
        return super().create(validated_data)


class DevisSerializer(serializers.ModelSerializer):
    offreboisee = serializers.SerializerMethodField()
    piece_jointe_info = PieceJointeSerializer(
        source="piece_jointe", read_only=True
    )
    duree_terme_jours = serializers.ReadOnlyField()
    libelle_categorie = serializers.SerializerMethodField()

    class Meta:
        model = Devis
        fields = "__all__"
        read_only_fields = [
            "date_creation",
            "date_modification",
            "prime_imposee_montant",
            "piece_jointe_info",
            "duree_terme_jours",
        ]
        depth = 1

    def get_libelle_categorie(self, obj):
        # Annoté par DevisViewSet.get_queryset ; calculé à la demande sinon
        if hasattr(obj, "libelle_categorie"):
            return obj.libelle_categorie
        from django.db import connection

        from .views import DEVIS_CATEGORIE_SQL

        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT ({DEVIS_CATEGORIE_SQL}) FROM stddevis WHERE iddevis = %s",
                [obj.pk],
            )
            row = cursor.fetchone()
        return row[0] if row else None

    def get_offreboisee(self, obj):
        try:
            if hasattr(obj, "iddevis"):
                devis = Devis.objects.annotate(
                    offreboisee=OffreAutomobileBoisee(F("offre__IdOffre"))
                ).get(pk=obj.iddevis)
                if devis and hasattr(devis, "offreboisee"):
                    return devis.offreboisee
        except Devis.DoesNotExist as e:
            print(e)
        return False

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        try:
            if instance.client:
                representation["datenaissaissanceclient"] = (
                    instance.client.DateNaissance
                )
                representation["numeroidentificationclient"] = (
                    instance.client.CniPat
                )
            if instance.assure:
                representation["datenaissanceassure"] = (
                    instance.assure.DateNaissance
                )
                representation["numeroidentificationassure"] = (
                    instance.assure.CniPat
                )
        except Exception as error:
            print(error)
        finally:
            return representation


class TarifEcranSerializer(serializers.ModelSerializer):
    class Meta:
        model = TarifEcran
        fields = "__all__"


class ContratSerializer(serializers.ModelSerializer):
    offreboisee = serializers.SerializerMethodField()
    piece_jointe_info = PieceJointeSerializer(
        source="piece_jointe", read_only=True
    )
    duree_terme_jours = serializers.ReadOnlyField()

    class Meta:
        model = Contrat
        fields = "__all__"
        depth = 1
        read_only_fields = [
            "idcontrat",
            "piece_jointe_info",
            "duree_terme_jours",
        ]

    def get_offreboisee(self, obj):
        # Valeur précalculée par ContratViewSet.get_queryset (une seule requête pour la liste)
        if hasattr(obj, "offreboisee_annotee"):
            return bool(obj.offreboisee_annotee)
        try:
            if hasattr(obj, "iddevis"):
                devis = Devis.objects.annotate(
                    offreboisee=OffreAutomobileBoisee(F("offre__IdOffre"))
                ).get(pk=obj.iddevis.pk)
                if devis and hasattr(devis, "offreboisee"):
                    return devis.offreboisee
            return False
        except Devis.DoesNotExist as e:
            print("Devis inexistant.")
            return False

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        try:
            if instance.idclient:
                representation["datenaissanceclient"] = (
                    instance.idclient.DateNaissance
                )
                representation["numeroidentificationclient"] = (
                    instance.idclient.CniPat
                )
            if instance.idassure:
                assure = Client.objects.get(pk=instance)
                if assure:
                    representation["datenaissanceassure"] = (
                        assure.DateNaissance
                    )
                    representation["numeroidentificationassure"] = (
                        assure.CniPat
                    )
            if instance.id_police_pegas:
                representation["numeropolice"] = representation[
                    "id_police_pegas"
                ]
        except Client.DoesNotExist as error:
            print(error)
        finally:
            return representation


class ContratDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContratDetail
        fields = "__all__"

    #   depth = 1

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        representation["codecategorie"] = ""
        contrat = instance.idcontrat
        if contrat:
            if contrat.idproduit.id_produit == 5:
                tarif = Tarif.objects.get(pk=instance.idtarif)
                if tarif:
                    representation["codecategorie"] = tarif.CodeCategorie
                complementsante = ComplementContratDetailSante.objects.filter(
                    contrat_detail=instance
                )
                if complementsante.exists():
                    c = complementsante[0]
                    representation["taux_reduction_commerciale"] = c.taux_reduction_commerciale
                    representation["prime_famille"] = c.prime_famille
                    representation["prime_affilie"] = c.prime_affilie
                    representation["prime_globale"] = c.prime_globale
                    representation["montant_surprime"] = c.montant_surprime
                    representation["montant_accessoire_manuel"] = c.montant_accessoire_manuel
                    representation["type_contrat"] = c.type_contrat.id_type_contrat if c.type_contrat else None
                    representation["gestionnaire_sante"] = c.gestionnaire_sante
            if contrat.idproduit.id_produit == 1:
                complementinfo = ComplementContratDetailAuto.objects.filter(
                    contrat_detail=instance
                )
                if complementinfo.count() > 0:
                    representation["bns"] = complementinfo[0].bns
                    representation["formule_securite_routiere"] = (
                        complementinfo[
                            0
                        ].formule_securite_routiere.libelle_formule
                    )
                    representation["carburant_autre_matiere"] = complementinfo[
                        0
                    ].carburant_autre_matiere
                    representation["transport_eleves"] = complementinfo[
                        0
                    ].transport_eleves
                    representation["transport_employes"] = complementinfo[
                        0
                    ].transport_employes
                    representation["transport_passager_supplementaire"] = (
                        complementinfo[0].transport_passager_supplementaire
                    )
                try:
                    if int(representation["idmarque"]) != 0:
                        marque = Marque.objects.get(
                            pk=int(representation["idmarque"])
                        )
                        representation["libellemarque"] = marque.LibelleMarque
                    idtv = int(representation["idtypevehicule"])
                    if idtv != 0:
                        typevehicule = TypeVehicule.objects.get(pk=idtv)
                        representation["libelletypevehicule"] = (
                            typevehicule.libelle_type
                        )
                    idgv = int(representation["idgenrevehicule"])
                    if idgv != 0:
                        genrevehicule = GenreVehicule.objects.get(pk=idgv)
                        representation["libellegenrevehicule"] = (
                            genrevehicule.LibelleGenre
                        )

                except Exception as error:
                    print(error)
        return representation


class LogRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = LogRecord
        fields = ("msg", "level_name")


class AyantDroitIaSerializer(serializers.ModelSerializer):
    libelle_qualite = serializers.SerializerMethodField()

    def get_libelle_qualite(self, obj):
        libelle_qualite = obj.qualite_ayant_droit.libelle_qualite_ayant_droit
        if not libelle_qualite:
            return None
        return libelle_qualite

    class Meta:
        model = AyantDroitIa
        fields = (
            "id_ayant_droit",
            "id_assure",
            "qualite_ayant_droit",
            "nom_ayant_droit",
            "prenoms_ayant_droit",
            "libelle_qualite",
            "part",
        )


# class ImportAssuresSerializer(serializers.Serializer):
#     """
#     Serializer pour l'upload de fichier Excel d'assurés.
#     """
#     fichier_excel = serializers.FileField(
#         required=True,
#         help_text="Fichier Excel (.xlsx ou .xls) contenant les assurés à importer"
#     )

#     mode_import = serializers.ChoiceField(
#         choices=[
#             ('creer_seulement', 'Créer seulement (ignorer les doublons)'),
#             ('mettre_a_jour', 'Mettre à jour les existants'),
#             ('erreur_si_doublon', 'Erreur si doublon détecté'),
#         ],
#         default='creer_seulement',
#         required=False,
#         help_text="Mode de gestion des doublons"
#     )

#     autoriser_reimport = serializers.BooleanField(
#         default=False,
#         required=False,
#         help_text="Autoriser la réimportation du même fichier"
#     )

#     def validate_fichier_excel(self, value):
#         """
#         Valide que le fichier est bien un Excel.
#         """
#         # Vérifier l'extension
#         if not value.name.endswith(('.xlsx', '.xls')):
#             raise serializers.ValidationError(
#                 "Le fichier doit être au format Excel (.xlsx ou .xls)"
#             )

#         # Vérifier la taille (max 10 Mo)
#         if value.size > 10 * 1024 * 1024:
#             raise serializers.ValidationError(
#                 "Le fichier est trop volumineux (maximum 10 Mo)"
#             )

#         return value


class ImportationAssureIaSerializer(serializers.Serializer):
    FichierExcel = serializers.FileField(
        max_length=None,
        allow_empty_file=False,
        error_messages={
            "null": "Le choix du fichier Excel est obligatoire",
            "blank": "Le choix du fichier Excel est obligatoire",
        },
        required=True,
        help_text="Fichier Excel (.xlsx ou .xls) contenant les assurés à importer",
    )

    IdCompagnie = serializers.IntegerField(
        error_messages={
            "null": "La compagnie doit être renseignée.",
            "blank": "La compagnie doit être renseignée.",
            "invalid": "L'ID de la compagnie doit être un nombre entier.",
        }
    )
    IdIntermediaire = serializers.IntegerField(
        error_messages={
            "null": "L'intermédiaire doit être renseigné.",
            "blank": "L'intermédiaire doit être renseigné.",
            "invalid": "L'ID de l'intermédiaire doit être un nombre entier.",
        }
    )
    IdOffre = serializers.IntegerField(
        error_messages={
            "null": "L'offre doit être renseignée.",
            "blank": "L'offre doit être renseignée.",
            "invalid": "L'ID de l'offre doit être un nombre entier.",
        }
    )
    IdAvenant = serializers.IntegerField(
        error_messages={
            "null": "L'avenant doit être renseigné.",
            "blank": "L'avenant doit être renseigné.",
            "invalid": "L'ID de l'avenant doit être un nombre entier.",
        }
    )
    IdClient = serializers.IntegerField(
        error_messages={
            "null": "Le client doit être renseigné.",
            "blank": "Le client doit être renseigné.",
            "invalid": "L'ID du client doit être un nombre entier.",
        }
    )
    NumeroPoliceConnexe = serializers.CharField(
        max_length=50, default="", required=False, allow_null=True
    )
    DateEffet = serializers.DateField(
        format="%d-%m-%Y",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        error_messages={
            "null": "La date d'effet doit être renseignée.",
            "blank": "La date d'effet doit être renseignée.",
            "invalid": "Format invalide pour la date d'effet.",
        },
    )
    DateExpiration = serializers.DateField(
        format="%d-%m-%Y",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        error_messages={
            "null": "La date d'expiration doit être renseignée.",
            "blank": "La date d'expiration doit être renseignée.",
            "invalid": "Format invalide pour la date d'expiration.",
        },
    )
    DateEmission = serializers.DateField(
        format="%d-%m-%Y",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        error_messages={
            "null": "La date d'émission doit être renseignée.",
            "blank": "La date d'émission doit être renseignée.",
            "invalid": "Format invalide pour la date d'émission.",
        },
    )
    IdTarif = serializers.IntegerField(
        error_messages={
            "null": "La catégorie doit être renseignée.",
            "blank": "La catégorie doit être renseignée.",
            "invalid": "L'ID de la catégorie doit être un nombre entier.",
        }
    )
    TauxReduction = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        error_messages={
            "null": "Le taux de réduction doit être renseigné.",
            "blank": "Le taux de réduction doit être renseigné.",
            "invalid": "Le taux de réduction doit être un nombre.",
        },
    )
    IdDuree = serializers.IntegerField(
        default=1,
        error_messages={
            "null": "La durée du contrat doit être renseignée.",
            "blank": "La durée du contrat doit être renseignée.",
            "invalid": "L'ID de la durée du contrat doit être un nombre entier.",
        },
    )
    IdDevis = serializers.IntegerField(
        default=0,
        error_messages={
            "null": "L'ID du devis doit être renseigné.",
            "blank": "L'ID du devis doit être renseigné.",
            "invalid": "L'ID du devis doit être un nombre entier.",
        },
    )
    NumeroPoliceCompagnie = serializers.CharField(
        max_length=60, required=False, default="", allow_null=True
    )

    ModeImport = serializers.ChoiceField(
        choices=[
            ("creer_seulement", "Créer seulement (ignorer les doublons)"),
            ("mettre_a_jour", "Mettre à jour les existants"),
            ("erreur_si_doublon", "Erreur si doublon détecté"),
        ],
        default="creer_seulement",
        required=False,
        help_text="Mode de gestion des doublons",
    )

    AutoriserReimport = serializers.BooleanField(
        default=False,
        required=False,
        help_text="Autoriser la réimportation du même fichier",
    )

    def validate_TauxReduction(self, value):
        """
        Plafond métier OREOLE : la réduction commerciale ne peut jamais
        dépasser 35%.
        """
        if value is not None and value > 35:
            raise serializers.ValidationError(
                "Le taux de réduction commerciale ne peut pas dépasser 35%."
            )
        return value

    def validate_FichierExcel(self, value):
        """
        Valide que le fichier est bien un Excel.
        """
        # Vérifier l'extension
        if not value.name.endswith((".xlsx", ".xls")):
            raise serializers.ValidationError(
                "Le fichier doit être au format Excel (.xlsx ou .xls)"
            )

        # Vérifier la taille (max 10 Mo)
        if value.size > 10 * 1024 * 1024:
            raise serializers.ValidationError(
                "Le fichier est trop volumineux (maximum 10 Mo)"
            )

        return value

    def validate(self, data):
        validate_contrat_validity_period(data)
        return data


class ImportResultatSerializer(serializers.Serializer):
    """
    Serializer pour le résultat d'un import.
    """

    success = serializers.BooleanField(help_text="True si l'import a réussi")

    statut = serializers.CharField(
        help_text="REUSSI, ECHOUE, PARTIEL, ou REFUSE"
    )

    message = serializers.CharField(help_text="Message descriptif du résultat")

    statistiques = serializers.DictField(
        help_text="Statistiques détaillées de l'import"
    )

    id_devis = serializers.IntegerField(
        allow_null=True, help_text="ID du devis créé (si applicable)"
    )

    hash_fichier = serializers.CharField(
        help_text="Hash SHA256 du fichier importé"
    )

    details = serializers.DictField(
        required=False,
        help_text="Détails additionnels (nouveaux, ignorés, erreurs)",
    )


class ImportsHistoriqueSerializer(serializers.ModelSerializer):
    """
    Serializer pour l'historique des imports.
    """

    taux_reussite = serializers.SerializerMethodField()
    hash_court = serializers.SerializerMethodField()

    class Meta:
        model = ImportsHistorique
        fields = [
            "id",
            "hash_fichier",
            "hash_court",
            "nom_fichier",
            "taille_fichier",
            "date_import",
            "user_id",
            "mode_import",
            "nb_assures_total",
            "nb_assures_nouveaux",
            "nb_assures_ignores",
            "nb_assures_mis_a_jour",
            "nb_erreurs",
            "statut",
            "taux_reussite",
            "details_erreur",
            "id_devis",
            "duree_secondes",
        ]
        read_only_fields = ["id", "date_import"]

    def get_taux_reussite(self, obj):
        """Calcule le taux de réussite"""
        return obj.taux_reussite

    def get_hash_court(self, obj):
        """Retourne un hash court"""
        return obj.hash_court


class ImportsHistoriqueDetailSerializer(ImportsHistoriqueSerializer):
    """
    Serializer détaillé avec le JSON complet.
    """

    class Meta(ImportsHistoriqueSerializer.Meta):
        fields = ImportsHistoriqueSerializer.Meta.fields + ["details_json"]


class ContratDetGarantieSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContratDetGarantie
        fields = "__all__"

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        capital = representation["capital"]
        deces = representation["deces"]
        ipp = representation["ipp"]
        ft = representation["fraismed"]
        idsousgarantie = instance.idgarantie.pk
        if idsousgarantie == 22:
            textecapital = get_libelle_option(
                int(representation["idcontratdetail"]), "CNT"
            )
        elif (
            int(float(deces)) > 0 or int(float(ipp)) > 0 or int(float(ft)) > 0
        ):
            textecapital = (
                "Décès: "
                + f"{int(float(deces)):,}".replace(",", " ")
                + ", IPP: "
                + f"{int(float(ipp)):,}".replace(",", " ")
                + ", FT: "
                + f"{int(float(ft)):,}".replace(",", " ")
            )
        else:
            textecapital = f"{int(float(capital)):,}".replace(",", " ")
        representation["textecapital"] = textecapital
        representation["libellegarantie"] = (
            instance.idgarantie.LibelleSousGarantie
        )
        return representation


class QuittanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Quittance
        fields = "__all__"
        depth = 1


class DetailQuittanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = DetailQuittance
        fields = "__all__"
        depth = 1


# class EncaissementSerializer(serializers.ModelSerializer):
#     class Meta:
#         model = Encaissement
#         fields = "__all__"
#         depth = 1


class DetailEncaissementShortSerializer(serializers.ModelSerializer):
    nomclient = serializers.CharField(
        source="numeroquittance.client.Nom", read_only=True
    )
    prenomsclient = serializers.CharField(
        source="numeroquittance.client.Prenoms", read_only=True
    )
    telephoneclient = serializers.CharField(
        source="numeroquittance.client.Telephone", read_only=True
    )
    mobileclient = serializers.CharField(
        source="numeroquittance.client.Mobile", read_only=True
    )
    primettc = serializers.DecimalField(
        source="numeroquittance.primettc",
        max_digits=19,
        decimal_places=4,
        read_only=True,
    )

    class Meta:
        model = DetailEncaissement
        fields = (
            "iddetailencaissement",
            "numeroquittance",
            "indiceacompte",
            "soldeinitial",
            "montant_encaissement",
            "primettc",
            "nomclient",
            "prenomsclient",
            "telephoneclient",
            "mobileclient",
        )


class EncaissementSerializer(serializers.ModelSerializer):
    details = DetailEncaissementShortSerializer(many=True, read_only=True)
    modepaiement = serializers.CharField(
        source="modepaiement.libellemodepaiement", read_only=True
    )
    banque = serializers.CharField(source="banque.libelle", read_only=True)
    idutilisateur = serializers.IntegerField(
        source="utilisateur.id", read_only=True
    )
    demande_annulation_en_cours = serializers.BooleanField(read_only=True)
    statut_demande_annulation = serializers.SerializerMethodField()

    class Meta:
        model = Encaissement
        fields = (
            "idencaissement",
            "numeropiece",
            "dateencaissement",
            "montantencaissement",
            "montantenattente",
            "montantdeduit",
            "modepaiement",
            "banque",
            "numerocheque",
            "compte_compensation",
            "idutilisateur",
            "datesaisie",
            "piece_annulee",
            "dateannulation",
            "nomannulation",
            "motifannulation",
            "datesaisieannulation",
            "nomtireurcheque",
            "details",
            "demande_annulation_en_cours",
            "statut_demande_annulation",
        )

    def get_statut_demande_annulation(self, obj):
        demande = obj.demande_annulation
        return demande.statut if demande else None


class DetailEncaissementSerializer(serializers.ModelSerializer):
    class Meta:
        model = DetailEncaissement
        fields = "__all__"
        depth = 1


class DetailReversementShortSerializer(serializers.ModelSerializer):
    nomclient = serializers.CharField(
        source="ligne_encaissement.numeroquittance.client.Nom", read_only=True
    )
    prenomsclient = serializers.CharField(
        source="ligne_encaissement.numeroquittance.client.Prenoms",
        read_only=True,
    )
    telephoneclient = serializers.CharField(
        source="ligne_encaissement.numeroquittance.client.Telephone",
        read_only=True,
    )
    mobileclient = serializers.CharField(
        source="ligne_encaissement.numeroquittance.client.Mobile",
        read_only=True,
    )

    class Meta:
        model = DetailReversement
        fields = (
            "id_detail_reversement",
            "solde_initial",
            "montant_reverse",
            "nomclient",
            "prenomsclient",
            "telephoneclient",
            "mobileclient",
        )


class CompagnieShortSerializer(serializers.ModelSerializer):
    # idcompagnie = serializers.IntegerField(source="Idcompagnie")
    # raisonsociale = serializers.CharField(source="RaisonSociale")
    class Meta:
        model = Compagnie
        fields = ["IdCompagnie", "RaisonSociale"]


class BanqueShortSerializer(serializers.ModelSerializer):
    class Meta:
        model = Banque
        fields = ["idbanque", "libelle"]


class ModeReversementShortSerializer(serializers.ModelSerializer):
    idmodereversement = serializers.IntegerField(source="idmodeencaissement")
    libellemodereversement = serializers.CharField(
        source="libellemodepaiement"
    )

    class Meta:
        model = ModeEncaissement
        fields = ["idmodereversement", "libellemodereversement"]


class ReversementCompagnieSerializer(serializers.ModelSerializer):
    details = DetailReversementShortSerializer(many=True, read_only=True)
    compagnie = CompagnieShortSerializer()
    mode_reversement = ModeReversementShortSerializer()
    banque = BanqueShortSerializer()

    class Meta:
        model = ReversementCompagnie
        fields = (
            "id_reversement",
            "compagnie",
            "numero_reversement",
            "date_reversement",
            "montant_reversement",
            "montant_en_attente",
            "montant_deduit",
            "mode_reversement",
            "banque",
            "numero_cheque",
            "compte_compensation",
            "utilisateur",
            "date_saisie",
            "piece_annulee",
            "date_annulation",
            "nom_annulation",
            "motif_annulation",
            "date_saisie_annulation",
            "nom_tireur_cheque",
            "details",
        )


class DetailReversementSerializer(serializers.ModelSerializer):
    class Meta:
        model = DetailReversement
        fields = "__all__"
        depth = 1


class NumeroSerializer(serializers.ModelSerializer):
    class Meta:
        model = Numero
        fields = "__all__"


class CreationAyantDroitIaSerializer(serializers.Serializer):
    IdAssure = serializers.IntegerField(
        error_messages={
            "null": "L'assuré doit être renseigné.",
            "blank": "L'assuré doit être renseigné.",
            "invalid": "L'ID de l'assuré doit être un nombre entier.",
        }
    )
    IdQualiteAyantDroit = serializers.IntegerField(
        error_messages={
            "null": "La qualité de l'ayant-droit doit être renseignée.",
            "blank": "La qualité de l'ayant-droit doit être renseignée.",
            "invalid": "Le code de la qualité de l'ayant-droit doit être un nombre entier.",
        }
    )
    NomAyantDroit = serializers.CharField(
        max_length=80,
        error_messages={
            "null": "Le nom de l'ayant-droit doit être renseigné.",
            "blank": "Le nom de l'ayant-droit doit être renseigné.",
        },
    )
    PrenomsAyantDroit = serializers.CharField(
        max_length=80,
        error_messages={
            "null": "Les prénoms de l'ayant-droit doivent être renseignés.",
            "blank": "Les prénoms de l'ayant-droit doivent être renseignés.",
        },
    )
    Part = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        error_messages={
            "null": "La part de l'ayant-droit doit être renseignée.",
            "blank": "La part de l'ayant-droit doit être renseignée.",
            "invalid": "La part de l'ayant-droit doit être un nombre.",
        },
    )

    def validate(self, data):
        part_ayant_droit = data.get("Part")
        if part_ayant_droit is not None:
            if part_ayant_droit > 100 or part_ayant_droit <= 0:
                raise serializers.ValidationError(
                    {
                        "Part": "La part de l'ayant-droit doit est comprise entre 0 et 100."
                    }
                )
        return data


class EnregistrementDevisAutoSerializer(EnregistrementDevisBaseSerializer):

    CodeUsage = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="L'usage",
            field_type="int",
            gender_number="ms",
            field_nature="cod",
        ),
    )
    IdCarrosserie = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La carrosserie",
            field_type="int",
            gender_number="fs",
            field_nature="idt",
        ),
    )
    CodeCarburant = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="L'énergie",
            field_type="int",
            gender_number="fs",
            field_nature="cod",
        ),
    )
    Puissance = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La puissance fiscale",
            field_type="int",
            gender_number="fs",
        ),
    )
    NombrePlace = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le nombre de places",
            field_type="int",
            gender_number="ms",
        ),
    )
    Charge = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La charge utile", field_type="int", gender_number="fs"
        ),
    )
    ValeurNeuve = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La valeur neuve",
            field_type="decimal",
            gender_number="fs",
        ),
    )
    ValeurVenale = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La valeur venale",
            field_type="decimal",
            gender_number="fs",
        ),
    )
    ValeurAccessoire = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La valeur accessoire",
            field_type="decimal",
            gender_number="fs",
        ),
    )
    TauxReduction = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le taux de réduction commerciale",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    CodeAlarme = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le système de sécurité",
            field_type="int",
            gender_number="ms",
            field_nature="cod",
        ),
    )
    Bns = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le taux de réduction BNS",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    NomConducteur = serializers.CharField(
        max_length=80, required=False, default="", allow_null=True
    )
    AdresseConducteur = serializers.CharField(
        max_length=60, required=False, default="", allow_null=True
    )
    DateMec = serializers.DateField(
        format="%d-%m-%Y",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La date de mise en circulation",
            field_type="date",
            gender_number="fs",
        ),
    )
    NumMoteur = serializers.CharField(
        max_length=20, required=False, default="", allow_null=True
    )
    NumChassis = serializers.CharField(
        max_length=20, required=False, default="", allow_null=True
    )
    IdTypeVehicule = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le type du véhicule",
            field_type="int",
            gender_number="ms",
            field_nature="idt",
        ),
    )
    IdMarque = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La marque du véhicule",
            field_type="int",
            gender_number="fs",
            field_nature="idt",
        ),
    )
    Matricule = serializers.CharField(
        max_length=20,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le numéro d'immatriculation",
            field_type="str",
            gender_number="ms",
        ),
    )
    NumPermisConduire = serializers.CharField(
        max_length=30, required=False, default="", allow_null=True
    )
    IdGenreVehicule = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le genre du véhicule",
            field_type="int",
            gender_number="ms",
            field_nature="idt",
        ),
    )
    NumCarteBrunePhysique = serializers.CharField(
        max_length=50, required=False, default="", allow_null=True
    )
    ModeleVehicule = serializers.CharField(
        max_length=20, required=False, default="", allow_null=True
    )
    IdDevis = serializers.IntegerField(
        default=0,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="L'ID du devis", field_type="int", gender_number="ms"
        ),
    )
    IdDevisDetail = serializers.IntegerField(
        default=0,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="L'ID du détail du devis",
            field_type="int",
            gender_number="ms",
        ),
    )
    RemorqueAttelee = serializers.BooleanField(
        required=False, default=False, allow_null=True
    )
    CodeFormuleSecuriteRoutiere = serializers.CharField(
        max_length=80, required=False, default="", allow_null=True
    )
    IdOptionAssistance = serializers.IntegerField(
        required=False, default=0, allow_null=True
    )
    CarburantAutreMatiere = serializers.BooleanField(
        required=False, default=False, allow_null=True
    )
    TransportEleves = serializers.BooleanField(
        required=False, default=False, allow_null=True
    )
    TransportEmployes = serializers.BooleanField(
        required=False, default=False, allow_null=True
    )
    TansportPassagerSupplementaire = serializers.BooleanField(
        required=False, default=False, allow_null=True
    )
    NsiaAutoPlus = serializers.BooleanField(
        required=False, default=False, allow_null=True
    )
    IdDuree = serializers.IntegerField(
        required=False, allow_null=True, default=1
    )
    IdTerme = serializers.IntegerField(
        required=False, allow_null=True, default=1
    )
    NumeroPoliceCompagnie = serializers.CharField(
        max_length=60, required=False, default="", allow_null=True
    )

    def validate(self, data):
        data = super().validate(data)

        val_neuve = data.get("ValeurNeuve")
        if val_neuve is None:
            raise serializers.ValidationError(
                {"Valeur neuve": "La valeur neuve doit être renseignée."}
            )

        val_venale = data.get("ValeurVenale")
        if val_venale is None:
            raise serializers.ValidationError(
                {"Valeur venale": "La valeur venale doit être renseignée."}
            )

        val_accessoire = data.get("ValeurAccessoire")
        if val_accessoire is None:
            raise serializers.ValidationError(
                {
                    "Valeur accessoire": "La valeur accessoire doit être renseignée."
                }
            )

        if val_accessoire > val_venale:
            raise serializers.ValidationError(
                {
                    "Valeur accessoire": "La valeur accessoire ne peut être supérieure à la valeur venale."
                }
            )
        if val_accessoire > val_neuve:
            raise serializers.ValidationError(
                {
                    "Valeur accessoire": "La valeur accessoire ne peut être supérieure à la valeur neuve."
                }
            )
        if val_venale > val_neuve:
            raise serializers.ValidationError(
                {
                    "Valeur venale": "La valeur venale ne peut être supérieure à la valeur neuve."
                }
            )

        return data

    def to_internal_value(self, data):
        if "IdDuree" in data:
            if not data["IdDuree"]:
                data["IdDuree"] = 1
        if "IdTerme" in data:
            if not data["IdTerme"]:
                data["IdTerme"] = 1
        if "NumMoteur" in data:
            if data["NumMoteur"] == "":
                data["NumMoteur"] = None
        if "NumChassis" in data:
            if data["NumChassis"] == "":
                data["NumChassis"] = None
        if "NumCarteBrunePhysique" in data:
            if data["NumCarteBrunePhysique"] == "":
                data["NumCarteBrunePhysique"] = None
        if "ModeleVehicule" in data:
            if data["ModeleVehicule"] == "":
                data["ModeleVehicule"] = None
        if "RemorqueAttelee" in data:
            if not data["RemorqueAttelee"]:
                data["RemorqueAttelee"] = False
        if "CodeFormuleSecuriteRoutiere" in data:
            if data["CodeFormuleSecuriteRoutiere"] == "":
                data["CodeFormuleSecuriteRoutiere"] = None
        if "IdOptionAssistance" in data:
            if not data["IdOptionAssistance"]:
                data["IdOptionAssistance"] = 0
        if "CarburantAutreMatiere" in data:
            if not data["CarburantAutreMatiere"]:
                data["CarburantAutreMatiere"] = False
        if "TransportEleves" in data:
            if not data["TransportEleves"]:
                data["TransportEleves"] = False
        if "TransportEmployes" in data:
            if not data["TransportEmployes"]:
                data["TransportEmployes"] = False
        if "TansportPassagerSupplementaire" in data:
            if not data["TansportPassagerSupplementaire"]:
                data["TansportPassagerSupplementaire"] = False
        if "NsiaAutoPlus" in data:
            if not data["NsiaAutoPlus"]:
                data["NsiaAutoPlus"] = False
        if "NomConducteur" in data:
            if data["NomConducteur"] == "":
                data["NomConducteur"] = None
        if "AdresseConducteur" in data:
            if data["AdresseConducteur"] == "":
                data["AdresseConducteur"] = None
        if "NumPermisConduire" in data:
            if data["NumPermisConduire"] == "":
                data["NumPermisConduire"] = None
        if "NumeroPoliceCompagnie" in data:
            if data["NumeroPoliceCompagnie"] == "":
                data["NumeroPoliceCompagnie"] = None

        return super().to_internal_value(data)


class FinalisationDevisFlotteSerializer(serializers.Serializer):
    IdDevis = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="L'ID du devis", field_type="int", gender_number="ms"
        ),
    )
    IdClient = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le client",
            field_type="int",
            gender_number="ms",
            field_nature="idt",
        ),
    )
    IdAssure = serializers.IntegerField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="L'assuré",
            field_type="int",
            gender_number="ms",
            field_nature="idt",
        ),
    )
    Flotte = serializers.BooleanField(
        default=False,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Flotte", field_type="boolean"
        ),
    )


#################################################"EnregistrementDevisIaSerializer"
class EnregistrementDevisIaSerializer(EnregistrementDevisBaseSerializer):

    IdProfession = serializers.IntegerField(required=False, allow_null=True)

    CapitalDeces = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital décès",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    CapitalIpp = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital IPP",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    FraisTraitement = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Les frais de traitement",
            field_type="decimal",
            gender_number="mp",
            field_nature="mnt",
        ),
    )
    TauxReduction = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le taux de réduction",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    CodeActivite = serializers.CharField(
        max_length=2,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="L'activité", field_type="str", gender_number="fs"
        ),
    )
    DateNaissance = serializers.DateField(
        format="%d-%m-%Y",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La date de naissance",
            field_type="date",
            gender_number="fs",
        ),
    )
    AdresseGeographique = serializers.CharField(
        max_length=100, required=False, default="", allow_null=True
    )
    IdDuree = serializers.IntegerField(
        default=1,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La durée du contrat",
            field_type="int",
            gender_number="fs",
            field_nature="idt",
        ),
    )
    IdDevis = serializers.IntegerField(
        default=0,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="L'ID du devis", field_type="int", gender_number="ms"
        ),
    )
    IdDevisDetail = serializers.IntegerField(
        default=0,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="L'ID du détail du devis",
            field_type="int",
            gender_number="ms",
        ),
    )
    NumeroPoliceConnexe = serializers.CharField(
        max_length=50, required=False, default="", allow_null=True
    )
    NumeroPoliceCompagnie = serializers.CharField(
        max_length=60, required=False, default="", allow_null=True
    )
    PrimeNette = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        allow_null=True,
    )
    Accessoire = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        allow_null=True,
    )
    Taxe = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        allow_null=True,
    )
    PrimeTTC = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        allow_null=True,
    )

    def to_internal_value(self, data):

        if "AdresseGeographique" in data:
            if data["AdresseGeographique"] == "":
                data["AdresseGeographique"] = None

        if "NumeroPoliceConnexe" in data:
            if data["NumeroPoliceConnexe"] == "":
                data["NumeroPoliceConnexe"] = None

        if "NumeroPoliceCompagnie" in data:
            if data["NumeroPoliceCompagnie"] == "":
                data["NumeroPoliceCompagnie"] = None

        return super().to_internal_value(data)


################################## Enregistrement Devis Voyage Serializer ############################
class EnregistrementDevisVoyageSerializer(EnregistrementDevisBaseSerializer):
    TauxReduction = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le taux de réduction",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    DateNaissance = serializers.DateField(
        format="%d-%m-%Y",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La date de naissance",
            field_type="date",
            gender_number="fs",
        ),
    )
    IdDevis = serializers.IntegerField(
        required=False, default=0, allow_null=True
    )
    IdPaysDestination = serializers.IntegerField(
        required=False, default=1, allow_null=True
    )
    IdPaysVoyageur = serializers.IntegerField(
        required=False, default=1, allow_null=True
    )
    ReferenceContrat = serializers.CharField(
        max_length=50,
        allow_null=True,
        required=False,
        default="",
    )
    NumeroAttestation = serializers.CharField(
        max_length=30,
        allow_null=True,
        required=False,
        default="",
    )
    Schengen = serializers.BooleanField(
        allow_null=True,
        required=False,
        default=False,
    )
    NumeroPasseport = serializers.CharField(
        max_length=30,
        allow_null=True,
        required=False,
        default="",
    )
    NumeroPoliceCompagnie = serializers.CharField(
        max_length=60, required=False, default="", allow_null=True
    )

    def to_internal_value(self, data):
        if "ReferenceContrat" in data:
            if data["ReferenceContrat"] == "":
                data["ReferenceContrat"] = None
        if "NumeroAttestation" in data:
            if data["NumeroAttestation"] == "":
                data["NumeroAttestation"] = None
        if "Schengen" in data:
            if not data["Schengen"]:
                data["Schengen"] = False
        if "NumeroPasseport" in data:
            if data["NumeroPasseport"] == "":
                data["NumeroPasseport"] = None
        if "IdDevis" in data:
            if not data["IdDevis"]:
                data["IdDevis"] = 0
        if "IdPaysDestination" in data:
            if not data["IdPaysDestination"]:
                data["IdPaysDestination"] = 1
        if "IdPaysVoyageur" in data:
            if not data["IdPaysVoyageur"]:
                data["IdPaysVoyageur"] = 1
        if "NumeroPoliceCompagnie" in data:
            if data["NumeroPoliceCompagnie"] == "":
                data["NumeroPoliceCompagnie"] = None

        return super().to_internal_value(data)


############################## Enregistrement Devis MRH Serializer ###########################
class EnregistrementDevisMrhSerializer(EnregistrementDevisBaseSerializer):
    Gardien = serializers.BooleanField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Gardien", field_type="boolean"
        ),
    )
    Locataire = serializers.BooleanField(
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Locataire", field_type="boolean"
        ),
    )
    TauxReduction = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le taux de réduction",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    ValeurCapitalLoyer = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital valeur du loyer",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    ValeurCapitalContenu = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital valeur du contenu",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    ValeurCapitalObjetPrecieux = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital valeur des objets précieux",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    ValeurCapitalMateriel = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital valeur du matériel",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    ValeurDegatBatiment = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La valeur des dégâts bâtiment",
            field_type="decimal",
            gender_number="fs",
        ),
    )
    ValeurDegatContenu = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="La valeur des dégats contenu",
            field_type="decimal",
            gender_number="fs",
        ),
    )
    IdDevis = serializers.IntegerField(
        required=False, allow_null=True, default=0
    )
    Localisation = serializers.CharField(
        required=False, allow_null=True, default="", max_length=100
    )
    IdDuree = serializers.IntegerField(
        required=False, allow_null=True, default=1
    )
    IdTerme = serializers.IntegerField(
        required=False, allow_null=True, default=1
    )
    TelephoneAssure = serializers.CharField(
        required=False, allow_null=True, default=""
    )
    NumeroPoliceCompagnie = serializers.CharField(
        max_length=60, required=False, default="", allow_null=True
    )

    def to_internal_value(self, data):
        if "TelephoneAssure" in data:
            if data["TelephoneAssure"] == "":
                data["TelephoneAssure"] = None
        if "IdTerme" in data:
            if not data["IdTerme"]:
                data["IdTerme"] = 1
        if "IdDuree" in data:
            if not data["IdDuree"]:
                data["IdDuree"] = 1
        if "Localisation" in data:
            if not data["Localisation"]:
                data["Localisation"] = None
        if "IdDevis" in data:
            if not data["IdDevis"]:
                data["IdDevis"] = 0
        if "NumeroPoliceCompagnie" in data:
            if data["NumeroPoliceCompagnie"] == "":
                data["NumeroPoliceCompagnie"] = None
        return super().to_internal_value(data)


############################## Enregistrement Devis Tous Risques Info Serializer ###########################
class EnregistrementDevisTRInfoSerializer(EnregistrementDevisBaseSerializer):

    TauxPrime = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le taux de prime",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    TauxReduction = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le taux de réduction",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    CapitalMaterielInformatique = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital matériel informatique",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    CapitalFraisReconstitution = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital frais de reconstitution",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    CapitalFraisSupplementaire = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital frais supplémentaires",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    CapitalCautionnement = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le montant de cautionnement",
            field_type="decimal",
            gender_number="ms",
        ),
        required=False,
        default=0,
        allow_null=True,
    )
    MontantPrime = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le montant de la prime",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    IdDevis = serializers.IntegerField(
        required=False, allow_null=True, default=0
    )
    IdDuree = serializers.IntegerField(
        required=False, allow_null=True, default=1
    )
    TelephoneAssure = serializers.CharField(
        required=False, allow_null=True, default=""
    )
    NumeroPoliceCompagnie = serializers.CharField(
        max_length=60, required=False, default="", allow_null=True
    )
    Accessoire = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False, allow_null=True, default=0
    )

    def to_internal_value(self, data):
        if "TelephoneAssure" in data:
            if data["TelephoneAssure"] == "":
                data["TelephoneAssure"] = None
        if "IdDevis" in data:
            if not data["IdDevis"]:
                data["IdDevis"] = 0
        if "IdDuree" in data:
            if not data["IdDuree"]:
                data["IdDuree"] = 1

        if "CapitalCautionnement" in data:
            if not data["CapitalCautionnement"]:
                data["CapitalCautionnement"] = 0

        if "NumeroPoliceCompagnie" in data:
            if data["NumeroPoliceCompagnie"] == "":
                data["NumeroPoliceCompagnie"] = None

        return super().to_internal_value(data)


############################## Enregistrement Devis RC #####################################################
class GarantieCapitauxSerializer(serializers.Serializer):
    """
    Sérialiseur pour la liste des garanties dont les capitaux ont été indiqués.
    """

    id_garantie = serializers.IntegerField()
    acquise = serializers.BooleanField()
    capital = serializers.DecimalField(max_digits=19, decimal_places=4)
    montant_franchise = serializers.DecimalField(
        required=False, max_digits=19, decimal_places=4
    )
    taux_franchise = serializers.DecimalField(
        required=False, max_digits=5, decimal_places=2
    )
    franchise_minimum = serializers.DecimalField(
        required=False,
        max_digits=19,
        decimal_places=4,
    )
    franchise_maximum = serializers.DecimalField(
        required=False, max_digits=19, decimal_places=4
    )


class EnregistrementDevisRisqquesDiversSerializer(
    EnregistrementDevisBaseSerializer
):
    AssiettePrime = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        default=0,
    )
    IdDomaineActivite = serializers.IntegerField(
        required=False, allow_null=True, default=0
    )
    Activite = serializers.CharField(
        max_length=100,
        required=False,
        allow_null=True,
        allow_blank=True,
        default="",
    )
    Localisation = serializers.CharField(
        max_length=60,
        required=False,
        allow_null=True,
        allow_blank=True,
        default="",
    )
    DateDebut = serializers.DateField(
        format="%d-%m-%Y",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        required=False,
        allow_null=True,
    )
    NombreParticipants = serializers.IntegerField(
        required=False, allow_null=True, default=0
    )
    TauxPrime = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        required=False,
        allow_null=True,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le taux de prime",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    TauxReduction = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le taux de réduction",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    CapitalDommageCorporel = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital dommage corporel",
            field_type="decimal",
            gender_number="ms",
        ),
        required=False,
        allow_null=True,
        default=0,
    )
    CapitalIntoxicationAlimentaire = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital intoxication alimentaire",
            field_type="decimal",
            gender_number="ms",
        ),
        required=False,
        allow_null=True,
        default=0,
    )
    CapitalDommageMateriel = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital dommage matériel",
            field_type="decimal",
            gender_number="ms",
        ),
        required=False,
        allow_null=True,
        default=0,
    )
    IdDevis = serializers.IntegerField(
        required=False, allow_null=True, default=0
    )
    IdDuree = serializers.IntegerField(
        required=False, allow_null=True, default=1
    )
    TelephoneAssure = serializers.CharField(
        max_length=20, required=False, allow_null=True, default=""
    )
    AdresseGeographique = serializers.CharField(
        max_length=60,
        required=False,
        allow_null=True,
        allow_blank=True,
        default="",
    )
    NumeroPoliceConnexe = serializers.CharField(
        max_length=50, required=False, default="", allow_null=True
    )
    NumeroPoliceCompagnie = serializers.CharField(
        max_length=60, required=False, default="", allow_null=True
    )
    PrimeNette = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False, default=0
    )
    Accessoire = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False, default=0
    )
    Taxe = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False, default=0
    )
    PrimeTTC = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False, default=0
    )
    ListeGarantie = GarantieCapitauxSerializer(
        many=True, allow_null=True, required=False
    )

    def to_internal_value(self, data):
        if "TelephoneAssure" in data:
            if data["TelephoneAssure"] == "":
                data["TelephoneAssure"] = None
        if "IdDevis" in data:
            if not data["IdDevis"]:
                data["IdDevis"] = 0
        if "IdDuree" in data:
            if not data["IdDuree"]:
                data["IdDuree"] = 1
        if "AssiettePrime" in data:
            if not data["AssiettePrime"]:
                data["IdDuree"] = 0
        if "IdDomaineActivite" in data:
            if not data["IdDomaineActivite"]:
                data["IdDomaineActivite"] = 0
        if "Activite" in data:
            if not data["Activite"]:
                data["Activite"] = ""
        if "Localisation" in data:
            if not data["Localisation"]:
                data["Localisation"] = ""
        if "NombreParticipants" in data:
            if not data["NombreParticipants"]:
                data["NombreParticipants"] = 0
        if "NumeroPoliceConnexe" in data:
            if data["NumeroPoliceConnexe"] == "":
                data["NumeroPoliceConnexe"] = None
        if "NumeroPoliceCompagnie" in data:
            if data["NumeroPoliceCompagnie"] == "":
                data["NumeroPoliceCompagnie"] = None

        return super().to_internal_value(data)


############################## Enregistrement Devis Globale de Banque Serializer ###########################
class EnregistrementDevisGlobaleDeBanqueSerializer(
    EnregistrementDevisBaseSerializer
):
    TauxPrime = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le taux de prime",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    TauxReduction = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le taux de réduction",
            field_type="decimal",
            gender_number="ms",
        ),
    )

    CapitalDetournementUsageFaux = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital détournement",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    CapitalDommagesConfondus = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital dommages confondus",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    CapitalDeteriorationImmobiliere = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le capital détérioration immobilière",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    MontantPrime = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        error_messages=ErrorMessage.generate_error_messages(
            field_name="Le montant de la prime",
            field_type="decimal",
            gender_number="ms",
        ),
    )
    IdDevis = serializers.IntegerField(
        required=False, default=0, allow_null=True
    )
    IdDuree = serializers.IntegerField(
        required=False, allow_null=True, default=1
    )
    TelephoneAssure = serializers.CharField(
        required=False, allow_null=True, default=""
    )
    NumeroPoliceCompagnie = serializers.CharField(
        max_length=60, required=False, default="", allow_null=True
    )

    def to_internal_value(self, data):
        if "TelephoneAssure" in data:
            if data["TelephoneAssure"] == "":
                data["TelephoneAssure"] = None
        if "IdDevis" in data:
            if not data["IdDevis"]:
                data["IdDevis"] = 0
        if "IdDuree" in data:
            if not data["IdDuree"]:
                data["IdDuree"] = 1
        if "NumeroPoliceCompagnie" in data:
            if data["NumeroPoliceCompagnie"] == "":
                data["NumeroPoliceCompagnie"] = None
        return super().to_internal_value(data)


class OperationSurDevisSerializer(serializers.Serializer):
    IdDevis = serializers.IntegerField()


class OperationSurDevisDetailSerializer(serializers.Serializer):
    IdDevisDetail = serializers.IntegerField()


class DataInsertionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DataInsertionResult
        fields = (
            "ObjectId",
            "OutputMessage",
        )


class QuotationIaInsertionSerializer(serializers.ModelSerializer):
    Assure = serializers.CharField(
        source="NumeroImmatriculation", max_length=50
    )

    class Meta:
        model = QuotationInsertionResult
        fields = (
            "IdDevis",
            "IdDevisDetail",
            "Assure",
            "OutputMessage",
        )


class QuotationInsertionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuotationInsertionResult
        fields = (
            "IdDevis",
            "IdDevisDetail",
            "NumeroImmatriculation",
            "OutputMessage",
        )


class ExtendedQuotationInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExtendedDevisInfo
        exclude = [
            "intermediaire",
            "compagnie",
            "produit",
            "offre",
            "client",
            "assure",
            "avenant",
            "aperiteur",
        ]


class QuittancePropositionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuittanceFn
        fields = (
            "IdDevis",
            "RaisonSociale",
            "LibelleIntermediaire",
            "IdClient",
            "NumeroDevis",
            "NumeroAvenant",
            "NomClient",
            "AdresseClient",
            "DateEffet",
            "DateExpiration",
            "DateEmission",
            "Duree",
            "PrimeNette",
            "PrimeNetteHorsFga",
            "Fga",
            "Accessoire",
            "AccessoireCompagnie",
            "AccessoireIntermediaire",
            "TaxeEnregistrement",
            "PrimeTtc",
            "Confirme",
            "LibelleProduit",
            "LibelleCategorie",
            "CommissionIntermediaire",
            "CommissionGestionnaire",
            "CommissionAperition",
            "TitreClient",
            "ProfessionClient",
            "TypeAssure",
            "TypeSouscripteur",
            "TelephoneClient",
            "MobileClient",
            "AdresseGeographique",
            "EmailClient",
            "Cedeao",
            "LibelleMouvement",
            "NomAssure",
            "AdresseAssure",
            "LibelleOffre",
            "LibelleBareme",
            "CodeCategorie",
            "FraisGestion",
            "NumeroPoliceConnexe",
            "CodeIntermediaire",
            "DateNaissanceClient",
            "DateNaissanceAssure",
            "NumeroFacture",
        )


class QuittanceContratSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuittanceFn
        fields = (
            "IdContrat",
            "IdDevis",
            "RaisonSociale",
            "LibelleIntermediaire",
            "IdClient",
            "NumeroPolice",
            "NumeroAvenant",
            "NomClient",
            "AdresseClient",
            "DateEffet",
            "DateExpiration",
            "DateEmission",
            "Duree",
            "PrimeNette",
            "PrimeNetteHorsFga",
            "Fga",
            "Accessoire",
            "AccessoireCompagnie",
            "AccessoireIntermediaire",
            "TaxeEnregistrement",
            "PrimeTtc",
            "LibelleProduit",
            "LibelleCategorie",
            "CommissionIntermediaire",
            "CommissionGestionnaire",
            "CommissionAperition",
            "TitreClient",
            "ProfessionClient",
            "TypeAssure",
            "TypeSouscripteur",
            "TelephoneClient",
            "MobileClient",
            "AdresseGeographique",
            "EmailClient",
            "Cedeao",
            "LibelleMouvement",
            "NomAssure",
            "AdresseAssure",
            "NumeroQuittance",
            "LibelleOffre",
            "LibelleBareme",
            "CodeCategorie",
            "FraisGestion",
            "NumeroPoliceConnexe",
            "CodeIntermediaire",
            "DateNaissanceClient",
            "DateNaissanceAssure",
            "NumeroFacture",
        )


class GarantieContratFlotteSerializer(serializers.ModelSerializer):
    class Meta:
        model = GarantieContratFlotte
        fields = (
            "IdContrat",
            "NatureRisque",
            "Garantie",
            "SommeMaxGarantie",
            "Franchise",
            "PrimeNette",
        )


class VehiculeContratSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehiculeContrat
        fields = (
            "IdContrat",
            "LibelleTarif",
            "LibelleCategorie",
            "IdMarque",
            "LibelleMarque",
            "IdTypeVehicule",
            "LibelleTypeVehicule",
            "ChargeUtile",
            "Puissance",
            "Immatriculation",
            "DateMec",
            "CodeEnergie",
            "LibelleEnergie",
            "ValeurNeuve",
            "ValeurVenale",
            "NombrePlace",
            "Rc",
            "Fga",
            "Cedeao",
            "Recours",
            "RecoursAnticipe",
            "RecoursExpress",
            "Dommages",
            "Collision",
            "BrisDeGlaces",
            "Incendie",
            "Explosion",
            "VolSimple",
            "VolMainsArmees",
            "Vandalisme",
            "VolAccessoires",
            "IndividuelleChauffeur",
            "InfirmitePermanente",
            "IncapaciteTemporaire",
            "Deces",
            "FraisTraitement",
            "Immobilisation",
            "NsiaAssistCar",
            "PersonnesTransportees",
            "RecoursTiersIncendie",
            "SecuriteRoutiere",
            "PrimeHorsTaxes",
            "Reduction",
            "PrimeNette",
        )


class EnregistrementEncaissementSerializer(serializers.ModelSerializer):
    date_encaissement = serializers.DateField(
        format="%Y-%m-%d",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
    )

    class Meta:
        model = EnregistrementEncaissement
        fields = [
            "mode_encaissement",
            "banque",
            "montant_total",
            "numero_cheque",
            "reference_encaissement",
            "reference_compensation",
            "nom_emetteur",
            "date_encaissement",
            "liste_quittance",
        ]


class DemandeContratPourEncaissementSerializer(serializers.ModelSerializer):
    class Meta:
        model = DemandeContratPourEncaissement
        fields = (
            "referenceclient",
            "referencecontrat",
        )


class EncaissementQuittanceSerializer(serializers.Serializer):
    numero_quittance = serializers.CharField(required=True)
    montant_encaissement = serializers.DecimalField(
        required=True, max_digits=19, decimal_places=4
    )

    def create(self, validated_data):
        return EncaissementQuittance(**validated_data)

    def update(self, instance, validated_data):
        instance.numero_quittance = validated_data.get(
            "numero_quittance", instance.numero_quittance
        )
        instance.montant_encaissement = validated_data.get(
            "montant_encaissement", instance.montant_encaissement
        )
        return instance


class ReversementPrimeSerializer(serializers.Serializer):
    identifiant_encaissement = serializers.IntegerField(required=True)
    montant_reversement = serializers.DecimalField(
        required=True, max_digits=19, decimal_places=4
    )

    def create(self, validated_data):
        return ReversementPrime(**validated_data)

    def update(self, instance, validated_data):
        instance.identifiant_encaissement = validated_data.get(
            "identifiant_encaissement", instance.identifiant_encaissement
        )
        instance.montant_reversement = validated_data.get(
            "montant_reversement", instance.montant_reversement
        )
        return instance


class EncaissementGroupeQuittanceSerializer(serializers.Serializer):
    mode_encaissement = serializers.IntegerField(required=True)
    date_encaissement = serializers.DateField(
        required=True,
        format="%Y-%m-%d",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
    )
    banque = serializers.IntegerField(
        required=False, default=1, allow_null=True
    )
    montant_total = serializers.DecimalField(
        required=True, max_digits=19, decimal_places=4
    )
    montant_initial_cheque = serializers.DecimalField(
        required=False,
        max_digits=19,
        decimal_places=4,
        allow_null=True,
        default=0,
    )
    # Numéro du chèque, du virement ou de la traite selon le mode
    numero_cheque = serializers.CharField(
        max_length=50, required=False, default="", allow_null=True
    )
    reference_encaissement = serializers.CharField(
        max_length=50, required=False, default="", allow_null=True
    )
    reference_compensation = serializers.CharField(
        max_length=50, required=False, default="", allow_null=True
    )
    motif_compensation = serializers.CharField(
        max_length=255, required=False, default="", allow_null=True, allow_blank=True
    )
    # Espèces : bordereau ; paiement mobile : reçu remis par l'opérateur
    numero_bordereau = serializers.CharField(
        max_length=50, required=False, default="", allow_null=True, allow_blank=True
    )
    numero_recu_operateur = serializers.CharField(
        max_length=50, required=False, default="", allow_null=True, allow_blank=True
    )
    # Réencaissement d'un chèque impayé
    reference_reencaissement = serializers.CharField(
        max_length=100, required=False, default="", allow_null=True, allow_blank=True
    )
    id_cheque_impaye = serializers.IntegerField(required=False, allow_null=True)
    nom_emetteur = serializers.CharField(required=True, max_length=50)
    liste_quittance = serializers.ListField(
        required=True,
        child=EncaissementQuittanceSerializer(),
        min_length=1,
        max_length=100,
    )

    def to_internal_value(self, data):
        if "numero_cheque" in data:
            if data["numero_cheque"] == "":
                data["numero_cheque"] = None
        if "reference_encaissement" in data:
            if data["reference_encaissement"] == "":
                data["reference_encaissement"] = None
        if "reference_compensation" in data:
            if data["reference_compensation"] == "":
                data["reference_compensation"] = None

        return super().to_internal_value(data)

    def create(self, validated_data):
        return EncaissementGroupeQuittance(**validated_data)

    def update(self, instance, validated_data):
        instance.mode_encaissement = validated_data.get(
            "mode_encaissement", instance.mode_encaissement
        )
        instance.date_encaissement = validated_data.get(
            "date_encaissement", instance.date_encaissement
        )
        instance.banque = validated_data.get("banque", instance.banque)
        instance.montant_total = validated_data.get(
            "montant_total", instance.montant_total
        )
        instance.montant_initial_cheque = validated_data.get(
            "montant_initial_cheque", instance.montant_initial_cheque
        )
        instance.numero_cheque = validated_data.get(
            "numero_cheque", instance.numero_cheque
        )
        instance.reference_encaissement = validated_data.get(
            "reference_encaissement", instance.reference_encaissement
        )
        instance.reference_compensation = validated_data.get(
            "reference_compensation", instance.reference_compensation
        )
        instance.nom_emetteur = validated_data.get(
            "nom_emetteur", instance.nom_emetteur
        )
        instance.liste_quittance = validated_data.get(
            "liste_quittance", instance.liste_quittance
        )
        return instance


class EncaissementResponseSerializer(serializers.Serializer):
    id_encaissement = serializers.IntegerField()
    message = serializers.CharField()
    solde_restant_cheque = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False
    )


class ReversementGroupePrimeSerializer(DynamicFieldsSerializer):
    id_reversement = serializers.IntegerField(required=False, allow_null=True)
    compagnie = serializers.IntegerField(required=True)
    mode_reversement = serializers.IntegerField(
        required=False, allow_null=True
    )
    date_reversement = serializers.DateField(
        required=False,
        format="%Y-%m-%d",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        allow_null=True,
    )
    banque = serializers.IntegerField(
        required=False, default=1, allow_null=True
    )
    montant_total = serializers.DecimalField(
        required=True, max_digits=19, decimal_places=4
    )
    numero_cheque = serializers.CharField(
        max_length=20, required=False, default="", allow_null=True
    )
    nom_emetteur = serializers.CharField(
        required=False, max_length=50, default="", allow_null=True
    )
    reference_reversement = serializers.CharField(
        max_length=40, required=False, default="", allow_null=True
    )
    reference_compensation = serializers.CharField(
        max_length=10, required=False, default="", allow_null=True
    )
    liste_encaissement = serializers.ListField(
        required=True,
        child=ReversementPrimeSerializer(),
        min_length=1,
        max_length=100,
    )

    def to_internal_value(self, data):
        for field in [
            "numero_cheque",
            "reference_reversement",
            "reference_compensation",
        ]:
            if field in data and data[field] == "":
                data[field] = None
        return super().to_internal_value(data)

    def create(self, validated_data):
        return ReversementGroupePrime(**validated_data)

    def update(self, instance, validated_data):
        for field, value in validated_data.items():
            setattr(instance, field, value)
        return instance


class ReversementGroupePrimeInsertSerializer(ReversementGroupePrimeSerializer):
    class Meta:
        fields = ["compagnie", "montant_total", "liste_encaissement"]


class ReversementGroupePrimeValidateSerializer(
    ReversementGroupePrimeSerializer
):
    compagnie = None
    montant_total = None
    liste_encaissement = None
    id_reversement = serializers.IntegerField(required=True)
    mode_reversement = serializers.IntegerField(required=True)
    date_reversement = serializers.DateField(
        required=True,
        format="%Y-%m-%d",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
    )
    reference_reversement = serializers.CharField(required=True)

    class Meta:
        fields = [
            "id_reversement",
            "mode_reversement",
            "date_reversement",
            "banque",
            "numero_cheque",
            "nom_emetteur",
            "reference_reversement",
            "reference_compensation",
        ]

    def validate_mode_reversement(self, value):
        """Le décaissement/reversement en espèces vers une compagnie est interdit (exigence OREOLE)."""
        mode = ModeEncaissement.objects.filter(pk=value).first()
        if mode and (mode.abregereglement or "").strip().upper() == "ESP":
            raise serializers.ValidationError(
                "Le décaissement/reversement en espèces n'est pas autorisé. "
                "Veuillez sélectionner un autre mode de règlement."
            )
        return value


class ChangementImmatriculationSerializer(serializers.Serializer):
    date_emission = serializers.DateField(
        required=True,
        format="%Y-%m-%d",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
    )
    date_effet = serializers.DateField(
        required=True,
        format="%Y-%m-%d",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
    )
    id_devis_ancien = serializers.IntegerField(required=True)
    id_devis_detail_ancien = serializers.IntegerField(required=True)
    numero_carte_brune_physique = serializers.CharField(
        required=True, max_length=100
    )
    numero_immatriculation = serializers.CharField(
        required=True, max_length=100
    )
    id_devis = serializers.IntegerField(
        required=False, default=0, allow_null=True
    )
    id_devis_detail = serializers.IntegerField(
        required=False, default=0, allow_null=True
    )
    id_produit = serializers.IntegerField(
        required=False, default=1, allow_null=True
    )
    id_avenant = serializers.IntegerField(
        required=False, default=10, allow_null=True
    )

    def to_internal_value(self, data):
        if "id_devis" in data:
            if not data["id_devis"]:
                data["id_devis"] = 0
        if "id_devis_detail" in data:
            if not data["id_devis_detail"]:
                data["id_devis_detail"] = 0
        if "id_produit" in data:
            if not data["id_produit"]:
                data["id_produit"] = 1
        if "id_avenant" in data:
            if not data["id_avenant"]:
                data["id_avenant"] = 10

        return super().to_internal_value(data)


class AvenantAnlRenSerializer(serializers.Serializer):
    date_emission = serializers.DateField(
        required=False,
        allow_null=True,
        format="%Y-%m-%d",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        default=None,
    )
    date_effet = serializers.DateField(
        required=False,
        allow_null=True,
        format="%Y-%m-%d",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        default=None,
    )

    date_expiration = serializers.DateField(
        required=False,
        allow_null=True,
        format="%Y-%m-%d",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
        default=None,
    )
    id_contrat = serializers.IntegerField()
    id_avenant = serializers.IntegerField()
    motif_annulation = serializers.CharField(
        required=False, allow_null=True, max_length=255, default=""
    )

    def to_internal_value(self, data):
        if "motif_annulation" in data:
            if not data["motif_annulation"]:
                data["motif_annulation"] = ""

        return super().to_internal_value(data)


class AssureIaInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssureIaInfo
        exclude = [
            "id",
        ]


class AssureIaParDevisOuContratSerializer(serializers.ModelSerializer):
    AyantsDroit = serializers.SerializerMethodField()

    def get_AyantsDroit(self, obj):
        AyantsDroit = AyantDroitIa.objects.filter(id_assure=obj.IdAssure)
        if not AyantsDroit:
            return None
        return AyantDroitIaSerializer(AyantsDroit, many=True).data

    class Meta:
        model = AssureIaParDevisOuContrat
        fields = (
            "IdAssure",
            "IdDetail",
            "Nom",
            "Prenoms",
            "AdressePostale",
            "AdresseGeographique",
            "DateNaissance",
            "LieuNaissance",
            "Profession",
            "AyantsDroit",
            "CapitalDeces",
            "CapitalInfirmite",
            "CapitalFraisTraitement",
        )


class GarantieSouscriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = GarantieSouscrite
        exclude = ["id"]

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        idsousgarantie = int(representation["idsousgarantie"])
        if idsousgarantie == 22:
            textecapital = representation["libelleoption"]
        else:
            capital = representation["capital"]
            deces = representation["deces"]
            ipp = representation["ipp"]
            ft = representation["ft"]
            if (
                int(float(deces)) > 0
                or int(float(ipp)) > 0
                or int(float(ft)) > 0
            ):
                textecapital = (
                    "Décès: "
                    + f"{int(float(deces)):,}".replace(",", " ")
                    + ", IPP: "
                    + f"{int(float(ipp)):,}".replace(",", " ")
                    + ", FT: "
                    + f"{int(float(ft)):,}".replace(",", " ")
                )
            else:
                if float(capital) > 0.0:
                    textecapital = f"{int(float(capital)):,}".replace(",", " ")
                else:
                    textecapital = ""
        representation["textecapital"] = textecapital
        return representation


class InfoVehiculeSerializer(serializers.ModelSerializer):
    class Meta:
        model = InfoVehicule
        exclude = [
            "id",
        ]


class AnnulationEncaissementSerializer(serializers.Serializer):
    id_encaissement = serializers.IntegerField()
    date_annulation = serializers.DateField(
        format="%Y-%m-%d",
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
    )
    motif_annulation = serializers.CharField(max_length=60)


class GarantieSerializer(serializers.Serializer):
    """
    Sérialiseur pour la liste des garanties.
    """

    id_devis_detail = serializers.IntegerField(allow_null=True, required=False)
    id_garantie = serializers.IntegerField()
    acquise = serializers.BooleanField()
    capital = serializers.DecimalField(max_digits=19, decimal_places=4)
    prime_annuelle = serializers.DecimalField(max_digits=19, decimal_places=4)
    prime_nette = serializers.DecimalField(max_digits=19, decimal_places=4)
    montant_franchise = serializers.DecimalField(
        max_digits=19, decimal_places=4
    )
    taux_franchise = serializers.DecimalField(max_digits=5, decimal_places=2)
    franchise_minimum = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
    )
    franchise_maximum = serializers.DecimalField(
        max_digits=19, decimal_places=4
    )
    capital_deces = serializers.DecimalField(max_digits=19, decimal_places=4)
    capital_ipp = serializers.DecimalField(max_digits=19, decimal_places=4)
    capital_ft = serializers.DecimalField(max_digits=19, decimal_places=4)
    reduction_commerciale = serializers.DecimalField(
        max_digits=5, decimal_places=2
    )
    reduction_bns = serializers.DecimalField(max_digits=5, decimal_places=2)


# I have modified this on Novembre 5th, 2025
class CorrectionDevisSerializer(serializers.Serializer):
    """
    Sérialiseur pour les données du devis principal.
    """

    id_devis = serializers.IntegerField()
    prime_annuelle = serializers.DecimalField(max_digits=19, decimal_places=4)
    prime_nette = serializers.DecimalField(max_digits=19, decimal_places=4)
    taxe = serializers.DecimalField(
        max_digits=19, decimal_places=4, allow_null=True, required=False
    )
    accessoire = serializers.DecimalField(
        max_digits=19, decimal_places=4, allow_null=True, required=False
    )
    fga = serializers.DecimalField(
        max_digits=19, decimal_places=4, allow_null=True, required=False
    )
    cedeao = serializers.DecimalField(
        max_digits=19, decimal_places=4, allow_null=True, required=False
    )
    prime_ttc = serializers.DecimalField(
        max_digits=19, decimal_places=4, allow_null=True, required=False
    )
    date_emission = serializers.DateField(
        allow_null=True,
        required=False,
        format=cast(Any, "%d-%m-%Y"),
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
    )
    date_effet = serializers.DateField(
        allow_null=True,
        required=False,
        format=cast(Any, "%d-%m-%Y"),
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
    )
    date_expiration = serializers.DateField(
        allow_null=True,
        required=False,
        format=cast(Any, "%d-%m-%Y"),
        input_formats=["%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d"],
    )
    numero_police = serializers.CharField(
        allow_null=True, max_length=50, required=False
    )
    reduction_commerciale = serializers.DecimalField(
        max_digits=5, decimal_places=2, allow_null=True, required=False
    )
    reduction_bns = serializers.DecimalField(
        max_digits=5, decimal_places=2, allow_null=True, required=False
    )
    reduction_flotte = serializers.DecimalField(
        max_digits=5, decimal_places=2, allow_null=True, required=False
    )
    liste_garantie = GarantieSerializer(
        many=True, allow_null=True, required=False
    )
    supprimer_garanties_manquantes = serializers.BooleanField(
        allow_null=True, required=False
    )

    def validate(self, data):
        data = super().validate(data)
        try:
            id_devis_recu = data["id_devis"]
            id_devis = int(id_devis_recu)
            devis = Devis.objects.get(pk=id_devis)
            if devis:
                id_produit = devis.produit.pk
                if id_produit == 1:
                    missing_fields = set(self.fields.keys()) - set(
                        cast(dict, data).keys()
                    )
                    if missing_fields:
                        raise serializers.ValidationError(
                            f"Champs manquants: {list(missing_fields)[0]}"
                        )
                data["id_produit"] = id_produit
        except ValueError:
            message = f"ValueError: Impossible de convertir '{id_devis_recu}' en entier."
            print(message)
            raise serializers.ValidationError(message)
        except TypeError:
            message = f"TypeError: Type '{type(id_devis_recu).__name__}' impossible à convertir en entier."
            print(message)
            raise serializers.ValidationError(message)
        except OverflowError:
            message = f"OverflowError: '{id_devis_recu}' est trop grand pour être converti en entier."
            print(message)
            raise serializers.ValidationError(message)
        except Devis.DoesNotExist:
            message = f"Devis avec ID: '{id_devis_recu}' inexistant."
            print(message)
            raise serializers.ValidationError(message)
        except Exception as e:
            message = f"Erreur inattendue: {e.__class__.__name__} - {e}"
            print(message)
            raise serializers.ValidationError(message)

        return data


class DevisDetailClientSerializer(serializers.ModelSerializer):
    iddevisdetail = serializers.IntegerField(source="pk")
    marque = serializers.CharField(
        source="idmarque.LibelleMarque", max_length=60
    )

    class Meta:
        model = DevisDetail
        fields = ["iddevisdetail", "iddevis", "matricule", "datemec", "marque"]
        read_only_fields = fields


class DevisClientSerializer(serializers.ModelSerializer):
    iddevis = serializers.IntegerField(source="pk")
    nomclient = serializers.CharField(source="client.Nom")
    details = DevisDetailClientSerializer(many=True, read_only=True)

    class Meta:
        model = Devis
        fields = [
            "iddevis",
            "numerodevis",
            "nomclient",
            "dateeffet",
            "dateemission",
            "flotte",
            "details",
        ]
        read_only_fields = fields


class ConsolidationDevisClientSerializer(serializers.Serializer):
    """
    Serializer pour valider le format des données de consolidation.
    """

    iddevis = serializers.IntegerField(min_value=1)

    def validate_iddevis(self, value):
        """
        Validation supplémentaire pour l'ID du devis.
        """
        if value <= 0:
            raise serializers.ValidationError(
                "L'ID du devis doit être positif."
            )
        return value


class PrimeUpdateSerializer(serializers.Serializer):
    """
    Serializer for validating input data for the stored procedure call.
    """

    # CHARACTER VARYING
    numero_devis = serializers.CharField(max_length=255)

    # NUMERIC (Use DecimalField for precision)
    prime_annuelle = serializers.DecimalField(
        max_digits=19, decimal_places=4, allow_null=True, min_value=0
    )
    prime_nette = serializers.DecimalField(
        max_digits=19, decimal_places=4, allow_null=True, min_value=0
    )
    accessoire = serializers.DecimalField(
        max_digits=19, decimal_places=4, allow_null=True, min_value=0
    )
    taxe = serializers.DecimalField(
        max_digits=19, decimal_places=4, allow_null=True, min_value=0
    )
    fga = serializers.DecimalField(
        max_digits=19, decimal_places=4, allow_null=True, min_value=0
    )
    cedeao = serializers.DecimalField(
        max_digits=19, decimal_places=4, allow_null=True, min_value=0
    )
    prime_ttc = serializers.DecimalField(
        max_digits=19, decimal_places=4, allow_null=True, min_value=0
    )


class GarantieVehiculeFlotteSerializer(serializers.Serializer):
    """Une garantie d'un véhicule de flotte, telle que saisie dans « Garanties de l'offre »."""

    id_garantie = serializers.IntegerField(min_value=1)
    prime_annuelle = serializers.DecimalField(max_digits=19, decimal_places=4, min_value=0)
    prime_nette = serializers.DecimalField(max_digits=19, decimal_places=4, min_value=0)
    # None : capital enregistré inchangé (garantie déjà présente sur le véhicule)
    capital = serializers.DecimalField(
        max_digits=19, decimal_places=4, min_value=0, allow_null=True, required=False, default=None
    )


class GarantiesVehiculeFlotteSerializer(serializers.Serializer):
    """Liste complète des garanties d'un véhicule de flotte (remplace celles enregistrées)."""

    id_devis = serializers.IntegerField(min_value=1)
    id_devis_detail = serializers.IntegerField(min_value=1)
    liste_garantie = GarantieVehiculeFlotteSerializer(many=True, allow_empty=False)

    def validate_liste_garantie(self, garanties):
        ids = [g["id_garantie"] for g in garanties]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Une garantie figure deux fois dans la liste.")
        if 1 not in ids:
            raise serializers.ValidationError("La Responsabilité Civile est obligatoire.")
        if 2 in ids:
            raise serializers.ValidationError(
                "Le FGA est calculé sur la Responsabilité Civile : ce n'est pas une garantie à saisir."
            )
        connues = set(
            SousGarantie.objects.filter(pk__in=ids).values_list("pk", flat=True)
        )
        inconnues = sorted(set(ids) - connues)
        if inconnues:
            raise serializers.ValidationError(
                f"Garantie(s) inexistante(s) : {', '.join(str(i) for i in inconnues)}."
            )
        return garanties


"""
Serializers Django REST Framework pour le module MRH
(Multi-Risques Habitation) - NSIA

Organisation :
1. Serializers pour les requêtes de calcul
2. Serializers pour les réponses
3. Serializers pour l'enregistrement dans les modèles legacy
"""


# ============================================================================
# SECTION 1 : SERIALIZERS POUR LES REQUÊTES DE CALCUL
# ============================================================================


class OptionSelectionSerializer(serializers.Serializer):
    """Serializer pour la sélection d'une option"""

    code_option = serializers.CharField(
        max_length=50,
        help_text="Code de l'option (ex: zone_industrielle, presence_gardien)",
    )

    def validate_code_option(self, value):
        """Valide que l'option existe"""
        if not Option.objects.filter(code=value, actif=True).exists():
            raise serializers.ValidationError(
                f"L'option '{value}' n'existe pas ou est inactive."
            )
        return value


class SousGarantieOptionnelleSelectionSerializer(serializers.Serializer):
    """Serializer pour la sélection d'une sous-garantie optionnelle"""

    code_sous_garantie = serializers.CharField(
        max_length=50,
        help_text="Code de la sous-garantie optionnelle (ex: RC_MEMBRE, LOISIRS)",
    )

    def validate_code_sous_garantie(self, value):
        """Valide que la sous-garantie optionnelle existe"""
        if not SousGarantieMRH.objects.filter(
            code=value, type="OPTIONNELLE", actif=True
        ).exists():
            raise serializers.ValidationError(
                f"La sous-garantie optionnelle '{value}' n'existe pas ou est inactive."
            )
        return value


class RepartitionManuelleItemSerializer(serializers.Serializer):
    """Un item de répartition manuelle : code garantie + montant."""

    code_sous_garantie = serializers.CharField(max_length=50)
    montant = serializers.DecimalField(
        max_digits=19, decimal_places=2, min_value=0
    )


class MaisonCalculRequestSerializer(serializers.Serializer):
    """
    Serializer pour la requête de calcul d'une maison.
    Contient tous les paramètres nécessaires au calcul de la prime.
    """

    # Identifiant de l'usage
    code_usage = serializers.CharField(
        max_length=50,
        help_text="Code de l'usage habitation (ex: proprietaire_occupant_total)",
    )
    id_tarif = serializers.IntegerField(help_text="ID du tarif")

    id_offre = serializers.IntegerField(help_text="ID de l'offre")

    # Paramètres de calcul (optionnels selon l'usage)
    valeur_batiment = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Valeur du bâtiment en FCFA",
    )

    valeur_contenu = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Valeur du contenu/mobilier en FCFA",
    )

    loyer_mensuel = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Loyer mensuel en FCFA",
    )

    capital_rvt = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Capital RVT (Recours des Voisins et Tiers) en FCFA",
    )

    # Options sélectionnées
    options = OptionSelectionSerializer(
        many=True,
        required=False,
        default=list,
        help_text="Liste des options sélectionnées",
    )

    # Sous-Garanties optionnelles sélectionnées
    sous_garanties_optionnelles = SousGarantieOptionnelleSelectionSerializer(
        many=True,
        required=False,
        default=list,
        help_text="Liste des sous-garanties optionnelles sélectionnées",
    )

    # Informations supplémentaires (pour enregistrement dans DevisDetail)
    adresse = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        help_text="Adresse de la maison",
    )

    description = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Description supplémentaire",
    )

    repartition_manuelle = RepartitionManuelleItemSerializer(
        many=True,
        required=False,
        default=list,
        help_text=(
            "Répartition manuelle des primes par garantie. "
            "Les garanties non listées reçoivent le reliquat automatiquement."
        ),
    )

    def validate_code_usage(self, value):
        """Valide que l'usage existe"""
        if not UsageHabitation.objects.filter(code=value, actif=True).exists():
            raise serializers.ValidationError(
                f"L'usage '{value}' n'existe pas ou est inactif."
            )
        return value

    def validate(self, data):
        """
        Validation globale : vérifie que les paramètres requis sont fournis
        selon l'usage sélectionné.
        """
        code_usage = data.get("code_usage")

        try:
            usage = UsageHabitation.objects.get(code=code_usage, actif=True)
            params = usage.parametres
        except (UsageHabitation.DoesNotExist, ParametresCalcul.DoesNotExist):
            raise serializers.ValidationError(
                f"Paramètres de calcul non trouvés pour l'usage '{code_usage}'."
            )

        # Vérification des paramètres requis
        errors = {}

        if params.param_valeur_batiment_requis and not data.get(
            "valeur_batiment"
        ):
            errors["valeur_batiment"] = (
                "La valeur du bâtiment est requise pour cet usage."
            )

        if params.param_valeur_contenu_requis and not data.get(
            "valeur_contenu"
        ):
            errors["valeur_contenu"] = (
                "La valeur du contenu est requise pour cet usage."
            )

        if params.param_loyer_requis and not data.get("loyer_mensuel"):
            errors["loyer_mensuel"] = (
                "Le loyer mensuel est requis pour cet usage."
            )

        if params.param_capital_rvt_requis and not data.get("capital_rvt"):
            errors["capital_rvt"] = "Le capital RVT est requis pour cet usage."

        if errors:
            raise serializers.ValidationError(errors)

        # Vérification que les options sont applicables à cet usage
        options = data.get("options", [])
        for opt in options:
            code_option = opt["code_option"]
            if not OptionUsage.objects.filter(
                option__code=code_option, usage__code=code_usage, actif=True
            ).exists():
                raise serializers.ValidationError(
                    {
                        "options": f"L'option '{code_option}' n'est pas applicable à l'usage '{code_usage}'."
                    }
                )

        # Vérification que les garanties optionnelles sont disponibles pour cet usage
        sous_garanties_opt = data.get("sous_garanties_optionnelles", [])
        for gar in sous_garanties_opt:
            code_sous_garantie = gar["code_sous_garantie"]
            if not SousGarantieUsage.objects.filter(
                sous_garantie__code=code_sous_garantie,
                usage__code=code_usage,
                obligatoire=False,
                actif=True,
            ).exists():
                raise serializers.ValidationError(
                    {
                        "sous_garanties_optionnelles": f"La garantie '{code_sous_garantie}' n'est pas disponible pour l'usage '{code_usage}'."
                    }
                )

        return data


class DevisMRHCreateRequestSerializer(serializers.Serializer):
    """
    Serializer pour la création d'un devis MRH vide.
    Contient les informations de base du devis.
    """

    # Relations obligatoires (ForeignKeys)
    idintermediaire = serializers.IntegerField(
        required=True, help_text="ID de l'intermédiaire"
    )

    idcompagnie = serializers.IntegerField(
        required=True, help_text="ID de la compagnie"
    )

    idproduit = serializers.IntegerField(
        required=True, help_text="ID du produit MRH"
    )
    idavenant = serializers.IntegerField(
        required=False, allow_null=True, help_text="ID de l'avenant"
    )
    idtarif = serializers.IntegerField(
        required=True, help_text="ID du tarif MRH choisi"
    )

    idoffre = serializers.IntegerField(
        required=True, help_text="ID de l'offre"
    )

    idclient = serializers.IntegerField(
        required=True, help_text="ID du client (souscripteur)"
    )

    idassure = serializers.IntegerField(
        required=False, help_text="ID de l'assuré (si différent du client)"
    )

    # Dates
    dateeffet = serializers.DateTimeField(
        required=True, help_text="Date d'effet du contrat"
    )

    dateemission = serializers.DateTimeField(
        required=False,
        allow_null=True,
        help_text="Date d'émission (positionnée automatiquement si non fournie)",
    )
    dateexpiration = serializers.DateTimeField(
        required=False,
        allow_null=True,
        help_text="Date d'expiration (calculée automatiquement si non fournie)",
    )

    # Durée et périodicité
    idduree = serializers.IntegerField(
        required=False,
        default=1,
        help_text="ID de la durée (1=12 mois par défaut)",
    )

    idterme = serializers.IntegerField(
        required=False, default=1, help_text="ID du terme de paiement"
    )

    periode = serializers.CharField(
        max_length=1,
        required=False,
        default="A",
        help_text="Période de facturation (A=Annuelle, S=Semestrielle, etc.)",
    )

    # Informations complémentaires
    referenceagent = serializers.CharField(
        max_length=50,
        required=False,
        default="",
        allow_blank=True,
        help_text="Référence de l'agent",
    )

    observation = serializers.CharField(
        max_length=50,
        required=False,
        default="",
        allow_blank=True,
        help_text="Observations sur le devis",
    )

    # Booléens
    flotte = serializers.BooleanField(
        required=False,
        default=False,
        help_text="Flotte (toujours False pour MRH)",
    )

    coassurance = serializers.BooleanField(
        required=False, default=False, help_text="Coassurance"
    )

    renouvelable = serializers.BooleanField(
        required=False, default=True, help_text="Contrat renouvelable"
    )

    confirme = serializers.BooleanField(
        required=False, default=False, help_text="Devis confirmé"
    )

    # Mode imposé
    prime_imposee = serializers.BooleanField(
        required=False, default=False, help_text="Prime imposée (mode imposé)"
    )

    numeropolicecompagnie = serializers.CharField(
        max_length=60,
        required=False,
        default="",
        allow_blank=True,
        help_text="Numéro de police affecté par la compagnie",
    )
    numerotelephoneassure = serializers.CharField(
        max_length=20,
        required=False,
        default="",
        allow_blank=True,
        help_text="Numéro de téléphone de l'assuré",
    )

    def validate(self, data):
        """Validation globale"""
        # Si dateexpiration n'est pas fournie, elle sera calculée selon la durée
        if "dateexpiration" not in data or data["dateexpiration"] is None:
            # La date d'expiration sera calculée côté service/view
            pass
        else:
            # Vérifier que dateexpiration >= dateeffet
            if data["dateexpiration"] < data["dateeffet"]:
                raise serializers.ValidationError(
                    {
                        "dateexpiration": "La date d'expiration doit être >= à la date d'effet"
                    }
                )

        return data


class MaisonAjoutRequestSerializer(serializers.Serializer):
    """
    Serializer pour ajouter une maison à un devis existant.
    Combine les données de calcul avec l'ID du devis.
    """

    maison = MaisonCalculRequestSerializer(
        help_text="Données de la maison à ajouter"
    )


# ============================================================================
# SECTION 2 : SERIALIZERS POUR LES RÉPONSES
# ============================================================================


class SousGarantieCalculeeSerializer(serializers.Serializer):
    """Serializer pour une garantie calculée (dans la réponse)"""

    code_sous_garantie = serializers.CharField()
    libelle_sous_garantie = serializers.CharField()
    code_sous_garantie_std = serializers.CharField(allow_null=True)
    id_sous_garantie_std = serializers.IntegerField(allow_null=True)
    type_garantie = serializers.ChoiceField(
        choices=["OBLIGATOIRE", "OPTIONNELLE"]
    )
    prime_nette = serializers.DecimalField(max_digits=12, decimal_places=2)
    taux_taxe = serializers.DecimalField(max_digits=5, decimal_places=2)
    taxe = serializers.DecimalField(max_digits=12, decimal_places=2)
    prime_ttc = serializers.DecimalField(max_digits=12, decimal_places=2)
    taux_repartition = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        allow_null=True,
        help_text="Taux de répartition (pour garanties obligatoires uniquement)",
    )


class OptionAppliqueeSerializer(serializers.Serializer):
    """Serializer pour une option appliquée (dans la réponse)"""

    code_option = serializers.CharField()
    libelle_option = serializers.CharField()
    type_option = serializers.CharField()
    type_ajustement = serializers.CharField()
    sous_garantie_cible = serializers.CharField()
    sous_garantie_cible_libelle = serializers.CharField()
    montant_ajustement = serializers.DecimalField(
        max_digits=12, decimal_places=2
    )
    signe = serializers.CharField()


class MaisonCalculeeSerializer(serializers.Serializer):
    """Serializer pour le résultat du calcul d'une maison"""

    # Identifiant temporaire (avant enregistrement)
    maison_id = serializers.CharField(required=False, allow_null=True)

    # Informations de base
    code_usage = serializers.CharField()
    libelle_usage = serializers.CharField()

    # Paramètres utilisés
    parametres = serializers.DictField(
        help_text="Paramètres utilisés pour le calcul (valeur_batiment, valeur_contenu, etc.)"
    )

    # Résultats du calcul
    prime_annuelle_totale = serializers.DecimalField(
        max_digits=19, decimal_places=4
    )
    prime_nette_totale = serializers.DecimalField(
        max_digits=19, decimal_places=4
    )
    taxe_totale = serializers.DecimalField(max_digits=19, decimal_places=4)
    prime_ttc_totale = serializers.DecimalField(
        max_digits=19, decimal_places=4
    )  # prime_ttc_totale

    # Détails
    sous_garanties = SousGarantieCalculeeSerializer(many=True)
    options_appliquees = OptionAppliqueeSerializer(many=True, required=False)

    # Informations supplémentaires
    adresse = serializers.CharField(required=False, allow_blank=True)
    description = serializers.CharField(required=False, allow_blank=True)


class DevisMRHCalculeResponseSerializer(serializers.Serializer):
    """Serializer pour la réponse complète du calcul d'un devis"""

    devis_id = serializers.IntegerField(help_text="ID du devis")
    statut = serializers.CharField(
        help_text="Statut du calcul (success, error)"
    )
    message = serializers.CharField(required=False)

    # Totaux du devis
    prime_nette_totale = serializers.DecimalField(
        max_digits=19, decimal_places=4
    )
    taxe_totale = serializers.DecimalField(max_digits=19, decimal_places=4)
    accessoires = serializers.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0")
    )
    prime_ttc_totale = serializers.DecimalField(
        max_digits=19, decimal_places=4
    )  # prime_ttc_totale

    # Détails par maison
    maisons = MaisonCalculeeSerializer(many=True)

    # Métadonnées
    nombre_maisons = serializers.IntegerField()
    date_calcul = serializers.DateTimeField()


class DevisMRHResponseSerializer(serializers.Serializer):
    """Serializer pour la réponse de création d'un devis"""

    devis_id = serializers.IntegerField()
    numero_devis = serializers.CharField(required=False)
    statut = serializers.CharField()
    message = serializers.CharField()
    date_creation = serializers.DateTimeField()


class MaisonAjouteeResponseSerializer(serializers.Serializer):
    """Serializer pour la réponse d'ajout d'une maison"""

    devis_id = serializers.IntegerField()
    maison_id = serializers.IntegerField()
    statut = serializers.CharField()
    message = serializers.CharField()
    calcul = MaisonCalculeeSerializer(required=False)


# ============================================================================
# SECTION 3 : SERIALIZERS POUR LES MODÈLES LEGACY (ENREGISTREMENT)
# ============================================================================


class DevisDetailCreateSerializer(serializers.Serializer):
    """
    Serializer pour créer un DevisDetail.
    Adapté au modèle legacy automobile - utilisé pour stocker une maison MRH.

    Note: Le modèle DevisDetail a été conçu pour l'automobile, donc certains champs
    ne sont pas pertinents pour MRH mais doivent être remplis avec des valeurs par défaut.
    """

    # Relation avec Devis
    iddevis = serializers.IntegerField(help_text="ID du devis parent")

    # Champs obligatoires (avec valeurs par défaut pour MRH)
    idoffre = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="ID de l'offre (peut être NULL pour MRH)",
    )

    idtarif = serializers.IntegerField(
        required=False,
        default=0,
        help_text="ID du tarif (0 par défaut pour MRH)",
    )

    vehicule = serializers.IntegerField(
        required=False,
        default=0,
        help_text="ID véhicule (0 pour MRH - champ legacy)",
    )

    # Montants calculés pour MRH
    primenette = serializers.DecimalField(
        max_digits=19, decimal_places=4, help_text="Prime nette de la maison"
    )

    taxeenregistrement = serializers.DecimalField(
        max_digits=19, decimal_places=4, help_text="Taxe totale de la maison"
    )

    primeannuelle = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        help_text="Prime TTC de la maison (primenette + taxeenregistrement)",
    )

    # Champs utilisables pour stocker des infos MRH
    observation = serializers.CharField(
        max_length=50,
        required=False,
        default="",
        allow_blank=True,
        help_text="Observations - peut contenir l'usage MRH ou l'adresse (tronquée)",
    )

    # Champs avec valeurs par défaut pour compatibilité
    nombreplace = serializers.IntegerField(
        required=False, default=0, help_text="Nombre de places (0 pour MRH)"
    )

    chargeutile = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        help_text="Charge utile (0 pour MRH)",
    )

    valeurneuve = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        help_text="Valeur neuve (peut stocker valeur_batiment pour MRH)",
    )

    valeurvenale = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        help_text="Valeur vénale (peut stocker valeur_contenu pour MRH)",
    )

    valeuraccessoire = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        help_text="Valeur accessoire (0 pour MRH)",
    )

    fga = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        help_text="FGA (0 pour MRH)",
    )

    # Booléens
    remorque = serializers.BooleanField(required=False, default=False)

    extincteur = serializers.BooleanField(required=False, default=False)

    provisoire = serializers.BooleanField(required=False, default=False)

    carteverte = serializers.BooleanField(required=False, default=False)

    # Champs texte avec valeurs par défaut
    matricule = serializers.CharField(
        max_length=50,
        required=False,
        default="MRH",
        help_text="Matricule (MRH par défaut)",
    )

    typeimmat = serializers.CharField(
        max_length=1, required=False, default="M"
    )

    attestation = serializers.CharField(
        max_length=50, required=False, default=""
    )

    def validate(self, data):
        """Validation et calcul de primeannuelle si nécessaire"""
        # Assurer que primeannuelle = primenette + taxeenregistrement
        if "primenette" in data and "taxeenregistrement" in data:
            data["primeannuelle"] = (
                data["primenette"] + data["taxeenregistrement"]
            )

        return data


class DevisMRHDetGarantieCreateSerializer(serializers.Serializer):
    """
    Serializer pour créer un DevisDetGarantie.
    Enregistre les garanties MRH avec leurs primes.
    """

    # Relations
    IdDevisDet = serializers.IntegerField(
        help_text="ID du DevisDetail (maison) parent"
    )

    IdGarantie = serializers.IntegerField(
        help_text="ID de la garantie dans stdgarantie (obtenu via GarantieMRH.get_id_garantie_std())"
    )

    # Statut
    Acquise = serializers.BooleanField(
        default=True,
        help_text="Garantie acquise (toujours True pour garanties obligatoires)",
    )

    # Capital et franchise (pour MRH, peuvent être NULL)
    Capital = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Capital assuré pour cette garantie (optionnel pour MRH)",
    )

    Franchise = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Franchise applicable (optionnel pour MRH)",
    )

    TexteFranchise = serializers.CharField(
        max_length=120,
        required=False,
        allow_null=True,
        allow_blank=True,
        help_text="Description de la franchise",
    )

    Formule = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Formule (non utilisé pour MRH)",
    )

    # Montants calculés (champs principaux)
    PrimeNette = serializers.DecimalField(
        max_digits=19, decimal_places=4, help_text="Prime nette de la garantie"
    )

    taxe = serializers.DecimalField(
        max_digits=19, decimal_places=4, help_text="Taxe sur la garantie"
    )

    primeannuelle = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        help_text="Prime TTC de la garantie (PrimeNette + taxe)",
    )

    # Champs old_ (pour historique - valeurs par défaut)
    old_acquise = serializers.CharField(
        max_length=1, required=False, default="0"
    )

    old_capital = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        allow_null=True,
    )

    old_franchise = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        allow_null=True,
    )

    old_formule = serializers.IntegerField(required=False, allow_null=True)

    old_places = serializers.IntegerField(required=False, allow_null=True)

    old_primenette = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False, default=0
    )

    # Champs spécifiques (non utilisés pour MRH - valeurs par défaut)
    deces = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False, allow_null=True
    )

    ipp = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False, allow_null=True
    )

    fraismed = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False, allow_null=True
    )

    hosp = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False, allow_null=True
    )

    minfranchise = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False, default=0
    )

    maxfranchise = serializers.DecimalField(
        max_digits=19, decimal_places=4, required=False, default=0
    )

    def validate(self, data):
        """Validation et calcul de primeannuelle si nécessaire"""
        # Assurer que primeannuelle = PrimeNette + taxe
        if "PrimeNette" in data and "taxe" in data:
            data["primeannuelle"] = data["PrimeNette"] + data["taxe"]

        return data


# ============================================================================
# SERIALIZERS UTILITAIRES
# ============================================================================


class DevisUpdateTotauxSerializer(serializers.Serializer):
    """
    Serializer pour mettre à jour les totaux d'un devis après calcul.
    Utilisé pour mettre à jour le modèle Devis avec les montants consolidés.
    """

    primenette = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        help_text="Prime nette totale (somme de toutes les maisons)",
    )

    taxe = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        help_text="Taxe totale (somme de toutes les maisons)",
    )

    accessoire = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        help_text="Accessoires (frais de dossier, etc.)",
    )

    primeannuelle = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        help_text="Prime annuelle (primenette + taxe + accessoire avant FGA et CEDEAO)",
    )

    fga = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        help_text="FGA (Fonds de Garantie Automobile - 0 pour MRH)",
    )

    cedeao = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        help_text="Taxe CEDEAO - 0 pour MRH)",
    )

    primettc = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        help_text="Prime TTC finale (primenette + taxe + accessoire)",
    )


class AccessoiresConfigSerializer(serializers.Serializer):
    """
    Serializer pour configurer les accessoires (frais de dossier, etc.)
    Ces montants peuvent être ajoutés au devis.
    """

    accessoire = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        default=0,
        help_text="Montant total des accessoires",
    )

    accessoirecompagnie = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        help_text="Part compagnie des accessoires",
    )

    accessoireintermediaire = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        help_text="Part intermédiaire des accessoires",
    )

    accessoiregestionnaire = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        default=0,
        help_text="Part gestionnaire des accessoires",
    )

    def validate(self, data):
        """Vérifier que la somme des parts = accessoire total"""
        total = data.get("accessoire", 0)
        somme_parts = (
            data.get("accessoirecompagnie", 0)
            + data.get("accessoireintermediaire", 0)
            + data.get("accessoiregestionnaire", 0)
        )

        if total > 0 and abs(total - somme_parts) > 0.01:  # Tolérance de 0.01
            raise serializers.ValidationError(
                "La somme des parts d'accessoires doit être égale au montant total des accessoires"
            )

        return data


class UsageInfoDetailSerializer(serializers.Serializer):
    """
    Serializer pour obtenir les informations détaillées d'un usage.
    Utile pour l'endpoint GET /usages/{code}/
    """

    from configuration_api.serializers import (
        OptionSerializer,
        SousGarantieMRHSerializer,
    )

    code = serializers.CharField()
    libelle = serializers.CharField()
    description = serializers.CharField()
    formule = serializers.CharField()

    parametres_requis = serializers.DictField()
    coefficients = serializers.DictField()

    sous_garanties_obligatoires = SousGarantieMRHSerializer(many=True)
    sous_garanties_optionnelles = SousGarantieMRHSerializer(many=True)
    options_disponibles = OptionSerializer(many=True)


class StatutDevisSerializer(serializers.Serializer):
    """Serializer pour mettre à jour le statut d'un devis"""

    statut = serializers.ChoiceField(
        choices=[
            ("ACTIF", "Actif"),
            ("CONFIRME", "Confirmé"),
            ("ANNULE", "Annulé"),
            ("EXPIRE", "Expiré"),
        ],
        help_text="Nouveau statut du devis",
    )

    motifannulation = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        help_text="Motif d'annulation (requis si statut=ANNULE)",
    )

    def validate(self, data):
        """Vérifier que le motif est fourni pour une annulation"""
        if data.get("statut") == "ANNULE" and not data.get("motifannulation"):
            raise serializers.ValidationError(
                {
                    "motifannulation": "Le motif d'annulation est requis pour annuler un devis"
                }
            )
        return data


class ErrorSerializer(serializers.Serializer):
    """Serializer standard pour les erreurs"""

    erreur = serializers.CharField()
    details = serializers.DictField(required=False)
    code = serializers.CharField(required=False)


class MaisonStorageDataSerializer(serializers.Serializer):
    """
    Serializer pour stocker les données MRH d'une maison en JSON.
    Ces données peuvent être stockées dans un champ JSON de DevisDetail ou dans une table séparée.
    """

    code_usage = serializers.CharField()
    libelle_usage = serializers.CharField()

    # Paramètres de calcul utilisés
    valeur_batiment = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )

    valeur_contenu = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )

    loyer_mensuel = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True
    )

    capital_rvt = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )

    # Options et garanties optionnelles sélectionnées
    options_selectionnees = serializers.ListField(
        child=serializers.CharField(), required=False, default=list
    )

    sous_garanties_optionnelles_selectionnees = serializers.ListField(
        child=serializers.CharField(), required=False, default=list
    )

    # Informations supplémentaires
    adresse = serializers.CharField(required=False, allow_blank=True)
    description = serializers.CharField(required=False, allow_blank=True)


# ============================================================================
# VALIDATION HELPERS
# ============================================================================


def validate_decimal_positive(value: Decimal, field_name: str) -> Decimal:
    """Helper pour valider qu'un Decimal est positif"""
    if value is not None and value <= 0:
        raise serializers.ValidationError(
            {field_name: f"{field_name} doit être strictement positif."}
        )
    return value


"""
Serializers pour le résumé financier des devis MRH
===================================================
"""


class GarantieAcquiseSerializer(serializers.Serializer):
    """
    Serializer pour une garantie acquise avec ses montants.
    """

    id_maison = serializers.IntegerField(
        help_text="ID du DevisDetail (maison) auquel appartient cette garantie"
    )
    id_sous_garantie = serializers.IntegerField(
        help_text="ID de la garantie dans stdgarantie"
    )
    code_sous_garantie = serializers.CharField(
        max_length=50, help_text="Code de la garantie"
    )
    libelle_sous_garantie = serializers.CharField(
        max_length=200, help_text="Libellé de la garantie"
    )
    capital = serializers.DecimalField(
        max_digits=19,
        decimal_places=2,
        required=False,
        allow_null=True,
        help_text="Capital assuré de la garantie (en FCFA)",
    )
    franchise = serializers.DecimalField(
        max_digits=19,
        decimal_places=2,
        required=False,
        allow_null=True,
        help_text="Franchise de la garantie (en FCFA)",
    )
    minfranchise = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Franchise minimum",
    )
    maxfranchise = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Franchise maximum",
    )
    tauxfranchise = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        required=False,
        allow_null=True,
        help_text="Taux de franchise (%)",
    )
    prime_nette = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Prime nette de la garantie (en FCFA)",
    )
    taxe = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Taxe sur la garantie (en FCFA)",
    )
    prime_ttc = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Prime TTC de la garantie (en FCFA)",
    )


class PalierAccessoireSerializer(serializers.Serializer):
    """
    Serializer pour les informations du palier d'accessoire.
    """

    id = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="ID du palier dans stdaccessoire",
    )
    primemin = serializers.FloatField(
        required=False, allow_null=True, help_text="Prime minimum du palier"
    )
    primemax = serializers.FloatField(
        required=False, allow_null=True, help_text="Prime maximum du palier"
    )
    accessoires = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Montant accessoire du palier",
    )
    montantforfait = serializers.FloatField(
        required=False, allow_null=True, help_text="Montant forfait du palier"
    )


class AccessoireDetailsSerializer(serializers.Serializer):
    """
    Serializer pour les détails de l'accessoire.
    """

    accessoire = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Montant de l'accessoire HT (en FCFA)",
    )
    taxe_accessoire = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Taxe sur l'accessoire 14.5% (en FCFA)",
    )
    accessoire_ttc = serializers.DecimalField(
        max_digits=15, decimal_places=2, help_text="Accessoire TTC (en FCFA)"
    )
    palier = PalierAccessoireSerializer(
        required=False,
        allow_null=True,
        help_text="Informations sur le palier appliqué",
    )


class StatistiquesDevisSerializer(serializers.Serializer):
    """
    Serializer pour les statistiques du devis.
    """

    nombre_maisons = serializers.IntegerField(
        help_text="Nombre de maisons assurées dans le devis"
    )
    nombre_sous_garanties_total = serializers.IntegerField(
        help_text="Nombre total de garanties (acquises + non acquises)"
    )
    nombre_sous_garanties_acquises = serializers.IntegerField(
        help_text="Nombre de garanties acquises"
    )


class ResumeFinancierDevisSerializer(serializers.Serializer):
    """
    Serializer pour le résumé financier complet d'un devis MRH.

    Ce serializer retourne tous les montants financiers d'un devis :
    - Prime nette totale (après options)
    - Prime annuelle (avant options)
    - Accessoires
    - Taxes (garanties + accessoire)
    - Prime TTC
    - Liste des garanties acquises
    """

    # Identifiants
    id_devis = serializers.IntegerField(help_text="ID du devis")
    numero_devis = serializers.CharField(
        max_length=100,
        allow_blank=True,
        allow_null=True,
        help_text="Numéro du devis",
    )

    # Montants principaux (en FCFA)
    prime_nette_totale = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text=(
            "Prime nette totale APRÈS application des options. "
            "C'est la somme des primes nettes de toutes les garanties "
            "de toutes les maisons après options."
        ),
    )

    prime_annuelle = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text=(
            "Prime annuelle AVANT application des options. "
            "NOTE : Actuellement identique à prime_nette_totale car les options "
            "ne sont pas stockées séparément."
        ),
    )

    accessoire = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text=(
            "Montant de l'accessoire calculé selon les paliers définis "
            "dans stdaccessoire (en FCFA)"
        ),
    )

    taxe_totale = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text=("Taxe totale = taxe_garanties + taxe_accessoire (en FCFA)"),
    )

    prime_ttc = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text=(
            "Prime TTC = prime_nette_totale + taxe_totale + accessoire (en FCFA)"
        ),
    )

    # Détails des taxes
    taxe_sous_garanties = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Somme des taxes sur toutes les garanties (en FCFA)",
    )

    taxe_accessoire = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Taxe sur l'accessoire 14.5% (en FCFA)",
    )

    # Détails accessoire
    accessoire_details = AccessoireDetailsSerializer(
        help_text="Détails complets de l'accessoire avec palier"
    )

    # Statistiques
    statistiques = StatistiquesDevisSerializer(
        help_text="Statistiques sur le devis"
    )

    # Liste des garanties acquises
    sous_garanties_acquises = GarantieAcquiseSerializer(
        many=True, help_text="Liste de toutes les garanties acquises du devis"
    )

    # Note explicative
    note = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Note explicative sur les calculs",
    )

    class Meta:
        # Ordre d'affichage des champs
        fields = [
            "id_devis",
            "numero_devis",
            "prime_nette_totale",
            "prime_annuelle",
            "accessoire",
            "taxe_totale",
            "prime_ttc",
            "taxe_sous_garanties",
            "taxe_accessoire",
            "accessoire_details",
            "statistiques",
            "sous_garanties_acquises",
            "note",
        ]


class ChequeOperationSerializer(serializers.ModelSerializer):
    nom_utilisateur = serializers.ReadOnlyField(source="utilisateur.email")

    class Meta:
        model = ChequeOperation
        fields = [
            "id_operation",
            "id_encaissement",
            "nom_utilisateur",
            "montant_operation",
            "date_operation",
            "date_saisie",
        ]


class ChequeSerializer(serializers.ModelSerializer):
    nom_banque = serializers.ReadOnlyField(source="banque.libelle")

    class Meta:
        model = Cheque
        fields = [
            "id_cheque",
            "numero_cheque",
            "banque",
            "nom_banque",
            "montant_initial",
            "solde_disponible",
            "date_saisie",
        ]


class ChequeListeSerializer(ChequeSerializer):
    """
    Chèque du portefeuille, avec les annotations de ChequeListView.

    Échéancier : un chèque « à déposer » est signalé un mois avant sa date de dépôt
    (ALERTE), rappelé quinze jours après cette alerte (RAPPEL), puis ECHU si la date
    est passée sans dépôt.
    """

    nombre_operations = serializers.IntegerField(read_only=True)
    quittances_reglees = serializers.CharField(read_only=True, allow_null=True)
    clients = serializers.CharField(read_only=True, allow_null=True)
    montant_reencaisse = serializers.DecimalField(
        max_digits=19, decimal_places=4, read_only=True, allow_null=True
    )
    statut_libelle = serializers.CharField(source="get_statut_display", read_only=True)
    client_nom = serializers.SerializerMethodField()
    date_alerte = serializers.SerializerMethodField()
    date_rappel = serializers.SerializerMethodField()
    niveau_alerte = serializers.SerializerMethodField()

    class Meta(ChequeSerializer.Meta):
        fields = ChequeSerializer.Meta.fields + [
            "nombre_operations",
            "quittances_reglees",
            "clients",
            "statut",
            "statut_libelle",
            "client",
            "client_nom",
            "date_echeance",
            "date_depot",
            "observation",
            "motif_decaissement",
            "date_decaissement",
            "montant_impaye",
            "montant_reencaisse",
            "date_alerte",
            "date_rappel",
            "niveau_alerte",
        ]

    def get_client_nom(self, obj):
        if obj.client_id:
            return f"{obj.client.Nom or ''} {obj.client.Prenoms or ''}".strip()
        return getattr(obj, "clients", None)

    @staticmethod
    def _dates_alerte(obj):
        if obj.statut != Cheque.Statut.A_DEPOSER or not obj.date_echeance:
            return None
        alerte = obj.date_echeance - relativedelta(months=1)
        return alerte, alerte + timedelta(days=15)

    def get_date_alerte(self, obj):
        dates = self._dates_alerte(obj)
        return dates[0] if dates else None

    def get_date_rappel(self, obj):
        dates = self._dates_alerte(obj)
        return dates[1] if dates else None

    def get_niveau_alerte(self, obj):
        dates = self._dates_alerte(obj)
        if not dates:
            return None
        aujourdhui = timezone.localdate()
        if aujourdhui > obj.date_echeance:
            return "ECHU"
        if aujourdhui >= dates[1]:
            return "RAPPEL"
        if aujourdhui >= dates[0]:
            return "ALERTE"
        return None


class EcheancierChequeLigneSerializer(serializers.Serializer):
    numero_cheque = serializers.CharField(max_length=50)
    montant = serializers.DecimalField(max_digits=19, decimal_places=4, min_value=1)
    date_echeance = serializers.DateField(
        input_formats=["%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"]
    )


class EcheancierChequesSerializer(serializers.Serializer):
    """Chèques remis d'avance par un client, chacun avec sa date de dépôt."""

    id_client = serializers.IntegerField()
    id_banque = serializers.IntegerField()
    observation = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default=""
    )
    cheques = EcheancierChequeLigneSerializer(many=True, allow_empty=False)


class DecaissementChequeSerializer(serializers.Serializer):
    """Chèque revenu impayé : motif et date du décaissement."""

    motif = serializers.CharField(max_length=255)
    date_decaissement = serializers.DateField(
        required=False, input_formats=["%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"]
    )


"""
Serializers pour modification de maison et imposition de prime
===============================================================
"""


class MaisonModificationRequestSerializer(serializers.Serializer):
    """
    Serializer pour la requête de modification d'une maison.
    """

    code_usage = serializers.CharField(
        max_length=100,
        required=False,
        allow_null=True,
        help_text="Code de l'usage habitation",
    )

    valeur_batiment = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Valeur du bâtiment en FCFA",
    )

    valeur_contenu = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Valeur du contenu en FCFA",
    )

    loyer_mensuel = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Loyer mensuel en FCFA",
    )

    capital_rvt = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Capital RVT en FCFA",
    )

    options = serializers.ListField(
        child=serializers.CharField(max_length=100),
        required=False,
        allow_null=True,
        help_text="Liste des codes d'options",
    )

    sous_garanties_optionnelles = serializers.ListField(
        child=serializers.CharField(max_length=100),
        required=False,
        allow_null=True,
        help_text="Liste des codes de sous_garanties optionnelles",
    )

    adresse = serializers.CharField(
        max_length=500,
        required=False,
        allow_null=True,
        allow_blank=True,
        help_text="Adresse de la maison",
    )

    description = serializers.CharField(
        max_length=1000,
        required=False,
        allow_null=True,
        allow_blank=True,
        help_text="Description supplémentaire",
    )

    force_recalcul = serializers.BooleanField(
        default=False,
        required=False,
        help_text="Forcer le recalcul même si prime imposée",
    )


class ImpositionPrimeMaisonRequestSerializer(serializers.Serializer):
    """
    Serializer pour la requête d'imposition de prime maison.
    """

    montant_impose = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        min_value=Decimal("0.01"),
        help_text="Montant de la prime NETTE à imposer (en FCFA)",
    )

    motif = serializers.CharField(
        max_length=1000,
        required=False,
        allow_blank=True,
        help_text="Raison de l'imposition de la prime",
    )


class RepartitionMaisonImpositionSerializer(serializers.Serializer):
    id_maison = serializers.IntegerField()
    montant = serializers.DecimalField(max_digits=19, decimal_places=2, min_value=0)


class ImpositionPrimeDevisRequestSerializer(serializers.Serializer):
    """
    Serializer pour la requête d'imposition de prime devis.

    Si repartition_maisons est fournie, sa somme doit être égale à montant_impose
    (tolérance ±1 FCFA). Sinon, le service répartit proportionnellement.
    """

    montant_impose = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        min_value=Decimal("0.01"),
        help_text="Prime NETTE totale imposée",
    )

    repartition_maisons = RepartitionMaisonImpositionSerializer(
        many=True,
        required=False,
        default=list,
        help_text="Répartition par maison (optionnel). Si absent : répartition proportionnelle.",
    )

    montant_accessoire = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        help_text="Montant de l'accessoire (optionnel, sinon calculé automatiquement)",
    )

    montant_taxe = serializers.DecimalField(
        max_digits=19,
        decimal_places=4,
        required=False,
        allow_null=True,
        min_value=Decimal("0"),
        help_text="Taxe totale imposée (optionnel, sinon calculée automatiquement)",
    )

    motif = serializers.CharField(
        max_length=1000,
        required=False,
        allow_blank=True,
        help_text="Raison de l'imposition",
    )

    def validate(self, data):
        repartition = data.get("repartition_maisons", [])
        if repartition:
            somme = sum(item["montant"] for item in repartition)
            montant_impose = data["montant_impose"]
            if abs(somme - montant_impose) > Decimal("1"):
                raise serializers.ValidationError(
                    {
                        "repartition_maisons": (
                            f"La somme des montants par maison ({somme} FCFA) "
                            f"doit être égale au montant imposé ({montant_impose} FCFA)."
                        )
                    }
                )
        return data


class LeveeImpositionRequestSerializer(serializers.Serializer):
    """
    Serializer pour la requête de levée d'imposition.
    """

    motif = serializers.CharField(
        max_length=1000,
        required=False,
        allow_blank=True,
        help_text="Raison de la levée de l'imposition",
    )


class ImpositionPrimeResponseSerializer(serializers.Serializer):
    """
    Serializer pour la réponse d'imposition de prime.
    """

    success = serializers.BooleanField()
    id_maison = serializers.IntegerField(required=False)
    id_devis = serializers.IntegerField(required=False)
    imposition_id = serializers.IntegerField(required=False)
    montant_impose = serializers.FloatField()
    ancien_montant_nette = serializers.FloatField()
    ancien_montant_ttc = serializers.FloatField()
    message = serializers.CharField()


class MaisonModificationResponseSerializer(serializers.Serializer):
    """
    Serializer pour la réponse de modification de maison.
    """

    success = serializers.BooleanField()
    id_maison = serializers.IntegerField(required=False)
    message = serializers.CharField()
    erreur = serializers.CharField(required=False)
    prime_imposee = serializers.BooleanField(required=False)
    montant_impose = serializers.FloatField(required=False)
    imposition_levee = serializers.BooleanField(required=False)


"""
Serializer pour les détails complets d'une maison MRH
======================================================
"""


class GarantieDetailSerializer(serializers.Serializer):
    """Détail d'une garantie de la maison."""

    id_sous_garantie = serializers.IntegerField(
        help_text="ID dans stdgarantie"
    )
    code_sous_garantie = serializers.CharField(help_text="Code de la garantie")
    libelle = serializers.CharField(help_text="Libellé de la garantie")
    type = serializers.CharField(help_text="OBLIGATOIRE ou OPTIONNELLE")
    acquise = serializers.BooleanField(help_text="Si la garantie est acquise")
    prime_nette = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Prime nette après options (FCFA)",
    )
    prime_annuelle = serializers.DecimalField(
        max_digits=15, decimal_places=2, help_text="Prime avant options (FCFA)"
    )
    taux_taxe = serializers.DecimalField(
        max_digits=5,
        decimal_places=3,
        help_text="Taux de taxe (0.145 ou 0.25)",
    )
    taxe = serializers.DecimalField(
        max_digits=15, decimal_places=2, help_text="Montant de la taxe (FCFA)"
    )
    prime_ttc = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Prime TTC (prime nette + taxe)",
    )


class ParametresCalculMaisonSerializer(serializers.Serializer):
    """Paramètres utilisés pour le calcul de la maison."""

    code_usage = serializers.CharField(help_text="Code de l'usage habitation")
    libelle_usage = serializers.CharField(help_text="Libellé de l'usage")
    valeur_batiment = serializers.DecimalField(
        max_digits=15, decimal_places=2, help_text="Valeur du bâtiment (FCFA)"
    )
    valeur_contenu = serializers.DecimalField(
        max_digits=15, decimal_places=2, help_text="Valeur du contenu (FCFA)"
    )
    loyer_mensuel = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        required=False,
        allow_null=True,
        help_text="Loyer mensuel si applicable (FCFA)",
    )
    capital_rvt = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        required=False,
        allow_null=True,
        help_text="Capital RVT si applicable (FCFA)",
    )


class OptionAppliqueeSerializer(serializers.Serializer):
    """Option appliquée sur la maison."""

    code_option = serializers.CharField(help_text="Code de l'option")
    libelle = serializers.CharField(help_text="Libellé de l'option")
    signe = serializers.CharField(help_text="Signe de l'option (+ ou -)")
    pourcentage = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        required=False,
        allow_null=True,
        help_text="Pourcentage d'ajustement",
    )
    impact_financier = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        required=False,
        allow_null=True,
        help_text="Impact financier estimé (FCFA)",
    )


class ImpositionInfoSerializer(serializers.Serializer):
    """Informations sur l'imposition de la maison."""

    imposee = serializers.BooleanField(help_text="Si la prime est imposée")
    montant_impose = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        required=False,
        allow_null=True,
        help_text="Montant de la prime imposée (FCFA)",
    )
    date_imposition = serializers.DateTimeField(
        required=False, allow_null=True, help_text="Date de l'imposition"
    )
    user_nom = serializers.CharField(
        required=False, allow_null=True, help_text="Utilisateur ayant imposé"
    )
    motif = serializers.CharField(
        required=False, allow_null=True, help_text="Motif de l'imposition"
    )
    duree_jours = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Durée de l'imposition en jours",
    )


class TotauxMaisonSerializer(serializers.Serializer):
    """Totaux financiers de la maison."""

    prime_nette_totale = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Somme des primes nettes après options (FCFA)",
    )
    prime_annuelle_totale = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Somme des primes annuelles avant options (FCFA)",
    )
    taxe_totale = serializers.DecimalField(
        max_digits=15, decimal_places=2, help_text="Somme des taxes (FCFA)"
    )
    prime_ttc_totale = serializers.DecimalField(
        max_digits=15, decimal_places=2, help_text="Prime TTC totale (FCFA)"
    )
    economie_options = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Économie réalisée via les options (FCFA)",
    )


class DetailMaisonSerializer(serializers.Serializer):
    """
    Serializer pour les détails complets d'une maison MRH.

    Contient toutes les informations de la maison :
    - Identifiants
    - Paramètres de calcul
    - Garanties détaillées
    - Options appliquées
    - Totaux financiers
    - Statut d'imposition
    """

    # Identifiants
    id_maison = serializers.IntegerField(
        help_text="ID de la maison (DevisDetail)"
    )
    id_devis = serializers.IntegerField(help_text="ID du devis parent")
    numero_devis = serializers.CharField(
        required=False, allow_null=True, help_text="Numéro du devis"
    )

    # Informations générales
    adresse = serializers.CharField(
        required=False, allow_blank=True, help_text="Adresse de la maison"
    )
    description = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Description supplémentaire",
    )

    # Paramètres de calcul
    parametres = ParametresCalculMaisonSerializer(
        help_text="Paramètres utilisés pour le calcul"
    )

    # Options appliquées
    options = OptionAppliqueeSerializer(
        many=True, help_text="Liste des options appliquées"
    )

    # Garanties
    sous_garanties = GarantieDetailSerializer(
        many=True, help_text="Liste de toutes les garanties"
    )

    # Statistiques garanties
    nombre_sous_garanties_obligatoires = serializers.IntegerField(
        help_text="Nombre de garanties obligatoires"
    )
    nombre_sous_garanties_optionnelles = serializers.IntegerField(
        help_text="Nombre de garanties optionnelles"
    )
    nombre_sous_garanties_total = serializers.IntegerField(
        help_text="Nombre total de garanties"
    )

    # Totaux financiers
    totaux = TotauxMaisonSerializer(help_text="Totaux financiers de la maison")

    # Statut d'imposition
    imposition = ImpositionInfoSerializer(
        help_text="Informations sur l'imposition"
    )

    # Dates
    date_creation = serializers.DateTimeField(
        required=False,
        allow_null=True,
        help_text="Date de création de la maison",
    )
    date_modification = serializers.DateTimeField(
        required=False,
        allow_null=True,
        help_text="Date de dernière modification",
    )

    # Métadonnées
    peut_etre_modifiee = serializers.BooleanField(
        help_text="Si la maison peut être modifiée (pas imposée)"
    )

    # Matricule généré automatiquement
    matricule = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Matricule unique (ex: MRH-2024-00456)",
    )


class PieceJointeSerializer(serializers.ModelSerializer):
    """Serializer pour les pièces jointes"""

    url = serializers.SerializerMethodField()

    class Meta:
        model = PieceJointe
        fields = [
            "id",
            "fichier",
            "url",
            "nom_original",
            "type_fichier",
            "taille",
            "date_upload",
        ]
        read_only_fields = [
            "id",
            "nom_original",
            "type_fichier",
            "taille",
            "date_upload",
        ]

    def get_url(self, obj):
        """Retourner l'URL complète du fichier"""
        request = self.context.get("request")
        if obj.fichier and request:
            return request.build_absolute_uri(obj.fichier.url)
        return None

    def create(self, validated_data):
        """Créer une pièce jointe avec métadonnées extraites du fichier"""
        fichier = validated_data.get("fichier")
        if fichier:
            validated_data["nom_original"] = fichier.name
            validated_data["type_fichier"] = fichier.content_type
            validated_data["taille"] = fichier.size
        return super().create(validated_data)



##############################################################
# Transformation adhérents/affiliés Santé MINENE → IA MINENE
##############################################################

class AffilieQualiteSerializer(serializers.Serializer):
    idaffilie = serializers.IntegerField()
    id_qualite = serializers.IntegerField()


class TransformerSanteEnIASerializer(serializers.Serializer):
    id_devis_ia = serializers.IntegerField()
    capital_deces = serializers.DecimalField(max_digits=19, decimal_places=4)
    capital_ipp = serializers.DecimalField(max_digits=19, decimal_places=4)
    frais_traitement = serializers.DecimalField(max_digits=19, decimal_places=4)
    affilies_qualites = AffilieQualiteSerializer(many=True, required=False, default=list)


class BrouillonSerializer(serializers.ModelSerializer):
    utilisateur_nom = serializers.SerializerMethodField()

    class Meta:
        model = Brouillon
        fields = "__all__"
        read_only_fields = ["utilisateur", "date_creation", "date_modification"]

    def get_utilisateur_nom(self, obj):
        u = obj.utilisateur
        return (getattr(u, "name", None) or getattr(u, "email", None)) if u else None
