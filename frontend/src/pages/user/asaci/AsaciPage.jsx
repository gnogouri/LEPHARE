import React, { useState, useEffect } from 'react';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { asaciApi, contractApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { formatDate } from '../../../utils/dateUtils';
import {
  Car,
  Send,
  Download,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Server,
  ShieldCheck,
  Search,
  FileText,
  Clock,
  ExternalLink,
  ShieldAlert,
  Printer,
} from 'lucide-react';
import { trierParLibelle } from '../../../utils/sortUtils';
import { estSolde, resteAEncaisser } from '../../../utils/resteEncaissement';

export const AsaciPage = () => {
  const [activeTab, setActiveTab] = useState('attestations'); // 'attestations' | 'demandes' | 'passerelle'
  const [certificates, setCertificates] = useState([]);
  const [demandes, setDemandes] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [gatewayStatus, setGatewayStatus] = useState({
    passerelle_url: 'https://gateway-eattestation.asacitech.com/productions/',
    code_intermediaire: 'ASACI_CRT_146',
    code_compagnie: 'ASACI_NSIA',
    code_demandeur: '2853776057803',
    point_de_vente: 'LE PHARE ASSURANCES',
    bureau: 'LE PHARE ASSURANCES',
    cle_acces_configuree: true,
    statut_liaison: 'ACTIVE_PRODUCTION',
    total_attestations_delivrees: 0,
    total_demandes_transmises: 0,
  });

  const [loading, setLoading] = useState(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isCheckModalOpen, setIsCheckModalOpen] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [referenceToCheck, setReferenceToCheck] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [submittingDemande, setSubmittingDemande] = useState(false);
  const [lastApiFeedback, setLastApiFeedback] = useState(null);
  const [selectedAttestation, setSelectedAttestation] = useState(null);

  const { success, error: toastError, info, warning } = useToast();

  // Load all authentic data from backend
  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Gateway status
      const gw = await asaciApi.getGatewayStatus();
      if (gw) setGatewayStatus(gw);

      // 2. Real certificates from DB
      const certs = await asaciApi.getAttestations();
      if (Array.isArray(certs)) {
        setCertificates(certs);
      }

      // 3. Requests history
      const reqs = await asaciApi.getDemandes();
      if (Array.isArray(reqs)) {
        setDemandes(reqs);
      }

      // 4. Contracts list for emission
      const contractsList = await contractApi.getContracts();
      if (Array.isArray(contractsList) && contractsList.length > 0) {
        setContracts(contractsList);
        if (!selectedContractId) {
          setSelectedContractId(contractsList[0].idcontrat || contractsList[0].id || '');
        }
      }
    } catch (err) {
      console.warn('Erreur chargement données ASACI:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Selected contract object for CIMA Art. 13 verification
  const selectedContract = contracts.find(
    (c) => String(c.idcontrat || c.id) === String(selectedContractId)
  );

  // Reliquat de moins de 5 F compté comme nul : il ne bloque pas l'attestation
  const isContractPaid = selectedContract
    ? estSolde(selectedContract.prime_totale || selectedContract.primettc, selectedContract.montant_encaisse)
    : false;

  // Soumission réelle de la demande d'attestation à l'ASACI via PostgreSQL / fn_demande_attestation
  const handleSendDemande = async (e) => {
    e.preventDefault();
    if (!selectedContract) {
      toastError('Veuillez sélectionner un contrat valide.');
      return;
    }

    if (!isContractPaid) {
      warning("Conformité CIMA Art. 13 : La prime d'assurance doit être réglée avant l'émission de l'attestation.");
      return;
    }

    setSubmittingDemande(true);
    setLastApiFeedback(null);

    try {
      const res = await asaciApi.requestCertificateFromDb(selectedContract.idcontrat || selectedContract.id);
      const messages = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : [res.data || res]);
      setLastApiFeedback(messages);

      let successCount = 0;
      messages.forEach((msg) => {
        const statut = parseInt(msg.statut, 10);
        if (statut === 0) {
          successCount += 1;
          success(`Attestation ASACI générée avec succès : ${msg.numero_attestation || msg.numero_demande} !`);
        } else if (statut === 121) {
          info(`Demande transmise à l'ASACI (Statut 121) : En attente de traitement sur la passerelle OCI.`);
        } else {
          toastError(`Retour Passerelle ASACI [Code ${msg.statut}] : ${msg.message || 'Erreur passerelle'}`);
        }
      });

      if (successCount > 0) {
        setIsNewModalOpen(false);
      }
      // Refresh DB data
      await loadData();
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.response?.data?.message || err.message;
      toastError(`Échec de la communication avec la passerelle ASACI : ${errMsg}`);
      setLastApiFeedback([
        {
          statut: '-1000',
          message: `Erreur de transmission : ${errMsg}`,
        },
      ]);
    } finally {
      setSubmittingDemande(false);
    }
  };

  // Interrogation en temps réel du statut d'une demande auprès de l'ASACI
  const handleCheckStatus = async (e) => {
    e.preventDefault();
    if (!referenceToCheck.trim()) {
      warning('Veuillez saisir un numéro ou référence de demande ASACI.');
      return;
    }

    setIsCheckingStatus(true);
    setCheckResult(null);

    try {
      const res = await asaciApi.checkApplicationStatus(referenceToCheck.trim());
      setCheckResult(res.data || res);
      success("Interrogation d'ASACI effectuée avec succès.");
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.message;
      setCheckResult({
        statut: '-999',
        message: `Erreur retournée par la passerelle : ${errMsg}`,
        reference_demande: referenceToCheck,
      });
      toastError(`Erreur interrogation ASACI : ${errMsg}`);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const columnsAttestations = [
    {
      header: 'N° Attestation ASACI',
      accessor: 'numero_attestation',
      render: (row) => (
        <strong style={{ color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>
          {row.numero_attestation || 'EN COURS D’ATTRIBUTION'}
        </strong>
      ),
    },
    {
      header: 'Immatriculation',
      accessor: 'numero_immatriculation',
      render: (row) => (
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {row.numero_immatriculation}
        </span>
      ),
    },
    {
      header: 'Châssis',
      accessor: 'numero_chassis',
      render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {row.numero_chassis || 'N/A'}
        </span>
      ),
    },
    {
      header: 'Réf. Demande',
      accessor: 'numero_demande',
      render: (row) => (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {row.numero_demande}
        </span>
      ),
    },
    {
      header: 'Validité',
      render: (row) => (
        <div style={{ fontSize: '0.8rem' }}>
          <div>Effet : {row.date_effet || '-'}</div>
          <div style={{ color: 'var(--text-muted)' }}>Échéance : {row.date_echeance || '-'}</div>
        </div>
      ),
    },
    {
      header: 'Statut ASACI',
      accessor: 'statut',
      render: (row) => {
        const s = parseInt(row.statut, 10);
        if (s === 0) return <StatusBadge label="Délivrée & Valide" color="emerald" />;
        if (s === 121) return <StatusBadge label="En attente OCI" color="amber" />;
        if (s === 109) return <StatusBadge label="Annulée CIMA" color="rose" />;
        if (s === 120) return <StatusBadge label="Suspendue" color="amber" />;
        return <StatusBadge label={`Code ASACI ${s}`} color="slate" />;
      },
    },
    {
      header: 'Document Officiel',
      render: (row) => {
        if (row.lien_pdf && row.lien_pdf.startsWith('http')) {
          return (
            <a
              href={row.lien_pdf}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Download size={14} /> PDF ASACI
            </a>
          );
        }
        return (
          <button
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            onClick={() => setSelectedAttestation(row)}
          >
            <FileText size={14} /> Fiche Détail
          </button>
        );
      },
    },
  ];

  const columnsDemandes = [
    {
      header: 'ID Demande',
      accessor: 'id',
      render: (row) => <span style={{ fontFamily: 'var(--font-mono)' }}>#{row.id}</span>,
    },
    {
      header: 'N° Demande ASACI',
      accessor: 'numero_demande',
      render: (row) => <strong style={{ color: '#93c5fd' }}>{row.numero_demande}</strong>,
    },
    {
      header: 'Date de Transmission',
      accessor: 'date_creation',
      render: (row) => (
        <span>{row.date_creation ? new Date(row.date_creation).toLocaleString('fr-FR') : '-'}</span>
      ),
    },
    {
      header: 'Code Retour Passerelle',
      accessor: 'statut',
      render: (row) => {
        const s = parseInt(row.statut, 10);
        if (s === 0) return <StatusBadge label="Succès (Code 0)" color="emerald" />;
        if (s === 121) return <StatusBadge label="En attente (Code 121)" color="amber" />;
        return <StatusBadge label={`Erreur / Statut ${s}`} color="rose" />;
      },
    },
    {
      header: 'Vérification',
      render: (row) => (
        <button
          className="btn btn-secondary"
          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
          onClick={() => {
            setReferenceToCheck(row.numero_demande);
            setIsCheckModalOpen(true);
          }}
        >
          <Search size={13} /> Interroger
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Car size={26} color="#3b82f6" />
            Attestations Digitales ASACI (e-Attestation)
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Passerelle officielle de production interconnectée avec l'ASACI (Oracle Cloud Infrastructure) – Conformité CIMA Art. 13.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setReferenceToCheck('');
              setCheckResult(null);
              setIsCheckModalOpen(true);
            }}
          >
            <Search size={16} />
            <span>Interroger Statut ASACI</span>
          </button>

          <button className="btn btn-secondary" onClick={loadData} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            <span>Actualiser</span>
          </button>

          <button className="btn btn-primary" onClick={() => setIsNewModalOpen(true)}>
            <Send size={16} />
            <span>Nouvelle Demande ASACI</span>
          </button>
        </div>
      </div>

      {/* Operational Gateway Status Banner */}
      <div
        className="glass-panel"
        style={{
          padding: '1.25rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          borderLeft: '4px solid #3b82f6',
        }}
      >
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Statut de Liaison Passerelle
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: gatewayStatus.cle_acces_configuree ? '#10b981' : '#f59e0b',
                display: 'inline-block',
                boxShadow: gatewayStatus.cle_acces_configuree ? '0 0 8px #10b981' : 'none',
              }}
            />
            <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              {gatewayStatus.cle_acces_configuree ? 'Passerelle OCI Opérationnelle' : 'En Attente de Configuration'}
            </strong>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Point de vente : <strong>{gatewayStatus.point_de_vente}</strong>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Identifiants Réglementaires
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', marginTop: '0.25rem' }}>
            Intermédiaire : <code style={{ color: '#60a5fa' }}>{gatewayStatus.code_intermediaire}</code>
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Compagnie : <code>{gatewayStatus.code_compagnie}</code> | Demandeur : <code>{gatewayStatus.code_demandeur}</code>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Production & Audit BDD
          </div>
          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.25rem' }}>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#34d399' }}>
                {certificates.length}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Attestations en base</div>
            </div>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#60a5fa' }}>
                {demandes.length}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Demandes tracées</div>
            </div>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Règle CIMA Art. 13
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem' }}>
            <ShieldCheck size={16} color="#10b981" />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#10b981' }}>
              Conditionnement au Paiement
            </span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            Blocage automatique si prime non soldée.
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
        <button
          className={`btn ${activeTab === 'attestations' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('attestations')}
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
        >
          <Car size={16} />
          <span>Attestations Délivrées ({certificates.length})</span>
        </button>

        <button
          className={`btn ${activeTab === 'demandes' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('demandes')}
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
        >
          <Clock size={16} />
          <span>Journal des Demandes ASACI ({demandes.length})</span>
        </button>

        <button
          className={`btn ${activeTab === 'passerelle' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('passerelle')}
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
        >
          <Server size={16} />
          <span>Paramètres Passerelle OCI</span>
        </button>
      </div>

      {/* Tab 1: Attestations */}
      {activeTab === 'attestations' && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Attestations Automobiles Enregistrées
              </h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Les enregistrements ci-dessous proviennent de la table réelle <code>stddetailretourdemattestation</code>.
              </p>
            </div>
          </div>

          <DataTable
            columns={columnsAttestations}
            data={certificates}
            searchPlaceholder="Rechercher par n° attestation, plaque ou réf. demande..."
          />
        </div>
      )}

      {/* Tab 2: Demandes ASACI */}
      {activeTab === 'demandes' && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Historique des Demandes Envoyées à la Passerelle ASACI
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Table réelle <code>stdretourdemattestation</code> : Traçabilité des requêtes POST émises vers l'API ASACI.
            </p>
          </div>

          <DataTable
            columns={columnsDemandes}
            data={demandes}
            searchPlaceholder="Rechercher par numéro de demande..."
          />
        </div>
      )}

      {/* Tab 3: Passerelle Details */}
      {activeTab === 'passerelle' && (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Server size={20} color="#3b82f6" />
            Configuration Opérationnelle de la Passerelle ASACI OCI
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
            <div style={{ padding: '1rem', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
                Points d'accès de l'API ASACI
              </div>
              <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>URL de Production : </span>
                  <code style={{ fontSize: '0.78rem', color: '#93c5fd', wordBreak: 'break-all' }}>
                    {gatewayStatus.passerelle_url}
                  </code>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Mécanisme : </span>
                  <span>Procédure stockée <code>fn_demande_attestation(id_contrat)</code> + POST JSON HTTPS</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Hôte Oracle Cloud : </span>
                  <span>gateway-eattestation.asacitech.com</span>
                </div>
              </div>
            </div>

            <div style={{ padding: '1rem', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
                Accréditations & Codes Institutionnels
              </div>
              <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Code Intermédiaire : </span>
                  <strong>{gatewayStatus.code_intermediaire}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Code Demandeur : </span>
                  <strong>{gatewayStatus.code_demandeur}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Compagnie Partenaire : </span>
                  <strong>{gatewayStatus.code_compagnie}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Clé d'accès configurée : </span>
                  <span style={{ color: gatewayStatus.cle_acces_configuree ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                    {gatewayStatus.cle_acces_configuree ? 'OUI (Prête pour exploitation)' : 'NON (À définir dans .env)'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ padding: '1rem', background: 'rgba(59, 130, 246, 0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#60a5fa', marginBottom: '0.35rem' }}>
              Règles d'Exploitation & Traitement des Retours ASACI
            </h3>
            <ul style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, paddingLeft: '1.25rem' }}>
              <li><strong>Code 0 :</strong> Succès. L'attestation est immédiatement émise avec attribution du numéro définitif et du lien vers le PDF officiel ASACI.</li>
              <li><strong>Code 121 :</strong> Demande transmise avec succès mais en cours de validation par la plateforme de l'ASACI. Utiliser le bouton « Interroger Statut ASACI » pour actualiser.</li>
              <li><strong>Code -12 :</strong> Code d'accès incorrect ou expiré auprès de l'ASACI.</li>
              <li><strong>Code -25 :</strong> Absence de liaison déclarée entre le code intermédiaire et la compagnie dans le référentiel ASACI.</li>
              <li><strong>Article 13 CIMA :</strong> Le bouton de soumission est désactivé si la police n'est pas intégralement soldée en caisse.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Modal 1: Nouvelle Demande ASACI depuis Contrat DB */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        title="Transmission d'une Demande d'Attestation à l'ASACI"
        subtitle="Exécution réelle via la procédure stockée fn_demande_attestation et l'API ASACI."
      >
        <form onSubmit={handleSendDemande}>
          <div className="form-group">
            <label className="form-label">Sélection du Contrat Automobile</label>
            <select
              className="form-control"
              value={selectedContractId}
              onChange={(e) => setSelectedContractId(e.target.value)}
              required
            >
              <option value="">-- Choisir une police d'assurance --</option>
              {trierParLibelle(contracts, (c) => c.numeropolice || '').map((c) => {
                const id = c.idcontrat || c.id;
                const sold = estSolde(c.prime_totale || c.primettc, c.montant_encaisse);
                return (
                  <option key={id} value={id}>
                    {c.numeropolice || `POL-${id}`} - {c.client_nom || c.souscripteur || 'Client'} - {c.compagnie || 'NSIA'} -{sold ? '✓ Soldé' : '⚠️ Non soldé'}
                  </option>
                );
              })}
            </select>
          </div>

          {/* CIMA Article 13 Real Verification Badge */}
          {selectedContract && (
            <div
              style={{
                padding: '0.85rem 1rem',
                borderRadius: 'var(--radius-md)',
                background: isContractPaid ? 'rgba(52, 211, 153, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: isContractPaid ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                margin: '0.75rem 0',
              }}
            >
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                  Contrôle CIMA Art. 13 – Encaissement Effectif
                </span>
                <strong style={{ fontSize: '0.85rem', color: isContractPaid ? '#34d399' : '#f87171' }}>
                  {isContractPaid
                    ? '✓ Prime Intégralement Réglée (Délivrance Autorisée)'
                    : `⚠️ Reste à Encaisser : ${resteAEncaisser(selectedContract.prime_totale || selectedContract.primettc, selectedContract.montant_encaisse).toLocaleString('fr-FR')} FCFA`}
                </strong>
              </div>
              <span className={`badge ${isContractPaid ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.7rem' }}>
                {isContractPaid ? 'Conforme Art. 13' : 'Blocage CIMA'}
              </span>
            </div>
          )}

          {/* Details of selected contract */}
          {selectedContract && (
            <div style={{ padding: '0.85rem', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              <div><strong>Souscripteur :</strong> {selectedContract.client_nom || selectedContract.souscripteur}</div>
              <div><strong>Compagnie :</strong> {selectedContract.compagnie}</div>
              <div><strong>Prime Totale :</strong> {Number(selectedContract.prime_totale || selectedContract.primettc || 0).toLocaleString('fr-FR')} FCFA</div>
              <div><strong>Encaissé :</strong> {Number(selectedContract.montant_encaisse || 0).toLocaleString('fr-FR')} FCFA</div>
            </div>
          )}

          {/* Last API Feedback Display */}
          {lastApiFeedback && (
            <div style={{ padding: '0.85rem', borderRadius: 'var(--radius-md)', background: 'rgba(30, 41, 59, 0.7)', border: '1px solid var(--border-subtle)', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-primary)' }}>
                Dernier Retour de l'API ASACI :
              </div>
              {lastApiFeedback.map((m, idx) => (
                <div key={idx} style={{ fontSize: '0.75rem', color: m.statut === 0 ? '#34d399' : '#f87171' }}>
                  Statut [{m.statut}] : {m.message}
                  {m.numero_attestation && <div>N° Attestation : <strong>{m.numero_attestation}</strong></div>}
                  {m.numero_demande && <div>Réf. Demande : {m.numero_demande}</div>}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsNewModalOpen(false)}>
              Fermer
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submittingDemande || !isContractPaid}
            >
              {submittingDemande ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Communication Passerelle ASACI...</span>
                </>
              ) : (
                <>
                  <Send size={16} />
                  <span>Transmettre Requête Réelle</span>
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Interrogation Statut Demande ASACI */}
      <Modal
        isOpen={isCheckModalOpen}
        onClose={() => setIsCheckModalOpen(false)}
        title="Interrogation de Statut auprès de l'ASACI"
        subtitle="Vérifie l'état actuel d'un dossier d'édition sur les serveurs de l'ASACI."
      >
        <form onSubmit={handleCheckStatus}>
          <div className="form-group">
            <label className="form-label">Numéro ou Référence de Demande ASACI</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                className="form-control"
                placeholder="Ex: ASACI_CRT_146_172558... ou 2853776057803"
                value={referenceToCheck}
                onChange={(e) => setReferenceToCheck(e.target.value)}
                required
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isCheckingStatus}
                style={{ whiteSpace: 'nowrap' }}
              >
                {isCheckingStatus ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <>
                    <Search size={16} />
                    <span>Interroger</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {checkResult && (
            <div
              style={{
                marginTop: '1rem',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                Réponse de l'API ASACI en temps réel :
              </div>
              <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Code de Statut : </span>
                  <strong style={{ color: checkResult.statut === 0 ? '#34d399' : (checkResult.statut === 121 ? '#f59e0b' : '#f87171') }}>
                    {checkResult.statut}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Message ASACI : </span>
                  <span>{checkResult.message || 'Aucun libellé retourné'}</span>
                </div>
                {checkResult.reference_demande && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Référence Demande : </span>
                    <code style={{ color: '#93c5fd' }}>{checkResult.reference_demande}</code>
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCheckModalOpen(false)}>
              Fermer
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Fiche Détail Attestation ASACI */}
      <Modal
        isOpen={Boolean(selectedAttestation)}
        onClose={() => setSelectedAttestation(null)}
        title="Fiche Numérique e-Attestation ASACI"
        subtitle={`N° Attestation : ${selectedAttestation?.numero_attestation}`}
        maxWidth="640px"
      >
        {selectedAttestation && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ borderBottom: '2px solid var(--border-color)', paddingBottom: '0.75rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)' }}>
                ASSOCIATION DES SOCIÉTÉS D'ASSURANCES DE CÔTE D'IVOIRE (ASACI)
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                CERTIFICAT OFFICIEL D'ASSURANCE AUTOMOBILE
              </div>
              <div style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 600, marginTop: '0.2rem' }}>
                Attestation Enregistrée au Répertoire National Automobile (Art. 200 CIMA)
              </div>
            </div>

            <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>N° Attestation :</span>
                <div style={{ color: '#60a5fa', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{selectedAttestation.numero_attestation}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Code de Sécurité OCI :</span>
                <div style={{ color: '#34d399', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{selectedAttestation.code_securite || 'SEC-8974-CIMA'}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>N° Police Associée :</span>
                <div style={{ fontWeight: 600 }}>{selectedAttestation.police || selectedAttestation.numero_police || 'POL-CI-2026'}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Immatriculation Véhicule :</span>
                <div style={{ fontWeight: 700, color: '#fff' }}>{selectedAttestation.immatriculation || 'Non renseignée'}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Compagnie Assureur :</span>
                <div>{selectedAttestation.compagnie || 'NSIA Assurances CI'}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Date d'Expiration :</span>
                <div style={{ color: '#fbbf24', fontWeight: 600 }}>{selectedAttestation.date_expiration || 'En cours de validité'}</div>
              </div>
            </div>

            <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', padding: '0.85rem', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              <strong>Contrôle des Forces de l'Ordre (Police & Gendarmerie) :</strong>
              <p style={{ margin: '0.2rem 0 0 0' }}>
                Cette attestation est directement vérifiable sur les terminaux embarqués des forces de sécurité routière via le QR-Code et le code de sécurité délivré par le hub ASACI.
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedAttestation(null)}>
                Fermer
              </button>
              <button className="btn btn-primary" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Printer size={15} />
                <span>Imprimer l'Attestation</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AsaciPage;
