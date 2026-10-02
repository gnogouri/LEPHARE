import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { PolicyMovementModal } from '../contracts/PolicyMovementModal';
import { dataStore } from '../../../api/dataStore';
import { contractApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { formatDate } from '../../../utils/dateUtils';
import {
  RefreshCw,
  FileText,
  Printer,
  Sparkles,
  ShieldCheck,
  Calendar,
  Layers,
  Eye,
  Plus,
  ArrowRight,
  Clock,
  Car,
} from 'lucide-react';

export const EndorsementPage = () => {
  const navigate = useNavigate();
  const { success } = useToast();

  const [contracts, setContracts] = useState(() => dataStore.getContracts());
  const [endorsements, setEndorsements] = useState(() => dataStore.getEndorsements());
  const [selectedContract, setSelectedContract] = useState(() => dataStore.getContracts()[0] || null);

  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [movementTab, setMovementTab] = useState('renouvellement');
  const [initialOp, setInitialOp] = useState(null);
  const [filterTab, setFilterTab] = useState('all');

  useEffect(() => {
    let isMounted = true;
    const loadRealData = async () => {
      try {
        const [ctrs, avs] = await Promise.all([
          contractApi.getContracts().catch(() => []),
          contractApi.getEndorsements().catch(() => []),
        ]);
        if (isMounted) {
          if (ctrs && ctrs.length > 0) {
            setContracts(ctrs);
            setSelectedContract(ctrs[0]);
          }
          if (avs && avs.length > 0) {
            const mapped = avs.map((a, idx) => ({
              id: a.id || a.idavenant || idx + 1,
              numero_avenant: a.numeroavenant || a.code_avenant || `AVN-2026-${String(idx + 1).padStart(4, '0')}`,
              contrat_police: a.police || a.contrat_police || (ctrs[0]?.numeropolice || 'POL-2026-0001'),
              client_nom: a.client_nom || a.client || (ctrs[0]?.client_nom || 'Client Uranus'),
              type_mouvement: a.libelle_avenant || a.libelle || a.type_mouvement || 'Renouvellement',
              date_effet: a.date_effet || a.dateeffet || new Date().toISOString().split('T')[0],
              date_echeance: a.date_echeance || a.dateexpiration || new Date().toISOString().split('T')[0],
              prime_totale: Number(a.prime_totale || a.primettc || 0),
              statut: a.statut || 'Actif',
              statut_badge: 'emerald',
            }));
            setEndorsements(mapped);
          }
        }
      } catch (err) {
        console.error('Erreur chargement avenants Django:', err);
      }
    };
    loadRealData();
    return () => { isMounted = false; };
  }, []);

  // Filtered endorsements
  const filteredEndorsements = endorsements.filter((e) => {
    if (filterTab === 'renouvellement') return e.type_mouvement === 'Renouvellement';
    if (filterTab === 'avenant') return e.type_mouvement === 'Avenant' || e.type_mouvement === 'immatriculation';
    if (filterTab === 'transformation') return e.type_mouvement === 'Transformation';
    return true;
  });

  const renewalsCount = endorsements.filter((e) => e.type_mouvement === 'Renouvellement').length;
  const avenantsCount = endorsements.filter((e) => e.type_mouvement === 'Avenant' || e.type_mouvement === 'immatriculation').length;
  const transformationsCount = endorsements.filter((e) => e.type_mouvement === 'Transformation').length;
  const totalVolume = endorsements.reduce((sum, e) => sum + (Number(e.prime_totale) || 0), 0);

  const handleOpenMovementModal = (tab, contractToUse = null, existingOp = null) => {
    const targetContract = contractToUse || selectedContract || contracts[0];
    setSelectedContract(targetContract);
    setMovementTab(tab);
    setInitialOp(existingOp);
    setIsMovementModalOpen(true);
  };

  const columns = [
    {
      header: 'N° Avenant',
      accessor: 'numero_avenant',
      render: (row) => (
        <div>
          <strong style={{ color: '#34d399', fontFamily: 'var(--font-mono)' }}>{row.numero_avenant}</strong>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
            Émis le {row.date_avenant || row.date_emission || '01/01/2026'}
          </div>
        </div>
      ),
    },
    {
      header: 'Police Rattachée',
      accessor: 'police_num',
      render: (row) => (
        <div>
          <strong style={{ color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>{row.police_num}</strong>
          <div style={{ fontSize: '0.75rem', color: '#fff', fontWeight: 600 }}>{row.client_nom}</div>
        </div>
      ),
    },
    {
      header: 'Type Mouvement',
      accessor: 'type_mouvement',
      render: (row) => {
        let badgeColor = 'blue';
        if (row.type_mouvement === 'Renouvellement') badgeColor = 'emerald';
        if (row.type_mouvement === 'Transformation') badgeColor = 'purple';
        if (row.type_mouvement === 'Résiliation') badgeColor = 'rose';

        return (
          <span
            style={{
              padding: '0.25rem 0.6rem',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 700,
              background:
                row.type_mouvement === 'Renouvellement'
                  ? 'rgba(16, 185, 129, 0.18)'
                  : row.type_mouvement === 'Transformation'
                  ? 'rgba(168, 85, 247, 0.18)'
                  : 'rgba(59, 130, 246, 0.18)',
              color:
                row.type_mouvement === 'Renouvellement'
                  ? '#34d399'
                  : row.type_mouvement === 'Transformation'
                  ? '#c084fc'
                  : '#60a5fa',
              border: `1px solid ${
                row.type_mouvement === 'Renouvellement'
                  ? 'rgba(16, 185, 129, 0.3)'
                  : row.type_mouvement === 'Transformation'
                  ? 'rgba(168, 85, 247, 0.3)'
                  : 'rgba(59, 130, 246, 0.3)'
              }`,
            }}
          >
            {row.type_mouvement}
          </span>
        );
      },
    },
    {
      header: 'Nature & Motif',
      accessor: 'nature',
      render: (row) => (
        <div style={{ fontSize: '0.8rem', maxWidth: '280px', color: 'var(--text-secondary)' }}>
          {row.nature || row.details?.motif || "Modification contractuelle enregistrée"}
        </div>
      ),
    },
    {
      header: 'Période Couverte',
      render: (row) => (
        <div style={{ fontSize: '0.78rem' }}>
          {row.date_effet ? (
            <>
              Du {formatDate(row.date_effet)} au <span style={{ color: '#60a5fa' }}>{row.date_expiration || '31/12/2026'}</span>
            </>
          ) : (
            <span>Date d'effet : {formatDate(row.date_avenant)}</span>
          )}
        </div>
      ),
    },
    {
      header: 'Prime Totale TTC',
      render: (row) => (
        <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>
          {Number(row.prime_totale || 0).toLocaleString('fr-FR')} FCFA
        </strong>
      ),
    },
    {
      header: 'Actions',
      render: (row) => {
        const associatedContract = contracts.find(
          (c) => String(c.id) === String(row.police_id) || c.numeropolice === row.police_num
        ) || {
          id: row.police_id,
          numeropolice: row.police_num,
          client_nom: row.client_nom,
          compagnie: row.details?.compagnie || 'NSIA Assurances',
          produit: row.details?.produit || 'Automobile Tous Risques',
          date_effet: row.date_effet || row.date_avenant,
          date_expiration: row.date_expiration || '31/12/2026',
          prime_totale: row.prime_totale,
        };

        return (
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            {/* Bouton Imprimer Certificat CIMA */}
            <button
              className="btn btn-secondary"
              style={{
                padding: '0.3rem 0.65rem',
                fontSize: '0.75rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                color: '#0284c7',
                borderColor: 'rgba(2, 132, 199, 0.35)',
                background: 'rgba(2, 132, 199, 0.08)',
                fontWeight: 600,
              }}
              onClick={() => {
                handleOpenMovementModal('renouvellement', associatedContract, {
                  type: row.type_mouvement || 'Renouvellement',
                  endorsement: row,
                  contract: associatedContract,
                  quittance: row.details?.quittance_num ? { numero_quittance: row.details.quittance_num } : null,
                });
              }}
              title="Afficher et imprimer le certificat officiel CIMA de ce mouvement"
            >
              <Printer size={13} color="#0284c7" />
              <span>Imprimer</span>
            </button>

            {/* Bouton Voir Fiche Police */}
            {associatedContract.id && (
              <button
                className="btn btn-secondary"
                style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                onClick={() => navigate(`/user/contracts/${associatedContract.id}`)}
                title="Consulter la fiche police"
              >
                <Eye size={13} />
                <span>Police</span>
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div className="responsive-header">
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <RefreshCw size={26} color="#3b82f6" />
            Registre des Avenants, Renouvellements & Transformations
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Gestion intégrale des actes modificatifs CIMA : prorogations annuelles, changement d'immatriculation, surclassements et impression immédiate.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
          {/* Action Renouveler */}
          <button
            className="btn"
            style={{
              background: 'linear-gradient(135deg, #059669, #10b981)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontWeight: 600,
              boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)',
              padding: '0.5rem 1rem',
            }}
            onClick={() => handleOpenMovementModal('renouvellement')}
          >
            <RefreshCw size={16} />
            <span>Nouveau Renouvellement</span>
          </button>

          {/* Action Avenant */}
          <button
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#60a5fa', borderColor: 'rgba(96, 165, 250, 0.35)' }}
            onClick={() => handleOpenMovementModal('avenant')}
          >
            <FileText size={16} />
            <span>Nouvel Avenant</span>
          </button>

          {/* Action Transformation */}
          <button
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#c084fc', borderColor: 'rgba(192, 132, 252, 0.35)' }}
            onClick={() => handleOpenMovementModal('transformation')}
          >
            <Sparkles size={16} />
            <span>Transformation</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>TOTAL ACTES ENREGISTRÉS</span>
            <Layers size={18} color="#3b82f6" />
          </div>
          <div className="metric-value">{endorsements.length}</div>
          <span style={{ fontSize: '0.75rem', color: '#60a5fa' }}>Mouvements CIMA conformes</span>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>RENOUVELLEMENTS EFFECTUÉS</span>
            <RefreshCw size={18} color="#10b981" />
          </div>
          <div className="metric-value" style={{ color: '#34d399' }}>{renewalsCount}</div>
          <span style={{ fontSize: '0.75rem', color: '#34d399' }}>Polices prorogées avec succès</span>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>AVENANTS & TRANSFORMATIONS</span>
            <Sparkles size={18} color="#a855f7" />
          </div>
          <div className="metric-value" style={{ color: '#c084fc' }}>{avenantsCount + transformationsCount}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ajustements contractuels</span>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>VOLUME PRIMES RÉGULARISÉES</span>
            <ShieldCheck size={18} color="#f59e0b" />
          </div>
          <div className="metric-value" style={{ color: '#f59e0b' }}>
            {(totalVolume / 1000).toFixed(0)} k FCFA
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Primes totales enregistrées</span>
        </div>
      </div>

      {/* Main Table Container with Filters */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        {/* Quick Filter Pills */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
          <button
            type="button"
            className={`btn ${filterTab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
            onClick={() => setFilterTab('all')}
          >
            Tous les Actes ({endorsements.length})
          </button>
          <button
            type="button"
            className={`btn ${filterTab === 'renouvellement' ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              fontSize: '0.8rem',
              padding: '0.35rem 0.85rem',
              borderColor: filterTab === 'renouvellement' ? '#10b981' : 'rgba(16, 185, 129, 0.4)',
              color: filterTab === 'renouvellement' ? '#fff' : '#34d399',
              background: filterTab === 'renouvellement' ? 'linear-gradient(135deg, #059669, #10b981)' : '',
            }}
            onClick={() => setFilterTab('renouvellement')}
          >
            Renouvellements ({renewalsCount})
          </button>
          <button
            type="button"
            className={`btn ${filterTab === 'avenant' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
            onClick={() => setFilterTab('avenant')}
          >
            Avenants de Modification ({avenantsCount})
          </button>
          <button
            type="button"
            className={`btn ${filterTab === 'transformation' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
            onClick={() => setFilterTab('transformation')}
          >
            Transformations ({transformationsCount})
          </button>
        </div>

        <DataTable
          columns={columns}
          data={filteredEndorsements}
          searchPlaceholder="Rechercher par n° avenant, police, souscripteur, ou motif..."
        />
      </div>

      {/* Movement Modal with Instant Print Certificate */}
      {selectedContract && (
        <PolicyMovementModal
          isOpen={isMovementModalOpen}
          onClose={() => {
            setIsMovementModalOpen(false);
            setInitialOp(null);
          }}
          contract={selectedContract}
          initialTab={movementTab}
          initialOperation={initialOp}
          onSuccess={() => {
            setContracts(dataStore.getContracts());
            setEndorsements(dataStore.getEndorsements());
          }}
        />
      )}
    </div>
  );
};

export default EndorsementPage;
