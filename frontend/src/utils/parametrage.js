/**
 * Paramétrage réglé dans l'administration (GET /api/parametrage/, configuration_api/parametrage.py),
 * chargé une fois au démarrage (main.jsx) puis lu de façon synchrone par les écrans et les
 * documents imprimés. Serveur injoignable ou réglage absent : la valeur d'origine prévue ici
 * s'applique, l'application reste utilisable.
 */
import apiClient from '../api/apiClient';

// Valeurs d'origine (identiques aux valeurs de départ des migrations configuration_api 0073 et 0100 : compagnie
// proposée AMSA pour le Voyage, NSIA ailleurs)
const PRODUITS_ORIGINE = [
  { IdProduit: 1, Libelle: 'AUTOMOBILE', Onglet: 'Auto', ModuleSaisie: 'auto', SaisieOuverte: true, Ordre: 1, IdCompagnieDefaut: 1 },
  { IdProduit: 3, Libelle: 'ASSURANCE VOYAGE', Onglet: 'Voyage', ModuleSaisie: 'voyage', SaisieOuverte: true, Ordre: 2, IdCompagnieDefaut: 21 },
  { IdProduit: 6, Libelle: 'TRANSPORT', Onglet: 'Transport', ModuleSaisie: 'transport', SaisieOuverte: true, Ordre: 3, IdCompagnieDefaut: 1 },
  { IdProduit: 4, Libelle: 'MULTIRISQUES HABITATION', Onglet: 'MRH', ModuleSaisie: 'mrh', SaisieOuverte: true, Ordre: 4, IdCompagnieDefaut: 1 },
  { IdProduit: 7, Libelle: 'MULTIRISQUES PROFESSIONNELLE', Onglet: 'MRP', ModuleSaisie: 'mrp', SaisieOuverte: false, Ordre: 5, IdCompagnieDefaut: 1 },
  { IdProduit: 9, Libelle: 'TOUS DOMMAGES', Onglet: 'Dommages', ModuleSaisie: 'tous-dommages', SaisieOuverte: true, Ordre: 6, IdCompagnieDefaut: 1 },
  { IdProduit: 5, Libelle: 'SANTE', Onglet: 'Santé', ModuleSaisie: 'sante', SaisieOuverte: true, Ordre: 7, IdCompagnieDefaut: 1 },
  // Vie séparée de la Santé (2026-11-02) : onglet propre, formulaire AFA, SANLAM qui gère la Vie
  { IdProduit: 10, Libelle: 'VIE', Onglet: 'Vie', ModuleSaisie: 'afa', SaisieOuverte: true, Ordre: 8, IdCompagnieDefaut: 30 },
  { IdProduit: 2, Libelle: 'INDIVIDUELLE ACCIDENTS', Onglet: 'IA', ModuleSaisie: 'ia', SaisieOuverte: true, Ordre: 9, IdCompagnieDefaut: 1 },
  { IdProduit: 8, Libelle: 'RESPONSABILITE CIVILE', Onglet: 'RC', ModuleSaisie: 'rc', SaisieOuverte: false, Ordre: 10, IdCompagnieDefaut: 1 },
];

// Formules MINENE SANTÉ (identiques aux valeurs de départ de la migration configuration_api 0083) :
// barème 70 %-80 % (BAREME_70-80.pdf, aussi pour les formules VTC) et 80 %-80 % par option (document
// Word OREOLE du 2026-10-12)
const BAREME_70_80 = {
  TauxSoinsExternes: 70, TauxHospitalisation: 80, ChambreParJour: 20000, AmbulanceParCas: 20000, AccouchementSimple: 150000,
  AccouchementGemellaire: 200000, AccouchementChirurgical: 300000, AccouchementHorsStructure: 50000, OptiqueAdulte: 50000,
  OptiqueEnfant: 40000, DentaireParPersonne: 50000, PlafondAnnuel: 1000000,
};
const BAREME_80_SOLO = { ...BAREME_70_80, TauxSoinsExternes: 80, DentaireParPersonne: 80000 };
const BAREME_80_FAMILLE = {
  ...BAREME_70_80, TauxSoinsExternes: 80, AccouchementHorsStructure: 80000, OptiqueAdulte: 70000, OptiqueEnfant: 50000,
  DentaireParPersonne: 100000, PlafondAnnuel: 2000000,
};
const SOLO = { Option: 'SOLO', Composition: 'Assuré principal sans enfant, Monsieur ou Madame', PersonnesMin: 1, PersonnesMax: 1 };
const FAMILLE = { Option: 'FAMILLE', Composition: 'M + Mme + 1 enfant ou Mme + M + 1 enfant ou Mme + 2 enfants ou M + 2 enfants', PersonnesMin: 2, PersonnesMax: 3 };
const FAMILLE_PLUS = { Option: 'FAMILLE PLUS', Composition: 'M + Mme + 4 enfants ou Mme + M + 4 enfants ou Mme + 5 enfants ou M + 5 enfants', PersonnesMin: 4, PersonnesMax: 6 };
const FORMULES_SANTE_ORIGINE = [
  { IdOffre: 17, ...SOLO, PrimeBase: 349148, ...BAREME_70_80 },
  { IdOffre: 18, ...FAMILLE, PrimeBase: 543556, ...BAREME_70_80 },
  { IdOffre: 19, ...FAMILLE_PLUS, PrimeBase: 728741, ...BAREME_70_80 },
  { IdOffre: 175, ...SOLO, PrimeBase: 523722, ...BAREME_80_SOLO },
  { IdOffre: 176, ...FAMILLE, PrimeBase: 760978, ...BAREME_80_FAMILLE },
  { IdOffre: 181, ...FAMILLE_PLUS, PrimeBase: 1039122, ...BAREME_80_FAMILLE },
  { IdOffre: 20, ...SOLO, PrimeBase: 349148, ...BAREME_70_80 },
  { IdOffre: 21, ...FAMILLE, PrimeBase: 543556, ...BAREME_70_80 },
  { IdOffre: 22, ...FAMILLE_PLUS, PrimeBase: 728741, ...BAREME_70_80 },
];

// Garanties admises selon l'âge du véhicule (configuration_api 0085) : NSIA tous risques (DOMMAGES, 7) de 0 à
// 5 ans, NSIA Auto Plus (175) de 5 à 10 ans ; âge en années révolues, minimum inclus, maximum exclu
const REGLES_GARANTIES_AUTO_ORIGINE = [
  { IdCompagnie: 1, IdSousGarantie: 7, AgeMinimum: null, AgeMaximum: 5, Categories: '', Commentaire: 'NSIA : garantie tous risques de 0 à 5 ans' },
  { IdCompagnie: 1, IdSousGarantie: 175, AgeMinimum: 5, AgeMaximum: 10, Categories: '', Commentaire: 'NSIA : NSIA Auto Plus de 5 à 10 ans' },
];

let etat = { Cabinet: {}, Parametres: {}, Documents: [], Produits: PRODUITS_ORIGINE, SanteFormules: FORMULES_SANTE_ORIGINE, ReglesGarantiesAuto: REGLES_GARANTIES_AUTO_ORIGINE, InteractionsGarantiesAuto: [], charge: false };
let chargement = null;
const abonnes = new Set();

const normaliser = (texte) => String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Charge (ou recharge après une modification dans l'admin) le paramétrage ; ne lève jamais d'erreur. */
export const chargerParametrage = (forcer = false) => {
  if (chargement && !forcer) return chargement;
  chargement = apiClient.get('/parametrage/', { timeout: 8000 })
    .then(({ data }) => {
      etat = {
        Cabinet: data?.Cabinet || {},
        Parametres: data?.Parametres || {},
        Documents: Array.isArray(data?.Documents) ? data.Documents : [],
        Produits: Array.isArray(data?.Produits) && data.Produits.length ? data.Produits : PRODUITS_ORIGINE,
        Modules: data?.Modules || [],
        SanteFormules: Array.isArray(data?.SanteFormules) && data.SanteFormules.length ? data.SanteFormules : FORMULES_SANTE_ORIGINE,
        ReglesGarantiesAuto: Array.isArray(data?.ReglesGarantiesAuto) ? data.ReglesGarantiesAuto : REGLES_GARANTIES_AUTO_ORIGINE,
        InteractionsGarantiesAuto: Array.isArray(data?.InteractionsGarantiesAuto) ? data.InteractionsGarantiesAuto : [],
        charge: true,
      };
      abonnes.forEach((f) => f());
      return etat;
    })
    .catch((err) => {
      console.warn('Paramétrage indisponible, valeurs d\'origine appliquées :', err?.message || err);
      chargement = null;
      return etat;
    });
  return chargement;
};

/** Prévient `rappel` à chaque rechargement du paramétrage ; renvoie la fonction de désabonnement. */
export const surParametrage = (rappel) => {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
};

// ------------------------------------------------------------------ règles de gestion
/** Valeur d'un paramètre (lephare_parametre), convertie selon son type, ou `defaut`. */
export const parametre = (cle, defaut) => {
  const p = etat.Parametres[cle];
  if (!p || p.Valeur === undefined || p.Valeur === null || String(p.Valeur).trim() === '') return defaut;
  if (['entier', 'decimal', 'montant', 'pourcentage'].includes(p.Type)) {
    const n = Number(String(p.Valeur).replace(',', '.'));
    return Number.isFinite(n) ? n : defaut;
  }
  if (p.Type === 'booleen') return ['1', 'true', 'oui', 'vrai'].includes(String(p.Valeur).toLowerCase());
  return p.Valeur;
};

export const villeSignature = () => parametre('documents.ville_signature', 'Abidjan');

/**
 * Prime TTC arrondie à la pièce, comme à l'enregistrement (fn_lephare_arrondi_montant) : multiple de 5 F, reste
 * jusqu'à 2 F ramené à l'inférieur, au-delà porté au supérieur (Administration > Paramètres du cabinet > Règles de
 * gestion > Arrondi des montants ; produit exclu : Administration > Produits). null / vide : rendu tel quel.
 */
export const arrondirMontant = (montant, idProduit = null) => {
  if (montant === null || montant === undefined || montant === '') return montant;
  const v = Number(montant);
  if (!Number.isFinite(v)) return montant;
  if (idProduit && etat.Produits.some((p) => Number(p.IdProduit) === Number(idProduit) && p.ArrondiTtc === false)) return v;
  const pas = Number(parametre('montants.arrondi_pas', 5)) || 0;
  if (pas <= 1) return v;
  const seuil = Number(parametre('montants.arrondi_seuil', 2)) || 0;
  const entier = Math.round(Math.abs(v));
  const reste = entier % pas;
  const arrondi = reste === 0 ? entier : (reste <= seuil ? entier - reste : entier - reste + pas);
  return Math.sign(v) * arrondi;
};

/** La TTC enregistrée retombe-t-elle sur la somme des composantes ? Telle quelle, arrondie à la pièce, ou (contrats
 *  NSIA repris d'URANUS) arrondie au multiple de 5 supérieur. */
export const ttcRetombe = (ttcEnregistree, somme, { idProduit = null, nsia = false } = {}) => (
  ttcEnregistree === somme
  || ttcEnregistree === arrondirMontant(somme, idProduit)
  || (nsia && ttcEnregistree === Math.ceil(somme / 5) * 5)
);
/**
 * Compagnie proposée à l'ouverture d'un nouveau devis du produit (Administration > Produits), sinon `repli` ;
 * l'écran garde la compagnie d'un devis rouvert et retombe sur la première de sa liste si celle-ci n'y est pas.
 */
export const compagnieParDefaut = (idProduit, repli = 1) => {
  const p = etat.Produits.find((x) => Number(x.IdProduit) === Number(idProduit));
  return Number(p?.IdCompagnieDefaut) || repli;
};

// Identité du cabinet (Administration > Le cabinet, table stdparametresite)
export const identiteCabinet = () => etat.Cabinet || {};
export const nomCabinet = () => etat.Cabinet?.RaisonSociale || 'OREOLE ASSURANCES';
/** Ligne sous le nom du cabinet dans l'en-tête des états : agrément • siège • Code CIMA. */
export const mentionCabinet = () => [
  parametre('documents.mention_agrement', ''),
  etat.Cabinet?.AdresseGeographique ? `Siège social : ${etat.Cabinet.AdresseGeographique}` : '',
  'Code CIMA CRCA',
].filter(Boolean).join(' • ');
export const logoCabinetEntete = () => parametre('documents.logo_entete', '/assets/print/logo-oreole-entete.png');
export const logoCabinetPied = () => parametre('documents.logo_pied', '/assets/print/logo-oreole-pied.png');

// ------------------------------------------------------------------ compagnies
// Logos livrés avec l'application : seulement si la compagnie n'a aucun réglage de documents
const LOGOS_ORIGINE = [
  [/nsia/, '/assets/print/logo-nsia.jpg'],
  [/sunu/, '/assets/print/logo-sunu.png'],
  [/amsa/, '/assets/print/logo-amsa.png'],
];

/** Réglages des documents d'une compagnie, retrouvée par identifiant ou par raison sociale. */
export const documentsCompagnie = (compagnie) => {
  if (compagnie === undefined || compagnie === null || compagnie === '') return null;
  if (typeof compagnie === 'number' || /^\d+$/.test(String(compagnie))) {
    return etat.Documents.find((d) => Number(d.IdCompagnie) === Number(compagnie)) || null;
  }
  const nom = normaliser(compagnie);
  return etat.Documents.find((d) => normaliser(d.RaisonSociale) === nom)
    || etat.Documents.find((d) => d.RaisonSociale && (nom.includes(normaliser(d.RaisonSociale)) || normaliser(d.RaisonSociale).includes(nom)))
    || null;
};

export const logoCompagnie = (compagnie) => {
  const doc = documentsCompagnie(compagnie);
  if (doc) return doc.Logo || null;
  const nom = normaliser(compagnie);
  return LOGOS_ORIGINE.find(([motif]) => motif.test(nom))?.[1] || null;
};

/** Modèle d'impression tiré des réglages d'une compagnie ({ Logo, RaisonSociale, AttestationVoyage }). */
export const construireModeleAttestation = (doc) => {
  const a = doc?.AttestationVoyage || {};
  return {
    logo: doc.Logo || logoCompagnie(doc.RaisonSociale),
    signataire: a.Signataire || doc.RaisonSociale,
    convention: a.Convention || '',
    paysResidence: a.PaysResidence || '',
    garanties: a.Garanties || [],
    assistance: { telephone: a.Telephone || '', email: a.Email || '', whatsapp: a.Whatsapp || '' },
    // QR codes de l'imprimé : portail d'assistance (adresse fixe) et vérification du certificat par
    // les consulats (adresse de la compagnie, {certificat} remplacé par le n° ; absente : pas de QR)
    portail: a.PortailAssistance || '',
    verification: a.VerificationVisa || '',
    exemplaires: a.Exemplaires?.length ? a.Exemplaires : ["Exemplaire de l'Assuré"],
  };
};

/** Modèle d'attestation voyage actif de la compagnie (fiche compagnie, onglet Attestation voyage), sinon null. */
export const modeleAttestationVoyage = (idCompagnie) => {
  const doc = documentsCompagnie(Number(idCompagnie));
  return doc?.AttestationVoyage?.Actif ? construireModeleAttestation(doc) : null;
};

// ------------------------------------------------------------------ produits
export const produitsParametres = () => etat.Produits;

const produitPar = (idProduit) => etat.Produits.find((p) => Number(p.IdProduit) === Number(idProduit));

/** Code de l'onglet du registre des devis (« AUTO », « MRH »…) d'un produit, ou null s'il est inconnu. */
export const codeOnglet = (libelleOnglet) => normaliser(libelleOnglet).replace(/[^a-z0-9]+/g, '_').toUpperCase();
export const ongletDuProduit = (idProduit) => {
  const p = produitPar(idProduit);
  return p?.Onglet ? codeOnglet(p.Onglet) : null;
};

/** Onglets du registre dans l'ordre des produits : [{ id, label }] sans doublon. */
export const ongletsRegistre = () => {
  const vus = new Map();
  [...etat.Produits].sort((a, b) => (a.Ordre ?? 99) - (b.Ordre ?? 99)).forEach((p) => {
    if (p.Onglet && !vus.has(codeOnglet(p.Onglet))) vus.set(codeOnglet(p.Onglet), p.Onglet);
  });
  return [...vus].map(([id, label]) => ({ id, label }));
};

/** Formulaire (route /user/quotes/<module>) qui rouvre un devis de ce produit, ou null. */
export const moduleDuProduit = (idProduit) => produitPar(idProduit)?.ModuleSaisie || null;

/** Saisie ouverte pour ce formulaire (au moins un produit qui l'utilise a la saisie ouverte). */
export const moduleOuvert = (module) => etat.Produits.some((p) => p.ModuleSaisie === module && p.SaisieOuverte);

export const libellesModulesOuverts = () => {
  const libelles = { auto: 'Automobile', ia: 'Individuelle Accidents', sante: 'Santé', voyage: 'Voyage', transport: 'Transport', mrh: 'Multirisques Habitation', rc: 'Responsabilité Civile', mrp: 'Multirisque Professionnelle', 'tous-dommages': 'Dommages', afa: 'Vie' };
  return [...new Set(etat.Produits.filter((p) => p.SaisieOuverte && p.ModuleSaisie).map((p) => libelles[p.ModuleSaisie] || p.ModuleSaisie))];
};

// ------------------------------------------------------------------ Automobile : garanties admises selon l'âge
/** Âge du véhicule en années révolues entre sa première mise en circulation et la date d'effet (null si inconnu). */
export const ageVehiculeAns = (dateMec, dateEffet) => {
  const mec = new Date(String(dateMec || '').slice(0, 10));
  const effet = dateEffet ? new Date(String(dateEffet).slice(0, 10)) : new Date();
  if (Number.isNaN(mec.getTime()) || Number.isNaN(effet.getTime()) || mec.getFullYear() < 1900) return null;
  let age = effet.getFullYear() - mec.getFullYear();
  if (effet.getMonth() < mec.getMonth() || (effet.getMonth() === mec.getMonth() && effet.getDate() < mec.getDate())) age -= 1;
  return Math.max(age, 0);
};

const reglesGarantie = (idCompagnie, idSousGarantie, codeCategorie) => (etat.ReglesGarantiesAuto || []).filter((r) => (
  Number(r.IdCompagnie) === Number(idCompagnie) && Number(r.IdSousGarantie) === Number(idSousGarantie)
  && (!r.Categories || String(r.Categories).split(',').includes(String(codeCategorie || '')))
));
const plage = (r) => (r.AgeMinimum === null || r.AgeMinimum === undefined ? `de 0 à ${r.AgeMaximum} ans`
  : r.AgeMaximum === null || r.AgeMaximum === undefined ? `à partir de ${r.AgeMinimum} ans` : `de ${r.AgeMinimum} à ${r.AgeMaximum} ans`);

/** Âges auxquels la compagnie admet la garantie (« de 0 à 5 ans »), ou null sans règle. */
export const ageAdmisGarantie = (idCompagnie, idSousGarantie, codeCategorie) => {
  const regles = reglesGarantie(idCompagnie, idSousGarantie, codeCategorie);
  return regles.length ? regles.map(plage).join(' ou ') : null;
};

/** Motif si la garantie n'est pas admise pour un véhicule de cet âge (Administration > Dépréciation et âge
 * des véhicules), sinon null. Une telle garantie n'est pas accordée d'office : l'utilisateur peut la cocher. */
export const garantieNonAdmise = ({ idCompagnie, idSousGarantie, ageAns, codeCategorie }) => {
  if (ageAns === null || ageAns === undefined) return null;
  const regles = reglesGarantie(idCompagnie, idSousGarantie, codeCategorie);
  if (!regles.length) return null;
  const admise = regles.some((r) => (r.AgeMinimum === null || r.AgeMinimum === undefined || ageAns >= r.AgeMinimum)
    && (r.AgeMaximum === null || r.AgeMaximum === undefined || ageAns < r.AgeMaximum));
  if (admise) return null;
  return `Non admise pour un véhicule de ${ageAns} an${ageAns > 1 ? 's' : ''}`;
};

/** Règles entre garanties de la compagnie applicables à la catégorie (Administration > Réglages Automobile >
 * Règles des garanties) : obligatoire, exige, exclue si, offerte si, prime forfaitaire si, non commercialisée,
 * non cochée d'office. Appliquées par appliquerReglesGaranties (utils/tarificationAuto). */
export const reglesInteractionsAuto = (idCompagnie, codeCategorie) => (etat.InteractionsGarantiesAuto || []).filter((r) => (
  r.Actif !== false && Number(r.IdCompagnie) === Number(idCompagnie)
  && (r.Type === 'NON_PROPOSEE' || !r.Categories || String(r.Categories).split(',').includes(String(codeCategorie || '')))
));

/** Une garantie au moins de la compagnie est-elle refusée à un véhicule de cet âge ? */
export const ageRestreintGaranties = ({ idCompagnie, ageAns, codeCategorie }) => (etat.ReglesGarantiesAuto || [])
  .some((r) => Number(r.IdCompagnie) === Number(idCompagnie)
    && garantieNonAdmise({ idCompagnie, idSousGarantie: r.IdSousGarantie, ageAns, codeCategorie }));

// ------------------------------------------------------------------ Santé MINENE
/** Formules MINENE SANTÉ (Administration > Réglages Santé MINENE) : prime, famille, barème de soins. */
export const formulesSante = () => etat.SanteFormules || FORMULES_SANTE_ORIGINE;
export const formuleSante = (idOffre) => formulesSante().find((f) => Number(f.IdOffre) === Number(idOffre)) || null;

// Clause d'ajustement d'origine (cp_MINENE.pdf), une tranche par ligne « rapport S/P | ajustement »
const CLAUSE_AJUSTEMENT_ORIGINE = [
  'à 50 % | Perte du bénéfice du tiers payant',
  'de 51% à 65% | Réduction de 10%',
  'de 66% à 70% | Aucune modification',
  'de 71 à 80% | 15% de majoration',
  'de 81% à 90% | 20% de majoration',
  'de 91% à 100% | 30% de majoration',
  'de 101% à 110% | 35% de majoration',
  'de 111% à 115% | 45% de majoration',
  'Au-delà de 115% | Résiliation pour ordre de la police en vue d’une nouvelle étude statistique pour une éventuelle nouvelle offre',
].join('\n');

/** Réglages MINENE (paramètres sante.minene.*), avec les valeurs d'origine des documents OREOLE. */
export const reglagesMinene = () => {
  const p = (cle, defaut) => parametre(`sante.minene.${cle}`, defaut);
  const clause = String(p('clause_ajustement', CLAUSE_AJUSTEMENT_ORIGINE)).split(/\r?\n/)
    .map((ligne) => ligne.split('|').map((x) => x.trim()))
    .filter(([rapport]) => rapport)
    .map(([rapport, ajustement = '']) => ({ rapport, ajustement }));
  return {
    ia: { deces: p('ia_capital_deces', 2000000), ipt: p('ia_capital_ipt', 2000000), fraisMedicaux: p('ia_frais_medicaux', 100000), prime: p('ia_prime_nette', 14524) },
    rc: {
      corporels: p('rc_dommages_corporels', 50000000), intoxications: p('rc_intoxications', 5000000), materiels: p('rc_dommages_materiels', 10000000),
      franchiseTaux: p('rc_franchise_taux', 10), franchiseMin: p('rc_franchise_minimum', 20000), franchiseMax: p('rc_franchise_maximum', 200000),
      prime: p('rc_prime_nette', 14524),
    },
    surprimes: {
      affection: p('surprime_affection', 30), affectionsMax: p('affections_max', 3),
      age1Debut: p('surprime_age_1_debut', 61), age1Taux: p('surprime_age_1_taux', 30),
      age2Debut: p('surprime_age_2_debut', 65), age2Taux: p('surprime_age_2_taux', 50),
      ageMaxAdulte: p('age_max_adulte', 69), ageMaxEnfant: p('age_max_enfant', 21), ageMaxEnfantCertificat: p('age_max_enfant_certificat', 25),
    },
    carence: {
      soinsCourants: p('carence_soins_courants', 3), soinsDentaires: p('carence_soins_dentaires', 3), optique: p('carence_optique', 10),
      maternite: p('carence_maternite', 10), protheses: p('carence_protheses', 12), maladiesChroniques: p('carence_maladies_chroniques', 12),
    },
    gestion: {
      etendue: p('etendue_territoriale', "Côte d'Ivoire exclusivement"), optiquePeriodicite: p('optique_periodicite', 2),
      quotaBons: p('quota_bons', 15), quotaPharmacie: p('quota_pharmacie', 200000), seuilSinistralite: p('seuil_sinistralite', 50),
    },
    clause,
    // Taux proposés à la saisie du devis : « Réduction de x% » et « x% de majoration » de la clause
    ajustements: {
      reduction: clause.map((t) => [Number((t.ajustement.match(/r[ée]duction\s+de\s+(\d+(?:[.,]\d+)?)\s*%/i) || [])[1]?.replace(',', '.')), t.rapport]).filter(([n]) => n > 0),
      majoration: clause.map((t) => [Number((t.ajustement.match(/(\d+(?:[.,]\d+)?)\s*%\s*de\s+majoration/i) || [])[1]?.replace(',', '.')), t.rapport]).filter(([n]) => n > 0),
    },
  };
};
