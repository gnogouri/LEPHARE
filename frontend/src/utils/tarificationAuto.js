import { ttcRetombe } from './parametrage';
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

// Réponse de /api/auto/prime-garantie/ (garantie ajoutée à un véhicule) : message montré sous la saisie
export const noteCalculGarantie = (r) => {
  if (!r?.Trouvee) return r?.Message || 'Garantie non tarifée : primes à saisir.';
  if (!(Number(r.PrimeAnnuelle) || Number(r.PrimeNette))) {
    return 'Le tarif ne donne aucune prime pour cette garantie sur ce véhicule : saisissez-la.';
  }
  if (!Number(r.PrimeNette)) return 'Comprise dans une autre garantie de l\'offre : prime nette nulle au tarif.';
  return `Primes du tarif (offre « ${r.Offre} ») pour ce véhicule, modifiables.`;
};

// Garanties du barème que la compagnie n'admet pas pour l'âge du véhicule (motif(id) non nul) : non
// accordées d'office, l'utilisateur peut les cocher quand même. Jamais la RC ni la CEDEAO.
export const sansGarantiesNonAdmises = (garanties, motif) => (garanties || []).map((g) => (
  g.acquise && !estGarantieRc(g) && !estGarantieCedeao(g) && motif(g.id_garantie) ? { ...g, acquise: false } : g
));

// Règles entre garanties de la compagnie (reglesInteractionsAuto, Administration > Réglages Automobile > Règles des
// garanties), appliquées à la liste d'un véhicule à chaque changement :
//   OBLIGATOIRE  : toujours cochée, ni décochée ni retirée ;
//   NON_PROPOSEE : non commercialisée dans la catégorie : décochée, ne peut être cochée ;
//   NON_COCHEE   : proposée sans être cochée d'office (premier calcul seulement) ;
//   REQUIERT     : décochée et bloquée tant qu'aucune des garanties liées n'est cochée ;
//   EXCLUE_SI    : décochée et bloquée tant qu'une des garanties liées est cochée ;
//   COUPLEE      : vendue avec une des garanties liées (NSIA catégories 3, 4, 7 : vol et incendie) : cochée par
//                  l'utilisateur (basculee), elle coche ses garanties liées ; sans aucune d'elles cochée, elle est
//                  décochée (sans être bloquée) ;
//   OFFERTE_SI   : prime nette nulle quand une des garanties liées est ajoutée et cochée ;
//   PRIME_SI     : prime annuelle forfaitaire quand une des garanties liées est ajoutée et cochée, au prorata de la
//                  prime de la ligne (durée, BNS).
// Les deux dernières ne jouent que pour une garantie ajoutée à l'écran (is_new_garantie) : le barème les applique déjà
// quand l'offre contient la garantie liée (NSIA : dommages ou collision dans l'offre → défense-recours 4 200 F, recours
// anticipé sans prime ; dommages → bris de glace sans prime), et les rejouer sur ses lignes en changerait les primes.
// PRIME_MINIMUM n'est appliquée que par le barème (prime-garantie compris).
// La prime du barème est gardée (primeAvantRegle) et rendue quand la condition disparaît ; une prime saisie à la main
// (primeSaisie) n'est plus modifiée. Champs ajoutés : obligatoire, bloquee, offerte, motifRegle.
// basculee : id de la garantie que l'utilisateur vient de cocher, décocher ou ajouter.
export const appliquerReglesGaranties = (garanties, regles, { codeCategorie = '', initial = false, basculee = null } = {}) => {
  if (!regles?.length || !garanties?.length) return garanties;
  const id = (g) => Number(g.id_garantie);
  const liees = (r) => String(r.Liees || '').split(',').map(Number).filter(Boolean);
  const nomLiee = (r, idLiee) => (r.LibellesLiees || [])[liees(r).indexOf(idLiee)] || `garantie ${idLiee}`;
  const nomsLiees = (r, filtre = () => true) => liees(r).filter(filtre).map((x) => nomLiee(r, x)).join(' ou ');
  const reglesDe = (g, type) => regles.filter((r) => r.Type === type && Number(r.IdSousGarantie) === id(g));
  const categorieVisee = (r) => String(r.Categories || '').split(',').includes(String(codeCategorie || ''));

  // Repartir des primes du barème et effacer les marques d'une application précédente
  let liste = garanties.map(({ primeAvantRegle, obligatoire, bloquee, offerte, motifRegle, ...g }) => (
    primeAvantRegle ? { ...g, primeAnnuelle: primeAvantRegle.pa, primeNette: primeAvantRegle.pn } : g
  ));

  liste = liste.map((g) => {
    const nonProposee = reglesDe(g, 'NON_PROPOSEE').find(categorieVisee);
    if (nonProposee) {
      return { ...g, acquise: false, bloquee: true, motifRegle: nonProposee.Commentaire || `Non commercialisée en catégorie ${codeCategorie}` };
    }
    if (reglesDe(g, 'OBLIGATOIRE').length) return { ...g, acquise: true, obligatoire: true };
    const nonCochee = reglesDe(g, 'NON_COCHEE')[0];
    if (nonCochee) return { ...g, acquise: initial ? false : g.acquise, motifRegle: nonCochee.Commentaire || 'Proposée sans être cochée d\'office' };
    return g;
  });

  // Vendues ensemble : la garantie que l'utilisateur coche entraîne ses garanties liées présentes au devis
  const cocheeParUtilisateur = basculee !== null && basculee !== undefined
    && liste.find((g) => id(g) === Number(basculee) && g.acquise && !g.bloquee);
  if (cocheeParUtilisateur) {
    const entrainees = new Set(reglesDe(cocheeParUtilisateur, 'COUPLEE').flatMap(liees));
    liste = liste.map((g) => (entrainees.has(id(g)) && !g.acquise && !g.bloquee ? { ...g, acquise: true } : g));
  }

  // Exige / exclue si / vendue avec : jusqu'à stabilité (décocher le vol décoche le vol des accessoires, décocher
  // l'incendie décoche le vol qui se vend avec lui, etc.)
  for (let passe = 0; passe < 4; passe += 1) {
    const cochees = new Set(liste.filter((g) => g.acquise).map(id));
    let change = false;
    liste = liste.map((g) => {
      if (g.obligatoire || g.bloquee) return g;
      const exige = reglesDe(g, 'REQUIERT').find((r) => !liees(r).some((x) => cochees.has(x)));
      if (exige) {
        if (g.acquise) change = true;
        return { ...g, acquise: false, bloquee: true, motifRegle: `Exige ${nomsLiees(exige)}` };
      }
      const exclue = reglesDe(g, 'EXCLUE_SI').find((r) => liees(r).some((x) => cochees.has(x)));
      if (exclue) {
        if (g.acquise) change = true;
        return { ...g, acquise: false, bloquee: true, motifRegle: `Exclue avec ${nomsLiees(exclue, (x) => cochees.has(x))}` };
      }
      const couplee = reglesDe(g, 'COUPLEE')[0];
      if (couplee) {
        const seule = !liees(couplee).some((x) => cochees.has(x));
        if (seule && g.acquise) change = true;
        return { ...g, acquise: seule ? false : g.acquise, motifRegle: `Se vend avec ${nomsLiees(couplee)}` };
      }
      return g;
    });
    if (!change) break;
  }

  // Offerte si / prime forfaitaire si : déclenchées par une garantie ajoutée à l'écran
  const ajoutees = new Set(liste.filter((g) => g.acquise && g.is_new_garantie).map(id));
  const rc = liste.find((g) => estGarantieRc(g) && g.acquise);
  const prorataRc = rc && Number(rc.primeAnnuelle) > 0 ? Number(rc.primeNette) / Number(rc.primeAnnuelle) : 1;
  return liste.map((g) => {
    if (g.primeSaisie) return g;
    const declenchee = (r) => liees(r).some((x) => ajoutees.has(x));
    const offerte = reglesDe(g, 'OFFERTE_SI').find(declenchee);
    const avant = { pa: g.primeAnnuelle, pn: g.primeNette };
    if (offerte) {
      return { ...g, primeNette: 0, primeAvantRegle: avant, offerte: true, motifRegle: `Offerte avec ${nomsLiees(offerte, (x) => ajoutees.has(x))}` };
    }
    const forfait = reglesDe(g, 'PRIME_SI').find((r) => declenchee(r) && r.PrimeAnnuelle !== null && r.PrimeAnnuelle !== undefined);
    if (forfait) {
      const pa = Number(forfait.PrimeAnnuelle);
      const prorata = Number(g.primeAnnuelle) > 0 ? Number(g.primeNette) / Number(g.primeAnnuelle) : prorataRc;
      return {
        ...g, primeAnnuelle: pa, primeNette: Math.round(pa * prorata), primeAvantRegle: avant,
        motifRegle: `${pa.toLocaleString('fr-FR')} F par an avec ${nomsLiees(forfait, (x) => ajoutees.has(x))}`,
      };
    }
    return g;
  });
};

// La prime nette enregistrée (stddevis.primenette, comprenant le FGA) contient-elle la CEDEAO ?
// Oui pour un devis calculé (TTC = prime nette + accessoire + taxe) ; non pour un devis à primes
// imposées, que sp_maj_manuelle_primes enregistre sans elle. On retient le modèle qui retombe sur
// la TTC enregistrée (NSIA : TTC éventuellement arrondie au multiple de 5 supérieur), sinon celui
// du devis (imposé ou non).
export const cedeaoDansPrimeNette = ({ primenette, accessoire, taxe, cedeao, primettc, primeImposee = false, arrondiNsia = false }) => {
  const entier = (x) => Math.round(Number(x) || 0);
  const ttc = entier(primettc);
  const retombe = (somme) => ttcRetombe(ttc, somme, { idProduit: 1, nsia: arrondiNsia });
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

// Affaire à tarif forfaitaire (incorporation dans une flotte) : la prime nette du fichier Excel est reprise telle
// quelle, sans prorata. Elle est répartie sur les garanties acquises hors CEDEAO au prorata de leurs primes nettes du
// barème (plus forts restes) ; prime annuelle = prime nette. Taxe et FGA suivent (taxeGarantie, 2 % de la RC).
export const ventilerPrimeFichier = (garanties, primeNetteFichier) => {
  const total = Math.round(Number(primeNetteFichier) || 0);
  const lignes = (garanties || []).map((g) => ({ ...g }));
  const cibles = lignes.filter((g) => g.acquise && !estGarantieCedeao(g));
  if (!(total > 0) || !cibles.length) return lignes;
  let poids = cibles.map((g) => Math.max(0, Number(g.primeNette) || 0));
  if (!poids.some((p) => p > 0)) poids = cibles.map((g) => (estGarantieRc(g) ? 1 : 0));
  if (!poids.some((p) => p > 0)) poids = cibles.map(() => 1);
  const somme = poids.reduce((s, p) => s + p, 0);
  const brutes = poids.map((p) => (total * p) / somme);
  const parts = brutes.map((b) => Math.floor(b));
  let reste = total - parts.reduce((s, p) => s + p, 0);
  brutes
    .map((b, i) => [b - parts[i], i])
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (reste > 0) {
        parts[i] += 1;
        reste -= 1;
      }
    });
  cibles.forEach((g, i) => {
    if (poids[i] > 0) {
      g.primeNette = parts[i];
      g.primeAnnuelle = parts[i];
    }
  });
  return lignes;
};

// Base de l'accessoire (fn_get_accessoire) : prime nette des garanties acquises, CEDEAO comprise,
// plus le FGA - comme prime_nette_totale du moteur et stddevis.primenette à l'enregistrement
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
