import React, { useEffect, useState } from 'react';
import { Save, RotateCcw, Loader2 } from 'lucide-react';
import { AmountInput } from '../common/AmountInput';
import { parametrageApi } from '../../api/endpoints';
import { messageErreurApi } from '../../utils/financeUtils';
import { useToast } from '../../context/ToastContext';

const formatDateHeure = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const affichage = (p, v) => {
  if (v === '' || v === null || v === undefined) return 'vide';
  if (p.Type === 'date') return String(v).split('-').reverse().join('/');
  if (p.Type === 'booleen') return ['true', '1', 'oui'].includes(String(v).toLowerCase()) ? 'Oui' : 'Non';
  if (['montant'].includes(p.Type)) return `${Number(v).toLocaleString('fr-FR')} F`;
  if (p.Type === 'texte_long') return String(v).split(/\r?\n/).length > 1 ? `${String(v).split(/\r?\n/).length} lignes` : v;
  return `${v}${p.Unite ? ` ${p.Unite}` : ''}`;
};

/**
 * Un paramètre (lephare_parametre) : saisie typée, unité, valeur d'origine, dernière modification.
 * `modifier` / `retablir` : appels d'enregistrement (par défaut, route des règles de gestion du cabinet).
 */
export const LigneParametre = ({
  parametre,
  onEnregistre,
  modifier = parametrageApi.modifierParametre,
  retablir = parametrageApi.retablirParametre,
  lignes = 3,
}) => {
  const { success, error: toastError } = useToast();
  const [valeur, setValeur] = useState(parametre.Valeur);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => setValeur(parametre.Valeur), [parametre.Valeur]);
  const modifie = String(valeur ?? '') !== String(parametre.Valeur ?? '');
  const different = String(parametre.Valeur ?? '') !== String(parametre.ValeurOrigine ?? '');

  const envoyer = async (retour) => {
    setEnvoi(true);
    try {
      const p = retour ? await retablir(parametre.Cle) : await modifier(parametre.Cle, valeur);
      onEnregistre(p);
      success(`${parametre.Libelle} : ${retour ? 'valeur d\'origine rétablie' : 'enregistré'}.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  let saisie;
  if (parametre.Type === 'image') {
    saisie = null;
  } else if (parametre.Type === 'booleen') {
    saisie = (
      <select className="form-control" value={['true', '1'].includes(String(valeur)) ? 'true' : 'false'} onChange={(e) => setValeur(e.target.value)}>
        <option value="true">Oui</option>
        <option value="false">Non</option>
      </select>
    );
  } else if (parametre.Type === 'date') {
    saisie = <input type="date" className="form-control" value={valeur || ''} onChange={(e) => setValeur(e.target.value)} />;
  } else if (parametre.Type === 'montant') {
    saisie = <AmountInput value={valeur === '' || !Number.isFinite(Number(valeur)) ? '' : Math.round(Number(valeur))} onChange={(n) => setValeur(String(n))} suffix="FCFA" />;
  } else if (['entier', 'decimal', 'pourcentage'].includes(parametre.Type)) {
    saisie = (
      <div style={{ position: 'relative' }}>
        <input type="number" className="form-control" step={parametre.Type === 'entier' ? 1 : 'any'}
          min={parametre.Minimum ?? undefined} max={parametre.Maximum ?? undefined}
          value={valeur ?? ''} onChange={(e) => setValeur(e.target.value)} style={{ paddingRight: parametre.Unite ? '3rem' : undefined }} />
        {parametre.Unite && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{parametre.Unite}</span>}
      </div>
    );
  } else if (parametre.Type === 'texte_long') {
    saisie = <textarea className="form-control" rows={lignes} value={valeur || ''} onChange={(e) => setValeur(e.target.value)} />;
  } else {
    saisie = <input type="text" className="form-control" value={valeur || ''} maxLength={200} onChange={(e) => setValeur(e.target.value)} />;
  }

  return (
    <div className="ligne-parametre">
      <div>
        <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{parametre.Libelle}</div>
        {parametre.Aide && <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 2 }}>{parametre.Aide}</div>}
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
          Valeur d'origine : <strong>{affichage(parametre, parametre.ValeurOrigine)}</strong>
          {parametre.ModifiePar && different ? ` - modifiée le ${formatDateHeure(parametre.DateModification)} par ${parametre.ModifiePar}` : ''}
        </div>
      </div>
      <div>{saisie}</div>
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <button type="button" className="btn btn-primary" disabled={!modifie || envoi} onClick={() => envoyer(false)} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
          {envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer
        </button>
        {different && (
          <button type="button" className="btn btn-secondary" disabled={envoi} onClick={() => envoyer(true)} title="Rétablir la valeur d'origine" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
            <RotateCcw size={14} /> Rétablir
          </button>
        )}
      </div>
    </div>
  );
};

export default LigneParametre;
