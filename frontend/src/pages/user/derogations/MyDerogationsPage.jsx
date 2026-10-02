import React, { useState, useEffect } from 'react';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { approvalApi } from '../../../api/endpoints';
import { dataStore } from '../../../api/dataStore';
import { useToast } from '../../../context/ToastContext';
import { KeyRound, Plus, ShieldCheck, Copy, Loader2 } from 'lucide-react';
import { formatDate } from '../../../utils/dateUtils';

const normalizeDemande = (d) => {
  const isApproved = d.statut === 'APPROUVEE' || d.statut === 'VALIDEE';
  const isRejected = d.statut === 'REJETEE';
  return {
    ...d,
    id: d.id,
    type_label: d.type_operation === 'ANNUL_ENC' ? "Annulation d'encaissement" : (d.type_operation || 'Dérogation'),
    objet: d.objet || d.motif || 'Dérogation opérationnelle',
    date_demande: d.date_demande ? d.date_demande.substring(0, 16).replace('T', ' ') : new Date().toISOString().substring(0, 10),
    approbateur_nom: d.valideur ? `${d.valideur.first_name || ''} ${d.valideur.last_name || d.valideur.email || ''}`.trim() : 'Direction Uranus',
    statut_label: isApproved ? 'Approuvée' : (isRejected ? 'Rejetée' : 'En attente'),
    statut_badge: isApproved ? 'emerald' : (isRejected ? 'rose' : 'amber'),
    code_jeton: d.code_jeton || (d.jeton && d.jeton.code ? d.jeton.code : null),
  };
};

export const MyDerogationsPage = () => {
  const [derogations, setDerogations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { success, error: toastError, info } = useToast();

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await approvalApi.getDemandes();
      if (data && Array.isArray(data)) {
        setDerogations(data.map(normalizeDemande));
      }
    } catch (err) {
      console.error('Erreur chargement dérogations Django:', err);
      // Fallback local dataStore if needed
      setDerogations(dataStore.getDerogations());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const [typeOperation, setTypeOperation] = useState('ANNUL_ENC');
  const [objet, setObjet] = useState('');
  const [motif, setMotif] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await approvalApi.createDemande({
        type_operation: typeOperation,
        objet: objet,
        motif: motif,
        app_label: 'production',
        model_name: 'encaissement',
        object_id: 1,
      });
      success("Votre demande d'autorisation a été transmise avec succès.");
      await loadData();
    } catch (err) {
      console.error('Erreur création dérogation Django:', err);
      // Enregistrement local en cas de besoin
      const newDemande = {
        type_operation: typeOperation,
        type_label: typeOperation === 'ANNUL_ENC' ? "Annulation d'encaissement" : 'Remise commerciale exceptionnelle',
        objet,
        demandeur_nom: 'Moi (Opérateur)',
        date_demande: new Date().toISOString().replace('T', ' ').substring(0, 16),
        approbateur_nom: 'Franck Gnogouri (Direction)',
        statut: 'PENDING',
        statut_label: 'En attente',
        statut_badge: 'amber',
        code_jeton: null,
      };
      dataStore.saveDerogation(newDemande);
      setDerogations((prev) => [newDemande, ...prev]);
      if (toastError) toastError("Votre demande n'a pas pu être enregistrée. Veuillez réessayer.");
    }

    setIsModalOpen(false);
    setObjet('');
    setMotif('');
  };

  const copyToken = (token) => {
    navigator.clipboard.writeText(token);
    info(`Jeton ${token} copié dans le presse-papier !`);
  };

  const columns = [
    {
      header: "Type d'Opération",
      accessor: 'type_label',
      render: (row) => <strong style={{ color: '#fff' }}>{row.type_label}</strong>,
    },
    { header: 'Objet de la Dérogation', accessor: 'objet' },
    { header: 'Date Soumission', accessor: 'date_demande', render: (r) => formatDate(r.date_demande) },
    { header: 'Approbateur Attitré', accessor: 'approbateur_nom' },
    {
      header: 'Statut',
      accessor: 'statut_label',
      render: (row) => <StatusBadge label={row.statut_label} color={row.statut_badge} />,
    },
    {
      header: 'Jeton Validé',
      render: (row) =>
        row.code_jeton ? (
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: '#34d399' }}
            onClick={() => copyToken(row.code_jeton)}
            title="Cliquez pour copier le jeton d'autorisation"
          >
            <Copy size={12} /> {row.code_jeton}
          </button>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Non disponible</span>
        ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <KeyRound size={26} color="#fbbf24" />
            Mes Demandes de Dérogation & Jetons
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Workflow d'approbation pour les opérations exceptionnelles nécessitant un accord hiérarchique.
          </p>
        </div>

        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={16} />
          <span>Nouvelle Demande d'Autorisation</span>
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <DataTable columns={columns} data={derogations} searchPlaceholder="Rechercher par objet, statut ou type..." />
      </div>

      {/* Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Soumission d'une Dérogation">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Type d'opération exceptionnelle</label>
            <select className="form-control" value={typeOperation} onChange={(e) => setTypeOperation(e.target.value)}>
              <option value="ANNUL_ENC">Annulation d'un encaissement validé</option>
              <option value="AVENANT_RETROACTIF">Avenant avec date d'effet rétroactive</option>
              <option value="DEROG_TARIF">Dérogation tarifaire hors barème CIMA</option>
              <option value="REMISE_FLOTTE">Remise commerciale &gt; 10% (Flotte / Particulier)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Objet résumé</label>
            <input
              type="text"
              className="form-control"
              required
              placeholder="Ex: Annulation quittance suite chèque en bois..."
              value={objet}
              onChange={(e) => setObjet(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Motif détaillé</label>
            <textarea
              className="form-control"
              rows={4}
              required
              placeholder="Expliquez la situation motivant la demande d'exception..."
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary">
              Transmettre à la Direction
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default MyDerogationsPage;
