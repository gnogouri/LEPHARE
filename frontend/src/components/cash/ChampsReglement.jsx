import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { cashApi } from '../../api/endpoints';
import { ChoixBanque } from './BanqueModal';
import { aujourdhui, dateFr } from '../../utils/financeUtils';
import { nomCabinet } from '../../utils/parametrage';

// Champs du mode de règlement d'un encaissement, communs à l'encaissement des primes et au
// réencaissement d'un chèque impayé. Chaque mode n'affiche que ce qui le concerne :
//   Espèces : n° de bordereau ; Chèque / Virement / Traite : banque et numéro (le montant
//   initial seulement pour un chèque, qui entre au portefeuille) ; Paiement mobile : n° du
//   reçu de l'opérateur ; Compensation : référence et motif.
// Dates : chèque = date d'émission puis date de réception au cabinet (obligatoire, au plus tard
// aujourd'hui) ; tous les modes = date de saisie, toujours la date du jour, non modifiable.
// Chèque, virement ou traite : à l'ordre du cabinet (reversé ensuite par son chèque : bordereau de reversement de
// prime) ou de la compagnie (transmis tel quel : bordereau de réclamation de commission). Espèces : toujours
// directement au bordereau de réclamation de commission, sans reversement ni versement au compte de la compagnie
// (demande du 2026-10-20) ; le serveur applique la même règle.

// « Report d'encaissement » n'est pas un mode de paiement proposé à la caisse
export const modesProposes = (listeModes) => {
  const ordre = (m) => Number(m.ordreaffichage) || 99;
  return (Array.isArray(listeModes) ? listeModes : [])
    .filter((m) => !/report d.?encaissement/i.test(m.libellemodepaiement || ''))
    .sort((a, b) => ordre(a) - ordre(b));
};

// Nature du mode choisi (stdmodeencaissement.abregereglement, banque, compensation)
export const natureMode = (mode) => {
  const abrege = String(mode?.abregereglement || '').trim().toUpperCase();
  return {
    especes: abrege === 'ESP',
    cheque: abrege === 'CHQ',
    mobile: abrege === 'PYM',
    bancaire: Boolean(mode?.banque),
    compensation: Boolean(mode?.compensation),
    // Mode d'URANUS « A la compagnie » : chèque du client toujours à l'ordre de la compagnie
    aLaCompagnie: /^a la compagnie$/i.test(String(mode?.libellemodepaiement || '').trim()),
    libelleNumero: abrege === 'VIR' ? 'Numéro de virement' : abrege === 'TRT' ? 'Numéro de traite' : 'Numéro du chèque',
  };
};

// Modes qui contre-passent ou sortent de l'argent : pas de plafond au reste dû (même règle que save_premium_collection)
export const modeSansPlafond = (mode) => ['DMA', 'ANL', 'CPA'].includes(String(mode?.abregereglement || '').trim().toUpperCase());

// Libellés de l'opération selon le mode choisi (titre du formulaire, bouton de validation) :
// décaissement / réencaissement de prime mal affectée, annulation, compensation (CMP…),
// prélèvement sur salaire ; tout autre mode est un encaissement
const ACTIONS_REGLEMENT = {
  encaissement: { titre: "Enregistrement d'un Encaissement", bouton: "Valider l'Encaissement" },
  decaissement: { titre: "Enregistrement d'un Décaissement", bouton: 'Valider le Décaissement' },
  reencaissement: { titre: "Enregistrement d'un Réencaissement", bouton: 'Valider le Réencaissement' },
  contrepartie: { titre: "Enregistrement d'une Contrepartie d'annulation", bouton: 'Valider la Contrepartie' },
  annulation: { titre: "Enregistrement d'une Annulation", bouton: "Valider l'Annulation" },
  compensation: { titre: "Enregistrement d'une Compensation", bouton: 'Valider la Compensation' },
  prelevement: { titre: "Enregistrement d'un Prélèvement sur salaire", bouton: 'Valider le Prélèvement' },
};

export const actionReglement = (mode) => {
  const abrege = String(mode?.abregereglement || '').trim().toUpperCase();
  const libelle = String(mode?.libellemodepaiement || '');
  if (abrege === 'DMA' || /d.caissement/i.test(libelle)) return ACTIONS_REGLEMENT.decaissement;
  if (abrege === 'PMA' || /r.encaissement/i.test(libelle)) return ACTIONS_REGLEMENT.reencaissement;
  if (abrege === 'CPA') return ACTIONS_REGLEMENT.contrepartie;
  if (abrege === 'ANL') return ACTIONS_REGLEMENT.annulation;
  if (mode?.compensation || /^CMP\b/i.test(libelle)) return ACTIONS_REGLEMENT.compensation;
  if (/pr.l.vement/i.test(libelle)) return ACTIONS_REGLEMENT.prelevement;
  return ACTIONS_REGLEMENT.encaissement;
};

export const reglementVide = (nomEmetteur = '') => ({
  idMode: '',
  idBanque: '',
  numero: '',
  montantInitialCheque: '',
  numeroBordereau: '',
  numeroRecuOperateur: '',
  referenceCompensation: '',
  motifCompensation: '',
  ordre: 'CABINET',
  dateCheque: '',
  dateReceptionCheque: aujourdhui(),
  nomEmetteur,
});

// Références saisies en alphanumérique : lettres, chiffres, espaces et séparateurs usuels
const alphanumerique = (valeur) => valeur.replace(/[^\p{L}\p{N} \-/._]/gu, '');

// Champs envoyés à /api/enregistrementencaissement pour le mode choisi
export const champsReglementApi = (valeurs, mode) => {
  const nature = natureMode(mode);
  return {
    mode_encaissement: Number(valeurs.idMode),
    banque: nature.bancaire && valeurs.idBanque ? Number(valeurs.idBanque) : 1,
    numero_cheque: nature.bancaire ? valeurs.numero.trim() : '',
    montant_initial_cheque: nature.cheque && valeurs.montantInitialCheque ? Number(valeurs.montantInitialCheque) : null,
    numero_bordereau: nature.especes ? valeurs.numeroBordereau.trim() : '',
    numero_recu_operateur: nature.mobile ? valeurs.numeroRecuOperateur.trim() : '',
    reference_compensation: nature.compensation ? valeurs.referenceCompensation.trim() : '',
    motif_compensation: nature.compensation ? valeurs.motifCompensation.trim() : '',
    ordre_reglement: nature.aLaCompagnie || nature.especes ? 'COMPAGNIE' : (nature.bancaire && valeurs.ordre === 'COMPAGNIE' ? 'COMPAGNIE' : 'CABINET'),
    date_cheque: nature.cheque && valeurs.dateCheque ? valeurs.dateCheque : '',
    date_reception_cheque: nature.cheque && valeurs.dateReceptionCheque ? valeurs.dateReceptionCheque : '',
    nom_emetteur: valeurs.nomEmetteur.trim(),
  };
};

const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');

// montantAEncaisser (facultatif) : total réglé par ce chèque, comparé à son solde disponible ;
// onBanqueCreee (facultatif) : banque créée par le bouton « + », pour compléter la liste de l'écran
export const ChampsReglement = ({ modes, banques, valeurs, onChange, montantAEncaisser, onBanqueCreee }) => {
  const mode = modes.find((m) => String(m.idmodeencaissement) === String(valeurs.idMode));
  const nature = natureMode(mode);
  const saisie = (champ, filtre = (v) => v) => (e) => onChange(champ, filtre(e.target.value));

  // Chèque déjà au portefeuille (règlement de plusieurs quittances) : son montant initial est
  // repris et verrouillé, le solde disponible borne le montant encaissé (GET /api/cheques/statut/)
  const [chequeConnu, setChequeConnu] = useState(null);
  // Montant initial repris d'un chèque connu : vidé si le numéro saisi ne correspond plus à ce chèque
  const montantRepris = useRef(false);
  useEffect(() => {
    const numero = (valeurs.numero || '').trim();
    if (!nature.cheque || !valeurs.idBanque || numero.length < 3) { setChequeConnu(null); return undefined; }
    let actif = true;
    const minuterie = setTimeout(() => {
      cashApi.getChequeStatus({ numero_cheque: numero, banque: valeurs.idBanque })
        .then((r) => {
          if (!actif) return;
          setChequeConnu(r || null);
          if (r?.existe) {
            onChange('montantInitialCheque', String(Math.round(Number(r.montant_initial) || 0)));
            montantRepris.current = true;
          } else if (montantRepris.current) {
            onChange('montantInitialCheque', '');
            montantRepris.current = false;
          }
        })
        .catch(() => { if (actif) setChequeConnu(null); });
    }, 350);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [nature.cheque, valeurs.idBanque, valeurs.numero]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chèque annulé : réutilisé par cet encaissement (demande du 2026-11-12), avec le montant initial saisi, moins ce que des
  // pièces en cours en utilisent encore
  const chequeAnnule = Boolean(chequeConnu?.existe && chequeConnu.annule);
  const plafondCheque = chequeAnnule
    ? (Number(valeurs.montantInitialCheque) || Number(chequeConnu.montant_initial) || 0) - (Number(chequeConnu.montant_utilise) || 0)
    : (chequeConnu?.existe ? Number(chequeConnu.solde_disponible) : Number(valeurs.montantInitialCheque) || null);
  const depassementCheque = nature.cheque && plafondCheque !== null && Number(montantAEncaisser) > plafondCheque;

  return (
    <>
      <div className="form-group">
        <label className="form-label">Mode de paiement</label>
        <select className="form-control" required value={valeurs.idMode} onChange={saisie('idMode')}>
          <option value="">Choisir</option>
          {modes.map((m) => (
            <option key={m.idmodeencaissement} value={m.idmodeencaissement}>{m.libellemodepaiement}</option>
          ))}
        </select>
      </div>

      {nature.especes && (
        <div className="form-group">
          <label className="form-label">Numéro de bordereau</label>
          <input
            type="text"
            className="form-control"
            maxLength={50}
            value={valeurs.numeroBordereau}
            onChange={saisie('numeroBordereau', alphanumerique)}
          />
        </div>
      )}

      {nature.bancaire && (
        <div className="responsive-form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="reglement-banque">Banque émettrice</label>
            {/* « + » : banque absente de la liste créée sans quitter l'encaissement */}
            <ChoixBanque id="reglement-banque" banques={banques} value={valeurs.idBanque} required
              onChange={(idBanque) => onChange('idBanque', idBanque)} onBanqueCreee={onBanqueCreee} />
          </div>
          <div className="form-group">
            <label className="form-label">{nature.libelleNumero}</label>
            <input
              type="text"
              className="form-control"
              maxLength={50}
              value={valeurs.numero}
              onChange={saisie('numero', alphanumerique)}
            />
          </div>
          {nature.cheque && (
            <div className="form-group">
              <label className="form-label">Montant initial du chèque</label>
              <input
                type="number"
                className="form-control"
                min="0"
                placeholder="Au 1er usage, sauf chèque de l'échéancier"
                value={valeurs.montantInitialCheque}
                onChange={saisie('montantInitialCheque')}
                readOnly={Boolean(chequeConnu?.existe && !chequeConnu.montant_modifiable)}
                title={chequeConnu?.existe && !chequeConnu.montant_modifiable ? 'Montant fixé au premier usage du chèque' : undefined}
              />
            </div>
          )}
        </div>
      )}

      {nature.especes && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '-0.2rem 0 0.6rem' }}>
          Espèces : la prime part directement au bordereau de réclamation de commission de la compagnie, sans bordereau de
          reversement ni versement au compte de la compagnie.
        </div>
      )}

      {nature.bancaire && !nature.especes && (
        <div className="responsive-form-row">
          <div className="form-group">
            <label className="form-label">À l'ordre de</label>
            <select
              className="form-control"
              value={nature.aLaCompagnie ? 'COMPAGNIE' : (valeurs.ordre || 'CABINET')}
              onChange={saisie('ordre')}
              disabled={nature.aLaCompagnie}
            >
              <option value="CABINET">{nomCabinet()}</option>
              <option value="COMPAGNIE">La compagnie</option>
            </select>
          </div>
        </div>
      )}

      {/* Dates : émission du chèque, réception du chèque au cabinet, puis saisie dans le système (toujours la date du
          jour, non modifiable ; le serveur impose la même règle) */}
      <div className={nature.cheque ? 'responsive-form-row-3' : 'responsive-form-row'}>
        {nature.cheque && (
          <>
            <div className="form-group">
              <label className="form-label">Date d'émission du chèque</label>
              <input type="date" className="form-control" value={valeurs.dateCheque || ''} onChange={saisie('dateCheque')} />
            </div>
            <div className="form-group">
              <label className="form-label" title={`Date à laquelle ${nomCabinet()} a reçu le chèque`}>Date de réception du chèque</label>
              <input type="date" className="form-control" required max={aujourdhui()} value={valeurs.dateReceptionCheque || ''} onChange={saisie('dateReceptionCheque')} />
            </div>
          </>
        )}
        <div className="form-group">
          <label className="form-label">Date de saisie</label>
          <input type="text" className="form-control" value={dateFr(aujourdhui())} readOnly disabled title="Date du jour : non modifiable"
            style={{ background: 'rgba(148, 163, 184, 0.14)', color: 'var(--text-secondary)', cursor: 'not-allowed' }} />
        </div>
      </div>


      {nature.cheque && chequeAnnule && (
        <div className="cheque-reutilise compact" role="status">
          <RotateCcw size={16} aria-hidden="true" />
          <span>
            <strong>Chèque annulé{chequeConnu.date_annulation ? ` le ${dateFr(chequeConnu.date_annulation)}` : ''}</strong>
            {chequeConnu.motif_annulation ? ` (« ${chequeConnu.motif_annulation} »)` : ''} : il sera réutilisé pour cet encaissement.
            {' '}Montant disponible : {fcfa(plafondCheque)} F ; le montant initial reste corrigeable.
          </span>
          {depassementCheque && <span className="depasse"> Le montant à encaisser ({fcfa(montantAEncaisser)} F) dépasse ce disponible.</span>}
        </div>
      )}
      {nature.cheque && chequeConnu && !chequeAnnule && (
        <div style={{ fontSize: '0.8rem', marginTop: '-0.3rem', color: depassementCheque ? 'var(--accent-rose)' : 'var(--text-secondary)' }}>
          {chequeConnu.existe
            ? `Chèque déjà enregistré : montant initial ${fcfa(chequeConnu.montant_initial)} F, solde disponible ${fcfa(chequeConnu.solde_disponible)} F.`
            : 'Nouveau chèque : saisissez son montant initial ; il pourra régler plusieurs quittances sans jamais dépasser ce montant.'}
          {depassementCheque && ` Le montant à encaisser (${fcfa(montantAEncaisser)} F) dépasse ce que le chèque permet (${fcfa(plafondCheque)} F).`}
        </div>
      )}

      {nature.mobile && (
        <div className="form-group">
          <label className="form-label">Numéro du reçu de l'opérateur (* requis)</label>
          <input
            type="text"
            className="form-control"
            required
            maxLength={50}
            placeholder="Reçu Orange Money, MTN, Moov, Wave…"
            value={valeurs.numeroRecuOperateur}
            onChange={saisie('numeroRecuOperateur', alphanumerique)}
          />
        </div>
      )}

      {nature.compensation && (
        <div className="responsive-form-row">
          <div className="form-group">
            <label className="form-label">Référence de la compensation (* requis)</label>
            <input
              type="text"
              className="form-control"
              required
              maxLength={50}
              value={valeurs.referenceCompensation}
              onChange={saisie('referenceCompensation', alphanumerique)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Motif de la compensation (* requis)</label>
            <input
              type="text"
              className="form-control"
              required
              maxLength={255}
              value={valeurs.motifCompensation}
              onChange={saisie('motifCompensation')}
            />
          </div>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Nom de l'émetteur</label>
        <input
          type="text"
          className="form-control"
          required
          maxLength={50}
          value={valeurs.nomEmetteur}
          onChange={saisie('nomEmetteur')}
        />
      </div>
    </>
  );
};

export default ChampsReglement;
