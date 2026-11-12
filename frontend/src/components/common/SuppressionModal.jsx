import React, { useEffect, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { contractApi, quoteApi } from '../../api/endpoints';
import { useToast } from '../../context/ToastContext';
import { aLeDroit } from '../../utils/droits';
import { fcfa, messageErreurApi } from '../../utils/financeUtils';

// Même longueur minimale que la garde du serveur (autorisations/garde.py)
const MOTIF_MINIMUM = 5;

const cadre = (couleur) => ({
  padding: '0.75rem 0.9rem', borderRadius: '8px', border: `1px solid rgba(${couleur}, 0.45)`, background: `rgba(${couleur}, 0.08)`,
});
const liste = { margin: '0.4rem 0 0', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' };

/**
 * Suppression définitive d'un devis ou d'un contrat, par habilitation (production/suppression.py) : ce qui serait
 * supprimé ou ce qui l'empêche, lu sur le serveur, puis motif obligatoire, gardé au journal.
 * type : « devis » ou « contrat » ; onSupprime est appelé une fois la suppression faite.
 */
export const SuppressionModal = ({ isOpen, onClose, type, id, onSupprime }) => {
  const contrat = type === 'contrat';
  const api = contrat ? contractApi : quoteApi;
  const { success, error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');
  const [motif, setMotif] = useState('');
  const [avecDevis, setAvecDevis] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!isOpen || !id) return undefined;
    let actif = true;
    setDonnees(null);
    setErreur('');
    setMotif('');
    setAvecDevis(false);
    api.preparerSuppression(id)
      .then((d) => { if (actif) setDonnees(d); })
      .catch((err) => { if (actif) setErreur(messageErreurApi(err)); });
    return () => { actif = false; };
  }, [isOpen, id, api]);

  const motifValide = motif.trim().length >= MOTIF_MINIMUM;
  const proposerDevis = contrat && donnees?.DevisSupprimable && aLeDroit('devis.delete');

  const supprimer = async () => {
    setEnvoi(true);
    try {
      const r = await (contrat ? contractApi.supprimer(id, motif.trim(), { avecDevis }) : quoteApi.supprimer(id, motif.trim()));
      if (!contrat) success(`Devis ${r.NumeroDevis} supprimé.`);
      else if (r.DevisSupprime) success(`Contrat ${r.NumeroPolice} et devis ${r.NumeroDevis} supprimés.`);
      else success(`Contrat ${r.NumeroPolice} supprimé. Le devis ${r.NumeroDevis} est revenu dans le registre, non confirmé.`);
      onClose();
      onSupprime?.(r);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="medium" title={contrat ? 'Supprimer le contrat' : 'Supprimer le devis'}
      subtitle={donnees ? [donnees.Reference, donnees.Client].filter(Boolean).join(' - ') : undefined}>
      {erreur && <div style={{ color: 'var(--accent-amber)', fontSize: '0.85rem' }}>{erreur}</div>}
      {!erreur && !donnees && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Vérification…</div>}
      {donnees && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
          <div style={{ color: 'var(--text-secondary)' }}>
            {contrat ? donnees.Mouvement : 'Devis'} de <strong>{fcfa(donnees.PrimeTtc)} F TTC</strong>.
          </div>
          {donnees.Supprimable ? (
            <>
              <div style={cadre('244, 63, 94')}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-primary)' }}>
                  <AlertTriangle size={15} /> Cette suppression est définitive.
                </strong>
                <ul style={liste}>
                  {donnees.Effets.map((e) => <li key={e}>{e}</li>)}
                  <li>L'état d'avant la suppression et le motif restent au journal d'audit.</li>
                </ul>
              </div>
              {proposerDevis && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={avecDevis} onChange={(e) => setAvecDevis(e.target.checked)} />
                  <span>Supprimer aussi le devis {donnees.NumeroDevis}</span>
                </label>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <span style={{ fontWeight: 600 }}>Motif de la suppression *</span>
                <textarea className="form-control" rows={2} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)} />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{MOTIF_MINIMUM} caractères au moins.</span>
              </label>
            </>
          ) : (
            <div style={cadre('245, 158, 11')}>
              <strong style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-primary)' }}>
                <AlertTriangle size={15} /> Suppression impossible
              </strong>
              <ul style={liste}>
                {donnees.Blocages.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>{donnees.Supprimable ? 'Annuler' : 'Fermer'}</button>
            {donnees.Supprimable && (
              <button type="button" className="btn btn-danger" onClick={supprimer} disabled={envoi || !motifValide}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Trash2 size={15} /> {envoi ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};

export default SuppressionModal;
