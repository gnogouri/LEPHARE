// Branche Vie : outils partagés par l'écran de devis (NewAfaQuotePage) et l'état des cotisations Retraite complémentaire

export const COULEUR_VIE = '#7c3aed';
export const SAISIE_COTISATION = 'COTISATION';
export const PAR_PAGE = 50;

export const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/ /g, ' ');
export const fcfaSigne = (v) => `${Number(v) > 0 ? '+' : Number(v) < 0 ? '-' : ''}${fcfa(Math.abs(Number(v) || 0))}`;
export const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '-');

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 2026-01-01 » ou « 2026-01 » -> « janvier 2026 » */
export const libelleMois = (iso) => {
  if (!iso) return '';
  const [annee, mois] = String(iso).split('-').map(Number);
  return mois ? `${NOMS_MOIS[mois - 1]} ${annee}` : '';
};

/** Dernier jour du mois « 2026-02 » -> « 2026-02-28 » */
export const finDeMois = (mois) => {
  const [annee, m] = String(mois).split('-').map(Number);
  const jour = new Date(Date.UTC(annee, m, 0)).getUTCDate();
  return `${annee}-${String(m).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
};

/** Mois suivant « 2025-10-01 » -> « 2025-11 » */
export const moisSuivant = (iso) => {
  const [annee, mois] = String(iso).split('-').map(Number);
  return mois === 12 ? `${annee + 1}-01` : `${annee}-${String(mois + 1).padStart(2, '0')}`;
};

const norme = (texte) => String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** Clé d'un salarié d'un mois à l'autre : son matricule, sinon son nom complet (comme production/vie_retraite.py) */
export const cleSalarie = (l) => {
  const matricule = norme(l.Matricule).replace(/ /g, '');
  return matricule ? `M:${matricule}` : `N:${norme(l.Nom)} ${norme(l.Prenoms)}`.trim();
};

export const totalSalarie = (l) => (Number(l.CotisationSalarie) || 0) + (Number(l.CotisationEmployeur) || 0);

let compteur = 0;
export const nouvelleCle = (prefixe = 'l') => { compteur += 1; return `${prefixe}${Date.now()}-${compteur}`; };

export const cotisantVide = (base = {}) => ({
  cle: nouvelleCle('c'), Matricule: '', Nom: '', Prenoms: '', CotisationSalarie: '', CotisationEmployeur: '', Observation: '',
  Avertissements: [], ...base,
});

/** Un salarié peut ne pas cotiser un mois (règle du 2026-11-11) : parts vides ou à 0, il reste dans l'état à 0 F */
export const sansCotisation = (l) => !(Number(l.CotisationSalarie) || 0) && !(Number(l.CotisationEmployeur) || 0);

/** Contrôles d'un salarié, les mêmes que le serveur (vie_retraite.controler_ligne) : bloquants avant l'enregistrement */
export const erreursCotisant = (l) => {
  const erreurs = [];
  if (!String(l.Nom || '').trim()) erreurs.push('nom absent');
  const s = l.CotisationSalarie === '' || l.CotisationSalarie === null || l.CotisationSalarie === undefined ? 0 : Number(l.CotisationSalarie);
  const e = l.CotisationEmployeur === '' || l.CotisationEmployeur === null || l.CotisationEmployeur === undefined ? 0 : Number(l.CotisationEmployeur);
  if (Number.isNaN(s) || Number.isNaN(e)) erreurs.push('montant illisible');
  else if (s < 0 || e < 0) erreurs.push('montant négatif');
  return erreurs;
};

/** Écarts avec l'état précédent (comme vie_retraite.comparer) : { parCle: {cle: ancienne ligne}, entrants: Set(cle) jamais vus,
 *  reprises: Set(cle) absents le mois précédent mais déjà dans un état antérieur (precedent.Connus), sansCotisation: Set(cle) à 0 F,
 *  sortants: [...] absents de cet état (sans cotisation ce mois ou partis), modifies: Set(cle), ecart } */
export const comparerEtats = (lignes, precedent) => {
  if (!precedent?.Cotisants?.length) return null;
  const parCle = new Map(precedent.Cotisants.map((l) => [cleSalarie(l), l]));
  const connus = new Set(precedent.Connus || []);
  const presents = new Set();
  const entrants = new Set();
  const reprises = new Set();
  const modifies = new Set();
  const zero = new Set();
  let total = 0;
  lignes.forEach((l) => {
    if (!String(l.Nom || '').trim() && !String(l.Matricule || '').trim()) return;
    const cle = cleSalarie(l);
    presents.add(cle);
    total += totalSalarie(l);
    if (sansCotisation(l)) zero.add(l.cle);
    const avant = parCle.get(cle);
    if (!avant) (connus.has(cle) ? reprises : entrants).add(l.cle);
    else if ((Number(avant.CotisationSalarie) || 0) !== (Number(l.CotisationSalarie) || 0)
      || (Number(avant.CotisationEmployeur) || 0) !== (Number(l.CotisationEmployeur) || 0)) modifies.add(l.cle);
  });
  const sortants = precedent.Cotisants.filter((l) => !presents.has(cleSalarie(l)));
  const totalAvant = precedent.Cotisants.reduce((s, l) => s + totalSalarie(l), 0);
  return { parCle, entrants, reprises, sansCotisation: zero, modifies, sortants, total, totalAvant, ecart: total - totalAvant };
};

/** « 3 nouveaux », « 1 reprise » : nombre et libellé accordé */
export const compte = (n, singulier, pluriel = `${singulier}s`) => `${n} ${n > 1 ? pluriel : singulier}`;

export const telechargerBlob = (blob, nom) => {
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(blob);
  lien.download = nom;
  lien.click();
  setTimeout(() => URL.revokeObjectURL(lien.href), 2000);
};
