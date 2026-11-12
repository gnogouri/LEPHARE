import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Edit2, Landmark, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { DataTable } from '../../../components/common/DataTable';
import { BanqueModal, cleBanque } from '../../../components/cash/BanqueModal';
import { settingsApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { confirmer } from '../../../utils/dialogue';
import { messageErreurApi } from '../../../utils/financeUtils';

// « NEANT » : banque enregistrée pour les règlements sans banque (espèces, paiement mobile…), ni modifiable ni supprimable
const ID_BANQUE_NEANT = 1;
// Opérations qui désignent une banque (GET /api/banque/utilisations/) : clé, singulier, pluriel
const UTILISATIONS = [
  ['Encaissements', 'encaissement', 'encaissements'],
  ['Cheques', 'chèque', 'chèques'],
  ['Reversements', 'reversement', 'reversements'],
  ['PaiementsCommission', 'paiement de commissions', 'paiements de commissions'],
];

// Texte comparé sans accents ni ponctuation, mots séparés par une espace
const texteRecherche = (texte) => String(texte || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ').trim();

const tuile = { background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '1rem 1.25rem' };
const libelleTuile = { fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' };
const boutonLigne = { fontSize: '0.75rem', padding: '0.25rem 0.55rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' };

/**
 * Administration > Listes de référence > Banques : banques proposées pour les chèques, virements et traites (caisse,
 * échéanciers, reversements, paiements de commissions). Création et modification dans BanqueModal, la même fenêtre que
 * le bouton « + » de la caisse ; une banque déjà utilisée ne se supprime pas (elle se renomme).
 */
export const BanquesPage = () => {
  const { success, error: toastError } = useToast();
  const [banques, setBanques] = useState([]);
  const [utilisations, setUtilisations] = useState({});
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState('');
  // Fenêtre ouverte : { banque: null } pour une création, { banque } pour une modification
  const [fenetre, setFenetre] = useState(null);

  const charger = async () => {
    setChargement(true);
    try {
      const [liste, usages] = await Promise.all([settingsApi.getBanques(), settingsApi.getUtilisationsBanques()]);
      setBanques(Array.isArray(liste) ? liste : []);
      setUtilisations(usages || {});
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setChargement(false);
    }
  };

  useEffect(() => { charger(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const usage = (b) => utilisations[String(b.idbanque)] || {};
  const nombreUtilisations = (b) => Object.values(usage(b)).reduce((total, n) => total + (Number(n) || 0), 0);
  const reelles = banques.filter((b) => b.idbanque !== ID_BANQUE_NEANT);
  const utilisees = reelles.filter((b) => nombreUtilisations(b) > 0).length;

  // Recherche dans le nom (mots gardés : « eco » ne trouve pas « DE COTE ») ou au début du nom collé (« gtbank » trouve
  // « GT BANK »), et dans le code
  const filtrees = useMemo(() => {
    const terme = texteRecherche(recherche);
    const cle = cleBanque(recherche);
    if (!cle) return banques;
    return banques.filter((b) => texteRecherche(b.libelle).includes(terme) || cleBanque(b.libelle).startsWith(cle)
      || (b.code_banque !== '00' && cleBanque(b.code_banque).includes(cle)));
  }, [banques, recherche]);

  // Noms identiques une fois accents, espaces et ponctuation retirés (« GT BANK » et « GTBANK »)
  const doublons = useMemo(() => {
    const groupes = new Map();
    banques.forEach((b) => {
      const cle = cleBanque(b.libelle);
      if (cle) groupes.set(cle, [...(groupes.get(cle) || []), b]);
    });
    return [...groupes.values()].filter((g) => g.length > 1);
  }, [banques]);

  const supprimer = async (b) => {
    if (!(await confirmer({
      ton: 'danger',
      titre: 'Supprimer la banque ?',
      message: `${b.libelle.trim()} ne sera plus proposée à la caisse. Elle n'a jamais été utilisée.`,
      confirmer: 'Supprimer la banque',
      annuler: 'Garder la banque',
    }))) return;
    try {
      await settingsApi.deleteBanque(b.idbanque);
      success(`Banque ${b.libelle.trim()} supprimée.`);
      charger();
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };

  const colonnes = [
    {
      header: 'Banque',
      accessor: 'libelle',
      render: (b) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Landmark size={14} style={{ color: 'var(--primary-500)', flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{b.libelle.trim()}</span>
          {b.idbanque === ID_BANQUE_NEANT && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>règlements sans banque</span>
          )}
        </div>
      ),
    },
    {
      header: 'Code',
      accessor: 'code_banque',
      render: (b) => (b.code_banque && b.code_banque !== '00'
        ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{b.code_banque}</span>
        : <span style={{ color: 'var(--text-muted)' }}>-</span>),
    },
    {
      header: 'Utilisation',
      sortAccessor: (b) => nombreUtilisations(b),
      render: (b) => {
        const u = usage(b);
        const parties = UTILISATIONS.filter(([cle]) => u[cle]).map(([cle, un, plusieurs]) => `${Number(u[cle]).toLocaleString('fr-FR')} ${u[cle] > 1 ? plusieurs : un}`);
        return parties.length
          ? <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{parties.join(' · ')}</span>
          : <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Jamais utilisée</span>;
      },
    },
    {
      header: 'Actions',
      render: (b) => {
        const neant = b.idbanque === ID_BANQUE_NEANT;
        const utilisee = nombreUtilisations(b) > 0;
        return (
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button type="button" className="btn btn-secondary" style={boutonLigne} disabled={neant}
              title={neant ? 'Banque des règlements sans banque : non modifiable' : undefined}
              aria-label={`Modifier ${b.libelle.trim()}`} onClick={() => setFenetre({ banque: b })}>
              <Edit2 size={13} /> Modifier
            </button>
            <button type="button" className="btn btn-secondary" style={{ ...boutonLigne, color: neant || utilisee ? undefined : 'var(--accent-rose)' }}
              disabled={neant || utilisee}
              title={neant ? 'Banque des règlements sans banque : non supprimable' : utilisee ? 'Banque déjà utilisée : renommez-la si besoin' : undefined}
              aria-label={`Supprimer ${b.libelle.trim()}`} onClick={() => supprimer(b)}>
              <Trash2 size={13} /> Supprimer
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Banques</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.3rem 0 0', maxWidth: 760 }}>
            Banques proposées pour les chèques, virements et traites : encaissements, échéanciers, reversements et paiements de
            commissions. La caisse peut aussi en créer une sans quitter l'encaissement (bouton « + » à côté de la banque émettrice).
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.65rem' }}>
          <button type="button" className="btn btn-secondary" onClick={charger} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
            <RefreshCw size={14} /> Actualiser
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setFenetre({ banque: null })}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
            <Plus size={14} /> Nouvelle banque
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        <div style={tuile}>
          <div style={libelleTuile}>Banques</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary-500)', marginTop: '0.25rem' }}>{reelles.length}</div>
        </div>
        <div style={tuile}>
          <div style={libelleTuile}>Déjà utilisées</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent-emerald)', marginTop: '0.25rem' }}>{utilisees}</div>
        </div>
        <div style={tuile}>
          <div style={libelleTuile}>Jamais utilisées</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{reelles.length - utilisees}</div>
        </div>
      </div>

      {doublons.length > 0 && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.8rem 1rem', borderRadius: '8px', fontSize: '0.82rem',
          border: '1px solid rgba(245, 158, 11, 0.45)', background: 'rgba(245, 158, 11, 0.08)', color: 'var(--text-secondary)' }}>
          <AlertTriangle size={16} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            Même banque enregistrée plusieurs fois : {doublons.map((g) => g.map((b) => b.libelle.trim()).join(' et ')).join(' ; ')}.
            {' '}Une banque utilisée ne se supprime pas : renommez celle qui est mal écrite ou supprimez celle qui n'a jamais servi.
          </span>
        </div>
      )}

      <div style={{ position: 'relative', maxWidth: 420 }}>
        <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input type="search" className="form-control" value={recherche} onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher une banque ou un code" aria-label="Rechercher une banque" style={{ paddingLeft: '2.2rem' }} />
      </div>

      {/* Remonté à chaque recherche : la liste filtrée repart de sa première page */}
      <DataTable key={recherche} columns={colonnes} data={filtrees} loading={chargement} loadingText="Chargement des banques…"
        searchable={false} itemsPerPage={25} />

      <BanqueModal isOpen={Boolean(fenetre)} onClose={() => setFenetre(null)} banque={fenetre?.banque || null} banques={banques}
        onEnregistree={() => charger()} />
    </div>
  );
};

export default BanquesPage;
