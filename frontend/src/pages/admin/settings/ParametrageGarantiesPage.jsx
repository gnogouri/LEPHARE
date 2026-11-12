import React, { useState, useEffect, useMemo } from 'react';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { DeleteConfirmModal } from '../../../components/common/DeleteConfirmModal';
import { Shield, Plus, Trash2, Layers } from 'lucide-react';
import { settingsApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { sortUniqueBy } from '../../../utils/sortUtils';

// Les 4 indicateurs de saisie réels de stdgarantie / stdsousgarantie : ils déterminent
// dans quel(s) produit(s) (Auto, Risques Divers = MRH/Incendie/RC/Dommages corporels,
// Santé, Transport) la garantie peut être proposée. C'est la vraie relation
// produit ↔ garantie en base, pas une "branche" texte libre.
const SAISIE_FLAGS = [
  ['SaisieAuto', 'Automobile'],
  ['SaisieRd', 'Risques Divers (MRH/Incendie/RC)'],
  ['SaisieSante', 'Santé'],
  ['SaisieTransport', 'Transport'],
];

const EMPTY_GARANTIE_FORM = {
  CodeGarantie: '',
  LibelleGarantie: '',
  Active: true,
  Ordre: 1,
  ModeCalcInd: '',
  SinDelai: '',
  SinBloquant: false,
  SaisieAuto: false,
  SaisieRd: false,
  SaisieSante: false,
  SaisieTransport: false,
};

const EMPTY_SOUS_GARANTIE_FORM = {
  IdGarantie: '',
  CodeSousGarantie: '',
  LibelleSousGarantie: '',
  Active: true,
  Ordre: 1,
  SaisieAuto: false,
  SaisieRd: false,
  SaisieSante: false,
  SaisieTransport: false,
};

export const ParametrageGarantiesPage = () => {
  const { success, error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState('garanties'); // 'garanties' | 'sousgaranties'

  const [garanties, setGaranties] = useState([]);
  const [sousGaranties, setSousGaranties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFlag, setSelectedFlag] = useState('ALL');

  const [isGarantieModalOpen, setIsGarantieModalOpen] = useState(false);
  const [isSousGarantieModalOpen, setIsSousGarantieModalOpen] = useState(false);
  const [editingGarantie, setEditingGarantie] = useState(null);
  const [editingSousGarantie, setEditingSousGarantie] = useState(null);
  const [deletingGarantie, setDeletingGarantie] = useState(null);
  const [deletingSousGarantie, setDeletingSousGarantie] = useState(null);

  const [garantieForm, setGarantieForm] = useState(EMPTY_GARANTIE_FORM);
  const [sousGarantieForm, setSousGarantieForm] = useState(EMPTY_SOUS_GARANTIE_FORM);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      settingsApi.getGuarantees().catch(() => []),
      settingsApi.getSousGaranties().catch(() => []),
    ])
      .then(([garRes, sgRes]) => {
        setGaranties(Array.isArray(garRes) ? garRes : []);
        setSousGaranties(Array.isArray(sgRes) ? sgRes : []);
      })
      .catch(() => toastError('Erreur de chargement des référentiels de garanties.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredGaranties = useMemo(() => {
    if (selectedFlag === 'ALL') return garanties;
    return garanties.filter((g) => Boolean(g[selectedFlag]));
  }, [garanties, selectedFlag]);

  const filteredSousGaranties = useMemo(() => {
    if (selectedFlag === 'ALL') return sousGaranties;
    return sousGaranties.filter((g) => Boolean(g[selectedFlag]));
  }, [sousGaranties, selectedFlag]);

  const garantieLibelle = (id) => garanties.find((g) => g.IdGarantie === Number(id))?.LibelleGarantie || `Garantie #${id}`;

  const handleSaveGarantie = (e) => {
    e.preventDefault();
    if (!garantieForm.CodeGarantie || garantieForm.CodeGarantie.length !== 3) {
      toastError('Le code garantie doit faire exactement 3 caractères (contrainte stdgarantie).');
      return;
    }
    if (!garantieForm.LibelleGarantie.trim()) {
      toastError('Le libellé est requis.');
      return;
    }
    const payload = {
      ...garantieForm,
      Ordre: Number(garantieForm.Ordre) || 0,
      SinDelai: garantieForm.SinDelai === '' ? null : Number(garantieForm.SinDelai),
      ModeCalcInd: garantieForm.ModeCalcInd || null,
    };
    const request = editingGarantie
      ? settingsApi.updateGuarantee(editingGarantie.IdGarantie, payload)
      : settingsApi.createGuarantee(payload);

    request
      .then(() => {
        success(editingGarantie ? `Garantie "${payload.LibelleGarantie}" mise à jour.` : `Garantie "${payload.LibelleGarantie}" créée.`);
        setIsGarantieModalOpen(false);
        loadData();
      })
      .catch(() => toastError("Échec de l'enregistrement (code déjà utilisé ou droits insuffisants)."));
  };

  const handleSaveSousGarantie = (e) => {
    e.preventDefault();
    if (!sousGarantieForm.CodeSousGarantie || sousGarantieForm.CodeSousGarantie.length !== 5) {
      toastError('Le code sous-garantie doit faire exactement 5 caractères (contrainte stdsousgarantie).');
      return;
    }
    if (!sousGarantieForm.LibelleSousGarantie.trim()) {
      toastError('Le libellé est requis.');
      return;
    }
    const payload = {
      ...sousGarantieForm,
      IdGarantie: sousGarantieForm.IdGarantie ? Number(sousGarantieForm.IdGarantie) : null,
      Ordre: Number(sousGarantieForm.Ordre) || 0,
    };
    const request = editingSousGarantie
      ? settingsApi.updateSousGarantie(editingSousGarantie.IdSousGarantie, payload)
      : settingsApi.createSousGarantie(payload);

    request
      .then(() => {
        success(editingSousGarantie ? `Sous-garantie "${payload.LibelleSousGarantie}" mise à jour.` : `Sous-garantie "${payload.LibelleSousGarantie}" créée.`);
        setIsSousGarantieModalOpen(false);
        loadData();
      })
      .catch(() => toastError("Échec de l'enregistrement (code déjà utilisé ou droits insuffisants)."));
  };

  const flagBadges = (r) => (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
      {SAISIE_FLAGS.filter(([key]) => r[key]).map(([key, label]) => (
        <StatusBadge key={key} label={label} color="sky" />
      ))}
      {SAISIE_FLAGS.every(([key]) => !r[key]) && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>-</span>}
    </div>
  );

  const garantieColumns = useMemo(() => [
    {
      header: 'Code & Libellé',
      render: (r) => (
        <div>
          <strong style={{ color: 'var(--text-primary)', display: 'block' }}>{r.LibelleGarantie}</strong>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#60a5fa' }}>{r.CodeGarantie}</span>
        </div>
      )
    },
    { header: 'Produits (saisie)', render: flagBadges },
    {
      header: 'Ordre',
      render: (r) => <span style={{ fontFamily: 'var(--font-mono)' }}>{r.Ordre}</span>
    },
    {
      header: 'Sinistre bloquant',
      render: (r) => <span style={{ fontSize: '0.8rem' }}>{r.SinBloquant ? `Oui (délai ${r.SinDelai ?? '-'}j)` : 'Non'}</span>
    },
    {
      header: 'Statut',
      render: (r) => <StatusBadge label={r.Active ? 'Active' : 'Inactive'} color={r.Active ? 'emerald' : 'slate'} />
    },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            onClick={() => {
              setEditingGarantie(r);
              setGarantieForm({
                CodeGarantie: r.CodeGarantie || '',
                LibelleGarantie: r.LibelleGarantie || '',
                Active: Boolean(r.Active),
                Ordre: r.Ordre ?? 1,
                ModeCalcInd: r.ModeCalcInd || '',
                SinDelai: r.SinDelai ?? '',
                SinBloquant: Boolean(r.SinBloquant),
                SaisieAuto: Boolean(r.SaisieAuto),
                SaisieRd: Boolean(r.SaisieRd),
                SaisieSante: Boolean(r.SaisieSante),
                SaisieTransport: Boolean(r.SaisieTransport),
              });
              setIsGarantieModalOpen(true);
            }}
          >
            Modifier
          </button>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.45rem', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            onClick={() => setDeletingGarantie(r)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )
    }
  ], []);

  const sousGarantieColumns = useMemo(() => [
    {
      header: 'Sous-Garantie',
      render: (r) => (
        <div>
          <strong style={{ color: 'var(--text-primary)', display: 'block' }}>{r.LibelleSousGarantie}</strong>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#38bdf8' }}>{r.CodeSousGarantie}</span>
        </div>
      )
    },
    {
      header: 'Garantie Parente',
      render: (r) => <span style={{ fontSize: '0.8rem', color: '#60a5fa', fontWeight: 600 }}>{r.IdGarantie ? garantieLibelle(r.IdGarantie) : '-'}</span>
    },
    { header: 'Produits (saisie)', render: flagBadges },
    {
      header: 'Ordre',
      render: (r) => <span style={{ fontFamily: 'var(--font-mono)' }}>{r.Ordre}</span>
    },
    {
      header: 'Statut',
      render: (r) => <StatusBadge label={r.Active ? 'Active' : 'Inactive'} color={r.Active ? 'emerald' : 'slate'} />
    },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            onClick={() => {
              setEditingSousGarantie(r);
              setSousGarantieForm({
                IdGarantie: r.IdGarantie || '',
                CodeSousGarantie: r.CodeSousGarantie || '',
                LibelleSousGarantie: r.LibelleSousGarantie || '',
                Active: Boolean(r.Active),
                Ordre: r.Ordre ?? 1,
                SaisieAuto: Boolean(r.SaisieAuto),
                SaisieRd: Boolean(r.SaisieRd),
                SaisieSante: Boolean(r.SaisieSante),
                SaisieTransport: Boolean(r.SaisieTransport),
              });
              setIsSousGarantieModalOpen(true);
            }}
          >
            Modifier
          </button>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.45rem', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            onClick={() => setDeletingSousGarantie(r)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )
    }
  ], [garanties]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1280px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Shield size={28} color="#3b82f6" />
            Garanties & sous-garanties
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            La liste de toutes les garanties utilisables dans les offres ; pour en rattacher une à une offre, voir « Offres ».
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {activeTab === 'garanties' ? (
            <button
              className="btn btn-primary"
              onClick={() => {
                setEditingGarantie(null);
                setGarantieForm(EMPTY_GARANTIE_FORM);
                setIsGarantieModalOpen(true);
              }}
            >
              <Plus size={16} /> Nouvelle Garantie
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => {
                setEditingSousGarantie(null);
                setSousGarantieForm({ ...EMPTY_SOUS_GARANTIE_FORM, IdGarantie: garanties[0]?.IdGarantie || '' });
                setIsSousGarantieModalOpen(true);
              }}
            >
              <Plus size={16} /> Nouvelle Sous-Garantie
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
        <button
          type="button"
          onClick={() => setActiveTab('garanties')}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1.2rem',
            borderRadius: 'var(--radius-md)', border: 'none', fontSize: '0.875rem',
            fontWeight: activeTab === 'garanties' ? 700 : 500, cursor: 'pointer',
            background: activeTab === 'garanties' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
            color: activeTab === 'garanties' ? '#60a5fa' : 'var(--text-muted)',
            borderBottom: activeTab === 'garanties' ? '2px solid #3b82f6' : '2px solid transparent',
          }}
        >
          <Shield size={16} />
          <span>Garanties Principales ({garanties.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sousgaranties')}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1.2rem',
            borderRadius: 'var(--radius-md)', border: 'none', fontSize: '0.875rem',
            fontWeight: activeTab === 'sousgaranties' ? 700 : 500, cursor: 'pointer',
            background: activeTab === 'sousgaranties' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
            color: activeTab === 'sousgaranties' ? '#60a5fa' : 'var(--text-muted)',
            borderBottom: activeTab === 'sousgaranties' ? '2px solid #3b82f6' : '2px solid transparent',
          }}
        >
          <Layers size={16} />
          <span>Sous-Garanties ({sousGaranties.length})</span>
        </button>
      </div>

      {/* Filtre par produit (indicateur de saisie réel) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Filtrer par produit :</span>
        {[['ALL', 'Tous'], ...SAISIE_FLAGS].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSelectedFlag(key)}
            style={{
              padding: '0.3rem 0.75rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
              border: selectedFlag === key ? '1px solid #3b82f6' : '1px solid var(--border-subtle)',
              background: selectedFlag === key ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
              color: selectedFlag === key ? '#60a5fa' : 'var(--text-muted)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        {activeTab === 'garanties' ? (
          <DataTable columns={garantieColumns} data={filteredGaranties} loading={loading} searchPlaceholder="Rechercher une garantie..." />
        ) : (
          <DataTable columns={sousGarantieColumns} data={filteredSousGaranties} loading={loading} searchPlaceholder="Rechercher une sous-garantie..." />
        )}
      </div>

      {/* Modal Garantie */}
      <Modal
        isOpen={isGarantieModalOpen}
        onClose={() => setIsGarantieModalOpen(false)}
        title={editingGarantie ? 'Modifier la Garantie' : 'Nouvelle Garantie'}
      >
        <form onSubmit={handleSaveGarantie} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Libellé de la Garantie (* requis)</label>
            <input
              type="text"
              className="form-control"
              value={garantieForm.LibelleGarantie}
              onChange={(e) => setGarantieForm({ ...garantieForm, LibelleGarantie: e.target.value })}
              required
              placeholder="Ex: RESPONSABILITE CIVILE"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Code (exactement 3 caractères, * requis)</label>
              <input
                type="text"
                className="form-control"
                maxLength={3}
                value={garantieForm.CodeGarantie}
                onChange={(e) => setGarantieForm({ ...garantieForm, CodeGarantie: e.target.value.toUpperCase() })}
                required
                placeholder="Ex: 001"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Ordre d'affichage</label>
              <input
                type="number"
                className="form-control"
                value={garantieForm.Ordre}
                onChange={(e) => setGarantieForm({ ...garantieForm, Ordre: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Mode de calcul indemnité</label>
              <input
                type="text"
                className="form-control"
                maxLength={1}
                value={garantieForm.ModeCalcInd}
                onChange={(e) => setGarantieForm({ ...garantieForm, ModeCalcInd: e.target.value.toUpperCase() })}
                placeholder="Code 1 caractère (optionnel)"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Délai sinistre (jours)</label>
              <input
                type="number"
                className="form-control"
                value={garantieForm.SinDelai}
                onChange={(e) => setGarantieForm({ ...garantieForm, SinDelai: e.target.value })}
                placeholder="Optionnel"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem 1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
              <input type="checkbox" checked={garantieForm.Active} onChange={(e) => setGarantieForm({ ...garantieForm, Active: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: '#3b82f6' }} />
              Active
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
              <input type="checkbox" checked={garantieForm.SinBloquant} onChange={(e) => setGarantieForm({ ...garantieForm, SinBloquant: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: '#3b82f6' }} />
              Sinistre bloquant
            </label>
          </div>

          <div className="form-group">
            <label className="form-label">Produits où cette garantie peut être saisie</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem 1rem' }}>
              {SAISIE_FLAGS.map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={garantieForm[key]}
                    onChange={(e) => setGarantieForm({ ...garantieForm, [key]: e.target.checked })}
                    style={{ width: '16px', height: '16px', accentColor: '#3b82f6' }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsGarantieModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>

      {/* Modal Sous-Garantie */}
      <Modal
        isOpen={isSousGarantieModalOpen}
        onClose={() => setIsSousGarantieModalOpen(false)}
        title={editingSousGarantie ? 'Modifier la Sous-Garantie' : 'Nouvelle Sous-Garantie'}
      >
        <form onSubmit={handleSaveSousGarantie} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Garantie Parente</label>
            <select
              className="form-control"
              value={sousGarantieForm.IdGarantie}
              onChange={(e) => setSousGarantieForm({ ...sousGarantieForm, IdGarantie: e.target.value })}
            >
              <option value="">-- Aucune --</option>
              {sortUniqueBy(garanties, (g) => g.LibelleGarantie).map((g) => (
                <option key={g.IdGarantie} value={g.IdGarantie}>{g.LibelleGarantie}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Libellé de la Sous-Garantie (* requis)</label>
            <input
              type="text"
              className="form-control"
              value={sousGarantieForm.LibelleSousGarantie}
              onChange={(e) => setSousGarantieForm({ ...sousGarantieForm, LibelleSousGarantie: e.target.value })}
              required
              placeholder="Ex: VOL À MAINS ARMÉES"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Code (exactement 5 caractères, * requis)</label>
              <input
                type="text"
                className="form-control"
                maxLength={5}
                value={sousGarantieForm.CodeSousGarantie}
                onChange={(e) => setSousGarantieForm({ ...sousGarantieForm, CodeSousGarantie: e.target.value.toUpperCase() })}
                required
                placeholder="Ex: 00123"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Ordre d'affichage</label>
              <input
                type="number"
                className="form-control"
                value={sousGarantieForm.Ordre}
                onChange={(e) => setSousGarantieForm({ ...sousGarantieForm, Ordre: e.target.value })}
              />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
            <input type="checkbox" checked={sousGarantieForm.Active} onChange={(e) => setSousGarantieForm({ ...sousGarantieForm, Active: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: '#3b82f6' }} />
            Active
          </label>

          <div className="form-group">
            <label className="form-label">Produits où cette sous-garantie peut être saisie</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem 1rem' }}>
              {SAISIE_FLAGS.map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={sousGarantieForm[key]}
                    onChange={(e) => setSousGarantieForm({ ...sousGarantieForm, [key]: e.target.checked })}
                    style={{ width: '16px', height: '16px', accentColor: '#3b82f6' }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsSousGarantieModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm Garantie */}
      <DeleteConfirmModal
        isOpen={!!deletingGarantie}
        onClose={() => setDeletingGarantie(null)}
        itemType="garantie"
        itemName={deletingGarantie?.LibelleGarantie}
        itemCode={deletingGarantie?.CodeGarantie}
        validation={{ allowed: true }}
        onConfirm={() => {
          if (!deletingGarantie) return;
          settingsApi.deleteGuarantee(deletingGarantie.IdGarantie)
            .then(() => {
              success(`Garantie "${deletingGarantie.LibelleGarantie}" supprimée.`);
              setDeletingGarantie(null);
              loadData();
            })
            .catch(() => {
              toastError('Suppression impossible (des sous-garanties ou des devis y sont peut-être encore liés).');
              setDeletingGarantie(null);
            });
        }}
      />

      {/* Delete confirm Sous-Garantie */}
      <DeleteConfirmModal
        isOpen={!!deletingSousGarantie}
        onClose={() => setDeletingSousGarantie(null)}
        itemType="sous-garantie"
        itemName={deletingSousGarantie?.LibelleSousGarantie}
        itemCode={deletingSousGarantie?.CodeSousGarantie}
        validation={{ allowed: true }}
        onConfirm={() => {
          if (!deletingSousGarantie) return;
          settingsApi.deleteSousGarantie(deletingSousGarantie.IdSousGarantie)
            .then(() => {
              success(`Sous-garantie "${deletingSousGarantie.LibelleSousGarantie}" supprimée.`);
              setDeletingSousGarantie(null);
              loadData();
            })
            .catch(() => {
              toastError('Suppression impossible (des offres ou des devis y sont peut-être encore liés).');
              setDeletingSousGarantie(null);
            });
        }}
      />
    </div>
  );
};

export default ParametrageGarantiesPage;
