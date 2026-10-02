import os
import uuid

from django.contrib.auth import get_user_model
from django.contrib.postgres.fields import ArrayField
from django.core.validators import FileExtensionValidator
from django.db import models
from django.db.models import CheckConstraint, F, Q, UniqueConstraint
from django.utils import timezone

from account.models import UranusUser
from configuration_api.models import (
    AssistanceAutomobile,
    Avenant,
    Banque,
    Compagnie,
    Energie,
    FormuleSecuriteRoutiere,
    Garantie,
    GenreVehicule,
    Intermediaire,
    Marque,
    ModeEncaissement,
    Offre,
    Pays,
    Produit,
    QualiteAyantDroit,
    SousGarantie,
    SystemeSecurite,
    TypeContratSante,
    TypeVehicule,
    UsageVehicule,
)
from customer.models import Client

User = get_user_model()

OPERATION_ARCHIVAGE = (("ARCHI", "ARCHIVAGE"), ("DESAR", "DESARCHIVAGE"))


class Brouillon(models.Model):
    """
    Saisie non terminée (devis, avenant de contrat…) enregistrée pour être reprise plus tard,
    depuis n'importe quel poste : l'état complet du formulaire est conservé tel quel en JSON.
    """

    TYPES = [
        ("DEVIS_AUTO", "Devis automobile"),
        ("AVENANT", "Modification de contrat"),
    ]

    type_brouillon = models.CharField(max_length=30, choices=TYPES, default="DEVIS_AUTO")
    libelle = models.CharField(max_length=255, blank=True, default="")
    etape = models.PositiveSmallIntegerField(default=1)
    donnees = models.JSONField(default=dict)
    iddevis = models.IntegerField(null=True, blank=True, help_text="Devis existant en cours de modification")
    idcontrat = models.IntegerField(null=True, blank=True, help_text="Contrat en cours de modification")
    utilisateur = models.ForeignKey(UranusUser, null=True, blank=True, on_delete=models.SET_NULL, related_name="brouillons")
    date_creation = models.DateTimeField(auto_now_add=True)
    date_modification = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "lephare_brouillon"
        ordering = ["-date_modification"]
        verbose_name = "Brouillon"
        verbose_name_plural = "Brouillons"

    def __str__(self):
        return f"{self.get_type_brouillon_display()} - {self.libelle or self.pk}"


class PieceJointe(models.Model):
    """
    Modèle pour stocker les pièces jointes (images ou PDFs).
    Une pièce peut être liée à un devis et/ou un contrat.
    """

    fichier = models.FileField(
        upload_to="pieces_jointes/%Y/%m/%d/",
        validators=[
            FileExtensionValidator(
                allowed_extensions=["pdf", "jpg", "jpeg", "png"]
            )
        ],
        help_text="Fichier PDF ou image (JPG, PNG)",
    )
    nom_original = models.CharField(max_length=255)
    type_fichier = models.CharField(max_length=50)
    taille = models.IntegerField(help_text="Taille en octets")
    date_upload = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pieces_jointes"
        verbose_name = "Pièce jointe"
        verbose_name_plural = "Pièces jointes"

    def __str__(self):
        return f"{self.nom_original} - {self.date_upload.strftime('%Y-%m-%d')}"

    def delete(self, *args, **kwargs):
        """Supprimer le fichier physique lors de la suppression du modèle"""
        if self.fichier and os.path.isfile(self.fichier.path):
            os.remove(self.fichier.path)
        super().delete(*args, **kwargs)


class ContractForPremiumCollection(models.Model):
    IdContrat = models.IntegerField()
    IdClient = models.IntegerField()
    LibelleCategorie = models.CharField(max_length=100)
    NumeroPolice = models.CharField(max_length=16)
    NumeroPoliceInterne = models.CharField(max_length=16)
    NumeroAvenant = models.CharField(max_length=50)
    NumeroQuittance = models.CharField(max_length=16)
    IdDetailEncaissement = models.IntegerField(null=True)
    NomClient = models.CharField(max_length=122)
    DateEffet = models.DateField()
    DateExpiration = models.DateField()
    DateEmission = models.DateField()
    Duree = models.IntegerField()
    PrimeNette = models.DecimalField(max_digits=19, decimal_places=4)
    TaxeEnregistrement = models.DecimalField(max_digits=19, decimal_places=4)
    Commission = models.DecimalField(max_digits=19, decimal_places=4)
    Accessoire = models.DecimalField(max_digits=19, decimal_places=4)
    PrimeTTC = models.DecimalField(max_digits=19, decimal_places=4)
    MontantEncaisse = models.DecimalField(max_digits=19, decimal_places=4)
    MontantReverse = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    MontantAReverser = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    Solde = models.DecimalField(max_digits=19, decimal_places=4, null=True)
    Flotte = models.BooleanField(null=True)
    LibelleAvenant = models.CharField(max_length=50, null=True)
    Confirme = models.BooleanField(null=True, default=True)

    def __str__(self):
        return "Police n° {} du client {}.".format(
            self.NumeroPolice, self.NomClient
        )

    class Meta:
        managed = False


class PremiumCollectionInfo(models.Model):
    NumeroRecu = models.CharField(max_length=16)
    DateEncaissement = models.DateField()
    NumeroCheque = models.CharField(max_length=20)
    NomTireurCheque = models.CharField(max_length=60)
    LibelleBanque = models.CharField(max_length=50)
    LibelleModePaiement = models.CharField(max_length=60)
    Reference = models.CharField(max_length=30)
    MontantEncaissement = models.DecimalField(max_digits=19, decimal_places=4)
    NumeroPolice = models.CharField(max_length=16)
    DateEffet = models.DateField()
    DateExpiration = models.DateField()
    NomCompagnie = models.CharField(max_length=100)
    NomAssure = models.CharField(max_length=60)
    PrenomsAssure = models.CharField(max_length=60)
    TelephoneAssure = models.CharField(max_length=20)
    NumeroAvenant = models.CharField(max_length=50)
    LibelleProduit = models.CharField(max_length=60)
    PrimeTotale = models.DecimalField(max_digits=19, decimal_places=4)
    VersementAnterieur = models.DecimalField(max_digits=19, decimal_places=4)
    TotalVersement = models.DecimalField(max_digits=19, decimal_places=4)
    Solde = models.DecimalField(max_digits=19, decimal_places=4)
    MontantEncaissementEnLettres = models.CharField(max_length=256)

    def __str__(self):
        return "Encaissement de {} en date du {}.".format(
            self.MontantEncaissement, self.DateEncaissement
        )

    class Meta:
        managed = False


class PremiumRemittanceInfo(models.Model):
    NomClient = models.CharField(max_length=125)
    LibelleProduit = models.CharField(max_length=80)
    NumeroPolice = models.CharField(max_length=16)
    NumeroAvenant = models.CharField(max_length=50)
    DateEffet = models.DateField()
    DateExpiration = models.DateField()
    PrimeHT = models.DecimalField(max_digits=19, decimal_places=4)
    PrimeTTC = models.DecimalField(max_digits=19, decimal_places=4)
    MontantEncaissement = models.DecimalField(max_digits=19, decimal_places=4)
    AccessoireIntermediaire = models.DecimalField(
        max_digits=19, decimal_places=4
    )
    TauxCommission = models.DecimalField(max_digits=5, decimal_places=2)
    Commission = models.DecimalField(max_digits=19, decimal_places=4)
    FraisGestion = models.DecimalField(max_digits=19, decimal_places=4)
    CommissionDeduite = models.DecimalField(max_digits=19, decimal_places=4)
    FraisDeduit = models.DecimalField(max_digits=19, decimal_places=4)
    AccessoireDeduit = models.DecimalField(max_digits=19, decimal_places=4)
    MontantReversement = models.DecimalField(max_digits=19, decimal_places=4)
    NomCompagnie = models.CharField(max_length=100)
    DateReversement = models.DateField()
    NumeroReversement = models.CharField(max_length=16)

    def __str__(self):
        return "Reversement de {} en date du {}.".format(
            self.MontantReversement, self.DateReversement
        )

    class Meta:
        managed = False


class QuotationInsertionResult(models.Model):
    IdDevis = models.IntegerField(default=0)
    IdDevisDetail = models.IntegerField(default=0)
    NumeroImmatriculation = models.CharField(max_length=50, default="")
    OutputMessage = models.CharField(max_length=500, default="")

    def __str__(self):
        return self.OutputMessage

    class Meta:
        managed = False


class DataInsertionResult(models.Model):
    ObjectId = models.IntegerField(default=0)
    OutputMessage = models.CharField(max_length=500, default="")

    def __str__(self):
        return self.OutputMessage

    class Meta:
        managed = False


class Devis(models.Model):
    iddevis = models.AutoField(primary_key=True)
    intermediaire = models.ForeignKey(
        Intermediaire,
        default=0,
        db_column="idintermediaire",
        related_name="devis_intermediaire",
        on_delete=models.SET_DEFAULT,
    )
    compagnie = models.ForeignKey(
        Compagnie,
        default=0,
        db_column="idcompagnie",
        related_name="devis_compagnie",
        on_delete=models.SET_DEFAULT,
    )
    produit = models.ForeignKey(
        Produit,
        default=0,
        db_column="idproduit",
        related_name="devis_produit",
        on_delete=models.SET_DEFAULT,
    )
    offre = models.ForeignKey(
        Offre,
        default=0,
        db_column="idoffre",
        related_name="devis_offre",
        on_delete=models.SET_DEFAULT,
    )
    client = models.ForeignKey(
        Client,
        default=0,
        db_column="idclient",
        related_name="devis_client",
        on_delete=models.SET_DEFAULT,
    )
    assure = models.ForeignKey(
        Client,
        default=0,
        db_column="idassure",
        related_name="devis_assure",
        on_delete=models.SET_DEFAULT,
    )
    avenant = models.ForeignKey(
        Avenant,
        default=0,
        db_column="idavenant",
        related_name="devis_avenant",
        on_delete=models.SET_DEFAULT,
    )
    flotte = models.BooleanField()
    coassurance = models.BooleanField()
    aperiteur = models.ForeignKey(
        Compagnie,
        default=0,
        db_column="idaperiteur",
        related_name="devis_aperiteur",
        on_delete=models.SET_DEFAULT,
    )
    numerodevis = models.CharField(max_length=50)
    referenceagent = models.CharField(max_length=50, default="")
    renouvelable = models.BooleanField(default=False)
    echeance = models.CharField(max_length=5, default="")
    periode = models.CharField(max_length=1)
    numeroavenant = models.CharField(max_length=50)
    dateeffet = models.DateTimeField(blank=True, null=True)
    heuredebut = models.DateTimeField(blank=True, null=True)
    dateexpiration = models.DateTimeField(blank=True, null=True)
    confirme = models.BooleanField()
    dateemission = models.DateTimeField()
    transfere = models.BooleanField(default=False)
    nbreche = models.SmallIntegerField(default=1)
    anticipation = models.BooleanField(default=False)
    observation = models.CharField(max_length=50, default="")
    idoldhist = models.IntegerField(default=0)
    oldnumerodevis = models.CharField(max_length=50, default="")
    auteur = models.BooleanField(default=False)
    primeannuelle = models.DecimalField(
        max_digits=19, decimal_places=4, default=0
    )
    primenette = models.DecimalField(
        max_digits=19, decimal_places=4, default=0
    )
    accessoire = models.DecimalField(
        max_digits=19, decimal_places=4, default=0
    )
    accessoirecompagnie = models.DecimalField(
        max_digits=19, decimal_places=4, default=0
    )
    accessoireintermediaire = models.DecimalField(
        db_column="accessoireintermediaire",
        max_digits=19,
        decimal_places=4,
        default=0,
    )  # Field name made lowercase.
    accessoiregestionnaire = models.DecimalField(
        db_column="accessoiregestionnaire",
        max_digits=19,
        decimal_places=4,
        default=0,
    )  # Field name made lowercase.
    commissionintermediaire = models.DecimalField(
        db_column="commissionintermediaire",
        max_digits=19,
        decimal_places=4,
        default=0,
    )  # Field name made lowercase.
    commissiongestionnaire = models.DecimalField(
        db_column="commissiongestionnaire",
        max_digits=19,
        decimal_places=4,
        default=0,
    )  # Field name made lowercase.
    commissionaperiteur = models.DecimalField(
        db_column="commissionaperiteur",
        max_digits=19,
        decimal_places=4,
        default=0,
    )  # Field name made lowercase.
    taxe = models.DecimalField(max_digits=19, decimal_places=4, default=0)
    fga = models.DecimalField(
        db_column="fga", max_digits=19, decimal_places=4, default=0
    )
    cedeao = models.DecimalField(
        db_column="cedeao", max_digits=19, decimal_places=4, default=0
    )
    primettc = models.DecimalField(max_digits=19, decimal_places=4, default=0)
    idoperateur = models.IntegerField(blank=True, null=True)
    bonus_malus = models.DecimalField(
        max_digits=19, decimal_places=4, default=0
    )
    idenergie = models.SmallIntegerField(blank=True, null=True)
    nomassure = models.CharField(max_length=255, blank=True, null=True)
    idhisto = models.IntegerField(default=0)
    idduree = models.IntegerField(default=1, blank=True, null=True)
    idterme = models.IntegerField(default=1, blank=True, null=True)
    motifannulation = models.CharField(
        db_column="motifannulation", blank=True, null=True, max_length=255
    )
    archive = models.BooleanField(default=False, null=True, blank=True)
    date_archivage = models.DateTimeField(
        db_column="datearchivage", null=True, blank=True
    )
    operateur_archivage = models.IntegerField(
        db_column="operateurarchivage", null=True, blank=True
    )
    numero_police_connexe = models.CharField(
        max_length=50,
        default="",
        blank=True,
        null=True,
        db_column="numeropoliceconnexe",
    )
    id_police_pegas = models.CharField(
        max_length=14,
        default="",
        blank=True,
        null=True,
        db_column="idpolicepegas",
    )
    numero_police_compagnie = models.CharField(
        max_length=60,
        default="",
        blank=True,
        null=True,
        db_column="numeropolicecompagnie",
    )
    # Nouveaux champs pour l'imposition de prime
    prime_imposee = models.BooleanField(
        default=False,
        blank=True,
        null=True,
        db_column="primeimposee",
        verbose_name="Prime imposée",
        help_text="Indique si la prime globale du devis est imposée (non recalculable)",
    )

    prime_imposee_date = models.DateTimeField(
        null=True,
        blank=True,
        db_column="primeimposeedate",
        verbose_name="Date imposition prime",
        help_text="Date et heure de l'imposition de la prime",
    )

    statut = models.CharField(
        max_length=50, default="ACTIF", db_column="statut"
    )
    date_creation = models.DateTimeField(
        auto_now_add=True, null=True, blank=True, db_column="datecreation"
    )
    date_modification = models.DateTimeField(
        auto_now=True, null=True, blank=True, db_column="datemodification"
    )
    devis_consolide = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="devis_sources",
        db_column="iddevisconsolide",
    )
    date_consolidation = models.DateTimeField(
        null=True, blank=True, db_column="dateconsolidation"
    )
    numero_facture = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        unique=True,
        db_column="numerofacture",
    )

    # Relation avec la pièce jointe
    piece_jointe = models.ForeignKey(
        PieceJointe,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="devis",
    )

    def __str__(self):
        return self.numerodevis

    class Meta:
        db_table = "stddevis"
        verbose_name = "Devis"
        verbose_name_plural = "Devis"
        constraints = [
            CheckConstraint(
                check=Q(dateexpiration__gte=F("dateeffet")),
                name="devis_date_expiration_plus_grande_date_effet",
            ),
        ]
        indexes = [
            models.Index(
                fields=["prime_imposee"], name="idx_devis_prime_imposee"
            ),
        ]

    @property
    def prime_imposee_montant(self):
        """
        Retourne le montant de la prime imposée.
        C'est simplement primenette quand prime_imposee=True.
        """
        return self.primenette if self.prime_imposee else None

    @property
    def duree_terme_jours(self):
        """
        Nombre de jours entre dateeffet et dateexpiration.
        Utilisé notamment quand idterme=3 (Autre), où la durée n'est pas
        déduite d'une durée standard (idduree) mais des dates saisies.
        """
        if self.dateeffet and self.dateexpiration:
            return (self.dateexpiration - self.dateeffet).days
        return None


class HistoriqueConsolidation(models.Model):
    id = models.AutoField(
        primary_key=True, db_column="idhistoriqueconsolidation"
    )
    devis_consolide = models.ForeignKey(
        Devis,
        on_delete=models.CASCADE,
        db_column="iddevisconsolide",
        related_name="historiques_consolidation",
    )
    id_devis_source = ArrayField(
        models.IntegerField(),
        help_text="Liste des IDs des devis consolidés",
        db_column="iddevissource",
    )
    date_consolidation = models.DateTimeField(
        auto_now_add=True, db_column="dateconsolidation"
    )
    id_utilisateur = models.IntegerField(
        null=True, blank=True, db_column="idutilisateur"
    )

    class Meta:
        db_table = "stdhistoriqueconsolidation"
        ordering = ["-date_consolidation"]

    def __str__(self):
        return f"Consolidation {self.devis_consolide.numerodevis} - {self.date_consolidation}"


class ArchivageDevis(models.Model):
    id_archivage = models.AutoField(db_column="idarchivage", primary_key=True)
    devis = models.ForeignKey(
        Devis, db_column="iddevis", on_delete=models.DO_NOTHING
    )
    type_operation = models.CharField(
        db_column="typeoperation", max_length=5, choices=OPERATION_ARCHIVAGE
    )
    date_archivage = models.DateTimeField(db_column="datearchivage")
    operateur_archivage = models.ForeignKey(
        UranusUser, db_column="operateurarchivage", on_delete=models.DO_NOTHING
    )

    def __str__(self):
        operation = (
            "Archivage" if self.type_operation == "ARCHI" else "Désarchivage"
        )
        return "{} du devis n° {} le {}".format(
            operation, self.devis, self.date_archivage
        )

    class Meta:
        db_table = "stdarchivagedevis"
        verbose_name = "Archivage/Désarchivage de devis"
        constraints = [
            models.CheckConstraint(
                check=models.Q(type_operation__in=["ARCHI", "DESAR"]),
                name="archivage_devis_type_op_restreint",
            ),
        ]


class ExtendedDevisInfo(Devis, models.Model):
    id_produit = models.IntegerField()
    id_contrat = models.IntegerField(null=True)
    libelle_aperiteur = models.CharField(max_length=100)
    libelle_avenant = models.CharField(max_length=50)
    nomclient = models.CharField(max_length=122)
    adressepostaleclient = models.CharField(max_length=100)
    adressegeoclient = models.CharField(max_length=100)
    emailclient = models.CharField(max_length=254)
    telephoneclient = models.CharField(max_length=20)
    libelle_compagnie = models.CharField(max_length=100)
    libelle_intermediaire = models.CharField(max_length=50)
    libelle_offre = models.CharField(max_length=80)
    libelle_produit = models.CharField(max_length=60)
    libelle_categorie = models.CharField(max_length=100)

    class Meta:
        managed = False


class DevisDetail(models.Model):
    iddevisdetail = models.AutoField(primary_key=True)
    iddevis = models.ForeignKey(
        Devis,
        related_name="details",
        db_column="iddevis",
        on_delete=models.CASCADE,
    )
    iddevisorigine = models.ForeignKey(
        Devis,
        related_name="details_origine",
        db_column="iddevisorigine",
        null=True,
        on_delete=models.SET_NULL,
    )
    idoffre = models.IntegerField(null=True, blank=True)
    idtarif = models.IntegerField()
    vehicule = models.IntegerField()
    codeusage = models.CharField(max_length=3, blank=True, null=True)
    idusage = models.ForeignKey(
        UsageVehicule,
        db_column="idusage",
        null=True,
        on_delete=models.SET_NULL,
    )
    reference = models.CharField(max_length=3, blank=True, null=True)
    idcarrosserie = models.IntegerField(blank=True, null=True)
    puissancefiscale = models.SmallIntegerField(blank=True, null=True)
    nombreplace = models.SmallIntegerField()
    chargeutile = models.DecimalField(max_digits=19, decimal_places=4)
    valeurneuve = models.DecimalField(max_digits=19, decimal_places=4)
    valeurvenale = models.DecimalField(max_digits=19, decimal_places=4)
    valeuraccessoire = models.DecimalField(max_digits=19, decimal_places=4)
    remorque = models.BooleanField(default=False)
    matrem1 = models.CharField(max_length=50, default="")
    matrem2 = models.CharField(max_length=50, default="")
    extincteur = models.BooleanField(default=False)
    idprofession = models.IntegerField(blank=True, null=True)
    conducteur = models.TextField(max_length=2048, blank=True, null=True)
    adressecnd = models.CharField(
        max_length=50, null=True, blank=True, default=""
    )
    villecnd = models.IntegerField(blank=True, null=True)
    sexe = models.CharField(max_length=1, default="M")
    datemec = models.DateTimeField(blank=True, null=True)
    datemutation = models.DateTimeField(blank=True, null=True)
    nummoteur = models.CharField(max_length=50, blank=True, null=True)
    numchassis = models.CharField(max_length=50, blank=True, null=True)
    nbreextinteur = models.SmallIntegerField(blank=True, null=True)
    typevehicule = models.CharField(max_length=50, blank=True, null=True)
    idtypevehicule = models.ForeignKey(
        TypeVehicule,
        db_column="idtypevehicule",
        verbose_name="Id Type Véhicule",
        default=0,
        null=True,
        on_delete=models.SET_NULL,
    )
    idgenrevehicule = models.ForeignKey(
        GenreVehicule,
        db_column="idgenrevehicule",
        verbose_name="Id Genre Véhicule",
        default=0,
        null=True,
        on_delete=models.SET_NULL,
    )
    modelevehicule = models.CharField(
        verbose_name="Modèle du véhicule",
        max_length=30,
        db_column="modelevehicule",
        default="",
    )
    idmarque = models.ForeignKey(
        Marque,
        db_column="idmarque",
        null=True,
        default=0,
        on_delete=models.SET_NULL,
    )
    matricule = models.CharField(max_length=50, default="")
    typeimmat = models.CharField(max_length=1, default="M")
    attestation = models.CharField(max_length=50, default="")
    provisoire = models.BooleanField(default=False)
    permis = models.CharField(max_length=50, null=True, blank=True, default="")
    datedelipc = models.DateTimeField(blank=True, null=True)
    datenaicnd = models.DateTimeField(blank=True, null=True)
    iddelegation = models.IntegerField(blank=True, null=True)
    agrement = models.CharField(max_length=50, default="")
    villeagrement = models.IntegerField(blank=True, null=True)
    observation = models.CharField(max_length=50, default="")
    idoldhist = models.IntegerField(default=0)
    oldpolice = models.CharField(max_length=50, default="")
    oldattestation = models.CharField(max_length=50, default="")
    oldmarque = models.IntegerField(default=0)
    oldtype = models.CharField(max_length=50, default="")
    oldmatricule = models.CharField(max_length=50, default="")
    carteverte = models.BooleanField(default=False)
    numcarteverte = models.CharField(max_length=50, default="")
    # auteur = models.CharField(max_length=1, default="M")
    auteur = models.BooleanField(default=False)
    primeannuelle = models.DecimalField(
        max_digits=19, decimal_places=4, default=0
    )
    primenette = models.DecimalField(
        max_digits=19, decimal_places=4, default=0
    )
    mt_delegation = models.DecimalField(
        max_digits=19, decimal_places=4, default=0
    )
    essence = models.ForeignKey(
        Energie,
        db_column="essence",
        null=True,
        default=0,
        on_delete=models.CASCADE,
    )
    attestationprov = models.CharField(max_length=50, blank=True, null=True)
    pc_control = models.BooleanField(default=False)
    cg_control = models.BooleanField(default=False)
    numpccnd = models.CharField(max_length=50, default="")
    pctype = models.CharField(max_length=50, default="000000000000")
    taxeenregistrement = models.DecimalField(
        max_digits=19, decimal_places=4, default=0
    )
    fga = models.DecimalField(
        db_column="fga", max_digits=19, decimal_places=4, default=0
    )
    securite = models.ForeignKey(
        SystemeSecurite,
        db_column="codealarme",
        null=True,
        default=1,
        on_delete=models.CASCADE,
    )
    taux_reduction = models.DecimalField(
        db_column="tauxreduction",
        verbose_name="Taux de réduction commerciale",
        max_digits=5,
        decimal_places=2,
        null=True,
        default=0.0,
    )
    prime_imposee = models.BooleanField(
        db_column="primeimposee",
        default=False,
        verbose_name="Prime imposée",
        help_text="Indique si la prime de cette maison est imposée (non recalculable)",
    )

    prime_imposee_date = models.DateTimeField(
        db_column="primeimposeedate",
        null=True,
        blank=True,
        verbose_name="Date imposition prime",
        help_text="Date et heure de l'imposition de la prime",
    )

    class Meta:
        db_table = "stddevisdetail"
        verbose_name = "Détail de devis"
        verbose_name_plural = "Détails de devis"
        indexes = [
            models.Index(
                fields=["prime_imposee"], name="idx_dd_prime_imposee"
            ),
        ]

    @property
    def prime_imposee_montant(self):
        """
        Retourne le montant de la prime imposée.
        C'est simplement primenette quand prime_imposee=True.
        """
        return self.primenette if self.prime_imposee else None


class DevisDetGarantie(models.Model):
    IdDevisDetGarantie = models.AutoField(
        primary_key=True, db_column="iddevisdetgarantie"
    )
    IdDevisDet = models.ForeignKey(
        DevisDetail,
        db_column="iddevisdet",
        related_name="garanties",
        on_delete=models.CASCADE,
    )
    IdGarantie = models.ForeignKey(
        SousGarantie,
        db_column="idgarantie",
        related_name="detail_devis",
        default=1,
        on_delete=models.CASCADE,
    )
    Acquise = models.BooleanField(db_column="acquise")
    Capital = models.DecimalField(
        db_column="capital",
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
    )
    Franchise = models.DecimalField(
        db_column="franchise",
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
    )
    TexteFranchise = models.CharField(
        db_column="textefranchise", max_length=120, null=True, blank=True
    )
    Formule = models.IntegerField(db_column="formule", blank=True, null=True)
    PrimeNette = models.DecimalField(
        db_column="primenette", max_digits=19, decimal_places=4
    )
    old_acquise = models.CharField(max_length=1, db_column="old_acquise")
    old_capital = models.DecimalField(
        db_column="old_capital",
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
    )
    old_franchise = models.DecimalField(
        db_column="old_franchise",
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
    )
    old_formule = models.SmallIntegerField(
        db_column="old_formule", blank=True, null=True
    )
    old_places = models.SmallIntegerField(
        db_column="old_places", blank=True, null=True
    )
    old_primenette = models.DecimalField(
        db_column="old_primenette", max_digits=19, decimal_places=4
    )
    deces = models.DecimalField(
        db_column="deces",
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
    )
    ipp = models.DecimalField(
        db_column="ipp", max_digits=19, decimal_places=4, blank=True, null=True
    )
    fraismed = models.DecimalField(
        db_column="fraismed",
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
    )
    hosp = models.DecimalField(
        db_column="hosp",
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
    )
    minfranchise = models.DecimalField(
        db_column="minfranchise", max_digits=19, decimal_places=4
    )
    maxfranchise = models.DecimalField(
        db_column="maxfranchise", max_digits=19, decimal_places=4
    )
    tauxfranchise = models.DecimalField(
        db_column="tauxfranchise",
        max_digits=5,
        decimal_places=2,
        default=0,
        null=True,
        blank=True,
    )
    primeannuelle = models.DecimalField(
        db_column="primeannuelle", max_digits=19, decimal_places=4, default=0
    )
    taxe = models.DecimalField(
        db_column="taxe", max_digits=19, decimal_places=4, default=0
    )

    class Meta:
        db_table = "stddevisdetgarantie"
        unique_together = (("IdDevisDet", "IdGarantie"),)
        verbose_name = "Garantie d'un devis"
        verbose_name_plural = "Garanties d'un devis"


class TarifEcran(models.Model):
    idtarif = models.IntegerField()
    idgarantie = models.IntegerField()
    garcapitaltype = models.SmallIntegerField()
    garcapitalliste = models.IntegerField()
    garcapitalval = models.DecimalField(max_digits=19, decimal_places=4)
    garfranchisetype = models.SmallIntegerField()
    garfranchiseliste = models.IntegerField()
    garfranchiseval = models.DecimalField(max_digits=19, decimal_places=4)
    garformuletype = models.SmallIntegerField()
    garformuleliste = models.IntegerField()
    garformuleval = models.SmallIntegerField()
    garplacetype = models.SmallIntegerField()
    garplaceval = models.SmallIntegerField()
    obligatoire = models.BooleanField()
    modecalcind = models.CharField(max_length=1, blank=True, null=True)
    sindelai = models.SmallIntegerField(blank=True, null=True)
    sinbloquant = models.BooleanField(blank=True, null=True)

    class Meta:
        db_table = "stdtarifecran"


class Tarification(models.Model):
    iddetail = models.CharField(max_length=255, blank=True, null=True)
    idtarif = models.CharField(max_length=255, blank=True, null=True)
    idgarantie = models.CharField(max_length=255, blank=True, null=True)
    puissancedu = models.CharField(max_length=255, blank=True, null=True)
    puissanceau = models.CharField(max_length=255, blank=True, null=True)
    tonnagedu = models.CharField(max_length=255, blank=True, null=True)
    tonnageau = models.CharField(max_length=255, blank=True, null=True)
    capitaldu = models.CharField(max_length=255, blank=True, null=True)
    capitalau = models.CharField(max_length=255, blank=True, null=True)
    franchisedu = models.CharField(max_length=255, blank=True, null=True)
    franchiseau = models.CharField(max_length=255, blank=True, null=True)
    franchisemin = models.CharField(max_length=255, blank=True, null=True)
    agevehdu = models.CharField(max_length=255, blank=True, null=True)
    agevehau = models.CharField(max_length=255, blank=True, null=True)
    agecnddu = models.CharField(max_length=255, blank=True, null=True)
    agecndau = models.CharField(max_length=255, blank=True, null=True)
    placesdu = models.CharField(max_length=255, blank=True, null=True)
    placesau = models.CharField(max_length=255, blank=True, null=True)
    taux = models.CharField(max_length=255, blank=True, null=True)
    primemin = models.CharField(max_length=255, blank=True, null=True)
    placesgrat = models.CharField(max_length=255, blank=True, null=True)
    primeplace = models.CharField(max_length=255, blank=True, null=True)
    primegar = models.CharField(max_length=255, blank=True, null=True)
    deces = models.CharField(max_length=255, blank=True, null=True)
    ipp = models.CharField(max_length=255, blank=True, null=True)
    fraismed = models.CharField(max_length=255, blank=True, null=True)
    minprorata = models.CharField(max_length=255, blank=True, null=True)
    codecarburant = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        db_table = "stdtarification"


class Contrat(models.Model):
    idcontrat = models.AutoField(
        db_column="idcontrat", primary_key=True
    )  # Field name made lowercase.
    iddevis = models.ForeignKey(
        Devis, db_column="iddevis", on_delete=models.CASCADE
    )  # Field name made lowercase.
    idcompagnie = models.ForeignKey(
        Compagnie,
        db_column="idcompagnie",
        blank=True,
        null=True,
        on_delete=models.CASCADE,
    )  # Field name made lowercase.
    idintermediaire = models.ForeignKey(
        Intermediaire,
        db_column="idintermediaire",
        on_delete=models.CASCADE,
    )  # Field name made lowercase.
    idproduit = models.ForeignKey(
        Produit, db_column="idproduit", on_delete=models.CASCADE
    )  # Field name made lowercase.
    idclient = models.ForeignKey(
        Client, db_column="idclient", on_delete=models.CASCADE
    )  # Field name made lowercase.
    idassure = models.IntegerField(
        db_column="idassure", default=0
    )  # Field name made lowercase.
    idavenant = models.ForeignKey(
        Avenant, db_column="idavenant", on_delete=models.CASCADE
    )  # Field name made lowercase.
    flotte = models.BooleanField(
        db_column="flotte"
    )  # Field name made lowercase.
    coassurance = models.BooleanField(
        db_column="coassurance"
    )  # Field name made lowercase.
    idaperiteur = models.IntegerField(
        db_column="idaperiteur", default=0
    )  # Field name made lowercase.
    numeropolice = models.CharField(
        db_column="numeropolice", max_length=50
    )  # Field name made lowercase.
    referenceagent = models.CharField(
        db_column="referenceagent", max_length=50, default=""
    )  # Field name made lowercase.
    renouvelable = models.BooleanField(
        db_column="renouvelable", default=False
    )  # Field name made lowercase.
    echeance = models.CharField(
        db_column="echeance", max_length=5, default=""
    )  # Field name made lowercase.
    periode = models.CharField(
        db_column="periode", max_length=1
    )  # Field name made lowercase.
    numeroavenant = models.CharField(
        db_column="numeroavenant", max_length=50
    )  # Field name made lowercase.
    dateeffet = models.DateTimeField(
        db_column="dateeffet", blank=True, null=True
    )  # Field name made lowercase.
    heuredebut = models.DateTimeField(
        db_column="heuredebut", blank=True, null=True
    )  # Field name made lowercase.
    dateexpiration = models.DateTimeField(
        db_column="dateexpiration", blank=True, null=True
    )  # Field name made lowercase.
    dateemission = models.DateTimeField(
        db_column="dateemission"
    )  # Field name made lowercase.
    transfere = models.BooleanField(
        db_column="transfere", default=False
    )  # Field name made lowercase.
    nbreche = models.SmallIntegerField(
        db_column="nbreche", default=1
    )  # Field name made lowercase.
    anticipation = models.BooleanField(
        db_column="anticipation", default=False
    )  # Field name made lowercase.
    observation = models.CharField(
        db_column="observation", max_length=50, default=""
    )  # Field name made lowercase.
    idoldhist = models.IntegerField(
        db_column="idoldhist", default=0
    )  # Field name made lowercase.
    oldnumerodevis = models.CharField(
        db_column="oldnumerodevis", max_length=50, default=""
    )  # Field name made lowercase.
    auteur = models.BooleanField(
        db_column="auteur", default=False
    )  # Field name made lowercase.
    primeannuelle = models.DecimalField(
        db_column="primeannuelle", max_digits=19, decimal_places=4, default=0
    )  # Field name made lowercase.
    primenette = models.DecimalField(
        db_column="primenette", max_digits=19, decimal_places=4, default=0
    )  # Field name made lowercase.
    accessoire = models.DecimalField(
        db_column="accessoire", max_digits=19, decimal_places=4, default=0
    )  # Field name made lowercase.
    accessoirecompagnie = models.DecimalField(
        db_column="accessoirecompagnie",
        max_digits=19,
        decimal_places=4,
        default=0,
    )  # Field name made lowercase.
    accessoireintermediaire = models.DecimalField(
        db_column="accessoireintermediaire",
        max_digits=19,
        decimal_places=4,
        default=0,
    )  # Field name made lowercase.
    accessoiregestionnaire = models.DecimalField(
        db_column="accessoiregestionnaire",
        max_digits=19,
        decimal_places=4,
        default=0,
    )  # Field name made lowercase.
    commissionintermediaire = models.DecimalField(
        db_column="commissionintermediaire",
        max_digits=19,
        decimal_places=4,
        default=0,
    )  # Field name made lowercase.
    commissiongestionnaire = models.DecimalField(
        db_column="commissiongestionnaire",
        max_digits=19,
        decimal_places=4,
        default=0,
    )  # Field name made lowercase.
    commissionaperiteur = models.DecimalField(
        db_column="commissionaperiteur",
        max_digits=19,
        decimal_places=4,
        default=0,
    )  # Field name made lowercase.
    taxe = models.DecimalField(
        db_column="taxe", max_digits=19, decimal_places=4, default=0
    )  # Field name made lowercase.
    fga = models.DecimalField(
        db_column="fga", max_digits=19, decimal_places=4, default=0
    )
    cedeao = models.DecimalField(
        db_column="cedeao", max_digits=19, decimal_places=4, default=0
    )
    primettc = models.DecimalField(
        db_column="primettc", max_digits=19, decimal_places=4, default=0
    )  # Field name made lowercase.
    idoperateur = models.IntegerField(
        db_column="idoperateur", blank=True, null=True
    )  # Field name made lowercase.
    bonus_malus = models.DecimalField(
        db_column="bonus_malus", max_digits=19, decimal_places=4, default=0
    )  # Field name made lowercase.
    assure = models.CharField(
        db_column="assure", max_length=255, blank=True, null=True
    )  # Field name made lowercase.
    idcontratannulation = models.IntegerField(
        db_column="idcontratannulation",
        null=True,
        blank=True,
    )  # Field name made lowercase.
    motifannulation = models.CharField(
        db_column="motifannulation", max_length=255, blank=True, null=True
    )
    idquittance = models.OneToOneField(
        "Quittance",
        db_column="idquittance",
        null=True,
        on_delete=models.SET_NULL,
        related_name="contrat",
    )
    idduree = models.IntegerField(default=1, blank=True, null=True)
    idterme = models.IntegerField(default=1, blank=True, null=True)
    numero_police_connexe = models.CharField(
        max_length=50,
        default="",
        blank=True,
        null=True,
        db_column="numeropoliceconnexe",
    )
    id_police_pegas = models.CharField(
        max_length=14,
        default="",
        blank=True,
        null=True,
        db_column="idpolicepegas",
    )
    numero_police_compagnie = models.CharField(
        max_length=60,
        default="",
        blank=True,
        null=True,
        db_column="numeropolicecompagnie",
    )
    prime_imposee = models.BooleanField(
        default=False, blank=True, null=True, db_column="primeimposee"
    )
    numero_facture = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        unique=True,
        db_column="numerofacture",
    )
    taux_commission = models.DecimalField(
        max_digits=5, decimal_places=2, null=True
    )
    # Relation avec la pièce jointe (partagée avec le devis)
    piece_jointe = models.ForeignKey(
        PieceJointe,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contrats",
    )

    class Meta:
        db_table = "stdcontrat"
        verbose_name = "Contrat"
        verbose_name_plural = "Contrats"
        constraints = [
            CheckConstraint(
                check=Q(dateexpiration__gte=F("dateeffet")),
                name="contrat_date_expiration_plus_grande_date_effet",
            ),
        ]

    @property
    def duree_terme_jours(self):
        """
        Nombre de jours entre dateeffet et dateexpiration.
        Utilisé notamment quand idterme=3 (Autre), où la durée n'est pas
        déduite d'une durée standard (idduree) mais des dates saisies.
        """
        if self.dateeffet and self.dateexpiration:
            return (self.dateexpiration - self.dateeffet).days
        return None


class ContratDetail(models.Model):
    idcontratdetail = models.AutoField(
        db_column="idcontratdetail", primary_key=True
    )  # Field name made lowercase.
    idcontrat = models.ForeignKey(
        Contrat,
        db_column="idcontrat",
        on_delete=models.CASCADE,
    )  # Field name made lowercase.
    idassure = models.IntegerField(
        db_column="idassure"
    )  # Field name made lowercase.
    idproduit = models.IntegerField(
        db_column="idproduit"
    )  # Field name made lowercase.
    idoffre = models.IntegerField(
        db_column="idoffre"
    )  # Field name made lowercase.
    idtarif = models.IntegerField(
        db_column="idtarif"
    )  # Field name made lowercase.
    codeusage = models.CharField(
        db_column="codeusage", max_length=3, blank=True, null=True
    )  # Field name made lowercase.
    idusage = models.ForeignKey(
        UsageVehicule,
        db_column="idusage",
        null=True,
        on_delete=models.SET_NULL,
    )
    reference = models.CharField(
        db_column="reference", max_length=3, blank=True, null=True
    )  # Field name made lowercase.
    idcarrosserie = models.IntegerField(
        db_column="idcarrosserie", blank=True, null=True
    )  # Field name made lowercase.
    matricule = models.CharField(
        db_column="matricule", max_length=50, default=""
    )  # Field name made lowercase.
    puissancefiscale = models.SmallIntegerField(
        db_column="puissancefiscale", blank=True, null=True
    )  # Field name made lowercase.
    nombreplace = models.SmallIntegerField(
        db_column="nombreplace"
    )  # Field name made lowercase.
    chargeutile = models.DecimalField(
        db_column="chargeutile", max_digits=19, decimal_places=4
    )  # Field name made lowercase.
    valeurneuve = models.DecimalField(
        db_column="valeurneuve", max_digits=19, decimal_places=4
    )  # Field name made lowercase.
    valeurvenale = models.DecimalField(
        db_column="valeurvenale", max_digits=19, decimal_places=4
    )  # Field name made lowercase.
    valeuraccessoire = models.DecimalField(
        db_column="valeuraccessoire", max_digits=19, decimal_places=4
    )  # Field name made lowercase.
    remorque = models.BooleanField(
        db_column="remorque", default=False
    )  # Field name made lowercase.
    matrem1 = models.CharField(
        db_column="matrem1", max_length=50, default=""
    )  # Field name made lowercase.
    matrem2 = models.CharField(
        db_column="matrem2", max_length=50, default=""
    )  # Field name made lowercase.
    extincteur = models.BooleanField(
        db_column="extincteur", default=False
    )  # Field name made lowercase.
    idprofession = models.IntegerField(
        db_column="idprofession", blank=True, null=True
    )  # Field name made lowercase.
    conducteur = models.TextField(
        db_column="conducteur", max_length=2048, blank=True, null=True
    )  # Field name made lowercase.
    assure = models.CharField(
        db_column="assure", max_length=255, blank=True, null=True
    )  # Field name made lowercase.
    adressecnd = models.CharField(
        db_column="adressecnd",
        max_length=50,
        default="",
        null=True,
        blank=True,
    )  # Field name made lowercase.
    villecnd = models.IntegerField(
        db_column="villecnd", blank=True, null=True
    )  # Field name made lowercase.
    sexe = models.CharField(
        db_column="sexe", max_length=1, default="M"
    )  # Field name made lowercase.
    datemec = models.DateTimeField(
        db_column="datemec", blank=True, null=True
    )  # Field name made lowercase.
    nummoteur = models.CharField(
        db_column="nummoteur", max_length=50, blank=True, null=True
    )  # Field name made lowercase.
    numchassis = models.CharField(
        db_column="numchassis", max_length=50, blank=True, null=True
    )  # Field name made lowercase.
    nbreextinteur = models.SmallIntegerField(
        db_column="nbreextinteur", blank=True, null=True
    )  # Field name made lowercase.
    idmarque = models.IntegerField(
        db_column="idmarque", default=0
    )  # Field name made lowercase.
    typevehicule = models.CharField(
        db_column="typevehicule", max_length=50, blank=True, null=True
    )  # Field name made lowercase.
    idtypevehicule = models.ForeignKey(
        TypeVehicule,
        db_column="idtypevehicule",
        verbose_name="Id Type Véhicule",
        default=0,
        null=True,
        on_delete=models.SET_NULL,
    )
    idgenrevehicule = models.ForeignKey(
        GenreVehicule,
        db_column="idgenrevehicule",
        verbose_name="Id Genre Véhicule",
        default=0,
        null=True,
        on_delete=models.SET_NULL,
    )
    modelevehicule = models.CharField(
        verbose_name="Modèle du véhicule",
        max_length=30,
        db_column="modelevehicule",
        default="",
    )
    attestation = models.CharField(
        db_column="attestation", max_length=50, default=""
    )  # Field name made lowercase.
    typepermis = models.CharField(
        db_column="typepermis", max_length=20, blank=True, null=True
    )  # Field name made lowercase.
    permis = models.CharField(
        db_column="permis", max_length=50, null=True, blank=True, default=""
    )  # Field name made lowercase.
    datenaicnd = models.DateTimeField(
        db_column="datenaicnd", blank=True, null=True
    )  # Field name made lowercase.
    iddelegation = models.IntegerField(
        db_column="iddelegation", blank=True, null=True
    )  # Field name made lowercase.
    agrement = models.CharField(
        db_column="agrement", max_length=50, default=""
    )  # Field name made lowercase.
    observation = models.CharField(
        db_column="observation", max_length=50, default=""
    )  # Field name made lowercase.
    idolcontratdet = models.IntegerField(
        db_column="idoldcontratdet", default=0
    )  # Field name made lowercase.
    oldnumeropolice = models.CharField(
        db_column="oldnumeropolice", max_length=50, default=""
    )  # Field name made lowercase.
    oldattestation = models.CharField(
        db_column="oldattestation", max_length=50, default=""
    )  # Field name made lowercase.
    oldmarque = models.IntegerField(
        db_column="oldmarque", default=0
    )  # Field name made lowercase.
    oldtypevehicule = models.CharField(
        db_column="oldtypevehicule", max_length=50, default=""
    )  # Field name made lowercase.
    oldmatricule = models.CharField(
        db_column="oldmatricule", max_length=50, default=""
    )  # Field name made lowercase.
    carteverte = models.BooleanField(
        db_column="carteverte", default=False
    )  # Field name made lowercase.
    numcarteverte = models.CharField(
        db_column="numcarteverte", max_length=50, default=""
    )  # Field name made lowercase.
    primeannuelle = models.DecimalField(
        db_column="primeannuelle", max_digits=19, decimal_places=4, default=0
    )  # Field name made lowercase.
    primenette = models.DecimalField(
        db_column="primenette", max_digits=19, decimal_places=4, default=0
    )  # Field name made lowercase.
    mt_delegation = models.DecimalField(
        db_column="mt_delegation", max_digits=19, decimal_places=4, default=0
    )  # Field name made lowercase.
    codecarburant = models.CharField(
        db_column="codecarburant", max_length=10, blank=True, null=True
    )  # Field name made lowercase.
    attestationprov = models.CharField(
        db_column="attestationprov", max_length=50, blank=True, null=True
    )  # Field name made lowercase.
    pc_control = models.BooleanField(
        db_column="pc_control", default=False
    )  # Field name made lowercase.
    cg_control = models.BooleanField(
        db_column="cg_control", default=False
    )  # Field name made lowercase.
    numpccnd = models.CharField(
        db_column="numpccnd", max_length=50, null=True, blank=True, default=""
    )  # Field name made lowercase.
    pctype = models.CharField(
        db_column="pctype", max_length=50, default="000000000000"
    )  # Field name made lowercase.
    taxeenregistrement = models.DecimalField(
        db_column="taxeenregistrement",
        max_digits=19,
        decimal_places=4,
        default=0,
    )
    fga = models.DecimalField(
        db_column="fga", max_digits=19, decimal_places=4, default=0
    )
    securite = models.ForeignKey(
        SystemeSecurite,
        db_column="codealarme",
        null=True,
        default=1,
        on_delete=models.CASCADE,
    )
    taux_reduction = models.DecimalField(
        db_column="tauxreduction",
        verbose_name="Taux de réduction commerciale",
        max_digits=5,
        decimal_places=2,
        null=True,
        default=0.0,
    )

    class Meta:
        db_table = "stdcontratdetail"
        verbose_name = "Détail de contrat"
        verbose_name_plural = "Détails de contrat"


class ContratDetGarantie(models.Model):
    idcontratdetgarantie = models.AutoField(primary_key=True)
    idcontratdetail = models.ForeignKey(
        ContratDetail,
        db_column="idcontratdetail",
        related_name="garanties",
        on_delete=models.CASCADE,
    )
    idgarantie = models.ForeignKey(
        SousGarantie,
        db_column="idgarantie",
        related_name="detail_contrat",
        default=1,
        on_delete=models.CASCADE,
    )
    acquise = models.BooleanField()
    capital = models.DecimalField(
        max_digits=19, decimal_places=4, null=True, blank=True
    )
    franchise = models.DecimalField(
        max_digits=19, decimal_places=4, null=True, blank=True
    )
    textefranchise = models.CharField(max_length=120, null=True, blank=True)
    primeannuelle = models.DecimalField(max_digits=19, decimal_places=4)
    primenette = models.DecimalField(max_digits=19, decimal_places=4)
    taxe = models.DecimalField(max_digits=19, decimal_places=4)
    minfranchise = models.DecimalField(max_digits=19, decimal_places=4)
    maxfranchise = models.DecimalField(max_digits=19, decimal_places=4)
    tauxfranchise = models.DecimalField(
        db_column="tauxfranchise",
        max_digits=5,
        decimal_places=2,
        default=0,
        null=True,
        blank=True,
    )
    deces = models.DecimalField(
        db_column="deces",
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
    )
    ipp = models.DecimalField(
        db_column="ipp", max_digits=19, decimal_places=4, blank=True, null=True
    )
    fraismed = models.DecimalField(
        db_column="fraismed",
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
    )
    hosp = models.DecimalField(
        db_column="hosp",
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
    )
    Formule = models.IntegerField(db_column="formule", blank=True, null=True)

    class Meta:
        db_table = "stdcontratdetgarantie"
        verbose_name = "Garantie souscrite"
        verbose_name_plural = "Garanties souscrites"
        unique_together = (
            ("idcontratdetgarantie", "idcontratdetail", "idgarantie"),
        )


class QuittanceFn(models.Model):
    IdDevis = models.IntegerField(null=True)
    IdContrat = models.IntegerField(null=True)
    RaisonSociale = models.CharField(max_length=100)
    LibelleIntermediaire = models.CharField(max_length=50)
    IdClient = models.IntegerField()
    NumeroDevis = models.CharField(max_length=50, null=True)
    NumeroPolice = models.CharField(max_length=50, null=True)
    NumeroAvenant = models.CharField(max_length=50)
    NomClient = models.CharField(max_length=122)
    AdresseClient = models.CharField(max_length=100)
    DateEffet = models.DateField()
    DateExpiration = models.DateField()
    DateEmission = models.DateField()
    Duree = models.IntegerField()
    PrimeNette = models.DecimalField(max_digits=19, decimal_places=4)
    PrimeNetteHorsFga = models.DecimalField(max_digits=19, decimal_places=4)
    Fga = models.DecimalField(max_digits=19, decimal_places=4)
    Accessoire = models.DecimalField(max_digits=19, decimal_places=4)
    AccessoireCompagnie = models.DecimalField(max_digits=19, decimal_places=4)
    AccessoireIntermediaire = models.DecimalField(
        max_digits=19, decimal_places=4
    )
    TaxeEnregistrement = models.DecimalField(max_digits=19, decimal_places=4)
    PrimeTtc = models.DecimalField(max_digits=19, decimal_places=4)
    Confirme = models.BooleanField(null=True)
    LibelleProduit = models.CharField(max_length=60)
    LibelleCategorie = models.CharField(max_length=100)
    CommissionIntermediaire = models.DecimalField(
        max_digits=19, decimal_places=4
    )
    CommissionGestionnaire = models.DecimalField(
        max_digits=19, decimal_places=4
    )
    CommissionAperition = models.DecimalField(max_digits=19, decimal_places=4)
    TitreClient = models.CharField(max_length=100)
    ProfessionClient = models.CharField(max_length=100)
    TypeAssure = models.CharField(max_length=100)
    TypeSouscripteur = models.CharField(max_length=100)
    TelephoneClient = models.CharField(max_length=20)
    MobileClient = models.CharField(max_length=20)
    AdresseGeographique = models.CharField(max_length=100)
    EmailClient = models.CharField(max_length=254)
    Cedeao = models.DecimalField(max_digits=19, decimal_places=4)
    LibelleMouvement = models.CharField(max_length=50)
    NomAssure = models.CharField(max_length=122)
    AdresseAssure = models.CharField(max_length=100)
    NumeroQuittance = models.CharField(max_length=16)
    LibelleOffre = models.CharField(max_length=100)
    LibelleBareme = models.CharField(max_length=11)
    CodeCategorie = models.CharField(max_length=3, default="")
    FraisGestion = models.DecimalField(max_digits=19, decimal_places=4)
    NumeroPoliceConnexe = models.CharField(max_length=50, default="")
    CodeIntermediaire = models.CharField(max_length=10, default="0000")
    DateNaissanceClient = models.DateField()
    DateNaissanceAssure = models.DateField()
    NumeroFacture = models.CharField(max_length=20, default="")

    def __str__(self):
        if self.NumeroDevis:
            return (
                "Devis N°: "
                + self.NumeroDevis
                + " du client "
                + self.NomClient
            )
        elif self.NumeroAvenant:
            return (
                "Police N°: "
                + self.NumeroPolice
                + " du client "
                + self.NomClient
            )
        return "Devis ou police invalide du client " + self.NomClient

    class Meta:
        managed = False


class GarantieContratFlotte(models.Model):
    IdContrat = models.IntegerField()
    NatureRisque = models.CharField(max_length=60)
    Garantie = models.CharField(max_length=40)
    SommeMaxGarantie = models.CharField(max_length=40)
    Franchise = models.CharField(max_length=40)
    PrimeNette = models.DecimalField(max_digits=19, decimal_places=4)

    def __str__(self):
        return self.NatureRisque

    class Meta:
        managed = False


###############################################


class VehiculeContrat(models.Model):
    IdContrat = models.IntegerField()
    LibelleTarif = models.CharField(max_length=100)
    LibelleCategorie = models.CharField(max_length=100)
    IdMarque = models.IntegerField()
    LibelleMarque = models.CharField(max_length=60)
    IdTypeVehicule = models.IntegerField()
    LibelleTypeVehicule = models.CharField(max_length=255)
    ChargeUtile = models.DecimalField(max_digits=19, decimal_places=4)
    Puissance = models.SmallIntegerField()
    Immatriculation = models.CharField(max_length=50)
    DateMec = models.DateField()
    CodeEnergie = models.CharField(max_length=10)
    LibelleEnergie = models.CharField(max_length=15)
    ValeurNeuve = models.DecimalField(max_digits=19, decimal_places=4)
    ValeurVenale = models.DecimalField(max_digits=19, decimal_places=4)
    NombrePlace = models.SmallIntegerField()
    Rc = models.DecimalField(max_digits=19, decimal_places=4)
    Fga = models.DecimalField(max_digits=19, decimal_places=4)
    Cedeao = models.DecimalField(max_digits=19, decimal_places=4)
    Recours = models.DecimalField(max_digits=19, decimal_places=4)
    RecoursAnticipe = models.DecimalField(max_digits=19, decimal_places=4)
    RecoursExpress = models.DecimalField(max_digits=19, decimal_places=4)
    Dommages = models.DecimalField(max_digits=19, decimal_places=4)
    Collision = models.DecimalField(max_digits=19, decimal_places=4)
    BrisDeGlaces = models.DecimalField(max_digits=19, decimal_places=4)
    Incendie = models.DecimalField(max_digits=19, decimal_places=4)
    Explosion = models.DecimalField(max_digits=19, decimal_places=4)
    VolSimple = models.DecimalField(max_digits=19, decimal_places=4)
    VolMainsArmees = models.DecimalField(max_digits=19, decimal_places=4)
    Vandalisme = models.DecimalField(max_digits=19, decimal_places=4)
    VolAccessoires = models.DecimalField(max_digits=19, decimal_places=4)
    IndividuelleChauffeur = models.DecimalField(
        max_digits=19, decimal_places=4
    )
    InfirmitePermanente = models.DecimalField(max_digits=19, decimal_places=4)
    IncapaciteTemporaire = models.DecimalField(max_digits=19, decimal_places=4)
    Deces = models.DecimalField(max_digits=19, decimal_places=4)
    FraisTraitement = models.DecimalField(max_digits=19, decimal_places=4)
    Immobilisation = models.DecimalField(max_digits=19, decimal_places=4)
    NsiaAssistCar = models.DecimalField(max_digits=19, decimal_places=4)
    PersonnesTransportees = models.DecimalField(
        max_digits=19, decimal_places=4
    )
    RecoursTiersIncendie = models.DecimalField(max_digits=19, decimal_places=4)
    SecuriteRoutiere = models.DecimalField(max_digits=19, decimal_places=4)
    PrimeHorsTaxes = models.DecimalField(max_digits=19, decimal_places=4)
    Reduction = models.DecimalField(max_digits=19, decimal_places=4)
    PrimeNette = models.DecimalField(max_digits=19, decimal_places=4)

    def __str__(self):
        return "{} immatriculé {}".format(
            self.LibelleMarque, self.Immatriculation
        )

    class Meta:
        managed = False


class LogRecord(models.Model):
    msg = models.CharField(max_length=255)
    level_name = models.CharField(max_length=20)

    class Meta:
        managed = False


class AyantDroitIa(models.Model):
    id_ayant_droit = models.AutoField(
        verbose_name="Id Ayant-droit",
        db_column="idayantdroit",
        primary_key=True,
    )
    id_assure = models.IntegerField(
        verbose_name="Assuré", db_column="idassure"
    )
    qualite_ayant_droit = models.ForeignKey(
        QualiteAyantDroit,
        verbose_name="Qualité",
        db_column="idqualiteayantdroit",
        on_delete=models.DO_NOTHING,
    )
    nom_ayant_droit = models.CharField(
        verbose_name="Nom", db_column="nomayantdroit", max_length=80
    )
    prenoms_ayant_droit = models.CharField(
        verbose_name="Prénoms", db_column="prenomsayantdroit", max_length=80
    )
    part = models.DecimalField(
        verbose_name="Part", db_column="part", max_digits=5, decimal_places=2
    )

    def __str__(self):
        if self.prenoms_ayant_droit:
            return self.nom_ayant_droit + " " + self.prenoms_ayant_droit
        return self.nom_ayant_droit

    class Meta:
        db_table = "stdayantdroitia"
        verbose_name = "Ayant-droit IA"
        verbose_name_plural = "Ayant-droits IA"


class Quittance(models.Model):
    idquittance = models.AutoField(primary_key=True, db_column="idquittance")
    exercice = models.SmallIntegerField(db_column="exercice")
    numeroquittance = models.CharField(
        max_length=16, db_column="numeroquittance", unique=True
    )
    police = models.CharField(
        max_length=50, db_column="numeropolice", verbose_name="Numéro Police"
    )
    intermediaire = models.ForeignKey(
        Intermediaire, db_column="idintermediaire", on_delete=models.DO_NOTHING
    )
    client = models.ForeignKey(
        Client, db_column="idclient", on_delete=models.DO_NOTHING
    )
    nature = models.CharField(max_length=1, db_column="nature")
    dateeffet = models.DateTimeField(db_column="dateeffet")
    dateexpiration = models.DateTimeField(db_column="dateexpiration")
    source = models.SmallIntegerField(db_column="source")
    statut = models.SmallIntegerField(db_column="statut")
    primenette = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="primenette"
    )
    taxe = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="taxe"
    )
    accessoire = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="accessoire"
    )
    commission = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="commission"
    )
    encaissee = models.BooleanField(db_column="encaissee")
    mt_encaisse = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="mt_encaisse"
    )
    mt_regle = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="mt_regle"
    )
    reglee = models.BooleanField(db_column="reglee")
    quittanceanullation = models.ForeignKey(
        "self",
        db_column="idquittannul",
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
    )
    coassurance = models.BooleanField(db_column="coassurance")
    aperiteur = models.ForeignKey(
        Compagnie, db_column="idaperiteur", on_delete=models.DO_NOTHING
    )
    directcie = models.BooleanField(db_column="directcie")
    reglecoass = models.BooleanField(db_column="reglecoass")
    reglecion = models.BooleanField(db_column="reglecion")
    dateemission = models.DateField(db_column="dateemission")
    primettc = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="primettc"
    )
    produit = models.ForeignKey(
        Produit, db_column="idproduit", on_delete=models.DO_NOTHING
    )
    exoneredetaxes = models.BooleanField(db_column="exoneredetaxes")
    exoneredeaccess = models.BooleanField(db_column="exoneredeaccess")
    taux_commission = models.DecimalField(
        max_digits=5, decimal_places=2, null=True
    )

    def __str__(self):
        return "Quittance n° {} de la police {}".format(
            self.quittance, self.police
        )

    class Meta:
        db_table = "stdquittance"
        verbose_name = "Quittance"
        verbose_name_plural = "Quittances"

    # @property
    # def contrat(self):
    #     cnt = Contrat.objects.filter(idquittance=self, numeropolice=self.police)
    #     if cnt:
    #         cnt = cnt.first()
    #     return cnt


class DetailQuittance(models.Model):
    iddetquittance = models.AutoField(
        primary_key=True, db_column="iddetquittance"
    )
    quittance = models.ForeignKey(
        Quittance, models.CASCADE, db_column="idquittance"
    )
    branche = models.ForeignKey(
        Garantie, models.CASCADE, db_column="idbranchereassurance"
    )
    tauxtaxe = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="tauxtaxe"
    )
    tauxcommission = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="tauxcommission"
    )
    primenette = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="primenette"
    )
    taxe = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="taxe"
    )
    commission = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="commission"
    )

    class Meta:
        db_table = "stddetquittance"
        verbose_name = "Ligne de quittance"
        verbose_name_plural = "Lignes de quittance"
        unique_together = (
            ("quittance", "branche", "tauxtaxe", "tauxcommission"),
        )


class Encaissement(models.Model):
    idencaissement = models.AutoField(
        primary_key=True, db_column="idencaissement"
    )
    numeropiece = models.CharField(max_length=20, db_column="numeropiece")
    dateencaissement = models.DateTimeField(db_column="dateencaissement")
    montantencaissement = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="montantencaissement"
    )
    montantenattente = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="montantenattente",
    )
    montantdeduit = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="montantdeduit",
    )
    modepaiement = models.ForeignKey(
        ModeEncaissement,
        db_column="idmodepaiement",
        on_delete=models.DO_NOTHING,
    )
    banque = models.ForeignKey(
        Banque,
        blank=True,
        null=True,
        db_column="idbanque",
        on_delete=models.SET_NULL,
    )
    # Numéro du chèque, du virement ou de la traite selon le mode
    numerocheque = models.CharField(
        max_length=50, blank=True, null=True, db_column="numerocheque"
    )
    # Référence de la compensation
    compte_compensation = models.CharField(
        max_length=50, blank=True, null=True, db_column="compte_compensation"
    )
    utilisateur = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="encaissements",
        null=True,
        blank=True,
        db_column="idutilisateur",
    )
    datesaisie = models.DateTimeField(db_column="datesaisie")
    piece_annulee = models.BooleanField(db_column="piece_annulee")
    dateannulation = models.DateTimeField(
        blank=True, null=True, db_column="dateannulation"
    )
    nomannulation = models.CharField(
        max_length=50, blank=True, null=True, db_column="nomannulation"
    )
    motifannulation = models.CharField(
        max_length=255, blank=True, null=True, db_column="motifannulation"
    )
    datesaisieannulation = models.DateTimeField(
        blank=True, null=True, db_column="datesaisieannulation"
    )
    nomtireurcheque = models.CharField(
        max_length=50, db_column="nomtireurcheque"
    )
    referencetransaction = models.UUIDField(
        verbose_name="Reference Transaction Mobile",
        db_column="referencetransaction",
        unique=True,
        default=uuid.uuid4,
        editable=False,
        null=True,
    )
    # Compléments de saisie : sp_enregistrement_encaissement ne les connaît pas, ils sont
    # écrits par save_premium_collection juste après elle (même transaction)
    numero_bordereau = models.CharField(
        max_length=50, blank=True, null=True, db_column="numerobordereau"
    )  # Espèces
    numero_recu_operateur = models.CharField(
        max_length=50, blank=True, null=True, db_column="numerorecuoperateur"
    )  # Paiement mobile : reçu remis par l'opérateur
    motif_compensation = models.CharField(
        max_length=255, blank=True, null=True, db_column="motifcompensation"
    )
    # Réencaissement d'un chèque impayé : références saisies et chèque concerné
    reference_reencaissement = models.CharField(
        max_length=100, blank=True, null=True, db_column="referencereencaissement"
    )
    cheque_impaye = models.ForeignKey(
        "Cheque",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reencaissements",
        db_column="idchequeimpaye",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return "Encaissement n° {} ({}) du {}".format(
            self.numeropiece, self.idencaissement, self.dateencaissement
        )

    @property
    def demande_annulation(self):
        """
        Retourne la demande d'annulation associée à l'instance
        """
        from django.contrib.contenttypes.models import ContentType

        from autorisations.models import DemandeAutorisation

        content_type = ContentType.objects.get_for_model(self.__class__)
        return DemandeAutorisation.objects.filter(
            content_type=content_type,
            object_id=self.idencaissement,
        ).first()

    @property
    def demande_annulation_en_cours(self):
        """
        Indique si l'encaissement a une demande d'annulation en cours
        """
        from autorisations.models import StatutDemande

        demande = self.demande_annulation
        return (
            demande.statut
            in [StatutDemande.APPROUVEE, StatutDemande.EN_ATTENTE]
            if demande
            else None
        )

    class Meta:
        db_table = "stdencaissement"
        verbose_name = "Encaissement"
        verbose_name_plural = "Encaissements"
        indexes = [
            models.Index(fields=["numeropiece"]),
            models.Index(fields=["piece_annulee", "dateencaissement"]),
            models.Index(fields=["utilisateur", "dateencaissement"]),
        ]
        ordering = ["-dateencaissement"]


class DetailEncaissement(models.Model):
    iddetailencaissement = models.AutoField(
        primary_key=True, db_column="iddetailencaissement"
    )
    encaissement = models.ForeignKey(
        Encaissement,
        db_column="idencaissement",
        related_name="details",
        on_delete=models.CASCADE,
    )
    numeroquittance = models.ForeignKey(
        Quittance,
        to_field="numeroquittance",
        db_column="numeroquittance",
        on_delete=models.CASCADE,
    )
    indiceacompte = models.SmallIntegerField(db_column="indiceacompte")
    soldeinitial = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="soldeinitial"
    )
    montantreglement = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="montantreglement"
    )
    montantecart = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="montantecart"
    )
    ecart = models.BooleanField(db_column="ecart")
    code_ecart = models.CharField(max_length=1, db_column="code_ecart")
    montant_encaissement = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="montant_encaissement"
    )
    dedcommission_intermediaire = models.BooleanField(
        db_column="dedcommission_intermediaire"
    )
    dedcommission_gestionnaire = models.BooleanField(
        db_column="dedcommission_gestionnaire"
    )
    dedcommission_coassurance = models.BooleanField(
        db_column="dedcommission_coassurance"
    )
    dedaccessoireintermediaire = models.BooleanField(
        db_column="dedaccessoireintermediaire"
    )
    dedaccessoiregestionnaire = models.BooleanField(
        db_column="dedaccessoiregestionnaire"
    )
    dedtaxecommission = models.BooleanField(db_column="dedtaxecommission")
    dedtaxeaccessoire = models.BooleanField(
        blank=True, null=True, db_column="dedtaxeaccessoire"
    )
    comintermediaire = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="comintermediaire",
    )
    comgestionnaire = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="comgestionnaire",
    )
    comconseiller = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="comconseiller",
    )
    comcoassurance = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="comcoassurance",
    )
    accintermediaire = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="accintermediaire",
    )
    accgestionnaire = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="accgestionnaire",
    )
    dedcoassurance = models.BooleanField(
        blank=True, null=True, db_column="dedcoassurance"
    )
    primecedee = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="primecedee",
    )
    taxe_commission_deduit = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="taxe_commission_deduit",
    )
    taxeaccessoire_deduit = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="taxeaccessoire_deduit",
    )
    impotdeduit = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="impotdeduit",
    )

    class Meta:
        db_table = "stddetailencaissement"
        verbose_name = "Ligne d'encaissement"
        verbose_name_plural = "Lignes d'encaissement"


class ReversementCompagnie(models.Model):
    id_reversement = models.AutoField(
        primary_key=True,
        verbose_name="ID Reversement",
        db_column="idreversement",
    )
    compagnie = models.ForeignKey(
        Compagnie,
        verbose_name="Compagnie",
        db_column="idcompagnie",
        on_delete=models.DO_NOTHING,
    )
    numero_reversement = models.CharField(
        max_length=16,
        db_column="numeroreversement",
        verbose_name="Numéro Reversement",
    )
    date_reversement = models.DateField(
        db_column="datereversement",
        verbose_name="Date de reversement",
        null=True,
        blank=True,
    )
    montant_reversement = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        db_column="montantreversement",
        verbose_name="Montant reversé",
    )
    montant_en_attente = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="montantenattente",
    )
    montant_deduit = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="montantdeduit",
    )
    mode_reversement = models.ForeignKey(
        ModeEncaissement,
        verbose_name="Mode de reversement",
        db_column="idmodereversement",
        on_delete=models.DO_NOTHING,
        null=True,
        blank=True,
    )
    banque = models.ForeignKey(
        Banque,
        blank=True,
        null=True,
        db_column="idbanque",
        on_delete=models.SET_NULL,
    )
    numero_cheque = models.CharField(
        max_length=20, blank=True, null=True, db_column="numerocheque"
    )
    compte_compensation = models.CharField(
        max_length=10, blank=True, null=True, db_column="comptecompensation"
    )
    utilisateur = models.ForeignKey(
        UranusUser,
        blank=True,
        null=True,
        db_column="idutilisateur",
        on_delete=models.SET_NULL,
        related_name="enregistrements_reversement",
    )
    date_saisie = models.DateTimeField(db_column="datesaisie")
    piece_annulee = models.BooleanField(db_column="pieceannulee")
    date_annulation = models.DateTimeField(
        blank=True, null=True, db_column="dateannulation"
    )
    nom_annulation = models.CharField(
        max_length=50, blank=True, null=True, db_column="nomannulation"
    )
    motif_annulation = models.CharField(
        max_length=60, blank=True, null=True, db_column="motifannulation"
    )
    date_saisie_annulation = models.DateTimeField(
        blank=True, null=True, db_column="datesaisieannulation"
    )
    nom_tireur_cheque = models.CharField(
        max_length=50, db_column="nomtireurcheque", null=True, blank=True
    )

    valide = models.BooleanField(db_column="valide", default=False)
    date_validation = models.DateTimeField(
        db_column="datevalidation", null=True, blank=True
    )
    utilisateur_validation = models.ForeignKey(
        UranusUser,
        blank=True,
        null=True,
        db_column="idutilisateurvalidation",
        on_delete=models.SET_NULL,
        related_name="validations_reversement",
    )

    def __str__(self):
        return "Reversement n° {} ({}) du {}".format(
            self.numero_reversement, self.id_reversement, self.date_reversement
        )

    class Meta:
        db_table = "stdreversementcompagnie"
        verbose_name = "Reversement de primes"
        verbose_name_plural = "Reversements de primes"


class DetailReversement(models.Model):
    id_detail_reversement = models.AutoField(
        primary_key=True, db_column="iddetailreversement"
    )
    reversement = models.ForeignKey(
        ReversementCompagnie,
        db_column="idreversement",
        related_name="details",
        on_delete=models.CASCADE,
        verbose_name="Reversement",
    )
    ligne_encaissement = models.ForeignKey(
        DetailEncaissement,
        db_column="iddetailencaissement",
        on_delete=models.CASCADE,
    )
    solde_initial = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="soldeinitial"
    )
    montant_reverse = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        db_column="montantreverse",
        verbose_name="Montant reversé",
    )

    ded_commission_intermediaire = models.BooleanField(
        db_column="dedcommission_intermediaire"
    )
    ded_commission_gestionnaire = models.BooleanField(
        db_column="dedcommission_gestionnaire"
    )
    ded_commission_coassurance = models.BooleanField(
        db_column="dedcommission_coassurance"
    )
    ded_accessoire_intermediaire = models.BooleanField(
        db_column="dedaccessoireintermediaire"
    )
    ded_accessoire_gestionnaire = models.BooleanField(
        db_column="dedaccessoiregestionnaire"
    )
    ded_taxe_commission = models.BooleanField(db_column="dedtaxecommission")
    ded_taxe_accessoire = models.BooleanField(
        blank=True, null=True, db_column="dedtaxeaccessoire"
    )
    com_intermediaire = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="comintermediaire",
    )
    com_gestionnaire = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="comgestionnaire",
    )
    com_conseiller = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="comconseiller",
    )
    com_coassurance = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="comcoassurance",
    )
    acc_intermediaire = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="accintermediaire",
    )
    acc_gestionnaire = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="accgestionnaire",
    )
    ded_coassurance = models.BooleanField(
        blank=True, null=True, db_column="dedcoassurance"
    )
    prime_cedee = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="primecedee",
    )
    taxe_commission_deduit = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="taxe_commission_deduit",
    )
    taxe_accessoire_deduit = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        blank=True,
        null=True,
        db_column="taxeaccessoire_deduit",
    )

    class Meta:
        db_table = "stddetailreversement"
        verbose_name = "Ligne de reversement"
        verbose_name_plural = "Lignes de reversement"


class Numero(models.Model):
    id = models.AutoField(primary_key=True, verbose_name="ID", db_column="id")
    idmodule = models.CharField(max_length=5, db_column="idmodule")
    exercice = models.SmallIntegerField(db_column="exercice")
    libelle = models.CharField(max_length=50, db_column="libelle")
    numero = models.IntegerField(db_column="numero")
    cloture = models.BooleanField(db_column="cloture")

    class Meta:
        db_table = "stdnumero"
        unique_together = (("idmodule", "exercice"),)


class EnregistrementEncaissement(models.Model):
    mode_encaissement = models.IntegerField()
    banque = models.IntegerField()
    montant_total = models.DecimalField(max_digits=19, decimal_places=4)
    numero_cheque = models.CharField(max_length=20)
    reference_encaissement = models.CharField(max_length=40)
    reference_compensation = models.CharField(max_length=10)
    nom_emetteur = models.CharField(max_length=50)
    liste_quittance = models.CharField(max_length=900)

    class Meta:
        managed = False


class DemandeContratPourEncaissement(models.Model):
    referenceclient = models.CharField(max_length=60, null=True, blank=True)
    referencecontrat = models.CharField(max_length=60, null=True, blank=True)

    class Meta:
        managed = False


class EncaissementQuittance:
    numero_quittance = None
    montant_encaissement = None

    def __init__(self, numero, montant):
        self.numero_quittance = numero
        self.montant_encaissement = montant


class ReversementPrime:
    identifiant_encaissement = None
    montant_reversement = None

    def __init__(self, identifiant, montant):
        self.identifiant_encaissement = identifiant
        self.montant_reversement = montant


class ReversementGroupePrime:
    compagnie = None
    mode_reversement = None
    date_reversement = None
    banque = None
    montant_total = None
    numero_cheque = None
    nom_emetteur = None
    reference_reversement = None
    reference_compensation = None
    liste_encaissement = None

    def __init__(
        self,
        compagnie,
        mode_reversement,
        date_reversement,
        banque,
        montant_total,
        numero_cheque,
        nom_emetteur,
        reference_reversement,
        reference_compensation,
        liste_encaissement,
    ):
        self.compagnie = compagnie
        self.mode_reversement = mode_reversement
        self.date_reversement = date_reversement
        self.banque = banque
        self.montant_total = montant_total
        self.numero_cheque = numero_cheque
        self.nom_emetteur = nom_emetteur
        self.reference_reversement = reference_reversement
        self.reference_compensation = reference_compensation
        self.liste_encaissement = liste_encaissement


class EncaissementGroupeQuittance:
    mode_encaissement = None
    date_encaissement = None
    banque = None
    montant_total = None
    numero_cheque = None
    reference_encaissement = None
    reference_compensation = None
    nom_emetteur = None
    liste_quittance = None

    def __init__(
        self,
        mode_encaissement,
        date_encaissement,
        banque,
        montant_total,
        numero_cheque,
        reference_encaissement,
        reference_compensation,
        nom_emetteur,
        liste_quittance,
    ):
        self.mode_encaissement = mode_encaissement
        self.date_encaissement = date_encaissement
        self.banque = banque
        self.montant_total = montant_total
        self.numero_cheque = numero_cheque
        self.reference_encaissement = reference_encaissement
        self.reference_compensation = reference_compensation
        self.nom_emetteur = nom_emetteur
        self.liste_quittance = liste_quittance


class AssureIaInfo(models.Model):
    id_devis = models.IntegerField()
    id_devis_detail = models.IntegerField()
    id_assure = models.IntegerField()
    nom = models.CharField(max_length=60)
    prenoms = models.CharField(max_length=60, null=True)
    date_naissance = models.DateField()
    id_profession = models.IntegerField()
    libelle_profession = models.CharField(max_length=150)
    capital_deces = models.DecimalField(max_digits=19, decimal_places=4)
    capital_infirmite = models.DecimalField(max_digits=19, decimal_places=4)
    capital_frais_traitement = models.DecimalField(
        max_digits=19, decimal_places=4
    )
    telephone = models.CharField(max_length=20, null=True)
    adresse_geographique = models.CharField(max_length=100, null=True)
    lieu_naissance = models.CharField(max_length=100, null=True)
    prime_nette = models.DecimalField(max_digits=19, decimal_places=4)
    accessoire = models.DecimalField(max_digits=19, decimal_places=4)
    taxe = models.DecimalField(max_digits=19, decimal_places=4)

    def __str__(self):
        pr = ""
        if self.prenoms:
            pr = " " + self.prenoms.strip()
        return "{}{}({})".format(self.nom, pr, str(self.date_naissance))

    class Meta:
        managed = False


class GarantieSouscrite(models.Model):
    # iddetail = (
    #     models.IntegerField()
    # )  # ID Devis Détail ou ID Contrat Détail en fonction de l'entité
    idsousgarantie = models.IntegerField()
    libellesousgarantie = models.CharField(max_length=100)
    capital = models.DecimalField(max_digits=19, decimal_places=4)
    deces = models.DecimalField(max_digits=19, decimal_places=4)
    ipp = models.DecimalField(max_digits=19, decimal_places=4)
    ft = models.DecimalField(max_digits=19, decimal_places=4)
    primeannuelle = models.DecimalField(max_digits=19, decimal_places=4)
    primenette = models.DecimalField(max_digits=19, decimal_places=4)
    textefranchise = models.CharField(max_length=50)
    entite = models.CharField(max_length=3, default="DEV")
    libelleoption = models.CharField(max_length=50)
    souscrite = models.BooleanField(default=True)
    textegarantiexclusunu = models.TextField(max_length=10)
    textecapitalsunu = models.TextField(max_length=255)
    texteprimeannuellesunu = models.TextField(max_length=255)
    texteprimenettesunu = models.TextField(max_length=255)
    reductioncommerciale = models.DecimalField(max_digits=19, decimal_places=4)
    reductionbns = models.DecimalField(max_digits=19, decimal_places=4)

    def __str__(self):
        return self.libellesousgarantie

    class Meta:
        managed = False


##########################Audit Log Management #########################################
# auditlog.register(AyantDroitIa)
# auditlog.register(ContratDetGarantie)


class AssureIaParDevisOuContrat(models.Model):
    IdAssure = models.IntegerField()
    IdDetail = models.IntegerField()
    Nom = models.CharField(max_length=60)
    Prenoms = models.CharField(max_length=60, null=True, blank=True)
    AdressePostale = models.CharField(max_length=100, null=True, blank=True)
    AdresseGeographique = models.CharField(
        max_length=100, null=True, blank=True
    )
    DateNaissance = models.DateField(null=True, blank=True)
    LieuNaissance = models.CharField(max_length=100, null=True, blank=True)
    Profession = models.CharField(max_length=150, null=True, blank=True)
    CapitalDeces = models.DecimalField(
        max_digits=19, decimal_places=4, null=True, blank=True
    )
    CapitalInfirmite = models.DecimalField(
        max_digits=19, decimal_places=4, null=True, blank=True
    )
    CapitalFraisTraitement = models.DecimalField(
        max_digits=19, decimal_places=4, null=True, blank=True
    )

    def __str__(self):
        if self.Prenoms:
            return self.Prenoms + " " + self.Nom
        return self.Nom

    class Meta:
        managed = False


class ComplementDevisDetailVoyage(models.Model):
    id = models.AutoField(
        db_column="idcomplement",
        primary_key=True,
        verbose_name="ID Complément Devis Détail Voyage",
    )
    devis_detail = models.ForeignKey(
        DevisDetail,
        db_column="iddevisdetail",
        verbose_name="ID Devis Détail",
        on_delete=models.CASCADE,
    )
    pays_destination = models.ForeignKey(
        Pays,
        db_column="idpaysdestination",
        verbose_name="ID Pays Destination",
        related_name="devis_pays_destination",
        default=1,
        on_delete=models.CASCADE,
    )
    pays_voyageur = models.ForeignKey(
        Pays,
        db_column="idpaysvoyageur",
        verbose_name="ID Pays Voyageur",
        related_name="devis_pays_voyageur",
        default=1,
        on_delete=models.CASCADE,
    )
    reference_contrat = models.CharField(
        db_column="referencecontrat",
        verbose_name="Référence Contrat",
        max_length=50,
        null=True,
        blank=True,
        default="",
    )
    numero_attestation = models.CharField(
        db_column="numeroattestation",
        verbose_name="Numéro Attestation",
        max_length=30,
        null=True,
        blank=True,
        default="",
    )
    visa_schengen = models.BooleanField(
        db_column="visaschengen",
        verbose_name="Schengen",
        null=True,
        blank=True,
        default=False,
    )
    numero_passeport = models.CharField(
        db_column="numeropasseport",
        verbose_name="Numéro Passeport",
        max_length=30,
        null=True,
        blank=True,
        default="",
    )

    class Meta:
        db_table = "stdcomplementdevisdetailvoyage"


class ComplementContratDetailVoyage(models.Model):
    id = models.AutoField(
        db_column="idcomplement",
        primary_key=True,
        verbose_name="ID Complément Contrat Détail Voyage",
    )
    contrat_detail = models.ForeignKey(
        ContratDetail,
        db_column="idcontratdetail",
        verbose_name="ID Contrat Détail",
        on_delete=models.CASCADE,
    )
    pays_destination = models.ForeignKey(
        Pays,
        db_column="idpaysdestination",
        verbose_name="ID Pays Destination",
        related_name="contrats_pays_destination",
        default=1,
        on_delete=models.CASCADE,
    )
    pays_voyageur = models.ForeignKey(
        Pays,
        db_column="idpaysvoyageur",
        verbose_name="ID Pays Voyageur",
        related_name="contrats_pays_voyageur",
        default=1,
        on_delete=models.CASCADE,
    )
    reference_contrat = models.CharField(
        db_column="referencecontrat",
        verbose_name="Référence Contrat",
        max_length=50,
        null=True,
        blank=True,
        default="",
    )
    numero_attestation = models.CharField(
        db_column="numeroattestation",
        verbose_name="Numéro Attestation",
        max_length=30,
        null=True,
        blank=True,
        default="",
    )
    visa_schengen = models.BooleanField(
        db_column="visaschengen",
        verbose_name="Schengen",
        null=True,
        blank=True,
        default=False,
    )
    numero_passeport = models.CharField(
        db_column="numeropasseport",
        verbose_name="Numéro Passeport",
        max_length=30,
        null=True,
        blank=True,
        default="",
    )

    class Meta:
        db_table = "stdcomplementcontratdetailvoyage"


#############################################################################
class ComplementDevisDetailDommage(models.Model):
    id = models.AutoField(
        db_column="idcomplement",
        primary_key=True,
        verbose_name="ID Complément Devis Détail Dommage",
    )
    devis_detail = models.ForeignKey(
        DevisDetail,
        db_column="iddevisdetail",
        verbose_name="ID Devis Détail",
        on_delete=models.CASCADE,
    )
    taux_prime = models.DecimalField(
        db_column="tauxprime",
        verbose_name="Taux de prime",
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        default=0,
    )
    montant_prime = models.DecimalField(
        db_column="montantprime",
        verbose_name="Montant de prime",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )

    class Meta:
        db_table = "stdcomplementdevisdetaildommage"


class ComplementContratDetailDommage(models.Model):
    id = models.AutoField(
        db_column="idcomplement",
        primary_key=True,
        verbose_name="ID Complément Contrat Détail Dommage",
    )
    contrat_detail = models.ForeignKey(
        ContratDetail,
        db_column="idcontratdetail",
        verbose_name="ID Contrat Détail",
        on_delete=models.CASCADE,
    )
    taux_prime = models.DecimalField(
        db_column="tauxprime",
        verbose_name="Taux de prime",
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        default=0,
    )
    montant_prime = models.DecimalField(
        db_column="montantprime",
        verbose_name="Montant de prime",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )

    class Meta:
        db_table = "stdcomplementcontratdetaildommage"


#############################################################################
class ComplementDevisDetailRC(models.Model):
    id = models.AutoField(
        db_column="idcomplement",
        primary_key=True,
        verbose_name="ID Complément Devis Détail RC",
    )
    devis_detail = models.ForeignKey(
        DevisDetail,
        db_column="iddevisdetail",
        verbose_name="ID Devis Détail",
        on_delete=models.CASCADE,
    )
    taux_prime = models.DecimalField(
        db_column="tauxprime",
        verbose_name="Taux de prime",
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        default=0,
    )
    assiette_prime = models.DecimalField(
        db_column="assietteprime",
        verbose_name="Assiette de prime",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    nombre_participants = models.IntegerField(
        db_column="nombreparticipants",
        verbose_name="Nombre de participants",
        null=True,
        blank=True,
        default=0,
    )
    id_domaine_activite = models.IntegerField(
        db_column="iddomaineactivite",
        verbose_name="Domaine d'activités",
        null=True,
        blank=True,
        default=0,
    )
    id_activite = models.IntegerField(
        db_column="idactivite",
        verbose_name="Activité",
        null=True,
        blank=True,
        default=0,
    )
    localisation = models.CharField(
        max_length=60,
        db_column="localisation",
        verbose_name="Localisation",
        null=True,
        blank=True,
    )
    date_debut = models.DateField(
        db_column="datedebut",
        verbose_name="Date de début",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "stdcomplementdevisdetailrc"


class ComplementContratDetailRC(models.Model):
    id = models.AutoField(
        db_column="idcomplement",
        primary_key=True,
        verbose_name="ID Complément Contrat Détail RC",
    )
    contrat_detail = models.ForeignKey(
        ContratDetail,
        db_column="idcontratdetail",
        verbose_name="ID Contrat Détail",
        on_delete=models.CASCADE,
    )
    taux_prime = models.DecimalField(
        db_column="tauxprime",
        verbose_name="Taux de prime",
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        default=0,
    )
    assiette_prime = models.DecimalField(
        db_column="assietteprime",
        verbose_name="Assiette de prime",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    nombre_participants = models.IntegerField(
        db_column="nombreparticipants",
        verbose_name="Nombre de participants",
        null=True,
        blank=True,
        default=0,
    )
    id_domaine_activite = models.IntegerField(
        db_column="iddomaineactivite",
        verbose_name="Domaine d'activités",
        null=True,
        blank=True,
        default=0,
    )
    id_activite = models.IntegerField(
        db_column="idactivite",
        verbose_name="Activité",
        null=True,
        blank=True,
        default=0,
    )
    localisation = models.CharField(
        max_length=60,
        db_column="localisation",
        verbose_name="Localisation",
        null=True,
        blank=True,
    )
    date_debut = models.DateField(
        db_column="datedebut",
        verbose_name="Date de début",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "stdcomplementcontratdetailrc"


#############################################################################
class ComplementDevisDetailMrh(models.Model):
    id = models.AutoField(
        db_column="idcomplement",
        primary_key=True,
        verbose_name="ID Complément Devis Détail MRH",
    )
    devis_detail = models.ForeignKey(
        DevisDetail,
        db_column="iddevisdetail",
        verbose_name="ID Devis Détail",
        on_delete=models.CASCADE,
    )
    presence_gardien = models.BooleanField(
        db_column="presencegardien",
        verbose_name="Présence de gardien",
        null=True,
        blank=True,
        default=False,
    )
    occupant_locataire = models.BooleanField(
        db_column="occupantlocataire",
        verbose_name="Occupant Locataire",
        null=True,
        blank=True,
        default=False,
    )
    valeur_loyer = models.DecimalField(
        db_column="valeurloyer",
        verbose_name="Valeur du loyer",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    valeur_contenu = models.DecimalField(
        db_column="valeurcontenu",
        verbose_name="Valeur du contenu",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    valeur_objet_precieux = models.DecimalField(
        db_column="valeurobjetprecieux",
        verbose_name="Valeur des objets précieux",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    valeur_materiel = models.DecimalField(
        db_column="valeurmateriel",
        verbose_name="Valeur du matériel",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    valeur_degat_batiment = models.DecimalField(
        db_column="valeurdegatbatiment",
        verbose_name="Valeur des dégâts au bâtiment",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    valeur_degat_contenu = models.DecimalField(
        db_column="valeurdegatcontenu",
        verbose_name="Valeur des dégâts au contenu",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    localisation = models.CharField(
        db_column="localisation",
        verbose_name="Localisation",
        max_length=100,
        null=True,
        blank=True,
        default="",
    )

    class Meta:
        db_table = "stdcomplementdevisdetailmrh"


class ComplementContratDetailMrh(models.Model):
    id = models.AutoField(
        db_column="idcomplement",
        primary_key=True,
        verbose_name="ID Complément Contrat Détail MRH",
    )
    contrat_detail = models.ForeignKey(
        ContratDetail,
        db_column="idcontratdetail",
        verbose_name="ID Contrat Détail",
        on_delete=models.CASCADE,
    )
    presence_gardien = models.BooleanField(
        db_column="presencegardien",
        verbose_name="Présence de gardien",
        null=True,
        blank=True,
        default=False,
    )
    occupant_locataire = models.BooleanField(
        db_column="occupantlocataire",
        verbose_name="Occupant Locataire",
        null=True,
        blank=True,
        default=False,
    )
    valeur_loyer = models.DecimalField(
        db_column="valeurloyer",
        verbose_name="Valeur du loyer",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    valeur_contenu = models.DecimalField(
        db_column="valeurcontenu",
        verbose_name="Valeur du contenu",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    valeur_objet_precieux = models.DecimalField(
        db_column="valeurobjetprecieux",
        verbose_name="Valeur des objets précieux",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    valeur_materiel = models.DecimalField(
        db_column="valeurmateriel",
        verbose_name="Valeur du matériel",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    valeur_degat_batiment = models.DecimalField(
        db_column="valeurdegatbatiment",
        verbose_name="Valeur des dégâts au bâtiment",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    valeur_degat_contenu = models.DecimalField(
        db_column="valeurdegatcontenu",
        verbose_name="Valeur des dégâts au contenu",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    localisation = models.CharField(
        db_column="localisation",
        verbose_name="Localisation",
        max_length=100,
        null=True,
        blank=True,
        default="",
    )

    class Meta:
        db_table = "stdcomplementcontratdetailmrh"


class ArreteExercice(models.Model):
    id_arrete = models.AutoField(
        verbose_name="ID Arrêté Exercice",
        db_column="idarrete",
        primary_key=True,
    )
    exercice = models.IntegerField(
        verbose_name="Exercice d'inventaire", db_column="exercice", unique=True
    )
    arriere = models.DecimalField(
        verbose_name="Arriérés de l'exercice",
        db_column="arriere",
        max_digits=19,
        decimal_places=4,
    )
    arriere_reporte = models.DecimalField(
        verbose_name="Arriérés reportés",
        db_column="arrierereporte",
        max_digits=19,
        decimal_places=4,
    )

    def __str__(self):
        return "Exercice d'inventaire {}".format(self.exercice)

    class Meta:
        db_table = "stdarreteexercice"
        verbose_name = "Arrêté d'exercice"
        verbose_name_plural = "Arrêtés d'exercice"


#############################################################################
class ComplementDevisDetailSante(models.Model):
    id = models.AutoField(
        db_column="idcomplement",
        primary_key=True,
        verbose_name="ID Complément Devis Détail Santé",
    )
    devis_detail = models.ForeignKey(
        DevisDetail,
        db_column="iddevisdetail",
        verbose_name="ID Devis Détail",
        on_delete=models.CASCADE,
    )

    prime_famille = models.DecimalField(
        db_column="primefamille",
        verbose_name="Prime Famille",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    prime_affilie = models.DecimalField(
        db_column="primeaffilie",
        verbose_name="Prime Affilie",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    prime_globale = models.DecimalField(
        db_column="primeglobale",
        verbose_name="Prime Globale",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    montant_surprime = models.DecimalField(
        db_column="montantsurprime",
        verbose_name="Montant Surprime",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )

    montant_accessoire_manuel = models.DecimalField(
        db_column="montantaccessoiremanuel",
        verbose_name="Montant Accessoire Manuel",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    taux_reduction_commerciale = models.DecimalField(
        db_column="tauxreductioncommerciale",
        verbose_name="Taux Réduction Commerciale",
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        default=0,
    )
    type_contrat = models.ForeignKey(
        TypeContratSante,
        db_column="idtypecontrat",
        verbose_name="ID Type Contrat",
        null=True,
        on_delete=models.SET_NULL,
    )
    gestionnaire_sante = models.CharField(
        max_length=60, db_column="gestionnairesante", null=True, blank=True
    )

    class Meta:
        db_table = "stdcomplementdevisdetailsante"


class ComplementContratDetailSante(models.Model):
    id = models.AutoField(
        db_column="idcomplement",
        primary_key=True,
        verbose_name="ID Complément Contrat Détail Santé",
    )
    contrat_detail = models.ForeignKey(
        ContratDetail,
        db_column="idcontratdetail",
        verbose_name="ID Contrat Détail",
        on_delete=models.CASCADE,
    )
    prime_famille = models.DecimalField(
        db_column="primefamille",
        verbose_name="Prime Famille",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    prime_affilie = models.DecimalField(
        db_column="primeaffilie",
        verbose_name="Prime Affilie",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    prime_globale = models.DecimalField(
        db_column="primeglobale",
        verbose_name="Prime Globale",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    montant_surprime = models.DecimalField(
        db_column="montantsurprime",
        verbose_name="Montant Surprime",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    montant_accessoire_manuel = models.DecimalField(
        db_column="montantaccessoiremanuel",
        verbose_name="Montant Accessoire Manuel",
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        default=0,
    )
    taux_reduction_commerciale = models.DecimalField(
        db_column="tauxreductioncommerciale",
        verbose_name="Taux Réduction Commerciale",
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        default=0,
    )
    type_contrat = models.ForeignKey(
        TypeContratSante,
        db_column="idtypecontrat",
        verbose_name="ID Type Contrat",
        null=True,
        on_delete=models.SET_NULL,
    )
    gestionnaire_sante = models.CharField(
        max_length=60, db_column="gestionnairesante", null=True, blank=True
    )

    class Meta:
        db_table = "stdcomplementcontratdetailsante"


#############################################################################
class ComplementDevisDetailAuto(models.Model):
    id = models.AutoField(
        db_column="idcomplement",
        primary_key=True,
        verbose_name="ID Complément Devis Détail Auto",
    )
    devis_detail = models.ForeignKey(
        DevisDetail,
        db_column="iddevisdetail",
        verbose_name="ID Devis Détail",
        on_delete=models.CASCADE,
    )
    taux_reduction_flotte = models.DecimalField(
        db_column="tauxreductionflotte",
        verbose_name="Taux de réduction flotte",
        max_digits=5,
        decimal_places=2,
        null=True,
        default=0.0,
    )
    bns = models.DecimalField(
        db_column="bns",
        verbose_name="BNS",
        max_digits=5,
        decimal_places=2,
        null=True,
        default=0.0,
    )
    formule_securite_routiere = models.ForeignKey(
        FormuleSecuriteRoutiere,
        db_column="idformulesecuriteroutiere",
        verbose_name="ID Formule Sécurité Routière",
        null=True,
        on_delete=models.SET_NULL,
    )
    assistance_automobile = models.ForeignKey(
        AssistanceAutomobile,
        db_column="idoptionassistance",
        verbose_name="ID Option Assistance",
        null=True,
        on_delete=models.SET_NULL,
    )
    carburant_autre_matiere = models.BooleanField(
        db_column="carburantautrematiere",
        verbose_name="Carburant Autre Matière",
        null=True,
        default=False,
    )
    transport_eleves = models.BooleanField(
        db_column="transporteleves",
        verbose_name="Transport Elèves",
        null=True,
        default=False,
    )
    transport_employes = models.BooleanField(
        db_column="transportemployes",
        verbose_name="Transport Employes",
        null=True,
        default=False,
    )
    transport_passager_supplementaire = models.BooleanField(
        db_column="transportpassagersupplementaire",
        verbose_name="Transport Passager Supplementaire",
        null=True,
        default=False,
    )

    class Meta:
        db_table = "stdcomplementdevisdetailauto"


class ComplementContratDetailAuto(models.Model):
    id = models.AutoField(
        db_column="idcomplement",
        primary_key=True,
        verbose_name="ID Complément Contrat Détail Auto",
    )
    contrat_detail = models.ForeignKey(
        ContratDetail,
        db_column="idcontratdetail",
        verbose_name="ID Contrat Détail",
        on_delete=models.CASCADE,
    )
    taux_reduction_flotte = models.DecimalField(
        db_column="tauxreductionflotte",
        verbose_name="Taux de réduction flotte",
        max_digits=5,
        decimal_places=2,
        null=True,
        default=0.0,
    )
    bns = models.DecimalField(
        db_column="bns",
        verbose_name="BNS",
        max_digits=5,
        decimal_places=2,
        null=True,
        default=0.0,
    )
    formule_securite_routiere = models.ForeignKey(
        FormuleSecuriteRoutiere,
        db_column="idformulesecuriteroutiere",
        verbose_name="ID Formule Sécurité Routière",
        null=True,
        on_delete=models.SET_NULL,
    )
    assistance_automobile = models.ForeignKey(
        AssistanceAutomobile,
        db_column="idoptionassistance",
        verbose_name="ID Option Assistance",
        null=True,
        on_delete=models.SET_NULL,
    )
    carburant_autre_matiere = models.BooleanField(
        db_column="carburantautrematiere",
        verbose_name="Carburant Autre Matière",
        null=True,
        default=False,
    )
    transport_eleves = models.BooleanField(
        db_column="transporteleves",
        verbose_name="Transport Elèves",
        null=True,
        default=False,
    )
    transport_employes = models.BooleanField(
        db_column="transportemployes",
        verbose_name="Transport Employes",
        null=True,
        default=False,
    )
    transport_passager_supplementaire = models.BooleanField(
        db_column="transportpassagersupplementaire",
        verbose_name="Transport Passager Supplementaire",
        null=True,
        default=False,
    )

    class Meta:
        db_table = "stdcomplementcontratdetailauto"


class InfoVehicule(models.Model):
    idcontrat = models.IntegerField()
    raisonsociale = models.CharField(max_length=100)
    adressecompagnie = models.CharField(max_length=100, null=True, blank=True)
    idclient = models.IntegerField()
    numeropolice = models.CharField(max_length=50)
    numeroavenant = models.CharField(max_length=50)
    nomclient = models.CharField(max_length=125)
    adresseclient = models.CharField(max_length=100, null=True, blank=True)
    dateeffet = models.DateField()
    dateexpiration = models.DateField()
    dateemission = models.DateField()
    duree = models.IntegerField()
    numeroimmatriculation = models.CharField(max_length=50)
    numeromoteur = models.CharField(max_length=50, blank=True, null=True)
    numerochassis = models.CharField(max_length=50, blank=True, null=True)
    libellecategorie = models.CharField(max_length=100)
    libellemarque = models.CharField(max_length=60)
    libellecarrosserie = models.CharField(max_length=100)
    titreclient = models.CharField(max_length=100, null=True, blank=True)
    professionclient = models.CharField(max_length=100, null=True, blank=True)
    typeassure = models.CharField(max_length=100, null=True, blank=True)
    typesouscripteur = models.CharField(max_length=100, null=True, blank=True)
    telephoneclient = models.CharField(max_length=20, null=True, blank=True)
    mobileclient = models.CharField(max_length=20, null=True, blank=True)
    adressegeographique = models.CharField(
        max_length=100, null=True, blank=True
    )
    emailclient = models.CharField(max_length=125)
    nomassure = models.CharField(max_length=125)
    adressepostaleassure = models.CharField(
        max_length=100, null=True, blank=True
    )
    adressegeographiqueassure = models.CharField(
        max_length=100, null=True, blank=True
    )

    def __str__(self):
        return self.numeroimmatriculation

    class Meta:
        managed = False


class ContratEcheance(models.Model):
    id_contrat = models.IntegerField()
    numero_police = models.CharField(max_length=60)
    numero_mobile = models.CharField(max_length=20)
    date_expiration = models.DateField()
    libelle_produit = models.CharField(max_length=60)

    class Meta:
        managed = False


class CertificatTransport(models.Model):
    id_certificat = models.AutoField(
        primary_key=True,
        verbose_name="ID Certificat",
        db_column="idcertificat",
    )
    statut = models.CharField(
        max_length=20, verbose_name="Statut", db_column="statut"
    )
    numero_requete = models.CharField(
        verbose_name="No. Requête",
        max_length=20,
        db_column="numerorequete",
        unique=True,
    )
    date_requete = models.DateField(
        verbose_name="Date Requête", db_column="daterequete"
    )
    reference_certificat = models.CharField(
        max_length=20,
        verbose_name="Référence Certificat",
        db_column="referencecertificat",
    )
    date_certificat = models.DateField(
        verbose_name="Date Certificat", db_column="datecertificat"
    )
    numero_police = models.CharField(
        max_length=15,
        verbose_name="Numéro Police d'Assurance",
        db_column="numeropolice",
    )
    numero_fdi = models.CharField(
        max_length=15,
        verbose_name="Numéro FDI",
        null=True,
        blank=True,
        db_column="numerofdi",
    )
    date_fdi = models.DateField(
        verbose_name="Date FDI", null=True, db_column="datefdi"
    )
    assureur = models.CharField(
        max_length=512, verbose_name="Assureur", db_column="assureur"
    )
    adresse_assureur = models.TextField(
        verbose_name="Adresse Assureur",
        db_column="adresseassureur",
    )
    id_client_uranus = models.IntegerField(
        verbose_name="ID Client URANUS",
        db_column="idclienturanus",
        null=True,
        blank=True,
    )
    nom_souscripteur = models.CharField(
        max_length=512,
        verbose_name="Souscripteur",
        db_column="nomsouscripteur",
    )
    adresse_souscripteur = models.TextField(
        verbose_name="Adresse souscripteur",
        db_column="adressesouscripteur",
    )
    assure = models.CharField(
        max_length=512, verbose_name="Assuré", db_column="assure"
    )
    adresse_assure = models.TextField(
        verbose_name="Adresse Assuré",
        db_column="adresseassure",
    )
    intermediaire = models.CharField(
        max_length=60, verbose_name="Intermédiaire", db_column="intermediaire"
    )
    moyen_transport = models.CharField(
        max_length=60,
        verbose_name="Moyen de Transport",
        db_column="moyentransport",
    )
    date_debut_voyage = models.DateField(
        verbose_name="Date Début Voyage", db_column="datedebutvoyage"
    )
    voyage = models.CharField(
        max_length=255, verbose_name="Voyage", db_column="voyage"
    )
    description_commerciale = models.TextField(
        verbose_name="Description Commerciale",
        db_column="descriptioncommerciale",
    )
    marque_colis = models.CharField(
        max_length=255, verbose_name="Marque de Colis", db_column="marquecolis"
    )
    numero_document_transport = models.CharField(
        max_length=40,
        verbose_name="Numéro Document Transport",
        db_column="numerodocumenttransport",
        null=True,
        blank=True,
    )
    reference_precedente = models.CharField(
        max_length=20,
        verbose_name="Réf. Précédente",
        null=True,
        blank=True,
        db_column="referenceprecedente",
    )
    reference_subsequente = models.CharField(
        max_length=20,
        verbose_name="Réf. Subséquente",
        null=True,
        blank=True,
        db_column="referencesubsequente",
    )
    valeur_assurance = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        verbose_name="Valeur Assurance",
        db_column="valeurassurance",
    )
    prime_nette = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        verbose_name="Prime Nette",
        db_column="primenette",
    )
    accessoire = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        verbose_name="Accessories",
        db_column="accessoire",
    )
    taxe = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        verbose_name="Montant Taxe",
        db_column="taxe",
    )
    prime_ttc = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        verbose_name="Prime Totale",
        db_column="primettc",
    )
    accessoire_afs_ci = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        verbose_name="Accessoires AFS-CI",
        db_column="accessoireafsci",
        null=True,
        default=500,
    )
    date_debut_periode = models.DateField(
        verbose_name="Date Début Periode", db_column="datedebutperiode"
    )
    date_fin_periode = models.DateField(
        verbose_name="Date Fin Periode", db_column="datefinperiode"
    )

    def __str__(self):
        return "Certificat d'assurance n° {} du {}".format(
            self.reference_certificat, self.date_certificat
        )

    class Meta:
        db_table = "stdcertificattransport"
        verbose_name = "Certificat d'assurance"
        verbose_name_plural = "Certificats d'assurance"
        constraints = [
            CheckConstraint(
                check=Q(date_fin_periode__gt=F("date_debut_periode")),
                name="certificat_transport_debut_plus_grand_fin",
            ),
        ]


class HistoriqueImportationCertificat(models.Model):
    id_importation = models.AutoField(
        primary_key=True,
        verbose_name="ID Importation",
        db_column="idimportation",
    )
    nom_fichier_excel = models.CharField(
        max_length=255,
        verbose_name="Nom Fichier Excel",
        db_column="nomfichierexcel",
    )
    sha256_hash = models.BinaryField(
        verbose_name="Checksum Fichier", db_column="sha256hash", null=True
    )
    date_creation = models.DateTimeField(auto_now_add=True)
    date_modification = models.DateTimeField(auto_now=True)
    date_debut_periode = models.DateField(
        verbose_name="Début Periode", db_column="datedebutperiode"
    )
    date_fin_periode = models.DateField(
        verbose_name="Fin Periode", db_column="datefinperiode"
    )
    operateur = models.ForeignKey(
        UranusUser,
        verbose_name="Opérateur Importation",
        db_column="idoperateur",
        null=True,
        on_delete=models.SET_NULL,
    )
    succes = models.BooleanField(
        verbose_name="Succès", default=False, db_column="succes"
    )

    def __str__(self):
        return "{}:{}".format(self.nom_fichier_excel, self.sha256_hash)

    class Meta:
        db_table = "stdhistoriqueimportationcertificat"
        verbose_name = "Historique d'importation - Transport"
        constraints = [
            CheckConstraint(
                check=Q(date_fin_periode__gt=F("date_debut_periode")),
                name="histo_import_debut_plus_grand_fin",
            ),
            UniqueConstraint(
                fields=["date_debut_periode", "date_fin_periode"],
                name="histo_import_unique_for_period",
            ),
        ]


class ImportationCertificatDevis(models.Model):
    id_importation_devis = models.AutoField(
        primary_key=True,
        verbose_name="ID Importation Devis",
        db_column="idimportationdevis",
    )
    historique_importation = models.ForeignKey(
        HistoriqueImportationCertificat,
        verbose_name="ID Historique Importation",
        db_column="idhistoriqueimportation",
        on_delete=models.CASCADE,
    )
    devis = models.ForeignKey(
        Devis,
        verbose_name="ID Devis",
        db_column="iddevis",
        on_delete=models.CASCADE,
    )

    class Meta:
        db_table = "stdimportationcertificatdevis"


class SequenceFacture(models.Model):
    """
    Modèle représentant la séquence des numéros de facture de devis et de contrat pour un mois et une année donnés.
    Utilisé pour générer le numéro séquentiel unique et réinitialisé mensuellement.
    """

    annee = models.IntegerField(
        help_text="Année pour la séquence (e.g., 2025)"
    )
    mois = models.IntegerField(help_text="Mois pour la séquence (1 à 12)")
    dernier_numero_devis = models.IntegerField(
        db_column="derniernumerodevis",
        default=0,
        help_text="Le dernier numéro séquentiel attribué aux factures proforma pour ce mois et cette année.",
    )

    dernier_numero_contrat = models.IntegerField(
        db_column="derniernumerocontrat",
        default=0,
        help_text="Le dernier numéro séquentiel attribué aux factures de contrat pour ce mois et cette année.",
    )

    class Meta:
        # 1. Clé Primaire Composite et Index Unique
        # Ceci crée la contrainte UNIQUE sur (annee, mois),
        # agissant comme la clé primaire pour notre séquence : PRIMARY KEY (annee, mois)
        unique_together = (
            "annee",
            "mois",
        )

        # 2. Nom de la table PostgreSQL
        # Nous spécifions le nom de la table pour qu'il corresponde exactement
        # à 'sequence_devis_mensuelle' si vous le souhaitez.
        db_table = "stdsequencefacture"

        verbose_name = "Séquence de factures mensuelle"
        verbose_name_plural = "Séquences de factures mensuelles"

    def __str__(self):
        return f"Séquence {self.annee}/{self.mois}: Dernier numéro proforma {self.dernier_numero_devis}, dernier numéro facture {self.dernier_numero_contrat}"


class Cheque(models.Model):
    id_cheque = models.AutoField(primary_key=True, db_column="idcheque")
    numero_cheque = models.CharField(max_length=50, db_column="numerocheque")
    banque = models.ForeignKey(
        Banque, on_delete=models.PROTECT, db_column="idbanque"
    )
    montant_initial = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="montantinitial"
    )
    solde_disponible = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="soldedisponible"
    )
    date_saisie = models.DateTimeField(
        auto_now_add=True, db_column="datesaisie"
    )

    class Statut(models.TextChoices):
        # Chèque remis d'avance par un client (échéancier), à déposer à sa date d'échéance
        A_DEPOSER = "A_DEPOSER", "À déposer"
        ENCAISSE = "ENCAISSE", "Encaissé"
        # Revenu impayé : ses encaissements ont été annulés (décaissement)
        IMPAYE = "IMPAYE", "Impayé"
        REENCAISSE = "REENCAISSE", "Réencaissé"

    statut = models.CharField(
        max_length=12,
        choices=Statut.choices,
        default=Statut.ENCAISSE,
        db_column="statut",
    )
    client = models.ForeignKey(
        Client,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="cheques",
        db_column="idclient",
    )
    # Date à laquelle le chèque doit être déposé (alerte 1 mois avant, rappel 15 jours après)
    date_echeance = models.DateField(null=True, blank=True, db_column="dateecheance")
    date_depot = models.DateField(null=True, blank=True, db_column="datedepot")
    observation = models.CharField(
        max_length=255, null=True, blank=True, db_column="observation"
    )
    motif_decaissement = models.CharField(
        max_length=255, null=True, blank=True, db_column="motifdecaissement"
    )
    date_decaissement = models.DateField(
        null=True, blank=True, db_column="datedecaissement"
    )
    # Total des encaissements annulés au décaissement, à réencaisser
    montant_impaye = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        db_column="montantimpaye",
    )

    class Meta:
        db_table = "stdcheque"
        unique_together = ("numero_cheque", "banque")
        constraints = [
            # Contrainte : Montant initial >= Solde disponible et les deux doivent être >= 0
            CheckConstraint(
                check=Q(montant_initial__gte=F("solde_disponible"))
                & Q(solde_disponible__gte=0),
                name="check_solde_coherence",
            ),
            CheckConstraint(
                check=Q(montant_initial__gt=0),
                name="check_montant_initial_positif",
            ),
        ]

    def __str__(self):
        return f"Chèque {self.numero_cheque} ({self.banque})"


class ChequeOperation(models.Model):
    id_operation = models.AutoField(primary_key=True, db_column="idoperation")
    cheque = models.ForeignKey(
        Cheque,
        on_delete=models.CASCADE,
        related_name="operations",
        db_column="idcheque",
    )
    id_encaissement = models.IntegerField(
        db_column="idencaissement"
    )  # Retourné par la procédure sp_enregistrement_encaissement
    utilisateur = models.ForeignKey(
        User, on_delete=models.PROTECT, db_column="idutilisateur"
    )
    montant_operation = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="montantoperation"
    )
    date_operation = models.DateField(db_column="dateoperation")
    date_saisie = models.DateTimeField(
        auto_now_add=True, db_column="datesaisie"
    )

    class Meta:
        db_table = "stdchequeoperation"


# ============================================================================
# NOUVEAU MODÈLE : Table d'historique des impositions
# ============================================================================


class ImpositionPrime(models.Model):
    """
    Historique des impositions de prime MRH.

    Cette table conserve la traçabilité complète de toutes les impositions
    de prime (qui, quand, pourquoi) au niveau maison ou devis.
    """

    # Choix pour le type d'imposition
    TYPE_DEVIS = "DEVIS"
    TYPE_MAISON = "MAISON"
    TYPE_IMPOSITION_CHOICES = [
        (TYPE_DEVIS, "Devis (global)"),
        (TYPE_MAISON, "Maison (individuelle)"),
    ]

    # Type et cible
    type_imposition = models.CharField(
        max_length=20,
        choices=TYPE_IMPOSITION_CHOICES,
        verbose_name="Type d'imposition",
        help_text="DEVIS pour imposition globale, MAISON pour imposition individuelle",
    )

    id_cible = models.IntegerField(
        verbose_name="ID de la cible",
        help_text="ID du devis (si DEVIS) ou ID du DevisDetail (si MAISON)",
    )

    # Montants (toujours prime NETTE)
    montant_impose = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        verbose_name="Montant imposé",
        help_text="Montant de la prime NETTE imposée (en FCFA)",
    )

    ancien_montant_nette = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        verbose_name="Ancien montant prime nette",
        help_text="Prime nette avant l'imposition",
    )

    ancien_montant_ttc = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        null=True,
        blank=True,
        verbose_name="Ancien montant prime TTC",
        help_text="Prime TTC avant l'imposition",
    )

    # Traçabilité de la création
    user_id = models.IntegerField(
        null=True,
        blank=True,
        verbose_name="ID utilisateur",
        help_text="ID de l'utilisateur qui a imposé la prime",
    )

    user_nom = models.CharField(
        max_length=200,
        null=True,
        blank=True,
        verbose_name="Nom utilisateur",
        help_text="Nom complet de l'utilisateur",
    )

    date_imposition = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Date d'imposition",
        help_text="Date et heure de l'imposition",
    )

    motif = models.TextField(
        null=True,
        blank=True,
        verbose_name="Motif",
        help_text="Raison de l'imposition (ex: négociation commerciale)",
    )

    # État de l'imposition
    actif = models.BooleanField(
        default=True,
        verbose_name="Actif",
        help_text="TRUE si l'imposition est active, FALSE si levée",
    )

    # Traçabilité de la levée
    date_levee = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Date de levée",
        help_text="Date et heure où l'imposition a été levée",
    )

    levee_par_user_id = models.IntegerField(
        null=True,
        blank=True,
        verbose_name="Levée par user ID",
        help_text="ID de l'utilisateur qui a levé l'imposition",
    )

    levee_par_user_nom = models.CharField(
        max_length=200,
        null=True,
        blank=True,
        verbose_name="Levée par user nom",
        help_text="Nom de l'utilisateur qui a levé l'imposition",
    )

    motif_levee = models.TextField(
        null=True,
        blank=True,
        verbose_name="Motif de levée",
        help_text="Raison de la levée de l'imposition",
    )

    class Meta:
        db_table = "stdmrh_imposition_prime"
        verbose_name = "Imposition de prime MRH"
        verbose_name_plural = "Impositions de prime MRH"
        ordering = ["-date_imposition"]
        indexes = [
            models.Index(
                fields=["type_imposition", "id_cible"],
                name="idx_impo_type_cible",
            ),
            models.Index(fields=["actif"], name="idx_impo_actif"),
            models.Index(fields=["-date_imposition"], name="idx_impo_date"),
        ]

    def __str__(self):
        status = "Active" if self.actif else "Levée"
        return f"{self.type_imposition} {self.id_cible} - {self.montant_impose:,.2f} FCFA ({status})"

    @property
    def est_active(self):
        """Retourne True si l'imposition est active."""
        return self.actif

    @property
    def duree_jours(self):
        """Retourne la durée de l'imposition en jours."""
        from django.utils import timezone

        if self.actif:
            fin = timezone.now()
        else:
            fin = self.date_levee or timezone.now()

        delta = fin - self.date_imposition
        return delta.days

    def lever_imposition(self, user_id=None, user_nom=None, motif=None):
        """
        Lève l'imposition.

        Args:
            user_id: ID de l'utilisateur qui lève
            user_nom: Nom de l'utilisateur
            motif: Raison de la levée
        """
        from django.utils import timezone

        self.actif = False
        self.date_levee = timezone.now()
        self.levee_par_user_id = user_id
        self.levee_par_user_nom = user_nom or "Système"
        self.motif_levee = motif
        self.save()


class ImportsHistorique(models.Model):
    """
    Historique de tous les imports de fichiers Excel d'assurés.

    Permet de:
    - Détecter les réimportations de fichiers identiques
    - Tracer toutes les opérations d'import
    - Analyser les statistiques d'import
    - Déboguer les problèmes d'import
    """

    # ─── Identification du fichier ───
    hash_fichier = models.CharField(
        max_length=64,
        unique=True,
        db_index=True,
        verbose_name="Hash du fichier",
        help_text="Hash SHA256 du fichier pour détecter les doublons",
    )

    nom_fichier = models.CharField(
        max_length=255, verbose_name="Nom du fichier"
    )

    taille_fichier = models.BigIntegerField(
        verbose_name="Taille du fichier", help_text="Taille en octets"
    )

    # ─── Métadonnées de l'import ───
    date_import = models.DateTimeField(
        default=timezone.now, db_index=True, verbose_name="Date d'import"
    )

    user_id = models.IntegerField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="ID Utilisateur",
        help_text="ID de l'utilisateur ayant effectué l'import",
    )

    mode_import = models.CharField(
        max_length=50,
        default="creer_seulement",
        verbose_name="Mode d'import",
        help_text="creer_seulement, mettre_a_jour, erreur_si_doublon, ignorer_silencieux",
    )

    # ─── Statistiques ───
    nb_assures_total = models.IntegerField(
        default=0,
        verbose_name="Nombre total d'assurés",
        help_text="Nombre total de lignes dans le fichier",
    )

    nb_assures_nouveaux = models.IntegerField(
        default=0, verbose_name="Assurés créés"
    )

    nb_assures_ignores = models.IntegerField(
        default=0,
        verbose_name="Assurés ignorés",
        help_text="Assurés ignorés car déjà existants",
    )

    nb_assures_mis_a_jour = models.IntegerField(
        default=0, verbose_name="Assurés mis à jour"
    )

    nb_erreurs = models.IntegerField(
        default=0, verbose_name="Nombre d'erreurs"
    )

    # ─── Résultat ───
    STATUT_CHOICES = [
        ("REUSSI", "Réussi"),
        ("ECHOUE", "Échoué"),
        ("PARTIEL", "Partiel"),
        ("REFUSE", "Refusé"),
    ]

    statut = models.CharField(
        max_length=20,
        choices=STATUT_CHOICES,
        db_index=True,
        verbose_name="Statut",
    )

    details_erreur = models.TextField(
        null=True, blank=True, verbose_name="Détails de l'erreur"
    )

    id_devis = models.IntegerField(
        null=True,
        blank=True,
        verbose_name="ID Devis",
        help_text="ID du devis créé lors de l'import",
    )

    # ─── Audit ───
    duree_secondes = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Durée (secondes)",
    )

    details_json = models.JSONField(
        null=True,
        blank=True,
        verbose_name="Détails JSON",
        help_text="Détails complets de l'import en JSON",
    )

    class Meta:
        db_table = "stdimports_historique"
        verbose_name = "Import d'assurés"
        verbose_name_plural = "Historique des imports"
        ordering = ["-date_import"]
        indexes = [
            models.Index(fields=["hash_fichier"], name="idx_imports_hash"),
            models.Index(fields=["-date_import"], name="idx_imports_date"),
            models.Index(fields=["user_id"], name="idx_imports_user"),
            models.Index(fields=["statut"], name="idx_imports_statut"),
        ]

    def __str__(self):
        return f"{self.nom_fichier} - {self.date_import.strftime('%d/%m/%Y %H:%M')} - {self.statut}"

    def __repr__(self):
        return (
            f"<ImportsHistorique(id={self.id}, "
            f"fichier='{self.nom_fichier}', "
            f"statut='{self.statut}', "
            f"nouveaux={self.nb_assures_nouveaux})>"
        )

    @property
    def taux_reussite(self):
        """Calcule le taux de réussite de l'import"""
        if self.nb_assures_total == 0:
            return 0

        traites = self.nb_assures_nouveaux + self.nb_assures_mis_a_jour
        return (traites / self.nb_assures_total) * 100

    @property
    def hash_court(self):
        """Retourne les 8 premiers caractères du hash"""
        return self.hash_fichier[:8] if self.hash_fichier else ""

    @classmethod
    def rechercher_par_hash(cls, hash_fichier):
        """Recherche un import par son hash de fichier"""
        return cls.objects.filter(hash_fichier=hash_fichier).order_by(
            "-date_import"
        )

    @classmethod
    def imports_recents(cls, nb_jours=7):
        """Retourne les imports des N derniers jours"""
        from datetime import timedelta

        date_limite = timezone.now() - timedelta(days=nb_jours)
        return cls.objects.filter(date_import__gte=date_limite)

    @classmethod
    def statistiques_globales(cls):
        """Retourne des statistiques globales sur tous les imports"""
        from django.db.models import Avg, Count, Q, Sum

        stats = cls.objects.aggregate(
            total_imports=Count("id"),
            total_assures_crees=Sum("nb_assures_nouveaux"),
            total_assures_ignores=Sum("nb_assures_ignores"),
            total_erreurs=Sum("nb_erreurs"),
            duree_moyenne=Avg("duree_secondes"),
            nb_reussis=Count("id", filter=Q(statut="REUSSI")),
            nb_echecs=Count("id", filter=Q(statut="ECHOUE")),
            nb_refuses=Count("id", filter=Q(statut="REFUSE")),
        )

        return stats

    def generer_resume_texte(self):
        """Génère un résumé textuel de l'import"""
        return f"""
            Import: {self.nom_fichier}
            Date: {self.date_import.strftime('%d/%m/%Y à %H:%M')}
            Statut: {self.get_statut_display()}
            Mode: {self.mode_import}

            Statistiques:
                - Total assurés: {self.nb_assures_total}
                - Nouveaux: {self.nb_assures_nouveaux}
                - Ignorés: {self.nb_assures_ignores}
                - Mis à jour: {self.nb_assures_mis_a_jour}
                - Erreurs: {self.nb_erreurs}

            Taux de réussite: {self.taux_reussite:.1f}%
            Durée: {self.duree_secondes}s
        """
