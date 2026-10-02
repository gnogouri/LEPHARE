import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../../../components/common/Modal';
import { ShieldAlert, AlertTriangle, KeyRound, FileSpreadsheet, CheckCircle2, ArrowRight } from 'lucide-react';

export const ContractActionModal = ({
  isOpen,
  onClose,
  contract,
  onTerminate,
  onCancelWithDerogation,
}) => {
  const navigate = useNavigate();
  const [actionTab, setActionTab] = useState('resiliation'); // 'resiliation' | 'annulation'
  const [motifResiliation, setMotifResiliation] = useState('Défaut de paiement de la prime (Article 13 CIMA)');
  const [dateEffet, setDateEffet] = useState(new Date().toISOString().split('T')[0]);
  const [codeJeton, setCodeJeton] = useState('');
  const [motifAnnulation, setMotifAnnulation] = useState('');

  if (!isOpen || !contract) return null;

  const handleResiliationSubmit = (e) => {
    e.preventDefault();
    onTerminate(contract.id, {
      motif: motifResiliation,
      motif_label: motifResiliation,
      date_resiliation: dateEffet,
    });
    onClose();
  };

  const handleAnnulationSubmit = (e) => {
    e.preventDefault();
    if (!codeJeton) return;
    onCancelWithDerogation(contract.id, {
      code_jeton: codeJeton,
      motif: motifAnnulation || 'Annulation administrative autorisée par la Direction',
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Opération Réglementaire CIMA sur Police [${contract.numeropolice}]`}
      size="medium"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Sub-header CIMA rule alert */}
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '8px',
            padding: '0.75rem 0.9rem',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
          }}
        >
          <ShieldAlert size={20} style={{ color: '#ef4444', flexShrink: 0 }} />
          <div>
            <strong style={{ color: '#ef4444' }}>Inviolabilité Contractuelle CIMA :</strong> Conformément aux règles de la CRCA, les polices d'assurance ne peuvent pas être supprimées. Toute interruption doit être enregistrée par résiliation formelle ou par dérogation visée.
          </div>
        </div>

        {/* Tab switchers */}
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
          <button
            type="button"
            className={`btn ${actionTab === 'resiliation' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
            onClick={() => setActionTab('resiliation')}
          >
            Résilier la Police (Art. 13 CIMA)
          </button>
          <button
            type="button"
            className={`btn ${actionTab === 'annulation' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
            onClick={() => setActionTab('annulation')}
          >
            Annuler avec Dérogation (Jeton)
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            onClick={() => {
              onClose();
              navigate('/user/endorsements');
            }}
          >
            <FileSpreadsheet size={14} />
            <span>Créer un Avenant</span>
          </button>
        </div>

        {/* Tab 1: Résiliation */}
        {actionTab === 'resiliation' && (
          <form onSubmit={handleResiliationSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Motif Réglementaire de Résiliation CIMA</label>
              <select
                className="form-control"
                value={motifResiliation}
                onChange={(e) => setMotifResiliation(e.target.value)}
              >
                <option value="Défaut de paiement de la prime (Article 13 CIMA)">
                  Défaut de paiement de la prime (Article 13 CIMA - « Pas de prime, pas d'assurance »)
                </option>
                <option value="Changement de profession ou aggravation de risque">
                  Modification substantielle de l'usage ou du risque
                </option>
                <option value="Perte totale du véhicule ou sinistre destructeur">
                  Perte totale / Destruction suite à sinistre
                </option>
                <option value="Résiliation amiable contradictoire à échéance">
                  Résiliation amiable contradictoire
                </option>
                <option value="Vente ou aliénation du véhicule assuré (Art. 25 CIMA)">
                  Vente ou cession du véhicule assuré (Art. 25 CIMA)
                </option>
              </select>
            </div>

            <div>
              <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Date d'Effet de la Résiliation</label>
              <input
                type="date"
                className="form-control"
                value={dateEffet}
                onChange={(e) => setDateEffet(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Annuler
              </button>
              <button
                type="submit"
                className="btn btn-danger"
                style={{ backgroundColor: '#dc2626', borderColor: '#dc2626', color: '#fff' }}
              >
                Confirmer la Résiliation CIMA
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: Annulation avec Jeton de Dérogation */}
        {actionTab === 'annulation' && (
          <form onSubmit={handleAnnulationSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                Code Jeton d'Autorisation Sécurisé (Délivré par la Direction)
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Ex: JET-2026-XXXX"
                  value={codeJeton}
                  onChange={(e) => setCodeJeton(e.target.value.toUpperCase())}
                  style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                  required
                />
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                Requis pour l'audit CRCA. Obtenez un jeton via le Centre d'Approbation / Dérogations.
              </span>
            </div>

            <div>
              <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Motif de l'Annulation</label>
              <textarea
                className="form-control"
                rows="2"
                placeholder="Précisez le motif légitime d'annulation (ex: erreur de saisie doublon)..."
                value={motifAnnulation}
                onChange={(e) => setMotifAnnulation(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Annuler
              </button>
              <button
                type="submit"
                className="btn btn-warning"
                disabled={!codeJeton}
                style={{ backgroundColor: '#f59e0b', borderColor: '#f59e0b', color: '#000', fontWeight: 600 }}
              >
                Valider l'Annulation avec Jeton
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
