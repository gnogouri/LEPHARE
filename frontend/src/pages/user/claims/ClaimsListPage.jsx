import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { dataStore } from '../../../api/dataStore';
import { claimsApi, conventionsApi, contractApi, settingsApi } from '../../../api/endpoints';
import { MetricCard } from '../../../components/common/MetricCard';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { DeleteConfirmModal } from '../../../components/common/DeleteConfirmModal';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { canUser, validateBusinessRule } from '../../../utils/rbac';
import { sortUniqueBy, trierParLibelle } from '../../../utils/sortUtils';
import { formatDate } from '../../../utils/dateUtils';
import {
  AlertTriangle,
  ShieldCheck,
  CreditCard,
  Plus,
  Search,
  Filter,
  FileText,
  Clock,
  CheckCircle,
  Eye,
  Building,
  ArrowUpRight,
  HelpCircle,
  Trash2,
  Archive,
} from 'lucide-react';

export const ClaimsListPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [conventions, setConventions] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [deletingClaim, setDeletingClaim] = useState(null);
  const [deleteValidation, setDeleteValidation] = useState({ allowed: true });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedCompany, setSelectedCompany] = useState('ALL');
  const [showDeclareModal, setShowDeclareModal] = useState(false);
  const [allCompanies, setAllCompanies] = useState([]);

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      claimsApi.getClaims().catch(() => []),
      conventionsApi.getConventions().catch(() => []),
      contractApi.getContracts().catch(() => []),
      settingsApi.getCompanies().catch(() => []),
    ])
      .then(([claimsData, cnvData, contractsData, companiesData]) => {
        if (!isMounted) return;
        if (companiesData && Array.isArray(companiesData)) {
          setAllCompanies(companiesData.map(c => c.RaisonSociale || c.nom).filter(Boolean));
        }
        if (!isMounted) return;
        if (claimsData && Array.isArray(claimsData) && claimsData.length > 0) {
          setClaims(claimsData);
        }
        if (cnvData && Array.isArray(cnvData) && cnvData.length > 0) {
          setConventions(cnvData);
        }
        if (contractsData && Array.isArray(contractsData) && contractsData.length > 0) {
          setContracts(contractsData);
        }
      })
      .catch((err) => console.error('API error:', err))
      .finally(() => { if (isMounted) setLoading(false); });

    return dataStore.subscribe((key) => {
      if (key === 'uranus_claims' || key === 'uranus_conventions' || key === 'uranus_contracts') {
        refreshData();
      }
    });
  }, []);

  // Form for new claim
  const [newClaim, setNewClaim] = useState({
    police_num: contracts[0]?.numeropolice || 'POL-2026-001',
    nature: 'Collision matériel automobile',
    date_survenance: '2026-09-05',
    lieu: 'Abidjan Cocody',
    montant_reclame: 1250000,
    tiers_implique: 'M. Soro Ibrahim (Assuré SUNU)',
    description: 'Choc arrière au feu tricolore du carrefour Duncan. Dégâts constatés sur le pare-choc et le coffre.',
  });

  const handleCreateClaim = async (e) => {
    e.preventDefault();
    const relatedContract = contracts.find((c) => c.numeropolice === newClaim.police_num) || contracts[0] || { client_nom: 'Assuré LE PHARE', compagnie: 'NSIA Assurances' };
    const relatedConvention = conventions.find((cnv) => cnv.compagnie === relatedContract.compagnie) || conventions[0];

    const amount = Number(newClaim.montant_reclame);
    const delegationOk = amount <= (relatedConvention?.plafond_delegation_sinistre || relatedConvention?.seuil_delegation_sinistre || 5000000);

    const payload = {
      police_num: newClaim.police_num,
      assure_nom: relatedContract.client_nom,
      compagnie: relatedContract.compagnie,
      nature: newClaim.nature,
      date_survenance: newClaim.date_survenance,
      date_declaration: new Date().toISOString().split('T')[0],
      lieu: newClaim.lieu,
      montant_reclame: amount,
      montant_indemnise: 0,
      statut: 'Déclaré',
      delegation_respectee: delegationOk,
      expert_assigne: 'Cabinet d Expertises CIMA CI',
      pieces_justificatives: [
        { nom: 'Déclaration de sinistre signée', recu: true },
        { nom: 'Constat amiable d accident', recu: true },
        { nom: 'Permis de conduire conducteur', recu: true },
        { nom: 'Devis estimatif de réparation', recu: false },
        { nom: 'Rapport d expertise contradictoire', recu: false },
        { nom: 'Quittance d indemnité signée', recu: false },
      ],
      recours_info: {
        compagnie_adverse: 'SUNU Assurances CI',
        montant: Math.round(amount * 0.8),
        statut: 'En attente recours',
      },
      historique_evenements: [
        { date: new Date().toISOString().split('T')[0], action: 'Déclaration enregistrée dans le système' },
      ],
    };

    const saved = dataStore.saveClaim(payload);
    try {
      await claimsApi.createClaim(payload);
    } catch (err) {
      console.warn('API create claim fallback to dataStore');
    }

    setClaims(dataStore.getClaims());
    setShowDeclareModal(false);
    success(`Le sinistre ${saved.numero_sinistre} a été déclaré et enregistré avec succès.`);
  };

  // Filtered claims
  const filteredClaims = claims.filter((c) => {
    const matchSearch =
      c.numero_sinistre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.assure_nom.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.police_num.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = selectedStatus === 'ALL' || c.statut === selectedStatus;
    const matchComp = selectedCompany === 'ALL' || (c.compagnie && (c.compagnie.toLowerCase().includes(selectedCompany.toLowerCase()) || selectedCompany.toLowerCase().includes(c.compagnie.toLowerCase())));
    return matchSearch && matchStatus && matchComp;
  });

  // Cockpit metrics
  const totalClaimsCount = filteredClaims.length;
  const inProgressClaims = filteredClaims.filter((c) => c.statut !== 'Clos').length;
  const totalIndemnites = filteredClaims.reduce((acc, c) => acc + (parseFloat(c.montant_indemnise) || 0), 0);
  const totalRecours = filteredClaims.reduce((acc, c) => acc + (parseFloat(c.recours_compagnie_adverse?.montant || c.recours_info?.montant_recours) || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <span className="badge badge-warning">Module H – Sinistres Délégués</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Conformité CIMA & Mandats Compagnies</span>
          </div>
          <h1 className="title-xl">Suivi des sinistres</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Sinistres déclarés et gérés pour le compte des compagnies.
          </p>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => setShowDeclareModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Plus size={16} />
          <span>Déclarer un Sinistre</span>
        </button>
      </div>

      {/* Delegation Thresholds Banner */}
      <div
        className="glass-panel"
        style={{
          padding: '1rem 1.25rem',
          borderRadius: 'var(--radius-lg)',
          background: 'rgba(37, 99, 235, 0.08)',
          border: '1px solid rgba(37, 99, 235, 0.25)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <ShieldCheck size={26} color="#60a5fa" />
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              Mandats de Gestion Déléguée LE PHARE Actifs
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Plafonds de règlement direct autorisés par convention : Allianz CI (5M FCFA) • NSIA CI (3.5M FCFA) • SUNU CI (5M FCFA) • AMSA CI (3.5M FCFA).
            </div>
          </div>
        </div>
        <button
          className="btn btn-secondary"
          style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
          onClick={() => navigate('/admin/conventions')}
        >
          Voir les Conventions
        </button>
      </div>

      {/* Cockpit Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <MetricCard
          title="Dossiers en Instruction"
          value={inProgressClaims}
          subtitle="Sur 4 dossiers déclarés"
          icon={<Clock size={22} color="#fbbf24" />}
        />
        <MetricCard
          title="Indemnités Réglées Déléguées"
          value={`${(totalIndemnites / 1000000).toFixed(2)} M FCFA`}
          subtitle="Quittances directes LE PHARE"
          icon={<CreditCard size={22} color="#34d399" />}
        />
        <MetricCard
          title="Recours Subrogatoires Actifs"
          value={`${(totalRecours / 1000000).toFixed(2)} M FCFA`}
          subtitle="À recouvrer auprès des confrères"
          icon={<ArrowUpRight size={22} color="#818cf8" />}
        />
        <MetricCard
          title="Délai Moyen de Règlement"
          value="12 jours"
          subtitle="Objectif CIMA : < 30 jours"
          icon={<CheckCircle size={22} color="#60a5fa" />}
        />
      </div>

      {/* Filters */}
      <div className="glass-panel" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '280px' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: '340px' }}>
            <Search size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="form-control"
              style={{ paddingLeft: '2.5rem', fontSize: '0.875rem' }}
              placeholder="Rechercher par N° sinistre, assuré, police..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Filter size={15} color="var(--text-muted)" />
            <select
              className="form-control"
              style={{ fontSize: '0.85rem', width: '160px' }}
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="ALL">Tous statuts</option>
              <option value="Clos">Clos</option>
              <option value="Déclaré">Déclaré</option>
              <option value="En cours d instruction">En instruction</option>
              <option value="Expertise terminée">Expertise terminée</option>
              <option value="Règlement validé">Règlement validé</option>
            </select>
          </div>

                      <select
              className="form-control"
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              style={{ minWidth: '180px', fontSize: '0.875rem' }}
            >
              <option value="ALL">Toutes compagnies ({allCompanies.length > 0 ? allCompanies.length : 33})</option>
              {trierParLibelle(allCompanies.length > 0 ? allCompanies : [...new Set(claims.map((c) => c.compagnie).filter(Boolean))], (cie) => cie).map((cie) => (
                <option key={cie} value={cie}>{cie}</option>
              ))}
            </select>
        </div>
      </div>

      {/* Claims Table */}
      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>N° Sinistre</th>
                <th>Date Survenance</th>
                <th>Assuré & N° Police</th>
                <th>Compagnie Partenaire</th>
                <th>Nature du Sinistre</th>
                <th>Montant Réclamé</th>
                <th>Indemnité Accordée</th>
                <th>Délégation LE PHARE</th>
                <th>Statut Dossier</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredClaims.length === 0 ? (
                <tr>
                  <td colSpan="10" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    Aucun sinistre ne correspond aux filtres sélectionnés.
                  </td>
                </tr>
              ) : (
                filteredClaims.map((claim) => (
                  <tr key={claim.id}>
                    <td>
                      <strong style={{ color: '#f87171' }}>{claim.numero_sinistre}</strong>
                    </td>
                    <td>{formatDate(claim.date_survenance)}</td>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{claim.assure_nom}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{claim.police_num}</div>
                    </td>
                    <td>
                      <span className="badge badge-neutral">{claim.compagnie}</span>
                    </td>
                    <td>{claim.nature}</td>
                    <td>{claim.montant_reclame?.toLocaleString('fr-FR')} FCFA</td>
                    <td>
                      <strong style={{ color: claim.montant_indemnise > 0 ? '#34d399' : 'var(--text-muted)' }}>
                        {claim.montant_indemnise > 0 ? `${claim.montant_indemnise.toLocaleString('fr-FR')} FCFA` : 'En chiffrage'}
                      </strong>
                    </td>
                    <td>
                      <span className={`badge ${claim.delegation_respectee ? 'badge-success' : 'badge-warning'}`}>
                        {claim.delegation_respectee ? 'Conforme Mandat' : 'Accord Cie Requis'}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          claim.statut === 'Règlement validé'
                            ? 'badge-success'
                            : claim.statut === 'Expertise terminée'
                            ? 'badge-info'
                            : 'badge-warning'
                        }`}
                      >
                        {claim.statut}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                          onClick={() => navigate(`/user/claims/detail?id=${claim.id}`)}
                          title="Instruire le dossier et gérer les expertises"
                        >
                          <Eye size={13} />
                          <span>Instruire</span>
                        </button>

                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{
                            padding: '0.3rem 0.55rem',
                            fontSize: '0.75rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            color: '#38bdf8',
                            borderColor: 'rgba(56, 189, 248, 0.25)',
                          }}
                          onClick={() => {
                            const check = validateBusinessRule('delete', 'claims', claim, dataStore);
                            setDeleteValidation(check);
                            setDeletingClaim(claim);
                          }}
                          title="Archiver / Classer sans suite ce dossier (Conformité CIMA)"
                        >
                          <Archive size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Déclaration de Sinistre */}
      <Modal
        isOpen={showDeclareModal}
        onClose={() => setShowDeclareModal(false)}
        title="Déclaration d'un Sinistre"
        subtitle="Enregistrement dans le cadre du mandat de gestion déléguée CIMA de LE PHARE."
        maxWidth="620px"
      >
        <form onSubmit={handleCreateClaim} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Police d'Assurance Rattachée *</label>
            <select
              className="form-control"
              value={newClaim.police_num}
              onChange={(e) => setNewClaim({ ...newClaim, police_num: e.target.value })}
              required
            >
              {sortUniqueBy(contracts, (c) => c.client_nom || c.numeropolice).map((c) => (
                <option key={c.id} value={c.numeropolice}>
                  {c.numeropolice} – {c.client_nom} ({c.compagnie})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Date de Survenance *</label>
              <input
                type="date"
                className="form-control"
                required
                value={newClaim.date_survenance}
                onChange={(e) => setNewClaim({ ...newClaim, date_survenance: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Lieu du Sinistre</label>
              <input
                type="text"
                className="form-control"
                placeholder="ex: Boulevard Valéry Giscard d Estaing"
                value={newClaim.lieu}
                onChange={(e) => setNewClaim({ ...newClaim, lieu: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Nature de l'Événement</label>
              <select
                className="form-control"
                value={newClaim.nature}
                onChange={(e) => setNewClaim({ ...newClaim, nature: e.target.value })}
              >
                <option value="Bris de glace">Bris de glace</option>
                <option value="Collision matériel automobile">Collision matériel automobile</option>
                <option value="Dégât des eaux">Dégât des eaux</option>
                <option value="Incendie et explosion">Incendie et explosion</option>
                <option value="Responsabilité Civile Exploitation">RC Exploitation</option>
                <option value="Vol avec effraction">Vol avec effraction</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Chiffrage Préliminaire (FCFA)</label>
              <input
                type="number"
                className="form-control"
                required
                value={newClaim.montant_reclame}
                onChange={(e) => setNewClaim({ ...newClaim, montant_reclame: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Tiers Identifié / Responsable (le cas échéant)</label>
            <input
              type="text"
              className="form-control"
              placeholder="Nom du tiers et compagnie d assurance adverse pour recours"
              value={newClaim.tiers_implique}
              onChange={(e) => setNewClaim({ ...newClaim, tiers_implique: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Circonstances & Description des Dommages</label>
            <textarea
              className="form-control"
              rows="3"
              required
              placeholder="Circonstances détaillées du sinistre..."
              value={newClaim.description}
              onChange={(e) => setNewClaim({ ...newClaim, description: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowDeclareModal(false)}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary">
              Ouvrir le Dossier Sinistre
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Suppression / Classement Sans Suite CIMA */}
      <DeleteConfirmModal
        isOpen={!!deletingClaim}
        onClose={() => setDeletingClaim(null)}
        itemType="sinistre"
        itemName={`Dossier ${deletingClaim?.numero_sinistre} (${deletingClaim?.nature})`}
        itemCode={deletingClaim?.numero_sinistre}
        validation={deleteValidation}
        alternativeLabel="Classer Sans Suite"
        onAlternativeAction={() => {
          if (deletingClaim) {
            dataStore.closeClaimWithoutAction(deletingClaim.id, {
              motif: 'Classé sans suite administrativement',
            });
            setClaims(dataStore.getClaims());
            success(`Dossier ${deletingClaim.numero_sinistre} classé sans suite.`);
            setDeletingClaim(null);
          }
        }}
        onConfirm={() => {
          if (deletingClaim) {
            try {
              dataStore.deleteClaim(deletingClaim.id);
              setClaims(dataStore.getClaims());
              success(`Dossier sinistre ${deletingClaim.numero_sinistre} supprimé.`);
              setDeletingClaim(null);
            } catch (err) {
              toastError(err.message);
            }
          }
        }}
      />
    </div>
  );
};

export default ClaimsListPage;
