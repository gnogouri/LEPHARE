import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { settingsApi, contractApi, quoteApi, voyageApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { ViewQuoteModal } from './ViewQuoteModal';
import { QuickAddClientModal } from '../clients/QuickAddClientModal';
import { TermeContratSelect } from '../../../components/common/TermeContratSelect';
import { ID_TERME_PAR_DEFAUT, idTermeValide } from '../../../utils/termesContrat';
import { trierParLibelle } from '../../../utils/sortUtils';
import { Champ, RechercheClient, FichePersonne, personneDepuisClient } from '../../../components/common/RechercheClient';
import {
  Plane, Globe, Users, ShieldCheck, FileCheck, CheckCircle2, ChevronLeft, ChevronRight,
  AlertTriangle, Loader2, CalendarDays, MapPin,
} from 'lucide-react';

// Parcours de production Voyage d'URANUS (Contrat, Offre, Souscripteur/Assuré), réorganisé en étapes.
// Listes, offres, garanties et primes viennent de la base : tarifvoyage, payszone, offrevoyage,
// offregarantievoyage (grille zone x durée x âge) ; enregistrement par sp_creation_devis_voyage
// (POST /api/devisvoyage/enregistrement/). Un devis Voyage couvre un seul voyageur.
const ID_PRODUIT_VOYAGE = 3;
const ID_COMPAGNIE_PAR_DEFAUT = 21; // AMSA ASSURANCES, compagnie proposée par URANUS
const REDUCTION_MAX = 35;

const ETAPES = [
  { num: 1, libelle: 'Souscripteur & assuré', icone: Users },
  { num: 2, libelle: 'Voyage', icone: Globe },
  { num: 3, libelle: 'Offre & prime', icone: ShieldCheck },
  { num: 4, libelle: 'Récapitulatif', icone: FileCheck },
];

const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
const aujourdhui = () => new Date().toISOString().split('T')[0];
const jour = (v) => (v ? String(v).slice(0, 10) : '');
const dateFr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const versDmy = (iso) => (iso ? iso.split('-').reverse().join('-') : '');
// Durée tarifée : date d'expiration - date d'effet, en jours (comme la base)
const ecartJours = (debut, fin) => {
  if (!debut || !fin) return null;
  return Math.round((Date.UTC(...fin.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)))
    - Date.UTC(...debut.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)))) / 86400000);
};
// Âge retenu par la base : années révolues à la date du jour
const ageAuJour = (naissance) => {
  if (!naissance) return null;
  const n = new Date(naissance);
  const t = new Date();
  let a = t.getFullYear() - n.getFullYear();
  if (t.getMonth() < n.getMonth() || (t.getMonth() === n.getMonth() && t.getDate() < n.getDate())) a -= 1;
  return a;
};

const messageErreurApi = (err) => {
  const data = err?.response?.data;
  if (!data) return err?.message || 'serveur injoignable';
  if (Array.isArray(data)) return data[0]?.OutputMessage || JSON.stringify(data[0]);
  if (typeof data === 'string') return data.slice(0, 200);
  const direct = data.error || data.erreur || data.message || data.detail || data.OutputMessage;
  if (direct) return typeof direct === 'string' ? direct : JSON.stringify(direct);
  return Object.entries(data).map(([champ, v]) => `${champ} : ${Array.isArray(v) ? v.join(' ') : v}`).join(' ; ');
};


const styles = {
  carte: { padding: '1.5rem', borderRadius: '14px' },
  titreCarte: { display: 'flex', alignItems: 'center', gap: '0.55rem', margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' },
  grille: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '1rem 1.25rem', alignItems: 'start' },
  sousTitre: { fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '1.5rem 0 0.75rem' },
  aide: { fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' },
  alerte: (couleur) => ({
    display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.8rem 1rem', borderRadius: '10px',
    border: `1px solid ${couleur}`, background: 'var(--bg-surface-elevated)', fontSize: '0.85rem', color: 'var(--text-primary)',
  }),
  pastille: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700, background: 'var(--primary-glow)', color: 'var(--primary-500)' },
  ligneRecap: { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px dashed var(--border-subtle)', fontSize: '0.84rem' },
};


export const NewVoyageQuotePage = () => {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  // « Modifier » depuis le registre des devis : ?edit=<iddevis>
  const [searchParams] = useSearchParams();
  const editParam = searchParams.get('edit');
  const [chargementEdition, setChargementEdition] = useState(Boolean(editParam));
  const [idDevisEdite, setIdDevisEdite] = useState(0);
  const [numeroDevisEdite, setNumeroDevisEdite] = useState('');
  const [avertissementReprise, setAvertissementReprise] = useState('');

  const [step, setStep] = useState(1);
  const [tentative, setTentative] = useState({});
  const [enregistrement, setEnregistrement] = useState(false);
  const [devisEnregistre, setDevisEnregistre] = useState(null);
  const [nouveauClientPour, setNouveauClientPour] = useState(null);

  // Référentiels
  const [compagnies, setCompagnies] = useState([]);
  const [tarifs, setTarifs] = useState([]);
  const [paysZone, setPaysZone] = useState([]);
  const [zones, setZones] = useState([]);
  const [nationalites, setNationalites] = useState([]);
  const [offres, setOffres] = useState([]);
  const [chargementListes, setChargementListes] = useState(false);

  // Souscripteur / assuré
  const [souscripteur, setSouscripteur] = useState(null);
  const [assureDifferent, setAssureDifferent] = useState(false);
  const [assureChoisi, setAssureChoisi] = useState(null);
  const assure = assureDifferent ? assureChoisi : souscripteur;

  // Contrat & voyage (noms des champs URANUS)
  const [compagnie, setCompagnie] = useState(ID_COMPAGNIE_PAR_DEFAUT);
  const [categorie, setCategorie] = useState(0); // formule = IdTarif
  const [numeroPoliceCompagnie, setNumeroPoliceCompagnie] = useState('');
  const [nationalite, setNationalite] = useState(0);
  const [paysDestination, setPaysDestination] = useState(0);
  const [referenceContrat, setReferenceContrat] = useState('');
  const [numeroAttestation, setNumeroAttestation] = useState('');
  const [numeroPassport, setNumeroPassport] = useState('');
  const [schengen, setSchengen] = useState(false);
  const [dateNaissance, setDateNaissance] = useState('');
  const [dateEffet, setDateEffet] = useState(aujourdhui());
  const [dateExpiration, setDateExpiration] = useState('');
  const [termeId, setTermeId] = useState(ID_TERME_PAR_DEFAUT);
  const [idAvenant, setIdAvenant] = useState(1);
  const dateEmission = aujourdhui();

  // Offre & prime
  const [offre, setOffre] = useState(0);
  const [reduction, setReduction] = useState(0);
  const [calcul, setCalcul] = useState(null); // { lignes, cumul } ou { erreur }
  const [calculEnCours, setCalculEnCours] = useState(false);

  // ---------------------------------------------------------------- référentiels
  useEffect(() => {
    let actif = true;
    Promise.all([
      settingsApi.getCompanies().catch(() => []),
      voyageApi.getNationalites().catch(() => []),
      voyageApi.getZones().catch(() => []),
    ]).then(([cies, nats, zns]) => {
      if (!actif) return;
      setCompagnies((cies || []).map((c) => ({ id: Number(c.IdCompagnie ?? c.id), nom: c.RaisonSociale || c.nom || `Compagnie ${c.IdCompagnie ?? c.id}` })));
      setNationalites(Array.isArray(nats) ? nats : []);
      setZones(Array.isArray(zns) ? zns : []);
      if (!editParam && Array.isArray(nats)) {
        const ivoirien = nats.find((p) => String(p.nationalite || '').toLowerCase() === 'ivoirienne');
        if (ivoirien) setNationalite((n) => n || ivoirien.id_pays);
      }
    });
    return () => { actif = false; };
  }, [editParam]);

  // Formules et pays de destination de la compagnie (fn_liste_tarif_voyage, fn_liste_pays_voyage)
  useEffect(() => {
    if (!compagnie) return undefined;
    let actif = true;
    setChargementListes(true);
    Promise.all([
      voyageApi.getTarifsVoyage(compagnie),
      voyageApi.getPaysZone(compagnie),
    ]).then(([trfs, pays]) => {
      if (!actif) return;
      const listeTarifs = Array.isArray(trfs) ? trfs : [];
      const listePays = Array.isArray(pays) ? pays : [];
      setTarifs(listeTarifs);
      setPaysZone(listePays);
      setCategorie((c) => (listeTarifs.some((t) => Number(t.IdTarif) === Number(c)) ? c : Number(listeTarifs[0]?.IdTarif) || 0));
      setPaysDestination((p) => (listePays.some((x) => Number(x.id_pays) === Number(p)) ? p : 0));
    }).finally(() => { if (actif) setChargementListes(false); });
    return () => { actif = false; };
  }, [compagnie]);

  const destination = useMemo(
    () => paysZone.find((p) => Number(p.id_pays) === Number(paysDestination)) || null,
    [paysZone, paysDestination],
  );
  const idZone = destination ? Number(destination.id_zone) : 0;
  const libelleZone = zones.find((z) => Number(z.id_zone) === idZone)?.libelle_zone || (idZone ? `Zone ${idZone}` : '');

  // Offres de la formule et de la zone (fn_liste_offre_voyage)
  useEffect(() => {
    if (!compagnie || !categorie || !idZone) { setOffres([]); return undefined; }
    let actif = true;
    voyageApi.getOffresVoyage(compagnie, categorie, idZone).then((res) => {
      if (!actif) return;
      const liste = (Array.isArray(res) ? res : []).map((o) => ({ IdOffre: Number(o.IdOffre), LibelleOffre: o.LibelleOffre }));
      setOffres(liste);
      setOffre((o) => (liste.some((x) => x.IdOffre === Number(o)) ? o : liste[0]?.IdOffre || 0));
    });
    return () => { actif = false; };
  }, [compagnie, categorie, idZone]);

  const duree = ecartJours(dateEffet, dateExpiration);
  const age = ageAuJour(dateNaissance);

  // Prime de la grille (offregarantievoyage), recalculée à chaque changement
  useEffect(() => {
    if (!offre || !idZone || !dateNaissance || !dateEffet || !dateExpiration || duree === null || duree < 1) {
      setCalcul(null);
      return undefined;
    }
    let actif = true;
    const minuterie = setTimeout(async () => {
      setCalculEnCours(true);
      try {
        const lignes = await voyageApi.calculerPrime({
          IdOffre: Number(offre),
          IdCompagnie: Number(compagnie),
          IdTarif: Number(categorie),
          IdZoneVoyage: idZone,
          TauxReduction: Number(reduction) || 0,
          DateEffet: versDmy(dateEffet),
          DateExpiration: versDmy(dateExpiration),
          DateNaissance: versDmy(dateNaissance),
        });
        if (!actif) return;
        const liste = Array.isArray(lignes) ? lignes : [];
        setCalcul({
          lignes: liste.filter((l) => Number(l.IdGarantie) !== 0 && Number(l.IdSousGarantie) !== 0),
          cumul: liste.find((l) => Number(l.IdGarantie) === 0) || null,
        });
      } catch (err) {
        if (actif) setCalcul({ erreur: messageErreurApi(err) });
      } finally {
        if (actif) setCalculEnCours(false);
      }
    }, 300);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [offre, compagnie, categorie, idZone, reduction, dateEffet, dateExpiration, dateNaissance, duree]);

  const montants = useMemo(() => {
    const c = calcul?.cumul;
    if (!c) return null;
    const primeAnnuelle = Number(c.PrimeAnnuelle) || 0;
    const primeNette = Number(c.PrimeNette) || 0;
    const accessoire = Number(c.MontantAccessoire) || 0;
    const taxe = Number(c.Taxe) || 0;
    // Prime TTC arrondie comme sp_creation_devis_voyage : ROUND(prime nette + accessoire + taxe)
    return { primeAnnuelle, primeNette, accessoire, taxe, reduction: primeAnnuelle - primeNette, primeTtc: Math.round(primeNette + accessoire + taxe) };
  }, [calcul]);

  // ---------------------------------------------------------------- Modifier (?edit=)
  useEffect(() => {
    if (!editParam) return undefined;
    let actif = true;
    (async () => {
      setChargementEdition(true);
      try {
        const d = await voyageApi.lireDevis(editParam);
        if (!actif) return;
        if (d.Confirme) {
          toastError('Ce devis est confirmé (déjà en contrat) : il ne peut plus être modifié.');
          navigate('/user/quotes');
          return;
        }
        if (!d.Detail) {
          toastError('Ce devis repris d\'URANUS n\'a pas de ligne de détail en base : il ne peut pas être modifié.');
          navigate('/user/quotes');
          return;
        }
        setIdDevisEdite(Number(d.IdDevis));
        setNumeroDevisEdite(d.NumeroDevis || '');
        setIdAvenant(Number(d.IdAvenant) || 1);
        setCompagnie(Number(d.IdCompagnie) || ID_COMPAGNIE_PAR_DEFAUT);
        setCategorie(Number(d.Detail.IdTarif) || 0);
        setOffre(Number(d.Detail.IdOffre) || 0);
        setReduction(Number(d.Detail.TauxReduction) || 0);
        setDateNaissance(jour(d.Detail.DateNaissance));
        setDateEffet(jour(d.DateEffet));
        setDateExpiration(jour(d.DateExpiration));
        setTermeId(idTermeValide(d.IdTerme));
        setNumeroPoliceCompagnie(d.NumeroPoliceCompagnie || '');
        const client = personneDepuisClient(d.Client);
        const assureLu = personneDepuisClient(d.Assure);
        setSouscripteur(client);
        if (assureLu && client && assureLu.IdClient !== client.IdClient) {
          setAssureDifferent(true);
          setAssureChoisi(assureLu);
        }
        if (d.Complement) {
          setPaysDestination(Number(d.Complement.IdPaysDestination) || 0);
          setNationalite(Number(d.Complement.IdPaysVoyageur) || 0);
          setReferenceContrat(d.Complement.ReferenceContrat || '');
          setNumeroAttestation(d.Complement.NumeroAttestation || '');
          setNumeroPassport(d.Complement.NumeroPasseport || '');
          setSchengen(Boolean(d.Complement.Schengen));
        }
        const manques = [];
        if (!d.Complement) manques.push('destination, nationalité, passeport, attestation et référence');
        if (!Number(d.Detail.IdOffre)) manques.push('offre');
        setAvertissementReprise(manques.length
          ? `Devis repris d'URANUS : ${manques.join(' et ')} non enregistrés en base. Complétez-les ; la prime sera recalculée à l'enregistrement.`
          : '');
      } catch (err) {
        if (actif) {
          toastError(`Impossible de charger le devis à modifier : ${messageErreurApi(err)}`);
          navigate('/user/quotes');
        }
      } finally {
        if (actif) setChargementEdition(false);
      }
    })();
    return () => { actif = false; };
  }, [editParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- contrôles
  const erreursEtape = (n) => {
    const e = {};
    if (n === 1) {
      if (!souscripteur?.IdClient) e.souscripteur = 'Choisissez le souscripteur dans la liste.';
      if (assureDifferent && !assureChoisi?.IdClient) e.assure = 'Choisissez l\'assuré dans la liste.';
    }
    if (n === 2) {
      if (!compagnie) e.compagnie = 'Choisissez la compagnie.';
      if (!categorie) e.categorie = 'Aucune formule Voyage pour cette compagnie.';
      if (!paysDestination) e.paysDestination = paysZone.length ? 'Choisissez le pays de destination.' : 'Aucun pays de destination paramétré pour cette compagnie.';
      if (!nationalite) e.nationalite = 'Choisissez la nationalité.';
      if (!dateNaissance) e.dateNaissance = 'Saisissez la date de naissance du voyageur.';
      else if (dateNaissance > aujourdhui()) e.dateNaissance = 'La date de naissance ne peut pas être dans le futur.';
      if (!dateEffet) e.dateEffet = 'Saisissez la date d\'effet.';
      if (!dateExpiration) e.dateExpiration = 'Saisissez la date d\'expiration.';
      else if (duree !== null && duree < 1) e.dateExpiration = 'La date d\'expiration doit suivre la date d\'effet d\'au moins un jour.';
    }
    if (n === 3) {
      if (!offre) e.offre = 'Aucune offre pour cette formule et cette destination.';
      if (Number(reduction) < 0 || Number(reduction) > REDUCTION_MAX) e.reduction = `Réduction comprise entre 0 et ${REDUCTION_MAX} %.`;
      if (calculEnCours) e.prime = 'Calcul de la prime en cours…';
      else if (calcul?.erreur) e.prime = `Prime non calculée : ${calcul.erreur}`;
      else if (!montants || montants.primeNette <= 0) e.prime = 'Aucune prime dans la grille pour ces paramètres (âge, durée ou zone hors tarif).';
    }
    return e;
  };
  const erreurs = useMemo(() => ({
    ...(tentative[1] ? erreursEtape(1) : {}),
    ...(tentative[2] ? erreursEtape(2) : {}),
    ...(tentative[3] ? erreursEtape(3) : {}),
  }), [tentative, souscripteur, assureDifferent, assureChoisi, compagnie, categorie, paysDestination, paysZone, nationalite, dateNaissance, dateEffet, dateExpiration, duree, offre, reduction, calcul, calculEnCours, montants]); // eslint-disable-line react-hooks/exhaustive-deps

  const allerA = (cible) => {
    if (cible <= step) { setStep(cible); return; }
    for (let n = step; n < cible; n += 1) {
      const e = erreursEtape(n);
      if (Object.keys(e).length) {
        setTentative((t) => ({ ...t, [n]: true }));
        setStep(n);
        toastError(Object.values(e)[0]);
        return;
      }
    }
    setStep(cible);
  };

  // Date de naissance proposée depuis la fiche de l'assuré (modifiable)
  const choisirAssure = (personne, estSouscripteur) => {
    if (estSouscripteur) setSouscripteur(personne); else setAssureChoisi(personne);
    const concerneAssure = estSouscripteur ? !assureDifferent : true;
    if (personne?.DateNaissance && concerneAssure) setDateNaissance(personne.DateNaissance);
  };

  // ---------------------------------------------------------------- enregistrement
  const enregistrer = async () => {
    for (const n of [1, 2, 3]) {
      const e = erreursEtape(n);
      if (Object.keys(e).length) {
        setTentative((t) => ({ ...t, [n]: true }));
        setStep(n);
        toastError(Object.values(e)[0]);
        return;
      }
    }
    setEnregistrement(true);
    try {
      const res = await voyageApi.enregistrer({
        IdIntermediaire: 1,
        IdCompagnie: Number(compagnie),
        NumeroPoliceCompagnie: numeroPoliceCompagnie.trim(),
        IdProduit: ID_PRODUIT_VOYAGE,
        IdOffre: Number(offre),
        IdAvenant: idAvenant,
        IdClient: Number(souscripteur.IdClient),
        IdAssure: Number(assure.IdClient),
        Flotte: false,
        Coassurance: false,
        DateEffet: dateEffet,
        DateExpiration: dateExpiration,
        DateEmission: dateEmission,
        IdTarif: Number(categorie),
        IdZoneVoyage: idZone,
        TauxReduction: Number(reduction) || 0,
        DateNaissance: dateNaissance,
        IdPaysDestination: Number(paysDestination),
        IdPaysVoyageur: Number(nationalite),
        ReferenceContrat: referenceContrat.trim(),
        NumeroAttestation: numeroAttestation.trim(),
        Schengen: schengen,
        NumeroPasseport: numeroPassport.trim(),
        IdDevis: idDevisEdite || 0,
        IdTerme: idTermeValide(termeId),
      });
      const id = Number(res?.ObjectId) || 0;
      if (!id) {
        toastError(`Devis Voyage non enregistré : ${res?.OutputMessage || 'réponse du serveur sans numéro de devis.'}`);
        return;
      }
      success(idDevisEdite
        ? `Devis Voyage N° ${res.NumeroDevis || id} modifié.`
        : `Devis Voyage N° ${res.NumeroDevis || id} enregistré.`);
      setIdDevisEdite(id);
      setNumeroDevisEdite(res.NumeroDevis || '');
      let devis = null;
      try {
        devis = await quoteApi.getQuote(id);
      } catch {
        // l'aperçu se contente des montants renvoyés par l'enregistrement
      }
      setDevisEnregistre(devis || {
        id, iddevis: id, numerodevis: res.NumeroDevis, branche: 'Voyage', produit: 'ASSURANCE VOYAGE',
        client_nom: souscripteur.Nom, nomassure: assure.Nom, compagnie: compagnies.find((c) => c.id === Number(compagnie))?.nom || '',
        prime_nette: res.PrimeNette, accessoires: res.Accessoire, taxes: res.Taxe, prime_totale: res.PrimeTtc,
        date_emission: dateEmission, date_effet: dateEffet, date_expiration: dateExpiration, raw: {},
      });
    } catch (err) {
      toastError(`Devis Voyage non enregistré : ${messageErreurApi(err)}`);
    } finally {
      setEnregistrement(false);
    }
  };

  const confirmerEnContrat = async (devis) => {
    try {
      await contractApi.createContractFromQuote(devis.iddevis || devis.id);
      success(`Devis ${devis.numerodevis} confirmé : le contrat a été créé.`);
      setDevisEnregistre(null);
      navigate('/user/contracts');
    } catch (err) {
      toastError(`Le devis n'a pas pu être confirmé : ${messageErreurApi(err)}`);
    }
  };

  // ---------------------------------------------------------------- affichage
  const nomCompagnie = compagnies.find((c) => c.id === Number(compagnie))?.nom || '';
  const libelleFormule = tarifs.find((t) => Number(t.IdTarif) === Number(categorie))?.LibelleTarif || '';
  const libelleOffre = offres.find((o) => o.IdOffre === Number(offre))?.LibelleOffre || '';
  const libelleNationalite = (p) => p.nationalite && /[a-zà-ÿ]/i.test(p.nationalite) ? p.nationalite : `— (${p.libelle_pays})`;
  const nationalitesTriees = useMemo(() => {
    const comptes = {};
    nationalites.forEach((p) => { comptes[p.nationalite] = (comptes[p.nationalite] || 0) + 1; });
    return trierParLibelle(
      nationalites.map((p) => ({ ...p, libelle: comptes[p.nationalite] > 1 && /[a-zà-ÿ]/i.test(p.nationalite || '') ? `${p.nationalite} (${p.libelle_pays})` : libelleNationalite(p) })),
      (p) => p.libelle,
    );
  }, [nationalites]); // eslint-disable-line react-hooks/exhaustive-deps

  if (chargementEdition) {
    return (
      <div className="glass-panel" style={{ ...styles.carte, maxWidth: 640, margin: '3rem auto', textAlign: 'center' }}>
        <Loader2 size={28} className="spin" style={{ color: 'var(--primary-500)' }} />
        <p style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>Chargement du devis Voyage…</p>
      </div>
    );
  }

  const ligneRecap = (libelle, valeur, fort) => (
    <div style={styles.ligneRecap}>
      <span style={{ color: 'var(--text-muted)' }}>{libelle}</span>
      <span style={{ textAlign: 'right', fontWeight: fort ? 800 : 600, color: 'var(--text-primary)' }}>{valeur || '—'}</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1280px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* EN-TÊTE */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <button type="button" className="btn btn-link" onClick={() => navigate('/user/quotes')} style={{ padding: 0, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            <ChevronLeft size={16} /> Registre des devis
          </button>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: 0 }}>
            <Plane size={26} style={{ color: 'var(--primary-500)' }} />
            {idDevisEdite ? 'Modification du devis Voyage' : 'Nouveau devis Assurance Voyage'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.3rem 0 0' }}>
            {idDevisEdite
              ? <>Devis <strong>N° {numeroDevisEdite}</strong> — les primes sont recalculées selon la grille à l'enregistrement.</>
              : 'Un voyageur par devis. La prime est lue dans la grille de la compagnie selon la zone de destination, la durée et l\'âge.'}
          </p>
        </div>
      </div>

      {/* ÉTAPES */}
      <nav aria-label="Étapes du devis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: '0.5rem' }}>
        {ETAPES.map(({ num, libelle, icone: Icone }) => {
          const actif = step === num;
          const fait = step > num;
          return (
            <button
              key={num}
              type="button"
              onClick={() => allerA(num)}
              aria-current={actif ? 'step' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.9rem', borderRadius: '12px', cursor: 'pointer', textAlign: 'left',
                border: `1px solid ${actif ? 'var(--primary-500)' : 'var(--border-subtle)'}`,
                background: actif ? 'var(--primary-glow)' : 'var(--bg-surface)',
                color: actif ? 'var(--primary-500)' : 'var(--text-secondary)',
              }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: fait ? 'var(--accent-emerald)' : actif ? 'var(--primary-500)' : 'var(--bg-surface-elevated)',
                color: fait || actif ? '#fff' : 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 800,
              }}>
                {fait ? <CheckCircle2 size={16} /> : num}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Étape {num}</span>
                <span style={{ fontSize: '0.86rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Icone size={14} /> {libelle}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {avertissementReprise && (
        <div style={styles.alerte('var(--accent-amber)')}>
          <AlertTriangle size={18} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />
          <span>{avertissementReprise}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* CONTENU DE L'ÉTAPE */}
        <div className="glass-panel" style={{ ...styles.carte, flex: '1 1 620px', minWidth: 0 }}>
          {step === 1 && (
            <>
              <h2 style={styles.titreCarte}><Users size={18} style={{ color: 'var(--primary-500)' }} /> Souscripteur & assuré</h2>
              <div style={styles.grille}>
                <RechercheClient
                  label="Souscripteur (client)"
                  personne={souscripteur}
                  onChoisir={(p) => choisirAssure(p, true)}
                  onNouveau={() => setNouveauClientPour('souscripteur')}
                  erreur={erreurs.souscripteur}
                />
              </div>
              {souscripteur && <div style={{ marginTop: '0.75rem' }}><FichePersonne personne={souscripteur} /></div>}

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '1.25rem', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={assureDifferent} onChange={(e) => setAssureDifferent(e.target.checked)} style={{ width: 17, height: 17, accentColor: 'var(--primary-500)' }} />
                L'assuré (voyageur) est une autre personne que le souscripteur
              </label>

              {assureDifferent && (
                <>
                  <div style={{ ...styles.grille, marginTop: '1rem' }}>
                    <RechercheClient
                      label="Assuré (voyageur)"
                      personne={assureChoisi}
                      onChoisir={(p) => choisirAssure(p, false)}
                      onNouveau={() => setNouveauClientPour('assure')}
                      erreur={erreurs.assure}
                    />
                  </div>
                  {assureChoisi && <div style={{ marginTop: '0.75rem' }}><FichePersonne personne={assureChoisi} /></div>}
                </>
              )}
              <p style={styles.aide}>Téléphone et adresses sont ceux de la fiche client (modifiables depuis la Clientèle).</p>
            </>
          )}

          {step === 2 && (
            <>
              <h2 style={styles.titreCarte}><Globe size={18} style={{ color: 'var(--primary-500)' }} /> Contrat & voyage</h2>
              <div style={styles.grille}>
                <Champ label="Compagnie d'assurance" requis erreur={erreurs.compagnie}>
                  <select className="form-control" value={compagnie} onChange={(e) => setCompagnie(Number(e.target.value))}>
                    {!compagnies.some((c) => c.id === Number(compagnie)) && <option value={compagnie}>Compagnie n° {compagnie}</option>}
                    {trierParLibelle(compagnies, (c) => c.nom).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </Champ>
                <Champ label="Formule" requis erreur={erreurs.categorie}>
                  <select className="form-control" value={categorie} onChange={(e) => setCategorie(Number(e.target.value))} disabled={!tarifs.length}>
                    {!tarifs.length && <option value={0}>{chargementListes ? 'Chargement…' : 'Aucune formule'}</option>}
                    {tarifs.map((t) => <option key={t.IdTarif} value={t.IdTarif}>{t.LibelleTarif}</option>)}
                  </select>
                </Champ>
                <Champ label="Numéro de police compagnie" aide="Facultatif">
                  <input type="text" className="form-control" value={numeroPoliceCompagnie} maxLength={60} onChange={(e) => setNumeroPoliceCompagnie(e.target.value)} />
                </Champ>
              </div>

              <div style={styles.sousTitre}>Destination & voyageur</div>
              <div style={styles.grille}>
                <Champ label="Pays de destination" requis erreur={erreurs.paysDestination} aide={libelleZone ? undefined : 'La zone tarifaire dépend du pays choisi'}>
                  <select className="form-control" value={paysDestination} onChange={(e) => setPaysDestination(Number(e.target.value))} disabled={!paysZone.length}>
                    <option value={0}>{paysZone.length ? '— Choisir —' : (chargementListes ? 'Chargement…' : 'Aucun pays paramétré')}</option>
                    {paysZone.map((p) => <option key={p.id_pays} value={p.id_pays}>{p.libelle_pays}</option>)}
                  </select>
                  {libelleZone && <div style={{ marginTop: '0.4rem' }}><span style={styles.pastille}><MapPin size={12} /> {libelleZone}</span></div>}
                </Champ>
                <Champ label="Nationalité" requis erreur={erreurs.nationalite}>
                  <select className="form-control" value={nationalite} onChange={(e) => setNationalite(Number(e.target.value))}>
                    <option value={0}>— Choisir —</option>
                    {nationalitesTriees.map((p) => <option key={p.id_pays} value={p.id_pays}>{p.libelle}</option>)}
                  </select>
                </Champ>
                <Champ label="Date de naissance du voyageur" requis erreur={erreurs.dateNaissance}
                  aide={age !== null ? `${age} ans à ce jour (âge retenu par le tarif)` : 'Reprise de la fiche de l\'assuré si elle est renseignée'}>
                  <input type="date" className="form-control" max={aujourdhui()} value={dateNaissance} onChange={(e) => setDateNaissance(e.target.value)} />
                  {assure?.DateNaissance && dateNaissance && assure.DateNaissance !== dateNaissance && (
                    <div style={{ ...styles.aide, color: 'var(--accent-amber)', display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                      <AlertTriangle size={13} /> Fiche de l'assuré : {dateFr(assure.DateNaissance)}
                      <button type="button" className="btn btn-link" style={{ padding: 0, fontSize: '0.75rem', fontWeight: 700 }} onClick={() => setDateNaissance(assure.DateNaissance)}>
                        Reprendre cette date
                      </button>
                    </div>
                  )}
                </Champ>
                <Champ label="Numéro de passeport">
                  <input type="text" className="form-control" maxLength={30} value={numeroPassport} onChange={(e) => setNumeroPassport(e.target.value.toUpperCase())} />
                </Champ>
                <Champ label="Schengen">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', minHeight: '2.4rem' }}>
                    <input type="checkbox" checked={schengen} onChange={(e) => setSchengen(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--primary-500)' }} />
                    <span style={{ fontSize: '0.88rem', fontWeight: 600, color: schengen ? 'var(--primary-500)' : 'var(--text-secondary)' }}>{schengen ? 'Oui' : 'Non'}</span>
                  </label>
                </Champ>
              </div>

              <div style={styles.sousTitre}>Période du voyage</div>
              <div style={styles.grille}>
                <Champ label="Date d'émission" aide="Date du jour">
                  <input type="date" className="form-control" value={dateEmission} readOnly disabled />
                </Champ>
                <Champ label="Date d'effet" requis erreur={erreurs.dateEffet}>
                  <input type="date" className="form-control" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} />
                </Champ>
                <Champ label="Date d'expiration" requis erreur={erreurs.dateExpiration}>
                  <input type="date" className="form-control" min={dateEffet || undefined} value={dateExpiration} onChange={(e) => setDateExpiration(e.target.value)} />
                </Champ>
                <Champ label="Durée">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '2.4rem', fontWeight: 800, fontSize: '1.05rem', color: duree !== null && duree < 1 ? 'var(--accent-rose)' : 'var(--text-primary)' }}>
                    <CalendarDays size={18} style={{ color: 'var(--primary-500)' }} />
                    {duree === null ? '—' : `${duree} jour${Math.abs(duree) > 1 ? 's' : ''}`}
                  </div>
                </Champ>
                <Champ label="Terme du contrat">
                  <TermeContratSelect value={termeId} onChange={setTermeId} />
                </Champ>
              </div>

              <div style={styles.sousTitre}>Références</div>
              <div style={styles.grille}>
                <Champ label="Référence contrat">
                  <input type="text" className="form-control" maxLength={50} value={referenceContrat} onChange={(e) => setReferenceContrat(e.target.value)} />
                </Champ>
                <Champ label="Numéro attestation">
                  <input type="text" className="form-control" maxLength={30} value={numeroAttestation} onChange={(e) => setNumeroAttestation(e.target.value)} />
                </Champ>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 style={styles.titreCarte}><ShieldCheck size={18} style={{ color: 'var(--primary-500)' }} /> Offre, garanties & prime</h2>
              <div style={styles.grille}>
                <Champ label="Offre" requis erreur={erreurs.offre}>
                  <select className="form-control" value={offre} onChange={(e) => setOffre(Number(e.target.value))} disabled={!offres.length} style={{ fontWeight: 700 }}>
                    {!offres.length && <option value={0}>Aucune offre</option>}
                    {offres.map((o) => <option key={o.IdOffre} value={o.IdOffre}>{o.LibelleOffre}</option>)}
                  </select>
                </Champ>
                <Champ label="Réduction (%)" requis erreur={erreurs.reduction} aide={`De 0 à ${REDUCTION_MAX} %`}>
                  <input type="number" className="form-control" min={0} max={REDUCTION_MAX} step="0.01" value={reduction}
                    onChange={(e) => setReduction(Math.max(0, Math.min(REDUCTION_MAX, Number(e.target.value) || 0)))} />
                </Champ>
              </div>

              <div style={styles.sousTitre}>Garanties de l'offre</div>
              {!calcul && !calculEnCours && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Renseignez la destination, la date de naissance et les dates du voyage pour afficher les garanties.</p>
              )}
              {calculEnCours && !calcul?.lignes && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', gap: '0.4rem', alignItems: 'center' }}><Loader2 size={15} className="spin" /> Calcul de la prime…</p>
              )}
              {calcul?.lignes && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '0.5rem' }}>
                  {calcul.lignes.map((g) => (
                    <div key={g.IdSousGarantie} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-elevated)', fontSize: '0.83rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      <CheckCircle2 size={16} style={{ color: g.Acquise ? 'var(--accent-emerald)' : 'var(--text-muted)', flexShrink: 0 }} />
                      <span>{g.LibelleSousGarantie}</span>
                    </div>
                  ))}
                </div>
              )}
              {calcul?.lignes && (
                <p style={styles.aide}>Garanties acquises d'office. La prime est un forfait de la grille ; capitaux et franchises sont posés à l'enregistrement.</p>
              )}

              <div style={styles.sousTitre}>Décompte de la prime</div>
              {erreurs.prime && <div style={{ ...styles.alerte('var(--accent-rose)'), marginBottom: '0.75rem' }}><AlertTriangle size={18} style={{ color: 'var(--accent-rose)', flexShrink: 0 }} /><span>{erreurs.prime}</span></div>}
              {!erreurs.prime && calcul?.erreur && <div style={{ ...styles.alerte('var(--accent-rose)'), marginBottom: '0.75rem' }}><AlertTriangle size={18} style={{ color: 'var(--accent-rose)', flexShrink: 0 }} /><span>Prime non calculée : {calcul.erreur}</span></div>}
              {!erreurs.prime && montants && montants.primeNette <= 0 && (
                <div style={{ ...styles.alerte('var(--accent-amber)'), marginBottom: '0.75rem' }}>
                  <AlertTriangle size={18} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />
                  <span>Aucune prime dans la grille pour ces paramètres (âge {age ?? '—'} ans, {duree ?? '—'} jours, {libelleZone || 'zone inconnue'}) : le devis ne pourra pas être enregistré.</span>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '0.6rem' }}>
                {[
                  ['Prime annuelle', montants?.primeAnnuelle],
                  ...(montants?.reduction > 0 ? [[`Réduction ${reduction} %`, -montants.reduction]] : []),
                  ['Prime nette', montants?.primeNette],
                  ['Accessoire', montants?.accessoire],
                  ['Taxe', montants?.taxe],
                ].map(([libelle, valeur]) => (
                  <div key={libelle} style={{ padding: '0.75rem 0.9rem', borderRadius: '10px', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-elevated)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>{libelle}</div>
                    <div style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.2rem' }}>{montants ? `${fcfa(valeur)} F` : '—'}</div>
                  </div>
                ))}
                <div style={{ padding: '0.75rem 0.9rem', borderRadius: '10px', border: '1px solid var(--primary-500)', background: 'var(--primary-glow)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--primary-500)', textTransform: 'uppercase', fontWeight: 800 }}>Prime TTC</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)', marginTop: '0.2rem' }}>{montants ? `${fcfa(montants.primeTtc)} F` : '—'}</div>
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h2 style={styles.titreCarte}><FileCheck size={18} style={{ color: 'var(--primary-500)' }} /> Récapitulatif avant enregistrement</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '1rem 2rem' }}>
                <div>
                  <div style={styles.sousTitre}>Souscripteur & assuré</div>
                  {ligneRecap('Souscripteur', souscripteur?.Nom)}
                  {ligneRecap('Assuré', assure?.Nom)}
                  {ligneRecap('Né(e) le', dateNaissance ? `${dateFr(dateNaissance)} (${age} ans)` : '')}
                  {ligneRecap('Nationalité', nationalites.find((p) => Number(p.id_pays) === Number(nationalite))?.nationalite)}
                  {ligneRecap('Passeport', numeroPassport)}
                  <div style={styles.sousTitre}>Contrat</div>
                  {ligneRecap('Compagnie', nomCompagnie)}
                  {ligneRecap('Formule', libelleFormule)}
                  {ligneRecap('N° police compagnie', numeroPoliceCompagnie)}
                  {ligneRecap('Référence contrat', referenceContrat)}
                  {ligneRecap('N° attestation', numeroAttestation)}
                </div>
                <div>
                  <div style={styles.sousTitre}>Voyage</div>
                  {ligneRecap('Destination', destination?.libelle_pays)}
                  {ligneRecap('Zone', libelleZone)}
                  {ligneRecap('Schengen', schengen ? 'Oui' : 'Non')}
                  {ligneRecap('Période', dateExpiration ? `du ${dateFr(dateEffet)} au ${dateFr(dateExpiration)}` : '')}
                  {ligneRecap('Durée', duree !== null ? `${duree} jours` : '')}
                  <div style={styles.sousTitre}>Prime</div>
                  {ligneRecap('Offre', libelleOffre)}
                  {ligneRecap('Prime nette', montants ? `${fcfa(montants.primeNette)} F` : '')}
                  {ligneRecap('Accessoire', montants ? `${fcfa(montants.accessoire)} F` : '')}
                  {ligneRecap('Taxe', montants ? `${fcfa(montants.taxe)} F` : '')}
                  {ligneRecap('Prime TTC', montants ? `${fcfa(montants.primeTtc)} F` : '', true)}
                </div>
              </div>
            </>
          )}

          {/* NAVIGATION */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '1.75rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={() => (step > 1 ? setStep(step - 1) : navigate('/user/quotes'))} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <ChevronLeft size={16} /> {step > 1 ? 'Précédent' : 'Annuler'}
            </button>
            {step < 4 ? (
              <button type="button" className="btn btn-primary" onClick={() => allerA(step + 1)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                Suivant <ChevronRight size={16} />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={enregistrement} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 800 }}>
                {enregistrement ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                {idDevisEdite ? 'Enregistrer les modifications' : 'Enregistrer le devis'}
              </button>
            )}
          </div>
        </div>

        {/* RÉSUMÉ PERMANENT */}
        <aside className="glass-panel" style={{ ...styles.carte, flex: '1 1 280px', maxWidth: '100%', position: 'sticky', top: '1rem' }}>
          <h2 style={{ ...styles.titreCarte, marginBottom: '0.75rem', fontSize: '0.9rem' }}><Plane size={16} style={{ color: 'var(--primary-500)' }} /> Votre devis</h2>
          {ligneRecap('Assuré', assure?.Nom)}
          {ligneRecap('Compagnie', nomCompagnie)}
          {ligneRecap('Destination', destination ? `${destination.libelle_pays}` : '')}
          {ligneRecap('Zone', libelleZone)}
          {ligneRecap('Durée', duree !== null && duree > 0 ? `${duree} jours` : '')}
          {ligneRecap('Âge', age !== null ? `${age} ans` : '')}
          {ligneRecap('Offre', libelleOffre)}
          <div style={{ marginTop: '1rem', padding: '0.9rem', borderRadius: '12px', background: 'var(--primary-glow)', border: '1px solid var(--primary-500)' }}>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--primary-500)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              Prime TTC {calculEnCours && <Loader2 size={12} className="spin" />}
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--text-primary)' }}>{montants && montants.primeNette > 0 ? `${fcfa(montants.primeTtc)} F` : '—'}</div>
            {montants && montants.primeNette > 0 && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                dont prime nette {fcfa(montants.primeNette)} F
              </div>
            )}
          </div>
        </aside>
      </div>

      <QuickAddClientModal
        isOpen={Boolean(nouveauClientPour)}
        onClose={() => setNouveauClientPour(null)}
        onClientCreated={(client) => {
          const personne = personneDepuisClient(client);
          if (personne?.IdClient) choisirAssure(personne, nouveauClientPour === 'souscripteur');
          setNouveauClientPour(null);
        }}
      />

      {devisEnregistre && (
        <ViewQuoteModal
          quote={devisEnregistre}
          isOpen={Boolean(devisEnregistre)}
          onClose={() => setDevisEnregistre(null)}
          onConvertToContract={confirmerEnContrat}
        />
      )}
    </div>
  );
};

export default NewVoyageQuotePage;
