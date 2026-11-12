import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { claimsApi, conventionsApi } from '../../../api/endpoints';
import { Modal } from '../../../components/common/Modal';
import { useToast } from '../../../context/ToastContext';
import { formatDate } from '../../../utils/dateUtils';
import {
  Shield,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Building,
  Banknote,
  User,
  Clock,
  Printer,
  FileCheck,
  Send,
  HelpCircle,
  Lock,
  ExternalLink,
} from 'lucide-react';
import { nomCabinet } from '../../../utils/parametrage';
import { messageErreurApi } from '../../../utils/financeUtils';

export const ClaimDetailPage = () => {
  const navigate = useNavigate();
  const { success, error, info } = useToast();
  const [searchParams] = useSearchParams();
  const claimId = searchParams.get('id') || '1';

  const [claim, setClaim] = useState({
    numero_sinistre: claimId,
    assure_nom: 'Client',
    police_num: 'POL-2026-0001',
    compagnie: 'NSIA Assurances CI',
    nature: 'Matériel',
    statut: 'En cours',
    montant_reclame: 500000,
    montant_indemnise: 0,
    pieces_justificatives: [],
  });
  const [pieces, setPieces] = useState([]);
  const [indemniteInput, setIndemniteInput] = useState(500000);
  const [conventions, setConventions] = useState([]);
  
  // Modals
  const [quittanceModalOpen, setQuittanceModalOpen] = useState(false);
  const [quittanceData, setQuittanceData] = useState(null);
  const [accordModalOpen, setAccordModalOpen] = useState(false);
  const [accordMotif, setAccordMotif] = useState('Dépassement du plafond de délégation conventionné.');

  useEffect(() => {
    let isMounted = true;
    const loadDetail = async () => {
      try {
        let claimData = null;
        try {
          claimData = await claimsApi.getClaimDetail(claimId);
        } catch (e) {
          const allClaims = await claimsApi.getClaims().catch(() => []);
          claimData = allClaims.find((c) => String(c.id) === String(claimId) || c.numero_sinistre === claimId) || allClaims[0];
        }
        const cnvList = await conventionsApi.getConventions().catch(() => []);
        if (isMounted) {
          if (claimData) {
            setClaim(claimData);
            if (claimData.pieces_justificatives) setPieces(claimData.pieces_justificatives);
            setIndemniteInput(claimData.montant_indemnise || claimData.montant_reclame || 500000);
          }
          if (cnvList && Array.isArray(cnvList)) {
            setConventions(cnvList);
          }
        }
      } catch (err) {
        console.error('Erreur chargement sinistre Django:', err);
      }
    };
    loadDetail();
    return () => { isMounted = false; };
  }, [claimId]);

  // Find convention threshold
  const convention = conventions.find((cnv) => cnv.compagnie === claim.compagnie) || conventions[0];
  const plafondDelegation = convention?.plafond_delegation_sinistre || 5000000;
  const isWithinDelegation = (claim.montant_reclame || 0) <= plafondDelegation;
  const isAccordObtenu = claim.accord_prealable_obtenu || claim.statut === 'Accord Compagnie Obtenu';
  const canDirectSettle = isWithinDelegation || isAccordObtenu;
  // Dossier réglé : statut du serveur (« Réglé », « Clôturé ») ou de l'écran (« Règlement validé »), ou quittance émise
  const estRegle = ['Règlement validé', 'Réglé', 'Clôturé'].includes(claim.statut) || Boolean(claim.quittance_subrogative_emise);

  const togglePiece = async (index) => {
    const updated = [...pieces];
    updated[index].recu = !updated[index].recu;
    setPieces(updated);
    try {
      await claimsApi.updatePieces(claim.id || claim.numero_sinistre, updated);
    } catch (err) {
      console.warn('API update pieces fallback');
    }
    success(`Statut de la pièce "${updated[index].nom}" mis à jour.`);
  };

  const handleRequestPriorApproval = async (e) => {
    e.preventDefault();
    // Seul l'état enregistré par le serveur est affiché : un refus n'est plus présenté comme une transmission
    let dossier;
    try {
      const res = await claimsApi.requestPriorApproval(claim.id || claim.numero_sinistre, { motif: accordMotif });
      dossier = res?.data;
    } catch (err) {
      error(`Demande d'accord refusée : ${messageErreurApi(err)}`);
      return;
    }
    setClaim(dossier && dossier.numero_sinistre ? dossier : {
      ...claim,
      statut: 'En attente accord compagnie',
      accord_prealable_requis: true,
    });
    setAccordModalOpen(false);
    success(`Demande de dérogation CIMA transmise à la direction des sinistres de ${claim.compagnie}.`);
  };

  const handleValidateSettlement = async () => {
    if (!canDirectSettle) {
      error(`Règlement direct impossible : le montant réclamé dépasse le plafond de délégation de ${plafondDelegation.toLocaleString('fr-FR')} FCFA (Code CIMA).`);
      return;
    }

    const allPiecesOk = pieces.filter((p) => p.nom !== 'Quittance d indemnité signée').every((p) => p.recu);
    if (!allPiecesOk) {
      error('Toutes les pièces probantes obligatoires (Code CIMA Livre V) doivent être validées avant règlement.');
      return;
    }
    const amount = Number(indemniteInput);
    // Le règlement (plafond, montant réclamé, dossier déjà réglé) est contrôlé par le serveur : en cas de refus,
    // rien n'est affiché comme réglé ni aucune quittance ouverte
    let dossier;
    try {
      const res = await claimsApi.settleClaim(claim.id || claim.numero_sinistre, amount);
      dossier = res?.data;
    } catch (err) {
      error(`Règlement refusé : ${messageErreurApi(err)}`);
      return;
    }

    const updatedClaim = dossier && dossier.numero_sinistre ? dossier : {
      ...claim,
      statut: 'Réglé',
      montant_indemnise: amount,
      quittance_subrogative_emise: true,
    };
    setClaim(updatedClaim);

    // Auto open Quittance Subrogative
    handleOpenQuittance(updatedClaim);
    success(`Règlement direct de ${amount.toLocaleString('fr-FR')} FCFA validé. Quittance subrogative CIMA (Art. 54) émise.`);
  };

  const handleOpenQuittance = async (currentClaim = claim) => {
    try {
      const res = await claimsApi.getQuittanceSubrogative(currentClaim.id || currentClaim.numero_sinistre);
      if (res && res.numero_sinistre) {
        setQuittanceData(res);
        setQuittanceModalOpen(true);
        return;
      }
    } catch (err) {
      // Refus du serveur (sinistre non réglé, droit insuffisant) : pas de quittance établie par l'écran
      if (err?.response) {
        error(`Quittance indisponible : ${messageErreurApi(err)}`);
        return;
      }
      console.warn('Fallback subrogation view');
    }

    // Serveur injoignable : aperçu reconstitué à partir du dossier affiché
    setQuittanceData({
      numero_quittance: `QT-SUB-${currentClaim.numero_sinistre}`,
      numero_sinistre: currentClaim.numero_sinistre,
      assure_nom: currentClaim.assure_nom,
      police_num: currentClaim.police_num,
      compagnie: currentClaim.compagnie,
      montant_indemnise: currentClaim.montant_indemnise || currentClaim.montant_reclame,
      date_reglement: new Date().toLocaleDateString('fr-FR'),
      nature: currentClaim.nature,
      expert_assigne: currentClaim.expert_assigne,
      mention_legale: "Quittance subrogative établie conformément aux dispositions impératives de l'Article 54 du Code des Assurances CIMA.",
      subrogation_text: `Je soussigné(e), ${currentClaim.assure_nom}, reconnais avoir reçu ce jour du cabinet de courtage LE PHARE, agissant au nom et pour le compte de la compagnie ${currentClaim.compagnie}, la somme de ${(currentClaim.montant_indemnise || currentClaim.montant_reclame).toLocaleString('fr-FR')} FCFA pour indemnisation intégrale et définitive du sinistre référencé ci-dessus. En contrepartie de ce règlement, je subroge expressément ladite compagnie d'assurances dans tous mes droits et actions contre tout tiers responsable conformément à l'article 54 du Code CIMA.`
    });
    setQuittanceModalOpen(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <button
          className="btn btn-secondary"
          onClick={() => navigate('/user/claims')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <ArrowLeft size={16} />
          <span>Retour aux Sinistres</span>
        </button>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {estRegle && (
            <button
              className="btn btn-primary"
              onClick={() => handleOpenQuittance()}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'linear-gradient(135deg, #059669, #10b981)' }}
            >
              <FileCheck size={16} />
              <span>Quittance Subrogative (Art. 54 CIMA)</span>
            </button>
          )}

          <button
            className="btn btn-secondary"
            onClick={() => window.print()}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Printer size={16} />
            <span>Imprimer Dossier CIMA</span>
          </button>
        </div>
      </div>

      {/* CIMA Regulatory Reminder */}
      <div
        style={{
          background: 'rgba(37, 99, 235, 0.07)',
          border: '1px solid rgba(37, 99, 235, 0.25)',
          borderRadius: 'var(--radius-lg)',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <Shield size={20} color="#3b82f6" />
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <strong>Réglementation CIMA (Livre V) :</strong> Tout règlement par mandat délégué de courtage est soumis au respect des pièces probantes obligatoires et au plafond conventionnel de {plafondDelegation.toLocaleString('fr-FR')} FCFA.
          </span>
        </div>
        <span className="badge badge-info">Délégation CIMA</span>
      </div>

      {/* Main Claim Header */}
      <div
        className="glass-panel"
        style={{
          padding: '1.75rem',
          borderRadius: 'var(--radius-xl)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1.5rem',
          borderLeft: '5px solid #f87171',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Dossier Sinistre {claim.numero_sinistre}
            </span>
            <span className={`badge ${estRegle ? 'badge-success' : (claim.statut === 'En attente accord compagnie' ? 'badge-danger' : 'badge-warning')}`}>
              {claim.statut}
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            <div>
              Assuré : <strong style={{ color: 'var(--text-primary)' }}>{claim.assure_nom}</strong>
            </div>
            <div>
              Police : <strong style={{ color: '#60a5fa' }}>{claim.police_num}</strong>
            </div>
            <div>
              Compagnie Mandante : <strong style={{ color: '#34d399' }}>{claim.compagnie}</strong>
            </div>
            <div>
              Survenance : <strong>{formatDate(claim.date_survenance)}</strong>
            </div>
          </div>
        </div>

        {/* Delegation Badge */}
        <div
          style={{
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            background: isWithinDelegation ? 'rgba(52, 211, 153, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${isWithinDelegation ? 'rgba(52, 211, 153, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            textAlign: 'right',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Contrôle Mandat Délégué CIMA</div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: isWithinDelegation ? '#34d399' : '#f87171' }}>
            {isWithinDelegation ? 'Délégation Directe LE PHARE' : 'Dépassement de Plafond CIMA'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Plafond convention {claim.compagnie} : {plafondDelegation.toLocaleString('fr-FR')} FCFA
          </div>
        </div>
      </div>

      {/* Warning if ceiling exceeded */}
      {!isWithinDelegation && !isAccordObtenu && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-lg)',
            padding: '1rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <AlertTriangle size={24} color="#f87171" />
            <div>
              <div style={{ fontWeight: 700, color: '#f87171', fontSize: '0.9rem' }}>
                Blocage Réglementaire CIMA – Plafond de Règlement Direct Dépassé
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Le montant réclamé ({claim.montant_reclame?.toLocaleString('fr-FR')} FCFA) excède le plafond conventionnel autorisé de {plafondDelegation.toLocaleString('fr-FR')} FCFA. Conformément à la convention et au Code CIMA, le courtier ne peut exécuter le règlement sans l'accord préalable écrit de la compagnie.
              </div>
            </div>
          </div>

          <button
            className="btn btn-primary"
            style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)', fontSize: '0.85rem' }}
            onClick={() => setAccordModalOpen(true)}
          >
            <Send size={15} />
            <span>Demander Accord Préalable Compagnie</span>
          </button>
        </div>
      )}

      {/* Two columns: Details & Check-list */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
        {/* Left column: Circumstances & Financials */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 className="title-md" style={{ marginBottom: '1rem' }}>
              Circonstances & Description du Sinistre
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Nature de l'événement : </span>
                <strong>{claim.nature}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Cabinet d'Expertise Désigné : </span>
                <strong>{claim.expert_assigne}</strong>
              </div>
              {claim.recours_compagnie_adverse && (
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontWeight: 700, color: '#818cf8', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Shield size={14} />
                    Recours Subrogatoire Inter-Compagnies (Art. 54 CIMA)
                  </div>
                  <div>Compagnie Adverse : <strong>{claim.recours_compagnie_adverse.compagnie}</strong></div>
                  <div>Montant réclamé en recours : <strong style={{ color: '#34d399' }}>{claim.recours_compagnie_adverse.montant.toLocaleString('fr-FR')} FCFA</strong></div>
                  <div>Statut du recours : <span className="badge badge-info">{claim.recours_compagnie_adverse.statut}</span></div>
                </div>
              )}
            </div>
          </div>

          {/* Settlement / Payment panel */}
          <div className="glass-panel" style={{ padding: '1.5rem', borderTop: '3px solid #34d399' }}>
            <h3 className="title-md" style={{ marginBottom: '0.75rem' }}>
              Règlement de l'Indemnité & Quittance Déléguée
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Conformément à la convention de gestion avec {claim.compagnie}, LE PHARE exécute le paiement de l'indemnité et émet la quittance subrogative officielle.
            </p>

            <div className="form-group">
              <label className="form-label">Montant Final Accordé (FCFA)</label>
              <input
                type="number"
                className="form-control"
                value={indemniteInput}
                onChange={(e) => setIndemniteInput(e.target.value)}
                disabled={estRegle}
              />
            </div>

            {!estRegle ? (
              canDirectSettle ? (
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: '1rem' }}
                  onClick={handleValidateSettlement}
                >
                  Valider le Règlement & Émettre la Quittance Subrogative CIMA
                </button>
              ) : (
                <div style={{ marginTop: '1rem' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ width: '100%', borderColor: '#f87171', color: '#f87171' }}
                    onClick={() => setAccordModalOpen(true)}
                  >
                    <Lock size={16} />
                    <span>Règlement bloqué : Accord Compagnie Requis</span>
                  </button>
                </div>
              )
            ) : (
              <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div
                  style={{
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(52,211,153,0.1)',
                    color: '#34d399',
                    textAlign: 'center',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <CheckCircle2 size={18} />
                  <span>Règlement validé & Quittance Subrogative Émise</span>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleOpenQuittance()}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', width: '100%' }}
                >
                  <FileCheck size={16} color="#34d399" />
                  <span>Consulter la Quittance Subrogative CIMA</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right column: CIMA pieces check-list */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 className="title-md">Check-List Pièces Probantes CIMA</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Règle CIMA Livre V : Zéro dossier incomplet en instruction.
              </p>
            </div>
            <span className="badge badge-info">Code CIMA</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {pieces.map((piece, idx) => (
              <div
                key={idx}
                onClick={() => togglePiece(idx)}
                style={{
                  padding: '0.85rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  background: piece.recu ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)',
                  border: `1px solid ${piece.recu ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: piece.recu ? '#34d399' : 'transparent',
                      border: piece.recu ? 'none' : '2px solid var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                    }}
                  >
                    {piece.recu && <CheckCircle2 size={16} />}
                  </div>
                  <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                    {piece.nom}
                  </span>
                </div>

                <span className={`badge ${piece.recu ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.7rem' }}>
                  {piece.recu ? 'Reçu & Validé' : 'Pièce Manquante'}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <strong>Obligation Réglementaire :</strong> Les délais de prescription et d'instruction CIMA débutent dès la réception de l'intégralité des pièces ci-dessus. Tout paiement prématuré sans pièces probantes engage la responsabilité du courtier.
          </div>
        </div>
      </div>

      {/* Modal Demande Accord Préalable Compagnie */}
      <Modal
        isOpen={accordModalOpen}
        onClose={() => setAccordModalOpen(false)}
        title="Transmission pour Accord Préalable Compagnie (Dérogation CIMA)"
        subtitle={`Dossier N° ${claim.numero_sinistre} • Assureur mandant : ${claim.compagnie}`}
        maxWidth="560px"
      >
        <form onSubmit={handleRequestPriorApproval} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ padding: '0.75rem', background: 'rgba(239, 68, 68, 0.08)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
            Montant sollicité : <strong style={{ color: '#f87171' }}>{claim.montant_reclame?.toLocaleString('fr-FR')} FCFA</strong> (Plafond de convention : {plafondDelegation.toLocaleString('fr-FR')} FCFA)
          </div>

          <div className="form-group">
            <label className="form-label">Motif de la dérogation / Demande d'accord *</label>
            <textarea
              className="form-control"
              rows="3"
              required
              value={accordMotif}
              onChange={(e) => setAccordMotif(e.target.value)}
              placeholder="Préciser les éléments justifiant l'accord préalable de la compagnie..."
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setAccordModalOpen(false)}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}>
              Envoyer la Demande à {claim.compagnie}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Quittance Subrogative CIMA Art. 54 */}
      <Modal
        isOpen={quittanceModalOpen}
        onClose={() => setQuittanceModalOpen(false)}
        title="Quittance Subrogative CIMA (Article 54)"
        subtitle="Acte officiel d'indemnisation et de subrogation légale de plein droit"
        maxWidth="680px"
      >
        {quittanceData && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Header Document */}
            <div
              style={{
                borderBottom: '2px solid var(--border-color)',
                paddingBottom: '1rem',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)' }}>
                RÉPUBLIQUE DE CÔTE D'IVOIRE • CODE DES ASSURANCES CIMA (LIVRE I & V)
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                {nomCabinet()}
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#34d399', marginTop: '0.2rem' }}>
                ACTE DE QUITTANCE SUBROGATIVE D'INDEMNITÉ
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Réf : {quittanceData.numero_quittance || 'QT-SUB-2026-001'} • Date : {formatDate(quittanceData.date_reglement)}
              </div>
            </div>

            {/* Contract / Claim Info */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.75rem',
                fontSize: '0.85rem',
                background: 'var(--bg-surface)',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div>Dossier Sinistre : <strong style={{ color: '#f87171' }}>{quittanceData.numero_sinistre}</strong></div>
              <div>Police d'Assurance : <strong>{quittanceData.police_num}</strong></div>
              <div>Assuré Bénéficiaire : <strong style={{ color: 'var(--text-primary)' }}>{quittanceData.assure_nom}</strong></div>
              <div>Compagnie Mandante : <strong style={{ color: '#3b82f6' }}>{quittanceData.compagnie}</strong></div>
              <div>Nature du Sinistre : <span>{quittanceData.nature || claim.nature}</span></div>
              <div>Cabinet Expert : <span>{quittanceData.expert_assigne || claim.expert_assigne}</span></div>
            </div>

            {/* Financial & Subrogation Clause */}
            <div
              style={{
                background: 'rgba(52, 211, 153, 0.05)',
                border: '1px solid rgba(52, 211, 153, 0.25)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Montant Indemnitaire Total Réglé</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                {Number(quittanceData.montant_indemnise).toLocaleString('fr-FR')} FCFA
              </div>
            </div>

            <div style={{ fontSize: '0.8rem', lineHeight: '1.5', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <strong>Clause de Subrogation Légale (Art. 54 Code CIMA) :</strong>
              <p style={{ marginTop: '0.35rem', marginBottom: 0 }}>
                {quittanceData.subrogation_text}
              </p>
            </div>

            {/* Signatures */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px dashed var(--border-color)', fontSize: '0.8rem' }}>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2.5rem' }}>
                  Pour LE PHARE (Courtier Mandataire Délégué) :
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Cachet & Signature Électronique Validée</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2.5rem' }}>
                  L'Assuré Bénéficiaire ({quittanceData.assure_nom}) :
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Mention manuscrite "Bon pour quittance et subrogation"</div>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setQuittanceModalOpen(false)}>
                Fermer
              </button>
              <button className="btn btn-primary" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Printer size={15} />
                <span>Imprimer l'Acte de Quittance CIMA</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ClaimDetailPage;
