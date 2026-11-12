import React, { useState, useEffect } from 'react';
import { confirmer } from '../../../utils/dialogue';
import { useNavigate } from 'react-router-dom';
import { DataTable } from '../../../components/common/DataTable';
import { BoutonsNouveauDevis, OngletsBranches, iconeOnglet } from '../../../components/common/BranchesDevis';
import { isExpiredQuote, isUnconfirmedQuote, MODULES_EDITION_COMPLETE } from '../../../utils/quoteRegistry';
import { TITRE_MODULE_INACTIF } from '../../../utils/modulesActifs';
import { moduleDuProduit, moduleOuvert, ongletDuProduit, ongletsRegistre, parametre, produitsParametres } from '../../../utils/parametrage';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import { RowActions } from '../../../components/common/RowActions';
import { SuppressionModal } from '../../../components/common/SuppressionModal';
import { aLeDroit } from '../../../utils/droits';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { DeleteConfirmModal } from '../../../components/common/DeleteConfirmModal';
import { EditQuoteModal } from './EditQuoteModal';
import { ViewQuoteModal } from './ViewQuoteModal';
import { SubscriptionIssuanceModal } from './SubscriptionIssuanceModal';
import { dataStore } from '../../../api/dataStore';
import { quoteApi, contractApi, brouillonApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { canUser, validateBusinessRule } from '../../../utils/rbac';
import { estDevisDommages, exportToPdf } from '../../../utils/exportUtils';
import {
  messageErreurDemandeEditionAttestation,
  telechargerDemandeEditionAttestationAuto,
} from '../../../utils/attestationAuto';
import {
  FileText,
  HeartPulse,
  HeartHandshake,
  Plus,
  CheckCircle,
  Edit2,
  Trash2,
  Archive,
  Eye,
  TrendingUp,
  Layers,
  Printer,
  RefreshCw,
  CalendarX,
} from 'lucide-react';

const formatDateTime = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Seuls les devis émis durant les N dernières années sont affichés (Administration > Le cabinet,
// règle « Ancienneté des devis affichés au registre », 3 ans à l'origine)
const isWithinLastThreeYears = (q) => {
  const d = new Date(q.date_emission || q.dateemission);
  if (isNaN(d.getTime())) return true;
  const limit = new Date();
  limit.setFullYear(limit.getFullYear() - parametre('devis.registre_annees', 3));
  return d >= limit;
};

// Devis expirés : affichés s'ils ont été émis depuis le 1er janvier de l'année N - k (Administration > Le cabinet,
// règle « Devis expirés affichés au registre », k = 1 : année en cours et année précédente)
const isExpiredShown = (q) => {
  const d = new Date(q.date_emission || q.dateemission);
  if (isNaN(d.getTime())) return true;
  return d >= new Date(new Date().getFullYear() - parametre('devis.registre_expires_annees', 1), 0, 1);
};



export const QuoteListPage = () => {
  const { user } = useAuth();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  // Onglet demandé dans l'adresse (?onglet=EXPIRED depuis le Cockpit opérationnel)
  const [selectedBranchFilter, setSelectedBranchFilter] = useState(() => new URLSearchParams(window.location.search).get('onglet') || 'ALL');
  // Décompte du registre par branche, calculé sur les devis à confirmer réellement chargés
  const [stats, setStats] = useState({ ALL: 0, CONSOLIDATED: 0 });
  // Onglets du registre : un par « Onglet du registre » des produits, « Autres » pour un produit non réglé
  const onglets = ongletsRegistre();
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [downloadingAttestationId, setDownloadingAttestationId] = useState(null);
  const [viewingQuote, setViewingQuote] = useState(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState(null);
  const [deletingQuote, setDeletingQuote] = useState(null);
  const [devisASupprimer, setDevisASupprimer] = useState(null);
  const [deleteValidation, setDeleteValidation] = useState({ allowed: true });
  const [selectedForConsolidation, setSelectedForConsolidation] = useState([]);
  const [consolidating, setConsolidating] = useState(false);
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  // Devis Auto et IA non terminés, enregistrés en brouillon (table lephare_brouillon)
  const [brouillons, setBrouillons] = useState([]);
  useEffect(() => {
    brouillonApi.list()
      .then((liste) => setBrouillons(Array.isArray(liste)
        ? liste.filter((b) => ['DEVIS_AUTO', 'DEVIS_IA'].includes(b.type_brouillon))
        : []))
      .catch((e) => console.warn('Chargement des brouillons impossible', e));
  }, []);
  const supprimerBrouillon = async (brouillon) => {
    if (!(await confirmer({
      ton: 'danger',
      titre: `Supprimer le brouillon « ${brouillon.libelle || brouillon.id} » ?`,
      message: 'Le brouillon et sa saisie seront supprimés définitivement.',
      confirmer: 'Supprimer le brouillon',
    }))) return;
    try {
      await brouillonApi.remove(brouillon.id);
      setBrouillons((prev) => prev.filter((b) => b.id !== brouillon.id));
      success('Brouillon supprimé.');
    } catch (e) {
      toastError("Le brouillon n'a pas pu être supprimé.");
    }
  };
  const ETAPES_BROUILLON = {
    DEVIS_AUTO: { 1: '1. Contrat', 2: '2. Véhicule', 3: '3. Offre & décompte', 4: '4. Client / conducteur' },
    DEVIS_IA: { 1: '1. Contrat', 2: '2. Souscripteur & assurés', 3: '3. Récapitulatif' },
  };

  const isEligibleForConsolidation = (q) =>
    !q.flotte && !q.confirme && !q.archive && !q.devis_consolide;

  const toggleConsolidationSelection = (quote) => {
    setSelectedForConsolidation((prev) => {
      const exists = prev.some((q) => q.iddevis === quote.iddevis);
      if (exists) return prev.filter((q) => q.iddevis !== quote.iddevis);
      return [...prev, quote];
    });
  };

  const handleConsolidateSelected = async () => {
    if (selectedForConsolidation.length < 2) {
      toastError('Sélectionnez au moins 2 devis Mono du même client à consolider.');
      return;
    }
    setConsolidating(true);
    try {
      const payload = selectedForConsolidation.map((q) => ({ iddevis: q.iddevis }));
      const res = await quoteApi.consolidateQuote(payload);
      const newId = res?.data?.iddevis;
      success(
        `${selectedForConsolidation.length} devis consolidés avec succès` +
          (newId ? ` (nouveau devis n°${newId})` : '') +
          ' !'
      );
      setSelectedForConsolidation([]);
      await loadQuotes();
      await loadStats();
    } catch (err) {
      const apiError = err.response?.data?.erreur || err.response?.data?.detail;
      toastError(apiError || 'Erreur lors de la consolidation des devis.');
    } finally {
      setConsolidating(false);
    }
  };

  // Un seul chargement du registre complet (non archivés, non confirmés) : le serveur ne sait pas
  // filtrer les devis expirés ni compter par branche, donc tout est calculé ici pour que
  // compteurs, onglets et liste soient toujours identiques.
  const [registry, setRegistry] = useState(null);

  // Onglet du registre d'un devis : celui de son produit (Administration > Produits). Devis sans
  // identifiant de produit (données locales) : produit retrouvé par son libellé ; sinon « Autres ».
  const getBranchOf = (q) => {
    const p = q.raw?.produit;
    const id = Number(p && typeof p === 'object' ? (p.id_produit ?? p.IdProduit ?? p.idproduit) : (q.raw?.idproduit ?? p));
    const onglet = Number.isFinite(id) ? ongletDuProduit(id) : null;
    if (onglet) return onglet;
    const normaliser = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const libelle = normaliser((p && typeof p === 'object' ? (p.LibelleProduit ?? p.libelle_produit) : p) || q.produit);
    const parLibelle = produitsParametres().find((x) => libelle && normaliser(x.Libelle) === libelle);
    return (parLibelle && ongletDuProduit(parLibelle.IdProduit)) || 'AUTRES';
  };

  const sortRecent = (list) => [...list].sort((a, b) => {
    const dateA = new Date(a.dateemission || a.date_emission || a.dateeffet || 0).getTime();
    const dateB = new Date(b.dateemission || b.date_emission || b.dateeffet || 0).getTime();
    return dateB - dateA || (b.iddevis || b.id || 0) - (a.iddevis || a.id || 0);
  });

  const loadQuotes = async () => {
    setLoading(true);
    try {
      const all = await quoteApi.getAllQuotes({ archive: 'false', confirme: 'false' });
      setRegistry(sortRecent(all.filter(isUnconfirmedQuote)
        .filter((q) => (isExpiredQuote(q) ? isExpiredShown(q) : isWithinLastThreeYears(q)))));
    } catch (err) {
      console.error('Erreur chargement devis Django:', err);
      setRegistry([]);
      toastError('Impossible de charger les devis : le serveur ou la base de données ne répond pas.');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = () => {};

  useEffect(() => {
    loadQuotes();
  }, []);

  // Liste affichée + compteurs, tous dérivés du même registre
  useEffect(() => {
    if (!registry) return;
    const counts = { ALL: registry.length, CONSOLIDATED: 0, EXPIRED: 0 };
    registry.forEach((q) => {
      const onglet = getBranchOf(q);
      counts[onglet] = (counts[onglet] || 0) + 1;
      if (q.devis_consolide) counts.CONSOLIDATED += 1;
      if (isExpiredQuote(q)) counts.EXPIRED += 1;
    });
    setStats(counts);
    setQuotes(
      selectedBranchFilter === 'ALL' ? registry
        : selectedBranchFilter === 'CONSOLIDATED' ? registry.filter((q) => q.devis_consolide)
        : selectedBranchFilter === 'EXPIRED' ? registry.filter(isExpiredQuote)
        : registry.filter((q) => getBranchOf(q) === selectedBranchFilter)
    );
  }, [registry, selectedBranchFilter]);

  const handleConvertContract = (quote) => {
    setSelectedQuote(quote);
    setIsConfirmModalOpen(true);
  };

  const confirmConversion = async () => {
    if (!selectedQuote) return;
    try {
      const res = await contractApi.createContractFromQuote(selectedQuote.id);
      success(`Devis ${selectedQuote.numerodevis} confirmé : le contrat a bien été créé.`);
      if (getBranchOf(selectedQuote) === 'AUTO') {
        try {
          await telechargerDemandeEditionAttestationAuto(selectedQuote.id);
        } catch (downloadError) {
          console.error('Téléchargement de la demande d’édition d’attestation impossible', downloadError);
          toastError(`Contrat créé, mais le modèle de demande d’attestation n’a pas pu être généré : ${await messageErreurDemandeEditionAttestation(downloadError)}.`);
        }
      }
      setIsConfirmModalOpen(false);
      // Dommages : fiche du contrat avec son relevé de compte (quittance remise au client)
      const idContrat = Number(res?.data?.[0]?.ObjectId);
      if (estDevisDommages(selectedQuote) && idContrat > 0) navigate(`/user/contracts/${idContrat}`, { state: { releve: true } });
      else navigate('/user/contracts');
    } catch (err) {
      toastError(err.response?.data?.detail || err.response?.data?.message || 'Le devis n\'a pas pu être confirmé. Veuillez réessayer.');
      setIsConfirmModalOpen(false);
    }
  };

  const telechargerAttestation = async (quote) => {
    const idDevis = quote.iddevis || quote.id;
    setDownloadingAttestationId(idDevis);
    try {
      await telechargerDemandeEditionAttestationAuto(idDevis);
      success('Le fichier Excel de demande d’attestation a été téléchargé.');
    } catch (downloadError) {
      console.error('Téléchargement de la demande d’édition d’attestation impossible', downloadError);
      toastError(`Le fichier Excel n’a pas pu être téléchargé : ${await messageErreurDemandeEditionAttestation(downloadError)}.`);
    } finally {
      setDownloadingAttestationId(null);
    }
  };

  // Dynamic KPI Metrics
  const totalDevis = quotes.length;
  const totalPrimesCotees = quotes.reduce((acc, q) => acc + Number(q.prime_totale || 0), 0);

  const countByBranch = stats;

  const getTabLabel = (filter) => {
    if (filter === 'CONSOLIDATED') return 'Consolidés';
    if (filter === 'EXPIRED') return 'Expirés';
    if (filter === 'ARCHIVED') return 'Archivés';
    if (filter === 'AUTRES') return 'Autres';
    return onglets.find((o) => o.id === filter)?.label || 'Tous';
  };

  const handlePrintQuotes = (specificBranch = null) => {
    const branchToUse = specificBranch || selectedBranchFilter;
    let listToPrint = quotes;

    if (!listToPrint || listToPrint.length === 0) {
      toastError(`Aucun devis à imprimer pour ${getTabLabel(branchToUse)}.`);
      return;
    }

    const today = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const headers = [
      'N° Devis',
      'Souscripteur',
      'Branche / Produit',
      'Compagnie',
      'Avenant',
      'Type',
      'Date Émission',
      'Date Expiration',
      'Prime Nette',
      'Prime TTC',
      'Statut',
    ];

    const rows = listToPrint.map((q) => {
      const branchProd = [q.branche, q.produit].filter(Boolean).join(' - ') || (q.produit || 'Auto');
      const primeNette = `${Number(q.prime_nette || 0).toLocaleString('fr-FR')} FCFA`;
      const prime = `${Number(q.prime_totale || 0).toLocaleString('fr-FR')} FCFA`;
      return [
        q.numerodevis || `DEV-${q.id}`,
        q.client_nom || q.nomcomplet || 'Client Particulier',
        branchProd,
        q.compagnie || 'LE PHARE',
        q.avenant || '-',
        q.flotte ? 'Flotte' : 'Mono',
        formatDateTime(q.date_emission),
        formatDateTime(q.date_expiration),
        primeNette,
        prime,
        isExpiredQuote(q) ? 'Expiré' : (q.statut || 'En cours'),
      ];
    });

    const totalMontant = listToPrint.reduce((acc, q) => acc + Number(q.prime_totale || 0), 0);
    const tabName = getTabLabel(branchToUse);

    exportToPdf({
      filename: `Registre_Devis_${tabName}_LE_PHARE_${new Date().toISOString().slice(0, 10)}.pdf`,
      title: `REGISTRE OFFICIEL DES DEVIS [${tabName.toUpperCase()}]`,
      subtitle: branchToUse !== 'ALL' ? `Branche / Catégorie : ${tabName} - Conforme aux normes d'audit CIMA` : 'État global de souscription conforme aux normes CIMA',
      metadata: {
        'Date d\'édition': today,
        'Édité par': user?.nom ? `${user.nom} (${user.email || ''})` : (user?.email || 'Gestionnaire'),
        'Périmètre': `Filtre actif : ${tabName}`,
        'Volume coté': `${listToPrint.length} devis (${Number(countByBranch[branchToUse] || listToPrint.length).toLocaleString('fr-FR')} en base)`,
        'Total Primes TTC': `${totalMontant.toLocaleString('fr-FR')} FCFA`,
      },
      headers,
      rows,
      tableSummary: {
        'Nombre total de devis cotés': String(listToPrint.length),
        'Montant global des primes TTC': `${totalMontant.toLocaleString('fr-FR')} FCFA`,
      },
    });
  };

  const columns = [
    {
      header: 'Réf. Devis',
      accessor: 'numerodevis',
      sortable: true,
      render: (row) => {
        const eligible = isEligibleForConsolidation(row);
        const isSelected = selectedForConsolidation.some((q) => q.iddevis === row.iddevis);
        const isConsolidated = !!row.devis_consolide;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {eligible && selectedBranchFilter !== 'ARCHIVED' && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleConsolidationSelection(row)}
                title="Cocher pour fusionner/consolider ce devis mono (sp_consolidation_devis)"
                style={{ cursor: 'pointer', accentColor: '#3b82f6', width: '15px', height: '15px' }}
              />
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>{row.numerodevis || `DEV-${row.id}`}</strong>
                {isConsolidated && (
                  <span
                    style={{
                      fontSize: '0.65rem',
                      padding: '0.1rem 0.35rem',
                      borderRadius: '4px',
                      background: 'rgba(59, 130, 246, 0.2)',
                      color: '#60a5fa',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
                      fontWeight: 700,
                    }}
                    title="Devis multi-risques issu de la consolidation de plusieurs devis mono"
                  >
                    Consolidé #{row.devis_consolide}
                  </span>
                )}
                {row.archive && (
                  <span
                    style={{
                      fontSize: '0.65rem',
                      padding: '0.1rem 0.35rem',
                      borderRadius: '4px',
                      background: 'rgba(239, 68, 68, 0.2)',
                      color: '#f87171',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      fontWeight: 700,
                    }}
                  >
                    Archivé
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      header: 'Nom et Prénoms',
      accessor: 'client_nom',
      sortable: true,
      render: (row) => (
        <span style={{ fontWeight: 600, color: '#e2e8f0' }}>
          {row.client_nom || row.nomcomplet || 'Client Inconnu'}
        </span>
      ),
    },
    {
      header: 'Catégorie',
      accessor: 'categorie',
      sortable: true,
      render: (row) => (
        row.categorie
          ? <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{row.categorie}</span>
          : <span style={{ color: 'var(--text-muted)' }}>-</span>
      ),
    },
    {
      header: 'Compagnie',
      accessor: 'compagnie',
      sortable: true,
      render: (row) => <div style={{ fontSize: '0.85rem' }}>{row.compagnie || 'NSIA ASSURANCES'}</div>,
    },
    {
      header: 'Avenant',
      accessor: 'avenant',
      sortable: true,
      render: (row) => <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{row.avenant || '-'}</div>,
    },
    {
      header: 'Type',
      accessor: 'flotte',
      sortable: true,
      render: (row) => (
        <span
          style={{
            fontSize: '0.72rem',
            padding: '0.1rem 0.45rem',
            borderRadius: '4px',
            fontWeight: 600,
            background: row.flotte ? 'rgba(168, 85, 247, 0.15)' : 'rgba(148, 163, 184, 0.15)',
            color: row.flotte ? '#c084fc' : '#94a3b8',
          }}
        >
          {row.flotte ? 'Flotte' : 'Mono'}
        </span>
      ),
    },
    {
      header: 'Émission',
      accessor: 'date_emission',
      sortable: true,
      render: (row) => <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{formatDateTime(row.date_emission)}</div>,
    },
    {
      header: 'Expiration',
      accessor: 'date_expiration',
      sortable: true,
      render: (row) => {
        // Devis dont la date d'expiration est dépassée : affichée en rouge
        const expire = row.date_expiration && new Date(row.date_expiration) < new Date(new Date().toDateString());
        return (
          <div style={{ fontSize: '0.8rem', color: expire ? '#f87171' : 'var(--text-secondary)' }} title={expire ? 'Devis expiré' : undefined}>
            {formatDateTime(row.date_expiration)}
          </div>
        );
      },
    },
    {
      header: 'Prime Nette',
      accessor: 'prime_nette',
      sortable: true,
      render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
          {Number(row.prime_nette || 0).toLocaleString('fr-FR')} FCFA
        </span>
      ),
    },
    {
      header: 'Prime TTC',
      accessor: 'prime_totale',
      sortable: true,
      render: (row) => (
        <strong style={{ color: '#34d399', fontFamily: 'var(--font-mono)' }}>
          {Number(row.prime_totale || 0).toLocaleString('fr-FR')} FCFA
        </strong>
      ),
    },
    {
      header: 'Statut',
      accessor: 'statut',
      sortable: true,
      render: (row) => {
        let color = 'amber';
        const s = (row.statut || '').toLowerCase();
        if (row.archive) color = 'slate';
        else if (s.includes('confirm') || s.includes('contrat') || row.confirme) color = 'emerald';
        else if (s.includes('consolid')) color = 'blue';
        else if (s.includes('expir') || isExpiredQuote(row)) color = 'red';
        const label = color === 'emerald' ? 'Confirmé' : (color === 'blue' ? (row.statut || 'Consolidé') : (color === 'red' ? 'Expiré' : 'Attente'));
        return <StatusBadge label={label} color={color} />;
      },
    },
    {
      header: 'Actions',
      render: (row) => {
        const canEdit = canUser(user, 'edit', 'quotes');
        const canDelete = canUser(user, 'delete', 'quotes');
        const canConvert = canUser(user, 'convert', 'quotes');
        const isConsolidated = !!row.devis_consolide;
        const todayStr = new Date().toISOString().split('T')[0];
        const isExpired = row.date_expiration ? new Date(row.date_expiration) < new Date(todayStr) : false;
        const isPendingApproval = row.circuit_approbation && row.circuit_approbation.statut_validation === 'EN_ATTENTE_DIRECTION';
        // Édition complète : le formulaire du produit (Administration > Produits) est rouvert avec toutes
        // les valeurs du devis, s'il sait le faire. Autres produits : primes seulement.
        const produit = row.raw?.produit;
        const idProduit = Number(produit && typeof produit === 'object' ? produit.id_produit : row.raw?.idproduit);
        const moduleProduit = moduleDuProduit(idProduit) || (getBranchOf(row) === 'AUTO' ? 'auto' : null);
        const moduleDevis = MODULES_EDITION_COMPLETE.includes(moduleProduit) ? moduleProduit : null;
        const moduleFerme = !moduleOuvert(moduleDevis);

        return (
          <RowActions
            onView={() => setViewingQuote(row)}
            viewTitle="Consulter l'intégralité du devis et l'imprimer"
            showConfirm={!isConsolidated && canConvert}
            confirmLabel={isPendingApproval ? 'En Visa' : 'Confirmer'}
            confirmDisabled={isPendingApproval}
            confirmTitle={
              isExpired
                ? `Devis expiré (période échue le ${formatDateTime(row.date_expiration)}) : le contrat sera émis avec les dates du devis`
                : isPendingApproval
                ? 'Visa Direction Requis avant confirmation (CA-07.4)'
                : 'Confirmer le devis et générer le contrat (E08)'
            }
            onConfirm={() => handleConvertContract(row)}
            onEdit={() => {
              if (moduleDevis) {
                navigate(`/user/quotes/${moduleDevis}?edit=${row.iddevis}`);
              } else {
                setEditingQuote(row);
              }
            }}
            editDisabled={isConsolidated || !canEdit || moduleFerme}
            editTitle={
              isConsolidated
                ? 'Devis consolidé scellé (non modifiable)'
                : !canEdit
                ? 'Non habilité pour la modification'
                : (moduleFerme ? TITRE_MODULE_INACTIF : 'Modifier le devis')
            }
            onArchive={() => {
              const check = validateBusinessRule('delete', 'quotes', row, dataStore);
              setDeleteValidation(check);
              setDeletingQuote(row);
            }}
            archiveDisabled={!canDelete}
            archiveTitle={canDelete ? 'Archiver le devis (Conformité CIMA)' : "Non habilité pour l'archivage"}
            showDelete={aLeDroit('devis.delete')}
            deleteTitle="Supprimer définitivement le devis"
            onDelete={() => setDevisASupprimer(row)}
          />
        );
      },
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <FileText size={26} color="#3b82f6" />
            Gestion des Devis
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Centralisation, consultation et transformation des devis toutes branches (Auto, Voyage, Transport, MRH, Santé, Oreole Santé, IA, Dommages).
          </p>
        </div>

        {/* Quick Branch Creator Buttons & Print */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handlePrintQuotes}
            disabled={loading || quotes.length === 0}
            title="Imprimer le registre officiel des devis"
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
          >
            <Printer size={16} />
            <span>Imprimer la Liste</span>
          </button>
          <BoutonsNouveauDevis />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/user/quotes/oreole-sante')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
          >
            <HeartPulse size={16} />
            <span>Devis Oreole Santé</span>
          </button>
          {aLeDroit('rafas.view') && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/user/rafas')}
              title="Régimes autofinancés d'assurance santé : conventions, fonds et dépenses du gestionnaire"
              style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
            >
              <HeartHandshake size={16} />
              <span>RAFAS</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div className="glass-panel" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Layers size={20} color="#3b82f6" />
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Total Devis Actifs</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)' }}>{(countByBranch.ALL - (countByBranch.EXPIRED || 0)).toLocaleString('fr-FR')}</div>
            {countByBranch.EXPIRED > 0 && (
              <div style={{ fontSize: '0.72rem', color: '#f87171' }}>+ {countByBranch.EXPIRED.toLocaleString('fr-FR')} expirés</div>
            )}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <TrendingUp size={20} color="#10b981" />
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Primes Totales Cotées (Page)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)' }}>{totalPrimesCotees.toLocaleString('fr-FR')} F</div>
          </div>
        </div>
      </div>

      {/* Brouillons en cours : devis non terminés, à reprendre là où la saisie s'était arrêtée */}
      {brouillons.length > 0 && (
        <div className="glass-panel" style={{ padding: '1rem 1.25rem', borderRadius: '12px', borderLeft: '4px solid #f59e0b' }}>
          <div style={{ fontWeight: 800, marginBottom: '0.75rem', color: '#f59e0b' }}>
            Brouillons en cours ({brouillons.length})
          </div>
          <DataTable
            searchable={false}
            itemsPerPage={5}
            data={brouillons}
            columns={[
              { header: 'Brouillon', accessor: 'libelle', render: (b) => <strong>{b.libelle || `Brouillon n°${b.id}`}</strong> },
              { header: 'Étape atteinte', accessor: 'etape', render: (b) => ETAPES_BROUILLON[b.type_brouillon]?.[b.etape] || b.etape },
              { header: 'Devis modifié', accessor: 'iddevis', render: (b) => (b.iddevis ? `Devis n°${b.iddevis}` : 'Nouveau devis') },
              { header: 'Par', accessor: 'utilisateur_nom' },
              { header: 'Dernière modification', accessor: 'date_modification', render: (b) => new Date(b.date_modification).toLocaleString('fr-FR') },
              {
                header: 'Actions',
                render: (b) => (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="button" className="btn btn-primary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }} onClick={() => navigate(`/user/quotes/${b.type_brouillon === 'DEVIS_IA' ? 'ia' : 'auto'}?brouillon=${b.id}`)}>
                      Reprendre
                    </button>
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', color: '#ef4444' }} onClick={() => supprimerBrouillon(b)}>
                      Supprimer
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* Onglets de branches (composant commun avec les Affaires antérieures), impression directe de chaque liste */}
      <OngletsBranches
        onglets={[
          { id: 'ALL', label: 'Tous', count: countByBranch.ALL, icon: null },
          ...onglets.map((o) => ({ id: o.id, label: o.label, count: countByBranch[o.id] || 0, icon: iconeOnglet(o.id) })),
          ...(countByBranch.AUTRES ? [{ id: 'AUTRES', label: 'Autres', count: countByBranch.AUTRES, icon: iconeOnglet('AUTRES') }] : []),
          { id: 'EXPIRED', label: 'Expirés', count: countByBranch.EXPIRED || 0, icon: <CalendarX size={13} color="#f87171" /> },
        ]}
        actif={selectedBranchFilter}
        onChoisir={setSelectedBranchFilter}
        onImprimer={handlePrintQuotes}
        libelle={(tab) => `Afficher les devis : ${tab.label}`}
      />

      {/* Consolidation Action Bar (si des devis sont sélectionnés) */}
      {selectedForConsolidation.length > 0 && (
        <div
          className="glass-panel"
          style={{
            padding: '0.75rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(16, 185, 129, 0.15))',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Layers size={20} color="#60a5fa" />
            <div>
              <strong style={{ color: '#fff', fontSize: '0.9rem' }}>
                {selectedForConsolidation.length} devis sélectionné(s) pour consolidation
              </strong>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Fusion multi-risques vers un devis consolidé unique (sp_consolidation_devis)
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSelectedForConsolidation([])}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={selectedForConsolidation.length < 2 || consolidating}
              onClick={handleConsolidateSelected}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <CheckCircle size={14} />
              <span>{consolidating ? 'Consolidation en cours...' : `Consolider (${selectedForConsolidation.length})`}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {quotes.length === 0
              ? (selectedBranchFilter === 'EXPIRED' ? 'Aucun devis expiré' : 'Aucun devis en attente de confirmation')
              : selectedBranchFilter === 'EXPIRED'
                ? <><strong>{quotes.length.toLocaleString('fr-FR')}</strong> devis expirés depuis le 1er janvier {new Date().getFullYear() - parametre('devis.registre_expires_annees', 1)} : confirmables avec leurs dates, ou à modifier avant pour une nouvelle période</>
                : <><strong>{quotes.length.toLocaleString('fr-FR')}</strong> devis non confirmés{selectedBranchFilter !== 'ALL' ? ` (${getTabLabel(selectedBranchFilter)})` : ''}{(() => {
                  const expires = quotes.filter(isExpiredQuote).length;
                  return expires ? `, dont ${expires.toLocaleString('fr-FR')} expirés` : '';
                })()}</>}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              loadStats();
              loadQuotes(selectedBranchFilter);
            }}
            title="Actualiser la liste"
            style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem' }}
          >
            <RefreshCw size={13} />
            <span>Actualiser</span>
          </button>
        </div>

        {loading ? (
          <LoadingSpinner text="Chargement des devis en cours…" />
        ) : (
          <DataTable
            columns={columns}
            data={quotes}
            searchPlaceholder="Rechercher par n° devis, assuré, compagnie ou branche..."
          />
        )}
      </div>

      {/* Modal Consultation Devis */}
      {viewingQuote && (
        <ViewQuoteModal
          isOpen={!!viewingQuote}
          onClose={() => setViewingQuote(null)}
          quote={viewingQuote}
          showDownloadAttestation={getBranchOf(viewingQuote) === 'AUTO'}
          downloadingAttestation={downloadingAttestationId === (viewingQuote.iddevis || viewingQuote.id)}
          onDownloadAttestation={() => telechargerAttestation(viewingQuote)}
          onQuoteUpdated={(devisAJour) => setRegistry((prec) => (prec || []).map((q) => (
            String(q.iddevis) === String(devisAJour.iddevis) ? devisAJour : q
          )))}
        />
      )}

      {/* Modal Modification Devis */}
      {editingQuote && (
        <EditQuoteModal
          isOpen={!!editingQuote}
          onClose={() => setEditingQuote(null)}
          quote={editingQuote}
          onSuccess={() => {
            loadQuotes();
            loadStats();
          }}
        />
      )}

      {/* Modal Confirmation Conversion en Contrat */}
      <Modal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        title="Confirmation de la Transformation en Contrat CIMA"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            Êtes-vous sûr de vouloir valider et transformer le devis{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{selectedQuote?.numerodevis}</strong> ({selectedQuote?.client_nom}) en contrat d'assurance définitif ?
          </p>
          {/* Devis expiré : confirmable (demande du 2026-10-28), le contrat reprend la période du devis */}
          {selectedQuote && isExpiredQuote(selectedQuote) && (
            <div role="alert" style={{ padding: '0.75rem 0.9rem', borderRadius: 8, border: '1px solid rgba(245, 158, 11, 0.45)', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--text-primary)', fontSize: '0.85rem', lineHeight: 1.5 }}>
              <strong>Devis expiré.</strong> Sa période, du {formatDateTime(selectedQuote.date_effet)} au {formatDateTime(selectedQuote.date_expiration)}, est échue :
              le contrat sera émis avec ces dates. Pour couvrir une nouvelle période, annulez et modifiez d'abord les dates du devis.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsConfirmModalOpen(false)}>
              Annuler
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmConversion}>
              Confirmer & Émettre Police
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal Suppression Sécurisée / Contrôle CIMA */}
      <DeleteConfirmModal
        isOpen={!!deletingQuote}
        onClose={() => setDeletingQuote(null)}
        itemType="devis"
        itemName={`Devis ${deletingQuote?.numerodevis} (${deletingQuote?.client_nom})`}
        itemCode={deletingQuote?.numerodevis}
        validation={deleteValidation}
        onConfirm={async () => {
          if (deletingQuote) {
            try {
              await quoteApi.archiveQuote(deletingQuote.id);
              success(`Devis ${deletingQuote.numerodevis} archivé avec succès.`);
              setDeletingQuote(null);
              loadQuotes();
              loadStats();
            } catch (err) {
              toastError(err.response?.data?.message || err.message || 'Le devis n\'a pas pu être archivé. Veuillez réessayer.');
            }
          }
        }}
      />

      <SuppressionModal
        isOpen={!!devisASupprimer}
        onClose={() => setDevisASupprimer(null)}
        type="devis"
        id={devisASupprimer?.iddevis || devisASupprimer?.id}
        onSupprime={() => { loadQuotes(); loadStats(); }}
      />
    </div>
  );
};

export default QuoteListPage;
