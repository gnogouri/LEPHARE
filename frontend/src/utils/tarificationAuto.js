// Totaux d'un devis automobile, alignés sur URANUS (fn_garantie_offre + sp_finalisation_devis).
//
// Le moteur CIMA (fn_garantie_offre) applique déjà réduction commerciale, BNS, prorata de durée
// et taxe par garantie : ces montants ne doivent surtout pas être réappliqués ici.
//   PA  = Σ PA des garanties acquises + FGA annuel (2 % de la PA de la RC)
//   PN  = Σ PN des garanties acquises hors CEDEAO (FGA exclu)
//   FGA = 2 % de la PN de la RC
//   Taxe = Σ taxes des garanties acquises + taxe sur accessoire
//   TTC = PN + CEDEAO + FGA + Taxe + Accessoire

// Sous-garanties identifiées par leur id (stdsousgarantie), jamais par un code figé :
// les lignes venant du moteur CIMA ont des codes GAR_<id>, pas 'RC'.
export const ID_SOUS_GARANTIE_RC = 1;
export const ID_SOUS_GARANTIE_CEDEAO = 3;
// Garantie retenue par fn_retenir_garantie_nsia_auto_plus quand l'option NSIA Auto Plus est
// choisie : l'option elle-même n'est pas stockée, seule cette garantie la trahit.
export const ID_SOUS_GARANTIE_NSIA_AUTO_PLUS = 175;

export const estGarantieRc = (g) => Number(g.id_garantie) === ID_SOUS_GARANTIE_RC || g.code === 'RC';
export const estGarantieCedeao = (g) => Number(g.id_garantie) === ID_SOUS_GARANTIE_CEDEAO;

// La prime nette enregistrée (stddevis.primenette, comprenant le FGA) contient-elle la CEDEAO ?
// Oui pour un devis calculé (TTC = prime nette + accessoire + taxe) ; non pour un devis à primes
// imposées, que sp_maj_manuelle_primes enregistre sans elle. On retient le modèle qui retombe sur
// la TTC enregistrée (NSIA : TTC éventuellement arrondie au multiple de 5 supérieur), sinon celui
// du devis (imposé ou non).
export const cedeaoDansPrimeNette = ({ primenette, accessoire, taxe, cedeao, primettc, primeImposee = false, arrondiNsia = false }) => {
  const entier = (x) => Math.round(Number(x) || 0);
  const ttc = entier(primettc);
  const retombe = (somme) => ttc === somme || (arrondiNsia && ttc === Math.ceil(somme / 5) * 5);
  const sansCedeao = entier(primenette) + entier(accessoire) + entier(taxe);
  if (retombe(sansCedeao)) return true;
  if (entier(cedeao) > 0 && retombe(sansCedeao + entier(cedeao))) return false;
  return !primeImposee;
};

// Taxe d'une garantie : celle calculée par le moteur (fn_calcul_montant_taxe). Si la prime
// nette a été imposée à la main, on applique le même taux à la nouvelle prime.
export const taxeGarantie = (g) => {
  const taxe = Number(g.taxe) || 0;
  const pn = Number(g.primeNette) || 0;
  const pnOrigine = Number(g.primeNetteOrigine);
  if (pnOrigine > 0 && pn !== pnOrigine) return Math.round((pn * taxe) / pnOrigine);
  return taxe;
};

// Base de l'accessoire (fn_get_accessoire) : prime nette des garanties acquises, CEDEAO comprise,
// plus le FGA — comme prime_nette_totale du moteur et stddevis.primenette à l'enregistrement
export const baseAccessoireAuto = (garanties) => {
  const totaux = calculerTotauxDevisAuto({ garanties });
  return totaux.pn + totaux.cedeao + totaux.fga;
};

// Ligne cumul (IdGarantie = 0) du moteur : l'accessoire (fn_get_accessoire, fonction de la
// tranche de prime nette) et la taxe sur accessoire, qui n'est pas portée par les garanties.
export const extraireLigneCumul = (lignesMoteur) => {
  const cumul = (lignesMoteur || []).find((item) => item.IdGarantie === 0);
  if (!cumul) return null;
  const taxeLignes = lignesMoteur
    .filter((item) => item.IdGarantie !== 0 && item.LibelleSousGarantie)
    .reduce((s, item) => s + (Number(item.Taxe) || 0), 0);
  return {
    accessoire: Number(cumul.MontantAccessoire || 0),
    taxeAccessoire: Math.max(0, Number(cumul.Taxe || 0) - taxeLignes),
  };
};

export const calculerTotauxDevisAuto = ({ garanties, ligneCumul = null, vehiculesCount = 1 }) => {
  let pa = 0;
  let pn = 0;
  let cedeao = 0;
  let rcPrimeAnnuelle = 0;
  let rcPrimeNette = 0;
  let taxeGaranties = 0;

  (garanties || []).forEach((g) => {
    if (!g.acquise) return;
    const primeAnnuelle = Number(g.primeAnnuelle) || 0;
    const primeNette = Number(g.primeNette) || 0;
    pa += primeAnnuelle;
    if (estGarantieCedeao(g)) {
      cedeao += primeNette;
      return;
    }
    pn += primeNette;
    taxeGaranties += taxeGarantie(g);
    if (estGarantieRc(g)) {
      rcPrimeAnnuelle = primeAnnuelle;
      rcPrimeNette = primeNette;
    }
  });

  const totaux = {
    pa: (pa + Math.round((rcPrimeAnnuelle * 2) / 100)) * vehiculesCount,
    pn: pn * vehiculesCount,
    fga: Math.round((rcPrimeNette * 2) / 100) * vehiculesCount,
    accessoire: (ligneCumul?.accessoire || 0) * vehiculesCount,
    taxe: (taxeGaranties + (ligneCumul?.taxeAccessoire || 0)) * vehiculesCount,
    cedeao: cedeao * vehiculesCount,
  };
  totaux.ttc = totaux.pn + totaux.cedeao + totaux.fga + totaux.taxe + totaux.accessoire;
  return totaux;
};
