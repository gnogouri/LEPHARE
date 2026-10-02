import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { dataStore } from '../../../api/dataStore';
import { customerApi, quoteApi, claimsApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { canUser } from '../../../utils/rbac';
import { exportToPdf, printFicheClient } from '../../../utils/exportUtils';
import {
  Archive,
  Users,
  FileText,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Eye,
  Printer,
  Calendar,
  Search,
} from 'lucide-react';

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Détermine si un enregistrement client est archivé (mêmes règles que ClientListPage)
const isArchivedClient = (c) => c.Statut === 'A' || c.statut === 'Archivé' || c.archive === true;
const isArchivedQuote = (q) => q.archive === true || q.statut === 'Archivé';
const isArchivedContract = (c) => c.archive === true || c.statut_contrat === 'Archivé' || c.statut === 'Archivé';
const isArchivedClaim = (c) => c.archive === true || c.statut === 'Archivé' || c.statut === 'Archivé / Sans suite';

const TYPE_META = {
  client: { label: 'Client', icon: Users, color: '#60a5fa' },
  devis: { label: 'Devis', icon: FileText, color: '#fbbf24' },
  contrat: { label: 'Contrat', icon: ShieldCheck, color: '#34d399' },
  sinistre: { label: 'Sinistre', icon: AlertTriangle, color: '#f87171' },
};

export const ArchivesPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const loadArchives = async () => {
    setLoading(true);
    try {
      // Clients & Devis & Sinistres : API réelle en priorité, fallback local dataStore.
      // Contrats : pas d'archivage persisté côté backend pour l'instant → dataStore uniquement
      // (évite aussi de rapatrier les ~21 000 contrats réels rien que pour filtrer les archivés).
      const [clientsRaw, quotesRaw, claimsRaw] = await Promise.all([
        customerApi.getClients().catch(() => null),
        quoteApi.getQuotes().catch(() => null),
        claimsApi.getClaims().catch(() => null),
      ]);

      const clients = (clientsRaw && clientsRaw.length > 0 ? clientsRaw : dataStore.getClients()).filter(isArchivedClient);
      const quotes = (quotesRaw && quotesRaw.length > 0 ? quotesRaw : dataStore.getQuotes()).filter(isArchivedQuote);
      const contracts = dataStore.getContracts().filter(isArchivedContract);
      const claims = (claimsRaw && claimsRaw.length > 0 ? claimsRaw : dataStore.getClaims()).filter(isArchivedClaim);

      const unified = [
        ...clients.map((c) => ({
          type: 'client',
          id: c.id || c.IdClient,
          reference: c.codeclient || c.Matricule || `CLI-${c.id}`,
          codeclient: c.codeclient || c.Matricule || `CLI-${c.id}`, // alias pour la recherche intégrée de DataTable
          nom: c.nomcomplet || [c.Nom || c.nom, c.Prenoms || c.prenom].filter(Boolean).join(' ') || 'Client sans nom',
          detail: c.profession || c.libelleprofession || (c.typeclient === 'Entreprise' ? 'Entreprise' : 'Particulier'),
          dateArchivage: c.date_archivage || null,
          motif: c.motif_archivage || '—',
          raw: c,
        })),
        ...quotes.map((q) => ({
          type: 'devis',
          id: q.id || q.IdDevis,
          reference: q.numerodevis || `DEV-${q.id}`,
          numerodevis: q.numerodevis || `DEV-${q.id}`, // alias pour la recherche intégrée de DataTable
          nom: q.client_nom || q.nom_client || q.souscripteur || 'Client',
          detail: q.branche || q.produit || '—',
          dateArchivage: q.date_archivage || null,
          motif: q.motif_archivage || '—',
          raw: q,
        })),
        ...contracts.map((c) => ({
          type: 'contrat',
          id: c.id || c.idcontrat,
          reference: c.numeropolice || `POL-${c.id}`,
          numeropolice: c.numeropolice || `POL-${c.id}`, // alias pour la recherche intégrée de DataTable
          nom: c.client_nom || c.souscripteur || c.assure || 'Assuré',
          detail: c.produit || c.branche || '—',
          dateArchivage: c.date_archivage || null,
          motif: c.motif_archivage || '—',
          raw: c,
        })),
        ...claims.map((c) => ({
          type: 'sinistre',
          id: c.id,
          reference: c.numero_sinistre || `SIN-${c.id}`,
          codeclient: c.numero_sinistre || `SIN-${c.id}`, // alias pour la recherche intégrée de DataTable
          nom: c.client_nom || c.souscripteur || 'Assuré',
          detail: c.nature || '—',
          dateArchivage: c.date_archivage || c.date_cloture || null,
          motif: c.motif_archivage || '—',
          raw: c,
        })),
      ];

      unified.sort((a, b) => new Date(b.dateArchivage || 0) - new Date(a.dateArchivage || 0));
      setRows(unified);
    } catch (err) {
      console.error('Erreur chargement des archives :', err);
      toastError("Erreur lors du chargement des archives.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadArchives();
    return dataStore.subscribe((key) => {
      if (
        key === 'uranus_clients' ||
        key === 'uranus_quotes' ||
        key === 'uranus_contracts' ||
        key === 'uranus_claims'
      ) {
        loadArchives();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtrage : type d'entité + plage de dates d'archivage
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (typeFilter !== 'ALL' && r.type !== typeFilter) return false;
      if (dateFrom && (!r.dateArchivage || new Date(r.dateArchivage) < new Date(dateFrom))) return false;
      if (dateTo && (!r.dateArchivage || new Date(r.dateArchivage) > new Date(dateTo))) return false;
      return true;
    });
  }, [rows, typeFilter, dateFrom, dateTo]);

  const counts = useMemo(() => {
    const c = { ALL: rows.length, client: 0, devis: 0, contrat: 0, sinistre: 0 };
    rows.forEach((r) => { c[r.type] = (c[r.type] || 0) + 1; });
    return c;
  }, [rows]);

  // Vérifie l'habilitation de restauration selon le type d'enregistrement
  const canRestore = (type) => {
    const resourceMap = { client: 'clients', devis: 'quotes', contrat: 'contracts', sinistre: 'claims' };
    return canUser(user, 'delete', resourceMap[type]); // même habilitation que l'archivage/suppression
  };

  const handleRestore = async (row) => {
    try {
      if (row.type === 'client') {
        try {
          await customerApi.updateClient(row.id, { ...row.raw, Statut: 'V' });
        } catch {
          dataStore.unarchiveClient(row.id);
        }
      } else if (row.type === 'devis') {
        try {
          await quoteApi.unarchiveQuote(row.id);
        } catch {
          dataStore.unarchiveQuote(row.id);
        }
      } else if (row.type === 'contrat') {
        dataStore.unarchiveContract(row.id);
      } else if (row.type === 'sinistre') {
        try {
          await claimsApi.updateClaim(row.id, { statut: "En cours d'instruction" });
        } catch {
          dataStore.unarchiveClaim(row.id);
        }
      }
      success(`${TYPE_META[row.type].label} « ${row.nom} » (${row.reference}) a été restauré avec succès.`);
      loadArchives();
    } catch (err) {
      toastError(err.response?.data?.detail || err.message || 'Erreur lors de la restauration.');
    }
  };

  const handleView = (row) => {
    if (row.type === 'client') navigate(`/user/clients/${row.id}`);
    else if (row.type === 'contrat') navigate(`/user/contracts/${row.id}`);
    else if (row.type === 'sinistre') navigate(`/user/claims/detail?id=${row.id}`);
    else if (row.type === 'devis') navigate('/user/quotes');
  };

  const handlePrintList = () => {
    if (filteredRows.length === 0) {
      toastError('Aucun élément archivé à imprimer pour ce filtre.');
      return;
    }
    exportToPdf({
      filename: `archives_${new Date().toISOString().split('T')[0]}`,
      title: 'Registre des Éléments Archivés',
      subtitle: typeFilter === 'ALL' ? 'Toutes catégories confondues' : `Catégorie : ${TYPE_META[typeFilter].label}`,
      metadata: {
        'Total archivé': filteredRows.length,
        'Période': dateFrom || dateTo ? `${dateFrom || '…'} → ${dateTo || '…'}` : 'Toutes dates',
      },
      headers: ['Type', 'Référence', 'Client', 'Détail', "Date d'archivage", 'Motif'],
      rows: filteredRows.map((r) => [
        TYPE_META[r.type].label,
        r.reference,
        r.nom,
        r.detail,
        fmtDate(r.dateArchivage),
        r.motif,
      ]),
    });
  };

  const columns = [
    {
      header: 'Type',
      accessor: 'type',
      render: (row) => {
        const meta = TYPE_META[row.type];
        const Icon = meta.icon;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', background: `${meta.color}22`, color: meta.color }}>
            <Icon size={12} />
            {meta.label}
          </span>
        );
      },
    },
    {
      header: 'Référence',
      accessor: 'reference',
      render: (row) => <strong style={{ color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>{row.reference}</strong>,
    },
    {
      header: 'Client',
      accessor: 'nom',
      render: (row) => <span style={{ color: '#fff', fontWeight: 600 }}>{row.nom}</span>,
    },
    {
      header: 'Détail',
      accessor: 'detail',
    },
    {
      header: "Date d'archivage",
      accessor: 'dateArchivage',
      render: (row) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-secondary)' }}>
          <Calendar size={12} /> {fmtDate(row.dateArchivage)}
        </span>
      ),
    },
    {
      header: 'Motif',
      accessor: 'motif',
      render: (row) => <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{row.motif}</span>,
    },
    {
      header: 'Statut',
      render: () => <StatusBadge label="Archivé" color="slate" />,
    },
    {
      header: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          {row.type !== 'devis' && (
            <button
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              onClick={() => handleView(row)}
              title="Consulter le dossier"
            >
              <Eye size={13} />
            </button>
          )}

          {row.type === 'client' && (
            <button
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              onClick={() => printFicheClient(row.raw)}
              title="Imprimer la fiche client"
            >
              <Printer size={13} color="#60a5fa" />
            </button>
          )}

          <button
            className="btn btn-secondary"
            disabled={!canRestore(row.type)}
            style={{
              padding: '0.3rem 0.55rem',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              color: canRestore(row.type) ? '#34d399' : 'var(--text-muted)',
              opacity: canRestore(row.type) ? 1 : 0.45,
              cursor: canRestore(row.type) ? 'pointer' : 'not-allowed',
            }}
            onClick={() => canRestore(row.type) && handleRestore(row)}
            title={canRestore(row.type) ? 'Désarchiver / Restaurer' : 'Non habilité pour restaurer'}
          >
            <RotateCcw size={13} />
            <span>Restaurer</span>
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Archive size={26} color="#94a3b8" />
            Archives
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Registre unifié de tous les éléments archivés de l'application (clients, devis, contrats, sinistres),
            conservés conformément au Code CIMA. Recherche, filtrage et restauration centralisés.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handlePrintList}
          disabled={loading || filteredRows.length === 0}
          title="Imprimer le registre des archives filtrées"
          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
        >
          <Printer size={16} />
          <span>Imprimer la Liste</span>
        </button>
      </div>

      {/* Filtres */}
      <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Catégorie</span>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {[
              { id: 'ALL', label: 'Toutes' },
              { id: 'client', label: 'Clients' },
              { id: 'devis', label: 'Devis' },
              { id: 'contrat', label: 'Contrats' },
              { id: 'sinistre', label: 'Sinistres' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                className={`btn ${typeFilter === t.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.78rem', padding: '0.4rem 0.75rem' }}
                onClick={() => setTypeFilter(t.id)}
              >
                {t.label} ({counts[t.id] || 0})
              </button>
            ))}
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: '0.75rem' }}>Archivé depuis le</label>
          <input type="date" className="form-control" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: '0.75rem' }}>Archivé jusqu'au</label>
          <input type="date" className="form-control" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>

        {(dateFrom || dateTo || typeFilter !== 'ALL') && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.78rem' }}
            onClick={() => { setTypeFilter('ALL'); setDateFrom(''); setDateTo(''); }}
          >
            Réinitialiser les filtres
          </button>
        )}
      </div>

      {/* Table */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <DataTable
          columns={columns}
          data={filteredRows}
          loading={loading}
          loadingText="Chargement des archives…"
          searchable
          searchPlaceholder="Rechercher par référence, nom du client…"
          itemsPerPage={15}
        />
      </div>
    </div>
  );
};

export default ArchivesPage;
