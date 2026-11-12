import React, { useState, useEffect } from 'react';
import BlocOreole from './BlocOreole';
import BlocApporteursAffaire from '../../../components/apporteurs/BlocApporteursAffaire';
import { imprimerOreole } from '../../../utils/impressionsOreole';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { cashApi, contractApi, asaciApi, transportApi, transportHorsGuceApi, repriseApi, impressionSanteApi } from '../../../api/endpoints';
import { dataStore } from '../../../api/dataStore';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { PolicyMovementModal } from './PolicyMovementModal';
import { ListeDocumentsContrat, useDocumentsContrat } from './documentsContrat';
import {
  ArrowLeft,
  Shield,
  FileText,
  Printer,
  Car,
  CreditCard,
  RefreshCw,
  CheckCircle,
  Download,
  Layers,
  Calendar,
  MapPin,
  User,
  Building2,
  Banknote,
  Ship,
  Eye,
  Users,
  Trash2,
  UserPlus,
  Home,
} from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import { formatDate } from '../../../utils/dateUtils';
import { printBordereauTransport, printRecuEncaissement, estDevisTransport } from '../../../utils/exportUtils';
import { estDevisSante } from '../../../utils/impressionsSante';
import { AvenantSanteModal } from './AvenantSanteModal';
import { SuppressionModal } from '../../../components/common/SuppressionModal';
import { aLeDroit } from '../../../utils/droits';
import { CertificatsTransportModal } from '../quotes/NewTransportQuotePage';
import { resteAEncaisser } from '../../../utils/resteEncaissement';

// Date ISO reçue de l'API -> jj/mm/aaaa ; autre texte inchangé
const dateLisible = (v) => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : v; };

export const ContractDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { success, error: toastError, warning } = useToast();
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [movementTab, setMovementTab] = useState('renouvellement');
  const [initialOp, setInitialOp] = useState(null);

  const [currentContract, setCurrentContract] = useState(null);
  const [attestationsList, setAttestationsList] = useState([]);
  // Affaire antérieure reprise (Production > Affaires antérieures) : risque et paiement tels que saisis à la reprise
  const [reprise, setReprise] = useState(null);
  const estReprise = String(currentContract?.raw?.observation || '').startsWith('Reprise affaire antérieure');
  useEffect(() => {
    let actif = true;
    setReprise(null);
    if (estReprise) repriseApi.duContrat(id).then((r) => { if (actif) setReprise(r); }).catch(() => {});
    return () => { actif = false; };
  }, [id, estReprise]);

  useEffect(() => {
    let isMounted = true;
    if (id) {
      contractApi.getContractDetail(id).then((bc) => {
        if (isMounted && bc) setCurrentContract(bc);
      }).catch((err) => {
        console.warn('Chargement contrat impossible:', err?.message || err);
        if (isMounted) toastError('Impossible de charger ce contrat : le serveur ou la base de données ne répond pas.');
      });

      asaciApi.getAttestations().then((atts) => {
        if (isMounted && Array.isArray(atts)) setAttestationsList(atts);
      }).catch(() => {});
    }
    return () => { isMounted = false; };
  }, [id]);

  const contract = currentContract || {};

  // Documents imprimables selon la branche (partagés avec les Affaires antérieures) ; MINENE SANTÉ : IA et RC
  // rattachées à la police Santé de ce contrat
  const { documents, fenetres: fenetresDocuments, mineneConnexes, ouvrirReleve } = useDocumentsContrat(currentContract, id, {
    onSaveContract: (updated) => {
      setCurrentContract(updated);
      dataStore.saveContract(updated);
    },
  });
  // Contrat Transport : certificats GUCE du bordereau dont il est issu (une ligne de contrat par certificat)
  const contratTransport = estDevisTransport(contract);
  // Contrat Santé : avenant de changement de formule, réduction ou majoration MINENE
  const contratSante = estDevisSante(contract);
  // Santé MINENE : réduction ou majoration de l'année (clause d'ajustement S/P), recalculée famille par famille comme
  // sur le bordereau des primes ; rien si le contrat a été émis avec un autre calcul (écart)
  const idDevisContrat = Number(contract.raw?.iddevis?.iddevis ?? contract.raw?.iddevis) || 0;
  const [avenantSanteOuvert, setAvenantSanteOuvert] = useState(false);
  // Quittance : le vrai reçu du dernier règlement enregistré à la caisse. Sans règlement, rien à quittancer (CIMA, article 13).
  const imprimerQuittance = async () => {
    const numero = contract?.raw?.idquittance?.numeroquittance;
    try {
      const reglement = numero ? await cashApi.getDernierReglementQuittance(numero) : null;
      if (!reglement?.iddetailencaissement) {
        warning("Aucun règlement enregistré sur cette quittance : le reçu sera disponible après l'encaissement.");
        return;
      }
      await printRecuEncaissement(reglement.iddetailencaissement);
    } catch (err) {
      toastError('Le reçu de cette quittance est indisponible pour le moment. Veuillez réessayer.');
    }
  };

  // Oreole Santé : renouvellement et incorporation depuis le bloc de la branche, pour garder les trois polices ensemble
  const [contratOreole, setContratOreole] = useState(false);
  const [devisOreole, setDevisOreole] = useState(0);
  const [suppressionOuverte, setSuppressionOuverte] = useState(false);
  // IA : incorporation proposée quand le contrat porte plusieurs personnes ; Vie AFA : toujours, hors package Oreole Santé ;
  // MRH : une maison s'ajoute à tout contrat en cours (le serveur en décide)
  const idProduitContrat = Number(contract?.raw?.idproduit?.id_produit ?? contract?.raw?.idproduit?.IdProduit ?? contract?.raw?.idproduit) || 0;
  const [incorporationIa, setIncorporationIa] = useState(false);
  useEffect(() => {
    let actif = true;
    setIncorporationIa(false);
    if (id && [2, 4, 10].includes(idProduitContrat) && aLeDroit('contrats.avenant')) {
      contractApi.preparerIncorporation(id).then(() => { if (actif) setIncorporationIa(true); }).catch(() => {});
    }
    return () => { actif = false; };
  }, [id, idProduitContrat]);
  const [ajustementSante, setAjustementSante] = useState(null);
  useEffect(() => {
    let actif = true;
    setAjustementSante(null);
    if (contratSante && idDevisContrat) {
      impressionSanteApi.bordereau(idDevisContrat)
        .then((b) => {
          if (actif && b?.Minene && Number(b.Recap?.Ajustement) && !Number(b.Recap?.Ecart)) {
            setAjustementSante({ taux: Number(b.TauxAjustement) || 0, montant: Number(b.Recap.Ajustement), avant: Number(b.Recap.PrimeNetteAvantAjustement) });
          }
        })
        .catch(() => {});
    }
    return () => { actif = false; };
  }, [contratSante, idDevisContrat]);
  // Arrivée depuis la confirmation d'un devis Dommages : le relevé est proposé aussitôt
  useEffect(() => {
    if (location.state?.releve && contract.idcontrat) {
      ouvrirReleve();
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, contract.idcontrat]);
  const [bordereauTransport, setBordereauTransport] = useState(null);
  const [certificatsOuverts, setCertificatsOuverts] = useState(false);
  // Transport : affaire hors GUCE (police au voyage, annuelle, d'abonnement ou ressortie), sinon certificats GUCE
  const [horsGuce, setHorsGuce] = useState(null);
  useEffect(() => {
    let actif = true;
    setBordereauTransport(null);
    setHorsGuce(null);
    if (id && contratTransport) {
      transportHorsGuceApi.getContrat(id)
        .then((h) => {
          if (!actif) return;
          if (h?.HorsGuce) { setHorsGuce(h); return; }
          setHorsGuce({ HorsGuce: false });
          transportApi.getCertificats({ idcontrat: id })
            .then((d) => { if (actif) setBordereauTransport(d); })
            .catch(() => { if (actif) setBordereauTransport({ erreur: true }); });
        })
        .catch(() => { if (actif) setHorsGuce({ HorsGuce: false }); });
    }
    return () => { actif = false; };
  }, [id, contratTransport]);
  const [endorsements, setEndorsements] = useState(() =>
    dataStore.getEndorsementsByPolicy(contract.numeropolice || contract.id)
  );

  useEffect(() => {
    const unsub = dataStore.subscribe(() => {
      setEndorsements(dataStore.getEndorsementsByPolicy(contract.numeropolice || contract.id));
    });
    return unsub;
  }, [contract.numeropolice, contract.id]);

  const attestation = attestationsList.find((a) => a.police === contract.numeropolice || a.numeropolice === contract.numeropolice);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Fiche ouverte depuis les Affaires antérieures : retour à cette liste */}
          <button className="btn btn-secondary" onClick={() => navigate(location.state?.retour || '/user/contracts')} style={{ padding: '0.4rem 0.8rem' }}>
            <ArrowLeft size={16} /> Retour
          </button>
          <div>
            <h1 className="title-xl">{contract.numeropolice}</h1>
            <span style={{ fontSize: '0.8rem', color: '#34d399' }}>Police en vigueur • {contract.compagnie}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Action Renouveler (Mise en avant) */}
          {!contratOreole && <button
            className="btn"
            style={{
              padding: '0.45rem 0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'linear-gradient(135deg, #059669, #10b981)',
              color: '#fff',
              border: 'none',
              fontWeight: 600,
              boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)',
              cursor: 'pointer',
            }}
            onClick={() => navigate(`/user/contracts/${id}/renouvellement`)}
            title="Préparer le renouvellement : nouvelle période, liste à jour (incorporations, retraits), valeurs vénales selon l'âge ; même numéro de police"
          >
            <RefreshCw size={16} />
            <span>Renouveler la Police</span>
          </button>}

          {contract.branche === 'Auto' && contract.raw?.flotte && aLeDroit('contrats.avenant') && (
            <button
              className="btn btn-secondary"
              onClick={() => navigate(`/user/contracts/${id}/incorporation`)}
              title="Ajouter un véhicule à la flotte jusqu'à l'échéance initiale de la police"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Car size={16} />
              <span>Incorporer un véhicule</span>
            </button>
          )}

          {incorporationIa && !contratOreole && (
            <button
              className="btn btn-secondary"
              onClick={() => navigate(`/user/contracts/${id}/incorporation`)}
              title={idProduitContrat === 4 ? "Ajouter une maison à ce contrat jusqu'à son échéance" : "Ajouter une personne à ce contrat jusqu'à son échéance"}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              {idProduitContrat === 4 ? <Home size={16} /> : <UserPlus size={16} />}
              <span>{idProduitContrat === 4 ? 'Incorporer une maison' : 'Incorporer une personne'}</span>
            </button>
          )}

          {/* Avenant et transformation retirés le 2026-10-14 : ils n'enregistraient rien en base
              (PolicyMovementModal → dataStore du navigateur) tout en annonçant une réussite ; les procédures
              d'avenant de modification n'existent pas encore (sp_avenant_modification) */}
          {/* Santé : avenant de modification réel (changement de formule, incorporation), sante/avenant.py */}
          {contratSante && !contratOreole && aLeDroit('contrats.avenant') && (
            <button className="btn btn-secondary" onClick={() => setAvenantSanteOuvert(true)}
              title="Incorporer un membre dans une famille (une famille complète passe d'office dans la formule de sa taille, FAMILLE → FAMILLE PLUS) ou changer de formule en cours de contrat : avenant sous la même police, prime = écart entre les formules (en entier pour MINENE, tarif forfaitaire)"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Users size={16} />
              <span>Incorporer un membre</span>
            </button>
          )}

          {/* Action Imprimer Quittance */}
          <button className="btn btn-secondary" onClick={() => (devisOreole ? imprimerOreole('quittance', devisOreole) : imprimerQuittance())} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Printer size={16} />
            <span>Quittance CIMA</span>
          </button>

          {/* Suppression définitive, par habilitation : les règles et le motif sont dans la fenêtre */}
          {aLeDroit('contrats.delete') && (
            <button className="btn btn-danger" onClick={() => setSuppressionOuverte(true)} title="Supprimer définitivement ce contrat"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Trash2 size={16} />
              <span>Supprimer</span>
            </button>
          )}
        </div>
      </div>

      {id && <BlocOreole idContrat={id} onDetection={(oui, idDevis) => { setContratOreole(oui); setDevisOreole(oui ? idDevis : 0); }} />}

      {id && <BlocApporteursAffaire idContrat={Number(id)} />}

      {reprise && (
        <div className="glass-panel" style={{ padding: '1.1rem 1.25rem', borderLeft: '4px solid var(--accent-amber)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
            <h3 className="title-md" style={{ margin: 0 }}>Affaire antérieure reprise : {reprise.Etape.toLowerCase()}</h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {({ import: 'Import Excel', devis: 'Écrans de devis' })[reprise.Mode] || "Saisie à l'écran"} du {formatDate(reprise.DateCreation)} par {reprise.CreePar}, quittance {reprise.NumeroQuittance}{reprise.NumeroPoliceCompagnie ? `, police compagnie ${reprise.NumeroPoliceCompagnie}` : ''}
            </span>
          </div>
          {reprise.Champs.length || reprise.Precisions ? (
            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem 1.25rem', margin: '0.8rem 0 0' }}>
              {reprise.Champs.map((c) => (
                <div key={c.Libelle}><dt style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.Libelle}</dt><dd style={{ margin: 0, fontSize: '0.88rem' }}>{c.Valeur}</dd></div>
              ))}
              {reprise.Precisions && (
                <div style={{ gridColumn: '1 / -1' }}><dt style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Précisions</dt><dd style={{ margin: 0, fontSize: '0.88rem' }}>{reprise.Precisions}</dd></div>
              )}
            </dl>
          ) : <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: '0.6rem 0 0' }}>Risque non décrit à la reprise.</p>}
          {/* Affaire antérieure soldée (consigne du 2026-10-27) */}
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.7rem 0 0' }}>
            Quittance encaissée. Commission {Math.round(reprise.Commission).toLocaleString('fr-FR')} F, perçue.
            {reprise.Observation ? ` Observation : ${reprise.Observation}` : ''}
          </p>
        </div>
      )}

      {/* SECTION 1 : Informations Générales & Caractéristiques du Risque */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {/* Informations Générales */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 className="title-md" style={{ color: '#fff', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <User size={18} color="#60a5fa" />
            Informations Générales
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Nom et prénoms du client :</span>
              <strong style={{ color: '#fff' }}>{contract.client_nom}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Adresse :</span>
              <span style={{ color: '#e2e8f0' }}>{contract.adresse || 'Abidjan, Côte d\'Ivoire'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Intermédiaire :</span>
              <strong style={{ color: '#38bdf8' }}>{contract.intermediaire || 'OREOLE ASSURANCES'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Compagnie d'assurance :</span>
              <strong style={{ color: '#fff' }}>{contract.compagnie}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border-subtle)', paddingTop: '0.5rem' }}>
              <span className="text-muted">Date d'émission :</span>
              <span style={{ color: '#e2e8f0' }}>{dateLisible(contract.date_emission || contract.date_effet || '2026-01-01')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Date d'effet :</span>
              <strong style={{ color: '#34d399' }}>{formatDate(contract.date_effet)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Date d'expiration :</span>
              <strong style={{ color: '#60a5fa' }}>{formatDate(contract.date_expiration)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border-subtle)', paddingTop: '0.5rem' }}>
              <span className="text-muted">Dernière modification :</span>
              <span style={{ color: '#93c5fd', fontSize: '0.82rem', fontWeight: 600 }}>
                {dateLisible(contract.date_derniere_modification || contract.DateMaj || contract.date_maj || contract.date_emission || contract.date_effet || '-')}
              </span>
            </div>
          </div>
        </div>

        {/* Détails Techniques & Garanties */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 className="title-md" style={{ color: '#fff', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Shield size={18} color="#3b82f6" />
            Caractéristiques
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Branche de couverture :</span>
              <span style={{ fontWeight: 600, color: '#fff' }}>{contract.branche || 'Automobile'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Formule / Produit :</span>
              <span style={{ color: '#e2e8f0' }}>{contract.produit}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Immatriculation / Réf. Risque :</span>
              <strong style={{ color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>
                {contract.details?.immatriculation || contract.immatriculation || '-'}
              </strong>
            </div>
            {contract.details?.marque && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">Marque & Modèle :</span>
                <span>{contract.details.marque} {contract.details.modele}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed var(--border-subtle)', paddingTop: '0.5rem' }}>
              <span className="text-muted">Statut Contractuel CIMA :</span>
              <StatusBadge label={contract.statut_contrat || 'En cours'} color={contract.statut_contrat_badge || 'emerald'} />
            </div>
            {contract.devis_origine && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">Devis d'origine lié :</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>{contract.devis_origine}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 2 : Décompte Financier & Documents (Conformes exactement aux captures d'écran) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {/* Décompte Financier */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 className="title-md" style={{ color: '#fff', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Banknote size={18} color="#38bdf8" />
            Décompte financier
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.9rem' }}>
            {/* Montants enregistrés du contrat (prime nette + accessoire + taxe + FGA + frais de gestion = prime TTC) */}
            {[
              ['Prime nette avant ajustement', ajustementSante?.avant, Boolean(ajustementSante)],
              [`${ajustementSante?.montant < 0 ? 'Réduction' : 'Majoration'} ${Math.abs(ajustementSante?.taux || 0).toLocaleString('fr-FR')} %`,
                ajustementSante?.montant, Boolean(ajustementSante)],
              ['Prime nette', contract.prime_nette - contract.fga, true],
              ['Accessoire', contract.accessoire, true],
              ['Taxe', contract.taxe, true],
              ['FGA', contract.fga, contract.fga > 0],
              // Frais de gestion MINENE (IA, RC chef de famille : 1 500 F par adhérent), compris dans la prime TTC
              ['Frais de gestion', Number(contract.raw?.accessoiregestionnaire) || 0, Number(contract.raw?.accessoiregestionnaire) > 0],
            ].filter(([, , visible]) => visible).map(([libelle, montant]) => (
              <div key={libelle} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{libelle}</span>
                <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>
                  {Math.round(Number(montant) || 0).toLocaleString('fr-FR')} FCFA
                </strong>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', fontSize: '1.05rem' }}>
              <span style={{ fontWeight: 700, color: '#fff' }}>Prime TTC</span>
              <strong style={{ color: '#34d399', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                {Math.round(Number(contract.prime_totale) || 0).toLocaleString('fr-FR')} FCFA
              </strong>
            </div>
          </div>
        </div>

        {/* Documents */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 className="title-md" style={{ color: '#fff', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={18} color="#c084fc" />
            Documents
          </h3>
          {/* Selon la branche : Dommages (relevé de compte, cotation, pièces), Voyage (attestation seule), Santé (listes
              et barème), Automobile (attestation, carte brune) ; documentsContrat.jsx */}
          {/* Oreole Santé : une seule quittance et une seule facture pour le package, quelle que soit la police ouverte */}
          <ListeDocumentsContrat documents={devisOreole
            ? [
              ...[['quittance', 'Quittance du package'], ['facture', 'Facture du package'],
                ...(contratSante ? [['cp', 'Conditions particulières'], ['bareme', 'Barème de soins'], ['liste', 'Liste des adhérents'], ['cotisations', 'État des cotisations']] : [])]
                .map(([cle, libelle]) => ({ cle, libelle, action: 'Imprimer', ouvrir: () => imprimerOreole(cle, devisOreole), fenetre: false })),
              ...(contratSante ? [] : documents.filter((d) => d.cle !== 'facture')),
            ]
            : documents} />
        </div>
      </div>

      {/* Transport hors GUCE : police ou ressortie mensuelle d'une police d'abonnement */}
      {contratTransport && horsGuce?.HorsGuce && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 className="title-md" style={{ color: 'var(--text-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Ship size={18} color="#38bdf8" />
            {horsGuce.Nature === 'RESSORTIE' ? `Ressortie mensuelle de la police d'abonnement ${horsGuce.NumeroPolice}` : `Transport hors GUCE : ${horsGuce.LibelleTypePolice.toLowerCase()}`}
          </h3>
          {horsGuce.Nature === 'POLICE' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Marchandise</div><strong>{horsGuce.Marchandise}</strong><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{horsGuce.Conditionnement}</div></div>
              <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Trajet, {horsGuce.LibelleMode.toLowerCase()}</div><strong>{horsGuce.Depart} → {horsGuce.Arrivee}</strong><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{horsGuce.Chargement}</div></div>
              <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{horsGuce.TypePolice === 'ABONNEMENT' ? 'Plein par expédition' : 'Valeur assurée'}</div><strong>{Math.round(horsGuce.Valeur).toLocaleString('fr-FR')} FCFA</strong></div>
              <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Garanties</div><strong>{horsGuce.Garanties.map((g) => `${g.Libelle} ${String(g.Taux).replace('.', ',')} %`).join(' + ')}</strong>{horsGuce.Franchise && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Franchise : {horsGuce.Franchise}</div>}</div>
            </div>
          ) : (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {horsGuce.Voyages.length} voyage(s) déclaré(s) en {new Date(`${horsGuce.Mois}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} :
              {' '}{horsGuce.Voyages.map((v) => `n° ${v.Numero} (${v.LieuDepart} → ${v.LieuArrivee})`).join(', ')}.
            </div>
          )}
          {horsGuce.IdContratPolice && (
            <div style={{ marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => navigate(`/user/quotes/transport/abonnements?police=${horsGuce.IdContratPolice}`)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Eye size={15} /> Voyages et ressorties de la police
              </button>
            </div>
          )}
        </div>
      )}

      {/* Transport : bordereau GUCE d'origine */}
      {contratTransport && horsGuce && !horsGuce.HorsGuce && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 className="title-md" style={{ color: 'var(--text-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Ship size={18} color="#38bdf8" />
            Certificats GUCE du contrat
          </h3>
          {!bordereauTransport && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Chargement des certificats…</div>}
          {bordereauTransport && (bordereauTransport.erreur || !bordereauTransport.Certificats?.length) && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Aucun certificat GUCE rattaché à ce contrat (contrat importé ou saisi hors GUCE).</div>
          )}
          {bordereauTransport?.Certificats?.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', fontSize: '0.85rem' }}>
                <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Bordereau</div><strong>du {formatDate(bordereauTransport.DebutPeriode)} au {formatDate(bordereauTransport.FinPeriode)}</strong></div>
                <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Certificats</div><strong>{bordereauTransport.Totaux.Certificats}</strong></div>
                <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Valeur assurée</div><strong>{Math.round(bordereauTransport.Totaux.ValeurAssurance).toLocaleString('fr-FR')} FCFA</strong></div>
                <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total général</div><strong>{Math.round(bordereauTransport.Totaux.TotalGeneral).toLocaleString('fr-FR')} FCFA</strong></div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCertificatsOuverts(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Eye size={15} /> Voir les certificats</button>
                <button type="button" className="btn btn-secondary" onClick={() => printBordereauTransport({ idcontrat: id })} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Printer size={15} /> Imprimer le bordereau</button>
              </div>
            </>
          )}
        </div>
      )}
      {certificatsOuverts && (
        <CertificatsTransportModal
          filtres={{ idcontrat: id }}
          titre={`Certificats du contrat ${contract.numeropolice || ''}`.trim()}
          onClose={() => setCertificatsOuverts(false)}
        />
      )}

      {/* SECTION 3 : Situation d'Encaissement & Recouvrement */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 className="title-md" style={{ color: '#fff', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CreditCard size={18} color="#10b981" />
          Situation d'Encaissement
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', fontSize: '0.875rem' }}>
          <div style={{ padding: '0.75rem', background: 'var(--surface-sunken)', borderRadius: '6px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Prime Totale TTC</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)' }}>
              {Number(contract.prime_totale || 396851).toLocaleString('fr-FR')} FCFA
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: 'var(--surface-sunken)', borderRadius: '6px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Montant Encaissé</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
              {Number(contract.montant_encaisse || 0).toLocaleString('fr-FR')} FCFA
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: 'var(--surface-sunken)', borderRadius: '6px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Reste à Recouvrer</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: resteAEncaisser(contract.prime_totale || 396851, contract.montant_encaisse) > 0 ? '#fb7185' : '#34d399', fontFamily: 'var(--font-mono)' }}>
              {resteAEncaisser(contract.prime_totale || 396851, contract.montant_encaisse).toLocaleString('fr-FR')} FCFA
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: 'var(--surface-sunken)', borderRadius: '6px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Statut Comptable</div>
            <StatusBadge label={contract.statut_encaissement || (resteAEncaisser(contract.prime_totale || 396851, contract.montant_encaisse) === 0 ? 'Soldé' : 'À Encaisser')} color={resteAEncaisser(contract.prime_totale || 396851, contract.montant_encaisse) === 0 ? 'emerald' : 'amber'} />
          </div>
        </div>
      </div>

      {/* ASACI Digital Certificate section (if applicable) */}
      {attestation && (
        <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 className="title-md" style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Car size={18} color="#3b82f6" />
                Attestation Digitale ASACI Associée
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Certificat e-attestation enregistré sur le serveur central des assurances de Côte d'Ivoire.
              </p>
            </div>
            <StatusBadge label={attestation.statut_asaci} color={attestation.statut_badge} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem', fontSize: '0.875rem' }}>
            <div><strong>N° Attestation :</strong> <span style={{ color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>{attestation.numero_attestation}</span></div>
            <div><strong>Immatriculation :</strong> {attestation.immatriculation}</div>
            <div><strong>Code de Sécurité :</strong> {attestation.code_securite}</div>
            <div><strong>Expiration ASACI :</strong> {formatDate(attestation.date_expiration)}</div>
          </div>
        </div>
      )}

      {/* MINENE SANTÉ : IA et RC chef de famille rattachées à la police Santé (créées depuis cette police) */}
      {mineneConnexes?.Minene && (
        <div className="glass-panel" style={{ padding: '1.1rem 1.25rem', marginBottom: '1.5rem', border: '1px solid rgba(249, 115, 22, 0.35)' }}>
          <div style={{ fontWeight: 700, color: '#f97316', marginBottom: '0.35rem' }}>MINENE SANTÉ : Individuelle Accidents et RC chef de famille</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            Trois assurances indissociables : l'IA et la RC sont émises sur cette police Santé ({mineneConnexes.Adherents} adhérent{mineneConnexes.Adherents > 1 ? 's' : ''}, tarifés chacun), sans ressaisie.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
            {[['IA', 'Individuelle Accidents MINENE', 'ia'], ['RC', 'RC chef de famille MINENE', 'rc']].map(([cle, libelle, module]) => {
              const lies = mineneConnexes[cle] || [];
              const parametres = new URLSearchParams({
                minene: mineneConnexes.NumeroPolice, effet: mineneConnexes.DateEffet, expiration: mineneConnexes.DateExpiration,
                client: String(mineneConnexes.IdClient || ''), nom: mineneConnexes.Client || '',
              }).toString();
              return (
                <div key={cle} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '0.7rem 0.9rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.4rem' }}>{libelle}</div>
                  {lies.length === 0 && <div style={{ fontSize: '0.8rem', color: '#f59e0b', marginBottom: '0.5rem' }}>Pas encore émise sur cette police.</div>}
                  {lies.map((l) => (
                    <div key={l.IdDevis} style={{ fontSize: '0.8rem', marginBottom: '0.3rem' }}>
                      {l.IdContrat
                        ? <span>Contrat <strong>{l.NumeroPolice}</strong> - {Math.round(l.PrimeTtc).toLocaleString('fr-FR')} F TTC <button type="button" className="btn btn-link" style={{ padding: 0, fontSize: '0.8rem' }} onClick={() => navigate(`/user/contracts/${l.IdContrat}`)}>Ouvrir</button></span>
                        : <span>Devis <strong>{l.NumeroDevis}</strong> non confirmé - {Math.round(l.PrimeTtc).toLocaleString('fr-FR')} F TTC</span>}
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary" onClick={() => navigate(`/user/quotes/${module}?${parametres}`)}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', marginTop: '0.25rem' }}>
                    {lies.length ? `Émettre une autre ${cle} MINENE` : `Créer l'${cle === 'IA' ? 'IA' : 'RC'} MINENE`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Historique des Avenants & Renouvellements CIMA */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 className="title-md" style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileText size={18} color="#10b981" />
              Historique des Avenants ({endorsements.length})
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Actes modificatifs, prorogations de durée, attestations et certificats officiels CIMA.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn"
              style={{
                background: 'linear-gradient(135deg, #059669, #10b981)',
                color: '#fff',
                fontSize: '0.8rem',
                padding: '0.4rem 0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontWeight: 600,
                border: 'none',
                boxShadow: '0 2px 4px rgba(16, 185, 129, 0.3)',
                cursor: 'pointer',
              }}
              onClick={() => navigate(`/user/contracts/${id}/renouvellement`)}
            >
              <RefreshCw size={14} />
              <span>Nouveau Renouvellement</span>
            </button>
          </div>
        </div>

        {endorsements.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed var(--border-subtle)' }}>
            <FileText size={32} color="var(--text-muted)" style={{ margin: '0 auto 0.5rem' }} />
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600 }}>Aucun avenant ou renouvellement pour le moment.</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              Utilisez le bouton ci-dessus pour renouveler la police ou émettre un avenant de modification.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '0.825rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.65rem' }}>N° Avenant</th>
                  <th style={{ textAlign: 'left', padding: '0.65rem' }}>Mouvement</th>
                  <th style={{ textAlign: 'left', padding: '0.65rem' }}>Nature / Motif</th>
                  <th style={{ textAlign: 'left', padding: '0.65rem' }}>Période Couverte</th>
                  <th style={{ textAlign: 'right', padding: '0.65rem' }}>Incidence Financière</th>
                  <th style={{ textAlign: 'center', padding: '0.65rem' }}>Certificat Officiel</th>
                </tr>
              </thead>
              <tbody>
                {endorsements.map((m) => (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '0.65rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#34d399' }}>
                      {m.numero_avenant}
                    </td>
                    <td style={{ padding: '0.65rem' }}>
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          background:
                            m.type_mouvement === 'Renouvellement'
                              ? 'rgba(16, 185, 129, 0.15)'
                              : m.type_mouvement === 'Transformation'
                              ? 'rgba(168, 85, 247, 0.15)'
                              : 'rgba(59, 130, 246, 0.15)',
                          color:
                            m.type_mouvement === 'Renouvellement'
                              ? '#34d399'
                              : m.type_mouvement === 'Transformation'
                              ? '#c084fc'
                              : '#60a5fa',
                        }}
                      >
                        {m.type_mouvement}
                      </span>
                    </td>
                    <td style={{ padding: '0.65rem', color: 'var(--text-secondary)' }}>
                      {m.nature || m.details?.motif || 'Avenant de police'}
                    </td>
                    <td style={{ padding: '0.65rem' }}>
                      {m.date_effet ? `Du ${formatDate(m.date_effet)} au ${m.date_expiration || '31/12/2026'}` : m.date_avenant}
                    </td>
                    <td style={{ padding: '0.65rem', textAlign: 'right', fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)' }}>
                      {Number(m.prime_totale || 0).toLocaleString('fr-FR')} FCFA
                    </td>
                    <td style={{ padding: '0.65rem', textAlign: 'center' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                        onClick={() => {
                          setInitialOp({
                            type: m.type_mouvement || 'Renouvellement',
                            endorsement: m,
                            contract,
                            quittance: m.details?.quittance_num ? { numero_quittance: m.details.quittance_num } : null,
                          });
                          setIsMovementModalOpen(true);
                        }}
                        title="Imprimer le certificat officiel CIMA pour ce mouvement"
                      >
                        <Printer size={13} color="#0284c7" />
                        <span>Imprimer</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Mouvements CIMA & Impression Certificat */}
      <PolicyMovementModal
        isOpen={isMovementModalOpen}
        onClose={() => {
          setIsMovementModalOpen(false);
          setInitialOp(null);
        }}
        contract={contract}
        initialTab={movementTab}
        initialOperation={initialOp}
        onSuccess={() => {
          const updated = dataStore.getContractById(contract.numeropolice || contract.id);
          if (updated) setCurrentContract(updated);
          setEndorsements(dataStore.getEndorsementsByPolicy(contract.numeropolice || contract.id));
        }}
      />

      {/* Attestation, carte brune et relevé de compte (rubrique Documents) */}
      {fenetresDocuments}
      <AvenantSanteModal isOpen={avenantSanteOuvert} onClose={() => setAvenantSanteOuvert(false)} idContrat={contract.idcontrat || id} />
      <SuppressionModal isOpen={suppressionOuverte} onClose={() => setSuppressionOuverte(false)} type="contrat" id={contract.idcontrat || id}
        onSupprime={() => navigate('/user/contracts')} />
    </div>
  );
};

export default ContractDetailPage;
