import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { DeleteConfirmModal } from '../../../components/common/DeleteConfirmModal';
import { FolderTree, Plus, Shield, ShieldCheck, Check, Layers, AlertCircle, Trash2 } from 'lucide-react';
import { settingsApi } from '../../../api/endpoints';
import { dataStore } from '../../../api/dataStore';
import { validateBusinessRule } from '../../../utils/rbac';
import { useToast } from '../../../context/ToastContext';

export const CatalogProductsPage = ({ initialTab = 'guarantees' }) => {
  const { success } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(urlTab || initialTab);

  useEffect(() => {
    if (urlTab && (urlTab === 'guarantees' || urlTab === 'products')) {
      setActiveTab(urlTab);
    } else if (!urlTab && initialTab) {
      setActiveTab(initialTab);
    }
  }, [urlTab, initialTab]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isEditProductModalOpen, setIsEditProductModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isEditGuaranteeModalOpen, setIsEditGuaranteeModalOpen] = useState(false);
  const [selectedGuarantee, setSelectedGuarantee] = useState(null);
  const [deletingItem, setDeletingItem] = useState(null);
  const [deleteType, setDeleteType] = useState('produit');
  const [deleteValidation, setDeleteValidation] = useState({ allowed: true });
  const [isGuaranteeDetailModalOpen, setIsGuaranteeDetailModalOpen] = useState(false);

  const [products, setProducts] = useState(() => dataStore.getProducts());
  const [guarantees, setGuarantees] = useState(() => dataStore.getGuarantees());

  useEffect(() => {
    // Charger les 10 produits réels de Django configuration_api/produit/
    settingsApi.getProducts().then((res) => {
      if (Array.isArray(res) && res.length > 0) {
        const mapped = res.map((p) => ({
          id: p.id_produit || p.id,
          code_produit: `PRD-${p.id_produit || p.id}`,
          nom: p.libelle_produit || p.nom,
          branche: (p.libelle_produit || '').toLowerCase().includes('auto')
            ? 'Automobile'
            : (p.libelle_produit || '').toLowerCase().includes('hab')
            ? 'Incendie & Risques Divers'
            : (p.libelle_produit || '').toLowerCase().includes('sant')
            ? 'Santé & Maladie'
            : 'Toutes Branches',
          type_gestion: 'Individuel & Collectif',
          nb_garanties: 8,
          statut: 'Actif',
          statut_badge: 'emerald',
          raw: p,
        }));
        setProducts(mapped);
      }
    }).catch(() => {});

    // Charger les 17 garanties réelles de Django configuration_api/garantie/
    settingsApi.getGuarantees().then((res) => {
      if (Array.isArray(res) && res.length > 0) {
        const mapped = res.map((g) => ({
          id: g.IdGarantie || g.id,
          code: g.CodeGarantie || g.code || `GAR-${g.IdGarantie}`,
          libelle: g.LibelleGarantie || g.libelle,
          branche: g.SaisieAuto ? 'Automobile' : g.SaisieRd ? 'Incendie & Risques Divers' : g.SaisieSante ? 'Santé Groupe' : g.SaisieTransport ? 'Transport' : 'Général',
          type: g.Active ? 'Obligatoire CIMA' : 'Optionnelle',
          tarification: 'Barème Réglementaire',
          taxe_cima: '14.5%',
          fga: Boolean(g.SaisieAuto),
          active: Boolean(g.Active),
          raw: g,
        }));
        setGuarantees(mapped);
      }
    }).catch(() => {});

    const unsub = dataStore.subscribe(() => {
      setProducts(dataStore.getProducts());
      setGuarantees(dataStore.getGuarantees());
    });
    return unsub;
  }, []);

  const [newGuaranteeForm, setNewGuaranteeForm] = useState({
    code: '',
    libelle: '',
    branche: 'Automobile',
    type: 'Optionnelle',
    tarification: 'Forfait Annuel',
    taxe_cima: '14.5%',
    fga: false,
  });

  const [newProductForm, setNewProductForm] = useState({
    branche: 'Automobile',
    code_produit: '',
    nom: '',
    type_gestion: 'Individuel',
    nb_garanties: 8,
    statut: 'Actif',
  });

  const handleCreateGuarantee = (e) => {
    e.preventDefault();
    const item = dataStore.saveGuarantee({
      ...newGuaranteeForm,
      code: newGuaranteeForm.code.toUpperCase(),
    });
    setGuarantees(dataStore.getGuarantees());
    setIsModalOpen(false);
    success(`Nouvelle garantie "${item.libelle}" ajoutée au catalogue.`);
  };

  const handleCreateProduct = (e) => {
    e.preventDefault();
    const item = dataStore.saveProduct({
      ...newProductForm,
      code_produit: newProductForm.code_produit.toUpperCase(),
      nb_garanties: Number(newProductForm.nb_garanties) || 6,
    });
    setProducts(dataStore.getProducts());
    setIsProductModalOpen(false);
    success(`Nouveau produit commercial "${item.nom}" créé avec succès.`);
  };

  const handleSaveEditProduct = (e) => {
    e.preventDefault();
    if (!selectedProduct) return;
    dataStore.updateProduct(selectedProduct.id, selectedProduct);
    setProducts(dataStore.getProducts());
    setIsEditProductModalOpen(false);
    success(`Produit ${selectedProduct.code_produit} mis à jour.`);
  };

  const handleSaveEditGuarantee = (e) => {
    e.preventDefault();
    if (!selectedGuarantee) return;
    dataStore.updateGuarantee(selectedGuarantee.id, selectedGuarantee);
    setGuarantees(dataStore.getGuarantees());
    setIsEditGuaranteeModalOpen(false);
    success(`Garantie ${selectedGuarantee.code} mise à jour.`);
  };

  const productColumns = [
    { header: 'Branche', accessor: 'branche', render: (r) => <strong style={{ color: '#60a5fa' }}>{r.branche}</strong> },
    { header: 'Code Produit', accessor: 'code_produit', render: (r) => <span style={{ fontFamily: 'var(--font-mono)' }}>{r.code_produit}</span> },
    { header: 'Désignation Commerciale', accessor: 'nom', render: (r) => <span style={{ fontWeight: 600, color: '#fff' }}>{r.nom}</span> },
    { header: 'Type de Gestion', accessor: 'type_gestion' },
    { header: 'Garanties Incluses', accessor: 'nb_garanties', render: (r) => <span style={{ color: '#34d399' }}>{r.nb_garanties} garanties</span> },
    { header: 'Statut', accessor: 'statut', render: (r) => <StatusBadge label={r.statut} color="emerald" /> },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
            onClick={() => {
              handleTabChange('guarantees');
              success(`Garanties de la branche ${r.branche} affichées.`);
            }}
          >
            Garanties
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
            onClick={() => {
              setSelectedProduct({ ...r });
              setIsEditProductModalOpen(true);
            }}
          >
            Modifier
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.45rem', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.25)' }}
            onClick={() => {
              const check = validateBusinessRule('delete', 'catalog', r, dataStore);
              setDeleteValidation(check);
              setDeleteType('produit');
              setDeletingItem(r);
            }}
            title="Supprimer le produit"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];

  const guaranteeColumns = [
    {
      header: 'Code & Libellé de la Garantie',
      render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>{r.libelle}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.725rem', color: '#60a5fa' }}>{r.code}</span>
        </div>
      ),
    },
    {
      header: 'Branche Métier',
      accessor: 'branche',
      render: (r) => <span className="badge badge-purple">{r.branche}</span>,
    },
    {
      header: 'Nature',
      render: (r) => (
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: r.type.includes('Obligatoire') ? '#f43f5e' : 'var(--text-secondary)' }}>
          {r.type}
        </span>
      ),
    },
    {
      header: 'Mode de Tarification',
      accessor: 'tarification',
      render: (r) => <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.tarification}</span>,
    },
    {
      header: 'Taxe CIMA',
      accessor: 'taxe_cima',
      render: (r) => <span style={{ fontWeight: 600, color: '#fbbf24' }}>{r.taxe_cima}</span>,
    },
    {
      header: 'Assujetti FGA',
      render: (r) => (
        <span style={{ color: r.fga ? '#34d399' : 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>
          {r.fga ? 'Oui (FGA)' : 'Non'}
        </span>
      ),
    },
    {
      header: 'Statut',
      render: (r) => <StatusBadge label={r.active ? 'Actif' : 'Inactif'} color={r.active ? 'emerald' : 'rose'} />,
    },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
            onClick={() => {
              setSelectedGuarantee(r);
              setIsGuaranteeDetailModalOpen(true);
            }}
          >
            Fiche
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
            onClick={() => {
              setSelectedGuarantee({ ...r });
              setIsEditGuaranteeModalOpen(true);
            }}
          >
            Modifier
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.45rem', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.25)' }}
            onClick={() => {
              const check = validateBusinessRule('delete', 'catalog', r, dataStore);
              setDeleteValidation(check);
              setDeleteType('garantie');
              setDeletingItem(r);
            }}
            title="Supprimer la garantie"
          >
            <Trash2 size={13} />
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
            {activeTab === 'guarantees' ? (
              <>
                <Shield size={26} color="#3b82f6" />
                Garanties de référence des produits
              </>
            ) : (
              <>
                <FolderTree size={26} color="#3b82f6" />
                Produits (branches)
              </>
            )}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {activeTab === 'guarantees'
              ? "Les garanties de chaque produit, avec leur mode de tarification, leurs franchises et leurs taux de taxe."
              : "Automobile, Santé, IA, MRH… ; l'onglet « Garanties » donne leurs garanties de référence."}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {activeTab === 'guarantees' ? (
            <button className="btn btn-primary" onClick={() => setIsModalOpen(true)} style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}>
              <Plus size={16} /> Nouvelle Garantie
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => setIsProductModalOpen(true)} style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}>
              <Plus size={16} /> Nouveau Produit
            </button>
          )}
        </div>
      </div>

      {/* Info Callout Banner */}
      <div
        className="glass-panel"
        style={{
          padding: '1.25rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.3) 0%, rgba(15, 23, 42, 0.8) 100%)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
          <ShieldCheck size={24} color="#60a5fa" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>
              Où sont renseignées les garanties dans LE PHARE ?
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              • <strong>Dans cette section (Catalogue Admin)</strong> : vous paramétrez les règles de calcul, libellés et taxes de chaque garantie.<br />
              • <strong>Lors de la saisie d'un Devis (Opérateur)</strong> : l'opérateur coche et valorise les garanties retenues (ex: Étape 2 du Devis Auto, MRH, Santé).<br />
              • <strong>Dans la Police émise</strong> : consultable directement sur la Fiche Police 360° avec capitaux et franchises.
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => handleTabChange('guarantees')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.6rem 1.2rem',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            fontSize: '0.875rem',
            fontWeight: activeTab === 'guarantees' ? 700 : 500,
            cursor: 'pointer',
            background: activeTab === 'guarantees' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
            color: activeTab === 'guarantees' ? '#60a5fa' : 'var(--text-muted)',
            borderBottom: activeTab === 'guarantees' ? '2px solid #3b82f6' : '2px solid transparent',
          }}
        >
          <Shield size={16} />
          <span>Référentiel des Garanties ({guarantees.length})</span>
        </button>

        <button
          onClick={() => handleTabChange('products')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.6rem 1.2rem',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            fontSize: '0.875rem',
            fontWeight: activeTab === 'products' ? 700 : 500,
            cursor: 'pointer',
            background: activeTab === 'products' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
            color: activeTab === 'products' ? '#60a5fa' : 'var(--text-muted)',
            borderBottom: activeTab === 'products' ? '2px solid #3b82f6' : '2px solid transparent',
          }}
        >
          <Layers size={16} />
          <span>Branches & Produits Commerciaux ({products.length})</span>
        </button>
      </div>

      {/* Content Table */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        {activeTab === 'guarantees' ? (
          <DataTable
            columns={guaranteeColumns}
            data={guarantees}
            searchPlaceholder="Rechercher une garantie par libellé, code ou branche..."
          />
        ) : (
          <DataTable
            columns={productColumns}
            data={products}
            searchPlaceholder="Filtrer une branche ou produit..."
          />
        )}
      </div>

      {/* Modal Créer une Garantie */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Création d'une Nouvelle Garantie au Catalogue">
        <form onSubmit={handleCreateGuarantee} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="responsive-form-row">
            <div className="form-group">
              <label className="form-label">Code Garantie (Unique)</label>
              <input
                type="text"
                className="form-control"
                required
                placeholder="Ex: GAR_VOL_AGRESSION"
                value={newGuaranteeForm.code}
                onChange={(e) => setNewGuaranteeForm({ ...newGuaranteeForm, code: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Libellé Officiel de la Garantie</label>
              <input
                type="text"
                className="form-control"
                required
                placeholder="Ex: VOL PAR EFFRACTION ET AGRESSION"
                value={newGuaranteeForm.libelle}
                onChange={(e) => setNewGuaranteeForm({ ...newGuaranteeForm, libelle: e.target.value })}
              />
            </div>
          </div>

          <div className="responsive-form-row">
            <div className="form-group">
              <label className="form-label">Branche Métier de Rattachement</label>
              <select
                className="form-control"
                value={newGuaranteeForm.branche}
                onChange={(e) => setNewGuaranteeForm({ ...newGuaranteeForm, branche: e.target.value })}
              >
                <option value="Automobile">Automobile</option>
                <option value="Habitation MRH">Habitation MRH</option>
                <option value="Individuelle Accident">Individuelle Accident</option>
                <option value="Santé Groupe">Santé & Maladie</option>
                <option value="Risques Divers">Tous Dommages & Risques Divers</option>
                <option value="Voyage">Voyage & Assistance</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Nature</label>
              <select
                className="form-control"
                value={newGuaranteeForm.type}
                onChange={(e) => setNewGuaranteeForm({ ...newGuaranteeForm, type: e.target.value })}
              >
                <option value="Complémentaire">Complémentaire Standard</option>
                <option value="Inclus d'office">Inclus d'office</option>
                <option value="Obligatoire CIMA">Obligatoire CIMA (ex: RC)</option>
                <option value="Optionnelle">Optionnelle / À la carte</option>
              </select>
            </div>
          </div>

          <div className="responsive-form-row">
            <div className="form-group">
              <label className="form-label">Mode de Calcul / Tarification</label>
              <select
                className="form-control"
                value={newGuaranteeForm.tarification}
                onChange={(e) => setNewGuaranteeForm({ ...newGuaranteeForm, tarification: e.target.value })}
              >
                <option value="% Valeur Vénale / Neuf">% sur Valeur Vénale ou Neuf</option>
                <option value="Barème Puissance & Zone">Barème Tarifaire (Puissance / Zone)</option>
                <option value="Forfait Annuel">Forfait Annuel Fixe</option>
                <option value="Taux sur Capital Assuré">Taux proportionnel au Capital</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Taux de Taxe CIMA</label>
              <select
                className="form-control"
                value={newGuaranteeForm.taxe_cima}
                onChange={(e) => setNewGuaranteeForm({ ...newGuaranteeForm, taxe_cima: e.target.value })}
              >
                <option value="0.0%">0.0% (Exonération Santé / Prévoyance)</option>
                <option value="10.0%">10.0% (Régime dérogatoire)</option>
                <option value="14.5%">14.5% (Taux standard Dommages / Auto)</option>
              </select>
            </div>
          </div>

          <div style={{ padding: '0.85rem', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: '#fff', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={newGuaranteeForm.fga}
                onChange={(e) => setNewGuaranteeForm({ ...newGuaranteeForm, fga: e.target.checked })}
              />
              <span style={{ fontWeight: 600 }}>Assujetti à la contribution FGA (Fonds de Garantie Automobile)</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary">
              <Check size={16} /> Enregistrer la Garantie
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Créer un Produit Commercial */}
      <Modal isOpen={isProductModalOpen} onClose={() => setIsProductModalOpen(false)} title="Nouveau Produit Commercial">
        <form onSubmit={handleCreateProduct} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="responsive-form-row">
            <div className="form-group">
              <label className="form-label">Branche Métier *</label>
              <select
                className="form-control"
                value={newProductForm.branche}
                onChange={(e) => setNewProductForm({ ...newProductForm, branche: e.target.value })}
              >
                <option value="Accidents Corporels">Accidents Corporels (IA)</option>
                <option value="Automobile">Automobile</option>
                <option value="Incendie & Risques Divers">Incendie & Risques Divers</option>
                <option value="Responsabilité Civile">Responsabilité Civile</option>
                <option value="Santé & Maladie">Santé & Maladie</option>
                <option value="Transport & Maritime">Transport & Maritime</option>
                <option value="Voyage">Voyage & Schengen</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Code Produit (Unique) *</label>
              <input
                type="text"
                className="form-control"
                required
                placeholder="Ex: AUTO-VTC ou MRH-PRO"
                value={newProductForm.code_produit}
                onChange={(e) => setNewProductForm({ ...newProductForm, code_produit: e.target.value.toUpperCase() })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Désignation Commerciale du Produit *</label>
            <input
              type="text"
              className="form-control"
              required
              placeholder="Ex: Automobile VTC & Taxis Urbains"
              value={newProductForm.nom}
              onChange={(e) => setNewProductForm({ ...newProductForm, nom: e.target.value })}
            />
          </div>

          <div className="responsive-form-row">
            <div className="form-group">
              <label className="form-label">Type de Gestion</label>
              <select
                className="form-control"
                value={newProductForm.type_gestion}
                onChange={(e) => setNewProductForm({ ...newProductForm, type_gestion: e.target.value })}
              >
                <option value="Collectif">Collectif / Groupe</option>
                <option value="Individuel">Individuel</option>
                <option value="Mixte">Mixte (Individuel & Flotte)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Nombre de Garanties du Pack</label>
              <input
                type="number"
                className="form-control"
                min="1"
                max="25"
                value={newProductForm.nb_garanties}
                onChange={(e) => setNewProductForm({ ...newProductForm, nb_garanties: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsProductModalOpen(false)}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary">
              <Check size={16} /> Créer le Produit
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Modifier un Produit */}
      {selectedProduct && (
        <Modal isOpen={isEditProductModalOpen} onClose={() => setIsEditProductModalOpen(false)} title={`Modifier le Produit – ${selectedProduct.code_produit}`}>
          <form onSubmit={handleSaveEditProduct} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Désignation Commerciale</label>
              <input
                type="text"
                className="form-control"
                value={selectedProduct.nom}
                onChange={(e) => setSelectedProduct({ ...selectedProduct, nom: e.target.value })}
              />
            </div>

            <div className="responsive-form-row">
              <div className="form-group">
                <label className="form-label">Branche</label>
                <select
                  className="form-control"
                  value={selectedProduct.branche}
                  onChange={(e) => setSelectedProduct({ ...selectedProduct, branche: e.target.value })}
                >
                  <option value="Accidents Corporels">Accidents Corporels</option>
                  <option value="Automobile">Automobile</option>
                  <option value="Incendie & Risques Divers">Incendie & Risques Divers</option>
                  <option value="Responsabilité Civile">Responsabilité Civile</option>
                  <option value="Santé & Maladie">Santé & Maladie</option>
                  <option value="Voyage">Voyage</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Statut</label>
                <select
                  className="form-control"
                  value={selectedProduct.statut}
                  onChange={(e) => setSelectedProduct({ ...selectedProduct, statut: e.target.value })}
                >
                  <option value="Actif">Actif</option>
                  <option value="En Révision">En Révision</option>
                  <option value="Inactif">Inactif</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setIsEditProductModalOpen(false)}>
                Annuler
              </button>
              <button type="submit" className="btn btn-primary">
                Sauvegarder
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Modifier une Garantie */}
      {selectedGuarantee && (
        <Modal isOpen={isEditGuaranteeModalOpen} onClose={() => setIsEditGuaranteeModalOpen(false)} title={`Modifier Garantie – ${selectedGuarantee.code}`}>
          <form onSubmit={handleSaveEditGuarantee} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Libellé</label>
              <input
                type="text"
                className="form-control"
                value={selectedGuarantee.libelle}
                onChange={(e) => setSelectedGuarantee({ ...selectedGuarantee, libelle: e.target.value })}
              />
            </div>

            <div className="responsive-form-row">
              <div className="form-group">
                <label className="form-label">Mode Tarification</label>
                <select
                  className="form-control"
                  value={selectedGuarantee.tarification}
                  onChange={(e) => setSelectedGuarantee({ ...selectedGuarantee, tarification: e.target.value })}
                >
                  <option value="% Valeur Vénale / Neuf">% Valeur Vénale / Neuf</option>
                  <option value="Barème Puissance & Zone">Barème Puissance & Zone</option>
                  <option value="Forfait Annuel">Forfait Annuel</option>
                  <option value="Taux sur Capital Assuré">Taux sur Capital Assuré</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Taxe CIMA</label>
                <input
                  type="text"
                  className="form-control"
                  value={selectedGuarantee.taxe_cima}
                  onChange={(e) => setSelectedGuarantee({ ...selectedGuarantee, taxe_cima: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0' }}>
              <input
                type="checkbox"
                id="edit_fga"
                checked={selectedGuarantee.fga}
                onChange={(e) => setSelectedGuarantee({ ...selectedGuarantee, fga: e.target.checked })}
              />
              <label htmlFor="edit_fga" style={{ fontSize: '0.825rem', color: '#fff', cursor: 'pointer' }}>
                Assujetti à la contribution FGA
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setIsEditGuaranteeModalOpen(false)}>
                Annuler
              </button>
              <button type="submit" className="btn btn-primary">
                Sauvegarder
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Fiche Détail Garantie */}
      {selectedGuarantee && (
        <Modal isOpen={isGuaranteeDetailModalOpen} onClose={() => setIsGuaranteeDetailModalOpen(false)} title={`Fiche Réglementaire – ${selectedGuarantee.code}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ background: 'rgba(59,130,246,0.08)', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Dénomination CIMA</div>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: '#fff' }}>{selectedGuarantee.libelle}</div>
              <div style={{ fontSize: '0.75rem', color: '#60a5fa', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>Code interne : {selectedGuarantee.code}</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.825rem' }}>
              <div style={{ padding: '0.65rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>BRANCHE</span>
                <strong>{selectedGuarantee.branche}</strong>
              </div>
              <div style={{ padding: '0.65rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>NATURE JURIDIQUE</span>
                <strong style={{ color: selectedGuarantee.type?.includes('Obligatoire') ? '#f43f5e' : '#34d399' }}>{selectedGuarantee.type}</strong>
              </div>
              <div style={{ padding: '0.65rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>TAXE CIMA</span>
                <strong style={{ color: '#fbbf24' }}>{selectedGuarantee.taxe_cima}</strong>
              </div>
              <div style={{ padding: '0.65rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>CONTRIBUTION FGA</span>
                <strong>{selectedGuarantee.fga ? 'Oui (Fonds Garantie Auto)' : 'Non assujetti'}</strong>
              </div>
            </div>

            <div style={{ padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>MODE DE TARIFICATION</span>
              <div>{selectedGuarantee.tarification}</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setIsGuaranteeDetailModalOpen(false)}>
                Fermer
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  window.print();
                  success('Impression de la fiche garantie lancée.');
                }}
              >
                Imprimer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Suppression Produit ou Garantie */}
      <DeleteConfirmModal
        isOpen={!!deletingItem}
        onClose={() => setDeletingItem(null)}
        itemType={deleteType}
        itemName={deletingItem?.nom || deletingItem?.libelle}
        itemCode={deletingItem?.code_produit || deletingItem?.code}
        validation={deleteValidation}
        onConfirm={() => {
          if (deletingItem) {
            try {
              if (deleteType === 'produit') {
                dataStore.deleteProduct(deletingItem.id);
                setProducts(dataStore.getProducts());
                success(`Produit ${deletingItem.nom} supprimé du catalogue.`);
              } else {
                dataStore.deleteGuarantee(deletingItem.id);
                setGuarantees(dataStore.getGuarantees());
                success(`Garantie ${deletingItem.libelle} supprimée du catalogue.`);
              }
              setDeletingItem(null);
            } catch (err) {
              toastError(err.message);
            }
          }
        }}
      />
    </div>
  );
};

export default CatalogProductsPage;
