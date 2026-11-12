import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import React, { useState, useEffect } from 'react';
import { Modal } from '../../../components/common/Modal';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { typeSouscripteurApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { UserCheck, Plus, Edit2, Trash2, RefreshCw, Tag } from 'lucide-react';

export const TypeSouscripteurPage = () => {
  const { success, error: toastError } = useToast();

  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Création
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ code_type: '', libelle_type: '' });
  const [isSaving, setIsSaving] = useState(false);

  // Édition
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ code_type: '', libelle_type: '' });

  // Suppression
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await typeSouscripteurApi.getAll();
      setTypes(Array.isArray(data) ? data : []);
    } catch {
      toastError('Erreur lors du chargement des types de souscripteur.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createForm.code_type.trim() || !createForm.libelle_type.trim()) return;
    setIsSaving(true);
    try {
      await typeSouscripteurApi.create({
        code_type: createForm.code_type.trim().toUpperCase(),
        libelle_type: createForm.libelle_type.trim().toUpperCase(),
      });
      setIsCreateOpen(false);
      setCreateForm({ code_type: '', libelle_type: '' });
      success('Type de souscripteur créé avec succès.');
      load();
    } catch (err) {
      toastError(err?.response?.data?.error || 'Erreur lors de la création.');
    } finally {
      setIsSaving(false);
    }
  };

  const openEdit = (item) => {
    setEditTarget(item);
    setEditForm({ code_type: item.code_type || '', libelle_type: item.libelle_type || '' });
    setIsEditOpen(true);
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editTarget) return;
    setIsSaving(true);
    try {
      await typeSouscripteurApi.update(editTarget.id, {
        code_type: editForm.code_type.trim().toUpperCase(),
        libelle_type: editForm.libelle_type.trim().toUpperCase(),
      });
      setIsEditOpen(false);
      setEditTarget(null);
      success('Type de souscripteur modifié avec succès.');
      load();
    } catch (err) {
      toastError(err?.response?.data?.error || 'Erreur lors de la modification.');
    } finally {
      setIsSaving(false);
    }
  };

  const openDelete = (item) => { setDeleteTarget(item); setIsDeleteOpen(true); };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await typeSouscripteurApi.delete(deleteTarget.id);
      setIsDeleteOpen(false);
      setDeleteTarget(null);
      success('Type de souscripteur supprimé avec succès.');
      load();
    } catch (err) {
      toastError(err?.response?.data?.error || 'Erreur lors de la suppression.');
      setIsDeleteOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const columns = [
    {
      header: 'ID',
      accessor: 'id',
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: '#60a5fa', fontSize: '0.82rem' }}>#{r.id}</span>
      ),
    },
    {
      header: 'Code',
      accessor: 'code_type',
      render: (r) => (
        <span style={{
          fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.82rem',
          background: 'rgba(99,102,241,0.12)', color: '#818cf8',
          padding: '0.15rem 0.5rem', borderRadius: '5px',
        }}>
          {r.code_type}
        </span>
      ),
    },
    {
      header: 'Libellé Type Souscripteur',
      accessor: 'libelle_type',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <UserCheck size={14} style={{ color: '#34d399', flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.libelle_type}</span>
        </div>
      ),
    },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            onClick={() => openEdit(r)}>
            <Edit2 size={13} /> Modifier
          </button>
          <button className="btn"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem', display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer' }}
            onClick={() => openDelete(r)}>
            <Trash2 size={13} /> Supprimer
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            Types de souscripteur
          </h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.3rem 0 0 0' }}>
            Personne physique, entreprise, association…
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.65rem' }}>
          <button className="btn btn-secondary" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
            <RefreshCw size={14} /> Actualiser
          </button>
          <button className="btn btn-primary" onClick={() => { setIsCreateOpen(true); setCreateForm({ code_type: '', libelle_type: '' }); }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
            <Plus size={14} /> Nouveau Type
          </button>
        </div>
      </div>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Types</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#34d399', marginTop: '0.25rem' }}>{types.length}</div>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner text="Chargement des types de souscripteur en cours…" />
      ) : (
        <DataTable columns={columns} data={types} searchable searchPlaceholder="Rechercher un type de souscripteur…" emptyMessage="Aucun type de souscripteur enregistré." />
      )}

      {/* Modal Création */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Nouveau Type de Souscripteur" size="small">
        <form onSubmit={handleCreate}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Code *</label>
            <input type="text" className="form-control" placeholder="Ex: PART, ENTR, ASSOC…" value={createForm.code_type}
              onChange={(e) => setCreateForm((p) => ({ ...p, code_type: e.target.value }))}
              autoFocus required style={{ textTransform: 'uppercase' }} />
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Code court unique (max 20 caractères)</div>
          </div>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Libellé *</label>
            <input type="text" className="form-control" placeholder="Ex: PARTICULIER, ENTREPRISE, ASSOCIATION…" value={createForm.libelle_type}
              onChange={(e) => setCreateForm((p) => ({ ...p, libelle_type: e.target.value }))}
              required style={{ textTransform: 'uppercase' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCreateOpen(false)} disabled={isSaving}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving || !createForm.code_type.trim() || !createForm.libelle_type.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {isSaving ? 'Enregistrement…' : <><Plus size={14} /> Créer</>}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Édition */}
      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title={`Modifier - ${editTarget?.libelle_type || ''}`} size="small">
        <form onSubmit={handleEdit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Code *</label>
            <input type="text" className="form-control" value={editForm.code_type}
              onChange={(e) => setEditForm((p) => ({ ...p, code_type: e.target.value }))}
              required style={{ textTransform: 'uppercase' }} />
          </div>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Libellé *</label>
            <input type="text" className="form-control" value={editForm.libelle_type}
              onChange={(e) => setEditForm((p) => ({ ...p, libelle_type: e.target.value }))}
              autoFocus required style={{ textTransform: 'uppercase' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsEditOpen(false)} disabled={isSaving}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {isSaving ? 'Enregistrement…' : <><Edit2 size={14} /> Enregistrer</>}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Suppression */}
      {isDeleteOpen && deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '1.75rem', maxWidth: '400px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.45)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={18} style={{ color: '#f87171' }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>Supprimer ce type ?</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Action irréversible.</div>
              </div>
            </div>
            <div style={{ padding: '0.75rem', background: 'var(--bg-muted)', borderRadius: '8px', marginBottom: '1.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Type : <strong>{deleteTarget.libelle_type}</strong> (<code>{deleteTarget.code_type}</code>)
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setIsDeleteOpen(false)} disabled={isDeleting}>Annuler</button>
              <button className="btn" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={handleDelete} disabled={isDeleting}>
                <Trash2 size={14} /> {isDeleting ? 'Suppression…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TypeSouscripteurPage;
