/**
 * Droits effectifs de l'utilisateur connecté (GET /api/securite/moi/), lus de façon synchrone par
 * les écrans, les menus et utils/rbac.js. Le serveur reste seul juge (garde centrale) : masquer un
 * bouton ne remplace jamais le contrôle de l'API, cela évite seulement de proposer une action refusée.
 */
let droitsCourants = new Set();
const abonnes = new Set();

export const definirDroits = (liste) => {
  droitsCourants = new Set(Array.isArray(liste) ? liste : []);
  abonnes.forEach((f) => f());
};

/** Vrai si l'utilisateur a le droit (ou au moins un des droits d'une liste) ; aucune exigence : vrai. */
export const aLeDroit = (exigence) => {
  if (!exigence || (Array.isArray(exigence) && exigence.length === 0)) return true;
  const liste = Array.isArray(exigence) ? exigence : [exigence];
  return liste.some((code) => droitsCourants.has(code));
};

export const surDroits = (rappel) => {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
};

// Droit exigé par chaque écran de l'espace Production (préfixe d'adresse le plus long retenu) ;
// les écrans de l'administration portent leur droit dans adminMenu.js
const DROITS_ECRANS_PRODUCTION = [
  ['/user/clients', 'clients.view'],
  ['/user/crm/360', 'clients.view'],
  ['/user/crm', 'crm.view'],
  ['/user/quotes', 'devis.view'],
  ['/user/quotes/', ['devis.create', 'devis.update']],
  // Transport : accueil des trois parcours, cotation hors GUCE, polices d'abonnement, import GUCE
  ['/user/quotes/transport', ['devis.create', 'devis.update', 'contrats.view', 'imports.guce']],
  ['/user/quotes/transport/hors-guce', ['devis.create', 'devis.update']],
  ['/user/quotes/transport/abonnements', 'contrats.view'],
  ['/user/quotes/transport/guce', 'imports.guce'],
  ['/user/contracts', 'contrats.view'],
  ['/user/endorsements', 'contrats.view'],
  ['/user/reprises', 'contrats.view'],
  // Affaire antérieure saisie dans les écrans de devis (enregistrer un devis demande aussi de pouvoir créer un devis)
  ['/user/reprises/saisie/', 'contrats.reprise'],
  ['/user/asaci', 'contrats.view'],
  ['/user/cash', 'encaissements.view'],
  ['/user/cheques', 'encaissements.view'],
  ['/user/claims', 'sinistres.view'],
  ['/user/sante/consommations', 'consommations.view'],
  ['/user/rafas', 'rafas.view'],
  ['/user/documents', 'documents.view'],
  ['/user/archives', 'devis.view'],
];

export const droitDeLaRoute = (pathname, menuAdmin = []) => {
  const regles = [
    ...DROITS_ECRANS_PRODUCTION,
    ...menuAdmin.flatMap((g) => g.items.filter((i) => i.to.startsWith('/admin')).map((i) => [i.to, i.droit])),
  ];
  let retenue = null;
  regles.forEach(([prefixe, droit]) => {
    const correspond = prefixe.endsWith('/') ? pathname.startsWith(prefixe) : (pathname === prefixe || pathname.startsWith(`${prefixe}/`));
    if (correspond && (!retenue || prefixe.length > retenue[0].length)) retenue = [prefixe, droit];
  });
  return retenue ? retenue[1] : null;
};
