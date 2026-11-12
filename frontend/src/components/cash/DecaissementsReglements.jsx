import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Loader2, Printer, RotateCcw, Search } from 'lucide-react';
import { cashApi } from '../../api/endpoints';
import { useToast } from '../../context/ToastContext';
import { ouvrirApercuImpression } from '../../utils/apercuImpression';
import { aLeDroit } from '../../utils/droits';
import { printRecuEncaissement } from '../../utils/exportUtils';
import { Modal } from '../common/Modal';
import { StatusBadge } from '../common/StatusBadge';
import { ChampsReglement, champsReglementApi, natureMode, reglementVide } from './ChampsReglement';

/* =========================================================================
   Décaissement de tout règlement autre qu'un chèque du portefeuille : espèces, virement, paiement mobile, carte, traite, compensation.
   Le règlement est contre-passé (ses quittances redeviennent à encaisser), avec un motif et une date, puis se réencaisse comme un chèque
   impayé. Serveur : production/decaissements.py.
   ========================================================================= */
const fcfa = (v) => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} F`;
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const aujourdhui = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const versJjMmAaaa = (iso) => iso.split('-').reverse().join('-');
const PETIT = { padding: '0.3rem 0.55rem', fontSize: '0.75rem' };
const echapper = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const messageErreur = (err, defaut) => {
  const d = err?.response?.data;
  if (d?.erreur) return d.erreur;
  if (d?.detail) return d.detail;
  if (d && typeof d === 'object') {
    const premier = Object.values(d).flat(Infinity)[0];
    if (typeof premier === 'string') return premier;
  }
  return defaut;
};

// Bon d'annulation : pièce de caisse à faire signer, surtout quand des espèces sortent de la caisse
const imprimerBon = (d) => {
  const fenetre = ouvrirApercuImpression();
  if (!fenetre) return;
  const lignes = d.Quittances.map((q) => `<tr><td>${echapper(q.Numero)}</td><td>${echapper(q.Police)}</td><td>${echapper(q.Client)}</td><td class="d">${fcfa(q.Montant)}</td></tr>`).join('');
  fenetre.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bon d'annulation ${echapper(d.NumeroPiece)}</title>
    <style>body{font-family:Arial,sans-serif;color:#111;margin:24px;font-size:13px}h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:14px 0}
    th,td{border:1px solid #999;padding:6px 8px;text-align:left}th{background:#eee}.d{text-align:right}.grille{display:grid;grid-template-columns:180px 1fr;gap:4px 12px;margin-top:14px}
    .signatures{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:40px}.signatures div{border-top:1px solid #111;padding-top:6px;height:70px}</style></head><body>
    <h1>Bon d'annulation de règlement</h1><div>Pièce d'origine ${echapper(d.NumeroPiece)}, annulation n° ${d.IdDecaissement}</div>
    <div class="grille"><strong>Date de l'annulation</strong><span>${dateFr(d.Date)}</span><strong>Mode du règlement</strong><span>${echapper(d.Mode)}</span>
    <strong>Référence</strong><span>${echapper(d.Reference) || '-'}</span><strong>Client</strong><span>${echapper(d.Clients) || '-'}</span>
    <strong>Montant annulé</strong><span><strong>${fcfa(d.Montant)}</strong></span><strong>Motif</strong><span>${echapper(d.Motif)}</span>
    <strong>Enregistré par</strong><span>${echapper(d.Operateur)}</span></div>
    <table><thead><tr><th>Quittance</th><th>Police</th><th>Client</th><th class="d">Montant</th></tr></thead><tbody>${lignes}</tbody></table>
    <p>Les quittances ci-dessus sont de nouveau à encaisser.</p>
    <div class="signatures"><div>Le caissier</div><div>Le bénéficiaire ou le client</div></div></body></html>`);
  fenetre.document.close();
};

// ------------------------------------------------------------------ règlements décaissables
export const ReglementsDecaissables = ({ onDecaisse }) => {
  const { success, error: toastError } = useToast();
  const [filtres, setFiltres] = useState({ q: '', mode: '', du: '', au: '' });
  const [recherche, setRecherche] = useState('');
  const [donnees, setDonnees] = useState({ Reglements: [], Modes: [], Tronque: false });
  const [chargement, setChargement] = useState(true);
  const [decaissement, setDecaissement] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const peutDecaisser = aLeDroit('encaissements.cancel');

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setDonnees(await cashApi.getReglementsDecaissables(Object.fromEntries(Object.entries(filtres).filter(([, v]) => v))));
    } catch (err) {
      toastError(messageErreur(err, 'Règlements non lus.'));
    } finally {
      setChargement(false);
    }
  }, [filtres, toastError]);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { const m = setTimeout(() => setFiltres((f) => ({ ...f, q: recherche.trim() })), 350); return () => clearTimeout(m); }, [recherche]);

  const enregistrer = async (e) => {
    e.preventDefault();
    if (envoi) return;
    setEnvoi(true);
    try {
      const res = await cashApi.decaisserReglement(decaissement.reglement.IdEncaissement, { motif: decaissement.motif.trim(), date_decaissement: decaissement.date });
      success(res.data?.Message || 'Règlement annulé.');
      setDecaissement(null);
      charger();
      onDecaisse?.();
    } catch (err) {
      toastError(messageErreur(err, "L'annulation n'a pas pu être enregistrée."));
    } finally {
      setEnvoi(false);
    }
  };

  const champ = (cle) => (e) => setFiltres((f) => ({ ...f, [cle]: e.target.value }));
  return (
    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
        Espèces, virement, paiement mobile, carte, traite ou compensation : un règlement s'annule avec son motif (fonds rendus au client, virement rejeté,
        erreur de caisse…). Son encaissement est contre-passé et ses quittances redeviennent à encaisser. Un chèque du portefeuille se traite depuis l'onglet Chèques
        (bouton Annuler) ; un règlement déjà reversé à la compagnie ne s'annule pas.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 240px' }}>
          <label className="form-label" htmlFor="dec-recherche">Rechercher</label>
          <input id="dec-recherche" className="form-control" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Pièce, référence, quittance, police, client ou montant" />
        </div>
        <div>
          <label className="form-label" htmlFor="dec-mode">Mode</label>
          <select id="dec-mode" className="form-control" value={filtres.mode} onChange={champ('mode')}>
            <option value="">Tous les modes</option>
            {donnees.Modes.map((m) => <option key={m.Id} value={m.Id}>{m.Libelle}</option>)}
          </select>
        </div>
        <div><label className="form-label" htmlFor="dec-du">Du</label><input id="dec-du" type="date" className="form-control" value={filtres.du} onChange={champ('du')} /></div>
        <div><label className="form-label" htmlFor="dec-au">Au</label><input id="dec-au" type="date" className="form-control" value={filtres.au} onChange={champ('au')} /></div>
      </div>
      <div className="table-wrapper">
        <table className="data-table" style={{ fontSize: '0.83rem' }}>
          <thead><tr><th>Date</th><th>Pièce</th><th>Mode</th><th>Référence</th><th>Client</th><th>Quittance(s)</th><th style={{ textAlign: 'right' }}>Montant</th><th>État</th><th>Actions</th></tr></thead>
          <tbody>
            {donnees.Reglements.map((r) => (
              <tr key={r.IdEncaissement}>
                <td>{dateFr(r.Date)}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{r.NumeroPiece}</td>
                <td>{r.Mode}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{r.Reference || '-'}</td>
                <td>{r.Clients || '-'}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>{r.Quittances || '-'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fcfa(r.Montant)}</td>
                <td>{r.Reverse ? <StatusBadge label="Reversé" color="slate" /> : <StatusBadge label="Encaissé" color="emerald" />}</td>
                <td>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    <Link to={`/user/cash/recherche?q=${encodeURIComponent(r.Reference || r.NumeroPiece)}`} className="btn btn-secondary" style={PETIT} title="Voir les polices et quittances payées par ce règlement">
                      <Search size={13} /> Utilisation
                    </Link>
                    {peutDecaisser && (
                      <button type="button" className="btn btn-secondary" style={{ ...PETIT, color: r.Decaissable ? '#f87171' : undefined }} disabled={!r.Decaissable}
                        title={r.Decaissable ? 'Annule cet encaissement : ses quittances redeviennent à encaisser' : r.Refus}
                        onClick={() => setDecaissement({ reglement: r, motif: '', date: aujourdhui() })}>
                        <Ban size={13} /> Annuler
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!donnees.Reglements.length && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.4rem' }}>
                {chargement ? <><Loader2 size={14} className="spin" /> Lecture…</> : 'Aucun règlement.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {donnees.Tronque && <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Seuls les 300 règlements les plus récents sont affichés : précisez la recherche ou la période.</p>}

      <Modal isOpen={Boolean(decaissement)} onClose={() => setDecaissement(null)} title="Annulation d'un règlement">
        {decaissement && (
          <form onSubmit={enregistrer}>
            <div style={{ padding: '0.85rem', borderRadius: 'var(--radius-md)', background: 'rgba(30, 41, 59, 0.6)', marginBottom: '1rem', fontSize: '0.85rem' }}>
              Règlement <strong>{decaissement.reglement.Mode.toLowerCase()}</strong> de <strong>{fcfa(decaissement.reglement.Montant)}</strong>,
              {' '}pièce {decaissement.reglement.NumeroPiece} du {dateFr(decaissement.reglement.Date)}
              {decaissement.reglement.Reference && <>, référence {decaissement.reglement.Reference}</>}.
              {' '}L'encaissement est annulé : les quittances {decaissement.reglement.Quittances || ''} redeviennent à encaisser.
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="dec-motif">Motif de l'annulation (* requis)</label>
              <textarea id="dec-motif" className="form-control" rows={3} required minLength={5} maxLength={230} value={decaissement.motif}
                placeholder="Ex. : espèces rendues au client, virement rejeté par la banque, erreur de caisse"
                onChange={(e) => setDecaissement((d) => ({ ...d, motif: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="dec-date">Date de l'annulation</label>
              <input id="dec-date" type="date" className="form-control" required value={decaissement.date} max={aujourdhui()} min={String(decaissement.reglement.Date).slice(0, 10)}
                onChange={(e) => setDecaissement((d) => ({ ...d, date: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setDecaissement(null)}>Fermer</button>
              <button type="submit" className="btn btn-primary" disabled={envoi || decaissement.motif.trim().length < 5}>{envoi ? 'Enregistrement…' : 'Annuler le règlement'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};

// ------------------------------------------------------------------ historique et réencaissement
export const HistoriqueDecaissements = ({ modes, banques, onBanqueCreee, version }) => {
  const { success, error: toastError } = useToast();
  const [statut, setStatut] = useState('');
  const [lignes, setLignes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [reencaissement, setReencaissement] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const peutEncaisser = aLeDroit('encaissements.create');

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setLignes((await cashApi.getDecaissements(statut ? { statut } : {})).Decaissements);
    } catch (err) {
      toastError(messageErreur(err, 'Annulations non lues.'));
    } finally {
      setChargement(false);
    }
  }, [statut, toastError]);
  useEffect(() => { charger(); }, [charger, version]);

  const ouvrir = (d) => {
    // Montant restant réparti sur les quittances du règlement d'origine, dans l'ordre, sans dépasser leur reste dû
    let aRepartir = d.ResteAReencaisser;
    const quittances = d.Quittances.map((q) => {
      const montant = Math.max(Math.min(q.Montant, q.ResteDu || q.Montant, aRepartir), 0);
      aRepartir -= montant;
      return { numero: q.Numero, client: q.Client, montant: String(Math.round(montant)) };
    });
    const especes = modes.find((m) => natureMode(m).especes);
    setReencaissement({ decaissement: d, quittances, references: '', reglement: { ...reglementVide(String(d.Clients || '').slice(0, 50)), idMode: String((especes || modes[0])?.idmodeencaissement || '') } });
  };
  const total = (reencaissement?.quittances || []).reduce((s, q) => s + (Number(q.montant) || 0), 0);

  const enregistrer = async (e) => {
    e.preventDefault();
    if (envoi || !reencaissement) return;
    const liste = reencaissement.quittances.filter((q) => Number(q.montant) > 0);
    if (!liste.length) {
      toastError('Indiquez le montant réencaissé sur au moins une quittance.');
      return;
    }
    const fenetre = ouvrirApercuImpression();
    if (fenetre) fenetre.document.write('<p style="font-family:Arial;padding:20px;">Enregistrement du réencaissement…</p>');
    setEnvoi(true);
    try {
      const mode = modes.find((m) => String(m.idmodeencaissement) === String(reencaissement.reglement.idMode));
      const res = await cashApi.collectPremium({
        ...champsReglementApi(reencaissement.reglement, mode),
        date_encaissement: versJjMmAaaa(aujourdhui()),
        montant_total: liste.reduce((s, q) => s + Number(q.montant), 0),
        liste_quittance: liste.map((q) => ({ numero_quittance: q.numero, montant_encaissement: Number(q.montant) })),
        reference_reencaissement: reencaissement.references.trim(),
        id_decaissement: reencaissement.decaissement.IdDecaissement,
      });
      success(res.data?.message || 'Réencaissement enregistré.');
      setReencaissement(null);
      charger();
      const [ligne] = await cashApi.getDetailsEncaissement(res.data?.id_encaissement);
      await printRecuEncaissement(ligne?.iddetailencaissement, fenetre);
    } catch (err) {
      if (fenetre) fenetre.close();
      toastError(messageErreur(err, "Le réencaissement n'a pas pu être enregistré."));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {[['', 'Tous'], ['A_REENCAISSER', 'À réencaisser'], ['REENCAISSE', 'Réencaissés']].map(([code, libelle]) => (
          <button key={code || 'tous'} type="button" className={`btn ${statut === code ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
            onClick={() => setStatut(code)}>{libelle}</button>
        ))}
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>Règlements annulés hors chèques ; les chèques annulés restent suivis dans l'onglet Chèques.</p>
      <div className="table-wrapper">
        <table className="data-table" style={{ fontSize: '0.83rem' }}>
          <thead><tr><th>Annulé le</th><th>Pièce</th><th>Mode</th><th>Client</th><th>Quittance(s)</th><th style={{ textAlign: 'right' }}>Montant</th><th style={{ textAlign: 'right' }}>Réencaissé</th><th>Statut</th><th>Motif</th><th>Actions</th></tr></thead>
          <tbody>
            {lignes.map((d) => (
              <tr key={d.IdDecaissement}>
                <td>{dateFr(d.Date)}<div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{d.Operateur}</div></td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{d.NumeroPiece}</td>
                <td>{d.Mode}{d.Reference && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{d.Reference}</div>}</td>
                <td>{d.Clients || '-'}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>{d.Quittances.map((q) => q.Numero).join(', ') || '-'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fcfa(d.Montant)}</td>
                <td style={{ textAlign: 'right' }}>{fcfa(d.Reencaisse)}</td>
                <td><StatusBadge label={d.LibelleStatut} color={{ REENCAISSE: 'amber', REPORTE: 'slate' }[d.Statut] || 'rose'} /></td>
                <td style={{ maxWidth: 260 }}>{d.Motif}</td>
                <td>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-secondary" style={PETIT} onClick={() => imprimerBon(d)} title="Bon d'annulation à faire signer"><Printer size={13} /> Bon</button>
                    {peutEncaisser && d.Statut === 'A_REENCAISSER' && (
                      <button type="button" className="btn btn-primary" style={PETIT} onClick={() => ouvrir(d)} title="Réencaisser les quittances de ce règlement"><RotateCcw size={13} /> Réencaisser</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!lignes.length && (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.4rem' }}>
                {chargement ? <><Loader2 size={14} className="spin" /> Lecture…</> : 'Aucune annulation.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={Boolean(reencaissement)} onClose={() => setReencaissement(null)} title="Réencaissement d'un règlement annulé" size="large">
        {reencaissement && (
          <form onSubmit={enregistrer}>
            <div style={{ padding: '0.85rem', borderRadius: 'var(--radius-md)', background: 'rgba(30, 41, 59, 0.6)', marginBottom: '1rem', fontSize: '0.85rem' }}>
              Règlement {reencaissement.decaissement.Mode.toLowerCase()} annulé le {dateFr(reencaissement.decaissement.Date)} : « {reencaissement.decaissement.Motif} ».
              {' '}Montant annulé : <strong>{fcfa(reencaissement.decaissement.Montant)}</strong>
              {reencaissement.decaissement.Reencaisse > 0 && <>, déjà réencaissé : {fcfa(reencaissement.decaissement.Reencaisse)}</>}.
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: '1rem' }}>
              <thead><tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}><th style={{ padding: '0.35rem' }}>Quittance</th><th style={{ padding: '0.35rem' }}>Client</th><th style={{ padding: '0.35rem' }}>Montant réencaissé (FCFA)</th></tr></thead>
              <tbody>
                {reencaissement.quittances.map((q, i) => (
                  <tr key={q.numero}>
                    <td style={{ padding: '0.3rem', fontFamily: 'var(--font-mono)' }}>{q.numero}</td>
                    <td style={{ padding: '0.3rem' }}>{q.client || '-'}</td>
                    <td style={{ padding: '0.3rem' }}>
                      <input type="number" className="form-control" min="0" aria-label={`Montant réencaissé sur ${q.numero}`} value={q.montant}
                        onChange={(e) => setReencaissement((prev) => ({ ...prev, quittances: prev.quittances.map((x, j) => (j === i ? { ...x, montant: e.target.value } : x)) }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>Total réencaissé : <strong>{fcfa(total)}</strong></p>
            <div className="form-group">
              <label className="form-label" htmlFor="reenc-references">Références du réencaissement (* requis)</label>
              <input id="reenc-references" type="text" className="form-control" required maxLength={100} placeholder="Ex. : nouveau virement, avis n° …"
                value={reencaissement.references}
                onChange={(e) => setReencaissement((prev) => ({ ...prev, references: e.target.value.replace(/[^\p{L}\p{N} \-/._:,']/gu, '') }))} />
            </div>
            <ChampsReglement modes={modes} banques={banques} onBanqueCreee={onBanqueCreee} valeurs={reencaissement.reglement}
              onChange={(champ, valeur) => setReencaissement((prev) => ({ ...prev, reglement: { ...prev.reglement, [champ]: valeur } }))} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setReencaissement(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Valider le réencaissement'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
