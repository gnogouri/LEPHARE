import React, { useEffect, useMemo, useState } from 'react';
import { Plane, Plus, Edit2, Trash2, Calculator, Globe2, Layers, Search, Loader2, Info, Save, Table2 } from 'lucide-react';
import { grillesVoyageApi, voyageApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { Modal } from '../../../components/common/Modal';
import { AmountInput } from '../../../components/common/AmountInput';

// Grilles Voyage de la base, lues par le calcul des devis (fn_garantie_offre_voyage) :
// NSIA = grille par offre (une ligne sans zone vaut dans toutes les zones où l'offre est proposée),
// AMSA = grille par formule et par zone. Taxe = (prime nette + accessoire) x taux, arrondie au franc.

const fcfa = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const taxeDe = (pn, acc, taux) => Math.round(((Number(pn) || 0) + (Number(acc) || 0)) * (Number(taux) || 0) / 100);
const versDmy = (d) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
const libelleDuree = (min, max) => {
  const fin = { 184: '6 mois', 276: '9 mois', 365: '1 an', 366: '1 an' }[max];
  return `${min} – ${max} j${fin ? ` (${fin})` : ''}`;
};
const messageErreurApi = (err) => {
  const data = err?.response?.data;
  if (!data) return err?.message || 'serveur injoignable';
  if (typeof data === 'string') return data.slice(0, 200);
  return data.error || data.detail || JSON.stringify(data).slice(0, 200);
};

const ONGLETS = [
  { id: 'grille', libelle: 'Grille de primes', icone: Table2 },
  { id: 'offres', libelle: 'Offres et zones', icone: Layers },
  { id: 'pays', libelle: 'Pays de destination', icone: Globe2 },
];

const LIGNE_VIDE = { DureeMin: 1, DureeMax: 7, AgeMin: 0, AgeMax: 120, PrimeNette: 0, Accessoire: 0, TauxTaxe: 14.5, PrimeTtc: '', IdZone: '' };

// Prime TTC au taux : prime nette + accessoire + taxe arrondie
const ttcAuTaux = (l) => (Number(l.PrimeNette) || 0) + (Number(l.Accessoire) || 0) + taxeDe(l.PrimeNette, l.Accessoire, l.TauxTaxe);

export const ParametrageGrillesVoyagePage = () => {
  const { success, error: toastError } = useToast();
  const [compagnies, setCompagnies] = useState([]);
  const [idCompagnie, setIdCompagnie] = useState(null);
  const [param, setParam] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [onglet, setOnglet] = useState('grille');
  const [idTarif, setIdTarif] = useState(null);
  const [filtre, setFiltre] = useState(null); // offre (grille par offre) ou zone (grille par formule)
  const [edition, setEdition] = useState(null); // ligne en cours de saisie
  const [enregistrement, setEnregistrement] = useState(false);
  const [suppression, setSuppression] = useState(null);

  useEffect(() => {
    grillesVoyageApi.getCompagnies()
      .then((liste) => { setCompagnies(liste); setIdCompagnie(liste[0]?.IdCompagnie ?? null); })
      .catch((err) => toastError(`Grilles Voyage indisponibles : ${messageErreurApi(err)}`))
      .finally(() => setChargement(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const charger = (id = idCompagnie) => {
    if (!id) return Promise.resolve();
    setChargement(true);
    return grillesVoyageApi.getParametrage(id)
      .then((p) => {
        setParam(p);
        setIdTarif((avant) => (p.Formules.some((f) => f.IdTarif === avant) ? avant : p.Formules[0]?.IdTarif ?? null));
      })
      .catch((err) => toastError(`Paramétrage non chargé : ${messageErreurApi(err)}`))
      .finally(() => setChargement(false));
  };
  useEffect(() => { setParam(null); setFiltre(null); charger(idCompagnie); }, [idCompagnie]); // eslint-disable-line react-hooks/exhaustive-deps

  const parOffre = !!param?.GrilleParOffre;
  const zones = param?.Zones || [];
  const nomZone = (id) => zones.find((z) => z.IdZone === id)?.Libelle || `Zone ${id}`;
  const formule = param?.Formules.find((f) => f.IdTarif === idTarif);
  const offres = formule?.Offres || [];

  // Filtre par défaut : première offre active (NSIA) ou première zone (AMSA)
  useEffect(() => {
    if (!param) return;
    if (parOffre) {
      if (!offres.some((o) => o.IdOffre === filtre)) setFiltre((offres.find((o) => o.Actif) || offres[0])?.IdOffre ?? null);
    } else if (!zones.some((z) => z.IdZone === filtre)) {
      setFiltre(zones.find((z) => z.Pays > 0)?.IdZone ?? zones[0]?.IdZone ?? null);
    }
  }, [param, idTarif]); // eslint-disable-line react-hooks/exhaustive-deps

  const lignes = useMemo(() => (param?.Lignes || [])
    .filter((l) => (parOffre ? l.IdOffre === filtre : l.IdTarif === idTarif && l.IdZone === filtre))
    .sort((a, b) => (a.IdZone ?? 0) - (b.IdZone ?? 0) || a.AgeMin - b.AgeMin || a.DureeMin - b.DureeMin),
  [param, parOffre, filtre, idTarif]);

  const ouvrirSaisie = (ligne) => {
    const derniere = lignes[lignes.length - 1];
    // TTC du document gardée seulement quand elle diffère du calcul au taux (sinon recalculée)
    setEdition(ligne ? { ...ligne, IdZone: ligne.IdZone ?? '', PrimeTtc: Number(ligne.PrimeTtc) !== ttcAuTaux(ligne) ? ligne.PrimeTtc : '' } : {
      ...LIGNE_VIDE,
      ...(derniere ? { AgeMin: derniere.AgeMin, AgeMax: derniere.AgeMax, Accessoire: derniere.Accessoire, TauxTaxe: derniere.TauxTaxe, DureeMin: derniere.DureeMax + 1, DureeMax: derniere.DureeMax + 1 } : {}),
      IdZone: parOffre ? '' : filtre,
    });
  };

  const enregistrerLigne = async (e) => {
    e.preventDefault();
    setEnregistrement(true);
    const corps = {
      ...edition,
      IdZone: edition.IdZone === '' ? null : Number(edition.IdZone),
      ...(parOffre ? { IdOffre: filtre } : { IdTarif: idTarif }),
    };
    try {
      if (edition.Id) await grillesVoyageApi.modifierLigne(idCompagnie, edition.Id, corps);
      else await grillesVoyageApi.creerLigne(idCompagnie, corps);
      success(edition.Id ? 'Ligne de grille modifiée : les nouveaux calculs l\'appliquent.' : 'Ligne de grille ajoutée.');
      setEdition(null);
      await charger();
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnregistrement(false);
    }
  };

  const supprimerLigne = async () => {
    try {
      await grillesVoyageApi.supprimerLigne(idCompagnie, suppression.Id);
      success('Ligne de grille supprimée.');
      setSuppression(null);
      await charger();
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };

  const libelleFiltre = parOffre
    ? offres.find((o) => o.IdOffre === filtre)?.Libelle
    : filtre && nomZone(filtre);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 1280, margin: '0 auto', paddingBottom: '3rem' }}>
      <div>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: 0 }}>
          <Plane size={26} style={{ color: 'var(--primary-500)' }} /> Grilles Voyage
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.3rem 0 0', maxWidth: 900 }}>
          Primes, accessoires et taxes des devis Voyage par compagnie. Une modification s'applique aux nouveaux calculs
          et aux devis enregistrés ou modifiés ensuite ; les devis existants gardent leurs montants. Chaque modification
          est inscrite au journal d'audit.
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ margin: 0, minWidth: 220 }}>
          <label className="form-label" htmlFor="gv-compagnie">Compagnie</label>
          <select id="gv-compagnie" className="form-control" value={idCompagnie ?? ''} onChange={(e) => setIdCompagnie(Number(e.target.value))}>
            {compagnies.map((c) => <option key={c.IdCompagnie} value={c.IdCompagnie}>{c.RaisonSociale}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }} role="tablist">
          {ONGLETS.map(({ id, libelle, icone: Icone }) => (
            <button key={id} type="button" role="tab" aria-selected={onglet === id} className={`btn ${onglet === id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setOnglet(id)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Icone size={15} /> {libelle}
            </button>
          ))}
        </div>
        {param && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {parOffre ? 'Grille par offre (une ligne sans zone vaut pour toutes les zones de l\'offre)' : 'Grille par formule et par zone de destination'}
          </span>
        )}
      </div>

      {chargement && !param && <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}><Loader2 className="spin" /> Chargement…</div>}

      {param && onglet === 'grille' && (
        <>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
              <div className="form-group" style={{ margin: 0, minWidth: 220 }}>
                <label className="form-label" htmlFor="gv-formule">Formule</label>
                <select id="gv-formule" className="form-control" value={idTarif ?? ''} onChange={(e) => setIdTarif(Number(e.target.value))}>
                  {param.Formules.map((f) => <option key={f.IdTarif} value={f.IdTarif}>{f.Libelle}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0, minWidth: 260 }}>
                <label className="form-label" htmlFor="gv-filtre">{parOffre ? 'Offre' : 'Zone de destination'}</label>
                <select id="gv-filtre" className="form-control" value={filtre ?? ''} onChange={(e) => setFiltre(Number(e.target.value))}>
                  {parOffre
                    ? offres.map((o) => <option key={o.IdOffre} value={o.IdOffre}>{o.Libelle}{o.Actif ? '' : ' - inactive'}</option>)
                    : zones.map((z) => <option key={z.IdZone} value={z.IdZone}>{z.Libelle} - {z.Pays} pays</option>)}
                </select>
              </div>
              <button type="button" className="btn btn-primary" disabled={!filtre} onClick={() => ouvrirSaisie(null)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
                <Plus size={16} /> Ajouter une ligne
              </button>
            </div>

            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    {parOffre && <th>Zone</th>}
                    <th>Âge</th>
                    <th>Durée</th>
                    <th style={{ textAlign: 'right' }}>Prime nette</th>
                    <th style={{ textAlign: 'right' }}>Accessoire</th>
                    <th style={{ textAlign: 'right' }}>Taxe</th>
                    <th style={{ textAlign: 'right' }}>Prime TTC</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => (
                    <tr key={l.Id}>
                      {parOffre && <td>{l.IdZone ? nomZone(l.IdZone) : <span style={{ color: 'var(--text-muted)' }}>Toutes ses zones</span>}</td>}
                      <td>{l.AgeMin} – {l.AgeMax} ans</td>
                      <td>{libelleDuree(l.DureeMin, l.DureeMax)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fcfa(l.PrimeNette)}</td>
                      <td style={{ textAlign: 'right' }}>{fcfa(l.Accessoire)}</td>
                      <td style={{ textAlign: 'right' }}>{fcfa(l.Taxe)} <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({Number(l.TauxTaxe).toLocaleString('fr-FR')} %)</span></td>
                      <td style={{ textAlign: 'right', fontWeight: 800 }}>{fcfa(l.PrimeTtc)}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem' }} onClick={() => ouvrirSaisie(l)} aria-label="Modifier la ligne"><Edit2 size={14} /></button>{' '}
                        <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', color: 'var(--accent-rose)' }} onClick={() => setSuppression(l)} aria-label="Supprimer la ligne"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                  {!lignes.length && (
                    <tr><td colSpan={parOffre ? 8 : 7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                      Aucune ligne {libelleFiltre ? `pour ${libelleFiltre}` : ''} : cette combinaison n'est pas tarifée (le devis est refusé).
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.75rem 0 0', display: 'flex', gap: '0.4rem' }}>
              <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              Durée = jours couverts, date d'effet et date d'expiration comprises. Âge à la date du devis. Hors de toutes les lignes
              (âge, durée), aucune prime : le devis n'est pas enregistré.
            </p>
          </div>
          <Simulateur param={param} idCompagnie={idCompagnie} />
        </>
      )}

      {param && onglet === 'offres' && <OffresZones param={param} idCompagnie={idCompagnie} recharger={charger} />}
      {param && onglet === 'pays' && <PaysZones param={param} idCompagnie={idCompagnie} setParam={setParam} />}

      <Modal isOpen={!!edition} onClose={() => setEdition(null)} title={edition?.Id ? 'Modifier la ligne de grille' : 'Ajouter une ligne de grille'}
        subtitle={`${param?.RaisonSociale || ''} - ${formule?.Libelle || ''} - ${libelleFiltre || ''}`} size="medium">
        {edition && (
          <form onSubmit={enregistrerLigne}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.9rem' }}>
              {[['DureeMin', 'Durée de (jours)'], ['DureeMax', 'à (jours)'], ['AgeMin', 'Âge de (ans)'], ['AgeMax', 'à (ans)']].map(([champ, libelle]) => (
                <div key={champ} className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor={`gv-${champ}`}>{libelle}</label>
                  <input id={`gv-${champ}`} type="number" min={champ.startsWith('Duree') ? 1 : 0} className="form-control" required
                    value={edition[champ]} onChange={(e) => setEdition({ ...edition, [champ]: e.target.value })} />
                </div>
              ))}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="gv-pn">Prime nette</label>
                <AmountInput id="gv-pn" value={edition.PrimeNette} onChange={(v) => setEdition({ ...edition, PrimeNette: v })} required />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="gv-acc">Accessoire</label>
                <AmountInput id="gv-acc" value={edition.Accessoire} onChange={(v) => setEdition({ ...edition, Accessoire: v })} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="gv-taux">Taux de taxe (%)</label>
                <input id="gv-taux" type="number" step="0.01" min="0" max="100" className="form-control" required
                  value={edition.TauxTaxe} onChange={(e) => setEdition({ ...edition, TauxTaxe: e.target.value })} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="gv-ttc">Prime TTC du document</label>
                <AmountInput id="gv-ttc" value={edition.PrimeTtc} onChange={(v) => setEdition({ ...edition, PrimeTtc: v })} placeholder="Calculée" />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="gv-zone">Zone</label>
                <select id="gv-zone" className="form-control" value={edition.IdZone ?? ''} disabled={!parOffre}
                  onChange={(e) => setEdition({ ...edition, IdZone: e.target.value === '' ? '' : Number(e.target.value) })}>
                  {parOffre && <option value="">Toutes les zones où l'offre est proposée</option>}
                  {zones.map((z) => <option key={z.IdZone} value={z.IdZone}>{z.Libelle}</option>)}
                </select>
              </div>
            </div>
            <div className="glass-panel" style={{ marginTop: '1rem', padding: '0.8rem 1rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.88rem' }}>
              {Number(edition.PrimeTtc) > 0 ? (
                <>
                  <span>Taxe : <strong>{fcfa(Number(edition.PrimeTtc) - (Number(edition.PrimeNette) || 0) - (Number(edition.Accessoire) || 0))} F</strong> (TTC − prime nette − accessoire)</span>
                  <span>Prime TTC : <strong>{fcfa(edition.PrimeTtc)} F</strong> (document ; calcul au taux : {fcfa(ttcAuTaux(edition))} F)</span>
                </>
              ) : (
                <>
                  <span>Taxe : <strong>{fcfa(taxeDe(edition.PrimeNette, edition.Accessoire, edition.TauxTaxe))} F</strong></span>
                  <span>Prime TTC : <strong>{fcfa(ttcAuTaux(edition))} F</strong></span>
                </>
              )}
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.6rem 0 0' }}>
              Prime TTC du document : facultative. Les tarifs calculent la taxe sur une prime nette non arrondie ; saisissez
              la TTC imprimée sur le document (à 1 F près du calcul au taux) pour que le devis la reprenne exactement.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.2rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEdition(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={enregistrement} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {enregistrement ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Enregistrer
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={!!suppression} onClose={() => setSuppression(null)} title="Supprimer la ligne de grille" size="small">
        {suppression && (
          <>
            <p style={{ margin: 0 }}>
              {suppression.AgeMin} – {suppression.AgeMax} ans, {libelleDuree(suppression.DureeMin, suppression.DureeMax)} :
              prime nette {fcfa(suppression.PrimeNette)} F. Sans ligne, ces devis ne sont plus tarifés.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.2rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSuppression(null)}>Annuler</button>
              <button type="button" className="btn btn-primary" style={{ background: 'var(--accent-rose)' }} onClick={supprimerLigne}>Supprimer</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
};

// Calcul d'essai par le même service que le devis (POST /api/offregarantievoyage)
const Simulateur = ({ param, idCompagnie }) => {
  const [idTarif, setIdTarif] = useState(param.Formules[0]?.IdTarif ?? null);
  const formule = param.Formules.find((f) => f.IdTarif === idTarif);
  const [idOffre, setIdOffre] = useState(null);
  const [idZone, setIdZone] = useState(null);
  const [age, setAge] = useState(35);
  const [jours, setJours] = useState(10);
  const [resultat, setResultat] = useState(null);
  const [calcul, setCalcul] = useState(false);

  const offresZone = (formule?.Offres || []).filter((o) => o.Actif && (!idZone || o.Zones.includes(idZone)));
  useEffect(() => { setIdTarif((t) => (param.Formules.some((f) => f.IdTarif === t) ? t : param.Formules[0]?.IdTarif ?? null)); }, [param]);
  useEffect(() => { if (!param.Zones.some((z) => z.IdZone === idZone)) setIdZone(param.Zones.find((z) => z.Pays > 0)?.IdZone ?? null); }, [param]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!offresZone.some((o) => o.IdOffre === idOffre)) setIdOffre(offresZone[0]?.IdOffre ?? null); }, [idTarif, idZone, param]); // eslint-disable-line react-hooks/exhaustive-deps

  const calculer = async () => {
    if (!idOffre || !idZone) return;
    setCalcul(true);
    const effet = new Date();
    const expiration = new Date(effet); expiration.setDate(effet.getDate() + Number(jours) - 1);
    const naissance = new Date(effet.getFullYear() - Number(age), effet.getMonth(), effet.getDate() - 1);
    try {
      const lignes = await voyageApi.calculerPrime({
        IdOffre: idOffre, IdCompagnie: idCompagnie, IdTarif: idTarif, IdZoneVoyage: idZone, TauxReduction: 0,
        DateEffet: versDmy(effet), DateExpiration: versDmy(expiration), DateNaissance: versDmy(naissance),
      });
      const cumul = (Array.isArray(lignes) ? lignes : []).find((l) => Number(l.IdGarantie) === 0);
      setResultat(cumul ? {
        pn: Number(cumul.PrimeNette), acc: Number(cumul.MontantAccessoire), taxe: Number(cumul.Taxe),
      } : { erreur: 'Réponse vide' });
    } catch (err) {
      setResultat({ erreur: messageErreurApi(err) });
    } finally {
      setCalcul(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '1.25rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Calculator size={18} style={{ color: 'var(--primary-500)' }} /> Calcul d'essai
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.8rem', alignItems: 'end' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="sim-formule">Formule</label>
          <select id="sim-formule" className="form-control" value={idTarif ?? ''} onChange={(e) => setIdTarif(Number(e.target.value))}>
            {param.Formules.map((f) => <option key={f.IdTarif} value={f.IdTarif}>{f.Libelle}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="sim-zone">Zone de destination</label>
          <select id="sim-zone" className="form-control" value={idZone ?? ''} onChange={(e) => setIdZone(Number(e.target.value))}>
            {param.Zones.map((z) => <option key={z.IdZone} value={z.IdZone}>{z.Libelle}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="sim-offre">Offre</label>
          <select id="sim-offre" className="form-control" value={idOffre ?? ''} onChange={(e) => setIdOffre(Number(e.target.value))} disabled={!offresZone.length}>
            {!offresZone.length && <option value="">Aucune offre dans cette zone</option>}
            {offresZone.map((o) => <option key={o.IdOffre} value={o.IdOffre}>{o.Libelle}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="sim-age">Âge (ans)</label>
          <input id="sim-age" type="number" min="0" className="form-control" value={age} onChange={(e) => setAge(e.target.value)} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="sim-jours">Jours couverts</label>
          <input id="sim-jours" type="number" min="1" className="form-control" value={jours} onChange={(e) => setJours(e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary" onClick={calculer} disabled={calcul || !idOffre} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center' }}>
          {calcul ? <Loader2 size={15} className="spin" /> : <Calculator size={15} />} Calculer
        </button>
      </div>
      {resultat && (
        <div style={{ marginTop: '0.9rem', fontSize: '0.9rem', display: 'flex', gap: '1.4rem', flexWrap: 'wrap' }}>
          {resultat.erreur && <span style={{ color: 'var(--accent-rose)' }}>{resultat.erreur}</span>}
          {!resultat.erreur && resultat.pn <= 0 && <span style={{ color: 'var(--accent-amber)' }}>Hors grille : aucune prime pour cet âge, cette durée ou cette zone.</span>}
          {!resultat.erreur && resultat.pn > 0 && (
            <>
              <span>Prime nette <strong>{fcfa(resultat.pn)} F</strong></span>
              <span>Accessoire <strong>{fcfa(resultat.acc)} F</strong></span>
              <span>Taxe <strong>{fcfa(resultat.taxe)} F</strong></span>
              <span>Prime TTC <strong style={{ color: 'var(--primary-500)' }}>{fcfa(resultat.pn + resultat.acc + resultat.taxe)} F</strong></span>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Offres : libellé, active, zones de destination où elle est proposée
const OffresZones = ({ param, idCompagnie, recharger }) => {
  const { success, error: toastError } = useToast();
  const [saisies, setSaisies] = useState({});
  const [enCours, setEnCours] = useState(null);
  useEffect(() => { setSaisies({}); }, [param]);

  const valeur = (o) => saisies[o.IdOffre] || { Libelle: o.Libelle, Actif: o.Actif, Zones: o.Zones };
  const modifier = (o, champs) => setSaisies((s) => ({ ...s, [o.IdOffre]: { ...valeur(o), ...champs } }));

  const enregistrer = async (o) => {
    setEnCours(o.IdOffre);
    try {
      await grillesVoyageApi.modifierOffre(idCompagnie, o.IdOffre, valeur(o));
      success(`Offre ${valeur(o).Libelle} enregistrée.`);
      await recharger();
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnCours(null);
    }
  };

  return param.Formules.map((f) => (
    <div key={f.IdTarif} className="glass-panel" style={{ padding: '1.25rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.3rem' }}>{f.Libelle}</h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.8rem' }}>
        Une offre n'est proposée au devis que si elle est active et cochée pour la zone du pays de destination.
        {!f.Offres.some((o) => o.Actif && o.Zones.length) && ' Aucune offre proposée : cette formule n\'apparaît pas dans les devis.'}
      </p>
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr><th>Offre</th><th>Active</th>{param.Zones.map((z) => <th key={z.IdZone} style={{ textAlign: 'center' }}>{z.Libelle}</th>)}<th aria-label="Enregistrer" /></tr>
          </thead>
          <tbody>
            {f.Offres.map((o) => {
              const v = valeur(o);
              const modifiee = !!saisies[o.IdOffre];
              return (
                <tr key={o.IdOffre}>
                  <td style={{ minWidth: 220 }}>
                    <input className="form-control" value={v.Libelle} aria-label={`Libellé de l'offre ${o.IdOffre}`} onChange={(e) => modifier(o, { Libelle: e.target.value })} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={v.Actif} aria-label="Offre active" onChange={(e) => modifier(o, { Actif: e.target.checked })} style={{ width: 17, height: 17 }} />
                  </td>
                  {param.Zones.map((z) => (
                    <td key={z.IdZone} style={{ textAlign: 'center' }}>
                      <input type="checkbox" aria-label={`Proposée en ${z.Libelle}`} checked={v.Zones.includes(z.IdZone)} style={{ width: 17, height: 17 }}
                        onChange={(e) => modifier(o, { Zones: e.target.checked ? [...v.Zones, z.IdZone] : v.Zones.filter((x) => x !== z.IdZone) })} />
                    </td>
                  ))}
                  <td>
                    <button type="button" className="btn btn-primary" disabled={!modifiee || enCours === o.IdOffre} onClick={() => enregistrer(o)} aria-label={`Enregistrer l'offre ${v.Libelle}`} style={{ padding: '0.3rem 0.7rem' }}>
                      {enCours === o.IdOffre ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  ));
};

// Zone de chaque pays de destination pour la compagnie (une zone par pays)
const PaysZones = ({ param, idCompagnie, setParam }) => {
  const { success, error: toastError } = useToast();
  const [recherche, setRecherche] = useState('');
  const [zoneFiltre, setZoneFiltre] = useState('');
  const normaliser = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const pays = param.Pays.filter((p) => (!recherche || normaliser(p.Libelle).includes(normaliser(recherche)))
    && (zoneFiltre === '' || String(p.IdZone ?? 'aucune') === zoneFiltre));
  const nonCouverts = param.Pays.filter((p) => !p.IdZone).length;

  const changer = async (p, valeurZone) => {
    const idZone = valeurZone === '' ? null : Number(valeurZone);
    try {
      await grillesVoyageApi.modifierZonePays(idCompagnie, p.IdPays, idZone);
      setParam((avant) => {
        const paysMaj = avant.Pays.map((x) => (x.IdPays === p.IdPays ? { ...x, IdZone: idZone } : x));
        return { ...avant, Pays: paysMaj, Zones: avant.Zones.map((z) => ({ ...z, Pays: paysMaj.filter((x) => x.IdZone === z.IdZone).length })) };
      });
      success(`${p.Libelle} : ${idZone ? param.Zones.find((z) => z.IdZone === idZone)?.Libelle : 'non couvert'}.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
        {param.Zones.map((z) => <span key={z.IdZone} className="badge badge-blue">{z.Libelle} : {z.Pays}</span>)}
        {nonCouverts > 0 && <span className="badge badge-amber">Non couverts : {nonCouverts}</span>}
      </div>
      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
          <input className="form-control" style={{ paddingLeft: '2rem' }} placeholder="Rechercher un pays" aria-label="Rechercher un pays" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </div>
        <select className="form-control" style={{ flex: '0 1 260px' }} aria-label="Filtrer par zone" value={zoneFiltre} onChange={(e) => setZoneFiltre(e.target.value)}>
          <option value="">Toutes les zones</option>
          {param.Zones.map((z) => <option key={z.IdZone} value={String(z.IdZone)}>{z.Libelle}</option>)}
          <option value="aucune">Non couverts</option>
        </select>
      </div>
      <div className="table-wrapper" style={{ maxHeight: 520, overflowY: 'auto' }}>
        <table className="data-table">
          <thead><tr><th>Pays de destination</th><th>Zone tarifaire</th></tr></thead>
          <tbody>
            {pays.map((p) => (
              <tr key={p.IdPays}>
                <td>{p.Libelle}</td>
                <td style={{ minWidth: 260 }}>
                  <select className="form-control" aria-label={`Zone de ${p.Libelle}`} value={p.IdZone ?? ''} onChange={(e) => changer(p, e.target.value)}>
                    <option value="">Non couvert</option>
                    {param.Zones.map((z) => <option key={z.IdZone} value={z.IdZone}>{z.Libelle}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ParametrageGrillesVoyagePage;
