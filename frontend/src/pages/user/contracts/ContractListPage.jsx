import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { DeleteConfirmModal } from '../../../components/common/DeleteConfirmModal';
import { PolicyMovementModal } from './PolicyMovementModal';
import { isRegistryQuote } from '../../../utils/quoteRegistry';
import { moduleActif, TITRE_MODULE_INACTIF } from '../../../utils/modulesActifs';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import { dataStore } from '../../../api/dataStore';
import { contractApi, quoteApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { canUser, validateBusinessRule } from '../../../utils/rbac';
import { exportToPdf } from '../../../utils/exportUtils';
import {
  ShieldCheck,
  Eye,
  RefreshCw,
  Car,
  Plus,
  ArrowRight,
  FileCheck,
  Home,
  HeartPulse,
  Activity,
  Layers,
  ShieldAlert,
  Ban,
  Trash2,
  Archive,
  FileText,
  Sparkles,
  Calendar,
  AlertCircle,
  Plane,
  Ship,
  Briefcase,
  Printer,
} from 'lucide-react';

// Formate une date en jj/mm/aaaa, quel que soit le format reçu du backend (ISO, etc.)
const formatFrDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Nombre de jours restants avant l'expiration (négatif si déjà expiré)
const daysUntil = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / (1000 * 60 * 60 * 24));
};

export const ContractListPage = () => {
  const { user } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  // Devis à confirmer, proposés uniquement dans la fenêtre « Émettre Police » (jamais dans la liste)
  const [quotes, setQuotes] = useState([]);
  const [selectedBranchFilter, setSelectedBranchFilter] = useState('ALL');
  // Décompte réel des contrats par branche (calculé sur les contrats chargés)
  const [stats, setStats] = useState(() => {
    const empty = { ALL: 0, AUTO: 0, SANTE: 0, IA: 0, VOYAGE: 0, TRANSPORT: 0, MRH: 0 };
    try { return { ...empty, ...JSON.parse(sessionStorage.getItem('contractStats') || '{}') }; } catch { return empty; }
  });

  // Vrais compteurs (base entière, pas seulement les lignes chargées) pour les onglets
  // En cours / À Renouveler / Résiliées, recalculés à chaque changement de branche.
  const [subStats, setSubStats] = useState({ active: 0, renewable: 0, terminated: 0 });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [actionContract, setActionContract] = useState(null);
  const [movementModalTab, setMovementModalTab] = useState('renouvellement');
  const [filterTab, setFilterTab] = useState('all');
  const [deletingContract, setDeletingContract] = useState(null);
  const [deleteValidation, setDeleteValidation] = useState({ allowed: true });
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const getBranchParams = (branch) => {
    switch (branch) {
      // Resp. Civile (idproduit 8) est en réalité de l'assurance automobile (garantie au tiers) :
      // même fiche véhicule (matricule, marque, modèle...) que les devis Automobile classiques,
      // simplement enregistrée sous un autre code produit historique. Fusionnée avec Automobile.
      case 'AUTO': return { idproduit: '1,8', page_size: 200 };
      case 'IA': return { idproduit: 2, page_size: 200 };
      case 'VOYAGE': return { idproduit: 3, page_size: 200 };
      case 'MRH': return { idproduit: '4,7,9', page_size: 200 };
      case 'SANTE': return { idproduit: '5,10', page_size: 200 };
      case 'TRANSPORT': return { idproduit: 6, page_size: 200 };
      default: return { page_size: 200 };
    }
  };

  // D�compte par branche : le serveur renvoie `count`. Requ�tes une par une, mises en cache.
  const loadStats = async () => {
    const branches = ['ALL', 'AUTO', 'SANTE', 'IA', 'VOYAGE', 'TRANSPORT', 'MRH'];
    for (const b of branches) {
      try {
        const n = await contractApi.getContractsCount(getBranchParams(b));
        setStats((prev) => {
          const next = { ...prev, [b]: n };
          try { sessionStorage.setItem('contractStats', JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
      } catch (e) {
        console.warn('Erreur chargement stats contrats:', e);
      }
    }
  };

  // Vrais totaux (base entière) des onglets En cours / À Renouveler / Résiliées : contrats
  // uniquement (statut serveur). Les devis, même confirmés ou expirés, restent au registre des devis.
  const loadSubStats = async (branch = selectedBranchFilter) => {
    const params = getBranchParams(branch);
    try {
      const [activeContracts, echeanceContracts, terminatedContracts] = await Promise.all([
        contractApi.getContractsCount({ ...params, statut: 'actif' }),
        contractApi.getContractsCount({ ...params, statut: 'echeance' }),
        contractApi.getContractsCount({ ...params, statut: 'resilie' }),
      ]);
      setSubStats({
        active: activeContracts,
        renewable: echeanceContracts,
        terminated: terminatedContracts,
      });
    } catch (e) {
      console.warn('Erreur chargement des sous-compteurs contrats:', e);
    }
  };

  // Statut serveur correspondant à chaque onglet (même définition que loadSubStats,
  // pour que le nombre affiché sur l'onglet et les lignes du tableau soient cohérents).
  const STATUT_PAR_ONGLET = { active: 'actif', renewable: 'echeance', terminated: 'resilie' };

  const loadContractsData = async (branch = selectedBranchFilter, tab = filterTab) => {
    setLoading(true);
    try {
      const params = getBranchParams(branch);
      const statut = STATUT_PAR_ONGLET[tab];
      const contractParams = statut ? { ...params, statut } : params;
      // Le portefeuille ne liste que des contrats. Les devis à confirmer ne servent qu'à la
      // fenêtre « Émettre Police » (émission depuis un devis validé).
      const [backendList, quotesList] = await Promise.all([
        contractApi.getContracts(contractParams),
        quoteApi.getQuotes({ ...params, archive: 'false', confirme: 'false', page_size: 200 }).catch(() => []),
      ]);
      if (Array.isArray(backendList) && backendList.length > 0) {
        setContracts(backendList);
      } else {
        setContracts([]);
      }
      if (Array.isArray(quotesList)) setQuotes(quotesList);
    } catch (err) {
      console.error('Erreur chargement contrats Django:', err);
      const local = dataStore.getContracts();
      setContracts(local || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    loadSubStats(selectedBranchFilter);
    loadContractsData(selectedBranchFilter, filterTab);
  }, []);

  const handleBranchFilterChange = (branch) => {
    setSelectedBranchFilter(branch);
    loadSubStats(branch);
    loadContractsData(branch, filterTab);
  };

  const handleFilterTabChange = (tab) => {
    setFilterTab(tab);
    loadContractsData(selectedBranchFilter, tab);
  };

  const validatedQuotes = quotes.filter((q) => isRegistryQuote(q) && q.statut !== 'Consolidé');

  const isExpiredOrDue = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    const diffDays = (d - now) / (1000 * 60 * 60 * 24);
    return diffDays <= 30; // Expired or expiring in 30 days
  };

  // Contrats uniquement, par date d'effet décroissante
  const portfolio = [...contracts].sort((a, b) => {
    const dateA = new Date(a.date_effet || a.date_emission || 0).getTime();
    const dateB = new Date(b.date_effet || b.date_emission || 0).getTime();
    return dateB - dateA;
  });

  // Le tri par statut (En cours / À Renouveler / Résiliées) est déjà fait côté serveur
  // (voir STATUT_PAR_ONGLET dans loadContractsData) : le portefeuille chargé correspond
  // toujours à l'onglet actif, pas besoin de le refiltrer ici.
  const filteredContracts = portfolio;

  const activeCount = subStats.active;
  const renewableCount = subStats.renewable;
  const terminatedCount = subStats.terminated;

  // Pour l'onglet affiché, le nombre de lignes chargées fait foi dès que la liste n'est pas plafonnée
  const LIST_PAGE_SIZE = 200;
  const listComplete = !loading && contracts.length < LIST_PAGE_SIZE;
  const countByBranch = {
    ...stats,
    ...(listComplete && stats[selectedBranchFilter] !== undefined ? { [selectedBranchFilter]: contracts.length } : {}),
  };

  const getTabLabel = (filter) => {
    switch (filter) {
      case 'AUTO': return 'Automobile';
      case 'SANTE': return 'Santé';
      case 'IA': return 'Individuelle Accidents';
      case 'VOYAGE': return 'Voyage';
      case 'TRANSPORT': return 'Transport';
      case 'MRH': return 'Multirisque Habitation';
      default: return 'Tous';
    }
  };

  const LIBELLES_ONGLET_STATUT = { all: 'Tous les contrats', active: 'En cours', renewable: 'À renouveler', terminated: 'Résiliées' };

  // Registre imprimable du portefeuille, même gabarit que le registre des devis (exportToPdf).
  // Onglet de branche affiché : lignes du tableau (contrats + devis du portefeuille) ;
  // autre branche : ses contrats sont chargés à la volée avec le même filtre de statut.
  const handlePrintContracts = async (specificBranch = null) => {
    const branchToUse = specificBranch || selectedBranchFilter;
    let listToPrint = filteredContracts;
    if (branchToUse !== selectedBranchFilter) {
      try {
        const statut = STATUT_PAR_ONGLET[filterTab];
        const params = getBranchParams(branchToUse);
        const list = await contractApi.getContracts(statut ? { ...params, statut } : params);
        listToPrint = Array.isArray(list) ? list : [];
      } catch (err) {
        console.error('Erreur chargement contrats pour impression:', err);
        toastError(`Impossible de charger les contrats ${getTabLabel(branchToUse)} pour l'impression.`);
        return;
      }
    }

    if (!listToPrint || listToPrint.length === 0) {
      toastError(`Aucun contrat à imprimer pour ${getTabLabel(branchToUse)}.`);
      return;
    }

    const today = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const fcfa = (v) => `${Number(v || 0).toLocaleString('fr-FR')} FCFA`;

    const headers = [
      'N° Police',
      'Souscripteur',
      'Branche / Produit',
      'Compagnie',
      'Intermédiaire',
      'Date Effet',
      'Date Expiration',
      'Prime Nette',
      'Prime TTC',
      'Statut',
    ];

    const rows = listToPrint.map((c) => [
      c.numeropolice || c.numerodevis || '-',
      c.client_nom || c.souscripteur || '-',
      [c.branche, c.produit].filter(Boolean).join(' - ') || '-',
      c.compagnie || '-',
      c.intermediaire || 'OREOLE ASSURANCES',
      formatFrDate(c.date_effet),
      formatFrDate(c.date_expiration),
      fcfa(c.prime_nette),
      fcfa(c.prime_totale),
      c.statut_contrat || c.statut || 'En cours',
    ]);

    const totalTtc = listToPrint.reduce((acc, c) => acc + Number(c.prime_totale || 0), 0);
    const tabName = getTabLabel(branchToUse);
    const statutLabel = LIBELLES_ONGLET_STATUT[filterTab] || 'Tous les contrats';

    exportToPdf({
      filename: `Registre_Contrats_${tabName}_LE_PHARE_${new Date().toISOString().slice(0, 10)}.pdf`,
      title: `REGISTRE OFFICIEL DU PORTEFEUILLE DES CONTRATS [${tabName.toUpperCase()}]`,
      subtitle: branchToUse !== 'ALL' ? `Branche / Catégorie : ${tabName} — Conforme aux normes d'audit CIMA` : 'État global du portefeuille conforme aux normes CIMA',
      metadata: {
        "Date d'édition": today,
        'Édité par': user?.nom ? `${user.nom} (${user.email || ''})` : (user?.email || 'Gestionnaire'),
        'Périmètre': `Branche : ${tabName} — ${statutLabel}`,
        'Volume': `${listToPrint.length} lignes (${Number(countByBranch[branchToUse] || listToPrint.length).toLocaleString('fr-FR')} contrats en base)`,
        'Total Primes TTC': fcfa(totalTtc),
      },
      headers,
      rows,
      // Sans le bloc République / société / titre / sous-titre, la ligne TOTAL, ni l'attestation
      // et les signatures
      enTete: false,
      piedDePage: false,
    });
  };

  const columns = [
    {
      header: 'N° Police',
      accessor: 'numeropolice',
      sortable: true,
      render: (row) => (
        <div>
          <strong style={{ color: '#34d399', fontFamily: 'var(--font-mono)' }}>{row.numeropolice}</strong>
          {row.dernier_avenant && (
            <div style={{ fontSize: '0.7rem', color: '#60a5fa' }}>{row.dernier_avenant}</div>
          )}
        </div>
      ),
    },
    {
      header: 'Souscripteur',
      accessor: 'client_nom',
      sortable: true,
      render: (row) => <div style={{ fontWeight: 600, color: '#fff' }}>{row.client_nom}</div>,
    },
    { header: 'Produit', accessor: 'produit', sortable: true },
    { header: 'Compagnie', accessor: 'compagnie', sortable: true },
    {
      header: 'Période de Validité',
      sortable: true,
      // Tri chronologique sur la date d'effet (la cellule affiche « effet au expiration »)
      sortAccessor: (row) => new Date(row.date_effet || 0).getTime() || 0,
      render: (row) => {
        const isNearDue = isExpiredOrDue(row.date_expiration);
        const remaining = daysUntil(row.date_expiration);
        const isPast = remaining !== null && remaining < 0;
        return (
          <div style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)' }}>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{formatFrDate(row.date_effet)}</span>
              <ArrowRight size={12} color="var(--text-muted)" />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: isNearDue ? '#f59e0b' : '#60a5fa',
                  fontWeight: isNearDue ? 700 : 500,
                }}
              >
                {formatFrDate(row.date_expiration)}
              </span>
            </div>
            {remaining !== null && (
              <div style={{ fontSize: '0.72rem', marginTop: '0.15rem' }}>
                {isPast ? (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.05rem 0.4rem',
                      borderRadius: '4px',
                      background: 'rgba(239, 68, 68, 0.15)',
                      color: '#f87171',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                    }}
                  >
                    Expiré depuis {Math.abs(remaining)} j
                  </span>
                ) : isNearDue ? (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.05rem 0.4rem',
                      borderRadius: '4px',
                      background: 'rgba(245, 158, 11, 0.15)',
                      color: '#f59e0b',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                    }}
                  >
                    Échéance dans {remaining} j
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>{remaining} jours restants</span>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      header: 'Prime Nette',
      sortable: true,
      sortAccessor: (row) => Number(row.prime_nette || 0),
      render: (row) => <span style={{ color: 'var(--text-secondary)' }}>{Number(row.prime_nette || 0).toLocaleString('fr-FR')} F</span>,
    },
    {
      header: 'Prime TTC',
      sortable: true,
      sortAccessor: (row) => Number(row.prime_totale || 0),
      render: (row) => <strong style={{ color: '#fff' }}>{Number(row.prime_totale || 0).toLocaleString('fr-FR')} F</strong>,
    },
    {
      header: 'Statut',
      accessor: 'statut_contrat',
      sortable: true,
      render: (row) => {
        const statut = row.statut_contrat || row.statut || 'En cours';
        const couleurs = { 'En cours': 'emerald', 'Expiré': 'amber', 'À renouveler': 'amber', 'Résilié': 'rose' };
        return <StatusBadge label={statut} color={couleurs[statut] || 'blue'} />;
      },
    },
    {
      header: 'Actions Mouvements & Police',
      render: (row) => {
        const canTerminate = canUser(user, 'terminate', 'contracts');
        const canDelete = canUser(user, 'delete', 'contracts');
        const isResilie = row.statut_contrat === 'Résilié' || row.statut === 'Résilié';

        return (
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* 1. RENOUVELER */}
            <button
              className="btn"
              style={{
                padding: '0.3rem 0.6rem',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                background: 'linear-gradient(135deg, #059669, #10b981)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                borderRadius: 'var(--radius-sm)',
                boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)',
                cursor: 'pointer',
              }}
              onClick={() => {
                setActionContract(row);
                setMovementModalTab('renouvellement');
              }}
              title="Renouveler la police, proroger la période et imprimer le certificat officiel CIMA"
            >
              <RefreshCw size={13} />
              <span>Renouveler</span>
            </button>

            {/* 2. AVENANT */}
            <button
              className="btn btn-secondary"
              style={{
                padding: '0.3rem 0.55rem',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                color: '#60a5fa',
                borderColor: 'rgba(96, 165, 250, 0.3)',
              }}
              onClick={() => {
                setActionContract(row);
                setMovementModalTab('avenant');
              }}
              title="Émettre un avenant (changement plaque, garanties, adjonction)"
            >
              <FileText size={13} />
              <span>Avenant</span>
            </button>

            {/* 3. TRANSFORMATION */}
            <button
              className="btn btn-secondary"
              style={{
                padding: '0.3rem 0.5rem',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                color: '#c084fc',
                borderColor: 'rgba(192, 132, 252, 0.3)',
              }}
              onClick={() => {
                setActionContract(row);
                setMovementModalTab('transformation');
              }}
              title="Transformer la police (surclassement formule, changement compagnie)"
            >
              <Sparkles size={13} />
              <span>Transf.</span>
            </button>

            {/* 4. FICHE POLICE & QUITTANCES */}
            <button
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              onClick={() => navigate(`/user/contracts/${row.id}`)}
              title="Consulter la fiche police, quittance et historique"
            >
              <Eye size={13} />
              <span>Fiche</span>
            </button>

            {/* 5. RESILIATION */}
            <button
              className="btn btn-secondary"
              disabled={isResilie || !canTerminate}
              style={{
                padding: '0.3rem 0.55rem',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                color: isResilie ? 'var(--text-muted)' : '#f59e0b',
                borderColor: isResilie ? 'transparent' : 'rgba(245, 158, 11, 0.3)',
                cursor: isResilie || !canTerminate ? 'not-allowed' : 'pointer',
              }}
              onClick={() => {
                setActionContract(row);
                setMovementModalTab('resiliation');
              }}
              title={
                !canTerminate
                  ? 'Permission CIMA insuffisante pour résilier un contrat'
                  : 'Résilier le contrat (Article 13 CIMA)'
              }
            >
              <Ban size={13} />
              <span>Résilier</span>
            </button>

            {/* 6. SUPPRESSION / CONTRÔLE CIMA */}
            <button
              className="btn btn-secondary"
              disabled={!canDelete}
              style={{
                padding: '0.3rem 0.45rem',
                fontSize: '0.75rem',
                color: '#ef4444',
                borderColor: 'rgba(239, 68, 68, 0.3)',
                cursor: !canDelete ? 'not-allowed' : 'pointer',
              }}
              onClick={() => {
                const val = validateBusinessRule('DELETE_CONTRACT', row);
                setDeleteValidation(val);
                setDeletingContract(row);
              }}
              title={
                !canDelete
                  ? 'Permission CIMA insuffisante'
                  : 'Vérifier et supprimer le contrat (Contrôle CIMA)'
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      },
    },
  ];

  const branchFilters = [
    { key: 'ALL', label: 'Toutes les branches', icon: Layers, count: countByBranch.ALL },
    { key: 'AUTO', label: 'Automobile', icon: Car, count: countByBranch.AUTO },
    { key: 'SANTE', label: 'Santé', icon: HeartPulse, count: countByBranch.SANTE },
    { key: 'IA', label: 'Individuelle Accidents', icon: Activity, count: countByBranch.IA },
    { key: 'VOYAGE', label: 'Voyage', icon: Plane, count: countByBranch.VOYAGE },
    { key: 'TRANSPORT', label: 'Transport', icon: Ship, count: countByBranch.TRANSPORT },
    { key: 'MRH', label: 'Multirisque Habitation', icon: Home, count: countByBranch.MRH },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <ShieldCheck size={24} color="#34d399" />
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Portefeuille des Contrats</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Gestion intégrale du parc de contrats, avenants, renouvellements et attestations CIMA.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handlePrintContracts()}
            title="Imprimer l'état du portefeuille pour cette branche"
          >
            <Printer size={16} />
            <span>Imprimer l'état ({filteredContracts.length})</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              loadStats();
              loadSubStats(selectedBranchFilter);
              loadContractsData(selectedBranchFilter);
            }}
            title="Actualiser la liste"
          >
            <RefreshCw size={16} />
            <span>Actualiser</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Plus size={16} />
            <span>Émettre Police</span>
          </button>
        </div>
      </div>

      {/* Contrats par type de produit */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #10b981', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
            <ShieldCheck size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total des Contrats</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10b981' }}>{countByBranch.ALL.toLocaleString('fr-FR')}</div>
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #3b82f6', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
            <Car size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Automobile</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#3b82f6' }}>{countByBranch.AUTO.toLocaleString('fr-FR')}</div>
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #ec4899', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(236, 72, 153, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ec4899' }}>
            <HeartPulse size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Santé</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ec4899' }}>{countByBranch.SANTE.toLocaleString('fr-FR')}</div>
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #f59e0b', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(245, 158, 11, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
            <Activity size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Individuelle Accidents</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f59e0b' }}>{countByBranch.IA.toLocaleString('fr-FR')}</div>
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #38bdf8', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(56, 189, 248, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38bdf8' }}>
            <Plane size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Voyage</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#38bdf8' }}>{countByBranch.VOYAGE.toLocaleString('fr-FR')}</div>
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #0284c7', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(2, 132, 199, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0284c7' }}>
            <Ship size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Transport</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0284c7' }}>{countByBranch.TRANSPORT.toLocaleString('fr-FR')}</div>
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #a78bfa', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(167, 139, 250, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a78bfa' }}>
            <Home size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Multirisque Habitation</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#a78bfa' }}>{countByBranch.MRH.toLocaleString('fr-FR')}</div>
          </div>
        </div>
      </div>

      {/* Onglets Filtres par Branche (Directement branchés sur PostgreSQL) */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '0.5rem',
        }}
      >
        {branchFilters.map((tab) => {
          const Icon = tab.icon;
          const isActive = selectedBranchFilter === tab.key;
          return (
            <div
              key={tab.key}
              style={{
                display: 'flex',
                alignItems: 'stretch',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                transition: 'all 0.2s ease',
                border: isActive ? '1px solid #3b82f6' : '1px solid transparent',
                background: isActive ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.03)',
              }}
            >
            <button
              type="button"
              onClick={() => handleBranchFilterChange(tab.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 0.85rem',
                fontSize: '0.82rem',
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                border: 'none',
                background: 'transparent',
                color: isActive ? '#60a5fa' : 'var(--text-secondary)',
              }}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
              <span
                style={{
                  fontSize: '0.72rem',
                  padding: '0.1rem 0.45rem',
                  borderRadius: '999px',
                  background: isActive ? '#3b82f6' : 'rgba(255, 255, 255, 0.08)',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  fontWeight: 600,
                }}
              >
                {tab.count?.toLocaleString('fr-FR')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => handlePrintContracts(tab.key)}
              title={`Imprimer directement le registre : ${tab.label}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.4rem 0.5rem',
                border: 'none',
                borderLeft: isActive ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid var(--border-subtle)',
                background: 'transparent',
                color: isActive ? '#60a5fa' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <Printer size={12} />
            </button>
            </div>
          );
        })}
      </div>

      {/* Main Table Card */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn ${filterTab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
              onClick={() => handleFilterTabChange('all')}
            >
              Tous les contrats ({Number(countByBranch[selectedBranchFilter] || 0).toLocaleString('fr-FR')})
            </button>
            <button
              type="button"
              className={`btn ${filterTab === 'active' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
              onClick={() => handleFilterTabChange('active')}
            >
              En cours ({activeCount})
            </button>
            <button
              type="button"
              className={`btn ${filterTab === 'renewable' ? 'btn-primary' : 'btn-secondary'}`}
              style={{
                fontSize: '0.8rem',
                padding: '0.35rem 0.85rem',
                borderColor: filterTab === 'renewable' ? '#f59e0b' : 'rgba(245, 158, 11, 0.4)',
                color: filterTab === 'renewable' ? '#fff' : '#f59e0b',
                background: filterTab === 'renewable' ? '#d97706' : '',
              }}
              onClick={() => handleFilterTabChange('renewable')}
            >
              À Renouveler / Échues ({renewableCount})
            </button>
            <button
              type="button"
              className={`btn ${filterTab === 'terminated' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
              onClick={() => handleFilterTabChange('terminated')}
            >
              Résiliées ({terminatedCount})
            </button>
          </div>

          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {filteredContracts.length === 0
              ? 'Aucun contrat disponible'
              : `${filteredContracts.length.toLocaleString('fr-FR')} ligne${filteredContracts.length > 1 ? 's' : ''} chargée${filteredContracts.length > 1 ? 's' : ''} sur ${Number(countByBranch[selectedBranchFilter] || filteredContracts.length).toLocaleString('fr-FR')} au total (${getTabLabel(selectedBranchFilter)})`}
          </div>
        </div>

        {loading ? (
          <LoadingSpinner text="Chargement des contrats en cours…" />
        ) : (
          <DataTable
            columns={columns}
            data={filteredContracts}
            searchPlaceholder="Rechercher par n° police, souscripteur, produit ou compagnie..."
          />
        )}
      </div>

      {/* Modal Émettre un Contrat */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Émission d'une Nouvelle Police d'Assurance">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Option A: Convert existing quote */}
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#60a5fa', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileCheck size={18} />
              Option 1 : Émettre depuis un Devis Validé ({validatedQuotes.length} en attente)
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Transformez instantanément une proposition d'assurance validée en contrat définitif.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
              {validatedQuotes.slice(0, 3).map((q) => (
                <div
                  key={q.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>{q.numerodevis} - {q.client_nom}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{q.produit} ({q.compagnie}) — <strong style={{ color: '#34d399' }}>{q.prime_totale.toLocaleString('fr-FR')} F</strong></div>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
                    onClick={() => {
                      const { contract } = dataStore.convertQuoteToContract(q);
                      setContracts(dataStore.getContracts());
                      setQuotes(dataStore.getQuotes());
                      setIsModalOpen(false);
                      success(`Police N° ${contract.numeropolice} émise pour ${contract.client_nom} !`);
                    }}
                  >
                    <span>Émettre Police</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-subtle)' }}></div>

          {/* Option B: New quotation */}
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#34d399', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Plus size={18} />
              Option 2 : Saisir une Nouvelle Souscription (Simulateurs)
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Créez une nouvelle affaire directe selon la branche du risque :
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
              {[
                ['auto', Car, '#3b82f6', 'Automobile'],
                ['mrh', Home, '#0ea5e9', 'Habitation MRH'],
                ['sante', HeartPulse, '#f43f5e', 'Santé Groupe'],
                ['ia', Activity, '#a855f7', 'Individuelle IA'],
              ].map(([module, Icone, couleur, libelle]) => (
                <button
                  key={module}
                  className={`btn btn-secondary${moduleActif(module) ? '' : ' module-ferme'}`}
                  style={{ display: 'flex', flexDirection: 'column', padding: '1rem', height: 'auto', gap: '0.5rem', textAlign: 'center' }}
                  onClick={() => {
                    setIsModalOpen(false);
                    navigate(`/user/quotes/${module}`);
                  }}
                  disabled={!moduleActif(module)}
                  title={moduleActif(module) ? undefined : TITRE_MODULE_INACTIF}
                >
                  <Icone size={22} color={couleur} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{libelle}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal Mouvements de Police CIMA (Renouvellement, Avenant, Transformation, Résiliation) */}
      <PolicyMovementModal
        isOpen={!!actionContract}
        onClose={() => setActionContract(null)}
        contract={actionContract}
        initialTab={movementModalTab}
        onSuccess={() => {
          loadContractsData(selectedBranchFilter);
          loadStats();
          loadSubStats(selectedBranchFilter);
        }}
      />

      {/* Modal Alerte Suppression CIMA */}
      <DeleteConfirmModal
        isOpen={!!deletingContract}
        onClose={() => setDeletingContract(null)}
        itemType="contrat"
        itemName={`Police d'assurance ${deletingContract?.numeropolice} (${deletingContract?.client_nom})`}
        itemCode={deletingContract?.numeropolice}
        validation={deleteValidation}
        alternativeLabel="Résilier la Police (Art. 13)"
        onAlternativeAction={() => {
          if (deletingContract) {
            const target = deletingContract;
            setDeletingContract(null);
            setActionContract(target);
          }
        }}
        onConfirm={() => {
          if (deletingContract) {
            try {
              dataStore.deleteContract(deletingContract.id);
              loadContractsData(selectedBranchFilter);
              loadStats();
              loadSubStats(selectedBranchFilter);
            } catch (err) {
              toastError(err.message);
            }
          }
        }}
      />

    </div>
  );
};

export default ContractListPage;
