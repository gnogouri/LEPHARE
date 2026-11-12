import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Car, CalendarRange, Loader2, AlertTriangle, UserPlus, Home } from 'lucide-react';
import { contractApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { useToast } from '../../../context/ToastContext';
import { joursAnneeDepuis, joursInclusifs } from '../../../utils/dateUtils';

const aujourdhui = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const dateFr = (valeur) => (valeur ? String(valeur).slice(0, 10).split('-').reverse().join('/') : '-');
const pourcentage = (valeur) => (valeur * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const aide = { fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 };
const champDate = { display: 'flex', flexDirection: 'column', gap: '0.4rem' };

export const IncorporationFlottePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [dateEffet, setDateEffet] = useState('');
  // Affaire à tarif forfaitaire : primes du fichier Excel reprises telles quelles, aucun prorata
  const [forfaitaire, setForfaitaire] = useState(false);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(true);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let actif = true;
    contractApi.preparerIncorporation(id)
      .then((reponse) => {
        if (!actif) return;
        setDonnees(reponse);
        // Date du jour proposée, ramenée dans la période du contrat ; la date d'incorporation reste au choix
        const { DateEffet: debut, DateExpiration: fin } = reponse.Contrat;
        const jour = aujourdhui();
        setDateEffet(jour < debut ? debut : (jour > fin ? fin : jour));
      })
      .catch((err) => { if (actif) setErreur(messageErreurApi(err)); })
      .finally(() => { if (actif) setChargement(false); });
    return () => { actif = false; };
  }, [id]);

  const contrat = donnees?.Contrat;
  const restant = joursInclusifs(dateEffet, contrat?.DateExpiration);
  const annee = joursAnneeDepuis(dateEffet);
  const prorata = Math.min(1, restant / annee);
  const enCours = donnees?.DevisEnCours?.[0];
  // Individuelle Accidents : une personne s'ajoute, sa prime est le tarif de l'offre (ni prorata à choisir ni fichier forfaitaire)
  // Vie AFA : une personne s'ajoute, sa prime est saisie ou importée telle quelle, sans prorata
  const afa = contrat?.Module === 'afa';
  const ia = contrat?.Module === 'ia' || afa;
  // MRH : une maison s'ajoute, ses primes sont saisies à la main dans l'écran MRH (pas de barème), sans prorata calculé
  const mrh = contrat?.Module === 'mrh';
  const Icone = mrh ? Home : ia ? UserPlus : Car;
  const ecran = ia || mrh ? contrat.Module : 'auto';
  const objet = mrh ? 'la maison' : ia ? 'la personne' : 'le véhicule';

  const creer = async () => {
    if (!dateEffet) {
      toastError(`Choisissez la date à laquelle ${objet} doit être assuré${ia || mrh ? 'e' : ''}.`);
      return;
    }
    setEnvoi(true);
    try {
      const devis = await contractApi.creerIncorporation(id, { DateEffet: dateEffet, Forfaitaire: forfaitaire });
      if (mrh) success(`Devis d'incorporation ${devis.NumeroDevis} créé. Ajoutez la ou les maisons, saisissez leurs primes, puis enregistrez.`);
      else if (afa) success(`Devis d'incorporation ${devis.NumeroDevis} créé. Saisissez ou importez la ou les personnes avec leur prime, puis enregistrez.`);
      else if (ia) success(`Devis d'incorporation ${devis.NumeroDevis} créé. Ajoutez la ou les personnes puis enregistrez pour calculer la prime.`);
      else {
        success(forfaitaire
          ? `Devis d'incorporation ${devis.NumeroDevis} créé (affaire forfaitaire). Importez le fichier Excel ou ajoutez le véhicule, puis enregistrez.`
          : `Devis d'incorporation ${devis.NumeroDevis} créé. Ajoutez le véhicule puis enregistrez-le pour calculer la prime.`);
      }
      navigate(`/user/quotes/${ecran}?edit=${devis.IdDevis}&incorporation=1`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <main className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <button type="button" className="btn btn-secondary" onClick={() => navigate(`/user/contracts/${id}`)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginBottom: '1rem' }}>
        <ArrowLeft size={15} /> Retour au contrat
      </button>
      <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
        <Icone size={22} /> {mrh ? 'Incorporer une maison au contrat' : ia ? 'Incorporer une personne au contrat' : 'Incorporer un véhicule à la flotte'}
      </h1>
      {chargement && <p role="status"><Loader2 size={15} className="spin" /> Lecture du contrat…</p>}
      {erreur && <div role="alert" style={{ color: 'var(--accent-rose)', display: 'flex', gap: '0.5rem' }}><AlertTriangle size={18} />{erreur}</div>}
      {contrat && (
        <section className="glass-panel" style={{ padding: '1.25rem', marginTop: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.8rem', marginBottom: '1rem' }}>
            <div><span className="text-muted">Police</span><strong style={{ display: 'block' }}>{contrat.NumeroPolice}</strong></div>
            <div><span className="text-muted">Client</span><strong style={{ display: 'block' }}>{contrat.Client}</strong></div>
            <div><span className="text-muted">Échéance du contrat principal</span><strong style={{ display: 'block' }}>{dateFr(contrat.DateExpiration)}</strong></div>
          </div>

          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {mrh ? `La maison sera assurée à partir de la date d’incorporation choisie et jusqu’à l’échéance du contrat, qui compte aujourd’hui ${contrat.Personnes} maison${contrat.Personnes > 1 ? 's' : ''}.`
              : ia ? `La personne sera assurée à partir de la date d’incorporation choisie et jusqu’à l’échéance du contrat, qui compte aujourd’hui ${contrat.Personnes} personne${contrat.Personnes > 1 ? 's' : ''}.`
              : 'Le véhicule sera assuré à partir de la date d’incorporation choisie et jusqu’à l’échéance initiale de la police.'}
            {' '}La période du contrat principal ne sera pas modifiée.
          </p>

          {enCours ? (
            <div style={{ padding: '0.9rem', border: '1px solid rgba(245, 158, 11, 0.45)', borderRadius: 8, background: 'rgba(245, 158, 11, 0.08)' }}>
              Un devis d’incorporation est déjà en cours : <strong>{enCours.NumeroDevis}</strong>, du {dateFr(enCours.DateEffet)} au {dateFr(enCours.DateExpiration)}
              {ia || mrh ? '.' : (enCours.Forfaitaire ? ' (affaire forfaitaire, sans prorata).' : ' (prime au prorata de la durée restante).')}
              <div style={{ marginTop: '0.65rem' }}>
                <Link className="btn btn-primary" to={`/user/quotes/${ecran}?edit=${enCours.IdDevis}&incorporation=1`}>Ouvrir le devis</Link>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.8rem', margin: '1rem 0' }}>
                <label style={champDate}>
                  <span style={{ fontWeight: 700 }}>Date d’émission</span>
                  <input type="date" className="form-control" value={aujourdhui()} readOnly disabled title="Date du jour, non modifiable" />
                  <span style={aide}>Date du jour, non imprimée sur les documents.</span>
                </label>
                <label style={champDate}>
                  <span style={{ fontWeight: 700 }}><CalendarRange size={15} style={{ verticalAlign: 'text-bottom' }} /> Date d’incorporation</span>
                  <input type="date" className="form-control" value={dateEffet} min={contrat.DateEffet}
                    max={contrat.DateExpiration} onChange={(event) => setDateEffet(event.target.value)} />
                  <span style={aide}>Au choix dans la période du contrat, à partir du {dateFr(contrat.DateEffet)}.</span>
                </label>
                <label style={champDate}>
                  <span style={{ fontWeight: 700 }}>Date d’échéance</span>
                  <input type="date" className="form-control" value={contrat.DateExpiration} readOnly disabled title="Fin du contrat, non modifiable" />
                  <span style={aide}>Fin du contrat, non modifiable.</span>
                </label>
              </div>
              {mrh ? (
                <p style={{ color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
                  Compagnie, souscripteur et assuré sont repris de la police. Comme pour tout devis MRH, la prime nette de chaque
                  maison, la taxe et l’accessoire sont saisis à la main : indiquez les montants dus pour la période d’incorporation.
                </p>
              ) : afa ? (
                <p style={{ color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
                  Compagnie et souscripteur sont repris de la police. La prime de chaque personne est celle saisie ou celle de la
                  liste Excel importée, reprise telle quelle, sans prorata.
                </p>
              ) : ia ? (
                <p style={{ color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
                  Catégorie, offre et souscripteur sont repris de la police. La prime de chaque personne est le tarif de l’offre,
                  calculé à l’enregistrement.
                </p>
              ) : (
              <fieldset style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '0.75rem 1rem', margin: '0 0 1rem' }}>
                <legend style={{ fontWeight: 700, padding: '0 0.35rem' }}>Tarification de l’affaire</legend>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.55rem', cursor: 'pointer' }}>
                  <input type="radio" name="tarification" checked={!forfaitaire} onChange={() => setForfaitaire(false)} style={{ marginTop: '0.25rem' }} />
                  <span>
                    <strong>Au prorata de la durée restante</strong>
                    <span style={{ display: 'block', fontSize: '0.83rem', color: 'var(--text-muted)' }}>
                      Prime annuelle du tarif × {restant}/{annee} jours ({pourcentage(prorata)} %), du {dateFr(dateEffet)} au {dateFr(contrat.DateExpiration)}.
                    </span>
                  </span>
                </label>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', cursor: 'pointer' }}>
                  <input type="radio" name="tarification" checked={forfaitaire} onChange={() => setForfaitaire(true)} style={{ marginTop: '0.25rem' }} />
                  <span>
                    <strong>Affaire à tarif forfaitaire</strong>
                    <span style={{ display: 'block', fontSize: '0.83rem', color: 'var(--text-muted)' }}>
                      Aucun prorata : la prime nette indiquée dans le fichier Excel importé est reprise telle quelle
                      (sans fichier, prime annuelle du barème).
                    </span>
                  </span>
                </label>
              </fieldset>
              )}
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Durée couverte : {restant} jour{restant > 1 ? 's' : ''}. Échéance maintenue au {dateFr(contrat.DateExpiration)}.
              </div>
              <button type="button" className="btn btn-primary" disabled={envoi || !dateEffet || dateEffet < contrat.DateEffet || dateEffet > contrat.DateExpiration}
                onClick={creer} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                {envoi ? <Loader2 size={15} className="spin" /> : <Icone size={15} />}
                {envoi ? 'Création du devis…' : `Continuer et ajouter ${objet}`}
              </button>
            </>
          )}
        </section>
      )}
    </main>
  );
};

export default IncorporationFlottePage;
