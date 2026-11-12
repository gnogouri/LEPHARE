import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  History, Upload, Download, Search, Loader2, CheckCircle2, AlertTriangle, X, FileSpreadsheet, RotateCcw, RefreshCw,
  Car, UserPlus, Plane, Home, HeartPulse, Ship, Building2, Shield, Layers, ShieldCheck, Pencil, TrendingUp,
  Wallet, HandCoins, ClipboardCheck, Save, Eye,
} from 'lucide-react';
import { Modal } from '../../../components/common/Modal';
import { AmountInput } from '../../../components/common/AmountInput';
import { DataTable } from '../../../components/common/DataTable';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import { RowActions } from '../../../components/common/RowActions';
import { BoutonsNouveauDevis, OngletsBranches, iconeOnglet } from '../../../components/common/BranchesDevis';
import { contractApi, repriseApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { messageErreurApi } from '../../../utils/financeUtils';
import { confirmer } from '../../../utils/dialogue';
import { downloadBlob } from '../../../utils/exportUtils';
import { moduleDuProduit, ongletDuProduit, ongletsRegistre } from '../../../utils/parametrage';
import { lienDevisReprise } from './modeReprise';
import { ListeDocumentsContrat, useDocumentsContrat } from '../contracts/documentsContrat';

// Reprise des affaires antérieures (demande du 2026-10-26) : contrats et quittances des années passées absents de
// LE PHARE. Saisie : les écrans de devis de la vue Production (mêmes écrans, tables et barèmes), ouverts en mode
// reprise, puis finalisation du devis en contrat de son année (production/reprise.py, reprendre_devis) ; ou import
// d'un fichier Excel. Ces affaires comptent dans les états de leur année. Chaque affaire est un contrat soldé :
// quittance encaissée, commission perçue (consigne du 2026-10-27), mêmes impressions que le module Contrats.

const ICONES_BRANCHE = { 1: Car, 2: UserPlus, 3: Plane, 4: Home, 5: HeartPulse, 6: Ship, 7: Building2, 8: Shield, 9: Layers };
const fcfa = (v) => `${Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`;
const dateFr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const nombre = (v) => Number(v) || 0;
// Échéance d'une affaire (statuts du portefeuille des contrats) ; une affaire renouvelée quitte la liste pour le module
// Contrats (demande du 2026-10-27 : « après renouvellement ils doivent être migrés dans le module contrat »)
const ECHEANCES = {
  en_cours: ['En cours', 'var(--accent-emerald)'],
  a_renouveler: ['À renouveler', 'var(--accent-amber)'],
  echu: ['Échue, à renouveler', 'var(--text-muted)'],
  annule: ['Annulée', 'var(--accent-rose)'],
};
const RENOUVELABLES = ['en_cours', 'a_renouveler', 'echu'];
const MODES_SAISIE = { import: 'Import Excel', devis: 'Écrans de devis', saisie: 'Saisie à l\'écran' };

const Champ = ({ libelle, aide, children, requis, id }) => (
  <div className="form-group" style={{ margin: 0 }}>
    <label className="form-label" htmlFor={id}>{libelle}{requis ? ' *' : ''}</label>
    {children}
    {aide && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{aide}</span>}
  </div>
);

// ------------------------------------------------------------------ finalisation d'un devis en affaire antérieure
const FinaliserDevis = ({ idDevis, anneeLimite, onFini, onFermer }) => {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [v, setV] = useState(null);
  const [erreurLecture, setErreurLecture] = useState('');
  const [f, setF] = useState({ NumeroPoliceCompagnie: '', DateEmission: '', TtcDocument: 0, Observation: '' });
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');
  const changer = (cle, valeur) => setF((x) => ({ ...x, [cle]: valeur }));

  useEffect(() => {
    let actif = true;
    repriseApi.lireDevis(idDevis).then((d) => {
      if (!actif) return;
      setV(d);
      const limite = `${anneeLimite}-01-01`;
      setF((x) => ({ ...x, NumeroPoliceCompagnie: d.NumeroPoliceCompagnie || '', DateEmission: d.DateEmission && d.DateEmission < limite ? d.DateEmission : d.DateEffet }));
    }).catch((err) => { if (actif) setErreurLecture(messageErreurApi(err)); });
    return () => { actif = false; };
  }, [idDevis, anneeLimite]);

  const module = v ? moduleDuProduit(v.IdProduit) : null;
  const ttc = nombre(v?.PrimeTtc);
  const ecart = nombre(f.TtcDocument) ? nombre(f.TtcDocument) - ttc : 0;
  const modifier = () => { onFermer(); navigate(lienDevisReprise(module, idDevis)); };

  const enregistrer = async () => {
    setErreur('');
    if (!f.NumeroPoliceCompagnie.trim()) { setErreur('Saisissez le numéro de police de la compagnie.'); return; }
    if (Math.abs(ecart) > 2) { setErreur(`Écart de ${fcfa(ecart)} avec la quittance : modifiez le devis et imposez sa prime.`); return; }
    setEnvoi(true);
    try {
      const r = await repriseApi.finaliserDevis(idDevis, f);
      success(r.message);
      onFini(r);
    } catch (err) {
      setErreur(messageErreurApi(err));
      toastError(`Affaire non enregistrée : ${messageErreurApi(err)}`);
    } finally {
      setEnvoi(false);
    }
  };

  if (erreurLecture) {
    return (
      <div>
        <div role="alert" className="reprise-alerte"><AlertTriangle size={16} aria-hidden="true" /><span>{erreurLecture}</span></div>
        <div className="reprise-navigation">
          <button type="button" className="btn btn-secondary" onClick={onFermer}>Fermer</button>
        </div>
      </div>
    );
  }
  if (!v) return <div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Lecture du devis…</div>;
  const Icone = ICONES_BRANCHE[v.IdProduit] || ShieldCheck;

  return (
    <div>
      <div className="reprise-bandeau">
        <Icone size={16} aria-hidden="true" />
        <strong>{v.Branche}</strong>
        <span>{v.Compagnie}</span>
        <span>{v.Client}</span>
        <span>{dateFr(v.DateEffet)} au {dateFr(v.DateExpiration)}</span>
        <span className="ttc">Devis {v.NumeroDevis}</span>
      </div>

      <div className="reprise-recap">
        <section>
          <h3>Risque du devis</h3>
          {v.Champs.length ? (
            <dl>{v.Champs.map((c, i) => <React.Fragment key={`${c.Libelle}-${i}`}><dt>{c.Libelle}</dt><dd>{c.Valeur}</dd></React.Fragment>)}</dl>
          ) : <p className="vide">Voir le devis.</p>}
        </section>
        <section>
          <h3>Primes du devis</h3>
          <dl>
            <dt>Prime nette</dt><dd>{fcfa(v.PrimeNette)}</dd>
            {v.Fga + v.Cedeao > 0 && <><dt>dont FGA et CEDEAO</dt><dd>{fcfa(v.Fga + v.Cedeao)}</dd></>}
            <dt>Accessoires</dt><dd>{fcfa(v.Accessoire)}</dd>
            <dt>Taxes</dt><dd>{fcfa(v.Taxe)}</dd>
            <dt>Prime TTC</dt><dd><strong>{fcfa(ttc)}</strong></dd>
          </dl>
        </section>
      </div>

      <div className="reprise-sous-titre">Quittance d'origine</div>
      <div className="reprise-grille">
        <Champ libelle="N° police de la compagnie" requis id="finaliser-police">
          <input id="finaliser-police" className="form-control" value={f.NumeroPoliceCompagnie} onChange={(e) => changer('NumeroPoliceCompagnie', e.target.value)} />
        </Champ>
        <Champ libelle="Date d'émission d'origine" requis id="finaliser-emission" aide={`Avant le 01/01/${anneeLimite}.`}>
          <input id="finaliser-emission" type="date" className="form-control" value={f.DateEmission} max={`${anneeLimite - 1}-12-31`} onChange={(e) => changer('DateEmission', e.target.value)} />
        </Champ>
        <Champ libelle="Prime TTC sur la quittance" id="finaliser-ttc" aide="Facultatif : contrôle, écart de 2 F au plus.">
          <AmountInput id="finaliser-ttc" value={f.TtcDocument} onChange={(x) => changer('TtcDocument', x)} suffix="F" />
        </Champ>
        <Champ libelle="Observation" id="finaliser-observation">
          <input id="finaliser-observation" className="form-control" maxLength={500} value={f.Observation} onChange={(e) => changer('Observation', e.target.value)} />
        </Champ>
      </div>
      {nombre(f.TtcDocument) > 0 && (
        <div className={`reprise-controle ${Math.abs(ecart) > 2 ? 'ecart' : 'conforme'}`}>
          {Math.abs(ecart) > 2
            ? <><AlertTriangle size={14} aria-hidden="true" /><span>Écart de {fcfa(ecart)} : modifiez le devis et imposez la prime de la quittance.</span></>
            : <><CheckCircle2 size={14} aria-hidden="true" /><span>Prime TTC conforme à la quittance.</span></>}
        </div>
      )}

      {/* Affaire antérieure soldée (consigne du 2026-10-27) : ni paiement ni commission à renseigner */}
      <div className="reprise-controle conforme">
        <CheckCircle2 size={14} aria-hidden="true" />
        <span>Quittance enregistrée encaissée ({fcfa(ttc)}) et commission du cabinet perçue.</span>
      </div>

      {erreur && <div role="alert" className="reprise-alerte"><AlertTriangle size={16} aria-hidden="true" /><span>{erreur}</span></div>}
      <div className="reprise-navigation">
        <button type="button" className="btn btn-secondary" onClick={onFermer} disabled={envoi}>Fermer</button>
        <div>
          {module && (
            <button type="button" className="btn btn-secondary" onClick={modifier} disabled={envoi}>
              <Pencil size={14} /> Modifier le devis
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={envoi} aria-busy={envoi}>
            {envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer l'affaire antérieure
          </button>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ import Excel
// Bouton « Importer Excel » retiré de la page à la demande de l'utilisateur (2026-10-26) ; le composant et l'import
// serveur (/api/reprise/import/…) restent disponibles pour le remettre.
export const ImportAffaires = ({ onImporte }) => {
  const { success, error: toastError } = useToast();
  const [fichier, setFichier] = useState(null);
  const [analyse, setAnalyse] = useState(null);
  const [resultat, setResultat] = useState(null);
  const [envoi, setEnvoi] = useState('');
  const lancer = async (importer) => {
    if (!fichier) { toastError('Choisissez le fichier Excel.'); return; }
    setEnvoi(importer ? 'import' : 'analyse');
    try {
      const r = importer ? await repriseApi.importer(fichier) : await repriseApi.analyser(fichier);
      if (importer) {
        setResultat(r);
        setAnalyse(null);
        success(`${r.Correctes} affaire${r.Correctes > 1 ? 's' : ''} reprise${r.Correctes > 1 ? 's' : ''}${r.Erreurs ? `, ${r.Erreurs} ligne${r.Erreurs > 1 ? 's' : ''} refusée${r.Erreurs > 1 ? 's' : ''}` : ''}.`);
        onImporte();
      } else {
        setAnalyse(r);
        setResultat(null);
      }
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi('');
    }
  };
  const telechargerModele = async () => {
    try {
      downloadBlob(await repriseApi.modele(), 'modele_reprise_affaires_anterieures.xlsx');
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };
  const compteRendu = resultat || analyse;
  return (
    <section className="glass-panel reprises-panneau">
      <div className="reprises-panneau-entete">
        <div>
          <h2><FileSpreadsheet size={18} aria-hidden="true" /> Importer un fichier Excel</h2>
          <p>
            Pour un grand nombre d'affaires : une ligne par quittance, colonnes du modèle, aide dans sa deuxième feuille. L'analyse contrôle
            chaque ligne sans rien enregistrer ; l'import reprend les lignes correctes et signale les autres. Les clients absents sont créés.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={telechargerModele}>
          <Download size={14} /> Modèle Excel
        </button>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="file" accept=".xlsx,.xlsm" className="form-control" style={{ maxWidth: 380 }} aria-label="Fichier Excel"
          onChange={(e) => { setFichier(e.target.files?.[0] || null); setAnalyse(null); setResultat(null); }} />
        <button type="button" className="btn btn-secondary" onClick={() => lancer(false)} disabled={!fichier || !!envoi}>
          {envoi === 'analyse' ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Analyser
        </button>
        <button type="button" className="btn btn-primary" onClick={() => lancer(true)} disabled={!fichier || !!envoi || (analyse && !analyse.Correctes)}>
          {envoi === 'import' ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
          {analyse ? `Importer les ${analyse.Correctes} ligne${analyse.Correctes > 1 ? 's' : ''} correcte${analyse.Correctes > 1 ? 's' : ''}` : 'Importer'}
        </button>
      </div>
      {compteRendu && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ fontSize: '0.84rem', marginBottom: '0.5rem' }}>
            <strong>{resultat ? 'Import terminé' : 'Analyse'}</strong> : {compteRendu.Correctes} ligne{compteRendu.Correctes > 1 ? 's' : ''} correcte{compteRendu.Correctes > 1 ? 's' : ''}
            {' '}pour {fcfa(compteRendu.PrimeTtc)}, {compteRendu.Erreurs} refusée{compteRendu.Erreurs > 1 ? 's' : ''}
            {compteRendu.NouveauxClients ? `, ${compteRendu.NouveauxClients} nouveau${compteRendu.NouveauxClients > 1 ? 'x' : ''} client${compteRendu.NouveauxClients > 1 ? 's' : ''}` : ''}
            {resultat ? '.' : ' - rien n\'est encore enregistré.'}
          </div>
          <div className="table-wrapper" style={{ maxHeight: 340, overflowY: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>Ligne</th><th>État</th><th>Client</th><th>Police compagnie</th><th>Prime TTC</th><th>{resultat ? 'Police / quittance' : 'Police / quittance prévues'}</th><th>Motif</th></tr></thead>
              <tbody>
                {compteRendu.Lignes.map((l) => (
                  <tr key={l.Ligne}>
                    <td>{l.Ligne}</td>
                    <td>{l.Statut === 'OK'
                      ? <span className="badge badge-emerald"><CheckCircle2 size={12} /> {resultat ? 'Reprise' : 'Correcte'}</span>
                      : <span className="badge badge-rose"><X size={12} /> Refusée</span>}</td>
                    <td>{l.Client}{l.NouveauClient ? <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}> - nouveau</span> : ''}</td>
                    <td>{l.NumeroPoliceCompagnie}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{l.PrimeTtc !== null && l.PrimeTtc !== undefined ? fcfa(l.PrimeTtc) : ''}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{l.NumeroPolice ? `${l.NumeroPolice} / ${l.NumeroQuittance}` : ''}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--accent-rose)' }}>{l.Message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};

// ------------------------------------------------------------------ page
// Présentation calquée sur la Gestion des devis (demande du 2026-10-26 : « pour ne pas être dépaysé ») : titre et
// boutons « Devis … » par branche, cartes de chiffres, devis à finaliser (comme les brouillons), onglets de branches
// du registre, tableau avec recherche, tri et pagination. Impressions du module Contrats (2026-10-27) : documents de
// chaque contrat (bouton Imprimer de la ligne) et état de la sélection.
const FILTRES_VIDES = { annee: '', compagnie: '' };
const TOUS = 'ALL';
const AUTRES = 'AUTRES';

const CarteChiffre = ({ libelle, valeur, icone: Icone, couleur, fond, detail }) => (
  <div className="glass-panel" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
    <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: fond, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icone size={20} color={couleur} />
    </div>
    <div>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>{libelle}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: couleur, fontFamily: 'var(--font-mono)' }}>{valeur}</div>
      {detail && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{detail}</div>}
    </div>
  </div>
);

const filtreCompact = { width: 'auto', minWidth: 150, padding: '0.35rem 0.6rem', fontSize: '0.8rem' };

export const RepriseAffairesPage = () => {
  const navigate = useNavigate();
  const [parametres, setParametres] = useSearchParams();
  const { success, error: toastError } = useToast();
  const { peut } = useAuth();
  const [ref_, setRef] = useState(null);
  const [donnees, setDonnees] = useState(null);
  const [enAttente, setEnAttente] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [filtres, setFiltres] = useState(FILTRES_VIDES);
  const [onglet, setOnglet] = useState(TOUS);
  // Documents du contrat d'une affaire : mêmes impressions que la fiche contrat (documentsContrat.jsx)
  const [impression, setImpression] = useState(null);
  const [listeDocuments, setListeDocuments] = useState(false);
  const documentsContrat = useDocumentsContrat(impression?.contrat || null, impression?.ligne.IdContrat);
  const peutSaisir = peut('contrats.reprise');
  // Même droit que le bouton « Renouveler » du portefeuille des contrats
  const peutRenouveler = peut('contrats.avenant');
  const finaliser = Number(parametres.get('finaliser')) || 0;

  // Onglets du registre des devis (Administration > Produits) et produits de chacun ; « Autres » : produit sans onglet
  const onglets = ongletsRegistre();
  const produitsOnglet = useMemo(() => {
    const groupes = {};
    (ref_?.Produits || []).forEach((p) => {
      const id = ongletDuProduit(p.id) || AUTRES;
      (groupes[id] = groupes[id] || []).push(p.id);
    });
    return groupes;
  }, [ref_]);

  useEffect(() => {
    repriseApi.referentiels().then(setRef).catch((err) => toastError(`Listes non chargées : ${messageErreurApi(err)}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chargerAttente = () => repriseApi.devisEnAttente().then((r) => setEnAttente(r.Devis || [])).catch(() => {});
  // Toutes les affaires des filtres choisis : le tableau cherche, trie et pagine lui-même (comme le registre des devis)
  const produits = onglet === TOUS ? '' : (produitsOnglet[onglet] || [0]).join(',');
  const charger = () => {
    setChargement(true);
    const params = { ...Object.fromEntries(Object.entries(filtres).filter(([, v]) => v !== '')), taille: 2000 };
    if (produits) params.produit = produits;
    repriseApi.lister(params).then(setDonnees).catch((err) => toastError(messageErreurApi(err))).finally(() => setChargement(false));
  };
  useEffect(() => { charger(); }, [filtres, produits]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { chargerAttente(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fermerFinalisation = () => {
    const suivant = new URLSearchParams(parametres);
    suivant.delete('finaliser');
    setParametres(suivant, { replace: true });
  };
  const ouvrirFinalisation = (id) => {
    const suivant = new URLSearchParams(parametres);
    suivant.set('finaliser', String(id));
    setParametres(suivant, { replace: true });
  };
  const filtrer = (cle, valeur) => setFiltres((f) => ({ ...f, [cle]: valeur }));
  const filtresActifs = Object.values(filtres).some((v) => v !== '');
  const ouvrirDocuments = (l) => {
    setListeDocuments(true);
    if (impression?.ligne.Id === l.Id && impression.contrat) return;
    setImpression({ ligne: l, contrat: null, erreur: '' });
    contractApi.getContractDetail(l.IdContrat)
      .then((contrat) => setImpression((x) => (x?.ligne.Id === l.Id ? { ...x, contrat } : x)))
      .catch((err) => setImpression((x) => (x?.ligne.Id === l.Id ? { ...x, erreur: messageErreurApi(err) } : x)));
  };
  // Relevé de compte, attestation et carte brune s'ouvrent dans leur propre fenêtre : la liste se ferme d'abord
  const choisirDocument = (d) => {
    if (d.fenetre) setListeDocuments(false);
    d.ouvrir();
  };
  const supprimerReprise = async (l) => {
    if (!(await confirmer({
      ton: 'danger', titre: `Supprimer la reprise ${l.NumeroPolice} ?`, confirmer: 'Supprimer',
      message: l.Mode === 'devis'
        ? `Le contrat et sa quittance ${l.NumeroQuittance} seront supprimés ; le devis revient dans les devis à finaliser, pour être corrigé. Possible tant qu'aucun encaissement, avenant ou sinistre n'existe sur ce contrat.`
        : `Le contrat, sa quittance ${l.NumeroQuittance} et le devis créés par la reprise seront supprimés. Possible tant qu'aucun encaissement, avenant ou sinistre n'existe sur ce contrat.`,
    }))) return;
    try {
      const r = await repriseApi.supprimer(l.Id);
      success(r.message);
      charger();
      chargerAttente();
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };

  const totaux = donnees?.Totaux;
  const parBranche = donnees?.ParBranche || {};
  const compte = (ids) => (ids || []).reduce((s, id) => s + (parBranche[String(id)] || 0), 0);
  const ongletsBranches = [
    { id: TOUS, label: 'Tous', count: Object.values(parBranche).reduce((s, n) => s + n, 0), icon: null },
    ...onglets.filter((o) => produitsOnglet[o.id]).map((o) => ({ id: o.id, label: o.label, count: compte(produitsOnglet[o.id]), icon: iconeOnglet(o.id) })),
    ...(produitsOnglet[AUTRES] ? [{ id: AUTRES, label: 'Autres', count: compte(produitsOnglet[AUTRES]), icon: iconeOnglet(AUTRES) }] : []),
  ];
  const libelleOnglet = ongletsBranches.find((o) => o.id === onglet)?.label || '';
  // Recherche du tableau commun : police OREOLE et compagnie, client, quittance, compagnie
  const lignes = useMemo(() => (donnees?.Lignes || []).map((l) => ({
    ...l, nomcomplet: [l.NumeroPolice, l.NumeroPoliceCompagnie, l.Client, l.NumeroQuittance, l.Compagnie].filter(Boolean).join(' '),
  })), [donnees]);

  // Colonne « Police OREOLE » retirée à la demande (2026-10-26) : le contrat s'ouvre par le bouton « Contrat »
  const colonnes = [
    // Saisie (mode et auteur) sous le n° de police : plus de colonne à part, les actions restent visibles sur un portable
    {
      header: 'Police compagnie', accessor: 'NumeroPoliceCompagnie',
      render: (l) => (
        <div>
          {l.NumeroPoliceCompagnie}
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', maxWidth: 125, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={`${MODES_SAISIE[l.Mode] || l.Mode}, ${l.CreePar}`}>
            {MODES_SAISIE[l.Mode] || l.Mode}, {l.CreePar}
          </div>
        </div>
      ),
    },
    { header: 'Client', accessor: 'Client' },
    {
      header: 'Compagnie et branche', accessor: 'Compagnie',
      render: (l) => (
        <div>
          {l.Compagnie}
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{l.Branche}</div>
          {l.Description && <div className="reprise-description" title={l.Description}>{l.Description}</div>}
        </div>
      ),
    },
    {
      header: 'Effet → échéance', accessor: 'DateEffet',
      render: (l) => (
        <div>
          <span style={{ whiteSpace: 'nowrap' }}>{dateFr(l.DateEffet)} →</span> <span style={{ whiteSpace: 'nowrap' }}>{dateFr(l.DateExpiration)}</span>
          <div style={{ fontSize: '0.72rem', color: l.DevisRenouvellement ? 'var(--accent-blue, #3b82f6)' : ECHEANCES[l.Statut]?.[1] }}>
            {l.DevisRenouvellement ? `Renouvellement en cours, devis ${l.DevisRenouvellement}` : ECHEANCES[l.Statut]?.[0]}
          </div>
        </div>
      ),
    },
    // Affaires soldées : prime encaissée, commission perçue (consigne du 2026-10-27)
    // Prime et commission dans une colonne : la ligne garde ses actions visibles sur un écran de portable
    {
      header: 'Prime et commission', accessor: 'PrimeTtc',
      render: (l) => (
        <div style={{ minWidth: 130 }}>
          <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fcfa(l.PrimeTtc)}</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--accent-emerald)' }}> encaissée</span>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Commission <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fcfa(l.Commission)}</span>{' '}
            <span style={{ color: 'var(--accent-emerald)' }}>perçue</span>, {Number(l.TauxCommission).toLocaleString('fr-FR')} %
          </div>
        </div>
      ),
    },
    {
      header: 'Actions',
      render: (l) => (
        <div className="portefeuille-boutons" style={{ alignItems: 'center' }}>
          {/* Bouton « Fiche » du portefeuille des contrats, à la place de « Consulter l'affaire antérieure » (demandes du
              2026-10-27) : la fiche contrat montre l'affaire reprise ; son Retour ramène ici */}
          <button type="button" className="btn btn-secondary" onClick={() => navigate(`/user/contracts/${l.IdContrat}`, { state: { retour: '/user/reprises' } })}
            title="Fiche du contrat : quittance, documents, historique">
            <Eye size={14} />
            <span>Fiche</span>
          </button>
          {/* Renouvelable comme tout contrat ; une fois le renouvellement confirmé, l'affaire passe dans le module Contrats */}
          {RENOUVELABLES.includes(l.Statut) && peutRenouveler && (
            <button
              type="button"
              className="btn btn-secondary portefeuille-renouveler"
              onClick={() => navigate(`/user/contracts/${l.IdContrat}/renouvellement`, { state: { retour: '/user/reprises' } })}
              title="Préparer le renouvellement : nouvelle période, même numéro de police ; confirmé, le contrat passe dans le module Contrats"
            >
              <RefreshCw size={14} />
              <span>Renouveler</span>
            </button>
          )}
          <RowActions
            showPrint
            onPrint={() => ouvrirDocuments(l)}
            printTitle="Imprimer les documents du contrat"
            showConfirm={false}
            showView={false}
            showEdit={false}
            showArchive={peutSaisir && (l.Auteur || donnees?.PeutToutSupprimer)}
            archiveTitle="Supprimer cette reprise"
            onArchive={() => supprimerReprise(l)}
          />
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        {/* Titre seul, sans description ni bouton d'import Excel (retirés à la demande du 2026-10-26) */}
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <History size={26} color="#3b82f6" />
          Affaires antérieures
        </h1>

        {/* Saisie par branche (mêmes boutons que la Gestion des devis, écrans ouverts en mode affaire antérieure) */}
        {peutSaisir && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <BoutonsNouveauDevis lien={(module) => lienDevisReprise(module)} titre={(libelle) => `${libelle} en affaire antérieure`} />
          </div>
        )}
      </div>

      {/* Cartes de chiffres */}
      {totaux && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <CarteChiffre libelle="Affaires reprises" valeur={totaux.Nombre.toLocaleString('fr-FR')} icone={ClipboardCheck} couleur="#3b82f6" fond="rgba(59, 130, 246, 0.15)" />
          <CarteChiffre libelle="Primes nettes" valeur={fcfa(totaux.PrimeNette)} icone={TrendingUp} couleur="#8b5cf6" fond="rgba(139, 92, 246, 0.15)" />
          <CarteChiffre libelle="Primes TTC encaissées" valeur={fcfa(totaux.Encaisse)} icone={Wallet} couleur="#10b981" fond="rgba(16, 185, 129, 0.15)" />
          <CarteChiffre libelle="Commissions perçues" valeur={fcfa(totaux.Commission)} icone={HandCoins} couleur="#f59e0b" fond="rgba(245, 158, 11, 0.15)" />
        </div>
      )}

      {/* Devis enregistrés en mode affaire antérieure, pas encore finalisés (comme les brouillons de la Gestion des devis) */}
      {enAttente.length > 0 && (
        <div className="glass-panel" style={{ padding: '1rem 1.25rem', borderRadius: '12px', borderLeft: '4px solid #f59e0b' }}>
          <div style={{ fontWeight: 800, marginBottom: '0.75rem', color: '#f59e0b' }}>
            Devis à finaliser ({enAttente.length})
          </div>
          <DataTable
            searchable={false}
            itemsPerPage={5}
            data={enAttente}
            columns={[
              { header: 'Devis', accessor: 'NumeroDevis', render: (d) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{d.NumeroDevis}</strong> },
              { header: 'Client', accessor: 'Client', render: (d) => d.Client || '-' },
              {
                header: 'Compagnie et branche', accessor: 'Compagnie',
                render: (d) => (
                  <div>{d.Compagnie}<div className="reprise-description">{d.Branche}{d.Champs.length ? ` - ${d.Champs.map((c) => c.Valeur).join(', ')}` : ''}</div></div>
                ),
              },
              { header: 'Effet → échéance', accessor: 'DateEffet', render: (d) => <span style={{ whiteSpace: 'nowrap' }}>{dateFr(d.DateEffet)} → {dateFr(d.DateExpiration)}</span> },
              { header: 'Prime TTC', accessor: 'PrimeTtc', render: (d) => <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fcfa(d.PrimeTtc)}</span> },
              {
                header: 'Actions',
                render: (d) => (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="button" className="btn btn-primary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }} onClick={() => ouvrirFinalisation(d.IdDevis)}>
                      Finaliser
                    </button>
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
                      onClick={() => navigate(lienDevisReprise(moduleDuProduit(d.IdProduit), d.IdDevis))}>
                      Modifier
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* Onglets de branches, comme le registre des devis */}
      {ref_ && <OngletsBranches onglets={ongletsBranches} actif={onglet} onChoisir={setOnglet} libelle={(tab) => `Afficher les affaires antérieures : ${tab.label}`} />}

      {/* Tableau */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {!totaux || totaux.Nombre === 0
              ? `Aucune affaire antérieure${filtresActifs || onglet !== TOUS ? ' pour ces filtres' : ''}`
              : <><strong>{totaux.Nombre.toLocaleString('fr-FR')}</strong> affaire{totaux.Nombre > 1 ? 's' : ''} antérieure{totaux.Nombre > 1 ? 's' : ''}{onglet !== TOUS ? ` (${libelleOnglet})` : ''}</>}
            {donnees?.Migrees > 0 && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                {donnees.Migrees.toLocaleString('fr-FR')} affaire{donnees.Migrees > 1 ? 's' : ''} renouvelée{donnees.Migrees > 1 ? 's' : ''}, passée{donnees.Migrees > 1 ? 's' : ''} dans le
                {' '}<button type="button" className="btn-link" onClick={() => navigate('/user/contracts')}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#3b82f6', fontSize: 'inherit', fontWeight: 600 }}>
                  module Contrats
                </button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="form-control" style={filtreCompact} aria-label="Année d'effet" value={filtres.annee} onChange={(e) => filtrer('annee', e.target.value)}>
              <option value="">Années</option>{(donnees?.Annees || []).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <select className="form-control" style={filtreCompact} aria-label="Compagnie" value={filtres.compagnie} onChange={(e) => filtrer('compagnie', e.target.value)}>
              <option value="">Compagnies</option>{(ref_?.Compagnies || []).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
            {filtresActifs && (
              <button type="button" className="btn btn-secondary" title="Retirer les filtres" onClick={() => setFiltres(FILTRES_VIDES)}
                style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem' }}>
                <RotateCcw size={13} />
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => { charger(); chargerAttente(); }} title="Actualiser la liste"
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem' }}>
              <RefreshCw size={13} />
              <span>Actualiser</span>
            </button>
          </div>
        </div>

        {chargement && !donnees ? (
          <LoadingSpinner text="Chargement des affaires antérieures…" />
        ) : (
          <DataTable columns={colonnes} data={lignes} searchPlaceholder="Rechercher par police, client, quittance ou compagnie..." />
        )}
      </div>

      <Modal isOpen={!!finaliser} onClose={fermerFinalisation} title="Finaliser l'affaire antérieure"
        subtitle="Le devis devient le contrat de son année : police de l'année d'origine, quittance encaissée, commission perçue." size="large" maxWidth="980px">
        {!!finaliser && ref_ && (
          <FinaliserDevis key={finaliser} idDevis={finaliser} anneeLimite={ref_.AnneeLimite} onFermer={fermerFinalisation}
            onFini={() => { fermerFinalisation(); charger(); chargerAttente(); }} />
        )}
      </Modal>

      <Modal isOpen={listeDocuments} onClose={() => setListeDocuments(false)} maxWidth="560px"
        title={impression ? `Documents du contrat ${impression.ligne.NumeroPolice}` : ''}
        subtitle={impression ? [impression.ligne.Client, impression.ligne.Branche, impression.ligne.Compagnie].filter(Boolean).join(', ') : ''}>
        {impression?.erreur ? (
          <div role="alert" className="reprise-alerte"><AlertTriangle size={16} aria-hidden="true" /><span>{impression.erreur}</span></div>
        ) : !impression?.contrat ? (
          <div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Lecture du contrat…</div>
        ) : (
          <ListeDocumentsContrat documents={documentsContrat.documents} onChoisir={choisirDocument} />
        )}
      </Modal>
      {documentsContrat.fenetres}
    </div>
  );
};

export default RepriseAffairesPage;
