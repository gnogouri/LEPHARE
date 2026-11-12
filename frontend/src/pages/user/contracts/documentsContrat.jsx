import React, { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { contractApi, dommagesApi } from '../../../api/endpoints';
import { printContratFacture, printContratConditionsParticulieres, estDevisVoyage, estDevisDommages, printCotationDommagesContrat, printPieceDommages } from '../../../utils/exportUtils';
import { estDevisSante, imprimerDocumentSante } from '../../../utils/impressionsSante';
import { FenetrePieceJointe, usePieceJointe } from '../../../components/common/PieceJointe';
import { ContractDocumentsModal } from './ContractDocumentsModal';
import { ReleveCompteModal } from './ReleveCompteModal';

/* =========================================================================
   DOCUMENTS IMPRIMABLES D'UN CONTRAT
   Liste de la fiche contrat (rubrique « Documents »), selon la branche du contrat ; partagée avec les Affaires
   antérieures, dont chaque saisie est un contrat (demande du 2026-10-27 : « proposer les mêmes modes d'impression
   que le module contrat »).
   ========================================================================= */

/**
 * contract : contrat normalisé (contractApi.getContractDetail), null tant qu'aucun n'est choisi.
 * Renvoie documents [{ cle, libelle, action, ouvrir, fenetre }] (fenetre : le document s'ouvre dans une fenêtre de
 * l'application, relevé de compte, attestation ou carte brune, et non dans l'aperçu d'impression), fenetres (à
 * placer dans la page), mineneConnexes (IA et RC rattachées à une police Santé MINENE) et ouvrirReleve.
 */
export const useDocumentsContrat = (contract, idContrat, { onSaveContract } = {}) => {
  const contrat = contract || {};
  const id = contrat.idcontrat || idContrat;
  // Voyage : l'attestation d'assurance et d'assistance voyage est le seul document imprimé
  const contratVoyage = Boolean(contract) && estDevisVoyage(contrat);
  // Dommages : relevé de compte (quittance du modèle OREOLE), cotation de son devis et pièces de la catégorie
  const contratDommages = Boolean(contract) && estDevisDommages(contrat);
  // Santé : barème MINENE, liste des assurés et ayants droit de l'IA MINENE (comme URANUS)
  const contratSante = Boolean(contract) && estDevisSante(contrat);
  // RC (produit 8) : ni attestation automobile ni carte brune
  const idProduit = Number(contrat.raw?.idproduit?.id_produit ?? contrat.raw?.idproduit?.IdProduit ?? contrat.raw?.idproduit) || 0;
  const contratRc = idProduit === 8 || /responsabilit/i.test(String(contrat.produit || ''));

  const [releveOuvert, setReleveOuvert] = useState(false);
  const [fenetreDocument, setFenetreDocument] = useState(null);
  // Fichier téléversé à l'enregistrement du devis (MRH, RC, MRP), recopié sur le contrat à la confirmation
  const pieceJointe = usePieceJointe('contrat', contract ? id : null);
  const [pieceOuverte, setPieceOuverte] = useState(false);

  // Dommages : documents de production de la catégorie (ex. « Garantie de soumission » d'une caution de soumission,
  // Réglages Dommages), proposés d'après le risque saisi
  const [documentsDommages, setDocumentsDommages] = useState([]);
  useEffect(() => {
    let actif = true;
    setDocumentsDommages([]);
    if (id && contratDommages) {
      dommagesApi.documentsContrat(id)
        .then((d) => { if (actif) setDocumentsDommages(d.Documents || []); })
        .catch(() => {});
    }
    return () => { actif = false; };
  }, [id, contratDommages]);

  const [mineneConnexes, setMineneConnexes] = useState(null);
  useEffect(() => {
    let actif = true;
    setMineneConnexes(null);
    if (idContrat) contractApi.getMineneConnexes(idContrat).then((d) => { if (actif) setMineneConnexes(d); }).catch(() => {});
    return () => { actif = false; };
  }, [idContrat]);

  // IA ou RC chef de famille MINENE : police Santé MINENE qu'elle porte en police connexe (facture MINENE commune)
  const saisieConnexe = String(contrat.raw?.numeropoliceconnexe || '').trim();
  const policeConnexe = !contratSante && [2, 8].includes(idProduit) && !/^(RAS|NEANT|NÉANT|NA|-+)$/i.test(saisieConnexe) ? saisieConnexe : '';
  const [policeSanteMinene, setPoliceSanteMinene] = useState(null);
  useEffect(() => {
    let actif = true;
    setPoliceSanteMinene(null);
    if (policeConnexe) contractApi.getPoliceMinene(policeConnexe).then((p) => { if (actif) setPoliceSanteMinene(p); }).catch(() => {});
    return () => { actif = false; };
  }, [policeConnexe]);
  const idContratFactureMinene = mineneConnexes?.Minene ? (contrat.raw?.idcontrat || id) : policeSanteMinene?.IdContrat;

  const imprimer = (cle, libelle, ouvrir) => ({ cle, libelle, action: 'Imprimer', ouvrir, fenetre: false });
  const documents = !contract ? [] : [
    ...(contratDommages ? [
      { cle: 'releve', libelle: 'Quittance - relevé de compte', action: 'Imprimer', ouvrir: () => setReleveOuvert(true), fenetre: true },
      imprimer('cotation', 'Cotation d’assurance', () => printCotationDommagesContrat(contrat)),
      // Pièces de production (compte rendu du 12-10-2026) : facture de prime au modèle OREOLE et documents de la
      // catégorie, ex. « Garantie de soumission »
      ...[['facture', 'Facture de prime'], ...documentsDommages.map((d) => [d.Id, d.Titre.charAt(0) + d.Titre.slice(1).toLowerCase()])]
        .map(([piece, libelle]) => imprimer(`piece-${piece}`, libelle, () => printPieceDommages(id, piece))),
    ] : []),
    // Dommages : la facture de prime est celle du modèle OREOLE ci-dessus ; RC : même modèle (printFacturePrimeRc)
    ...(!contratVoyage && !contratDommages ? [imprimer('facture', contratRc ? 'Facture de prime' : 'Facture', () => printContratFacture(contrat))] : []),
    imprimer('cp', contratVoyage ? 'Attestation d’assurance et d’assistance voyage' : 'Conditions particulières',
      () => printContratConditionsParticulieres(contrat)),
    // Santé (gabarits URANUS) : liste des assurés ; MINENE : barème et ayants droit de l'IA MINENE de la police
    ...(contratSante ? [
      ...(mineneConnexes?.Minene ? [['bareme', 'Barème MINENE']] : []),
      ['affilies', 'Liste des assurés'],
      ['bordereau', 'Bordereau récapitulatif des primes par assuré'],
      ...(mineneConnexes?.Minene ? [['ayants', 'Liste des ayants droit (IA MINENE)']] : []),
    ].map(([type, libelle]) => imprimer(`sante-${type}`, libelle, () => imprimerDocumentSante(type, { idcontrat: contrat.raw?.idcontrat || id }))) : []),
    // MINENE (police Santé, ou IA / RC qui lui est rattachée) : facture des trois assurances, à l'en-tête du client
    ...(idContratFactureMinene ? [imprimer('facture-minene', 'Facture MINENE',
      () => imprimerDocumentSante('facture', { idcontrat: idContratFactureMinene }))] : []),
    // Santé, Voyage, RC et Dommages : ni attestation automobile ni carte brune
    ...(!contratVoyage && !contratRc && !contratDommages && !contratSante ? [
      { cle: 'attestation', libelle: 'Editions Attestation', action: 'Editer', ouvrir: () => setFenetreDocument('attestation'), fenetre: true },
      { cle: 'carte_brune', libelle: 'Carte Brune', action: 'Imprimer', ouvrir: () => setFenetreDocument('carte_brune'), fenetre: true },
    ] : []),
    ...(pieceJointe?.Presente ? [
      { cle: 'piece-jointe', libelle: 'Pièce jointe', detail: pieceJointe.Nom, action: 'Consulter', ouvrir: () => setPieceOuverte(true), fenetre: true },
    ] : []),
  ];

  const fenetres = (
    <>
      {/* Clé : valeurs de l'attestation reprises du contrat affiché (fenêtre montée avant son chargement) */}
      <ContractDocumentsModal
        key={id || 'aucun'}
        isOpen={Boolean(contract) && Boolean(fenetreDocument)}
        onClose={() => setFenetreDocument(null)}
        docType={fenetreDocument}
        contract={contract}
        onSaveContract={onSaveContract}
      />
      {/* Relevé de compte (quittance remise au client, modèle OREOLE) */}
      <ReleveCompteModal isOpen={releveOuvert} onClose={() => setReleveOuvert(false)} idContrat={id} />
      <FenetrePieceJointe type="contrat" id={id} fiche={pieceJointe} isOpen={pieceOuverte} onClose={() => setPieceOuverte(false)} />
    </>
  );

  return { documents, fenetres, mineneConnexes, ouvrirReleve: () => setReleveOuvert(true) };
};

/** Liste des documents : libellé et bouton « Imprimer » (ou « Editer ») ; onChoisir(document) au clic. */
export const ListeDocumentsContrat = ({ documents, onChoisir = (d) => d.ouvrir() }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.9rem' }}>
    {documents.map((d, i) => (
      <div key={d.cle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: i < documents.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
          <Paperclip size={16} color="#94a3b8" />
          <span style={{ color: 'var(--text-primary)' }}>{d.libelle}</span>
          {d.detail && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '22rem' }} title={d.detail}>{d.detail}</span>}
        </span>
        <button
          type="button"
          className="btn-link"
          style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
          onClick={() => onChoisir(d)}
        >
          {d.action}
        </button>
      </div>
    ))}
  </div>
);
