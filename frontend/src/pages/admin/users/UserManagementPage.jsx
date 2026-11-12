import React, { useEffect, useMemo, useState } from 'react';
import { confirmer } from '../../../utils/dialogue';
import {
  Users, UserPlus, Search, Loader2, Check, X, Lock, Unlock, KeyRound, ShieldCheck, Activity, Save, AlertTriangle,
} from 'lucide-react';
import { EnTeteParametrage } from '../../../components/admin/EnTeteParametrage';
import { Modal } from '../../../components/common/Modal';
import { securiteApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

// Administration > Utilisateurs : comptes LE PHARE (repris d'URANUS ou créés ici), rôles attribués,
// droits effectifs et activité récente. API : autorisations/views_securite.py
const dateHeure = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const pastille = (fond, couleur) => ({ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.1rem 0.5rem', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, background: fond, color: couleur, whiteSpace: 'nowrap' });
const COULEURS_RESULTAT = { SUCCES: 'var(--accent-emerald)', ECHEC: 'var(--accent-rose)', REFUS: 'var(--accent-amber)' };

const ChoixRoles = ({ roles, choisis, onChange }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 230px), 1fr))', gap: '0.4rem' }}>
    {roles.map((r) => (
      <label key={r.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.5rem 0.6rem', borderRadius: 8, border: `1px solid ${choisis.includes(r.id) ? 'var(--primary-500)' : 'var(--border-subtle)'}`, cursor: 'pointer', opacity: r.actif ? 1 : 0.55 }}>
        <input type="checkbox" checked={choisis.includes(r.id)} onChange={(e) => onChange(e.target.checked ? [...choisis, r.id] : choisis.filter((i) => i !== r.id))} style={{ marginTop: 3, accentColor: 'var(--primary-500)' }} />
        <span>
          <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{r.libelle}{!r.actif && ' (inactif)'}</span>
          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{r.droits.length} droit{r.droits.length > 1 ? 's' : ''}</span>
        </span>
      </label>
    ))}
  </div>
);

export const UserManagementPage = () => {
  const { peut, user: moi, rafraichirSession } = useAuth();
  const { success, error: toastError } = useToast();
  const [liste, setListe] = useState([]);
  const [roles, setRoles] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [filtres, setFiltres] = useState({ q: '', role: '', etat: 'actifs' });
  const [detail, setDetail] = useState(null);
  const [rolesSaisis, setRolesSaisis] = useState([]);
  const [nomSaisi, setNomSaisi] = useState('');
  const [expirationSaisie, setExpirationSaisie] = useState('');
  const [creation, setCreation] = useState(null);
  const [motDePasse, setMotDePasse] = useState(null);
  const [envoi, setEnvoi] = useState('');

  const charger = async () => {
    setChargement(true);
    try {
      const [utilisateurs, listeRoles] = await Promise.all([securiteApi.utilisateurs(filtres), securiteApi.roles()]);
      setListe(utilisateurs);
      setRoles(listeRoles);
    } catch (err) {
      toastError(`Utilisateurs non chargés : ${messageErreurApi(err)}`);
    } finally {
      setChargement(false);
    }
  };
  useEffect(() => { charger(); }, [filtres.role, filtres.etat]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const minuterie = setTimeout(charger, 350);
    return () => clearTimeout(minuterie);
  }, [filtres.q]); // eslint-disable-line react-hooks/exhaustive-deps

  const ouvrir = async (u) => {
    try {
      const d = await securiteApi.utilisateur(u.id);
      setDetail(d);
      setRolesSaisis(d.roles.map((r) => r.id));
      setNomSaisi(d.nom);
      setExpirationSaisie(d.date_expiration ? d.date_expiration.slice(0, 10) : '');
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };

  const apresModification = async (maj, message) => {
    success(message);
    setListe((l) => l.map((x) => (x.id === maj.id ? { ...x, ...maj } : x)));
    if (detail?.id === maj.id) await ouvrir(maj);
    if (maj.id === moi?.id) await rafraichirSession();
  };

  const enregistrerDetail = async () => {
    setEnvoi('detail');
    try {
      const maj = await securiteApi.modifierUtilisateur(detail.id, { nom: nomSaisi, roles: rolesSaisis, date_expiration: expirationSaisie || null });
      await apresModification(maj, `${maj.nom || maj.email} : rôles et informations enregistrés.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi('');
    }
  };

  const basculerActivation = async (u) => {
    if (u.actif && !(await confirmer({
      ton: 'attention',
      titre: `Désactiver le compte de ${u.nom || u.email} ?`,
      message: "L'utilisateur ne pourra plus se connecter tant que le compte n'est pas réactivé.",
      consequences: 'Ses sessions ouvertes seront fermées immédiatement.',
      confirmer: 'Désactiver le compte',
    }))) return;
    setEnvoi(`activation-${u.id}`);
    try {
      const maj = await securiteApi.activerUtilisateur(u.id, !u.actif);
      await apresModification(maj, `Compte ${maj.actif ? 'activé' : 'désactivé'} : ${maj.nom || maj.email}.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi('');
    }
  };

  const creer = async () => {
    if (creation.mot_de_passe !== creation.confirmation) { toastError('La confirmation du mot de passe ne correspond pas.'); return; }
    setEnvoi('creation');
    try {
      const u = await securiteApi.creerUtilisateur({ email: creation.email, nom: creation.nom, roles: creation.roles, mot_de_passe: creation.mot_de_passe });
      success(`Compte créé pour ${u.nom}. Le mot de passe provisoire devra être changé à la première connexion.`);
      setCreation(null);
      charger();
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi('');
    }
  };

  const reinitialiser = async () => {
    if (motDePasse.valeur !== motDePasse.confirmation) { toastError('La confirmation du mot de passe ne correspond pas.'); return; }
    setEnvoi('mdp');
    try {
      const maj = await securiteApi.reinitialiserMotDePasse(motDePasse.utilisateur.id, motDePasse.valeur);
      setMotDePasse(null);
      await apresModification(maj, `Mot de passe provisoire enregistré pour ${maj.nom || maj.email} : il devra le changer à sa prochaine connexion.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi('');
    }
  };

  const rolesActifs = useMemo(() => roles.filter((r) => r.actif || rolesSaisis.includes(r.id)), [roles, rolesSaisis]);

  return (
    <div style={{ padding: '1.5rem' }}>
      <EnTeteParametrage
        icone={Users}
        titre="Utilisateurs"
        description="Comptes de connexion à LE PHARE. Les comptes existants gardent leur adresse e-mail et leur mot de passe ; leurs droits viennent des rôles attribués ici."
        usage="Les droits sont contrôlés par le serveur à chaque opération ; toute modification de compte est inscrite au journal d'audit. Un compte désactivé est déconnecté immédiatement."
        actions={peut('users.create') && (
          <button type="button" className="btn btn-primary" onClick={() => setCreation({ email: '', nom: '', roles: [], mot_de_passe: '', confirmation: '' })} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <UserPlus size={15} /> Nouvel utilisateur
          </button>
        )}
      />

      <div className="glass-panel" style={{ padding: '0.9rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 260px' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-control" placeholder="Nom ou adresse e-mail…" value={filtres.q} onChange={(e) => setFiltres((f) => ({ ...f, q: e.target.value }))} style={{ paddingLeft: '2.1rem' }} />
        </div>
        <select className="form-control" style={{ width: 'auto', minWidth: 200 }} value={filtres.role} onChange={(e) => setFiltres((f) => ({ ...f, role: e.target.value }))}>
          <option value="">Tous les rôles</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.libelle}</option>)}
        </select>
        <select className="form-control" style={{ width: 'auto' }} value={filtres.etat} onChange={(e) => setFiltres((f) => ({ ...f, etat: e.target.value }))}>
          <option value="actifs">Comptes actifs</option>
          <option value="inactifs">Comptes désactivés</option>
          <option value="">Tous les comptes</option>
        </select>
      </div>

      <div className="glass-panel" style={{ padding: '0.5rem 1rem 1rem', overflowX: 'auto' }}>
        {chargement ? <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}><Loader2 className="spin" /> Chargement…</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.7rem 0.4rem' }}>Utilisateur</th>
                <th style={{ padding: '0.7rem 0.4rem' }}>Rôles</th>
                <th style={{ padding: '0.7rem 0.4rem' }}>Dernière connexion</th>
                <th style={{ padding: '0.7rem 0.4rem' }}>État</th>
                <th style={{ padding: '0.7rem 0.4rem', width: 210 }} />
              </tr>
            </thead>
            <tbody>
              {liste.map((u) => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--border-subtle)', opacity: u.actif ? 1 : 0.6 }}>
                  <td style={{ padding: '0.55rem 0.4rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>{u.nom || '-'}{u.id === moi?.id && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> (vous)</span>}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{u.email}</div>
                  </td>
                  <td style={{ padding: '0.55rem 0.4rem' }}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {u.administrateur && <span style={pastille('rgba(139,92,246,0.15)', '#a78bfa')}><ShieldCheck size={11} /> Administrateur</span>}
                      {u.roles.map((r) => <span key={r.id} style={pastille('var(--primary-glow)', 'var(--primary-500)')}>{r.libelle}</span>)}
                      {!u.administrateur && !u.roles.length && <span style={pastille('var(--bg-surface-elevated)', 'var(--accent-amber)')}>Aucun rôle</span>}
                    </div>
                  </td>
                  <td style={{ padding: '0.55rem 0.4rem', fontSize: '0.8rem' }}>{dateHeure(u.derniere_connexion)}</td>
                  <td style={{ padding: '0.55rem 0.4rem' }}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      <span style={pastille(u.actif ? 'rgba(16,185,129,0.12)' : 'var(--bg-surface-elevated)', u.actif ? 'var(--accent-emerald)' : 'var(--text-muted)')}>{u.actif ? 'Actif' : 'Désactivé'}</span>
                      {u.expire && <span style={pastille('var(--bg-surface-elevated)', 'var(--accent-rose)')}>Expiré</span>}
                      {u.verrouille_jusqua && <span style={pastille('var(--bg-surface-elevated)', 'var(--accent-amber)')}><Lock size={10} /> Verrouillé</span>}
                      {u.doit_changer_mot_de_passe && <span style={pastille('var(--bg-surface-elevated)', 'var(--text-secondary)')}>Mot de passe provisoire</span>}
                    </div>
                  </td>
                  <td style={{ padding: '0.55rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => ouvrir(u)} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>Détail</button>{' '}
                    {peut('users.password') && <button type="button" className="btn btn-secondary" title="Mot de passe provisoire" onClick={() => setMotDePasse({ utilisateur: u, valeur: '', confirmation: '' })} style={{ padding: '0.3rem 0.5rem' }}><KeyRound size={14} /></button>}{' '}
                    {peut('users.disable') && u.id !== moi?.id && (
                      <button type="button" className="btn btn-secondary" title={u.actif ? 'Désactiver' : 'Activer'} disabled={envoi === `activation-${u.id}`} onClick={() => basculerActivation(u)} style={{ padding: '0.3rem 0.5rem', color: u.actif ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
                        {u.actif ? <Lock size={14} /> : <Unlock size={14} />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!liste.length && <tr><td colSpan={5} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>Aucun utilisateur ne correspond.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {/* Détail : rôles, droits effectifs, activité */}
      <Modal isOpen={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? (detail.nom || detail.email) : ''} subtitle={detail?.email} size="large">
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
            {detail.administrateur && (
              <div style={{ display: 'flex', gap: '0.5rem', padding: '0.6rem 0.8rem', borderRadius: 8, border: '1px solid rgba(139,92,246,0.4)', fontSize: '0.82rem' }}>
                <ShieldCheck size={16} style={{ color: '#a78bfa', flexShrink: 0 }} /> Compte administrateur historique : accès complet quels que soient ses rôles (ses actions restent journalisées).
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0.75rem' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Nom</label>
                <input className="form-control" value={nomSaisi} maxLength={110} disabled={!peut('users.update')} onChange={(e) => setNomSaisi(e.target.value)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Expiration du compte</label>
                <input type="date" className="form-control" value={expirationSaisie} disabled={!peut('users.update')} onChange={(e) => setExpirationSaisie(e.target.value)} />
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', alignSelf: 'end' }}>Dernière connexion : <strong>{dateHeure(detail.derniere_connexion)}</strong></div>
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Rôles attribués</div>
              {peut('users.update')
                ? <ChoixRoles roles={rolesActifs} choisis={rolesSaisis} onChange={setRolesSaisis} />
                : <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{detail.roles.map((r) => <span key={r.id} style={pastille('var(--primary-glow)', 'var(--primary-500)')}>{r.libelle}</span>)}</div>}
              {peut('users.update') && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.6rem' }}>
                  <button type="button" className="btn btn-primary" disabled={envoi === 'detail'} onClick={enregistrerDetail} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {envoi === 'detail' ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Enregistrer
                  </button>
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Droits effectifs</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '0.6rem' }}>
                {detail.droits_effectifs.map((m) => (
                  <div key={m.module} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.8rem', marginBottom: '0.35rem' }}>{m.libelle}</div>
                    {m.droits.map((d) => (
                      <div key={d.code} title={d.accorde ? `Accordé par : ${d.par.join(', ')}` : 'Non accordé'} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.78rem', color: d.accorde ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {d.accorde ? <Check size={13} style={{ color: 'var(--accent-emerald)', flexShrink: 0 }} /> : <X size={13} style={{ color: 'var(--accent-rose)', flexShrink: 0 }} />}
                        <span>{d.libelle}</span>
                        {d.sensible && <AlertTriangle size={11} style={{ color: 'var(--accent-amber)' }} title="Opération sensible" />}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Activity size={13} /> Activité récente</div>
              {detail.activite.length ? (
                <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
                  {detail.activite.map((a) => (
                    <div key={a.id} style={{ display: 'flex', gap: '0.6rem', padding: '0.45rem 0.7rem', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.78rem' }}>
                      <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{dateHeure(a.date)}</span>
                      <span style={{ color: COULEURS_RESULTAT[a.resultat] || 'var(--text-secondary)', fontWeight: 700, whiteSpace: 'nowrap' }}>{a.resultat}</span>
                      <span style={{ flex: 1 }}>{a.description}{a.objet_id ? ` - ${a.objet_type} ${a.objet_id}` : ''}</span>
                    </div>
                  ))}
                </div>
              ) : <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Aucune action journalisée.</div>}
            </div>
          </div>
        )}
      </Modal>

      {/* Création */}
      <Modal isOpen={Boolean(creation)} onClose={() => setCreation(null)} title="Nouvel utilisateur" size="medium">
        {creation && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0.75rem' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Adresse e-mail (identifiant)</label>
                <input type="email" className="form-control" value={creation.email} onChange={(e) => setCreation((c) => ({ ...c, email: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Nom et prénoms</label>
                <input className="form-control" maxLength={110} value={creation.nom} onChange={(e) => setCreation((c) => ({ ...c, nom: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Mot de passe provisoire</label>
                <input type="password" autoComplete="new-password" className="form-control" value={creation.mot_de_passe} onChange={(e) => setCreation((c) => ({ ...c, mot_de_passe: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Confirmation</label>
                <input type="password" autoComplete="new-password" className="form-control" value={creation.confirmation} onChange={(e) => setCreation((c) => ({ ...c, confirmation: e.target.value }))} />
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Le mot de passe n'est ni affiché ni conservé en clair ; l'utilisateur devra le remplacer à sa première connexion.</p>
            <div>
              <div className="form-label">Rôles</div>
              <ChoixRoles roles={roles.filter((r) => r.actif)} choisis={creation.roles} onChange={(ids) => setCreation((c) => ({ ...c, roles: ids }))} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setCreation(null)}>Annuler</button>
              <button type="button" className="btn btn-primary" disabled={envoi === 'creation'} onClick={creer} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {envoi === 'creation' ? <Loader2 size={15} className="spin" /> : <UserPlus size={15} />} Créer le compte
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Mot de passe provisoire */}
      <Modal isOpen={Boolean(motDePasse)} onClose={() => setMotDePasse(null)} title="Mot de passe provisoire" subtitle={motDePasse?.utilisateur?.email} size="small">
        {motDePasse && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
              Saisissez un mot de passe provisoire à transmettre à l'utilisateur par un moyen sûr. Ses sessions ouvertes sont fermées et il devra le changer à sa prochaine connexion.
            </p>
            <input type="password" autoComplete="new-password" className="form-control" placeholder="Mot de passe provisoire" value={motDePasse.valeur} onChange={(e) => setMotDePasse((m) => ({ ...m, valeur: e.target.value }))} />
            <input type="password" autoComplete="new-password" className="form-control" placeholder="Confirmation" value={motDePasse.confirmation} onChange={(e) => setMotDePasse((m) => ({ ...m, confirmation: e.target.value }))} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setMotDePasse(null)}>Annuler</button>
              <button type="button" className="btn btn-primary" disabled={envoi === 'mdp'} onClick={reinitialiser} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {envoi === 'mdp' ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />} Enregistrer
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default UserManagementPage;
