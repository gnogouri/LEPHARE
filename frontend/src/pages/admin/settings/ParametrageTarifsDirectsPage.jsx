import React, { useEffect, useMemo, useState } from 'react';
import {
  Table2, Save, Loader2, Plus, Trash2, SlidersHorizontal, CheckCircle2, AlertTriangle, Pencil, X, Search, BookOpen,
} from 'lucide-react';
import { EnTeteParametrage, SectionParametrage } from '../../../components/admin/EnTeteParametrage';
import { LigneParametre } from '../../../components/admin/LigneParametre';
import { parametrageApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { chargerParametrage } from '../../../utils/parametrage';
import { confirmer } from '../../../utils/dialogue';
import { useToast } from '../../../context/ToastContext';

// Tarifs Automobile « à lecture directe » d'une compagnie (NSIA : VP essence, VP diesel, TPC, TPM) : primes toutes
// faites par tranche et par durée, appliquées sans saisie aux offres cochées (devis Auto, écran Offre).
// configuration_api/parametrage_auto.py (tarifs_directs, chercher_tarif_direct) ; coefficients de durée lus par la
// base (fn_calcul_taux_prime_fractionnee). Lecture d'abord (une grille à la fois, comme le document de la
// compagnie), modification sur demande.

const MONTANTS = [
  { champ: 'PrimeNette', titre: 'Prime nette', court: 'Prime nette' },
  { champ: 'Accessoire', titre: 'Accessoires', court: 'Acc.' },
  { champ: 'Taxe', titre: 'Taxes', court: 'Taxes' },
  { champ: 'Fga', titre: 'FGA', court: 'FGA' },
  { champ: 'Cedeao', titre: 'CEDEAO', court: 'CEDEAO' },
  { champ: 'PrimeTtc', titre: 'Prime TTC', court: 'TTC' },
];
const DETAIL = ['Accessoire', 'Taxe', 'Fga', 'Cedeao'];
const ECART_TOLERE = 2;
const CRITERES = { PUISSANCE: 'Puissance fiscale (CV)', CHARGE_UTILE: 'Charge utile (kg)' };
const nombre = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const francs = (v) => `${nombre(v)} F`;
const codes = (texte) => String(texte || '').split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);
const ligneVide = (duree, modele = {}) => ({
  Libelle: modele.Libelle || '', BorneMin: modele.BorneMin ?? '', BorneMax: modele.BorneMax ?? '', Usages: modele.Usages || '',
  DureeMois: duree, PrimeNette: '', Accessoire: '', Taxe: '', Fga: '', Cedeao: '', PrimeTtc: '',
});
const ecartTtc = (l) => Math.round((Number(l.PrimeTtc) || 0) - MONTANTS.slice(0, 5).reduce((s, m) => s + (Number(l[m.champ]) || 0), 0));
const cleTranche = (l) => `${l.Libelle}|${l.BorneMin ?? ''}|${l.BorneMax ?? ''}|${l.Usages || ''}`;
const nomEnergie = (energies, id) => (id ? (energies.find((e) => Number(e.Id) === Number(id))?.Libelle || `énergie ${id}`) : 'Toutes énergies');

// Tranches d'une grille (dans l'ordre du document) et durées, de la plus longue à la plus courte
const tranchesEtDurees = (lignes) => {
  const tranches = [];
  const vues = new Map();
  [...lignes].sort((a, b) => (Number(a.Ordre) || 0) - (Number(b.Ordre) || 0)).forEach((l) => {
    const cle = cleTranche(l);
    if (!vues.has(cle)) {
      vues.set(cle, { cle, Libelle: l.Libelle, BorneMin: l.BorneMin, BorneMax: l.BorneMax, Usages: l.Usages, parDuree: {} });
      tranches.push(vues.get(cle));
    }
    vues.get(cle).parDuree[Number(l.DureeMois)] = l;
  });
  const durees = [...new Set(lignes.map((l) => Number(l.DureeMois)))].sort((a, b) => b - a);
  return { tranches, durees };
};

const bornesTexte = (t, unite) => {
  if (t.Usages) return `usages ${codes(t.Usages).join(', ')}`;
  if (t.BorneMax === null || t.BorneMax === undefined || t.BorneMax === '') return `${nombre(t.BorneMin)} ${unite} et plus`;
  return Number(t.BorneMin) === Number(t.BorneMax) ? `${nombre(t.BorneMin)} ${unite}` : `${nombre(t.BorneMin)} à ${nombre(t.BorneMax)} ${unite}`;
};

const Pastille = ({ children, ton = 'neutre', title }) => {
  const couleurs = {
    neutre: { bg: 'var(--bg-surface-hover)', fg: 'var(--text-secondary)', bd: 'var(--border-subtle)' },
    vert: { bg: 'rgba(16, 185, 129, 0.12)', fg: 'var(--accent-emerald)', bd: 'rgba(16, 185, 129, 0.35)' },
    ambre: { bg: 'rgba(245, 158, 11, 0.12)', fg: 'var(--accent-amber)', bd: 'rgba(245, 158, 11, 0.35)' },
    bleu: { bg: 'rgba(99, 102, 241, 0.10)', fg: 'var(--accent-indigo)', bd: 'rgba(99, 102, 241, 0.30)' },
  }[ton];
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.18rem 0.6rem', borderRadius: 999, fontSize: '0.76rem', fontWeight: 600, background: couleurs.bg, color: couleurs.fg, border: `1px solid ${couleurs.bd}`, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
};

// ------------------------------------------------------------------ lecture
const VueGrille = ({ grille, offres, energies }) => {
  const [detail, setDetail] = useState(false);
  const [recherche, setRecherche] = useState({ valeur: '', duree: '', usage: '' });
  const unite = grille.Critere === 'CHARGE_UTILE' ? 'kg' : 'CV';
  const { tranches, durees } = useMemo(() => tranchesEtDurees(grille.Lignes), [grille.Lignes]);
  const colonnes = MONTANTS.filter((m) => detail || !DETAIL.includes(m.champ));
  const libellesOffres = codes(grille.Offres).map((id) => offres.find((o) => String(o.Id) === id && Number(o.IdCompagnie) === Number(grille.IdCompagnie))?.Libelle || `offre ${id}`);

  // Tranche et durée trouvées pour la valeur saisie (même règle que le devis)
  const trouvee = useMemo(() => {
    const usage = recherche.usage.trim();
    const valeur = recherche.valeur === '' ? null : Number(recherche.valeur);
    if (!usage && valeur === null) return null;
    const usagesCibles = new Set(tranches.flatMap((t) => codes(t.Usages)));
    const tranche = tranches.find((t) => (usage && usagesCibles.has(usage)
      ? codes(t.Usages).includes(usage)
      : !t.Usages && valeur !== null && Number(t.BorneMin) <= valeur && (t.BorneMax === null || t.BorneMax === '' || valeur <= Number(t.BorneMax))));
    return tranche ? { cle: tranche.cle, duree: Number(recherche.duree) || null } : { cle: null };
  }, [recherche, tranches]);
  const ligneTrouvee = trouvee?.cle && trouvee.duree ? tranches.find((t) => t.cle === trouvee.cle)?.parDuree[trouvee.duree] : null;

  const ecarts = grille.Lignes.filter((l) => Math.abs(ecartTtc(l)) > ECART_TOLERE).length;
  const th = { padding: '0.5rem 0.55rem', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', fontWeight: 700, whiteSpace: 'nowrap' };
  const td = { padding: '0.5rem 0.55rem', fontSize: '0.86rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  const debutDuree = { borderLeft: '2px solid var(--border-medium)' };

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.75rem' }}>
        <Pastille ton="bleu">Catégorie {codes(grille.Categories).join(', ')}</Pastille>
        <Pastille>{nomEnergie(energies, grille.IdEnergie)}</Pastille>
        <Pastille>Tranches : {CRITERES[grille.Critere]}</Pastille>
        <Pastille ton={grille.Actif ? 'vert' : 'ambre'}>{grille.Actif ? 'Appliqué aux devis' : 'Désactivé'}</Pastille>
        {ecarts > 0 && <Pastille ton="ambre"><AlertTriangle size={12} /> {ecarts} ligne(s) : TTC ≠ somme</Pastille>}
      </div>
      <div style={{ fontSize: '0.84rem', marginBottom: '0.9rem', lineHeight: 1.6 }}>
        <span style={{ color: 'var(--text-muted)' }}>Offres tarifées par cette grille : </span>
        {libellesOffres.length ? libellesOffres.map((o, i) => <span key={o}>{i > 0 && ' · '}<strong>{o}</strong></span>)
          : <em style={{ color: 'var(--accent-amber)' }}>aucune - la grille n'est appliquée à aucun devis</em>}
        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
          {grille.Source && <>Source : {grille.Source}</>}
          {grille.DateModification && <>{grille.Source ? ' · ' : ''}mis à jour le {new Date(grille.DateModification).toLocaleDateString('fr-FR')}{grille.ModifiePar ? ` par ${grille.ModifiePar}` : ''}</>}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', fontSize: '0.84rem' }}>
          <Search size={15} color="var(--text-muted)" />
          <span>Trouver une tranche :</span>
          <input type="number" min={0} className="form-control" style={{ width: 110, padding: '0.3rem 0.5rem' }} placeholder={unite}
            value={recherche.valeur} onChange={(e) => setRecherche((r) => ({ ...r, valeur: e.target.value }))} />
          <select className="form-control" style={{ width: 'auto', padding: '0.3rem 0.5rem' }} value={recherche.duree} onChange={(e) => setRecherche((r) => ({ ...r, duree: e.target.value }))}>
            <option value="">durée…</option>
            {durees.map((d) => <option key={d} value={d}>{d} mois</option>)}
          </select>
          {tranches.some((t) => t.Usages) && (
            <select className="form-control" style={{ width: 'auto', padding: '0.3rem 0.5rem' }} value={recherche.usage} onChange={(e) => setRecherche((r) => ({ ...r, usage: e.target.value }))}>
              <option value="">usage ordinaire</option>
              {[...new Set(tranches.flatMap((t) => codes(t.Usages)))].map((u) => <option key={u} value={u}>usage {u}</option>)}
            </select>
          )}
          {trouvee && !trouvee.cle && <span style={{ color: 'var(--accent-amber)' }}>hors grille : calcul au barème</span>}
          {ligneTrouvee && <span><strong>{ligneTrouvee.Libelle}</strong>, {trouvee.duree} mois : TTC <strong>{francs(ligneTrouvee.PrimeTtc)}</strong></span>}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} />
          Détail des montants (accessoires, taxes, FGA, CEDEAO)
        </label>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: detail ? 1100 : 640 }}>
          <thead>
            <tr style={{ background: 'var(--bg-surface-hover)' }}>
              <th style={{ ...th, textAlign: 'left' }} rowSpan={2}>Tranche</th>
              {durees.map((d) => <th key={d} colSpan={colonnes.length} style={{ ...th, ...debutDuree, textAlign: 'center', fontSize: '0.74rem', color: 'var(--text-primary)' }}>{d} mois</th>)}
            </tr>
            <tr style={{ background: 'var(--bg-surface-hover)', borderBottom: '1px solid var(--border-medium)' }}>
              {durees.map((d) => colonnes.map((m, k) => <th key={`${d}-${m.champ}`} style={{ ...th, textAlign: 'right', ...(k === 0 ? debutDuree : {}) }}>{m.court}</th>))}
            </tr>
          </thead>
          <tbody>
            {tranches.map((t, i) => {
              const ligneVisee = trouvee?.cle === t.cle;
              return (
                <tr key={t.cle} style={{ borderBottom: '1px solid var(--border-subtle)', background: ligneVisee ? 'rgba(99, 102, 241, 0.10)' : (i % 2 ? 'var(--bg-surface-hover)' : 'transparent') }}>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <div style={{ fontWeight: 700 }}>{t.Libelle}</div>
                    {bornesTexte(t, unite) !== t.Libelle && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{bornesTexte(t, unite)}</div>}
                  </td>
                  {durees.map((d) => {
                    const l = t.parDuree[d];
                    const vise = ligneVisee && trouvee.duree === d;
                    return colonnes.map((m, k) => (
                      <td key={`${d}-${m.champ}`} style={{
                        ...td, ...(k === 0 ? debutDuree : {}),
                        fontWeight: m.champ === 'PrimeTtc' ? 800 : 400,
                        color: m.champ === 'PrimeTtc' ? 'var(--text-primary)' : 'var(--text-secondary)',
                        background: vise ? 'rgba(99, 102, 241, 0.18)' : undefined,
                      }}>
                        {l ? (
                          <span title={m.champ === 'PrimeTtc' && Math.abs(ecartTtc(l)) > ECART_TOLERE ? `TTC différent de la somme des montants (${francs(ecartTtc(l))})` : undefined}>
                            {nombre(l[m.champ])}
                            {m.champ === 'PrimeTtc' && Math.abs(ecartTtc(l)) > ECART_TOLERE && <AlertTriangle size={12} color="var(--accent-amber)" style={{ marginLeft: 4 }} />}
                          </span>
                        ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                      </td>
                    ));
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.45rem' }}>
        Montants en FCFA, tels que publiés par la compagnie (chaque montant est arrondi à part : le TTC peut différer de 1 F de leur somme).
        Une durée absente de la grille (ex. 1 mois) est calculée au barème.
      </div>
    </>
  );
};

// ------------------------------------------------------------------ modification
const EditionGrille = ({ grille, compagnies, offres, energies, onChange }) => {
  const unite = grille.Critere === 'CHARGE_UTILE' ? 'kg' : 'CV';
  const durees = useMemo(() => [...new Set(grille.Lignes.map((l) => Number(l.DureeMois)))].sort((a, b) => b - a), [grille.Lignes]);
  const offresCompagnie = offres.filter((o) => Number(o.IdCompagnie) === Number(grille.IdCompagnie)
    && (codes(grille.Categories).includes(o.Categorie) || codes(grille.Offres).includes(String(o.Id))));
  const offresCochees = codes(grille.Offres);
  const changer = (champ_, valeur) => onChange({ ...grille, [champ_]: valeur });
  const changerLigne = (index, champ_, valeur) => onChange({ ...grille, Lignes: grille.Lignes.map((l, i) => (i === index ? { ...l, [champ_]: valeur } : l)) });
  const basculerOffre = (id) => changer('Offres', (offresCochees.includes(String(id))
    ? offresCochees.filter((o) => o !== String(id)) : [...offresCochees, String(id)]).join(','));
  const ajouterDuree = (duree) => {
    if (!duree) return;
    // La nouvelle durée reprend les tranches de la plus longue (montants à saisir)
    const modele = grille.Lignes.filter((l) => Number(l.DureeMois) === durees[0]);
    onChange({ ...grille, Lignes: [...grille.Lignes, ...(modele.length ? modele.map((l) => ligneVide(duree, l)) : [ligneVide(duree)])] });
  };
  const cellule = { padding: '0.3rem 0.25rem', verticalAlign: 'middle', fontSize: '0.8rem' };
  const entete = { padding: '0.45rem 0.25rem', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-muted)', textAlign: 'center', whiteSpace: 'nowrap' };
  const champ = { padding: '0.3rem', fontSize: '0.8rem', textAlign: 'right' };

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem', marginBottom: '0.8rem' }}>
        <label className="form-group" style={{ margin: 0 }}><span className="form-label">Nom</span>
          <input className="form-control" value={grille.Libelle} onChange={(e) => changer('Libelle', e.target.value)} /></label>
        <label className="form-group" style={{ margin: 0 }}><span className="form-label">Compagnie</span>
          <select className="form-control" value={grille.IdCompagnie || ''} onChange={(e) => changer('IdCompagnie', Number(e.target.value))}>
            {compagnies.map((c) => <option key={c.Id} value={c.Id}>{c.Nom}</option>)}
          </select></label>
        <label className="form-group" style={{ margin: 0 }}><span className="form-label">Catégories (codes)</span>
          <input className="form-control" value={grille.Categories} placeholder="201" onChange={(e) => changer('Categories', e.target.value)} /></label>
        <label className="form-group" style={{ margin: 0 }}><span className="form-label">Énergie</span>
          <select className="form-control" value={grille.IdEnergie || ''} onChange={(e) => changer('IdEnergie', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Toutes</option>
            {energies.map((e) => <option key={e.Id} value={e.Id}>{e.Libelle}</option>)}
          </select></label>
        <label className="form-group" style={{ margin: 0 }}><span className="form-label">Tranches selon</span>
          <select className="form-control" value={grille.Critere} onChange={(e) => changer('Critere', e.target.value)}>
            {Object.entries(CRITERES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="form-group" style={{ margin: 0 }}><span className="form-label">Source</span>
          <input className="form-control" value={grille.Source || ''} placeholder="Document de la compagnie" onChange={(e) => changer('Source', e.target.value)} /></label>
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.8rem', cursor: 'pointer', fontSize: '0.85rem' }}>
        <input type="checkbox" checked={Boolean(grille.Actif)} onChange={(e) => changer('Actif', e.target.checked)} />
        Tarif appliqué aux devis
      </label>
      <div style={{ marginBottom: '0.9rem' }}>
        <div className="form-label" style={{ marginBottom: '0.35rem' }}>Offres tarifées par cette grille</div>
        {offresCompagnie.length === 0 && <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Aucune offre de cette compagnie dans ces catégories.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.3rem 1rem' }}>
          {offresCompagnie.map((o) => (
            <label key={o.Id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', opacity: o.Actif ? 1 : 0.6, cursor: 'pointer' }}>
              <input type="checkbox" checked={offresCochees.includes(String(o.Id))} onChange={() => basculerOffre(o.Id)} />
              {o.Libelle} <span style={{ color: 'var(--text-muted)' }}>({o.Categorie}{o.Actif ? '' : ', inactive'})</span>
            </label>
          ))}
        </div>
      </div>

      {durees.map((duree) => (
        <div key={duree} style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
            <strong style={{ fontSize: '0.92rem' }}>{duree} mois</strong>
            <button type="button" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0.55rem', fontSize: '0.78rem' }}
              onClick={() => onChange({ ...grille, Lignes: [...grille.Lignes, ligneVide(duree)] })}><Plus size={13} /> Ajouter une tranche</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: 1150, width: '100%' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
                  <th style={{ ...entete, textAlign: 'left' }}>Tranche</th><th style={entete}>De ({unite})</th><th style={entete}>À ({unite})</th>
                  <th style={entete} title="Codes d'usage (ex. 017,022 : tracteur routier) : la ligne vaut pour ces usages quelle que soit la tranche">Usages</th>
                  {MONTANTS.map((m) => <th key={m.champ} style={entete}>{m.titre}</th>)}
                  <th style={entete}>Contrôle</th><th style={entete} />
                </tr>
              </thead>
              <tbody>
                {grille.Lignes.map((l, i) => (Number(l.DureeMois) !== duree ? null : (
                  <tr key={l.Id || `n-${i}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={cellule}><input className="form-control" style={{ padding: '0.3rem', fontSize: '0.8rem', minWidth: 120 }} value={l.Libelle} onChange={(e) => changerLigne(i, 'Libelle', e.target.value)} /></td>
                    <td style={cellule}><input type="number" min={0} className="form-control" style={{ ...champ, width: 80 }} value={l.BorneMin ?? ''} disabled={Boolean(l.Usages)} onChange={(e) => changerLigne(i, 'BorneMin', e.target.value === '' ? '' : Number(e.target.value))} /></td>
                    <td style={cellule}><input type="number" min={0} className="form-control" style={{ ...champ, width: 80 }} value={l.BorneMax ?? ''} placeholder="et +" disabled={Boolean(l.Usages)} onChange={(e) => changerLigne(i, 'BorneMax', e.target.value === '' ? '' : Number(e.target.value))} /></td>
                    <td style={cellule}><input className="form-control" style={{ padding: '0.3rem', fontSize: '0.8rem', width: 80 }} value={l.Usages || ''} onChange={(e) => changerLigne(i, 'Usages', e.target.value)} /></td>
                    {MONTANTS.map((m) => (
                      <td key={m.champ} style={cellule}>
                        <input type="number" min={0} className="form-control" style={{ ...champ, width: m.champ === 'PrimeNette' || m.champ === 'PrimeTtc' ? 95 : 78, fontWeight: m.champ === 'PrimeTtc' ? 700 : 400 }}
                          value={l[m.champ] ?? ''} onChange={(e) => changerLigne(i, m.champ, e.target.value)} />
                      </td>
                    ))}
                    <td style={{ ...cellule, whiteSpace: 'nowrap', textAlign: 'center' }}>
                      {Math.abs(ecartTtc(l)) <= ECART_TOLERE
                        ? <span title="Prime TTC = somme des montants (à 2 F près : chaque montant est arrondi par la compagnie)"><CheckCircle2 size={15} color="var(--accent-emerald)" /></span>
                        : <span style={{ color: 'var(--accent-rose)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }} title="Prime TTC différente de la somme des montants : la grille ne pourra pas être enregistrée"><AlertTriangle size={14} /> {francs(ecartTtc(l))}</span>}
                    </td>
                    <td style={cellule}>
                      <button type="button" className="btn btn-secondary" onClick={() => onChange({ ...grille, Lignes: grille.Lignes.filter((_, k) => k !== i) })} style={{ padding: '0.3rem 0.45rem' }} title="Supprimer la tranche"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem' }}>
        Ajouter une durée :
        <select className="form-control" style={{ width: 'auto', padding: '0.25rem 0.5rem' }} value="" onChange={(e) => ajouterDuree(Number(e.target.value))}>
          <option value="">choisir…</option>
          {Array.from({ length: 12 }, (_, k) => 12 - k).filter((d) => !durees.includes(d)).map((d) => <option key={d} value={d}>{d} mois</option>)}
        </select>
      </label>
    </>
  );
};

// ------------------------------------------------------------------ une grille : lecture ou modification
const CarteGrille = ({ grille, compagnies, offres, energies, onEnregistree, onSupprimee }) => {
  const { success, error: toastError } = useToast();
  const [brouillon, setBrouillon] = useState(grille.Id ? null : grille);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => { if (grille.Id) setBrouillon(null); }, [grille]);
  const enEdition = Boolean(brouillon);
  const modifiee = enEdition && JSON.stringify(brouillon) !== JSON.stringify(grille);
  const affichee = brouillon || grille;
  const nomCompagnie = compagnies.find((c) => Number(c.Id) === Number(affichee.IdCompagnie))?.Nom || '';

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const charge = { ...brouillon, Lignes: brouillon.Lignes.map((l) => ({ ...l, BorneMin: l.BorneMin === '' ? null : l.BorneMin, BorneMax: l.BorneMax === '' ? null : l.BorneMax })) };
      const enregistree = brouillon.Id ? await parametrageApi.modifierTarifDirect(brouillon.Id, charge) : await parametrageApi.creerTarifDirect(charge);
      onEnregistree(enregistree);
      setBrouillon(null);
      success(`Tarif « ${enregistree.Libelle} » enregistré.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  const annuler = async () => {
    if (modifiee && !(await confirmer({ titre: 'Abandonner les modifications ?', ton: 'attention', confirmer: 'Abandonner', message: 'Les changements non enregistrés de cette grille seront perdus.' }))) return;
    if (!grille.Id) onSupprimee();
    else setBrouillon(null);
  };

  const supprimer = async () => {
    if (!(await confirmer({
      titre: 'Supprimer ce tarif ?', ton: 'danger', confirmer: 'Supprimer le tarif',
      message: `« ${grille.Libelle} » ne sera plus appliqué : les devis de ces offres seront calculés au barème.`,
    }))) return;
    try {
      await parametrageApi.supprimerTarifDirect(grille.Id);
      onSupprimee();
      success('Tarif supprimé.');
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };

  return (
    <SectionParametrage icone={Table2}
      titre={`${affichee.Libelle || 'Nouveau tarif'}${nomCompagnie ? ` - ${nomCompagnie}` : ''}`}
      description={enEdition ? 'Modification en cours : enregistrez pour appliquer la grille aux devis.' : 'Primes de la compagnie par tranche (lignes) et par durée (colonnes).'}
      actions={enEdition ? (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {grille.Id && <button type="button" className="btn btn-secondary" onClick={supprimer} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Trash2 size={14} /> Supprimer</button>}
          <button type="button" className="btn btn-secondary" onClick={annuler} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><X size={14} /> Annuler</button>
          <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={(!modifiee && Boolean(grille.Id)) || envoi} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer le tarif
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={() => setBrouillon(JSON.parse(JSON.stringify(grille)))} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Pencil size={14} /> Modifier</button>
      )}>
      {enEdition
        ? <EditionGrille grille={brouillon} compagnies={compagnies} offres={offres} energies={energies} onChange={setBrouillon} />
        : <VueGrille grille={grille} offres={offres} energies={energies} />}
    </SectionParametrage>
  );
};

// Règles constatées dans les documents NSIA (tarifs à lecture directe du 16/10/2026, conditions particulières,
// tableaux d'OREOLE) et ce que LE PHARE en fait
const REGLES = [
  ['Responsabilité civile', 'RC du barème CIMA − 35 % (ex. 7 à 9 CV essence : 73 415 × 0,65 = 47 720 F par an)', 'Comprise dans la prime nette de la grille'],
  ['FGA', '2 % de la RC après réduction', 'Grille ; barème : même règle'],
  ['CEDEAO', '1 000 F par véhicule, quelle que soit la durée, sans réduction ni taxe', 'Grille ; barème : même règle'],
  ['Taxe', '14,5 % de (prime nette + accessoires), CEDEAO non taxée', 'Grille ; barème : même règle'],
  ['Accessoires', 'Tranche de la prime nette seule, hors FGA et CEDEAO : jusqu\'à 100 000 F → 6 000 F, de 100 001 à 500 000 F → 9 000 F (ex. TPC 6 mois, 9 à 11 T : 98 292 F → 6 000 F)', 'Grille. Le barème compte encore FGA et CEDEAO dans la tranche (écart possible près d\'un seuil)'],
  ['Durée', '6 mois = 53 %, 3 mois = 28 % de la prime annuelle', 'Coefficients réglables ci-dessous'],
  ['Énergie', 'Diesel : tranches de puissance décalées (1 CV ; 2 à 4 ; 5 à 6 ; 7 à 8 ; 9 et plus)', 'Une grille par énergie'],
  ['Tracteur routier', 'Ligne propre (TPC 317 406 F, TPM = plus de 15 T)', 'Usages 017 et 022'],
  ['Arrondi', 'TTC des conditions particulières NSIA arrondi à 5 F (ex. 943 567 → 943 570)', 'Règle d\'arrondi de LE PHARE (le TTC de la grille peut donc changer de 1 à 2 F)'],
];

export const ParametrageTarifsDirectsPage = () => {
  const { error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [grilles, setGrilles] = useState([]);
  const [filtre, setFiltre] = useState('');
  const [selection, setSelection] = useState(null);

  useEffect(() => {
    parametrageApi.getTarifsDirects()
      .then((d) => { setDonnees(d); setGrilles(d.Grilles); setSelection(d.Grilles[0] ? `id-${d.Grilles[0].Id}` : null); })
      .catch((err) => toastError(`Tarifs non chargés : ${messageErreurApi(err)}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cle = (g, i) => (g.Id ? `id-${g.Id}` : `nouvelle-${i}`);
  const visibles = grilles.map((g, i) => ({ g, i, cle: cle(g, i) })).filter(({ g }) => !filtre || Number(g.IdCompagnie) === Number(filtre));
  const active = visibles.find((v) => v.cle === selection) || visibles[0];
  const nomCompagnie = (id) => donnees?.Compagnies?.find((c) => Number(c.Id) === Number(id))?.Nom || '';
  const nouvelle = () => {
    const index = grilles.length;
    setGrilles((l) => [...l, {
      Id: null, IdCompagnie: Number(filtre) || donnees?.Compagnies?.[0]?.Id, Libelle: '', Categories: '', IdEnergie: null,
      Critere: 'PUISSANCE', Offres: '', Actif: true, Source: '', Lignes: [ligneVide(12)],
    }]);
    setSelection(`nouvelle-${index}`);
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <EnTeteParametrage
        icone={Table2}
        titre="Tarifs à lecture directe"
        description="Primes toutes faites publiées par une compagnie (NSIA : VP essence, VP diesel, TPC, TPM), par tranche de puissance ou de charge utile et par durée. Chaque compagnie a ses grilles."
        usage="Devis Auto (un véhicule) : quand l'offre choisie est rattachée à une grille et que la catégorie, l'énergie, la tranche et la durée du contrat y figurent, prime nette, accessoires, taxes, FGA, CEDEAO et TTC de la grille sont appliqués d'office, sans saisie. Sinon, le devis est calculé au barème."
        actions={(
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select className="form-control" style={{ width: 'auto' }} value={filtre} onChange={(e) => setFiltre(e.target.value)} title="Compagnie">
              <option value="">Toutes les compagnies</option>
              {(donnees?.Compagnies || []).map((c) => <option key={c.Id} value={c.Id}>{c.Nom}</option>)}
            </select>
            <button type="button" className="btn btn-primary" onClick={nouvelle} disabled={!donnees} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Plus size={14} /> Nouveau tarif</button>
          </div>
        )}
      />

      {!donnees && <div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Chargement…</div>}
      {donnees && visibles.length === 0 && <div style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>Aucun tarif à lecture directe pour cette compagnie.</div>}

      {donnees && visibles.length > 0 && (
        <div role="tablist" aria-label="Grilles" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {visibles.map(({ g, cle: c }) => {
            const actif = active?.cle === c;
            return (
              <button key={c} type="button" role="tab" aria-selected={actif} onClick={() => setSelection(c)}
                style={{
                  textAlign: 'left', padding: '0.55rem 0.85rem', borderRadius: 10, cursor: 'pointer', minWidth: 170,
                  border: `1px solid ${actif ? 'var(--primary)' : 'var(--border-subtle)'}`,
                  background: actif ? 'rgba(99, 102, 241, 0.10)' : 'var(--bg-surface)',
                  boxShadow: actif ? 'var(--shadow-sm)' : 'none', transition: 'all var(--mouvement-rapide) ease',
                }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: g.Actif ? 'var(--accent-emerald)' : 'var(--accent-amber)', flexShrink: 0 }} />
                  {(g.Libelle || 'Nouveau tarif').replace(/\s*\(.*\)$/, '')}
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  {nomCompagnie(g.IdCompagnie)} · cat. {codes(g.Categories).join(', ') || '…'}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {donnees && active && (
        <CarteGrille key={active.cle} grille={active.g} compagnies={donnees.Compagnies} offres={donnees.Offres} energies={donnees.Energies}
          onEnregistree={(n) => { setGrilles((l) => l.map((g, k) => (k === active.i ? n : g))); setSelection(`id-${n.Id}`); }}
          onSupprimee={() => { setGrilles((l) => l.filter((_, k) => k !== active.i)); setSelection(null); }} />
      )}

      {donnees && (
        <SectionParametrage icone={BookOpen} titre="Règles de calcul constatées"
          description="Ce que montrent les documents NSIA (tarifs à lecture directe du 16/10/2026, les plus récents, conditions particulières, tableaux d'OREOLE) et comment LE PHARE les applique.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
                  {['Élément', 'Règle NSIA', 'Dans LE PHARE'].map((t) => <th key={t} style={{ padding: '0.45rem 0.55rem', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', textAlign: 'left' }}>{t}</th>)}
                </tr>
              </thead>
              <tbody>
                {REGLES.map(([element, regle, lephare], i) => (
                  <tr key={element} style={{ borderBottom: '1px solid var(--border-subtle)', background: i % 2 ? 'var(--bg-surface-hover)' : 'transparent' }}>
                    <td style={{ padding: '0.5rem 0.55rem', fontWeight: 700, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{element}</td>
                    <td style={{ padding: '0.5rem 0.55rem', fontSize: '0.85rem' }}>{regle}</td>
                    <td style={{ padding: '0.5rem 0.55rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{lephare}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionParametrage>
      )}

      {donnees && (
        <SectionParametrage icone={SlidersHorizontal} titre="Contrats de moins d'un an"
          description="Coefficients de la prime annuelle selon la durée, utilisés par le calcul au barème NSIA (un mois entamé compte pour un mois entier). Les tarifs à lecture directe donnent leurs propres montants par durée.">
          {(donnees.Parametres || []).filter((p) => p.Cle === 'auto.coefficients_duree').map((p) => {
            const valeurs = String(p.Valeur || '').split('/');
            const libelles = ['15 jours ou moins', ...Array.from({ length: 12 }, (_, k) => `${k + 1} mois`)];
            return (
              <div key={`apercu-${p.Cle}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: '0.4rem', marginBottom: '0.9rem' }}>
                {libelles.map((l, k) => (
                  <div key={l} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '0.35rem 0.5rem', textAlign: 'center', background: [3, 6].includes(k) ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-surface)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{l}</div>
                    <div style={{ fontWeight: 800, fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}>{valeurs[k] ?? '-'} %</div>
                  </div>
                ))}
              </div>
            );
          })}
          {(donnees.Parametres || []).map((p) => (
            <LigneParametre key={p.Cle} parametre={p}
              modifier={parametrageApi.modifierParametreTarifsDirects} retablir={parametrageApi.retablirParametreTarifsDirects}
              onEnregistre={(n) => { setDonnees((d) => ({ ...d, Parametres: d.Parametres.map((x) => (x.Cle === n.Cle ? n : x)) })); chargerParametrage(true); }} />
          ))}
        </SectionParametrage>
      )}
    </div>
  );
};

export default ParametrageTarifsDirectsPage;
