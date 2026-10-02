/**
 * Formate une date en jj/mm/aaaa, quel que soit le format reçu (ISO, timestamp...).
 * Utilisé pour tout affichage de date en lecture seule dans l'application — jamais
 * pour la valeur d'un <input type="date">, qui doit rester au format aaaa-mm-jj.
 */
export const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// « 2026-09-18 » (ou date ISO complète) → date locale à minuit, sans décalage de fuseau
const versDateLocale = (value) => {
  if (!value) return null;
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Date en toutes lettres, plus lisible dans les listes et les cartes : « 18 sept. 2026 » ;
 * { moisLong: true } → « 18 septembre 2026 » ; { jourSemaine: true } → « jeudi 18 septembre 2026 ».
 */
export const formatDateLisible = (value, { moisLong = false, jourSemaine = false } = {}) => {
  const d = versDateLocale(value);
  if (!d) return value ? String(value) : '—';
  return d.toLocaleDateString('fr-FR', {
    ...(jourSemaine ? { weekday: 'long' } : {}),
    day: 'numeric',
    month: moisLong || jourSemaine ? 'long' : 'short',
    year: 'numeric',
  });
};

/** Nombre de jours entre aujourd'hui et la date (négatif si elle est passée), null sans date. */
export const joursJusquA = (value) => {
  const d = versDateLocale(value);
  if (!d) return null;
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  return Math.round((d - aujourdhui) / 86400000);
};

/** Échéance en clair : « aujourd'hui », « demain », « dans 5 jours », « hier », « il y a 10 jours ». */
export const echeanceEnClair = (value) => {
  const jours = joursJusquA(value);
  if (jours === null) return '';
  if (jours === 0) return "aujourd'hui";
  if (jours === 1) return 'demain';
  if (jours === -1) return 'hier';
  return jours > 0 ? `dans ${jours} jours` : `il y a ${-jours} jours`;
};

/** Formate une date avec l'heure, en jj/mm/aaaa hh:mm. */
export const formatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
