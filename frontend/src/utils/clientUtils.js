import { trierParLibelle } from './sortUtils';

/**
 * Qualités (stdqualite) proposées selon le type de personne du client : les civilités
 * (typepersonne 1 : Monsieur, Madame, Mademoiselle, dans cet ordre) pour une personne physique,
 * les types d'entreprise (typepersonne 2 : entreprise privée, association, ONG…, de A à Z)
 * pour une personne morale.
 */
export const qualitesSelonPersonne = (qualites, entreprise) => {
  const typePersonne = entreprise ? 2 : 1;
  const liste = (qualites || []).filter((q) => Number(q.TypePersonne) === typePersonne);
  return entreprise
    ? trierParLibelle(liste, (q) => q.Libelle)
    : [...liste].sort((a, b) => a.IdQualite - b.IdQualite);
};

// Libellés des champs de stdclient, pour les refus de l'API (erreurs par champ de DRF)
const LIBELLES_CHAMPS_CLIENT = {
  Nom: 'Nom ou raison sociale',
  Prenoms: 'Prénoms',
  Telephone: 'Téléphone',
  Mobile: 'Mobile',
  Fixe: 'Téléphone fixe',
  Fax: 'Fax',
  Email: 'E-mail',
  Adresse1: 'Adresse',
  Adresse2: "Complément d'adresse",
  CodePostal: 'Boîte postale',
  CniPat: "Pièce d'identité ou RCCM",
  DateNaissance: 'Date de naissance',
  LieuNaissance: 'Lieu de naissance',
  Responsable: 'Représentant légal',
  Fonction: 'Fonction',
  Rib: 'RIB',
  NumeroCompte: 'Numéro de compte',
};

/**
 * Motif du refus d'une fiche client par l'API : messages par champ (« E-mail : Saisissez une
 * adresse e-mail valide. »), doublon signalé par le serveur, ou `defaut` s'il n'y a rien à lire.
 */
export const messageErreurClient = (err, defaut) => {
  const data = err?.response?.data;
  if (data && typeof data === 'object') {
    const motifs = Object.entries(data).flatMap(([champ, valeur]) => {
      const textes = (Array.isArray(valeur) ? valeur : [valeur]).filter((m) => typeof m === 'string' && m);
      if (!textes.length) return [];
      const libelle = LIBELLES_CHAMPS_CLIENT[champ];
      return [libelle ? `${libelle} : ${textes.join(' ')}` : textes.join(' ')];
    });
    // `detail` et `error` portent le même message après réécriture d'une erreur serveur (apiClient)
    if (motifs.length) return [...new Set(motifs)].join(' ; ');
  }
  return defaut;
};

/** RIB saisi (espaces retirés) qui n'a pas les 24 caractères UEMOA : il serait écarté à l'enregistrement. */
export const ribIncomplet = (rib) => {
  const valeur = String(rib || '').replace(/\s+/g, '');
  return Boolean(valeur) && valeur.length !== 24;
};
