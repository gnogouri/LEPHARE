import React, { useEffect, useMemo, useState } from 'react';
import { confirmer } from '../../../utils/dialogue';
import { UserCog, Plus, Save, Loader2, RotateCcw, Copy, Trash2, AlertTriangle, Users } from 'lucide-react';
import { EnTeteParametrage, SectionParametrage } from '../../../components/admin/EnTeteParametrage';
import { securiteApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

// Administration > Rôles : rôles de LE PHARE (lephare_role) et droits accordés par module.
// API : autorisations/views_securite.py ; contrôle des droits : autorisations/garde.py
const Interrupteur = ({ actif, onChange, desactive }) => (
  <button type="button" role="switch" aria-checked={actif} disabled={desactive} onClick={() => onChange(!actif)}
    style={{ width: 40, height: 22, borderRadius: 999, border: 'none', cursor: desactive ? 'not-allowed' : 'pointer', position: 'relative', background: actif ? 'var(--accent-emerald)' : 'var(--border-medium)', opacity: desactive ? 0.45 : 1, flexShrink: 0 }}>
    <span style={{ position: 'absolute', top: 3, left: actif ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
  </button>
);

const copie = (r) => ({ id: r.id, code: r.code, libelle: r.libelle, description: r.description || '', actif: r.actif, ordre: r.ordre, droits: [...(r.droits || [])].sort() });
const identiques = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const ProfileManagementPage = () => {
  const { peut, rafraichirSession } = useAuth();
  const { success, error: toastError } = useToast();
  const gerer = peut('roles.manage');
  const [roles, setRoles] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [idChoisi, setIdChoisi] = useState(null);
  const [saisie, setSaisie] = useState(null);
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [envoi, setEnvoi] = useState(false);

  const charger = async (garder) => {
    setChargement(true);
    try {
      const [liste, droits] = await Promise.all([securiteApi.roles(), securiteApi.droits()]);
      setRoles(liste);
      setCatalogue(droits);
      const id = garder ?? idChoisi ?? liste[0]?.id;
      if (id) choisir(liste.find((r) => r.id === id) || liste[0]);
    } catch (err) {
      toastError(`Rôles non chargés : ${messageErreurApi(err)}`);
    } finally {
      setChargement(false);
    }
  };
  useEffect(() => { charger(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choisir = (r) => {
    if (!r) return;
    setIdChoisi(r.id);
    setSaisie(copie(r));
    setUtilisateurs([]);
    if (r.id) securiteApi.role(r.id).then((d) => setUtilisateurs(d.utilisateurs || [])).catch(() => {});
  };

  const original = roles.find((r) => r.id === idChoisi);
  const modifie = saisie && (!saisie.id || !original || !identiques(copie(original), saisie));
  const changer = (cle, valeur) => setSaisie((s) => ({ ...s, [cle]: valeur }));
  const basculerDroit = (code, accorde) => setSaisie((s) => ({ ...s, droits: (accorde ? [...s.droits, code] : s.droits.filter((c) => c !== code)).sort() }));
  const basculerModule = (module, accorde) => {
    const codes = module.droits.map((d) => d.code);
    setSaisie((s) => ({ ...s, droits: [...new Set(accorde ? [...s.droits, ...codes] : s.droits.filter((c) => !codes.includes(c)))].sort() }));
  };

  const nouveau = (modele) => {
    setIdChoisi(null);
    setUtilisateurs([]);
    setSaisie({
      id: null, code: modele ? `${modele.code}_COPIE`.slice(0, 40) : '', libelle: modele ? `${modele.libelle} (copie)` : '',
      description: modele?.description || '', actif: true, ordre: (roles.length + 1) * 1, droits: [...(modele?.droits || [])].sort(),
    });
  };

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const donnees = { code: saisie.code, libelle: saisie.libelle, description: saisie.description, actif: saisie.actif, ordre: saisie.ordre, droits: saisie.droits };
      const r = saisie.id ? await securiteApi.modifierRole(saisie.id, donnees) : await securiteApi.creerRole(donnees);
      success(`Rôle « ${r.libelle} » enregistré : les droits s'appliquent dès la prochaine action des utilisateurs concernés.`);
      await charger(r.id);
      rafraichirSession().catch(() => {});
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  const supprimer = async () => {
    if (!(await confirmer({
      ton: 'danger',
      titre: `Supprimer le rôle « ${saisie.libelle} » ?`,
      message: "Le rôle et les droits qu'il regroupe seront supprimés.",
      confirmer: 'Supprimer le rôle',
    }))) return;
    try {
      await securiteApi.supprimerRole(saisie.id);
      success('Rôle supprimé.');
      setIdChoisi(null);
      await charger(null);
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };

  const totalDroits = useMemo(() => catalogue.reduce((n, m) => n + m.droits.length, 0), [catalogue]);

  return (
    <div style={{ padding: '1.5rem' }}>
      <EnTeteParametrage
        icone={UserCog}
        titre="Rôles"
        description="Un rôle rassemble des droits (consulter, créer, modifier, valider, annuler…) par module ; un utilisateur reçoit un ou plusieurs rôles. Les rôles livrés sont des propositions : modifiez-les, désactivez-les ou créez les vôtres."
        usage="Un rôle désactivé ne donne plus aucun droit, sans être retiré des comptes. Séparez les responsabilités : par exemple, l'agent de saisie crée les devis, l'agent de validation les transforme en contrats, et seuls les rôles qui ont « Modifier les tarifs » touchent aux barèmes."
        actions={gerer && (
          <>
            <button type="button" className="btn btn-secondary" disabled={!saisie} onClick={() => nouveau(saisie)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Copy size={15} /> Dupliquer</button>
            <button type="button" className="btn btn-primary" onClick={() => nouveau(null)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Plus size={15} /> Nouveau rôle</button>
          </>
        )}
      />

      {chargement && !roles.length ? <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}><Loader2 className="spin" /> Chargement…</div> : (
        <div style={{ display: 'flex', gap: '1.1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="glass-panel" style={{ flex: '1 1 260px', maxWidth: 320, padding: '0.75rem', position: 'sticky', top: '1rem' }}>
            {roles.map((r) => {
              const choisi = r.id === idChoisi;
              return (
                <div key={r.id} role="button" tabIndex={0} onClick={() => choisir(r)} onKeyDown={(e) => { if (e.key === 'Enter') choisir(r); }}
                  style={{ padding: '0.55rem 0.65rem', borderRadius: 10, cursor: 'pointer', border: `1px solid ${choisi ? 'var(--primary-500)' : 'transparent'}`, background: choisi ? 'var(--primary-glow)' : 'transparent', opacity: r.actif ? 1 : 0.55 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{r.libelle}{!r.actif && ' (inactif)'}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.code} • {r.droits.length}/{totalDroits} droits • {r.nb_utilisateurs} utilisateur{r.nb_utilisateurs > 1 ? 's' : ''}</div>
                </div>
              );
            })}
          </div>

          {saisie && (
            <div style={{ flex: '3 1 620px', minWidth: 0 }}>
              <SectionParametrage
                icone={UserCog}
                titre={saisie.id ? saisie.libelle || 'Rôle' : 'Nouveau rôle'}
                description={saisie.id ? `Modifié le ${original?.date_modification ? new Date(original.date_modification).toLocaleString('fr-FR') : '-'}${original?.modifie_par ? ` par ${original.modifie_par}` : ''}.` : 'Choisissez un code, un libellé et les droits accordés.'}
                actions={gerer && (
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    {saisie.id && !utilisateurs.length && <button type="button" className="btn btn-secondary" title="Supprimer ce rôle" onClick={supprimer} style={{ padding: '0.3rem 0.5rem', color: 'var(--accent-rose)' }}><Trash2 size={14} /></button>}
                    {modifie && saisie.id && <button type="button" className="btn btn-secondary" title="Annuler les changements" onClick={() => choisir(original)} style={{ padding: '0.3rem 0.5rem' }}><RotateCcw size={14} /></button>}
                    {modifie && (
                      <button type="button" className="btn btn-primary" disabled={envoi} onClick={enregistrer} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                        {envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer
                      </button>
                    )}
                  </div>
                )}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '0.8rem 1rem' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Libellé</label>
                    <input className="form-control" maxLength={100} value={saisie.libelle} disabled={!gerer} onChange={(e) => changer('libelle', e.target.value)} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Code</label>
                    <input className="form-control" maxLength={40} value={saisie.code} disabled={!gerer} onChange={(e) => changer('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Rôle actif</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '2.4rem' }}>
                      <Interrupteur actif={saisie.actif} desactive={!gerer} onChange={(v) => changer('actif', v)} />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{saisie.actif ? 'Donne ses droits' : 'Ne donne plus aucun droit'}</span>
                    </div>
                  </div>
                  <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
                    <label className="form-label">Description</label>
                    <textarea className="form-control" rows={2} maxLength={1000} value={saisie.description} disabled={!gerer} onChange={(e) => changer('description', e.target.value)} />
                  </div>
                </div>

                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '1.25rem 0 0.6rem' }}>
                  Droits accordés ({saisie.droits.length}/{totalDroits})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 290px), 1fr))', gap: '0.7rem' }}>
                  {catalogue.map((m) => {
                    const accordes = m.droits.filter((d) => saisie.droits.includes(d.code)).length;
                    return (
                      <div key={m.module} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, fontSize: '0.82rem', marginBottom: '0.35rem', cursor: gerer ? 'pointer' : 'default' }}>
                          <input type="checkbox" disabled={!gerer} checked={accordes === m.droits.length} ref={(el) => { if (el) el.indeterminate = accordes > 0 && accordes < m.droits.length; }}
                            onChange={(e) => basculerModule(m, e.target.checked)} style={{ accentColor: 'var(--primary-500)' }} />
                          {m.libelle} <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>({accordes}/{m.droits.length})</span>
                        </label>
                        {m.droits.map((d) => (
                          <label key={d.code} title={d.description || d.code} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.79rem', padding: '0.12rem 0 0.12rem 1.1rem', cursor: gerer ? 'pointer' : 'default' }}>
                            <input type="checkbox" disabled={!gerer} checked={saisie.droits.includes(d.code)} onChange={(e) => basculerDroit(d.code, e.target.checked)} style={{ accentColor: 'var(--primary-500)' }} />
                            <span>{d.libelle}</span>
                            {d.sensible && <AlertTriangle size={11} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} title="Opération sensible" />}
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>

                {saisie.id && (
                  <>
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '1.25rem 0 0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Users size={13} /> Utilisateurs ayant ce rôle ({utilisateurs.length})
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {utilisateurs.map((u) => (
                        <span key={u.id} style={{ padding: '0.2rem 0.55rem', borderRadius: 999, fontSize: '0.75rem', border: '1px solid var(--border-subtle)', opacity: u.actif ? 1 : 0.55 }}>
                          {u.nom || u.email}{!u.actif && ' (désactivé)'}
                        </span>
                      ))}
                      {!utilisateurs.length && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Aucun : attribuez ce rôle depuis Administration &gt; Utilisateurs.</span>}
                    </div>
                  </>
                )}
              </SectionParametrage>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProfileManagementPage;
