import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Table2 } from 'lucide-react';

/* =========================================================================
   Graphiques des consommations santé, en SVG et HTML sans bibliothèque.
   Palette de référence validée (skill dataviz, validate_palette.js) en sombre et en clair contre les surfaces de l'application :
   variables --cs-* de la section CONSOMMATIONS SANTÉ d'index.css. Règles suivies : un seul axe par graphique, marques fines
   (colonnes et barres de 24 px au plus, bout arrondi de 4 px), traits de 2 px, grille en filet discret, textes à l'encre du thème
   (jamais à la couleur de la série), légende dès deux séries, bulle au survol ET au clavier, et vue en chiffres pour chaque graphique.
   ========================================================================= */

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nfCompact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const vide = (v) => v === null || v === undefined || Number.isNaN(Number(v));

export const entier = (v) => (vide(v) ? '-' : nf0.format(Math.round(Number(v))));
export const francs = (v) => (vide(v) ? '-' : `${entier(v)} F`);
export const compact = (v) => (vide(v) ? '-' : Math.abs(Number(v)) < 10000 ? entier(v) : nfCompact.format(Number(v)));
export const francsCourts = (v) => (vide(v) ? '-' : `${compact(v)} F`);
export const pct = (v, chiffres = 1) => (vide(v) ? '-' : `${(Number(v) * 100).toLocaleString('fr-FR', { maximumFractionDigits: chiffres })} %`);
export const decimal = (v, chiffres = 1) => (vide(v) ? '-' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: chiffres, maximumFractionDigits: chiffres }));

// Largeur disponible du conteneur, suivie au redimensionnement
export const useLargeur = (initiale = 640) => {
  const ref = useRef(null);
  const [largeur, setLargeur] = useState(initiale);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const obs = new ResizeObserver(([entree]) => setLargeur(Math.max(240, Math.round(entree.contentRect.width))));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, largeur];
};

// Graduation « ronde » : 1, 2, 2,5 ou 5 × 10^n, axe qui commence à zéro
const pasRond = (max, nombreDePas = 4) => {
  if (max <= 0) return 1;
  const brut = max / nombreDePas;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  return [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((p) => p >= brut) || puissance * 10;
};
const echelle = (max, nombreDePas = 4) => {
  const pas = pasRond(max, nombreDePas);
  const haut = Math.max(pas, Math.ceil(max / pas) * pas);
  return { haut, graduations: Array.from({ length: Math.round(haut / pas) + 1 }, (_, i) => i * pas) };
};

// Colonne : bout arrondi de 4 px en haut, base droite sur l'axe
const colonne = (x, y, l, h) => {
  if (h <= 0.5) return '';
  const r = Math.min(4, l / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + l - r}Q${x + l},${y} ${x + l},${y + r}V${y + h}Z`;
};

// ------------------------------------------------------------------ cadre, légende, bulle, chiffres
export const Legende = ({ elements }) => (
  <ul className="cs-legende" aria-label="Légende">
    {elements.map((e) => (
      <li key={e.libelle}>
        <span className={`cs-cle cs-cle-${e.forme || 'barre'}`} style={{ '--cs-cle': e.couleur }} aria-hidden="true" />
        {e.libelle}
      </li>
    ))}
  </ul>
);

const TableauChiffres = ({ entetes, lignes, pied }) => (
  <div className="table-wrapper cs-chiffres">
    <table className="data-table">
      <thead><tr>{entetes.map((e, i) => <th key={e} className={i ? 'cs-nombre' : undefined}>{e}</th>)}</tr></thead>
      <tbody>{lignes.map((l, n) => <tr key={`${l[0]}-${n}`}>{l.map((c, i) => <td key={i} className={i ? 'cs-nombre' : undefined}>{c}</td>)}</tr>)}</tbody>
      {pied && <tfoot><tr>{pied.map((c, i) => <td key={i} className={i ? 'cs-nombre' : undefined}>{c}</td>)}</tr></tfoot>}
    </table>
  </div>
);

/* Carte d'un graphique : titre, sous-titre, légende, bouton « Voir les chiffres » (vue tableau, équivalent accessible du graphique),
   note sous le graphique. `tableau` : { entetes, lignes, pied } en textes déjà formatés. */
export const Cadre = ({ titre, sousTitre, legende, tableau, note, actions, children, className = '' }) => {
  const [chiffres, setChiffres] = useState(false);
  const id = useId();
  return (
    <figure className={`cs-graphique ${className}`} aria-labelledby={titre ? id : undefined}>
      {(titre || tableau || actions) && (
        <div className="cs-graphique-entete">
          <div>
            {titre && <h3 id={id} className="cs-graphique-titre">{titre}</h3>}
            {sousTitre && <p className="cs-graphique-sous-titre">{sousTitre}</p>}
          </div>
          <div className="cs-graphique-outils">
            {actions}
            {tableau && (
              <button type="button" className="cs-bouton-chiffres" aria-pressed={chiffres} onClick={() => setChiffres((c) => !c)}>
                <Table2 size={13} aria-hidden="true" />{chiffres ? 'Masquer les chiffres' : 'Voir les chiffres'}
              </button>
            )}
          </div>
        </div>
      )}
      {legende && <Legende elements={legende} />}
      {children}
      {note && <p className="cs-graphique-note">{note}</p>}
      {chiffres && tableau && <TableauChiffres {...tableau} />}
    </figure>
  );
};

// Bulle : la valeur d'abord (forte), puis le libellé ; clé en trait court de la couleur de la série
const Bulle = ({ x, y, largeur, titre, lignes }) => (
  <div className="cs-bulle" role="presentation" style={{ left: Math.min(Math.max(x, 150), Math.max(150, largeur - 150)), top: y }}>
    <div className="cs-bulle-titre">{titre}</div>
    {lignes.map((l) => (
      <div key={l.libelle} className="cs-bulle-ligne">
        {l.couleur && <span className="cs-bulle-cle" style={{ background: l.couleur }} aria-hidden="true" />}
        <strong>{l.valeur}</strong>
        <span>{l.libelle}</span>
      </div>
    ))}
  </div>
);

// ------------------------------------------------------------------ figures
// Courbe miniature d'une tuile : série en teinte atténuée, dernier point à l'accent
export const Sparkline = ({ valeurs = [], largeur = 104, hauteur = 30, libelle }) => {
  const v = valeurs.map((x) => (vide(x) ? null : Number(x)));
  const connus = v.filter((x) => x !== null);
  if (connus.length < 2) return null;
  const min = Math.min(...connus);
  const max = Math.max(...connus);
  const x = (i) => 2 + (i / (v.length - 1)) * (largeur - 6);
  const y = (val) => (max === min ? hauteur / 2 : 3 + (1 - (val - min) / (max - min)) * (hauteur - 6));
  let trace = '';
  v.forEach((val, i) => { if (val !== null) trace += `${trace && v[i - 1] !== null ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`; });
  const dernier = v.length - 1 - [...v].reverse().findIndex((val) => val !== null);
  return (
    <svg className="cs-sparkline" width={largeur} height={hauteur} role="img" aria-label={libelle}>
      <path d={trace} />
      <circle cx={x(dernier)} cy={y(v[dernier])} r={3.5} />
    </svg>
  );
};

/* Jauge : consommation rapportée à une limite (provision, plafond). La piste est un pas plus clair de la teinte du remplissage ;
   le remplissage porte la gravité (accent, attention, critique) ; repère = part attendue à date ; projection = remplissage léger. */
export const Jauge = ({ taux, projete, repere, ton = 'normal', libelle, fine = false }) => {
  const borne = (t) => `${Math.max(0, Math.min(1, Number(t) || 0)) * 100}%`;
  return (
    <div className={`cs-jauge ton-${ton}${fine ? ' fine' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round((Number(taux) || 0) * 100)} aria-label={libelle}>
      {!vide(projete) && <span className="cs-jauge-projete" style={{ width: borne(projete) }} />}
      <span className="cs-jauge-rempli" style={{ width: borne(taux) }} />
      {!vide(repere) && <span className="cs-jauge-repere" style={{ left: borne(repere) }} />}
    </div>
  );
};

// Indice centré sur 100 : à droite (rouge) plus cher que la médiane, à gauche (bleu) moins cher ; milieu gris
export const IndiceDivergent = ({ indice, max = 250 }) => {
  if (vide(indice)) return <span className="cs-muet">-</span>;
  const ecart = Math.max(-1, Math.min(1, (indice - 100) / (max - 100)));
  return (
    <span className="cs-indice" title={`Indice ${indice} : ${indice >= 100 ? `${indice - 100} % au-dessus` : `${100 - indice} % au-dessous`} du coût médian des mêmes actes`}>
      <span className="cs-indice-piste" aria-hidden="true">
        <span className={`cs-indice-barre ${ecart >= 0 ? 'haut' : 'bas'}`} style={ecart >= 0 ? { left: '50%', width: `${ecart * 50}%` } : { right: '50%', width: `${-ecart * 50}%` }} />
      </span>
      <strong>{indice}</strong>
    </span>
  );
};

// ------------------------------------------------------------------ colonnes (une série par mois)
export const Colonnes = ({ points, format = francs, hauteur = 230, titreBulle = (p) => p.libelle, lignesBulle, libelleAria }) => {
  const [ref, largeur] = useLargeur();
  const [actif, setActif] = useState(null);
  const M = { haut: 18, droite: 8, bas: 26, gauche: 50 };
  const { haut, graduations } = useMemo(() => echelle(Math.max(0, ...points.map((p) => Number(p.valeur) || 0))), [points]);
  const L = largeur - M.gauche - M.droite;
  const H = hauteur - M.haut - M.bas;
  const bande = L / Math.max(points.length, 1);
  const ep = Math.max(6, Math.min(24, bande * 0.56));
  const y = (v) => M.haut + H - (Math.max(0, Number(v) || 0) / haut) * H;
  const cx = (i) => M.gauche + bande * i + bande / 2;
  const sauter = bande < 38 ? 2 : 1;
  const iMax = points.reduce((m, p, i) => ((Number(p.valeur) || 0) > (Number(points[m]?.valeur) || 0) ? i : m), 0);
  const p = actif === null ? null : points[actif];
  return (
    <div ref={ref} className="cs-zone" onMouseLeave={() => setActif(null)}>
      <svg width={largeur} height={hauteur} role="img" aria-label={libelleAria}>
        {graduations.map((g) => (
          <g key={g}>
            <line x1={M.gauche} x2={largeur - M.droite} y1={y(g)} y2={y(g)} className={g === 0 ? 'cs-axe' : 'cs-grille'} />
            <text x={M.gauche - 8} y={y(g)} dy="0.32em" textAnchor="end" className="cs-graduation">{compact(g)}</text>
          </g>
        ))}
        {points.map((pt, i) => (
          <g key={pt.cle}>
            {actif === i && <rect x={M.gauche + bande * i} y={M.haut} width={bande} height={H} className="cs-survol" />}
            {!pt.futur && <path d={colonne(cx(i) - ep / 2, y(pt.valeur), ep, y(0) - y(pt.valeur))} className={`cs-colonne${pt.attenue ? ' attenue' : ''}${actif === i ? ' active' : ''}`} />}
            {i % sauter === 0 && <text x={cx(i)} y={hauteur - 8} textAnchor="middle" className="cs-graduation">{pt.libelleCourt || pt.libelle}</text>}
          </g>
        ))}
        {points[iMax] && Number(points[iMax].valeur) > 0 && (
          <text x={cx(iMax)} y={y(points[iMax].valeur) - 6} textAnchor="middle" className="cs-etiquette">{compact(points[iMax].valeur)}</text>
        )}
        {points.map((pt, i) => (
          <rect key={`z-${pt.cle}`} x={M.gauche + bande * i} y={M.haut} width={bande} height={H + M.bas} className="cs-cible" tabIndex={pt.futur ? -1 : 0}
            aria-label={`${titreBulle(pt)} : ${format(pt.valeur)}`} onMouseEnter={() => setActif(i)} onFocus={() => setActif(i)} onBlur={() => setActif(null)} />
        ))}
      </svg>
      {p && !p.futur && (
        <Bulle x={cx(actif)} y={M.haut} largeur={largeur} titre={titreBulle(p)}
          lignes={lignesBulle ? lignesBulle(p) : [{ libelle: 'Dépenses', valeur: format(p.valeur), couleur: 'var(--cs-viz-1)' }]} />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ courbes sur un seul axe
   series : [{ cle, libelle, valeurs, couleur, style: 'plein' | 'tirets' | 'repere' }] ; etiquettes : [{ cle, libelle, libelleCourt }].
   Réticule vertical calé sur le mois le plus proche, une bulle pour toutes les séries ; libellé à la fin de chaque série. */
export const Courbes = ({ etiquettes, series, format = francs, hauteur = 260, libelleAria, marques = {} }) => {
  const [ref, largeur] = useLargeur();
  const [actif, setActif] = useState(null);
  const M = { haut: 16, droite: 84, bas: 26, gauche: 52 };
  const { haut, graduations } = useMemo(() => echelle(Math.max(0, ...series.flatMap((s) => s.valeurs.filter((v) => !vide(v)).map(Number)))), [series]);
  const L = largeur - M.gauche - M.droite;
  const H = hauteur - M.haut - M.bas;
  const n = Math.max(etiquettes.length, 1);
  const x = (i) => M.gauche + (n === 1 ? L / 2 : (i / (n - 1)) * L);
  const y = (v) => M.haut + H - (Math.max(0, Number(v) || 0) / haut) * H;
  const trace = (valeurs) => valeurs.reduce((d, v, i) => (vide(v) ? d : `${d}${d && !vide(valeurs[i - 1]) ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), '');
  const sauter = L / n < 40 ? 2 : 1;
  // Libellés de fin (valeur et nom) : un libellé trop proche d'un autre au même mois est omis, la légende et la bulle le portent
  const fins = series.map((s) => {
    const i = s.valeurs.length - 1 - [...s.valeurs].reverse().findIndex((v) => !vide(v));
    return i >= 0 && i < s.valeurs.length ? { s, i, y: y(s.valeurs[i]) + (s.decalageFin || 0) } : null;
  }).filter(Boolean);
  const finsAffichees = [];
  fins.forEach((f) => { if (finsAffichees.every((g) => g.i !== f.i || Math.abs(g.y - f.y) >= 28)) finsAffichees.push(f); });
  const choisir = (evenement) => {
    const rect = evenement.currentTarget.getBoundingClientRect();
    const px = evenement.clientX - rect.left;
    setActif(Math.max(0, Math.min(n - 1, Math.round(((px - M.gauche) / Math.max(L, 1)) * (n - 1)))));
  };
  const lignesBulle = actif === null ? [] : series.filter((s) => !vide(s.valeurs[actif])).map((s) => ({ libelle: s.libelle, valeur: format(s.valeurs[actif]), couleur: s.couleur }));
  return (
    <div ref={ref} className="cs-zone" onMouseLeave={() => setActif(null)}>
      <svg width={largeur} height={hauteur} role="img" aria-label={libelleAria} onMouseMove={choisir}>
        {graduations.map((g) => (
          <g key={g}>
            <line x1={M.gauche} x2={largeur - M.droite} y1={y(g)} y2={y(g)} className={g === 0 ? 'cs-axe' : 'cs-grille'} />
            <text x={M.gauche - 8} y={y(g)} dy="0.32em" textAnchor="end" className="cs-graduation">{compact(g)}</text>
          </g>
        ))}
        {etiquettes.map((e, i) => (i % sauter === 0 ? <text key={e.cle} x={x(i)} y={hauteur - 8} textAnchor="middle" className="cs-graduation">{e.libelleCourt || e.libelle}</text> : null))}
        {series.map((s) => (
          <g key={s.cle}>
            {s.aire && <path d={`${trace(s.valeurs)}V${y(0)}H${x(s.valeurs.findIndex((v) => !vide(v)))}Z`} className="cs-aire" style={{ '--cs-serie': s.couleur }} />}
            <path d={trace(s.valeurs)} className={`cs-ligne ${s.style || 'plein'}`} style={{ '--cs-serie': s.couleur }} />
          </g>
        ))}
        {Object.entries(marques).map(([i, m]) => series.filter((s) => s.cle === m.serie && !vide(s.valeurs[i])).map((s) => (
          <circle key={`m-${s.cle}-${i}`} cx={x(Number(i))} cy={y(s.valeurs[i])} r={4.5} className="cs-point creux" style={{ '--cs-serie': s.couleur }} />
        )))}
        {finsAffichees.map(({ s, i, y: yf }) => (
          <g key={`fin-${s.cle}`}>
            {s.style !== 'repere' && <circle cx={x(i)} cy={y(s.valeurs[i])} r={4} className="cs-point" style={{ '--cs-serie': s.couleur }} />}
            <text x={x(i) + 8} y={yf} dy="0.32em" className="cs-etiquette">{compact(s.valeurs[i])}</text>
            {s.libelleFin && <text x={x(i) + 8} y={yf + 13} dy="0.32em" className="cs-etiquette-secondaire">{s.libelleFin}</text>}
          </g>
        ))}
        {actif !== null && (
          <g>
            <line x1={x(actif)} x2={x(actif)} y1={M.haut} y2={y(0)} className="cs-reticule" />
            {series.filter((s) => !vide(s.valeurs[actif])).map((s) => <circle key={`a-${s.cle}`} cx={x(actif)} cy={y(s.valeurs[actif])} r={4} className="cs-point" style={{ '--cs-serie': s.couleur }} />)}
          </g>
        )}
        {etiquettes.map((e, i) => (
          <rect key={`z-${e.cle}`} x={x(i) - (L / Math.max(n - 1, 1)) / 2} y={M.haut} width={L / Math.max(n - 1, 1)} height={H} className="cs-cible" tabIndex={0}
            aria-label={`${e.libelleLong || e.libelle} : ${series.filter((s) => !vide(s.valeurs[i])).map((s) => `${s.libelle} ${format(s.valeurs[i])}`).join(', ') || 'aucune valeur'}`}
            onFocus={() => setActif(i)} onBlur={() => setActif(null)} />
        ))}
      </svg>
      {actif !== null && lignesBulle.length > 0 && (
        <Bulle x={x(actif)} y={M.haut} largeur={largeur} titre={etiquettes[actif].libelleLong || etiquettes[actif].libelle} lignes={lignesBulle} />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ barres classées (une teinte), valeur au bout de la barre
   lignes : [{ cle, libelle, detail, valeur, valeurAffichee, annexes: [texte], attenue }] ; colonnes : en-têtes des annexes. */
export const BarresClassees = ({ lignes, format = francs, colonnes = [], onChoisir, libelleValeur = 'Dépenses', max: maxImpose }) => {
  const max = maxImpose || Math.max(0, ...lignes.map((l) => Number(l.valeur) || 0)) || 1;
  const Ligne = onChoisir ? 'button' : 'div';
  // Colonnes communes à toutes les lignes : libellé, barre, puis annexes de largeur fixe (alignées d'une ligne à l'autre)
  const grille = `minmax(9.5rem, 1.2fr) minmax(8rem, 1.6fr)${' 6.4rem'.repeat(colonnes.length)}`;
  return (
    <div className={`cs-barres${onChoisir ? ' cliquables' : ''}`} style={{ '--cs-barres-grille': grille }}>
      {colonnes.length > 0 && (
        <div className="cs-barres-ligne entete" aria-hidden="true">
          <span />
          <span>{libelleValeur}</span>
          {colonnes.map((c) => <span key={c} className="cs-nombre">{c}</span>)}
        </div>
      )}
      {lignes.map((l) => (
        <Ligne key={l.cle} type={onChoisir ? 'button' : undefined} className={`cs-barres-ligne${l.attenue ? ' attenue' : ''}`} onClick={onChoisir ? () => onChoisir(l) : undefined}
          aria-label={`${l.libelle}${l.detail ? `, ${l.detail}` : ''} : ${libelleValeur.toLowerCase()} ${l.valeurAffichee || format(l.valeur)}${(l.annexes || []).map((a, i) => `, ${(colonnes[i] || '').toLowerCase()} ${a}`).join('')}`}>
          <span className="cs-barres-libelle">
            <span className="cs-barres-nom" title={l.libelle}>{l.libelle}</span>
            {l.detail && <span className="cs-barres-detail" title={l.detail}>{l.detail}</span>}
          </span>
          {/* la piste réserve à droite la place de la valeur : la plus longue barre garde 100 % de sa longueur */}
          <span className="cs-barres-piste">
            <span className="cs-barres-barre" style={{ width: `${Math.max(0.6, ((Number(l.valeur) || 0) / max) * 100)}%` }} />
            <span className="cs-barres-valeur">{l.valeurAffichee || format(l.valeur)}</span>
          </span>
          {(l.annexes || []).map((a, i) => <span key={i} className="cs-nombre cs-barres-annexe">{a}</span>)}
        </Ligne>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ barre segmentée haute (un tout en 6 parts au plus)
   Chaque part : son bloc, sa part imprimée dedans quand elle tient ; légende des noms dans l'ordre des blocs ; bulle au survol et au clavier. */
const CLASSES_SEGMENT = ['cs-seg-1', 'cs-seg-2', 'cs-seg-3', 'cs-seg-4', 'cs-seg-5', 'cs-seg-6'];
export const BarreSegmentee = ({ parts, format = francs, libelleAria }) => {
  const [ref, largeur] = useLargeur();
  const [actif, setActif] = useState(null);
  const total = parts.reduce((s, p) => s + Math.max(0, Number(p.valeur) || 0), 0) || 1;
  const visibles = parts.filter((p) => Number(p.valeur) > 0);
  const espace = 2 * Math.max(visibles.length - 1, 0);
  let x = 0;
  const blocs = visibles.map((p) => {
    const l = ((Number(p.valeur) || 0) / total) * (largeur - espace);
    const bloc = { ...p, x, l, part: (Number(p.valeur) || 0) / total, classe: CLASSES_SEGMENT[parts.indexOf(p)] };
    x += l + 2;
    return bloc;
  });
  const a = actif === null ? null : blocs[actif];
  return (
    <div className="cs-segmentee">
      <div ref={ref} className="cs-zone" onMouseLeave={() => setActif(null)}>
        <div className="cs-segmentee-barre" role="group" aria-label={libelleAria || parts.map((p) => `${p.libelle} ${format(p.valeur)}, ${pct(p.valeur / total)}`).join(' ; ')}>
          {blocs.map((b, i) => {
            const texte = pct(b.part, b.part < 0.1 ? 1 : 0);
            const tient = b.l >= texte.length * 7.2 + 14;
            return (
              <span key={b.cle} className={`cs-segment ${b.classe}${actif === i ? ' actif' : ''}`} style={{ left: b.x, width: Math.max(b.l, 1) }} tabIndex={0}
                aria-label={`${b.libelle} : ${format(b.valeur)}, ${pct(b.part)}`} onMouseEnter={() => setActif(i)} onFocus={() => setActif(i)} onBlur={() => setActif(null)}>
                {tient && texte}
              </span>
            );
          })}
        </div>
        {a && <Bulle x={a.x + a.l / 2} y={36} largeur={largeur} titre={a.libelle} lignes={[{ libelle: 'du total', valeur: `${format(a.valeur)} - ${pct(a.part)}` }]} />}
      </div>
      <Legende elements={parts.map((p, i) => ({ libelle: p.libelle, couleur: `var(--cs-seg-${i + 1})` }))} />
    </div>
  );
};

/* ------------------------------------------------------------------ tableau de chaleur : chiffres dans les cases, fond selon l'intensité
   L'intensité de chaque case est rapportée au mois le plus élevé de sa ligne (lecture de l'évolution propre à chaque famille). */
export const TableauChaleur = ({ colonnes, lignes, format = compact, libelleLigne = 'Famille', total = true }) => (
  <div className="table-wrapper cs-chaleur">
    <table className="data-table">
      <thead>
        <tr>
          <th>{libelleLigne}</th>
          {colonnes.map((c) => <th key={c.cle} className="cs-nombre">{c.libelle}</th>)}
          {total && <th className="cs-nombre">Total</th>}
        </tr>
      </thead>
      <tbody>
        {lignes.map((l) => {
          const max = Math.max(0, ...l.valeurs.map((v) => Number(v) || 0)) || 1;
          return (
            <tr key={l.cle}>
              <th scope="row">{l.libelle}</th>
              {l.valeurs.map((v, i) => {
                const pas = vide(v) || !Number(v) ? 0 : Math.min(7, 1 + Math.floor(((Number(v) || 0) / max) * 6.999));
                return (
                  <td key={colonnes[i].cle} className={`cs-nombre cs-chaleur-${pas}`} title={`${l.libelle}, ${colonnes[i].libelleLong || colonnes[i].libelle} : ${francs(v)}`}>
                    {vide(v) || !Number(v) ? '-' : format(v)}
                  </td>
                );
              })}
              {total && <td className="cs-nombre cs-chaleur-total">{format(l.valeurs.reduce((s, v) => s + (Number(v) || 0), 0))}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export const EchelleChaleur = ({ bas = 'Mois le plus faible', haut = 'Mois le plus élevé de la ligne' }) => (
  <div className="cs-echelle" aria-hidden="true">
    <span>{bas}</span>
    {[1, 2, 3, 4, 5, 6, 7].map((p) => <span key={p} className={`cs-echelle-pas cs-chaleur-${p}`} />)}
    <span>{haut}</span>
  </div>
);

/* ------------------------------------------------------------------ pyramide des âges : deux séries en miroir, tranche au centre
   lignes : [{ cle, libelle, gauche, droite }] ; valeur au bout de chaque barre. */
export const Pyramide = ({ lignes, libelleGauche, libelleDroite, couleurGauche = 'var(--cs-viz-2)', couleurDroite = 'var(--cs-viz-1)' }) => {
  const max = Math.max(1, ...lignes.flatMap((l) => [Number(l.gauche) || 0, Number(l.droite) || 0]));
  return (
    <div className="cs-pyramide" role="table" aria-label={`${libelleGauche} et ${libelleDroite} par tranche d'âge`}>
      <Legende elements={[{ libelle: libelleGauche, couleur: couleurGauche }, { libelle: libelleDroite, couleur: couleurDroite }]} />
      {lignes.map((l) => (
        <div key={l.cle} className="cs-pyramide-ligne" role="row">
          <span className="cs-pyramide-cote gauche" role="cell" aria-label={`${libelleGauche} ${l.libelle} : ${entier(l.gauche)}`}>
            <span className="cs-pyramide-valeur">{entier(l.gauche)}</span>
            <span className="cs-pyramide-rail"><span className="cs-pyramide-barre" style={{ width: `${((Number(l.gauche) || 0) / max) * 100}%`, '--cs-serie': couleurGauche }} /></span>
          </span>
          <span className="cs-pyramide-libelle" role="rowheader">{l.libelle}</span>
          <span className="cs-pyramide-cote droite" role="cell" aria-label={`${libelleDroite} ${l.libelle} : ${entier(l.droite)}`}>
            <span className="cs-pyramide-rail"><span className="cs-pyramide-barre" style={{ width: `${((Number(l.droite) || 0) / max) * 100}%`, '--cs-serie': couleurDroite }} /></span>
            <span className="cs-pyramide-valeur">{entier(l.droite)}</span>
          </span>
        </div>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ courbe de concentration (Pareto)
   points : [{ PartFoyers, PartDepenses }] de 0 à 1 ; diagonale = répartition parfaitement égale ; repère sur un point choisi. */
export const CourbeConcentration = ({ points, repere, hauteur = 240, libelleX = 'foyers', libelleY = 'dépenses' }) => {
  const [ref, largeur] = useLargeur(420);
  const [actif, setActif] = useState(null);
  const M = { haut: 14, droite: 16, bas: 30, gauche: 44 };
  const L = largeur - M.gauche - M.droite;
  const H = hauteur - M.haut - M.bas;
  const x = (v) => M.gauche + v * L;
  const y = (v) => M.haut + H - v * H;
  const trace = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.PartFoyers).toFixed(1)},${y(p.PartDepenses).toFixed(1)}`).join('');
  const graduations = [0, 0.25, 0.5, 0.75, 1];
  const choisir = (evenement) => {
    const rect = evenement.currentTarget.getBoundingClientRect();
    const v = (evenement.clientX - rect.left - M.gauche) / Math.max(L, 1);
    setActif(points.reduce((m, p, i) => (Math.abs(p.PartFoyers - v) < Math.abs(points[m].PartFoyers - v) ? i : m), 0));
  };
  const p = actif === null ? null : points[actif];
  return (
    <div ref={ref} className="cs-zone" onMouseLeave={() => setActif(null)}>
      <svg width={largeur} height={hauteur} role="img" onMouseMove={choisir}
        aria-label={repere ? `${pct(repere.PartFoyers, 0)} des ${libelleX} font ${pct(repere.PartDepenses, 0)} des ${libelleY}` : `Concentration des ${libelleY}`}>
        {graduations.map((g) => (
          <g key={g}>
            <line x1={M.gauche} x2={largeur - M.droite} y1={y(g)} y2={y(g)} className={g === 0 ? 'cs-axe' : 'cs-grille'} />
            <text x={M.gauche - 8} y={y(g)} dy="0.32em" textAnchor="end" className="cs-graduation">{pct(g, 0)}</text>
            <text x={x(g)} y={hauteur - 12} textAnchor="middle" className="cs-graduation">{pct(g, 0)}</text>
          </g>
        ))}
        <text x={largeur - M.droite} y={hauteur - 1} textAnchor="end" className="cs-graduation">{`part des ${libelleX}, des plus gros aux plus petits`}</text>
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="cs-diagonale" />
        <path d={`${trace}V${y(0)}H${x(0)}Z`} className="cs-aire" style={{ '--cs-serie': 'var(--cs-viz-1)' }} />
        <path d={trace} className="cs-ligne plein" style={{ '--cs-serie': 'var(--cs-viz-1)' }} />
        {repere && (
          <g>
            <line x1={x(repere.PartFoyers)} x2={x(repere.PartFoyers)} y1={y(repere.PartDepenses)} y2={y(0)} className="cs-reticule" />
            <circle cx={x(repere.PartFoyers)} cy={y(repere.PartDepenses)} r={4.5} className="cs-point" style={{ '--cs-serie': 'var(--cs-viz-1)' }} />
            <text x={x(repere.PartFoyers) + 8} y={y(repere.PartDepenses) + 4} className="cs-etiquette">{`${pct(repere.PartFoyers, 0)} des ${libelleX} : ${pct(repere.PartDepenses, 0)} des ${libelleY}`}</text>
          </g>
        )}
        {p && <circle cx={x(p.PartFoyers)} cy={y(p.PartDepenses)} r={4} className="cs-point" style={{ '--cs-serie': 'var(--cs-viz-1)' }} />}
      </svg>
      {p && <Bulle x={x(p.PartFoyers)} y={M.haut} largeur={largeur} titre={`${pct(p.PartFoyers, 0)} des ${libelleX}`} lignes={[{ libelle: `des ${libelleY}`, valeur: pct(p.PartDepenses, 0), couleur: 'var(--cs-viz-1)' }]} />}
    </div>
  );
};
