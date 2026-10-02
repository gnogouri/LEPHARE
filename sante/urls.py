from django.urls import include, path

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
from .views_devis_sante import (
    enregistrer_adherent,
    enregistrer_affilie,
    enregistrer_devis_sante,
    enregistrer_filiale,
    initialiser_devis_sante,
    lire_devis_sante,
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
    path(r"devissante/enregistrement/", enregistrer_devis_sante, name="enregistrement_devis_sante_lephare"),
    path(r"devissante/<int:iddevis>/", lire_devis_sante, name="lecture_devis_sante"),

]
urlpatterns += router.urls
