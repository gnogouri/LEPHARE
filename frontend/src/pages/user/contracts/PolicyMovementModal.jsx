import React, { useState, useEffect } from 'react';
import { Modal } from '../../../components/common/Modal';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { dataStore } from '../../../api/dataStore';
import { contractApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { formatDate } from '../../../utils/dateUtils';
import { AmountInput } from '../../../components/common/AmountInput';
import {
  ShieldCheck,
  RefreshCw,
  Printer,
  Calendar,
  Banknote,
  Building2,
  User,
  Car,
  CheckCircle2,
  FileText,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  ShieldAlert,
  Clock,
  Layers,
  Check,
} from 'lucide-react';

export const PolicyMovementModal = ({
  isOpen,
  onClose,
  contract,
  initialTab = 'renouvellement', // 'renouvellement' | 'avenant' | 'transformation' | 'resiliation'
  initialOperation = null, // { type, endorsement, quittance, contract }
  onSuccess,
}) => {
  const { success, error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [completedOperation, setCompletedOperation] = useState(initialOperation);

  // --- Renouvellement State ---
  const [periodeMois, setPeriodeMois] = useState('12');
  const [renewalDateEffet, setRenewalDateEffet] = useState('');
  const [renewalDateExpiration, setRenewalDateExpiration] = useState('');
  const [renewalPrimeTotale, setRenewalPrimeTotale] = useState(0);
  const [encaisserImmediat, setEncaisserImmediat] = useState(true);
  const [modePaiement, setModePaiement] = useState('ESPECES');
  const [referencePaiement, setReferencePaiement] = useState('');

  // --- Avenant State ---
  const [avenantType, setAvenantType] = useState('immatriculation');
  const [nouvelleImmatriculation, setNouvelleImmatriculation] = useState('');
  const [primeAdditionnelle, setPrimeAdditionnelle] = useState(0);
  const [motifAvenant, setMotifAvenant] = useState('Changement d’immatriculation suite à nouvelle carte grise');
  const [dateEffetAvenant, setDateEffetAvenant] = useState(new Date().toISOString().split('T')[0]);

  // --- Transformation State ---
  const [nouveauProduit, setNouveauProduit] = useState('');
  const [nouvelleCompagnie, setNouvelleCompagnie] = useState('');
  const [nouvellePrime, setNouvellePrime] = useState(0);
  const [motifTransformation, setMotifTransformation] = useState('Surclassement de formule à la demande de l’assuré');

  // --- Résiliation State ---
  const [motifResiliation, setMotifResiliation] = useState('Défaut de paiement de la prime (Article 13 CIMA)');
  const [dateResiliation, setDateResiliation] = useState(new Date().toISOString().split('T')[0]);
  const [codeJeton, setCodeJeton] = useState('');

  // Synchronisation lors de l'ouverture
  useEffect(() => {
    if (contract) {
      setActiveTab(initialTab);
      setCompletedOperation(initialOperation || null);

      // Calcul date d'effet par défaut
      const expDate = new Date(contract.date_expiration);
      const today = new Date();
      let startStr;
      if (!isNaN(expDate.getTime()) && expDate > today) {
        const nextDay = new Date(expDate);
        nextDay.setDate(nextDay.getDate() + 1);
        startStr = nextDay.toISOString().split('T')[0];
      } else {
        startStr = today.toISOString().split('T')[0];
      }
      setRenewalDateEffet(startStr);

      const d = parseInt(periodeMois, 10) || 12;
      const sObj = new Date(startStr);
      const eObj = new Date(sObj);
      eObj.setMonth(eObj.getMonth() + d);
      eObj.setDate(eObj.getDate() - 1);
      setRenewalDateExpiration(eObj.toISOString().split('T')[0]);

      setRenewalPrimeTotale(Number(contract.prime_totale || 0));
      setNouveauProduit(contract.produit || 'Automobile Tous Risques');
      setNouvelleCompagnie(contract.compagnie || 'NSIA ASSURANCES');
      setNouvellePrime(Number(contract.prime_totale || 0));
    }
  }, [contract, isOpen, initialTab]);

  // Recalcul date d'échéance lors du changement de durée ou de date d'effet
  const handleDurationChange = (months) => {
    setPeriodeMois(months);
    const d = parseInt(months, 10) || 12;
    if (renewalDateEffet) {
      const sObj = new Date(renewalDateEffet);
      const eObj = new Date(sObj);
      eObj.setMonth(eObj.getMonth() + d);
      eObj.setDate(eObj.getDate() - 1);
      setRenewalDateExpiration(eObj.toISOString().split('T')[0]);
    }
  };

  const handleStartDateChange = (val) => {
    setRenewalDateEffet(val);
    const d = parseInt(periodeMois, 10) || 12;
    if (val) {
      const sObj = new Date(val);
      const eObj = new Date(sObj);
      eObj.setMonth(eObj.getMonth() + d);
      eObj.setDate(eObj.getDate() - 1);
      setRenewalDateExpiration(eObj.toISOString().split('T')[0]);
    }
  };

  if (!isOpen || !contract) return null;

  // --- SUBMIT: Renouvellement ---
  const handleRenewalSubmit = async (e) => {
    e.preventDefault();
    try {
      const result = dataStore.renewContract({
        contractId: contract.id,
        periodeMois: parseInt(periodeMois, 10),
        dateEffet: renewalDateEffet,
        primeTotale: Number(renewalPrimeTotale),
        encaisserImmediat,
        modePaiement,
        referencePaiement,
      });

      try {
        await contractApi.renewContract({
          contractId: contract.id,
          dateEffet: renewalDateEffet,
          periodeMois,
          primeTotale: renewalPrimeTotale,
        });
      } catch (err) {
        console.warn('Backend renewal endpoint fallback to dataStore');
      }

      setCompletedOperation({
        type: 'Renouvellement',
        endorsement: result.endorsement,
        quittance: result.quittance,
        contract: result.contract,
      });

      success(`Police ${contract.numeropolice} renouvelée jusqu’au ${formatDate(result.contract.date_expiration)} !`);
      if (onSuccess) onSuccess(result.contract);
    } catch (err) {
      toastError(err.message || 'Erreur lors du renouvellement');
    }
  };

  // --- SUBMIT: Avenant ---
  const handleAvenantSubmit = async (e) => {
    e.preventDefault();
    try {
      const result = dataStore.saveEndorsement({
        police_id: contract.id,
        police_num: contract.numeropolice,
        client_nom: contract.client_nom,
        type_mouvement: 'Avenant',
        nature: motifAvenant,
        date_avenant: dateEffetAvenant,
        date_effet: dateEffetAvenant,
        date_expiration: contract.date_expiration,
        prime_totale: Number(primeAdditionnelle || 0),
        details: {
          type_avenant: avenantType,
          nouvelleImmatriculation: avenantType === 'immatriculation' ? nouvelleImmatriculation : undefined,
          compagnie: contract.compagnie,
          produit: contract.produit,
        },
      });

      setCompletedOperation({
        type: 'Avenant',
        endorsement: result,
        contract: dataStore.getContractById(contract.id),
      });

      success(`Avenant ${result.numero_avenant} enregistré avec succès sur la police !`);
      if (onSuccess) onSuccess(dataStore.getContractById(contract.id));
    } catch (err) {
      toastError(err.message || 'Erreur lors de l’avenant');
    }
  };

  // --- SUBMIT: Transformation ---
  const handleTransformationSubmit = async (e) => {
    e.preventDefault();
    try {
      const result = dataStore.transformContract({
        contractId: contract.id,
        nouveauProduit,
        nouvelleCompagnie,
        nouvellePrime,
        motifTransformation,
      });

      setCompletedOperation({
        type: 'Transformation',
        endorsement: result.endorsement,
        contract: result.contract,
      });

      success(`Police ${contract.numeropolice} transformée en « ${result.contract.produit} » !`);
      if (onSuccess) onSuccess(result.contract);
    } catch (err) {
      toastError(err.message || 'Erreur lors de la transformation');
    }
  };

  // --- SUBMIT: Résiliation ---
  const handleResiliationSubmit = (e) => {
    e.preventDefault();
    try {
      const updated = dataStore.terminateContract(contract.id, {
        motif: motifResiliation,
        date_resiliation: dateResiliation,
      });
      success(`Police ${contract.numeropolice} résiliée conformément au Code CIMA.`);
      if (onSuccess) onSuccess(updated);
      onClose();
    } catch (err) {
      toastError(err.message);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        completedOperation
          ? `Attestation Officielle & Certificat CIMA - ${completedOperation.type}`
          : `Gestion des Mouvements de Police [${contract.numeropolice}]`
      }
      size="large"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* CONTRACT QUICK HEADER */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.85rem 1.15rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                background: 'rgba(16, 185, 129, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ShieldCheck size={20} color="#10b981" />
            </div>
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)' }}>
                {contract.numeropolice}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Souscripteur : <strong style={{ color: 'var(--text-primary)' }}>{contract.client_nom}</strong> • {contract.compagnie}
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Échéance actuelle :</div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>
              {formatDate(contract.date_expiration)}
            </div>
          </div>
        </div>

        {/* COMPLETED OPERATION PRINT VIEW */}
        {completedOperation ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Printable Document Box */}
            <div
              id="printable-movement-certificate"
              style={{
                padding: '2rem',
                borderRadius: 'var(--radius-md)',
                background: '#ffffff',
                color: '#0f172a',
                border: '2px solid #0284c7',
                boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
                position: 'relative',
              }}
            >
              {/* Header CIMA */}
              <div style={{ textAlign: 'center', borderBottom: '2px solid #0f172a', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#475569' }}>
                  RÉPUBLIQUE DE CÔTE D'IVOIRE • MINISTÈRE DES FINANCES • CODE CIMA (CRCA)
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a', marginTop: '0.35rem' }}>
                  LE PHARE COURTAGE & GESTION D'ASSURANCES
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0284c7', textTransform: 'uppercase', marginTop: '0.25rem' }}>
                  CERTIFICAT OFFICIEL DE {completedOperation.type.toUpperCase()}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>
                  Réf. Avenant : <strong>{completedOperation.endorsement?.numero_avenant}</strong> • Quittance : <strong>{completedOperation.quittance?.numero_quittance || 'Régularisation Comptable'}</strong>
                </div>
              </div>

              {/* Body Details */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                <div style={{ padding: '0.75rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Identité Souscripteur</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', marginTop: '0.2rem' }}>{contract.client_nom}</div>
                  <div style={{ color: '#475569', marginTop: '0.2rem' }}>N° Police : <strong>{contract.numeropolice}</strong></div>
                  <div style={{ color: '#475569' }}>Compagnie : <strong>{contract.compagnie}</strong></div>
                </div>

                <div style={{ padding: '0.75rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Période de Garantie Prorogée</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#059669', marginTop: '0.2rem' }}>
                    Du {completedOperation.contract?.date_effet || completedOperation.endorsement?.date_effet || contract.date_effet} au {completedOperation.contract?.date_expiration || completedOperation.endorsement?.date_expiration || contract.date_expiration}
                  </div>
                  <div style={{ color: '#475569', marginTop: '0.2rem' }}>Nature de l'opération : <strong>{completedOperation.endorsement?.nature || completedOperation.type}</strong></div>
                  <div style={{ color: '#475569' }}>Branche & Produit : <strong>{completedOperation.contract?.produit || completedOperation.endorsement?.details?.produit || contract.produit}</strong></div>
                </div>
              </div>

              {/* Financial Box */}
              <div style={{ padding: '1rem', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#166534', fontWeight: 700 }}>Prime Totale TTC de l'Opération</div>
                    <div style={{ fontSize: '0.8rem', color: '#15803d' }}>
                      Paiement : {completedOperation.quittance ? 'Règlement Intégral Effectué' : 'À régulariser'}
                    </div>
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#15803d', fontFamily: 'monospace' }}>
                    {Number(completedOperation.endorsement?.prime_totale ?? completedOperation.contract?.prime_totale ?? contract.prime_totale ?? 0).toLocaleString('fr-FR')} FCFA
                  </div>
                </div>
              </div>

              {/* Legal CIMA Clause */}
              <div style={{ fontSize: '0.75rem', color: '#64748b', borderTop: '1px solid #cbd5e1', paddingTop: '0.75rem', lineHeight: '1.4' }}>
                <strong>Article 13 du Code CIMA (« Pas de prime, pas d’assurance ») :</strong> La présente attestation certifie que les conditions légales d'émission et de prorogation de garantie ont été intégralement respectées. La couverture des risques est opposable aux tiers et garantie pour la durée spécifiée.
              </div>

              {/* Signatures & Stamp */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px dashed #cbd5e1', fontSize: '0.8rem' }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#334155' }}>Signature du Souscripteur :</div>
                  <div style={{ height: '50px', color: '#94a3b8', fontStyle: 'italic', paddingTop: '1.5rem' }}>« Lu et approuvé »</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: '#334155' }}>Pour la Direction LE PHARE / Visa CIMA :</div>
                  <div style={{ marginTop: '0.5rem', color: '#0284c7', fontWeight: 800 }}>[ Cachet & Signature Électronique ]</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Fait à Abidjan, le {new Date().toLocaleDateString('fr-FR')}</div>
                </div>
              </div>
            </div>

            {/* Action Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCompletedOperation(null)}
              >
                ← Retour au formulaire
              </button>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => window.print()}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.25rem', background: '#0284c7' }}
                >
                  <Printer size={16} />
                  <span>Imprimer le Certificat Officiel</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onClose}
                >
                  Terminer
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* OPERATION TABS */}
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn ${activeTab === 'renouvellement' ? 'btn-primary' : 'btn-secondary'}`}
                style={{
                  fontSize: '0.85rem',
                  padding: '0.45rem 0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  background: activeTab === 'renouvellement' ? 'linear-gradient(135deg, #059669, #10b981)' : '',
                }}
                onClick={() => setActiveTab('renouvellement')}
              >
                <RefreshCw size={15} />
                <span>1. Renouvellement de Police</span>
              </button>

              <button
                type="button"
                className={`btn ${activeTab === 'avenant' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.85rem', padding: '0.45rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={() => setActiveTab('avenant')}
              >
                <FileText size={15} />
                <span>2. Avenant de Modification</span>
              </button>

              <button
                type="button"
                className={`btn ${activeTab === 'transformation' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.85rem', padding: '0.45rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={() => setActiveTab('transformation')}
              >
                <Sparkles size={15} />
                <span>3. Transformation de Formule</span>
              </button>

              <button
                type="button"
                className={`btn ${activeTab === 'resiliation' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.85rem', padding: '0.45rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}
                onClick={() => setActiveTab('resiliation')}
              >
                <ShieldAlert size={15} color="#f87171" />
                <span style={{ color: activeTab === 'resiliation' ? '#fff' : '#f87171' }}>Résiliation CIMA</span>
              </button>
            </div>

            {/* TAB 1: RENOUVELLEMENT */}
            {activeTab === 'renouvellement' && (
              <form onSubmit={handleRenewalSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div
                  style={{
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <RefreshCw size={18} color="#34d399" />
                  <div>
                    <strong style={{ color: '#34d399' }}>Reconduction de la Police CIMA :</strong> Le renouvellement proroge la couverture d'assurance pour une nouvelle échéance, génère l'Avenant de renouvellement réglementaire et émet la quittance officielle.
                  </div>
                </div>

                {/* Duration Picker */}
                <div>
                  <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Durée de Reconduction</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
                    {[
                      { id: '12', label: 'Annuelle' },
                      { id: '6', label: 'Semestrielle' },
                      { id: '3', label: 'Trimestrielle' },
                      { id: '1', label: 'Mensuelle' },
                    ].map((opt) => (
                      <div
                        key={opt.id}
                        onClick={() => handleDurationChange(opt.id)}
                        style={{
                          padding: '0.75rem',
                          borderRadius: '8px',
                          border: `1px solid ${periodeMois === opt.id ? '#10b981' : 'var(--border-subtle)'}`,
                          background: periodeMois === opt.id ? 'rgba(16, 185, 129, 0.15)' : 'var(--surface-sunken)',
                          cursor: 'pointer',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontWeight: 700, color: periodeMois === opt.id ? '#34d399' : '#fff', fontSize: '0.9rem' }}>
                          {opt.label}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dates Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Date de Prise d'Effet du Renouvellement</label>
                    <input
                      type="date"
                      className="form-control"
                      value={renewalDateEffet}
                      onChange={(e) => handleStartDateChange(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Nouvelle Date d'Échéance</label>
                    <input
                      type="date"
                      className="form-control"
                      value={renewalDateExpiration}
                      onChange={(e) => setRenewalDateExpiration(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Financial Details */}
                <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                      Décompte Financier du Renouvellement
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tarification annuelle CIMA</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Prime Nette :</span>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#60a5fa', fontFamily: 'monospace' }}>
                        {Math.round(renewalPrimeTotale * 0.85).toLocaleString('fr-FR')} F
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Accessoires :</span>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
                        15 000 F
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Taxes Réglementaires :</span>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
                        {Math.round(renewalPrimeTotale * 0.145).toLocaleString('fr-FR')} F
                      </div>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
                    <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Prime Totale TTC à Régler</label>
                    <AmountInput value={renewalPrimeTotale} onChange={setRenewalPrimeTotale} required />
                  </div>
                </div>

                {/* Cash Collection & Legal Quittance Option */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', borderRadius: '8px', background: 'var(--surface-sunken)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input
                      type="checkbox"
                      checked={encaisserImmediat}
                      onChange={(e) => setEncaisserImmediat(e.target.checked)}
                      style={{ width: '17px', height: '17px', accentColor: '#10b981' }}
                    />
                    <strong style={{ color: '#fff' }}>Encaisser la prime immédiatement et émettre la Quittance CIMA</strong>
                  </label>

                  {encaisserImmediat && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.35rem' }}>
                      <div>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Mode de Paiement</label>
                        <select
                          className="form-control"
                          value={modePaiement}
                          onChange={(e) => setModePaiement(e.target.value)}
                        >
                          <option value="CHEQUE">Chèque Bancaire</option>
                          <option value="ESPECES">Espèces / Caisse</option>
                          <option value="MOBILE_MONEY">Mobile Money (Wave / Orange)</option>
                          <option value="VIREMENT">Virement Bancaire</option>
                        </select>
                      </div>
                      <div>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Référence / Bordereau</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="Ex: CHQ-BNI-98822"
                          value={referencePaiement}
                          onChange={(e) => setReferencePaiement(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={onClose}>
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      background: 'linear-gradient(135deg, #059669, #10b981)',
                      padding: '0.65rem 1.5rem',
                      fontWeight: 700,
                    }}
                  >
                    <CheckCircle2 size={18} />
                    <span>Valider le Renouvellement & Émettre</span>
                  </button>
                </div>
              </form>
            )}

            {/* TAB 2: AVENANT DE MODIFICATION */}
            {activeTab === 'avenant' && (
              <form onSubmit={handleAvenantSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Nature de l'Avenant</label>
                  <select
                    className="form-control"
                    value={avenantType}
                    onChange={(e) => setAvenantType(e.target.value)}
                  >
                    <option value="autre">Autre modification des conditions particulières</option>
                    <option value="immatriculation">Changement d'immatriculation</option>
                    <option value="beneficiaire">Changement de bénéficiaire / Souscripteur</option>
                    <option value="adresse">Changement de zone géographique ou d'adresse</option>
                    <option value="garanties">Modification / Adjonction de garanties</option>
                  </select>
                </div>

                {avenantType === 'immatriculation' && (
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Nouvelle Immatriculation du Véhicule</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Ex: 8899 KJ 01"
                      required
                      value={nouvelleImmatriculation}
                      onChange={(e) => setNouvelleImmatriculation(e.target.value.toUpperCase())}
                    />
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Date d'Effet de l'Avenant</label>
                    <input
                      type="date"
                      className="form-control"
                      value={dateEffetAvenant}
                      onChange={(e) => setDateEffetAvenant(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Prime Additionnelle / Ristourne</label>
                    <AmountInput value={primeAdditionnelle} onChange={setPrimeAdditionnelle} placeholder="0 si sans incidence financière" allowNegative />
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Motif de l'Avenant</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={motifAvenant}
                    onChange={(e) => setMotifAvenant(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={onClose}>
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.5rem' }}
                  >
                    <Check size={18} />
                    <span>Enregistrer l'Avenant & Mettre à Jour</span>
                  </button>
                </div>
              </form>
            )}

            {/* TAB 3: TRANSFORMATION DE FORMULE */}
            {activeTab === 'transformation' && (
              <form onSubmit={handleTransformationSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div
                  style={{
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    background: 'rgba(59, 130, 246, 0.1)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <strong style={{ color: '#60a5fa' }}>Transformation Contractuelle :</strong> Permet le surclassement de produit (ex: Tiers Simple vers Tous Risques), le basculement vers une autre compagnie ou la refonte intégrale des garanties.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Nouveau Produit / Formule</label>
                    <input
                      type="text"
                      className="form-control"
                      value={nouveauProduit}
                      onChange={(e) => setNouveauProduit(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Compagnie Porteuse</label>
                    <input
                      type="text"
                      className="form-control"
                      value={nouvelleCompagnie}
                      onChange={(e) => setNouvelleCompagnie(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Nouvelle Prime Totale Annuelle</label>
                  <AmountInput value={nouvellePrime} onChange={setNouvellePrime} required />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Motif de la Transformation</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={motifTransformation}
                    onChange={(e) => setMotifTransformation(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={onClose}>
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.5rem', background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
                  >
                    <Sparkles size={18} />
                    <span>Valider la Transformation</span>
                  </button>
                </div>
              </form>
            )}

            {/* TAB 4: RÉSILIATION */}
            {activeTab === 'resiliation' && (
              <form onSubmit={handleResiliationSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
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
                    <strong style={{ color: '#ef4444' }}>Contrôle Réglementaire CIMA :</strong> Toute résiliation est définitive et consignée au registre central.
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Motif de Résiliation CIMA</label>
                  <select
                    className="form-control"
                    value={motifResiliation}
                    onChange={(e) => setMotifResiliation(e.target.value)}
                  >
                    <option value="Défaut de paiement de la prime (Article 13 CIMA)">
                      Défaut de paiement de la prime (Article 13 CIMA)
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
                  <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Date d'Effet de Résiliation</label>
                  <input
                    type="date"
                    className="form-control"
                    value={dateResiliation}
                    onChange={(e) => setDateResiliation(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={onClose}>
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="btn btn-danger"
                    style={{ backgroundColor: '#dc2626', borderColor: '#dc2626', color: '#fff', padding: '0.65rem 1.5rem' }}
                  >
                    Confirmer la Résiliation CIMA
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

// Also export as ContractActionModal for backward compatibility
export const ContractActionModal = PolicyMovementModal;

export default PolicyMovementModal;
