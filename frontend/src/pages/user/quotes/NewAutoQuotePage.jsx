import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { dataStore } from '../../../api/dataStore';
import { quoteApi, customerApi, settingsApi, contractApi, brouillonApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import {
  Car,
  Shield,
  Check,
  Calculator,
  ArrowRight,
  ArrowLeft,
  Percent,
  Clock,
  Award,
  Building2,
  Plus,
  UserPlus,
  Layers,
  Trash2,
  FileText,
  User,
  Zap,
  RotateCcw,
  Save,
  CheckCircle2,
  AlertCircle,
  X,
  Edit3,
} from 'lucide-react';
import { ViewQuoteModal } from './ViewQuoteModal';
import { GarantiesVehiculeFlotteModal } from './GarantiesVehiculeFlotteModal';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { TermeContratSelect } from '../../../components/common/TermeContratSelect';
import { DureeContratSelect } from '../../../components/common/DureeContratSelect';
import {
  DUREES_CONTRAT,
  ID_TERME_PAR_DEFAUT,
  dureeSelonTerme,
  libelleTerme,
  termeEtDureeEnregistres,
} from '../../../utils/termesContrat';
import { QuickAddClientModal } from '../clients/QuickAddClientModal';
import { sortUniqueBy, trierParLibelle } from '../../../utils/sortUtils';
import { AmountInput } from '../../../components/common/AmountInput';
import {
  baseAccessoireAuto,
  calculerTotauxDevisAuto,
  cedeaoDansPrimeNette,
  estGarantieRc,
  extraireLigneCumul,
  ID_SOUS_GARANTIE_NSIA_AUTO_PLUS,
  ID_SOUS_GARANTIE_CEDEAO,
} from '../../../utils/tarificationAuto';

// Références conformes Django std & CIMA pour fallback instantané si API indisponible
// Code branche CIMA (stdbranche) du produit Automobile : seules les catégories 2xx sont proposées
const BRANCHE_AUTOMOBILE = '200';

// Tarifs commerciaux nommés (TARIF TECK, BAOBAB, EBENE…) : grilles stdtarif rattachées à une
// catégorie CIMA par son code (201, 202…), proposées dans « Tarifs spécifiques » et non dans « Catégorie »
const estTarifSpecifique = (cat) => /^TARIF\b/i.test(String(cat?.libelle || '').trim());

const DEFAULT_CATEGORIES = [
  { id: 13, code: '201', libelle: 'PROMENADE & AFFAIRES' },
  { id: 14, code: '202', libelle: 'TRANSPORT POUR PROPRE COMPTE' },
  { id: 15, code: '203', libelle: 'TRANSPORT PUBLIC DE MARCHANDISES' },
  { id: 16, code: '204', libelle: 'TRANSPORT PUBLIC DE VOYAGEURS' },
  { id: 22, code: '210', libelle: 'VÉHICULES SPÉCIAUX' },
];

const DEFAULT_USAGES = [
  { id: 1, code: '001', libelle: 'VEHICULE DE TOURISME' },
  { id: 2, code: '002', libelle: 'UTILITAIRE COMMERCIAL' },
  { id: 3, code: '003', libelle: 'TRANSPORT DE PERSONNEL' },
  { id: 4, code: '004', libelle: 'TAXIS URBAINS & GBAKA' },
  { id: 5, code: '005', libelle: 'AMBULANCE ET VEHICULE DE SECOURS' },
];

const DEFAULT_CARROSSERIES = [
  { id: 1, libelle: 'CAMIONNETTE' },
  { id: 2, libelle: 'BERLINE' },
  { id: 3, libelle: 'BREAK / STATION WAGON' },
  { id: 4, libelle: 'FOURGONNETTE' },
  { id: 5, libelle: 'TRACTEUR ROUTIER' },
  { id: 6, libelle: 'PICK-UP DOUBLE CABINE' },
  { id: 7, libelle: 'BENNE BASCULANTE' },
];

// Libellé de la durée (transmis dans details.dureeContrat) : « Libre » pour la durée du terme « Autre »
const libelleDuree = (idDuree) => DUREES_CONTRAT.find((d) => d.id === Number(idDuree))?.libelle || 'Libre';

const DEFAULT_SYSTEMES_SECURITE = [
  { id: 0, code: 0, libelle: 'AUCUN SYSTEME' },
  { id: 1, code: 1, libelle: 'ALARME' },
  { id: 2, code: 2, libelle: 'COUPE-CIRCUIT' },
  { id: 3, code: 3, libelle: 'TRACKING GPS' },
  { id: 4, code: 4, libelle: 'ALARME + GPS' },
];

const DEFAULT_MARQUES = [
  { id: 1, libelle: 'ALFA ROMEO' },
  { id: 2, libelle: 'TOYOTA' },
  { id: 3, libelle: 'RENAULT' },
  { id: 4, libelle: 'PEUGEOT' },
  { id: 5, libelle: 'MERCEDES-BENZ' },
  { id: 6, libelle: 'HYUNDAI' },
  { id: 7, libelle: 'NISSAN' },
  { id: 8, libelle: 'KIA' },
  { id: 9, libelle: 'MITSUBISHI' },
  { id: 10, libelle: 'VOLKSWAGEN' },
];

const DEFAULT_GENRES = [
  { id: 1, libelle: 'Véhicule Particulier (Tourisme)', coef: 1.0 },
  { id: 2, libelle: 'Camion', coef: 1.6 },
  { id: 3, libelle: 'Camionnette / Fourgon', coef: 1.25 },
  { id: 4, libelle: 'Tracteur Routier', coef: 1.8 },
  { id: 5, libelle: 'Deux / Trois Roues', coef: 0.8 },
];

const DEFAULT_TYPES_COMMERCIAUX = [
  { id: 1, libelle: 'Ambulance' },
  { id: 2, libelle: 'Véhicule de Société' },
  { id: 3, libelle: 'Usage Personnel & Trajets' },
  { id: 4, libelle: 'Taxi Urbain' },
  { id: 5, libelle: 'Transport Interurbain' },
];

const DEFAULT_CATEGORIES_PERMIS = [
  { id: 0, code: 'INFO_NON_DISPO', libelle: 'INFO NON DISPONIBLE' },
  { id: 1, code: 'A', libelle: 'PERMIS A (Motos)' },
  { id: 2, code: 'B', libelle: 'PERMIS B (Tourisme & Léger)' },
  { id: 3, code: 'BCDE', libelle: 'PERMIS BCDE (Tous Véhicules/Poids Lourds)' },
];

const DEFAULT_OFFRES = [
  { id: 1, code: 'TOUS_RISQUES', libelle: 'OFFRE AUTOMOBILE TOUS RISQUES' },
  { id: 2, code: 'TIERS_SIMPLE', libelle: 'OFFRE AU TIERS SIMPLE (RC SEULE)' },
  { id: 3, code: 'TIERS_COLLISION', libelle: 'OFFRE TIERS COMPLET (VOL + INCENDIE + BRIS)' },
];

// Tuiles financières du mode "Imposer la prime" : null = la tuile n'est pas saisie à la main et
// suit en temps réel le total calculé à partir des garanties.
const TUILES_NON_IMPOSEES = { taxe: null, fga: null, accessoire: null, pa: null, pn: null, ttc: null };

// Message d'erreur lisible d'un appel d'enregistrement (erreurs DRF ou OutputMessage des procédures)
const messageEnregistrement = (e) => {
  const reponse = e?.response?.data;
  // Erreurs de validation Django ({ "Valeur accessoire": ["…"] }) : seuls les messages sont affichés
  const messagesValidation = reponse && typeof reponse === 'object'
    ? Object.values(reponse).flat(Infinity).filter((m) => typeof m === 'string').join(' ; ')
    : '';
  const detail = Array.isArray(reponse)
    ? reponse[0]?.OutputMessage
    : (reponse?.OutputMessage || reponse?.detail || messagesValidation
      || (reponse && typeof reponse === 'object' ? JSON.stringify(reponse) : null));
  return detail || e?.message || 'erreur du serveur';
};

// Garanties d'un véhicule telles que le moteur CIMA les calcule (fn_garantie_offre)
const garantiesDepuisMoteur = (lignes, places = 5) => (lignes || [])
  .filter((item) => item.IdGarantie !== 0 && item.LibelleSousGarantie)
  .map((item) => ({
    id_garantie: item.IdSousGarantie || item.IdGarantie,
    code: `GAR_${item.IdSousGarantie || item.IdGarantie}`,
    nom: item.LibelleSousGarantie,
    acquise: Boolean(item.Acquise ?? true),
    capital: item.Capital ? `${Number(item.Capital).toLocaleString('fr-FR')} F` : 'Néant',
    franchise: item.TexteFranchise || (item.Franchise ? `${item.Franchise} F` : 'Néant'),
    formule: item.Formule || 'CIMA Standard',
    place: item.NombrePlace || places || 5,
    primeAnnuelle: Number(item.PrimeAnnuelle || 0),
    primeNette: Number(item.PrimeNette || 0),
    taxe: Number(item.Taxe || 0),
    primeNetteOrigine: Number(item.PrimeNette || 0),
    is_new_garantie: false,
  }));

// Garanties réellement enregistrées d'un véhicule (stddevisdetgarantie)
const garantiesDepuisDevis = (lignes, places = 5) => (lignes || []).map((g) => ({
  id_garantie: g.IdGarantie,
  code: `GAR_${g.IdGarantie}`,
  nom: g.libellegarantie || `Garantie #${g.IdGarantie}`,
  acquise: Boolean(g.Acquise),
  capital: g.Capital ? `${Number(g.Capital).toLocaleString('fr-FR')} F` : 'Néant',
  franchise: g.TexteFranchise || 'Néant',
  formule: 'CIMA Standard',
  place: places || 5,
  primeAnnuelle: Number(g.primeannuelle || 0),
  primeNette: Number(g.PrimeNette || 0),
  taxe: Number(g.taxe || 0),
  primeNetteOrigine: Number(g.PrimeNette || 0),
  is_new_garantie: false,
}));

// Champs d'un véhicule transmis à sp_creation_devis : un véhicule de flotte n'est renvoyé à
// l'enregistrement que si l'un d'eux a changé (ses primes enregistrées sont sinon conservées)
const CHAMPS_VEHICULE = [
  'idTarif', 'codeUsage', 'idCarrosserie', 'idOffre', 'codeCarburant', 'codeAlarme', 'codeFormuleSecuriteRoutiere',
  'idOptionAssistance', 'idMarque', 'idGenreVehicule', 'typeCommercial', 'remorqueAttelee', 'modeleVehicule',
  'puissanceFiscale', 'chargeUtile', 'nombrePlace', 'valeurNeuf', 'valeurVenale', 'valeurAccessoire', 'immatriculation',
  'numeroCarteBrune', 'numeroChassis', 'numeroMoteur', 'dateMec', 'carburantAutreMatiere', 'transportEleves',
  'transportEmployes', 'transportPassagerSupplementaire', 'nsiaAutoPlus',
];
const empreinteVehicule = (v) => JSON.stringify(CHAMPS_VEHICULE.map((champ) => {
  const valeur = v?.[champ];
  if (typeof valeur === 'boolean') return valeur;
  if (typeof valeur === 'number') return valeur;
  return String(valeur ?? '').trim().toUpperCase();
}));

// Clé des garanties personnalisées du véhicule saisi à l'écran Véhicule, pas encore dans la flotte
const CLE_SAISIE = '__saisie__';

// Garanties personnalisées envoyées à /api/garantiesvehiculeflotte/ : une garantie décochée est
// omise (le serveur additionne toutes les lignes d'un véhicule, acquises ou non)
const listeGarantiesVehicule = (garanties) => garanties
  .filter((g) => g.acquise)
  .map((g) => ({
    id_garantie: Number(g.id_garantie),
    prime_annuelle: Math.round(Number(g.primeAnnuelle) || 0),
    prime_nette: Math.round(Number(g.primeNette) || 0),
    capital: g.is_new_garantie ? Number(g.capitalMontant) || 0 : null,
  }));

// Formateur DD-MM-YYYY pour Django
const toDmy = (dStr) => {
  if (!dStr) return '';
  if (dStr.includes('-') && dStr.split('-')[0].length === 4) {
    const [y, m, d] = dStr.split('-');
    return `${d}-${m}-${y}`;
  }
  return dStr.replace(/\//g, '-');
};

export const NewAutoQuotePage = () => {
  const navigate = useNavigate();
  const { success, error: toastError, info } = useToast();

  // Navigation étapes : 1 = CONTRAT, 2 = VÉHICULE, 3 = OFFRE & DÉCOMPTE, 4 = CLIENT/ASSURÉ/CONDUCTEUR
  const [step, setStep] = useState(1);
  const [createdQuote, setCreatedQuote] = useState(null);
  const [loadingCalculation, setLoadingCalculation] = useState(false);

  // Données de référence
  const [clients, setClients] = useState([]);
  const [companies, setCompanies] = useState(() => dataStore.getActiveCompanies('Auto'));
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [usages, setUsages] = useState(DEFAULT_USAGES);
  const [carrosseries, setCarrosseries] = useState(DEFAULT_CARROSSERIES);
  const [marques, setMarques] = useState(DEFAULT_MARQUES);
  const [genres, setGenres] = useState(DEFAULT_GENRES);
  const [systemesSecurite, setSystemesSecurite] = useState(DEFAULT_SYSTEMES_SECURITE);
  const [typesVehicules, setTypesVehicules] = useState(DEFAULT_TYPES_COMMERCIAUX);
  const [categoriesPermis, setCategoriesPermis] = useState(DEFAULT_CATEGORIES_PERMIS);
  const [offresList, setOffresList] = useState(DEFAULT_OFFRES);
  const [sousGarantiesAll, setSousGarantiesAll] = useState([]);
  const [formulesSecurite, setFormulesSecurite] = useState([
    { code: 'AUCUNE', libelle: 'AUCUNE FORMULE' },
    { code: 'STD', libelle: 'SECURITE ROUTIERE STANDARD' },
    { code: 'CONFORT', libelle: 'SECURITE ROUTIERE CONFORT (Plafond 1M)' },
  ]);
  const [formulesAssistance, setFormulesAssistance] = useState([
    { id: 0, libelle: 'AUCUNE OPTION' },
    { id: 1, libelle: 'ASSISTANCE CLASSIC (Remorquage 50km)' },
    { id: 2, libelle: 'ASSISTANCE CONFORT (+ Véhicule relais)' },
  ]);

  // Modal ajouts
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);
  const [isAddMarqueModalOpen, setIsAddMarqueModalOpen] = useState(false);
  const [newMarqueInput, setNewMarqueInput] = useState('');
  const [isAddGarantieModalOpen, setIsAddGarantieModalOpen] = useState(false);
  const [selectedSousGarantieId, setSelectedSousGarantieId] = useState('');
  const [newGarantieForm, setNewGarantieForm] = useState({
    capital: '0',
    prime_annuelle: '0',
    prime_nette: '0',
    montant_franchise: '0',
    taux_franchise: '0',
    franchise_minimum: '0',
    franchise_maximum: '0',
    capital_deces: '0',
    capital_ipp: '0',
    capital_ft: '0',
    reduction_commerciale: '0',
    reduction_bns: '0',
    acquise: true,
  });

  // ----------------------------------------------------
  // ÉCRAN 1 : CONTRAT
  // ----------------------------------------------------
  const [typeContrat, setTypeContrat] = useState('MONO'); // 'MONO' | 'FLOTTE'
  const [numeroPoliceCompagnie, setNumeroPoliceCompagnie] = useState('');
  const [compagnieId, setCompagnieId] = useState(1);
  const [compagnie, setCompagnie] = useState(() => companies[0]?.nom || 'AXA ASSURANCES');
  const [categorieId, setCategorieId] = useState(1);
  const [categorieContrat, setCategorieContrat] = useState('PROMENADE ET AFFAIRES');
  const [usageId, setUsageId] = useState(1);
  const [usageVehicule, setUsageVehicule] = useState('VEHICULE DE TOURISME');
  const [carrosserieId, setCarrosserieId] = useState(1);
  const [carrosserie, setCarrosserie] = useState('CAMIONNETTE');
  const [reductionCommerciale, setReductionCommerciale] = useState(0);
  const [bonusMalus, setBonusMalus] = useState(0);
  const [termeContrat, setTermeContrat] = useState(libelleTerme(ID_TERME_PAR_DEFAUT));
  const [termeId, setTermeId] = useState(ID_TERME_PAR_DEFAUT);

  // Détection dynamique OREOLE selon la Compagnie (NSIA id=1 ou nom contient NSIA)
  const isNsiaCompany = useMemo(() => {
    return Number(compagnieId) === 1 || (compagnie && compagnie.toUpperCase().includes('NSIA'));
  }, [compagnieId, compagnie]);

  // Détection dynamique OREOLE selon la Catégorie / Tarif CIMA
  const transportCompteAssure = useMemo(() => {
    return Boolean(categorieContrat && categorieContrat.toUpperCase().includes("TRANSPORT POUR LE COMPTE DE L'ASSURE"));
  }, [categorieContrat]);

  const transportPublicMarchandise = useMemo(() => {
    return Boolean(categorieContrat && (categorieContrat.toUpperCase().includes('TRANSPORT PUBLIC DE MARCHANDISES') || categorieContrat.toUpperCase().includes('TPM')));
  }, [categorieContrat]);

  // Les options spécifiques de transport s'affichent si la catégorie le requiert (conforme OREOLE)
  const showTransportOptions = transportCompteAssure || transportPublicMarchandise;

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  // Date d'émission : toujours la date du jour, jamais saisie (le serveur l'impose aussi)
  const dateEmission = todayStr;
  const [dateEffet, setDateEffet] = useState(todayStr);
  const [dureeId, setDureeId] = useState(4); // 1: 1M, 2: 3M, 3: 6M, 4: 12M, 5: libre (terme « Autre »)
  const [dureeContrat, setDureeContrat] = useState('Annuelle');
  const [customDateExpiration, setCustomDateExpiration] = useState('');

  // Calcul dynamique de la Date d'expiration selon Date Effet + Durée
  const calculatedDateExpiration = useMemo(() => {
    if (!dateEffet) return '';
    if (Number(dureeId) === 5) {
      return customDateExpiration || '';
    }
    const d = new Date(dateEffet);
    let monthsToAdd = 12;
    if (Number(dureeId) === 1) monthsToAdd = 1;
    else if (Number(dureeId) === 2) monthsToAdd = 3;
    else if (Number(dureeId) === 3) monthsToAdd = 6;
    else if (Number(dureeId) === 4) monthsToAdd = 12;
    d.setMonth(d.getMonth() + monthsToAdd);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }, [dateEffet, dureeId, customDateExpiration]);

  const effectiveDateExpiration = Number(dureeId) === 5 ? (customDateExpiration || calculatedDateExpiration) : calculatedDateExpiration;

  // ----------------------------------------------------
  // ÉCRAN 2 : VÉHICULE & FLOTTE
  // ----------------------------------------------------
  const [energieId, setEnergieId] = useState(1); // 1: Essence, 2: Diesel, 3: Hybride, 4: Electrique
  const [energie, setEnergie] = useState('Essence');
  const [systemeSecuriteId, setSystemeSecuriteId] = useState(1);
  const [systemeSecurite, setSystemeSecurite] = useState('ALARME');
  const [formuleSecuriteCode, setFormuleSecuriteCode] = useState('AUCUNE');
  const [formuleAssistanceId, setFormuleAssistanceId] = useState(0);
  const [marqueId, setMarqueId] = useState(1);
  const [marqueVehicule, setMarqueVehicule] = useState('ALFA ROMEO');
  const [genreId, setGenreId] = useState(1);
  const [genreVehicule, setGenreVehicule] = useState('Véhicule Particulier (Tourisme)');
  const [typeCommercial, setTypeCommercial] = useState('Usage Personnel & Trajets');
  const [remorqueAttelee, setRemorqueAttelee] = useState(false);
  const [modeleVehicule, setModeleVehicule] = useState('');
  const [puissanceFiscale, setPuissanceFiscale] = useState(7);
  const [chargeUtile, setChargeUtile] = useState(0);
  const [nombrePlace, setNombrePlace] = useState(5);
  const [valeurNeuf, setValeurNeuf] = useState(0);
  const [valeurVenale, setValeurVenale] = useState(0);
  const [valeurAccessoire, setValeurAccessoire] = useState(0);
  const [immatriculation, setImmatriculation] = useState('');
  const [numeroCarteBrune, setNumeroCarteBrune] = useState('');
  const [numeroChassis, setNumeroChassis] = useState('');
  const [numeroMoteur, setNumeroMoteur] = useState('');
  const [dateMec, setDateMec] = useState('2020-01-01');

  // Checkboxes techniques métier OREOLE
  const [carburantAutreMatiere, setCarburantAutreMatiere] = useState(false);
  const [transportEleves, setTransportEleves] = useState(false);
  const [transportEmployes, setTransportEmployes] = useState(false);
  const [transportPassagerSupplementaire, setTransportPassagerSupplementaire] = useState(false);
  const [nsiaAutoPlus, setNsiaAutoPlus] = useState(false);

  // Gestion Parc Flotte Automobile. Vide au départ : les véhicules sont ceux ajoutés à la saisie
  // ou ceux du devis rouvert (enregistre: true, seuls à exister en base). Les deux véhicules
  // fictifs d'exemple portaient les ids 101/102 : les retirer supprimait en base les détails
  // 101/102 d'un autre devis (annulationsaisievehicule).
  const [flotteVehicules, setFlotteVehicules] = useState([]);
  const [editingFlotteIndex, setEditingFlotteIndex] = useState(null);

  // ----------------------------------------------------
  // ÉCRAN 3 : OFFRE, GARANTIES & IMPOSITION DES PRIMES
  // ----------------------------------------------------
  // idoffre=1 n'existe pas en base (idoffre=2 = "OFFRE AUTOMOBILE TOUS RISQUES") :
  // ce décalage entre l'id et le libellé par défaut faisait que le calcul partait
  // toujours sur une offre inexistante tant que l'utilisateur ne rouvrait pas
  // manuellement le menu déroulant pour resélectionner la même offre affichée.
  const [offreId, setOffreId] = useState(2);
  const [offreSelectionnee, setOffreSelectionnee] = useState('OFFRE AUTOMOBILE TOUS RISQUES');
  // Offres proposées pour le véhicule, comme dans URANUS : celles de sa catégorie
  // (fn_liste_offre_produit) — { idTarif, liste } — et, pour les signaler, celles que la
  // compagnie a paramétrées (stdoffregarantie) — Map id → nombre de garanties
  const [offresCategorie, setOffresCategorie] = useState(null);
  const [offresCompagnie, setOffresCompagnie] = useState(null);
  // Vrai quand l'utilisateur vient de changer de catégorie : l'offre suit alors la nouvelle liste
  const offreASuivreCategorieRef = useRef(false);
  // Dernière offre choisie dans chaque catégorie (id de catégorie → id d'offre), reprise au retour
  const offreParCategorieRef = useRef(new Map());
  const [isEditingPrimes, setIsEditingPrimes] = useState(false); // Mode "Imposer la prime"
  // Primes imposées validées par le bouton "Enregistrer" : elles restent appliquées (totaux et
  // enregistrement du devis) une fois la saisie terminée, jusqu'à un "Recalculer CIMA".
  const [primesImposees, setPrimesImposees] = useState(false);
  const impositionActive = isEditingPrimes || primesImposees;
  const [deletedGaranties, setDeletedGaranties] = useState([]);
  // true dès que les garanties réellement enregistrées d'un devis existant (stddevisdetgarantie)
  // ont été chargées : empêche le recalcul automatique silencieux d'écraser ces valeurs
  // (l'utilisateur reste libre de forcer un recalcul via le bouton "Recalculer CIMA").
  const garantiesChargeesDuDevisRef = useRef(false);

  // Tableau des garanties interactives avec inline editing et suppressions.
  // Vide au départ : les garanties viennent uniquement de l'offre (moteur CIMA / stdoffregarantie)
  // ou du devis rouvert — plus de liste figée avec des primes fictives.
  const [garanties, setGaranties] = useState([]);

  // Tuiles financières éditables en mode Imposition
  const [editedExtras, setEditedExtras] = useState(TUILES_NON_IMPOSEES);

  // Ligne cumul (IdGarantie = 0) renvoyée par fn_garantie_offre : accessoire (fn_get_accessoire,
  // fonction de la tranche de prime nette) et taxe sur accessoire — introuvables autrement côté écran.
  const [ligneCumul, setLigneCumul] = useState(null);
  // Numéro du dernier calcul de garanties lancé (handleRecalculateApi)
  const dernierCalculRef = useRef(0);
  // Totaux réellement enregistrés d'un devis rouvert en édition (stddevis) : URANUS affiche ces
  // montants tels quels (primes imposées comprises) tant que les garanties ne sont pas modifiées.
  const [totauxEnregistres, setTotauxEnregistres] = useState(null);
  const garantiesEnregistreesRef = useRef(null);

  // Accessoire de la prime nette réellement retenue à l'écran. La ligne cumul du moteur ne vaut
  // que pour l'offre complète (et n'existe pas pour un devis rouvert) : dès que des garanties sont
  // décochées, retirées, ajoutées ou leurs primes imposées, l'accessoire suit la tranche de la
  // nouvelle prime nette (fn_get_accessoire, comme à l'enregistrement). Flotte : l'accessoire est
  // calculé à l'enregistrement sur le total du devis.
  const baseAccessoire = useMemo(() => baseAccessoireAuto(garanties), [garanties]);
  const [accessoireGaranties, setAccessoireGaranties] = useState(null);
  useEffect(() => {
    if (typeContrat === 'FLOTTE' || !offreId || !compagnieId || !dateEffet || baseAccessoire <= 0) return undefined;
    let actif = true;
    const timer = setTimeout(() => {
      quoteApi.calculerAccessoireAuto({ primeNette: baseAccessoire, idOffre: offreId, idCompagnie: compagnieId, dateEffet })
        .then((acc) => { if (actif) setAccessoireGaranties({ base: baseAccessoire, ...acc }); })
        .catch((e) => console.warn("Accessoire indisponible : celui du moteur est conservé", e));
    }, 300);
    return () => { actif = false; clearTimeout(timer); };
  }, [typeContrat, baseAccessoire, offreId, compagnieId, dateEffet]);

  // Calcul financier aligné sur URANUS (voir utils/tarificationAuto) : le moteur CIMA a déjà
  // appliqué réduction commerciale, BNS, prorata et taxe par garantie.
  const calculFinancier = useMemo(() => {
    const vehiculesCount = typeContrat === 'FLOTTE' ? Math.max(1, flotteVehicules.length) : 1;
    const estSaisi = (champ) => impositionActive && editedExtras[champ] != null && editedExtras[champ] !== '';
    const imposer = (champ, valeurCalculee) => (estSaisi(champ) ? Number(editedExtras[champ]) : valeurCalculee);

    // Accessoire et taxe sur accessoire : ceux de la prime nette affichée une fois connus, sinon
    // ceux du moteur (ou le dernier connu, pour un devis rouvert dont le moteur n'a pas tourné)
    const cumulAccessoire = (typeContrat !== 'FLOTTE' && accessoireGaranties?.base === baseAccessoire && accessoireGaranties)
      || ligneCumul
      || (typeContrat !== 'FLOTTE' ? accessoireGaranties : null);

    // Devis rouvert et garanties intactes : on reprend exactement les totaux enregistrés
    const base = totauxEnregistres && garanties === garantiesEnregistreesRef.current
      ? totauxEnregistres
      : calculerTotauxDevisAuto({ garanties, ligneCumul: cumulAccessoire, vehiculesCount });

    const finalPA = imposer('pa', base.pa);
    const finalPN = imposer('pn', base.pn);
    const finalTaxe = imposer('taxe', base.taxe);
    const finalFga = imposer('fga', base.fga);
    const finalAccessoire = imposer('accessoire', base.accessoire);
    // La CEDEAO est une garantie de la liste : elle suit sa ligne, sans saisie séparée
    const finalCedeao = base.cedeao;

    // Dès qu'une composante est saisie, le TTC se recalcule à partir des montants affichés
    // (sinon il reprend le total de base, qui est celui enregistré pour un devis rouvert).
    const composanteSaisie = ['pn', 'taxe', 'fga', 'accessoire'].some(estSaisi);
    const calculatedTtc = composanteSaisie
      ? finalPN + finalCedeao + finalFga + finalTaxe + finalAccessoire
      : base.ttc;
    const finalTtc = imposer('ttc', calculatedTtc);

    return {
      primeAnnuelle: finalPA,
      // primeNette (hors CEDEAO) et cedeao sont transmis séparément à l'enregistrement ;
      // l'écran affiche la prime nette de toutes les garanties de la liste, CEDEAO comprise
      primeNette: finalPN,
      primeNetteGaranties: finalPN + finalCedeao,
      taxeEnregistrement: finalTaxe,
      fga: finalFga,
      accessoire: finalAccessoire,
      cedeao: finalCedeao,
      primeTtc: finalTtc,
      vehiculesCount,
    };
  }, [
    garanties,
    typeContrat,
    flotteVehicules,
    impositionActive,
    editedExtras,
    ligneCumul,
    accessoireGaranties,
    baseAccessoire,
    totauxEnregistres,
  ]);

  // Valeur affichée dans une tuile éditable : la saisie si elle existe, sinon le total calculé
  const valeurTuile = (champ, valeurCalculee) => editedExtras[champ] ?? String(valeurCalculee);

  // Saisie d'une tuile : le TTC (s'il n'est pas lui-même la tuile saisie) se recalcule aussitôt
  const handleTuileChange = (champ, valeur) => setEditedExtras((prev) => ({
    ...prev,
    [champ]: valeur,
    ...(champ !== 'ttc' && champ !== 'pa' ? { ttc: null } : {}),
  }));

  // Une prime de garantie a changé : les totaux qui en découlent reprennent le calcul pour
  // refléter la modification en temps réel. Un accessoire saisi à la main reste imposé ; sinon
  // il suit déjà la tranche de la nouvelle prime nette (accessoireGaranties).
  const libererTotauxDependants = () => setEditedExtras((prev) => ({
    ...prev, pa: null, pn: null, taxe: null, fga: null, ttc: null,
  }));

  // Paramètres transmis au moteur CIMA (fn_garantie_offre). Mémorisés pour relancer le calcul
  // dès qu'une donnée d'entrée change : auparavant seuls offre/tarif/compagnie déclenchaient
  // le calcul, si bien que les garanties restaient calculées avec les valeurs par défaut
  // (valeurs véhicule à 0, réduction/BNS initiaux…) saisies avant l'écran Véhicule.
  const offreSelectionneeObj = offresList.find((o) => o.id === Number(offreId));
  // Comme URANUS, le calcul utilise la catégorie (grille stdtarif) choisie à l'écran
  // Contrat — c'est aussi celle transmise à l'enregistrement (details.idTarif). Calculer
  // avec la grille de l'offre affichait un montant différent du montant enregistré, par
  // exemple pour une société en catégorie 212 (RC +5 %) avec une offre paramétrée en 201.
  // Tant que les vraies grilles ne sont pas chargées (DEFAULT_CATEGORIES contient des
  // ids stdcategorie, pas stdtarif), on retombe sur la grille propre à l'offre.
  const categorieSelectionnee = categories !== DEFAULT_CATEGORIES
    ? categories.find((cat) => Number(cat.id) === Number(categorieId))
    : null;
  const idTarifCalcul = categorieSelectionnee?.id || offreSelectionneeObj?.idTarif || 1;
  const grilleOffre = categories.find((cat) => Number(cat.id) === Number(offreSelectionneeObj?.idTarif));
  const categoriePersonneMorale = categories.find((cat) => cat.code === '212');

  // La grille retenue (categorieId) est soit une catégorie CIMA, soit un tarif spécifique de
  // cette catégorie : les deux menus affichent chacun leur part de ce choix
  const categoriesCima = categories.filter((cat) => !estTarifSpecifique(cat));
  const grilleChoisie = categories.find((cat) => Number(cat.id) === Number(categorieId));
  const tarifSpecifiqueChoisi = estTarifSpecifique(grilleChoisie) ? grilleChoisie : null;
  const categorieCimaChoisie = tarifSpecifiqueChoisi
    ? categoriesCima.find((cat) => cat.code && cat.code === tarifSpecifiqueChoisi.code)
    : grilleChoisie;
  const tarifsSpecifiques = categorieCimaChoisie?.code
    ? categories.filter((cat) => estTarifSpecifique(cat) && cat.code === categorieCimaChoisie.code)
    : [];
  const choisirGrille = (grille) => {
    if (!grille) return;
    setCategorieId(grille.id);
    setCategorieContrat(grille.libelle);
    // L'offre suit la grille choisie (sa liste d'offres change)
    offreASuivreCategorieRef.current = true;
  };

  // Véhicule saisi à l'écran : instantané complet (paramètres tarifaires compris). En flotte,
  // chaque véhicule de la liste est un tel instantané, enregistré par son propre appel à
  // sp_creation_devis ; les clés sont celles attendues par formatAutoQuoteForApi (details).
  const instantaneVehicule = () => ({
    idTarif: Number(categorieId) || 0,
    categorieContrat,
    codeUsage: Number(usageId) || 0,
    usageVehicule,
    idCarrosserie: Number(carrosserieId) || 0,
    carrosserie,
    idOffre: Number(offreId) || 0,
    offreSelectionnee,
    codeCarburant: Number(energieId) || 0,
    energie,
    codeAlarme: Number(systemeSecuriteId) || 0,
    systemeSecurite,
    codeFormuleSecuriteRoutiere: formuleSecuriteCode,
    idOptionAssistance: Number(formuleAssistanceId) || 0,
    idMarque: Number(marqueId) || 0,
    marqueVehicule,
    idGenreVehicule: Number(genreId) || 0,
    genreVehicule,
    typeCommercial,
    remorqueAttelee: Boolean(remorqueAttelee),
    modeleVehicule,
    puissanceFiscale: Number(puissanceFiscale) || 0,
    chargeUtile: Number(chargeUtile) || 0,
    nombrePlace: Number(nombrePlace) || 0,
    valeurNeuf: Number(valeurNeuf) || 0,
    valeurVenale: Number(valeurVenale) || 0,
    valeurAccessoire: Number(valeurAccessoire) || 0,
    immatriculation: String(immatriculation || '').trim().toUpperCase(),
    numeroCarteBrune,
    numeroChassis,
    numeroMoteur,
    dateMec,
    carburantAutreMatiere: Boolean(carburantAutreMatiere),
    transportEleves: Boolean(transportEleves),
    transportEmployes: Boolean(transportEmployes),
    transportPassagerSupplementaire: Boolean(transportPassagerSupplementaire),
    nsiaAutoPlus: Boolean(nsiaAutoPlus),
  });

  // Paramètres du moteur CIMA (fn_garantie_offre) pour un véhicule
  const payloadMoteur = (v) => {
    const categorieReelle = categories !== DEFAULT_CATEGORIES
      && categories.some((cat) => Number(cat.id) === Number(v.idTarif));
    const offre = offresList.find((o) => o.id === Number(v.idOffre));
    return {
      CodeCarburant: Number(v.codeCarburant || 1),
      CodeAlarme: Number(v.codeAlarme || 0),
      IdOffre: Number(v.idOffre || 1),
      IdTarif: Number((categorieReelle ? v.idTarif : null) || offre?.idTarif || 1),
      NsiaAutoPlus: Boolean(v.nsiaAutoPlus),
      IdCompagnie: Number(compagnieId || 1),
      ValNeuve: Number(v.valeurNeuf || 0),
      ValVenale: Number(v.valeurVenale || 0),
      ValAccessoire: Number(v.valeurAccessoire || 0),
      Puissance: Number(v.puissanceFiscale || 7),
      Tonnage: Number(v.chargeUtile || 0),
      TauxReduction: Number(reductionCommerciale || 0),
      DateEffet: toDmy(dateEffet),
      DateExpiration: toDmy(effectiveDateExpiration),
      DateMec: toDmy(v.dateMec),
      Bns: Number(bonusMalus || 0),
      RemorqueAttelee: Boolean(v.remorqueAttelee),
      CodeFormuleSecuriteRoutiere: v.codeFormuleSecuriteRoutiere || '',
      NombrePlace: Number(v.nombrePlace || 5),
      CodeUsage: Number(v.codeUsage || 1),
      CarburantAutreMatiere: Boolean(v.carburantAutreMatiere),
      TransportEleves: Boolean(v.transportEleves),
      TransportEmployes: Boolean(v.transportEmployes),
      TansportPassagerSupplementaire: Boolean(v.transportPassagerSupplementaire),
      IdOptionAssistance: Number(v.idOptionAssistance || 0),
    };
  };

  const calculPayload = useMemo(() => payloadMoteur(instantaneVehicule()), [
    energieId, systemeSecuriteId, offreId, idTarifCalcul, nsiaAutoPlus, compagnieId, valeurNeuf,
    valeurVenale, valeurAccessoire, puissanceFiscale, chargeUtile, reductionCommerciale, dateEffet,
    effectiveDateExpiration, dateMec, bonusMalus, remorqueAttelee, formuleSecuriteCode, nombrePlace,
    usageId, carburantAutreMatiere, transportEleves, transportEmployes, transportPassagerSupplementaire,
    formuleAssistanceId,
  ]);

  // Appel dynamique au backend /api/offregarantie si disponible
  const handleRecalculateApi = async (silent = false) => {
    // Plusieurs calculs peuvent se chevaucher (compagnie, catégorie, offre chargées coup sur
    // coup) : seule la réponse du dernier lancé est appliquée au tableau
    const numero = ++dernierCalculRef.current;
    setLoadingCalculation(true);
    // Un recalcul demandé explicitement remplace les garanties enregistrées : les
    // changements de saisie suivants doivent alors relancer le calcul automatiquement.
    if (!silent) garantiesChargeesDuDevisRef.current = false;
    try {
      const res = await quoteApi.calculateOffreGarantie(calculPayload);
      if (numero !== dernierCalculRef.current) return;
      if (res && Array.isArray(res.data)) {
        // Le tableau doit toujours refléter l'offre sélectionnée, y compris quand
        // elle n'a aucune garantie configurée pour cette compagnie (résultat vide) :
        // ne rien faire ici laissait affichées les garanties de l'offre précédente,
        // donnant l'impression que le tableau ne changeait jamais.
        const mapped = garantiesDepuisMoteur(res.data, nombrePlace);

        setLigneCumul(extraireLigneCumul(res.data));
        setGaranties(mapped);
        if (!silent) {
          // Retour au barème : les primes imposées sont abandonnées
          setPrimesImposees(false);
          setEditedExtras(TUILES_NON_IMPOSEES);
          if (mapped.length > 0) {
            info('Garanties et primes mises à jour depuis le moteur de tarification CIMA !');
          } else {
            toastError("Aucune garantie n'est configurée pour cette offre avec cette compagnie (à paramétrer dans Offres & Garanties).");
          }
        }
      }
    } catch (err) {
      console.warn('Recalcul API /api/offregarantie non disponible, tarification CIMA locale maintenue', err);
    } finally {
      if (numero === dernierCalculRef.current) setLoadingCalculation(false);
    }
  };

  // ----------------------------------------------------
  // FLOTTE : liste de véhicules complets, enregistrés un par un (sp_creation_devis) puis
  // totalisés par sp_finalisation_devis, comme dans URANUS
  // ----------------------------------------------------
  // Véhicules déjà enregistrés retirés de la liste : supprimés en base à l'enregistrement du
  // devis seulement (sp_suppression_vehicule), pour qu'abandonner la saisie ne supprime rien.
  const [vehiculesRetires, setVehiculesRetires] = useState([]);
  // Primes estimées par le moteur CIMA pour les véhicules nouveaux ou modifiés
  const [estimationsFlotte, setEstimationsFlotte] = useState({});
  const [estimationFlotteEnCours, setEstimationFlotteEnCours] = useState(false);
  // « Garanties de l'offre » des véhicules de flotte, par clé de véhicule (CLE_SAISIE pour celui
  // saisi à l'écran Véhicule avant son ajout à la liste) :
  //   { garanties, signature } : garanties personnalisées (retirées, ajoutées, primes imposées),
  //     appliquées au seul véhicule après son enregistrement ; signature = données de tarification
  //     pour lesquelles elles ont été établies
  //   { bareme: true } : véhicule enregistré à remettre au barème (il est renvoyé à sp_creation_devis)
  const [garantiesFlotte, setGarantiesFlotte] = useState({});
  // Véhicule dont la fenêtre « Garanties de l'offre » est ouverte : { cle }
  const [garantiesOuvertes, setGarantiesOuvertes] = useState(null);
  // Taux de taxe par garantie du produit Automobile (Map id → taux), pour des taxes exactes à l'écran
  const [tauxTaxesAuto, setTauxTaxesAuto] = useState(null);

  const nouvelleCleVehicule = () => `v${Date.now()}${Math.random().toString(36).slice(2)}`;

  // Données de tarification d'un véhicule : des garanties personnalisées ne valent que pour elles
  const signatureTarif = (v) => JSON.stringify(payloadMoteur(v));
  const garantiesPersonnalisees = (v) => (garantiesFlotte[v.cle]?.garanties ? garantiesFlotte[v.cle] : null);
  const garantiesAReviser = (v) => {
    const perso = garantiesPersonnalisees(v);
    return Boolean(perso) && perso.signature !== signatureTarif(v);
  };

  const oublierGarantiesVehicule = (cle) => setGarantiesFlotte((prev) => {
    if (!(cle in prev)) return prev;
    const { [cle]: _oublie, ...reste } = prev;
    return reste;
  });

  // Replace un véhicule de la flotte dans l'écran Véhicule (pour le modifier)
  const chargerVehicule = (v) => {
    offreASuivreCategorieRef.current = false;
    setCategorieId(v.idTarif);
    if (v.categorieContrat) setCategorieContrat(v.categorieContrat);
    setUsageId(v.codeUsage);
    if (v.usageVehicule) setUsageVehicule(v.usageVehicule);
    setCarrosserieId(v.idCarrosserie);
    if (v.carrosserie) setCarrosserie(v.carrosserie);
    setOffreId(v.idOffre);
    if (v.offreSelectionnee) setOffreSelectionnee(v.offreSelectionnee);
    setEnergieId(v.codeCarburant);
    if (v.energie) setEnergie(v.energie);
    setSystemeSecuriteId(v.codeAlarme);
    if (v.systemeSecurite) setSystemeSecurite(v.systemeSecurite);
    setFormuleSecuriteCode(v.codeFormuleSecuriteRoutiere || 'AUCUNE');
    setFormuleAssistanceId(v.idOptionAssistance || 0);
    setMarqueId(v.idMarque);
    if (v.marqueVehicule) setMarqueVehicule(v.marqueVehicule);
    setGenreId(v.idGenreVehicule);
    if (v.genreVehicule) setGenreVehicule(v.genreVehicule);
    if (v.typeCommercial) setTypeCommercial(v.typeCommercial);
    setRemorqueAttelee(Boolean(v.remorqueAttelee));
    setModeleVehicule(v.modeleVehicule || '');
    setPuissanceFiscale(v.puissanceFiscale);
    setChargeUtile(v.chargeUtile);
    setNombrePlace(v.nombrePlace);
    setValeurNeuf(v.valeurNeuf);
    setValeurVenale(v.valeurVenale);
    setValeurAccessoire(v.valeurAccessoire);
    setImmatriculation(v.immatriculation || '');
    setNumeroCarteBrune(v.numeroCarteBrune || '');
    setNumeroChassis(v.numeroChassis || '');
    setNumeroMoteur(v.numeroMoteur || '');
    if (v.dateMec) setDateMec(v.dateMec);
    setCarburantAutreMatiere(Boolean(v.carburantAutreMatiere));
    setTransportEleves(Boolean(v.transportEleves));
    setTransportEmployes(Boolean(v.transportEmployes));
    setTransportPassagerSupplementaire(Boolean(v.transportPassagerSupplementaire));
    setNsiaAutoPlus(Boolean(v.nsiaAutoPlus));
  };

  // Véhicule enregistré (ligne stddevisdetail de /devisdetail) sous forme d'instantané
  const vehiculeDepuisDetail = (l) => ({
    idTarif: Number(l.idtarif) || 0,
    categorieContrat: categories.find((cat) => Number(cat.id) === Number(l.idtarif))?.libelle || '',
    codeUsage: Number(l.idusage?.IdUsage ?? 0),
    usageVehicule: l.idusage?.LibelleUsage || '',
    idCarrosserie: Number(l.idcarrosserie) || 0,
    carrosserie: carrosseries.find((car) => Number(car.id) === Number(l.idcarrosserie))?.libelle || '',
    idOffre: Number(l.idoffre) || 0,
    offreSelectionnee: offresList.find((o) => Number(o.id) === Number(l.idoffre))?.libelle || '',
    codeCarburant: Number(l.essence?.IdEnergie ?? 0),
    energie: l.essence?.Libelle || '',
    codeAlarme: Number(l.securite?.IdSystemeSecurite ?? 0),
    systemeSecurite: l.securite?.LibelleSystemeSecurite || '',
    codeFormuleSecuriteRoutiere: l.formule_securite_routiere || 'AUCUNE',
    idOptionAssistance: Number(l.assistance_automobie || 0),
    idMarque: Number(l.idmarque?.IdMarque ?? 0),
    marqueVehicule: l.idmarque?.LibelleMarque || '',
    idGenreVehicule: Number(l.idgenrevehicule?.IdGenre ?? 0),
    genreVehicule: l.idgenrevehicule?.LibelleGenre || '',
    typeCommercial: l.idtypevehicule?.libelle_type || '',
    idTypeVehicule: l.idtypevehicule?.id,
    remorqueAttelee: Boolean(l.remorque),
    modeleVehicule: l.modelevehicule || '',
    puissanceFiscale: Number(l.puissancefiscale || 0),
    chargeUtile: Number(l.chargeutile || 0),
    nombrePlace: Number(l.nombreplace || 0),
    valeurNeuf: Number(l.valeurneuve || 0),
    valeurVenale: Number(l.valeurvenale || 0),
    valeurAccessoire: Number(l.valeuraccessoire || 0),
    immatriculation: String(l.matricule || '').trim().toUpperCase(),
    numeroCarteBrune: l.numcarteverte || '',
    numeroChassis: l.numchassis || '',
    numeroMoteur: l.nummoteur || '',
    dateMec: toIsoDate(l.datemec),
    carburantAutreMatiere: Boolean(l.carburant_autre_matiere),
    transportEleves: Boolean(l.transport_eleves),
    transportEmployes: Boolean(l.transport_employes),
    transportPassagerSupplementaire: Boolean(l.transport_passager_supplementaire),
    // NSIA Auto Plus n'est pas stocké : seule la garantie qu'il fait retenir le trahit
    nsiaAutoPlus: (l.garanties_enregistrees || []).some(
      (g) => Number(g.IdGarantie) === ID_SOUS_GARANTIE_NSIA_AUTO_PLUS && g.Acquise,
    ),
  });

  // Véhicule à (r)envoyer à sp_creation_devis : nouveau, modifié, en-tête du devis modifié
  // (enteteModifiee, calculé plus bas avec le souscripteur) ou garanties remises au barème
  const vehiculeAEnvoyer = (v) => !v.enregistre || enteteModifiee || empreinteVehicule(v) !== v.origine
    || Boolean(garantiesFlotte[v.cle]?.bareme);

  const viderSaisieVehicule = () => {
    setImmatriculation('');
    setNumeroCarteBrune('');
    setNumeroChassis('');
    setNumeroMoteur('');
    oublierGarantiesVehicule(CLE_SAISIE);
  };

  const handleAjouterOuMajVehicule = () => {
    const v = instantaneVehicule();
    if (!v.immatriculation) {
      toastError('Saisissez l\'immatriculation du véhicule.');
      return;
    }
    if (flotteVehicules.some((x, i) => i !== editingFlotteIndex && x.immatriculation === v.immatriculation)) {
      toastError(`Le véhicule ${v.immatriculation} est déjà dans la flotte.`);
      return;
    }
    if (editingFlotteIndex !== null) {
      setFlotteVehicules((prev) => prev.map((x, i) => (i === editingFlotteIndex ? { ...x, ...v } : x)));
      setEditingFlotteIndex(null);
      success(`Véhicule ${v.immatriculation} mis à jour dans la flotte.`);
    } else {
      const cle = nouvelleCleVehicule();
      setFlotteVehicules((prev) => [...prev, { ...v, cle, idDevisDetail: null, enregistre: false, origine: null }]);
      // Les garanties personnalisées pendant la saisie suivent le véhicule ajouté
      setGarantiesFlotte((prev) => {
        if (!prev[CLE_SAISIE]) return prev;
        const { [CLE_SAISIE]: saisie, ...reste } = prev;
        return { ...reste, [cle]: saisie };
      });
      success(`Véhicule ${v.immatriculation} ajouté à la flotte.`);
    }
    viderSaisieVehicule();
  };

  // Le véhicule en cours de modification prend ce qui est saisi à l'écran avant de passer à un
  // autre véhicule ou à une nouvelle saisie : sans ça, ses corrections étaient perdues sans
  // avertissement et le véhicule repartait à l'enregistrement avec ses anciennes valeurs.
  // Renvoie false si la saisie ne peut pas être reportée (immatriculation vide ou en double).
  const reporterVehiculeEnCours = () => {
    if (editingFlotteIndex === null) return true;
    const v = instantaneVehicule();
    if (!v.immatriculation) {
      toastError('Saisissez l\'immatriculation du véhicule en cours de modification.');
      return false;
    }
    if (flotteVehicules.some((x, i) => i !== editingFlotteIndex && x.immatriculation === v.immatriculation)) {
      toastError(`Le véhicule ${v.immatriculation} est déjà dans la flotte.`);
      return false;
    }
    setFlotteVehicules((prev) => prev.map((x, i) => (i === editingFlotteIndex ? { ...x, ...v } : x)));
    return true;
  };

  const handleModifierVehicule = (idx) => {
    if (idx === editingFlotteIndex || !reporterVehiculeEnCours()) return;
    chargerVehicule(flotteVehicules[idx]);
    setEditingFlotteIndex(idx);
    // La saisie d'un nouveau véhicule est abandonnée, ses garanties personnalisées aussi
    oublierGarantiesVehicule(CLE_SAISIE);
  };

  const handleNouveauVehicule = () => {
    if (!reporterVehiculeEnCours()) return;
    setEditingFlotteIndex(null);
    viderSaisieVehicule();
  };

  const handleAnnulerModificationVehicule = () => {
    setEditingFlotteIndex(null);
    viderSaisieVehicule();
  };

  const handleRetirerVehicule = (idx) => {
    const veh = flotteVehicules[idx];
    if (!veh || !window.confirm(`Retirer le véhicule ${veh.immatriculation} de la flotte ?`)) return;
    if (veh.enregistre && veh.idDevisDetail) {
      setVehiculesRetires((prev) => [...prev, { idDevisDetail: veh.idDevisDetail, immatriculation: veh.immatriculation }]);
    }
    setFlotteVehicules((prev) => prev.filter((_, i) => i !== idx));
    oublierGarantiesVehicule(veh.cle);
    if (editingFlotteIndex === idx) handleAnnulerModificationVehicule();
    else if (editingFlotteIndex !== null && editingFlotteIndex > idx) setEditingFlotteIndex(editingFlotteIndex - 1);
    info(veh.enregistre
      ? `Véhicule ${veh.immatriculation} retiré : il sera supprimé du devis à l'enregistrement.`
      : `Véhicule ${veh.immatriculation} retiré de la flotte.`);
  };

  // Estimation du moteur pour le véhicule tel qu'il est saisi (celle d'avant une modification est ignorée)
  const estimationVehicule = (v) => {
    const estimation = estimationsFlotte[v.cle];
    return estimation?.empreinte === `${empreinteVehicule(v)}|${enteteDevis}` ? estimation : null;
  };

  // Primes par véhicule : celles de ses garanties personnalisées, celles enregistrées pour un
  // véhicule inchangé, sinon l'estimation du moteur
  const primesVehicule = (v) => {
    const perso = garantiesPersonnalisees(v);
    if (perso && !garantiesAReviser(v)) return calculerTotauxDevisAuto({ garanties: perso.garanties });
    return vehiculeAEnvoyer(v) ? estimationVehicule(v)?.totaux || null : v.primesEnregistrees || null;
  };

  // Véhicule désigné par sa clé tel qu'il sera enregistré (celui en cours de saisie ou de
  // modification tel qu'affiché à l'écran Véhicule)
  const vehiculeParCle = (cle) => (cle === CLE_SAISIE
    ? { ...instantaneVehicule(), cle: CLE_SAISIE }
    : flotteEffective().find((x) => x.cle === cle) || null);
  // Clé du véhicule affiché à l'écran Véhicule
  const cleVehiculeAffiche = () => (editingFlotteIndex !== null ? flotteVehicules[editingFlotteIndex]?.cle : CLE_SAISIE);

  // Garanties montrées à l'ouverture de « Garanties de l'offre » pour un véhicule
  const garantiesInitiales = (v) => {
    const perso = garantiesPersonnalisees(v);
    if (perso) return { origine: garantiesAReviser(v) ? 'perimees' : 'personnalisees', garanties: perso.garanties };
    if (!vehiculeAEnvoyer(v) && v.garantiesEnregistrees?.length) return { origine: 'enregistrees', garanties: v.garantiesEnregistrees };
    return { origine: 'bareme' };
  };

  // Résultat de « Garanties de l'offre » : null = barème, undefined = inchangé, liste = personnalisées
  const appliquerGarantiesVehicule = (cle, resultat) => {
    const v = vehiculeParCle(cle);
    setGarantiesOuvertes(null);
    if (!v || resultat === undefined) return;
    const nom = v.immatriculation || 'en saisie';
    if (resultat === null) {
      // Un véhicule enregistré repart au barème en étant renvoyé à sp_creation_devis
      setGarantiesFlotte((prev) => {
        const { [cle]: _ancien, ...reste } = prev;
        return v.enregistre && v.garantiesEnregistrees ? { ...reste, [cle]: { bareme: true } } : reste;
      });
      info(`Véhicule ${nom} : garanties du barème de l'offre.`);
      return;
    }
    setGarantiesFlotte((prev) => ({ ...prev, [cle]: { garanties: resultat, signature: signatureTarif(v) } }));
    success(`Garanties du véhicule ${nom} personnalisées : elles seront enregistrées avec le devis.`);
  };

  // Garanties de l'offre d'un véhicule calculées par le moteur CIMA (fn_garantie_offre)
  const chargerBaremeVehicule = async (v) => {
    try {
      const res = await quoteApi.calculateOffreGarantie(payloadMoteur(v));
      return garantiesDepuisMoteur(res?.data, v.nombrePlace);
    } catch (e) {
      throw new Error(messageEnregistrement(e));
    }
  };

  const ouvrirGarantiesVehicule = (cle) => {
    if (!vehiculeParCle(cle)) return;
    if (!tauxTaxesAuto) {
      quoteApi.getTauxTaxesGaranties()
        .then((lignesTaux) => {
          const dateReference = dateEffet || new Date().toISOString().slice(0, 10);
          setTauxTaxesAuto(new Map((lignesTaux || [])
            .filter((t) => Number(t.produit) === 1 && t.debutvalidite <= dateReference && dateReference <= t.finvalidite)
            .map((t) => [Number(t.garantie), Number(t.tauxtaxe) || 0])));
        })
        .catch((e) => console.warn('Taux de taxe des garanties indisponibles : taxes estimées au prorata', e));
    }
    setGarantiesOuvertes({ cle });
  };

  // Liste de la flotte telle qu'elle sera enregistrée : le véhicule en cours de modification
  // est pris tel qu'affiché à l'écran Véhicule
  const flotteEffective = () => (editingFlotteIndex === null
    ? flotteVehicules
    : flotteVehicules.map((x, i) => (i === editingFlotteIndex ? { ...x, ...instantaneVehicule() } : x)));

  // À l'écran des primes d'une flotte : estimation des véhicules nouveaux ou modifiés (dont ceux
  // dont les garanties viennent d'être remises au barème)
  useEffect(() => {
    if (step === 3 && typeContrat === 'FLOTTE') estimerFlotte();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, typeContrat, garantiesFlotte]);

  const estimerFlotte = async (forcer = false) => {
    const aEstimer = flotteEffective().filter((v) => vehiculeAEnvoyer(v) && (forcer || !primesVehicule(v)));
    if (!aEstimer.length) return;
    setEstimationFlotteEnCours(true);
    try {
      const resultats = await Promise.all(aEstimer.map(async (v) => {
        const empreinte = `${empreinteVehicule(v)}|${enteteDevis}`;
        try {
          const res = await quoteApi.calculateOffreGarantie(payloadMoteur(v));
          const garantiesVehicule = garantiesDepuisMoteur(res?.data, v.nombrePlace);
          // Offre sans garantie paramétrée pour cette compagnie : pas de prime à afficher (0 F tromperait)
          return [v.cle, {
            empreinte,
            totaux: garantiesVehicule.length ? calculerTotauxDevisAuto({ garanties: garantiesVehicule }) : null,
            sansGarantie: garantiesVehicule.length === 0,
          }];
        } catch (e) {
          // Motif du refus conservé (ex. valeur accessoire supérieure à la valeur vénale), que
          // l'enregistrement opposerait aussi : il est affiché sur la ligne du véhicule
          return [v.cle, { empreinte, totaux: null, erreur: messageEnregistrement(e) }];
        }
      }));
      setEstimationsFlotte((prev) => ({ ...prev, ...Object.fromEntries(resultats) }));
      const echecs = aEstimer
        .map((v, i) => [v, resultats[i][1]])
        .filter(([, r]) => r.erreur)
        .map(([v, r]) => `${v.immatriculation} (${r.erreur})`);
      if (echecs.length) {
        toastError(`Primes non estimées pour ${echecs.join(', ')}. Corrigez le véhicule à l'écran Véhicule.`);
      }
    } finally {
      setEstimationFlotteEnCours(false);
    }
  };

  // ----------------------------------------------------
  // ÉCRAN 4 : CLIENT ASSURÉ
  // ----------------------------------------------------
  const [souscripteurId, setSouscripteurId] = useState(() => clients[0]?.id || 1);
  const [searchSouscripteur, setSearchSouscripteur] = useState('');
  const [nomAssure, setNomAssure] = useState('');
  // Assuré différent du souscripteur (devis rouvert) ; null = l'assuré est le souscripteur
  const [assureId, setAssureId] = useState(null);
  const [telephoneClient, setTelephoneClient] = useState('+225 ');
  const [nomConducteur, setNomConducteur] = useState('');
  const [adresseConducteur, setAdresseConducteur] = useState('');
  const [categoriePermis, setCategoriePermis] = useState('INFO NON DISPONIBLE');
  const [numeroPermis, setNumeroPermis] = useState('');
  const [lieuHabitation, setLieuHabitation] = useState('');
  const [numeroConducteur, setNumeroConducteur] = useState('+225 ');

  // En-tête du devis flotte : s'il change (dates, compagnie, réduction, client…), tous les
  // véhicules sont recalculés à l'enregistrement
  const enteteDevis = JSON.stringify([
    Number(compagnieId), dateEmission, dateEffet, effectiveDateExpiration, Number(dureeId), Number(termeId),
    Number(reductionCommerciale) || 0, Number(bonusMalus) || 0, numeroPoliceCompagnie || '',
    Number(souscripteurId), Number(assureId) || 0,
  ]);
  const [enteteOrigine, setEnteteOrigine] = useState(null);
  const enteteModifiee = Boolean(enteteOrigine) && enteteOrigine !== enteteDevis;

  // NSIA tarifie les véhicules de tourisme des sociétés en catégorie 212 (RC majorée de 5 %)
  const souscripteurSelectionne = clients.find((c) => String(c.id) === String(souscripteurId));
  const societeEnCategorie201 = souscripteurSelectionne?.typeclient === 'Entreprise'
    && categorieSelectionnee?.code === '201' && Boolean(categoriePersonneMorale);
  const passerEnCategoriePersonneMorale = () => {
    setCategorieId(categoriePersonneMorale.id);
    setCategorieContrat(categoriePersonneMorale.libelle);
    offreASuivreCategorieRef.current = true;
  };

  // ----------------------------------------------------
  // MODE ÉDITION : préremplissage depuis un devis existant
  // (bouton « Modifier » du Registre des Devis, /user/quotes/auto?edit=<iddevis>)
  // ----------------------------------------------------
  const [searchParams] = useSearchParams();
  const editIddevisParam = searchParams.get('edit');
  const [editIddevis, setEditIddevis] = useState(null);
  const [editIdDevisDetail, setEditIdDevisDetail] = useState(null);
  const [editIdAvenant, setEditIdAvenant] = useState(null);
  const [editNumeroDevis, setEditNumeroDevis] = useState('');
  const [isLoadingEdit, setIsLoadingEdit] = useState(Boolean(editIddevisParam));
  // Devis repris d'URANUS sans véhicule en base
  const [avertissementReprise, setAvertissementReprise] = useState('');

  // ----------------------------------------------------
  // BROUILLON : saisie non terminée enregistrée en base (/api/brouillons/) pour être reprise
  // plus tard depuis n'importe quel poste (registre des devis > Brouillons en cours,
  // /user/quotes/auto?brouillon=<id>)
  // ----------------------------------------------------
  const brouillonParam = searchParams.get('brouillon');
  const [brouillonId, setBrouillonId] = useState(null);
  const [enregistrementBrouillon, setEnregistrementBrouillon] = useState(false);
  // Champs du formulaire conservés dans le brouillon : [valeur courante, setter]
  const champsBrouillon = {
    typeContrat: [typeContrat, setTypeContrat],
    numeroPoliceCompagnie: [numeroPoliceCompagnie, setNumeroPoliceCompagnie],
    compagnieId: [compagnieId, setCompagnieId],
    compagnie: [compagnie, setCompagnie],
    categorieId: [categorieId, setCategorieId],
    categorieContrat: [categorieContrat, setCategorieContrat],
    usageId: [usageId, setUsageId],
    usageVehicule: [usageVehicule, setUsageVehicule],
    carrosserieId: [carrosserieId, setCarrosserieId],
    carrosserie: [carrosserie, setCarrosserie],
    reductionCommerciale: [reductionCommerciale, setReductionCommerciale],
    bonusMalus: [bonusMalus, setBonusMalus],
    termeContrat: [termeContrat, setTermeContrat],
    termeId: [termeId, setTermeId],
    dateEffet: [dateEffet, setDateEffet],
    dureeId: [dureeId, setDureeId],
    dureeContrat: [dureeContrat, setDureeContrat],
    customDateExpiration: [customDateExpiration, setCustomDateExpiration],
    energieId: [energieId, setEnergieId],
    energie: [energie, setEnergie],
    systemeSecuriteId: [systemeSecuriteId, setSystemeSecuriteId],
    systemeSecurite: [systemeSecurite, setSystemeSecurite],
    formuleSecuriteCode: [formuleSecuriteCode, setFormuleSecuriteCode],
    formuleAssistanceId: [formuleAssistanceId, setFormuleAssistanceId],
    marqueId: [marqueId, setMarqueId],
    marqueVehicule: [marqueVehicule, setMarqueVehicule],
    genreId: [genreId, setGenreId],
    genreVehicule: [genreVehicule, setGenreVehicule],
    typeCommercial: [typeCommercial, setTypeCommercial],
    remorqueAttelee: [remorqueAttelee, setRemorqueAttelee],
    modeleVehicule: [modeleVehicule, setModeleVehicule],
    puissanceFiscale: [puissanceFiscale, setPuissanceFiscale],
    chargeUtile: [chargeUtile, setChargeUtile],
    nombrePlace: [nombrePlace, setNombrePlace],
    valeurNeuf: [valeurNeuf, setValeurNeuf],
    valeurVenale: [valeurVenale, setValeurVenale],
    valeurAccessoire: [valeurAccessoire, setValeurAccessoire],
    immatriculation: [immatriculation, setImmatriculation],
    numeroCarteBrune: [numeroCarteBrune, setNumeroCarteBrune],
    numeroChassis: [numeroChassis, setNumeroChassis],
    numeroMoteur: [numeroMoteur, setNumeroMoteur],
    dateMec: [dateMec, setDateMec],
    carburantAutreMatiere: [carburantAutreMatiere, setCarburantAutreMatiere],
    transportEleves: [transportEleves, setTransportEleves],
    transportEmployes: [transportEmployes, setTransportEmployes],
    transportPassagerSupplementaire: [transportPassagerSupplementaire, setTransportPassagerSupplementaire],
    nsiaAutoPlus: [nsiaAutoPlus, setNsiaAutoPlus],
    flotteVehicules: [flotteVehicules, setFlotteVehicules],
    garantiesFlotte: [garantiesFlotte, setGarantiesFlotte],
    vehiculesRetires: [vehiculesRetires, setVehiculesRetires],
    editingFlotteIndex: [editingFlotteIndex, setEditingFlotteIndex],
    enteteOrigine: [enteteOrigine, setEnteteOrigine],
    offreId: [offreId, setOffreId],
    offreSelectionnee: [offreSelectionnee, setOffreSelectionnee],
    isEditingPrimes: [isEditingPrimes, setIsEditingPrimes],
    primesImposees: [primesImposees, setPrimesImposees],
    deletedGaranties: [deletedGaranties, setDeletedGaranties],
    garanties: [garanties, setGaranties],
    editedExtras: [editedExtras, setEditedExtras],
    ligneCumul: [ligneCumul, setLigneCumul],
    souscripteurId: [souscripteurId, setSouscripteurId],
    searchSouscripteur: [searchSouscripteur, setSearchSouscripteur],
    nomAssure: [nomAssure, setNomAssure],
    assureId: [assureId, setAssureId],
    telephoneClient: [telephoneClient, setTelephoneClient],
    nomConducteur: [nomConducteur, setNomConducteur],
    adresseConducteur: [adresseConducteur, setAdresseConducteur],
    categoriePermis: [categoriePermis, setCategoriePermis],
    numeroPermis: [numeroPermis, setNumeroPermis],
    lieuHabitation: [lieuHabitation, setLieuHabitation],
    numeroConducteur: [numeroConducteur, setNumeroConducteur],
    editIddevis: [editIddevis, setEditIddevis],
    editIdDevisDetail: [editIdDevisDetail, setEditIdDevisDetail],
    editIdAvenant: [editIdAvenant, setEditIdAvenant],
  };

  const handleSaveDraft = async () => {
    setEnregistrementBrouillon(true);
    const donnees = Object.fromEntries(Object.entries(champsBrouillon).map(([cle, [valeur]]) => [cle, valeur]));
    const client = clients.find((c) => String(c.id) === String(souscripteurId));
    const vehicule = [marqueVehicule, immatriculation].filter(Boolean).join(' ');
    const libelle = [client?.nomcomplet || nomAssure, vehicule].filter(Boolean).join(' — ') || 'Devis automobile sans client';
    const charge = { type_brouillon: 'DEVIS_AUTO', libelle, etape: step, donnees, iddevis: editIddevis || null };
    try {
      const res = brouillonId ? await brouillonApi.update(brouillonId, charge) : await brouillonApi.create(charge);
      setBrouillonId(res.data.id);
      success('Brouillon enregistré : vous pourrez le reprendre depuis le registre des devis (Brouillons en cours).');
    } catch (e) {
      console.error('Enregistrement du brouillon impossible', e);
      toastError(`Le brouillon n'a pas été enregistré : ${e?.response?.data?.detail || e.message}.`);
    } finally {
      setEnregistrementBrouillon(false);
    }
  };

  // Reprise d'un brouillon : restaure tout le formulaire et l'étape où la saisie s'était arrêtée
  useEffect(() => {
    if (!brouillonParam) return undefined;
    let actif = true;
    (async () => {
      try {
        const brouillon = await brouillonApi.get(brouillonParam);
        if (!actif || !brouillon) return;
        const donnees = brouillon.donnees || {};
        Object.entries(champsBrouillon).forEach(([cle, [, setter]]) => {
          if (Object.prototype.hasOwnProperty.call(donnees, cle)) setter(donnees[cle]);
        });
        // Garanties et primes du brouillon conservées telles quelles (comme un devis rouvert) :
        // le bouton « Recalculer CIMA » reste disponible pour repartir du barème
        garantiesChargeesDuDevisRef.current = Array.isArray(donnees.garanties) && donnees.garanties.length > 0;
        setBrouillonId(brouillon.id);
        setStep(Number(brouillon.etape) || 1);
        info(`Brouillon « ${brouillon.libelle || brouillon.id} » repris.`);
      } catch (e) {
        console.error('Reprise du brouillon impossible', e);
        toastError('Impossible de reprendre ce brouillon.');
      }
    })();
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brouillonParam]);

  // Chargement automatique des garanties réellement liées à l'offre (stdoffregarantie),
  // relancé à chaque changement d'une donnée d'entrée du moteur (calculPayload), sans
  // attendre un clic manuel. calculPayload dépend aussi de offresList via idTarifCalcul :
  // la liste réelle (avec le vrai idTarif de chaque offre) arrive souvent APRÈS le
  // chargement du devis en édition.
  useEffect(() => {
    // Pendant le chargement d'un devis existant, on attend que ses garanties
    // réellement enregistrées soient chargées avant d'envisager un recalcul —
    // sinon un appel lancé avec les valeurs par défaut (avant l'arrivée des
    // vraies données) pourrait, selon le timing réseau, écraser ces garanties.
    // En mode "Imposer la prime" (en cours ou enregistré), on ne réécrase pas non plus les primes saisies.
    if (isLoadingEdit || garantiesChargeesDuDevisRef.current || impositionActive) return undefined;
    if (!(offreId && categorieId && compagnieId)) return undefined;
    const timer = setTimeout(() => handleRecalculateApi(true), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculPayload, categorieId, isLoadingEdit, impositionActive]);

  // Garde la catégorie sélectionnée cohérente avec la liste filtrée par branche :
  // aligne le libellé sur l'id (ex: devis rechargé en édition), sinon bascule sur la 1re catégorie disponible
  useEffect(() => {
    if (categories.length === 0) return;
    const byId = categories.find((cat) => Number(cat.id) === Number(categorieId));
    if (byId) {
      if (byId.libelle !== categorieContrat) setCategorieContrat(byId.libelle);
      return;
    }
    const byLibelle = categories.find((cat) => cat.libelle === categorieContrat);
    if (byLibelle) {
      setCategorieId(byLibelle.id);
      return;
    }
    if (!editIddevisParam && !brouillonParam) {
      const premiere = categories.find((cat) => !estTarifSpecifique(cat)) || categories[0];
      setCategorieId(premiere.id);
      setCategorieContrat(premiere.libelle);
    }
  }, [categories, categorieId, categorieContrat, editIddevisParam, brouillonParam]);

  // Carrosseries filtrées selon l'usage sélectionné (liaison stdcarrosserie_Usages).
  // Si aucune carrosserie n'est paramétrée pour cet usage, toutes restent proposées.
  const carrosseriesFiltrees = useMemo(() => {
    const liees = carrosseries.filter((car) => (car.usages || []).includes(Number(usageId)));
    return liees.length > 0 ? liees : carrosseries;
  }, [carrosseries, usageId]);

  // Même logique de cohérence que pour la catégorie : la carrosserie choisie doit appartenir à la liste filtrée
  useEffect(() => {
    if (carrosseriesFiltrees.length === 0) return;
    const byId = carrosseriesFiltrees.find((car) => Number(car.id) === Number(carrosserieId));
    if (byId) {
      if (byId.libelle !== carrosserie) setCarrosserie(byId.libelle);
      return;
    }
    const byLibelle = carrosseriesFiltrees.find((car) => car.libelle === carrosserie);
    if (byLibelle) {
      setCarrosserieId(byLibelle.id);
      return;
    }
    if (!editIddevisParam && !brouillonParam) {
      setCarrosserieId(carrosseriesFiltrees[0].id);
      setCarrosserie(carrosseriesFiltrees[0].libelle);
    }
  }, [carrosseriesFiltrees, carrosserieId, carrosserie, editIddevisParam, brouillonParam]);

  // Date AAAA-MM-JJ d'une valeur API : la partie date est reprise telle quelle, sans passer par
  // new Date() qui la décalait d'un jour selon le fuseau horaire du poste.
  const toIsoDate = (v) => {
    if (!v) return '';
    const iso = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
  };

  useEffect(() => {
    if (!editIddevisParam || clients.length === 0) return;
    let isMounted = true;
    (async () => {
      try {
        // Devis repris d'URANUS sans véhicule en base : /devisdetail répond 404, l'en-tête
        // (stddevis) est alors relu seul pour garder dates, client, compagnie et montants
        const lignes = await quoteApi.getDevisDetailsAuto(editIddevisParam).catch((e) => {
          if (e?.response?.status === 404) return [];
          throw e;
        });
        const dd = lignes[0] || {};
        const d = dd.iddevis || (lignes.length ? {} : (await quoteApi.getQuote(editIddevisParam))?.raw || {});
        if (!isMounted) return;
        if (!d.iddevis) throw new Error('devis introuvable');
        setAvertissementReprise(lignes.length ? '' : (
          'Ce devis repris d\'URANUS n\'a aucun véhicule ni garantie en base : seuls l\'en-tête et les montants ont été repris. '
          + 'Complétez le véhicule puis « Recalculer CIMA » avant d\'enregistrer.'
        ));

        if (d.confirme) {
          toastError('Ce devis est déjà confirmé (converti en police) : il ne peut plus être modifié ici.');
          navigate('/user/quotes');
          return;
        }

        setEditIddevis(d.iddevis || Number(editIddevisParam));
        setEditIdDevisDetail(dd.iddevisdetail || null);
        setEditIdAvenant(Number(d.avenant?.IdAvenant ?? d.avenant) || null);
        setEditNumeroDevis(d.numerodevis || '');

        // Contrat & tarification
        setTypeContrat(d.flotte ? 'FLOTTE' : 'MONO');
        if (d.flotte) {
          // Chaque véhicule enregistré, avec ses garanties : inchangé, il ne sera pas renvoyé
          // (ses primes enregistrées sont conservées) ; modifié ou retiré, il le sera à l'enregistrement
          const vehicules = lignes.map((l) => {
            // Montants stockés sur le véhicule, ceux que sp_finalisation_devis additionne
            // (stddevisdetail.primenette = somme des garanties, CEDEAO comprise, FGA non compris)
            const cedeao = (l.garanties_enregistrees || [])
              .filter((g) => Number(g.IdGarantie) === ID_SOUS_GARANTIE_CEDEAO)
              .reduce((s, g) => s + (Number(g.PrimeNette) || 0), 0);
            const v = {
              ...vehiculeDepuisDetail(l),
              cle: `d${l.iddevisdetail}`,
              idDevisDetail: l.iddevisdetail,
              enregistre: true,
              // Garanties du véhicule en base, montrées par « Garanties de l'offre » tant qu'il est
              // inchangé ; dans l'ordre des garanties (RC en tête) comme le barème
              garantiesEnregistrees: garantiesDepuisDevis(l.garanties_enregistrees, Number(l.nombreplace) || 5)
                .sort((a, b) => Number(a.id_garantie) - Number(b.id_garantie)),
              primesEnregistrees: {
                pa: Number(l.primeannuelle) || 0,
                pn: (Number(l.primenette) || 0) - cedeao,
                taxe: Number(l.taxeenregistrement) || 0,
                fga: Number(l.fga) || 0,
                cedeao,
              },
            };
            return { ...v, origine: empreinteVehicule(v) };
          });
          setFlotteVehicules(vehicules);
          setVehiculesRetires([]);
          setGarantiesFlotte({});
          // L'écran Véhicule montre le premier véhicule, en modification
          if (vehicules.length) setEditingFlotteIndex(0);
        }
        setNumeroPoliceCompagnie(d.numero_police_compagnie || '');
        // d.compagnie peut être soit un id simple, soit l'objet compagnie complet
        // selon le point d'API — gérer les deux pour ne jamais obtenir NaN
        // (NaN est falsy et empêcherait silencieusement le calcul des garanties).
        const compagnieIdFromDevis = d.compagnie?.IdCompagnie ?? d.compagnie;
        if (compagnieIdFromDevis !== undefined && compagnieIdFromDevis !== null) {
          setCompagnieId(Number(compagnieIdFromDevis));
        }
        setReductionCommerciale(Number(dd.taux_reduction || 0));
        setBonusMalus(Number(dd.bns || d.bonus_malus || 0));
        // Les menus Durée et Terme affichent le libellé : il doit suivre l'id enregistré
        // Durée libre et terme « Autre » vont ensemble (anciens devis « Divers » compris)
        const charge = termeEtDureeEnregistres(d.idterme, d.idduree);
        setDureeId(charge.dureeId);
        setDureeContrat(libelleDuree(charge.dureeId));
        setTermeId(charge.termeId);
        setTermeContrat(libelleTerme(charge.termeId));
        setDateEffet(toIsoDate(d.dateeffet) || dateEffet);
        setCustomDateExpiration(toIsoDate(d.dateexpiration));

        // Véhicule (le premier pour une flotte) ; devis sans véhicule en base : seule l'offre
        // de l'en-tête est reprise, le reste de l'écran Véhicule est à compléter
        if (lignes.length) chargerVehicule(vehiculeDepuisDetail(dd));
        const idOffreDevis = dd.idoffre || d.offre?.IdOffre || d.offre;
        if (idOffreDevis) setOffreId(Number(idOffreDevis));

        // Garanties réellement enregistrées pour ce devis (stddevisdetgarantie) : sans
        // ça, l'écran ne peut qu'afficher les 6 garanties par défaut ou recalculer à
        // neuf via le moteur CIMA, écrasant silencieusement primes imposées/acquises
        // telles qu'elles ont été réellement enregistrées à la création du devis.
        // Devis sans véhicule en base : aucune garantie, mais les montants de l'en-tête restent
        // affichés et le recalcul automatique (sur un véhicule vide) est bloqué.
        const garantiesDevis = Array.isArray(dd.garanties_enregistrees) ? dd.garanties_enregistrees : [];
        if (garantiesDevis.length > 0 || lignes.length === 0) {
          const garantiesEnregistrees = garantiesDepuisDevis(garantiesDevis, Number(dd.nombreplace) || 5);
          garantiesEnregistreesRef.current = garantiesEnregistrees;
          setGaranties(garantiesEnregistrees);
          garantiesChargeesDuDevisRef.current = true;
          // Devis à primes imposées (stddevis.primeimposee) : l'imposition reste active, pour
          // que l'enregistrement repasse ces primes au lieu de les recalculer au barème. Pas en
          // flotte : sp_correction_devis appliquerait les garanties d'un véhicule à tous les autres
          // (les véhicules inchangés d'une flotte gardent de toute façon leurs primes enregistrées).
          setPrimesImposees(!d.flotte && Boolean(d.prime_imposee));

          // Totaux de l'en-tête (stddevis). stddevis.primenette inclut le FGA, et la CEDEAO pour un
          // devis calculé (TTC = prime nette + accessoire + taxe) ; un devis à primes imposées
          // (sp_maj_manuelle_primes) l'enregistre sans la CEDEAO. L'écran manipule la prime nette
          // hors FGA et hors CEDEAO : la CEDEAO n'y est ajoutée qu'une fois.
          const fgaEnregistre = Number(d.fga || 0);
          const cedeaoEnregistree = Number(d.cedeao || 0);
          const pnHorsFga = Number(d.primenette || 0) - fgaEnregistre;
          const pnInclutCedeao = cedeaoDansPrimeNette({
            primenette: d.primenette,
            accessoire: d.accessoire,
            taxe: d.taxe,
            cedeao: d.cedeao,
            primettc: d.primettc,
            primeImposee: Boolean(d.prime_imposee),
            arrondiNsia: Number(d.compagnie?.IdCompagnie ?? d.compagnie) === 1,
          });
          setTotauxEnregistres({
            pa: Number(d.primeannuelle || 0),
            pn: pnInclutCedeao ? pnHorsFga - cedeaoEnregistree : pnHorsFga,
            taxe: Number(d.taxe || 0),
            fga: fgaEnregistre,
            accessoire: Number(d.accessoire || 0),
            cedeao: Number(d.cedeao || 0),
            ttc: Number(d.primettc || 0),
          });
        }

        // Souscripteur / conducteur — d.client peut être un id simple ou l'objet
        // client complet ({IdClient, Nom, ...}) selon le point d'API : gérer les
        // deux, sinon la comparaison vaut "[object Object]" et ne matche jamais,
        // laissant le client du devis sur la valeur par défaut au lieu de la vraie.
        const idClientDevis = d.client?.IdClient ?? d.client;
        const client = clients.find((c) => String(c.id) === String(idClientDevis));
        if (client) {
          setSouscripteurId(client.id);
          setSearchSouscripteur(client.nomcomplet || '');
          setTelephoneClient(client.telephone || '+225 ');
        }
        // Assuré distinct du souscripteur (devis repris d'URANUS) : conservé tel quel
        const idAssureDevis = d.assure?.IdClient ?? d.assure;
        setAssureId(idAssureDevis && String(idAssureDevis) !== String(idClientDevis) ? Number(idAssureDevis) : null);
        setNomConducteur(dd.conducteur || '');
        setAdresseConducteur(dd.adressecnd || '');
        setNumeroPermis(dd.permis || '');

        success(`Devis ${d.numerodevis} chargé pour ajustement.`);
      } catch (err) {
        console.error('Erreur chargement devis pour édition:', err);
        toastError("Impossible de charger ce devis pour le modifier.");
        navigate('/user/quotes');
      } finally {
        if (isMounted) setIsLoadingEdit(false);
      }
    })();
    return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editIddevisParam, clients]);

  // En-tête du devis rouvert, tel que chargé : sa modification fera recalculer tous les véhicules
  useEffect(() => {
    if (editIddevis && !isLoadingEdit && enteteOrigine === null) setEnteteOrigine(enteteDevis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editIddevis, isLoadingEdit]);

  // Chargement des données réelles Django au montage
  useEffect(() => {
    let isMounted = true;
    const fetchApiData = async () => {
      try {
        const [cls, cies, gnrs, mrqs, crs, usgs, cats, secr, prms, ofrs, sgs, tvs] = await Promise.all([
          customerApi.getClients().catch(() => []),
          settingsApi.getCompanies().catch(() => []),
          settingsApi.getGenres().catch(() => []),
          settingsApi.getMarques().catch(() => []),
          settingsApi.getCarrosseries().catch(() => []),
          settingsApi.getUsages().catch(() => []),
          settingsApi.getTarifs().catch(() => []),
          settingsApi.getSystemesSecurite().catch(() => []),
          settingsApi.getCategoriesPermis().catch(() => []),
          settingsApi.getOffres().catch(() => []),
          quoteApi.getSousGaranties().catch(() => []),
          settingsApi.getTypesVehicule().catch(() => []),
        ]);

        if (isMounted) {
          if (cls && cls.length > 0) {
            setClients(cls);
            setSouscripteurId(cls[0].id);
            setTelephoneClient(cls[0].telephone || cls[0].mobile || '+225 ');
            setNomAssure(cls[0].nomcomplet || '');
            setNomConducteur(cls[0].nomcomplet || '');
          }
          if (cies && cies.length > 0) {
            const mappedCies = cies.map((c) => ({ id: c.id || c.IdCompagnie, nom: c.RaisonSociale || c.nom }));
            setCompanies(mappedCies);
            // La compagnie déjà retenue est conservée si elle est dans la liste : NSIA (id 1) par
            // défaut comme pour les autres devis, ou celle du devis rouvert / du brouillon. Prendre
            // la première de la liste (AXA, sans aucune offre Auto paramétrée) laissait l'écran
            // Offre sans garantie ; le libellé suit l'id (effet plus bas).
            setCompagnieId((actuelle) => (mappedCies.some((c) => Number(c.id) === Number(actuelle))
              ? actuelle
              : mappedCies[0].id));
          }
          if (gnrs && gnrs.length > 0) {
            setGenres(gnrs.map((g) => ({ id: g.id || g.IdGenre || g.IdGenreVehicule, libelle: g.LibelleGenre || g.libelle_genre || g.libelle })));
          }
          if (mrqs && mrqs.length > 0) {
            setMarques(mrqs.map((m) => ({ id: m.id || m.IdMarque, libelle: m.LibelleMarque || m.libelle })));
          }
          if (crs && crs.length > 0) {
            setCarrosseries(crs.map((c) => ({ id: c.id || c.IdCarrosserie, libelle: c.LibelleCarrosserie || c.libelle, usages: (c.Usages || []).map(Number) })));
          }
          if (usgs && usgs.length > 0) {
            setUsages(usgs.map((u) => ({ id: u.id || u.IdUsage, code: u.CodeUsage || '', libelle: u.LibelleUsage || u.libelle })));
          }
          if (cats && cats.length > 0) {
            // Ce menu doit lister les vraies grilles tarifaires (stdtarif), pas les
            // catégories CIMA génériques (stdcategorie, seulement 13 lignes) : Uranus
            // y affiche aussi les tarifs commerciaux nommés (TARIF TECK, ACCACIA,
            // BAOBAB, EBENE, EBENE PRISME, VTC...) absents de stdcategorie. On garde
            // "categorieId" = IdTarif, exactement l'id attendu par le calcul CIMA.
            const mappedCats = cats
              .map((t) => ({ id: t.id || t.IdTarif, code: t.CodeCategorie || '', libelle: t.Libelle || t.libelle }))
              .filter((t) => !t.code || t.code.startsWith(BRANCHE_AUTOMOBILE[0]));
            if (mappedCats.length > 0) setCategories(mappedCats);
          }
          if (secr && secr.length > 0) {
            setSystemesSecurite(secr.map((s) => ({ id: s.id || s.IdSystemeSecurite, libelle: s.LibelleSystemeSecurite || s.libelle })));
          }
          if (prms && prms.length > 0) {
            setCategoriesPermis(prms.map((p) => ({ id: p.id || p.IdCategoriePermis, code: p.code || p.CodeCategoriePermis || '', libelle: p.libelle || p.LibelleCategoriePermis || p.libelle_type || p.code })));
          }
          if (ofrs && ofrs.length > 0) {
            const mappedOffres = ofrs.map((o) => ({ id: o.id || o.IdOffre, code: o.CodeOffre || '', libelle: o.LibelleOffre || o.libelle, idTarif: o.TarifOffre || null, nbGaranties: o.NbGaranties ?? null }));
            setOffresList(mappedOffres);
            // Filet de sécurité : sur une nouvelle offre (pas en édition), si l'id par
            // défaut ne correspond pas réellement au libellé affiché dans le menu
            // (décalage id/libellé codé en dur), on recale sur le vrai id — sinon le
            // calcul partirait silencieusement sur une offre inexistante ou différente.
            if (!editIddevisParam && !brouillonParam) {
              const matching = mappedOffres.find((o) => o.libelle === offreSelectionnee);
              if (matching && matching.id !== offreId) {
                setOffreId(matching.id);
              }
            }
          }
          if (sgs && sgs.length > 0) {
            setSousGarantiesAll(sgs);
          }
          if (tvs && tvs.length > 0) {
            setTypesVehicules(tvs.map((tv) => ({ id: tv.id || tv.IdTypeVehicule || tv.IdType, libelle: tv.libelle_type || tv.LibelleType || tv.LibelleTypeVehicule || tv.libelle })));
          }
        }
      } catch (err) {
        console.warn('Fallback catalogue auto actif', err);
      }
    };
    fetchApiData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Chargement dynamique Assistance et Sécurité Routière selon la Compagnie
  useEffect(() => {
    let isCurrent = true;
    const fetchCompanyAddons = async () => {
      if (!compagnieId) return;
      try {
        const [assistRes, secRes] = await Promise.all([
          quoteApi.getAssistanceAuto(compagnieId),
          quoteApi.getSecuriteRoutiere(compagnieId),
        ]);
        if (isCurrent) {
          if (assistRes && assistRes.length > 0) {
            setFormulesAssistance([
              { id: 0, libelle: 'AUCUNE OPTION' },
              ...assistRes.map((a) => ({
                id: a.id_option ?? a.IdOptionAssistance ?? a.id,
                libelle:
                  a.libelle_option ||
                  a.LibelleOption ||
                  a.LibelleAssistance ||
                  `Assistance ${a.id_option ?? a.id}`,
              })),
            ]);
          }
          if (secRes && secRes.length > 0) {
            setFormulesSecurite([
              { code: 'AUCUNE', libelle: 'AUCUNE FORMULE' },
              ...secRes.map((s) => ({
                code: s.codeformule || s.CodeFormuleSecuriteRoutiere || s.code,
                libelle:
                  s.libellelongformule ||
                  s.LibelleFormuleSecuriteRoutiere ||
                  s.libelle,
              })),
            ]);
          }
        }
      } catch (_) {}
    };
    fetchCompanyAddons();
    return () => {
      isCurrent = false;
    };
  }, [compagnieId]);

  // Synchronisation du client sélectionné
  useEffect(() => {
    const sc = clients.find((c) => String(c.id) === String(souscripteurId));
    if (sc) {
      const assure = assureId ? clients.find((c) => String(c.id) === String(assureId)) : null;
      setTelephoneClient(sc.telephone || sc.mobile || '+225 ');
      setNomAssure((assure || sc).nomcomplet || '');
      setNomConducteur((prev) => prev || sc.nomcomplet || '');
      setAdresseConducteur((prev) => prev || sc.adresse || '');
      setLieuHabitation((prev) => prev || sc.ville || 'Abidjan');
      setNumeroConducteur((prev) => (prev && prev !== '+225 ' ? prev : sc.telephone || '+225 '));
    }
  }, [souscripteurId, clients, assureId]);

  // Les menus Compagnie et Offre affichent le libellé : il doit suivre l'id (devis rouvert,
  // brouillon), y compris quand la liste réelle arrive après le chargement du devis.
  useEffect(() => {
    const cie = companies.find((c) => Number(c.id) === Number(compagnieId));
    if (cie && cie.nom !== compagnie) setCompagnie(cie.nom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, compagnieId]);

  useEffect(() => {
    if (offresList === DEFAULT_OFFRES) return;
    const offre = offresList.find((o) => Number(o.id) === Number(offreId));
    if (offre && offre.libelle !== offreSelectionnee) setOffreSelectionnee(offre.libelle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offresList, offreId]);

  // Offres de la catégorie du véhicule (les vraies grilles stdtarif, pas les catégories par défaut)
  useEffect(() => {
    if (categories === DEFAULT_CATEGORIES || !categorieId) return undefined;
    let actif = true;
    const idTarif = Number(categorieId);
    quoteApi.getOffresAutoParCategorie(idTarif)
      .then((lignes) => {
        if (!actif) return;
        const liste = (Array.isArray(lignes) ? lignes : []).map((o) => ({ id: Number(o.IdOffre), libelle: o.LibelleOffre }));
        setOffresCategorie({ idTarif, liste });
      })
      .catch((e) => {
        console.warn(`Offres de la catégorie ${idTarif} indisponibles : offres Automobile proposées`, e);
        if (actif) setOffresCategorie(null);
      });
    return () => { actif = false; };
  }, [categorieId, categories]);

  // Offres paramétrées pour la compagnie (une offre sans garantie pour elle ne tarifie rien)
  useEffect(() => {
    if (!compagnieId) return undefined;
    let actif = true;
    settingsApi.getOffres(compagnieId)
      .then((lignes) => {
        if (actif) setOffresCompagnie(new Map((lignes || []).map((o) => [Number(o.IdOffre ?? o.id), Number(o.NbGaranties) || 0])));
      })
      .catch(() => { if (actif) setOffresCompagnie(null); });
    return () => { actif = false; };
  }, [compagnieId]);

  const offreParametree = (id) => !offresCompagnie || (offresCompagnie.get(Number(id)) || 0) > 0;
  // Offres de la catégorie affichée, une fois chargées pour elle ; sinon les offres Automobile
  const listeOffresCategorie = offresCategorie && offresCategorie.idTarif === Number(categorieId)
    ? offresCategorie.liste
    : null;

  // Menu des offres : celles de la catégorie, paramétrées pour la compagnie d'abord ; l'offre en
  // place reste affichée même hors de la liste (devis ancien), sans être changée d'office
  const offresProposees = useMemo(() => {
    const auto = categories !== DEFAULT_CATEGORIES
      ? offresList.filter((o) => categories.some((cat) => Number(cat.id) === Number(o.idTarif)))
      : offresList;
    const liste = trierParLibelle(listeOffresCategorie ?? auto, (o) => o.libelle)
      .map((o) => ({ id: Number(o.id), libelle: o.libelle, parametree: offreParametree(o.id), horsCategorie: false }))
      .sort((a, b) => Number(b.parametree) - Number(a.parametree));
    if (offreId && !liste.some((o) => o.id === Number(offreId))) {
      const courante = offresList.find((o) => Number(o.id) === Number(offreId));
      liste.unshift({
        id: Number(offreId),
        libelle: courante?.libelle || offreSelectionnee || `Offre n° ${offreId}`,
        parametree: offreParametree(offreId),
        horsCategorie: Boolean(listeOffresCategorie),
      });
    }
    return liste;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listeOffresCategorie, offresList, offresCompagnie, categories, offreId, offreSelectionnee]);

  const libelleOptionOffre = (o) => `${o.libelle}${o.horsCategorie ? ' — hors de cette catégorie' : ''}`
    + `${o.parametree ? '' : ` — non paramétrée pour ${compagnie || 'cette compagnie'}`}`;

  const choisirOffre = (id) => {
    const offre = offresProposees.find((o) => o.id === Number(id));
    setOffreId(Number(id));
    if (offre) setOffreSelectionnee(offre.libelle);
  };

  // Offre retenue dans la catégorie affichée, pour la reprendre si l'utilisateur y revient
  useEffect(() => {
    if (listeOffresCategorie?.some((o) => o.id === Number(offreId))) {
      offreParCategorieRef.current.set(Number(categorieId), Number(offreId));
    }
  }, [listeOffresCategorie, offreId, categorieId]);

  // Catégorie changée par l'utilisateur : si l'offre n'en fait plus partie, l'offre équivalente de
  // la nouvelle catégorie (« TOUS RISQUES » → « TOUS RISQUES (CAT 212) »), sinon celle déjà
  // choisie dans cette catégorie, sinon la première paramétrée pour la compagnie
  useEffect(() => {
    if (!offreASuivreCategorieRef.current || !listeOffresCategorie) return;
    offreASuivreCategorieRef.current = false;
    if (listeOffresCategorie.some((o) => o.id === Number(offreId))) return;
    const base = (libelle) => String(libelle || '').replace(/\s*(\(CAT[^)]*\)|CAT[EÉ]GORIE\s*\d+)\s*$/i, '').trim().toUpperCase();
    const candidates = trierParLibelle(listeOffresCategorie, (o) => o.libelle);
    const dejaChoisie = offreParCategorieRef.current.get(Number(categorieId));
    const equivalente = candidates.find((o) => base(o.libelle) === base(offreSelectionnee) && offreParametree(o.id))
      || candidates.find((o) => o.id === dejaChoisie)
      || candidates.find((o) => offreParametree(o.id))
      || candidates[0];
    if (equivalente) {
      setOffreId(equivalente.id);
      setOffreSelectionnee(equivalente.libelle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listeOffresCategorie]);

  // Filtrage clients
  const filteredClients = useMemo(() => {
    if (!searchSouscripteur.trim()) return clients;
    const q = searchSouscripteur.toLowerCase();
    return clients.filter(
      (c) =>
        (c.nomcomplet && c.nomcomplet.toLowerCase().includes(q)) ||
        (c.codeclient && c.codeclient.toLowerCase().includes(q)) ||
        (c.telephone && c.telephone.includes(q))
    );
  }, [clients, searchSouscripteur]);
  const clientsProposes = useMemo(
    () => trierParLibelle(filteredClients, (c) => `${c.nomcomplet} (${c.codeclient})`),
    [filteredClients],
  );

  // Le menu ne propose que les clients qui correspondent à la recherche. Si le souscripteur
  // retenu n'y figure plus, le navigateur affiche le premier client proposé alors que l'ancien
  // restait celui du devis : le souscripteur suit donc ce que le menu affiche.
  useEffect(() => {
    if (!clients.length || clientsProposes.some((c) => String(c.id) === String(souscripteurId))) return;
    setSouscripteurId(clientsProposes[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientsProposes]);

  // Actions de modification / suppression de garanties
  const handleDeleteGarantie = (idx) => {
    const target = garanties[idx];
    if (!target) return;
    if (estGarantieRc(target)) {
      toastError('La Responsabilité Civile (RC) est légalement obligatoire selon le Code CIMA et ne peut être supprimée.');
      return;
    }
    if (window.confirm(`Voulez-vous vraiment supprimer la garantie "${target.nom}" ?`)) {
      setDeletedGaranties((prev) => [...prev, target.id_garantie]);
      setGaranties((prev) => prev.filter((_, i) => i !== idx));
      libererTotauxDependants();
      info(`Garantie "${target.nom}" supprimée.`);
    }
  };

  const handleToggleGarantie = (idx) => {
    const target = garanties[idx];
    if (estGarantieRc(target)) return; // RC toujours obligatoire
    setGaranties((prev) =>
      prev.map((g, i) => (i === idx ? { ...g, acquise: !g.acquise } : g))
    );
    libererTotauxDependants();
  };

  const handleUpdateGarantieField = (idx, field, val) => {
    setGaranties((prev) =>
      prev.map((g, i) => (i === idx ? { ...g, [field]: val } : g))
    );
    if (field === 'primeAnnuelle' || field === 'primeNette') libererTotauxDependants();
  };

  // Ajout d'une nouvelle garantie personnalisée
  const handleAddNewGarantie = () => {
    if (!selectedSousGarantieId) {
      toastError('Veuillez sélectionner une sous-garantie dans la liste.');
      return;
    }
    const alreadyExists = garanties.some(
      (g) => String(g.id_garantie) === String(selectedSousGarantieId)
    );
    if (alreadyExists) {
      toastError('Cette garantie est déjà présente dans la liste.');
      return;
    }

    const sgMeta = sousGarantiesAll.find(
      (s) => String(s.IdSousGarantie || s.IdGarantie || s.id) === String(selectedSousGarantieId)
    );
    const libelle = sgMeta?.LibelleSousGarantie || `Garantie Optionnelle ${selectedSousGarantieId}`;

    const newG = {
      id_garantie: Number(selectedSousGarantieId),
      code: `GAR_${selectedSousGarantieId}`,
      nom: libelle,
      acquise: Boolean(newGarantieForm.acquise),
      capital: newGarantieForm.capital || 'Valeur Vénale',
      franchise: newGarantieForm.montant_franchise ? `${newGarantieForm.montant_franchise} F` : 'Néant',
      formule: 'Complémentaire',
      place: nombrePlace || 5,
      primeAnnuelle: Number(newGarantieForm.prime_annuelle) || 0,
      primeNette: Number(newGarantieForm.prime_nette) || 0,
      is_new_garantie: true,
    };

    setGaranties((prev) => [...prev, newG]);
    libererTotauxDependants();
    setIsAddGarantieModalOpen(false);
    setSelectedSousGarantieId('');
    setNewGarantieForm({
      capital: '0',
      prime_annuelle: '0',
      prime_nette: '0',
      montant_franchise: '0',
      taux_franchise: '0',
      franchise_minimum: '0',
      franchise_maximum: '0',
      capital_deces: '0',
      capital_ipp: '0',
      capital_ft: '0',
      reduction_commerciale: '0',
      reduction_bns: '0',
      acquise: true,
    });
    success(`Garantie "${libelle}" ajoutée avec succès !`);
  };

  // Ajout inline d'une nouvelle marque
  const handleCreateMarque = async () => {
    if (!newMarqueInput.trim()) {
      toastError('Veuillez saisir un nom de marque valide.');
      return;
    }
    const brandName = newMarqueInput.trim().toUpperCase();
    // Identifiant réel de la marque enregistrée : un identifiant local (Date.now()) faisait ensuite
    // échouer l'enregistrement du devis (marque inexistante en base)
    let idMarqueApi = null;
    try {
      const res = await settingsApi.createMarque({ LibelleMarque: brandName });
      idMarqueApi = res?.data?.IdMarque ?? res?.data?.id ?? null;
    } catch (e) {
      console.error('Création de la marque impossible', e);
    }
    if (!idMarqueApi) {
      toastError(`La marque "${brandName}" n'a pas pu être enregistrée. Réessayez ou choisissez une marque existante.`);
      return;
    }

    const newBrandObj = { id: idMarqueApi, libelle: brandName };
    setMarques((prev) => [newBrandObj, ...prev]);
    setMarqueVehicule(brandName);
    setMarqueId(newBrandObj.id);
    setIsAddMarqueModalOpen(false);
    setNewMarqueInput('');
    success(`Marque "${brandName}" ajoutée avec succès !`);
  };

  // Totaux d'une flotte à recalculer (sp_finalisation_devis) : reste vrai si la totalisation a
  // échoué après l'enregistrement des véhicules, pour qu'un nouvel essai la relance
  const [finalisationFlotteEnAttente, setFinalisationFlotteEnAttente] = useState(false);

  // Enregistrement d'une flotte comme URANUS : un sp_creation_devis par véhicule nouveau ou
  // modifié (le premier crée le devis), suppression des véhicules retirés, puis
  // sp_finalisation_devis qui totalise le devis. Renvoie l'id du devis, ou null en cas d'échec.
  const enregistrerFlotte = async (newQuote, selectedClient) => {
    // Le véhicule en cours de modification est pris tel qu'affiché à l'écran
    const saisie = instantaneVehicule();
    let vehicules = flotteEffective();
    if (editingFlotteIndex !== null) {
      if (!saisie.immatriculation) {
        toastError('Saisissez l\'immatriculation du véhicule en cours de modification.');
        setStep(2);
        return null;
      }
    } else if (saisie.immatriculation && !vehicules.some((x) => x.immatriculation === saisie.immatriculation)) {
      toastError(`Le véhicule ${saisie.immatriculation} saisi n'a pas été ajouté à la flotte : ajoutez-le ou videz son immatriculation.`);
      setStep(2);
      return null;
    }
    if (!vehicules.length) {
      toastError('Ajoutez au moins un véhicule à la flotte.');
      setStep(2);
      return null;
    }
    const doublon = vehicules.find((x, i) => vehicules.findIndex((y) => y.immatriculation === x.immatriculation) !== i);
    if (doublon) {
      toastError(`Le véhicule ${doublon.immatriculation} figure deux fois dans la flotte.`);
      setStep(2);
      return null;
    }
    // Garanties personnalisées établies pour d'autres données de tarification : leurs primes ne
    // correspondent plus au véhicule, l'utilisateur doit les confirmer ou revenir au barème
    const aReviser = vehicules.filter(garantiesAReviser);
    if (aReviser.length) {
      toastError(
        `Garanties personnalisées à revoir pour ${aReviser.map((v) => v.immatriculation).join(', ')} : le véhicule a changé depuis. `
        + 'Ouvrez « Garanties de l\'offre » pour les appliquer de nouveau ou revenir au barème.',
      );
      setStep(3);
      return null;
    }

    let idDevis = editIddevis || 0;
    let aFinaliser = finalisationFlotteEnAttente;
    const aEnvoyer = vehicules.filter(vehiculeAEnvoyer);
    let enregistres = 0;
    for (const v of aEnvoyer) {
      let obj = null;
      let erreur = '';
      try {
        const res = await quoteApi.createAutoQuote({
          ...newQuote,
          id: idDevis || undefined,
          details: {
            ...newQuote.details,
            ...v,
            idTypeVehicule: typesVehicules.find((tv) => tv.libelle === v.typeCommercial)?.id ?? v.idTypeVehicule,
            idDevis,
            idDevisDetail: v.enregistre ? v.idDevisDetail : 0,
          },
        });
        obj = Array.isArray(res?.data) ? res.data[0] : res?.data;
        if (!obj?.IdDevis) erreur = obj?.OutputMessage || 'réponse inattendue du serveur';
      } catch (e) {
        erreur = messageEnregistrement(e);
      }
      if (erreur) {
        console.error(`Enregistrement du véhicule ${v.immatriculation} impossible : ${erreur}`);
        toastError(
          `Véhicule ${v.immatriculation} non enregistré : ${erreur}.`
          + (enregistres ? ` ${enregistres} véhicule(s) enregistré(s) avant lui : corrigez puis enregistrez à nouveau, seuls les véhicules restants seront envoyés.` : ''),
        );
        setFlotteVehicules(vehicules);
        if (aFinaliser) setFinalisationFlotteEnAttente(true);
        return null;
      }
      enregistres += 1;
      aFinaliser = true;
      if (!idDevis) {
        // Devis créé par le premier véhicule : un nouvel essai le complète au lieu d'en créer un autre
        idDevis = obj.IdDevis;
        setEditIddevis(idDevis);
      }
      const maj = { ...v, idDevisDetail: obj.IdDevisDetail || v.idDevisDetail, enregistre: true };
      maj.origine = empreinteVehicule(maj);
      vehicules = vehicules.map((x) => (x.cle === v.cle ? maj : x));
    }
    setFlotteVehicules(vehicules);

    // Véhicules retirés de la liste (sp_suppression_vehicule)
    const nonSupprimes = [];
    for (const r of vehiculesRetires) {
      try {
        const res = await quoteApi.deleteFlotteVehicle(r.idDevisDetail);
        const message = (Array.isArray(res?.data) ? res.data[0]?.OutputMessage : res?.data?.OutputMessage) || '';
        if (!/supprim/i.test(message)) throw new Error(message || 'réponse inattendue du serveur');
        aFinaliser = true;
      } catch (e) {
        nonSupprimes.push(r);
        toastError(`Le véhicule ${r.immatriculation} n'a pas pu être retiré du devis : ${messageEnregistrement(e)}.`);
      }
    }
    setVehiculesRetires(nonSupprimes);
    if (nonSupprimes.length) {
      if (aFinaliser) setFinalisationFlotteEnAttente(true);
      return null;
    }

    // Garanties personnalisées (« Garanties de l'offre ») : appliquées à leur seul véhicule, une
    // fois celui-ci enregistré (son enregistrement les remet au barème). Elles restent en attente
    // jusqu'à la fin de l'enregistrement : un nouvel essai les réapplique (sans effet si déjà faites).
    for (const v of vehicules) {
      const perso = garantiesPersonnalisees(v);
      if (!perso) continue;
      try {
        const res = await quoteApi.appliquerGarantiesVehiculeFlotte({
          id_devis: Number(idDevis),
          id_devis_detail: Number(v.idDevisDetail),
          liste_garantie: listeGarantiesVehicule(perso.garanties),
        });
        const primes = res?.data?.vehicule || {};
        const cedeao = perso.garanties
          .filter((g) => g.acquise && Number(g.id_garantie) === ID_SOUS_GARANTIE_CEDEAO)
          .reduce((s, g) => s + (Number(g.primeNette) || 0), 0);
        const maj = {
          ...v,
          garantiesEnregistrees: perso.garanties.filter((g) => g.acquise),
          primesEnregistrees: {
            pa: Number(primes.prime_annuelle) || 0,
            pn: (Number(primes.prime_nette) || 0) - cedeao,
            taxe: Number(primes.taxe) || 0,
            fga: Number(primes.fga) || 0,
            cedeao,
          },
        };
        vehicules = vehicules.map((x) => (x.cle === v.cle ? maj : x));
        aFinaliser = true;
      } catch (e) {
        setFlotteVehicules(vehicules);
        if (aFinaliser) setFinalisationFlotteEnAttente(true);
        toastError(`Véhicule ${v.immatriculation} enregistré, mais ses garanties personnalisées ne l'ont pas été : ${messageEnregistrement(e)}. Enregistrez à nouveau.`);
        return null;
      }
    }
    setFlotteVehicules(vehicules);

    // Totaux du devis ; rien n'a changé : le devis enregistré est laissé tel quel
    if (aFinaliser) {
      try {
        await quoteApi.finalizeFlotteQuote({
          IdDevis: Number(idDevis),
          IdClient: Number(selectedClient?.id || 1),
          IdAssure: Number(assureId || selectedClient?.id || 1),
          Flotte: true,
        });
      } catch (e) {
        setFinalisationFlotteEnAttente(true);
        toastError(`Véhicules enregistrés, mais le calcul des totaux du devis a échoué : ${messageEnregistrement(e)}. Enregistrez à nouveau.`);
        return null;
      }
    } else {
      info('Aucune modification de la flotte à enregistrer.');
    }
    setFinalisationFlotteEnAttente(false);
    setEnteteOrigine(enteteDevis);
    // Tout est enregistré : seules restent les garanties d'un véhicule saisi hors de la liste
    setGarantiesFlotte((prev) => (prev[CLE_SAISIE] ? { [CLE_SAISIE]: prev[CLE_SAISIE] } : {}));
    return idDevis;
  };

  // ----------------------------------------------------
  // ENREGISTREMENT & VALIDATION DU DEVIS AUTOMOBILE
  // ----------------------------------------------------
  const handleFinalSubmit = async () => {
    const selectedClient = clients.find((c) => String(c.id) === String(souscripteurId));
    if (!selectedClient) {
      toastError('Choisissez le souscripteur dans la liste des clients.');
      return;
    }
    const needsDerogation = Number(reductionCommerciale) > 0;

    const newQuote = {
      // En mode édition (Modifier), on repasse le vrai id du devis existant : save_quotation
      // (Django) le détecte et met à jour ce devis/véhicule au lieu d'en créer un nouveau.
      id: editIddevis || undefined,
      client_nom: selectedClient?.nomcomplet || nomAssure || 'Assuré Uranus',
      client_id: selectedClient?.id,
      produit: typeContrat === 'FLOTTE'
        ? `Flotte Automobile (${flotteVehicules.length} Véhicules)`
        : `Automobile (${marqueVehicule} ${modeleVehicule || 'Standard'})`,
      branche: 'Auto',
      type_contrat: typeContrat,
      flotte: typeContrat === 'FLOTTE',
      nombre_vehicules: typeContrat === 'FLOTTE' ? flotteVehicules.length : 1,
      compagnie,
      compagnie_id: Number(compagnieId),
      prime_brute: calculFinancier.primeAnnuelle,
      taux_remise: Number(reductionCommerciale),
      montant_remise: Math.round(calculFinancier.primeAnnuelle * (Number(reductionCommerciale) / 100)),
      prime_nette: calculFinancier.primeNette,
      accessoires: calculFinancier.accessoire,
      taxes: calculFinancier.taxeEnregistrement,
      fga: calculFinancier.fga,
      cedeao: calculFinancier.cedeao,
      prime_totale: calculFinancier.primeTtc,
      commission_estimee: Math.round(calculFinancier.primeNette * 0.10),
      taux_commission: '10%',
      date_emission: dateEmission,
      date_effet: dateEffet,
      date_expiration: effectiveDateExpiration,
      validite_jours: 30,
      statut: needsDerogation ? 'En attente approbation' : 'En attente',
      statut_badge: needsDerogation ? 'purple' : 'amber',
      numero_police_compagnie: numeroPoliceCompagnie || 'RAS',
      details: {
        typeContrat,
        numeroPoliceCompagnie,
        idCompagnie: Number(compagnieId),
        compagnie,
        idTarif: Number(categorieId),
        categorieContrat,
        codeUsage: Number(usageId),
        usageVehicule,
        idCarrosserie: Number(carrosserieId),
        carrosserie,
        reductionCommerciale,
        bonusMalus,
        idTerme: Number(termeId),
        termeContrat,
        idDuree: Number(dureeId),
        dureeContrat,
        dateEmission,
        dateEffet,
        dateExpiration: effectiveDateExpiration,
        codeCarburant: Number(energieId),
        energie,
        codeAlarme: Number(systemeSecuriteId),
        systemeSecurite,
        codeFormuleSecuriteRoutiere: formuleSecuriteCode,
        idOptionAssistance: Number(formuleAssistanceId),
        idMarque: Number(marqueId),
        marqueVehicule,
        idGenreVehicule: Number(genreId),
        genreVehicule,
        typeCommercial,
        remorqueAttelee,
        modeleVehicule,
        puissanceFiscale,
        chargeUtile,
        nombrePlace,
        valeurNeuf,
        valeurVenale,
        valeurAccessoire,
        immatriculation: typeContrat === 'FLOTTE' ? `${flotteVehicules.length} Véhicules` : immatriculation,
        numeroCarteBrune,
        numeroChassis,
        numeroMoteur,
        dateMec,
        carburantAutreMatiere,
        transportEleves,
        transportEmployes,
        transportPassagerSupplementaire,
        nsiaAutoPlus,
        flotteVehicules: typeContrat === 'FLOTTE' ? flotteVehicules : null,
        idOffre: Number(offreId),
        // Création : IdDevis 0 et avenant 1 (affaire nouvelle) ; modification : le devis réel et son avenant
        idDevis: editIddevis || 0,
        idAvenant: editIdAvenant || 1,
        idTypeVehicule: typesVehicules.find((tv) => tv.libelle === typeCommercial)?.id,
        offreSelectionnee,
        idAssure: assureId || undefined,
        primeImposeeActive: impositionActive,
        garanties,
        nomAssure,
        telephoneClient,
        nomConducteur,
        adresseConducteur,
        categoriePermis,
        numeroPermis,
        lieuHabitation,
        numeroConducteur,
        idDevisDetail: editIdDevisDetail || undefined,
      },
    };

    // 1. Enregistrement en base : POST /api/enregistrementdevis (sp_creation_devis). Le devis complet
    // est transmis tel quel : le faire passer d'abord par dataStore.saveQuote perdait la compagnie, les
    // dates et la réduction, et son identifiant local faisait répondre « Devis inexistant ».
    // Flotte : un appel par véhicule (voir enregistrerFlotte).
    let devisApiId = null;
    if (typeContrat === 'FLOTTE') {
      devisApiId = await enregistrerFlotte(newQuote, selectedClient);
      if (!devisApiId) return;
    } else {
      try {
        const apiRes = await quoteApi.createAutoQuote(newQuote);
        const obj = Array.isArray(apiRes?.data) ? apiRes.data[0] : apiRes?.data;
        devisApiId = obj?.IdDevis || null;
        if (!devisApiId) throw new Error(obj?.OutputMessage || 'réponse inattendue du serveur');
      } catch (e) {
        console.error('Enregistrement du devis impossible', e);
        toastError(`Le devis n'a pas été enregistré : ${messageEnregistrement(e)}.`);
        return;
      }
    }

    // Relecture du devis enregistré (vrai numéro de devis) puis copie locale pour le registre
    let devisEnregistre = null;
    try {
      devisEnregistre = await quoteApi.getQuote(devisApiId);
    } catch (e) {
      console.warn('Relecture du devis enregistré impossible', e);
    }
    // Flotte : les montants sont ceux totalisés par sp_finalisation_devis, pas une estimation
    const montantsServeur = typeContrat === 'FLOTTE' && devisEnregistre
      ? {
        prime_nette: devisEnregistre.prime_nette,
        taxes: devisEnregistre.taxes,
        accessoires: devisEnregistre.accessoires,
        fga: devisEnregistre.fga,
        cedeao: devisEnregistre.cedeao,
        prime_totale: devisEnregistre.prime_totale,
      }
      : {};
    const saved = dataStore.saveQuote({ ...newQuote, ...montantsServeur, id: devisApiId, numerodevis: devisEnregistre?.numerodevis });

    // Le devis est enregistré : son brouillon éventuel n'a plus lieu d'être
    if (brouillonId) {
      brouillonApi.remove(brouillonId).catch((e) => console.warn('Suppression du brouillon impossible', e));
      setBrouillonId(null);
    }

    // 3. Si des primes ont été modifiées/imposées ou des garanties ajoutées/supprimées, appeler /api/correctiondevis/.
    // Jamais pour une flotte : sp_correction_devis appliquerait cette liste de garanties à tous ses véhicules.
    if (typeContrat !== 'FLOTTE' && (impositionActive || deletedGaranties.length > 0 || garanties.some((g) => g.is_new_garantie))) {
      try {
        const correctionPayload = {
          id_devis: Number(devisApiId),
          prime_annuelle: calculFinancier.primeAnnuelle,
          // CEDEAO comprise, comme l'envoie URANUS : sp_correction_devis la retire lui-même avant
          // sp_maj_manuelle_primes (envoyée hors CEDEAO, elle était retirée deux fois)
          prime_nette: calculFinancier.primeNette + calculFinancier.cedeao,
          taxe: calculFinancier.taxeEnregistrement,
          accessoire: calculFinancier.accessoire,
          cedeao: calculFinancier.cedeao,
          fga: calculFinancier.fga,
          prime_ttc: calculFinancier.primeTtc,
          date_emission: toDmy(dateEmission),
          date_effet: toDmy(dateEffet),
          date_expiration: toDmy(effectiveDateExpiration),
          numero_police: numeroPoliceCompagnie || `POL-${Date.now()}`,
          reduction_commerciale: Number(reductionCommerciale) || 0,
          reduction_bns: Number(bonusMalus) || 0,
          reduction_flotte: typeContrat === 'FLOTTE' ? 5.0 : 0.0,
          liste_garantie: garanties.map((g) => ({
            id_garantie: Number(g.id_garantie) || 1,
            id_devis_detail: null,
            acquise: Boolean(g.acquise),
            souscrite: Boolean(g.acquise),
            capital: Number(String(g.capital).replace(/[^0-9]/g, '')) || 0,
            prime_annuelle: Number(g.primeAnnuelle) || 0,
            prime_nette: Number(g.primeNette) || 0,
            montant_franchise: Number(String(g.franchise).replace(/[^0-9]/g, '')) || 0,
            taux_franchise: 0,
            franchise_minimum: 0,
            franchise_maximum: 0,
            capital_deces: 0,
            capital_ipp: 0,
            capital_ft: 0,
            reduction_commerciale: 0,
            reduction_bns: 0,
            is_new_garantie: Boolean(g.is_new_garantie),
          })),
          supprimer_garanties_manquantes: true,
          garanties_supprimees: deletedGaranties,
        };
        await quoteApi.correctQuote(correctionPayload);
      } catch (err) {
        console.error('Correction du devis impossible', err);
        toastError(`Devis ${saved.numerodevis} enregistré, mais les primes imposées ou les garanties modifiées n'ont pas pu être appliquées.`);
      }
    }

    if (needsDerogation) {
      success(`Devis ${saved.numerodevis} enregistré et transmis pour approbation de dérogation commerciale (${reductionCommerciale}%) !`);
    } else {
      success(`Devis Automobile ${saved.numerodevis} ${editIddevis ? 'mis à jour' : 'créé'} avec succès !`);
    }

    setCreatedQuote(devisEnregistre || saved);
  };

  const handleConvertToContract = async (quoteToConvert) => {
    try {
      await contractApi.createContractFromQuote(quoteToConvert.id);
    } catch (e) {
      console.warn('Fallback conversion contrat');
    }
    const newContract = dataStore.convertQuoteToContract(quoteToConvert);
    success(`Devis ${quoteToConvert.numerodevis} converti en Contrat sous le numéro ${newContract.numeropolice} !`);
    setCreatedQuote(null);
    navigate(`/user/contracts/${newContract.id || newContract.numeropolice}`);
  };

  if (isLoadingEdit) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '1rem', color: 'var(--text-muted)' }}>
        <Car size={32} color="#3b82f6" />
        <span>Chargement du devis à modifier…</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1240px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* Header avec lien Annuler et Stepper visuel */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <button
            type="button"
            className="btn btn-link"
            onClick={() => navigate('/user/quotes')}
            style={{ color: '#ef4444', fontWeight: 600, padding: 0, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            ← Annuler
          </button>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Car size={26} color="#3b82f6" />
            {editIddevis ? `Modifier le Devis Automobile [${editNumeroDevis || editIddevis}]` : 'Nouveau Devis Automobile & Flotte'}
          </h1>
          {avertissementReprise && (
            <p style={{ marginTop: '0.5rem', padding: '0.6rem 0.75rem', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#f59e0b', fontSize: '0.85rem', maxWidth: '760px' }}>
              {avertissementReprise}
            </p>
          )}
        </div>

        {/* Stepper à 4 onglets exactement conformes au parcours métier OREOLE */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[
            { stepNum: 1, label: '1. CONTRAT' },
            { stepNum: 2, label: '2. VÉHICULE' },
            { stepNum: 3, label: '3. OFFRE & DÉCOMPTE' },
            { stepNum: 4, label: '4. CLIENT' },
          ].map((item) => (
            <button
              key={item.stepNum}
              type="button"
              onClick={() => setStep(item.stepNum)}
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                border: step === item.stepNum ? '2px solid #2563eb' : '1px solid var(--border-subtle)',
                background: step === item.stepNum ? 'rgba(37, 99, 235, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                color: step === item.stepNum ? '#60a5fa' : 'var(--text-muted)',
                transition: 'all 0.15s ease',
              }}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSaveDraft}
            disabled={enregistrementBrouillon}
            title="Enregistrer la saisie en cours pour la reprendre plus tard (registre des devis > Brouillons en cours)"
            style={{ padding: '0.45rem 0.85rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Save size={14} />
            {enregistrementBrouillon ? 'Enregistrement…' : (brouillonId ? 'Mettre à jour le brouillon' : 'Enregistrer le brouillon')}
          </button>
        </div>
      </div>

      {/* =========================================================================
          ÉCRAN 1 : CONTRAT
          ========================================================================= */}
      {step === 1 && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          <h3 style={{ color: '#3b82f6', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1.5rem', fontSize: '1.05rem' }}>
            CONTRAT
          </h3>

          {/* TYPE DE CONTRAT SELECT */}
          <div style={{ maxWidth: '280px', marginBottom: '1.75rem' }}>
            <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem', color: '#94a3b8' }}>
              TYPE DE CONTRAT
            </label>
            <select
              className="form-control"
              value={typeContrat}
              onChange={(e) => setTypeContrat(e.target.value)}
              style={{ fontWeight: 700, borderColor: '#3b82f6', background: 'rgba(59, 130, 246, 0.08)' }}
            >
              <option value="FLOTTE">FLOTTE (MULTI-VÉHICULES)</option>
              <option value="MONO">MONO-VÉHICULE</option>
            </select>
          </div>

          {/* Ligne 1 : Numéro police compagnie | Compagnie d'Assurance | (Catégorie & Usage uniquement si MONO) */}
          <div className="responsive-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Numéro de police compagnie</label>
              <input
                type="text"
                className="form-control"
                placeholder="Ex: POL-AXA-2026-09"
                value={numeroPoliceCompagnie}
                onChange={(e) => setNumeroPoliceCompagnie(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Compagnie d'Assurance</label>
              <select
                className="form-control"
                value={compagnie}
                onChange={(e) => {
                  setCompagnie(e.target.value);
                  const selectedCie = companies.find((c) => c.nom === e.target.value);
                  if (selectedCie) setCompagnieId(selectedCie.id);
                }}
              >
                {sortUniqueBy(companies, (c) => c.nom).map((c) => (
                  <option key={c.id || c.nom} value={c.nom}>
                    {c.nom}
                  </option>
                ))}
              </select>
            </div>

            {/* En mode MONO : Catégorie & Usage sont au niveau du contrat. En mode FLOTTE : ils sont définis par véhicule dans l'étape 2 (conforme OREOLE) */}
            {typeContrat === 'MONO' && (
              <>
                <div className="form-group">
                  <label className="form-label">Catégorie (* requis)</label>
                  <select
                    className="form-control"
                    value={categorieCimaChoisie?.id ?? ''}
                    onChange={(e) => choisirGrille(categoriesCima.find((cat) => Number(cat.id) === Number(e.target.value)))}
                  >
                    {sortUniqueBy(categoriesCima, (cat) => cat.libelle).map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.libelle}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="tarif-specifique-mono">Tarifs spécifiques</label>
                  <select
                    id="tarif-specifique-mono"
                    className="form-control"
                    value={tarifSpecifiqueChoisi?.id ?? ''}
                    disabled={tarifsSpecifiques.length === 0}
                    onChange={(e) => choisirGrille(e.target.value
                      ? tarifsSpecifiques.find((t) => Number(t.id) === Number(e.target.value))
                      : categorieCimaChoisie)}
                  >
                    <option value="">{tarifsSpecifiques.length > 0 ? 'Aucun (tarif de la catégorie)' : 'Aucun tarif spécifique pour cette catégorie'}</option>
                    {trierParLibelle(tarifsSpecifiques, (t) => t.libelle).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.libelle}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ background: 'rgba(59, 130, 246, 0.2)', padding: '0.1rem 0.4rem', borderRadius: '4px', width: 'fit-content' }}>
                    Usage Véhicule
                  </label>
                  <select
                    className="form-control"
                    value={usageVehicule}
                    onChange={(e) => {
                      setUsageVehicule(e.target.value);
                      const u = usages.find((usg) => usg.libelle === e.target.value);
                      if (u) setUsageId(u.id);
                    }}
                  >
                    {sortUniqueBy(usages, (u) => u.libelle).map((u) => (
                      <option key={u.id} value={u.libelle}>
                        {u.libelle}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Ligne 2 : (Carrosseries si MONO) | Reduction commerciale (* requis) | Bonus malus (* requis) | Terme du contrat */}
          <div className="responsive-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
            {typeContrat === 'MONO' && (
              <div className="form-group">
                <label className="form-label">Carrosseries</label>
                <select
                  className="form-control"
                  value={carrosserie}
                  onChange={(e) => {
                    setCarrosserie(e.target.value);
                    const car = carrosseriesFiltrees.find((c) => c.libelle === e.target.value);
                    if (car) setCarrosserieId(car.id);
                  }}
                >
                  {sortUniqueBy(carrosseriesFiltrees, (car) => car.libelle).map((car) => (
                    <option key={car.id} value={car.libelle}>
                      {car.libelle}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Réduction commerciale (%)</label>
              <input
                type="number"
                min="0"
                max="35"
                className="form-control"
                value={reductionCommerciale}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    setReductionCommerciale('');
                    return;
                  }
                  const clamped = Math.max(0, Math.min(35, Number(raw)));
                  setReductionCommerciale(clamped);
                }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Bonus / Malus (%)</label>
              <input
                type="number"
                min="-50"
                max="100"
                className="form-control"
                value={bonusMalus}
                onChange={(e) => setBonusMalus(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Terme du contrat</label>
              <TermeContratSelect
                value={termeId}
                onChange={(id) => {
                  setTermeId(id);
                  setTermeContrat(libelleTerme(id));
                  // « Autre » ouvre la durée libre (date d'expiration saisie)
                  const duree = dureeSelonTerme(id, dureeId);
                  setDureeId(duree);
                  setDureeContrat(libelleDuree(duree));
                }}
              />
            </div>
          </div>

          {/* Option Spécifique Compagnie NSIA (conforme OREOLE Step 1) */}
          {isNsiaCompany && (
            <div style={{ marginBottom: '1.25rem', padding: '0.75rem 1rem', background: 'rgba(59, 130, 246, 0.08)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.9rem', color: '#60a5fa', fontWeight: 700, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={nsiaAutoPlus}
                  onChange={(e) => setNsiaAutoPlus(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#2563eb' }}
                />
                NSIA Auto Plus (Garantie Complémentaire Spécifique NSIA)
              </label>
            </div>
          )}

          {/* Ligne 3 : Date d'emission | Date d'effet (* requis) | Durée du contrat | Date d'expiration (* requis) */}
          <div className="responsive-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
            <div className="form-group">
              <label className="form-label">Date d'émission</label>
              <input
                type="date"
                className="form-control"
                value={dateEmission}
                readOnly
                disabled
                title="Date du jour, non modifiable"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Date d'effet (* requis)</label>
              <input
                type="date"
                className="form-control"
                value={dateEffet}
                onChange={(e) => setDateEffet(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Durée du contrat</label>
              <DureeContratSelect
                value={dureeId}
                onChange={(id) => {
                  setDureeId(id);
                  setDureeContrat(libelleDuree(id));
                }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Date d'expiration (* requis)</label>
              {Number(dureeId) === 5 ? (
                <input
                  type="date"
                  className="form-control"
                  value={customDateExpiration}
                  onChange={(e) => setCustomDateExpiration(e.target.value)}
                />
              ) : (
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary-500)', padding: '0.6rem 0' }}>
                  {effectiveDateExpiration}
                </div>
              )}
            </div>
          </div>

          {/* Bouton Suivant */}
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep(2)}
              style={{ padding: '0.65rem 1.75rem', fontWeight: 700, borderRadius: '8px', background: '#2563eb' }}
            >
              Suivant →
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          ÉCRAN 2 : VÉHICULE & GESTION PARC FLOTTE
          ========================================================================= */}
      {step === 2 && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <h3 style={{ color: '#3b82f6', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '1.05rem' }}>
              VÉHICULE {typeContrat === 'FLOTTE' && `(PARC FLOTTE : ${flotteVehicules.length} VÉHICULES)`}
            </h3>
            {typeContrat === 'FLOTTE' && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {editingFlotteIndex !== null && (
                  <span style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: 700 }}>
                    Modification du véhicule {flotteVehicules[editingFlotteIndex]?.immatriculation}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleAjouterOuMajVehicule}
                  style={{ fontSize: '0.85rem', padding: '0.45rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  {editingFlotteIndex !== null
                    ? <><Save size={16} /> Mettre à jour ce véhicule</>
                    : <><Plus size={16} /> Ajouter le véhicule courant à la flotte</>}
                </button>
                {editingFlotteIndex !== null && (
                  <button
                    type="button"
                    className="btn btn-link"
                    onClick={handleNouveauVehicule}
                    style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                  >
                    Nouveau véhicule
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Si Type Contrat === 'FLOTTE' : Le choix Catégorie, Usage, Carrosserie et Offre se fait individuellement par véhicule (conforme OREOLE) */}
          {typeContrat === 'FLOTTE' && (
            <div style={{ background: 'rgba(59, 130, 246, 0.04)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '1.25rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: '#60a5fa', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '0.05em' }}>
                PARAMÈTRES TARIFAIRES DU VÉHICULE (CONTRAT FLOTTE)
              </h4>
              <div className="responsive-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
                <div className="form-group">
                  <label className="form-label">Catégorie CIMA (* requis)</label>
                  <select
                    className="form-control"
                    value={categorieCimaChoisie?.id ?? ''}
                    onChange={(e) => choisirGrille(categoriesCima.find((cat) => Number(cat.id) === Number(e.target.value)))}
                  >
                    {trierParLibelle(categoriesCima, (cat) => cat.libelle).map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.libelle}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="tarif-specifique-flotte">Tarifs spécifiques</label>
                  <select
                    id="tarif-specifique-flotte"
                    className="form-control"
                    value={tarifSpecifiqueChoisi?.id ?? ''}
                    disabled={tarifsSpecifiques.length === 0}
                    onChange={(e) => choisirGrille(e.target.value
                      ? tarifsSpecifiques.find((t) => Number(t.id) === Number(e.target.value))
                      : categorieCimaChoisie)}
                  >
                    <option value="">{tarifsSpecifiques.length > 0 ? 'Aucun (tarif de la catégorie)' : 'Aucun tarif spécifique pour cette catégorie'}</option>
                    {trierParLibelle(tarifsSpecifiques, (t) => t.libelle).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.libelle}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Usage Véhicule (* requis)</label>
                  <select
                    className="form-control"
                    value={usageVehicule}
                    onChange={(e) => {
                      setUsageVehicule(e.target.value);
                      const u = usages.find((usg) => usg.libelle === e.target.value);
                      if (u) setUsageId(u.id);
                    }}
                  >
                    {trierParLibelle(usages, (u) => u.libelle).map((u) => (
                      <option key={u.id} value={u.libelle}>
                        {u.libelle}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Carrosserie (* requis)</label>
                  <select
                    className="form-control"
                    value={carrosserie}
                    onChange={(e) => {
                      setCarrosserie(e.target.value);
                      const car = carrosseriesFiltrees.find((c) => c.libelle === e.target.value);
                      if (car) setCarrosserieId(car.id);
                    }}
                  >
                    {trierParLibelle(carrosseriesFiltrees, (car) => car.libelle).map((car) => (
                      <option key={car.id} value={car.libelle}>
                        {car.libelle}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="offre-vehicule-flotte">Formule d'Offre pour ce véhicule</label>
                  <select
                    id="offre-vehicule-flotte"
                    className="form-control"
                    value={Number(offreId) || ''}
                    onChange={(e) => choisirOffre(e.target.value)}
                  >
                    {offresProposees.map((o) => (
                      <option key={o.id} value={o.id}>
                        {libelleOptionOffre(o)}
                      </option>
                    ))}
                  </select>
                  {listeOffresCategorie && listeOffresCategorie.length === 0 && (
                    <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: '#f59e0b' }}>
                      Aucune offre active pour la catégorie « {categorieContrat} ».
                    </div>
                  )}
                  {offreId && !offreParametree(offreId) && (
                    <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: '#f59e0b' }}>
                      Offre non paramétrée pour {compagnie || 'cette compagnie'} : aucune garantie ne sera calculée.
                    </div>
                  )}
                  {(() => {
                    const cle = cleVehiculeAffiche();
                    const v = vehiculeParCle(cle);
                    const perso = v && garantiesPersonnalisees(v);
                    const etat = !v ? null
                      : garantiesAReviser(v) ? { texte: 'Garanties personnalisées à revoir : le véhicule a changé', couleur: '#f59e0b' }
                        : perso ? {
                          texte: `Garanties personnalisées : ${perso.garanties.filter((g) => g.acquise).length} garanties, prime nette ${calculerTotauxDevisAuto({ garanties: perso.garanties }).pn.toLocaleString('fr-FR')} F`,
                          couleur: '#60a5fa',
                        }
                          : garantiesFlotte[cle]?.bareme ? { texte: 'Garanties remises au barème à l\'enregistrement', couleur: 'var(--text-muted)' }
                            : null;
                    return (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => ouvrirGarantiesVehicule(cle)}
                          title="Voir les garanties de l'offre pour ce véhicule, en retirer, en ajouter ou imposer leurs primes"
                          style={{ marginTop: '0.5rem', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.82rem', padding: '0.45rem 0.75rem' }}
                        >
                          <Shield size={15} /> Garanties de l'offre
                        </button>
                        {etat && <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: etat.couleur }}>{etat.texte}</div>}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Ligne 1 : Énergie du véhicule (* requis) | Système de sécurité (* requis) | Formule de sécurité | Formule d'assistance */}
          <div className="responsive-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Énergie du véhicule (* requis)</label>
              <select
                className="form-control"
                value={energie}
                onChange={(e) => {
                  setEnergie(e.target.value);
                  const mapEnergie = { Essence: 1, Diesel: 2, Hybride: 3, Électrique: 4 };
                  setEnergieId(mapEnergie[e.target.value] || 1);
                }}
              >
                <option value="Diesel">Diesel</option>
                <option value="Électrique">Électrique</option>
                <option value="Essence">Essence</option>
                <option value="Hybride">Hybride</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Système de sécurité (* requis)</label>
              <select
                className="form-control"
                value={systemeSecurite}
                onChange={(e) => {
                  setSystemeSecurite(e.target.value);
                  const s = systemesSecurite.find((sec) => sec.libelle === e.target.value);
                  if (s) setSystemeSecuriteId(s.id);
                }}
              >
                {sortUniqueBy(systemesSecurite, (s) => s.libelle).map((s) => (
                  <option key={s.id} value={s.libelle}>
                    {s.libelle}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Formule de sécurité routière</label>
              <select
                className="form-control"
                value={formuleSecuriteCode}
                onChange={(e) => setFormuleSecuriteCode(e.target.value)}
              >
                {/* Une option par code : seul le code est enregistré (sp_creation_devis), les
                    variantes d'une même formule (SUNU : FORMULE 1 à FT différents) sont indiscernables */}
                {sortUniqueBy(formulesSecurite, (f) => f.code).map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.libelle}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Formule d'assistance automobile</label>
              <select
                className="form-control"
                value={formuleAssistanceId}
                onChange={(e) => setFormuleAssistanceId(Number(e.target.value))}
              >
                {sortUniqueBy(formulesAssistance, (a) => a.libelle).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.libelle}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Ligne 2 : Marque du véhicule (avec bouton +) | Genre de véhicule | Type commercial du véhicule | Remorque Attelée */}
          <div className="responsive-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem', alignItems: 'center' }}>
            <div className="form-group">
              <label className="form-label">Marque du véhicule</label>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <select
                  className="form-control"
                  value={marqueVehicule}
                  onChange={(e) => {
                    setMarqueVehicule(e.target.value);
                    const m = marques.find((mrq) => mrq.libelle === e.target.value);
                    if (m) setMarqueId(m.id);
                  }}
                  style={{ flex: 1 }}
                >
                  {sortUniqueBy(marques, (m) => m.libelle).map((m) => (
                    <option key={m.id} value={m.libelle}>
                      {m.libelle}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsAddMarqueModalOpen(true)}
                  style={{ padding: '0.6rem 0.75rem', borderRadius: '8px', color: '#2563eb' }}
                  title="Ajouter une marque"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Genre de véhicule</label>
              <select
                className="form-control"
                value={genreVehicule}
                onChange={(e) => {
                  setGenreVehicule(e.target.value);
                  const g = genres.find((gnr) => gnr.libelle === e.target.value);
                  if (g) setGenreId(g.id);
                }}
              >
                {sortUniqueBy(genres, (g) => g.libelle).map((g) => (
                  <option key={g.id} value={g.libelle}>
                    {g.libelle}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Type commercial du véhicule</label>
              <select className="form-control" value={typeCommercial} onChange={(e) => setTypeCommercial(e.target.value)}>
                {sortUniqueBy(typesVehicules, (tc) => tc.libelle).map((tc) => (
                  <option key={tc.id || tc.libelle} value={tc.libelle}>
                    {tc.libelle}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingTop: '1.2rem' }}>
              <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '48px', height: '26px' }}>
                <input
                  type="checkbox"
                  checked={remorqueAttelee}
                  onChange={(e) => setRemorqueAttelee(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span
                  style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: remorqueAttelee ? '#2563eb' : '#475569',
                    borderRadius: '34px',
                    transition: '0.3s',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      height: '20px',
                      width: '20px',
                      left: remorqueAttelee ? '24px' : '3px',
                      bottom: '3px',
                      backgroundColor: 'white',
                      borderRadius: '50%',
                      transition: '0.3s',
                    }}
                  />
                </span>
              </label>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#fff' }}>Remorque Attelée</span>
            </div>
          </div>

          {/* Ligne 3 : Modèle véhicule | Puissance fiscale (* requis) | Charge utile (kg) (* requis) | Nombre de place */}
          <div className="responsive-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Modèle véhicule</label>
              <input
                type="text"
                className="form-control"
                placeholder="Modèle de véhicule"
                value={modeleVehicule}
                onChange={(e) => setModeleVehicule(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Puissance fiscale (CV) (* requis)</label>
              <input
                type="number"
                min="1"
                className="form-control"
                value={puissanceFiscale}
                onChange={(e) => setPuissanceFiscale(parseInt(e.target.value) || 0)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Charge utile (kg) (* requis)</label>
              <input
                type="number"
                min="0"
                className="form-control"
                value={chargeUtile}
                onChange={(e) => setChargeUtile(parseInt(e.target.value) || 0)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Nombre de places (* requis)</label>
              <input
                type="number"
                min="1"
                className="form-control"
                value={nombrePlace}
                onChange={(e) => setNombrePlace(parseInt(e.target.value) || 1)}
              />
            </div>
          </div>

          {/* Ligne 4 : Valeur à neuf | Valeur vénale | Valeur Accessoire | Immatriculation du véhicule */}
          <div className="responsive-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Valeur à neuf</label>
              <AmountInput value={valeurNeuf} onChange={setValeurNeuf} />
            </div>

            <div className="form-group">
              <label className="form-label">Valeur vénale</label>
              <AmountInput value={valeurVenale} onChange={setValeurVenale} />
            </div>

            <div className="form-group">
              <label className="form-label">Valeur Accessoire</label>
              <AmountInput value={valeurAccessoire} onChange={setValeurAccessoire} />
            </div>

            <div className="form-group">
              <label className="form-label">Immatriculation du véhicule</label>
              <input
                type="text"
                className="form-control"
                placeholder="Ex: 1234 AB 01"
                value={immatriculation}
                onChange={(e) => setImmatriculation(e.target.value.toUpperCase())}
              />
            </div>
          </div>

          {/* Ligne 5 : Numero carte brune physique | Numéro chassis | Numéro moteur | 1ère mise en circulation */}
          <div className="responsive-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
            <div className="form-group">
              <label className="form-label">Numéro carte brune physique</label>
              <input
                type="text"
                className="form-control"
                placeholder="Numéro carte brune physique"
                value={numeroCarteBrune}
                onChange={(e) => setNumeroCarteBrune(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Numéro chassis</label>
              <input
                type="text"
                className="form-control"
                placeholder="Numéro du chassis"
                value={numeroChassis}
                onChange={(e) => setNumeroChassis(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Numéro moteur</label>
              <input
                type="text"
                className="form-control"
                placeholder="Numéro du moteur"
                value={numeroMoteur}
                onChange={(e) => setNumeroMoteur(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">1ère mise en circulation</label>
              <input
                type="date"
                className="form-control"
                value={dateMec}
                onChange={(e) => setDateMec(e.target.value)}
              />
            </div>
          </div>

          {/* Options de transport spécifiques OREOLE (conditionnelles selon Catégorie / Tarif CIMA) */}
          {showTransportOptions && (
            <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '1rem 1.25rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', marginBottom: '2rem' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
                Options Spécifiques de Transport (Tarif CIMA Déclaré)
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#e2e8f0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={carburantAutreMatiere}
                    onChange={(e) => setCarburantAutreMatiere(e.target.checked)}
                  />
                  Carburant Autre Matière
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#e2e8f0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={transportEleves}
                    onChange={(e) => setTransportEleves(e.target.checked)}
                  />
                  Transport d'Élèves
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#e2e8f0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={transportEmployes}
                    onChange={(e) => setTransportEmployes(e.target.checked)}
                  />
                  Transport d'Employés
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#e2e8f0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={transportPassagerSupplementaire}
                    onChange={(e) => setTransportPassagerSupplementaire(e.target.checked)}
                  />
                  Passager Supplémentaire
                </label>
              </div>
            </div>
          )}

          {/* Tableau Flotte si Type Contrat === 'FLOTTE' */}
          {typeContrat === 'FLOTTE' && (
            <div style={{ marginBottom: '2rem', background: 'rgba(30, 41, 59, 0.4)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#38bdf8' }}>
                  LISTE DES VÉHICULES DU PARC FLOTTE ({flotteVehicules.length})
                </h4>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(15, 23, 42, 0.8)', color: '#94a3b8', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                      <th style={{ padding: '0.6rem 0.8rem', textAlign: 'left' }}>Immatriculation</th>
                      <th style={{ padding: '0.6rem 0.8rem', textAlign: 'left' }}>Marque & Modèle</th>
                      <th style={{ padding: '0.6rem 0.8rem', textAlign: 'left' }}>Genre</th>
                      <th style={{ padding: '0.6rem 0.8rem', textAlign: 'left' }}>Offre</th>
                      <th style={{ padding: '0.6rem 0.8rem', textAlign: 'center' }}>Puissance</th>
                      <th style={{ padding: '0.6rem 0.8rem', textAlign: 'right' }}>Valeur Vénale</th>
                      <th style={{ padding: '0.6rem 0.8rem', textAlign: 'center' }}>État</th>
                      <th style={{ padding: '0.6rem 0.8rem', textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flotteVehicules.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: '1rem 0.8rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                          Aucun véhicule : saisissez un véhicule ci-dessus puis « Ajouter le véhicule courant à la flotte ».
                        </td>
                      </tr>
                    )}
                    {flotteVehicules.map((veh, idx) => {
                      const etat = !veh.enregistre ? 'Nouveau' : vehiculeAEnvoyer(veh) ? 'Modifié' : 'Enregistré';
                      const garantiesARevoir = garantiesAReviser(editingFlotteIndex === idx ? { ...veh, ...instantaneVehicule() } : veh);
                      return (
                        <tr
                          key={veh.cle || idx}
                          style={{ borderTop: '1px solid var(--border-subtle)', background: editingFlotteIndex === idx ? 'rgba(245, 158, 11, 0.08)' : 'transparent' }}
                        >
                          <td style={{ padding: '0.65rem 0.8rem', fontWeight: 700, color: '#38bdf8' }}>{veh.immatriculation}</td>
                          <td style={{ padding: '0.65rem 0.8rem', color: '#fff' }}>{veh.marqueVehicule} {veh.modeleVehicule}</td>
                          <td style={{ padding: '0.65rem 0.8rem', color: '#cbd5e1' }}>{veh.genreVehicule}</td>
                          <td style={{ padding: '0.65rem 0.8rem', color: '#cbd5e1' }}>
                            {offresList.find((o) => Number(o.id) === Number(veh.idOffre))?.libelle || veh.offreSelectionnee || `Offre n° ${veh.idOffre}`}
                            {garantiesPersonnalisees(veh) && (
                              <div style={{ marginTop: '0.25rem' }}>
                                <StatusBadge label={garantiesARevoir ? 'Garanties à revoir' : 'Garanties personnalisées'} color={garantiesARevoir ? 'amber' : 'blue'} />
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '0.65rem 0.8rem', textAlign: 'center', color: '#cbd5e1' }}>{veh.puissanceFiscale} CV</td>
                          <td style={{ padding: '0.65rem 0.8rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#fff' }}>
                            {Number(veh.valeurVenale || 0).toLocaleString('fr-FR')} F
                          </td>
                          <td style={{ padding: '0.65rem 0.8rem', textAlign: 'center' }}>
                            <StatusBadge label={etat} color={etat === 'Enregistré' ? 'emerald' : etat === 'Modifié' ? 'amber' : 'blue'} />
                          </td>
                          <td style={{ padding: '0.65rem 0.8rem', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                              <button
                                type="button"
                                onClick={() => ouvrirGarantiesVehicule(veh.cle)}
                                className="btn btn-secondary"
                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px' }}
                                title="Garanties de l'offre de ce véhicule"
                                aria-label={`Garanties de l'offre du véhicule ${veh.immatriculation}`}
                              >
                                <Shield size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleModifierVehicule(idx)}
                                className="btn btn-secondary"
                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px' }}
                                title="Modifier ce véhicule (repris dans la saisie ci-dessus)"
                              >
                                <Edit3 size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRetirerVehicule(idx)}
                                className="btn btn-danger"
                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px' }}
                                title="Retirer ce véhicule de la flotte"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {vehiculesRetires.length > 0 && (
                <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#f59e0b' }}>
                  Supprimé{vehiculesRetires.length > 1 ? 's' : ''} du devis à l'enregistrement :{' '}
                  {vehiculesRetires.map((r) => r.immatriculation).join(', ')}
                </p>
              )}
            </div>
          )}

          {/* Boutons Précédent & Suivant */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-link"
              onClick={() => setStep(1)}
              style={{ color: '#ef4444', fontWeight: 600, padding: 0 }}
            >
              ← Précédent
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep(3)}
              style={{ padding: '0.65rem 1.75rem', fontWeight: 700, borderRadius: '8px', background: '#2563eb' }}
            >
              Suivant →
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          ÉCRAN 3 (FLOTTE) : PRIMES VÉHICULE PAR VÉHICULE
          Chaque véhicule est tarifé par la base à l'enregistrement puis le devis est totalisé
          (sp_finalisation_devis). Les garanties d'un véhicule se personnalisent dans « Garanties
          de l'offre » (garanties retirées, ajoutées, primes imposées), appliquées à ce seul véhicule.
          ========================================================================= */}
      {step === 3 && typeContrat === 'FLOTTE' && (() => {
        const vehiculesRecap = flotteEffective();
        const lignesRecap = vehiculesRecap.map((v) => ({ v, primes: primesVehicule(v) }));
        const flotteInchangee = Boolean(editIddevis) && !finalisationFlotteEnAttente && vehiculesRetires.length === 0
          && vehiculesRecap.every((v) => !vehiculeAEnvoyer(v) && !garantiesPersonnalisees(v));
        const somme = (champ) => (lignesRecap.every((l) => l.primes)
          ? lignesRecap.reduce((s, l) => s + (Number(l.primes[champ]) || 0), 0)
          : null);
        const montant = (valeur) => (valeur === null || valeur === undefined ? '…' : `${Math.round(valeur).toLocaleString('fr-FR')} F`);
        return (
          <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
              <h3 style={{ color: '#3b82f6', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '1.05rem' }}>
                PRIMES DE LA FLOTTE ({vehiculesRecap.length} VÉHICULE{vehiculesRecap.length > 1 ? 'S' : ''})
              </h3>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => estimerFlotte(true)}
                disabled={estimationFlotteEnCours}
                style={{ padding: '0.55rem 1.1rem', fontWeight: 700, borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <RotateCcw size={16} className={estimationFlotteEnCours ? 'spin' : ''} />
                {estimationFlotteEnCours ? 'Estimation en cours...' : 'Recalculer les estimations'}
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem', maxWidth: '900px' }}>
              Chaque véhicule est tarifé par la base à l'enregistrement, puis le devis est totalisé.
              Le bouton « Garanties » d'un véhicule montre les garanties de son offre et permet d'en retirer,
              d'en ajouter ou d'imposer leurs primes. L'accessoire et la prime TTC définitifs sont calculés
              à l'enregistrement.
            </p>

            <div style={{ overflowX: 'auto', marginBottom: '1.5rem', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(30, 41, 59, 0.9)', color: '#94a3b8', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Véhicule</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Offre</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Primes</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Prime annuelle</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Prime nette</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Taxes</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>FGA</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Garanties</th>
                  </tr>
                </thead>
                <tbody>
                  {lignesRecap.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ padding: '1.25rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Aucun véhicule dans la flotte : ajoutez-les à l'écran Véhicule.
                      </td>
                    </tr>
                  )}
                  {lignesRecap.map(({ v, primes }) => (
                    <tr key={v.cle} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#38bdf8' }}>
                        {v.immatriculation}
                        <div style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>{v.marqueVehicule} {v.modeleVehicule}</div>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1' }}>
                        {offresList.find((o) => Number(o.id) === Number(v.idOffre))?.libelle || `Offre n° ${v.idOffre}`}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        {garantiesAReviser(v) ? <StatusBadge label="Garanties à revoir" color="amber" />
                          : garantiesPersonnalisees(v) ? <StatusBadge label="Personnalisées" color="blue" />
                          : !vehiculeAEnvoyer(v) ? <StatusBadge label="Enregistrées" color="emerald" />
                          : estimationVehicule(v)?.erreur ? (
                            <>
                              <StatusBadge label="Estimation impossible" color="rose" />
                              <div style={{ fontSize: '0.75rem', color: '#f43f5e', marginTop: '0.3rem' }}>{estimationVehicule(v).erreur}</div>
                            </>
                          )
                            : estimationVehicule(v)?.sansGarantie ? <StatusBadge label="Offre sans garantie" color="rose" />
                              : <StatusBadge label="Estimées" color="amber" />}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{montant(primes?.pa)}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#60a5fa' }}>
                        {/* Prime nette de toutes les garanties du véhicule, CEDEAO comprise */}
                        {montant(primes?.pn == null ? null : primes.pn + (Number(primes.cedeao) || 0))}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{montant(primes?.taxe)}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{montant(primes?.fga)}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => ouvrirGarantiesVehicule(v.cle)}
                          title="Garanties de l'offre de ce véhicule : retirer, ajouter, imposer les primes"
                          aria-label={`Garanties de l'offre du véhicule ${v.immatriculation}`}
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          <Shield size={13} /> Garanties
                        </button>
                      </td>
                    </tr>
                  ))}
                  {lignesRecap.length > 0 && (
                    <tr style={{ borderTop: '2px solid var(--border-subtle)', fontWeight: 800 }}>
                      <td colSpan={3} style={{ padding: '0.75rem 1rem', color: '#fff' }}>TOTAL VÉHICULES</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{montant(somme('pa'))}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#60a5fa' }}>{montant(somme('pn'))}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{montant(somme('taxe'))}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{montant(somme('fga'))}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{montant(somme('cedeao'))}</td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {flotteInchangee && totauxEnregistres && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                  ['Prime nette', totauxEnregistres.pn],
                  ['Taxes', totauxEnregistres.taxe],
                  ['FGA', totauxEnregistres.fga],
                  ['Accessoire', totauxEnregistres.accessoire],
                  ['CEDEAO', totauxEnregistres.cedeao],
                  ['Prime TTC', totauxEnregistres.ttc],
                ].map(([libelle, valeur]) => (
                  <div key={libelle} style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' }}>{libelle} (enregistré)</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: libelle === 'Prime TTC' ? '#38bdf8' : '#fff', fontFamily: 'var(--font-mono)', marginTop: '0.35rem' }}>
                      {Math.round(valeur || 0).toLocaleString('fr-FR')} FCFA
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <button type="button" className="btn btn-link" onClick={() => setStep(2)} style={{ color: '#ef4444', fontWeight: 600, padding: 0 }}>
                ← Précédent
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStep(4)}
                style={{ padding: '0.65rem 1.75rem', fontWeight: 700, borderRadius: '8px', background: '#2563eb' }}
              >
                Suivant →
              </button>
            </div>
          </div>
        );
      })()}

      {/* =========================================================================
          ÉCRAN 3 : OFFRE, GARANTIES & DÉCOMPTE (AVEC IMPOSITION DE PRIME COMPLÈTE)
          ========================================================================= */}
      {step === 3 && typeContrat !== 'FLOTTE' && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          {/* Barre d'outils Offre : Bouton Imposer la prime + Bouton Ajouter Garantie + Bouton Recalcul CIMA */}
          <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (isEditingPrimes) {
                    setIsEditingPrimes(false);
                    setPrimesImposees(true);
                    success('Primes imposées enregistrées : elles seront reprises à l\'enregistrement du devis.');
                    return;
                  }
                  // Nouvelle imposition : les tuiles partent des totaux calculés et les suivent
                  // en temps réel ; une imposition déjà enregistrée garde ses montants saisis.
                  if (!primesImposees) setEditedExtras(TUILES_NON_IMPOSEES);
                  setIsEditingPrimes(true);
                  info('Mode "Imposer la prime" activé : modifiez les capitaux, franchises, primes et taxes, les totaux se mettent à jour en temps réel.');
                }}
                style={{
                  background: isEditingPrimes ? '#059669' : '#2563eb',
                  padding: '0.65rem 1.5rem',
                  fontWeight: 700,
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                {isEditingPrimes ? <Save size={16} /> : <Edit3 size={16} />}
                {isEditingPrimes ? 'Enregistrer' : 'Imposer la prime'}
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsAddGarantieModalOpen(true)}
                style={{
                  padding: '0.65rem 1.25rem',
                  fontWeight: 700,
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <Plus size={16} /> Ajouter une garantie
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => handleRecalculateApi(false)}
                disabled={loadingCalculation}
                style={{
                  padding: '0.65rem 1.25rem',
                  fontWeight: 700,
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
                title="Recalculer les garanties via l'API CIMA"
              >
                <RotateCcw size={16} className={loadingCalculation ? 'spin' : ''} />
                {loadingCalculation ? 'Calcul en cours...' : 'Recalculer CIMA'}
              </button>
            </div>

            {isEditingPrimes && (
              <span className="badge badge-emerald" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', fontWeight: 700 }}>
                Édition libre des primes et garanties
              </span>
            )}
            {!isEditingPrimes && primesImposees && (
              <span className="badge badge-emerald" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', fontWeight: 700 }}>
                Primes imposées (« Recalculer CIMA » pour revenir au barème)
              </span>
            )}
          </div>

          <h3 style={{ color: '#3b82f6', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', fontSize: '1.05rem' }}>
            OFFRE D'ASSURANCE
          </h3>

          {/* Sélection de l'offre */}
          <div style={{ maxWidth: '440px', marginBottom: '1.75rem' }}>
            <select
              className="form-control"
              value={Number(offreId) || ''}
              onChange={(e) => choisirOffre(e.target.value)}
              style={{ fontWeight: 700, fontSize: '0.9rem' }}
            >
              {offresProposees.map((o) => (
                <option key={o.id} value={o.id}>
                  {libelleOptionOffre(o)}
                </option>
              ))}
            </select>
            {listeOffresCategorie && listeOffresCategorie.length === 0 && (
              <p style={{ color: '#f59e0b', fontSize: '0.8rem', marginTop: '0.4rem' }}>
                ⚠ Aucune offre active pour la catégorie « {categorieContrat} ».
              </p>
            )}
            {offreId && !offreParametree(offreId) && (
              <p style={{ color: '#f59e0b', fontSize: '0.8rem', marginTop: '0.4rem' }}>
                ⚠ Cette offre n'a aucune garantie paramétrée pour {compagnie || 'cette compagnie'} (table Offres &amp; Garanties à compléter par un administrateur).
              </p>
            )}
            {categorieSelectionnee && grilleOffre && grilleOffre.id !== categorieSelectionnee.id && (
              <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.4rem' }}>
                Offre paramétrée sur la grille « {grilleOffre.libelle} » : les primes sont calculées
                avec la catégorie choisie « {categorieSelectionnee.libelle} ».
              </p>
            )}
          </div>

          {/* Tableau des Garanties : GARANTIE | ACQUISE | CAPITAL | FRANCHISE | FORMULE | PLACE | PRIME ANNUELLE | PRIME NETTE | ACTIONS */}
          <div style={{ overflowX: 'auto', marginBottom: '2rem', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: 'rgba(30, 41, 59, 0.9)', color: '#94a3b8', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>GARANTIE</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>ACQUISE</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>CAPITAL</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>FRANCHISE</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>PRIME ANNUELLE</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>PRIME NETTE</th>
                  {isEditingPrimes && <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>ACTIONS</th>}
                </tr>
              </thead>
              <tbody>
                {garanties.length === 0 && (
                  <tr>
                    <td colSpan={isEditingPrimes ? 7 : 6} style={{ padding: '1.25rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Aucune garantie configurée pour cette offre avec cette compagnie. Paramétrez-la dans « Offres & Garanties ».
                    </td>
                  </tr>
                )}
                {garanties.map((g, idx) => (
                  <tr key={g.code || idx} style={{ borderTop: '1px solid var(--border-subtle)', background: idx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                    <td style={{ padding: '0.85rem 1rem', fontWeight: 600, color: '#fff' }}>
                      {g.nom}
                      {g.is_new_garantie && (
                        <span className="badge badge-blue" style={{ marginLeft: '0.5rem', fontSize: '0.65rem' }}>
                          Ajoutée
                        </span>
                      )}
                    </td>

                    <td style={{ padding: '0.85rem 0.5rem', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={g.acquise}
                        disabled={estGarantieRc(g)}
                        onChange={() => handleToggleGarantie(idx)}
                        style={{ width: '16px', height: '16px', cursor: estGarantieRc(g) ? 'not-allowed' : 'pointer' }}
                      />
                    </td>

                    <td style={{ padding: '0.85rem 1rem', color: '#cbd5e1' }}>
                      {isEditingPrimes ? (
                        <input
                          type="text"
                          className="form-control"
                          style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', width: '130px' }}
                          value={g.capital}
                          onChange={(e) => handleUpdateGarantieField(idx, 'capital', e.target.value)}
                        />
                      ) : (
                        g.capital
                      )}
                    </td>

                    <td style={{ padding: '0.85rem 1rem', color: '#cbd5e1' }}>
                      {isEditingPrimes ? (
                        <input
                          type="text"
                          className="form-control"
                          style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', width: '130px' }}
                          value={g.franchise}
                          onChange={(e) => handleUpdateGarantieField(idx, 'franchise', e.target.value)}
                        />
                      ) : (
                        g.franchise
                      )}
                    </td>


                    <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#fff' }}>
                      {isEditingPrimes ? (
                        <input
                          type="number"
                          className="form-control"
                          style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', width: '110px', textAlign: 'right' }}
                          value={g.primeAnnuelle}
                          onChange={(e) => handleUpdateGarantieField(idx, 'primeAnnuelle', Number(e.target.value) || 0)}
                        />
                      ) : (
                        `${(g.acquise ? Number(g.primeAnnuelle) : 0).toLocaleString('fr-FR')} F`
                      )}
                    </td>

                    <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#60a5fa' }}>
                      {isEditingPrimes ? (
                        <input
                          type="number"
                          className="form-control"
                          style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', width: '110px', textAlign: 'right', color: '#60a5fa', fontWeight: 700 }}
                          value={g.primeNette}
                          onChange={(e) => handleUpdateGarantieField(idx, 'primeNette', Number(e.target.value) || 0)}
                        />
                      ) : (
                        `${(g.acquise ? Number(g.primeNette) : 0).toLocaleString('fr-FR')} F`
                      )}
                    </td>

                    {isEditingPrimes && (
                      <td style={{ padding: '0.85rem 0.5rem', textAlign: 'center' }}>
                        {g.code !== 'RC' && (
                          <button
                            type="button"
                            onClick={() => handleDeleteGarantie(idx)}
                            className="btn btn-danger"
                            style={{ padding: '0.3rem 0.5rem', borderRadius: '4px' }}
                            title="Supprimer cette garantie"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Les Tuiles financières (Taxe, FGA, Accessoire, Prime Annuelle, Prime Nette, Prime TTC) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
            {/* Tuile 1 : TAXE D'ENREGISTREMENT */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <FileText size={15} color="#60a5fa" />
                TAXE D'ENREGISTREMENT (14.5%)
              </div>
              {isEditingPrimes ? (
                <input
                  type="number"
                  className="form-control"
                  style={{ marginTop: '0.5rem', fontWeight: 800, fontSize: '1.25rem' }}
                  value={valeurTuile('taxe', calculFinancier.taxeEnregistrement)}
                  onChange={(e) => handleTuileChange('taxe', e.target.value)}
                />
              ) : (
                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#fff', marginTop: '0.5rem', fontFamily: 'var(--font-mono)' }}>
                  {calculFinancier.taxeEnregistrement.toLocaleString('fr-FR')} FCFA
                </div>
              )}
            </div>

            {/* Tuile 2 : FGA */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <Shield size={15} color="#fbbf24" />
                FGA (FONDS DE GARANTIE)
              </div>
              {isEditingPrimes ? (
                <input
                  type="number"
                  className="form-control"
                  style={{ marginTop: '0.5rem', fontWeight: 800, fontSize: '1.25rem' }}
                  value={valeurTuile('fga', calculFinancier.fga)}
                  onChange={(e) => handleTuileChange('fga', e.target.value)}
                />
              ) : (
                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#fff', marginTop: '0.5rem', fontFamily: 'var(--font-mono)' }}>
                  {calculFinancier.fga.toLocaleString('fr-FR')} FCFA
                </div>
              )}
            </div>

            {/* Tuile 3 : ACCESSOIRE */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <Layers size={15} color="#34d399" />
                ACCESSOIRE
              </div>
              {isEditingPrimes ? (
                <input
                  type="number"
                  className="form-control"
                  style={{ marginTop: '0.5rem', fontWeight: 800, fontSize: '1.25rem' }}
                  value={valeurTuile('accessoire', calculFinancier.accessoire)}
                  onChange={(e) => handleTuileChange('accessoire', e.target.value)}
                />
              ) : (
                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#fff', marginTop: '0.5rem', fontFamily: 'var(--font-mono)' }}>
                  {calculFinancier.accessoire.toLocaleString('fr-FR')} FCFA
                </div>
              )}
            </div>

            {/* Tuile 4 : TOTAL PRIME ANNUELLE */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <Clock size={15} color="#a78bfa" />
                TOTAL PRIME ANNUELLE
              </div>
              {isEditingPrimes ? (
                <input
                  type="number"
                  className="form-control"
                  style={{ marginTop: '0.5rem', fontWeight: 800, fontSize: '1.25rem' }}
                  value={valeurTuile('pa', calculFinancier.primeAnnuelle)}
                  onChange={(e) => handleTuileChange('pa', e.target.value)}
                />
              ) : (
                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#fff', marginTop: '0.5rem', fontFamily: 'var(--font-mono)' }}>
                  {calculFinancier.primeAnnuelle.toLocaleString('fr-FR')} FCFA
                </div>
              )}
            </div>

            {/* Tuile 5 : TOTAL PRIME NETTE — toutes les garanties de la liste, CEDEAO comprise
                (elle n'a plus de tuile à part : prime nette + taxe + FGA + accessoire = TTC) */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <Plus size={15} color="#38bdf8" />
                TOTAL PRIME NETTE
              </div>
              {isEditingPrimes ? (
                <input
                  type="number"
                  className="form-control"
                  style={{ marginTop: '0.5rem', fontWeight: 800, fontSize: '1.25rem', color: '#60a5fa' }}
                  value={editedExtras.pn != null && editedExtras.pn !== ''
                    ? String(Number(editedExtras.pn) + calculFinancier.cedeao)
                    : String(calculFinancier.primeNetteGaranties)}
                  // La saisie inclut la CEDEAO ; la prime nette transmise reste hors CEDEAO
                  onChange={(e) => handleTuileChange('pn', e.target.value === ''
                    ? ''
                    : String(Number(e.target.value) - calculFinancier.cedeao))}
                />
              ) : (
                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#60a5fa', marginTop: '0.5rem', fontFamily: 'var(--font-mono)' }}>
                  {calculFinancier.primeNetteGaranties.toLocaleString('fr-FR')} FCFA
                </div>
              )}
            </div>

            {/* Tuile 6 : PRIME TTC */}
            <div style={{ background: 'rgba(37, 99, 235, 0.12)', padding: '1.25rem', borderRadius: '12px', border: '1.5px solid #2563eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#60a5fa', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>PRIME TTC</span>
                <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>{impositionActive ? 'Imposée' : 'Calculé'}</span>
              </div>
              {isEditingPrimes ? (
                <input
                  type="number"
                  className="form-control"
                  style={{ marginTop: '0.5rem', fontWeight: 900, fontSize: '1.35rem', color: '#38bdf8' }}
                  value={valeurTuile('ttc', calculFinancier.primeTtc)}
                  onChange={(e) => handleTuileChange('ttc', e.target.value)}
                />
              ) : (
                <div style={{ fontSize: '1.85rem', fontWeight: 900, color: '#38bdf8', marginTop: '0.5rem', fontFamily: 'var(--font-mono)' }}>
                  {calculFinancier.primeTtc.toLocaleString('fr-FR')} FCFA
                </div>
              )}
            </div>
          </div>

          {/* Boutons Précédent & Suivant */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-link"
              onClick={() => setStep(2)}
              style={{ color: '#ef4444', fontWeight: 600, padding: 0 }}
            >
              ← Précédent
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep(4)}
              style={{ padding: '0.65rem 1.75rem', fontWeight: 700, borderRadius: '8px', background: '#2563eb' }}
            >
              Suivant →
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          ÉCRAN 4 : CLIENT ASSURÉ
          ========================================================================= */}
      {step === 4 && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          <h3 style={{ color: '#3b82f6', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1.5rem', fontSize: '1.05rem' }}>
            CLIENT ASSURÉ
          </h3>

          {/* Ligne 1 : Nom du souscripteur (avec search et bouton +) | Nom de l'assuré | Numéro de téléphone */}
          <div className="responsive-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Nom du souscripteur</label>
              <input
                type="text"
                className="form-control"
                placeholder="Rechercher un client..."
                value={searchSouscripteur}
                onChange={(e) => setSearchSouscripteur(e.target.value)}
                style={{ marginBottom: '0.4rem' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select
                  className="form-control"
                  value={souscripteurId ?? ''}
                  onChange={(e) => setSouscripteurId(parseInt(e.target.value))}
                  style={{ flex: 1 }}
                >
                  {clientsProposes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nomcomplet} ({c.codeclient})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setIsQuickAddClientOpen(true)}
                  style={{
                    padding: '0.6rem 0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    background: '#2563eb',
                    borderRadius: '8px',
                    fontWeight: 700,
                  }}
                  title="Créer un nouveau client"
                >
                  <Plus size={18} />
                </button>
              </div>
              {clients.length > 0 && clientsProposes.length === 0 && (
                <div style={{ marginTop: '0.4rem', color: '#ef4444', fontSize: '0.8rem' }}>
                  Aucun client ne correspond à « {searchSouscripteur.trim()} ». Créez-le avec le bouton +.
                </div>
              )}
              {societeEnCategorie201 && (
                <div style={{ marginTop: '0.5rem', padding: '0.6rem 0.75rem', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#f59e0b', fontSize: '0.8rem' }}>
                  Ce souscripteur est une société : NSIA tarifie ses véhicules de tourisme en
                  catégorie 212 (personnes morales, RC majorée de 5 %), pas en 201.
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={passerEnCategoriePersonneMorale}
                    style={{ marginTop: '0.4rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 700, borderRadius: '6px', display: 'block' }}
                  >
                    Passer en « {categoriePersonneMorale.libelle} »
                  </button>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Nom de l'assuré</label>
              <input
                type="text"
                className="form-control"
                value={nomAssure}
                onChange={(e) => setNomAssure(e.target.value)}
                placeholder="Nom complet de l'assuré"
                style={{ marginTop: '2rem' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Numéro de téléphone</label>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: '2rem' }}>
                <span style={{ padding: '0.6rem 0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-subtle)', borderRight: 'none', borderRadius: '8px 0 0 8px', color: '#94a3b8', fontSize: '0.85rem' }}>
                  +225
                </span>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Entrez le numéro"
                  value={telephoneClient.replace(/^\+225\s*/, '')}
                  onChange={(e) => setTelephoneClient(`+225 ${e.target.value}`)}
                  style={{ borderRadius: '0 8px 8px 0' }}
                />
              </div>
            </div>
          </div>

          {/* Ligne 2 : Nom du conducteur | Adresse du conducteur | Catégorie de permis */}
          <div className="responsive-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Nom du conducteur</label>
              <input
                type="text"
                className="form-control"
                placeholder="Nom complet du conducteur principal"
                value={nomConducteur}
                onChange={(e) => setNomConducteur(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Adresse du conducteur</label>
              <input
                type="text"
                className="form-control"
                placeholder="Adresse du conducteur"
                value={adresseConducteur}
                onChange={(e) => setAdresseConducteur(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Catégorie de permis</label>
              <select className="form-control" value={categoriePermis} onChange={(e) => setCategoriePermis(e.target.value)}>
                {sortUniqueBy(categoriesPermis, (cp) => cp.libelle).map((cp) => (
                  <option key={cp.id} value={cp.libelle}>
                    {cp.libelle}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Ligne 3 : Numéro du permis | Lieu d'habitation | Numéro du conducteur */}
          <div className="responsive-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
            <div className="form-group">
              <label className="form-label">Numéro du permis</label>
              <input
                type="text"
                className="form-control"
                placeholder="Numéro du permis"
                value={numeroPermis}
                onChange={(e) => setNumeroPermis(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Lieu d'habitation</label>
              <input
                type="text"
                className="form-control"
                placeholder="Lieu d'habitation (ex: Cocody, Plateau)"
                value={lieuHabitation}
                onChange={(e) => setLieuHabitation(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Numéro du conducteur</label>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ padding: '0.6rem 0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-subtle)', borderRight: 'none', borderRadius: '8px 0 0 8px', color: '#94a3b8', fontSize: '0.85rem' }}>
                  +225
                </span>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Numéro direct"
                  value={numeroConducteur.replace(/^\+225\s*/, '')}
                  onChange={(e) => setNumeroConducteur(`+225 ${e.target.value}`)}
                  style={{ borderRadius: '0 8px 8px 0' }}
                />
              </div>
            </div>
          </div>

          {/* Boutons Précédent & Valider le devis */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-link"
              onClick={() => setStep(3)}
              style={{ color: '#ef4444', fontWeight: 600, padding: 0 }}
            >
              ← Précédent
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleFinalSubmit}
              style={{
                padding: '0.75rem 2.5rem',
                fontWeight: 800,
                borderRadius: '8px',
                background: '#2563eb',
                boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <CheckCircle2 size={18} />
              Enregistrer le Devis
            </button>
          </div>
        </div>
      )}

      {/* Modal Ajout Marque */}
      {isAddMarqueModalOpen && (
        <div className="modal-backdrop" style={{ zIndex: 9999 }}>
          <div className="modal-content glass-panel" style={{ maxWidth: '420px', padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#3b82f6' }}>Nouvelle Marque de Véhicule</h3>
              <button
                type="button"
                className="btn btn-link"
                onClick={() => setIsAddMarqueModalOpen(false)}
                style={{ color: '#94a3b8', padding: 0 }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label">Libellé de la Marque</label>
              <input
                type="text"
                className="form-control"
                placeholder="Ex: SUZUKI, AUDI, MAZDA..."
                value={newMarqueInput}
                onChange={(e) => setNewMarqueInput(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsAddMarqueModalOpen(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreateMarque}
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ajouter une Garantie (Drawer / Popup OREOLE) */}
      {isAddGarantieModalOpen && (
        <div className="modal-backdrop" style={{ zIndex: 9999 }}>
          <div className="modal-content glass-panel" style={{ maxWidth: '640px', padding: '1.75rem', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Shield size={20} color="#3b82f6" />
                Ajouter une garantie automobile
              </h3>
              <button
                type="button"
                className="btn btn-link"
                onClick={() => setIsAddGarantieModalOpen(false)}
                style={{ color: '#94a3b8', padding: 0 }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <label className="form-label">Sélectionner la sous-garantie (* requis)</label>
              <select
                className="form-control"
                value={selectedSousGarantieId}
                onChange={(e) => setSelectedSousGarantieId(e.target.value)}
                style={{ fontWeight: 600 }}
              >
                <option value="">-- Choisir une garantie disponible --</option>
                {sousGarantiesAll.length > 0 ? (
                  trierParLibelle(sousGarantiesAll, (sg) => sg.LibelleSousGarantie || sg.libelle).map((sg) => (
                    <option key={sg.IdSousGarantie || sg.id} value={sg.IdSousGarantie || sg.id}>
                      {sg.LibelleSousGarantie || sg.libelle}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="11">VOL ACCESSOIRES & OBJETS</option>
                    <option value="12">VANDALISME & ÉVÉNEMENTS SOCIAUX</option>
                    <option value="13">CATASTROPHES NATURELLES</option>
                    <option value="14">SÉCURITÉ ROUTIÈRE RENFORCÉE</option>
                    <option value="15">INDIVIDUELLE CHAUFFEUR</option>
                  </>
                )}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Capital garanti (FCFA)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="0"
                  value={newGarantieForm.capital}
                  onChange={(e) => setNewGarantieForm({ ...newGarantieForm, capital: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Prime Annuelle (FCFA)</label>
                <input
                  type="number"
                  className="form-control"
                  placeholder="0"
                  value={newGarantieForm.prime_annuelle}
                  onChange={(e) => setNewGarantieForm({ ...newGarantieForm, prime_annuelle: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Prime Nette (FCFA)</label>
                <input
                  type="number"
                  className="form-control"
                  placeholder="0"
                  value={newGarantieForm.prime_nette}
                  onChange={(e) => setNewGarantieForm({ ...newGarantieForm, prime_nette: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Montant franchise (FCFA)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="0"
                  value={newGarantieForm.montant_franchise}
                  onChange={(e) => setNewGarantieForm({ ...newGarantieForm, montant_franchise: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Franchise min</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="0"
                  value={newGarantieForm.franchise_minimum}
                  onChange={(e) => setNewGarantieForm({ ...newGarantieForm, franchise_minimum: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Franchise max</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="0"
                  value={newGarantieForm.franchise_maximum}
                  onChange={(e) => setNewGarantieForm({ ...newGarantieForm, franchise_maximum: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsAddGarantieModalOpen(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAddNewGarantie}
                style={{ background: '#2563eb' }}
              >
                Ajouter la garantie
              </button>
            </div>
          </div>
        </div>
      )}

      {/* « Garanties de l'offre » d'un véhicule de flotte */}
      {garantiesOuvertes && (() => {
        const v = vehiculeParCle(garantiesOuvertes.cle);
        if (!v) return null;
        return (
          <GarantiesVehiculeFlotteModal
            isOpen
            onClose={() => setGarantiesOuvertes(null)}
            vehicule={v.immatriculation}
            libelleOffre={offresList.find((o) => Number(o.id) === Number(v.idOffre))?.libelle || v.offreSelectionnee}
            initial={garantiesInitiales(v)}
            chargerBareme={() => chargerBaremeVehicule(v)}
            sousGaranties={sousGarantiesAll}
            tauxTaxes={tauxTaxesAuto}
            onAppliquer={(resultat) => appliquerGarantiesVehicule(garantiesOuvertes.cle, resultat)}
          />
        );
      })()}

      {/* Modal de visualisation après création */}
      {createdQuote && (
        <ViewQuoteModal
          isOpen={Boolean(createdQuote)}
          quote={createdQuote}
          onClose={() => {
            setCreatedQuote(null);
            navigate('/user/quotes');
          }}
          onConvertToContract={handleConvertToContract}
        />
      )}

      {/* Modal d'ajout rapide complet de client */}
      <QuickAddClientModal
        isOpen={isQuickAddClientOpen}
        onClose={() => setIsQuickAddClientOpen(false)}
        onClientCreated={(newClient) => {
          setClients((prev) => [newClient, ...prev]);
          setSouscripteurId(newClient.id || newClient.IdClient);
          setSearchSouscripteur(newClient.nomcomplet || '');
          setTelephoneClient(newClient.telephone || newClient.mobile || '+225 ');
          setNomAssure(newClient.nomcomplet || '');
          setNomConducteur(newClient.nomcomplet || '');
        }}
      />
    </div>
  );
};

export default NewAutoQuotePage;
