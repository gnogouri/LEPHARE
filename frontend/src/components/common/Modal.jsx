import React, { useEffect, useId, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { X } from 'lucide-react';
import { nomCabinet } from '../../utils/parametrage';

// Largeurs associées à la prop `size` (utilisée par de nombreux écrans) ; `maxWidth` reste prioritaire
const SIZE_WIDTHS = { small: '480px', medium: '720px', large: '960px' };

// Durée de l'animation de fermeture (index.css : .modal-sortie)
const DUREE_FERMETURE = 150;

// Fenêtres ouvertes, de la plus ancienne à la plus récente. Une fenêtre peut en ouvrir une autre (création d'une
// banque depuis l'encaissement) : Échap ne ferme que la dernière ouverte, et la page ne redevient défilante qu'à la
// fermeture de la dernière.
const pileFenetres = [];

export const Modal = ({ isOpen, onClose, title, subtitle, children, size, maxWidth }) => {
  const width = maxWidth || SIZE_WIDTHS[size] || '620px';
  const idTitre = useId();
  const contenuRef = useRef(null);
  // Dernière fonction de fermeture reçue : la fenêtre garde sa place dans la pile quand l'écran se redessine
  const fermerRef = useRef(onClose);
  fermerRef.current = onClose;

  // Fermeture animée : la fenêtre reste affichée DUREE_FERMETURE ms avec le dernier contenu affiché
  // ouvert (les écrans vident souvent leurs données à la fermeture : le contenu figé évite de
  // l'afficher sans données). Décidé pendant le rendu pour ne pas démonter puis remonter le contenu.
  const [ouvertPrecedent, setOuvertPrecedent] = useState(isOpen);
  const [fermeture, setFermeture] = useState(false);
  if (ouvertPrecedent !== isOpen) {
    setOuvertPrecedent(isOpen);
    setFermeture(!isOpen);
  }
  useEffect(() => {
    if (!fermeture) return undefined;
    const minuterie = setTimeout(() => setFermeture(false), DUREE_FERMETURE);
    return () => clearTimeout(minuterie);
  }, [fermeture]);
  const instantane = useRef(null);
  if (isOpen) instantane.current = { title, subtitle, children };
  const affiche = isOpen ? { title, subtitle, children } : (instantane.current || {});

  // Focus : posé dans la fenêtre à l'ouverture (sauf si un champ l'a déjà pris), rendu ensuite
  useEffect(() => {
    if (!isOpen) return undefined;
    const avant = document.activeElement;
    const contenu = contenuRef.current;
    if (contenu && !contenu.contains(document.activeElement)) contenu.focus({ preventScroll: true });
    return () => {
      if (avant && typeof avant.focus === 'function' && document.contains(avant)) avant.focus({ preventScroll: true });
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const place = {};
    pileFenetres.push(place);
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && pileFenetres[pileFenetres.length - 1] === place) fermerRef.current?.();
    };
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      const rang = pileFenetres.indexOf(place);
      if (rang >= 0) pileFenetres.splice(rang, 1);
      if (!pileFenetres.length) {
        document.body.style.overflow = 'unset';
        document.body.classList.remove('modal-open');
      }
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen && !fermeture) return null;

  const modalElement = (
    <div className={`modal-backdrop${isOpen ? '' : ' modal-sortie'}`} onClick={isOpen ? onClose : undefined}>
      <div
        ref={contenuRef}
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        tabIndex={-1}
        style={{ maxWidth: width, outline: 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Official CIMA / Institutional Print Header */}
        <div className="modal-print-header print-only">
          <div className="print-republic-header">
            <div>
              <div className="print-supertitle">RÉPUBLIQUE DE CÔTE D'IVOIRE • MINISTÈRE DES FINANCES • CODE CIMA (CRCA)</div>
              <div className="print-company-name">{nomCabinet()}</div>
            </div>
            <div className="print-doc-meta">
              <div>Édité le {new Date().toLocaleDateString('fr-FR')}</div>
              <div className="print-certified-badge">FICHE RÉGLEMENTAIRE OFFICIELLE</div>
            </div>
          </div>
        </div>

        {/* Modal Header */}
        <div className="modal-header">
          <div>
            <h3 id={idTitre} className="modal-title" style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {affiche.title}
            </h3>
            {affiche.subtitle && (
              <p className="modal-subtitle" style={{ fontSize: '0.825rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
                {affiche.subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="modal-close-btn no-print"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body">{affiche.children}</div>

        {/* Official CIMA / Institutional Print Footer */}
        <div className="modal-print-footer print-only">
          <div className="print-footer-content">
            <div className="print-legal-notice">
              Certifié conforme aux écritures de gestion et aux dispositions prudentielles du Code des Assurances (CIMA).
            </div>
            <div className="print-signatures">
              <div className="print-sig-block">
                <span>Le Responsable d'Exploitation</span>
                <div className="print-sig-space">Visa & Paraphe</div>
              </div>
              <div className="print-sig-block print-sig-right">
                <span>Direction LE PHARE / Visa CIMA</span>
                <div className="print-sig-space">[ Cachet Officiel ]</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalElement, document.body);
};

export default Modal;
