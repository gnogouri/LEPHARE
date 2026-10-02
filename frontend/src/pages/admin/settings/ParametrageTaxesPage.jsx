import React, { useState, useEffect } from 'react';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { Percent, Plus, Edit2, Trash2, ShieldAlert, Calculator, Banknote, RefreshCw } from 'lucide-react';
import { settingsApi } from '../../../api/endpoints';
import { dataStore } from '../../../api/dataStore';
import { useToast } from '../../../context/ToastContext';

export const ParametrageTaxesPage = () => {
  const { success, error: toastError } = useToast();

  const [taxes, setTaxes] = useState([
    { id: 1, CodeTaxe: 'TCA_AUTO', Libelle: 'Taxe sur les Conventions d\'Assurance Auto', Branche: 'Automobile', Taux: 14.5, Exoneration: 'Non', TypeAssiette: 'Prime Nette', BaseCalcul: 'Prime Nette Émise' },
    { id: 2, CodeTaxe: 'FGA_AUTO', Libelle: 'Fonds de Garantie Automobile (FGA)', Branche: 'Automobile', Taux: 1.5, Exoneration: 'Non', TypeAssiette: 'Prime RC', BaseCalcul: 'Prime Nette Responsabilité Civile' },
    { id: 3, CodeTaxe: 'TCA_MRH', Libelle: 'Taxe Assurance Incendie & Dommages aux Biens', Branche: 'Incendie (MRH)', Taux: 14.5, Exoneration: 'Non', TypeAssiette: 'Prime Nette', BaseCalcul: 'Prime Nette Globale' },
    { id: 4, CodeTaxe: 'TCA_TRP', Libelle: 'Taxe de Circulation Marchandises & Facultés', Branche: 'Transport', Taux: 14.5, Exoneration: 'Non', TypeAssiette: 'Prime Nette', BaseCalcul: 'Prime Nette Faculté' },
    { id: 5, CodeTaxe: 'TCA_VOY', Libelle: 'Taxe Assistance & Rapatriement Voyage', Branche: 'Voyage', Taux: 14.5, Exoneration: 'Non', TypeAssiette: 'Prime Nette', BaseCalcul: 'Forfait de séjour' },
    { id: 6, CodeTaxe: 'TCA_SANTE', Libelle: 'Exonération Fiscale Santé & Prévoyance Groupe', Branche: 'Santé Groupe', Taux: 0.0, Exoneration: 'Oui (Exonéré Art. 997 CGI)', TypeAssiette: 'Exonéré', BaseCalcul: 'Assurance Sociale Complémentaire' },
    { id: 7, CodeTaxe: 'TCA_IA', Libelle: 'Taxe Assurance Accidents Corporels Salariés', Branche: 'Individuelle Accident', Taux: 14.5, Exoneration: 'Non', TypeAssiette: 'Prime Nette', BaseCalcul: 'Prime Nette Décès & Invalidité' },
  ]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTaxe, setEditingTaxe] = useState(null);
  const [taxeForm, setTaxeForm] = useState({
    code: '',
    libelle: '',
    branche: 'Automobile',
    taux: 14.5,
    type_assiette: 'Prime Nette',
    base_calcul: 'Prime Nette',
    exoneration: 'Non',
  });

  // Calculateur d'impact simulé
  const [simulPrimeNette, setSimulPrimeNette] = useState(150000);
  const [simulBranche, setSimulBranche] = useState('Automobile');

  const impactCalcule = (simulPrimeNette * (taxes.find(t => t.Branche.toLowerCase().includes(simulBranche.toLowerCase()))?.Taux || 14.5)) / 100;

  const handleSaveTaxe = (e) => {
    e.preventDefault();
    if (!taxeForm.libelle) return;
    const newTaxe = {
      id: editingTaxe ? editingTaxe.id : Date.now(),
      CodeTaxe: taxeForm.code || `TAXE_${Date.now()}`,
      Libelle: taxeForm.libelle,
      Branche: taxeForm.branche,
      Taux: Number(taxeForm.taux),
      TypeAssiette: taxeForm.type_assiette,
      BaseCalcul: taxeForm.base_calcul,
      Exoneration: Number(taxeForm.taux) === 0 ? 'Oui' : 'Non',
    };
    if (editingTaxe) {
      setTaxes(prev => prev.map(t => t.id === editingTaxe.id ? newTaxe : t));
      success(`Taux de taxe ${newTaxe.CodeTaxe} mis à jour.`);
    } else {
      setTaxes(prev => [newTaxe, ...prev]);
      success(`Taux de taxe ${newTaxe.CodeTaxe} créé avec succès.`);
    }
    setIsModalOpen(false);
  };

  const columns = [
    {
      header: 'Taxe',
      render: (r) => (
        <div>
          <strong style={{ color: 'var(--text-primary)', display: 'block' }}>{r.Libelle}</strong>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#fbbf24' }}>{r.CodeTaxe}</span>
        </div>
      )
    },
    {
      header: 'Branche Métier',
      accessor: 'Branche',
      render: (r) => <span className="badge badge-purple">{r.Branche}</span>
    },
    {
      header: 'Taux Appliqué',
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1rem', color: r.Taux === 0 ? '#34d399' : '#fbbf24' }}>
          {r.Taux.toFixed(1)} %
        </span>
      )
    },
    {
      header: 'Assiette Fiscale',
      accessor: 'TypeAssiette',
      render: (r) => <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{r.TypeAssiette}</span>
    },
    {
      header: 'Base Règlementaire',
      accessor: 'BaseCalcul',
      render: (r) => <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.BaseCalcul}</span>
    },
    {
      header: 'Exonération',
      accessor: 'Exoneration',
      render: (r) => (
        <StatusBadge label={r.Exoneration.includes('Oui') ? 'Exonéré' : 'Taxable'} color={r.Exoneration.includes('Oui') ? 'emerald' : 'amber'} />
      )
    },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            onClick={() => {
              setEditingTaxe(r);
              setTaxeForm({
                code: r.CodeTaxe,
                libelle: r.Libelle,
                branche: r.Branche,
                taux: r.Taux,
                type_assiette: r.TypeAssiette,
                base_calcul: r.BaseCalcul,
                exoneration: r.Exoneration,
              });
              setIsModalOpen(true);
            }}
          >
            Modifier
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
            <Percent size={28} color="#fbbf24" />
            Taxes
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Taux de taxe sur les contrats d'assurance, fonds de garantie automobile (FGA) et exonérations.
          </p>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => {
            setEditingTaxe(null);
            setTaxeForm({
              code: '',
              libelle: '',
              branche: 'Automobile',
              taux: 14.5,
              type_assiette: 'Prime Nette',
              base_calcul: 'Prime Nette',
              exoneration: 'Non',
            });
            setIsModalOpen(true);
          }}
        >
          <Plus size={16} /> Nouveau Taux de Taxe
        </button>
      </div>

      {/* Simulator Card */}
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ padding: '0.75rem', borderRadius: '10px', background: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24' }}>
            <Calculator size={24} />
          </div>
          <div>
            <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem', display: 'block' }}>Simulateur d'Impact Fiscal Instantané</strong>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Vérifiez en temps réel l'impact de la taxe sur la prime nette soumise</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label className="form-label">Branche</label>
            <select
              className="form-control"
              value={simulBranche}
              onChange={(e) => setSimulBranche(e.target.value)}
              style={{ minWidth: '150px' }}
            >
              <option value="Automobile">Automobile</option>
              <option value="Incendie">Incendie (MRH)</option>
              <option value="Santé">Santé Groupe</option>
              <option value="Transport">Transport</option>
              <option value="Voyage">Voyage</option>
            </select>
          </div>

          <div>
            <label className="form-label">Prime Nette Simulée (FCFA)</label>
            <input
              type="number"
              className="form-control"
              value={simulPrimeNette}
              onChange={(e) => setSimulPrimeNette(Number(e.target.value))}
              style={{ minWidth: '160px', fontFamily: 'var(--font-mono)' }}
            />
          </div>

          <div style={{ paddingLeft: '1rem', borderLeft: '1px solid var(--border-medium)' }}>
            <label className="form-label">Montant Taxe Exigible</label>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fbbf24', fontFamily: 'var(--font-mono)' }}>
              {Math.round(impactCalcule).toLocaleString('fr-FR')} FCFA
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <DataTable columns={columns} data={taxes} searchPlaceholder="Filtrer une taxe ou branche..." />
      </div>

      {/* Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingTaxe ? 'Modifier le Taux de Taxe' : 'Nouveau Taux de Taxe CIMA'}
      >
        <form onSubmit={handleSaveTaxe} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Libellé de la Taxe (* requis)</label>
            <input
              type="text"
              className="form-control"
              value={taxeForm.libelle}
              onChange={(e) => setTaxeForm({ ...taxeForm, libelle: e.target.value })}
              required
              placeholder="Ex: Taxe Spéciale d'Assurance Automobile"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Code Taxe</label>
              <input
                type="text"
                className="form-control"
                value={taxeForm.code}
                onChange={(e) => setTaxeForm({ ...taxeForm, code: e.target.value.toUpperCase() })}
                placeholder="Ex: TCA_AUTO"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Branche Métier</label>
              <select
                className="form-control"
                value={taxeForm.branche}
                onChange={(e) => setTaxeForm({ ...taxeForm, branche: e.target.value })}
              >
                <option value="Automobile">Automobile</option>
                <option value="Incendie (MRH)">Incendie (MRH)</option>
                <option value="Individuelle Accident">Individuelle Accident</option>
                <option value="Santé Groupe">Santé Groupe</option>
                <option value="Transport">Transport</option>
                <option value="Voyage">Voyage</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Taux en Pourcentage (%)</label>
              <input
                type="number"
                step="0.1"
                className="form-control"
                value={taxeForm.taux}
                onChange={(e) => setTaxeForm({ ...taxeForm, taux: Number(e.target.value) })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Assiette Fiscale</label>
              <input
                type="text"
                className="form-control"
                value={taxeForm.type_assiette}
                onChange={(e) => setTaxeForm({ ...taxeForm, type_assiette: e.target.value })}
                placeholder="Ex: Prime Nette"
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary">Enregistrer la Taxe</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default ParametrageTaxesPage;
