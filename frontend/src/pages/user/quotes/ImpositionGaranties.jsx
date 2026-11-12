import React, { useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { quoteApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import { AmountInput } from '../../../components/common/AmountInput';

/* =========================================================================
   « IMPOSER LA PRIME » D'UN DEVIS DE TOUTE BRANCHE HORS AUTO
   Comme l'écran Offre de l'Auto (demande du 2026-10-28 : « une imposition comme ça dans toutes les branches, qui
   permet l'imposition des garanties également ») : la prime annuelle et la prime nette de chaque garantie se saisissent
   à la main, la taxe d'une garantie modifiée suit son taux ; l'accessoire, la taxe et la prime TTC du devis restent
   modifiables. GET / POST /api/devis/<id>/imposition-garanties/ (production/imposition_garanties.py).
   ========================================================================= */

const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/ /g, ' ');
const taux = (t) => String(t).replace('.', ',');

export const ImpositionGaranties = ({ quote, onAnnuler, onEnregistre }) => {
  const { success, error: toastError } = useToast();
  const iddevis = Number(quote?.iddevis || quote?.raw?.iddevis);
  const [donnees, setDonnees] = useState(null);
  const [erreurChargement, setErreurChargement] = useState('');
  // Saisies par garantie { [Id]: { pa, pn } } ; null = montant enregistré
  const [saisies, setSaisies] = useState({});
  const [accessoire, setAccessoire] = useState(0);
  const [taxeImposee, setTaxeImposee] = useState(null);
  const [ttcImposee, setTtcImposee] = useState(null);
  const [enregistrement, setEnregistrement] = useState(false);

  const initialiser = (d) => {
    setDonnees(d);
    setSaisies({});
    setAccessoire(Math.round(Number(d.Devis.Accessoire) || 0));
    setTaxeImposee(null);
    setTtcImposee(null);
  };

  useEffect(() => {
    let actif = true;
    quoteApi.getImpositionGaranties(iddevis)
      .then((d) => { if (actif) initialiser(d); })
      .catch((err) => {
        if (actif) setErreurChargement(err?.response?.data?.message || 'Impossible de relire les garanties du devis. Veuillez réessayer.');
      });
    return () => { actif = false; };
  }, [iddevis]);

  // Montants de chaque garantie tels qu'ils seront enregistrés
  const garanties = useMemo(() => (donnees?.Lignes || []).flatMap((l) => l.Garanties.map((g) => {
    const s = saisies[g.Id] || {};
    const pn = s.pn ?? g.PrimeNette;
    const pa = s.pa ?? (s.pn != null ? (g.PrimeNette ? Math.round((s.pn * g.PrimeAnnuelle) / g.PrimeNette) : s.pn) : g.PrimeAnnuelle);
    const taxe = s.pn == null ? g.Taxe
      : g.TauxTaxe != null ? Math.round((pn * g.TauxTaxe) / 100) : (g.PrimeNette ? Math.round((pn * g.Taxe) / g.PrimeNette) : 0);
    return { ...g, ligne: l.IdDevisDetail, pa, pn, taxe, modifiee: s.pn != null || s.pa != null };
  })), [donnees, saisies]);

  if (erreurChargement) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
        <p style={{ color: '#f87171', margin: 0 }}>{erreurChargement}</p>
        <button type="button" className="btn btn-secondary" onClick={onAnnuler}>Retour à la fiche</button>
      </div>
    );
  }
  if (!donnees) {
    return <div style={{ padding: '3rem 1rem', display: 'flex', justifyContent: 'center' }}><LoadingSpinner size={36} /></div>;
  }

  const d = donnees.Devis;
  const primeNette = garanties.reduce((s, g) => s + g.pn, 0);
  const ecartTaxes = garanties.filter((g) => g.modifiee).reduce((s, g) => s + g.taxe - g.Taxe, 0);
  // Taxe calculée : celle du devis, corrigée de l'écart des garanties modifiées et de la taxe de l'écart d'accessoire
  const taxeCalculee = Math.round(d.Taxe + ecartTaxes + ((accessoire - d.Accessoire) * (donnees.TauxTaxeProduit || 0)) / 100);
  const taxe = taxeImposee ?? taxeCalculee;
  const ttcCalculee = Math.round(primeNette + accessoire + taxe + d.FraisGestion);
  const ttc = ttcImposee ?? ttcCalculee;
  const modifie = garanties.some((g) => g.modifiee) || accessoire !== Math.round(d.Accessoire) || taxeImposee != null || ttcImposee != null;
  const plusieursLignes = donnees.Lignes.length > 1;

  const saisir = (id, champ, valeur) => setSaisies((prec) => ({ ...prec, [id]: { ...prec[id], [champ]: Number(valeur) || 0 } }));

  const enregistrer = async () => {
    if (!(primeNette > 0) || !(ttc > 0)) {
      toastError('La prime nette et la prime TTC doivent être supérieures à 0.');
      return;
    }
    setEnregistrement(true);
    try {
      await quoteApi.imposerGaranties(iddevis, {
        Garanties: garanties.filter((g) => g.modifiee).map((g) => ({
          Id: g.Id, PrimeNette: g.pn, ...(saisies[g.Id]?.pa != null ? { PrimeAnnuelle: saisies[g.Id].pa } : {}),
        })),
        Accessoire: accessoire,
        Taxe: taxe,
        PrimeTtc: ttc,
      });
      const devisAJour = await quoteApi.getQuote(iddevis);
      success(`Primes imposées sur le devis ${d.NumeroDevis}.`);
      onEnregistre(devisAJour);
    } catch (err) {
      toastError(`Primes non imposées : ${err?.response?.data?.message || err.message}`);
    } finally {
      setEnregistrement(false);
    }
  };

  const th = { padding: '0.6rem 0.75rem', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border-medium)', whiteSpace: 'nowrap' };
  const td = { padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.84rem', color: 'var(--text-primary)', verticalAlign: 'middle' };
  const num = { textAlign: 'right', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' };
  const tuile = (libelle, contenu, aide, fort) => (
    <div className="glass-panel" style={{ padding: '0.85rem 1rem', ...(fort ? { border: '1px solid var(--primary-500)' } : {}) }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: fort ? 'var(--primary-500)' : 'var(--text-muted)', marginBottom: '0.4rem' }}>{libelle}</div>
      {contenu}
      {aide && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>{aide}</div>}
    </div>
  );
  const lien = { background: 'none', border: 'none', padding: 0, color: 'var(--primary-500)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        Saisissez la prime de chaque garantie : celles que vous ne modifiez pas gardent leur prime, la taxe d'une garantie modifiée
        suit son taux. Le devis passe en « prime imposée » ; un nouvel enregistrement depuis son formulaire recalcule les primes.
      </p>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Garantie</th>
              <th style={{ ...th, textAlign: 'right' }}>Capital</th>
              <th style={{ ...th, textAlign: 'right', width: 170 }}>Prime annuelle</th>
              <th style={{ ...th, textAlign: 'right', width: 170 }}>Prime nette</th>
              <th style={{ ...th, textAlign: 'right' }}>Taxe</th>
            </tr>
          </thead>
          <tbody>
            {donnees.Lignes.map((l, i) => (
              <React.Fragment key={l.IdDevisDetail}>
                {plusieursLignes && (
                  <tr><td colSpan={5} style={{ ...td, fontWeight: 800, background: 'var(--bg-surface-elevated)' }}>Ligne {i + 1}{l.Libelle ? ` : ${l.Libelle}` : ''}</td></tr>
                )}
                {garanties.filter((g) => g.ligne === l.IdDevisDetail).map((g) => (
                  <tr key={g.Id} style={g.modifiee ? { background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)' } : undefined}>
                    <td style={{ ...td, fontWeight: 600 }}>{g.Libelle}{g.modifiee && <span style={{ color: 'var(--accent-amber)', fontWeight: 700, fontSize: '0.72rem' }}> · imposée</span>}</td>
                    <td style={{ ...td, ...num, color: 'var(--text-muted)' }}>{g.Capital ? `${fcfa(g.Capital)} F` : '-'}</td>
                    <td style={td}><AmountInput value={Math.round(g.pa)} onChange={(v) => saisir(g.Id, 'pa', v)} suffix="" disabled={enregistrement} /></td>
                    <td style={td}><AmountInput value={Math.round(g.pn)} onChange={(v) => saisir(g.Id, 'pn', v)} suffix="" disabled={enregistrement} /></td>
                    <td style={{ ...td, ...num }}>
                      {fcfa(g.taxe)} F{g.TauxTaxe != null && <span style={{ color: 'var(--text-muted)' }}> ({taux(g.TauxTaxe)} %)</span>}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '0.75rem' }}>
        {tuile('Prime nette', <div style={{ fontSize: '1.15rem', fontWeight: 900, fontFamily: 'var(--font-mono)' }}>{fcfa(primeNette)} F</div>, 'Somme des garanties')}
        {tuile('Accessoire', <AmountInput value={accessoire} onChange={(v) => setAccessoire(Number(v) || 0)} disabled={enregistrement} />)}
        {tuile('Taxe', <AmountInput value={taxe} onChange={(v) => setTaxeImposee(Number(v) || 0)} disabled={enregistrement} />,
          taxeImposee != null && taxeImposee !== taxeCalculee
            ? <>Montant imposé · <button type="button" style={lien} onClick={() => setTaxeImposee(null)}>recalculer ({fcfa(taxeCalculee)} F)</button></>
            : 'Taxes des garanties et de l\'accessoire')}
        {d.FraisGestion > 0 && tuile('Frais de gestion', <div style={{ fontSize: '1.15rem', fontWeight: 900, fontFamily: 'var(--font-mono)' }}>{fcfa(d.FraisGestion)} F</div>, 'Compris dans la prime TTC')}
        {tuile('Prime TTC', <AmountInput value={ttc} onChange={(v) => setTtcImposee(Number(v) || 0)} disabled={enregistrement} />,
          ttcImposee != null && ttcImposee !== ttcCalculee
            ? <>Montant imposé · <button type="button" style={lien} onClick={() => setTtcImposee(null)}>recalculer ({fcfa(ttcCalculee)} F)</button></>
            : `Prime nette + accessoire + taxe${d.FraisGestion > 0 ? ' + frais de gestion' : ''}`, true)}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
        <button type="button" className="btn btn-secondary" onClick={() => initialiser(donnees)} disabled={enregistrement || !modifie}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <RotateCcw size={15} /> Rétablir les primes enregistrées
        </button>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onAnnuler} disabled={enregistrement} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <X size={15} /> Annuler
          </button>
          <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={enregistrement || !modifie} aria-busy={enregistrement}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Check size={15} /> {enregistrement ? 'Enregistrement en cours…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImpositionGaranties;
