import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bus, Save, Loader2, Plus, Trash2, SlidersHorizontal, Wallet, Search, Link2 } from 'lucide-react';
import { EnTeteParametrage, SectionParametrage } from '../../../components/admin/EnTeteParametrage';
import { LigneParametre } from '../../../components/admin/LigneParametre';
import { parametrageApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { chargerParametrage } from '../../../utils/parametrage';
import { useToast } from '../../../context/ToastContext';
import { decrireRegle } from './ParametrageReglesGarantiesPage';

// Tarif du POOL TPV (catégorie 204 « Transport public de voyageurs ») et primes dues au Pool.
// configuration_api/parametrage_auto.py ; calcul par la base (fn_pool_tpv) pour l'offre « POOL TPV (CAT 204) ».
// Règles des garanties de la catégorie 204 (tarif annoté NSIA, feuille « cat 4 ») rappelées ici, réglées dans
// Administration > Réglages Automobile > Règles des garanties.
const CATEGORIE_TPV = '204';
const concerneTpv = (r) => r.Actif !== false
  && (!r.Categories || String(r.Categories).split(',').map((c) => c.trim()).includes(CATEGORIE_TPV));

const MOIS = Array.from({ length: 12 }, (_, i) => i + 1);
const montant = (v) => `${Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`;
const date = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const cellule = { padding: '0.35rem 0.3rem', verticalAlign: 'middle', fontSize: '0.82rem' };
const entete = { padding: '0.5rem 0.3rem', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-muted)', textAlign: 'center', whiteSpace: 'nowrap' };
const champ = { width: 72, padding: '0.3rem', fontSize: '0.8rem', textAlign: 'right' };

export const ParametragePoolTpvPage = () => {
  const { success, error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [tranches, setTranches] = useState([]);
  const [envoi, setEnvoi] = useState(false);
  const [periode, setPeriode] = useState({ du: '', au: '' });
  const [regles, setRegles] = useState(null);

  const charger = (filtre = periode) => parametrageApi.getPoolTpv(filtre)
    .then((d) => { setDonnees(d); setTranches(d.Tranches); })
    .catch((err) => toastError(`Pool TPV non chargé : ${messageErreurApi(err)}`));

  useEffect(() => {
    charger();
    parametrageApi.getReglesInteractions()
      .then((d) => setRegles({ ...d, Regles: (d.Regles || []).filter(concerneTpv) }))
      .catch(() => setRegles({ Regles: [], Compagnies: [] }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const modifiees = donnees && JSON.stringify(tranches) !== JSON.stringify(donnees.Tranches);
  const changer = (i, champ_, valeur) => setTranches((l) => l.map((t, k) => (k === i ? { ...t, [champ_]: valeur } : t)));
  const changerAccessoire = (i, m, valeur) => setTranches((l) => l.map((t, k) => (k === i
    ? { ...t, Accessoires: t.Accessoires.map((a, j) => (j === m ? valeur : a)) } : t)));

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const nouvelles = await parametrageApi.modifierTranchesPoolTpv(tranches);
      setTranches(nouvelles);
      setDonnees((d) => ({ ...d, Tranches: nouvelles }));
      success('Tarif du Pool TPV enregistré.');
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  const total = useMemo(() => (donnees?.Suivi || []).reduce((s, l) => s + (Number(l.TotalPool) || 0), 0), [donnees]);
  const parametres = (donnees?.Parametres || []).filter((p) => p.Cle !== 'auto.pool_tpv.offre');
  const offre = (donnees?.Parametres || []).find((p) => p.Cle === 'auto.pool_tpv.offre')?.Valeur;

  return (
    <div style={{ padding: '1.5rem' }}>
      <EnTeteParametrage
        icone={Bus}
        titre="Pool TPV (catégorie 204)"
        description="Transport public de voyageurs : la prime des garanties obligatoires RC et Recours peut relever du POOL TPV. À la saisie d'un devis de la catégorie 204, choisissez « Pool TPV » (tarif ci-dessous) ou « Assureur » (primes de la compagnie)."
        usage={`Offre « POOL TPV (CAT 204) »${offre ? ` (n° ${offre})` : ''} : RC = prime annuelle de la tranche × fraction de la durée, Recours = pourcentage de la RC, accessoire de la tranche pour la durée ; CEDEAO, FGA et taxes comme pour tout véhicule. Toute la RC + Recours est due au Pool.`}
      />

      {!donnees && <div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Chargement…</div>}

      {donnees && (
        <>
          <SectionParametrage icone={Bus} titre="Tarif du Pool"
            description="Une tranche par nombre de places (la dernière sans maximum) : prime RC annuelle et accessoire pour chaque durée, de 1 à 12 mois (document « TARIFS POOL TPV », tarif actuel)."
            actions={(
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                  onClick={() => setTranches((l) => [...l, { PlacesMin: (Number(l[l.length - 1]?.PlacesMax) || 0) + 1, PlacesMax: null, PrimeRcAnnuelle: 0, Accessoires: Array(12).fill(0) }])}>
                  <Plus size={14} /> Ajouter une tranche
                </button>
                <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={!modifiees || envoi} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  {envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer le tarif
                </button>
              </div>
            )}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 1300 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
                    <th style={entete}>Places de</th><th style={entete}>à</th><th style={entete}>RC annuelle</th>
                    {MOIS.map((m) => <th key={m} style={entete}>Acc. {m} mois</th>)}
                    <th style={entete} />
                  </tr>
                </thead>
                <tbody>
                  {tranches.map((t, i) => (
                    <tr key={`${t.Id || 'n'}-${i}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={cellule}><input type="number" min={0} className="form-control" style={{ ...champ, width: 60 }} value={t.PlacesMin ?? ''} onChange={(e) => changer(i, 'PlacesMin', e.target.value === '' ? null : Number(e.target.value))} /></td>
                      <td style={cellule}><input type="number" min={0} className="form-control" style={{ ...champ, width: 60 }} placeholder="et +" value={t.PlacesMax ?? ''} onChange={(e) => changer(i, 'PlacesMax', e.target.value === '' ? null : Number(e.target.value))} /></td>
                      <td style={cellule}><input type="number" min={0} className="form-control" style={{ ...champ, width: 100 }} value={t.PrimeRcAnnuelle ?? ''} onChange={(e) => changer(i, 'PrimeRcAnnuelle', e.target.value)} /></td>
                      {MOIS.map((m) => (
                        <td key={m} style={cellule}>
                          <input type="number" min={0} className="form-control" style={champ} value={t.Accessoires?.[m - 1] ?? ''} onChange={(e) => changerAccessoire(i, m - 1, e.target.value)} />
                        </td>
                      ))}
                      <td style={cellule}>
                        <button type="button" className="btn btn-secondary" onClick={() => setTranches((l) => l.filter((_, k) => k !== i))} style={{ padding: '0.3rem 0.45rem' }} title="Supprimer la tranche"><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionParametrage>

          <SectionParametrage icone={SlidersHorizontal} titre="Règles de calcul" description="Recours, fractions de la prime annuelle selon la durée, décompte des places. Aucune réduction (flotte ou commerciale) sur la prime du Pool : le tarif annoté NSIA (catégorie 4) l'exclut.">
            {parametres.map((p) => (
              <LigneParametre key={p.Cle} parametre={p}
                modifier={parametrageApi.modifierParametrePoolTpv} retablir={parametrageApi.retablirParametrePoolTpv}
                onEnregistre={(n) => { setDonnees((d) => ({ ...d, Parametres: d.Parametres.map((x) => (x.Cle === n.Cle ? n : x)) })); chargerParametrage(true); }} />
            ))}
          </SectionParametrage>

          <SectionParametrage icone={Link2} titre="Règles des garanties en catégorie 204"
            description="Tarif annoté NSIA, feuille « cat 4 » : RC et Recours relèvent du Pool ci-dessus (Recours à 5 % de la RC d'après le document du Pool ; hors Pool, NSIA le fixe à 10 % de la RC). Les autres garanties d'un véhicule TPV suivent ces règles, appliquées à l'écran de devis."
            actions={<Link to="/admin/settings/regles-garanties" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Link2 size={14} /> Modifier les règles</Link>}>
            {!regles && <div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Chargement…</div>}
            {regles && regles.Regles.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.86rem' }}>Aucune règle ne vise la catégorie 204.</div>}
            {regles && regles.Regles.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem', lineHeight: 1.75 }}>
                {regles.Regles.map((r) => {
                  const { titre, phrase: generale } = decrireRegle(r);
                  const phrase = r.Type === 'NON_PROPOSEE' ? `non commercialisée en catégorie ${CATEGORIE_TPV}` : generale;
                  const compagnie = (regles.Compagnies || []).find((c) => Number(c.Id) === Number(r.IdCompagnie))?.Nom;
                  return (
                    <li key={r.Id}>
                      <strong>{r.Libelle}</strong> : {phrase}
                      <span style={{ color: 'var(--text-muted)' }}> - {titre.toLowerCase()}{compagnie ? `, ${compagnie}` : ''}{r.Categories ? '' : ', toutes catégories'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionParametrage>

          <SectionParametrage icone={Wallet} titre="Primes dues au Pool"
            description="Contrats émis en offre « POOL TPV » (hors contrats annulés) : RC et Recours, hors taxes, par police."
            actions={(
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="date" className="form-control" value={periode.du} onChange={(e) => setPeriode((p) => ({ ...p, du: e.target.value }))} title="Émis à partir du" />
                <input type="date" className="form-control" value={periode.au} onChange={(e) => setPeriode((p) => ({ ...p, au: e.target.value }))} title="Émis jusqu'au" />
                <button type="button" className="btn btn-secondary" onClick={() => charger(periode)} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Search size={14} /> Afficher</button>
              </div>
            )}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
                    {['Police', 'Client', 'Compagnie', 'Émission', 'Période', 'Véhicules', 'RC', 'Recours', 'Dû au Pool'].map((t) => <th key={t} style={{ ...entete, textAlign: 'left' }}>{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(donnees.Suivi || []).length === 0 && (
                    <tr><td colSpan={9} style={{ ...cellule, color: 'var(--text-muted)', padding: '0.9rem' }}>Aucun contrat émis en offre « POOL TPV » sur la période.</td></tr>
                  )}
                  {(donnees.Suivi || []).map((l) => (
                    <tr key={l.IdContrat} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ ...cellule, fontWeight: 600 }}>{l.NumeroPolice}</td>
                      <td style={cellule}>{l.Client}</td>
                      <td style={cellule}>{l.Compagnie}</td>
                      <td style={cellule}>{date(l.DateEmission)}</td>
                      <td style={cellule}>{date(l.DateEffet)} – {date(l.DateExpiration)}</td>
                      <td style={cellule}>{l.Vehicules}</td>
                      <td style={{ ...cellule, whiteSpace: 'nowrap' }}>{montant(l.PrimeRc)}</td>
                      <td style={{ ...cellule, whiteSpace: 'nowrap' }}>{montant(l.PrimeRecours)}</td>
                      <td style={{ ...cellule, whiteSpace: 'nowrap', fontWeight: 700 }}>{montant(l.TotalPool)}</td>
                    </tr>
                  ))}
                </tbody>
                {(donnees.Suivi || []).length > 0 && (
                  <tfoot>
                    <tr><td colSpan={8} style={{ ...cellule, textAlign: 'right', fontWeight: 700 }}>Total dû au Pool</td><td style={{ ...cellule, fontWeight: 800 }}>{montant(total)}</td></tr>
                  </tfoot>
                )}
              </table>
            </div>
          </SectionParametrage>
        </>
      )}
    </div>
  );
};

export default ParametragePoolTpvPage;
