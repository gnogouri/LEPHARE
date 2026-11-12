import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { Modal } from '../common/Modal';
import { settingsApi } from '../../api/endpoints';
import { useToast } from '../../context/ToastContext';
import { aLeDroit } from '../../utils/droits';
import { messageErreurApi } from '../../utils/financeUtils';

// Nom de banque comparé sans accents, espaces ni ponctuation, comme le serveur (« GT BANK » = « GTBANK »)
export const cleBanque = (libelle) => String(libelle || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');

// Nom tel qu'il sera enregistré : espaces réduits, majuscules
const libelleNet = (valeur) => String(valeur || '').replace(/\s+/g, ' ').trim().toUpperCase();

const messageChamp = { fontSize: '0.75rem', marginTop: '0.3rem' };

/**
 * Création ou modification d'une banque (stdbanque) : depuis la caisse (bouton « + » de la banque émettrice) ou depuis
 * l'administration (Listes de référence > Banques). Doublon signalé pendant la saisie, refusé aussi par le serveur ;
 * banques proches rappelées pour éviter un doublon mal orthographié. onEnregistree(banque) reçoit la banque enregistrée.
 */
export const BanqueModal = ({ isOpen, onClose, banque = null, banques = [], onEnregistree }) => {
  const { success, error: toastError } = useToast();
  const [libelle, setLibelle] = useState('');
  const [code, setCode] = useState('');
  const [erreurs, setErreurs] = useState({});
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLibelle(banque?.libelle?.trim() || '');
    setCode(banque?.code_banque && banque.code_banque !== '00' ? banque.code_banque : '');
    setErreurs({});
  }, [isOpen, banque]);

  const autres = useMemo(() => banques.filter((b) => !banque || b.idbanque !== banque.idbanque), [banques, banque]);
  const cle = cleBanque(libelle);
  const doublon = cle ? autres.find((b) => cleBanque(b.libelle) === cle) : null;
  const proches = cle.length >= 3 && !doublon
    ? autres.filter((b) => { const k = cleBanque(b.libelle); return k && (k.includes(cle) || cle.includes(k)); }).slice(0, 5)
    : [];

  const enregistrer = async (e) => {
    e.preventDefault();
    // Fenêtre ouverte depuis le formulaire d'encaissement : son envoi ne doit pas valider l'encaissement
    e.stopPropagation();
    if (!libelleNet(libelle)) { setErreurs({ libelle: 'Saisissez le nom de la banque.' }); return; }
    if (doublon) return;
    setEnvoi(true);
    try {
      const donnees = { libelle: libelleNet(libelle), code_banque: code.replace(/\s+/g, '').toUpperCase() };
      const enregistree = banque
        ? await settingsApi.updateBanque(banque.idbanque, donnees)
        : await settingsApi.createBanque(donnees);
      success(banque ? `Banque ${enregistree.libelle} modifiée.` : `Banque ${enregistree.libelle} créée.`);
      onEnregistree?.(enregistree);
      onClose();
    } catch (err) {
      const data = err?.response?.data || {};
      const champ = (nom) => (Array.isArray(data[nom]) ? data[nom].join(' ') : data[nom]);
      if (champ('libelle') || champ('code_banque')) setErreurs({ libelle: champ('libelle'), code: champ('code_banque') });
      else toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="small" title={banque ? 'Modifier la banque' : 'Nouvelle banque'}
      subtitle="Proposée ensuite pour les chèques, virements et traites.">
      <form onSubmit={enregistrer} noValidate>
        <div className="form-group">
          <label className="form-label" htmlFor="banque-libelle">Nom de la banque *</label>
          <input id="banque-libelle" className="form-control" value={libelle} maxLength={50} autoFocus autoComplete="off"
            placeholder="Ex. Société Générale Côte d'Ivoire" style={{ textTransform: libelle ? 'uppercase' : 'none' }}
            aria-invalid={Boolean(doublon || erreurs.libelle)}
            onChange={(e) => { setLibelle(e.target.value); setErreurs((x) => ({ ...x, libelle: '' })); }} />
          {doublon ? (
            <div style={{ ...messageChamp, color: 'var(--accent-rose)' }}>Cette banque existe déjà : {doublon.libelle.trim()}.</div>
          ) : erreurs.libelle ? (
            <div style={{ ...messageChamp, color: 'var(--accent-rose)' }}>{erreurs.libelle}</div>
          ) : proches.length > 0 && (
            <div style={{ ...messageChamp, color: 'var(--text-muted)' }}>
              Banques proches déjà enregistrées : {proches.map((b) => b.libelle.trim()).join(', ')}.
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="banque-code">Code banque</label>
          <input id="banque-code" className="form-control" value={code} maxLength={20} autoComplete="off"
            placeholder="Facultatif, ex. CI008" style={{ textTransform: code ? 'uppercase' : 'none' }} aria-invalid={Boolean(erreurs.code)}
            onChange={(e) => { setCode(e.target.value); setErreurs((x) => ({ ...x, code: '' })); }} />
          {erreurs.code && <div style={{ ...messageChamp, color: 'var(--accent-rose)' }}>{erreurs.code}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.25rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={envoi}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={envoi || !libelleNet(libelle) || Boolean(doublon)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <Save size={14} /> {envoi ? 'Enregistrement…' : banque ? 'Enregistrer' : 'Créer la banque'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

/**
 * Liste des banques suivie d'un bouton « + » (qui peut encaisser ou régler le paramétrage) : la banque créée dans
 * BanqueModal est ajoutée à la liste et choisie. onBanqueCreee(banque) permet à l'écran de compléter sa propre liste.
 */
export const ChoixBanque = ({ banques = [], value, onChange, onBanqueCreee, required = false, libelleVide = 'Choisir', id }) => {
  const [ouvert, setOuvert] = useState(false);
  const [ajoutees, setAjoutees] = useState([]);
  const peutCreer = aLeDroit('encaissements.create') || aLeDroit('parametrage.update');
  const liste = useMemo(() => {
    const vues = new Set();
    return [...banques, ...ajoutees]
      .filter((b) => !vues.has(b.idbanque) && vues.add(b.idbanque))
      .sort((a, b) => String(a.libelle).localeCompare(String(b.libelle), 'fr'));
  }, [banques, ajoutees]);

  const creee = (banque) => {
    setAjoutees((l) => [...l, banque]);
    onBanqueCreee?.(banque);
    onChange(String(banque.idbanque));
  };

  return (
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'stretch' }}>
      <select id={id} className="form-control" required={required} value={value} onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, minWidth: 0 }}>
        <option value="">{libelleVide}</option>
        {liste.map((b) => <option key={b.idbanque} value={b.idbanque}>{b.libelle}</option>)}
      </select>
      {peutCreer && (
        <>
          <button type="button" className="btn btn-secondary" onClick={() => setOuvert(true)}
            title="Créer une banque absente de la liste" aria-label="Créer une banque"
            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 0.6rem' }}>
            <Plus size={16} />
          </button>
          <BanqueModal isOpen={ouvert} onClose={() => setOuvert(false)} banques={liste} onEnregistree={creee} />
        </>
      )}
    </div>
  );
};

export default BanqueModal;
