import React, { useEffect, useState } from 'react';
import { AlertTriangle, Download, Eye, FileText, Image as IconeImage, Loader2, Paperclip } from 'lucide-react';

import { piecesJointesApi } from '../../api/endpoints';
import { useToast } from '../../context/ToastContext';
import { formatDate } from '../../utils/dateUtils';
import { Modal } from './Modal';

// Pièce jointe d'un devis ou d'un contrat (type 'devis' ou 'contrat') : fichier téléversé à l'enregistrement (MRH, RC,
// MRP), consulté dans une fenêtre de l'application (PDF ou image) ou téléchargé. `version` relance la lecture après
// un nouvel envoi.
const taille = (octets) => {
  const n = Number(octets) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
  return `${Math.max(1, Math.round(n / 1024)).toLocaleString('fr-FR')} Ko`;
};
const estImage = (type) => /^image\//.test(type || '');
// Formats affichés dans l'application ; le type du fichier en mémoire est imposé depuis cette liste, pour qu'un
// contenu d'un autre format (page HTML, SVG) ne soit jamais interprété : il est seulement proposé au téléchargement
const TYPES_AFFICHABLES = ['application/pdf', 'image/png', 'image/jpeg'];

const detailsPiece = (fiche, type) => [
  taille(fiche.Taille),
  fiche.Date && `déposée le ${formatDate(fiche.Date)}`,
  fiche.Origine === 'devis' && type === 'contrat' && 'jointe au devis',
].filter(Boolean).join(' · ');

/** Fiche de la pièce jointe : { Presente, Nom, Taille, Date, Disponible, Affichable, Origine, Message }, null en lecture. */
export const usePieceJointe = (type, id, version = 0) => {
  const [fiche, setFiche] = useState(null);
  useEffect(() => {
    let actif = true;
    setFiche(null);
    if (!id) return undefined;
    piecesJointesApi.fiche(type, id)
      .then((f) => { if (actif) setFiche(f); })
      .catch(() => { if (actif) setFiche({ Presente: false, Erreur: true }); });
    return () => { actif = false; };
  }, [type, id, version]);
  return fiche;
};

/** Fenêtre de consultation : le fichier affiché dès l'ouverture, ou la raison pour laquelle il ne peut pas l'être. */
export const FenetrePieceJointe = ({ type, id, fiche, isOpen, onClose }) => {
  const { error: toastError } = useToast();
  const [apercu, setApercu] = useState(null); // { url, type }
  const [chargement, setChargement] = useState(false);
  const [echec, setEchec] = useState(false);
  const affichable = Boolean(fiche?.Disponible && fiche?.Affichable);

  useEffect(() => {
    if (!isOpen || !affichable) return undefined;
    let actif = true;
    let url = null;
    setChargement(true);
    setEchec(false);
    piecesJointesApi.fichier(type, id)
      .then((blob) => {
        const typeFichier = TYPES_AFFICHABLES.find((t) => t === blob.type);
        if (!actif) return;
        if (!typeFichier) { setEchec(true); return; }
        url = URL.createObjectURL(new Blob([blob], { type: typeFichier }));
        setApercu({ url, type: typeFichier });
      })
      .catch(() => { if (actif) setEchec(true); })
      .finally(() => { if (actif) setChargement(false); });
    // L'adresse du fichier en mémoire est libérée à la fermeture
    return () => { actif = false; if (url) URL.revokeObjectURL(url); setApercu(null); };
  }, [isOpen, affichable, type, id]);

  if (!fiche?.Presente) return null;
  const telecharger = () => piecesJointesApi.telecharger(type, id, fiche.Nom)
    .catch(() => toastError(`La pièce jointe « ${fiche.Nom} » n'a pas pu être téléchargée.`));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={fiche.Nom} subtitle={detailsPiece(fiche, type)} maxWidth="min(1100px, 96vw)">
      {!fiche.Disponible && (
        <div className="piece-jointe-message"><AlertTriangle size={16} aria-hidden="true" /> {fiche.Message}</div>
      )}
      {fiche.Disponible && !fiche.Affichable && (
        <div className="piece-jointe-message">Ce format ne s'affiche pas dans l'application : téléchargez le fichier pour l'ouvrir.</div>
      )}
      {affichable && chargement && <div className="piece-jointe-chargement"><Loader2 size={20} className="spin" aria-hidden="true" /> Ouverture du fichier…</div>}
      {affichable && echec && <div className="piece-jointe-message"><AlertTriangle size={16} aria-hidden="true" /> Le fichier n'a pas pu être ouvert : téléchargez-le.</div>}
      {apercu && (estImage(apercu.type)
        ? <img src={apercu.url} alt={fiche.Nom} className="piece-jointe-image" />
        : <iframe src={apercu.url} title={fiche.Nom} className="piece-jointe-cadre" />)}
      <div className="piece-jointe-pied">
        {fiche.Disponible && (
          <button type="button" className="btn btn-secondary" onClick={telecharger} title="Enregistrer le fichier sur le poste">
            <Download size={15} /> Télécharger
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
};

/** Bouton « Pièce jointe » des barres d'action (fiche devis, devis MRH enregistré) : absent s'il n'y a pas de pièce. */
export const BoutonPieceJointe = ({ type, id, version = 0, className = 'btn btn-secondary', style }) => {
  const fiche = usePieceJointe(type, id, version);
  const [ouverte, setOuverte] = useState(false);
  if (!fiche?.Presente) return null;
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOuverte(true)}
        title={`${fiche.Nom} (${detailsPiece(fiche, type)})${fiche.Disponible ? '' : ` : ${fiche.Message}`}`}
        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', ...style }}
      >
        <Paperclip size={15} />
        <span>Pièce jointe</span>
      </button>
      <FenetrePieceJointe type={type} id={id} fiche={fiche} isOpen={ouverte} onClose={() => setOuverte(false)} />
    </>
  );
};

/** Pièce enregistrée, montrée près du champ fichier d'un devis en modification. */
export const PieceJointe = ({ type, id, version = 0, masquerSiAbsente = false, titre = 'Pièce jointe', className = '' }) => {
  const fiche = usePieceJointe(type, id, version);
  const [ouverte, setOuverte] = useState(false);
  if (!id || !fiche) return null;
  if (!fiche.Presente && masquerSiAbsente) return null;

  const Icone = estImage(fiche.Type) ? IconeImage : FileText;
  return (
    <div className={`piece-jointe ${className}`.trim()}>
      <div className="piece-jointe-titre"><Paperclip size={14} aria-hidden="true" /> {titre}</div>
      {!fiche.Presente ? (
        <div className="piece-jointe-vide">{fiche.Erreur ? 'Pièce jointe indisponible pour le moment.' : 'Aucune pièce jointe.'}</div>
      ) : (
        <div className="piece-jointe-ligne">
          <Icone size={22} aria-hidden="true" className="piece-jointe-icone" />
          <div className="piece-jointe-infos">
            <strong title={fiche.Nom}>{fiche.Nom}</strong>
            <span>{detailsPiece(fiche, type)}</span>
            {!fiche.Disponible && (
              <span className="piece-jointe-absente"><AlertTriangle size={13} aria-hidden="true" /> {fiche.Message}</span>
            )}
          </div>
          {fiche.Disponible && (
            <div className="piece-jointe-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setOuverte(true)}>
                <Eye size={14} /> Consulter
              </button>
            </div>
          )}
        </div>
      )}
      <FenetrePieceJointe type={type} id={id} fiche={fiche} isOpen={ouverte} onClose={() => setOuverte(false)} />
    </div>
  );
};

export default PieceJointe;
