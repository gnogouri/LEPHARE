from django.urls import include, path

from . import consommations, consommations_analyse, consommations_pilotage, consommations_rapport, consommations_souscriptions, oreole, rafas, rafas_rapport

# from django_api_admin.sites import site

from rest_framework import routers

from .views import (
    AdherentViewSet,
    AffilieViewSet,
    FilialeSanteViewSet,
    AdherentListeEnSaisieView,
    AdherentEnSaisieView,
    AffilieListeEnSaisieView,
    AffilieEnSaisieView,
    FilialeListeEnSaisieView,
    FilialeEnSaisieView,
    NumeroSaisieSanteView,
    SaisieDevisSanteEnCoursView,
    ImportationAffilieViewSet,
    ListeAffilieSanteView,
)

from .views import (
    create_quotation_sante,
    saisir_adherent_sante,
    saisir_affilie_sante,
    saisir_filiale_sante,
    annuler_saisie_adherent,
    annuler_saisie_affilie,
    annuler_saisie_filiale,
)
from .avenant import avenant_sante
from .views_devis_sante import (
    apercu_devis_sante_vue,
    bordereau_primes,
    bordereau_primes_contrat,
    enregistrer_adherent,
    enregistrer_affilie,
    enregistrer_devis_sante,
    enregistrer_filiale,
    initialiser_devis_sante,
    importer_affilies,
    importer_classique,
    modele_import_classique,
    lire_devis_sante,
    continuer_saisie,
    supprimer_objet_saisie,
)


router = routers.DefaultRouter()
router.register(r"adherent", AdherentViewSet)
router.register(r"affilie", AffilieViewSet)
router.register(r"filialesante", FilialeSanteViewSet)
router.register(
    r"importationaffilie",
    ImportationAffilieViewSet,
    basename="importationaffilie",
)


urlpatterns = [
    # path("", include(router.urls)),
    # path("api_admin/", site.urls),
    path(
        r"enregistrementdevissante",
        create_quotation_sante,
        name="enregistrement_devis_sante",
    ),
    path(r"saisieadherentsante", saisir_adherent_sante, name="saisie_adherent_sante"),
    path(
        r"annulationsaisieadherent",
        annuler_saisie_adherent,
        name="annulation_saisie_adherent",
    ),
    path(r"saisieaffiliesante", saisir_affilie_sante, name="saisie_affilie_sante"),
    path(
        r"annulationsaisieaffilie",
        annuler_saisie_affilie,
        name="annulation_saisie_affilie",
    ),
    path(r"saisiefilialesante", saisir_filiale_sante, name="saisie_filiale_sante"),
    path(
        r"annulationsaisiefiliale",
        annuler_saisie_filiale,
        name="annulation_saisie_filiale",
    ),
    path(
        r"numerosaisiesante",
        NumeroSaisieSanteView.as_view(),
        name="numero_saisie_sante",
    ),
    path(
        r"saisiesanteencours",
        SaisieDevisSanteEnCoursView.as_view(),
        name="saisie_sante_en_cours",
    ),
    path(
        r"adherentlisteensaisie/<int:iddevis>",
        AdherentListeEnSaisieView.as_view(),
        name="adherent_en_saisie",
    ),
    path(
        r"adherentensaisie/<int:pk>",
        AdherentEnSaisieView.as_view(),
        name="adherent_en_saisie",
    ),
    path(r"affilielisteensaisie/<int:iddevis>", AffilieListeEnSaisieView.as_view()),
    path(
        r"affilieensaisie/<int:pk>",
        AffilieEnSaisieView.as_view(),
        name="affilie_en_saisie",
    ),
    path(
        r"filialelisteensaisie/<int:iddevis>",
        FilialeListeEnSaisieView.as_view(),
        name="filiale_en_saisie",
    ),
    path(
        r"filialeensaisie/<int:pk>",
        FilialeEnSaisieView.as_view(),
        name="filiale_en_saisie",
    ),
    path(r"listeaffiliesante/<int:iddevis>", ListeAffilieSanteView.as_view()),
    # Saisie Santé depuis LE PHARE (mêmes fonctions qu'URANUS, authentification du projet)
    path(r"devissante/initialisation/", initialiser_devis_sante, name="initialisation_devis_sante"),
    path(r"devissante/filiale/", enregistrer_filiale, name="filiale_devis_sante"),
    path(r"devissante/adherent/", enregistrer_adherent, name="adherent_devis_sante"),
    path(r"devissante/affilie/", enregistrer_affilie, name="affilie_devis_sante"),
    path(r"devissante/suppression/", supprimer_objet_saisie, name="suppression_saisie_sante"),
    path(r"devissante/importation/", importer_affilies, name="importation_saisie_sante"),
    # Import Santé classique (modèle d'OREOLE) : couvertures, familles et primes déduites du fichier
    path(r"devissante/importation/classique/", importer_classique, name="importation_sante_classique"),
    path(r"devissante/importation/classique/modele/", modele_import_classique, name="modele_import_sante_classique"),
    path(r"devissante/enregistrement/", enregistrer_devis_sante, name="enregistrement_devis_sante_lephare"),
    path(r"devissante/apercu/", apercu_devis_sante_vue, name="apercu_devis_sante"),
    path(r"devissante/<int:iddevis>/", lire_devis_sante, name="lecture_devis_sante"),
    path(r"devissante/<int:iddevis>/continuer/", continuer_saisie, name="continuer_saisie_sante"),
    path(r"devissante/<int:iddevis>/bordereau/", bordereau_primes, name="bordereau_primes_sante"),
    # Contrat : familles et primes de sa période, incorporations comprises (documents du contrat)
    path(r"devissante/contrat/<int:idcontrat>/bordereau/", bordereau_primes_contrat, name="bordereau_primes_contrat_sante"),
    # Avenant de modification d'un contrat en cours (changement de formule, incorporation) : préparation et devis
    path(r"devissante/avenant/<int:idcontrat>/", avenant_sante, name="avenant_sante"),
    # Branche Oreole Santé : package Santé + IA + AFA (sante/oreole.py)
    path(r"oreole/referentiels/", oreole.referentiels, name="oreole-referentiels"),
    path(r"oreole/apercu/", oreole.calcul, name="oreole-apercu"),
    path(r"oreole/devis/", oreole.devis, name="oreole-devis"),
    path(r"oreole/devis/<int:iddevis>/", oreole.lecture, name="oreole-lecture"),
    path(r"oreole/devis/<int:iddevis>/emission/", oreole.emission, name="oreole-emission"),
    path(r"oreole/lien/<int:iddevis>/", oreole.lien, name="oreole-lien"),
    path(r"oreole/devis/<int:iddevis>/encaissement/", oreole.encaissement, name="oreole-encaissement"),
    path(r"oreole/caisse/", oreole.caisse, name="oreole-caisse"),
    path(r"oreole/polices/", oreole.polices, name="oreole-polices"),
    path(r"oreole/contrat/<int:idcontrat>/", oreole.contrat, name="oreole-contrat"),
    path(r"oreole/contrat/<int:idcontrat>/emission/", oreole.contrat_emission, name="oreole-contrat-emission"),
    path(r"oreole/contrat/<int:idcontrat>/preparation/", oreole.contrat_preparation, name="oreole-contrat-preparation"),
    path(r"oreole/cartes/", oreole.cartes_registre, name="oreole-cartes-registre"),
    path(r"oreole/cartes/verification/", oreole.cartes_verification, name="oreole-cartes-verification"),
    path(r"oreole/contrat/<int:idcontrat>/cartes/", oreole.contrat_cartes, name="oreole-contrat-cartes"),
    path(r"oreole/import/analyse/", oreole.analyse_import, name="oreole-import-analyse"),
    path(r"oreole/modele/", oreole.modele, name="oreole-modele"),
    # Suivi des consommations santé : relevés du gestionnaire, droits et soldes, statistiques, contrôles, fraude (sante/consommations.py)
    path(r"consommations/import/analyse/", consommations.vue_analyse, name="consommations-analyse"),
    path(r"consommations/import/", consommations.vue_import, name="consommations-import"),
    path(r"consommations/synthese/", consommations.vue_synthese, name="consommations-synthese"),
    path(r"consommations/tableau-de-bord/", consommations_pilotage.vue_tableau_de_bord, name="consommations-tableau-de-bord"),
    # Analyse approfondie : compagnies, entreprises, familles, profil, foyers, prestataires, délais, projection (sante/consommations_analyse.py)
    path(r"consommations/analyse/", consommations_analyse.vue_analyse, name="consommations-analyse-periode"),
    path(r"consommations/entreprises/lien/", consommations_pilotage.vue_lien, name="consommations-lien"),
    # Effectif complété par les souscriptions Oreole Santé de LE PHARE : aperçu (GET), ajout (POST) (sante/consommations_souscriptions.py)
    path(r"consommations/souscriptions/", consommations_souscriptions.vue_souscriptions, name="consommations-souscriptions"),
    path(r"consommations/rapport/", consommations_rapport.vue_rapport, name="consommations-rapport"),
    path(r"consommations/recherche/", consommations.vue_recherche, name="consommations-recherche"),
    path(r"consommations/famille/<int:matricule>/", consommations.vue_famille, name="consommations-famille"),
    path(r"consommations/entreprises/", consommations.vue_entreprises, name="consommations-entreprises"),
    path(r"consommations/plafonds/", consommations.vue_plafonds, name="consommations-plafonds"),
    path(r"consommations/controles/", consommations.vue_controles, name="consommations-controles"),
    path(r"consommations/fraude/", consommations.vue_fraude, name="consommations-fraude"),
    path(r"consommations/fraude/<int:matricule>/", consommations.vue_fraude_beneficiaire, name="consommations-fraude-beneficiaire"),
    path(r"consommations/fraude/<int:matricule>/instruction/", consommations.vue_instruction, name="consommations-instruction"),
    # Branche RAFAS, régime autofinancé d'assurance santé (sante/rafas.py) : conventions, exercices et collèges, fonds, fichiers du gestionnaire,
    # analyse de la période, effectif, fiche famille, rapport Word
    path(r"rafas/conventions/", rafas.vue_conventions, name="rafas-conventions"),
    path(r"rafas/conventions/proposition/", rafas.vue_proposition, name="rafas-proposition"),
    path(r"rafas/conventions/<int:idconvention>/", rafas.vue_convention, name="rafas-convention"),
    path(r"rafas/conventions/<int:idconvention>/exercices/", rafas.vue_exercices, name="rafas-exercices"),
    path(r"rafas/conventions/<int:idconvention>/exercices/<int:idexercice>/", rafas.vue_exercice, name="rafas-exercice"),
    path(r"rafas/conventions/<int:idconvention>/colleges-gestionnaire/", rafas.vue_liens, name="rafas-liens"),
    path(r"rafas/conventions/<int:idconvention>/import/analyse/", rafas.vue_import_analyse, name="rafas-import-analyse"),
    path(r"rafas/conventions/<int:idconvention>/import/", rafas.vue_import, name="rafas-import"),
    path(r"rafas/conventions/<int:idconvention>/imports/<int:idimport>/", rafas.vue_supprimer_import, name="rafas-import-suppression"),
    path(r"rafas/conventions/<int:idconvention>/analyse/", rafas.vue_analyse, name="rafas-analyse"),
    path(r"rafas/conventions/<int:idconvention>/effectif/", rafas.vue_effectif, name="rafas-effectif"),
    path(r"rafas/conventions/<int:idconvention>/famille/<int:matricule>/", rafas.vue_famille, name="rafas-famille"),
    path(r"rafas/conventions/<int:idconvention>/fonds/", rafas.vue_fonds, name="rafas-fonds"),
    path(r"rafas/conventions/<int:idconvention>/rapport/", rafas_rapport.vue_rapport, name="rafas-rapport"),
    path(r"rafas/exercices/<int:idexercice>/appels/", rafas.vue_appels, name="rafas-appels"),
    path(r"rafas/appels/<int:idappel>/", rafas.vue_appel, name="rafas-appel"),
    path(r"rafas/exercices/<int:idexercice>/versements/", rafas.vue_versements, name="rafas-versements"),
    path(r"rafas/versements/<int:idversement>/", rafas.vue_versement, name="rafas-versement"),
    path(r"rafas/exercices/<int:idexercice>/honoraires/", rafas.vue_honoraires, name="rafas-honoraires"),
    path(r"rafas/honoraires/<int:idhonoraire>/", rafas.vue_honoraire, name="rafas-honoraire"),

]
urlpatterns += router.urls
