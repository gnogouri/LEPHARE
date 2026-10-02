import React, { useState, useEffect } from 'react';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { DeleteConfirmModal } from '../../../components/common/DeleteConfirmModal';
import { Car, Globe, Plus, Edit2, ShieldCheck, Check, Trash2, Plane, Ship, Package, Layers } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import { dataStore } from '../../../api/dataStore';
import { settingsApi } from '../../../api/endpoints';

export const VehicleGeoSettingsPage = () => {
  const { success } = useToast();
  const [activeTab, setActiveTab] = useState('vehicles'); // 'vehicles' | 'geo' | 'voyage' | 'transport'

  const [vehicleGenres, setVehicleGenres] = useState(() => dataStore.getVehicles());
  const [geoZones, setGeoZones] = useState(() => dataStore.getGeoZones());
  const [voyageZones, setVoyageZones] = useState(() => dataStore.getVoyageZones());
  const [voyageFormules, setVoyageFormules] = useState(() => dataStore.getVoyageFormules());
  const [transportModes, setTransportModes] = useState(() => dataStore.getTransportModes());
  const [transportNatures, setTransportNatures] = useState(() => dataStore.getTransportNatures());

  useEffect(() => {
    // Charger les 13 genres de véhicule réels de Django configuration_api/genrevehicule/
    settingsApi.getGenres().then((res) => {
      if (Array.isArray(res) && res.length > 0) {
        const mapped = res.map((g) => ({
          id: g.IdGenre || g.id,
          code: g.CodeGenre || g.code || `G-${g.IdGenre}`,
          libelle: g.LibelleGenre || g.libelle,
          usage: 'Usage Règlementaire CIMA',
          taux_base: '1.0',
          raw: g,
        }));
        setVehicleGenres(mapped);
      }
    }).catch(() => {});

    const unsub = dataStore.subscribe(() => {
      setVehicleGenres(dataStore.getVehicles());
      setGeoZones(dataStore.getGeoZones());
      setVoyageZones(dataStore.getVoyageZones());
      setVoyageFormules(dataStore.getVoyageFormules());
      setTransportModes(dataStore.getTransportModes());
      setTransportNatures(dataStore.getTransportNatures());
    });
    return unsub;
  }, []);

  // Modals state
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [isGeoModalOpen, setIsGeoModalOpen] = useState(false);
  const [isVoyageZoneModalOpen, setIsVoyageZoneModalOpen] = useState(false);
  const [isVoyageFormuleModalOpen, setIsVoyageFormuleModalOpen] = useState(false);
  const [isTransportModeModalOpen, setIsTransportModeModalOpen] = useState(false);
  const [isTransportNatureModalOpen, setIsTransportNatureModalOpen] = useState(false);

  const [editingItem, setEditingItem] = useState(null);
  const [deletingItem, setDeletingItem] = useState(null);
  const [deleteType, setDeleteType] = useState('genre véhicule');

  // Forms state
  const [vehicleForm, setVehicleForm] = useState({ code: '', libelle: '', usage: '', taux_base: '1.0' });
  const [geoForm, setGeoForm] = useState({ code: '', zone: '', pays: "Côte d'Ivoire", coefficient_risque: '1.00' });
  const [voyageZoneForm, setVoyageZoneForm] = useState({ code: '', label: '', description: '', baseRateMultiplier: 1.0, schengenCompliant: false });
  const [voyageFormuleForm, setVoyageFormuleForm] = useState({ code: '', nom: '', description: '', plafondMedicalEur: '30 000 €', rapatriement: '100% Frais réels', bagages: 'Non inclus', rcEtranger: 'Non inclus', basePerDay: 2500 });
  const [transportModeForm, setTransportModeForm] = useState({ code: '', label: '', description: '', baseRate: 0.003 });
  const [transportNatureForm, setTransportNatureForm] = useState({ code: '', label: '', riskCoeff: 1.0 });

  // Handlers Vehicle
  const handleOpenAddVehicle = () => {
    setEditingItem(null);
    setVehicleForm({ code: '', libelle: '', usage: '', taux_base: '1.0' });
    setIsVehicleModalOpen(true);
  };
  const handleOpenEditVehicle = (v) => {
    setEditingItem(v);
    setVehicleForm({ code: v.code, libelle: v.libelle, usage: v.usage, taux_base: v.taux_base });
    setIsVehicleModalOpen(true);
  };
  const handleSaveVehicle = (e) => {
    e.preventDefault();
    if (!vehicleForm.code || !vehicleForm.libelle) return;
    if (editingItem) {
      dataStore.updateVehicle(editingItem.id, vehicleForm);
      success(`Genre de véhicule ${vehicleForm.code} mis à jour avec succès.`);
    } else {
      dataStore.saveVehicle(vehicleForm);
      success(`Nouveau genre ${vehicleForm.code} ajouté au référentiel.`);
    }
    setIsVehicleModalOpen(false);
  };

  // Handlers Geo
  const handleOpenAddGeo = () => {
    setEditingItem(null);
    setGeoForm({ code: '', zone: '', pays: "Côte d'Ivoire", coefficient_risque: '1.00' });
    setIsGeoModalOpen(true);
  };
  const handleOpenEditGeo = (g) => {
    setEditingItem(g);
    setGeoForm({ code: g.code, zone: g.zone, pays: g.pays, coefficient_risque: g.coefficient_risque });
    setIsGeoModalOpen(true);
  };
  const handleSaveGeo = (e) => {
    e.preventDefault();
    if (!geoForm.code || !geoForm.zone) return;
    if (editingItem) {
      dataStore.updateGeoZone(editingItem.id, geoForm);
      success(`Zone géographique ${geoForm.code} mise à jour avec succès.`);
    } else {
      dataStore.saveGeoZone(geoForm);
      success(`Nouvelle zone ${geoForm.code} enregistrée.`);
    }
    setIsGeoModalOpen(false);
  };

  // Handlers Voyage Zone
  const handleOpenAddVoyageZone = () => {
    setEditingItem(null);
    setVoyageZoneForm({ code: '', label: '', description: '', baseRateMultiplier: 1.0, schengenCompliant: false });
    setIsVoyageZoneModalOpen(true);
  };
  const handleOpenEditVoyageZone = (z) => {
    setEditingItem(z);
    setVoyageZoneForm({ code: z.code || z.id, label: z.label, description: z.description, baseRateMultiplier: z.baseRateMultiplier, schengenCompliant: z.schengenCompliant });
    setIsVoyageZoneModalOpen(true);
  };
  const handleSaveVoyageZone = (e) => {
    e.preventDefault();
    if (!voyageZoneForm.label) return;
    if (editingItem) {
      dataStore.updateVoyageZone(editingItem.id, voyageZoneForm);
      success(`Zone de destination Voyage mise à jour.`);
    } else {
      dataStore.saveVoyageZone(voyageZoneForm);
      success(`Nouvelle zone de voyage enregistrée.`);
    }
    setIsVoyageZoneModalOpen(false);
  };

  // Handlers Voyage Formule
  const handleOpenAddVoyageFormule = () => {
    setEditingItem(null);
    setVoyageFormuleForm({ code: '', nom: '', description: '', plafondMedicalEur: '30 000 € (~19 680 000 FCFA)', rapatriement: '100% Frais réels', bagages: 'Non inclus', rcEtranger: 'Non inclus', basePerDay: 2500 });
    setIsVoyageFormuleModalOpen(true);
  };
  const handleOpenEditVoyageFormule = (f) => {
    setEditingItem(f);
    setVoyageFormuleForm({ code: f.code || f.id, nom: f.nom, description: f.description, plafondMedicalEur: f.plafondMedicalEur, rapatriement: f.rapatriement, bagages: f.bagages, rcEtranger: f.rcEtranger, basePerDay: f.basePerDay });
    setIsVoyageFormuleModalOpen(true);
  };
  const handleSaveVoyageFormule = (e) => {
    e.preventDefault();
    if (!voyageFormuleForm.nom) return;
    if (editingItem) {
      dataStore.updateVoyageFormule(editingItem.id, voyageFormuleForm);
      success(`Formule voyage "${voyageFormuleForm.nom}" mise à jour.`);
    } else {
      dataStore.saveVoyageFormule(voyageFormuleForm);
      success(`Nouvelle formule voyage créée.`);
    }
    setIsVoyageFormuleModalOpen(false);
  };

  // Handlers Transport Mode
  const handleOpenAddTransportMode = () => {
    setEditingItem(null);
    setTransportModeForm({ code: '', label: '', description: '', baseRate: 0.003 });
    setIsTransportModeModalOpen(true);
  };
  const handleOpenEditTransportMode = (m) => {
    setEditingItem(m);
    setTransportModeForm({ code: m.code || m.id, label: m.label, description: m.description, baseRate: m.baseRate });
    setIsTransportModeModalOpen(true);
  };
  const handleSaveTransportMode = (e) => {
    e.preventDefault();
    if (!transportModeForm.label) return;
    if (editingItem) {
      dataStore.updateTransportMode(editingItem.id, transportModeForm);
      success(`Mode de transport mis à jour.`);
    } else {
      dataStore.saveTransportMode(transportModeForm);
      success(`Nouveau mode de transport ajouté.`);
    }
    setIsTransportModeModalOpen(false);
  };

  // Handlers Transport Nature
  const handleOpenAddTransportNature = () => {
    setEditingItem(null);
    setTransportNatureForm({ code: '', label: '', riskCoeff: 1.0 });
    setIsTransportNatureModalOpen(true);
  };
  const handleOpenEditTransportNature = (n) => {
    setEditingItem(n);
    setTransportNatureForm({ code: n.code || n.id, label: n.label, riskCoeff: n.riskCoeff });
    setIsTransportNatureModalOpen(true);
  };
  const handleSaveTransportNature = (e) => {
    e.preventDefault();
    if (!transportNatureForm.label) return;
    if (editingItem) {
      dataStore.updateTransportNature(editingItem.id, transportNatureForm);
      success(`Nature de marchandise mise à jour.`);
    } else {
      dataStore.saveTransportNature(transportNatureForm);
      success(`Nouvelle catégorie de marchandise enregistrée.`);
    }
    setIsTransportNatureModalOpen(false);
  };

  // Columns Definitions
  const vehicleColumns = [
    { header: 'Code Genre', accessor: 'code', render: (r) => <strong style={{ color: '#60a5fa' }}>{r.code}</strong> },
    { header: 'Désignation Véhicule', accessor: 'libelle' },
    { header: 'Usage Typique', accessor: 'usage' },
    { header: 'Coefficient Risque', accessor: 'taux_base', render: (r) => <strong style={{ color: '#34d399' }}>{r.taux_base}</strong> },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            onClick={() => handleOpenEditVehicle(r)}
          >
            <Edit2 size={13} />
            <span>Modifier</span>
          </button>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.45rem', fontSize: '0.75rem', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.25)' }}
            onClick={() => {
              setDeleteType('genre véhicule');
              setDeletingItem(r);
            }}
            title="Supprimer le genre de véhicule"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];

  const geoColumns = [
    { header: 'Code Zone', accessor: 'code', render: (r) => <strong style={{ color: '#c084fc' }}>{r.code}</strong> },
    { header: 'Zone Géographique', accessor: 'zone' },
    { header: 'Pays', accessor: 'pays' },
    { header: 'Coefficient Tarification', accessor: 'coefficient_risque', render: (r) => <strong style={{ color: '#fbbf24' }}>{r.coefficient_risque}</strong> },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            onClick={() => handleOpenEditGeo(r)}
          >
            <Edit2 size={13} />
            <span>Modifier</span>
          </button>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.45rem', fontSize: '0.75rem', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.25)' }}
            onClick={() => {
              setDeleteType('zone géographique');
              setDeletingItem(r);
            }}
            title="Supprimer la zone géographique"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];

  const voyageZoneColumns = [
    { header: 'Libellé Zone', accessor: 'label', render: (r) => <strong style={{ color: '#38bdf8' }}>{r.label}</strong> },
    { header: 'Description / Pays couverts', accessor: 'description' },
    { header: 'Coeff. Multiplicateur', accessor: 'baseRateMultiplier', render: (r) => <span style={{ color: '#fbbf24', fontWeight: 600 }}>x {r.baseRateMultiplier}</span> },
    { header: 'Conforme Schengen', accessor: 'schengenCompliant', render: (r) => r.schengenCompliant ? <span className="badge badge-success">Oui (Visa 30 000 €)</span> : <span className="badge badge-secondary">Non</span> },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleOpenEditVoyageZone(r)}>
            <Edit2 size={13} />
          </button>
          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.45rem', fontSize: '0.75rem', color: '#ef4444' }} onClick={() => { setDeleteType('zone voyage'); setDeletingItem(r); }}>
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];

  const voyageFormuleColumns = [
    { header: 'Nom Formule', accessor: 'nom', render: (r) => <strong style={{ color: '#fff' }}>{r.nom}</strong> },
    { header: 'Plafond Médical', accessor: 'plafondMedicalEur', render: (r) => <span style={{ color: '#34d399', fontWeight: 600 }}>{r.plafondMedicalEur}</span> },
    { header: 'Tarif / Jour Base', accessor: 'basePerDay', render: (r) => <span style={{ fontFamily: 'var(--font-mono)' }}>{r.basePerDay?.toLocaleString('fr-FR')} FCFA</span> },
    { header: 'Bagages', accessor: 'bagages' },
    { header: 'RC Étranger', accessor: 'rcEtranger' },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleOpenEditVoyageFormule(r)}>
            <Edit2 size={13} />
          </button>
          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.45rem', fontSize: '0.75rem', color: '#ef4444' }} onClick={() => { setDeleteType('formule voyage'); setDeletingItem(r); }}>
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];

  const transportModeColumns = [
    { header: 'Mode de Transport', accessor: 'label', render: (r) => <strong style={{ color: '#60a5fa' }}>{r.label}</strong> },
    { header: 'Description Logistique', accessor: 'description' },
    { header: 'Taux Base Ad Valorem', accessor: 'baseRate', render: (r) => <span style={{ color: '#34d399', fontWeight: 600 }}>{(Number(r.baseRate) * 100).toFixed(2)}%</span> },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleOpenEditTransportMode(r)}>
            <Edit2 size={13} />
          </button>
          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.45rem', fontSize: '0.75rem', color: '#ef4444' }} onClick={() => { setDeleteType('mode transport'); setDeletingItem(r); }}>
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];

  const transportNatureColumns = [
    { header: 'Nature Marchandise', accessor: 'label', render: (r) => <strong style={{ color: '#fbbf24' }}>{r.label}</strong> },
    { header: 'Coeff. Risque Nature', accessor: 'riskCoeff', render: (r) => <span style={{ color: '#c084fc', fontWeight: 600 }}>x {r.riskCoeff}</span> },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleOpenEditTransportNature(r)}>
            <Edit2 size={13} />
          </button>
          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.45rem', fontSize: '0.75rem', color: '#ef4444' }} onClick={() => { setDeleteType('nature marchandise'); setDeletingItem(r); }}>
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <span className="badge badge-info">Référentiel Métiers & Zonage CIMA</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Paramétrage 100% Dynamique</span>
          </div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Globe size={26} color="#3b82f6" />
            Véhicules, zones, voyage & transport
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Genres de véhicules, zones géographiques, grilles Voyage et Transport.
          </p>
        </div>

        {activeTab === 'vehicles' && (
          <button className="btn btn-primary" onClick={handleOpenAddVehicle} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Plus size={16} />
            <span>Nouveau Genre Véhicule</span>
          </button>
        )}
        {activeTab === 'geo' && (
          <button className="btn btn-primary" onClick={handleOpenAddGeo} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Plus size={16} />
            <span>Nouvelle Zone Géographique</span>
          </button>
        )}
        {activeTab === 'voyage' && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={handleOpenAddVoyageZone}>
              <Plus size={15} /> Zone Voyage
            </button>
            <button className="btn btn-primary" onClick={handleOpenAddVoyageFormule}>
              <Plus size={15} /> Formule Voyage
            </button>
          </div>
        )}
        {activeTab === 'transport' && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={handleOpenAddTransportMode}>
              <Plus size={15} /> Mode Transport
            </button>
            <button className="btn btn-primary" onClick={handleOpenAddTransportNature}>
              <Plus size={15} /> Nature Marchandise
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        <button
          className="btn"
          style={{
            background: activeTab === 'vehicles' ? 'rgba(59,130,246,0.2)' : 'transparent',
            color: activeTab === 'vehicles' ? '#60a5fa' : 'var(--text-secondary)',
            border: `1px solid ${activeTab === 'vehicles' ? '#3b82f6' : 'transparent'}`,
          }}
          onClick={() => setActiveTab('vehicles')}
        >
          <Car size={16} /> Véhicules (Genres & Usages)
        </button>

        <button
          className="btn"
          style={{
            background: activeTab === 'geo' ? 'rgba(139,92,246,0.2)' : 'transparent',
            color: activeTab === 'geo' ? '#c084fc' : 'var(--text-secondary)',
            border: `1px solid ${activeTab === 'geo' ? '#8b5cf6' : 'transparent'}`,
          }}
          onClick={() => setActiveTab('geo')}
        >
          <Globe size={16} /> Zones Géographiques CIMA
        </button>

        <button
          className="btn"
          style={{
            background: activeTab === 'voyage' ? 'rgba(56,189,248,0.2)' : 'transparent',
            color: activeTab === 'voyage' ? '#38bdf8' : 'var(--text-secondary)',
            border: `1px solid ${activeTab === 'voyage' ? '#0ea5e9' : 'transparent'}`,
          }}
          onClick={() => setActiveTab('voyage')}
        >
          <Plane size={16} /> Voyage (Zones & Formules)
        </button>

        <button
          className="btn"
          style={{
            background: activeTab === 'transport' ? 'rgba(245,158,11,0.2)' : 'transparent',
            color: activeTab === 'transport' ? '#fbbf24' : 'var(--text-secondary)',
            border: `1px solid ${activeTab === 'transport' ? '#d97706' : 'transparent'}`,
          }}
          onClick={() => setActiveTab('transport')}
        >
          <Ship size={16} /> Transport (Modes & Natures Fret)
        </button>
      </div>

      {/* Main Tab Content */}
      {activeTab === 'vehicles' && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <DataTable columns={vehicleColumns} data={vehicleGenres} searchPlaceholder="Filtrer un genre de véhicule..." />
        </div>
      )}

      {activeTab === 'geo' && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <DataTable columns={geoColumns} data={geoZones} searchPlaceholder="Filtrer une zone géographique..." />
        </div>
      )}

      {activeTab === 'voyage' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="title-md" style={{ color: '#38bdf8' }}>Zones Territoriales Voyage</h3>
              <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }} onClick={handleOpenAddVoyageZone}>
                <Plus size={14} /> Ajouter Zone
              </button>
            </div>
            <DataTable columns={voyageZoneColumns} data={voyageZones} searchPlaceholder="Rechercher une zone..." />
          </div>

          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="title-md" style={{ color: '#fff' }}>Formules d'Assistance Voyage & Garanties</h3>
              <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }} onClick={handleOpenAddVoyageFormule}>
                <Plus size={14} /> Ajouter Formule
              </button>
            </div>
            <DataTable columns={voyageFormuleColumns} data={voyageFormules} searchPlaceholder="Rechercher une formule..." />
          </div>
        </div>
      )}

      {activeTab === 'transport' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="title-md" style={{ color: '#60a5fa' }}>Modes de Transport & Taux de Base Ad Valorem</h3>
              <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }} onClick={handleOpenAddTransportMode}>
                <Plus size={14} /> Ajouter Mode
              </button>
            </div>
            <DataTable columns={transportModeColumns} data={transportModes} searchPlaceholder="Rechercher un mode..." />
          </div>

          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="title-md" style={{ color: '#fbbf24' }}>Catégories & Natures de Marchandises (Coeff. Risque Fret)</h3>
              <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }} onClick={handleOpenAddTransportNature}>
                <Plus size={14} /> Ajouter Nature Marchandise
              </button>
            </div>
            <DataTable columns={transportNatureColumns} data={transportNatures} searchPlaceholder="Rechercher une nature de bien..." />
          </div>
        </div>
      )}

      {/* Modal Vehicle (Add/Edit) */}
      <Modal
        isOpen={isVehicleModalOpen}
        onClose={() => setIsVehicleModalOpen(false)}
        title={editingItem ? `Modifier Genre Automobile : ${editingItem.code}` : 'Nouveau Genre Automobile CIMA'}
        subtitle="Classification des risques automobiles selon le Livre V du Code CIMA."
        maxWidth="540px"
      >
        <form onSubmit={handleSaveVehicle} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">Code Genre *</label>
              <input
                type="text"
                className="form-control"
                required
                placeholder="ex: VU, TPC, MOTO"
                value={vehicleForm.code}
                onChange={(e) => setVehicleForm({ ...vehicleForm, code: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Coefficient Risque Base *</label>
              <input
                type="number"
                step="0.05"
                className="form-control"
                required
                value={vehicleForm.taux_base}
                onChange={(e) => setVehicleForm({ ...vehicleForm, taux_base: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Désignation du Genre *</label>
            <input
              type="text"
              className="form-control"
              required
              placeholder="ex: Véhicules Utilitaires Légers"
              value={vehicleForm.libelle}
              onChange={(e) => setVehicleForm({ ...vehicleForm, libelle: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Usage Typique / Activité</label>
            <input
              type="text"
              className="form-control"
              placeholder="ex: Transport privé de matériel professionnel"
              value={vehicleForm.usage}
              onChange={(e) => setVehicleForm({ ...vehicleForm, usage: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsVehicleModalOpen(false)}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Check size={16} />
              <span>{editingItem ? 'Enregistrer Modifications' : 'Créer Genre'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Geo (Add/Edit) */}
      <Modal
        isOpen={isGeoModalOpen}
        onClose={() => setIsGeoModalOpen(false)}
        title={editingItem ? `Modifier Zone Géographique : ${editingItem.code}` : 'Nouvelle Zone Géographique CIMA'}
        subtitle="Délimitation territoriale et tarification différentielle par zone."
        maxWidth="540px"
      >
        <form onSubmit={handleSaveGeo} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">Code Zone *</label>
              <input
                type="text"
                className="form-control"
                required
                placeholder="ex: CI-SP, ZONE_3"
                value={geoForm.code}
                onChange={(e) => setGeoForm({ ...geoForm, code: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Coefficient Risque *</label>
              <input
                type="number"
                step="0.05"
                className="form-control"
                required
                value={geoForm.coefficient_risque}
                onChange={(e) => setGeoForm({ ...geoForm, coefficient_risque: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Libellé de la Zone *</label>
            <input
              type="text"
              className="form-control"
              required
              placeholder="ex: San Pedro & Région Côtière"
              value={geoForm.zone}
              onChange={(e) => setGeoForm({ ...geoForm, zone: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Pays *</label>
            <input
              type="text"
              className="form-control"
              required
              placeholder="ex: Côte d'Ivoire"
              value={geoForm.pays}
              onChange={(e) => setGeoForm({ ...geoForm, pays: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsGeoModalOpen(false)}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Check size={16} />
              <span>{editingItem ? 'Enregistrer Modifications' : 'Créer Zone'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Voyage Zone */}
      <Modal
        isOpen={isVoyageZoneModalOpen}
        onClose={() => setIsVoyageZoneModalOpen(false)}
        title={editingItem ? 'Modifier Zone Destination Voyage' : 'Nouvelle Zone Destination Voyage'}
        maxWidth="540px"
      >
        <form onSubmit={handleSaveVoyageZone} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Libellé Zone *</label>
            <input
              type="text"
              className="form-control"
              required
              placeholder="ex: Zone 5 : Asie & Pacifique"
              value={voyageZoneForm.label}
              onChange={(e) => setVoyageZoneForm({ ...voyageZoneForm, label: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Pays couverts</label>
            <textarea
              className="form-control"
              rows={2}
              placeholder="ex: Chine, Japon, Corée du Sud, Thaïlande..."
              value={voyageZoneForm.description}
              onChange={(e) => setVoyageZoneForm({ ...voyageZoneForm, description: e.target.value })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Multiplicateur Risque</label>
              <input
                type="number"
                step="0.05"
                className="form-control"
                value={voyageZoneForm.baseRateMultiplier}
                onChange={(e) => setVoyageZoneForm({ ...voyageZoneForm, baseRateMultiplier: parseFloat(e.target.value) || 1.0 })}
              />
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', marginTop: '1.75rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={voyageZoneForm.schengenCompliant}
                  onChange={(e) => setVoyageZoneForm({ ...voyageZoneForm, schengenCompliant: e.target.checked })}
                />
                <span style={{ fontSize: '0.875rem' }}>Conforme Visa Schengen</span>
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsVoyageZoneModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary"><Check size={15} /> Enregistrer</button>
          </div>
        </form>
      </Modal>

      {/* Modal Voyage Formule */}
      <Modal
        isOpen={isVoyageFormuleModalOpen}
        onClose={() => setIsVoyageFormuleModalOpen(false)}
        title={editingItem ? 'Modifier Formule Voyage' : 'Nouvelle Formule Voyage'}
        maxWidth="580px"
      >
        <form onSubmit={handleSaveVoyageFormule} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Nom de la Formule *</label>
            <input
              type="text"
              className="form-control"
              required
              placeholder="ex: Formule Étudiant & Stage International"
              value={voyageFormuleForm.nom}
              onChange={(e) => setVoyageFormuleForm({ ...voyageFormuleForm, nom: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Description</label>
            <input
              type="text"
              className="form-control"
              placeholder="ex: Couverture adaptée aux séjours universitaires longs"
              value={voyageFormuleForm.description}
              onChange={(e) => setVoyageFormuleForm({ ...voyageFormuleForm, description: e.target.value })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Plafond Médical</label>
              <input
                type="text"
                className="form-control"
                value={voyageFormuleForm.plafondMedicalEur}
                onChange={(e) => setVoyageFormuleForm({ ...voyageFormuleForm, plafondMedicalEur: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Tarif de Base / Jour (FCFA)</label>
              <input
                type="number"
                className="form-control"
                value={voyageFormuleForm.basePerDay}
                onChange={(e) => setVoyageFormuleForm({ ...voyageFormuleForm, basePerDay: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Garantie Bagages</label>
              <input
                type="text"
                className="form-control"
                value={voyageFormuleForm.bagages}
                onChange={(e) => setVoyageFormuleForm({ ...voyageFormuleForm, bagages: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">RC Étranger</label>
              <input
                type="text"
                className="form-control"
                value={voyageFormuleForm.rcEtranger}
                onChange={(e) => setVoyageFormuleForm({ ...voyageFormuleForm, rcEtranger: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsVoyageFormuleModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary"><Check size={15} /> Enregistrer</button>
          </div>
        </form>
      </Modal>

      {/* Modal Transport Mode */}
      <Modal
        isOpen={isTransportModeModalOpen}
        onClose={() => setIsTransportModeModalOpen(false)}
        title={editingItem ? 'Modifier Mode de Transport' : 'Nouveau Mode de Transport'}
        maxWidth="540px"
      >
        <form onSubmit={handleSaveTransportMode} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Libellé Mode de Transport *</label>
            <input
              type="text"
              className="form-control"
              required
              placeholder="ex: Fluvial & Voies Navigables"
              value={transportModeForm.label}
              onChange={(e) => setTransportModeForm({ ...transportModeForm, label: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Description Technique</label>
            <input
              type="text"
              className="form-control"
              placeholder="ex: Fret par barges fluviales et transit lagunaire"
              value={transportModeForm.description}
              onChange={(e) => setTransportModeForm({ ...transportModeForm, description: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Taux Base Ad Valorem (ex: 0.0035 pour 0.35%)</label>
            <input
              type="number"
              step="0.0001"
              className="form-control"
              value={transportModeForm.baseRate}
              onChange={(e) => setTransportModeForm({ ...transportModeForm, baseRate: parseFloat(e.target.value) || 0.003 })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsTransportModeModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary"><Check size={15} /> Enregistrer</button>
          </div>
        </form>
      </Modal>

      {/* Modal Transport Nature */}
      <Modal
        isOpen={isTransportNatureModalOpen}
        onClose={() => setIsTransportNatureModalOpen(false)}
        title={editingItem ? 'Modifier Catégorie de Marchandise' : 'Nouvelle Catégorie de Marchandise'}
        maxWidth="540px"
      >
        <form onSubmit={handleSaveTransportNature} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Désignation Marchandise *</label>
            <input
              type="text"
              className="form-control"
              required
              placeholder="ex: Produits Pharmaceutiques & Médicaux"
              value={transportNatureForm.label}
              onChange={(e) => setTransportNatureForm({ ...transportNatureForm, label: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Coefficient Risque Nature (ex: 1.25)</label>
            <input
              type="number"
              step="0.05"
              className="form-control"
              value={transportNatureForm.riskCoeff}
              onChange={(e) => setTransportNatureForm({ ...transportNatureForm, riskCoeff: parseFloat(e.target.value) || 1.0 })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsTransportNatureModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary"><Check size={15} /> Enregistrer</button>
          </div>
        </form>
      </Modal>

      {/* Modal Suppression Universelle */}
      <DeleteConfirmModal
        isOpen={!!deletingItem}
        onClose={() => setDeletingItem(null)}
        itemType={deleteType}
        itemName={deletingItem?.libelle || deletingItem?.zone || deletingItem?.label || deletingItem?.nom}
        itemCode={deletingItem?.code || deletingItem?.id}
        validation={{ allowed: true }}
        onConfirm={() => {
          if (deletingItem) {
            if (deleteType === 'genre véhicule') {
              dataStore.deleteVehicle(deletingItem.id);
              success(`Genre de véhicule supprimé.`);
            } else if (deleteType === 'zone géographique') {
              dataStore.deleteGeoZone(deletingItem.id);
              success(`Zone géographique supprimée.`);
            } else if (deleteType === 'zone voyage') {
              dataStore.deleteVoyageZone(deletingItem.id);
              success(`Zone voyage supprimée.`);
            } else if (deleteType === 'formule voyage') {
              dataStore.deleteVoyageFormule(deletingItem.id);
              success(`Formule voyage supprimée.`);
            } else if (deleteType === 'mode transport') {
              dataStore.deleteTransportMode(deletingItem.id);
              success(`Mode de transport supprimé.`);
            } else if (deleteType === 'nature marchandise') {
              dataStore.deleteTransportNature(deletingItem.id);
              success(`Catégorie de marchandise supprimée.`);
            }
            setDeletingItem(null);
          }
        }}
      />
    </div>
  );
};

export default VehicleGeoSettingsPage;
