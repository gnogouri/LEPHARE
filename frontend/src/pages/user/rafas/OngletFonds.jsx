import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Check, HandCoins, Loader2, Plus, Printer, ReceiptText, Trash2, Undo2, Wallet } from 'lucide-react';
import { rafasApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { aLeDroit } from '../../../utils/droits';
import { confirmer } from '../../../utils/dialogue';
import { messageErreurApi } from '../../../utils/financeUtils';
import { imprimerAppel, imprimerFacture } from '../../../utils/impressionsRafas';
import Modal from '../../../components/common/Modal';
import { Cadre, Courbes } from '../sante/consommations/graphiques';
import { Badge, Carte, Champ, Tableau, Tuile, dateFr, entier, francs, francsCourts, libelleRang, nombre, pct, periode, taux as tauxFr } from './rafasCommun';

/* Fonds du régime d'un exercice : budget (familles de la convention et effectif du gestionnaire), dépenses remboursées, appels de fonds et
   versements du souscripteur, solde et appel conseillé ; honoraires du gestionnaire et commission du cabinet (chiffre d'affaires). */

const MODES = [['VIREMENT', 'Virement'], ['CHEQUE', 'Chèque'], ['ESPECES', 'Espèces'], ['MOBILE', 'Mobile money'], ['COMPENSATION', 'Compensation']];
const libelleMode = (m) => (MODES.find((x) => x[0] === m) || [m, m || '-'])[1];
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const joursEntre = (du, au) => Math.round((new Date(`${au}T00:00:00`) - new Date(`${du}T00:00:00`)) / 86400000) + 1;

const FormulaireAppel = ({ fonds, ouvert, onFermer, onValider }) => {
  const [d, setD] = useState({});
  useEffect(() => {
    if (ouvert) setD({ date_appel: aujourdhui(), montant: fonds.AppelConseille || '', objet: fonds.Appels.length ? 'Réapprovisionnement du fonds' : 'Provision initiale pour dépenses de santé', date_limite: '' });
  }, [ouvert, fonds]);
  return (
    <Modal isOpen={ouvert} onClose={onFermer} title="Appel de fonds au souscripteur" subtitle="Provision mise à la disposition du cabinet pour faire face aux dépenses de santé">
      <div className="rafas-grille-2">
        <Champ libelle="Date de l'appel" requis><input type="date" className="form-control" value={d.date_appel || ''} onChange={(e) => setD({ ...d, date_appel: e.target.value })} /></Champ>
        <Champ libelle="À verser au plus tard"><input type="date" className="form-control" value={d.date_limite || ''} onChange={(e) => setD({ ...d, date_limite: e.target.value })} /></Champ>
        <Champ libelle="Montant (F)" requis aide={fonds.AppelConseille ? `Conseillé : ${francs(fonds.AppelConseille)} (${fonds.Exercice.mois_provision} mois de dépenses au rythme moyen, moins le solde)` : undefined}>
          <input className="form-control rafas-nombre" inputMode="numeric" value={d.montant ?? ''} onChange={(e) => setD({ ...d, montant: nombre(e.target.value) })} />
        </Champ>
        <Champ libelle="Objet"><input className="form-control" value={d.objet || ''} onChange={(e) => setD({ ...d, objet: e.target.value })} /></Champ>
      </div>
      <div className="rafas-pied-assistant">
        <button type="button" className="btn btn-secondary" onClick={onFermer}>Annuler</button>
        <button type="button" className="btn btn-primary rafas-bouton" disabled={!d.montant} onClick={() => onValider(d)}><Check size={15} /> Émettre l'appel</button>
      </div>
    </Modal>
  );
};

const FormulaireVersement = ({ fonds, appel, ouvert, onFermer, onValider }) => {
  const [d, setD] = useState({});
  useEffect(() => {
    if (ouvert) setD({ date_versement: aujourdhui(), montant: appel ? appel.reste : '', mode: 'VIREMENT', reference: '', banque: '', idappel: appel?.idappel || '' });
  }, [ouvert, appel]);
  const ouverts = fonds.Appels.filter((x) => x.reste > 0);
  return (
    <Modal isOpen={ouvert} onClose={onFermer} title="Versement du souscripteur" subtitle="Somme reçue pour alimenter le fonds du régime">
      <div className="rafas-grille-2">
        <Champ libelle="Appel de fonds réglé">
          <select className="form-control" value={d.idappel || ''} onChange={(e) => { const x = ouverts.find((o) => String(o.idappel) === e.target.value); setD({ ...d, idappel: e.target.value, montant: x ? x.reste : d.montant }); }}>
            <option value="">Sans appel de fonds</option>
            {ouverts.map((x) => <option key={x.idappel} value={x.idappel}>{`${x.numero} - reste ${francs(x.reste)}`}</option>)}
          </select>
        </Champ>
        <Champ libelle="Date du versement" requis><input type="date" className="form-control" value={d.date_versement || ''} onChange={(e) => setD({ ...d, date_versement: e.target.value })} /></Champ>
        <Champ libelle="Montant (F)" requis><input className="form-control rafas-nombre" inputMode="numeric" value={d.montant ?? ''} onChange={(e) => setD({ ...d, montant: nombre(e.target.value) })} /></Champ>
        <Champ libelle="Mode"><select className="form-control" value={d.mode} onChange={(e) => setD({ ...d, mode: e.target.value })}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Champ>
        <Champ libelle="Référence"><input className="form-control" value={d.reference || ''} onChange={(e) => setD({ ...d, reference: e.target.value })} placeholder="N° de virement ou de chèque" /></Champ>
        <Champ libelle="Banque"><input className="form-control" value={d.banque || ''} onChange={(e) => setD({ ...d, banque: e.target.value })} /></Champ>
      </div>
      <div className="rafas-pied-assistant">
        <button type="button" className="btn btn-secondary" onClick={onFermer}>Annuler</button>
        <button type="button" className="btn btn-primary rafas-bouton" disabled={!d.montant || !d.date_versement} onClick={() => onValider({ ...d, idappel: d.idappel || null })}><Check size={15} /> Enregistrer</button>
      </div>
    </Modal>
  );
};

const FormulaireFacture = ({ fonds, beneficiaire, ouvert, onFermer, onValider }) => {
  const [d, setD] = useState({});
  const ex = fonds.Exercice;
  const taux = Number(beneficiaire === 'COURTIER' ? ex.taux_commission : ex.taux_honoraires);
  useEffect(() => {
    if (ouvert) setD({ periode_du: ex.date_effet, periode_au: ex.date_echeance, source: fonds.BudgetReel ? 'effectif' : 'convention', date_emission: aujourdhui(), numero: '', montant: null });
  }, [ouvert, ex, fonds.BudgetReel]);
  const cotisations = (d.source === 'effectif' ? fonds.BudgetReel : fonds.Budget)?.Cotisations || 0;
  const base = d.periode_du && d.periode_au ? Math.round((cotisations * joursEntre(d.periode_du, d.periode_au)) / fonds.JoursExercice) : 0;
  const calcule = Math.round((base * taux) / 100);
  const montant = d.montant === null || d.montant === undefined || d.montant === '' ? calcule : d.montant;
  return (
    <Modal isOpen={ouvert} onClose={onFermer} title={beneficiaire === 'COURTIER' ? 'Facture de commission du cabinet' : 'Honoraires du gestionnaire'}
      subtitle={beneficiaire === 'COURTIER' ? `${tauxFr(taux)} des cotisations : chiffre d'affaires du cabinet, compté au tableau de bord à la date d'émission` : `${tauxFr(taux)} des cotisations, réglés sur le fonds du régime`}>
      <div className="rafas-grille-2">
        <Champ libelle="Période du" requis><input type="date" className="form-control" value={d.periode_du || ''} onChange={(e) => setD({ ...d, periode_du: e.target.value, montant: null })} /></Champ>
        <Champ libelle="au" requis><input type="date" className="form-control" value={d.periode_au || ''} onChange={(e) => setD({ ...d, periode_au: e.target.value, montant: null })} /></Champ>
        <Champ libelle="Familles retenues" aide="La convention calcule les honoraires sur l'ensemble des familles bénéficiant des prestations.">
          <select className="form-control" value={d.source} onChange={(e) => setD({ ...d, source: e.target.value, montant: null })}>
            <option value="convention">{`Familles de la convention : ${francs(fonds.Budget.Cotisations)} de cotisations`}</option>
            {fonds.BudgetReel && <option value="effectif">{`Familles de l'effectif du gestionnaire : ${francs(fonds.BudgetReel.Cotisations)}`}</option>}
          </select>
        </Champ>
        <Champ libelle="Date d'émission" requis><input type="date" className="form-control" value={d.date_emission || ''} onChange={(e) => setD({ ...d, date_emission: e.target.value })} /></Champ>
        <Champ libelle="Base : cotisations de la période" aide={`${entier(d.periode_du && d.periode_au ? joursEntre(d.periode_du, d.periode_au) : 0)} jours sur ${entier(fonds.JoursExercice)}`}>
          <input className="form-control rafas-nombre" value={francs(base)} readOnly />
        </Champ>
        <Champ libelle="Montant (F)" aide={`Calculé : ${francs(calcule)} ; modifiable`}>
          <input className="form-control rafas-nombre" inputMode="numeric" value={montant ?? ''} onChange={(e) => setD({ ...d, montant: nombre(e.target.value) })} />
        </Champ>
        {beneficiaire === 'GESTIONNAIRE' && <Champ libelle="N° de la facture du gestionnaire" aide="Vide : numéro attribué par LE PHARE."><input className="form-control" value={d.numero || ''} onChange={(e) => setD({ ...d, numero: e.target.value })} /></Champ>}
      </div>
      <div className="rafas-pied-assistant">
        <button type="button" className="btn btn-secondary" onClick={onFermer}>Annuler</button>
        <button type="button" className="btn btn-primary rafas-bouton" disabled={!d.periode_du || !d.periode_au}
          onClick={() => onValider({ beneficiaire, periode_du: d.periode_du, periode_au: d.periode_au, base, taux, montant, date_emission: d.date_emission, numero: d.numero })}>
          <Check size={15} /> Enregistrer
        </button>
      </div>
    </Modal>
  );
};

const FormulaireReglement = ({ facture, onFermer, onValider }) => {
  const [d, setD] = useState({});
  useEffect(() => { if (facture) setD({ date_paiement: aujourdhui(), mode: 'VIREMENT', reference: '' }); }, [facture]);
  return (
    <Modal isOpen={Boolean(facture)} onClose={onFermer} title={`Règlement de ${facture?.numero || ''}`} subtitle={facture ? francs(facture.montant) : ''}>
      <div className="rafas-grille-2">
        <Champ libelle="Date du règlement" requis><input type="date" className="form-control" value={d.date_paiement || ''} onChange={(e) => setD({ ...d, date_paiement: e.target.value })} /></Champ>
        <Champ libelle="Mode"><select className="form-control" value={d.mode} onChange={(e) => setD({ ...d, mode: e.target.value })}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Champ>
        <Champ libelle="Référence" large><input className="form-control" value={d.reference || ''} onChange={(e) => setD({ ...d, reference: e.target.value })} /></Champ>
      </div>
      <div className="rafas-pied-assistant">
        <button type="button" className="btn btn-secondary" onClick={onFermer}>Annuler</button>
        <button type="button" className="btn btn-primary rafas-bouton" disabled={!d.date_paiement} onClick={() => onValider(d)}><Check size={15} /> Enregistrer le règlement</button>
      </div>
    </Modal>
  );
};

const OngletFonds = ({ id, convention, onModifie }) => {
  const { success, error: toastError } = useToast();
  const [exercice, setExercice] = useState(convention.ExerciceCourant ? String(convention.ExerciceCourant) : '');
  const [fonds, setFonds] = useState(null);
  const [reel, setReel] = useState(true);
  const [fenetre, setFenetre] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const peut = aLeDroit('rafas.manage');
  const charger = useCallback(() => rafasApi.fonds(id, exercice).then(setFonds).catch((err) => toastError(messageErreurApi(err))), [id, exercice, toastError]);
  useEffect(() => { charger(); }, [charger]);

  const action = async (fonction, message) => {
    setEnvoi(true);
    try {
      const r = await fonction();
      setFonds((f) => ({ ...f, ...r }));
      setFenetre(null);
      if (message) success(message);
      onModifie?.();
      return r;
    } catch (err) {
      toastError(messageErreurApi(err));
      return null;
    } finally {
      setEnvoi(false);
    }
  };
  const supprimer = async (texte, fonction, message) => {
    if (await confirmer({ titre: 'Confirmer la suppression', message: texte, confirmer: 'Supprimer', ton: 'danger' })) action(fonction, message);
  };

  const serie = useMemo(() => (fonds ? fonds.Mensuel : []), [fonds]);
  if (!fonds) return <div className="rafas-chargement"><Loader2 size={22} className="spin" /> Situation du fonds…</div>;
  const ex = fonds.Exercice;
  const budget = reel && fonds.BudgetReel ? fonds.BudgetReel : fonds.Budget;
  const taux = reel && fonds.BudgetReel ? fonds.TauxEnveloppeReel : fonds.TauxEnveloppe;
  const conv = convention.Convention;
  const exerciceComplet = convention.Exercices.find((e) => e.idexercice === ex.idexercice);
  const factures = (b) => fonds.Honoraires.filter((h) => h.beneficiaire === b);
  const colonnesFactures = [
    { cle: 'numero', libelle: 'Facture', rendu: (h) => <span className="rafas-facture"><strong>{h.numero}</strong><span>{`émise le ${dateFr(h.date_emission)}`}</span></span> },
    { cle: 'periode', libelle: 'Période', rendu: (h) => <span className="rafas-facture"><span>{`du ${dateFr(h.periode_du)}`}</span><span>{`au ${dateFr(h.periode_au)}`}</span></span> },
    { cle: 'montant', libelle: 'Montant', nombre: true, rendu: (h) => <span className="rafas-facture droite"><strong>{francs(h.montant)}</strong><span>{`sur ${francsCourts(h.base)}`}</span></span> },
    { cle: 'statut', libelle: 'Règlement', rendu: (h) => (h.date_paiement ? <Badge ton="bon">{`Réglé le ${dateFr(h.date_paiement)}`}</Badge> : <Badge ton="attention">À régler</Badge>) },
    { cle: 'actions', libelle: '', rendu: (h) => (
      <div className="rafas-actions-ligne">
        <button type="button" className="rafas-icone-bouton" title="Imprimer" onClick={() => imprimerFacture(conv, exerciceComplet || ex, h)}><Printer size={15} /></button>
        {peut && !h.date_paiement && <button type="button" className="rafas-icone-bouton" title="Enregistrer le règlement" onClick={() => setFenetre({ type: 'reglement', facture: h })}><Banknote size={15} /></button>}
        {peut && h.date_paiement && <button type="button" className="rafas-icone-bouton" title="Annuler le règlement" onClick={() => action(() => rafasApi.reglerHonoraire(h.idhonoraire, {}), 'Règlement annulé.')}><Undo2 size={15} /></button>}
        {peut && !h.date_paiement && <button type="button" className="rafas-icone-bouton danger" title="Supprimer" onClick={() => supprimer(`Supprimer ${h.numero} ?`, () => rafasApi.supprimerHonoraire(h.idhonoraire), 'Facture supprimée.')}><Trash2 size={15} /></button>}
      </div>
    ) },
  ];
  return (
    <div className="cs-pile">
      <div className="glass-panel cs-filtres">
        <label className="cs-filtre large">
          <span>Exercice</span>
          <select className="form-control" value={String(ex.idexercice)} onChange={(e) => setExercice(e.target.value)}>
            {fonds.ExercicesListe.map((e) => <option key={e.idexercice} value={e.idexercice}>{`${libelleRang(e.rang)} ${periode(e)}`}</option>)}
          </select>
        </label>
        {fonds.BudgetReel && (
          <label className="cs-filtre en-ligne">
            <input type="checkbox" checked={reel} onChange={(e) => setReel(e.target.checked)} />
            <span>{`Budget sur l'effectif du gestionnaire du ${dateFr(fonds.SituationEffectif)}`}</span>
          </label>
        )}
        <p className="cs-filtres-note">{`Échéance le ${dateFr(fonds.Echeance)} ; préavis de dénonciation avant le ${dateFr(fonds.Preavis)}.`}</p>
      </div>

      <div className="cs-une">
        <Carte className={`cs-heros rafas-solde ${fonds.Solde < 0 ? 'negatif' : ''}`}>
          <div className="cs-heros-libelle">Solde du fonds</div>
          <div className={`cs-heros-valeur${fonds.Solde < 0 ? ' rafas-negatif' : ''}`}>{francsCourts(fonds.Solde)}</div>
          <div className="cs-heros-detail">{`Versements ${francs(fonds.Versements)} - dépenses ${francs(fonds.Depenses)} - honoraires réglés ${francs(fonds.HonorairesRegles.GESTIONNAIRE + fonds.HonorairesRegles.COURTIER)}`}</div>
          {fonds.Alerte ? (
            <div className="rafas-alerte">
              <Wallet size={18} aria-hidden="true" />
              <div>
                <strong>{`Appel de fonds conseillé : ${francs(fonds.AppelConseille)}`}</strong>
                <p>{fonds.Seuil ? `Le solde est sous le seuil d'alerte de ${francs(fonds.Seuil)} (${ex.seuil_alerte_mois} mois de dépenses au rythme moyen de ${francs(fonds.Rythme)}).` : 'Des dépenses sont remboursées sans versement du souscripteur sur cet exercice.'}</p>
              </div>
              {peut && <button type="button" className="btn btn-primary rafas-bouton" onClick={() => setFenetre({ type: 'appel' })}><HandCoins size={15} /> Préparer l'appel</button>}
            </div>
          ) : <Badge ton="bon">Fonds suffisant au rythme actuel</Badge>}
          {fonds.BesoinEcheance !== null && <p className="cs-note">{`Besoin estimé jusqu'à l'échéance : ${francs(fonds.BesoinEcheance)} (${fonds.MoisRestants} mois de dépenses au rythme moyen et honoraires restant dus).`}</p>}
        </Carte>
        <div className="cs-tuiles">
          <Tuile libelle="Cotisations de l'exercice" valeur={francsCourts(budget.Cotisations)} detail={reel && fonds.BudgetReel ? "Sur l'effectif du gestionnaire" : 'Familles de la convention'} />
          <Tuile libelle="Enveloppe des sinistres" valeur={francsCourts(budget.Enveloppe)} detail={`${pct(taux, 0)} consommés`} />
          <Tuile libelle="Projection à l'échéance" valeur={francsCourts(fonds.Projection)} detail={`Rythme ${francsCourts(fonds.Rythme)} par mois sur ${fonds.MoisAvecDonnees} mois`} />
          <Tuile libelle={`Honoraires du gestionnaire, ${tauxFr(ex.taux_honoraires)}`} valeur={francsCourts(budget.Honoraires)} detail={`Émis ${francsCourts(fonds.HonorairesEmis.GESTIONNAIRE)}, réglés ${francsCourts(fonds.HonorairesRegles.GESTIONNAIRE)}`} />
          <Tuile libelle={`Commission du cabinet, ${tauxFr(ex.taux_commission)}`} valeur={francsCourts(budget.Commission)} ton="accent" detail={`Facturée ${francsCourts(fonds.HonorairesEmis.COURTIER)}, encaissée ${francsCourts(fonds.HonorairesRegles.COURTIER)}`} />
          <Tuile libelle="Versements du souscripteur" valeur={francsCourts(fonds.Versements)} detail={`${fonds.Appels.length} appel${fonds.Appels.length > 1 ? 's' : ''} de fonds`} />
        </div>
      </div>

      <div className="cs-deux">
        <Carte titre="Dépenses cumulées et enveloppe" sousTitre="Dépenses remboursées cumulées mois par mois, face à l'enveloppe des sinistres répartie sur l'exercice.">
          <Cadre legende={[{ libelle: 'Dépenses cumulées', couleur: 'var(--cs-viz-1)', forme: 'ligne' }, { libelle: 'Enveloppe au prorata', couleur: 'var(--cs-attenue)', forme: 'repere' }]}
            tableau={{ entetes: ['Mois', 'Dépenses', 'Cumul', 'Enveloppe au prorata'], lignes: serie.map((m) => [m.Libelle, francs(m.Depenses), francs(m.Cumul), francs(m.Prorata)]) }}>
            <Courbes etiquettes={serie.map((m) => ({ cle: m.Mois, libelle: m.Libelle, libelleCourt: m.LibelleCourt, libelleLong: m.Libelle }))} libelleAria="Dépenses cumulées et enveloppe au prorata"
              series={[{ cle: 'cumul', libelle: 'Dépenses cumulées', valeurs: serie.map((m) => m.Cumul), couleur: 'var(--cs-viz-1)', style: 'plein', aire: true },
                { cle: 'prorata', libelle: 'Enveloppe au prorata', valeurs: serie.map((m) => m.Prorata), couleur: 'var(--cs-attenue)', style: 'repere', libelleFin: 'enveloppe' }]} />
          </Cadre>
        </Carte>
        <Carte titre="Cotisations par collège" sousTitre="Familles de la convention et familles de l'effectif du gestionnaire (adhérents distincts, sortis exclus).">
          <Tableau compact colonnes={[
            { cle: 'Libelle', libelle: 'Collège' },
            { cle: 'Cotisation', libelle: 'Par famille', nombre: true, rendu: (c) => francs(c.Cotisation) },
            { cle: 'Familles', libelle: 'Familles : convention', nombre: true },
            { cle: 'FamillesReelles', libelle: 'effectif', nombre: true, rendu: (c) => (c.FamillesReelles === null ? '-' : entier(c.FamillesReelles)) },
            { cle: 'Budget', libelle: 'Cotisations', nombre: true, rendu: (c) => francs(reel && c.BudgetReel !== null ? c.BudgetReel : c.Budget) },
          ]} lignes={fonds.Colleges}
            pied={{ Libelle: 'Total', Familles: fonds.Colleges.reduce((s, c) => s + c.Familles, 0), FamillesReelles: fonds.BudgetReel ? fonds.Colleges.reduce((s, c) => s + (c.FamillesReelles || 0), 0) : null, Cotisation: null, Budget: budget.Cotisations, BudgetReel: budget.Cotisations }} />
          {fonds.FamillesNonRattachees > 0 && <p className="cs-note">{`${entier(fonds.FamillesNonRattachees)} familles de l'effectif relèvent de collèges du gestionnaire non rattachés : onglet Fichiers du gestionnaire.`}</p>}
        </Carte>
      </div>

      <Carte titre="Appels de fonds et versements" sousTitre="La provision demandée au souscripteur en début d'année, puis ajustée selon les dépenses."
        actions={peut && <>
          <button type="button" className="btn btn-secondary rafas-bouton" onClick={() => setFenetre({ type: 'versement' })}><Banknote size={15} /> Versement reçu</button>
          <button type="button" className="btn btn-primary rafas-bouton" onClick={() => setFenetre({ type: 'appel' })}><Plus size={15} /> Appel de fonds</button>
        </>}>
        <Tableau vide="Aucun appel de fonds sur cet exercice." colonnes={[
          { cle: 'numero', libelle: 'Numéro' }, { cle: 'date_appel', libelle: 'Date', rendu: (x) => dateFr(x.date_appel) }, { cle: 'objet', libelle: 'Objet' },
          { cle: 'montant', libelle: 'Montant', nombre: true, rendu: (x) => francs(x.montant) }, { cle: 'verse', libelle: 'Versé', nombre: true, rendu: (x) => francs(x.verse) },
          { cle: 'reste', libelle: 'Reste', nombre: true, rendu: (x) => (x.reste > 0 ? <strong>{francs(x.reste)}</strong> : <Badge ton="bon">Soldé</Badge>) },
          { cle: 'actions', libelle: '', rendu: (x) => (
            <div className="rafas-actions-ligne">
              <button type="button" className="rafas-icone-bouton" title="Imprimer la lettre d'appel" onClick={() => imprimerAppel(conv, fonds, x)}><Printer size={15} /></button>
              {peut && x.reste > 0 && <button type="button" className="rafas-icone-bouton" title="Enregistrer le versement" onClick={() => setFenetre({ type: 'versement', appel: x })}><Banknote size={15} /></button>}
              {peut && !Number(x.verse) && <button type="button" className="rafas-icone-bouton danger" title="Supprimer" onClick={() => supprimer(`Supprimer l'appel ${x.numero} ?`, () => rafasApi.supprimerAppel(x.idappel), 'Appel de fonds supprimé.')}><Trash2 size={15} /></button>}
            </div>
          ) },
        ]} lignes={fonds.Appels} />
        {fonds.ListeVersements.length > 0 && (
          <>
            <h3 className="rafas-sous-titre">Versements reçus</h3>
            <Tableau compact colonnes={[
              { cle: 'date_versement', libelle: 'Date', rendu: (v) => dateFr(v.date_versement) }, { cle: 'montant', libelle: 'Montant', nombre: true, rendu: (v) => francs(v.montant) },
              { cle: 'mode', libelle: 'Mode', rendu: (v) => libelleMode(v.mode) }, { cle: 'reference', libelle: 'Référence' }, { cle: 'banque', libelle: 'Banque' },
              { cle: 'numero_appel', libelle: 'Appel', rendu: (v) => v.numero_appel || '-' },
              { cle: 'actions', libelle: '', rendu: (v) => peut && <button type="button" className="rafas-icone-bouton danger" title="Supprimer" onClick={() => supprimer('Supprimer ce versement ?', () => rafasApi.supprimerVersement(v.idversement), 'Versement supprimé.')}><Trash2 size={15} /></button> },
            ]} lignes={fonds.ListeVersements} />
          </>
        )}
      </Carte>

      <div className="cs-deux">
        <Carte titre={`Commission du cabinet, ${tauxFr(ex.taux_commission)}`} sousTitre="Chiffre d'affaires : comptée au tableau de bord de la direction à la date d'émission, perçue à la date de règlement."
          actions={peut && <button type="button" className="btn btn-primary rafas-bouton" onClick={() => setFenetre({ type: 'facture', beneficiaire: 'COURTIER' })}><ReceiptText size={15} /> Facturer</button>}>
          <Tableau vide="Aucune facture de commission sur cet exercice." colonnes={colonnesFactures} lignes={factures('COURTIER')} />
        </Carte>
        <Carte titre={`Honoraires du gestionnaire, ${tauxFr(ex.taux_honoraires)}`} sousTitre={`${conv.gestionnaire} : honoraires de gestion réglés sur le fonds du régime.`}
          actions={peut && <button type="button" className="btn btn-secondary rafas-bouton" onClick={() => setFenetre({ type: 'facture', beneficiaire: 'GESTIONNAIRE' })}><Plus size={15} /> Enregistrer</button>}>
          <Tableau vide="Aucuns honoraires enregistrés sur cet exercice." colonnes={colonnesFactures} lignes={factures('GESTIONNAIRE')} />
        </Carte>
      </div>

      <FormulaireAppel fonds={fonds} ouvert={fenetre?.type === 'appel'} onFermer={() => setFenetre(null)}
        onValider={async (d) => { const r = await action(() => rafasApi.creerAppel(ex.idexercice, d), 'Appel de fonds émis.'); if (r?.Numero) { const appel = r.Appels.find((x) => x.idappel === r.IdAppel); if (appel) imprimerAppel(conv, r, appel); } }} />
      <FormulaireVersement fonds={fonds} appel={fenetre?.appel} ouvert={fenetre?.type === 'versement'} onFermer={() => setFenetre(null)}
        onValider={(d) => action(() => rafasApi.creerVersement(ex.idexercice, d), 'Versement enregistré.')} />
      <FormulaireFacture fonds={fonds} beneficiaire={fenetre?.beneficiaire} ouvert={fenetre?.type === 'facture'} onFermer={() => setFenetre(null)}
        onValider={(d) => action(() => rafasApi.creerHonoraire(ex.idexercice, d), d.beneficiaire === 'COURTIER' ? 'Facture de commission enregistrée.' : 'Honoraires enregistrés.')} />
      <FormulaireReglement facture={fenetre?.type === 'reglement' ? fenetre.facture : null} onFermer={() => setFenetre(null)}
        onValider={(d) => action(() => rafasApi.reglerHonoraire(fenetre.facture.idhonoraire, d), 'Règlement enregistré.')} />
      {envoi && <div className="rafas-voile" aria-live="polite"><Loader2 size={22} className="spin" /></div>}
    </div>
  );
};

export default OngletFonds;
