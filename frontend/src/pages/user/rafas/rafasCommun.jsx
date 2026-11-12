import React, { useEffect, useId, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { CircleAlert, CircleCheck, Info, ListChecks, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { decimal, entier, francs, francsCourts, pct } from '../sante/consommations/graphiques';

/* =========================================================================
   RAFAS (régime autofinancé d'assurance santé) : briques communes aux écrans de la branche. Styles des consommations santé (cs-*, palette
   validée en clair et en sombre) et compléments rafas-* en fin d'index.css.
   ========================================================================= */

export { decimal, entier, francs, francsCourts, pct };

export const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '-');
export const moisFr = (iso) => {
  if (!iso) return '-';
  const [a, m] = String(iso).slice(0, 7).split('-');
  return `${['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'][Number(m) - 1]} ${a}`;
};
export const libelleRang = (rang) => (Number(rang) === 0 ? 'Convention de base' : `Avenant n°${rang} de renouvellement`);
export const periode = (e) => (e ? `du ${dateFr(e.date_effet)} au ${dateFr(e.date_echeance)}` : '');
export const taux = (v) => `${String(Number(v) || 0).replace('.', ',')} %`;
export const nombre = (v) => (v === '' || v === null || v === undefined ? '' : Number(String(v).replace(/[\s  ]/g, '').replace(',', '.')));

export const TONS = {
  critique: { icone: CircleAlert, libelle: 'À traiter en priorité' },
  attention: { icone: TriangleAlert, libelle: 'À vérifier' },
  info: { icone: Info, libelle: 'Pour information' },
  bon: { icone: CircleCheck, libelle: 'Normal' },
};

export const Carte = ({ titre, sousTitre, actions, children, className = '', id }) => (
  <section className={`glass-panel cs-carte ${className}`} id={id}>
    {(titre || actions) && (
      <header className="cs-carte-entete">
        <div>
          {titre && <h2>{titre}</h2>}
          {sousTitre && <p>{sousTitre}</p>}
        </div>
        {actions && <div className="rafas-actions">{actions}</div>}
      </header>
    )}
    {children}
  </section>
);

export const Tuile = ({ libelle, valeur, detail, ton, icone: Icone }) => (
  <div className={`cs-tuile${ton ? ` rafas-tuile-${ton}` : ''}`}>
    <div className="cs-tuile-libelle">{Icone && <Icone size={13} aria-hidden="true" style={{ verticalAlign: -2, marginRight: 4 }} />}{libelle}</div>
    <div className="cs-tuile-corps"><div className="cs-tuile-valeur" title={typeof valeur === 'string' ? valeur : undefined}>{valeur}</div></div>
    {detail && <div className="cs-tuile-detail">{detail}</div>}
  </div>
);

export const Badge = ({ ton = 'neutre', icone: Icone, children, titre }) => (
  <span className={`cs-etat ton-${ton}`} title={titre}>{Icone && <Icone size={13} aria-hidden="true" />}{children}</span>
);

export const Vide = ({ texte, action }) => (
  <div className="rafas-vide etat-anime">
    <ListChecks size={26} aria-hidden="true" />
    <p>{texte}</p>
    {action}
  </div>
);

export const Constats = ({ constats = [] }) => (
  <ul className="cs-constats en-grille">
    {constats.map((c) => {
      const Icone = (TONS[c.Ton] || TONS.info).icone;
      return (
        <li key={`${c.Titre}-${c.Texte.slice(0, 16)}`} className={`ton-${c.Ton}`}>
          <Icone size={16} aria-hidden="true" />
          <div><strong>{c.Titre}</strong><p>{c.Texte}</p></div>
        </li>
      );
    })}
  </ul>
);

/* Tableau de données : colonnes [{ cle, libelle, nombre, rendu(ligne) }], pied : ligne de total (objet), lignes cliquables avec onLigne */
export const Tableau = ({ colonnes, lignes, pied, vide = 'Aucune ligne.', onLigne, cle = (l, i) => i, compact, max }) => {
  const [tout, setTout] = useState(false);
  const affichees = max && !tout ? lignes.slice(0, max) : lignes;
  if (!lignes.length) return <p className="cs-vide">{vide}</p>;
  const cellule = (c, l) => (c.rendu ? c.rendu(l) : c.nombre && typeof l[c.cle] === 'number' ? entier(l[c.cle]) : l[c.cle] ?? '');
  return (
    <>
      <div className={`table-wrapper rafas-tableau${compact ? ' compact' : ''}`}>
        <table className="data-table">
          <thead><tr>{colonnes.map((c) => <th key={c.cle || c.libelle} className={c.nombre ? 'cs-nombre' : undefined}>{c.libelle}</th>)}</tr></thead>
          <tbody>
            {affichees.map((l, i) => (
              <tr key={cle(l, i)} className={onLigne ? 'rafas-cliquable' : undefined} onClick={onLigne ? () => onLigne(l) : undefined}
                tabIndex={onLigne ? 0 : undefined} onKeyDown={onLigne ? (e) => { if (e.key === 'Enter') onLigne(l); } : undefined}>
                {colonnes.map((c) => <td key={c.cle || c.libelle} className={c.nombre ? 'cs-nombre' : undefined}>{cellule(c, l)}</td>)}
              </tr>
            ))}
          </tbody>
          {pied && <tfoot><tr>{colonnes.map((c) => <td key={c.cle || c.libelle} className={c.nombre ? 'cs-nombre' : undefined}>{cellule(c, pied)}</td>)}</tr></tfoot>}
        </table>
      </div>
      {max && lignes.length > max && (
        <button type="button" className="cs-bouton-chiffres cs-plus" onClick={() => setTout((t) => !t)} aria-expanded={tout}>
          {tout ? 'Réduire' : `Voir les ${lignes.length - max} autres lignes`}
        </button>
      )}
    </>
  );
};

export const Tiroir = ({ ouvert, onFermer, titre, sousTitre, icone: Icone = Info, children, large }) => {
  const id = useId();
  const fermer = useRef(null);
  const surFermeture = useRef(onFermer);
  surFermeture.current = onFermer;
  useEffect(() => {
    if (!ouvert) return undefined;
    const precedent = document.activeElement;
    fermer.current?.focus();
    const touche = (e) => { if (e.key === 'Escape') surFermeture.current(); };
    document.addEventListener('keydown', touche);
    const debordement = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', touche);
      document.body.style.overflow = debordement;
      precedent?.focus?.();
    };
  }, [ouvert]);
  if (!ouvert) return null;
  return ReactDOM.createPortal(
    <div className="cs-tiroir-fond" onMouseDown={(e) => { if (e.target === e.currentTarget) onFermer(); }}>
      <aside className={`cs-tiroir${large ? ' rafas-tiroir-large' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="cs-tiroir-entete">
          <div>
            <h2 id={id}><Icone size={18} aria-hidden="true" />{titre}</h2>
            {sousTitre && <p>{sousTitre}</p>}
          </div>
          <button ref={fermer} type="button" className="cs-tiroir-fermer" onClick={onFermer} aria-label="Fermer"><X size={18} /></button>
        </header>
        <div className="cs-tiroir-corps">{children}</div>
      </aside>
    </div>,
    document.body,
  );
};

export const Champ = ({ libelle, aide, children, large, requis }) => (
  <label className={`form-group rafas-champ${large ? ' large' : ''}`}>
    <span className="form-label">{libelle}{requis && <span style={{ color: 'var(--accent-rose)' }} aria-hidden="true"> *</span>}</span>
    {children}
    {aide && <span className="champ-message aide">{aide}</span>}
  </label>
);

export const telecharger = (blob, nom) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export const nomFichier = (reponse, defaut) => {
  const entete = reponse?.headers?.['content-disposition'] || '';
  const m = /filename="?([^"]+)"?/.exec(entete);
  return m ? m[1] : defaut;
};

// ------------------------------------------------------------------ collèges et barème
export const budgetColleges = (colleges, tauxHonoraires, tauxCommission) => {
  const cotisations = colleges.reduce((s, c) => s + (Number(c.cotisation) || 0) * (Number(c.familles) || 0), 0);
  const honoraires = Math.round((cotisations * (Number(tauxHonoraires) || 0)) / 100);
  const commission = Math.round((cotisations * (Number(tauxCommission) || 0)) / 100);
  return { Cotisations: cotisations, Honoraires: honoraires, Commission: commission, Enveloppe: cotisations - honoraires - commission };
};

const RUBRIQUES = ['Soins ambulatoires', "Frais d'hospitalisation", 'Maternité et accouchement', 'Extension de couverture'];

export const EditeurBareme = ({ college, onChange, onFermer, lecture }) => {
  const lignes = college?.bareme || [];
  const modifier = (i, champ, valeur) => onChange(lignes.map((l, j) => (j === i ? { ...l, [champ]: valeur } : l)));
  return (
    <Tiroir ouvert={Boolean(college)} onFermer={onFermer} icone={ListChecks} large titre={`Barème de prise en charge : ${college?.libelle || ''}`}
      sousTitre="Taux, plafonds et observations du barème annexé à la convention ; les plafonds marqués servent aux contrôles (optique, dentaire).">
      <div className="table-wrapper rafas-tableau compact">
        <table className="data-table">
          <thead><tr><th>Rubrique</th><th>Prestation</th><th className="cs-nombre">Taux %</th><th className="cs-nombre">Plafond F</th><th>Observation</th><th>Garanti</th><th>Accord</th>{!lecture && <th aria-label="Retirer" />}</tr></thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i}>
                <td>{lecture ? l.Rubrique : <select className="form-control" value={l.Rubrique} onChange={(e) => modifier(i, 'Rubrique', e.target.value)}>{RUBRIQUES.map((r) => <option key={r}>{r}</option>)}</select>}</td>
                <td style={{ minWidth: 220 }}>{lecture ? l.Prestation : <input className="form-control" value={l.Prestation} onChange={(e) => modifier(i, 'Prestation', e.target.value)} />}</td>
                <td className="cs-nombre">{lecture ? (l.Taux ?? '') : <input className="form-control rafas-nombre" inputMode="decimal" value={l.Taux ?? ''} onChange={(e) => modifier(i, 'Taux', e.target.value === '' ? null : nombre(e.target.value))} />}</td>
                <td className="cs-nombre">{lecture ? (l.Plafond ? entier(l.Plafond) : '') : <input className="form-control rafas-nombre" inputMode="numeric" value={l.Plafond ?? ''} onChange={(e) => modifier(i, 'Plafond', e.target.value === '' ? null : nombre(e.target.value))} />}</td>
                <td>{lecture ? l.Observation : <input className="form-control" value={l.Observation} onChange={(e) => modifier(i, 'Observation', e.target.value)} />}</td>
                <td>{lecture ? (l.Garanti ? 'Oui' : 'Non') : <input type="checkbox" checked={!!l.Garanti} onChange={(e) => modifier(i, 'Garanti', e.target.checked)} aria-label="Garanti" />}</td>
                <td>{lecture ? (l.Accord ? 'Oui' : '') : <input type="checkbox" checked={!!l.Accord} onChange={(e) => modifier(i, 'Accord', e.target.checked)} aria-label="Accord préalable" />}</td>
                {!lecture && <td><button type="button" className="rafas-icone-bouton" onClick={() => onChange(lignes.filter((_, j) => j !== i))} aria-label="Retirer la ligne"><Trash2 size={15} /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!lecture && (
        <button type="button" className="btn btn-secondary rafas-bouton" onClick={() => onChange([...lignes, { Rubrique: RUBRIQUES[0], Prestation: '', Taux: 80, Plafond: null, Observation: '', Garanti: true, Accord: false, Controle: '' }])}>
          <Plus size={15} /> Ajouter une prestation
        </button>
      )}
    </Tiroir>
  );
};

/* Collèges d'un exercice : libellé, catégorie, cotisation annuelle par famille, familles, plafond annuel par famille, barème.
   modeles : collèges types (barème de l'annexe I, plafond) par catégorie. */
export const EditeurColleges = ({ colleges, onChange, modeles, familiesReelles, exigerCotisation }) => {
  const [bareme, setBareme] = useState(null);
  const modifier = (i, champ, valeur) => onChange(colleges.map((c, j) => (j === i ? { ...c, [champ]: valeur } : c)));
  const ajouter = (categorie) => onChange([...colleges, { ...(modeles?.[categorie] || {}), code: '', libelle: '', categorie, cotisation: '', familles: '' }]);
  return (
    <div className="rafas-colleges">
      {colleges.length === 0 && <p className="cs-muet">Ajoutez les collèges de la convention : chacun a sa cotisation annuelle par famille et son barème.</p>}
      {colleges.map((c, i) => {
        const aSaisir = exigerCotisation && !Number(c.cotisation);
        const aide = familiesReelles?.[c.code] !== undefined ? `${entier(familiesReelles[c.code])} dans l'effectif`
          : c.beneficiaires ? `Fichier : ${entier(c.beneficiaires)} bénéficiaires` : undefined;
        return (
          <div key={c.code || `n${i}`} className={`rafas-college${aSaisir ? ' a-saisir' : ''}`}>
            <Champ libelle="Collège" requis>
              <input className="form-control" value={c.libelle} placeholder="Ex. EXAT AGRICULTURE - CADRES" onChange={(e) => modifier(i, 'libelle', e.target.value)} />
            </Champ>
            <Champ libelle="Catégorie">
              <select className="form-control" value={c.categorie} onChange={(e) => modifier(i, 'categorie', e.target.value)} title="AM/O : agents de maîtrise et ouvriers">
                <option value="AM/O">AM/O</option>
                <option value="CADRES">CADRES</option>
              </select>
            </Champ>
            <Champ libelle="Familles" aide={aide}>
              <input className="form-control rafas-nombre" inputMode="numeric" value={c.familles} onChange={(e) => modifier(i, 'familles', nombre(e.target.value))} />
            </Champ>
            <Champ libelle="Cotisation par famille (F)" requis aide={aSaisir ? 'Convention ou dernier avenant' : undefined}>
              <input className={`form-control rafas-nombre${aSaisir ? ' rafas-a-saisir' : ''}`} inputMode="numeric" value={c.cotisation}
                autoFocus={exigerCotisation && i === colleges.findIndex((x) => !Number(x.cotisation))} onChange={(e) => modifier(i, 'cotisation', nombre(e.target.value))} />
            </Champ>
            <Champ libelle="Plafond annuel (F)">
              <input className="form-control rafas-nombre" inputMode="numeric" value={c.plafond_famille ?? ''} onChange={(e) => modifier(i, 'plafond_famille', e.target.value === '' ? null : nombre(e.target.value))} />
            </Champ>
            <div className="rafas-college-budget">
              <span>Cotisations</span>
              <strong>{francs((Number(c.cotisation) || 0) * (Number(c.familles) || 0))}</strong>
              <button type="button" className="btn btn-link" style={{ padding: 0 }} onClick={() => setBareme(i)}>{`Barème : ${(c.bareme || []).length} lignes`}</button>
            </div>
            <button type="button" className="rafas-icone-bouton rafas-college-retirer" onClick={() => onChange(colleges.filter((_, j) => j !== i))} aria-label={`Retirer le collège ${c.libelle}`}><Trash2 size={16} /></button>
          </div>
        );
      })}
      <div className="rafas-actions">
        <button type="button" className="btn btn-secondary rafas-bouton" onClick={() => ajouter('AM/O')}><Plus size={15} /> Collège AM/O</button>
        <button type="button" className="btn btn-secondary rafas-bouton" onClick={() => ajouter('CADRES')}><Plus size={15} /> Collège CADRES</button>
      </div>
      <EditeurBareme college={bareme === null ? null : colleges[bareme]} onFermer={() => setBareme(null)} onChange={(lignes) => modifier(bareme, 'bareme', lignes)} />
    </div>
  );
};
