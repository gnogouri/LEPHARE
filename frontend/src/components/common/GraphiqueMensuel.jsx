import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Table2 } from 'lucide-react';

import { francs } from './Cockpit';

// Deux mesures par mois en colonnes (exercice et précédent) et une en courbe, sur un seul axe en francs : par défaut la
// production TTC et les encaissements ; le tableau de bord y montre aussi le chiffre d'affaires du cabinet (series).
// Bulle au survol et au clavier ; les chiffres restent lisibles sans elle (tableau).
const MOIS = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleDateString('fr-FR', { month: 'short' }));
const MOIS_LONG = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleDateString('fr-FR', { month: 'long' }));
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

const HAUTEUR = 260;
const MARGE = { haut: 14, droite: 12, bas: 28, gauche: 58 };

// Graduation « ronde » : 1, 2 ou 5 × 10^n
const pasRond = (max, nombreDePas = 4) => {
  if (max <= 0) return 1;
  const brut = max / nombreDePas;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  return [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((p) => p >= brut) || puissance * 10;
};

// Colonne à extrémité arrondie (4 px), base droite sur l'axe
const colonne = (x, y, l, h) => {
  if (h <= 0) return '';
  const r = Math.min(4, l / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + l - r}Q${x + l},${y} ${x + l},${y + r}V${y + h}Z`;
};

// Séries par défaut : classes n (exercice), n1 (exercice précédent), enc (courbe) de la palette validée (index.css)
const seriesProduction = (exercice) => [
  { cle: 'PrimeTtc', libelle: `Production ${exercice}`, classe: 'n', forme: 'barre' },
  { cle: 'PrimeTtcPrecedent', libelle: `Production ${exercice - 1}`, classe: 'n1', forme: 'barre' },
  { cle: 'Encaisse', libelle: `Encaissements ${exercice}`, classe: 'enc', forme: 'ligne' },
];

export const GraphiqueMensuel = ({ mois = [], exercice, series: seriesDonnees, titre }) => {
  const conteneur = useRef(null);
  const [largeur, setLargeur] = useState(720);
  const [actif, setActif] = useState(null);
  const [tableau, setTableau] = useState(false);

  useEffect(() => {
    const el = conteneur.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const obs = new ResizeObserver(([entree]) => setLargeur(Math.max(320, Math.round(entree.contentRect.width))));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const series = seriesDonnees || seriesProduction(exercice);
  const [barreN, barreN1] = series.filter((s) => s.forme === 'barre');
  const courbe = series.find((s) => s.forme === 'ligne');
  const cles = series.map((s) => s.cle).join(',');

  const { pas, max } = useMemo(() => {
    const valeurs = mois.flatMap((m) => cles.split(',').map((cle) => m[cle])).filter((v) => v !== null && v !== undefined);
    const p = pasRond(Math.max(0, ...valeurs));
    return { pas: p, max: Math.max(p, Math.ceil(Math.max(0, ...valeurs) / p) * p) };
  }, [mois, cles]);

  const interieurL = largeur - MARGE.gauche - MARGE.droite;
  const interieurH = HAUTEUR - MARGE.haut - MARGE.bas;
  const bande = interieurL / 12;
  const epaisseur = Math.max(4, Math.min(24, (bande - 12) / 2 - 1));
  const y = (v) => MARGE.haut + interieurH - (Math.max(0, v || 0) / max) * interieurH;
  const centre = (i) => MARGE.gauche + bande * i + bande / 2;
  const graduations = Array.from({ length: Math.round(max / pas) + 1 }, (_, i) => i * pas);

  const points = courbe
    ? mois.map((m, i) => (m[courbe.cle] === null || m[courbe.cle] === undefined ? null : [centre(i), y(m[courbe.cle])]))
    : [];
  const trace = points.reduce((d, p, i) => {
    if (!p) return d;
    return `${d}${d && points[i - 1] ? 'L' : 'M'}${p[0]},${p[1]}`;
  }, '');

  const description = (m) => series
    .map((s) => `${s.libelle} : ${m[s.cle] === null || m[s.cle] === undefined ? 'mois à venir' : francs(m[s.cle])}`)
    .join(', ');
  const moisActif = actif === null ? null : mois[actif];

  return (
    <div className="graphique-mensuel">
      <div className="graphique-entete">
        <ul className="graphique-legende" aria-label="Légende">
          {series.map((s) => (
            <li key={s.cle}>
              <span className={`cle cle-${s.forme} ${s.classe}`} aria-hidden="true" />
              {s.libelle}
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-secondary cockpit-voir" onClick={() => setTableau((t) => !t)} aria-pressed={tableau}>
          <Table2 size={14} />
          {tableau ? 'Masquer les chiffres' : 'Voir les chiffres'}
        </button>
      </div>

      <div ref={conteneur} className="graphique-zone" onMouseLeave={() => setActif(null)}>
        <svg width={largeur} height={HAUTEUR} role="img" aria-label={`${titre || 'Production et encaissements par mois'}, exercice ${exercice}`}>
          {graduations.map((g) => (
            <g key={g}>
              <line x1={MARGE.gauche} x2={largeur - MARGE.droite} y1={y(g)} y2={y(g)} className={g === 0 ? 'axe' : 'grille'} />
              <text x={MARGE.gauche - 8} y={y(g)} dy="0.32em" textAnchor="end" className="graduation">{g === 0 ? '0' : compact.format(g)}</text>
            </g>
          ))}
          {mois.map((m, i) => {
            const x0 = centre(i) - epaisseur - 1;
            return (
              <g key={m.Mois}>
                {actif === i && <rect x={MARGE.gauche + bande * i} y={MARGE.haut} width={bande} height={interieurH} className="survol" />}
                {barreN && <path d={colonne(x0, y(m[barreN.cle]), epaisseur, y(0) - y(m[barreN.cle]))} className={`barre ${barreN.classe}`} />}
                {barreN1 && <path d={colonne(x0 + epaisseur + 2, y(m[barreN1.cle]), epaisseur, y(0) - y(m[barreN1.cle]))} className={`barre ${barreN1.classe}`} />}
                <text x={centre(i)} y={HAUTEUR - 8} textAnchor="middle" className="graduation">{MOIS[i]}</text>
              </g>
            );
          })}
          {trace && <path d={trace} className={`ligne ${courbe.classe}`} />}
          {points.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={4} className={`point ${courbe.classe}`} />)}
          {/* Zones de survol : la bande entière du mois, plus large que les marques */}
          {mois.map((m, i) => (
            <rect
              key={`zone-${m.Mois}`}
              x={MARGE.gauche + bande * i}
              y={MARGE.haut}
              width={bande}
              height={interieurH + MARGE.bas}
              className="zone"
              tabIndex={0}
              aria-label={`${MOIS_LONG[i]} : ${description(m)}`}
              onMouseEnter={() => setActif(i)}
              onFocus={() => setActif(i)}
              onBlur={() => setActif(null)}
            />
          ))}
        </svg>

        {moisActif && (
          <div
            className="graphique-bulle"
            role="presentation"
            style={{ left: Math.min(Math.max(centre(actif), 140), largeur - 140), top: MARGE.haut }}
          >
            <div className="titre">{MOIS_LONG[actif]}</div>
            {series.map((s) => (
              <div key={s.cle} className="ligne-bulle">
                <span className={`cle cle-ligne ${s.classe}`} aria-hidden="true" />
                <strong>{moisActif[s.cle] === null || moisActif[s.cle] === undefined ? 'à venir' : francs(moisActif[s.cle])}</strong>
                <span>{s.libelle}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {tableau && (
        <div className="table-wrapper" style={{ marginTop: '0.75rem' }}>
          <table className="data-table graphique-tableau">
            <thead>
              <tr>
                <th>Mois</th>
                {series.map((s) => <th key={s.cle} style={{ textAlign: 'right' }}>{s.libelle}</th>)}
              </tr>
            </thead>
            <tbody>
              {mois.map((m, i) => (
                <tr key={m.Mois}>
                  <td style={{ textTransform: 'capitalize' }}>{MOIS_LONG[i]}</td>
                  {series.map((s) => (
                    <td key={s.cle} className="montant">{m[s.cle] === null || m[s.cle] === undefined ? '-' : francs(m[s.cle])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default GraphiqueMensuel;
