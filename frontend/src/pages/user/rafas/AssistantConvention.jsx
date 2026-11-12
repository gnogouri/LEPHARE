import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, CircleCheck, FileSpreadsheet, FileUp, Loader2, PencilLine, SlidersHorizontal, TriangleAlert, Upload,
} from 'lucide-react';
import { rafasApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { messageErreurApi } from '../../../utils/financeUtils';
import Modal from '../../../components/common/Modal';
import { RechercheClient } from '../../../components/common/RechercheClient';
import { Champ, EditeurColleges, budgetColleges, dateFr, entier, francs, libelleRang, nombre, periode, taux } from './rafasCommun';

/* =========================================================================
   RAFAS : création d'une convention (demande du 2026-11-10 : « il y a des valeurs qui n'ont pas besoin d'être saisies, propose mieux »).
   - Point de départ : le fichier du gestionnaire (effectif ou détail des sinistres VITALIS) donne le souscripteur, son code et son n° client,
     les polices, la période et le rang de l'avenant, les collèges avec leurs familles, le rattachement des collèges du gestionnaire et les
     zones (POST /api/rafas/conventions/proposition/, sans écriture) ; le client du portefeuille est retrouvé ; une convention existante
     du même souscripteur est signalée.
   - Conditions types (couverture, famille, âges, préavis, délais, honoraires, commission, barèmes) : celles de la dernière convention, repliées.
   - Seule saisie restante : la cotisation annuelle par famille de chaque collège. À la fin, la convention est créée puis le même fichier
     importé (effectif et relevé).
   ========================================================================= */

const ETAPES = ['Point de départ', 'Souscripteur et période', 'Cotisations', 'Récapitulatif'];

const ajouterUnAn = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

const Repris = ({ visible }) => (visible ? <span className="rafas-repris" title="Valeur reprise du fichier du gestionnaire"><CircleCheck size={11} aria-hidden="true" />Fichier</span> : null);

const ChampTexte = ({ libelle, valeur, onChange, repris, requis, aide, placeholder }) => (
  <Champ libelle={<>{libelle} <Repris visible={repris && Boolean(valeur)} /></>} requis={requis} aide={aide}>
    <input className="form-control" value={valeur ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  </Champ>
);

// Conditions de la convention : résumé en une ligne, champs dépliés sur demande
const Conditions = ({ c, setC, e, setE, source }) => {
  const [ouvert, setOuvert] = useState(false);
  const nb = (cle, setter) => (ev) => setter((x) => ({ ...x, [cle]: nombre(ev.target.value) }));
  const tx = (cle, setter) => (ev) => setter((x) => ({ ...x, [cle]: ev.target.value }));
  const resume = [
    `${taux(c.taux_soins)} soins externes, ${taux(c.taux_hospitalisation)} hospitalisation`,
    `honoraires ${taux(e.taux_honoraires)}, commission ${taux(e.taux_commission)}`,
    `famille ${c.composition_famille}`, `âges ${c.age_adulte} ans, enfants ${c.age_enfant} ans, étudiants ${c.age_etudiant} ans`,
    `préavis ${c.preavis_mois} mois`, `provision ${e.mois_provision} mois, alerte ${e.seuil_alerte_mois} mois`,
  ];
  return (
    <div className={`rafas-conditions${ouvert ? ' ouvert' : ''}`}>
      <button type="button" className="rafas-conditions-tete" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>
          <strong>{source ? `Conditions reprises de la convention ${source}` : 'Conditions types d\'une convention RAFAS'}</strong>
          <span>{resume.join(' ; ')}.</span>
        </span>
        <ChevronDown size={16} className="rafas-controle-chevron" aria-hidden="true" />
      </button>
      {ouvert && (
        <div className="rafas-conditions-corps">
          <div className="rafas-grille-4">
            <Champ libelle="Gestionnaire"><input className="form-control" value={c.gestionnaire || ''} onChange={tx('gestionnaire', setC)} /></Champ>
            <Champ libelle="Taux soins externes (%)"><input className="form-control rafas-nombre" value={c.taux_soins ?? ''} onChange={nb('taux_soins', setC)} /></Champ>
            <Champ libelle="Taux hospitalisation (%)"><input className="form-control rafas-nombre" value={c.taux_hospitalisation ?? ''} onChange={nb('taux_hospitalisation', setC)} /></Champ>
            <Champ libelle="Territoire"><input className="form-control" value={c.territoire || ''} onChange={tx('territoire', setC)} /></Champ>
            <Champ libelle="Honoraires du gestionnaire (%)"><input className="form-control rafas-nombre" value={e.taux_honoraires ?? ''} onChange={nb('taux_honoraires', setE)} /></Champ>
            <Champ libelle="Commission du cabinet (%)" aide="Chiffre d'affaires du cabinet."><input className="form-control rafas-nombre" value={e.taux_commission ?? ''} onChange={nb('taux_commission', setE)} /></Champ>
            <Champ libelle="Provision demandée (mois de dépenses)"><input className="form-control rafas-nombre" value={e.mois_provision ?? ''} onChange={nb('mois_provision', setE)} /></Champ>
            <Champ libelle="Alerte du fonds (mois de dépenses)"><input className="form-control rafas-nombre" value={e.seuil_alerte_mois ?? ''} onChange={nb('seuil_alerte_mois', setE)} /></Champ>
            <Champ libelle="Composition de la famille"><input className="form-control" value={c.composition_famille || ''} onChange={tx('composition_famille', setC)} /></Champ>
            <Champ libelle="Enfants au plus"><input className="form-control rafas-nombre" value={c.enfants_max ?? ''} onChange={nb('enfants_max', setC)} /></Champ>
            <Champ libelle="Âge limite des adultes"><input className="form-control rafas-nombre" value={c.age_adulte ?? ''} onChange={nb('age_adulte', setC)} /></Champ>
            <Champ libelle="Âge limite des enfants"><input className="form-control rafas-nombre" value={c.age_enfant ?? ''} onChange={nb('age_enfant', setC)} /></Champ>
            <Champ libelle="Étudiants jusqu'à (âge)"><input className="form-control rafas-nombre" value={c.age_etudiant ?? ''} onChange={nb('age_etudiant', setC)} /></Champ>
            <Champ libelle="Préavis de dénonciation (mois)"><input className="form-control rafas-nombre" value={c.preavis_mois ?? ''} onChange={nb('preavis_mois', setC)} /></Champ>
            <Champ libelle="Présentation des demandes (mois)"><input className="form-control rafas-nombre" value={c.delai_remboursement_mois ?? ''} onChange={nb('delai_remboursement_mois', setC)} /></Champ>
            <Champ libelle="Contestation (jours)"><input className="form-control rafas-nombre" value={c.delai_contestation_jours ?? ''} onChange={nb('delai_contestation_jours', setC)} /></Champ>
          </div>
        </div>
      )}
    </div>
  );
};

const PointDeDepart = ({ proposition, lecture, onFichier, onManuel, onOuvrirExistante }) => {
  const entree = useRef(null);
  const [survol, setSurvol] = useState(false);
  const p = proposition;
  return (
    <div className="rafas-depart">
      {!p && (
        <>
          <div className={`rafas-depot${survol ? ' survol' : ''}`} onDragOver={(ev) => { ev.preventDefault(); setSurvol(true); }} onDragLeave={() => setSurvol(false)}
            onDrop={(ev) => { ev.preventDefault(); setSurvol(false); onFichier(ev.dataTransfer.files?.[0]); }}>
            {lecture ? <><Loader2 size={26} className="spin" aria-hidden="true" /><p>{`Lecture de ${lecture}…`}</p></> : (
              <>
                <Upload size={26} aria-hidden="true" />
                <p><strong>Recommandé : partez du fichier du gestionnaire.</strong></p>
                <p className="cs-note">L'effectif ou le détail des sinistres VITALIS suffit : souscripteur, polices, période, collèges et familles en sont repris.
                  Il ne restera qu'à indiquer la cotisation par famille de chaque collège.</p>
                <button type="button" className="btn btn-primary rafas-bouton" onClick={() => entree.current?.click()}><FileUp size={15} /> Choisir le fichier</button>
                <input ref={entree} type="file" accept=".xlsx,.xlsm" hidden onChange={(ev) => { onFichier(ev.target.files?.[0]); ev.target.value = ''; }} />
              </>
            )}
          </div>
          <button type="button" className="btn btn-link rafas-lien" onClick={onManuel}><PencilLine size={14} /> Saisir sans fichier</button>
        </>
      )}
      {p && (
        <div className="rafas-repris-liste">
          <div className="rafas-analyse-tete">
            <FileSpreadsheet size={20} aria-hidden="true" />
            <div><strong>{p.Fichier}</strong><span>Repris du fichier ; tout reste modifiable aux étapes suivantes.</span></div>
          </div>
          {p.Existante && (
            <div className="rafas-avertissement">
              <TriangleAlert size={15} aria-hidden="true" />
              <span>{p.Existante.motif === 'code'
                ? `Le code ${p.Convention.code_garant} de ce fichier est déjà celui de la convention « ${p.Existante.souscripteur} » : pour une nouvelle année, renouvelez-la ; s'il s'agit d'une erreur de saisie, corrigez son souscripteur.`
                : `Une convention existe déjà pour ${p.Existante.souscripteur} : pour une nouvelle année, renouvelez-la plutôt que d'en créer une seconde.`}</span>
              <button type="button" className="btn btn-secondary rafas-bouton" onClick={() => onOuvrirExistante(p.Existante.idconvention)}>Ouvrir la convention</button>
            </div>
          )}
          <ul>
            <li><CircleCheck size={15} aria-hidden="true" /><span>Souscripteur</span><strong>{`${p.Convention.souscripteur}${p.Convention.code_garant ? ` (code ${p.Convention.code_garant}${p.Convention.numero_client ? `, client n°${p.Convention.numero_client}` : ''})` : ''}`}</strong></li>
            {p.Client && <li><CircleCheck size={15} aria-hidden="true" /><span>Client du portefeuille</span><strong>{p.Client.nom}</strong></li>}
            <li><CircleCheck size={15} aria-hidden="true" /><span>Polices</span><strong>{p.Convention.polices || p.Polices.map((x) => x.Libelle).join(', ')}</strong></li>
            {p.Exercice.date_effet ? (
              <li><CircleCheck size={15} aria-hidden="true" /><span>Période</span><strong>{`${libelleRang(p.Exercice.rang)} ${periode(p.Exercice)}${p.Exercice.rang ? `, convention depuis le ${dateFr(p.Exercice.debut_convention)}` : ''}`}</strong></li>
            ) : <li className="manque"><TriangleAlert size={15} aria-hidden="true" /><span>Période</span><strong>Absente du relevé : à indiquer à l'étape suivante</strong></li>}
            <li><CircleCheck size={15} aria-hidden="true" /><span>Collèges</span><strong>{p.Colleges.map((x) => x.libelle).join(', ')}</strong></li>
            {p.Beneficiaires ? (
              <li><CircleCheck size={15} aria-hidden="true" /><span>Effectif</span><strong>{`${entier(p.Familles)} familles, ${entier(p.Beneficiaires)} bénéficiaires au ${dateFr(p.Situation)}`}</strong></li>
            ) : <li className="manque"><TriangleAlert size={15} aria-hidden="true" /><span>Familles</span><strong>Pas d'effectif dans ce fichier : nombres à saisir</strong></li>}
            {p.Prestations > 0 && <li><CircleCheck size={15} aria-hidden="true" /><span>Relevé</span><strong>{`${entier(p.Prestations)} prestations de ${p.MoisReleves[0].toLowerCase()} à ${p.MoisReleves[1].toLowerCase()}`}</strong></li>}
            <li><CircleCheck size={15} aria-hidden="true" /><span>Zones</span><strong>{`${new Set(p.Liens.map((l) => l.zone)).size} zones de concentration, ${p.Liens.length} collèges du gestionnaire rattachés`}</strong></li>
          </ul>
        </div>
      )}
    </div>
  );
};

const AssistantConvention = ({ ouvert, onFermer, modeles, onCree, onOuvrirExistante }) => {
  const { success, error: toastError } = useToast();
  const [etape, setEtape] = useState(0);
  const [envoi, setEnvoi] = useState('');
  const [fichier, setFichier] = useState(null);
  const [lecture, setLecture] = useState('');
  const [proposition, setProposition] = useState(null);
  const [importer, setImporter] = useState(true);
  const [client, setClient] = useState(null);
  const [c, setC] = useState({});
  const [e, setE] = useState({});
  const [colleges, setColleges] = useState([]);

  const initialiser = (m) => {
    setC({ ...m.Convention, souscripteur: '', adresse: '', contact: '', representant: '', code_garant: '', numero_client: '', polices: '' });
    setE({ ...m.Exercice, date_effet: '', date_echeance: '', date_signature: '', rang: 0 });
    setColleges([]);
    setClient(null);
  };
  useEffect(() => {
    if (!ouvert || !modeles) return;
    setEtape(0);
    setFichier(null);
    setProposition(null);
    setImporter(true);
    initialiser(modeles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, modeles]);

  const lire = async (f) => {
    if (!f) return;
    setLecture(f.name);
    try {
      const p = await rafasApi.proposerConvention(f);
      setFichier(f);
      setProposition(p);
      setC({ ...p.Convention, representant: '' });
      setE({ ...p.Exercice, date_signature: '' });
      setColleges(p.Colleges.map((x) => ({ ...x, code: '' })));
      setClient(p.Client ? { IdClient: p.Client.idclient, Nom: p.Client.nom, Telephone: p.Client.telephone, Adresse: p.Client.adresse } : null);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setLecture('');
    }
  };

  const b = budgetColleges(colleges, e.taux_honoraires, e.taux_commission);
  const manquantes = colleges.filter((x) => !Number(x.cotisation));
  const erreurs = [
    null,
    (!String(c.souscripteur || '').trim() && 'Indiquez le souscripteur.') || ((!e.date_effet || !e.date_echeance || e.date_echeance <= e.date_effet) && "Indiquez la période : l'échéance suit la date d'effet."),
    (!colleges.length && 'Ajoutez au moins un collège.') || (colleges.some((x) => !String(x.libelle || '').trim()) && 'Chaque collège a un libellé.')
      || (manquantes.length && `Cotisation par famille à indiquer : ${manquantes.map((x) => x.libelle).join(', ')}.`),
    null,
  ];
  const bloquant = erreurs[etape];
  const effectifs = (proposition?.Feuilles || []).filter((f) => f.Proposee && f.Nature === 'EFFECTIF');
  const releves = (proposition?.Feuilles || []).filter((f) => f.Proposee && f.Nature === 'SINISTRES');

  const enregistrer = async () => {
    const premiere = erreurs.find(Boolean);
    if (premiere) { toastError(premiere); return; }
    setEnvoi('creation');
    try {
      const liens = (proposition?.Liens || []).map((l) => ({ ...l, college_libelle: (colleges.find((x) => (x.codes || []).includes(l.code_college)) || {}).libelle || '' }));
      const r = await rafasApi.creer({
        Convention: { ...c, idclient: client?.IdClient || null },
        Exercice: { ...e, colleges: colleges.map(({ codes, beneficiaires, ...x }) => x) },
        Liens: liens,
      });
      const id = r.Convention.idconvention;
      let importe = false;
      if (fichier && importer && (effectifs.length || releves.length)) {
        setEnvoi('import');
        try {
          await rafasApi.importer(id, fichier, {
            feuilles: [...effectifs, ...releves].map((f) => f.Feuille),
            situations: Object.fromEntries(effectifs.filter((f) => f.Situation).map((f) => [f.Feuille, f.Situation])),
          });
          importe = true;
        } catch (err) {
          toastError(`Convention créée, mais import du fichier impossible : ${messageErreurApi(err)}`);
        }
      }
      success(`Convention RAFAS ${c.souscripteur} enregistrée${importe ? ' et fichier du gestionnaire importé' : ''}.`);
      onCree(id, importe);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi('');
    }
  };

  const ch = (cle) => (v) => setC((x) => ({ ...x, [cle]: v }));
  const repris = Boolean(proposition);
  return (
    <Modal isOpen={ouvert} onClose={onFermer} title="Nouvelle convention RAFAS" subtitle="Régime autofinancé d'assurance santé géré pour le compte du souscripteur" maxWidth="1000px">
      <ol className="rafas-etapes" aria-label="Étapes">
        {ETAPES.map((libelle, i) => (
          <li key={libelle} className={i === etape ? 'actif' : i < etape ? 'fait' : ''} aria-current={i === etape ? 'step' : undefined}>
            <span>{i < etape ? <Check size={13} /> : i + 1}</span>{libelle}
          </li>
        ))}
      </ol>
      <div className="rafas-etape" key={etape}>
        {etape === 0 && (
          <PointDeDepart proposition={proposition} lecture={lecture} onFichier={lire} onManuel={() => { initialiser(modeles); setProposition(null); setFichier(null); setEtape(1); }}
            onOuvrirExistante={onOuvrirExistante} />
        )}
        {etape === 1 && (
          <>
            <div className="rafas-grille-2">
              <div style={{ gridColumn: '1 / -1' }}>
                <RechercheClient label="Client du portefeuille (facultatif)" personne={client}
                  onChoisir={(p) => { setClient(p); setC((x) => ({ ...x, souscripteur: x.souscripteur || p.Nom, adresse: x.adresse || p.Adresse, contact: x.contact || p.Telephone })); }} />
              </div>
              <ChampTexte libelle="Souscripteur" requis valeur={c.souscripteur} onChange={ch('souscripteur')} repris={repris} placeholder="Ex. EXAT AGRICULTURE" />
              <ChampTexte libelle="Représentant" valeur={c.representant} onChange={ch('representant')} placeholder="Nom et fonction" />
              <ChampTexte libelle="Adresse postale" valeur={c.adresse} onChange={ch('adresse')} repris={repris && Boolean(proposition?.Client)} />
              <ChampTexte libelle="Contact" valeur={c.contact} onChange={ch('contact')} repris={repris && Boolean(proposition?.Client)} />
              <ChampTexte libelle="Polices du gestionnaire" valeur={c.polices} onChange={ch('polices')} repris={repris} aide="Numéros séparés par une barre oblique." />
              <ChampTexte libelle="Code du souscripteur dans les fichiers" valeur={c.code_garant} onChange={(v) => setC((x) => ({ ...x, code_garant: v.toUpperCase() }))} repris={repris} />
              <ChampTexte libelle="N° client chez le gestionnaire" valeur={c.numero_client} onChange={ch('numero_client')} repris={repris} />
              <ChampTexte libelle="Gestionnaire" valeur={c.gestionnaire} onChange={ch('gestionnaire')} />
            </div>
            <h3 className="rafas-sous-titre">Période</h3>
            <div className="rafas-grille-4">
              <Champ libelle={<>Date d'effet <Repris visible={repris && Boolean(e.date_effet)} /></>} requis>
                <input type="date" className="form-control" value={e.date_effet || ''} onChange={(ev) => setE((x) => ({ ...x, date_effet: ev.target.value, date_echeance: x.date_echeance || ajouterUnAn(ev.target.value) }))} />
              </Champ>
              <Champ libelle={<>Date d'échéance <Repris visible={repris && Boolean(e.date_echeance)} /></>} requis>
                <input type="date" className="form-control" value={e.date_echeance || ''} onChange={(ev) => setE((x) => ({ ...x, date_echeance: ev.target.value }))} />
              </Champ>
              <Champ libelle={<>Exercice <Repris visible={repris && e.rang !== undefined && Boolean(e.date_effet)} /></>} aide={e.rang ? `Convention depuis le ${dateFr(e.debut_convention || '')}` : undefined}>
                <select className="form-control" value={e.rang ?? 0} onChange={(ev) => setE((x) => ({ ...x, rang: Number(ev.target.value) }))}>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => <option key={r} value={r}>{libelleRang(r)}</option>)}
                </select>
              </Champ>
              <Champ libelle="Date de signature"><input type="date" className="form-control" value={e.date_signature || ''} onChange={(ev) => setE((x) => ({ ...x, date_signature: ev.target.value }))} /></Champ>
            </div>
          </>
        )}
        {etape === 2 && (
          <>
            <p className="rafas-consigne">
              {repris ? `${colleges.length} collèges repris du fichier, avec leurs familles. Indiquez la cotisation annuelle par famille de chaque collège, telle qu'elle figure à la convention ou au dernier avenant ; plafond annuel et barème sont ceux de la catégorie.`
                : 'Ajoutez les collèges de la convention, leur cotisation annuelle par famille et leur nombre de familles ; plafond annuel et barème sont proposés selon la catégorie.'}
            </p>
            <EditeurColleges colleges={colleges} onChange={setColleges} modeles={modeles?.Colleges} exigerCotisation />
          </>
        )}
        {etape === 3 && (
          <div className="rafas-recap">
            <div className="cs-tuiles larges">
              <div className="cs-tuile"><div className="cs-tuile-libelle">Cotisations annuelles</div><div className="cs-tuile-valeur">{francs(b.Cotisations)}</div>
                <div className="cs-tuile-detail">{`${entier(colleges.reduce((s, x) => s + (Number(x.familles) || 0), 0))} familles, ${colleges.length} collèges`}</div></div>
              <div className="cs-tuile"><div className="cs-tuile-libelle">Honoraires du gestionnaire</div><div className="cs-tuile-valeur">{francs(b.Honoraires)}</div><div className="cs-tuile-detail">{`${taux(e.taux_honoraires)} des cotisations`}</div></div>
              <div className="cs-tuile rafas-tuile-accent"><div className="cs-tuile-libelle">Commission du cabinet</div><div className="cs-tuile-valeur">{francs(b.Commission)}</div><div className="cs-tuile-detail">{`${taux(e.taux_commission)}, chiffre d'affaires`}</div></div>
              <div className="cs-tuile"><div className="cs-tuile-libelle">Enveloppe des sinistres</div><div className="cs-tuile-valeur">{francs(b.Enveloppe)}</div><div className="cs-tuile-detail">Cotisations moins honoraires et commission</div></div>
            </div>
            <dl className="cs-chiffres-cles">
              <div><dt>Souscripteur</dt><dd>{c.souscripteur || '-'}</dd></div>
              <div><dt>Gestionnaire</dt><dd>{c.gestionnaire}</dd></div>
              <div><dt>Exercice</dt><dd>{`${libelleRang(e.rang || 0)} ${periode(e)}`}</dd></div>
              <div><dt>Polices</dt><dd>{c.polices || '-'}</dd></div>
            </dl>
            <Conditions c={c} setC={setC} e={e} setE={setE} source={modeles?.Source} />
            {fichier && (effectifs.length > 0 || releves.length > 0) && (
              <label className="rafas-importer-aussi">
                <input type="checkbox" checked={importer} onChange={(ev) => setImporter(ev.target.checked)} />
                <span>
                  <strong>Importer aussi le fichier du gestionnaire</strong>
                  <span>{[...effectifs.map((f) => `effectif du ${dateFr(f.Situation)} : ${entier(f.Beneficiaires ?? f.Lignes)} bénéficiaires`),
                    ...releves.map((f) => `relevé « ${f.Feuille} » : ${entier(f.Lignes)} prestations`)].join(' ; ')}</span>
                </span>
              </label>
            )}
            {erreurs.filter(Boolean).map((m) => <p key={m} className="rafas-erreur">{m}</p>)}
          </div>
        )}
      </div>
      <div className="rafas-pied-assistant">
        <button type="button" className="btn btn-secondary rafas-bouton" onClick={() => (etape ? setEtape(etape - 1) : onFermer())}>
          <ArrowLeft size={15} /> {etape ? 'Précédent' : 'Annuler'}
        </button>
        {etape === 0 && !proposition ? null : etape < ETAPES.length - 1 ? (
          <button type="button" className="btn btn-primary rafas-bouton" disabled={Boolean(bloquant)} title={bloquant || undefined} onClick={() => setEtape(etape + 1)}>
            Suivant <ArrowRight size={15} />
          </button>
        ) : (
          <button type="button" className="btn btn-primary rafas-bouton" disabled={Boolean(envoi)} onClick={enregistrer}>
            {envoi ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
            {envoi === 'import' ? ' Import du fichier…' : envoi ? ' Création…' : fichier && importer ? ' Créer la convention et importer le fichier' : ' Créer la convention'}
          </button>
        )}
      </div>
    </Modal>
  );
};

export default AssistantConvention;
