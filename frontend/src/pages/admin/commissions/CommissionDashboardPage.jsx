import React, { useEffect, useMemo, useState } from 'react';
import { saisirTexte } from '../../../utils/dialogue';
import { Ban, CheckCircle2, ClipboardList, Coins, FileSpreadsheet, FileText, Loader2, Mail, Printer, RefreshCw, Send, Wallet } from 'lucide-react';
import { financeApi, settingsApi } from '../../../api/endpoints';
import { Modal } from '../../../components/common/Modal';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { useToast } from '../../../context/ToastContext';
import { exportToExcel, exportToPdf } from '../../../utils/exportUtils';
import { aujourdhui, bornesMois, dateFr, fcfa, messageErreurApi } from '../../../utils/financeUtils';
import { imprimerCourrierReclamation, imprimerEtatRecapitulatifCommissions, imprimerRecapitulatifReclamation } from '../../../utils/impressionsFinance';
import { documentsCompagnie } from '../../../utils/parametrage';
import { trierParLibelle } from '../../../utils/sortUtils';

// Commissions du cabinet (son chiffre d'affaires, pas les émissions). Après le reversement de la
// prime entière à la compagnie, les quittances reversées sont cochées dans un bordereau
// récapitulatif (en général mensuel) qui réclame la commission ; l'assureur la règle par chèque
// ou virement (encaissement imputé sur les lignes du bordereau). États des commissions payées et
// non payées, état récapitulatif (payées / en attente de paiement, par compagnie et par mois, imprimable
// et en Excel). Les apporteurs ont leur module : pages/admin/apporteurs/ApporteursPage.jsx.
const COULEURS = { A_RECLAMER: 'blue', RECLAMEE: 'amber', PARTIELLE: 'amber', PAYEE: 'emerald', EMISE: 'amber', ANNULEE: 'rose' };
const FILTRES_STATUT = [
  ['A_RECLAMER', 'À réclamer'], ['NON_PAYEES', 'Non payées'], ['PAYEES', 'Payées'], ['', 'Toutes les quittances reversées'],
];

const Onglet = ({ actif, onClick, icone: Icone, children }) => (
  <button type="button" role="tab" aria-selected={actif} className={`btn ${actif ? 'btn-primary' : 'btn-secondary'}`}
    onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
    <Icone size={15} /> {children}
  </button>
);

const Carte = ({ libelle, valeur, detail, couleur = 'var(--text-primary)' }) => (
  <div className="glass-panel" style={{ padding: '1rem 1.1rem' }}>
    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-muted)' }}>{libelle}</div>
    <div style={{ fontSize: '1.3rem', fontWeight: 900, color: couleur, marginTop: '0.2rem' }}>{valeur}</div>
    {detail && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{detail}</div>}
  </div>
);

// ------------------------------------------------------------------ état récapitulatif
const DROITE = { textAlign: 'right' };
const libelleMois = (cle) => (cle ? new Date(`${cle}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '-');
const pourcent = (v) => `${Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
// Ancienneté d'une commission en attente : au-delà de 30 jours à relancer, au-delà de 60 jours en retard
const Anciennete = ({ jours }) => (jours === null || jours === undefined ? null
  : <StatusBadge label={`${jours} j`} color={jours > 60 ? 'rose' : jours > 30 ? 'amber' : 'blue'} />);

const SyntheseCommissions = ({ libelle, groupes, total }) => (
  <div className="table-wrapper">
    <table className="data-table">
      <thead>
        <tr>
          <th>{libelle}</th><th style={DROITE}>Quittances</th><th style={DROITE}>Primes reversées</th><th style={DROITE}>Commissions dues</th>
          <th style={DROITE}>Payées</th><th style={DROITE}>En attente : réclamées</th><th style={DROITE}>En attente : non réclamées</th>
          <th style={DROITE}>Total en attente</th><th style={DROITE}>Recouvré</th>
        </tr>
      </thead>
      <tbody>
        {[...groupes, ['total', 'TOTAL', total]].map(([cle, etiquette, g]) => (
          <tr key={cle} style={cle === 'total' ? { fontWeight: 800, background: 'var(--bg-subtle, transparent)' } : undefined}>
            <td style={{ fontWeight: 700, textTransform: 'capitalize' }}>{etiquette}</td><td style={DROITE}>{g.Nombre}</td>
            <td style={DROITE}>{fcfa(g.PrimesReversees)}</td><td style={{ ...DROITE, fontWeight: 700 }}>{fcfa(g.CommissionDue)}</td>
            <td style={{ ...DROITE, color: 'var(--accent-emerald)', fontWeight: 700 }}>{fcfa(g.CommissionPayee)}</td>
            <td style={DROITE}>{fcfa(g.EnAttenteReclamee)}</td><td style={DROITE}>{fcfa(g.EnAttenteAReclamer)}</td>
            <td style={{ ...DROITE, color: 'var(--accent-amber)', fontWeight: 700 }}>{fcfa(g.EnAttente)}</td><td style={DROITE}>{pourcent(g.TauxRecouvrement)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Section = ({ titre, detail, children }) => (
  <div className="glass-panel" style={{ padding: '1rem 1.1rem' }}>
    <div style={{ fontWeight: 800, marginBottom: detail ? '0.15rem' : '0.5rem' }}>{titre}</div>
    {detail && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.6rem' }}>{detail}</div>}
    {children}
  </div>
);

const Vide = ({ children }) => <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', padding: '0.4rem 0' }}>{children}</div>;

const EtatRecapitulatif = ({ recap }) => {
  const t = recap.Total;
  const reglements = recap.Reglements || [];
  const reclamations = recap.Reclamations || [];
  const nonReclamees = recap.NonReclamees || [];
  const somme = (liste, cle) => liste.reduce((s, x) => s + (Number(x[cle]) || 0), 0);
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '0.75rem' }}>
        <Carte libelle="Commissions dues" valeur={`${fcfa(t.CommissionDue)} F`} detail={`${t.Nombre} quittance(s) - ${fcfa(t.PrimesReversees)} F de primes reversées`} />
        <Carte libelle="Commissions payées" valeur={`${fcfa(t.CommissionPayee)} F`} couleur="var(--accent-emerald)" detail={`Recouvré : ${pourcent(t.TauxRecouvrement)}`} />
        <Carte libelle="En attente : réclamées" valeur={`${fcfa(t.EnAttenteReclamee)} F`} couleur="var(--accent-amber)" detail={`${reclamations.length} bordereau(x) en attente du règlement de l'assureur`} />
        <Carte libelle="En attente : non réclamées" valeur={`${fcfa(t.EnAttenteAReclamer)} F`} couleur="var(--accent-amber)" detail="Bordereau récapitulatif à émettre" />
      </div>

      {recap.ParCompagnie.length > 1 && (
        <Section titre="Par compagnie">
          <SyntheseCommissions libelle="Compagnie" total={t} groupes={recap.ParCompagnie.map((g) => [g.IdCompagnie ?? g.Compagnie, g.Compagnie, g])} />
        </Section>
      )}
      {recap.ParMois.length > 0 && (
        <Section titre="Par mois de reversement">
          <SyntheseCommissions libelle="Mois" total={t} groupes={recap.ParMois.map((g) => [g.Mois, libelleMois(g.Mois), g])} />
        </Section>
      )}

      <Section titre="Commissions payées - règlements reçus des assureurs"
        detail="Montant de chaque règlement et part imputée sur les quittances de la période (leur total est celui des commissions payées).">
        {reglements.length ? (
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Compagnie</th><th>N° du règlement</th><th>Bordereau réclamé</th><th>Mode</th><th>N° chèque / virement</th><th>Banque</th><th style={DROITE}>Quittances</th><th style={DROITE}>Montant du règlement</th><th style={DROITE}>Commissions réglées</th></tr></thead>
              <tbody>
                {reglements.map((p) => (
                  <tr key={p.IdPaiement}>
                    <td>{dateFr(p.DatePaiement)}</td><td>{p.Compagnie}</td><td style={{ fontFamily: 'var(--font-mono)' }}>{p.Reference}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{p.Reclamation}</td><td>{p.Mode}</td><td>{p.ReferencePaiement}</td><td>{p.Banque}</td>
                    <td style={DROITE}>{p.Nombre}</td><td style={DROITE}>{fcfa(p.MontantReglement)}</td><td style={{ ...DROITE, fontWeight: 700 }}>{fcfa(p.Montant)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 800 }}><td colSpan={7}>TOTAL</td><td style={DROITE}>{somme(reglements, 'Nombre')}</td><td style={DROITE}>{fcfa(somme(reglements, 'MontantReglement'))}</td><td style={DROITE}>{fcfa(somme(reglements, 'Montant'))}</td></tr>
              </tbody>
            </table>
          </div>
        ) : <Vide>Aucun règlement de commission reçu pour ces quittances.</Vide>}
      </Section>

      <Section titre="En attente de paiement - commissions réclamées à l'assureur"
        detail="Bordereaux récapitulatifs émis dont le règlement n'est pas reçu en totalité ; ancienneté depuis leur émission.">
        {reclamations.length ? (
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>N° du bordereau</th><th>Compagnie</th><th>Émis le</th><th>Ancienneté</th><th style={DROITE}>Quittances</th><th style={DROITE}>Commissions réclamées</th><th style={DROITE}>Déjà réglé</th><th style={DROITE}>Reste dû</th></tr></thead>
              <tbody>
                {reclamations.map((rc) => (
                  <tr key={rc.IdReclamation}>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{rc.Reference}</td><td>{rc.Compagnie}</td><td>{dateFr(rc.DateEmission)}</td>
                    <td><Anciennete jours={rc.Anciennete} /></td><td style={DROITE}>{rc.Nombre}</td><td style={DROITE}>{fcfa(rc.CommissionReclamee)}</td>
                    <td style={DROITE}>{fcfa(rc.CommissionPayee)}</td><td style={{ ...DROITE, fontWeight: 700, color: 'var(--accent-amber)' }}>{fcfa(rc.Reste)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 800 }}><td colSpan={4}>TOTAL</td><td style={DROITE}>{somme(reclamations, 'Nombre')}</td><td style={DROITE}>{fcfa(somme(reclamations, 'CommissionReclamee'))}</td><td style={DROITE}>{fcfa(somme(reclamations, 'CommissionPayee'))}</td><td style={DROITE}>{fcfa(somme(reclamations, 'Reste'))}</td></tr>
              </tbody>
            </table>
          </div>
        ) : <Vide>Aucun bordereau de réclamation en attente de règlement.</Vide>}
      </Section>

      <Section titre="En attente de paiement - commissions non encore réclamées"
        detail="Primes reversées dont la commission n'est sur aucun bordereau récapitulatif : à réclamer depuis l'onglet « État des commissions ».">
        {nonReclamees.length ? (
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Compagnie</th><th>Plus ancien reversement</th><th>Ancienneté</th><th style={DROITE}>Quittances</th><th style={DROITE}>Montant à réclamer</th></tr></thead>
              <tbody>
                {nonReclamees.map((n) => (
                  <tr key={n.IdCompagnie ?? n.Compagnie}>
                    <td>{n.Compagnie}</td><td>{dateFr(n.PlusAncien)}</td><td><Anciennete jours={n.Anciennete} /></td>
                    <td style={DROITE}>{n.Nombre}</td><td style={{ ...DROITE, fontWeight: 700, color: 'var(--accent-amber)' }}>{fcfa(n.Montant)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 800 }}><td colSpan={3}>TOTAL</td><td style={DROITE}>{somme(nonReclamees, 'Nombre')}</td><td style={DROITE}>{fcfa(somme(nonReclamees, 'Montant'))}</td></tr>
              </tbody>
            </table>
          </div>
        ) : <Vide>Toutes les commissions dues ont été réclamées.</Vide>}
      </Section>
    </>
  );
};

// ------------------------------------------------------------------ règlement de l'assureur
const ReglementModal = ({ reclamation, banques, onClose, onEnregistre }) => {
  const { success, error: toastError } = useToast();
  const [saisie, setSaisie] = useState({});
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    if (reclamation) setSaisie({ DatePaiement: aujourdhui(), Mode: 'VIR', IdBanque: '', ReferencePaiement: '', Montant: reclamation.Reste, Notes: '' });
  }, [reclamation]);
  const champ = (cle) => (e) => setSaisie((s) => ({ ...s, [cle]: e.target.value }));

  const enregistrer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const resultat = await financeApi.encaisserCommission(reclamation.IdReclamation, saisie);
      success(`Règlement de ${fcfa(saisie.Montant)} F enregistré sur ${resultat.Reference} (${resultat.LibelleStatut}).`);
      onEnregistre(resultat);
    } catch (err) {
      toastError(`Règlement non enregistré : ${messageErreurApi(err)}`);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal isOpen={Boolean(reclamation)} onClose={onClose} size="medium" title="Encaissement de commission"
      subtitle={reclamation ? `${reclamation.Reference} - ${reclamation.Compagnie} - reste dû ${fcfa(reclamation.Reste)} F` : ''}>
      {reclamation && (
        <form onSubmit={enregistrer} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="rg-mode">Mode de règlement</label>
            <select id="rg-mode" className="form-control" value={saisie.Mode} onChange={champ('Mode')}>
              <option value="VIR">Virement</option>
              <option value="CHQ">Chèque</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="rg-date">Date du règlement</label>
            <input id="rg-date" type="date" className="form-control" required value={saisie.DatePaiement || ''} onChange={champ('DatePaiement')} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="rg-banque">Banque{saisie.Mode === 'CHQ' ? ' du chèque' : ''}</label>
            {/* Tout chèque porte sa banque (demande du 2026-10-21) */}
            <select id="rg-banque" className="form-control" required={saisie.Mode === 'CHQ'} value={saisie.IdBanque || ''} onChange={champ('IdBanque')}>
              <option value="">{saisie.Mode === 'CHQ' ? 'Choisir' : 'Facultatif'}</option>
              {banques.map((b) => <option key={b.idbanque} value={b.idbanque}>{b.libelle}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="rg-ref">{saisie.Mode === 'CHQ' ? 'N° du chèque' : 'Référence du virement'}</label>
            <input id="rg-ref" className="form-control" required maxLength={50} value={saisie.ReferencePaiement || ''} onChange={champ('ReferencePaiement')} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="rg-montant">Montant reçu (F)</label>
            <input id="rg-montant" type="number" className="form-control" required min={1} max={reclamation.Reste} step="1" value={saisie.Montant ?? ''} onChange={champ('Montant')} />
          </div>
          <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
            <label className="form-label" htmlFor="rg-notes">Observations</label>
            <input id="rg-notes" className="form-control" maxLength={500} value={saisie.Notes || ''} onChange={champ('Notes')} placeholder="Facultatif" />
          </div>
          <p style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
            Le montant est imputé sur les quittances du bordereau, dans l'ordre, sans dépasser la commission restant due.
          </p>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={envoi} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {envoi ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} Enregistrer le règlement
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};

// ------------------------------------------------------------------ détail d'un bordereau
const ReclamationModal = ({ reclamation, onClose, onRegler, onAnnuler }) => (
  <Modal isOpen={Boolean(reclamation)} onClose={onClose} size="large"
    title={reclamation ? `Bordereau récapitulatif ${reclamation.Reference}` : ''}
    subtitle={reclamation ? `${reclamation.Compagnie} - période du ${dateFr(reclamation.PeriodeDebut)} au ${dateFr(reclamation.PeriodeFin)} - ${reclamation.LibelleStatut}` : ''}>
    {reclamation && (
      <>
        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.88rem', marginBottom: '0.9rem' }}>
          <span>Primes reversées : <strong>{fcfa(reclamation.MontantPrimes)} F</strong></span>
          <span>Commissions réclamées : <strong>{fcfa(reclamation.MontantCommissions)} F</strong></span>
          <span>Réglé : <strong style={{ color: 'var(--accent-emerald)' }}>{fcfa(reclamation.MontantPaye)} F</strong></span>
          <span>Reste dû : <strong style={{ color: 'var(--accent-amber)' }}>{fcfa(reclamation.Reste)} F</strong></span>
        </div>
        <div className="table-wrapper" style={{ maxHeight: '40vh', overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>N° Police</th><th>Quittance</th><th>Client</th><th>Branche</th><th>Reversement</th>
                <th style={{ textAlign: 'right' }}>Prime reversée</th><th style={{ textAlign: 'right' }}>Commission due</th>
                <th style={{ textAlign: 'right' }}>Réglée</th><th style={{ textAlign: 'right' }}>Reste</th>
              </tr>
            </thead>
            <tbody>
              {(reclamation.Lignes || []).map((l) => (
                <tr key={l.IdDetailReversement}>
                  <td>{l.NumeroPolice}</td><td>{l.NumeroQuittance}</td><td>{l.Client}</td><td>{l.Branche}</td>
                  <td>{l.NumeroReversement} du {dateFr(l.DateReversement)}</td>
                  <td style={{ textAlign: 'right' }}>{fcfa(l.MontantReverse)}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fcfa(l.CommissionDue)}</td>
                  <td style={{ textAlign: 'right' }}>{fcfa(l.CommissionPayee)}</td><td style={{ textAlign: 'right' }}>{fcfa(l.Reste)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {reclamation.Paiements?.length > 0 && (
          <>
            <div style={{ fontWeight: 800, margin: '1rem 0 0.4rem' }}>Règlements reçus de l'assureur</div>
            <table className="data-table">
              <thead><tr><th>Référence</th><th>Date</th><th>Mode</th><th>N° chèque / virement</th><th>Banque</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
              <tbody>
                {reclamation.Paiements.map((p) => (
                  <tr key={p.IdPaiement}><td>{p.Reference}</td><td>{dateFr(p.DatePaiement)}</td><td>{p.Mode}</td><td>{p.ReferencePaiement}</td><td>{p.Banque}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fcfa(p.Montant)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          {reclamation.Statut === 'EMISE' && !reclamation.Paiements?.length && (
            <button type="button" className="btn btn-secondary" style={{ color: 'var(--accent-rose)', display: 'flex', alignItems: 'center', gap: '0.4rem' }} onClick={() => onAnnuler(reclamation)}><Ban size={15} /> Annuler le bordereau</button>
          )}
          <button type="button" className="btn btn-secondary"
            onClick={() => financeApi.telechargerReclamationExcel(reclamation.IdReclamation, `BORDEREAU RECAPITULATIF ${reclamation.Reference} ${reclamation.Compagnie}.xlsx`)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><FileSpreadsheet size={15} /> Excel</button>
          {/* Courrier de réclamation de commission et son bordereau récapitulatif, au modèle des courriers d'OREOLE */}
          <button type="button" className="btn btn-secondary" onClick={() => imprimerRecapitulatifReclamation(reclamation, documentsCompagnie(reclamation.IdCompagnie)?.Reversement || {})} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><FileText size={15} /> Bordereau récapitulatif</button>
          <button type="button" className="btn btn-secondary" onClick={() => imprimerCourrierReclamation(reclamation, documentsCompagnie(reclamation.IdCompagnie)?.Reversement || {})} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Mail size={15} /> Courrier de réclamation</button>
          {reclamation.Reste > 0 && reclamation.Statut !== 'ANNULEE' && (
            <button type="button" className="btn btn-primary" onClick={() => onRegler(reclamation)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Wallet size={15} /> Encaisser un règlement</button>
          )}
        </div>
      </>
    )}
  </Modal>
);

// ------------------------------------------------------------------ page
export const CommissionDashboardPage = () => {
  const { success, error: toastError } = useToast();
  const [onglet, setOnglet] = useState('etat');
  const [compagnies, setCompagnies] = useState([]);
  const [banques, setBanques] = useState([]);
  const [filtres, setFiltres] = useState({ compagnie: '', du: '', au: '', statut: 'A_RECLAMER' });
  const [etat, setEtat] = useState(null);
  const [selection, setSelection] = useState(new Set());
  const [periode, setPeriode] = useState(bornesMois());
  const [reclamations, setReclamations] = useState([]);
  const [detail, setDetail] = useState(null);
  const [aRegler, setARegler] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [recap, setRecap] = useState(null);
  const [chargementRecap, setChargementRecap] = useState(false);
  const [telechargement, setTelechargement] = useState(false);

  useEffect(() => {
    settingsApi.getCompanies().then((l) => setCompagnies(Array.isArray(l) ? l : [])).catch(() => {});
    settingsApi.getBanques().then((l) => setBanques(Array.isArray(l) ? l : [])).catch(() => {});
  }, []);

  const chargerEtat = () => {
    setChargement(true);
    const params = Object.fromEntries(Object.entries(filtres).filter(([, v]) => v !== ''));
    financeApi.commissions(params)
      .then((r) => { setEtat(r); setSelection(new Set()); })
      .catch((err) => toastError(`État des commissions indisponible : ${messageErreurApi(err)}`))
      .finally(() => setChargement(false));
  };
  // État récapitulatif : compagnie et période de reversement des filtres (le statut ne s'y applique pas)
  const paramsRecap = () => Object.fromEntries(['compagnie', 'du', 'au'].filter((c) => filtres[c] !== '').map((c) => [c, filtres[c]]));
  const chargerRecap = () => {
    setChargementRecap(true);
    financeApi.recapitulatifCommissions(paramsRecap())
      .then(setRecap)
      .catch((err) => toastError(`État récapitulatif indisponible : ${messageErreurApi(err)}`))
      .finally(() => setChargementRecap(false));
  };
  const telechargerRecap = async () => {
    setTelechargement(true);
    try {
      const periode = [filtres.du && `du ${dateFr(filtres.du)}`, filtres.au && `au ${dateFr(filtres.au)}`].filter(Boolean).join(' ') || 'toutes périodes';
      await financeApi.telechargerRecapitulatifCommissions(paramsRecap(),
        `Etat recapitulatif des commissions ${recap?.Compagnie || 'toutes compagnies'} ${periode}.xlsx`.replace(/\//g, '-'));
    } catch (err) {
      toastError(`Excel non téléchargé : ${messageErreurApi(err)}`);
    } finally {
      setTelechargement(false);
    }
  };
  const chargerReclamations = () => financeApi.reclamations(filtres.compagnie ? { compagnie: filtres.compagnie } : {})
    .then((r) => setReclamations(r.Reclamations || []))
    .catch((err) => toastError(`Bordereaux indisponibles : ${messageErreurApi(err)}`));
  useEffect(() => { chargerEtat(); chargerReclamations(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lignes = etat?.Lignes || [];
  const reclamables = lignes.filter((l) => l.Statut === 'A_RECLAMER');
  const cochees = lignes.filter((l) => selection.has(l.IdDetailReversement));
  const compagniesCochees = new Set(cochees.map((l) => l.IdCompagnie));
  const basculer = (l) => setSelection((s) => {
    const suivant = new Set(s);
    if (suivant.has(l.IdDetailReversement)) suivant.delete(l.IdDetailReversement); else suivant.add(l.IdDetailReversement);
    return suivant;
  });
  const champ = (cle) => (e) => setFiltres((f) => ({ ...f, [cle]: e.target.value }));

  // Chiffre d'affaires du cabinet = commissions (dues sur les primes reversées, encaissées, restant dues)
  const totaux = etat?.Total;
  const reclameesNonPayees = useMemo(() => reclamations.filter((r) => r.Statut !== 'ANNULEE').reduce((s, r) => s + r.Reste, 0), [reclamations]);

  const emettre = async () => {
    if (compagniesCochees.size !== 1) {
      toastError('Un bordereau de réclamation ne concerne qu\'une compagnie : cochez des quittances d\'une seule compagnie.');
      return;
    }
    setEnvoi(true);
    try {
      const rc = await financeApi.emettreReclamation({
        IdCompagnie: [...compagniesCochees][0], PeriodeDebut: periode[0], PeriodeFin: periode[1],
        DetailsReversement: cochees.map((l) => l.IdDetailReversement),
      });
      success(`Bordereau ${rc.Reference} émis : ${fcfa(rc.MontantCommissions)} F de commissions réclamées à ${rc.Compagnie}.`);
      setDetail(rc);
      chargerEtat();
      chargerReclamations();
    } catch (err) {
      toastError(`Bordereau non émis : ${messageErreurApi(err)}`);
    } finally {
      setEnvoi(false);
    }
  };

  const annuler = async (rc) => {
    const motif = await saisirTexte({
      ton: 'danger',
      titre: `Annuler le bordereau ${rc.Reference} ?`,
      message: "Indiquez, si vous le souhaitez, le motif de l'annulation : il sera ajouté aux notes du bordereau.",
      consequences: 'Ses quittances redeviendront à réclamer.',
      placeholder: "Motif de l'annulation (facultatif)…",
      minimum: 0,
      confirmer: 'Annuler le bordereau',
      annuler: 'Garder le bordereau',
    });
    if (motif === null) return;
    try {
      await financeApi.annulerReclamation(rc.IdReclamation, motif);
      success(`Bordereau ${rc.Reference} annulé : ses quittances sont de nouveau à réclamer.`);
      setDetail(null);
      chargerEtat();
      chargerReclamations();
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };

  const exporterEtat = (format) => {
    const libelle = FILTRES_STATUT.find(([v]) => v === filtres.statut)?.[1] || '';
    const charge = {
      filename: `Etat_Commissions_${aujourdhui()}`,
      title: `ÉTAT DES COMMISSIONS - ${libelle.toUpperCase()}`,
      subtitle: [filtres.du && `reversements du ${dateFr(filtres.du)}`, filtres.au && `au ${dateFr(filtres.au)}`].filter(Boolean).join(' '),
      metadata: {
        'Quittances': String(totaux?.Nombre || 0), 'Primes reversées': `${fcfa(totaux?.PrimesReversees)} F`,
        'Commissions dues': `${fcfa(totaux?.CommissionDue)} F`, 'Commissions encaissées': `${fcfa(totaux?.CommissionPayee)} F`, 'Reste dû': `${fcfa(totaux?.Reste)} F`,
      },
      headers: ['Compagnie', 'N° Police', 'Quittance', 'Client', 'Branche', 'Reversement', 'Prime reversée', 'Commission due', 'Encaissée', 'Reste', 'Statut'],
      rows: lignes.map((l) => [l.Compagnie, l.NumeroPolice, l.NumeroQuittance, l.Client, l.Branche, `${l.NumeroReversement} ${dateFr(l.DateReversement)}`,
        fcfa(l.MontantReverse), fcfa(l.CommissionDue), fcfa(l.CommissionPayee), fcfa(l.Reste), l.LibelleStatut]),
      totals: ['TOTAL', '', '', '', '', '', fcfa(totaux?.PrimesReversees), fcfa(totaux?.CommissionDue), fcfa(totaux?.CommissionPayee), fcfa(totaux?.Reste), ''],
    };
    if (format === 'excel') exportToExcel(charge); else exportToPdf(charge);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', paddingBottom: '2rem' }}>
      <div>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', margin: 0 }}>
          <Coins size={26} style={{ color: 'var(--primary-500)' }} /> Commissions du cabinet
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.3rem 0 0', maxWidth: 920 }}>
          Le chiffre d'affaires du cabinet est le montant de ses commissions. Elles sont réclamées à chaque compagnie par un bordereau
          récapitulatif des quittances reversées, puis encaissées à réception du chèque ou du virement de l'assureur.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }} role="tablist">
        <Onglet actif={onglet === 'etat'} onClick={() => setOnglet('etat')} icone={Coins}>État des commissions</Onglet>
        <Onglet actif={onglet === 'recapitulatif'} onClick={() => { setOnglet('recapitulatif'); chargerRecap(); }} icone={ClipboardList}>État récapitulatif (payées / en attente)</Onglet>
        <Onglet actif={onglet === 'bordereaux'} onClick={() => setOnglet('bordereaux')} icone={FileText}>Bordereaux de réclamation ({reclamations.length})</Onglet>
      </div>

      {onglet === 'etat' && (
        <>
          <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '0.75rem', alignItems: 'end' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="cm-cie">Compagnie</label>
              <select id="cm-cie" className="form-control" value={filtres.compagnie} onChange={champ('compagnie')}>
                <option value="">Toutes les compagnies</option>
                {trierParLibelle(compagnies, (c) => c.RaisonSociale).map((c) => <option key={c.IdCompagnie ?? c.id} value={c.IdCompagnie ?? c.id}>{c.RaisonSociale}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="cm-du">Reversées du</label>
              <input id="cm-du" type="date" className="form-control" value={filtres.du} onChange={champ('du')} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="cm-au">au</label>
              <input id="cm-au" type="date" className="form-control" value={filtres.au} onChange={champ('au')} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="cm-statut">Commissions</label>
              <select id="cm-statut" className="form-control" value={filtres.statut} onChange={champ('statut')}>
                {FILTRES_STATUT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-primary" onClick={() => { chargerEtat(); chargerReclamations(); }} disabled={chargement} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {chargement ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Afficher
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => exporterEtat('excel')} disabled={!etat} title="Excel"><FileSpreadsheet size={15} /></button>
              <button type="button" className="btn btn-secondary" onClick={() => exporterEtat('pdf')} disabled={!etat} title="PDF"><FileText size={15} /></button>
            </div>
          </div>

          {totaux && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '0.75rem' }}>
              <Carte libelle="Commissions dues (sélection)" valeur={`${fcfa(totaux.CommissionDue)} F`} detail={`${totaux.Nombre} quittance(s) - ${fcfa(totaux.PrimesReversees)} F de primes reversées`} />
              <Carte libelle="Commissions encaissées" valeur={`${fcfa(totaux.CommissionPayee)} F`} couleur="var(--accent-emerald)" detail="Chiffre d'affaires encaissé" />
              <Carte libelle="Reste dû par les assureurs" valeur={`${fcfa(totaux.Reste)} F`} couleur="var(--accent-amber)" />
              <Carte libelle="Réclamé, en attente de règlement" valeur={`${fcfa(reclameesNonPayees)} F`} detail="Tous les bordereaux émis" />
            </div>
          )}

          {etat?.ParCompagnie?.length > 1 && (
            <div className="glass-panel" style={{ padding: '1rem 1.1rem' }}>
              <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Par compagnie</div>
              <table className="data-table">
                <thead><tr><th>Compagnie</th><th style={{ textAlign: 'right' }}>Quittances</th><th style={{ textAlign: 'right' }}>Primes reversées</th><th style={{ textAlign: 'right' }}>Commissions dues</th><th style={{ textAlign: 'right' }}>Encaissées</th><th style={{ textAlign: 'right' }}>Reste</th></tr></thead>
                <tbody>
                  {etat.ParCompagnie.map((g) => (
                    <tr key={g.Compagnie}><td>{g.Compagnie}</td><td style={{ textAlign: 'right' }}>{g.Nombre}</td><td style={{ textAlign: 'right' }}>{fcfa(g.PrimesReversees)}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fcfa(g.CommissionDue)}</td><td style={{ textAlign: 'right' }}>{fcfa(g.CommissionPayee)}</td><td style={{ textAlign: 'right' }}>{fcfa(g.Reste)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="glass-panel" style={{ padding: '1rem 1.1rem' }}>
            <div className="table-wrapper" style={{ maxHeight: '55vh', overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th aria-label="Sélection" />
                    <th>Compagnie</th><th>N° Police</th><th>Quittance</th><th>Client</th><th>Branche</th><th>Reversement</th>
                    <th style={{ textAlign: 'right' }}>Prime reversée</th><th style={{ textAlign: 'right' }}>Commission due</th>
                    <th style={{ textAlign: 'right' }}>Encaissée</th><th style={{ textAlign: 'right' }}>Reste</th><th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => (
                    <tr key={l.IdDetailReversement} style={selection.has(l.IdDetailReversement) ? { background: 'var(--primary-glow)' } : undefined}>
                      <td>{l.Statut === 'A_RECLAMER' && (
                        <input type="checkbox" checked={selection.has(l.IdDetailReversement)} onChange={() => basculer(l)} aria-label={`Réclamer ${l.NumeroQuittance}`} />
                      )}</td>
                      <td>{l.Compagnie}</td><td>{l.NumeroPolice}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{l.NumeroQuittance}</td>
                      <td>{l.Client}</td><td>{l.Branche}</td><td>{l.NumeroReversement} du {dateFr(l.DateReversement)}</td>
                      <td style={{ textAlign: 'right' }}>{fcfa(l.MontantReverse)}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fcfa(l.CommissionDue)}</td>
                      <td style={{ textAlign: 'right' }}>{fcfa(l.CommissionPayee)}</td><td style={{ textAlign: 'right' }}>{fcfa(l.Reste)}</td>
                      <td title={l.Reclamation || undefined}><StatusBadge label={l.LibelleStatut} color={COULEURS[l.Statut]} /></td>
                    </tr>
                  ))}
                  {!lignes.length && <tr><td colSpan={12} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                    {chargement ? 'Chargement…' : 'Aucune quittance reversée (et payée à la compagnie) pour ces critères.'}
                  </td></tr>}
                </tbody>
              </table>
            </div>
            {reclamables.length > 0 && (
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '1rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.9rem' }}>
                <div style={{ fontSize: '0.9rem' }}>
                  <div>
                    <button type="button" className="btn btn-link" style={{ padding: 0 }} onClick={() => setSelection(new Set(reclamables.map((l) => l.IdDetailReversement)))}>Tout cocher</button>
                    {' - '}<strong>{cochees.length}</strong> quittance(s) cochée(s) : <strong style={{ fontSize: '1.05rem' }}>{fcfa(cochees.reduce((s, l) => s + l.CommissionDue, 0))} F</strong> de commissions
                  </div>
                  {compagniesCochees.size > 1 && <div style={{ color: 'var(--accent-rose)', fontSize: '0.8rem' }}>Plusieurs compagnies cochées : un bordereau par compagnie.</div>}
                </div>
                <div className="form-group" style={{ margin: '0 0 0 auto' }}>
                  <label className="form-label" htmlFor="cm-p1">Période du</label>
                  <input id="cm-p1" type="date" className="form-control" value={periode[0]} onChange={(e) => setPeriode([e.target.value, periode[1]])} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="cm-p2">au</label>
                  <input id="cm-p2" type="date" className="form-control" value={periode[1]} onChange={(e) => setPeriode([periode[0], e.target.value])} />
                </div>
                <button type="button" className="btn btn-primary" disabled={!cochees.length || envoi} onClick={emettre} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {envoi ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Émettre le bordereau récapitulatif
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {onglet === 'recapitulatif' && (
        <>
          <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '0.75rem', alignItems: 'end' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="rcm-cie">Compagnie</label>
              <select id="rcm-cie" className="form-control" value={filtres.compagnie} onChange={champ('compagnie')}>
                <option value="">Toutes les compagnies</option>
                {trierParLibelle(compagnies, (c) => c.RaisonSociale).map((c) => <option key={c.IdCompagnie ?? c.id} value={c.IdCompagnie ?? c.id}>{c.RaisonSociale}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="rcm-du">Primes reversées du</label>
              <input id="rcm-du" type="date" className="form-control" value={filtres.du} onChange={champ('du')} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="rcm-au">au</label>
              <input id="rcm-au" type="date" className="form-control" value={filtres.au} onChange={champ('au')} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={chargerRecap} disabled={chargementRecap} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {chargementRecap ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Afficher
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => imprimerEtatRecapitulatifCommissions(recap)} disabled={!recap || chargementRecap} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Printer size={15} /> Imprimer
              </button>
              <button type="button" className="btn btn-secondary" onClick={telechargerRecap} disabled={!recap || telechargement} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {telechargement ? <Loader2 size={15} className="spin" /> : <FileSpreadsheet size={15} />} Excel
              </button>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Commissions des primes reversées sur la période, situation au {dateFr(recap?.Situation || aujourdhui())} :
            commissions dues = payées + en attente de paiement (réclamées à l'assureur ou pas encore réclamées).
          </p>
          {recap && <EtatRecapitulatif recap={recap} />}
          {!recap && chargementRecap && <Vide>Chargement…</Vide>}
        </>
      )}

      {onglet === 'bordereaux' && (
        <div className="glass-panel" style={{ padding: '1rem 1.1rem' }}>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Référence</th><th>Compagnie</th><th>Période</th><th>Émis le</th><th style={{ textAlign: 'right' }}>Quittances</th>
                  <th style={{ textAlign: 'right' }}>Commissions</th><th style={{ textAlign: 'right' }}>Réglé</th><th style={{ textAlign: 'right' }}>Reste</th><th>Statut</th><th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {reclamations.map((r) => (
                  <tr key={r.IdReclamation}>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{r.Reference}</td><td>{r.Compagnie}</td>
                    <td>{dateFr(r.PeriodeDebut)} – {dateFr(r.PeriodeFin)}</td><td>{dateFr(r.DateEmission)}</td>
                    <td style={{ textAlign: 'right' }}>{r.NombreQuittances}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fcfa(r.MontantCommissions)}</td>
                    <td style={{ textAlign: 'right' }}>{fcfa(r.MontantPaye)}</td><td style={{ textAlign: 'right' }}>{fcfa(r.Reste)}</td>
                    <td><StatusBadge label={r.LibelleStatut} color={COULEURS[r.Statut]} /></td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.55rem' }} onClick={() => financeApi.reclamation(r.IdReclamation).then(setDetail)}>Détail</button>{' '}
                      {r.Reste > 0 && r.Statut !== 'ANNULEE' && (
                        <button type="button" className="btn btn-primary" style={{ padding: '0.25rem 0.55rem' }} onClick={() => setARegler(r)}>Encaisser</button>
                      )}
                    </td>
                  </tr>
                ))}
                {!reclamations.length && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>Aucun bordereau de réclamation émis.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}


      <ReclamationModal reclamation={detail} onClose={() => setDetail(null)} onRegler={(r) => { setDetail(null); setARegler(r); }} onAnnuler={annuler} />
      <ReglementModal reclamation={aRegler} banques={banques} onClose={() => setARegler(null)}
        onEnregistre={(r) => { setARegler(null); setDetail(r); chargerEtat(); chargerReclamations(); }} />
    </div>
  );
};

export default CommissionDashboardPage;
