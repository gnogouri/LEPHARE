/**
 * LE PHARE - Repository Central de Persistance & Synchronisation des Données
 * 
 * Ce magasin garantit que toute création, modification ou conversion d'entité
 * (Devis, Contrats, Clients, Sinistres, Encaissements, Reversements, Catalogue, Paramétrages)
 * est instantanément sauvegardée dans le localStorage et propagée en temps réel
 * à travers toute l'application via un bus d'évènements réactif.
 */

import {
  mockClients,
  mockQuotes,
  mockContracts,
  mockClaims,
  mockConventions,
  mockDerogations,
  mockUsers,
  mockLeads,
} from './mockData.js';
import { estSolde, resteAEncaisser } from '../utils/resteEncaissement';

const STORAGE_KEYS = {
  CLIENTS: 'uranus_clients',
  QUOTES: 'uranus_quotes',
  CONTRACTS: 'uranus_contracts',
  CLAIMS: 'uranus_claims',
  QUITTANCES: 'uranus_quittances',
  REMITTANCES: 'uranus_remittances',
  PRODUCTS: 'uranus_products',
  GUARANTEES: 'uranus_guarantees',
  TARIFS: 'uranus_tarifs',
  COMPANIES: 'uranus_companies',
  VEHICLES: 'uranus_vehicles',
  GEOZONES: 'uranus_geozones',
  VOYAGE_ZONES: 'uranus_voyage_zones',
  VOYAGE_FORMULES: 'uranus_voyage_formules',
  TRANSPORT_MODES: 'uranus_transport_modes',
  TRANSPORT_NATURES: 'uranus_transport_natures',
  CONVENTIONS: 'uranus_conventions',
  DEROGATIONS: 'uranus_derogations',
  USERS: 'uranus_users',
  ENDORSEMENTS: 'uranus_endorsements',
  COMMISSIONS: 'uranus_commissions',
  LEADS: 'uranus_leads',
};

// Default initial data for catalog and settings if localStorage is empty
const INITIAL_PRODUCTS = [
  { id: 1, branche: 'Automobile', code_produit: 'AUTO-VP', nom: 'Automobile Véhicules Particuliers', type_gestion: 'Individuel', nb_garanties: 8, statut: 'Actif' },
  { id: 2, branche: 'Automobile', code_produit: 'AUTO-FLOTTE', nom: 'Flotte Automobile Entreprise', type_gestion: 'Collectif', nb_garanties: 10, statut: 'Actif' },
  { id: 3, branche: 'Incendie & Risques Divers', code_produit: 'MRH-HAB', nom: 'Multi-Risques Habitation', type_gestion: 'Individuel', nb_garanties: 6, statut: 'Actif' },
  { id: 4, branche: 'Santé & Maladie', code_produit: 'SANTE-GRP', nom: 'Santé Entreprise Groupe', type_gestion: 'Collectif', nb_garanties: 14, statut: 'Actif' },
  { id: 5, branche: 'Accidents Corporels', code_produit: 'IA-INDIV', nom: 'Individuelle Accident Standard', type_gestion: 'Individuel', nb_garanties: 4, statut: 'Actif' },
  { id: 6, branche: 'Voyage', code_produit: 'VOY-SCHENGEN', nom: 'Assistance Voyage Monde & Schengen', type_gestion: 'Individuel', nb_garanties: 5, statut: 'Actif' },
  { id: 7, branche: 'Responsabilité Civile', code_produit: 'RC-CHEF', nom: 'RC Chef de Famille & Exploitation', type_gestion: 'Mixte', nb_garanties: 3, statut: 'Actif' },
  { id: 8, branche: 'Transport', code_produit: 'TRP-FACULTES', nom: 'Facultés à l’Importation & Transit Maritime', type_gestion: 'Mixte', nb_garanties: 6, statut: 'Actif' },
];

const INITIAL_GUARANTEES = [
  { id: 1, code: 'RC_AUTO', libelle: 'RESPONSABILITE CIVILE AUTOMOBILE', branche: 'Automobile', type: 'Obligatoire CIMA', tarification: 'Barème Puissance & Zone', taxe_cima: '14.5%', fga: true, active: true },
  { id: 2, code: 'DEF_REC', libelle: 'DEFENSE ET RECOURS DES TIERS', branche: 'Automobile', type: 'Complémentaire', tarification: 'Forfait Annuel', taxe_cima: '14.5%', fga: false, active: true },
  { id: 3, code: 'DOMM_ACC', libelle: 'DOMMAGES TOUS ACCIDENTS (TIERCE COLLISION)', branche: 'Automobile', type: 'Optionnelle', tarification: '% Valeur Vénale / Neuf', taxe_cima: '14.5%', fga: false, active: true },
  { id: 4, code: 'INCENDIE', libelle: 'INCENDIE ET EXPLOSION DU VEHICULE', branche: 'Automobile', type: 'Optionnelle', tarification: '% Valeur Vénale', taxe_cima: '14.5%', fga: false, active: true },
  { id: 5, code: 'VOL_AUTO', libelle: 'VOL ET TENTATIVE DE VOL', branche: 'Automobile', type: 'Optionnelle', tarification: '% Valeur Vénale', taxe_cima: '14.5%', fga: false, active: true },
  { id: 6, code: 'BRIS_GLACES', libelle: 'BRIS DE GLACES (PARE-BRISE & VITRES)', branche: 'Automobile', type: 'Optionnelle', tarification: 'Forfait / Plafond', taxe_cima: '14.5%', fga: false, active: true },
  { id: 7, code: 'SEC_ROUTIERE', libelle: 'SECURITE ROUTIERE PERSONNES TRANSPORTEES', branche: 'Automobile', type: 'Optionnelle', tarification: 'Par Place Assurée', taxe_cima: '14.5%', fga: false, active: true },
  { id: 8, code: 'ASSIST_247', libelle: 'ASSISTANCE AUTOMOBILE 24H/24 ET REMORQUAGE', branche: 'Automobile', type: 'Pack Assistance', tarification: 'Forfait Compagnie', taxe_cima: '14.5%', fga: false, active: true },
  { id: 9, code: 'MRH_INCENDIE', libelle: 'INCENDIE DU BATIMENT ET RISQUES LOCATIFS', branche: 'Habitation MRH', type: 'Base Contractuelle', tarification: '% Valeur Bâtiment', taxe_cima: '14.5%', fga: false, active: true },
  { id: 10, code: 'MRH_DEGAT_EAUX', libelle: 'DEGAT DES EAUX ET INFILTRATIONS', branche: 'Habitation MRH', type: 'Complémentaire', tarification: '% Valeur Contenu', taxe_cima: '14.5%', fga: false, active: true },
  { id: 11, code: 'MRH_VOL_MOB', libelle: 'VOL MATERIELS ET MOBILIERS DOMESTIQUES', branche: 'Habitation MRH', type: 'Optionnelle', tarification: '% Valeur Contenu', taxe_cima: '14.5%', fga: false, active: true },
  { id: 12, code: 'MRH_RC_VIE_PRIVEE', libelle: 'RESPONSABILITE CIVILE VIE PRIVEE / CHEF DE FAMILLE', branche: 'Habitation MRH', type: 'Inclus d\'office', tarification: 'Forfait Annuel', taxe_cima: '14.5%', fga: false, active: true },
  { id: 13, code: 'SANTE_CONSULT', libelle: 'SOINS COURANTS, CONSULTATIONS ET PHARMACIE', branche: 'Santé Groupe', type: 'Panier Base', tarification: 'Taux 70% à 100%', taxe_cima: '0.0%', fga: false, active: true },
  { id: 14, code: 'SANTE_HOSPIT', libelle: 'HOSPITALISATION MEDICALE ET CHIRURGICALE', branche: 'Santé Groupe', type: 'Majeur', tarification: 'Plafond Annuel Affilié', taxe_cima: '0.0%', fga: false, active: true },
  { id: 15, code: 'IA_DECES_ACC', libelle: 'CAPITAL DECES SUITE A ACCIDENT', branche: 'Individuelle Accident', type: 'Garantie Principale', tarification: 'Taux sur Capital Assuré', taxe_cima: '14.5%', fga: false, active: true },
  { id: 16, code: 'IA_INVALIDITE', libelle: 'INVALIDITE PERMANENTE TOTALE OU PARTIELLE (IPT)', branche: 'Individuelle Accident', type: 'Garantie Principale', tarification: 'Barème d\'Incapacité', taxe_cima: '14.5%', fga: false, active: true },
  { id: 17, code: 'VOY_MEDIC', libelle: 'FRAIS MEDICAUX & HOSPITALISATION D\'URGENCE A L\'ETRANGER', branche: 'Voyage', type: 'Obligatoire Schengen (30 000 €)', tarification: 'Forfait Durée & Zone', taxe_cima: '14.5%', fga: false, active: true },
  { id: 18, code: 'VOY_RAPAT', libelle: 'RAPATRIEMENT SANITAIRE & RETOUR DE CORPS', branche: 'Voyage', type: 'Garantie de Base', tarification: 'Frais Réels 100%', taxe_cima: '14.5%', fga: false, active: true },
  { id: 19, code: 'VOY_BAGAGES', libelle: 'PERTE, VOL ET DETERIORATION DE BAGAGES ENREGISTRES', branche: 'Voyage', type: 'Complémentaire', tarification: 'Plafond Forfaitaire', taxe_cima: '14.5%', fga: false, active: true },
  { id: 20, code: 'TRP_TOUS_RISQUES', libelle: 'PERTE ET DOMMAGES TOUS RISQUES FACULTES MARITIMES/AERIENNES', branche: 'Transport', type: 'Tous Risques Magasin à Magasin', tarification: 'Taux Ad Valorem CAF +10%', taxe_cima: '14.5%', fga: false, active: true },
  { id: 21, code: 'TRP_FAP_SAUF', libelle: 'AVARIES COMMUNES & ACCIDENTS MAJEURS DE TRANSPORT (FAP SAUF)', branche: 'Transport', type: 'Événements Majeurs', tarification: 'Taux Réduit CIMA', taxe_cima: '14.5%', fga: false, active: true },
  { id: 22, code: 'TRP_GUERRE_GREVES', libelle: 'RISQUES DE GUERRE, MINES, GREVES & EMEUTES (SRCC)', branche: 'Transport', type: 'Clause Additionnelle Spéciale', tarification: 'Surprime Réglementaire CIMA', taxe_cima: '14.5%', fga: false, active: true },
];

const INITIAL_TARIFS = [
  { id: 1, libelle: 'Tarif Réglementé Auto CIMA 2024-2026', produit: 'Automobile VP', taux_taxe: '14.5%', frais_accessoires: '15 000 FCFA', date_effet: '2024-01-01', statut: 'Vigueur', base_calcul: 'Zone 1 & 2 / Puissance Fiscale 1 à 12+ CV' },
  { id: 2, libelle: 'Tarif Flotte Entreprise Dégressif', produit: 'Auto Flotte', taux_taxe: '14.5%', frais_accessoires: '50 000 FCFA', date_effet: '2024-01-01', statut: 'Vigueur', base_calcul: 'Bonus dégressif de 5 à 20+ véhicules' },
  { id: 3, libelle: 'Barème Habitation Villa & Appartement', produit: 'MRH', taux_taxe: '14.5%', frais_accessoires: '10 000 FCFA', date_effet: '2024-01-01', statut: 'Vigueur', base_calcul: 'Taux 0.15% valeur bâtiment + 0.35% contenu' },
  { id: 4, libelle: 'Grille Santé Forfaitaire Entreprise', produit: 'Santé Groupe', taux_taxe: '0.0% (Exonéré)', frais_accessoires: '75 000 FCFA', date_effet: '2024-01-01', statut: 'Vigueur', base_calcul: 'Collèges Cadres & Employés (70% - 100%)' },
  { id: 5, libelle: 'Barème Individuelle Accident Salarié', produit: 'IA Standard', taux_taxe: '14.5%', frais_accessoires: '5 000 FCFA', date_effet: '2024-01-01', statut: 'Vigueur', base_calcul: 'Barème CIMA Décès 1.2% / IPT 1.5%' },
  { id: 6, libelle: 'Tarif Assistance Voyage Schengen & Monde', produit: 'Voyage & Schengen', taux_taxe: '14.5%', frais_accessoires: '5 000 FCFA', date_effet: '2024-01-01', statut: 'Vigueur', base_calcul: 'Durée de séjour + Zone géographique' },
  { id: 7, libelle: 'Barème Transport Facultés Maritimes & Aériennes', produit: 'Transport Facultés', taux_taxe: '14.5%', frais_accessoires: '10 000 FCFA', date_effet: '2024-01-01', statut: 'Vigueur', base_calcul: 'Taux ad valorem sur valeur CAF majorée de 10%' },
];

const INITIAL_COMPANIES = [
  { id: 1, code: 'NSIA', nom: 'NSIA Assurances Côte d’Ivoire', code_asaci: 'ASACI_NSIA', telephone: '+225 27 20 31 98 00', email: 'service.client@groupensia.com', branches: 'Auto, Santé, MRH, IA, Transport, Voyage', statut: 'Partenaire Actif' },
  { id: 2, code: 'SUNU', nom: 'SUNU Assurances IARD CI', code_asaci: 'ASACI_SUNU', telephone: '+225 27 20 25 18 18', email: 'cotedivoire.iard@sunu-group.com', branches: 'Auto Flotte, Risques Divers, Caution, Voyage, Transport', statut: 'Partenaire Actif' },
  { id: 3, code: 'SANLAM', nom: 'SANLAM Assurance Côte d’Ivoire', code_asaci: 'ASACI_SANLAM', telephone: '+225 27 20 24 24 24', email: 'contact@ci.sanlam.com', branches: 'Auto, MRH, Incendie, Transport, Voyage', statut: 'Partenaire Actif' },
  { id: 4, code: 'ALLIANZ', nom: 'ALLIANZ Côte d’Ivoire Assurances', code_asaci: 'ASACI_ALLIANZ', telephone: '+225 27 20 25 66 00', email: 'info.ci@allianz.com', branches: 'Santé Groupe, Multirisque Pro, Transport, Voyage', statut: 'Partenaire Actif' },
  { id: 5, code: 'ATLANTIQUE', nom: 'ATLANTIQUE ASSURANCES CI', code_asaci: 'ASACI_ATL', telephone: '+225 27 20 25 90 90', email: 'info@atlantiqueassurances.ci', branches: 'Auto, Risques Industriels, Caution, IA', statut: 'Partenaire Actif' },
  { id: 6, code: 'AXA', nom: 'AXA Assurances Côte d’Ivoire', code_asaci: 'ASACI_AXA', telephone: '+225 27 20 31 82 00', email: 'contact@axa.ci', branches: 'Voyage, Transport, Auto, Santé, MRH', statut: 'Partenaire Actif' },
];

const INITIAL_VEHICLES = [
  { id: 1, code: 'VP', libelle: 'Véhicule Particulier (Tourisme)', usage: 'Affaires & Promenade', taux_base: '1.0' },
  { id: 2, code: 'TPC', libelle: 'Transport Public de Voyageurs (Taxi, Gbaka)', usage: 'Commercial Urbain', taux_base: '1.85' },
  { id: 3, code: 'TPM', libelle: 'Transport de Marchandises (Camions, Tracteurs)', usage: 'Fret & Logistique', taux_base: '2.1' },
  { id: 4, code: 'MOTO', libelle: 'Deux & Trois Roues (Motos, Tricycles)', usage: 'Personnel & Livraison', taux_base: '0.75' },
];

const INITIAL_GEOZONES = [
  { id: 1, code: 'CI-ABJ', zone: 'Abidjan & Banlieue (Zone 1)', pays: "Côte d'Ivoire", coefficient_risque: '1.25' },
  { id: 2, code: 'CI-INT', zone: 'Intérieur du Pays (Zone 2)', pays: "Côte d'Ivoire", coefficient_risque: '1.00' },
  { id: 3, code: 'CEDEAO', zone: 'Espace CEDEAO (Carte Brune)', pays: '15 Pays Membres', coefficient_risque: '1.15' },
  { id: 4, code: 'SCHENGEN', zone: 'Espace Schengen / Europe', pays: 'Zone Assistance Voyage', coefficient_risque: '1.50' },
];

const INITIAL_VOYAGE_ZONES = [
  {
    id: 'zone_1',
    code: 'ZONE_1',
    label: 'Zone 1 : Afrique & Zone CIMA',
    description: 'Bénin, Burkina, Cameroun, Centrafrique, Congo, Côte d’Ivoire, Gabon, Mali, Niger, Sénégal, Togo...',
    baseRateMultiplier: 1.0,
    schengenCompliant: false,
  },
  {
    id: 'zone_2',
    code: 'ZONE_2',
    label: 'Zone 2 : Espace Schengen & Europe',
    description: 'France, Allemagne, Italie, Espagne, Belgique, Suisse... (Conforme Obligation Visa 30 000 €)',
    baseRateMultiplier: 1.35,
    schengenCompliant: true,
  },
  {
    id: 'zone_3',
    code: 'ZONE_3',
    label: 'Zone 3 : Monde Entier (Hors USA / Canada)',
    description: 'Asie, Moyen-Orient, Amérique Latine, Océanie (hors États-Unis et Canada)',
    baseRateMultiplier: 1.65,
    schengenCompliant: true,
  },
  {
    id: 'zone_4',
    code: 'ZONE_4',
    label: 'Zone 4 : Monde Entier (Y compris USA, Canada, Japon)',
    description: 'Couverture internationale maximale avec plafonds renforcés pour frais médicaux nord-américains',
    baseRateMultiplier: 2.2,
    schengenCompliant: true,
  },
];

const INITIAL_VOYAGE_FORMULES = [
  {
    id: 'schengen_standard',
    code: 'SCHENGEN_STD',
    nom: 'Formule Schengen Standard',
    description: 'Conforme exigences consulaires Visa Schengen (Art. 15 Code des Visas CE N° 810/2009)',
    plafondMedicalEur: '30 000 € (~19 680 000 FCFA)',
    rapatriement: '100% Frais réels',
    bagages: 'Non inclus',
    rcEtranger: 'Non inclus',
    basePerDay: 2200,
  },
  {
    id: 'confort_voyage',
    code: 'CONFORT_VOY',
    nom: 'Formule Confort Voyage',
    description: 'Couverture complète déplacements professionnels et vacances en famille',
    plafondMedicalEur: '50 000 € (~32 800 000 FCFA)',
    rapatriement: '100% Frais réels',
    bagages: '1 000 000 FCFA (Vol / Perte)',
    rcEtranger: '15 000 000 FCFA',
    basePerDay: 3600,
  },
  {
    id: 'premium_vip',
    code: 'PREMIUM_VIP',
    nom: 'Formule Premium VIP & Business',
    description: 'Plafonds d’élite, assistance juridique internationale et garantie retard de vol',
    plafondMedicalEur: '100 000 € (~65 595 700 FCFA)',
    rapatriement: '100% Frais réels',
    bagages: '2 500 000 FCFA',
    rcEtranger: '30 000 000 FCFA',
    basePerDay: 5800,
  },
];

const INITIAL_TRANSPORT_MODES = [
  {
    id: 'maritime',
    code: 'MARITIME',
    label: 'Transport Maritime (FCL / LCL)',
    description: 'Conteneurs complets, groupage ou vrac par navire porte-conteneurs de ligne régulière',
    baseRate: 0.0028,
  },
  {
    id: 'aerien',
    code: 'AERIEN',
    label: 'Fret Aérien International',
    description: 'Expéditions par avion cargo ou vols commerciaux réguliers',
    baseRate: 0.0022,
  },
  {
    id: 'terrestre',
    code: 'TERRESTRE',
    label: 'Transport Terrestre & Corridors',
    description: 'Camions semi-remorques sous douane, Corridors Abidjan-Ouaga, Abidjan-Bamako',
    baseRate: 0.0035,
  },
  {
    id: 'multimodal',
    code: 'MULTIMODAL',
    label: 'Transport Multimodal Combiné',
    description: 'Maritime + Terrestre pré/post-acheminement jusqu’à destination finale',
    baseRate: 0.0032,
  },
];

const INITIAL_TRANSPORT_NATURES = [
  { id: 'manufactures', code: 'NAT_MANUF', label: 'Marchandises Générales & Biens Manufacturés', riskCoeff: 1.0 },
  { id: 'perissables', code: 'NAT_PERIS', label: 'Denrées Périssables sous Température Dirigée (Reefer)', riskCoeff: 1.35 },
  { id: 'matieres_premieres', code: 'NAT_AGRI', label: 'Matières Premières Agricoles (Cacao, Café, Anacarde, Hévéa)', riskCoeff: 1.15 },
  { id: 'vehicules_engins', code: 'NAT_ENGIN', label: 'Véhicules, Engins Industriels & Matériels BTP', riskCoeff: 1.05 },
  { id: 'chimiques_imo', code: 'NAT_CHIM', label: 'Produits Chimiques & Matières Dangereuses (Classe IMO)', riskCoeff: 1.45 },
  { id: 'electronique', code: 'NAT_ELEC', label: 'Matériels Informatiques, Télécom & Haute Valeur', riskCoeff: 1.25 },
];

const INITIAL_REMITTANCES = [
  {
    id: 1,
    reference: 'REV-NSIA-2026-09',
    compagnie: 'NSIA Assurances CI',
    nombre_polices: 38,
    montant_primes: 14500000,
    commissions_deduites: 1740000,
    net_a_reverser: 12760000,
    date_generation: '2026-09-01',
    date_echeance_30j: '2026-10-01',
    jours_restants_cima: 25,
    statut_delai_cima: 'CONFORME',
    statut: 'Validé',
    statut_badge: 'emerald',
  },
  {
    id: 2,
    reference: 'REV-SUNU-2026-09',
    compagnie: 'SUNU Assurances CI',
    nombre_polices: 24,
    montant_primes: 9800000,
    commissions_deduites: 1176000,
    net_a_reverser: 8624000,
    date_generation: '2026-09-02',
    date_echeance_30j: '2026-10-02',
    jours_restants_cima: 26,
    statut_delai_cima: 'CONFORME',
    statut: 'En attente validation',
    statut_badge: 'amber',
  },
  {
    id: 3,
    reference: 'REV-SANLAM-2026-09',
    compagnie: 'SANLAM Assurances CI',
    nombre_polices: 15,
    montant_primes: 4200000,
    commissions_deduites: 504000,
    net_a_reverser: 3696000,
    date_generation: '2026-08-15',
    date_echeance_30j: '2026-09-14',
    jours_restants_cima: 8,
    statut_delai_cima: 'ALERTE_IMMINENTE',
    statut: 'En attente validation',
    statut_badge: 'amber',
  },
];

const INITIAL_COMMISSIONS = [
  {
    id: 1,
    apporteur: 'Cabinet Conseil Partenaire CI',
    contrat: 'POL-2026-001',
    client: 'Société Ivoirienne de Bois',
    branche: 'Automobile Flotte',
    plafond_cima: '10% max',
    prime_nette: 12500000,
    prime_encaissee: true,
    taux_commission: '8%',
    montant_commission: 1000000,
    statut: 'Payé',
    statut_badge: 'emerald',
  },
  {
    id: 2,
    apporteur: 'Assur Plus Abidjan',
    contrat: 'POL-2026-002',
    client: 'Transport Express Abidjan',
    branche: 'Automobile Risque Lourd',
    plafond_cima: '10% max',
    prime_nette: 8400000,
    prime_encaissee: true,
    taux_commission: '10%',
    montant_commission: 840000,
    statut: 'En attente',
    statut_badge: 'amber',
  },
  {
    id: 3,
    apporteur: 'Syllabus Courtage',
    contrat: 'POL-2026-003',
    client: 'Clinique Internationale Cocody',
    branche: 'Santé Groupe / Maladie',
    plafond_cima: '15% max',
    prime_nette: 5200000,
    prime_encaissee: false,
    taux_commission: '12%',
    montant_commission: 624000,
    statut: 'En attente',
    statut_badge: 'amber',
  },
];

const INITIAL_ENDORSEMENTS = [
  {
    id: 1,
    numero_avenant: 'AVN-REN-2026-001',
    police_id: 30,
    police_num: '2001202230028Y',
    client_nom: 'DRO OUATTARA',
    type_mouvement: 'Renouvellement',
    nature: 'Renouvellement Annuel Tacite Reconduction (12 Mois)',
    date_avenant: '2026-07-08',
    date_effet: '2026-07-08',
    date_expiration: '2027-07-07',
    prime_nette: 410000,
    accessoires: 15000,
    taxes: 56349,
    prime_totale: 481349,
    statut: 'Validé',
    statut_badge: 'emerald',
    details: {
      duree_mois: 12,
      compagnie: 'NSIA ASSURANCES',
      produit: 'Automobile Tous Risques',
      quittance_num: 'QUIT-CIMA-2026-004',
    },
  },
  {
    id: 2,
    numero_avenant: 'AVN-MOD-2026-002',
    police_id: 28,
    police_num: '2001201230026V',
    client_nom: 'DRO OUATTARA',
    type_mouvement: 'Avenant',
    nature: 'Changement d’immatriculation du véhicule',
    date_avenant: '2026-08-14',
    date_effet: '2026-08-14',
    date_expiration: '2027-07-07',
    prime_nette: 0,
    accessoires: 0,
    taxes: 0,
    prime_totale: 0,
    statut: 'Validé',
    statut_badge: 'emerald',
    details: {
      ancienne_immatriculation: '4455 HH 01',
      nouvelle_immatriculation: '7788 XX 01',
      compagnie: 'SUNU ASSURANCES',
      produit: 'Automobile Tiers & Vol',
    },
  },
];

// Helper: safe JSON read from localStorage
const readStorage = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      localStorage.setItem(key, JSON.stringify(fallback));
      return fallback;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[dataStore] Read error on key ${key}:`, err);
    return fallback;
  }
};

// Helper: safe JSON write to localStorage & notify
const writeStorage = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('uranus:datastore-update', {
          detail: { key, timestamp: Date.now() },
        })
      );
    }
  } catch (err) {
    console.warn(`[dataStore] Write error on key ${key}:`, err);
  }
};

// Helper: Horodatage précis pour traçabilité réglementaire
export const getFormattedTimestamp = () => {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} à ${hours}:${minutes}:${seconds}`;
};

let idCounter = 1;
const generateId = () => Date.now() + (idCounter++);

export const dataStore = {
  // Subscribe to changes
  subscribe: (callback) => {
    if (typeof window === 'undefined') return () => {};
    const handleCustom = (e) => callback(e.detail?.key, e.detail);
    const handleStorage = (e) => {
      if (e.key && Object.values(STORAGE_KEYS).includes(e.key)) {
        callback(e.key, { key: e.key });
      }
    };
    window.addEventListener('uranus:datastore-update', handleCustom);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('uranus:datastore-update', handleCustom);
      window.removeEventListener('storage', handleStorage);
    };
  },

  /* =========================================================================
     1. CLIENTS
     ========================================================================= */
  getClients: () => readStorage(STORAGE_KEYS.CLIENTS, []),
  getClientById: (id) => {
    const list = dataStore.getClients();
    return list.find((c) => String(c.id) === String(id) || c.codeclient === id) || null;
  },
  saveClient: (clientData) => {
    const list = dataStore.getClients();
    const id = clientData.id || clientData.IdClient || generateId();
    const isEntreprise = clientData.typeclient === 'Entreprise' || clientData.Particulier === 'F' || clientData.Particulier === '0';
    const nom = clientData.nom || clientData.Nom || '';
    const prenom = isEntreprise ? '' : (clientData.prenom || clientData.Prenoms || '');
    const nomcomplet = clientData.nomcomplet || (isEntreprise ? nom : `${nom} ${prenom}`.trim());
    const seq = String(list.length + 1).padStart(4, '0');
    const nowMonth = new Date().toISOString().slice(0, 7).replace('-', '');

    const newClient = {
      // Identifiants & Système
      id,
      IdClient: id,
      codeclient: clientData.codeclient || clientData.Matricule || `CLI-2026-${seq.slice(-3)}`,
      Matricule: clientData.Matricule || clientData.codeclient || `CLI-2026-${seq.slice(-3)}`,
      numero_assure: clientData.numero_assure || `ASS-${nowMonth}-${seq}`,
      cle_unique: clientData.cle_unique || `CLI-CI-${seq}-${nom.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`,
      IdOperateur: clientData.IdOperateur || 1,
      DateCreation: clientData.DateCreation || new Date().toISOString(),
      DateMaj: new Date().toISOString(),
      date_derniere_modification: clientData.date_derniere_modification || getFormattedTimestamp(),
      date_maj: new Date().toISOString(),
      updated_at: new Date().toISOString(),

      // État Civil & Identité
      nom,
      Nom: nom,
      prenom,
      Prenoms: prenom,
      nomcomplet,
      typeclient: isEntreprise ? 'Entreprise' : 'Particulier',
      Particulier: isEntreprise ? 'F' : 'V',
      IdQualite: clientData.IdQualite || (isEntreprise ? 4 : 1),
      civilite: clientData.civilite || (isEntreprise ? 'Société' : 'Monsieur'),
      DateNaissance: clientData.DateNaissance || null,
      LieuNaissance: clientData.LieuNaissance || '',
      CniPat: clientData.CniPat || '',

      // Coordonnées complètes
      telephone: clientData.telephone || clientData.Telephone || '+225 07 00 00 00 00',
      Telephone: clientData.Telephone || clientData.telephone || '+225 07 00 00 00 00',
      mobile: clientData.mobile || clientData.Mobile || clientData.telephone || '',
      Mobile: clientData.Mobile || clientData.mobile || clientData.Telephone || '',
      fixe: clientData.fixe || clientData.Fixe || '',
      Fixe: clientData.Fixe || clientData.fixe || '',
      fax: clientData.fax || clientData.Fax || '',
      Fax: clientData.Fax || clientData.fax || '',
      email: clientData.email || clientData.Email || '',
      Email: clientData.Email || clientData.email || '',
      adresse: clientData.adresse || clientData.Adresse1 || 'Abidjan',
      Adresse1: clientData.Adresse1 || clientData.adresse || 'Abidjan',
      Adresse2: clientData.Adresse2 || '',
      IdVille: clientData.IdVille || 1,
      ville: clientData.ville || 'Abidjan',
      CodePostal: clientData.CodePostal || '',

      // Professionnel & Entreprise
      IdProfession: clientData.IdProfession || (isEntreprise ? 10 : 1),
      profession: clientData.profession || clientData.libelleprofession || (isEntreprise ? 'Société' : 'Commerçant'),
      libelleprofession: clientData.libelleprofession || clientData.profession || (isEntreprise ? 'Société' : 'Commerçant'),
      IdSecteurActivite: clientData.IdSecteurActivite || (isEntreprise ? 1 : null),
      secteur_activite: clientData.secteur_activite || '',
      Responsable: clientData.Responsable || '',
      Fonction: clientData.Fonction || '',

      // Classification & CIMA
      Vip: clientData.Vip || (clientData.is_vip ? 'V' : 'N'),
      is_vip: clientData.Vip === 'V' || clientData.is_vip === true,
      Statut: clientData.Statut || 'V',
      statut_libelle: clientData.Statut === 'V' ? 'Actif' : clientData.Statut === 'S' ? 'Suspendu' : 'Archivé',
      idtypeclient: clientData.idtypeclient || (isEntreprise ? 2 : 1),
      idtypeclient_id: clientData.idtypeclient_id || clientData.idtypeclient || (isEntreprise ? 2 : 1),
      type_souscripteur: clientData.type_souscripteur || (isEntreprise ? 'Personne Morale' : 'Personne Physique'),
      idtypeassure: clientData.idtypeassure || (isEntreprise ? 2 : 1),
      idtypeassure_id: clientData.idtypeassure_id || clientData.idtypeassure || (isEntreprise ? 2 : 1),
      type_assure: clientData.type_assure || (isEntreprise ? 'Personne Morale' : 'Personne Physique'),
      IdCategorie: clientData.IdCategorie || (isEntreprise ? 2 : 1),
      IdProfil: clientData.IdProfil || 1,
      Reconquete: clientData.Reconquete || 'N',
      CreeCie: clientData.CreeCie || 'V',

      // Données financières & fiscales
      Rib: clientData.Rib || '',
      NumeroCompte: clientData.NumeroCompte || `CPT-411-${seq.slice(-4)}`,
      Solde: clientData.Solde !== undefined ? String(clientData.Solde) : '0',
      Avoir: clientData.Avoir !== undefined ? String(clientData.Avoir) : '0',
      ExonereDeTaxes: Boolean(clientData.ExonereDeTaxes),
      ExonereDeAccess: Boolean(clientData.ExonereDeAccess),

      // Compteurs d'activité
      contrats_actifs: clientData.contrats_actifs || 0,
      devis_en_cours: clientData.devis_en_cours || 0,
      total_primes: clientData.total_primes || '0 FCFA',
    };
    const updated = [newClient, ...list.filter((c) => c.id !== newClient.id && c.IdClient !== newClient.IdClient)];
    writeStorage(STORAGE_KEYS.CLIENTS, updated);
    return newClient;
  },
  updateClient: (id, updates) => {
    const list = dataStore.getClients();
    const nowIso = new Date().toISOString();
    const nowFormatted = getFormattedTimestamp();
    const updated = list.map((c) => {
      if (String(c.id) === String(id) || String(c.IdClient) === String(id) || c.codeclient === id || c.Matricule === id) {
        const isEntreprise = updates.typeclient ? updates.typeclient === 'Entreprise' : c.typeclient === 'Entreprise';
        const nom = updates.nom !== undefined ? updates.nom : (updates.Nom !== undefined ? updates.Nom : c.nom);
        const prenom = isEntreprise ? '' : (updates.prenom !== undefined ? updates.prenom : (updates.Prenoms !== undefined ? updates.Prenoms : c.prenom));
        const nomcomplet = isEntreprise ? nom : `${nom} ${prenom}`.trim();

        return {
          ...c,
          ...updates,
          nom,
          Nom: nom,
          prenom,
          Prenoms: prenom,
          nomcomplet,
          Particulier: isEntreprise ? 'F' : 'V',
          DateMaj: nowIso,
          date_maj: nowIso,
          date_derniere_modification: nowFormatted,
          updated_at: nowIso,
        };
      }
      return c;
    });
    writeStorage(STORAGE_KEYS.CLIENTS, updated);
    return updated.find((c) => String(c.id) === String(id) || String(c.IdClient) === String(id) || c.codeclient === id || c.Matricule === id);
  },
  deleteClient: (id) => {
    // Interdiction de suppression définitive (Règle CIMA) : remplacement par archivage
    return dataStore.archiveClient(id);
  },
  archiveClient: (id) => {
    return dataStore.updateClient(id, {
      statut: 'Archivé',
      statut_badge: 'slate',
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },
  // Restauration d'une fiche client archivée (module Archives)
  unarchiveClient: (id) => {
    return dataStore.updateClient(id, {
      Statut: 'V',
      statut: 'Actif',
      statut_badge: 'emerald',
      archive: false,
      date_archivage: null,
    });
  },

  /* =========================================================================
     2. DEVIS (QUOTES)
     ========================================================================= */
  getQuotes: () => readStorage(STORAGE_KEYS.QUOTES, []),
  getQuoteById: (id) => {
    const list = dataStore.getQuotes();
    return list.find((q) => String(q.id) === String(id) || q.numerodevis === id) || null;
  },
  saveQuote: (quoteData) => {
    const list = dataStore.getQuotes();

    // Compute max sequence number to avoid duplicate quote numbers
    let maxSeq = 0;
    list.forEach((q) => {
      const match = String(q.numerodevis || '').match(/-(\d{3,})$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxSeq) maxSeq = num;
      }
    });
    const nextSeq = Math.max(list.length + 1, maxSeq + 1);

    const branchClean = (quoteData.branche || 'GEN').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 9);
    const prefix = `DEV-${branchClean}-2026`;
    const isExplicitId = Boolean(quoteData.id);

    const nowIso = new Date().toISOString();
    const formattedDate = getFormattedTimestamp();

    const newQuote = {
      id: quoteData.id || generateId(),
      numerodevis: quoteData.numerodevis || `${prefix}-${String(nextSeq).padStart(3, '0')}`,
      client_nom: quoteData.client_nom || quoteData.clientNom || quoteData.souscripteur || 'Assuré LE PHARE',
      client_id: quoteData.client_id || quoteData.clientId || null,
      produit: quoteData.produit || 'Automobile Tous Risques',
      branche: quoteData.branche || 'Auto',
      compagnie: quoteData.compagnie || 'NSIA Assurances',
      prime_nette: Number(quoteData.prime_nette || quoteData.primeNette || 0),
      accessoires: Number(quoteData.accessoires ?? 15000),
      taxes: Number(quoteData.taxes ?? 0),
      prime_totale: Number(quoteData.prime_totale || quoteData.primeTotale || quoteData.primettc || 0),
      date_emission: quoteData.date_emission || nowIso.split('T')[0],
      date_creation: quoteData.date_creation || quoteData.date_emission || nowIso.split('T')[0],
      date_derniere_modification: quoteData.date_derniere_modification || formattedDate,
      DateMaj: formattedDate,
      date_maj: formattedDate,
      updated_at: nowIso,
      statut: quoteData.statut || 'En attente',
      statut_badge: quoteData.statut === 'Consolidé' ? 'emerald' : 'amber',
      archive: false,
      details: quoteData.details || {},
    };

    // Deduplicate: only search for existing if an explicit id or numerodevis was provided
    let existingIndex = -1;
    if (isExplicitId || quoteData.numerodevis) {
      existingIndex = list.findIndex(
        (q) =>
          (isExplicitId && String(q.id) === String(quoteData.id)) ||
          (quoteData.numerodevis && q.numerodevis === quoteData.numerodevis)
      );
    }

    let updated;
    if (existingIndex >= 0) {
      updated = [...list];
      updated[existingIndex] = { ...updated[existingIndex], ...newQuote };
    } else {
      updated = [newQuote, ...list];
    }
    writeStorage(STORAGE_KEYS.QUOTES, updated);

    // Update client devis_en_cours count if client matched
    if (newQuote.client_nom || newQuote.client_id) {
      const clients = dataStore.getClients();
      const matchedClient = clients.find(
        (c) =>
          (newQuote.client_id && String(c.id) === String(newQuote.client_id)) ||
          (c.nomcomplet?.toLowerCase() === newQuote.client_nom?.toLowerCase())
      );
      if (matchedClient) {
        dataStore.updateClient(matchedClient.id, {
          devis_en_cours: (matchedClient.devis_en_cours || 0) + 1,
        });
      }
    }

    return newQuote;
  },
  updateQuote: (id, updates) => {
    const list = dataStore.getQuotes();
    const nowIso = new Date().toISOString();
    const formattedDate = getFormattedTimestamp();
    const updated = list.map((q) => {
      if (String(q.id) === String(id) || q.numerodevis === id) {
        return {
          ...q,
          ...updates,
          date_derniere_modification: updates.date_derniere_modification || formattedDate,
          DateMaj: formattedDate,
          date_maj: formattedDate,
          updated_at: nowIso,
        };
      }
      return q;
    });
    writeStorage(STORAGE_KEYS.QUOTES, updated);
    return updated.find((q) => String(q.id) === String(id) || q.numerodevis === id);
  },
  deleteQuote: (id) => {
    // Interdiction formelle de suppression définitive (Règle CIMA) : remplacement par archivage
    return dataStore.archiveQuote(id);
  },
  archiveQuote: (id, motif = 'Archivage utilisateur') => {
    const list = dataStore.getQuotes();
    const quote = list.find((q) => String(q.id) === String(id) || q.numerodevis === id);
    if (!quote) throw new Error('Devis introuvable');
    if (quote.statut === 'Consolidé') {
      throw new Error(`Règle CIMA : Le devis ${quote.numerodevis} est consolidé en contrat actif. L'archivage est restreint tant que le contrat est en cours.`);
    }
    return dataStore.updateQuote(quote.id, {
      statut: 'Archivé',
      statut_badge: 'rose',
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
      motif_archivage: motif,
    });
  },
  // Restauration d'un devis archivé (module Archives)
  unarchiveQuote: (id) => {
    const list = dataStore.getQuotes();
    const quote = list.find((q) => String(q.id) === String(id) || q.numerodevis === id);
    if (!quote) throw new Error('Devis introuvable');
    return dataStore.updateQuote(quote.id, {
      statut: 'En attente',
      statut_badge: 'amber',
      archive: false,
      date_archivage: null,
    });
  },
  // Convert Quote into a Legal Insurance Policy (Contract)
  convertQuoteToContract: (quoteOrId) => {
    const quote = typeof quoteOrId === 'object'
      ? quoteOrId
      : dataStore.getQuoteById(quoteOrId);
    if (!quote) throw new Error('Quote not found');

    // 1. Mark quote as 'Consolidé'
    dataStore.updateQuote(quote.id, {
      statut: 'Consolidé',
      statut_badge: 'emerald',
    });

    // 2. Generate new Contract
    const contracts = dataStore.getContracts();
    const nextSeq = contracts.length + 1;
    const today = new Date();
    const nextYear = new Date(today);
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    const clients = dataStore.getClients();
    const matchedClient = clients.find(
      (c) => (quote.client_id && String(c.id) === String(quote.client_id)) ||
             (c.nomcomplet?.toLowerCase() === quote.client_nom?.toLowerCase())
    );

    const clientAdresse = quote.adresse || quote.client_adresse || quote.details?.adresse || matchedClient?.adresse || matchedClient?.Adresse || 'Abidjan, Côte d\'Ivoire';
    const primeNette = Number(quote.prime_nette || quote.primenette || 0);
    const accessoire = Number(quote.accessoires || quote.accessoire || 9000);
    const taxe = Number(quote.taxes || quote.taxe || 0);
    const primeTotale = Number(quote.prime_totale || (primeNette + accessoire + taxe) || 0);

    const newContract = {
      id: Date.now(),
      numeropolice: `POL-2026-${String(nextSeq).padStart(3, '0')}`,
      devis_origine: quote.numerodevis,
      client_nom: quote.client_nom,
      client_id: quote.client_id || matchedClient?.id || null,
      adresse: clientAdresse,
      intermediaire: quote.intermediaire || 'OREOLE ASSURANCES',
      produit: quote.produit || 'Automobile Tous Risques',
      branche: quote.branche || 'Auto',
      compagnie: quote.compagnie || 'AXA ASSURANCES',
      date_emission: quote.date_emission || today.toISOString().split('T')[0],
      date_creation: today.toISOString().split('T')[0],
      date_derniere_modification: getFormattedTimestamp(),
      DateMaj: getFormattedTimestamp(),
      date_maj: getFormattedTimestamp(),
      updated_at: new Date().toISOString(),
      date_effet: quote.date_effet || today.toISOString().split('T')[0],
      date_expiration: quote.date_expiration || nextYear.toISOString().split('T')[0],
      prime_nette: primeNette,
      accessoire: accessoire,
      taxe: taxe,
      prime_totale: primeTotale,
      montant_encaisse: 0,
      statut_encaissement: 'À Encaisser',
      statut_encaissement_badge: 'rose',
      statut_contrat: 'En cours',
      statut_contrat_badge: 'emerald',
      statut: 'En cours',
      statut_badge: 'emerald',
      attestation_asaci: 'À Délivrer',
      attestation_badge: 'amber',
      archive: false,
      details: quote.details || {},
    };

    const updatedContracts = [newContract, ...contracts];
    writeStorage(STORAGE_KEYS.CONTRACTS, updatedContracts);

    // 3. Update client stats (contrats_actifs + 1)
    if (newContract.client_nom) {
      const clients = dataStore.getClients();
      const matchedClient = clients.find(
        (c) => c.nomcomplet?.toLowerCase() === newContract.client_nom?.toLowerCase()
      );
      if (matchedClient) {
        dataStore.updateClient(matchedClient.id, {
          contrats_actifs: (matchedClient.contrats_actifs || 0) + 1,
        });
      }
    }

    return Object.assign(newContract, { quote, contract: newContract });
  },

  /* =========================================================================
     3. CONTRATS & POLICES (CONTRACTS)
     ========================================================================= */
  getContracts: () => readStorage(STORAGE_KEYS.CONTRACTS, []),
  getContractById: (id) => {
    const list = dataStore.getContracts();
    return list.find((c) => String(c.id) === String(id) || c.numeropolice === id) || null;
  },
  saveContract: (contractData) => {
    const list = dataStore.getContracts();
    const nextSeq = list.length + 1;
    const today = new Date();
    const nextYear = new Date(today);
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const nowIso = new Date().toISOString();
    const formattedDate = getFormattedTimestamp();

    const newContract = {
      id: contractData.id || Date.now(),
      numeropolice: contractData.numeropolice || `POL-2026-${String(nextSeq).padStart(3, '0')}`,
      client_nom: contractData.client_nom || contractData.souscripteur || 'Assuré LE PHARE',
      produit: contractData.produit || 'Automobile Tous Risques',
      compagnie: contractData.compagnie || 'NSIA ASSURANCES',
      date_emission: contractData.date_emission || today.toISOString().split('T')[0],
      date_creation: contractData.date_creation || today.toISOString().split('T')[0],
      date_derniere_modification: contractData.date_derniere_modification || formattedDate,
      DateMaj: formattedDate,
      date_maj: formattedDate,
      updated_at: nowIso,
      date_effet: contractData.date_effet || today.toISOString().split('T')[0],
      date_expiration: contractData.date_expiration || nextYear.toISOString().split('T')[0],
      prime_totale: Number(contractData.prime_totale || contractData.primettc || 0),
      montant_encaisse: Number(contractData.montant_encaisse || 0),
      statut_encaissement:
        contractData.statut_encaissement ||
        (estSolde(contractData.prime_totale, contractData.montant_encaisse)
          ? 'Soldé'
          : 'À Encaisser'),
      statut_encaissement_badge:
        estSolde(contractData.prime_totale, contractData.montant_encaisse)
          ? 'emerald'
          : 'rose',
      statut_contrat: contractData.statut_contrat || 'En cours',
      statut_contrat_badge: 'emerald',
      statut: 'En cours',
      statut_badge: 'emerald',
      attestation_asaci: contractData.attestation_asaci || 'Délivrée',
      attestation_badge: 'emerald',
      archive: false,
    };

    const updated = [newContract, ...list.filter((c) => c.id !== newContract.id)];
    writeStorage(STORAGE_KEYS.CONTRACTS, updated);
    return newContract;
  },
  updateContract: (id, updates) => {
    const list = dataStore.getContracts();
    const nowIso = new Date().toISOString();
    const formattedDate = getFormattedTimestamp();
    const updated = list.map((c) => {
      if (String(c.id) === String(id) || c.numeropolice === id) {
        return {
          ...c,
          ...updates,
          date_derniere_modification: updates.date_derniere_modification || formattedDate,
          DateMaj: formattedDate,
          date_maj: formattedDate,
          updated_at: nowIso,
        };
      }
      return c;
    });
    writeStorage(STORAGE_KEYS.CONTRACTS, updated);
    return updated.find((c) => String(c.id) === String(id) || c.numeropolice === id);
  },
  deleteContract: (id) => {
    // Interdiction formelle de suppression définitive (Règle CIMA) : remplacement par archivage
    return dataStore.archiveContract(id);
  },
  archiveContract: (id, motif = 'Archivage réglementaire CIMA') => {
    return dataStore.updateContract(id, {
      statut_contrat: 'Archivé',
      statut: 'Archivé',
      statut_badge: 'rose',
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
      motif_archivage: motif,
    });
  },
  // Restauration d'un contrat archivé (module Archives)
  unarchiveContract: (id) => {
    return dataStore.updateContract(id, {
      statut_contrat: 'En cours',
      statut: 'En cours',
      statut_badge: 'emerald',
      archive: false,
      date_archivage: null,
    });
  },
  terminateContract: (id, { motif, date_resiliation, motif_label } = {}) => {
    const list = dataStore.getContracts();
    const contract = list.find((c) => String(c.id) === String(id) || c.numeropolice === id);
    if (!contract) throw new Error('Contrat introuvable');
    return dataStore.updateContract(contract.id, {
      statut_contrat: 'Résilié',
      statut: 'Résilié',
      statut_badge: 'rose',
      motif_resiliation: motif_label || motif || 'Résiliation Art. 13 CIMA',
      date_resiliation: date_resiliation || new Date().toISOString().split('T')[0],
    });
  },
  cancelContractWithDerogation: (id, { code_jeton, motif } = {}) => {
    const list = dataStore.getContracts();
    const contract = list.find((c) => String(c.id) === String(id) || c.numeropolice === id);
    if (!contract) throw new Error('Contrat introuvable');
    if (!code_jeton) throw new Error("Un jeton d'autorisation de dérogation valide (JET-XXXX) est obligatoire.");
    return dataStore.updateContract(contract.id, {
      statut_contrat: 'Annulé (Dérogation)',
      statut: 'Annulé',
      statut_badge: 'amber',
      code_jeton,
      motif_annulation: motif || 'Annulation administrative autorisée par la Direction',
      date_annulation: new Date().toISOString().split('T')[0],
    });
  },

  /**
   * RENOUVELLEMENT DE POLICE (RENEWAL)
   * Proroge la durée du contrat, recalcule les primes CIMA, génère l'avenant de renouvellement
   * et émet la quittance officielle avec validité juridique immédiate.
   */
  renewContract: ({
    contractId,
    periodeMois = 12,
    dateEffet,
    primeTotale,
    primeNette,
    accessoires,
    taxes,
    modePaiement = 'ESPECES',
    encaisserImmediat = true,
    referencePaiement,
    banque,
    emetteur,
  }) => {
    const contracts = dataStore.getContracts();
    const contract = contracts.find((c) => String(c.id) === String(contractId) || c.numeropolice === contractId);
    if (!contract) throw new Error('Police d\'assurance introuvable pour le renouvellement');

    const duration = parseInt(periodeMois, 10) || 12;

    // Détermination de la date de prise d'effet du renouvellement
    let newStart = dateEffet;
    if (!newStart) {
      const expDate = new Date(contract.date_expiration);
      const today = new Date();
      if (!isNaN(expDate.getTime()) && expDate > today) {
        const nextDay = new Date(expDate);
        nextDay.setDate(nextDay.getDate() + 1);
        newStart = nextDay.toISOString().split('T')[0];
      } else {
        newStart = today.toISOString().split('T')[0];
      }
    }

    const startDateObj = new Date(newStart);
    const newEndObj = new Date(startDateObj);
    newEndObj.setMonth(newEndObj.getMonth() + duration);
    newEndObj.setDate(newEndObj.getDate() - 1);
    const newExpiration = newEndObj.toISOString().split('T')[0];

    // Décompte financier CIMA
    const pTotale = Number(primeTotale ?? contract.prime_totale ?? 0);
    const pNette = Number(primeNette ?? Math.round(pTotale * 0.85));
    const acc = Number(accessoires ?? 15000);
    const tx = Number(taxes ?? Math.max(0, pTotale - pNette - acc));

    // Numérotation séquentielle de l'avenant de renouvellement
    const endorsements = dataStore.getEndorsements();
    let maxSeq = 0;
    endorsements.forEach((a) => {
      const m = String(a.numero_avenant || '').match(/-(\d{3,})$/);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num > maxSeq) maxSeq = num;
      }
    });
    const nextSeq = Math.max(endorsements.length + 1, maxSeq + 1);
    const numeroAvenant = `AVN-REN-2026-${String(nextSeq).padStart(3, '0')}`;

    // Mise à jour de la police
    const updatedContract = dataStore.updateContract(contract.id, {
      date_effet: newStart,
      date_expiration: newExpiration,
      prime_totale: pTotale,
      montant_encaisse: encaisserImmediat ? pTotale : 0,
      statut_encaissement: encaisserImmediat ? 'Soldé' : 'À Encaisser',
      statut_encaissement_badge: encaisserImmediat ? 'emerald' : 'rose',
      statut_contrat: 'En cours',
      statut: 'En cours',
      statut_badge: 'emerald',
      nombre_renouvellements: (contract.nombre_renouvellements || 0) + 1,
      derniere_operation: 'Renouvellement',
      derniere_operation_date: new Date().toISOString().split('T')[0],
      dernier_avenant: numeroAvenant,
    });

    // Génération de la quittance si encaissement immédiat
    let quittance = null;
    if (encaisserImmediat) {
      const quittances = dataStore.getQuittances();
      const quittanceNumber = `QUIT-REN-2026-${String(quittances.length + 1).padStart(3, '0')}`;
      quittance = {
        id: generateId(),
        numero_quittance: quittanceNumber,
        police_num: contract.numeropolice,
        souscripteur: contract.client_nom,
        compagnie: contract.compagnie,
        branche: contract.produit,
        type_operation: 'Renouvellement de Police',
        montant_encaisse: pTotale,
        prime_totale: pTotale,
        reste_a_payer: 0,
        mode_paiement: modePaiement,
        reference_paiement: referencePaiement || (modePaiement === 'CHEQUE' ? `CHQ-${banque || 'SGBCI'}` : 'Caisse Agence'),
        date_encaissement: `${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`,
        periode_couverte: `Du ${newStart} au ${newExpiration}`,
        emetteur: emetteur || 'Caisse Centrale LE PHARE',
        mention_legale:
          "Article 13 CIMA : La présente quittance de renouvellement atteste du paiement intégral de la prime d'assurance et proroge la garantie des risques pour la période stipulée.",
      };
      writeStorage(STORAGE_KEYS.QUITTANCES, [quittance, ...quittances]);
    }

    // Enregistrement de l'Avenant de renouvellement
    const newEndorsement = {
      id: generateId(),
      numero_avenant: numeroAvenant,
      police_id: contract.id,
      police_num: contract.numeropolice,
      client_nom: contract.client_nom,
      type_mouvement: 'Renouvellement',
      nature: `Renouvellement annuel pour une durée de ${duration} mois`,
      date_avenant: new Date().toISOString().split('T')[0],
      date_effet: newStart,
      date_expiration: newExpiration,
      prime_nette: pNette,
      accessoires: acc,
      taxes: tx,
      prime_totale: pTotale,
      statut: 'Validé',
      statut_badge: 'emerald',
      details: {
        duree_mois: duration,
        quittance_num: quittance?.numero_quittance,
        compagnie: contract.compagnie,
        produit: contract.produit,
        mode_paiement: modePaiement,
        paiement_immediat: encaisserImmediat,
      },
    };
    writeStorage(STORAGE_KEYS.ENDORSEMENTS, [newEndorsement, ...endorsements]);

    return { contract: updatedContract, endorsement: newEndorsement, quittance };
  },

  /**
   * TRANSFORMATION DE POLICE (TRANSFORMATION)
   * Permet de modifier le produit, la formule de garanties ou la compagnie porteuse.
   */
  transformContract: ({
    contractId,
    nouveauProduit,
    nouvelleFormule,
    nouvelleCompagnie,
    nouvellePrime,
    motifTransformation,
  }) => {
    const contracts = dataStore.getContracts();
    const contract = contracts.find((c) => String(c.id) === String(contractId) || c.numeropolice === contractId);
    if (!contract) throw new Error('Police introuvable pour la transformation');

    const endorsements = dataStore.getEndorsements();
    const numeroAvenant = `AVN-TRF-2026-${String(endorsements.length + 1).padStart(3, '0')}`;

    const oldProduct = contract.produit;
    const oldCompany = contract.compagnie;
    const pTotale = nouvellePrime ? Number(nouvellePrime) : contract.prime_totale;

    const updatedContract = dataStore.updateContract(contract.id, {
      produit: nouveauProduit || nouvelleFormule || contract.produit,
      compagnie: nouvelleCompagnie || contract.compagnie,
      prime_totale: pTotale,
      derniere_operation: 'Transformation',
      derniere_operation_date: new Date().toISOString().split('T')[0],
      dernier_avenant: numeroAvenant,
    });

    const newEndorsement = {
      id: generateId(),
      numero_avenant: numeroAvenant,
      police_id: contract.id,
      police_num: contract.numeropolice,
      client_nom: contract.client_nom,
      type_mouvement: 'Transformation',
      nature: `Transformation de formule : ${oldProduct} ➔ ${updatedContract.produit}`,
      date_avenant: new Date().toISOString().split('T')[0],
      date_effet: new Date().toISOString().split('T')[0],
      date_expiration: contract.date_expiration,
      prime_totale: pTotale,
      statut: 'Validé',
      statut_badge: 'emerald',
      details: {
        ancien_produit: oldProduct,
        ancienne_compagnie: oldCompany,
        nouveau_produit: updatedContract.produit,
        nouvelle_compagnie: updatedContract.compagnie,
        motif: motifTransformation || 'Modification de la formule de garanties à la demande du souscripteur',
      },
    };
    writeStorage(STORAGE_KEYS.ENDORSEMENTS, [newEndorsement, ...endorsements]);

    return { contract: updatedContract, endorsement: newEndorsement };
  },

  /* =========================================================================
     3.1 AVENANTS & MOUVEMENTS (ENDORSEMENTS)
     ========================================================================= */
  getEndorsements: () => readStorage(STORAGE_KEYS.ENDORSEMENTS, INITIAL_ENDORSEMENTS),
  getEndorsementsByPolicy: (policyNumOrId) => {
    const list = dataStore.getEndorsements();
    return list.filter(
      (a) => String(a.police_id) === String(policyNumOrId) || a.police_num === policyNumOrId
    );
  },
  saveEndorsement: (endorsementData) => {
    const list = dataStore.getEndorsements();
    let maxSeq = 0;
    list.forEach((a) => {
      const m = String(a.numero_avenant || '').match(/-(\d{3,})$/);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num > maxSeq) maxSeq = num;
      }
    });
    const nextSeq = Math.max(list.length + 1, maxSeq + 1);

    const typeCode = (endorsementData.type_mouvement || 'MOD').toUpperCase().slice(0, 3);
    const numAvenant = endorsementData.numero_avenant || `AVN-${typeCode}-2026-${String(nextSeq).padStart(3, '0')}`;

    const newEndorsement = {
      id: endorsementData.id || generateId(),
      numero_avenant: numAvenant,
      police_id: endorsementData.police_id,
      police_num: endorsementData.police_num,
      client_nom: endorsementData.client_nom || 'Assuré LE PHARE',
      type_mouvement: endorsementData.type_mouvement || 'Avenant',
      nature: endorsementData.nature || 'Modification des conditions contractuelles',
      date_avenant: endorsementData.date_avenant || new Date().toISOString().split('T')[0],
      date_effet: endorsementData.date_effet || new Date().toISOString().split('T')[0],
      date_expiration: endorsementData.date_expiration,
      prime_nette: Number(endorsementData.prime_nette || 0),
      accessoires: Number(endorsementData.accessoires || 0),
      taxes: Number(endorsementData.taxes || 0),
      prime_totale: Number(endorsementData.prime_totale || 0),
      statut: endorsementData.statut || 'Validé',
      statut_badge: 'emerald',
      details: endorsementData.details || {},
    };

    const updated = [newEndorsement, ...list.filter((a) => String(a.id) !== String(newEndorsement.id))];
    writeStorage(STORAGE_KEYS.ENDORSEMENTS, updated);

    // Mise à jour de la police associée
    if (newEndorsement.police_id) {
      const contractUpdates = {
        dernier_avenant: numAvenant,
        derniere_operation: newEndorsement.type_mouvement,
        derniere_operation_date: newEndorsement.date_avenant,
      };

      if (newEndorsement.type_mouvement === 'immatriculation' || newEndorsement.details?.nouvelleImmatriculation) {
        contractUpdates.immatriculation = newEndorsement.details.nouvelleImmatriculation;
      }
      if (newEndorsement.prime_totale > 0) {
        const contract = dataStore.getContractById(newEndorsement.police_id);
        if (contract) {
          contractUpdates.prime_totale = (contract.prime_totale || 0) + newEndorsement.prime_totale;
        }
      }
      dataStore.updateContract(newEndorsement.police_id, contractUpdates);
    }

    return newEndorsement;
  },

  /* =========================================================================
     4. SINISTRES (CLAIMS)
     ========================================================================= */
  getClaims: () => readStorage(STORAGE_KEYS.CLAIMS, []),
  getClaimById: (id) => {
    const list = dataStore.getClaims();
    return list.find((c) => String(c.id) === String(id) || c.numero_sinistre === id) || null;
  },
  saveClaim: (claimData) => {
    const list = dataStore.getClaims();
    const nextSeq = list.length + 125;
    const nowIso = new Date().toISOString();
    const formattedDate = getFormattedTimestamp();
    const newClaim = {
      id: claimData.id || `CLM-${String(list.length + 1).padStart(3, '0')}`,
      numero_sinistre: claimData.numero_sinistre || `SIN-2026-${String(nextSeq).padStart(5, '0')}`,
      police_num: claimData.police_num || 'POL-2026-001',
      assure_nom: claimData.assure_nom || claimData.client_nom || 'Assuré LE PHARE',
      compagnie: claimData.compagnie || 'NSIA Assurances',
      nature: claimData.nature || 'Accident de circulation',
      date_survenance: claimData.date_survenance || nowIso.split('T')[0],
      date_declaration: claimData.date_declaration || nowIso.split('T')[0],
      date_creation: claimData.date_creation || claimData.date_declaration || nowIso.split('T')[0],
      date_derniere_modification: claimData.date_derniere_modification || formattedDate,
      DateMaj: formattedDate,
      date_maj: formattedDate,
      updated_at: nowIso,
      lieu: claimData.lieu || 'Abidjan',
      montant_reclame: Number(claimData.montant_reclame || 0),
      montant_indemnise: Number(claimData.montant_indemnise || 0),
      statut: claimData.statut || 'Déclaré',
      statut_badge: 'amber',
      delegation_respectee: claimData.delegation_respectee ?? true,
      expert_assigne: claimData.expert_assigne || 'Cabinet d’Expertises CIMA CI',
      archive: false,
      pieces_justificatives: claimData.pieces_justificatives || [
        { nom: 'Déclaration de sinistre signée', recu: true },
        { nom: 'Constat d accident', recu: true },
        { nom: 'Permis de conduire', recu: true },
        { nom: 'Devis de réparation', recu: false },
      ],
      recours_info: claimData.recours_info || {
        compagnie_adverse: 'SUNU Assurances CI',
        montant: Math.round(Number(claimData.montant_reclame || 0) * 0.8),
        statut: 'En attente recours',
      },
      historique_evenements: claimData.historique_evenements || [
        { date: nowIso.split('T')[0], action: 'Déclaration enregistrée dans le système LE PHARE' },
      ],
    };

    const updated = [newClaim, ...list.filter((c) => c.id !== newClaim.id)];
    writeStorage(STORAGE_KEYS.CLAIMS, updated);
    return newClaim;
  },
  updateClaim: (id, updates) => {
    const list = dataStore.getClaims();
    const nowIso = new Date().toISOString();
    const formattedDate = getFormattedTimestamp();
    const updated = list.map((c) => {
      if (String(c.id) === String(id) || c.numero_sinistre === id) {
        return {
          ...c,
          ...updates,
          date_derniere_modification: updates.date_derniere_modification || formattedDate,
          DateMaj: formattedDate,
          date_maj: formattedDate,
          updated_at: nowIso,
        };
      }
      return c;
    });
    writeStorage(STORAGE_KEYS.CLAIMS, updated);
    return updated.find((c) => String(c.id) === String(id) || c.numero_sinistre === id);
  },
  deleteClaim: (id) => {
    // Interdiction de suppression définitive (Règle CIMA) : remplacement par archivage
    return dataStore.archiveClaim(id);
  },
  archiveClaim: (id, motif = 'Archivage dossier sinistre') => {
    const list = dataStore.getClaims();
    const claim = list.find((c) => String(c.id) === String(id) || c.numero_sinistre === id);
    if (!claim) throw new Error('Dossier sinistre introuvable');
    return dataStore.updateClaim(claim.id, {
      statut: 'Archivé / Sans suite',
      statut_badge: 'slate',
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
      motif_archivage: motif,
    });
  },
  // Restauration d'un dossier sinistre archivé (module Archives)
  unarchiveClaim: (id) => {
    const list = dataStore.getClaims();
    const claim = list.find((c) => String(c.id) === String(id) || c.numero_sinistre === id);
    if (!claim) throw new Error('Dossier sinistre introuvable');
    return dataStore.updateClaim(claim.id, {
      statut: 'En cours d\'instruction',
      statut_badge: 'amber',
      archive: false,
      date_archivage: null,
    });
  },
  closeClaimWithoutAction: (id, { motif } = {}) => {
    return dataStore.updateClaim(id, {
      statut: 'Sans suite',
      statut_badge: 'slate',
      motif_sans_suite: motif || 'Dossier classé sans suite après instruction',
      date_cloture: new Date().toISOString().split('T')[0],
    });
  },

  /* =========================================================================
     5. ENCAISSEMENTS & QUITTANCES CIMA
     ========================================================================= */
  getQuittances: () => readStorage(STORAGE_KEYS.QUITTANCES, []),
  savePayment: ({ contractId, numeropolice, montant, modePaiement, reference, banque, emetteur }) => {
    const contracts = dataStore.getContracts();
    const contract = contracts.find(
      (c) => String(c.id) === String(contractId) || c.numeropolice === numeropolice
    );
    if (!contract) throw new Error('Contract not found for payment');

    const paymentAmount = Number(montant || 0);
    const newMontantEncaisse = (contract.montant_encaisse || 0) + paymentAmount;
    const isSolde = estSolde(contract.prime_totale, newMontantEncaisse);

    // Update contract
    const updatedContract = dataStore.updateContract(contract.id, {
      montant_encaisse: newMontantEncaisse,
      statut_encaissement: isSolde ? 'Soldé' : 'Partiel',
      statut_encaissement_badge: isSolde ? 'emerald' : 'amber',
    });

    // Create CIMA Quittance
    const quittances = dataStore.getQuittances();
    const quittanceNumber = `QUIT-CIMA-2026-${String(quittances.length + 1).padStart(3, '0')}`;
    const quittance = {
      id: Date.now(),
      numero_quittance: quittanceNumber,
      police_num: contract.numeropolice,
      souscripteur: contract.client_nom,
      compagnie: contract.compagnie,
      branche: contract.produit,
      montant_encaisse: paymentAmount,
      prime_totale: contract.prime_totale,
      reste_a_payer: resteAEncaisser(contract.prime_totale, newMontantEncaisse),
      mode_paiement: modePaiement || 'ESPECES',
      reference_paiement: reference || (modePaiement === 'CHEQUE' ? `CHQ-${banque || 'BNI'}` : 'Caisse Centrale'),
      date_encaissement: `${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`,
      emetteur: emetteur || 'Caisse Centrale LE PHARE',
      mention_legale:
        "Conformément à l'Article 13 du Code des Assurances CIMA (« Pas de prime, pas d'assurance »), la présente quittance atteste du paiement effectif de la prime et confère validité immédiate aux garanties souscrites.",
    };

    writeStorage(STORAGE_KEYS.QUITTANCES, [quittance, ...quittances]);

    return { contract: updatedContract, quittance };
  },

  /* =========================================================================
     6. REVERSEMENTS COMPAGNIES (REMITTANCES)
     ========================================================================= */
  getRemittances: () => readStorage(STORAGE_KEYS.REMITTANCES, INITIAL_REMITTANCES),
  saveRemittance: (remittanceData) => {
    const list = dataStore.getRemittances();
    const newRemittance = {
      id: remittanceData.id || Date.now(),
      reference: remittanceData.reference || `REV-MANUEL-${Date.now()}`,
      compagnie: remittanceData.compagnie || 'NSIA Assurances CI',
      nombre_polices: Number(remittanceData.nombre_polices || 1),
      montant_primes: Number(remittanceData.montant_primes || 0),
      commissions_deduites: Number(remittanceData.commissions_deduites || 0),
      net_a_reverser: Number(remittanceData.net_a_reverser || 0),
      date_generation: remittanceData.date_generation || new Date().toISOString().split('T')[0],
      date_echeance_30j: remittanceData.date_echeance_30j || new Date().toISOString().split('T')[0],
      jours_restants_cima: remittanceData.jours_restants_cima ?? 30,
      statut_delai_cima: remittanceData.statut_delai_cima || 'CONFORME',
      statut: remittanceData.statut || 'En attente validation',
      statut_badge: remittanceData.statut === 'Validé' ? 'emerald' : 'amber',
    };
    const updated = [newRemittance, ...list.filter((r) => r.id !== newRemittance.id)];
    writeStorage(STORAGE_KEYS.REMITTANCES, updated);
    return newRemittance;
  },
  updateRemittance: (id, updates) => {
    const list = dataStore.getRemittances();
    const updated = list.map((r) => (String(r.id) === String(id) ? { ...r, ...updates } : r));
    writeStorage(STORAGE_KEYS.REMITTANCES, updated);
    return updated.find((r) => String(r.id) === String(id));
  },

  /* =========================================================================
     7. CATALOGUE : PRODUITS & GARANTIES
     ========================================================================= */
  getProducts: () => readStorage(STORAGE_KEYS.PRODUCTS, INITIAL_PRODUCTS),
  saveProduct: (productData) => {
    const list = dataStore.getProducts();
    const newProduct = {
      id: productData.id || Date.now(),
      branche: productData.branche || 'Automobile',
      code_produit: (productData.code_produit || 'PROD').toUpperCase(),
      nom: productData.nom || 'Nouveau Produit',
      type_gestion: productData.type_gestion || 'Individuel',
      nb_garanties: Number(productData.nb_garanties || 6),
      statut: productData.statut || 'Actif',
    };
    const updated = [newProduct, ...list.filter((p) => p.id !== newProduct.id)];
    writeStorage(STORAGE_KEYS.PRODUCTS, updated);
    return newProduct;
  },
  updateProduct: (id, updates) => {
    const list = dataStore.getProducts();
    const updated = list.map((p) => (String(p.id) === String(id) ? { ...p, ...updates } : p));
    writeStorage(STORAGE_KEYS.PRODUCTS, updated);
    return updated.find((p) => String(p.id) === String(id));
  },
  deleteProduct: (id) => {
    // Interdiction de suppression définitive (Règle CIMA) : remplacement par archivage
    return dataStore.archiveProduct(id);
  },
  archiveProduct: (id) => {
    return dataStore.updateProduct(id, {
      statut: 'Archivé',
      actif: false,
      active: false,
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },

  getGuarantees: () => readStorage(STORAGE_KEYS.GUARANTEES, INITIAL_GUARANTEES),
  saveGuarantee: (guaranteeData) => {
    const list = dataStore.getGuarantees();
    const newGuarantee = {
      id: guaranteeData.id || Date.now(),
      code: (guaranteeData.code || 'GAR').toUpperCase(),
      libelle: guaranteeData.libelle || 'Nouvelle Garantie',
      branche: guaranteeData.branche || 'Automobile',
      type: guaranteeData.type || 'Optionnelle',
      tarification: guaranteeData.tarification || 'Forfait Annuel',
      taxe_cima: guaranteeData.taxe_cima || '14.5%',
      fga: Boolean(guaranteeData.fga),
      active: true,
    };
    const updated = [newGuarantee, ...list.filter((g) => g.id !== newGuarantee.id)];
    writeStorage(STORAGE_KEYS.GUARANTEES, updated);
    return newGuarantee;
  },
  updateGuarantee: (id, updates) => {
    const list = dataStore.getGuarantees();
    const updated = list.map((g) => (String(g.id) === String(id) ? { ...g, ...updates } : g));
    writeStorage(STORAGE_KEYS.GUARANTEES, updated);
    return updated.find((g) => String(g.id) === String(id));
  },
  deleteGuarantee: (id) => {
    // Interdiction de suppression définitive (Règle CIMA) : remplacement par archivage
    return dataStore.archiveGuarantee(id);
  },
  archiveGuarantee: (id) => {
    return dataStore.updateGuarantee(id, {
      statut: 'Archivée',
      active: false,
      actif: false,
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },

  /* =========================================================================
     8. CATALOGUE : TARIFS & BAREMES
     ========================================================================= */
  getTarifs: () => readStorage(STORAGE_KEYS.TARIFS, INITIAL_TARIFS),
  saveTarif: (tarifData) => {
    const list = dataStore.getTarifs();
    const newTarif = {
      id: tarifData.id || Date.now(),
      libelle: tarifData.libelle || 'Nouvelle Grille',
      produit: tarifData.produit || 'Automobile VP',
      taux_taxe: tarifData.taux_taxe || '14.5%',
      frais_accessoires: tarifData.frais_accessoires || '15 000 FCFA',
      date_effet: tarifData.date_effet || new Date().toISOString().split('T')[0],
      statut: tarifData.statut || 'Vigueur',
      base_calcul: tarifData.base_calcul || 'Tarification CIMA standard',
    };
    const updated = [newTarif, ...list.filter((t) => t.id !== newTarif.id)];
    writeStorage(STORAGE_KEYS.TARIFS, updated);
    return newTarif;
  },
  updateTarif: (id, updates) => {
    const list = dataStore.getTarifs();
    const updated = list.map((t) => (String(t.id) === String(id) ? { ...t, ...updates } : t));
    writeStorage(STORAGE_KEYS.TARIFS, updated);
    return updated.find((t) => String(t.id) === String(id));
  },
  deleteTarif: (id) => {
    // Interdiction de suppression définitive (Règle CIMA) : remplacement par archivage
    return dataStore.archiveTarif(id);
  },
  archiveTarif: (id) => {
    return dataStore.updateTarif(id, {
      statut: 'Archivé',
      actif: false,
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },

  /**
   * getTarifForBranch: Calcule et extrait dynamiquement le taux de taxe et les frais accessoires
   * paramétrés pour une branche ou un produit donné. Si un administrateur ajuste la grille
   * dans CatalogTarifsPage, toutes les simulations et devis s'adaptent instantanément !
   */
  getTarifForBranch: (branche) => {
    const b = (branche || '').toLowerCase();
    const tarifs = dataStore.getTarifs();

    const match = tarifs.find((t) => {
      const p = (t.produit || '').toLowerCase();
      const lib = (t.libelle || '').toLowerCase();
      if (b.includes('auto') || b.includes('flotte')) return p.includes('auto') || lib.includes('auto');
      if (b.includes('mrh') || b.includes('habit') || b.includes('incendie')) return p.includes('mrh') || p.includes('habit') || lib.includes('mrh');
      if (b.includes('sant') || b.includes('maladie')) return p.includes('sant') || lib.includes('sant');
      if (b.includes('ia') || b.includes('accident') || b.includes('individuelle')) return p.includes('ia') || lib.includes('ia') || lib.includes('accident');
      if (b.includes('voyag') || b.includes('schengen')) return p.includes('voyag') || lib.includes('voyag');
      if (b.includes('transp') || b.includes('facult') || b.includes('cargo')) return p.includes('transp') || lib.includes('transp');
      return false;
    });

    let taxRate = 0.145; // Taux standard CIMA (14.5%)
    let accessoires = 15000;

    // Valeurs de repli par défaut selon la branche si aucun barème n'a encore été personnalisé
    if (b.includes('sant') || b.includes('maladie')) {
      taxRate = 0.0;
      accessoires = 50000;
    } else if (b.includes('ia') || b.includes('accident')) {
      taxRate = 0.145;
      accessoires = 5000;
    } else if (b.includes('voyag')) {
      taxRate = 0.145;
      accessoires = 5000;
    } else if (b.includes('transp')) {
      taxRate = 0.145;
      accessoires = 10000;
    } else if (b.includes('mrh')) {
      taxRate = 0.145;
      accessoires = 10000;
    }

    if (match) {
      if (match.taux_taxe) {
        const num = parseFloat(String(match.taux_taxe).replace('%', '').replace(',', '.').trim());
        if (!isNaN(num)) {
          taxRate = num / 100;
        }
      }
      if (match.frais_accessoires) {
        const digits = String(match.frais_accessoires).replace(/[^0-9]/g, '');
        if (digits) {
          accessoires = parseInt(digits, 10);
        }
      }
    }

    return {
      taxRate,
      accessoires,
      tarifRecord: match || null,
    };
  },

  /* =========================================================================
     9. COMPAGNIES PARTENAIRES
     ========================================================================= */
  getCompanies: () => readStorage(STORAGE_KEYS.COMPANIES, INITIAL_COMPANIES),
  getActiveCompanies: (branche = null) => {
    const list = dataStore.getCompanies();
    const active = list.filter((c) => c.statut !== 'Inactif' && c.statut !== 'Suspendu');
    if (!branche) return active;

    const b = String(branche).toLowerCase();
    const matched = active.filter((c) => {
      const branches = Array.isArray(c.branches)
        ? c.branches.join(' ').toLowerCase()
        : String(c.branches || '').toLowerCase();
      if (b.includes('auto')) return branches.includes('auto');
      if (b.includes('mrh') || b.includes('habit')) return branches.includes('mrh') || branches.includes('incendie') || branches.includes('dommage');
      if (b.includes('sant')) return branches.includes('sant');
      if (b.includes('ia') || b.includes('accident')) return branches.includes('ia') || branches.includes('accident') || branches.includes('corporel');
      if (b.includes('voyag')) return branches.includes('voyag') || branches.includes('assistance');
      if (b.includes('transp')) return branches.includes('transp') || branches.includes('maritime') || branches.includes('caution');
      return true;
    });

    return matched.length > 0 ? matched : active;
  },
  saveCompany: (companyData) => {
    const list = dataStore.getCompanies();
    const newCompany = {
      id: companyData.id || Date.now(),
      code: (companyData.code || 'CIE').toUpperCase(),
      nom: companyData.nom || 'Nouvelle Compagnie',
      code_asaci: (companyData.code_asaci || `ASACI_${companyData.code || 'CIE'}`).toUpperCase(),
      telephone: companyData.telephone || '+225 27 00 00 00 00',
      email: companyData.email || 'contact@compagnie.ci',
      branches: companyData.branches || 'Auto, MRH, Santé',
      statut: companyData.statut || 'Partenaire Actif',
    };
    const updated = [newCompany, ...list.filter((c) => c.id !== newCompany.id)];
    writeStorage(STORAGE_KEYS.COMPANIES, updated);
    return newCompany;
  },
  updateCompany: (id, updates) => {
    const list = dataStore.getCompanies();
    const updated = list.map((c) => (String(c.id) === String(id) || c.code === id ? { ...c, ...updates } : c));
    writeStorage(STORAGE_KEYS.COMPANIES, updated);
    return updated.find((c) => String(c.id) === String(id) || c.code === id);
  },
  deleteCompany: (id) => {
    // Interdiction de suppression définitive : remplacement par archivage
    return dataStore.archiveCompany(id);
  },
  archiveCompany: (id) => {
    return dataStore.updateCompany(id, {
      statut: 'Archivée',
      actif: false,
      active: false,
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },

  /* =========================================================================
     10. VEHICULES, ZONES GEOGRAPHIQUES & PARAMETRAGES METIERS
     ========================================================================= */
  getVehicles: () => readStorage(STORAGE_KEYS.VEHICLES, INITIAL_VEHICLES),
  saveVehicle: (vData) => {
    const list = dataStore.getVehicles();
    const newV = {
      id: vData.id || Date.now(),
      code: (vData.code || 'V').toUpperCase(),
      libelle: vData.libelle || 'Nouveau Genre',
      usage: vData.usage || 'Usage Standard',
      taux_base: String(vData.taux_base || '1.0'),
    };
    const updated = [newV, ...list.filter((v) => v.id !== newV.id)];
    writeStorage(STORAGE_KEYS.VEHICLES, updated);
    return newV;
  },
  updateVehicle: (id, updates) => {
    const list = dataStore.getVehicles();
    const updated = list.map((v) => (String(v.id) === String(id) || v.code === id ? { ...v, ...updates } : v));
    writeStorage(STORAGE_KEYS.VEHICLES, updated);
    return updated.find((v) => String(v.id) === String(id) || v.code === id);
  },
  deleteVehicle: (id) => {
    return dataStore.updateVehicle(id, {
      statut: 'Archivé',
      actif: false,
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },

  getGeoZones: () => readStorage(STORAGE_KEYS.GEOZONES, INITIAL_GEOZONES),
  saveGeoZone: (zData) => {
    const list = dataStore.getGeoZones();
    const newZ = {
      id: zData.id || Date.now(),
      code: (zData.code || 'ZONE').toUpperCase(),
      zone: zData.zone || 'Nouvelle Zone',
      pays: zData.pays || "Côte d'Ivoire",
      coefficient_risque: String(zData.coefficient_risque || '1.00'),
    };
    const updated = [newZ, ...list.filter((z) => z.id !== newZ.id)];
    writeStorage(STORAGE_KEYS.GEOZONES, updated);
    return newZ;
  },
  updateGeoZone: (id, updates) => {
    const list = dataStore.getGeoZones();
    const updated = list.map((z) => (String(z.id) === String(id) || z.code === id ? { ...z, ...updates } : z));
    writeStorage(STORAGE_KEYS.GEOZONES, updated);
    return updated.find((z) => String(z.id) === String(id) || z.code === id);
  },
  deleteGeoZone: (id) => {
    return dataStore.updateGeoZone(id, {
      statut: 'Archivé',
      actif: false,
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },

  // Voyage: Zones & Formules
  getVoyageZones: () => readStorage(STORAGE_KEYS.VOYAGE_ZONES, INITIAL_VOYAGE_ZONES),
  saveVoyageZone: (zoneData) => {
    const list = dataStore.getVoyageZones();
    const newZone = {
      id: zoneData.id || `zone_${Date.now()}`,
      code: (zoneData.code || 'ZONE').toUpperCase(),
      label: zoneData.label || 'Nouvelle Zone',
      description: zoneData.description || '',
      baseRateMultiplier: parseFloat(zoneData.baseRateMultiplier) || 1.0,
      schengenCompliant: Boolean(zoneData.schengenCompliant),
    };
    const updated = [newZone, ...list.filter((z) => z.id !== newZone.id)];
    writeStorage(STORAGE_KEYS.VOYAGE_ZONES, updated);
    return newZone;
  },
  updateVoyageZone: (id, updates) => {
    const list = dataStore.getVoyageZones();
    const updated = list.map((z) => (String(z.id) === String(id) || z.code === id ? { ...z, ...updates } : z));
    writeStorage(STORAGE_KEYS.VOYAGE_ZONES, updated);
    return updated.find((z) => String(z.id) === String(id) || z.code === id);
  },
  deleteVoyageZone: (id) => {
    return dataStore.updateVoyageZone(id, {
      statut: 'Archivé',
      actif: false,
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },

  getVoyageFormules: () => readStorage(STORAGE_KEYS.VOYAGE_FORMULES, INITIAL_VOYAGE_FORMULES),
  saveVoyageFormule: (formuleData) => {
    const list = dataStore.getVoyageFormules();
    const newFormule = {
      id: formuleData.id || `formule_${Date.now()}`,
      code: (formuleData.code || 'FORMULE').toUpperCase(),
      nom: formuleData.nom || 'Nouvelle Formule',
      description: formuleData.description || '',
      plafondMedicalEur: formuleData.plafondMedicalEur || '30 000 € (~19 680 000 FCFA)',
      rapatriement: formuleData.rapatriement || '100% Frais réels',
      bagages: formuleData.bagages || 'Non inclus',
      rcEtranger: formuleData.rcEtranger || 'Non inclus',
      basePerDay: Number(formuleData.basePerDay) || 2000,
    };
    const updated = [newFormule, ...list.filter((f) => f.id !== newFormule.id)];
    writeStorage(STORAGE_KEYS.VOYAGE_FORMULES, updated);
    return newFormule;
  },
  updateVoyageFormule: (id, updates) => {
    const list = dataStore.getVoyageFormules();
    const updated = list.map((f) => (String(f.id) === String(id) || f.code === id ? { ...f, ...updates } : f));
    writeStorage(STORAGE_KEYS.VOYAGE_FORMULES, updated);
    return updated.find((f) => String(f.id) === String(id) || f.code === id);
  },
  deleteVoyageFormule: (id) => {
    return dataStore.updateVoyageFormule(id, {
      statut: 'Archivée',
      actif: false,
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },

  // Transport: Modes & Natures
  getTransportModes: () => readStorage(STORAGE_KEYS.TRANSPORT_MODES, INITIAL_TRANSPORT_MODES),
  saveTransportMode: (modeData) => {
    const list = dataStore.getTransportModes();
    const newMode = {
      id: modeData.id || `mode_${Date.now()}`,
      code: (modeData.code || 'MODE').toUpperCase(),
      label: modeData.label || 'Nouveau Mode de Transport',
      description: modeData.description || '',
      baseRate: parseFloat(modeData.baseRate) || 0.003,
    };
    const updated = [newMode, ...list.filter((m) => m.id !== newMode.id)];
    writeStorage(STORAGE_KEYS.TRANSPORT_MODES, updated);
    return newMode;
  },
  updateTransportMode: (id, updates) => {
    const list = dataStore.getTransportModes();
    const updated = list.map((m) => (String(m.id) === String(id) || m.code === id ? { ...m, ...updates } : m));
    writeStorage(STORAGE_KEYS.TRANSPORT_MODES, updated);
    return updated.find((m) => String(m.id) === String(id) || m.code === id);
  },
  deleteTransportMode: (id) => {
    return dataStore.updateTransportMode(id, {
      statut: 'Archivé',
      actif: false,
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },

  getTransportNatures: () => readStorage(STORAGE_KEYS.TRANSPORT_NATURES, INITIAL_TRANSPORT_NATURES),
  saveTransportNature: (natureData) => {
    const list = dataStore.getTransportNatures();
    const newNature = {
      id: natureData.id || `nat_${Date.now()}`,
      code: (natureData.code || 'NAT').toUpperCase(),
      label: natureData.label || 'Nouvelle Nature de Marchandise',
      riskCoeff: parseFloat(natureData.riskCoeff) || 1.0,
    };
    const updated = [newNature, ...list.filter((n) => n.id !== newNature.id)];
    writeStorage(STORAGE_KEYS.TRANSPORT_NATURES, updated);
    return newNature;
  },
  updateTransportNature: (id, updates) => {
    const list = dataStore.getTransportNatures();
    const updated = list.map((n) => (String(n.id) === String(id) || n.code === id ? { ...n, ...updates } : n));
    writeStorage(STORAGE_KEYS.TRANSPORT_NATURES, updated);
    return updated.find((n) => String(n.id) === String(id) || n.code === id);
  },
  deleteTransportNature: (id) => {
    return dataStore.updateTransportNature(id, {
      statut: 'Archivée',
      actif: false,
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },

  /* =========================================================================
     11. CONVENTIONS
     ========================================================================= */
  getConventions: () => readStorage(STORAGE_KEYS.CONVENTIONS, mockConventions),
  saveConvention: (cData) => {
    const list = dataStore.getConventions();
    const newCnv = {
      id: cData.id || Date.now(),
      code: cData.code || cData.code_convention || `CNV-2026-${String(list.length + 1).padStart(3, '0')}`,
      compagnie: cData.compagnie || 'Nouvelle Compagnie',
      sigle: cData.sigle || cData.code_partenaire || 'CIE',
      statut: 'Actif',
      date_effet: cData.date_effet || '2026-01-01',
      date_echeance: cData.date_echeance || cData.date_renouvellement || '2026-12-31',
      delai_reversement_jours: Number(cData.delai_reversement_jours || 30),
      mandat_encaissement: cData.mandat_encaissement ?? cData.encaissement_delegue ?? true,
      seuil_delegation_sinistre: Number(cData.seuil_delegation_sinistre || cData.plafond_delegation_sinistre || 5000000),
      plafond_delegation_sinistre: Number(cData.plafond_delegation_sinistre || cData.seuil_delegation_sinistre || 5000000),
      taux_participation_beneficiaire: cData.taux_participation_beneficiaire || '15%',
      commissions: cData.commissions || cData.commissions_branches || {
        auto: '12%',
        mrh: '18%',
        sante: '10%',
        transport: '10%',
      },
    };
    const updated = [newCnv, ...list.filter((c) => c.id !== newCnv.id)];
    writeStorage(STORAGE_KEYS.CONVENTIONS, updated);
    return newCnv;
  },
  updateConvention: (id, updates) => {
    const list = dataStore.getConventions();
    const updated = list.map((c) => (String(c.id) === String(id) || c.code === id ? { ...c, ...updates } : c));
    writeStorage(STORAGE_KEYS.CONVENTIONS, updated);
    return updated.find((c) => String(c.id) === String(id) || c.code === id);
  },
  deleteConvention: (id) => {
    return dataStore.updateConvention(id, {
      statut: 'Archivée',
      actif: false,
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },

  /* =========================================================================
     12. DEROGATIONS
     ========================================================================= */
  getDerogations: () => readStorage(STORAGE_KEYS.DEROGATIONS, mockDerogations),
  saveDerogation: (dData) => {
    const list = dataStore.getDerogations();
    const newD = {
      id: dData.id || Date.now(),
      type_operation: dData.type_operation || 'ANNUL_ENC',
      type_label: dData.type_label || "Demande d'autorisation",
      objet: dData.objet || 'Demande de dérogation',
      demandeur_nom: dData.demandeur_nom || 'Opérateur LE PHARE',
      date_demande: dData.date_demande || new Date().toISOString().replace('T', ' ').substring(0, 16),
      approbateur_nom: dData.approbateur_nom || 'Franck Gnogouri (Direction)',
      statut: dData.statut || 'PENDING',
      statut_label: dData.statut_label || 'En attente',
      statut_badge: dData.statut === 'APPROVED' ? 'emerald' : (dData.statut === 'REJECTED' ? 'rose' : 'amber'),
      code_jeton: dData.code_jeton || null,
    };
    const updated = [newD, ...list.filter((d) => d.id !== newD.id)];
    writeStorage(STORAGE_KEYS.DEROGATIONS, updated);
    return newD;
  },
  updateDerogation: (id, updates) => {
    const list = dataStore.getDerogations();
    const updated = list.map((d) => (String(d.id) === String(id) ? { ...d, ...updates } : d));
    writeStorage(STORAGE_KEYS.DEROGATIONS, updated);
    return updated.find((d) => String(d.id) === String(id));
  },

  /* =========================================================================
     13. UTILISATEURS & ROLES
     ========================================================================= */
  getUsers: () => readStorage(STORAGE_KEYS.USERS, mockUsers),
  saveUser: (uData) => {
    const list = dataStore.getUsers();
    const newU = {
      id: uData.id || Date.now(),
      username: uData.username || `user_${Date.now()}`,
      email: uData.email || 'utilisateur@lephare-ci.com',
      first_name: uData.first_name || '',
      last_name: uData.last_name || '',
      role: uData.role || 'USER',
      role_label: uData.role_label || 'Opérateur / Souscripteur',
      profile_code: uData.profile_code || 'SOUSCRIPTEUR_GUICHET',
      avatar: uData.avatar || `${(uData.first_name || 'U')[0]}${(uData.last_name || 'R')[0]}`,
      is_active: true,
    };
    const updated = [newU, ...list.filter((u) => u.id !== newU.id)];
    writeStorage(STORAGE_KEYS.USERS, updated);
    return newU;
  },


  /* =========================================================================
     15. COMMISSIONS APPORTEURS & COURTIERS
     ========================================================================= */
  getCommissions: () => readStorage(STORAGE_KEYS.COMMISSIONS, INITIAL_COMMISSIONS),
  saveCommission: (commData) => {
    const list = dataStore.getCommissions();
    const newComm = {
      id: commData.id || Date.now(),
      apporteur: commData.apporteur || 'Cabinet Partenaire',
      contrat: commData.contrat || 'POL-2026-001',
      client: commData.client || 'Client Assuré',
      branche: commData.branche || 'Automobile Flotte',
      plafond_cima: commData.plafond_cima || '10% max',
      prime_nette: Number(commData.prime_nette || 0),
      prime_encaissee: Boolean(commData.prime_encaissee),
      taux_commission: commData.taux_commission || '10%',
      montant_commission: Number(commData.montant_commission || 0),
      statut: commData.statut || 'En attente',
      statut_badge: commData.statut === 'Payé' ? 'emerald' : 'amber',
    };
    const updated = [newComm, ...list.filter((c) => c.id !== newComm.id)];
    writeStorage(STORAGE_KEYS.COMMISSIONS, updated);
    return newComm;
  },
  updateCommission: (id, updates) => {
    const list = dataStore.getCommissions();
    const updated = list.map((c) => (String(c.id) === String(id) ? { ...c, ...updates } : c));
    writeStorage(STORAGE_KEYS.COMMISSIONS, updated);
    return updated.find((c) => String(c.id) === String(id));
  },

  /* =========================================================================
     16. CRM PROSPECTS & LEADS
     ========================================================================= */
  getLeads: () => readStorage(STORAGE_KEYS.LEADS, mockLeads || []),
  saveLead: (leadData) => {
    const list = dataStore.getLeads();
    const newLead = {
      id: leadData.id || Date.now(),
      id_lead: leadData.id_lead || `PROSP-2026-${String(list.length + 1).padStart(3, '0')}`,
      nom_prospect: leadData.nom_prospect || 'Nouveau Prospect',
      contact: leadData.contact || '',
      telephone: leadData.telephone || '',
      email: leadData.email || '',
      branche: leadData.branche || 'Automobile',
      prime_estimee: Number(leadData.prime_estimee || 0),
      statut: leadData.statut || 'Nouveau',
      commercial_attribue: leadData.commercial_attribue || 'Koffi Serge',
      prochaine_action: leadData.prochaine_action || 'Relance commerciale',
      date_action: leadData.date_action || new Date().toISOString().split('T')[0],
      probabilite: leadData.probabilite || 50,
      historique_echanges: leadData.historique_echanges || [
        { date: new Date().toISOString().split('T')[0], auteur: leadData.commercial_attribue || 'Opérateur', action: 'Création prospect' }
      ],
    };
    const updated = [newLead, ...list.filter((l) => l.id !== newLead.id && l.id_lead !== newLead.id_lead)];
    writeStorage(STORAGE_KEYS.LEADS, updated);
    return newLead;
  },
  updateLead: (idOrIdLead, updates) => {
    const list = dataStore.getLeads();
    const updated = list.map((l) =>
      String(l.id) === String(idOrIdLead) || l.id_lead === idOrIdLead ? { ...l, ...updates } : l
    );
    writeStorage(STORAGE_KEYS.LEADS, updated);
    return updated.find((l) => String(l.id) === String(idOrIdLead) || l.id_lead === idOrIdLead);
  },
  deleteLead: (idOrIdLead) => {
    // Règle CRM : Archivage du prospect pour conservation de l'historique
    return dataStore.updateLead(idOrIdLead, {
      statut: 'Archivé / Perdu',
      archive: true,
      date_archivage: new Date().toISOString().split('T')[0],
    });
  },
};
