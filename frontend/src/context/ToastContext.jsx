import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useAuth } from './AuthContext';
import { estErreurTechnique, messageErreurLisible } from '../utils/messageUtilisateur';

/* =========================================================================
   NOTIFICATIONS DE LE PHARE
   useToast() → { success, error, warning, info, addToast, fermer }. Chaque fonction accepte
   (message, options) : options = durée en ms, ou { titre, duree } (duree 0 = jusqu'à fermeture).
   - durée adaptée au type et à la longueur du texte, mise en pause au survol et au focus ;
   - un même message déjà affiché n'est pas répété : il est rappelé (×2, ×3…) et sa durée repart ;
   - 4 notifications au plus, les plus anciennes se retirent ;
   - un message technique (code HTTP, trace, erreur JavaScript) n'est jamais montré tel quel : il est
     remplacé par une phrase claire et gardé dans la console pour le diagnostic.
   - la cloche est réservée aux alertes à suivre (devis à échéance, chèques à déposer : ClocheNotifications) :
     un message n'y est consigné que sur demande, option { cloche: true } (consigne du 2026-10-26 : enregistrer
     un devis, un contrat… affiche seulement le message, sans incrémenter la cloche).
   Apparence et animations : section « MOTION DESIGN » de index.css.
   ========================================================================= */

const TYPES = {
  success: { classe: 'succes', titre: 'Opération réussie', icone: CheckCircle2, duree: 4500, role: 'status' },
  error: { classe: 'erreur', titre: 'Erreur', icone: XCircle, duree: 7000, role: 'alert' },
  warning: { classe: 'attention', titre: 'Attention', icone: AlertTriangle, duree: 6500, role: 'alert' },
  info: { classe: 'info', titre: 'Information', icone: Info, duree: 5000, role: 'status' },
};
const MAX_VISIBLES = 4;
const DUREE_MAX = 16000;
const DUREE_SORTIE = 180;

const messageLisible = (message, type) => {
  if (React.isValidElement(message)) return message;
  const texte = message instanceof Error ? message.message : message;
  if (type === 'error' || type === 'warning') return messageErreurLisible(texte);
  return estErreurTechnique(texte) ? messageErreurLisible(texte) : texte;
};

// Temps de lecture : au moins la durée du type, plus ~1/4 s par mot
const dureeDeLecture = (type, message) => {
  const mots = typeof message === 'string' ? message.split(/\s+/).filter(Boolean).length : 12;
  return Math.min(DUREE_MAX, Math.max(TYPES[type].duree, 2500 + mots * 260));
};

const ToastContext = createContext(null);
let compteurId = 0;

// Journal de la cloche : messages consignés sur demande ({ cloche: true }) de la session de l'utilisateur connecté.
// Nouvelle clé : les journaux de l'ancienne règle (tous les messages consignés) sont ignorés
const JOURNAL_MAX = 50;
const JournalContext = createContext({ messages: [], nonLus: 0, marquerLus: () => {}, effacer: () => {} });
const cleJournal = (idUtilisateur) => `lephare_cloche_${idUtilisateur}`;
const lireJournal = (idUtilisateur) => {
  if (!idUtilisateur) return [];
  try {
    const liste = JSON.parse(sessionStorage.getItem(cleJournal(idUtilisateur)) || '[]');
    return Array.isArray(liste) ? liste : [];
  } catch {
    return [];
  }
};

export const ToastProvider = ({ children }) => {
  const { user } = useAuth();
  const idUtilisateur = user?.id || null;
  const [journal, setJournal] = useState(() => lireJournal(idUtilisateur));
  // Autre utilisateur ou déconnexion : journal de cet utilisateur (vide sans session) ; l'ancien journal de tous les
  // messages (clé lephare_messages_<id>) est retiré
  useEffect(() => {
    setJournal(lireJournal(idUtilisateur));
    if (idUtilisateur) { try { sessionStorage.removeItem(`lephare_messages_${idUtilisateur}`); } catch { /* stockage indisponible */ } }
  }, [idUtilisateur]);
  useEffect(() => {
    if (!idUtilisateur) return;
    try { sessionStorage.setItem(cleJournal(idUtilisateur), JSON.stringify(journal)); } catch { /* stockage indisponible */ }
  }, [journal, idUtilisateur]);
  const consigner = useCallback((type, titre, message) => {
    const texte = typeof message === 'string' ? message : titre;
    setJournal((avant) => {
      const [dernier] = avant;
      // Même message que le dernier consigné, encore non lu : son compte augmente
      if (dernier && !dernier.lu && dernier.type === type && dernier.texte === texte && dernier.titre === titre) {
        return [{ ...dernier, compte: dernier.compte + 1, instant: Date.now() }, ...avant.slice(1)];
      }
      return [{ id: `${Date.now()}-${++compteurId}`, type, titre, texte, instant: Date.now(), compte: 1, lu: false }, ...avant].slice(0, JOURNAL_MAX);
    });
  }, []);
  const journalValeur = useMemo(() => ({
    messages: journal,
    nonLus: journal.reduce((s, m) => s + (m.lu ? 0 : m.compte), 0),
    marquerLus: () => setJournal((avant) => (avant.some((m) => !m.lu) ? avant.map((m) => ({ ...m, lu: true })) : avant)),
    effacer: () => setJournal([]),
  }), [journal]);

  // Liste tenue dans une référence (doublons et limite décidés sans attendre un rendu)
  const liste = useRef([]);
  const [, rafraichir] = useReducer((n) => n + 1, 0);
  const maj = useCallback((transformer) => {
    liste.current = transformer(liste.current);
    rafraichir();
  }, []);

  // Minuteries : fermeture automatique (avec pause), retrait après l'animation de sortie, rappel
  const minuteries = useRef(new Map());
  const autres = useRef(new Set());
  const differer = (fn, delai) => {
    const h = setTimeout(() => { autres.current.delete(h); fn(); }, delai);
    autres.current.add(h);
  };
  useEffect(() => () => {
    minuteries.current.forEach((m) => clearTimeout(m.handle));
    autres.current.forEach(clearTimeout);
  }, []);

  const fermer = useCallback((id) => {
    const m = minuteries.current.get(id);
    if (m) clearTimeout(m.handle);
    minuteries.current.delete(id);
    if (!liste.current.some((t) => t.id === id && !t.sortie)) return;
    maj((l) => l.map((t) => (t.id === id ? { ...t, sortie: true } : t)));
    differer(() => maj((l) => l.filter((t) => t.id !== id)), DUREE_SORTIE);
  }, [maj]);

  const programmer = useCallback((id, duree) => {
    const avant = minuteries.current.get(id);
    if (avant) clearTimeout(avant.handle);
    if (!duree) return;
    minuteries.current.set(id, { restant: duree, depart: Date.now(), handle: setTimeout(() => fermer(id), duree), pauses: 0 });
  }, [fermer]);

  const pause = (id) => {
    const m = minuteries.current.get(id);
    if (!m) return;
    m.pauses += 1;
    if (m.pauses > 1) return;
    clearTimeout(m.handle);
    m.restant -= Date.now() - m.depart;
  };
  const reprise = (id) => {
    const m = minuteries.current.get(id);
    if (!m || m.pauses === 0) return;
    m.pauses -= 1;
    if (m.pauses > 0) return;
    m.depart = Date.now();
    m.handle = setTimeout(() => fermer(id), Math.max(m.restant, 1200));
  };

  const addToast = useCallback((message, type = 'info', options = {}) => {
    const genre = TYPES[type] ? type : 'info';
    const opts = typeof options === 'number' ? { duree: options } : (options || {});
    const texte = messageLisible(message, genre);
    if (texte === '' || texte === null) return null;
    const duree = opts.duree !== undefined ? opts.duree : dureeDeLecture(genre, texte);
    const titre = opts.titre || TYPES[genre].titre;
    if (opts.cloche) consigner(genre, titre, texte);

    // Même message déjà à l'écran : rappel plutôt qu'une seconde notification
    const existant = typeof texte === 'string'
      && liste.current.find((t) => !t.sortie && t.type === genre && t.message === texte && t.titre === titre);
    if (existant) {
      maj((l) => l.map((t) => (t.id === existant.id ? { ...t, compte: t.compte + 1, version: t.version + 1, rappel: true, duree } : t)));
      differer(() => maj((l) => l.map((t) => (t.id === existant.id ? { ...t, rappel: false } : t))), 400);
      programmer(existant.id, duree);
      return existant.id;
    }

    const id = ++compteurId;
    const visibles = liste.current.filter((t) => !t.sortie);
    if (visibles.length >= MAX_VISIBLES) fermer(visibles[0].id);
    maj((l) => [...l, { id, type: genre, titre, message: texte, duree, compte: 1, version: 0, rappel: false, sortie: false }]);
    programmer(id, duree);
    return id;
  }, [consigner, fermer, maj, programmer]);

  const valeur = useMemo(() => ({
    addToast,
    fermer,
    success: (message, options) => addToast(message, 'success', options),
    error: (message, options) => addToast(message, 'error', options),
    warning: (message, options) => addToast(message, 'warning', options),
    info: (message, options) => addToast(message, 'info', options),
  }), [addToast, fermer]);

  return (
    <ToastContext.Provider value={valeur}>
      <JournalContext.Provider value={journalValeur}>
        {children}
      </JournalContext.Provider>
      <div className="notifications" role="region" aria-label="Notifications">
        {liste.current.map((t) => {
          const type = TYPES[t.type];
          const Icone = type.icone;
          return (
            <div
              key={t.id}
              className={`notification ${type.classe}${t.sortie ? ' sortie' : ''}${t.rappel ? ' rappel' : ''}`}
              role={type.role}
              aria-live={type.role === 'alert' ? 'assertive' : 'polite'}
              aria-atomic="true"
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => reprise(t.id)}
              onFocus={() => pause(t.id)}
              onBlur={() => reprise(t.id)}
            >
              <span className="notification-icone" aria-hidden="true"><Icone size={17} /></span>
              <div className="notification-texte">
                <div className="notification-titre">
                  {t.titre}
                  {t.compte > 1 && <span className="notification-compte" aria-label={`${t.compte} fois`}>×{t.compte}</span>}
                </div>
                <div className="notification-message">{t.message}</div>
              </div>
              <button type="button" className="notification-fermer" onClick={() => fermer(t.id)} aria-label="Fermer la notification">
                <X size={15} />
              </button>
              {t.duree > 0 && !t.sortie && (
                <span key={t.version} className="notification-duree" style={{ animationDuration: `${t.duree}ms` }} aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
export const useJournalMessages = () => useContext(JournalContext);
