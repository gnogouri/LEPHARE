import React, { useEffect, useState } from 'react';
import { quoteApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import { Check, X } from 'lucide-react';

// Montants saisis en FCFA entiers : chiffres seuls pendant la saisie, séparateurs de milliers ensuite
const chiffres = (v) => String(v ?? '').replace(/[^\d]/g, '');
const enNombre = (v) => (chiffres(v) === '' ? NaN : Number(chiffres(v)));
const avecMilliers = (v) => (chiffres(v) === '' ? '' : Number(chiffres(v)).toLocaleString('fr-FR'));
const entier = (v) => String(Math.round(Number(v) || 0));

// La prime TTC suit la prime nette, l'accessoire, les taxes et, en Auto, le FGA (la CEDEAO est déjà comprise dans la
// prime nette, règle d'URANUS) ; les frais de gestion (IA et RC MINENE), que l'imposition ne change pas, s'y ajoutent
const CHAMPS_DU_TTC = ['prime_nette', 'accessoire', 'taxe', 'fga'];
const sommeTtc = (v, fraisGestion = 0) => CHAMPS_DU_TTC.reduce((total, champ) => total + (enNombre(v[champ]) || 0), fraisGestion);

const Montant = ({ nom, libelle, valeurs, enSaisie, setEnSaisie, onChange, disabled }) => (
  <div className="form-group" style={{ margin: 0 }}>
    <label className="form-label" htmlFor={`recap-${nom}`}>{libelle}</label>
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.65rem', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: '999px', padding: '0.1rem 0.45rem', pointerEvents: 'none' }}>
        FCFA
      </span>
      <input
        id={`recap-${nom}`}
        type="text"
        inputMode="numeric"
        className="form-control"
        // Montant affiché avec séparateurs et sélectionné à l'entrée : la frappe le remplace ; il
        // n'est affiché en chiffres seuls qu'une fois la saisie commencée (sinon la sélection
        // saute et le nombre tapé s'ajoute à l'ancien)
        value={enSaisie === nom ? chiffres(valeurs[nom]) : avecMilliers(valeurs[nom])}
        onFocus={(e) => e.target.select()}
        onBlur={() => setEnSaisie(null)}
        onChange={(e) => { setEnSaisie(nom); onChange(nom, e.target.value); }}
        disabled={disabled}
        placeholder="0"
        style={{ paddingLeft: '4rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}
      />
    </div>
  </div>
);

const Section = ({ children, colonnes = 2 }) => (
  <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${colonnes === 1 ? '260px' : '220px'}, 1fr))`, gap: '1rem', maxWidth: colonnes === 1 ? '360px' : undefined, width: '100%', margin: colonnes === 1 ? '0 auto' : undefined }}>
    {children}
  </div>
);

/**
 * « Imposer les primes » d'un devis de toute branche (URANUS CorrectionPrimesFlottes, étendue à toutes les branches
 * le 2026-10-28) : les montants saisis remplacent ceux du devis (POST /api/majrecapprimes/ → sp_maj_manuelle_primes,
 * qui marque le devis « prime imposée » et répartit la prime nette sur ses garanties, sp_lephare_ventiler_prime_imposee).
 * auto : FGA et CEDEAO saisis (mis à 0 par la base pour les autres produits) ; flotte : récapitulatif de la flotte.
 */
export const ImpositionPrimes = ({ quote, auto = false, flotte = false, onAnnuler, onEnregistre }) => {
  const { success, error: toastError } = useToast();
  const iddevis = Number(quote?.iddevis || quote?.raw?.iddevis);
  const [valeurs, setValeurs] = useState(null);
  const [fraisGestion, setFraisGestion] = useState(0);
  const [enSaisie, setEnSaisie] = useState(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreurChargement, setErreurChargement] = useState('');

  // Montants de départ relus en base (le registre peut être en retard sur le devis)
  useEffect(() => {
    let actif = true;
    quoteApi.getQuote(iddevis)
      .then((devis) => {
        if (!actif) return;
        const r = devis?.raw || {};
        setFraisGestion(Math.round(Number(r.accessoiregestionnaire) || 0));
        setValeurs({
          prime_annuelle: entier(r.primeannuelle),
          // Prime nette du devis hors FGA, CEDEAO incluse (stddevis.primenette comprend le FGA) ; FGA et CEDEAO
          // n'existent qu'en Auto (la base les met à 0 pour les autres produits)
          prime_nette: entier(Number(r.primenette || 0) - (auto ? Number(r.fga || 0) : 0)),
          accessoire: entier(r.accessoire),
          taxe: entier(r.taxe),
          fga: auto ? entier(r.fga) : '0',
          cedeao: auto ? entier(r.cedeao) : '0',
          prime_ttc: entier(r.primettc),
        });
      })
      .catch((err) => {
        console.error('Chargement du devis pour imposition :', err);
        if (actif) setErreurChargement('Impossible de relire les primes du devis. Veuillez réessayer.');
      });
    return () => { actif = false; };
  }, [iddevis, auto]);

  const modifier = (champ, saisie) => {
    setValeurs((prec) => {
      const suivantes = { ...prec, [champ]: chiffres(saisie) };
      if (CHAMPS_DU_TTC.includes(champ)) suivantes.prime_ttc = String(sommeTtc(suivantes, fraisGestion));
      return suivantes;
    });
  };

  const enregistrer = async (e) => {
    e.preventDefault();
    const montants = Object.fromEntries(Object.entries(valeurs).map(([champ, v]) => [champ, enNombre(v)]));
    if (Object.values(montants).some((n) => Number.isNaN(n))) {
      toastError('Renseignez tous les montants (0 si besoin).');
      return;
    }
    if (!(montants.prime_nette > 0) || !(montants.prime_ttc > 0)) {
      toastError('La prime nette et la prime TTC doivent être supérieures à 0.');
      return;
    }
    setEnregistrement(true);
    try {
      await quoteApi.updateQuotePrimes({ numero_devis: quote.numerodevis, ...montants });
      const devisAJour = await quoteApi.getQuote(iddevis);
      success(`${flotte ? 'Primes du récapitulatif imposées' : 'Primes imposées'} sur le devis ${quote.numerodevis}.`);
      onEnregistre(devisAJour);
    } catch (err) {
      const donnees = err?.response?.data || {};
      const detail = donnees.message || donnees.details || Object.values(donnees).flat().filter((m) => typeof m === 'string').join(' ; ');
      toastError(`Primes non imposées : ${detail || err.message}`);
    } finally {
      setEnregistrement(false);
    }
  };

  if (erreurChargement) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
        <p style={{ color: '#f87171', margin: 0 }}>{erreurChargement}</p>
        <button type="button" className="btn btn-secondary" onClick={onAnnuler}>Retour à la fiche</button>
      </div>
    );
  }
  if (!valeurs) {
    return (
      <div style={{ padding: '3rem 1rem', display: 'flex', justifyContent: 'center' }}>
        <LoadingSpinner size={36} />
      </div>
    );
  }

  const ttcCalcule = sommeTtc(valeurs, fraisGestion);
  const ttcSaisi = enNombre(valeurs.prime_ttc);
  const proprietes = { valeurs, enSaisie, setEnSaisie, onChange: modifier, disabled: enregistrement };
  const composantesTtc = ['prime nette', 'accessoire', 'taxes', auto && 'FGA', fraisGestion > 0 && 'frais de gestion'].filter(Boolean).join(' + ');

  return (
    <form onSubmit={enregistrer} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '640px' }}>
          {flotte ? 'Ces montants remplacent le récapitulatif du devis' : 'Ces montants remplacent ceux du devis'}, qui passe en
          « prime imposée ». La prime nette est répartie sur les garanties{flotte ? ' des véhicules' : ''} au prorata de leurs primes ;
          un nouvel enregistrement depuis le formulaire du devis recalcule les primes.
        </p>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Devis : <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{quote.numerodevis}</strong>
        </span>
      </div>

      <Section>
        <Montant nom="prime_annuelle" libelle="Prime annuelle" {...proprietes} />
        <Montant
          nom="prime_nette"
          libelle={auto ? <>Prime nette <span style={{ color: '#ef4444', fontWeight: 700, marginLeft: '0.5rem' }}>(CEDEAO incluse)</span></> : 'Prime nette'}
          {...proprietes}
        />
      </Section>

      <Section>
        <Montant nom="accessoire" libelle="Accessoire" {...proprietes} />
        <Montant nom="taxe" libelle="Taxes d'enregistrement" {...proprietes} />
        {auto && <Montant nom="fga" libelle="Fonds de Garantie Automobile (FGA)" {...proprietes} />}
        {auto && <Montant nom="cedeao" libelle="CEDEAO" {...proprietes} />}
        {fraisGestion > 0 && (
          <div className="form-group" style={{ margin: 0 }}>
            <span className="form-label">Frais de gestion</span>
            <div style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600, textAlign: 'right', color: 'var(--text-secondary)' }}>
              {fraisGestion.toLocaleString('fr-FR')} FCFA
            </div>
            <div className="champ-message aide">Non modifiés par l'imposition, compris dans la prime TTC</div>
          </div>
        )}
      </Section>

      <Section colonnes={1}>
        <Montant nom="prime_ttc" libelle="Prime TTC" {...proprietes} />
        {!Number.isNaN(ttcSaisi) && ttcSaisi !== ttcCalcule && (
          <div style={{ fontSize: '0.78rem', color: '#f59e0b' }}>
            Différente de {composantesTtc} ({ttcCalcule.toLocaleString('fr-FR')} FCFA).
          </div>
        )}
      </Section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
        <button type="button" className="btn btn-secondary" onClick={onAnnuler} disabled={enregistrement} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <X size={15} />
          Annuler
        </button>
        <button type="submit" className="btn btn-primary" disabled={enregistrement} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Check size={15} />
          {enregistrement ? 'Enregistrement en cours…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
};

export default ImpositionPrimes;
