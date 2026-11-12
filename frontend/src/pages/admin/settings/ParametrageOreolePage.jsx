import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Coins, HeartPulse, Loader2, Percent, Save, Stethoscope, Wallet } from 'lucide-react';
import { EnTeteParametrage, SectionParametrage } from '../../../components/admin/EnTeteParametrage';
import { LigneParametre } from '../../../components/admin/LigneParametre';
import { AmountInput } from '../../../components/common/AmountInput';
import { parametrageApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { useToast } from '../../../context/ToastContext';

/* =========================================================================
   Réglages Oreole Santé (configuration_api/parametrage_oreole.py) : prix, décomposition et barème de chaque offre,
   honoraires, compagnies des trois polices, carte d'assurance, surprimes, carences. Tout est modifiable sans toucher au code.
   ========================================================================= */
const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
const ONGLETS = [
  { id: 'offres', libelle: 'Offres et décomposition', icone: Coins },
  { id: 'bareme', libelle: 'Barème de soins', icone: Stethoscope },
  { id: 'liens', libelle: 'Honoraires et compagnies', icone: Wallet },
  { id: 'surprimes', libelle: 'Surprimes et carences', icone: Percent },
];
const COLONNES_OFFRES = [
  ['Cotisation', 'Cotisation'], ['PrimeHt', 'Prime HT'], ['Accessoires', 'Accessoires'], ['PartIA', 'Part IA'], ['PartAFA', 'Part AFA'], ['EnfantSupplementaire', 'Enfant en plus'],
];
const COLONNES_BAREME = [
  ['SoinsExternes', 'Soins %'], ['Hospitalisation', 'Hospit. %'], ['Chambre', 'Chambre'], ['Ambulance', 'Ambulance'], ['AccouchementSimple', 'Acc. simple'], ['AccouchementGemellaire', 'Gémellaire'],
  ['AccouchementChirurgical', 'Chirurgical'], ['AccouchementHorsStructure', 'Hors structure'], ['OptiqueAdulte', 'Optique adulte'], ['OptiqueEnfant', 'Optique enfant'], ['Dentaire', 'Dentaire'], ['Plafond', 'Plafond'],
  ['CapitalIA', 'Capital IA'], ['CapitalAFA', 'Capital AFA'],
];
const CLES_LIENS = ['oreole.honoraire_cabinet', 'oreole.honoraire_gestionnaire', 'oreole.gestionnaire', 'oreole.compagnie_sante', 'oreole.compagnie_ia', 'oreole.compagnie_afa', 'oreole.carte_montant'];

const LigneOffre = ({ offre, colonnes, onEnregistre }) => {
  const { success, error: toastError } = useToast();
  const [valeurs, setValeurs] = useState(offre);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => { setValeurs(offre); }, [offre]);
  const modifie = useMemo(() => colonnes.some(([c]) => Number(valeurs[c]) !== Number(offre[c])) || valeurs.Actif !== offre.Actif || valeurs.Libelle !== offre.Libelle, [valeurs, offre, colonnes]);
  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const champs = Object.fromEntries(colonnes.map(([c]) => [c, valeurs[c]]));
      const r = await parametrageApi.modifierOffreOreole(offre.IdOffre, { ...champs, Libelle: valeurs.Libelle, Actif: valeurs.Actif });
      onEnregistre(r);
      success(`Offre « ${r.Libelle} » enregistrée.`);
    } catch (err) {
      toastError(`Offre non enregistrée : ${messageErreurApi(err)}`);
    } finally {
      setEnvoi(false);
    }
  };
  const frais = Number(valeurs.Cotisation) - Number(valeurs.PartIA) - Number(valeurs.PartAFA) - Number(valeurs.PrimeHt) - Number(valeurs.Accessoires);
  return (
    <tr>
      <td style={{ minWidth: 170 }}><input className="form-control" style={{ padding: '0.25rem 0.4rem', fontSize: '0.8rem' }} aria-label="Libellé de l'offre" value={valeurs.Libelle} onChange={(e) => setValeurs((v) => ({ ...v, Libelle: e.target.value }))} /></td>
      {colonnes.map(([c, libelle]) => (
        <td key={c} style={{ minWidth: 104 }}><input type="number" min="0" className="form-control" style={{ padding: '0.25rem 0.4rem', fontSize: '0.8rem', textAlign: 'right' }} aria-label={`${libelle} : ${offre.Libelle}`} value={valeurs[c]} onChange={(e) => setValeurs((v) => ({ ...v, [c]: e.target.value }))} /></td>
      ))}
      {colonnes === COLONNES_OFFRES && <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', color: frais < 0 ? 'var(--accent-rose)' : undefined }}>{fcfa(frais)}</td>}
      <td style={{ textAlign: 'center' }}><input type="checkbox" aria-label={`Offre active : ${offre.Libelle}`} checked={valeurs.Actif} onChange={(e) => setValeurs((v) => ({ ...v, Actif: e.target.checked }))} /></td>
      <td><button type="button" className="btn btn-primary" disabled={!modifie || envoi} style={{ padding: '0.2rem 0.5rem' }} aria-label={`Enregistrer ${offre.Libelle}`} onClick={enregistrer}>{envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />}</button></td>
    </tr>
  );
};

export default function ParametrageOreolePage() {
  const { error: toastError } = useToast();
  const [params, setParams] = useSearchParams();
  const onglet = params.get('onglet') || 'offres';
  const [donnees, setDonnees] = useState(null);

  useEffect(() => {
    parametrageApi.getOreole().then(setDonnees).catch((err) => toastError(`Réglages indisponibles : ${messageErreurApi(err)}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const remplacerOffre = (nouvelle) => setDonnees((d) => ({ ...d, Offres: d.Offres.map((o) => (o.IdOffre === nouvelle.IdOffre ? nouvelle : o)) }));
  const remplacerParametre = (nouveau) => setDonnees((d) => ({ ...d, Parametres: d.Parametres.map((p) => (p.Cle === nouveau.Cle ? nouveau : p)) }));
  const parametres = (filtre) => (donnees?.Parametres || []).filter(filtre);
  const ligneParametre = (p) => (
    <LigneParametre key={p.Cle} parametre={p} modifier={parametrageApi.modifierParametreOreole} retablir={parametrageApi.retablirParametreOreole} onEnregistre={remplacerParametre} />
  );

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      <EnTeteParametrage icone={HeartPulse} titre="Réglages Oreole Santé" description="Prix, décomposition et barème de chaque offre, honoraires, compagnies des trois polices, carte d'assurance, surprimes et carences." />
      <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        {ONGLETS.map(({ id, libelle, icone: Icone }) => (
          <button key={id} type="button" role="tab" aria-selected={onglet === id} className={`btn ${onglet === id ? 'btn-primary' : 'btn-secondary'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem' }} onClick={() => setParams({ onglet: id })}>
            <Icone size={14} /> {libelle}
          </button>
        ))}
      </div>
      {!donnees && <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}><Loader2 size={24} className="spin" /></div>}
      {donnees && (onglet === 'offres' || onglet === 'bareme') && (
        <SectionParametrage titre={onglet === 'offres' ? 'Offres' : 'Barème de soins par offre'} description={onglet === 'offres' ? 'Le chargement pour sinistres à payer est ce qui reste de la cotisation après la prime HT, les accessoires et les parts IA et AFA.' : 'Montants en F CFA, imprimés sur les conditions particulières et le barème.'}>
          <div className="tableau-defilant" style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
            <table className="data-table" style={{ fontSize: '0.8rem', minWidth: onglet === 'offres' ? 980 : 1700 }}>
              <thead><tr><th>Offre</th>{(onglet === 'offres' ? COLONNES_OFFRES : COLONNES_BAREME).map(([c, l]) => <th key={c}>{l}</th>)}{onglet === 'offres' && <th style={{ textAlign: 'right' }}>Chargement pour sinistres à payer</th>}<th>Active</th><th aria-label="Enregistrer" /></tr></thead>
              <tbody>{donnees.Offres.map((o) => <LigneOffre key={o.IdOffre} offre={o} colonnes={onglet === 'offres' ? COLONNES_OFFRES : COLONNES_BAREME} onEnregistre={remplacerOffre} />)}</tbody>
            </table>
          </div>
        </SectionParametrage>
      )}
      {donnees && onglet === 'liens' && (
        <SectionParametrage titre="Honoraires, compagnies, carte" description={`Compagnies rattachées au cabinet : ${donnees.Compagnies.map((c) => `${c.IdCompagnie} ${c.Libelle}`).join(', ')}.`}>
          {parametres((p) => CLES_LIENS.includes(p.Cle)).map(ligneParametre)}
        </SectionParametrage>
      )}
      {donnees && onglet === 'surprimes' && (
        <>
          <SectionParametrage titre="Surprimes et âges" description="L'affection se calcule sur la cotisation totale, l'âge sur la part Santé. L'IA et l'AFA ne changent pas. Le supplément va au chargement pour sinistres à payer.">
            {parametres((p) => /surprime|affections|age_max/.test(p.Cle)).map(ligneParametre)}
          </SectionParametrage>
          <SectionParametrage titre="Carences et alertes" description="Imprimées sur les conditions particulières et le barème.">
            {parametres((p) => /carence|alerte/.test(p.Cle)).map(ligneParametre)}
          </SectionParametrage>
        </>
      )}
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Les taux de commission de l'IA et de l'AFA se règlent dans <Link to="/admin/settings/commissions">Taux de commission</Link>.</p>
    </div>
  );
}
