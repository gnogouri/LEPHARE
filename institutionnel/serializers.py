from rest_framework import serializers
from .models import (
    CrmLead,
    CrmInteraction,
    SinistreDelegue,
    ConventionAssureur,
    DocumentGED,
    AuditLogCima,
    QuittanceCima,
    BordereauReversement
)


class CrmLeadSerializer(serializers.ModelSerializer):
    class Meta:
        model = CrmLead
        fields = "__all__"
        # Référence attribuée par le serveur à la création (CrmLeadViewSet.perform_create)
        read_only_fields = ("id_lead", "date_creation", "date_maj")
        # « — À attribuer — » dans l'écran : un prospect peut ne pas encore avoir de commercial
        extra_kwargs = {"commercial_attribue": {"allow_blank": True}}

    def validate_statut(self, valeur):
        if valeur not in CrmLead.STATUTS:
            raise serializers.ValidationError(f"Étape inconnue (attendu : {', '.join(CrmLead.STATUTS)}).")
        return valeur


class CrmInteractionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CrmInteraction
        fields = "__all__"


class SinistreDelegueSerializer(serializers.ModelSerializer):
    class Meta:
        model = SinistreDelegue
        fields = "__all__"


class ConventionAssureurSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConventionAssureur
        fields = "__all__"


class DocumentGEDSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentGED
        fields = "__all__"

    def validate_fichier(self, value):
        if value:
            name = getattr(value, "name", "")
            if not name.lower().endswith(".pdf"):
                raise serializers.ValidationError("Format non autorisé : Le fichier doit impérativement être un document au format PDF (.pdf).")
        return value


class AuditLogCimaSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLogCima
        fields = "__all__"


class QuittanceCimaSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuittanceCima
        fields = "__all__"


class BordereauReversementSerializer(serializers.ModelSerializer):
    jours_restants_cima = serializers.SerializerMethodField()
    statut_delai_cima = serializers.SerializerMethodField()

    class Meta:
        model = BordereauReversement
        fields = "__all__"

    def get_jours_restants_cima(self, obj):
        import datetime
        if not obj.date_echeance_30j:
            return 30
        today = datetime.date.today()
        diff = (obj.date_echeance_30j - today).days
        return diff

    def get_statut_delai_cima(self, obj):
        jours = self.get_jours_restants_cima(obj)
        if jours < 0:
            return "HORS_DELAI"
        elif jours <= 5:
            return "ALERTE_IMMINENTE"
        return "CONFORME"
