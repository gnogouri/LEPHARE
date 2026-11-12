import React, { useEffect, useState } from 'react';
import { CalendarPlus, Check, ListChecks, Loader2, Pencil, Printer, RefreshCw, Trash2, X } from 'lucide-react';
import { rafasApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { aLeDroit } from '../../../utils/droits';
import { confirmer } from '../../../utils/dialogue';
import { messageErreurApi } from '../../../utils/financeUtils';
import { imprimerConditions } from '../../../utils/impressionsRafas';
import Modal from '../../../components/common/Modal';
import { Badge, Carte, Champ, EditeurBareme, EditeurColleges, budgetColleges, dateFr, entier, francs, libelleRang, nombre, periode, taux } from './rafasCommun';

/* Convention : souscripteur, gestionnaire, règles de couverture et de famille ; exercices (convention de base puis avenants de
   renouvellement) avec leurs collèges, cotisations, familles, barèmes, honoraires et commission ; renouvellement et conditions particulières. */

const CHAMPS = [
  ['souscripteur', 'Souscripteur', 'texte'], ['representant', 'Représentant', 'texte'], ['adresse', 'Adresse postale', 'texte'], ['contact', 'Contact', 'texte'],
  ['gestionnaire', 'Gestionnaire', 'texte'], ['polices', 'Polices du gestionnaire', 'texte'], ['numero_client', 'N° client chez le gestionnaire', 'texte'],
  ['code_garant', 'Code dans les fichiers (CodGar)', 'texte'], ['nature_risque', 'Nature du risque', 'texte'], ['territoire', 'Territoire', 'texte'],
  ['taux_soins', 'Taux soins externes (%)', 'nombre'], ['taux_hospitalisation', 'Taux hospitalisation (%)', 'nombre'],
  ['composition_famille', 'Composition de la famille', 'texte'], ['enfants_max', 'Enfants au plus', 'nombre'], ['age_adulte', 'Âge limite des adultes', 'nombre'],
  ['age_enfant', 'Âge limite des enfants', 'nombre'], ['age_etudiant', "Étudiants jusqu'à (âge)", 'nombre'], ['preavis_mois', 'Préavis (mois)', 'nombre'],
  ['delai_remboursement_mois', 'Délai de présentation des demandes (mois)', 'nombre'], ['delai_contestation_jours', 'Délai de contestation (jours)', 'nombre'],
];

const EditeurExercice = ({ exercice, convention, onFermer, onEnregistre, familiesReelles }) => {
  const { success, error: toastError } = useToast();
  const [e, setE] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => { setE(exercice ? { ...exercice, colleges: exercice.colleges.map((c) => ({ ...c })) } : null); }, [exercice]);
  if (!e) return null;
  const b = budgetColleges(e.colleges, e.taux_honoraires, e.taux_commission);
  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const donnees = { date_effet: e.date_effet, date_echeance: e.date_echeance, date_signature: e.date_signature || null, taux_honoraires: e.taux_honoraires,
        taux_commission: e.taux_commission, mois_provision: e.mois_provision, seuil_alerte_mois: e.seuil_alerte_mois, observations: e.observations || '', colleges: e.colleges };
      const r = e.idexercice ? await rafasApi.modifierExercice(convention, e.idexercice, donnees) : await rafasApi.ajouterExercice(convention, donnees);
      success('Exercice enregistré.');
      onEnregistre(r);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };
  const champ = (cle, conv) => (ev) => setE({ ...e, [cle]: conv ? conv(ev.target.value) : ev.target.value });
  return (
    <Modal isOpen onClose={onFermer} title={e.idexercice ? `${libelleRang(e.rang)} : période et collèges` : 'Nouvel exercice'} subtitle="Cotisation annuelle par famille, familles et barème de chaque collège" maxWidth="1000px">
      <div className="rafas-grille-4">
        <Champ libelle="Date d'effet" requis><input type="date" className="form-control" value={e.date_effet || ''} onChange={champ('date_effet')} /></Champ>
        <Champ libelle="Date d'échéance" requis><input type="date" className="form-control" value={e.date_echeance || ''} onChange={champ('date_echeance')} /></Champ>
        <Champ libelle="Date de signature"><input type="date" className="form-control" value={e.date_signature || ''} onChange={champ('date_signature')} /></Champ>
        <Champ libelle="Honoraires du gestionnaire (%)"><input className="form-control rafas-nombre" value={e.taux_honoraires ?? ''} onChange={champ('taux_honoraires', nombre)} /></Champ>
        <Champ libelle="Commission du cabinet (%)"><input className="form-control rafas-nombre" value={e.taux_commission ?? ''} onChange={champ('taux_commission', nombre)} /></Champ>
        <Champ libelle="Provision demandée (mois)"><input className="form-control rafas-nombre" value={e.mois_provision ?? ''} onChange={champ('mois_provision', nombre)} /></Champ>
        <Champ libelle="Alerte du fonds (mois)"><input className="form-control rafas-nombre" value={e.seuil_alerte_mois ?? ''} onChange={champ('seuil_alerte_mois', nombre)} /></Champ>
      </div>
      <h3 className="rafas-sous-titre">Collèges</h3>
      <EditeurColleges colleges={e.colleges} onChange={(colleges) => setE({ ...e, colleges })} familiesReelles={familiesReelles} />
      <div className="rafas-recap-ligne">
        <span>{`Cotisations ${francs(b.Cotisations)}`}</span><span>{`Honoraires ${francs(b.Honoraires)}`}</span>
        <span>{`Commission ${francs(b.Commission)}`}</span><strong>{`Enveloppe des sinistres ${francs(b.Enveloppe)}`}</strong>
      </div>
      <div className="rafas-pied-assistant">
        <button type="button" className="btn btn-secondary" onClick={onFermer}>Annuler</button>
        <button type="button" className="btn btn-primary rafas-bouton" disabled={envoi} onClick={enregistrer}>{envoi ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Enregistrer</button>
      </div>
    </Modal>
  );
};

const OngletConvention = ({ id, convention, onModifie }) => {
  const { success, error: toastError } = useToast();
  const [edition, setEdition] = useState(null);
  const [exercice, setExercice] = useState(null);
  const [bareme, setBareme] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const peut = aLeDroit('rafas.manage');
  const c = convention.Convention;
  const familles = convention.Fonds ? Object.fromEntries(convention.Fonds.Colleges.filter((x) => x.FamillesReelles !== null).map((x) => [x.Code, x.FamillesReelles])) : null;

  const executer = async (fonction, message) => {
    setEnvoi(true);
    try {
      const r = await fonction();
      onModifie(r);
      success(message);
      return true;
    } catch (err) {
      toastError(messageErreurApi(err));
      return false;
    } finally {
      setEnvoi(false);
    }
  };
  const renouveler = async () => {
    const dernier = convention.Exercices[convention.Exercices.length - 1];
    const effectif = convention.Fonds?.BudgetReel;
    const choix = await confirmer({
      titre: `Avenant n°${dernier.rang + 1} de renouvellement`,
      message: `Nouvel exercice de 12 mois à la suite du ${dateFr(dernier.date_echeance)}, avec les mêmes collèges, cotisations et barèmes.`,
      consequences: effectif ? `Familles reprises de l'effectif du gestionnaire (${entier(convention.Fonds.Colleges.reduce((s, x) => s + (x.FamillesReelles || 0), 0))} familles) ; modifiables ensuite.`
        : "Familles de l'exercice précédent reprises ; modifiables ensuite.",
      confirmer: 'Renouveler',
    });
    if (choix) executer(() => rafasApi.renouveler(id, effectif ? 'effectif' : 'convention'), 'Avenant de renouvellement créé.');
  };
  const supprimer = async (e) => {
    if (await confirmer({ titre: 'Supprimer cet exercice', message: `${libelleRang(e.rang)} ${periode(e)}`, confirmer: 'Supprimer', ton: 'danger' })) {
      executer(() => rafasApi.supprimerExercice(id, e.idexercice), 'Exercice supprimé.');
    }
  };
  const enregistrerConvention = () => executer(() => rafasApi.modifier(id, edition), 'Convention enregistrée.').then((ok) => ok && setEdition(null));

  return (
    <div className="cs-pile">
      <Carte titre="Convention" sousTitre="Souscripteur, gestionnaire, couverture et règles de la famille."
        actions={peut && (edition ? (
          <>
            <button type="button" className="btn btn-secondary rafas-bouton" onClick={() => setEdition(null)}><X size={15} /> Annuler</button>
            <button type="button" className="btn btn-primary rafas-bouton" disabled={envoi} onClick={enregistrerConvention}><Check size={15} /> Enregistrer</button>
          </>
        ) : <button type="button" className="btn btn-secondary rafas-bouton" onClick={() => setEdition({ ...c })}><Pencil size={15} /> Modifier</button>)}>
        {edition ? (
          <div className="rafas-grille-4">
            {CHAMPS.map(([cle, libelle, type]) => (
              <Champ key={cle} libelle={libelle}>
                <input className={`form-control${type === 'nombre' ? ' rafas-nombre' : ''}`} value={edition[cle] ?? ''} onChange={(e) => setEdition({ ...edition, [cle]: type === 'nombre' ? nombre(e.target.value) : e.target.value })} />
              </Champ>
            ))}
            <Champ libelle="Statut">
              <select className="form-control" value={edition.statut} onChange={(e) => setEdition({ ...edition, statut: e.target.value })}>
                <option value="EN_VIGUEUR">En vigueur</option><option value="RESILIEE">Résiliée</option>
              </select>
            </Champ>
            <Champ libelle="Observations" large><textarea className="form-control" rows={2} value={edition.observations || ''} onChange={(e) => setEdition({ ...edition, observations: e.target.value })} /></Champ>
          </div>
        ) : (
          <dl className="cs-chiffres-cles rafas-fiche">
            {CHAMPS.map(([cle, libelle]) => <div key={cle}><dt>{libelle}</dt><dd>{c[cle] === '' || c[cle] === null ? '-' : String(c[cle])}</dd></div>)}
            {convention.Client && <div><dt>Client du portefeuille</dt><dd>{convention.Client.nom}</dd></div>}
          </dl>
        )}
      </Carte>

      <Carte titre="Exercices" sousTitre="Convention de base puis avenants de renouvellement : une période de 12 mois, tacitement reconduite."
        actions={peut && <>
          <button type="button" className="btn btn-secondary rafas-bouton" onClick={() => setExercice({ rang: null, date_effet: '', date_echeance: '', taux_honoraires: 8.5, taux_commission: 6.5, mois_provision: 3, seuil_alerte_mois: 1, colleges: convention.Exercices.length ? convention.Exercices[convention.Exercices.length - 1].colleges : [] })}>
            <CalendarPlus size={15} /> Exercice antérieur
          </button>
          <button type="button" className="btn btn-primary rafas-bouton" disabled={envoi} onClick={renouveler}><RefreshCw size={15} /> Renouveler</button>
        </>}>
        <ol className="rafas-frise">
          {[...convention.Exercices].reverse().map((e) => (
            <li key={e.idexercice} className={e.idexercice === convention.ExerciceCourant ? 'courant' : ''}>
              <div className="rafas-frise-tete">
                <div>
                  <strong>{libelleRang(e.rang)}</strong>
                  <span>{periode(e)}</span>
                </div>
                <div className="rafas-actions">
                  {e.idexercice === convention.ExerciceCourant && <Badge ton="info">En cours</Badge>}
                  <button type="button" className="rafas-icone-bouton" title="Imprimer les conditions particulières" onClick={() => imprimerConditions(c, e)}><Printer size={15} /></button>
                  {peut && <button type="button" className="rafas-icone-bouton" title="Modifier" onClick={() => setExercice(e)}><Pencil size={15} /></button>}
                  {peut && convention.Exercices.length > 1 && <button type="button" className="rafas-icone-bouton danger" title="Supprimer" onClick={() => supprimer(e)}><Trash2 size={15} /></button>}
                </div>
              </div>
              <div className="rafas-frise-chiffres">
                <span>{`Cotisations ${francs(e.budget.Cotisations)}`}</span>
                <span>{`Honoraires ${taux(e.taux_honoraires)} : ${francs(e.budget.Honoraires)}`}</span>
                <span>{`Commission ${taux(e.taux_commission)} : ${francs(e.budget.Commission)}`}</span>
                <span>{`Enveloppe ${francs(e.budget.Enveloppe)}`}</span>
              </div>
              <div className="table-wrapper rafas-tableau compact">
                <table className="data-table">
                  <thead><tr><th>Collège</th><th>Catégorie</th><th className="cs-nombre">Cotisation par famille</th><th className="cs-nombre">Familles</th><th className="cs-nombre">Cotisations</th><th className="cs-nombre">Plafond annuel</th><th>Barème</th></tr></thead>
                  <tbody>{e.colleges.map((x) => (
                    <tr key={x.code}>
                      <td>{x.libelle}</td><td>{x.categorie}</td><td className="cs-nombre">{francs(x.cotisation)}</td><td className="cs-nombre">{entier(x.familles)}</td>
                      <td className="cs-nombre">{francs(x.cotisation * x.familles)}</td><td className="cs-nombre">{x.plafond_famille ? francs(x.plafond_famille) : '-'}</td>
                      <td><button type="button" className="btn btn-link" style={{ padding: 0 }} onClick={() => setBareme(x)}><ListChecks size={14} style={{ verticalAlign: -2 }} /> {`${x.bareme.length} lignes`}</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </li>
          ))}
        </ol>
      </Carte>

      {exercice && <EditeurExercice exercice={exercice} convention={id} familiesReelles={familles} onFermer={() => setExercice(null)} onEnregistre={(r) => { setExercice(null); onModifie(r); }} />}
      <EditeurBareme college={bareme} lecture onFermer={() => setBareme(null)} onChange={() => {}} />
    </div>
  );
};

export default OngletConvention;
