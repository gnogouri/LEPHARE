import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useNavigate } from '../../../utils/navigationDevis';
import { contractApi, quoteApi, dommagesApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { ViewQuoteModal } from './ViewQuoteModal';
import { QuickAddClientModal } from '../clients/QuickAddClientModal';
import { BandeauQuestionnaire, useQuestionnaireDevis } from './QuestionnaireDevis';
import { AmountInput } from '../../../components/common/AmountInput';
import { DUREES_CONTRAT, ID_DUREE_LIBRE, ID_TERME_AUTRE, ID_TERME_PAR_DEFAUT, termeEtDureeEnregistres, idTermeValide } from '../../../utils/termesContrat';
import { trierParLibelle } from '../../../utils/sortUtils';
import { numberToFrenchWords } from '../../../utils/exportUtils';
import { Champ, RechercheClient, personneDepuisClient } from '../../../components/common/RechercheClient';
import {
  Layers, Users, CheckCircle2, ChevronLeft, AlertTriangle, Loader2, ClipboardList,
  HardHat, Wrench, Cog, TrendingDown, Building2, Gem, Zap, MapPin, Landmark, Monitor,
  FileSignature, Settings2, UserPlus,
} from 'lucide-react';
import { arrondirMontant } from '../../../utils/parametrage';

// Production Dommages (produit 9), toutes les catégories de la branche (tarifs 4xx). L'écran suit la
// fiche « Cotation d'assurance » de NSIA (Caution, document d'OREOLE du 2026-10-08) : en-tête (catégorie,
// compagnie), informations sur l'intermédiaire, sur le prospect (dont les rubriques du risque réglées
// pour la catégorie et le montant du cautionnement ou les capitaux), sur la cotation (offre, antécédent,
// durée, prime), puis le décompte prime nette / accessoires / taxes / TTC. Calcul comme URANUS : un taux
// appliqué au capital de chaque garantie ; à 0, le montant de prime saisi va sur la garantie principale.
// Garanties de l'offre, franchises, rubriques du risque et textes de la fiche imprimée se règlent dans
// Administration > Réglages Dommages ; primes, taxes et accessoire viennent de fn_garantie_offre_dommages.

// Icône de la catégorie selon son code (stdtarif.codecategorie)
const ICONES_CATEGORIE = {
  405: Wrench, 410: Cog, 415: TrendingDown, 420: Monitor, 425: Building2, 430: HardHat,
  435: Gem, 440: Zap, 445: MapPin, 450: Landmark, 455: Layers, 460: FileSignature,
};

// Libellés des capitaux (fiche NSIA pour la Caution, URANUS pour la TRI)
const LIBELLES_CAPITAL = {
  101: 'Valeur matériels informatiques',
  62: 'Valeur frais de reconstitution',
  102: 'Valeur frais supplémentaires',
  243: 'Montant du cautionnement',
};
// Garanties qui portent le montant de prime saisi quand le taux est à 0 (comme URANUS)
const GARANTIES_PRINCIPALES = [101, 243];
const ANTECEDENTS = { 1: 'Affaire nouvelle', 2: 'Renouvellement' };

const DUREES = [...DUREES_CONTRAT, { id: ID_DUREE_LIBRE, mois: null, libelle: 'Autre' }];

const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
const aujourdhui = () => new Date().toISOString().split('T')[0];
const jour = (v) => (v ? String(v).slice(0, 10) : '');
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '-');
const pourcent = (v) => `${Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 4 })} %`;
const casePhrase = (texte) => {
  const t = String(texte || '').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// Date d'expiration : durée standard (veille du même jour n mois plus tard) ou saisie (durée libre)
const expirationPour = (dateEffet, dureeId, personnalisee) => {
  if (!dateEffet) return '';
  if (Number(dureeId) === ID_DUREE_LIBRE) return personnalisee || '';
  const mois = DUREES_CONTRAT.find((d) => d.id === Number(dureeId))?.mois || 12;
  const d = new Date(`${dateEffet}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + mois);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
};
const joursCouverts = (debut, fin) => {
  if (!debut || !fin) return null;
  return Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / 86400000) + 1;
};

const messageErreurApi = (err) => {
  const data = err?.response?.data;
  if (!data) return err?.message || 'serveur injoignable';
  if (Array.isArray(data)) return data[0]?.OutputMessage || JSON.stringify(data[0]);
  if (typeof data === 'string') return data.slice(0, 200);
  const direct = data.error || data.erreur || data.message || data.detail || data.OutputMessage;
  if (direct) return typeof direct === 'string' ? direct : JSON.stringify(direct);
  return Object.entries(data).map(([champ, v]) => `${champ} : ${Array.isArray(v) ? v.join(' ') : v}`).join(' ; ');
};

const styles = {
  carte: { padding: '1.35rem 1.5rem', borderRadius: '14px' },
  titreSection: {
    display: 'flex', alignItems: 'center', gap: '0.55rem', margin: '0 0 1.1rem', padding: '0.45rem 0.75rem', borderRadius: '8px',
    fontSize: '0.86rem', fontWeight: 800, letterSpacing: '0.02em', color: 'var(--text-primary)', background: 'var(--bg-surface-elevated)',
    borderLeft: '4px solid var(--primary-500)',
  },
  grille: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '1rem 1.25rem', alignItems: 'start' },
  sousTitre: { fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '1.35rem 0 0.75rem' },
  aide: { fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' },
  lecture: { minHeight: '2.4rem', display: 'flex', alignItems: 'center', padding: '0 0.75rem', borderRadius: '8px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' },
  alerte: (couleur) => ({
    display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.8rem 1rem', borderRadius: '10px',
    border: `1px solid ${couleur}`, background: 'var(--bg-surface-elevated)', fontSize: '0.85rem', color: 'var(--text-primary)',
  }),
  ligneRecap: { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px dashed var(--border-subtle)', fontSize: '0.84rem' },
};

// Valeur en lecture seule présentée comme un champ (rubriques de la fiche remplies d'office)
const Lecture = ({ label, children, aide }) => (
  <Champ label={label} aide={aide}><div style={styles.lecture}>{children || '-'}</div></Champ>
);

export const NewTousDommagesQuotePage = () => {
  const navigate = useNavigate();
  const { peut } = useAuth();
  const { success, error: toastError } = useToast();

  // « Modifier » depuis le registre des devis : ?edit=<iddevis>
  const [searchParams] = useSearchParams();
  const editParam = searchParams.get('edit');
  const [chargementEdition, setChargementEdition] = useState(Boolean(editParam));
  const [idDevisEdite, setIdDevisEdite] = useState(0);
  const [numeroDevisEdite, setNumeroDevisEdite] = useState('');
  const [idAvenant, setIdAvenant] = useState(1);
  const [avertissementReprise, setAvertissementReprise] = useState('');
  // Saisie enregistrée, appliquée aux garanties dès que l'offre de la catégorie est connue
  const reprise = useRef(null);
  // Franchises enregistrées sur le devis rouvert (sinon : celles de l'offre)
  const franchises = useRef({});

  const [verifie, setVerifie] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [devisEnregistre, setDevisEnregistre] = useState(null);
  const [nouveauClientPour, setNouveauClientPour] = useState(null);

  // Catalogue de la compagnie : catégories, garanties, taxes (GET /api/dommages/catalogue/)
  const [compagnie, setCompagnie] = useState(0);
  const [catalogue, setCatalogue] = useState(null);
  const [idTarif, setIdTarif] = useState(0);
  const [tarifDuDevis, setTarifDuDevis] = useState(0);

  // Prospect (souscripteur) ; l'assuré est le prospect tant qu'un autre n'est pas choisi
  const [souscripteur, setSouscripteur] = useState(null);
  const [assureChoisi, setAssureChoisi] = useState(null);
  const [assureDistinct, setAssureDistinct] = useState(false);
  const assure = (assureDistinct && assureChoisi) || souscripteur;
  const [telephone, setTelephone] = useState('');
  const [risque, setRisque] = useState({}); // rubriques du risque réglées pour la catégorie
  const [capitaux, setCapitaux] = useState({});
  const capitauxActuels = useRef({});
  capitauxActuels.current = capitaux;
  const [extras, setExtras] = useState([]); // garanties du devis absentes de l'offre actuelle

  // Cotation
  const dateEmission = aujourdhui();
  const [dateEffet, setDateEffet] = useState(aujourdhui());
  const [dureeId, setDureeId] = useState(4);
  const [termeId, setTermeId] = useState(ID_TERME_PAR_DEFAUT);
  const [expirationPersonnalisee, setExpirationPersonnalisee] = useState('');
  const [numeroPoliceCompagnie, setNumeroPoliceCompagnie] = useState('');
  const dateExpiration = useMemo(() => expirationPour(dateEffet, dureeId, expirationPersonnalisee), [dateEffet, dureeId, expirationPersonnalisee]);
  const jours = joursCouverts(dateEffet, dateExpiration);
  const [tauxPrime, setTauxPrime] = useState('');
  const [reduction, setReduction] = useState(0);
  const [montantPrime, setMontantPrime] = useState(0);
  const [accessoire, setAccessoire] = useState(0); // 0 : barème de la compagnie
  const [calcul, setCalcul] = useState(null);
  const [calculEnCours, setCalculEnCours] = useState(false);

  // ---------------------------------------------------------------- catalogue de la compagnie
  useEffect(() => {
    let actif = true;
    dommagesApi.getCatalogue(compagnie || undefined)
      .then((c) => {
        if (!actif) return;
        setCatalogue(c);
        if (c?.IdCompagnie) setCompagnie((actuelle) => actuelle || Number(c.IdCompagnie));
      })
      .catch((err) => { if (actif) toastError(`Catalogue Dommages indisponible : ${messageErreurApi(err)}`); });
    return () => { actif = false; };
  }, [compagnie]); // eslint-disable-line react-hooks/exhaustive-deps

  const catalogueAJour = catalogue && Number(catalogue.IdCompagnie) === Number(compagnie);
  const categories = useMemo(
    () => (catalogue?.Categories || []).filter((c) => c.SaisieOuverte || Number(c.IdTarif) === Number(tarifDuDevis)),
    [catalogue, tarifDuDevis],
  );
  // Première catégorie proposée par défaut (la Caution, activité principale d'OREOLE)
  useEffect(() => {
    if (!idTarif && !editParam && categories.length) setIdTarif(Number(categories[0].IdTarif));
  }, [categories, idTarif, editParam]);
  const categorie = categories.find((c) => Number(c.IdTarif) === Number(idTarif)) || null;
  const garantiesOffre = useMemo(() => (catalogueAJour && categorie ? categorie.Garanties : []), [catalogueAJour, categorie]);
  const compagnies = useMemo(() => {
    const liste = (catalogue?.Compagnies || []).map((c) => ({ id: Number(c.IdCompagnie), nom: c.RaisonSociale }));
    return trierParLibelle(liste, (c) => c.nom);
  }, [catalogue]);
  const nomCompagnie = compagnies.find((c) => c.id === Number(compagnie))?.nom || '';

  // Questionnaire prospect (?questionnaire=) : formulaire Tous risques chantier, capital = coût total de l'opération
  const qd = useQuestionnaireDevis();
  const categorieQuestionnaire = qd.devis?.code_categorie
    ? categories.find((c) => String(c.CodeCategorie) === String(qd.devis.code_categorie)) : null;
  const reprendreQuestionnaire = () => {
    if (!categorieQuestionnaire) {
      toastError(`Catégorie ${qd.devis.code_categorie} absente du catalogue de cette compagnie.`);
      return;
    }
    const garantie = categorieQuestionnaire.Garanties?.[0];
    if (garantie && qd.devis.capital) setCapitaux((c) => ({ ...c, [garantie.IdSousGarantie]: Math.round(Number(qd.devis.capital)) }));
    setIdTarif(Number(categorieQuestionnaire.IdTarif));
    success(`${categorieQuestionnaire.Libelle}${qd.devis.capital ? ` : capital ${Math.round(qd.devis.capital).toLocaleString('fr-FR')} F (${qd.devis.base_capital})` : ''}.`);
  };
  useEffect(() => {
    if (devisEnregistre && qd.actif) qd.devisEtabli(devisEnregistre.numerodevis || '');
  }, [devisEnregistre]); // eslint-disable-line react-hooks/exhaustive-deps

  // Garanties de l'offre (catégorie x compagnie) : capitaux du devis rouvert, ou ceux déjà saisis
  useEffect(() => {
    if (!catalogueAJour || !categorie) return;
    const saisie = reprise.current;
    const nouveaux = {};
    categorie.Garanties.forEach((g) => {
      const enregistree = saisie?.garanties?.find((s) => Number(s.IdSousGarantie) === Number(g.IdSousGarantie));
      nouveaux[g.IdSousGarantie] = enregistree
        ? Math.round(Number(enregistree.Capital) || 0)
        : (saisie ? 0 : capitauxActuels.current[g.IdSousGarantie] || 0);
    });
    const horsOffre = (saisie?.garanties || []).filter((s) => !categorie.Garanties.some((g) => Number(g.IdSousGarantie) === Number(s.IdSousGarantie)));
    horsOffre.forEach((s) => { nouveaux[s.IdSousGarantie] = Math.round(Number(s.Capital) || 0); });
    setExtras(horsOffre.map((s) => ({ IdSousGarantie: s.IdSousGarantie, Libelle: saisie?.libelles?.[s.IdSousGarantie] || `Garantie n° ${s.IdSousGarantie}`, HorsOffre: true })));
    setCapitaux(nouveaux);
    if (!saisie) {
      const proposes = [...new Set(categorie.Garanties.map((g) => g.TauxDefaut).filter((t) => t !== null && t !== undefined))];
      if (proposes.length === 1) setTauxPrime((t) => (t === '' || Number(t) === 0 ? proposes[0] : t));
    }
    // Rubriques du risque : seules celles de la catégorie sont gardées
    setRisque((r) => {
      const valeurs = saisie?.risque || r;
      const suite = {};
      (categorie.ChampsRisque || []).forEach((c) => { if (valeurs[c.Cle]) suite[c.Cle] = valeurs[c.Cle]; });
      return suite;
    });
    reprise.current = null;
  }, [catalogueAJour, categorie?.IdTarif]); // eslint-disable-line react-hooks/exhaustive-deps

  const garanties = useMemo(() => [...garantiesOffre, ...extras], [garantiesOffre, extras]);
  const taux = Number(tauxPrime) || 0;
  const libelleCapital = (g) => LIBELLES_CAPITAL[Number(g.IdSousGarantie)]
    || (garanties.length === 1 ? 'Capital assuré' : `Capital ${casePhrase(g.Libelle)}`);

  // Taux à 0 : le montant de prime saisi va sur la garantie principale (matériel informatique ou caution,
  // sinon la première garantie dotée d'un capital, sinon la première de l'offre)
  const principale = useMemo(() => {
    if (taux > 0 || !garanties.length) return null;
    const avecCapital = garanties.filter((g) => Number(capitaux[g.IdSousGarantie]) > 0);
    return avecCapital.find((g) => GARANTIES_PRINCIPALES.includes(Number(g.IdSousGarantie)))
      || avecCapital[0]
      || garanties.find((g) => GARANTIES_PRINCIPALES.includes(Number(g.IdSousGarantie)))
      || garanties.find((g) => g.Obligatoire)
      || garanties[0];
  }, [taux, garanties, capitaux]);

  const garantiesPayload = useMemo(() => garanties.map((g) => {
    const id = g.IdSousGarantie;
    const capital = Number(capitaux[id]) || 0;
    const estPrincipale = principale && Number(principale.IdSousGarantie) === Number(id);
    const franchise = franchises.current[id] || {
      TauxFranchise: g.TauxFranchise || 0, FranchiseMinimum: g.FranchiseMinimum || 0, FranchiseMaximum: g.FranchiseMaximum || 0,
    };
    return {
      IdSousGarantie: id,
      Libelle: g.Libelle,
      Acquise: garanties.length === 1 || Boolean(g.Obligatoire) || capital > 0 || Boolean(estPrincipale),
      Capital: capital,
      Taux: taux > 0 && capital > 0 ? taux : 0,
      Prime: estPrincipale ? Number(montantPrime) || 0 : 0,
      ...franchise,
    };
  }), [garanties, capitaux, principale, taux, montantPrime]);
  const nbRetenues = garantiesPayload.filter((g) => g.Acquise).length;
  const capitalTotal = garantiesPayload.filter((g) => g.Acquise).reduce((s, g) => s + g.Capital, 0);
  const accessoireImpose = Number(accessoire) > 0;

  // ---------------------------------------------------------------- calcul (même fonction que l'enregistrement)
  useEffect(() => {
    if (!catalogueAJour || !categorie || !dateEffet || !dateExpiration || !nbRetenues || (jours !== null && jours < 1)) {
      setCalcul(null);
      return undefined;
    }
    let actif = true;
    const minuterie = setTimeout(async () => {
      setCalculEnCours(true);
      try {
        const res = await dommagesApi.calculer({
          IdCompagnie: Number(compagnie),
          IdTarif: Number(idTarif),
          DateEffet: dateEffet,
          DateExpiration: dateExpiration,
          TauxReduction: Number(reduction) || 0,
          Garanties: garantiesPayload,
          Accessoire: accessoireImpose ? Number(accessoire) : null,
        });
        if (actif) setCalcul(res);
      } catch (err) {
        if (actif) setCalcul({ erreur: messageErreurApi(err) });
      } finally {
        if (actif) setCalculEnCours(false);
      }
    }, 350);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [catalogueAJour, categorie?.IdTarif, compagnie, dateEffet, dateExpiration, reduction, garantiesPayload, accessoireImpose, accessoire]); // eslint-disable-line react-hooks/exhaustive-deps

  const cumul = calcul?.Cumul || null;

  // ---------------------------------------------------------------- Modifier (?edit=)
  useEffect(() => {
    if (!editParam) return undefined;
    let actif = true;
    (async () => {
      setChargementEdition(true);
      try {
        const d = await dommagesApi.lireDevis(editParam);
        if (!actif) return;
        if (d.Confirme) {
          toastError('Ce devis est confirmé (déjà en contrat) : il ne peut plus être modifié.');
          navigate('/user/quotes');
          return;
        }
        setIdDevisEdite(Number(d.IdDevis));
        setNumeroDevisEdite(d.NumeroDevis || '');
        setIdAvenant(Number(d.IdAvenant) || 1);
        const libelles = {};
        (d.Garanties || []).forEach((g) => { libelles[g.IdSousGarantie] = g.Libelle; });
        const saisies = d.Saisie?.Garanties || [];
        reprise.current = { garanties: saisies, risque: d.Saisie?.Risque || {}, libelles };
        franchises.current = Object.fromEntries(saisies.map((s) => [s.IdSousGarantie, {
          TauxFranchise: s.TauxFranchise ?? 0, FranchiseMinimum: s.FranchiseMinimum ?? 0, FranchiseMaximum: s.FranchiseMaximum ?? 0,
        }]));
        // Taux commun des garanties, sinon montant de prime saisi (somme des primes des garanties retenues)
        const tauxSaisi = saisies.map((s) => Number(s.Taux) || 0).find((t) => t > 0) || 0;
        setTauxPrime(tauxSaisi || '');
        setMontantPrime(tauxSaisi ? 0 : Math.round(saisies.filter((s) => s.Acquise).reduce((t, s) => t + (Number(s.Prime) || 0), 0)));
        setCompagnie(Number(d.IdCompagnie) || 0);
        setIdTarif(Number(d.Detail?.IdTarif) || 0);
        setTarifDuDevis(Number(d.Detail?.IdTarif) || 0);
        setReduction(Number(d.Detail?.TauxReduction) || 0);
        const charge = termeEtDureeEnregistres(d.IdTerme, d.IdDuree);
        setTermeId(charge.termeId);
        setDureeId(charge.dureeId);
        setDateEffet(jour(d.DateEffet) || aujourdhui());
        setExpirationPersonnalisee(jour(d.DateExpiration));
        // Durée standard dont l'expiration ne correspond pas : la date enregistrée est gardée (durée libre)
        if (charge.dureeId !== ID_DUREE_LIBRE && expirationPour(jour(d.DateEffet), charge.dureeId, '') !== jour(d.DateExpiration)) {
          setTermeId(ID_TERME_AUTRE);
          setDureeId(ID_DUREE_LIBRE);
        }
        setNumeroPoliceCompagnie(d.NumeroPoliceCompagnie || '');
        setAccessoire(Math.round(Number(d.Saisie?.AccessoireImpose) || 0));
        const client = personneDepuisClient(d.Client);
        const assureLu = personneDepuisClient(d.Assure);
        setSouscripteur(client ? { ...client, Email: d.Client?.Email || '' } : null);
        setTelephone(assureLu?.Telephone || client?.Telephone || '');
        if (assureLu && client && assureLu.IdClient !== client.IdClient) {
          setAssureDistinct(true);
          setAssureChoisi(assureLu);
        }
        setAvertissementReprise(!d.Detail
          ? `Aucune catégorie ni garantie n'est enregistrée pour ce devis : choisissez la catégorie et saisissez les capitaux ; les primes sont recalculées à l'enregistrement${d.Saisie?.AccessoireImpose ? ` (accessoire enregistré ${fcfa(d.Saisie.AccessoireImpose)} F conservé)` : ''}.`
          : '');
      } catch (err) {
        if (actif) {
          toastError(`Impossible de charger le devis à modifier : ${messageErreurApi(err)}`);
          navigate('/user/quotes');
        }
      } finally {
        if (actif) setChargementEdition(false);
      }
    })();
    return () => { actif = false; };
  }, [editParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- contrôles
  const controler = () => {
    const e = {};
    if (!compagnie) e.compagnie = 'Choisissez la compagnie.';
    if (!categorie) e.categorie = 'Choisissez la catégorie.';
    else if (catalogueAJour && !garanties.length) e.categorie = `Aucune garantie n'est paramétrée pour « ${categorie.Libelle} » chez ${nomCompagnie || 'cette compagnie'}.`;
    if (!souscripteur?.IdClient) e.souscripteur = 'Choisissez le prospect dans la liste des clients.';
    if (assureDistinct && !assureChoisi?.IdClient) e.assure = 'Choisissez l\'assuré dans la liste.';
    (categorie?.ChampsRisque || []).forEach((c) => {
      if (c.Obligatoire && !String(risque[c.Cle] || '').trim()) e[`risque_${c.Cle}`] = `Renseignez « ${c.Libelle} ».`;
    });
    if (taux < 0 || taux > 100) e.taux = 'Taux de prime compris entre 0 et 100 %.';
    if (Number(reduction) < 0 || Number(reduction) > 100) e.reduction = 'Réduction comprise entre 0 et 100 %.';
    if (taux > 0 && !(capitalTotal > 0)) e.capital = 'Saisissez le capital auquel s\'applique le taux de prime.';
    if (!taux && !(Number(montantPrime) > 0)) e.prime = 'Saisissez le taux de prime ou le montant de la prime.';
    if (!dateEffet) e.dateEffet = 'Saisissez la date d\'effet.';
    if (!dateExpiration) e.dateExpiration = 'Saisissez la date d\'expiration.';
    else if (jours !== null && jours < 1) e.dateExpiration = 'La date d\'expiration doit suivre la date d\'effet.';
    if (!e.prime && !e.capital && garanties.length) {
      if (calculEnCours) e.calcul = 'Calcul de la prime en cours…';
      else if (calcul?.erreur) e.calcul = `Prime non calculée : ${calcul.erreur}`;
      else if (!cumul || cumul.PrimeNette <= 0) e.calcul = 'La prime nette est nulle : vérifiez le taux et les capitaux, ou le montant de la prime.';
    }
    return e;
  };
  const erreurs = useMemo(() => (verifie ? controler() : {}), [verifie, compagnie, categorie, catalogueAJour, garanties, souscripteur, assureDistinct, assureChoisi, risque, taux, reduction, capitalTotal, montantPrime, dateEffet, dateExpiration, jours, calcul, calculEnCours, cumul]); // eslint-disable-line react-hooks/exhaustive-deps

  const choisirSouscripteur = (personne) => {
    setSouscripteur(personne);
    if (personne?.Telephone && !(assureDistinct && assureChoisi)) setTelephone(personne.Telephone);
  };
  const choisirAssure = (personne) => {
    setAssureChoisi(personne);
    if (personne?.Telephone) setTelephone(personne.Telephone);
  };
  const changerDuree = (id) => {
    setDureeId(id);
    if (id === ID_DUREE_LIBRE) setTermeId(ID_TERME_AUTRE);
    else if (Number(termeId) === ID_TERME_AUTRE) setTermeId(ID_TERME_PAR_DEFAUT);
  };

  // ---------------------------------------------------------------- enregistrement
  const enregistrer = async () => {
    setVerifie(true);
    const e = controler();
    if (Object.keys(e).length) {
      toastError(Object.values(e)[0]);
      return;
    }
    setEnregistrement(true);
    try {
      const res = await dommagesApi.enregistrer({
        IdDevis: idDevisEdite || 0,
        IdCompagnie: Number(compagnie),
        IdTarif: Number(idTarif),
        IdClient: Number(souscripteur.IdClient),
        IdAssure: Number(assure.IdClient),
        DateEffet: dateEffet,
        DateExpiration: dateExpiration,
        IdDuree: Number(dureeId),
        IdTerme: idTermeValide(termeId),
        TauxReduction: Number(reduction) || 0,
        Garanties: garantiesPayload,
        Accessoire: accessoireImpose ? Number(accessoire) : null,
        NumeroPoliceCompagnie: numeroPoliceCompagnie.trim(),
        TelephoneAssure: telephone.trim(),
        Risque: risque,
      });
      const id = Number(res?.ObjectId) || 0;
      if (!id) {
        toastError(`Devis Dommages non enregistré : ${res?.OutputMessage || 'réponse du serveur sans numéro de devis.'}`);
        return;
      }
      success(idDevisEdite ? `Devis Dommages N° ${res.NumeroDevis || id} modifié.` : `Devis Dommages N° ${res.NumeroDevis || id} enregistré.`);
      setIdDevisEdite(id);
      setNumeroDevisEdite(res.NumeroDevis || '');
      setTarifDuDevis(Number(idTarif));
      let devis = null;
      try {
        devis = await quoteApi.getQuote(id);
      } catch {
        // l'aperçu se contente des montants renvoyés par l'enregistrement
      }
      setDevisEnregistre(devis || {
        id, iddevis: id, numerodevis: res.NumeroDevis, branche: 'Tous Dommages', produit: 'TOUS DOMMAGES',
        client_nom: souscripteur.Nom, nomassure: assure.Nom, compagnie: nomCompagnie,
        prime_nette: res.PrimeNette, accessoires: res.Accessoire, taxes: res.Taxe, prime_totale: res.PrimeTtc,
        date_emission: dateEmission, date_effet: dateEffet, date_expiration: dateExpiration, raw: {},
      });
    } catch (err) {
      toastError(`Devis Dommages non enregistré : ${messageErreurApi(err)}`);
    } finally {
      setEnregistrement(false);
    }
  };

  const confirmerEnContrat = async (devis) => {
    try {
      const res = await contractApi.createContractFromQuote(devis.iddevis || devis.id);
      success(`Devis ${devis.numerodevis} confirmé : le contrat a été créé.`);
      setDevisEnregistre(null);
      // Fiche du contrat avec son relevé de compte (quittance remise au client)
      const idContrat = Number(res?.data?.[0]?.ObjectId);
      if (idContrat > 0) navigate(`/user/contracts/${idContrat}`, { state: { releve: true } });
      else navigate('/user/contracts');
    } catch (err) {
      toastError(`Le devis n'a pas pu être confirmé : ${messageErreurApi(err)}`);
    }
  };

  // ---------------------------------------------------------------- affichage
  if (chargementEdition) {
    return (
      <div className="glass-panel" style={{ ...styles.carte, maxWidth: 640, margin: '3rem auto', textAlign: 'center' }}>
        <Loader2 size={28} className="spin" style={{ color: 'var(--primary-500)' }} />
        <p style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>Chargement du devis Dommages…</p>
      </div>
    );
  }

  const ligneRecap = (libelle, valeur, fort) => (
    <div style={styles.ligneRecap}>
      <span style={{ color: 'var(--text-muted)' }}>{libelle}</span>
      <span style={{ textAlign: 'right', fontWeight: fort ? 800 : 600, color: 'var(--text-primary)' }}>{valeur || '-'}</span>
    </div>
  );
  const IconeCategorie = categorie ? (ICONES_CATEGORIE[Number(categorie.CodeCategorie)] || Layers) : Layers;
  const alerteErreur = (texte) => (
    <div style={{ ...styles.alerte('var(--accent-rose)'), marginBottom: '0.75rem' }}>
      <AlertTriangle size={18} style={{ color: 'var(--accent-rose)', flexShrink: 0 }} /><span>{texte}</span>
    </div>
  );
  const enMontant = (v) => (cumul ? `${fcfa(v)} F` : '');
  const titreCategorie = categorie ? String(categorie.Libelle).replace(/^ASSURANCE\s+/i, '') : 'DOMMAGES';
  const offreProposee = categorie ? (categorie.LibelleOffre || categorie.Libelle) : '';
  const adresseProspect = [souscripteur?.Adresse, souscripteur?.Email].filter(Boolean).join(' • ');

  const champRisque = (c) => (
    <Champ key={c.Cle} label={c.Libelle} requis={c.Obligatoire} erreur={erreurs[`risque_${c.Cle}`]} large={c.Type === 'texte_long'}>
      {c.Type === 'texte_long' ? (
        <textarea className="form-control" rows={2} maxLength={2000} value={risque[c.Cle] || ''} onChange={(e) => setRisque((r) => ({ ...r, [c.Cle]: e.target.value }))} />
      ) : c.Type === 'date' ? (
        <input type="date" className="form-control" value={risque[c.Cle] || ''} onChange={(e) => setRisque((r) => ({ ...r, [c.Cle]: e.target.value }))} />
      ) : c.Type === 'montant' ? (
        <AmountInput value={Number(risque[c.Cle]) || 0} onChange={(v) => setRisque((r) => ({ ...r, [c.Cle]: v ? String(v) : '' }))} />
      ) : c.Type === 'liste' ? (
        <select className="form-control" value={risque[c.Cle] || ''} onChange={(e) => setRisque((r) => ({ ...r, [c.Cle]: e.target.value }))}>
          <option value="">-</option>
          {(c.Options || []).map((o) => <option key={o} value={o}>{o}</option>)}
          {risque[c.Cle] && !(c.Options || []).includes(risque[c.Cle]) && <option value={risque[c.Cle]}>{risque[c.Cle]}</option>}
        </select>
      ) : (
        <input type="text" className="form-control" maxLength={200} value={risque[c.Cle] || ''} onChange={(e) => setRisque((r) => ({ ...r, [c.Cle]: e.target.value }))} />
      )}
    </Champ>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1320px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* EN-TÊTE */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <button type="button" className="btn btn-link" onClick={() => navigate('/user/quotes')} style={{ padding: 0, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            <ChevronLeft size={16} /> Registre des devis
          </button>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: 0 }}>
            <IconeCategorie size={26} style={{ color: 'var(--primary-500)' }} />
            Cotation d'assurance {titreCategorie}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.3rem 0 0' }}>
            {idDevisEdite
              ? <>Devis <strong>N° {numeroDevisEdite}</strong> - les primes sont recalculées à l'enregistrement.</>
              : 'Branche Dommages : Caution, Tous Risques Informatiques, Chantiers, Montage, Bris de Machines, Globale de Banque…'}
          </p>
        </div>
        {peut('tarifs.update') && (
          <Link to="/admin/settings/dommages" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Settings2 size={16} /> Réglages Dommages
          </Link>
        )}
      </div>

      {avertissementReprise && (
        <div style={styles.alerte('var(--accent-amber)')}>
          <AlertTriangle size={18} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />
          <span>{avertissementReprise}</span>
        </div>
      )}

      <BandeauQuestionnaire
        qd={qd}
        onCreerClient={() => setNouveauClientPour('souscripteur')}
        actions={qd.devis?.genre === 'trc' ? [{
          libelle: qd.devis.capital ? `Tous risques chantiers, capital ${Math.round(qd.devis.capital).toLocaleString('fr-FR')} F` : 'Catégorie Tous risques chantiers',
          icone: HardHat,
          principal: true,
          disabled: !catalogueAJour || !categorieQuestionnaire,
          titre: qd.devis.capital ? `Capital lu : ${qd.devis.base_capital}` : 'Le questionnaire ne donne pas le coût de l\'opération',
          onClick: reprendreQuestionnaire,
        }] : []}
      >
        {qd.devis?.genre === 'trc' && (qd.devis.operation || qd.devis.situation) && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {qd.devis.operation && <>Opération : <strong>{qd.devis.operation}</strong></>}
            {qd.devis.operation && qd.devis.situation && ' · '}
            {qd.devis.situation && <>Situation : <strong>{qd.devis.situation}</strong></>}
          </div>
        )}
      </BandeauQuestionnaire>

      <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          {/* ASSURANCE DEMANDÉE */}
          <section className="glass-panel" style={styles.carte}>
            {erreurs.categorie && alerteErreur(erreurs.categorie)}
            <div style={styles.grille}>
              <Champ label="Catégorie" requis>
                <select className="form-control" value={idTarif || ''} onChange={(e) => setIdTarif(Number(e.target.value))} disabled={!categories.length} style={{ fontWeight: 700 }}>
                  {!categorie && <option value="">{categories.length ? 'Choisir…' : 'Aucune catégorie ouverte'}</option>}
                  {categories.map((c) => <option key={c.IdTarif} value={c.IdTarif}>{c.Libelle}</option>)}
                </select>
              </Champ>
              <Champ label="Compagnie d'assurance" requis erreur={erreurs.compagnie}>
                <select className="form-control" value={compagnie || ''} onChange={(e) => setCompagnie(Number(e.target.value))} disabled={!compagnies.length} style={{ fontWeight: 700 }}>
                  {!compagnies.some((c) => c.id === Number(compagnie)) && <option value={compagnie || ''}>{compagnie ? `Compagnie n° ${compagnie}` : 'Chargement…'}</option>}
                  {compagnies.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </Champ>
            </div>
            {categorie && catalogueAJour && !garantiesOffre.length && peut('tarifs.update') && (
              <p style={styles.aide}>
                <Link to={`/admin/settings/dommages?categorie=${categorie.IdTarif}`}>Paramétrer les garanties de « {categorie.Libelle} » chez {nomCompagnie}</Link>
              </p>
            )}
          </section>

          {/* INFORMATIONS SUR LE PROSPECT */}
          <section className="glass-panel" style={styles.carte}>
            <h2 style={styles.titreSection}><Users size={16} style={{ color: 'var(--primary-500)' }} /> Informations sur le prospect</h2>
            <div style={styles.grille}>
              <RechercheClient label="Nom ou raison sociale" personne={souscripteur} onChoisir={choisirSouscripteur} onNouveau={() => setNouveauClientPour('souscripteur')} erreur={erreurs.souscripteur} />
              <Champ label="N° de téléphone / fax">
                <input type="tel" className="form-control" maxLength={30} value={telephone} onChange={(e) => setTelephone(e.target.value)} />
              </Champ>
              <Lecture label="Adresse postale / électronique" aide={souscripteur ? 'Fiche du client' : undefined}>{adresseProspect}</Lecture>
              {(categorie?.ChampsRisque || []).map(champRisque)}
              {garanties.map((g) => (
                <Champ key={g.IdSousGarantie} label={libelleCapital(g)} erreur={g === garanties[0] ? erreurs.capital : undefined}
                  aide={g.HorsOffre ? 'Garantie du devis absente de l\'offre actuelle' : undefined}>
                  <AmountInput value={capitaux[g.IdSousGarantie] || 0} onChange={(v) => setCapitaux((c) => ({ ...c, [g.IdSousGarantie]: v }))} />
                </Champ>
              ))}
            </div>
            {!assureDistinct ? (
              <button type="button" className="btn btn-link" onClick={() => setAssureDistinct(true)} style={{ padding: 0, marginTop: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem' }}>
                <UserPlus size={14} /> L'assuré est une autre personne
              </button>
            ) : (
              <div style={{ ...styles.grille, marginTop: '1rem' }}>
                <RechercheClient label="Assuré" personne={assureChoisi} onChoisir={choisirAssure} onNouveau={() => setNouveauClientPour('assure')} erreur={erreurs.assure} />
                <div style={{ alignSelf: 'end', paddingBottom: '0.4rem' }}>
                  <button type="button" className="btn btn-link" onClick={() => { setAssureDistinct(false); setAssureChoisi(null); }} style={{ padding: 0, fontSize: '0.82rem' }}>
                    L'assuré est le prospect
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* INFORMATIONS SUR LA COTATION */}
          <section className="glass-panel" style={styles.carte}>
            <h2 style={styles.titreSection}><ClipboardList size={16} style={{ color: 'var(--primary-500)' }} /> Informations sur la cotation</h2>
            <div style={styles.grille}>
              <Lecture label="Offre proposée">{offreProposee}</Lecture>
              <Lecture label="Antécédent de l'affaire">{ANTECEDENTS[idAvenant] || `Avenant n° ${idAvenant}`}</Lecture>
              <Champ label="N° de police compagnie" aide="Facultatif">
                <input type="text" className="form-control" maxLength={60} value={numeroPoliceCompagnie} onChange={(e) => setNumeroPoliceCompagnie(e.target.value)} />
              </Champ>
              <Champ label="Durée du contrat">
                <select className="form-control" value={dureeId} onChange={(e) => changerDuree(Number(e.target.value))}>
                  {DUREES.map((d) => <option key={d.id} value={d.id}>{d.libelle}</option>)}
                </select>
              </Champ>
              <Champ label="Date d'effet" requis erreur={erreurs.dateEffet}>
                <input type="date" className="form-control" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} />
              </Champ>
              <Champ label="Date d'expiration" requis erreur={erreurs.dateExpiration} aide={jours ? `${jours} jours couverts` : undefined}>
                {Number(dureeId) === ID_DUREE_LIBRE ? (
                  <input type="date" className="form-control" min={dateEffet || undefined} value={expirationPersonnalisee} onChange={(e) => setExpirationPersonnalisee(e.target.value)} />
                ) : (
                  <input type="date" className="form-control" value={dateExpiration} readOnly style={{ fontWeight: 700 }} />
                )}
              </Champ>
            </div>

            <div style={styles.sousTitre}>Montant de la prime</div>
            <div style={styles.grille}>
              <Champ label="Taux de prime (%)" erreur={erreurs.taux} aide="Appliqué au capital de chaque garantie">
                <input type="number" className="form-control" min={0} max={100} step="0.0001" value={tauxPrime} placeholder="0"
                  onChange={(e) => setTauxPrime(e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))))} />
              </Champ>
              {/* Comme URANUS : la réduction ne porte que sur une prime calculée au taux, une prime saisie est reprise telle quelle */}
              <Champ label="Taux de réduction (%)" erreur={erreurs.reduction}
                aide={taux > 0 ? undefined : 'Sans effet sur une prime saisie : saisissez la prime déjà réduite'}>
                <input type="number" className="form-control" min={0} max={100} step="0.01" value={taux > 0 ? reduction : 0}
                  disabled={!(taux > 0)}
                  onChange={(e) => setReduction(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
              </Champ>
              <Champ label="Prime nette" erreur={erreurs.prime}
                aide={taux > 0 ? 'Calculée : capital × taux' : `Taux à 0 : prime saisie${principale && garanties.length > 1 ? ` (${casePhrase(principale.Libelle)})` : ''}`}>
                {taux > 0
                  ? <input type="text" className="form-control" readOnly value={cumul ? `${fcfa(cumul.PrimeNette)} FCFA` : '-'} style={{ fontWeight: 700 }} />
                  : <AmountInput value={montantPrime} onChange={setMontantPrime} />}
              </Champ>
              <Champ label="Accessoires - optionnel"
                aide={accessoireImpose ? 'Montant imposé, partagé compagnie / cabinet comme le barème' : `Vide : barème ${nomCompagnie || 'de la compagnie'}${cumul ? ` (${fcfa(cumul.Accessoire)} F)` : ''}`}>
                <AmountInput value={accessoire} onChange={(v) => setAccessoire(Number(v) || 0)} />
              </Champ>
            </div>
            {erreurs.calcul && <div style={{ marginTop: '1rem' }}>{alerteErreur(erreurs.calcul)}</div>}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/user/quotes')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <ChevronLeft size={16} /> Annuler
              </button>
              <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={enregistrement} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 800 }}>
                {enregistrement ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                {idDevisEdite ? 'Enregistrer les modifications' : 'Enregistrer la cotation'}
              </button>
            </div>
          </section>
        </div>

        {/* DÉCOMPTE DE LA PRIME (comme le bas de la fiche) */}
        <aside className="glass-panel" style={{ ...styles.carte, flex: '1 1 280px', maxWidth: '100%', position: 'sticky', top: '1rem' }}>
          <h2 style={{ ...styles.titreSection, marginBottom: '0.75rem' }}><IconeCategorie size={16} style={{ color: 'var(--primary-500)' }} /> Votre cotation</h2>
          {ligneRecap('Prospect', souscripteur?.Nom)}
          {ligneRecap('Offre', offreProposee)}
          {ligneRecap('Période', dateExpiration ? `${dateFr(dateEffet)} → ${dateFr(dateExpiration)}` : '')}
          {ligneRecap(garanties.length === 1 && garanties[0] ? libelleCapital(garanties[0]) : 'Capitaux', capitalTotal ? `${fcfa(capitalTotal)} F` : '')}
          <div style={{ ...styles.sousTitre, margin: '1rem 0 0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            Prime {calculEnCours && <Loader2 size={12} className="spin" />}
          </div>
          {cumul && cumul.PrimeAnnuelle !== cumul.PrimeNette && ligneRecap('Prime annuelle', enMontant(cumul.PrimeAnnuelle))}
          {cumul && cumul.PrimeAnnuelle !== cumul.PrimeNette && ligneRecap(`Réduction${cumul.CoefficientProrata !== 1 ? ' / prorata' : ''}${Number(reduction) > 0 ? ` (${pourcent(reduction)})` : ''}`, `${fcfa(cumul.PrimeNette - cumul.PrimeAnnuelle)} F`)}
          {ligneRecap('Prime nette', enMontant(cumul?.PrimeNette))}
          {ligneRecap(`Accessoires${accessoireImpose ? ' (imposés)' : ''}`, enMontant(cumul?.Accessoire))}
          {ligneRecap('Taxes', enMontant(cumul?.Taxe))}
          <div style={{ marginTop: '1rem', padding: '0.9rem', borderRadius: '12px', background: 'var(--primary-glow)', border: '1px solid var(--primary-500)' }}>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--primary-500)' }}>Prime TTC</div>
            {/* TTC arrondie à la pièce de 5 F comme à l'enregistrement (Règles de gestion > Arrondi des montants) */}
            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--text-primary)' }}>{cumul && cumul.PrimeNette > 0 ? `${fcfa(arrondirMontant(cumul.PrimeTtc, 9))} F` : '-'}</div>
            {cumul && cumul.PrimeNette > 0 && (
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: '0.25rem', letterSpacing: '0.02em' }}>
                {numberToFrenchWords(arrondirMontant(cumul.PrimeTtc, 9))} FRANCS CFA
              </div>
            )}
          </div>
          {calcul?.erreur && <p style={{ ...styles.aide, color: 'var(--accent-rose)' }}>Prime non calculée : {calcul.erreur}</p>}
        </aside>
      </div>

      <QuickAddClientModal
        isOpen={Boolean(nouveauClientPour)}
        onClose={() => setNouveauClientPour(null)}
        valeursInitiales={nouveauClientPour === 'souscripteur' ? qd.client : null}
        onClientCreated={(client) => {
          const personne = personneDepuisClient(client);
          if (personne?.IdClient) {
            if (nouveauClientPour === 'souscripteur') choisirSouscripteur(personne); else choisirAssure(personne);
          }
          setNouveauClientPour(null);
        }}
      />

      {devisEnregistre && (
        <ViewQuoteModal
          quote={devisEnregistre}
          isOpen={Boolean(devisEnregistre)}
          onClose={() => setDevisEnregistre(null)}
          onConvertToContract={confirmerEnContrat}
        />
      )}
    </div>
  );
};

export default NewTousDommagesQuotePage;
