import { useCallback } from 'react';
import { useLocation, useNavigate as useNavigateRouteur } from 'react-router-dom';

// Écrans de devis de la vue Production ouverts depuis Affaires antérieures (/user/reprises/saisie/<module>) : mêmes
// écrans, mêmes tables et barèmes, sans quitter la vue. Leurs renvois vers la gestion des devis (/user/quotes…)
// restent dans Affaires antérieures.
export const PREFIXE_SAISIE_REPRISE = '/user/reprises/saisie';

export const estSaisieReprise = (pathname) => pathname === PREFIXE_SAISIE_REPRISE || pathname.startsWith(`${PREFIXE_SAISIE_REPRISE}/`);

// '/user/quotes' (registre) et l'accueil Transport → Affaires antérieures ; écran d'un module → même écran en reprise
export const versReprise = (cible) => {
  const [chemin, ...suite] = String(cible).split('?');
  const requete = suite.length ? `?${suite.join('?')}` : '';
  if (chemin === '/user/quotes' || chemin === '/user/quotes/' || chemin === '/user/quotes/transport') return `/user/reprises${requete}`;
  if (chemin === '/user/quotes/transport/hors-guce') return `${PREFIXE_SAISIE_REPRISE}/transport${requete}`;
  const module = chemin.match(/^\/user\/quotes\/(auto|mrh|sante|ia|rc|mrp|tous-dommages|voyage|afa)\/?$/);
  return module ? `${PREFIXE_SAISIE_REPRISE}/${module[1]}${requete}` : cible;
};

// useNavigate des écrans de devis : renvois traduits en mode reprise, inchangés sinon
export const useNavigate = () => {
  const naviguer = useNavigateRouteur();
  const { pathname } = useLocation();
  const reprise = estSaisieReprise(pathname);
  return useCallback(
    (cible, options) => naviguer(reprise && typeof cible === 'string' ? versReprise(cible) : cible, options),
    [naviguer, reprise],
  );
};
