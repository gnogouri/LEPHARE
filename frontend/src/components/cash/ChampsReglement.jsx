import React from 'react';

// Champs du mode de règlement d'un encaissement, communs à l'encaissement des primes et au
// réencaissement d'un chèque impayé. Chaque mode n'affiche que ce qui le concerne :
//   Espèces : n° de bordereau ; Chèque / Virement / Traite : banque et numéro (le montant
//   initial seulement pour un chèque, qui entre au portefeuille) ; Paiement mobile : n° du
//   reçu de l'opérateur ; Compensation : référence et motif.

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
    libelleNumero: abrege === 'VIR' ? 'Numéro de virement' : abrege === 'TRT' ? 'Numéro de traite' : 'Numéro du chèque',
  };
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
    nom_emetteur: valeurs.nomEmetteur.trim(),
  };
};

export const ChampsReglement = ({ modes, banques, valeurs, onChange }) => {
  const mode = modes.find((m) => String(m.idmodeencaissement) === String(valeurs.idMode));
  const nature = natureMode(mode);
  const saisie = (champ, filtre = (v) => v) => (e) => onChange(champ, filtre(e.target.value));

  return (
    <>
      <div className="form-group">
        <label className="form-label">Mode de paiement</label>
        <select className="form-control" required value={valeurs.idMode} onChange={saisie('idMode')}>
          <option value="">— Choisir —</option>
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
            <label className="form-label">Banque émettrice</label>
            <select className="form-control" required value={valeurs.idBanque} onChange={saisie('idBanque')}>
              <option value="">— Choisir —</option>
              {banques.map((b) => (
                <option key={b.idbanque} value={b.idbanque}>{b.libelle}</option>
              ))}
            </select>
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
              />
            </div>
          )}
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
