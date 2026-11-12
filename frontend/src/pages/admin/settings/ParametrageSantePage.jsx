import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  HeartPulse, Stethoscope, ShieldCheck, Percent, CalendarClock, PieChart, Save, Loader2, Edit2, X, Info,
} from 'lucide-react';
import { EnTeteParametrage, SectionParametrage } from '../../../components/admin/EnTeteParametrage';
import { LigneParametre } from '../../../components/admin/LigneParametre';
import { AmountInput } from '../../../components/common/AmountInput';
import { parametrageApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { chargerParametrage } from '../../../utils/parametrage';
import { useToast } from '../../../context/ToastContext';

// Réglages MINENE SANTÉ (Santé + Individuelle Accidents + RC chef de famille) : formules et barème de
// soins, IA et RC, surprimes et âges, textes des conditions particulières, répartition de la prime.
// configuration_api/parametrage_sante.py ; lus par la base (tarif) et par les imprimés (impressionsSante.js).

const ONGLETS = [
  { id: 'formules', libelle: 'Formules & barème de soins', icone: Stethoscope },
  { id: 'ia-rc', libelle: 'IA & RC chef de famille', icone: ShieldCheck },
  { id: 'surprimes', libelle: 'Surprimes & âges', icone: Percent },
  { id: 'conditions', libelle: 'Carence & conditions', icone: CalendarClock },
  { id: 'repartition', libelle: 'Répartition de la prime', icone: PieChart },
];

const GROUPES = {
  'ia-rc': [
    { id: 'minene_ia', titre: 'Individuelle Accidents MINENE', description: "Capitaux imprimés sur le barème et les CP, et prime nette d'un adhérent (devis IA MINENE, offre 66)." },
    { id: 'minene_rc', titre: 'RC chef de famille MINENE', description: "Capitaux et franchise imprimés sur le barème et la CP RC MINENE, prime nette d'un adhérent (devis RC MINENE, offre 67)." },
  ],
  surprimes: [
    { id: 'minene_surprimes', titre: 'Surprimes et âges', description: "Surprimes calculées sur la prime de base de la formule de chaque famille, à l'âge atteint à la date d'effet ; âges contrôlés à la saisie des assurés." },
  ],
  conditions: [
    { id: 'minene_carence', titre: 'Délais de carence', description: 'Imprimés sur les conditions particulières et le barème.' },
    { id: 'minene_gestion', titre: 'Remboursements et clause d’ajustement', description: 'Imprimés sur le barème et les conditions particulières ; la clause propose aussi les taux de réduction et de majoration à la saisie du devis Santé.' },
  ],
};

// Champs d'une formule, par rubrique (montants en FCFA)
const RUBRIQUES_FORMULE = [
  { titre: 'Famille et tarif', champs: [
    { champ: 'Option', libelle: 'Option imprimée', type: 'texte' },
    { champ: 'Composition', libelle: 'Composition de la famille', type: 'texte', large: true },
    { champ: 'PersonnesMin', libelle: 'Personnes au moins', type: 'entier', aide: 'Indicatif (imprimé sur le barème).' },
    { champ: 'PersonnesMax', libelle: 'Personnes au plus', type: 'entier', aide: 'Contrôlé à la saisie et au calcul du devis.' },
    { champ: 'PrimeBase', libelle: 'Prime nette annuelle de la famille', type: 'montant', aide: 'Base des surprimes ; accessoire et taxe en sus.' },
  ] },
  { titre: 'Taux de couverture', champs: [
    { champ: 'TauxSoinsExternes', libelle: 'Soins externes', type: 'pourcentage' },
    { champ: 'TauxHospitalisation', libelle: 'Frais d’hospitalisation', type: 'pourcentage' },
  ] },
  { titre: 'Plafonds de remboursement', champs: [
    { champ: 'ChambreParJour', libelle: 'Chambre d’hospitalisation (par jour)', type: 'montant' },
    { champ: 'AmbulanceParCas', libelle: 'Ambulance / SAMU (par cas)', type: 'montant' },
    { champ: 'AccouchementSimple', libelle: 'Accouchement simple normal', type: 'montant' },
    { champ: 'AccouchementGemellaire', libelle: 'Accouchement gémellaire normal', type: 'montant' },
    { champ: 'AccouchementChirurgical', libelle: 'Accouchement par voie chirurgicale', type: 'montant' },
    { champ: 'AccouchementHorsStructure', libelle: 'Forfait accouchement hors structure privée', type: 'montant' },
    { champ: 'OptiqueAdulte', libelle: 'Optique adulte', type: 'montant' },
    { champ: 'OptiqueEnfant', libelle: 'Optique enfant', type: 'montant' },
    { champ: 'DentaireParPersonne', libelle: 'Soins et prothèses dentaires (par an et par personne)', type: 'montant' },
    { champ: 'PlafondAnnuel', libelle: 'Plafond annuel par famille', type: 'montant' },
  ] },
];
const CHAMPS_FORMULE = RUBRIQUES_FORMULE.flatMap((r) => r.champs.map((c) => c.champ));

const CHAMPS_REPARTITION = [
  { champ: 'taux_frais_generaux_compagnie', libelle: 'Frais généraux NSIA', type: 'taux' },
  { champ: 'taux_commission_courtier', libelle: 'Commission OREOLE ASSURANCES', type: 'taux', aide: 'Taux de commission du cabinet sur les devis et contrats Santé MINENE.' },
  { champ: 'taux_honoraire_gestionnaire', libelle: 'Honoraires de gestion VITALIS', type: 'taux' },
  { champ: 'taux_frais_gestion_adec', libelle: 'Frais de gestion ADEC', type: 'taux', variante: false },
  { champ: 'taux_autres_frais_gestion', libelle: 'Autres frais de gestion', type: 'taux', variante: false },
  { champ: 'taux_commission_commerciaux', libelle: 'Commission des commerciaux NSIA', type: 'taux', variante: true },
  { champ: 'frais_gestion_adec_forfait_ia', libelle: 'Frais de gestion ADEC - IA, par adhérent', type: 'forfait', aide: 'Ajoutés à la prime TTC de chaque adhérent du devis IA MINENE.' },
  { champ: 'frais_gestion_adec_forfait_rc', libelle: 'Frais de gestion ADEC - RC chef de famille, par adhérent', type: 'forfait', aide: 'Ajoutés à la prime TTC de chaque adhérent du devis RC MINENE.' },
];

const montant = (v) => (v === null || v === undefined || v === '' ? '-' : `${Math.round(Number(v)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`);
const memes = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cellule = { padding: '0.55rem 0.5rem', verticalAlign: 'top', fontSize: '0.84rem' };
const entete = { padding: '0.6rem 0.5rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', textAlign: 'left', whiteSpace: 'nowrap' };

/** Saisie d'un champ numérique ou texte d'une formule. */
const Champ = ({ def, valeur, onChange }) => {
  if (def.type === 'montant') return <AmountInput value={valeur === '' || valeur === null ? '' : Math.round(Number(valeur))} onChange={onChange} suffix="FCFA" />;
  if (def.type === 'texte') return <input type="text" className="form-control" value={valeur ?? ''} maxLength={def.champ === 'Option' ? 40 : 200} onChange={(e) => onChange(e.target.value)} />;
  return (
    <div style={{ position: 'relative' }}>
      <input type="number" className="form-control" min={0} max={def.type === 'pourcentage' ? 100 : 20} step={def.type === 'entier' ? 1 : 'any'}
        value={valeur ?? ''} onChange={(e) => onChange(e.target.value)} style={{ paddingRight: def.type === 'pourcentage' ? '1.8rem' : undefined }} />
      {def.type === 'pourcentage' && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>%</span>}
    </div>
  );
};

/** Fiche d'une formule en modification (sous sa ligne du tableau). */
const FicheFormule = ({ formule, onFermer, onEnregistre }) => {
  const { success, error: toastError } = useToast();
  const initiale = useMemo(() => Object.fromEntries(CHAMPS_FORMULE.map((c) => [c, formule[c]])), [formule]);
  const [saisie, setSaisie] = useState(initiale);
  const [envoi, setEnvoi] = useState(false);
  const modifiee = !memes(saisie, initiale);

  const enregistrer = async () => {
    const changes = Object.fromEntries(CHAMPS_FORMULE.filter((c) => String(saisie[c] ?? '') !== String(initiale[c] ?? '')).map((c) => [c, saisie[c]]));
    setEnvoi(true);
    try {
      onEnregistre(await parametrageApi.modifierFormuleSante(formule.IdOffre, changes));
      success(`${formule.LibelleOffre || `Formule ${formule.IdOffre}`} : enregistrée.`);
      onFermer();
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div style={{ padding: '1rem 1.1rem', margin: '0.25rem 0 0.75rem', borderRadius: 10, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary, rgba(148,163,184,0.06))' }}>
      {RUBRIQUES_FORMULE.map((r) => (
        <div key={r.titre} style={{ marginBottom: '0.9rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>{r.titre}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '0.6rem 1rem' }}>
            {r.champs.map((def) => (
              <div key={def.champ} className="form-group" style={{ marginBottom: 0, gridColumn: def.large ? 'span 2' : undefined }}>
                <label className="form-label" style={{ fontSize: '0.76rem' }}>{def.libelle}</label>
                <Champ def={def} valeur={saisie[def.champ]} onChange={(v) => setSaisie((s) => ({ ...s, [def.champ]: v }))} />
                {def.aide && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{def.aide}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
        <button type="button" className="btn btn-secondary" onClick={onFermer} disabled={envoi} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><X size={14} /> Fermer</button>
        <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={!modifiee || envoi} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer
        </button>
      </div>
    </div>
  );
};

/** Variante de la répartition de la prime (sans / avec apporteur d'affaires). */
const CarteRepartition = ({ repartition, onEnregistre }) => {
  const { success, error: toastError } = useToast();
  const champs = CHAMPS_REPARTITION.filter((c) => c.variante === undefined || c.variante === repartition.AvecApporteur);
  const initiale = useMemo(() => Object.fromEntries(champs.map((c) => [c.champ, repartition[c.champ] ?? ''])), [repartition]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saisie, setSaisie] = useState(initiale);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => setSaisie(initiale), [initiale]);
  const parts = champs.filter((c) => c.type === 'taux').reduce((t, c) => t + (Number(saisie[c.champ]) || 0), 0);
  const provision = Math.round((100 - parts) * 100) / 100;

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      onEnregistre(await parametrageApi.modifierRepartitionSante(repartition.Id, saisie));
      success(`${repartition.Libelle} : enregistrée.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <SectionParametrage icone={PieChart} titre={repartition.AvecApporteur ? "Avec apporteur d'affaires" : "Sans apporteur d'affaires"}
      description={`Parts de la prime nette Santé (hors taxe), en %. Le reste constitue la provision pour sinistres.`}>
      {champs.map((c) => (
        <div key={c.champ} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.2fr) minmax(180px, 1fr)', gap: '0.5rem 1.25rem', alignItems: 'center', padding: '0.6rem 0', borderTop: '1px solid var(--border-subtle)' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.86rem' }}>{c.libelle}</div>
            {c.aide && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{c.aide}</div>}
          </div>
          {c.type === 'forfait' ? (
            <AmountInput value={saisie[c.champ] === '' ? '' : Math.round(Number(saisie[c.champ]))} onChange={(n) => setSaisie((s) => ({ ...s, [c.champ]: n }))} suffix="FCFA" />
          ) : (
            <div style={{ position: 'relative' }}>
              <input type="number" className="form-control" min={0} max={100} step="any" value={saisie[c.champ] ?? ''}
                onChange={(e) => setSaisie((s) => ({ ...s, [c.champ]: e.target.value }))} style={{ paddingRight: '1.8rem' }} />
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>%</span>
            </div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.84rem', color: provision < 0 ? 'var(--accent-rose, #e11d48)' : 'var(--text-secondary)' }}>
          Provision pour sinistres : <strong>{provision.toLocaleString('fr-FR')} %</strong>
        </span>
        <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={memes(saisie, initiale) || envoi} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer
        </button>
      </div>
    </SectionParametrage>
  );
};

export const ParametrageSantePage = () => {
  const { error: toastError } = useToast();
  const [parametresUrl, setParametresUrl] = useSearchParams();
  const onglet = ONGLETS.some((o) => o.id === parametresUrl.get('onglet')) ? parametresUrl.get('onglet') : 'formules';
  const [donnees, setDonnees] = useState(null);
  const [enEdition, setEnEdition] = useState(null);

  useEffect(() => {
    parametrageApi.getSante().then(setDonnees).catch((err) => toastError(`Réglages Santé non chargés : ${messageErreurApi(err)}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Après chaque enregistrement : imprimés et écrans relisent le paramétrage
  const remplacer = (cle, element, egal) => {
    setDonnees((d) => ({ ...d, [cle]: d[cle].map((x) => (egal(x) ? element : x)) }));
    chargerParametrage(true);
  };

  const parGroupe = useMemo(() => {
    const groupes = {};
    (donnees?.Parametres || []).forEach((p) => { (groupes[p.Groupe] = groupes[p.Groupe] || []).push(p); });
    Object.values(groupes).forEach((l) => l.sort((a, b) => a.Ordre - b.Ordre));
    return groupes;
  }, [donnees]);

  // Formules regroupées par tarif (70 %-80 %, 80 %-80 %, VTC) dans l'ordre du réglage
  const tarifs = useMemo(() => {
    const liste = [];
    (donnees?.Formules || []).forEach((f) => {
      let t = liste.find((x) => x.libelle === f.Tarif);
      if (!t) { t = { libelle: f.Tarif || 'MINENE', formules: [] }; liste.push(t); }
      t.formules.push(f);
    });
    return liste;
  }, [donnees]);

  return (
    <div style={{ padding: '1.5rem' }}>
      <EnTeteParametrage
        icone={HeartPulse}
        titre="Réglages Santé MINENE"
        description="MINENE SANTÉ réunit trois assurances indissociables : Santé, Individuelle Accidents et RC chef de famille. Primes, surprimes, âges, barème de soins imprimé, capitaux IA et RC, conditions particulières et répartition de la prime."
        usage={(
          <>
            La base calcule les devis MINENE avec ces réglages dès leur enregistrement ; les devis déjà enregistrés et les contrats émis ne changent pas.
            Le barème et les conditions particulières imprimés reprennent ces valeurs. Accessoires et taxes : voir <Link to="/admin/settings/tarifs?produit=5">Accessoires</Link> et <Link to="/admin/settings/taxes?produit=5">Taxes</Link>.
          </>
        )}
      />

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {ONGLETS.map((o) => (
          <button key={o.id} type="button" onClick={() => setParametresUrl({ onglet: o.id })} className={`btn ${onglet === o.id ? 'btn-primary' : 'btn-secondary'}`} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <o.icone size={15} /> {o.libelle}
          </button>
        ))}
      </div>

      {!donnees && <div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Chargement…</div>}

      {donnees && onglet === 'formules' && tarifs.map((t) => (
        <SectionParametrage key={t.libelle} icone={Stethoscope} titre={t.libelle}
          description="Prime de chaque formule et plafonds du barème de soins annexé aux conditions particulières.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
                  <th style={entete}>Formule</th><th style={entete}>Personnes</th><th style={entete}>Prime de base</th>
                  <th style={entete}>Couverture</th><th style={entete}>Optique adulte / enfant</th><th style={entete}>Dentaire</th>
                  <th style={entete}>Plafond annuel</th><th style={entete} />
                </tr>
              </thead>
              <tbody>
                {t.formules.map((f) => (
                  <React.Fragment key={f.IdOffre}>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={cellule}>
                        <div style={{ fontWeight: 600 }}>{f.Option}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{f.LibelleOffre}{f.OffreActive ? '' : ' - offre inactive'}</div>
                      </td>
                      <td style={cellule}>{f.PersonnesMin === f.PersonnesMax ? f.PersonnesMax : `${f.PersonnesMin} à ${f.PersonnesMax}`}</td>
                      <td style={{ ...cellule, whiteSpace: 'nowrap' }}>{montant(f.PrimeBase)}</td>
                      <td style={{ ...cellule, whiteSpace: 'nowrap' }}>{f.TauxSoinsExternes} % / {f.TauxHospitalisation} %</td>
                      <td style={{ ...cellule, whiteSpace: 'nowrap' }}>{montant(f.OptiqueAdulte)} / {montant(f.OptiqueEnfant)}</td>
                      <td style={{ ...cellule, whiteSpace: 'nowrap' }}>{montant(f.DentaireParPersonne)}</td>
                      <td style={{ ...cellule, whiteSpace: 'nowrap' }}>{montant(f.PlafondAnnuel)}</td>
                      <td style={{ ...cellule, textAlign: 'right' }}>
                        <button type="button" className="btn btn-secondary" onClick={() => setEnEdition(enEdition === f.IdOffre ? null : f.IdOffre)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                          <Edit2 size={13} /> {enEdition === f.IdOffre ? 'Fermer' : 'Modifier'}
                        </button>
                      </td>
                    </tr>
                    {enEdition === f.IdOffre && (
                      <tr><td colSpan={8}>
                        <FicheFormule formule={f} onFermer={() => setEnEdition(null)}
                          onEnregistre={(nouvelle) => remplacer('Formules', nouvelle, (x) => x.IdOffre === nouvelle.IdOffre)} />
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </SectionParametrage>
      ))}

      {donnees && GROUPES[onglet] && GROUPES[onglet].filter((g) => parGroupe[g.id]?.length).map((g) => (
        <SectionParametrage key={g.id} icone={ONGLETS.find((o) => o.id === onglet).icone} titre={g.titre} description={g.description}>
          {parGroupe[g.id].map((p) => (
            <LigneParametre key={p.Cle} parametre={p} lignes={p.Cle.endsWith('clause_ajustement') ? 10 : 3}
              modifier={parametrageApi.modifierParametreSante} retablir={parametrageApi.retablirParametreSante}
              onEnregistre={(nouveau) => remplacer('Parametres', nouveau, (x) => x.Cle === nouveau.Cle)} />
          ))}
        </SectionParametrage>
      ))}

      {donnees && onglet === 'ia-rc' && (
        <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start', padding: '0.6rem 0.85rem', borderRadius: 8, background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.18)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <Info size={15} style={{ color: 'var(--primary-500)', flexShrink: 0, marginTop: 1 }} />
          <span>Frais de gestion ADEC par adhérent : onglet « Répartition de la prime ». Taxe IA et RC (14,5 %) : Administration &gt; Taxes. Les devis IA et RC MINENE sont tarifés pour chaque adhérent de la police Santé MINENE connexe.</span>
        </div>
      )}

      {donnees && onglet === 'repartition' && (donnees.Repartitions || []).map((r) => (
        <CarteRepartition key={r.Id} repartition={r} onEnregistre={(nouvelle) => remplacer('Repartitions', nouvelle, (x) => x.Id === nouvelle.Id)} />
      ))}
    </div>
  );
};

export default ParametrageSantePage;
