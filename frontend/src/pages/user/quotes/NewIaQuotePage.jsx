import React, { useState, useEffect, useMemo, useRef } from 'react';
import { redirigerSiOreole } from './oreole/oreoleCommun';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from '../../../utils/navigationDevis';
import { dataStore } from '../../../api/dataStore';
import { joursInclusifs } from '../../../utils/dateUtils';
import { quoteApi, customerApi, settingsApi, contractApi, iaApi, brouillonApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import {
  UserPlus,
  ArrowLeft,
  ArrowRight,
  Check,
  Plus,
  Trash2,
  Edit3,
  AlertTriangle,
  Calculator,
  Upload,
  ChevronDown,
  ChevronRight,
  Save,
} from 'lucide-react';
import { ViewQuoteModal } from './ViewQuoteModal';
import PoliceMineneConnexe from './PoliceMineneConnexe';
import { QuickAddClientModal } from '../clients/QuickAddClientModal';
import { BandeauQuestionnaire, useQuestionnaireDevis } from './QuestionnaireDevis';
import { TermeContratSelect } from '../../../components/common/TermeContratSelect';
import { DureeContratSelect } from '../../../components/common/DureeContratSelect';
import { ID_TERME_PAR_DEFAUT, dureeSelonTerme, termeEtDureeEnregistres } from '../../../utils/termesContrat';
import { sortUniqueBy, trierParLibelle } from '../../../utils/sortUtils';
import { AmountInput } from '../../../components/common/AmountInput';
import { arrondirMontant, parametre, reglagesMinene, compagnieParDefaut } from '../../../utils/parametrage';

// Catégorie IA MINENE (comme URANUS) : NSIA, offre 66, capitaux fixes, durée annuelle ou au
// 31/12 ; le devis est créé depuis le contrat Santé connexe (souscripteur, assurés = adhérents,
// ayants droit = affiliés)
const ID_TARIF_MINENE = 103;
// Tarifs CGA et CI-ENERGIES : accessoire calculé sur la prime de chaque assuré (sp_finalisation_devis)
const ID_TARIFS_ACCESSOIRE_PAR_ASSURE = [145, 76];
const ID_OFFRE_MINENE = 66;
const ID_COMPAGNIE_MINENE = 1;
// Capitaux MINENE : Administration > Réglages Santé MINENE (2 000 000 / 2 000 000 / 100 000 à l'origine)
const capitauxMinene = () => {
  const { ia } = reglagesMinene();
  return { CapitalDeces: ia.deces, CapitalIpp: ia.ipt, FraisTraitement: ia.fraisMedicaux };
};
const DUREES_MINENE = [4];
// Réduction plafonnée (35 % à l'origine, comme dans URANUS) et clauses du tarif IA NSIA (document « TARIF IA_NSIA
// CI », feuille Clauses : personnes de plus de 60 ans à la souscription non garanties sauf dérogation de l'assureur,
// indemnité limitée à 200 millions par assuré et par sinistre) : Administration > Le cabinet & règles de gestion.
// Avertissements, la dérogation restant possible.
const reductionMax = () => parametre('devis.reduction_max_ia', 35);
const ID_COMPAGNIE_NSIA = 1;
const ageMaxNsia = () => parametre('ia.nsia_age_max', 60);
const indemniteMaxNsia = () => parametre('ia.nsia_indemnite_max', 200000000);
const ageAu = (naissance, date) => {
  if (!naissance || !date) return null;
  const n = new Date(naissance);
  const d = new Date(date);
  let a = d.getFullYear() - n.getFullYear();
  if (d.getMonth() < n.getMonth() || (d.getMonth() === n.getMonth() && d.getDate() < n.getDate())) a -= 1;
  return a;
};

const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
// Taxe des primes saisies, calculée comme la base : (prime nette + accessoire) × taux, arrondie
const taxeImposee = (primeNette, accessoire, taux) => Math.round(((Number(primeNette) || 0) + (Number(accessoire) || 0)) * (Number(taux) || 0) / 100);
// Date au format JJ-MM-AAAA attendu par les procédures d'URANUS
const dateTiret = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('-') : '');
const aujourdhui = () => new Date().toISOString().split('T')[0];
const jour = (v) => (v ? String(v).slice(0, 10) : '');

// Message lisible d'une erreur renvoyée par l'API ({error}, {erreur}, {message} ou erreurs par champ)
const messageErreurApi = (err) => {
  const data = err?.response?.data;
  if (!data) return err?.message || 'serveur injoignable';
  if (typeof data === 'string') return data.slice(0, 200);
  const direct = data.message || data.error || data.erreur || data.detail;
  if (direct) return typeof direct === 'string' ? direct : JSON.stringify(direct);
  return Object.entries(data)
    .map(([champ, v]) => `${champ} : ${Array.isArray(v) ? v.join(' ') : typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ; ');
};

// Date d'expiration : date d'effet + durée - 1 jour (même règle que la base). Durée libre :
// date saisie ; en MINENE, échéance de la police Santé connexe, à défaut le 31/12 de l'année d'effet
// (« Divers » d'URANUS)
const expirationPour = (dateEffet, dureeId, personnalisee, minene = false) => {
  if (!dateEffet) return '';
  if (Number(dureeId) === 5 && minene) return personnalisee || `${String(dateEffet).slice(0, 4)}-12-31`;
  if (Number(dureeId) === 5) return personnalisee || '';
  const mois = { 1: 1, 2: 3, 3: 6, 4: 12 }[Number(dureeId)] || 12;
  const d = new Date(dateEffet);
  d.setMonth(d.getMonth() + mois);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

const assureVide = () => ({
  cle: `n${Date.now()}${Math.random()}`,
  IdDevisDetail: 0,
  IdAssure: 0,
  Nom: '',
  Prenoms: '',
  DateNaissance: '',
  IdProfession: 0,
  AdresseGeographique: '',
  Telephone: '',
  CapitalDeces: 0,
  CapitalIpp: 0,
  FraisTraitement: 0,
  // Tarif personnalisé : primes saisies de l'assuré (0 = primes du barème)
  PrimeNette: 0,
  Accessoire: 0,
  AyantsDroit: [],
  ayantsOrigine: '[]',
  prime: null,
  garantiesEnregistrees: null,
});

// Empreintes : une ligne n'est renvoyée au calcul que si elle a changé (primes imposées conservées)
const empreinteLigne = (a) => JSON.stringify([
  Number(a.IdAssure) || 0,
  (a.Nom || '').trim().toUpperCase(),
  (a.Prenoms || '').trim().toUpperCase(),
  jour(a.DateNaissance),
  Number(a.IdProfession) || 0,
  (a.AdresseGeographique || '').trim(),
  Number(a.CapitalDeces) || 0,
  Number(a.CapitalIpp) || 0,
  Number(a.FraisTraitement) || 0,
  Number(a.PrimeNette) || 0,
  Number(a.Accessoire) || 0,
]);
const empreinteAyants = (liste) => JSON.stringify((liste || []).map((d) => [
  Number(d.IdQualiteAyantDroit) || 0,
  (d.Nom || '').trim().toUpperCase(),
  (d.Prenoms || '').trim().toUpperCase(),
  Number(d.Part) || 0,
]));
const ayantsDepuisApi = (liste) => (liste || []).map((d) => ({
  IdQualiteAyantDroit: Number(d.qualite_ayant_droit) || 0,
  Nom: d.nom_ayant_droit || '',
  Prenoms: (d.prenoms_ayant_droit || '').trim(),
  Part: Number(d.part) || 0,
}));

const dateFr = (valeur) => (valeur ? String(valeur).slice(0, 10).split('-').reverse().join('/') : '');

export const NewIaQuotePage = () => {
  const navigate = useNavigate();
  const { success, error: toastError, info } = useToast();

  // « Modifier » depuis le registre des devis : /user/quotes/ia?edit=<iddevis>
  const [searchParams] = useSearchParams();
  const editIddevisParam = searchParams.get('edit');
  const brouillonParam = searchParams.get('brouillon');
  const [brouillonId, setBrouillonId] = useState(null);
  const [enregistrementBrouillon, setEnregistrementBrouillon] = useState(false);
  const [chargementBrouillon, setChargementBrouillon] = useState(Boolean(brouillonParam));
  // Devis lié au package Oreole Santé : il s'ouvre dans la branche, qui garde les trois polices ensemble
  useEffect(() => redirigerSiOreole(editIddevisParam, navigate), [editIddevisParam]); // eslint-disable-line react-hooks/exhaustive-deps
  // Devis de renouvellement (page Renouvellement) : les assurés sont renvoyés à l'enregistrement, puis le serveur leur rend les montants du
  // contrat renouvelé (production/ia_montants_imposes.py) ; seul un assuré dont les capitaux ou l'offre changent repart au tarif
  const renouvellementParam = searchParams.get('renouvellement') === '1';
  // Devis d'incorporation dans un contrat à plusieurs personnes (page Incorporation, ou devis rouvert du registre) : police
  // reprise d'office, date d'incorporation au choix, échéance du contrat figée
  const incorporationParam = searchParams.get('incorporation') === '1';
  const [incorporation, setIncorporation] = useState(null);
  const enIncorporation = incorporationParam || Boolean(incorporation);
  const [isLoadingEdit, setIsLoadingEdit] = useState(Boolean(editIddevisParam));
  const [idDevisEdite, setIdDevisEdite] = useState(null);
  // Avenant du devis rouvert (REN, INC...) : renvoyé tel quel à l'import, sinon le renouvellement redevenait une affaire nouvelle
  const [idAvenantDevis, setIdAvenantDevis] = useState(null);
  const [numeroDevisEdite, setNumeroDevisEdite] = useState('');
  const [primeImposee, setPrimeImposee] = useState(false);
  const [enteteOrigine, setEnteteOrigine] = useState(null);
  const [totauxEnregistres, setTotauxEnregistres] = useState(null);
  // Devis repris d'URANUS sans assuré en base
  const [avertissementReprise, setAvertissementReprise] = useState('');

  const [step, setStep] = useState(1);
  const [createdQuote, setCreatedQuote] = useState(null);
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [calculEnCours, setCalculEnCours] = useState(false);

  // -------------------------------------------------------------
  // RÉFÉRENTIELS
  // -------------------------------------------------------------
  const [clients, setClients] = useState([]);
  const [companies, setCompanies] = useState(() => dataStore.getActiveCompanies('IA'));
  const [tarifs, setTarifs] = useState([]);
  const [offres, setOffres] = useState([]);
  const [professions, setProfessions] = useState([]);
  const [qualites, setQualites] = useState([]);

  // -------------------------------------------------------------
  // ÉTAPE 1 : CONTRAT
  // -------------------------------------------------------------
  const [compagnieId, setCompagnieId] = useState(() => compagnieParDefaut(2));
  const [idTarif, setIdTarif] = useState(77);
  const [idOffre, setIdOffre] = useState(0);
  const [tarifGroupe, setTarifGroupe] = useState(false);
  const flotte = tarifGroupe || enIncorporation;
  // Catégorie à tarif personnalisé (offres « SPECIFIQUE ») : primes saisies par assuré
  const [personnalise, setPersonnalise] = useState(false);
  const [tauxTaxe, setTauxTaxe] = useState(0);
  const [dureeId, setDureeId] = useState(4);
  const [termeId, setTermeId] = useState(ID_TERME_PAR_DEFAUT);
  // Terme du devis rouvert : le changer seul suffit à enregistrer (sans recalculer les primes)
  const [termeOrigine, setTermeOrigine] = useState(null);
  // Date d'émission : toujours la date du jour, jamais saisie (le serveur l'impose aussi)
  const dateEmission = aujourdhui();
  const [dateEffet, setDateEffet] = useState(aujourdhui);
  const [expirationPersonnalisee, setExpirationPersonnalisee] = useState('');
  const [reduction, setReduction] = useState(0);
  const [numeroPoliceCompagnie, setNumeroPoliceCompagnie] = useState('');
  const [numeroPoliceConnexe, setNumeroPoliceConnexe] = useState('');
  const estMinene = Number(idTarif) === ID_TARIF_MINENE;
  // Clauses du tarif IA NSIA (hors MINENE, qui a ses propres règles) pour un assuré
  const alertesNsia = (a) => {
    if (Number(compagnieId) !== ID_COMPAGNIE_NSIA || estMinene) return [];
    const alertes = [];
    const ageEffet = ageAu(a.DateNaissance, dateEffet);
    if (ageEffet !== null && ageEffet > ageMaxNsia()) {
      alertes.push(`${ageEffet} ans à la date d'effet : NSIA ne garantit pas les personnes de plus de ${ageMaxNsia()} ans à la souscription, sauf dérogation de l'assureur.`);
    }
    if (Number(a.CapitalDeces) > indemniteMaxNsia() || Number(a.CapitalIpp) > indemniteMaxNsia()) {
      alertes.push('NSIA limite l\'indemnité à 200 000 000 FCFA par assuré et par sinistre.');
    }
    return alertes;
  };
  // Création MINENE : les assurés viennent du contrat Santé, rien n'est saisi à l'écran
  const creationMinene = estMinene && !editIddevisParam;
  // Récapitulatif d'une création MINENE : adhérents de la police Santé et primes calculées par la base
  const [apercuMinene, setApercuMinene] = useState(null);
  const dateExpiration = useMemo(
    () => incorporation?.DateExpiration || expirationPour(dateEffet, dureeId, expirationPersonnalisee, estMinene),
    [incorporation, dateEffet, dureeId, expirationPersonnalisee, estMinene]
  );
  const joursCouverts = joursInclusifs(dateEffet, dateExpiration);
  // Rechargement du devis ouvert (après un import d'assurés dans ce même devis)
  const [versionChargement, setVersionChargement] = useState(0);
  const [fichierImport, setFichierImport] = useState(null);
  const [importEnCours, setImportEnCours] = useState(false);
  const [garantiesOuvertes, setGarantiesOuvertes] = useState({});

  // -------------------------------------------------------------
  // ÉTAPE 2 : SOUSCRIPTEUR, ASSURÉ(S) ET AYANTS DROIT
  // -------------------------------------------------------------
  const [souscripteurId, setSouscripteurId] = useState(0);
  const [rechercheSouscripteur, setRechercheSouscripteur] = useState('');
  const [listeSouscripteurOuverte, setListeSouscripteurOuverte] = useState(false);
  // Questionnaire prospect (?questionnaire=) : formulaire Individuelle Accidents du client, importé comme une liste
  const qd = useQuestionnaireDevis();
  const [repriseQuestionnaire, setRepriseQuestionnaire] = useState(false);
  useEffect(() => {
    if (createdQuote && qd.actif) qd.devisEtabli(createdQuote.numerodevis || '');
  }, [createdQuote]); // eslint-disable-line react-hooks/exhaustive-deps

  const [assures, setAssures] = useState([]);
  const [assureEnCours, setAssureEnCours] = useState(assureVide);
  const [cleEnEdition, setCleEnEdition] = useState(null);
  const [modeAssure, setModeAssure] = useState('nouveau'); // 'nouveau' (saisi par son nom) | 'existant' (fiche client)
  const [rechercheAssure, setRechercheAssure] = useState('');
  const [listeAssureOuverte, setListeAssureOuverte] = useState(false);
  const [ayantEnCours, setAyantEnCours] = useState({ IdQualiteAyantDroit: 1, Nom: '', Prenoms: '', Part: '' });

  const champsBrouillon = {
    compagnieId: [compagnieId, setCompagnieId],
    idTarif: [idTarif, setIdTarif],
    idOffre: [idOffre, setIdOffre],
    tarifGroupe: [tarifGroupe, setTarifGroupe],
    personnalise: [personnalise, setPersonnalise],
    tauxTaxe: [tauxTaxe, setTauxTaxe],
    dureeId: [dureeId, setDureeId],
    termeId: [termeId, setTermeId],
    termeOrigine: [termeOrigine, setTermeOrigine],
    dateEffet: [dateEffet, setDateEffet],
    expirationPersonnalisee: [expirationPersonnalisee, setExpirationPersonnalisee],
    reduction: [reduction, setReduction],
    numeroPoliceCompagnie: [numeroPoliceCompagnie, setNumeroPoliceCompagnie],
    numeroPoliceConnexe: [numeroPoliceConnexe, setNumeroPoliceConnexe],
    souscripteurId: [souscripteurId, setSouscripteurId],
    rechercheSouscripteur: [rechercheSouscripteur, setRechercheSouscripteur],
    assures: [assures, setAssures],
    assureEnCours: [assureEnCours, setAssureEnCours],
    cleEnEdition: [cleEnEdition, setCleEnEdition],
    modeAssure: [modeAssure, setModeAssure],
    ayantEnCours: [ayantEnCours, setAyantEnCours],
    idDevisEdite: [idDevisEdite, setIdDevisEdite],
    numeroDevisEdite: [numeroDevisEdite, setNumeroDevisEdite],
    primeImposee: [primeImposee, setPrimeImposee],
    enteteOrigine: [enteteOrigine, setEnteteOrigine],
    totauxEnregistres: [totauxEnregistres, setTotauxEnregistres],
  };

  const enregistrerBrouillon = async () => {
    setEnregistrementBrouillon(true);
    const donnees = Object.fromEntries(Object.entries(champsBrouillon).map(([cle, [valeur]]) => [cle, valeur]));
    const client = clients.find((c) => String(c.id) === String(souscripteurId));
    const libelle = [client?.nomcomplet || rechercheSouscripteur, `${assures.length} assuré${assures.length > 1 ? 's' : ''}`]
      .filter(Boolean)
      .join(' - ') || 'Devis IA sans souscripteur';
    const charge = { type_brouillon: 'DEVIS_IA', libelle, etape: step, donnees, iddevis: idDevisEdite || null };
    try {
      const res = brouillonId ? await brouillonApi.update(brouillonId, charge) : await brouillonApi.create(charge);
      setBrouillonId(res.data.id);
      success('Brouillon IA enregistré : vous pourrez le reprendre depuis le registre des devis.');
    } catch (err) {
      console.error("Enregistrement du brouillon IA impossible", err);
      toastError(`Le brouillon n'a pas été enregistré : ${err?.response?.data?.detail || err.message}.`);
    } finally {
      setEnregistrementBrouillon(false);
    }
  };

  useEffect(() => {
    if (!brouillonParam) return undefined;
    let actif = true;
    brouillonApi.get(brouillonParam)
      .then((brouillon) => {
        if (!actif || !brouillon) return;
        Object.entries(champsBrouillon).forEach(([cle, [, setter]]) => {
          if (Object.prototype.hasOwnProperty.call(brouillon.donnees || {}, cle)) setter(brouillon.donnees[cle]);
        });
        setBrouillonId(brouillon.id);
        setStep(Number(brouillon.etape) || 1);
        info(`Brouillon « ${brouillon.libelle || brouillon.id} » repris.`);
      })
      .catch((err) => {
        if (actif) {
          console.error('Reprise du brouillon IA impossible', err);
          toastError('Impossible de reprendre le brouillon IA.');
        }
      })
      .finally(() => { if (actif) setChargementBrouillon(false); });
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brouillonParam]);

  const professionsTriees = useMemo(() => trierParLibelle(professions, (p) => p.libelle_profession), [professions]);
  const qualitesTriees = useMemo(() => trierParLibelle(qualites, (q) => q.libelle_qualite_ayant_droit), [qualites]);
  const codeActivite = (idProfession) => professions.find((p) => Number(p.id) === Number(idProfession))?.code_classe_assure || '01';
  const libelleProfession = (idProfession) => professions.find((p) => Number(p.id) === Number(idProfession))?.libelle_profession || 'AUTRE';
  const libelleQualite = (id) => qualites.find((q) => Number(q.id_qualite) === Number(id))?.libelle_qualite_ayant_droit || '';

  // En-tête : si elle change, toutes les lignes sont recalculées
  const enteteActuelle = JSON.stringify([
    Number(compagnieId), Number(idTarif), Number(idOffre), Number(dureeId), dateEffet,
    dateExpiration, Number(reduction) || 0, numeroPoliceCompagnie || '', numeroPoliceConnexe || '', Number(souscripteurId),
  ]);
  const enteteModifiee = Boolean(enteteOrigine) && enteteOrigine !== enteteActuelle;
  const ligneAChanger = (a) => !a.IdDevisDetail || enteteModifiee || empreinteLigne(a) !== a.origine;

  // -------------------------------------------------------------
  // CHARGEMENT DES RÉFÉRENTIELS
  // -------------------------------------------------------------
  useEffect(() => {
    let actif = true;
    (async () => {
      const [cls, cies, trfs, profs, quals] = await Promise.all([
        customerApi.getClients().catch(() => []),
        settingsApi.getCompanies().catch(() => []),
        iaApi.getTarifs().catch(() => []),
        iaApi.getProfessions().catch(() => []),
        iaApi.getQualites().catch(() => []),
      ]);
      if (!actif) return;
      if (cls && cls.length) {
        setClients((prev) => [...prev.filter((p) => !cls.some((c) => String(c.id) === String(p.id))), ...cls]);
      }
      if (cies && cies.length) {
        setCompanies(cies.map((c) => ({ id: c.IdCompagnie || c.id, nom: c.RaisonSociale || c.nom })));
      }
      setTarifs(trfs || []);
      setProfessions(profs || []);
      setQualites(quals || []);
    })();
    return () => { actif = false; };
  }, []);

  // Offres et nature (individuelle / groupe, tarif personnalisé) de la catégorie choisie
  useEffect(() => {
    let actif = true;
    if (!idTarif || chargementBrouillon) return undefined;
    Promise.all([
      iaApi.getOffres(idTarif).catch(() => []),
      iaApi.estTarifGroupe(idTarif).catch(() => false),
      iaApi.estTarifPersonnalise(idTarif).catch(() => false),
    ]).then(([liste, groupe, perso]) => {
      if (!actif) return;
      setOffres(liste || []);
      setTarifGroupe(Boolean(groupe));
      setPersonnalise(Boolean(perso));
      setIdOffre((courant) => ((liste || []).some((o) => Number(o.IdOffre) === Number(courant))
        ? courant
        : Number(liste?.[0]?.IdOffre) || 0));
    });
    return () => { actif = false; };
  }, [idTarif, chargementBrouillon]);

  // Création depuis le contrat Santé MINENE (?minene=<police>&effet=&expiration=) : catégorie MINENE, police
  // connexe et période de la police Santé, sans ressaisie
  const policeMineneParam = searchParams.get('minene');
  useEffect(() => {
    if (!policeMineneParam || editIddevisParam) return;
    setIdTarif(ID_TARIF_MINENE);
    setNumeroPoliceConnexe(policeMineneParam);
    const effet = searchParams.get('effet');
    const expiration = searchParams.get('expiration');
    if (effet) setDateEffet(effet);
    if (expiration) {
      setDureeId(5);
      setExpirationPersonnalisee(expiration);
    }
  }, [policeMineneParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // N° de police Santé MINENE saisi (ou choisi) à la création : l'IA reprend ce qu'elle a en commun avec la police
  // Santé (client souscripteur, date d'effet, échéance, durée, terme) ; un devis rouvert garde les siennes
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
      setSouscripteurId(p.IdClient);
      setRechercheSouscripteur(p.Client || '');
    }
    info(`Police Santé ${p.NumeroPolice} : client, date d'effet et échéance repris.`);
  };

  // Récapitulatif d'une création MINENE : aperçu lu à l'étape 3 (police connexe et date d'effet connues)
  useEffect(() => {
    if (!creationMinene || step !== 3 || !numeroPoliceConnexe.trim()) { setApercuMinene(null); return undefined; }
    let actif = true;
    iaApi.apercuMinene(numeroPoliceConnexe.trim(), dateEffet)
      .then((d) => { if (actif) setApercuMinene(d); })
      .catch((err) => { if (actif) setApercuMinene({ erreur: messageErreurApi(err) }); });
    return () => { actif = false; };
  }, [creationMinene, step, numeroPoliceConnexe, dateEffet]);

  // MINENE : compagnie NSIA, offre MINENE et capitaux fixes, durée annuelle ou au 31/12 (URANUS)
  useEffect(() => {
    if (!estMinene) return;
    setCompagnieId(ID_COMPAGNIE_MINENE);
    setIdOffre(ID_OFFRE_MINENE);
    setDureeId((d) => (Number(d) === 5 || DUREES_MINENE.includes(Number(d)) ? d : DUREES_MINENE[0]));
    setAssureEnCours((p) => ({ ...p, ...capitauxMinene() }));
  }, [estMinene]);

  // Taux de taxe de l'offre : taxe et TTC des primes saisies affichées comme la base les calcule
  useEffect(() => {
    let actif = true;
    if (!personnalise || !idOffre || !dateEffet) return undefined;
    iaApi.getTauxTaxe({ idCompagnie: compagnieId, idOffre, dateEffet })
      .then((t) => { if (actif) setTauxTaxe(t); })
      .catch(() => { if (actif) setTauxTaxe(0); });
    return () => { actif = false; };
  }, [personnalise, compagnieId, idOffre, dateEffet]);

  // -------------------------------------------------------------
  // « MODIFIER » : REPRISE DE TOUT CE QUI A ÉTÉ SAISI À LA CRÉATION
  // -------------------------------------------------------------
  useEffect(() => {
    if (!editIddevisParam) return undefined;
    let actif = true;
    (async () => {
      setIsLoadingEdit(true);
      try {
        const [devis, lignes, details, garanties, lectureIncorporation] = await Promise.all([
          quoteApi.getQuote(editIddevisParam),
          iaApi.getAssuresDevis(editIddevisParam),
          iaApi.getDetailsDevis(editIddevisParam).catch(() => []),
          iaApi.getGarantiesDevis(editIddevisParam).catch(() => []),
          contractApi.lireDevisIncorporation(editIddevisParam).catch(() => null),
        ]);
        if (!actif) return;
        const raw = devis?.raw || {};
        if (raw.confirme) {
          toastError('Ce devis est confirmé (déjà en contrat) : il ne peut plus être modifié.');
          navigate('/user/quotes');
          return;
        }
        const detail = (details || [])[0] || {};
        // Incorporation encore sans personne : catégorie, offre et réduction reprises de la police
        const devisIncorporation = lectureIncorporation?.Incorporation ? lectureIncorporation : null;
        setIncorporation(devisIncorporation);
        // Durée libre et terme « Autre » vont ensemble (anciens devis « Divers » compris)
        const charge = termeEtDureeEnregistres(raw.idterme, raw.idduree);
        const entete = {
          compagnieId: Number(raw.compagnie?.IdCompagnie ?? raw.compagnie) || 1,
          idTarif: Number(detail.idtarif?.IdTarif ?? detail.idtarif) || devisIncorporation?.IdTarif || 77,
          idOffre: Number(detail.idoffre?.IdOffre ?? detail.idoffre) || devisIncorporation?.IdOffre || 0,
          dureeId: charge.dureeId,
          dateEffet: jour(raw.dateeffet) || aujourdhui(),
          dateExpiration: jour(raw.dateexpiration),
          reduction: Number(detail.taux_reduction) || devisIncorporation?.TauxReduction || 0,
          numeroPoliceCompagnie: raw.numero_police_compagnie || '',
          numeroPoliceConnexe: raw.numero_police_connexe || raw.numeropoliceconnexe || '',
          souscripteurId: Number(raw.client?.IdClient ?? raw.client) || 0,
        };
        setIdDevisEdite(Number(editIddevisParam));
        setIdAvenantDevis(Number(raw.avenant?.IdAvenant ?? raw.avenant) || null);
        setNumeroDevisEdite(raw.numerodevis || '');
        setPrimeImposee(Boolean(raw.prime_imposee));
        setTotauxEnregistres({
          primeNette: Number(raw.primenette) || 0,
          taxe: Number(raw.taxe) || 0,
          accessoire: Number(raw.accessoire) || 0,
          // Frais de gestion MINENE (1 500 F par adhérent), compris dans la prime TTC
          fraisGestion: Number(raw.accessoiregestionnaire) || 0,
          primeTtc: Number(raw.primettc) || 0,
        });
        setCompagnieId(entete.compagnieId);
        setIdTarif(entete.idTarif);
        setIdOffre(entete.idOffre);
        setDureeId(entete.dureeId);
        setTermeId(charge.termeId);
        setTermeOrigine(charge.termeId);
        setDateEffet(entete.dateEffet);
        setExpirationPersonnalisee(entete.dateExpiration);
        setReduction(entete.reduction);
        setNumeroPoliceCompagnie(entete.numeroPoliceCompagnie);
        setNumeroPoliceConnexe(entete.numeroPoliceConnexe);
        setSouscripteurId(entete.souscripteurId);
        const expirationChargee = devisIncorporation ? entete.dateExpiration : expirationPour(entete.dateEffet, entete.dureeId, entete.dateExpiration);
        setEnteteOrigine(JSON.stringify([
          entete.compagnieId, entete.idTarif, entete.idOffre, entete.dureeId, entete.dateEffet,
          expirationChargee, entete.reduction, entete.numeroPoliceCompagnie, entete.numeroPoliceConnexe, entete.souscripteurId,
        ]));

        // Souscripteur
        const souscripteur = entete.souscripteurId
          ? await customerApi.getClientDetail(entete.souscripteurId).catch(() => null)
          : null;
        if (!actif) return;
        if (souscripteur) {
          setClients((prev) => (prev.some((p) => String(p.id) === String(souscripteur.id)) ? prev : [souscripteur, ...prev]));
        }
        setRechercheSouscripteur(souscripteur?.nomcomplet || (entete.souscripteurId ? `Client n° ${entete.souscripteurId}` : ''));

        // Tarif personnalisé : prime nette et accessoire de chaque assuré sont ceux saisis
        const primesSaisies = await iaApi.estTarifPersonnalise(entete.idTarif).catch(() => false);
        if (!actif) return;

        // Assurés (une ligne de devis chacun) avec leurs ayants droit et garanties enregistrées
        const chargees = await Promise.all((lignes || []).map(async (l) => {
          const ayants = ayantsDepuisApi(await iaApi.getAyantsDroit(l.id_assure).catch(() => []));
          const garantiesLigne = (garanties || []).filter((g) => Number(g.id_devis_detail) === Number(l.id_devis_detail));
          const assure = {
            cle: `l${l.id_devis_detail}`,
            IdDevisDetail: Number(l.id_devis_detail),
            IdAssure: Number(l.id_assure),
            Nom: l.nom || '',
            Prenoms: l.prenoms || '',
            DateNaissance: jour(l.date_naissance),
            IdProfession: Number(l.id_profession) || 0,
            AdresseGeographique: l.adresse_geographique || '',
            Telephone: l.telephone && l.telephone !== '-' ? l.telephone : '',
            CapitalDeces: Math.round(Number(l.capital_deces) || 0),
            CapitalIpp: Math.round(Number(l.capital_infirmite) || 0),
            FraisTraitement: Math.round(Number(l.capital_frais_traitement) || 0),
            PrimeNette: primesSaisies ? Math.round(Number(l.prime_nette) || 0) : 0,
            Accessoire: primesSaisies ? Math.round(Number(l.accessoire) || 0) : 0,
            AyantsDroit: ayants,
            ayantsOrigine: empreinteAyants(ayants),
            prime: {
              primeNette: Math.round(Number(l.prime_nette) || 0),
              taxe: Math.round(Number(l.taxe) || 0),
              accessoire: Math.round(Number(l.accessoire) || 0),
              enregistree: true,
            },
            garantiesEnregistrees: garantiesLigne.length ? garantiesLigne : null,
          };
          assure.origine = renouvellementParam ? null : empreinteLigne(assure);
          return assure;
        }));
        if (!actif) return;
        setAssures(chargees);
        // Rien à ressaisir : directement aux personnes à incorporer
        if (devisIncorporation) setStep(2);
        setAvertissementReprise(chargees.length === 0 && Number(raw.primettc) > 0
          ? 'Aucun assuré n\'est enregistré pour ce devis : seuls l\'en-tête et les montants sont disponibles. '
            + 'Ajoutez les assurés avant d\'enregistrer.'
          : '');
      } catch (err) {
        if (actif) toastError(`Impossible de charger le devis à modifier : ${messageErreurApi(err)}`);
      } finally {
        if (actif) setIsLoadingEdit(false);
      }
    })();
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editIddevisParam, versionChargement]);

  // -------------------------------------------------------------
  // PRIMES CALCULÉES PAR LE SERVEUR (même moteur que l'enregistrement)
  // -------------------------------------------------------------
  const calculerPrime = (a) => iaApi.calculerPrimes({
    idCompagnie: compagnieId,
    idOffre,
    capitalDeces: a.CapitalDeces,
    capitalIpp: a.CapitalIpp,
    fraisTraitement: a.FraisTraitement,
    tauxReduction: reduction,
    dateEffet,
    dateExpiration,
    dateNaissance: a.DateNaissance,
    codeActivite: codeActivite(a.IdProfession),
    primeNette: personnalise ? a.PrimeNette : 0,
    accessoire: personnalise ? a.Accessoire : 0,
  });

  // Récapitulatif : lignes à recalculer mises à jour (les lignes inchangées gardent leurs primes enregistrées)
  const rafraichirPrimes = async () => {
    const aCalculer = assures.filter((a) => ligneAChanger(a) || !a.prime);
    if (!aCalculer.length || !idOffre) return;
    setCalculEnCours(true);
    try {
      const resultats = await Promise.all(aCalculer.map((a) => calculerPrime(a).then((p) => [a.cle, p]).catch(() => [a.cle, null])));
      const parCle = Object.fromEntries(resultats);
      setAssures((prev) => prev.map((a) => (a.cle in parCle ? { ...a, prime: parCle[a.cle] } : a)));
      if (resultats.some(([, p]) => !p)) toastError('Certaines primes n\'ont pas pu être calculées : vérifiez les dates et les capitaux.');
    } finally {
      setCalculEnCours(false);
    }
  };

  useEffect(() => {
    if (step === 3) rafraichirPrimes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Primes saisies de tous les assurés (tarif personnalisé) : totaux tels que la base les enregistrera
  const primesToutesSaisies = personnalise && assures.length > 0 && assures.every((a) => Number(a.PrimeNette) > 0);

  // Groupe : accessoire et taxe sur accessoire que sp_finalisation_devis posera (fn_get_accessoire sur la
  // prime nette totale ; CGA et CI-ENERGIES : sur la prime de chaque assuré), pour afficher la prime TTC
  // avant l'enregistrement. MINENE (montants propres à l'offre) : connu à l'enregistrement seulement.
  const [accessoireGroupe, setAccessoireGroupe] = useState(null);
  useEffect(() => {
    setAccessoireGroupe(null);
    if (!flotte || primesToutesSaisies || estMinene || step !== 3 || !idOffre || !assures.length || assures.some((a) => !a.prime)) return undefined;
    const primes = assures.map((a) => Math.round(Number(a.prime.primeNette) || 0));
    let actif = true;
    const minuterie = setTimeout(async () => {
      try {
        const lire = (primeNette) => iaApi.getAccessoireGroupe({ idCompagnie: compagnieId, idOffre, dateEffet, primeNette });
        let accessoire = 0;
        let taxeAccessoire = 0;
        if (ID_TARIFS_ACCESSOIRE_PAR_ASSURE.includes(Number(idTarif))) {
          const parPrime = new Map();
          for (const prime of new Set(primes)) parPrime.set(prime, await lire(prime)); // eslint-disable-line no-await-in-loop
          primes.forEach((prime) => {
            accessoire += Number(parPrime.get(prime)?.accessoire) || 0;
            taxeAccessoire += Number(parPrime.get(prime)?.taxe_accessoire) || 0;
          });
        } else {
          const r = await lire(primes.reduce((s, p) => s + p, 0));
          accessoire = Number(r?.accessoire) || 0;
          taxeAccessoire = Number(r?.taxe_accessoire) || 0;
        }
        if (actif) setAccessoireGroupe({ accessoire, taxeAccessoire });
      } catch {
        // l'accessoire reste annoncé « à l'enregistrement »
      }
    }, 300);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [flotte, primesToutesSaisies, estMinene, step, idOffre, idTarif, compagnieId, dateEffet, assures]);

  const totaux = useMemo(() => {
    if (primesToutesSaisies) {
      const primeNette = assures.reduce((s, a) => s + (Number(a.PrimeNette) || 0), 0);
      const accessoire = assures.reduce((s, a) => s + (Number(a.Accessoire) || 0), 0);
      const taxe = assures.reduce((s, a) => s + taxeImposee(a.PrimeNette, a.Accessoire, tauxTaxe), 0);
      return { primeNette, taxe, accessoire, primeTtc: arrondirMontant(primeNette + accessoire + taxe, 2) };
    }
    const primeNette = assures.reduce((s, a) => s + (a.prime?.primeNette || 0), 0);
    const taxeLignes = assures.reduce((s, a) => s + (a.prime?.taxe || 0), 0);
    // Individuel : accessoire (et sa taxe) de la ligne calculée ; groupe : fixés par la base à l'enregistrement
    const calcule = !flotte && assures[0]?.prime && !assures[0].prime.enregistree ? assures[0].prime : null;
    if (flotte && accessoireGroupe) {
      const accessoire = Math.round(accessoireGroupe.accessoire);
      const taxe = taxeLignes + Math.round(accessoireGroupe.taxeAccessoire);
      return { primeNette, taxe, accessoire, primeTtc: arrondirMontant(primeNette + taxe + accessoire, 2) };
    }
    if (!calcule) return { primeNette, taxe: taxeLignes, accessoire: null, primeTtc: null };
    const taxe = taxeLignes + (calcule.taxeAccessoire || 0);
    return { primeNette, taxe, accessoire: calcule.accessoire, primeTtc: arrondirMontant(primeNette + taxe + calcule.accessoire, 2) };
  }, [assures, flotte, primesToutesSaisies, tauxTaxe, accessoireGroupe]);
  // Garanties d'un assuré : celles du calcul en cours (offregarantieia), sinon celles enregistrées
  const garantiesAssure = (a) => {
    if (a.prime?.garanties?.length && !a.prime.enregistree) {
      return a.prime.garanties.map((g) => ({
        cle: g.IdSousGarantie || g.IdGarantie,
        libelle: g.LibelleSousGarantie || g.LibelleGarantie,
        acquise: g.Acquise !== false,
        capital: g.Capital,
        primeAnnuelle: g.PrimeAnnuelle,
        primeNette: g.PrimeNette,
        taxe: g.Taxe,
      }));
    }
    return (a.garantiesEnregistrees || []).map((g) => ({
      cle: g.id_garantie,
      libelle: g.libelle,
      acquise: g.acquise,
      capital: g.capital,
      primeAnnuelle: g.prime_annuelle,
      primeNette: g.prime_nette,
      taxe: g.taxe,
    }));
  };
  const rienAModifier = Boolean(idDevisEdite) && !enteteModifiee
    && (termeOrigine === null || Number(termeId) === termeOrigine)
    && assures.every((a) => a.IdDevisDetail && empreinteLigne(a) === a.origine);

  // -------------------------------------------------------------
  // ÉDITION D'UN ASSURÉ
  // -------------------------------------------------------------
  const reinitialiserEditeur = () => {
    setAssureEnCours(estMinene ? { ...assureVide(), ...capitauxMinene() } : assureVide());
    setCleEnEdition(null);
    setModeAssure('nouveau');
    setRechercheAssure('');
    setAyantEnCours({ IdQualiteAyantDroit: 1, Nom: '', Prenoms: '', Part: '' });
  };

  const choisirClientAssure = async (c) => {
    setListeAssureOuverte(false);
    setRechercheAssure(c.nomcomplet || `${c.nom || ''} ${c.prenom || ''}`.trim());
    const brut = c.raw || c;
    // Ses ayants droit déjà enregistrés sont repris (ils lui sont rattachés, pas au devis)
    const ayants = ayantsDepuisApi(await iaApi.getAyantsDroit(c.id).catch(() => []));
    setAssureEnCours((p) => ({
      ...p,
      IdAssure: Number(c.id),
      Nom: c.nom || c.Nom || c.nomcomplet || '',
      Prenoms: c.prenom || c.Prenoms || '',
      DateNaissance: p.DateNaissance || jour(brut.DateNaissance),
      AdresseGeographique: p.AdresseGeographique || brut.Adresse2 || '',
      // Téléphone de la fiche client (affiché, non modifié par le devis)
      Telephone: c.telephone || brut.Mobile || brut.Telephone || '',
      AyantsDroit: ayants,
      ayantsOrigine: empreinteAyants(ayants),
    }));
  };

  // Souscripteur choisi : en contrat individuel, l'assuré est par défaut le souscripteur (URANUS)
  const choisirSouscripteur = (c) => {
    setSouscripteurId(Number(c.id));
    setRechercheSouscripteur(c.nomcomplet);
    setListeSouscripteurOuverte(false);
    if (!flotte && !assures.length && !cleEnEdition && !assureEnCours.IdAssure && !assureEnCours.Nom.trim()) {
      setModeAssure('existant');
      choisirClientAssure(c);
    }
  };

  const editerAssure = (a) => {
    setAssureEnCours({ ...a, AyantsDroit: [...a.AyantsDroit] });
    setCleEnEdition(a.cle);
    setModeAssure(a.IdAssure ? 'existant' : 'nouveau');
    setRechercheAssure(`${a.Nom} ${a.Prenoms}`.trim());
    window.scrollTo({ top: 300, behavior: 'smooth' });
  };

  const retirerAssure = (cle) => {
    setAssures((prev) => prev.filter((a) => a.cle !== cle));
    if (cleEnEdition === cle) reinitialiserEditeur();
  };

  const ajouterAyant = () => {
    const part = Number(ayantEnCours.Part) || 0;
    if (!ayantEnCours.Nom.trim()) { toastError('Saisissez le nom de l\'ayant droit.'); return; }
    // Prénoms obligatoires, comme dans URANUS
    if (!ayantEnCours.Prenoms.trim()) { toastError('Saisissez les prénoms de l\'ayant droit.'); return; }
    // Part facultative : sans indication de l'assuré, le bénéficiaire reste sans part (0 en base)
    if (part < 0 || part > 100) { toastError('La part de l\'ayant droit doit être comprise entre 0 et 100 %.'); return; }
    const total = assureEnCours.AyantsDroit.reduce((s, d) => s + (Number(d.Part) || 0), 0) + part;
    if (total > 100) { toastError(`Le total des parts dépasserait 100 % (${total} %).`); return; }
    setAssureEnCours((p) => ({
      ...p,
      AyantsDroit: [...p.AyantsDroit, { ...ayantEnCours, Nom: ayantEnCours.Nom.trim().toUpperCase(), Prenoms: ayantEnCours.Prenoms.trim().toUpperCase(), Part: part }],
    }));
    setAyantEnCours({ IdQualiteAyantDroit: ayantEnCours.IdQualiteAyantDroit, Nom: '', Prenoms: '', Part: '' });
  };

  const validerAssure = async () => {
    const a = assureEnCours;
    if (modeAssure === 'existant' && !a.IdAssure) { toastError('Choisissez le client assuré.'); return; }
    if (modeAssure === 'nouveau' && !a.Nom.trim()) { toastError('Saisissez le nom de l\'assuré.'); return; }
    if (!a.DateNaissance) { toastError('Saisissez la date de naissance de l\'assuré.'); return; }
    if (!(Number(a.CapitalDeces) > 0 || Number(a.CapitalIpp) > 0 || Number(a.FraisTraitement) > 0)) {
      toastError('Saisissez au moins un capital (décès, infirmité ou frais de traitement).');
      return;
    }
    if (!flotte && !cleEnEdition && assures.length >= 1) {
      toastError('Cette catégorie est individuelle : un seul assuré. Choisissez une catégorie « groupe » pour en ajouter.');
      return;
    }
    if (modeAssure === 'existant' && assures.some((x) => x.cle !== cleEnEdition && Number(x.IdAssure) === Number(a.IdAssure))) {
      toastError('Assuré existant : ce client figure déjà parmi les assurés du devis.');
      return;
    }
    if (personnalise && Number(a.Accessoire) > 0 && !(Number(a.PrimeNette) > 0)) {
      toastError('Saisissez la prime nette : l\'accessoire seul ne peut pas être imposé.');
      return;
    }
    const assure = {
      ...a,
      ...(estMinene ? capitauxMinene() : {}),
      IdAssure: modeAssure === 'existant' ? a.IdAssure : 0,
      Nom: a.Nom.trim().toUpperCase(),
      Prenoms: a.Prenoms.trim().toUpperCase(),
      PrimeNette: personnalise ? Number(a.PrimeNette) || 0 : 0,
      Accessoire: personnalise && Number(a.PrimeNette) > 0 ? Number(a.Accessoire) || 0 : 0,
    };
    if (modeAssure === 'nouveau' && a.IdAssure) assure.ayantsOrigine = '[]';
    // Ligne enregistrée et inchangée : le serveur n'y touchera pas, sa prime enregistrée reste affichée
    if (assure.IdDevisDetail && !ligneAChanger(assure) && a.prime?.enregistree) {
      setAssures((prev) => prev.map((x) => (x.cle === cleEnEdition ? assure : x)));
      success('Assuré modifié.');
      reinitialiserEditeur();
      return;
    }
    let prime = null;
    if (idOffre) {
      try {
        prime = await calculerPrime(assure);
      } catch (err) {
        toastError(`Calcul de la prime impossible : ${messageErreurApi(err)}`);
        return;
      }
    }
    assure.prime = prime;
    setAssures((prev) => (cleEnEdition ? prev.map((x) => (x.cle === cleEnEdition ? assure : x)) : [...prev, assure]));
    success(cleEnEdition ? 'Assuré modifié.' : 'Assuré ajouté au devis.');
    reinitialiserEditeur();
  };

  // -------------------------------------------------------------
  // ENREGISTREMENT (création ou modification, une seule transaction côté serveur)
  // -------------------------------------------------------------
  const handleSave = async () => {
    if (creationMinene) { await handleSaveMinene(); return; }
    if (!souscripteurId) { toastError('Choisissez le souscripteur.'); setStep(2); return; }
    // Nom tapé dans la recherche sans cliquer sur un client de la liste : l'ancien souscripteur
    // resterait celui du devis
    const souscripteurChoisi = clients.find((c) => String(c.id) === String(souscripteurId));
    if (souscripteurChoisi && rechercheSouscripteur.trim() !== (souscripteurChoisi.nomcomplet || '').trim()) {
      toastError('Le souscripteur n\'a pas été choisi dans la liste : cliquez sur le client voulu sous le champ de recherche.');
      setStep(2);
      return;
    }
    if (!assures.length) { toastError('Ajoutez au moins un assuré.'); setStep(2); return; }
    if (!idOffre) { toastError('Aucune offre pour cette catégorie : choisissez une autre catégorie.'); setStep(1); return; }
    if (!dateExpiration) { toastError('Saisissez la date d\'expiration.'); setStep(1); return; }
    if (!flotte && assures.length > 1) {
      toastError('Cette catégorie est individuelle : un seul assuré. Choisissez une catégorie « groupe ».');
      setStep(1);
      return;
    }
    if (estMinene && !numeroPoliceConnexe.trim()) {
      toastError('Catégorie MINENE : saisissez le numéro de police Santé connexe.');
      setStep(2);
      return;
    }

    const payload = {
      IdDevis: idDevisEdite || 0,
      IdCompagnie: Number(compagnieId),
      IdTarif: Number(idTarif),
      IdOffre: Number(idOffre),
      Flotte: flotte,
      IdClient: Number(souscripteurId),
      DateEffet: dateEffet,
      DateExpiration: dateExpiration,
      DateEmission: dateEmission,
      IdDuree: Number(dureeId),
      IdTerme: Number(termeId),
      TauxReduction: Number(reduction) || 0,
      NumeroPoliceCompagnie: numeroPoliceCompagnie || '',
      NumeroPoliceConnexe: numeroPoliceConnexe || '',
      Assures: assures.map((a) => ({
        IdDevisDetail: a.IdDevisDetail || 0,
        IdAssure: a.IdAssure || 0,
        Nom: a.Nom,
        Prenoms: a.Prenoms,
        DateNaissance: a.DateNaissance,
        IdProfession: Number(a.IdProfession) || 0,
        AdresseGeographique: a.AdresseGeographique || '',
        Telephone: a.Telephone || '',
        CapitalDeces: Number(a.CapitalDeces) || 0,
        CapitalIpp: Number(a.CapitalIpp) || 0,
        FraisTraitement: Number(a.FraisTraitement) || 0,
        PrimeNette: personnalise ? Number(a.PrimeNette) || 0 : 0,
        Accessoire: personnalise ? Number(a.Accessoire) || 0 : 0,
        Recalculer: ligneAChanger(a),
        AyantsDroitModifies: empreinteAyants(a.AyantsDroit) !== (a.ayantsOrigine || '[]'),
        AyantsDroit: a.AyantsDroit.map((d) => ({
          IdQualiteAyantDroit: Number(d.IdQualiteAyantDroit) || 0,
          Nom: d.Nom,
          Prenoms: d.Prenoms,
          Part: Number(d.Part) || 0,
        })),
      })),
    };

    setIsSubmitting(true);
    try {
      let res;
      try {
        res = await iaApi.enregistrerDevis(payload);
      } catch (errApi) {
        toastError(`Devis IA non enregistré : ${messageErreurApi(errApi)}`);
        return;
      }
      const devisId = res?.devis_id;
      if (!devisId) {
        toastError('Devis IA non enregistré : le serveur n\'a pas renvoyé de numéro de devis.');
        return;
      }
      const souscripteur = clients.find((c) => String(c.id) === String(souscripteurId));
      const compagnie = companies.find((c) => String(c.id) === String(compagnieId));
      const saved = dataStore.saveQuote({
        id: devisId,
        iddevis: devisId,
        numerodevis: res.numero_devis,
        client_nom: souscripteur?.nomcomplet || rechercheSouscripteur,
        client_id: Number(souscripteurId),
        produit: `Individuelle Accidents (${assures.length} assuré${assures.length > 1 ? 's' : ''})`,
        branche: 'IA',
        compagnie: compagnie?.nom || '',
        prime_nette: res.totaux?.prime_nette,
        taxes: res.totaux?.taxe,
        accessoires: res.totaux?.accessoire,
        prime_totale: res.totaux?.prime_ttc,
        date_emission: dateEmission,
        date_effet: dateEffet,
        date_expiration: dateExpiration,
      });
      let devisEnregistre = null;
      try {
        devisEnregistre = await quoteApi.getQuote(devisId);
      } catch {
        // l'aperçu utilisera la copie locale ci-dessus
      }
      success(
        idDevisEdite
          ? `Devis Individuelle Accidents N° ${res.numero_devis} modifié.`
          : `Devis Individuelle Accidents N° ${res.numero_devis} enregistré.`
      );
      if (brouillonId) {
        try {
          await brouillonApi.remove(brouillonId);
          setBrouillonId(null);
        } catch (err) {
          console.error('Suppression du brouillon IA après enregistrement impossible', err);
          toastError('Le devis est enregistré, mais le brouillon n’a pas pu être supprimé.');
        }
      }
      setCreatedQuote(devisEnregistre || saved);
    } catch (err) {
      toastError(`Erreur lors de l'enregistrement du devis IA : ${messageErreurApi(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Création MINENE (comme URANUS) : le serveur reprend le contrat Santé connexe - client du
  // contrat = souscripteur, adhérents = assurés, affiliés = ayants droit - aux capitaux fixes
  const handleSaveMinene = async () => {
    if (!numeroPoliceConnexe.trim()) { toastError('Saisissez le numéro de police Santé connexe.'); setStep(2); return; }
    if (!dateExpiration) { toastError('Saisissez la date d\'expiration.'); setStep(1); return; }
    // Date de naissance de repli d'URANUS (18 ans) : le serveur prend celle de l'adhérent principal
    const majorite = new Date();
    majorite.setFullYear(majorite.getFullYear() - 18);
    setIsSubmitting(true);
    try {
      let res;
      try {
        res = await iaApi.creerDevisMinene({
          NumeroPoliceConnexe: numeroPoliceConnexe.trim(),
          IdIntermediaire: 1,
          IdCompagnie: ID_COMPAGNIE_MINENE,
          IdProduit: 2,
          IdOffre: ID_OFFRE_MINENE,
          IdAvenant: 1,
          Flotte: false,
          Coassurance: false,
          DateEffet: dateTiret(dateEffet),
          DateExpiration: dateTiret(dateExpiration),
          DateEmission: dateTiret(dateEmission),
          IdTarif: ID_TARIF_MINENE,
          ...capitauxMinene(),
          TauxReduction: Number(reduction) || 0,
          CodeActivite: '01',
          DateNaissance: dateTiret(majorite.toISOString()),
          IdDuree: Number(dureeId),
          IdTerme: Number(termeId),
          IdDevis: 0,
          IdDevisDetail: 0,
          AdresseGeographique: '',
          NumeroPoliceCompagnie: numeroPoliceCompagnie || '',
          IdClient: 0,
          IdAssure: 0,
          IdProfession: 0,
        });
      } catch (errApi) {
        toastError(`Devis IA MINENE non enregistré : ${messageErreurApi(errApi)}`);
        return;
      }
      if (res?.Status !== 'Succès' || !res.iddevis) {
        toastError(`Devis IA MINENE non enregistré : ${res?.message || 'réponse inattendue du serveur'}`);
        return;
      }
      success(`Devis MINENE créé : ${res.assures_crees} assuré(s), ${res.ayants_droits_crees} ayant(s) droit.`);
      if (res.erreurs > 0) {
        const premiere = res.details_erreurs?.[0]?.message;
        toastError(`${res.erreurs} adhérent(s) ou affilié(s) non repris${premiere ? ` : ${premiere}` : ''}.`);
      }
      const devisEnregistre = await quoteApi.getQuote(res.iddevis).catch(() => null);
      if (devisEnregistre) setCreatedQuote(devisEnregistre);
      else navigate('/user/quotes');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Import d'une liste d'assurés (fichier Excel aux formats d'URANUS) dans le devis groupe : le
  // serveur crée le devis s'il n'existe pas, ses totaux sont recalculés, puis il est rouvert
  const assuresNonEnregistres = assures.some((a) => !a.IdDevisDetail || empreinteLigne(a) !== a.origine) || enteteModifiee;
  const handleImportAssures = async () => {
    if (!fichierImport) { toastError('Choisissez le fichier Excel des assurés.'); return; }
    if (!souscripteurId) { toastError('Choisissez d\'abord le souscripteur.'); return; }
    if (!idOffre) { toastError('Aucune offre pour cette catégorie : choisissez une autre catégorie.'); setStep(1); return; }
    if (!dateExpiration) { toastError('Saisissez la date d\'expiration.'); setStep(1); return; }
    if (assuresNonEnregistres) {
      toastError('Enregistrez d\'abord le devis avec les assurés et modifications en cours, puis importez le fichier.');
      return;
    }
    const donnees = new FormData();
    donnees.append('FichierExcel', fichierImport);
    donnees.append('IdCompagnie', Number(compagnieId));
    donnees.append('IdIntermediaire', 1);
    donnees.append('IdOffre', Number(idOffre));
    donnees.append('IdAvenant', incorporation?.IdAvenant || (idDevisEdite && idAvenantDevis) || 1);
    donnees.append('IdClient', Number(souscripteurId));
    donnees.append('DateEffet', dateTiret(dateEffet));
    donnees.append('DateExpiration', dateTiret(dateExpiration));
    donnees.append('DateEmission', dateTiret(dateEmission));
    donnees.append('IdTarif', Number(idTarif));
    donnees.append('TauxReduction', Number(reduction) || 0);
    // Incorporation : durée déduite des dates par la base
    donnees.append('IdDuree', incorporation ? 0 : Number(dureeId));
    donnees.append('IdDevis', idDevisEdite || 0);
    // Police Santé connexe (IA MINENE) : sans elle la base refuse l'import, et un devis rouvert la perdait
    donnees.append('NumeroPoliceConnexe', numeroPoliceConnexe || '');
    donnees.append('NumeroPoliceCompagnie', numeroPoliceCompagnie || '');
    // Assuré déjà connu (renouvellement) : repris dans le devis, fonction et ayants droit du fichier
    donnees.append('ModeImport', 'mettre_a_jour');
    setImportEnCours(true);
    try {
      let res;
      try {
        res = await iaApi.importerAssures(donnees);
      } catch (errApi) {
        const data = errApi?.response?.data;
        const detail = data?.erreurs?.[0] ? ` (${typeof data.erreurs[0] === 'string' ? data.erreurs[0] : JSON.stringify(data.erreurs[0])})` : '';
        toastError(`Import impossible : ${messageErreurApi(errApi)}${detail}`);
        return;
      }
      const idDevis = Number(res?.id_devis) || 0;
      if (!res?.success || !idDevis) {
        toastError(`Import impossible : ${res?.message || 'aucun assuré importé'}`);
        return;
      }
      await iaApi.finaliserDevis({ idDevis, idClient: souscripteurId }).catch(() => null);
      success(res.message || 'Importation des assurés réalisée avec succès.');
      // Écarts relevés par l'import (primes, période, souscripteur, acte du fichier)
      (res.avertissements || []).slice(0, 4).forEach((a) => info(a));
      // Devis créé par l'import : sa prime TTC finalisée doit égaler le total TTC du fichier
      const ttcFichier = Number(res.primes_fichier?.prime_ttc) || 0;
      if (!idDevisEdite && ttcFichier > 0) {
        const devisImporte = await quoteApi.getQuote(idDevis).catch(() => null);
        const ttcDevis = Math.round(Number(devisImporte?.prime_totale) || 0);
        if (devisImporte && ttcDevis === Math.round(ttcFichier)) {
          success(`Primes contrôlées : TTC du devis ${fcfa(ttcDevis)} F = total TTC du fichier.`);
        } else if (devisImporte) {
          toastError(`Écart de primes : TTC du devis ${fcfa(ttcDevis)} F, total TTC du fichier ${fcfa(ttcFichier)} F. Vérifiez l'offre choisie.`);
        }
      }
      setFichierImport(null);
      if (String(idDevis) === String(editIddevisParam)) setVersionChargement((v) => v + 1);
      else navigate(`/user/quotes/ia?edit=${idDevis}`);
    } finally {
      setImportEnCours(false);
    }
  };

  // Confirmation : contrat, police et quittance créés par la base (sp_confirmation_devis), sans repli local
  const handleConvertToContract = async (quoteToConvert) => {
    try {
      await contractApi.createContractFromQuote(quoteToConvert.iddevis || quoteToConvert.id);
      success(`Devis ${quoteToConvert.numerodevis} confirmé : le contrat a été créé.`);
      setCreatedQuote(null);
      navigate('/user/contracts');
    } catch (err) {
      toastError(`Le devis n'a pas pu être confirmé : ${messageErreurApi(err)}`);
    }
  };

  // -------------------------------------------------------------
  // AFFICHAGE
  // -------------------------------------------------------------
  const clientsFiltres = (texte) => {
    const t = (texte || '').toLowerCase();
    return clients.filter((c) => (c.nomcomplet || '').toLowerCase().includes(t)).slice(0, 40);
  };
  const totalParts = assureEnCours.AyantsDroit.reduce((s, d) => s + (Number(d.Part) || 0), 0);
  const listeDeroulante = {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--bg-surface-elevated)',
    border: '1px solid var(--border-subtle)', borderRadius: '6px', maxHeight: '220px', overflowY: 'auto',
    marginTop: '4px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)',
  };
  const elementListe = { padding: '0.6rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.85rem' };
  const titreSection = { color: '#8b5cf6', fontWeight: 800, textTransform: 'uppercase', fontSize: '1.05rem', margin: '0 0 1.25rem' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1240px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* EN-TÊTE ET ÉTAPES */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <button className="btn btn-secondary" onClick={() => navigate('/user/quotes')} style={{ padding: '0.35rem 0.75rem', marginBottom: '0.5rem' }}>
            <ArrowLeft size={16} /> Retour aux devis
          </button>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <UserPlus size={26} color="#8b5cf6" />
            {enIncorporation
              ? `Incorporation${numeroDevisEdite ? ` [${numeroDevisEdite}]` : ''}`
              : editIddevisParam || idDevisEdite
              ? `Modifier le Devis Individuelle Accident${numeroDevisEdite ? ` [${numeroDevisEdite}]` : ''}`
              : 'Nouveau Devis Individuelle Accident (IA)'}
          </h1>
          {isLoadingEdit ? (
            <p style={{ color: 'var(--accent-purple)', fontSize: '0.875rem', fontWeight: 600 }}>Chargement du devis à modifier…</p>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Garanties Décès accidentel, Infirmité permanente et Frais de traitement - {flotte ? 'contrat groupe (plusieurs assurés)' : 'contrat individuel (un assuré)'}.
            </p>
          )}
          {incorporation && (
            <p role="note" style={{ marginTop: '0.5rem', padding: '0.6rem 0.75rem', borderRadius: '8px', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.35)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              <strong>Incorporation dans la police {incorporation.NumeroPolice}</strong>
              {`, qui compte ${incorporation.Personnes} personne${incorporation.Personnes > 1 ? 's' : ''} : du ${dateFr(dateEffet)} à l'échéance inchangée du ${dateFr(dateExpiration)} (${joursCouverts} jours).`}
              {' '}Ajoutez ici seulement les personnes à incorporer : la prime de chacune est le tarif de l'offre. La date d'émission n'est pas imprimée sur les documents.
            </p>
          )}
          {avertissementReprise && (
            <p style={{ marginTop: '0.5rem', padding: '0.6rem 0.75rem', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#f59e0b', fontSize: '0.85rem', maxWidth: '760px' }}>
              {avertissementReprise}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[
            { n: 1, label: '1. CONTRAT' },
            { n: 2, label: '2. SOUSCRIPTEUR & ASSURÉS' },
            { n: 3, label: '3. RÉCAPITULATIF' },
          ].map((e) => (
            <button
              key={e.n}
              type="button"
              onClick={() => setStep(e.n)}
              style={{
                padding: '0.5rem 0.95rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                border: step === e.n ? '2px solid #8b5cf6' : '1px solid var(--border-subtle)',
                background: step === e.n ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                color: step === e.n ? 'var(--accent-purple)' : 'var(--text-muted)',
              }}
            >
              {e.label}
            </button>
          ))}
          {!creationMinene && !estMinene && !enIncorporation && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={enregistrerBrouillon}
              disabled={enregistrementBrouillon || chargementBrouillon || isLoadingEdit}
              title="Enregistrer la saisie en cours pour la reprendre depuis le registre des devis"
              style={{ padding: '0.5rem 0.95rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Save size={14} />
              {enregistrementBrouillon ? 'Enregistrement…' : (brouillonId ? 'Mettre à jour le brouillon' : 'Enregistrer le brouillon')}
            </button>
          )}
        </div>
      </div>

      {primeImposee && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid #f59e0b', background: 'rgba(245, 158, 11, 0.08)', color: 'var(--accent-amber)', fontSize: '0.85rem' }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            Ce devis comporte des <strong>primes imposées</strong>. Les assurés que vous ne modifiez pas gardent leurs primes ;
            un assuré modifié ou ajouté, ou un changement du contrat (dates, catégorie, réduction…), est recalculé au tarif,
            ainsi que les totaux du devis.
          </span>
        </div>
      )}

      <BandeauQuestionnaire
        qd={qd}
        onChercherClient={(nom) => { setRechercheSouscripteur(nom); setListeSouscripteurOuverte(true); setStep(2); }}
        onCreerClient={() => setIsQuickAddClientOpen(true)}
        actions={qd.devis?.genre === 'ia' && qd.devis.personnes ? [{
          libelle: `Reprendre les ${qd.devis.personnes} assuré(s)`,
          icone: Upload,
          principal: true,
          occupe: repriseQuestionnaire,
          disabled: repriseQuestionnaire,
          titre: "Liste des personnes du formulaire du client, importée dans le devis groupe (bouton « Importer » de l'écran Assurés)",
          onClick: async () => {
            setRepriseQuestionnaire(true);
            try {
              setFichierImport(await qd.fichier());
              if (flotte) {
                setStep(2);
                info('Formulaire du client prêt à importer : choisissez le souscripteur, puis « Importer » sous la liste des assurés.');
              } else {
                setStep(1);
                info("Choisissez une catégorie groupe : la liste du formulaire s'importe dans un devis groupe (écran Assurés, « Importer »).");
              }
            } catch {
              toastError('Fichier du questionnaire non téléchargé.');
            } finally {
              setRepriseQuestionnaire(false);
            }
          },
        }] : []}
      />

      {/* ÉTAPE 1 : CONTRAT */}
      {step === 1 && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          <h3 style={titreSection}>Informations générales du contrat</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Numéro de police compagnie</label>
              <input type="text" className="form-control" value={numeroPoliceCompagnie} onChange={(e) => setNumeroPoliceCompagnie(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Compagnie d'assurance (* requis)</label>
              <select
                className="form-control"
                value={compagnieId}
                onChange={(e) => setCompagnieId(Number(e.target.value))}
                disabled={estMinene || enIncorporation}
                title={enIncorporation ? 'Compagnie de la police' : (estMinene ? 'Catégorie MINENE : compagnie NSIA imposée' : undefined)}
              >
                {sortUniqueBy(companies, (c) => c.nom).map((c) => (
                  <option key={c.id} value={c.id}>{c.nom}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Catégorie (* requis)</label>
              <select className="form-control" value={idTarif} onChange={(e) => setIdTarif(Number(e.target.value))}>
                {trierParLibelle(tarifs, (t) => t.LibelleTarif).map((t) => (
                  <option key={t.IdTarif} value={t.IdTarif}>{t.LibelleTarif}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Offre (* requis)</label>
              <select className="form-control" value={idOffre} onChange={(e) => setIdOffre(Number(e.target.value))} disabled={estMinene}>
                {offres.length === 0 && <option value={0}>Aucune offre pour cette catégorie</option>}
                {trierParLibelle(offres, (o) => o.LibelleOffre).map((o) => (
                  <option key={o.IdOffre} value={o.IdOffre}>{o.LibelleOffre}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Terme du contrat</label>
              <TermeContratSelect
                value={termeId}
                onChange={(id) => {
                  setTermeId(id);
                  // « Autre » ouvre la durée libre (date d'expiration saisie)
                  setDureeId((d) => dureeSelonTerme(id, d));
                }}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Durée du contrat</label>
              {enIncorporation ? (
                <div className="form-control" aria-readonly="true">{joursCouverts} jours jusqu'à l'échéance</div>
              ) : (
                <DureeContratSelect value={dureeId} onChange={setDureeId} idsAutorises={estMinene ? DUREES_MINENE : null} />
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Date d'émission</label>
              <input type="date" className="form-control" value={dateEmission} readOnly disabled title="Date du jour, non modifiable" />
            </div>
            <div className="form-group">
              <label className="form-label">{enIncorporation ? "Date d'incorporation (* requis)" : "Date d'effet (* requis)"}</label>
              <input type="date" className="form-control" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)}
                min={incorporation?.DateEffetContrat} max={incorporation?.DateExpiration} />
            </div>
            <div className="form-group">
              <label className="form-label">{enIncorporation ? "Date d'échéance du contrat (non modifiable)" : "Date d'expiration (* requis)"}</label>
              {Number(dureeId) === 5 && !estMinene && !enIncorporation ? (
                <input type="date" className="form-control" value={expirationPersonnalisee} onChange={(e) => setExpirationPersonnalisee(e.target.value)} />
              ) : (
                <input
                  type="date"
                  className="form-control"
                  value={dateExpiration}
                  readOnly
                  title={estMinene && Number(dureeId) === 5 ? 'MINENE, terme « Autre » : 31/12 de l\'année d\'effet' : 'Calculée d\'après la durée'}
                  style={{ background: 'var(--bg-surface-elevated)', color: 'var(--accent-purple)', fontWeight: 700 }}
                />
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Réduction (%) (* requis)</label>
              <input
                type="number"
                min="0"
                max={reductionMax()}
                className="form-control"
                value={reduction}
                onChange={(e) => setReduction(Math.max(0, Math.min(reductionMax(), Number(e.target.value) || 0)))}
                title={`De 0 à ${reductionMax()} %`}
              />
            </div>
          </div>
          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-primary" onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#7c3aed' }}>
              Suivant : Souscripteur & assurés <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ÉTAPE 2 : SOUSCRIPTEUR, ASSURÉS ET AYANTS DROIT */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {estMinene && (
            <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px', border: '1px solid rgba(249, 115, 22, 0.45)' }}>
              <h3 style={{ ...titreSection, color: '#f97316' }}>Contrat Santé MINENE connexe</h3>
              <div style={{ maxWidth: '560px' }}>
                <PoliceMineneConnexe
                  value={numeroPoliceConnexe}
                  onChange={setNumeroPoliceConnexe}
                  onPolice={reprendrePoliceMinene}
                  produit="IA"
                  libelle="Numéro de police Santé connexe (* requis)"
                />
              </div>
              <p style={{ fontSize: '0.85rem', color: '#fb923c', margin: '0.5rem 0 0' }}>
                {creationMinene
                  ? 'Le souscripteur et l\'assuré seront automatiquement déterminés depuis le contrat Santé : chaque adhérent devient un assuré et ses affiliés ses ayants droit.'
                  : 'Assurés repris du contrat Santé.'}
                {' '}Capitaux MINENE : décès {fcfa(capitauxMinene().CapitalDeces)}, infirmité permanente {fcfa(capitauxMinene().CapitalIpp)}, frais de traitement {fcfa(capitauxMinene().FraisTraitement)} FCFA.
              </p>
              {creationMinene && (
                <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ArrowLeft size={16} /> Précédent
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => setStep(3)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#7c3aed' }}>
                    Suivant : Récapitulatif <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </div>
          )}
          {!creationMinene && (<>
          <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
            <h3 style={titreSection}>Souscripteur</h3>
            <div className="form-group" style={{ position: 'relative', maxWidth: '560px' }}>
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Nom du souscripteur (* requis)</span>
                {!enIncorporation && (
                <button type="button" onClick={() => setIsQuickAddClientOpen(true)} style={{ background: 'transparent', border: 'none', color: 'var(--accent-purple)', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <Plus size={14} /> Nouveau client
                </button>
                )}
              </label>
              <input
                type="text"
                className="form-control"
                placeholder="Rechercher un client..."
                value={rechercheSouscripteur}
                onChange={(e) => { setRechercheSouscripteur(e.target.value); setListeSouscripteurOuverte(true); }}
                onFocus={() => setListeSouscripteurOuverte(true)}
                // Incorporation : souscripteur de la police, la finalisation le réécrit sur le devis
                disabled={enIncorporation}
                title={enIncorporation ? 'Souscripteur de la police' : undefined}
              />
              {listeSouscripteurOuverte && !enIncorporation && (
                <div style={listeDeroulante}>
                  {clientsFiltres(rechercheSouscripteur).map((c) => (
                    <div
                      key={c.id}
                      style={elementListe}
                      onClick={() => choisirSouscripteur(c)}
                    >
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{c.nomcomplet}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.codeclient} • {c.telephone}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <h3 style={{ ...titreSection, margin: 0 }}>{cleEnEdition ? 'Modifier l\'assuré' : 'Ajouter un assuré'}</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[{ v: 'nouveau', l: 'Nouvel assuré (saisi par son nom)' }, { v: 'existant', l: 'Client existant' }].map((m) => (
                  <button
                    key={m.v}
                    type="button"
                    className={modeAssure === m.v ? 'btn btn-primary' : 'btn btn-secondary'}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', background: modeAssure === m.v ? '#7c3aed' : undefined }}
                    onClick={() => {
                      setModeAssure(m.v);
                      setAssureEnCours((p) => ({ ...p, IdAssure: 0, AyantsDroit: m.v === 'nouveau' ? [] : p.AyantsDroit, ayantsOrigine: '[]' }));
                      setRechercheAssure('');
                    }}
                  >
                    {m.l}
                  </button>
                ))}
                {souscripteurId > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                    onClick={() => {
                      const c = clients.find((x) => String(x.id) === String(souscripteurId));
                      if (c) { setModeAssure('existant'); choisirClientAssure(c); }
                    }}
                  >
                    Assuré = souscripteur
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
              {modeAssure === 'existant' ? (
                <div className="form-group" style={{ position: 'relative' }}>
                  <label className="form-label">Client assuré (* requis)</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Rechercher un assuré..."
                    value={rechercheAssure}
                    onChange={(e) => { setRechercheAssure(e.target.value); setListeAssureOuverte(true); }}
                    onFocus={() => setListeAssureOuverte(true)}
                  />
                  {listeAssureOuverte && (
                    <div style={listeDeroulante}>
                      {clientsFiltres(rechercheAssure).map((c) => (
                        <div key={c.id} style={elementListe} onClick={() => choisirClientAssure(c)}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{c.nomcomplet}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.codeclient} • {c.telephone}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label">Nom (* requis)</label>
                    <input type="text" className="form-control" value={assureEnCours.Nom} onChange={(e) => setAssureEnCours((p) => ({ ...p, Nom: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Prénoms</label>
                    <input type="text" className="form-control" value={assureEnCours.Prenoms} onChange={(e) => setAssureEnCours((p) => ({ ...p, Prenoms: e.target.value }))} />
                  </div>
                </>
              )}
              <div className="form-group">
                <label className="form-label">Date de naissance (* requis)</label>
                <input type="date" className="form-control" value={assureEnCours.DateNaissance} onChange={(e) => setAssureEnCours((p) => ({ ...p, DateNaissance: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Profession</label>
                {/* Liste de la base seule : elle contient déjà « AUTRE » (id 0, classe 01) */}
                <select className="form-control" value={assureEnCours.IdProfession} onChange={(e) => setAssureEnCours((p) => ({ ...p, IdProfession: Number(e.target.value) }))}>
                  {professionsTriees.map((p) => (
                    <option key={p.id} value={p.id}>{p.libelle_profession} - classe {p.code_classe_assure}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Adresse géographique</label>
                <input type="text" className="form-control" value={assureEnCours.AdresseGeographique} onChange={(e) => setAssureEnCours((p) => ({ ...p, AdresseGeographique: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Téléphone Assuré</label>
                <input
                  type="tel"
                  className="form-control"
                  placeholder="+225"
                  value={assureEnCours.Telephone}
                  onChange={(e) => setAssureEnCours((p) => ({ ...p, Telephone: e.target.value }))}
                  readOnly={modeAssure === 'existant'}
                  title={modeAssure === 'existant' ? 'Téléphone de la fiche client (modifiable depuis la fiche)' : 'Enregistré sur la fiche du nouvel assuré'}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Capital décès</label>
                <AmountInput value={assureEnCours.CapitalDeces} onChange={(v) => setAssureEnCours((p) => ({ ...p, CapitalDeces: v }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Capital infirmité permanente</label>
                <AmountInput value={assureEnCours.CapitalIpp} onChange={(v) => setAssureEnCours((p) => ({ ...p, CapitalIpp: v }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Capital frais de traitement</label>
                <AmountInput value={assureEnCours.FraisTraitement} onChange={(v) => setAssureEnCours((p) => ({ ...p, FraisTraitement: v }))} />
              </div>
            </div>

            {alertesNsia(assureEnCours).map((alerte) => (
              <div key={alerte} style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #f59e0b', background: 'rgba(245, 158, 11, 0.08)', color: 'var(--accent-amber)', fontSize: '0.82rem' }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{alerte}</span>
              </div>
            ))}

            {/* Catégorie à tarif personnalisé (offres « SPECIFIQUE ») : primes de l'assuré saisies, comme URANUS.
                Taxe et TTC sont celles que la base enregistrera (taux de taxe de l'offre). */}
            {personnalise && (() => {
              const taxe = taxeImposee(assureEnCours.PrimeNette, assureEnCours.Accessoire, tauxTaxe);
              const ttc = Number(assureEnCours.PrimeNette) > 0 ? (Number(assureEnCours.PrimeNette) || 0) + (Number(assureEnCours.Accessoire) || 0) + taxe : 0;
              return (
                <div style={{ marginTop: '1.25rem', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-elevated)' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 700, margin: '0 0 0.75rem' }}>Primes imposées (tarif personnalisé)</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Prime Nette</label>
                      <AmountInput value={assureEnCours.PrimeNette} onChange={(v) => setAssureEnCours((p) => ({ ...p, PrimeNette: v }))} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Accessoire</label>
                      <AmountInput value={assureEnCours.Accessoire} onChange={(v) => setAssureEnCours((p) => ({ ...p, Accessoire: v }))} disabled={!(Number(assureEnCours.PrimeNette) > 0)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Taxe ({tauxTaxe} %)</label>
                      <input type="text" className="form-control" readOnly value={`${fcfa(taxe)} FCFA`} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Prime TTC</label>
                      <input type="text" className="form-control" readOnly value={`${fcfa(ttc)} FCFA`} style={{ fontWeight: 700 }} />
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Ayants droit de l'assuré */}
            <div style={{ marginTop: '1.5rem', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-elevated)' }}>
              <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 700, margin: '0 0 0.75rem' }}>
                Ayants droit (bénéficiaires en cas de décès){totalParts > 0 ? ` - total des parts ${totalParts} %` : ''}
              </h4>
              {assureEnCours.AyantsDroit.length > 0 && (
                <table className="table" style={{ width: '100%', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      <th style={{ textAlign: 'left', padding: '0.4rem' }}>QUALITÉ</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem' }}>NOM</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem' }}>PRÉNOMS</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem' }}>PART</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {assureEnCours.AyantsDroit.map((d, i) => (
                      <tr key={`${d.Nom}-${i}`}>
                        <td style={{ padding: '0.4rem' }}>{libelleQualite(d.IdQualiteAyantDroit)}</td>
                        <td style={{ padding: '0.4rem' }}>{d.Nom}</td>
                        <td style={{ padding: '0.4rem' }}>{d.Prenoms}</td>
                        <td style={{ padding: '0.4rem', textAlign: 'right' }}>{Number(d.Part) > 0 ? `${d.Part} %` : '-'}</td>
                        <td style={{ padding: '0.4rem', textAlign: 'right' }}>
                          <button type="button" className="btn btn-secondary" title="Retirer" style={{ padding: '0.25rem 0.45rem', color: '#ef4444' }}
                            onClick={() => setAssureEnCours((p) => ({ ...p, AyantsDroit: p.AyantsDroit.filter((_, j) => j !== i) }))}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.2fr) 1fr 1fr 110px auto', gap: '0.6rem', alignItems: 'end' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Qualité</label>
                  <select className="form-control" value={ayantEnCours.IdQualiteAyantDroit} onChange={(e) => setAyantEnCours((p) => ({ ...p, IdQualiteAyantDroit: Number(e.target.value) }))}>
                    {qualitesTriees.map((q) => (<option key={q.id_qualite} value={q.id_qualite}>{q.libelle_qualite_ayant_droit}</option>))}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Nom *</label>
                  <input type="text" className="form-control" value={ayantEnCours.Nom} onChange={(e) => setAyantEnCours((p) => ({ ...p, Nom: e.target.value }))} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Prénoms *</label>
                  <input type="text" className="form-control" value={ayantEnCours.Prenoms} onChange={(e) => setAyantEnCours((p) => ({ ...p, Prenoms: e.target.value }))} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Part (%) - facultative</label>
                  <input type="number" min="0" max="100" className="form-control" value={ayantEnCours.Part} onChange={(e) => setAyantEnCours((p) => ({ ...p, Part: e.target.value }))} />
                </div>
                <button type="button" className="btn btn-secondary" onClick={ajouterAyant} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Plus size={14} /> Ajouter
                </button>
              </div>
            </div>

            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              {cleEnEdition && (
                <button type="button" className="btn btn-secondary" onClick={reinitialiserEditeur}>Annuler la modification</button>
              )}
              <button type="button" className="btn btn-primary" onClick={validerAssure} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#10b981' }}>
                <Check size={16} /> {cleEnEdition ? 'Enregistrer les modifications de l\'assuré' : 'Ajouter cet assuré au devis'}
              </button>
            </div>
          </div>

          {/* Liste des assurés du devis */}
          <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
            <h3 style={titreSection}>Assurés du devis ({assures.length})</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    <th style={{ padding: '0.6rem', textAlign: 'left' }}>ASSURÉ</th>
                    <th style={{ padding: '0.6rem', textAlign: 'left' }}>NÉ(E) LE</th>
                    <th style={{ padding: '0.6rem', textAlign: 'left' }}>PROFESSION</th>
                    <th style={{ padding: '0.6rem', textAlign: 'right' }}>DÉCÈS</th>
                    <th style={{ padding: '0.6rem', textAlign: 'right' }}>INFIRMITÉ</th>
                    <th style={{ padding: '0.6rem', textAlign: 'right' }}>FRAIS TRAIT.</th>
                    <th style={{ padding: '0.6rem', textAlign: 'center' }}>AYANTS DROIT</th>
                    <th style={{ padding: '0.6rem', textAlign: 'right' }}>PRIME NETTE</th>
                    <th style={{ padding: '0.6rem', textAlign: 'center' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {assures.length === 0 && (
                    <tr><td colSpan={9} style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>Aucun assuré pour l'instant.</td></tr>
                  )}
                  {assures.map((a) => (
                    <tr key={a.cle} style={{ borderBottom: '1px solid var(--border-subtle)', background: cleEnEdition === a.cle ? 'rgba(139, 92, 246, 0.08)' : undefined }}>
                      <td style={{ padding: '0.6rem', fontWeight: 600 }}>
                        {a.Nom} {a.Prenoms}
                        {!a.IdAssure && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: 'var(--accent-purple)' }}>(nouvelle fiche)</span>}
                        {alertesNsia(a).length > 0 && (
                          <span title={alertesNsia(a).join('\n')} style={{ marginLeft: '0.4rem', color: 'var(--accent-amber)', verticalAlign: 'middle' }}>
                            <AlertTriangle size={14} />
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.6rem' }}>{a.DateNaissance ? a.DateNaissance.split('-').reverse().join('/') : ''}</td>
                      <td style={{ padding: '0.6rem' }}>{libelleProfession(a.IdProfession)}</td>
                      <td style={{ padding: '0.6rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(a.CapitalDeces)}</td>
                      <td style={{ padding: '0.6rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(a.CapitalIpp)}</td>
                      <td style={{ padding: '0.6rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(a.FraisTraitement)}</td>
                      <td style={{ padding: '0.6rem', textAlign: 'center' }}>{a.AyantsDroit.length}</td>
                      <td style={{ padding: '0.6rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent-purple)', fontWeight: 700 }}>
                        {a.prime ? `${fcfa(a.prime.primeNette)} FCFA` : '-'}
                      </td>
                      <td style={{ padding: '0.6rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                          <button type="button" className="btn btn-secondary" title="Modifier" style={{ padding: '0.35rem 0.5rem' }} onClick={() => editerAssure(a)}>
                            <Edit3 size={14} />
                          </button>
                          <button type="button" className="btn btn-secondary" title="Retirer du devis" style={{ padding: '0.35rem 0.5rem', color: '#ef4444' }} onClick={() => retirerAssure(a.cle)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {flotte && (
              <div style={{ marginTop: '1.25rem', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-elevated)' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 700, margin: '0 0 0.75rem' }}>Importer une liste d'assurés (Excel)</h4>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="form-control"
                    style={{ maxWidth: '420px' }}
                    onChange={(e) => setFichierImport(e.target.files?.[0] || null)}
                  />
                  {fichierImport && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }} title="Fichier qui sera importé">
                      Fichier : <strong>{fichierImport.name}</strong>
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleImportAssures}
                    disabled={!fichierImport || importEnCours}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#7c3aed' }}
                  >
                    <Upload size={15} /> {importEnCours ? 'Importation…' : 'Importer'}
                  </button>
                </div>
              </div>
            )}
            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ArrowLeft size={16} /> Précédent
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setStep(3)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#7c3aed' }}>
                Suivant : Récapitulatif <ArrowRight size={16} />
              </button>
            </div>
          </div>
          </>)}
        </div>
      )}

      {/* ÉTAPE 3 : RÉCAPITULATIF */}
      {step === 3 && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h3 style={{ ...titreSection, margin: 0 }}>Récapitulatif des primes</h3>
            {calculEnCours && <span style={{ color: 'var(--accent-purple)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Calculator size={15} /> Calcul des primes…</span>}
          </div>
          <table className="table" style={{ width: '100%', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '0.6rem', textAlign: 'left' }}>ASSURÉ</th>
                <th style={{ padding: '0.6rem', textAlign: 'right' }}>PRIME NETTE</th>
                <th style={{ padding: '0.6rem', textAlign: 'right' }}>TAXES</th>
                <th style={{ padding: '0.6rem', textAlign: 'left' }}>ÉTAT</th>
              </tr>
            </thead>
            <tbody>
              {/* Création MINENE : adhérents de la police Santé, assurés à l'enregistrement */}
              {creationMinene && apercuMinene?.erreur && (
                <tr><td colSpan={4} style={{ padding: '0.75rem', color: 'var(--accent-rose)' }}>Aperçu impossible : {apercuMinene.erreur}</td></tr>
              )}
              {creationMinene && apercuMinene?.Adherents?.map((a) => (
                <tr key={a.IdAdherent} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '0.6rem', fontWeight: 600 }}>
                    {a.Nom}
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                      {' '}- {a.AyantsDroit ? `${a.AyantsDroit} ayant${a.AyantsDroit > 1 ? 's' : ''} droit` : 'sans ayant droit'}
                    </span>
                  </td>
                  <td style={{ padding: '0.6rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(apercuMinene.Unitaire.PrimeNette)}</td>
                  <td style={{ padding: '0.6rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(apercuMinene.Unitaire.Taxe)}</td>
                  <td style={{ padding: '0.6rem', color: 'var(--text-muted)' }}>{a.Actif ? 'Repris de la police Santé' : 'Adhérent inactif (compté dans la prime)'}</td>
                </tr>
              ))}
              {creationMinene && apercuMinene && !apercuMinene.erreur && !apercuMinene.Adherents?.length && (
                <tr><td colSpan={4} style={{ padding: '0.75rem', color: 'var(--accent-amber)' }}>Aucun adhérent sur la police Santé {numeroPoliceConnexe} : l'IA MINENE ne peut pas être créée.</td></tr>
              )}
              {assures.map((a) => {
                const garantiesLigne = garantiesAssure(a);
                const ouvert = Boolean(garantiesOuvertes[a.cle]);
                return (
                  <React.Fragment key={a.cle}>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '0.6rem', fontWeight: 600 }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          title={garantiesLigne.length ? 'Garanties de l\'assuré' : 'Garanties disponibles après le calcul'}
                          disabled={!garantiesLigne.length}
                          onClick={() => setGarantiesOuvertes((p) => ({ ...p, [a.cle]: !p[a.cle] }))}
                          style={{ padding: '0.15rem 0.3rem', marginRight: '0.5rem' }}
                        >
                          {ouvert ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                        {a.Nom} {a.Prenoms}
                      </td>
                      <td style={{ padding: '0.6rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{a.prime ? fcfa(a.prime.primeNette) : '-'}</td>
                      <td style={{ padding: '0.6rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{a.prime ? fcfa(a.prime.taxe) : '-'}</td>
                      <td style={{ padding: '0.6rem', color: 'var(--text-muted)' }}>
                        {!idDevisEdite ? 'Nouveau' : !a.IdDevisDetail ? 'Ajouté' : ligneAChanger(a) ? 'Recalculé' : 'Inchangé (prime enregistrée)'}
                      </td>
                    </tr>
                    {ouvert && (
                      <tr>
                        <td colSpan={4} style={{ padding: '0.25rem 0.6rem 0.9rem 2.4rem' }}>
                          <table className="table" style={{ width: '100%', fontSize: '0.8rem' }}>
                            <thead>
                              <tr style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                                <th style={{ padding: '0.4rem', textAlign: 'left' }}>GARANTIE</th>
                                <th style={{ padding: '0.4rem', textAlign: 'center' }}>ACQUISE</th>
                                <th style={{ padding: '0.4rem', textAlign: 'right' }}>CAPITAL</th>
                                <th style={{ padding: '0.4rem', textAlign: 'right' }}>P. ANNUELLE</th>
                                <th style={{ padding: '0.4rem', textAlign: 'right' }}>P. NETTE</th>
                                <th style={{ padding: '0.4rem', textAlign: 'right' }}>TAXE</th>
                              </tr>
                            </thead>
                            <tbody>
                              {garantiesLigne.map((g) => (
                                <tr key={g.cle}>
                                  <td style={{ padding: '0.4rem' }}>{g.libelle}</td>
                                  <td style={{ padding: '0.4rem', textAlign: 'center' }}>{g.acquise ? 'Oui' : 'Non'}</td>
                                  <td style={{ padding: '0.4rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(g.capital)}</td>
                                  <td style={{ padding: '0.4rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(g.primeAnnuelle)}</td>
                                  <td style={{ padding: '0.4rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(g.primeNette)}</td>
                                  <td style={{ padding: '0.4rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(g.taxe)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem' }}>
            {(creationMinene && apercuMinene?.Totaux
              ? [
                ['Prime nette', apercuMinene.Totaux.PrimeNette],
                ['Taxes', apercuMinene.Totaux.Taxe],
                ['Accessoires', apercuMinene.Totaux.Accessoire],
                ['Frais de gestion', apercuMinene.Totaux.FraisGestion],
                ['Prime TTC', apercuMinene.Totaux.PrimeTtc],
              ]
              : rienAModifier && totauxEnregistres
              ? [
                ['Prime nette', totauxEnregistres.primeNette],
                ['Taxes', totauxEnregistres.taxe],
                ['Accessoires', totauxEnregistres.accessoire],
                ...(totauxEnregistres.fraisGestion > 0 ? [['Frais de gestion', totauxEnregistres.fraisGestion]] : []),
                ['Prime TTC', totauxEnregistres.primeTtc],
              ]
              : [
                ['Prime nette', totaux.primeNette],
                [flotte && totaux.accessoire === null ? 'Taxes (hors accessoire)' : 'Taxes', totaux.taxe],
                ['Accessoires', totaux.accessoire],
                ['Prime TTC', totaux.primeTtc],
              ]).map(([libelle, valeur]) => (
                <div key={libelle} style={{ background: libelle === 'Prime TTC' ? 'rgba(139, 92, 246, 0.12)' : 'var(--bg-surface-elevated)', padding: '1rem', borderRadius: '8px', border: libelle === 'Prime TTC' ? '2px solid #8b5cf6' : '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{libelle}</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                    {valeur === null || valeur === undefined ? 'à l\'enregistrement' : `${fcfa(valeur)} FCFA`}
                  </div>
                </div>
              ))}
          </div>

          {creationMinene && apercuMinene?.Totaux && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              Par adhérent : prime {fcfa(apercuMinene.Unitaire.PrimeNette)}, accessoire {fcfa(apercuMinene.Unitaire.Accessoire)},
              frais de gestion MINENE {fcfa(apercuMinene.Unitaire.FraisGestion)}, taxe {String(apercuMinene.TauxTaxe).replace('.', ',')} % ({fcfa(apercuMinene.Unitaire.Taxe)}),
              soit {fcfa(apercuMinene.Unitaire.PrimeTtc)} F TTC × {apercuMinene.Nombre} adhérent{apercuMinene.Nombre > 1 ? 's' : ''} de la police Santé
              (Administration &gt; Réglages Santé MINENE). Montants confirmés à l'enregistrement.
            </div>
          )}

          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ArrowLeft size={16} /> Précédent
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isSubmitting || isLoadingEdit || calculEnCours}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#7c3aed', padding: '0.75rem 1.5rem', fontWeight: 800 }}
            >
              <Check size={18} />
              {isSubmitting ? 'Enregistrement en cours...' : idDevisEdite ? 'Enregistrer les modifications' : 'Enregistrer le Devis IA'}
            </button>
          </div>
        </div>
      )}

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

      <QuickAddClientModal
        isOpen={isQuickAddClientOpen}
        onClose={() => setIsQuickAddClientOpen(false)}
        valeursInitiales={qd.client}
        onClientCreated={(newClient) => {
          setClients((prev) => [newClient, ...prev]);
          setSouscripteurId(Number(newClient.id || newClient.IdClient));
          setRechercheSouscripteur(newClient.nomcomplet || newClient.Nom);
        }}
      />
    </div>
  );
};

export default NewIaQuotePage;
