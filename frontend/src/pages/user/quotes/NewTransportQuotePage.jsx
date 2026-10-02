import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { transportApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { Modal } from '../../../components/common/Modal';
import { printBordereauTransport } from '../../../utils/exportUtils';
import {
  Ship, UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, Loader2, ChevronLeft,
  RefreshCw, Printer, Download, Eye, CalendarRange, Users, FileCheck, Info,
} from 'lucide-react';

// Production Transport (facultés) d'URANUS : import des bordereaux GUCE, deux par mois (du 1er au 15
// et du 16 au dernier jour). Chaque import génère, par client et par police GUCE, un devis confirmé
// en contrat (police à l'abonnement) avec une ligne par certificat, et la quittance.
// Le compte rendu OREOLE du 09/09/2026 renvoie les affaires hors GUCE à un développement futur.

const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const deuxChiffres = (n) => String(n).padStart(2, '0');

const messageErreurApi = (err) => {
  const data = err?.response?.data;
  if (!data) return err?.message || 'serveur injoignable';
  if (data instanceof Blob) return 'téléchargement impossible';
  if (Array.isArray(data)) return data[0]?.OutputMessage || JSON.stringify(data[0]);
  if (typeof data === 'string') return data.slice(0, 200);
  return data.error || data.erreur || data.detail || data.message || JSON.stringify(data);
};

// Périodes acceptées (règle d'URANUS) : 1er au 15, 16 au dernier jour du mois, ou mois complet
const QUINZAINES = [
  { id: '1', libelle: 'Du 1er au 15' },
  { id: '2', libelle: 'Du 16 au dernier jour du mois' },
  { id: 'M', libelle: 'Mois complet (du 1er au dernier jour)' },
];
const bornesPeriode = (mois, quinzaine) => {
  if (!mois) return [null, null];
  const [annee, m] = mois.split('-').map(Number);
  const dernier = new Date(annee, m, 0).getDate();
  const debut = quinzaine === '2' ? 16 : 1;
  const fin = quinzaine === '1' ? 15 : dernier;
  return [`${annee}-${deuxChiffres(m)}-${deuxChiffres(debut)}`, `${annee}-${deuxChiffres(m)}-${deuxChiffres(fin)}`];
};

// Écran étroit (mobile) : bordereaux présentés en cartes plutôt qu'en tableau
const useEcranEtroit = (largeurMax = 720) => {
  const requete = `(max-width: ${largeurMax}px)`;
  const [etroit, setEtroit] = useState(() => typeof window !== 'undefined' && window.matchMedia(requete).matches);
  useEffect(() => {
    const mq = window.matchMedia(requete);
    const maj = () => setEtroit(mq.matches);
    mq.addEventListener('change', maj);
    return () => mq.removeEventListener('change', maj);
  }, [requete]);
  return etroit;
};

const ETAPES = [
  { num: 1, libelle: 'Fichier & période', icone: UploadCloud },
  { num: 2, libelle: 'Contrôle', icone: FileCheck },
  { num: 3, libelle: 'Résumé', icone: CheckCircle2 },
];

const styles = {
  carte: { padding: '1.5rem', borderRadius: '14px' },
  titreCarte: { display: 'flex', alignItems: 'center', gap: '0.55rem', margin: '0 0 1.1rem', fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' },
  sousTitre: { fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '1.4rem 0 0.7rem' },
  aide: { fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' },
  grille: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '1rem 1.25rem', alignItems: 'start' },
  tuiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: '0.6rem' },
  tuile: (couleur) => ({ padding: '0.75rem 0.9rem', borderRadius: '10px', border: `1px solid ${couleur || 'var(--border-subtle)'}`, background: 'var(--bg-surface-elevated)' }),
  alerte: (couleur) => ({
    display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.8rem 1rem', borderRadius: '10px',
    border: `1px solid ${couleur}`, background: 'var(--bg-surface-elevated)', fontSize: '0.85rem', color: 'var(--text-primary)',
  }),
  tableau: { width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '0.5rem 0.55rem', fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-medium)', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--bg-surface)' },
  td: { padding: '0.45rem 0.55rem', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top', color: 'var(--text-primary)' },
  num: { textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' },
  pastille: (couleur) => ({ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.15rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, border: `1px solid ${couleur}`, color: couleur, whiteSpace: 'nowrap' }),
};

const Tuile = ({ libelle, valeur, couleur, fort }) => (
  <div style={styles.tuile(couleur)}>
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

// Tableau des contrats issus d'un bordereau (forme contractée : un contrat par client et par police GUCE)
const TableauContrats = ({ contrats, prevision }) => (
  <div style={{ overflowX: 'auto' }}>
    <table style={styles.tableau}>
      <thead>
        <tr>
          <th style={styles.th}>Client</th>
          <th style={styles.th}>Police GUCE</th>
          <th style={styles.th}>Compagnie</th>
          {!prevision && <th style={styles.th}>Police / quittance</th>}
          <th style={{ ...styles.th, textAlign: 'right' }}>Certificats</th>
          {prevision && <th style={{ ...styles.th, textAlign: 'right' }}>Valeur assurée</th>}
          <th style={{ ...styles.th, textAlign: 'right' }}>Prime nette</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>Accessoire</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>Taxe</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>Prime TTC</th>
        </tr>
      </thead>
      <tbody>
        {contrats.map((c) => (
          <tr key={`${c.IdClient}-${c.NumeroPolice || c.NumeroPoliceGuce}-${c.IdDevis || ''}`}>
            <td style={{ ...styles.td, fontWeight: 700 }}>{c.Client}</td>
            <td style={styles.td}>{prevision ? c.NumeroPolice : c.NumeroPoliceGuce}</td>
            <td style={styles.td}>{c.Compagnie || <span style={{ color: 'var(--accent-amber)' }}>{c.Assureur || 'non reconnue'}</span>}</td>
            {!prevision && <td style={styles.td}>{c.NumeroPolice || '—'}<div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{c.NumeroQuittance ? `Quittance ${c.NumeroQuittance}` : 'Sans quittance'}</div></td>}
            <td style={{ ...styles.td, ...styles.num }}>{c.Certificats}</td>
            {prevision && <td style={{ ...styles.td, ...styles.num }}>{fcfa(c.ValeurAssurance)}</td>}
            <td style={{ ...styles.td, ...styles.num }}>{fcfa(c.PrimeNette)}</td>
            <td style={{ ...styles.td, ...styles.num }}>{fcfa(prevision ? c.AccessoireNet : c.Accessoire)}</td>
            <td style={{ ...styles.td, ...styles.num }}>{fcfa(c.Taxe)}</td>
            <td style={{ ...styles.td, ...styles.num, fontWeight: 800 }}>{fcfa(prevision ? c.PrimeTtcNette : c.PrimeTtc)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// Certificats d'un bordereau (ou d'un contrat) : consultation, impression, export
export const CertificatsTransportModal = ({ filtres, titre, onClose, idImportation, nomExport }) => {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    let actif = true;
    transportApi.getCertificats(filtres)
      .then((d) => { if (actif) setDonnees(d); })
      .catch((err) => { if (actif) setErreur(messageErreurApi(err)); });
    return () => { actif = false; };
  }, [JSON.stringify(filtres)]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = donnees?.Totaux || {};
  return (
    <Modal isOpen onClose={onClose} title={titre} maxWidth="1180px">
      {erreur && <Alerte couleur="var(--accent-rose)" icone={XCircle}>{erreur}</Alerte>}
      {!donnees && !erreur && <p style={{ color: 'var(--text-muted)', display: 'flex', gap: '0.4rem', alignItems: 'center' }}><Loader2 size={16} className="spin" /> Chargement des certificats…</p>}
      {donnees && (
        <>
          <div style={styles.tuiles}>
            <Tuile libelle="Certificats" valeur={t.Certificats} />
            <Tuile libelle="Valeur assurée" valeur={`${fcfa(t.ValeurAssurance)} F`} />
            <Tuile libelle="Prime nette" valeur={`${fcfa(t.PrimeNette)} F`} />
            <Tuile libelle="Prime totale" valeur={`${fcfa(t.PrimeTtc)} F`} />
            <Tuile libelle="Total général" valeur={`${fcfa(t.TotalGeneral)} F`} couleur="var(--primary-500)" fort />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.9rem 0' }}>
            <button type="button" className="btn btn-secondary" onClick={() => printBordereauTransport(filtres)} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}><Printer size={15} /> Imprimer le bordereau</button>
            {idImportation && (
              <button type="button" className="btn btn-secondary" onClick={() => transportApi.telechargerBordereauExcel(idImportation, nomExport)} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}><Download size={15} /> Exporter Excel (29 colonnes)</button>
            )}
          </div>
          <div style={{ overflow: 'auto', maxHeight: '55vh', border: '1px solid var(--border-subtle)', borderRadius: '10px' }}>
            <table style={styles.tableau}>
              <thead>
                <tr>
                  {['N° requête', 'Certificat', 'Assuré', 'Transport', 'Voyage', 'Marchandise'].map((l) => <th key={l} style={styles.th}>{l}</th>)}
                  {['Valeur', 'P. nette', 'Access.', 'Taxe', 'P. totale'].map((l) => <th key={l} style={{ ...styles.th, textAlign: 'right' }}>{l}</th>)}
                </tr>
              </thead>
              <tbody>
                {donnees.Certificats.map((c) => (
                  <tr key={c.NumeroRequete}>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap', fontWeight: 600 }}>{c.NumeroRequete}<div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{dateFr(c.DateRequete)}</div></td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{c.ReferenceCertificat}<div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{dateFr(c.DateCertificat)}</div></td>
                    <td style={styles.td}>{c.Assure}</td>
                    <td style={styles.td}>{c.MoyenTransport}<div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{c.NumeroDocumentTransport}</div></td>
                    <td style={styles.td}>{c.Voyage}</td>
                    <td style={styles.td}>{c.DescriptionCommerciale}</td>
                    <td style={{ ...styles.td, ...styles.num }}>{fcfa(c.ValeurAssurance)}</td>
                    <td style={{ ...styles.td, ...styles.num }}>{fcfa(c.PrimeNette)}</td>
                    <td style={{ ...styles.td, ...styles.num }}>{fcfa(c.Accessoire)}</td>
                    <td style={{ ...styles.td, ...styles.num }}>{fcfa(c.Taxe)}</td>
                    <td style={{ ...styles.td, ...styles.num, fontWeight: 700 }}>{fcfa(c.PrimeTtc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
};

export const NewTransportQuotePage = () => {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const champFichier = useRef(null);

  const [step, setStep] = useState(1);
  const [fichier, setFichier] = useState(null);
  const [glisser, setGlisser] = useState(false);
  const [periodeDuFichier, setPeriodeDuFichier] = useState(true);
  const [mois, setMois] = useState(() => new Date().toISOString().slice(0, 7));
  const [quinzaine, setQuinzaine] = useState('1');
  const [correspondances, setCorrespondances] = useState({});
  const [analyse, setAnalyse] = useState(null);
  const [erreurAnalyse, setErreurAnalyse] = useState('');
  const [analyseEnCours, setAnalyseEnCours] = useState(false);
  const [filtreLignes, setFiltreLignes] = useState('TOUTES');
  const [confirmation, setConfirmation] = useState(false);
  const [importEnCours, setImportEnCours] = useState(false);
  const [resultat, setResultat] = useState(null);

  const [bordereaux, setBordereaux] = useState(null);
  const [erreurBordereaux, setErreurBordereaux] = useState('');
  const [certificatsOuverts, setCertificatsOuverts] = useState(null);
  const ecranEtroit = useEcranEtroit();

  const chargerBordereaux = () => {
    setErreurBordereaux('');
    transportApi.getBordereaux()
      .then((liste) => setBordereaux(Array.isArray(liste) ? liste : []))
      .catch((err) => { setBordereaux([]); setErreurBordereaux(messageErreurApi(err)); });
  };
  useEffect(chargerBordereaux, []);

  const [debutManuel, finManuel] = bornesPeriode(mois, quinzaine);
  const parametres = (corresp = correspondances) => ({
    fichier,
    debut: periodeDuFichier ? (analyse?.DebutPeriode || null) : debutManuel,
    fin: periodeDuFichier ? (analyse?.FinPeriode || null) : finManuel,
    correspondances: corresp,
  });

  const lancerAnalyse = async (corresp = correspondances, { premiere = false } = {}) => {
    if (!fichier) { toastError('Sélectionnez le fichier Excel du bordereau GUCE.'); return; }
    setAnalyseEnCours(true);
    setErreurAnalyse('');
    try {
      const params = parametres(corresp);
      if (premiere && periodeDuFichier) { params.debut = null; params.fin = null; }
      const res = await transportApi.analyserBordereau(params);
      setAnalyse(res);
      setStep(2);
    } catch (err) {
      setAnalyse(null);
      setErreurAnalyse(messageErreurApi(err));
    } finally {
      setAnalyseEnCours(false);
    }
  };

  const choisirClient = (nomFichier, idClient) => {
    const suivantes = { ...correspondances };
    if (idClient) suivantes[nomFichier] = Number(idClient); else delete suivantes[nomFichier];
    setCorrespondances(suivantes);
    lancerAnalyse(suivantes);
  };

  const importer = async () => {
    setConfirmation(false);
    setImportEnCours(true);
    try {
      const res = await transportApi.importerBordereau(parametres());
      setResultat(res);
      setStep(3);
      success(`Bordereau du ${dateFr(res.DebutPeriode)} au ${dateFr(res.FinPeriode)} importé : ${res.Contrats.length} contrat(s) généré(s).`);
      chargerBordereaux();
    } catch (err) {
      const donnees = err?.response?.data;
      if (donnees?.analyse) setAnalyse(donnees.analyse);
      toastError(`Import refusé : ${messageErreurApi(err)}`);
    } finally {
      setImportEnCours(false);
    }
  };

  const recommencer = () => {
    setFichier(null);
    setAnalyse(null);
    setResultat(null);
    setCorrespondances({});
    setErreurAnalyse('');
    setFiltreLignes('TOUTES');
    setStep(1);
    if (champFichier.current) champFichier.current.value = '';
  };

  const choisirFichier = (f) => {
    if (!f) return;
    if (!/\.(xls|xlsx)$/i.test(f.name)) { toastError('Le bordereau GUCE est un fichier Excel (.xls ou .xlsx).'); return; }
    setFichier(f);
    setAnalyse(null);
    setCorrespondances({});
    setErreurAnalyse('');
  };

  const lignesFiltrees = useMemo(() => {
    const lignes = analyse?.Lignes || [];
    if (filtreLignes === 'ERREURS') return lignes.filter((l) => l.Erreurs.length);
    if (filtreLignes === 'AVERTISSEMENTS') return lignes.filter((l) => l.Avertissements.length);
    return lignes;
  }, [analyse, filtreLignes]);

  const t = analyse?.Totaux;
  const souscripteursAChoisir = (analyse?.Souscripteurs || []).filter((s) => s.Statut !== 'IDENTIFIE');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1280px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* EN-TÊTE */}
      <div>
        <button type="button" className="btn btn-link" onClick={() => navigate('/user/quotes')} style={{ padding: 0, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
          <ChevronLeft size={16} /> Registre des devis
        </button>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: 0 }}>
          <Ship size={26} style={{ color: 'var(--primary-500)' }} /> Production Transport — bordereaux GUCE
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.3rem 0 0' }}>
          Deux bordereaux par mois (du 1er au 15, puis du 16 au dernier jour). Chaque import crée, par client et par police GUCE,
          un contrat à l'abonnement avec ses certificats et sa quittance.
        </p>
      </div>

      {/* ÉTAPES */}
      <nav aria-label="Étapes de l'import" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '0.5rem' }}>
        {ETAPES.map(({ num, libelle, icone: Icone }) => {
          const actif = step === num;
          const fait = step > num;
          return (
            <div key={num} aria-current={actif ? 'step' : undefined} style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.9rem', borderRadius: '12px',
              border: `1px solid ${actif ? 'var(--primary-500)' : 'var(--border-subtle)'}`, background: actif ? 'var(--primary-glow)' : 'var(--bg-surface)',
              color: actif ? 'var(--primary-500)' : 'var(--text-secondary)',
            }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: fait ? 'var(--accent-emerald)' : actif ? 'var(--primary-500)' : 'var(--bg-surface-elevated)', color: fait || actif ? '#fff' : 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 800,
              }}>{fait ? <CheckCircle2 size={16} /> : num}</span>
              <span style={{ fontSize: '0.86rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Icone size={14} /> {libelle}</span>
            </div>
          );
        })}
      </nav>

      {/* ÉTAPE 1 : FICHIER & PÉRIODE */}
      {step === 1 && (
        <div className="glass-panel" style={styles.carte}>
          <h2 style={styles.titreCarte}><UploadCloud size={18} style={{ color: 'var(--primary-500)' }} /> Fichier du bordereau et période</h2>
          <div
            role="button"
            tabIndex={0}
            onClick={() => champFichier.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') champFichier.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setGlisser(true); }}
            onDragLeave={() => setGlisser(false)}
            onDrop={(e) => { e.preventDefault(); setGlisser(false); choisirFichier(e.dataTransfer.files?.[0]); }}
            style={{
              border: `2px dashed ${glisser || fichier ? 'var(--primary-500)' : 'var(--border-medium)'}`, borderRadius: '14px', padding: '1.6rem 1rem',
              textAlign: 'center', cursor: 'pointer', background: glisser ? 'var(--primary-glow)' : 'var(--bg-surface-elevated)',
            }}
          >
            <FileSpreadsheet size={34} style={{ color: fichier ? 'var(--accent-emerald)' : 'var(--primary-500)' }} />
            <div style={{ fontWeight: 800, marginTop: '0.4rem', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
              {fichier ? fichier.name : 'Déposez le fichier GUCE ici ou cliquez pour le choisir'}
            </div>
            <div style={styles.aide}>
              {fichier ? `${(fichier.size / 1024).toFixed(0)} Ko` : 'Extraction GUCE ou « ressortie de prime facultés » : .xls ou .xlsx, 5 Mo au plus, 29 colonnes GUCE'}
            </div>
            <input ref={champFichier} type="file" accept=".xls,.xlsx" hidden onChange={(e) => choisirFichier(e.target.files?.[0])} />
          </div>

          <div style={styles.sousTitre}>Période du bordereau</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={periodeDuFichier} onChange={(e) => setPeriodeDuFichier(e.target.checked)} style={{ width: 17, height: 17, accentColor: 'var(--primary-500)' }} />
            Reprendre la période indiquée dans le titre du fichier (« Période du … au … »)
          </label>
          {!periodeDuFichier && (
            <div style={{ ...styles.grille, marginTop: '0.9rem' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Mois</label>
                <input type="month" className="form-control" value={mois} onChange={(e) => setMois(e.target.value)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Bordereau</label>
                <select className="form-control" value={quinzaine} onChange={(e) => setQuinzaine(e.target.value)}>
                  {QUINZAINES.map((q) => <option key={q.id} value={q.id}>{q.libelle}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Période retenue</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minHeight: '2.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  <CalendarRange size={17} style={{ color: 'var(--primary-500)' }} /> du {dateFr(debutManuel)} au {dateFr(finManuel)}
                </div>
              </div>
            </div>
          )}

          {erreurAnalyse && <div style={{ marginTop: '1rem' }}><Alerte couleur="var(--accent-rose)" icone={XCircle}><strong>Fichier refusé.</strong> {erreurAnalyse}</Alerte></div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-primary" disabled={!fichier || analyseEnCours} onClick={() => lancerAnalyse(correspondances, { premiere: true })} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              {analyseEnCours ? <Loader2 size={16} className="spin" /> : <FileCheck size={16} />} Analyser le bordereau
            </button>
          </div>
        </div>
      )}

      {/* ÉTAPE 2 : CONTRÔLE */}
      {step === 2 && analyse && (
        <div className="glass-panel" style={styles.carte}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ ...styles.titreCarte, marginBottom: '0.3rem' }}><FileCheck size={18} style={{ color: 'var(--primary-500)' }} /> Contrôle du bordereau</h2>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {analyse.Titre || fichier?.name}<br />
                Période : <strong>du {dateFr(analyse.DebutPeriode)} au {dateFr(analyse.FinPeriode)}</strong>
                {analyse.PeriodeFichier && ` (titre du fichier : du ${dateFr(analyse.PeriodeFichier[0])} au ${dateFr(analyse.PeriodeFichier[1])})`}
              </div>
            </div>
            <span style={styles.pastille(analyse.Importable ? 'var(--accent-emerald)' : 'var(--accent-rose)')}>
              {analyse.Importable ? <><CheckCircle2 size={13} /> Prêt à importer</> : <><XCircle size={13} /> Import impossible en l'état</>}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '1rem' }}>
            {analyseEnCours && <Alerte couleur="var(--primary-500)" icone={Loader2}>Nouvelle analyse en cours…</Alerte>}
            {analyse.ErreursPeriode.map((e) => <Alerte key={e} couleur="var(--accent-rose)" icone={XCircle}>{e}</Alerte>)}
            {analyse.Avertissements.map((e) => <Alerte key={e} couleur="var(--accent-amber)">{e}</Alerte>)}
            {analyse.LignesIgnorees > 0 && <Alerte couleur="var(--border-medium)" icone={Info}>{analyse.LignesIgnorees} ligne(s) sans n° de requête ignorée(s) (lignes de total, lignes vides).</Alerte>}
          </div>

          {souscripteursAChoisir.length > 0 && (
            <>
              <div style={styles.sousTitre}><Users size={13} style={{ verticalAlign: '-2px' }} /> Client du souscripteur</div>
              {souscripteursAChoisir.map((s) => {
                const options = [...s.Precedents, ...s.Candidats].filter((c, i, liste) => liste.findIndex((x) => x.IdClient === c.IdClient) === i);
                const precedent = new Set(s.Precedents.map((p) => p.IdClient));
                return (
                  <div key={s.NomFichier} style={{ ...styles.tuile(s.IdClient ? 'var(--accent-emerald)' : 'var(--accent-amber)'), marginBottom: '0.6rem' }}>
                    <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{s.Souscripteur}</div>
                    <div style={styles.aide}>
                      {s.Statut === 'AMBIGU' && 'Plusieurs clients ressemblent à ce souscripteur : choisissez le bon.'}
                      {s.Statut === 'INTROUVABLE' && 'Aucun client ne correspond : créez-le dans la Clientèle, ou choisissez-le s\'il apparaît ci-dessous.'}
                      {s.Statut === 'CHOISI' && 'Client choisi pour cet import.'}
                    </div>
                    <select className="form-control" style={{ marginTop: '0.5rem', maxWidth: 560 }} value={s.IdClient || ''} disabled={analyseEnCours}
                      onChange={(e) => choisirClient(s.NomFichier, e.target.value)}>
                      <option value="">— Choisir le client —</option>
                      {options.map((c) => (
                        <option key={c.IdClient} value={c.IdClient}>
                          {c.Nom} (n° {c.IdClient}){precedent.has(c.IdClient) ? ' — retenu lors des imports précédents' : ''}{c.Score ? ` — ressemblance ${c.Score} %` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </>
          )}

          <div style={styles.sousTitre}>Synthèse des lignes</div>
          <div style={styles.tuiles}>
            <Tuile libelle="Certificats" valeur={t.Certificats} />
            <Tuile libelle="Valides" valeur={t.Valides} couleur="var(--accent-emerald)" />
            <Tuile libelle="En erreur" valeur={t.EnErreur} couleur={t.EnErreur ? 'var(--accent-rose)' : undefined} />
            <Tuile libelle="Avertissements" valeur={t.AvecAvertissement} couleur={t.AvecAvertissement ? 'var(--accent-amber)' : undefined} />
            <Tuile libelle="Doublons" valeur={t.Doublons} />
            <Tuile libelle="Déjà en base" valeur={t.DejaEnBase} />
          </div>

          <div style={styles.sousTitre}>Contrats qui seront générés</div>
          {analyse.Contrats.length
            ? <TableauContrats contrats={analyse.Contrats} prevision />
            : <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Aucun contrat tant que le client du souscripteur n'est pas identifié.</p>}

          <div style={styles.sousTitre}>Totaux du bordereau</div>
          <div style={styles.tuiles}>
            <Tuile libelle="Valeur assurée" valeur={`${fcfa(t.ValeurAssurance)} F`} />
            <Tuile libelle="Prime nette" valeur={`${fcfa(t.PrimeNette)} F`} />
            <Tuile libelle="Accessoires" valeur={`${fcfa(t.Accessoire)} F`} />
            <Tuile libelle="Taxe" valeur={`${fcfa(t.Taxe)} F`} />
            <Tuile libelle="Prime totale" valeur={`${fcfa(t.PrimeTtc)} F`} />
            <Tuile libelle={`Part AFS-CI (500 F × ${t.Certificats})`} valeur={`- ${fcfa(t.AccessoireClient)} F`} />
            <Tuile libelle="Total général" valeur={`${fcfa(t.TotalGeneral)} F`} couleur="var(--primary-500)" fort />
          </div>

          <div style={{ ...styles.sousTitre, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span>Lignes du fichier</span>
            <span style={{ display: 'flex', gap: '0.35rem', textTransform: 'none', letterSpacing: 0 }}>
              {[['TOUTES', `Toutes (${t.Certificats})`], ['ERREURS', `Erreurs (${t.EnErreur})`], ['AVERTISSEMENTS', `Avertissements (${t.AvecAvertissement})`]].map(([id, libelle]) => (
                <button key={id} type="button" className={`btn ${filtreLignes === id ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem' }} onClick={() => setFiltreLignes(id)}>{libelle}</button>
              ))}
            </span>
          </div>
          <div style={{ overflow: 'auto', maxHeight: '460px', border: '1px solid var(--border-subtle)', borderRadius: '10px' }}>
            <table style={styles.tableau}>
              <thead>
                <tr>
                  {['Ligne', 'N° requête', 'Certificat', 'Assuré', 'Transport / voyage'].map((l) => <th key={l} style={styles.th}>{l}</th>)}
                  {['Valeur', 'P. nette', 'P. totale'].map((l) => <th key={l} style={{ ...styles.th, textAlign: 'right' }}>{l}</th>)}
                  <th style={styles.th}>Contrôle</th>
                </tr>
              </thead>
              <tbody>
                {lignesFiltrees.map((l) => (
                  <tr key={`${l.Ligne}-${l.NumeroRequete}`} style={{ background: l.Erreurs.length ? 'rgba(244, 63, 94, 0.06)' : undefined }}>
                    <td style={{ ...styles.td, color: 'var(--text-muted)' }}>{l.Ligne}</td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap', fontWeight: 600 }}>{l.NumeroRequete}<div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{dateFr(l.DateRequete)}</div></td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{l.ReferenceCertificat}<div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{dateFr(l.DateCertificat)}</div></td>
                    <td style={styles.td}>{l.Assure}<div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{l.DescriptionCommerciale}</div></td>
                    <td style={styles.td}>{l.MoyenTransport}<div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{l.Voyage}</div></td>
                    <td style={{ ...styles.td, ...styles.num }}>{fcfa(l.ValeurAssurance)}</td>
                    <td style={{ ...styles.td, ...styles.num }}>{fcfa(l.PrimeNette)}</td>
                    <td style={{ ...styles.td, ...styles.num, fontWeight: 700 }}>{fcfa(l.PrimeTtc)}</td>
                    <td style={{ ...styles.td, minWidth: 220 }}>
                      {!l.Erreurs.length && !l.Avertissements.length && <span style={styles.pastille('var(--accent-emerald)')}><CheckCircle2 size={12} /> Valide</span>}
                      {l.Erreurs.map((e) => <div key={e} style={{ color: 'var(--accent-rose)', fontSize: '0.75rem', fontWeight: 600 }}>✕ {e}</div>)}
                      {l.Avertissements.map((e) => <div key={e} style={{ color: 'var(--accent-amber)', fontSize: '0.75rem' }}>⚠ {e}</div>)}
                    </td>
                  </tr>
                ))}
                {!lignesFiltrees.length && <tr><td colSpan={9} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-muted)' }}>Aucune ligne</td></tr>}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <ChevronLeft size={16} /> Fichier & période
            </button>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" disabled={analyseEnCours} onClick={() => lancerAnalyse()} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <RefreshCw size={15} className={analyseEnCours ? 'spin' : undefined} /> Relancer l'analyse
              </button>
              <button type="button" className="btn btn-primary" disabled={!analyse.Importable || analyseEnCours || importEnCours} onClick={() => setConfirmation(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 800 }}>
                {importEnCours ? <Loader2 size={16} className="spin" /> : <UploadCloud size={16} />} Importer le bordereau
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ÉTAPE 3 : RÉSUMÉ */}
      {step === 3 && resultat && (
        <div className="glass-panel" style={styles.carte}>
          <h2 style={styles.titreCarte}><CheckCircle2 size={18} style={{ color: 'var(--accent-emerald)' }} /> {resultat.Message}</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0 }}>
            Bordereau du <strong>{dateFr(resultat.DebutPeriode)}</strong> au <strong>{dateFr(resultat.FinPeriode)}</strong>.
          </p>
          <div style={styles.tuiles}>
            <Tuile libelle="Lignes du fichier" valeur={resultat.Totaux.Certificats + resultat.LignesIgnorees} />
            <Tuile libelle="Certificats importés" valeur={resultat.Totaux.Certificats} couleur="var(--accent-emerald)" />
            <Tuile libelle="Lignes rejetées" valeur={0} />
            <Tuile libelle="Lignes ignorées" valeur={resultat.LignesIgnorees} />
            <Tuile libelle="Doublons" valeur={resultat.Totaux.Doublons} />
            <Tuile libelle="Total général" valeur={`${fcfa(resultat.Totaux.TotalGeneral)} F`} couleur="var(--primary-500)" fort />
          </div>
          <div style={styles.sousTitre}>Contrats générés</div>
          <TableauContrats contrats={resultat.Contrats} />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => printBordereauTransport({ idimportation: resultat.IdImportation })} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Printer size={15} /> Imprimer le bordereau</button>
            <button type="button" className="btn btn-secondary" onClick={() => transportApi.telechargerBordereauExcel(resultat.IdImportation)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Download size={15} /> Exporter Excel</button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/user/contracts')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Eye size={15} /> Voir les contrats</button>
            <button type="button" className="btn btn-primary" onClick={recommencer} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><UploadCloud size={15} /> Importer un autre bordereau</button>
          </div>
        </div>
      )}

      {/* BORDEREAUX IMPORTÉS */}
      <div className="glass-panel" style={styles.carte}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          <h2 style={{ ...styles.titreCarte, margin: 0 }}><FileSpreadsheet size={18} style={{ color: 'var(--primary-500)' }} /> Bordereaux importés</h2>
          <button type="button" className="btn btn-secondary" onClick={chargerBordereaux} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}><RefreshCw size={14} /> Actualiser</button>
        </div>
        {erreurBordereaux && <Alerte couleur="var(--accent-rose)" icone={XCircle}>{erreurBordereaux}</Alerte>}
        {!bordereaux && <p style={{ color: 'var(--text-muted)', display: 'flex', gap: '0.4rem', alignItems: 'center' }}><Loader2 size={16} className="spin" /> Chargement…</p>}
        {bordereaux && !bordereaux.length && !erreurBordereaux && <p style={{ color: 'var(--text-muted)' }}>Aucun bordereau importé.</p>}
        {bordereaux && bordereaux.length > 0 && ecranEtroit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {bordereaux.map((b) => {
              const nomExport = `RESSORTIE DE PRIME FACULTES DU ${dateFr(b.DebutPeriode).replace(/\//g, '-')} AU ${dateFr(b.FinPeriode).replace(/\//g, '-')}.xlsx`;
              return (
                <div key={b.IdImportation} style={{ ...styles.tuile(), display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{dateFr(b.DebutPeriode)} → {dateFr(b.FinPeriode)}</strong>
                    <span style={styles.pastille(b.Succes ? 'var(--accent-emerald)' : 'var(--accent-rose)')}>{b.Succes ? 'Réussi' : 'Échec'}</span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>{b.Souscripteurs || b.Clients || '—'}</div>
                  {b.Clients && b.Clients !== b.Souscripteurs && <div style={{ color: 'var(--accent-amber)', fontSize: '0.72rem' }}>Client rattaché : {b.Clients}</div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span>{b.Certificats} certificats</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{fcfa(b.TotalGeneral)} F</strong>
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    {b.Contrats.length ? b.Contrats.map((c) => `${c.NumeroPolice || c.NumeroDevis}${c.NumeroQuittance ? ` • quittance ${c.NumeroQuittance}` : ''}`).join(' ; ') : 'Aucun contrat rattaché'}
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.2rem' }}>
                    <button type="button" className="btn btn-secondary" style={{ flex: 1, padding: '0.35rem' }} title="Certificats du bordereau"
                      onClick={() => setCertificatsOuverts({ filtres: { idimportation: b.IdImportation }, titre: `Bordereau du ${dateFr(b.DebutPeriode)} au ${dateFr(b.FinPeriode)}`, idImportation: b.IdImportation, nomExport })}><Eye size={15} /></button>
                    <button type="button" className="btn btn-secondary" style={{ flex: 1, padding: '0.35rem' }} title="Imprimer le bordereau" onClick={() => printBordereauTransport({ idimportation: b.IdImportation })}><Printer size={15} /></button>
                    <button type="button" className="btn btn-secondary" style={{ flex: 1, padding: '0.35rem' }} title="Exporter le bordereau (Excel)"
                      onClick={() => transportApi.telechargerBordereauExcel(b.IdImportation, nomExport).catch((err) => toastError(`Export impossible : ${messageErreurApi(err)}`))}><Download size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {bordereaux && bordereaux.length > 0 && !ecranEtroit && (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.tableau}>
              <thead>
                <tr>
                  {['Période', 'Souscripteur', 'Contrat'].map((l) => <th key={l} style={styles.th}>{l}</th>)}
                  {['Certificats', 'Prime totale', 'Total général'].map((l) => <th key={l} style={{ ...styles.th, textAlign: 'right' }}>{l}</th>)}
                  <th style={styles.th}>Import</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bordereaux.map((b) => {
                  const nomExport = `RESSORTIE DE PRIME FACULTES DU ${dateFr(b.DebutPeriode).replace(/\//g, '-')} AU ${dateFr(b.FinPeriode).replace(/\//g, '-')}.xlsx`;
                  return (
                    <tr key={b.IdImportation}>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap', fontWeight: 700 }}>{dateFr(b.DebutPeriode)} → {dateFr(b.FinPeriode)}</td>
                      <td style={styles.td}>
                        {b.Souscripteurs || b.Clients || '—'}
                        {b.Clients && b.Clients !== b.Souscripteurs && (
                          <div style={{ color: 'var(--accent-amber)', fontSize: '0.72rem' }} title="Client rattaché aux certificats de ce bordereau">Client rattaché : {b.Clients}</div>
                        )}
                      </td>
                      <td style={styles.td}>
                        {b.Contrats.length ? b.Contrats.map((c) => (
                          <div key={c.IdDevis} style={{ whiteSpace: 'nowrap' }}>{c.NumeroPolice || c.NumeroDevis}<span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{c.NumeroQuittance ? ` • quittance ${c.NumeroQuittance}` : ''}</span></div>
                        )) : <span style={{ color: 'var(--text-muted)' }}>Aucun</span>}
                      </td>
                      <td style={{ ...styles.td, ...styles.num }}>{b.Certificats}</td>
                      <td style={{ ...styles.td, ...styles.num }}>{fcfa(b.PrimeTtc)}</td>
                      <td style={{ ...styles.td, ...styles.num, fontWeight: 800 }}>{fcfa(b.TotalGeneral)}</td>
                      <td style={styles.td}>
                        <span style={styles.pastille(b.Succes ? 'var(--accent-emerald)' : 'var(--accent-rose)')}>{b.Succes ? 'Réussi' : 'Échec'}</span>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.2rem' }}>{dateFr(b.DateImport)}{b.Operateur ? ` • ${b.Operateur}` : ''}</div>
                      </td>
                      <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn btn-secondary" title="Certificats du bordereau" style={{ padding: '0.3rem 0.5rem', marginRight: 4 }}
                          onClick={() => setCertificatsOuverts({ filtres: { idimportation: b.IdImportation }, titre: `Bordereau du ${dateFr(b.DebutPeriode)} au ${dateFr(b.FinPeriode)}`, idImportation: b.IdImportation, nomExport })}><Eye size={14} /></button>
                        <button type="button" className="btn btn-secondary" title="Imprimer le bordereau" style={{ padding: '0.3rem 0.5rem', marginRight: 4 }} onClick={() => printBordereauTransport({ idimportation: b.IdImportation })}><Printer size={14} /></button>
                        <button type="button" className="btn btn-secondary" title="Exporter le bordereau (Excel, 29 colonnes GUCE)" style={{ padding: '0.3rem 0.5rem' }}
                          onClick={() => transportApi.telechargerBordereauExcel(b.IdImportation, nomExport).catch((err) => toastError(`Export impossible : ${messageErreurApi(err)}`))}><Download size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p style={styles.aide}>
          Les affaires Transport hors GUCE ne sont pas saisies ici : le compte rendu OREOLE du 09/09/2026 en fait un développement futur, à décider avec la Direction Générale.
        </p>
      </div>

      {confirmation && analyse && (
        <Modal isOpen onClose={() => setConfirmation(false)} title="Importer le bordereau GUCE" size="medium">
          <p style={{ marginTop: 0, color: 'var(--text-primary)' }}>
            Période du <strong>{dateFr(analyse.DebutPeriode)}</strong> au <strong>{dateFr(analyse.FinPeriode)}</strong> : {t.Certificats} certificats,
            {' '}{analyse.Contrats.length} contrat(s) pour un total général de <strong>{fcfa(t.TotalGeneral)} F</strong>.
          </p>
          <Alerte couleur="var(--accent-amber)">
            L'import enregistre les certificats, crée les contrats et leurs quittances. Une fois fait, le bordereau de cette période ne peut plus être réimporté.
            En cas d'erreur, rien n'est enregistré.
          </Alerte>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmation(false)}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={importer} style={{ fontWeight: 800 }}>Confirmer l'import</button>
          </div>
        </Modal>
      )}

      {certificatsOuverts && (
        <CertificatsTransportModal
          filtres={certificatsOuverts.filtres}
          titre={certificatsOuverts.titre}
          idImportation={certificatsOuverts.idImportation}
          nomExport={certificatsOuverts.nomExport}
          onClose={() => setCertificatsOuverts(null)}
        />
      )}
    </div>
  );
};

export default NewTransportQuotePage;
