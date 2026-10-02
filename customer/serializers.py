from rest_framework import serializers
from .models import Client
from configuration_api.models import TypeAssure, TypeSouscripteur, Qualite, Profession, SecteurActivite


class ClientListSerializer(serializers.ListSerializer):
    """
    Serializer de liste optimisé pour éviter le problème N+1 requêtes (13 000+ requêtes SQL).
    Charge les référentiels de profession et qualité une seule fois en mémoire pour toute la liste.
    """
    def to_representation(self, data):
        prof_map = {p.pk: p.Libelle for p in Profession.objects.all()}
        qual_map = {q.pk: q.Libelle for q in Qualite.objects.all()}
        
        # Injecter les maps dans le contexte enfant
        self.child._prof_map = prof_map
        self.child._qual_map = qual_map
        
        return super().to_representation(data)


class ClientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Client
        fields = "__all__"
        list_serializer_class = ClientListSerializer

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        
        # Utiliser les tables préchargées si disponibles
        prof_map = getattr(self, "_prof_map", None)
        qual_map = getattr(self, "_qual_map", None)
        
        if prof_map is not None and qual_map is not None:
            if instance.IdProfession in prof_map:
                representation["libelleprofession"] = prof_map[instance.IdProfession]
            if instance.IdQualite in qual_map:
                representation["civilite"] = qual_map[instance.IdQualite]
        else:
            try:
                profession = Profession.objects.get(pk=instance.IdProfession)
                representation["libelleprofession"] = profession.Libelle
            except Profession.DoesNotExist:
                pass
            try:
                qualite = Qualite.objects.get(pk=instance.IdQualite)
                representation["civilite"] = qualite.Libelle
            except Qualite.DoesNotExist:
                pass

        # Activité commerciale annotée par ClientViewSet (absente après une création)
        for champ in ("devis_en_cours", "contrats_actifs"):
            if hasattr(instance, champ):
                representation[champ] = int(getattr(instance, champ) or 0)
        if hasattr(instance, "total_primes"):
            representation["total_primes"] = int(round(instance.total_primes or 0))

        return representation
