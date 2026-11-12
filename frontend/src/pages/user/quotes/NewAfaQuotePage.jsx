import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { redirigerSiOreole } from './oreole/oreoleCommun';
import { useSearchParams } from 'react-router-dom';
// Renvois vers la gestion des devis traduits en Affaires antérieures quand l'écran y est ouvert (/user/reprises/saisie/afa)
import { useNavigate } from '../../../utils/navigationDevis';
import {
  AlertTriangle, ArrowLeftRight, Calculator, CalendarDays, Check, Download, FileSpreadsheet, FileText, HeartHandshake, Layers, Loader2,
  Plus, RefreshCw, Trash2, Upload, UserCheck, Users, Wallet,
} from 'lucide-react';
import { afaApi, contractApi, quoteApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { Champ, FichePersonne, RechercheClient, personneDepuisClient } from '../../../components/common/RechercheClient';
import { EtapesDevis, ResumeDevis } from '../../../components/common/ParcoursDevis';
import { AmountInput } from '../../../components/common/AmountInput';
import { Modal } from '../../../components/common/Modal';
import { QuickAddClientModal } from '../clients/QuickAddClientModal';
import { ViewQuoteModal } from './ViewQuoteModal';
import { messageErreurApi } from '../../../utils/financeUtils';
import { confirmer } from '../../../utils/dialogue';
import { EtatCotisations } from './vie/EtatCotisations';
import { ImportEtatModal } from './vie/ImportEtatModal';
import {
  COULEUR_VIE, SAISIE_COTISATION, comparerEtats, cotisantVide, dateFr, erreursCotisant, fcfa, fcfaSigne, finDeMois, libelleMois, moisSuivant,
  nouvelleCle, telechargerBlob,
} from './vie/vieCommun';
import './vie/vie.css';

/* =========================================================================
   DEVIS VIE (production/afa.py) - offres commerciales (demande du 2026-11-10 : « la branche est VIE, AFA est une offre
   commerciale ; une liste déroulante : AFA, Retraite complémentaire, Temporaire décès… »), réglées dans Réglages Vie.
   - Offres « capital » (AFA, Temporaire décès) : contrat de groupe, une ligne par assuré (nom, naissance, qualité,
     capital, bénéficiaires, prime). La liste vient d'un fichier Excel au modèle d'OREOLE ou se saisit à l'écran.
   - Offre « cotisations » (Retraite complémentaire) : état mensuel des cotisations, un salarié par ligne (matricule,
     part salariale, part employeur), importé (états ARC de CI-ENERGIES) ou saisi, comparé à l'état du mois précédent ;
     un mois = un devis, affaire nouvelle ou mois suivant de la police (renouvellement, comme dans URANUS).
   Primes reprises telles quelles (aucun prorata), pas de taxe en Vie. Affaire nouvelle, ou renouvellement d'une police
   Vie du souscripteur chez la même compagnie (même numéro de police à la confirmation).
   Incorporation (devis INC créé depuis la fiche du contrat, IncorporationFlottePage) : seules les personnes ajoutées,
   offre, compagnie, souscripteur et échéance de la police figés, date d'incorporation au choix dans la période.
   ========================================================================= */

const COULEUR = COULEUR_VIE;
const ACTES = ['Affaire nouvelle', 'Renouvellement', 'Incorporation'];
const ligneVide = (base = {}) => ({
  cle: nouvelleCle('a'), IdClient: null, Nom: '', Prenoms: '', DateNaissance: '', Qualite: 'ASSURE PRINCIPAL', Capital: '',
  PrimeTtc: '', Beneficiaires: '', Acte: '', Proposition: null, ClientConnu: null, Avertissements: [], ...base,
});
const age = (naissance, jour) => {
  if (!naissance || !jour) return null;
  const n = new Date(`${naissance}T00:00:00`);
  const j = new Date(`${jour}T00:00:00`);
  return j.getFullYear() - n.getFullYear() - ((j.getMonth() < n.getMonth() || (j.getMonth() === n.getMonth() && j.getDate() < n.getDate())) ? 1 : 0);
};
const cleIdentite = (l) => `${String(`${l.Nom} ${l.Prenoms}`).trim().toUpperCase().replace(/\s+/g, ' ')}|${l.DateNaissance}`;
const PERIODICITES = { ANNUELLE: 'Annuelle', SEMESTRIELLE: 'Semestrielle', TRIMESTRIELLE: 'Trimestrielle', MENSUELLE: 'Mensuelle' };

// Contrôles d'une ligne, les mêmes que le serveur (production/afa.py, _assures_saisis) : bloquants avant l'enregistrement
const erreursLigne = (l, dateEffet) => {
  const erreurs = [];
  if (!String(l.Nom || '').trim()) erreurs.push('nom absent');
  if (!l.DateNaissance) erreurs.push('date de naissance absente');
  else {
    const a = age(l.DateNaissance, dateEffet || new Date().toISOString().slice(0, 10));
    if (a === null || a < 0 || a > 100) erreurs.push('date de naissance invraisemblable');
  }
  if (!(Number(l.Capital) > 0)) erreurs.push('capital à saisir');
  if (!(Number(l.PrimeTtc) > 0)) erreurs.push('prime à saisir');
  return erreurs;
};
const salarieSaisi = (l) => String(l.Nom || '').trim() || String(l.Matricule || '').trim() || Number(l.CotisationSalarie) > 0 || Number(l.CotisationEmployeur) > 0;

export const NewAfaQuotePage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const idDevisEdite = Number(searchParams.get('edit')) || 0;
  // Page Renouvellement d'une police Retraite complémentaire : mois suivant de la police, avec l'état du mois à importer
  const idContratARenouveler = idDevisEdite ? 0 : Number(searchParams.get('renouveler')) || 0;
  // Devis lié au package Oreole Santé : il s'ouvre dans la branche, qui garde les trois polices ensemble
  useEffect(() => redirigerSiOreole(idDevisEdite, navigate), [idDevisEdite]); // eslint-disable-line react-hooks/exhaustive-deps
  const { success, error: toastError, info } = useToast();

  const [etape, setEtape] = useState(1);
  const [compagnies, setCompagnies] = useState([]);
  const [offres, setOffres] = useState([]);
  // false : migration production 0219 absente de la base, seule l'offre AFA est proposée
  const [offresReglables, setOffresReglables] = useState(true);
  const [idOffre, setIdOffre] = useState('');
  const [idCompagnie, setIdCompagnie] = useState('');
  const [souscripteur, setSouscripteur] = useState(null);
  const [polices, setPolices] = useState([]);
  const [mouvement, setMouvement] = useState('AFN');
  const [idContratRenouvele, setIdContratRenouvele] = useState('');
  const [dateEffet, setDateEffet] = useState('');
  const [dateExpiration, setDateExpiration] = useState('');
  const [mois, setMois] = useState('');
  const [policeCompagnie, setPoliceCompagnie] = useState('');
  const [accessoire, setAccessoire] = useState(0);
  const [assures, setAssures] = useState([ligneVide()]);
  const [cotisants, setCotisants] = useState([]);
  const [precedent, setPrecedent] = useState(null);
  const [chargementPrecedent, setChargementPrecedent] = useState(false);
  const [fichier, setFichier] = useState('');
  const [import_, setImport] = useState(null);
  const [importEtat, setImportEtat] = useState(null);
  const [analyse, setAnalyse] = useState(false);
  const [survol, setSurvol] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [chargement, setChargement] = useState(Boolean(idDevisEdite));
  const [devisLu, setDevisLu] = useState(null);
  // Devis d'incorporation : police, période du contrat et nombre de personnes déjà assurées
  const [incorporation, setIncorporation] = useState(null);
  const [devisEnregistre, setDevisEnregistre] = useState(null);
  // Mois suivant attendu (GET /api/afa/retraite/renouveler/<contrat>/) : police, dernier mois et mois à importer
  const [moisAttendu, setMoisAttendu] = useState(null);
  const [nouveauClient, setNouveauClient] = useState(false);
  const [capitalTous, setCapitalTous] = useState('');
  const [primeTous, setPrimeTous] = useState('');
  const fichierRef = useRef(null);

  // Compagnies rattachées au cabinet (celle proposée pour la Vie d'abord), offres commerciales et polices Vie du souscripteur
  useEffect(() => {
    let actif = true;
    afaApi.referentiels(souscripteur?.IdClient)
      .then((r) => {
        if (!actif) return;
        setCompagnies(r.Compagnies || []);
        setPolices(r.Polices || []);
        setOffres(r.Offres || []);
        setOffresReglables(r.OffresReglables !== false);
        setIdOffre((courant) => (courant !== '' ? courant : String(r.Offres?.[0]?.IdOffre ?? '')));
        setIdCompagnie((courant) => courant || String(r.IdCompagnieDefaut || r.Compagnies?.[0]?.IdCompagnie || ''));
      })
      .catch((err) => { if (actif) toastError(`Listes non chargées : ${messageErreurApi(err)}`); });
    return () => { actif = false; };
  }, [souscripteur?.IdClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // Devis rouvert (« Modifier » du registre)
  useEffect(() => {
    if (!idDevisEdite) return undefined;
    let actif = true;
    Promise.all([afaApi.lire(idDevisEdite), contractApi.lireDevisIncorporation(idDevisEdite).catch(() => null)])
      .then(([d, lectureIncorporation]) => {
        if (!actif) return;
        const devisIncorporation = d.Mouvement === 'INC' && lectureIncorporation?.Incorporation ? lectureIncorporation : null;
        setIncorporation(devisIncorporation);
        setDevisLu(d);
        setIdOffre(String(d.IdOffreVie ?? d.Offre?.IdOffre ?? ''));
        setIdCompagnie(String(d.IdCompagnie || ''));
        setSouscripteur(d.IdClient ? { IdClient: d.IdClient, Nom: d.Client || `Client n° ${d.IdClient}` } : null);
        setMouvement(d.Mouvement === 'REN' ? 'REN' : 'AFN');
        setIdContratRenouvele(d.IdContratRenouvele ? String(d.IdContratRenouvele) : '');
        setDateEffet(d.DateEffet || '');
        // État mensuel : du 1er au dernier jour du mois (un mois ouvert par l'ancienne page Renouvellement reprenait la durée du
        // mois précédent, 28 jours après février)
        const mensuelLu = d.Offre?.Saisie === SAISIE_COTISATION && d.Offre?.Periodicite === 'MENSUELLE' && d.DateEffet;
        setDateExpiration(mensuelLu && !d.Confirme ? finDeMois(String(d.DateEffet).slice(0, 7)) : d.DateExpiration || '');
        setMois(d.DateEffet ? String(d.DateEffet).slice(0, 7) : '');
        setPoliceCompagnie(d.NumeroPoliceCompagnie || '');
        setAccessoire(Number(d.Accessoire) || 0);
        setCotisants((d.Cotisants || []).map((c) => cotisantVide({ ...c, CotisationSalarie: c.CotisationSalarie ?? '', CotisationEmployeur: c.CotisationEmployeur ?? '' })));
        const lignes = (d.Assures || []).map((a) => ligneVide({ ...a, Capital: a.Capital ?? '', PrimeTtc: a.PrimeTtc ?? '' }));
        setAssures(lignes.length ? lignes : [ligneVide(d.Mouvement === 'INC' ? { Acte: 'Incorporation' } : {})]);
        // Incorporation encore sans personne : directement à la saisie des assurés
        if (d.Mouvement === 'INC' && !lignes.length) setEtape(2);
      })
      .catch((err) => { if (actif) toastError(`Devis Vie non chargé : ${messageErreurApi(err)}`); })
      .finally(() => { if (actif) setChargement(false); });
    return () => { actif = false; };
  }, [idDevisEdite]); // eslint-disable-line react-hooks/exhaustive-deps

  // Offre commerciale choisie (une offre désactivée reste affichée sur le devis qui la porte)
  const offresListe = useMemo(() => (devisLu?.Offre && !offres.some((o) => String(o.IdOffre) === String(devisLu.Offre.IdOffre))
    ? [...offres, devisLu.Offre] : offres), [offres, devisLu]);
  const offre = offresListe.find((o) => String(o.IdOffre) === String(idOffre)) || null;
  const cotisation = offre?.Saisie === SAISIE_COTISATION;
  const mensuel = cotisation && offre?.Periodicite === 'MENSUELLE';
  const libelleOffre = offre?.Libelle || 'Vie';

  const policesCompagnie = polices.filter((p) => String(p.IdCompagnie) === String(idCompagnie))
    .sort((a, b) => (cotisation ? Number(b.Mensuelle) - Number(a.Mensuelle) : 0));
  const policeRenouvelee = polices.find((p) => String(p.IdContrat) === String(idContratRenouvele));
  const enModification = Boolean(idDevisEdite);
  const enIncorporation = devisLu?.Mouvement === 'INC';
  const policeIncorporation = incorporation?.NumeroPolice || '';
  const lectureSeule = Boolean(devisLu?.Confirme);
  const compagnie = compagnies.find((c) => String(c.IdCompagnie) === String(idCompagnie));
  // Police mensuelle du souscripteur à continuer (Retraite complémentaire : un renouvellement par mois)
  const policeMensuelle = cotisation && !enModification ? polices.find((p) => p.Mensuelle) : null;

  // État des cotisations du mois précédent du souscripteur : comparaison et reprise pour une saisie à la main
  useEffect(() => {
    if (!cotisation || !souscripteur?.IdClient) { setPrecedent(null); return undefined; }
    let actif = true;
    afaApi.etatPrecedent(souscripteur.IdClient, dateEffet, idDevisEdite)
      .then((r) => { if (actif) setPrecedent(r?.Etat || null); })
      .catch(() => { if (actif) setPrecedent(null); });
    return () => { actif = false; };
  }, [cotisation, souscripteur?.IdClient, dateEffet, idDevisEdite]);

  // ------------------------------------------------------------- assurés (offres « capital »)
  const lignesSaisies = assures.filter((l) => String(l.Nom || '').trim() || l.DateNaissance || Number(l.PrimeTtc) > 0);
  const doublons = useMemo(() => {
    const vus = new Map();
    const resultat = new Set();
    lignesSaisies.forEach((l) => {
      const cle = l.IdClient ? `id${l.IdClient}` : cleIdentite(l);
      if (vus.has(cle)) { resultat.add(l.cle); resultat.add(vus.get(cle)); } else vus.set(cle, l.cle);
    });
    return resultat;
  }, [lignesSaisies]);
  const erreurs = Object.fromEntries(lignesSaisies.map((l) => [l.cle, [
    ...erreursLigne(l, dateEffet), ...(doublons.has(l.cle) ? ['assuré en double'] : []),
  ]]));
  const lignesEnErreur = lignesSaisies.filter((l) => erreurs[l.cle]?.length);
  const totalPrimes = lignesSaisies.reduce((s, l) => s + (Number(l.PrimeTtc) || 0), 0);
  const totalCapitaux = lignesSaisies.reduce((s, l) => s + (Number(l.Capital) || 0), 0);

  // ------------------------------------------------------------- salariés (offre « cotisations »)
  const cotisantsSaisis = useMemo(() => cotisants.filter(salarieSaisi), [cotisants]);
  const erreursCotisants = useMemo(() => {
    const matricules = new Map();
    const doubles = new Set();
    cotisantsSaisis.forEach((l) => {
      const m = String(l.Matricule || '').trim().toUpperCase();
      if (!m) return;
      if (matricules.has(m)) { doubles.add(l.cle); doubles.add(matricules.get(m)); } else matricules.set(m, l.cle);
    });
    return Object.fromEntries(cotisantsSaisis.map((l) => [l.cle, [...erreursCotisant(l), ...(doubles.has(l.cle) ? ['matricule en double'] : [])]]));
  }, [cotisantsSaisis]);
  const cotisantsEnErreur = cotisantsSaisis.filter((l) => erreursCotisants[l.cle]?.length);
  const totauxCotisations = useMemo(() => cotisantsSaisis.reduce((t, l) => ({
    salarie: t.salarie + (Number(l.CotisationSalarie) || 0), employeur: t.employeur + (Number(l.CotisationEmployeur) || 0),
  }), { salarie: 0, employeur: 0 }), [cotisantsSaisis]);
  const comparaison = useMemo(() => (cotisation ? comparerEtats(cotisantsSaisis, precedent) : null), [cotisation, cotisantsSaisis, precedent]);

  const primeNette = cotisation ? totauxCotisations.salarie + totauxCotisations.employeur : totalPrimes;
  const primeTtc = primeNette + (Number(accessoire) || 0);
  const nombreLignes = cotisation ? cotisantsSaisis.length : lignesSaisies.length;
  const nombreErreurs = cotisation ? cotisantsEnErreur.length : lignesEnErreur.length;

  const changerLigne = (cle, champ, valeur) => setAssures((liste) => liste.map((l) => (l.cle === cle ? {
    ...l,
    [champ]: valeur,
    // Nom ou date changés : la fiche client reprise ne correspond plus forcément
    ...(['Nom', 'Prenoms', 'DateNaissance'].includes(champ) && l.ClientConnu ? { IdClient: null, ClientConnu: null } : {}),
  } : l)));
  const retirerLigne = (cle) => setAssures((liste) => (liste.length > 1 ? liste.filter((l) => l.cle !== cle) : [ligneVide()]));
  const reprendreFiche = (cle) => setAssures((liste) => liste.map((l) => (l.cle === cle && l.Proposition ? {
    ...l, IdClient: l.Proposition.IdClient, ClientConnu: l.Proposition, Proposition: null,
  } : l)));
  const appliquerATous = () => {
    if (!(Number(capitalTous) > 0) && !(Number(primeTous) > 0)) return;
    setAssures((liste) => liste.map((l) => ({
      ...l,
      ...(Number(capitalTous) > 0 ? { Capital: Number(capitalTous) } : {}),
      ...(Number(primeTous) > 0 ? { PrimeTtc: Number(primeTous) } : {}),
    })));
    info('Capital et prime appliqués à tous les assurés de la liste.');
  };

  const choisirSouscripteur = (personne) => {
    setSouscripteur(personne);
    setIdContratRenouvele('');
    setMouvement('AFN');
  };
  const choisirMois = useCallback((valeur) => {
    setMois(valeur);
    if (valeur) {
      setDateEffet(`${valeur}-01`);
      setDateExpiration(finDeMois(valeur));
    }
  }, []);
  const choisirOffre = (valeur) => {
    setIdOffre(valeur);
    const choisie = offresListe.find((o) => String(o.IdOffre) === String(valeur));
    // Offre mensuelle : la période devient un mois entier, celui de la date d'effet déjà saisie
    if (choisie?.Saisie === SAISIE_COTISATION && choisie.Periodicite === 'MENSUELLE' && dateEffet) choisirMois(String(dateEffet).slice(0, 7));
  };
  const continuerPolice = (p) => {
    setIdCompagnie(String(p.IdCompagnie));
    setMouvement('REN');
    setIdContratRenouvele(String(p.IdContrat));
    if (!mois || mois <= String(p.DateEffet).slice(0, 7)) choisirMois(moisSuivant(p.DateEffet));
  };

  // Ouvert depuis la page Renouvellement : police, souscripteur, compagnie, offre et mois suivant repris, reste à importer l'état
  useEffect(() => {
    if (!idContratARenouveler) return undefined;
    let actif = true;
    afaApi.renouvelerRetraite(idContratARenouveler)
      .then(({ EtatMensuel: e }) => {
        if (!actif || !e) return;
        setMoisAttendu(e);
        setIdOffre(String(e.IdOffreVie));
        setSouscripteur({ IdClient: e.IdClient, Nom: e.Client || `Client n° ${e.IdClient}` });
        setIdCompagnie(String(e.IdCompagnie));
        setMouvement('REN');
        setIdContratRenouvele(String(e.IdContrat));
        choisirMois(String(e.MoisSuivant).slice(0, 7));
      })
      .catch((err) => { if (actif) toastError(`Police à renouveler non chargée : ${messageErreurApi(err)}`); });
    return () => { actif = false; };
  }, [idContratARenouveler]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mois suivant d'une police d'état des cotisations : il se crée avec le fichier du souscripteur, chaque mois (demande du 2026-11-11) ;
  // de même pour un mois déjà ouvert sans son état (devis de renouvellement qui n'avait recopié que le total du mois précédent)
  const fichierExige = mensuel && mouvement === 'REN' && (!enModification || !(devisLu?.Cotisants || []).length);

  // ------------------------------------------------------------- import Excel (liste AFA ou état des cotisations)
  const lireFichier = async (f) => {
    if (!f || analyse) return;
    setAnalyse(true);
    try {
      if (cotisation) {
        const resultat = await afaApi.analyserRetraite(f);
        setImportEtat({ ...resultat, Fichier: resultat.Fichier || f.name });
      } else {
        setImport(await afaApi.analyserImport(f));
        setFichier(f.name);
      }
    } catch (err) {
      toastError(`Fichier non analysé : ${messageErreurApi(err)}`);
    } finally {
      setAnalyse(false);
      if (fichierRef.current) fichierRef.current.value = '';
    }
  };
  const reprendreImport = (remplacer) => {
    if (!import_) return;
    const lignes = import_.Lignes.map((l) => ligneVide({
      IdClient: l.IdClient, Nom: l.Nom, Prenoms: l.Prenoms, DateNaissance: l.DateNaissance || '', Qualite: l.Qualite,
      Capital: l.Capital ?? '', PrimeTtc: l.PrimeTtc ?? '', Beneficiaires: l.Beneficiaires,
      Acte: l.Acte || (enIncorporation ? 'Incorporation' : ''),
      ClientConnu: l.ClientConnu, Proposition: l.Proposition, Avertissements: [...(l.Erreurs || []), ...(l.Avertissements || [])],
    }));
    setAssures((liste) => (remplacer || !lignesSaisies.length ? lignes : [...liste.filter((l) => lignesSaisies.includes(l)), ...lignes]));
    // Incorporation : période et souscripteur de la police, jamais ceux du fichier
    if (!enIncorporation) {
      if (import_.DateEffet && (!dateEffet || remplacer)) setDateEffet(import_.DateEffet);
      if (import_.DateExpiration && (!dateExpiration || remplacer)) setDateExpiration(import_.DateExpiration);
    }
    if (import_.Souscripteur?.IdClient && !souscripteur && !enIncorporation) {
      setSouscripteur({ IdClient: import_.Souscripteur.IdClient, Nom: import_.Souscripteur.Nom });
    }
    setImport(null);
    setEtape(2);
    success(`${lignes.length} assuré${lignes.length > 1 ? 's' : ''} repris du fichier : vérifiez la liste puis enregistrez.`);
  };
  const reprendreEtat = (remplacer) => {
    const a = importEtat;
    if (!a) return;
    const lignes = a.Lignes.map((l) => cotisantVide({
      Matricule: l.Matricule, Nom: l.Nom, Prenoms: l.Prenoms, CotisationSalarie: l.CotisationSalarie ?? '', CotisationEmployeur: l.CotisationEmployeur ?? '',
      Observation: l.Observation || '', Avertissements: [...(l.Erreurs || []), ...(l.Avertissements || [])],
    }));
    setCotisants((liste) => (remplacer || !cotisantsSaisis.length ? lignes : [...liste.filter(salarieSaisi), ...lignes]));
    setFichier(a.Fichier || '');
    if (!enModification) {
      if (a.Mois && (!mois || remplacer)) choisirMois(String(a.Mois).slice(0, 7));
      if (a.Souscripteur?.IdClient && (!souscripteur || remplacer)) setSouscripteur({ IdClient: a.Souscripteur.IdClient, Nom: a.Souscripteur.Nom });
      // Police mensuelle du souscripteur : l'état en est le mois suivant (renouvellement), chez sa compagnie
      const p = (a.Polices || []).find((x) => x.Mensuelle);
      if (p && compagnies.some((c) => String(c.IdCompagnie) === String(p.IdCompagnie))) {
        setIdCompagnie(String(p.IdCompagnie));
        setMouvement('REN');
        setIdContratRenouvele(String(p.IdContrat));
      }
    }
    setImportEtat(null);
    setEtape(2);
    success(`État de ${a.LibelleMois || 'cotisations'} repris : ${lignes.length} salarié${lignes.length > 1 ? 's' : ''}, ${fcfa(a.Totaux.Total)} F. Vérifiez puis enregistrez.`);
    if (moisAttendu && a.Mois && String(a.Mois).slice(0, 7) !== String(moisAttendu.MoisSuivant).slice(0, 7)) {
      toastError(`Ce fichier est l'état de ${a.LibelleMois} : le mois attendu pour la police ${moisAttendu.NumeroPolice} est ${moisAttendu.LibelleMoisSuivant}. Vérifiez le fichier.`);
    }
  };
  const reprendrePrecedent = async () => {
    if (!precedent) return;
    if (cotisantsSaisis.length && !(await confirmer({
      titre: `Reprendre l'état de ${precedent.LibelleMois} ?`,
      message: `Les ${cotisantsSaisis.length} salariés saisis seront remplacés par les ${precedent.Cotisants.length} de ${precedent.LibelleMois}, avec leurs cotisations, à ajuster ensuite.`,
      confirmer: 'Remplacer', annuler: 'Garder ma saisie',
    }))) return;
    setChargementPrecedent(true);
    setCotisants(precedent.Cotisants.map((c) => cotisantVide({ ...c })));
    setFichier('');
    setChargementPrecedent(false);
    info(`${precedent.Cotisants.length} salariés repris de ${precedent.LibelleMois} : ajustez les entrées, sorties et montants du mois.`);
  };
  const telechargerModele = async () => {
    try {
      if (cotisation) telechargerBlob(await afaApi.modeleRetraite(), 'modele_etat_cotisations_retraite.xlsx');
      else telechargerBlob(await afaApi.modele(), 'modele_liste_afa.xlsx');
    } catch (err) {
      toastError(`Modèle non téléchargé : ${messageErreurApi(err)}`);
    }
  };

  // ------------------------------------------------------------- navigation et enregistrement
  const messageFichierExige = `Importez l'état des cotisations de ${libelleMois(dateEffet) || 'ce mois'} reçu du souscripteur : chaque mois se renouvelle avec son fichier.`;
  const controleContrat = () => {
    if (!offre) return "Choisissez l'offre commerciale.";
    if (!idCompagnie) return 'Choisissez la compagnie.';
    if (!souscripteur?.IdClient) return 'Choisissez le souscripteur dans la liste des clients.';
    if (mensuel && !mois) return 'Choisissez le mois des cotisations.';
    if (!dateEffet || !dateExpiration) return "Saisissez les dates d'effet et d'échéance.";
    if (dateExpiration < dateEffet) return "La date d'échéance précède la date d'effet.";
    if (enIncorporation && incorporation?.DateEffetContrat && (dateEffet < incorporation.DateEffetContrat || dateEffet > dateExpiration)) {
      return `La date d'incorporation doit être comprise dans la période du contrat, du ${dateFr(incorporation.DateEffetContrat)} au ${dateFr(dateExpiration)}.`;
    }
    if (mouvement === 'REN' && !enModification && !idContratRenouvele) return 'Choisissez la police à renouveler.';
    return '';
  };
  const allerA = (cible) => {
    if (cible > 1) {
      const message = controleContrat();
      if (message) { toastError(message); setEtape(1); return; }
    }
    if (cible > 2) {
      if (!nombreLignes) {
        toastError(cotisation ? "Ajoutez au moins un salarié, ou importez l'état des cotisations." : 'Ajoutez au moins un assuré, ou importez la liste Excel.');
        setEtape(2);
        return;
      }
      if (nombreErreurs) { toastError(`${nombreErreurs} ${cotisation ? 'salarié(s)' : 'assuré(s)'} à corriger avant de continuer.`); setEtape(2); return; }
      if (fichierExige && !fichier) { toastError(messageFichierExige); setEtape(2); return; }
    }
    setEtape(cible);
  };

  const enregistrer = async () => {
    const message = controleContrat();
    if (message) { toastError(message); setEtape(1); return; }
    if (!nombreLignes || nombreErreurs) { allerA(3); return; }
    if (fichierExige && !fichier) { toastError(messageFichierExige); setEtape(2); return; }
    setEnregistrement(true);
    try {
      const devis = await afaApi.enregistrer({
        IdDevis: idDevisEdite || 0,
        IdOffreVie: Number(offre.IdOffre) || 0,
        Fichier: fichier,
        IdCompagnie: Number(idCompagnie),
        IdClient: Number(souscripteur.IdClient),
        IdContratRenouvele: !enModification && mouvement === 'REN' ? Number(idContratRenouvele) : 0,
        DateEffet: dateEffet,
        DateExpiration: dateExpiration,
        NumeroPoliceCompagnie: policeCompagnie,
        Accessoire: Number(accessoire) || 0,
        Assures: cotisation ? [] : lignesSaisies.map((l) => ({
          IdClient: l.IdClient || 0, Nom: l.Nom, Prenoms: l.Prenoms, DateNaissance: l.DateNaissance, Qualite: l.Qualite,
          Capital: Number(l.Capital), PrimeTtc: Number(l.PrimeTtc), Beneficiaires: l.Beneficiaires, Acte: l.Acte,
        })),
        Cotisants: cotisation ? cotisantsSaisis.map((l) => ({
          Matricule: l.Matricule, Nom: l.Nom, Prenoms: l.Prenoms, CotisationSalarie: Number(l.CotisationSalarie) || 0,
          CotisationEmployeur: Number(l.CotisationEmployeur) || 0, Observation: l.Observation,
        })) : [],
      });
      if (cotisation) {
        success(`État de ${devis.LibelleMois || libelleMois(dateEffet)} ${enModification ? 'modifié' : 'enregistré'} : devis N° ${devis.NumeroDevis}, ${devis.Cotisants.length} salariés, ${fcfa(devis.PrimeTtc)} F.`);
      } else {
        success(enIncorporation
          ? `Incorporation N° ${devis.NumeroDevis} enregistrée : ${devis.Assures.length} personne${devis.Assures.length > 1 ? 's' : ''} ajoutée${devis.Assures.length > 1 ? 's' : ''}, ${fcfa(devis.PrimeTtc)} F. Confirmez-la pour l'ajouter à la police ${policeIncorporation}.`
          : `Devis ${libelleOffre} N° ${devis.NumeroDevis} ${enModification ? 'modifié' : 'enregistré'} : ${devis.Assures.length} assurés, ${fcfa(devis.PrimeTtc)} F.`);
      }
      let fiche = null;
      try { fiche = await quoteApi.getQuote(devis.IdDevis); } catch { /* fiche indisponible : retour au registre */ }
      if (fiche) setDevisEnregistre(fiche);
      else navigate('/user/quotes');
    } catch (err) {
      toastError(`Devis ${libelleOffre} non enregistré : ${messageErreurApi(err)}`);
    } finally {
      setEnregistrement(false);
    }
  };

  const confirmerEnContrat = async (devis) => {
    try {
      const res = await contractApi.createContractFromQuote(devis.iddevis || devis.id);
      success(`Devis ${devis.numerodevis} confirmé : le contrat a été créé.`);
      setDevisEnregistre(null);
      const idContrat = Number(res?.data?.[0]?.ObjectId);
      navigate(idContrat > 0 ? `/user/contracts/${idContrat}` : '/user/contracts');
    } catch (err) {
      toastError(`Le devis n'a pas pu être confirmé : ${messageErreurApi(err)}`);
    }
  };

  // ------------------------------------------------------------- affichage
  const carte = { padding: '1.5rem', borderRadius: '14px' };
  const titreCarte = { display: 'flex', alignItems: 'center', gap: '0.55rem', margin: '0 0 1.2rem', fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' };
  const grille = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: '1rem 1.25rem', alignItems: 'start' };
  const pied = (...boutons) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>{boutons}</div>;
  const etapes = [
    { num: 1, libelle: 'Contrat', icone: FileText },
    { num: 2, libelle: cotisation ? 'Cotisations' : 'Assurés', icone: cotisation ? Wallet : Users },
    { num: 3, libelle: 'Vérification', icone: Calculator },
  ];
  const libelleMouvement = enModification
    ? (devisLu?.Mouvement === 'REN' ? `${cotisation ? 'Mois suivant' : 'Renouvellement'} de la police ${devisLu.PoliceRenouvelee}`
      : enIncorporation ? `Incorporation dans la police ${policeIncorporation}` : devisLu?.LibelleMouvement || 'Affaire nouvelle')
    : (mouvement === 'REN' ? `${cotisation ? 'Mois suivant' : 'Renouvellement'} de ${policeRenouvelee?.NumeroPolice || ''}` : 'Affaire nouvelle');

  if (chargement) {
    return (
      <div className="glass-panel" style={{ ...carte, maxWidth: 640, margin: '3rem auto', textAlign: 'center' }}>
        <Loader2 size={28} className="spin" style={{ color: COULEUR }} />
        <p style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>Chargement du devis Vie…</p>
      </div>
    );
  }

  return (
    <div className="page-container afa-page vie-page" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <header>
        <button type="button" className="btn btn-link" onClick={() => navigate('/user/quotes')}
          style={{ color: '#ef4444', fontWeight: 600, padding: 0, marginBottom: '0.5rem' }}>← Annuler</button>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <HeartHandshake size={26} color={COULEUR} />
          {enIncorporation
            ? `Incorporation ${libelleOffre} ${devisLu?.NumeroDevis || ''}`
            : (enModification ? `Modifier le devis ${libelleOffre} ${devisLu?.NumeroDevis || ''}` : 'Nouveau devis Vie')}
          {offre && !enModification && <span className="vie-etiquette accent" style={{ fontSize: '0.8rem' }}>{offre.Libelle}</span>}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: 860, lineHeight: 1.6 }}>
          {cotisation
            ? "État des cotisations du souscripteur : un salarié par ligne avec sa part et celle de l'employeur. Importez l'état Excel du mois ou saisissez-le ; la prime est le total des cotisations, sans prorata ni taxe."
            : 'Contrat de groupe : un assuré par ligne, avec son capital, sa prime et ses bénéficiaires. Importez la liste Excel ou saisissez-la. Les primes sont reprises telles quelles, sans prorata ; la Vie ne porte pas de taxe.'}
        </p>
        {enIncorporation && (
          <p role="note" style={{ padding: '0.65rem 0.85rem', borderRadius: 8, background: 'rgba(124, 58, 237, 0.08)', border: '1px solid rgba(124, 58, 237, 0.35)', fontSize: '0.86rem', lineHeight: 1.55, maxWidth: 820 }}>
            <strong>Incorporation dans la police {policeIncorporation || devisLu?.NumeroDevis}</strong>
            {incorporation ? `, qui compte ${incorporation.Personnes} personne${incorporation.Personnes > 1 ? 's' : ''}` : ''}
            {` : du ${dateFr(dateEffet)} à l'échéance inchangée du ${dateFr(dateExpiration)}. `}
            Saisissez ou importez seulement les personnes ajoutées ; une personne déjà assurée sous la police est refusée.
          </p>
        )}
        {fichierExige && !lectureSeule && (
          <p role="note" className="vie-mois-attendu">
            <RefreshCw size={16} color={COULEUR} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              <strong>Mois suivant de la police {moisAttendu?.NumeroPolice || policeRenouvelee?.NumeroPolice || devisLu?.PoliceRenouvelee || ''}</strong>
              {moisAttendu?.LibelleDernierMois || policeRenouvelee?.DateEffet
                ? ` (dernier mois enregistré : ${moisAttendu?.LibelleDernierMois || libelleMois(policeRenouvelee.DateEffet)})` : ''}
              {` : importez l'état des cotisations de ${libelleMois(dateEffet) || 'ce mois'} reçu du souscripteur. `}
              {fichier
                ? <>Fichier repris : <strong>{fichier}</strong>.</>
                : 'Un salarié qui ne cotise pas ce mois peut être absent du fichier ou y figurer à 0 F : il reste suivi, et reprend ses cotisations à son retour.'}
            </span>
          </p>
        )}
        {lectureSeule && (
          <p role="note" style={{ padding: '0.6rem 0.8rem', borderRadius: 8, background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#b45309', fontSize: '0.85rem' }}>
            Devis déjà confirmé : il est affiché en lecture seule.
          </p>
        )}
      </header>

      {/* Fichier Excel : glisser-déposer ou parcourir (liste AFA, ou état mensuel des cotisations) */}
      {!lectureSeule && offre && (
        <div className={`vie-depot${survol ? ' survol' : ''}${analyse ? ' occupe' : ''}${fichierExige && !fichier ? ' attendu' : ''}`} role="button" tabIndex={0}
          onClick={() => fichierRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fichierRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setSurvol(true); }} onDragLeave={() => setSurvol(false)}
          onDrop={(e) => { e.preventDefault(); setSurvol(false); lireFichier(e.dataTransfer.files?.[0]); }}
          aria-label={cotisation ? "Importer l'état Excel des cotisations" : 'Importer la liste Excel des assurés'}>
          <input ref={fichierRef} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => lireFichier(e.target.files?.[0])} />
          <span className="vie-depot-icone">{analyse ? <Loader2 size={22} className="spin" /> : <Upload size={22} />}</span>
          <span className="vie-depot-texte">
            <span className="vie-depot-titre">
              {analyse ? 'Lecture du fichier…' : cotisation
                ? `Déposez l'état des cotisations ${fichierExige && dateEffet ? `de ${libelleMois(dateEffet)}` : 'du mois'}`
                : `Déposez la liste ${libelleOffre} des assurés`}
            </span>
            <span className="vie-depot-aide">
              {cotisation
                ? 'Classeur Excel N°, Matricule, Nom, Prénoms, part salariale, part employeur : mois, souscripteur et police sont reconnus, et l’état est comparé au mois précédent.'
                : 'Classeur Excel au modèle AFA : souscripteur, période et assurés sont repris. Rien n’est enregistré avant « Enregistrer le devis ».'}
              {fichier ? ` Dernier fichier repris : ${fichier}.` : ''}
            </span>
          </span>
          <span className="vie-depot-actions">
            <button type="button" className="btn btn-primary" disabled={analyse} onClick={(e) => { e.stopPropagation(); fichierRef.current?.click(); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: COULEUR, borderColor: COULEUR }}>
              <FileSpreadsheet size={15} /> Choisir le fichier
            </button>
            <button type="button" className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); telechargerModele(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Download size={15} /> Modèle vierge
            </button>
          </span>
        </div>
      )}

      <EtapesDevis etapes={etapes} etape={etape} onAller={allerA} couleur={COULEUR} />

      <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '999 1 620px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {etape === 1 && (
            <section className="glass-panel" style={carte}>
              <h2 style={titreCarte}><FileText size={18} color={COULEUR} /> Contrat</h2>

              <div className="vie-offre">
                <label>
                  <span className="vie-offre-libelle">Offre commerciale</span>
                  <select className="form-control" value={idOffre} onChange={(e) => choisirOffre(e.target.value)}
                    disabled={lectureSeule || enIncorporation} aria-describedby="vie-offre-texte">
                    {!offre && <option value="">Choisir…</option>}
                    {offresListe.map((o) => <option key={o.IdOffre} value={o.IdOffre}>{o.Libelle}{o.Actif ? '' : ' - plus proposée'}</option>)}
                  </select>
                  {!offresReglables && (
                    <span className="vie-message" role="note" style={{ marginTop: '0.4rem' }}>
                      <AlertTriangle size={12} /> Retraite complémentaire et Temporaire décès s'ajoutent à la liste dès que la migration production 0219 est appliquée sur cette base.
                    </span>
                  )}
                </label>
                {offre && (
                  <div className="vie-offre-texte" id="vie-offre-texte" key={offre.IdOffre}>
                    <span>{offre.Description || (cotisation ? 'Cotisations salarié et employeur de chaque salarié.' : 'Assurés avec capital, prime et bénéficiaires.')}</span>
                    <span className="vie-offre-etiquettes">
                      <span className="vie-etiquette accent">{cotisation ? <Wallet size={12} /> : <Users size={12} />} {cotisation ? 'Cotisations salarié et employeur' : 'Assurés avec capital et prime'}</span>
                      <span className="vie-etiquette"><CalendarDays size={12} /> {PERIODICITES[offre.Periodicite] || offre.Periodicite}</span>
                      {offre.Garantie && <span className="vie-etiquette"><Layers size={12} /> {offre.Garantie}</span>}
                    </span>
                  </div>
                )}
              </div>

              {policeMensuelle && !(mouvement === 'REN' && String(idContratRenouvele) === String(policeMensuelle.IdContrat)) && (
                <div className="vie-suggestion" style={{ marginBottom: '1.25rem' }}>
                  <ArrowLeftRight size={18} color={COULEUR} />
                  <span style={{ flex: '1 1 280px' }}>
                    <strong>{policeMensuelle.NumeroPolice}</strong> chez {policeMensuelle.Compagnie} : dernier mois enregistré {libelleMois(policeMensuelle.DateEffet)}.
                    {' '}Le nouvel état en est le mois suivant, sous le même numéro de police.
                  </span>
                  <button type="button" className="btn btn-primary" onClick={() => continuerPolice(policeMensuelle)} style={{ background: COULEUR, borderColor: COULEUR }}>
                    Continuer cette police
                  </button>
                </div>
              )}

              <div style={grille}>
                <Champ label="Compagnie" requis aide={enIncorporation ? 'Compagnie de la police, non modifiable.' : "SANLAM gère la Vie : elle est proposée d'office."}>
                  <select className="form-control" value={idCompagnie} disabled={lectureSeule || (enModification && ['REN', 'INC'].includes(devisLu?.Mouvement))}
                    onChange={(e) => { setIdCompagnie(e.target.value); setIdContratRenouvele(''); setMouvement('AFN'); }}>
                    <option value="">Choisir…</option>
                    {/* Incorporation : compagnie de la police, même si elle n'est plus proposée pour les affaires nouvelles */}
                    {enIncorporation && devisLu?.IdCompagnie && !compagnies.some((c) => String(c.IdCompagnie) === String(devisLu.IdCompagnie)) && (
                      <option value={devisLu.IdCompagnie}>{devisLu.Compagnie || `Compagnie n° ${devisLu.IdCompagnie}`}</option>
                    )}
                    {compagnies.map((c) => <option key={c.IdCompagnie} value={c.IdCompagnie}>{c.Libelle}</option>)}
                  </select>
                </Champ>
                <div style={{ gridColumn: '1 / -1' }}>
                  {enIncorporation ? (
                    <Champ label="Souscripteur de la police" aide="Repris de la police, non modifiable.">
                      {souscripteur ? <FichePersonne personne={souscripteur} /> : <div className="form-control" aria-readonly="true">-</div>}
                    </Champ>
                  ) : (
                    <>
                      <RechercheClient label={cotisation ? 'Souscripteur, employeur' : 'Souscripteur, client'} personne={souscripteur} onChoisir={choisirSouscripteur}
                        onNouveau={() => setNouveauClient(true)} />
                      {souscripteur && <div style={{ marginTop: '0.75rem' }}><FichePersonne personne={souscripteur} /></div>}
                    </>
                  )}
                </div>
                <Champ label="Mouvement" requis large>
                  {enModification ? (
                    <div className="form-control" aria-readonly="true">{libelleMouvement}</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input type="radio" name="mouvement" checked={mouvement === 'AFN'} onChange={() => { setMouvement('AFN'); setIdContratRenouvele(''); }} />
                        Affaire nouvelle, nouvelle police
                      </label>
                      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', opacity: policesCompagnie.length ? 1 : 0.55 }}>
                        <input type="radio" name="mouvement" checked={mouvement === 'REN'} disabled={!policesCompagnie.length}
                          onChange={() => { setMouvement('REN'); setIdContratRenouvele(String(policesCompagnie[0]?.IdContrat || '')); }} />
                        {cotisation ? 'Mois suivant' : 'Renouvellement'} d'une police Vie du souscripteur chez {compagnie?.Libelle || 'cette compagnie'}
                      </label>
                      {mouvement === 'REN' && (
                        <select className="form-control" value={idContratRenouvele} onChange={(e) => setIdContratRenouvele(e.target.value)}>
                          {policesCompagnie.map((p) => (
                            <option key={p.IdContrat} value={p.IdContrat}>
                              {p.Mensuelle
                                ? `${p.NumeroPolice} - dernier mois ${libelleMois(p.DateEffet)} - ${fcfa(p.PrimeTtc)} F${p.Offre ? ` - ${p.Offre}` : ''}`
                                : `${p.NumeroPolice} - du ${dateFr(p.DateEffet)} au ${dateFr(p.DateExpiration)} - ${fcfa(p.PrimeTtc)} F${p.Offre ? ` - ${p.Offre}` : ''}`}
                            </option>
                          ))}
                        </select>
                      )}
                      {souscripteur && !policesCompagnie.length && polices.length > 0 && (
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          Polices Vie de ce souscripteur chez d'autres compagnies : {polices.map((p) => `${p.NumeroPolice} - ${p.Compagnie}`).join(' ; ')}.
                          Un renouvellement garde la compagnie de la police : chez {compagnie?.Libelle || 'cette compagnie'}, c'est une affaire nouvelle.
                        </span>
                      )}
                    </div>
                  )}
                </Champ>
                {mensuel ? (
                  <Champ label="Mois des cotisations" requis aide="Un état par mois : la période va du 1er au dernier jour du mois.">
                    <input type="month" className="form-control" value={mois} disabled={lectureSeule} onChange={(e) => choisirMois(e.target.value)} />
                    {mois && <div className="vie-periode" style={{ marginTop: '0.5rem' }}><CalendarDays size={14} color={COULEUR} /> du {dateFr(dateEffet)} au {dateFr(dateExpiration)}</div>}
                  </Champ>
                ) : (
                  <>
                    <Champ label={enIncorporation ? "Date d'incorporation" : "Date d'effet"} requis
                      aide={enIncorporation && incorporation?.DateEffetContrat ? `Au choix dans la période du contrat, à partir du ${dateFr(incorporation.DateEffetContrat)}.` : undefined}>
                      <input type="date" className="form-control" value={dateEffet} disabled={lectureSeule} onChange={(e) => setDateEffet(e.target.value)}
                        min={enIncorporation ? incorporation?.DateEffetContrat : undefined} max={enIncorporation ? dateExpiration : undefined} />
                    </Champ>
                    <Champ label={enIncorporation ? "Date d'échéance du contrat" : "Date d'échéance"} requis aide={enIncorporation ? 'Fin du contrat, non modifiable.' : undefined}>
                      <input type="date" className="form-control" value={dateExpiration} min={dateEffet || undefined} disabled={lectureSeule || enIncorporation}
                        onChange={(e) => setDateExpiration(e.target.value)} />
                    </Champ>
                  </>
                )}
                <Champ label="N° de police compagnie">
                  <input type="text" className="form-control" maxLength={50} value={policeCompagnie} disabled={lectureSeule}
                    onChange={(e) => setPoliceCompagnie(e.target.value)} placeholder="Facultatif" />
                </Champ>
                <Champ label="Accessoires du contrat" aide={cotisation ? 'Frais éventuels, ajoutés au total des cotisations.' : 'Coût de police éventuel, ajouté aux primes des assurés.'}>
                  <AmountInput value={accessoire} onChange={(v) => setAccessoire(Number(v) || 0)} disabled={lectureSeule} />
                </Champ>
              </div>
              {pied(<span key="vide" />, <button key="suivant" type="button" className="btn btn-primary" onClick={() => allerA(2)} style={{ background: COULEUR, borderColor: COULEUR }}>Suivant : {cotisation ? 'cotisations' : 'assurés'}</button>)}
            </section>
          )}

          {etape === 2 && cotisation && (
            <section className="glass-panel" style={carte}>
              <h2 style={{ ...titreCarte, marginBottom: '1rem', flexWrap: 'wrap' }}>
                <Wallet size={18} color={COULEUR} /> État des cotisations{mois ? ` de ${libelleMois(mois)}` : ''}
                {souscripteur?.Nom && <span className="vie-etiquette">{souscripteur.Nom}</span>}
              </h2>
              <EtatCotisations cotisants={cotisants} setCotisants={setCotisants} erreurs={erreursCotisants} comparaison={comparaison}
                precedent={precedent} chargementPrecedent={chargementPrecedent} onReprendrePrecedent={fichierExige ? null : reprendrePrecedent}
                lectureSeule={lectureSeule} />
              {pied(
                <button key="prec" type="button" className="btn btn-secondary" onClick={() => setEtape(1)}>Précédent</button>,
                <button key="suiv" type="button" className="btn btn-primary" onClick={() => allerA(3)} style={{ background: COULEUR, borderColor: COULEUR }}>Suivant : vérification</button>,
              )}
            </section>
          )}

          {etape === 2 && !cotisation && (
            <section className="glass-panel" style={carte}>
              <h2 style={titreCarte}><Users size={18} color={COULEUR} /> Assurés · {lignesSaisies.length}</h2>
              {!lectureSeule && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '1rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setAssures((l) => [...l, ligneVide(enIncorporation ? { Acte: 'Incorporation' } : {})])} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Plus size={15} /> {enIncorporation ? 'Ajouter une personne' : 'Ajouter un assuré'}
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Pour tous :</span>
                    <input type="number" min="0" className="form-control" style={{ width: 130 }} placeholder="Capital" value={capitalTous} onChange={(e) => setCapitalTous(e.target.value)} aria-label="Capital pour tous les assurés" />
                    <input type="number" min="0" className="form-control" style={{ width: 110 }} placeholder="Prime" value={primeTous} onChange={(e) => setPrimeTous(e.target.value)} aria-label="Prime pour tous les assurés" />
                    <button type="button" className="btn btn-secondary" onClick={appliquerATous} disabled={!(Number(capitalTous) > 0) && !(Number(primeTous) > 0)}>Appliquer</button>
                  </div>
                </div>
              )}
              <div className="table-wrapper">
                <table className="data-table afa-table">
                  <thead>
                    <tr>
                      <th>N°</th><th>Nom</th><th>Prénoms</th><th>Naissance</th><th>Qualité</th><th className="droite">Capital</th>
                      <th className="droite">Prime TTC</th><th>Bénéficiaires</th><th>Acte</th><th>Fiche client</th><th aria-label="Retirer" />
                    </tr>
                  </thead>
                  <tbody>
                    {assures.map((l, index) => {
                      const problemes = erreurs[l.cle] || [];
                      const ageAssure = age(l.DateNaissance, dateEffet);
                      return (
                        <React.Fragment key={l.cle}>
                          <tr className={problemes.length ? 'afa-ligne-erreur' : ''}>
                            <td>{index + 1}</td>
                            <td><input className="form-control" value={l.Nom} disabled={lectureSeule} onChange={(e) => changerLigne(l.cle, 'Nom', e.target.value.toUpperCase())} aria-label={`Nom de l'assuré ${index + 1}`} /></td>
                            <td><input className="form-control" value={l.Prenoms} disabled={lectureSeule} onChange={(e) => changerLigne(l.cle, 'Prenoms', e.target.value.toUpperCase())} aria-label={`Prénoms de l'assuré ${index + 1}`} /></td>
                            <td>
                              <input type="date" className="form-control" value={l.DateNaissance || ''} disabled={lectureSeule} onChange={(e) => changerLigne(l.cle, 'DateNaissance', e.target.value)} aria-label={`Date de naissance de l'assuré ${index + 1}`} />
                              {ageAssure !== null && ageAssure >= 0 && <span className="afa-age">{ageAssure} ans à l'effet</span>}
                            </td>
                            <td><input className="form-control" value={l.Qualite} disabled={lectureSeule} onChange={(e) => changerLigne(l.cle, 'Qualite', e.target.value.toUpperCase())} aria-label={`Qualité de l'assuré ${index + 1}`} /></td>
                            <td><input type="number" min="0" className="form-control droite" value={l.Capital} disabled={lectureSeule} onChange={(e) => changerLigne(l.cle, 'Capital', e.target.value)} aria-label={`Capital de l'assuré ${index + 1}`} /></td>
                            <td><input type="number" min="0" className="form-control droite" value={l.PrimeTtc} disabled={lectureSeule} onChange={(e) => changerLigne(l.cle, 'PrimeTtc', e.target.value)} aria-label={`Prime de l'assuré ${index + 1}`} /></td>
                            <td><input className="form-control" value={l.Beneficiaires} disabled={lectureSeule} onChange={(e) => changerLigne(l.cle, 'Beneficiaires', e.target.value.toUpperCase())} aria-label={`Bénéficiaires de l'assuré ${index + 1}`} placeholder="NOM PRENOMS / NOM 50%" /></td>
                            <td>
                              <select className="form-control" value={l.Acte} disabled={lectureSeule} onChange={(e) => changerLigne(l.cle, 'Acte', e.target.value)} aria-label={`Acte de l'assuré ${index + 1}`}>
                                <option value="">-</option>
                                {ACTES.map((a) => <option key={a} value={a}>{a}</option>)}
                              </select>
                            </td>
                            <td className="afa-fiche">
                              {l.IdClient ? (
                                <span className="afa-statut connu" title={l.ClientConnu?.Nom || ''}><UserCheck size={13} /> N° {l.IdClient}</span>
                              ) : l.Proposition ? (
                                <button type="button" className="afa-statut proposition" disabled={lectureSeule} onClick={() => reprendreFiche(l.cle)}
                                  title={`${l.Proposition.Nom} - ${l.Proposition.Motif}`}>
                                  Reprendre la fiche n° {l.Proposition.IdClient} ?
                                </button>
                              ) : (
                                <span className="afa-statut nouveau">Nouvelle fiche</span>
                              )}
                            </td>
                            <td>
                              {!lectureSeule && (
                                <button type="button" className="admin-bouton-icone" onClick={() => retirerLigne(l.cle)} aria-label={`Retirer l'assuré ${index + 1}`} title="Retirer de la liste">
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                          {(problemes.length > 0 || l.Avertissements?.length > 0 || l.Proposition) && (
                            <tr className="afa-ligne-message">
                              <td />
                              <td colSpan={10}>
                                {problemes.length > 0 && <span className="afa-message erreur"><AlertTriangle size={12} /> À corriger : {problemes.join(', ')}.</span>}
                                {l.Proposition && <span className="afa-message">Fiche n° {l.Proposition.IdClient} : {l.Proposition.Nom}{l.Proposition.DateNaissance ? `, né(e) le ${dateFr(l.Proposition.DateNaissance)}` : ''} - {l.Proposition.Motif}. Sans réponse, une nouvelle fiche est créée.</span>}
                                {(l.Avertissements || []).filter((a) => !a.startsWith('Assuré peut-être')).map((a) => <span key={a} className="afa-message">{a}</span>)}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5}>{lignesSaisies.length} assuré{lignesSaisies.length > 1 ? 's' : ''}</td>
                      <td className="droite">{fcfa(totalCapitaux)} F</td>
                      <td className="droite">{fcfa(totalPrimes)} F</td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>
              {pied(
                <button key="prec" type="button" className="btn btn-secondary" onClick={() => setEtape(1)}>Précédent</button>,
                <button key="suiv" type="button" className="btn btn-primary" onClick={() => allerA(3)} style={{ background: COULEUR, borderColor: COULEUR }}>Suivant : vérification</button>,
              )}
            </section>
          )}

          {etape === 3 && (
            <section className="glass-panel" style={carte}>
              <h2 style={titreCarte}><Calculator size={18} color={COULEUR} /> Vérification</h2>
              <div style={grille}>
                {[
                  ['Offre commerciale', offre?.Libelle],
                  ['Compagnie', compagnie?.Libelle || devisLu?.Compagnie],
                  ['Souscripteur', souscripteur?.Nom],
                  ['Mouvement', libelleMouvement],
                  mensuel
                    ? ['Mois des cotisations', `${libelleMois(mois)}, du ${dateFr(dateEffet)} au ${dateFr(dateExpiration)}`]
                    : ['Période', `du ${dateFr(dateEffet)} au ${dateFr(dateExpiration)}${enIncorporation ? ', échéance du contrat' : ''}`],
                  ...(cotisation ? [
                    ['Salariés', `${cotisantsSaisis.length}`],
                    ['Part salariale', `${fcfa(totauxCotisations.salarie)} F`],
                    ['Part employeur', `${fcfa(totauxCotisations.employeur)} F`],
                  ] : [
                    ['Assurés', `${lignesSaisies.length} dont ${lignesSaisies.filter((l) => !l.IdClient).length} nouvelle(s) fiche(s) client`],
                    ['Capitaux assurés', `${fcfa(totalCapitaux)} F`],
                  ]),
                ].map(([libelle, valeur]) => (
                  <div key={libelle}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{libelle}</div>
                    <div style={{ fontWeight: 700, marginTop: '0.2rem' }}>{valeur || '-'}</div>
                  </div>
                ))}
              </div>
              {cotisation && comparaison && (
                <div className="vie-comparaison" style={{ marginTop: '1.1rem' }}>
                  <div className="vie-comparaison-titre"><ArrowLeftRight size={16} color={COULEUR} /> Par rapport à {precedent.LibelleMois}</div>
                  <div className="vie-offre-etiquettes">
                    <span className="vie-etiquette vert">{comparaison.entrants.size} entrée{comparaison.entrants.size > 1 ? 's' : ''}</span>
                    <span className="vie-etiquette rose">{comparaison.sortants.length} sortie{comparaison.sortants.length > 1 ? 's' : ''}</span>
                    <span className="vie-etiquette ambre">{comparaison.modifies.size} montant{comparaison.modifies.size > 1 ? 's' : ''} modifié{comparaison.modifies.size > 1 ? 's' : ''}</span>
                    <span className={`vie-etiquette ${comparaison.ecart >= 0 ? 'vert' : 'rose'}`}>{fcfaSigne(comparaison.ecart)} F sur le total</span>
                  </div>
                </div>
              )}
              {!cotisation && lignesSaisies.some((l) => l.Proposition) && (
                <p className="afa-message" style={{ marginTop: '1rem' }}>
                  <AlertTriangle size={13} /> {lignesSaisies.filter((l) => l.Proposition).length} assuré(s) ressemblent à une fiche existante sans
                  y être rattachés : une nouvelle fiche sera créée pour chacun. Revenez à l'étape Assurés pour reprendre ces fiches.
                </p>
              )}
              {pied(
                <button key="prec" type="button" className="btn btn-secondary" onClick={() => setEtape(2)}>Précédent</button>,
                !lectureSeule && (
                  <button key="enr" type="button" className="btn btn-primary" onClick={enregistrer} disabled={enregistrement}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: COULEUR, borderColor: COULEUR }} aria-busy={enregistrement}>
                    {enregistrement ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
                    {enIncorporation ? "Enregistrer l'incorporation" : (enModification ? 'Enregistrer les modifications' : 'Enregistrer le devis')}
                  </button>
                ),
              )}
            </section>
          )}
        </div>

        {/* Étape des lignes : toute la largeur pour le tableau (totaux en pied de tableau) */}
        {etape !== 2 && (
        <ResumeDevis titre={`Votre devis ${libelleOffre}`} icone={HeartHandshake} couleur={COULEUR}
          lignes={[
            ['Offre', offre?.Libelle],
            ['Compagnie', compagnie?.Libelle],
            ['Souscripteur', souscripteur?.Nom],
            ...(cotisation ? [
              ['Mois', libelleMois(mois)],
              ['Salariés', cotisantsSaisis.length],
              ['Part salariale', `${fcfa(totauxCotisations.salarie)} F`],
              ['Part employeur', `${fcfa(totauxCotisations.employeur)} F`],
            ] : [
              ['Assurés', lignesSaisies.length],
              ['Primes des assurés', `${fcfa(totalPrimes)} F`],
            ]),
            ['Accessoires', `${fcfa(accessoire)} F`],
            ['Taxe', '0 F'],
          ]}
          libelleMontant={cotisation ? 'Total à encaisser' : 'Prime TTC'}
          montant={`${fcfa(primeTtc)} F`}
          detail={nombreErreurs ? `${nombreErreurs} ${cotisation ? 'salarié(s)' : 'assuré(s)'} à corriger` : undefined}
        />
        )}
      </div>

      <Modal isOpen={Boolean(import_)} onClose={() => setImport(null)} title={`Liste ${libelleOffre} importée`}
        subtitle={import_ ? `${import_.Titre || import_.Feuille} - rien n'est enregistré avant « Enregistrer le devis »` : ''} maxWidth="900px">
        {import_ && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
              {[
                ['Assurés', import_.Totaux.Assures],
                ['Fiches retrouvées', import_.Totaux.Connus],
                ['Fiches à vérifier', import_.Totaux.AVerifier],
                ['Primes', `${fcfa(import_.Totaux.PrimeTtc)} F`],
                ['Capitaux', `${fcfa(import_.Totaux.Capital)} F`],
                ['Période', import_.DateEffet ? `${dateFr(import_.DateEffet)} au ${dateFr(import_.DateExpiration)}` : '-'],
              ].map(([libelle, valeur]) => (
                <div key={libelle} style={{ padding: '0.65rem 0.8rem', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{libelle}</div>
                  <div style={{ fontWeight: 800 }}>{valeur}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.84rem' }}>
              Souscripteur du fichier : <strong>{import_.Souscripteur?.Texte || '-'}</strong>
              {import_.Souscripteur?.IdClient ? ` - client n° ${import_.Souscripteur.IdClient} retrouvé` : import_.Souscripteur ? ' - aucun client à ce nom : choisissez-le ou créez-le' : ''}
              {import_.Polices?.length > 0 && <div style={{ color: 'var(--text-muted)', marginTop: '0.25rem' }}>Polices Vie existantes : {import_.Polices.map((p) => `${p.NumeroPolice} - ${p.Compagnie}`).join(' ; ')}.</div>}
            </div>
            {[...import_.Erreurs.map((m) => ['erreur', m]), ...import_.Avertissements.map((m) => ['', m])].map(([ton, m]) => (
              <p key={m} className={`afa-message ${ton}`} style={{ margin: 0 }}><AlertTriangle size={13} /> {m}</p>
            ))}
            {import_.Lignes.some((l) => l.Erreurs.length || l.Avertissements.length) && (
              <div className="table-wrapper" style={{ maxHeight: 260 }}>
                <table className="data-table">
                  <thead><tr><th>Ligne</th><th>Assuré</th><th>Contrôles</th></tr></thead>
                  <tbody>
                    {import_.Lignes.filter((l) => l.Erreurs.length || l.Avertissements.length).map((l) => (
                      <tr key={l.Ligne}>
                        <td>{l.Ligne}</td>
                        <td>{l.NomComplet}</td>
                        <td>
                          {l.Erreurs.map((m) => <div key={m} className="afa-message erreur">{m}</div>)}
                          {l.Avertissements.map((m) => <div key={m} className="afa-message">{m}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setImport(null)}>Fermer</button>
              {lignesSaisies.length > 0 && (
                <button type="button" className="btn btn-secondary" onClick={() => reprendreImport(false)}>Ajouter à la liste actuelle</button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => reprendreImport(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: COULEUR, borderColor: COULEUR }}>
                <FileSpreadsheet size={15} /> {lignesSaisies.length ? 'Remplacer la liste' : 'Reprendre la liste'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ImportEtatModal analyse={importEtat} onFermer={() => setImportEtat(null)} onReprendre={reprendreEtat} lignesActuelles={cotisantsSaisis.length} />

      {devisEnregistre && (
        <ViewQuoteModal
          isOpen={Boolean(devisEnregistre)}
          quote={devisEnregistre}
          onClose={() => { setDevisEnregistre(null); navigate('/user/quotes'); }}
          onConvertToContract={confirmerEnContrat}
        />
      )}

      <QuickAddClientModal
        isOpen={nouveauClient}
        onClose={() => setNouveauClient(false)}
        valeursInitiales={(import_?.Souscripteur && !import_.Souscripteur.IdClient) ? { nom: import_.Souscripteur.Texte, typeclient: 'Entreprise' }
          : (cotisation && importEtat?.Employeur && !importEtat.Souscripteur?.IdClient ? { nom: importEtat.Employeur, typeclient: 'Entreprise' } : undefined)}
        onClientCreated={(client) => {
          const personne = personneDepuisClient(client);
          if (personne?.IdClient) choisirSouscripteur(personne);
          setNouveauClient(false);
        }}
      />
    </div>
  );
};

export default NewAfaQuotePage;
