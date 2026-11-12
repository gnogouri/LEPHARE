import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Ship, FileSignature, CalendarClock, UploadCloud, ArrowRight, CheckCircle2, ChevronLeft,
} from 'lucide-react';
import { transportHorsGuceApi } from '../../../api/endpoints';
import { useAuth } from '../../../context/AuthContext';

// Accueil de la branche Transport : trois parcours qui ne se confondent pas.
// - cotation hors GUCE (police au voyage, annuelle ou d'abonnement) ;
// - polices d'abonnement : voyages déclarés et ressortie du mois ;
// - import des bordereaux GUCE (certificats du guichet unique, deux par mois).
// « Modifier » du registre des devis (?edit=) et un questionnaire prospect (?questionnaire=) mènent à la cotation.

const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');

const Parcours = ({ teinte, icone: Icone, titre, texte, points, action, pastille, principal, onClick }) => (
  <button type="button" className={`trp-parcours-carte${principal ? ' principal' : ''}`} style={{ '--trp-teinte': teinte }}
    onClick={onClick}>
    {pastille && <span className="trp-pastille">{pastille}</span>}
    <span className="trp-parcours-icone"><Icone size={24} /></span>
    <span className="trp-parcours-titre">{titre}</span>
    <span className="trp-parcours-texte">{texte}</span>
    <ul className="trp-parcours-liste">
      {points.map((p) => <li key={p}><CheckCircle2 size={14} /> {p}</li>)}
    </ul>
    <span className="trp-parcours-action">{action} <ArrowRight size={16} /></span>
  </button>
);

export const TransportAccueilPage = () => {
  const navigate = useNavigate();
  const { peut } = useAuth();
  const [parametres] = useSearchParams();
  const [aFacturer, setAFacturer] = useState(null);

  useEffect(() => {
    if (!peut('contrats.view')) {
      setAFacturer(null);
      return undefined;
    }
    let actif = true;
    transportHorsGuceApi.getAbonnements()
      .then((d) => {
        if (!actif) return;
        const polices = d?.Polices || [];
        setAFacturer({
          voyages: polices.reduce((s, p) => s + (p.VoyagesAFacturer || 0), 0),
          montant: polices.reduce((s, p) => s + (Number(p.MontantAFacturer) || 0), 0),
          polices: polices.length,
        });
      })
      .catch(() => { if (actif) setAFacturer(null); });
    return () => { actif = false; };
  }, [peut]);

  // Anciennes adresses : devis à modifier ou questionnaire à reprendre -> cotation hors GUCE
  if (parametres.get('edit') || parametres.get('questionnaire')) {
    return <Navigate replace to={`/user/quotes/transport/hors-guce?${parametres.toString()}`} />;
  }

  return (
    <div className="trp-page">
      <div>
        {peut('devis.view') && (
          <button type="button" className="btn btn-link trp-retour" onClick={() => navigate('/user/quotes')}>
            <ChevronLeft size={16} /> Registre des devis
          </button>
        )}
        <h1 className="title-xl trp-titre"><Ship size={26} /> Transport de marchandises</h1>
        <p className="trp-sous-titre">
          Trois parcours distincts : une cotation pour les marchandises hors guichet unique, le suivi des polices
          d'abonnement, ou l'import des certificats GUCE.
        </p>
      </div>

      <div className="trp-parcours">
        {peut(['devis.create', 'devis.update']) && <Parcours
          principal
          teinte="var(--primary-500)"
          icone={FileSignature}
          titre="Cotation hors GUCE"
          texte="Marchandises non soumises au guichet unique : police au voyage, police annuelle ou police d'abonnement."
          points={['Prime calculée en direct, étape par étape', 'Taux proposés par le barème, modifiables', 'Questionnaire du prospect repris']}
          action="Établir une cotation"
          onClick={() => navigate('/user/quotes/transport/hors-guce')}
        />}
        {peut('contrats.view') && <Parcours
          teinte="var(--accent-amber)"
          icone={CalendarClock}
          titre="Polices d'abonnement"
          texte="Déclarez chaque voyage sur la police, puis émettez la ressortie du mois : elle donne la facture de prime."
          points={['Prime de chaque voyage aux conditions de la police', 'Voyages du mois regroupés en une quittance']}
          action="Déclarer un voyage"
          pastille={aFacturer?.voyages ? `${aFacturer.voyages} voyage${aFacturer.voyages > 1 ? 's' : ''} à facturer` : ''}
          onClick={() => navigate('/user/quotes/transport/abonnements')}
        />}
        {peut('imports.guce') && <Parcours
          teinte="var(--accent-cyan)"
          icone={UploadCloud}
          titre="Import GUCE"
          texte="Bordereaux de ressortie du guichet unique, du 1er au 15 et du 16 à la fin du mois."
          points={['Contrôle du fichier avant tout enregistrement', 'Contrat et quittance par client et police GUCE']}
          action="Importer un bordereau"
          onClick={() => navigate('/user/quotes/transport/guce')}
        />}
      </div>

      <div className="trp-repere" aria-label="Repères">
        <div><strong>Police au voyage</strong>Un seul envoi ; le contrat prend fin à l'arrivée des marchandises.</div>
        <div><strong>Police annuelle</strong>Tous les envois de l'année ; renouvelable d'année en année.</div>
        <div><strong>Police d'abonnement</strong>Numéro de police sans prime ; chaque voyage déclaré l'alimente.</div>
        {peut('contrats.view') && aFacturer?.montant > 0 && (
          <div><strong>À facturer</strong>{fcfa(aFacturer.montant)} F sur {aFacturer.polices} police{aFacturer.polices > 1 ? 's' : ''} d'abonnement.</div>
        )}
      </div>
    </div>
  );
};

export default TransportAccueilPage;
