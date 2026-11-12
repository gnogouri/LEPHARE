/**
 * Formate un montant en séparant les milliers par des espaces (convention française),
 * ex: 30000000 -> "30 000 000". Utilisé pour tout affichage de montant en lecture seule.
 */
export const formatMoney = (value, { suffix = '' } = {}) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const formatted = Math.round(n).toLocaleString('fr-FR');
  return suffix ? `${formatted} ${suffix}` : formatted;
};
