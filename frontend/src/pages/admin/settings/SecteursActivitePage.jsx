import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import React, { useState, useEffect } from 'react';
import { Modal } from '../../../components/common/Modal';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { secteurActiviteApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { Building, Plus, Edit2, Trash2, Users, AlertTriangle, RefreshCw } from 'lucide-react';

export const SecteursActivitePage = () => {
  const { success, error: toastError } = useToast();

  const [secteurs, setSecteurs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Create modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createLibelle, setCreateLibelle] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Edit modal
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editLibelle, setEditLibelle] = useState('');

  // Delete modal
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadSecteurs = async () => {
    setLoading(true);
    try {
      const data = await secteurActiviteApi.getAll();
      setSecteurs(Array.isArray(data) ? data : []);
    } catch (err) {
      toastError("Erreur lors du chargement des secteurs d'activité.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSecteurs();
  }, []);

  const totalSecteurs = secteurs.length;
  const withClients = secteurs.filter((s) => (s.client_count || 0) > 0).length;
  const totalClientsRattaches = secteurs.reduce((acc, s) => acc + (s.client_count || 0), 0);

  // Create
  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createLibelle.trim()) return;
    setIsSaving(true);
    try {
      await secteurActiviteApi.create({ Libelle: createLibelle.trim().toUpperCase() });
      setIsCreateOpen(false);
      setCreateLibelle('');
      success("Secteur d'activité créé avec succès.");
      loadSecteurs();
    } catch (err) {
      toastError(err?.response?.data?.error || 'Erreur lors de la création.');
    } finally {
      setIsSaving(false);
    }
  };

  // Edit
  const openEdit = (secteur) => {
    setEditTarget(secteur);
    setEditLibelle(secteur.Libelle || '');
    setIsEditOpen(true);
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editTarget || !editLibelle.trim()) return;
    setIsSaving(true);
    try {
      await secteurActiviteApi.update(editTarget.IdSecteurActivite, { Libelle: editLibelle.trim().toUpperCase() });
      setIsEditOpen(false);
      setEditTarget(null);
      success("Secteur d'activité modifié avec succès.");
      loadSecteurs();
    } catch (err) {
      toastError(err?.response?.data?.error || 'Erreur lors de la modification.');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete
  const openDelete = (secteur) => {
    setDeleteTarget(secteur);
    setIsDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await secteurActiviteApi.delete(deleteTarget.IdSecteurActivite);
      setIsDeleteOpen(false);
      setDeleteTarget(null);
      success("Secteur d'activité supprimé avec succès.");
      loadSecteurs();
    } catch (err) {
      const msg = err?.response?.data?.error || 'Erreur lors de la suppression.';
      toastError(msg);
      setIsDeleteOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const columns = [
    {
      header: 'ID',
      accessor: 'IdSecteurActivite',
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: '#60a5fa', fontSize: '0.82rem' }}>
          #{r.IdSecteurActivite}
        </span>
      ),
    },
    {
      header: "Libellé du Secteur d'Activité Économique",
      accessor: 'Libelle',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Building size={14} style={{ color: '#a78bfa', flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.Libelle}</span>
        </div>
      ),
    },
    {
      header: 'Clients Rattachés',
      accessor: 'client_count',
      render: (r) => {
        const count = r.client_count || 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Users size={13} style={{ color: count > 0 ? '#34d399' : 'var(--text-muted)' }} />
            <StatusBadge
              label={count > 0 ? `${count} client(s)` : 'Aucun client'}
              color={count > 0 ? 'emerald' : 'gray'}
            />
          </div>
        );
      },
    },
    {
      header: 'Supprimable',
      render: (r) => {
        const linked = (r.client_count || 0) > 0;
        return linked
          ? <StatusBadge label="Non (clients liés)" color="rose" />
          : <StatusBadge label="Oui" color="emerald" />;
      },
    },
    {
      header: 'Actions',
      render: (r) => {
        const linked = (r.client_count || 0) > 0;
        return (
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              onClick={() => openEdit(r)}
            >
              <Edit2 size={13} /> Modifier
            </button>
            <button
              className="btn"
              style={{
                fontSize: '0.75rem', padding: '0.25rem 0.55rem',
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                background: 'rgba(239,68,68,0.12)',
                color: linked ? '#6b7280' : '#f87171',
                border: `1px solid ${linked ? 'rgba(107,114,128,0.2)' : 'rgba(239,68,68,0.3)'}`,
                cursor: linked ? 'not-allowed' : 'pointer',
                opacity: linked ? 0.5 : 1,
              }}
              onClick={() => !linked && openDelete(r)}
              title={linked ? `Non supprimable : ${r.client_count} client(s) rattaché(s)` : 'Supprimer'}
              disabled={linked}
            >
              <Trash2 size={13} />
              {linked ? `Lié (${r.client_count})` : 'Supprimer'}
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            Secteurs d'activité
          </h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem', margin: '0.3rem 0 0 0' }}>
            Secteurs d'activité des entreprises clientes.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.65rem' }}>
          <button
            className="btn btn-secondary"
            onClick={loadSecteurs}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
          >
            <RefreshCw size={14} /> Actualiser
          </button>
          <button
            className="btn btn-primary"
            onClick={() => { setIsCreateOpen(true); setCreateLibelle(''); }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
          >
            <Plus size={14} /> Nouveau Secteur d'Activité
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Secteurs', value: totalSecteurs, color: '#a78bfa' },
          { label: 'Secteurs Attribués', value: withClients, color: '#34d399' },
          { label: 'Clients Rattachés', value: totalClientsRattaches, color: '#60a5fa' },
        ].map((kpi) => (
          <div key={kpi.label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {kpi.label}
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: kpi.color, marginTop: '0.25rem' }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <LoadingSpinner text="Chargement des secteurs d'activité en cours…" />
      ) : (
        <DataTable
          columns={columns}
          data={secteurs}
          searchable
          searchPlaceholder="Rechercher un secteur d'activité…"
          emptyMessage="Aucun secteur d'activité enregistré. Cliquez sur «+ Nouveau» pour commencer."
        />
      )}

      {/* Modal Création */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Nouveau Secteur d'Activité Économique" size="small">
        <form onSubmit={handleCreate}>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
              Libellé du secteur d'activité *
            </label>
            <input
              type="text"
              className="form-control"
              placeholder="Ex: AGRICULTURE, COMMERCE DE DÉTAIL, INDUSTRIE…"
              value={createLibelle}
              onChange={(e) => setCreateLibelle(e.target.value)}
              autoFocus
              required
              style={{ textTransform: 'uppercase' }}
            />
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
              Sera enregistré en majuscules.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCreateOpen(false)} disabled={isSaving}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving || !createLibelle.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {isSaving ? 'Enregistrement…' : <><Plus size={14} /> Créer le Secteur</>}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Édition */}
      <Modal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title={`Modifier - ${editTarget?.Libelle || ''}`}
        size="small"
      >
        <form onSubmit={handleEdit}>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
              Nouveau libellé *
            </label>
            <input
              type="text"
              className="form-control"
              value={editLibelle}
              onChange={(e) => setEditLibelle(e.target.value)}
              autoFocus
              required
              style={{ textTransform: 'uppercase' }}
            />
            {editTarget && (editTarget.client_count || 0) > 0 && (
              <div style={{
                marginTop: '0.75rem', padding: '0.6rem 0.85rem',
                background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.5rem',
                fontSize: '0.75rem', color: '#fbbf24',
              }}>
                <AlertTriangle size={13} />
                Ce secteur est rattaché à {editTarget.client_count} client(s). La modification sera immédiate.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsEditOpen(false)} disabled={isSaving}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving || !editLibelle.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {isSaving ? 'Enregistrement…' : <><Edit2 size={14} /> Enregistrer</>}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Confirmation Suppression */}
      {isDeleteOpen && deleteTarget && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        }}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
            borderRadius: '12px', padding: '1.75rem', maxWidth: '420px', width: '100%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={18} style={{ color: '#f87171' }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>Supprimer le secteur d'activité ?</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cette action est irréversible.</div>
              </div>
            </div>
            <div style={{ padding: '0.75rem', background: 'var(--bg-muted)', borderRadius: '8px', marginBottom: '1.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Vous êtes sur le point de supprimer <strong>« {deleteTarget.Libelle} »</strong>.
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setIsDeleteOpen(false)} disabled={isDeleting}>Annuler</button>
              <button
                className="btn"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <Trash2 size={14} />
                {isDeleting ? 'Suppression…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecteursActivitePage;
