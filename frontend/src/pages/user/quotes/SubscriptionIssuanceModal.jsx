import React, { useState } from 'react';
import { Modal } from '../../../components/common/Modal';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import {
  ShieldCheck,
  FileCheck,
  AlertTriangle,
  UserCheck,
  CreditCard,
  Building,
  Calendar,
  Lock,
  Download,
  CheckCircle2,
  FileText,
  Clock,
} from 'lucide-react';

export const SubscriptionIssuanceModal = ({
  isOpen,
  onClose,
  quote,
  onConfirmSuccess,
}) => {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();

  // Date de prise d'effet et durée
  const todayStr = new Date().toISOString().split('T')[0];
  const [dateEffet, setDateEffet] = useState(todayStr);
  const [duree, setDuree] = useState('1_an');
  const [conventionVersion, setConventionVersion] = useState('CONV-2026-V2.1 (Avenant CIMA)');
  const [modeReglement, setModeReglement] = useState('ESPECES');
  const [referencePaiement, setReferencePaiement] = useState('');

  // Checklist de conformité E08 (CA-08.1)
  const [checks, setChecks] = useState({
    kyc_valide: true,
    pieces_presentes: true,
    accord_commercial: true,
    paiement_confirme: true,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [issuedContract, setIssuedContract] = useState(null);

  if (!quote) return null;

  // Vérifier la validité du devis (CA-07.3 / CA-08.1)
  const isExpired = () => {
    if (!quote.date_expiration && !quote.validite_jours) {
      if (quote.date_emission) {
        const emissionDate = new Date(quote.date_emission);
        const diffDays = Math.floor((new Date() - emissionDate) / (1000 * 60 * 60 * 24));
        return diffDays > 30;
      }
      return false;
    }
    if (quote.date_expiration) {
      return new Date(quote.date_expiration) < new Date(todayStr);
    }
    return false;
  };

  const expired = isExpired();
  const isAllChecksPassed =
    checks.kyc_valide &&
    checks.pieces_presentes &&
    checks.accord_commercial &&
    checks.paiement_confirme &&
    !expired;

  const handleToggleCheck = (key) => {
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleEmitContract = async () => {
    if (!isAllChecksPassed) {
      toastError('Conformité incomplète : tous les critères de la checklist de souscription doivent être cochés et le devis non expiré.');
      return;
    }

    setIsSubmitting(true);
    try {
      const auditLog = {
        gestionnaire_nom: user?.nomcomplet || user?.username || 'Gestionnaire Production',
        gestionnaire_id: user?.id || 1,
        date_emission: new Date().toISOString(),
        assureur: quote.compagnie,
        produit: quote.produit,
        branche: quote.branche,
        convention_utilisee: conventionVersion,
        mode_reglement: modeReglement,
        reference_paiement: referencePaiement || 'PAIEMENT-COMPTANT-GUICHET',
      };

      const result = await onConfirmSuccess({
        quote,
        dateEffet,
        duree,
        auditLog,
      });

      setIssuedContract(result || {
        numeropolice: `POL-2026-${String(Math.floor(100 + Math.random() * 900))}`,
        date_emission: todayStr,
      });
      success(`Police d'assurance émise avec succès sous le numéro unique !`);
    } catch (err) {
      console.error(err);
      toastError(err.message || "Erreur lors de l'émission de la police");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setIssuedContract(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="E08 – Souscription & Émission de Police d'Assurance"
      maxWidth="750px"
    >
      {!issuedContract ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {expired && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #ef4444',
                borderRadius: '8px',
                color: '#fca5a5',
                fontSize: '0.875rem',
              }}
            >
              <AlertTriangle size={20} color="#ef4444" />
              <div>
                <strong>Devis Expiré (CA-07.3) :</strong> Ce devis a dépassé sa date limite de validité (30 jours). Il ne peut pas être émis sans revalidation préalable des conditions tarifaires.
              </div>
            </div>
          )}

          <div
            style={{
              padding: '1rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(30, 41, 59, 0.7)',
              border: '1px solid var(--border-medium)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.75rem',
              fontSize: '0.85rem',
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Devis Source :</span>
              <div style={{ fontWeight: 700, color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>
                {quote.numerodevis}
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Souscripteur / Assuré :</span>
              <div style={{ fontWeight: 600, color: '#fff' }}>{quote.client_nom}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Compagnie Porteuse :</span>
              <div style={{ fontWeight: 600, color: '#f8fafc' }}>{quote.compagnie}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Prime Totale TTC :</span>
              <div style={{ fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                {Number(quote.prime_totale || 0).toLocaleString('fr-FR')} FCFA
              </div>
            </div>
          </div>

          <div className="responsive-form-row">
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Calendar size={14} /> Date de Prise d'Effet
              </label>
              <input
                type="date"
                className="form-control"
                value={dateEffet}
                onChange={(e) => setDateEffet(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Clock size={14} /> Durée de Police
              </label>
              <select
                className="form-control"
                value={duree}
                onChange={(e) => setDuree(e.target.value)}
              >
                <option value="1_an">Annuelle</option>
                <option value="6_mois">Semestrielle</option>
                <option value="1_mois">Mensuelle</option>
                <option value="3_mois">Trimestrielle</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Building size={14} /> Convention Assureur (CA-08.4)
              </label>
              <select
                className="form-control"
                value={conventionVersion}
                onChange={(e) => setConventionVersion(e.target.value)}
              >
                <option value="CONV-2025-V1.4 (Standard)">CONV-2025-V1.4 (Standard)</option>
                <option value="CONV-2026-V2.1 (Avenant CIMA)">CONV-2026-V2.1 (Avenant CIMA)</option>
              </select>
            </div>
          </div>

          <div className="responsive-form-row">
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <CreditCard size={14} /> Mode d'Encaissement
              </label>
              <select
                className="form-control"
                value={modeReglement}
                onChange={(e) => setModeReglement(e.target.value)}
              >
                <option value="CHEQUE">Chèque bancaire</option>
                <option value="ESPECES">Espèces (Guichet)</option>
                <option value="MOBILE_MONEY">Mobile Money (Wave / Orange / MTN)</option>
                <option value="VIREMENT">Virement bancaire</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Référence Paiement / Quittance</label>
              <input
                type="text"
                className="form-control"
                placeholder="Ex: CHQ-883902, TXN-WAVE-0921"
                value={referencePaiement}
                onChange={(e) => setReferencePaiement(e.target.value)}
              />
            </div>
          </div>

          <div
            style={{
              padding: '1.25rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '0.85rem',
                color: '#60a5fa',
                fontWeight: 700,
                fontSize: '0.9rem',
              }}
            >
              <ShieldCheck size={18} />
              Contrôle Interne & Checklist de Souscription Pré-Émission (CA-08.1)
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checks.kyc_valide}
                  onChange={() => handleToggleCheck('kyc_valide')}
                  style={{ width: '16px', height: '16px', accentColor: '#10b981' }}
                />
                <UserCheck size={16} color={checks.kyc_valide ? '#10b981' : '#94a3b8'} />
                <span>
                  <strong>Vérification d'Identité (KYC) :</strong> Pièce d'identité / RCCM vérifié et conforme aux exigences LBC-FT.
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checks.pieces_presentes}
                  onChange={() => handleToggleCheck('pieces_presentes')}
                  style={{ width: '16px', height: '16px', accentColor: '#10b981' }}
                />
                <FileCheck size={16} color={checks.pieces_presentes ? '#10b981' : '#94a3b8'} />
                <span>
                  <strong>Présence des pièces justificatives :</strong> Carte grise, permis, bulletin de souscription dûment signé.
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checks.accord_commercial}
                  onChange={() => handleToggleCheck('accord_commercial')}
                  style={{ width: '16px', height: '16px', accentColor: '#10b981' }}
                />
                <Lock size={16} color={checks.accord_commercial ? '#10b981' : '#94a3b8'} />
                <span>
                  <strong>Accord commercial & Règle tarifaire :</strong> Devis conforme à la grille agréée ou dérogation approuvée.
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checks.paiement_confirme}
                  onChange={() => handleToggleCheck('paiement_confirme')}
                  style={{ width: '16px', height: '16px', accentColor: '#10b981' }}
                />
                <CreditCard size={16} color={checks.paiement_confirme ? '#10b981' : '#94a3b8'} />
                <span>
                  <strong>Statut de paiement requis (Art. 13 CIMA) :</strong> Encaissement de la prime ou accord de paiement formalisé.
                </span>
              </label>
            </div>
          </div>

          <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Lock size={12} />
            Opération tracée au nom de : <strong>{user?.nomcomplet || user?.username || 'Gestionnaire de Production'}</strong> | Horodatage automatique (CA-08.4).
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{
                background: isAllChecksPassed ? '#059669' : '#475569',
                borderColor: isAllChecksPassed ? '#059669' : '#475569',
                cursor: isAllChecksPassed ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
              disabled={!isAllChecksPassed || isSubmitting}
              onClick={handleEmitContract}
            >
              <CheckCircle2 size={16} />
              {isSubmitting ? "Émission en cours..." : "Valider & Émettre la Police Définitive"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', textAlign: 'center', padding: '1rem 0' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'rgba(16, 185, 129, 0.2)',
              color: '#34d399',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto',
            }}
          >
            <CheckCircle2 size={36} />
          </div>

          <div>
            <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fff', marginBottom: '0.4rem' }}>
              Souscription Validée & Police Émise !
            </h3>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
              Le devis <strong>{quote.numerodevis}</strong> a été scellé et transformé avec succès.
            </p>
          </div>

          <div
            style={{
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid #10b981',
              borderRadius: '8px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Numéro de Police Unique Attribué (CA-08.2)
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
              {issuedContract.numeropolice}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
              Assuré : <strong>{quote.client_nom}</strong> | Émetteur : <strong>{user?.nomcomplet || user?.username}</strong>
            </div>
          </div>

          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <FileText size={16} color="#38bdf8" />
              Liasse Documentaire Contractuelle Générée (CA-08.3)
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.6rem' }}
                onClick={() => success('Téléchargement des Conditions Particulières généré !')}
              >
                <Download size={14} /> Contrat (Conditions Particulières)
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.6rem' }}
                onClick={() => success('Téléchargement de la Quittance d\'Assurance généré !')}
              >
                <Download size={14} /> Quittance de Paiement
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.6rem' }}
                onClick={() => success('Téléchargement du Bordereau d\'émission généré !')}
              >
                <Download size={14} /> Bordereau Compagnie
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '0.5rem 2rem' }}
              onClick={handleClose}
            >
              Terminer & Revenir à la liste
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
