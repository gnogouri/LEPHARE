import React, { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Bell, CheckCircle2, FileClock, FileX, Info, Landmark, XCircle } from 'lucide-react';
import { useJournalMessages } from '../../context/ToastContext';
import { MODULES_EDITION_COMPLETE } from '../../utils/quoteRegistry';
import { moduleDuProduit, moduleOuvert } from '../../utils/parametrage';

/* =========================================================================
   CLOCHE DE LA BARRE DU HAUT
   Alertes à suivre (consigne du 2026-10-26) : devis non confirmés arrivant à échéance ou échus depuis peu
   (GET /api/alertes/, délai « Alerte des devis à échéance » d'Administration > Le cabinet) et, pour la caisse,
   chèques de l'échéancier à déposer. Badge = nombre de ces alertes (+ messages consignés sur demande, option
   { cloche: true } de useToast). Les messages des opérations (devis, contrat enregistrés…) s'affichent sans
   passer par la cloche. Animations (cloche qui s'agite quand les alertes augmentent, badge, panneau) :
   index.css « CLOCHE ».
   ========================================================================= */

const ICONES = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };
const CLASSES = { success: 'succes', error: 'erreur', warning: 'attention', info: 'info' };
const PAR_GROUPE = 6;

const depuis = (instant) => {
  const secondes = Math.round((Date.now() - instant) / 1000);
  if (secondes < 45) return "à l'instant";
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  return new Date(instant).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

const dateFr = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const francs = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} F TTC`;
const echeance = (d) => {
  if (d.Jours === 0) return "Échéance aujourd'hui";
  if (d.Jours > 0) return `Échéance dans ${d.Jours} jour${d.Jours > 1 ? 's' : ''}, le ${dateFr(d.DateExpiration)}`;
  return `Échu depuis ${-d.Jours} jour${d.Jours < -1 ? 's' : ''}, le ${dateFr(d.DateExpiration)}`;
};

export const ClocheNotifications = ({ alertesCheques = 0, voitCaisse = false, alertesDevis = null }) => {
  const navigate = useNavigate();
  const { messages, nonLus, marquerLus, effacer } = useJournalMessages();
  const [ouvert, setOuvert] = useState(false);
  const idPanneau = useId();
  const zone = useRef(null);
  const aEcheance = alertesDevis?.AEcheance || [];
  const echus = alertesDevis?.Echus || [];
  const nombreDevis = aEcheance.length + echus.length;
  const total = nonLus + (voitCaisse ? alertesCheques : 0) + nombreDevis;

  // La cloche s'agite quand le nombre d'alertes augmente
  const [agite, setAgite] = useState(false);
  const precedent = useRef(total);
  useEffect(() => {
    if (total > precedent.current) {
      setAgite(true);
      const minuterie = setTimeout(() => setAgite(false), 700);
      precedent.current = total;
      return () => clearTimeout(minuterie);
    }
    precedent.current = total;
    return undefined;
  }, [total]);

  // Panneau ouvert : les messages consignés non lus sont mis en évidence puis marqués comme lus
  const [nouveaux, setNouveaux] = useState(() => new Set());
  useEffect(() => {
    if (!ouvert) {
      setNouveaux(new Set());
      return;
    }
    if (nonLus === 0) return;
    const ids = messages.filter((m) => !m.lu).map((m) => m.id);
    setNouveaux((avant) => new Set([...avant, ...ids]));
    marquerLus();
  }, [ouvert, nonLus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fermeture au clic extérieur et avec Échap
  useEffect(() => {
    if (!ouvert) return undefined;
    const surClic = (e) => { if (zone.current && !zone.current.contains(e.target)) setOuvert(false); };
    const surTouche = (e) => { if (e.key === 'Escape') setOuvert(false); };
    document.addEventListener('mousedown', surClic);
    document.addEventListener('keydown', surTouche);
    return () => {
      document.removeEventListener('mousedown', surClic);
      document.removeEventListener('keydown', surTouche);
    };
  }, [ouvert]);

  // Devis : son écran de saisie s'il sait le rouvrir, sinon le registre (onglet Expirés pour un devis échu)
  const ouvrirDevis = (d) => {
    setOuvert(false);
    const module = moduleDuProduit(d.IdProduit);
    if (module && MODULES_EDITION_COMPLETE.includes(module) && moduleOuvert(module)) {
      navigate(`/user/quotes/${module}?edit=${d.IdDevis}`);
    } else {
      navigate(d.Jours < 0 ? '/user/quotes?onglet=EXPIRED' : '/user/quotes');
    }
  };

  const groupeDevis = (titre, liste, Icone, classe, lienTous) => liste.length > 0 && (
    <>
      <div className="cloche-section">
        <span>{titre} - {liste.length}</span>
        {liste.length > PAR_GROUPE && (
          <button type="button" className="cloche-lien" onClick={() => { setOuvert(false); navigate(lienTous); }}>Tout voir</button>
        )}
      </div>
      <ul className="cloche-liste">
        {liste.slice(0, PAR_GROUPE).map((d) => (
          <li key={d.IdDevis}>
            <button type="button" className="cloche-element cloche-action" onClick={() => ouvrirDevis(d)}
              title={`Ouvrir le devis ${d.NumeroDevis}`}>
              <span className={`cloche-icone ${classe}`} aria-hidden="true"><Icone size={15} /></span>
              <span className="cloche-texte">
                <span className="cloche-titre">{d.NumeroDevis}{d.Produit ? ` - ${d.Produit}` : ''}</span>
                <span className="cloche-message">{d.Client || 'Client non renseigné'} • {francs(d.PrimeTtc)}</span>
                <span className="cloche-heure">{echeance(d)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  const libelle = total > 0 ? `Notifications : ${total} alerte${total > 1 ? 's' : ''}` : 'Notifications';
  const rien = nombreDevis === 0 && messages.length === 0 && !(voitCaisse && alertesCheques > 0);

  return (
    <div className="cloche" ref={zone}>
      <button
        type="button"
        className={`cloche-bouton${agite ? ' agite' : ''}`}
        onClick={() => setOuvert((o) => !o)}
        aria-label={libelle}
        aria-expanded={ouvert}
        aria-controls={idPanneau}
        title={libelle}
      >
        <Bell size={15} />
        {total > 0 && <span key={total} className="cloche-badge" aria-hidden="true">{total > 99 ? '99+' : total}</span>}
      </button>

      {ouvert && (
        <div id={idPanneau} className="cloche-panneau" role="dialog" aria-label="Notifications">
          <div className="cloche-entete">
            <strong>Notifications</strong>
            {messages.length > 0 && (
              <button type="button" className="cloche-lien" onClick={effacer}>Effacer les messages</button>
            )}
          </div>

          <div className="cloche-defilement">
            {voitCaisse && alertesCheques > 0 && (
              <button type="button" className="cloche-element cloche-cheques" onClick={() => { setOuvert(false); navigate('/user/cheques'); }}>
                <span className="cloche-icone attention"><Landmark size={15} /></span>
                <span className="cloche-texte">
                  <span className="cloche-titre">Échéancier des chèques</span>
                  <span className="cloche-message">
                    {alertesCheques} chèque{alertesCheques > 1 ? 's' : ''} à déposer (un mois avant l'échéance ou échu).
                  </span>
                </span>
              </button>
            )}

            {groupeDevis('Devis à échéance', aEcheance, FileClock, 'attention', '/user/quotes')}
            {groupeDevis('Devis échus récemment', echus, FileX, 'erreur', '/user/quotes?onglet=EXPIRED')}

            {messages.length > 0 && (
              <>
                <div className="cloche-section"><span>Messages</span></div>
                <ul className="cloche-liste">
                  {messages.map((m) => {
                    const Icone = ICONES[m.type] || Info;
                    return (
                      <li key={m.id} className={`cloche-element${nouveaux.has(m.id) ? ' non-lu' : ''}`}>
                        <span className={`cloche-icone ${CLASSES[m.type] || 'info'}`} aria-hidden="true"><Icone size={15} /></span>
                        <span className="cloche-texte">
                          <span className="cloche-titre">
                            {m.titre}
                            {m.compte > 1 && <span className="cloche-compte">×{m.compte}</span>}
                          </span>
                          <span className="cloche-message">{m.texte}</span>
                          <span className="cloche-heure">{depuis(m.instant)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {rien && (
              <p className="cloche-vide">
                Aucune alerte. La cloche signale les devis qui arrivent à échéance ou viennent d'expirer
                {voitCaisse ? ' et les chèques à déposer' : ''} ; les messages de vos opérations s'affichent à l'écran sans s'y ajouter.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ClocheNotifications;
