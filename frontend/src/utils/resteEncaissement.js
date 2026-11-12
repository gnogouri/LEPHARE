// Reste à encaisser d'une quittance : un reliquat de moins de 5 F (1 à 4 F, ou quelques centimes) compte comme nul,
// pour qu'un très faible écart ne bloque ni le solde ni l'attestation ; un trop-perçu aussi. Même règle que le serveur
// (production/reste_encaissement.py, sp_enregistrement_encaissement v6).
export const RELIQUAT_NEGLIGEABLE = 5;

export const resteAEncaisser = (primeTtc, encaisse) => {
  const reste = Math.round(((Number(primeTtc) || 0) - (Number(encaisse) || 0)) * 100) / 100;
  return reste >= RELIQUAT_NEGLIGEABLE ? reste : 0;
};

export const estSolde = (primeTtc, encaisse) => resteAEncaisser(primeTtc, encaisse) === 0;
