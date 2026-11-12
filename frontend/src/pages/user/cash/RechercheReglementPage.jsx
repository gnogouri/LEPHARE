import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, Loader2, Printer, Search, SearchX, X } from 'lucide-react';
import { financeApi, settingsApi } from '../../../api/endpoints';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { useToast } from '../../../context/ToastContext';
import { printRecuEncaissement } from '../../../utils/exportUtils';
import { dateFr, fcfa, messageErreurApi } from '../../../utils/financeUtils';
import { trierParLibelle } from '../../../utils/sortUtils';

// Recherche d'un règlement : à quoi a servi un chèque, un virement, des espèces ou tout autre mode de paiement
// (GET /api/finance/encaissements/recherche/). Chaque règlement revient avec toutes les quittances qu'il a payées.
const COULEURS = { A_REVERSER: 'amber', PARTIEL: 'amber', REVERSE: 'emerald', ANNULE: 'rose', IMPAYE: 'rose', DECAISSEMENT: 'rose' };
const COULEURS_CHEQUE = { ENCAISSE: 'emerald', REENCAISSE: 'emerald', IMPAYE: 'rose', A_DEPOSER: 'amber' };
const FILTRES_VIDES = { q: '', mode: '', du: '', au: '' };
// Listes sans parenthèses : le complément passe après un tiret
const libelleMode = (m) => String(m.libellemodepaiement || '').replace(/\s*\(([^)]*)\)/g, ' - $1').trim();

const Info = ({ libelle, children }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{libelle}</div>
    <div style={{ fontSize: '0.88rem', fontWeight: 600, overflowWrap: 'anywhere' }}>{children}</div>
  </div>
);

const CarteReglement = ({ reglement: r }) => {
  const { error: toastError } = useToast();
  const imprimerRecu = async (id) => {
    try {
      await printRecuEncaissement(id);
    } catch (err) {
      toastError(`Reçu indisponible : ${messageErreurApi(err)}`);
    }
  };
  const titre = [r.Mode, r.Reference && `N° ${r.Reference}`].filter(Boolean).join(' ');
  return (
    <section className="glass-panel" style={{ padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, overflowWrap: 'anywhere' }}>{titre || 'Règlement sans référence'}</h2>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
            {r.NombrePolices} police{r.NombrePolices > 1 ? 's' : ''} et {r.NombreQuittances} quittance{r.NombreQuittances > 1 ? 's' : ''} payée{r.NombreQuittances > 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {r.Cheque && <StatusBadge label={`Chèque ${r.Cheque.LibelleStatut.toLowerCase()}`} color={COULEURS_CHEQUE[r.Cheque.Statut] || 'amber'} />}
          {r.Annule && !r.Cheque && <StatusBadge label="Annulé" color="rose" />}
          <strong style={{ fontSize: '1.1rem', whiteSpace: 'nowrap' }}>{fcfa(r.Montant)} F</strong>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '0.65rem' }}>
        {r.Banque && <Info libelle="Banque">{r.Banque}</Info>}
        {r.Emetteur && <Info libelle="Émetteur">{r.Emetteur}</Info>}
        {r.DateCheque && <Info libelle="Émis le">{dateFr(r.DateCheque)}</Info>}
        {r.DateReception && <Info libelle="Reçu au cabinet le">{dateFr(r.DateReception)}</Info>}
        {r.Cheque && <Info libelle="Montant du chèque">{fcfa(r.Cheque.MontantInitial)} F</Info>}
        {r.Cheque && <Info libelle="Reste disponible">{fcfa(r.Cheque.SoldeDisponible)} F</Info>}
        <Info libelle="Déjà reversé">{fcfa(r.MontantReverse)} F</Info>
      </div>
      <div className="tableau-defilant" style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
        <table className="data-table" style={{ minWidth: 900, fontSize: '0.8rem' }}>
          <thead>
            <tr>
              <th>Police</th><th>Quittance</th><th>Souscripteur</th><th>Compagnie</th><th>Date</th>
              <th style={{ textAlign: 'right' }}>Montant affecté</th><th style={{ textAlign: 'right' }}>Reste dû</th><th>Statut</th><th aria-label="Reçu" />
            </tr>
          </thead>
          <tbody>
            {r.Lignes.map((l) => (
              <tr key={l.IdDetailEncaissement}>
                <td style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                  {l.IdContrat
                    ? <Link to={`/user/contracts/${l.IdContrat}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>{l.NumeroPolice}<ExternalLink size={12} /></Link>
                    : l.NumeroPolice}
                  <div style={{ fontFamily: 'inherit', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{l.Branche}</div>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{l.NumeroQuittance}</td>
                <td>{l.Client}</td>
                <td>{l.Compagnie}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{dateFr(l.DateEncaissement)}{l.NumeroPiece && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{l.NumeroPiece}</div>}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fcfa(l.Montant)} F</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fcfa(l.ResteDuQuittance)} F</td>
                <td><StatusBadge label={l.LibelleStatut} color={COULEURS[l.Statut] || 'emerald'} /></td>
                <td>
                  {l.Statut !== 'ANNULE' && l.Statut !== 'IMPAYE' && (
                    <button type="button" className="btn btn-secondary" title="Imprimer le reçu" aria-label={`Imprimer le reçu de la quittance ${l.NumeroQuittance}`}
                      style={{ padding: '0.25rem 0.45rem' }} onClick={() => imprimerRecu(l.IdDetailEncaissement)}>
                      <Printer size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default function RechercheReglementPage() {
  const { error: toastError } = useToast();
  const [parametres, setParametres] = useSearchParams();
  const [filtres, setFiltres] = useState({ ...FILTRES_VIDES, q: parametres.get('q') || '' });
  const [modes, setModes] = useState([]);
  const [chargement, setChargement] = useState(false);
  const [resultat, setResultat] = useState(null);

  const chercher = async (valeurs) => {
    setChargement(true);
    try {
      const envoi = Object.fromEntries(Object.entries(valeurs).filter(([, v]) => String(v).trim()));
      setResultat(await financeApi.rechercherReglements(envoi));
      setParametres(valeurs.q ? { q: valeurs.q } : {}, { replace: true });
    } catch (err) {
      setResultat(null);
      toastError(messageErreurApi(err));
    } finally {
      setChargement(false);
    }
  };

  useEffect(() => {
    settingsApi.getModesEncaissement().then((l) => setModes(Array.isArray(l) ? l : [])).catch(() => {});
    if (parametres.get('q')) chercher({ ...FILTRES_VIDES, q: parametres.get('q') });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const champ = (cle) => (e) => setFiltres((f) => ({ ...f, [cle]: e.target.value }));
  const envoyer = (e) => { e.preventDefault(); chercher(filtres); };
  const effacer = () => { setFiltres(FILTRES_VIDES); setResultat(null); setParametres({}, { replace: true }); };
  const reglements = resultat?.Reglements || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}><Search size={26} color="#10b981" /> Rechercher un règlement</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Retrouvez à quoi a servi un chèque, un virement, des espèces ou tout autre paiement : polices et quittances réglées, montants, reste disponible.
        </p>
      </div>
      <form className="glass-panel" onSubmit={envoyer} style={{ padding: '1.1rem 1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '0.75rem', alignItems: 'end' }}>
        <div className="form-group" style={{ margin: 0, gridColumn: 'span 2', minWidth: 0 }}>
          <label className="form-label" htmlFor="reglement-q">Numéro, police, quittance, client, émetteur ou montant</label>
          <input id="reglement-q" type="search" className="form-control" autoFocus value={filtres.q} onChange={champ('q')} placeholder="Numéro du chèque, du virement, du bordereau…" />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="reglement-mode">Mode de paiement</label>
          <select id="reglement-mode" className="form-control" value={filtres.mode} onChange={champ('mode')}>
            <option value="">Tous les modes</option>
            {trierParLibelle(modes, (m) => m.libellemodepaiement).filter((m) => String(m.libellemodepaiement || '').trim() && !/aucun/i.test(m.libellemodepaiement)).map((m) => (
              <option key={m.idmodeencaissement} value={m.idmodeencaissement}>{libelleMode(m)}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="reglement-du">Du</label>
          <input id="reglement-du" type="date" className="form-control" value={filtres.du} onChange={champ('du')} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="reglement-au">Au</label>
          <input id="reglement-au" type="date" className="form-control" value={filtres.au} onChange={champ('au')} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary" disabled={chargement} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            {chargement ? <Loader2 size={15} className="spin" /> : <Search size={15} />} Rechercher
          </button>
          <button type="button" className="btn btn-secondary" onClick={effacer} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}><X size={15} /> Effacer</button>
        </div>
      </form>

      {resultat && (
        <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
          {reglements.length} règlement{reglements.length > 1 ? 's' : ''} trouvé{reglements.length > 1 ? 's' : ''}
          {resultat.Tronque && ' : les plus récents seulement, précisez la recherche pour voir les autres'}
        </div>
      )}
      {resultat && !reglements.length && (
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <SearchX size={26} style={{ marginBottom: '0.4rem' }} />
          <div>Aucun règlement ne correspond à cette recherche.</div>
        </div>
      )}
      {reglements.map((r) => <CarteReglement key={r.Cle} reglement={r} />)}
    </div>
  );
}
