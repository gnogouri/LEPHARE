from django.urls import include, path
from rest_framework import routers

from . import parametrage, parametrage_auto, parametrage_dommages, parametrage_ia, parametrage_mrh, parametrage_oreole, parametrage_sante, parametrage_transport, parametrage_vie, views_grilles_voyage
from .views import (
    AccessoireCourtierParCompagnieViewSet,
    AccessoireViewSet,
    AssistanceAutomobileView,
    AvenantViewSet,
    BanqueViewSet,
    BrancheViewSet,
    CarrosserieViewSet,
    CategoriePermisViewSet,
    CategorieViewSet,
    ClockedScheduleViewSet,
    CollegeSanteParOffreView,
    CollegeSanteViewSet,
    CommissionProduitViewSet,
    CommuneViewSet,
    CompagnieViewSet,
    ContinentViewSet,
    CrontabScheduleViewSet,
    DelaiAvisEcheanceViewSet,
    DomaineActiviteRCViewSet,
    EnergieViewSet,
    FormuleSecuriteRoutiereView,
    FormuleSecuriteRoutiereViewSet,
    GarantieRisqueViewSet,
    GarantieViewSet,
    GenreVehiculeViewSet,
    GroupeUtilisateurViewSet,
    IATarifGroupeView,
    IATarifPersonnaliseView,
    IntermediaireViewSet,
    IntervalScheduleViewSet,
    LienJuridiqueSanteViewSet,
    MarqueViewSet,
    MenuParentViewSet,
    MenuViewSet,
    ModeEncaissementViewSet,
    ModeleVehiculeViewSet,
    OffreCollegeSanteViewSet,
    OffreDetailViewSet,
    OffreGarantieViewSet,
    OffreParProduitView,
    OffreSanteParTarifView,
    OffreViewSet,
    OffreVoyageView,
    ParametreSiteViewSet,
    PaysViewSet,
    PaysZoneView,
    PeriodicTaskViewSet,
    PrimeCalculationView,
    ProduitViewSet,
    ProfessionIaViewSet,
    ProfessionViewSet,
    QualiteAyantDroitViewSet,
    QualiteSouscripteurMrhViewSet,
    QualiteViewSet,
    StatutJuridiqueViewSet,
    ApporteurViewSet,
    ReductionFlotteViewSet,
    RepartitionPrimeSanteViewSet,
    CalculRepartitionPrimeSanteView,
    RegionViewSet,
    RisqueViewSet,
    SecteurActiviteViewSet,
    SolarScheduleViewSet,
    SousGarantieViewSet,
    SystemeSecuriteViewSet,
    TarifDetailViewSet,
    TarifParProduitView,
    TarifViewSet,
    TarifVoyageView,
    TauxTaxeGarantieProduitViewSet,
    TermeViewSet,
    TypeAssureViewSet,
    TypeContratSanteViewSet,
    TypeReductionViewSet,
    TypeSouscripteurViewSet,
    TypeVehiculeViewSet,
    UsageVehiculeViewSet,
    UtilisateurViewSet,
    VilleViewSet,
    ZoneCouvertureOffreView,
    ZoneCouvertureSanteViewSet,
    ZoneVoyageViewSet,
    create_offre_garantie,
    get_garantie,
    get_garantie_ia,
    get_garantie_mrh,
    get_garantie_mrp,
    get_garantie_par_produit,
    get_garantie_rc,
    get_garantie_voyage,
    get_liste_avenant,
)

router = routers.DefaultRouter()
router.register(r"menu", MenuViewSet)
router.register(r"menuparent", MenuParentViewSet)
router.register(r"garantie", GarantieViewSet)
router.register(r"utilisateur", UtilisateurViewSet)
router.register(r"groupeutilisateur", GroupeUtilisateurViewSet)
router.register(r"sousgarantie", SousGarantieViewSet)
router.register(r"garantierisque", GarantieRisqueViewSet)
router.register(r"categorie", CategorieViewSet)
router.register(r"tarif", TarifViewSet)
router.register(r"tarifdetail", TarifDetailViewSet)
router.register(r"branche", BrancheViewSet)
router.register(r"risque", RisqueViewSet)
router.register(r"energie", EnergieViewSet)
router.register(r"compagnie", CompagnieViewSet)
router.register(r"qualite", QualiteViewSet)
router.register(r"statutjuridique", StatutJuridiqueViewSet)
router.register(r"apporteurs", ApporteurViewSet)
router.register(r"terme", TermeViewSet, basename="terme_contrat")
router.register(r"secteuractivite", SecteurActiviteViewSet)
router.register(r"domaineactiviterc", DomaineActiviteRCViewSet)
router.register(r"carrosserie", CarrosserieViewSet)
router.register(r"produit", ProduitViewSet)
router.register(r"avenant", AvenantViewSet)
router.register(r"commissionproduit", CommissionProduitViewSet)
router.register(r"intermediaire", IntermediaireViewSet)
router.register(r"offre", OffreViewSet)
router.register(r"offredetail", OffreDetailViewSet)
router.register(r"offregarantie", OffreGarantieViewSet)
router.register(r"marque", MarqueViewSet)
router.register(r"systemesecurite", SystemeSecuriteViewSet)
router.register(r"modele", ModeleVehiculeViewSet)
router.register(r"usage", UsageVehiculeViewSet)
router.register(r"typereduction", TypeReductionViewSet)
router.register(r"commune", CommuneViewSet)
router.register(r"ville", VilleViewSet)
router.register(r"pays", PaysViewSet)
router.register(r"region", RegionViewSet)
router.register(r"continent", ContinentViewSet)
router.register(r"zonevoyage", ZoneVoyageViewSet)
router.register(r"genrevehicule", GenreVehiculeViewSet)
router.register(r"typevehicule", TypeVehiculeViewSet)
router.register(r"typeassure", TypeAssureViewSet)
router.register(r"typesouscripteur", TypeSouscripteurViewSet)
router.register(r"profession", ProfessionViewSet)
router.register(r"professionia", ProfessionIaViewSet)
router.register(r"qualiteayantdroit", QualiteAyantDroitViewSet)
router.register(r"categoriepermis", CategoriePermisViewSet)
router.register(r"qualitesouscripteur", QualiteSouscripteurMrhViewSet)
router.register(r"banque", BanqueViewSet)
router.register(r"modeencaissement", ModeEncaissementViewSet)
router.register(r"accessoire", AccessoireViewSet)
router.register(r"tauxtaxegarantie", TauxTaxeGarantieProduitViewSet)
router.register(r"accessoirecourtier", AccessoireCourtierParCompagnieViewSet)
router.register(r"collegesante", CollegeSanteViewSet)
router.register(r"offrecollegesante", OffreCollegeSanteViewSet)
router.register(r"lienjuridiquesante", LienJuridiqueSanteViewSet)
router.register(r"zonecouverturesante", ZoneCouvertureSanteViewSet)
router.register(r"reductionflotte", ReductionFlotteViewSet)
router.register(r"repartitionprimesante", RepartitionPrimeSanteViewSet)
router.register(r"formulesecuriteroutiere", FormuleSecuriteRoutiereViewSet)
router.register(r"parametresite", ParametreSiteViewSet)
router.register(r"delaiavisecheance", DelaiAvisEcheanceViewSet)
router.register(r"solarschedule", SolarScheduleViewSet)
router.register(r"intervalschedule", IntervalScheduleViewSet)
router.register(r"clockedschedule", ClockedScheduleViewSet)
router.register(r"crontabschedule", CrontabScheduleViewSet)
router.register(r"periodictaskschedule", PeriodicTaskViewSet)
router.register(r"typecontratsante", TypeContratSanteViewSet)

urlpatterns = [
    # Grilles Voyage (admin) : lecture, lignes de grille, offres par zone, zone des pays
    # Paramétrage LE PHARE (règles de gestion, cabinet, compagnies, produits) : configuration_api/parametrage.py
    path("parametrage/", parametrage.parametrage, name="parametrage"),
    path("parametrage/parametres/", parametrage.liste_parametres, name="parametrage-parametres"),
    path("parametrage/parametres/<str:cle>/", parametrage.modifier_parametre, name="parametrage-parametre"),
    path("parametrage/cabinet/", parametrage.cabinet, name="parametrage-cabinet"),
    path("parametrage/compagnies/", parametrage.compagnies, name="parametrage-compagnies"),
    path("parametrage/compagnies/<int:id_compagnie>/", parametrage.compagnie, name="parametrage-compagnie"),
    path("parametrage/produits/", parametrage.produits, name="parametrage-produits"),
    path("parametrage/produits/<int:id_produit>/", parametrage.produit, name="parametrage-produit"),
    # Réglages Automobile (dépréciation des véhicules) et valeur vénale : configuration_api/parametrage_auto.py
    # Réglages par branche : Transport hors GUCE, Individuelle Accidents (tarif NSIA), Multirisque Habitation
    path("parametrage/transport/", parametrage_transport.transport, name="parametrage-transport"),
    path("parametrage/transport/garanties/", parametrage_transport.garanties, name="parametrage-transport-garanties"),
    path("parametrage/transport/modes/<str:code>/", parametrage_transport.mode, name="parametrage-transport-mode"),
    path("parametrage/ia/", parametrage_ia.ia, name="parametrage-ia"),
    path("parametrage/ia/classes/<str:classe>/", parametrage_ia.classe, name="parametrage-ia-classe"),
    path("parametrage/ia/tranches/", parametrage_ia.tranches, name="parametrage-ia-tranches"),
    path("parametrage/ia/offres/", parametrage_ia.offres, name="parametrage-ia-offres"),
    # Réglages Vie : offres commerciales de la liste déroulante du devis Vie (AFA, Retraite complémentaire, Temporaire décès…)
    path("parametrage/vie/offres/", parametrage_vie.offres, name="parametrage-vie-offres"),
    path("parametrage/vie/offres/<int:id_offre>/", parametrage_vie.offre, name="parametrage-vie-offre"),
    path("parametrage/ia/reglages/<str:cle>/", parametrage_ia.reglage, name="parametrage-ia-reglage"),
    path("parametrage/mrh/", parametrage_mrh.mrh, name="parametrage-mrh"),
    path("parametrage/mrh/usages/<str:code>/", parametrage_mrh.usage, name="parametrage-mrh-usage"),
    path("parametrage/mrh/options/<str:code>/", parametrage_mrh.option, name="parametrage-mrh-option"),
    path("parametrage/mrh/forfaits/<str:code>/", parametrage_mrh.forfait, name="parametrage-mrh-forfait"),
    path("parametrage/auto/depreciation/", parametrage_auto.depreciation, name="parametrage-auto-depreciation"),
    path("parametrage/auto/depreciation/classes/<str:code>/", parametrage_auto.classe, name="parametrage-auto-depreciation-classe"),
    path("parametrage/auto/depreciation/regles/", parametrage_auto.regles, name="parametrage-auto-depreciation-regles"),
    path("parametrage/auto/regles-garanties/", parametrage_auto.regles_garanties, name="parametrage-auto-regles-garanties"),
    path("parametrage/auto/regles-interactions/", parametrage_auto.regles_interactions, name="parametrage-auto-regles-interactions"),
    path("parametrage/auto/pool-tpv/", parametrage_auto.pool_tpv, name="parametrage-auto-pool-tpv"),
    path("parametrage/auto/pool-tpv/tranches/", parametrage_auto.pool_tpv_tranches, name="parametrage-auto-pool-tpv-tranches"),
    path("parametrage/auto/pool-tpv/parametres/<str:cle>/", parametrage_auto.pool_tpv_parametre, name="parametrage-auto-pool-tpv-parametre"),
    path("parametrage/auto/depreciation/parametres/<str:cle>/", parametrage_auto.parametre, name="parametrage-auto-depreciation-parametre"),
    path("parametrage/auto/tarifs-directs/", parametrage_auto.tarifs_directs, name="parametrage-auto-tarifs-directs"),
    path("parametrage/auto/tarifs-directs/grilles/", parametrage_auto.tarifs_directs_grilles, name="parametrage-auto-tarifs-directs-grilles"),
    path("parametrage/auto/tarifs-directs/grilles/<int:id_tarif>/", parametrage_auto.tarifs_directs_grille, name="parametrage-auto-tarifs-directs-grille"),
    path("parametrage/auto/tarifs-directs/parametres/<str:cle>/", parametrage_auto.tarifs_directs_parametre, name="parametrage-auto-tarifs-directs-parametre"),
    path("parametrage/auto/moteur/", parametrage_auto.moteur, name="parametrage-auto-moteur"),
    path("parametrage/auto/moteur/<str:cle>/", parametrage_auto.moteur_parametre, name="parametrage-auto-moteur-parametre"),
    path("auto/valeur-venale/", parametrage_auto.valeur_venale, name="auto-valeur-venale"),
    path("auto/prime-garantie/", parametrage_auto.prime_garantie, name="auto-prime-garantie"),
    path("auto/tarif-direct/", parametrage_auto.tarif_direct, name="auto-tarif-direct"),
    # Réglages Santé MINENE (formules, paramètres, répartition de la prime) : configuration_api/parametrage_sante.py
    path("parametrage/oreole/", parametrage_oreole.oreole, name="parametrage-oreole"),
    path("parametrage/oreole/offres/<int:id_offre>/", parametrage_oreole.offre, name="parametrage-oreole-offre"),
    path("parametrage/oreole/parametres/<str:cle>/", parametrage_oreole.parametre, name="parametrage-oreole-parametre"),
    path("parametrage/sante/", parametrage_sante.sante, name="parametrage-sante"),
    path("parametrage/sante/formules/<int:id_offre>/", parametrage_sante.formule, name="parametrage-sante-formule"),
    path("parametrage/sante/parametres/<str:cle>/", parametrage_sante.parametre, name="parametrage-sante-parametre"),
    path("parametrage/sante/repartitions/<int:id_repartition>/", parametrage_sante.repartition, name="parametrage-sante-repartition"),
    # Réglages Dommages (catégories, garanties par compagnie) : configuration_api/parametrage_dommages.py
    path("parametrage/dommages/", parametrage_dommages.dommages, name="parametrage-dommages"),
    path("parametrage/dommages/categories/<int:id_tarif>/", parametrage_dommages.categorie, name="parametrage-dommages-categorie"),
    path(
        "parametrage/dommages/categories/<int:id_tarif>/documents/",
        parametrage_dommages.documents,
        name="parametrage-dommages-documents",
    ),
    path(
        "parametrage/dommages/categories/<int:id_tarif>/compagnies/<int:id_compagnie>/",
        parametrage_dommages.garanties_compagnie,
        name="parametrage-dommages-garanties",
    ),
    path("grillesvoyage/", views_grilles_voyage.grilles_voyage, name="grilles-voyage"),
    path("grillesvoyage/<int:id_compagnie>/", views_grilles_voyage.grilles_voyage, name="grilles-voyage-compagnie"),
    path("grillesvoyage/<int:id_compagnie>/lignes/", views_grilles_voyage.creer_ligne, name="grilles-voyage-lignes"),
    path("grillesvoyage/<int:id_compagnie>/lignes/<int:id_ligne>/", views_grilles_voyage.ligne_grille, name="grilles-voyage-ligne"),
    path("grillesvoyage/<int:id_compagnie>/offres/<int:id_offre>/", views_grilles_voyage.offre_voyage, name="grilles-voyage-offre"),
    path("grillesvoyage/<int:id_compagnie>/pays/<int:id_pays>/", views_grilles_voyage.pays_zone, name="grilles-voyage-pays"),
    # Doit précéder include(router.urls) : le routeur enregistre aussi
    # "offregarantie" (CRUD OffreGarantieViewSet) sur le même préfixe, et
    # comme Django résout les URLs dans l'ordre, le router masquerait
    # sinon cette vue de calcul (POST /api/offregarantie) derrière le
    # ViewSet réservé aux admins, causant un 401 systématique.
    path(r"offregarantie", get_garantie, name="offre_garantie_auto"),
    path("", include(router.urls)),
    path(r"offregarantieia", get_garantie_ia, name="offre_garantie_ia"),
    path(
        r"offregarantievoyage",
        get_garantie_voyage,
        name="offre_garantie_voyage",
    ),
    path(
        r"offregarantiemrh",
        get_garantie_mrh,
        name="offre_garantie_mrh",
    ),
    path(
        r"offregarantierc",
        get_garantie_rc,
        name="offre_garantie_rc",
    ),
    path(
        r"offregarantiemrp",
        get_garantie_mrp,
        name="offre_garantie_mrp",
    ),
    path(
        r"enregistrementoffregarantie",
        create_offre_garantie,
        name="enregistrement_offre_garantie",
    ),
    path(
        r"tarifparproduit/<int:idproduit>",
        TarifParProduitView.as_view(),
        name="tarif_par_produit",
    ),
    path(
        r"offreparproduit/",
        OffreParProduitView.as_view(),
        name="offre_par_produit",
    ),
    path(
        r"tarifvoyage/<int:idcompagnie>",
        TarifVoyageView.as_view(),
        name="tarif_par_produit",
    ),
    path(
        r"offrevoyage/",
        OffreVoyageView.as_view(),
        name="offre_voyage_par_compagnie_tarif",
    ),
    path(
        r"offresantepartarif/<int:idtarif>",
        OffreSanteParTarifView.as_view(),
        name="offre_sante_par_tarif",
    ),
    path(
        r"collegesanteparoffre/<int:idoffre>",
        CollegeSanteParOffreView.as_view(),
        name="college_sante_par_offre",
    ),
    path(
        r"garantieparproduit",
        get_garantie_par_produit,
        name="garantie_par_produit",
    ),
    path(
        r"zonecouvertureoffre/<int:idzone>",
        ZoneCouvertureOffreView.as_view(),
        name="zone_couverture_offre",
    ),
    path(
        r"securiteroutiereparcompagnie/<int:idcompagnie>",
        FormuleSecuriteRoutiereView.as_view(),
        name="formule_securite_routiere_par_compagnie",
    ),
    path(
        r"assistanceautomobile/<int:idcompagnie>",
        AssistanceAutomobileView.as_view(),
        name="formule_assistance_automobile_par_compagnie",
    ),
    path(
        r"payszone/<int:idcompagnie>",
        PaysZoneView.as_view(),
        name="pays_zone_par_compagnie",
    ),
    path(
        r"avenant/avenantparproduit",
        get_liste_avenant,
        name="avenant_par_produit",
    ),
    path(
        r"esttarifiagroupe/<int:idtarif>/",
        IATarifGroupeView.as_view(),
        name="est-tarif-ia-groupe",
    ),
    path(
        r"esttarifiapersonnalise/<int:idtarif>/",
        IATarifPersonnaliseView.as_view(),
        name="est-tarif-ia-personnalise",
    ),
    path(r"calculprime/", PrimeCalculationView.as_view(), name="calcul-prime"),
    path(
        r"calculrepartitionprimesante/",
        CalculRepartitionPrimeSanteView.as_view(),
        name="calcul-repartition-prime-sante",
    ),
]
