import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, BadgeCheck, Building2, CheckCircle2, ChevronRight, Download, FileSpreadsheet, FileText, HeartPulse, Loader2, Minus, Plus, Rows3, SlidersHorizontal, Trash2,
  Upload, User, UserPlus, Users, Wallet, X,
} from 'lucide-react';
import { apporteurApi, oreoleApi } from '../../../../api/endpoints';
import { useToast } from '../../../../context/ToastContext';
import { Champ, FichePersonne, RechercheClient, personneDepuisClient } from '../../../../components/common/RechercheClient';
import { EtapesDevis, ResumeDevis } from '../../../../components/common/ParcoursDevis';
import { AmountInput } from '../../../../components/common/AmountInput';
import { Modal } from '../../../../components/common/Modal';
import { QuickAddClientModal } from '../../clients/QuickAddClientModal';
import { messageErreurApi } from '../../../../utils/financeUtils';
import { imprimerOreole } from '../../../../utils/impressionsOreole';
import {
  BarreRepartition, COULEUR, LegendeRepartition, PRODUITS, RESEAUX, RESEAU_PHARMACIES, ageAu, carte, dateFr, echeanceAnnuelle, fcfa, grille, ligneDepuisImport, ligneDetail,
  noteInfo, titreCarte,
} from './oreoleCommun';

/* =========================================================================
   ORÉOLE SANTÉ : souscription, renouvellement et incorporation (sante/oreole.py)
   Une saisie, trois polices liées : Santé MCI, Individuelle Accidents NSIA, Assistance funéraire ALLIANZ CI VIE.
   Cotisation forfaitaire par famille, sans taxe sur la part Santé, sans prorata. Aucune option numérotée : l'offre
   se reconnaît au montant de sa cotisation.
   ?edit=<iddevis>           : devis du package à modifier
   ?contrat=<id>&acte=REN    : renouvellement des polices liées
   ?contrat=<id>&acte=INC    : incorporation, prime complémentaire
   ?cible=P | E              : famille ou groupe
   ========================================================================= */

const ENFANTS_FORFAIT = 4;
let compteur = 0;
const nouvelleCle = () => { compteur += 1; return `l${compteur}`; };
const ligneVide = (base = {}) => ({
  cle: nouvelleCle(), IdClient: 0, IdAdherentBase: 0, Matricule: '', Nom: '', Prenoms: '', DateNaissance: '', Sexe: '', IdOffre: null, Affections: 0, TauxAffection: '', TauxAge: '',
  SurprimeImposee: 0, CotisationImposee: 0, EnfantsEnPlus: 0, Personnes: 0, Ayants: [], Beneficiaires: '', Anomalies: [], ...base,
});
const LIENS = [{ code: 'C', libelle: 'Conjoint' }, { code: 'E', libelle: 'Enfant' }];
const ayantVide = (lien = 'E') => ({ cle: nouvelleCle(), Lien: lien, Nom: '', Prenoms: '', DateNaissance: '', Sexe: '' });
const libelleOffre = (o) => `${fcfa(o.Cotisation)} F${!o.PartIA && !o.PartAFA ? ' - Santé seule' : ''}`;
const erreursLigne = (l, effet) => {
  const erreurs = [];
  if (!String(l.Nom || '').trim()) erreurs.push('nom à saisir');
  const age = ageAu(l.DateNaissance, effet);
  if (!l.DateNaissance) erreurs.push('date de naissance à saisir');
  else if (age === null || age < 0 || age > 100) erreurs.push('date de naissance invraisemblable');
  if (!l.IdOffre) erreurs.push('offre à choisir');
  return erreurs;
};

const CarteOffre = ({ offre, choisie, onChoisir }) => (
  <button type="button" onClick={onChoisir} aria-pressed={choisie} style={{
    display: 'flex', flexDirection: 'column', gap: '0.45rem', textAlign: 'left', padding: '0.9rem 1rem', borderRadius: 14, cursor: 'pointer', color: 'var(--text-primary)',
    border: `1px solid ${choisie ? COULEUR : 'var(--border-medium)'}`, background: choisie ? `color-mix(in srgb, ${COULEUR} 8%, transparent)` : 'var(--bg-surface)',
    boxShadow: choisie ? `0 0 0 2px color-mix(in srgb, ${COULEUR} 35%, transparent)` : 'none', transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
  }}>
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>
      {offre.Nature === 'NEGOCIE' ? 'Prix négocié' : offre.Nature === 'GRILLE' ? 'Grille entreprises' : 'Particuliers'}
      {!offre.PartIA && !offre.PartAFA && <span style={{ color: 'var(--accent-amber)' }}>· Santé seule</span>}
      {choisie && <CheckCircle2 size={14} style={{ marginLeft: 'auto', color: COULEUR }} />}
    </span>
    <span style={{ fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-0.01em' }}>{fcfa(offre.Cotisation)} <small style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: 0 }}>F par famille</small></span>
    <BarreRepartition sante={offre.PartSante} ia={offre.PartIA} afa={offre.PartAFA} />
    <span style={{ display: 'flex', flexDirection: 'column', gap: '0.12rem', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
      {[['Soins, hospitalisation', `${offre.SoinsExternes} %, ${offre.Hospitalisation} %`], ['Plafond annuel', fcfa(offre.Plafond)],
        ['Capital IA', offre.CapitalIA ? fcfa(offre.CapitalIA) : '-'], ['Capital funéraire', offre.CapitalAFA ? fcfa(offre.CapitalAFA) : '-'], ['Enfant à partir du 5e', fcfa(offre.EnfantSupplementaire)],
      ].map(([l, v]) => <span key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>{l}<b style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{v}</b></span>)}
    </span>
  </button>
);

const LIGNES_BAREME = [
  ['Soins externes', (o) => `${o.SoinsExternes} %`], ['Hospitalisation', (o) => `${o.Hospitalisation} %`], ['Chambre par jour', (o) => fcfa(o.Chambre)], ['Ambulance par cas', (o) => fcfa(o.Ambulance)],
  ['Accouchement simple', (o) => fcfa(o.AccouchementSimple)], ['Accouchement gémellaire', (o) => fcfa(o.AccouchementGemellaire)], ['Accouchement chirurgical', (o) => fcfa(o.AccouchementChirurgical)],
  ['Hors structure privée', (o) => fcfa(o.AccouchementHorsStructure)], ['Optique adulte', (o) => fcfa(o.OptiqueAdulte)], ['Optique enfant', (o) => fcfa(o.OptiqueEnfant)],
  ['Dentaire par personne', (o) => fcfa(o.Dentaire)], ['Plafond annuel', (o) => fcfa(o.Plafond)], ['Capital IA', (o) => (o.CapitalIA ? fcfa(o.CapitalIA) : '-')],
  ['Capital funéraire', (o) => (o.CapitalAFA ? fcfa(o.CapitalAFA) : '-')], ['Enfant à partir du 5e', (o) => fcfa(o.EnfantSupplementaire)],
];

export default function NewOreolePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { success, error: toastError, warning } = useToast();
  const idEdition = Number(params.get('edit')) || 0;
  const idContratBase = Number(params.get('contrat')) || 0;
  const acteDemande = (params.get('acte') || '').toUpperCase();
  const fichierRef = useRef(null);

  const [chargement, setChargement] = useState(true);
  const [offres, setOffres] = useState([]);
  const [reglages, setReglages] = useState(null);
  const [apporteurs, setApporteurs] = useState([]);
  const [etape, setEtape] = useState(1);
  const [acte, setActe] = useState(acteDemande === 'REN' || acteDemande === 'INC' ? acteDemande : 'AFN');
  const [base, setBase] = useState(null); // préparation (renouvellement, incorporation)
  const [devisLu, setDevisLu] = useState(null);
  const [cible, setCible] = useState((params.get('cible') || 'E').toUpperCase() === 'P' ? 'P' : 'E');
  const [souscripteur, setSouscripteur] = useState(null);
  const [nouveauClient, setNouveauClient] = useState(false);
  const [dateEffet, setDateEffet] = useState('');
  const [dateExpiration, setDateExpiration] = useState('');
  const [policeCompagnie, setPoliceCompagnie] = useState('');
  const [idOffre, setIdOffre] = useState(null);
  const [comparer, setComparer] = useState(false);
  const [prixFamille, setPrixFamille] = useState('');
  const [carteAssurance, setCarteAssurance] = useState(false);
  // Personnes dont la carte déjà facturée est refacturée pour perte, et résultat de la vérification de l'historique au serveur
  const [cartesPerte, setCartesPerte] = useState([]);
  const [verifCartes, setVerifCartes] = useState(null);
  const [avecIA, setAvecIA] = useState(true);
  const [avecAFA, setAvecAFA] = useState(true);
  const [idApporteur, setIdApporteur] = useState('');
  // Pas de paiement d'apporteur, sauf convention qui dit le contraire
  const [apporteurConvention, setApporteurConvention] = useState(false);
  const [apporteurMode, setApporteurMode] = useState('FAMILLE');
  const [apporteurValeur, setApporteurValeur] = useState(0);
  const [lignes, setLignes] = useState([]);
  const [famille, setFamille] = useState({ conjoint: false, enfants: 0 });
  const [detail, setDetail] = useState(null); // cle de la ligne ouverte
  const [apercu, setApercu] = useState(null);
  const [apercuErreur, setApercuErreur] = useState('');
  const [analyse, setAnalyse] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [package_, setPackage] = useState(null);
  const [emission, setEmission] = useState(-1);
  const [ajoutFamille, setAjoutFamille] = useState('');

  const incorporation = acte === 'INC';
  const renouvellement = acte === 'REN';
  const lectureSeule = Boolean(devisLu?.Confirme);
  const particulier = cible === 'P';
  const offresCible = useMemo(() => offres.filter((o) => o.Cible === cible), [offres, cible]);
  const offre = useMemo(() => offres.find((o) => o.IdOffre === Number(idOffre)) || null, [offres, idOffre]);
  const offresParId = useMemo(() => Object.fromEntries(offres.map((o) => [o.IdOffre, o])), [offres]);
  const etapes = useMemo(() => (incorporation
    ? [{ num: 1, libelle: 'Incorporation', icone: UserPlus }, { num: 3, libelle: 'Personnes', icone: Users }, { num: 4, libelle: 'Trois polices', icone: BadgeCheck }]
    : [{ num: 1, libelle: 'Souscripteur', icone: User }, { num: 2, libelle: 'Offre', icone: Rows3 }, { num: 3, libelle: particulier ? 'Famille' : 'Adhérents', icone: Users }, { num: 4, libelle: 'Trois polices', icone: BadgeCheck }]),
  [incorporation, particulier]);

  // Lignes envoyées au serveur
  const lignesServeur = useMemo(() => lignes.filter((l) => String(l.Nom).trim() || String(l.Prenoms).trim() || l.DateNaissance), [lignes]);
  const lignesEnErreur = useMemo(() => lignesServeur.filter((l) => erreursLigne(l, dateEffet).length), [lignesServeur, dateEffet]);

  // ------------------------------------------------------------------ chargement
  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const [ref, listeApporteurs] = await Promise.all([oreoleApi.referentiels(), apporteurApi.liste().catch(() => [])]);
        if (!actif) return;
        setOffres(ref.Offres);
        setReglages(ref.Reglages);
        setApporteurs(Array.isArray(listeApporteurs) ? listeApporteurs.filter((a) => a.Actif !== false) : []);
        if (idEdition) {
          const d = await oreoleApi.lire(idEdition);
          if (!actif) return;
          setDevisLu(d);
          setPackage(d);
          setActe(d.Acte);
          setCible(d.Cible);
          setSouscripteur({ IdClient: d.IdClient, Nom: d.Client });
          setDateEffet(String(d.DateEffet).slice(0, 10));
          setDateExpiration(String(d.DateExpiration).slice(0, 10));
          setPoliceCompagnie(d.NumeroPoliceCompagnie || '');
          setIdOffre(d.IdOffre);
          setPrixFamille(d.PrixFamille || '');
          setCarteAssurance(d.Carte);
          setCartesPerte(d.CartesPerte || []);
          setIdApporteur(d.IdApporteur || '');
          setApporteurMode(d.ApporteurMode || 'FAMILLE');
          setApporteurValeur(d.ApporteurValeur || 0);
          setApporteurConvention(Boolean(d.ApporteurValeur));
          setAvecIA(Boolean(d.Produits.IA && !d.Produits.IA.Archive));
          setAvecAFA(Boolean(d.Produits.AFA && !d.Produits.AFA.Archive));
          // Devis enregistré sans IA ou sans AFA : la cotisation imposée est gardée nette de cette part (PartRetiree),
          // que la case « Émettre » rend si on la recoche
          const sansIA = !(d.Produits.IA && !d.Produits.IA.Archive);
          const sansAFA = !(d.Produits.AFA && !d.Produits.AFA.Archive);
          const repris = d.Adherents.map((a) => ligneVide({
            ...a, PartFichier: a.CotisationImposee > 0,
            PartRetiree: { PartIA: sansIA && !Number(a.PartIA), PartAFA: sansAFA && !Number(a.PartAFA) },
            Ayants: (a.Ayants || []).map((x) => ({ ...x, cle: nouvelleCle() })),
          }));
          setLignes(repris);
          if (d.Cible === 'P' && repris[0]) {
            setFamille({ conjoint: repris[0].Ayants.some((x) => x.Lien === 'C'), enfants: Math.max(repris[0].Ayants.filter((x) => x.Lien === 'E').length, 0) + (repris[0].EnfantsEnPlus && !repris[0].Ayants.length ? ENFANTS_FORFAIT + repris[0].EnfantsEnPlus : 0) });
          }
          setEtape(d.Confirme ? 4 : 2);
        } else if (idContratBase && (acteDemande === 'REN' || acteDemande === 'INC')) {
          const b = await oreoleApi.preparation(idContratBase, acteDemande);
          if (!actif) return;
          setBase(b);
          setCible(b.Cible);
          setSouscripteur({ IdClient: b.IdClient, Nom: b.Client });
          setDateEffet(b.DateEffet);
          setDateExpiration(b.DateExpiration);
          setIdOffre(b.IdOffre);
          setCarteAssurance(b.Carte);
          setPrixFamille(acteDemande === 'REN' && b.PrixFamille ? b.PrixFamille : '');
          setIdApporteur(b.IdApporteur || '');
          setApporteurMode(b.ApporteurMode || 'FAMILLE');
          setApporteurValeur(b.ApporteurValeur || 0);
          setApporteurConvention(Boolean(b.ApporteurValeur));
          if (acteDemande === 'REN') {
            setLignes(b.Adherents.map((a) => ligneVide({ ...a, IdAdherent: undefined, PartFichier: a.CotisationImposee > 0, Ayants: (a.Ayants || []).map((x) => ({ ...x, cle: nouvelleCle() })) })));
            setEtape(2);
          }
        }
      } catch (err) {
        if (actif) toastError(`Oreole Santé indisponible : ${messageErreurApi(err)}`);
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => { actif = false; };
  }, [idEdition, idContratBase, acteDemande]); // eslint-disable-line react-hooks/exhaustive-deps

  // Date d'effet : échéance à un an, sauf incorporation (échéance figée)
  const changerEffet = (valeur) => {
    setDateEffet(valeur);
    if (!incorporation) setDateExpiration(echeanceAnnuelle(valeur));
  };

  // Famille d'un particulier : une seule ligne, l'assuré principal, reprise de la fiche du souscripteur
  useEffect(() => {
    if (!particulier || incorporation || lectureSeule) return;
    setLignes((avant) => {
      const premiere = avant[0] || ligneVide();
      const enfantsAvant = premiere.Ayants.filter((a) => a.Lien === 'E');
      const conjoint = premiere.Ayants.find((a) => a.Lien === 'C') || ayantVide('C');
      const enfants = Array.from({ length: famille.enfants }, (_, i) => enfantsAvant[i] || ayantVide('E'));
      return [{
        ...premiere,
        IdClient: souscripteur?.IdClient || premiere.IdClient,
        Nom: premiere.Nom || souscripteur?.Nom || '',
        DateNaissance: premiere.DateNaissance || souscripteur?.DateNaissance || '',
        IdOffre: idOffre ? Number(idOffre) : premiere.IdOffre,
        Ayants: [...(famille.conjoint ? [conjoint] : []), ...enfants],
        EnfantsEnPlus: Math.max(0, famille.enfants - ENFANTS_FORFAIT),
        Personnes: 1 + (famille.conjoint ? 1 : 0) + famille.enfants,
      }];
    });
  }, [particulier, incorporation, lectureSeule, souscripteur, idOffre, famille]);

  // Offre choisie : portée sur les lignes sans offre propre
  useEffect(() => {
    if (!idOffre || lectureSeule) return;
    setLignes((avant) => avant.map((l) => (l.IdOffre ? l : { ...l, IdOffre: Number(idOffre) })));
  }, [idOffre, lectureSeule]);

  // ------------------------------------------------------------------ calcul
  const charge = useMemo(() => ({
    Cible: cible, DateEffet: dateEffet, DateExpiration: dateExpiration, IdOffre: Number(idOffre) || 0, PrixFamille: prixFamille || null, Carte: carteAssurance, CartesPerte: carteAssurance ? cartesPerte : [], AvecIA: avecIA, AvecAFA: avecAFA,
    IdApporteur: Number(idApporteur) || null, ApporteurMode: apporteurMode, ApporteurValeur: Number(apporteurValeur) || 0, NumeroPoliceCompagnie: policeCompagnie,
    Adherents: lignesServeur.map((l) => ({
      IdClient: l.IdClient || 0, IdAdherentBase: l.IdAdherentBase || 0, Matricule: l.Matricule, Nom: l.Nom, Prenoms: l.Prenoms, DateNaissance: l.DateNaissance, Sexe: l.Sexe,
      IdOffre: l.IdOffre || Number(idOffre) || 0, Affections: l.Affections || 0, TauxAffection: l.TauxAffection === '' ? null : l.TauxAffection, TauxAge: l.TauxAge === '' ? null : l.TauxAge,
      SurprimeImposee: Number(l.SurprimeImposee) || 0, CotisationImposee: Number(l.CotisationImposee) || 0, EnfantsEnPlus: Number(l.EnfantsEnPlus) || 0, Personnes: Number(l.Personnes) || 0,
      PartIA: l.PartFichier || Number(l.PartIA) > 0 ? l.PartIA : undefined, PartAFA: l.PartFichier || Number(l.PartAFA) > 0 ? l.PartAFA : undefined,
      Ayants: (l.Ayants || []).filter((a) => String(a.Nom).trim() || String(a.Prenoms).trim()).map((a) => ({ Lien: a.Lien, Nom: a.Nom, Prenoms: a.Prenoms, DateNaissance: a.DateNaissance || null, Sexe: a.Sexe })),
      Beneficiaires: l.Beneficiaires,
      ...(l.IdAdherentBase ? { AvecIA: false, AvecAFA: false } : {}),
    })),
  }), [cible, dateEffet, dateExpiration, idOffre, prixFamille, carteAssurance, cartesPerte, avecIA, avecAFA, idApporteur, apporteurMode, apporteurValeur, policeCompagnie, lignesServeur]);

  useEffect(() => {
    if (lectureSeule || !dateEffet || !charge.Adherents.length) { setApercu(null); setApercuErreur(''); return undefined; }
    const nouvelles = charge.Adherents.filter((a) => !a.IdAdherentBase && a.Nom && a.DateNaissance && a.IdOffre);
    if (!nouvelles.length) { setApercu(null); setApercuErreur(''); return undefined; }
    let actif = true;
    const minuterie = setTimeout(() => {
      oreoleApi.apercu({ ...charge, Adherents: nouvelles })
        .then((r) => { if (actif) { setApercu(r); setApercuErreur(''); } })
        .catch((err) => { if (actif) { setApercu(null); setApercuErreur(messageErreurApi(err)); } });
    }, 300);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [charge, dateEffet, lectureSeule]);

  // Carte demandée : le serveur vérifie l'historique de chaque personne, familles existantes comprises
  useEffect(() => {
    if (lectureSeule || !carteAssurance || !dateEffet) { setVerifCartes(null); return undefined; }
    const completes = charge.Adherents.filter((a) => a.Nom && a.DateNaissance && a.IdOffre);
    if (!completes.length) { setVerifCartes(null); return undefined; }
    let actif = true;
    const minuterie = setTimeout(() => {
      oreoleApi.verifierCartes({ ...charge, Adherents: completes })
        .then((r) => { if (actif) setVerifCartes(r); })
        .catch(() => { if (actif) setVerifCartes(null); });
    }, 300);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [charge, carteAssurance, dateEffet, lectureSeule]);

  // Alerte dès qu'une tentative vise une carte déjà facturée
  const alerteCartes = verifCartes?.Alerte || '';
  useEffect(() => { if (alerteCartes) warning(alerteCartes); }, [alerteCartes]); // eslint-disable-line react-hooks/exhaustive-deps

  const basculerPerte = (cle, perte) => setCartesPerte((avant) => (perte ? [...new Set([...avant, cle])] : avant.filter((c) => c !== cle)));

  const tarifDe = (ligne) => {
    if (!apercu) return null;
    const cleLigne = `${String(ligne.Nom).trim()} ${String(ligne.Prenoms).trim()}`.trim();
    return apercu.Lignes.find((x) => x.Libelle === cleLigne)?.Tarif || null;
  };

  // Complément des ajouts à une famille existante (incorporation) : enfants au-delà du forfait et cartes
  const complementsFamille = useMemo(() => lignes.filter((l) => l.IdAdherentBase).reduce((total, l) => {
    const o = offresParId[l.IdOffre];
    const ajoutes = (l.Ayants || []).filter((a) => String(a.Nom).trim() || String(a.Prenoms).trim()).length;
    // Cartes : le serveur retire les personnes déjà facturées (verifCartes.MontantAjouts, ajouté une seule fois ci-dessous)
    return total + (Number(l.EnfantsEnPlus) || 0) * (o?.EnfantSupplementaire || 0) + (carteAssurance && !verifCartes ? ajoutes * (reglages?.Carte || 0) : 0);
  }, carteAssurance ? (verifCartes?.MontantAjouts || 0) : 0), [lignes, offresParId, carteAssurance, reglages, verifCartes]);

  const totaux = useMemo(() => {
    if (lectureSeule && devisLu) return devisLu.Totaux;
    const t = apercu?.Totaux || {};
    return {
      Familles: t.Familles || 0, Cotisation: (t.Cotisation || 0) + complementsFamille, PartSante: (t.PartSante || 0) + complementsFamille, PartIA: t.PartIA || 0, PartAFA: t.PartAFA || 0,
      PrimeHt: t.PrimeHt || 0, Accessoires: t.Accessoires || 0, FraisCourtiers: (t.FraisCourtiers || 0) + complementsFamille, HonoraireCabinet: t.HonoraireCabinet || 0,
      HonoraireGestionnaire: t.HonoraireGestionnaire || 0, PartMCI: t.PartMCI || 0, SurprimeAffection: t.SurprimeAffection || 0, SurprimeAge: t.SurprimeAge || 0,
      MontantEnfants: t.MontantEnfants || 0, MontantCartes: t.MontantCartes || 0,
    };
  }, [apercu, lectureSeule, devisLu, complementsFamille]);

  // ------------------------------------------------------------------ actions
  // Case « Émettre » d'un produit lié. Décochée : le serveur retire sa part de chaque cotisation. Recochée sur un devis
  // enregistré sans ce produit : chaque ligne retrouve la part de son offre, ajoutée à sa cotisation imposée.
  const emettreProduit = (champ, definir) => (coche) => {
    definir(coche);
    if (!coche) return;
    setLignes((avant) => avant.map((l) => {
      if (!l.PartRetiree?.[champ]) return l;
      const part = Number(offres.find((o) => o.IdOffre === Number(l.IdOffre || idOffre))?.[champ]) || 0;
      return {
        ...l, [champ]: part, PartRetiree: { ...l.PartRetiree, [champ]: false },
        CotisationImposee: Number(l.CotisationImposee) > 0 ? Number(l.CotisationImposee) + part : l.CotisationImposee,
      };
    }));
  };

  const modifierLigne = (cle, changement) => setLignes((avant) => avant.map((l) => (l.cle === cle ? { ...l, ...changement } : l)));
  const retirerLigne = (cle) => setLignes((avant) => avant.filter((l) => l.cle !== cle));
  const ajouterLigne = () => setLignes((avant) => [...avant, ligneVide({ IdOffre: Number(idOffre) || null })]);

  const lireFichier = async (fichier) => {
    if (!fichier) return;
    setAnalyse(true);
    try {
      const r = await oreoleApi.analyserImport(fichier);
      if (!r.Groupes.length) { toastError("Aucune feuille d'adhérents reconnue dans ce fichier."); return; }
      const groupe = r.Groupes[0];
      if (r.Groupes.length > 1) {
        warning(incorporation
          ? `${r.Groupes.length} feuilles dans ce classeur : seule la première est reprise pour cette incorporation.`
          : `${r.Groupes.length} feuilles dans ce classeur : la première est reprise. Pour traiter toutes les entreprises, utilisez Renouveler par fichier.`);
      }
      setLignes(groupe.Lignes.map((l) => ligneVide(ligneDepuisImport(l))));
      const offreCourante = groupe.Lignes.find((l) => l.OffreExacte)?.IdOffre || groupe.Lignes[0]?.IdOffre;
      if (offreCourante && !idOffre) setIdOffre(offreCourante);
      success(`${groupe.Adherents} adhérents lus${groupe.Anomalies.length ? `, ${groupe.Anomalies.length} à corriger` : ''}. Rien n'est enregistré.`);
    } catch (err) {
      toastError(`Fichier non lu : ${messageErreurApi(err)}`);
    } finally {
      setAnalyse(false);
      if (fichierRef.current) fichierRef.current.value = '';
    }
  };

  const telechargerModele = async () => {
    try {
      const blob = await oreoleApi.modele();
      const lien = document.createElement('a');
      lien.href = URL.createObjectURL(blob);
      lien.download = 'modele_effectif_oreole_sante.xlsx';
      lien.click();
      URL.revokeObjectURL(lien.href);
    } catch (err) {
      toastError(`Modèle non téléchargé : ${messageErreurApi(err)}`);
    }
  };

  const controle = (cible_) => {
    if (cible_ > 1) {
      if (!souscripteur?.IdClient) return 'Choisissez le souscripteur.';
      if (!dateEffet) return "Saisissez la date d'effet.";
      if (incorporation && base && (dateEffet < base.PeriodeEffet || dateEffet > base.PeriodeExpiration)) {
        return `La date d'incorporation doit être comprise entre le ${dateFr(base.PeriodeEffet)} et le ${dateFr(base.PeriodeExpiration)}.`;
      }
    }
    if (cible_ > 2 && !incorporation && !idOffre) return 'Choisissez une offre.';
    if (cible_ > 3) {
      if (!lignesServeur.length) return particulier ? "Renseignez l'assuré principal." : 'Ajoutez au moins un adhérent.';
      if (lignesEnErreur.length) {
        const l = lignesEnErreur[0];
        return `${String(`${l.Nom} ${l.Prenoms}`).trim() || 'Une ligne'} : ${erreursLigne(l, dateEffet).join(', ')}.`;
      }
    }
    return '';
  };
  const allerA = (num) => {
    const message = controle(num);
    if (message) { toastError(message); return; }
    setEtape(num);
  };

  const enregistrerDevis = async () => {
    const message = controle(4);
    if (message) { toastError(message); return null; }
    setEnregistrement(true);
    try {
      const reponse = await oreoleApi.enregistrer({
        ...charge, IdClient: souscripteur.IdClient, IdDevis: incorporation ? 0 : (package_?.IdDevis || 0), Acte: acte, IdContratBase: idContratBase || devisLu?.IdContratBase || 0,
      });
      setPackage(reponse);
      success(`Devis ${reponse.NumeroDevis} enregistré : ${fcfa(reponse.Totaux.Cotisation)} F, ${reponse.Adherents.length} famille${reponse.Adherents.length > 1 ? 's' : ''}.`);
      (reponse.Avertissements || []).slice(0, 3).forEach((a) => warning(a));
      return reponse;
    } catch (err) {
      toastError(`Devis non enregistré : ${messageErreurApi(err)}`);
      return null;
    } finally {
      setEnregistrement(false);
    }
  };

  const emettre = async () => {
    const enregistre = package_?.Confirme ? package_ : await enregistrerDevis();
    if (!enregistre) return;
    setEmission(0);
    try {
      const resultat = await oreoleApi.emettre(enregistre.IdDevis);
      const etapesEmises = 1 + (resultat.Produits.IA ? 1 : 0) + (resultat.Produits.AFA ? 1 : 0);
      for (let i = 1; i <= etapesEmises; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 380); });
        setEmission(i);
      }
      setPackage(resultat);
      setDevisLu(resultat);
      success(`Polices émises : ${resultat.Emis.join(', ') || 'déjà émises'}.`);
    } catch (err) {
      setEmission(-1);
      toastError(`Aucune police émise : ${messageErreurApi(err)}`);
    }
  };

  const ajouterALaFamille = () => {
    const a = (base?.Adherents || []).find((x) => String(x.IdAdherent) === String(ajoutFamille));
    if (!a) return;
    if (lignes.some((l) => l.IdAdherentBase === a.IdAdherent)) { toastError('Cette famille est déjà dans la liste.'); return; }
    const nouvelle = ligneVide({
      Nom: a.Nom, Prenoms: a.Prenoms, DateNaissance: String(a.DateNaissance || '').slice(0, 10), Matricule: a.Matricule, IdOffre: a.IdOffre, IdAdherentBase: a.IdAdherent, IdClient: a.IdClient || 0,
      Ayants: [ayantVide('E')],
    });
    setLignes((avant) => [...avant, nouvelle]);
    setDetail(nouvelle.cle);
    setAjoutFamille('');
  };

  // ------------------------------------------------------------------ affichage
  if (chargement) {
    return (
      <div className="glass-panel" style={{ ...carte, maxWidth: 640, margin: '3rem auto', textAlign: 'center' }}>
        <Loader2 size={28} className="spin" style={{ color: COULEUR }} />
        <p style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>Chargement d'Oreole Santé…</p>
      </div>
    );
  }
  if (!offres.length) {
    return (
      <div className="glass-panel" style={{ ...carte, maxWidth: 640, margin: '3rem auto' }}>
        <h2 style={titreCarte}><AlertTriangle size={18} color="var(--accent-amber)" /> Offres indisponibles</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Aucune offre Oreole Santé n'est active. Vérifiez la migration production 0205 et les Réglages par branche.</p>
      </div>
    );
  }
  const ligneOuverte = lignes.find((l) => l.cle === detail) || null;
  const titre = incorporation ? 'Incorporation Oreole Santé' : renouvellement ? 'Renouvellement Oreole Santé' : idEdition ? `Devis Oreole Santé ${devisLu?.NumeroDevis || ''}` : 'Nouvelle souscription Oreole Santé';
  const emis = Boolean(package_?.Produits?.Sante?.IdContrat) && emission !== 0;
  const pasEtape = (num) => etapes[etapes.findIndex((e) => e.num === num) + 1]?.num;
  const etapePrecedente = etapes[etapes.findIndex((e) => e.num === etape) - 1]?.num;
  const pied = (suivant) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.25rem' }}>
      <button type="button" className="btn btn-secondary" disabled={!etapePrecedente} onClick={() => setEtape(etapePrecedente)}>Précédent</button>
      {suivant && <button type="button" className="btn btn-primary" onClick={() => allerA(suivant)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>Continuer <ChevronRight size={15} /></button>}
    </div>
  );

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      <header>
        <button type="button" className="btn btn-link" onClick={() => navigate('/user/quotes/oreole-sante')} style={{ fontWeight: 600, padding: 0, marginBottom: '0.4rem' }}>← Oreole Santé</button>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}><HeartPulse size={26} color={COULEUR} /> {titre}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: 820, lineHeight: 1.55 }}>
          {incorporation
            ? `Police ${base?.NumeroPolice || ''} : la prime complémentaire est due en entier, sans prorata. L'échéance reste celle du contrat.`
            : "Une saisie pour trois polices liées : Santé, Individuelle Accidents et Assistance funéraire. Cotisation forfaitaire par famille, sans prorata."}
        </p>
        {renouvellement && base && <p style={{ ...noteInfo(), marginTop: '0.5rem', maxWidth: 820 }}>Renouvellement de la police {base.NumeroPolice} : les polices gardent leur numéro à la confirmation.</p>}
        {lectureSeule && <p style={{ ...noteInfo('var(--accent-amber)'), marginTop: '0.5rem', maxWidth: 820 }}>Devis déjà émis : affiché en lecture seule.</p>}
      </header>

      <EtapesDevis etapes={etapes} etape={etape} onAller={allerA} couleur={COULEUR} />

      <div style={{ display: 'flex', gap: '1.1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '999 1 620px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          {etape === 1 && (
            <section className="glass-panel" style={carte}>
              <h2 style={titreCarte}>{particulier ? <User size={18} color={COULEUR} /> : <Building2 size={18} color={COULEUR} />} {incorporation ? 'La police et la date' : 'Qui souscrit ?'}</h2>
              {!incorporation && !renouvellement && !idEdition && (
                <div role="group" aria-label="Type de souscripteur" style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 9, border: '1px solid var(--border-medium)', background: 'var(--bg-surface-elevated)', marginBottom: '1rem' }}>
                  {[['P', 'Une famille', User], ['E', 'Un groupe', Users]].map(([code, libelle, Icone]) => (
                    <button key={code} type="button" onClick={() => { setCible(code); setIdOffre(null); setPrixFamille(''); setLignes([]); setFamille({ conjoint: false, enfants: 0 }); }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.9rem', borderRadius: 7, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: '0.84rem',
                        background: cible === code ? 'var(--bg-surface)' : 'transparent', color: cible === code ? 'var(--text-primary)' : 'var(--text-secondary)', boxShadow: cible === code ? 'var(--shadow-sm)' : 'none' }}>
                      <Icone size={14} /> {libelle}
                    </button>
                  ))}
                </div>
              )}
              <div style={grille}>
                <div style={{ gridColumn: '1 / -1' }}>
                  {incorporation || renouvellement || idEdition ? (
                    <Champ label="Souscripteur"><div className="form-control" aria-readonly="true">{souscripteur?.Nom}</div></Champ>
                  ) : (
                    <>
                      <RechercheClient label={particulier ? 'Assuré principal (client)' : 'Entreprise (client)'} personne={souscripteur} onChoisir={setSouscripteur} onNouveau={() => setNouveauClient(true)} />
                      {souscripteur && <div style={{ marginTop: '0.7rem' }}><FichePersonne personne={souscripteur} /></div>}
                    </>
                  )}
                </div>
                <Champ label={incorporation ? "Date d'incorporation" : "Date d'effet"} requis aide={incorporation ? 'Au choix dans la période du contrat.' : undefined}>
                  <input type="date" className="form-control" value={dateEffet} disabled={lectureSeule} onChange={(e) => changerEffet(e.target.value)} />
                </Champ>
                <Champ label="Échéance" aide={incorporation ? 'Figée sur la fin du contrat.' : "Un an après la date d'effet, modifiable."}>
                  <input type="date" className="form-control" value={dateExpiration} min={dateEffet || undefined} disabled={lectureSeule || incorporation} onChange={(e) => setDateExpiration(e.target.value)} />
                </Champ>
                {!incorporation && (
                  <Champ label="N° de police compagnie">
                    <input type="text" className="form-control" maxLength={50} value={policeCompagnie} disabled={lectureSeule} onChange={(e) => setPoliceCompagnie(e.target.value)} placeholder="Facultatif" />
                  </Champ>
                )}
                <Champ label="Gestionnaire et compagnie Santé"><div className="form-control" aria-readonly="true">{reglages?.Gestionnaire}</div></Champ>
              </div>
              {pied(pasEtape(1))}
            </section>
          )}

          {etape === 2 && (
            <section className="glass-panel" style={carte}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                <div>
                  <h2 style={{ ...titreCarte, margin: 0 }}><Rows3 size={18} color={COULEUR} /> Quelle cotisation ?</h2>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>Toujours pour l'assuré principal, le conjoint et 4 enfants.</p>
                </div>
                <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start', fontSize: '0.8rem' }} onClick={() => setComparer((c) => !c)}>{comparer ? 'Masquer' : 'Comparer'} les barèmes</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 210px), 1fr))', gap: '0.7rem' }}>
                {offresCible.map((o) => <CarteOffre key={o.IdOffre} offre={o} choisie={Number(idOffre) === o.IdOffre} onChoisir={() => { if (!lectureSeule) { setIdOffre(o.IdOffre); setPrixFamille(''); } }} />)}
              </div>
              {comparer && (
                <div className="tableau-defilant" style={{ overflowX: 'auto', marginTop: '0.9rem', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
                  <table className="data-table" style={{ minWidth: 640, fontSize: '0.8rem' }}>
                    <thead><tr><th>Garantie, en F CFA</th>{offresCible.map((o) => <th key={o.IdOffre} style={{ textAlign: 'right', color: Number(idOffre) === o.IdOffre ? COULEUR : undefined }}>{fcfa(o.Cotisation)}</th>)}</tr></thead>
                    <tbody>{LIGNES_BAREME.map(([l, f]) => <tr key={l}><td>{l}</td>{offresCible.map((o) => <td key={o.IdOffre} style={{ textAlign: 'right', fontWeight: Number(idOffre) === o.IdOffre ? 700 : 400 }}>{f(o)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
              {!particulier && (
                <div style={{ ...grille, marginTop: '1rem' }}>
                  <Champ label="Cotisation négociée par famille" aide={`Vide : ${offre ? fcfa(offre.Cotisation) : 'prix de l\'offre'} F. La majoration va au chargement pour sinistres à payer, la part de MCI ne change pas.`}>
                    <AmountInput value={prixFamille} disabled={lectureSeule} onChange={(v) => setPrixFamille(v)} placeholder={offre ? fcfa(offre.Cotisation) : ''} />
                  </Champ>
                </div>
              )}
              {pied(pasEtape(2))}
            </section>
          )}

          {etape === 3 && particulier && !incorporation && (
            <section className="glass-panel" style={carte}>
              <h2 style={titreCarte}><Users size={18} color={COULEUR} /> La famille</h2>
              <div style={grille}>
                {lignes[0] && (
                  <>
                    <Champ label="Assuré principal" requis><input className="form-control" value={lignes[0].Nom} disabled={lectureSeule} onChange={(e) => modifierLigne(lignes[0].cle, { Nom: e.target.value })} /></Champ>
                    <Champ label="Prénoms"><input className="form-control" value={lignes[0].Prenoms} disabled={lectureSeule} onChange={(e) => modifierLigne(lignes[0].cle, { Prenoms: e.target.value })} /></Champ>
                    <Champ label="Date de naissance" requis aide={ageAu(lignes[0].DateNaissance, dateEffet) !== null ? `${ageAu(lignes[0].DateNaissance, dateEffet)} ans à la date d'effet.` : undefined}>
                      <input type="date" className="form-control" value={lignes[0].DateNaissance || ''} disabled={lectureSeule} onChange={(e) => modifierLigne(lignes[0].cle, { DateNaissance: e.target.value })} />
                    </Champ>
                    <Champ label="Affections déclarées" aide={`${reglages?.SurprimeAffection} % de la cotisation par affection.`}>
                      <select className="form-control" value={lignes[0].Affections} disabled={lectureSeule} onChange={(e) => modifierLigne(lignes[0].cle, { Affections: Number(e.target.value) })}>
                        {Array.from({ length: (reglages?.AffectionsMax || 3) + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </Champ>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.2rem', alignItems: 'center', margin: '1.1rem 0 0.8rem' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.86rem' }}>
                  <input type="checkbox" checked={famille.conjoint} disabled={lectureSeule} onChange={(e) => setFamille((f) => ({ ...f, conjoint: e.target.checked }))} /> Conjoint couvert
                </label>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.86rem' }}>
                  Enfants
                  <button type="button" className="btn btn-secondary" aria-label="Retirer un enfant" disabled={lectureSeule || famille.enfants === 0} style={{ padding: '0.25rem 0.45rem' }} onClick={() => setFamille((f) => ({ ...f, enfants: Math.max(0, f.enfants - 1) }))}><Minus size={14} /></button>
                  <b style={{ minWidth: 20, textAlign: 'center' }}>{famille.enfants}</b>
                  <button type="button" className="btn btn-secondary" aria-label="Ajouter un enfant" disabled={lectureSeule} style={{ padding: '0.25rem 0.45rem' }} onClick={() => setFamille((f) => ({ ...f, enfants: f.enfants + 1 }))}><Plus size={14} /></button>
                </span>
              </div>
              {famille.enfants > ENFANTS_FORFAIT && offre && (
                <p style={{ ...noteInfo('var(--accent-amber)'), marginBottom: '0.8rem' }}>
                  {famille.enfants - ENFANTS_FORFAIT} enfant{famille.enfants - ENFANTS_FORFAIT > 1 ? 's' : ''} en plus : {fcfa((famille.enfants - ENFANTS_FORFAIT) * offre.EnfantSupplementaire)} F ajoutés à la cotisation.
                </p>
              )}
              {lignes[0] && lignes[0].Ayants.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Noms facultatifs : le forfait couvre la famille, ils peuvent être complétés plus tard.</span>
                  {lignes[0].Ayants.map((a, i) => (
                    <div key={a.cle} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 90px) repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{a.Lien === 'C' ? 'Conjoint' : `Enfant ${lignes[0].Ayants.slice(0, i).filter((x) => x.Lien === 'E').length + 1}`}</span>
                      {[['Nom', 'Nom'], ['Prenoms', 'Prénoms']].map(([c, l]) => (
                        <input key={c} className="form-control" placeholder={l} aria-label={`${l} : ${a.Lien === 'C' ? 'conjoint' : `enfant ${i + 1}`}`} value={a[c] || ''} disabled={lectureSeule}
                          onChange={(e) => modifierLigne(lignes[0].cle, { Ayants: lignes[0].Ayants.map((x) => (x.cle === a.cle ? { ...x, [c]: e.target.value } : x)) })} />
                      ))}
                      <input type="date" className="form-control" aria-label="Date de naissance" value={a.DateNaissance || ''} disabled={lectureSeule}
                        onChange={(e) => modifierLigne(lignes[0].cle, { Ayants: lignes[0].Ayants.map((x) => (x.cle === a.cle ? { ...x, DateNaissance: e.target.value } : x)) })} />
                    </div>
                  ))}
                </div>
              )}
              {pied(pasEtape(3))}
            </section>
          )}

          {etape === 3 && (!particulier || incorporation) && (
            <section className="glass-panel" style={carte}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                <h2 style={{ ...titreCarte, margin: 0 }}><Users size={18} color={COULEUR} /> {incorporation ? 'Personnes à incorporer' : 'Les adhérents'} · {lignesServeur.length}</h2>
                {!lectureSeule && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                    <button type="button" className="btn btn-secondary" onClick={ajouterLigne} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem' }}><Plus size={14} /> {incorporation ? 'Nouvel adhérent' : 'Ajouter'}</button>
                    {!particulier && (
                      <>
                        <input ref={fichierRef} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => lireFichier(e.target.files?.[0])} />
                        <button type="button" className="btn btn-primary" disabled={analyse} onClick={() => fichierRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem' }}>
                          {analyse ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} Importer la liste
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={telechargerModele} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem' }}><Download size={14} /> Modèle</button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {incorporation && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.9rem' }}>
                  <Champ label="Ajouter à une famille existante" aide="Dans le forfait, le conjoint et les enfants sont sans supplément jusqu'à 4 enfants.">
                    <select className="form-control" value={ajoutFamille} onChange={(e) => setAjoutFamille(e.target.value)} style={{ minWidth: 260 }}>
                      <option value="">Choisir une famille</option>
                      {(base?.Adherents || []).map((a) => <option key={a.IdAdherent} value={a.IdAdherent}>{`${a.Nom} ${a.Prenoms}`.trim()}</option>)}
                    </select>
                  </Champ>
                  <button type="button" className="btn btn-secondary" disabled={!ajoutFamille} onClick={ajouterALaFamille}>Ajouter</button>
                </div>
              )}
              <div className="tableau-defilant" style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
                <table className="data-table compacte" style={{ minWidth: 720 }}>
                  <thead><tr><th>Matricule</th><th>Nom</th><th>Prénoms</th><th>Naissance</th><th>Offre</th><th style={{ textAlign: 'center' }} title="Affections déclarées">Aff.</th><th style={{ textAlign: 'right' }}>Cotisation</th><th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {lignes.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign: 'center', padding: '1.6rem', color: 'var(--text-muted)' }}>
                        {incorporation ? (particulier
                          ? 'Ajoutez manuellement un nouvel assuré ou complétez une famille.'
                          : 'Ajoutez un nouvel assuré ou importez le fichier Excel configuré. Chaque ligne importée crée une nouvelle famille.')
                          : 'Ajoutez un adhérent ou importez la liste Excel.'}
                      </td></tr>
                    )}
                    {lignes.map((l) => {
                      const erreurs = erreursLigne(l, dateEffet);
                      const age = ageAu(l.DateNaissance, dateEffet);
                      const tarif = tarifDe(l);
                      const ajout = Boolean(l.IdAdherentBase);
                      return (
                        <React.Fragment key={l.cle}>
                          <tr>
                            <td><input className="form-control" style={{ width: 74, padding: '0.25rem 0.35rem', fontSize: '0.78rem' }} aria-label="Matricule" value={l.Matricule || ''} disabled={lectureSeule || ajout} onChange={(e) => modifierLigne(l.cle, { Matricule: e.target.value })} /></td>
                            <td><input className="form-control" style={{ minWidth: 72, padding: '0.25rem 0.35rem', fontSize: '0.78rem' }} aria-label="Nom" value={l.Nom || ''} disabled={lectureSeule || ajout} onChange={(e) => modifierLigne(l.cle, { Nom: e.target.value })} /></td>
                            <td><input className="form-control" style={{ minWidth: 88, padding: '0.25rem 0.35rem', fontSize: '0.78rem' }} aria-label="Prénoms" value={l.Prenoms || ''} disabled={lectureSeule || ajout} onChange={(e) => modifierLigne(l.cle, { Prenoms: e.target.value })} /></td>
                            <td>
                              <input type="date" className="form-control" style={{ width: 122, padding: '0.25rem 0.3rem', fontSize: '0.78rem', borderColor: !l.DateNaissance ? 'var(--accent-rose)' : undefined }} aria-label="Date de naissance"
                                value={l.DateNaissance ? String(l.DateNaissance).slice(0, 10) : ''} disabled={lectureSeule || ajout} onChange={(e) => modifierLigne(l.cle, { DateNaissance: e.target.value })} />
                              {age !== null && age >= (reglages?.Age1Debut || 60) && <div style={{ fontSize: '0.7rem', color: 'var(--accent-amber)', marginTop: 2 }}>{age} ans</div>}
                            </td>
                            <td>
                              <select className="form-control" style={{ padding: '0.25rem 0.3rem', fontSize: '0.78rem', minWidth: 96 }} aria-label="Offre" value={l.IdOffre || ''} disabled={lectureSeule || ajout} onChange={(e) => modifierLigne(l.cle, { IdOffre: Number(e.target.value), PartIA: undefined, PartAFA: undefined, PartFichier: false, CotisationImposee: 0 })}>
                                <option value="">Choisir</option>
                                {offres.filter((o) => o.Cible === cible || o.IdOffre === l.IdOffre).map((o) => <option key={o.IdOffre} value={o.IdOffre}>{libelleOffre(o)}</option>)}
                              </select>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {ajout ? '-' : (
                                <select className="form-control" style={{ padding: '0.25rem', width: 46, fontSize: '0.78rem', margin: '0 auto' }} aria-label="Affections" value={l.Affections || 0} disabled={lectureSeule} onChange={(e) => modifierLigne(l.cle, { Affections: Number(e.target.value) })}>
                                  {Array.from({ length: (reglages?.AffectionsMax || 3) + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                                </select>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {ajout ? <span title="Enfants au-delà du forfait et cartes">{fcfa((Number(l.EnfantsEnPlus) || 0) * (offresParId[l.IdOffre]?.EnfantSupplementaire || 0))}</span> : tarif ? fcfa(tarif.Cotisation) : '-'}
                              {tarif && tarif.Ecart !== 0 && !ajout && <div style={{ fontSize: '0.7rem', fontWeight: 600, color: tarif.Ecart > 0 ? 'var(--accent-amber)' : 'var(--accent-emerald)' }}>{tarif.Ecart > 0 ? '+' : ''}{fcfa(tarif.Ecart)}</div>}
                            </td>
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                              <button type="button" className="btn btn-secondary" title="Surprimes, famille et bénéficiaires" aria-label={`Détails : ${String(`${l.Nom} ${l.Prenoms}`).trim() || 'adhérent'}`} style={{ padding: '0.25rem 0.35rem' }} onClick={() => setDetail(l.cle)}><SlidersHorizontal size={14} /></button>
                              {!lectureSeule && <button type="button" className="btn btn-ghost" aria-label="Retirer cette ligne" style={{ padding: '0.2rem 0.35rem', marginLeft: 3 }} onClick={() => retirerLigne(l.cle)}><Trash2 size={14} /></button>}
                            </td>
                          </tr>
                          {(erreurs.length > 0 || (l.Anomalies || []).length > 0) && (
                            <tr><td colSpan={8} style={{ background: 'color-mix(in srgb, var(--accent-rose) 7%, transparent)', fontSize: '0.76rem', color: 'var(--accent-rose)', padding: '0.25rem 0.7rem' }}>
                              <AlertTriangle size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                              {[...(l.LigneFichier ? [`ligne ${l.LigneFichier} du fichier`] : []), ...(l.Anomalies || []), ...erreurs].join(' · ')}
                            </td></tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {apercuErreur && <p role="alert" style={{ ...noteInfo('var(--accent-rose)'), marginTop: '0.75rem' }}>{apercuErreur}</p>}
              {(apercu?.Avertissements || []).length > 0 && <p style={{ ...noteInfo('var(--accent-amber)'), marginTop: '0.75rem' }}>{apercu.Avertissements.slice(0, 4).join(' ; ')}</p>}
              {pied(pasEtape(3))}
            </section>
          )}

          {etape === 4 && (
            <>
              <section className="glass-panel" style={carte}>
                <h2 style={titreCarte}><BadgeCheck size={18} color={COULEUR} /> Trois polices, une validation</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: '0.7rem' }}>
                  {[
                    ['Sante', totaux.PartSante, reglages?.Gestionnaire, null, null, 'Police mère'],
                    ['IA', totaux.PartIA, 'NSIA ASSURANCES', avecIA, emettreProduit('PartIA', setAvecIA), offre?.CapitalIA ? `Capital ${fcfa(offre.CapitalIA)} par assuré principal` : ''],
                    ['AFA', totaux.PartAFA, 'ALLIANZ CI VIE', avecAFA, emettreProduit('PartAFA', setAvecAFA), offre?.CapitalAFA ? `Capital ${fcfa(offre.CapitalAFA)} par assuré principal` : ''],
                  ].map(([cle, montant, compagnie, active, activer, detailProduit]) => {
                    const p = PRODUITS[cle];
                    const Icone = p.icone;
                    const etat = package_?.Produits?.[cle];
                    return (
                      <div key={cle} style={{ padding: '0.85rem', borderRadius: 12, border: '1px solid var(--border-medium)', borderTop: `3px solid ${p.couleur}`, display: 'flex', flexDirection: 'column', gap: '0.25rem', opacity: active === false ? 0.55 : 1, transition: 'opacity 0.2s' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                          <b style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.88rem' }}><Icone size={15} color={p.couleur} /> {p.long}</b>
                          {activer && !lectureSeule && (
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                              <input type="checkbox" checked={active} onChange={(e) => activer(e.target.checked)} /> Émettre
                            </label>
                          )}
                        </div>
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{compagnie}</span>
                        <span style={{ fontSize: '1.15rem', fontWeight: 800 }}>{fcfa(montant)} F</span>
                        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{etat?.NumeroPolice ? `Police ${etat.NumeroPolice}` : etat?.NumeroDevis ? `Devis ${etat.NumeroDevis}` : detailProduit}</span>
                      </div>
                    );
                  })}
                </div>
                {incorporation && (
                  <p style={{ margin: '0.65rem 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    Le choix IA/AFA s’applique aux nouveaux assurés principaux incorporés, pas aux ajouts à une famille existante.
                  </p>
                )}

                {emission >= 0 && !emis && (
                  <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '1rem' }}>
                    {['Police Santé', 'Individuelle Accidents', 'Assistance funéraire'].map((t, i) => (
                      <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.65rem', borderRadius: 8, background: 'var(--bg-surface-elevated)', fontSize: '0.84rem', color: emission > i ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {emission > i ? <CheckCircle2 size={15} color="var(--accent-emerald)" /> : <Loader2 size={15} className={emission === i ? 'spin' : ''} />} {t}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1.1rem' }}>
                  {!lectureSeule && !emis && (
                    <>
                      <button type="button" className="btn btn-secondary" disabled={enregistrement || emission === 0} onClick={enregistrerDevis} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        {enregistrement ? <Loader2 size={15} className="spin" /> : <FileText size={15} />} Enregistrer les devis
                      </button>
                      <button type="button" className="btn btn-primary" disabled={enregistrement || emission === 0} onClick={emettre} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <BadgeCheck size={15} /> Confirmer et émettre
                      </button>
                    </>
                  )}
                  {package_?.Produits?.Sante?.IdContrat && (
                    <button type="button" className="btn btn-primary" onClick={() => navigate(`/user/contracts/${package_.Produits.Sante.IdContrat}`)}>Ouvrir le contrat</button>
                  )}
                </div>
                {package_?.Avertissements?.length > 0 && <p style={{ ...noteInfo('var(--accent-amber)'), marginTop: '0.8rem' }}>{package_.Avertissements.slice(0, 4).join(' ; ')}</p>}
              </section>

              {package_?.IdDevis && (
                <section className="glass-panel" style={carte}>
                  <h2 style={titreCarte}><FileText size={18} color={COULEUR} /> Documents</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))', gap: '0.45rem' }}>
                    {[['cp', 'Conditions particulières'], ['bareme', 'Barème de soins'], ['liste', 'Liste des adhérents'], ['facture', 'Facture du package'], ['cotisations', 'État des cotisations']].map(([type, libelle]) => (
                      <button key={type} type="button" className="btn btn-secondary" style={{ justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }} onClick={() => imprimerOreole(type, package_.IdDevis)}>
                        <FileText size={14} /> {libelle}
                      </button>
                    ))}
                    {offre && RESEAUX[offre.Reseau] && <a className="btn btn-secondary" style={{ justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }} href={RESEAUX[offre.Reseau].fichier} target="_blank" rel="noreferrer"><FileText size={14} /> {RESEAUX[offre.Reseau].libelle}</a>}
                    <a className="btn btn-secondary" style={{ justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }} href={RESEAU_PHARMACIES.fichier} target="_blank" rel="noreferrer"><FileText size={14} /> {RESEAU_PHARMACIES.libelle}</a>
                  </div>
                </section>
              )}

              <section className="glass-panel" style={carte}>
                <h2 style={titreCarte}><Wallet size={18} color={COULEUR} /> Options et décomposition</h2>
                <div style={grille}>
                  <div>
                    {[
                      ['Prime HT, reversée à MCI', totaux.PrimeHt], ...(totaux.Accessoires ? [['Accessoires, reversés à MCI', totaux.Accessoires]] : []), ['Chargement pour sinistres à payer', totaux.FraisCourtiers],
                      ['Part Santé', totaux.PartSante], [`Honoraires OREOLE ${reglages?.HonoraireCabinet} %`, totaux.HonoraireCabinet], [`Honoraires MCI ${reglages?.HonoraireGestionnaire} %`, totaux.HonoraireGestionnaire],
                    ].map(([l, v]) => <div key={l} style={ligneDetail}><span style={{ color: 'var(--text-muted)' }}>{l}</span><b>{fcfa(v)} F</b></div>)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.84rem' }}>
                      <input type="checkbox" checked={carteAssurance} disabled={lectureSeule} onChange={(e) => setCarteAssurance(e.target.checked)} style={{ marginTop: 3 }} />
                      <span>Facturer la carte d'assurance : {fcfa(reglages?.Carte)} F par personne{verifCartes ? `, soit ${fcfa(verifCartes.MontantTotal)} F pour ${verifCartes.AFacturer} personne${verifCartes.AFacturer > 1 ? 's' : ''}` : (totaux.MontantCartes ? `, soit ${fcfa(totaux.MontantCartes)} F` : '')}</span>
                    </label>
                    {verifCartes && (verifCartes.DejaFacturees.length > 0 || verifCartes.Pertes.length > 0) && (
                      <div style={{ ...noteInfo('var(--accent-amber)'), display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
                        {verifCartes.Alerte && <div role="alert" style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', fontWeight: 600 }}><AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{verifCartes.Alerte}</span></div>}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: 240, overflow: 'auto' }}>
                          {[...verifCartes.DejaFacturees, ...verifCartes.Pertes].map((p) => (
                            <div key={p.Cle} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(150px, auto)', gap: '0.5rem', alignItems: 'center' }}>
                              <div>
                                <b>{p.Personne}</b>
                                {p.Derniere && <div style={{ color: 'var(--text-secondary)', fontSize: '0.74rem' }}>Facturée le {dateFr(p.Derniere.Date)}, {fcfa(p.Derniere.Montant)} F{p.Derniere.Utilisateur ? `, par ${p.Derniere.Utilisateur}` : ''}{p.Derniere.NumeroPolice ? `, police ${p.Derniere.NumeroPolice}` : ''}</div>}
                              </div>
                              <select className="form-control" aria-label={`Carte de ${p.Personne}`} disabled={lectureSeule} style={{ padding: '0.25rem 0.4rem', fontSize: '0.78rem' }} value={p.Etat === 'PERTE' ? 'PERTE' : 'NON'} onChange={(e) => basculerPerte(p.Cle, e.target.value === 'PERTE')}>
                                <option value="NON">Ne pas refacturer</option>
                                <option value="PERTE">Renouvellement pour perte</option>
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <Champ label="Apporteur" aide={apporteurs.length ? undefined : "Aucun apporteur enregistré : Administration, Apporteurs d'affaires."}>
                      <select className="form-control" value={idApporteur} disabled={lectureSeule} onChange={(e) => setIdApporteur(e.target.value)}>
                        <option value="">Sans apporteur</option>
                        {apporteurs.map((a) => <option key={a.IdApporteur} value={a.IdApporteur}>{a.Nom}</option>)}
                      </select>
                    </Champ>
                    {idApporteur && (
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.84rem' }}>
                        <input type="checkbox" checked={apporteurConvention} disabled={lectureSeule} style={{ marginTop: 3 }}
                          onChange={(e) => { setApporteurConvention(e.target.checked); if (!e.target.checked) setApporteurValeur(0); }} />
                        <span>Une convention prévoit de rémunérer cet apporteur. Sans convention, aucun paiement.</span>
                      </label>
                    )}
                    {idApporteur && apporteurConvention && (
                      <div style={grille}>
                        <Champ label="Mode de rémunération">
                          <select className="form-control" value={apporteurMode} disabled={lectureSeule} onChange={(e) => setApporteurMode(e.target.value)}>
                            <option value="FAMILLE">Montant par assuré</option>
                            <option value="TAUX">Taux sur la prime HT</option>
                          </select>
                        </Champ>
                        <Champ label={apporteurMode === 'FAMILLE' ? 'Montant par assuré, en F' : 'Taux en %'} aide={apercu?.Apporteur ? `Soit ${fcfa(apercu.Apporteur)} F sur ce contrat${apporteurMode === 'FAMILLE' ? ', un assuré et ses ayants droit comptant pour un' : ''}.` : undefined}>
                          <input type="number" min="0" className="form-control" value={apporteurValeur} disabled={lectureSeule} onChange={(e) => setApporteurValeur(e.target.value)} />
                        </Champ>
                      </div>
                    )}
                  </div>
                </div>
                {pied(null)}
              </section>
            </>
          )}
        </div>

        <ResumeDevis titre="Votre package" icone={HeartPulse} couleur={COULEUR} libelleMontant={incorporation ? 'Prime complémentaire' : 'Cotisation'} montant={`${fcfa(totaux.Cotisation)} F`}
          detail={incorporation ? 'Due en entier, sans prorata' : 'Forfait annuel, sans prorata ni ristourne'}
          lignes={[
            ['Souscripteur', souscripteur?.Nom],
            !incorporation && ['Offre', offre ? `${fcfa(prixFamille || offre.Cotisation)} F` : null],
            ['Période', dateEffet ? `${dateFr(dateEffet)} au ${dateFr(dateExpiration)}` : null],
            [particulier ? 'Personnes' : 'Familles', particulier ? (lignes[0]?.Personnes || 1) : lignesServeur.length],
          ]}>
          {totaux.Cotisation > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.8rem' }}>
              <BarreRepartition sante={totaux.PartSante} ia={totaux.PartIA} afa={totaux.PartAFA} />
              <LegendeRepartition sante={totaux.PartSante} ia={totaux.PartIA} afa={totaux.PartAFA} />
            </div>
          )}
          {apercuErreur && etape !== 3 && <p role="alert" style={{ ...noteInfo('var(--accent-rose)'), marginTop: '0.7rem', fontSize: '0.76rem' }}>{apercuErreur}</p>}
        </ResumeDevis>
      </div>

      <QuickAddClientModal
        isOpen={nouveauClient}
        onClose={() => setNouveauClient(false)}
        onClientCreated={(client) => {
          const personne = personneDepuisClient(client);
          if (personne?.IdClient) setSouscripteur(personne);
          setNouveauClient(false);
        }}
      />

      <Modal isOpen={Boolean(ligneOuverte)} onClose={() => setDetail(null)} title={ligneOuverte ? (`${ligneOuverte.Nom} ${ligneOuverte.Prenoms}`.trim() || 'Adhérent') : ''} subtitle="Surprimes, famille et bénéficiaires" maxWidth={680}>
        {ligneOuverte && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={grille}>
              {!ligneOuverte.IdAdherentBase && (
                <>
                  <Champ label="Surprime d'affection en %" aide={`Vide : ${reglages?.SurprimeAffection} % par affection, sur la cotisation totale.`}>
                    <input type="number" min="0" className="form-control" value={ligneOuverte.TauxAffection ?? ''} disabled={lectureSeule} onChange={(e) => modifierLigne(ligneOuverte.cle, { TauxAffection: e.target.value })} />
                  </Champ>
                  <Champ label="Surprime d'âge en %" aide={`Vide : ${reglages?.Age1Taux} % dès ${reglages?.Age1Debut} ans, ${reglages?.Age2Taux} % dès ${reglages?.Age2Debut} ans, sur la part Santé.`}>
                    <input type="number" min="0" className="form-control" value={ligneOuverte.TauxAge ?? ''} disabled={lectureSeule} onChange={(e) => modifierLigne(ligneOuverte.cle, { TauxAge: e.target.value })} />
                  </Champ>
                  <Champ label="Surprime imposée" aide="Remplace les surprimes calculées.">
                    <AmountInput value={ligneOuverte.SurprimeImposee || ''} disabled={lectureSeule} onChange={(v) => modifierLigne(ligneOuverte.cle, { SurprimeImposee: v })} />
                  </Champ>
                  <Champ label="Cotisation imposée" aide="Montant total du fichier ou de la convention : remplace tout le calcul.">
                    <AmountInput value={ligneOuverte.CotisationImposee || ''} disabled={lectureSeule} onChange={(v) => modifierLigne(ligneOuverte.cle, { CotisationImposee: v })} />
                  </Champ>
                </>
              )}
              <Champ label="Enfants en plus" aide={`Au-delà de 4 enfants : ${fcfa(offresParId[ligneOuverte.IdOffre]?.EnfantSupplementaire)} F par enfant.`}>
                <input type="number" min="0" className="form-control" value={ligneOuverte.EnfantsEnPlus || 0} disabled={lectureSeule} onChange={(e) => modifierLigne(ligneOuverte.cle, { EnfantsEnPlus: Number(e.target.value) || 0 })} />
              </Champ>
              <Champ label="Personnes de la famille" aide="Sert à facturer les cartes d'assurance.">
                <input type="number" min="0" className="form-control" value={ligneOuverte.Personnes || ''} disabled={lectureSeule} onChange={(e) => modifierLigne(ligneOuverte.cle, { Personnes: Number(e.target.value) || 0 })} />
              </Champ>
              {!ligneOuverte.IdAdherentBase && (
                <Champ label="Bénéficiaires IA et AFA" large>
                  <input className="form-control" maxLength={500} value={ligneOuverte.Beneficiaires || ''} disabled={lectureSeule} onChange={(e) => modifierLigne(ligneOuverte.cle, { Beneficiaires: e.target.value })} />
                </Champ>
              )}
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', marginBottom: '0.45rem' }}>
                <b style={{ fontSize: '0.86rem' }}>Conjoint et enfants · facultatif</b>
                {!lectureSeule && <button type="button" className="btn btn-secondary" style={{ fontSize: '0.76rem', padding: '0.2rem 0.55rem', display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }} onClick={() => modifierLigne(ligneOuverte.cle, { Ayants: [...(ligneOuverte.Ayants || []), ayantVide('E')] })}><Plus size={13} /> Ajouter</button>}
              </div>
              {(ligneOuverte.Ayants || []).length === 0 && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Aucun ayant droit saisi.</p>}
              {(ligneOuverte.Ayants || []).map((a) => (
                <div key={a.cle || `${a.Nom}${a.Prenoms}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 115px), 1fr)) 32px', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                  <select className="form-control" aria-label="Lien" value={a.Lien} disabled={lectureSeule} onChange={(e) => modifierLigne(ligneOuverte.cle, { Ayants: ligneOuverte.Ayants.map((x) => (x === a ? { ...x, Lien: e.target.value } : x)) })}>
                    {LIENS.map((x) => <option key={x.code} value={x.code}>{x.libelle}</option>)}
                  </select>
                  <input className="form-control" aria-label="Nom" placeholder="Nom" value={a.Nom || ''} disabled={lectureSeule} onChange={(e) => modifierLigne(ligneOuverte.cle, { Ayants: ligneOuverte.Ayants.map((x) => (x === a ? { ...x, Nom: e.target.value } : x)) })} />
                  <input className="form-control" aria-label="Prénoms" placeholder="Prénoms" value={a.Prenoms || ''} disabled={lectureSeule} onChange={(e) => modifierLigne(ligneOuverte.cle, { Ayants: ligneOuverte.Ayants.map((x) => (x === a ? { ...x, Prenoms: e.target.value } : x)) })} />
                  <input type="date" className="form-control" aria-label="Date de naissance" value={a.DateNaissance ? String(a.DateNaissance).slice(0, 10) : ''} disabled={lectureSeule} onChange={(e) => modifierLigne(ligneOuverte.cle, { Ayants: ligneOuverte.Ayants.map((x) => (x === a ? { ...x, DateNaissance: e.target.value } : x)) })} />
                  {!lectureSeule && <button type="button" className="btn btn-ghost" aria-label="Retirer" style={{ padding: '0.2rem' }} onClick={() => modifierLigne(ligneOuverte.cle, { Ayants: ligneOuverte.Ayants.filter((x) => x !== a) })}><X size={14} /></button>}
                </div>
              ))}
            </div>
            {tarifDe(ligneOuverte) && !ligneOuverte.IdAdherentBase && (
              <div>
                {[['Cotisation', tarifDe(ligneOuverte).Cotisation], ['Dont surprime d\'affection', tarifDe(ligneOuverte).SurprimeAffection], ['Dont surprime d\'âge', tarifDe(ligneOuverte).SurprimeAge], ['Dont enfants en plus', tarifDe(ligneOuverte).MontantEnfants], ['Part Santé', tarifDe(ligneOuverte).PartSante], ['Part IA', tarifDe(ligneOuverte).PartIA], ['Part AFA', tarifDe(ligneOuverte).PartAFA]]
                  .map(([l, v]) => <div key={l} style={ligneDetail}><span style={{ color: 'var(--text-muted)' }}>{l}</span><b>{fcfa(v)} F</b></div>)}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="btn btn-primary" onClick={() => setDetail(null)}>Fermer</button></div>
          </div>
        )}
      </Modal>
      {!particulier && etape === 3 && !incorporation && !lectureSeule && (
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <FileSpreadsheet size={14} /> Plusieurs entreprises dans un même classeur ? <button type="button" className="btn btn-link" style={{ padding: 0, fontSize: '0.78rem' }} onClick={() => navigate('/user/quotes/oreole-sante/fichier')}>Renouveler par fichier</button>
        </p>
      )}
    </div>
  );
}
