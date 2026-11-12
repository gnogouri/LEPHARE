const ERREUR_TECHNIQUE = /request failed with status code|network error|timeout of \d+ms|\beconn\w*|\berr_\w+|unexpected token|is not a function|cannot read propert|is not defined|undefined is not|null is not|syntaxerror|typeerror|referenceerror|traceback|<!doctype|<html|psycopg|errno|internal server error|ora-\d+|relation\s+["'`]?[\w.]+["'`]?\s+(?:does not exist|already exists)|column\s+["'`]?[\w.]+["'`]?\s+does not exist|table\s+["'`]?[\w.]+["'`]?\s+(?:does not exist|doesn't exist|already exists)|no such table|no such column|undefined table|undefined column|invalid object name|sqlstate|syntax error at or near|invalid input syntax for type|duplicate key value violates|violates .* constraint|constraint .* does not exist|current transaction is aborted|deadlock detected|operationalerror|programmingerror|integrityerror|databaseerror|django\.db|sqlite|postgresql|mysql|\[object object\]/i;

export const estErreurTechnique = (message) => (
  typeof message === 'string' && ERREUR_TECHNIQUE.test(message)
);

const contientErreurTechnique = (valeur, visitees = new WeakSet()) => {
  if (typeof valeur === 'string') return estErreurTechnique(valeur);
  if (!valeur || typeof valeur !== 'object' || visitees.has(valeur)) return false;
  visitees.add(valeur);
  return Object.values(valeur).some((element) => contientErreurTechnique(element, visitees));
};

export const contientDetailTechnique = contientErreurTechnique;

export const messageErreurLisible = (message, statut) => {
  if (typeof statut === 'number' && statut >= 500) {
    return 'Le service est temporairement indisponible. Vérifiez votre connexion puis réessayez.';
  }
  const texte = message instanceof Error ? message.message : message;
  const messageTexte = texte === null || texte === undefined ? '' : String(texte).trim();
  if (!messageTexte) return 'Une erreur est survenue. Veuillez réessayer.';
  if (!estErreurTechnique(messageTexte)) return messageTexte;

  if (statut === 401 || /status code 401/i.test(messageTexte)) {
    return 'Votre session a expiré : reconnectez-vous.';
  }
  if (statut === 403 || /status code 403/i.test(messageTexte)) {
    return "Vous n'avez pas les droits nécessaires pour cette opération.";
  }
  if (statut === 404 || /status code 404/i.test(messageTexte)) {
    return "L'élément demandé est introuvable : il a peut-être été retiré entre-temps.";
  }
  if ((typeof statut === 'number' && statut >= 500)
    || /status code 5\d\d|network error|timeout of|econn|internal server error|could not connect to server|connection refused/i.test(messageTexte)) {
    return 'Le service est temporairement indisponible. Vérifiez votre connexion puis réessayez.';
  }
  return 'Une erreur technique est survenue. Veuillez réessayer ; si le problème persiste, contactez le support.';
};
