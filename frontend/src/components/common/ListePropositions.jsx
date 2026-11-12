import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

// Champ saisi à la main accompagné d'une liste déroulante de valeurs proposées (RC et MRH sans barème : valeurs
// habituelles des devis enregistrés, montants calculés aux taux légaux). Rien n'est rempli d'office : un choix
// remplit le champ, la saisie reste libre. La liste est rendue dans le corps de la page, en position fixe : ni
// coupée par un tableau qui défile, ni décalée par une carte à effet de verre (backdrop-filter).

// propositions : [{ valeur, libelle, detail }] ; enfant : le champ de saisie
export const ChampPropose = ({ propositions = [], onChoisir, children, titre = 'Valeurs proposées', inactif = false }) => {
  const [ouvert, setOuvert] = useState(false);
  const [position, setPosition] = useState(null);
  const zone = useRef(null);
  const liste = useRef(null);
  const valeurs = propositions.filter((p) => p && p.valeur !== '' && p.valeur != null && Number(p.valeur) !== 0);

  // Sous le champ, ou au-dessus s'il n'y a pas la place ; recalculée quand la page défile ou change de taille
  useEffect(() => {
    if (!ouvert) return undefined;
    const placer = () => {
      const r = zone.current?.getBoundingClientRect();
      if (!r) return;
      const hauteur = Math.min(260, (liste.current?.scrollHeight || valeurs.length * 44) + 8);
      const enHaut = r.bottom + hauteur + 8 > window.innerHeight && r.top > hauteur + 8;
      setPosition({
        left: r.left,
        minWidth: Math.max(r.width, 230),
        ...(enHaut ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    const fermer = (e) => {
      if (!zone.current?.contains(e.target) && !liste.current?.contains(e.target)) setOuvert(false);
    };
    const touche = (e) => { if (e.key === 'Escape') setOuvert(false); };
    placer();
    document.addEventListener('mousedown', fermer);
    document.addEventListener('keydown', touche);
    window.addEventListener('scroll', placer, true);
    window.addEventListener('resize', placer);
    return () => {
      document.removeEventListener('mousedown', fermer);
      document.removeEventListener('keydown', touche);
      window.removeEventListener('scroll', placer, true);
      window.removeEventListener('resize', placer);
    };
  }, [ouvert, valeurs.length]);

  const basculer = () => {
    if (ouvert) { setOuvert(false); return; }
    setPosition(null);
    setOuvert(true);
  };

  return (
    <div ref={zone} className="champ-propose">
      <div className="champ-propose-saisie">{children}</div>
      {valeurs.length > 0 && !inactif && (
        <button type="button" className="btn btn-secondary champ-propose-bouton" onClick={basculer}
          aria-haspopup="listbox" aria-expanded={Boolean(ouvert)} title={titre} aria-label={titre}>
          <ChevronDown size={15} style={{ transform: ouvert ? 'rotate(180deg)' : undefined }} />
        </button>
      )}
      {ouvert && createPortal(
        <ul ref={liste} role="listbox" aria-label={titre} className="champ-propose-liste"
          style={position || { visibility: 'hidden', top: 0, left: 0 }}>
          {valeurs.map((p) => (
            <li key={`${p.valeur}-${p.detail || ''}`} role="option" aria-selected={false}>
              <button type="button" onClick={() => { onChoisir(p.valeur); setOuvert(false); }}>
                <span className="valeur">{p.libelle}</span>
                {p.detail && <span className="detail">{p.detail}</span>}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
};

const montantFr = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/ /g, ' ');
const tauxFr = (v) => String(Math.round(Number(v) * 100) / 100).replace('.', ',');

/** Valeurs habituelles renvoyées par /api/valeursusuelles/ ([{ Valeur, Nombre }]) -> propositions de la liste. */
export const propositionsUsuelles = (liste, { taux = false } = {}) => (liste || []).map((x) => ({
  valeur: Number(x.Valeur),
  libelle: taux ? `${tauxFr(x.Valeur)} %` : `${montantFr(x.Valeur)} F`,
  detail: `${x.Nombre} devis`,
}));

/** Proposition calculée : montant et explication (« 14,5 % de (prime nette + accessoire) »). */
export const propositionMontant = (valeur, detail) => ({ valeur: Math.round(Number(valeur) || 0), libelle: `${montantFr(valeur)} F`, detail });
export const propositionTaux = (valeur, detail) => ({ valeur: Number(valeur), libelle: `${tauxFr(valeur)} %`, detail });

/** Propositions sans doublon de valeur (la première gardée). */
export const sansDoublon = (...listes) => listes.flat().filter((p, i, toutes) => p && toutes.findIndex((q) => q && Number(q.valeur) === Number(p.valeur)) === i);
