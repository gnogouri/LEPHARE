from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.validators import (
    MaxValueValidator,
    MinLengthValidator,
    MinValueValidator,
)
from django.db import models
from django.db.models import CheckConstraint, F, Func, Q


class OffreAutomobileBoisee(Func):
    function = "fn_offre_automobile_boisee"
    output_field = models.BooleanField()


class Garantie(models.Model):
    IdGarantie = models.AutoField(
        verbose_name="Id Garantie", db_column="idgarantie", primary_key=True
    )
    CodeGarantie = models.CharField(
        db_column="codegarantie",
        max_length=3,
        validators=[MinLengthValidator(3)],
    )
    LibelleGarantie = models.CharField(
        db_column="libellegarantie", max_length=60
    )
    Active = models.BooleanField(db_column="active")
    Ordre = models.SmallIntegerField(db_column="ordre")
    ModeCalcInd = models.CharField(
        db_column="modecalcind",
        max_length=1,
        null=True,
        blank=True,
        validators=[MinLengthValidator(1)],
    )
    SaisieAuto = models.BooleanField(db_column="saisieauto")
    SaisieRd = models.BooleanField(db_column="saisierd")
    SaisieSante = models.BooleanField(db_column="saisiesante")
    SaisieTransport = models.BooleanField(db_column="saisietransport")
    SinDelai = models.SmallIntegerField(
        db_column="sindelai", null=True, blank=True
    )
    SinBloquant = models.BooleanField(
        db_column="sinbloquant", null=True, blank=True
    )

    def __str__(self):
        return self.LibelleGarantie

    class Meta:
        db_table = "stdgarantie"


class MenuParent(models.Model):
    IdMenuParent = models.AutoField(db_column="idmenuparent", primary_key=True)
    LibelleParent = models.CharField(
        db_column="libelleparent", max_length=50, blank=False
    )
    Actif = models.BooleanField(
        verbose_name="Actif", db_column="actif", blank=False
    )

    def __str__(self):
        return self.LibelleParent

    class Meta:
        db_table = "stdmenuparent"


class Menu(models.Model):
    IdMenu = models.AutoField(db_column="idmenu", primary_key=True)
    IdMenuParent = models.ForeignKey(
        MenuParent, db_column="idmenuparent", on_delete=models.CASCADE
    )
    LibelleMenu = models.CharField(
        verbose_name="Libellé Menu",
        db_column="libellemenu",
        max_length=50,
        blank=False,
    )
    Actif = models.BooleanField(
        verbose_name="Actif", db_column="actif", blank=False
    )

    def __str__(self):
        return self.LibelleMenu

    class Meta:
        db_table = "stdmenu"


class Utilisateur(models.Model):
    UserId = models.AutoField(db_column="userid", primary_key=True)
    Nom = models.CharField(db_column="nom", max_length=60)
    Prenoms = models.CharField(db_column="prenoms", max_length=60)
    NomConnexion = models.CharField(db_column="nomconnexion", max_length=60)
    UserPassword = models.CharField(db_column="userpassword", max_length=255)
    UserMail = models.EmailField(db_column="usermail", unique=True)
    UserASACICode = models.CharField(
        db_column="userasacicode", max_length=50, null=True, blank=True
    )
    UserLienPhoto = models.CharField(
        db_column="userlienphoto", max_length=255, null=True, blank=True
    )
    UserSexe = models.CharField(
        db_column="usersexe",
        max_length=1,
        null=True,
        blank=True,
        validators=[MinLengthValidator(1)],
    )
    UserTelephone = models.CharField(
        db_column="usertelephone", max_length=20, null=True, blank=True
    )

    def __str__(self):
        return self.Prenoms + " " + self.Nom

    class Meta:
        db_table = "stdutilisateur"


class GroupeUtilisateur(models.Model):
    IdGroupe = models.AutoField(db_column="idgroupe", primary_key=True)
    LibelleGroupe = models.CharField(db_column="libellegroupe", max_length=60)
    DateCreation = models.DateTimeField(
        db_column="datecreation", auto_now_add=True
    )
    Active = models.CharField(
        db_column="active", max_length=1, validators=[MinLengthValidator(1)]
    )
    DescriptionGroupe = models.TextField(
        db_column="descriptiongroupe", max_length=100, null=True, blank=True
    )

    def __str__(self):
        return self.LibelleGroupe

    class Meta:
        db_table = "stdgroupeutilisateur"


class Branche(models.Model):
    IdBranche = models.AutoField(
        verbose_name="Id Branche", db_column="idbranche", primary_key=True
    )
    CodeBranche = models.CharField(
        verbose_name="Code Branche",
        db_column="codebranche",
        max_length=3,
        validators=[MinLengthValidator(3)],
    )
    LibelleBranche = models.CharField(
        verbose_name="Libellé Branche",
        db_column="libellebranche",
        max_length=50,
    )

    def __str__(self):
        return self.LibelleBranche + " (" + self.CodeBranche + ")"

    class Meta:
        db_table = "stdbranche"


class Risque(models.Model):
    IdRisque = models.AutoField(
        verbose_name="Id Risque", db_column="idrisque", primary_key=True
    )
    IdBranche = models.ForeignKey(
        Branche,
        verbose_name="Id Branche",
        db_column="idbranche",
        related_name="risques",
        related_query_name="risquesavec",
        on_delete=models.CASCADE,
    )
    Libelle = models.CharField(
        verbose_name="Libellé Risque",
        db_column="libelle",
        max_length=50,
        default=" ",
    )
    Active = models.BooleanField(
        verbose_name="Actif", db_column="active", default=False
    )

    def __str__(self):
        return self.Libelle

    class Meta:
        db_table = "stdrisque"


class SousGarantie(models.Model):
    IdSousGarantie = models.AutoField(
        db_column="idsousgarantie", primary_key=True
    )
    CodeSousGarantie = models.CharField(
        verbose_name="Code S/Garantie",
        db_column="codesousgarantie",
        unique=True,
        max_length=5,
        validators=[MinLengthValidator(5)],
    )
    IdGarantie = models.ForeignKey(
        Garantie,
        verbose_name="Id Garantie",
        db_column="idgarantie",
        null=True,
        blank=True,
        related_name="sousgaranties",
        on_delete=models.DO_NOTHING,
    )
    LibelleSousGarantie = models.CharField(
        verbose_name="Libellé S/Garantie",
        db_column="libellesousgarantie",
        max_length=100,
    )
    Active = models.BooleanField(verbose_name="Active", db_column="active")
    Ordre = models.SmallIntegerField(verbose_name="Ordre", db_column="ordre")
    SaisieAuto = models.BooleanField(
        verbose_name="Saisie en Auto", db_column="saisieauto"
    )
    SaisieRd = models.BooleanField(
        verbose_name="Saisie en RD", db_column="saisierd"
    )
    SaisieSante = models.BooleanField(
        verbose_name="Saisie en Santé", db_column="saisiesante"
    )
    SaisieTransport = models.BooleanField(
        verbose_name="Saisie en Transport", db_column="saisietransport"
    )

    def __str__(self):
        return self.LibelleSousGarantie

    class Meta:
        db_table = "stdsousgarantie"


class Acte(models.Model):
    IdActe = models.AutoField(
        verbose_name="Id Acte", db_column="idacte", primary_key=True
    )
    CodeActe = models.CharField(
        verbose_name="Code Acte", db_column="codeacte", max_length=3
    )
    LibelleActe = models.CharField(
        verbose_name="Libellé Acte", db_column="libelleacte", max_length=60
    )
    TypeActe = models.CharField(
        verbose_name="Type Acte",
        db_column="typeacte",
        max_length=1,
        validators=[MinLengthValidator(1)],
    )
    Personnalisable = models.BooleanField(
        verbose_name="Personnalisable",
        db_column="personnalisable",
        max_length=1,
    )

    def __str__(self):
        return self.LibelleActe + " (" + self.CodeActe + ")"

    class Meta:
        db_table = "stdacte"


class Commission(models.Model):
    IdCommission = models.AutoField(
        verbose_name="Id Commission",
        db_column="idcommission",
        primary_key=True,
    )
    CodeNatureIntermediaire = models.SmallIntegerField(
        verbose_name="Nature Intermediaire",
        db_column="codenatureintermediaire",
    )
    IdGarantie = models.ForeignKey(
        Garantie,
        verbose_name="Id Garantie",
        db_column="idgarantie",
        on_delete=models.CASCADE,
    )
    TauxCommission = models.FloatField(
        verbose_name="Taux Commission", db_column="tauxcommission"
    )
    ValiditeMin = models.DateTimeField(
        verbose_name="Valide du", db_column="validitemin"
    )
    ValiditeMax = models.DateTimeField(
        verbose_name="Valide jusqu'au", db_column="validitemax"
    )

    class Meta:
        db_table = "stdcommission"


class Compagnie(models.Model):
    IdCompagnie = models.AutoField(
        verbose_name="Id Compagnie", db_column="idcompagnie", primary_key=True
    )
    RaisonSociale = models.CharField(
        verbose_name="Raison Sociale",
        db_column="raisonsociale",
        max_length=100,
    )
    CodeAsaci = models.CharField(
        verbose_name="Code ASACI",
        db_column="codeasaci",
        max_length=10,
        blank=True,
        null=True,
    )
    Adresse1 = models.CharField(
        verbose_name="Adresse 1", db_column="adresse1", max_length=100
    )
    Adresse2 = models.CharField(
        verbose_name="Adresse 2", db_column="adresse2", max_length=100
    )
    IdVille = models.IntegerField(
        verbose_name="Id Ville", db_column="idville", blank=True, null=True
    )
    Telephone = models.CharField(
        verbose_name="Numéro de téléphone",
        db_column="telephone",
        max_length=20,
        null=True,
        blank=True,
    )
    Mobile = models.CharField(
        verbose_name="Numéro mobile",
        db_column="mobile",
        max_length=20,
        null=True,
        blank=True,
    )
    Fax = models.CharField(
        verbose_name="Numéro de fax",
        db_column="fax",
        max_length=20,
        null=True,
        blank=True,
    )
    RespSinAuto = models.CharField(
        verbose_name="Responsable Sinistre Auto",
        db_column="respsinauto",
        max_length=100,
        blank=True,
        null=True,
    )
    RespSinRd = models.CharField(
        verbose_name="Responsable Sinistre RD",
        db_column="respsinrd",
        max_length=100,
        blank=True,
        null=True,
    )
    RespProdAuto = models.CharField(
        verbose_name="Responsable Production Auto",
        db_column="respprodauto",
        max_length=100,
        blank=True,
        null=True,
    )
    RespProdRd = models.CharField(
        verbose_name="Responsable Production RD",
        db_column="respprodrd",
        max_length=100,
        blank=True,
        null=True,
    )
    DateMaj = models.DateTimeField(
        verbose_name="Date de mise à jour",
        db_column="datemaj",
        auto_now=True,
    )
    Etranger = models.BooleanField(
        verbose_name="Compagnie Etrangère", db_column="etranger"
    )
    codeacces = models.CharField(
        max_length=20, null=True, db_column="codeacces"
    )
    Active = models.BooleanField(
        verbose_name="Active", db_column="active", default=True
    )

    def __str__(self):
        if self.CodeAsaci is None:
            return self.RaisonSociale
        return self.RaisonSociale + " (" + self.CodeAsaci + ")"

    class Meta:
        db_table = "stdcompagnie"


class GarantieRisque(models.Model):
    IdGarantie = models.ForeignKey(
        Garantie,
        related_name="risques",
        related_query_name="risquesavec",
        db_column="idgarantie",
        on_delete=models.CASCADE,
    )
    IdRisque = models.ForeignKey(
        Risque,
        related_name="garanties",
        related_query_name="garantiesavec",
        db_column="idrisque",
        on_delete=models.CASCADE,
    )
    TauxTaxe = models.FloatField(
        verbose_name="Taux Taxe", db_column="tauxtaxe"
    )
    TauxTaxeGroupe = models.FloatField(
        verbose_name="Taux Taxe Groupe", db_column="tauxtaxegroupe"
    )
    ForfaitTaxe = models.DecimalField(
        verbose_name="Forfait Taxe",
        db_column="forfaittaxe",
        max_digits=19,
        decimal_places=4,
        null=True,
    )
    ValiditeMin = models.DateField(
        verbose_name="Valide du", db_column="validitemin"
    )
    ValiditeMax = models.DateField(
        verbose_name="Valide au", db_column="validitemax"
    )

    class Meta:
        db_table = "stdgarantierisque"
        constraints = [
            models.UniqueConstraint(
                fields=["IdGarantie", "IdRisque"],
                name="unique_garantie_risque",
            ),
        ]


class Categorie(models.Model):
    IdCategorie = models.AutoField(
        verbose_name="Id Catégorie", db_column="idcategorie", primary_key=True
    )
    CodeCategorie = models.CharField(
        verbose_name="Code Catégorie",
        db_column="codecategorie",
        max_length=3,
        validators=[MinLengthValidator(3)],
        unique=True,
    )
    LibelleCategorie = models.CharField(
        verbose_name="Libellé Catégorie",
        db_column="libellecategorie",
        max_length=100,
    )
    code_asaci = models.CharField(
        max_length=100,
        db_column="codeasaci",
        verbose_name="Code Categorie ASACI",
        null=True,
        blank=True,
    )

    def __str__(self):
        return self.LibelleCategorie + " (" + self.CodeCategorie + ")"

    class Meta:
        db_table = "stdcategorie"


class Tarif(models.Model):
    CATEGORY_MRH = "320"
    IdTarif = models.AutoField(
        verbose_name="Id Tarif", db_column="idtarif", primary_key=True
    )
    Libelle = models.CharField(
        verbose_name="Libellé", db_column="libelle", max_length=100
    )
    CodeUsage = models.CharField(
        verbose_name="Code Usage",
        db_column="codeusage",
        max_length=3,
        null=True,
        blank=True,
        validators=[MinLengthValidator(3)],
    )

    CodeCategorie = models.CharField(
        verbose_name="Code Categorie",
        db_column="codecategorie",
        max_length=3,
        default="XXX",
        validators=[MinLengthValidator(3)],
    )
    Reference = models.CharField(
        verbose_name="Référence",
        db_column="reference",
        max_length=3,
        null=True,
        blank=True,
        validators=[MinLengthValidator(3)],
    )
    ValiditeMin = models.DateField(
        verbose_name="Valide du", db_column="validitemin"
    )
    ValiditeMax = models.DateField(
        verbose_name="Valide au", db_column="validitemax"
    )
    NatAccessoires = models.SmallIntegerField(
        verbose_name="Nature Accessoires", db_column="nataccessoires"
    )
    IdCategorie = models.ForeignKey(
        Categorie,
        related_name="tarifs",
        related_query_name="tarifsavec",
        verbose_name="Id Catégorie",
        db_column="idcategorie",
        on_delete=models.CASCADE,
    )
    code_categorie_asaci = models.CharField(
        verbose_name="Code Categorie ASACI",
        max_length=100,
        db_column="codecategorieasaci",
        null=True,
        default="",
    )

    @classmethod
    def is_mrh(cls, tarif_id):
        return cls.objects.filter(
            pk=tarif_id, CodeCategorie=cls.CATEGORY_MRH
        ).exists()

    def __str__(self):
        return self.Libelle + " (" + self.CodeCategorie + ")"

    class Meta:
        db_table = "stdtarif"
        constraints = [
            models.CheckConstraint(
                check=models.Q(ValiditeMax__gte=models.F("ValiditeMin")),
                name="tarif_validitemax_gte_validitemin",
            ),
        ]


class TarifDetail(models.Model):
    IdDetail = models.AutoField(
        verbose_name="Id Détail", db_column="iddetail", primary_key=True
    )
    IdTarif = models.ForeignKey(
        Tarif,
        related_name="details",
        related_query_name="detailsavec",
        verbose_name="Tarif",
        db_column="idtarif",
        on_delete=models.CASCADE,
    )
    IdGarantie = models.ForeignKey(
        SousGarantie,
        related_name="details",
        related_query_name="detailsavec",
        verbose_name="S/Garantie liée",
        db_column="idgarantie",
        on_delete=models.CASCADE,
        null=True,
    )
    PuissanceMin = models.SmallIntegerField(
        default=0, verbose_name="Puissance Minimale", db_column="puissancemin"
    )
    PuissanceMax = models.SmallIntegerField(
        default=30000,
        verbose_name="Puissance Maximale",
        db_column="puissancemax",
    )
    TonnageMin = models.IntegerField(
        default=0, verbose_name="Tonnage Minimal", db_column="tonnagemin"
    )
    TonnageMax = models.IntegerField(
        default=9999999, verbose_name="Tonnage Maximal", db_column="tonnagemax"
    )
    CapitalMin = models.DecimalField(
        default=0,
        verbose_name="Capital Minimal",
        db_column="capitalmin",
        max_digits=19,
        decimal_places=4,
    )
    CapitalMax = models.DecimalField(
        default=9999999,
        verbose_name="Capital Maximal",
        db_column="capitalmax",
        max_digits=19,
        decimal_places=4,
    )
    FranchiseMin = models.DecimalField(
        default=0,
        verbose_name="(Franchise Du) - Franchise Minimale",
        db_column="franchisemin",
        max_digits=19,
        decimal_places=4,
    )
    FranchiseMax = models.DecimalField(
        default=9999999,
        verbose_name="(Franchise Au) - Franchise Maximale",
        db_column="franchisemax",
        max_digits=19,
        decimal_places=4,
    )
    FranchiseMinimale = models.DecimalField(
        default=0,
        verbose_name="(Franchise Min) - Franchise Minimale",
        db_column="franchiseminimale",
        max_digits=19,
        decimal_places=4,
    )
    AgeVehiculeMin = models.SmallIntegerField(
        default=0,
        verbose_name="Âge Minimal Véhicule",
        db_column="agevehiculemin",
    )
    AgeVehiculeMax = models.SmallIntegerField(
        default=30000,
        verbose_name="Âge Maximal Véhicule",
        db_column="agevehiculemax",
    )
    AgeConducteurMin = models.SmallIntegerField(
        default=0,
        verbose_name="Âge Minimal Conducteur",
        db_column="ageconducteurmin",
    )
    AgeConducteurMax = models.SmallIntegerField(
        default=30000,
        verbose_name="Âge Maximal Conducteur",
        db_column="ageconducteurmax",
    )
    NombrePlacesMin = models.SmallIntegerField(
        default=0,
        verbose_name="Nombre Minimum Places",
        db_column="nombreplacesmin",
    )
    NombrePlacesMax = models.SmallIntegerField(
        default=30000,
        verbose_name="Nombre Maximum Places",
        db_column="nombreplacesmax",
    )
    Taux = models.DecimalField(
        default=0,
        verbose_name="Taux",
        db_column="taux",
        max_digits=19,
        decimal_places=4,
    )
    PrimeMin = models.DecimalField(
        default=0,
        verbose_name="Prime Minimum",
        db_column="primemin",
        max_digits=19,
        decimal_places=4,
    )
    PlacesGrat = models.IntegerField(
        default=0, verbose_name="Places Gratuites", db_column="placesgrat"
    )
    PrimePlace = models.DecimalField(
        default=0,
        verbose_name="Prime Place",
        db_column="primeplace",
        max_digits=19,
        decimal_places=4,
    )
    PrimeGar = models.DecimalField(
        default=0,
        verbose_name="Prime Garantie",
        db_column="primegar",
        max_digits=19,
        decimal_places=4,
    )
    Deces = models.DecimalField(
        default=0,
        verbose_name="Décès",
        db_column="deces",
        max_digits=19,
        decimal_places=4,
    )
    Ipp = models.DecimalField(
        default=0,
        verbose_name="IPP",
        db_column="ipp",
        max_digits=19,
        decimal_places=4,
    )
    FraisMed = models.DecimalField(
        default=0,
        verbose_name="Frais Médicaux",
        db_column="fraismed",
        max_digits=19,
        decimal_places=4,
    )
    MinProrata = models.DecimalField(
        default=0,
        verbose_name="Minimum Prorata",
        db_column="minprorata",
        max_digits=19,
        decimal_places=4,
    )
    CodeCarburant = models.IntegerField(
        verbose_name="Code Carburant",
        db_column="codecarburant",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "stdtarifdetail"
        constraints = [
            models.CheckConstraint(
                check=models.Q(PuissanceMax__gte=models.F("PuissanceMin")),
                name="detailtarif_puissancemax_gte_puissancemin",
            ),
            models.CheckConstraint(
                check=models.Q(TonnageMax__gte=models.F("TonnageMin")),
                name="detailtarif_tonnagemax_gte_tonnagemin",
            ),
            models.CheckConstraint(
                check=models.Q(CapitalMax__gte=models.F("CapitalMin")),
                name="detailtarif_capitalmax_gte_capitalmin",
            ),
            models.CheckConstraint(
                check=models.Q(FranchiseMax__gte=models.F("FranchiseMin")),
                name="detailtarif_franchisemax_gte_franchisemin",
            ),
            models.CheckConstraint(
                check=models.Q(AgeVehiculeMax__gte=models.F("AgeVehiculeMin")),
                name="detailtarif_agevehiculemax_gte_agevehiculemin",
            ),
            models.CheckConstraint(
                check=models.Q(
                    AgeConducteurMax__gte=models.F("AgeConducteurMin")
                ),
                name="detailtarif_ageconducteurmax_gte_ageconducteurmin",
            ),
            models.CheckConstraint(
                check=models.Q(
                    NombrePlacesMax__gte=models.F("NombrePlacesMin")
                ),
                name="detailtarif_nombreplacesmax_gte_nombreplacesmin",
            ),
        ]


class Offre(models.Model):
    IdOffre = models.AutoField(
        verbose_name="Id Offre",
        db_column="idoffre",
        primary_key=True,
    )
    LibelleOffre = models.CharField(
        verbose_name="Libellé Offre",
        db_column="libelleoffre",
        max_length=120,
        blank=True,
        null=True,
    )
    ZoneCouverture = models.ForeignKey(
        "ZoneCouvertureSante",
        db_column="idzonecouverture",
        null=True,
        on_delete=models.SET_NULL,
        default=None,
    )
    TarifOffre = models.ForeignKey(
        Tarif,
        db_column="idtarif",
        null=True,
        default=None,
        on_delete=models.SET_NULL,
    )
    Payement = models.CharField(
        db_column="payement", max_length=1, default="A"
    )
    JPaiement = models.SmallIntegerField(db_column="jpaiement", default=1)
    Entreprise = models.BooleanField(db_column="entreprise", default=False)
    Echeance = models.CharField(
        db_column="echeance", max_length=1, default="L"
    )
    Renouvelable = models.CharField(
        db_column="renouvelable", max_length=1, default="L"
    )  # CHAR(1)
    MajFract = models.SmallIntegerField(
        db_column="majfract", default=0
    )  # Default =0
    Visibilite = models.CharField(
        db_column="visibilite", max_length=1, default="T"
    )  # CHAR(1): T ou P
    Flotte = models.BooleanField(db_column="flotte", default=False)
    Anticipation = models.SmallIntegerField(
        db_column="anticipation", default=26
    )
    Differe = models.SmallIntegerField(
        db_column="differe", default=0
    )  # 0 pour l'automobile, utilisé en Risques
    Ppr = models.CharField(
        db_column="ppr", max_length=1, default="N"
    )  # N en auto
    Actif = models.BooleanField(db_column="actif", default=True)
    Gestion = models.BooleanField(db_column="gestion", default=False)
    ExoneredeTaxes = models.BooleanField(
        db_column="exoneredetaxes", default=False
    )
    ExoneredeAccess = models.BooleanField(
        db_column="exoneredeaccess", default=False
    )

    def __str_(self):
        return self.LibelleOffre

    class Meta:
        db_table = "stdoffre"


class OffreDetail(models.Model):
    IdOffre = models.IntegerField(db_column="idoffre", primary_key=True)
    IdTarif = models.IntegerField(
        db_column="idtarif",
    )
    IdCategorie = models.IntegerField(
        db_column="idcategorie",
    )
    LibelleOffre = models.CharField(db_column="libelleoffre", max_length=100)
    ValiditeMin = models.DateField(
        db_column="validitemin",
    )
    ValiditeMax = models.DateField(
        db_column="validitemax",
    )
    Actif = models.BooleanField(
        db_column="actif",
    )

    def __str__(self):
        return self.LibelleOffre

    class Meta:
        db_table = "stdoffredetail"
        unique_together = (("IdOffre", "IdTarif"),)


class Profession(models.Model):
    IdProfession = models.AutoField(
        verbose_name="Id Profession",
        db_column="idprofession",
        primary_key=True,
    )
    Libelle = models.CharField(
        verbose_name="Libellé", db_column="libelle", max_length=100
    )
    CodeProfession = models.CharField(
        verbose_name="Code Profession",
        db_column="codeprofession",
        max_length=20,
        blank=True,
        null=True,
    )

    def __str__(self):
        return self.Libelle

    class Meta:
        db_table = "stdprofession"


class Energie(models.Model):
    IdEnergie = models.AutoField(
        verbose_name="Id Energie", db_column="idenergie", primary_key=True
    )
    CodeEnergie = models.CharField(
        verbose_name="Code Energie",
        db_column="codeenergie",
        max_length=4,
        validators=[MinLengthValidator(3)],
    )
    Libelle = models.CharField(
        verbose_name="Libellé Energie",
        db_column="libelle",
        max_length=15,
    )

    def __str__(self):
        return self.Libelle

    class Meta:
        db_table = "stdenergie"


class Avenant(models.Model):
    IdAvenant = models.AutoField(
        verbose_name="Id AVenant", primary_key=True, db_column="idavenant"
    )
    CodeAvenant = models.CharField(
        max_length=5, verbose_name="Code Avenant", db_column="codeavenant"
    )
    LibelleAvenant = models.CharField(
        max_length=50,
        verbose_name="Libellé Avenant",
        db_column="libelleavenant",
    )
    TexteMouvement = models.CharField(
        max_length=50,
        verbose_name="Texte du mouvement",
        db_column="textemouvement",
        null=True,
        blank=True,
    )
    EtatTraitement = models.CharField(
        max_length=5,
        verbose_name="Etat Traitement",
        db_column="etattraitement",
        null=True,
        blank=True,
        validators=[MinLengthValidator(5)],
    )
    Active = models.BooleanField(verbose_name="Actif", db_column="active")
    EditionAttestation = models.BooleanField(
        verbose_name="Edition Attestation",
        db_column="editionattestation",
        null=True,
    )

    def __str__(self):
        return self.LibelleAvenant + " (" + self.CodeAvenant + ")"

    class Meta:
        db_table = "stdavenant"


class Qualite(models.Model):
    IdQualite = models.AutoField(
        verbose_name="Id Qualité", db_column="idqualite", primary_key=True
    )
    Libelle = models.CharField(
        verbose_name="Libellé", max_length=100, db_column="libelle"
    )
    CodeQualite = models.CharField(
        max_length=20, verbose_name="Code Qualité", db_column="codequalite"
    )
    TypePersonne = models.IntegerField(
        verbose_name="Type Personne", db_column="typepersonne", default=1
    )

    def __str__(self):
        return self.Libelle

    class Meta:
        db_table = "stdqualite"
        verbose_name = "Qualité"
        verbose_name_plural = "Qualités"


class StatutJuridique(models.Model):
    """Forme juridique d'un client personne morale (formes OHADA : SA, SARL, SAS…)."""

    IdStatutJuridique = models.AutoField(
        verbose_name="Id Statut Juridique",
        db_column="idstatutjuridique",
        primary_key=True,
    )
    CodeStatut = models.CharField(
        max_length=10, verbose_name="Code Statut", db_column="codestatut", unique=True
    )
    Libelle = models.CharField(
        verbose_name="Libellé", max_length=100, db_column="libelle"
    )

    def __str__(self):
        return self.Libelle

    class Meta:
        db_table = "stdstatutjuridique"
        verbose_name = "Statut Juridique"
        verbose_name_plural = "Statuts Juridiques"


class Apporteur(models.Model):
    """Apporteur d'affaires codifié, auquel le cabinet peut verser des commissions."""

    TYPES_PERSONNE = [("P", "Personne physique"), ("M", "Personne morale")]

    IdApporteur = models.AutoField(
        verbose_name="Id Apporteur", db_column="idapporteur", primary_key=True
    )
    Code = models.CharField(
        max_length=20, verbose_name="Code apporteur", db_column="code", unique=True
    )
    Nom = models.CharField(
        max_length=150, verbose_name="Nom ou raison sociale", db_column="nom"
    )
    Prenoms = models.CharField(
        max_length=150, blank=True, default="", verbose_name="Prénoms", db_column="prenoms"
    )
    TypePersonne = models.CharField(
        max_length=1, choices=TYPES_PERSONNE, default="P", db_column="typepersonne"
    )
    PieceIdentite = models.CharField(
        max_length=50, blank=True, default="", verbose_name="CNI / RCCM", db_column="pieceidentite"
    )
    Telephone = models.CharField(
        max_length=30, blank=True, default="", db_column="telephone"
    )
    Telephone2 = models.CharField(
        max_length=30, blank=True, default="", verbose_name="Second téléphone", db_column="telephone2"
    )
    Email = models.EmailField(blank=True, default="", db_column="email")
    Adresse = models.CharField(
        max_length=200, blank=True, default="", db_column="adresse"
    )
    # Taux général proposé au rattachement : le taux convenu est ensuite copié sur chaque affaire (lephare_affaire_apporteur)
    TauxRetrocession = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        verbose_name="Taux général de commission (%)", db_column="tauxretrocession",
    )
    # Ou bien un montant par assuré (jamais les deux), proposé de même au rattachement
    MontantParAssure = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        verbose_name="Montant général par assuré (F)", db_column="montantparassure",
    )
    CompteReglement = models.CharField(
        max_length=100, blank=True, default="", verbose_name="Compte bancaire ou mobile money", db_column="comptereglement"
    )
    Observations = models.CharField(
        max_length=300, blank=True, default="", db_column="observations"
    )
    Actif = models.BooleanField(default=True, db_column="actif")
    DateCreation = models.DateTimeField(auto_now_add=True, db_column="datecreation")

    def __str__(self):
        return f"{self.Code} - {self.Nom} {self.Prenoms}".strip()

    class Meta:
        db_table = "stdapporteur"
        verbose_name = "Apporteur"
        verbose_name_plural = "Apporteurs"
        ordering = ["Code"]


class SecteurActivite(models.Model):
    IdSecteurActivite = models.AutoField(
        verbose_name="Id Secteur Activité",
        db_column="idsecteuractivite",
        primary_key=True,
    )
    Libelle = models.CharField(
        verbose_name="Libellé Secteur Activité",
        max_length=100,
        db_column="libelle",
    )

    def __str__(self):
        return self.Libelle

    class Meta:
        db_table = "stdsecteuractivite"


class DomaineActiviteRC(models.Model):
    id_domaine_activite = models.AutoField(
        verbose_name="Id Domaine Activité RC",
        db_column="iddomaineactivite",
        primary_key=True,
    )
    libelle = models.CharField(
        verbose_name="Libellé Domaine Activité RC",
        max_length=100,
        db_column="libelle",
    )

    def save(self, *args, **kwargs):
        if self.libelle:
            self.libelle = " ".join(self.libelle.split()).upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.libelle

    class Meta:
        db_table = "stddomaineactivite"
        constraints = [
            models.CheckConstraint(
                check=models.Q(libelle__regex=r"^[A-Z]+(?: [A-Z]+)*$"),
                name="chk_libelle_format",
            )
        ]


class Marque(models.Model):
    IdMarque = models.AutoField(
        verbose_name="Id Marque", db_column="idmarque", primary_key=True
    )
    LibelleMarque = models.CharField(
        verbose_name="Libellé", max_length=60, db_column="libellemarque"
    )

    def __str__(self):
        return self.LibelleMarque

    class Meta:
        db_table = "stdmarque"


class SystemeSecurite(models.Model):
    IdSystemeSecurite = models.AutoField(
        verbose_name="Id Système Sécurité",
        primary_key=True,
        db_column="idsystemesecurite",
    )
    LibelleSystemeSecurite = models.CharField(
        verbose_name="Libellé",
        max_length=60,
        db_column="libellesystemesecurite",
    )
    TauxReduction = models.DecimalField(
        verbose_name="Taux Réduction",
        db_column="tauxreduction",
        max_digits=19,
        decimal_places=4,
    )

    def __str__(self):
        return self.LibelleSystemeSecurite

    class Meta:
        db_table = "stdsystemesecurite"
        verbose_name = "Système de sécurité"
        verbose_name_plural = "Systèmes de sécurité"


class ModeleVehicule(models.Model):
    IdModele = models.AutoField(
        verbose_name="Id Modèle", db_column="idmodele", primary_key=True
    )
    IdMarque = models.ForeignKey(
        Marque,
        verbose_name="Id Marque",
        db_column="idmarque",
        on_delete=models.CASCADE,
    )
    LibelleModele = models.CharField(
        verbose_name="Libellé", db_column="libellemodele", max_length=30
    )

    def __str__(self):
        return self.LibelleModele

    class Meta:
        db_table = "stdmodele"
        verbose_name = "Modèle"
        verbose_name_plural = "Modèles"


class TypeAssure(models.Model):
    id = models.AutoField(verbose_name="Id type Assuré", primary_key=True)
    code_type = models.CharField(
        verbose_name="Code Type Assuré", db_column="codetype", max_length=50
    )
    libelle_type = models.CharField(
        verbose_name="Libellé Type Assuré",
        db_column="libelletype",
        max_length=100,
    )

    def __str__(self):
        return self.libelle_type + " (" + self.code_type + ")"

    class Meta:
        db_table = "stdtypeassure"
        verbose_name = "Type d'assuré"
        verbose_name_plural = "Types d'assuré"


class TypeSouscripteur(models.Model):
    id = models.AutoField(
        verbose_name="Id type Souscripteur", primary_key=True
    )
    code_type = models.CharField(
        verbose_name="Code Type Souscripteur",
        db_column="codetype",
        max_length=20,
    )
    libelle_type = models.CharField(
        verbose_name="Libellé Type Souscripteur",
        db_column="libelletype",
        max_length=100,
    )

    def __str__(self):
        return self.libelle_type + " (" + self.code_type + ")"

    class Meta:
        db_table = "stdtypesouscripteur"
        verbose_name = "Type de souscripteur"
        verbose_name_plural = "Types de souscripteur"


class UsageVehiculeAsaci(models.Model):
    id = models.AutoField(verbose_name="Id Usage ASACI", primary_key=True)
    code_usage = models.CharField(
        verbose_name="Code Usage ASACI",
        db_column="codeusage",
        max_length=50,
    )
    libelle_usage = models.CharField(
        verbose_name="Libellé", db_column="libelleusage", max_length=100
    )

    def __str__(self):
        return self.libelle_usage + " (" + self.code_usage + ")"

    class Meta:
        db_table = "stdusageasaci"
        verbose_name = "Usage ASACI"
        verbose_name_plural = "Usages ASACI"


class UsageVehicule(models.Model):
    IdUsage = models.AutoField(
        verbose_name="Id Usage", db_column="idusage", primary_key=True
    )
    CodeUsage = models.CharField(
        verbose_name="Code Usage",
        db_column="codeusage",
        max_length=3,
        validators=[MinLengthValidator(3)],
    )
    code_usage_asaci = models.CharField(
        verbose_name="Code Usage ASACI",
        max_length=50,
        db_column="codeusageasaci",
        null=True,
        blank=True,
    )
    LibelleUsage = models.CharField(
        verbose_name="Libellé", db_column="libelleusage", max_length=100
    )
    TauxTimbre = models.DecimalField(
        verbose_name="Taux de timbre",
        db_column="tauxtimbre",
        max_digits=7,
        decimal_places=4,
        default=0,
    )
    Montant = models.DecimalField(
        verbose_name="Montant",
        db_column="montant",
        max_digits=19,
        decimal_places=4,
        default=0,
    )

    def __str__(self):
        return self.LibelleUsage

    class Meta:
        db_table = "stdusage"
        verbose_name = "Usage"
        verbose_name_plural = "Usages"


class TypeVehicule(models.Model):
    id = models.AutoField(verbose_name="Id Type Véhicule", primary_key=True)
    code_type = models.CharField(
        verbose_name="Code Type Véhicule", max_length=20, db_column="codetype"
    )
    libelle_type = models.CharField(
        verbose_name="Libellé Type", max_length=255, db_column="libelletype"
    )

    def __str__(self):
        return self.libelle_type + " (" + self.code_type + ")"

    class Meta:
        db_table = "stdtypevehicule"
        verbose_name = "Type de véhicule"
        verbose_name_plural = "Types de véhicule"


class Carrosserie(models.Model):
    IdCarrosserie = models.AutoField(
        verbose_name="Id Carrosserie",
        db_column="idcarrosserie",
        primary_key=True,
    )

    LibelleCarrosserie = models.CharField(
        verbose_name="Libellé", max_length=100, db_column="libellecarrosserie"
    )
    code_genre = models.CharField(
        verbose_name="Code ASACI Genre",
        max_length=50,
        db_column="codegenre",
        null=True,
        blank=True,
    )

    Usages = models.ManyToManyField(
        UsageVehicule,
        related_name="Carrosseries",
        blank=True,
    )

    def __str__(self):
        return self.LibelleCarrosserie

    class Meta:
        db_table = "stdcarrosserie"


class UsageCarrosserie(models.Model):
    IdUsageCarrosserie = models.AutoField(
        verbose_name="Id Usage Carrosserie",
        primary_key=True,
        db_column="idusagecarrosserie",
    )
    IdUsage = models.ForeignKey(
        UsageVehicule,
        verbose_name="Usage du véhicule",
        db_column="idusage",
        on_delete=models.CASCADE,
    )
    IdCarrosserie = models.ForeignKey(
        Carrosserie,
        verbose_name="Carrosserie du véhicule",
        db_column="idcarrosserie",
        on_delete=models.CASCADE,
    )

    class Meta:
        db_table = "stdusagecarrosserie"
        unique_together = (("IdUsage", "IdCarrosserie"),)


class TypeReduction(models.Model):
    IdTypeReduction = models.AutoField(
        verbose_name="Id Type Réduction",
        db_column="idtypereduction",
        primary_key=True,
    )
    IdProduit = models.IntegerField(
        verbose_name="Id Produit", db_column="idproduit"
    )
    CodeTypeReduction = models.CharField(
        max_length=2,
        verbose_name=" Code Type Réduction",
        db_column="codetypereduction",
        validators=[MinLengthValidator(2)],
    )
    LibelleTypeReduction = models.CharField(
        max_length=60,
        verbose_name="Type Réduction",
        db_column="libelletypereduction",
    )
    NombreMinimum = models.IntegerField(
        verbose_name="Nombre minimum", db_column="nombreminimum"
    )
    NombreMaximum = models.IntegerField(
        verbose_name="Nombre maximum", db_column="nombremaximum"
    )
    NbreJourMinimum = models.IntegerField(
        default=0,
        verbose_name="Nombre minimum de jours",
        db_column="nbrejourminimum",
    )
    NbreJourMaximum = models.IntegerField(
        default=0,
        verbose_name="Nombre maximum de jours",
        db_column="nbrejourmaximum",
    )
    CapitalMinimum = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        default=0.0,
        verbose_name="Capital minimum",
        db_column="capitalminimum",
    )
    CapitalMaximum = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        default=0.0,
        verbose_name="Capital maximum",
        db_column="capitalmaximum",
    )
    TauxReduction = models.FloatField(
        default=0.0,
        verbose_name="Taux de réduction",
        db_column="tauxreduction",
    )
    Forfait = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        default=0.0,
        verbose_name="Forfait",
        db_column="forfait",
    )

    def __str__(self):
        return self.LibelleTypeReduction

    class Meta:
        db_table = "stdtypereduction"


class OffreGarantie(models.Model):
    IdOffreGarantie = models.AutoField(
        verbose_name="Id Offre Garantie",
        primary_key=True,
        db_column="idoffregarantie",
    )
    IdOffre = models.ForeignKey(
        Offre,
        verbose_name="Offre",
        db_column="idoffre",
        on_delete=models.CASCADE,
    )
    IdSousGarantie = models.ForeignKey(
        SousGarantie,
        verbose_name="Sous/Garantie",
        db_column="idsousgarantie",
        null=True,
        on_delete=models.CASCADE,
    )
    IdCompagnie = models.ForeignKey(
        Compagnie,
        verbose_name="Compagnie",
        db_column="idcompagnie",
        default=0,
        on_delete=models.CASCADE,
    )
    TauxFranchise = models.DecimalField(
        max_digits=5, decimal_places=2, db_column="tauxfranchise", default=0
    )
    FranchiseMinimum = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        db_column="franchiseminimum",
        default=0,
    )
    FranchiseMaximum = models.DecimalField(
        max_digits=19,
        decimal_places=4,
        db_column="franchisemaximum",
        default=0,
    )
    OrdreAffichage = models.SmallIntegerField(
        verbose_name="Ordre d'affichage",
        db_column="ordreaffichage",
        default=0,
    )

    class Meta:
        db_table = "stdoffregarantie"
        verbose_name = "Garantie liée à une offre"
        verbose_name_plural = "Garanties liées à une offre"


class GarantieProposee(models.Model):
    IdGarantie = models.IntegerField()
    LibelleGarantie = models.CharField(max_length=50)
    IdSousGarantie = models.IntegerField()
    LibelleSousGarantie = models.CharField(max_length=30)
    Acquise = models.BooleanField()
    Capital = models.DecimalField(max_digits=19, decimal_places=4)
    NombrePlace = models.SmallIntegerField()
    PrimeAnnuelle = models.DecimalField(max_digits=19, decimal_places=4)
    PrimeNette = models.DecimalField(max_digits=19, decimal_places=4)
    Taxe = models.DecimalField(max_digits=19, decimal_places=4)
    MontantAccessoire = models.DecimalField(max_digits=19, decimal_places=4)
    TauxFranchise = models.DecimalField(
        max_digits=5, decimal_places=2, null=True
    )
    FranchiseMinimum = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    FranchiseMaximum = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    MontantFranchise = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    TexteFranchise = models.CharField(max_length=120, null=True)

    def __str__(self):
        return (
            "Garantie: "
            + self.LibelleGarantie
            + ", "
            + "S/Garantie: "
            + self.LibelleSousGarantie
        )

    class Meta:
        managed = False


class DemandeGarantie(models.Model):
    IdOffre = models.IntegerField(null=True)
    IdTarif = models.IntegerField(null=True)
    ValNeuve = models.DecimalField(max_digits=19, decimal_places=4, null=True)
    ValVenale = models.DecimalField(max_digits=19, decimal_places=4, null=True)
    ValAccessoire = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    Puissance = models.SmallIntegerField(null=True)
    CodeCarburant = models.IntegerField(null=True)
    Tonnage = models.IntegerField(null=True)
    TauxReduction = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    CodeAlarme = models.IntegerField(null=True)
    Bns = models.DecimalField(max_digits=19, decimal_places=4, null=True)

    class Meta:
        managed = False


class DemandeGarantieIa(models.Model):
    IdOffre = models.IntegerField(null=True)
    CapitalDeces = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    CapitalInfirmite = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    CapitalFraisTraitement = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    TauxReduction = models.DecimalField(
        max_digits=5, decimal_places=2, null=True
    )
    CodeActivite = models.CharField(max_length=3, null=True)

    class Meta:
        managed = False


class DemandeGarantieHabitation(models.Model):
    IdOffre = models.IntegerField(null=True)
    ValeurCapitalLoyer = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    ValeurCapitalContenu = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    ValeurCapitalObjetPrecieux = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    ValeurCapitalMateriel = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    ValeurDegatBatiment = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    ValeurDegatContenu = models.DecimalField(
        max_digits=19, decimal_places=4, null=True
    )
    TauxReduction = models.DecimalField(
        max_digits=5, decimal_places=2, null=True
    )
    Gardien = models.BooleanField(null=True)
    Locataire = models.BooleanField(null=True)

    class Meta:
        managed = False


class DemandeGarantieRisquesDivers(models.Model):
    IdOffre = models.IntegerField()
    CapitalDommageCorporel = models.DecimalField(
        max_digits=19, decimal_places=4
    )
    CapitalDommageMateriel = models.DecimalField(
        max_digits=19, decimal_places=4
    )
    CapitalIntoxicationAlimentaire = models.DecimalField(
        max_digits=19, decimal_places=4
    )
    AssiettePrime = models.DecimalField(max_digits=19, decimal_places=4)
    TauxPrime = models.DecimalField(max_digits=5, decimal_places=2)
    TauxReduction = models.DecimalField(max_digits=5, decimal_places=2)

    class Meta:
        managed = False


class DemandeGarantieVoyage(models.Model):
    IdOffre = models.IntegerField(null=True)
    IdZoneVoyage = models.IntegerField(null=True)
    TauxReduction = models.DecimalField(
        max_digits=5, decimal_places=2, null=True
    )

    class Meta:
        managed = False


class GenreVehicule(models.Model):
    IdGenre = models.AutoField(
        verbose_name="Id Genre", primary_key=True, db_column="idgenre"
    )
    CodeGenre = models.CharField(
        max_length=50,
        verbose_name="Code Genre",
        db_column="codegenre",
        unique=True,
    )
    LibelleGenre = models.CharField(
        db_column="libellegenre", max_length=50, verbose_name="Libellé"
    )

    def __str__(self):
        return self.LibelleGenre

    class Meta:
        db_table = "stdgenrevehicule"


class Continent(models.Model):
    id_continent = models.AutoField(
        verbose_name="Id Continent", db_column="id_continent", primary_key=True
    )
    libelle_continent = models.CharField(
        verbose_name="Nom", db_column="libelle_continent", max_length=50
    )

    def __str__(self):
        return self.libelle_continent

    class Meta:
        db_table = "stdcontinent"
        verbose_name = "Continent"
        verbose_name_plural = "Continents"


class Pays(models.Model):
    id_pays = models.AutoField(
        verbose_name="Id Pays", db_column="id_pays", primary_key=True
    )
    libelle_pays = models.CharField(
        db_column="libelle_pays",
        verbose_name="Libellé",
        max_length=50,
        default="",
    )
    nationalite = models.CharField(
        db_column="nationalite", verbose_name="Nationalité", max_length=60
    )
    sin_autorise = models.BooleanField(
        db_column="sin_autorise",
        verbose_name="Sinistre Autorisé",
        default=False,
    )
    continent = models.ForeignKey(
        Continent,
        null=True,
        related_name="pays",
        on_delete=models.SET_NULL,
        db_column="continent_id",
    )
    # zone = models.ForeignKey(
    #     ZoneVoyage,
    #     null=True,
    #     related_name="pays",
    #     on_delete=models.SET_NULL,
    #     db_column="zone_id",
    # )

    def __str__(self):
        return self.libelle_pays

    class Meta:
        db_table = "stdpays"
        verbose_name = "Pays"
        verbose_name_plural = "Pays"
        ordering = ["libelle_pays"]


class PaysZone(models.Model):
    id_pays = models.BigIntegerField(
        verbose_name="Id Pays", db_column="id_pays", primary_key=True
    )
    libelle_pays = models.CharField(
        db_column="libelle_pays",
        verbose_name="Libellé",
        max_length=50,
        default="",
    )
    nationalite = models.CharField(
        db_column="nationalite", verbose_name="Nationalité", max_length=60
    )
    id_zone = models.IntegerField()

    def __str__(self):
        return self.libelle_pays

    class Meta:
        managed = False


class ZoneVoyage(models.Model):
    id_zone = models.AutoField(
        verbose_name="Id Zone", db_column="id_zone", primary_key=True
    )
    libelle_zone = models.CharField(
        verbose_name="Libellé", db_column="libelle_zone", max_length=50
    )
    compagnie = models.ForeignKey(
        Compagnie,
        verbose_name="Compagnie",
        db_column="id_compagnie",
        null=True,
        blank=True,
        default=1,
        on_delete=models.SET_NULL,
    )
    pays = models.ManyToManyField(
        Pays, through="ZoneVoyagePays", related_name="zonesvoyage"
    )

    def __str__(self):
        return self.libelle_zone

    class Meta:
        db_table = "stdzonevoyage"
        verbose_name = "Zone de destination"
        verbose_name_plural = "Zones de destination"


class ZoneVoyagePays(models.Model):
    zone_voyage = models.ForeignKey(
        ZoneVoyage,
        verbose_name="Zone de voyage",
        db_column="id_zone",
        on_delete=models.CASCADE,
    )
    pays = models.ForeignKey(
        Pays,
        verbose_name="Pays de destination",
        db_column="id_pays",
        on_delete=models.CASCADE,
    )

    def __str__(self):
        return "{}---{}".format(
            self.zone_voyage.libelle_zone, self.pays.libelle_pays
        )

    class Meta:
        db_table = "stdzonevoyagepays"
        verbose_name = "Relation Pays - Zone"
        verbose_name_plural = "Relations Pays - Zone"
        constraints = [
            models.UniqueConstraint(
                fields=["zone_voyage", "pays"], name="zone_voyage_pays_unique"
            ),
        ]


class ZoneVoyagePrime(models.Model):
    tarif = models.ForeignKey(
        Tarif,
        verbose_name="Tarif",
        db_column="id_tarif",
        related_name="primesvoyage",
        on_delete=models.CASCADE,
    )
    zone_voyage = models.ForeignKey(
        ZoneVoyage,
        verbose_name="Zone de voyage",
        db_column="id_zone",
        related_name="primesvoyage",
        on_delete=models.CASCADE,
    )
    duree_minimum = models.PositiveIntegerField(
        verbose_name="Durée minimum", db_column="duree_minimum"
    )
    duree_maximum = models.PositiveIntegerField(
        verbose_name="Durée maximum", db_column="duree_maximum"
    )
    age_minimum = models.PositiveIntegerField(
        verbose_name="Âge minimum", db_column="age_minimum"
    )
    age_maximum = models.PositiveIntegerField(
        verbose_name="Âge maximum", db_column="age_maximum"
    )
    prime_nette = models.DecimalField(
        verbose_name="Prime nette",
        db_column="prime_nette",
        max_digits=19,
        decimal_places=4,
    )
    accessoire = models.DecimalField(
        verbose_name="Accessoire",
        db_column="accessoire",
        max_digits=19,
        decimal_places=4,
    )
    taxe = models.DecimalField(
        verbose_name="Taxe", db_column="taxe", max_digits=19, decimal_places=4
    )
    prime_ttc = models.DecimalField(
        verbose_name="Prime TTC",
        db_column="prime_ttc",
        max_digits=19,
        decimal_places=4,
    )
    prime_nette_ristourne = models.DecimalField(
        verbose_name="Prime nette (ristourne)",
        db_column="prime_nette_ristourne",
        max_digits=19,
        decimal_places=4,
    )
    taxe_ristourne = models.DecimalField(
        verbose_name="Taxe (ristourne)",
        db_column="taxe_ristourne",
        max_digits=19,
        decimal_places=4,
    )
    prime_ttc_ristourne = models.DecimalField(
        verbose_name="Prime TTC (ristourne)",
        db_column="prime_ttc_ristourne",
        max_digits=19,
        decimal_places=4,
    )
    # Taux de la taxe sur prime nette + accessoire (AMSA 14,5 %, NSIA 8 %)
    taux_taxe = models.DecimalField(
        verbose_name="Taux de taxe (%)",
        db_column="taux_taxe",
        max_digits=7,
        decimal_places=4,
        default=14.5,
    )

    class Meta:
        db_table = "stdzonevoyageprime"
        verbose_name = "Tranche de prime"
        verbose_name_plural = "Tranches de prime"
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "tarif",
                    "zone_voyage",
                    "duree_minimum",
                    "duree_maximum",
                    "age_minimum",
                    "age_maximum",
                ],
                name="zone_voyage_prime_tranche_unique",
            ),
            models.CheckConstraint(
                check=Q(age_minimum__lte=models.F("age_maximum")),
                name="zone_voyage_prime_check_age",
            ),
            models.CheckConstraint(
                check=Q(duree_minimum__lte=models.F("duree_maximum")),
                name="zone_voyage_prime_check_duree",
            ),
        ]


class ZoneVoyagePrimeNsia(models.Model):
    offre = models.ForeignKey(
        Offre,
        verbose_name="Offre",
        db_column="id_offre",
        related_name="primesvoyagensia",
        on_delete=models.CASCADE,
    )
    # Vide : la ligne vaut pour toutes les zones où l'offre est proposée (OffreVoyageZone)
    zone_voyage = models.ForeignKey(
        ZoneVoyage,
        verbose_name="Zone de voyage",
        db_column="id_zone",
        related_name="primesvoyagensia",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
    )
    duree_minimum = models.PositiveIntegerField(
        verbose_name="Durée minimum", db_column="duree_minimum"
    )
    duree_maximum = models.PositiveIntegerField(
        verbose_name="Durée maximum", db_column="duree_maximum"
    )
    age_minimum = models.PositiveIntegerField(
        verbose_name="Âge minimum", db_column="age_minimum"
    )
    age_maximum = models.PositiveIntegerField(
        verbose_name="Âge maximum", db_column="age_maximum"
    )
    prime_nette = models.DecimalField(
        verbose_name="Prime nette",
        db_column="prime_nette",
        max_digits=19,
        decimal_places=4,
    )
    accessoire = models.DecimalField(
        verbose_name="Accessoire",
        db_column="accessoire",
        max_digits=19,
        decimal_places=4,
    )
    taxe = models.DecimalField(
        verbose_name="Taxe", db_column="taxe", max_digits=19, decimal_places=4
    )
    prime_ttc = models.DecimalField(
        verbose_name="Prime TTC",
        db_column="prime_ttc",
        max_digits=19,
        decimal_places=4,
    )
    prime_nette_ristourne = models.DecimalField(
        verbose_name="Prime nette (ristourne)",
        db_column="prime_nette_ristourne",
        max_digits=19,
        decimal_places=4,
    )
    taxe_ristourne = models.DecimalField(
        verbose_name="Taxe (ristourne)",
        db_column="taxe_ristourne",
        max_digits=19,
        decimal_places=4,
    )
    prime_ttc_ristourne = models.DecimalField(
        verbose_name="Prime TTC (ristourne)",
        db_column="prime_ttc_ristourne",
        max_digits=19,
        decimal_places=4,
    )
    taux_taxe = models.DecimalField(
        verbose_name="Taux de taxe (%)",
        db_column="taux_taxe",
        max_digits=7,
        decimal_places=4,
        default=14.5,
    )

    class Meta:
        db_table = "stdzonevoyageprimensia"
        verbose_name = "Tranche de prime NSIA"
        verbose_name_plural = "Tranches de prime NSIA"
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "offre",
                    "zone_voyage",
                    "duree_minimum",
                    "duree_maximum",
                    "age_minimum",
                    "age_maximum",
                ],
                name="zone_voyage_prime_nsia_tranche_unique",
            ),
            models.CheckConstraint(
                check=Q(age_minimum__lte=models.F("age_maximum")),
                name="zone_voyage_prime_nsia_check_age",
            ),
            models.CheckConstraint(
                check=Q(duree_minimum__lte=models.F("duree_maximum")),
                name="zone_voyage_prime_nsia_check_duree",
            ),
        ]


class OffreVoyageZone(models.Model):
    """Offres Voyage proposées pour une zone de destination (le pays de destination donne la zone)."""

    offre = models.ForeignKey(
        Offre,
        verbose_name="Offre",
        db_column="id_offre",
        related_name="zonesvoyage",
        on_delete=models.CASCADE,
    )
    zone_voyage = models.ForeignKey(
        ZoneVoyage,
        verbose_name="Zone de voyage",
        db_column="id_zone",
        related_name="offresvoyage",
        on_delete=models.CASCADE,
    )

    class Meta:
        db_table = "stdoffrevoyagezone"
        verbose_name = "Offre Voyage par zone"
        verbose_name_plural = "Offres Voyage par zone"
        constraints = [
            models.UniqueConstraint(fields=["offre", "zone_voyage"], name="offre_voyage_zone_unique"),
        ]


class Region(models.Model):
    IdRegion = models.AutoField(
        verbose_name="Id Région", db_column="idregion", primary_key=True
    )
    IdPays = models.ForeignKey(
        Pays,
        verbose_name="Pays",
        related_name="Régions",
        db_column="idpays",
        on_delete=models.CASCADE,
    )
    Libelle = models.CharField(
        verbose_name="Nom",
        db_column="libelle",
        max_length=100,
        blank=True,
        null=True,
    )
    CodeRegion = models.CharField(
        verbose_name="Code Région",
        db_column="coderegion",
        max_length=20,
        blank=True,
        null=True,
    )

    def __str__(self):
        return self.Libelle

    class Meta:
        db_table = "stdregion"


class Ville(models.Model):
    IdVille = models.AutoField(
        verbose_name="Id Ville", db_column="idville", primary_key=True
    )
    Libelle = models.CharField(
        verbose_name="Libellé", db_column="libelle", max_length=100
    )
    IdRegion = models.ForeignKey(
        Region,
        verbose_name="Région",
        db_column="idregion",
        related_name="Villes",
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
    )
    CodeFeder = models.CharField(
        verbose_name="Fédération", db_column="codefeder", max_length=50
    )
    CodeVille = models.CharField(
        verbose_name="Code Ville",
        db_column="codeville",
        max_length=20,
        blank=True,
        null=True,
    )

    def __str__(self):
        return self.Libelle

    class Meta:
        db_table = "stdville"


class Commune(models.Model):
    id = models.AutoField(verbose_name="Id Commune", primary_key=True)
    code_commune = models.CharField(
        max_length=20, verbose_name="Code Commune", db_column="codecommune"
    )
    nom_commune = models.CharField(
        max_length=100, verbose_name="Nom Commune", db_column="nomcommune"
    )
    ville = models.ForeignKey(
        Ville,
        related_name="communes",
        verbose_name="Ville",
        db_column="idville",
        on_delete=models.CASCADE,
    )

    def __str__(self):
        return self.nom_commune

    class Meta:
        db_table = "stdcommune"
        verbose_name = "Commune"
        verbose_name_plural = "Communes"


class Intermediaire(models.Model):
    IdIntermediaire = models.AutoField(
        verbose_name="Id Intermediaire",
        db_column="idintermediaire",
        primary_key=True,
    )
    CodeIntermediaire = models.CharField(
        verbose_name="Code Intermediaire",
        db_column="codeintermediaire",
        max_length=10,
    )
    LibelleIntermediaire = models.CharField(
        verbose_name="Libellé", db_column="libelleintermediaire", max_length=50
    )
    Adresse = models.CharField(
        verbose_name="Adresse", db_column="adresse", max_length=50
    )
    Telephone = models.CharField(
        verbose_name="Téléphone", db_column="telephone", max_length=20
    )
    Fax = models.CharField(
        verbose_name="Télécopie", db_column="fax", max_length=20
    )
    Mobile = models.CharField(
        verbose_name="Téléphone Mobile", db_column="mobile", max_length=20
    )
    Email = models.EmailField(verbose_name="Adresse Email", db_column="email")
    IdVille = models.ForeignKey(
        Ville,
        verbose_name="Ville",
        on_delete=models.DO_NOTHING,
        db_column="idville",
    )
    Retard = models.SmallIntegerField(
        verbose_name="Retard", db_column="retard"
    )
    Coassurance = models.BooleanField(
        verbose_name="Coassurance", db_column="coassurance"
    )
    CodeAsaci = models.CharField(
        verbose_name="Code ASACI", db_column="codeasaci", max_length=20
    )
    Login = models.CharField(
        verbose_name="Login", db_column="login", max_length=50
    )
    MotDePasse = models.CharField(
        verbose_name="Mot de passe", db_column="motdepasse", max_length=50
    )
    DateDebut = models.DateTimeField(
        verbose_name="Date Début", db_column="datedebut", blank=True, null=True
    )
    TitulaireAgrement = models.CharField(
        verbose_name="Titulaire Agrément",
        db_column="titulaireagrement",
        max_length=50,
    )
    Responsable = models.CharField(
        verbose_name="Responsable", db_column="responsable", max_length=50
    )
    PoliceRc = models.CharField(
        verbose_name="Police RC", db_column="policerc", max_length=50
    )
    EcheanceRc = models.DateTimeField(
        verbose_name="Echéance RC",
        db_column="echeancerc",
        blank=True,
        null=True,
    )
    NumChar = models.SmallIntegerField(
        verbose_name="NumChar",
        db_column="numchar",
    )
    IdTypeSite = models.IntegerField(
        verbose_name="Type Site", db_column="idtypesite", blank=True, null=True
    )
    ProductionActif = models.BooleanField(
        verbose_name="Production Actif",
        db_column="productionactif",
        blank=True,
        null=True,
    )
    SoldeDepot = models.DecimalField(
        verbose_name="Solde des dépôts",
        db_column="soldedepot",
        max_digits=19,
        decimal_places=4,
    )
    SoldeCommission = models.DecimalField(
        verbose_name="Solde des commissions",
        db_column="soldecommission",
        max_digits=19,
        decimal_places=4,
    )
    serie_devis = models.IntegerField(
        verbose_name="Serie devis",
        db_column="seriedevis",
        null=True,
        blank=True,
    )
    serie_contrat = models.IntegerField(
        verbose_name="Serie contrat",
        db_column="seriecontrat",
        null=True,
        blank=True,
    )
    numero_rccm = models.CharField(
        max_length=40,
        null=True,
        blank=True,
        verbose_name="Numéro Registre Commerce",
        db_column="numerorccm",
    )

    def __str__(self):
        return self.LibelleIntermediaire

    class Meta:
        db_table = "stdintermediaire"


class ContinentZonePays(models.Model):
    id_continent_zone = models.AutoField(
        verbose_name="Lien continent-zone",
        db_column="id_continent_zone",
        primary_key=True,
    )
    id_zone = models.ForeignKey(
        ZoneVoyage, db_column="id_zone", on_delete=models.CASCADE
    )
    id_continent = models.ForeignKey(
        Continent, db_column="id_continent", on_delete=models.CASCADE
    )
    id_pays = models.ForeignKey(
        Pays, db_column="id_pays", on_delete=models.CASCADE
    )

    class Meta:
        db_table = "stdcontinentzonepays"


class Produit(models.Model):
    id_produit = models.AutoField(
        verbose_name="Id Produit", db_column="idproduit", primary_key=True
    )
    libelle_produit = models.CharField(
        verbose_name="Libellé", max_length=60, db_column="libelleproduit"
    )
    active = models.BooleanField(verbose_name="Actif", db_column="active")

    avenants = models.ManyToManyField(
        Avenant,
        through="AvenantProduit",
        through_fields=("produit", "avenant"),
    )

    def __str__(self):
        return self.libelle_produit

    class Meta:
        db_table = "stdproduit"
        verbose_name = "Produit"
        verbose_name_plural = "Produits"


class AvenantProduit(models.Model):
    produit = models.ForeignKey(
        Produit,
        db_column="idproduit",
        verbose_name="ID Produit",
        on_delete=models.CASCADE,
    )
    avenant = models.ForeignKey(
        Avenant,
        db_column="idavenant",
        verbose_name="ID Avenant",
        on_delete=models.CASCADE,
    )

    commentaires = models.CharField(
        db_column="commentaires",
        verbose_name="Commentaires",
        max_length=100,
        null=True,
        default="",
    )
    flotte = models.BooleanField(db_column="flotte", verbose_name="Flotte")
    mono = models.BooleanField(db_column="mono", verbose_name="Mono")

    def __str_(self):
        return "{} ({})".format(self.produit, self.avenant)

    class Meta:
        db_table = "stdavenantproduit"
        unique_together = ["avenant", "produit"]
        verbose_name = "Avenants d'un produit"
        verbose_name_plural = "Avenants d'un produit"


class TauxTaxeGarantieProduit(models.Model):
    garantie = models.ForeignKey(
        SousGarantie,
        verbose_name="Garantie",
        db_column="idgarantie",
        default=0,
        on_delete=models.CASCADE,
    )
    produit = models.ForeignKey(
        Produit,
        verbose_name="Produit",
        db_column="idproduit",
        default=0,
        on_delete=models.CASCADE,
    )
    tauxtaxe = models.DecimalField(max_digits=5, decimal_places=2)
    tauxtaxegroupe = models.DecimalField(
        max_digits=5, decimal_places=2, default=0
    )
    debutvalidite = models.DateField()
    finvalidite = models.DateField()

    class Meta:
        db_table = "stdtauxtaxegarantieproduit"
        unique_together = (("garantie", "produit"),)


class Accessoire(models.Model):
    produit = models.ForeignKey(
        Produit,
        verbose_name="Produit",
        db_column="idproduit",
        default=0,
        on_delete=models.CASCADE,
    )
    compagnie = models.ForeignKey(
        Compagnie,
        verbose_name="Compagnie",
        db_column="idcompagnie",
        default=1,
        on_delete=models.CASCADE,
    )
    primemin = models.DecimalField(max_digits=19, decimal_places=4)
    primemax = models.DecimalField(
        max_digits=19, decimal_places=4, null=True, blank=True
    )
    accessoires = models.DecimalField(
        max_digits=19, decimal_places=4, null=True, blank=True
    )
    montantforfait = models.DecimalField(
        max_digits=19, decimal_places=4, null=True, blank=True
    )

    class Meta:
        db_table = "stdaccessoire"
        unique_together = (("produit", "compagnie", "primemin"),)


class CommissionProduit(models.Model):
    id_commission_produit = models.AutoField(
        verbose_name="Id Taux Commission",
        db_column="idprodcompacommission",
        primary_key=True,
    )
    produit = models.ForeignKey(
        Produit,
        related_name="taux_commission_produit",
        verbose_name="Produit",
        db_column="idproduit",
        on_delete=models.DO_NOTHING,
    )
    compagnie = models.ForeignKey(
        Compagnie,
        related_name="taux_commission_compagnie",
        verbose_name="Compagnie",
        db_column="idcompagnie",
        on_delete=models.DO_NOTHING,
    )
    taux_commission = models.DecimalField(
        verbose_name="Taux de commission",
        max_digits=5,
        decimal_places=2,
        db_column="tauxcommission",
    )
    forfait = models.DecimalField(
        verbose_name="Forfait",
        db_column="forfait",
        max_digits=19,
        decimal_places=4,
    )
    debut_validite = models.DateField(
        verbose_name="Valide à partir de", db_column="debutvalidite"
    )
    fin_validite = models.DateField(
        verbose_name="Valide jusqu'au", db_column="finvalidite"
    )

    class Meta:
        db_table = "stdcommissionproduitcompagnie"
        verbose_name = "Taux de commission/produit et compagnie"
        verbose_name_plural = "Taux de commission/produit et compagnie"


#################IA#########################################
class QualiteAyantDroit(models.Model):
    id_qualite = models.AutoField(
        verbose_name="Id Qualité", db_column="idqualite", primary_key=True
    )
    libelle_qualite_ayant_droit = models.CharField(
        verbose_name="Libellé",
        db_column="libellequaliteayantdroit",
        max_length=60,
    )
    code_qualite_ayant_droit = models.CharField(
        verbose_name="Code Qualité",
        db_column="codequaliteayantdroit",
        max_length=3,
        unique=True,
        validators=[MinLengthValidator(3)],
        default="000",
    )
    rente = models.BooleanField(verbose_name="Rente", default=True)

    def __str__(self):
        return self.libelle_qualite_ayant_droit

    class Meta:
        db_table = "stdqualiteayantdroit"
        verbose_name = "Qualité d'un ayant-droit"
        verbose_name_plural = "Qualités des ayant-droits"


class CategoriePermis(models.Model):
    id = models.AutoField(verbose_name="ID Catégorie", primary_key=True)
    libelle = models.CharField(verbose_name="Libelle Catégorie", max_length=20)

    def __str__(self):
        return self.libelle

    class Meta:
        db_table = "stdcategoriepermis"
        verbose_name = "Catégorie de permis de conduire"
        verbose_name_plural = "Catégories de permis de conduire"


class OffreParProduit(models.Model):
    IdOffre = models.IntegerField()
    LibelleOffre = models.CharField(max_length=80)

    def __str__(self):
        return self.LibelleOffre

    class Meta:
        managed = False


class OffreSanteParTarif(models.Model):
    IdOffre = models.IntegerField()
    LibelleOffre = models.CharField(max_length=80)
    IdZoneCouverture = models.IntegerField(null=True)

    def __str__(self):
        return self.LibelleOffre

    class Meta:
        managed = False


class TarifParProduit(models.Model):
    IdTarif = models.IntegerField()
    LibelleTarif = models.CharField(max_length=100)
    CodeCategorie = models.CharField(max_length=3)

    def __str__(self):
        return self.LibelleTarif

    class Meta:
        managed = False


class QualiteSouscripteurMrh(models.Model):
    id = models.AutoField(
        verbose_name="ID Qualité Souscripteur MRH", primary_key=True
    )
    libelle = models.CharField(
        verbose_name="Libellé Qualité Souscripteur",
        db_column="libellequalitesouscripteur",
        max_length=80,
    )

    def __str__(self):
        return self.libelle

    class Meta:
        db_table = "stdqualitesouscripteur"
        verbose_name = "Qualité du souscripteur"
        verbose_name_plural = "Qualités du souscripteur"


class ProfessionIa(models.Model):
    id = models.AutoField(verbose_name="ID Profession IA", primary_key=True)
    code_profession = models.CharField(
        verbose_name="Profession IA",
        db_column="codeprofession",
        max_length=3,
        unique=True,
        validators=[MinLengthValidator(3)],
    )
    libelle_profession = models.CharField(
        verbose_name="Libellé Profession IA",
        db_column="libelleprofession",
        max_length=150,
    )
    code_classe_assure = models.CharField(
        verbose_name="Classe de l'assuré IA",
        db_column="codeclasseassure",
        max_length=2,
        validators=[MinLengthValidator(2)],
    )
    active = models.BooleanField(verbose_name="Active")
    debut_validite = models.DateField(
        verbose_name="Valide du", db_column="debutvalidite"
    )
    fin_validite = models.DateField(
        verbose_name="Valide jusqu'au", db_column="finvalidite"
    )

    def __str__(self):
        return self.libelle_profession + " (" + self.code_profession + ")"

    class Meta:
        db_table = "stdprofessionia"
        verbose_name = "Profession IA"
        verbose_name_plural = "Professions IA"


class Banque(models.Model):
    idbanque = models.AutoField(
        primary_key=True, verbose_name="ID Banque", db_column="idbanque"
    )
    libelle = models.CharField(
        max_length=50, verbose_name="Nom de la banque", db_column="libelle"
    )
    code_banque = models.CharField(
        max_length=20,
        verbose_name="Code de la banque",
        db_column="code_banque",
        null=True,
        blank=True,
    )

    def __str__(self):
        return "{} ({})".format(self.libelle, self.idbanque)

    class Meta:
        db_table = "stdbanque"
        verbose_name = "Banque"
        verbose_name_plural = "Banques"


class ModeEncaissement(models.Model):
    idmodeencaissement = models.AutoField(
        verbose_name="ID Mode Encaissement",
        primary_key=True,
        db_column="idmodeencaissement",
    )
    libellemodepaiement = models.CharField(
        max_length=60,
        verbose_name="Mode de paiement",
        db_column="libellemodepaiement",
    )
    banque = models.BooleanField(
        verbose_name="Paiement bancaire", db_column="banque", default=False
    )
    compensation = models.BooleanField(
        verbose_name="Compensation",
        null=True,
        blank=True,
        db_column="compensation",
        default=False,
    )
    abregereglement = models.CharField(
        max_length=3,
        verbose_name="Abrégé Règlement",
        db_column="abregereglement",
        null=True,
        blank=True,
    )
    etatencaissement = models.BooleanField(
        verbose_name="Etat Encaissement",
        db_column="etatencaissement",
        null=True,
        blank=True,
    )
    ordreaffichage = models.CharField(
        max_length=2, null=True, blank=True, db_column="ordreaffichage"
    )

    def __str__(self):
        return "{} ({})".format(self.libellemodepaiement, self.abregereglement)

    class Meta:
        db_table = "stdmodeencaissement"
        verbose_name = "Mode d'encaissement"
        verbose_name_plural = "Modes d'encaissement"


class AccessoireCourtierParCompagnie(models.Model):
    IdAccessoireCourtier = models.AutoField(
        db_column="idaccessoirecourtier", primary_key=True
    )
    IdCompagnie = models.ForeignKey(
        Compagnie, db_column="idcompagnie", on_delete=models.CASCADE
    )
    PrimeMin = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="primemin"
    )
    PrimeMax = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="primemax"
    )
    Forfait = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="forfait"
    )
    Accessoires = models.DecimalField(
        max_digits=19, decimal_places=4, db_column="accessoires", default=0
    )

    class Meta:
        db_table = "stdaccessoirecourtierparcompagnie"


class CollegeSante(models.Model):
    idcollege = models.AutoField(
        db_column="idcollege", verbose_name="ID Collège", primary_key=True
    )
    libellecollege = models.CharField(
        verbose_name="Libellé", db_column="libellecollege", max_length=60
    )

    def __str__(self):
        return self.libellecollege

    class Meta:
        db_table = "stdcollege"
        verbose_name = "Collège"
        verbose_name_plural = "Collèges"


class OffreCollegeSante(models.Model):
    idoffrecollege = models.AutoField(
        db_column="idoffrecollege",
        verbose_name="ID Offre Collège",
        primary_key=True,
    )
    offre = models.ForeignKey(
        Offre,
        db_column="idoffre",
        on_delete=models.CASCADE,
        verbose_name="Offre",
    )
    college = models.ForeignKey(
        CollegeSante,
        db_column="idcollege",
        on_delete=models.CASCADE,
        verbose_name="Collège",
    )

    def __str__(self):
        return self.offre.LibelleOffre + "-" + self.college.libellecollege

    class Meta:
        db_table = "stdoffrecollege"
        constraints = [
            models.UniqueConstraint(
                fields=["offre", "college"],
                name="offrecollege_unique_offre_college",
            )
        ]


class LienJuridiqueSante(models.Model):
    codelien = models.CharField(
        verbose_name="Code Lien Juridique", max_length=1, primary_key=True
    )
    libellelien = models.CharField(max_length=20)

    def __str__(self):
        return self.libellelien

    class Meta:
        db_table = "stdlienjuridique"
        verbose_name = "Lien Juridique"
        verbose_name_plural = "Liens Juridiques"


class ZoneCouvertureSante(models.Model):
    idzone = models.AutoField(
        verbose_name="ID Zone Couverture", primary_key=True
    )
    codezone = models.CharField(
        verbose_name="Code Zone Couverture", max_length=3, unique=True
    )
    libellezone = models.CharField(
        max_length=40, verbose_name="Nom Zone Couverture"
    )

    def __str__(self):
        return "{} ({})".format(self.libellezone, self.codezone)

    class Meta:
        db_table = "stdzonecouverturesante"
        verbose_name = "Zone de couverture"
        verbose_name_plural = "Zones de couverture"


class ChoixSousGarantie:
    idgarantie = None
    idsousgarantie = None
    tauxfranchise = None
    franchiseminimum = None
    franchisemaximum = None

    def __init__(
        self,
        idgarantie,
        idsousgarantie,
        tauxfranchise,
        franchiseminimum,
        franchisemaximum,
    ):
        self.idgarantie = idgarantie
        self.idsousgarantie = idsousgarantie
        self.tauxfranchise = tauxfranchise
        self.franchiseminimum = franchiseminimum
        self.franchisemaximum = franchisemaximum


class EnregistrementOffreGarantie:
    idcompagnie = None
    idproduit = None
    idofre = None
    liste_sous_garantie = None

    def __init__(
        self,
        idcompagnie,
        idproduit,
        idoffre,
        liste_sous_garantie,
    ):
        self.idcompagnie = idcompagnie
        self.idproduit = idproduit
        self.idoffre = idoffre
        self.liste_sous_garantie = liste_sous_garantie


class GarantiePourOffre(models.Model):
    IdGarantie = models.IntegerField()
    IdSousGarantie = models.IntegerField()
    CodeSousGarantie = models.CharField(max_length=5)
    LibelleSousGarantie = models.CharField(max_length=100)
    TauxFranchise = models.DecimalField(max_digits=5, decimal_places=2)
    FranchiseMinimum = models.DecimalField(max_digits=19, decimal_places=4)
    FranchiseMaximum = models.DecimalField(max_digits=19, decimal_places=4)
    Choix = models.BooleanField()

    def __str__(self):
        return "{} ({})".format(
            self.LibelleSousGarantie, self.CodeSousGarantie
        )

    class Meta:
        managed = False


class ReductionFlotte(models.Model):
    id_reduction_flotte = models.AutoField(
        verbose_name="ID Réduction Flotte",
        db_column="idreductionflotte",
        primary_key=True,
    )
    compagnie = models.ForeignKey(
        Compagnie,
        db_column="idcompagnie",
        verbose_name="Compagnie",
        on_delete=models.CASCADE,
        null=True,
    )
    produit = models.ForeignKey(
        Produit,
        db_column="idproduit",
        verbose_name="Produit",
        on_delete=models.CASCADE,
    )
    nombre_minimum = models.IntegerField(
        verbose_name="Nombre Minimum", db_column="nombreminimum"
    )
    nombre_maximum = models.IntegerField(
        verbose_name="Nombre Maximum", db_column="nombremaximum"
    )
    taux_reduction = models.DecimalField(
        verbose_name="Taux Réduction",
        db_column="tauxreduction",
        max_digits=5,
        decimal_places=2,
    )
    taux_reduction_tarifaire = models.DecimalField(
        verbose_name="Réduction Tarifaire",
        db_column="tauxreductiontarifaire",
        max_digits=5,
        decimal_places=2,
        default=0,
    )
    taux_reduction_commerciale = models.DecimalField(
        verbose_name="Réduction Commerciale",
        db_column="tauxreductioncommerciale",
        max_digits=5,
        decimal_places=2,
        default=0,
    )
    debut_validite = models.DateField(
        verbose_name="Début Validité", db_column="debutvalidite"
    )
    fin_validite = models.DateField(
        verbose_name="Fin Validité", db_column="finvalidite"
    )

    class Meta:
        db_table = "stdreductionflotte"
        constraints = [
            CheckConstraint(
                check=Q(nombre_maximum__gte=F("nombre_minimum")),
                name="reduction_flotte_check_nombre_minimum",
            ),
            CheckConstraint(
                check=Q(fin_validite__gte=F("debut_validite")),
                name="reduction_flotte_check_debut_validite",
            ),
            CheckConstraint(
                check=Q(taux_reduction__gte=0),
                name="reduction_flotte_check_tx_red_cima",
            ),
            CheckConstraint(
                check=Q(taux_reduction_tarifaire__gte=0),
                name="reduction_flotte_check_tx_red_tarifaire",
            ),
            CheckConstraint(
                check=Q(taux_reduction_commerciale__gte=0),
                name="reduction_flotte_check_tx_red_commerciale",
            ),
        ]


class FormuleSecuriteRoutiere(models.Model):
    id_formule = models.AutoField(
        verbose_name="ID Formule Sécurité Routière",
        db_column="idformule",
        primary_key=True,
    )
    compagnie = models.ForeignKey(
        Compagnie,
        verbose_name="Compagnie",
        db_column="idcompagnie",
        on_delete=models.CASCADE,
    )
    libelle_formule = models.CharField(
        verbose_name="Libellé Formule",
        db_column="libelleformule",
        max_length=80,
    )
    capital_deces = models.DecimalField(
        verbose_name="Capital Décès",
        db_column="capitaldeces",
        max_digits=19,
        decimal_places=4,
    )
    capital_ipp = models.DecimalField(
        verbose_name="Capital Infirmité Permanente",
        db_column="capitalipp",
        max_digits=19,
        decimal_places=4,
    )
    capital_ft = models.DecimalField(
        verbose_name="Capital Frais Traitement",
        db_column="capitalft",
        max_digits=19,
        decimal_places=4,
    )
    nombre_place = models.IntegerField(
        verbose_name="Nombre de places", db_column="nombreplace", default=0
    )
    prime_nette = models.DecimalField(
        verbose_name="Prime Nette",
        db_column="primenette",
        max_digits=19,
        decimal_places=4,
    )

    def __str__(self):
        return "{} - Décès: {}, IPP: {}, FT: {}".format(
            self.libelle_formule,
            self.capital_deces,
            self.capital_ipp,
            self.capital_ft,
        )

    class Meta:
        db_table = "stdformulesecuriteroutiere"


class FormuleSecuriteRoutiereParCompagnie:
    idcompagnie = None
    codeformule = None
    libellelongformule = None

    def __init__(
        self,
        idcompagnie,
        codeformule,
        libellelongformule,
    ):
        self.idcompagnie = idcompagnie
        self.codeformule = codeformule
        self.libellelongformule = libellelongformule


class AssistanceAutomobile(models.Model):
    id_option = models.AutoField(
        verbose_name="ID Option", db_column="idoption", primary_key=True
    )
    id_compagnie = models.ForeignKey(
        Compagnie,
        db_column="idcompagnie",
        verbose_name="ID Compagnie",
        on_delete=models.CASCADE,
    )
    libelle_option = models.CharField(
        verbose_name="Libellé Option", db_column="libelleoption", max_length=50
    )
    prime_nette = models.DecimalField(
        verbose_name="Prime Nette",
        db_column="primenette",
        max_digits=19,
        decimal_places=4,
    )

    def __str__(self):
        return "{} ({})".format(self.libelle_option, self.id_compagnie)

    class Meta:
        db_table = "stdassistanceautomobile"
        verbose_name = "Option d'assistance automobile"
        verbose_name_plural = "Options d'assistance automobile"


class DelaiAvisEcheance(models.Model):
    id_delai_avis_echeance = models.AutoField(
        verbose_name="ID Délai Avis",
        db_column="iddelaiavisecheance",
        primary_key=True,
    )
    produit = models.ForeignKey(
        Produit,
        verbose_name="Produit",
        db_column="idproduit",
        on_delete=models.CASCADE,
    )
    delai_flotte = models.PositiveIntegerField(
        verbose_name="Délai pour une flotte",
        db_column="delaiflotte",
        default=0,
    )
    delai_mono = models.PositiveIntegerField(
        verbose_name="Délai pour un contrat mono",
        db_column="delaimono",
        default=0,
    )
    duree_contrat_minimum = models.PositiveIntegerField(
        verbose_name="Durée Contrat Min",
        db_column="dureecontratminimum",
        default=1,
    )
    duree_contrat_maximum = models.PositiveIntegerField(
        verbose_name="Durée Contrat Max",
        db_column="dureecontratmaximum",
        default=31,
    )

    def __str__(self):
        return "Délai d'avis d'échéance: {}".format(
            self.produit.libelle_produit
        )

    class Meta:
        db_table = "stddelaiavisecheance"
        verbose_name = "Délai d'avis d'échéance"
        verbose_name_plural = "Délais d'avis d'échéance"
        constraints = [
            models.UniqueConstraint(
                fields=["produit", "duree_contrat_minimum"],
                name="delai_avis_echeance_unique_produit_duree",
            ),
            models.CheckConstraint(
                check=models.Q(
                    duree_contrat_maximum__gte=models.F(
                        "duree_contrat_minimum"
                    )
                ),
                name="delai_avis_echeance_check_duree_min_max",
            ),
        ]


class ParametreSite(models.Model):
    id_parametre_site = models.AutoField(
        verbose_name="ID Paramètre Site",
        db_column="idparametresite",
        primary_key=True,
    )
    raison_sociale = models.CharField(
        verbose_name="Raison Sociale", db_column="raisonsociale", max_length=50
    )
    indicatif_pays = models.CharField(
        verbose_name="Indicatif Téléphonique International",
        db_column="indicatifpays",
        max_length=3,
    )
    longueur_numero_telephone = models.PositiveSmallIntegerField(
        verbose_name="Longueur N° Téléphone", db_column="longueurnumtel"
    )
    prefixe_mobile = models.CharField(
        verbose_name="Préfixe Mobile",
        db_column="prefixemobile",
        max_length=200,
    )
    longueur_prefixe_mobile = models.PositiveSmallIntegerField(
        verbose_name="Longueur Préfixe Mobile",
        db_column="longueurprefixemobile",
        default=2,
    )
    adresse_geographique = models.CharField(
        verbose_name="Adresse géographique",
        db_column="adressegeographique",
        max_length=100,
        default="",
    )
    adresse_postale = models.CharField(
        verbose_name="Adresse postale",
        db_column="adressepostale",
        max_length=50,
        default="",
    )
    telephone_fixe = models.CharField(
        verbose_name="Numéro Téléphone Fixe",
        db_column="telephonefixe",
        max_length=20,
        default="",
    )
    telephone_mobile = models.CharField(
        verbose_name="Numéro Téléphone Mobile",
        db_column="telephonemobile",
        max_length=20,
        default="",
    )
    nom_expediteur_mobile = models.CharField(
        verbose_name="Nom d'expéditeur mobile",
        db_column="nomexpediteur",
        max_length=11,
        default="",
    )

    def __str__(self):
        return self.raison_sociale

    class Meta:
        db_table = "stdparametresite"
        verbose_name = "Paramètre Site"


class TypeContratSante(models.Model):
    id_type_contrat = models.AutoField(
        db_column="idtypecontrat",
        verbose_name="ID Type Contrat",
        primary_key=True,
    )
    libelle = models.CharField(max_length=30, db_column="libelle")

    def __str__(self):
        return self.libelle

    class Meta:
        db_table = "stdtypecontratsante"
        verbose_name = "Type de contrat santé"
        verbose_name_plural = "Types de contrat santé"


class SousGarantieOrdre(models.Model):
    id = models.AutoField(db_column="id", verbose_name="ID", primary_key=True)
    sous_garantie = models.ForeignKey(
        SousGarantie, db_column="idsousgarantie", on_delete=models.CASCADE
    )
    compagnie = models.ForeignKey(
        Compagnie, db_column="idcompagnie", on_delete=models.CASCADE
    )
    ordre = models.IntegerField(db_column="ordre")
    libelle_sous_garantie = models.CharField(
        verbose_name="Libellé S/Garantie",
        db_column="libellesousgarantie",
        max_length=100,
        default="",
    )

    class Meta:
        db_table = "stdsousgarantieordre"
        verbose_name = "Ordre d'affichage des garanties"
        constraints = [
            models.UniqueConstraint(
                fields=["sous_garantie", "compagnie"],
                name="unique_sousgarantie_compagnie",
            )
        ]


class EnteteSousGarantie(models.Model):
    id = models.AutoField(
        verbose_name="ID", primary_key=True, db_column="identete"
    )
    code_entete = models.CharField(
        verbose_name="Code Entête",
        max_length=5,
        db_column="codeentete",
        unique=True,
    )
    libelle_entete = models.CharField(
        verbose_name="Libellé Entête",
        max_length=100,
        db_column="libelleentete",
    )
    compagnie = models.ForeignKey(
        Compagnie,
        verbose_name="Compagnie",
        db_column="idcompagnie",
        on_delete=models.CASCADE,
    )

    def __str__(self):
        return self.libelle_entete

    class Meta:
        db_table = "stdentetesousgarantie"


class RegroupementSousGarantie(models.Model):
    entete = models.ForeignKey(
        EnteteSousGarantie,
        to_field="code_entete",
        verbose_name="Code Entête",
        db_column="codeentete",
        on_delete=models.CASCADE,
    )
    sous_garantie = models.ForeignKey(
        SousGarantie,
        verbose_name="Sous-Garantie",
        db_column="idsousgarantie",
        on_delete=models.CASCADE,
    )

    class Meta:
        db_table = "stdregroupementsousgarantie"
        constraints = [
            models.UniqueConstraint(
                fields=["entete", "sous_garantie"],
                name="regroupementsousgrantie_unique",
            ),
        ]


class IntermediaireCompagnie(models.Model):
    id = models.AutoField(verbose_name="ID", primary_key=True)
    intermediaire = models.ForeignKey(
        Intermediaire,
        verbose_name="Intermediaire",
        db_column="idintermediaire",
        on_delete=models.CASCADE,
    )
    compagnie = models.ForeignKey(
        Compagnie,
        verbose_name="Compagnie",
        db_column="idcompagnie",
        on_delete=models.CASCADE,
    )
    codeintermediaire = models.CharField(
        max_length=10,
        verbose_name="Code Intermediaire",
        db_column="codeintermediaire",
    )
    numchar = models.SmallIntegerField(
        verbose_name="NumChar",
        db_column="numchar",
        default=0,
    )
    seriedevis = models.IntegerField(
        verbose_name="Serie devis",
        db_column="seriedevis",
        null=True,
        blank=True,
    )
    seriecontrat = models.IntegerField(
        verbose_name="Serie contrat",
        db_column="seriecontrat",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "stdintermediairecompagnie"
        verbose_name = "Relation Intermédiaire Compagnie"
        verbose_name_plural = "Relations Intermédiaire Compagnie"
        constraints = [
            models.UniqueConstraint(
                fields=["intermediaire", "compagnie"],
                name="relation_intermediaire_compagnie_unique",
            ),
        ]


class DepreciationVehicule(models.Model):
    iddepreciation = models.AutoField(
        db_column="iddepreciation",
        verbose_name="ID Dépréciation",
        primary_key=True,
    )
    taux = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        db_column="taux",
        verbose_name="Taux de dépréciation",
    )
    genre_vehicule = models.ForeignKey(
        GenreVehicule,
        db_column="codegenrevehicule",
        to_field="CodeGenre",
        verbose_name="Genre du véhicule",
        on_delete=models.CASCADE,
    )
    mois = models.SmallIntegerField(
        verbose_name="Nombre de mois", db_column="mois"
    )

    class Meta:
        db_table = "stddepreciationvehicule"
        verbose_name = "Taux de dépréciation des véhicules"
        verbose_name_plural = "Taux de dépréciation des véhicules"
        constraints = [
            models.UniqueConstraint(
                fields=["genre_vehicule", "mois"],
                name="depreciation_vehicule_mois_genre_unique",
            ),
        ]


# ============================================================================
# IMPORT DU MODÈLE EXISTANT
# ============================================================================
# Importez votre modèle Garantie existant
# from votre_app.models import Garantie as GarantieExistante


# ============================================================================
# MODÈLE 1 : USAGE HABITATION
# ============================================================================
class UsageHabitation(models.Model):
    """
    Les 8 types d'usage habitation pour MRH.
    """

    QUALITE_ASSURE_CHOICES = [
        ("PROPRIETAIRE", "Propriétaire"),
        ("LOCATAIRE", "Locataire"),
    ]
    code = models.CharField(
        max_length=50, primary_key=True, verbose_name="Code usage"
    )
    qualite_assure = models.CharField(
        max_length=20,
        choices=QUALITE_ASSURE_CHOICES,
        verbose_name="Qualité Assuré",
    )
    libelle = models.CharField(max_length=200, verbose_name="Libellé")
    description = models.TextField(
        blank=True, null=True, verbose_name="Description"
    )
    actif = models.BooleanField(default=True, verbose_name="Actif")

    offre = models.ForeignKey(
        Offre,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        db_column="idoffre",
        related_name="usage_habitation_mrh",
        verbose_name="Offre MRH liée",
        help_text="Lien avec la table stdoffre existante",
    )

    date_creation = models.DateTimeField(
        auto_now_add=True, verbose_name="Date de création"
    )
    date_modification = models.DateTimeField(
        auto_now=True, verbose_name="Date de modification"
    )

    class Meta:
        db_table = "stdmrh_usage_habitation"
        verbose_name = "Usage habitation"
        verbose_name_plural = "Usages habitation"
        ordering = ["libelle"]

    def __str__(self):
        return f"{self.libelle} ({self.code})"

    def get_id_offre(self):
        """Retourne l'ID du modèle stdoffre si lié"""
        if self.offre:
            return self.offre.IdOffre
        return None

    def get_libelle_offre(self):
        """Retourne le libellé du modèle stdoffre si lié"""
        if self.offre:
            return self.offre.LibelleOffre
        return None


# ============================================================================
# MODÈLE 2 : GARANTIE MRH (Spécifique au produit MRH)
# ============================================================================
class SousGarantieMRH(models.Model):
    """
    Sous-Garanties spécifiques au produit MRH (19 garanties).
    Ce modèle est lié au modèle SousGarantie existant via garantie_generale.
    """

    TYPE_CHOICES = [
        ("OBLIGATOIRE", "Obligatoire"),
        ("OPTIONNELLE", "Optionnelle"),
    ]

    code = models.CharField(
        max_length=50,
        primary_key=True,
        verbose_name="Code sous-garantie MRH",
        help_text="Code spécifique MRH (ex: INCENDIE, DEGAT_EAUX, etc.)",
    )
    libelle = models.CharField(max_length=200, verbose_name="Libellé")
    type = models.CharField(
        max_length=20, choices=TYPE_CHOICES, verbose_name="Type"
    )
    description = models.TextField(
        blank=True, null=True, verbose_name="Description"
    )

    # LIEN AVEC LE MODÈLE SOUS-GARANTIE EXISTANT
    sous_garantie_std = models.ForeignKey(
        SousGarantie,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        db_column="idsousgarantie",
        related_name="config_mrh",
        verbose_name="Sous-Garantie générale liée",
        help_text="Lien avec la table stdsousgarantie existante",
    )

    actif = models.BooleanField(default=True, verbose_name="Actif")
    date_creation = models.DateTimeField(
        auto_now_add=True, verbose_name="Date de création"
    )
    date_modification = models.DateTimeField(
        auto_now=True, verbose_name="Date de modification"
    )

    class Meta:
        db_table = "stdmrh_sous_garantie"
        verbose_name = "Sous-Garantie MRH"
        verbose_name_plural = "Sous-Garanties MRH"
        ordering = ["type", "libelle"]

    def __str__(self):
        return f"{self.libelle} ({self.type})"

    def get_code_sous_garantie_std(self):
        """Retourne le CodeGarantie du modèle stdgarantie si lié"""
        if self.sous_garantie_std:
            return self.sous_garantie_std.CodeSousGarantie
        return None

    def get_id_sous_garantie_std(self):
        """Retourne l'IdGarantie du modèle stdgarantie si lié"""
        if self.sous_garantie_std:
            return self.sous_garantie_std.IdSousGarantie
        return None


# ============================================================================
# MODÈLE 3 : GARANTIE ↔ USAGE (Mapping avec taux de répartition)
# ============================================================================
class SousGarantieUsage(models.Model):
    """
    Mapping entre garanties MRH et usages avec taux de répartition.
    """

    usage = models.ForeignKey(
        UsageHabitation,
        on_delete=models.CASCADE,
        related_name="sous_garanties_liees",
        verbose_name="Usage",
    )
    sous_garantie = models.ForeignKey(
        SousGarantieMRH,  # ← Utilise GarantieMRH
        on_delete=models.CASCADE,
        related_name="usages_lies",
        verbose_name="Sous-Garantie MRH",
    )
    obligatoire = models.BooleanField(default=True, verbose_name="Obligatoire")
    taux_repartition = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        blank=True,
        null=True,
        validators=[
            MinValueValidator(Decimal("0")),
            MaxValueValidator(Decimal("100")),
        ],
        verbose_name="Taux de répartition (%)",
        help_text="Pourcentage de répartition de la prime de base",
    )
    ordre_affichage = models.IntegerField(
        blank=True, null=True, verbose_name="Ordre d'affichage"
    )
    actif = models.BooleanField(default=True, verbose_name="Actif")
    date_creation = models.DateTimeField(
        auto_now_add=True, verbose_name="Date de création"
    )

    class Meta:
        db_table = "stdmrh_sous_garantie_usage"
        verbose_name = "Sous-Garantie par usage"
        verbose_name_plural = "Sous-Garanties par usage"
        unique_together = [["usage", "sous_garantie"]]
        ordering = ["usage", "ordre_affichage"]
        indexes = [
            models.Index(fields=["usage"]),
            models.Index(fields=["sous_garantie"]),
        ]

    def __str__(self):
        return f"{self.sous_garantie.libelle} - {self.usage.libelle}"

    def clean(self):
        if self.obligatoire and self.taux_repartition is None:
            raise ValidationError(
                {
                    "taux_repartition": "Le taux de répartition est requis pour une garantie obligatoire."
                }
            )


# ============================================================================
# MODÈLE 4 : PARAMÈTRES DE CALCUL
# ============================================================================
class ParametresCalcul(models.Model):
    """
    Paramètres de calcul des primes par usage.
    """

    usage = models.OneToOneField(
        UsageHabitation,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="parametres",
        verbose_name="Usage",
    )

    # Coefficients de base (en ‰)
    coeff_valeur_batiment = models.DecimalField(
        max_digits=10,
        decimal_places=6,
        blank=True,
        null=True,
        validators=[MinValueValidator(Decimal("0"))],
        verbose_name="Coefficient valeur bâtiment (‰)",
    )
    coeff_valeur_contenu = models.DecimalField(
        max_digits=10,
        decimal_places=6,
        blank=True,
        null=True,
        validators=[MinValueValidator(Decimal("0"))],
        verbose_name="Coefficient valeur contenu (‰)",
    )
    coeff_loyer = models.DecimalField(
        max_digits=10,
        decimal_places=6,
        blank=True,
        null=True,
        validators=[MinValueValidator(Decimal("0"))],
        verbose_name="Coefficient loyer (‰)",
    )
    coeff_capital_rvt = models.DecimalField(
        max_digits=10,
        decimal_places=6,
        blank=True,
        null=True,
        validators=[MinValueValidator(Decimal("0"))],
        verbose_name="Coefficient capital RVT (‰)",
    )
    coeff_reduction = models.DecimalField(
        max_digits=5,
        decimal_places=4,
        blank=True,
        null=True,
        validators=[
            MinValueValidator(Decimal("0")),
            MaxValueValidator(Decimal("1")),
        ],
        verbose_name="Coefficient de réduction",
    )
    forfait_fixe = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
        verbose_name="Forfait fixe (FCFA)",
    )

    # Paramètres requis
    param_valeur_batiment_requis = models.BooleanField(
        default=False, verbose_name="Valeur bâtiment requise"
    )
    param_valeur_contenu_requis = models.BooleanField(
        default=False, verbose_name="Valeur contenu requise"
    )
    param_loyer_requis = models.BooleanField(
        default=False, verbose_name="Loyer requis"
    )
    param_capital_rvt_requis = models.BooleanField(
        default=False, verbose_name="Capital RVT requis"
    )

    formule_texte = models.TextField(
        blank=True, null=True, verbose_name="Formule (texte)"
    )
    actif = models.BooleanField(default=True, verbose_name="Actif")
    date_creation = models.DateTimeField(
        auto_now_add=True, verbose_name="Date de création"
    )
    date_modification = models.DateTimeField(
        auto_now=True, verbose_name="Date de modification"
    )

    class Meta:
        db_table = "stdmrh_parametres_calcul"
        verbose_name = "Paramètres de calcul"
        verbose_name_plural = "Paramètres de calcul"

    def __str__(self):
        return f"Paramètres - {self.usage.libelle}"


# ============================================================================
# MODÈLE 5 : OPTION
# ============================================================================
class Option(models.Model):
    """
    Options générales et spécifiques pour ajustements de primes.
    """

    TYPE_OPTION_CHOICES = [
        ("GENERALE", "Générale"),
        ("SPECIFIQUE", "Spécifique"),
    ]
    TYPE_AJUSTEMENT_CHOICES = [
        ("TYPE1", "TYPE 1 - Taux sur prime de base"),
        ("TYPE2", "TYPE 2 - Taux sur prime garantie"),
        ("FORFAIT", "FORFAIT - Montant fixe"),
    ]
    SIGNE_CHOICES = [
        ("+", "Majoration"),
        ("-", "Réduction"),
    ]

    code = models.CharField(
        max_length=50, primary_key=True, verbose_name="Code option"
    )
    libelle = models.CharField(max_length=200, verbose_name="Libellé")
    description = models.TextField(
        blank=True, null=True, verbose_name="Description"
    )
    type_option = models.CharField(
        max_length=20,
        choices=TYPE_OPTION_CHOICES,
        verbose_name="Type d'option",
    )
    type_ajustement = models.CharField(
        max_length=20,
        choices=TYPE_AJUSTEMENT_CHOICES,
        verbose_name="Type d'ajustement",
    )
    sous_garantie_cible = models.ForeignKey(
        SousGarantieMRH,  # ← Utilise GarantieMRH
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="options_liees",
        verbose_name="Sous-Garantie cible",
    )
    taux_ajustement = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        blank=True,
        null=True,
        validators=[MinValueValidator(Decimal("0"))],
        verbose_name="Taux d'ajustement",
    )
    montant_forfait = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        blank=True,
        null=True,
        validators=[MinValueValidator(Decimal("0"))],
        verbose_name="Montant forfait (FCFA)",
    )
    signe_ajustement = models.CharField(
        max_length=1,
        choices=SIGNE_CHOICES,
        blank=True,
        null=True,
        verbose_name="Signe ajustement",
    )
    actif = models.BooleanField(default=True, verbose_name="Actif")
    date_creation = models.DateTimeField(
        auto_now_add=True, verbose_name="Date de création"
    )
    date_modification = models.DateTimeField(
        auto_now=True, verbose_name="Date de modification"
    )

    class Meta:
        db_table = "stdmrh_option"
        verbose_name = "Option"
        verbose_name_plural = "Options"
        ordering = ["type_option", "libelle"]
        indexes = [
            models.Index(fields=["sous_garantie_cible"]),
        ]

    def __str__(self):
        return f"{self.libelle} ({self.type_option})"

    def clean(self):
        if self.type_ajustement in ["TYPE1", "TYPE2"]:
            if self.taux_ajustement is None:
                raise ValidationError(
                    {
                        "taux_ajustement": f"Le taux d'ajustement est requis pour {self.type_ajustement}."
                    }
                )
        elif self.type_ajustement == "FORFAIT":
            if self.montant_forfait is None:
                raise ValidationError(
                    {
                        "montant_forfait": "Le montant forfait est requis pour TYPE FORFAIT."
                    }
                )


# ============================================================================
# MODÈLE 6 : OPTION ↔ USAGE
# ============================================================================
class OptionUsage(models.Model):
    """
    Applicabilité des options par usage.
    """

    option = models.ForeignKey(
        Option,
        on_delete=models.CASCADE,
        related_name="usages_applicables",
        verbose_name="Option",
    )
    usage = models.ForeignKey(
        UsageHabitation,
        on_delete=models.CASCADE,
        related_name="options_applicables",
        verbose_name="Usage",
    )
    actif = models.BooleanField(default=True, verbose_name="Actif")
    date_creation = models.DateTimeField(
        auto_now_add=True, verbose_name="Date de création"
    )

    class Meta:
        db_table = "stdmrh_option_usage"
        verbose_name = "Option par usage"
        verbose_name_plural = "Options par usage"
        unique_together = [["option", "usage"]]
        ordering = ["usage", "option"]
        indexes = [
            models.Index(fields=["usage"]),
            models.Index(fields=["option"]),
        ]

    def __str__(self):
        return f"{self.option.libelle} - {self.usage.libelle}"


# ============================================================================
# MODÈLE 7 : CLÉ DE RÉPARTITION
# ============================================================================
class CleRepartition(models.Model):
    """
    Clés de répartition pour le mode imposé.
    """

    TYPE_REPARTITION_CHOICES = [
        ("FIXE", "Montant fixe"),
        ("POURCENTAGE", "Pourcentage"),
    ]

    usage = models.ForeignKey(
        UsageHabitation,
        on_delete=models.CASCADE,
        related_name="cles_repartition",
        verbose_name="Usage",
    )
    sous_garantie = models.ForeignKey(
        SousGarantieMRH,
        on_delete=models.CASCADE,
        related_name="cles_repartition",
        verbose_name="Garantie",
    )
    type_repartition = models.CharField(
        max_length=20,
        choices=TYPE_REPARTITION_CHOICES,
        verbose_name="Type de répartition",
    )
    montant_fixe = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        blank=True,
        null=True,
        validators=[MinValueValidator(Decimal("0"))],
        verbose_name="Montant fixe (FCFA)",
    )
    taux_pourcentage = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        blank=True,
        null=True,
        validators=[
            MinValueValidator(Decimal("0")),
            MaxValueValidator(Decimal("100")),
        ],
        verbose_name="Taux pourcentage (%)",
    )
    groupe = models.IntegerField(
        verbose_name="Groupe", help_text="1 = montants fixes, 2 = pourcentages"
    )
    ordre_calcul = models.IntegerField(
        blank=True, null=True, verbose_name="Ordre de calcul"
    )
    actif = models.BooleanField(default=True, verbose_name="Actif")
    date_creation = models.DateTimeField(
        auto_now_add=True, verbose_name="Date de création"
    )

    class Meta:
        db_table = "stdmrh_cle_repartition"
        verbose_name = "Clé de répartition"
        verbose_name_plural = "Clés de répartition"
        unique_together = [["usage", "sous_garantie"]]
        ordering = ["usage", "groupe", "ordre_calcul"]
        indexes = [
            models.Index(fields=["usage"]),
        ]

    def __str__(self):
        return f"{self.sous_garantie.libelle} - {self.usage.libelle} (Groupe {self.groupe})"

    def clean(self):
        if self.type_repartition == "FIXE":
            if self.montant_fixe is None:
                raise ValidationError(
                    {
                        "montant_fixe": "Le montant fixe est requis pour type FIXE."
                    }
                )
        elif self.type_repartition == "POURCENTAGE":
            if self.taux_pourcentage is None:
                raise ValidationError(
                    {
                        "taux_pourcentage": "Le taux pourcentage est requis pour type POURCENTAGE."
                    }
                )


# ============================================================================
# MODÈLE 8 : SOUS-GARANTIE OPTIONNELLE À FORFAIT
# ============================================================================
class SousGarantieForfait(models.Model):
    """
    Garanties optionnelles avec prime nette forfaitaire.
    """

    sous_garantie = models.OneToOneField(
        SousGarantieMRH,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="forfait",
        verbose_name="Garantie",
    )
    prime_nette = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
        verbose_name="Prime nette (FCFA)",
    )
    description = models.TextField(
        blank=True, null=True, verbose_name="Description"
    )
    actif = models.BooleanField(default=True, verbose_name="Actif")
    date_creation = models.DateTimeField(
        auto_now_add=True, verbose_name="Date de création"
    )
    date_modification = models.DateTimeField(
        auto_now=True, verbose_name="Date de modification"
    )

    class Meta:
        db_table = "stdmrh_sous_garantie_forfait"
        verbose_name = "Sous-Garantie forfait"
        verbose_name_plural = "Sous-Garanties forfait"

    def __str__(self):
        return f"{self.sous_garantie.libelle} - {self.prime_nette} FCFA"


# ============================================================================
# RÉPARTITION DE LA PRIME SANTÉ (produit "Minéné Santé" — NSIA/OREOLE/VITALIS/ADEC)
# ============================================================================
class RepartitionPrimeSante(models.Model):
    """
    Barème de répartition de la prime HT du produit Santé (Minéné Santé)
    entre les intervenants : frais généraux compagnie (NSIA CI), commission
    du courtier (OREOLE ASSURANCES), honoraires du gestionnaire (VITALIS),
    frais de gestion (ADEC), et éventuellement la commission des commerciaux
    de la compagnie lorsque le contrat est apporté par un tiers.
    Le solde (prime HT - somme des taux) constitue la provision pour sinistre.
    """

    libelle = models.CharField(max_length=150, verbose_name="Libellé du barème")
    avec_apporteur = models.BooleanField(
        default=False,
        verbose_name="Variante avec apporteur d'affaires",
        help_text="Les taux de commission changent lorsque le contrat est apporté par un tiers.",
    )
    taux_frais_generaux_compagnie = models.DecimalField(
        max_digits=5, decimal_places=2, verbose_name="Frais généraux compagnie (NSIA CI) %"
    )
    taux_commission_courtier = models.DecimalField(
        max_digits=5, decimal_places=2, verbose_name="Commission courtier (OREOLE ASSURANCES) %"
    )
    taux_honoraire_gestionnaire = models.DecimalField(
        max_digits=5, decimal_places=2, verbose_name="Honoraires de gestion (VITALIS) %"
    )
    taux_frais_gestion_adec = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        verbose_name="Frais de gestion (ADEC) %",
        help_text="Renseigné uniquement pour la variante sans apporteur.",
    )
    taux_autres_frais_gestion = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        verbose_name="Autres frais de gestion %",
        help_text="Renseigné uniquement pour la variante sans apporteur.",
    )
    taux_commission_commerciaux = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        verbose_name="Commission commerciaux compagnie %",
        help_text="Renseigné uniquement pour la variante avec apporteur.",
    )
    frais_gestion_adec_forfait_ia = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("1500"),
        verbose_name="Frais de gestion ADEC forfaitaires — Individuelle Accidents (FCFA)",
    )
    frais_gestion_adec_forfait_rc = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("1500"),
        verbose_name="Frais de gestion ADEC forfaitaires — RC Chef de Famille (FCFA)",
    )
    actif = models.BooleanField(default=True, verbose_name="Actif")
    date_creation = models.DateTimeField(auto_now_add=True, verbose_name="Date de création")
    date_modification = models.DateTimeField(auto_now=True, verbose_name="Date de modification")

    class Meta:
        db_table = "stdrepartitionprimesante"
        verbose_name = "Répartition de la prime Santé"
        verbose_name_plural = "Répartitions de la prime Santé"

    def __str__(self):
        variante = "Avec apporteur" if self.avec_apporteur else "Sans apporteur"
        return f"{self.libelle} ({variante})"

    def calculer_repartition(self, prime_ht):
        """
        Calcule la ventilation d'une prime HT selon ce barème.
        Retourne un dict avec chaque part + la provision pour sinistre (solde).
        """
        prime_ht = Decimal(prime_ht)

        def part(taux):
            if taux is None:
                return Decimal("0")
            return (prime_ht * Decimal(taux) / Decimal("100")).quantize(Decimal("1"))

        frais_generaux = part(self.taux_frais_generaux_compagnie)
        commission_courtier = part(self.taux_commission_courtier)
        honoraire_gestionnaire = part(self.taux_honoraire_gestionnaire)
        frais_gestion_adec = part(self.taux_frais_gestion_adec)
        autres_frais_gestion = part(self.taux_autres_frais_gestion)
        commission_commerciaux = part(self.taux_commission_commerciaux)

        total_parts = (
            frais_generaux
            + commission_courtier
            + honoraire_gestionnaire
            + frais_gestion_adec
            + autres_frais_gestion
            + commission_commerciaux
        )
        provision_sinistre = prime_ht - total_parts

        return {
            "prime_ht": prime_ht,
            "frais_generaux_compagnie": frais_generaux,
            "commission_courtier": commission_courtier,
            "honoraire_gestionnaire": honoraire_gestionnaire,
            "frais_gestion_adec": frais_gestion_adec,
            "autres_frais_gestion": autres_frais_gestion,
            "commission_commerciaux": commission_commerciaux,
            "provision_sinistre": provision_sinistre,
        }


# ============================================================================
# PARAMÉTRAGE LE PHARE : ce qui était écrit dans le code et se règle désormais dans
# l'administration (écrans « Le cabinet », « Compagnies partenaires », « Produits »).
# Lu par GET /api/parametrage/ (configuration_api/parametrage.py) ; une valeur absente
# ou illisible laisse s'appliquer la valeur d'origine prévue dans le code.
# ============================================================================
class ParametreGeneral(models.Model):
    """Règle de gestion ou réglage de document, sous forme clé / valeur typée."""

    TYPES = [
        ("texte", "Texte"),
        ("texte_long", "Texte sur plusieurs lignes"),
        ("entier", "Nombre entier"),
        ("decimal", "Nombre décimal"),
        ("montant", "Montant (FCFA)"),
        ("pourcentage", "Pourcentage"),
        ("date", "Date"),
        ("booleen", "Oui / Non"),
        ("image", "Image"),
    ]

    Cle = models.CharField(max_length=80, primary_key=True, db_column="cle")
    Groupe = models.CharField(max_length=40, db_column="groupe")
    Libelle = models.CharField(max_length=150, db_column="libelle")
    Aide = models.TextField(blank=True, default="", db_column="aide")
    Type = models.CharField(max_length=20, choices=TYPES, default="texte", db_column="type")
    Valeur = models.TextField(blank=True, default="", db_column="valeur")
    # Valeur livrée avec l'application, pour « Rétablir la valeur d'origine »
    ValeurOrigine = models.TextField(blank=True, default="", db_column="valeurorigine")
    Unite = models.CharField(max_length=20, blank=True, default="", db_column="unite")
    Minimum = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True, db_column="minimum")
    Maximum = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True, db_column="maximum")
    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")
    ModifiePar = models.CharField(max_length=150, blank=True, default="", db_column="modifiepar")

    def __str__(self):
        return f"{self.Cle} = {self.Valeur}"

    class Meta:
        db_table = "lephare_parametre"
        verbose_name = "Paramètre général"
        verbose_name_plural = "Paramètres généraux"
        ordering = ["Groupe", "Ordre", "Cle"]


class CompagnieDocument(models.Model):
    """Ce que les documents imprimés reprennent d'une compagnie (stdcompagnie, table URANUS)."""

    IdCompagnie = models.IntegerField(primary_key=True, db_column="idcompagnie")
    # Image en data URL (png/jpeg/svg) : imprimée telle quelle, sans serveur de fichiers
    Logo = models.TextField(blank=True, default="", db_column="logo")
    # Pied de page des Conditions Particulières : une ligne par ligne imprimée
    PiedPage = models.TextField(blank=True, default="", db_column="piedpage")
    Visa = models.CharField(max_length=200, blank=True, default="", db_column="visa")
    # Mention imprimée sous le logo du pied de page (ex. « depuis 1995 »)
    MentionLogo = models.CharField(max_length=100, blank=True, default="", db_column="mentionlogo")
    # « Chèque à l'ordre de » du relevé de compte (ex. « NSIA CI ») ; vide : raison sociale
    OrdreCheque = models.CharField(max_length=100, blank=True, default="", db_column="ordrecheque")
    # Attestation d'assurance voyage : {Actif, Convention, PaysResidence, Signataire,
    # Garanties: [...], Telephone, Email, Whatsapp, Exemplaires: [...]}
    AttestationVoyage = models.JSONField(default=dict, blank=True, db_column="attestationvoyage")
    # Reversements et courriers : {PartAccessoiresCourtier (%, vide : barème des accessoires du cabinet),
    # NomBordereau (« NSIA CI »), Destinataire, Service, Ville, AttentionDe, Appellation (« Monsieur »)}
    Reversement = models.JSONField(default=dict, blank=True, db_column="reversement")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")

    class Meta:
        db_table = "lephare_compagnie_document"
        verbose_name = "Documents d'une compagnie"
        verbose_name_plural = "Documents des compagnies"


class ProduitParametre(models.Model):
    """Place d'un produit (stdproduit) dans LE PHARE : onglet du registre et formulaire de saisie."""

    MODULES = [
        ("", "Aucun formulaire"),
        ("auto", "Automobile"),
        ("ia", "Individuelle Accidents"),
        ("voyage", "Voyage"),
        ("mrh", "Multirisque Habitation"),
        ("sante", "Santé"),
        ("transport", "Transport"),
        ("rc", "Responsabilité Civile"),
        ("mrp", "Multirisque Professionnelle"),
        ("tous-dommages", "Tous Dommages"),
        ("afa", "Vie - AFA"),
    ]

    IdProduit = models.IntegerField(primary_key=True, db_column="idproduit")
    # Onglet du registre des devis (les produits du même onglet sont regroupés)
    Onglet = models.CharField(max_length=40, db_column="onglet")
    ModuleSaisie = models.CharField(max_length=30, blank=True, default="", choices=MODULES, db_column="modulesaisie")
    SaisieOuverte = models.BooleanField(default=False, db_column="saisieouverte")
    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")
    # Prime TTC arrondie à la pièce (fn_lephare_arrondi_montant, réglages « montants.arrondi_* ») ; non : TTC des
    # grilles de la compagnie gardée telle quelle
    ArrondiTtc = models.BooleanField(default=True, db_column="arrondittc")
    # Compagnie proposée à l'ouverture d'un nouveau devis du produit (vide : la première de la liste)
    IdCompagnieDefaut = models.IntegerField(null=True, blank=True, db_column="idcompagniedefaut")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")

    class Meta:
        db_table = "lephare_produit_parametre"
        verbose_name = "Paramètre d'un produit"
        verbose_name_plural = "Paramètres des produits"
        ordering = ["Ordre", "IdProduit"]


class DommageCategorie(models.Model):
    """Catégorie de la branche Dommages (stdtarif 4xx, produit 9) telle que la propose LE PHARE."""

    TYPES_CHAMP = [
        ("texte", "Texte court"),
        ("texte_long", "Texte sur plusieurs lignes"),
        ("date", "Date"),
        ("montant", "Montant (FCFA)"),
        ("liste", "Liste de choix"),
    ]

    IdTarif = models.IntegerField(primary_key=True, db_column="idtarif")
    # Catégorie proposée dans l'écran de devis Dommages
    SaisieOuverte = models.BooleanField(default=True, db_column="saisieouverte")
    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")
    # Phrase affichée sous la catégorie dans l'écran de devis
    Description = models.TextField(blank=True, default="", db_column="description")
    # Prime au prorata de la durée quand le contrat n'est pas annuel (URANUS : jamais)
    Prorata = models.BooleanField(default=False, db_column="prorata")
    # Description du risque demandée à la saisie : [{Cle, Libelle, Type, Obligatoire, Options}]
    ChampsRisque = models.JSONField(default=list, blank=True, db_column="champsrisque")
    # Textes de la fiche de cotation imprimée (modèle « Cotation d'assurance » de NSIA) : objet de la
    # garantie, contre-garanties et mesures préalables, exclusions (une ligne par élément)
    ObjetGarantie = models.TextField(blank=True, default="", db_column="objetgarantie")
    ContreGaranties = models.TextField(blank=True, default="", db_column="contregaranties")
    Exclusions = models.TextField(blank=True, default="", db_column="exclusions")
    # Cotation imprimée : tableau des garanties en annexe (page 2) ; sinon les garanties sont citées dans la
    # cotation même (Caution : annexe supprimée, compte rendu du 12-10-2026)
    AnnexeCotation = models.BooleanField(default=True, db_column="annexecotation")
    # Référence imprimée entre parenthèses après la catégorie sur la facture de prime : texte libre et champs
    # du risque entre accolades (Caution : « {numero_appel_offres} {beneficiaire} »)
    ReferenceFacture = models.CharField(max_length=200, blank=True, default="", db_column="referencefacture")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")

    class Meta:
        db_table = "lephare_dommage_categorie"
        verbose_name = "Catégorie Dommages"
        verbose_name_plural = "Catégories Dommages"
        ordering = ["Ordre", "IdTarif"]


class DommageDocument(models.Model):
    """Document de production d'une catégorie Dommages imprimé depuis le contrat (ex. « Garantie de soumission »
    d'une caution) : texte dont les champs entre accolades ({beneficiaire}, {numero_police}, {capital_lettres}…)
    sont remplacés par les données du contrat et du risque saisi."""

    IdTarif = models.IntegerField(db_column="idtarif")
    # Compagnie émettrice (0 : toutes les compagnies) : son logo et son pied de page encadrent le document
    IdCompagnie = models.IntegerField(default=0, db_column="idcompagnie")
    Titre = models.CharField(max_length=120, db_column="titre")
    # Document proposé seulement si le champ du risque contient la valeur (ex. type_cautionnement /
    # « SOUMISSION ») ; vide : toujours proposé
    ConditionChamp = models.CharField(max_length=40, blank=True, default="", db_column="conditionchamp")
    ConditionValeur = models.CharField(max_length=120, blank=True, default="", db_column="conditionvaleur")
    # Texte : paragraphes séparés par une ligne vide, **gras**, ligne en retrait si elle commence par des espaces
    Corps = models.TextField(db_column="corps")
    # Signataire : une ligne par ligne imprimée (nom puis fonction)
    Signataire = models.TextField(blank=True, default="", db_column="signataire")
    MentionSignature = models.CharField(max_length=200, blank=True, default="", db_column="mentionsignature")
    Actif = models.BooleanField(default=True, db_column="actif")
    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")

    class Meta:
        db_table = "lephare_dommage_document"
        verbose_name = "Document de production Dommages"
        verbose_name_plural = "Documents de production Dommages"
        ordering = ["IdTarif", "Ordre", "id"]


class DommageGarantie(models.Model):
    """Réglages LE PHARE d'une garantie d'offre Dommages (stdoffregarantie) : taux proposé, obligation."""

    IdOffre = models.IntegerField(db_column="idoffre")
    IdCompagnie = models.IntegerField(db_column="idcompagnie")
    IdSousGarantie = models.IntegerField(db_column="idsousgarantie")
    # Taux de prime (% du capital) proposé à la saisie ; vide : prime saisie en montant
    TauxDefaut = models.DecimalField(max_digits=9, decimal_places=4, null=True, blank=True, db_column="tauxdefaut")
    # Garantie toujours retenue (case cochée et non décochable)
    Obligatoire = models.BooleanField(default=False, db_column="obligatoire")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")

    class Meta:
        db_table = "lephare_dommage_garantie"
        verbose_name = "Garantie Dommages"
        verbose_name_plural = "Garanties Dommages"
        constraints = [
            models.UniqueConstraint(fields=["IdOffre", "IdCompagnie", "IdSousGarantie"], name="lephare_dommage_garantie_unique"),
        ]


class SanteFormuleMinene(models.Model):
    """Formule MINENE SANTÉ (offre Santé d'URANUS, stdoffre) : tarif et barème de soins.

    Lue par la base pour tarifer (fn_get_prime_base_minene_sante, fn_minene_personnes_max) et par les
    imprimés (barème annexé aux conditions particulières). Valeurs d'origine : TARIFICATION MINENE
    SANTE.xlsx, BAREME_70-80.pdf et BAREMES DE SOINS- MINENE SANTE- 80% Tous actes.docx (OREOLE).
    """

    IdOffre = models.IntegerField(primary_key=True, db_column="idoffre")
    # Option imprimée sur le barème (SOLO, FAMILLE, FAMILLE PLUS) et composition de la famille
    Option = models.CharField(max_length=40, db_column="option")
    Composition = models.CharField(max_length=200, blank=True, default="", db_column="composition")
    PersonnesMin = models.PositiveSmallIntegerField(default=1, db_column="personnesmin")
    PersonnesMax = models.PositiveSmallIntegerField(default=1, db_column="personnesmax")
    # Prime nette Santé annuelle d'une famille (prime de base des surprimes)
    PrimeBase = models.DecimalField(max_digits=15, decimal_places=2, db_column="primebase")
    TauxSoinsExternes = models.DecimalField(max_digits=5, decimal_places=2, db_column="tauxsoinsexternes")
    TauxHospitalisation = models.DecimalField(max_digits=5, decimal_places=2, db_column="tauxhospitalisation")
    # Plafonds de remboursement (FCFA)
    ChambreParJour = models.DecimalField(max_digits=15, decimal_places=2, db_column="chambreparjour")
    AmbulanceParCas = models.DecimalField(max_digits=15, decimal_places=2, db_column="ambulanceparcas")
    AccouchementSimple = models.DecimalField(max_digits=15, decimal_places=2, db_column="accouchementsimple")
    AccouchementGemellaire = models.DecimalField(max_digits=15, decimal_places=2, db_column="accouchementgemellaire")
    AccouchementChirurgical = models.DecimalField(max_digits=15, decimal_places=2, db_column="accouchementchirurgical")
    AccouchementHorsStructure = models.DecimalField(max_digits=15, decimal_places=2, db_column="accouchementhorsstructure")
    OptiqueAdulte = models.DecimalField(max_digits=15, decimal_places=2, db_column="optiqueadulte")
    OptiqueEnfant = models.DecimalField(max_digits=15, decimal_places=2, db_column="optiqueenfant")
    DentaireParPersonne = models.DecimalField(max_digits=15, decimal_places=2, db_column="dentaireparpersonne")
    PlafondAnnuel = models.DecimalField(max_digits=15, decimal_places=2, db_column="plafondannuel")
    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")
    ModifiePar = models.CharField(max_length=150, blank=True, default="", db_column="modifiepar")

    class Meta:
        db_table = "lephare_sante_formule"
        verbose_name = "Formule MINENE Santé"
        verbose_name_plural = "Formules MINENE Santé"
        ordering = ["Ordre", "IdOffre"]


class DepreciationClasse(models.Model):
    """Ligne du tableau de dépréciation des véhicules (CIEAMI, « Tableau de dépréciation applicable aux
    véhicules terrestres à moteur en Côte d'Ivoire ») : taux de dépréciation par âge du véhicule.

    Taux : {"<âge en mois>": [taux] ou [taux minimum, taux maximum]}, par exemple {"18": [30, 35]}.
    Lu par fn_lephare_depreciation (valeur vénale à la saisie, à l'import et au renouvellement).
    """

    Code = models.CharField(max_length=30, primary_key=True, db_column="code")
    Libelle = models.CharField(max_length=100, db_column="libelle")
    Kilometrage = models.CharField(max_length=100, blank=True, default="", db_column="kilometrage")
    Taux = models.JSONField(default=dict, blank=True, db_column="taux")
    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")
    ModifiePar = models.CharField(max_length=150, blank=True, default="", db_column="modifiepar")

    class Meta:
        db_table = "lephare_depreciation_classe"
        verbose_name = "Ligne du tableau de dépréciation"
        verbose_name_plural = "Tableau de dépréciation"
        ordering = ["Ordre", "Code"]


class DepreciationRegle(models.Model):
    """Ligne du tableau de dépréciation retenue pour un véhicule : première règle (par ordre) dont tous
    les critères renseignés correspondent (genre, type, carrosserie, catégorie tarifaire, charge utile)."""

    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")
    Classe = models.ForeignKey(DepreciationClasse, on_delete=models.CASCADE, db_column="classe", related_name="regles")
    IdGenre = models.IntegerField(null=True, blank=True, db_column="idgenre")
    IdTypeVehicule = models.IntegerField(null=True, blank=True, db_column="idtypevehicule")
    IdCarrosserie = models.IntegerField(null=True, blank=True, db_column="idcarrosserie")
    CodeCategorie = models.CharField(max_length=3, blank=True, default="", db_column="codecategorie")
    # Charge utile strictement supérieure à (kg) ; vide : sans condition
    ChargeUtileSuperieureA = models.IntegerField(null=True, blank=True, db_column="chargeutilesuperieurea")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")

    class Meta:
        db_table = "lephare_depreciation_regle"
        verbose_name = "Règle de classement (dépréciation)"
        verbose_name_plural = "Règles de classement (dépréciation)"
        ordering = ["Ordre", "id"]


class AutoRegleGarantie(models.Model):
    """Règle de gestion Automobile : garantie admise selon l'âge du véhicule (années révolues depuis la
    première mise en circulation, à la date d'effet), par compagnie. Ex. NSIA : tous risques (DOMMAGES)
    de 0 à 5 ans, NSIA Auto Plus de 5 à 10 ans. Non cochée d'office à la saisie ; le producteur peut l'accorder."""

    IdCompagnie = models.IntegerField(db_column="idcompagnie")
    IdSousGarantie = models.IntegerField(db_column="idsousgarantie")
    # Âge minimum inclus, âge maximum exclu (années révolues) ; vide : sans limite
    AgeMinimum = models.PositiveSmallIntegerField(null=True, blank=True, db_column="ageminimum")
    AgeMaximum = models.PositiveSmallIntegerField(null=True, blank=True, db_column="agemaximum")
    # Codes de catégorie concernés, séparés par des virgules (vide : toutes)
    Categories = models.CharField(max_length=100, blank=True, default="", db_column="categories")
    Commentaire = models.CharField(max_length=200, blank=True, default="", db_column="commentaire")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")

    class Meta:
        db_table = "lephare_auto_regle_garantie"
        verbose_name = "Garantie admise selon l'âge du véhicule"
        verbose_name_plural = "Garanties admises selon l'âge du véhicule"
        ordering = ["IdCompagnie", "IdSousGarantie"]



class AutoRegleInteraction(models.Model):
    """Règle de gestion Automobile entre garanties, par compagnie (tarif annoté NSIA : « interaction avec les autres
    garanties ») : appliquée à l'écran à chaque garantie cochée, décochée, ajoutée ou retirée.

    OBLIGATOIRE : ne peut être ni décochée ni retirée. REQUIERT : ne peut être cochée sans une des garanties liées.
    EXCLUE_SI : décochée tant qu'une des garanties liées est souscrite. OFFERTE_SI : prime nulle quand une des garanties
    liées est souscrite. PRIME_SI : prime annuelle forfaitaire quand une des garanties liées est souscrite.
    NON_PROPOSEE : non commercialisée dans les catégories indiquées. NON_COCHEE : proposée sans être cochée d'office.
    COUPLEE : vendue avec une des garanties liées (cochée, elle les coche ; sans aucune d'elles, elle est décochée).
    PRIME_MINIMUM : prime annuelle minimale de la garantie, appliquée par le barème."""

    TYPES = [
        ("OBLIGATOIRE", "Obligatoire"),
        ("REQUIERT", "Exige une des garanties liées"),
        ("EXCLUE_SI", "Exclue si une des garanties liées est souscrite"),
        ("OFFERTE_SI", "Offerte si une des garanties liées est souscrite"),
        ("PRIME_SI", "Prime forfaitaire si une des garanties liées est souscrite"),
        ("COUPLEE", "Vendue avec une des garanties liées"),
        ("PRIME_MINIMUM", "Prime minimum"),
        ("NON_PROPOSEE", "Non commercialisée"),
        ("NON_COCHEE", "Proposée sans être cochée d'office"),
    ]

    IdCompagnie = models.IntegerField(db_column="idcompagnie")
    IdSousGarantie = models.IntegerField(db_column="idsousgarantie")
    Type = models.CharField(max_length=20, choices=TYPES, db_column="type")
    # Sous-garanties liées, séparées par des virgules (REQUIERT, EXCLUE_SI, OFFERTE_SI, PRIME_SI, COUPLEE)
    Liees = models.CharField(max_length=100, blank=True, default="", db_column="liees")
    # Codes de catégorie concernés, séparés par des virgules (vide : toutes)
    Categories = models.CharField(max_length=100, blank=True, default="", db_column="categories")
    PrimeAnnuelle = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True, db_column="primeannuelle")
    Commentaire = models.CharField(max_length=300, blank=True, default="", db_column="commentaire")
    Actif = models.BooleanField(default=True, db_column="actif")
    # OFFERTE_SI / PRIME_SI appliquées aussi par le barème (fn_lephare_regle_auto) aux offres qui contiennent une des
    # garanties liées ; sinon à l'écran seulement, quand l'utilisateur ajoute la garantie liée. PRIME_MINIMUM : toujours
    # par le barème.
    AppliqueeBareme = models.BooleanField(default=False, db_column="appliqueebareme")
    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")
    ModifiePar = models.CharField(max_length=150, blank=True, default="", db_column="modifiepar")

    class Meta:
        db_table = "lephare_auto_regle_interaction"
        verbose_name = "Règle entre garanties (Automobile)"
        verbose_name_plural = "Règles entre garanties (Automobile)"
        ordering = ["IdCompagnie", "Ordre", "id"]

class PoolTpvTranche(models.Model):
    """Tranche du tarif du POOL TPV (transport public de voyageurs, catégorie 204) : prime RC annuelle selon le
    nombre de places et accessoires selon la durée (1 à 12 mois). Le Recours (défense recours) vaut un
    pourcentage de la RC ; la prime d'une durée = prime annuelle × fraction de la durée (paramètres
    auto.pool_tpv.*). Lu par la base (fn_pool_tpv) pour l'offre « POOL TPV (CAT 204) »."""

    PlacesMin = models.PositiveSmallIntegerField(db_column="placesmin")
    PlacesMax = models.PositiveSmallIntegerField(null=True, blank=True, db_column="placesmax")
    PrimeRcAnnuelle = models.DecimalField(max_digits=15, decimal_places=2, db_column="primercannuelle")
    # Accessoires par durée : [1 mois, 2 mois, …, 12 mois]
    Accessoires = models.JSONField(default=list, blank=True, db_column="accessoires")
    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")
    ModifiePar = models.CharField(max_length=150, blank=True, default="", db_column="modifiepar")

    class Meta:
        db_table = "lephare_pool_tpv_tranche"
        verbose_name = "Tranche du tarif Pool TPV"
        verbose_name_plural = "Tarif Pool TPV"
        ordering = ["Ordre", "PlacesMin"]


class TarifAutoGrille(models.Model):
    """Tarif automobile « à lecture directe » d'une compagnie (ex. NSIA : VP essence, VP diesel, TPC, TPM) : primes
    toutes faites par tranche de puissance ou de charge utile et par durée, appliquées sans saisie aux offres
    choisies (Administration > Réglages Automobile > Tarifs à lecture directe). Une durée absente de la grille,
    une autre offre ou un véhicule hors tranche : calcul du barème (fn_garantie_offre)."""

    CRITERES = [("PUISSANCE", "Puissance fiscale (CV)"), ("CHARGE_UTILE", "Charge utile (kg)")]

    IdCompagnie = models.IntegerField(db_column="idcompagnie")
    Libelle = models.CharField(max_length=100, db_column="libelle")
    # Codes de catégorie tarifaire concernés, séparés par des virgules (ex. « 201 »)
    Categories = models.CharField(max_length=100, db_column="categories")
    # Énergie du véhicule (stdenergie : 1 essence, 2 diesel) ; vide : toutes
    IdEnergie = models.IntegerField(null=True, blank=True, db_column="idenergie")
    Critere = models.CharField(max_length=20, choices=CRITERES, default="PUISSANCE", db_column="critere")
    # Offres (stdoffre) tarifées par cette grille, séparées par des virgules
    Offres = models.CharField(max_length=200, blank=True, default="", db_column="offres")
    Actif = models.BooleanField(default=True, db_column="actif")
    Source = models.CharField(max_length=200, blank=True, default="", db_column="source")
    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")
    ModifiePar = models.CharField(max_length=150, blank=True, default="", db_column="modifiepar")

    class Meta:
        db_table = "lephare_auto_tarif_grille"
        verbose_name = "Tarif automobile à lecture directe"
        verbose_name_plural = "Tarifs automobiles à lecture directe"
        ordering = ["IdCompagnie", "Ordre", "id"]


class TarifAutoGrilleLigne(models.Model):
    """Tranche d'un tarif à lecture directe pour une durée : montants tels que publiés par la compagnie (chaque
    composante arrondie à part, d'où un TTC parfois différent de 1 F de leur somme)."""

    Grille = models.ForeignKey(TarifAutoGrille, on_delete=models.CASCADE, db_column="grille", related_name="lignes")
    Libelle = models.CharField(max_length=60, db_column="libelle")
    # Bornes incluses de la puissance (CV) ou de la charge utile (kg) ; maximum vide : sans limite
    BorneMin = models.IntegerField(null=True, blank=True, db_column="bornemin")
    BorneMax = models.IntegerField(null=True, blank=True, db_column="bornemax")
    # Usages (stdusage.codeusage, ex. « 017,022 » tracteur routier) : la ligne vaut pour ces usages quelle que
    # soit la tranche ; vide : tranche ordinaire
    Usages = models.CharField(max_length=60, blank=True, default="", db_column="usages")
    DureeMois = models.PositiveSmallIntegerField(db_column="dureemois")
    PrimeNette = models.DecimalField(max_digits=15, decimal_places=2, db_column="primenette")
    Accessoire = models.DecimalField(max_digits=15, decimal_places=2, db_column="accessoire")
    Taxe = models.DecimalField(max_digits=15, decimal_places=2, db_column="taxe")
    Fga = models.DecimalField(max_digits=15, decimal_places=2, db_column="fga")
    Cedeao = models.DecimalField(max_digits=15, decimal_places=2, db_column="cedeao")
    PrimeTtc = models.DecimalField(max_digits=15, decimal_places=2, db_column="primettc")
    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")

    class Meta:
        db_table = "lephare_auto_tarif_grille_ligne"
        verbose_name = "Tranche d'un tarif à lecture directe"
        verbose_name_plural = "Tranches des tarifs à lecture directe"
        ordering = ["Grille", "-DureeMois", "Ordre", "id"]


class TransportMode(models.Model):
    """Mode de transport des affaires Transport hors GUCE (Réglages Transport) : libellés repris à la cotation,
    document et moyen de transport demandés, modes de chargement proposés. La catégorie (stdtarif 6xx) est fixe."""

    Code = models.CharField(max_length=12, primary_key=True, db_column="code")
    Libelle = models.CharField(max_length=60, db_column="libelle")
    CodeCategorie = models.CharField(max_length=3, db_column="codecategorie")
    Document = models.CharField(max_length=80, blank=True, default="", db_column="document")
    Moyen = models.CharField(max_length=80, blank=True, default="", db_column="moyen")
    Chargements = models.JSONField(default=list, db_column="chargements")
    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")
    Actif = models.BooleanField(default=True, db_column="actif")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")
    ModifiePar = models.CharField(max_length=150, blank=True, default="", db_column="modifiepar")

    class Meta:
        db_table = "lephare_transport_mode"
        verbose_name = "Mode de transport"
        verbose_name_plural = "Modes de transport"
        ordering = ["Ordre", "Code"]


class TransportGarantie(models.Model):
    """Garantie proposée à la cotation Transport hors GUCE : garantie de base (une seule) ou extension cumulable,
    rattachée à une sous-garantie du référentiel (stdsousgarantie). Taux proposé par mode de transport
    ({code du mode: taux en %}, vide : saisi à la cotation) ; TauxMinimum : le taux proposé est un plancher
    (FAP Sauf, taux minimum réglementaire)."""

    GROUPES = [("BASE", "Garantie de base"), ("EXTENSION", "Extension ou surprime")]

    Code = models.CharField(max_length=30, primary_key=True, db_column="code")
    Groupe = models.CharField(max_length=10, choices=GROUPES, db_column="groupe")
    Libelle = models.CharField(max_length=80, db_column="libelle")
    Description = models.TextField(blank=True, default="", db_column="description")
    CodeSousGarantie = models.CharField(max_length=10, db_column="codesousgarantie")
    Taux = models.JSONField(default=dict, db_column="taux")
    TauxMinimum = models.BooleanField(default=False, db_column="tauxminimum")
    Ordre = models.PositiveSmallIntegerField(default=0, db_column="ordre")
    Active = models.BooleanField(default=True, db_column="active")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")
    ModifiePar = models.CharField(max_length=150, blank=True, default="", db_column="modifiepar")

    class Meta:
        db_table = "lephare_transport_garantie"
        verbose_name = "Garantie Transport"
        verbose_name_plural = "Garanties Transport"
        ordering = ["Groupe", "Ordre", "Code"]


class IaTauxClasse(models.Model):
    """Tarif Individuelle Accidents d'une compagnie par classe d'activité (code_classe_assure de la profession) :
    taux décès et invalidité permanente en ‰ du capital, frais médicaux en % du capital. Lu par
    fn_calcul_prime_ia_nsia (NSIA ASSURANCES)."""

    IdCompagnie = models.IntegerField(db_column="idcompagnie")
    Classe = models.CharField(max_length=2, db_column="classe")
    Libelle = models.CharField(max_length=120, blank=True, default="", db_column="libelle")
    TauxDeces = models.DecimalField(max_digits=8, decimal_places=4, db_column="tauxdeces")
    TauxInvalidite = models.DecimalField(max_digits=8, decimal_places=4, db_column="tauxinvalidite")
    TauxFraisMedicaux = models.DecimalField(max_digits=8, decimal_places=4, db_column="tauxfraismedicaux")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")
    ModifiePar = models.CharField(max_length=150, blank=True, default="", db_column="modifiepar")

    class Meta:
        db_table = "lephare_ia_taux_classe"
        verbose_name = "Taux IA par classe d'activité"
        verbose_name_plural = "Taux IA par classe d'activité"
        ordering = ["IdCompagnie", "Classe"]
        constraints = [models.UniqueConstraint(fields=["IdCompagnie", "Classe"], name="lephare_ia_taux_classe_unique")]


class IaAccessoireTranche(models.Model):
    """Accessoires Individuelle Accidents d'une compagnie selon la prime nette : montant de la première tranche
    dont le plafond n'est pas dépassé ; ligne sans plafond = au-delà (pourcentage de la prime nette + montant).
    Lu par fn_get_accessoire_ia_nsia (NSIA ASSURANCES), montant total réparti compagnie / cabinet."""

    IdCompagnie = models.IntegerField(db_column="idcompagnie")
    PrimeMax = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True, db_column="primemax")
    Montant = models.DecimalField(max_digits=15, decimal_places=2, db_column="montant")
    TauxAuDela = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True, db_column="tauxaudela")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")
    ModifiePar = models.CharField(max_length=150, blank=True, default="", db_column="modifiepar")

    class Meta:
        db_table = "lephare_ia_accessoire_tranche"
        verbose_name = "Tranche d'accessoires IA"
        verbose_name_plural = "Tranches d'accessoires IA"
        ordering = ["IdCompagnie", "PrimeMax"]


class IaAccessoireOffre(models.Model):
    """Accessoire forfaitaire d'une offre Individuelle Accidents (offres CGA, CI-ÉNERGIES…) : montant total partagé entre
    la compagnie et le cabinet selon la part du cabinet réglée sur la fiche de la compagnie. Lu par fn_get_accessoire
    (v4) à la place du barème."""

    IdOffre = models.IntegerField(unique=True, db_column="idoffre")
    Montant = models.DecimalField(max_digits=15, decimal_places=2, db_column="montant")
    Actif = models.BooleanField(default=True, db_column="actif")
    DateModification = models.DateTimeField(auto_now=True, db_column="datemodification")
    ModifiePar = models.CharField(max_length=150, blank=True, default="", db_column="modifiepar")

    class Meta:
        db_table = "lephare_ia_accessoire_offre"
        verbose_name = "Accessoire forfaitaire d'une offre IA"
        verbose_name_plural = "Accessoires forfaitaires des offres IA"
        ordering = ["IdOffre"]
