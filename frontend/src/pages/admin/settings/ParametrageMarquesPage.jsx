import React, { useState, useEffect } from 'react';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { DeleteConfirmModal } from '../../../components/common/DeleteConfirmModal';
import { Car, Plus, Edit2, Trash2, Globe, Shield, Search } from 'lucide-react';
import { settingsApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';

export const ParametrageMarquesPage = () => {
  const { success, error: toastError } = useToast();

  const [marques, setMarques] = useState([
    { id: 1, IdMarque: 1, LibelleMarque: 'TOYOTA', CodeMarque: 'TOY', PaysOrigine: 'Japon', CategorieDefaut: 'VP / 4x4', Statut: 'Actif' },
    { id: 2, IdMarque: 2, LibelleMarque: 'PEUGEOT', CodeMarque: 'PEU', PaysOrigine: 'France', CategorieDefaut: 'VP', Statut: 'Actif' },
    { id: 3, IdMarque: 3, LibelleMarque: 'RENAULT', CodeMarque: 'REN', PaysOrigine: 'France', CategorieDefaut: 'VP / Utilitaire', Statut: 'Actif' },
    { id: 4, IdMarque: 4, LibelleMarque: 'MERCEDES-BENZ', CodeMarque: 'MB', PaysOrigine: 'Allemagne', CategorieDefaut: 'VP Luxe / Poids Lourd', Statut: 'Actif' },
    { id: 5, IdMarque: 5, LibelleMarque: 'HYUNDAI', CodeMarque: 'HYU', PaysOrigine: 'Corée du Sud', CategorieDefaut: 'VP / SUV', Statut: 'Actif' },
    { id: 6, IdMarque: 6, LibelleMarque: 'NISSAN', CodeMarque: 'NIS', PaysOrigine: 'Japon', CategorieDefaut: 'VP / Pick-up', Statut: 'Actif' },
    { id: 7, IdMarque: 7, LibelleMarque: 'MITSUBISHI', CodeMarque: 'MIT', PaysOrigine: 'Japon', CategorieDefaut: 'Pick-up / 4x4', Statut: 'Actif' },
    { id: 8, IdMarque: 8, LibelleMarque: 'SUZUKI', CodeMarque: 'SUZ', PaysOrigine: 'Japon', CategorieDefaut: 'Citadine / Moto', Statut: 'Actif' },
    { id: 9, IdMarque: 9, LibelleMarque: 'BMW', CodeMarque: 'BMW', PaysOrigine: 'Allemagne', CategorieDefaut: 'VP Premium', Statut: 'Actif' },
    { id: 10, IdMarque: 10, LibelleMarque: 'VOLKSWAGEN', CodeMarque: 'VW', PaysOrigine: 'Allemagne', CategorieDefaut: 'VP / Utilitaire', Statut: 'Actif' },
    { id: 11, IdMarque: 11, LibelleMarque: 'FORD', CodeMarque: 'FOR', PaysOrigine: 'USA', CategorieDefaut: 'Pick-up / SUV', Statut: 'Actif' },
    { id: 12, IdMarque: 12, LibelleMarque: 'ISUZU', CodeMarque: 'ISU', PaysOrigine: 'Japon', CategorieDefaut: 'Camions / Utilitaires', Statut: 'Actif' },
  ]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMarque, setEditingMarque] = useState(null);
  const [deletingItem, setDeletingItem] = useState(null);

  const [marqueForm, setMarqueForm] = useState({
    libelle: '',
    code: '',
    pays: 'Japon',
    categorie: 'VP',
  });

  useEffect(() => {
    settingsApi.getMarques?.().then((res) => {
      if (Array.isArray(res) && res.length > 0) {
        const mapped = res.map((m) => ({
          id: m.IdMarque || m.id,
          IdMarque: m.IdMarque || m.id,
          LibelleMarque: m.LibelleMarque || m.libelle,
          CodeMarque: m.CodeMarque || m.code || `MQ_${m.IdMarque}`,
          PaysOrigine: m.PaysOrigine || 'International',
          CategorieDefaut: 'VP / Flotte',
          Statut: 'Actif',
        }));
        setMarques(mapped);
      }
    }).catch(() => {});
  }, []);

  const handleSaveMarque = async (e) => {
    e.preventDefault();
    if (!marqueForm.libelle) return;
    const newMarque = {
      id: editingMarque ? editingMarque.id : Date.now(),
      IdMarque: editingMarque ? editingMarque.IdMarque : Date.now(),
      LibelleMarque: marqueForm.libelle.toUpperCase(),
      CodeMarque: marqueForm.code ? marqueForm.code.toUpperCase() : marqueForm.libelle.slice(0, 3).toUpperCase(),
      PaysOrigine: marqueForm.pays,
      CategorieDefaut: marqueForm.categorie,
      Statut: 'Actif',
    };

    if (editingMarque) {
      setMarques(prev => prev.map(m => m.id === editingMarque.id ? newMarque : m));
      success(`Marque ${newMarque.LibelleMarque} mise à jour.`);
    } else {
      setMarques(prev => [newMarque, ...prev]);
      success(`Marque ${newMarque.LibelleMarque} ajoutée avec succès.`);
    }

    try {
      await settingsApi.createMarque?.({
        LibelleMarque: newMarque.LibelleMarque,
        CodeMarque: newMarque.CodeMarque,
      });
    } catch {}

    setIsModalOpen(false);
  };

  const columns = [
    {
      header: 'Marque',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ padding: '0.4rem', borderRadius: '6px', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}>
            <Car size={16} />
          </div>
          <div>
            <strong style={{ color: 'var(--text-primary)', display: 'block' }}>{r.LibelleMarque}</strong>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Code: {r.CodeMarque}</span>
          </div>
        </div>
      )
    },
    {
      header: 'Pays d\'Origine',
      accessor: 'PaysOrigine',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)' }}>
          <Globe size={13} />
          {r.PaysOrigine}
        </span>
      )
    },
    {
      header: 'Affectation Standard',
      accessor: 'CategorieDefaut',
      render: (r) => <span className="badge badge-blue">{r.CategorieDefaut}</span>
    },
    {
      header: 'Statut Référentiel',
      accessor: 'Statut',
      render: (r) => <span className="badge badge-emerald">En Vigueur CIMA</span>
    },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            onClick={() => {
              setEditingMarque(r);
              setMarqueForm({
                libelle: r.LibelleMarque,
                code: r.CodeMarque,
                pays: r.PaysOrigine,
                categorie: r.CategorieDefaut,
              });
              setIsModalOpen(true);
            }}
          >
            Modifier
          </button>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.45rem', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            onClick={() => setDeletingItem(r)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Car size={28} color="#38bdf8" />
            Marques de véhicules
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Liste des marques proposées lors de la saisie du véhicule.
          </p>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => {
            setEditingMarque(null);
            setMarqueForm({
              libelle: '',
              code: '',
              pays: 'Japon',
              categorie: 'VP',
            });
            setIsModalOpen(true);
          }}
        >
          <Plus size={16} /> Ajouter une Marque
        </button>
      </div>

      {/* Main Table */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <DataTable columns={columns} data={marques} searchPlaceholder="Rechercher une marque de véhicule..." />
      </div>

      {/* Modal Marque */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingMarque ? 'Modifier la Marque de Véhicule' : 'Nouvelle Marque Automobile'}
      >
        <form onSubmit={handleSaveMarque} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Marque (* requis)</label>
            <input
              type="text"
              className="form-control"
              value={marqueForm.libelle}
              onChange={(e) => setMarqueForm({ ...marqueForm, libelle: e.target.value })}
              required
              placeholder="Ex: AUDI, TOYOTA, HYUNDAI..."
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Code Synthétique</label>
              <input
                type="text"
                className="form-control"
                value={marqueForm.code}
                onChange={(e) => setMarqueForm({ ...marqueForm, code: e.target.value.toUpperCase() })}
                placeholder="Ex: AUD"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Pays d'Origine</label>
              <input
                type="text"
                className="form-control"
                value={marqueForm.pays}
                onChange={(e) => setMarqueForm({ ...marqueForm, pays: e.target.value })}
                placeholder="Ex: Allemagne, Japon, France..."
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Catégorie Type</label>
            <select
              className="form-control"
              value={marqueForm.categorie}
              onChange={(e) => setMarqueForm({ ...marqueForm, categorie: e.target.value })}
            >
              <option value="Deux-Roues">Deux-Roues & Motocyclettes</option>
              <option value="Pick-up / Utilitaire">Pick-up / Véhicules Utilitaires Légers</option>
              <option value="Poids Lourd / Camion">Poids Lourds & Transports de Marchandises</option>
              <option value="VP">Véhicules Particuliers (VP)</option>
              <option value="VP / 4x4">VP / SUV / 4x4</option>
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary">Enregistrer la Marque</button>
          </div>
        </form>
      </Modal>

      {/* Delete Modal */}
      <DeleteConfirmModal
        isOpen={!!deletingItem}
        onClose={() => setDeletingItem(null)}
        itemType="marque"
        itemName={deletingItem?.LibelleMarque}
        itemCode={deletingItem?.CodeMarque}
        validation={{ allowed: true }}
        onConfirm={() => {
          if (deletingItem) {
            setMarques(prev => prev.filter(m => m.id !== deletingItem.id));
            success(`Marque ${deletingItem.LibelleMarque} supprimée.`);
            setDeletingItem(null);
          }
        }}
      />
    </div>
  );
};

export default ParametrageMarquesPage;
