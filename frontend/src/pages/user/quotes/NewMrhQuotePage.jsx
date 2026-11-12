import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from '../../../utils/navigationDevis';
import { quoteApi, mrhApi, customerApi, settingsApi, contractApi, piecesJointesApi, valeursUsuellesApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import {
  Home, ChevronLeft, ChevronRight, Plus, Trash2, Edit3, CheckCircle2, AlertTriangle, Loader2,
  FileText, Users, ShieldCheck, Calculator, FileCheck, Building, Eye, ChevronDown, Info, Scale, X, Download, FileSpreadsheet,
} from 'lucide-react';
import { ViewQuoteModal } from './ViewQuoteModal';
import { BoutonPieceJointe, PieceJointe } from '../../../components/common/PieceJointe';
import { QuickAddClientModal } from '../clients/QuickAddClientModal';
import { TermeContratSelect } from '../../../components/common/TermeContratSelect';
import { DureeContratSelect } from '../../../components/common/DureeContratSelect';
import { Champ, RechercheClient, FichePersonne, personneDepuisClient } from '../../../components/common/RechercheClient';
import { EtapesDevis, ResumeDevis } from '../../../components/common/ParcoursDevis';
import { ChampPropose, propositionMontant, propositionsUsuelles } from '../../../components/common/ListePropositions';
import { ID_TERME_PAR_DEFAUT, dureeSelonTerme, termeEtDureeEnregistres } from '../../../utils/termesContrat';
import { trierParLibelle } from '../../../utils/sortUtils';
import { confirmer } from '../../../utils/dialogue';
import { arrondirMontant, compagnieParDefaut } from '../../../utils/parametrage';

// Production Multirisques Habitation d'URANUS (Contrat, Maisons, Offre/récapitulatif, Souscripteur) :
// un devis porte une ou plusieurs maisons ; chaque maison a un usage (statut d'occupation) qui fixe
// les capitaux à saisir, les garanties obligatoires, les garanties facultatives et les options.
// Pas de barème MRH (décision du 2026-10-28) : la prime nette de chaque maison, la taxe et l'accessoire
// sont saisis à la main et envoyés en prime imposée ; le moteur MRH du serveur (POST /api/mrh/calcul/maison/)
// ne sert plus qu'à contrôler la maison et lister ses garanties. Le devis est enregistré d'un bloc
// (POST/PUT /api/mrh/devis/), puis la répartition de la prime de chaque maison par garantie peut être
// ajustée comme dans URANUS (repartir-garanties).

const ID_PRODUIT_MRH = 4;
const ID_TARIF_MRH = 81;

const ETAPES = [
  { num: 1, libelle: 'Contrat', icone: FileText },
  { num: 2, libelle: 'Habitations', icone: Building },
  { num: 3, libelle: 'Tarification', icone: Calculator },
  { num: 4, libelle: 'Souscripteur', icone: Users },
  { num: 5, libelle: 'Récapitulatif', icone: FileCheck },
];

// Espace insécable ordinaire : l'espace fine du français n'est pas dessinée par toutes les polices (montants en gras)
const fcfa = (val) => Math.round(Number(String(val ?? 0).replace(/\s/g, '')) || 0).toLocaleString('fr-FR').replace(/ /g, ' ');
const cleanNum = (str) => (typeof str === 'number' ? str : parseFloat(String(str || '0').replace(/\s/g, '')) || 0);
const chiffres = (v) => String(v || '').replace(/[^0-9]/g, '');
const jour = (v) => (v ? String(v).slice(0, 10) : '');
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '-');

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

// Formule de calcul stockée en base avec des accents mal encodés (UTF-8 relu en Windows-1252,
// ex. « Ã- » pour « × ») : remise en UTF-8 pour l'affichage
const CP1252 = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b,
  'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '-': 0x97, '˜': 0x98, '™': 0x99,
  'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};
const reparerTexte = (texte) => {
  if (!texte || !/[ÃÂâ]/.test(texte)) return texte || '';
  const caracteres = [...texte];
  if (caracteres.some((c) => !(c in CP1252) && c.charCodeAt(0) > 255)) return texte;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(caracteres.map((c) => CP1252[c] ?? c.charCodeAt(0))));
  } catch {
    return texte;
  }
};

// Champs de capital d'une maison, rattachés aux paramètres de l'usage (param_*_requis)
const CAPITAUX = [
  { cle: 'valeur_batiment', libelle: 'Valeur du bâtiment', parametre: 'param_valeur_batiment_requis', coeff: 'coeff_valeur_batiment' },
  { cle: 'valeur_contenu', libelle: 'Valeur du contenu', parametre: 'param_valeur_contenu_requis', coeff: 'coeff_valeur_contenu' },
  { cle: 'loyer_mensuel', libelle: 'Loyer mensuel', parametre: 'param_loyer_requis', coeff: 'coeff_loyer' },
  { cle: 'capital_rvt', libelle: 'Capital RVT (recours des voisins et des tiers)', parametre: 'param_capital_rvt_requis', coeff: 'coeff_capital_rvt' },
];
const MAISON_VIDE = { valeur_batiment: '', valeur_contenu: '', loyer_mensuel: '', capital_rvt: '' };

// Garanties d'une maison, depuis le calcul (sous_garanties) ou la relecture du devis (garanties)
const garantiesDepuisCalcul = (liste) => (liste || []).map((g) => ({
  code: g.code_sous_garantie,
  libelle: reparerTexte(g.libelle_sous_garantie) || g.code_sous_garantie,
  optionnelle: g.type_garantie ? g.type_garantie !== 'OBLIGATOIRE' : Boolean(g.optionnelle),
  prime_nette: Number(g.prime_nette) || 0,
  taxe: Number(g.taxe) || 0,
  taux_taxe: g.taux_taxe != null ? Number(g.taux_taxe) : null,
  prime_ttc: Number(g.prime_ttc) || 0,
}));

const styles = {
  carte: { padding: '1.5rem', borderRadius: '14px' },
  titreCarte: { display: 'flex', alignItems: 'center', gap: '0.55rem', margin: '0 0 1.2rem', fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' },
  grille: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '1rem 1.25rem', alignItems: 'start' },
  sousTitre: { fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '1.4rem 0 0.7rem' },
  aide: { fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' },
  bloc: { padding: '0.9rem 1rem', borderRadius: '12px', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-elevated)' },
  tuiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '0.6rem' },
  tableau: { width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '0.5rem 0.55rem', fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-medium)', whiteSpace: 'nowrap' },
  td: { padding: '0.45rem 0.55rem', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)', verticalAlign: 'middle' },
  num: { textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' },
  ligneRecap: { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px dashed var(--border-subtle)', fontSize: '0.84rem' },
  pastille: (couleur) => ({ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.15rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, border: `1px solid ${couleur}`, color: couleur, whiteSpace: 'nowrap' }),
  alerte: (couleur) => ({
    display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.8rem 1rem', borderRadius: '10px',
    border: `1px solid ${couleur}`, background: 'var(--bg-surface-elevated)', fontSize: '0.85rem', color: 'var(--text-primary)',
  }),
  choix: (actif) => ({
    display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.7rem 0.8rem', borderRadius: '10px', cursor: 'pointer',
    border: `1px solid ${actif ? 'var(--primary-500)' : 'var(--border-subtle)'}`, background: actif ? 'var(--primary-glow)' : 'var(--bg-surface)',
  }),
};

const Tuile = ({ libelle, valeur, fort, couleur }) => (
  <div style={{ ...styles.bloc, ...(couleur ? { borderColor: couleur } : {}), ...(fort ? { background: 'var(--primary-glow)' } : {}) }}>
    <div style={{ fontSize: '0.7rem', color: couleur || 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>{libelle}</div>
    <div style={{ fontSize: fort ? '1.2rem' : '1.02rem', fontWeight: 900, color: 'var(--text-primary)', marginTop: '0.2rem' }}>{valeur}</div>
  </div>
);

const Alerte = ({ couleur, icone: Icone = AlertTriangle, children }) => (
  <div style={styles.alerte(couleur)}>
    <Icone size={18} style={{ color: couleur, flexShrink: 0, marginTop: 1 }} />
    <div>{children}</div>
  </div>
);

const ChampMontant = ({ valeur, onChange, placeholder }) => (
  <div style={{ position: 'relative' }}>
    <input type="text" inputMode="numeric" className="form-control" value={valeur ? fcfa(valeur) : ''} placeholder={placeholder || '0'}
      onChange={(e) => onChange(chiffres(e.target.value))} style={{ paddingRight: '3.2rem', fontFamily: 'var(--font-mono)' }} />
    <span style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700 }}>FCFA</span>
  </div>
);

// Garanties d'une maison (liste du moteur ou garanties enregistrées), sans les primes du moteur : pas de barème MRH
const ListeGaranties = ({ garanties }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
    {garanties.map((g) => (
      <span key={g.code} style={{ ...styles.pastille(g.optionnelle ? 'var(--accent-purple)' : 'var(--accent-emerald)'), padding: '0.3rem 0.65rem' }}>
        <ShieldCheck size={12} /> {g.libelle}{g.optionnelle ? ' (facultative)' : ''}
      </span>
    ))}
  </div>
);

export const NewMrhQuotePage = () => {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  // « Modifier » depuis le registre des devis : /user/quotes/mrh?edit=<iddevis>
  const [searchParams] = useSearchParams();
  const editIddevisParam = searchParams.get('edit');
  // Incorporation d'une maison dans un contrat en cours (page Incorporation, ou devis INC rouvert du registre) : date
  // d'incorporation au choix dans la période du contrat ; échéance, compagnie, souscripteur et assuré de la police
  const [incorporation, setIncorporation] = useState(null);
  const [isLoadingEdit, setIsLoadingEdit] = useState(Boolean(editIddevisParam));
  const [numeroDevisEdite, setNumeroDevisEdite] = useState('');
  const [avertissementReprise, setAvertissementReprise] = useState('');
  const [idDevisActuel, setIdDevisActuel] = useState(null);
  // Pièce jointe du devis (URANUS « Upload de fichier ») : envoyée après l'enregistrement, consultable ensuite
  const [fichier, setFichier] = useState(null);
  const [versionPiece, setVersionPiece] = useState(0);

  const [step, setStep] = useState(1);
  const [tentative, setTentative] = useState({});
  const [createdQuote, setCreatedQuote] = useState(null);
  const [nouveauClientPour, setNouveauClientPour] = useState(null);

  // Référentiels
  const [companies, setCompanies] = useState([]);
  const [tarifs, setTarifs] = useState([]);
  const [usages, setUsages] = useState([]);

  // Étape 1 : contrat
  const [numeroPoliceCompagnie, setNumeroPoliceCompagnie] = useState('');
  const [compagnieId, setCompagnieId] = useState(() => compagnieParDefaut(ID_PRODUIT_MRH));
  const [categorieId, setCategorieId] = useState(ID_TARIF_MRH);
  const [termeId, setTermeId] = useState(ID_TERME_PAR_DEFAUT);
  const [dureeId, setDureeId] = useState(4); // 4 = Annuelle
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const dateEmission = todayStr; // toujours la date du jour (le serveur l'impose aussi)
  const [dateEffet, setDateEffet] = useState(todayStr);
  const [customExpiration, setCustomExpiration] = useState('');
  const calculatedDateExpiration = useMemo(() => {
    if (incorporation?.DateExpiration) return incorporation.DateExpiration;
    if (!dateEffet) return '';
    if (Number(dureeId) === 5) return customExpiration || '';
    const mois = { 1: 1, 2: 3, 3: 6, 4: 12 }[Number(dureeId)] || 12;
    const d = new Date(dateEffet);
    d.setMonth(d.getMonth() + mois);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }, [dateEffet, dureeId, customExpiration, incorporation]);

  // Étape 2 : maisons
  const [maisons, setMaisons] = useState([]);
  const [maisonOuverte, setMaisonOuverte] = useState(null);
  const [editingMaisonId, setEditingMaisonId] = useState(null);
  // Formulaire d'ajout replié quand le devis a déjà des maisons (ouvert à la demande ou pour modifier une maison)
  const [formulaireMaison, setFormulaireMaison] = useState(false);
  const [currentUsageCode, setCurrentUsageCode] = useState('');
  const [currentAdresse, setCurrentAdresse] = useState('');
  const [capitaux, setCapitaux] = useState(MAISON_VIDE);
  const [parametresUsage, setParametresUsage] = useState(null);
  const [availableOptions, setAvailableOptions] = useState([]);
  const [garantiesUsage, setGarantiesUsage] = useState({ obligatoires: [], optionnelles: [] });
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [selectedGaranties, setSelectedGaranties] = useState([]);
  const [calculMaisonEnCours, setCalculMaisonEnCours] = useState(false);
  const currentUsage = useMemo(() => usages.find((u) => u.code === currentUsageCode) || null, [usages, currentUsageCode]);

  // Étape 3 : primes saisies à la main (pas de barème MRH) : prime nette de chaque maison, taxe et accessoire du devis
  const [primesParMaison, setPrimesParMaison] = useState({});
  const [taxeSaisie, setTaxeSaisie] = useState('');
  const [accessoireSaisi, setAccessoireSaisi] = useState('');

  // Étape 4 : souscripteur / assuré
  const [souscripteur, setSouscripteur] = useState(null);
  const [assureDifferent, setAssureDifferent] = useState(false);
  const [assureChoisi, setAssureChoisi] = useState(null);
  const assure = assureDifferent ? assureChoisi : souscripteur;
  const [telephoneAssure, setTelephoneAssure] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Après enregistrement : répartition des garanties (URANUS « Récapitulatif du devis »)
  const [devisEnregistre, setDevisEnregistre] = useState(null);
  const [resume, setResume] = useState(null);
  const [maisonsServeur, setMaisonsServeur] = useState([]);
  const [repartition, setRepartition] = useState({});
  const [repartitionEnCours, setRepartitionEnCours] = useState(null);

  // ------------------------------------------------------------------ référentiels
  useEffect(() => {
    let actif = true;
    Promise.all([
      settingsApi.getCompanies().catch(() => []),
      mrhApi.getUsages().catch(() => []),
      mrhApi.getTarifs().catch(() => []),
    ]).then(([cies, usgList, trfs]) => {
      if (!actif) return;
      const mapped = (cies || []).map((c) => ({ id: Number(c.IdCompagnie || c.id), nom: c.RaisonSociale || c.nom }));
      setCompanies(mapped);
      if (!editIddevisParam && mapped.length) {
        // Compagnie proposée à l'ouverture : Administration > Produits (NSIA à l'origine)
        setCompagnieId((mapped.find((c) => c.id === compagnieParDefaut(ID_PRODUIT_MRH)) || mapped[0]).id);
      }
      if (Array.isArray(usgList) && usgList.length) {
        setUsages(usgList);
        setCurrentUsageCode((code) => code || usgList[0].code);
      }
      if (Array.isArray(trfs) && trfs.length) setTarifs(trfs);
    });
    return () => { actif = false; };
  }, [editIddevisParam]);

  // Paramètres, options et garanties de l'usage choisi pour la maison en cours
  useEffect(() => {
    if (!currentUsageCode) return undefined;
    let actif = true;
    Promise.all([
      mrhApi.getParametresUsage(currentUsageCode).catch(() => null),
      mrhApi.getOptionsByUsage(currentUsageCode).catch(() => []),
      mrhApi.getGarantiesUsage(currentUsageCode).catch(() => ({})),
    ]).then(([params, opts, gars]) => {
      if (!actif) return;
      setParametresUsage(params);
      const options = Array.isArray(opts) ? opts : [];
      setAvailableOptions(options);
      const garanties = { obligatoires: gars?.obligatoires || [], optionnelles: gars?.optionnelles || [] };
      setGarantiesUsage(garanties);
      // Seules les options et garanties facultatives de cet usage restent cochées
      setSelectedOptions((prev) => prev.filter((c) => options.some((o) => (o.code_option || o.code) === c)));
      setSelectedGaranties((prev) => prev.filter((c) => garanties.optionnelles.some((g) => (g.code_sous_garantie || g.code) === c)));
    });
    return () => { actif = false; };
  }, [currentUsageCode]);

  // ------------------------------------------------------------------ totaux (montants saisis)
  const primeNetteMaison = (m) => cleanNum(primesParMaison[m.id]);
  const totalsFinanciers = useMemo(() => {
    const primeNette = maisons.reduce((s, m) => s + primeNetteMaison(m), 0);
    const taxes = cleanNum(taxeSaisie);
    const accessoires = cleanNum(accessoireSaisi);
    return { primeNette, taxes, accessoires, primeTtc: arrondirMontant(primeNette + taxes + accessoires, 4) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maisons, primesParMaison, taxeSaisie, accessoireSaisi]);

  // Listes déroulantes de la taxe et de l'accessoire (rien n'est rempli d'office) : accessoires habituels des devis
  // MRH enregistrés ; taxe = prime saisie de chaque maison aux taux de taxe de ses garanties (rapport taxe / prime
  // de la maison), plus 14,5 % de l'accessoire
  const [accessoiresUsuels, setAccessoiresUsuels] = useState([]);
  useEffect(() => {
    let actif = true;
    valeursUsuellesApi.get(ID_PRODUIT_MRH).then((d) => { if (actif) setAccessoiresUsuels(propositionsUsuelles(d.Accessoire)); }).catch(() => {});
    return () => { actif = false; };
  }, []);
  const taxesProposees = useMemo(() => {
    if (!maisons.length || maisons.some((m) => primeNetteMaison(m) <= 0 || !(Number(m.prime_nette) > 0))) return [];
    const garanties = maisons.reduce((s, m) => s + Math.round((primeNetteMaison(m) * Number(m.taxe)) / Number(m.prime_nette)), 0);
    const taux = String(Math.round((garanties * 1000) / totalsFinanciers.primeNette) / 10).replace('.', ',');
    return [propositionMontant(garanties + Math.round(cleanNum(accessoireSaisi) * 0.145),
      `taux des garanties (${taux} % de la prime nette)${cleanNum(accessoireSaisi) ? ' + 14,5 % de l\'accessoire' : ''}`)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maisons, primesParMaison, accessoireSaisi, totalsFinanciers.primeNette]);

  // ------------------------------------------------------------------ maisons
  const viderFormulaireMaison = () => {
    setEditingMaisonId(null);
    setCurrentAdresse('');
    setCapitaux(MAISON_VIDE);
    setSelectedOptions([]);
    setSelectedGaranties([]);
  };

  const capitauxAffiches = CAPITAUX.filter((c) => !parametresUsage || parametresUsage[c.parametre] || cleanNum(capitaux[c.cle]) > 0);

  const handleSaveMaison = async () => {
    const valeurs = Object.fromEntries(CAPITAUX.map((c) => [c.cle, cleanNum(capitaux[c.cle])]));
    if (!currentUsageCode) { toastError('Choisissez l\'usage de l\'habitation.'); return; }
    if (Object.values(valeurs).every((v) => v === 0)) {
      toastError('Saisissez au moins une valeur (bâtiment, contenu, loyer ou capital RVT).');
      return;
    }
    const manquant = CAPITAUX.find((c) => parametresUsage?.[c.parametre] && valeurs[c.cle] <= 0);
    if (manquant) { toastError(`${manquant.libelle} : requis pour l'usage « ${currentUsage?.libelle || currentUsageCode} ».`); return; }

    setCalculMaisonEnCours(true);
    let calcRes;
    try {
      // Moteur MRH du serveur, celui-là même qui enregistre le devis : contrôle de la maison et liste de ses
      // garanties (ses primes ne sont pas reprises : la prime de la maison est saisie à l'étape Tarification)
      calcRes = await mrhApi.calculerPrimeMaison({
        code_usage: currentUsageCode,
        id_tarif: Number(categorieId),
        id_offre: Number(currentUsage?.offre) || 0,
        ...valeurs,
        options: selectedOptions.map((o) => ({ code_option: o })),
        sous_garanties_optionnelles: selectedGaranties.map((g) => ({ code_sous_garantie: g })),
      });
    } catch (err) {
      toastError(`Maison non ${editingMaisonId ? 'modifiée' : 'ajoutée'} : ${messageErreurApi(err)}`);
      return;
    } finally {
      setCalculMaisonEnCours(false);
    }
    const primeNetteCalc = Math.round(Number(calcRes?.prime_nette_totale) || 0);
    const taxeCalc = Math.round(Number(calcRes?.taxe_totale) || 0);
    const maison = {
      code_usage: currentUsageCode,
      usage_libelle: currentUsage?.libelle || currentUsageCode,
      adresse: currentAdresse.trim(),
      ...valeurs,
      options: selectedOptions,
      sous_garanties_optionnelles: selectedGaranties,
      prime_nette: primeNetteCalc,
      taxe: taxeCalc,
      prime_ttc: primeNetteCalc + taxeCalc,
      garanties: garantiesDepuisCalcul(calcRes?.sous_garanties),
      options_appliquees: calcRes?.options_appliquees || [],
    };
    if (editingMaisonId) {
      setMaisons((prev) => prev.map((m) => (m.id === editingMaisonId ? { ...m, ...maison } : m)));
      success('Maison modifiée.');
    } else {
      const id = Date.now();
      setMaisons((prev) => [...prev, { id, ...maison }]);
      setMaisonOuverte(id);
      success('Maison ajoutée au devis.');
    }
    viderFormulaireMaison();
    setFormulaireMaison(false);
  };

  // Import Excel des maisons (devis neuf, « Modifier » ou incorporation, demande du 2026-11-10) : fichier lu et contrôlé par le
  // moteur MRH du serveur, rien n'est enregistré avant « Enregistrer » ; une seule ligne en erreur et aucune maison n'est ajoutée
  const [fichierMaisons, setFichierMaisons] = useState(null);
  const [cleFichierMaisons, setCleFichierMaisons] = useState(0);
  const [importMaisons, setImportMaisons] = useState({ enCours: false, erreurs: [], resume: '' });
  const telechargerModeleMaisons = async () => {
    try {
      const blob = await mrhApi.modeleImport();
      const url = URL.createObjectURL(blob);
      const lien = document.createElement('a');
      lien.href = url;
      lien.download = 'modele_maisons_mrh.xlsx';
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toastError(`Modèle non téléchargé : ${messageErreurApi(err)}`);
    }
  };
  const importerMaisons = async () => {
    if (!fichierMaisons) { toastError('Choisissez le fichier Excel des maisons.'); return; }
    setImportMaisons({ enCours: true, erreurs: [], resume: '' });
    try {
      const res = await mrhApi.analyserImport(fichierMaisons);
      if (res.Erreurs?.length) {
        setImportMaisons({ enCours: false, erreurs: res.Erreurs, resume: '' });
        toastError(`Aucune maison importée : ${res.Erreurs.length} ligne${res.Erreurs.length > 1 ? 's' : ''} à corriger dans le fichier.`);
        return;
      }
      const base = Date.now();
      const nouvelles = (res.Maisons || []).map((m, i) => {
        const primeNetteCalc = Math.round(Number(m.calcul?.prime_nette_totale) || 0);
        const taxeCalc = Math.round(Number(m.calcul?.taxe_totale) || 0);
        return {
          id: base + i,
          code_usage: m.code_usage,
          usage_libelle: m.usage_libelle || m.code_usage,
          adresse: m.adresse || '',
          ...Object.fromEntries(CAPITAUX.map((c) => [c.cle, Number(m[c.cle]) || 0])),
          options: m.options || [],
          sous_garanties_optionnelles: m.sous_garanties_optionnelles || [],
          prime_nette: primeNetteCalc,
          taxe: taxeCalc,
          prime_ttc: primeNetteCalc + taxeCalc,
          garanties: garantiesDepuisCalcul(m.calcul?.sous_garanties),
          options_appliquees: m.calcul?.options_appliquees || [],
          prime_saisie: m.prime_nette_saisie,
        };
      });
      setMaisons((prev) => [...prev, ...nouvelles]);
      setPrimesParMaison((prev) => ({
        ...prev,
        ...Object.fromEntries(nouvelles.map((n) => [n.id, n.prime_saisie ? String(Math.round(n.prime_saisie)) : ''])),
      }));
      const t = res.Totaux || {};
      // Taxe du fichier, quand chaque ligne la donne : ajoutée à la taxe du devis (somme des maisons)
      if (t.Taxe !== null && t.Taxe !== undefined) setTaxeSaisie((v) => String(cleanNum(v) + Math.round(Number(t.Taxe) || 0)));
      const resume = `${nouvelles.length} maison${nouvelles.length > 1 ? 's' : ''} importée${nouvelles.length > 1 ? 's' : ''} de la feuille « ${res.Feuille} »`
        + ` : prime nette ${fcfa(t.PrimeNette)} F`
        + (t.PrimesManquantes ? `, ${t.PrimesManquantes} prime${t.PrimesManquantes > 1 ? 's' : ''} à saisir à l'étape Tarification` : '')
        + (t.Taxe !== null && t.Taxe !== undefined ? `, taxe ${fcfa(t.Taxe)} F ajoutée à celle du devis` : ', taxe à saisir à l\'étape Tarification')
        + '. Vérifiez la liste puis enregistrez le devis.';
      setImportMaisons({ enCours: false, erreurs: [], resume });
      setFichierMaisons(null);
      setCleFichierMaisons((k) => k + 1);
      setFormulaireMaison(false);
      success(resume);
    } catch (err) {
      setImportMaisons({ enCours: false, erreurs: [], resume: '' });
      toastError(`Import impossible : ${messageErreurApi(err)}`);
    }
  };

  const handleEditMaison = (m) => {
    setEditingMaisonId(m.id);
    setFormulaireMaison(true);
    setCurrentUsageCode(m.code_usage || currentUsageCode);
    setCurrentAdresse(m.adresse || '');
    setCapitaux(Object.fromEntries(CAPITAUX.map((c) => [c.cle, m[c.cle] ? String(m[c.cle]) : ''])));
    setSelectedOptions(m.options || []);
    setSelectedGaranties(m.sous_garanties_optionnelles || []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRemoveMaison = async (m, idx) => {
    if (!(await confirmer({
      ton: 'danger', titre: `Retirer la maison ${idx + 1} ?`, confirmer: 'Retirer',
      message: `${m.usage_libelle || 'Maison'}${m.adresse ? `, ${m.adresse}` : ''}${primeNetteMaison(m) ? ` : prime nette ${fcfa(primeNetteMaison(m))} F` : ''}. La maison et ses garanties sont retirées du devis.`,
    }))) return;
    const id = m.id;
    setMaisons((prev) => prev.filter((x) => x.id !== id));
    if (editingMaisonId === id) viderFormulaireMaison();
  };

  // ------------------------------------------------------------------ « Modifier »
  useEffect(() => {
    if (!editIddevisParam) return undefined;
    let actif = true;
    (async () => {
      setIsLoadingEdit(true);
      try {
        const [devis, detail, lectureIncorporation] = await Promise.all([
          quoteApi.getQuote(editIddevisParam),
          mrhApi.getMaisons(editIddevisParam),
          contractApi.lireDevisIncorporation(editIddevisParam).catch(() => null),
        ]);
        if (!actif) return;
        const raw = devis?.raw || {};
        if (raw.confirme) {
          toastError('Ce devis est confirmé (déjà en contrat) : il ne peut plus être modifié.');
          navigate('/user/quotes');
          return;
        }
        setIncorporation(lectureIncorporation?.Incorporation ? lectureIncorporation : null);
        setIdDevisActuel(Number(editIddevisParam));
        setNumeroDevisEdite(raw.numerodevis || '');
        setNumeroPoliceCompagnie(raw.numero_police_compagnie || '');
        if (raw.compagnie?.IdCompagnie) setCompagnieId(Number(raw.compagnie.IdCompagnie));
        // Durée libre et terme « Autre » vont ensemble (anciens devis « Divers » compris)
        const charge = termeEtDureeEnregistres(raw.idterme, raw.idduree);
        setTermeId(charge.termeId);
        setDureeId(charge.dureeId);
        setDateEffet(jour(raw.dateeffet) || todayStr);
        setCustomExpiration(jour(raw.dateexpiration));

        const idClient = raw.client?.IdClient ?? raw.client;
        const idAssure = raw.assure?.IdClient ?? raw.assure ?? idClient;
        const [clientLu, assureLu] = await Promise.all([
          idClient ? customerApi.getClientDetail(idClient).catch(() => null) : null,
          idAssure && String(idAssure) !== String(idClient) ? customerApi.getClientDetail(idAssure).catch(() => null) : null,
        ]);
        if (!actif) return;
        const personneClient = personneDepuisClient(clientLu) || (idClient ? { IdClient: Number(idClient), Nom: `Client n° ${idClient}` } : null);
        setSouscripteur(personneClient);
        if (assureLu) { setAssureDifferent(true); setAssureChoisi(personneDepuisClient(assureLu)); }
        setTelephoneAssure((personneDepuisClient(assureLu || clientLu) || {}).Telephone || '');

        // Maisons : valeurs enregistrées
        const maisonsDevis = detail?.maisons || [];
        const maisonsChargees = maisonsDevis.map((m) => {
          const p = m.parametres || {};
          return {
            id: m.maison_id,
            maison_id: m.maison_id,
            code_usage: m.code_usage,
            usage_libelle: m.usage_libelle || m.code_usage,
            adresse: m.adresse || '',
            valeur_batiment: Number(p.valeur_batiment) || 0,
            valeur_contenu: Number(p.valeur_contenu) || 0,
            loyer_mensuel: Number(p.loyer_mensuel) || 0,
            capital_rvt: Number(p.capital_rvt) || 0,
            options: m.options || [],
            sous_garanties_optionnelles: m.sous_garanties_optionnelles || [],
            prime_nette: Number(m.prime_nette) || 0,
            taxe: Number(m.taxe) || 0,
            prime_ttc: Number(m.prime_ttc) || 0,
            garanties: garantiesDepuisCalcul(m.garanties),
          };
        });
        setMaisons(maisonsChargees);

        // Montants enregistrés repris dans les champs de saisie (vides s'ils sont nuls)
        const saisi = (v) => (Math.round(Number(v) || 0) ? String(Math.round(Number(v))) : '');
        let primes = maisonsChargees.map((m) => Math.round(m.prime_nette));
        // Devis repris d'URANUS : maisons souvent sans usage ni prime, seul l'en-tête porte les montants ;
        // la prime nette est répartie au prorata des capitaux.
        const pnEnTete = Math.round(Number(raw.primenette) || 0);
        if (pnEnTete > 0 && primes.every((p) => !p) && maisonsChargees.length > 0) {
          const poids = maisonsChargees.map((m) => m.valeur_batiment + m.valeur_contenu);
          const totalPoids = poids.reduce((a, b) => a + b, 0);
          let reste = pnEnTete;
          primes = maisonsChargees.map((m, i) => {
            if (i === maisonsChargees.length - 1) return reste;
            const part = Math.round(totalPoids > 0 ? (pnEnTete * poids[i]) / totalPoids : pnEnTete / maisonsChargees.length);
            reste -= part;
            return part;
          });
        }
        setPrimesParMaison(Object.fromEntries(maisonsChargees.map((m, i) => [m.id, saisi(primes[i])])));
        setTaxeSaisie(saisi(raw.taxe));
        setAccessoireSaisi(saisi(raw.accessoire));
        const alertes = [];
        if (maisonsDevis.length === 0 && Number(raw.primettc) > 0) {
          alertes.push(`Aucune maison n'est enregistrée pour ce devis. Montants enregistrés : prime nette ${fcfa(raw.primenette)} F, `
            + `taxes ${fcfa(raw.taxe)} F, accessoires ${fcfa(raw.accessoire)} F, TTC ${fcfa(raw.primettc)} F. Saisissez les maisons pour pouvoir l'enregistrer à nouveau.`);
        }
        if (maisonsDevis.some((m) => !m.code_usage)) {
          alertes.push('Usage d\'occupation non renseigné en base pour une ou plusieurs maisons : à choisir avant d\'enregistrer.');
        }
        setAvertissementReprise(alertes.join(' '));
      } catch (err) {
        if (actif) toastError(`Impossible de charger le devis à modifier : ${messageErreurApi(err)}`);
      } finally {
        if (actif) setIsLoadingEdit(false);
      }
    })();
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editIddevisParam]);

  // ------------------------------------------------------------------ contrôles par étape
  const erreursEtape = (n) => {
    const e = {};
    if (n === 1) {
      if (!compagnieId) e.compagnie = 'Choisissez la compagnie.';
      if (!dateEffet) e.dateEffet = incorporation ? 'Saisissez la date d\'incorporation.' : 'Saisissez la date d\'effet.';
      else if (incorporation && (dateEffet < incorporation.DateEffetContrat || dateEffet > incorporation.DateExpiration)) {
        e.dateEffet = `La date d'incorporation doit être comprise entre le ${dateFr(incorporation.DateEffetContrat)} et le ${dateFr(incorporation.DateExpiration)}.`;
      }
      if (!calculatedDateExpiration) e.dateExpiration = 'Saisissez la date d\'expiration.';
      else if (calculatedDateExpiration <= dateEffet) e.dateExpiration = 'La date d\'expiration doit suivre la date d\'effet.';
    }
    if (n === 2) {
      if (!maisons.length) e.maisons = 'Ajoutez au moins une maison au devis.';
      else if (maisons.some((m) => !m.code_usage)) e.maisons = 'Une maison n\'a pas d\'usage d\'occupation : modifiez-la.';
    }
    if (n === 3) {
      if (maisons.some((m) => primeNetteMaison(m) <= 0)) e.primes = 'Saisissez la prime nette de chaque maison.';
      if (!(cleanNum(taxeSaisie) > 0)) e.taxe = 'Saisissez la taxe.';
    }
    if (n === 4) {
      if (!souscripteur?.IdClient) e.souscripteur = 'Choisissez le souscripteur dans la liste.';
      if (assureDifferent && !assureChoisi?.IdClient) e.assure = 'Choisissez l\'assuré dans la liste.';
    }
    return e;
  };
  const erreurs = useMemo(() => ({
    ...(tentative[1] ? erreursEtape(1) : {}),
    ...(tentative[2] ? erreursEtape(2) : {}),
    ...(tentative[3] ? erreursEtape(3) : {}),
    ...(tentative[4] ? erreursEtape(4) : {}),
  }), [tentative, compagnieId, dateEffet, calculatedDateExpiration, maisons, primesParMaison, taxeSaisie, souscripteur, assureDifferent, assureChoisi]); // eslint-disable-line react-hooks/exhaustive-deps

  const allerA = (cible) => {
    if (cible <= step) { setStep(cible); return; }
    for (let n = step; n < cible; n += 1) {
      const e = erreursEtape(n);
      if (Object.keys(e).length) {
        setTentative((t) => ({ ...t, [n]: true }));
        setStep(n);
        toastError(Object.values(e)[0]);
        return;
      }
    }
    setStep(cible);
  };

  // ------------------------------------------------------------------ enregistrement
  const chargerRepartition = async (idDevis) => {
    const [res, detail] = await Promise.all([mrhApi.getResumeFinancier(idDevis), mrhApi.getMaisons(idDevis)]);
    setResume(res);
    setMaisonsServeur(detail?.maisons || []);
    const edits = {};
    (res?.sous_garanties_acquises || []).forEach((g) => {
      const vide = (v) => (v == null ? '' : String(Math.round(Number(v) || 0)));
      edits[`${g.id_maison}_${g.id_sous_garantie}`] = {
        id_maison: g.id_maison,
        code_sous_garantie: g.code_sous_garantie,
        libelle: reparerTexte(g.libelle_sous_garantie) || g.code_sous_garantie,
        prime_nette: String(Math.round(Number(g.prime_nette) || 0)),
        capital: vide(g.capital),
        franchise: vide(g.franchise),
        minfranchise: vide(g.minfranchise),
        maxfranchise: vide(g.maxfranchise),
        tauxfranchise: g.tauxfranchise == null ? '' : String(Number(g.tauxfranchise)),
      };
    });
    setRepartition(edits);
  };

  const handleFinalSubmit = async () => {
    for (const n of [1, 2, 3, 4]) {
      const e = erreursEtape(n);
      if (Object.keys(e).length) {
        setTentative((t) => ({ ...t, [n]: true }));
        setStep(n);
        toastError(Object.values(e)[0]);
        return;
      }
    }
    const telephoneSaisi = String(telephoneAssure || '').trim();
    const payloadApi = {
      idintermediaire: 1,
      idcompagnie: Number(compagnieId),
      idproduit: ID_PRODUIT_MRH,
      idtarif: Number(categorieId),
      idoffre: Number(usages.find((u) => u.code === maisons[0].code_usage)?.offre) || 10,
      idclient: Number(souscripteur.IdClient),
      idassure: Number(assure.IdClient),
      dateeffet: `${dateEffet}T00:00:00Z`,
      dateemission: `${dateEmission}T00:00:00Z`,
      dateexpiration: `${calculatedDateExpiration}T00:00:00Z`,
      numeropolicecompagnie: numeroPoliceCompagnie.trim(),
      numerotelephoneassure: telephoneSaisi.replace(/\D/g, '').length >= 8 ? telephoneSaisi : '',
      idterme: Number(termeId),
      idduree: Number(dureeId),
      maisons: maisons.map((m) => ({
        code_usage: m.code_usage,
        adresse: m.adresse,
        valeur_batiment: m.valeur_batiment,
        valeur_contenu: m.valeur_contenu,
        loyer_mensuel: m.loyer_mensuel,
        capital_rvt: m.capital_rvt,
        options: m.options || [],
        sous_garanties_optionnelles: m.sous_garanties_optionnelles || [],
      })),
      // Montants saisis à la main, enregistrés en prime imposée
      imposition: {
        montants_maisons: maisons.map((m) => primeNetteMaison(m)),
        montant_taxe: cleanNum(taxeSaisie),
        montant_accessoire: cleanNum(accessoireSaisi),
        motif: 'Primes saisies à la main (pas de barème MRH)',
      },
    };
    setIsSubmitting(true);
    try {
      const res = idDevisActuel ? await mrhApi.modifierDevis(idDevisActuel, payloadApi) : await mrhApi.creerDevis(payloadApi);
      const devisId = Number(res?.devis_id) || 0;
      if (!devisId) { toastError('Devis MRH non enregistré : le serveur n\'a pas renvoyé de numéro de devis.'); return; }
      success(idDevisActuel ? `Devis MRH N° ${res.numero_devis} modifié.` : `Devis MRH N° ${res.numero_devis} enregistré.`);
      if (fichier) {
        try {
          await piecesJointesApi.attacher('devis', devisId, fichier);
          setFichier(null);
          setVersionPiece((v) => v + 1);
        } catch (errFichier) {
          toastError(`Devis enregistré, mais le fichier n'a pas été joint : ${messageErreurApi(errFichier)}`);
        }
      }
      setIdDevisActuel(devisId);
      setNumeroDevisEdite(res.numero_devis || '');
      setDevisEnregistre({ id: devisId, numero: res.numero_devis, totaux: res.totaux || {} });
      try { await chargerRepartition(devisId); } catch { setResume(null); }
      setStep(6);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toastError(`Devis MRH non enregistré : ${messageErreurApi(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const enregistrerRepartition = async (idMaison) => {
    const lignes = Object.values(repartition).filter((r) => Number(r.id_maison) === Number(idMaison));
    const maison = maisonsServeur.find((m) => Number(m.maison_id) === Number(idMaison));
    const total = Math.round(Number(maison?.prime_nette) || 0);
    const somme = lignes.reduce((s, r) => s + cleanNum(r.prime_nette), 0);
    // Toutes les garanties sont envoyées : une somme inférieure ferait baisser la prime de la maison
    if (somme !== total) {
      toastError(`La somme des primes (${fcfa(somme)} F) doit être égale à la prime nette de la maison (${fcfa(total)} F).`);
      return;
    }
    const nombre = (v) => (v === '' || v == null ? null : cleanNum(v));
    setRepartitionEnCours(idMaison);
    try {
      await mrhApi.repartirGaranties(devisEnregistre.id, {
        id_maison: Number(idMaison),
        garanties: lignes.map((r) => ({
          code_sous_garantie: r.code_sous_garantie,
          montant: cleanNum(r.prime_nette),
          capital: nombre(r.capital),
          franchise: nombre(r.franchise),
          minfranchise: nombre(r.minfranchise),
          maxfranchise: nombre(r.maxfranchise),
          tauxfranchise: r.tauxfranchise === '' ? null : Number(String(r.tauxfranchise).replace(',', '.')) || 0,
        })),
      });
      success('Répartition des garanties enregistrée.');
      await chargerRepartition(devisEnregistre.id);
    } catch (err) {
      toastError(`Répartition non enregistrée : ${messageErreurApi(err)}`);
    } finally {
      setRepartitionEnCours(null);
    }
  };

  const ouvrirApercu = async () => {
    try {
      setCreatedQuote(await quoteApi.getQuote(devisEnregistre.id));
    } catch (err) {
      toastError(`Aperçu indisponible : ${messageErreurApi(err)}`);
    }
  };

  const confirmerEnContrat = async (devis) => {
    try {
      await contractApi.createContractFromQuote(devis?.iddevis || devis?.id || devisEnregistre?.id);
      success(`Devis ${devis?.numerodevis || devisEnregistre?.numero || ''} confirmé : le contrat a été créé.`);
      setCreatedQuote(null);
      navigate('/user/contracts');
    } catch (err) {
      toastError(`Le devis n'a pas pu être confirmé : ${messageErreurApi(err)}`);
    }
  };

  // ------------------------------------------------------------------ affichage
  const nomCompagnie = companies.find((c) => c.id === Number(compagnieId))?.nom || '';
  const libelleTarif = (tarifs.find((t) => Number(t.IdTarif) === Number(categorieId))?.LibelleTarif) || (Number(categorieId) === ID_TARIF_MRH ? 'MULTIRISQUE HABITATION' : `Tarif n° ${categorieId}`);
  // Rubrique du récapitulatif, avec retour à l'étape où elle se modifie
  const titreRecap = (libelle, etape) => (
    <div style={{ ...styles.sousTitre, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
      <span>{libelle}</span>
      <button type="button" onClick={() => setStep(etape)}
        style={{ background: 'transparent', border: 'none', color: 'var(--primary-500)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, textTransform: 'none', letterSpacing: 0, display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: 0 }}>
        <Edit3 size={12} /> Modifier
      </button>
    </div>
  );
  const ligneRecap = (libelle, valeur, fort) => (
    <div style={styles.ligneRecap}>
      <span style={{ color: 'var(--text-muted)' }}>{libelle}</span>
      <span style={{ textAlign: 'right', fontWeight: fort ? 800 : 600, color: 'var(--text-primary)' }}>{valeur || '-'}</span>
    </div>
  );

  if (isLoadingEdit) {
    return (
      <div className="glass-panel" style={{ ...styles.carte, maxWidth: 640, margin: '3rem auto', textAlign: 'center' }}>
        <Loader2 size={28} className="spin" style={{ color: 'var(--primary-500)' }} />
        <p style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>Chargement du devis MRH…</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1280px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* EN-TÊTE */}
      <div>
        <button type="button" className="btn btn-link" onClick={() => navigate('/user/quotes')} style={{ padding: 0, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
          <ChevronLeft size={16} /> Registre des devis
        </button>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: 0 }}>
          <Home size={26} style={{ color: 'var(--primary-500)' }} />
          {incorporation ? `Incorporation de maisons dans la police ${incorporation.NumeroPolice}`
            : step === 6 ? 'Devis Multirisques Habitation enregistré' : idDevisActuel ? 'Modification du devis Multirisques Habitation' : 'Nouveau devis Multirisques Habitation'}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.3rem 0 0' }}>
          {numeroDevisEdite
            ? <>Devis <strong>N° {numeroDevisEdite}</strong>. Les primes, la taxe et l'accessoire sont saisis à la main.</>
            : 'Une ou plusieurs maisons par devis. L\'usage de chaque maison fixe les capitaux à saisir et les garanties ; les primes, la taxe et l\'accessoire sont saisis à la main.'}
        </p>
      </div>

      {/* ÉTAPES */}
      {step <= 5 && <EtapesDevis etapes={ETAPES} etape={step} onAller={allerA} />}

      {incorporation && (
        <Alerte couleur="var(--primary-500)">
          {`Avenant d'incorporation : la police compte aujourd'hui ${incorporation.Personnes} maison${incorporation.Personnes > 1 ? 's' : ''}. `
            + `Les maisons de ce devis s'y ajoutent du ${dateFr(dateEffet)} à l'échéance inchangée du ${dateFr(incorporation.DateExpiration)}. `
            + 'Saisissez les primes dues pour cette période.'}
        </Alerte>
      )}
      {avertissementReprise && step <= 5 && <Alerte couleur="var(--accent-amber)">{avertissementReprise}</Alerte>}

      <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="glass-panel" style={{ ...styles.carte, flex: '1 1 640px', minWidth: 0 }}>
          {/* ---------------------------------------------------------- ÉTAPE 1 : CONTRAT */}
          {step === 1 && (
            <>
              <h2 style={styles.titreCarte}><FileText size={18} style={{ color: 'var(--primary-500)' }} /> Informations générales du contrat</h2>
              <div style={styles.grille}>
                <Champ label="Compagnie d'assurance" requis erreur={erreurs.compagnie} aide={incorporation ? 'Celle de la police' : undefined}>
                  <select className="form-control" value={compagnieId} disabled={Boolean(incorporation)} onChange={(e) => setCompagnieId(Number(e.target.value))}>
                    {!companies.some((c) => c.id === Number(compagnieId)) && <option value={compagnieId}>Compagnie n° {compagnieId}</option>}
                    {trierParLibelle(companies, (c) => c.nom).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </Champ>
                <Champ label="Catégorie" requis>
                  <select className="form-control" value={categorieId} onChange={(e) => setCategorieId(Number(e.target.value))}>
                    {!tarifs.some((t) => Number(t.IdTarif) === Number(categorieId)) && <option value={categorieId}>{libelleTarif}</option>}
                    {tarifs.map((t) => <option key={t.IdTarif} value={t.IdTarif}>{t.LibelleTarif}</option>)}
                  </select>
                </Champ>
                <Champ label="Numéro de police compagnie" aide="Facultatif">
                  <input type="text" className="form-control" value={numeroPoliceCompagnie} onChange={(e) => setNumeroPoliceCompagnie(e.target.value)} />
                </Champ>
              </div>
              <div style={styles.sousTitre}>Période</div>
              {incorporation ? (
                <div style={styles.grille}>
                  <Champ label="Date d'incorporation" requis erreur={erreurs.dateEffet} aide={`Au choix dans la période du contrat, du ${dateFr(incorporation.DateEffetContrat)} au ${dateFr(incorporation.DateExpiration)}`}>
                    <input type="date" className="form-control" value={dateEffet} min={incorporation.DateEffetContrat} max={incorporation.DateExpiration}
                      onChange={(e) => setDateEffet(e.target.value)} />
                  </Champ>
                  <Champ label="Date d'échéance" aide="Celle du contrat, non modifiable">
                    <input type="date" className="form-control" value={incorporation.DateExpiration} readOnly disabled />
                  </Champ>
                </div>
              ) : (
              <div style={styles.grille}>
                <Champ label="Terme du contrat">
                  <TermeContratSelect value={termeId} onChange={(t) => { setTermeId(t); setDureeId((d) => dureeSelonTerme(t, d)); }} />
                </Champ>
                <Champ label="Durée du contrat">
                  <DureeContratSelect value={dureeId} onChange={setDureeId} terme={termeId} />
                </Champ>
                <Champ label="Date d'effet" requis erreur={erreurs.dateEffet}>
                  <input type="date" className="form-control" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} />
                </Champ>
                <Champ label="Date d'expiration" requis={Number(dureeId) === 5} erreur={erreurs.dateExpiration} aide={Number(dureeId) === 5 ? 'Durée libre : à saisir' : 'Calculée selon la durée'}>
                  {Number(dureeId) === 5
                    ? <input type="date" className="form-control" min={dateEffet} value={customExpiration} onChange={(e) => setCustomExpiration(e.target.value)} />
                    : <input type="date" className="form-control" value={calculatedDateExpiration} readOnly disabled />}
                </Champ>
              </div>
              )}
            </>
          )}

          {/* ---------------------------------------------------------- ÉTAPE 2 : HABITATIONS */}
          {step === 2 && (
            <>
              {/* Import Excel : plusieurs maisons d'un coup (incorporation ou devis à nombreuses maisons) */}
              <div style={{ ...styles.bloc, marginBottom: '1.1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <FileSpreadsheet size={16} style={{ color: 'var(--primary-500)' }} /> Importer les maisons d'un fichier Excel
                    </div>
                    <div style={styles.aide}>Une ligne par maison : usage, adresse, valeurs assurées, prime nette et taxe si elles sont connues. Les maisons s'ajoutent à la liste.</div>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={telechargerModeleMaisons}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>
                    <Download size={14} /> Modèle vierge
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                  <input key={cleFichierMaisons} type="file" accept=".xlsx,.xlsm" aria-label="Fichier Excel des maisons" className="form-control"
                    style={{ flex: '1 1 260px', minWidth: 0 }} onChange={(e) => { setFichierMaisons(e.target.files?.[0] || null); setImportMaisons({ enCours: false, erreurs: [], resume: '' }); }} />
                  <button type="button" className="btn btn-primary" onClick={importerMaisons} disabled={!fichierMaisons || importMaisons.enCours}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    {importMaisons.enCours ? <Loader2 size={15} className="spin" /> : <FileSpreadsheet size={15} />}
                    {importMaisons.enCours ? 'Lecture du fichier…' : 'Importer les maisons'}
                  </button>
                </div>
                {importMaisons.resume && <div style={{ marginTop: '0.75rem' }}><Alerte couleur="var(--accent-emerald)" icone={CheckCircle2}>{importMaisons.resume}</Alerte></div>}
                {importMaisons.erreurs.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }} role="alert">
                    <Alerte couleur="var(--accent-rose)">
                      <strong>Aucune maison importée, {importMaisons.erreurs.length} ligne{importMaisons.erreurs.length > 1 ? 's' : ''} à corriger :</strong>
                      <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
                        {importMaisons.erreurs.slice(0, 15).map((e) => <li key={e.Ligne}>{`Ligne ${e.Ligne} : ${e.Message}`}</li>)}
                      </ul>
                      {importMaisons.erreurs.length > 15 && <div style={{ marginTop: '0.25rem' }}>{`Et ${importMaisons.erreurs.length - 15} autres lignes.`}</div>}
                    </Alerte>
                  </div>
                )}
              </div>

              {/* Maisons déjà ajoutées en premier ; formulaire d'ajout ouvert d'office tant qu'il n'y en a aucune */}
              {erreurs.maisons && <div style={{ marginBottom: '0.9rem' }}><Alerte couleur="var(--accent-rose)">{erreurs.maisons}</Alerte></div>}
              {maisons.length > 0 && (
                <>
                  <h2 style={styles.titreCarte}><Building size={18} style={{ color: 'var(--primary-500)' }} /> Maisons du devis ({maisons.length})</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {maisons.map((m, idx) => {
                    const ouverte = maisonOuverte === m.id;
                    return (
                      <div key={m.id} style={{ ...styles.bloc, borderColor: editingMaisonId === m.id ? 'var(--primary-500)' : 'var(--border-subtle)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Maison {idx + 1} - {m.usage_libelle || <span style={{ color: 'var(--accent-amber)' }}>usage à choisir</span>}</div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                              {[m.adresse, ...CAPITAUX.filter((c) => Number(m[c.cle]) > 0).map((c) => `${c.libelle.split(' (')[0]} ${fcfa(m[c.cle])} F`)].filter(Boolean).join(' • ')}
                            </div>
                            {(m.sous_garanties_optionnelles?.length > 0 || m.options?.length > 0) && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                                {m.sous_garanties_optionnelles?.length > 0 && `Facultatives : ${m.sous_garanties_optionnelles.length}`}
                                {m.sous_garanties_optionnelles?.length > 0 && m.options?.length > 0 && ' • '}
                                {m.options?.length > 0 && `Options : ${m.options.length}`}
                              </div>
                            )}
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Prime nette</div>
                            {primeNetteMaison(m) > 0
                              ? <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{fcfa(primeNetteMaison(m))} F</div>
                              : <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>À saisir à l'étape Tarification</div>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                          {m.garanties?.length > 0 && (
                            <button type="button" className="btn btn-secondary" onClick={() => setMaisonOuverte(ouverte ? null : m.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}>
                              <ChevronDown size={14} style={{ transform: ouverte ? 'rotate(180deg)' : undefined }} /> Garanties ({m.garanties.length})
                            </button>
                          )}
                          <button type="button" className="btn btn-secondary" onClick={() => handleEditMaison(m)} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}><Edit3 size={14} /> Modifier</button>
                          <button type="button" className="btn btn-secondary" onClick={() => handleRemoveMaison(m, idx)} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.65rem', fontSize: '0.78rem', color: 'var(--accent-rose)' }}><Trash2 size={14} /> Retirer</button>
                        </div>
                        {ouverte && m.garanties?.length > 0 && <div style={{ marginTop: '0.75rem' }}><ListeGaranties garanties={m.garanties} /></div>}
                      </div>
                    );
                  })}
                </div>
                </>
              )}
              {!maisons.length || formulaireMaison || editingMaisonId ? (
                <div style={maisons.length ? { marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border-subtle)' } : undefined}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <h2 style={{ ...styles.titreCarte, margin: 0 }}><Building size={18} style={{ color: 'var(--primary-500)' }} /> {editingMaisonId ? `Modifier la maison ${maisons.findIndex((x) => x.id === editingMaisonId) + 1}` : maisons.length ? 'Ajouter une autre maison' : 'Ajouter une maison'}</h2>
                  {(editingMaisonId || maisons.length > 0) && (
                    <button type="button" className="btn btn-secondary" onClick={() => { viderFormulaireMaison(); setFormulaireMaison(false); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>
                      <X size={14} /> {editingMaisonId ? 'Annuler la modification' : 'Fermer'}
                    </button>
                  )}
                </div>

                <div style={{ ...styles.grille, marginTop: '1.1rem' }}>
                  <Champ label="Usage de l'habitation" requis aide={currentUsage?.description}>
                    <select className="form-control" value={currentUsageCode} onChange={(e) => setCurrentUsageCode(e.target.value)} disabled={!usages.length}>
                      {!usages.length && <option value="">Chargement…</option>}
                      {trierParLibelle(usages, (u) => u.libelle).map((u) => <option key={u.code} value={u.code}>{u.libelle}</option>)}
                    </select>
                  </Champ>
                  <Champ label="Adresse de la maison" aide="Facultative">
                    <input type="text" className="form-control" maxLength={150} value={currentAdresse} onChange={(e) => setCurrentAdresse(e.target.value)} />
                  </Champ>
                </div>

                <div style={styles.sousTitre}>Valeurs assurées</div>
                <div style={styles.grille}>
                  {capitauxAffiches.map((c) => (
                    <Champ key={c.cle} label={c.libelle} requis={Boolean(parametresUsage?.[c.parametre])}>
                      <ChampMontant valeur={capitaux[c.cle]} onChange={(v) => setCapitaux((prev) => ({ ...prev, [c.cle]: v }))} />
                    </Champ>
                  ))}
                </div>

                {garantiesUsage.obligatoires.length > 0 && (
                  <>
                    <div style={styles.sousTitre}>Garanties incluses ({garantiesUsage.obligatoires.length})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {garantiesUsage.obligatoires.map((g) => (
                        <span key={g.code} style={{ ...styles.pastille('var(--accent-emerald)'), padding: '0.3rem 0.65rem' }}>
                          <ShieldCheck size={12} /> {g.libelle}
                        </span>
                      ))}
                    </div>
                  </>
                )}

                {garantiesUsage.optionnelles.length > 0 && (
                  <>
                    <div style={styles.sousTitre}>Garanties facultatives</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 210px), 1fr))', gap: '0.5rem' }}>
                      {garantiesUsage.optionnelles.map((g) => {
                        const code = g.code_sous_garantie || g.code;
                        const actif = selectedGaranties.includes(code);
                        return (
                          <label key={code} style={styles.choix(actif)}>
                            <input type="checkbox" checked={actif} style={{ marginTop: 2, accentColor: 'var(--primary-500)' }}
                              onChange={() => setSelectedGaranties((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]))} />
                            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>{g.libelle || code}</span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}

                {availableOptions.length > 0 && (
                  <>
                    <div style={styles.sousTitre}>Options</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))', gap: '0.5rem' }}>
                      {availableOptions.map((o) => {
                        const code = o.code_option || o.code;
                        const actif = selectedOptions.includes(code);
                        return (
                          <label key={code} style={styles.choix(actif)}>
                            <input type="checkbox" checked={actif} style={{ marginTop: 2, accentColor: 'var(--primary-500)' }}
                              onChange={() => setSelectedOptions((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]))} />
                            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>{o.libelle || code}</span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                  <button type="button" className="btn btn-primary" onClick={handleSaveMaison} disabled={calculMaisonEnCours} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    {calculMaisonEnCours ? <Loader2 size={16} className="spin" /> : editingMaisonId ? <CheckCircle2 size={16} /> : <Plus size={16} />}
                    {editingMaisonId ? 'Enregistrer la maison' : 'Ajouter la maison'}
                  </button>
                </div>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => setFormulaireMaison(true)}
                  style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Plus size={16} /> Ajouter une autre maison
                </button>
              )}
            </>
          )}

          {/* ---------------------------------------------------------- ÉTAPE 3 : TARIFICATION */}
          {step === 3 && (
            <>
              <h2 style={styles.titreCarte}><Calculator size={18} style={{ color: 'var(--primary-500)' }} /> Tarification</h2>
              <Alerte couleur="var(--primary-500)" icone={Info}>
                Pas de barème MRH : saisissez la prime nette de chaque maison, puis la taxe et l'accessoire du devis.
              </Alerte>

              <div style={styles.sousTitre}>Prime nette de chaque maison</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.tableau}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Maison</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Prime nette</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maisons.map((m, idx) => (
                      <tr key={m.id}>
                        <td style={styles.td}><strong>Maison {idx + 1}</strong> <span style={{ color: 'var(--text-muted)' }}>{m.usage_libelle}{m.adresse ? `, ${m.adresse}` : ''}</span></td>
                        <td style={{ ...styles.td, width: 240 }}>
                          <ChampMontant valeur={primesParMaison[m.id] || ''} placeholder="À saisir"
                            onChange={(v) => setPrimesParMaison((prev) => ({ ...prev, [m.id]: v }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {erreurs.primes && <div style={{ marginTop: '0.6rem' }}><Alerte couleur="var(--accent-rose)">{erreurs.primes}</Alerte></div>}

              <div style={styles.sousTitre}>Taxe et accessoire</div>
              <div style={styles.grille}>
                <Champ label="Taxe" requis erreur={erreurs.taxe}>
                  <ChampPropose onChoisir={(v) => setTaxeSaisie(String(v))} propositions={taxesProposees}>
                    <ChampMontant valeur={taxeSaisie} onChange={setTaxeSaisie} placeholder="À saisir" />
                  </ChampPropose>
                </Champ>
                <Champ label="Accessoire" aide="Vide : pas d'accessoire">
                  <ChampPropose onChoisir={(v) => setAccessoireSaisi(String(v))} propositions={accessoiresUsuels}>
                    <ChampMontant valeur={accessoireSaisi} onChange={setAccessoireSaisi} placeholder="À saisir" />
                  </ChampPropose>
                </Champ>
              </div>
              <p style={styles.aide}>
                À l'enregistrement, la prime nette de chaque maison est répartie sur ses garanties ; la répartition reste ajustable ensuite,
                garantie par garantie.
              </p>

              <div style={styles.sousTitre}>Décompte</div>
              <div style={styles.tuiles}>
                <Tuile libelle="Prime nette" valeur={`${fcfa(totalsFinanciers.primeNette)} F`} />
                <Tuile libelle="Taxe" valeur={`${fcfa(totalsFinanciers.taxes)} F`} />
                <Tuile libelle="Accessoire" valeur={`${fcfa(totalsFinanciers.accessoires)} F`} />
                <Tuile libelle="Prime TTC" valeur={`${fcfa(totalsFinanciers.primeTtc)} F`} couleur="var(--primary-500)" fort />
              </div>
            </>
          )}

          {/* ---------------------------------------------------------- ÉTAPE 4 : SOUSCRIPTEUR */}
          {step === 4 && (
            <>
              <h2 style={styles.titreCarte}><Users size={18} style={{ color: 'var(--primary-500)' }} /> Souscripteur & assuré</h2>
              {incorporation ? (
                <>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>Souscripteur et assuré de la police {incorporation.NumeroPolice}, non modifiables.</p>
                  {souscripteur && <FichePersonne personne={souscripteur} />}
                  {assureDifferent && assureChoisi && <div style={{ marginTop: '0.75rem' }}><FichePersonne personne={assureChoisi} /></div>}
                </>
              ) : (
              <>
              <div style={styles.grille}>
                <RechercheClient label="Souscripteur (client)" personne={souscripteur} erreur={erreurs.souscripteur}
                  onChoisir={(p) => { setSouscripteur(p); if (!assureDifferent) setTelephoneAssure(p?.Telephone || ''); }}
                  onNouveau={() => setNouveauClientPour('souscripteur')} />
              </div>
              {souscripteur && <div style={{ marginTop: '0.75rem' }}><FichePersonne personne={souscripteur} /></div>}

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '1.25rem', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={assureDifferent} onChange={(e) => { setAssureDifferent(e.target.checked); if (!e.target.checked) setTelephoneAssure(souscripteur?.Telephone || ''); }} style={{ width: 17, height: 17, accentColor: 'var(--primary-500)' }} />
                L'assuré est une autre personne que le souscripteur
              </label>
              {assureDifferent && (
                <>
                  <div style={{ ...styles.grille, marginTop: '1rem' }}>
                    <RechercheClient label="Assuré" personne={assureChoisi} erreur={erreurs.assure}
                      onChoisir={(p) => { setAssureChoisi(p); setTelephoneAssure(p?.Telephone || ''); }}
                      onNouveau={() => setNouveauClientPour('assure')} />
                  </div>
                  {assureChoisi && <div style={{ marginTop: '0.75rem' }}><FichePersonne personne={assureChoisi} /></div>}
                </>
              )}
              </>
              )}
              <div style={{ ...styles.grille, marginTop: '1rem' }}>
                <Champ label="Téléphone de l'assuré" aide="Enregistré comme mobile de la fiche client de l'assuré (8 chiffres au moins)">
                  <input type="tel" className="form-control" value={telephoneAssure} onChange={(e) => setTelephoneAssure(e.target.value)} />
                </Champ>
              </div>
            </>
          )}

          {/* ---------------------------------------------------------- ÉTAPE 5 : RÉCAPITULATIF */}
          {step === 5 && (
            <>
              <h2 style={styles.titreCarte}><FileCheck size={18} style={{ color: 'var(--primary-500)' }} /> Récapitulatif avant enregistrement</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '1rem 2rem' }}>
                <div>
                  {titreRecap('Client', 4)}
                  {ligneRecap('Souscripteur', souscripteur?.Nom)}
                  {ligneRecap('Assuré', assure?.Nom)}
                  {ligneRecap('Téléphone assuré', telephoneAssure)}
                  {titreRecap('Contrat', 1)}
                  {ligneRecap('Compagnie', nomCompagnie)}
                  {ligneRecap('Catégorie', libelleTarif)}
                  {ligneRecap('N° police compagnie', numeroPoliceCompagnie)}
                  {ligneRecap('Période', `du ${dateFr(dateEffet)} au ${dateFr(calculatedDateExpiration)}`)}
                </div>
                <div>
                  {titreRecap('Prime', 3)}
                  {ligneRecap('Maisons', maisons.length)}
                  {ligneRecap('Prime nette', `${fcfa(totalsFinanciers.primeNette)} F`)}
                  {ligneRecap('Taxes', `${fcfa(totalsFinanciers.taxes)} F`)}
                  {ligneRecap('Accessoire', `${fcfa(totalsFinanciers.accessoires)} F`)}
                  {ligneRecap('Prime TTC', `${fcfa(totalsFinanciers.primeTtc)} F`, true)}
                </div>
              </div>
              {titreRecap('Habitations', 2)}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {maisons.map((m, idx) => (
                  <div key={m.id} style={{ ...styles.bloc, display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.83rem' }}>
                    <span><strong>Maison {idx + 1}</strong> - {m.usage_libelle}{m.adresse ? ` - ${m.adresse}` : ''}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fcfa(primeNetteMaison(m))} F</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '1rem' }}>
                <Champ
                  label="Pièce jointe"
                  aide={fichier
                    ? `Jointe à l'enregistrement : ${fichier.name}${idDevisActuel ? ' (remplace la pièce enregistrée)' : ''}`
                    : 'Facultatif : PDF ou image, consultable ensuite depuis la fiche du devis et du contrat'}
                >
                  <input type="file" className="form-control" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFichier(e.target.files?.[0] || null)} />
                </Champ>
              </div>
              {idDevisActuel && (
                <PieceJointe type="devis" id={idDevisActuel} version={versionPiece} masquerSiAbsente titre="Pièce jointe enregistrée" className="piece-jointe-saisie" />
              )}
            </>
          )}

          {/* ---------------------------------------------------------- DEVIS ENREGISTRÉ : RÉPARTITION */}
          {step === 6 && devisEnregistre && (
            <>
              <h2 style={styles.titreCarte}><CheckCircle2 size={18} style={{ color: 'var(--accent-emerald)' }} /> Devis N° {devisEnregistre.numero} enregistré</h2>
              {resume && (
                <div style={styles.tuiles}>
                  <Tuile libelle="Maisons" valeur={resume.statistiques?.nombre_maisons ?? maisonsServeur.length} />
                  <Tuile libelle="Prime nette" valeur={`${fcfa(resume.prime_nette_totale)} F`} />
                  <Tuile libelle="Taxes" valeur={`${fcfa(resume.taxe_totale)} F`} />
                  <Tuile libelle="Accessoire" valeur={`${fcfa(resume.accessoire)} F`} />
                  <Tuile libelle="Prime TTC" valeur={`${fcfa(resume.prime_ttc)} F`} couleur="var(--primary-500)" fort />
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '1rem 0' }}>
                <button type="button" className="btn btn-secondary" onClick={ouvrirApercu} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Eye size={15} /> Aperçu et impressions</button>
                <BoutonPieceJointe type="devis" id={devisEnregistre.id} version={versionPiece} />
                <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Edit3 size={15} /> Modifier le devis</button>
                <button type="button" className="btn btn-primary" onClick={() => confirmerEnContrat(null)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><CheckCircle2 size={15} /> Confirmer en contrat</button>
              </div>

              <div style={styles.sousTitre}>Répartition des garanties par maison</div>
              <p style={{ ...styles.aide, marginTop: 0 }}>
                La prime nette de chaque maison peut être répartie entre ses garanties, et leurs capitaux et franchises renseignés.
                La somme des primes doit être égale à la prime nette de la maison ; la taxe de chaque garantie est recalculée par le serveur.
              </p>
              {!resume && <Alerte couleur="var(--accent-amber)">Résumé financier indisponible pour ce devis.</Alerte>}
              {maisonsServeur.map((m, idx) => {
                const lignes = Object.entries(repartition).filter(([, r]) => Number(r.id_maison) === Number(m.maison_id));
                const total = Math.round(Number(m.prime_nette) || 0);
                const somme = lignes.reduce((s, [, r]) => s + cleanNum(r.prime_nette), 0);
                const ecart = total - somme;
                const maj = (cle, champ, valeur) => setRepartition((prev) => ({ ...prev, [cle]: { ...prev[cle], [champ]: valeur } }));
                // Même règle que le reliquat du serveur : au prorata des primes actuelles des garanties
                const auProrata = () => setRepartition((prev) => {
                  const suivant = { ...prev };
                  let reste = total;
                  lignes.forEach(([cle, r], i) => {
                    const part = i === lignes.length - 1 ? reste
                      : Math.round(somme > 0 ? (total * cleanNum(r.prime_nette)) / somme : total / lignes.length);
                    reste -= part;
                    suivant[cle] = { ...r, prime_nette: String(part) };
                  });
                  return suivant;
                });
                return (
                  <div key={m.maison_id} style={{ ...styles.bloc, marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.6rem' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>Maison {idx + 1} - {m.usage_libelle}{m.adresse ? ` - ${m.adresse}` : ''}</strong>
                      <span style={styles.pastille(ecart === 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)')}>
                        {ecart === 0 ? `Répartis ${fcfa(somme)} / ${fcfa(total)} F` : ecart > 0 ? `Reste à répartir ${fcfa(ecart)} F` : `Dépassement de ${fcfa(-ecart)} F`}
                      </span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ ...styles.tableau, minWidth: 760 }}>
                        <thead>
                          <tr>
                            <th style={styles.th}>Garantie</th>
                            {['Prime nette', 'Capital', 'Franchise', 'Franchise min.', 'Franchise max.', 'Taux franchise (%)'].map((l) => <th key={l} style={{ ...styles.th, textAlign: 'right' }}>{l}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {lignes.map(([cle, r]) => (
                            <tr key={cle}>
                              <td style={{ ...styles.td, fontWeight: 600 }}>{r.libelle}</td>
                              {['prime_nette', 'capital', 'franchise', 'minfranchise', 'maxfranchise'].map((champ) => (
                                <td key={champ} style={{ ...styles.td, width: 120 }}>
                                  <input type="text" inputMode="numeric" className="form-control" style={{ textAlign: 'right', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                                    value={r[champ] === '' ? '' : fcfa(r[champ])} onChange={(e) => maj(cle, champ, chiffres(e.target.value))} />
                                </td>
                              ))}
                              <td style={{ ...styles.td, width: 100 }}>
                                <input type="text" inputMode="decimal" className="form-control" style={{ textAlign: 'right', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                                  value={r.tauxfranchise} onChange={(e) => maj(cle, 'tauxfranchise', e.target.value.replace(/[^0-9.,]/g, ''))} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                      {ecart !== 0 && lignes.length > 0 && (
                        <button type="button" className="btn btn-secondary" onClick={auProrata} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                          <Scale size={14} /> Ajuster au prorata
                        </button>
                      )}
                      <button type="button" className="btn btn-secondary" disabled={repartitionEnCours === m.maison_id || ecart !== 0} onClick={() => enregistrerRepartition(m.maison_id)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                        {repartitionEnCours === m.maison_id ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} Enregistrer la répartition de cette maison
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* NAVIGATION */}
          {step <= 5 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '1.75rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => (step > 1 ? setStep(step - 1) : navigate('/user/quotes'))} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <ChevronLeft size={16} /> {step > 1 ? 'Précédent' : 'Annuler'}
              </button>
              {step < 5 ? (
                <button type="button" className="btn btn-primary" onClick={() => allerA(step + 1)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  Suivant <ChevronRight size={16} />
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={handleFinalSubmit} disabled={isSubmitting} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 800 }}>
                  {isSubmitting ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                  {idDevisActuel ? 'Enregistrer les modifications' : 'Enregistrer le devis'}
                </button>
              )}
            </div>
          )}
          {step === 6 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/user/quotes')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><ChevronLeft size={16} /> Registre des devis</button>
              <button type="button" className="btn btn-secondary" onClick={() => window.location.assign('/user/quotes/mrh')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Plus size={16} /> Nouveau devis MRH</button>
            </div>
          )}
        </div>

        {/* RÉSUMÉ PERMANENT */}
        {step <= 5 && (
          <ResumeDevis
            icone={Home}
            lignes={[
              ['Compagnie', nomCompagnie],
              ['Période', dateEffet && calculatedDateExpiration ? `${dateFr(dateEffet)} → ${dateFr(calculatedDateExpiration)}` : ''],
              ['Maisons', maisons.length || ''],
              ['Souscripteur', souscripteur?.Nom],
            ]}
            montant={maisons.length ? `${fcfa(totalsFinanciers.primeTtc)} F` : null}
            detail={maisons.length > 0 ? `dont prime nette ${fcfa(totalsFinanciers.primeNette)} F` : null}
          />
        )}
      </div>

      {createdQuote && (
        <ViewQuoteModal isOpen={Boolean(createdQuote)} quote={createdQuote} onClose={() => setCreatedQuote(null)} onConvertToContract={confirmerEnContrat} />
      )}

      <QuickAddClientModal
        isOpen={Boolean(nouveauClientPour)}
        onClose={() => setNouveauClientPour(null)}
        onClientCreated={(client) => {
          const personne = personneDepuisClient(client);
          if (personne?.IdClient) {
            if (nouveauClientPour === 'assure') setAssureChoisi(personne); else setSouscripteur(personne);
            setTelephoneAssure(personne.Telephone || '');
          }
          setNouveauClientPour(null);
        }}
      />
    </div>
  );
};

export default NewMrhQuotePage;
