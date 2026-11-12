import { useLocation } from 'react-router-dom';
import { PREFIXE_SAISIE_REPRISE, estSaisieReprise } from '../../../utils/navigationDevis';

// Affaire antérieure saisie dans les écrans de devis de la vue Production, sans quitter Affaires antérieures
// (/user/reprises/saisie/<module>) : mêmes écrans, mêmes tables et mêmes barèmes ; le devis enregistré se finalise
// ensuite en affaire antérieure (production/reprise.py, reprendre_devis)

export const useModeReprise = () => estSaisieReprise(useLocation().pathname);

// Écran de devis d'un module (Administration > Produits) en mode reprise ; Transport : la cotation hors GUCE
export const lienDevisReprise = (module, idDevis) => {
  const ecran = String(module || '').startsWith('transport') ? 'transport' : module;
  return `${PREFIXE_SAISIE_REPRISE}/${ecran}${idDevis ? `?edit=${idDevis}` : ''}`;
};

