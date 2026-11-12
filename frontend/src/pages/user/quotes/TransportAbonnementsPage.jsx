import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Ship, Plane, Truck, TrainFront, Sailboat, ChevronLeft, Plus, Receipt, Printer, Search, CalendarClock, Loader2,
  AlertTriangle, Info, XCircle, MapPin, FileSignature, ExternalLink,
} from 'lucide-react';
import { transportHorsGuceApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { Modal } from '../../../components/common/Modal';
import { AmountInput } from '../../../components/common/AmountInput';
import { Champ } from '../../../components/common/RechercheClient';
import { confirmer, saisirTexte } from '../../../utils/dialogue';
import { imprimerRessortie, moisEnLettres } from '../../../utils/impressionsTransport';

// Polices d'abonnement Transport hors GUCE (document OREOLE « TRANSPORTS.docx ») : la police est émise sans prime ;
// chaque voyage déclaré l'alimente, à ses conditions (garanties et taux) ; la ressortie du mois regroupe les voyages
// et donne la facture de prime (contrat sous le numéro de la police et quittance).

const ICONES_MODE = { MARITIME: Ship, AERIEN: Plane, TERRESTRE: Truck, FERROVIAIRE: TrainFront, FLUVIAL: Sailboat };
const DOCUMENTS = { MARITIME: 'Connaissement (B/L)', AERIEN: 'Lettre de transport aérien (LTA)', TERRESTRE: 'Lettre de voiture', FERROVIAIRE: 'Lettre de voiture ferroviaire', FLUVIAL: 'Connaissement fluvial' };
const MOYENS = { MARITIME: 'Navire', AERIEN: 'Compagnie et n° de vol', TERRESTRE: 'Camion, immatriculation', FERROVIAIRE: 'Train', FLUVIAL: 'Barge ou bateau' };
const TEINTES_STATUT = { 'À facturer': 'var(--accent-amber)', Facturé: 'var(--accent-emerald)', Annulé: 'var(--text-muted)' };

const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '-');
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const moisCourant = () => aujourdhui().slice(0, 7);
const messageErreurApi = (err) => {
  const data = err?.response?.data;
  if (!data) return err?.message || 'serveur injoignable';
  if (typeof data === 'string') return data.slice(0, 200);
  return data.error || data.detail || data.message || JSON.stringify(data);
};

const Statut = ({ libelle }) => <span className="trp-statut" style={{ '--trp-teinte': TEINTES_STATUT[libelle] || 'var(--primary-500)' }}>{libelle}</span>;

// ------------------------------------------------------------------ déclaration d'un voyage
const VOYAGE_VIDE = { DateDepart: aujourdhui(), DateArrivee: '', Marchandise: '', Emballage: '', Conditionnement: '', LieuDepart: '', LieuArrivee: '', MoyenTransport: '', DocumentTransport: '', Valeur: 0 };

const ModalVoyage = ({ police, onClose, onDeclare }) => {
  const { success, error: toastError, warning } = useToast();
  const saisie = police.Saisie || {};
  const [v, setV] = useState(() => ({
    ...VOYAGE_VIDE,
    Marchandise: saisie.marchandise?.nature || '',
    Emballage: saisie.marchandise?.emballage || '',
    Conditionnement: saisie.marchandise?.conditionnement || '',
    LieuDepart: saisie.trajet?.depart || '',
    LieuArrivee: saisie.trajet?.arrivee || '',
  }));
  const [verifie, setVerifie] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [decompte, setDecompte] = useState(null);
  const maj = (cle) => (e) => setV((x) => ({ ...x, [cle]: e?.target ? e.target.value : e }));

  // Décompte du voyage aux conditions de la police (même calcul que la déclaration)
  useEffect(() => {
    if (!(Number(v.Valeur) > 0)) { setDecompte(null); return undefined; }
    let actif = true;
    const g = saisie.garanties || {};
    const minuterie = setTimeout(async () => {
      try {
        const r = await transportHorsGuceApi.calculer({
          TypePolice: 'ABONNEMENT', Mode: police.Mode, IdCompagnie: police.IdCompagnie, Valeur: Number(v.Valeur),
          Garanties: { Base: { Code: g.base?.code, Taux: g.base?.taux }, Extensions: (g.extensions || []).map((x) => ({ Code: x.code, Taux: x.taux })) },
          ExonereTaxe: Boolean(saisie.exonere_taxe),
        });
        if (actif) setDecompte(r.ParVoyage || null);
      } catch (err) {
        if (actif) setDecompte({ erreur: messageErreurApi(err) });
      }
    }, 300);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [v.Valeur]); // eslint-disable-line react-hooks/exhaustive-deps

  const erreurs = {};
  if (verifie) {
    if (!v.DateDepart) erreurs.DateDepart = 'Saisissez la date de départ.';
    else if (v.DateDepart < police.DateEffet || v.DateDepart > police.DateExpiration) erreurs.DateDepart = `Entre le ${dateFr(police.DateEffet)} et le ${dateFr(police.DateExpiration)}.`;
    if (v.DateArrivee && v.DateDepart && v.DateArrivee < v.DateDepart) erreurs.DateArrivee = 'Après le départ.';
    if (!v.Marchandise.trim()) erreurs.Marchandise = 'Décrivez la marchandise.';
    if (!v.LieuDepart.trim()) erreurs.LieuDepart = 'Point de départ à renseigner.';
    if (!v.LieuArrivee.trim()) erreurs.LieuArrivee = 'Point d\'arrivée à renseigner.';
    if (!(Number(v.Valeur) > 0)) erreurs.Valeur = 'Valeur à renseigner.';
  }
  const auDelaDuPlein = Number(police.Plein) > 0 && Number(v.Valeur) > Number(police.Plein);

  const declarer = async () => {
    setVerifie(true);
    const manquants = !v.DateDepart || !v.Marchandise.trim() || !v.LieuDepart.trim() || !v.LieuArrivee.trim() || !(Number(v.Valeur) > 0)
      || v.DateDepart < police.DateEffet || v.DateDepart > police.DateExpiration || (v.DateArrivee && v.DateArrivee < v.DateDepart);
    if (manquants) { toastError('Complétez la déclaration du voyage.'); return; }
    setEnvoi(true);
    try {
      const r = await transportHorsGuceApi.declarerVoyage(police.IdContrat, { ...v, Valeur: Number(v.Valeur) });
      success(`Voyage n° ${r.Numero} déclaré : ${fcfa(r.PrimeTtc)} F TTC, facturé avec la ressortie de ${moisEnLettres(r.Mois)}.`);
      if (r.Avertissement) warning(r.Avertissement);
      onDeclare(r);
    } catch (err) {
      toastError(`Voyage non déclaré : ${messageErreurApi(err)}`);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Déclarer un voyage" subtitle={`Police ${police.NumeroPolice} · ${police.Client}`} maxWidth="760px">
      <div className="trp-grille">
        <Champ label="Date de départ" requis erreur={erreurs.DateDepart}>
          <input type="date" className="form-control" value={v.DateDepart} min={police.DateEffet} max={police.DateExpiration} onChange={maj('DateDepart')} />
        </Champ>
        <Champ label="Arrivée prévue" erreur={erreurs.DateArrivee} aide="Facultatif">
          <input type="date" className="form-control" value={v.DateArrivee} min={v.DateDepart || undefined} onChange={maj('DateArrivee')} />
        </Champ>
        <Champ label="Valeur de la marchandise" requis erreur={erreurs.Valeur}
          aide={police.Plein ? `Plein de la police : ${fcfa(police.Plein)} F` : undefined}>
          <AmountInput value={v.Valeur} onChange={maj('Valeur')} />
        </Champ>
        <Champ label="Marchandise" requis erreur={erreurs.Marchandise} large>
          <input type="text" className="form-control" maxLength={255} value={v.Marchandise} onChange={maj('Marchandise')} />
        </Champ>
        <Champ label="Point de départ" requis erreur={erreurs.LieuDepart}>
          <input type="text" className="form-control" maxLength={120} value={v.LieuDepart} onChange={maj('LieuDepart')} />
        </Champ>
        <Champ label="Point d'arrivée" requis erreur={erreurs.LieuArrivee}>
          <input type="text" className="form-control" maxLength={120} value={v.LieuArrivee} onChange={maj('LieuArrivee')} />
        </Champ>
        <Champ label={MOYENS[police.Mode] || 'Moyen de transport'} aide="Facultatif">
          <input type="text" className="form-control" maxLength={120} value={v.MoyenTransport} onChange={maj('MoyenTransport')} />
        </Champ>
        <Champ label={DOCUMENTS[police.Mode] || 'Document de transport'} aide="Facultatif">
          <input type="text" className="form-control" maxLength={80} value={v.DocumentTransport} onChange={maj('DocumentTransport')} />
        </Champ>
        <Champ label="Conditionnement" aide="Facultatif">
          <input type="text" className="form-control" maxLength={120} value={v.Conditionnement} onChange={maj('Conditionnement')} />
        </Champ>
      </div>
      {auDelaDuPlein && (
        <div className="trp-note attention" style={{ marginTop: '1rem' }}>
          <AlertTriangle size={16} /> Valeur supérieure au plein par expédition de la police : le voyage sera enregistré, signalez-le à la compagnie.
        </div>
      )}
      <div className="trp-note" style={{ marginTop: '1rem' }} aria-live="polite">
        <Info size={16} />
        {decompte?.erreur ? decompte.erreur : decompte
          ? <span>Prime du voyage : <b>{fcfa(decompte.PrimeNette)} F</b> nette{decompte.MinimumApplique ? ' (minimum)' : ''}, {fcfa(decompte.Accessoire)} F d'accessoires, {fcfa(decompte.Taxe)} F de taxe, soit <b>{fcfa(decompte.PrimeTtc)} F TTC</b>.</span>
          : 'Saisissez la valeur : la prime se calcule aux conditions de la police.'}
      </div>
      <div className="trp-navigation">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="btn btn-primary" onClick={declarer} aria-busy={envoi} disabled={envoi}><Plus size={16} /> Déclarer le voyage</button>
      </div>
    </Modal>
  );
};

// ------------------------------------------------------------------ ressortie du mois
const ModalRessortie = ({ police, onClose, onEmise }) => {
  const { success, error: toastError } = useToast();
  const moisDisponibles = police.MoisAFacturer || [];
  const [mois, setMois] = useState(moisDisponibles[0] || '');
  const [envoi, setEnvoi] = useState(false);
  const voyages = (police.ListeVoyages || []).filter((v) => v.Statut === 'À facturer' && v.Mois === mois).sort((a, b) => a.Numero - b.Numero);
  const total = (cle) => voyages.reduce((s, v) => s + (Number(v[cle]) || 0), 0);
  const moisEnCours = mois && mois >= moisCourant();

  const emettre = async () => {
    setEnvoi(true);
    try {
      const r = await transportHorsGuceApi.emettreRessortie(police.IdContrat, mois);
      success(r.OutputMessage || 'Ressortie émise.');
      onEmise(r);
    } catch (err) {
      toastError(`Ressortie non émise : ${messageErreurApi(err)}`);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Ressortie du mois" subtitle={`Police ${police.NumeroPolice} · ${police.Client}`} maxWidth="820px">
      <div className="trp-grille">
        <Champ label="Mois facturé" requis>
          <select className="form-control" value={mois} onChange={(e) => setMois(e.target.value)}>
            {moisDisponibles.map((m) => <option key={m} value={m}>{moisEnLettres(m)}</option>)}
          </select>
        </Champ>
      </div>
      {moisEnCours && (
        <div className="trp-note attention" style={{ marginTop: '0.9rem' }}>
          <AlertTriangle size={16} /> Le mois n'est pas terminé : un voyage déclaré plus tard sera facturé par une autre ressortie.
        </div>
      )}
      <div className="table-wrapper" style={{ marginTop: '1rem' }}>
        <table className="data-table">
          <thead><tr><th>N°</th><th>Départ</th><th>Trajet</th><th style={{ textAlign: 'right' }}>Valeur</th><th style={{ textAlign: 'right' }}>Prime nette</th><th style={{ textAlign: 'right' }}>Prime TTC</th></tr></thead>
          <tbody>
            {voyages.map((v) => (
              <tr key={v.Id}>
                <td>{v.Numero}</td><td>{dateFr(v.DateDepart)}</td><td>{v.LieuDepart} → {v.LieuArrivee}</td>
                <td style={{ textAlign: 'right' }}>{fcfa(v.Valeur)}</td><td style={{ textAlign: 'right' }}>{fcfa(v.PrimeNette)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fcfa(v.PrimeTtc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="trp-chiffres">
        <div className="trp-chiffre"><span>Voyages</span><b>{voyages.length}</b></div>
        <div className="trp-chiffre"><span>Prime nette</span><b>{fcfa(total('PrimeNette'))} F</b></div>
        <div className="trp-chiffre"><span>Accessoires et taxe</span><b>{fcfa(total('Accessoire') + total('Taxe'))} F</b></div>
        <div className="trp-chiffre" style={{ borderColor: 'var(--primary-500)' }}><span>Facture TTC</span><b>{fcfa(total('PrimeTtc'))} F</b></div>
      </div>
      <div className="trp-note"><Info size={16} /> La ressortie crée le contrat du mois sous le numéro de la police, et sa quittance à encaisser.</div>
      <div className="trp-navigation">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="btn btn-primary" onClick={emettre} disabled={!voyages.length || envoi} aria-busy={envoi}>
          <Receipt size={16} /> Émettre la ressortie
        </button>
      </div>
    </Modal>
  );
};

// ------------------------------------------------------------------ écran
export const TransportAbonnementsPage = () => {
  const navigate = useNavigate();
  const { peut } = useAuth();
  const { success, error: toastError } = useToast();
  const [parametres, setParametres] = useSearchParams();
  const idChoisi = Number(parametres.get('police')) || 0;
  const [polices, setPolices] = useState(null);
  const [recherche, setRecherche] = useState('');
  const [detail, setDetail] = useState(null);
  const [chargementDetail, setChargementDetail] = useState(false);
  const [onglet, setOnglet] = useState('voyages');
  const [modal, setModal] = useState('');

  const chargerPolices = useCallback(async () => {
    try {
      const d = await transportHorsGuceApi.getAbonnements();
      setPolices(d.Polices || []);
    } catch (err) {
      setPolices([]);
      toastError(`Polices d'abonnement non chargées : ${messageErreurApi(err)}`);
    }
  }, [toastError]);
  useEffect(() => { chargerPolices(); }, [chargerPolices]);

  const chargerDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return; }
    setChargementDetail(true);
    try {
      setDetail(await transportHorsGuceApi.getAbonnement(id));
    } catch (err) {
      setDetail(null);
      toastError(`Police non chargée : ${messageErreurApi(err)}`);
    } finally {
      setChargementDetail(false);
    }
  }, [toastError]);
  // Police de l'adresse, sinon la première de la liste
  useEffect(() => {
    if (!polices) return;
    const id = idChoisi || polices[0]?.IdContrat || 0;
    if (id && id !== idChoisi) setParametres({ police: String(id) }, { replace: true });
    chargerDetail(id);
  }, [polices, idChoisi]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtrees = useMemo(() => {
    const t = recherche.trim().toLowerCase();
    return (polices || []).filter((p) => !t || [p.NumeroPolice, p.Client, p.Compagnie, p.Marchandise].some((x) => String(x || '').toLowerCase().includes(t)));
  }, [polices, recherche]);

  const apresChangement = async () => {
    setModal('');
    await Promise.all([chargerPolices(), chargerDetail(detail?.IdContrat)]);
  };
  const annulerVoyage = async (v) => {
    const motif = await saisirTexte({ titre: `Annuler le voyage n° ${v.Numero} ?`, message: 'Il ne sera pas facturé. Indiquez le motif.', placeholder: 'Motif de l\'annulation', minimum: 3, confirmer: 'Annuler le voyage', annuler: 'Garder le voyage', ton: 'danger' });
    if (!motif) return;
    try {
      await transportHorsGuceApi.annulerVoyage(v.Id, motif);
      success(`Voyage n° ${v.Numero} annulé.`);
      apresChangement();
    } catch (err) {
      toastError(`Voyage non annulé : ${messageErreurApi(err)}`);
    }
  };
  const imprimer = (r) => imprimerRessortie(detail, r, (detail.ListeVoyages || []).filter((v) => v.IdDevisRessortie === r.IdDevis).sort((a, b) => a.Numero - b.Numero));

  const IconeMode = ICONES_MODE[detail?.Mode] || Ship;
  const peutDeclarer = peut('contrats.avenant');
  const facture = (detail?.Ressorties || []).reduce((s, r) => s + (Number(r.PrimeTtc) || 0), 0);

  return (
    <div className="trp-page">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <button type="button" className="btn btn-link trp-retour" onClick={() => navigate('/user/quotes/transport')}><ChevronLeft size={16} /> Transport</button>
          <h1 className="title-xl trp-titre"><CalendarClock size={26} /> Polices d'abonnement</h1>
          <p className="trp-sous-titre">Déclarez chaque voyage sur sa police ; la ressortie du mois regroupe les voyages et donne la facture de prime.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/user/quotes/transport/hors-guce')} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <FileSignature size={16} /> Nouvelle police
        </button>
      </div>

      {polices === null && <div className="glass-panel trp-vide" role="status"><Loader2 size={24} className="spin" /> Chargement des polices…</div>}
      {polices && polices.length === 0 && (
        <div className="glass-panel trp-vide">
          <CalendarClock size={32} />
          <strong style={{ color: 'var(--text-primary)' }}>Aucune police d'abonnement</strong>
          Une police d'abonnement s'ouvre par une cotation hors GUCE de type « Police d'abonnement », confirmée en contrat.
          <button type="button" className="btn btn-primary" onClick={() => navigate('/user/quotes/transport/hors-guce')}>Établir une cotation</button>
        </div>
      )}

      {polices && polices.length > 0 && (
        <div className="trp-abonnements">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="search" className="form-control" placeholder="Police, client, marchandise" aria-label="Rechercher une police" value={recherche}
                onChange={(e) => setRecherche(e.target.value)} style={{ paddingLeft: '2rem' }} />
            </div>
            <div className="trp-polices" role="list">
              {filtrees.map((p) => {
                const Icone = ICONES_MODE[p.Mode] || Ship;
                return (
                  <button key={p.IdContrat} type="button" role="listitem" className="trp-police" aria-current={p.IdContrat === detail?.IdContrat}
                    onClick={() => setParametres({ police: String(p.IdContrat) })}>
                    <span className="trp-police-haut"><span className="trp-police-num">{p.NumeroPolice}</span>{p.VoyagesAFacturer > 0 && <Statut libelle="À facturer" />}</span>
                    <span className="trp-police-client">{p.Client}</span>
                    <span className="trp-police-bas">
                      <span><Icone size={12} /> {p.LibelleMode}</span>
                      <span>{p.Compagnie}</span>
                      <span>{p.Voyages} voyage{p.Voyages > 1 ? 's' : ''}{p.VoyagesAFacturer ? `, ${fcfa(p.MontantAFacturer)} F à facturer` : ''}</span>
                    </span>
                  </button>
                );
              })}
              {!filtrees.length && <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '0.5rem' }}>Aucune police ne correspond.</div>}
            </div>
          </div>

          <section key={detail?.IdContrat || 'vide'} className="glass-panel trp-detail" aria-busy={chargementDetail}>
            {!detail && <div className="trp-vide"><Loader2 size={22} className="spin" /> Chargement…</div>}
            {detail && (
              <>
                <div className="trp-detail-entete">
                  <div>
                    <h2 className="trp-panneau-titre"><IconeMode size={18} /> Police {detail.NumeroPolice}</h2>
                    <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                      {detail.Client} · {detail.Compagnie} · du {dateFr(detail.DateEffet)} au {dateFr(detail.DateExpiration)}
                      {detail.Annulee && <> · <Statut libelle="Annulé" /></>}
                    </div>
                    {detail.Trajet && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}><MapPin size={12} style={{ verticalAlign: '-1px' }} /> {detail.Trajet} · {detail.Marchandise}</div>}
                  </div>
                  <div className="trp-actions">
                    <button type="button" className="btn btn-primary" onClick={() => setModal('voyage')} disabled={!peutDeclarer || detail.Annulee}
                      title={!peutDeclarer ? 'Droit « Avenants » requis' : undefined}><Plus size={16} /> Déclarer un voyage</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setModal('ressortie')} disabled={!peutDeclarer || !detail.VoyagesAFacturer}
                      title={!detail.VoyagesAFacturer ? 'Aucun voyage à facturer' : undefined}><Receipt size={16} /> Émettre la ressortie</button>
                    <button type="button" className="btn btn-link" onClick={() => navigate(`/user/contracts/${detail.IdContrat}`)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><ExternalLink size={14} /> Contrat</button>
                  </div>
                </div>

                <div className="trp-puces" style={{ marginTop: '0.9rem' }} aria-label="Conditions de la police">
                  {(detail.Garanties || []).map((g) => <span key={g.Code} className="trp-puce" style={{ cursor: 'default' }}>{g.Libelle} · {String(g.Taux).replace('.', ',')} %</span>)}
                  {detail.ExonereTaxe && <span className="trp-puce" style={{ cursor: 'default' }}>Exonérée de taxe</span>}
                </div>

                <div className="trp-chiffres">
                  <div className="trp-chiffre"><span>Plein par expédition</span><b>{fcfa(detail.Plein)} F</b></div>
                  <div className="trp-chiffre"><span>Voyages déclarés</span><b>{detail.Voyages}</b></div>
                  <div className="trp-chiffre" style={detail.VoyagesAFacturer ? { borderColor: 'var(--accent-amber)' } : undefined}><span>À facturer</span><b>{fcfa(detail.MontantAFacturer)} F</b></div>
                  <div className="trp-chiffre"><span>Déjà facturé</span><b>{fcfa(facture)} F</b></div>
                </div>

                <div className="trp-onglets" role="tablist">
                  {[['voyages', `Voyages (${(detail.ListeVoyages || []).length})`], ['ressorties', `Ressorties (${(detail.Ressorties || []).length})`]].map(([id, libelle]) => (
                    <button key={id} type="button" role="tab" className="trp-onglet" aria-selected={onglet === id} onClick={() => setOnglet(id)}>{libelle}</button>
                  ))}
                </div>

                {onglet === 'voyages' && (
                  (detail.ListeVoyages || []).length === 0 ? (
                    <div className="trp-vide"><Ship size={28} /> Aucun voyage déclaré sur cette police.</div>
                  ) : (
                    <div className="table-wrapper">
                      <table className="data-table">
                        <thead><tr><th>N°</th><th>Départ</th><th>Marchandise et trajet</th><th>Transport</th><th style={{ textAlign: 'right' }}>Valeur</th><th style={{ textAlign: 'right' }}>Prime TTC</th><th>Statut</th><th aria-label="Actions" /></tr></thead>
                        <tbody>
                          {detail.ListeVoyages.map((v) => (
                            <tr key={v.Id} style={v.Annule ? { opacity: 0.6 } : undefined}>
                              <td style={{ fontWeight: 700 }}>{v.Numero}</td>
                              <td>{dateFr(v.DateDepart)}</td>
                              <td>{v.Marchandise}<div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{v.LieuDepart} → {v.LieuArrivee}</div></td>
                              <td style={{ fontSize: '0.8rem' }}>{[v.MoyenTransport, v.DocumentTransport].filter(Boolean).join(' · ') || '-'}</td>
                              <td style={{ textAlign: 'right' }}>{fcfa(v.Valeur)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fcfa(v.PrimeTtc)}</td>
                              <td><Statut libelle={v.Statut} />{v.Annule && v.MotifAnnulation && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{v.MotifAnnulation}</div>}</td>
                              <td>
                                {v.Statut === 'À facturer' && peutDeclarer && (
                                  <button type="button" className="btn btn-link" onClick={() => annulerVoyage(v)} title="Annuler ce voyage" aria-label={`Annuler le voyage n° ${v.Numero}`}><XCircle size={15} /></button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {onglet === 'ressorties' && (
                  (detail.Ressorties || []).length === 0 ? (
                    <div className="trp-vide"><Receipt size={28} /> Aucune ressortie émise : elle regroupe les voyages d'un mois et donne la facture.</div>
                  ) : (
                    <div className="table-wrapper">
                      <table className="data-table">
                        <thead><tr><th>Mois</th><th>Voyages</th><th>Quittance</th><th style={{ textAlign: 'right' }}>Prime TTC</th><th style={{ textAlign: 'right' }}>Encaissé</th><th aria-label="Actions" /></tr></thead>
                        <tbody>
                          {detail.Ressorties.map((r) => (
                            <tr key={r.IdDevis}>
                              <td style={{ fontWeight: 700, textTransform: 'capitalize' }}>{moisEnLettres(r.Mois)}</td>
                              <td>{r.Voyages}</td>
                              <td>{r.NumeroQuittance || '-'}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fcfa(r.PrimeTtc)}</td>
                              <td style={{ textAlign: 'right' }}>{fcfa(r.Encaisse)}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <button type="button" className="btn btn-link" onClick={() => imprimer(r)} title="Imprimer la ressortie et la facture" aria-label={`Imprimer la ressortie de ${moisEnLettres(r.Mois)}`}><Printer size={15} /></button>
                                {r.IdContrat && <button type="button" className="btn btn-link" onClick={() => navigate(`/user/contracts/${r.IdContrat}`)} title="Contrat de la ressortie" aria-label="Contrat de la ressortie"><ExternalLink size={15} /></button>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </>
            )}
          </section>
        </div>
      )}

      {modal === 'voyage' && detail && <ModalVoyage police={detail} onClose={() => setModal('')} onDeclare={apresChangement} />}
      {modal === 'ressortie' && detail && (
        <ModalRessortie police={detail} onClose={() => setModal('')}
          onEmise={async (r) => {
            setModal('');
            setOnglet('ressorties');
            chargerPolices();
            let frais = null;
            try { frais = await transportHorsGuceApi.getAbonnement(detail.IdContrat); setDetail(frais); } catch { /* rechargé au prochain choix */ }
            const ressortie = frais?.Ressorties?.find((x) => x.IdDevis === r.IdDevis);
            if (ressortie && await confirmer({ titre: 'Ressortie émise', message: `Quittance ${r.NumeroQuittance} : ${fcfa(r.PrimeTtc)} F. Imprimer la ressortie et sa facture ?`, confirmer: 'Imprimer', annuler: 'Plus tard' })) {
              imprimerRessortie(frais, ressortie, frais.ListeVoyages.filter((v) => v.IdDevisRessortie === r.IdDevis).sort((a, b) => a.Numero - b.Numero));
            }
          }} />
      )}
    </div>
  );
};

export default TransportAbonnementsPage;
