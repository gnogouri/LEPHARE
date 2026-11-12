import axios from 'axios';
import { demanderMotif } from '../utils/motif';
import { contientDetailTechnique, messageErreurLisible } from '../utils/messageUtilisateur';

// Client de l'API : jeton de la session ouverte par POST /api/users/login (aucun jeton par défaut :
// sans connexion, le serveur répond 401 et l'écran revient à la page de connexion).
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 45000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

export const CLE_JETON = 'uranus_auth_token';
export const CLE_SESSION = 'lephare_session';

// Émis quand le serveur refuse le jeton (session expirée, compte désactivé) : AuthContext ferme la session
export const EVENEMENT_SESSION_EXPIREE = 'lephare:session-expiree';
// Émis sur une requête sans réponse ou en erreur 5xx : le bandeau d'état du serveur vérifie alors
// si Django ou la base de données est indisponible.
export const EVENEMENT_ERREUR_API = 'lephare:erreur-api';
// Émis quand la garde du serveur refuse une opération d'écriture (droit manquant, séparation des
// tâches) : AppLayout affiche le motif du refus, même si l'écran n'affiche qu'un message générique.
export const EVENEMENT_ACCES_REFUSE = 'lephare:acces-refuse';

const lireJeton = () => {
  try {
    return localStorage.getItem(CLE_JETON);
  } catch {
    return null;
  }
};

apiClient.interceptors.request.use(
  (config) => {
    const jeton = lireJeton();
    if (jeton) config.headers.Authorization = `Token ${jeton}`;
    else delete config.headers.Authorization;
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const requete = error.config || {};
    const statut = error.response?.status;
    if (error.response && (statut >= 500 || contientDetailTechnique(error.response.data))) {
      error.response.data = {
        detail: messageErreurLisible(error.response.data?.detail || error.response.data?.error || error.message, statut),
        error: messageErreurLisible(error.response.data?.detail || error.response.data?.error || error.message, statut),
      };
    }
    if (!requete.sansSignalement && !axios.isCancel(error) && (!error.response || statut >= 500)) {
      window.dispatchEvent(new Event(EVENEMENT_ERREUR_API));
    }
    // Session refusée par le serveur : retour à la connexion (sauf pendant la connexion elle-même)
    if (statut === 401 && !String(requete.url || '').includes('/users/login')) {
      window.dispatchEvent(new Event(EVENEMENT_SESSION_EXPIREE));
    }
    const methode = String(requete.method || 'get').toLowerCase();
    if (statut === 403 && !['get', 'head', 'options'].includes(methode)) {
      const detail = error.response?.data?.detail || error.response?.data?.error;
      if (typeof detail === 'string' && detail) {
        window.dispatchEvent(new CustomEvent(EVENEMENT_ACCES_REFUSE, { detail }));
      }
    }
    // Opération sensible : le serveur exige un motif (garde centrale) ; saisie puis nouvel envoi
    if (statut === 428 && error.response?.data?.code === 'motif_requis' && !requete.motifEnvoye) {
      const motif = await demanderMotif(error.response.data.libelle);
      if (motif) {
        requete.motifEnvoye = true;
        requete.headers = { ...(requete.headers || {}), 'X-Motif': encodeURIComponent(motif) };
        return apiClient(requete);
      }
      error.response.data = { ...error.response.data, error: 'Opération annulée : motif non saisi.' };
    }
    return Promise.reject(error);
  }
);

/* -------------------------------------------------------------------------
   Lectures économisées
   1. Deux écrans (ou deux effets du même écran) qui demandent la même lecture au même moment
      partagent une seule requête : la liste des clients, par exemple, était téléchargée deux fois
      à l'ouverture du répertoire.
   2. Les tables de référence qui ne changent presque jamais (villes, marques, professions…) sont
      gardées quelques minutes : elles étaient rechargées à chaque ouverture de formulaire. Toute
      écriture (création, modification, suppression) vide cette réserve, pour qu'une valeur ajoutée
      apparaisse aussitôt dans les listes.
   Chaque appelant reçoit sa propre copie des données : aucun écran ne modifie celles d'un autre.
   ------------------------------------------------------------------------- */
const REFERENTIELS_STABLES = new Set([
  '/ville/', '/profession/', '/qualite/', '/statutjuridique/', '/secteuractivite/', '/energie/', '/carrosserie/',
  '/marque/', '/genrevehicule/', '/typevehicule/', '/usage/', '/categoriepermis/', '/typesouscripteur/',
  '/typeassure/', '/terme/', '/banque/', '/modeencaissement/', '/avenant/', '/branche/',
]);
const DUREE_REFERENTIELS = 5 * 60 * 1000;
const lecturesEnCours = new Map();
const referentielsGardes = new Map();

const copier = (donnees) => {
  if (donnees === null || typeof donnees !== 'object') return donnees;
  try {
    return typeof structuredClone === 'function' ? structuredClone(donnees) : JSON.parse(JSON.stringify(donnees));
  } catch {
    return donnees;
  }
};

const lireApi = apiClient.get.bind(apiClient);
apiClient.get = (url, config) => {
  const options = config || {};
  // Téléchargements, requêtes annulables ou suivies : jamais partagés
  const partageable = typeof url === 'string'
    && (!options.responseType || options.responseType === 'json')
    && !options.signal && !options.cancelToken && !options.onDownloadProgress;
  if (!partageable) return lireApi(url, config);
  let cle;
  try {
    // Jeton, adresse et toutes les options (paramètres, délai, en-têtes) : seules des lectures identiques se partagent
    cle = `${lireJeton() || ''}|${url}|${JSON.stringify(options)}`;
  } catch {
    return lireApi(url, config);
  }
  const stable = REFERENTIELS_STABLES.has(url) && !options.params;
  if (stable) {
    const garde = referentielsGardes.get(cle);
    if (garde && Date.now() - garde.date < DUREE_REFERENTIELS) {
      return Promise.resolve({ ...garde.reponse, data: copier(garde.reponse.data) });
    }
  }
  let lecture = lecturesEnCours.get(cle);
  if (!lecture) {
    lecture = lireApi(url, config)
      .then((reponse) => {
        if (stable) referentielsGardes.set(cle, { date: Date.now(), reponse });
        return reponse;
      })
      .finally(() => lecturesEnCours.delete(cle));
    lecturesEnCours.set(cle, lecture);
  }
  return lecture.then((reponse) => ({ ...reponse, data: copier(reponse.data) }));
};

// Une écriture peut changer un référentiel : la réserve est vidée, les listes se rechargent
apiClient.interceptors.request.use((config) => {
  if (!['get', 'head', 'options'].includes(String(config.method || 'get').toLowerCase())) referentielsGardes.clear();
  return config;
});

export default apiClient;
