import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { quoteApi, customerApi, settingsApi, contractApi, santeApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import {
  HeartPulse,
  ArrowRight,
  ArrowLeft,
  Plus,
  Trash2,
  Edit3,
  Save,
  Upload,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Check,
  X,
} from 'lucide-react';
import { ViewQuoteModal } from './ViewQuoteModal';
import { QuickAddClientModal } from '../clients/QuickAddClientModal';
import { TermeContratSelect } from '../../../components/common/TermeContratSelect';
import { DureeContratSelect } from '../../../components/common/DureeContratSelect';
import { AmountInput } from '../../../components/common/AmountInput';
import {
  ID_TERME_PAR_DEFAUT,
  dureeSelonTerme,
  estDureeLibre,
  idTermeValide,
  termeEtDureeEnregistres,
} from '../../../utils/termesContrat';
import { sortUniqueBy } from '../../../utils/sortUtils';

// Production Santé fidèle à URANUS (SanteForm) : 1. Contrat, 2. Couvertures souscrites (filiales :
// collège × formule × zone), 3. Affiliation (adhérents, affiliés) et primes. La saisie est portée
// par un devis initialisé au premier enregistrement (numéro de saisie d'URANUS) ; les primes sont
// calculées par la base (sp_creation_devis_sante). Libellés et valeurs : ceux d'URANUS et de la base.

// Gestionnaire des contrats Santé dans URANUS (champ non modifiable)
const GESTIONNAIRE_SANTE = 'VITALIS SANTE';
// Catégories MINENE (code catégorie 123 : tarifs 87, 102 et 153) : prime calculée automatiquement,
// zone CÔTE D'IVOIRE, durée annuelle
const CODE_CATEGORIE_MINENE = '123';
const ID_ZONE_COTE_IVOIRE = 1;
const ID_DUREE_ANNUELLE = 4;
const TYPE_CONTRAT_SOCIETE = 2;
// Groupes sanguins dans l'ordre de l'écran URANUS (NS = INFO NON DISPONIBLE)
const GROUPES_SANGUINS = [
  ['NS', 'INFO NON DISPONIBLE'],
  ['A+', 'Groupe A+'],
  ['B+', 'Groupe B+'],
  ['AB+', 'Groupe AB+'],
  ['O+', 'Groupe O+'],
  ['A-', 'Groupe A-'],
  ['B-', 'Groupe B-'],
  ['AB-', 'Groupe AB-'],
  ['O-', 'Groupe O-'],
];
const SEXES = [['F', 'Féminin'], ['M', 'Masculin']];
// Colonnes du fichier d'import d'URANUS (sante/utils.py, ligne d'en-tête, casse indifférente)
const COLONNES_IMPORT = 'Nom, Prenoms, NumeroCNI, DateNaissance, NumeroCMU, Sexe, NumeroTelephone, LienParente (A, C ou E), '
  + 'DateEffet, DateEntree, AdresseAdherent, EmailAdherent, NombreAffection, Matricule, GroupeSanguin';

const aujourdhui = () => new Date().toISOString().split('T')[0];
const jour = (v) => (v ? String(v).slice(0, 10) : '');
const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
const dateFr = (v) => (v ? jour(v).split('-').reverse().join('/') : '');
const age = (naissance) => {
  if (!naissance) return null;
  const n = new Date(naissance);
  const t = new Date();
  let a = t.getFullYear() - n.getFullYear();
  if (t.getMonth() < n.getMonth() || (t.getMonth() === n.getMonth() && t.getDate() < n.getDate())) a -= 1;
  return a;
};
const expirationAnnuelle = (dateEffet) => {
  if (!dateEffet) return '';
  const d = new Date(dateEffet);
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};
const contientCoteIvoire = (libelle) => /C[OÔ]TE D'IVOIRE/i.test(libelle || '');

// Message lisible d'une erreur renvoyée par l'API
const messageErreurApi = (err) => {
  const data = err?.response?.data;
  if (!data) return err?.message || 'serveur injoignable';
  if (typeof data === 'string') return data.slice(0, 200);
  const direct = data.error || data.message || data.detail;
  if (direct) return typeof direct === 'string' ? direct : JSON.stringify(direct);
  return Object.entries(data).map(([k, v]) => `${k} : ${Array.isArray(v) ? v.join(' ') : v}`).join(' ; ');
};

const adherentVide = (client, filiale) => ({
  idadherent: 0,
  filiale: filiale || 0,
  nom: client?.nom || '',
  prenom: client?.prenom || '',
  datenaissance: jour(client?.raw?.DateNaissance),
  sexe: 'F',
  cni: client?.CniPat || '',
  numerocmu: '',
  adresse: client?.adresse || '',
  matricule: '',
  groupesanguin: 'NS',
  nombrepathologie: 0,
  surprimeappliquee: false,
  montantsurprime: 0,
  mobile1: client?.telephone || '',
  email: client?.email || '',
  dateeffet: aujourdhui(),
  datedebutconsommation: aujourdhui(),
  fichier: null,
  fichierpiece: '',
});

const affilieVide = (idAdherent) => ({
  idaffilie: 0,
  adherent: idAdherent,
  lien: 'C',
  nom: '',
  prenom: '',
  cni: '',
  numerocmu: '',
  groupesanguin: 'NS',
  matricule: '',
  observations: '',
  surprimeappliquee: false,
  montantsurprime: 0,
  nombrepathologie: 0,
  handicape: false,
  certificat: false,
  sexe: 'F',
  datenaissance: '',
  dateeffet: aujourdhui(),
  datedebutconsommation: aujourdhui(),
  fichier: null,
  fichierpiece: '',
});

const versFormData = (objet) => {
  const fd = new FormData();
  Object.entries(objet).forEach(([cle, valeur]) => {
    if (cle === 'fichier' || cle === 'fichierpiece') return;
    fd.append(cle, typeof valeur === 'boolean' ? String(valeur) : (valeur ?? ''));
  });
  if (objet.fichier) fd.append('fichierpiece', objet.fichier);
  return fd;
};

export const NewSanteQuotePage = () => {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  // « Modifier » depuis le registre : /user/quotes/sante?edit=<iddevis>
  const [searchParams] = useSearchParams();
  const editParam = searchParams.get('edit');
  const [chargementEdition, setChargementEdition] = useState(Boolean(editParam));
  const [lectureSeule, setLectureSeule] = useState('');
  const [numeroDevis, setNumeroDevis] = useState('');
  const [totauxEnregistres, setTotauxEnregistres] = useState(null);
  const [garanties, setGaranties] = useState([]);

  const [step, setStep] = useState(1);
  const [createdQuote, setCreatedQuote] = useState(null);
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);
  const [occupe, setOccupe] = useState(false);

  // Référentiels
  const [clients, setClients] = useState([]);
  const [compagnies, setCompagnies] = useState([]);
  const [tarifs, setTarifs] = useState([]);
  const [typesContrat, setTypesContrat] = useState([]);
  const [zones, setZones] = useState([]);
  const [liens, setLiens] = useState([]);
  const [formules, setFormules] = useState([]);
  const [colleges, setColleges] = useState([]);

  // 1. CONTRAT
  const [numeroPoliceCompagnie, setNumeroPoliceCompagnie] = useState('');
  const [typeContrat, setTypeContrat] = useState(1);
  const [compagnieId, setCompagnieId] = useState(1);
  const [idTarif, setIdTarif] = useState(0);
  const [ajustement, setAjustement] = useState('reduction');
  const [taux, setTaux] = useState(0);
  const [termeId, setTermeId] = useState(ID_TERME_PAR_DEFAUT);
  const [dureeId, setDureeId] = useState(ID_DUREE_ANNUELLE);
  // Date d'émission : toujours la date du jour (le serveur l'impose aussi)
  const dateEmission = aujourdhui();
  const [dateEffet, setDateEffet] = useState(aujourdhui);
  const [expirationLibre, setExpirationLibre] = useState('');
  const dateExpiration = estDureeLibre(dureeId) ? expirationLibre : expirationAnnuelle(dateEffet);

  // 2. COUVERTURES SOUSCRITES
  const [idOffre, setIdOffre] = useState(0);
  const [idCollege, setIdCollege] = useState(0);
  const [idZone, setIdZone] = useState(ID_ZONE_COTE_IVOIRE);
  const [filiales, setFiliales] = useState([]);
  // Devis qui porte la saisie (0 tant que rien n'est enregistré)
  const [idDevis, setIdDevis] = useState(0);

  // 3. AFFILIATION ET PRIMES
  const [clientId, setClientId] = useState(0);
  const [rechercheClient, setRechercheClient] = useState('');
  const [listeClientsOuverte, setListeClientsOuverte] = useState(false);
  const [adherents, setAdherents] = useState([]);
  const [affilies, setAffilies] = useState([]);
  const [adherentOuvert, setAdherentOuvert] = useState(null);
  const [formAdherent, setFormAdherent] = useState(null);
  const [formAffilie, setFormAffilie] = useState(null);
  const [importOuvert, setImportOuvert] = useState(false);
  const [fichierImport, setFichierImport] = useState(null);
  const [filialeImport, setFilialeImport] = useState(0);
  const [primeFamille, setPrimeFamille] = useState(0);
  const [primeAffilie, setPrimeAffilie] = useState(0);
  const [primeGlobale, setPrimeGlobale] = useState(0);
  const [montantSurprime, setMontantSurprime] = useState(0);
  const [accessoireManuel, setAccessoireManuel] = useState(0);
  // Répartition MINENE (document OREOLE « TARIFICATION MINENE SANTE »)
  const [avecApporteur, setAvecApporteur] = useState(false);
  const [repartition, setRepartition] = useState(null);
  const [repartitionErreur, setRepartitionErreur] = useState('');

  const tarifChoisi = tarifs.find((t) => Number(t.IdTarif) === Number(idTarif));
  const estMinene = String(tarifChoisi?.CodeCategorie || '') === CODE_CATEGORIE_MINENE;
  const formuleChoisie = formules.find((f) => Number(f.IdOffre) === Number(idOffre));
  const zoneImposee = estMinene || contientCoteIvoire(formuleChoisie?.LibelleOffre);
  const client = clients.find((c) => String(c.id) === String(clientId));
  const tauxMax = Number(typeContrat) === TYPE_CONTRAT_SOCIETE ? 35 : 100;
  const primesSaisies = [primeFamille, primeAffilie, primeGlobale].filter((p) => Number(p) > 0).length;
  const desactive = Boolean(lectureSeule) || occupe;

  // ------------------------------------------------------------------
  // RÉFÉRENTIELS
  // ------------------------------------------------------------------
  useEffect(() => {
    let actif = true;
    (async () => {
      const [cls, cies, trfs, types, zns, lns] = await Promise.all([
        customerApi.getClients().catch(() => []),
        settingsApi.getCompanies().catch(() => []),
        santeApi.getTarifs().catch(() => []),
        santeApi.getTypesContrat().catch(() => []),
        santeApi.getZones().catch(() => []),
        santeApi.getLiens().catch(() => []),
      ]);
      if (!actif) return;
      setClients((prev) => [...prev.filter((p) => !(cls || []).some((c) => String(c.id) === String(p.id))), ...(cls || [])]);
      setCompagnies((cies || []).map((c) => ({ id: c.IdCompagnie || c.id, nom: c.RaisonSociale || c.nom })));
      setTarifs(trfs || []);
      setTypesContrat(types || []);
      setZones(zns || []);
      setLiens(lns || []);
      if (!editParam) {
        if (trfs?.[0]) setIdTarif(Number(trfs[0].IdTarif));
        if (types?.[0]) setTypeContrat(Number(types[0].id_type_contrat));
      }
    })();
    return () => { actif = false; };
  }, [editParam]);

  // Formules de couverture de l'offre commerciale (catégorie)
  useEffect(() => {
    let actif = true;
    if (!idTarif) return undefined;
    santeApi.getFormules(idTarif).catch(() => []).then((liste) => {
      if (!actif) return;
      setFormules(liste || []);
      setIdOffre((courant) => ((liste || []).some((f) => Number(f.IdOffre) === Number(courant))
        ? courant
        : Number(liste?.[0]?.IdOffre) || 0));
    });
    return () => { actif = false; };
  }, [idTarif]);

  // Collèges de la formule ; zone : CÔTE D'IVOIRE imposée en MINENE ou si la formule l'indique
  useEffect(() => {
    let actif = true;
    if (!idOffre) { setColleges([]); return undefined; }
    santeApi.getColleges(idOffre).catch(() => []).then((liste) => {
      if (!actif) return;
      setColleges(liste || []);
      setIdCollege((courant) => ((liste || []).some((c) => Number(c.idcollege) === Number(courant))
        ? courant
        : Number(liste?.[0]?.idcollege) || 0));
    });
    return () => { actif = false; };
  }, [idOffre]);

  useEffect(() => {
    if (zoneImposee) setIdZone(ID_ZONE_COTE_IVOIRE);
    else if (formuleChoisie?.IdZoneCouverture) setIdZone(Number(formuleChoisie.IdZoneCouverture));
  }, [zoneImposee, formuleChoisie]);

  // MINENE : durée annuelle par défaut (URANUS)
  useEffect(() => {
    if (estMinene && !estDureeLibre(dureeId)) setDureeId(ID_DUREE_ANNUELLE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estMinene]);

  // ------------------------------------------------------------------
  // SAISIE PORTÉE PAR LE DEVIS
  // ------------------------------------------------------------------
  const appliquerSaisie = (donnees) => {
    setFiliales(donnees.filiales || []);
    setAdherents(donnees.adherents || []);
    setAffilies(donnees.affilies || []);
    setGaranties(donnees.garanties || []);
  };

  const recharger = async (id = idDevis) => {
    if (!id) return null;
    const donnees = await santeApi.lireDevis(id);
    appliquerSaisie(donnees);
    return donnees;
  };

  // « Modifier » : tout ce qui a été saisi sur le devis
  useEffect(() => {
    if (!editParam) return undefined;
    let actif = true;
    (async () => {
      setChargementEdition(true);
      try {
        const donnees = await santeApi.lireDevis(editParam);
        if (!actif) return;
        const { devis, detail } = donnees;
        if (devis.confirme) {
          toastError('Ce devis est confirmé (déjà en contrat) : il ne peut plus être modifié.');
          navigate('/user/quotes');
          return;
        }
        const charge = termeEtDureeEnregistres(devis.idterme, devis.idduree);
        setIdDevis(Number(devis.iddevis));
        setNumeroDevis(devis.numerodevis || '');
        setCompagnieId(Number(devis.idcompagnie) || 1);
        setNumeroPoliceCompagnie(devis.numeropolicecompagnie || '');
        setTermeId(charge.termeId);
        setDureeId(charge.dureeId);
        setDateEffet(jour(devis.dateeffet) || aujourdhui());
        setExpirationLibre(jour(devis.dateexpiration));
        setClientId(Number(devis.idclient) || 0);
        setRechercheClient(devis.client_nom || '');
        // Libellé du client tel que la liste l'affiche (raison sociale, nom et prénoms…)
        if (devis.idclient) {
          customerApi.getClientDetail(devis.idclient).then((c) => {
            if (!actif || !c) return;
            setClients((prev) => (prev.some((p) => String(p.id) === String(c.id)) ? prev : [c, ...prev]));
            setRechercheClient(c.nomcomplet || devis.client_nom || '');
          }).catch(() => {});
        }
        setTotauxEnregistres({
          primeNette: devis.primenette, taxe: devis.taxe, accessoire: devis.accessoire, primeTtc: devis.primettc,
        });
        if (detail) {
          setIdTarif(Number(detail.idtarif) || 0);
          setIdOffre(Number(detail.idoffre) || 0);
          if (detail.idtypecontrat) setTypeContrat(Number(detail.idtypecontrat));
          const t = Number(detail.tauxreductioncommerciale) || 0;
          setAjustement(t < 0 ? 'majoration' : 'reduction');
          setTaux(Math.abs(t));
          setPrimeFamille(Math.round(Number(detail.primefamille) || 0));
          setPrimeAffilie(Math.round(Number(detail.primeaffilie) || 0));
          setPrimeGlobale(Math.round(Number(detail.primeglobale) || 0));
          setMontantSurprime(Math.round(Number(detail.montantsurprime) || 0));
          setAccessoireManuel(Math.round(Number(detail.montantaccessoiremanuel) || 0));
        } else if (donnees.filiales?.[0]) {
          setIdTarif(Number(donnees.filiales[0].idtarif) || 0);
          setIdOffre(Number(donnees.filiales[0].idoffresante) || 0);
        }
        appliquerSaisie(donnees);
        if (!devis.operateur_courant) {
          setLectureSeule(devis.operateur_saisie
            ? `Saisie ouverte dans URANUS par l'opérateur n° ${devis.operateur_saisie} : la base n'accepte ses modifications que de cet opérateur. Le devis est affiché en lecture seule.`
            : 'Devis repris sans saisie ouverte : la base n\'accepte pas de modification. Le devis est affiché en lecture seule.');
        }
      } catch (err) {
        if (actif) toastError(`Impossible de charger le devis à modifier : ${messageErreurApi(err)}`);
      } finally {
        if (actif) setChargementEdition(false);
      }
    })();
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam]);

  // Répartition MINENE : prime HT connue (enregistrée, ou saisie) ; sinon calculée à l'enregistrement
  const nombreAffilies = affilies.length;
  const primeHtConnue = useMemo(() => {
    if (Number(primeGlobale) > 0) return Number(primeGlobale);
    if (Number(primeFamille) > 0) return Number(primeFamille) * adherents.length;
    if (Number(primeAffilie) > 0) return Number(primeAffilie) * nombreAffilies;
    return Number(totauxEnregistres?.primeNette) || 0;
  }, [primeGlobale, primeFamille, primeAffilie, adherents.length, nombreAffilies, totauxEnregistres]);

  useEffect(() => {
    let actif = true;
    if (!estMinene || primeHtConnue <= 0) { setRepartition(null); setRepartitionErreur(''); return undefined; }
    settingsApi.calculerRepartitionPrimeSante(primeHtConnue, avecApporteur)
      .then((d) => { if (actif) { setRepartition(d); setRepartitionErreur(''); } })
      .catch((err) => { if (actif) { setRepartition(null); setRepartitionErreur(messageErreurApi(err)); } });
    return () => { actif = false; };
  }, [estMinene, primeHtConnue, avecApporteur]);

  // ------------------------------------------------------------------
  // ACTIONS
  // ------------------------------------------------------------------
  const assurerSaisie = async () => {
    if (idDevis) return idDevis;
    const res = await santeApi.initialiser();
    setIdDevis(Number(res.devis));
    return Number(res.devis);
  };

  const executer = async (action, messageEchec) => {
    setOccupe(true);
    try {
      return await action();
    } catch (err) {
      toastError(`${messageEchec} : ${messageErreurApi(err)}`);
      return null;
    } finally {
      setOccupe(false);
    }
  };

  const enregistrerCouverture = () => executer(async () => {
    if (!idOffre || !idCollege || !idZone) { toastError('Choisissez la formule de couverture, le collège et la zone.'); return; }
    if (!dateEffet || !dateExpiration) { toastError('Saisissez les dates d\'effet et d\'expiration (étape Contrat).'); setStep(1); return; }
    const id = await assurerSaisie();
    const res = await santeApi.enregistrerFiliale({
      devis: id, college: idCollege, offresante: idOffre, zonecouverture: idZone,
      date_effet: dateEffet, date_expiration: dateExpiration, source: 'S',
    });
    await recharger(id);
    success(res.message || 'Collège enregistré.');
  }, 'Collège non enregistré');

  const supprimer = (type, idObjet, libelle) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Retirer ${libelle} de la saisie ?`)) return;
    executer(async () => {
      const res = await santeApi.supprimer({ type, id_devis: idDevis, id_objet: idObjet });
      await recharger();
      success(res.message || 'Suppression réalisée.');
    }, 'Suppression impossible');
  };

  const ouvrirNouvelAdherent = () => {
    if (!filiales.length) { toastError('Enregistrez d\'abord une couverture (étape 2).'); setStep(2); return; }
    setFormAffilie(null);
    // Comme URANUS, le premier adhérent reprend la fiche du client
    setFormAdherent(adherentVide(adherents.length ? null : client, filiales[0].idfiliale));
  };

  const editerAdherent = (a) => {
    setFormAffilie(null);
    setFormAdherent({
      ...adherentVide(null, a.idfiliale),
      ...a,
      datenaissance: jour(a.datenaissance),
      dateeffet: jour(a.dateadhesion) || aujourdhui(),
      datedebutconsommation: jour(a.datedebutconsommation) || aujourdhui(),
      montantsurprime: Math.round(Number(a.montantsurprime) || 0),
      groupesanguin: a.groupesanguin || 'NS',
      fichier: null,
    });
  };

  const enregistrerAdherent = () => executer(async () => {
    const a = formAdherent;
    if (!a.filiale) { toastError('Choisissez la filiale de l\'adhérent.'); return; }
    if (!a.nom.trim()) { toastError('Saisissez le nom de l\'adhérent.'); return; }
    if (!a.datenaissance) { toastError('Saisissez la date de naissance de l\'adhérent.'); return; }
    const res = await santeApi.enregistrerAdherent(versFormData({ ...a, devis: idDevis, vip: true }));
    const donnees = await recharger();
    setFormAdherent(null);
    if (!a.idadherent && res.id) setAdherentOuvert(Number(res.id));
    success(res.message || 'Adhérent enregistré.');
    return donnees;
  }, 'Adhérent non enregistré');

  const ouvrirNouvelAffilie = (idAdherent) => {
    setFormAdherent(null);
    setAdherentOuvert(idAdherent);
    setFormAffilie(affilieVide(idAdherent));
  };

  const editerAffilie = (f) => {
    setFormAdherent(null);
    setAdherentOuvert(f.idadherent);
    setFormAffilie({
      ...affilieVide(f.idadherent),
      ...f,
      adherent: f.idadherent,
      observations: f.observations === 'RAS' ? '' : (f.observations || ''),
      datenaissance: jour(f.datenaissance),
      dateeffet: jour(f.dateadhesion) || aujourdhui(),
      datedebutconsommation: jour(f.datedebutconsommation) || aujourdhui(),
      montantsurprime: Math.round(Number(f.montantsurprime) || 0),
      groupesanguin: f.groupesanguin || 'NS',
      fichier: null,
    });
  };

  const enregistrerAffilie = () => executer(async () => {
    const f = formAffilie;
    if (!f.nom.trim()) { toastError('Saisissez le nom de l\'affilié.'); return; }
    if (!f.datenaissance) { toastError('Saisissez la date de naissance de l\'affilié.'); return; }
    const res = await santeApi.enregistrerAffilie(versFormData({ ...f, devis: idDevis }));
    await recharger();
    setFormAffilie(null);
    success(res.message || 'Affilié enregistré.');
  }, 'Affilié non enregistré');

  const importer = () => executer(async () => {
    if (!filialeImport) { toastError('Choisissez la filiale des personnes importées.'); return; }
    if (!fichierImport) { toastError('Choisissez le fichier Excel.'); return; }
    const fd = new FormData();
    fd.append('id_devis', idDevis);
    fd.append('date_effet', dateEffet);
    fd.append('id_filiale', filialeImport);
    fd.append('fichier_excel', fichierImport);
    await santeApi.importerAffilies(fd);
    await recharger();
    setFichierImport(null);
    setImportOuvert(false);
    success('Importation des adhérents et affiliés réalisée.');
  }, 'Import refusé');

  const enregistrerDevis = () => executer(async () => {
    if (!clientId) { toastError('Choisissez le client.'); return; }
    if (client && rechercheClient.trim() !== (client.nomcomplet || '').trim()) {
      toastError('Le client n\'a pas été choisi dans la liste : cliquez sur le client voulu sous le champ de recherche.');
      return;
    }
    if (!filiales.length) { toastError('Enregistrez au moins une couverture (étape 2).'); setStep(2); return; }
    if (!adherents.length) { toastError('Saisissez au moins un adhérent.'); return; }
    if (!dateExpiration) { toastError('Saisissez la date d\'expiration.'); setStep(1); return; }
    if (primesSaisies > 1) { toastError('Renseignez une seule prime : par famille, par affilié ou globale.'); return; }
    if (!estMinene && primesSaisies === 0) { toastError('Renseignez la prime par famille, par affilié ou la prime globale.'); return; }
    const res = await santeApi.enregistrerDevis({
      IdDevis: idDevis,
      IdCompagnie: Number(compagnieId),
      IdTarif: Number(idTarif),
      IdOffre: Number(idOffre),
      IdClient: Number(clientId),
      IdAssure: Number(clientId),
      NumeroPoliceCompagnie: numeroPoliceCompagnie || '',
      TypeContrat: Number(typeContrat),
      // Convention URANUS : positif = réduction, négatif = majoration
      TauxReduction: (ajustement === 'majoration' ? -1 : 1) * (Number(taux) || 0),
      GestionnaireSante: GESTIONNAIRE_SANTE,
      DateEffet: dateEffet,
      DateExpiration: dateExpiration,
      IdDuree: Number(dureeId),
      IdTerme: idTermeValide(termeId),
      PrimeFamille: Number(primeFamille) || 0,
      PrimeAffilie: Number(primeAffilie) || 0,
      PrimeGlobale: Number(primeGlobale) || 0,
      MontantSuprime: Number(montantSurprime) || 0,
      MontantAccessoireManuel: Number(accessoireManuel) || 0,
    });
    setNumeroDevis(res.numero_devis || '');
    setTotauxEnregistres({
      primeNette: res.totaux?.prime_nette, taxe: res.totaux?.taxe, accessoire: res.totaux?.accessoire, primeTtc: res.totaux?.prime_ttc,
    });
    await recharger(res.devis_id);
    success(`Devis Santé N° ${res.numero_devis} ${editParam ? 'modifié' : 'enregistré'}.`);
    const devis = await quoteApi.getQuote(res.devis_id).catch(() => null);
    if (devis) setCreatedQuote(devis);
  }, 'Devis Santé non enregistré');

  // Confirmation : contrat créé par la base, sans repli local
  const handleConvertToContract = async (q) => {
    try {
      await contractApi.createContractFromQuote(q.iddevis || q.id);
      success(`Devis ${q.numerodevis} confirmé : le contrat a été créé.`);
      setCreatedQuote(null);
      navigate('/user/contracts');
    } catch (err) {
      toastError(`Le devis n'a pas pu être confirmé : ${messageErreurApi(err)}`);
    }
  };

  // ------------------------------------------------------------------
  // AFFICHAGE
  // ------------------------------------------------------------------
  const clientsFiltres = (texte) => {
    const t = (texte || '').toLowerCase();
    return clients.filter((c) => (c.nomcomplet || '').toLowerCase().includes(t)).slice(0, 40);
  };
  const titreSection = { color: '#ec4899', fontWeight: 800, textTransform: 'uppercase', fontSize: '1.05rem', margin: '0 0 1.25rem' };
  const grille = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1.1rem', alignItems: 'start' };
  const listeDeroulante = {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--bg-surface-elevated)',
    border: '1px solid var(--border-medium)', borderRadius: '6px', maxHeight: '220px', overflowY: 'auto',
    marginTop: '4px', boxShadow: 'var(--shadow-lg)',
  };
  const elementListe = { padding: '0.6rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.85rem' };
  const encadre = { padding: '1.25rem', borderRadius: '10px', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-elevated)' };
  const cellule = { padding: '0.55rem', textAlign: 'left' };
  const libelleFiliale = (id) => filiales.find((f) => Number(f.idfiliale) === Number(id))?.nom_filiale || '';
  const libelleLien = (code) => liens.find((l) => l.codelien === code)?.libellelien || code;
  const affiliesDe = (idAdherent) => affilies.filter((f) => Number(f.idadherent) === Number(idAdherent));

  const champ = (libelle, contenu, aide) => (
    <div className="form-group" style={{ margin: 0 }}>
      <label className="form-label">{libelle}</label>
      {contenu}
      {aide && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{aide}</span>}
    </div>
  );
  const interrupteur = (libelle, valeur, onChange) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer', marginTop: '1.6rem' }}>
      <input type="checkbox" checked={Boolean(valeur)} onChange={(e) => onChange(e.target.checked)} disabled={desactive} />
      {libelle}
    </label>
  );
  const selectGroupeSanguin = (valeur, onChange) => (
    <select className="form-control" value={valeur} onChange={(e) => onChange(e.target.value)} disabled={desactive}>
      {GROUPES_SANGUINS.map(([code, libelle]) => <option key={code} value={code}>{libelle}</option>)}
    </select>
  );
  const selectSexe = (valeur, onChange) => (
    <select className="form-control" value={valeur} onChange={(e) => onChange(e.target.value)} disabled={desactive}>
      {SEXES.map(([code, libelle]) => <option key={code} value={code}>{libelle}</option>)}
    </select>
  );

  const etapes = [
    { n: 1, label: '1. CONTRAT' },
    { n: 2, label: '2. COUVERTURES SOUSCRITES' },
    { n: 3, label: '3. AFFILIATION & PRIMES' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1240px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* EN-TÊTE */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <button className="btn btn-secondary" onClick={() => navigate('/user/quotes')} style={{ padding: '0.35rem 0.75rem', marginBottom: '0.5rem' }}>
            <ArrowLeft size={16} /> Retour aux devis
          </button>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <HeartPulse size={28} color="#ec4899" />
            {editParam ? `Modifier le devis Santé${numeroDevis ? ` [${numeroDevis}]` : ''}` : 'Production de contrat Santé'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {chargementEdition
              ? 'Chargement du devis à modifier…'
              : 'Couvertures souscrites (collège, formule, zone), adhérents et affiliés ; primes calculées par la base.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {etapes.map((e) => (
            <button
              key={e.n}
              type="button"
              onClick={() => setStep(e.n)}
              style={{
                padding: '0.5rem 0.95rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                border: step === e.n ? '2px solid #ec4899' : '1px solid var(--border-subtle)',
                background: step === e.n ? 'rgba(236, 72, 153, 0.15)' : 'transparent',
                color: step === e.n ? '#db2777' : 'var(--text-muted)',
              }}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {lectureSeule && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid #f59e0b', background: 'rgba(245, 158, 11, 0.08)', color: 'var(--accent-amber)', fontSize: '0.85rem' }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{lectureSeule}</span>
        </div>
      )}

      {/* 1. CONTRAT */}
      {step === 1 && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          <h3 style={titreSection}>Contrat</h3>
          <div style={grille}>
            {champ('Numéro de police compagnie',
              <input type="text" className="form-control" value={numeroPoliceCompagnie} onChange={(e) => setNumeroPoliceCompagnie(e.target.value)} disabled={desactive} />)}
            {champ('Type de contrat',
              <select className="form-control" value={typeContrat} onChange={(e) => setTypeContrat(Number(e.target.value))} disabled={desactive}>
                {typesContrat.map((t) => <option key={t.id_type_contrat} value={t.id_type_contrat}>{t.libelle}</option>)}
              </select>)}
            {champ('Compagnie d\'Assurance',
              <select className="form-control" value={compagnieId} onChange={(e) => setCompagnieId(Number(e.target.value))} disabled={desactive}>
                {sortUniqueBy(compagnies, (c) => c.nom).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>)}
            {champ('Offre Commerciale',
              <select className="form-control" value={idTarif} onChange={(e) => setIdTarif(Number(e.target.value))} disabled={desactive || filiales.length > 0}>
                {tarifs.map((t) => <option key={t.IdTarif} value={t.IdTarif}>{t.LibelleTarif}</option>)}
              </select>,
              filiales.length > 0
                ? 'Couvertures déjà enregistrées : retirez-les pour changer d\'offre commerciale.'
                : (estMinene ? 'MINENE : prime calculée automatiquement, zone Côte d\'Ivoire.' : undefined))}
            {champ('Ajustement',
              <select className="form-control" value={ajustement} onChange={(e) => setAjustement(e.target.value)} disabled={desactive}>
                <option value="reduction">Réduction</option>
                <option value="majoration">Majoration</option>
              </select>)}
            {champ(ajustement === 'reduction' ? 'Taux Réduction (%)' : 'Taux Majoration (%)',
              <input
                type="number"
                min="0"
                max={tauxMax}
                className="form-control"
                value={taux}
                onChange={(e) => setTaux(Math.max(0, Math.min(tauxMax, Number(e.target.value) || 0)))}
                disabled={desactive}
              />,
              estMinene ? undefined : 'Hors MINENE, la base enregistre le taux sans l\'appliquer aux primes.')}
            {champ('Gestionnaire', <input type="text" className="form-control" value={GESTIONNAIRE_SANTE} disabled readOnly />)}
            {champ('Terme du contrat',
              <TermeContratSelect
                value={termeId}
                onChange={(id) => { setTermeId(id); setDureeId((d) => dureeSelonTerme(id, d)); }}
                disabled={desactive}
              />)}
            {champ('Durée du contrat', <DureeContratSelect value={dureeId} onChange={setDureeId} idsAutorises={[ID_DUREE_ANNUELLE]} disabled={desactive || estDureeLibre(dureeId)} />)}
            {champ('Date d\'emission', <input type="date" className="form-control" value={dateEmission} readOnly disabled title="Date du jour, non modifiable" />)}
            {champ('Date d\'effet (* requis)',
              <input type="date" className="form-control" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} disabled={desactive} />)}
            {champ('Date d\'expiration (* requis)',
              estDureeLibre(dureeId)
                ? <input type="date" className="form-control" value={expirationLibre} onChange={(e) => setExpirationLibre(e.target.value)} disabled={desactive} />
                : <input type="date" className="form-control" value={dateExpiration} readOnly style={{ color: '#db2777', fontWeight: 700 }} />)}
          </div>
          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-primary" onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#db2777' }}>
              Suivant : Couvertures souscrites <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* 2. COUVERTURES SOUSCRITES */}
      {step === 2 && (
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
          <h3 style={titreSection}>Couvertures souscrites</h3>
          <div style={grille}>
            {champ('Formule de couverture',
              <select className="form-control" value={idOffre} onChange={(e) => setIdOffre(Number(e.target.value))} disabled={desactive}>
                {formules.length === 0 && <option value={0}>Aucune formule pour cette offre commerciale</option>}
                {formules.map((f) => <option key={f.IdOffre} value={f.IdOffre}>{f.LibelleOffre}</option>)}
              </select>)}
            {champ('Collège',
              <select className="form-control" value={idCollege} onChange={(e) => setIdCollege(Number(e.target.value))} disabled={desactive}>
                {colleges.map((c) => <option key={c.idcollege} value={c.idcollege}>{c.libellecollege}</option>)}
              </select>)}
            {champ('Zone de couverture',
              <select className="form-control" value={idZone} onChange={(e) => setIdZone(Number(e.target.value))} disabled={desactive || zoneImposee}>
                {zones.map((z) => <option key={z.idzone} value={z.idzone}>{z.libellezone}</option>)}
              </select>,
              zoneImposee ? 'Zone imposée par la formule.' : undefined)}
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="button" className="btn btn-primary" onClick={enregistrerCouverture} disabled={desactive} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#10b981' }}>
                <Plus size={16} /> Enregistrer le collège
              </button>
            </div>
          </div>

          <h4 style={{ margin: '1.75rem 0 0.75rem', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Vos couvertures ({filiales.length})
          </h4>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  <th style={cellule}>COUVERTURE</th>
                  <th style={cellule}>COLLÈGE</th>
                  <th style={cellule}>FORMULE</th>
                  <th style={cellule}>ZONE</th>
                  <th style={{ ...cellule, textAlign: 'center' }}>ADHÉRENTS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filiales.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>Aucune couverture enregistrée.</td></tr>
                )}
                {filiales.map((f) => (
                  <tr key={f.idfiliale}>
                    <td style={{ ...cellule, fontWeight: 600 }}>{f.nom_filiale}</td>
                    <td style={cellule}>{f.libellecollege}</td>
                    <td style={cellule}>{f.libelle_offre}</td>
                    <td style={cellule}>{f.libellezone}</td>
                    <td style={{ ...cellule, textAlign: 'center' }}>{adherents.filter((a) => Number(a.idfiliale) === Number(f.idfiliale)).length}</td>
                    <td style={{ ...cellule, textAlign: 'right' }}>
                      <button type="button" className="btn btn-secondary" title="Retirer la couverture, ses adhérents et leurs affiliés" disabled={desactive}
                        style={{ padding: '0.3rem 0.5rem', color: '#ef4444' }} onClick={() => supprimer('FIL', f.idfiliale, `la couverture « ${f.nom_filiale} », ses adhérents et leurs affiliés`)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: '1.75rem', display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ArrowLeft size={16} /> Précédent
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(3)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#db2777' }}>
              Suivant : Affiliation <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* 3. AFFILIATION & PRIMES */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
            <h3 style={titreSection}>Client</h3>
            <div className="form-group" style={{ position: 'relative', maxWidth: '560px', margin: 0 }}>
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Nom du client (* requis)</span>
                {!lectureSeule && (
                  <button type="button" onClick={() => setIsQuickAddClientOpen(true)} style={{ background: 'transparent', border: 'none', color: '#db2777', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <Plus size={14} /> Nouveau client
                  </button>
                )}
              </label>
              <input
                type="text"
                className="form-control"
                placeholder="Rechercher un client..."
                value={rechercheClient}
                onChange={(e) => { setRechercheClient(e.target.value); setListeClientsOuverte(true); }}
                onFocus={() => setListeClientsOuverte(true)}
                onBlur={() => setTimeout(() => setListeClientsOuverte(false), 150)}
                disabled={desactive}
              />
              {listeClientsOuverte && (
                <div style={listeDeroulante}>
                  {clientsFiltres(rechercheClient).map((c) => (
                    <div
                      key={c.id}
                      style={elementListe}
                      onMouseDown={() => { setClientId(Number(c.id)); setRechercheClient(c.nomcomplet); setListeClientsOuverte(false); }}
                    >
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{c.nomcomplet}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.codeclient} • {c.telephone}</div>
                    </div>
                  ))}
                </div>
              )}
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Souscripteur et assuré du contrat.</span>
            </div>
          </div>

          {/* ADHÉRENTS ET AFFILIÉS */}
          <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <h3 style={{ ...titreSection, margin: 0 }}>Adhérents ({adherents.length}) et affiliés ({affilies.length})</h3>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" disabled={desactive || !filiales.length}
                  onClick={() => { setImportOuvert((v) => !v); setFilialeImport(Number(filiales[0]?.idfiliale) || 0); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  <Upload size={14} /> Importer (Excel)
                </button>
                <button type="button" className="btn btn-primary" onClick={ouvrirNouvelAdherent} disabled={desactive}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', background: '#10b981' }}>
                  <Plus size={14} /> Nouvel adhérent
                </button>
              </div>
            </div>

            {importOuvert && (
              <div style={{ ...encadre, marginBottom: '1.25rem' }}>
                <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>Importation des adhérents et affiliés</h4>
                <div style={grille}>
                  {champ('Filiale *',
                    <select className="form-control" value={filialeImport} onChange={(e) => setFilialeImport(Number(e.target.value))}>
                      {filiales.map((f) => <option key={f.idfiliale} value={f.idfiliale}>{f.nom_filiale}</option>)}
                    </select>)}
                  {champ('Fichier Excel',
                    <input type="file" accept=".xlsx,.xlsm" className="form-control" onChange={(e) => setFichierImport(e.target.files?.[0] || null)} />)}
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button type="button" className="btn btn-primary" onClick={importer} disabled={desactive || !fichierImport} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Upload size={14} /> Importer
                    </button>
                  </div>
                </div>
                <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Colonnes attendues (1re ligne) : {COLONNES_IMPORT}. Chaque adhérent (lien A) précède ses affiliés.
                </p>
              </div>
            )}

            {formAdherent && (
              <div style={{ ...encadre, marginBottom: '1.25rem', borderColor: 'rgba(236, 72, 153, 0.45)' }}>
                <h4 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {formAdherent.idadherent ? 'Mise à jour d\'un adhérent' : 'Nouvel Adhérent'}
                </h4>
                <div style={grille}>
                  {champ('Filiale *',
                    <select className="form-control" value={formAdherent.filiale} onChange={(e) => setFormAdherent((p) => ({ ...p, filiale: Number(e.target.value) }))} disabled={desactive}>
                      {filiales.map((f) => <option key={f.idfiliale} value={f.idfiliale}>{f.nom_filiale}</option>)}
                    </select>)}
                  {champ('Nom *', <input type="text" className="form-control" value={formAdherent.nom} onChange={(e) => setFormAdherent((p) => ({ ...p, nom: e.target.value }))} disabled={desactive} />)}
                  {champ('Prenom', <input type="text" className="form-control" value={formAdherent.prenom} onChange={(e) => setFormAdherent((p) => ({ ...p, prenom: e.target.value }))} disabled={desactive} />)}
                  {champ('Date de naissance *', <input type="date" className="form-control" max={aujourdhui()} value={formAdherent.datenaissance} onChange={(e) => setFormAdherent((p) => ({ ...p, datenaissance: e.target.value }))} disabled={desactive} />,
                    formAdherent.datenaissance ? `${age(formAdherent.datenaissance)} ans` : undefined)}
                  {champ('Sexe', selectSexe(formAdherent.sexe, (v) => setFormAdherent((p) => ({ ...p, sexe: v }))))}
                  {champ('N° CNI', <input type="text" className="form-control" value={formAdherent.cni} onChange={(e) => setFormAdherent((p) => ({ ...p, cni: e.target.value }))} disabled={desactive} />)}
                  {champ('Importation CNI',
                    <input type="file" className="form-control" onChange={(e) => setFormAdherent((p) => ({ ...p, fichier: e.target.files?.[0] || null }))} disabled={desactive} />,
                    formAdherent.fichierpiece ? <a href={formAdherent.fichierpiece} target="_blank" rel="noreferrer">Pièce enregistrée</a> : undefined)}
                  {champ('Numéro CMU', <input type="text" className="form-control" value={formAdherent.numerocmu || ''} onChange={(e) => setFormAdherent((p) => ({ ...p, numerocmu: e.target.value }))} disabled={desactive} />)}
                  {champ('Adresse', <input type="text" className="form-control" value={formAdherent.adresse || ''} onChange={(e) => setFormAdherent((p) => ({ ...p, adresse: e.target.value }))} disabled={desactive} />)}
                  {champ('Matricule', <input type="text" className="form-control" value={formAdherent.matricule || ''} onChange={(e) => setFormAdherent((p) => ({ ...p, matricule: e.target.value }))} disabled={desactive} />)}
                  {champ('Groupe Sanguin', selectGroupeSanguin(formAdherent.groupesanguin, (v) => setFormAdherent((p) => ({ ...p, groupesanguin: v }))))}
                  {champ('Nombre pathologies', <input type="number" min="0" max="3" className="form-control" value={formAdherent.nombrepathologie} onChange={(e) => setFormAdherent((p) => ({ ...p, nombrepathologie: Math.max(0, Math.min(3, Number(e.target.value) || 0)) }))} disabled={desactive} />, 'De 0 à 3.')}
                  {champ('Numéro de téléphone *', <input type="tel" className="form-control" value={formAdherent.mobile1 || ''} onChange={(e) => setFormAdherent((p) => ({ ...p, mobile1: e.target.value }))} disabled={desactive} />)}
                  {champ('E-mail *', <input type="email" className="form-control" value={formAdherent.email || ''} onChange={(e) => setFormAdherent((p) => ({ ...p, email: e.target.value }))} disabled={desactive} />)}
                  {champ('Date d\'effet', <input type="date" className="form-control" value={formAdherent.dateeffet} onChange={(e) => setFormAdherent((p) => ({ ...p, dateeffet: e.target.value }))} disabled={desactive} />)}
                  {champ('Date début consommation', <input type="date" className="form-control" value={formAdherent.datedebutconsommation} onChange={(e) => setFormAdherent((p) => ({ ...p, datedebutconsommation: e.target.value }))} disabled={desactive} />)}
                  {interrupteur('Surprime', formAdherent.surprimeappliquee, (v) => setFormAdherent((p) => ({ ...p, surprimeappliquee: v })))}
                  {formAdherent.surprimeappliquee && champ('Montant Surprime', <AmountInput value={formAdherent.montantsurprime} onChange={(v) => setFormAdherent((p) => ({ ...p, montantsurprime: v }))} disabled={desactive} />)}
                </div>
                <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setFormAdherent(null)}><X size={14} /> Annuler</button>
                  <button type="button" className="btn btn-primary" onClick={enregistrerAdherent} disabled={desactive} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: '#10b981' }}>
                    <Check size={15} /> Enregistrer l'adhérent
                  </button>
                </div>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    <th style={{ width: 28 }} />
                    <th style={cellule}>ADHÉRENT</th>
                    <th style={cellule}>NÉ(E) LE</th>
                    <th style={cellule}>FILIALE</th>
                    <th style={{ ...cellule, textAlign: 'center' }}>AFFILIÉS</th>
                    <th style={{ ...cellule, textAlign: 'center' }}>PATHOLOGIES</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {adherents.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>Aucun adhérent saisi.</td></tr>
                  )}
                  {adherents.map((a) => {
                    const ouvert = Number(adherentOuvert) === Number(a.idadherent);
                    const membres = affiliesDe(a.idadherent);
                    return (
                      <React.Fragment key={a.idadherent}>
                        <tr style={{ background: ouvert ? 'rgba(236, 72, 153, 0.06)' : undefined }}>
                          <td style={cellule}>
                            <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.35rem' }} title="Affiliés de la famille"
                              onClick={() => setAdherentOuvert(ouvert ? null : a.idadherent)}>
                              {ouvert ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>
                          <td style={{ ...cellule, fontWeight: 600 }}>{a.nom} {a.prenom}</td>
                          <td style={cellule}>{dateFr(a.datenaissance)}</td>
                          <td style={cellule}>{libelleFiliale(a.idfiliale)}</td>
                          <td style={{ ...cellule, textAlign: 'center' }}>{membres.length}</td>
                          <td style={{ ...cellule, textAlign: 'center' }}>{a.nombrepathologie || 0}</td>
                          <td style={{ ...cellule, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button type="button" className="btn btn-secondary" title="Nouvel affilié" disabled={desactive} style={{ padding: '0.3rem 0.5rem', marginRight: 4 }} onClick={() => ouvrirNouvelAffilie(a.idadherent)}><Plus size={14} /></button>
                            <button type="button" className="btn btn-secondary" title="Modifier l'adhérent" disabled={desactive} style={{ padding: '0.3rem 0.5rem', marginRight: 4 }} onClick={() => editerAdherent(a)}><Edit3 size={14} /></button>
                            <button type="button" className="btn btn-secondary" title="Retirer l'adhérent et ses affiliés" disabled={desactive} style={{ padding: '0.3rem 0.5rem', color: '#ef4444' }}
                              onClick={() => supprimer('ADH', a.idadherent, `l'adhérent ${a.nom} ${a.prenom || ''} et ses affiliés`)}><Trash2 size={14} /></button>
                          </td>
                        </tr>
                        {ouvert && (
                          <tr>
                            <td />
                            <td colSpan={6} style={{ padding: '0.4rem 0.55rem 0.9rem' }}>
                              <table className="table" style={{ width: '100%', fontSize: '0.82rem' }}>
                                <thead>
                                  <tr style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                                    <th style={cellule}>LIEN</th>
                                    <th style={cellule}>NOM ET PRÉNOMS</th>
                                    <th style={cellule}>NÉ(E) LE</th>
                                    <th style={cellule}>SEXE</th>
                                    <th style={cellule}>GROUPE SANGUIN</th>
                                    <th />
                                  </tr>
                                </thead>
                                <tbody>
                                  {membres.map((f) => (
                                    <tr key={f.idaffilie}>
                                      <td style={cellule}>{f.libellelien || libelleLien(f.lien)}</td>
                                      <td style={cellule}>{f.nom} {f.prenom}</td>
                                      <td style={cellule}>{dateFr(f.datenaissance)}{f.datenaissance ? ` (${age(f.datenaissance)} ans)` : ''}</td>
                                      <td style={cellule}>{f.sexe === 'M' ? 'Masculin' : 'Féminin'}</td>
                                      <td style={cellule}>{f.groupesanguin || 'NS'}</td>
                                      <td style={{ ...cellule, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        {f.lien !== 'A' && (
                                          <>
                                            <button type="button" className="btn btn-secondary" title="Modifier l'affilié" disabled={desactive} style={{ padding: '0.25rem 0.45rem', marginRight: 4 }} onClick={() => editerAffilie(f)}><Edit3 size={13} /></button>
                                            <button type="button" className="btn btn-secondary" title="Retirer l'affilié" disabled={desactive} style={{ padding: '0.25rem 0.45rem', color: '#ef4444' }}
                                              onClick={() => supprimer('AFF', f.idaffilie, `l'affilié ${f.nom} ${f.prenom || ''}`)}><Trash2 size={13} /></button>
                                          </>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {formAffilie && (
              <div style={{ ...encadre, marginTop: '1.25rem', borderColor: 'rgba(236, 72, 153, 0.45)' }}>
                <h4 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {formAffilie.idaffilie ? 'Mise à jour d\'un Affilié' : 'Nouvel Affilié'}
                </h4>
                <div style={grille}>
                  {champ('Adhérent', <input type="text" className="form-control" readOnly disabled
                    value={(() => { const a = adherents.find((x) => Number(x.idadherent) === Number(formAffilie.adherent)); return a ? `${a.nom} ${a.prenom || ''}` : ''; })()} />)}
                  {champ('Lien *',
                    <select className="form-control" value={formAffilie.lien} onChange={(e) => setFormAffilie((p) => ({ ...p, lien: e.target.value }))} disabled={desactive}>
                      {liens.filter((l) => l.codelien !== 'A').map((l) => <option key={l.codelien} value={l.codelien}>{l.libellelien}</option>)}
                    </select>)}
                  {champ('Nom *', <input type="text" className="form-control" value={formAffilie.nom} onChange={(e) => setFormAffilie((p) => ({ ...p, nom: e.target.value }))} disabled={desactive} />)}
                  {champ('Prenom', <input type="text" className="form-control" value={formAffilie.prenom} onChange={(e) => setFormAffilie((p) => ({ ...p, prenom: e.target.value }))} disabled={desactive} />)}
                  {champ('Date de Naissance *', <input type="date" className="form-control" max={aujourdhui()} value={formAffilie.datenaissance} onChange={(e) => setFormAffilie((p) => ({ ...p, datenaissance: e.target.value }))} disabled={desactive} />,
                    formAffilie.datenaissance ? `${age(formAffilie.datenaissance)} ans` : undefined)}
                  {champ('Sexe', selectSexe(formAffilie.sexe, (v) => setFormAffilie((p) => ({ ...p, sexe: v }))))}
                  {champ(formAffilie.lien === 'E' ? 'Extrait de naissance' : 'CNI',
                    <input type="file" className="form-control" onChange={(e) => setFormAffilie((p) => ({ ...p, fichier: e.target.files?.[0] || null }))} disabled={desactive} />,
                    formAffilie.fichierpiece ? <a href={formAffilie.fichierpiece} target="_blank" rel="noreferrer">Pièce enregistrée</a> : undefined)}
                  {champ('Numéro CMU', <input type="text" className="form-control" value={formAffilie.numerocmu || ''} onChange={(e) => setFormAffilie((p) => ({ ...p, numerocmu: e.target.value }))} disabled={desactive} />)}
                  {champ('Groupe Sanguin', selectGroupeSanguin(formAffilie.groupesanguin, (v) => setFormAffilie((p) => ({ ...p, groupesanguin: v }))))}
                  {champ('Matricule', <input type="text" className="form-control" value={formAffilie.matricule || ''} onChange={(e) => setFormAffilie((p) => ({ ...p, matricule: e.target.value }))} disabled={desactive} />)}
                  {champ('Observations', <input type="text" className="form-control" value={formAffilie.observations || ''} onChange={(e) => setFormAffilie((p) => ({ ...p, observations: e.target.value }))} disabled={desactive} />)}
                  {champ('Nombre pathologies', <input type="number" min="0" max="3" className="form-control" value={formAffilie.nombrepathologie} onChange={(e) => setFormAffilie((p) => ({ ...p, nombrepathologie: Math.max(0, Math.min(3, Number(e.target.value) || 0)) }))} disabled={desactive} />, 'De 0 à 3.')}
                  {champ('Date d\'effet', <input type="date" className="form-control" value={formAffilie.dateeffet} onChange={(e) => setFormAffilie((p) => ({ ...p, dateeffet: e.target.value }))} disabled={desactive} />)}
                  {champ('Date début consommation', <input type="date" className="form-control" value={formAffilie.datedebutconsommation} onChange={(e) => setFormAffilie((p) => ({ ...p, datedebutconsommation: e.target.value }))} disabled={desactive} />)}
                  {interrupteur('Pathologie antérieure', formAffilie.handicape, (v) => setFormAffilie((p) => ({ ...p, handicape: v })))}
                  {interrupteur('Certificat', formAffilie.certificat, (v) => setFormAffilie((p) => ({ ...p, certificat: v })))}
                  {interrupteur('Surprime', formAffilie.surprimeappliquee, (v) => setFormAffilie((p) => ({ ...p, surprimeappliquee: v })))}
                  {formAffilie.surprimeappliquee && champ('Montant Surprime', <AmountInput value={formAffilie.montantsurprime} onChange={(v) => setFormAffilie((p) => ({ ...p, montantsurprime: v }))} disabled={desactive} />)}
                </div>
                {formAffilie.lien === 'E' && (
                  <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Enfant : refusé au-delà de 25 ans ; de 21 à 25 ans, le certificat de scolarité est exigé (contrôles de la base).
                  </p>
                )}
                <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setFormAffilie(null)}><X size={14} /> Annuler</button>
                  <button type="button" className="btn btn-primary" onClick={enregistrerAffilie} disabled={desactive} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: '#10b981' }}>
                    <Check size={15} /> Enregistrer l'affilié
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* PRIMES */}
          <div className="glass-panel" style={{ padding: '2rem', borderRadius: '12px' }}>
            <h3 style={titreSection}>Primes</h3>
            <div style={grille}>
              {champ('Prime par famille', <AmountInput value={primeFamille} onChange={setPrimeFamille} disabled={desactive || (primesSaisies > 0 && !(Number(primeFamille) > 0))} />)}
              {champ('Prime par Affilié', <AmountInput value={primeAffilie} onChange={setPrimeAffilie} disabled={desactive || (primesSaisies > 0 && !(Number(primeAffilie) > 0))} />)}
              {champ('Prime globale', <AmountInput value={primeGlobale} onChange={setPrimeGlobale} disabled={desactive || (primesSaisies > 0 && !(Number(primeGlobale) > 0))} />)}
              {champ('Surprime affection', <AmountInput value={montantSurprime} onChange={setMontantSurprime} disabled={desactive} />)}
              {champ('Accessoire Manuel', <AmountInput value={accessoireManuel} onChange={setAccessoireManuel} disabled={desactive} />,
                'À 0 : accessoire du barème de la compagnie.')}
            </div>
            <p style={{ margin: '0.85rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {estMinene
                ? 'MINENE : laissez les primes à 0 pour appliquer la prime de base de la formule, les surprimes d\'âge (60–64 ans : 30 %, 65–69 ans : 50 %) et d\'affection (30 % par pathologie).'
                : 'Une seule prime : par famille (× adhérents), par affilié (× affiliés) ou globale.'}
            </p>

            {estMinene && (
              <div style={{ ...encadre, marginTop: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Répartition de la prime (Minéné Santé)</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={avecApporteur} onChange={(e) => setAvecApporteur(e.target.checked)} />
                    Contrat apporté par un tiers (apporteur d'affaires)
                  </label>
                </div>
                {repartitionErreur ? (
                  <div style={{ fontSize: '0.8rem', color: 'var(--accent-amber)' }}>{repartitionErreur}</div>
                ) : repartition ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', fontSize: '0.8rem' }}>
                    {[
                      ['Frais généraux (NSIA CI)', repartition.frais_generaux_compagnie],
                      ['Commission (OREOLE)', repartition.commission_courtier],
                      ['Honoraires gestion (VITALIS)', repartition.honoraire_gestionnaire],
                      ...(avecApporteur
                        ? [['Commission commerciaux', repartition.commission_commerciaux]]
                        : [['Frais gestion (ADEC)', repartition.frais_gestion_adec], ['Autres frais de gestion', repartition.autres_frais_gestion]]),
                      ['Provision pour sinistre', repartition.provision_sinistre],
                    ].map(([libelle, montant]) => (
                      <div key={libelle}>
                        <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.68rem' }}>{libelle}</div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{fcfa(montant)} FCFA</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Prime calculée à l'enregistrement du devis : la répartition s'affichera ensuite.</div>
                )}
              </div>
            )}

            {totauxEnregistres && (
              <div style={{ marginTop: '1.25rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Montants enregistrés</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                  {[['Prime nette', totauxEnregistres.primeNette], ['Taxes', totauxEnregistres.taxe], ['Accessoires', totauxEnregistres.accessoire], ['Prime TTC', totauxEnregistres.primeTtc]].map(([libelle, valeur]) => (
                    <div key={libelle} style={{ padding: '0.85rem', borderRadius: '8px', border: libelle === 'Prime TTC' ? '2px solid #ec4899' : '1px solid var(--border-subtle)', background: 'var(--bg-surface-elevated)' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{libelle}</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{fcfa(valeur)} FCFA</div>
                    </div>
                  ))}
                </div>
                {garanties.some((g) => Number(g.primenette) > 0) && (
                  <table className="table" style={{ width: '100%', fontSize: '0.82rem', marginTop: '0.75rem' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                        <th style={cellule}>GARANTIE</th>
                        <th style={{ ...cellule, textAlign: 'right' }}>P. NETTE</th>
                        <th style={{ ...cellule, textAlign: 'right' }}>TAXE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {garanties.filter((g) => Number(g.primenette) > 0).map((g) => (
                        <tr key={g.idgarantie}>
                          <td style={cellule}>{g.libelle}</td>
                          <td style={{ ...cellule, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(g.primenette)}</td>
                          <td style={{ ...cellule, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(g.taxe)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ArrowLeft size={16} /> Précédent
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={desactive || chargementEdition}
                onClick={enregistrerDevis}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#db2777', padding: '0.75rem 1.75rem', fontWeight: 800 }}
              >
                <Save size={18} />
                {occupe ? 'Enregistrement en cours...' : 'Enregistrer le devis'}
              </button>
            </div>
          </div>
        </div>
      )}

      {createdQuote && (
        <ViewQuoteModal
          isOpen={Boolean(createdQuote)}
          quote={createdQuote}
          onClose={() => { setCreatedQuote(null); navigate('/user/quotes'); }}
          onConvertToContract={handleConvertToContract}
        />
      )}

      <QuickAddClientModal
        isOpen={isQuickAddClientOpen}
        onClose={() => setIsQuickAddClientOpen(false)}
        onClientCreated={(nouveau) => {
          setClients((prev) => [nouveau, ...prev]);
          setClientId(Number(nouveau.id || nouveau.IdClient));
          setRechercheClient(nouveau.nomcomplet || nouveau.Nom);
        }}
      />
    </div>
  );
};

export default NewSanteQuotePage;
