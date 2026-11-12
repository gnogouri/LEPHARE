import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import apiClient, { EVENEMENT_ERREUR_API } from '../../api/apiClient';

// Interroge /api/etat-serveur/ : 200 = serveur et base joignables, 503 = base inaccessible,
// pas de réponse (ou erreur du proxy vite) = serveur Django arrêté.
const verifierServeur = async () => {
  try {
    // Délai supérieur au connect_timeout de Django (5 s) : une base lente répond 503, pas « serveur arrêté »
    await apiClient.get('/etat-serveur/', { timeout: 20000, sansSignalement: true });
    return 'ok';
  } catch (err) {
    if (err?.response?.status === 503 && err.response.data?.serveur) return 'base';
    return 'serveur';
  }
};

const MESSAGES = {
  serveur: {
    titre: 'Serveur LE PHARE arrêté',
    texte: 'Le serveur Django (port 8000) ne répond pas : aucune donnée ne peut être lue ni enregistrée.',
  },
  base: {
    titre: 'Base de données inaccessible',
    texte: 'Le serveur répond mais PostgreSQL refuse les connexions (blocage Windows Smart App Control ou service arrêté) : '
      + 'les listes restent vides tant que la base n\'est pas revenue.',
  },
};

export const BandeauEtatServeur = () => {
  const [etat, setEtat] = useState('ok');
  const [retabli, setRetabli] = useState(false);
  const enCours = useRef(false);

  const controler = useCallback(async () => {
    if (enCours.current) return;
    enCours.current = true;
    const nouvelEtat = await verifierServeur();
    enCours.current = false;
    setEtat((precedent) => {
      if (precedent !== 'ok' && nouvelEtat === 'ok') setRetabli(true);
      return nouvelEtat;
    });
  }, []);

  useEffect(() => {
    controler();
    window.addEventListener(EVENEMENT_ERREUR_API, controler);
    return () => window.removeEventListener(EVENEMENT_ERREUR_API, controler);
  }, [controler]);

  // Tant que le serveur ou la base manque, nouvel essai toutes les 15 s
  useEffect(() => {
    if (etat === 'ok') return undefined;
    const minuterie = setInterval(controler, 15000);
    return () => clearInterval(minuterie);
  }, [etat, controler]);

  if (etat === 'ok' && !retabli) return null;

  const enPanne = etat !== 'ok';
  const couleur = enPanne ? 'var(--accent-rose)' : 'var(--accent-emerald)';
  const message = enPanne ? MESSAGES[etat] : {
    titre: 'Connexion rétablie',
    texte: 'Le serveur et la base répondent de nouveau : rechargez la page pour afficher les données à jour.',
  };

  return (
    <div
      role="alert"
      className="bandeau-anime"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
        background: 'var(--bg-surface-elevated)', borderBottom: `2px solid ${couleur}`,
        color: 'var(--text-primary)', fontSize: 13,
      }}
    >
      {enPanne
        ? <AlertTriangle size={18} color={couleur} style={{ flexShrink: 0 }} />
        : <CheckCircle2 size={18} color={couleur} style={{ flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ color: couleur }}>{message.titre}</strong>
        <span style={{ color: 'var(--text-secondary)' }}> - {message.texte}</span>
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => (enPanne ? controler() : window.location.reload())}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
      >
        <RefreshCw size={14} /> {enPanne ? 'Réessayer' : 'Recharger'}
      </button>
    </div>
  );
};

export default BandeauEtatServeur;
