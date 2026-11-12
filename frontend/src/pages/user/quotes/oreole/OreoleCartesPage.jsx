import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CreditCard, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { oreoleApi } from '../../../../api/endpoints';
import { StatusBadge } from '../../../../components/common/StatusBadge';
import { useToast } from '../../../../context/ToastContext';
import { dateFr, fcfa, messageErreurApi } from '../../../../utils/financeUtils';

/* =========================================================================
   Historique des cartes d'assurance facturées : date, montant, opérateur, motif, personne et police. Un devis non confirmé apparaît, mais ne
   compte pas encore comme une facturation.
   ========================================================================= */
export default function OreoleCartesPage() {
  const navigate = useNavigate();
  const { error: toastError } = useToast();
  const [q, setQ] = useState('');
  const [lignes, setLignes] = useState([]);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setLignes((await oreoleApi.registreCartes(q)).Lignes);
    } catch (err) {
      toastError(`Historique non lu : ${messageErreurApi(err)}`);
    } finally {
      setChargement(false);
    }
  }, [q, toastError]);

  useEffect(() => { const m = setTimeout(charger, 300); return () => clearTimeout(m); }, [charger]);

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <header>
        <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem', marginBottom: '0.6rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={() => navigate('/user/quotes/oreole-sante')}><ArrowLeft size={14} /> Oreole Santé</button>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}><CreditCard size={26} /> Cartes d'assurance facturées</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: 760 }}>
          Une carte n'est facturée qu'une fois par personne. Une nouvelle facturation demande le motif Renouvellement pour perte.
        </p>
      </header>
      <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
        <label className="form-label" htmlFor="cartes-recherche">Personne, police ou devis</label>
        <input id="cartes-recherche" className="form-control" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom et prénoms, numéro de police ou de devis" />
      </div>
      <div className="glass-panel table-wrapper">
        <table className="data-table" style={{ fontSize: '0.84rem' }}>
          <thead><tr><th>Date</th><th>Personne</th><th>Naissance</th><th>Police ou devis</th><th style={{ textAlign: 'right' }}>Montant</th><th>Motif</th><th>Par</th><th>État</th></tr></thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.IdFacturation}>
                <td>{dateFr(l.Date)}</td>
                <td style={{ fontWeight: 600 }}>{l.Anonyme ? `Personne non nommée de la famille ${l.Nom} ${l.Prenoms}` : `${l.Nom} ${l.Prenoms}`}</td>
                <td>{dateFr(l.DateNaissance)}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{l.NumeroPolice || l.NumeroDevis}</td>
                <td style={{ textAlign: 'right' }}>{fcfa(l.Montant)} F</td>
                <td>{l.LibelleMotif}{l.Observation && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{l.Observation}</div>}</td>
                <td>{l.Utilisateur}</td>
                <td><StatusBadge label={l.Effective ? 'Facturée' : 'Devis en cours'} color={l.Effective ? 'emerald' : 'blue'} /></td>
              </tr>
            ))}
            {!lignes.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>{chargement ? <><Loader2 size={14} className="spin" /> Lecture…</> : 'Aucune carte facturée.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
