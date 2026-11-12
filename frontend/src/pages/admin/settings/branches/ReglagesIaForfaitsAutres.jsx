import React, { useEffect, useMemo, useState } from 'react';
import { Layers, Loader2, RotateCcw, Save, Scale } from 'lucide-react';
import { SectionParametrage } from '../../../../components/admin/EnTeteParametrage';
import { LigneParametre } from '../../../../components/admin/LigneParametre';
import { AmountInput } from '../../../../components/common/AmountInput';
import { parametrageApi } from '../../../../api/endpoints';
import { useToast } from '../../../../context/ToastContext';
import { messageErreurApi } from '../../../../utils/financeUtils';

// Individuelle Accidents : réglages écrits jusqu'ici dans le calcul (production 0177, configuration_api 0105) :
// primes et capitaux des offres forfaitaires CGA / CI-ÉNERGIES (ia.forfait.<offre>.*, fn_garantie_offre_ia) et barème
// des compagnies autres que NSIA (ia.autres.*, fn_calcul_prime_ia_by_age, fn_web_calcul_taux_classe).

const francs = (v) => `${Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`;

/** Tableau de réglages saisis case par case, enregistrés ensemble. lignes : [{ cle, titre, sousTitre, cellules: [clé|null] }]. */
const TableauReglages = ({ colonnes, lignes, parametres, onEnregistre, libelle }) => {
  const { success, error: toastError } = useToast();
  const parCle = useMemo(() => Object.fromEntries(parametres.map((p) => [p.Cle, p])), [parametres]);
  const cles = lignes.flatMap((l) => l.cellules).filter((c) => c && parCle[c]);
  const [saisie, setSaisie] = useState({});
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => setSaisie(Object.fromEntries(parametres.map((p) => [p.Cle, p.Valeur]))), [parametres]);
  const modifies = cles.filter((c) => String(saisie[c] ?? '') !== String(parCle[c].Valeur ?? ''));
  const differents = cles.filter((c) => String(parCle[c].Valeur ?? '') !== String(parCle[c].ValeurOrigine ?? ''));

  const envoyer = async (retour) => {
    setEnvoi(true);
    try {
      const liste = retour ? differents : modifies;
      for (const cle of liste) {
        // eslint-disable-next-line no-await-in-loop
        onEnregistre(retour ? await parametrageApi.retablirReglageIa(cle) : await parametrageApi.modifierReglageIa(cle, saisie[cle]));
      }
      success(retour ? `${libelle} : valeurs d'origine rétablies.` : `${libelle} : ${liste.length} valeur${liste.length > 1 ? 's' : ''} enregistrée${liste.length > 1 ? 's' : ''}.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  const cellule = (cle) => {
    const p = cle && parCle[cle];
    if (!p) return <span className="rb-discret">-</span>;
    const v = saisie[cle];
    return (
      <div>
        {p.Type === 'montant' ? (
          <AmountInput value={v === '' || !Number.isFinite(Number(v)) ? '' : Math.round(Number(v))} onChange={(n) => setSaisie((s) => ({ ...s, [cle]: String(n) }))} suffix="F" />
        ) : (
          <input type="number" step="any" min={0} className="form-control" value={v ?? ''} onChange={(e) => setSaisie((s) => ({ ...s, [cle]: e.target.value }))} />
        )}
        {String(p.Valeur) !== String(p.ValeurOrigine) && (
          <div className="rb-discret" style={{ fontSize: '0.7rem' }}>Origine : {p.Type === 'montant' ? francs(p.ValeurOrigine) : p.ValeurOrigine}</div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="table-wrapper" style={{ overflowX: 'auto' }}>
        <table className="rb-table">
          <thead><tr>{colonnes.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.cle}>
                <td style={{ fontWeight: 700, minWidth: 180 }}>{l.titre}{l.sousTitre && <div className="rb-discret">{l.sousTitre}</div>}</td>
                {l.cellules.map((c, i) => <td key={c || i} style={{ minWidth: 130 }}>{cellule(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rb-actions">
        {differents.length > 0 && (
          <button type="button" className="btn btn-secondary" disabled={envoi} onClick={() => envoyer(true)}><RotateCcw size={14} /> Rétablir les valeurs d'origine</button>
        )}
        <button type="button" className="btn btn-primary" disabled={!modifies.length || envoi} onClick={() => envoyer(false)} aria-busy={envoi}>
          {envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer{modifies.length ? ` (${modifies.length})` : ''}
        </button>
      </div>
    </>
  );
};

const CHAMPS_FORFAIT = [
  ['prime_deces', 'Prime décès'], ['prime_ip', 'Prime invalidité'], ['prime_frais_traitement', 'Prime frais de traitement'],
  ['capital_deces', 'Capital décès'], ['capital_infirmite', 'Capital invalidité'], ['capital_frais_traitement', 'Capital frais de traitement'],
];
const CLASSES = ['01', '02', '03', '04'];
const AGE = ['age_minimum', 'age_majoration_1', 'coefficient_age_1', 'age_majoration_2', 'coefficient_age_2', 'age_maximum', 'taux_minimum_age_2', 'taux_plafond_invalidite_age_2'];

export const ReglagesIaForfaitsAutres = ({ reglages }) => {
  const [parametres, setParametres] = useState(reglages?.Parametres || []);
  useEffect(() => setParametres(reglages?.Parametres || []), [reglages]);
  if (!reglages) return null;
  const remplacer = (maj) => setParametres((l) => l.map((p) => (p.Cle === maj.Cle ? maj : p)));
  const parCle = Object.fromEntries(parametres.map((p) => [p.Cle, p]));
  const A = 'ia.autres.';
  const plafond = (n) => Number(parCle[`${A}ft_plafond_${n}`]?.Valeur) || 0;

  return (
    <>
      <SectionParametrage icone={Layers} titre="Primes et capitaux des offres forfaitaires"
        description="Offres CGA et CI-ÉNERGIES : primes et capitaux fixés par l'offre, appliqués quels que soient la profession et l'âge (l'accessoire de ces offres se règle plus haut). Une offre à 0 F se tarife en primes imposées.">
        <TableauReglages libelle="Offres forfaitaires" parametres={parametres} onEnregistre={remplacer}
          colonnes={['Offre', ...CHAMPS_FORFAIT.map(([, t]) => t)]}
          lignes={reglages.Offres.map((o) => ({
            cle: o.IdOffre, titre: o.Libelle, sousTitre: `Offre n° ${o.IdOffre}`,
            cellules: CHAMPS_FORFAIT.map(([c]) => `ia.forfait.${o.IdOffre}.${c}`),
          }))} />
      </SectionParametrage>

      <SectionParametrage icone={Scale} titre="Barème des autres compagnies (AMSA, SUNU…)"
        description="Calcul des compagnies sans tarif propre : décès et invalidité = capital × taux de la classe (‰), majorés selon l'âge à la souscription ; frais de traitement selon la classe et la tranche du capital. La classe vient de la profession de l'assuré.">
        <TableauReglages libelle="Taux par classe" parametres={parametres} onEnregistre={remplacer}
          colonnes={['Classe', 'Taux décès et invalidité (‰)']}
          lignes={['01', '02', '03', '04', '05'].map((c) => ({ cle: c, titre: `Classe ${c}`, cellules: [`${A}taux_classe_${c}`] }))} />
        <div style={{ marginTop: '1rem' }}>
          {AGE.map((c) => parCle[A + c]).filter(Boolean).map((p) => (
            <LigneParametre key={p.Cle} parametre={p} onEnregistre={remplacer} modifier={parametrageApi.modifierReglageIa} retablir={parametrageApi.retablirReglageIa} />
          ))}
        </div>
        <div style={{ fontWeight: 700, fontSize: '0.9rem', margin: '1rem 0 0.4rem' }}>Frais de traitement par tranche de capital</div>
        <div className="rb-discret" style={{ marginBottom: '0.5rem' }}>
          Prime forfaitaire selon le capital frais de traitement, multipliée par le coefficient de la première majoration d'âge s'il y a lieu ; la classe 05 n'a pas de frais de traitement.
        </div>
        <TableauReglages libelle="Frais de traitement" parametres={parametres} onEnregistre={remplacer}
          colonnes={['Tranche', 'Capital jusqu\'à', ...CLASSES.map((c) => `Classe ${c}`)]}
          lignes={[1, 2, 3, 4, 5].map((n) => ({
            cle: n, titre: `Tranche ${n}`, sousTitre: `au-delà de ${francs(n === 1 ? 0 : plafond(n - 1))}`,
            cellules: [`${A}ft_plafond_${n}`, ...CLASSES.map((c) => `${A}ft_${c}_${n}`)],
          }))} />
      </SectionParametrage>
    </>
  );
};

export default ReglagesIaForfaitsAutres;
