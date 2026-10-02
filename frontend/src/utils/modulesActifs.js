// Branches de devis ouvertes pendant la mise au point des modules Automobile, Individuelle
// Accidents, Santé, Voyage, Transport et Multirisques Habitation. Les autres restent affichées mais grisées (boutons de création, « Modifier »
// du registre). Les clés sont celles des routes /user/quotes/<module> : ajouter une clé ici rouvre
// la branche partout.
export const MODULES_ACTIFS = ['auto', 'ia', 'sante', 'voyage', 'transport', 'mrh'];

export const moduleActif = (module) => MODULES_ACTIFS.includes(module);

export const TITRE_MODULE_INACTIF =
  'Module indisponible pour le moment : seuls les modules Automobile, Individuelle Accidents, Santé, Voyage, Transport et Multirisques Habitation sont ouverts';
