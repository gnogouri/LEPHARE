import { useEffect, useState } from 'react';
import { authApi } from '../../../api/endpoints';
import { echeanceEnClair, formatDateLisible, joursJusquA } from '../../../utils/dateUtils';

// Étapes du suivi commercial, dans l'ordre (CrmLead.STATUTS côté serveur)
export const ETAPES = [
  { id: 'Nouveau', label: 'Prospects entrants', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.1)', badge: 'blue' },
  { id: 'Qualifié', label: 'Besoins qualifiés', color: '#818cf8', bg: 'rgba(129, 140, 248, 0.1)', badge: 'purple' },
  { id: 'Proposition', label: 'Proposition émise', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.1)', badge: 'amber' },
  { id: 'Négociation', label: 'Négociation & clôture', color: '#f97316', bg: 'rgba(249, 115, 22, 0.1)', badge: 'amber' },
  { id: 'Gagné', label: 'Affaires gagnées', color: '#34d399', bg: 'rgba(52, 211, 153, 0.1)', badge: 'emerald' },
  { id: 'Perdu', label: 'Affaires perdues', color: '#f87171', bg: 'rgba(248, 113, 113, 0.1)', badge: 'rose' },
];
export const ETAPES_OUVERTES = ['Nouveau', 'Qualifié', 'Proposition', 'Négociation'];
export const etapeDe = (statut) => ETAPES.find((e) => e.id === statut) || ETAPES[0];

// Branches proposées à la saisie d'un prospect (une branche déjà enregistrée reste proposée)
export const BRANCHES_PROSPECT = [
  'Automobile',
  'Flotte automobile',
  'Individuelle accidents',
  'Multirisque habitation',
  'Multirisque professionnelle',
  'Responsabilité civile',
  'Santé',
  'Tous risques chantier',
  'Transport',
  'Voyage',
];

export const montantProspect = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// Relance dépassée d'une affaire encore en cours
export const relanceEnRetard = (prospect) => ETAPES_OUVERTES.includes(prospect.statut)
  && (joursJusquA(prospect.date_action) ?? 0) < 0;

// Relance lisible : « 18 sept. 2026 » et, pour une affaire en cours, son échéance
// (« en retard de 10 jours », « aujourd'hui », « dans 7 jours ») ; null sans date
export const relanceLisible = (prospect) => {
  if (!prospect.date_action) return null;
  const date = formatDateLisible(prospect.date_action);
  const complete = formatDateLisible(prospect.date_action, { jourSemaine: true });
  if (!ETAPES_OUVERTES.includes(prospect.statut)) return { date, complete, echeance: '', retard: false };
  const jours = joursJusquA(prospect.date_action);
  if (jours < 0) return { date, complete, echeance: `en retard de ${-jours} jour${jours < -1 ? 's' : ''}`, retard: true };
  return { date, complete, echeance: echeanceEnClair(prospect.date_action), retard: false };
};

// Date du jour décalée, au format d'un <input type="date"> (aaaa-mm-jj, date locale)
export const dansJours = (jours) => {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  const deux = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
};

// Message lisible d'une erreur de l'API (validation DRF comprise)
export const messageErreurApi = (err) => {
  const donnees = err?.response?.data;
  if (donnees && typeof donnees === 'object') {
    const messages = Object.entries(donnees)
      .flatMap(([champ, v]) => [].concat(v).filter((m) => typeof m === 'string').map((m) => (['error', 'detail', 'non_field_errors'].includes(champ) ? m : `${champ} : ${m}`)));
    if (messages.length) return messages.join(' ; ');
  }
  return err?.message || 'erreur du serveur';
};

// Commerciaux : les utilisateurs de l'application (profils), par nom
export const useCommerciaux = () => {
  const [commerciaux, setCommerciaux] = useState([]);
  useEffect(() => {
    let actif = true;
    authApi.getProfiles()
      .then((profils) => {
        if (!actif) return;
        const noms = (profils || []).map((p) => String(p.nom || '').trim()).filter(Boolean);
        setCommerciaux([...new Set(noms)].sort((a, b) => a.localeCompare(b, 'fr-FR', { sensitivity: 'base' })));
      })
      .catch((e) => console.warn('Liste des commerciaux indisponible', e));
    return () => { actif = false; };
  }, []);
  return commerciaux;
};
