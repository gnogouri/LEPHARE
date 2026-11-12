import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { SqueletteTableau } from '../../../components/common/Squelette';
import { moduleActif, TITRE_MODULE_INACTIF } from '../../../utils/modulesActifs';
import { contractApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { exportToPdf } from '../../../utils/exportUtils';
import { useNombreAnime } from '../../../utils/useNombreAnime';
import {
  Activity, AlertCircle, ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, BellRing, Building2, Car, ChevronLeft,
  ChevronRight, Eye, FileCheck, HeartHandshake, HeartPulse, Home, Inbox, Layers, Plane, Plus, Printer, RefreshCw, Search, Shield,
  ShieldCheck, Ship, UserPlus, X,
} from 'lucide-react';

/* =========================================================================
   PORTEFEUILLE DES CONTRATS
   Liste paginée par le serveur (GET /api/contrat/) : recherche, branche, statut, périodes et tri sont
   appliqués en base, sur tous les contrats et non sur une page chargée ; compteurs des onglets en une
   requête (GET /api/contrat/synthese/). Statut de chaque contrat calculé par le serveur
   (ContratViewSet._statut_portefeuille). Sans recherche : contrats émis ces 3 dernières années ;
   une recherche porte sur tout l'historique. Les filtres sont gardés dans l'adresse : retour de la
   fiche d'un contrat sur la même sélection.
   ========================================================================= */

// Onglets de branche : produits URANUS regroupés (libellés de stdproduit)
const BRANCHES = [
  { cle: 'ALL', libelle: 'Toutes les branches', icone: Layers, produits: null },
  { cle: 'AUTO', libelle: 'Automobile', icone: Car, produits: [1] },
  { cle: 'SANTE', libelle: 'Santé', icone: HeartPulse, produits: [5] },
  { cle: 'VIE', libelle: 'Vie', icone: HeartHandshake, produits: [10] },
  { cle: 'IA', libelle: 'Individuelle Accidents', icone: Activity, produits: [2] },
  { cle: 'VOYAGE', libelle: 'Voyage', icone: Plane, produits: [3] },
  { cle: 'TRANSPORT', libelle: 'Transport', icone: Ship, produits: [6] },
  { cle: 'MRH', libelle: 'Habitation & Dommages', icone: Home, produits: [4, 7, 9], aide: 'Multirisques Habitation, Multirisques Professionnelle et Tous Dommages' },
  { cle: 'RC', libelle: 'Responsabilité Civile', icone: Shield, produits: [8] },
];

// Statuts calculés par le serveur ; « tous » = contrats non annulés
const STATUTS = {
  en_cours: { libelle: 'En cours', badge: 'emerald', aide: 'Échéance dans plus de 30 jours' },
  a_renouveler: { libelle: 'À renouveler', badge: 'amber', aide: 'Échéance dans les 30 prochains jours, sans renouvellement enregistré' },
  echu: { libelle: 'Échu', badge: 'slate', aide: 'Échéance passée, sans renouvellement enregistré sur la police' },
  renouvele: { libelle: 'Renouvelé', badge: 'blue', aide: 'Un renouvellement plus récent existe sur la même police' },
  resilie: { libelle: 'Résilié', badge: 'rose', aide: 'Avenant de résiliation' },
  annule: { libelle: 'Annulé', badge: 'rose', aide: "Annulé par un avenant d'annulation" },
};
const ONGLETS_STATUT = ['tous', 'en_cours', 'a_renouveler', 'echu', 'renouvele', 'resilie', 'annule'];
const LIBELLES_PERIODE = { effet: 'Effet', echeance: 'Échéance', emission: 'Émission' };
// Onglets rarement remplis : affichés seulement s'ils comptent des contrats (ou sont sélectionnés)
const ONGLETS_DISCRETS = ['resilie', 'annule'];
// Statuts pour lesquels le renouvellement de la police a un sens
const RENOUVELABLES = ['en_cours', 'a_renouveler', 'echu'];

const TAILLES_PAGE = [25, 50, 100];
const IMPRESSION_MAX = 1000;

// Formulaires de souscription (mêmes branches que le Registre des Devis)
const MODULES_SOUSCRIPTION = [
  ['auto', Car, 'Automobile'],
  ['voyage', Plane, 'Voyage'],
  ['transport', Ship, 'Transport'],
  ['mrh', Home, 'Habitation (MRH)'],
  ['sante', HeartPulse, 'Santé'],
  ['afa', HeartHandshake, 'Vie'],
  ['ia', UserPlus, 'Individuelle Accidents'],
  ['rc', Shield, 'Responsabilité Civile'],
  ['mrp', Building2, 'Multirisque Pro.'],
  ['tous-dommages', Layers, 'Dommages'],
];

const dateFr = (valeur) => {
  const m = String(valeur || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '-';
};
const montant = (valeur) => (valeur === null || valeur === undefined || valeur === ''
  ? '-'
  : `${Math.round(Number(valeur)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`);
const nombre = (n) => Number(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const joursAvant = (valeur) => {
  const m = String(valeur || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const jour = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  return Math.round((jour - aujourdhui) / 86400000);
};
const pluriel = (n, mot) => `${nombre(n)} ${mot}${Number(n) > 1 ? 's' : ''}`;

// Valeurs réelles du contrat (sans les valeurs de repli de normalizeContrat)
const valeurs = (c) => {
  const r = c.raw || {};
  const client = r.idclient && typeof r.idclient === 'object' ? r.idclient : null;
  return {
    police: c.numeropolice || r.numeropolice || '',
    mouvement: c.mouvement,
    clientId: client?.IdClient || null,
    client: client ? `${client.Nom || ''} ${client.Prenoms || ''}`.trim() : '',
    produit: r.idproduit?.libelle_produit || '',
    compagnie: r.idcompagnie?.RaisonSociale || '',
    effet: r.dateeffet || null,
    echeance: r.dateexpiration || null,
    primeNette: r.primenette ?? null,
    primeTtc: r.primettc ?? null,
    statut: c.statut_portefeuille,
  };
};

// Compteur d'onglet : transition de l'ancienne à la nouvelle valeur quand un filtre la change
const Compte = ({ valeur }) => {
  const n = useNombreAnime(valeur);
  return <span className="portefeuille-compte">{nombre(n)}</span>;
};

const lireNombre = (texte, defaut, valides = null) => {
  const n = Number(texte);
  if (!Number.isInteger(n) || n < 1) return defaut;
  return valides && !valides.includes(n) ? defaut : n;
};

export const ContractListPage = () => {
  const navigate = useNavigate();
  const { user, peut } = useAuth();
  const { error: toastError } = useToast();
  const [parametres, setParametres] = useSearchParams();

  // Filtres, gardés dans l'adresse
  const branche = BRANCHES.some((b) => b.cle === parametres.get('branche')) ? parametres.get('branche') : 'ALL';
  const statut = ONGLETS_STATUT.includes(parametres.get('statut')) ? parametres.get('statut') : 'tous';
  const recherche = parametres.get('q') || '';
  const champPeriode = ['echeance', 'emission'].includes(parametres.get('periode')) ? parametres.get('periode') : 'effet';
  const du = parametres.get('du') || '';
  const au = parametres.get('au') || '';
  const ordre = parametres.get('ordre') || '';
  const page = lireNombre(parametres.get('page'), 1);
  const taille = lireNombre(parametres.get('taille'), 25, TAILLES_PAGE);

  // Repart de l'adresse réelle : deux changements rapprochés (date « du » puis « au ») ne s'écrasent
  // pas (les mises à jour fonctionnelles de setSearchParams ne s'enchaînent pas comme un useState)
  const majFiltres = useCallback((changements, garderPage = false) => {
    setParametres(() => {
      const suivant = new URLSearchParams(window.location.search);
      Object.entries(changements).forEach(([cle, valeur]) => {
        if (valeur === '' || valeur === null || valeur === undefined) suivant.delete(cle);
        else suivant.set(cle, String(valeur));
      });
      if (!garderPage) suivant.delete('page');
      // Valeurs par défaut absentes de l'adresse
      if (suivant.get('branche') === 'ALL') suivant.delete('branche');
      if (suivant.get('statut') === 'tous') suivant.delete('statut');
      if (suivant.get('periode') === 'effet') suivant.delete('periode');
      if (suivant.get('page') === '1') suivant.delete('page');
      if (suivant.get('taille') === '25') suivant.delete('taille');
      return suivant;
    }, { replace: true });
  }, [setParametres]);

  // Recherche saisie, appliquée après une courte pause de frappe. Le champ ne reprend l'adresse que
  // si elle change d'ailleurs (retour arrière, filtre retiré) : une frappe en cours n'est pas écrasée.
  const [saisie, setSaisie] = useState(recherche);
  const rechercheEnvoyee = useRef(recherche);
  useEffect(() => {
    if (recherche === rechercheEnvoyee.current) return;
    rechercheEnvoyee.current = recherche;
    setSaisie(recherche);
  }, [recherche]);
  useEffect(() => {
    if (saisie.trim() === recherche) return undefined;
    const minuterie = setTimeout(() => {
      rechercheEnvoyee.current = saisie.trim();
      majFiltres({ q: saisie.trim() });
    }, 350);
    return () => clearTimeout(minuterie);
  }, [saisie, recherche, majFiltres]);

  const [liste, setListe] = useState({ contrats: [], total: 0 });
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(false);
  const [synthese, setSynthese] = useState(null);
  const [actualisation, setActualisation] = useState(0);
  const [impression, setImpression] = useState(false);
  const [nouvellePolice, setNouvellePolice] = useState(false);

  const brancheCourante = BRANCHES.find((b) => b.cle === branche);
  const filtresServeur = useMemo(() => ({
    ...(recherche ? { recherche } : {}),
    ...(du ? { [`${champPeriode}_du`]: du } : {}),
    ...(au ? { [`${champPeriode}_au`]: au } : {}),
  }), [recherche, champPeriode, du, au]);
  const filtreProduit = useMemo(() => (brancheCourante?.produits ? { idproduit: brancheCourante.produits.join(',') } : {}), [brancheCourante]);

  // Dernière requête seulement : une réponse plus ancienne (filtre changé entre-temps) est ignorée
  const requeteListe = useRef(0);
  useEffect(() => {
    const numero = ++requeteListe.current;
    setChargement(true);
    setErreur(false);
    contractApi.getPortefeuille({
      ...filtresServeur,
      ...filtreProduit,
      ...(statut !== 'tous' ? { statut } : {}),
      ...(ordre ? { ordre } : {}),
      page,
      page_size: taille,
    })
      .then((resultat) => {
        if (numero !== requeteListe.current) return;
        setListe(resultat);
      })
      .catch((err) => {
        if (numero !== requeteListe.current) return;
        // Page au-delà de la dernière (contrats retirés entre-temps) : retour à la première
        if (err?.response?.status === 404 && page > 1) {
          majFiltres({ page: '' });
          return;
        }
        setListe({ contrats: [], total: 0 });
        setErreur(true);
      })
      .finally(() => {
        if (numero === requeteListe.current) setChargement(false);
      });
  }, [filtresServeur, filtreProduit, statut, ordre, page, taille, actualisation, majFiltres]);

  const requeteSynthese = useRef(0);
  useEffect(() => {
    const numero = ++requeteSynthese.current;
    contractApi.getSynthesePortefeuille({ ...filtresServeur, ...filtreProduit })
      .then((donnees) => { if (numero === requeteSynthese.current) setSynthese(donnees); })
      .catch(() => { if (numero === requeteSynthese.current) setSynthese(null); });
  }, [filtresServeur, filtreProduit, actualisation]);

  // Compteurs des onglets
  const compteBranche = (b) => {
    if (!synthese) return null;
    const parProduit = synthese.par_produit || {};
    if (!b.produits) return Object.values(parProduit).reduce((s, n) => s + n, 0);
    return b.produits.reduce((s, id) => s + (parProduit[String(id)] || 0), 0);
  };
  const compteStatut = (cle) => {
    if (!synthese) return null;
    const parStatut = synthese.par_statut || {};
    if (cle === 'tous') return Object.entries(parStatut).reduce((s, [k, n]) => (k === 'annule' ? s : s + n), 0);
    return parStatut[cle] || 0;
  };
  const aRenouveler = compteStatut('a_renouveler') || 0;

  const filtresActifs = [
    recherche && { cle: 'q', libelle: `Recherche : « ${recherche} »`, retirer: () => { setSaisie(''); majFiltres({ q: '' }); } },
    branche !== 'ALL' && { cle: 'branche', libelle: brancheCourante.libelle, retirer: () => majFiltres({ branche: '' }) },
    statut !== 'tous' && { cle: 'statut', libelle: `Statut : ${STATUTS[statut].libelle}`, retirer: () => majFiltres({ statut: '' }) },
    (du || au) && {
      cle: 'periode',
      libelle: `${LIBELLES_PERIODE[champPeriode]} ${du ? `du ${dateFr(du)}` : ''} ${au ? `au ${dateFr(au)}` : ''}`.replace(/\s+/g, ' ').trim(),
      retirer: () => majFiltres({ du: '', au: '', periode: '' }),
    },
  ].filter(Boolean);
  const reinitialiser = () => {
    setSaisie('');
    setParametres(new URLSearchParams(), { replace: true });
  };

  const totalPages = Math.max(1, Math.ceil(liste.total / taille));
  const premier = liste.total ? (page - 1) * taille + 1 : 0;
  const dernier = Math.min(page * taille, liste.total);

  // Tri par le serveur : 1er clic croissant (décroissant pour les dates et la prime), 2e clic inverse
  const trier = (cle) => {
    const decroissantDabord = ['effet', 'echeance', 'prime'].includes(cle);
    const actuel = ordre.replace(/^-/, '') === cle ? ordre : null;
    const suivant = actuel ? (actuel.startsWith('-') ? cle : `-${cle}`) : (decroissantDabord ? `-${cle}` : cle);
    majFiltres({ ordre: suivant });
  };
  const enteteTri = (cle, libelle, alignement = 'left') => {
    const actif = ordre.replace(/^-/, '') === cle;
    const Icone = !actif ? ArrowUpDown : ordre.startsWith('-') ? ArrowDown : ArrowUp;
    return (
      <th className={`triable${alignement === 'right' ? ' droite' : ''}`} aria-sort={actif ? (ordre.startsWith('-') ? 'descending' : 'ascending') : 'none'}>
        <button type="button" className="portefeuille-tri" onClick={() => trier(cle)} title="Trier">
          {libelle}
          <Icone size={12} style={{ opacity: actif ? 1 : 0.45 }} />
        </button>
      </th>
    );
  };

  // État imprimable : contrats de la sélection en cours (jusqu'à IMPRESSION_MAX lignes)
  const imprimer = async () => {
    setImpression(true);
    try {
      const { contrats, total } = await contractApi.getPortefeuille({
        ...filtresServeur, ...filtreProduit, ...(statut !== 'tous' ? { statut } : {}), ...(ordre ? { ordre } : {}), page_size: IMPRESSION_MAX,
      });
      if (!contrats.length) {
        toastError('Aucun contrat à imprimer pour cette sélection.');
        return;
      }
      const lignes = contrats.map(valeurs);
      const libelleStatut = statut === 'tous' ? 'Tous les contrats (hors annulés)' : STATUTS[statut].libelle;
      exportToPdf({
        filename: `Portefeuille_contrats_${new Date().toISOString().slice(0, 10)}.pdf`,
        title: 'Portefeuille des contrats',
        metadata: {
          "Date d'édition": new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }),
          'Édité par': user?.nom || user?.email || '',
          Sélection: [brancheCourante.libelle, libelleStatut, ...filtresActifs.filter((f) => f.cle === 'q' || f.cle === 'periode').map((f) => f.libelle)].join(' - '),
          Volume: total > contrats.length ? `${nombre(contrats.length)} premières lignes sur ${pluriel(total, 'contrat')}` : pluriel(total, 'contrat'),
          'Total primes TTC': montant(lignes.reduce((s, l) => s + Number(l.primeTtc || 0), 0)),
        },
        headers: ['N° Police', 'Mouvement', 'Souscripteur', 'Produit', 'Compagnie', 'Date effet', 'Échéance', 'Prime nette', 'Prime TTC', 'Statut'],
        rows: lignes.map((l) => [
          l.police, l.mouvement, l.client, l.produit, l.compagnie, dateFr(l.effet), dateFr(l.echeance),
          montant(l.primeNette), montant(l.primeTtc), STATUTS[l.statut]?.libelle || '',
        ]),
        enTete: false,
        piedDePage: false,
      });
    } catch {
      toastError("L'état du portefeuille n'a pas pu être préparé. Veuillez réessayer.");
    } finally {
      setImpression(false);
    }
  };

  const peutRenouveler = peut('contrats.avenant');
  const peutAdministrerContrats = peut('contrats.admin_update');

  return (
    <div className="portefeuille">
      {/* En-tête */}
      <header className="portefeuille-entete">
        <div className="portefeuille-titre">
          <span className="portefeuille-pastille"><ShieldCheck size={22} /></span>
          <div>
            <h1>Portefeuille des contrats</h1>
            <p>Polices émises ces 3 dernières années : recherche, suivi des échéances, fiche et renouvellement.</p>
          </div>
        </div>
        <div className="portefeuille-actions">
          {peutAdministrerContrats && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/admin/contracts/edit')}
              title="Ouvrir l’administration des contrats"
            >
              <Shield size={16} />
              <span>Modifier les contrats</span>
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={imprimer} disabled={impression || chargement || !liste.total} title="Imprimer les contrats de la sélection en cours">
            <Printer size={16} />
            <span>{impression ? 'Préparation…' : "Imprimer l'état"}</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setActualisation((n) => n + 1)} title="Actualiser la liste" aria-label="Actualiser la liste">
            <RefreshCw size={16} />
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setNouvellePolice(true)}>
            <Plus size={16} />
            <span>Nouvelle police</span>
          </button>
        </div>
      </header>

      {/* Recherche et filtres */}
      <section className="glass-panel portefeuille-filtres" aria-label="Recherche et filtres">
        <div className="portefeuille-ligne-recherche">
          <label className="portefeuille-recherche">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              className="form-control"
              placeholder="N° de police, client, produit ou compagnie…"
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              aria-label="Rechercher un contrat"
            />
            {saisie && (
              <button type="button" className="portefeuille-effacer" onClick={() => { setSaisie(''); majFiltres({ q: '' }); }} aria-label="Effacer la recherche">
                <X size={15} />
              </button>
            )}
          </label>
          <div className="portefeuille-periode" role="group" aria-label="Période">
            <select className="form-control" value={champPeriode} onChange={(e) => majFiltres({ periode: e.target.value })} aria-label="Date filtrée">
              <option value="effet">Date d'effet</option>
              <option value="echeance">Date d'échéance</option>
              <option value="emission">Date d'émission</option>
            </select>
            <input type="date" className="form-control" value={du} max={au || undefined} onChange={(e) => majFiltres({ du: e.target.value })} aria-label="Du" title="Du" />
            <ArrowRight size={14} aria-hidden="true" className="portefeuille-fleche" />
            <input type="date" className="form-control" value={au} min={du || undefined} onChange={(e) => majFiltres({ au: e.target.value })} aria-label="Au" title="Au" />
          </div>
        </div>
        {recherche && (
          <p className="portefeuille-note">La recherche porte sur tout l'historique des contrats, pas seulement les 3 dernières années.</p>
        )}

        <div className="portefeuille-branches" role="tablist" aria-label="Branches">
          {BRANCHES.map((b) => {
            const Icone = b.icone;
            const actif = b.cle === branche;
            const n = compteBranche(b);
            return (
              <button
                key={b.cle}
                type="button"
                role="tab"
                aria-selected={actif}
                className={`portefeuille-puce${actif ? ' actif' : ''}`}
                onClick={() => majFiltres({ branche: b.cle })}
                title={b.aide}
              >
                <Icone size={15} />
                <span>{b.libelle}</span>
                {n !== null && <Compte valeur={n} />}
              </button>
            );
          })}
        </div>
      </section>

      {/* Contrats arrivant à échéance */}
      {aRenouveler > 0 && statut !== 'a_renouveler' && (
        <div className="portefeuille-alerte bandeau-anime" role="status">
          <BellRing size={18} />
          <span>
            <strong>{pluriel(aRenouveler, 'contrat')}</strong> {aRenouveler > 1 ? 'arrivent' : 'arrive'} à échéance dans les 30 prochains jours
            {branche !== 'ALL' ? ` (${brancheCourante.libelle})` : ''}, sans renouvellement enregistré.
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => majFiltres({ statut: 'a_renouveler' })}>Voir ces contrats</button>
        </div>
      )}

      <section className="glass-panel portefeuille-liste" aria-label="Contrats">
        {/* Statuts */}
        <div className="portefeuille-statuts" role="tablist" aria-label="Statut des contrats">
          {ONGLETS_STATUT.filter((cle) => !ONGLETS_DISCRETS.includes(cle) || cle === statut || compteStatut(cle) > 0).map((cle) => {
            const n = compteStatut(cle);
            const actif = cle === statut;
            return (
              <button
                key={cle}
                type="button"
                role="tab"
                aria-selected={actif}
                className={`portefeuille-statut statut-${cle}${actif ? ' actif' : ''}`}
                onClick={() => majFiltres({ statut: cle })}
                title={cle === 'tous' ? 'Tous les contrats, hors annulés' : STATUTS[cle].aide}
              >
                {cle === 'tous' ? 'Tous' : STATUTS[cle].libelle}
                {n !== null && <Compte valeur={n} />}
              </button>
            );
          })}
        </div>

        {/* Filtres actifs et volume */}
        <div className="portefeuille-resume">
          <div className="portefeuille-filtres-actifs">
            {filtresActifs.map((f) => (
              <span key={f.cle} className="portefeuille-filtre-actif">
                {f.libelle}
                <button type="button" onClick={f.retirer} aria-label={`Retirer le filtre ${f.libelle}`}><X size={12} /></button>
              </span>
            ))}
            {filtresActifs.length > 0 && (
              <button type="button" className="portefeuille-lien" onClick={reinitialiser}>Réinitialiser les filtres</button>
            )}
          </div>
          {!chargement && !erreur && (
            <span className="portefeuille-volume">{pluriel(liste.total, 'contrat')}</span>
          )}
        </div>

        {chargement ? (
          <SqueletteTableau colonnes={7} lignes={8} libelle="Chargement des contrats…" />
        ) : erreur ? (
          <div className="portefeuille-etat erreur etat-anime" role="alert">
            <AlertCircle size={34} />
            <p className="titre">Le portefeuille n'a pas pu être chargé.</p>
            <p>Le serveur ne répond pas pour le moment. Vérifiez votre connexion puis réessayez.</p>
            <button type="button" className="btn btn-primary" onClick={() => setActualisation((n) => n + 1)}>Réessayer</button>
          </div>
        ) : liste.total === 0 ? (
          <div className="portefeuille-etat etat-anime">
            <Inbox size={34} />
            {filtresActifs.length ? (
              <>
                <p className="titre">Aucun contrat ne correspond à vos critères.</p>
                <p>Vérifiez l'orthographe ou élargissez la recherche.</p>
                <button type="button" className="btn btn-secondary" onClick={reinitialiser}>Réinitialiser les filtres</button>
              </>
            ) : (
              <>
                <p className="titre">Aucun contrat émis ces 3 dernières années.</p>
                <p>Un devis confirmé depuis le Registre des devis apparaît ici comme contrat.</p>
              </>
            )}
          </div>
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
                    <th>Statut</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {liste.contrats.map((c) => {
                    const v = valeurs(c);
                    const jours = joursAvant(v.echeance);
                    const statutInfo = STATUTS[v.statut];
                    return (
                      <tr key={c.id}>
                        <td data-label="Police">
                          <button type="button" className="portefeuille-police" onClick={() => navigate(`/user/contracts/${c.id}`)} title="Ouvrir la fiche du contrat">
                            {v.police || '-'}
                          </button>
                          {v.mouvement && <div className="portefeuille-secondaire">{v.mouvement.charAt(0) + v.mouvement.slice(1).toLowerCase()}</div>}
                        </td>
                        <td data-label="Client">
                          {v.clientId ? (
                            <button type="button" className="portefeuille-client" onClick={() => navigate(`/user/clients/${v.clientId}`)} title="Ouvrir la fiche du client">
                              {v.client || '-'}
                            </button>
                          ) : <span className="portefeuille-client">{v.client || '-'}</span>}
                        </td>
                        <td data-label="Produit">
                          <div className="portefeuille-principal">{v.produit || '-'}</div>
                          <div className="portefeuille-secondaire">{v.compagnie || '-'}</div>
                        </td>
                        <td data-label="Période">
                          <div className="portefeuille-periode-cellule">
                            <span>{dateFr(v.effet)}</span>
                            <ArrowRight size={12} aria-hidden="true" />
                            <span className={v.statut === 'a_renouveler' ? 'proche' : ''}>{dateFr(v.echeance)}</span>
                          </div>
                          {jours !== null && v.statut === 'a_renouveler' && (
                            <div className="portefeuille-delai proche">{jours === 0 ? "Échéance aujourd'hui" : `Échéance dans ${pluriel(jours, 'jour')}`}</div>
                          )}
                          {jours !== null && v.statut === 'echu' && (
                            <div className="portefeuille-delai">Échu depuis {pluriel(Math.abs(jours), 'jour')}</div>
                          )}
                        </td>
                        <td data-label="Prime TTC" style={{ textAlign: 'right' }}>
                          <div className="portefeuille-montant">{montant(v.primeTtc)}</div>
                          <div className="portefeuille-secondaire">Nette {montant(v.primeNette)}</div>
                        </td>
                        <td data-label="Statut">
                          {statutInfo ? (
                            <span title={statutInfo.aide}><StatusBadge label={statutInfo.libelle} color={statutInfo.badge} /></span>
                          ) : '-'}
                        </td>
                        <td data-label="Actions" className="portefeuille-cellule-actions">
                          <div className="portefeuille-boutons">
                            <button type="button" className="btn btn-secondary" onClick={() => navigate(`/user/contracts/${c.id}`)} title="Fiche du contrat : quittance, documents, historique">
                              <Eye size={14} />
                              <span>Fiche</span>
                            </button>
                            {RENOUVELABLES.includes(v.statut) && peutRenouveler && (
                              <button
                                type="button"
                                className="btn btn-secondary portefeuille-renouveler"
                                onClick={() => navigate(`/user/contracts/${c.id}/renouvellement`)}
                                title="Préparer le renouvellement : nouvelle période, même numéro de police"
                              >
                                <RefreshCw size={14} />
                                <span>Renouveler</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <nav className="portefeuille-pagination" aria-label="Pagination">
              <span>
                <strong>{nombre(premier)}</strong>–<strong>{nombre(dernier)}</strong> sur <strong>{nombre(liste.total)}</strong>
              </span>
              <div className="portefeuille-pages">
                <label>
                  <span>Lignes par page</span>
                  <select className="form-control" value={taille} onChange={(e) => majFiltres({ taille: e.target.value })}>
                    {TAILLES_PAGE.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => majFiltres({ page: page - 1 }, true)} aria-label="Page précédente">
                  <ChevronLeft size={16} />
                </button>
                <span>Page {nombre(page)} / {nombre(totalPages)}</span>
                <button type="button" className="btn btn-secondary" disabled={page >= totalPages} onClick={() => majFiltres({ page: page + 1 }, true)} aria-label="Page suivante">
                  <ChevronRight size={16} />
                </button>
              </div>
            </nav>
          </>
        )}
      </section>

      {/* Nouvelle police : confirmation d'un devis (Registre des devis) ou nouvelle souscription */}
      <Modal isOpen={nouvellePolice} onClose={() => setNouvellePolice(false)} title="Nouvelle police d'assurance">
        <div className="portefeuille-nouvelle">
          <div>
            <h3><FileCheck size={18} /> Depuis un devis validé</h3>
            <p>
              Un devis devient un contrat quand il est confirmé : ouvrez-le dans le Registre des devis puis
              confirmez-le. Le contrat apparaît ensuite dans ce portefeuille.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => { setNouvellePolice(false); navigate('/user/quotes'); }}>
              <span>Ouvrir le Registre des devis</span>
              <ArrowRight size={15} />
            </button>
          </div>
          <div>
            <h3><Plus size={18} /> Nouvelle souscription</h3>
            <p>Établir un devis pour un nouveau risque :</p>
            <div className="portefeuille-modules">
              {MODULES_SOUSCRIPTION.map(([module, Icone, libelle]) => (
                <button
                  key={module}
                  type="button"
                  className={`btn btn-secondary${moduleActif(module) ? '' : ' module-ferme'}`}
                  onClick={() => { setNouvellePolice(false); navigate(`/user/quotes/${module}`); }}
                  disabled={!moduleActif(module)}
                  title={moduleActif(module) ? undefined : TITRE_MODULE_INACTIF}
                >
                  <Icone size={20} />
                  <span>{libelle}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ContractListPage;
