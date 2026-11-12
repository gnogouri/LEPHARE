import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Car, ChevronDown, ChevronLeft,
  ChevronRight, ClipboardCheck, FileText, HeartHandshake, HeartPulse, Home, Layers, Loader2, Pencil, Plane, RefreshCw, RotateCcw,
  Search, Save, Shield, ShieldCheck, Ship,
} from 'lucide-react';
import { contractApi } from '../../../api/endpoints';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { SqueletteTableau } from '../../../components/common/Squelette';
import { useToast } from '../../../context/ToastContext';
import { confirmer } from '../../../utils/dialogue';
import { messageErreurApi } from '../../../utils/financeUtils';
import { DUREES_CONTRAT, ID_DUREE_LIBRE, TERMES_CONTRAT } from '../../../utils/termesContrat';

const TAILLE_PAGE = 25;
const BRANCHES = [
  { cle: 'ALL', libelle: 'Toutes les branches', icone: Layers, produits: null },
  { cle: 'AUTO', libelle: 'Automobile', icone: Car, produits: [1] },
  { cle: 'SANTE', libelle: 'Santé', icone: HeartPulse, produits: [5] },
  { cle: 'VIE', libelle: 'Vie', icone: HeartHandshake, produits: [10] },
  { cle: 'IA', libelle: 'Individuelle Accidents', icone: Activity, produits: [2] },
  { cle: 'VOYAGE', libelle: 'Voyage', icone: Plane, produits: [3] },
  { cle: 'TRANSPORT', libelle: 'Transport', icone: Ship, produits: [6] },
  { cle: 'MRH', libelle: 'Habitation & Dommages', icone: Home, produits: [4, 7, 9] },
  { cle: 'RC', libelle: 'Responsabilité Civile', icone: Shield, produits: [8] },
];
const STATUTS = {
  en_cours: { libelle: 'En cours', badge: 'emerald' },
  a_renouveler: { libelle: 'À renouveler', badge: 'amber' },
  echu: { libelle: 'Échu', badge: 'slate' },
  renouvele: { libelle: 'Renouvelé', badge: 'blue' },
  resilie: { libelle: 'Résilié', badge: 'rose' },
  annule: { libelle: 'Annulé', badge: 'rose' },
};
const ONGLETS_STATUT = ['tous', ...Object.keys(STATUTS)];
const TAILLES_PAGE = [25, 50, 100];
const ID_PRODUIT_AUTO = 1;

const dateFr = (valeur) => {
  const match = String(valeur || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '-';
};
const montant = (valeur) => (valeur === null || valeur === undefined || valeur === ''
  ? '-'
  : `${Math.round(Number(valeur)).toLocaleString('fr-FR')} F`);
const nombre = (valeur) => Number(valeur || 0).toLocaleString('fr-FR');

const nomClient = (contrat) => {
  const client = contrat.idclient;
  if (client && typeof client === 'object') {
    return `${client.Nom || ''} ${client.Prenoms || ''}`.trim();
  }
  return contrat.assure || 'Client non renseigné';
};

// ------------------------------------------------------------------ description des champs
// Types : texte, zone (texte long), montant, nombre, taux, date, dateheure, bool, choix (liste du serveur ou fixe),
// client (identifiant de stdclient montré avec le nom)
const SEXES = [{ id: 'M', libelle: 'Masculin' }, { id: 'F', libelle: 'Féminin' }];
const DUREES = [...DUREES_CONTRAT, { id: ID_DUREE_LIBRE, libelle: 'Libre' }];

const CHAMPS = {
  // Contrat
  numeropolice: { libelle: 'Numéro de police' },
  numero_police_compagnie: { libelle: 'Police compagnie' },
  numeroavenant: { libelle: 'Numéro d’avenant' },
  numero_avenant_compagnie: { libelle: 'Avenant compagnie' },
  numero_facture: { libelle: 'Numéro de facture' },
  referenceagent: { libelle: 'Référence agent' },
  numero_police_connexe: { libelle: 'Police connexe' },
  id_police_pegas: { libelle: 'Identifiant PEGAS' },
  idclient: { libelle: 'Souscripteur', type: 'client' },
  idassure: { libelle: 'Assuré', type: 'client' },
  assure: { libelle: 'Nom de l’assuré (texte)' },
  idcompagnie: { libelle: 'Compagnie', type: 'choix', ref: 'compagnies' },
  idaperiteur: { libelle: 'Apériteur', type: 'choix', ref: 'compagnies' },
  coassurance: { libelle: 'Coassurance', type: 'bool' },
  flotte: { libelle: 'Contrat flotte', type: 'bool' },
  dateemission: { libelle: 'Date d’émission', type: 'date' },
  dateeffet: { libelle: 'Date d’effet', type: 'date' },
  dateexpiration: { libelle: 'Date d’échéance', type: 'date' },
  heuredebut: { libelle: 'Heure de début', type: 'dateheure' },
  idduree: { libelle: 'Durée', type: 'choix', options: DUREES },
  idterme: { libelle: 'Terme', type: 'choix', options: TERMES_CONTRAT },
  periode: { libelle: 'Période (code)' },
  echeance: { libelle: 'Échéance (code)' },
  nbreche: { libelle: 'Nombre d’échéances', type: 'nombre' },
  renouvelable: { libelle: 'Renouvelable', type: 'bool' },
  anticipation: { libelle: 'Anticipation', type: 'bool' },
  transfere: { libelle: 'Transféré', type: 'bool' },
  primeannuelle: { libelle: 'Prime annuelle', type: 'montant' },
  primenette: { libelle: 'Prime nette', type: 'montant' },
  accessoire: { libelle: 'Accessoires', type: 'montant' },
  accessoirecompagnie: { libelle: 'Accessoires compagnie', type: 'montant' },
  accessoireintermediaire: { libelle: 'Accessoires intermédiaire', type: 'montant' },
  accessoiregestionnaire: { libelle: 'Accessoires gestionnaire', type: 'montant' },
  taxe: { libelle: 'Taxe', type: 'montant' },
  fga: { libelle: 'FGA', type: 'montant' },
  cedeao: { libelle: 'CEDEAO', type: 'montant' },
  primettc: { libelle: 'Prime TTC', type: 'montant' },
  bonus_malus: { libelle: 'Bonus-malus', type: 'nombre' },
  prime_imposee: { libelle: 'Prime imposée', type: 'bool' },
  taux_commission: { libelle: 'Taux de commission', type: 'taux' },
  commissionintermediaire: { libelle: 'Commission intermédiaire', type: 'montant' },
  commissiongestionnaire: { libelle: 'Commission gestionnaire', type: 'montant' },
  commissionaperiteur: { libelle: 'Commission apériteur', type: 'montant' },
  observation: { libelle: 'Observation', type: 'zone' },
  motifannulation: { libelle: 'Motif d’annulation', type: 'zone' },
  // Risque / véhicule
  matricule: { libelle: 'Immatriculation' },
  idmarque: { libelle: 'Marque', type: 'choix', ref: 'marques' },
  modelevehicule: { libelle: 'Modèle' },
  idgenrevehicule: { libelle: 'Genre', type: 'choix', ref: 'genres' },
  idtypevehicule: { libelle: 'Type', type: 'choix', ref: 'types' },
  typevehicule: { libelle: 'Type (ancien texte)' },
  idcarrosserie: { libelle: 'Carrosserie', type: 'choix', ref: 'carrosseries' },
  codecarburant: { libelle: 'Énergie (code)' },
  puissancefiscale: { libelle: 'Puissance fiscale', type: 'nombre' },
  nombreplace: { libelle: 'Nombre de places', type: 'nombre' },
  chargeutile: { libelle: 'Charge utile', type: 'nombre' },
  datemec: { libelle: 'Première mise en circulation', type: 'date' },
  numchassis: { libelle: 'Numéro de châssis' },
  nummoteur: { libelle: 'Numéro de moteur' },
  valeurneuve: { libelle: 'Valeur à neuf', type: 'montant' },
  valeurvenale: { libelle: 'Valeur vénale', type: 'montant' },
  valeuraccessoire: { libelle: 'Valeur des accessoires', type: 'montant' },
  idtarif: { libelle: 'Catégorie', type: 'choix', ref: 'tarifs' },
  idoffre: { libelle: 'Offre', type: 'choix', ref: 'offres' },
  idusage: { libelle: 'Usage', type: 'choix', ref: 'usages' },
  codeusage: { libelle: 'Code usage' },
  reference: { libelle: 'Référence' },
  taux_reduction: { libelle: 'Réduction commerciale', type: 'taux' },
  taxeenregistrement: { libelle: 'Taxe', type: 'montant' },
  mt_delegation: { libelle: 'Montant délégation', type: 'montant' },
  conducteur: { libelle: 'Conducteur' },
  sexe: { libelle: 'Sexe', type: 'choix', options: SEXES, texte: true },
  datenaicnd: { libelle: 'Date de naissance', type: 'date' },
  idprofession: { libelle: 'Profession', type: 'choix', ref: 'professions' },
  permis: { libelle: 'Numéro de permis' },
  typepermis: { libelle: 'Catégories de permis' },
  adressecnd: { libelle: 'Adresse' },
  villecnd: { libelle: 'Ville' },
  remorque: { libelle: 'Remorque attelée', type: 'bool' },
  matrem1: { libelle: 'Immatriculation remorque 1' },
  matrem2: { libelle: 'Immatriculation remorque 2' },
  extincteur: { libelle: 'Extincteur', type: 'bool' },
  nbreextinteur: { libelle: 'Nombre d’extincteurs', type: 'nombre' },
  attestation: { libelle: 'Numéro d’attestation' },
  attestationprov: { libelle: 'Attestation provisoire' },
  carteverte: { libelle: 'Carte verte', type: 'bool' },
  numcarteverte: { libelle: 'Numéro de carte verte' },
  // Garantie
  idgarantie: { libelle: 'Garantie', type: 'choix', ref: 'garanties' },
  acquise: { libelle: 'Acquise', type: 'bool' },
  capital: { libelle: 'Capital', type: 'montant' },
  franchise: { libelle: 'Franchise', type: 'montant' },
  textefranchise: { libelle: 'Franchise (texte)' },
  minfranchise: { libelle: 'Franchise minimum', type: 'montant' },
  maxfranchise: { libelle: 'Franchise maximum', type: 'montant' },
  tauxfranchise: { libelle: 'Taux de franchise', type: 'taux' },
  deces: { libelle: 'Capital décès', type: 'montant' },
  ipp: { libelle: 'Capital IPP', type: 'montant' },
  fraismed: { libelle: 'Frais médicaux', type: 'montant' },
  hosp: { libelle: 'Hospitalisation', type: 'montant' },
  Formule: { libelle: 'Formule', type: 'nombre' },
};

const GROUPES_CONTRAT = [
  { titre: 'Références', champs: ['numeropolice', 'numero_police_compagnie', 'numeroavenant', 'numero_avenant_compagnie', 'numero_facture', 'referenceagent', 'numero_police_connexe', 'id_police_pegas'] },
  { titre: 'Parties', champs: ['idclient', 'idassure', 'assure', 'idcompagnie', 'idaperiteur', 'coassurance', 'flotte'] },
  { titre: 'Période', champs: ['dateemission', 'dateeffet', 'dateexpiration', 'heuredebut', 'idduree', 'idterme', 'nbreche', 'periode', 'echeance', 'renouvelable', 'anticipation', 'transfere'] },
  { titre: 'Primes', champs: ['primeannuelle', 'primenette', 'accessoire', 'accessoirecompagnie', 'accessoireintermediaire', 'accessoiregestionnaire', 'taxe', 'fga', 'cedeao', 'primettc', 'bonus_malus', 'prime_imposee'] },
  { titre: 'Commissions', champs: ['taux_commission', 'commissionintermediaire', 'commissiongestionnaire', 'commissionaperiteur'] },
  { titre: 'Observations', champs: ['observation', 'motifannulation'] },
];
const GROUPES_VEHICULE = [
  { titre: 'Véhicule', champs: ['matricule', 'idmarque', 'modelevehicule', 'idgenrevehicule', 'idtypevehicule', 'idcarrosserie', 'codecarburant', 'puissancefiscale', 'nombreplace', 'chargeutile', 'datemec', 'numchassis', 'nummoteur'] },
  { titre: 'Valeurs', champs: ['valeurneuve', 'valeurvenale', 'valeuraccessoire'] },
  { titre: 'Tarification', champs: ['idtarif', 'idoffre', 'idusage', 'codeusage', 'taux_reduction', 'primeannuelle', 'primenette', 'taxeenregistrement', 'fga'] },
  { titre: 'Conducteur', champs: ['conducteur', 'sexe', 'datenaicnd', 'idprofession', 'permis', 'typepermis', 'adressecnd', 'villecnd'] },
  { titre: 'Remorque, équipements et attestation', champs: ['remorque', 'matrem1', 'matrem2', 'extincteur', 'nbreextinteur', 'attestation', 'attestationprov', 'carteverte', 'numcarteverte'] },
  { titre: 'Observations', champs: ['observation'] },
];
const GROUPES_RISQUE = [
  { titre: 'Objet assuré', champs: ['idassure', 'assure', 'matricule', 'reference', 'sexe', 'datenaicnd', 'idprofession'] },
  { titre: 'Tarification', champs: ['idtarif', 'idoffre', 'taux_reduction', 'primeannuelle', 'primenette', 'taxeenregistrement'] },
  { titre: 'Observations', champs: ['observation'] },
];
const COLONNES_GARANTIE = ['acquise', 'capital', 'primeannuelle', 'primenette', 'taxe', 'textefranchise'];
const EXCLUS = { contrat: ['idcontrat'], detail: ['idcontratdetail', 'idcontrat', 'garanties'], garantie: ['idcontratdetgarantie', 'idcontratdetail'] };

const CLES_BOOLS = new Set(['transfere', 'anticipation', 'auteur', 'pc_control', 'cg_control']);
const libelleGenerique = (cle) => cle
  .replace(/_/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/^\w/, (lettre) => lettre.toUpperCase());
const typeDeduit = (cle) => {
  if (CLES_BOOLS.has(cle)) return 'bool';
  if (/^date/.test(cle)) return 'date';
  if (/^(id|nb|nbre|nombre)/.test(cle)) return 'nombre';
  if (/^(prime|taxe|fga|cedeao|accessoire|commission|capital|valeur|mt_)/.test(cle)) return 'montant';
  return 'texte';
};
const definition = (cle) => ({ type: 'texte', ...(CHAMPS[cle] || { libelle: libelleGenerique(cle), type: typeDeduit(cle) }) });
const optionsChamp = (def, referentiels) => def.options || referentiels?.[def.ref] || [];

// Valeur comparable : « 294286.0000 » et « 294286 » sont la même prime, une date ne compte que par son jour
const normaliser = (type, valeur) => {
  if (type === 'bool') return Boolean(valeur);
  if (valeur === null || valeur === undefined || valeur === '') return null;
  if (type === 'date') return String(valeur).slice(0, 10);
  if (type === 'dateheure') return String(valeur).slice(0, 16);
  if (['montant', 'nombre', 'taux', 'client'].includes(type)) {
    const n = Number(valeur);
    return Number.isFinite(n) ? n : String(valeur);
  }
  return String(valeur);
};
const memeValeur = (cle, a, b) => {
  const { type } = definition(cle);
  return normaliser(type, a) === normaliser(type, b);
};
const clesModifiees = (courant, initial, exclus) => Object.keys(courant || {})
  .filter((cle) => !exclus.includes(cle) && !memeValeur(cle, courant[cle], initial?.[cle]));

const afficherValeur = (cle, valeur, referentiels, noms) => {
  const def = definition(cle);
  if (def.type === 'bool') return valeur ? 'Oui' : 'Non';
  if (valeur === null || valeur === undefined || valeur === '') return 'vide';
  if (def.type === 'date') return dateFr(valeur);
  if (def.type === 'dateheure') return `${dateFr(valeur)} ${String(valeur).slice(11, 16)}`;
  if (def.type === 'montant') return montant(valeur);
  if (def.type === 'taux') return `${Number(valeur).toLocaleString('fr-FR')} %`;
  if (def.type === 'nombre') return Number.isFinite(Number(valeur)) ? Number(valeur).toLocaleString('fr-FR') : String(valeur);
  if (def.type === 'choix') {
    const option = optionsChamp(def, referentiels).find((o) => String(o.id) === String(valeur));
    return option ? option.libelle : `N° ${valeur}`;
  }
  if (def.type === 'client') return noms?.[String(valeur)] ? `${noms[String(valeur)]} - n° ${valeur}` : `N° ${valeur}`;
  return String(valeur);
};

// ------------------------------------------------------------------ saisie d'un champ
const ChampSaisie = ({ cle, valeur, onChange, referentiels, compact = false }) => {
  const def = definition(cle);
  const commun = { className: 'form-control', 'aria-label': compact ? def.libelle : undefined };
  if (def.type === 'bool') {
    return <input type="checkbox" checked={Boolean(valeur)} onChange={(e) => onChange(e.target.checked)} aria-label={def.libelle} />;
  }
  if (def.type === 'choix') {
    const options = optionsChamp(def, referentiels);
    const connue = options.some((o) => String(o.id) === String(valeur));
    return (
      <select
        {...commun}
        value={valeur === null || valeur === undefined ? '' : String(valeur)}
        onChange={(e) => {
          const brute = e.target.value;
          if (brute === '') onChange(null);
          else onChange(def.texte ? brute : Number(brute));
        }}
      >
        <option value="">Non renseigné</option>
        {!connue && valeur !== null && valeur !== undefined && valeur !== '' && (
          <option value={String(valeur)}>{`N° ${valeur} - inconnu`}</option>
        )}
        {options.map((o) => <option key={o.id} value={String(o.id)}>{o.libelle}</option>)}
      </select>
    );
  }
  if (def.type === 'date') {
    return (
      <input {...commun} type="date" value={valeur ? String(valeur).slice(0, 10) : ''}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}T00:00:00` : null)} />
    );
  }
  if (def.type === 'dateheure') {
    return (
      <input {...commun} type="datetime-local" value={valeur ? String(valeur).slice(0, 16) : ''}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}:00` : null)} />
    );
  }
  if (['montant', 'nombre', 'taux', 'client'].includes(def.type)) {
    const n = Number(valeur);
    return (
      <input {...commun} type="number" step="any" inputMode="decimal"
        value={valeur === null || valeur === undefined || valeur === '' ? '' : (Number.isFinite(n) ? n : valeur)}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} />
    );
  }
  if (def.type === 'zone') {
    return <textarea {...commun} rows={2} value={valeur ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input {...commun} type="text" value={valeur ?? ''} onChange={(e) => onChange(e.target.value === '' && valeur === null ? null : e.target.value)} />;
};

const Champ = ({ cle, valeur, initiale, onChange, referentiels, noms }) => {
  const def = definition(cle);
  const modifie = !memeValeur(cle, valeur, initiale);
  const precision = def.type === 'client' && noms?.[String(valeur)] ? noms[String(valeur)] : null;
  return (
    <div className={`admin-champ admin-champ-${def.type}${modifie ? ' admin-champ-modifie' : ''}`}>
      <label>
        <span className="admin-champ-libelle">{def.libelle}</span>
        <ChampSaisie cle={cle} valeur={valeur} onChange={onChange} referentiels={referentiels} />
      </label>
      {precision && <span className="admin-champ-precision">{precision}</span>}
      {modifie && (
        <span className="admin-champ-avant">
          Avant : {afficherValeur(cle, initiale, referentiels, noms)}
          <button type="button" onClick={() => onChange(initiale)} title="Rétablir la valeur d’origine">
            <RotateCcw size={11} /> Rétablir
          </button>
        </span>
      )}
    </div>
  );
};

const GroupeChamps = ({ titre, cles, valeurs, initiales, onChange, referentiels, noms }) => {
  const presentes = cles.filter((cle) => cle in (valeurs || {}));
  if (!presentes.length) return null;
  const modifies = presentes.filter((cle) => !memeValeur(cle, valeurs[cle], initiales?.[cle])).length;
  return (
    <fieldset className="admin-groupe">
      <legend>
        {titre}
        {modifies > 0 && <span className="admin-pastille">{modifies}</span>}
      </legend>
      <div className="admin-groupe-champs">
        {presentes.map((cle) => (
          <Champ key={cle} cle={cle} valeur={valeurs[cle]} initiale={initiales?.[cle]} referentiels={referentiels} noms={noms}
            onChange={(v) => onChange(cle, v)} />
        ))}
      </div>
    </fieldset>
  );
};

// Champs que les groupes ne montrent pas (identifiants techniques, historique, colonnes ajoutées plus tard)
const AutresChamps = ({ groupes, exclus, valeurs, initiales, onChange, referentiels, noms }) => {
  const rangees = new Set(groupes.flatMap((g) => g.champs));
  const cles = Object.keys(valeurs || {}).filter((cle) => !rangees.has(cle) && !exclus.includes(cle));
  if (!cles.length) return null;
  const modifies = cles.filter((cle) => !memeValeur(cle, valeurs[cle], initiales?.[cle])).length;
  return (
    <details className="admin-autres" open={modifies > 0 || undefined}>
      <summary>
        Autres champs et identifiants techniques · {cles.length}
        {modifies > 0 && <span className="admin-pastille">{modifies}</span>}
      </summary>
      <div className="admin-groupe-champs">
        {cles.map((cle) => (
          <Champ key={cle} cle={cle} valeur={valeurs[cle]} initiale={initiales?.[cle]} referentiels={referentiels} noms={noms}
            onChange={(v) => onChange(cle, v)} />
        ))}
      </div>
    </details>
  );
};

// ------------------------------------------------------------------ garanties d'un risque
const TableGaranties = ({ garanties, initiales, onChange, referentiels, noms, primeRisque }) => {
  const [ouverte, setOuverte] = useState(null);
  const libelle = (g) => afficherValeur('idgarantie', g.idgarantie, referentiels, noms);
  const acquises = garanties.filter((g) => g.acquise);
  const somme = (cle) => acquises.reduce((total, g) => total + (Number(g[cle]) || 0), 0);
  const ecart = Math.round(somme('primenette') - (Number(primeRisque) || 0));
  if (!garanties.length) return <p className="admin-vide">Aucune garantie enregistrée pour ce risque.</p>;
  return (
    <div className="admin-garanties">
      <div className="table-wrapper">
        <table className="data-table admin-garanties-table">
          <thead>
            <tr>
              <th>Garantie</th>
              {COLONNES_GARANTIE.map((cle) => <th key={cle} className={`admin-col-${cle}${definition(cle).type === 'montant' ? ' droite' : ''}`}>{definition(cle).libelle}</th>)}
            </tr>
          </thead>
          <tbody>
            {garanties.map((g, index) => {
              const initiale = initiales.find((x) => x.idcontratdetgarantie === g.idcontratdetgarantie) || {};
              const modifies = clesModifiees(g, initiale, EXCLUS.garantie);
              const autres = Object.keys(g).filter((cle) => !COLONNES_GARANTIE.includes(cle) && !EXCLUS.garantie.includes(cle));
              return (
                <React.Fragment key={g.idcontratdetgarantie}>
                  <tr className={`${g.acquise ? '' : 'admin-garantie-non-acquise'}${modifies.length ? ' admin-ligne-modifiee' : ''}`}>
                    <td className="admin-garantie-nom">
                      <button type="button" className="admin-bouton-icone" aria-expanded={ouverte === g.idcontratdetgarantie}
                        onClick={() => setOuverte(ouverte === g.idcontratdetgarantie ? null : g.idcontratdetgarantie)}
                        title="Franchises, capitaux et autres champs" aria-label={`Autres champs de ${libelle(g)}`}>
                        <ChevronDown size={15} style={{ transform: ouverte === g.idcontratdetgarantie ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
                      </button>
                      <span>{libelle(g)}</span>
                    </td>
                    {COLONNES_GARANTIE.map((cle) => {
                      const modifie = !memeValeur(cle, g[cle], initiale[cle]);
                      return (
                        <td key={cle} className={`admin-col-${cle}${modifie ? ' admin-cellule-modifiee' : ''}`}
                          title={modifie ? `Avant : ${afficherValeur(cle, initiale[cle], referentiels, noms)}` : undefined}>
                          <ChampSaisie cle={cle} valeur={g[cle]} compact referentiels={referentiels}
                            onChange={(v) => onChange(index, cle, v)} />
                        </td>
                      );
                    })}
                  </tr>
                  {ouverte === g.idcontratdetgarantie && (
                    <tr className="admin-garantie-details">
                      <td colSpan={COLONNES_GARANTIE.length + 1}>
                        <div className="admin-groupe-champs">
                          {autres.map((cle) => (
                            <Champ key={cle} cle={cle} valeur={g[cle]} initiale={initiale[cle]} referentiels={referentiels} noms={noms}
                              onChange={(v) => onChange(index, cle, v)} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Garanties acquises · {acquises.length}</td>
              <td />
              <td />
              <td className="droite">{montant(somme('primeannuelle'))}</td>
              <td className="droite">{montant(somme('primenette'))}</td>
              <td className="droite">{montant(somme('taxe'))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={`admin-controle${ecart ? ' ecart' : ''}`}>
        {ecart
          ? <><AlertTriangle size={14} /> Les primes nettes des garanties acquises ({montant(somme('primenette'))}) diffèrent de la prime nette du risque ({montant(primeRisque)}) de {montant(Math.abs(ecart))}.</>
          : <>Les primes nettes des garanties acquises correspondent à la prime nette du risque ({montant(primeRisque)}).</>}
      </p>
    </div>
  );
};

// ------------------------------------------------------------------ éditeur d'un contrat
const libelleRisque = (detail, index, auto, referentiels, noms) => {
  if (auto) {
    const marque = detail.idmarque ? afficherValeur('idmarque', detail.idmarque, referentiels, noms) : '';
    return [detail.matricule || `Véhicule ${index + 1}`, marque && !marque.startsWith('N°') ? marque : ''].filter(Boolean).join(' - ');
  }
  return noms?.[String(detail.idassure)] || detail.assure || detail.matricule || `Risque ${index + 1}`;
};

const messageErreurAdministration = (error, nomRisque) => {
  const data = error?.response?.data;
  if (!data || typeof data !== 'object' || data.error || data.detail) return messageErreurApi(error);
  const lignes = [];
  const texte = (valeur) => [].concat(valeur).map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' ');
  const champs = (prefixe, erreurs) => Object.entries(erreurs).forEach(([cle, valeur]) => {
    lignes.push(`${prefixe}${definition(cle).libelle} : ${texte(valeur)}`);
  });
  Object.entries(data).forEach(([cle, valeur]) => {
    if ((cle === 'details' || cle === 'garanties') && valeur && typeof valeur === 'object' && !Array.isArray(valeur)) {
      Object.entries(valeur).forEach(([id, erreurs]) => {
        const prefixe = cle === 'details' ? `${nomRisque(id)}, ` : 'Garantie, ';
        if (erreurs && typeof erreurs === 'object' && !Array.isArray(erreurs)) champs(prefixe, erreurs);
        else lignes.push(`${prefixe}${texte(erreurs)}`);
      });
    } else if (cle === 'details' || cle === 'garanties') {
      lignes.push(texte(valeur));
    } else {
      lignes.push(`${definition(cle).libelle} : ${texte(valeur)}`);
    }
  });
  return lignes.join(' ; ') || messageErreurApi(error);
};

const EditeurContrat = ({ donnees, onEnregistre, onFermer }) => {
  const { success, error: toastError } = useToast();
  const [initial, setInitial] = useState(donnees);
  const [edition, setEdition] = useState(donnees);
  const [onglet, setOnglet] = useState('contrat');
  const [indexRisque, setIndexRisque] = useState(0);
  const [filtreRisques, setFiltreRisques] = useState('');
  const [motif, setMotif] = useState('');
  const [enregistrement, setEnregistrement] = useState(false);

  const { contexte = {}, referentiels = {} } = edition;
  const noms = contexte.Noms || {};
  const auto = Number(contexte.IdProduit) === ID_PRODUIT_AUTO;
  const groupesRisque = auto ? GROUPES_VEHICULE : GROUPES_RISQUE;
  const contrat = edition.contrat;
  const details = edition.details || [];
  const detailInitial = (detail) => initial.details.find((d) => d.idcontratdetail === detail.idcontratdetail) || {};

  const changements = useMemo(() => {
    const liste = [];
    clesModifiees(edition.contrat, initial.contrat, EXCLUS.contrat).forEach((cle) => liste.push({
      nature: 'contrat', element: 'Contrat', cle, avant: initial.contrat[cle], apres: edition.contrat[cle],
    }));
    (edition.details || []).forEach((detail, index) => {
      const avant = initial.details.find((d) => d.idcontratdetail === detail.idcontratdetail) || {};
      const nom = libelleRisque(detail, index, auto, referentiels, noms);
      clesModifiees(detail, avant, EXCLUS.detail).forEach((cle) => liste.push({
        nature: 'detail', element: nom, cle, avant: avant[cle], apres: detail[cle], index,
      }));
      (detail.garanties || []).forEach((g) => {
        const gAvant = (avant.garanties || []).find((x) => x.idcontratdetgarantie === g.idcontratdetgarantie) || {};
        const nomGarantie = afficherValeur('idgarantie', gAvant.idgarantie ?? g.idgarantie, referentiels, noms);
        clesModifiees(g, gAvant, EXCLUS.garantie).forEach((cle) => liste.push({
          nature: 'garantie', element: `${nom} · ${nomGarantie}`, cle, avant: gAvant[cle], apres: g[cle], index,
          idGarantie: g.idcontratdetgarantie,
        }));
      });
    });
    return liste;
  }, [edition, initial, auto, referentiels, noms]);

  const nbContrat = changements.filter((c) => c.nature === 'contrat').length;
  const nbRisques = changements.length - nbContrat;
  const modificationsRisque = (index) => changements.filter((c) => c.index === index).length;

  // Saisie non enregistrée : le navigateur prévient avant de quitter la page
  useEffect(() => {
    if (!changements.length) return undefined;
    const avertir = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', avertir);
    return () => window.removeEventListener('beforeunload', avertir);
  }, [changements.length]);

  const modifierContrat = (cle, valeur) => setEdition((e) => ({ ...e, contrat: { ...e.contrat, [cle]: valeur } }));
  const modifierDetail = (index, cle, valeur) => setEdition((e) => ({
    ...e, details: e.details.map((d, i) => (i === index ? { ...d, [cle]: valeur } : d)),
  }));
  const modifierGarantie = (index, indexGarantie, cle, valeur) => setEdition((e) => ({
    ...e,
    details: e.details.map((d, i) => (i !== index ? d : {
      ...d, garanties: d.garanties.map((g, j) => (j === indexGarantie ? { ...g, [cle]: valeur } : g)),
    })),
  }));

  // Une ligne du récapitulatif revient à sa valeur enregistrée
  const retablir = (c) => setEdition((e) => {
    if (c.nature === 'contrat') return { ...e, contrat: { ...e.contrat, [c.cle]: c.avant } };
    return {
      ...e,
      details: e.details.map((d, i) => {
        if (i !== c.index) return d;
        if (c.nature === 'detail') return { ...d, [c.cle]: c.avant };
        return { ...d, garanties: d.garanties.map((g) => (g.idcontratdetgarantie === c.idGarantie ? { ...g, [c.cle]: c.avant } : g)) };
      }),
    };
  });

  const fermer = async () => {
    if (changements.length && !(await confirmer({
      ton: 'attention',
      titre: 'Quitter sans enregistrer ?',
      message: `${changements.length} modification${changements.length > 1 ? 's' : ''} non enregistrée${changements.length > 1 ? 's' : ''} ser${changements.length > 1 ? 'ont' : 'a'} perdue${changements.length > 1 ? 's' : ''}.`,
      confirmer: 'Quitter sans enregistrer',
      annuler: 'Continuer la saisie',
    }))) return;
    onFermer();
  };

  const toutAnnuler = async () => {
    if (!(await confirmer({
      ton: 'attention',
      titre: 'Annuler les modifications ?',
      message: 'Toutes les valeurs reviennent à celles enregistrées.',
      confirmer: 'Annuler les modifications',
      annuler: 'Garder mes modifications',
    }))) return;
    setEdition(initial);
  };

  const enregistrer = async () => {
    const idContrat = Number(contrat?.idcontrat);
    if (!Number.isSafeInteger(idContrat) || idContrat <= 0) {
      toastError('Le contrat ne possède pas d’identifiant valide. Fermez-le puis ouvrez-le à nouveau.');
      return;
    }
    if (motif.trim().length < 5) {
      toastError('Indiquez le motif de la modification (5 caractères au moins).');
      return;
    }
    const payload = {
      contrat: Object.fromEntries(clesModifiees(edition.contrat, initial.contrat, EXCLUS.contrat).map((cle) => [cle, edition.contrat[cle]])),
      details: details.flatMap((detail) => {
        const avant = detailInitial(detail);
        const champsDetail = Object.fromEntries(clesModifiees(detail, avant, EXCLUS.detail).map((cle) => [cle, detail[cle]]));
        const garanties = (detail.garanties || []).flatMap((g) => {
          const gAvant = (avant.garanties || []).find((x) => x.idcontratdetgarantie === g.idcontratdetgarantie);
          if (!gAvant) return [];
          const champsGarantie = Object.fromEntries(clesModifiees(g, gAvant, EXCLUS.garantie).map((cle) => [cle, g[cle]]));
          return Object.keys(champsGarantie).length ? [{ ...champsGarantie, idcontratdetgarantie: g.idcontratdetgarantie }] : [];
        });
        if (!Object.keys(champsDetail).length && !garanties.length) return [];
        return [{ ...champsDetail, idcontratdetail: detail.idcontratdetail, garanties }];
      }),
    };
    setEnregistrement(true);
    try {
      const resultat = await contractApi.updateAdministrationContract(idContrat, payload, motif.trim());
      setInitial(resultat);
      setEdition(resultat);
      setMotif('');
      setOnglet('contrat');
      success(`${changements.length} modification${changements.length > 1 ? 's' : ''} enregistrée${changements.length > 1 ? 's' : ''} et journalisée${changements.length > 1 ? 's' : ''} avec le motif.`);
      onEnregistre();
    } catch (error) {
      const nomRisque = (id) => {
        const index = details.findIndex((d) => String(d.idcontratdetail) === String(id));
        return index >= 0 ? libelleRisque(details[index], index, auto, referentiels, noms) : `Risque ${id}`;
      };
      toastError(`Les modifications n’ont pas été enregistrées : ${messageErreurAdministration(error, nomRisque)}`);
    } finally {
      setEnregistrement(false);
    }
  };

  const risquesFiltres = details
    .map((detail, index) => ({ detail, index, nom: libelleRisque(detail, index, auto, referentiels, noms) }))
    .filter(({ nom }) => !filtreRisques.trim() || nom.toLowerCase().includes(filtreRisques.trim().toLowerCase()));
  const risque = details[indexRisque];
  const quittance = contexte.Quittance;
  const police = contrat.numeropolice || contrat.numero_police_compagnie || `Contrat ${contrat.idcontrat}`;

  const onglets = [
    { cle: 'contrat', libelle: 'Contrat', compte: nbContrat, icone: FileText },
    { cle: 'risques', libelle: `${auto ? 'Véhicules' : 'Risques'} et garanties · ${details.length}`, compte: nbRisques, icone: auto ? Car : Shield },
    { cle: 'verification', libelle: 'Vérifier et enregistrer', compte: changements.length, icone: ClipboardCheck },
  ];

  return (
    <div className="admin-editeur">
      <header className="admin-editeur-entete">
        <button type="button" className="btn btn-secondary" onClick={fermer}>
          <ArrowLeft size={15} /> Retour à la liste
        </button>
        <div className="admin-editeur-titre">
          <span className="admin-contrats-summary-label">Administration du contrat</span>
          <h1>{police}</h1>
        </div>
        <div className="admin-editeur-badges">
          {contexte.Mouvement && <StatusBadge label={contexte.Mouvement.toLowerCase().replace(/^\w/, (l) => l.toUpperCase())} color="blue" />}
          {contexte.Annule && <StatusBadge label="Contrat annulé" color="rose" />}
        </div>
      </header>

      <section className="admin-contrats-summary admin-editeur-resume" aria-label="Résumé du contrat">
        <div className="admin-contrats-summary-item">
          <span>Souscripteur</span>
          <strong title={contexte.Client}>{contexte.Client || '-'}</strong>
        </div>
        <div className="admin-contrats-summary-item">
          <span>Produit · Compagnie</span>
          <strong title={`${contexte.Produit} - ${contexte.Compagnie}`}>{contexte.Produit || '-'} · {contexte.Compagnie || '-'}</strong>
        </div>
        <div className="admin-contrats-summary-item">
          <span>Période</span>
          <strong>{dateFr(initial.contrat.dateeffet)} au {dateFr(initial.contrat.dateexpiration)}</strong>
        </div>
        <div className="admin-contrats-summary-item">
          <span>Prime TTC du contrat</span>
          <strong>{montant(initial.contrat.primettc)}</strong>
        </div>
        <div className="admin-contrats-summary-item">
          <span>Quittance {quittance?.Numero || ''}</span>
          <strong>{quittance ? `${montant(quittance.PrimeTtc)} · encaissé ${montant(quittance.Encaisse)}` : 'Aucune'}</strong>
        </div>
      </section>

      <div className="admin-contrats-warning">
        <AlertTriangle size={17} style={{ color: 'var(--accent-amber)' }} />
        <span>
          Correction administrative : aucun avenant n’est créé et la quittance liée n’est pas recalculée
          {quittance ? ` (${quittance.Numero}, reste à encaisser ${montant(quittance.Reste)})` : ''}.
          Chaque enregistrement est journalisé avec son motif et les valeurs avant / après.
        </span>
      </div>

      <nav className="admin-onglets" role="tablist" aria-label="Parties du contrat">
        {onglets.map(({ cle, libelle, compte, icone: Icone }) => (
          <button key={cle} type="button" role="tab" aria-selected={onglet === cle}
            className={`admin-onglet${onglet === cle ? ' actif' : ''}`} onClick={() => setOnglet(cle)}>
            <Icone size={15} /> {libelle}
            {compte > 0 && <span className="admin-pastille">{compte}</span>}
          </button>
        ))}
      </nav>

      {onglet === 'contrat' && (
        <section className="admin-panneau" role="tabpanel" aria-label="Contrat">
          {GROUPES_CONTRAT.map((groupe) => (
            <GroupeChamps key={groupe.titre} titre={groupe.titre} cles={groupe.champs} valeurs={contrat} initiales={initial.contrat}
              onChange={modifierContrat} referentiels={referentiels} noms={noms} />
          ))}
          <AutresChamps groupes={GROUPES_CONTRAT} exclus={EXCLUS.contrat} valeurs={contrat} initiales={initial.contrat}
            onChange={modifierContrat} referentiels={referentiels} noms={noms} />
        </section>
      )}

      {onglet === 'risques' && (
        <section className="admin-panneau admin-risques" role="tabpanel" aria-label="Risques et garanties">
          {!details.length ? (
            <p className="admin-vide">Ce contrat n’a aucun risque enregistré.</p>
          ) : (
            <>
              <aside className="admin-risques-liste" aria-label={auto ? 'Véhicules' : 'Risques'}>
                {details.length > 6 && (
                  <div className="admin-risques-recherche">
                    <Search size={14} aria-hidden="true" />
                    <input type="search" className="form-control" value={filtreRisques} onChange={(e) => setFiltreRisques(e.target.value)}
                      placeholder={auto ? 'Immatriculation, marque…' : 'Nom, référence…'} aria-label="Filtrer la liste" />
                  </div>
                )}
                <ul>
                  {risquesFiltres.map(({ detail, index, nom }) => (
                    <li key={detail.idcontratdetail}>
                      <button type="button" className={`admin-risque${index === indexRisque ? ' actif' : ''}`} onClick={() => setIndexRisque(index)}
                        aria-current={index === indexRisque ? 'true' : undefined}>
                        <span className="admin-risque-nom">{nom}</span>
                        <span className="admin-risque-prime">{montant(detail.primenette)} · {(detail.garanties || []).filter((g) => g.acquise).length} garanties</span>
                        {modificationsRisque(index) > 0 && <span className="admin-pastille">{modificationsRisque(index)}</span>}
                      </button>
                    </li>
                  ))}
                  {!risquesFiltres.length && <li className="admin-vide">Aucun résultat.</li>}
                </ul>
              </aside>
              {risque && (
                <div className="admin-risque-detail">
                  <h2>{libelleRisque(risque, indexRisque, auto, referentiels, noms)}</h2>
                  {groupesRisque.map((groupe) => (
                    <GroupeChamps key={groupe.titre} titre={groupe.titre} cles={groupe.champs} valeurs={risque} initiales={detailInitial(risque)}
                      onChange={(cle, v) => modifierDetail(indexRisque, cle, v)} referentiels={referentiels} noms={noms} />
                  ))}
                  <fieldset className="admin-groupe">
                    <legend>Garanties · {(risque.garanties || []).length}</legend>
                    <TableGaranties garanties={risque.garanties || []} initiales={detailInitial(risque).garanties || []}
                      primeRisque={risque.primenette} referentiels={referentiels} noms={noms}
                      onChange={(indexGarantie, cle, v) => modifierGarantie(indexRisque, indexGarantie, cle, v)} />
                  </fieldset>
                  <AutresChamps groupes={groupesRisque} exclus={EXCLUS.detail} valeurs={risque} initiales={detailInitial(risque)}
                    onChange={(cle, v) => modifierDetail(indexRisque, cle, v)} referentiels={referentiels} noms={noms} />
                </div>
              )}
            </>
          )}
        </section>
      )}

      {onglet === 'verification' && (
        <section className="admin-panneau" role="tabpanel" aria-label="Vérification">
          {!changements.length ? (
            <p className="admin-vide">Aucune modification pour l’instant : corrigez les champs dans les onglets Contrat ou {auto ? 'Véhicules' : 'Risques'} et garanties.</p>
          ) : (
            <>
              <div className="table-wrapper">
                <table className="data-table admin-recap">
                  <thead><tr><th>Élément</th><th>Champ</th><th>Avant</th><th>Après</th><th aria-label="Rétablir" /></tr></thead>
                  <tbody>
                    {changements.map((c) => (
                      <tr key={`${c.nature}-${c.index ?? ''}-${c.idGarantie ?? ''}-${c.cle}`}>
                        <td>{c.element}</td>
                        <td>{definition(c.cle).libelle}</td>
                        <td className="admin-recap-avant">{afficherValeur(c.cle, c.avant, referentiels, noms)}</td>
                        <td className="admin-recap-apres">{afficherValeur(c.cle, c.apres, referentiels, noms)}</td>
                        <td>
                          <button type="button" className="admin-bouton-icone" title="Rétablir la valeur d’origine" onClick={() => retablir(c)}>
                            <RotateCcw size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="admin-motif">
                <span>Motif de la correction (obligatoire, conservé au journal d’audit)</span>
                <textarea className="form-control" rows={3} value={motif} onChange={(e) => setMotif(e.target.value)}
                  placeholder="Ex. : immatriculation mal saisie à l’émission, valeur vénale corrigée selon la carte grise…" />
              </label>
            </>
          )}
        </section>
      )}

      <footer className="admin-barre-actions">
        <span className="admin-barre-compte">
          {changements.length
            ? `${changements.length} modification${changements.length > 1 ? 's' : ''} non enregistrée${changements.length > 1 ? 's' : ''}`
            : 'Aucune modification'}
        </span>
        <div>
          <button type="button" className="btn btn-secondary" onClick={toutAnnuler} disabled={!changements.length || enregistrement}>
            <RotateCcw size={15} /> Tout annuler
          </button>
          {onglet !== 'verification' ? (
            <button type="button" className="btn btn-primary" onClick={() => setOnglet('verification')} disabled={!changements.length}>
              <ClipboardCheck size={15} /> Vérifier les modifications
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={enregistrer}
              disabled={!changements.length || enregistrement || motif.trim().length < 5} aria-busy={enregistrement}>
              {enregistrement ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
              Enregistrer avec ce motif
            </button>
          )}
        </div>
      </footer>
    </div>
  );
};

// ------------------------------------------------------------------ page
export const AdminContractManagementPage = () => {
  const { error: toastError } = useToast();
  const [recherche, setRecherche] = useState('');
  const [rechercheAppliquee, setRechercheAppliquee] = useState('');
  const [page, setPage] = useState(1);
  const [taille, setTaille] = useState(TAILLE_PAGE);
  const [branche, setBranche] = useState('ALL');
  const [statut, setStatut] = useState('tous');
  const [ordre, setOrdre] = useState('');
  const [champPeriode, setChampPeriode] = useState('effet');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [liste, setListe] = useState({ results: [], count: 0, par_produit: {}, par_statut: {} });
  const [chargementListe, setChargementListe] = useState(true);
  const [contratOuvert, setContratOuvert] = useState(null);
  const [ouverture, setOuverture] = useState(null);

  const chargerListe = useCallback(async () => {
    setChargementListe(true);
    try {
      const filtres = {
        recherche: rechercheAppliquee || undefined,
        idproduit: BRANCHES.find((item) => item.cle === branche)?.produits?.join(','),
        statut: statut === 'tous' ? undefined : statut,
        [`${champPeriode}_du`]: du || undefined,
        [`${champPeriode}_au`]: au || undefined,
        ordre: ordre || undefined,
        page,
        page_size: taille,
      };
      const resultat = await contractApi.getAdministrationContracts(filtres);
      setListe(resultat);
    } catch (error) {
      toastError(`Les contrats n’ont pas pu être chargés : ${messageErreurApi(error)}`);
    } finally {
      setChargementListe(false);
    }
  }, [au, branche, champPeriode, du, ordre, page, rechercheAppliquee, statut, taille, toastError]);

  useEffect(() => {
    chargerListe();
  }, [chargerListe]);

  const ouvrirContrat = async (id) => {
    setOuverture(id);
    try {
      setContratOuvert(await contractApi.getAdministrationContract(id));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      toastError(`Le contrat n’a pas pu être ouvert : ${messageErreurApi(error)}`);
    } finally {
      setOuverture(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(liste.count / taille));
  const trier = (cle) => {
    const actif = ordre.replace(/^-/, '') === cle ? ordre : null;
    const decroissantDabord = ['effet', 'echeance', 'prime'].includes(cle);
    setOrdre(actif
      ? (actif.startsWith('-') ? cle : `-${cle}`)
      : (decroissantDabord ? `-${cle}` : cle));
    setPage(1);
  };
  const enteteTri = (cle, libelle, alignement = 'left') => {
    const actif = ordre.replace(/^-/, '') === cle;
    const Icone = !actif ? ArrowUpDown : ordre.startsWith('-') ? ArrowDown : ArrowUp;
    return (
      <th className={`triable${alignement === 'right' ? ' droite' : ''}`} aria-sort={actif ? (ordre.startsWith('-') ? 'descending' : 'ascending') : 'none'}>
        <button type="button" className="portefeuille-tri" onClick={() => trier(cle)} title="Trier">
          {libelle}<Icone size={12} style={{ opacity: actif ? 1 : 0.45 }} />
        </button>
      </th>
    );
  };
  const compteBranche = (item) => {
    if (!item.produits) return Object.values(liste.par_produit || {}).reduce((total, valeur) => total + Number(valeur), 0);
    return item.produits.reduce((total, id) => total + Number(liste.par_produit?.[String(id)] || 0), 0);
  };
  const compteStatut = (cle) => {
    if (cle === 'tous') return Object.entries(liste.par_statut || {})
      .filter(([statutCompte]) => statutCompte !== 'annule')
      .reduce((total, [, valeur]) => total + Number(valeur), 0);
    return Number(liste.par_statut?.[cle] || 0);
  };
  const filtresActifs = Boolean(rechercheAppliquee || du || au || branche !== 'ALL' || statut !== 'tous');
  const effacerFiltres = () => {
    setRecherche('');
    setRechercheAppliquee('');
    setDu('');
    setAu('');
    setBranche('ALL');
    setStatut('tous');
    setPage(1);
  };

  if (contratOuvert) {
    return (
      <div className="admin-contrats-page">
        <EditeurContrat
          key={contratOuvert.contrat.idcontrat}
          donnees={contratOuvert}
          onEnregistre={chargerListe}
          onFermer={() => setContratOuvert(null)}
        />
      </div>
    );
  }

  return (
    <div className="admin-contrats-page">
      <header className="admin-contrats-hero">
        <div className="admin-contrats-hero-copy">
          <div className="admin-contrats-eyebrow"><ShieldCheck size={14} /> Espace de gestion sécurisé</div>
          <h1>Administration des contrats</h1>
          <p>Corrigez un contrat, ses véhicules ou risques et leurs garanties. Chaque correction est justifiée par un motif et conservée dans le journal d’audit, avec les valeurs avant et après.</p>
        </div>
        <div className="admin-contrats-hero-actions">
          <div className="admin-contrats-audit">
            <span className="admin-contrats-audit-dot" />
            <span>Traçabilité activée</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary admin-contrats-refresh"
            onClick={chargerListe}
            disabled={chargementListe}
            aria-busy={chargementListe}
          >
            {chargementListe ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
            Actualiser
          </button>
        </div>
      </header>

      <section className="glass-panel portefeuille-filtres" aria-label="Recherche et filtres">
        <div className="admin-contrats-section-heading">
          <div>
            <h2>Trouver un contrat</h2>
            <p>Par numéro de police, client, produit ou compagnie, sur une période ou une branche.</p>
          </div>
          {filtresActifs && (
            <button type="button" className="btn btn-link" onClick={effacerFiltres}>Effacer les filtres</button>
          )}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setRechercheAppliquee(recherche.trim());
          }}
          className="portefeuille-ligne-recherche"
        >
          <div className="portefeuille-recherche">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              className="form-control"
              value={recherche}
              onChange={(event) => setRecherche(event.target.value)}
              placeholder="N° de police, client, produit ou compagnie…"
              aria-label="Rechercher un contrat"
            />
            <button type="submit" className="btn btn-primary admin-contrats-search" aria-label="Rechercher">
              <Search size={16} />
              <span>Rechercher</span>
            </button>
          </div>
          <div className="portefeuille-periode" role="group" aria-label="Période">
            <select className="form-control" value={champPeriode} onChange={(event) => { setChampPeriode(event.target.value); setPage(1); }}>
              <option value="effet">Date d’effet</option>
              <option value="echeance">Date d’échéance</option>
              <option value="emission">Date d’émission</option>
            </select>
            <input type="date" className="form-control" value={du} max={au || undefined} onChange={(event) => { setDu(event.target.value); setPage(1); }} aria-label="Du" />
            <ArrowRight size={14} aria-hidden="true" />
            <input type="date" className="form-control" value={au} min={du || undefined} onChange={(event) => { setAu(event.target.value); setPage(1); }} aria-label="Au" />
          </div>
        </form>

        <div className="portefeuille-branches" role="tablist" aria-label="Branches">
          {BRANCHES.map((item) => {
            const Icone = item.icone;
            const actif = branche === item.cle;
            return (
              <button key={item.cle} type="button" role="tab" aria-selected={actif}
                className={`portefeuille-puce${actif ? ' actif' : ''}`}
                onClick={() => { setBranche(item.cle); setPage(1); }}>
                <Icone size={15} /><span>{item.libelle}</span>
                <span className="portefeuille-compte">{nombre(compteBranche(item))}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="glass-panel portefeuille-liste" aria-label="Contrats">
        <div className="admin-contrats-section-heading admin-contrats-list-heading">
          <div>
            <h2>Contrats</h2>
            <p>Ouvrez un contrat pour corriger ses informations, ses risques ou ses garanties.</p>
          </div>
          <span className="admin-contrats-result-count">{nombre(liste.count)} contrat{liste.count > 1 ? 's' : ''}</span>
        </div>
        <div className="portefeuille-statuts" role="tablist" aria-label="Statut des contrats">
          {ONGLETS_STATUT.map((cle) => (
            <button key={cle} type="button" role="tab" aria-selected={statut === cle}
              className={`portefeuille-statut statut-${cle}${statut === cle ? ' actif' : ''}`}
              onClick={() => { setStatut(cle); setPage(1); }}>
              {cle === 'tous' ? 'Tous' : STATUTS[cle].libelle}
              <span className="portefeuille-compte">{nombre(compteStatut(cle))}</span>
            </button>
          ))}
        </div>
        {chargementListe ? (
          <SqueletteTableau colonnes={7} lignes={8} libelle="Chargement des contrats…" />
        ) : (
          <>
            <div className="table-wrapper">
              <table className="data-table portefeuille-table">
                <thead>
                  <tr>
                    {enteteTri('police', 'Police')}
                    {enteteTri('client', 'Client')}
                    {enteteTri('produit', 'Produit · Compagnie')}
                    {enteteTri('echeance', 'Effet → Échéance')}
                    {enteteTri('prime', 'Prime TTC', 'right')}
                    <th>Statut</th><th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {liste.results.map((contrat) => (
                    <tr key={contrat.idcontrat}>
                      <td data-label="Police">
                        <span className="portefeuille-police">{contrat.numeropolice || contrat.numero_police_compagnie || `Contrat ${contrat.idcontrat}`}</span>
                        {contrat.idavenant?.LibelleAvenant && <div className="portefeuille-secondaire">{contrat.idavenant.LibelleAvenant}</div>}
                      </td>
                      <td data-label="Client"><span className="portefeuille-client">{nomClient(contrat)}</span></td>
                      <td data-label="Produit">
                        <div className="portefeuille-principal">{contrat.idproduit?.libelle_produit || '-'}</div>
                        <div className="portefeuille-secondaire">{contrat.idcompagnie?.RaisonSociale || '-'}</div>
                      </td>
                      <td data-label="Période">
                        <div className="portefeuille-periode-cellule"><span>{dateFr(contrat.dateeffet)}</span><ArrowRight size={12} /><span>{dateFr(contrat.dateexpiration)}</span></div>
                      </td>
                      <td data-label="Prime TTC" style={{ textAlign: 'right' }}>
                        <div className="portefeuille-montant">{montant(contrat.primettc)}</div>
                        <div className="portefeuille-secondaire">Nette {montant(contrat.primenette)}</div>
                      </td>
                      <td data-label="Statut">
                        {STATUTS[contrat.statut_portefeuille] ? (
                          <StatusBadge label={STATUTS[contrat.statut_portefeuille].libelle} color={STATUTS[contrat.statut_portefeuille].badge} />
                        ) : '-'}
                      </td>
                      <td data-label="Actions" className="portefeuille-cellule-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => ouvrirContrat(contrat.idcontrat)}
                          disabled={ouverture !== null}
                          aria-busy={ouverture === contrat.idcontrat}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                        >
                          {ouverture === contrat.idcontrat ? <Loader2 className="spin" size={14} /> : <Pencil size={14} />} Corriger
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!liste.results.length && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                        Aucun contrat ne correspond{filtresActifs ? ' à ces filtres' : ''}.
                        {filtresActifs && <> <button type="button" className="btn btn-link" onClick={effacerFiltres}>Effacer les filtres</button></>}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <nav className="portefeuille-pagination" aria-label="Pagination">
              <span>{nombre(liste.count)} contrat{liste.count > 1 ? 's' : ''} - page {page} / {totalPages}</span>
              <div className="portefeuille-pages">
                <label>
                  <span>Lignes par page</span>
                  <select className="form-control" value={taille} onChange={(event) => { setTaille(Number(event.target.value)); setPage(1); }}>
                    {TAILLES_PAGE.map((valeur) => <option key={valeur} value={valeur}>{valeur}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-secondary" aria-label="Page précédente" disabled={page <= 1} onClick={() => setPage((v) => v - 1)}><ChevronLeft size={16} /></button>
                <button type="button" className="btn btn-secondary" aria-label="Page suivante" disabled={page >= totalPages} onClick={() => setPage((v) => v + 1)}><ChevronRight size={16} /></button>
              </div>
            </nav>
          </>
        )}
      </section>
    </div>
  );
};

export default AdminContractManagementPage;
