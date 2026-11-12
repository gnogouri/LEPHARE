import React, { useEffect, useMemo, useState } from 'react';
import {
  Link2, Loader2, Pencil, Save, X, Plus, Trash2, ShieldCheck, Gift, Coins, ArrowRightLeft, Ban, EyeOff, CircleSlash, Info,
  Layers, ArrowUpToLine,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { EnTeteParametrage, SectionParametrage } from '../../../components/admin/EnTeteParametrage';
import { parametrageApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { chargerParametrage } from '../../../utils/parametrage';
import { confirmer } from '../../../utils/dialogue';
import { useToast } from '../../../context/ToastContext';

// Règles de gestion Automobile entre garanties, par compagnie (tarif annoté NSIA, « interaction avec les autres
// garanties ») : appliquées par l'écran de devis à chaque garantie cochée, décochée, ajoutée ou retirée
// (utils/tarificationAuto.js, appliquerReglesGaranties) ; « offerte » et « prime forfaitaire » marquées « barème »
// sont aussi appliquées par le calcul de la base aux offres qui contiennent la garantie liée, la « prime minimum » par
// lui seul (fn_lephare_regle_auto). configuration_api/parametrage_auto.py (regles_interactions).

const montant = (v) => Number(v || 0).toLocaleString('fr-FR');
const TYPES = {
  OBLIGATOIRE: { titre: 'Obligatoires', icone: ShieldCheck, couleur: 'var(--accent-indigo)', phrase: () => 'toujours cochée : ne peut être ni décochée ni retirée' },
  OFFERTE_SI: { titre: 'Offertes', icone: Gift, couleur: 'var(--accent-emerald)', phrase: (r) => `offerte (prime nulle) avec ${r.noms}` },
  PRIME_SI: { titre: 'Prime forfaitaire', icone: Coins, couleur: 'var(--accent-cyan)', phrase: (r) => `${montant(r.PrimeAnnuelle)} F par an avec ${r.noms}, au prorata de la durée` },
  PRIME_MINIMUM: { titre: 'Primes minimums', icone: ArrowUpToLine, couleur: 'var(--accent-cyan)', phrase: (r) => `prime annuelle d'au moins ${montant(r.PrimeAnnuelle)} F quand le tarif en donne une plus faible` },
  REQUIERT: { titre: 'Exigent une autre garantie', icone: ArrowRightLeft, couleur: 'var(--accent-amber)', phrase: (r) => `ne peut être cochée sans ${r.noms}` },
  COUPLEE: { titre: 'Vendues ensemble', icone: Layers, couleur: 'var(--accent-amber)', phrase: (r) => `se vend avec ${r.noms} : la cocher les coche, elle est décochée sans elles` },
  EXCLUE_SI: { titre: 'Exclues', icone: Ban, couleur: 'var(--accent-rose)', phrase: (r) => `retirée si ${r.noms} est souscrite` },
  NON_PROPOSEE: { titre: 'Non commercialisées', icone: CircleSlash, couleur: 'var(--text-muted)', phrase: () => 'non proposée dans les catégories indiquées' },
  NON_COCHEE: { titre: 'Non cochées d\'office', icone: EyeOff, couleur: 'var(--accent-purple)', phrase: () => 'proposée sans être cochée d\'office : l\'utilisateur peut la cocher' },
};
const AVEC_LIEES = ['REQUIERT', 'EXCLUE_SI', 'OFFERTE_SI', 'PRIME_SI', 'COUPLEE'];
const AVEC_PRIME = ['PRIME_SI', 'PRIME_MINIMUM'];
// Règles que le calcul de la base peut appliquer lui-même aux offres qui contiennent la garantie liée (case « Barème »)
const TYPES_BAREME = ['OFFERTE_SI', 'PRIME_SI'];
const ouEllesSappliquent = (r) => {
  if (r.Type === 'PRIME_MINIMUM') return 'Au calcul de la base : la prime annuelle de la garantie est relevée à ce minimum, avant réductions et prorata';
  if (!TYPES_BAREME.includes(r.Type)) return "À l'écran de devis";
  return r.AppliqueeBareme
    ? "Au calcul de la base (offres qui comprennent la garantie liée) et à l'écran (garantie liée ajoutée au devis)"
    : "À l'écran seulement : quand l'utilisateur ajoute la garantie liée au devis";
};
const codes = (texte) => String(texte || '').split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);

/** Règle en une phrase (« se vend avec Incendie… ») et son titre de type, pour la page Pool TPV aussi. */
export const decrireRegle = (r) => ({
  titre: TYPES[r.Type]?.titre || r.Type,
  phrase: TYPES[r.Type]?.phrase({ ...r, noms: (r.LibellesLiees?.length ? r.LibellesLiees : codes(r.Liees)).join(' ou ') }) || r.Type,
});

const Pastille = ({ children, title }) => (
  <span title={title} style={{ display: 'inline-flex', alignItems: 'center', padding: '0.12rem 0.55rem', borderRadius: 999, fontSize: '0.74rem', fontWeight: 600, background: 'var(--bg-surface-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>
    {children}
  </span>
);

// Garanties liées : pastilles retirables et liste pour en ajouter
const ChoixLiees = ({ valeur, garanties, onChange, exclure }) => {
  const choisies = codes(valeur);
  const nom = (id) => garanties.find((g) => String(g.Id) === String(id))?.Libelle || `Garantie ${id}`;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
      {choisies.map((id) => (
        <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.12rem 0.45rem', borderRadius: 999, fontSize: '0.74rem', background: 'rgba(99, 102, 241, 0.10)', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
          {nom(id)}
          <button type="button" onClick={() => onChange(choisies.filter((x) => x !== id).join(','))} aria-label={`Retirer ${nom(id)}`} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)', display: 'inline-flex' }}><X size={12} /></button>
        </span>
      ))}
      <select className="form-control" style={{ width: 'auto', padding: '0.2rem 0.4rem', fontSize: '0.78rem' }} value=""
        onChange={(e) => e.target.value && onChange([...choisies, e.target.value].join(','))}>
        <option value="">+ garantie…</option>
        {garanties.filter((g) => !choisies.includes(String(g.Id)) && String(g.Id) !== String(exclure)).map((g) => <option key={g.Id} value={g.Id}>{g.Libelle}</option>)}
      </select>
    </div>
  );
};

export const ParametrageReglesGarantiesPage = () => {
  const { success, error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [filtre, setFiltre] = useState('');
  const [brouillon, setBrouillon] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    parametrageApi.getReglesInteractions()
      // Première compagnie qui a des règles (NSIA), sinon toutes
      .then((d) => { setDonnees(d); setFiltre(String(d.Regles?.[0]?.IdCompagnie || '')); })
      .catch((err) => toastError(`Règles non chargées : ${messageErreurApi(err)}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nomGarantie = (id) => donnees?.Garanties?.find((g) => Number(g.Id) === Number(id))?.Libelle || `Garantie ${id}`;
  const regles = brouillon || donnees?.Regles || [];
  const visibles = regles.map((r, i) => ({ r, i })).filter(({ r }) => !filtre || Number(r.IdCompagnie) === Number(filtre));
  const parType = useMemo(() => Object.keys(TYPES).map((type) => ({
    type, lignes: visibles.filter(({ r }) => r.Type === type),
  })).filter((g) => g.lignes.length), [visibles]);

  const changer = (i, champ, valeur) => setBrouillon((l) => l.map((r, k) => (k === i ? { ...r, [champ]: valeur } : r)));
  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const apres = await parametrageApi.modifierReglesInteractions(brouillon);
      setDonnees((d) => ({ ...d, Regles: apres }));
      setBrouillon(null);
      chargerParametrage(true);
      success('Règles des garanties enregistrées : elles s\'appliquent aux prochains calculs de devis.');
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };
  const annuler = async () => {
    if (JSON.stringify(brouillon) !== JSON.stringify(donnees.Regles)
      && !(await confirmer({ titre: 'Abandonner les modifications ?', ton: 'attention', confirmer: 'Abandonner', message: 'Les règles modifiées et non enregistrées seront perdues.' }))) return;
    setBrouillon(null);
  };

  const phrase = (r) => TYPES[r.Type]?.phrase({ ...r, noms: (r.LibellesLiees?.length ? r.LibellesLiees : codes(r.Liees).map(nomGarantie)).join(' ou ') }) || r.Type;
  const th = { padding: '0.45rem 0.4rem', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', textAlign: 'left', whiteSpace: 'nowrap' };
  const td = { padding: '0.35rem 0.4rem', verticalAlign: 'top', fontSize: '0.82rem' };

  return (
    <div style={{ padding: '1.5rem' }}>
      <EnTeteParametrage
        icone={Link2}
        titre="Règles des garanties"
        description="Liens entre les garanties d'une compagnie (tarif annoté NSIA) : selon les garanties souscrites et la catégorie du véhicule, une garantie est obligatoire, offerte, à prime forfaitaire, exige ou exclut une autre garantie, ou n'est pas commercialisée."
        usage="Devis Auto et flotte : appliquées au calcul de l'offre puis à chaque garantie cochée, décochée, ajoutée ou retirée. Le motif s'affiche sous la garantie ; une prime saisie à la main n'est plus modifiée. Une règle « offerte » ou « prime forfaitaire » marquée Barème est aussi appliquée par le calcul de la base aux offres qui comprennent la garantie liée (NSIA : défense-recours 4 200 F et recours anticipé offert avec les dommages ou la collision, bris de glace offert avec les dommages), une « prime minimum » par lui seul : les modifier ici change les primes calculées, sans intervention technique."
        actions={donnees && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="form-control" style={{ width: 'auto' }} value={filtre} onChange={(e) => setFiltre(e.target.value)} title="Compagnie">
              <option value="">Toutes les compagnies</option>
              {donnees.Compagnies.map((c) => <option key={c.Id} value={c.Id}>{c.Nom}</option>)}
            </select>
            {!brouillon && <button type="button" className="btn btn-secondary" onClick={() => setBrouillon(JSON.parse(JSON.stringify(donnees.Regles)))} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Pencil size={14} /> Modifier</button>}
            {brouillon && (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => setBrouillon((l) => [...l, { IdCompagnie: Number(filtre) || donnees.Compagnies[0]?.Id, IdSousGarantie: '', Type: 'OFFERTE_SI', Liees: '', Categories: '', PrimeAnnuelle: null, Commentaire: '', Actif: true }])} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Plus size={14} /> Ajouter une règle</button>
                <button type="button" className="btn btn-secondary" onClick={annuler} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><X size={14} /> Annuler</button>
                <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={envoi} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>{envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer</button>
              </>
            )}
          </div>
        )}
      />

      {!donnees && <div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Chargement…</div>}

      {donnees && !brouillon && (
        <>
          {parType.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Aucune règle pour cette compagnie.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '1rem' }}>
            {parType.map(({ type, lignes }) => {
              const { titre, icone: Icone, couleur } = TYPES[type];
              return (
                <div key={type} style={{ border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--bg-surface)', padding: '0.9rem 1rem', borderTop: `3px solid ${couleur}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    <Icone size={17} color={couleur} /> {titre} <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.8rem' }}>({lignes.length})</span>
                  </div>
                  {lignes.map(({ r }) => (
                    <div key={r.Id || `${r.IdSousGarantie}-${r.Type}`} style={{ padding: '0.5rem 0', borderTop: '1px solid var(--border-subtle)', opacity: r.Actif === false ? 0.5 : 1 }}>
                      <div style={{ fontSize: '0.88rem' }}>
                        <strong>{r.Libelle || nomGarantie(r.IdSousGarantie)}</strong> : {phrase(r)}.
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.25rem', alignItems: 'center' }}>
                        <Pastille>{r.Categories ? `Catégorie${codes(r.Categories).length > 1 ? 's' : ''} ${codes(r.Categories).join(', ')}` : 'Toutes catégories'}</Pastille>
                        {!filtre && <Pastille>{donnees.Compagnies.find((c) => Number(c.Id) === Number(r.IdCompagnie))?.Nom}</Pastille>}
                        {TYPES_BAREME.includes(r.Type) && (
                          <Pastille title={ouEllesSappliquent(r)}>{r.AppliqueeBareme ? 'Barème + écran' : 'Écran seulement'}</Pastille>
                        )}
                        {r.Type === 'PRIME_MINIMUM' && <Pastille title={ouEllesSappliquent(r)}>Barème</Pastille>}
                        {r.Actif === false && <Pastille>désactivée</Pastille>}
                      </div>
                      {r.Commentaire && <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{r.Commentaire}</div>}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <SectionParametrage icone={Info} titre="Autres règles des garanties"
            description="Réglées ailleurs dans l'administration.">
            <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem', lineHeight: 1.8 }}>
              <li>Garanties admises selon l'âge du véhicule (NSIA : tous risques de 0 à 5 ans, NSIA Auto + de 5 à 10 ans) : <Link to="/admin/settings/depreciation">Dépréciation et âge des véhicules</Link>.</li>
              <li>Garanties comprises dans chaque offre, avec leurs franchises (NSIA Auto + : 10 %) : <Link to="/admin/settings/offres">Offres</Link>.</li>
              <li>Réduction du vol avec un système satellitaire (50 %), surprimes remorque (sauf tracteur routier : la remorque attelée n'est pas tarifée), transport d'hydrocarbures (RC + 10 %, incendie + 100 %), transport d'élèves, d'employés et passagers supplémentaires : appliquées par le barème de la compagnie.</li>
              <li>Pool TPV de la catégorie 204 (RC et Recours dus au Pool, sans réduction) : <Link to="/admin/settings/pool-tpv">Pool TPV</Link>.</li>
              <li>Primes toutes faites des tiers simples NSIA : <Link to="/admin/settings/tarifs-directs">Tarifs à lecture directe</Link>.</li>
            </ul>
          </SectionParametrage>
        </>
      )}

      {donnees && brouillon && (
        <SectionParametrage icone={Pencil} titre="Modifier les règles" description="Une ligne par règle. Les garanties liées déclenchent la règle (offerte si, prime si, exige, exclue si) ; les catégories la limitent (vide : toutes).">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1200 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
                  {['Compagnie', 'Garantie', 'Règle', 'Garanties liées', 'Catégories', 'Prime annuelle', 'Commentaire', 'Barème', 'Active', ''].map((t) => <th key={t} style={th} title={t === 'Barème' ? "Appliquée aussi par le calcul de la base aux offres qui comprennent la garantie liée (offerte, prime forfaitaire)" : undefined}>{t}</th>)}
                </tr>
              </thead>
              <tbody>
                {visibles.map(({ r, i }) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={td}>
                      <select className="form-control" style={{ padding: '0.25rem', fontSize: '0.8rem' }} value={r.IdCompagnie || ''} onChange={(e) => changer(i, 'IdCompagnie', Number(e.target.value))}>
                        {donnees.Compagnies.map((c) => <option key={c.Id} value={c.Id}>{c.Nom}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      <select className="form-control" style={{ padding: '0.25rem', fontSize: '0.8rem', minWidth: 190 }} value={r.IdSousGarantie || ''} onChange={(e) => changer(i, 'IdSousGarantie', Number(e.target.value))}>
                        <option value="">choisir…</option>
                        {donnees.Garanties.map((g) => <option key={g.Id} value={g.Id}>{g.Libelle}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      <select className="form-control" style={{ padding: '0.25rem', fontSize: '0.8rem', minWidth: 200 }} value={r.Type} onChange={(e) => changer(i, 'Type', e.target.value)}>
                        {donnees.Types.map((t) => <option key={t.Code} value={t.Code}>{t.Libelle}</option>)}
                      </select>
                    </td>
                    <td style={{ ...td, minWidth: 220 }}>
                      {AVEC_LIEES.includes(r.Type)
                        ? <ChoixLiees valeur={r.Liees} garanties={donnees.Garanties} exclure={r.IdSousGarantie} onChange={(v) => changer(i, 'Liees', v)} />
                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>-</span>}
                    </td>
                    <td style={td}><input className="form-control" style={{ padding: '0.25rem', fontSize: '0.8rem', width: 150 }} placeholder={r.Type === 'NON_PROPOSEE' ? 'obligatoire' : 'toutes'} value={r.Categories || ''} onChange={(e) => changer(i, 'Categories', e.target.value)} /></td>
                    <td style={td}>
                      {AVEC_PRIME.includes(r.Type)
                        ? <input type="number" min={0} className="form-control" style={{ padding: '0.25rem', fontSize: '0.8rem', width: 100, textAlign: 'right' }} value={r.PrimeAnnuelle ?? ''} onChange={(e) => changer(i, 'PrimeAnnuelle', e.target.value === '' ? null : Number(e.target.value))} />
                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>-</span>}
                    </td>
                    <td style={td}><input className="form-control" style={{ padding: '0.25rem', fontSize: '0.8rem', minWidth: 240 }} value={r.Commentaire || ''} onChange={(e) => changer(i, 'Commentaire', e.target.value)} /></td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {TYPES_BAREME.includes(r.Type) && <input type="checkbox" checked={Boolean(r.AppliqueeBareme)} onChange={(e) => changer(i, 'AppliqueeBareme', e.target.checked)} title={ouEllesSappliquent({ ...r, AppliqueeBareme: !r.AppliqueeBareme })} />}
                      {r.Type === 'PRIME_MINIMUM' && <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }} title={ouEllesSappliquent(r)}>toujours</span>}
                      {!TYPES_BAREME.includes(r.Type) && r.Type !== 'PRIME_MINIMUM' && <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>-</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={r.Actif !== false} onChange={(e) => changer(i, 'Actif', e.target.checked)} /></td>
                    <td style={td}><button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.45rem' }} title="Supprimer la règle" onClick={() => setBrouillon((l) => l.filter((_, k) => k !== i))}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionParametrage>
      )}
    </div>
  );
};

export default ParametrageReglesGarantiesPage;
