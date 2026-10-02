"""
Service de calcul des primes MRH (Multi-Risques Habitation)
Côte d'Ivoire

Ce service gère :
- Le calcul de la prime de base selon l'usage
- La répartition sur les garanties obligatoires
- L'application des options (TYPE1, TYPE2, FORFAIT)
- L'ajout des garanties optionnelles
- Le calcul des taxes
- Le calcul des accessoires par paliers
- L'enregistrement dans les modèles legacy (Devis, DevisDetail, DevisDetGarantie)
"""

import json
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional, Tuple

from dateutil.relativedelta import relativedelta
from django.core.exceptions import ValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.utils import timezone

from configuration_api.models import (
    Option,
    OptionUsage,
    ParametresCalcul,
    SousGarantieForfait,
    SousGarantieMRH,
    SousGarantieUsage,
    UsageHabitation,
)
from production.models import Devis
from production.services.recapitulatif_primes_mrh import RecapitulatifPrimesMRH

from ..database import obtenir_code_categorie, obtenir_nouveau_numero_devis


def calculer_date_expiration(
    date_effet: date, id_duree: int, nombre_jours: int = 0
) -> date:
    """
    Calcule la date d'expiration d'un contrat.

    Args:
        date_effet: Date de début.
        id_duree: Identifiant de la durée (1: mois, 2: trim, 3: sem, 4: an, 5: custom).
        nombre_jours: Nombre de jours si id_duree est 5.

    Returns:
        Un objet datetime.date représentant le dernier jour du contrat.
    """

    # Mapping des durées avec relativedelta
    # On utilise un dictionnaire pour associer l'ID à l'intervalle correspondant
    choix_duree: dict[int, relativedelta] = {
        1: relativedelta(months=1),
        2: relativedelta(months=3),
        3: relativedelta(months=6),
        4: relativedelta(years=1),
        5: relativedelta(days=nombre_jours),
    }

    # Récupération du delta (par défaut 0 jour si l'ID est inconnu)
    delta: relativedelta = choix_duree.get(id_duree, relativedelta(days=0))

    # Calcul de la date d'expiration (Date + Durée - 1 jour)
    date_expiration: date = date_effet + delta - relativedelta(days=1)

    return date_expiration


def tarif_mrh(id_tarif: int) -> bool:
    from configuration_api.models import Tarif

    return Tarif.is_mrh(id_tarif)


class MRHCalculService:
    """
    Service principal pour le calcul des primes MRH.

    Usage:
        service = MRHCalculService()
        resultat = service.calculer_maison(
            code_usage='proprietaire_occupant_total',
            valeur_batiment=50000000,
            valeur_contenu=10000000,
            options=['presence_gardien'],
            sous_garanties_optionnelles=['RC_MEMBRE']
        )
    """

    # Constantes de taxation
    TAUX_TAXE_INCENDIE = Decimal("0.25")  # 25%
    TAUX_TAXE_DOMMAGES_ELECTRIQUES = Decimal("0.25")  # 25%
    TAUX_TAXE_AUTRES = Decimal("0.145")  # 14,5%
    TAUX_TAXE_ACCESSOIRE = Decimal("0.145")  # 14,5%

    def __init__(self):
        """Initialise le service de calcul"""
        self.usage = None
        self.parametres = None
        self.sous_garanties_obligatoires = []
        self.sous_garanties_optionnelles_dispo = []
        self.options_applicables = []

    # ========================================================================
    # SECTION 1 : CALCUL DE LA PRIME DE BASE
    # ========================================================================

    def calculer_prime_base(
        self,
        code_usage: str,
        valeur_batiment: Optional[Decimal] = None,
        valeur_contenu: Optional[Decimal] = None,
        loyer_mensuel: Optional[Decimal] = None,
        capital_rvt: Optional[Decimal] = None,
    ) -> Decimal:
        """
        Calcule la prime de base selon l'usage et les paramètres fournis.

        Args:
            code_usage: Code de l'usage habitation
            valeur_batiment: Valeur du bâtiment en FCFA (optionnel selon usage)
            valeur_contenu: Valeur du contenu en FCFA (optionnel selon usage)
            loyer_mensuel: Loyer mensuel en FCFA (optionnel selon usage)
            capital_rvt: Capital RVT en FCFA (optionnel selon usage)

        Returns:
            Prime de base en FCFA (Decimal)

        Raises:
            ValidationError: Si les paramètres requis ne sont pas fournis
        """
        # Charger l'usage et les paramètres
        try:
            self.usage = UsageHabitation.objects.get(
                code=code_usage, actif=True
            )
            self.parametres = self.usage.parametres
        except UsageHabitation.DoesNotExist:
            raise ValidationError(
                f"Usage '{code_usage}' non trouvé ou inactif"
            )
        except ParametresCalcul.DoesNotExist:
            raise ValidationError(
                f"Paramètres de calcul non trouvés pour l'usage '{code_usage}'"
            )

        # Valider les paramètres requis
        self._valider_parametres_requis(
            valeur_batiment, valeur_contenu, loyer_mensuel, capital_rvt
        )

        # Calcul des composantes
        prime_base = Decimal("0")

        # Composante bâtiment
        if self.parametres.coeff_valeur_batiment and valeur_batiment:
            prime_base += (
                valeur_batiment * self.parametres.coeff_valeur_batiment
            )

        # Composante contenu
        if self.parametres.coeff_valeur_contenu and valeur_contenu:
            prime_base += valeur_contenu * self.parametres.coeff_valeur_contenu

        # Composante loyer (Loyer × 12 × 15 × coeff)
        if self.parametres.coeff_loyer and loyer_mensuel:
            prime_base += loyer_mensuel * 12 * 15 * self.parametres.coeff_loyer

        # Composante RVT
        if self.parametres.coeff_capital_rvt and capital_rvt:
            prime_base += capital_rvt * self.parametres.coeff_capital_rvt

        # Ajout du forfait fixe (pour Logement de Fonction)
        prime_base += self.parametres.forfait_fixe

        # Application du coefficient de réduction
        if self.parametres.coeff_reduction:
            prime_base = prime_base * self.parametres.coeff_reduction

        # Arrondir à 2 décimales
        return self._arrondir(prime_base)

    def _valider_parametres_requis(
        self,
        valeur_batiment: Optional[Decimal],
        valeur_contenu: Optional[Decimal],
        loyer_mensuel: Optional[Decimal],
        capital_rvt: Optional[Decimal],
    ) -> None:
        """Valide que les paramètres requis sont fournis"""
        errors = {}

        if (
            self.parametres.param_valeur_batiment_requis
            and not valeur_batiment
        ):
            errors["valeur_batiment"] = (
                "La valeur du bâtiment est requise pour cet usage"
            )

        if self.parametres.param_valeur_contenu_requis and not valeur_contenu:
            errors["valeur_contenu"] = (
                "La valeur du contenu est requise pour cet usage"
            )

        if self.parametres.param_loyer_requis and not loyer_mensuel:
            errors["loyer_mensuel"] = (
                "Le loyer mensuel est requis pour cet usage"
            )

        if self.parametres.param_capital_rvt_requis and not capital_rvt:
            errors["capital_rvt"] = "Le capital RVT est requis pour cet usage"

        if errors:
            raise ValidationError(errors)

    # ========================================================================
    # SECTION 2 : RÉPARTITION SUR LES GARANTIES OBLIGATOIRES
    # ========================================================================

    def repartir_prime_sous_garanties(
        self,
        prime_base: Decimal,
        repartition_manuelle: Optional[Dict[str, Decimal]] = None,
    ) -> List[Dict]:
        """
        Répartit la prime de base sur les sous-garanties obligatoires.

        Si repartition_manuelle est fourni (dict {code_sous_garantie: montant}),
        les garanties spécifiées reçoivent leur montant direct et le reliquat
        (prime_base - somme des montants manuels) est redistribué proportionnellement
        sur les garanties non touchées selon leur taux_repartition renormalisé.

        Contrainte : somme des montants manuels ≤ prime_base.
        """
        sous_garanties_calculees = []

        self.sous_garanties_obligatoires = (
            SousGarantieUsage.objects.filter(
                usage=self.usage, obligatoire=True, actif=True
            )
            .select_related("sous_garantie")
            .order_by("ordre_affichage")
        )

        if repartition_manuelle:
            codes_obligs = {gu.sous_garantie.code for gu in self.sous_garanties_obligatoires}
            somme_manuelle = sum(
                Decimal(str(v)) for k, v in repartition_manuelle.items()
                if k in codes_obligs
            )
            # Arrondir prime_base à l'entier avant comparaison (FCFA = devise entière)
            prime_base_arrondie = prime_base.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
            if somme_manuelle > prime_base_arrondie:
                raise ValidationError(
                    {
                        "repartition_manuelle": (
                            f"La somme des montants ({somme_manuelle}) "
                            f"dépasse la prime de base ({prime_base_arrondie})."
                        )
                    }
                )

            reliquat = prime_base - somme_manuelle
            non_touches = [
                gu for gu in self.sous_garanties_obligatoires
                if gu.sous_garantie.code not in repartition_manuelle
            ]
            sum_taux_non_touches = sum(gu.taux_repartition for gu in non_touches)

            for gu in self.sous_garanties_obligatoires:
                code = gu.sous_garantie.code
                if code in repartition_manuelle:
                    prime_nette = self._arrondir(Decimal(str(repartition_manuelle[code])))
                elif sum_taux_non_touches > 0:
                    prime_nette = self._arrondir(
                        reliquat * (gu.taux_repartition / sum_taux_non_touches)
                    )
                else:
                    prime_nette = Decimal("0")

                taux_taxe = self._get_taux_taxe(code)
                taxe = self._arrondir(prime_nette * taux_taxe)

                sous_garanties_calculees.append(
                    {
                        "code_sous_garantie": code,
                        "libelle_sous_garantie": gu.sous_garantie.libelle,
                        "type_garantie": "OBLIGATOIRE",
                        "prime_nette": prime_nette,
                        "taux_repartition": gu.taux_repartition,
                        "taux_taxe": taux_taxe * 100,
                        "taxe": taxe,
                        "prime_ttc": prime_nette + taxe,
                        "code_sous_garantie_std": gu.sous_garantie.get_code_sous_garantie_std(),
                        "id_sous_garantie_std": gu.sous_garantie.get_id_sous_garantie_std(),
                        "manuel": True,
                    }
                )
        else:
            for gu in self.sous_garanties_obligatoires:
                prime_nette = self._arrondir(
                    prime_base * (gu.taux_repartition / Decimal("100"))
                )
                taux_taxe = self._get_taux_taxe(gu.sous_garantie.code)
                taxe = self._arrondir(prime_nette * taux_taxe)

                sous_garanties_calculees.append(
                    {
                        "code_sous_garantie": gu.sous_garantie.code,
                        "libelle_sous_garantie": gu.sous_garantie.libelle,
                        "type_garantie": "OBLIGATOIRE",
                        "prime_nette": prime_nette,
                        "taux_repartition": gu.taux_repartition,
                        "taux_taxe": taux_taxe * 100,
                        "taxe": taxe,
                        "prime_ttc": prime_nette + taxe,
                        "code_sous_garantie_std": gu.sous_garantie.get_code_sous_garantie_std(),
                        "id_sous_garantie_std": gu.sous_garantie.get_id_sous_garantie_std(),
                        "manuel": False,
                    }
                )

        return sous_garanties_calculees

    def _get_taux_taxe(self, code_sous_garantie: str) -> Decimal:
        """Retourne le taux de taxe selon la garantie"""
        if code_sous_garantie in ["INCENDIE", "DOMMAGES_ELECTRIQUES"]:
            return self.TAUX_TAXE_INCENDIE
        else:
            return self.TAUX_TAXE_AUTRES

    # ========================================================================
    # SECTION 3 : APPLICATION DES OPTIONS (TYPE1, TYPE2, FORFAIT)
    # ========================================================================

    def appliquer_options(
        self,
        sous_garanties: List[Dict],
        codes_options: List[str],
        prime_base: Decimal,
    ) -> Tuple[List[Dict], List[Dict]]:
        """
        Applique les options sélectionnées et ajuste les primes des sous-garanties.

        Args:
            sous_garanties: Liste des sous-garanties calculées
            codes_options: Liste des codes d'options sélectionnées
            prime_base: Prime de base (pour TYPE1)

        Returns:
            Tuple (sous_garanties_ajustees, options_appliquees)
            - sous_garanties_ajustees: Liste des sous/garanties avec primes ajustées
            - options_appliquees: Liste des options appliquées avec détails
        """
        if not codes_options:
            return sous_garanties, []

        options_appliquees = []

        for sous_garantie in sous_garanties:
            sous_garantie["prime_avant_options"] = sous_garantie[
                "prime_nette"
            ]  # Copie avant modification

        sous_garanties_map = {
            g["code_sous_garantie"]: g for g in sous_garanties
        }

        # Récupérer les options
        options = Option.objects.filter(
            code__in=codes_options, actif=True
        ).select_related("sous_garantie_cible")

        for option in options:
            # Vérifier que l'option est applicable à cet usage
            if not OptionUsage.objects.filter(
                option=option, usage=self.usage, actif=True
            ).exists():
                raise ValidationError(
                    f"L'option '{option.code}' n'est pas applicable à l'usage '{self.usage.code}'"
                )

            sous_garantie_cible = sous_garanties_map.get(
                option.sous_garantie_cible.code
            )
            if not sous_garantie_cible:
                continue

            # Calculer l'ajustement selon le type
            montant_ajustement = self._calculer_ajustement_option(
                option, sous_garantie_cible, prime_base
            )

            # Appliquer l'ajustement
            if option.signe_ajustement == "+":
                sous_garantie_cible["prime_nette"] += montant_ajustement
            else:  # '-'
                sous_garantie_cible["prime_nette"] -= montant_ajustement

            # Recalculer la taxe et la prime TTC
            sous_garantie_cible["taxe"] = self._arrondir(
                sous_garantie_cible["prime_nette"]
                * (sous_garantie_cible["taux_taxe"] / 100)
            )
            sous_garantie_cible["prime_ttc"] = (
                sous_garantie_cible["prime_nette"]
                + sous_garantie_cible["taxe"]
            )

            # Enregistrer l'option appliquée
            options_appliquees.append(
                {
                    "code_option": option.code,
                    "libelle_option": option.libelle,
                    "type_option": option.type_option,
                    "type_ajustement": option.type_ajustement,
                    "sous_garantie_cible": option.sous_garantie_cible.code,
                    "sous_garantie_cible_libelle": option.sous_garantie_cible.libelle,
                    "montant_ajustement": montant_ajustement,
                    "signe": option.signe_ajustement,
                }
            )

        return list(sous_garanties_map.values()), options_appliquees

    def _calculer_ajustement_option(
        self, option: Option, sous_garantie: Dict, prime_base: Decimal
    ) -> Decimal:
        """
        Calcule le montant d'ajustement selon le type d'option.

        TYPE1: Taux appliqué à la prime de base
        TYPE2: Taux appliqué à la prime nette de la garantie
        FORFAIT: Montant fixe
        """
        if option.type_ajustement == "TYPE1":
            # Taux sur prime de base (en ‰)
            return self._arrondir(prime_base * (option.taux_ajustement / 1000))

        elif option.type_ajustement == "TYPE2":
            # Taux sur prime garantie (en %)
            return self._arrondir(
                sous_garantie["prime_nette"] * (option.taux_ajustement / 100)
            )

        elif option.type_ajustement == "FORFAIT":
            # Montant fixe
            return option.montant_forfait

        else:
            raise ValidationError(
                f"Type d'ajustement inconnu: {option.type_ajustement}"
            )

    # ========================================================================
    # SECTION 4 : AJOUT DES GARANTIES OPTIONNELLES
    # ========================================================================

    def ajouter_sous_garanties_optionnelles(
        self,
        sous_garanties: List[Dict],
        codes_sous_garanties_opt: List[str],
        repartition_manuelle: Optional[Dict[str, Decimal]] = None,
    ) -> List[Dict]:
        """
        Ajoute les sous-garanties optionnelles sélectionnées.

        Args:
            sous_garanties: Liste des sous-garanties obligatoires
            codes_sous_garanties_opt: Codes des gsous-aranties optionnelles à ajouter

        Returns:
            Liste complète des sous-garanties (obligatoires + optionnelles)
        """
        if not codes_sous_garanties_opt:
            return sous_garanties

        # Récupérer les garanties optionnelles
        sous_garanties_opt = SousGarantieMRH.objects.filter(
            code__in=codes_sous_garanties_opt, type="OPTIONNELLE", actif=True
        )

        for sous_gar_opt in sous_garanties_opt:
            # Vérifier la disponibilité pour cet usage
            if not SousGarantieUsage.objects.filter(
                sous_garantie=sous_gar_opt,
                usage=self.usage,
                obligatoire=False,
                actif=True,
            ).exists():
                raise ValidationError(
                    f"La garantie '{sous_gar_opt.code}' n'est pas disponible pour l'usage '{self.usage.code}'"
                )

            # Récupérer la prime forfaitaire
            if repartition_manuelle and sous_gar_opt.code in repartition_manuelle:
                prime_nette = self._arrondir(Decimal(str(repartition_manuelle[sous_gar_opt.code])))
            else:
                try:
                    forfait = SousGarantieForfait.objects.get(
                        sous_garantie=sous_gar_opt, actif=True
                    )
                    prime_nette = forfait.prime_nette
                except SousGarantieForfait.DoesNotExist:
                    raise ValidationError(
                        f"Prime forfaitaire non définie pour la garantie '{sous_gar_opt.code}'"
                    )

            # Calculer la taxe
            taux_taxe = self._get_taux_taxe(sous_gar_opt.code)
            taxe = self._arrondir(prime_nette * taux_taxe)
            prime_ttc = prime_nette + taxe

            sous_garanties.append(
                {
                    "code_sous_garantie": sous_gar_opt.code,
                    "libelle_sous_garantie": sous_gar_opt.libelle,
                    "type_garantie": "OPTIONNELLE",
                    "prime_nette": prime_nette,
                    "prime_avant_options": prime_nette,
                    "taux_repartition": None,
                    "taux_taxe": taux_taxe * 100,
                    "taxe": taxe,
                    "prime_ttc": prime_ttc,
                    "code_sous_garantie_std": sous_gar_opt.get_code_sous_garantie_std(),
                    "id_sous_garantie_std": sous_gar_opt.get_id_sous_garantie_std(),
                }
            )

        return sous_garanties

    # ========================================================================
    # SECTION 5 : CALCUL DES ACCESSOIRES PAR PALIERS
    # ========================================================================

    def calculer_accessoire(
        self, prime_nette_totale: Decimal, id_produit: int, id_compagnie: int
    ) -> Dict:
        """
        Calcule l'accessoire selon les paliers de prime nette définis dans stdaccessoire.

        La logique suit la requête SQL :
        SELECT COALESCE(NULLIF(montantforfait, 0), accessoires)
        FROM stdaccessoire
        WHERE idproduit = ? AND idcompagnie = ?
          AND prime_nette_totale BETWEEN primemin AND primemax

        Args:
            prime_nette_totale: Prime nette totale du devis (après options)
            id_produit: ID du produit MRH
            id_compagnie: ID de la compagnie

        Returns:
            Dict contenant:
            {
                'accessoire': Decimal,  # Montant accessoire HT
                'taxe_accessoire': Decimal,  # Taxe sur accessoire (14,5%)
                'accessoire_ttc': Decimal  # Accessoire + taxe
            }
        """
        from configuration_api.models import Accessoire
        from django.db.models import Q

        accessoire = Decimal("0")

        try:
            # primemax peut être NULL pour le dernier palier (= sans plafond)
            # Q(primemax__gte=...) | Q(primemax__isnull=True) gère les deux cas
            palier = Accessoire.objects.filter(
                produit_id=id_produit,
                compagnie_id=id_compagnie,
                primemin__lte=prime_nette_totale,
            ).filter(
                Q(primemax__gte=prime_nette_totale) | Q(primemax__isnull=True)
            ).order_by("primemin").last()  # dernier palier si plusieurs matchent (ex: primemax NULL)

            if palier:
                if palier.montantforfait and palier.montantforfait != 0:
                    accessoire = palier.montantforfait
                else:
                    accessoire = palier.accessoires or Decimal("0")

        except Exception:
            pass

        # Calcul de la taxe sur accessoire (14,5%)
        taxe_accessoire = self._arrondir(
            accessoire * self.TAUX_TAXE_ACCESSOIRE
        )

        return {
            "accessoire": accessoire,
            "taxe_accessoire": taxe_accessoire,
            "accessoire_ttc": accessoire + taxe_accessoire,
        }

    # ========================================================================
    # SECTION 6 : CALCUL COMPLET D'UNE MAISON
    # ========================================================================

    def calculer_maison(
        self,
        code_usage: str,
        valeur_batiment: Optional[Decimal] = None,
        valeur_contenu: Optional[Decimal] = None,
        loyer_mensuel: Optional[Decimal] = None,
        capital_rvt: Optional[Decimal] = None,
        options: Optional[List[str]] = None,
        sous_garanties_optionnelles: Optional[List[str]] = None,
        adresse: Optional[str] = None,
        description: Optional[str] = None,
        repartition_manuelle: Optional[Dict[str, Decimal]] = None,
    ) -> Dict:
        """
        Calcule la prime complète d'une maison avec toutes ses garanties.

        Args:
            code_usage: Code de l'usage habitation
            valeur_batiment: Valeur du bâtiment (optionnel selon usage)
            valeur_contenu: Valeur du contenu (optionnel selon usage)
            loyer_mensuel: Loyer mensuel (optionnel selon usage)
            capital_rvt: Capital RVT (optionnel selon usage)
            options: Liste des codes d'options sélectionnées
            sous_garanties_optionnelles: Liste des codes de sous-garanties optionnelles
            adresse: Adresse de la maison
            description: Description supplémentaire

        Returns:
            Dict contenant tous les détails du calcul
        """
        options = options or []
        sous_garanties_optionnelles = sous_garanties_optionnelles or []

        # 1. Calculer la prime de base
        prime_base = self.calculer_prime_base(
            code_usage=code_usage,
            valeur_batiment=valeur_batiment,
            valeur_contenu=valeur_contenu,
            loyer_mensuel=loyer_mensuel,
            capital_rvt=capital_rvt,
        )

        # 2. Répartir sur les garanties obligatoires
        sous_garanties = self.repartir_prime_sous_garanties(
            prime_base, repartition_manuelle=repartition_manuelle
        )

        # 3. Appliquer les options
        sous_garanties, options_appliquees = self.appliquer_options(
            sous_garanties, options, prime_base
        )

        # 4. Ajouter les garanties optionnelles
        sous_garanties = self.ajouter_sous_garanties_optionnelles(
            sous_garanties, sous_garanties_optionnelles,
            repartition_manuelle=repartition_manuelle,
        )

        # 5. Calculer les totaux
        prime_nette_totale = sum(g["prime_nette"] for g in sous_garanties)
        prime_annuelle_totale = sum(
            g.get("prime_avant_options", g["prime_nette"])
            for g in sous_garanties
        )
        taxe_totale = sum(g["taxe"] for g in sous_garanties)
        prime_ttc_totale = prime_nette_totale + taxe_totale

        # 6. Préparer le résultat
        return {
            "code_usage": code_usage,
            "libelle_usage": self.usage.libelle,
            "parametres": {
                "valeur_batiment": valeur_batiment,
                "valeur_contenu": valeur_contenu,
                "loyer_mensuel": loyer_mensuel,
                "capital_rvt": capital_rvt,
            },
            "prime_base": prime_base,
            "prime_annuelle_totale": prime_annuelle_totale,
            "prime_nette_totale": prime_nette_totale,
            "taxe_totale": taxe_totale,
            "prime_ttc_totale": prime_ttc_totale,
            "sous_garanties": sous_garanties,
            "options_appliquees": options_appliquees,
            "adresse": adresse,
            "description": description,
        }

    # ========================================================================
    # SECTION 7 : ENREGISTREMENT DANS LES MODÈLES LEGACY
    # ========================================================================

    @transaction.atomic
    def enregistrer_maison_dans_devis(
        self,
        id_devis: int,
        id_tarif: int,
        id_offre: int,
        prime_imposee: bool,
        resultat_calcul: Dict,
    ) -> int:
        """
        Enregistre une maison calculée dans DevisDetail et DevisDetGarantie.

        Args:
            id_devis: ID du devis parent
            resultat_calcul: Résultat du calcul de calculer_maison()

        Returns:
            ID du DevisDetail créé
        """
        from configuration_api.models import Offre

        from ..models import Devis, DevisDetail, DevisDetGarantie

        # 0. Générer matricule
        matricule = self._generer_matricule_maison()

        # 1. Calculer la prime annuelle de la maison (avant options)
        prime_annuelle_maison = sum(
            g.get("prime_avant_options", g["prime_nette"])
            for g in resultat_calcul["sous_garanties"]
        )

        # 2. Créer le DevisDetail (maison)
        nombre_maisons = DevisDetail.objects.filter(
            iddevis_id=id_devis
        ).count()
        try:
            if nombre_maisons == 0:  # Première maison dans le devis
                devis = Devis.objects.get(pk=id_devis)
                if devis:
                    devis.offre = Offre.objects.get(pk=id_offre)
                    devis.save()
        except Devis.DoesNotExist:
            raise ValidationError(
                {"erreur": f"Devis ID {id_devis} inexistant"}
            )
        except Offre.DoesNotExist:
            raise ValidationError(
                {"erreur": f"Offre ID {id_devis} inexistante"}
            )

        devis_detail = DevisDetail.objects.create(
            iddevis_id=id_devis,
            idoffre=id_offre,
            idtarif=id_tarif,
            vehicule=0,  # 0 pour MRH (legacy auto)
            # Montants calculés
            primenette=resultat_calcul["prime_nette_totale"],
            taxeenregistrement=resultat_calcul["taxe_totale"],
            primeannuelle=prime_annuelle_maison,
            # Champs utilisables pour stocker des infos MRH
            observation=self._formater_observation(resultat_calcul),
            # Valeurs stockées dans champs legacy
            valeurneuve=resultat_calcul["parametres"].get("valeur_batiment")
            or 0,
            valeurvenale=resultat_calcul["parametres"].get("valeur_contenu")
            or 0,
            modelevehicule=resultat_calcul["code_usage"],
            adressecnd=resultat_calcul["adresse"] or "",
            conducteur=(
                json.dumps(
                    resultat_calcul["options_appliquees"],
                    cls=DjangoJSONEncoder,
                )
                if resultat_calcul["options_appliquees"]
                else "[]"
            ),
            chargeutile=resultat_calcul["parametres"].get("loyer_mensuel")
            or 0,
            valeuraccessoire=resultat_calcul["parametres"].get("capital_rvt")
            or 0,
            matricule=matricule,
            # Valeurs par défaut pour compatibilité
            nombreplace=0,
            fga=0,
            remorque=False,
            extincteur=False,
            provisoire=False,
            carteverte=False,
            typeimmat="M",
            attestation="",
            prime_imposee=prime_imposee,
        )

        # 2. Créer les DevisDetGarantie pour chaque garantie
        for sous_garantie in resultat_calcul["sous_garanties"]:
            if not sous_garantie["id_sous_garantie_std"]:
                # Skip si pas de mapping avec stdsousgarantie
                continue

            DevisDetGarantie.objects.create(
                IdDevisDet=devis_detail,
                IdGarantie_id=sous_garantie["id_sous_garantie_std"],
                Acquise=True,
                # Montants
                PrimeNette=sous_garantie["prime_nette"],
                taxe=sous_garantie["taxe"],
                primeannuelle=sous_garantie.get(
                    "prime_avant_options", sous_garantie["prime_nette"]
                ),
                # Champs optionnels (NULL pour MRH)
                Capital=None,
                Franchise=None,
                TexteFranchise=None,
                Formule=None,
                # Champs old_ pour historique
                old_acquise=(
                    "1"
                    if sous_garantie["type_garantie"] == "OBLIGATOIRE"
                    else "0"
                ),
                old_capital=0,
                old_franchise=0,
                old_formule=None,
                old_places=None,
                old_primenette=0,
                # Champs spécifiques (non utilisés pour MRH)
                deces=None,
                ipp=None,
                fraismed=None,
                hosp=None,
                minfranchise=0,
                maxfranchise=0,
            )

        return {
            "id_maison": devis_detail.iddevisdetail,
            "matricule": matricule,
            "prime_nette": resultat_calcul["prime_nette_totale"],
            "prime_annuelle": prime_annuelle_maison,
            "taxe": resultat_calcul["taxe_totale"],
        }

    @transaction.atomic
    def mettre_a_jour_totaux_devis(
        self,
        id_devis: int,
        id_produit: int,
        id_compagnie: int,
        inclure_accessoires: bool = True,
        montant_accessoire: Optional[Decimal] = None,
    ) -> Dict:
        """
        Met à jour les totaux du devis après ajout/modification de maisons.

        Args:
            id_devis: ID du devis à mettre à jour
            id_produit: ID du produit MRH
            id_compagnie: ID de la compagnie
            inclure_accessoires: Si True, calcule et ajoute les accessoires
            montant_accessoire: Montant accessoire à utiliser (si non None, remplace le calcul)

        Returns:
            Dict contenant les montants calculés
        """
        from ..models import Devis, DevisDetail  # Import local

        # 1. Récupérer toutes les maisons du devis
        maisons = DevisDetail.objects.filter(iddevis_id=id_devis)

        # 2. Calculer les totaux
        prime_annuelle_totale = sum(m.primeannuelle for m in maisons)
        prime_nette_totale = sum(m.primenette for m in maisons)
        taxe_garanties_totale = sum(m.taxeenregistrement for m in maisons)

        # 3. Calculer les accessoires si demandé
        accessoire = Decimal("0")
        taxe_accessoire = Decimal("0")

        if inclure_accessoires:
            if montant_accessoire is not None:
                accessoire = montant_accessoire
                taxe_accessoire = self._arrondir(
                    accessoire * self.TAUX_TAXE_ACCESSOIRE
                )
            else:
                result_accessoire = self.calculer_accessoire(
                    prime_nette_totale=prime_nette_totale,
                    id_produit=id_produit,
                    id_compagnie=id_compagnie,
                )
                accessoire = result_accessoire["accessoire"]
                taxe_accessoire = result_accessoire["taxe_accessoire"]

        # 4. Calculer les montants finaux
        taxe_totale = taxe_garanties_totale + taxe_accessoire
        primeannuelle = prime_annuelle_totale
        fga = Decimal("0")  # 0 pour MRH
        cedeao = Decimal("0")  # 0 pour MRH
        primettc = prime_nette_totale + accessoire + fga + cedeao + taxe_totale

        # 5. Mettre à jour le devis
        Devis.objects.filter(iddevis=id_devis).update(
            primenette=prime_nette_totale,
            taxe=taxe_totale,
            accessoire=accessoire,
            primeannuelle=primeannuelle,
            fga=fga,
            cedeao=cedeao,
            primettc=primettc,
        )

        # 6. Retourner les montants calculés
        return {
            "prime_nette_totale": prime_nette_totale,
            "taxe_garanties": taxe_garanties_totale,
            "accessoire": accessoire,
            "taxe_accessoire": taxe_accessoire,
            "taxe_totale": taxe_totale,
            "primeannuelle": primeannuelle,
            "fga": fga,
            "cedeao": cedeao,
            "primettc": primettc,
        }

    @transaction.atomic
    def creer_devis(
        self,
        idintermediaire: int,
        idcompagnie: int,
        idproduit: int,
        idtarif: int,
        idoffre: int,
        idclient: int,
        dateeffet: date,
        **kwargs,
    ) -> int:
        """
        Crée un nouveau devis MRH vide.

        Args:
            idintermediaire: ID de l'intermédiaire
            idcompagnie: ID de la compagnie
            idproduit: ID du produit MRH
            idtarif: ID du tarif
            idoffre: ID de l'offre
            idclient: ID du client
            dateeffet: Date d'effet du contrat
            **kwargs: Autres champs optionnels (dateexpiration, idassure, etc.)

        Returns:
            ID du devis créé
        """
        from ..models import Devis

        # Calculer dateexpiration si non fournie
        dateexpiration = kwargs.get("dateexpiration")
        idduree = kwargs.get("idduree", 4)  # durée annuelle par défaut
        jours = kwargs.get("nombrejours", 0)

        if not dateexpiration:
            # ⚠️ Si calculer_date_expiration lève une exception, rollback automatique
            dateexpiration = calculer_date_expiration(
                date_effet=dateeffet, id_duree=idduree, nombre_jours=jours
            )

        # ⚠️ obtenir_nouveau_numero_devis modifie la base et peut lever une exception
        codecategorie = obtenir_code_categorie(idtarif)
        numerodevis = obtenir_nouveau_numero_devis(
            id_intermediaire=idintermediaire,
            id_compagnie=idcompagnie,
            code_categorie=codecategorie,
        )

        # Date d'émission imposée : jamais saisie, toujours le jour de l'enregistrement
        dateemission = timezone.now()
        numero_police_compagnie = kwargs.get("numeropolicecompagnie", "")

        # ⚠️ Devis.objects.create peut lever une exception
        devis = Devis.objects.create(
            intermediaire_id=idintermediaire,
            compagnie_id=idcompagnie,
            produit_id=idproduit,
            offre_id=idoffre,
            client_id=idclient,
            assure_id=kwargs.get("idassure", idclient),
            numerodevis=numerodevis,
            numero_police_compagnie=numero_police_compagnie,
            dateeffet=dateeffet,
            dateexpiration=dateexpiration,
            dateemission=dateemission,
            flotte=kwargs.get("flotte", False),
            coassurance=kwargs.get("coassurance", False),
            renouvelable=kwargs.get("renouvelable", True),
            confirme=kwargs.get("confirme", False),
            prime_imposee=kwargs.get("prime_imposee", False),
            idduree=idduree,
            idterme=kwargs.get("idterme", 1),
            periode=kwargs.get("periode", "A"),
            referenceagent=kwargs.get("referenceagent", ""),
            observation=kwargs.get("observation", ""),
            primenette=0,
            taxe=0,
            accessoire=0,
            primeannuelle=0,
            fga=0,
            cedeao=0,
            primettc=0,
            avenant_id=kwargs.get("idavenant", 1),
            aperiteur_id=kwargs.get("idaperiteur", idintermediaire),
            numeroavenant="",
            echeance="",
            nbreche=1,
            statut="ACTIF",
        )

        return devis.iddevis

    def _formater_observation(self, resultat_calcul: Dict) -> str:
        """
        Formate l'observation pour DevisDetail (max 50 caractères).
        Stocke l'usage et l'adresse si possible.
        """
        observation = resultat_calcul["libelle_usage"][:30]

        adresse = resultat_calcul.get("adresse", "")
        if adresse:
            # Ajouter l'adresse si il reste de la place
            espace_restant = 50 - len(observation) - 3  # -3 pour " - "
            if espace_restant > 0:
                observation += f" - {adresse[:espace_restant]}"

        return observation[:50]

    # ========================================================================
    # SECTION 8 : MÉTHODES HAUT NIVEAU (COMBINAISON)
    # ========================================================================

    @transaction.atomic
    def calculer_et_enregistrer_maison(
        self,
        id_devis: int,
        id_produit: int,
        id_compagnie: int,
        id_tarif: int,
        id_offre: int,
        code_usage: str,
        valeur_batiment: Optional[Decimal] = None,
        valeur_contenu: Optional[Decimal] = None,
        loyer_mensuel: Optional[Decimal] = None,
        capital_rvt: Optional[Decimal] = None,
        options: Optional[List[str]] = None,
        sous_garanties_optionnelles: Optional[List[str]] = None,
        adresse: Optional[str] = None,
        description: Optional[str] = None,
        repartition_manuelle: Optional[Dict[str, Decimal]] = None,
    ) -> Dict:
        """
        Méthode combinée : calcule la prime d'une maison ET l'enregistre dans le devis.

        Args:
            id_devis: ID du devis parent
            id_produit: ID du produit MRH
            id_compagnie: ID de la compagnie
            id_tarif: ID du tarif
            id_offre: ID de l'offre commerciale
            code_usage: Code de l'usage habitation
            valeur_batiment, valeur_contenu, etc.: Paramètres de calcul
            options: Liste des codes d'options
            sous_garanties_optionnelles: Liste des codes de sous-garanties optionnelles
            adresse: Adresse de la maison
            description: Description

        Returns:
            Dict contenant:
            {
                'id_maison': int,  # ID du DevisDetail créé
                'calcul': Dict,  # Résultat du calcul
                'totaux_devis': Dict  # Totaux mis à jour du devis
            }
        """
        # 1. Calculer la maison
        resultat_calcul = self.calculer_maison(
            code_usage=code_usage,
            valeur_batiment=valeur_batiment,
            valeur_contenu=valeur_contenu,
            loyer_mensuel=loyer_mensuel,
            capital_rvt=capital_rvt,
            options=options,
            sous_garanties_optionnelles=sous_garanties_optionnelles,
            adresse=adresse,
            description=description,
            repartition_manuelle=repartition_manuelle,
        )

        # 2. Enregistrer dans DevisDetail et DevisDetGarantie
        donnees_maison = self.enregistrer_maison_dans_devis(
            id_devis=id_devis,
            id_tarif=id_tarif,
            id_offre=id_offre,
            prime_imposee=False,
            resultat_calcul=resultat_calcul,
        )

        # 3. Mettre à jour les totaux du devis (avec accessoires)
        totaux_devis = self.mettre_a_jour_totaux_devis(
            id_devis=id_devis,
            id_produit=id_produit,
            id_compagnie=id_compagnie,
            inclure_accessoires=True,
        )

        # 4. Retourner le résultat complet
        return {
            "id_maison": donnees_maison["id_maison"],
            "calcul": resultat_calcul,
            "totaux_devis": totaux_devis,
        }

        # ========================================================================

    # SECTION 9 : RÉCAPITULATIF DES COMPOSANTES DE PRIMES
    # ========================================================================

    @transaction.atomic
    def creer_et_sauvegarder_recapitulatif(
        self, id_devis: int, sauvegarder_en_base: bool = True
    ) -> RecapitulatifPrimesMRH:
        """
        Crée un récapitulatif complet des composantes de calcul du devis
        et le sauvegarde optionnellement en base de données.

        Cette méthode doit être appelée APRÈS avoir ajouté toutes les maisons au devis.

        Args:
            id_devis: ID du devis
            sauvegarder_en_base: Si True, sauvegarde dans stdmrh_recap_prime

        Returns:
            Instance de RecapitulatifPrimesMRH avec toutes les données

        Exemple:
            service = MRHCalculService()

            # Créer le devis et ajouter des maisons...

            # Créer le récapitulatif
            recap = service.creer_et_sauvegarder_recapitulatif(id_devis=456)

            # Obtenir le JSON
            json_recap = recap.to_json()

            # Obtenir le résumé textuel
            texte = recap.generer_resume_textuel()
            print(texte)
        """
        from ..models import Devis, DevisDetail

        # Récupérer le devis
        devis = Devis.objects.select_related(
            "client", "compagnie", "intermediaire", "produit"
        ).get(iddevis=id_devis)

        # Initialiser le récapitulatif
        recap = RecapitulatifPrimesMRH()

        # Ajouter les informations du devis
        recap.creer_recap_devis(
            id_devis=devis.iddevis,
            numero_devis=devis.numerodevis or "",
            client_info={
                "id": devis.client_id,
                "nom": getattr(devis.client, "nom", "N/A"),
                "prenom": getattr(devis.client, "prenom", ""),
            },
            date_effet=devis.dateeffet,
            date_expiration=devis.dateexpiration,
            compagnie_id=devis.compagnie_id,
            compagnie_nom=getattr(devis.compagnie, "nom", "N/A"),
            intermediaire_id=devis.intermediaire_id,
            intermediaire_nom=getattr(devis.intermediaire, "nom", "N/A"),
            produit_id=devis.produit_id,
            produit_nom=getattr(devis.produit, "nom", "MRH"),
            reference_agent=devis.referenceagent or "",
            observation=devis.observation or "",
        )

        # Récupérer et ajouter les maisons
        maisons = DevisDetail.objects.filter(iddevis_id=id_devis).order_by(
            "iddevisdetail"
        )

        for idx, maison in enumerate(maisons, 1):
            # Récupérer les garanties de cette maison
            from ..models import DevisDetGarantie

            garanties_db = DevisDetGarantie.objects.filter(
                IdDevisDet=maison
            ).select_related("IdGarantie")

            # Formater les garanties
            garanties = []
            for gar_db in garanties_db:
                garantie_std = gar_db.IdGarantie

                # Calculer le taux de taxe
                if gar_db.PrimeNette and gar_db.PrimeNette != 0:
                    taux_taxe = (gar_db.taxe / gar_db.PrimeNette) * Decimal(
                        "100"
                    )
                else:
                    taux_taxe = Decimal("0")

                garanties.append(
                    {
                        "code_garantie": (
                            garantie_std.codegarantie
                            if garantie_std
                            else "N/A"
                        ),
                        "libelle": (
                            garantie_std.libelle if garantie_std else "N/A"
                        ),
                        "type": (
                            "OBLIGATOIRE" if gar_db.Acquise else "OPTIONNELLE"
                        ),
                        "prime_nette": gar_db.PrimeNette,
                        "taux_repartition": None,  # Non stocké dans DevisDetGarantie
                        "taux_taxe": taux_taxe,
                        "taxe": gar_db.taxe,
                        "prime_ttc": gar_db.primeannuelle,
                        "code_garantie_std": (
                            garantie_std.codegarantie if garantie_std else None
                        ),
                        "id_garantie_std": (
                            garantie_std.idgarantie if garantie_std else None
                        ),
                    }
                )

            # Créer un résultat de calcul pour cette maison
            resultat_calcul = {
                "code_usage": "N/A",  # Non stocké explicitement
                "libelle_usage": (
                    maison.observation[:30] if maison.observation else "N/A"
                ),
                "adresse": (
                    maison.observation[33:]
                    if len(maison.observation or "") > 33
                    else ""
                ),
                "description": "",
                "parametres": {
                    "valeur_batiment": maison.valeurneuve,
                    "valeur_contenu": maison.valeurvenale,
                    "loyer_mensuel": None,
                    "capital_rvt": None,
                },
                "prime_base": maison.primenette,  # Approximatif
                "prime_nette_totale": maison.primenette,
                "taxe_totale": maison.taxeenregistrement,
                "prime_ttc_totale": maison.primeannuelle,
                "garanties": garanties,
                "options_appliquees": [],  # Non stocké dans les tables legacy
            }

            recap.ajouter_maison(
                id_maison=maison.iddevisdetail,
                resultat_calcul=resultat_calcul,
                ordre=idx,
            )

        # Ajouter les accessoires
        # Calculer la taxe accessoire (taxe totale - somme des taxes garanties)
        taxe_garanties = sum(m.taxeenregistrement for m in maisons)
        taxe_accessoire = (
            devis.taxe - taxe_garanties if devis.taxe else Decimal("0")
        )

        recap.ajouter_accessoires(
            prime_nette_totale=devis.primenette or Decimal("0"),
            accessoire=devis.accessoire or Decimal("0"),
            taxe_accessoire=taxe_accessoire,
            palier_info=None,  # Pourrait être enrichi en récupérant de stdaccessoire
        )

        # Calculer les totaux
        recap.calculer_totaux()

        # Sauvegarder en base si demandé
        if sauvegarder_en_base:
            recap.sauvegarder_en_base(id_devis=id_devis)

        return recap

    # ========================================================================
    # UTILITAIRES
    # ========================================================================

    def _arrondir(self, montant: Decimal) -> Decimal:
        """Arrondit à l'entier le plus proche (FCFA = devise sans décimale)"""
        return montant.quantize(Decimal("1"), rounding=ROUND_HALF_UP)

    def _generer_matricule_maison(self) -> str:
        """
        Génère un matricule unique pour une maison MRH.

        Format : MRH-YYYY-NNNNN
        - MRH : Préfixe produit
        - YYYY : Année courante
        - NNNNN : Numéro séquentiel sur 5 chiffres

        Exemples :
        - MRH-2024-00001
        - MRH-2024-00456
        - MRH-2025-00001

        Le compteur repart à 1 chaque année.

        Returns:
            str: Matricule unique
        """
        from datetime import datetime

        from django.db import connection

        # Année courante
        annee = datetime.now().year

        # Compter les maisons MRH créées cette année
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) 
                FROM stddevisdetail dd
                JOIN stddevis d ON dd.iddevis = d.iddevis
                WHERE d.idproduit = 4  -- Produit MRH
                AND EXTRACT(YEAR FROM d.dateemission) = %s
            """,
                [annee],
            )

            count = cursor.fetchone()[0] or 0

        # Numéro séquentiel (incrémenté)
        numero = count + 1

        # Générer le matricule avec padding sur 5 chiffres
        matricule = f"MRH-{annee}-{numero:05d}"

        return matricule

    """
    Méthodes additionnelles pour mrh_calcul_service.py
    ====================================================
    Fonctionnalités :
    1. Modifier une maison existante
    2. Imposer la prime d'une maison
    3. Imposer la prime d'un devis
    4. Lever une imposition
    5. Vérifications et utilitaires
    """

    @transaction.atomic
    def modifier_maison(
        self,
        id_maison: int,
        code_usage: Optional[str] = None,
        valeur_batiment: Optional[Decimal] = None,
        valeur_contenu: Optional[Decimal] = None,
        loyer_mensuel: Optional[Decimal] = None,
        capital_rvt: Optional[Decimal] = None,
        options: Optional[List[str]] = None,
        sous_garanties_optionnelles: Optional[List[str]] = None,
        adresse: Optional[str] = None,
        description: Optional[str] = None,
        force_recalcul: bool = False,
    ) -> Dict:
        """
        Modifie une maison existante dans un devis.

        Règles :
        - Si prime maison imposée : erreur (sauf force_recalcul=True)
        - Si prime devis imposée : erreur (sauf force_recalcul=True)
        - Si force_recalcul=True : lève l'imposition et recalcule

        Args:
            id_maison: ID du DevisDetail
            code_usage: Nouveau code usage (optionnel)
            valeur_batiment: Nouvelle valeur bâtiment (optionnel)
            valeur_contenu: Nouvelle valeur contenu (optionnel)
            loyer_mensuel: Nouveau loyer (optionnel)
            capital_rvt: Nouveau capital RVT (optionnel)
            options: Nouvelles options (optionnel)
            sous_garanties_optionnelles: Nouvelles sous-garanties optionnelles (optionnel)
            adresse: Nouvelle adresse (optionnel)
            description: Nouvelle description (optionnel)
            force_recalcul: Force le recalcul même si prime imposée

        Returns:
            Dict avec le résultat de la modification
        """
        from production.models import DevisDetail, DevisDetGarantie

        # 1. Récupérer la maison
        try:
            maison = DevisDetail.objects.select_related("iddevis").get(
                iddevisdetail=id_maison
            )
        except DevisDetail.DoesNotExist:
            raise ValueError(f"Maison {id_maison} non trouvée")

        id_devis = maison.iddevis.pk
        devis = maison.iddevis

        # 2. Vérifier si prime maison imposée
        if maison.prime_imposee and not force_recalcul:
            return {
                "success": False,
                "erreur": "PRIME_MAISON_IMPOSEE",
                "message": (
                    f"La prime de cette maison est imposée à "
                    f"{maison.primenette:,.2f} FCFA. "
                    f"Utilisez force_recalcul=True pour modifier quand même."
                ),
                "prime_imposee": True,
                "montant_impose": float(maison.primenette),
                "date_imposition": (
                    maison.prime_imposee_date.isoformat()
                    if maison.prime_imposee_date
                    else None
                ),
            }

        # 3. Vérifier si prime du devis imposée
        if devis.prime_imposee and not force_recalcul:
            return {
                "success": False,
                "erreur": "PRIME_DEVIS_IMPOSEE",
                "message": (
                    f"La prime du devis est imposée à "
                    f"{devis.primenette:,.2f} FCFA. "
                    f"Impossible de modifier les maisons sans lever l'imposition."
                ),
                "prime_imposee": True,
                "montant_impose": float(devis.primenette),
                "date_imposition": (
                    devis.prime_imposee_date.isoformat()
                    if devis.prime_imposee_date
                    else None
                ),
            }

        # 4. Si force_recalcul=True et imposée, lever l'imposition maison
        if force_recalcul and maison.prime_imposee:
            self._lever_imposition_interne("MAISON", id_maison)

        # 5. Récupérer les valeurs actuelles si non fournies
        if code_usage is None:
            code_usage = self._extraire_code_usage_depuis_offre(maison.idoffre)
            id_offre = maison.idoffre
        else:
            id_offre = self._obtenir_offre_depuis_code_usage(code_usage)

        if valeur_batiment is None:
            valeur_batiment = maison.valeurneuve or Decimal("0")

        if valeur_contenu is None:
            valeur_contenu = maison.valeurvenale or Decimal("0")

        # 6. Recalculer la maison
        resultat_calcul = self.calculer_maison(
            code_usage=code_usage,
            valeur_batiment=valeur_batiment,
            valeur_contenu=valeur_contenu,
            loyer_mensuel=loyer_mensuel,
            capital_rvt=capital_rvt,
            options=options or [],
            sous_garanties_optionnelles=sous_garanties_optionnelles or [],
            adresse=adresse or maison.adressecnd,
            description=description,
        )

        # 7. Supprimer les anciennes garanties
        DevisDetGarantie.objects.filter(IdDevisDet=maison).delete()

        # 8. Calculer la prime annuelle de la maison (avant options)
        prime_annuelle_maison = sum(
            g.get("prime_avant_options", g["prime_nette"])
            for g in resultat_calcul["sous_garanties"]
        )

        # 9. Mettre à jour DevisDetail
        maison.primenette = resultat_calcul["prime_nette_totale"]
        maison.primeannuelle = prime_annuelle_maison
        maison.taxeenregistrement = resultat_calcul["taxe_totale"]
        maison.observation = self._formater_observation(resultat_calcul)
        maison.valeurneuve = valeur_batiment
        maison.valeurvenale = valeur_contenu
        maison.modelevehicule = code_usage
        maison.adressecnd = adresse
        maison.conducteur = (
            json.dumps(
                resultat_calcul["options_appliquees"], cls=DjangoJSONEncoder
            )
            if resultat_calcul["options_appliquees"]
            else "[]"
        )
        maison.chargeutile = loyer_mensuel
        maison.valeuraccessoire = capital_rvt
        maison.idoffre = id_offre
        maison.save()

        # 10. Recréer les garanties
        for sous_garantie in resultat_calcul["sous_garanties"]:
            if not sous_garantie["id_sous_garantie_std"]:
                continue

            DevisDetGarantie.objects.create(
                IdDevisDet=maison,
                IdGarantie_id=sous_garantie["id_sous_garantie_std"],
                Acquise=True,
                PrimeNette=sous_garantie["prime_nette"],
                primeannuelle=sous_garantie.get(
                    "prime_avant_options", sous_garantie["prime_nette"]
                ),
                taxe=sous_garantie["taxe"],
                Capital=None,
                Franchise=None,
                TexteFranchise=None,
                Formule=None,
                old_acquise=(
                    "1"
                    if sous_garantie["type_garantie"] == "OBLIGATOIRE"
                    else "0"
                ),
                old_capital=0,
                old_franchise=0,
                old_formule=None,
                old_places=None,
                old_primenette=0,
                deces=None,
                ipp=None,
                fraismed=None,
                hosp=None,
                minfranchise=0,
                maxfranchise=0,
            )

        # 11. Mettre à jour les totaux du devis
        totaux_devis = self.mettre_a_jour_totaux_devis(
            id_devis=id_devis,
            id_produit=devis.produit.pk,
            id_compagnie=devis.compagnie.pk,
            inclure_accessoires=True,
        )

        return {
            "success": True,
            "id_maison": id_maison,
            "calcul": resultat_calcul,
            "totaux_devis": totaux_devis,
            "message": "Maison modifiée avec succès",
            "imposition_levee": force_recalcul and maison.prime_imposee,
        }

    # ========================================================================
    # SECTION 11 : IMPOSITION DE PRIME
    # ========================================================================

    @transaction.atomic
    def imposer_prime_maison(
        self,
        id_maison: int,
        montant_impose: Decimal,
        user_id: Optional[int] = None,
        user_nom: Optional[str] = None,
        motif: Optional[str] = None,
    ) -> Dict:
        """
        Impose une prime NETTE pour une maison spécifique.

        La taxe sera recalculée sur cette prime imposée.

        Args:
            id_maison: ID du DevisDetail
            montant_impose: Montant de la prime NETTE à imposer
            user_id: ID de l'utilisateur qui impose
            user_nom: Nom de l'utilisateur
            motif: Raison de l'imposition

        Returns:
            Dict avec le résultat
        """
        from django.db import connection
        from django.utils import timezone

        from production.models import DevisDetail

        # 1. Récupérer la maison
        try:
            maison = DevisDetail.objects.select_related("iddevis").get(
                iddevisdetail=id_maison
            )
        except DevisDetail.DoesNotExist:
            raise ValueError(f"Maison {id_maison} non trouvée")

        # 2. Vérifier que la prime imposée est différente
        if maison.prime_imposee and maison.primenette == montant_impose:
            return {
                "success": False,
                "erreur": "DEJA_IMPOSEE",
                "message": f"La prime est déjà imposée à {montant_impose:,.2f} FCFA",
            }

        # 3. Sauvegarder les anciens montants
        ancien_montant_nette = maison.primenette
        ancien_montant_ttc = maison.primenette + maison.taxeenregistrement

        # 4. Enregistrer dans l'historique
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO stdmrh_imposition_prime (
                    type_imposition, id_cible, 
                    montant_impose, ancien_montant_nette, ancien_montant_ttc,
                    user_id, user_nom, motif, date_imposition, actif
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
                RETURNING id
            """,
                [
                    "MAISON",
                    id_maison,
                    montant_impose,
                    ancien_montant_nette,
                    ancien_montant_ttc,
                    user_id,
                    user_nom or "Système",
                    motif,
                    timezone.now(),
                ],
            )

            imposition_id = cursor.fetchone()[0]

        # 5. Calculer la nouvelle taxe (garder le ratio actuel)
        if ancien_montant_nette and ancien_montant_nette != 0:
            ratio_taxe = maison.taxeenregistrement / ancien_montant_nette
        else:
            ratio_taxe = Decimal("0.185")  # Ratio moyen 18,5%

        nouvelle_taxe = self._arrondir(montant_impose * ratio_taxe)

        # 6. Mettre à jour la maison
        maison.prime_imposee = True
        maison.primenette = montant_impose
        maison.prime_imposee_date = datetime.now()
        maison.taxeenregistrement = nouvelle_taxe
        maison.save()

        # 7. Mettre à jour les totaux du devis
        devis = maison.iddevis
        totaux_devis = self.mettre_a_jour_totaux_devis(
            id_devis=devis.iddevis,
            id_produit=devis.produit.pk,
            id_compagnie=devis.compagnie.pk,
            inclure_accessoires=True,
        )

        return {
            "success": True,
            "id_maison": id_maison,
            "imposition_id": imposition_id,
            "montant_impose": float(montant_impose),
            "ancien_montant_nette": float(ancien_montant_nette),
            "ancien_montant_ttc": float(ancien_montant_ttc),
            "nouvelle_taxe": float(nouvelle_taxe),
            "totaux_devis": totaux_devis,
            "message": f"Prime maison imposée à {montant_impose:,.2f} FCFA (prime nette)",
        }

    @transaction.atomic
    def imposer_prime_devis(
        self,
        id_devis: int,
        montant_impose: Decimal,
        repartition_maisons: Optional[List[Dict]] = None,
        montant_accessoire: Optional[Decimal] = None,
        montant_taxe: Optional[Decimal] = None,
        user_id: Optional[int] = None,
        user_nom: Optional[str] = None,
        motif: Optional[str] = None,
    ) -> Dict:
        """
        Impose une prime NETTE globale pour le devis.

        La taxe sera recalculéz sur cette prime.
        Les accessoires seront recalculés selon les paliers (si montant_accessoire non fourni).
        Les montants des maisons sont ajustés proportionnellement.

        Règles:
        - montant_impose = Prime NETTE uniquement
        - Taxe calculée selon les ratios actuels
        - Accessoires calculés selon les paliers (ou montant_accessoire si fourni)
        - Prime TTC = Prime nette imposée + Taxe + Accessoires

        Args:
            id_devis: ID du devis
            montant_impose: Montant de la prime NETTE à imposer
            montant_accessoire: Montant des accessoires (si fourni)
            user_id: ID de l'utilisateur
            user_nom: Nom de l'utilisateur
            motif: Raison de l'imposition

        Returns:
            Dict avec le résultat
        """
        from django.db import connection
        from django.utils import timezone

        from production.models import Devis, DevisDetail

        # 1. Récupérer le devis
        try:
            devis = Devis.objects.get(iddevis=id_devis)
        except Devis.DoesNotExist:
            raise ValueError(f"Devis {id_devis} non trouvé")

        # 2. Vérifier qu'il y a des maisons
        maisons = DevisDetail.objects.filter(iddevis_id=id_devis)
        if not maisons.exists():
            raise ValueError("Le devis ne contient aucune maison")

        # 3. Sauvegarder les anciens montants
        ancien_montant_nette = devis.primenette or Decimal("0")
        ancien_montant_ttc = devis.primettc or Decimal("0")

        # 4. Enregistrer dans l'historique
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO stdmrh_imposition_prime (
                    type_imposition, id_cible, 
                    montant_impose, ancien_montant_nette, ancien_montant_ttc,
                    user_id, user_nom, motif, date_imposition, actif
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
                RETURNING id
            """,
                [
                    "DEVIS",
                    id_devis,
                    montant_impose,
                    ancien_montant_nette,
                    ancien_montant_ttc,
                    user_id,
                    user_nom or "Système",
                    motif,
                    timezone.now(),
                ],
            )

            imposition_id = cursor.fetchone()[0]

        # 5. Appliquer la répartition explicite par maison
        # repartition_maisons = [{id_maison, montant}, ...] fourni par l'utilisateur
        map_repartition = {
            item["id_maison"]: Decimal(str(item["montant"]))
            for item in (repartition_maisons or [])
        }

        for maison in maisons:
            if map_repartition:
                nouvelle_prime_maison = self._arrondir(
                    map_repartition.get(maison.iddevisdetail, Decimal("0"))
                )
            else:
                # Fallback : répartition proportionnelle (compatibilité)
                total_prime_actuel = sum(m.primenette for m in maisons)
                if total_prime_actuel and total_prime_actuel != 0:
                    ratio_maison = maison.primenette / total_prime_actuel
                    nouvelle_prime_maison = self._arrondir(montant_impose * ratio_maison)
                else:
                    nouvelle_prime_maison = self._arrondir(montant_impose / len(maisons))

            # Taxe par maison : imposée globalement → répartir proportionnellement,
            # sinon recalculer via le ratio actuel taxe/prime
            if montant_taxe is not None and montant_taxe > 0:
                total_prime_pour_ratio = sum(m.primenette for m in maisons) or Decimal("1")
                ratio_maison = nouvelle_prime_maison / total_prime_pour_ratio if total_prime_pour_ratio else Decimal("0")
                nouvelle_taxe_maison = self._arrondir(montant_taxe * ratio_maison)
            elif maison.primenette and maison.primenette != 0:
                ratio_taxe_maison = maison.taxeenregistrement / maison.primenette
                nouvelle_taxe_maison = self._arrondir(nouvelle_prime_maison * ratio_taxe_maison)
            else:
                ratio_taxe_maison = Decimal("0.185")
                nouvelle_taxe_maison = self._arrondir(nouvelle_prime_maison * ratio_taxe_maison)

            maison.primenette = nouvelle_prime_maison
            maison.taxeenregistrement = nouvelle_taxe_maison
            maison.save()

        # 6. Recalculer les totaux du devis
        # (utilise les nouvelles valeurs des maisons)
        self.mettre_a_jour_totaux_devis(
            id_devis=id_devis,
            id_produit=devis.produit.pk,
            id_compagnie=devis.compagnie.pk,
            inclure_accessoires=True,
            montant_accessoire=montant_accessoire,  # Forcer le montant des accessoires si fourni
        )

        # 7. Forcer les montants imposés (au cas où il y aurait un écart d'arrondi)
        update_fields = ["primenette", "prime_imposee", "prime_imposee_date"]
        devis.primenette = montant_impose
        devis.prime_imposee = True
        devis.prime_imposee_date = datetime.now()
        if montant_taxe is not None and montant_taxe > 0:
            # Accessoire tel que mettre_a_jour_totaux_devis vient de l'enregistrer (imposé ou barème) :
            # l'objet devis a été lu avant
            devis.refresh_from_db(fields=["accessoire"])
            accessoire_val = devis.accessoire or Decimal("0")
            devis.taxe = montant_taxe
            devis.primettc = montant_impose + montant_taxe + accessoire_val
            update_fields += ["taxe", "primettc"]
        devis.save(update_fields=update_fields)
        devis.refresh_from_db()
        return {
            "success": True,
            "id_devis": id_devis,
            "imposition_id": imposition_id,
            "montant_impose": float(montant_impose),
            "ancien_montant_nette": float(ancien_montant_nette),
            "ancien_montant_ttc": float(ancien_montant_ttc),
            "nouveau_detail": {
                "primenette": float(devis.primenette),
                "taxe": float(devis.taxe),
                "accessoire": float(devis.accessoire),
                "primettc": float(devis.primettc),
            },
            "message": f"Prime devis imposée à {montant_impose:,.2f} FCFA (prime nette)",
            "note": "La taxe et les accessoires sont calculés sur cette prime imposée",
        }

    @transaction.atomic
    def lever_imposition(
        self,
        type_imposition: str,
        id_cible: int,
        user_id: Optional[int] = None,
        user_nom: Optional[str] = None,
        motif_levee: Optional[str] = None,
    ) -> Dict:
        """
        Lève une imposition de prime.

        Args:
            type_imposition: 'DEVIS' ou 'MAISON'
            id_cible: ID du devis ou de la maison
            user_id: ID de l'utilisateur qui lève
            user_nom: Nom de l'utilisateur
            motif_levee: Raison de la levée

        Returns:
            Dict avec le résultat
        """
        return self._lever_imposition_interne(
            type_imposition, id_cible, user_id, user_nom, motif_levee
        )

    # ========================================================================
    # SECTION 12 : MÉTHODES UTILITAIRES PRIVÉES
    # ========================================================================

    def _lever_imposition_interne(
        self,
        type_imposition: str,
        id_cible: int,
        user_id: Optional[int] = None,
        user_nom: Optional[str] = None,
        motif_levee: Optional[str] = None,
    ) -> Dict:
        """Méthode interne pour lever une imposition."""
        from django.db import connection

        from production.models import Devis, DevisDetail

        # 1. Désactiver dans l'historique
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE stdmrh_imposition_prime
                SET actif = FALSE,
                    date_levee = CURRENT_TIMESTAMP,
                    levee_par_user_id = %s,
                    levee_par_user_nom = %s,
                    motif_levee = %s
                WHERE type_imposition = %s 
                  AND id_cible = %s 
                  AND actif = TRUE
            """,
                [
                    user_id,
                    user_nom or "Système",
                    motif_levee,
                    type_imposition,
                    id_cible,
                ],
            )

        # 2. Mettre à jour l'entité
        if type_imposition == "DEVIS":
            devis = Devis.objects.get(iddevis=id_cible)
            devis.prime_imposee = False
            devis.prime_imposee_date = None
            devis.save()
        else:  # MAISON
            maison = DevisDetail.objects.get(iddevisdetail=id_cible)
            maison.prime_imposee = False
            maison.prime_imposee_date = None
            maison.save()

        return {
            "success": True,
            "type_imposition": type_imposition,
            "id_cible": id_cible,
            "message": f"Imposition levée pour {type_imposition} {id_cible}",
        }

    def _obtenir_offre_depuis_code_usage(self, code_usage: str) -> int:
        from configuration_api.models import UsageHabitation

        if not code_usage:
            raise ValueError(
                "Impossible d'obtenir l'offre: code usage non défini"
            )
        usage = UsageHabitation.objects.filter(code=code_usage).first()
        if usage and usage.offre:
            return usage.offre.pk
        raise ValueError(
            "Impossible d'obtenir l'offre: code usage non défini ou mal paramétré"
        )

    def _extraire_code_usage_depuis_offre(self, id_offre: int) -> str:
        """Extrait le code usage depuis le champ observation."""
        from configuration_api.models import Offre, UsageHabitation

        if not id_offre:
            raise ValueError(
                "Impossible d'extraire le code usage : offre non définie"
            )

        try:
            offre = Offre.objects.get(pk=id_offre)
            usage = UsageHabitation.objects.filter(offre=offre).first()
            if usage:
                return usage.code
            else:
                raise ValueError(
                    "Impossible de trouver le code usage : mauvais paramétrage"
                )
        except Offre.DoesNotExist as e:
            raise ValueError(f"Impossible d'extraire le code usage :{str(e)}")
