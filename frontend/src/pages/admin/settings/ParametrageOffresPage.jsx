import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { DeleteConfirmModal } from '../../../components/common/DeleteConfirmModal';
import {
  Tag,
  Plus,
  Trash2,
  Sliders,
  Info,
} from 'lucide-react';
import { settingsApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { sortUniqueBy, trierParLibelle } from '../../../utils/sortUtils';
import { AmountInput } from '../../../components/common/AmountInput';
import { formatMoney } from '../../../utils/formatUtils';

const EMPTY_OFFRE_FORM = {
  LibelleOffre: '',
  TarifOffre: '',
  Actif: true,
  Visibilite: 'T',
  Payement: 'A',
  JPaiement: 1,
  MajFract: 0,
  Anticipation: 26,
  Differe: 0,
  Echeance: 'L',
  Renouvelable: 'L',
  Ppr: 'N',
  Entreprise: false,
  Flotte: false,
  Gestion: false,
  ExoneredeTaxes: false,
  ExoneredeAccess: false,
};

// Seules ces compagnies disposent d'une fonction de calcul de primes câblée
// (fn_garantie_offre_cat*_nsia/amsa/sunu) : une association créée pour une autre
// compagnie serait acceptée en base mais jamais utilisée par le moteur de tarification.
const COMPAGNIES_MOTEUR_TARIFICATION = [1, 21, 14]; // NSIA, AMSA, SUNU

const EMPTY_MATRICE_FORM = {
  IdSousGarantie: '',
  IdCompagnie: '',
  TauxFranchise: 0,
  FranchiseMinimum: 0,
  FranchiseMaximum: 0,
  OrdreAffichage: 0,
};

// Chaque sous-garantie (stdsousgarantie) porte des indicateurs de saisie par produit
// (SaisieAuto, SaisieSante, SaisieRd, SaisieTransport). C'est la vraie relation
// produit ↔ garantie en base - bien plus fiable qu'une déduction par code tarif.
// "Rd" (Risques Divers) couvre les branches CIMA Dommages corporels, Incendie/Multirisques
// (MRH), Autres dommages aux biens et Responsabilité Civile.
const BRANCHE_TO_SAISIE_FLAG = {
  '200': 'SaisieAuto',
  '120': 'SaisieSante',
  '600': 'SaisieTransport',
  '100': 'SaisieRd',
  '300': 'SaisieRd',
  '400': 'SaisieRd',
  '500': 'SaisieRd',
};

export const ParametrageOffresPage = () => {
  const { success, error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState('offres'); // 'offres' | 'matrice'

  // Référentiels réels (stdtarif, stdsousgarantie, stdcompagnie, stdbranche, stdcategorie)
  const [tarifs, setTarifs] = useState([]);
  const [sousGaranties, setSousGaranties] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [branches, setBranches] = useState([]);
  const [categoriesParBranche, setCategoriesParBranche] = useState([]);

  // Filtre Produit (branche CIMA) appliqué aux deux onglets - '' = tous les produits ; ?branche=600 : ouvert depuis les
  // Réglages par branche
  const [parametresUrl] = useSearchParams();
  const [selectedBranche, setSelectedBranche] = useState(() => parametresUrl.get('branche') || '');
  // Filtre Compagnie - '' = toutes compagnies. Une offre n'a pas de compagnie unique
  // (le lien se fait via stdoffregarantie), donc ce filtre ne garde que les offres
  // ayant au moins une garantie liée à la compagnie choisie.
  const [selectedCompagnie, setSelectedCompagnie] = useState('');

  // Offres (stdoffre) - chargées et persistées via l'API réelle
  const [offres, setOffres] = useState([]);
  const [loadingOffres, setLoadingOffres] = useState(true);

  // Matrice Offre ↔ Garantie (stdoffregarantie) - filtrée par offre sélectionnée
  const [matriceOffreId, setMatriceOffreId] = useState('');
  const [matrice, setMatrice] = useState([]);
  const [loadingMatrice, setLoadingMatrice] = useState(false);
  // Montants réels (taux, prime forfaitaire, capital) de la grille tarifaire de
  // l'offre sélectionnée (stdtarifdetail), par sous-garantie
  const [tarifDetails, setTarifDetails] = useState([]);

  const [isOffreModalOpen, setIsOffreModalOpen] = useState(false);
  const [isMatriceModalOpen, setIsMatriceModalOpen] = useState(false);
  const [editingOffre, setEditingOffre] = useState(null);
  const [editingLien, setEditingLien] = useState(null);
  const [deletingOffre, setDeletingOffre] = useState(null);
  const [deletingLien, setDeletingLien] = useState(null);

  const [offreForm, setOffreForm] = useState(EMPTY_OFFRE_FORM);
  const [matriceForm, setMatriceForm] = useState(EMPTY_MATRICE_FORM);

  const reloadOffres = () => {
    setLoadingOffres(true);
    settingsApi.getOffres(selectedCompagnie || undefined)
      .then((res) => setOffres(Array.isArray(res) ? res : []))
      .catch(() => toastError("Impossible de charger le catalogue des offres."))
      .finally(() => setLoadingOffres(false));
  };

  useEffect(() => {
    settingsApi.getTarifs().then((res) => setTarifs(Array.isArray(res) ? res : [])).catch(() => {});
    settingsApi.getSousGaranties().then((res) => setSousGaranties(Array.isArray(res) ? res : [])).catch(() => {});
    settingsApi.getCompanies().then((res) => setCompanies(Array.isArray(res) ? res : [])).catch(() => {});
    settingsApi.getBranches().then((res) => setBranches(Array.isArray(res) ? res : [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recharge le catalogue à chaque changement du filtre Compagnie
  useEffect(() => {
    reloadOffres();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompagnie]);

  // Catégories CIMA de la branche sélectionnée (le backend filtre par 1er chiffre du code)
  useEffect(() => {
    if (!selectedBranche) {
      setCategoriesParBranche([]);
      return;
    }
    settingsApi.getCategories(selectedBranche).then((res) => setCategoriesParBranche(Array.isArray(res) ? res : [])).catch(() => {});
  }, [selectedBranche]);

  useEffect(() => {
    if (!matriceOffreId) {
      setMatrice([]);
      setTarifDetails([]);
      return;
    }
    setLoadingMatrice(true);
    settingsApi.getOffreGarantiesParOffre(matriceOffreId)
      .then((res) => setMatrice(Array.isArray(res) ? res : []))
      .catch(() => toastError("Impossible de charger les garanties liées à cette offre."))
      .finally(() => setLoadingMatrice(false));

    // Montants réels (stdtarifdetail) de la grille tarifaire propre à cette offre
    const idTarif = offres.find((o) => o.IdOffre === Number(matriceOffreId))?.TarifOffre;
    if (idTarif) {
      settingsApi.getTarifDetailsParTarif(idTarif)
        .then((res) => setTarifDetails(Array.isArray(res) ? res : []))
        .catch(() => setTarifDetails([]));
    } else {
      setTarifDetails([]);
    }
  }, [matriceOffreId, offres]);

  // Tarifs appartenant au produit sélectionné (via leur catégorie CIMA)
  const tarifsDuProduit = useMemo(() => {
    if (!selectedBranche) return tarifs;
    const idCategories = new Set(categoriesParBranche.map((c) => c.IdCategorie));
    return tarifs.filter((t) => idCategories.has(t.IdCategorie));
  }, [tarifs, selectedBranche, categoriesParBranche]);

  // Offres appartenant au produit sélectionné (via leur tarif rattaché)
  const offresDuProduit = useMemo(() => {
    if (!selectedBranche) return offres;
    const idTarifs = new Set(tarifsDuProduit.map((t) => t.IdTarif));
    return offres.filter((o) => o.TarifOffre && idTarifs.has(o.TarifOffre));
  }, [offres, selectedBranche, tarifsDuProduit]);

  // Sous-garanties applicables au produit sélectionné, via les indicateurs réels
  // SaisieAuto / SaisieSante / SaisieRd / SaisieTransport de stdsousgarantie
  const sousGarantiesDuProduit = useMemo(() => {
    if (!selectedBranche) return sousGaranties;
    const flag = BRANCHE_TO_SAISIE_FLAG[selectedBranche];
    if (!flag) return sousGaranties;
    return sousGaranties.filter((g) => Boolean(g[flag]));
  }, [sousGaranties, selectedBranche]);

  // La matrice charge toutes les garanties de l'offre, toutes compagnies confondues :
  // le filtre Compagnie doit aussi s'appliquer ici, pas seulement au catalogue d'offres.
  const matriceFiltree = useMemo(() => {
    if (!selectedCompagnie) return matrice;
    return matrice.filter((m) => Number(m.IdCompagnie) === Number(selectedCompagnie));
  }, [matrice, selectedCompagnie]);

  const tarifLibelle = (idTarif) => tarifs.find((t) => t.IdTarif === Number(idTarif))?.Libelle || `Tarif #${idTarif}`;
  const sousGarantieLibelle = (id) => sousGaranties.find((g) => g.IdSousGarantie === Number(id))?.LibelleSousGarantie || `Garantie #${id}`;
  const compagnieLibelle = (id) => companies.find((c) => c.IdCompagnie === Number(id))?.RaisonSociale || `Compagnie #${id}`;

  const handleSaveOffre = (e) => {
    e.preventDefault();
    if (!offreForm.LibelleOffre.trim()) {
      toastError('Le libellé de l\'offre est requis.');
      return;
    }
    const payload = {
      ...offreForm,
      TarifOffre: offreForm.TarifOffre ? Number(offreForm.TarifOffre) : null,
      JPaiement: Number(offreForm.JPaiement) || 0,
      MajFract: Number(offreForm.MajFract) || 0,
      Anticipation: Number(offreForm.Anticipation) || 0,
      Differe: Number(offreForm.Differe) || 0,
    };
    const request = editingOffre
      ? settingsApi.updateOffre(editingOffre.IdOffre, payload)
      : settingsApi.createOffre(payload);

    request
      .then(() => {
        success(editingOffre ? `Offre "${payload.LibelleOffre}" mise à jour.` : `Offre "${payload.LibelleOffre}" créée.`);
        setIsOffreModalOpen(false);
        reloadOffres();
      })
      .catch(() => toastError("Échec de l'enregistrement de l'offre."));
  };

  // Le moteur de tarification (fn_garantie_offre_cat*_xxx) boucle sur toutes les lignes
  // stdoffregarantie d'une offre/compagnie sans dédoublonner : une même garantie créée deux fois
  // pour la même offre/compagnie serait comptée deux fois dans le devis. Aucune contrainte
  // d'unicité n'existe en base, donc ce garde-fou doit être fait ici.
  const isDuplicateLien = (idSousGarantie, idCompagnie) =>
    matrice.some((m) =>
      Number(m.IdSousGarantie) === Number(idSousGarantie) &&
      Number(m.IdCompagnie) === Number(idCompagnie) &&
      (!editingLien || m.IdOffreGarantie !== editingLien.IdOffreGarantie)
    );

  const handleSaveLien = (e) => {
    e.preventDefault();
    if (!matriceForm.IdSousGarantie || !matriceForm.IdCompagnie) {
      toastError('Sélectionnez une garantie et une compagnie.');
      return;
    }
    if (isDuplicateLien(matriceForm.IdSousGarantie, matriceForm.IdCompagnie)) {
      toastError('Cette garantie est déjà associée à cette offre pour cette compagnie. Modifiez la ligne existante au lieu d\'en créer une nouvelle.');
      return;
    }
    const payload = {
      IdOffre: Number(matriceOffreId),
      IdSousGarantie: Number(matriceForm.IdSousGarantie),
      IdCompagnie: Number(matriceForm.IdCompagnie),
      TauxFranchise: Number(matriceForm.TauxFranchise) || 0,
      FranchiseMinimum: Number(matriceForm.FranchiseMinimum) || 0,
      FranchiseMaximum: Number(matriceForm.FranchiseMaximum) || 0,
      OrdreAffichage: Number(matriceForm.OrdreAffichage) || 0,
    };
    const request = editingLien
      ? settingsApi.updateOffreGarantie(editingLien.IdOffreGarantie, payload)
      : settingsApi.createOffreGarantie(payload);

    request
      .then(() => {
        success(editingLien ? 'Association mise à jour.' : 'Garantie associée à l\'offre.');
        setIsMatriceModalOpen(false);
        settingsApi.getOffreGarantiesParOffre(matriceOffreId).then((res) => setMatrice(Array.isArray(res) ? res : []));
      })
      .catch(() => toastError("Échec de l'enregistrement de l'association (droits administrateur requis)."));
  };

  const offreColumns = useMemo(() => [
    {
      header: 'Libellé de l\'Offre',
      render: (r) => (
        <div>
          <strong style={{ color: 'var(--text-primary)', display: 'block' }}>{r.LibelleOffre}</strong>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#60a5fa' }}>#{r.IdOffre}</span>
        </div>
      )
    },
    {
      header: 'Tarif CIMA Rattaché',
      render: (r) => <span style={{ color: '#38bdf8', fontWeight: 600 }}>{r.TarifOffre ? tarifLibelle(r.TarifOffre) : '-'}</span>
    },
    {
      header: 'Garanties Liées',
      render: (r) => (
        <StatusBadge
          label={r.NbGaranties > 0 ? `${r.NbGaranties} garantie(s)` : '⚠ Aucune garantie'}
          color={r.NbGaranties > 0 ? 'emerald' : 'red'}
        />
      )
    },
    {
      header: 'Paiement',
      render: (r) => <span style={{ fontFamily: 'var(--font-mono)' }}>{r.Payement} · {r.JPaiement}j · maj {r.MajFract}%</span>
    },
    {
      header: 'Options',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {r.Entreprise && <StatusBadge label="Entreprise" color="sky" />}
          {r.Flotte && <StatusBadge label="Flotte" color="violet" />}
          {r.Gestion && <StatusBadge label="Gestion" color="amber" />}
          {r.ExoneredeTaxes && <StatusBadge label="Exo. Taxes" color="emerald" />}
        </div>
      )
    },
    {
      header: 'Statut',
      render: (r) => <StatusBadge label={r.Actif ? 'Actif' : 'Inactif'} color={r.Actif ? 'emerald' : 'slate'} />
    },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            onClick={() => {
              setEditingOffre(r);
              setOffreForm({
                LibelleOffre: r.LibelleOffre || '',
                TarifOffre: r.TarifOffre || '',
                Actif: Boolean(r.Actif),
                Visibilite: r.Visibilite || 'T',
                Payement: r.Payement || 'A',
                JPaiement: r.JPaiement ?? 1,
                MajFract: r.MajFract ?? 0,
                Anticipation: r.Anticipation ?? 26,
                Differe: r.Differe ?? 0,
                Echeance: r.Echeance || 'L',
                Renouvelable: r.Renouvelable || 'L',
                Ppr: r.Ppr || 'N',
                Entreprise: Boolean(r.Entreprise),
                Flotte: Boolean(r.Flotte),
                Gestion: Boolean(r.Gestion),
                ExoneredeTaxes: Boolean(r.ExoneredeTaxes),
                ExoneredeAccess: Boolean(r.ExoneredeAccess),
              });
              setIsOffreModalOpen(true);
            }}
          >
            Modifier
          </button>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.45rem', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            onClick={() => setDeletingOffre(r)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )
    }
  ], [tarifs]);

  const matriceColumns = useMemo(() => [
    {
      header: 'Garantie CIMA',
      render: (r) => <strong style={{ color: 'var(--text-primary)' }}>{sousGarantieLibelle(r.IdSousGarantie)}</strong>
    },
    {
      header: 'Compagnie',
      render: (r) => <span style={{ color: '#38bdf8', fontWeight: 600 }}>{compagnieLibelle(r.IdCompagnie)}</span>
    },
    {
      header: 'Franchise',
      render: (r) => {
        const taux = Number(r.TauxFranchise) || 0;
        const min = Number(r.FranchiseMinimum) || 0;
        const max = Number(r.FranchiseMaximum) || 0;
        if (taux === 0 && min === 0 && max === 0) {
          return <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Néant</span>;
        }
        return (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {taux}% (Min: {formatMoney(min)} / Max: {formatMoney(max)})
          </span>
        );
      }
    },
    {
      header: 'Montants (grille tarifaire)',
      render: (r) => {
        const detail = tarifDetails.find((td) => td.IdGarantie === Number(r.IdSousGarantie));
        if (!detail) return <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>-</span>;
        const taux = Number(detail.Taux) || 0;
        const primeGar = Number(detail.PrimeGar) || 0;
        const capitalMax = Number(detail.CapitalMax) || 0;
        return (
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            {taux > 0 && <>Taux: {taux}% </>}
            {primeGar > 0 && <>Prime forfait: {formatMoney(primeGar)} </>}
            {capitalMax > 0 && capitalMax < 999999999 && <>Capital max: {formatMoney(capitalMax)}</>}
            {taux === 0 && primeGar === 0 && (capitalMax === 0 || capitalMax >= 999999999) && '-'}
          </span>
        );
      }
    },
    {
      header: 'Ordre',
      render: (r) => <span style={{ fontFamily: 'var(--font-mono)' }}>{r.OrdreAffichage}</span>
    },
    {
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            onClick={() => {
              setEditingLien(r);
              setMatriceForm({
                IdSousGarantie: r.IdSousGarantie,
                IdCompagnie: r.IdCompagnie,
                TauxFranchise: r.TauxFranchise,
                FranchiseMinimum: r.FranchiseMinimum,
                FranchiseMaximum: r.FranchiseMaximum,
                OrdreAffichage: r.OrdreAffichage,
              });
              setIsMatriceModalOpen(true);
            }}
          >
            Modifier
          </button>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.45rem', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            onClick={() => setDeletingLien(r)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )
    }
  ], [sousGaranties, companies, tarifDetails]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Tag size={28} color="#0284c7" />
            Offres
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Les formules proposées par compagnie et par catégorie, avec les garanties comprises et leurs franchises.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {activeTab === 'offres' ? (
            <button
              className="btn btn-primary"
              onClick={() => {
                setEditingOffre(null);
                setOffreForm(EMPTY_OFFRE_FORM);
                setIsOffreModalOpen(true);
              }}
            >
              <Plus size={16} /> Nouvelle Offre
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={!matriceOffreId}
              onClick={() => {
                setEditingLien(null);
                setMatriceForm({ ...EMPTY_MATRICE_FORM, IdCompagnie: selectedCompagnie || '' });
                setIsMatriceModalOpen(true);
              }}
            >
              <Plus size={16} /> Associer une Garantie à l'Offre
            </button>
          )}
        </div>
      </div>

      {/* Filtre Produit (branche CIMA) - s'applique aux deux onglets */}
      <div className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <label className="form-label" style={{ margin: 0 }}>Produit :</label>
        <select
          className="form-control"
          style={{ maxWidth: '320px' }}
          value={selectedBranche}
          onChange={(e) => {
            setSelectedBranche(e.target.value);
            setMatriceOffreId('');
          }}
        >
          <option value="">Tous les produits</option>
          {trierParLibelle(branches, (b) => b.LibelleBranche).map((b) => (
            <option key={b.IdBranche} value={b.CodeBranche}>{b.LibelleBranche}</option>
          ))}
        </select>

        <label className="form-label" style={{ margin: 0 }}>Compagnie :</label>
        <select
          className="form-control"
          style={{ maxWidth: '280px' }}
          value={selectedCompagnie}
          onChange={(e) => {
            setSelectedCompagnie(e.target.value);
            setMatriceOffreId('');
          }}
        >
          <option value="">Toutes les compagnies</option>
          {sortUniqueBy(companies, (c) => c.RaisonSociale).map((c) => (
            <option key={c.IdCompagnie} value={c.IdCompagnie}>{c.RaisonSociale}</option>
          ))}
        </select>

        {(selectedBranche || selectedCompagnie) && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            {offresDuProduit.length} offre(s){selectedBranche ? ` · ${sousGarantiesDuProduit.length} garantie(s) pour ce produit` : ''}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
        <button
          type="button"
          onClick={() => setActiveTab('offres')}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1.2rem',
            borderRadius: 'var(--radius-md)', border: 'none', fontSize: '0.875rem',
            fontWeight: activeTab === 'offres' ? 700 : 500, cursor: 'pointer',
            background: activeTab === 'offres' ? 'rgba(2, 132, 199, 0.15)' : 'transparent',
            color: activeTab === 'offres' ? '#38bdf8' : 'var(--text-muted)',
            borderBottom: activeTab === 'offres' ? '2px solid #0284c7' : '2px solid transparent',
          }}
        >
          <Tag size={16} />
          <span>Catalogue des Offres ({offresDuProduit.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('matrice')}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1.2rem',
            borderRadius: 'var(--radius-md)', border: 'none', fontSize: '0.875rem',
            fontWeight: activeTab === 'matrice' ? 700 : 500, cursor: 'pointer',
            background: activeTab === 'matrice' ? 'rgba(2, 132, 199, 0.15)' : 'transparent',
            color: activeTab === 'matrice' ? '#38bdf8' : 'var(--text-muted)',
            borderBottom: activeTab === 'matrice' ? '2px solid #0284c7' : '2px solid transparent',
          }}
        >
          <Sliders size={16} />
          <span>Matrice Offres ↔ Garanties</span>
        </button>
      </div>

      {activeTab === 'matrice' && (
        <div className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <label className="form-label" style={{ margin: 0 }}>Offre à consulter / modifier :</label>
          <select
            className="form-control"
            style={{ maxWidth: '420px' }}
            value={matriceOffreId}
            onChange={(e) => setMatriceOffreId(e.target.value)}
          >
            <option value="">-- Choisir une offre --</option>
            {sortUniqueBy(offresDuProduit, (o) => o.LibelleOffre).map((o) => (
              <option key={o.IdOffre} value={o.IdOffre}>{o.LibelleOffre}</option>
            ))}
          </select>
          {!matriceOffreId && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              <Info size={14} /> Sélectionnez une offre pour voir ses garanties liées.
            </span>
          )}
        </div>
      )}

      {/* Content Table */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        {activeTab === 'offres' ? (
          <DataTable
            columns={offreColumns}
            data={offresDuProduit}
            loading={loadingOffres}
            searchPlaceholder="Rechercher une offre..."
          />
        ) : (
          <DataTable
            columns={matriceColumns}
            data={matriceFiltree}
            loading={loadingMatrice}
            searchPlaceholder="Filtrer les garanties associées..."
          />
        )}
      </div>

      {/* Modal Créer/Modifier Offre */}
      <Modal
        isOpen={isOffreModalOpen}
        onClose={() => setIsOffreModalOpen(false)}
        title={editingOffre ? "Modifier l'Offre Commerciale" : 'Nouvelle Offre Commerciale'}
        size="large"
      >
        <form onSubmit={handleSaveOffre} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Libellé de l'Offre (* requis)</label>
            <input
              type="text"
              className="form-control"
              value={offreForm.LibelleOffre}
              onChange={(e) => setOffreForm({ ...offreForm, LibelleOffre: e.target.value })}
              required
              placeholder="Ex: OFFRE AUTOMOBILE TOUS RISQUES"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Tarif CIMA Rattaché (catégorie tarifaire)</label>
            <select
              className="form-control"
              value={offreForm.TarifOffre}
              onChange={(e) => setOffreForm({ ...offreForm, TarifOffre: e.target.value })}
            >
              <option value="">-- Aucun --</option>
              {sortUniqueBy(selectedBranche ? tarifsDuProduit : tarifs, (t) => t.Libelle).map((t) => (
                <option key={t.IdTarif} value={t.IdTarif}>{t.Libelle} - {t.CodeCategorie}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Mode Paiement</label>
              <select className="form-control" value={offreForm.Payement} onChange={(e) => setOffreForm({ ...offreForm, Payement: e.target.value })}>
                <option value="A">A - Annuel</option>
                <option value="T">T - Trimestriel/Fractionné</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Délai Paiement (jours)</label>
              <input type="number" className="form-control" value={offreForm.JPaiement} onChange={(e) => setOffreForm({ ...offreForm, JPaiement: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Majoration Fractionnement (%)</label>
              <input type="number" className="form-control" value={offreForm.MajFract} onChange={(e) => setOffreForm({ ...offreForm, MajFract: e.target.value })} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Anticipation (jours)</label>
              <input type="number" className="form-control" value={offreForm.Anticipation} onChange={(e) => setOffreForm({ ...offreForm, Anticipation: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Différé (jours)</label>
              <input type="number" className="form-control" value={offreForm.Differe} onChange={(e) => setOffreForm({ ...offreForm, Differe: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Visibilité</label>
              <select className="form-control" value={offreForm.Visibilite} onChange={(e) => setOffreForm({ ...offreForm, Visibilite: e.target.value })}>
                <option value="P">P - Partielle</option>
                <option value="T">T - Totale</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Échéance</label>
              <select className="form-control" value={offreForm.Echeance} onChange={(e) => setOffreForm({ ...offreForm, Echeance: e.target.value })}>
                <option value="A">A</option>
                <option value="L">L</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Renouvelable</label>
              <select className="form-control" value={offreForm.Renouvelable} onChange={(e) => setOffreForm({ ...offreForm, Renouvelable: e.target.value })}>
                <option value="L">L - Libre</option>
                <option value="N">N - Non</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">PPR</label>
              <select className="form-control" value={offreForm.Ppr} onChange={(e) => setOffreForm({ ...offreForm, Ppr: e.target.value })}>
                <option value="N">N - Non</option>
                <option value="R">R - Requis</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem 1rem' }}>
            {[
              ['Actif', 'Offre active'],
              ['Entreprise', 'Réservée entreprise'],
              ['Flotte', 'Éligible flotte'],
              ['Gestion', 'Sous gestion'],
              ['ExoneredeTaxes', 'Exonérée de taxes'],
              ['ExoneredeAccess', 'Exonérée accessoires'],
            ].map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={Boolean(offreForm[key])}
                  onChange={(e) => setOffreForm({ ...offreForm, [key]: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: '#0284c7' }}
                />
                {label}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsOffreModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary">Enregistrer l'Offre</button>
          </div>
        </form>
      </Modal>

      {/* Modal Associer Garantie à Offre */}
      <Modal
        isOpen={isMatriceModalOpen}
        onClose={() => setIsMatriceModalOpen(false)}
        title={editingLien ? 'Modifier une Garantie de l\'Offre' : 'Associer une Garantie à cette Offre'}
      >
        <form onSubmit={handleSaveLien} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Garantie CIMA à Inclure (* requis)</label>
            <select
              className="form-control"
              value={matriceForm.IdSousGarantie}
              onChange={(e) => setMatriceForm({ ...matriceForm, IdSousGarantie: e.target.value })}
              required
            >
              <option value="">-- Choisir une garantie --</option>
              {sortUniqueBy(selectedBranche ? sousGarantiesDuProduit : sousGaranties, (g) => g.LibelleSousGarantie).map((g) => (
                <option key={g.IdSousGarantie} value={g.IdSousGarantie}>{g.LibelleSousGarantie}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Compagnie (* requis)</label>
            <select
              className="form-control"
              value={matriceForm.IdCompagnie}
              onChange={(e) => setMatriceForm({ ...matriceForm, IdCompagnie: e.target.value })}
              required
            >
              <option value="">-- Choisir une compagnie --</option>
              <optgroup label="Moteur de tarification actif">
                {sortUniqueBy(
                  companies.filter((c) => COMPAGNIES_MOTEUR_TARIFICATION.includes(Number(c.IdCompagnie))),
                  (c) => c.RaisonSociale
                ).map((c) => (
                  <option key={c.IdCompagnie} value={c.IdCompagnie}>{c.RaisonSociale}</option>
                ))}
              </optgroup>
              <optgroup label="Autres compagnies (calcul de prime non câblé)">
                {sortUniqueBy(
                  companies.filter((c) => !COMPAGNIES_MOTEUR_TARIFICATION.includes(Number(c.IdCompagnie))),
                  (c) => c.RaisonSociale
                ).map((c) => (
                  <option key={c.IdCompagnie} value={c.IdCompagnie}>{c.RaisonSociale}</option>
                ))}
              </optgroup>
            </select>
            {matriceForm.IdCompagnie && !COMPAGNIES_MOTEUR_TARIFICATION.includes(Number(matriceForm.IdCompagnie)) && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#fbbf24', fontSize: '0.78rem', marginTop: '0.35rem' }}>
                <Info size={13} /> Cette compagnie n'a pas encore de moteur de calcul de primes câblé : l'association sera enregistrée mais n'apparaîtra pas dans le devis automatique.
              </span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Taux Franchise (%)</label>
              <input
                type="number"
                step="0.01"
                className="form-control"
                value={matriceForm.TauxFranchise}
                onChange={(e) => setMatriceForm({ ...matriceForm, TauxFranchise: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Franchise Minimum</label>
              <AmountInput value={matriceForm.FranchiseMinimum} onChange={(v) => setMatriceForm({ ...matriceForm, FranchiseMinimum: v })} />
            </div>
            <div className="form-group">
              <label className="form-label">Franchise Maximum</label>
              <AmountInput value={matriceForm.FranchiseMaximum} onChange={(v) => setMatriceForm({ ...matriceForm, FranchiseMaximum: v })} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Ordre d'Affichage</label>
            <input
              type="number"
              className="form-control"
              value={matriceForm.OrdreAffichage}
              onChange={(e) => setMatriceForm({ ...matriceForm, OrdreAffichage: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsMatriceModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary">Valider la Liaison</button>
          </div>
        </form>
      </Modal>

      {/* Delete modal Offre */}
      <DeleteConfirmModal
        isOpen={!!deletingOffre}
        onClose={() => setDeletingOffre(null)}
        itemType="offre commerciale"
        itemName={deletingOffre?.LibelleOffre}
        itemCode={deletingOffre ? `#${deletingOffre.IdOffre}` : ''}
        validation={{ allowed: true }}
        onConfirm={() => {
          if (!deletingOffre) return;
          settingsApi.deleteOffre(deletingOffre.IdOffre)
            .then(() => {
              success(`Offre ${deletingOffre.LibelleOffre} supprimée.`);
              setDeletingOffre(null);
              reloadOffres();
            })
            .catch(() => {
              toastError("Suppression impossible (l'offre est peut-être utilisée par des devis existants).");
              setDeletingOffre(null);
            });
        }}
      />

      {/* Delete modal Lien */}
      <DeleteConfirmModal
        isOpen={!!deletingLien}
        onClose={() => setDeletingLien(null)}
        itemType="association garantie"
        itemName={deletingLien ? sousGarantieLibelle(deletingLien.IdSousGarantie) : ''}
        itemCode={deletingLien ? `#${deletingLien.IdOffreGarantie}` : ''}
        validation={{ allowed: true }}
        onConfirm={() => {
          if (!deletingLien) return;
          settingsApi.deleteOffreGarantie(deletingLien.IdOffreGarantie)
            .then(() => {
              success('Association retirée de l\'offre.');
              setDeletingLien(null);
              settingsApi.getOffreGarantiesParOffre(matriceOffreId).then((res) => setMatrice(Array.isArray(res) ? res : []));
            })
            .catch(() => {
              toastError("Suppression impossible (droits administrateur requis).");
              setDeletingLien(null);
            });
        }}
      />
    </div>
  );
};

export default ParametrageOffresPage;
