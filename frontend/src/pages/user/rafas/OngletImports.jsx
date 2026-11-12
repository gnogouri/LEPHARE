import React, { useEffect, useRef, useState } from 'react';
import { Check, FileSpreadsheet, FileUp, Loader2, Save, Trash2, TriangleAlert, Upload, Users, X } from 'lucide-react';
import { rafasApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { aLeDroit } from '../../../utils/droits';
import { confirmer } from '../../../utils/dialogue';
import { messageErreurApi } from '../../../utils/financeUtils';
import { Badge, Carte, Tableau, dateFr, entier, francs, francsCourts, moisFr } from './rafasCommun';

/* Fichiers du gestionnaire : relevés de prestations (DETAIL DES SINISTRES, ETATS PERSONNALISES) et effectifs (EFFECTIF ...), reconnus par
   leurs en-têtes ; lecture sans écriture, choix des feuilles, puis import. Un mois de clôture importé remplace celui déjà en base pour les
   mêmes polices ; un effectif remplace celui de même date de situation. Rattachement des collèges du gestionnaire. */

const LIENS = { A: 'assurés', C: 'conjoints', E: 'enfants' };

const Feuille = ({ f, coche, onCocher, situation, onSituation }) => (
  <div className={`rafas-feuille${coche ? ' cochee' : ''}`}>
    <label className="rafas-feuille-tete">
      <input type="checkbox" checked={coche} onChange={(e) => onCocher(e.target.checked)} />
      {f.Nature === 'EFFECTIF' ? <Users size={17} aria-hidden="true" /> : <FileSpreadsheet size={17} aria-hidden="true" />}
      <strong>{f.Feuille}</strong>
      <Badge ton={f.Nature === 'EFFECTIF' ? 'info' : 'neutre'}>{f.Nature === 'EFFECTIF' ? 'Effectif' : 'Relevé de prestations'}</Badge>
      <span className="rafas-feuille-compte">{`${entier(f.Lignes)} lignes`}</span>
    </label>
    {f.Nature === 'SINISTRES' ? (
      <div className="rafas-feuille-corps">
        <p>{`${francs(f.Rembourse)} remboursés${f.Totaux ? ` ; ${f.Totaux} ligne de total écartée` : ''}${f.AutreGarant ? ` ; ${entier(f.AutreGarant)} lignes d'un autre souscripteur écartées` : ''}.`}</p>
        <div className="rafas-mois">
          {f.Mois.map((m) => (
            <span key={m.Mois} className={`rafas-mois-puce${m.Retenu ? '' : ' ecarte'}`} title={m.Retenu ? `${entier(m.Lignes)} lignes, ${francs(m.Rembourse)}` : 'Ce mois est pris dans une autre feuille plus complète du classeur'}>
              {`${m.Libelle} : ${francsCourts(m.Rembourse)}`}
            </span>
          ))}
        </div>
        {!f.Proposee && <p className="cs-note">Feuille de travail qui recopie une autre feuille du classeur : ses mois y sont déjà pris, elle n'est pas cochée.</p>}
      </div>
    ) : (
      <div className="rafas-feuille-corps">
        <div className="rafas-feuille-situation">
          <label>
            <span>Effectif à jour au</span>
            <input type="date" className="form-control" value={situation || ''} onChange={(e) => onSituation(e.target.value)} />
          </label>
          <p>{`${entier(f.Familles)} familles : ${Object.entries(f.Liens).map(([k, n]) => `${entier(n)} ${LIENS[k] || k}`).join(', ')}${f.Sorties ? ` ; ${entier(f.Sorties)} sorties datées` : ''}.`}</p>
        </div>
        {f.Motif && <p className="rafas-erreur"><TriangleAlert size={14} aria-hidden="true" /> {f.Motif}</p>}
        {!situation && coche && <p className="rafas-erreur">Indiquez la date de situation de cet effectif.</p>}
      </div>
    )}
  </div>
);

const Depot = ({ id, onModifie, onImporte }) => {
  const { success, error: toastError } = useToast();
  const entree = useRef(null);
  const [fichier, setFichier] = useState(null);
  const [analyse, setAnalyse] = useState(null);
  const [cochees, setCochees] = useState({});
  const [situations, setSituations] = useState({});
  const [etat, setEtat] = useState('');
  const [survol, setSurvol] = useState(false);
  const lire = async (f) => {
    if (!f) return;
    setFichier(f);
    setAnalyse(null);
    setEtat('lecture');
    try {
      const a = await rafasApi.analyserFichier(id, f);
      setAnalyse(a);
      setCochees(Object.fromEntries(a.Feuilles.map((x) => [x.Feuille, x.Proposee])));
      setSituations(Object.fromEntries(a.Feuilles.filter((x) => x.Nature === 'EFFECTIF').map((x) => [x.Feuille, x.Situation || ''])));
    } catch (err) {
      toastError(messageErreurApi(err));
      setFichier(null);
    } finally {
      setEtat('');
    }
  };
  const choisies = analyse ? analyse.Feuilles.filter((x) => cochees[x.Feuille]) : [];
  const manque = choisies.some((x) => x.Nature === 'EFFECTIF' && !situations[x.Feuille]);
  const importer = async () => {
    setEtat('import');
    try {
      const r = await rafasApi.importer(id, fichier, { feuilles: choisies.map((x) => x.Feuille), situations });
      const morceaux = [r.Prestations && `${entier(r.Prestations)} prestations (${francs(r.Rembourse)})`, r.Beneficiaires && `${entier(r.Beneficiaires)} bénéficiaires`].filter(Boolean);
      success(`Import terminé : ${morceaux.join(' et ')}.${r.Remplacees ? ` ${entier(r.Remplacees)} lignes déjà importées remplacées.` : ''}`);
      setFichier(null);
      setAnalyse(null);
      onModifie(r.Convention);
      onImporte?.();
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEtat('');
    }
  };
  return (
    <Carte titre="Importer un fichier du gestionnaire" sousTitre="Classeur Excel reçu du gestionnaire : relevé des prestations (détail des sinistres) et effectif. Les feuilles sont reconnues par leurs colonnes.">
      {!analyse && (
        <div className={`rafas-depot${survol ? ' survol' : ''}`} onDragOver={(e) => { e.preventDefault(); setSurvol(true); }} onDragLeave={() => setSurvol(false)}
          onDrop={(e) => { e.preventDefault(); setSurvol(false); lire(e.dataTransfer.files?.[0]); }}>
          {etat === 'lecture' ? <><Loader2 size={26} className="spin" aria-hidden="true" /><p>{`Lecture de ${fichier?.name}… (un relevé de 14 000 lignes prend une quinzaine de secondes)`}</p></> : (
            <>
              <Upload size={26} aria-hidden="true" />
              <p>Déposez le classeur ici ou</p>
              <button type="button" className="btn btn-primary rafas-bouton" onClick={() => entree.current?.click()}><FileUp size={15} /> Choisir un fichier</button>
              <input ref={entree} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => { lire(e.target.files?.[0]); e.target.value = ''; }} />
            </>
          )}
        </div>
      )}
      {analyse && (
        <div className="rafas-analyse-fichier">
          <div className="rafas-analyse-tete">
            <FileSpreadsheet size={20} aria-hidden="true" />
            <div><strong>{analyse.Fichier}</strong><span>{`Souscripteur ${analyse.CodeGarant || analyse.GarantPropose || 'non précisé'} ; ${analyse.Feuilles.length} feuilles reconnues, ${analyse.Ignorees.length} ignorées`}</span></div>
            <button type="button" className="rafas-icone-bouton" onClick={() => { setAnalyse(null); setFichier(null); }} aria-label="Abandonner ce fichier"><X size={16} /></button>
          </div>
          {analyse.MoisRemplaces.length > 0 && (
            <p className="rafas-avertissement"><TriangleAlert size={15} aria-hidden="true" />{`Déjà importés, remplacés pour les mêmes polices : ${analyse.MoisRemplaces.join(', ')}.`}</p>
          )}
          {analyse.NouveauxColleges.length > 0 && (
            <p className="rafas-avertissement info"><Users size={15} aria-hidden="true" />{`${analyse.NouveauxColleges.length} collèges du gestionnaire seront rattachés d'office à un collège et à une zone ; vérifiez-les ensuite dans « Collèges du gestionnaire ».`}</p>
          )}
          {analyse.Feuilles.map((f) => (
            <Feuille key={f.Feuille} f={f} coche={!!cochees[f.Feuille]} onCocher={(v) => setCochees((c) => ({ ...c, [f.Feuille]: v }))}
              situation={situations[f.Feuille]} onSituation={(v) => setSituations((s) => ({ ...s, [f.Feuille]: v }))} />
          ))}
          {analyse.Ignorees.length > 0 && (
            <details className="rafas-ignorees">
              <summary>{`${analyse.Ignorees.length} feuilles ignorées`}</summary>
              <ul>{analyse.Ignorees.map((x) => <li key={x.Feuille}><strong>{x.Feuille}</strong> : {x.Motif}</li>)}</ul>
            </details>
          )}
          <div className="rafas-pied-assistant">
            <button type="button" className="btn btn-secondary" onClick={() => { setAnalyse(null); setFichier(null); }}>Abandonner</button>
            <button type="button" className="btn btn-primary rafas-bouton" disabled={!choisies.length || manque || etat === 'import'} onClick={importer}>
              {etat === 'import' ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {`Importer ${choisies.length} feuille${choisies.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </Carte>
  );
};

const Liens = ({ id, convention, onModifie }) => {
  const { success, error: toastError } = useToast();
  const [lignes, setLignes] = useState(convention.Liens);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => { setLignes(convention.Liens); }, [convention.Liens]);
  const colleges = convention.Exercices.length ? convention.Exercices[convention.Exercices.length - 1].colleges : [];
  const modifier = (code, champ, valeur) => setLignes((ls) => ls.map((l) => (l.code_college === code ? { ...l, [champ]: valeur } : l)));
  const change = JSON.stringify(lignes) !== JSON.stringify(convention.Liens);
  const peut = aLeDroit('rafas.manage');
  const enregistrer = async () => {
    setEnvoi(true);
    try {
      onModifie(await rafasApi.enregistrerLiens(id, lignes));
      success('Rattachement des collèges enregistré : les analyses en tiennent compte.');
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };
  if (!lignes.length) return null;
  return (
    <Carte titre="Collèges du gestionnaire" sousTitre="Chaque collège des fichiers du gestionnaire est rattaché à un collège de la convention (cotisation, plafond, barème) et à une zone de concentration des travailleurs."
      actions={peut && <button type="button" className="btn btn-primary rafas-bouton" disabled={!change || envoi} onClick={enregistrer}><Save size={15} /> Enregistrer</button>}>
      <div className="table-wrapper rafas-tableau compact">
        <table className="data-table">
          <thead><tr><th>Code</th><th>Collège du gestionnaire</th><th>Police</th><th>Collège de la convention</th><th>Catégorie</th><th>Zone</th></tr></thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.code_college} className={!l.college ? 'rafas-ligne-alerte' : undefined}>
                <td>{l.code_college}</td><td>{l.libelle}</td><td>{l.police}</td>
                <td>
                  <select className="form-control" value={l.college || ''} disabled={!peut} onChange={(e) => modifier(l.code_college, 'college', e.target.value)}>
                    <option value="">Non rattaché</option>
                    {colleges.map((c) => <option key={c.code} value={c.code}>{c.libelle}</option>)}
                  </select>
                </td>
                <td>{l.categorie}</td>
                <td><input className="form-control" value={l.zone} disabled={!peut} onChange={(e) => modifier(l.code_college, 'zone', e.target.value.toUpperCase())} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Carte>
  );
};

const OngletImports = ({ id, convention, onModifie }) => {
  const { success, error: toastError } = useToast();
  const peutImporter = aLeDroit('rafas.import');
  const supprimer = async (i) => {
    const libelle = i.nature === 'EFFECTIF' ? `l'effectif du ${dateFr(i.situation)}` : `les ${entier(i.lignes)} prestations de ${i.feuille}`;
    if (!(await confirmer({ titre: "Supprimer l'import", message: `Supprimer ${libelle} ?`, confirmer: 'Supprimer', ton: 'danger' }))) return;
    try {
      onModifie(await rafasApi.supprimerImport(id, i.idimport));
      success('Import supprimé.');
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };
  return (
    <div className="cs-pile">
      {peutImporter ? <Depot id={id} onModifie={onModifie} /> : <Carte titre="Import"><p className="cs-muet">Le droit « Importer les fichiers du gestionnaire RAFAS » est nécessaire pour importer.</p></Carte>}
      <Liens id={id} convention={convention} onModifie={onModifie} />
      <Carte titre="Fichiers importés" sousTitre={convention.MoisDisponibles.length ? `Relevés de ${moisFr(convention.MoisDisponibles[0])} à ${moisFr(convention.MoisDisponibles[convention.MoisDisponibles.length - 1]).toLowerCase()}.` : 'Aucun relevé importé.'}>
        <Tableau vide="Aucun fichier importé." cle={(i) => i.idimport} colonnes={[
          { cle: 'nature', libelle: 'Nature', rendu: (i) => <Badge ton={i.nature === 'EFFECTIF' ? 'info' : 'neutre'}>{i.nature === 'EFFECTIF' ? 'Effectif' : 'Relevé'}</Badge> },
          { cle: 'periode', libelle: 'Période', rendu: (i) => (i.nature === 'EFFECTIF' ? `Au ${dateFr(i.situation)}` : i.mois_du === i.mois_au ? moisFr(i.mois_du) : `${moisFr(i.mois_du)} à ${moisFr(i.mois_au).toLowerCase()}`) },
          { cle: 'feuille', libelle: 'Feuille', rendu: (i) => <span title={i.fichier}>{i.feuille}</span> },
          { cle: 'lignes', libelle: 'Lignes', nombre: true },
          { cle: 'montant', libelle: 'Remboursé', nombre: true, rendu: (i) => (i.nature === 'SINISTRES' ? francs(i.montant) : '') },
          { cle: 'operateur', libelle: 'Par', rendu: (i) => `${i.operateur || '-'}, ${dateFr(i.date_import)}` },
          { cle: 'actions', libelle: '', rendu: (i) => peutImporter && <button type="button" className="rafas-icone-bouton danger" title="Supprimer cet import" onClick={() => supprimer(i)}><Trash2 size={15} /></button> },
        ]} lignes={convention.Imports} />
      </Carte>
    </div>
  );
};

export default OngletImports;
