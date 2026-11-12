import React, { useEffect, useState } from 'react';
import { ScrollText, Search, Loader2, Download, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { EnTeteParametrage } from '../../../components/admin/EnTeteParametrage';
import { Modal } from '../../../components/common/Modal';
import { securiteApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { downloadBlob } from '../../../utils/exportUtils';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

// Administration > Journal d'audit : lecture seule (la table refuse toute modification ou suppression).
// API : GET /api/securite/journal/ (autorisations/views_securite.py)
const dateHeure = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' }) : '-');
const COULEURS = { SUCCES: 'var(--accent-emerald)', ECHEC: 'var(--accent-rose)', REFUS: 'var(--accent-amber)', CONFORME: 'var(--accent-emerald)' };
const FILTRES_VIDES = { q: '', utilisateur: '', module: '', action: '', resultat: '', du: '', au: '' };

// Valeurs avant / après côte à côte, en ne gardant que les champs qui ont changé quand c'est possible
const Comparaison = ({ avant, apres }) => {
  const simple = (v) => v === null || typeof v !== 'object';
  const plats = avant && apres && typeof avant === 'object' && typeof apres === 'object' && !Array.isArray(avant) && !Array.isArray(apres);
  if (plats) {
    const cles = [...new Set([...Object.keys(avant), ...Object.keys(apres)])];
    const changees = cles.filter((k) => JSON.stringify(avant[k]) !== JSON.stringify(apres[k]));
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}><th style={{ padding: '0.3rem' }}>Champ</th><th style={{ padding: '0.3rem' }}>Avant</th><th style={{ padding: '0.3rem' }}>Après</th></tr></thead>
          <tbody>
            {(changees.length ? changees : cles).map((k) => (
              <tr key={k} style={{ borderTop: '1px solid var(--border-subtle)', verticalAlign: 'top' }}>
                <td style={{ padding: '0.3rem', fontWeight: 700 }}>{k}</td>
                <td style={{ padding: '0.3rem', color: 'var(--accent-rose)' }}>{simple(avant[k]) ? String(avant[k] ?? '-') : <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(avant[k], null, 1)}</pre>}</td>
                <td style={{ padding: '0.3rem', color: 'var(--accent-emerald)' }}>{simple(apres[k]) ? String(apres[k] ?? '-') : <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(apres[k], null, 1)}</pre>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {changees.length > 0 && changees.length < cles.length && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>{cles.length - changees.length} champ(s) inchangé(s) masqué(s).</div>}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '0.6rem' }}>
      {[['Avant', avant, 'var(--accent-rose)'], ['Après', apres, 'var(--accent-emerald)']].map(([titre, valeur, couleur]) => (
        <div key={titre}>
          <div style={{ fontSize: '0.72rem', fontWeight: 800, color: couleur, marginBottom: '0.25rem' }}>{titre}</div>
          <pre style={{ margin: 0, maxHeight: 280, overflow: 'auto', fontSize: '0.74rem', padding: '0.5rem', borderRadius: 8, background: 'var(--bg-surface-elevated)', whiteSpace: 'pre-wrap' }}>{valeur === null || valeur === undefined ? '-' : JSON.stringify(valeur, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
};

export const JournalAuditPage = () => {
  const { peut } = useAuth();
  const { error: toastError } = useToast();
  const [filtres, setFiltres] = useState(FILTRES_VIDES);
  const [page, setPage] = useState(1);
  const [donnees, setDonnees] = useState({ total: 0, resultats: [], taille_page: 50 });
  const [options, setOptions] = useState({ modules: [], actions: [], utilisateurs: [] });
  const [chargement, setChargement] = useState(true);
  const [detail, setDetail] = useState(null);
  const [export_, setExport] = useState(false);

  useEffect(() => { securiteApi.filtresJournal().then(setOptions).catch(() => {}); }, []);
  useEffect(() => {
    let actif = true;
    setChargement(true);
    const minuterie = setTimeout(() => {
      const params = Object.fromEntries(Object.entries(filtres).filter(([, v]) => v));
      securiteApi.journal({ ...params, page })
        .then((d) => { if (actif) setDonnees(d); })
        .catch((err) => { if (actif) toastError(`Journal non chargé : ${messageErreurApi(err)}`); })
        .finally(() => { if (actif) setChargement(false); });
    }, 300);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [filtres, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const changer = (cle, valeur) => { setFiltres((f) => ({ ...f, [cle]: valeur })); setPage(1); };
  const pages = Math.max(1, Math.ceil(donnees.total / (donnees.taille_page || 50)));

  const exporter = async () => {
    setExport(true);
    try {
      const params = Object.fromEntries(Object.entries(filtres).filter(([, v]) => v));
      const blob = await securiteApi.exporterJournal(params);
      downloadBlob(blob, `journal_audit_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      toastError(`Export impossible : ${messageErreurApi(err)}`);
    } finally {
      setExport(false);
    }
  };

  const ouvrir = async (ligne) => {
    try {
      setDetail(await securiteApi.entreeJournal(ligne.id));
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <EnTeteParametrage
        icone={ScrollText}
        titre="Journal d'audit"
        description="Toutes les opérations d'écriture de LE PHARE, les connexions et les refus : qui, quand, quoi, sur quel objet, avec quel résultat et quelles valeurs avant / après."
        usage="Lecture seule pour tout le monde : la base refuse la modification ou la suppression d'une ligne, et les actions des administrateurs y figurent comme les autres."
        actions={peut('audit.export') && (
          <button type="button" className="btn btn-secondary" disabled={export_} onClick={exporter} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {export_ ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Exporter (CSV)
          </button>
        )}
      />

      <div className="glass-panel" style={{ padding: '0.9rem 1rem', marginBottom: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '0.6rem' }}>
        <div style={{ position: 'relative', gridColumn: 'span 2' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-control" placeholder="Description, auteur, n° d'objet, motif…" value={filtres.q} onChange={(e) => changer('q', e.target.value)} style={{ paddingLeft: '2.1rem' }} />
        </div>
        <select className="form-control" value={filtres.utilisateur} onChange={(e) => changer('utilisateur', e.target.value)}>
          <option value="">Tous les utilisateurs</option>
          {options.utilisateurs.map((u) => <option key={u.id} value={u.id}>{u.libelle}</option>)}
        </select>
        <select className="form-control" value={filtres.module} onChange={(e) => changer('module', e.target.value)}>
          <option value="">Tous les modules</option>
          {options.modules.map((m) => <option key={m.code} value={m.code}>{m.libelle}</option>)}
        </select>
        <select className="form-control" value={filtres.action} onChange={(e) => changer('action', e.target.value)}>
          <option value="">Toutes les actions</option>
          {options.actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="form-control" value={filtres.resultat} onChange={(e) => changer('resultat', e.target.value)}>
          <option value="">Tous les résultats</option>
          <option value="SUCCES">Succès</option>
          <option value="ECHEC">Échec</option>
          <option value="REFUS">Refus</option>
        </select>
        <input type="date" className="form-control" title="Du" value={filtres.du} onChange={(e) => changer('du', e.target.value)} />
        <input type="date" className="form-control" title="Au" value={filtres.au} onChange={(e) => changer('au', e.target.value)} />
      </div>

      <div className="glass-panel" style={{ padding: '0.5rem 1rem 1rem', overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <span>{donnees.total.toLocaleString('fr-FR')} opération(s) {chargement && <Loader2 size={13} className="spin" />}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={{ padding: '0.25rem 0.45rem' }}><ChevronLeft size={14} /></button>
            Page {page} / {pages}
            <button type="button" className="btn btn-secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} style={{ padding: '0.25rem 0.45rem' }}><ChevronRight size={14} /></button>
          </span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
              <th style={{ padding: '0.5rem 0.4rem', width: 140 }}>Date</th>
              <th style={{ padding: '0.5rem 0.4rem' }}>Utilisateur</th>
              <th style={{ padding: '0.5rem 0.4rem' }}>Action</th>
              <th style={{ padding: '0.5rem 0.4rem' }}>Objet</th>
              <th style={{ padding: '0.5rem 0.4rem', width: 80 }}>Résultat</th>
              <th style={{ padding: '0.5rem 0.4rem', width: 110 }}>Adresse IP</th>
            </tr>
          </thead>
          <tbody>
            {donnees.resultats.map((e) => (
              <tr key={e.id} onClick={() => ouvrir(e)} style={{ borderTop: '1px solid var(--border-subtle)', cursor: 'pointer', verticalAlign: 'top' }}>
                <td style={{ padding: '0.45rem 0.4rem', fontSize: '0.77rem', whiteSpace: 'nowrap' }}>{dateHeure(e.date)}</td>
                <td style={{ padding: '0.45rem 0.4rem', fontSize: '0.8rem' }}>{e.auteur}</td>
                <td style={{ padding: '0.45rem 0.4rem', fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 600 }}>{e.description}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{e.module}{e.action ? ` • ${e.action}` : ''}{e.motif ? ` • motif : ${e.motif}` : ''}{e.avec_valeurs ? ' • avant / après' : ''}</div>
                </td>
                <td style={{ padding: '0.45rem 0.4rem', fontSize: '0.78rem' }}>{e.objet_type}{e.objet_id ? ` ${e.objet_id}` : ''}</td>
                <td style={{ padding: '0.45rem 0.4rem', fontSize: '0.75rem', fontWeight: 800, color: COULEURS[e.resultat] || 'var(--text-secondary)' }}>{e.resultat}</td>
                <td style={{ padding: '0.45rem 0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{e.adresse_ip || '-'}</td>
              </tr>
            ))}
            {!chargement && !donnees.resultats.length && <tr><td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>Aucune opération ne correspond aux filtres.</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={Boolean(detail)} onClose={() => setDetail(null)} title="Détail de l'opération" subtitle={detail ? dateHeure(detail.date) : ''} size="large">
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', fontSize: '0.84rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0.4rem 1rem' }}>
              <div><strong>Utilisateur :</strong> {detail.auteur}</div>
              <div><strong>Résultat :</strong> <span style={{ color: COULEURS[detail.resultat], fontWeight: 800 }}>{detail.resultat}</span>{detail.statut_http ? ` (HTTP ${detail.statut_http})` : ''}</div>
              <div><strong>Module :</strong> {detail.module}</div>
              <div><strong>Action :</strong> {detail.action || '-'}</div>
              <div><strong>Objet :</strong> {detail.objet_type || '-'} {detail.objet_id}</div>
              <div><strong>Adresse IP :</strong> {detail.adresse_ip || '-'}</div>
              <div style={{ gridColumn: '1 / -1' }}><strong>Description :</strong> {detail.description}</div>
              {detail.motif && <div style={{ gridColumn: '1 / -1' }}><strong>Motif :</strong> {detail.motif}</div>}
              {detail.chemin && <div style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{detail.methode} {detail.chemin}</div>}
            </div>
            {(detail.valeur_avant || detail.valeur_apres) && (
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>Valeurs avant / après</div>
                <Comparaison avant={detail.valeur_avant} apres={detail.valeur_apres} />
              </div>
            )}
            {detail.details && Object.keys(detail.details).length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Données envoyées (sans mot de passe)</summary>
                <pre style={{ margin: '0.4rem 0 0', maxHeight: 260, overflow: 'auto', fontSize: '0.72rem', padding: '0.5rem', borderRadius: 8, background: 'var(--bg-surface-elevated)', whiteSpace: 'pre-wrap' }}>{JSON.stringify(detail.details, null, 2)}</pre>
              </details>
            )}
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              <Lock size={12} /> Ligne n° {detail.id}, non modifiable.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default JournalAuditPage;
