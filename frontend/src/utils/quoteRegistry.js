// Registre des devis : devis ni archivés ni confirmés, les expirés signalés à part (onglet « Expirés »).
// Un devis confirmé devient un contrat ; le Portefeuille des Contrats, lui, ne liste que des contrats.
export const isExpiredQuote = (q) => {
  if (!q?.date_expiration) return false;
  const d = new Date(q.date_expiration);
  if (isNaN(d.getTime())) return false;
  return d < new Date(new Date().toISOString().split('T')[0]);
};

// Devis ni archivé ni confirmé, expiré ou non
export const isUnconfirmedQuote = (q) => {
  const s = (q?.statut || '').toLowerCase();
  return !q?.archive && !q?.confirme && !s.includes('confirm') && !s.includes('contrat');
};

// Formulaires qui savent rouvrir un devis enregistré (?edit=<iddevis>) ; le formulaire d'un produit
// est réglé dans Administration > Produits. Transport : la cotation hors GUCE rouvre ses devis (ceux des
// bordereaux GUCE sont confirmés dès l'import).
export const MODULES_EDITION_COMPLETE = ['auto', 'ia', 'voyage', 'mrh', 'sante', 'afa', 'rc', 'mrp', 'tous-dommages', 'transport'];
