import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { contractApi, asaciApi, transportApi } from '../../../api/endpoints';
import { dataStore } from '../../../api/dataStore';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { PolicyMovementModal } from './PolicyMovementModal';
import { ContractDocumentsModal } from './ContractDocumentsModal';
import {
  ArrowLeft,
  Shield,
  FileText,
  Printer,
  Car,
  CreditCard,
  RefreshCw,
  CheckCircle,
  Download,
  Sparkles,
  Layers,
  Calendar,
  Paperclip,
  MapPin,
  User,
  Building2,
  Banknote,
  Ship,
  Eye,
} from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import { formatDate } from '../../../utils/dateUtils';
import { printContratFacture, printContratConditionsParticulieres, printBordereauTransport, estDevisTransport } from '../../../utils/exportUtils';
import { CertificatsTransportModal } from '../quotes/NewTransportQuotePage';

export const ContractDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { success } = useToast();
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [movementTab, setMovementTab] = useState('renouvellement');
  const [initialOp, setInitialOp] = useState(null);

  const [isDocModalOpen, setIsDocModalOpen] = useState(false);
  const [activeDoc, setActiveDoc] = useState('facture');

  const [currentContract, setCurrentContract] = useState(null);
  const [attestationsList, setAttestationsList] = useState([]);

  useEffect(() => {
    let isMounted = true;
    if (id) {
      const local = dataStore.getContractById(id);
      if (local) setCurrentContract(local);

      contractApi.getContractDetail(id).then((bc) => {
        if (isMounted && bc) setCurrentContract(bc);
      }).catch((err) => {
        console.warn('Fallback contrat local:', err?.message || err);
      });

      asaciApi.getAttestations().then((atts) => {
        if (isMounted && Array.isArray(atts)) setAttestationsList(atts);
      }).catch(() => {});
    }
    return () => { isMounted = false; };
  }, [id]);

  const contract = currentContract || dataStore.getContractById(id) || {};

  // Contrat Transport : certificats GUCE du bordereau dont il est issu (une ligne de contrat par certificat)
  const contratTransport = estDevisTransport(contract);
  const [bordereauTransport, setBordereauTransport] = useState(null);
  const [certificatsOuverts, setCertificatsOuverts] = useState(false);
  useEffect(() => {
    let actif = true;
    setBordereauTransport(null);
    if (id && contratTransport) {
      transportApi.getCertificats({ idcontrat: id })
        .then((d) => { if (actif) setBordereauTransport(d); })
        .catch(() => { if (actif) setBordereauTransport({ erreur: true }); });
    }
    return () => { actif = false; };
  }, [id, contratTransport]);
  const [endorsements, setEndorsements] = useState(() =>
    dataStore.getEndorsementsByPolicy(contract.numeropolice || contract.id)
  );

  useEffect(() => {
    const unsub = dataStore.subscribe(() => {
      setEndorsements(dataStore.getEndorsementsByPolicy(contract.numeropolice || contract.id));
    });
    return unsub;
  }, [contract.numeropolice, contract.id]);

  const attestation = attestationsList.find((a) => a.police === contract.numeropolice || a.numeropolice === contract.numeropolice);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => navigate('/user/contracts')} style={{ padding: '0.4rem 0.8rem' }}>
            <ArrowLeft size={16} /> Retour
          </button>
          <div>
            <h1 className="title-xl">{contract.numeropolice}</h1>
            <span style={{ fontSize: '0.8rem', color: '#34d399' }}>Police en vigueur • {contract.compagnie}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Action Renouveler (Mise en avant) */}
          <button
            className="btn"
            style={{
              padding: '0.45rem 0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'linear-gradient(135deg, #059669, #10b981)',
              color: '#fff',
              border: 'none',
              fontWeight: 600,
              boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)',
              cursor: 'pointer',
            }}
            onClick={() => {
              setInitialOp(null);
              setMovementTab('renouvellement');
              setIsMovementModalOpen(true);
            }}
            title="Renouveler la police d'assurance et imprimer le certificat CIMA"
          >
            <RefreshCw size={16} />
            <span>Renouveler la Police</span>
          </button>

          {/* Action Avenant */}
          <button
            className="btn btn-secondary"
            onClick={() => {
              setInitialOp(null);
              setMovementTab('avenant');
              setIsMovementModalOpen(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#60a5fa', borderColor: 'rgba(96, 165, 250, 0.35)' }}
            title="Émettre un avenant de modification contractuelle"
          >
            <FileText size={16} />
            <span>Émettre un Avenant</span>
          </button>

          {/* Action Transformation */}
          <button
            className="btn btn-secondary"
            onClick={() => {
              setInitialOp(null);
              setMovementTab('transformation');
              setIsMovementModalOpen(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#c084fc', borderColor: 'rgba(192, 132, 252, 0.35)' }}
            title="Transformer la formule ou changer de compagnie"
          >
            <Sparkles size={16} />
            <span>Transformer</span>
          </button>

          {/* Action Imprimer Quittance */}
          <button className="btn btn-secondary" onClick={() => setIsReceiptModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Printer size={16} />
            <span>Quittance CIMA</span>
          </button>
        </div>
      </div>

      {/* SECTION 1 : Informations Générales & Caractéristiques du Risque */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {/* Informations Générales */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 className="title-md" style={{ color: '#fff', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <User size={18} color="#60a5fa" />
            Informations Générales
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Nom et prénoms du client :</span>
              <strong style={{ color: '#fff' }}>{contract.client_nom}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Adresse :</span>
              <span style={{ color: '#e2e8f0' }}>{contract.adresse || 'Abidjan, Côte d\'Ivoire'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Intermédiaire :</span>
              <strong style={{ color: '#38bdf8' }}>{contract.intermediaire || 'OREOLE ASSURANCES'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Compagnie d'assurance :</span>
              <strong style={{ color: '#fff' }}>{contract.compagnie}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border-subtle)', paddingTop: '0.5rem' }}>
              <span className="text-muted">Date d'émission :</span>
              <span style={{ color: '#e2e8f0' }}>{contract.date_emission || contract.date_effet || '2026-01-01'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Date d'effet :</span>
              <strong style={{ color: '#34d399' }}>{formatDate(contract.date_effet)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Date d'expiration :</span>
              <strong style={{ color: '#60a5fa' }}>{formatDate(contract.date_expiration)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border-subtle)', paddingTop: '0.5rem' }}>
              <span className="text-muted">Dernière modification :</span>
              <span style={{ color: '#93c5fd', fontSize: '0.82rem', fontWeight: 600 }}>
                {contract.date_derniere_modification || contract.DateMaj || contract.date_maj || contract.date_emission || contract.date_effet || '-'}
              </span>
            </div>
          </div>
        </div>

        {/* Détails Techniques & Garanties */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 className="title-md" style={{ color: '#fff', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Shield size={18} color="#3b82f6" />
            Caractéristiques & Risque Assuré
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Branche de couverture :</span>
              <span style={{ fontWeight: 600, color: '#fff' }}>{contract.branche || 'Automobile'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Formule / Produit :</span>
              <span style={{ color: '#e2e8f0' }}>{contract.produit}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Immatriculation / Réf. Risque :</span>
              <strong style={{ color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>
                {contract.details?.immatriculation || contract.immatriculation || '—'}
              </strong>
            </div>
            {contract.details?.marque && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">Marque & Modèle :</span>
                <span>{contract.details.marque} {contract.details.modele}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed var(--border-subtle)', paddingTop: '0.5rem' }}>
              <span className="text-muted">Statut Contractuel CIMA :</span>
              <StatusBadge label={contract.statut_contrat || 'En cours'} color={contract.statut_contrat_badge || 'emerald'} />
            </div>
            {contract.devis_origine && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">Devis d'origine lié :</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>{contract.devis_origine}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 2 : Décompte Financier & Documents (Conformes exactement aux captures d'écran) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {/* Décompte Financier */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 className="title-md" style={{ color: '#fff', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Banknote size={18} color="#38bdf8" />
            Décompte financier
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Prime nette</span>
              <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>
                {Number(contract.prime_nette || (contract.prime_totale ? Math.round(contract.prime_totale * 0.85) : 337137)).toLocaleString('fr-FR')} FCFA
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Accessoire</span>
              <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>
                {Number(contract.accessoire || 9000).toLocaleString('fr-FR')} FCFA
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Taxe</span>
              <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>
                {Number(contract.taxe || (contract.prime_totale ? Math.max(0, contract.prime_totale - (contract.prime_nette || Math.round(contract.prime_totale * 0.85)) - (contract.accessoire || 9000)) : 49714)).toLocaleString('fr-FR')} FCFA
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', fontSize: '1.05rem' }}>
              <span style={{ fontWeight: 700, color: '#fff' }}>Prime TTC</span>
              <strong style={{ color: '#34d399', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                {Number(contract.prime_totale || 396851).toLocaleString('fr-FR')} FCFA
              </strong>
            </div>
          </div>
        </div>

        {/* Documents */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 className="title-md" style={{ color: '#fff', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={18} color="#c084fc" />
            Documents
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                <Paperclip size={16} color="#94a3b8" />
                <span style={{ color: '#fff' }}>Facture</span>
              </span>
              <button
                type="button"
                className="btn-link"
                style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
                onClick={() => printContratFacture(contract)}
              >
                Imprimer
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                <Paperclip size={16} color="#94a3b8" />
                <span style={{ color: '#fff' }}>Conditions particulières</span>
              </span>
              <button
                type="button"
                className="btn-link"
                style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
                onClick={() => printContratConditionsParticulieres(contract)}
              >
                Imprimer
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                <Paperclip size={16} color="#94a3b8" />
                <span style={{ color: '#fff' }}>Editions Attestation</span>
              </span>
              <button
                type="button"
                className="btn-link"
                style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
                onClick={() => { setActiveDoc('attestation'); setIsDocModalOpen(true); }}
              >
                Editer
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                <Paperclip size={16} color="#94a3b8" />
                <span style={{ color: '#fff' }}>Carte Brune</span>
              </span>
              <button
                type="button"
                className="btn-link"
                style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
                onClick={() => { setActiveDoc('carte_brune'); setIsDocModalOpen(true); }}
              >
                Imprimer
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Transport : bordereau GUCE d'origine */}
      {contratTransport && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 className="title-md" style={{ color: 'var(--text-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Ship size={18} color="#38bdf8" />
            Certificats GUCE du contrat
          </h3>
          {!bordereauTransport && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Chargement des certificats…</div>}
          {bordereauTransport && (bordereauTransport.erreur || !bordereauTransport.Certificats?.length) && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Aucun certificat GUCE rattaché à ce contrat (contrat repris d'URANUS ou saisi hors GUCE).</div>
          )}
          {bordereauTransport?.Certificats?.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', fontSize: '0.85rem' }}>
                <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Bordereau</div><strong>du {formatDate(bordereauTransport.DebutPeriode)} au {formatDate(bordereauTransport.FinPeriode)}</strong></div>
                <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Certificats</div><strong>{bordereauTransport.Totaux.Certificats}</strong></div>
                <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Valeur assurée</div><strong>{Math.round(bordereauTransport.Totaux.ValeurAssurance).toLocaleString('fr-FR')} FCFA</strong></div>
                <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total général</div><strong>{Math.round(bordereauTransport.Totaux.TotalGeneral).toLocaleString('fr-FR')} FCFA</strong></div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCertificatsOuverts(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Eye size={15} /> Voir les certificats</button>
                <button type="button" className="btn btn-secondary" onClick={() => printBordereauTransport({ idcontrat: id })} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Printer size={15} /> Imprimer le bordereau</button>
              </div>
            </>
          )}
        </div>
      )}
      {certificatsOuverts && (
        <CertificatsTransportModal
          filtres={{ idcontrat: id }}
          titre={`Certificats du contrat ${contract.numeropolice || ''}`.trim()}
          onClose={() => setCertificatsOuverts(false)}
        />
      )}

      {/* SECTION 3 : Situation d'Encaissement & Recouvrement */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 className="title-md" style={{ color: '#fff', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CreditCard size={18} color="#10b981" />
          Situation d'Encaissement & Quittance
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', fontSize: '0.875rem' }}>
          <div style={{ padding: '0.75rem', background: 'var(--surface-sunken)', borderRadius: '6px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Prime Totale TTC</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)' }}>
              {Number(contract.prime_totale || 396851).toLocaleString('fr-FR')} FCFA
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: 'var(--surface-sunken)', borderRadius: '6px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Montant Encaissé</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
              {Number(contract.montant_encaisse || 0).toLocaleString('fr-FR')} FCFA
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: 'var(--surface-sunken)', borderRadius: '6px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Reste à Recouvrer</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: (Number(contract.prime_totale || 396851) - Number(contract.montant_encaisse || 0)) > 0 ? '#fb7185' : '#34d399', fontFamily: 'var(--font-mono)' }}>
              {Math.max(0, Number(contract.prime_totale || 396851) - Number(contract.montant_encaisse || 0)).toLocaleString('fr-FR')} FCFA
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: 'var(--surface-sunken)', borderRadius: '6px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Statut Comptable</div>
            <StatusBadge label={contract.statut_encaissement || (Number(contract.montant_encaisse || 0) >= Number(contract.prime_totale || 396851) ? 'Soldé' : 'À Encaisser')} color={Number(contract.montant_encaisse || 0) >= Number(contract.prime_totale || 396851) ? 'emerald' : 'amber'} />
          </div>
        </div>
      </div>

      {/* ASACI Digital Certificate section (if applicable) */}
      {attestation && (
        <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 className="title-md" style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Car size={18} color="#3b82f6" />
                Attestation Digitale ASACI Associée
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Certificat e-attestation enregistré sur le serveur central des assurances de Côte d'Ivoire.
              </p>
            </div>
            <StatusBadge label={attestation.statut_asaci} color={attestation.statut_badge} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem', fontSize: '0.875rem' }}>
            <div><strong>N° Attestation :</strong> <span style={{ color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>{attestation.numero_attestation}</span></div>
            <div><strong>Immatriculation :</strong> {attestation.immatriculation}</div>
            <div><strong>Code de Sécurité :</strong> {attestation.code_securite}</div>
            <div><strong>Expiration ASACI :</strong> {formatDate(attestation.date_expiration)}</div>
          </div>
        </div>
      )}

      {/* Historique des Avenants & Renouvellements CIMA */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 className="title-md" style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileText size={18} color="#10b981" />
              Historique des Avenants & Renouvellements de la Police ({endorsements.length})
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Actes modificatifs, prorogations de durée, attestations et certificats officiels CIMA.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn"
              style={{
                background: 'linear-gradient(135deg, #059669, #10b981)',
                color: '#fff',
                fontSize: '0.8rem',
                padding: '0.4rem 0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontWeight: 600,
                border: 'none',
                boxShadow: '0 2px 4px rgba(16, 185, 129, 0.3)',
                cursor: 'pointer',
              }}
              onClick={() => {
                setInitialOp(null);
                setMovementTab('renouvellement');
                setIsMovementModalOpen(true);
              }}
            >
              <RefreshCw size={14} />
              <span>Nouveau Renouvellement</span>
            </button>
          </div>
        </div>

        {endorsements.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed var(--border-subtle)' }}>
            <FileText size={32} color="var(--text-muted)" style={{ margin: '0 auto 0.5rem' }} />
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600 }}>Aucun avenant ou renouvellement pour le moment.</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              Utilisez le bouton ci-dessus pour renouveler la police ou émettre un avenant de modification.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '0.825rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.65rem' }}>N° Avenant</th>
                  <th style={{ textAlign: 'left', padding: '0.65rem' }}>Mouvement</th>
                  <th style={{ textAlign: 'left', padding: '0.65rem' }}>Nature / Motif</th>
                  <th style={{ textAlign: 'left', padding: '0.65rem' }}>Période Couverte</th>
                  <th style={{ textAlign: 'right', padding: '0.65rem' }}>Incidence Financière</th>
                  <th style={{ textAlign: 'center', padding: '0.65rem' }}>Certificat Officiel</th>
                </tr>
              </thead>
              <tbody>
                {endorsements.map((m) => (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '0.65rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#34d399' }}>
                      {m.numero_avenant}
                    </td>
                    <td style={{ padding: '0.65rem' }}>
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          background:
                            m.type_mouvement === 'Renouvellement'
                              ? 'rgba(16, 185, 129, 0.15)'
                              : m.type_mouvement === 'Transformation'
                              ? 'rgba(168, 85, 247, 0.15)'
                              : 'rgba(59, 130, 246, 0.15)',
                          color:
                            m.type_mouvement === 'Renouvellement'
                              ? '#34d399'
                              : m.type_mouvement === 'Transformation'
                              ? '#c084fc'
                              : '#60a5fa',
                        }}
                      >
                        {m.type_mouvement}
                      </span>
                    </td>
                    <td style={{ padding: '0.65rem', color: 'var(--text-secondary)' }}>
                      {m.nature || m.details?.motif || 'Avenant de police'}
                    </td>
                    <td style={{ padding: '0.65rem' }}>
                      {m.date_effet ? `Du ${formatDate(m.date_effet)} au ${m.date_expiration || '31/12/2026'}` : m.date_avenant}
                    </td>
                    <td style={{ padding: '0.65rem', textAlign: 'right', fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)' }}>
                      {Number(m.prime_totale || 0).toLocaleString('fr-FR')} FCFA
                    </td>
                    <td style={{ padding: '0.65rem', textAlign: 'center' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                        onClick={() => {
                          setInitialOp({
                            type: m.type_mouvement || 'Renouvellement',
                            endorsement: m,
                            contract,
                            quittance: m.details?.quittance_num ? { numero_quittance: m.details.quittance_num } : null,
                          });
                          setIsMovementModalOpen(true);
                        }}
                        title="Imprimer le certificat officiel CIMA pour ce mouvement"
                      >
                        <Printer size={13} color="#0284c7" />
                        <span>Imprimer</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Mouvements CIMA & Impression Certificat */}
      <PolicyMovementModal
        isOpen={isMovementModalOpen}
        onClose={() => {
          setIsMovementModalOpen(false);
          setInitialOp(null);
        }}
        contract={contract}
        initialTab={movementTab}
        initialOperation={initialOp}
        onSuccess={() => {
          const updated = dataStore.getContractById(contract.numeropolice || contract.id);
          if (updated) setCurrentContract(updated);
          setEndorsements(dataStore.getEndorsementsByPolicy(contract.numeropolice || contract.id));
        }}
      />

      {/* Modal Quittance CIMA */}
      <Modal
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        title="Quittance Officielle de Prime d'Assurance CIMA"
        subtitle={`Police N° ${contract.numeropolice} • ${contract.compagnie}`}
        maxWidth="640px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ borderBottom: '2px solid var(--border-color)', paddingBottom: '0.75rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)' }}>
              RÉPUBLIQUE DE CÔTE D'IVOIRE • CODE DES ASSURANCES CIMA (ART. 13)
            </div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
              LE PHARE – QUITTANCE D'ENCAISSEMENT DÉFINITIVE
            </div>
            <div style={{ fontSize: '0.8rem', color: '#60a5fa', marginTop: '0.2rem' }}>
              Atteste de la libération intégrale des obligations de paiement du souscripteur.
            </div>
          </div>

          <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Compagnie Assureur :</span>
              <strong>{contract.compagnie}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Souscripteur / Assuré :</span>
              <strong style={{ color: '#fff' }}>{contract.client_nom}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Branche & Produit :</span>
              <span>{contract.produit}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Période d'Assurance :</span>
              <span>Du {formatDate(contract.date_effet)} au {formatDate(contract.date_expiration)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Montant Net de Prime :</span>
              <span>{(Number(contract.prime_totale || 396851) * 0.85).toLocaleString('fr-FR')} FCFA</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Accessoires & Taxes Légales :</span>
              <span>{(Number(contract.prime_totale || 396851) * 0.15).toLocaleString('fr-FR')} FCFA</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--border-color)', paddingTop: '0.5rem', fontSize: '1.05rem' }}>
              <span style={{ fontWeight: 700 }}>Total Prime Encaissée TTC :</span>
              <strong style={{ color: '#34d399', fontFamily: 'var(--font-mono)' }}>{Number(contract.prime_totale || 396851).toLocaleString('fr-FR')} FCFA</strong>
            </div>
          </div>

          <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', padding: '0.85rem', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            <strong>Validité Juridique CIMA (Article 13) :</strong>
            <p style={{ margin: '0.2rem 0 0 0' }}>
              Le paiement effectif de la prime est la condition substantielle de prise d'effet des garanties. La délivrance de la présente quittance confère plein effet juridique à la couverture d'assurance.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={() => setIsReceiptModalOpen(false)}>
              Fermer
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                window.print();
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Printer size={15} />
              <span>Imprimer Quittance</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal Documents Contractuels (Facture, Conditions Particulières, Attestation, Carte Brune) */}
      <ContractDocumentsModal
        isOpen={isDocModalOpen}
        onClose={() => setIsDocModalOpen(false)}
        docType={activeDoc}
        contract={contract}
        onSaveContract={(updated) => {
          setCurrentContract(updated);
          dataStore.saveContract(updated);
        }}
      />
    </div>
  );
};

export default ContractDetailPage;
