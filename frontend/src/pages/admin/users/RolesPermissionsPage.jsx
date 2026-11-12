import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, AlertTriangle, MessageSquareText, Split } from 'lucide-react';
import { EnTeteParametrage, SectionParametrage } from '../../../components/admin/EnTeteParametrage';
import { securiteApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

// Administration > Droits : catalogue des actions contrôlées par le serveur, regroupées par module,
// avec les rôles qui les accordent. Réglages par action : motif obligatoire, séparation des tâches.
const Interrupteur = ({ actif, onChange, desactive, titre }) => (
  <button type="button" role="switch" aria-checked={actif} title={titre} disabled={desactive} onClick={() => onChange(!actif)}
    style={{ width: 36, height: 20, borderRadius: 999, border: 'none', cursor: desactive ? 'not-allowed' : 'pointer', position: 'relative', background: actif ? 'var(--accent-emerald)' : 'var(--border-medium)', opacity: desactive ? 0.35 : 1, flexShrink: 0 }}>
    <span style={{ position: 'absolute', top: 3, left: actif ? 19 : 3, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
  </button>
);

export const RolesPermissionsPage = () => {
  const { peut } = useAuth();
  const { success, error: toastError } = useToast();
  const gerer = peut('roles.manage');
  const [modules, setModules] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [envoi, setEnvoi] = useState('');

  useEffect(() => {
    securiteApi.droits()
      .then(setModules)
      .catch((err) => toastError(`Droits non chargés : ${messageErreurApi(err)}`))
      .finally(() => setChargement(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const regler = async (droit, cle, valeur) => {
    setEnvoi(`${droit.code}-${cle}`);
    try {
      const maj = await securiteApi.reglerDroit(droit.code, { [cle]: valeur });
      setModules((liste) => liste.map((m) => ({ ...m, droits: m.droits.map((d) => (d.code === maj.code ? { ...d, ...maj } : d)) })));
      success(`« ${droit.libelle} » : ${cle === 'motif_obligatoire' ? `motif ${valeur ? 'exigé' : 'facultatif'}` : `séparation des tâches ${valeur ? 'activée' : 'désactivée'}`}.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi('');
    }
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <EnTeteParametrage
        icone={KeyRound}
        titre="Droits"
        description="Les actions que le serveur contrôle, module par module : un utilisateur ne peut les exécuter (même en appelant directement l'API) que si l'un de ses rôles actifs les accorde."
        usage="Motif obligatoire : l'opération demande une justification, enregistrée au journal avec l'auteur et les valeurs avant / après. Séparation des tâches : l'auteur d'une opération ne peut pas la valider lui-même (proposée là où le serveur sait retrouver l'auteur)."
      />
      {chargement ? <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}><Loader2 className="spin" /> Chargement…</div> : modules.map((m) => (
        <SectionParametrage key={m.module} icone={KeyRound} titre={m.libelle} description={`${m.droits.length} action${m.droits.length > 1 ? 's' : ''} contrôlée${m.droits.length > 1 ? 's' : ''}.`}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.45rem 0.4rem' }}>Action</th>
                  <th style={{ padding: '0.45rem 0.4rem' }}>Rôles qui l'accordent</th>
                  <th style={{ padding: '0.45rem 0.4rem', width: 90 }} title="Motif obligatoire"><MessageSquareText size={13} /> Motif</th>
                  <th style={{ padding: '0.45rem 0.4rem', width: 110 }} title="Séparation des tâches"><Split size={13} /> Séparation</th>
                </tr>
              </thead>
              <tbody>
                {m.droits.map((d) => (
                  <tr key={d.code} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '0.5rem 0.4rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        {d.libelle} {d.sensible && <AlertTriangle size={12} style={{ color: 'var(--accent-amber)' }} title="Opération sensible : valeurs avant / après journalisées" />}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}><code>{d.code}</code>{d.description ? ` - ${d.description}` : ''}</div>
                    </td>
                    <td style={{ padding: '0.5rem 0.4rem' }}>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {d.roles.map((r) => (
                          <span key={r.id} style={{ padding: '0.1rem 0.5rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, background: 'var(--primary-glow)', color: 'var(--primary-500)', opacity: r.actif ? 1 : 0.5 }}>{r.libelle}</span>
                        ))}
                        {!d.roles.length && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Aucun rôle (administrateurs seulement)</span>}
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem 0.4rem' }}>
                      <Interrupteur actif={d.motif_obligatoire} desactive={!gerer || envoi === `${d.code}-motif_obligatoire`} titre="Motif obligatoire" onChange={(v) => regler(d, 'motif_obligatoire', v)} />
                    </td>
                    <td style={{ padding: '0.5rem 0.4rem' }}>
                      <Interrupteur actif={d.separation_taches} desactive={!gerer || !d.separation_possible || envoi === `${d.code}-separation_taches`}
                        titre={d.separation_possible ? 'L\'auteur de l\'opération ne peut pas l\'exécuter lui-même' : 'Non disponible pour cette action'}
                        onChange={(v) => regler(d, 'separation_taches', v)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionParametrage>
      ))}
    </div>
  );
};

export default RolesPermissionsPage;
