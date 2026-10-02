import React, { useState, useEffect } from 'react';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import {
  ShieldCheck,
  Plus,
  Edit2,
  Trash2,
  Users,
  ShieldAlert,
  CheckCircle2,
  Compass,
  Settings,
  Percent,
  Layers,
} from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import {
  getProfiles,
  addProfile,
  updateProfile,
  deleteProfile,
} from '../../../api/profileService';

const AVAILABLE_MODULES = [
  { id: 'quotes', label: 'Devis & Tarifications', desc: 'Auto, MRH, Santé Groupe, Individuelle Accident' },
  { id: 'contracts', label: 'Contrats', desc: 'Consultation, fiches 360°, historiques' },
  { id: 'asaci', label: 'Attestations ASACI', desc: 'Émission et impression des cartes numériques' },
  { id: 'cash', label: 'Caisse & Encaissements', desc: 'Espèces, virements, Mobile Money' },
  { id: 'cheques', label: 'Gestion des Chèques', desc: 'Enregistrement, bordereaux de remise' },
  { id: 'endorsements', label: 'Avenants', desc: 'Changements de véhicule, renouvellements' },
  { id: 'remittances', label: 'Reversements Compagnies', desc: 'Bordereaux de paiement des assureurs' },
  { id: 'commissions', label: 'Commissions Apporteurs', desc: 'Calcul et liquidation des commissions' },
  { id: 'cima', label: 'Reporting & CIMA E1/E2', desc: 'États réglementaires et bordereaux' },
  { id: 'approvals', label: 'Centre d\'Approbation', desc: 'Validation des dérogations et jetons' },
  { id: 'admin', label: 'Administration Système', desc: 'Utilisateurs, profils, catalogue et tarifs' },
];

export const ProfileManagementPage = () => {
  const [profiles, setProfiles] = useState(getProfiles());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);
  const [filterSpace, setFilterSpace] = useState('ALL');
  const { success, warning } = useToast();

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    space: 'USER',
    description: '',
    derogation_max: 5,
    auto_approve: false,
    modules: ['quotes', 'contracts', 'asaci', 'cash'],
  });

  useEffect(() => {
    const handleUpdate = (e) => {
      setProfiles(e.detail || getProfiles());
    };
    window.addEventListener('uranus_profiles_updated', handleUpdate);
    return () => window.removeEventListener('uranus_profiles_updated', handleUpdate);
  }, []);

  const handleOpenCreateModal = () => {
    setEditingProfile(null);
    setFormData({
      code: '',
      name: '',
      space: 'USER',
      description: '',
      derogation_max: 5,
      auto_approve: false,
      modules: ['quotes', 'contracts', 'asaci', 'cash'],
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (profile) => {
    setEditingProfile(profile);
    setFormData({
      code: profile.code,
      name: profile.name,
      space: profile.space,
      description: profile.description,
      derogation_max: profile.derogation_max,
      auto_approve: profile.auto_approve,
      modules: profile.modules || [],
    });
    setIsModalOpen(true);
  };

  const handleToggleModule = (moduleId) => {
    setFormData((prev) => {
      const exists = prev.modules.includes(moduleId);
      return {
        ...prev,
        modules: exists
          ? prev.modules.filter((m) => m !== moduleId)
          : [...prev.modules, moduleId],
      };
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.code.trim()) {
      warning('Veuillez remplir le code et le libellé du profil.');
      return;
    }

    const cleanCode = formData.code.toUpperCase().replace(/\s+/g, '_');

    if (editingProfile) {
      updateProfile(editingProfile.id, {
        ...formData,
        code: cleanCode,
      });
      success(`Profil "${formData.name}" mis à jour avec succès.`);
    } else {
      addProfile({
        ...formData,
        code: cleanCode,
      });
      success(`Nouveau profil "${formData.name}" créé avec succès.`);
    }

    setProfiles(getProfiles());
    setIsModalOpen(false);
  };

  const handleDelete = (profile) => {
    if (profile.user_count > 0) {
      warning(`Impossible de supprimer le profil "${profile.name}" car ${profile.user_count} utilisateur(s) y sont rattachés.`);
      return;
    }
    if (window.confirm(`Confirmez-vous la suppression définitive du profil "${profile.name}" ?`)) {
      deleteProfile(profile.id);
      setProfiles(getProfiles());
      success(`Profil "${profile.name}" supprimé.`);
    }
  };

  const handleToggleActive = (profile) => {
    updateProfile(profile.id, { is_active: !profile.is_active });
    setProfiles(getProfiles());
    success(`Statut du profil "${profile.name}" actualisé.`);
  };

  const filteredProfiles = profiles.filter((p) => {
    if (filterSpace === 'ALL') return true;
    return p.space === filterSpace || p.space === 'ALL';
  });

  const totalUsersLinked = profiles.reduce((acc, p) => acc + (p.user_count || 0), 0);

  const columns = [
    {
      header: 'Profil & Identifiant',
      render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.9rem' }}>{r.name}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '0.725rem',
                color: '#60a5fa',
                background: 'rgba(59, 130, 246, 0.1)',
                padding: '1px 6px',
                borderRadius: '4px',
                border: '1px solid rgba(59, 130, 246, 0.25)',
              }}
            >
              {r.code}
            </span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px', maxWidth: '300px' }}>
            {r.description}
          </span>
        </div>
      ),
    },
    {
      header: 'Espace Autorisé',
      render: (r) => {
        if (r.space === 'ALL') {
          return (
            <span className="badge badge-purple" style={{ gap: '0.3rem' }}>
              <Layers size={12} /> Global (Opérateur & Admin)
            </span>
          );
        }
        if (r.space === 'ADMIN') {
          return (
            <span className="badge badge-amber" style={{ gap: '0.3rem' }}>
              <Settings size={12} /> Espace Administration
            </span>
          );
        }
        return (
          <span className="badge badge-blue" style={{ gap: '0.3rem' }}>
            <Compass size={12} /> Espace Opérateur
          </span>
        );
      },
    },
    {
      header: 'Plafond Dérogation',
      render: (r) => (
        <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontWeight: 700, color: r.derogation_max > 0 ? '#34d399' : 'var(--text-muted)' }}>
            {r.derogation_max > 0 ? `Jusqu'à ${r.derogation_max}% remise` : '0% (Strict / Standard)'}
          </span>
          {r.auto_approve && (
            <span style={{ color: '#fbbf24', fontSize: '0.7rem' }}>• Pouvoir d'approbation</span>
          )}
        </div>
      ),
    },
    {
      header: 'Modules Couverts',
      render: (r) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', maxWidth: '280px' }}>
          {r.modules?.slice(0, 4).map((modId) => {
            const m = AVAILABLE_MODULES.find((item) => item.id === modId);
            return (
              <span
                key={modId}
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {m ? m.label.split('&')[0] : modId}
              </span>
            );
          })}
          {r.modules?.length > 4 && (
            <span
              style={{
                fontSize: '0.7rem',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(59, 130, 246, 0.1)',
                color: '#60a5fa',
              }}
            >
              +{r.modules.length - 4} autres
            </span>
          )}
        </div>
      ),
    },
    {
      header: 'Comptes Liés',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
          <Users size={14} color="var(--text-muted)" />
          <span style={{ fontWeight: 600, color: '#fff' }}>{r.user_count || 0}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>agent(s)</span>
        </div>
      ),
    },
    {
      header: 'Statut',
      render: (r) => (
        <button
          onClick={() => handleToggleActive(r)}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          title="Cliquer pour basculer le statut"
        >
          <StatusBadge status={r.is_active ? 'VALIDE' : 'REJETE'} />
        </button>
      ),
    },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            className="btn btn-secondary"
            onClick={() => handleOpenEditModal(r)}
            style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
            title="Modifier ce profil"
          >
            <Edit2 size={13} />
            <span>Modifier</span>
          </button>
          <button
            onClick={() => handleDelete(r)}
            style={{
              padding: '0.35rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              background: 'rgba(244, 63, 94, 0.1)',
              color: '#fb7185',
              cursor: 'pointer',
            }}
            title="Supprimer le profil"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div className="responsive-header">
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <ShieldCheck size={26} color="#8b5cf6" />
            Profils
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Les profils types (direction, production, caisse…), leurs droits et leurs plafonds de dérogation.
          </p>
        </div>

        <button className="btn btn-primary" onClick={handleOpenCreateModal} style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}>
          <Plus size={16} />
          <span>Nouveau Profil</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>TOTAL PROFILS DÉFINIS</span>
            <ShieldCheck size={18} color="#8b5cf6" />
          </div>
          <div className="metric-value">{profiles.length}</div>
          <span style={{ fontSize: '0.75rem', color: '#34d399' }}>Tous opérationnels</span>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>PROFILS OPÉRATEUR</span>
            <Compass size={18} color="#3b82f6" />
          </div>
          <div className="metric-value">{profiles.filter((p) => p.space === 'USER' || p.space === 'ALL').length}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Guichet, Caisse & Commercial</span>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>PROFILS ADMINISTRATION</span>
            <Settings size={18} color="#f59e0b" />
          </div>
          <div className="metric-value">{profiles.filter((p) => p.space === 'ADMIN' || p.space === 'ALL').length}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Direction, Audit & Contrôle</span>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>UTILISATEURS RATACHÉS</span>
            <Users size={18} color="#10b981" />
          </div>
          <div className="metric-value">{totalUsersLinked}</div>
          <span style={{ fontSize: '0.75rem', color: '#10b981' }}>Comptes d'accès actifs</span>
        </div>
      </div>

      {/* Main Table Panel */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        {/* Filter Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Filtrer par espace :</span>
          <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--bg-surface-elevated)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            {[
              { id: 'ALL', label: 'Tous les profils' },
              { id: 'USER', label: 'Espace Opérateur' },
              { id: 'ADMIN', label: 'Espace Administration' },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setFilterSpace(btn.id)}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.775rem',
                  fontWeight: filterSpace === btn.id ? 700 : 500,
                  borderRadius: '6px',
                  border: 'none',
                  background: filterSpace === btn.id ? 'var(--primary-600)' : 'transparent',
                  color: filterSpace === btn.id ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        <DataTable
          columns={columns}
          data={filteredProfiles}
          searchPlaceholder="Rechercher par nom, code profil ou description..."
        />
      </div>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingProfile ? `Modifier le Profil : ${editingProfile.name}` : 'Création d\'un Nouveau Profil d\'Habilitation'}
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="responsive-form-row">
            <div className="form-group">
              <label className="form-label">Code Profil (Identifiant unique)</label>
              <input
                type="text"
                className="form-control"
                required
                placeholder="Ex: SOUSCRIPTEUR_SENIOR"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                disabled={!!editingProfile}
              />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                Format majuscule sans espaces (ex: GEST_PROD_AGENCE).
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">Nom du Profil</label>
              <input
                type="text"
                className="form-control"
                required
                placeholder="Ex: Souscripteur Confirmé Flotte & Santé"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
          </div>

          <div className="responsive-form-row">
            <div className="form-group">
              <label className="form-label">Espace de Travail Associé</label>
              <select
                className="form-control"
                value={formData.space}
                onChange={(e) => setFormData({ ...formData, space: e.target.value })}
              >
                <option value="ALL">Accès Global (Opérateur + Administration)</option>
                <option value="ADMIN">Espace Administration (Direction, CIMA, Reversements)</option>
                <option value="USER">Espace Opérateur (Devis, Polices, ASACI, Caisse)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Plafond de Dérogation / Remise (%)</label>
              <select
                className="form-control"
                value={formData.derogation_max}
                onChange={(e) => setFormData({ ...formData, derogation_max: parseInt(e.target.value) || 0 })}
              >
                <option value={0}>0% - Aucune remise directe autorisée</option>
                <option value={5}>5% - Remise commerciale standard</option>
                <option value={10}>10% - Remise chef d'agence</option>
                <option value={15}>15% - Responsable souscription</option>
                <option value={25}>25% - Direction générale</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Description & Périmètre d'Activité</label>
            <textarea
              className="form-control"
              rows={2}
              placeholder="Décrivez les responsabilités et le périmètre métier de ce rôle..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          {/* Autonomie & Approbations */}
          <div
            style={{
              padding: '1rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer', color: '#fff' }}>
              <input
                type="checkbox"
                checked={formData.auto_approve}
                onChange={(e) => setFormData({ ...formData, auto_approve: e.target.checked })}
              />
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                Habiliter ce profil à approuver des dérogations et émettre des jetons
              </span>
            </label>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '1.6rem', marginTop: '0.25rem' }}>
              Permet au détenteur de traiter les requêtes de dérogations tarifaires envoyées par les opérateurs guichet.
            </p>
          </div>

          {/* Modules Métier Autorisés */}
          <div>
            <label className="form-label" style={{ marginBottom: '0.75rem' }}>
              Modules Métier Autorisés ({formData.modules.length}/{AVAILABLE_MODULES.length})
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                gap: '0.75rem',
                maxHeight: '260px',
                overflowY: 'auto',
                padding: '0.5rem',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(15, 23, 42, 0.5)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {AVAILABLE_MODULES.map((mod) => {
                const checked = formData.modules.includes(mod.id);
                return (
                  <div
                    key={mod.id}
                    onClick={() => handleToggleModule(mod.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.6rem',
                      padding: '0.65rem',
                      borderRadius: 'var(--radius-md)',
                      background: checked ? 'rgba(139, 92, 246, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                      border: `1px solid ${checked ? 'rgba(139, 92, 246, 0.4)' : 'var(--border-subtle)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {}} // handled by div onClick
                      style={{ marginTop: '3px' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: checked ? '#fff' : 'var(--text-secondary)' }}>
                        {mod.label}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {mod.desc}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Modal Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsModalOpen(false)}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}
            >
              <CheckCircle2 size={16} />
              {editingProfile ? 'Enregistrer les Modifications' : 'Créer le Profil'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default ProfileManagementPage;
