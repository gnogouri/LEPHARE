import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../../../components/common/Modal';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { reportingApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { exportToPdf, exportToExcel, printEtatDecisionnelDocument } from '../../../utils/exportUtils';
import {
  GitBranch,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  Download,
  Eye,
  Printer,
  Calendar,
  Loader2,
  Search,
  Layers,
  Table as TableIcon,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText
} from 'lucide-react';
import { nomCabinet } from '../../../utils/parametrage';

const URL_OPTIONS = ['DETAIL', 'LISTE', 'VALIDATION', 'REJET', 'CLOTURE'];

const emptyForm = { code_etat: '', libelle_etat: '', url: 'DETAIL', actif: true };

const defaultDateDebut = '2020-01-01';
const defaultDateFin = new Date().toISOString().slice(0, 10);

export const DecisionalStatesPage = () => {
  const { success, error: toastError } = useToast();

  const [etats, setEtats] = useState([]);
  const [loading, setLoading] = useState(true);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('PDF');
  const [exportScope, setExportScope] = useState('ALL');

  // Modal Contenu (Bordereau / Récapitulatif)
  const [isContenuOpen, setIsContenuOpen] = useState(false);
  const [contenuTarget, setContenuTarget] = useState(null);
  const [contenuDateDebut, setContenuDateDebut] = useState(defaultDateDebut);
  const [contenuDateFin, setContenuDateFin] = useState(defaultDateFin);
  const [contenuTypeEtat, setContenuTypeEtat] = useState(2); // 1 = Bordereau, 2 = Récap
  const [contenuLoading, setContenuLoading] = useState(false);
  const [contenuDossiers, setContenuDossiers] = useState([]);
  const [contenuFormat, setContenuFormat] = useState('XLSX');
  const [contenuSearch, setContenuSearch] = useState('');
  const [contenuViewMode, setContenuViewMode] = useState('flat'); // 'flat' | 'grouped'
  const [expandedCompagnies, setExpandedCompagnies] = useState({});

  const loadEtats = async () => {
    setLoading(true);
    try {
      const data = await reportingApi.getDecisionnel();
      setEtats(Array.isArray(data) ? data : []);
    } catch (err) {
      toastError('Impossible de charger les états décisionnels. Veuillez réessayer.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEtats();
  }, []);

  const totalEtats = etats.length;
  const actifsCount = etats.filter((e) => e.actif).length;
  const inactifsCount = totalEtats - actifsCount;

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createForm.code_etat.trim() || !createForm.libelle_etat.trim()) return;
    setIsSaving(true);
    try {
      await reportingApi.createDecisionnel({
        code_etat: createForm.code_etat.trim().toUpperCase(),
        libelle_etat: createForm.libelle_etat.trim(),
        url: createForm.url,
        actif: createForm.actif,
      });
      setIsCreateOpen(false);
      setCreateForm(emptyForm);
      success('État décisionnel créé avec succès.');
      loadEtats();
    } catch (err) {
      toastError(err?.response?.data?.code_etat?.[0] || err?.response?.data?.error || 'Erreur lors de la création.');
    } finally {
      setIsSaving(false);
    }
  };

  const openEdit = (etat) => {
    setEditTarget(etat);
    setEditForm({
      code_etat: etat.code_etat || '',
      libelle_etat: etat.libelle_etat || '',
      url: etat.url || 'DETAIL',
      actif: Boolean(etat.actif),
    });
    setIsEditOpen(true);
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editTarget || !editForm.code_etat.trim() || !editForm.libelle_etat.trim()) return;
    const id = editTarget?.id_etat ?? editTarget?.idetat ?? editTarget?.id;
    if (!id) return;
    setIsSaving(true);
    try {
      await reportingApi.updateDecisionnel(id, {
        code_etat: editForm.code_etat.trim().toUpperCase(),
        libelle_etat: editForm.libelle_etat.trim(),
        url: editForm.url,
        actif: editForm.actif,
      });
      setIsEditOpen(false);
      setEditTarget(null);
      success('État décisionnel modifié avec succès.');
      loadEtats();
    } catch (err) {
      toastError(err?.response?.data?.code_etat?.[0] || err?.response?.data?.error || 'Erreur lors de la modification.');
    } finally {
      setIsSaving(false);
    }
  };

  const openDelete = (etat) => {
    setDeleteTarget(etat);
    setIsDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget?.id_etat ?? deleteTarget?.idetat ?? deleteTarget?.id;
    if (!id) return;
    setIsDeleting(true);
    try {
      await reportingApi.deleteDecisionnel(id);
      setIsDeleteOpen(false);
      setDeleteTarget(null);
      success('État décisionnel supprimé avec succès.');
      loadEtats();
    } catch (err) {
      toastError(err?.response?.data?.error || 'Erreur lors de la suppression.');
      setIsDeleteOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExport = (e) => {
    e.preventDefault();

    const filteredData =
      exportScope === 'ACTIFS' ? etats.filter((r) => r.actif) :
      exportScope === 'INACTIFS' ? etats.filter((r) => !r.actif) :
      etats;

    const headers = ['Code', 'Libellé de l\'État Décisionnel', 'Destination / Action', 'Statut'];
    const rows = filteredData.map((r) => [
      r.code_etat || '-',
      r.libelle_etat || '-',
      r.url || '-',
      r.actif ? 'Actif' : 'Inactif',
    ]);

    const filename = `Etats_Decisionnels_${exportScope}`;
    const title = 'RÉFÉRENTIEL DES ÉTATS DÉCISIONNELS';
    const subtitle = 'États de gestion : souscription, contrats et sinistres';
    const metadata = {
      'Organisme': nomCabinet(),
      'Périmètre': exportScope === 'ACTIFS' ? 'États actifs uniquement' : exportScope === 'INACTIFS' ? 'États inactifs uniquement' : 'Tous les états',
      'Total États': String(filteredData.length),
      'Date d\'édition': new Date().toLocaleDateString('fr-FR'),
    };

    if (exportFormat === 'XLSX') {
      exportToExcel({ filename, title, subtitle, metadata, headers, rows });
    } else {
      exportToPdf({ filename, title, subtitle, metadata, headers, rows });
    }

    success(exportFormat === 'PDF'
      ? 'Aperçu PDF des états décisionnels ouvert. Utilisez « Imprimer / PDF » pour l’enregistrer.'
      : `États décisionnels (${exportFormat}) téléchargés avec succès.`);
    setIsExportOpen(false);
  };

  const openContenu = (etat) => {
    setContenuTarget(etat);
    setContenuDateDebut(defaultDateDebut);
    setContenuDateFin(defaultDateFin);
    // Déterminer automatiquement le type d'état
    const code = (etat?.code_etat || '').toUpperCase();
    const isDetail = code.startsWith('D') || (etat?.libelle_etat || '').toLowerCase().includes('détail');
    const initialType = isDetail ? 1 : 2;
    setContenuTypeEtat(initialType);
    setContenuDossiers([]);
    setContenuSearch('');
    setIsContenuOpen(true);
    loadContenu(etat, defaultDateDebut, defaultDateFin, initialType);
  };

  const loadContenu = async (etat, dateDebut, dateFin, typeEtat) => {
    if (!etat) return;
    const id = etat?.id_etat ?? etat?.idetat ?? etat?.id;
    if (!id) return;
    setContenuLoading(true);
    try {
      const result = await reportingApi.getDecisionnelContenu(id, dateDebut, dateFin, typeEtat);
      const dossiers = Array.isArray(result?.Data) ? result.Data : [];
      setContenuDossiers(dossiers);
      if (result?.Status && result.Status !== 'Succès' && result.Status !== 'Succes') {
        toastError(result?.Data || 'Impossible de charger le contenu. Veuillez réessayer.');
      }
    } catch (err) {
      toastError(err?.response?.data?.Data || 'Impossible de charger le contenu de cet état. Veuillez réessayer.');
      setContenuDossiers([]);
    } finally {
      setContenuLoading(false);
    }
  };

  // Filtrage local pour la recherche dans le modal
  const filteredContenuDossiers = useMemo(() => {
    if (!contenuSearch.trim()) return contenuDossiers;
    const s = contenuSearch.toLowerCase().trim();
    return contenuDossiers.filter((d) => {
      const police = (d.numero_police || '').toLowerCase();
      const quittance = (d.numero_quittance || '').toLowerCase();
      const client = (d.nom_client || '').toLowerCase();
      const compagnie = (d.nom_compagnie || '').toLowerCase();
      const produit = (d.libelle_produit || d.produit || '').toLowerCase();
      return police.includes(s) || quittance.includes(s) || client.includes(s) || compagnie.includes(s) || produit.includes(s);
    });
  }, [contenuDossiers, contenuSearch]);

  // Calcul des totaux financiers
  const totals = useMemo(() => {
    let primeNette = 0;
    let accessoire = 0;
    let taxe = 0;
    let primeTtc = 0;
    let commission = 0;

    filteredContenuDossiers.forEach((d) => {
      primeNette += Number(d.prime_nette || 0);
      accessoire += Number(d.accessoire || 0);
      taxe += Number(d.taxe || 0);
      primeTtc += Number(d.prime_ttc || 0);
      commission += Number(d.commission_intermediaire || 0);
    });

    return { primeNette, accessoire, taxe, primeTtc, commission };
  }, [filteredContenuDossiers]);

  // Groupement hiérarchique : Compagnie > Client > Branche
  const groupedData = useMemo(() => {
    const groups = {};
    filteredContenuDossiers.forEach((d) => {
      const cie = d.nom_compagnie || 'Compagnie non spécifiée';
      const cli = d.nom_client || 'Client Inconnu';
      const prod = d.libelle_produit || d.produit || 'Branche Principale';

      if (!groups[cie]) {
        groups[cie] = {
          nom_compagnie: cie,
          clients: {},
          totals: { primeNette: 0, accessoire: 0, taxe: 0, primeTtc: 0, commission: 0 },
        };
      }

      if (!groups[cie].clients[cli]) {
        groups[cie].clients[cli] = {
          nom_client: cli,
          produits: {},
          totals: { primeNette: 0, accessoire: 0, taxe: 0, primeTtc: 0, commission: 0 },
        };
      }

      if (!groups[cie].clients[cli].produits[prod]) {
        groups[cie].clients[cli].produits[prod] = {
          libelle_produit: prod,
          items: [],
          totals: { primeNette: 0, accessoire: 0, taxe: 0, primeTtc: 0, commission: 0 },
        };
      }

      const pNette = Number(d.prime_nette || 0);
      const acc = Number(d.accessoire || 0);
      const tx = Number(d.taxe || 0);
      const pTtc = Number(d.prime_ttc || 0);
      const com = Number(d.commission_intermediaire || 0);

      groups[cie].totals.primeNette += pNette;
      groups[cie].totals.accessoire += acc;
      groups[cie].totals.taxe += tx;
      groups[cie].totals.primeTtc += pTtc;
      groups[cie].totals.commission += com;

      groups[cie].clients[cli].totals.primeNette += pNette;
      groups[cie].clients[cli].totals.accessoire += acc;
      groups[cie].clients[cli].totals.taxe += tx;
      groups[cie].clients[cli].totals.primeTtc += pTtc;
      groups[cie].clients[cli].totals.commission += com;

      groups[cie].clients[cli].produits[prod].totals.primeNette += pNette;
      groups[cie].clients[cli].produits[prod].totals.accessoire += acc;
      groups[cie].clients[cli].produits[prod].totals.taxe += tx;
      groups[cie].clients[cli].produits[prod].totals.primeTtc += pTtc;
      groups[cie].clients[cli].produits[prod].totals.commission += com;

      groups[cie].clients[cli].produits[prod].items.push(d);
    });

    return groups;
  }, [filteredContenuDossiers]);

  const toggleCompagnie = (cie) => {
    setExpandedCompagnies((prev) => ({ ...prev, [cie]: !prev[cie] }));
  };

  const handlePrintContenu = () => {
    printEtatDecisionnelDocument({
      etat: contenuTarget,
      dateDebut: contenuDateDebut,
      dateFin: contenuDateFin,
      typeEtat: contenuTypeEtat,
      dossiers: filteredContenuDossiers,
    });
  };

  const handleExportContenu = (e) => {
    e?.preventDefault();
    const typeLabel = Number(contenuTypeEtat) === 1 ? 'Bordereau_Detail' : 'Recapitulatif';
    const filename = `${typeLabel}_Emissions_${contenuTarget?.code_etat || 'C01'}_${contenuDateDebut}_${contenuDateFin}`;
    const title = `${Number(contenuTypeEtat) === 1 ? 'BORDEREAU DES ÉMISSIONS' : 'RÉCAPITULATIF DES ÉMISSIONS'} : ${contenuTarget?.libelle_etat || ''}`;
    const subtitle = `Période du ${contenuDateDebut} au ${contenuDateFin} • Type : ${Number(contenuTypeEtat) === 1 ? 'Détail' : 'Récapitulatif'}`;

    const metadata = {
      'Organisme': nomCabinet(),
      'État Décisionnel': `${contenuTarget?.code_etat} - ${contenuTarget?.libelle_etat}`,
      'Période': `Du ${contenuDateDebut} au ${contenuDateFin}`,
      'Total Lignes': String(filteredContenuDossiers.length),
      'Prime TTC Totale': `${totals.primeTtc.toLocaleString('fr-FR')} FCFA`,
      'Commissions Totales': `${totals.commission.toLocaleString('fr-FR')} FCFA`,
      'Date d\'édition': new Date().toLocaleDateString('fr-FR'),
    };

    const headers = [
      'Compagnie',
      'Client',
      'Branche',
      'N° Police',
      'N° Quittance',
      'N° Avenant',
      'Date Émission',
      'Date Effet',
      'Date Exp.',
      'Prime Nette (F)',
      'Accessoire (F)',
      'Taxe (F)',
      'Prime TTC (F)',
      'Comm. Interm. (F)',
    ];

    const rows = filteredContenuDossiers.map((d) => [
      d.nom_compagnie || '-',
      d.nom_client || '-',
      d.libelle_produit || d.produit || '-',
      d.numero_police || '-',
      d.numero_quittance || '-',
      d.numero_avenant || '-',
      d.date_emission ? new Date(d.date_emission).toLocaleDateString('fr-FR') : '-',
      d.date_effet ? new Date(d.date_effet).toLocaleDateString('fr-FR') : '-',
      d.date_expiration ? new Date(d.date_expiration).toLocaleDateString('fr-FR') : '-',
      Number(d.prime_nette || 0).toLocaleString('fr-FR'),
      Number(d.accessoire || 0).toLocaleString('fr-FR'),
      Number(d.taxe || 0).toLocaleString('fr-FR'),
      Number(d.prime_ttc || 0).toLocaleString('fr-FR'),
      Number(d.commission_intermediaire || 0).toLocaleString('fr-FR'),
    ]);

    const totalsRow = [
      'TOTAL GÉNÉRAL',
      `${filteredContenuDossiers.length} lignes`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      Number(totals.primeNette).toLocaleString('fr-FR'),
      Number(totals.accessoire).toLocaleString('fr-FR'),
      Number(totals.taxe).toLocaleString('fr-FR'),
      Number(totals.primeTtc).toLocaleString('fr-FR'),
      Number(totals.commission).toLocaleString('fr-FR'),
    ];

    if (contenuFormat === 'XLSX') {
      exportToExcel({ filename, title, subtitle, metadata, headers, rows });
    } else {
      exportToPdf({ filename, title, subtitle, metadata, headers, rows, totals: totalsRow });
    }

    success(contenuFormat === 'PDF'
      ? 'Aperçu PDF ouvert. Utilisez « Imprimer / PDF » pour l’enregistrer.'
      : `Document (${contenuFormat}) téléchargé avec succès.`);
  };

  const columns = [
    {
      header: 'Code',
      accessor: 'code_etat',
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: '#60a5fa', fontWeight: 700, fontSize: '0.82rem' }}>
          {r.code_etat}
        </span>
      ),
    },
    {
      header: 'Libellé de l\'État Décisionnel',
      accessor: 'libelle_etat',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <GitBranch size={14} style={{ color: '#a78bfa', flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.libelle_etat}</span>
        </div>
      ),
    },
    {
      header: 'Destination / Action',
      accessor: 'url',
      render: (r) => (
        <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '6px', background: 'rgba(99,102,241,0.12)', color: '#a5b4fc' }}>
          {r.url}
        </span>
      ),
    },
    {
      header: 'Statut',
      accessor: 'actif',
      render: (r) =>
        r.actif ? (
          <StatusBadge label="Actif" color="emerald" />
        ) : (
          <StatusBadge label="Inactif" color="gray" />
        ),
    },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            className="btn btn-primary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)', color: '#fff', border: 'none' }}
            onClick={() => openContenu(r)}
          >
            <Eye size={13} /> Contenu / Bordereau
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            onClick={() => openEdit(r)}
          >
            <Edit2 size={13} /> Modifier
          </button>
          <button
            className="btn"
            style={{
              fontSize: '0.75rem', padding: '0.25rem 0.55rem',
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              background: 'rgba(239,68,68,0.12)', color: '#f87171',
              border: '1px solid rgba(239,68,68,0.3)',
            }}
            onClick={() => openDelete(r)}
          >
            <Trash2 size={13} /> Supprimer
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <GitBranch size={22} color="#a78bfa" />
            États de gestion
          </h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem', margin: '0.3rem 0 0 0' }}>
            Tableaux de suivi : émissions, commissions, encaissements.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.65rem' }}>
          <button
            className="btn btn-secondary"
            onClick={loadEtats}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
          >
            <RefreshCw size={14} /> Actualiser
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setIsExportOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
          >
            <Download size={14} /> Exporter
          </button>
          <button
            className="btn btn-primary"
            onClick={() => { setIsCreateOpen(true); setCreateForm(emptyForm); }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
          >
            <Plus size={14} /> Nouvel État Décisionnel
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total États', value: totalEtats, color: '#a78bfa' },
          { label: 'États Actifs', value: actifsCount, color: '#34d399' },
          { label: 'États Inactifs', value: inactifsCount, color: '#94a3b8' },
        ].map((kpi) => (
          <div key={kpi.label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {kpi.label}
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: kpi.color, marginTop: '0.25rem' }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : (
        <DataTable
          columns={columns}
          data={etats}
          searchable
          searchPlaceholder="Rechercher un état décisionnel…"
          emptyMessage="Aucun état décisionnel enregistré. Cliquez sur « + Nouveau » pour commencer."
        />
      )}

      {/* Modal Contenu / Bordereau (Conforme OREOLE) */}
      <Modal
        isOpen={isContenuOpen}
        onClose={() => setIsContenuOpen(false)}
        title={`Contenu de l'État : ${contenuTarget?.libelle_etat || ''}`}
        subtitle={`Code : ${contenuTarget?.code_etat || ''} • Procédure Postgres : fn_bordereau_recap_emission`}
        maxWidth="1280px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Barre de Recherche et Filtres */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
              background: 'var(--bg-muted, rgba(255,255,255,0.03))',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '0.85rem 1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Calendar size={15} style={{ color: '#a78bfa' }} />
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Du :</span>
                <input
                  type="date"
                  className="form-control"
                  style={{ padding: '0.3rem 0.55rem', fontSize: '0.82rem', width: 'auto' }}
                  value={contenuDateDebut}
                  onChange={(e) => setContenuDateDebut(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Au :</span>
                <input
                  type="date"
                  className="form-control"
                  style={{ padding: '0.3rem 0.55rem', fontSize: '0.82rem', width: 'auto' }}
                  value={contenuDateFin}
                  onChange={(e) => setContenuDateFin(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Type :</span>
                <select
                  className="form-control"
                  style={{ padding: '0.3rem 0.55rem', fontSize: '0.82rem', width: 'auto' }}
                  value={contenuTypeEtat}
                  onChange={(e) => setContenuTypeEtat(Number(e.target.value))}
                >
                  <option value={1}>Bordereau</option>
                  <option value={2}>Récapitulatif</option>
                </select>
              </div>

              <button
                className="btn btn-primary"
                style={{ fontSize: '0.8rem', padding: '0.32rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                onClick={() => loadContenu(contenuTarget, contenuDateDebut, contenuDateFin, contenuTypeEtat)}
                disabled={contenuLoading}
              >
                {contenuLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Actualiser
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ position: 'relative', width: '220px' }}>
                <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-control"
                  style={{ paddingLeft: '2rem', fontSize: '0.8rem', padding: '0.3rem 0.55rem 0.3rem 2rem' }}
                  placeholder="Filtrer client, police…"
                  value={contenuSearch}
                  onChange={(e) => setContenuSearch(e.target.value)}
                />
              </div>

              {/* Bouton de bascule de vue */}
              <div style={{ display: 'inline-flex', borderRadius: '8px', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
                <button
                  type="button"
                  className={`btn ${contenuViewMode === 'flat' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: 0 }}
                  onClick={() => setContenuViewMode('flat')}
                  title="Vue Tableau Détaillé"
                >
                  <TableIcon size={14} /> Tableau
                </button>
                <button
                  type="button"
                  className={`btn ${contenuViewMode === 'grouped' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: 0 }}
                  onClick={() => setContenuViewMode('grouped')}
                  title="Vue Hiérarchique (Compagnie > Client > Branche)"
                >
                  <Layers size={14} /> Hiérarchique
                </button>
              </div>
            </div>
          </div>

          {/* Cartes Totaux / KPIs Financiers (Conforme OREOLE) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem' }}>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Total Lignes</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#60a5fa', marginTop: '0.15rem' }}>
                {filteredContenuDossiers.length.toLocaleString('fr-FR')}
              </div>
            </div>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Total Prime Nette</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                {totals.primeNette.toLocaleString('fr-FR')} F
              </div>
            </div>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Total Accessoires</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                {totals.accessoire.toLocaleString('fr-FR')} F
              </div>
            </div>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Total Taxes</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                {totals.taxe.toLocaleString('fr-FR')} F
              </div>
            </div>
            <div style={{ background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#34d399', fontWeight: 700, textTransform: 'uppercase' }}>Total Prime TTC</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#34d399', marginTop: '0.15rem' }}>
                {totals.primeTtc.toLocaleString('fr-FR')} F
              </div>
            </div>
            <div style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 700, textTransform: 'uppercase' }}>Comm. Intermédiaire</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#a78bfa', marginTop: '0.15rem' }}>
                {totals.commission.toLocaleString('fr-FR')} F
              </div>
            </div>
          </div>

          {/* Affichage des Données */}
          {contenuLoading ? (
            <LoadingSpinner />
          ) : contenuViewMode === 'grouped' ? (
            /* Vue Hiérarchique (Compagnie > Client > Branche) - TableauBordereaux OREOLE */
            <div style={{ maxHeight: '55vh', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
              {Object.keys(groupedData).length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Aucun dossier disponible pour la période sélectionnée.
                </div>
              ) : (
                Object.keys(groupedData).map((cieName) => {
                  const cie = groupedData[cieName];
                  const isExpanded = expandedCompagnies[cieName] !== false; // Par défaut développé
                  return (
                    <div key={cieName} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      {/* En-tête Compagnie */}
                      <div
                        onClick={() => toggleCompagnie(cieName)}
                        style={{
                          background: 'rgba(99,102,241,0.12)',
                          padding: '0.65rem 1rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          <span>COMPAGNIE : <strong style={{ color: '#818cf8' }}>{cie.nom_compagnie}</strong></span>
                        </div>
                        <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.8rem' }}>
                          <span>TTC : <strong style={{ color: '#34d399' }}>{cie.totals.primeTtc.toLocaleString('fr-FR')} F</strong></span>
                          <span>Commissions : <strong style={{ color: '#a78bfa' }}>{cie.totals.commission.toLocaleString('fr-FR')} F</strong></span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{ padding: '0.5rem 1rem' }}>
                          {Object.keys(cie.clients).map((cliName) => {
                            const cli = cie.clients[cliName];
                            return (
                              <div key={cliName} style={{ marginBottom: '0.75rem', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '6px', overflow: 'hidden' }}>
                                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.5rem 0.75rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600 }}>
                                  <span>CLIENT : <strong style={{ color: '#60a5fa' }}>{cli.nom_client}</strong></span>
                                  <span>Total Client TTC : <strong>{cli.totals.primeTtc.toLocaleString('fr-FR')} F</strong></span>
                                </div>

                                {Object.keys(cli.produits).map((prodName) => {
                                  const prod = cli.produits[prodName];
                                  return (
                                    <div key={prodName} style={{ padding: '0.4rem 0.75rem' }}>
                                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                                        BRANCHE : <span style={{ color: 'var(--text-primary)' }}>{prod.libelle_produit}</span> ({prod.items.length} quittance(s))
                                      </div>

                                      <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                                        <thead>
                                          <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                                            <th style={{ padding: '4px 8px' }}>N° Police</th>
                                            <th style={{ padding: '4px 8px' }}>N° Quittance</th>
                                            <th style={{ padding: '4px 8px' }}>N° Avenant</th>
                                            <th style={{ padding: '4px 8px' }}>Date Émis.</th>
                                            <th style={{ padding: '4px 8px' }}>Date Effet</th>
                                            <th style={{ padding: '4px 8px', textAlign: 'right' }}>Prime Nette</th>
                                            <th style={{ padding: '4px 8px', textAlign: 'right' }}>Prime TTC</th>
                                            <th style={{ padding: '4px 8px', textAlign: 'right' }}>Commission</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {prod.items.map((it, itIdx) => (
                                            <tr key={itIdx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                              <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)' }}>{it.numero_police}</td>
                                              <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)' }}>{it.numero_quittance}</td>
                                              <td style={{ padding: '4px 8px' }}>{it.numero_avenant}</td>
                                              <td style={{ padding: '4px 8px' }}>{it.date_emission ? new Date(it.date_emission).toLocaleDateString('fr-FR') : '-'}</td>
                                              <td style={{ padding: '4px 8px' }}>{it.date_effet ? new Date(it.date_effet).toLocaleDateString('fr-FR') : '-'}</td>
                                              <td style={{ padding: '4px 8px', textAlign: 'right' }}>{Number(it.prime_nette || 0).toLocaleString('fr-FR')} F</td>
                                              <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>{Number(it.prime_ttc || 0).toLocaleString('fr-FR')} F</td>
                                              <td style={{ padding: '4px 8px', textAlign: 'right', color: '#a78bfa' }}>{Number(it.commission_intermediaire || 0).toLocaleString('fr-FR')} F</td>
                                            </tr>
                                          ))}
                                          <tr style={{ background: 'rgba(99,102,241,0.05)', fontWeight: 700 }}>
                                            <td colSpan={5} style={{ padding: '4px 8px' }}>TOTAL {prod.libelle_produit}</td>
                                            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{prod.totals.primeNette.toLocaleString('fr-FR')} F</td>
                                            <td style={{ padding: '4px 8px', textAlign: 'right', color: '#34d399' }}>{prod.totals.primeTtc.toLocaleString('fr-FR')} F</td>
                                            <td style={{ padding: '4px 8px', textAlign: 'right', color: '#a78bfa' }}>{prod.totals.commission.toLocaleString('fr-FR')} F</td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* Vue Tableau Détaillé - DataTable */
            <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
              <DataTable
                columns={[
                  { header: 'Compagnie', accessor: 'nom_compagnie', sortable: true },
                  { header: 'Client', accessor: 'nom_client', sortable: true },
                  { header: 'Branche', accessor: 'libelle_produit', render: (d) => d.libelle_produit || d.produit || '-' },
                  { header: 'N° Police', accessor: 'numero_police', render: (d) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{d.numero_police || '-'}</span> },
                  { header: 'N° Quittance', accessor: 'numero_quittance', render: (d) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{d.numero_quittance || '-'}</span> },
                  { header: 'Date Émis.', accessor: 'date_emission', render: (d) => d.date_emission ? new Date(d.date_emission).toLocaleDateString('fr-FR') : '-' },
                  { header: 'Prime Nette (F)', align: 'right', render: (d) => Number(d.prime_nette || 0).toLocaleString('fr-FR') },
                  { header: 'Prime TTC (F)', align: 'right', render: (d) => <strong>{Number(d.prime_ttc || 0).toLocaleString('fr-FR')}</strong> },
                  { header: 'Commission (F)', align: 'right', render: (d) => <span style={{ color: '#a78bfa', fontWeight: 600 }}>{Number(d.commission_intermediaire || 0).toLocaleString('fr-FR')}</span> },
                ]}
                data={filteredContenuDossiers}
                searchPlaceholder="Filtrer un dossier…"
                emptyMessage="Aucun dossier disponible pour cet état sur la période sélectionnée."
              />
            </div>
          )}

          {/* Actions d'impression / export */}
          <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: '#60a5fa' }}>{filteredContenuDossiers.length}</strong> dossier{filteredContenuDossiers.length > 1 ? 's' : ''} sur <strong>{contenuDossiers.length}</strong> au total
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <select
                className="form-control"
                style={{ width: 'auto', fontSize: '0.82rem', padding: '0.35rem 0.6rem' }}
                value={contenuFormat}
                onChange={(e) => setContenuFormat(e.target.value)}
              >
                <option value="XLSX">Classeur Excel</option>
                <option value="PDF">Document PDF</option>
              </select>
              <button className="btn btn-secondary" onClick={handleExportContenu} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
                {contenuFormat === 'XLSX' ? <FileSpreadsheet size={15} color="#34d399" /> : <FileText size={15} color="#f87171" />}
                Télécharger ({contenuFormat})
              </button>
              <button className="btn btn-primary" onClick={handlePrintContenu} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
                <Printer size={15} /> Imprimer
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal Export Référentiel */}
      <Modal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        title="Exporter le Référentiel des États Décisionnels"
        subtitle="Génération d'un document PDF ou Excel pour archivage et contrôle."
        maxWidth="480px"
      >
        <form onSubmit={handleExport}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
              Format du Document *
            </label>
            <select
              className="form-control"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
            >
              <option value="XLSX">Classeur Microsoft Excel</option>
              <option value="PDF">Document PDF</option>
            </select>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
              Périmètre des États
            </label>
            <select
              className="form-control"
              value={exportScope}
              onChange={(e) => setExportScope(e.target.value)}
            >
              <option value="ALL">Tous les états</option>
              <option value="ACTIFS">États actifs uniquement</option>
              <option value="INACTIFS">États inactifs uniquement</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsExportOpen(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Download size={14} /> Télécharger
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Confirmation Suppression */}
      {isDeleteOpen && deleteTarget && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        }}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
            borderRadius: '12px', padding: '1.75rem', maxWidth: '420px', width: '100%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={18} style={{ color: '#f87171' }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>Supprimer l'état décisionnel ?</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cette action est irréversible.</div>
              </div>
            </div>
            <div style={{ padding: '0.75rem', background: 'var(--bg-muted)', borderRadius: '8px', marginBottom: '1.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Vous êtes sur le point de supprimer <strong>« {deleteTarget.code_etat} - {deleteTarget.libelle_etat} »</strong>.
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setIsDeleteOpen(false)} disabled={isDeleting}>Annuler</button>
              <button
                className="btn"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <Trash2 size={14} />
                {isDeleting ? 'Suppression…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DecisionalStatesPage;
