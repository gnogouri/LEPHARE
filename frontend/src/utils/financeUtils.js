import { exportBordereauExcel, exportBordereauPdf, exportToExcel, exportToPdf } from './exportUtils';
import { messageErreurLisible } from './messageUtilisateur';

// Outils communs aux écrans financiers : état des encaissements, reversements aux compagnies,
// réclamation et encaissement des commissions (routes /api/finance/…).

export const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
export const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
export const aujourdhui = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// Premier et dernier jour du mois d'une date AAAA-MM-JJ
export const bornesMois = (iso = aujourdhui()) => {
  const [a, m] = iso.split('-').map(Number);
  const dernier = new Date(a, m, 0).getDate();
  const pad = (n) => String(n).padStart(2, '0');
  return [`${a}-${pad(m)}-01`, `${a}-${pad(m)}-${pad(dernier)}`];
};

// Recherche libre des écrans financiers : chaque mot saisi doit se retrouver dans la ligne (client, quittance, police,
// chèque, date jj/mm/aaaa, montant avec ou sans espaces…), sans tenir compte des accents ni des majuscules
export const normaliserTexte = (texte) => String(texte ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const correspondRecherche = (recherche, champs) => {
  const termes = normaliserTexte(recherche).split(/\s+/).filter(Boolean);
  if (!termes.length) return true;
  const texte = normaliserTexte(champs.flatMap((c) => (typeof c === 'number' ? [c, fcfa(c)] : [c])).join(' | '));
  return termes.every((t) => texte.includes(t));
};
// Tri du plus récent au plus ancien (dates AAAA-MM-JJ, puis identifiant)
export const recentsDabord = (date, id) => (a, b) => String(date(b) || '').localeCompare(String(date(a) || '')) || (id(b) || 0) - (id(a) || 0);

export const messageErreurApi = (err) => {
  const data = err?.response?.data;
  if (!data) return messageErreurLisible(err?.message || 'Le serveur ne répond pas.', err?.response?.status);
  if (typeof data === 'string') return messageErreurLisible(data.slice(0, 200), err?.response?.status);
  const direct = data.error || data.detail || data.message;
  if (direct) return messageErreurLisible(typeof direct === 'string' ? direct : JSON.stringify(direct), err?.response?.status);
  return messageErreurLisible(Object.entries(data).map(([k, v]) => `${k} : ${Array.isArray(v) ? v.join(' ') : v}`).join(' ; '), err?.response?.status);
};

// Mention réglementaire des bordereaux de reversement
export const MENTION_CIMA_REVERSEMENT = '<strong>Code CIMA :</strong> le courtier reverse à la compagnie la prime encaissée entière ; '
  + 'sa commission (colonne « Comm. Interm. ») n\'est pas déduite des primes reversées et fait l\'objet d\'une réclamation distincte.';

const totalVide = () => ({ primeNette: 0, accessoire: 0, taxe: 0, primeTtc: 0, commission: 0 });
const ajouter = (total, l) => {
  total.primeNette += Number(l.prime_nette) || 0;
  total.accessoire += Number(l.accessoire) || 0;
  total.taxe += Number(l.taxe) || 0;
  total.primeTtc += Number(l.prime_ttc) || 0;
  total.commission += Number(l.commission_intermediaire) || 0;
};

/**
 * Lignes de l'API (Compagnie, Client, Branche, NumeroPolice…) groupées Compagnie > Client > Branche
 * pour exportBordereauPdf / exportBordereauExcel (modèle de bordereau d'OREOLE).
 */
export const groupesBordereau = (lignes) => {
  const compagnies = new Map();
  const grandTotal = totalVide();
  lignes.forEach((ligne) => {
    const l = {
      numero_police: ligne.NumeroPolice,
      numero_quittance: ligne.NumeroQuittance,
      numero_avenant: ligne.NumeroAvenant,
      date_emission: ligne.DateEmission,
      date_effet: ligne.DateEffet,
      date_expiration: ligne.DateExpiration,
      prime_nette: ligne.PrimeNette,
      accessoire: ligne.Accessoire,
      taxe: ligne.Taxe,
      prime_ttc: ligne.PrimeTtc,
      commission_intermediaire: ligne.Commission,
    };
    const cle = (v, defaut) => v || defaut;
    if (!compagnies.has(cle(ligne.Compagnie, '-'))) compagnies.set(cle(ligne.Compagnie, '-'), { label: cle(ligne.Compagnie, '-'), total: totalVide(), clients: new Map() });
    const compagnie = compagnies.get(cle(ligne.Compagnie, '-'));
    if (!compagnie.clients.has(cle(ligne.Client, '-'))) compagnie.clients.set(cle(ligne.Client, '-'), { label: cle(ligne.Client, '-'), total: totalVide(), branches: new Map() });
    const client = compagnie.clients.get(cle(ligne.Client, '-'));
    if (!client.branches.has(cle(ligne.Branche, '-'))) client.branches.set(cle(ligne.Branche, '-'), { label: cle(ligne.Branche, '-'), total: totalVide(), lines: [] });
    const branche = client.branches.get(cle(ligne.Branche, '-'));
    branche.lines.push(l);
    [branche.total, client.total, compagnie.total, grandTotal].forEach((t) => ajouter(t, l));
  });
  return {
    grandTotal,
    compagnies: Array.from(compagnies.values()).map((c) => ({
      label: c.label,
      total: c.total,
      clients: Array.from(c.clients.values()).map((cl) => ({
        label: cl.label,
        total: cl.total,
        branches: Array.from(cl.branches.values()),
      })),
    })),
  };
};

// Bordereau de reversement d'une compagnie (modèle « Finance Encaissement » d'OREOLE)
export const exporterBordereauReversement = (reversement, format = 'pdf') => {
  const charge = {
    filename: `Bordereau_Reversement_${reversement.Numero || reversement.IdReversement}`,
    title: `BORDEREAU DE REVERSEMENT N° ${reversement.Numero} - ${String(reversement.Compagnie || '').toUpperCase()}`,
    subtitle: `Primes encaissées reversées le ${dateFr(reversement.DateReversement)}`,
    metadata: {
      'Compagnie': reversement.Compagnie,
      'N° de reversement': reversement.Numero,
      'Date': dateFr(reversement.DateReversement),
      'Quittances': String(reversement.NombreQuittances ?? reversement.Lignes?.length ?? 0),
      'Montant reversé': `${fcfa(reversement.Montant)} F`,
      'Commission due au cabinet (non déduite)': `${fcfa(reversement.Commissions)} F`,
      'Paiement': reversement.Valide ? `${reversement.Mode || ''} ${reversement.Reference || ''} du ${dateFr(reversement.DateValidation)}`.trim() : 'À payer à la compagnie',
    },
    groups: groupesBordereau(reversement.Lignes || []),
    mention: MENTION_CIMA_REVERSEMENT,
  };
  if (format === 'excel') exportBordereauExcel(charge);
  else exportBordereauPdf(charge);
};

// État récapitulatif des encaissements (montant, mode, référence, statut)
export const exporterEtatEncaissements = (etat, filtres, format = 'pdf') => {
  const lignes = etat.Lignes || [];
  const charge = {
    filename: `Etat_Encaissements_${etat.Du}_${etat.Au}`,
    title: 'ÉTAT RÉCAPITULATIF DES ENCAISSEMENTS',
    subtitle: `Du ${dateFr(etat.Du)} au ${dateFr(etat.Au)}${filtres.libelleCompagnie ? ` - ${filtres.libelleCompagnie}` : ''}`,
    metadata: {
      'Lignes encaissées': String(etat.Total.Nombre),
      'Montant encaissé': `${fcfa(etat.Total.Montant)} F`,
      'Déjà reversé': `${fcfa(etat.Total.Reverse)} F`,
      'Reste à reverser': `${fcfa(etat.Total.ResteAReverser)} F`,
      ...Object.fromEntries((etat.ParMode || []).map((m) => [`Mode ${m.Libelle}`, `${m.Nombre} - ${fcfa(m.Montant)} F`])),
    },
    headers: ['Date', 'N° pièce', 'Compagnie', 'Client', 'Quittance', 'Mode', 'Référence', 'Montant', 'Statut'],
    rows: lignes.map((l) => [dateFr(l.DateEncaissement), l.NumeroPiece, l.Compagnie, l.Client, l.NumeroQuittance, l.Mode,
      [l.Reference, l.Banque].filter(Boolean).join(' - '), fcfa(l.Montant), l.LibelleStatut]),
    totals: ['TOTAL (hors annulés et impayés)', '', '', '', '', '', '', fcfa(etat.Total.Montant), ''],
  };
  if (format === 'excel') exportToExcel(charge);
  else exportToPdf(charge);
};
