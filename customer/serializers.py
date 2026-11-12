import re

from rest_framework import serializers
from .models import STATUT_ARCHIVE, Client, ClientNettoyage
from configuration_api.models import TypeAssure, TypeSouscripteur, Qualite, Profession, SecteurActivite


def cle_unique_client(cnipat, nom, prenoms, date_naissance):
    """Clé que le déclencheur trg_clients_cle_unique (stdclient) donne à une fiche enregistrée sans
    clé : la pièce d'identité (ou le RCCM) si elle est saisie, sinon nom | prénoms | date de naissance.
    La colonne étant unique, deux fiches de même clé ne peuvent pas coexister."""
    if (cnipat or "").strip(" "):
        return "CNI-" + re.sub(r"\s+", "", cnipat).strip(" ").upper()
    return "COMP-{}|{}|{}".format(
        (nom or "").strip(" ").lower(),
        (prenoms or "").strip(" ").lower(),
        date_naissance.isoformat() if date_naissance else "",
    )


def message_doublon(fiche, cle, entreprise, date_naissance):
    """Refus d'une fiche qui doublerait `fiche` : où la retrouver et comment distinguer un homonyme."""
    nom = " ".join(filter(None, [(fiche.Nom or "").strip(), (fiche.Prenoms or "").strip()]))
    reference = f"fiche n° {fiche.IdClient} : {nom}"
    if fiche.Statut == STATUT_ARCHIVE:
        regroupement = ClientNettoyage.objects.filter(
            idclient=fiche.IdClient, decision=ClientNettoyage.REGROUPE
        ).values_list("idclient_reference", flat=True).first()
        reference += (
            f", regroupée sur la fiche n° {regroupement}" if regroupement
            else ", archivée : restaurez-la depuis la page Archives"
        )
    if cle.startswith("CNI-"):
        return (
            f"Ce numéro de pièce d'identité ou de registre de commerce est déjà enregistré ({reference}). "
            "Réutilisez ce client plutôt que de créer une seconde fiche."
        )
    if entreprise:
        return (
            f"Une entreprise de même raison sociale existe déjà ({reference}). Réutilisez-la ; "
            "s'il s'agit d'une autre entreprise, renseignez son numéro RCCM."
        )
    if date_naissance:
        return (
            f"Un client de mêmes nom, prénoms et date de naissance existe déjà ({reference}). "
            "Réutilisez ce client plutôt que de créer une seconde fiche."
        )
    return (
        f"Un client de mêmes nom et prénoms existe déjà ({reference}). Réutilisez-le ; "
        "s'il s'agit d'une autre personne, renseignez sa date de naissance ou sa pièce d'identité."
    )


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

    def validate(self, attrs):
        """Doublons refusés avec un message clair, avant que la contrainte unique de cle_unique ne
        fasse échouer l'enregistrement en erreur serveur. Même règle que le déclencheur : une clé
        fournie (ou déjà en base, à la modification) est gardée, sinon elle est recalculée."""
        attrs = super().validate(attrs)

        def valeur(champ):
            return attrs[champ] if champ in attrs else getattr(self.instance, champ, None)

        cle = valeur("cle_unique")
        if not (cle or "").strip(" "):
            cle = cle_unique_client(valeur("CniPat"), valeur("Nom"), valeur("Prenoms"), valeur("DateNaissance"))
        doublons = Client.objects.filter(cle_unique=cle)
        if self.instance is not None:
            doublons = doublons.exclude(pk=self.instance.pk)
        fiche = doublons.first()
        if fiche:
            raise serializers.ValidationError(
                message_doublon(fiche, cle, valeur("Particulier") in ("F", "0"), valeur("DateNaissance"))
            )
        return attrs

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
        # Fiches archivées par le nettoyage (liste ?archives=1)
        for champ in ("motif_archivage", "date_archivage", "fiche_reference"):
            if hasattr(instance, champ):
                representation[champ] = getattr(instance, champ)

        return representation
