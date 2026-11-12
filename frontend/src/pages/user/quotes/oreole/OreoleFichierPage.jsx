import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileSpreadsheet, HeartPulse, Info, Loader2, Upload } from 'lucide-react';
import { oreoleApi } from '../../../../api/endpoints';
import { useToast } from '../../../../context/ToastContext';
import { Champ, RechercheClient } from '../../../../components/common/RechercheClient';
import { QuickAddClientModal } from '../../clients/QuickAddClientModal';
import { messageErreurApi } from '../../../../utils/financeUtils';
import { COULEUR, ageAu, carte, echeanceAnnuelle, fcfa, grille, ligneDepuisImport, noteInfo, titreCarte } from './oreoleCommun';

/* =========================================================================
   ORÉOLE SANTÉ : classeur des effectifs. Une feuille est un groupe ; l'analyse n'écrit rien. On corrige les
   anomalies, on choisit le souscripteur et la période de chaque groupe, puis on prépare les devis liés de ce qu'on a
   coché. Les cotisations du fichier sont reprises telles quelles : c'est le cumul Santé + IA + AFA.
   ========================================================================= */

const anomaliesLigne = (l, effet) => {
  const a = [...(l.Anomalies || []).filter((x) => !/Date de naissance|Naissance en/.test(x))];
  const age = ageAu(l.DateNaissance, effet);
  if (!l.DateNaissance) a.unshift('Date de naissance absente ou erronée dans le fichier : à saisir');
  else if (age === null || age < 0 || age > 100) a.unshift('Date de naissance invraisemblable');
  return a;
};
const bloquante = (l, effet) => {
  const age = ageAu(l.DateNaissance, effet);
  return !l.DateNaissance || age === null || age < 0 || age > 100 || !l.IdOffre || !(l.Cotisation > 0) || !String(l.Nom || '').trim();
};

export default function OreoleFichierPage() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const fichierRef = useRef(null);
  const [lecture, setLecture] = useState(false);
  const [nomFichier, setNomFichier] = useState('');
  const [groupes, setGroupes] = useState([]);
  const [totaux, setTotaux] = useState(null);
  const [dateEffet, setDateEffet] = useState('');
  const [ouvert, setOuvert] = useState(null);
  const [filtre, setFiltre] = useState('tous');
  const [nouveauClientPour, setNouveauClientPour] = useState(null);
  const [preparation, setPreparation] = useState(null); // { fait, total, resultats }

  const lire = async (fichier) => {
    if (!fichier) return;
    setLecture(true);
    try {
      const r = await oreoleApi.analyserImport(fichier);
      setNomFichier(fichier.name);
      setTotaux(r.Totaux);
      setGroupes(r.Groupes.map((g) => ({
        ...g,
        coche: false,
        effet: '',
        souscripteur: g.Souscripteur?.IdClient ? { IdClient: g.Souscripteur.IdClient, Nom: g.Souscripteur.Nom } : null,
        lignes: g.Lignes.map((l, i) => ({ ...l, cle: `${g.Rang}-${i}`, Sans: false })),
      })));
      setPreparation(null);
      success(`${r.Totaux.Groupes} groupe${r.Totaux.Groupes > 1 ? 's' : ''} et ${r.Totaux.Adherents} adhérents lus : rien n'est enregistré.`);
    } catch (err) {
      toastError(`Classeur non lu : ${messageErreurApi(err)}`);
    } finally {
      setLecture(false);
      if (fichierRef.current) fichierRef.current.value = '';
    }
  };

  const etatGroupe = (g) => {
    const effet = g.effet || dateEffet;
    if (g.lignes.some((l) => !l.Sans && bloquante(l, effet || new Date().toISOString().slice(0, 10)))) return { code: 'corriger', libelle: 'À corriger', couleur: 'var(--accent-rose)' };
    if (!g.souscripteur) return { code: 'client', libelle: 'Souscripteur à choisir', couleur: 'var(--accent-amber)' };
    if (!effet) return { code: 'date', libelle: "Date d'effet à saisir", couleur: 'var(--accent-amber)' };
    return { code: 'pret', libelle: 'Prêt', couleur: 'var(--accent-emerald)' };
  };
  const visibles = useMemo(() => groupes.filter((g) => {
    const code = etatGroupe(g).code;
    return filtre === 'tous' || (filtre === 'prets' && code === 'pret') || (filtre === 'corriger' && code === 'corriger') || (filtre === 'autres' && (code === 'client' || code === 'date'));
  }), [groupes, filtre, dateEffet]); // eslint-disable-line react-hooks/exhaustive-deps
  const compter = (code) => groupes.filter((g) => etatGroupe(g).code === code).length;
  const selection = groupes.filter((g) => g.coche && etatGroupe(g).code === 'pret');

  const modifierGroupe = (rang, changement) => setGroupes((avant) => avant.map((g) => (g.Rang === rang ? { ...g, ...changement } : g)));
  const modifierLigne = (rang, cle, changement) => setGroupes((avant) => avant.map((g) => (g.Rang === rang ? { ...g, lignes: g.lignes.map((l) => (l.cle === cle ? { ...l, ...changement } : l)) } : g)));

  const preparer = async () => {
    if (!selection.length) { toastError('Cochez au moins un groupe prêt.'); return; }
    const resultats = [];
    setPreparation({ fait: 0, total: selection.length, resultats });
    for (const g of selection) {
      const effet = g.effet || dateEffet;
      const adherents = g.lignes.filter((l) => !l.Sans).map((l) => {
        const s = ligneDepuisImport(l);
        return {
          Matricule: s.Matricule, Nom: s.Nom, Prenoms: s.Prenoms, DateNaissance: s.DateNaissance, Sexe: s.Sexe, IdOffre: s.IdOffre, CotisationImposee: s.CotisationImposee,
          PartIA: s.PartIA, PartAFA: s.PartAFA, EnfantsEnPlus: s.EnfantsEnPlus, Personnes: s.Personnes, Affections: s.Affections, Beneficiaires: s.Beneficiaires,
        };
      });
      const offreCourante = g.lignes.find((l) => l.OffreExacte)?.IdOffre || g.lignes[0]?.IdOffre;
      try {
        // eslint-disable-next-line no-await-in-loop
        const devis = await oreoleApi.enregistrer({ Cible: 'E', IdClient: g.souscripteur.IdClient, DateEffet: effet, DateExpiration: echeanceAnnuelle(effet), IdOffre: offreCourante, Adherents: adherents, IdDevis: 0 });
        resultats.push({ Feuille: g.Feuille, IdDevis: devis.IdDevis, NumeroDevis: devis.NumeroDevis, Cotisation: devis.Totaux.Cotisation });
        modifierGroupe(g.Rang, { coche: false, devis: devis.NumeroDevis, idDevis: devis.IdDevis });
      } catch (err) {
        resultats.push({ Feuille: g.Feuille, Erreur: messageErreurApi(err) });
      }
      setPreparation({ fait: resultats.length, total: selection.length, resultats: [...resultats] });
    }
    const reussis = resultats.filter((r) => r.IdDevis).length;
    if (reussis) success(`${reussis} devis préparés, à relire puis à confirmer depuis l'accueil Oreole Santé.`);
    if (reussis < resultats.length) toastError(`${resultats.length - reussis} groupe(s) non préparés : voir le détail.`);
  };

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      <header>
        <button type="button" className="btn btn-link" onClick={() => navigate('/user/quotes/oreole-sante')} style={{ fontWeight: 600, padding: 0, marginBottom: '0.4rem' }}>← Oreole Santé</button>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}><HeartPulse size={26} color={COULEUR} /> Renouveler par fichier</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: 820, lineHeight: 1.55 }}>
          Déposez le classeur des effectifs : chaque feuille devient un groupe. L'analyse n'écrit rien, et on ne prépare que les groupes cochés. Les cotisations sont reprises telles quelles, IA et AFA comprises.
        </p>
      </header>

      <section className="glass-panel" style={{ ...carte, display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
        <FileSpreadsheet size={26} color={COULEUR} />
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <b>{nomFichier || 'Classeur des effectifs'}</b>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {totaux ? `${totaux.Groupes} groupe${totaux.Groupes > 1 ? 's' : ''}, ${totaux.Adherents} adhérents, ${fcfa(totaux.Cotisation)} F de cotisations, ${totaux.Anomalies} anomalies.` : 'Colonnes : matricule, noms, prénoms, statut, date de naissance, option, prime TTC Santé, prime IA, prime AFA.'}
          </div>
        </div>
        <input ref={fichierRef} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => lire(e.target.files?.[0])} />
        <button type="button" className="btn btn-primary" disabled={lecture} onClick={() => fichierRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          {lecture ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {totaux ? 'Choisir un autre fichier' : 'Choisir le classeur'}
        </button>
      </section>

      {groupes.length > 0 && (
        <>
          <section className="glass-panel" style={carte}>
            <div style={grille}>
              <Champ label="Date d'effet commune" aide="S'applique aux groupes sans date propre. Échéance à un an.">
                <input type="date" className="form-control" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} />
              </Champ>
              <div style={{ ...noteInfo(), alignSelf: 'center' }}><Info size={15} style={{ flexShrink: 0, marginTop: 2 }} /><span>Le premier passage dans LE PHARE crée une affaire nouvelle ; ces polices se renouvelleront ensuite sous leur numéro.</span></div>
            </div>
          </section>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }} role="group" aria-label="Filtrer les groupes">
            {[['tous', 'Tous', groupes.length], ['prets', 'Prêts', compter('pret')], ['corriger', 'À corriger', compter('corriger')], ['autres', 'À compléter', compter('client') + compter('date')]].map(([code, libelle, n]) => (
              <button key={code} type="button" onClick={() => setFiltre(code)} style={{ padding: '0.28rem 0.75rem', borderRadius: 999, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, border: `1px solid ${filtre === code ? 'var(--primary-500)' : 'var(--border-medium)'}`, background: filtre === code ? 'var(--primary-600)' : 'transparent', color: filtre === code ? '#fff' : 'var(--text-secondary)' }}>
                {libelle} {n}
              </button>
            ))}
          </div>

          <section className="glass-panel" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
            <div className="tableau-defilant" style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ minWidth: 980, fontSize: '0.82rem' }}>
                <thead><tr><th aria-label="Choisir" /><th>Groupe</th><th style={{ minWidth: 240 }}>Souscripteur</th><th>Date d'effet</th><th style={{ textAlign: 'right' }}>Adhérents</th><th style={{ textAlign: 'right' }}>Cotisation courante</th><th style={{ textAlign: 'right' }}>Hors offre</th><th style={{ textAlign: 'right' }}>Total</th><th>État</th><th aria-label="Détail" /></tr></thead>
                <tbody>
                  {visibles.map((g) => {
                    const etat = etatGroupe(g);
                    return (
                      <React.Fragment key={g.Rang}>
                        <tr>
                          <td><input type="checkbox" checked={g.coche} disabled={etat.code !== 'pret' || Boolean(g.devis)} aria-label={`Préparer ${g.Feuille}`} onChange={(e) => modifierGroupe(g.Rang, { coche: e.target.checked })} /></td>
                          <td><b>{g.Feuille}</b></td>
                          <td style={{ minWidth: 240 }}><RechercheClient label="" personne={g.souscripteur} onChoisir={(p) => modifierGroupe(g.Rang, { souscripteur: p })} onNouveau={() => setNouveauClientPour(g.Rang)} /></td>
                          <td><input type="date" className="form-control" style={{ width: 138, padding: '0.25rem 0.4rem', fontSize: '0.8rem' }} aria-label={`Date d'effet de ${g.Feuille}`} value={g.effet} placeholder={dateEffet} onChange={(e) => modifierGroupe(g.Rang, { effet: e.target.value })} /></td>
                          <td style={{ textAlign: 'right' }}>{g.lignes.filter((l) => !l.Sans).length}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fcfa(g.PrixCourant)}</td>
                          <td style={{ textAlign: 'right' }}>{g.HorsOffre || '-'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fcfa(g.lignes.filter((l) => !l.Sans).reduce((t, l) => t + l.Cotisation, 0))}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {g.devis
                              ? <button type="button" className="btn btn-link" style={{ padding: 0, fontSize: '0.78rem' }} onClick={() => navigate(`/user/quotes/oreole-sante/nouveau?edit=${g.idDevis}`)}><CheckCircle2 size={13} style={{ verticalAlign: -2 }} color="var(--accent-emerald)" /> Devis {g.devis}</button>
                              : <span style={{ color: etat.couleur, fontWeight: 700, fontSize: '0.76rem' }}>{etat.libelle}</span>}
                          </td>
                          <td><button type="button" className="btn btn-ghost" aria-expanded={ouvert === g.Rang} aria-label={`Détail de ${g.Feuille}`} style={{ padding: '0.15rem 0.3rem' }} onClick={() => setOuvert(ouvert === g.Rang ? null : g.Rang)}>{ouvert === g.Rang ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></td>
                        </tr>
                        {ouvert === g.Rang && (
                          <tr><td colSpan={10} style={{ background: 'var(--bg-surface-elevated)', padding: '0.65rem 0.85rem' }}>
                            <div className="tableau-defilant" style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
                              <table className="data-table" style={{ minWidth: 800, fontSize: '0.78rem' }}>
                                <thead><tr><th>Ligne</th><th>Matricule</th><th>Nom et prénoms</th><th>Naissance</th><th>Offre retenue</th><th style={{ textAlign: 'right' }}>Cotisation</th><th style={{ textAlign: 'right' }}>IA</th><th style={{ textAlign: 'right' }}>AFA</th><th>Contrôle</th><th>Retirer</th></tr></thead>
                                <tbody>
                                  {g.lignes.map((l) => {
                                    const a = anomaliesLigne(l, g.effet || dateEffet);
                                    return (
                                      <tr key={l.cle} style={{ opacity: l.Sans ? 0.5 : 1 }}>
                                        <td>{l.Ligne}</td>
                                        <td><input className="form-control" style={{ width: 92, padding: '0.15rem 0.3rem', fontSize: '0.76rem' }} aria-label={`Matricule, ligne ${l.Ligne}`} value={l.Matricule} onChange={(e) => modifierLigne(g.Rang, l.cle, { Matricule: e.target.value })} /></td>
                                        <td>{`${l.Nom} ${l.Prenoms}`.trim()}</td>
                                        <td><input type="date" className="form-control" style={{ width: 128, padding: '0.15rem 0.3rem', fontSize: '0.76rem', borderColor: l.DateNaissance ? undefined : 'var(--accent-rose)' }} aria-label={`Naissance, ligne ${l.Ligne}`} value={l.DateNaissance || ''} onChange={(e) => modifierLigne(g.Rang, l.cle, { DateNaissance: e.target.value })} /></td>
                                        <td>{l.Offre}</td>
                                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fcfa(l.Cotisation)}{!l.OffreExacte && <div style={{ fontSize: '0.68rem', color: 'var(--accent-amber)' }}>{l.Cotisation >= l.PrixOffre ? '+' : ''}{fcfa(l.Cotisation - l.PrixOffre)}</div>}</td>
                                        <td style={{ textAlign: 'right' }}>{fcfa(l.PartIA)}</td>
                                        <td style={{ textAlign: 'right' }}>{fcfa(l.PartAFA)}</td>
                                        <td style={{ fontSize: '0.72rem', color: a.length ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>{a.length ? <><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> {a.join(' · ')}</> : 'Conforme'}</td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={l.Sans} aria-label={`Retirer la ligne ${l.Ligne}`} onChange={(e) => modifierLigne(g.Rang, l.cle, { Sans: e.target.checked })} /></td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {visibles.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>Aucun groupe dans ce filtre.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <div className="glass-panel" style={{ position: 'sticky', bottom: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 1rem', borderRadius: 12, boxShadow: 'var(--shadow-lg)', zIndex: 5 }}>
            <span style={{ fontSize: '0.85rem' }}>
              <b>{selection.length} groupe{selection.length > 1 ? 's' : ''}</b> coché{selection.length > 1 ? 's' : ''}, {selection.reduce((t, g) => t + g.lignes.filter((l) => !l.Sans).length, 0)} adhérents, {fcfa(selection.reduce((t, g) => t + g.lignes.filter((l) => !l.Sans).reduce((s, l) => s + l.Cotisation, 0), 0))} F
            </span>
            <span style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setGroupes((avant) => avant.map((g) => ({ ...g, coche: etatGroupe(g).code === 'pret' && !g.devis })))}>Cocher les groupes prêts</button>
              <button type="button" className="btn btn-primary" disabled={!selection.length || (preparation && preparation.fait < preparation.total)} onClick={preparer} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                {preparation && preparation.fait < preparation.total ? <><Loader2 size={15} className="spin" /> Préparation {preparation.fait} sur {preparation.total}</> : 'Préparer les devis'}
              </button>
            </span>
          </div>

          {preparation?.resultats?.some((r) => r.Erreur) && (
            <section className="glass-panel" style={carte}>
              <h2 style={titreCarte}><AlertTriangle size={17} color="var(--accent-rose)" /> Groupes non préparés</h2>
              {preparation.resultats.filter((r) => r.Erreur).map((r) => <p key={r.Feuille} style={{ fontSize: '0.84rem', margin: '0.25rem 0' }}><b>{r.Feuille}</b> : {r.Erreur}</p>)}
            </section>
          )}
        </>
      )}

      <QuickAddClientModal
        isOpen={nouveauClientPour !== null}
        onClose={() => setNouveauClientPour(null)}
        onClientCreated={(client) => {
          const id = Number(client?.IdClient || client?.id);
          if (id && nouveauClientPour !== null) modifierGroupe(nouveauClientPour, { souscripteur: { IdClient: id, Nom: `${client.Nom || client.nomcomplet || ''} ${client.Prenoms || ''}`.trim() } });
          setNouveauClientPour(null);
        }}
      />
    </div>
  );
}
