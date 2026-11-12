import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';

import { formatDate } from '../../utils/dateUtils';
import { moduleDuProduit, moduleOuvert } from '../../utils/parametrage';
import { MODULES_EDITION_COMPLETE } from '../../utils/quoteRegistry';

// Pièces communes des écrans de chiffres : cockpit, tableau de bord, suivi commercial (styles .cockpit-* de index.css)
export const francs = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} F`;
export const nombre = (n) => Number(n || 0).toLocaleString('fr-FR');
export const pluriel = (n, un, plusieurs) => `${nombre(n)} ${Number(n) > 1 ? plusieurs : un}`;
export const pourcent = (n) => (n === null || n === undefined ? '-' : `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);

// Devis : formulaire du produit rouvert s'il sait le faire, sinon registre des devis
export const cheminDevis = (idProduit, idDevis) => {
  const module = moduleDuProduit(Number(idProduit));
  return MODULES_EDITION_COMPLETE.includes(module) && moduleOuvert(module) ? `/user/quotes/${module}?edit=${idDevis}` : '/user/quotes';
};

const mouvementReduit = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// Chiffre qui défile jusqu'à sa valeur (à l'ouverture et à chaque changement) ; valeur exacte pour les lecteurs d'écran ;
// immobile quand le système demande de réduire les animations
export const Anime = ({ valeur, format = nombre, duree = 700, entier = true }) => {
  const cible = Number(valeur) || 0;
  const [affiche, setAffiche] = useState(() => (mouvementReduit() ? cible : 0));
  const depart = useRef(affiche);
  useEffect(() => {
    if (mouvementReduit()) {
      depart.current = cible;
      setAffiche(cible);
      return undefined;
    }
    const de = depart.current;
    const debut = performance.now();
    let image;
    const pas = (instant) => {
      const k = Math.min(1, (instant - debut) / duree);
      const v = de + (cible - de) * (1 - (1 - k) ** 3);
      depart.current = v;
      setAffiche(v);
      if (k < 1) image = requestAnimationFrame(pas);
    };
    image = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(image);
  }, [cible, duree]);
  return (
    <>
      <span aria-hidden="true" className="cockpit-anime">{format(entier ? Math.round(affiche) : affiche)}</span>
      <span className="cockpit-sr">{format(cible)}</span>
    </>
  );
};

// Tuile d'indicateur : ouvre l'écran détaillé quand une destination est donnée ; vedette : indicateur principal (chiffre
// d'affaires du cabinet), plus large et mis en avant. couleur : blue, emerald, amber, purple, rose (teinte du thème).
export const Tuile = ({
  titre, valeur, icone: Icone, couleur = 'blue', lignes = [], vers, aide, vedette = false, evolution = null, children,
}) => {
  const navigate = useNavigate();
  const ouvrir = vers ? () => navigate(vers) : undefined;
  return (
    <div
      className={`metric-card cockpit-tuile ton-${couleur}${vers ? ' cliquable' : ''}${vedette ? ' vedette' : ''}`}
      role={vers ? 'link' : undefined}
      tabIndex={vers ? 0 : undefined}
      onClick={ouvrir}
      onKeyDown={vers ? (e) => { if (e.key === 'Enter') ouvrir(); } : undefined}
      title={aide}
    >
      <div className="cockpit-tuile-entete">
        <span className="cockpit-tuile-icone" aria-hidden="true"><Icone size={vedette ? 20 : 17} /></span>
        <span className="cockpit-tuile-titre">{titre}</span>
        {vers && <ArrowUpRight size={16} className="cockpit-tuile-ouvrir" aria-hidden="true" />}
      </div>
      <div className="metric-value">{valeur}</div>
      {evolution && <div className="cockpit-tuile-evolution">{evolution}</div>}
      {lignes.filter(Boolean).map((ligne, i) => (
        <div key={i} className="cockpit-tuile-ligne">{ligne}</div>
      ))}
      {children}
    </div>
  );
};

// Ligne libellé / montant d'une tuile ; serie : pastille de la série (1, 2, 3) quand la ligne en reprend une
export const Detail = ({ libelle, valeur, serie }) => (
  <div className="cockpit-detail">
    {serie && <span className={`cockpit-cle serie-${serie}`} aria-hidden="true" />}
    <span className="libelle">{libelle}</span>
    <strong>{valeur}</strong>
  </div>
);

// Évolution par rapport à la même date de l'an dernier : pastille fléchée + libellé, jamais la couleur seule
export const Evolution = ({ actuel, precedent, au }) => {
  if (!precedent) return null;
  const taux = ((actuel - precedent) * 100) / precedent;
  const hausse = taux >= 0;
  const Fleche = hausse ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`cockpit-evolution ${hausse ? 'hausse' : 'baisse'}`}>
      <span className="cockpit-pastille">
        <Fleche size={13} aria-hidden="true" />
        {hausse ? '+' : '−'}{Math.abs(taux).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %
      </span>
      <span>{hausse ? 'en hausse' : 'en baisse'} par rapport au {formatDate(au)}, {francs(precedent)}</span>
    </span>
  );
};

// Jauge d'un taux (0 à 100 %)
export const Jauge = ({ taux, libelle }) => (
  <div className="cockpit-jauge" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={taux || 0} aria-label={libelle}>
    <span style={{ width: `${Math.min(100, Math.max(0, taux || 0))}%` }} />
  </div>
);

// Répartition d'un total en parts (barre empilée, une couleur par série dans un ordre fixe : serie-1, serie-2, serie-3) ;
// légende avec montant et part de chaque série, l'identité n'est jamais portée par la seule couleur
export const Repartition = ({ parts, libelle, format = francs }) => {
  const visibles = parts.filter((p) => p.valeur > 0);
  const total = visibles.reduce((s, p) => s + p.valeur, 0);
  if (!total) return null;
  const part = (v) => ((v * 100) / total).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return (
    <div className="cockpit-repartition">
      <div
        className="cockpit-repartition-barre"
        role="img"
        aria-label={`${libelle} : ${visibles.map((p) => `${p.libelle} ${format(p.valeur)}, ${part(p.valeur)} %`).join(' ; ')}`}
      >
        {visibles.map((p) => (
          <span key={p.serie} className={`serie-${p.serie}`} style={{ flexGrow: p.valeur }} title={`${p.libelle} : ${format(p.valeur)}, ${part(p.valeur)} %`} />
        ))}
      </div>
      <ul className="cockpit-repartition-legende">
        {visibles.map((p) => (
          <li key={p.serie}>
            <span className={`cockpit-cle serie-${p.serie}`} aria-hidden="true" />
            <span className="libelle">{p.libelle}</span>
            <strong>{format(p.valeur)}</strong>
            <em>{part(p.valeur)} %</em>
          </li>
        ))}
      </ul>
    </div>
  );
};

// Petites colonnes d'une série mensuelle (une teinte) : lecture du mois survolé, le mois en cours par défaut ;
// null = mois à venir
export const MiniBarres = ({ valeurs = [], libelles = [], titre, actuel = valeurs.length - 1, format = francs }) => {
  const [survol, setSurvol] = useState(null);
  const max = Math.max(0, ...valeurs.filter((v) => v !== null && v !== undefined));
  const i = survol ?? actuel;
  const lu = valeurs[i];
  return (
    <div className="cockpit-mini">
      <div className="cockpit-mini-lecture" aria-hidden="true">
        <span>{titre} · {libelles[i]}</span>
        <strong>{lu === null || lu === undefined ? 'à venir' : format(lu)}</strong>
      </div>
      <div
        className="cockpit-mini-barres"
        role="img"
        aria-label={`${titre} : ${valeurs.map((v, k) => `${libelles[k]} ${v === null || v === undefined ? 'à venir' : format(v)}`).join(', ')}`}
        onMouseLeave={() => setSurvol(null)}
      >
        {valeurs.map((v, k) => (
          <span
            key={libelles[k] || k}
            className={`colonne${k === i ? ' active' : ''}${v === null || v === undefined ? ' a-venir' : ''}`}
            onMouseEnter={() => setSurvol(k)}
          >
            <span className="barre" style={{ height: max && v > 0 ? `${Math.max(3, (v * 100) / max)}%` : 0, animationDelay: `${k * 30}ms` }} />
          </span>
        ))}
      </div>
    </div>
  );
};

// Choix d'une valeur parmi quelques-unes (exercices) : boutons groupés, flèches du clavier
export const Segments = ({ options, valeur, onChange, libelle }) => {
  const groupe = useRef(null);
  const clavier = (e) => {
    const i = options.indexOf(valeur);
    const suivant = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1 }[e.key];
    if (suivant === undefined || suivant < 0 || suivant >= options.length) return;
    e.preventDefault();
    onChange(options[suivant]);
    // Le focus suit le choix
    requestAnimationFrame(() => groupe.current?.querySelector('[aria-checked="true"]')?.focus());
  };
  return (
    <div ref={groupe} className="cockpit-segments" role="radiogroup" aria-label={libelle} onKeyDown={clavier}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === valeur}
          tabIndex={o === valeur ? 0 : -1}
          className={o === valeur ? 'actif' : ''}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
};

export const Section = ({ titre, sousTitre, action, children, className = '', icone: Icone }) => (
  <section className={`glass-panel cockpit-section ${className}`.trim()}>
    <div className="cockpit-section-entete">
      <div className="cockpit-section-titre">
        {Icone && <span className="cockpit-section-icone" aria-hidden="true"><Icone size={17} /></span>}
        <div>
          <h2 className="title-md">{titre}</h2>
          {sousTitre && <p>{sousTitre}</p>}
        </div>
      </div>
      {action}
    </div>
    {children}
  </section>
);

export const BoutonVoir = ({ libelle, vers }) => {
  const navigate = useNavigate();
  return (
    <button type="button" className="btn btn-secondary cockpit-voir" onClick={() => navigate(vers)}>
      {libelle}
      <ArrowRight size={14} />
    </button>
  );
};
