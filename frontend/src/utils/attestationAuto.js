import { quoteApi } from '../api/endpoints';
import { downloadBlob } from './exportUtils';

export const messageErreurDemandeEditionAttestation = async (error) => {
  const data = error?.response?.data;
  let detail = data;

  if (typeof data?.text === 'function') {
    const contenu = (await data.text()).trim();
    try {
      detail = JSON.parse(contenu);
    } catch {
      detail = contenu;
    }
  }

  if (typeof detail === 'string' && detail) return detail;
  if (detail && typeof detail === 'object') {
    const message = detail.detail || detail.error || detail.message;
    if (typeof message === 'string' && message) return message;
  }
  return error?.message || 'erreur serveur';
};

export const telechargerDemandeEditionAttestationAuto = async (idDevis) => {
  const response = await quoteApi.telechargerDemandeEditionAttestationAuto(idDevis);
  if (!(response.data instanceof Blob) || response.data.size === 0) {
    throw new Error('Le serveur n’a pas retourné de fichier Excel valide.');
  }
  if (response.data.type && !response.data.type.includes('spreadsheetml')) {
    throw new Error('Le serveur a retourné un contenu qui n’est pas un fichier Excel.');
  }
  downloadBlob(response.data, `Demande_Edition_Attestation_${idDevis}.xlsx`);
};
