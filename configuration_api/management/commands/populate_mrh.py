"""
Management command pour peupler la base de données MRH avec les données validées.
VERSION FINALE - Avec SousGarantieMRH et mapping vers stdsousgarantie

Usage:
    python manage.py populate_mrh [--clear] [--skip-stdsousgarantie]

Options:
    --clear : Supprime toutes les données MRH existantes avant de peupler
    --skip-stdsousgarantie : Ne crée pas les sous-garanties dans stdsousgarantie (utilise celles existantes)
"""

from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = 'Peuple la base de données MRH avec les données de référence validées'

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Supprime toutes les données MRH existantes avant de peupler',
        )
        parser.add_argument(
            '--skip-stdsousgarantie',
            action='store_true',
            help='Ne crée pas les sous-garanties dans stdsousgarantie',
        )

    def handle(self, *args, **options):
        if options['clear']:
            self.stdout.write(self.style.WARNING('Suppression des données existantes...'))
            self.clear_data()

        try:
            with transaction.atomic():
                self.stdout.write('Création des usages habitation...')
                self.create_usages()

                if not options['skip_stdsousgarantie']:
                    self.stdout.write('Création des sous-garanties dans stdsousgarantie...')
                    self.create_sous_garanties_std()

                self.stdout.write('Création des sous-garanties MRH avec mapping...')
                self.create_garanties_mrh()

                self.stdout.write('Création des paramètres de calcul...')
                self.create_parametres_calcul()

                self.stdout.write('Création du mapping garanties ↔ usages...')
                self.create_garantie_usage()

                self.stdout.write('Création des options...')
                self.create_options()

                self.stdout.write('Création du mapping options ↔ usages...')
                self.create_option_usage()

                self.stdout.write('Création des garanties forfait...')
                self.create_garanties_forfait()

                self.stdout.write('Création des clés de répartition...')
                self.create_cles_repartition()

            self.stdout.write(self.style.SUCCESS('✓ Base de données peuplée avec succès!'))
            self.stdout.write(self.style.SUCCESS(f'  - 8 usages habitation'))
            self.stdout.write(self.style.SUCCESS(f'  - 19 sous-garanties MRH'))
            self.stdout.write(self.style.SUCCESS(f'  - ~70 mappings sous-garanties/usages'))
            self.stdout.write(self.style.SUCCESS(f'  - 11 options'))
            self.stdout.write(self.style.SUCCESS(f'  - 4 sous-garanties forfait'))

        except Exception as e:
            self.stdout.write(self.style.ERROR(f'✗ Erreur lors du peuplement: {str(e)}'))
            raise

    def clear_data(self):
        """Supprime toutes les données MRH"""
        from configuration_api.models import (
            SousGarantieForfait, CleRepartition, OptionUsage, Option,
            SousGarantieUsage, ParametresCalcul, SousGarantieMRH, UsageHabitation
        )
        
        SousGarantieForfait.objects.all().delete()
        CleRepartition.objects.all().delete()
        OptionUsage.objects.all().delete()
        Option.objects.all().delete()
        SousGarantieUsage.objects.all().delete()
        ParametresCalcul.objects.all().delete()
        SousGarantieMRH.objects.all().delete()
        UsageHabitation.objects.all().delete()

    def create_usages(self):
        """Crée les 8 usages habitation"""
        from configuration_api.models import UsageHabitation
        
        usages = [
            ('proprietaire_occupant_total', 'Propriétaire Occupant Total', 
             'Propriétaire qui occupe totalement son logement'),
            ('proprietaire_occupant_partiel', 'Propriétaire Occupant Partiel', 
             'Propriétaire qui occupe partiellement son logement'),
            ('proprietaire_non_occupant', 'Propriétaire Non-Occupant Simple', 
             'Propriétaire qui loue son logement non meublé'),
            ('proprietaire_non_occupant_meuble', 'Propriétaire Non-Occupant Meublé', 
             'Propriétaire qui loue son logement meublé'),
            ('locataire_meuble', 'Location Meublée',
             'Location d\'un logement meublé'),
            ('locataire', 'Location Totale',
             'Location d\'un logement non meublé'),
            ('locataire_partiel', 'Location Partielle',
             'Location partielle avec capital RVT'),
            ('logement_fonction', 'Logement de Fonction', 
             'Logement fourni par l\'employeur/administration'),
        ]

        for code, libelle, description in usages:
            UsageHabitation.objects.get_or_create(
                code=code,
                defaults={'libelle': libelle, 'description': description}
            )

    def create_sous_garanties_std(self):
        """Crée les 19 sous-garanties dans la table stdsousgarantie"""
        from configuration_api.models import SousGarantie
        
        # Mapping : (code_5_char, libelle, ordre)
        sous_garanties_std = [
            ('1301', 'Incendie', 1),
            ('15005', 'Dégât des Eaux', 2),
            ('40002', 'Explosion', 3),
            ('14007', 'Catastrophes Naturelles', 4),
            ('14001', 'Tempête, Ouragans, Cyclones', 5),
            ('50001', 'Vol', 6),
            ('11002', 'Dommages Matériels', 7),
            ('1311', 'Risques Locatifs', 8),
            ('10012', 'RC Bâtiment', 9),
            ('10101', 'RC Privée', 10),
            ('10013', 'RC Membre', 11),
            ('30003', 'Bris de Glaces', 12),
            ('90001', 'Dommages Électriques', 13),
            ('11001', 'Tous Risques Électriques', 14),
            ('50007', 'Objets de Valeur', 15),
            ('70021', 'Assistance 24/7', 16),
            ('70036', 'Frais Séjour/Voyage', 17),
            ('12001', 'Denrée', 18),
            ('70031', 'Loisirs', 19),
        ]

        for code, libelle, ordre in sous_garanties_std:
            sous_garantie, created = SousGarantie.objects.get_or_create(
                CodeSousGarantie=code,
                defaults={
                    'LibelleSousGarantie': libelle,
                    'Active': True,
                    'Ordre': ordre,
                    'SaisieAuto': False,
                    'SaisieRd': False,
                    'SaisieSante': False,
                    'SaisieTransport': False,
                }
            )
            if created:
                self.stdout.write(self.style.SUCCESS(f'  ✓ Garantie stdsousgarantie créée: {code}'))

    def create_garanties_mrh(self):
        """Crée les 19 sous-garanties MRH avec mapping vers stdsousgarantie"""
        from configuration_api.models import SousGarantieMRH, SousGarantie
        
        # Mapping : (code_mrh, code_std, libelle, type, description)
        sous_garanties_mapping = [
            # Obligatoires (10)
            ('INCENDIE', '1301', 'Incendie', 'OBLIGATOIRE', 'Garantie contre les dommages causés par le feu'),
            ('DEGAT_EAUX', '15005', 'Dégât des Eaux', 'OBLIGATOIRE', 'Garantie contre les dégâts des eaux'),
            ('EXPLOSION', '40002', 'Explosion', 'OBLIGATOIRE', 'Garantie contre les explosions'),
            ('CATASTROPHES_NATURELLES', '14007', 'Catastrophes Naturelles', 'OBLIGATOIRE', 'Garantie catastrophes naturelles'),
            ('TOC', '14001', 'Tempête, Ouragans, Cyclones', 'OBLIGATOIRE', 'Garantie TOC'),
            ('VOL', '50001', 'Vol', 'OBLIGATOIRE', 'Garantie contre le vol'),
            ('DOMMAGES_MATERIELS', '11002', 'Dommages Matériels', 'OBLIGATOIRE', 'Garantie dommages matériels'),
            ('RISQUES_LOCATIFS', '1311', 'Risques Locatifs', 'OBLIGATOIRE', 'Garantie risques locatifs'),
            ('RC_BATIMENT', '10012', 'RC Bâtiment', 'OBLIGATOIRE', 'RC propriétaire'),
            ('RC_PRIVEE', '10101', 'RC Privée', 'OBLIGATOIRE', 'RC vie privée'),
            
            # Optionnelles (9)
            ('RC_MEMBRE', '10013', 'RC Membre', 'OPTIONNELLE', 'RC membres du foyer'),
            ('BRIS_GLACES', '30003', 'Bris de Glaces', 'OPTIONNELLE', 'Garantie bris de glaces'),
            ('DOMMAGES_ELECTRIQUES', '90001', 'Dommages Électriques', 'OPTIONNELLE', 'Dommages électriques'),
            ('TOUS_RISQUES_ELECTRIQUES', '11001', 'Tous Risques Électriques', 'OPTIONNELLE', 'Tous risques électriques'),
            ('OBJETS_VALEUR', '50007', 'Objets de Valeur', 'OPTIONNELLE', 'Objets de valeur'),
            ('ASSISTANCE', '70021', 'Assistance 24/7', 'OPTIONNELLE', 'Assistance'),
            ('FRAIS_SEJOUR_VOYAGE', '70036', 'Frais Séjour/Voyage', 'OPTIONNELLE', 'Frais séjour et voyage'),
            ('DENREE', '12001', 'Denrée', 'OPTIONNELLE', 'Denrées alimentaires'),
            ('LOISIRS', '70031', 'Loisirs', 'OPTIONNELLE', 'Équipements de loisirs'),
        ]

        for code_mrh, code_std, libelle, type_gar, description in sous_garanties_mapping:
            # Récupérer la garantie stdsousgarantie
            try:
                sous_garantie_std = SousGarantie.objects.get(CodeSousGarantie=code_std)
            except SousGarantie.DoesNotExist:
                self.stdout.write(self.style.WARNING(f'  ⚠ SousGarantie stdsousgarantie non trouvée: {code_std}'))
                sous_garantie_std = None
            
            # Créer la sous-garantie MRH avec lien
            sous_garantie_mrh, created = SousGarantieMRH.objects.get_or_create(
                code=code_mrh,
                defaults={
                    'libelle': libelle,
                    'type': type_gar,
                    'description': description,
                    'sous_garantie_std': sous_garantie_std
                }
            )
            
            if created:
                link_info = f' → {code_std}' if sous_garantie_std else ' (sans lien)'
                self.stdout.write(self.style.SUCCESS(f'  ✓ Sous-Garantie MRH créée: {code_mrh}{link_info}'))

    def create_parametres_calcul(self):
        """Crée les paramètres de calcul pour chaque usage"""
        from configuration_api.models import ParametresCalcul, UsageHabitation
        
        parametres = [
            # (code_usage, coeff_batiment, coeff_contenu, coeff_loyer, coeff_rvt, coeff_reduction, forfait, 
            #  bat_requis, cont_requis, loyer_requis, rvt_requis, formule)
            ('proprietaire_occupant_total', 0.001, 0.011, None, None, 0.95, 0,
             True, True, False, False, '(Valeur bâtiment × 1‰ + Valeur contenu × 11‰) × 0,95'),
            
            ('proprietaire_occupant_partiel', 0.001, 0.011, None, None, 0.90, 0,
             True, True, False, False, '(Valeur bâtiment × 1‰ + Valeur contenu × 11‰) × 0,90'),
            
            ('proprietaire_non_occupant', 0.00225, None, None, None, 1.0, 0,
             True, False, False, False, 'Valeur bâtiment × 2,25‰'),
            
            ('proprietaire_non_occupant_meuble', 0.00225, 0.011, None, None, 0.90, 0,
             True, True, False, False, '(Valeur bâtiment × 2,25‰ + Valeur contenu × 11‰) × 0,90'),
            
            ('locataire_meuble', None, 0.011, 0.000075, None, 0.90, 0,
             False, True, True, False, '(Loyer × 12 × 15 × 0,75‰ + Valeur contenu × 11‰) × 0,90'),
            
            ('locataire', None, 0.011, 0.000075, None, 1.0, 0,
             False, True, True, False, 'Loyer × 12 × 15 × 0,75‰ + Valeur contenu × 11‰'),
            
            ('locataire_partiel', None, 0.011, 0.000075, 0.0002, 1.0, 0,
             False, True, True, True, 'Loyer × 12 × 15 × 0,75‰ + Capital RVT × 0,20‰ + Valeur contenu × 11‰'),
            
            ('logement_fonction', None, 0.0095, None, None, 0.95, 11000,
             False, True, False, False, '(Valeur contenu × 9,5‰ + 11 000) × 0,95'),
        ]

        for params in parametres:
            usage = UsageHabitation.objects.get(code=params[0])
            ParametresCalcul.objects.get_or_create(
                usage=usage,
                defaults={
                    'coeff_valeur_batiment': params[1],
                    'coeff_valeur_contenu': params[2],
                    'coeff_loyer': params[3],
                    'coeff_capital_rvt': params[4],
                    'coeff_reduction': params[5],
                    'forfait_fixe': params[6],
                    'param_valeur_batiment_requis': params[7],
                    'param_valeur_contenu_requis': params[8],
                    'param_loyer_requis': params[9],
                    'param_capital_rvt_requis': params[10],
                    'formule_texte': params[11],
                }
            )

    def create_garantie_usage(self):
        """Crée le mapping sous-garanties ↔ usages avec taux de répartition"""
        from configuration_api.models import SousGarantieUsage, UsageHabitation, SousGarantieMRH
        
        # Ce code est long - voir le fichier précédent populate_mrh.py pour les données complètes
        # Voici juste un exemple pour Propriétaire Occupant Total
        
        mappings = [
            # Propriétaire Occupant Total (8 garanties + 4 optionnelles)
            ('proprietaire_occupant_total', 'INCENDIE', True, 25.00, 1),
            ('proprietaire_occupant_total', 'DEGAT_EAUX', True, 15.00, 2),
            ('proprietaire_occupant_total', 'DOMMAGES_ELECTRIQUES', True, 10.00, 3),
            ('proprietaire_occupant_total', 'FRAIS_SEJOUR_VOYAGE', True, 1.00, 4),
            ('proprietaire_occupant_total', 'TOC', True, 5.00, 5),
            ('proprietaire_occupant_total', 'VOL', True, 35.00, 6),
            ('proprietaire_occupant_total', 'BRIS_GLACES', True, 4.00, 7),
            ('proprietaire_occupant_total', 'RC_PRIVEE', True, 5.00, 8),
            ('proprietaire_occupant_total', 'RC_MEMBRE', False, None, 9),
            ('proprietaire_occupant_total', 'DENREE', False, None, 10),
            ('proprietaire_occupant_total', 'LOISIRS', False, None, 11),
            ('proprietaire_occupant_total', 'TOUS_RISQUES_ELECTRIQUES', False, None, 12),
            
            # Propriétaire Occupant Partiel (identique à Total)
            ('proprietaire_occupant_partiel', 'INCENDIE', True, 25.00, 1),
            ('proprietaire_occupant_partiel', 'DEGAT_EAUX', True, 15.00, 2),
            ('proprietaire_occupant_partiel', 'DOMMAGES_ELECTRIQUES', True, 10.00, 3),
            ('proprietaire_occupant_partiel', 'FRAIS_SEJOUR_VOYAGE', True, 1.00, 4),
            ('proprietaire_occupant_partiel', 'TOC', True, 5.00, 5),
            ('proprietaire_occupant_partiel', 'VOL', True, 35.00, 6),
            ('proprietaire_occupant_partiel', 'BRIS_GLACES', True, 4.00, 7),
            ('proprietaire_occupant_partiel', 'RC_PRIVEE', True, 5.00, 8),
            ('proprietaire_occupant_partiel', 'RC_MEMBRE', False, None, 9),
            ('proprietaire_occupant_partiel', 'DENREE', False, None, 10),
            ('proprietaire_occupant_partiel', 'LOISIRS', False, None, 11),
            ('proprietaire_occupant_partiel', 'TOUS_RISQUES_ELECTRIQUES', False, None, 12),
            
            # Propriétaire Non-Occupant Simple (5 garanties)
            ('proprietaire_non_occupant', 'INCENDIE', True, 40.00, 1),
            ('proprietaire_non_occupant', 'TOC', True, 10.00, 2),
            ('proprietaire_non_occupant', 'DEGAT_EAUX', True, 29.00, 3),
            ('proprietaire_non_occupant', 'BRIS_GLACES', True, 7.00, 4),
            ('proprietaire_non_occupant', 'RC_BATIMENT', True, 14.00, 5),
            
            # Propriétaire Non-Occupant Meublé (7 garanties)
            ('proprietaire_non_occupant_meuble', 'INCENDIE', True, 40.00, 1),
            ('proprietaire_non_occupant_meuble', 'TOC', True, 5.00, 2),
            ('proprietaire_non_occupant_meuble', 'DEGAT_EAUX', True, 11.00, 3),
            ('proprietaire_non_occupant_meuble', 'VOL', True, 20.00, 4),
            ('proprietaire_non_occupant_meuble', 'BRIS_GLACES', True, 5.00, 5),
            ('proprietaire_non_occupant_meuble', 'DOMMAGES_ELECTRIQUES', True, 5.00, 6),
            ('proprietaire_non_occupant_meuble', 'RC_BATIMENT', True, 14.00, 7),
            
            # Locataire Meublé (8 garanties + 4 optionnelles)
            ('locataire_meuble', 'INCENDIE', True, 25.00, 1),
            ('locataire_meuble', 'TOC', True, 5.00, 2),
            ('locataire_meuble', 'DEGAT_EAUX', True, 15.00, 3),
            ('locataire_meuble', 'VOL', True, 35.00, 4),
            ('locataire_meuble', 'BRIS_GLACES', True, 4.00, 5),
            ('locataire_meuble', 'DOMMAGES_ELECTRIQUES', True, 10.00, 6),
            ('locataire_meuble', 'RC_PRIVEE', True, 5.00, 7),
            ('locataire_meuble', 'FRAIS_SEJOUR_VOYAGE', True, 1.00, 8),
            ('locataire_meuble', 'RC_MEMBRE', False, None, 9),
            ('locataire_meuble', 'DENREE', False, None, 10),
            ('locataire_meuble', 'LOISIRS', False, None, 11),
            ('locataire_meuble', 'TOUS_RISQUES_ELECTRIQUES', False, None, 12),
            
            # Locataire Total (identique à Locataire Meublé)
            ('locataire', 'INCENDIE', True, 25.00, 1),
            ('locataire', 'TOC', True, 5.00, 2),
            ('locataire', 'DEGAT_EAUX', True, 15.00, 3),
            ('locataire', 'VOL', True, 35.00, 4),
            ('locataire', 'BRIS_GLACES', True, 4.00, 5),
            ('locataire', 'DOMMAGES_ELECTRIQUES', True, 10.00, 6),
            ('locataire', 'RC_PRIVEE', True, 5.00, 7),
            ('locataire', 'FRAIS_SEJOUR_VOYAGE', True, 1.00, 8),
            ('locataire', 'RC_MEMBRE', False, None, 9),
            ('locataire', 'DENREE', False, None, 10),
            ('locataire', 'LOISIRS', False, None, 11),
            ('locataire', 'TOUS_RISQUES_ELECTRIQUES', False, None, 12),
            
            # Locataire Partiel (identique à Locataire Meublé)
            ('locataire_partiel', 'INCENDIE', True, 25.00, 1),
            ('locataire_partiel', 'TOC', True, 5.00, 2),
            ('locataire_partiel', 'DEGAT_EAUX', True, 15.00, 3),
            ('locataire_partiel', 'VOL', True, 35.00, 4),
            ('locataire_partiel', 'BRIS_GLACES', True, 4.00, 5),
            ('locataire_partiel', 'DOMMAGES_ELECTRIQUES', True, 10.00, 6),
            ('locataire_partiel', 'RC_PRIVEE', True, 5.00, 7),
            ('locataire_partiel', 'FRAIS_SEJOUR_VOYAGE', True, 1.00, 8),
            ('locataire_partiel', 'RC_MEMBRE', False, None, 9),
            ('locataire_partiel', 'DENREE', False, None, 10),
            ('locataire_partiel', 'LOISIRS', False, None, 11),
            ('locataire_partiel', 'TOUS_RISQUES_ELECTRIQUES', False, None, 12),
            
            # Logement de Fonction (7 garanties, pas de BRIS_GLACES + 4 optionnelles)
            ('logement_fonction', 'INCENDIE', True, 16.00, 1),
            ('logement_fonction', 'TOC', True, 5.00, 2),
            ('logement_fonction', 'DEGAT_EAUX', True, 12.00, 3),
            ('logement_fonction', 'VOL', True, 45.00, 4),
            ('logement_fonction', 'DOMMAGES_ELECTRIQUES', True, 10.00, 5),
            ('logement_fonction', 'RC_PRIVEE', True, 9.00, 6),
            ('logement_fonction', 'FRAIS_SEJOUR_VOYAGE', True, 3.00, 7),
            ('logement_fonction', 'RC_MEMBRE', False, None, 8),
            ('logement_fonction', 'DENREE', False, None, 9),
            ('logement_fonction', 'LOISIRS', False, None, 10),
            ('logement_fonction', 'TOUS_RISQUES_ELECTRIQUES', False, None, 11),        ]

        for code_usage, code_sous_garantie, oblig, taux, ordre in mappings:
            usage = UsageHabitation.objects.get(code=code_usage)
            sous_garantie = SousGarantieMRH.objects.get(code=code_sous_garantie)
            
            SousGarantieUsage.objects.get_or_create(
                usage=usage,
                sous_garantie=sous_garantie,
                defaults={
                    'obligatoire': oblig,
                    'taux_repartition': taux,
                    'ordre_affichage': ordre
                }
            )

    def create_options(self):
        """Crée les options générales et spécifiques"""
        from configuration_api.models import Option, SousGarantieMRH
        
        # (code, libelle, description, type_option, type_ajustement, code_sous_garantie, taux, montant, signe)
        options = [
            # Options générales
            ('presence_gardien', 'Présence gardien', 'Réduction si gardien',
             'GENERALE', 'TYPE2', 'VOL', 10.00, None, '-'),
            ('protection_mecanique', 'Protection mécanique', 'Réduction si protection',
             'GENERALE', 'TYPE2', 'VOL', 10.00, None, '-'),
            ('presence_extincteur', 'Présence extincteur', 'Réduction si extincteur',
             'GENERALE', 'TYPE2', 'INCENDIE', 10.00, None, '-'),
            
            # Options spécifiques
            ('zone_industrielle', 'Zone industrielle', 'Majoration zone industrielle',
             'SPECIFIQUE', 'TYPE2', 'INCENDIE', 15.00, None, '+'),
            ('extension_residence_secondaire', 'Extension résidence secondaire', 'Extension garantie',
             'SPECIFIQUE', 'FORFAIT', 'RC_PRIVEE', None, 3000.00, '+'),
            ('vehicule_garage', 'Véhicule dans garage', 'Majoration véhicule',
             'SPECIFIQUE', 'TYPE1', 'INCENDIE', 15.00, None, '+'),
            ('voisinage_station', 'Voisinage station service', 'Majoration station',
             'SPECIFIQUE', 'TYPE2', 'INCENDIE', 15.00, None, '+'),
            ('renonciation_recours_locataire_proprio', 'Renonciation recours loc→prop',
             'Clause renonciation', 'SPECIFIQUE', 'TYPE1', 'INCENDIE', 15.00, None, '+'),
            ('extension_piscine', 'Extension piscine', 'Extension RC piscine',
             'SPECIFIQUE', 'TYPE2', 'RC_PRIVEE', 10.00, None, '+'),
            ('inhabitation_60j', 'Inhabitation > 60 jours', 'Majoration inhabitation',
             'SPECIFIQUE', 'TYPE1', 'VOL', 35.00, None, '+'),
            ('renonciation_recours_proprio_locataire', 'Renonciation recours prop→loc',
             'Clause renonciation', 'SPECIFIQUE', 'TYPE2', 'INCENDIE', 25.00, None, '+'),
        ]

        for opt in options:
            sous_garantie = SousGarantieMRH.objects.get(code=opt[5]) if opt[5] else None
            
            Option.objects.get_or_create(
                code=opt[0],
                defaults={
                    'libelle': opt[1],
                    'description': opt[2],
                    'type_option': opt[3],
                    'type_ajustement': opt[4],
                    'sous_garantie_cible': sous_garantie,
                    'taux_ajustement': opt[6],
                    'montant_forfait': opt[7],
                    'signe_ajustement': opt[8],
                }
            )

    def create_option_usage(self):
        """Crée le mapping options ↔ usages"""
        from configuration_api.models import OptionUsage, Option, UsageHabitation
        
        # Mapping : (code_option, code_usage)
        mappings = [
            # Options générales - gardien et protection (usages avec VOL)
            ('presence_gardien', 'proprietaire_occupant_total'),
            ('presence_gardien', 'proprietaire_occupant_partiel'),
            ('presence_gardien', 'proprietaire_non_occupant_meuble'),
            ('presence_gardien', 'locataire_meuble'),
            ('presence_gardien', 'locataire'),
            ('presence_gardien', 'locataire_partiel'),
            ('presence_gardien', 'logement_fonction'),
            
            ('protection_mecanique', 'proprietaire_occupant_total'),
            ('protection_mecanique', 'proprietaire_occupant_partiel'),
            ('protection_mecanique', 'proprietaire_non_occupant_meuble'),
            ('protection_mecanique', 'locataire_meuble'),
            ('protection_mecanique', 'locataire'),
            ('protection_mecanique', 'locataire_partiel'),
            ('protection_mecanique', 'logement_fonction'),
            
            # Option extincteur (tous les usages)
            ('presence_extincteur', 'proprietaire_occupant_total'),
            ('presence_extincteur', 'proprietaire_occupant_partiel'),
            ('presence_extincteur', 'proprietaire_non_occupant'),
            ('presence_extincteur', 'proprietaire_non_occupant_meuble'),
            ('presence_extincteur', 'locataire_meuble'),
            ('presence_extincteur', 'locataire'),
            ('presence_extincteur', 'locataire_partiel'),
            ('presence_extincteur', 'logement_fonction'),
            
            # Options spécifiques
            ('zone_industrielle', 'proprietaire_occupant_total'),
            ('zone_industrielle', 'proprietaire_occupant_partiel'),
            ('extension_residence_secondaire', 'proprietaire_occupant_total'),
            ('extension_residence_secondaire', 'proprietaire_occupant_partiel'),
            ('vehicule_garage', 'locataire_meuble'),
            ('voisinage_station', 'locataire_meuble'),
            ('renonciation_recours_locataire_proprio', 'locataire'),
            ('extension_piscine', 'locataire_partiel'),
            ('inhabitation_60j', 'logement_fonction'),
            ('renonciation_recours_proprio_locataire', 'proprietaire_non_occupant'),
        ]

        for code_option, code_usage in mappings:
            option = Option.objects.get(code=code_option)
            usage = UsageHabitation.objects.get(code=code_usage)
            
            OptionUsage.objects.get_or_create(
                option=option,
                usage=usage
            )


    def create_garanties_forfait(self):
        """Crée les garanties optionnelles à forfait"""
        from configuration_api.models import SousGarantieForfait, SousGarantieMRH
        
        forfaits = [
            ('RC_MEMBRE', 7000.00, 'RC Membre - Prime forfaitaire'),
            ('DENREE', 5000.00, 'Denrées - Prime forfaitaire'),
            ('LOISIRS', 13500.00, 'Loisirs - Prime forfaitaire'),
            ('TOUS_RISQUES_ELECTRIQUES', 20000.00, 'TRE - Prime forfaitaire'),
        ]

        for code_sous_garantie, prime, desc in forfaits:
            sous_garantie = SousGarantieMRH.objects.get(code=code_sous_garantie)
            
            SousGarantieForfait.objects.get_or_create(
                sous_garantie=sous_garantie,
                defaults={'prime_nette': prime, 'description': desc}
            )

    def create_cles_repartition(self):
        """Crée les clés de répartition pour le mode imposé"""
        from configuration_api.models import CleRepartition, UsageHabitation, SousGarantieMRH
        
        # Pour chaque usage, on utilise les mêmes taux que les garanties obligatoires
        # Tous en groupe 2 (POURCENTAGE)
        
        usages_cles = [
            ('proprietaire_occupant_total', [
                ('INCENDIE', 25.00, 1), ('DEGAT_EAUX', 15.00, 2), ('DOMMAGES_ELECTRIQUES', 10.00, 3),
                ('FRAIS_SEJOUR_VOYAGE', 1.00, 4), ('TOC', 5.00, 5), ('VOL', 35.00, 6),
                ('BRIS_GLACES', 4.00, 7), ('RC_PRIVEE', 5.00, 8)
            ]),
            ('proprietaire_occupant_partiel', [
                ('INCENDIE', 25.00, 1), ('DEGAT_EAUX', 15.00, 2), ('DOMMAGES_ELECTRIQUES', 10.00, 3),
                ('FRAIS_SEJOUR_VOYAGE', 1.00, 4), ('TOC', 5.00, 5), ('VOL', 35.00, 6),
                ('BRIS_GLACES', 4.00, 7), ('RC_PRIVEE', 5.00, 8)
            ]),
            ('proprietaire_non_occupant', [
                ('INCENDIE', 40.00, 1), ('TOC', 10.00, 2), ('DEGAT_EAUX', 29.00, 3),
                ('BRIS_GLACES', 7.00, 4), ('RC_BATIMENT', 14.00, 5)
            ]),
            ('proprietaire_non_occupant_meuble', [
                ('INCENDIE', 40.00, 1), ('TOC', 5.00, 2), ('DEGAT_EAUX', 11.00, 3),
                ('VOL', 20.00, 4), ('BRIS_GLACES', 5.00, 5), ('DOMMAGES_ELECTRIQUES', 5.00, 6),
                ('RC_BATIMENT', 14.00, 7)
            ]),
            ('locataire_meuble', [
                ('INCENDIE', 25.00, 1), ('TOC', 5.00, 2), ('DEGAT_EAUX', 15.00, 3),
                ('VOL', 35.00, 4), ('BRIS_GLACES', 4.00, 5), ('DOMMAGES_ELECTRIQUES', 10.00, 6),
                ('RC_PRIVEE', 5.00, 7), ('FRAIS_SEJOUR_VOYAGE', 1.00, 8)
            ]),
            ('locataire', [
                ('INCENDIE', 25.00, 1), ('TOC', 5.00, 2), ('DEGAT_EAUX', 15.00, 3),
                ('VOL', 35.00, 4), ('BRIS_GLACES', 4.00, 5), ('DOMMAGES_ELECTRIQUES', 10.00, 6),
                ('RC_PRIVEE', 5.00, 7), ('FRAIS_SEJOUR_VOYAGE', 1.00, 8)
            ]),
            ('locataire_partiel', [
                ('INCENDIE', 25.00, 1), ('TOC', 5.00, 2), ('DEGAT_EAUX', 15.00, 3),
                ('VOL', 35.00, 4), ('BRIS_GLACES', 4.00, 5), ('DOMMAGES_ELECTRIQUES', 10.00, 6),
                ('RC_PRIVEE', 5.00, 7), ('FRAIS_SEJOUR_VOYAGE', 1.00, 8)
            ]),
            ('logement_fonction', [
                ('INCENDIE', 16.00, 1), ('TOC', 5.00, 2), ('DEGAT_EAUX', 12.00, 3),
                ('VOL', 45.00, 4), ('DOMMAGES_ELECTRIQUES', 10.00, 5),
                ('RC_PRIVEE', 9.00, 6), ('FRAIS_SEJOUR_VOYAGE', 3.00, 7)
            ]),
        ]

        for code_usage, sous_garanties in usages_cles:
            usage = UsageHabitation.objects.get(code=code_usage)
            
            for code_sous_garantie, taux, ordre in sous_garanties:
                sous_garantie = SousGarantieMRH.objects.get(code=code_sous_garantie)
                
                CleRepartition.objects.get_or_create(
                    usage=usage,
                    sous_garantie=sous_garantie,
                    defaults={
                        'type_repartition': 'POURCENTAGE',
                        'taux_pourcentage': taux,
                        'groupe': 2,
                        'ordre_calcul': ordre
                    }
                )