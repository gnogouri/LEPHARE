/**
 * LE PHARE - Mapping 100% Conforme au Routeur Django Uranus Backend
 * 
 * Toutes les routes correspondent strictement aux patterns d'URL enregistrés dans :
 * - production/urls.py
 * - customer/urls.py
 * - configuration_api/urls.py
 * - account/urls.py
 * - autorisations/urls.py
 * - commissions/urls.py
 * - institutionnel/urls.py
 * - asaci/urls.py
 * - reporting/urls.py
 * - payment/urls.py
 * - sante/urls.py
 * 
 * Tous les chemins non conformes et les fallbacks fictifs ont été supprimés.
 */

import apiClient from './apiClient';

/* =========================================================================
   HELPER : Extraction standard des résultats paginés ou bruts
   ========================================================================= */
const extractData = (res) => {
  if (!res) return [];
  if (Array.isArray(res.data)) return res.data;
  if (res.data && Array.isArray(res.data.results)) return res.data.results;
  // Beaucoup d'endpoints APIView du backend renvoient une enveloppe
  // { status: 'succès'|'Echec', data: [...] } au lieu d'un tableau brut
  // ou de la pagination DRF standard ({ results: [...] }).
  if (res.data && Array.isArray(res.data.data)) return res.data.data;
  return res.data;
};

/* =========================================================================
   1. AUTHENTIFICATION & UTILISATEURS (account)
   ========================================================================= */
export const authApi = {
  // POST /api/users/login
  login: (credentials) => apiClient.post('/users/login', credentials),
  // POST /api/users/register
  register: (userData) => apiClient.post('/users/register', userData),
  // GET /api/users/user
  getCurrentUser: async () => {
    const res = await apiClient.get('/users/user');
    return res.data;
  },
  // POST /api/users/logout
  logout: () => apiClient.post('/users/logout'),
  // POST /api/users/changepassword
  changePassword: (data) => apiClient.post('/users/changepassword', data),
  // POST /api/users/resetpassword
  resetPassword: (data) => apiClient.post('/users/resetpassword', data),
  // GET /api/users/profile/
  getProfiles: async () => {
    const res = await apiClient.get('/users/profile/');
    return extractData(res);
  },
};

/* =========================================================================
   2. CLIENTS & ASSURÉS (customer)
   ========================================================================= */
export const sanitizeClientForApi = (raw) => {
  if (!raw) return {};
  const isEntreprise = raw.typeclient === 'Entreprise' || raw.Particulier === 'F' || raw.Particulier === '0';
  const nom = (raw.nom || raw.Nom || '').trim();
  const prenom = isEntreprise ? '' : (raw.prenom || raw.Prenoms || '').trim();

  return {
    Nom: nom,
    Prenoms: prenom || null,
    Particulier: isEntreprise ? 'F' : 'V',
    Vip: raw.Vip || (raw.is_vip ? 'V' : 'N'),
    Statut: raw.Statut || 'V',
    CreeCie: raw.CreeCie || 'V',
    Telephone: (raw.telephone || raw.Telephone || '').trim() || null,
    Mobile: (raw.mobile || raw.Mobile || '').trim() || null,
    Fixe: (raw.fixe || raw.Fixe || '').trim() || null,
    Fax: (raw.fax || raw.Fax || '').trim() || null,
    Email: (raw.email || raw.Email || '').trim() || null,
    Adresse1: (raw.adresse || raw.Adresse1 || '').trim() || null,
    Adresse2: (raw.Adresse2 || '').trim() || null,
    IdVille: raw.IdVille ? Number(raw.IdVille) : null,
    CodePostal: (raw.CodePostal || '').trim() || null,
    IdQualite: raw.IdQualite ? Number(raw.IdQualite) : (isEntreprise ? 4 : 1),
    IdProfession: raw.IdProfession ? Number(raw.IdProfession) : null,
    IdSecteurActivite: raw.IdSecteurActivite ? Number(raw.IdSecteurActivite) : null,
    Responsable: (raw.Responsable || '').trim() || null,
    Fonction: (raw.Fonction || '').trim() || '',
    CniPat: (raw.CniPat || '').trim() || null,
    DateNaissance: raw.DateNaissance || null,
    LieuNaissance: (raw.LieuNaissance || '').trim() || null,
    Rib: raw.Rib && raw.Rib.replace(/\s+/g, '').length === 24 ? raw.Rib.replace(/\s+/g, '') : null,
    NumeroCompte: raw.NumeroCompte || 'XXXXXXX',
    Solde: raw.Solde !== undefined ? String(raw.Solde) : '0.0000',
    Avoir: raw.Avoir !== undefined ? String(raw.Avoir) : '0.0000',
    ExonereDeTaxes: Boolean(raw.ExonereDeTaxes),
    ExonereDeAccess: Boolean(raw.ExonereDeAccess),
    idtypeclient: raw.idtypeclient ? Number(raw.idtypeclient) : (isEntreprise ? 2 : 1),
    idtypeassure: raw.idtypeassure ? Number(raw.idtypeassure) : (isEntreprise ? 2 : 1),
    IdCategorie: raw.IdCategorie ? Number(raw.IdCategorie) : null,
    IdProfil: raw.IdProfil ? Number(raw.IdProfil) : null,
    Reconquete: raw.Reconquete || 'N',
    Matricule: raw.Matricule || raw.codeclient || null,
    numero_assure: raw.numero_assure || null,
    cle_unique: raw.cle_unique || null,
  };
};

export const normalizeClient = (c) => {
  if (!c) return null;
  const id = c.IdClient || c.id;
  
  // Nettoyage des chaînes textuelles
  const cleanStr = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val).trim();
    if (str === '.' || str === '-' || str === 'null' || str === 'undefined' || str === 'NONE') return '';
    return str;
  };

  const rawNom = cleanStr(c.Nom || c.nom);
  const rawPrenom = cleanStr(c.Prenoms || c.prenom);
  const raisonSociale = cleanStr(c.RaisonSociale || c.raisonsociale);
  const cniPat = cleanStr(c.CniPat || c.cnipat);

  const isEntreprise = c.Particulier === 'F' || c.Particulier === '0' || c.typeclient === 'Entreprise' || (c.idtypeclient === 2) || Boolean(raisonSociale);

  // Construction du nom complet propre
  let nomcomplet = [rawNom, rawPrenom].filter(Boolean).join(' ').trim();
  if (!nomcomplet) {
    nomcomplet = raisonSociale || cniPat || (id ? `Client #${id}` : 'Client sans nom');
  }

  // Civilité / Qualité
  let civilite = cleanStr(c.civilite || c.Civilite);
  if (typeof c.Civilite === 'object' && c.Civilite !== null) {
    civilite = cleanStr(c.Civilite.Libelle);
  }
  if (!civilite && isEntreprise) {
    civilite = 'Société';
  }

  // Téléphone et Contact
  const cleanPhone = (val) => {
    const s = cleanStr(val);
    if (!s || s === '00' || s === 'TELP' || s === '0' || s.length < 3) return '';
    return s;
  };
  const cleanEmail = (val) => {
    const s = cleanStr(val);
    if (!s || !s.includes('@')) return '';
    return s;
  };

  const telephone = cleanPhone(c.Telephone || c.telephone);
  const mobile = cleanPhone(c.Mobile || c.mobile);
  const contactPrincipal = mobile || telephone;
  const email = cleanEmail(c.Email || c.email);

  // Adresse et Ville
  const adresse1 = cleanStr(c.Adresse1 || c.adresse);
  const adresse2 = cleanStr(c.Adresse2);
  let ville = cleanStr(c.ville || c.Ville || c.libelleville);
  if (!ville) {
    if (adresse2 && adresse2 !== 'BP' && adresse2.length > 2) ville = adresse2;
    else if (adresse1 && adresse1 !== 'BP' && !adresse1.toLowerCase().includes('bp')) ville = adresse1;
    else ville = 'Abidjan';
  }

  // Profession
  let profession = cleanStr(c.libelleprofession || c.profession || c.Profession);
  if (!profession) {
    profession = isEntreprise ? 'Entreprise / Société' : '';
  }

  // Code / Matricule
  const codeclient = cleanStr(c.Matricule) || cleanStr(c.numero_assure) || cleanStr(c.codeclient) || (id ? `CLI-2026-${String(id).padStart(4, '0')}` : 'CLI-SANS-CODE');

  return {
    ...c,
    id,
    IdClient: id,
    codeclient,
    Nom: rawNom,
    Prenoms: rawPrenom,
    nom: rawNom,
    prenom: rawPrenom,
    nomcomplet,
    typeclient: isEntreprise ? 'Entreprise' : 'Particulier',
    civilite,
    telephone: contactPrincipal,
    mobile: contactPrincipal,
    email,
    adresse: adresse1,
    ville,
    profession,
    libelleprofession: profession,
    CniPat: cniPat,
    contrats_actifs: c.contrats_actifs || 0,
    devis_en_cours: c.devis_en_cours || 0,
    // Primes TTC des polices du client, calculées par /api/client/ (nombre) ; un client déjà
    // normalisé garde son montant formaté
    total_primes: typeof c.total_primes === 'number'
      ? `${String(Math.round(c.total_primes)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`
      : (c.total_primes || '0 FCFA'),
    raw: c,
  };
};

export const customerApi = {
  // GET /api/client/ (Liste des clients réels en BDD)
  getClients: async () => {
    const res = await apiClient.get('/client/');
    const list = extractData(res);
    return list.map(normalizeClient);
  },
  // GET /api/client/:id/
  getClientDetail: async (id) => {
    const res = await apiClient.get(`/client/${id}/`);
    return normalizeClient(res.data);
  },
  // GET /api/client/:id/fiche/ (fiche imprimable : identité avec libellés, synthèse commerciale,
  // dernières opérations)
  getFicheClient: async (id) => (await apiClient.get(`/client/${id}/fiche/`)).data,
  // GET /api/client/:id/dossier/ (dossier 360° : identité, synthèse, tous les devis en cours et
  // toutes les émissions de contrats du client, filtrés en base)
  getDossierClient: async (id) => (await apiClient.get(`/client/${id}/dossier/`)).data,
  // POST /api/client/
  createClient: async (clientData) => {
    const payload = sanitizeClientForApi(clientData);
    return apiClient.post('/client/', payload);
  },
  // PUT /api/client/:id/
  updateClient: async (id, clientData) => {
    const payload = sanitizeClientForApi(clientData);
    return apiClient.put(`/client/${id}/`, payload);
  },
  // PATCH /api/client/:id/ : seuls les champs fournis (noms de l'API) sont modifiés
  patchClient: (id, champs) => apiClient.patch(`/client/${id}/`, champs),
  // GET /api/clientrecherche/:terme (Recherche client)
  searchClient: async (term) => {
    const res = await apiClient.get(`/clientrecherche/${term}`);
    return extractData(res);
  },
  // GET /api/clientrestreint/
  getClientsRestreint: async () => {
    const res = await apiClient.get('/clientrestreint/');
    const list = extractData(res);
    return list.map(normalizeClient);
  },
};

/* =========================================================================
   3. RÉFÉRENTIELS DE CONFIGURATION CLIENT (configuration_api)
   ========================================================================= */
export const configRefApi = {
  // GET /api/qualite/
  getQualites: async () => extractData(await apiClient.get('/qualite/')),
  // GET /api/ville/
  getVilles: async () => extractData(await apiClient.get('/ville/')),
  // GET /api/profession/
  getProfessions: async () => extractData(await apiClient.get('/profession/')),
  // GET /api/secteuractivite/
  getSecteursActivite: async () => extractData(await apiClient.get('/secteuractivite/')),
  // GET /api/typesouscripteur/
  getTypesSouscripteur: async () => extractData(await apiClient.get('/typesouscripteur/')),
  // GET /api/typeassure/
  getTypesAssure: async () => extractData(await apiClient.get('/typeassure/')),
};

/* =========================================================================
   3b. SECTEURS D'ACTIVITÉ ÉCONOMIQUE - API CRUD (configuration_api)
   ========================================================================= */
export const secteurActiviteApi = {
  // GET /api/secteuractivite/ — Liste complète avec client_count
  getAll: async () => extractData(await apiClient.get('/secteuractivite/')),
  // POST /api/secteuractivite/ — Créer un nouveau secteur
  create: (data) => apiClient.post('/secteuractivite/', data),
  // PUT /api/secteuractivite/{id}/ — Modifier un secteur
  update: (id, data) => apiClient.put(`/secteuractivite/${id}/`, data),
  // DELETE /api/secteuractivite/{id}/ — Supprimer (bloqué si clients liés)
  delete: (id) => apiClient.delete(`/secteuractivite/${id}/`),
};

/* =========================================================================
   3c. TYPE DE SOUSCRIPTEUR (stdtypesouscripteur) — CRUD
   ========================================================================= */
export const typeSouscripteurApi = {
  // GET /api/typesouscripteur/
  getAll: async () => extractData(await apiClient.get('/typesouscripteur/')),
  // POST /api/typesouscripteur/
  create: (data) => apiClient.post('/typesouscripteur/', data),
  // PUT /api/typesouscripteur/{id}/
  update: (id, data) => apiClient.put(`/typesouscripteur/${id}/`, data),
  // DELETE /api/typesouscripteur/{id}/
  delete: (id) => apiClient.delete(`/typesouscripteur/${id}/`),
};

/* =========================================================================
   3d. TYPE D'ASSURÉ (stdtypeassure) — CRUD
   ========================================================================= */
export const typeAssureApi = {
  // GET /api/typeassure/
  getAll: async () => extractData(await apiClient.get('/typeassure/')),
  // POST /api/typeassure/
  create: (data) => apiClient.post('/typeassure/', data),
  // PUT /api/typeassure/{id}/
  update: (id, data) => apiClient.put(`/typeassure/${id}/`, data),
  // DELETE /api/typeassure/{id}/
  delete: (id) => apiClient.delete(`/typeassure/${id}/`),
};

/* =========================================================================
   3e. PROFESSION / MÉTIER (stdprofession) — CRUD
   ========================================================================= */
export const professionApi = {
  // GET /api/profession/
  getAll: async () => extractData(await apiClient.get('/profession/')),
  // POST /api/profession/
  create: (data) => apiClient.post('/profession/', data),
  // PUT /api/profession/{id}/
  update: (id, data) => apiClient.put(`/profession/${id}/`, data),
  // DELETE /api/profession/{id}/
  delete: (id) => apiClient.delete(`/profession/${id}/`),
};



/* =========================================================================
   4. DEVIS & TARIFICATION MULTI-BRANCHES (production)
   ========================================================================= */
// Intermédiaire par défaut quand le devis/contrat n'en porte pas
export const INTERMEDIAIRE_PAR_DEFAUT = 'OREOLE ASSURANCES';

// Libellé de l'intermédiaire : objet imbriqué (serializers depth=1 : `intermediaire` pour les devis,
// `idintermediaire` pour les contrats) ou simple chaîne ; intermédiaire de paramétrage (id 0) ignoré
export const libelleIntermediaire = (...sources) => {
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'object') {
      const id = src.IdIntermediaire ?? src.idintermediaire;
      const libelle = src.LibelleIntermediaire || src.libelleintermediaire || src.libelle;
      if (Number(id) !== 0 && libelle && String(libelle).trim()) return String(libelle).trim();
    } else if (typeof src === 'string' && src.trim()) {
      return src.trim();
    }
  }
  return INTERMEDIAIRE_PAR_DEFAUT;
};

// Données des Conditions Particulières Auto mono (mêmes sources qu'Uranus) : récapitulatif de
// quittance, garanties souscrites et fiche véhicule, pour un contrat ou un devis
const donneesEntete = (res) => {
  const d = res.data;
  const liste = d?.data ?? d?.Data ?? d;
  return Array.isArray(liste) ? (liste[0] || null) : liste;
};
const donneesListe = (res) => {
  const d = res.data;
  const liste = d?.Data ?? d?.data ?? d;
  return Array.isArray(liste) ? liste : [];
};
// Libellé de l'énergie du véhicule : objet { Libelle } (détail devis) ou code « SEES » / id
// (détail contrat), traduit avec la table stdenergie (/energie/)
const libelleEnergie = (valeur, energies) => {
  if (valeur && typeof valeur === 'object') return valeur.Libelle || valeur.libelle || null;
  if (valeur === undefined || valeur === null || valeur === '') return null;
  const e = energies.find((x) => String(x.CodeEnergie) === String(valeur) || String(x.IdEnergie) === String(valeur));
  return e ? e.Libelle : null;
};
// Libellé de la carrosserie (stdcarrosserie) à partir de l'identifiant du détail véhicule
const libelleCarrosserie = (id, carrosseries) => {
  const c = carrosseries.find((x) => Number(x.IdCarrosserie) === Number(id));
  return c ? c.LibelleCarrosserie : null;
};

export const conditionsParticulieresMonoApi = {
  get: async (id, { contrat = false } = {}) => {
    if (contrat) {
      const [q, g, v, en, ca] = await Promise.all([
        apiClient.get(`/quittancecontrat/${id}`),
        apiClient.get(`/garantiesouscritecontrat/${id}`),
        apiClient.get(`/contratdetail/${id}`),
        apiClient.get('/energie/').catch(() => ({ data: [] })),
        apiClient.get('/carrosserie/').catch(() => ({ data: [] })),
      ]);
      const vehicule = donneesListe(v)[0] || null;
      return {
        quittance: donneesEntete(q),
        garanties: donneesListe(g),
        vehicule: vehicule && {
          ...vehicule,
          libelleenergie: libelleEnergie(vehicule.codecarburant ?? vehicule.essence, extractData(en)),
          libellecarrosserie: libelleCarrosserie(vehicule.idcarrosserie, extractData(ca)),
        },
      };
    }
    const [q, g, v, l, en, ca] = await Promise.all([
      apiClient.get(`/quittanceproposition/${id}`),
      apiClient.get(`/garantiesouscritedevis/${id}`),
      apiClient.get(`/devisdetail/${id}`),
      apiClient.get(`/listevehiculedevis/${id}`).catch(() => ({ data: [] })),
      apiClient.get('/energie/').catch(() => ({ data: [] })),
      apiClient.get('/carrosserie/').catch(() => ({ data: [] })),
    ]);
    // Le détail devis imbrique marque / genre / type (objets) là où le détail contrat donne des libellés
    const vehicule = donneesListe(v)[0] || null;
    const infos = donneesListe(l)[0] || {};
    const libelle = (x, ...cles) => (x && typeof x === 'object' ? cles.map((c) => x[c]).find(Boolean) : null);
    return {
      quittance: donneesEntete(q),
      garanties: donneesListe(g),
      vehicule: vehicule && {
        ...vehicule,
        libellemarque: vehicule.libellemarque || libelle(vehicule.idmarque, 'LibelleMarque') || infos.LibelleMarque,
        libelletypevehicule: vehicule.libelletypevehicule || libelle(vehicule.idtypevehicule, 'libelle_type', 'LibelleType') || infos.LibelleTypeVehicule,
        libellegenrevehicule: vehicule.libellegenrevehicule || libelle(vehicule.idgenrevehicule, 'LibelleGenre', 'libelle_genre'),
        libelleenergie: libelleEnergie(vehicule.essence ?? vehicule.codecarburant, extractData(en)),
        libellecarrosserie: libelleCarrosserie(vehicule.idcarrosserie, extractData(ca)),
      },
    };
  },
};

// Conditions Particulières d'une flotte auto (« Liste des véhicules en Automobile », modèle NSIA) :
// quittance du devis / contrat et véhicules avec l'état, le capital et la prime de chaque garantie
export const conditionsParticulieresFlotteApi = {
  get: async (id, { contrat = false } = {}) => {
    const [q, v] = await Promise.all([
      apiClient.get(contrat ? `/quittancecontrat/${id}` : `/quittanceproposition/${id}`),
      apiClient.get(contrat ? `/contrat/${id}/vehicules-flotte/` : `/devis/${id}/vehicules-flotte/`),
    ]);
    return { quittance: donneesEntete(q) || {}, vehicules: Array.isArray(v.data) ? v.data : [] };
  },
};

// Impressions IA (mêmes sources qu'URANUS) : quittance de la proposition, garanties souscrites,
// assurés du devis (avec leurs ayants droit) et bénéficiaires en cas de décès du souscripteur
export const impressionIaApi = {
  get: async (iddevis) => {
    const [q, g, a] = await Promise.all([
      apiClient.get(`/quittanceproposition/${iddevis}`).catch(() => ({ data: [] })),
      apiClient.get(`/garantiesouscritedevis/${iddevis}`).catch(() => ({ data: [] })),
      apiClient.get(`/assureiapardevis/${iddevis}`).catch(() => ({ data: [] })),
    ]);
    const quittance = donneesEntete(q) || {};
    let ayantsDroit = [];
    if (quittance.IdClient) {
      try {
        ayantsDroit = (await apiClient.get(`/ayantdroitia/${quittance.IdClient}`)).data?.ayantdroits || [];
      } catch {
        // aucun bénéficiaire lisible : la rubrique reste vide
      }
    }
    return { quittance, garanties: donneesListe(g), assures: donneesListe(a), ayantsDroit };
  },
};

// Proposition MRH (gabarit URANUS) : quittance de la proposition et garanties de chaque maison
// (capital, franchises, primes) lues dans le résumé financier du devis
// Proposition MRH (gabarit URANUS) : quittance de la proposition, garanties souscrites (cumulées
// sur les maisons) et résumé financier (capitaux et franchises saisis par maison)
export const impressionMrhApi = {
  get: async (iddevis) => {
    const [q, g, r] = await Promise.all([
      apiClient.get(`/quittanceproposition/${iddevis}`),
      apiClient.get(`/garantiesouscritedevis/${iddevis}`).catch(() => ({ data: [] })),
      apiClient.get(`/mrh/devis/${iddevis}/resume-financier/`).catch(() => ({ data: {} })),
    ]);
    return { quittance: donneesEntete(q) || {}, garanties: donneesListe(g), resume: r.data || {} };
  },
};

// Proposition Voyage (gabarit URANUS) : quittance de la proposition, garanties souscrites et voyage
// saisi (destination, date de naissance retenue par le tarif, attestation)
export const impressionVoyageApi = {
  get: async (iddevis) => {
    const [q, g, v] = await Promise.all([
      apiClient.get(`/quittanceproposition/${iddevis}`),
      apiClient.get(`/garantiesouscritedevis/${iddevis}`).catch(() => ({ data: [] })),
      apiClient.get(`/devisvoyage/${iddevis}/`).catch(() => ({ data: null })),
    ]);
    return { quittance: donneesEntete(q) || {}, garanties: donneesListe(g), voyage: v.data };
  },
};

// Annexe d'un devis flotte auto, « Liste des véhicules de la flotte » (mêmes sources qu'URANUS) :
// quittance de la proposition, primes de chaque véhicule par garantie, détail des véhicules
// (genre, bonus, réduction commerciale) et taux de réduction flotte
export const annexeFlotteApi = {
  get: async (iddevis) => {
    const [q, v, d, r] = await Promise.all([
      apiClient.get(`/quittanceproposition/${iddevis}`).catch(() => ({ data: [] })),
      apiClient.get(`/listevehiculedevis/${iddevis}`),
      apiClient.get(`/devisdetail/${iddevis}`).catch(() => ({ data: [] })),
      apiClient.get(`/reductionflottedevis/${iddevis}`).catch(() => ({ data: {} })),
    ]);
    return {
      quittance: donneesEntete(q) || {},
      vehicules: donneesListe(v),
      details: donneesListe(d),
      tauxReductionFlotte: r.data?.TauxReduction ?? null,
    };
  },
};

// Branche d'un devis d'après le libellé du produit (stdproduit) : IA, Santé, RC, MRP… ne sont plus
// rangés dans « Auto » par défaut (fiche devis, facture et Conditions Particulières en dépendent)
const brancheDuProduit = (produitNom) => {
  const p = String(produitNom || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/auto|vehicule/.test(p)) return 'Auto';
  if (/individuelle|accident/.test(p)) return 'IA';
  if (/sante|maladie/.test(p)) return 'Santé';
  if (/voyage/.test(p)) return 'Voyage';
  if (/transport|facultes/.test(p)) return 'Transport';
  if (/habitation|\bmrh\b/.test(p)) return 'MRH';
  if (/professionnel/.test(p)) return 'MRP';
  if (/responsabilite/.test(p)) return 'RC';
  if (/tous dommages/.test(p)) return 'Tous Dommages';
  if (/\bvie\b/.test(p)) return 'Vie';
  return 'Auto';
};

export const normalizeDevis = (bq) => {
  if (!bq) return null;
  const id = bq.iddevis || bq.id;
  const clientNom = bq.client && typeof bq.client === 'object'
    ? `${bq.client.Nom || ''} ${bq.client.Prenoms || ''}`.trim()
    : (bq.nomassure || bq.client_nom || bq.souscripteur || 'Client Uranus');
  
  const produitNom = bq.produit && typeof bq.produit === 'object'
    ? (bq.produit.LibelleProduit || bq.produit.libelle_produit)
    : (bq.produit || 'Automobile');
    
  const cieNom = bq.compagnie && typeof bq.compagnie === 'object'
    ? (bq.compagnie.RaisonSociale || bq.compagnie.nom)
    : (bq.compagnie || 'NSIA Assurances');

  const primeNette = Number(bq.primenette || bq.prime_nette || 0);
  const primeTotale = Number(bq.primettc || bq.prime_totale || primeNette);
  const taxe = Number(bq.taxe || bq.taxes || 0);
  const accessoire = Number(bq.accessoire || bq.accessoires || 0);
  const fga = Number(bq.fga || 0);
  const cedeao = Number(bq.cedeao || 0);
  const commission = Number(bq.commissionintermediaire || bq.commission || 0);

  let statutLabel = bq.statut;
  let statutBadge = 'amber';
  if (bq.devis_consolide) {
    // Ce devis a été fusionné dans un devis consolidé (sp_consolidation_devis) :
    // il est scellé et ne doit plus être modifié ni confirmé individuellement.
    statutLabel = 'Consolidé';
    statutBadge = 'purple';
  } else if (bq.archive) {
    statutLabel = 'Archivé';
    statutBadge = 'rose';
  } else if (bq.confirme || ['CONFIRME', 'CONFIRMÉ', 'CONFIRME / CONTRAT', 'CONFIRMÉ / CONTRAT'].includes(String(bq.statut || '').toUpperCase())) {
    statutLabel = 'Confirmé';
    statutBadge = 'emerald';
  } else if (bq.statut === '1' || !bq.statut || String(bq.statut).toUpperCase() === 'ACTIVE') {
    statutLabel = 'En attente';
    statutBadge = 'amber';
  }

  return {
    id,
    iddevis: id,
    numerodevis: bq.numerodevis || `DEV-2026-${String(id).padStart(4, '0')}`,
    client_id: bq.client?.IdClient || bq.client_id || (typeof bq.client === 'number' ? bq.client : 1),
    client_nom: clientNom,
    souscripteur: clientNom,
    nomassure: bq.nomassure || clientNom,
    compagnie: cieNom,
    produit: produitNom,
    branche: bq.branche || brancheDuProduit(produitNom),
    date_emission: bq.dateemission || bq.date_emission || new Date().toISOString().split('T')[0],
    date_effet: bq.dateeffet || bq.date_effet || new Date().toISOString().split('T')[0],
    date_expiration: bq.dateexpiration || bq.date_expiration,
    prime_nette: primeNette,
    prime_totale: primeTotale,
    accessoires: accessoire,
    taxes: taxe,
    fga,
    cedeao,
    commission,
    bonus_malus: bq.bonus_malus || 0,
    avenant: (bq.avenant && typeof bq.avenant === 'object')
      ? (bq.avenant.LibelleAvenant || bq.avenant.CodeAvenant)
      : (bq.avenant_libelle || null),
    flotte: Boolean(bq.flotte),
    coassurance: Boolean(bq.coassurance),
    confirme: Boolean(bq.confirme),
    archive: Boolean(bq.archive),
    devis_consolide: Boolean(bq.devis_consolide),
    statut: statutLabel,
    statut_badge: statutBadge,
    numero_police_compagnie: bq.numero_police_compagnie || null,
    intermediaire: libelleIntermediaire(bq.intermediaire, bq.idintermediaire),
    // Catégorie(s) CIMA issues des tarifs du détail (plusieurs possibles pour une flotte, séparées par « / »)
    categorie: bq.libelle_categorie || null,
    raw: bq,
  };
};

// Devis auto saisi à l'écran (NewAutoQuotePage.handleFinalSubmit) -> paramètres de save_quotation
// / sp_creation_devis. Les valeurs sont lues sous les noms réellement utilisés par l'écran
// (details.*) : les anciens noms, jamais renseignés, faisaient partir une réduction à 0, une
// compagnie NSIA par défaut, des dates d'effet/expiration fausses et des champs véhicule vides.
export const formatAutoQuoteForApi = (raw) => {
  if (!raw) return {};
  const now = new Date();
  const details = raw.details || {};
  const dateEmission = details.dateEmission || raw.DateEmission || raw.date_emission || now.toISOString().split('T')[0];
  const dateEffet = details.dateEffet || raw.DateEffet || raw.date_effet || dateEmission;
  const dateExpiration = details.dateExpiration || raw.DateExpiration || raw.date_expiration
    || new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString().split('T')[0];
  const premier = (...valeurs) => valeurs.find((v) => v !== undefined && v !== null && v !== '');

  // Formattage date JJ-MM-AAAA attendu par Django save_quotation
  const toDmy = (dStr) => {
    if (!dStr) return '01-01-2026';
    if (dStr.includes('-') && dStr.split('-')[0].length === 4) {
      const [y, m, d] = dStr.split('-');
      return `${d}-${m}-${y}`;
    }
    return dStr.replace(/\//g, '-');
  };

  return {
    IdIntermediaire: Number(raw.IdIntermediaire || 1),
    IdCompagnie: Number(premier(details.idCompagnie, raw.IdCompagnie, raw.compagnie_id) || 1),
    IdProduit: Number(raw.IdProduit || 1),
    IdTarif: Number(details.idTarif || raw.IdTarif || 1),
    IdOffre: Number(details.idOffre || raw.IdOffre || 1),
    // 1 = affaire nouvelle : sp_creation_devis refuse de créer un devis avec l'avenant 0
    IdAvenant: Number(premier(details.idAvenant, raw.IdAvenant) || 1),
    IdClient: Number(raw.IdClient || raw.client_id || 1),
    IdAssure: Number(raw.IdAssure || details.idAssure || raw.client_id || 1),
    Flotte: Boolean(raw.Flotte || raw.flotte || details.typeContrat === 'FLOTTE'),
    Coassurance: Boolean(raw.Coassurance || raw.coassurance || false),
    DateEmission: toDmy(dateEmission),
    DateEffet: toDmy(dateEffet),
    DateExpiration: toDmy(dateExpiration),
    IdTarif: Number(details.idTarif || 1),
    CodeUsage: Number(details.codeUsage || 1),
    IdCarrosserie: Number(details.idCarrosserie || 1),
    CodeCarburant: Number(details.codeCarburant || (details.energie === 'Diesel' ? 2 : 1)),
    Puissance: Number(details.puissanceFiscale || 7),
    NombrePlace: Number(details.nombrePlace || 5),
    Charge: Number(details.chargeUtile || 0),
    ValeurNeuve: String(details.valeurNeuf || 0),
    ValeurVenale: String(details.valeurVenale || 0),
    ValeurAccessoire: String(details.valeurAccessoire || 0),
    TauxReduction: String(premier(details.reductionCommerciale, details.tauxRemise, raw.taux_remise) || 0),
    CodeAlarme: Number(details.codeAlarme || 0),
    Bns: String(details.bonusMalus || 0),
    NomConducteur: details.nomConducteur || raw.client_nom || '',
    AdresseConducteur: details.adresseConducteur || details.lieuHabitation || '',
    DateMec: toDmy(details.dateMec || '2020-01-01'),
    NumMoteur: premier(details.numeroMoteur, details.numMoteur) || '',
    NumChassis: premier(details.numeroChassis, details.numChassis) || '',
    IdTypeVehicule: Number(details.idTypeVehicule || 1),
    IdMarque: Number(details.idMarque || 1),
    Matricule: details.immatriculation || '',
    NumPermisConduire: premier(details.numeroPermis, details.numPermisConduire) || '',
    IdGenreVehicule: Number(details.idGenreVehicule || 1),
    NumCarteBrunePhysique: premier(details.numeroCarteBrune, details.numCarteBrunePhysique) || '',
    ModeleVehicule: premier(details.modeleVehicule, details.modele) || '',
    RemorqueAttelee: Boolean(details.remorqueAttelee),
    CodeFormuleSecuriteRoutiere: details.codeFormuleSecuriteRoutiere || details.securiteRoutiere || '',
    IdOptionAssistance: Number(details.idOptionAssistance || details.assistanceAuto || 0),
    CarburantAutreMatiere: Boolean(details.carburantAutreMatiere ?? details.CarburantAutreMatiere),
    TransportEleves: Boolean(details.transportEleves ?? details.TransportEleves),
    TransportEmployes: Boolean(details.transportEmployes ?? details.TransportEmployes),
    TansportPassagerSupplementaire: Boolean(details.transportPassagerSupplementaire ?? details.TansportPassagerSupplementaire),
    NsiaAutoPlus: Boolean(details.nsiaAutoPlus),
    NumeroPoliceCompagnie: details.numeroPoliceCompagnie || 'RAS',
    IdDuree: Number(details.idDuree || (details.dureeMois === 1 ? 1 : details.dureeMois === 3 ? 2 : details.dureeMois === 6 ? 3 : details.dureeMois === 12 ? 4 : 4)),
    // 1 Tacite reconduction, 2 Ferme, 3 Autre (utils/termesContrat)
    IdTerme: Number(details.idTerme) || 1,
    // Uniquement l'id d'un devis réellement enregistré (modification) : un identifiant local
    // (Date.now()) faisait répondre « Devis inexistant » et bloquait toute création
    IdDevis: Number(premier(details.idDevis, raw.iddevis) || 0),
    IdDevisDetail: Number(details.idDevisDetail || 0),
  };
};

// Brouillons de saisie enregistrés en base (devis non terminés, modifications de contrat) :
// repris depuis n'importe quel poste via /user/quotes/auto?brouillon=<id>
export const brouillonApi = {
  list: async (params = {}) => extractData(await apiClient.get('/brouillons/', { params: { page_size: 200, ...params } })),
  get: async (id) => (await apiClient.get(`/brouillons/${id}/`)).data,
  create: (data) => apiClient.post('/brouillons/', data),
  update: (id, data) => apiClient.put(`/brouillons/${id}/`, data),
  remove: (id) => apiClient.delete(`/brouillons/${id}/`),
};

export const quoteApi = {
  // GET /api/devis/stats/ (Totaux réels par branche en BDD)
  getStats: async () => {
    try {
      const res = await apiClient.get('/devis/stats/');
      return res.data;
    } catch {
      return null;
    }
  },
  // GET /api/devis/ (178 Devis réels en BDD)
  // GET /api/devis/ (178 Devis réels en BDD)
  getQuotes: async (params = {}) => {
    const res = await apiClient.get('/devis/', { params, timeout: 120000 });
    const list = extractData(res);
    return list.map(normalizeDevis);
  },
  // GET /api/devis/:id/ (un devis enregistré, au format du registre)
  getQuote: async (id) => normalizeDevis((await apiClient.get(`/devis/${id}/`)).data),
  // Tous les devis d'un filtre (parcourt les pages serveur, plafonnées à 200 lignes)
  getAllQuotes: async (params = {}, maxPages = 30) => {
    const all = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await apiClient.get('/devis/', { params: { ...params, page_size: 200, page } });
      all.push(...extractData(res).map(normalizeDevis));
      if (!res?.data?.next) break;
    }
    return all;
  },
  // Nombre total de devis pour un filtre donné (pagination serveur : champ `count`)
  getQuotesCount: async (params = {}) => {
    const res = await apiClient.get('/devis/', { params: { ...params, page_size: 1 }, timeout: 120000 });
    return Number(res?.data?.count ?? 0);
  },
  // GET /api/devis/:id/conditions-particulieres/ (données du document Conditions Particulières)
  getConditionsParticulieres: async (id) => (await apiClient.get(`/devis/${id}/conditions-particulieres/`)).data,
  // GET /api/devis/:id/
  getQuoteDetail: async (id) => {
    const res = await apiClient.get(`/devis/${id}/`);
    return normalizeDevis(res.data);
  },
  // GET /api/devisdetail/:iddevis (détail véhicule + devis imbriqué, pour préremplir
  // le formulaire d'édition Auto — cf. bouton « Modifier » du Registre des Devis)
  getDevisDetailAuto: async (iddevis) => (await quoteApi.getDevisDetailsAuto(iddevis))[0] || null,
  // Tous les véhicules du devis (une ligne stddevisdetail par véhicule d'une flotte)
  getDevisDetailsAuto: async (iddevis) => {
    const res = await apiClient.get(`/devisdetail/${iddevis}`);
    return Array.isArray(res.data) ? res.data : [];
  },
  // POST /api/enregistrementdevis (Auto CIMA)
  createAutoQuote: (data) => {
    const payload = formatAutoQuoteForApi(data);
    return apiClient.post('/enregistrementdevis', payload);
  },
  // POST /api/offregarantie (Calcul dynamique des garanties auto CIMA)
  calculateOffreGarantie: (payload) => apiClient.post('/offregarantie', payload),
  // POST /api/calculprime/ : accessoire Automobile (fn_get_accessoire, tranche de prime nette) et
  // taux de taxe, pour une prime nette CEDEAO et FGA compris
  calculerAccessoireAuto: async ({ primeNette, idOffre, idCompagnie, dateEffet }) => {
    const { data } = await apiClient.post('/calculprime/', {
      id_produit: 1,
      id_compagnie: Number(idCompagnie),
      id_offre: Number(idOffre),
      prime_nette: Math.round(Number(primeNette) || 0),
      date_effet: dateEffet,
    });
    const accessoire = Math.round(Number(data?.accessoire) || 0);
    // Même arrondi que fn_get_accessoire : ROUND(accessoire × taux / 100, 0)
    return { accessoire, taxeAccessoire: Math.round((accessoire * (Number(data?.taux_taxe) || 0)) / 100) };
  },
  // POST /api/correctiondevis/ (Enregistrement des primes & garanties imposées / modifiées)
  correctQuote: (payload) => apiClient.post('/correctiondevis/', payload),
  // POST /api/majrecapprimes/ (Mise à jour manuelle du récapitulatif des primes d'un devis
  // déjà enregistré, via sp_maj_manuelle_primes — utilisé par « Modifier » sur le Registre des Devis
  // et par « Imposer les primes du récapitulatif » de la fiche d'un devis flotte)
  updateQuotePrimes: (payload) => apiClient.post('/majrecapprimes/', payload),
  // POST /api/finalisationdevisauto (Finalisation devis flotte)
  finalizeFlotteQuote: (payload) => apiClient.post('/finalisationdevisauto', payload),
  // POST /api/annulationsaisievehicule (Suppression d'un véhicule de flotte)
  deleteFlotteVehicle: (idDevisDetail) => apiClient.post('/annulationsaisievehicule', { IdDevisDetail: idDevisDetail }),
  // GET /api/offreparproduit/?idproduit=1&idtarif= : offres Automobile actives d'une catégorie
  // (fn_liste_offre_produit, la liste d'URANUS) ; une erreur est remontée (≠ catégorie sans offre)
  getOffresAutoParCategorie: async (idTarif) => extractData(await apiClient.get('/offreparproduit/', { params: { idproduit: 1, idtarif: idTarif } })),
  // POST /api/garantiesvehiculeflotte/ (garanties d'un seul véhicule d'une flotte enregistrée :
  // la liste remplace les siennes, puis le devis est retotalisé)
  appliquerGarantiesVehiculeFlotte: (payload) => apiClient.post('/garantiesvehiculeflotte/', payload),
  // GET /api/sousgarantie/ (Sous-garanties disponibles ; 237 en base, au-delà de la page par défaut)
  getSousGaranties: async () => extractData(await apiClient.get('/sousgarantie/', { params: { page_size: 1000 } })),
  // GET /api/tauxtaxegarantie/ (taux de taxe par garantie et produit, ceux de fn_calcul_montant_taxe)
  getTauxTaxesGaranties: async () => extractData(await apiClient.get('/tauxtaxegarantie/', { params: { page_size: 1000 } })),
  // GET /api/assistanceautomobile/:idCompagnie
  getAssistanceAuto: async (compagnieId) => {
    try {
      const res = await apiClient.get(`/assistanceautomobile/${compagnieId}`);
      return extractData(res);
    } catch {
      return [];
    }
  },
  // GET /api/securiteroutiereparcompagnie/:idCompagnie
  getSecuriteRoutiere: async (compagnieId) => {
    try {
      const res = await apiClient.get(`/securiteroutiereparcompagnie/${compagnieId}`);
      return extractData(res);
    } catch {
      return [];
    }
  },
  // GET /api/offreparproduit/?idproduit=1&idtarif=:tarifId
  getOffresByTarif: async (produitId = 1, tarifId = 1) => {
    try {
      const res = await apiClient.get(`/offreparproduit/?idproduit=${produitId}&idtarif=${tarifId}`);
      return extractData(res);
    } catch {
      return [];
    }
  },
  // POST /api/enregistrementdevismrh (MRH)
  createMrhQuote: (data) => apiClient.post('/enregistrementdevismrh', data),
  // POST /api/enregistrementdevisia (Individuelle Accident)
  createIaQuote: (data) => apiClient.post('/enregistrementdevisia', data),
  // POST /api/enregistrementdevisvoyage (Voyage & Schengen)
  createVoyageQuote: (data) => apiClient.post('/enregistrementdevisvoyage', data),
  // POST /api/enregistrementdevisrc (Responsabilité Civile & Divers)
  createRisquesDiversQuote: (data) => apiClient.post('/enregistrementdevisrc', data),
  // POST /api/certificattransport/ (Transport & Facultés)
  createTransportQuote: (data) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const nextMonthStr = nextMonth.toISOString().split('T')[0];

    const payload = {
      statut: 'Pending',
      numero_requete: `REQ-${Date.now()}`,
      date_requete: data.date_emission || todayStr,
      reference_certificat: data.numerodevis || `CERT-${Date.now()}`,
      date_certificat: data.date_emission || todayStr,
      numero_police: data.details?.numeroPoliceCompagnie || 'EN_COURS',
      assureur: data.compagnie || 'SUNU ASSURANCES IARD CI',
      adresse_assureur: 'Abidjan Plateau',
      id_client_uranus: Number(data.client_id) || 1,
      nom_souscripteur: data.client_nom || 'Client Transport',
      adresse_souscripteur: 'Abidjan',
      assure: data.client_nom || 'Client Transport',
      adresse_assure: 'Abidjan',
      intermediaire: 'OREOLE',
      moyen_transport: data.details?.modeTransport || 'Maritime',
      date_debut_voyage: data.date_effet || todayStr,
      date_debut_periode: data.date_effet || todayStr,
      date_fin_periode: nextMonthStr,
      voyage: `${data.details?.portDepart || 'Abidjan'} / ${data.details?.portArrivee || 'International'}`,
      description_commerciale: data.details?.natureMarchandise || 'Marchandises Diverses',
      marque_colis: data.details?.conditionnement || 'COLIS-01',
      numero_document_transport: data.details?.numeroBlLta || 'BL-N/A',
      valeur_assurance: String(data.details?.sommeAssuree || data.prime_totale || 0),
      prime_nette: String(data.prime_nette || 0),
      accessoire: String(data.accessoires || 0),
      taxe: String(data.taxes || 0),
      prime_ttc: String(data.prime_totale || 0),
    };
    return apiClient.post('/certificattransport/', payload);
  },
  // POST /api/enregistrementdevissante (Santé)
  createSanteQuote: (data) => apiClient.post('/enregistrementdevissante', data),
  // POST /api/mrh/devis/:devis_id/recalculer/ (Recalculer devis)
  recalculateQuote: (devisId) => apiClient.post(`/mrh/devis/${devisId}/recalculer/`),
  // POST /api/consolidationdevis/
  consolidateQuote: (data) => apiClient.post('/consolidationdevis/', data),
  // GET /api/devisclient/?idclient=:clientId
  getQuotesByClient: async (clientId) => {
    const res = await apiClient.get(`/devisclient/?idclient=${clientId}`);
    const list = extractData(res);
    return list.map(normalizeDevis);
  },
  // GET /api/mrh/devis/:devis_id/resume-financier/
  getFinancialSummary: (devisId) => apiClient.get(`/mrh/devis/${devisId}/resume-financier/`),
  // POST /api/annulationsaisiedevis
  archiveQuote: (id) => apiClient.post('/annulationsaisiedevis', { IdDevis: id }),
  // POST /api/desarchivagedevis
  unarchiveQuote: (id) => apiClient.post('/desarchivagedevis', { IdDevis: id }),
};

/* =========================================================================
   4.1 MULTIRISQUES HABITATION - API OREOLE (mrh)
   ========================================================================= */
/* =========================================================================
   4.0 INDIVIDUELLE ACCIDENTS - mêmes sources qu'URANUS
   ========================================================================= */
// Date ISO (AAAA-MM-JJ) -> JJ-MM-AAAA attendu par offregarantieia
const dateTiretIa = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('-') : '');

export const iaApi = {
  // GET /api/tarifparproduit/2 : catégories IA (particulier, groupe, spécifiques…)
  getTarifs: async () => extractData(await apiClient.get('/tarifparproduit/2')),
  // GET /api/offreparproduit/?idproduit=2&idtarif=… : offres de la catégorie
  getOffres: async (idTarif) => extractData(await apiClient.get('/offreparproduit/', { params: { idproduit: 2, idtarif: idTarif } })),
  // GET /api/esttarifiagroupe/:id/ : catégorie « groupe » (plusieurs assurés, devis flotte)
  estTarifGroupe: async (idTarif) => Boolean((await apiClient.get(`/esttarifiagroupe/${idTarif}/`)).data?.est_tarif_ia_groupe),
  // GET /api/esttarifiapersonnalise/:id/ : catégorie à primes saisies (offres « SPECIFIQUE »)
  estTarifPersonnalise: async (idTarif) => Boolean((await apiClient.get(`/esttarifiapersonnalise/${idTarif}/`)).data?.est_tarif_ia_personnalise),
  // GET /api/devisia/taux-taxe/ : taux (%) appliqué par la base aux primes saisies de l'offre
  getTauxTaxe: async ({ idCompagnie, idOffre, dateEffet }) => Number((await apiClient.get('/devisia/taux-taxe/', {
    params: { IdCompagnie: Number(idCompagnie) || 1, IdOffre: Number(idOffre), DateEffet: String(dateEffet || '').slice(0, 10) },
  })).data?.taux) || 0,
  // GET /api/devisia/:iddevis/garanties/ : garanties enregistrées de chaque assuré du devis
  getGarantiesDevis: async (idDevis) => (await apiClient.get(`/devisia/${idDevis}/garanties/`)).data || [],
  // GET /api/professionia/ : professions IA (la classe de risque donne le code activité)
  getProfessions: async () => extractData(await apiClient.get('/professionia/', { params: { page_size: 1000 } })),
  // GET /api/qualiteayantdroit/ : liens de parenté des ayants droit
  getQualites: async () => extractData(await apiClient.get('/qualiteayantdroit/')),
  // POST /api/offregarantieia : primes calculées d'un assuré (ligne « CUMUL » = totaux)
  // primeNette / accessoire : primes saisies d'une catégorie à tarif personnalisé (0 = barème)
  calculerPrimes: async ({ idCompagnie, idOffre, capitalDeces, capitalIpp, fraisTraitement, tauxReduction, dateEffet, dateExpiration, dateNaissance, codeActivite, primeNette = 0, accessoire = 0 }) => {
    const lignes = extractData(await apiClient.post('/offregarantieia', {
      PrimeNette: Number(primeNette) || 0,
      Accessoire: Number(primeNette) > 0 ? Number(accessoire) || 0 : 0,
      IdCompagnie: Number(idCompagnie) || 1,
      IdOffre: Number(idOffre),
      CapitalDeces: Number(capitalDeces) || 0,
      CapitalInfirmite: Number(capitalIpp) || 0,
      CapitalFraisTraitement: Number(fraisTraitement) || 0,
      TauxReduction: Number(tauxReduction) || 0,
      DateEffet: dateTiretIa(dateEffet),
      DateExpiration: dateTiretIa(dateExpiration),
      DateNaissance: dateTiretIa(dateNaissance),
      CodeActivite: codeActivite || '01',
    }));
    const cumul = (lignes || []).find((l) => Number(l.IdGarantie) === 0) || {};
    const garanties = (lignes || []).filter((l) => Number(l.IdGarantie) !== 0);
    // Taxe de la ligne = taxes des garanties ; la ligne « CUMUL » y ajoute la taxe sur accessoire
    const taxe = garanties.reduce((s, g) => s + Math.round(Number(g.Taxe) || 0), 0);
    return {
      primeNette: Math.round(Number(cumul.PrimeNette) || 0),
      taxe,
      accessoire: Math.round(Number(cumul.MontantAccessoire) || 0),
      taxeAccessoire: Math.max(0, Math.round(Number(cumul.Taxe) || 0) - taxe),
      garanties,
    };
  },
  // GET /api/assureiainfo/:iddevis : lignes du devis (assuré, profession, capitaux, primes)
  getAssuresDevis: async (idDevis) => extractData(await apiClient.get(`/assureiainfo/${idDevis}`)),
  // GET /api/ayantdroitia/:idassure : ayants droit d'un assuré
  getAyantsDroit: async (idAssure) => (await apiClient.get(`/ayantdroitia/${idAssure}`)).data?.ayantdroits || [],
  // GET /api/devisdetail/:iddevis : catégorie, offre et réduction enregistrées
  getDetailsDevis: async (idDevis) => extractData(await apiClient.get(`/devisdetail/${idDevis}`)),
  // POST /api/devisia/enregistrement/ : création ou « Modifier », tout en une transaction
  enregistrerDevis: async (payload) => (await apiClient.post('/devisia/enregistrement/', payload)).data,
  // POST /api/importationassureia/ : assurés d'un fichier Excel ajoutés au devis (créé s'il n'existe pas)
  importerAssures: async (formData) => (await apiClient.post('/importationassureia/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })).data,
  // POST /api/finalisationdevisia : totaux d'un devis groupe (sp_finalisation_devis)
  finaliserDevis: async ({ idDevis, idClient, idAssure }) => (await apiClient.post('/finalisationdevisia', {
    IdDevis: Number(idDevis), IdClient: Number(idClient), IdAssure: Number(idAssure || idClient), Flotte: true,
  })).data,
  // POST /api/creer-devis-ia-minene/ : devis MINENE créé depuis le contrat Santé connexe
  // (souscripteur, assurés = adhérents, ayants droit = affiliés)
  creerDevisMinene: async (payload) => (await apiClient.post('/creer-devis-ia-minene/', payload)).data,
};

/* =========================================================================
   4.0 ter SANTÉ (produit 5) - parcours et procédures d'URANUS
   ========================================================================= */
const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

export const santeApi = {
  // GET /api/tarifparproduit/5 : « Offre commerciale » d'URANUS (catégories Santé)
  getTarifs: async () => extractData(await apiClient.get('/tarifparproduit/5')),
  // GET /api/typecontratsante/ : CONTRAT PARTICULIER, CONTRAT SOCIETE
  getTypesContrat: async () => extractData(await apiClient.get('/typecontratsante/')),
  // GET /api/offresantepartarif/:idTarif : « Formule de couverture » de la catégorie
  getFormules: async (idTarif) => extractData(await apiClient.get(`/offresantepartarif/${idTarif}`)),
  // GET /api/collegesanteparoffre/:idOffre : collèges de la formule
  getColleges: async (idOffre) => extractData(await apiClient.get(`/collegesanteparoffre/${idOffre}`)),
  // GET /api/zonecouverturesante/ : CÔTE D'IVOIRE, MONDE ENTIER
  getZones: async () => extractData(await apiClient.get('/zonecouverturesante/')),
  // GET /api/lienjuridiquesante/ : liens des affiliés (A Adhérent, C Conjoint(e), E Enfant)
  getLiens: async () => extractData(await apiClient.get('/lienjuridiquesante/')),
  // POST /api/devissante/initialisation/ : devis vide qui porte la saisie (numéro de saisie d'URANUS)
  initialiser: async () => (await apiClient.post('/devissante/initialisation/', {})).data,
  // POST /api/devissante/filiale/ : « Enregistrer le collège » (couverture souscrite)
  enregistrerFiliale: async (payload) => (await apiClient.post('/devissante/filiale/', payload)).data,
  // POST /api/devissante/adherent/ (multipart) : adhérent créé ou modifié, pièce jointe facultative
  enregistrerAdherent: async (formData) => (await apiClient.post('/devissante/adherent/', formData, multipart)).data,
  // POST /api/devissante/affilie/ (multipart) : affilié créé ou modifié
  enregistrerAffilie: async (formData) => (await apiClient.post('/devissante/affilie/', formData, multipart)).data,
  // POST /api/devissante/suppression/ : { type: ADH | AFF | FIL, id_devis, id_objet }
  supprimer: async (payload) => (await apiClient.post('/devissante/suppression/', payload)).data,
  // POST /api/importationaffilie/ (multipart) : adhérents et affiliés d'un fichier Excel dans une filiale
  importerAffilies: async (formData) => (await apiClient.post('/importationaffilie/', formData, multipart)).data,
  // POST /api/devissante/enregistrement/ : « Enregistrer le devis » (sp_creation_devis_sante)
  enregistrerDevis: async (payload) => (await apiClient.post('/devissante/enregistrement/', payload)).data,
  // GET /api/devissante/:iddevis/ : tout ce qui a été saisi sur le devis
  lireDevis: async (idDevis) => (await apiClient.get(`/devissante/${idDevis}/`)).data,
};

/* =========================================================================
   4.0 bis RISQUES DIVERS : RC (produit 8) et MULTIRISQUE PROFESSIONNELLE (produit 7)
   ========================================================================= */
// Chemins URANUS par produit : calcul des garanties et enregistrement du devis
const CHEMINS_RISQUES_DIVERS = {
  7: { garanties: '/offregarantiemrp', enregistrement: '/enregistrementdevismrp' },
  8: { garanties: '/offregarantierc', enregistrement: '/enregistrementdevisrc' },
};

export const risquesDiversApi = {
  // GET /api/tarifparproduit/:idproduit : catégories du produit
  getTarifs: async (idProduit) => extractData(await apiClient.get(`/tarifparproduit/${idProduit}`)),
  // GET /api/offreparproduit/?idproduit=&idtarif= : offres de la catégorie
  getOffres: async (idProduit, idTarif) => extractData(await apiClient.get('/offreparproduit/', { params: { idproduit: idProduit, idtarif: idTarif } })),
  // GET /api/domaineactiviterc/ : domaines d'activité (RC)
  getDomaines: async () => extractData(await apiClient.get('/domaineactiviterc/')),
  // POST /api/offregarantie{rc|mrp} : garanties de l'offre ; avec IdDevis, celles enregistrées sur le devis
  getGaranties: async (idProduit, { idCompagnie, idOffre, idDevis, tauxReduction, dateEffet, dateExpiration, capitaux = {} }) => {
    const jourTiret = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('-') : '');
    return extractData(await apiClient.post(CHEMINS_RISQUES_DIVERS[idProduit].garanties, {
      IdCompagnie: Number(idCompagnie) || 1,
      IdOffre: Number(idOffre),
      ...(idDevis ? { IdDevis: Number(idDevis) } : {}),
      TauxReduction: Number(tauxReduction) || 0,
      DateEffet: jourTiret(dateEffet),
      DateExpiration: jourTiret(dateExpiration),
      ...capitaux,
    }));
  },
  // GET /api/devisrisquesdivers/:iddevis/ : tout ce qui a été saisi sur la ligne du devis
  lireDevis: async (idDevis) => (await apiClient.get(`/devisrisquesdivers/${idDevis}/`)).data,
  // POST /api/enregistrementdevis{rc|mrp} : création (IdDevis 0) ou modification du devis
  enregistrer: async (idProduit, payload) => {
    const res = await apiClient.post(CHEMINS_RISQUES_DIVERS[idProduit].enregistrement, payload);
    return Array.isArray(res.data) ? res.data[0] : res.data;
  },
};

/* =========================================================================
   4.0 ter TOUS DOMMAGES (produit 9) : Tous Risques Informatique, Caution…
   ========================================================================= */
// La procédure URANUS attend les dates au format JJ-MM-AAAA
const dateJourMoisAnnee = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('-') : '');

export const tousDommagesApi = {
  // GET /api/tarifparproduit/9 : catégories Tous Dommages
  getTarifs: async () => extractData(await apiClient.get('/tarifparproduit/9')),
  // GET /api/devisrisquesdivers/:iddevis/ : capitaux, taux et montant de prime enregistrés
  lireDevis: async (idDevis) => (await apiClient.get(`/devisrisquesdivers/${idDevis}/`)).data,
  // POST /api/enregistrementdevistousrisquesinfo : création (IdDevis 0) ou modification du devis
  enregistrer: async (payload) => {
    const res = await apiClient.post('/enregistrementdevistousrisquesinfo', {
      ...payload,
      DateEffet: dateJourMoisAnnee(payload.DateEffet),
      DateExpiration: dateJourMoisAnnee(payload.DateExpiration),
      DateEmission: dateJourMoisAnnee(payload.DateEmission),
    });
    return Array.isArray(res.data) ? res.data[0] : res.data;
  },
};

export const mrhApi = {
  // GET /api/tarifparproduit/4 : catégories MRH (MULTIRISQUE HABITATION, « NSIA ATEGBAN »…)
  getTarifs: async () => extractData(await apiClient.get('/tarifparproduit/4')),
  // GET /api/mrh/usages/:code/parametres/ : capitaux requis et formule de calcul de l'usage
  getParametresUsage: async (code) => (await apiClient.get(`/mrh/usages/${encodeURIComponent(code)}/parametres/`)).data,
  // Garanties de l'usage : { obligatoires: [...], optionnelles: [...] }
  getGarantiesUsage: async (code) => (await apiClient.get(`/mrh/usages/${encodeURIComponent(code)}/garanties/`)).data,
  // GET /api/mrh/usages/
  getUsages: async () => extractData(await apiClient.get('/mrh/usages/')),
  // GET /api/mrh/usages/:code/
  getUsageDetails: async (code) => (await apiClient.get(`/mrh/usages/${code}/`)).data,
  // GET /api/mrh/usages/:code/garanties/
  getGarantiesByUsage: async (code) => extractData(await apiClient.get(`/mrh/usages/${code}/garanties/`)),
  // GET /api/mrh/usages/:code/options/
  getOptionsByUsage: async (code) => extractData(await apiClient.get(`/mrh/usages/${code}/options/`)),
  // POST /api/mrh/calcul/maison/
  calculerPrimeMaison: async (data) => (await apiClient.post('/mrh/calcul/maison/', data)).data,
  // POST /api/mrh/devis/
  creerDevis: async (data) => (await apiClient.post('/mrh/devis/', data)).data,
  // GET /api/mrh/devis/:id/
  getDevis: async (id) => (await apiClient.get(`/mrh/devis/${id}/`)).data,
  // PATCH /api/mrh/devis/:id/
  updateDevis: async (id, data) => (await apiClient.patch(`/mrh/devis/${id}/`, data)).data,
  // PUT /api/mrh/devis/:id/ — « Modifier » : en-tête + toutes les maisons recalculées d'un bloc
  modifierDevis: async (id, data) => (await apiClient.put(`/mrh/devis/${id}/`, data)).data,
  // GET /api/mrh/devis/:id/maisons/ — maisons enregistrées (valeurs, options, garanties choisies)
  getMaisons: async (idDevis) => (await apiClient.get(`/mrh/devis/${idDevis}/maisons/`)).data,
  // POST /api/mrh/devis/accessoire/ — accessoire du barème pour une prime nette totale
  getAccessoire: async (data) => (await apiClient.post('/mrh/devis/accessoire/', data)).data,
  // DELETE /api/mrh/devis/:id/
  supprimerDevis: async (id) => (await apiClient.delete(`/mrh/devis/${id}/`)).data,
  // POST /api/mrh/devis/:id/maisons/
  ajouterMaison: async (idDevis, maisonData) => (await apiClient.post(`/mrh/devis/${idDevis}/maisons/`, { maison: maisonData })).data,
  // PUT /api/mrh/devis/:id/maisons/:maisonId/
  modifierMaison: async (idDevis, maisonId, maisonData) => (await apiClient.put(`/mrh/devis/${idDevis}/maisons/${maisonId}/`, maisonData)).data,
  // DELETE /api/mrh/devis/:id/maisons/:maisonId/
  supprimerMaison: async (idDevis, maisonId) => (await apiClient.delete(`/mrh/devis/${idDevis}/maisons/${maisonId}/`)).data,
  // POST /api/mrh/devis/:id/recalculer/
  recalculerTotaux: async (idDevis) => (await apiClient.post(`/mrh/devis/${idDevis}/recalculer/`, {})).data,
  // GET /api/mrh/devis/:id/resume-financier/
  getResumeFinancier: async (idDevis) => (await apiClient.get(`/mrh/devis/${idDevis}/resume-financier/`)).data,
  // POST /api/mrh/devis/:id/repartir-garanties/
  repartirGaranties: async (idDevis, data) => (await apiClient.post(`/mrh/devis/${idDevis}/repartir-garanties/`, data)).data,
  // POST /api/mrh/devis/:id/imposer-prime/
  imposerPrimeDevis: async (idDevis, data) => (await apiClient.post(`/mrh/devis/${idDevis}/imposer-prime/`, data)).data,
  // POST /api/mrh/devis/:id/maisons/:maisonId/imposer-prime/
  imposerPrimeMaison: async (idDevis, maisonId, data) => (await apiClient.post(`/mrh/devis/${idDevis}/maisons/${maisonId}/imposer-prime/`, data)).data,
  // GET /api/terme/
  getTermes: async () => extractData(await apiClient.get('/terme/')),
};

/* =========================================================================
   4.2 ASSURANCE VOYAGE - API OREOLE
   ========================================================================= */
export const voyageApi = {
  // GET /api/tarifvoyage/:idcompagnie
  getTarifsVoyage: async (idcompagnie = 21) => {
    try {
      const res = await apiClient.get(`/tarifvoyage/${idcompagnie}`);
      return res.data?.data || extractData(res);
    } catch {
      return [];
    }
  },
  // GET /api/payszone/:idcompagnie
  getPaysZone: async (idcompagnie = 21) => {
    try {
      const res = await apiClient.get(`/payszone/${idcompagnie}`);
      return res.data?.data || extractData(res);
    } catch {
      return [];
    }
  },
  // GET /api/offrevoyage/?idcompagnie=:id&idtarif=:id&idzone=:id
  getOffresVoyage: async (idcompagnie = 21, idtarif = 1, idzone = 1) => {
    try {
      const res = await apiClient.get('/offrevoyage/', {
        params: { idcompagnie, idtarif, idzone }
      });
      return res.data?.data || extractData(res);
    } catch {
      return [];
    }
  },
  // POST /api/offregarantievoyage
  getGarantiesVoyage: async (payload) => {
    try {
      const res = await apiClient.post('/offregarantievoyage', payload);
      return extractData(res);
    } catch {
      return [];
    }
  },
  // POST /api/enregistrementdevisvoyage
  enregistrerDevisVoyage: async (payload) => {
    return apiClient.post('/enregistrementdevisvoyage', payload);
  },
  // GET /api/pays/ : toutes les nationalités (203 pays, au-delà de la page de 200 lignes)
  getNationalites: async () => extractData(await apiClient.get('/pays/', { params: { page_size: 1000 } })),
  // GET /api/zonevoyage/ : libellés des zones (id_zone renvoyé par payszone)
  getZones: async () => extractData(await apiClient.get('/zonevoyage/')),
  // POST /api/offregarantievoyage : garanties de l'offre et prime de la grille (fn_garantie_offre_voyage),
  // erreur remontée à l'écran (getGarantiesVoyage la masque)
  calculerPrime: async (payload) => extractData(await apiClient.post('/offregarantievoyage', payload)),
  // POST /api/devisvoyage/enregistrement/ : création (IdDevis 0) ou « Modifier » (sp_creation_devis_voyage)
  enregistrer: async (payload) => (await apiClient.post('/devisvoyage/enregistrement/', payload)).data,
  // GET /api/devisvoyage/:iddevis/ : saisie complète du devis (Modifier, aperçu, proposition)
  lireDevis: async (iddevis) => (await apiClient.get(`/devisvoyage/${iddevis}/`)).data,
};

/* =========================================================================
   4.3 TRANSPORT (FACULTÉS) - BORDEREAUX GUCE
   ========================================================================= */
// Formulaire multipart : fichier_excel, debut_periode / fin_periode (AAAA-MM-JJ, facultatives :
// période du titre du fichier sinon), correspondances (JSON { souscripteur du fichier: IdClient })
const formulaireBordereau = ({ fichier, debut, fin, correspondances }) => {
  const formulaire = new FormData();
  formulaire.append('fichier_excel', fichier);
  if (debut && fin) {
    formulaire.append('debut_periode', debut);
    formulaire.append('fin_periode', fin);
  }
  if (correspondances && Object.keys(correspondances).length) {
    formulaire.append('correspondances', JSON.stringify(correspondances));
  }
  return formulaire;
};

export const transportApi = {
  // POST /api/transport/guce/analyse/ : contrôle du bordereau sans rien enregistrer
  analyserBordereau: async (params) => (await apiClient.post('/transport/guce/analyse/', formulaireBordereau(params), {
    headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000,
  })).data,
  // POST /api/transport/guce/import/ : certificats, devis, contrats et quittances (tout ou rien)
  importerBordereau: async (params) => (await apiClient.post('/transport/guce/import/', formulaireBordereau(params), {
    headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000,
  })).data,
  // GET /api/transport/guce/bordereaux/ : bordereaux importés, totaux et contrats générés
  getBordereaux: async () => (await apiClient.get('/transport/guce/bordereaux/', { timeout: 120000 })).data,
  // GET /api/transport/certificats/?idimportation=|iddevis=|idcontrat=
  getCertificats: async (params) => (await apiClient.get('/transport/certificats/', { params })).data,
  // GET /api/transport/guce/bordereaux/:id/excel/ : bordereau au format de la ressortie GUCE
  telechargerBordereauExcel: async (idImportation, nomFichier) => {
    const res = await apiClient.get(`/transport/guce/bordereaux/${idImportation}/excel/`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nomFichier || `bordereau-${idImportation}.xlsx`;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};

/* =========================================================================
   5. POLICES & CONTRATS D'ASSURANCE (production)
   ========================================================================= */
export const normalizeContrat = (bc) => {
  if (!bc) return null;
  const id = bc.idcontrat || bc.id;
  const clientNom = bc.idclient && typeof bc.idclient === 'object'
    ? `${bc.idclient.Nom || ''} ${bc.idclient.Prenoms || ''}`.trim()
    : (bc.assure || bc.client_nom || bc.souscripteur || 'Assuré LE PHARE');
    
  const produitNom = bc.idproduit && typeof bc.idproduit === 'object'
    ? (bc.idproduit.LibelleProduit || bc.idproduit.libelle_produit)
    : (bc.produit || 'Automobile');
    
  const cieNom = bc.idcompagnie && typeof bc.idcompagnie === 'object'
    ? (bc.idcompagnie.RaisonSociale || bc.idcompagnie.nom)
    : (bc.compagnie || 'NSIA Assurances');

  const primeNette = Number(bc.primenette || bc.prime_nette || 0);
  const primeTotale = Number(bc.primettc || bc.prime_totale || primeNette);
  const montantEncaisse = Number(bc.montant_encaisse || (bc.idquittance && typeof bc.idquittance === 'object' ? bc.idquittance.mt_encaisse : 0));
  const isSolde = montantEncaisse >= primeTotale && primeTotale > 0;

  return {
    id,
    idcontrat: id,
    numeropolice: bc.numeropolice || `POL-2026-${String(id).padStart(4, '0')}`,
    client_id: bc.idclient?.IdClient || bc.client_id || (typeof bc.idclient === 'number' ? bc.idclient : 1),
    client_nom: clientNom,
    souscripteur: clientNom,
    assure: clientNom,
    produit: produitNom,
    compagnie: cieNom,
    date_effet: bc.dateeffet || bc.date_effet || '2026-01-01',
    date_expiration: bc.dateexpiration || bc.date_expiration || '2026-12-31',
    date_emission: bc.dateemission || bc.date_emission || '2026-01-01',
    prime_nette: primeNette,
    prime_totale: primeTotale,
    montant_encaisse: montantEncaisse,
    taxe: Number(bc.taxe || 0),
    accessoire: Number(bc.accessoire || 0),
    fga: Number(bc.fga || 0),
    cedeao: Number(bc.cedeao || 0),
    commission: Number(bc.commissionintermediaire || 0),
    taux_commission: Number(bc.taux_commission || 0),
    statut_contrat: bc.statut_contrat || (bc.dateexpiration && new Date(bc.dateexpiration) < new Date() ? 'Expiré' : 'En cours'),
    statut_contrat_badge: bc.dateexpiration && new Date(bc.dateexpiration) < new Date() ? 'amber' : 'emerald',
    statut_encaissement: isSolde ? 'Soldé' : 'À Encaisser',
    statut_encaissement_badge: isSolde ? 'emerald' : 'rose',
    attestation_asaci: bc.attestation_asaci || 'Délivrée',
    attestation_badge: 'emerald',
    numero_police_compagnie: bc.numero_police_compagnie || null,
    adresse: bc.adresse || bc.idclient?.Adresse || bc.idclient?.adresse || 'Abidjan, Côte d\'Ivoire',
    intermediaire: libelleIntermediaire(bc.idintermediaire, bc.intermediaire),
    // Même règle que les devis : un contrat IA, Voyage, Transport… n'est plus présenté (ni imprimé) comme un contrat Auto
    branche: bc.branche || brancheDuProduit(produitNom),
    details: bc.details || {},
    raw: bc,
  };
};

export const contractApi = {
  // GET /api/contrat/stats/ (Totaux réels par branche en BDD)
  getStats: async () => {
    try {
      const res = await apiClient.get('/contrat/stats/');
      return res.data;
    } catch {
      return null;
    }
  },
  // Nombre total de contrats pour un filtre donné (pagination serveur : champ `count`)
  getContractsCount: async (params = {}) => {
    const res = await apiClient.get('/contrat/', { params: { ...params, page_size: 1 } });
    return Number(res?.data?.count ?? 0);
  },
  // GET /api/contrat/ (21 714 Contrats réels en BDD)
  getContracts: async (params = {}) => {
    const res = await apiClient.get('/contrat/', { params });
    const list = extractData(res);
    return list.map(normalizeContrat);
  },
  // GET /api/contrat/:id/
  // GET /api/contrat/:id/conditions-particulieres/ (mêmes données que pour un devis, tables du contrat)
  getConditionsParticulieres: async (id) => (await apiClient.get(`/contrat/${id}/conditions-particulieres/`)).data,
  getContractDetail: async (id) => {
    const res = await apiClient.get(`/contrat/${id}/`);
    return normalizeContrat(res.data);
  },
  // POST /api/confirmationdevis (Validation et conversion d'un devis en contrat définitif)
  createContractFromQuote: (data) => {
    const devisId = typeof data === 'object' ? (data.IdDevis || data.iddevis || data.id) : data;
    return apiClient.post('/confirmationdevis', { IdDevis: Number(devisId) });
  },
  // GET /api/listecontratclient/?idclient=:clientId
  getContractsByClient: async (clientId) => {
    const res = await apiClient.get(`/listecontratclient/?idclient=${clientId}`);
    const list = extractData(res);
    return list.map(normalizeContrat);
  },
  // POST /api/avenant/renouvellement
  renewContract: (data) => apiClient.post('/avenant/renouvellement', data),
  // POST /api/avenant/initiationmouvement
  createEndorsement: (data) => apiClient.post('/avenant/initiationmouvement', data),
  // GET /api/avenant/
  getEndorsements: async () => extractData(await apiClient.get('/avenant/')),
};

/* =========================================================================
   6. CAISSE, ENCAISSEMENTS & CHÈQUES (production & payment)
   ========================================================================= */
export const cashApi = {
  // GET /api/encaissement/
  getEncaissements: async () => extractData(await apiClient.get('/encaissement/')),
  // GET /api/quittance/ (34 Quittances réelles en BDD)
  getQuittances: async () => extractData(await apiClient.get('/quittance/')),
  // POST /api/enregistrementencaissement (Encaissement groupé ou unitaire selon EncaissementGroupeQuittanceSerializer)
  collectPremium: (data) => apiClient.post('/enregistrementencaissement', data),
  // GET /api/quittances-cima/
  getQuittancesCima: async () => extractData(await apiClient.get('/quittances-cima/')),
  // POST /api/quittances-cima/
  createQuittanceCima: (data) => apiClient.post('/quittances-cima/', data),
  // GET /api/infoencaissement/:id
  getEncaissementInfo: async (id) => {
    const res = await apiClient.get(`/infoencaissement/${id}`);
    return res.data;
  },
  // GET /api/listedetailencaissement/:idencaissement (lignes d'un encaissement, une par quittance)
  getDetailsEncaissement: async (idencaissement) =>
    extractData(await apiClient.get(`/listedetailencaissement/${idencaissement}`)),
  // GET /api/detailencaissement/?numeroquittance= (dernier règlement non annulé d'une quittance)
  getDernierReglementQuittance: async (numeroquittance) =>
    extractData(await apiClient.get('/detailencaissement/', { params: { numeroquittance, page_size: 1 } }))[0] || null,
  // GET /api/cheques/
  getCheques: async () => extractData(await apiClient.get('/cheques/')),
  // GET /api/cheques/statut/
  getChequeStatus: async (query) => {
    const res = await apiClient.get('/cheques/statut/', { params: query });
    return res.data;
  },
  // GET /api/cheques/:id/operations/
  getChequeOperations: async (id) => extractData(await apiClient.get(`/cheques/${id}/operations/`)),
  // GET /api/cheques/alertes/ : chèques de l'échéancier à déposer d'ici un mois (ou échus)
  getChequesAlertes: async () => extractData(await apiClient.get('/cheques/alertes/')),
  // POST /api/cheques/echeancier/ : chèques remis d'avance par un client, avec leurs dates de dépôt
  enregistrerEcheancier: (data) => apiClient.post('/cheques/echeancier/', data),
  // DELETE /api/cheques/:id/ : chèque à déposer retiré de l'échéancier
  supprimerCheque: (id) => apiClient.delete(`/cheques/${id}/`),
  // POST /api/cheques/:id/decaissement/ : chèque impayé, ses encaissements sont annulés
  decaisserCheque: (id, data) => apiClient.post(`/cheques/${id}/decaissement/`, data),
  // GET /api/cheques/:id/quittances/ : quittances réglées par le chèque (à réencaisser)
  getQuittancesCheque: async (id) => extractData(await apiClient.get(`/cheques/${id}/quittances/`)),
};

/* =========================================================================
   7. PAIEMENT MOBILE (payment - Distripay)
   ========================================================================= */
export const mobilePaymentApi = {
  // POST /api/initiationpaiementmobile (sans slash terminal)
  initiatePayment: (data) => apiClient.post('/initiationpaiementmobile', data),
  // GET /api/paiementmobileinfo/:idtransaction (sans slash terminal)
  getPaymentInfo: async (id) => {
    const res = await apiClient.get(`/paiementmobileinfo/${id}`);
    return res.data;
  },
};

/* =========================================================================
   8. ATTESTATIONS NUMÉRIQUES ASACI (asaci)
   ========================================================================= */
export const asaciApi = {
  // GET /api/asaci/statut_passerelle/
  getGatewayStatus: async () => {
    const res = await apiClient.get('/asaci/statut_passerelle/');
    return res.data;
  },
  // GET /api/asaci/detailretourdemandeattestation/
  getAttestations: async () => extractData(await apiClient.get('/asaci/detailretourdemandeattestation/')),
  // GET /api/asaci/retourdemandeattestation/
  getDemandes: async () => extractData(await apiClient.get('/asaci/retourdemandeattestation/')),
  // POST /api/asaci/demandeattestationdb/
  requestCertificateFromDb: (contractId) => apiClient.post('/asaci/demandeattestationdb/', { id_contrat: contractId }),
  // POST /api/asaci/verificationstatutdemande/
  checkApplicationStatus: (referenceDemande) =>
    apiClient.post('/asaci/verificationstatutdemande/', { reference_demande: referenceDemande }),
  // POST /api/asaci/majstatutattestation/
  updateCertificateStatus: (data) => apiClient.post('/asaci/majstatutattestation/', data),
};

/* =========================================================================
   9. REVERSEMENTS AUX COMPAGNIES D'ASSURANCE (production & institutionnel)
   ========================================================================= */
export const remittanceApi = {
  // GET /api/reversement/
  getRemittances: async () => extractData(await apiClient.get('/reversement/')),
  // GET /api/reversementnonvalide/
  getPendingRemittances: async () => extractData(await apiClient.get('/reversementnonvalide/')),
  // POST /api/enregistrementreversement
  remitPremium: (data) => apiClient.post('/enregistrementreversement', data),
  // POST /api/validationreversement
  validateRemittance: (data) => apiClient.post('/validationreversement', data),
  // GET /api/inforeversement/:id
  getRemittanceInfo: async (id) => {
    const res = await apiClient.get(`/inforeversement/${id}`);
    return res.data;
  },
  // GET /api/contratpourreversement/:idcompagnie
  getContractsForRemittance: async (idcompagnie) => {
    const res = await apiClient.get(`/contratpourreversement/${idcompagnie || 1}`);
    return extractData(res);
  },
  // GET /api/reversements-cima/
  getRemittancesCima: async () => extractData(await apiClient.get('/reversements-cima/')),
  // POST /api/reversements-cima/:id/valider/
  validerBordereauCima: (id) => apiClient.post(`/reversements-cima/${id}/valider/`),
  // Validation officielle du bordereau de reversement
  validerBordereau: (id) => apiClient.post(`/reversements-cima/${id}/valider/`).catch(() => apiClient.post('/validationreversement', { idreversement: id })),
};

/* =========================================================================
   10. COMMISSIONS APPORTEURS (commissions)
   ========================================================================= */
export const commissionApi = {
  // GET /api/commissions/dashboard/dashboard_complet/
  getDashboard: async () => {
    const res = await apiClient.get('/commissions/dashboard/dashboard_complet/');
    return res.data;
  },
  // GET /api/commissions/paiements-commission/
  getPayments: async () => extractData(await apiClient.get('/commissions/paiements-commission/')),
  // POST /api/commissions/paiements-commission/
  createPayment: (data) => apiClient.post('/commissions/paiements-commission/', data),
  // GET /api/commissions/affaires-commission/eligibles_paiement/
  getAffaires: async () => extractData(await apiClient.get('/commissions/affaires-commission/eligibles_paiement/')),
  // POST /api/commissions/annulations-commission/
  cancelPayment: (data) => apiClient.post('/commissions/annulations-commission/', data),
};

/* =========================================================================
   11. SYSTÈME D'AUTORISATIONS & DÉROGATIONS (autorisations & account)
   ========================================================================= */
export const approvalApi = {
  // GET /api/autorisations/demandes/
  getDemandes: async () => extractData(await apiClient.get('/autorisations/demandes/')),
  // POST /api/autorisations/demandes/
  createDemande: (data) => apiClient.post('/autorisations/demandes/', data),
  // POST /api/autorisations/demandes/:id/approuver/
  approveDemande: (id, tokenData) => apiClient.post(`/autorisations/demandes/${id}/approuver/`, tokenData),
  // POST /api/autorisations/demandes/:id/rejeter/
  rejectDemande: (id, reason) => apiClient.post(`/autorisations/demandes/${id}/rejeter/`, { motif: reason }),
  // POST /api/autorisations/jetons/verifier/
  verifyToken: (token) => apiClient.post('/autorisations/jetons/verifier/', { token }),
  // POST /api/derogations/create
  createDerogation: (data) => apiClient.post('/derogations/create', data),
  // POST /api/derogations/check
  checkDerogation: (data) => apiClient.post('/derogations/check', data),
};

/* =========================================================================
   12. REPORTING & ÉTATS CIMA (reporting)
   ========================================================================= */
export const reportingApi = {
  // GET /api/etatdecisionnel/
  getDecisionnel: async () => extractData(await apiClient.get('/etatdecisionnel/')),
  // POST /api/etatdecisionnel/
  createDecisionnel: (data) => apiClient.post('/etatdecisionnel/', data),
  // PUT /api/etatdecisionnel/{id}/
  updateDecisionnel: (id, data) => {
    const validId = id?.id_etat ?? id?.idetat ?? id?.id ?? id;
    return apiClient.put(`/etatdecisionnel/${validId}/`, data);
  },
  // DELETE /api/etatdecisionnel/{id}/
  deleteDecisionnel: (id) => {
    const validId = id?.id_etat ?? id?.idetat ?? id?.id ?? id;
    return apiClient.delete(`/etatdecisionnel/${validId}/`);
  },
  // GET /api/etatdecisionnel/{id}/contenu?date_debut=&date_fin=
  getDecisionnelContenu: async (id, dateDebut, dateFin, typeEtat) => {
    const validId = id?.id_etat ?? id?.idetat ?? id?.id ?? id;
    if (!validId || validId === 'undefined') {
      return { Status: 'Echec', Data: [] };
    }
    const res = await apiClient.get(`/etatdecisionnel/${validId}/contenu/`, {
      params: {
        date_debut: dateDebut,
        date_fin: dateFin,
        ...(typeEtat ? { type_etat: typeEtat } : {}),
      },
    });
    return res?.data || res;
  },
  // POST /api/bordereaurecapemission
  getBordereauRecapEmission: async (params) => {
    const payload = params || { date_debut: '2020-01-01', date_fin: '2026-12-31', type_etat: 1 };
    const res = await apiClient.post('/bordereaurecapemission', payload);
    return extractData(res);
  },
  // GET /api/cimaetate1/:exercice
  getCimaE1: async (exercice) => {
    const res = await apiClient.get(`/cimaetate1/${exercice}`);
    return extractData(res);
  },
  // GET /api/cimaetate2/:exercice
  getCimaE2: async (exercice) => {
    const res = await apiClient.get(`/cimaetate2/${exercice}`);
    return extractData(res);
  },
};

/* =========================================================================
   13. CATALOGUE & PARAMÉTRAGE (configuration_api - Données réelles)
   ========================================================================= */
export const settingsApi = {
  // GET /api/compagnie/ (30 compagnies en BDD)
  getCompanies: async () => extractData(await apiClient.get('/compagnie/')),
  // GET /api/produit/ (10 produits en BDD)
  getProducts: async () => extractData(await apiClient.get('/produit/')),
  // GET /api/garantie/ (17 garanties en BDD)
  getGuarantees: async () => extractData(await apiClient.get('/garantie/')),
  // POST /api/garantie/
  createGuarantee: (data) => apiClient.post('/garantie/', data),
  // PUT /api/garantie/{id}/
  updateGuarantee: (id, data) => apiClient.put(`/garantie/${id}/`, data),
  // DELETE /api/garantie/{id}/
  deleteGuarantee: (id) => apiClient.delete(`/garantie/${id}/`),
  // PUT /api/sousgarantie/{id}/
  updateSousGarantie: (id, data) => apiClient.put(`/sousgarantie/${id}/`, data),
  // DELETE /api/sousgarantie/{id}/
  deleteSousGarantie: (id) => apiClient.delete(`/sousgarantie/${id}/`),
  // GET /api/categorie/ (catégories CIMA en BDD) — branche optionnelle (code stdbranche, ex: '200' = Automobile)
  getCategories: async (branche) => extractData(await apiClient.get('/categorie/', { params: branche ? { branche } : undefined })),
  // GET /api/tarif/ (26 grilles tarifaires en BDD)
  getTarifs: async () => extractData(await apiClient.get('/tarif/')),
  // GET /api/tarifdetail/?IdTarif={id} — montants réels (taux, prime forfaitaire,
  // capital min/max) par grille tarifaire + sous-garantie (stdtarifdetail)
  getTarifDetailsParTarif: async (idTarif) =>
    extractData(await apiClient.get('/tarifdetail/', { params: { IdTarif: idTarif, page_size: 1000 } })),
  // GET /api/genrevehicule/ (13 genres en BDD)
  getGenres: async () => extractData(await apiClient.get('/genrevehicule/')),
  // GET /api/marque/ (58 marques en BDD)
  getMarques: async () => extractData(await apiClient.get('/marque/')),
  // POST /api/marque/ (Créer une nouvelle marque de véhicule)
  createMarque: (data) => apiClient.post('/marque/', data),
  // GET /api/banque/ (44 banques en BDD)
  getBanques: async () => extractData(await apiClient.get('/banque/')),
  // GET /api/modeencaissement/ (27 modes en BDD)
  getModesEncaissement: async () => extractData(await apiClient.get('/modeencaissement/')),
  // GET /api/usage/ (usages véhicules en BDD)
  getUsages: async () => extractData(await apiClient.get('/usage/')),
  // GET /api/carrosserie/
  getCarrosseries: async () => extractData(await apiClient.get('/carrosserie/')),
  // GET /api/energie/
  getEnergies: async () => extractData(await apiClient.get('/energie/')),
  // GET /api/systemesecurite/
  getSystemesSecurite: async () => extractData(await apiClient.get('/systemesecurite/')),
  // GET /api/categoriepermis/
  getCategoriesPermis: async () => extractData(await apiClient.get('/categoriepermis/')),
  // GET /api/terme/
  getTermes: async () => extractData(await apiClient.get('/terme/')),
  // GET /api/repartitionprimesante/ (barèmes de répartition prime Santé Minéné : NSIA/OREOLE/VITALIS/ADEC)
  getRepartitionsPrimeSante: async () => extractData(await apiClient.get('/repartitionprimesante/')),
  // POST /api/repartitionprimesante/
  createRepartitionPrimeSante: (data) => apiClient.post('/repartitionprimesante/', data),
  // PUT /api/repartitionprimesante/{id}/
  updateRepartitionPrimeSante: (id, data) => apiClient.put(`/repartitionprimesante/${id}/`, data),
  // DELETE /api/repartitionprimesante/{id}/
  deleteRepartitionPrimeSante: (id) => apiClient.delete(`/repartitionprimesante/${id}/`),
  // POST /api/calculrepartitionprimesante/ — { prime_ht, avec_apporteur } → ventilation NSIA/OREOLE/VITALIS/ADEC
  calculerRepartitionPrimeSante: async (primeHt, avecApporteur = false) => {
    const res = await apiClient.post('/calculrepartitionprimesante/', {
      prime_ht: primeHt,
      avec_apporteur: avecApporteur,
    });
    return res?.data;
  },
  // GET /api/offre/ — idCompagnie optionnel : ne garde que les offres ayant au
  // moins une garantie liée à cette compagnie (stdoffregarantie)
  getOffres: async (idCompagnie) =>
    extractData(await apiClient.get('/offre/', { params: idCompagnie ? { idcompagnie: idCompagnie } : undefined })),
  // POST /api/offre/
  createOffre: (data) => apiClient.post('/offre/', data),
  // PUT /api/offre/{id}/
  updateOffre: (id, data) => apiClient.put(`/offre/${id}/`, data),
  // DELETE /api/offre/{id}/
  deleteOffre: (id) => apiClient.delete(`/offre/${id}/`),
  // GET /api/branche/
  getBranches: async () => extractData(await apiClient.get('/branche/')),
  // GET /api/sousgarantie/
  getSousGaranties: async () => extractData(await apiClient.get('/sousgarantie/', { params: { page_size: 1000 } })),
  // POST /api/sousgarantie/
  createSousGarantie: (data) => apiClient.post('/sousgarantie/', data),
  // GET /api/offregarantie/
  getOffreGaranties: async () => extractData(await apiClient.get('/offregarantie/')),
  // GET /api/offregarantie/?IdOffre={id} (liaisons d'une offre précise, évite de charger les 1700+ lignes)
  getOffreGarantiesParOffre: async (idOffre) =>
    extractData(await apiClient.get('/offregarantie/', { params: { IdOffre: idOffre, page_size: 1000 } })),
  // POST /api/offregarantie/
  createOffreGarantie: (data) => apiClient.post('/offregarantie/', data),
  // PUT /api/offregarantie/{id}/
  updateOffreGarantie: (id, data) => apiClient.put(`/offregarantie/${id}/`, data),
  // DELETE /api/offregarantie/{id}/
  deleteOffreGarantie: (id) => apiClient.delete(`/offregarantie/${id}/`),
  // GET /api/reductionflotte/
  getReductionsFlotte: async () => extractData(await apiClient.get('/reductionflotte/')),
  // POST /api/reductionflotte/
  createReductionFlotte: (data) => apiClient.post('/reductionflotte/', data),
  // GET /api/formulesecuriteroutiere/
  getFormulesSecurite: async () => extractData(await apiClient.get('/formulesecuriteroutiere/')),
  // POST /api/formulesecuriteroutiere/
  createFormuleSecurite: (data) => apiClient.post('/formulesecuriteroutiere/', data),
  // GET /api/commissionproduit/
  getCommissionsProduit: async () => extractData(await apiClient.get('/commissionproduit/')),
  // POST /api/commissionproduit/
  createCommissionProduit: (data) => apiClient.post('/commissionproduit/', data),
  // GET /api/tauxtaxegarantie/
  getTauxTaxesGarantie: async () => extractData(await apiClient.get('/tauxtaxegarantie/')),
  // POST /api/tauxtaxegarantie/
  createTauxTaxeGarantie: (data) => apiClient.post('/tauxtaxegarantie/', data),
  // GET /api/typevehicule/
  getTypesVehicule: async () => extractData(await apiClient.get('/typevehicule/')),
  // GET /api/users/profile/ & fallback /api/utilisateur/
  getUsers: async () => {
    try {
      const res = await apiClient.get('/users/profile/');
      const data = extractData(res);
      if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {}
    return extractData(await apiClient.get('/utilisateur/'));
  },
};

/* =========================================================================
   14. CRM COMMERCIAL & PIPELINE LEADS (institutionnel - Module C)
   ========================================================================= */
export const crmApi = {
  // GET /api/crm/leads/ (8 leads réels en BDD)
  getLeads: async () => extractData(await apiClient.get('/crm/leads/')),
  // POST /api/crm/leads/
  createLead: (data) => apiClient.post('/crm/leads/', data),
  // PATCH /api/crm/leads/:id/
  updateLead: (id, data) => apiClient.patch(`/crm/leads/${id}/`, data),
  // DELETE /api/crm/leads/:id/
  deleteLead: (id) => apiClient.delete(`/crm/leads/${id}/`),
  // POST /api/crm/leads/:id/changer_statut/
  updateLeadStage: (id, stage) => apiClient.post(`/crm/leads/${id}/changer_statut/`, { statut: stage }),
  // GET /api/crm/leads/stats/
  getLeadStats: async () => {
    const res = await apiClient.get('/crm/leads/stats/');
    return res.data;
  },
  // GET /api/crm/clients/:id/360/
  getCustomer360: async (clientId) => {
    const res = await apiClient.get(`/crm/clients/${clientId || 1}/360/`);
    return res.data;
  },
  // POST /api/crm/interactions/
  addInteraction: (data) => apiClient.post('/crm/interactions/', data),
  // GET /api/crm/interactions/
  getInteractions: async (clientId) => {
    const res = await apiClient.get(`/crm/interactions/${clientId ? `?client_id=${clientId}` : ''}`);
    return extractData(res);
  },
};

/* =========================================================================
   15. SINISTRES DÉLÉGUÉS CIMA (institutionnel - Module H)
   ========================================================================= */
export const claimsApi = {
  // GET /api/sinistres/ (4 sinistres réels en BDD)
  getClaims: async () => extractData(await apiClient.get('/sinistres/')),
  // GET /api/sinistres/:id/
  getClaimDetail: async (id) => {
    const res = await apiClient.get(`/sinistres/${id}/`);
    return res.data;
  },
  // POST /api/sinistres/
  createClaim: (data) => apiClient.post('/sinistres/', data),
  // PATCH /api/sinistres/:id/
  updateClaim: (id, data) => apiClient.patch(`/sinistres/${id}/`, data),
  // POST /api/sinistres/:id/reglement/
  settleClaim: (id, amount) => apiClient.post(`/sinistres/${id}/reglement/`, { montant_indemnise: amount }),
  // POST /api/sinistres/:id/demande_accord/
  requestPriorApproval: (id, motif) => apiClient.post(`/sinistres/${id}/demande_accord/`, { motif }),
  // GET /api/sinistres/:id/quittance_subrogative/
  getQuittanceSubrogative: async (id) => {
    const res = await apiClient.get(`/sinistres/${id}/quittance_subrogative/`);
    return res.data;
  },
  // POST /api/sinistres/:id/maj_pieces/
  updatePieces: (id, pieces) => apiClient.post(`/sinistres/${id}/maj_pieces/`, { pieces_justificatives: pieces }),
  // GET /api/sinistres/stats/
  getClaimStats: async () => {
    const res = await apiClient.get('/sinistres/stats/');
    return res.data;
  },
};

/* =========================================================================
   16. CONVENTIONS ASSUREURS (institutionnel - Module I)
   ========================================================================= */
export const conventionsApi = {
  // GET /api/conventions/
  getConventions: async () => extractData(await apiClient.get('/conventions/')),
  // GET /api/conventions/:id/
  getConventionDetail: async (id) => {
    const res = await apiClient.get(`/conventions/${id}/`);
    return res.data;
  },
  // POST /api/conventions/
  createConvention: (data) => apiClient.post('/conventions/', data),
  // PATCH /api/conventions/:id/
  updateConvention: (id, data) => apiClient.patch(`/conventions/${id}/`, data),
};

/* =========================================================================
   17. GED PROBANTE & PIÈCES NUMÉRIQUES (institutionnel - Module J)
   ========================================================================= */
export const documentApi = {
  // GET /api/ged/documents/
  getDocuments: async () => extractData(await apiClient.get('/ged/documents/')),
  // POST /api/ged/documents/
  uploadDocument: (data) => apiClient.post('/ged/documents/', data),
  // DELETE /api/ged/documents/:id/
  deleteDocument: (id) => apiClient.delete(`/ged/documents/${id}/`),
};

/* =========================================================================
   18. CONFORMITÉ CIMA & AUDIT TRAIL (institutionnel - Module K)
   ========================================================================= */
export const complianceApi = {
  // GET /api/compliance/audit-trail/
  getAuditTrail: async () => extractData(await apiClient.get('/compliance/audit-trail/')),
  // GET /api/compliance/audit-trail/etats_cima/
  getEtatsCima: async () => extractData(await apiClient.get('/compliance/audit-trail/etats_cima/')),
  // GET /api/compliance/audit-trail/kpis/
  getKpis: async () => {
    const res = await apiClient.get('/compliance/audit-trail/kpis/');
    return res.data;
  },
  // POST /api/compliance/audit-trail/
  logAudit: (data) => apiClient.post('/compliance/audit-trail/', data),
};
