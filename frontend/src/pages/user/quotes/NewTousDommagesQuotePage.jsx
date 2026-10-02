import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { dataStore } from '../../../api/dataStore';
import { quoteApi, customerApi, settingsApi, contractApi, tousDommagesApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { ArrowLeft, ArrowRight, Check, Plus, Layers } from 'lucide-react';
import { ViewQuoteModal } from './ViewQuoteModal';
import { QuickAddClientModal } from '../clients/QuickAddClientModal';
import { TermeContratSelect } from '../../../components/common/TermeContratSelect';
import { DureeContratSelect } from '../../../components/common/DureeContratSelect';
import { ID_TERME_PAR_DEFAUT, dureeSelonTerme, termeEtDureeEnregistres } from '../../../utils/termesContrat';
import { sortUniqueBy, trierParLibelle } from '../../../utils/sortUtils';
import { AmountInput } from '../../../components/common/AmountInput';

const COULEUR = '#b45309';
// Catégories servies par la procédure URANUS sp_creation_devis_tousrisquesinfo et réellement utilisées
const ID_TARIF_TRI = 82;
const ID_TARIF_CAUTION = 144;
const TARIFS_PROPOSES = [ID_TARIF_TRI, ID_TARIF_CAUTION];

const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
const aujourdhui = () => new Date().toISOString().split('T')[0];
const jour = (v) => (v ? String(v).slice(0, 10) : '');

// Message lisible d'une erreur de l'API (liste [{OutputMessage}], {error}, ou erreurs par champ)
const messageErreurApi = (err) => {
  const data = err?.response?.data;
  if (!data) return err?.message || 'serveur injoignable';
  if (Array.isArray(data)) return data[0]?.OutputMessage || JSON.stringify(data[0]);
  if (typeof data === 'string') return data.slice(0, 200);
  const direct = data.message || data.error || data.erreur || data.detail || data.OutputMessage;
  if (direct) return typeof direct === 'string' ? direct : JSON.stringify(direct);
  return Object.entries(data)
    .map(([champ, v]) => `${champ} : ${Array.isArray(v) ? v.join(' ') : typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ; ');
};

const expirationPour = (dateEffet, dureeId, personnalisee) => {
  if (!dateEffet) return '';
  if (Number(dureeId) === 5) return personnalisee || '';
  const mois = { 1: 1, 2: 3, 3: 6, 4: 12 }[Number(dureeId)] || 12;
  const d = new Date(dateEffet);
  d.setMonth(d.getMonth() + mois);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

export const NewTousDommagesQuotePage = () => {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  // « Modifier » depuis le registre des devis : ?edit=<iddevis>
  const [searchParams] = useSearchParams();
  const editIddevisParam = searchParams.get('edit');
  const [isLoadingEdit, setIsLoadingEdit] = useState(Boolean(editIddevisParam));
  const [idDevisEdite, setIdDevisEdite] = useState(null);
  const [numeroDevisEdite, setNumeroDevisEdite] = useState('');
  const [idAvenant, setIdAvenant] = useState(1);
  // Devis repris d'URANUS sans ligne de détail en base
  const [avertissementReprise, setAvertissementReprise] = useState('');

  const [step, setStep] = useState(1);
  const [createdQuote, setCreatedQuote] = useState(null);
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Référentiels
  const [clients, setClients] = useState([]);
  const [companies, setCompanies] = useState(() => dataStore.getActiveCompanies('TD'));
  const [tarifs, setTarifs] = useState([]);
  const [tarifDevis, setTarifDevis] = useState(null);

  // Contrat
  const [compagnieId, setCompagnieId] = useState(1);
  const [idTarif, setIdTarif] = useState(ID_TARIF_TRI);
  const [dureeId, setDureeId] = useState(4);
  const [termeId, setTermeId] = useState(ID_TERME_PAR_DEFAUT);
  // Date d'émission : toujours la date du jour, jamais saisie (le serveur l'impose aussi)
  const dateEmission = aujourdhui();
  const [dateEffet, setDateEffet] = useState(aujourdhui);
  const [expirationPersonnalisee, setExpirationPersonnalisee] = useState('');
  const [reduction, setReduction] = useState(0);
  const [numeroPoliceCompagnie, setNumeroPoliceCompagnie] = useState('');
  const dateExpiration = useMemo(
    () => expirationPour(dateEffet, dureeId, expirationPersonnalisee),
    [dateEffet, dureeId, expirationPersonnalisee]
  );
  const estCaution = Number(idTarif) === ID_TARIF_CAUTION;

  // Capitaux et prime
  const [capitalMateriel, setCapitalMateriel] = useState(0);
  const [capitalReconstitution, setCapitalReconstitution] = useState(0);
  const [capitalSupplementaire, setCapitalSupplementaire] = useState(0);
  const [capitalCautionnement, setCapitalCautionnement] = useState(0);
  const [modePrime, setModePrime] = useState('montant'); // 'montant' fixe ou 'taux' sur les capitaux
  const [tauxPrime, setTauxPrime] = useState(0);
  const [montantPrime, setMontantPrime] = useState(0);
  const [accessoire, setAccessoire] = useState('');

  // Souscripteur et assuré
  const [souscripteurId, setSouscripteurId] = useState(0);
  const [rechercheSouscripteur, setRechercheSouscripteur] = useState('');
  const [listeSouscripteurOuverte, setListeSouscripteurOuverte] = useState(false);
  const [assureId, setAssureId] = useState(0);
  const [rechercheAssure, setRechercheAssure] = useState('');
  const [listeAssureOuverte, setListeAssureOuverte] = useState(false);
  const [telephoneAssure, setTelephoneAssure] = useState('');

  // Prime nette selon la règle de la base (fn_garantie_offre_tousrisquesinfo) :
  // taux × capitaux, moins la réduction ; sinon le montant saisi
  const capitaux = estCaution
    ? [capitalCautionnement]
    : [capitalMateriel, capitalReconstitution, capitalSupplementaire];
  const primeNetteEstimee = modePrime === 'taux'
    ? Math.round(capitaux.reduce((s, c) => s + ((Number(c) || 0) * (Number(tauxPrime) || 0)) / 100, 0) * (1 - (Number(reduction) || 0) / 100))
    : Math.round(Number(montantPrime) || 0);

  // -------------------------------------------------------------
  // RÉFÉRENTIELS
  // -------------------------------------------------------------
  useEffect(() => {
    let actif = true;
    (async () => {
      const [cls, cies, trfs] = await Promise.all([
        customerApi.getClients().catch(() => []),
        settingsApi.getCompanies().catch(() => []),
        tousDommagesApi.getTarifs().catch(() => []),
      ]);
      if (!actif) return;
      if (cls && cls.length) {
        setClients((prev) => [...prev.filter((p) => !cls.some((c) => String(c.id) === String(p.id))), ...cls]);
      }
      if (cies && cies.length) setCompanies(cies.map((c) => ({ id: c.IdCompagnie || c.id, nom: c.RaisonSociale || c.nom })));
      setTarifs(trfs || []);
    })();
    return () => { actif = false; };
  }, []);

  const tarifsProposes = tarifs.filter((t) => TARIFS_PROPOSES.includes(Number(t.IdTarif))
    || (tarifDevis && Number(t.IdTarif) === Number(tarifDevis)));

  // -------------------------------------------------------------
  // « MODIFIER » : REPRISE DE TOUT CE QUI A ÉTÉ SAISI À LA CRÉATION
  // -------------------------------------------------------------
  useEffect(() => {
    if (!editIddevisParam) return undefined;
    let actif = true;
    (async () => {
      setIsLoadingEdit(true);
      try {
        // Devis repris d'URANUS sans ligne de détail : lireDevis répond 404, l'en-tête reste repris
        const [devis, ligneLue] = await Promise.all([
          quoteApi.getQuote(editIddevisParam),
          tousDommagesApi.lireDevis(editIddevisParam).catch((e) => {
            if (e?.response?.status === 404) return null;
            throw e;
          }),
        ]);
        if (!actif) return;
        const raw = devis?.raw || {};
        const ligne = ligneLue || {};
        setAvertissementReprise(ligneLue ? '' : (
          'Ce devis repris d\'URANUS n\'a aucune ligne de détail en base (catégorie, capitaux) : seuls l\'en-tête et '
          + 'la prime ont été repris. Complétez la catégorie et les capitaux avant d\'enregistrer.'
        ));
        if (raw.confirme) {
          toastError('Ce devis est confirmé (déjà en contrat) : il ne peut plus être modifié.');
          navigate('/user/quotes');
          return;
        }
        setIdDevisEdite(Number(editIddevisParam));
        setNumeroDevisEdite(raw.numerodevis || '');
        setIdAvenant(Number(raw.avenant?.IdAvenant ?? raw.avenant) || 1);
        setCompagnieId(Number(raw.compagnie?.IdCompagnie ?? raw.compagnie) || 1);
        setTarifDevis(Number(ligne.IdTarif) || null);
        setIdTarif(Number(ligne.IdTarif) || ID_TARIF_TRI);
        // Durée libre et terme « Autre » vont ensemble (anciens devis « Divers » compris)
        const charge = termeEtDureeEnregistres(raw.idterme, raw.idduree);
        setDureeId(charge.dureeId);
        setTermeId(charge.termeId);
        setDateEffet(jour(raw.dateeffet) || aujourdhui());
        setExpirationPersonnalisee(jour(raw.dateexpiration));
        setReduction(Number(ligne.TauxReduction) || 0);
        setNumeroPoliceCompagnie(raw.numero_police_compagnie || '');
        // Capitaux : colonnes de la ligne ; cautionnement : capital de la garantie « CAUTION »
        setCapitalMateriel(Math.round(Number(ligne.CapitalDommageCorporel) || 0));
        setCapitalReconstitution(Math.round(Number(ligne.CapitalIntoxicationAlimentaire) || 0));
        setCapitalSupplementaire(Math.round(Number(ligne.CapitalDommageMateriel) || 0));
        setCapitalCautionnement(Math.round(Number(ligne.CapitalCautionnement) || 0));
        const taux = Number(ligne.TauxPrimeDommage) || 0;
        setModePrime(taux > 0 ? 'taux' : 'montant');
        setTauxPrime(taux);
        setMontantPrime(Math.round(Number(ligne.MontantPrime) || 0) || (taux > 0 ? 0 : Math.round(Number(raw.primenette) || 0)));
        // Accessoire enregistré (barème ou saisi) : le laisser vide le faisait recalculer au barème
        setAccessoire(String(Math.round(Number(raw.accessoire) || 0)));

        const idClient = Number(raw.client?.IdClient ?? raw.client) || 0;
        const idAssure = Number(raw.assure?.IdClient ?? raw.assure) || idClient;
        const [souscripteur, assure] = await Promise.all([
          idClient ? customerApi.getClientDetail(idClient).catch(() => null) : null,
          idAssure ? customerApi.getClientDetail(idAssure).catch(() => null) : null,
        ]);
        if (!actif) return;
        setClients((prev) => {
          const ajout = [souscripteur, assure].filter((c, i, t) => c && t.findIndex((x) => x && x.id === c.id) === i && !prev.some((p) => String(p.id) === String(c.id)));
          return [...ajout, ...prev];
        });
        setSouscripteurId(idClient);
        setRechercheSouscripteur(souscripteur?.nomcomplet || (idClient ? `Client n° ${idClient}` : ''));
        setAssureId(idAssure);
        setRechercheAssure(assure?.nomcomplet || (idAssure ? `Client n° ${idAssure}` : ''));
        setTelephoneAssure(assure?.raw?.Mobile || assure?.raw?.Telephone || '');
      } catch (err) {
        if (actif) toastError(`Impossible de charger le devis à modifier : ${messageErreurApi(err)}`);
      } finally {
        if (actif) setIsLoadingEdit(false);
      }
    })();
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editIddevisParam]);

  // -------------------------------------------------------------
  // ENREGISTREMENT (création, ou modification du même devis)
  // -------------------------------------------------------------
  const handleSave = async () => {
    if (!dateExpiration) { toastError('Saisissez la date d\'expiration.'); setStep(1); return; }
    if (!capitaux.some((c) => Number(c) > 0)) {
      toastError(estCaution ? 'Saisissez le montant du cautionnement.' : 'Saisissez au moins un capital.');
      setStep(2);
      return;
    }
    if (modePrime === 'taux' && !(Number(tauxPrime) > 0)) { toastError('Saisissez le taux de prime.'); setStep(2); return; }
    if (modePrime === 'montant' && !(Number(montantPrime) > 0)) { toastError('Saisissez le montant de la prime.'); setStep(2); return; }
    if (!souscripteurId) { toastError('Choisissez le souscripteur.'); setStep(3); return; }
    // Nom tapé dans la recherche sans cliquer sur un client de la liste : l'ancien souscripteur
    // resterait celui du devis
    const souscripteurChoisi = clients.find((c) => String(c.id) === String(souscripteurId));
    if (souscripteurChoisi && rechercheSouscripteur.trim() !== (souscripteurChoisi.nomcomplet || '').trim()) {
      toastError('Le souscripteur n\'a pas été choisi dans la liste : cliquez sur le client voulu sous le champ de recherche.');
      setStep(3);
      return;
    }

    const payload = {
      IdIntermediaire: 1,
      IdCompagnie: Number(compagnieId),
      IdProduit: 9,
      IdAvenant: idAvenant || 1,
      IdClient: Number(souscripteurId),
      IdAssure: Number(assureId || souscripteurId),
      NumeroPoliceCompagnie: numeroPoliceCompagnie || '',
      Flotte: false,
      Coassurance: false,
      DateEffet: dateEffet,
      DateExpiration: dateExpiration,
      DateEmission: dateEmission,
      IdTarif: Number(idTarif),
      TauxPrime: modePrime === 'taux' ? Number(tauxPrime) || 0 : 0,
      TauxReduction: Number(reduction) || 0,
      CapitalMaterielInformatique: estCaution ? 0 : Number(capitalMateriel) || 0,
      CapitalFraisReconstitution: estCaution ? 0 : Number(capitalReconstitution) || 0,
      CapitalFraisSupplementaire: estCaution ? 0 : Number(capitalSupplementaire) || 0,
      CapitalCautionnement: estCaution ? Number(capitalCautionnement) || 0 : 0,
      MontantPrime: modePrime === 'montant' ? Number(montantPrime) || 0 : 0,
      Accessoire: accessoire === '' ? 0 : Number(accessoire) || 0,
      TelephoneAssure: telephoneAssure || '',
      IdDevis: idDevisEdite || 0,
      IdDuree: Number(dureeId),
      IdTerme: Number(termeId),
    };

    setIsSubmitting(true);
    try {
      let res;
      try {
        res = await tousDommagesApi.enregistrer(payload);
      } catch (errApi) {
        toastError(`Devis Tous Dommages non enregistré : ${messageErreurApi(errApi)}`);
        return;
      }
      const devisId = Number(res?.ObjectId) || 0;
      if (!devisId) {
        toastError(`Devis Tous Dommages non enregistré : ${res?.OutputMessage || 'réponse du serveur sans numéro de devis.'}`);
        return;
      }
      let devisEnregistre = null;
      try {
        devisEnregistre = await quoteApi.getQuote(devisId);
      } catch {
        // l'aperçu utilisera la copie locale ci-dessous
      }
      const saved = dataStore.saveQuote({
        id: devisId,
        iddevis: devisId,
        numerodevis: devisEnregistre?.numerodevis,
        client_nom: rechercheSouscripteur,
        client_id: Number(souscripteurId),
        produit: 'Tous Dommages',
        branche: 'TD',
        compagnie: companies.find((c) => String(c.id) === String(compagnieId))?.nom || '',
        prime_nette: devisEnregistre?.prime_nette,
        taxes: devisEnregistre?.taxes,
        accessoires: devisEnregistre?.accessoires,
        prime_totale: devisEnregistre?.prime_totale,
        date_emission: dateEmission,
        date_effet: dateEffet,
        date_expiration: dateExpiration,
      });
      success(idDevisEdite
        ? `Devis Tous Dommages N° ${devisEnregistre?.numerodevis || devisId} modifié.`
        : `Devis Tous Dommages N° ${devisEnregistre?.numerodevis || devisId} enregistré.`);
      setCreatedQuote(devisEnregistre || saved);
    } catch (err) {
      toastError(`Erreur lors de l'enregistrement du devis Tous Dommages : ${messageErreurApi(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConvertToContract = async (quoteToConvert) => {
    try {
      await contractApi.createContractFromQuote(quoteToConvert.id);
    } catch (e) {
      console.warn('Fallback contract creation');
    }
    const newContract = dataStore.convertQuoteToContract(quoteToConvert);
    success(`Devis ${quoteToConvert.numerodevis} transformé en police d'assurance avec succès !`);
    setCreatedQuote(null);
    navigate(`/user/contracts/${newContract.id || newContract.numeropolice}`);
  };

  // -------------------------------------------------------------
  // AFFICHAGE
  // -------------------------------------------------------------
  const titreSection = { color: COULEUR, fontWeight: 800, textTransform: 'uppercase', fontSize: '1.05rem', margin: '0 0 1.25rem' };
  const clientsFiltres = (texte) => {
    const t = (texte || '').toLowerCase();
    return clients.filter((c) => (c.nomcomplet || '').toLowerCase().includes(t)).slice(0, 40);
  };
  const listeDeroulante = {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#1e293b',
    border: '1px solid var(--border-subtle)', borderRadius: '6px', maxHeight: '220px', overflowY: 'auto',
    marginTop: '4px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)',
  };
  const elementListe = { padding: '0.6rem 1rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem' };
  const champClient = (libelle, recherche, setRecherche, ouverte, setOuverte, choisir, avecNouveau) => (
    <div className="form-group" style={{ position: 'relative' }}>
      <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{libelle}</span>
        {avecNouveau && (
          <button type="button" onClick={() => setIsQuickAddClientOpen(true)} style={{ background: 'transparent', border: 'none', color: COULEUR, cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <Plus size={14} /> Nouveau client
          </button>
        )}
      </label>
      <input
        type="text"
        className="form-control"
        placeholder="Rechercher un client..."
        value={recherche}
        onChange={(e) => { setRecherche(e.target.value); setOuverte(true); }}
        onFocus={() => setOuverte(true)}
      />
      {ouverte && (
        <div style={listeDeroulante}>
          {clientsFiltres(recherche).map((c) => (
            <div key={c.id} style={elementListe} onClick={() => { choisir(c); setRecherche(c.nomcomplet); setOuverte(false); }}>
              <div style={{ fontWeight: 700, color: '#fff' }}>{c.nomcomplet}</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{c.codeclient} • {c.telephone}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1240px', margin: '0 auto', paddingBottom: '3rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <button className="btn btn-secondary" onClick={() => navigate('/user/quotes')} style={{ padding: '0.35rem 0.75rem', marginBottom: '0.5rem' }}>
            <ArrowLeft size={16} /> Retour aux devis
          </button>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Layers size={26} color={COULEUR} />
            {editIddevisParam
              ? `Modifier le Devis Tous Dommages${numeroDevisEdite ? ` [${numeroDevisEdite}]` : ''}`
              : 'Nouveau Devis Tous Dommages'}
          </h1>
          {isLoadingEdit ? (
            <p style={{ color: COULEUR, fontSize: '0.875rem', fontWeight: 600 }}>Chargement du devis à modifier…</p>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Tous Risques Informatique et Assurance Caution.</p>
          )}
          {avertissementReprise && (
            <p style={{ marginTop: '0.5rem', padding: '0.6rem 0.75rem', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#f59e0b', fontSize: '0.85rem', maxWidth: '760px' }}>
              {avertissementReprise}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[{ n: 1, l: '1. CONTRAT' }, { n: 2, l: '2. CAPITAUX & PRIME' }, { n: 3, l: '3. ASSURÉ' }].map((e) => (
            <button
              key={e.n}
              type="button"
              onClick={() => setStep(e.n)}
              style={{
                padding: '0.5rem 0.95rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                border: step === e.n ? `2px solid ${COULEUR}` : '1px solid var(--border-subtle)',
                background: step === e.n ? 'rgba(255,255,255,0.08)' : 'rgba(255, 255, 255, 0.03)',
                color: step === e.n ? '#fff' : 'var(--text-muted)',
              }}
            >
              {e.l}
            </button>
          ))}
        </div>
      </div>

      {/* ÉTAPE 1 : CONTRAT */}
      {step === 1 && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          <h3 style={titreSection}>Informations générales du contrat</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Compagnie d'assurance (* requis)</label>
              <select className="form-control" value={compagnieId} onChange={(e) => setCompagnieId(Number(e.target.value))}>
                {sortUniqueBy(companies, (c) => c.nom).map((c) => (<option key={c.id} value={c.id}>{c.nom}</option>))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Catégorie (* requis)</label>
              <select className="form-control" value={idTarif} onChange={(e) => setIdTarif(Number(e.target.value))}>
                {trierParLibelle(tarifsProposes, (t) => t.LibelleTarif).map((t) => (<option key={t.IdTarif} value={t.IdTarif}>{t.LibelleTarif}</option>))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Terme du contrat</label>
              <TermeContratSelect
                value={termeId}
                onChange={(id) => {
                  setTermeId(id);
                  // « Autre » ouvre la durée libre (date d'expiration saisie)
                  setDureeId((d) => dureeSelonTerme(id, d));
                }}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Durée du contrat</label>
              <DureeContratSelect value={dureeId} onChange={setDureeId} />
            </div>
            <div className="form-group">
              <label className="form-label">Date d'émission</label>
              <input type="date" className="form-control" value={dateEmission} readOnly disabled title="Date du jour, non modifiable" />
            </div>
            <div className="form-group">
              <label className="form-label">Date d'effet (* requis)</label>
              <input type="date" className="form-control" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Date d'expiration {Number(dureeId) === 5 ? '(* requis)' : '(calculée)'}</label>
              {Number(dureeId) === 5 ? (
                <input type="date" className="form-control" value={expirationPersonnalisee} onChange={(e) => setExpirationPersonnalisee(e.target.value)} />
              ) : (
                <input type="date" className="form-control" value={dateExpiration} readOnly style={{ background: 'rgba(255,255,255,0.05)', fontWeight: 700 }} />
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Réduction commerciale (%)</label>
              <input type="number" min="0" max="100" className="form-control" value={reduction} onChange={(e) => setReduction(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
            </div>
            <div className="form-group">
              <label className="form-label">N° de police compagnie (optionnel)</label>
              <input type="text" className="form-control" value={numeroPoliceCompagnie} onChange={(e) => setNumeroPoliceCompagnie(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-primary" onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: COULEUR }}>
              Suivant : Capitaux & prime <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ÉTAPE 2 : CAPITAUX ET PRIME */}
      {step === 2 && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          <h3 style={titreSection}>{estCaution ? 'Cautionnement' : 'Capitaux assurés'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
            {estCaution ? (
              <div className="form-group">
                <label className="form-label">Montant du cautionnement (* requis)</label>
                <AmountInput value={capitalCautionnement} onChange={setCapitalCautionnement} />
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label">Matériel informatique</label>
                  <AmountInput value={capitalMateriel} onChange={setCapitalMateriel} />
                </div>
                <div className="form-group">
                  <label className="form-label">Frais de reconstitution des données</label>
                  <AmountInput value={capitalReconstitution} onChange={setCapitalReconstitution} />
                </div>
                <div className="form-group">
                  <label className="form-label">Frais supplémentaires d'exploitation</label>
                  <AmountInput value={capitalSupplementaire} onChange={setCapitalSupplementaire} />
                </div>
              </>
            )}
          </div>

          <h3 style={{ ...titreSection, marginTop: '2rem' }}>Prime</h3>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {[{ v: 'montant', l: 'Montant de prime fixe' }, { v: 'taux', l: 'Taux appliqué aux capitaux' }].map((m) => (
              <button
                key={m.v}
                type="button"
                className={modePrime === m.v ? 'btn btn-primary' : 'btn btn-secondary'}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', background: modePrime === m.v ? COULEUR : undefined }}
                onClick={() => setModePrime(m.v)}
              >
                {m.l}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
            {modePrime === 'taux' ? (
              <div className="form-group">
                <label className="form-label">Taux de prime (%) (* requis)</label>
                <input type="number" min="0" step="0.01" className="form-control" value={tauxPrime} onChange={(e) => setTauxPrime(Math.max(0, Number(e.target.value) || 0))} />
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">Montant de la prime nette (* requis)</label>
                <AmountInput value={montantPrime} onChange={setMontantPrime} />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Accessoire (laisser vide : barème de la compagnie)</label>
              <input
                type="text"
                className="form-control"
                value={accessoire === '' ? '' : fcfa(accessoire)}
                onChange={(e) => { const chiffres = e.target.value.replace(/\D/g, ''); setAccessoire(chiffres === '' ? '' : Number(chiffres)); }}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Prime nette</label>
              <input type="text" className="form-control" readOnly value={`${fcfa(primeNetteEstimee)} FCFA`} style={{ fontWeight: 800, background: 'rgba(255,255,255,0.05)' }} />
            </div>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
            Les taxes et l'accessoire du barème sont calculés à l'enregistrement ; le total s'affiche ensuite dans l'aperçu du devis.
          </p>
          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ArrowLeft size={16} /> Précédent
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(3)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: COULEUR }}>
              Suivant : Assuré <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ÉTAPE 3 : ASSURÉ */}
      {step === 3 && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          <h3 style={titreSection}>Souscripteur et assuré</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
            {champClient('Souscripteur (* requis)', rechercheSouscripteur, setRechercheSouscripteur, listeSouscripteurOuverte, setListeSouscripteurOuverte, (c) => {
              setSouscripteurId(Number(c.id));
              if (!assureId) {
                setAssureId(Number(c.id));
                setRechercheAssure(c.nomcomplet);
                setTelephoneAssure(c.raw?.Mobile || c.raw?.Telephone || '');
              }
            }, true)}
            {champClient('Assuré', rechercheAssure, setRechercheAssure, listeAssureOuverte, setListeAssureOuverte, (c) => {
              setAssureId(Number(c.id));
              setTelephoneAssure(c.raw?.Mobile || c.raw?.Telephone || '');
            }, false)}
            <div className="form-group">
              <label className="form-label">Téléphone de l'assuré</label>
              <input type="tel" className="form-control" value={telephoneAssure} onChange={(e) => setTelephoneAssure(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ArrowLeft size={16} /> Précédent
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isSubmitting || isLoadingEdit}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: COULEUR, padding: '0.75rem 1.5rem', fontWeight: 800 }}
            >
              <Check size={18} />
              {isSubmitting ? 'Enregistrement en cours...' : idDevisEdite ? 'Enregistrer les modifications' : 'Enregistrer le Devis Tous Dommages'}
            </button>
          </div>
        </div>
      )}

      {createdQuote && (
        <ViewQuoteModal
          isOpen={Boolean(createdQuote)}
          quote={createdQuote}
          onClose={() => {
            setCreatedQuote(null);
            navigate('/user/quotes');
          }}
          onConvertToContract={handleConvertToContract}
        />
      )}

      <QuickAddClientModal
        isOpen={isQuickAddClientOpen}
        onClose={() => setIsQuickAddClientOpen(false)}
        onClientCreated={(newClient) => {
          setClients((prev) => [newClient, ...prev]);
          setSouscripteurId(Number(newClient.id || newClient.IdClient));
          setRechercheSouscripteur(newClient.nomcomplet || newClient.Nom);
        }}
      />
    </div>
  );
};

export default NewTousDommagesQuotePage;
