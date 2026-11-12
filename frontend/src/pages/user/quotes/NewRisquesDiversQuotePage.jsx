import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from '../../../utils/navigationDevis';
import { dataStore } from '../../../api/dataStore';
import { quoteApi, customerApi, settingsApi, contractApi, risquesDiversApi, valeursUsuellesApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import {
  Check, Plus, Shield, AlertTriangle, ChevronLeft, ChevronRight, FileText, ListChecks, Calculator, Users, Loader2,
  RefreshCw, Lightbulb, Trash2, X,
} from 'lucide-react';
import { ViewQuoteModal } from './ViewQuoteModal';
import { PieceJointe } from '../../../components/common/PieceJointe';
import PoliceMineneConnexe from './PoliceMineneConnexe';
import { QuickAddClientModal } from '../clients/QuickAddClientModal';
import { BandeauQuestionnaire, useQuestionnaireDevis } from './QuestionnaireDevis';
import { TermeContratSelect } from '../../../components/common/TermeContratSelect';
import { DureeContratSelect } from '../../../components/common/DureeContratSelect';
import { ID_TERME_PAR_DEFAUT, dureeSelonTerme, termeEtDureeEnregistres } from '../../../utils/termesContrat';
import { sortUniqueBy, trierParLibelle } from '../../../utils/sortUtils';
import { AmountInput } from '../../../components/common/AmountInput';
import { ChampPropose, propositionMontant, propositionTaux, propositionsUsuelles, sansDoublon } from '../../../components/common/ListePropositions';
import { arrondirMontant, parametre, reglagesMinene, compagnieParDefaut } from '../../../utils/parametrage';
import { Champ, RechercheClient, FichePersonne, personneDepuisClient } from '../../../components/common/RechercheClient';
import { EtapesDevis, ResumeDevis } from '../../../components/common/ParcoursDevis';
import { Modal } from '../../../components/common/Modal';
import { confirmer } from '../../../utils/dialogue';

// Produits servis par ce formulaire (même procédure URANUS : sp_creation_devis_risques_divers)
const PRODUITS = {
  7: { libelle: 'Multirisque Professionnelle', court: 'MRP', couleur: '#0891b2' },
  8: { libelle: 'Responsabilité Civile', court: 'RC', couleur: '#dc2626' },
};
// Garanties ajoutées au devis ou retirées à la saisie, comme dans l'Automobile (demande du 2026-11-02) : MRP
const PRODUITS_AJOUT_GARANTIES = [7];
// Champs saisis pour chaque garantie : champ de l'écran, clé des valeurs proposées, libellé
const CHAMPS_GARANTIE = [
  ['capital', 'Capital', 'Capital'],
  ['franchiseMinimum', 'FranchiseMinimum', 'Franchise min.'],
  ['franchiseMaximum', 'FranchiseMaximum', 'Franchise max.'],
  ['tauxFranchise', 'TauxFranchise', 'Taux de franchise (%)'],
];
// Offre RC chef de famille MINENE : primes calculées par la base, n° de police Santé connexe exigé
const ID_OFFRE_MINENE = 67;
const ID_TARIF_MINENE = 104;
// Valeurs fixées par URANUS pour MINENE : compagnie NSIA, un an, capitaux du barème OREOLE
// Capitaux : Administration > Réglages Santé MINENE (50 M / 5 M / 10 M à l'origine)
const MINENE = { idCompagnie: 1, dureeId: 4 };
// Réduction commerciale RC plafonnée comme dans URANUS
// Réduction maximale RC : Administration > Le cabinet & règles de gestion (35 % à l'origine)
const reductionMaxRc = () => parametre('devis.reduction_max_rc', 35);

// Espace insécable ordinaire : l'espace fine du français n'est pas dessinée par toutes les polices (montants en gras)
const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/ /g, ' ');

// Étapes du parcours (présentation de l'écran MRH)
const ETAPES_RISQUES_DIVERS = [
  { num: 1, libelle: 'Contrat et risque', icone: FileText },
  { num: 2, libelle: 'Garanties', icone: ListChecks },
  { num: 3, libelle: 'Prime et souscripteur', icone: Calculator },
];
const aujourdhui = () => new Date().toISOString().split('T')[0];
const jour = (v) => (v ? String(v).slice(0, 10) : '');

// Message lisible d'une erreur de l'API (liste [{OutputMessage}], {error}, ou erreurs par champ)
const messageErreurApi = (err) => {
  const data = err?.response?.data;
  if (!data) return err?.message || 'serveur injoignable';
  if (Array.isArray(data)) return data[0]?.OutputMessage || JSON.stringify(data[0]);
  if (typeof data === 'string') return data.slice(0, 200);
  const direct = data.message || data.error || data.erreur || data.detail || data.OutputMessage;
  if (direct) return typeof direct === 'string' ? direct : JSON.stringify(direct);
  return Object.entries(data)
    .map(([champ, v]) => `${champ} : ${Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(' ') : typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ; ');
};

const expirationPour = (dateEffet, dureeId, personnalisee) => {
  if (!dateEffet) return '';
  if (Number(dureeId) === 5) return personnalisee || '';
  const mois = { 1: 1, 2: 3, 3: 6, 4: 12 }[Number(dureeId)] || 12;
  const d = new Date(dateEffet);
  d.setMonth(d.getMonth() + mois);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

// Ligne renvoyée par offregarantie{rc|mrp} -> garantie éditable du formulaire ; montant nul affiché vide.
// vide : garantie proposée par l'offre en saisie manuelle (RC sans barème), capitaux et franchises à saisir
const garantieDepuisApi = (r, acquise, vide = false) => {
  const valeur = (v, arrondi = true) => (vide ? '' : (arrondi ? Math.round(Number(v) || 0) : Number(v) || 0) || '');
  return {
    id: Number(r.IdSousGarantie),
    libelle: r.LibelleSousGarantie,
    acquise,
    capital: valeur(r.Capital),
    franchiseMinimum: valeur(r.FranchiseMinimum),
    franchiseMaximum: valeur(r.FranchiseMaximum),
    tauxFranchise: valeur(r.TauxFranchise, false),
    montantFranchise: valeur(r.MontantFranchise),
    primeNette: Math.round(Number(r.PrimeNette) || 0),
  };
};

// Champ montant ou taux laissé vide (et non « 0 ») tant que rien n'est saisi
const montantSaisi = (v) => v || '';
const tauxSaisi = (texte, max = Infinity) => (texte === '' ? '' : Math.max(0, Math.min(max, Number(texte) || 0)));

export const NewRisquesDiversQuotePage = ({ produit }) => {
  const idProduit = Number(produit);
  const infos = PRODUITS[idProduit];
  const estRc = idProduit === 8;
  const navigate = useNavigate();
  const { success, error: toastError, info } = useToast();

  // « Modifier » depuis le registre des devis : ?edit=<iddevis>
  const [searchParams] = useSearchParams();
  const editIddevisParam = searchParams.get('edit');
  const [isLoadingEdit, setIsLoadingEdit] = useState(Boolean(editIddevisParam));
  const [idDevisEdite, setIdDevisEdite] = useState(null);
  const [numeroDevisEdite, setNumeroDevisEdite] = useState('');
  const [idAvenant, setIdAvenant] = useState(1);

  const [step, setStep] = useState(1);
  const [createdQuote, setCreatedQuote] = useState(null);
  // Nouveau client créé depuis l'écran : pour le souscripteur ou pour l'assuré
  const [nouveauClientPour, setNouveauClientPour] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Référentiels
  const [companies, setCompanies] = useState(() => dataStore.getActiveCompanies(infos?.court || 'RC'));
  const [tarifs, setTarifs] = useState([]);
  const [offres, setOffres] = useState([]);
  const [domaines, setDomaines] = useState([]);
  // Catégories sans aucune offre (ex. « RESPONSABILITE CIVILE » 100) : non proposées à la saisie
  const [tarifsSansOffre, setTarifsSansOffre] = useState(() => new Set());
  // Ajout d'un domaine d'activité depuis le formulaire (null = champ fermé)
  const [nouveauDomaine, setNouveauDomaine] = useState(null);
  // Offre enregistrée sur le devis modifié : gardée même si la catégorie ne la propose pas
  const [offreDevis, setOffreDevis] = useState(null);

  // Étape 1 : contrat
  const [compagnieId, setCompagnieId] = useState(() => compagnieParDefaut(produit));
  const [idTarif, setIdTarif] = useState(0);
  const [idOffre, setIdOffre] = useState(0);
  const [dureeId, setDureeId] = useState(4);
  const [termeId, setTermeId] = useState(ID_TERME_PAR_DEFAUT);
  // Date d'émission : toujours la date du jour, jamais saisie (le serveur l'impose aussi)
  const dateEmission = aujourdhui();
  const [dateEffet, setDateEffet] = useState(aujourdhui);
  const [expirationPersonnalisee, setExpirationPersonnalisee] = useState('');
  const [reduction, setReduction] = useState('');
  const [numeroPoliceCompagnie, setNumeroPoliceCompagnie] = useState('');
  const [numeroPoliceConnexe, setNumeroPoliceConnexe] = useState('');
  const dateExpiration = useMemo(
    () => expirationPour(dateEffet, dureeId, expirationPersonnalisee),
    [dateEffet, dureeId, expirationPersonnalisee]
  );
  // Champs propres à la RC (complément du devis)
  const [activite, setActivite] = useState('');
  const [idDomaineActivite, setIdDomaineActivite] = useState(0);
  const [localisation, setLocalisation] = useState('');
  const [dateDebut, setDateDebut] = useState('');
  const [nombreParticipants, setNombreParticipants] = useState(0);
  const [assiettePrime, setAssiettePrime] = useState('');
  const [tauxPrime, setTauxPrime] = useState('');
  const [capitalDommageCorporel, setCapitalDommageCorporel] = useState('');
  const [capitalIntoxication, setCapitalIntoxication] = useState('');
  const [capitalDommageMateriel, setCapitalDommageMateriel] = useState('');

  // Étape 2 : garanties
  const [garanties, setGaranties] = useState([]);
  // Garanties que l'on peut ajouter (catalogue « risques divers ») et saisie de la garantie ajoutée (null : fenêtre fermée)
  const [catalogueGaranties, setCatalogueGaranties] = useState([]);
  const [ajoutGarantie, setAjoutGarantie] = useState(null);
  const [offreDesGaranties, setOffreDesGaranties] = useState(null);
  const [chargementGaranties, setChargementGaranties] = useState(false);
  const [primeTarif, setPrimeTarif] = useState(null);

  // Étape 3 : primes et assuré
  const [primeNette, setPrimeNette] = useState('');
  const [accessoire, setAccessoire] = useState('');
  const [taxe, setTaxe] = useState('');
  // TTC arrondie à la pièce de 5 F comme à l'enregistrement (Règles de gestion > Arrondi des montants)
  const primeTtc = arrondirMontant((Number(primeNette) || 0) + (Number(accessoire) || 0) + (Number(taxe) || 0), idProduit);
  // Calcul à partir de la prime nette (bouton « Calculer » d'URANUS, automatique ici) : accessoire du
  // barème de la compagnie et taxe = taux du produit × (prime nette + accessoire). Un montant retouché à
  // la main n'est plus recalculé tant qu'on ne le remet pas au barème.
  const [tauxTaxe, setTauxTaxe] = useState(null);
  const [accessoireBareme, setAccessoireBareme] = useState(null);
  const [accessoireManuel, setAccessoireManuel] = useState(false);
  const [taxeManuelle, setTaxeManuelle] = useState(false);
  const [calculEnCours, setCalculEnCours] = useState(false);
  const taxeCalculee = tauxTaxe === null ? null : Math.round((((Number(primeNette) || 0) + (Number(accessoire) || 0)) * tauxTaxe) / 100);
  // Minimum légal contrôlé par la base (sp_calcul_devis_prime_imposee) : taxe des garanties sur la prime nette
  const taxeMinimum = tauxTaxe === null ? 0 : Math.round(((Number(primeNette) || 0) * tauxTaxe) / 100);
  // Pièce jointe du devis (envoyée après l'enregistrement)
  const [fichier, setFichier] = useState(null);
  // Souscripteur et assuré : recherche des clients sur le serveur (RechercheClient, comme la MRH), sans charger toute
  // la clientèle à l'ouverture de l'écran
  const [souscripteur, setSouscripteur] = useState(null);
  const [assureDifferent, setAssureDifferent] = useState(false);
  const [assureChoisi, setAssureChoisi] = useState(null);
  const [demandeRecherche, setDemandeRecherche] = useState(null);
  const souscripteurId = Number(souscripteur?.IdClient) || 0;
  const assureId = (assureDifferent ? Number(assureChoisi?.IdClient) : 0) || souscripteurId;
  const [telephoneAssure, setTelephoneAssure] = useState('');
  const [adresseGeo, setAdresseGeo] = useState('');
  // Le téléphone et l'adresse de l'assuré suivent la personne choisie (souscripteur tant que l'assuré est le même)
  const choisirSouscripteur = (p) => {
    setSouscripteur(p);
    if (p && !assureDifferent) { setTelephoneAssure(p.Telephone || ''); setAdresseGeo(p.AdresseGeographique || ''); }
  };
  const choisirAssure = (p) => {
    setAssureChoisi(p);
    if (p) { setTelephoneAssure(p.Telephone || ''); setAdresseGeo(p.AdresseGeographique || ''); }
  };

  const offreMinene = Number(idOffre) === ID_OFFRE_MINENE;
  // RC hors MINENE et MRP : aucun barème (décisions du 2026-10-28), primes, accessoire, taxe, capitaux et taux saisis
  // à la main, rien n'est proposé d'office ; le taux de taxe du produit ne sert qu'à contrôler le minimum légal.
  // L'écran ne sert que ces deux produits : seule l'offre RC chef de famille MINENE (barème OREOLE) reste calculée
  const saisieManuelle = !offreMinene;
  // Listes déroulantes de ces champs : valeurs habituelles des devis enregistrés du produit (rien n'est rempli d'office)
  const [usuelles, setUsuelles] = useState({});
  useEffect(() => {
    let actif = true;
    valeursUsuellesApi.get(idProduit).then((d) => { if (actif) setUsuelles(d); }).catch(() => {});
    return () => { actif = false; };
  }, [idProduit]);
  // Garanties ajoutables (MRP) : catalogue « risques divers » d'URANUS, taux de taxe du produit à la date d'effet
  useEffect(() => {
    if (!PRODUITS_AJOUT_GARANTIES.includes(idProduit)) return undefined;
    let actif = true;
    risquesDiversApi.garantiesAjoutables(idProduit, dateEffet)
      .then((liste) => { if (actif) setCatalogueGaranties(Array.isArray(liste) ? liste : []); })
      .catch(() => { if (actif) setCatalogueGaranties([]); });
    return () => { actif = false; };
  }, [idProduit, dateEffet]);
  const proposees = (cle, options) => (saisieManuelle ? propositionsUsuelles(usuelles[cle], options) : []);
  const proposeesGarantie = (id, cle, options) => (saisieManuelle ? propositionsUsuelles(usuelles.Garanties?.[String(id)]?.[cle], options) : []);
  // Devis repris d'URANUS sans ligne de détail en base
  const [avertissementReprise, setAvertissementReprise] = useState('');

  // -------------------------------------------------------------
  // RÉFÉRENTIELS
  // -------------------------------------------------------------
  useEffect(() => {
    let actif = true;
    (async () => {
      const [cies, trfs, doms] = await Promise.all([
        settingsApi.getCompanies().catch(() => []),
        risquesDiversApi.getTarifs(idProduit).catch(() => []),
        estRc ? risquesDiversApi.getDomaines().catch(() => []) : Promise.resolve([]),
      ]);
      if (!actif) return;
      if (cies && cies.length) setCompanies(cies.map((c) => ({ id: c.IdCompagnie || c.id, nom: c.RaisonSociale || c.nom })));
      // Une catégorie sans offre ne peut pas être tarifée : elle n'est pas proposée
      const offresParTarif = await Promise.all((trfs || []).map((t) => risquesDiversApi.getOffres(idProduit, t.IdTarif).catch(() => [])));
      if (!actif) return;
      const vides = new Set((trfs || []).filter((t, i) => !(offresParTarif[i] || []).length).map((t) => Number(t.IdTarif)));
      setTarifsSansOffre(vides);
      setTarifs(trfs || []);
      setDomaines(doms || []);
      const premier = (trfs || []).find((t) => !vides.has(Number(t.IdTarif)));
      if (!editIddevisParam && premier) setIdTarif((courant) => courant || Number(premier.IdTarif));
    })();
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idProduit]);

  // Offres de la catégorie
  useEffect(() => {
    let actif = true;
    if (!idTarif) return undefined;
    risquesDiversApi.getOffres(idProduit, idTarif).catch(() => []).then((reponse) => {
      if (!actif) return;
      const liste = [...(reponse || [])];
      if (offreDevis && Number(offreDevis.idTarif) === Number(idTarif)
        && !liste.some((o) => Number(o.IdOffre) === Number(offreDevis.IdOffre))) {
        liste.unshift({ IdOffre: offreDevis.IdOffre, LibelleOffre: offreDevis.LibelleOffre });
      }
      setOffres(liste);
      setIdOffre((courant) => (liste.some((o) => Number(o.IdOffre) === Number(courant))
        ? courant
        : Number(liste[0]?.IdOffre) || 0));
    });
    return () => { actif = false; };
  }, [idProduit, idTarif, offreDevis]);

  // Création depuis le contrat Santé MINENE (?minene=<police>&client=&nom=&effet=&expiration=) : tarif MINENE,
  // police connexe, souscripteur et période de la police Santé, sans ressaisie
  const policeMineneParam = estRc ? searchParams.get('minene') : null;
  useEffect(() => {
    if (!policeMineneParam || editIddevisParam) return;
    setIdTarif(ID_TARIF_MINENE);
    setNumeroPoliceConnexe(policeMineneParam);
    const client = Number(searchParams.get('client')) || 0;
    const nom = searchParams.get('nom') || '';
    if (client) setSouscripteur({ IdClient: client, Nom: nom || `Client n° ${client}` });
    if (searchParams.get('effet')) setDateEffet(searchParams.get('effet'));
  }, [policeMineneParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // N° de police Santé MINENE saisi (ou choisi) à la création : la RC reprend ce qu'elle a en commun avec la
  // police Santé (client souscripteur et assuré, date d'effet, échéance, durée, terme) ; un devis rouvert garde les siennes
  // (une fois par police : revenir à l'étape du champ ne défait pas ce que l'utilisateur a changé depuis)
  const policeRepriseRef = useRef('');
  const reprendrePoliceMinene = (p) => {
    if (editIddevisParam || !p || policeRepriseRef.current === p.NumeroPolice) return;
    policeRepriseRef.current = p.NumeroPolice;
    if (p.DateEffet) setDateEffet(p.DateEffet);
    if (p.DateEffet && p.DateExpiration) {
      const annuelle = expirationPour(p.DateEffet, 4, '') === p.DateExpiration;
      setDureeId(annuelle ? 4 : 5);
      setExpirationPersonnalisee(annuelle ? '' : p.DateExpiration);
    }
    if (p.IdTerme) setTermeId(p.IdTerme);
    if (p.IdClient) {
      setSouscripteur({ IdClient: p.IdClient, Nom: p.Client || `Client n° ${p.IdClient}` });
      setAssureDifferent(false);
      setAssureChoisi(null);
    }
    info(`Police Santé ${p.NumeroPolice} : client, date d'effet et échéance repris.`);
  };

  // Primes d'une RC MINENE avant l'enregistrement : par adhérent de la police Santé (prime, accessoire, frais de
  // gestion, taxe), lues à l'étape 3 (production/minene_connexes.py, mêmes fonctions que la base)
  const [apercuMinene, setApercuMinene] = useState(null);
  useEffect(() => {
    if (!offreMinene || step !== 3 || !numeroPoliceConnexe.trim()) { setApercuMinene(null); return undefined; }
    let actif = true;
    risquesDiversApi.apercuMinene(numeroPoliceConnexe.trim(), dateEffet)
      .then((d) => { if (actif) setApercuMinene(d); })
      .catch((err) => { if (actif) setApercuMinene({ erreur: messageErreurApi(err) }); });
    return () => { actif = false; };
  }, [offreMinene, step, numeroPoliceConnexe, dateEffet]);

  // MINENE : compagnie, durée et capitaux fixés comme dans URANUS (à la création)
  const estMinene = estRc && (Number(idTarif) === ID_TARIF_MINENE || offreMinene);
  useEffect(() => {
    if (!estMinene || editIddevisParam) return;
    setCompagnieId(MINENE.idCompagnie);
    // Créée depuis la police Santé : jusqu'à l'échéance de la police Santé
    const expirationSante = policeMineneParam ? searchParams.get('expiration') : null;
    if (expirationSante) {
      setDureeId(5);
      setExpirationPersonnalisee(expirationSante);
    } else {
      setDureeId(MINENE.dureeId);
    }
    const { rc } = reglagesMinene();
    setCapitalDommageCorporel((v) => Number(v) || rc.corporels);
    setCapitalIntoxication((v) => Number(v) || rc.intoxications);
    setCapitalDommageMateriel((v) => Number(v) || rc.materiels);
  }, [estMinene, editIddevisParam]);

  // Accessoire du barème et taux de taxe pour la prime nette saisie (hors MINENE, calculé par la base)
  useEffect(() => {
    if (offreMinene || !idOffre || !(Number(primeNette) > 0) || !dateEffet) return undefined;
    let actif = true;
    const minuteur = setTimeout(async () => {
      setCalculEnCours(true);
      try {
        const r = await risquesDiversApi.calculer({ idProduit, idCompagnie: compagnieId, idOffre, primeNette, dateEffet });
        if (!actif) return;
        setTauxTaxe(r.tauxTaxe);
        setAccessoireBareme(r.accessoire);
        if (!accessoireManuel && !saisieManuelle) setAccessoire(r.accessoire);
      } catch (err) {
        if (actif && !saisieManuelle) toastError(`Accessoire et taxe non calculés : ${messageErreurApi(err)}. Saisissez-les.`);
      } finally {
        if (actif) setCalculEnCours(false);
      }
    }, 350);
    return () => { actif = false; clearTimeout(minuteur); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idProduit, compagnieId, idOffre, primeNette, dateEffet, offreMinene, accessoireManuel]);

  // Taxe tenue à jour (taux × (prime nette + accessoire)), sauf montant retouché à la main ou saisie manuelle
  useEffect(() => {
    if (!saisieManuelle && !taxeManuelle && taxeCalculee !== null) setTaxe(taxeCalculee);
  }, [taxeCalculee, taxeManuelle, saisieManuelle]);

  // -------------------------------------------------------------
  // GARANTIES DE L'OFFRE (et, en modification, celles enregistrées sur le devis)
  // -------------------------------------------------------------
  const capitauxRc = () => (estRc ? {
    CapitalDommageCorporel: Number(capitalDommageCorporel) || 0,
    CapitalIntoxicationAlimentaire: Number(capitalIntoxication) || 0,
    CapitalDommageMateriel: Number(capitalDommageMateriel) || 0,
    AssiettePrime: Number(assiettePrime) || 0,
    TauxPrime: Number(tauxPrime) || 0,
  } : {});

  const chargerGaranties = async ({ depuisDevis = null } = {}) => {
    if (!idOffre) return;
    setChargementGaranties(true);
    try {
      const commun = {
        idCompagnie: compagnieId, idOffre, tauxReduction: reduction, dateEffet, dateExpiration, capitaux: capitauxRc(),
      };
      const [offre, devis] = await Promise.all([
        risquesDiversApi.getGaranties(idProduit, commun),
        depuisDevis ? risquesDiversApi.getGaranties(idProduit, { ...commun, idDevis: depuisDevis }) : Promise.resolve([]),
      ]);
      const lignesDevis = (devis || []).filter((r) => Number(r.IdGarantie) !== 0 && Number(r.IdSousGarantie) !== 0 && r.Acquise);
      const enregistrees = new Map(lignesDevis.map((r) => [Number(r.IdSousGarantie), garantieDepuisApi(r, true)]));
      const liste = (offre || [])
        .filter((r) => Number(r.IdGarantie) !== 0 && Number(r.IdSousGarantie) !== 0)
        // Création : toutes cochées (comme URANUS) ; modification : cochées = enregistrées sur le devis
        .map((r) => enregistrees.get(Number(r.IdSousGarantie)) || garantieDepuisApi(r, !depuisDevis, saisieManuelle));
      // Garanties du devis qui ne figurent pas dans l'offre (ajoutées à la saisie) : conservées
      lignesDevis.forEach((r) => {
        if (!liste.some((g) => g.id === Number(r.IdSousGarantie))) liste.push({ ...garantieDepuisApi(r, true), ajoutee: true });
      });
      // Garanties ajoutées à l'écran depuis : gardées par « Recharger », qui remet seulement l'offre à jour
      setGaranties((avant) => trierParLibelle(
        [...liste, ...avant.filter((g) => g.ajoutee && !liste.some((x) => x.id === g.id))], (g) => g.libelle,
      ));
      const cumul = (offre || []).find((r) => Number(r.IdGarantie) === 0);
      setPrimeTarif(cumul ? Math.round(Number(cumul.PrimeNette) || 0) : null);
      setOffreDesGaranties(Number(idOffre));
    } catch (err) {
      toastError(`Garanties de l'offre non chargées : ${messageErreurApi(err)}`);
    } finally {
      setChargementGaranties(false);
    }
  };

  // Passage à l'étape « Garanties » : charge celles de l'offre si l'offre a changé
  useEffect(() => {
    if (step === 2 && idOffre && offreDesGaranties !== Number(idOffre) && !isLoadingEdit) chargerGaranties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, idOffre, isLoadingEdit]);

  // -------------------------------------------------------------
  // « MODIFIER » : REPRISE DE TOUT CE QUI A ÉTÉ SAISI À LA CRÉATION
  // -------------------------------------------------------------
  useEffect(() => {
    if (!editIddevisParam) return undefined;
    let actif = true;
    (async () => {
      setIsLoadingEdit(true);
      try {
        // Devis repris d'URANUS sans ligne de détail : lireDevis répond 404, l'en-tête reste repris
        const [devis, ligneLue] = await Promise.all([
          quoteApi.getQuote(editIddevisParam),
          risquesDiversApi.lireDevis(editIddevisParam).catch((e) => {
            if (e?.response?.status === 404) return null;
            throw e;
          }),
        ]);
        if (!actif) return;
        const raw = devis?.raw || {};
        const ligne = ligneLue || {
          IdTarif: 0,
          IdOffre: Number(raw.offre?.IdOffre ?? raw.offre) || 0,
          TauxReduction: 0,
        };
        setAvertissementReprise(ligneLue ? '' : (
          `Aucune ligne de détail n'est enregistrée pour ce devis (catégorie, garanties${estRc ? ', risque assuré' : ''}) : `
          + 'seuls l\'en-tête et les primes ont été repris. Choisissez la catégorie et cochez les garanties avant d\'enregistrer.'
        ));
        if (raw.confirme) {
          toastError('Ce devis est confirmé (déjà en contrat) : il ne peut plus être modifié.');
          navigate('/user/quotes');
          return;
        }
        setIdDevisEdite(Number(editIddevisParam));
        setNumeroDevisEdite(raw.numerodevis || '');
        setIdAvenant(Number(raw.avenant?.IdAvenant ?? raw.avenant) || 1);
        const compagnie = Number(raw.compagnie?.IdCompagnie ?? raw.compagnie) || 1;
        setCompagnieId(compagnie);
        setOffreDevis({
          idTarif: Number(ligne.IdTarif) || 0,
          IdOffre: Number(ligne.IdOffre) || 0,
          LibelleOffre: raw.offre?.LibelleOffre || `Offre n° ${ligne.IdOffre}`,
        });
        setIdTarif(Number(ligne.IdTarif) || 0);
        setIdOffre(Number(ligne.IdOffre) || 0);
        // Durée libre et terme « Autre » vont ensemble (anciens devis « Divers » compris)
        const charge = termeEtDureeEnregistres(raw.idterme, raw.idduree);
        setDureeId(charge.dureeId);
        setTermeId(charge.termeId);
        setDateEffet(jour(raw.dateeffet) || aujourdhui());
        setExpirationPersonnalisee(jour(raw.dateexpiration));
        setReduction(Number(ligne.TauxReduction) || '');
        setNumeroPoliceCompagnie(raw.numero_police_compagnie || '');
        setNumeroPoliceConnexe(raw.numero_police_connexe || raw.numeropoliceconnexe || '');
        setActivite(ligne.Activite || '');
        setIdDomaineActivite(Number(ligne.IdDomaineActivite) || 0);
        setLocalisation(ligne.Localisation || '');
        setDateDebut(jour(ligne.DateDebut));
        setNombreParticipants(Number(ligne.NombreParticipants) || 0);
        setAssiettePrime(montantSaisi(Math.round(Number(ligne.AssiettePrime) || 0)));
        setTauxPrime(Number(ligne.TauxPrime) || '');
        setCapitalDommageCorporel(montantSaisi(Math.round(Number(ligne.CapitalDommageCorporel) || 0)));
        setCapitalIntoxication(montantSaisi(Math.round(Number(ligne.CapitalIntoxicationAlimentaire) || 0)));
        setCapitalDommageMateriel(montantSaisi(Math.round(Number(ligne.CapitalDommageMateriel) || 0)));
        // Primes : saisies à la création (ou calculées par la base pour MINENE), donc reprises
        // telles qu'enregistrées. Les devis repris d'URANUS n'ont pas le drapeau prime_imposee :
        // ne les reprendre que dans ce cas les affichait à 0.
        setPrimeNette(montantSaisi(Math.round(Number(raw.primenette) || 0)));
        setAccessoire(montantSaisi(Math.round(Number(raw.accessoire) || 0)));
        setTaxe(montantSaisi(Math.round(Number(raw.taxe) || 0)));
        // Montants enregistrés gardés tels quels ; une nouvelle prime nette recalcule la taxe
        setAccessoireManuel(true);
        setTaxeManuelle(true);

        // Souscripteur et assuré
        const idClient = Number(raw.client?.IdClient ?? raw.client) || 0;
        const idAssure = Number(raw.assure?.IdClient ?? raw.assure) || idClient;
        const [souscripteur, assure] = await Promise.all([
          idClient ? customerApi.getClientDetail(idClient).catch(() => null) : null,
          idAssure ? customerApi.getClientDetail(idAssure).catch(() => null) : null,
        ]);
        if (!actif) return;
        const versPersonne = (c, id) => (id ? {
          ...(c ? personneDepuisClient(c.raw || c) : {}),
          IdClient: id,
          Nom: (c?.nomcomplet || personneDepuisClient(c?.raw || c)?.Nom || '').trim() || `Client n° ${id}`,
        } : null);
        setSouscripteur(versPersonne(souscripteur, idClient));
        setAssureDifferent(Boolean(idAssure && idAssure !== idClient));
        setAssureChoisi(idAssure && idAssure !== idClient ? versPersonne(assure, idAssure) : null);
        setTelephoneAssure(assure?.raw?.Mobile || assure?.raw?.Telephone || '');
        setAdresseGeo(assure?.raw?.Adresse2 || '');

        // Garanties enregistrées sur le devis (cochées, capitaux, franchises)
        const commun = {
          idCompagnie: compagnie,
          idOffre: Number(ligne.IdOffre),
          tauxReduction: Number(ligne.TauxReduction) || 0,
          dateEffet: jour(raw.dateeffet),
          dateExpiration: jour(raw.dateexpiration),
        };
        const [offre, lignesDevis] = await Promise.all([
          risquesDiversApi.getGaranties(idProduit, commun).catch(() => []),
          risquesDiversApi.getGaranties(idProduit, { ...commun, idDevis: Number(editIddevisParam) }).catch(() => []),
        ]);
        if (!actif) return;
        const enregistrees = (lignesDevis || []).filter((r) => Number(r.IdGarantie) !== 0 && Number(r.IdSousGarantie) !== 0 && r.Acquise);
        const parId = new Map(enregistrees.map((r) => [Number(r.IdSousGarantie), garantieDepuisApi(r, true)]));
        const manuelle = Number(ligne.IdOffre) !== ID_OFFRE_MINENE;
        const liste = (offre || [])
          .filter((r) => Number(r.IdGarantie) !== 0 && Number(r.IdSousGarantie) !== 0)
          .map((r) => parId.get(Number(r.IdSousGarantie)) || garantieDepuisApi(r, false, manuelle));
        enregistrees.forEach((r) => {
          if (!liste.some((g) => g.id === Number(r.IdSousGarantie))) liste.push({ ...garantieDepuisApi(r, true), ajoutee: true });
        });
        setGaranties(trierParLibelle(liste, (g) => g.libelle));
        setOffreDesGaranties(Number(ligne.IdOffre));
      } catch (err) {
        if (actif) toastError(`Impossible de charger le devis à modifier : ${messageErreurApi(err)}`);
      } finally {
        if (actif) setIsLoadingEdit(false);
      }
    })();
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editIddevisParam, idProduit]);

  // Nouveau domaine d'activité (« + » d'URANUS) : libellé en majuscules comme les domaines livrés ;
  // un domaine déjà présent est simplement sélectionné
  const ajouterDomaine = async () => {
    const libelle = String(nouveauDomaine || '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!libelle) { toastError('Saisissez le libellé du domaine d\'activité.'); return; }
    const existant = domaines.find((d) => String(d.libelle || '').trim().toUpperCase() === libelle);
    if (existant) {
      setIdDomaineActivite(Number(existant.id_domaine_activite));
      setNouveauDomaine(null);
      return;
    }
    try {
      const cree = await risquesDiversApi.creerDomaine(libelle);
      const liste = await risquesDiversApi.getDomaines().catch(() => [...domaines, cree]);
      setDomaines(liste);
      setIdDomaineActivite(Number(cree.id_domaine_activite));
      setNouveauDomaine(null);
      success(`Domaine d'activité « ${libelle} » ajouté.`);
    } catch (err) {
      toastError(`Domaine d'activité non ajouté : ${messageErreurApi(err)}`);
    }
  };

  const majGarantie = (id, champ, valeur) => setGaranties((prev) => prev.map((g) => (g.id === id ? { ...g, [champ]: valeur } : g)));

  // Questionnaire prospect (?questionnaire=) : capitaux déclarés par le client, reportés sur les garanties de l'offre
  // (Incendie = bâtiments + contenu + stocks, vol, bris de glaces, bris de machine, perte d'exploitation…)
  const qd = useQuestionnaireDevis();
  const capitauxQuestionnaire = qd.devis?.genre === 'mrp' ? qd.devis.capitaux || {} : {};
  const nbCapitaux = Object.keys(capitauxQuestionnaire).length;
  const [capitauxEnAttente, setCapitauxEnAttente] = useState(false);
  const appliquerCapitaux = () => {
    if (!garanties.length) {
      setCapitauxEnAttente(true);
      info("Choisissez la catégorie et l'offre : les capitaux du questionnaire seront reportés à l'étape Garanties.");
      setStep(idOffre ? 2 : 1);
      return;
    }
    const ids = new Set(garanties.map((g) => String(g.id)));
    const absentes = Object.keys(capitauxQuestionnaire).filter((id) => !ids.has(id));
    setGaranties((prev) => prev.map((g) => (capitauxQuestionnaire[String(g.id)]
      ? { ...g, capital: Math.round(Number(capitauxQuestionnaire[String(g.id)])), acquise: true } : g)));
    setCapitauxEnAttente(false);
    success(`${nbCapitaux - absentes.length} capital(aux) du questionnaire reporté(s) sur les garanties.`);
    if (absentes.length) info(`${absentes.length} garantie(s) du questionnaire absente(s) de cette offre.`);
  };
  useEffect(() => {
    if (capitauxEnAttente && garanties.length) appliquerCapitaux();
  }, [garanties.length, capitauxEnAttente]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (createdQuote && qd.actif) qd.devisEtabli(createdQuote.numerodevis || '');
  }, [createdQuote]); // eslint-disable-line react-hooks/exhaustive-deps
  const garantiesAcquises = garanties.filter((g) => g.acquise);
  // Passage à une étape (en-tête d'étapes ou bouton « Suivant ») : les étapes précédentes doivent être complètes
  // (mêmes messages qu'à l'enregistrement)
  const allerA = (cible) => {
    if (cible > step) {
      if (cible >= 2 && !idOffre) { toastError('Choisissez une offre.'); setStep(1); return; }
      if (cible >= 2 && !dateExpiration) { toastError("Saisissez la date d'expiration."); setStep(1); return; }
      if (cible >= 2 && offreMinene && !numeroPoliceConnexe.trim()) { toastError('Offre MINENE : saisissez le n° de police Santé connexe.'); setStep(1); return; }
      if (cible >= 3 && !offreMinene && !garantiesAcquises.length) { toastError('Cochez au moins une garantie.'); setStep(2); return; }
    }
    setStep(cible);
  };
  // Propositions de prime nette (la saisie reste libre) : tarif de la base pour ces capitaux, ou assiette x taux de prime
  const primeAssietteTaux = Math.round(((Number(assiettePrime) || 0) * (Number(tauxPrime) || 0)) / 100 * (1 - (Number(reduction) || 0) / 100));

  // -------------------------------------------------------------
  // ENREGISTREMENT (création, ou modification du même devis)
  // -------------------------------------------------------------
  const handleSave = async () => {
    if (!idOffre) { toastError('Choisissez une offre.'); setStep(1); return; }
    if (!dateExpiration) { toastError('Saisissez la date d\'expiration.'); setStep(1); return; }
    if (offreMinene && !numeroPoliceConnexe.trim()) { toastError('Offre MINENE : saisissez le n° de police Santé connexe.'); setStep(1); return; }
    if (!offreMinene && !garantiesAcquises.length) { toastError('Cochez au moins une garantie.'); setStep(2); return; }
    if (!offreMinene && !(Number(primeNette) > 0)) {
      toastError('Saisissez la prime nette : elle est répartie sur les garanties cochées.');
      setStep(3);
      return;
    }
    if (saisieManuelle && !(Number(taxe) > 0)) {
      toastError('Saisissez la taxe.');
      setStep(3);
      return;
    }
    // Même contrôle que la base : la taxe couvre au moins celle des garanties (taux × prime nette)
    if (!offreMinene && tauxTaxe !== null && Number(taxe) < taxeMinimum) {
      toastError(`Taxe insuffisante : au moins ${fcfa(taxeMinimum)} FCFA (${tauxTaxe} % de la prime nette).`);
      setStep(3);
      return;
    }
    if (!souscripteurId) { toastError('Choisissez le souscripteur dans la liste des clients.'); setStep(3); return; }
    if (assureDifferent && !assureChoisi) { toastError("Choisissez l'assuré, ou décochez « L'assuré est une autre personne »."); setStep(3); return; }

    const payload = {
      IdIntermediaire: 1,
      IdCompagnie: Number(compagnieId),
      NumeroPoliceCompagnie: numeroPoliceCompagnie || '',
      IdProduit: idProduit,
      IdOffre: Number(idOffre),
      IdAvenant: idAvenant || 1,
      IdClient: Number(souscripteurId),
      IdAssure: Number(assureId || souscripteurId),
      Flotte: false,
      Coassurance: false,
      DateEffet: dateEffet,
      DateExpiration: dateExpiration,
      DateEmission: dateEmission,
      IdTarif: Number(idTarif),
      TauxReduction: Number(reduction) || 0,
      TelephoneAssure: telephoneAssure || '',
      AdresseGeographique: adresseGeo || '',
      NumeroPoliceConnexe: numeroPoliceConnexe || '',
      PrimeNette: Number(primeNette) || 0,
      Accessoire: Number(accessoire) || 0,
      Taxe: Number(taxe) || 0,
      PrimeTTC: primeTtc,
      IdDevis: idDevisEdite || 0,
      IdDuree: Number(dureeId),
      IdTerme: Number(termeId),
      ListeGarantie: garantiesAcquises.map((g) => ({
        id_garantie: g.id,
        acquise: true,
        capital: Number(g.capital) || 0,
        montant_franchise: Number(g.montantFranchise) || 0,
        taux_franchise: Number(g.tauxFranchise) || 0,
        franchise_minimum: Number(g.franchiseMinimum) || 0,
        franchise_maximum: Number(g.franchiseMaximum) || 0,
      })),
      ...(estRc ? {
        Activite: activite || '',
        IdDomaineActivite: Number(idDomaineActivite) || 0,
        Localisation: localisation || '',
        ...(dateDebut ? { DateDebut: dateDebut } : {}),
        NombreParticipants: Number(nombreParticipants) || 0,
        TauxPrime: Number(tauxPrime) || 0,
        // Assiette nulle : non envoyée (le serveur remettait alors la durée à 0)
        ...(Number(assiettePrime) > 0 ? { AssiettePrime: Number(assiettePrime) } : {}),
        CapitalDommageCorporel: Number(capitalDommageCorporel) || 0,
        CapitalIntoxicationAlimentaire: Number(capitalIntoxication) || 0,
        CapitalDommageMateriel: Number(capitalDommageMateriel) || 0,
      } : {}),
    };

    setIsSubmitting(true);
    try {
      let res;
      try {
        res = await risquesDiversApi.enregistrer(idProduit, payload);
      } catch (errApi) {
        toastError(`Devis ${infos.court} non enregistré : ${messageErreurApi(errApi)}`);
        return;
      }
      const devisId = Number(res?.ObjectId) || 0;
      if (!devisId) {
        toastError(`Devis ${infos.court} non enregistré : ${res?.OutputMessage || 'réponse du serveur sans numéro de devis.'}`);
        return;
      }
      if (fichier) {
        try {
          await risquesDiversApi.attacherPieceJointe(devisId, fichier);
          setFichier(null);
        } catch (errFichier) {
          toastError(`Devis enregistré, mais le fichier n'a pas été joint : ${messageErreurApi(errFichier)}`);
        }
      }
      let devisEnregistre = null;
      try {
        devisEnregistre = await quoteApi.getQuote(devisId);
      } catch {
        // l'aperçu utilisera la copie locale ci-dessous
      }
      const saved = dataStore.saveQuote({
        id: devisId,
        iddevis: devisId,
        numerodevis: devisEnregistre?.numerodevis,
        client_nom: souscripteur?.Nom || '',
        client_id: Number(souscripteurId),
        produit: infos.libelle,
        branche: infos.court,
        compagnie: companies.find((c) => String(c.id) === String(compagnieId))?.nom || '',
        prime_nette: devisEnregistre?.prime_nette,
        taxes: devisEnregistre?.taxes,
        accessoires: devisEnregistre?.accessoires,
        prime_totale: devisEnregistre?.prime_totale,
        date_emission: dateEmission,
        date_effet: dateEffet,
        date_expiration: dateExpiration,
      });
      success(idDevisEdite
        ? `Devis ${infos.libelle} N° ${devisEnregistre?.numerodevis || devisId} modifié.`
        : `Devis ${infos.libelle} N° ${devisEnregistre?.numerodevis || devisId} enregistré.`);
      setCreatedQuote(devisEnregistre || saved);
    } catch (err) {
      toastError(`Erreur lors de l'enregistrement du devis ${infos.court} : ${messageErreurApi(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConvertToContract = async (quoteToConvert) => {
    try {
      await contractApi.createContractFromQuote(quoteToConvert.id);
    } catch (e) {
      console.warn('Fallback contract creation');
    }
    const newContract = dataStore.convertQuoteToContract(quoteToConvert);
    success(`Devis ${quoteToConvert.numerodevis} transformé en police d'assurance avec succès !`);
    setCreatedQuote(null);
    navigate(`/user/contracts/${newContract.id || newContract.numeropolice}`);
  };

  if (!infos) return <p style={{ padding: '2rem' }}>Produit inconnu.</p>;

  // -------------------------------------------------------------
  // AFFICHAGE : présentation de l'écran MRH (étapes numérotées, cartes, résumé permanent « Votre devis »), dans la
  // couleur de la branche (demande du 2026-10-27 : amélioration UI/UX des parcours MRH et RC)
  // -------------------------------------------------------------
  const couleur = infos.couleur;
  const carte = { padding: '1.5rem', borderRadius: '14px' };
  const titreCarte = { display: 'flex', alignItems: 'center', gap: '0.55rem', margin: '0 0 1.2rem', fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' };
  const grille = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: '1rem 1.25rem', alignItems: 'start' };
  const sousTitre = { fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '1.5rem 0 0.75rem' };
  const texteAide = { fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 1rem' };
  const lienAction = { background: 'transparent', border: 'none', color: couleur, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: 0 };
  const alerte = (teinte) => ({
    display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.8rem 1rem', borderRadius: '10px',
    border: `1px solid ${teinte}`, background: 'var(--bg-surface-elevated)', fontSize: '0.85rem', color: 'var(--text-primary)',
  });
  const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
  const nomCompagnie = companies.find((c) => String(c.id) === String(compagnieId))?.nom || '';
  const libelleOffre = offres.find((o) => Number(o.IdOffre) === Number(idOffre))?.LibelleOffre || '';
  const totauxMinene = offreMinene ? apercuMinene?.Totaux : null;
  const tuile = (libelle, valeur, fort) => (
    <div key={libelle} style={{ padding: '0.85rem 0.95rem', borderRadius: '12px', border: `1px solid ${fort ? couleur : 'var(--border-subtle)'}`, background: fort ? `color-mix(in srgb, ${couleur} 10%, transparent)` : 'var(--bg-surface-elevated)' }}>
      <div style={{ fontSize: '0.7rem', color: fort ? couleur : 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>{libelle}</div>
      <div style={{ fontSize: fort ? '1.2rem' : '1.02rem', fontWeight: 900, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginTop: '0.2rem' }}>{fcfa(valeur)} F</div>
    </div>
  );
  const pied = (gauche, droite) => (
    <div style={{ marginTop: '1.75rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
      {gauche}{droite}
    </div>
  );
  const boutonSuivant = (cible, libelle) => (
    <button type="button" className="btn btn-primary" onClick={() => allerA(cible)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: couleur, borderColor: couleur }}>
      {libelle} <ChevronRight size={16} />
    </button>
  );
  const boutonPrecedent = (cible) => (
    <button type="button" className="btn btn-secondary" onClick={() => setStep(cible)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <ChevronLeft size={16} /> Précédent
    </button>
  );
  const cocherToutes = (acquise) => setGaranties((prev) => prev.map((g) => ({ ...g, acquise })));

  // Ajout et retrait de garanties (MRP), même principe que l'Automobile : une garantie retirée n'est plus enregistrée
  // sur le devis ; une garantie ajoutée, cochée d'office, reçoit sa part de la prime nette répartie par la base
  const ajoutPossible = PRODUITS_AJOUT_GARANTIES.includes(idProduit) && !offreMinene;
  const garantiesProposees = trierParLibelle(
    catalogueGaranties.filter((c) => !garanties.some((g) => g.id === Number(c.IdSousGarantie))),
    (c) => c.LibelleSousGarantie,
  );
  const ouvrirAjoutGarantie = () => setAjoutGarantie({ id: '', capital: '', franchiseMinimum: '', franchiseMaximum: '', tauxFranchise: '' });
  const ajouterGarantie = () => {
    const choisie = catalogueGaranties.find((c) => String(c.IdSousGarantie) === String(ajoutGarantie?.id));
    if (!choisie) { toastError('Choisissez la garantie à ajouter.'); return; }
    if (garanties.some((g) => g.id === Number(choisie.IdSousGarantie))) { toastError('Cette garantie est déjà dans la liste.'); return; }
    setGaranties((prev) => trierParLibelle([...prev, {
      id: Number(choisie.IdSousGarantie),
      libelle: choisie.LibelleSousGarantie,
      acquise: true,
      capital: montantSaisi(ajoutGarantie.capital),
      franchiseMinimum: montantSaisi(ajoutGarantie.franchiseMinimum),
      franchiseMaximum: montantSaisi(ajoutGarantie.franchiseMaximum),
      tauxFranchise: ajoutGarantie.tauxFranchise === '' ? '' : tauxSaisi(ajoutGarantie.tauxFranchise),
      montantFranchise: '',
      primeNette: 0,
      ajoutee: true,
    }], (g) => g.libelle));
    setAjoutGarantie(null);
    success(`Garantie « ${choisie.LibelleSousGarantie} » ajoutée au devis.`);
  };
  const retirerGarantie = async (g) => {
    if (!(await confirmer({
      ton: 'attention',
      titre: `Retirer la garantie « ${g.libelle} » ?`,
      message: g.ajoutee
        ? "La garantie sera retirée du devis à l'enregistrement."
        : "La garantie sera retirée du devis à l'enregistrement ; « Recharger » la remet avec les autres garanties de l'offre.",
      confirmer: 'Retirer la garantie',
    }))) return;
    setGaranties((prev) => prev.filter((x) => x.id !== g.id));
    info(`Garantie « ${g.libelle} » retirée.`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1280px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* EN-TÊTE */}
      <div>
        <button type="button" className="btn btn-link" onClick={() => navigate('/user/quotes')} style={{ padding: 0, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
          <ChevronLeft size={16} /> Registre des devis
        </button>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: 0 }}>
          <Shield size={26} color={couleur} />
          {editIddevisParam ? `Modification du devis ${infos.libelle}` : `Nouveau devis ${infos.libelle}`}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.3rem 0 0' }}>
          {numeroDevisEdite
            ? <>Devis <strong>N° {numeroDevisEdite}</strong>.</>
            : estRc
              ? "Contrat et risque, garanties de l'offre, puis prime et souscripteur. La prime nette, l'accessoire et la taxe sont saisis à la main."
              : "Contrat, garanties de l'offre, puis prime et souscripteur. La prime nette, l'accessoire et la taxe sont saisis à la main."}
          {isLoadingEdit && <span style={{ color: couleur, fontWeight: 600 }}> Chargement du devis à modifier…</span>}
        </p>
      </div>

      {/* ÉTAPES */}
      <EtapesDevis etapes={ETAPES_RISQUES_DIVERS} etape={step} onAller={allerA} couleur={couleur} />

      {avertissementReprise && (
        <div style={alerte('var(--accent-amber)')}>
          <AlertTriangle size={18} style={{ color: 'var(--accent-amber)', flexShrink: 0, marginTop: 1 }} />
          <div>{avertissementReprise}</div>
        </div>
      )}

      <BandeauQuestionnaire
        qd={qd}
        onChercherClient={(nom) => { setDemandeRecherche({ texte: nom, n: Date.now() }); setStep(3); }}
        onCreerClient={() => setNouveauClientPour('souscripteur')}
        actions={nbCapitaux ? [{
          libelle: `Reporter ${nbCapitaux} ${nbCapitaux > 1 ? 'capitaux' : 'capital'} sur les garanties`,
          icone: Shield,
          principal: true,
          titre: (qd.devis.detail_capitaux || []).join('\n'),
          onClick: appliquerCapitaux,
        }] : []}
      >
        {qd.devis?.genre === 'mrp' && (qd.devis.activite || qd.devis.situation) && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {qd.devis.activite && <>Activité : <strong>{qd.devis.activite}</strong></>}
            {qd.devis.activite && qd.devis.situation && ' · '}
            {qd.devis.situation && <>Situation du risque : <strong>{qd.devis.situation}</strong></>}
            {qd.devis.qualite && <> · Proposant : <strong>{qd.devis.qualite}</strong></>}
          </div>
        )}
      </BandeauQuestionnaire>

      <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="glass-panel" style={{ ...carte, flex: '1 1 640px', minWidth: 0 }}>
          {/* ---------------------------------------------------------- ÉTAPE 1 : CONTRAT ET RISQUE */}
          {step === 1 && (
            <>
              <h2 style={titreCarte}><FileText size={18} style={{ color: couleur }} /> Contrat</h2>
              <div style={grille}>
                <Champ label="Compagnie d'assurance" requis aide={estMinene ? 'MINENE : NSIA ASSURANCES' : undefined}>
                  <select className="form-control" value={compagnieId} onChange={(e) => setCompagnieId(Number(e.target.value))}>
                    {sortUniqueBy(companies, (c) => c.nom).map((c) => (<option key={c.id} value={c.id}>{c.nom}</option>))}
                  </select>
                </Champ>
                <Champ label="Catégorie" requis>
                  <select className="form-control" value={idTarif} onChange={(e) => setIdTarif(Number(e.target.value))}>
                    {trierParLibelle(tarifs.filter((t) => !tarifsSansOffre.has(Number(t.IdTarif)) || Number(t.IdTarif) === Number(idTarif)), (t) => t.LibelleTarif)
                      .map((t) => (<option key={t.IdTarif} value={t.IdTarif}>{t.LibelleTarif}</option>))}
                  </select>
                </Champ>
                <Champ label="Offre" requis erreur={!offres.length && idTarif ? 'Aucune offre pour cette catégorie' : undefined}>
                  <select className="form-control" value={idOffre} onChange={(e) => setIdOffre(Number(e.target.value))}>
                    {offres.length === 0 && <option value={0}>-</option>}
                    {trierParLibelle(offres, (o) => o.LibelleOffre).map((o) => (<option key={o.IdOffre} value={o.IdOffre}>{o.LibelleOffre}</option>))}
                  </select>
                </Champ>
                <Champ label="N° de police compagnie" aide="Facultatif">
                  <input type="text" className="form-control" value={numeroPoliceCompagnie} onChange={(e) => setNumeroPoliceCompagnie(e.target.value)} />
                </Champ>
                <Champ label="Réduction commerciale (%)" aide={estRc ? `${reductionMaxRc()} % au plus` : 'De 0 à 100 %'}>
                  <ChampPropose onChoisir={setReduction} propositions={saisieManuelle ? sansDoublon(proposees('TauxReduction', { taux: true }),
                    [5, 10, 15, 20, 25, 30, 35].filter((t) => t <= reductionMaxRc()).map((t) => propositionTaux(t))) : []}>
                    <input type="number" min="0" max={estRc ? reductionMaxRc() : 100} className="form-control" value={reduction}
                      onChange={(e) => setReduction(tauxSaisi(e.target.value, estRc ? reductionMaxRc() : 100))} />
                  </ChampPropose>
                </Champ>
                {offreMinene && (
                  <PoliceMineneConnexe
                    value={numeroPoliceConnexe}
                    onChange={setNumeroPoliceConnexe}
                    onPolice={reprendrePoliceMinene}
                    produit="RC"
                  />
                )}
              </div>

              <div style={sousTitre}>Période</div>
              <div style={grille}>
                <Champ label="Terme du contrat">
                  <TermeContratSelect
                    value={termeId}
                    onChange={(id) => {
                      setTermeId(id);
                      // « Autre » ouvre la durée libre (date d'expiration saisie)
                      setDureeId((d) => dureeSelonTerme(id, d));
                    }}
                  />
                </Champ>
                <Champ label="Durée du contrat">
                  <DureeContratSelect value={dureeId} onChange={setDureeId} />
                </Champ>
                <Champ label="Date d'émission" aide="Date du jour">
                  <input type="date" className="form-control" value={dateEmission} readOnly disabled />
                </Champ>
                <Champ label="Date d'effet" requis>
                  <input type="date" className="form-control" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} />
                </Champ>
                <Champ label="Date d'expiration" requis={Number(dureeId) === 5} aide={Number(dureeId) === 5 ? 'Durée libre : à saisir' : 'Calculée selon la durée'}>
                  {Number(dureeId) === 5
                    ? <input type="date" className="form-control" min={dateEffet} value={expirationPersonnalisee} onChange={(e) => setExpirationPersonnalisee(e.target.value)} />
                    : <input type="date" className="form-control" value={dateExpiration} readOnly disabled />}
                </Champ>
              </div>

              {estRc && (
                <>
                  <div style={sousTitre}>Risque assuré</div>
                  <div style={grille}>
                    <Champ label="Activité">
                      <input type="text" className="form-control" value={activite} onChange={(e) => setActivite(e.target.value)} />
                    </Champ>
                    <Champ label="Domaine d'activité"
                      aide={nouveauDomaine === null && (
                        <button type="button" onClick={() => setNouveauDomaine('')} style={lienAction} title="Ajouter un domaine d'activité à la liste">
                          <Plus size={13} /> Nouveau domaine
                        </button>
                      )}>
                      {nouveauDomaine === null ? (
                        <select className="form-control" value={idDomaineActivite} onChange={(e) => setIdDomaineActivite(Number(e.target.value))}>
                          <option value={0}>Non précisé</option>
                          {trierParLibelle(domaines, (d) => d.libelle).map((d) => (<option key={d.id_domaine_activite} value={d.id_domaine_activite}>{d.libelle}</option>))}
                        </select>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <input type="text" className="form-control" autoFocus placeholder="Ex. : INDUSTRIE ET COMMERCE" value={nouveauDomaine}
                            onChange={(e) => setNouveauDomaine(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouterDomaine(); } if (e.key === 'Escape') setNouveauDomaine(null); }} />
                          <button type="button" className="btn btn-primary" style={{ background: couleur, borderColor: couleur, padding: '0.4rem 0.7rem' }} onClick={ajouterDomaine}>Ajouter</button>
                          <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.7rem' }} onClick={() => setNouveauDomaine(null)} title="Annuler">
                            <X size={15} />
                          </button>
                        </div>
                      )}
                    </Champ>
                    <Champ label="Localisation">
                      <input type="text" className="form-control" value={localisation} onChange={(e) => setLocalisation(e.target.value)} />
                    </Champ>
                    <Champ label="Date de début" aide="Manifestation : premier jour">
                      <input type="date" className="form-control" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
                    </Champ>
                    <Champ label="Nombre de participants">
                      <input type="number" min="0" className="form-control" value={nombreParticipants} onChange={(e) => setNombreParticipants(Math.max(0, Number(e.target.value) || 0))} />
                    </Champ>
                  </div>

                  <div style={sousTitre}>Base de tarification et capitaux</div>
                  <div style={grille}>
                    <Champ label="Assiette de prime" aide="Chiffre d'affaires, masse salariale…">
                      <AmountInput value={assiettePrime} onChange={(v) => setAssiettePrime(montantSaisi(v))} />
                    </Champ>
                    <Champ label="Taux de prime (%)" aide={primeAssietteTaux > 0 ? `Soit ${fcfa(primeAssietteTaux)} F de prime nette` : undefined}>
                      <ChampPropose onChoisir={setTauxPrime} propositions={proposees('TauxPrime', { taux: true })}>
                        <input type="number" min="0" step="0.01" className="form-control" value={tauxPrime} onChange={(e) => setTauxPrime(tauxSaisi(e.target.value))} />
                      </ChampPropose>
                    </Champ>
                    <Champ label="Capital dommages corporels" aide={estMinene ? 'Barème MINENE' : undefined}>
                      <ChampPropose onChoisir={setCapitalDommageCorporel} propositions={proposees('CapitalDommageCorporel')} inactif={estMinene}>
                        <AmountInput value={capitalDommageCorporel} onChange={(v) => setCapitalDommageCorporel(montantSaisi(v))} disabled={estMinene} />
                      </ChampPropose>
                    </Champ>
                    <Champ label="Capital intoxication alimentaire" aide={estMinene ? 'Barème MINENE' : undefined}>
                      <ChampPropose onChoisir={setCapitalIntoxication} propositions={proposees('CapitalIntoxicationAlimentaire')} inactif={estMinene}>
                        <AmountInput value={capitalIntoxication} onChange={(v) => setCapitalIntoxication(montantSaisi(v))} disabled={estMinene} />
                      </ChampPropose>
                    </Champ>
                    <Champ label="Capital dommages matériels" aide={estMinene ? 'Barème MINENE' : undefined}>
                      <ChampPropose onChoisir={setCapitalDommageMateriel} propositions={proposees('CapitalDommageMateriel')} inactif={estMinene}>
                        <AmountInput value={capitalDommageMateriel} onChange={(v) => setCapitalDommageMateriel(montantSaisi(v))} disabled={estMinene} />
                      </ChampPropose>
                    </Champ>
                  </div>
                </>
              )}

              {pied(
                <button type="button" className="btn btn-secondary" onClick={() => navigate('/user/quotes')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <ChevronLeft size={16} /> Annuler
                </button>,
                boutonSuivant(2, 'Suivant : garanties'),
              )}
            </>
          )}

          {/* ---------------------------------------------------------- ÉTAPE 2 : GARANTIES */}
          {step === 2 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.9rem' }}>
                <h2 style={{ ...titreCarte, margin: 0 }}>
                  <ListChecks size={18} style={{ color: couleur }} /> Garanties de l'offre
                  {garanties.length > 0 && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: '999px', border: `1px solid ${couleur}`, color: couleur }}>
                      {garantiesAcquises.length} / {garanties.length} cochée{garantiesAcquises.length > 1 ? 's' : ''}
                    </span>
                  )}
                </h2>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {ajoutPossible && (
                    <button type="button" className="btn btn-primary" onClick={ouvrirAjoutGarantie} disabled={!garantiesProposees.length}
                      title={garantiesProposees.length ? "Ajouter une garantie hors de l'offre" : 'Toutes les garanties de la branche sont déjà dans la liste'}
                      style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem', background: couleur, borderColor: couleur }}>
                      <Plus size={13} /> Ajouter une garantie
                    </button>
                  )}
                  {garanties.length > 0 && !offreMinene && (
                    <>
                      <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem' }} onClick={() => cocherToutes(true)}>Tout cocher</button>
                      <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem' }} onClick={() => cocherToutes(false)}>Tout décocher</button>
                    </>
                  )}
                  <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    onClick={() => chargerGaranties({ depuisDevis: idDevisEdite })} disabled={chargementGaranties}>
                    <RefreshCw size={13} className={chargementGaranties ? 'spin' : undefined} /> {idDevisEdite ? 'Valeurs du devis' : 'Recharger'}
                  </button>
                </div>
              </div>
              {offreMinene ? (
                <div style={{ ...alerte('var(--accent-amber)'), marginBottom: '1rem' }}>
                  <AlertTriangle size={18} style={{ color: 'var(--accent-amber)', flexShrink: 0, marginTop: 1 }} />
                  <div>Offre MINENE : garanties et primes sont fixées par la base à l'enregistrement.</div>
                </div>
              ) : (
                <p style={texteAide}>
                  Cochez les garanties couvertes : la prime nette saisie à l'étape suivante est répartie sur elles. Capitaux et franchises restent modifiables.
                  {ajoutPossible && " Ajoutez une garantie de la branche absente de l'offre, ou retirez-en une avec la corbeille."}
                </p>
              )}
              {/* Garanties en grille (index.css, .garanties-saisie) : une ligne par garantie quand le pavé est large ; sinon le
                  nom puis ses quatre champs sur toute la largeur, chacun avec son libellé, pour que les montants restent lisibles */}
              <div className={`garanties-saisie${ajoutPossible ? '' : ' sans-retrait'}`} role="table" aria-label="Garanties de l'offre"
                style={{ '--couleur-branche': couleur }}>
                <div className="garantie-ligne garantie-entete" role="row">
                  <span role="columnheader" className="garantie-case">Acquise</span>
                  <span role="columnheader" className="garantie-nom">Garantie</span>
                  {CHAMPS_GARANTIE.map(([champ, , libelle]) => (
                    <span key={champ} role="columnheader" className={`garantie-champ garantie-${champ}`}>{libelle}</span>
                  ))}
                  {ajoutPossible && <span role="columnheader" className="garantie-retrait" aria-label="Retirer" />}
                </div>
                {garanties.length === 0 && (
                  <div className="garanties-vide">{chargementGaranties ? 'Chargement des garanties…' : 'Aucune garantie pour cette offre.'}</div>
                )}
                {garanties.map((g) => (
                  <div key={g.id} role="row" className={`garantie-ligne${g.acquise ? '' : ' non-acquise'}`}>
                    <div role="cell" className="garantie-case">
                      <input type="checkbox" checked={g.acquise} onChange={() => majGarantie(g.id, 'acquise', !g.acquise)} aria-label={`Garantie ${g.libelle}`} />
                    </div>
                    <div role="cell" className="garantie-nom" onClick={() => majGarantie(g.id, 'acquise', !g.acquise)}>
                      {g.libelle}
                      {g.ajoutee && <span className="garantie-ajoutee" title="Garantie ajoutée hors de l'offre">ajoutée</span>}
                    </div>
                    {CHAMPS_GARANTIE.map(([champ, cle, libelle]) => (
                      <div key={champ} role="cell" className={`garantie-champ garantie-${champ}`}>
                        <label className="garantie-champ-libelle" htmlFor={`garantie-${g.id}-${champ}`}>{libelle}</label>
                        {champ === 'tauxFranchise' ? (
                          <ChampPropose onChoisir={(v) => majGarantie(g.id, champ, v)} propositions={proposeesGarantie(g.id, cle, { taux: true })}>
                            <input id={`garantie-${g.id}-${champ}`} type="number" min="0" step="0.01" inputMode="decimal" className="form-control"
                              value={g.tauxFranchise} onChange={(e) => majGarantie(g.id, champ, tauxSaisi(e.target.value))} />
                          </ChampPropose>
                        ) : (
                          <ChampPropose onChoisir={(v) => majGarantie(g.id, champ, v)} propositions={proposeesGarantie(g.id, cle)}>
                            <AmountInput id={`garantie-${g.id}-${champ}`} value={g[champ]} onChange={(v) => majGarantie(g.id, champ, montantSaisi(v))} suffix="" />
                          </ChampPropose>
                        )}
                      </div>
                    ))}
                    {ajoutPossible && (
                      <div role="cell" className="garantie-retrait">
                        <button type="button" className="admin-bouton-icone" onClick={() => retirerGarantie(g)} title="Retirer cette garantie du devis" aria-label={`Retirer la garantie ${g.libelle}`}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {pied(boutonPrecedent(1), boutonSuivant(3, 'Suivant : prime et souscripteur'))}
            </>
          )}

          {/* ---------------------------------------------------------- ÉTAPE 3 : PRIME ET SOUSCRIPTEUR */}
          {step === 3 && (
            <>
              <h2 style={titreCarte}><Calculator size={18} style={{ color: couleur }} /> Prime</h2>
              {offreMinene ? (
                totauxMinene ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '0.6rem' }}>
                      {tuile('Prime nette', totauxMinene.PrimeNette)}
                      {tuile('Accessoires', totauxMinene.Accessoire)}
                      {tuile('Frais de gestion', totauxMinene.FraisGestion)}
                      {tuile('Taxes', totauxMinene.Taxe)}
                      {tuile('Prime TTC', totauxMinene.PrimeTtc, true)}
                    </div>
                    <p style={{ ...texteAide, margin: '0.75rem 0 0' }}>
                      Par adhérent : prime {fcfa(apercuMinene.Unitaire.PrimeNette)}, accessoire {fcfa(apercuMinene.Unitaire.Accessoire)},
                      frais de gestion MINENE {fcfa(apercuMinene.Unitaire.FraisGestion)}, taxe {String(apercuMinene.TauxTaxe).replace('.', ',')} % ({fcfa(apercuMinene.Unitaire.Taxe)}),
                      soit {fcfa(apercuMinene.Unitaire.PrimeTtc)} F TTC × {apercuMinene.Nombre} adhérent{apercuMinene.Nombre > 1 ? 's' : ''} de la police Santé
                      {' '}{apercuMinene.Police} (Administration &gt; Réglages Santé MINENE). Montants confirmés par la base à l&apos;enregistrement.
                    </p>
                  </>
                ) : (
                  <p style={texteAide}>
                    {apercuMinene?.erreur || "Offre MINENE : les primes sont calculées par la base à l'enregistrement, pour chaque adhérent de la police Santé."}
                  </p>
                )
              ) : (
                <>
                  <p style={texteAide}>
                    {saisieManuelle
                      ? `Pas de barème ${infos.court} : la prime nette, l'accessoire et la taxe sont saisis à la main. La prime nette est répartie par la base sur les garanties cochées.`
                      : <>La prime nette est répartie par la base sur les garanties cochées. L'accessoire suit le barème de la compagnie et la taxe
                        {tauxTaxe !== null ? ` vaut ${tauxTaxe} %` : ' suit le taux du produit'} de (prime nette + accessoire) ; les deux restent modifiables.</>}
                  </p>
                  {/* Saisie manuelle : « Assiette × taux » est proposé dans la liste de la prime nette */}
                  {!saisieManuelle && [[primeTarif > 0 ? Math.round(primeTarif) : 0, 'Prime du tarif'], [primeAssietteTaux, 'Assiette × taux']]
                    .filter(([montant]) => montant > 0 && montant !== Math.round(Number(primeNette) || 0)).length > 0 && (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><Lightbulb size={14} /> Propositions :</span>
                      {[[primeTarif > 0 ? Math.round(primeTarif) : 0, 'Prime du tarif'], [primeAssietteTaux, 'Assiette × taux']]
                        .filter(([montant]) => montant > 0 && montant !== Math.round(Number(primeNette) || 0))
                        .map(([montant, libelle]) => (
                          <button key={libelle} type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }}
                            onClick={() => { setPrimeNette(montant); setTaxeManuelle(false); }}>
                            {libelle} : {fcfa(montant)} F
                          </button>
                        ))}
                    </div>
                  )}
                  <div style={grille}>
                    <Champ label="Prime nette" requis>
                      <ChampPropose onChoisir={(v) => { setPrimeNette(v); setTaxeManuelle(false); }}
                        propositions={saisieManuelle && primeAssietteTaux > 0 ? [propositionMontant(primeAssietteTaux, 'assiette × taux de prime')] : []}>
                        <AmountInput value={primeNette} onChange={(v) => { setPrimeNette(montantSaisi(v)); setTaxeManuelle(false); }} />
                      </ChampPropose>
                    </Champ>
                    <Champ label="Accessoire"
                      aide={saisieManuelle ? 'À saisir ; vide : pas d\'accessoire' : (
                        <>
                          {calculEnCours ? 'Calcul…' : accessoireBareme !== null ? `Barème : ${fcfa(accessoireBareme)} F${accessoireManuel && Number(accessoire) !== accessoireBareme ? ' (montant saisi)' : ''}` : 'Proposé dès la saisie de la prime nette'}
                          {accessoireManuel && accessoireBareme !== null && Number(accessoire) !== accessoireBareme && (
                            <> · <button type="button" style={lienAction} onClick={() => { setAccessoireManuel(false); setAccessoire(accessoireBareme); setTaxeManuelle(false); }}>remettre le barème</button></>
                          )}
                        </>
                      )}>
                      <ChampPropose onChoisir={(v) => { setAccessoire(v); setAccessoireManuel(true); setTaxeManuelle(false); }} propositions={proposees('Accessoire')}>
                        <AmountInput value={accessoire} onChange={(v) => { setAccessoire(montantSaisi(v)); setAccessoireManuel(true); setTaxeManuelle(false); }} />
                      </ChampPropose>
                    </Champ>
                    <Champ label="Taxe" requis={saisieManuelle}
                      erreur={tauxTaxe !== null && (!saisieManuelle || Number(taxe) > 0) && Number(taxe) < taxeMinimum ? `Minimum légal : ${fcfa(taxeMinimum)} F (${String(tauxTaxe).replace('.', ',')} % de la prime nette)` : undefined}
                      aide={saisieManuelle
                        ? (tauxTaxe !== null && taxeMinimum > 0 ? `À saisir ; minimum légal ${fcfa(taxeMinimum)} F (${String(tauxTaxe).replace('.', ',')} % de la prime nette)` : 'À saisir')
                        : (
                          <>
                            {tauxTaxe !== null ? `${tauxTaxe} % × (prime nette + accessoire)` : 'Calculée dès la saisie de la prime nette'}
                            {taxeManuelle && taxeCalculee !== null && Number(taxe) !== taxeCalculee && (
                              <> · <button type="button" style={lienAction} onClick={() => setTaxeManuelle(false)}>recalculer ({fcfa(taxeCalculee)} F)</button></>
                            )}
                          </>
                        )}>
                      <ChampPropose onChoisir={(v) => { setTaxe(v); setTaxeManuelle(true); }}
                        propositions={saisieManuelle && tauxTaxe !== null && Number(primeNette) > 0 ? sansDoublon(
                          propositionMontant(taxeCalculee, `${String(tauxTaxe).replace('.', ',')} % de (prime nette + accessoire)`),
                          propositionMontant(taxeMinimum, `minimum légal : ${String(tauxTaxe).replace('.', ',')} % de la prime nette`),
                        ) : []}>
                        <AmountInput value={taxe} onChange={(v) => { setTaxe(montantSaisi(v)); setTaxeManuelle(true); }} />
                      </ChampPropose>
                    </Champ>
                    {tuile('Prime TTC', primeTtc, true)}
                  </div>
                </>
              )}

              <h2 style={{ ...titreCarte, marginTop: '2rem' }}><Users size={18} style={{ color: couleur }} /> Souscripteur et assuré</h2>
              <div style={grille}>
                <RechercheClient label="Souscripteur (client)" personne={souscripteur} onChoisir={choisirSouscripteur}
                  onNouveau={() => setNouveauClientPour('souscripteur')} demande={demandeRecherche} />
              </div>
              {souscripteur && <div style={{ marginTop: '0.75rem' }}><FichePersonne personne={souscripteur} /></div>}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '1.25rem', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={assureDifferent} style={{ width: 17, height: 17, accentColor: couleur }}
                  onChange={(e) => {
                    setAssureDifferent(e.target.checked);
                    if (!e.target.checked) { setAssureChoisi(null); setTelephoneAssure(souscripteur?.Telephone || ''); setAdresseGeo(souscripteur?.AdresseGeographique || ''); }
                  }} />
                L'assuré est une autre personne que le souscripteur
              </label>
              {assureDifferent && (
                <>
                  <div style={{ ...grille, marginTop: '1rem' }}>
                    <RechercheClient label="Assuré" personne={assureChoisi} onChoisir={choisirAssure} onNouveau={() => setNouveauClientPour('assure')} />
                  </div>
                  {assureChoisi && <div style={{ marginTop: '0.75rem' }}><FichePersonne personne={assureChoisi} /></div>}
                </>
              )}
              <div style={{ ...grille, marginTop: '1rem' }}>
                <Champ label="Téléphone de l'assuré">
                  <input type="tel" className="form-control" value={telephoneAssure} onChange={(e) => setTelephoneAssure(e.target.value)} />
                </Champ>
                <Champ label="Adresse géographique">
                  <input type="text" className="form-control" value={adresseGeo} onChange={(e) => setAdresseGeo(e.target.value)} />
                </Champ>
                <Champ
                  label="Pièce jointe"
                  aide={fichier
                    ? `Jointe à l'enregistrement : ${fichier.name}${idDevisEdite ? ' (remplace la pièce enregistrée)' : ''}`
                    : 'Facultatif : PDF ou image, consultable ensuite depuis la fiche du devis et du contrat'}
                >
                  <input type="file" className="form-control" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFichier(e.target.files?.[0] || null)} />
                </Champ>
              </div>
              {idDevisEdite && (
                <PieceJointe type="devis" id={idDevisEdite} masquerSiAbsente titre="Pièce jointe enregistrée" className="piece-jointe-saisie" />
              )}

              {pied(
                boutonPrecedent(2),
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={isSubmitting || isLoadingEdit} aria-busy={isSubmitting}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: couleur, borderColor: couleur, padding: '0.7rem 1.4rem', fontWeight: 800 }}>
                  {isSubmitting ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
                  {isSubmitting ? 'Enregistrement…' : idDevisEdite ? 'Enregistrer les modifications' : `Enregistrer le devis ${infos.court}`}
                </button>,
              )}
            </>
          )}
        </div>

        {/* RÉSUMÉ PERMANENT */}
        <ResumeDevis
          icone={Shield}
          couleur={couleur}
          lignes={[
            ['Compagnie', nomCompagnie],
            ['Offre', libelleOffre],
            ['Période', dateEffet && dateExpiration ? `${dateFr(dateEffet)} → ${dateFr(dateExpiration)}` : ''],
            ['Garanties', offreMinene ? 'fixées par la base' : garanties.length ? `${garantiesAcquises.length} / ${garanties.length}` : ''],
            Number(reduction) > 0 && ['Réduction', `${reduction} %`],
            ['Souscripteur', souscripteur?.Nom],
          ]}
          montant={offreMinene
            ? (totauxMinene ? `${fcfa(totauxMinene.PrimeTtc)} F` : null)
            : (Number(primeNette) > 0 ? `${fcfa(primeTtc)} F` : null)}
          detail={offreMinene
            ? (totauxMinene ? `${apercuMinene.Nombre} adhérent${apercuMinene.Nombre > 1 ? 's' : ''} de la police Santé` : 'Calculée par la base pour chaque adhérent')
            : (Number(primeNette) > 0 ? `Prime nette ${fcfa(primeNette)} F · accessoire ${fcfa(accessoire)} F · taxe ${fcfa(taxe)} F` : 'Saisie à l\'étape 3')}
        />
      </div>

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

      {/* Garantie ajoutée au devis (MRP), comme « Ajouter une garantie » de l'Automobile */}
      <Modal isOpen={Boolean(ajoutGarantie)} onClose={() => setAjoutGarantie(null)} title="Ajouter une garantie"
        subtitle="Catalogue des garanties « risques divers » : la garantie choisie est enregistrée sur ce devis seulement." maxWidth="580px">
        {ajoutGarantie && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Champ label="Garantie" requis>
              <select className="form-control" value={ajoutGarantie.id} onChange={(e) => setAjoutGarantie((a) => ({ ...a, id: e.target.value }))} autoFocus>
                <option value="">Choisir une garantie…</option>
                {garantiesProposees.map((c) => <option key={c.IdSousGarantie} value={c.IdSousGarantie}>{c.LibelleSousGarantie}</option>)}
              </select>
            </Champ>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '0.85rem' }}>
              <Champ label="Capital">
                <AmountInput value={ajoutGarantie.capital} onChange={(v) => setAjoutGarantie((a) => ({ ...a, capital: v }))} suffix="" />
              </Champ>
              <Champ label="Taux de franchise (%)">
                <input type="number" min="0" step="0.01" className="form-control" value={ajoutGarantie.tauxFranchise}
                  onChange={(e) => setAjoutGarantie((a) => ({ ...a, tauxFranchise: e.target.value }))} />
              </Champ>
              <Champ label="Franchise minimum">
                <AmountInput value={ajoutGarantie.franchiseMinimum} onChange={(v) => setAjoutGarantie((a) => ({ ...a, franchiseMinimum: v }))} suffix="" />
              </Champ>
              <Champ label="Franchise maximum">
                <AmountInput value={ajoutGarantie.franchiseMaximum} onChange={(v) => setAjoutGarantie((a) => ({ ...a, franchiseMaximum: v }))} suffix="" />
              </Champ>
            </div>
            <p style={{ ...texteAide, margin: 0 }}>
              Aucune prime à saisir ici : la prime nette du devis, saisie à l'étape suivante, est répartie par la base sur toutes les
              garanties cochées, celle-ci comprise.
              {(() => {
                const choisie = catalogueGaranties.find((c) => String(c.IdSousGarantie) === String(ajoutGarantie.id));
                if (!choisie) return null;
                return choisie.TauxTaxe !== null && choisie.TauxTaxe !== undefined
                  ? ` Taxe de cette garantie : ${String(choisie.TauxTaxe).replace('.', ',')} %.`
                  : " Aucun taux de taxe réglé pour cette garantie : le taux habituel de la branche s'applique.";
              })()}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setAjoutGarantie(null)}>Annuler</button>
              <button type="button" className="btn btn-primary" onClick={ajouterGarantie} disabled={!ajoutGarantie.id}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: couleur, borderColor: couleur }}>
                <Plus size={15} /> Ajouter la garantie
              </button>
            </div>
          </div>
        )}
      </Modal>

      <QuickAddClientModal
        isOpen={Boolean(nouveauClientPour)}
        onClose={() => setNouveauClientPour(null)}
        valeursInitiales={nouveauClientPour === 'souscripteur' ? qd.client : undefined}
        onClientCreated={(client) => {
          const personne = personneDepuisClient(client);
          if (personne?.IdClient) {
            if (nouveauClientPour === 'assure') choisirAssure(personne); else choisirSouscripteur(personne);
          }
          setNouveauClientPour(null);
        }}
      />
    </div>
  );
};

export default NewRisquesDiversQuotePage;
