import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Banknote, Briefcase, CheckCircle2, ChevronDown, ChevronRight, Coins, Edit2, Eye, FileSpreadsheet, Handshake, Loader2, Plus, RefreshCw, Save, Search, Users, Wallet } from 'lucide-react';
import { apporteurApi, settingsApi } from '../../../api/endpoints';
import BlocApporteursAffaire, { COULEURS_ETAT, COULEURS_STATUT, baseAffichee, conventionAffichee, tarifAffiche } from '../../../components/apporteurs/BlocApporteursAffaire';
import { Modal } from '../../../components/common/Modal';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { useToast } from '../../../context/ToastContext';
import { confirmer, saisirTexte } from '../../../utils/dialogue';
import { aLeDroit } from '../../../utils/droits';
import { exportToExcel } from '../../../utils/exportUtils';
import { aujourdhui, bornesMois, correspondRecherche, dateFr, fcfa, messageErreurApi } from '../../../utils/financeUtils';

/* =========================================================================
   Module Apporteurs d'affaires : fiches, affaires rattachées (taux convenu de chaque apporteur), commissions à payer, payées et annulées,
   règlements. Calculs et contrôles au serveur : production/apporteurs.py.
   ========================================================================= */
const DROITE = { textAlign: 'right' };
const pourcent = (v) => `${Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const nomComplet = (a) => `${a.Nom || ''} ${a.Prenoms || ''}`.trim();
const OPTIONS_STATUT = [['', 'Tous les états'], ['A_PAYER', 'À payer'], ['PAYEE', 'Payées'], ['ANNULEE', 'Annulées']];
const OPTIONS_MODE = [['VIR', 'Virement'], ['CHQ', 'Chèque'], ['MOB', 'Mobile money'], ['ESP', 'Espèces']];
const FICHE_VIDE = { Nom: '', Prenoms: '', TypePersonne: 'P', PieceIdentite: '', Telephone: '', Telephone2: '', Email: '', Adresse: '', ModeGeneral: 'TAUX', TauxRetrocession: '', MontantParAssure: '', CompteReglement: '', Observations: '', Actif: true };
const vide = (v) => v === null || v === undefined || v === '';
// Commission générale de l'apporteur : un taux ou un montant par assuré, jamais les deux
const commissionGenerale = (a) => {
  if (Number(a.MontantParAssure) > 0) return `${fcfa(a.MontantParAssure)} F par assuré`;
  return vide(a.TauxRetrocession) ? '-' : pourcent(a.TauxRetrocession);
};
const messageFiche = (err) => {
  const d = err?.response?.data;
  return Array.isArray(d?.non_field_errors) ? d.non_field_errors[0] : messageErreurApi(err);
};

const Onglet = ({ actif, onClick, icone: Icone, children }) => (
  <button type="button" role="tab" aria-selected={actif} className={`btn ${actif ? 'btn-primary' : 'btn-secondary'}`} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
    <Icone size={15} /> {children}
  </button>
);

const Tuile = ({ libelle, valeur, detail, couleur = 'var(--text-primary)' }) => (
  <div className="glass-panel" style={{ padding: '0.9rem 1.05rem' }}>
    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-muted)' }}>{libelle}</div>
    <div style={{ fontSize: '1.25rem', fontWeight: 900, color: couleur, marginTop: '0.15rem' }}>{valeur}</div>
    {detail && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>{detail}</div>}
  </div>
);

const Champ = ({ id, libelle, children, large }) => (
  <div className="form-group" style={{ margin: 0, ...(large ? { gridColumn: '1 / -1' } : {}) }}>
    <label className="form-label" htmlFor={id}>{libelle}</label>
    {children}
  </div>
);

const barreFiltres = { padding: '0.85rem 1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: '0.6rem', alignItems: 'end' };
const grilleForm = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '0.8rem' };

const FiltreApporteur = ({ id, apporteurs, valeur, onChange }) => (
  <Champ id={id} libelle="Apporteur">
    <select id={id} className="form-control" value={valeur} onChange={(e) => onChange(e.target.value)}>
      <option value="">Tous les apporteurs</option>
      {apporteurs.map((a) => <option key={a.IdApporteur} value={a.IdApporteur}>{a.Code} - {nomComplet(a)}</option>)}
    </select>
  </Champ>
);

const FiltrePeriode = ({ prefixe, du, au, onChange }) => (
  <>
    <Champ id={`${prefixe}-du`} libelle="Du"><input id={`${prefixe}-du`} type="date" className="form-control" value={du} onChange={(e) => onChange({ du: e.target.value })} /></Champ>
    <Champ id={`${prefixe}-au`} libelle="Au"><input id={`${prefixe}-au`} type="date" className="form-control" value={au} onChange={(e) => onChange({ au: e.target.value })} /></Champ>
  </>
);

// ------------------------------------------------------------------ fiches
const OngletApporteurs = ({ apporteurs, synthese, onRecharger, onVoir }) => {
  const { success, error: toastError } = useToast();
  const [recherche, setRecherche] = useState('');
  const [statut, setStatut] = useState('actifs');
  const [edition, setEdition] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const peutGerer = aLeDroit('apporteurs.update');
  const champ = (cle) => (e) => setEdition((a) => ({ ...a, [cle]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const visibles = useMemo(() => apporteurs.filter((a) => (statut === 'tous' || (statut === 'actifs' ? a.Actif : !a.Actif))
    && correspondRecherche(recherche, [a.Code, a.Nom, a.Prenoms, a.Telephone, a.Telephone2, a.Email, a.PieceIdentite])), [apporteurs, recherche, statut]);

  const enregistrer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    const { ModeGeneral, ...fiche } = edition;
    const corps = {
      ...fiche,
      TauxRetrocession: ModeGeneral === 'TAUX' && !vide(edition.TauxRetrocession) ? edition.TauxRetrocession : null,
      MontantParAssure: ModeGeneral === 'MONTANT' && !vide(edition.MontantParAssure) ? edition.MontantParAssure : null,
    };
    try {
      const r = edition.IdApporteur ? await apporteurApi.modifier(edition.IdApporteur, corps) : await apporteurApi.creer(corps);
      success(`Apporteur ${r.Code} - ${nomComplet(r)} enregistré.`);
      setEdition(null);
      onRecharger();
    } catch (err) {
      toastError(`Apporteur non enregistré : ${messageFiche(err)}`);
    } finally {
      setEnvoi(false);
    }
  };

  const changerEtat = async (a) => {
    if (a.Actif) {
      const ok = await confirmer({
        titre: `Désactiver ${nomComplet(a)}`,
        message: "Un apporteur désactivé ne peut plus être rattaché à une nouvelle affaire.",
        consequences: 'Ses affaires et ses commissions restent en place. Il peut être réactivé à tout moment.',
        confirmer: 'Désactiver', ton: 'attention',
      });
      if (!ok) return;
    }
    try {
      await apporteurApi.changerEtat(a.IdApporteur, !a.Actif);
      success(`${nomComplet(a)} ${a.Actif ? 'désactivé' : 'réactivé'}.`);
      onRecharger();
    } catch (err) {
      toastError(`Changement refusé : ${messageFiche(err)}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div className="glass-panel" style={barreFiltres}>
        <Champ id="ap-recherche" libelle="Rechercher"><input id="ap-recherche" className="form-control" placeholder="Nom, code, téléphone, pièce" value={recherche} onChange={(e) => setRecherche(e.target.value)} /></Champ>
        <Champ id="ap-statut" libelle="Statut">
          <select id="ap-statut" className="form-control" value={statut} onChange={(e) => setStatut(e.target.value)}>
            <option value="actifs">Actifs</option><option value="inactifs">Désactivés</option><option value="tous">Tous</option>
          </select>
        </Champ>
        {peutGerer && <button type="button" className="btn btn-primary" onClick={() => setEdition({ ...FICHE_VIDE })} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}><Plus size={15} /> Nouvel apporteur</button>}
      </div>

      <div className="glass-panel table-wrapper">
        <table className="data-table">
          <thead>
            <tr><th>Code</th><th>Nom et prénoms</th><th>Type</th><th>Contacts</th><th style={DROITE}>Commission générale</th><th style={DROITE}>Affaires</th><th style={DROITE}>À payer</th><th style={DROITE}>Payées</th><th>Statut</th><th aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {visibles.map((a) => {
              const s = synthese[a.IdApporteur] || {};
              return (
                <tr key={a.IdApporteur}>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{a.Code}</td>
                  <td style={{ fontWeight: 700 }}>{nomComplet(a)}</td>
                  <td>{a.TypePersonne === 'M' ? 'Personne morale' : 'Personne physique'}</td>
                  <td>{a.Telephone}{a.Email && <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{a.Email}</div>}</td>
                  <td style={DROITE}>{commissionGenerale(a)}</td>
                  <td style={DROITE}>{s.Affaires || 0}</td>
                  <td style={{ ...DROITE, fontWeight: 700, color: s.APayer ? 'var(--accent-amber)' : undefined }}>{fcfa(s.APayer)} F</td>
                  <td style={DROITE}>{fcfa(s.Payee)} F</td>
                  <td><StatusBadge label={a.Actif ? 'Actif' : 'Désactivé'} color={a.Actif ? 'emerald' : 'rose'} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.45rem', marginRight: '0.25rem' }} title="Consulter" aria-label={`Consulter ${nomComplet(a)}`} onClick={() => onVoir(a)}><Eye size={14} /></button>
                    {peutGerer && <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.45rem', marginRight: '0.25rem' }} title="Modifier" aria-label={`Modifier ${nomComplet(a)}`} onClick={() => setEdition({ ...FICHE_VIDE, ...a, ModeGeneral: Number(a.MontantParAssure) > 0 ? 'MONTANT' : 'TAUX', TauxRetrocession: a.TauxRetrocession ?? '', MontantParAssure: a.MontantParAssure ?? '' })}><Edit2 size={14} /></button>}
                    {peutGerer && <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.45rem' }} title={a.Actif ? 'Désactiver' : 'Réactiver'} aria-label={`${a.Actif ? 'Désactiver' : 'Réactiver'} ${nomComplet(a)}`} onClick={() => changerEtat(a)}>{a.Actif ? <Ban size={14} /> : <CheckCircle2 size={14} />}</button>}
                  </td>
                </tr>
              );
            })}
            {!visibles.length && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>Aucun apporteur.</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={Boolean(edition)} onClose={() => setEdition(null)} size="medium" title={edition?.IdApporteur ? `Apporteur ${edition.Code}` : 'Nouvel apporteur'}>
        {edition && (
          <form onSubmit={enregistrer} style={grilleForm}>
            <Champ id="fa-type" libelle="Type">
              <select id="fa-type" className="form-control" value={edition.TypePersonne} onChange={champ('TypePersonne')}>
                <option value="P">Personne physique</option><option value="M">Personne morale</option>
              </select>
            </Champ>
            <Champ id="fa-nom" libelle={edition.TypePersonne === 'M' ? 'Raison sociale' : 'Nom'}><input id="fa-nom" className="form-control" required maxLength={150} value={edition.Nom} onChange={champ('Nom')} /></Champ>
            {edition.TypePersonne !== 'M' && <Champ id="fa-prenoms" libelle="Prénoms"><input id="fa-prenoms" className="form-control" maxLength={150} value={edition.Prenoms} onChange={champ('Prenoms')} /></Champ>}
            <Champ id="fa-piece" libelle={edition.TypePersonne === 'M' ? 'N° RCCM' : 'N° CNI ou passeport'}><input id="fa-piece" className="form-control" maxLength={50} value={edition.PieceIdentite} onChange={champ('PieceIdentite')} /></Champ>
            <Champ id="fa-tel" libelle="Téléphone"><input id="fa-tel" className="form-control" maxLength={30} value={edition.Telephone} onChange={champ('Telephone')} /></Champ>
            <Champ id="fa-tel2" libelle="Second téléphone"><input id="fa-tel2" className="form-control" maxLength={30} value={edition.Telephone2} onChange={champ('Telephone2')} /></Champ>
            <Champ id="fa-mail" libelle="Email"><input id="fa-mail" type="email" className="form-control" value={edition.Email} onChange={champ('Email')} /></Champ>
            <Champ id="fa-mode" libelle="Commission générale">
              <select id="fa-mode" className="form-control" value={edition.ModeGeneral} onChange={(e) => setEdition((a) => ({ ...a, ModeGeneral: e.target.value, TauxRetrocession: '', MontantParAssure: '' }))}>
                <option value="TAUX">Un taux</option>
                <option value="MONTANT">Un montant par assuré</option>
              </select>
            </Champ>
            {edition.ModeGeneral === 'MONTANT'
              ? <Champ id="fa-montant" libelle="Montant par assuré, en F"><input id="fa-montant" type="number" className="form-control" min={0} step="1" value={edition.MontantParAssure} onChange={champ('MontantParAssure')} placeholder="Facultatif" /></Champ>
              : <Champ id="fa-taux" libelle="Taux, en %"><input id="fa-taux" type="number" className="form-control" min={0} max={100} step="0.01" value={edition.TauxRetrocession} onChange={champ('TauxRetrocession')} placeholder="Facultatif" /></Champ>}
            <Champ id="fa-adr" libelle="Adresse" large><input id="fa-adr" className="form-control" maxLength={200} value={edition.Adresse} onChange={champ('Adresse')} /></Champ>
            <Champ id="fa-compte" libelle="Compte bancaire ou mobile money" large><input id="fa-compte" className="form-control" maxLength={100} value={edition.CompteReglement} onChange={champ('CompteReglement')} /></Champ>
            <Champ id="fa-obs" libelle="Observations" large><input id="fa-obs" className="form-control" maxLength={300} value={edition.Observations} onChange={champ('Observations')} /></Champ>
            <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              La commission générale est seulement proposée au rattachement. Celle convenue reste propre à chaque affaire : la changer ici ne modifie pas les affaires existantes.
            </p>
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEdition(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={envoi} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>{envoi ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Enregistrer</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};

// ------------------------------------------------------------------ affaires
const RattachementModal = ({ ouvert, onClose, onChange }) => {
  const { error: toastError } = useToast();
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState(null);
  const [choisie, setChoisie] = useState(null);
  const [recherche, setRecherche] = useState(false);

  useEffect(() => { if (ouvert) { setQ(''); setResultats(null); setChoisie(null); } }, [ouvert]);

  const chercher = async (e) => {
    e.preventDefault();
    setRecherche(true);
    try {
      setResultats((await apporteurApi.rechercherAffaires(q)).Lignes);
    } catch (err) {
      toastError(`Recherche impossible : ${messageErreurApi(err)}`);
    } finally {
      setRecherche(false);
    }
  };

  return (
    <Modal isOpen={ouvert} onClose={onClose} size="large" title="Rattacher un apporteur à une affaire">
      {!choisie ? (
        <>
          <form onSubmit={chercher} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem' }}>
            <input className="form-control" aria-label="Devis, police ou client" placeholder="N° de devis, de police ou nom du client : 3 caractères au moins" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={recherche || q.trim().length < 3} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>{recherche ? <Loader2 size={15} className="spin" /> : <Search size={15} />} Chercher</button>
          </form>
          {resultats && (
            <div className="table-wrapper">
              <table className="data-table" style={{ fontSize: '0.82rem' }}>
                <thead><tr><th>Affaire</th><th>Client</th><th>Branche</th><th>Effet</th><th style={DROITE}>Prime TTC</th><th aria-label="Choisir" /></tr></thead>
                <tbody>
                  {resultats.map((r) => (
                    <tr key={r.IdDevis}>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{r.NumeroPolice || r.NumeroDevis}<div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.IdContrat ? 'Contrat' : 'Devis'}</div></td>
                      <td>{r.Client}</td><td>{r.Branche}</td><td>{dateFr(r.DateEffet)}</td><td style={DROITE}>{fcfa(r.PrimeTtc)} F</td>
                      <td><button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setChoisie(r)}>Choisir</button></td>
                    </tr>
                  ))}
                  {!resultats.length && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.2rem' }}>Aucune affaire trouvée.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 0.8rem', fontSize: '0.86rem' }}>
            <b style={{ fontFamily: 'var(--font-mono)' }}>{choisie.NumeroPolice || choisie.NumeroDevis}</b> : {choisie.Client}, {choisie.Branche}.{' '}
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.76rem', padding: '0.15rem 0.5rem' }} onClick={() => setChoisie(null)}>Autre affaire</button>
          </p>
          <BlocApporteursAffaire idDevis={choisie.IdDevis} sansCadre onChange={onChange} />
        </>
      )}
    </Modal>
  );
};

const OngletAffaires = ({ apporteurs, filtreApporteur, onRecharger }) => {
  const { error: toastError } = useToast();
  const [filtres, setFiltres] = useState({ apporteur: filtreApporteur || '', q: '', du: '', au: '' });
  const [lignes, setLignes] = useState([]);
  const [tronque, setTronque] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [rattachement, setRattachement] = useState(false);
  const [ouverte, setOuverte] = useState(null);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const r = await apporteurApi.affaires({ apporteur: filtres.apporteur || undefined, q: filtres.q || undefined, du: filtres.du || undefined, au: filtres.au || undefined });
      setLignes(r.Lignes);
      setTronque(r.Tronque);
    } catch (err) {
      toastError(`Affaires non lues : ${messageErreurApi(err)}`);
    } finally {
      setChargement(false);
    }
  }, [filtres, toastError]);

  useEffect(() => { const m = setTimeout(charger, 250); return () => clearTimeout(m); }, [charger]);
  const changement = () => { charger(); onRecharger(); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div className="glass-panel" style={barreFiltres}>
        <FiltreApporteur id="af-apporteur" apporteurs={apporteurs} valeur={filtres.apporteur} onChange={(v) => setFiltres({ ...filtres, apporteur: v })} />
        <Champ id="af-q" libelle="Affaire ou client"><input id="af-q" className="form-control" placeholder="Police, devis, client" value={filtres.q} onChange={(e) => setFiltres({ ...filtres, q: e.target.value })} /></Champ>
        <FiltrePeriode prefixe="af" du={filtres.du} au={filtres.au} onChange={(v) => setFiltres({ ...filtres, ...v })} />
        {aLeDroit('apporteurs.rattacher') && <button type="button" className="btn btn-primary" onClick={() => setRattachement(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}><Plus size={15} /> Rattacher un apporteur</button>}
      </div>
      <div className="glass-panel table-wrapper">
        <table className="data-table" style={{ fontSize: '0.84rem' }}>
          <thead>
            <tr><th>Affaire</th><th>Client</th><th>Branche</th><th>Apporteur</th><th style={DROITE}>Taux ou montant convenu</th><th>Assiette</th><th style={DROITE}>Générée</th><th style={DROITE}>Payée</th><th style={DROITE}>À payer</th><th>État</th><th aria-label="Ouvrir" /></tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.IdRattachement} style={l.Actif ? undefined : { opacity: 0.65 }}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{l.NumeroPolice || l.NumeroDevis}<div style={{ color: 'var(--text-muted)', fontFamily: 'inherit' }}>{l.IdContrat ? 'Contrat' : 'Devis'}</div></td>
                <td>{l.Client}</td><td>{l.Branche}</td>
                <td><b>{l.Apporteur}</b><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{l.Code}</div></td>
                <td style={DROITE}>{conventionAffichee(l)}</td>
                <td>{l.LibelleAssiette}</td>
                <td style={{ ...DROITE, fontWeight: 700 }}>{fcfa(l.CommissionGeneree)} F</td>
                <td style={DROITE}>{fcfa(l.Payee)} F</td>
                <td style={DROITE}>{fcfa(l.APayer)} F</td>
                <td>{l.Actif ? <StatusBadge label={l.LibelleEtat} color={COULEURS_ETAT[l.EtatReglement]} /> : <StatusBadge label="Retiré" color="rose" />}</td>
                <td><button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.45rem' }} title="Ouvrir l'affaire" aria-label={`Ouvrir l'affaire ${l.NumeroPolice || l.NumeroDevis}`} onClick={() => setOuverte(l)}><Eye size={14} /></button></td>
              </tr>
            ))}
            {!lignes.length && <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>{chargement ? 'Lecture…' : 'Aucune affaire rattachée à un apporteur.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {tronque && <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--accent-amber)' }}>Seules les 500 dernières lignes sont affichées : précisez la recherche.</p>}
      <RattachementModal ouvert={rattachement} onClose={() => setRattachement(false)} onChange={changement} />
      <Modal isOpen={Boolean(ouverte)} onClose={() => setOuverte(null)} size="large" title={`Affaire ${ouverte?.NumeroPolice || ouverte?.NumeroDevis || ''}`.trim()}>
        {ouverte && <BlocApporteursAffaire idDevis={ouverte.IdDevis} sansCadre onChange={changement} />}
      </Modal>
    </div>
  );
};

// ------------------------------------------------------------------ commissions
const ReglementModal = ({ lignes, apporteur, banques, onClose, onFait }) => {
  const { success, error: toastError } = useToast();
  const [saisie, setSaisie] = useState({ DateReglement: aujourdhui(), Mode: 'VIR', IdBanque: '', Reference: '', Observation: '' });
  const [envoi, setEnvoi] = useState(false);
  const total = lignes.reduce((s, l) => s + l.Montant, 0);
  const nonSoldees = lignes.filter((l) => !l.PrimeSoldee);
  const avecBanque = ['VIR', 'CHQ'].includes(saisie.Mode);

  const valider = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const r = await apporteurApi.regler({ ...saisie, IdApporteur: lignes[0].IdApporteur, IdBanque: avecBanque ? saisie.IdBanque : null, Commissions: lignes.map((l) => l.IdCommission) });
      success(`Règlement ${r.Numero} enregistré : ${fcfa(r.Montant)} F pour ${r.Commissions} commission${r.Commissions > 1 ? 's' : ''}.`);
      onFait();
    } catch (err) {
      toastError(`Règlement non enregistré : ${messageErreurApi(err)}`);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} size="medium" title={`Régler ${apporteur}`}>
      <form onSubmit={valider} style={grilleForm}>
        <div style={{ gridColumn: '1 / -1', padding: '0.7rem 0.85rem', borderRadius: 10, border: '1px solid var(--border-medium)', fontSize: '0.88rem' }}>
          {lignes.length} commission{lignes.length > 1 ? 's' : ''} : <b style={{ fontSize: '1.05rem' }}>{fcfa(total)} F</b>
          {nonSoldees.length > 0 && <div role="alert" style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--accent-amber)' }}>Le client n'a pas soldé la prime de {nonSoldees.length} quittance{nonSoldees.length > 1 ? 's' : ''} : {nonSoldees.slice(0, 3).map((l) => l.NumeroQuittance).join(', ')}{nonSoldees.length > 3 ? '…' : ''}. Ce règlement serait une avance.</div>}
        </div>
        <Champ id="ra-date" libelle="Date du règlement"><input id="ra-date" type="date" required max={aujourdhui()} className="form-control" value={saisie.DateReglement} onChange={(e) => setSaisie({ ...saisie, DateReglement: e.target.value })} /></Champ>
        <Champ id="ra-mode" libelle="Mode">
          <select id="ra-mode" className="form-control" value={saisie.Mode} onChange={(e) => setSaisie({ ...saisie, Mode: e.target.value })}>
            {OPTIONS_MODE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Champ>
        {avecBanque && (
          <Champ id="ra-banque" libelle="Banque">
            <select id="ra-banque" className="form-control" required value={saisie.IdBanque} onChange={(e) => setSaisie({ ...saisie, IdBanque: e.target.value })}>
              <option value="">Choisir</option>
              {banques.map((b) => <option key={b.idbanque} value={b.idbanque}>{b.libelle}</option>)}
            </select>
          </Champ>
        )}
        {saisie.Mode !== 'ESP' && <Champ id="ra-ref" libelle={saisie.Mode === 'CHQ' ? 'N° du chèque' : 'Référence'}><input id="ra-ref" required maxLength={60} className="form-control" value={saisie.Reference} onChange={(e) => setSaisie({ ...saisie, Reference: e.target.value })} /></Champ>}
        <Champ id="ra-obs" libelle="Observation" large><input id="ra-obs" maxLength={300} className="form-control" value={saisie.Observation} onChange={(e) => setSaisie({ ...saisie, Observation: e.target.value })} /></Champ>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={envoi || total <= 0} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>{envoi ? <Loader2 size={15} className="spin" /> : <Banknote size={15} />} Enregistrer le règlement</button>
        </div>
      </form>
    </Modal>
  );
};

const OngletCommissions = ({ apporteurs, banques, filtreApporteur, onRecharger }) => {
  const { success, error: toastError } = useToast();
  const [debut, fin] = bornesMois();
  const [filtres, setFiltres] = useState({ apporteur: filtreApporteur || '', statut: 'A_PAYER', q: '', du: filtreApporteur ? '' : debut.slice(0, 4).concat('-01-01'), au: filtreApporteur ? '' : fin });
  const [donnees, setDonnees] = useState({ Lignes: [], Totaux: {}, Nombres: {} });
  const [chargement, setChargement] = useState(false);
  const [selection, setSelection] = useState(new Set());
  const [aRegler, setARegler] = useState(null);
  const peutPayer = aLeDroit('apporteurs.payer');
  const peutAnnuler = aLeDroit('apporteurs.cancel');

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setDonnees(await apporteurApi.commissions({ apporteur: filtres.apporteur || undefined, statut: filtres.statut || undefined, q: filtres.q || undefined, du: filtres.du || undefined, au: filtres.au || undefined }));
      setSelection(new Set());
    } catch (err) {
      toastError(`Commissions non lues : ${messageErreurApi(err)}`);
    } finally {
      setChargement(false);
    }
  }, [filtres, toastError]);

  useEffect(() => { const m = setTimeout(charger, 250); return () => clearTimeout(m); }, [charger]);

  const choisies = useMemo(() => donnees.Lignes.filter((l) => selection.has(l.IdCommission)), [donnees, selection]);
  const apporteursChoisis = useMemo(() => new Set(choisies.map((l) => l.IdApporteur)), [choisies]);
  const basculer = (id) => setSelection((avant) => {
    const s = new Set(avant);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  const annuler = async (l) => {
    const motif = await saisirTexte({
      titre: `Annuler la commission de ${fcfa(l.Montant)} F`,
      message: `${l.Apporteur}, quittance ${l.NumeroQuittance}. Indiquez le motif.`,
      minimum: 5, maximum: 300, confirmer: 'Annuler la commission', annuler: 'Revenir', ton: 'danger',
    });
    if (!motif) return;
    try {
      await apporteurApi.annulerCommission(l.IdCommission, motif);
      success('Commission annulée.');
      charger();
      onRecharger();
    } catch (err) {
      toastError(`Annulation refusée : ${messageErreurApi(err)}`);
    }
  };

  const exporter = () => exportToExcel({
    filename: `commissions_apporteurs_${aujourdhui()}`, title: "Commissions des apporteurs d'affaires", subtitle: filtres.du || filtres.au ? `Émission du ${dateFr(filtres.du) || 'début'} au ${dateFr(filtres.au) || aujourdhui()}` : 'Toutes les périodes',
    headers: ['Émission', 'Code', 'Apporteur', 'Police', 'Quittance', 'Mouvement', 'Client', 'Assiette', 'Base', 'Taux ou montant', 'Commission', 'État', 'Règlement', 'Prime du client'],
    rows: donnees.Lignes.map((l) => [dateFr(l.DateEmission), l.Code, l.Apporteur, l.NumeroPolice, l.NumeroQuittance, l.Mouvement, l.Client, l.LibelleAssiette, baseAffichee(l), tarifAffiche(l), l.Montant, l.LibelleStatut, l.NumeroReglement, l.PrimeSoldee ? 'Soldée' : `Reste ${fcfa(l.Reste)} F`]),
  });

  const T = donnees.Totaux || {};
  const N = donnees.Nombres || {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div className="glass-panel" style={barreFiltres}>
        <FiltreApporteur id="co-apporteur" apporteurs={apporteurs} valeur={filtres.apporteur} onChange={(v) => setFiltres({ ...filtres, apporteur: v })} />
        <Champ id="co-statut" libelle="État">
          <select id="co-statut" className="form-control" value={filtres.statut} onChange={(e) => setFiltres({ ...filtres, statut: e.target.value })}>
            {OPTIONS_STATUT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Champ>
        <Champ id="co-q" libelle="Affaire ou client"><input id="co-q" className="form-control" placeholder="Police, quittance, client" value={filtres.q} onChange={(e) => setFiltres({ ...filtres, q: e.target.value })} /></Champ>
        <FiltrePeriode prefixe="co" du={filtres.du} au={filtres.au} onChange={(v) => setFiltres({ ...filtres, ...v })} />
        <button type="button" className="btn btn-secondary" onClick={exporter} disabled={!donnees.Lignes.length} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}><FileSpreadsheet size={15} /> Excel</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: '0.7rem' }}>
        <Tuile libelle="À payer" valeur={`${fcfa(T.A_PAYER)} F`} detail={`${N.A_PAYER || 0} commission${N.A_PAYER > 1 ? 's' : ''}`} couleur="var(--accent-amber)" />
        <Tuile libelle="Payées" valeur={`${fcfa(T.PAYEE)} F`} detail={`${N.PAYEE || 0} commission${N.PAYEE > 1 ? 's' : ''}`} couleur="var(--accent-emerald)" />
        <Tuile libelle="Annulées" valeur={`${fcfa(T.ANNULEE)} F`} detail={`${N.ANNULEE || 0} commission${N.ANNULEE > 1 ? 's' : ''}`} couleur="var(--accent-rose)" />
      </div>

      {peutPayer && selection.size > 0 && (
        <div className="glass-panel" style={{ padding: '0.7rem 1rem', display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.88rem' }}>{selection.size} commission{selection.size > 1 ? 's' : ''} choisie{selection.size > 1 ? 's' : ''} : <b>{fcfa(choisies.reduce((s, l) => s + l.Montant, 0))} F</b>{apporteursChoisis.size > 1 && <span style={{ color: 'var(--accent-amber)' }}> Un règlement ne concerne qu'un seul apporteur.</span>}</span>
          <button type="button" className="btn btn-primary" disabled={apporteursChoisis.size !== 1} onClick={() => setARegler(choisies)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}><Wallet size={15} /> Régler</button>
        </div>
      )}

      <div className="glass-panel table-wrapper">
        <table className="data-table" style={{ fontSize: '0.83rem' }}>
          <thead>
            <tr>
              {peutPayer && <th aria-label="Choisir" />}
              <th>Émission</th><th>Apporteur</th><th>Police et quittance</th><th>Client</th><th>Assiette</th><th style={DROITE}>Base</th><th style={DROITE}>Taux ou montant</th><th style={DROITE}>Commission</th><th>Prime du client</th><th>État</th>
              {peutAnnuler && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {donnees.Lignes.map((l) => (
              <tr key={l.IdCommission}>
                {peutPayer && <td>{l.Statut === 'A_PAYER' && <input type="checkbox" aria-label={`Choisir la quittance ${l.NumeroQuittance}`} checked={selection.has(l.IdCommission)} onChange={() => basculer(l.IdCommission)} />}</td>}
                <td>{dateFr(l.DateEmission)}</td>
                <td><b>{l.Apporteur}</b><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{l.Code}</div></td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>{l.NumeroPolice}<div style={{ color: 'var(--text-muted)' }}>{l.NumeroQuittance}</div></td>
                <td>{l.Client}<div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{l.Mouvement}</div></td>
                <td>{l.LibelleAssiette}</td>
                <td style={DROITE}>{baseAffichee(l)}</td>
                <td style={DROITE}>{tarifAffiche(l)}</td>
                <td style={{ ...DROITE, fontWeight: 800 }}>{fcfa(l.Montant)} F</td>
                <td style={{ color: l.PrimeSoldee ? 'var(--accent-emerald)' : 'var(--accent-amber)', fontSize: '0.78rem' }}>{l.PrimeSoldee ? 'Soldée' : `Reste ${fcfa(l.Reste)} F`}</td>
                <td>
                  <StatusBadge label={l.LibelleStatut} color={COULEURS_STATUT[l.Statut]} />
                  {l.NumeroReglement && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{l.NumeroReglement}</div>}
                  {l.MotifAnnulation && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{l.MotifAnnulation}</div>}
                </td>
                {peutAnnuler && <td>{l.Statut === 'A_PAYER' && <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.45rem' }} title="Annuler la commission" aria-label={`Annuler la commission de la quittance ${l.NumeroQuittance}`} onClick={() => annuler(l)}><Ban size={14} /></button>}</td>}
              </tr>
            ))}
            {!donnees.Lignes.length && <tr><td colSpan={12} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>{chargement ? 'Lecture…' : 'Aucune commission pour ces critères.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {donnees.Tronque && <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--accent-amber)' }}>Seules les 500 dernières lignes sont affichées ; les totaux couvrent toute la sélection.</p>}
      {aRegler && <ReglementModal lignes={aRegler} apporteur={aRegler[0].Apporteur} banques={banques} onClose={() => setARegler(null)} onFait={() => { setARegler(null); charger(); onRecharger(); }} />}
    </div>
  );
};

// ------------------------------------------------------------------ règlements
const OngletReglements = ({ apporteurs, filtreApporteur, onRecharger }) => {
  const { success, error: toastError } = useToast();
  const [filtres, setFiltres] = useState({ apporteur: filtreApporteur || '', du: '', au: '' });
  const [lignes, setLignes] = useState([]);
  const [ouvert, setOuvert] = useState(null);
  const [chargement, setChargement] = useState(false);
  const peutAnnuler = aLeDroit('apporteurs.cancel');

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setLignes((await apporteurApi.reglements({ apporteur: filtres.apporteur || undefined, du: filtres.du || undefined, au: filtres.au || undefined })).Lignes);
    } catch (err) {
      toastError(`Règlements non lus : ${messageErreurApi(err)}`);
    } finally {
      setChargement(false);
    }
  }, [filtres, toastError]);

  useEffect(() => { charger(); }, [charger]);

  const annuler = async (r) => {
    const motif = await saisirTexte({
      titre: `Annuler le règlement ${r.Numero}`,
      message: `${fcfa(r.Montant)} F versés à ${r.Apporteur}. Indiquez le motif.`,
      consequences: `Ses ${r.Details.length} commissions reviennent à payer. Le règlement reste dans cet historique, marqué annulé.`,
      minimum: 5, maximum: 300, confirmer: 'Annuler le règlement', annuler: 'Revenir', ton: 'danger',
    });
    if (!motif) return;
    try {
      const reponse = await apporteurApi.annulerReglement(r.IdReglement, motif);
      success(reponse.Message);
      charger();
      onRecharger();
    } catch (err) {
      toastError(`Annulation refusée : ${messageErreurApi(err)}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div className="glass-panel" style={barreFiltres}>
        <FiltreApporteur id="re-apporteur" apporteurs={apporteurs} valeur={filtres.apporteur} onChange={(v) => setFiltres({ ...filtres, apporteur: v })} />
        <FiltrePeriode prefixe="re" du={filtres.du} au={filtres.au} onChange={(v) => setFiltres({ ...filtres, ...v })} />
        <button type="button" className="btn btn-secondary" onClick={charger} disabled={chargement} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}><RefreshCw size={15} /> Actualiser</button>
      </div>
      <div className="glass-panel table-wrapper">
        <table className="data-table" style={{ fontSize: '0.84rem' }}>
          <thead><tr><th aria-label="Détail" /><th>Règlement</th><th>Date</th><th>Apporteur</th><th>Mode</th><th>Référence</th><th style={DROITE}>Montant</th><th>Enregistré par</th><th>État</th>{peutAnnuler && <th aria-label="Actions" />}</tr></thead>
          <tbody>
            {lignes.map((r) => (
              <React.Fragment key={r.IdReglement}>
                <tr style={r.Statut === 'A' ? { opacity: 0.65 } : undefined}>
                  <td><button type="button" className="btn btn-secondary" style={{ padding: '0.1rem 0.25rem' }} aria-expanded={ouvert === r.IdReglement} aria-label="Voir le détail" onClick={() => setOuvert(ouvert === r.IdReglement ? null : r.IdReglement)}>{ouvert === r.IdReglement ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{r.Numero}</td>
                  <td>{dateFr(r.DateReglement)}</td>
                  <td><b>{r.Apporteur}</b></td>
                  <td>{r.LibelleMode}{r.Banque && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.Banque}</div>}</td>
                  <td>{r.Reference}</td>
                  <td style={{ ...DROITE, fontWeight: 800 }}>{fcfa(r.Montant)} F</td>
                  <td>{r.Operateur}</td>
                  <td>
                    <StatusBadge label={r.Statut === 'A' ? 'Annulé' : 'Validé'} color={r.Statut === 'A' ? 'rose' : 'emerald'} />
                    {r.MotifAnnulation && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{r.MotifAnnulation}, par {r.AnnulePar}</div>}
                  </td>
                  {peutAnnuler && <td>{r.Statut === 'V' && <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.45rem' }} title="Annuler le règlement" aria-label={`Annuler le règlement ${r.Numero}`} onClick={() => annuler(r)}><Ban size={14} /></button>}</td>}
                </tr>
                {ouvert === r.IdReglement && (
                  <tr><td colSpan={peutAnnuler ? 10 : 9} style={{ padding: '0.4rem 0.5rem' }}>
                    <table className="data-table" style={{ fontSize: '0.78rem' }}>
                      <thead><tr><th>Police</th><th>Quittance</th><th>Client</th><th style={DROITE}>Taux</th><th style={DROITE}>Commission</th></tr></thead>
                      <tbody>{r.Details.map((d) => <tr key={d.NumeroQuittance}><td style={{ fontFamily: 'var(--font-mono)' }}>{d.NumeroPolice}</td><td style={{ fontFamily: 'var(--font-mono)' }}>{d.NumeroQuittance}</td><td>{d.Client}</td><td style={DROITE}>{pourcent(d.Taux)}</td><td style={DROITE}>{fcfa(d.Montant)} F</td></tr>)}</tbody>
                    </table>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
            {!lignes.length && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>{chargement ? 'Lecture…' : 'Aucun règlement.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ fiche en lecture
const FicheModal = ({ apporteur, synthese, onClose, onAller }) => {
  const s = synthese || {};
  const lignes = [
    ['Code', apporteur.Code], ['Type', apporteur.TypePersonne === 'M' ? 'Personne morale' : 'Personne physique'], ['Pièce', apporteur.PieceIdentite], ['Téléphone', apporteur.Telephone],
    ['Second téléphone', apporteur.Telephone2], ['Email', apporteur.Email], ['Adresse', apporteur.Adresse], ['Compte de règlement', apporteur.CompteReglement],
    ['Commission générale', commissionGenerale(apporteur) === '-' ? '' : commissionGenerale(apporteur)], ['Observations', apporteur.Observations],
  ].filter(([, v]) => v);
  return (
    <Modal isOpen onClose={onClose} size="medium" title={nomComplet(apporteur)}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: '0.6rem', marginBottom: '0.9rem' }}>
        <Tuile libelle="Affaires" valeur={s.Affaires || 0} />
        <Tuile libelle="À payer" valeur={`${fcfa(s.APayer)} F`} couleur="var(--accent-amber)" />
        <Tuile libelle="Payées" valeur={`${fcfa(s.Payee)} F`} couleur="var(--accent-emerald)" />
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.3rem 0.9rem', margin: 0, fontSize: '0.86rem' }}>
        {lignes.map(([l, v]) => <React.Fragment key={l}><dt style={{ color: 'var(--text-muted)' }}>{l}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{v}</dd></React.Fragment>)}
      </dl>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
        <button type="button" className="btn btn-secondary" onClick={() => onAller('affaires', apporteur.IdApporteur)}>Voir ses affaires</button>
        <button type="button" className="btn btn-secondary" onClick={() => onAller('commissions', apporteur.IdApporteur)}>Voir ses commissions</button>
        <button type="button" className="btn btn-secondary" onClick={() => onAller('reglements', apporteur.IdApporteur)}>Voir ses règlements</button>
      </div>
    </Modal>
  );
};

// ------------------------------------------------------------------ page
export default function ApporteursPage() {
  const { error: toastError } = useToast();
  const [onglet, setOnglet] = useState('apporteurs');
  const [apporteurs, setApporteurs] = useState([]);
  const [synthese, setSynthese] = useState({});
  const [banques, setBanques] = useState([]);
  const [fiche, setFiche] = useState(null);
  const [filtreApporteur, setFiltreApporteur] = useState('');

  const recharger = useCallback(async () => {
    try {
      const [liste, chiffres] = await Promise.all([apporteurApi.liste(), apporteurApi.synthese()]);
      setApporteurs(Array.isArray(liste) ? liste : []);
      setSynthese(chiffres || {});
    } catch (err) {
      toastError(`Apporteurs non lus : ${messageErreurApi(err)}`);
    }
  }, [toastError]);

  useEffect(() => {
    recharger();
    settingsApi.getBanques().then((l) => setBanques(Array.isArray(l) ? l : [])).catch(() => {});
  }, [recharger]);

  const changerOnglet = (cle, idApporteur = '') => {
    setFiltreApporteur(idApporteur);
    setOnglet(cle);
    setFiche(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', paddingBottom: '2rem' }}>
      <div>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', margin: 0 }}><Handshake size={26} style={{ color: 'var(--primary-500)' }} /> Apporteurs d'affaires</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.3rem 0 0', maxWidth: 920 }}>
          Chaque apporteur est rattaché aux affaires qu'il amène, avec un taux convenu pour chacune. La commission se calcule sur chaque quittance émise, puis se suit jusqu'à son règlement.
        </p>
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }} role="tablist">
        <Onglet actif={onglet === 'apporteurs'} onClick={() => changerOnglet('apporteurs')} icone={Users}>Apporteurs</Onglet>
        <Onglet actif={onglet === 'affaires'} onClick={() => changerOnglet('affaires')} icone={Briefcase}>Affaires</Onglet>
        <Onglet actif={onglet === 'commissions'} onClick={() => changerOnglet('commissions')} icone={Coins}>Commissions</Onglet>
        <Onglet actif={onglet === 'reglements'} onClick={() => changerOnglet('reglements')} icone={Wallet}>Règlements</Onglet>
      </div>
      {onglet === 'apporteurs' && <OngletApporteurs apporteurs={apporteurs} synthese={synthese} onRecharger={recharger} onVoir={setFiche} />}
      {onglet === 'affaires' && <OngletAffaires key={`a${filtreApporteur}`} apporteurs={apporteurs} filtreApporteur={filtreApporteur} onRecharger={recharger} />}
      {onglet === 'commissions' && <OngletCommissions key={`c${filtreApporteur}`} apporteurs={apporteurs} banques={banques} filtreApporteur={filtreApporteur} onRecharger={recharger} />}
      {onglet === 'reglements' && <OngletReglements key={`r${filtreApporteur}`} apporteurs={apporteurs} filtreApporteur={filtreApporteur} onRecharger={recharger} />}
      {fiche && <FicheModal apporteur={fiche} synthese={synthese[fiche.IdApporteur]} onClose={() => setFiche(null)} onAller={changerOnglet} />}
    </div>
  );
}
