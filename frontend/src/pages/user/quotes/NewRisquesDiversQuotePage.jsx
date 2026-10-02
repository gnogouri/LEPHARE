import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { dataStore } from '../../../api/dataStore';
import { quoteApi, customerApi, settingsApi, contractApi, risquesDiversApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { ArrowLeft, ArrowRight, Check, Plus, Shield, AlertTriangle } from 'lucide-react';
import { ViewQuoteModal } from './ViewQuoteModal';
import { QuickAddClientModal } from '../clients/QuickAddClientModal';
import { TermeContratSelect } from '../../../components/common/TermeContratSelect';
import { DureeContratSelect } from '../../../components/common/DureeContratSelect';
import { ID_TERME_PAR_DEFAUT, dureeSelonTerme, termeEtDureeEnregistres } from '../../../utils/termesContrat';
import { sortUniqueBy, trierParLibelle } from '../../../utils/sortUtils';
import { AmountInput } from '../../../components/common/AmountInput';

// Produits servis par ce formulaire (même procédure URANUS : sp_creation_devis_risques_divers)
const PRODUITS = {
  7: { libelle: 'Multirisque Professionnelle', court: 'MRP', couleur: '#0891b2' },
  8: { libelle: 'Responsabilité Civile', court: 'RC', couleur: '#dc2626' },
};
// Offre RC chef de famille MINENE : primes calculées par la base, n° de police Santé connexe exigé
const ID_OFFRE_MINENE = 67;

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
    .map(([champ, v]) => `${champ} : ${Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(' ') : typeof v === 'object' ? JSON.stringify(v) : v}`)
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

// Ligne renvoyée par offregarantie{rc|mrp} -> garantie éditable du formulaire
const garantieDepuisApi = (r, acquise) => ({
  id: Number(r.IdSousGarantie),
  libelle: r.LibelleSousGarantie,
  acquise,
  capital: Math.round(Number(r.Capital) || 0),
  franchiseMinimum: Math.round(Number(r.FranchiseMinimum) || 0),
  franchiseMaximum: Math.round(Number(r.FranchiseMaximum) || 0),
  tauxFranchise: Number(r.TauxFranchise) || 0,
  montantFranchise: Math.round(Number(r.MontantFranchise) || 0),
  primeNette: Math.round(Number(r.PrimeNette) || 0),
});

export const NewRisquesDiversQuotePage = ({ produit }) => {
  const idProduit = Number(produit);
  const infos = PRODUITS[idProduit];
  const estRc = idProduit === 8;
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  // « Modifier » depuis le registre des devis : ?edit=<iddevis>
  const [searchParams] = useSearchParams();
  const editIddevisParam = searchParams.get('edit');
  const [isLoadingEdit, setIsLoadingEdit] = useState(Boolean(editIddevisParam));
  const [idDevisEdite, setIdDevisEdite] = useState(null);
  const [numeroDevisEdite, setNumeroDevisEdite] = useState('');
  const [idAvenant, setIdAvenant] = useState(1);

  const [step, setStep] = useState(1);
  const [createdQuote, setCreatedQuote] = useState(null);
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Référentiels
  const [clients, setClients] = useState([]);
  const [companies, setCompanies] = useState(() => dataStore.getActiveCompanies(infos?.court || 'RC'));
  const [tarifs, setTarifs] = useState([]);
  const [offres, setOffres] = useState([]);
  const [domaines, setDomaines] = useState([]);
  // Offre enregistrée sur le devis modifié : gardée même si la catégorie ne la propose pas
  const [offreDevis, setOffreDevis] = useState(null);

  // Étape 1 : contrat
  const [compagnieId, setCompagnieId] = useState(1);
  const [idTarif, setIdTarif] = useState(0);
  const [idOffre, setIdOffre] = useState(0);
  const [dureeId, setDureeId] = useState(4);
  const [termeId, setTermeId] = useState(ID_TERME_PAR_DEFAUT);
  // Date d'émission : toujours la date du jour, jamais saisie (le serveur l'impose aussi)
  const dateEmission = aujourdhui();
  const [dateEffet, setDateEffet] = useState(aujourdhui);
  const [expirationPersonnalisee, setExpirationPersonnalisee] = useState('');
  const [reduction, setReduction] = useState(0);
  const [numeroPoliceCompagnie, setNumeroPoliceCompagnie] = useState('');
  const [numeroPoliceConnexe, setNumeroPoliceConnexe] = useState('');
  const dateExpiration = useMemo(
    () => expirationPour(dateEffet, dureeId, expirationPersonnalisee),
    [dateEffet, dureeId, expirationPersonnalisee]
  );
  // Champs propres à la RC (complément du devis)
  const [activite, setActivite] = useState('');
  const [idDomaineActivite, setIdDomaineActivite] = useState(0);
  const [localisation, setLocalisation] = useState('');
  const [dateDebut, setDateDebut] = useState('');
  const [nombreParticipants, setNombreParticipants] = useState(0);
  const [assiettePrime, setAssiettePrime] = useState(0);
  const [tauxPrime, setTauxPrime] = useState(0);
  const [capitalDommageCorporel, setCapitalDommageCorporel] = useState(0);
  const [capitalIntoxication, setCapitalIntoxication] = useState(0);
  const [capitalDommageMateriel, setCapitalDommageMateriel] = useState(0);

  // Étape 2 : garanties
  const [garanties, setGaranties] = useState([]);
  const [offreDesGaranties, setOffreDesGaranties] = useState(null);
  const [chargementGaranties, setChargementGaranties] = useState(false);
  const [primeTarif, setPrimeTarif] = useState(null);

  // Étape 3 : primes et assuré
  const [primeNette, setPrimeNette] = useState(0);
  const [accessoire, setAccessoire] = useState(0);
  const [taxe, setTaxe] = useState(0);
  const primeTtc = (Number(primeNette) || 0) + (Number(accessoire) || 0) + (Number(taxe) || 0);
  const [souscripteurId, setSouscripteurId] = useState(0);
  const [rechercheSouscripteur, setRechercheSouscripteur] = useState('');
  const [listeSouscripteurOuverte, setListeSouscripteurOuverte] = useState(false);
  const [assureId, setAssureId] = useState(0);
  const [rechercheAssure, setRechercheAssure] = useState('');
  const [listeAssureOuverte, setListeAssureOuverte] = useState(false);
  const [telephoneAssure, setTelephoneAssure] = useState('');
  const [adresseGeo, setAdresseGeo] = useState('');

  const offreMinene = Number(idOffre) === ID_OFFRE_MINENE;
  // Devis repris d'URANUS sans ligne de détail en base
  const [avertissementReprise, setAvertissementReprise] = useState('');

  // -------------------------------------------------------------
  // RÉFÉRENTIELS
  // -------------------------------------------------------------
  useEffect(() => {
    let actif = true;
    (async () => {
      const [cls, cies, trfs, doms] = await Promise.all([
        customerApi.getClients().catch(() => []),
        settingsApi.getCompanies().catch(() => []),
        risquesDiversApi.getTarifs(idProduit).catch(() => []),
        estRc ? risquesDiversApi.getDomaines().catch(() => []) : Promise.resolve([]),
      ]);
      if (!actif) return;
      if (cls && cls.length) {
        setClients((prev) => [...prev.filter((p) => !cls.some((c) => String(c.id) === String(p.id))), ...cls]);
      }
      if (cies && cies.length) setCompanies(cies.map((c) => ({ id: c.IdCompagnie || c.id, nom: c.RaisonSociale || c.nom })));
      setTarifs(trfs || []);
      setDomaines(doms || []);
      if (!editIddevisParam && trfs && trfs.length) setIdTarif((courant) => courant || Number(trfs[0].IdTarif));
    })();
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idProduit]);

  // Offres de la catégorie
  useEffect(() => {
    let actif = true;
    if (!idTarif) return undefined;
    risquesDiversApi.getOffres(idProduit, idTarif).catch(() => []).then((reponse) => {
      if (!actif) return;
      const liste = [...(reponse || [])];
      if (offreDevis && Number(offreDevis.idTarif) === Number(idTarif)
        && !liste.some((o) => Number(o.IdOffre) === Number(offreDevis.IdOffre))) {
        liste.unshift({ IdOffre: offreDevis.IdOffre, LibelleOffre: offreDevis.LibelleOffre });
      }
      setOffres(liste);
      setIdOffre((courant) => (liste.some((o) => Number(o.IdOffre) === Number(courant))
        ? courant
        : Number(liste[0]?.IdOffre) || 0));
    });
    return () => { actif = false; };
  }, [idProduit, idTarif, offreDevis]);

  // -------------------------------------------------------------
  // GARANTIES DE L'OFFRE (et, en modification, celles enregistrées sur le devis)
  // -------------------------------------------------------------
  const capitauxRc = () => (estRc ? {
    CapitalDommageCorporel: Number(capitalDommageCorporel) || 0,
    CapitalIntoxicationAlimentaire: Number(capitalIntoxication) || 0,
    CapitalDommageMateriel: Number(capitalDommageMateriel) || 0,
    AssiettePrime: Number(assiettePrime) || 0,
    TauxPrime: Number(tauxPrime) || 0,
  } : {});

  const chargerGaranties = async ({ depuisDevis = null } = {}) => {
    if (!idOffre) return;
    setChargementGaranties(true);
    try {
      const commun = {
        idCompagnie: compagnieId, idOffre, tauxReduction: reduction, dateEffet, dateExpiration, capitaux: capitauxRc(),
      };
      const [offre, devis] = await Promise.all([
        risquesDiversApi.getGaranties(idProduit, commun),
        depuisDevis ? risquesDiversApi.getGaranties(idProduit, { ...commun, idDevis: depuisDevis }) : Promise.resolve([]),
      ]);
      const lignesDevis = (devis || []).filter((r) => Number(r.IdGarantie) !== 0 && Number(r.IdSousGarantie) !== 0 && r.Acquise);
      const enregistrees = new Map(lignesDevis.map((r) => [Number(r.IdSousGarantie), garantieDepuisApi(r, true)]));
      const liste = (offre || [])
        .filter((r) => Number(r.IdGarantie) !== 0 && Number(r.IdSousGarantie) !== 0)
        // Création : toutes cochées (comme URANUS) ; modification : cochées = enregistrées sur le devis
        .map((r) => enregistrees.get(Number(r.IdSousGarantie)) || garantieDepuisApi(r, !depuisDevis));
      // Garanties du devis qui ne figurent plus dans l'offre : conservées
      lignesDevis.forEach((r) => {
        if (!liste.some((g) => g.id === Number(r.IdSousGarantie))) liste.push(garantieDepuisApi(r, true));
      });
      setGaranties(trierParLibelle(liste, (g) => g.libelle));
      const cumul = (offre || []).find((r) => Number(r.IdGarantie) === 0);
      setPrimeTarif(cumul ? Math.round(Number(cumul.PrimeNette) || 0) : null);
      setOffreDesGaranties(Number(idOffre));
    } catch (err) {
      toastError(`Garanties de l'offre non chargées : ${messageErreurApi(err)}`);
    } finally {
      setChargementGaranties(false);
    }
  };

  // Passage à l'étape « Garanties » : charge celles de l'offre si l'offre a changé
  useEffect(() => {
    if (step === 2 && idOffre && offreDesGaranties !== Number(idOffre) && !isLoadingEdit) chargerGaranties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, idOffre, isLoadingEdit]);

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
          risquesDiversApi.lireDevis(editIddevisParam).catch((e) => {
            if (e?.response?.status === 404) return null;
            throw e;
          }),
        ]);
        if (!actif) return;
        const raw = devis?.raw || {};
        const ligne = ligneLue || {
          IdTarif: 0,
          IdOffre: Number(raw.offre?.IdOffre ?? raw.offre) || 0,
          TauxReduction: 0,
        };
        setAvertissementReprise(ligneLue ? '' : (
          `Ce devis repris d'URANUS n'a aucune ligne de détail en base (catégorie, garanties${estRc ? ', risque assuré' : ''}) : `
          + 'seuls l\'en-tête et les primes ont été repris. Choisissez la catégorie et cochez les garanties avant d\'enregistrer.'
        ));
        if (raw.confirme) {
          toastError('Ce devis est confirmé (déjà en contrat) : il ne peut plus être modifié.');
          navigate('/user/quotes');
          return;
        }
        setIdDevisEdite(Number(editIddevisParam));
        setNumeroDevisEdite(raw.numerodevis || '');
        setIdAvenant(Number(raw.avenant?.IdAvenant ?? raw.avenant) || 1);
        const compagnie = Number(raw.compagnie?.IdCompagnie ?? raw.compagnie) || 1;
        setCompagnieId(compagnie);
        setOffreDevis({
          idTarif: Number(ligne.IdTarif) || 0,
          IdOffre: Number(ligne.IdOffre) || 0,
          LibelleOffre: raw.offre?.LibelleOffre || `Offre n° ${ligne.IdOffre}`,
        });
        setIdTarif(Number(ligne.IdTarif) || 0);
        setIdOffre(Number(ligne.IdOffre) || 0);
        // Durée libre et terme « Autre » vont ensemble (anciens devis « Divers » compris)
        const charge = termeEtDureeEnregistres(raw.idterme, raw.idduree);
        setDureeId(charge.dureeId);
        setTermeId(charge.termeId);
        setDateEffet(jour(raw.dateeffet) || aujourdhui());
        setExpirationPersonnalisee(jour(raw.dateexpiration));
        setReduction(Number(ligne.TauxReduction) || 0);
        setNumeroPoliceCompagnie(raw.numero_police_compagnie || '');
        setNumeroPoliceConnexe(raw.numero_police_connexe || raw.numeropoliceconnexe || '');
        setActivite(ligne.Activite || '');
        setIdDomaineActivite(Number(ligne.IdDomaineActivite) || 0);
        setLocalisation(ligne.Localisation || '');
        setDateDebut(jour(ligne.DateDebut));
        setNombreParticipants(Number(ligne.NombreParticipants) || 0);
        setAssiettePrime(Math.round(Number(ligne.AssiettePrime) || 0));
        setTauxPrime(Number(ligne.TauxPrime) || 0);
        setCapitalDommageCorporel(Math.round(Number(ligne.CapitalDommageCorporel) || 0));
        setCapitalIntoxication(Math.round(Number(ligne.CapitalIntoxicationAlimentaire) || 0));
        setCapitalDommageMateriel(Math.round(Number(ligne.CapitalDommageMateriel) || 0));
        // Primes : saisies à la création (ou calculées par la base pour MINENE), donc reprises
        // telles qu'enregistrées. Les devis repris d'URANUS n'ont pas le drapeau prime_imposee :
        // ne les reprendre que dans ce cas les affichait à 0.
        setPrimeNette(Math.round(Number(raw.primenette) || 0));
        setAccessoire(Math.round(Number(raw.accessoire) || 0));
        setTaxe(Math.round(Number(raw.taxe) || 0));

        // Souscripteur et assuré
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
        setAdresseGeo(assure?.raw?.Adresse2 || '');

        // Garanties enregistrées sur le devis (cochées, capitaux, franchises)
        const commun = {
          idCompagnie: compagnie,
          idOffre: Number(ligne.IdOffre),
          tauxReduction: Number(ligne.TauxReduction) || 0,
          dateEffet: jour(raw.dateeffet),
          dateExpiration: jour(raw.dateexpiration),
        };
        const [offre, lignesDevis] = await Promise.all([
          risquesDiversApi.getGaranties(idProduit, commun).catch(() => []),
          risquesDiversApi.getGaranties(idProduit, { ...commun, idDevis: Number(editIddevisParam) }).catch(() => []),
        ]);
        if (!actif) return;
        const enregistrees = (lignesDevis || []).filter((r) => Number(r.IdGarantie) !== 0 && Number(r.IdSousGarantie) !== 0 && r.Acquise);
        const parId = new Map(enregistrees.map((r) => [Number(r.IdSousGarantie), garantieDepuisApi(r, true)]));
        const liste = (offre || [])
          .filter((r) => Number(r.IdGarantie) !== 0 && Number(r.IdSousGarantie) !== 0)
          .map((r) => parId.get(Number(r.IdSousGarantie)) || garantieDepuisApi(r, false));
        enregistrees.forEach((r) => {
          if (!liste.some((g) => g.id === Number(r.IdSousGarantie))) liste.push(garantieDepuisApi(r, true));
        });
        setGaranties(trierParLibelle(liste, (g) => g.libelle));
        setOffreDesGaranties(Number(ligne.IdOffre));
      } catch (err) {
        if (actif) toastError(`Impossible de charger le devis à modifier : ${messageErreurApi(err)}`);
      } finally {
        if (actif) setIsLoadingEdit(false);
      }
    })();
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editIddevisParam, idProduit]);

  const majGarantie = (id, champ, valeur) => setGaranties((prev) => prev.map((g) => (g.id === id ? { ...g, [champ]: valeur } : g)));
  const garantiesAcquises = garanties.filter((g) => g.acquise);

  // -------------------------------------------------------------
  // ENREGISTREMENT (création, ou modification du même devis)
  // -------------------------------------------------------------
  const handleSave = async () => {
    if (!idOffre) { toastError('Choisissez une offre.'); setStep(1); return; }
    if (!dateExpiration) { toastError('Saisissez la date d\'expiration.'); setStep(1); return; }
    if (offreMinene && !numeroPoliceConnexe.trim()) { toastError('Offre MINENE : saisissez le n° de police Santé connexe.'); setStep(1); return; }
    if (!offreMinene && !garantiesAcquises.length) { toastError('Cochez au moins une garantie.'); setStep(2); return; }
    if (!offreMinene && !(Number(primeNette) > 0)) {
      toastError('Saisissez la prime nette : elle est répartie sur les garanties cochées.');
      setStep(3);
      return;
    }
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
      NumeroPoliceCompagnie: numeroPoliceCompagnie || '',
      IdProduit: idProduit,
      IdOffre: Number(idOffre),
      IdAvenant: idAvenant || 1,
      IdClient: Number(souscripteurId),
      IdAssure: Number(assureId || souscripteurId),
      Flotte: false,
      Coassurance: false,
      DateEffet: dateEffet,
      DateExpiration: dateExpiration,
      DateEmission: dateEmission,
      IdTarif: Number(idTarif),
      TauxReduction: Number(reduction) || 0,
      TelephoneAssure: telephoneAssure || '',
      AdresseGeographique: adresseGeo || '',
      NumeroPoliceConnexe: numeroPoliceConnexe || '',
      PrimeNette: Number(primeNette) || 0,
      Accessoire: Number(accessoire) || 0,
      Taxe: Number(taxe) || 0,
      PrimeTTC: primeTtc,
      IdDevis: idDevisEdite || 0,
      IdDuree: Number(dureeId),
      IdTerme: Number(termeId),
      ListeGarantie: garantiesAcquises.map((g) => ({
        id_garantie: g.id,
        acquise: true,
        capital: Number(g.capital) || 0,
        montant_franchise: Number(g.montantFranchise) || 0,
        taux_franchise: Number(g.tauxFranchise) || 0,
        franchise_minimum: Number(g.franchiseMinimum) || 0,
        franchise_maximum: Number(g.franchiseMaximum) || 0,
      })),
      ...(estRc ? {
        Activite: activite || '',
        IdDomaineActivite: Number(idDomaineActivite) || 0,
        Localisation: localisation || '',
        ...(dateDebut ? { DateDebut: dateDebut } : {}),
        NombreParticipants: Number(nombreParticipants) || 0,
        TauxPrime: Number(tauxPrime) || 0,
        // Assiette nulle : non envoyée (le serveur remettait alors la durée à 0)
        ...(Number(assiettePrime) > 0 ? { AssiettePrime: Number(assiettePrime) } : {}),
        CapitalDommageCorporel: Number(capitalDommageCorporel) || 0,
        CapitalIntoxicationAlimentaire: Number(capitalIntoxication) || 0,
        CapitalDommageMateriel: Number(capitalDommageMateriel) || 0,
      } : {}),
    };

    setIsSubmitting(true);
    try {
      let res;
      try {
        res = await risquesDiversApi.enregistrer(idProduit, payload);
      } catch (errApi) {
        toastError(`Devis ${infos.court} non enregistré : ${messageErreurApi(errApi)}`);
        return;
      }
      const devisId = Number(res?.ObjectId) || 0;
      if (!devisId) {
        toastError(`Devis ${infos.court} non enregistré : ${res?.OutputMessage || 'réponse du serveur sans numéro de devis.'}`);
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
        produit: infos.libelle,
        branche: infos.court,
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
        ? `Devis ${infos.libelle} N° ${devisEnregistre?.numerodevis || devisId} modifié.`
        : `Devis ${infos.libelle} N° ${devisEnregistre?.numerodevis || devisId} enregistré.`);
      setCreatedQuote(devisEnregistre || saved);
    } catch (err) {
      toastError(`Erreur lors de l'enregistrement du devis ${infos.court} : ${messageErreurApi(err)}`);
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

  if (!infos) return <p style={{ padding: '2rem' }}>Produit inconnu.</p>;

  // -------------------------------------------------------------
  // AFFICHAGE
  // -------------------------------------------------------------
  const couleur = infos.couleur;
  const titreSection = { color: couleur, fontWeight: 800, textTransform: 'uppercase', fontSize: '1.05rem', margin: '0 0 1.25rem' };
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
          <button type="button" onClick={() => setIsQuickAddClientOpen(true)} style={{ background: 'transparent', border: 'none', color: couleur, cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
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
            <Shield size={26} color={couleur} />
            {editIddevisParam
              ? `Modifier le Devis ${infos.libelle}${numeroDevisEdite ? ` [${numeroDevisEdite}]` : ''}`
              : `Nouveau Devis ${infos.libelle} (${infos.court})`}
          </h1>
          {isLoadingEdit && <p style={{ color: couleur, fontSize: '0.875rem', fontWeight: 600 }}>Chargement du devis à modifier…</p>}
          {avertissementReprise && (
            <p style={{ marginTop: '0.5rem', padding: '0.6rem 0.75rem', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#f59e0b', fontSize: '0.85rem', maxWidth: '760px' }}>
              {avertissementReprise}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[{ n: 1, l: '1. CONTRAT' }, { n: 2, l: '2. GARANTIES' }, { n: 3, l: '3. PRIMES & ASSURÉ' }].map((e) => (
            <button
              key={e.n}
              type="button"
              onClick={() => setStep(e.n)}
              style={{
                padding: '0.5rem 0.95rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                border: step === e.n ? `2px solid ${couleur}` : '1px solid var(--border-subtle)',
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
                {trierParLibelle(tarifs, (t) => t.LibelleTarif).map((t) => (<option key={t.IdTarif} value={t.IdTarif}>{t.LibelleTarif}</option>))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Offre (* requis)</label>
              <select className="form-control" value={idOffre} onChange={(e) => setIdOffre(Number(e.target.value))}>
                {offres.length === 0 && <option value={0}>Aucune offre pour cette catégorie</option>}
                {trierParLibelle(offres, (o) => o.LibelleOffre).map((o) => (<option key={o.IdOffre} value={o.IdOffre}>{o.LibelleOffre}</option>))}
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
            {offreMinene && (
              <div className="form-group">
                <label className="form-label">N° de police Santé MINENE (* requis)</label>
                <input type="text" className="form-control" value={numeroPoliceConnexe} onChange={(e) => setNumeroPoliceConnexe(e.target.value)} />
              </div>
            )}
          </div>

          {estRc && (
            <>
              <h3 style={{ ...titreSection, marginTop: '2rem' }}>Risque assuré</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
                <div className="form-group">
                  <label className="form-label">Activité</label>
                  <input type="text" className="form-control" value={activite} onChange={(e) => setActivite(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Domaine d'activité</label>
                  <select className="form-control" value={idDomaineActivite} onChange={(e) => setIdDomaineActivite(Number(e.target.value))}>
                    <option value={0}>— Non précisé —</option>
                    {trierParLibelle(domaines, (d) => d.libelle).map((d) => (<option key={d.id_domaine_activite} value={d.id_domaine_activite}>{d.libelle}</option>))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Localisation</label>
                  <input type="text" className="form-control" value={localisation} onChange={(e) => setLocalisation(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Date de début (manifestation)</label>
                  <input type="date" className="form-control" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nombre de participants</label>
                  <input type="number" min="0" className="form-control" value={nombreParticipants} onChange={(e) => setNombreParticipants(Math.max(0, Number(e.target.value) || 0))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Assiette de prime</label>
                  <AmountInput value={assiettePrime} onChange={setAssiettePrime} />
                </div>
                <div className="form-group">
                  <label className="form-label">Taux de prime (%)</label>
                  <input type="number" min="0" step="0.01" className="form-control" value={tauxPrime} onChange={(e) => setTauxPrime(Math.max(0, Number(e.target.value) || 0))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Capital dommages corporels</label>
                  <AmountInput value={capitalDommageCorporel} onChange={setCapitalDommageCorporel} />
                </div>
                <div className="form-group">
                  <label className="form-label">Capital intoxication alimentaire</label>
                  <AmountInput value={capitalIntoxication} onChange={setCapitalIntoxication} />
                </div>
                <div className="form-group">
                  <label className="form-label">Capital dommages matériels</label>
                  <AmountInput value={capitalDommageMateriel} onChange={setCapitalDommageMateriel} />
                </div>
              </div>
            </>
          )}

          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-primary" onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: couleur }}>
              Suivant : Garanties <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ÉTAPE 2 : GARANTIES */}
      {step === 2 && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <h3 style={{ ...titreSection, margin: 0 }}>Garanties de l'offre ({garantiesAcquises.length} cochée{garantiesAcquises.length > 1 ? 's' : ''})</h3>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => chargerGaranties({ depuisDevis: idDevisEdite })} disabled={chargementGaranties}>
              {chargementGaranties ? 'Chargement…' : idDevisEdite ? 'Recharger (valeurs du devis)' : 'Recharger les garanties'}
            </button>
          </div>
          {offreMinene && (
            <p style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', color: '#fcd34d', fontSize: '0.85rem' }}>
              <AlertTriangle size={15} /> Offre MINENE : garanties et primes sont fixées par la base à l'enregistrement.
            </p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '0.83rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#94a3b8', fontSize: '0.72rem', borderBottom: '1px solid var(--border-subtle)' }}>
                  <th style={{ padding: '0.5rem', textAlign: 'center' }}>ACQUISE</th>
                  <th style={{ padding: '0.5rem', textAlign: 'left' }}>GARANTIE</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right', width: '170px' }}>CAPITAL</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right', width: '140px' }}>FRANCHISE MIN</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right', width: '140px' }}>FRANCHISE MAX</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right', width: '110px' }}>TAUX FRANCH. (%)</th>
                </tr>
              </thead>
              <tbody>
                {garanties.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>{chargementGaranties ? 'Chargement des garanties…' : 'Aucune garantie pour cette offre.'}</td></tr>
                )}
                {garanties.map((g) => (
                  <tr key={g.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: g.acquise ? 1 : 0.55 }}>
                    <td style={{ padding: '0.4rem', textAlign: 'center' }}>
                      <input type="checkbox" checked={g.acquise} onChange={() => majGarantie(g.id, 'acquise', !g.acquise)} />
                    </td>
                    <td style={{ padding: '0.4rem', fontWeight: 600 }}>{g.libelle}</td>
                    <td style={{ padding: '0.4rem' }}><AmountInput value={g.capital} onChange={(v) => majGarantie(g.id, 'capital', v)} suffix="" /></td>
                    <td style={{ padding: '0.4rem' }}><AmountInput value={g.franchiseMinimum} onChange={(v) => majGarantie(g.id, 'franchiseMinimum', v)} suffix="" /></td>
                    <td style={{ padding: '0.4rem' }}><AmountInput value={g.franchiseMaximum} onChange={(v) => majGarantie(g.id, 'franchiseMaximum', v)} suffix="" /></td>
                    <td style={{ padding: '0.4rem' }}>
                      <input type="number" min="0" step="0.01" className="form-control" value={g.tauxFranchise} onChange={(e) => majGarantie(g.id, 'tauxFranchise', Math.max(0, Number(e.target.value) || 0))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ArrowLeft size={16} /> Précédent
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(3)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: couleur }}>
              Suivant : Primes & assuré <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ÉTAPE 3 : PRIMES ET ASSURÉ */}
      {step === 3 && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          <h3 style={titreSection}>Primes</h3>
          {offreMinene ? (
            <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Offre MINENE : les primes sont calculées par la base à l'enregistrement.</p>
          ) : (
            <>
              <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: 0 }}>
                Comme dans URANUS, la prime nette saisie est répartie par la base sur les garanties cochées ; l'accessoire et la taxe sont enregistrés tels que saisis.
                {primeTarif > 0 && ` Prime calculée au tarif pour ces capitaux : ${fcfa(primeTarif)} FCFA.`}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
                <div className="form-group">
                  <label className="form-label">Prime nette (* requis)</label>
                  <AmountInput value={primeNette} onChange={setPrimeNette} />
                </div>
                <div className="form-group">
                  <label className="form-label">Accessoire</label>
                  <AmountInput value={accessoire} onChange={setAccessoire} />
                </div>
                <div className="form-group">
                  <label className="form-label">Taxe</label>
                  <AmountInput value={taxe} onChange={setTaxe} />
                </div>
                <div className="form-group">
                  <label className="form-label">Prime TTC</label>
                  <input type="text" className="form-control" readOnly value={`${fcfa(primeTtc)} FCFA`} style={{ fontWeight: 800, background: 'rgba(255,255,255,0.05)' }} />
                </div>
              </div>
            </>
          )}

          <h3 style={{ ...titreSection, marginTop: '2rem' }}>Souscripteur et assuré</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
            {champClient('Souscripteur (* requis)', rechercheSouscripteur, setRechercheSouscripteur, listeSouscripteurOuverte, setListeSouscripteurOuverte, (c) => {
              setSouscripteurId(Number(c.id));
              if (!assureId) {
                setAssureId(Number(c.id));
                setRechercheAssure(c.nomcomplet);
                setTelephoneAssure(c.raw?.Mobile || c.raw?.Telephone || '');
                setAdresseGeo(c.raw?.Adresse2 || '');
              }
            }, true)}
            {champClient('Assuré', rechercheAssure, setRechercheAssure, listeAssureOuverte, setListeAssureOuverte, (c) => {
              setAssureId(Number(c.id));
              setTelephoneAssure(c.raw?.Mobile || c.raw?.Telephone || '');
              setAdresseGeo(c.raw?.Adresse2 || '');
            }, false)}
            <div className="form-group">
              <label className="form-label">Téléphone de l'assuré</label>
              <input type="tel" className="form-control" value={telephoneAssure} onChange={(e) => setTelephoneAssure(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Adresse géographique</label>
              <input type="text" className="form-control" value={adresseGeo} onChange={(e) => setAdresseGeo(e.target.value)} />
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
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: couleur, padding: '0.75rem 1.5rem', fontWeight: 800 }}
            >
              <Check size={18} />
              {isSubmitting ? 'Enregistrement en cours...' : idDevisEdite ? 'Enregistrer les modifications' : `Enregistrer le Devis ${infos.court}`}
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

export default NewRisquesDiversQuotePage;
