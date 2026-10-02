import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../../../components/common/Modal';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { professionApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { Briefcase, Plus, Edit2, Trash2, Archive, Users, AlertTriangle, RefreshCw, Search } from 'lucide-react';

export const ProfessionsPage = () => {
  const { success, error: toastError } = useToast();

  const [professions, setProfessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Création
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ Libelle: '', CodeProfession: '' });
  const [isSaving, setIsSaving] = useState(false);

  // Édition
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ Libelle: '', CodeProfession: '' });

  // Suppression
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadProfessions = async () => {
    setLoading(true);
    try {
      const data = await professionApi.getAll();
      setProfessions(Array.isArray(data) ? data : []);
    } catch {
      toastError('Impossible de charger les professions. Veuillez réessayer.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfessions();
  }, []);

  const totalProfessions = professions.length;
  const withClients = professions.filter((p) => (p.client_count || 0) > 0).length;
  const totalClientsRattaches = professions.reduce((acc, p) => acc + (p.client_count || 0), 0);

  const filteredProfessions = useMemo(() => {
    if (!searchTerm.trim()) return professions;
    const term = searchTerm.toLowerCase().trim();
    return professions.filter(
      (p) =>
        (p.Libelle && p.Libelle.toLowerCase().includes(term)) ||
        (p.CodeProfession && p.CodeProfession.toLowerCase().includes(term)) ||
        String(p.IdProfession).includes(term)
    );
  }, [professions, searchTerm]);

  // Créer une profession
  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createForm.Libelle.trim()) return;
    setIsSaving(true);
    try {
      await professionApi.create({
        Libelle: createForm.Libelle.trim(),
        CodeProfession: createForm.CodeProfession ? createForm.CodeProfession.trim().toUpperCase() : undefined,
      });
      setIsCreateOpen(false);
      setCreateForm({ Libelle: '', CodeProfession: '' });
      success('Profession créée avec succès.');
      loadProfessions();
    } catch (err) {
      toastError(err?.response?.data?.error || err?.response?.data?.Libelle?.[0] || 'Erreur lors de la création.');
    } finally {
      setIsSaving(false);
    }
  };

  // Éditer une profession
  const openEdit = (prof) => {
    setEditTarget(prof);
    setEditForm({
      Libelle: prof.Libelle || '',
      CodeProfession: prof.CodeProfession || '',
    });
    setIsEditOpen(true);
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editTarget || !editForm.Libelle.trim()) return;
    setIsSaving(true);
    try {
      await professionApi.update(editTarget.IdProfession, {
        Libelle: editForm.Libelle.trim(),
        CodeProfession: editForm.CodeProfession ? editForm.CodeProfession.trim().toUpperCase() : '',
      });
      setIsEditOpen(false);
      setEditTarget(null);
      success('Profession modifiée avec succès.');
      loadProfessions();
    } catch (err) {
      toastError(err?.response?.data?.error || err?.response?.data?.Libelle?.[0] || 'Erreur lors de la modification.');
    } finally {
      setIsSaving(false);
    }
  };

  // Supprimer une profession
  const openDelete = (prof) => {
    setDeleteTarget(prof);
    setIsDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await professionApi.delete(deleteTarget.IdProfession);
      setIsDeleteOpen(false);
      setDeleteTarget(null);
      success('Profession supprimée avec succès.');
      loadProfessions();
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
      accessor: 'IdProfession',
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: '#60a5fa', fontSize: '0.82rem' }}>
          #{r.IdProfession}
        </span>
      ),
    },
    {
      header: 'Code Profession',
      accessor: 'CodeProfession',
      render: (r) => (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: '0.82rem',
            background: 'rgba(99,102,241,0.12)',
            color: '#818cf8',
            padding: '0.15rem 0.5rem',
            borderRadius: '5px',
          }}
        >
          {r.CodeProfession || '—'}
        </span>
      ),
    },
    {
      header: 'Libellé de la Profession',
      accessor: 'Libelle',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
          <Briefcase size={15} style={{ color: '#3b82f6', flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.Libelle}</span>
        </div>
      ),
    },
    {
      header: 'Clients Rattachés',
      accessor: 'client_count',
      render: (r) => {
        const count = r.client_count || 0;
        return count > 0 ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: 'rgba(52,211,153,0.12)',
              color: '#34d399',
              padding: '0.2rem 0.6rem',
              borderRadius: '20px',
              fontSize: '0.8rem',
              fontWeight: 700,
            }}
          >
            <Users size={12} /> {count} client{count > 1 ? 's' : ''}
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>0 client</span>
        );
      },
    },
    {
      header: 'Supprimable',
      render: (r) => {
        const linked = (r.client_count || 0) > 0;
        return linked ? (
          <StatusBadge label="Non (clients liés)" color="rose" />
        ) : (
          <StatusBadge label="Oui" color="emerald" />
        );
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
              className="btn btn-secondary"
              style={{
                fontSize: '0.75rem',
                padding: '0.25rem 0.55rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                color: linked ? 'var(--text-muted)' : '#38bdf8',
                border: `1px solid ${linked ? 'rgba(107,114,128,0.2)' : 'rgba(56,189,248,0.3)'}`,
                cursor: linked ? 'not-allowed' : 'pointer',
                opacity: linked ? 0.5 : 1,
              }}
              onClick={() => !linked && openDelete(r)}
              title={linked ? `Non supprimable : ${r.client_count} client(s) rattaché(s)` : 'Archiver la profession'}
              disabled={linked}
            >
              <Archive size={13} />
              {linked ? `Lié (${r.client_count})` : 'Archiver'}
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            Professions
          </h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem', margin: '0.3rem 0 0 0' }}>
            Professions proposées sur les fiches clients.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.65rem' }}>
          <button
            className="btn btn-secondary"
            onClick={loadProfessions}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
          >
            <RefreshCw size={14} /> Actualiser
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setCreateForm({ Libelle: '', CodeProfession: '' });
              setIsCreateOpen(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
          >
            <Plus size={14} /> Nouvelle Profession
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        {[
          { label: 'Total Professions', value: totalProfessions, color: '#a78bfa' },
          { label: 'Professions Attribuées', value: withClients, color: '#34d399' },
          { label: 'Clients Rattachés', value: totalClientsRattaches, color: '#60a5fa' },
        ].map((kpi) => (
          <div
            key={kpi.label}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '1rem 1.25rem',
            }}
          >
            <div
              style={{
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {kpi.label}
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: kpi.color, marginTop: '0.25rem' }}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <div style={{ position: 'relative', maxWidth: '360px', width: '100%' }}>
          <Search
            size={15}
            style={{
              position: 'absolute',
              left: '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            type="text"
            className="form-control"
            placeholder="Rechercher par libellé, code ou ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ paddingLeft: '2.2rem', fontSize: '0.85rem' }}
          />
        </div>
        {searchTerm && (
          <button
            className="btn btn-secondary"
            onClick={() => setSearchTerm('')}
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
          >
            Effacer
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <LoadingSpinner text="Chargement des professions en cours…" />
      ) : (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', overflow: 'hidden' }}>
          <DataTable
            columns={columns}
            data={filteredProfessions}
            emptyMessage="Aucune profession disponible."
          />
        </div>
      )}

      {/* Modal Création */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Créer une Profession"
      >
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">
              Libellé de la Profession <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input
              type="text"
              className="form-control"
              placeholder="Ex: MÉDECIN, INFORMATICIEN, COMMERÇANT..."
              value={createForm.Libelle}
              onChange={(e) => setCreateForm({ ...createForm, Libelle: e.target.value })}
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Code Profession <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(Optionnel, auto-généré si vide)</span>
            </label>
            <input
              type="text"
              className="form-control"
              placeholder="Ex: PROF15, ST12..."
              value={createForm.CodeProfession}
              onChange={(e) => setCreateForm({ ...createForm, CodeProfession: e.target.value.toUpperCase() })}
              style={{ textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsCreateOpen(false)}
              disabled={isSaving}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSaving || !createForm.Libelle.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              {isSaving ? 'Enregistrement...' : 'Créer la Profession'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Édition */}
      <Modal
        isOpen={isEditOpen}
        onClose={() => {
          setIsEditOpen(false);
          setEditTarget(null);
        }}
        title={`Modifier la Profession #${editTarget?.IdProfession || ''}`}
      >
        <form onSubmit={handleEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">
              Libellé de la Profession <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input
              type="text"
              className="form-control"
              value={editForm.Libelle}
              onChange={(e) => setEditForm({ ...editForm, Libelle: e.target.value })}
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Code Profession</label>
            <input
              type="text"
              className="form-control"
              value={editForm.CodeProfession}
              onChange={(e) => setEditForm({ ...editForm, CodeProfession: e.target.value.toUpperCase() })}
              style={{ textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}
            />
          </div>

          {editTarget && (editTarget.client_count || 0) > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                background: 'rgba(59,130,246,0.1)',
                border: '1px solid rgba(59,130,246,0.25)',
                borderRadius: '8px',
                padding: '0.75rem',
                fontSize: '0.8rem',
                color: '#93c5fd',
              }}
            >
              <Users size={16} style={{ flexShrink: 0 }} />
              <span>
                Cette profession est rattachée à <strong>{editTarget.client_count} client(s)</strong>. La
                modification du libellé se répercutera sur l'ensemble de leurs dossiers.
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setIsEditOpen(false);
                setEditTarget(null);
              }}
              disabled={isSaving}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSaving || !editForm.Libelle.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              {isSaving ? 'Enregistrement...' : 'Enregistrer les Modifications'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Archivage */}
      <Modal
        isOpen={isDeleteOpen}
        onClose={() => {
          setIsDeleteOpen(false);
          setDeleteTarget(null);
        }}
        title="Archiver la Profession"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              borderRadius: '8px',
              padding: '0.85rem',
              color: 'var(--text-secondary)',
              fontSize: '0.85rem',
            }}
          >
            <Archive size={20} style={{ color: '#3b82f6', flexShrink: 0, marginTop: '2px' }} />
            <div>
              Confirmer l'archivage réglementaire de la profession{' '}
              <strong style={{ color: '#fff' }}>« {deleteTarget?.Libelle} »</strong> (Code:{' '}
              <code style={{ color: '#60a5fa' }}>{deleteTarget?.CodeProfession || 'N/A'}</code>) ?
              <div style={{ fontSize: '0.75rem', marginTop: '0.35rem', color: '#93c5fd' }}>
                Conformément aux règles de traçabilité, la suppression définitive est proscrite. Cette profession sera archivée et désactivée du référentiel actif.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setIsDeleteOpen(false);
                setDeleteTarget(null);
              }}
              disabled={isDeleting}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{
                background: '#2563eb',
                borderColor: '#3b82f6',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                cursor: 'pointer',
              }}
              onClick={handleDelete}
              disabled={isDeleting}
            >
              <Archive size={14} />
              {isDeleting ? 'Archivage...' : "Confirmer l'Archivage"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ProfessionsPage;
