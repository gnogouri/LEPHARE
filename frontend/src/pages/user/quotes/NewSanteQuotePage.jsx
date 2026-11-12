import React, { useState, useEffect, useMemo } from 'react';
import { redirigerSiOreole } from './oreole/oreoleCommun';
import { confirmer } from '../../../utils/dialogue';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from '../../../utils/navigationDevis';
import { quoteApi, customerApi, settingsApi, contractApi, santeApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { aLeDroit } from '../../../utils/droits';
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
  Download,
  Search,
  Users,
} from 'lucide-react';
import { ViewQuoteModal } from './ViewQuoteModal';
import { QuickAddClientModal } from '../clients/QuickAddClientModal';
import { BandeauQuestionnaire, useQuestionnaireDevis } from './QuestionnaireDevis';
import { TermeContratSelect } from '../../../components/common/TermeContratSelect';
import { DureeContratSelect } from '../../../components/common/DureeContratSelect';
import { AmountInput } from '../../../components/common/AmountInput';
import { formulesSante, parametre, reglagesMinene, compagnieParDefaut } from '../../../utils/parametrage';
import {
  ID_TERME_PAR_DEFAUT,
  dureeSelonTerme,
  estDureeLibre,
  idTermeValide,
  termeEtDureeEnregistres,
} from '../../../utils/termesContrat';
import { sortUniqueBy } from '../../../utils/sortUtils';
import { downloadBlob } from '../../../utils/exportUtils';

// Production Santé fidèle à URANUS (SanteForm) : 1. Contrat, 2. Couvertures souscrites (filiales :
// collège × formule × zone), 3. Affiliation (adhérents, affiliés) et primes. La saisie est portée
// par un devis initialisé au premier enregistrement (numéro de saisie d'URANUS) ; les primes sont
// calculées par la base (sp_creation_devis_sante). Libellés et valeurs : ceux d'URANUS et de la base.

// Gestionnaire des contrats Santé : Administration > Le cabinet & règles de gestion (sante.gestionnaire). Imposé en
// MINENE (VITALIS SANTE), proposé par défaut et modifiable pour les autres offres (demande du 2026-10-27)
const gestionnaireSante = () => parametre('sante.gestionnaire', 'VITALIS SANTE');
// Catégories MINENE (code catégorie 123 : tarifs 87, 102 et 153) : prime calculée automatiquement,
// zone CÔTE D'IVOIRE, durée annuelle
const CODE_CATEGORIE_MINENE = '123';
// Surprimes, âges, taille des familles et clause d'ajustement (taux de réduction / majoration proposés) :
// Administration > Réglages Santé MINENE (reglagesMinene, formulesSante)
const aideAffections = (r) => `De 0 à ${r.surprimes.affectionsMax} (MINENE : surprime de ${r.surprimes.affection} % de la prime de base par affection).`;
const tailleFormules = () => {
  const vues = new Map();
  formulesSante().forEach((f) => { if (!vues.has(f.Option)) vues.set(f.Option, f.PersonnesMax); });
  return [...vues].map(([option, max]) => `${option} : ${max === 1 ? '1 personne' : `jusqu'à ${max}`}`).join(', ');
};
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
// Offre commerciale SANTE CLASSIQUE : import au modèle d'OREOLE (sante/import_classique.py), couvertures, familles,
// date d'effet et primes déduites du fichier
const ID_TARIF_SANTE_CLASSIQUE = 85;
const COLONNES_IMPORT_CLASSIQUE = "NUMERO D'ORDRE, NUMERO DE CARTE, COLLEGE, NOM, PRENOM, DATE DE NAISSANCE, SEXE, NUMERO CMU, "
  + "FILIATION (A, C ou E), DATE D'ENTREE, AVENANT, PRIME NETTE ANNUELLE, PRIME NETTE PERIODIQUE, SURPRIME, PRIME NETTE TOTALE";

const aujourdhui = () => new Date().toISOString().split('T')[0];
const jour = (v) => (v ? String(v).slice(0, 10) : '');
const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
const dateFr = (v) => (v ? jour(v).split('-').reverse().join('/') : '');
// Âge révolu au jour donné (aujourd'hui à défaut) ; la base mesure les surprimes et limites MINENE à la date d'effet
const age = (naissance, auJour) => {
  if (!naissance) return null;
  const n = new Date(naissance);
  const t = auJour ? new Date(auJour) : new Date();
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
  const { success, error: toastError, warning } = useToast();

  // « Modifier » depuis le registre : /user/quotes/sante?edit=<iddevis>
  const [searchParams] = useSearchParams();
  const editParam = searchParams.get('edit');
  // Devis lié au package Oreole Santé : il s'ouvre dans la branche, qui garde les trois polices ensemble
  useEffect(() => redirigerSiOreole(editParam, navigate), [editParam]); // eslint-disable-line react-hooks/exhaustive-deps
  const [chargementEdition, setChargementEdition] = useState(Boolean(editParam));
  const [lectureSeule, setLectureSeule] = useState('');
  // Saisie commencée par un collègue : continuable d'un clic (POST /api/devissante/<id>/continuer/)
  const [saisieAContinuer, setSaisieAContinuer] = useState(false);
  const [repriseEnCours, setRepriseEnCours] = useState(false);
  const [numeroDevis, setNumeroDevis] = useState('');
  const [totauxEnregistres, setTotauxEnregistres] = useState(null);
  // Devis de renouvellement : taux d'ajustement de l'an dernier (déjà compris dans la prime de base MINENE)
  const [tauxPrecedent, setTauxPrecedent] = useState(null);
  // Devis d'avenant de modification d'un contrat en cours (changement de formule, incorporation) : police, période, prorata
  const [avenantModification, setAvenantModification] = useState(null);
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
  const [gestionnaire, setGestionnaire] = useState(gestionnaireSante);
  const [compagnieId, setCompagnieId] = useState(() => compagnieParDefaut(5));
  const [idTarif, setIdTarif] = useState(0);
  const [ajustement, setAjustement] = useState('aucun');
  const [taux, setTaux] = useState(0);
  const [termeId, setTermeId] = useState(ID_TERME_PAR_DEFAUT);
  const [dureeId, setDureeId] = useState(ID_DUREE_ANNUELLE);
  // Date d'émission : toujours la date du jour (le serveur l'impose aussi)
  const dateEmission = aujourdhui();
  const [dateEffet, setDateEffet] = useState(aujourdhui);
  const [expirationLibre, setExpirationLibre] = useState('');
  // Avenant de modification : il prend fin à l'échéance du contrat (sp_creation_devis_sante v9)
  const dateExpiration = avenantModification?.DateExpirationContrat
    || (estDureeLibre(dureeId) ? expirationLibre : expirationAnnuelle(dateEffet));

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
  // MINENE : chaque famille importée rangée dans la formule de sa taille (SOLO, FAMILLE, FAMILLE PLUS)
  const [classerFamilles, setClasserFamilles] = useState(true);
  const [apercu, setApercu] = useState(null);
  const [apercuErreur, setApercuErreur] = useState('');
  const [apercuChargement, setApercuChargement] = useState(false);
  const [fichierImport, setFichierImport] = useState(null);
  const [filialeImport, setFilialeImport] = useState(0);
  // Santé classique : collège des couvertures dont le fichier ne cite pas le collège, compte rendu de l'analyse
  // ou de l'import, primes de l'écran reprises du fichier (jusqu'à une saisie)
  const [collegeImport, setCollegeImport] = useState(0);
  const [resultatClassique, setResultatClassique] = useState(null);
  const [primesDuFichier, setPrimesDuFichier] = useState(false);
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
  const estClassique = !estMinene && (Number(idTarif) === ID_TARIF_SANTE_CLASSIQUE || /classique/i.test(tarifChoisi?.LibelleTarif || ''));
  const minene = reglagesMinene();
  const affectionsMax = Math.max(0, Number(minene.surprimes.affectionsMax) || 0);
  const ajustementsMinene = Object.fromEntries(Object.entries(minene.ajustements).map(([sens, liste]) => [sens, liste.map(([t, sp]) => [t, `S/P ${sp}`])]));
  const formuleChoisie = formules.find((f) => Number(f.IdOffre) === Number(idOffre));
  const zoneImposee = estMinene || contientCoteIvoire(formuleChoisie?.LibelleOffre);
  const client = clients.find((c) => String(c.id) === String(clientId));
  const tauxMax = Number(typeContrat) === TYPE_CONTRAT_SOCIETE ? 35 : 100;
  const primesSaisies = [primeFamille, primeAffilie, primeGlobale].filter((p) => Number(p) > 0).length;
  // MINENE : adhérents et conjoints soumis à la surprime d'âge à la date d'effet (même règle que sp_creation_devis_sante)
  const surprimesAge = estMinene ? affilies
    .filter((f) => ['A', 'C'].includes(f.lien))
    .map((f) => ({ f, ans: age(f.datenaissance, dateEffet) }))
    .filter(({ ans }) => ans !== null && ans >= minene.surprimes.age1Debut)
    .map((x) => ({ ...x, taux: x.ans >= minene.surprimes.age2Debut ? minene.surprimes.age2Taux : minene.surprimes.age1Taux })) : [];
  const desactive = Boolean(lectureSeule) || occupe;

  // Questionnaire prospect (?questionnaire=) : cotation (étendue territoriale) ou bulletin d'adhésion (personnes
  // vérifiées ici, sexe compris, puis importées dans la couverture choisie)
  const qd = useQuestionnaireDevis();
  const [personnesBulletin, setPersonnesBulletin] = useState([]);
  const [filialeBulletin, setFilialeBulletin] = useState(0);
  useEffect(() => {
    setPersonnesBulletin(qd.devis?.genre === 'sante_bulletin' ? qd.devis.personnes.map((p, i) => ({ ...p, cle: i })) : []);
  }, [qd.devis]);
  useEffect(() => {
    if (createdQuote && qd.actif) qd.devisEtabli(createdQuote.numerodevis || '');
  }, [createdQuote]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoneMonde = zones.find((z) => /monde/i.test(z.libellezone || ''));

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
        setTauxPrecedent(devis.code_avenant === 'REN' && devis.taux_reduction_precedent !== null ? Number(devis.taux_reduction_precedent) : null);
        setAvenantModification(donnees.avenant || null);
        if (detail) {
          setIdTarif(Number(detail.idtarif) || 0);
          setIdOffre(Number(detail.idoffre) || 0);
          if (detail.idtypecontrat) setTypeContrat(Number(detail.idtypecontrat));
          if (String(detail.gestionnairesante || '').trim()) setGestionnaire(String(detail.gestionnairesante).trim());
          const t = Number(detail.tauxreductioncommerciale) || 0;
          setAjustement(t < 0 ? 'majoration' : (t > 0 ? 'reduction' : 'aucun'));
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
          const peutContinuer = Boolean(devis.peut_continuer) && aLeDroit('devis.update');
          setSaisieAContinuer(peutContinuer);
          const suite = peutContinuer ? 'Continuez-la pour modifier le devis et l\'enregistrer en votre nom.' : 'Le devis est affiché en lecture seule.';
          setLectureSeule(devis.operateur_saisie
            ? `Saisie commencée par ${devis.operateur_saisie_nom || `l'opérateur n° ${devis.operateur_saisie}`}. ${suite}`
            : `Devis repris sans saisie ouverte. ${suite}`);
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
  // Base héritée d'URANUS : chaque adhérent est aussi un affilié de lien A. Personnes assurées = tous les affiliés ;
  // affiliés affichés = conjoints et enfants, sans les adhérents. La prime par affilié porte sur chaque personne assurée
  // (sp_creation_devis_sante : prime × affiliés, adhérents compris)
  const nombrePersonnes = affilies.length;
  const nombreAffilies = affilies.filter((f) => String(f.lien || '').trim().toUpperCase() !== 'A').length;
  const primeHtConnue = useMemo(() => {
    if (Number(primeGlobale) > 0) return Number(primeGlobale);
    if (Number(primeFamille) > 0) return Number(primeFamille) * adherents.length;
    if (Number(primeAffilie) > 0) return Number(primeAffilie) * nombrePersonnes;
    return Number(totauxEnregistres?.primeNette) || 0;
  }, [primeGlobale, primeFamille, primeAffilie, adherents.length, nombrePersonnes, totauxEnregistres]);

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

  const supprimer = async (type, idObjet, libelle) => {
    if (!(await confirmer({
      ton: 'attention',
      titre: `Retirer ${libelle} ?`,
      message: 'Cet élément sera retiré de la saisie de ce devis.',
      confirmer: 'Retirer',
    }))) return;
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
    // dateeffetdevis : date d'effet du devis, à laquelle s'apprécie l'âge (limites des conditions)
    const res = await santeApi.enregistrerAdherent(versFormData({ ...a, devis: idDevis, vip: true, dateeffetdevis: dateEffet }));
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
    const res = await santeApi.enregistrerAffilie(versFormData({ ...f, devis: idDevis, dateeffetdevis: dateEffet }));
    await recharger();
    setFormAffilie(null);
    success(res.message || 'Affilié enregistré.');
  }, 'Affilié non enregistré');

  const importer = () => executer(async () => {
    if (!filialeImport) { toastError('Choisissez la filiale des personnes importées.'); return; }
    if (!fichierImport) { toastError('Choisissez le fichier Excel.'); return; }
    const fd = new FormData();
    fd.append('devis', idDevis);
    fd.append('filiale', filialeImport);
    fd.append('date_effet', dateEffet);
    fd.append('fichier_excel', fichierImport);
    fd.append('classer', estMinene && classerFamilles ? '1' : '0');
    const r = await santeApi.importerAffilies(fd);
    if (r?.Classement?.length) {
      success(`Familles rangées selon leur taille : ${r.Classement.map((c) => `${c.Familles} en ${c.Formule}`).join(', ')}. Primes calculées ci-dessous (Primes).`);
    }
    // Les lignes acceptées sont enregistrées même si d'autres sont refusées : la liste est toujours relue
    await recharger();
    const lignes = r?.Lignes || [];
    const detail = (statut) => lignes.filter((l) => l.Statut === statut)
      .map((l) => `ligne ${l.Ligne} ${l.Nom} : ${l.Message}`).join(' ; ');
    if (r?.Importes) {
      success(`${r.Importes} personne${r.Importes > 1 ? 's' : ''} importée${r.Importes > 1 ? 's' : ''}.`);
    }
    if (r?.Derogations) warning(`Admis par dérogation à la limite d'âge - ${detail('dérogation')}`);
    if (r?.Refuses || r?.Ignores) {
      toastError(`${r.Refuses + r.Ignores} personne${r.Refuses + r.Ignores > 1 ? 's' : ''} non importée${r.Refuses + r.Ignores > 1 ? 's' : ''} - `
        + [detail('refusé'), detail('ignoré')].filter(Boolean).join(' ; '));
    } else {
      setFichierImport(null);
      setImportOuvert(false);
    }
  }, 'Import refusé');

  // Santé classique : fichier d'OREOLE analysé (rien n'est écrit) ou importé ; l'import crée les couvertures du
  // fichier et reporte à l'écran la date d'effet, la prime globale, la surprime et le type de contrat
  const importerClassique = (analyser) => executer(async () => {
    if (!fichierImport) { toastError('Choisissez le fichier Excel.'); return; }
    const fd = new FormData();
    fd.append('fichier_excel', fichierImport);
    fd.append('college', collegeImport || idCollege || '');
    fd.append('date_effet', dateEffet);
    fd.append('date_expiration', dateExpiration);
    if (analyser) {
      fd.append('analyser', '1');
      setResultatClassique({ ...(await santeApi.importerClassique(fd)), analyse: true });
      return;
    }
    const id = await assurerSaisie();
    fd.append('devis', id);
    const r = await santeApi.importerClassique(fd);
    setResultatClassique({ ...r, analyse: false });
    await recharger(id);
    if (r.DateEffet) {
      setDateEffet(r.DateEffet);
      if (estDureeLibre(dureeId)) setExpirationLibre(r.DateExpiration || '');
    }
    if (r.TypeContrat) setTypeContrat(Number(r.TypeContrat));
    setPrimeFamille(0);
    setPrimeAffilie(0);
    setPrimeGlobale(Math.round(Number(r.PrimeGlobale) || 0));
    setMontantSurprime(Math.round(Number(r.MontantSurprime) || 0));
    setAjustement('aucun');
    setTaux(0);
    setPrimesDuFichier(true);
    setFichierImport(null);
    success(`${r.Importes} personne${r.Importes > 1 ? 's' : ''} importée${r.Importes > 1 ? 's' : ''} dans ${r.Couvertures.length} couverture`
      + `${r.Couvertures.length > 1 ? 's' : ''} ; date d'effet, prime globale (${fcfa(r.PrimeGlobale)} F) et surprime (${fcfa(r.MontantSurprime)} F) reprises du fichier.`);
    if (r.Derogations) warning(`${r.Derogations} assuré${r.Derogations > 1 ? 's' : ''} admis par dérogation à la limite d'âge.`);
    if (r.Refuses || r.Ignores || r.Erreurs?.length) {
      toastError(`${r.Refuses + r.Ignores + (r.Erreurs?.length || 0)} ligne${r.Refuses + r.Ignores + (r.Erreurs?.length || 0) > 1 ? 's' : ''} non importée${r.Refuses + r.Ignores + (r.Erreurs?.length || 0) > 1 ? 's' : ''} : voir le compte rendu.`);
    }
  }, analyser ? 'Analyse impossible' : 'Import refusé');

  const telechargerModeleClassique = () => executer(async () => {
    downloadBlob(await santeApi.modeleImportClassique(), 'FICHIER IMPORT SANTE CLASSIQUE.xlsx');
  }, 'Modèle non téléchargé');

  // Personnes du bulletin d'adhésion reçu : même import que le fichier Excel, ligne par ligne
  const importerBulletin = () => executer(async () => {
    if (!idDevis || !filiales.length) {
      toastError("Enregistrez d'abord le devis et sa couverture (étape 2), puis importez les personnes du bulletin.");
      setStep(2);
      return;
    }
    const nomDe = (p) => `${p.nom} ${p.prenoms}`.trim();
    const sansSexe = personnesBulletin.filter((p) => !p.sexe);
    if (sansSexe.length) {
      toastError(`Précisez le sexe de : ${sansSexe.map(nomDe).join(', ')}.`);
      return;
    }
    const sansDate = personnesBulletin.filter((p) => !p.date_naissance);
    if (sansDate.length) {
      toastError(`Date de naissance illisible pour : ${sansDate.map(nomDe).join(', ')} (ajoutez la personne à la main).`);
      return;
    }
    const r = await santeApi.importerPersonnes({
      devis: idDevis,
      filiale: filialeBulletin || Number(filiales[0]?.idfiliale),
      dateEffet,
      personnes: personnesBulletin.map((p) => ({
        lien: p.lien, nom: p.nom, prenoms: p.prenoms, date_naissance: p.date_naissance, sexe: p.sexe,
        adresse: p.adresse, date_entree: p.date_entree,
      })),
    });
    await recharger();
    const lignes = r?.Lignes || [];
    const detail = (statut) => lignes.filter((l) => l.Statut === statut).map((l) => `${l.Nom} : ${l.Message}`).join(' ; ');
    if (r?.Importes) success(`${r.Importes} personne${r.Importes > 1 ? 's' : ''} du bulletin importée${r.Importes > 1 ? 's' : ''}.`);
    if (r?.Derogations) warning(`Admis par dérogation à la limite d'âge - ${detail('dérogation')}`);
    if (r?.Refuses || r?.Ignores) toastError(`Non importé(s) - ${[detail('refusé'), detail('ignoré')].filter(Boolean).join(' ; ')}`);
  }, 'Import du bulletin refusé');

  // Données de l'enregistrement, et de l'aperçu des primes calculé par la base sans rien enregistrer
  const donneesDevis = () => ({
    IdDevis: idDevis,
    IdCompagnie: Number(compagnieId),
    IdTarif: Number(idTarif),
    IdOffre: Number(idOffre),
    IdClient: Number(clientId),
    IdAssure: Number(clientId),
    NumeroPoliceCompagnie: numeroPoliceCompagnie || '',
    TypeContrat: Number(typeContrat),
    // Convention URANUS : positif = réduction, négatif = majoration ; aucun ajustement = 0
    TauxReduction: ajustement === 'aucun' ? 0 : (ajustement === 'majoration' ? -1 : 1) * (Number(taux) || 0),
    GestionnaireSante: estMinene ? gestionnaireSante() : (gestionnaire.trim() || gestionnaireSante()),
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

  // Aperçu des primes (barème MINENE, surprimes, accessoires, taxes) recalculé dès que la saisie change : import
  // d'un fichier, adhérent ou affilié ajouté, dates, primes saisies…
  useEffect(() => {
    if (!idDevis || !adherents.length || !dateEffet || !dateExpiration || lectureSeule) { setApercu(null); setApercuErreur(''); return undefined; }
    if (!estMinene && primesSaisies === 0) { setApercu(null); setApercuErreur('Saisissez une prime (par famille, par affilié ou globale) pour voir le calcul.'); return undefined; }
    let actif = true;
    setApercuChargement(true);
    const minuterie = setTimeout(() => {
      santeApi.apercu(donneesDevis())
        .then((d) => { if (actif) { setApercu(d); setApercuErreur(''); } })
        .catch((err) => { if (actif) { setApercu(null); setApercuErreur(messageErreurApi(err)); } })
        .finally(() => { if (actif) setApercuChargement(false); });
    }, 500);
    return () => { actif = false; clearTimeout(minuterie); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  // estMinene : la liste des offres peut arriver après le devis rouvert (sinon « Saisissez une prime » resterait affiché)
  }, [idDevis, adherents, affilies, filiales, dateEffet, dateExpiration, idTarif, idOffre, compagnieId, typeContrat, ajustement, taux,
    primeFamille, primeAffilie, primeGlobale, montantSurprime, accessoireManuel, lectureSeule, estMinene]);

  const continuerSaisie = async () => {
    setRepriseEnCours(true);
    try {
      await santeApi.continuerSaisie(Number(editParam));
      window.location.reload();
    } catch (err) {
      toastError(messageErreurApi(err));
      setRepriseEnCours(false);
    }
  };

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
    if (!estMinene && primesSaisies === 0) { toastError('Renseignez la prime assuré principal, par affilié ou la prime globale.'); return; }
    const res = await santeApi.enregistrerDevis(donneesDevis());
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
          <span style={{ flex: 1 }}>{lectureSeule}</span>
          {saisieAContinuer && (
            <button type="button" className="btn btn-primary" disabled={repriseEnCours} onClick={continuerSaisie} style={{ flexShrink: 0 }}>
              {repriseEnCours ? 'Reprise en cours…' : 'Continuer la saisie'}
            </button>
          )}
        </div>
      )}

      {/* Avenant de modification d'un contrat en cours : même police, prime = écart annuel, entier pour une police MINENE
          (tarif forfaitaire), au prorata des jours restants sinon (sante/avenant.py) */}
      {avenantModification && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid rgba(236, 72, 153, 0.45)', background: 'rgba(236, 72, 153, 0.07)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <Users size={18} color="#db2777" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>Avenant de modification de la police {avenantModification.NumeroPolice}</strong>
            {' '}- effet du {dateFr(dateEffet)} à l'échéance du {dateFr(avenantModification.DateExpirationContrat)}
            {avenantModification.Forfaitaire
              ? ', tarif forfaitaire MINENE : sans prorata'
              : avenantModification.JoursPeriode > 0 && `, prorata ${avenantModification.Jours} jours sur ${avenantModification.JoursPeriode}`}.
            {' '}Un membre ajouté à une famille complète la fait passer d'office dans la formule de sa taille (FAMILLE de 3 personnes + 1 :
            FAMILLE PLUS). La prime de l'avenant est l'écart de prime annuelle avec la composition d'avant la modification, soit
            l'écart entre les deux formules pour une famille qui en change, {avenantModification.Forfaitaire ? 'dû en entier' : 'au prorata'}, sans
            ristourne ; enregistrez le devis après toute modification.
          </span>
        </div>
      )}

      <BandeauQuestionnaire
        qd={qd}
        onChercherClient={(nom) => { setRechercheClient(nom); setListeClientsOuverte(true); setStep(3); }}
        onCreerClient={() => setIsQuickAddClientOpen(true)}
        actions={qd.devis?.genre === 'sante_cotation' && qd.devis.monde_entier && zoneMonde && !zoneImposee ? [{
          libelle: `Zone : ${zoneMonde.libellezone}`,
          icone: Check,
          disabled: desactive || Number(idZone) === Number(zoneMonde.idzone),
          titre: 'Étendue territoriale demandée par le client',
          onClick: () => { setIdZone(Number(zoneMonde.idzone)); success(`Zone de couverture : ${zoneMonde.libellezone}.`); },
        }] : []}
      >
        {personnesBulletin.length > 0 && (
          <div className="qd-personnes">
            <div className="qp-detail-titre">Personnes du bulletin à importer dans la couverture du devis</div>
            <div className="table-wrapper">
              <table className="data-table qd-tableau">
                <thead><tr><th>Lien</th><th>Nom</th><th>Prénoms</th><th>Date de naissance</th><th>Sexe</th></tr></thead>
                <tbody>
                  {personnesBulletin.map((p) => (
                    <tr key={p.cle}>
                      <td>{{ A: 'Adhérent', C: 'Conjoint', E: 'Enfant' }[p.lien] || p.lien}</td>
                      <td>{p.nom}</td>
                      <td>{p.prenoms}</td>
                      <td>
                        {p.date_naissance
                          ? new Date(`${p.date_naissance}T00:00:00`).toLocaleDateString('fr-FR')
                          : <span style={{ color: 'var(--accent-amber)' }}>{p.naissance_lue || 'illisible'}</span>}
                      </td>
                      <td>
                        <select className="form-control" value={p.sexe} aria-label={`Sexe de ${p.nom} ${p.prenoms}`}
                          onChange={(e) => setPersonnesBulletin((l) => l.map((x) => (x.cle === p.cle ? { ...x, sexe: e.target.value } : x)))}>
                          <option value="">-</option>
                          <option value="M">M</option>
                          <option value="F">F</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {filiales.length > 1 && (
                <select className="form-control" style={{ width: 'auto' }} value={filialeBulletin || filiales[0]?.idfiliale}
                  onChange={(e) => setFilialeBulletin(Number(e.target.value))} aria-label="Couverture des personnes importées">
                  {filiales.map((x) => <option key={x.idfiliale} value={x.idfiliale}>{x.nom_filiale}</option>)}
                </select>
              )}
              <button type="button" className="btn btn-primary" onClick={importerBulletin} disabled={desactive}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}
                title={idDevis && filiales.length ? 'Importer ces personnes dans le devis' : "Enregistrez d'abord le devis et sa couverture (étape 2)"}>
                <Upload size={14} /> Importer {personnesBulletin.length} personne{personnesBulletin.length > 1 ? 's' : ''}
              </button>
              {!(idDevis && filiales.length) && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Le devis et sa couverture (étape 2) doivent d'abord être enregistrés.
                </span>
              )}
            </div>
          </div>
        )}
      </BandeauQuestionnaire>

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
                {tarifs.filter((t) => !/oreole/i.test(t.LibelleTarif || '')).map((t) => <option key={t.IdTarif} value={t.IdTarif}>{t.LibelleTarif}</option>)}
              </select>,
              filiales.length > 0
                ? 'Couvertures déjà enregistrées : retirez-les pour changer d\'offre commerciale.'
                : (estMinene ? 'MINENE : prime calculée automatiquement, zone Côte d\'Ivoire.' : undefined))}
            {champ('Ajustement',
              <select
                className="form-control"
                value={ajustement}
                onChange={(e) => { setAjustement(e.target.value); if (e.target.value === 'aucun') setTaux(0); }}
                disabled={desactive}
              >
                <option value="aucun">Aucun</option>
                <option value="reduction">Réduction</option>
                <option value="majoration">Majoration</option>
              </select>,
              ajustement === 'aucun' && estMinene && tauxPrecedent !== null && tauxPrecedent !== 0
                ? `Renouvellement : ${tauxPrecedent > 0 ? 'réduction' : 'majoration'} de ${Math.abs(tauxPrecedent)} % de l'an dernier déjà appliquée à la prime de base ; Aucun : même tarif.`
                : undefined)}
            {ajustement !== 'aucun' && champ(ajustement === 'reduction' ? 'Taux Réduction (%)' : 'Taux Majoration (%)',
              <input
                type="number"
                min="0"
                max={tauxMax}
                className="form-control"
                value={taux}
                onChange={(e) => setTaux(Math.max(0, Math.min(tauxMax, Number(e.target.value) || 0)))}
                disabled={desactive}
                list={estMinene ? 'ajustements-minene' : undefined}
              />,
              estMinene
                ? `${tauxPrecedent !== null && tauxPrecedent !== 0
                  ? `Renouvellement : ${tauxPrecedent > 0 ? 'réduction' : 'majoration'} de ${Math.abs(tauxPrecedent)} % de l'an dernier déjà appliquée à la prime de base ; saisissez l'ajustement de cette année (0 : même tarif). `
                  : ''}Clause d'ajustement : ${(ajustementsMinene[ajustement] || []).map(([t, sp]) => `${t} % (${sp})`).join(', ') || 'aucun taux'}.`
                : 'Hors MINENE, la base enregistre le taux sans l\'appliquer aux primes.')}
            {estMinene && ajustement !== 'aucun' && (
              <datalist id="ajustements-minene">
                {(ajustementsMinene[ajustement] || []).map(([t, sp]) => <option key={t} value={t}>{sp}</option>)}
              </datalist>
            )}
            {estMinene
              ? champ('Gestionnaire', <input type="text" className="form-control" value={gestionnaireSante()} disabled readOnly />, 'MINENE SANTÉ : gestionnaire imposé.')
              : champ('Gestionnaire', <input type="text" className="form-control" value={gestionnaire} maxLength={60} placeholder={gestionnaireSante()}
                onChange={(e) => setGestionnaire(e.target.value)} disabled={desactive} />)}
            {champ('Terme du contrat',
              <TermeContratSelect
                value={termeId}
                onChange={(id) => { setTermeId(id); setDureeId((d) => dureeSelonTerme(id, d)); }}
                disabled={desactive}
              />)}
            {champ('Durée du contrat', <DureeContratSelect value={dureeId} onChange={setDureeId} idsAutorises={[ID_DUREE_ANNUELLE]} disabled={desactive || estDureeLibre(dureeId)} />)}
            {champ('Date d\'émission', <input type="date" className="form-control" value={dateEmission} readOnly disabled title="Date du jour, non modifiable" />,
              avenantModification ? 'Date du jour, non imprimée sur les documents' : undefined)}
            {champ('Date d\'effet (* requis)',
              <input type="date" className="form-control" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} disabled={desactive}
                min={avenantModification?.DateEffetContrat} max={avenantModification?.DateExpirationContrat} />)}
            {champ('Date d\'expiration (* requis)',
              avenantModification
                ? <input type="date" className="form-control" value={dateExpiration} readOnly disabled title="Avenant : échéance du contrat" />
                : estDureeLibre(dureeId)
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
              <h3 style={{ ...titreSection, margin: 0 }}>
                Adhérents ({adherents.length}) et affiliés ({nombreAffilies})
                <span style={{ fontWeight: 500, fontSize: '0.8em', color: 'var(--text-muted)', textTransform: 'none' }}>
                  {' '}- {nombrePersonnes} personne{nombrePersonnes > 1 ? 's' : ''} assurée{nombrePersonnes > 1 ? 's' : ''}
                </span>
              </h3>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" disabled={desactive || (!filiales.length && !estClassique)}
                  onClick={() => {
                    setImportOuvert((v) => !v);
                    setFilialeImport(Number(filiales[0]?.idfiliale) || 0);
                    setCollegeImport((c) => c || idCollege);
                    setResultatClassique(null);
                  }}
                  title={estClassique ? 'Fichier d\'import Santé classique d\'OREOLE : couvertures, familles, date d\'effet et primes repris du fichier' : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  <Upload size={14} /> {estClassique ? 'Importer le fichier Santé classique' : estMinene ? 'Importer (Excel) MINENE' : 'Importer (Excel)'}
                </button>
                <button type="button" className="btn btn-primary" onClick={ouvrirNouvelAdherent} disabled={desactive}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', background: '#10b981' }}>
                  <Plus size={14} /> Nouvel adhérent
                </button>
              </div>
            </div>

            {importOuvert && estClassique && (
              <div style={{ ...encadre, marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>Import Santé classique</h4>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.76rem', color: 'var(--text-muted)', maxWidth: 760 }}>
                      Le fichier renseigne les couvertures (COLLEGE : taux et zone, ex. 100% CI, et le collège s'il le cite), les familles,
                      la date d'effet (plus ancienne DATE D'ENTREE), la prime globale (primes nettes hors surprime, majoration comprise),
                      la surprime et le type de contrat.
                    </p>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={telechargerModeleClassique} disabled={desactive}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                    <Download size={14} /> Modèle Excel
                  </button>
                </div>
                <div style={grille}>
                  {champ('Fichier Excel',
                    <input type="file" accept=".xlsx,.xlsm" className="form-control"
                      onChange={(e) => { setFichierImport(e.target.files?.[0] || null); setResultatClassique(null); }} />)}
                  {champ('Collège par défaut',
                    <select className="form-control" value={collegeImport || idCollege} onChange={(e) => setCollegeImport(Number(e.target.value))}>
                      {colleges.map((c) => <option key={c.idcollege} value={c.idcollege}>{c.libellecollege}</option>)}
                    </select>, 'Pour les couvertures dont la colonne COLLEGE ne cite pas de collège.')}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => importerClassique(true)} disabled={desactive || !fichierImport}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Search size={14} /> Analyser
                    </button>
                    <button type="button" className="btn btn-primary" onClick={() => importerClassique(false)} disabled={desactive || !fichierImport}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Upload size={14} /> Importer
                    </button>
                  </div>
                </div>
                {resultatClassique && (
                  <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <div style={{ fontSize: '0.84rem' }}>
                      <strong>{resultatClassique.analyse ? 'Analyse - rien n\'est encore enregistré' : 'Import terminé'}</strong> :
                      {' '}{resultatClassique.Familles} famille{resultatClassique.Familles > 1 ? 's' : ''}, {resultatClassique.Personnes} personne{resultatClassique.Personnes > 1 ? 's' : ''}
                      {!resultatClassique.analyse && `, ${resultatClassique.Importes} importée${resultatClassique.Importes > 1 ? 's' : ''}`}
                      {resultatClassique.DateEffet && ` ; effet le ${resultatClassique.DateEffet.split('-').reverse().join('/')}`}
                      {` ; prime globale ${fcfa(resultatClassique.PrimeGlobale)} F, surprime ${fcfa(resultatClassique.MontantSurprime)} F`}
                      {resultatClassique.Majoration > 0 && `, dont majoration ${fcfa(resultatClassique.Majoration)} F (${String(resultatClassique.TauxMajoration).replace('.', ',')} %)`}
                      {` ; ${resultatClassique.Groupe ? 'contrat société (au-delà des seuils du contrat groupe)' : 'contrat particulier'}.`}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead><tr style={{ borderBottom: '1px solid var(--border-medium)', textAlign: 'left' }}>
                          <th style={{ padding: '0.35rem' }}>Couverture</th><th style={{ padding: '0.35rem' }}>Collège</th>
                          <th style={{ padding: '0.35rem' }}>Familles</th><th style={{ padding: '0.35rem' }}>Personnes</th>
                          <th style={{ padding: '0.35rem', textAlign: 'right' }}>Prime nette</th><th style={{ padding: '0.35rem', textAlign: 'right' }}>Surprime</th>
                        </tr></thead>
                        <tbody>
                          {resultatClassique.Couvertures.map((cv) => (
                            <tr key={`${cv.IdOffre}-${cv.IdCollege}-${cv.IdZone}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              <td style={{ padding: '0.35rem' }}>{cv.Formule}</td><td style={{ padding: '0.35rem' }}>{cv.College}</td>
                              <td style={{ padding: '0.35rem' }}>{cv.Familles}</td><td style={{ padding: '0.35rem' }}>{cv.Personnes}</td>
                              <td style={{ padding: '0.35rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(cv.PrimeNette)} F</td>
                              <td style={{ padding: '0.35rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(cv.Surprime)} F</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {[...(resultatClassique.Erreurs || []).map((e) => ({ ...e, Statut: 'non lue' })),
                      ...(resultatClassique.Lignes || []).filter((l) => l.Statut !== 'importé'),
                      ...(resultatClassique.Avertissements || []).map((e) => ({ ...e, Statut: 'à vérifier' }))].map((l) => (
                      <div key={`${l.Ligne}-${l.Statut}`} style={{ fontSize: '0.78rem', color: l.Statut === 'à vérifier' || l.Statut === 'dérogation' ? 'var(--accent-amber)' : 'var(--accent-rose)' }}>
                        Ligne {l.Ligne} {l.Nom} - {l.Statut} : {l.Message}
                      </div>
                    ))}
                  </div>
                )}
                <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Colonnes du modèle (1re ligne) : {COLONNES_IMPORT_CLASSIQUE}. Chaque assuré principal (A) précède son conjoint (C) et ses enfants (E) ;
                  {' '}FILIATION vide : la personne forme sa propre famille. AVENANT : date ou référence de la compagnie. Les lignes TOTAL sont ignorées.
                </p>
              </div>
            )}

            {importOuvert && !estClassique && (
              <div style={{ ...encadre, marginBottom: '1.25rem' }}>
                <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{estMinene ? 'Import MINENE' : 'Importation des adhérents et affiliés'}</h4>
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
                {estMinene && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.75rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={classerFamilles} onChange={(e) => setClasserFamilles(e.target.checked)} disabled={desactive} />
                    Ranger chaque famille dans la formule de sa taille ({tailleFormules()}) : couvertures créées au besoin, primes calculées par le barème
                  </label>
                )}
                <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Colonnes attendues (1re ligne) : {COLONNES_IMPORT}. Chaque adhérent (lien A) précède ses affiliés.
                  {' '}Âges appréciés à la date d'effet du devis ; au-delà des limites des conditions,{' '}
                  {aLeDroit('devis.derogation_age')
                    ? 'les assurés sont admis par dérogation (vous êtes habilité).'
                    : 'les assurés sont refusés (seul un utilisateur habilité « Déroger à la limite d\'âge » peut les admettre).'}
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
                  {champ('Nombre d’affections chroniques', <input type="number" min="0" max={affectionsMax} className="form-control" value={formAdherent.nombrepathologie} onChange={(e) => setFormAdherent((p) => ({ ...p, nombrepathologie: Math.max(0, Math.min(affectionsMax, Number(e.target.value) || 0)) }))} disabled={desactive} />, aideAffections(minene))}
                  {champ('Numéro de téléphone *', <input type="tel" className="form-control" value={formAdherent.mobile1 || ''} onChange={(e) => setFormAdherent((p) => ({ ...p, mobile1: e.target.value }))} disabled={desactive} />)}
                  {champ('E-mail *', <input type="email" className="form-control" value={formAdherent.email || ''} onChange={(e) => setFormAdherent((p) => ({ ...p, email: e.target.value }))} disabled={desactive} />)}
                  {champ('Date d\'effet', <input type="date" className="form-control" value={formAdherent.dateeffet} onChange={(e) => setFormAdherent((p) => ({ ...p, dateeffet: e.target.value }))} disabled={desactive} />)}
                  {champ('Date début consommation', <input type="date" className="form-control" value={formAdherent.datedebutconsommation} onChange={(e) => setFormAdherent((p) => ({ ...p, datedebutconsommation: e.target.value }))} disabled={desactive} />)}
                  {interrupteur('Surprime', formAdherent.surprimeappliquee, (v) => setFormAdherent((p) => ({ ...p, surprimeappliquee: v })))}
                  {formAdherent.surprimeappliquee && champ('Montant Surprime', <AmountInput value={formAdherent.montantsurprime} onChange={(v) => setFormAdherent((p) => ({ ...p, montantsurprime: v }))} disabled={desactive} />, estMinene ? 'MINENE : ce montant annuel remplace la surprime calculée (âge et affection) de cette personne ; à 0, la surprime reste calculée.' : undefined)}
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
                    <th style={{ ...cellule, textAlign: 'center' }}>AFFECTIONS</th>
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
                          <td style={{ ...cellule, textAlign: 'center' }} title={`${membres.length} personne${membres.length > 1 ? 's' : ''} avec l'adhérent`}>
                            {membres.filter((f) => String(f.lien || '').trim().toUpperCase() !== 'A').length}
                          </td>
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
                  {champ('Nombre d’affections chroniques', <input type="number" min="0" max={affectionsMax} className="form-control" value={formAffilie.nombrepathologie} onChange={(e) => setFormAffilie((p) => ({ ...p, nombrepathologie: Math.max(0, Math.min(affectionsMax, Number(e.target.value) || 0)) }))} disabled={desactive} />, aideAffections(minene))}
                  {champ('Date d\'effet', <input type="date" className="form-control" value={formAffilie.dateeffet} onChange={(e) => setFormAffilie((p) => ({ ...p, dateeffet: e.target.value }))} disabled={desactive} />)}
                  {champ('Date début consommation', <input type="date" className="form-control" value={formAffilie.datedebutconsommation} onChange={(e) => setFormAffilie((p) => ({ ...p, datedebutconsommation: e.target.value }))} disabled={desactive} />)}
                  {interrupteur('Pathologie antérieure', formAffilie.handicape, (v) => setFormAffilie((p) => ({ ...p, handicape: v })))}
                  {interrupteur('Certificat de scolarité / rapport médical', formAffilie.certificat, (v) => setFormAffilie((p) => ({ ...p, certificat: v })))}
                  {interrupteur('Surprime', formAffilie.surprimeappliquee, (v) => setFormAffilie((p) => ({ ...p, surprimeappliquee: v })))}
                  {formAffilie.surprimeappliquee && champ('Montant Surprime', <AmountInput value={formAffilie.montantsurprime} onChange={(v) => setFormAffilie((p) => ({ ...p, montantsurprime: v }))} disabled={desactive} />, estMinene ? 'MINENE : ce montant annuel remplace la surprime calculée (âge et affection) de cette personne ; à 0, la surprime reste calculée.' : undefined)}
                </div>
                {formAffilie.lien === 'E' && (
                  <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Enfant : admis jusqu&apos;à 21 ans ; de 22 à 25 ans, certificat de scolarité de l&apos;année ou rapport médical (handicap réduisant totalement la mobilité) exigé ; refusé au-delà de 25 ans (contrôles de la base).
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
              {champ('Prime assuré principal', <AmountInput value={primeFamille} onChange={setPrimeFamille} disabled={desactive || (primesSaisies > 0 && !(Number(primeFamille) > 0))} />)}
              {champ('Prime par Affilié', <AmountInput value={primeAffilie} onChange={setPrimeAffilie} disabled={desactive || (primesSaisies > 0 && !(Number(primeAffilie) > 0))} />)}
              {champ('Prime globale', <AmountInput value={primeGlobale} onChange={(v) => { setPrimeGlobale(v); setPrimesDuFichier(false); }} disabled={desactive || (primesSaisies > 0 && !(Number(primeGlobale) > 0))} />,
                primesDuFichier ? 'Reprise du fichier importé : primes nettes des assurés hors surprime, majoration comprise.' : undefined)}
              {champ(estClassique ? 'Surprime' : 'Surprime affection', <AmountInput value={montantSurprime} onChange={(v) => { setMontantSurprime(v); setPrimesDuFichier(false); }} disabled={desactive} />,
                estMinene ? 'Remplace la surprime calculée pour les affections chroniques ; la surprime d\'âge s\'ajoute toujours.'
                  : (primesDuFichier ? 'Reprise du fichier importé : somme de la colonne SURPRIME.' : undefined))}
              {champ('Accessoire Manuel', <AmountInput value={accessoireManuel} onChange={setAccessoireManuel} disabled={desactive} />,
                estMinene
                  ? 'À 0 : accessoire du barème, par famille ; sinon ce montant par famille.'
                  : 'À 0 : barèmes de la compagnie et du cabinet ; sinon accessoire du devis, partagé selon la fiche de la compagnie.')}
            </div>
            <p style={{ margin: '0.85rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {estMinene
                ? `MINENE : laissez les primes à 0 pour tarifer chaque famille selon la formule de sa couverture (${tailleFormules()}), avec les surprimes d'âge à la date d'effet (${minene.surprimes.age1Debut}–${minene.surprimes.age2Debut - 1} ans : ${minene.surprimes.age1Taux} %, ${minene.surprimes.age2Debut}–${minene.surprimes.ageMaxAdulte} ans : ${minene.surprimes.age2Taux} %, adhérent et conjoint de ${minene.surprimes.ageMaxAdulte} ans au plus) et d'affection chronique (${minene.surprimes.affection} % par affection, ${affectionsMax} au maximum), et l'accessoire du barème par famille.`
                : `Une seule prime : par famille (× adhérents), par affilié (× personnes assurées, adhérents compris) ou globale. Au-delà de ${parametre('sante.groupe_adherents', 5)} adhérents ou de ${parametre('sante.groupe_affilies', 25)} personnes assurées, le devis est un contrat groupe (taxe des contrats groupe).`}
            </p>

            {/* Primes calculées par la base sans rien enregistrer : barème de la formule de chaque famille, surprimes,
                accessoires et taxes ; il ne reste à l'utilisateur qu'à compléter ce qui manque */}
            {(apercu || apercuErreur || apercuChargement) && (
              <div style={{ ...encadre, marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                    {estMinene ? 'Primes calculées par le barème MINENE' : 'Primes calculées'}
                    {/* Avenant : âges à la date d'effet du contrat de la période (sp_creation_devis_sante v9) */}
                    {dateEffet && <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.78rem' }}> - âges au {dateFr(avenantModification?.DateEffetContrat || dateEffet)}</span>}
                  </div>
                  {apercuChargement && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Calcul…</span>}
                </div>
                {apercuErreur && !apercu ? (
                  <div style={{ fontSize: '0.8rem', color: 'var(--accent-amber)' }}>{apercuErreur}</div>
                ) : apercu && (() => {
                  // Réduction (montant négatif) ou majoration (positif) de l'année : les colonnes montrent les primes avant
                  // l'ajustement, puis l'ajustement de chaque famille et sa prime Santé ajustée
                  const ajustement = Number(apercu.Totaux.Ajustement) || 0;
                  const tauxAjustement = Number(apercu.Totaux.TauxAjustement) || 0;
                  const libelleAjustement = tauxAjustement < 0 || ajustement < 0
                    ? `Réduction ${Math.abs(tauxAjustement).toLocaleString('fr-FR')} %` : `Majoration ${Math.abs(tauxAjustement).toLocaleString('fr-FR')} %`;
                  const signe = (x) => (Number(x) < 0 ? `− ${fcfa(Math.abs(x))}` : Number(x) > 0 ? `+ ${fcfa(x)}` : fcfa(0));
                  const avant = (f, cle) => (ajustement ? f[`${cle}Avant`] : f[cle]);
                  // Avenant de modification : primes annuelles d'avant et d'après la modification, puis montants de l'avenant
                  const av = apercu.Avenant;
                  const tuiles = av ? [
                    ['Prime annuelle avant modification', av.PrimeAnnuellePrecedente], ['Nouvelle prime annuelle', av.PrimeAnnuelle],
                    [av.Forfaitaire ? "Prime nette de l'avenant - écart annuel entier" : `Prime nette de l'avenant - ${av.Jours} j sur ${av.JoursPeriode}`,
                      apercu.Totaux.PrimeNette],
                    ['Accessoires', apercu.Totaux.Accessoire], ['Taxes', apercu.Totaux.Taxe], ['Prime TTC', apercu.Totaux.PrimeTtc],
                  ] : [
                    ...(ajustement ? [['Prime nette avant ajustement', apercu.Totaux.PrimeNetteAvantAjustement], [libelleAjustement, ajustement]] : []),
                    ['Prime nette', apercu.Totaux.PrimeNette], ['Accessoires', apercu.Totaux.Accessoire], ['Taxes', apercu.Totaux.Taxe],
                    ...(apercu.Totaux.FraisGestion ? [['Frais de gestion', apercu.Totaux.FraisGestion]] : []), ['Prime TTC', apercu.Totaux.PrimeTtc],
                  ];
                  return (
                  <>
                    {apercu.Familles?.length > 0 && (
                      <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                        <table className="table" style={{ width: '100%', fontSize: '0.8rem' }}>
                          <thead>
                            <tr style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                              <th style={cellule}>FAMILLE</th>
                              <th style={cellule}>FORMULE</th>
                              <th style={{ ...cellule, textAlign: 'right' }}>PRIME DE BASE</th>
                              <th style={{ ...cellule, textAlign: 'right' }}>SURPRIME D'ÂGE</th>
                              <th style={{ ...cellule, textAlign: 'right' }}>SURPRIME AFFECTION</th>
                              {ajustement !== 0 && <th style={{ ...cellule, textAlign: 'right' }}>{libelleAjustement.toUpperCase()}</th>}
                              <th style={{ ...cellule, textAlign: 'right' }}>PRIME SANTÉ</th>
                              <th style={{ ...cellule, textAlign: 'right' }}>ACCESSOIRE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {apercu.Familles.map((f) => {
                              const surprimes = f.Personnes.filter((p) => avant(p, 'SurprimeAge') || avant(p, 'SurprimeAffection'));
                              return (
                                <tr key={f.IdAdherent}>
                                  <td style={cellule}>
                                    <div style={{ fontWeight: 700 }}>{f.Adherent}</div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{f.NombrePersonnes} personne{f.NombrePersonnes > 1 ? 's' : ''}</div>
                                    {surprimes.map((p) => (
                                      <div key={p.IdAffilie} style={{ fontSize: '0.72rem', color: 'var(--accent-amber)' }}>
                                        {p.Nom} ({libelleLien(p.Lien)}, {p.Age} ans{p.Pathologies ? `, ${p.Pathologies} affection${p.Pathologies > 1 ? 's' : ''}` : ''}) :
                                        {avant(p, 'SurprimeAge') ? ` âge ${fcfa(avant(p, 'SurprimeAge'))} F` : ''}{avant(p, 'SurprimeAffection') ? ` affection ${fcfa(avant(p, 'SurprimeAffection'))} F` : ''}
                                      </div>
                                    ))}
                                  </td>
                                  <td style={cellule}>{f.Formule}</td>
                                  <td style={{ ...cellule, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(avant(f, 'PrimeBase'))}</td>
                                  <td style={{ ...cellule, textAlign: 'right', fontFamily: 'var(--font-mono)', color: avant(f, 'SurprimeAge') ? 'var(--accent-amber)' : undefined }}>{fcfa(avant(f, 'SurprimeAge'))}</td>
                                  <td style={{ ...cellule, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(avant(f, 'SurprimeAffection') + avant(f, 'SurprimeSaisie'))}</td>
                                  {ajustement !== 0 && (
                                    <td style={{ ...cellule, textAlign: 'right', fontFamily: 'var(--font-mono)', color: f.Ajustement < 0 ? 'var(--accent-emerald, #10b981)' : f.Ajustement > 0 ? 'var(--accent-amber)' : undefined }}>{signe(f.Ajustement)}</td>
                                  )}
                                  <td style={{ ...cellule, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fcfa(f.PrimeSante)}</td>
                                  <td style={{ ...cellule, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fcfa(f.Accessoire)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem', marginTop: '0.75rem' }}>
                      {tuiles.map(([libelle, valeur]) => (
                        <div key={libelle} style={{ padding: '0.6rem 0.75rem', borderRadius: '8px', border: libelle === 'Prime TTC' ? '2px solid #ec4899' : '1px solid var(--border-subtle)' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{libelle}</div>
                          <div style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                            {libelle === libelleAjustement ? signe(valeur) : fcfa(valeur)} FCFA
                          </div>
                        </div>
                      ))}
                    </div>
                    {Number(primeGlobale) > 0 && estMinene && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--accent-amber)', marginTop: '0.5rem' }}>Prime globale saisie : elle comprend tout, aucune surprime n'y est ajoutée.</div>
                    )}
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.6rem' }}>
                      {clientId
                        ? 'Calcul indicatif, refait à l\'enregistrement du devis.'
                        : 'Reste à faire : choisissez le client ci-dessus, puis enregistrez le devis.'}
                    </div>
                  </>
                  );
                })()}
              </div>
            )}

            {/* MINENE : surprimes d'âge que la base ajoutera à l'enregistrement, quand le calcul n'est pas disponible
                (devis ouvert par un autre opérateur) */}
            {estMinene && !apercu && !apercuErreur && surprimesAge.length > 0 && (
              <div style={{ ...encadre, marginTop: '1rem', fontSize: '0.82rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
                  Surprimes d'âge au {dateFr(dateEffet)}
                </div>
                {Number(primeGlobale) > 0 ? (
                  <div style={{ color: 'var(--accent-amber)' }}>Prime globale saisie : elle comprend tout, aucune surprime n'y est ajoutée.</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--text-secondary)' }}>
                    {surprimesAge.map(({ f, ans, taux: t }) => (
                      <li key={f.idaffilie}>{`${f.nom || ''} ${f.prenom || ''}`.trim()} ({libelleLien(f.lien)}, {ans} ans) : {t} % de la prime de base de sa formule</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

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
        valeursInitiales={qd.client}
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
