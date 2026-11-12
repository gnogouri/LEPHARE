import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useNavigate } from '../../../utils/navigationDevis';
import {
  Ship, Plane, Truck, TrainFront, Sailboat, Route, CalendarRange, Repeat, FileSignature, Package, ShieldCheck,
  ClipboardCheck, ChevronLeft, ChevronRight, CheckCircle2, Loader2, Info, AlertTriangle, UserPlus, Plus, Trash2,
  Settings2, MapPin, ClipboardList,
} from 'lucide-react';
import { contractApi, quoteApi, transportHorsGuceApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { ViewQuoteModal } from './ViewQuoteModal';
import { QuickAddClientModal } from '../clients/QuickAddClientModal';
import { BandeauQuestionnaire, useQuestionnaireDevis } from './QuestionnaireDevis';
import { AmountInput } from '../../../components/common/AmountInput';
import { Champ, RechercheClient, personneDepuisClient } from '../../../components/common/RechercheClient';
import { numberToFrenchWords } from '../../../utils/exportUtils';
import { trierParLibelle } from '../../../utils/sortUtils';

// Cotation Transport hors GUCE (production/views_transport_hors_guce.py), d'après le document OREOLE
// « TRANSPORTS.docx » : prospect, marchandise, conditionnement, départ, arrivée, valeur, garantie souhaitée et mode
// de chargement. Cinq étapes, le décompte de la prime suit la saisie (même calcul que l'enregistrement).

const ETAPES = [
  { id: 'police', libelle: 'Police', icone: FileSignature },
  { id: 'marchandise', libelle: 'Marchandise', icone: Package },
  { id: 'trajet', libelle: 'Trajet', icone: Route },
  { id: 'garanties', libelle: 'Garanties et prime', icone: ShieldCheck },
  { id: 'recap', libelle: 'Récapitulatif', icone: ClipboardCheck },
];
const ICONES_MODE = { MARITIME: Ship, AERIEN: Plane, TERRESTRE: Truck, FERROVIAIRE: TrainFront, FLUVIAL: Sailboat };
const ICONES_POLICE = { VOYAGE: Route, ANNUELLE: CalendarRange, ABONNEMENT: Repeat };
const DETAIL_POLICE = {
  VOYAGE: 'Du départ à l\'arrivée prévue',
  ANNUELLE: 'Un an, prime sur la valeur des envois de l\'année',
  ABONNEMENT: 'Un an, chaque voyage déclaré est facturé au mois',
};

const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
const pourcent = (v) => `${Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 4 })} %`;
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const decaler = (iso, { jours = 0, ans = 0 }) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  d.setFullYear(d.getFullYear() + ans);
  d.setDate(d.getDate() + jours);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const ecartJours = (debut, fin) => (debut && fin ? Math.round((new Date(fin) - new Date(debut)) / 86400000) : null);
const messageErreurApi = (err) => {
  const data = err?.response?.data;
  if (!data) return err?.message || 'serveur injoignable';
  if (typeof data === 'string') return data.slice(0, 200);
  return data.error || data.detail || data.message || JSON.stringify(data);
};

const MARCHANDISE_VIDE = { nature: '', etat: '', emballage: '', conditionnement: '', risques: [], poids: '' };
const TRAJET_VIDE = { depart: '', embarquement: '', debarquement: '', arrivee: '', chargement: '', moyen: '', document: '' };

// Choix exclusif en cartes ou en tuiles, au clavier comme à la souris (flèches pour passer d'une option à l'autre)
const GroupeChoix = ({ libelle, options, valeur, onChange, classe = 'trp-choix', rendu }) => {
  const refs = useRef([]);
  const deplacer = (e, i) => {
    const pas = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!pas) return;
    e.preventDefault();
    const suivant = (i + pas + options.length) % options.length;
    onChange(options[suivant].Code);
    refs.current[suivant]?.focus();
  };
  const actif = options.findIndex((o) => o.Code === valeur);
  return (
    <div role="radiogroup" aria-label={libelle} className={classe}>
      {options.map((o, i) => (
        <button key={o.Code} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={o.Code === valeur}
          tabIndex={o.Code === valeur || (actif < 0 && i === 0) ? 0 : -1}
          className={classe === 'trp-modes' ? 'trp-mode' : 'trp-choix-carte'}
          onClick={() => onChange(o.Code)} onKeyDown={(e) => deplacer(e, i)}>
          {rendu(o)}
        </button>
      ))}
    </div>
  );
};

// Liste de valeurs courantes avec « Autre » en saisie libre
const ListeOuAutre = ({ options, valeur, onChange, placeholder }) => {
  const [autre, setAutre] = useState(Boolean(valeur) && !options.includes(valeur));
  useEffect(() => { if (valeur && !options.includes(valeur)) setAutre(true); }, [valeur, options]);
  return (
    <div style={{ display: 'grid', gap: '0.4rem' }}>
      <select className="form-control" value={autre ? '__autre' : valeur}
        onChange={(e) => {
          if (e.target.value === '__autre') { setAutre(true); onChange(''); } else { setAutre(false); onChange(e.target.value); }
        }}>
        <option value="">{placeholder || 'Choisir…'}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value="__autre">Autre, à préciser</option>
      </select>
      {autre && <input type="text" className="form-control" maxLength={120} value={valeur} autoFocus placeholder="Précisez" onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
};

const LigneRecap = ({ libelle, valeur, fort }) => (
  <div className={`trp-recap-ligne${fort ? ' fort' : ''}`}><span>{libelle}</span><span>{valeur || '-'}</span></div>
);

export const NewTransportHorsGucePage = () => {
  const navigate = useNavigate();
  const { peut } = useAuth();
  const { success, error: toastError, warning } = useToast();
  const [parametres] = useSearchParams();
  const editParam = parametres.get('edit');

  const [catalogue, setCatalogue] = useState(null);
  const [etape, setEtape] = useState(0);
  const [atteinte, setAtteinte] = useState(0); // dernière étape ouverte (les précédentes sont validées)
  const [essais, setEssais] = useState({}); // étapes dont on a tenté de sortir : erreurs affichées
  const [chargementEdition, setChargementEdition] = useState(Boolean(editParam));
  const [idDevisEdite, setIdDevisEdite] = useState(0);
  const [numeroDevisEdite, setNumeroDevisEdite] = useState('');

  // Étape 1 : police
  const [typePolice, setTypePolice] = useState('');
  const [mode, setMode] = useState('');
  const [compagnie, setCompagnie] = useState(0);
  const [souscripteur, setSouscripteur] = useState(null);
  const [assureDistinct, setAssureDistinct] = useState(false);
  const [assureChoisi, setAssureChoisi] = useState(null);
  const assure = (assureDistinct && assureChoisi) || souscripteur;
  const [dateEffet, setDateEffet] = useState(aujourdhui());
  const [dateFin, setDateFin] = useState(decaler(aujourdhui(), { jours: 30 }));
  const [numeroPoliceCompagnie, setNumeroPoliceCompagnie] = useState('');
  const [nouveauClientPour, setNouveauClientPour] = useState(null);
  // Étapes 2 et 3 : marchandise, trajet
  const [marchandise, setMarchandise] = useState(MARCHANDISE_VIDE);
  const [trajet, setTrajet] = useState(TRAJET_VIDE);
  const [vehicules, setVehicules] = useState([]);
  // Étape 4 : valeur, garanties, prime
  const [valeur, setValeur] = useState(0);
  const [chiffreAffaires, setChiffreAffaires] = useState(0);
  const [base, setBase] = useState('');
  const [extensions, setExtensions] = useState([]);
  const [taux, setTaux] = useState({}); // taux saisis (sinon : taux proposé par le réglage)
  const [franchise, setFranchise] = useState('');
  const [accessoireImpose, setAccessoireImpose] = useState(false);
  const [accessoire, setAccessoire] = useState(0);
  const [exonere, setExonere] = useState(false);
  const [calcul, setCalcul] = useState(null);
  const [calculEnCours, setCalculEnCours] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [devisEnregistre, setDevisEnregistre] = useState(null);

  const periodeAnnuelle = typePolice === 'ANNUELLE' || typePolice === 'ABONNEMENT';
  // Police annuelle ou d'abonnement : un an à partir de la date d'effet ; police au voyage : un mois proposé. Un devis
  // rouvert garde ses dates (finGardee).
  const finGardee = useRef(false);
  useEffect(() => {
    if (finGardee.current) { finGardee.current = false; return; }
    if (!dateEffet) return;
    if (periodeAnnuelle) setDateFin(decaler(dateEffet, { ans: 1, jours: -1 }));
    else if (typePolice === 'VOYAGE' && ecartJours(dateEffet, dateFin) > 180) setDateFin(decaler(dateEffet, { jours: 30 }));
  }, [typePolice, dateEffet]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ catalogue
  useEffect(() => {
    let actif = true;
    transportHorsGuceApi.getCatalogue()
      .then((c) => {
        if (!actif) return;
        setCatalogue(c);
        setCompagnie((x) => x || Number(c.IdCompagnie) || 0);
      })
      .catch((err) => { if (actif) toastError(`Catalogue Transport indisponible : ${messageErreurApi(err)}`); });
    return () => { actif = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const modes = catalogue?.Modes || [];
  const modeChoisi = modes.find((m) => m.Code === mode) || null;
  const typesPolice = catalogue?.TypesPolice || [];
  const typeChoisi = typesPolice.find((t) => t.Code === typePolice) || null;
  const garanties = catalogue?.Garanties || [];
  const garantiesBase = garanties.filter((g) => g.Groupe === 'BASE');
  const garantiesExtension = garanties.filter((g) => g.Groupe === 'EXTENSION');
  const listes = catalogue?.Listes || {};
  const compagnies = useMemo(
    () => trierParLibelle((catalogue?.Compagnies || []).map((c) => ({ id: Number(c.IdCompagnie), nom: c.RaisonSociale, usuelle: c.ContratsTransport > 0 })), (c) => c.nom),
    [catalogue],
  );
  const nomCompagnie = compagnies.find((c) => c.id === Number(compagnie))?.nom || '';
  // Taux proposé par les Réglages Transport pour le mode choisi (null : à saisir) ; TauxMinimum : c'est un plancher
  const tauxPropose = (g) => (mode ? g?.Taux?.[mode] ?? null : null);
  const tauxMinimum = (g) => (g?.TauxMinimum ? tauxPropose(g) : null);
  const tauxRetenu = (g) => {
    const saisi = taux[g.Code];
    if (saisi !== undefined && saisi !== '') return Number(saisi);
    return tauxPropose(g);
  };

  // ------------------------------------------------------------------ questionnaire du prospect
  const qd = useQuestionnaireDevis();
  const reprendreQuestionnaire = () => {
    const d = qd.devis || {};
    if (d.type_police) setTypePolice(d.type_police);
    if (d.mode) setMode(d.mode);
    setMarchandise((m) => ({ ...m, nature: d.nature || m.nature, emballage: d.emballage || m.emballage, conditionnement: d.conditionnement || m.conditionnement }));
    setTrajet((t) => ({ ...t, depart: d.depart || t.depart, embarquement: d.embarquement || t.embarquement, debarquement: d.debarquement || t.debarquement, arrivee: d.arrivee || t.arrivee }));
    if (d.valeur) setValeur(Math.round(Number(d.valeur)));
    if (d.chiffre_affaires) setChiffreAffaires(Math.round(Number(d.chiffre_affaires)));
    if (d.base) setBase(d.base);
    if (d.extensions?.length) setExtensions(d.extensions);
    if (d.franchise) setFranchise(d.franchise);
    success('Réponses du questionnaire reprises : vérifiez chaque étape.');
  };
  useEffect(() => {
    if (devisEnregistre && qd.actif) qd.devisEtabli(devisEnregistre.numerodevis || '');
  }, [devisEnregistre]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ « Modifier » depuis le registre (?edit=)
  useEffect(() => {
    if (!editParam) return undefined;
    let actif = true;
    (async () => {
      try {
        const d = await transportHorsGuceApi.lireDevis(editParam);
        if (!actif) return;
        if (d.Confirme) {
          toastError('Ce devis est confirmé (déjà en contrat) : il ne peut plus être modifié.');
          navigate('/user/quotes');
          return;
        }
        const s = d.Saisie || {};
        finGardee.current = true;
        setIdDevisEdite(Number(d.IdDevis));
        setNumeroDevisEdite(d.NumeroDevis || '');
        setTypePolice(d.TypePolice);
        setMode(d.Mode);
        setCompagnie(Number(d.IdCompagnie) || 0);
        const client = personneDepuisClient(d.Client);
        const assureLu = personneDepuisClient(d.Assure);
        setSouscripteur(client);
        if (assureLu && client && assureLu.IdClient !== client.IdClient) { setAssureDistinct(true); setAssureChoisi(assureLu); }
        setDateEffet(String(d.DateEffet || '').slice(0, 10));
        setDateFin(String(d.DateExpiration || '').slice(0, 10));
        setNumeroPoliceCompagnie(d.NumeroPoliceCompagnie || '');
        const m = s.marchandise || {};
        setMarchandise({ nature: m.nature || '', etat: m.etat || '', emballage: m.emballage || '', conditionnement: m.conditionnement || '', risques: m.risques_speciaux || [], poids: m.poids || '' });
        setTrajet({ ...TRAJET_VIDE, ...(s.trajet || {}) });
        setVehicules((s.vehicules || []).map((v) => ({ marque: v.marque || '', immatriculation: v.immatriculation || '', chargeUtile: v.charge_utile || '', valeur: v.valeur || 0 })));
        setValeur(Math.round(Number(s.valeur) || 0));
        setChiffreAffaires(Math.round(Number(s.chiffre_affaires) || 0));
        const g = s.garanties || {};
        setBase(g.base?.code || '');
        setExtensions((g.extensions || []).map((x) => x.code));
        setTaux(Object.fromEntries([g.base, ...(g.extensions || [])].filter((x) => x?.code).map((x) => [x.code, String(x.taux)])));
        setFranchise(s.franchise || '');
        setAccessoireImpose(s.accessoire_impose !== null && s.accessoire_impose !== undefined);
        setAccessoire(Math.round(Number(s.accessoire_impose) || 0));
        setExonere(Boolean(s.exonere_taxe));
        setAtteinte(ETAPES.length - 1);
      } catch (err) {
        if (actif) {
          toastError(`Devis non chargé : ${messageErreurApi(err)}`);
          navigate('/user/quotes');
        }
      } finally {
        if (actif) setChargementEdition(false);
      }
    })();
    return () => { actif = false; };
  }, [editParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ décompte (même calcul que l'enregistrement)
  const garantiesPayload = useMemo(() => ({
    Base: base ? { Code: base, Taux: taux[base] !== undefined && taux[base] !== '' ? Number(taux[base]) : null } : null,
    Extensions: extensions.map((c) => ({ Code: c, Taux: taux[c] !== undefined && taux[c] !== '' ? Number(taux[c]) : null })),
  }), [base, extensions, taux]);
  useEffect(() => {
    if (!typePolice || !mode || !compagnie || !(Number(valeur) > 0) || !base) {
      setCalcul(null);
      return undefined;
    }
    let actif = true;
    const minuterie = setTimeout(async () => {
      setCalculEnCours(true);
      try {
        const r = await transportHorsGuceApi.calculer({
          TypePolice: typePolice, Mode: mode, IdCompagnie: Number(compagnie), Valeur: Number(valeur),
          Garanties: garantiesPayload, Accessoire: accessoireImpose ? Number(accessoire) || 0 : null, ExonereTaxe: exonere,
        });
        if (actif) setCalcul(r);
      } catch (err) {
        if (actif) setCalcul({ erreur: messageErreurApi(err) });
      } finally {
        if (actif) setCalculEnCours(false);
      }
    }, 320);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [typePolice, mode, compagnie, valeur, garantiesPayload, accessoireImpose, accessoire, exonere]);
  const ok = calcul && !calcul.erreur ? calcul : null;
  const voyageType = ok?.ParVoyage || null;
  const primeLigne = (code) => (ok?.Lignes || []).find((l) => l.Code === code);

  // ------------------------------------------------------------------ contrôles par étape
  const erreursEtape = (i) => {
    const e = {};
    if (i === 0) {
      if (!typePolice) e.typePolice = 'Choisissez le type de police.';
      if (!mode) e.mode = 'Choisissez le mode de transport.';
      if (!compagnie) e.compagnie = 'Choisissez la compagnie.';
      if (!souscripteur?.IdClient) e.souscripteur = 'Choisissez le prospect dans la liste des clients, ou créez-le.';
      if (assureDistinct && !assureChoisi?.IdClient) e.assure = 'Choisissez l\'assuré.';
      if (!dateEffet) e.dateEffet = typePolice === 'VOYAGE' ? 'Saisissez la date de départ.' : 'Saisissez la date d\'effet.';
      if (!dateFin) e.dateFin = 'Saisissez la date de fin.';
      else if (ecartJours(dateEffet, dateFin) < 0) e.dateFin = 'La date de fin doit suivre la date de début.';
      else if (periodeAnnuelle && ecartJours(dateEffet, dateFin) > 400) e.dateFin = 'Un an au plus.';
    }
    if (i === 1) {
      if (!marchandise.nature.trim()) e.nature = 'Décrivez la marchandise.';
      if (!marchandise.conditionnement.trim()) e.conditionnement = 'Indiquez le conditionnement.';
    }
    if (i === 2) {
      if (!trajet.depart.trim()) e.depart = 'Indiquez le point de départ.';
      if (!trajet.arrivee.trim()) e.arrivee = 'Indiquez le point d\'arrivée.';
      if (!trajet.chargement.trim()) e.chargement = 'Choisissez le mode de chargement.';
    }
    if (i === 3) {
      if (!(Number(valeur) > 0)) e.valeur = `${typeChoisi?.Valeur || 'Valeur'} : à renseigner.`;
      if (!base) e.base = 'Choisissez la garantie de base.';
      [base, ...extensions].filter(Boolean).forEach((code) => {
        const g = garanties.find((x) => x.Code === code);
        const t = g ? tauxRetenu(g) : null;
        if (!(Number(t) > 0)) e[`taux_${code}`] = 'Taux à saisir.';
        else if (tauxMinimum(g) !== null && Number(t) < tauxMinimum(g)) e[`taux_${code}`] = `${pourcent(tauxMinimum(g))} au moins.`;
      });
      if (!Object.keys(e).length) {
        if (calculEnCours) e.calcul = 'Calcul de la prime en cours…';
        else if (calcul?.erreur) e.calcul = calcul.erreur;
        else if (!ok) e.calcul = 'Prime non calculée.';
      }
    }
    return e;
  };
  const erreurs = essais[etape] ? erreursEtape(etape) : {};

  // Étape incomplète : la première rubrique en erreur est amenée à l'écran et reçoit le focus
  const montrerErreur = () => {
    requestAnimationFrame(() => {
      const cible = document.querySelector('.trp-panneau .champ-message.erreur, .trp-panneau small.erreur, .trp-panneau .trp-note.erreur');
      if (!cible) return;
      cible.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const bloc = cible.closest('.form-group, .trp-garantie') || cible.previousElementSibling;
      bloc?.querySelector?.('input, select, textarea, button')?.focus({ preventScroll: true });
    });
  };

  const allerA = (i) => {
    if (i <= atteinte || i <= etape) { setEtape(i); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };
  const continuer = () => {
    const e = erreursEtape(etape);
    setEssais((x) => ({ ...x, [etape]: true }));
    if (Object.keys(e).length) {
      montrerErreur();
      return;
    }
    const suivante = Math.min(etape + 1, ETAPES.length - 1);
    setEtape(suivante);
    setAtteinte((a) => Math.max(a, suivante));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ------------------------------------------------------------------ enregistrement
  const enregistrer = async () => {
    for (let i = 0; i < 4; i += 1) {
      const e = erreursEtape(i);
      if (Object.keys(e).length) {
        setEssais((x) => ({ ...x, [i]: true }));
        setEtape(i);
        montrerErreur();
        return;
      }
    }
    setEnregistrement(true);
    try {
      const res = await transportHorsGuceApi.enregistrer({
        IdDevis: idDevisEdite || 0,
        TypePolice: typePolice, Mode: mode, IdCompagnie: Number(compagnie),
        IdClient: Number(souscripteur.IdClient), IdAssure: Number(assure.IdClient),
        DateEffet: dateEffet, DateExpiration: dateFin, NumeroPoliceCompagnie: numeroPoliceCompagnie.trim(),
        Valeur: Number(valeur), ChiffreAffaires: Number(chiffreAffaires) || 0,
        Garanties: garantiesPayload, Franchise: franchise.trim(),
        Accessoire: accessoireImpose ? Number(accessoire) || 0 : null, ExonereTaxe: exonere,
        Marchandise: { Nature: marchandise.nature, Etat: marchandise.etat, Emballage: marchandise.emballage, Conditionnement: marchandise.conditionnement, RisquesSpeciaux: marchandise.risques, Poids: marchandise.poids },
        Trajet: { Depart: trajet.depart, Embarquement: trajet.embarquement, Debarquement: trajet.debarquement, Arrivee: trajet.arrivee, Chargement: trajet.chargement, Moyen: trajet.moyen, Document: trajet.document },
        Vehicules: vehicules.map((v) => ({ Marque: v.marque, Immatriculation: v.immatriculation, ChargeUtile: v.chargeUtile, Valeur: Number(v.valeur) || 0 })),
        IdQuestionnaire: qd.id || null,
      });
      const id = Number(res?.ObjectId) || 0;
      success(`${idDevisEdite ? 'Devis modifié' : 'Devis enregistré'} : N° ${res.NumeroDevis || id}.`);
      setIdDevisEdite(id);
      setNumeroDevisEdite(res.NumeroDevis || '');
      let devis = null;
      try { devis = await quoteApi.getQuote(id); } catch { /* aperçu avec les montants renvoyés */ }
      setDevisEnregistre(devis || {
        id, iddevis: id, numerodevis: res.NumeroDevis, branche: 'Transport', produit: 'TRANSPORT',
        client_nom: souscripteur.Nom, nomassure: assure.Nom, compagnie: nomCompagnie,
        prime_nette: res.PrimeNette, accessoires: res.Accessoire, taxes: res.Taxe, prime_totale: res.PrimeTtc,
        date_emission: aujourdhui(), date_effet: dateEffet, date_expiration: dateFin, raw: {},
      });
    } catch (err) {
      toastError(`Devis non enregistré : ${messageErreurApi(err)}`);
    } finally {
      setEnregistrement(false);
    }
  };

  const confirmerEnContrat = async (devis) => {
    try {
      const res = await contractApi.createContractFromQuote(devis.iddevis || devis.id);
      const idContrat = Number(res?.data?.[0]?.ObjectId);
      if (!(idContrat > 0)) {
        toastError(`Le devis n'a pas pu être confirmé : ${res?.data?.[0]?.OutputMessage || 'réponse sans contrat'}`);
        return;
      }
      setDevisEnregistre(null);
      if (typePolice === 'ABONNEMENT') {
        success(`Police d'abonnement émise, sans prime : déclarez maintenant ses voyages.`);
        navigate(`/user/quotes/transport/abonnements?police=${idContrat}`);
      } else {
        success(`Devis ${devis.numerodevis} confirmé : le contrat et sa quittance ont été créés.`);
        navigate(`/user/contracts/${idContrat}`, { state: { releve: true } });
      }
    } catch (err) {
      toastError(`Le devis n'a pas pu être confirmé : ${messageErreurApi(err)}`);
    }
  };

  // ------------------------------------------------------------------ affichage
  if (chargementEdition || !catalogue) {
    return (
      <div className="glass-panel trp-panneau" style={{ maxWidth: 640, margin: '3rem auto', textAlign: 'center' }} role="status">
        <Loader2 size={28} className="spin" style={{ color: 'var(--primary-500)' }} />
        <p style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>{chargementEdition ? 'Chargement du devis…' : 'Chargement du catalogue Transport…'}</p>
      </div>
    );
  }

  const IconeMode = ICONES_MODE[mode] || Ship;
  const libelleValeur = typeChoisi?.Valeur || 'Valeur assurée';
  const libelleDebut = typePolice === 'VOYAGE' ? 'Date de départ' : 'Date d\'effet';
  const libelleFin = typePolice === 'VOYAGE' ? 'Arrivée prévue' : 'Date d\'échéance';
  const chargements = modeChoisi?.Chargements || [];
  const toggleExtension = (code) => setExtensions((x) => (x.includes(code) ? x.filter((c) => c !== code) : [...x, code]));
  const ttc = ok ? (typePolice === 'ABONNEMENT' ? 0 : ok.PrimeTtcArrondie) : null;
  const etapeCourante = ETAPES[etape];
  const IconeEtape = etapeCourante.icone;

  const champTaux = (g, retenue) => {
    const propose = tauxPropose(g);
    const erreur = erreurs[`taux_${g.Code}`];
    const ligne = primeLigne(g.Code);
    return (
      <div className="trp-garantie-taux">
        <div className="unite">
          <input type="number" className="form-control" min={0} max={100} step="0.01" inputMode="decimal" disabled={!retenue}
            aria-label={`Taux ${g.Libelle}`} value={taux[g.Code] ?? (propose ?? '')} placeholder="0,00"
            onChange={(e) => setTaux((t) => ({ ...t, [g.Code]: e.target.value }))} />
        </div>
        {erreur ? <small className="erreur">{erreur}</small>
          : retenue && ligne && typePolice !== 'ABONNEMENT' ? <small>{fcfa(ligne.Prime)} F</small>
            : <small>{propose !== null && propose !== undefined ? `Barème ${pourcent(propose)}` : 'Aucun barème'}</small>}
      </div>
    );
  };

  const decompte = (
    <>
      {(ok?.Lignes || []).map((l) => (
        <div key={l.Code} className="trp-recap-garantie">
          <span>{l.Libelle} · {pourcent(l.Taux)}</span>
          {typePolice !== 'ABONNEMENT' && <b>{fcfa(l.Prime)}</b>}
        </div>
      ))}
      {ok && <LigneRecap libelle="Taux total" valeur={pourcent(ok.TauxTotal)} />}
      {ok && typePolice !== 'ABONNEMENT' && (
        <>
          <LigneRecap libelle={ok.MinimumApplique ? 'Prime nette, minimum appliqué' : 'Prime nette'} valeur={`${fcfa(ok.PrimeNette)} F`} fort />
          <LigneRecap libelle={`Accessoires${accessoireImpose ? ', imposés' : ''}`} valeur={`${fcfa(ok.Accessoire)} F`} />
          <LigneRecap libelle={`Taxe ${pourcent(ok.TauxTaxe)}`} valeur={`${fcfa(ok.Taxe)} F`} />
        </>
      )}
    </>
  );

  const blocTtc = typePolice === 'ABONNEMENT' ? (
    <div className="trp-ttc">
      <div className="trp-ttc-libelle">Police sans prime</div>
      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
        Chaque voyage déclaré est facturé à la ressortie du mois.
        {voyageType && <> Un voyage au plein de {fcfa(valeur)} F : <strong style={{ color: 'var(--text-primary)' }}>{fcfa(voyageType.PrimeTtc)} F TTC</strong>.</>}
      </div>
    </div>
  ) : (
    <div className="trp-ttc" aria-live="polite">
      <div className="trp-ttc-libelle">Prime TTC</div>
      <div key={ttc ?? 'vide'} className="trp-ttc-montant maj">{ttc !== null ? `${fcfa(ttc)} F` : '-'}</div>
      {ttc > 0 && <div className="trp-ttc-lettres">{numberToFrenchWords(Math.round(ttc))} FRANCS CFA</div>}
    </div>
  );

  return (
    <div className="trp-page">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <button type="button" className="btn btn-link trp-retour" onClick={() => navigate('/user/quotes/transport')}>
            <ChevronLeft size={16} /> Transport
          </button>
          <h1 className="title-xl trp-titre"><IconeMode size={26} /> Cotation Transport hors GUCE</h1>
          <p className="trp-sous-titre">
            {idDevisEdite
              ? <>Devis <strong>N° {numeroDevisEdite}</strong> : la prime est recalculée à l'enregistrement.</>
              : 'Marchandises non soumises au guichet unique. Cinq étapes ; la prime se calcule au fil de la saisie.'}
          </p>
        </div>
        {peut('tarifs.view') && (
          <Link to="/admin/settings/branches/transport" className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <Settings2 size={16} /> Taux et minimums
          </Link>
        )}
      </div>

      <BandeauQuestionnaire
        qd={qd}
        onCreerClient={() => setNouveauClientPour('souscripteur')}
        actions={qd.devis?.genre === 'transport' ? [{
          libelle: 'Reprendre les réponses dans la cotation', icone: ClipboardList, principal: true,
          titre: qd.lecture?.resume || 'Mode, type de police, marchandise, trajet, valeur et garanties demandées',
          onClick: reprendreQuestionnaire,
        }] : []}
      />

      <ol className="trp-etapes" aria-label="Étapes de la cotation">
        {ETAPES.map((e, i) => {
          const Icone = e.icone;
          const etat = i === etape ? 'active' : i < atteinte || (i < etape) ? 'faite' : '';
          return (
            <li key={e.id} className={`trp-etape ${etat}`}>
              <button type="button" onClick={() => allerA(i)} disabled={i > atteinte && i > etape} aria-current={i === etape ? 'step' : undefined}
                title={e.libelle}>
                <span className="trp-etape-num">{etat === 'faite' ? <CheckCircle2 size={14} /> : i + 1}</span>
                <span className="trp-etape-libelle">{e.libelle}</span>
                <Icone size={14} style={{ marginLeft: 'auto', opacity: 0.6, flex: 'none' }} aria-hidden="true" className="trp-etape-libelle" />
              </button>
            </li>
          );
        })}
      </ol>

      <div className="trp-assistant">
        <section key={etapeCourante.id} className="glass-panel trp-panneau" aria-labelledby="trp-titre-etape">
          <h2 id="trp-titre-etape" className="trp-panneau-titre"><IconeEtape size={18} /> {etape + 1}. {etapeCourante.libelle}</h2>

          {/* ---------------------------------------------------------------- 1. POLICE */}
          {etapeCourante.id === 'police' && (
            <>
              <p className="trp-panneau-aide">Le type de police décide de la durée et de la façon dont la prime est due.</p>
              <GroupeChoix libelle="Type de police" options={typesPolice} valeur={typePolice} onChange={setTypePolice}
                rendu={(t) => {
                  const Icone = ICONES_POLICE[t.Code] || Route;
                  return (
                    <>
                      <span className="trp-choix-entete"><Icone size={18} /> {t.Libelle}</span>
                      <span className="trp-choix-texte">{t.Resume}</span>
                      <span className="trp-choix-detail">{DETAIL_POLICE[t.Code]}</span>
                    </>
                  );
                }} />
              {erreurs.typePolice && <div className="champ-message erreur" role="alert">{erreurs.typePolice}</div>}

              <div className="trp-intertitre">Mode de transport</div>
              <GroupeChoix libelle="Mode de transport" classe="trp-modes" options={modes} valeur={mode} onChange={(c) => { setMode(c); setTrajet((t) => ({ ...t, chargement: '' })); }}
                rendu={(m) => { const Icone = ICONES_MODE[m.Code] || Ship; return <><Icone size={22} /> {m.Libelle}</>; }} />
              {erreurs.mode && <div className="champ-message erreur" role="alert">{erreurs.mode}</div>}

              <div className="trp-intertitre">Prospect et compagnie</div>
              <div className="trp-grille">
                <RechercheClient label="Prospect, nom ou raison sociale" personne={souscripteur} onChoisir={setSouscripteur}
                  onNouveau={() => setNouveauClientPour('souscripteur')} erreur={erreurs.souscripteur} />
                <Champ label="Compagnie d'assurance" requis erreur={erreurs.compagnie}>
                  <select className="form-control" value={compagnie || ''} onChange={(e) => setCompagnie(Number(e.target.value))}>
                    {!compagnie && <option value="">Choisir…</option>}
                    {compagnies.filter((c) => c.usuelle).length > 0 && (
                      <optgroup label="Habituelles en Transport">
                        {compagnies.filter((c) => c.usuelle).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                      </optgroup>
                    )}
                    <optgroup label="Autres compagnies">
                      {compagnies.filter((c) => !c.usuelle).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </optgroup>
                  </select>
                </Champ>
                <Champ label="N° de police compagnie" aide="Facultatif">
                  <input type="text" className="form-control" maxLength={60} value={numeroPoliceCompagnie} onChange={(e) => setNumeroPoliceCompagnie(e.target.value)} />
                </Champ>
              </div>
              {!assureDistinct ? (
                <button type="button" className="btn btn-link" onClick={() => setAssureDistinct(true)} style={{ padding: 0, marginTop: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem' }}>
                  <UserPlus size={14} /> L'assuré est une autre personne
                </button>
              ) : (
                <div className="trp-grille" style={{ marginTop: '1rem' }}>
                  <RechercheClient label="Assuré" personne={assureChoisi} onChoisir={setAssureChoisi} onNouveau={() => setNouveauClientPour('assure')} erreur={erreurs.assure} />
                  <div style={{ alignSelf: 'end', paddingBottom: '0.4rem' }}>
                    <button type="button" className="btn btn-link" onClick={() => { setAssureDistinct(false); setAssureChoisi(null); }} style={{ padding: 0, fontSize: '0.82rem' }}>L'assuré est le prospect</button>
                  </div>
                </div>
              )}

              <div className="trp-intertitre">Période</div>
              <div className="trp-grille">
                <Champ label={libelleDebut} requis erreur={erreurs.dateEffet}>
                  <input type="date" className="form-control" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} />
                </Champ>
                <Champ label={libelleFin} requis erreur={erreurs.dateFin}
                  aide={periodeAnnuelle ? 'Un an à partir de la date d\'effet' : (ecartJours(dateEffet, dateFin) >= 0 ? `${ecartJours(dateEffet, dateFin)} jours de transport` : undefined)}>
                  <input type="date" className="form-control" value={dateFin} min={dateEffet || undefined} onChange={(e) => setDateFin(e.target.value)} />
                </Champ>
              </div>
            </>
          )}

          {/* ---------------------------------------------------------------- 2. MARCHANDISE */}
          {etapeCourante.id === 'marchandise' && (
            <>
              <p className="trp-panneau-aide">Ce qui est transporté, et comment c'est protégé : la compagnie en tient compte pour le taux.</p>
              <div className="trp-grille">
                <Champ label="Type de marchandise" requis erreur={erreurs.nature} large aide="Nature exacte : liquide ou solide, neuve ou usagée…">
                  <input type="text" className="form-control" maxLength={255} value={marchandise.nature} placeholder="Ex. riz blanc en sacs de 50 kg"
                    onChange={(e) => setMarchandise((m) => ({ ...m, nature: e.target.value }))} />
                </Champ>
                <Champ label="État">
                  <div className="trp-puces" role="radiogroup" aria-label="État de la marchandise">
                    {(listes.Etats || []).map((x) => (
                      <button key={x} type="button" className="trp-puce" role="radio" aria-checked={marchandise.etat === x}
                        onClick={() => setMarchandise((m) => ({ ...m, etat: m.etat === x ? '' : x }))}>{x}</button>
                    ))}
                  </div>
                </Champ>
                <Champ label="Poids" aide="Facultatif">
                  <input type="text" className="form-control" maxLength={60} value={marchandise.poids} placeholder="Ex. 25 tonnes" onChange={(e) => setMarchandise((m) => ({ ...m, poids: e.target.value }))} />
                </Champ>
                <Champ label="Conditionnement" requis erreur={erreurs.conditionnement}>
                  <ListeOuAutre options={listes.Conditionnements || []} valeur={marchandise.conditionnement} onChange={(v) => setMarchandise((m) => ({ ...m, conditionnement: v }))} />
                </Champ>
                <Champ label="Emballage">
                  <ListeOuAutre options={listes.Emballages || []} valeur={marchandise.emballage} onChange={(v) => setMarchandise((m) => ({ ...m, emballage: v }))} />
                </Champ>
              </div>
              <div className="trp-intertitre">Risques spéciaux pendant le transport</div>
              <div className="trp-puces" aria-label="Risques spéciaux">
                {(listes.RisquesSpeciaux || []).map((x) => {
                  const actif = marchandise.risques.includes(x);
                  return (
                    <button key={x} type="button" className="trp-puce" aria-pressed={actif}
                      onClick={() => setMarchandise((m) => ({ ...m, risques: actif ? m.risques.filter((r) => r !== x) : [...m.risques, x] }))}>
                      {actif && <CheckCircle2 size={13} />} {x}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ---------------------------------------------------------------- 3. TRAJET */}
          {etapeCourante.id === 'trajet' && (
            <>
              <p className="trp-panneau-aide">D'où part la marchandise, où elle arrive, et comment elle est chargée{modeChoisi ? ` (transport ${modeChoisi.Libelle.toLowerCase()})` : ''}.</p>
              <div className="trp-grille">
                <Champ label="Point de départ" requis erreur={erreurs.depart} aide="Pays et ville">
                  <input type="text" className="form-control" maxLength={120} value={trajet.depart} onChange={(e) => setTrajet((t) => ({ ...t, depart: e.target.value }))} />
                </Champ>
                <Champ label="Point d'arrivée" requis erreur={erreurs.arrivee} aide="Destination finale">
                  <input type="text" className="form-control" maxLength={120} value={trajet.arrivee} onChange={(e) => setTrajet((t) => ({ ...t, arrivee: e.target.value }))} />
                </Champ>
                {mode !== 'TERRESTRE' && (
                  <>
                    <Champ label={mode === 'AERIEN' ? 'Aéroport de départ' : 'Port d\'embarquement'} aide="Facultatif">
                      <input type="text" className="form-control" maxLength={120} value={trajet.embarquement} onChange={(e) => setTrajet((t) => ({ ...t, embarquement: e.target.value }))} />
                    </Champ>
                    <Champ label={mode === 'AERIEN' ? 'Aéroport d\'arrivée' : 'Port de débarquement'} aide="Facultatif">
                      <input type="text" className="form-control" maxLength={120} value={trajet.debarquement} onChange={(e) => setTrajet((t) => ({ ...t, debarquement: e.target.value }))} />
                    </Champ>
                  </>
                )}
              </div>
              <div className="trp-intertitre">Mode de chargement <span style={{ color: 'var(--accent-rose)' }} aria-hidden="true">*</span></div>
              <div className="trp-puces" role="radiogroup" aria-label="Mode de chargement">
                {chargements.map((c) => (
                  <button key={c} type="button" className="trp-puce" role="radio" aria-checked={trajet.chargement === c}
                    onClick={() => setTrajet((t) => ({ ...t, chargement: c }))}>{c}</button>
                ))}
                {trajet.chargement && !chargements.includes(trajet.chargement) && (
                  <button type="button" className="trp-puce" role="radio" aria-checked>{trajet.chargement}</button>
                )}
              </div>
              {erreurs.chargement && <div className="champ-message erreur" role="alert">{erreurs.chargement}</div>}

              <div className="trp-intertitre">Moyen et document de transport{typePolice === 'VOYAGE' ? '' : ', si déjà connus'}</div>
              <div className="trp-grille">
                <Champ label={modeChoisi?.Moyen || 'Moyen de transport'} aide="Facultatif">
                  <input type="text" className="form-control" maxLength={120} value={trajet.moyen} onChange={(e) => setTrajet((t) => ({ ...t, moyen: e.target.value }))} />
                </Champ>
                <Champ label={modeChoisi?.Document || 'Document de transport'} aide="Facultatif">
                  <input type="text" className="form-control" maxLength={80} value={trajet.document} onChange={(e) => setTrajet((t) => ({ ...t, document: e.target.value }))} />
                </Champ>
              </div>

              {mode === 'TERRESTRE' && (
                <>
                  <div className="trp-intertitre">Camions utilisés, facultatif</div>
                  <div className="trp-vehicules">
                    {vehicules.map((v, i) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <div key={i} className="trp-vehicule">
                        <input type="text" className="form-control" placeholder="Marque et forme" aria-label="Marque et forme du véhicule" value={v.marque} onChange={(e) => setVehicules((l) => l.map((x, k) => (k === i ? { ...x, marque: e.target.value } : x)))} />
                        <input type="text" className="form-control" placeholder="Immatriculation" aria-label="Immatriculation" value={v.immatriculation} onChange={(e) => setVehicules((l) => l.map((x, k) => (k === i ? { ...x, immatriculation: e.target.value } : x)))} />
                        <input type="text" className="form-control" placeholder="Charge utile" aria-label="Charge utile" value={v.chargeUtile} onChange={(e) => setVehicules((l) => l.map((x, k) => (k === i ? { ...x, chargeUtile: e.target.value } : x)))} />
                        <AmountInput value={v.valeur} onChange={(n) => setVehicules((l) => l.map((x, k) => (k === i ? { ...x, valeur: n } : x)))} placeholder="Valeur par chargement" />
                        <button type="button" className="btn btn-link" aria-label="Retirer ce camion" onClick={() => setVehicules((l) => l.filter((_, k) => k !== i))}><Trash2 size={15} /></button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-secondary" style={{ justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                      onClick={() => setVehicules((l) => [...l, { marque: '', immatriculation: '', chargeUtile: '', valeur: 0 }])}>
                      <Plus size={15} /> Ajouter un camion
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ---------------------------------------------------------------- 4. GARANTIES ET PRIME */}
          {etapeCourante.id === 'garanties' && (
            <>
              <p className="trp-panneau-aide">Une garantie de base, puis les risques exceptionnels et surprimes voulus. Les taux viennent du barème et restent modifiables.</p>
              <div className="trp-grille">
                <Champ label={libelleValeur} requis erreur={erreurs.valeur}
                  aide={typePolice === 'ABONNEMENT' ? 'Valeur la plus forte d\'un envoi ; chaque voyage déclaré porte sa propre valeur' : undefined}>
                  <AmountInput value={valeur} onChange={setValeur} />
                </Champ>
                {periodeAnnuelle && (
                  <Champ label="Chiffre d'affaires prévisionnel" aide="Facultatif : achats FOB à l'importation, ventes CIF à l'exportation">
                    <AmountInput value={chiffreAffaires} onChange={setChiffreAffaires} />
                  </Champ>
                )}
              </div>

              <div className="trp-intertitre">Risques ordinaires, une garantie de base</div>
              <div className="trp-garanties" role="radiogroup" aria-label="Garantie de base">
                {garantiesBase.map((g) => {
                  const retenue = base === g.Code;
                  return (
                    <div key={g.Code} className={`trp-garantie${retenue ? ' retenue' : ''}`}>
                      <input type="radio" id={`trp-base-${g.Code}`} name="trp-base" checked={retenue} onChange={() => setBase(g.Code)} />
                      <label htmlFor={`trp-base-${g.Code}`} className="trp-garantie-nom">{g.Libelle}</label>
                      {champTaux(g, retenue)}
                      <span className="trp-garantie-texte">
                        {g.Description}{tauxMinimum(g) !== null ? ` Taux minimum réglementaire : ${pourcent(tauxMinimum(g))}.` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
              {erreurs.base && <div className="champ-message erreur" role="alert">{erreurs.base}</div>}

              <div className="trp-intertitre">Risques exceptionnels et surprimes</div>
              <div className="trp-garanties">
                {garantiesExtension.map((g) => {
                  const retenue = extensions.includes(g.Code);
                  return (
                    <div key={g.Code} className={`trp-garantie${retenue ? ' retenue' : ''}`}>
                      <input type="checkbox" id={`trp-ext-${g.Code}`} checked={retenue} onChange={() => toggleExtension(g.Code)} />
                      <label htmlFor={`trp-ext-${g.Code}`} className="trp-garantie-nom">{g.Libelle}</label>
                      {champTaux(g, retenue)}
                      <span className="trp-garantie-texte">{g.Description}</span>
                    </div>
                  );
                })}
              </div>

              <div className="trp-intertitre">Conditions</div>
              <div className="trp-grille">
                <Champ label="Franchise" aide="Facultatif, ex. 10 % du sinistre, 500 000 F minimum">
                  <input type="text" className="form-control" maxLength={200} value={franchise} onChange={(e) => setFranchise(e.target.value)} />
                </Champ>
                <Champ label={typePolice === 'ABONNEMENT' ? 'Accessoires, coût par voyage' : 'Accessoires, coût de police'}
                  aide={accessoireImpose ? 'Montant imposé' : `Barème : ${ok ? `${fcfa(typePolice === 'ABONNEMENT' ? voyageType?.Accessoire : ok.Accessoire)} F` : 'selon les réglages'}`}>
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={accessoireImpose} onChange={(e) => setAccessoireImpose(e.target.checked)} /> Imposer un montant
                    </label>
                    {accessoireImpose && <AmountInput value={accessoire} onChange={(n) => setAccessoire(Number(n) || 0)} />}
                  </div>
                </Champ>
                <Champ label="Taxe">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', cursor: 'pointer', paddingTop: '0.5rem' }}>
                    <input type="checkbox" checked={exonere} onChange={(e) => setExonere(e.target.checked)} /> Affaire exonérée de taxe
                  </label>
                </Champ>
              </div>
              {erreurs.calcul && <div className="trp-note erreur" role="alert" style={{ marginTop: '1rem' }}><AlertTriangle size={16} /> {erreurs.calcul}</div>}
              {ok?.MinimumApplique && (
                <div className="trp-note attention" style={{ marginTop: '1rem' }}>
                  <Info size={16} /> Prime calculée {fcfa(ok.PrimeCalculee)} F, portée à la prime minimum de {fcfa(ok.PrimeMinimum)} F.
                </div>
              )}
              {typePolice === 'ABONNEMENT' && (
                <div className="trp-note" style={{ marginTop: '1rem' }}>
                  <Info size={16} /> La police d'abonnement est émise sans prime. Ces taux s'appliquent à chaque voyage déclaré ;
                  la ressortie du mois regroupe les voyages et donne la facture.
                </div>
              )}
            </>
          )}

          {/* ---------------------------------------------------------------- 5. RÉCAPITULATIF */}
          {etapeCourante.id === 'recap' && (
            <>
              <p className="trp-panneau-aide">Vérifiez avant d'enregistrer. Le devis se confirme ensuite en contrat depuis l'aperçu.</p>
              <div className="trp-resume">
                <div className="trp-resume-bloc">
                  <div className="trp-resume-entete">Police <button type="button" className="btn btn-link" onClick={() => allerA(0)}>Modifier</button></div>
                  <dl>
                    <dt>Type</dt><dd>{typeChoisi?.Libelle}</dd>
                    <dt>Mode</dt><dd>{modeChoisi?.Libelle}</dd>
                    <dt>Prospect</dt><dd>{souscripteur?.Nom}</dd>
                    {assureDistinct && <><dt>Assuré</dt><dd>{assure?.Nom}</dd></>}
                    <dt>Compagnie</dt><dd>{nomCompagnie}</dd>
                    <dt>Période</dt><dd>{dateFr(dateEffet)} au {dateFr(dateFin)}</dd>
                  </dl>
                </div>
                <div className="trp-resume-bloc">
                  <div className="trp-resume-entete">Marchandise <button type="button" className="btn btn-link" onClick={() => allerA(1)}>Modifier</button></div>
                  <dl>
                    <dt>Type</dt><dd>{marchandise.nature}</dd>
                    {marchandise.etat && <><dt>État</dt><dd>{marchandise.etat}</dd></>}
                    <dt>Conditionnement</dt><dd>{marchandise.conditionnement}</dd>
                    {marchandise.emballage && <><dt>Emballage</dt><dd>{marchandise.emballage}</dd></>}
                    {marchandise.risques.length > 0 && <><dt>Risques spéciaux</dt><dd>{marchandise.risques.join(', ')}</dd></>}
                  </dl>
                </div>
                <div className="trp-resume-bloc">
                  <div className="trp-resume-entete">Trajet <button type="button" className="btn btn-link" onClick={() => allerA(2)}>Modifier</button></div>
                  <dl>
                    <dt>Départ</dt><dd>{trajet.depart}</dd>
                    <dt>Arrivée</dt><dd>{trajet.arrivee}</dd>
                    <dt>Chargement</dt><dd>{trajet.chargement}</dd>
                    {trajet.moyen && <><dt>{modeChoisi?.Moyen || 'Moyen'}</dt><dd>{trajet.moyen}</dd></>}
                    {trajet.document && <><dt>Document</dt><dd>{trajet.document}</dd></>}
                    {vehicules.length > 0 && <><dt>Camions</dt><dd>{vehicules.length}</dd></>}
                  </dl>
                </div>
                <div className="trp-resume-bloc">
                  <div className="trp-resume-entete">Garanties et prime <button type="button" className="btn btn-link" onClick={() => allerA(3)}>Modifier</button></div>
                  <dl>
                    <dt>{libelleValeur}</dt><dd>{fcfa(valeur)} F</dd>
                    {franchise && <><dt>Franchise</dt><dd>{franchise}</dd></>}
                    {exonere && <><dt>Taxe</dt><dd>Exonérée</dd></>}
                  </dl>
                  <div style={{ marginTop: '0.5rem' }}>{decompte}</div>
                </div>
              </div>
              <div className="trp-mobile-seulement" style={{ marginTop: '1rem' }}>{blocTtc}</div>
            </>
          )}

          <div className="trp-navigation">
            {etape > 0 ? (
              <button type="button" className="btn btn-secondary" onClick={() => allerA(etape - 1)}><ChevronLeft size={16} /> Retour</button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/user/quotes/transport')}><ChevronLeft size={16} /> Annuler</button>
            )}
            {Object.keys(erreurs).length > 0 && (
              <span className="indice" role="alert" style={{ color: 'var(--accent-rose)', marginLeft: 'auto' }}>
                {Object.keys(erreurs).length === 1 ? 'Une rubrique à compléter' : `${Object.keys(erreurs).length} rubriques à compléter`}
              </span>
            )}
            {etape < ETAPES.length - 1 ? (
              <button type="button" className="btn btn-primary" onClick={continuer}>Continuer <ChevronRight size={16} /></button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={enregistrer} aria-busy={enregistrement} disabled={enregistrement} style={{ fontWeight: 800 }}>
                {!enregistrement && <CheckCircle2 size={16} />} {idDevisEdite ? 'Enregistrer les modifications' : 'Enregistrer le devis'}
              </button>
            )}
          </div>
        </section>

        {/* Décompte de la cotation : suit la saisie */}
        <aside className="glass-panel trp-recap" aria-label="Votre cotation">
          <h2 className="trp-recap-titre"><IconeMode size={16} style={{ color: 'var(--primary-500)' }} /> Votre cotation {calculEnCours && <Loader2 size={13} className="spin" />}</h2>
          <LigneRecap libelle="Police" valeur={typeChoisi?.Libelle} />
          <LigneRecap libelle="Mode" valeur={modeChoisi?.Libelle} />
          <LigneRecap libelle="Prospect" valeur={souscripteur?.Nom} />
          <LigneRecap libelle="Compagnie" valeur={nomCompagnie} />
          {(trajet.depart || trajet.arrivee) && (
            <LigneRecap libelle="Trajet" valeur={<><MapPin size={12} style={{ verticalAlign: '-1px' }} /> {trajet.depart || '…'} → {trajet.arrivee || '…'}</>} />
          )}
          {marchandise.nature && <LigneRecap libelle="Marchandise" valeur={marchandise.nature} />}
          {Number(valeur) > 0 && <LigneRecap libelle={typePolice === 'ABONNEMENT' ? 'Plein' : 'Valeur'} valeur={`${fcfa(valeur)} F`} />}
          <div style={{ marginTop: '0.6rem' }}>{decompte}</div>
          {blocTtc}
          {calcul?.erreur && etape >= 3 && <div className="trp-note erreur" style={{ marginTop: '0.75rem' }}><AlertTriangle size={15} /> {calcul.erreur}</div>}
          {!ok && !calcul?.erreur && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
              La prime s'affiche dès que le type de police, le mode, la valeur et la garantie de base sont connus.
            </p>
          )}
          {ok && typePolice !== 'ABONNEMENT' && (
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0.6rem 0 0' }}>
              Commission du cabinet : {pourcent(ok.TauxCommission)}, soit {fcfa(ok.Commission)} F.
            </p>
          )}
        </aside>
      </div>

      {/* Mobile : prime toujours visible */}
      <div className="trp-barre-mobile" aria-hidden={etapeCourante.id === 'recap'}>
        <div>
          <span>{typePolice === 'ABONNEMENT' ? 'Un voyage au plein' : 'Prime TTC'}</span>
          <b>{typePolice === 'ABONNEMENT' ? (voyageType ? `${fcfa(voyageType.PrimeTtc)} F` : '-') : (ttc !== null ? `${fcfa(ttc)} F` : '-')}</b>
        </div>
        {calculEnCours && <Loader2 size={16} className="spin" />}
      </div>

      <QuickAddClientModal
        isOpen={Boolean(nouveauClientPour)}
        onClose={() => setNouveauClientPour(null)}
        valeursInitiales={nouveauClientPour === 'souscripteur' ? qd.client : null}
        onClientCreated={(client) => {
          const personne = personneDepuisClient(client);
          if (personne?.IdClient) {
            if (nouveauClientPour === 'souscripteur') setSouscripteur(personne); else setAssureChoisi(personne);
          } else {
            warning('Client créé : recherchez-le par son nom pour le choisir.');
          }
          setNouveauClientPour(null);
        }}
      />

      {devisEnregistre && (
        <ViewQuoteModal quote={devisEnregistre} isOpen={Boolean(devisEnregistre)} onClose={() => setDevisEnregistre(null)} onConvertToContract={confirmerEnContrat} />
      )}
    </div>
  );
};

export default NewTransportHorsGucePage;
