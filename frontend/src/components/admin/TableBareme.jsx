import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Edit2, Copy, Trash2, RefreshCw, Search, Loader2, AlertTriangle } from 'lucide-react';
import { DataTable } from '../common/DataTable';
import { Modal } from '../common/Modal';
import { AmountInput } from '../common/AmountInput';
import { parametrageApi, settingsApi } from '../../api/endpoints';
import { messageErreurApi } from '../../utils/financeUtils';
import { useToast } from '../../context/ToastContext';

/**
 * Tableau d'un barème de la base (taux de taxe, commissions, accessoires, réductions flotte…)
 * modifiable ligne à ligne. Chaque colonne décrit un champ de la route DRF :
 *   { champ, titre, type, requis, min, max, aide, filtre, role }
 * type : 'compagnie' | 'produit' | 'garantie' | 'sousgarantie' | 'tarif' (listes de la base), 'texte', 'entier', 'nombre',
 *        'pourcentage', 'montant', 'date' ; filtre : liste de filtre au-dessus du tableau ;
 * options : filtre des choix d'une liste de la base (ex. catégories tarifaires de l'Automobile) ;
 * masquee : champ du formulaire seulement, absent du tableau ;
 * role : 'debut' / 'fin' pour les dates de validité (statut « En vigueur », contrôle début <= fin).
 * Les filtres se pré-remplissent depuis l'adresse (?compagnie=21&produit=1). `dupliquer` à false masque
 * « Dupliquer » pour les tables qui n'acceptent qu'une ligne par clé (ex. une taxe par sous-garantie).
 */

const REFERENTIELS = ['compagnie', 'produit', 'garantie', 'sousgarantie', 'tarif'];
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const formatMontant = (v) => (v === null || v === undefined || v === '' ? '-' : `${Math.round(Number(v)).toLocaleString('fr-FR').replace(/ | /g, ' ')} F`);
const formatNombre = (v, decimales = 2) => (v === null || v === undefined || v === '' ? '-' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: decimales }));
const formatDate = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const normaliser = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Montant reçu de l'API en texte décimal (« 5000.0000 ») : AmountInput n'attend que des chiffres
const montantSaisi = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : Math.round(Number(v)));

const statutValidite = (ligne, colonnes) => {
  const debut = colonnes.find((c) => c.role === 'debut');
  const fin = colonnes.find((c) => c.role === 'fin');
  if (!debut && !fin) return null;
  const jour = aujourdhui();
  if (debut && ligne[debut.champ] && String(ligne[debut.champ]).slice(0, 10) > jour) return { libelle: 'À venir', couleur: 'badge-blue' };
  if (fin && ligne[fin.champ] && String(ligne[fin.champ]).slice(0, 10) < jour) return { libelle: 'Expirée', couleur: 'badge-slate' };
  return { libelle: 'En vigueur', couleur: 'badge-emerald' };
};

export const TableBareme = ({
  route,
  cle,
  libelle,
  colonnes,
  valeursParDefaut = {},
  controle,
  tri,
  itemsParPage = 25,
  dupliquer = true,
}) => {
  const { success, error: toastError } = useToast();
  const [parametresUrl] = useSearchParams();
  const api = useMemo(() => parametrageApi.bareme(route), [route]);
  const [lignes, setLignes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [referentiels, setReferentiels] = useState({ compagnie: [], produit: [], garantie: [], sousgarantie: [], tarif: [] });
  const [filtres, setFiltres] = useState(() => Object.fromEntries(
    colonnes.filter((c) => c.filtre).map((c) => [c.champ, parametresUrl.get(c.type) || parametresUrl.get(c.champ) || '']),
  ));
  const [recherche, setRecherche] = useState('');
  const [edition, setEdition] = useState(null); // { ligne, nouvelle }
  const [erreurSaisie, setErreurSaisie] = useState('');
  const [enregistrement, setEnregistrement] = useState(false);
  const [suppression, setSuppression] = useState(null);

  const types = useMemo(() => new Set(colonnes.map((c) => c.type)), [colonnes]);

  const charger = async () => {
    setChargement(true);
    try {
      setLignes(await api.lister());
    } catch (err) {
      toastError(`Chargement impossible : ${messageErreurApi(err)}`);
    } finally {
      setChargement(false);
    }
  };

  useEffect(() => {
    charger();
    const demandes = [];
    if (types.has('compagnie')) {
      demandes.push(parametrageApi.getCompagnies().then((l) => ['compagnie', l.map((c) => ({ id: c.IdCompagnie, libelle: c.RaisonSociale, inactif: !c.Active }))]));
    }
    if (types.has('produit')) {
      demandes.push(parametrageApi.getProduits().then((d) => ['produit', d.Produits.map((p) => ({ id: p.IdProduit, libelle: p.Libelle, inactif: !p.Actif }))]));
    }
    if (types.has('garantie')) {
      demandes.push(settingsApi.getGuarantees().then((l) => ['garantie', l.map((g) => ({ id: g.IdGarantie, libelle: g.LibelleGarantie, inactif: g.Active === false }))]));
    }
    if (types.has('sousgarantie')) {
      demandes.push(settingsApi.getSousGaranties().then((l) => ['sousgarantie', l
        .map((g) => ({ id: g.IdSousGarantie, libelle: g.LibelleSousGarantie, inactif: g.Active === false }))
        .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'))]));
    }
    if (types.has('tarif')) {
      demandes.push(parametrageApi.bareme('tarif').lister().then((l) => ['tarif', l
        .map((t) => ({ id: t.IdTarif, libelle: `${t.CodeCategorie} - ${t.Libelle}`, code: String(t.CodeCategorie || '') }))
        .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'))]));
    }
    Promise.all(demandes)
      .then((res) => setReferentiels((avant) => ({ ...avant, ...Object.fromEntries(res) })))
      .catch((err) => toastError(`Listes de référence non chargées : ${messageErreurApi(err)}`));
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  const libelleRef = (type, id) => {
    if (id === null || id === undefined || id === '') return '-';
    const trouve = referentiels[type]?.find((r) => Number(r.id) === Number(id));
    return trouve ? trouve.libelle : `n° ${id}`;
  };

  const texteCellule = (c, ligne) => {
    const v = ligne[c.champ];
    if (REFERENTIELS.includes(c.type)) return libelleRef(c.type, v);
    if (c.type === 'montant') return formatMontant(v);
    if (c.type === 'pourcentage') return v === null || v === undefined || v === '' ? '-' : `${formatNombre(v)} %`;
    if (c.type === 'nombre') return formatNombre(v, 4);
    if (c.type === 'entier') return v === null || v === undefined || v === '' ? '-' : String(v);
    if (c.type === 'date') return formatDate(v);
    return v || '-';
  };

  const visibles = useMemo(() => {
    const terme = normaliser(recherche.trim());
    const liste = lignes.filter((l) => Object.entries(filtres).every(([champ, val]) => val === '' || String(l[champ]) === String(val)))
      .filter((l) => !terme || colonnes.some((c) => normaliser(texteCellule(c, l)).includes(terme)));
    const comparer = tri || ((a, b) => {
      for (const c of colonnes) {
        const va = REFERENTIELS.includes(c.type) || c.type === 'texte' ? normaliser(texteCellule(c, a)) : Number(a[c.champ]) || 0;
        const vb = REFERENTIELS.includes(c.type) || c.type === 'texte' ? normaliser(texteCellule(c, b)) : Number(b[c.champ]) || 0;
        if (va < vb) return -1;
        if (va > vb) return 1;
      }
      return 0;
    });
    return [...liste].sort(comparer);
  }, [lignes, filtres, recherche, referentiels, colonnes, tri]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ saisie
  const ouvrir = (ligne, nouvelle) => {
    setErreurSaisie('');
    if (nouvelle) {
      const base = ligne ? { ...ligne } : { ...valeursParDefaut };
      delete base[cle];
      Object.entries(filtres).forEach(([champ, val]) => { if (val !== '' && !ligne) base[champ] = Number(val); });
      colonnes.filter((c) => c.role === 'debut' && !base[c.champ]).forEach((c) => { base[c.champ] = aujourdhui(); });
      setEdition({ ligne: base, nouvelle: true });
    } else {
      setEdition({ ligne: { ...ligne }, nouvelle: false });
    }
  };

  const changer = (champ, valeur) => setEdition((e) => ({ ...e, ligne: { ...e.ligne, [champ]: valeur } }));

  const verifier = (ligne) => {
    for (const c of colonnes) {
      const v = ligne[c.champ];
      const vide = v === null || v === undefined || String(v).trim() === '';
      if (c.requis && vide) return `${c.titre} : valeur obligatoire.`;
      if (!vide && ['entier', 'nombre', 'pourcentage', 'montant'].includes(c.type)) {
        const n = Number(v);
        if (!Number.isFinite(n)) return `${c.titre} : nombre attendu.`;
        if (c.min !== undefined && n < c.min) return `${c.titre} : ${c.min} au minimum.`;
        if (c.max !== undefined && n > c.max) return `${c.titre} : ${c.max} au maximum.`;
        if (c.type === 'entier' && !Number.isInteger(n)) return `${c.titre} : nombre entier attendu.`;
      }
    }
    const debut = colonnes.find((c) => c.role === 'debut');
    const fin = colonnes.find((c) => c.role === 'fin');
    if (debut && fin && ligne[debut.champ] && ligne[fin.champ] && ligne[debut.champ] > ligne[fin.champ]) {
      return 'La fin de validité doit suivre le début de validité.';
    }
    return controle ? controle(ligne, lignes.filter((l) => l[cle] !== ligne[cle])) : null;
  };

  const enregistrer = async (e) => {
    e.preventDefault();
    const message = verifier(edition.ligne);
    if (message) {
      setErreurSaisie(message);
      return;
    }
    const donnees = {};
    colonnes.forEach((c) => {
      const v = edition.ligne[c.champ];
      donnees[c.champ] = v === '' || v === undefined ? null : v;
    });
    setEnregistrement(true);
    try {
      if (edition.nouvelle) await api.creer(donnees);
      else await api.modifier(edition.ligne[cle], donnees);
      success(edition.nouvelle ? `${libelle} ajouté(e) : appliqué(e) aux prochains calculs.` : `${libelle} modifié(e) : appliqué(e) aux prochains calculs.`);
      setEdition(null);
      await charger();
    } catch (err) {
      setErreurSaisie(messageErreurApi(err));
    } finally {
      setEnregistrement(false);
    }
  };

  const supprimer = async () => {
    setEnregistrement(true);
    try {
      await api.supprimer(suppression[cle]);
      success(`${libelle} supprimé(e).`);
      setSuppression(null);
      await charger();
    } catch (err) {
      toastError(`Suppression refusée : ${messageErreurApi(err)}`);
    } finally {
      setEnregistrement(false);
    }
  };

  // ------------------------------------------------------------------ affichage
  const colonnesTableau = [
    ...colonnes.filter((c) => !c.masquee).map((c) => ({
      header: c.titre,
      sortAccessor: (l) => (REFERENTIELS.includes(c.type) || c.type === 'texte' ? normaliser(texteCellule(c, l)) : Number(l[c.champ]) || 0),
      render: (l) => (
        <span style={{
          fontWeight: REFERENTIELS.includes(c.type) ? 600 : 500,
          color: 'var(--text-primary)',
          fontFamily: ['montant', 'pourcentage', 'nombre', 'entier'].includes(c.type) ? 'var(--font-mono)' : undefined,
          whiteSpace: c.type === 'date' || c.type === 'montant' ? 'nowrap' : undefined,
        }}>
          {texteCellule(c, l)}
        </span>
      ),
    })),
    ...(colonnes.some((c) => c.role) ? [{
      header: 'Statut',
      sortAccessor: (l) => statutValidite(l, colonnes)?.libelle || '',
      render: (l) => {
        const s = statutValidite(l, colonnes);
        return s ? <span className={`badge ${s.couleur}`}>{s.libelle}</span> : null;
      },
    }] : []),
    {
      header: 'Actions',
      render: (l) => (
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          <button type="button" className="btn btn-secondary" title="Modifier" onClick={() => ouvrir(l, false)} style={{ padding: '0.25rem 0.5rem' }}><Edit2 size={14} /></button>
          {dupliquer && <button type="button" className="btn btn-secondary" title="Dupliquer (ex. nouvelle période de validité)" onClick={() => ouvrir(l, true)} style={{ padding: '0.25rem 0.5rem' }}><Copy size={14} /></button>}
          <button type="button" className="btn btn-secondary" title="Supprimer" onClick={() => setSuppression(l)} style={{ padding: '0.25rem 0.5rem', color: 'var(--accent-rose)' }}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ];

  const champSaisie = (c) => {
    const v = edition.ligne[c.champ];
    const commun = { id: `champ-${c.champ}`, required: c.requis };
    if (REFERENTIELS.includes(c.type)) {
      const options = (referentiels[c.type] || []).filter(c.options || (() => true));
      return (
        <select {...commun} className="form-control" value={v ?? ''} onChange={(e) => changer(c.champ, e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">Choisir</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.libelle}{o.inactif ? ' - inactif' : ''}</option>)}
        </select>
      );
    }
    if (c.type === 'montant') return <AmountInput {...commun} value={montantSaisi(v)} onChange={(n) => changer(c.champ, n)} suffix="FCFA" />;
    if (c.type === 'date') return <input {...commun} type="date" className="form-control" value={v ? String(v).slice(0, 10) : ''} onChange={(e) => changer(c.champ, e.target.value)} />;
    if (['entier', 'nombre', 'pourcentage'].includes(c.type)) {
      return (
        <div style={{ position: 'relative' }}>
          <input {...commun} type="number" className="form-control" step={c.type === 'entier' ? 1 : 'any'} min={c.min} max={c.max}
            value={v ?? ''} onChange={(e) => changer(c.champ, e.target.value)} style={{ paddingRight: c.type === 'pourcentage' ? '1.8rem' : undefined }} />
          {c.type === 'pourcentage' && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>%</span>}
        </div>
      );
    }
    return <input {...commun} type="text" className="form-control" value={v ?? ''} maxLength={c.longueur || 100} onChange={(e) => changer(c.champ, e.target.value)} />;
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.9rem' }}>
        {colonnes.filter((c) => c.filtre).map((c) => (
          <div key={c.champ} style={{ minWidth: 200 }}>
            <label className="form-label" htmlFor={`filtre-${c.champ}`}>{c.titre}</label>
            <select id={`filtre-${c.champ}`} className="form-control" value={filtres[c.champ]} onChange={(e) => setFiltres((f) => ({ ...f, [c.champ]: e.target.value }))}>
              <option value="">Tous</option>
              {(referentiels[c.type] || [])
                .filter((o) => lignes.some((l) => Number(l[c.champ]) === Number(o.id)) || String(o.id) === filtres[c.champ])
                .map((o) => <option key={o.id} value={o.id}>{o.libelle}</option>)}
            </select>
          </div>
        ))}
        <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
          <label className="form-label" htmlFor={`recherche-${route}`}>Rechercher</label>
          <Search size={14} style={{ position: 'absolute', left: 10, bottom: 10, color: 'var(--text-muted)' }} />
          <input id={`recherche-${route}`} className="form-control" style={{ paddingLeft: '1.9rem' }} placeholder="Libellé, montant, taux…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </div>
        <button type="button" className="btn btn-secondary" onClick={charger} title="Recharger depuis la base" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><RefreshCw size={14} /> Actualiser</button>
        <button type="button" className="btn btn-primary" onClick={() => ouvrir(null, true)} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Plus size={15} /> Ajouter</button>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
        {chargement ? 'Chargement…' : `${visibles.length} ligne${visibles.length > 1 ? 's' : ''}${visibles.length !== lignes.length ? ` sur ${lignes.length}` : ''}`}
      </div>
      <DataTable columns={colonnesTableau} data={visibles} loading={chargement} searchable={false} itemsPerPage={itemsParPage} />

      <Modal
        isOpen={!!edition}
        onClose={() => !enregistrement && setEdition(null)}
        title={edition?.nouvelle ? `Ajouter : ${libelle}` : `Modifier : ${libelle}`}
        subtitle="Les calculs des devis utilisent la nouvelle valeur dès l'enregistrement ; les devis déjà enregistrés ne changent pas."
        size="medium"
      >
        {edition && (
          <form onSubmit={enregistrer}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', columnGap: '1rem' }}>
              {colonnes.map((c) => (
                <div className="form-group" key={c.champ}>
                  <label className="form-label" htmlFor={`champ-${c.champ}`}>{c.titre}{c.requis ? ' *' : ''}</label>
                  {champSaisie(c)}
                  {c.aide && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.aide}</span>}
                </div>
              ))}
            </div>
            {erreurSaisie && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.6rem 0.8rem', borderRadius: 8, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.3)', color: 'var(--accent-rose)', fontSize: '0.82rem', marginBottom: '0.8rem' }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {erreurSaisie}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEdition(null)} disabled={enregistrement}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={enregistrement} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {enregistrement && <Loader2 size={14} className="spin" />} Enregistrer
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={!!suppression} onClose={() => !enregistrement && setSuppression(null)} title={`Supprimer : ${libelle}`} size="small">
        {suppression && (
          <div>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 0 }}>
              Cette ligne ne sera plus utilisée par les calculs. Pour arrêter un barème à une date, modifiez plutôt sa fin de validité.
            </p>
            <ul style={{ fontSize: '0.84rem', color: 'var(--text-primary)', paddingLeft: '1.1rem' }}>
              {colonnes.filter((c) => !c.masquee).map((c) => <li key={c.champ}><span style={{ color: 'var(--text-muted)' }}>{c.titre} :</span> {texteCellule(c, suppression)}</li>)}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSuppression(null)} disabled={enregistrement}>Annuler</button>
              <button type="button" className="btn btn-danger" onClick={supprimer} disabled={enregistrement}>Supprimer définitivement</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
