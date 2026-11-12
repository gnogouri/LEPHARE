import React, { useEffect, useMemo, useState } from 'react';
import { TrendingDown, Save, Loader2, Plus, Trash2, ArrowUp, ArrowDown, Calculator, ListOrdered, SlidersHorizontal, RotateCcw, ShieldAlert } from 'lucide-react';
import { chargerParametrage } from '../../../utils/parametrage';
import { EnTeteParametrage, SectionParametrage } from '../../../components/admin/EnTeteParametrage';
import { LigneParametre } from '../../../components/admin/LigneParametre';
import { AmountInput } from '../../../components/common/AmountInput';
import { parametrageApi, quoteApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { useToast } from '../../../context/ToastContext';

// Tableau de dépréciation des véhicules (CIEAMI) : lignes par genre, règles de classement, paramètres.
// configuration_api/parametrage_auto.py ; calcul par la base (fn_lephare_depreciation) à la saisie d'un
// véhicule, à l'import du formulaire et au renouvellement.

const AGES = [6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 96, 108, 120];
const libelleAge = (m) => (m % 12 === 0 ? `${m / 12} an${m > 12 ? 's' : ''}` : `${m} mois`);
const texteCase = (t) => (Array.isArray(t) && t.length ? t.map((x) => String(x).replace('.', ',')).join('/') : '');
const cellule = { padding: '0.35rem 0.3rem', verticalAlign: 'middle', fontSize: '0.82rem' };
const entete = { padding: '0.5rem 0.3rem', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-muted)', textAlign: 'center', whiteSpace: 'nowrap' };
const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Ligne du tableau : une case par âge, « 30 » ou « 30/35 ». */
const LigneTableau = ({ classe, onEnregistre }) => {
  const { success, error: toastError } = useToast();
  const ages = useMemo(() => [...new Set([...AGES, ...Object.keys(classe.Taux || {}).map(Number)])].sort((a, b) => a - b), [classe.Taux]);
  const initiale = useMemo(() => Object.fromEntries(ages.map((a) => [a, texteCase(classe.Taux?.[a])])), [ages, classe.Taux]);
  const [saisie, setSaisie] = useState(initiale);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => setSaisie(initiale), [initiale]);
  const modifiee = ages.some((a) => saisie[a] !== initiale[a]);

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      onEnregistre(await parametrageApi.modifierClasseDepreciation(classe.Code, { Taux: saisie }));
      success(`${classe.Libelle} : enregistrée.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <td style={{ ...cellule, minWidth: 190, position: 'sticky', left: 0, background: 'var(--bg-card, var(--bg-primary))' }}>
        <div style={{ fontWeight: 600 }}>{classe.Libelle}</div>
        {classe.Kilometrage && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{classe.Kilometrage}</div>}
      </td>
      {AGES.map((a) => (
        <td key={a} style={cellule}>
          <input className="form-control" value={saisie[a] ?? ''} onChange={(e) => setSaisie((s) => ({ ...s, [a]: e.target.value }))}
            style={{ width: 62, padding: '0.3rem', textAlign: 'center', fontSize: '0.8rem', borderColor: saisie[a] !== initiale[a] ? 'var(--primary-500)' : undefined }} />
        </td>
      ))}
      <td style={{ ...cellule, whiteSpace: 'nowrap' }}>
        <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={!modifiee || envoi} title="Enregistrer la ligne"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', padding: '0.35rem 0.6rem' }}>
          {envoi ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
        </button>
        {modifiee && (
          <button type="button" className="btn btn-secondary" onClick={() => setSaisie(initiale)} title="Annuler les changements"
            style={{ marginLeft: 4, fontSize: '0.78rem', padding: '0.35rem 0.6rem' }}><RotateCcw size={13} /></button>
        )}
      </td>
    </tr>
  );
};

export const ParametrageDepreciationPage = () => {
  const { success, error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [regles, setRegles] = useState([]);
  const [envoiRegles, setEnvoiRegles] = useState(false);
  const [reglesAge, setReglesAge] = useState([]);
  const [envoiAge, setEnvoiAge] = useState(false);
  const [simulation, setSimulation] = useState({ IdGenre: '4', CodeCategorie: '', ValeurNeuve: 10000000, DateMec: '2023-01-01', DateEffet: aujourdhui(), ChargeUtile: 0 });
  const [resultat, setResultat] = useState(null);

  useEffect(() => {
    parametrageApi.getDepreciation().then((d) => { setDonnees(d); setRegles(d.Regles); setReglesAge(d.ReglesGaranties || []); })
      .catch((err) => toastError(`Tableau de dépréciation non chargé : ${messageErreurApi(err)}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const libelle = (liste, id) => (liste || []).find((x) => String(x.id ?? x.code) === String(id))?.libelle || '';
  const reglesModifiees = donnees && JSON.stringify(regles) !== JSON.stringify(donnees.Regles);

  const deplacer = (i, sens) => setRegles((l) => {
    const copie = [...l];
    const j = i + sens;
    if (j < 0 || j >= copie.length) return l;
    [copie[i], copie[j]] = [copie[j], copie[i]];
    return copie;
  });
  const changer = (i, champ, valeur) => setRegles((l) => l.map((r, k) => (k === i ? { ...r, [champ]: valeur === '' ? null : valeur } : r)));

  const enregistrerRegles = async () => {
    setEnvoiRegles(true);
    try {
      const nouvelles = await parametrageApi.modifierReglesDepreciation(regles);
      setRegles(nouvelles);
      setDonnees((d) => ({ ...d, Regles: nouvelles }));
      success('Règles de classement enregistrées.');
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoiRegles(false);
    }
  };

  const reglesAgeModifiees = donnees && JSON.stringify(reglesAge) !== JSON.stringify(donnees.ReglesGaranties || []);
  const changerAge = (i, champ, valeur) => setReglesAge((l) => l.map((r, k) => (k === i ? { ...r, [champ]: valeur } : r)));
  const enregistrerReglesAge = async () => {
    setEnvoiAge(true);
    try {
      const nouvelles = await parametrageApi.modifierReglesGarantiesAuto(reglesAge);
      setReglesAge(nouvelles);
      setDonnees((d) => ({ ...d, ReglesGaranties: nouvelles }));
      chargerParametrage(true);
      success('Garanties admises selon l\'âge enregistrées.');
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoiAge(false);
    }
  };

  const simuler = async () => {
    try {
      const [r] = await quoteApi.calculerValeursVenales([{ ...simulation }], simulation.DateEffet);
      setResultat(r);
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };

  const remplacerParametre = (p) => setDonnees((d) => ({ ...d, Parametres: d.Parametres.map((x) => (x.Cle === p.Cle ? p : x)) }));
  const tauxRetenu = donnees?.Parametres?.find((p) => p.Cle === 'auto.depreciation.taux_retenu');

  const choixListe = (liste, valeur, onChange, vide = 'Tous') => (
    <select className="form-control" value={valeur ?? ''} onChange={(e) => onChange(e.target.value)} style={{ fontSize: '0.8rem', padding: '0.3rem', minWidth: 130 }}>
      <option value="">{vide}</option>
      {(liste || []).map((x) => <option key={x.id ?? x.code} value={x.id ?? x.code}>{x.code ? `${x.code} - ${x.libelle}` : x.libelle}</option>)}
    </select>
  );

  return (
    <div style={{ padding: '1.5rem' }}>
      <EnTeteParametrage
        icone={TrendingDown}
        titre="Dépréciation et âge des véhicules"
        description="Tableau de dépréciation applicable aux véhicules terrestres à moteur en Côte d'Ivoire (CIEAMI) : taux selon le genre du véhicule et son âge depuis la première mise en circulation. Garanties admises par chaque compagnie selon l'âge du véhicule."
        usage="Valeur vénale = valeur neuve × (1 − taux) : proposée à la saisie d'un véhicule et à l'import du formulaire, recalculée à chaque renouvellement (le producteur peut toujours la corriger). Une garantie non admise pour l'âge du véhicule n'est pas cochée d'office à la saisie ; le producteur peut l'accorder quand même."
      />

      {!donnees && <div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Chargement…</div>}

      {donnees && (
        <>
          <SectionParametrage icone={TrendingDown} titre="Tableau de dépréciation (% de la valeur neuve)"
            description="Une case par âge : « 30 » ou deux taux « 30/35 ». Colonne retenue : la dernière atteinte par l'âge du véhicule (moins de 6 mois : pas de dépréciation). Case vide : la colonne précédente s'applique.">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 1400 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
                    <th style={{ ...entete, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-card, var(--bg-primary))' }}>Genre de véhicule</th>
                    {AGES.map((a) => <th key={a} style={entete}>{libelleAge(a)}</th>)}
                    <th style={entete} />
                  </tr>
                </thead>
                <tbody>
                  {donnees.Classes.map((c) => (
                    <LigneTableau key={c.Code} classe={c} onEnregistre={(n) => setDonnees((d) => ({ ...d, Classes: d.Classes.map((x) => (x.Code === n.Code ? n : x)) }))} />
                  ))}
                </tbody>
              </table>
            </div>
          </SectionParametrage>

          <SectionParametrage icone={SlidersHorizontal} titre="Règles d'application" description="Au-delà de 10 ans, choix entre deux taux et valeur minimum (notes du tableau CIEAMI).">
            {tauxRetenu && (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.2fr) minmax(200px, 1fr) auto', gap: '0.75rem 1.25rem', alignItems: 'center', padding: '0.85rem 0', borderTop: '1px solid var(--border-subtle)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{tauxRetenu.Libelle}</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Ex. « 30/35 » : 30 % (valeur vénale la plus haute), 35 % ou 32,5 %.</div>
                </div>
                <select className="form-control" value={tauxRetenu.Valeur} onChange={async (e) => {
                  try {
                    remplacerParametre(await parametrageApi.modifierParametreDepreciation(tauxRetenu.Cle, e.target.value));
                    success('Taux retenu enregistré.');
                  } catch (err) { toastError(messageErreurApi(err)); }
                }}>
                  {(donnees.ChoixTaux || []).map((c) => <option key={c.Code} value={c.Code}>{c.Libelle}</option>)}
                </select>
                <span />
              </div>
            )}
            {donnees.Parametres.filter((p) => p.Cle !== 'auto.depreciation.taux_retenu').map((p) => (
              <LigneParametre key={p.Cle} parametre={p} onEnregistre={remplacerParametre}
                modifier={parametrageApi.modifierParametreDepreciation} retablir={parametrageApi.retablirParametreDepreciation} />
            ))}
          </SectionParametrage>

          <SectionParametrage icone={ListOrdered} titre="Ligne du tableau retenue pour un véhicule"
            description="Règles examinées dans l'ordre : la première dont tous les critères renseignés correspondent au véhicule donne la ligne du tableau. La catégorie sert aux véhicules importés sans genre."
            actions={(
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setRegles((l) => [...l, { Classe: donnees.Classes[0]?.Code, IdGenre: null, IdTypeVehicule: null, IdCarrosserie: null, CodeCategorie: '', ChargeUtileSuperieureA: null }])}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Plus size={14} /> Ajouter une règle</button>
                <button type="button" className="btn btn-primary" onClick={enregistrerRegles} disabled={!reglesModifiees || envoiRegles}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>{envoiRegles ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer les règles</button>
              </div>
            )}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
                    {['#', 'Ligne du tableau', 'Genre', 'Type de véhicule', 'Carrosserie', 'Catégorie', 'Charge utile >', ''].map((t) => <th key={t} style={{ ...entete, textAlign: 'left' }}>{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {regles.map((r, i) => (
                    <tr key={`${r.Id || 'n'}-${i}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={cellule}>{i + 1}</td>
                      <td style={cellule}>
                        <select className="form-control" value={r.Classe} onChange={(e) => changer(i, 'Classe', e.target.value)} style={{ fontSize: '0.8rem', padding: '0.3rem' }}>
                          {donnees.Classes.map((c) => <option key={c.Code} value={c.Code}>{c.Libelle}</option>)}
                        </select>
                      </td>
                      <td style={cellule}>{choixListe(donnees.Genres, r.IdGenre, (v) => changer(i, 'IdGenre', v === '' ? null : Number(v)))}</td>
                      <td style={cellule}>{choixListe(donnees.Types, r.IdTypeVehicule, (v) => changer(i, 'IdTypeVehicule', v === '' ? null : Number(v)))}</td>
                      <td style={cellule}>{choixListe(donnees.Carrosseries, r.IdCarrosserie, (v) => changer(i, 'IdCarrosserie', v === '' ? null : Number(v)))}</td>
                      <td style={cellule}>{choixListe(donnees.Categories, r.CodeCategorie, (v) => changer(i, 'CodeCategorie', v))}</td>
                      <td style={cellule}>
                        <input type="number" min={0} className="form-control" value={r.ChargeUtileSuperieureA ?? ''} placeholder="kg"
                          onChange={(e) => changer(i, 'ChargeUtileSuperieureA', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 90, fontSize: '0.8rem', padding: '0.3rem' }} />
                      </td>
                      <td style={{ ...cellule, whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn btn-secondary" onClick={() => deplacer(i, -1)} disabled={i === 0} style={{ padding: '0.3rem 0.45rem' }} title="Monter"><ArrowUp size={13} /></button>
                        <button type="button" className="btn btn-secondary" onClick={() => deplacer(i, 1)} disabled={i === regles.length - 1} style={{ padding: '0.3rem 0.45rem', marginLeft: 3 }} title="Descendre"><ArrowDown size={13} /></button>
                        <button type="button" className="btn btn-secondary" onClick={() => setRegles((l) => l.filter((_, k) => k !== i))} style={{ padding: '0.3rem 0.45rem', marginLeft: 3 }} title="Supprimer"><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Un véhicule sans règle correspondante (engin de chantier, tracteur agricole…) n'a pas de valeur proposée : le producteur la saisit.
              {' '}Exemples : {regles.slice(0, 3).map((r) => [libelle(donnees.Genres, r.IdGenre), libelle(donnees.Types, r.IdTypeVehicule), libelle(donnees.Carrosseries, r.IdCarrosserie), r.CodeCategorie].filter(Boolean).join(' + ')).join(' ; ')}.
            </div>
          </SectionParametrage>

          <SectionParametrage icone={ShieldAlert} titre="Garanties admises selon l'âge du véhicule"
            description="Âge en années révolues à la date d'effet : minimum inclus, maximum exclu (ex. tous risques NSIA de 0 à 5 ans, NSIA Auto Plus de 5 à 10 ans). Catégories : codes séparés par des virgules, vide pour toutes."
            actions={(
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setReglesAge((l) => [...l, { IdCompagnie: donnees.Compagnies?.[0]?.id, IdSousGarantie: null, AgeMinimum: null, AgeMaximum: null, Categories: '', Commentaire: '' }])}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Plus size={14} /> Ajouter une règle</button>
                <button type="button" className="btn btn-primary" onClick={enregistrerReglesAge} disabled={!reglesAgeModifiees || envoiAge}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>{envoiAge ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer</button>
              </div>
            )}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
                    {['Compagnie', 'Garantie', 'Âge minimum (ans)', 'Âge maximum (ans, exclu)', 'Catégories', 'Commentaire', ''].map((t) => <th key={t} style={{ ...entete, textAlign: 'left' }}>{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {reglesAge.length === 0 && (
                    <tr><td colSpan={7} style={{ ...cellule, color: 'var(--text-muted)', padding: '0.8rem' }}>Aucune règle : toutes les garanties sont admises quel que soit l'âge.</td></tr>
                  )}
                  {reglesAge.map((r, i) => (
                    <tr key={`${r.Id || 'n'}-${i}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={cellule}>{choixListe(donnees.Compagnies, r.IdCompagnie, (v) => changerAge(i, 'IdCompagnie', v === '' ? null : Number(v)), 'Choisir')}</td>
                      <td style={cellule}>{choixListe(donnees.SousGaranties, r.IdSousGarantie, (v) => changerAge(i, 'IdSousGarantie', v === '' ? null : Number(v)), 'Choisir')}</td>
                      <td style={cellule}>
                        <input type="number" min={0} className="form-control" value={r.AgeMinimum ?? ''} placeholder="0"
                          onChange={(e) => changerAge(i, 'AgeMinimum', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 90, fontSize: '0.8rem', padding: '0.3rem' }} />
                      </td>
                      <td style={cellule}>
                        <input type="number" min={1} className="form-control" value={r.AgeMaximum ?? ''} placeholder="sans limite"
                          onChange={(e) => changerAge(i, 'AgeMaximum', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 110, fontSize: '0.8rem', padding: '0.3rem' }} />
                      </td>
                      <td style={cellule}>
                        <input className="form-control" value={r.Categories || ''} placeholder="toutes" onChange={(e) => changerAge(i, 'Categories', e.target.value)} style={{ width: 120, fontSize: '0.8rem', padding: '0.3rem' }} />
                      </td>
                      <td style={cellule}>
                        <input className="form-control" value={r.Commentaire || ''} maxLength={200} onChange={(e) => changerAge(i, 'Commentaire', e.target.value)} style={{ minWidth: 220, fontSize: '0.8rem', padding: '0.3rem' }} />
                      </td>
                      <td style={cellule}>
                        <button type="button" className="btn btn-secondary" onClick={() => setReglesAge((l) => l.filter((_, k) => k !== i))} style={{ padding: '0.3rem 0.45rem' }} title="Supprimer"><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionParametrage>

          <SectionParametrage icone={Calculator} titre="Simuler une valeur vénale" description="Contrôle du tableau et des règles enregistrés (rien n'est enregistré).">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.6rem 1rem', alignItems: 'end' }}>
              <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Genre</label>{choixListe(donnees.Genres, simulation.IdGenre, (v) => setSimulation((s) => ({ ...s, IdGenre: v })), 'Non renseigné')}</div>
              <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Catégorie</label>{choixListe(donnees.Categories, simulation.CodeCategorie, (v) => setSimulation((s) => ({ ...s, CodeCategorie: v })))}</div>
              <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Charge utile (kg)</label>
                <input type="number" min={0} className="form-control" value={simulation.ChargeUtile} onChange={(e) => setSimulation((s) => ({ ...s, ChargeUtile: e.target.value }))} /></div>
              <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Valeur neuve</label>
                <AmountInput value={simulation.ValeurNeuve} onChange={(v) => setSimulation((s) => ({ ...s, ValeurNeuve: v }))} suffix="FCFA" /></div>
              <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">1re mise en circulation</label>
                <input type="date" className="form-control" value={simulation.DateMec} onChange={(e) => setSimulation((s) => ({ ...s, DateMec: e.target.value }))} /></div>
              <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Date d'effet</label>
                <input type="date" className="form-control" value={simulation.DateEffet} onChange={(e) => setSimulation((s) => ({ ...s, DateEffet: e.target.value }))} /></div>
              <button type="button" className="btn btn-primary" onClick={simuler} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'center' }}><Calculator size={14} /> Calculer</button>
            </div>
            {resultat && (
              <div style={{ marginTop: '0.9rem', padding: '0.7rem 0.9rem', borderRadius: 8, background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.18)', fontSize: '0.86rem' }}>
                {resultat.ValeurVenale === null
                  ? resultat.Explication
                  : <>Valeur vénale : <strong>{Number(resultat.ValeurVenale).toLocaleString('fr-FR')} F</strong> - {resultat.Explication} (âge : {resultat.AgeMois} mois).</>}
              </div>
            )}
          </SectionParametrage>
        </>
      )}
    </div>
  );
};

export default ParametrageDepreciationPage;
