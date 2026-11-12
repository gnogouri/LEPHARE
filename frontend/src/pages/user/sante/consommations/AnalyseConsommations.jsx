import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  Building2, ChevronRight, CircleAlert, CircleCheck, CircleDashed, Eye, Info, Loader2, RotateCcw, Search, TrendingDown, TrendingUp, TriangleAlert, X,
} from 'lucide-react';
import { consommationsApi } from '../../../../api/endpoints';
import { useToast } from '../../../../context/ToastContext';
import { aLeDroit } from '../../../../utils/droits';
import { dateFr, messageErreurApi } from '../../../../utils/financeUtils';
import {
  BarreSegmentee, BarresClassees, Cadre, Colonnes, CourbeConcentration, Courbes, EchelleChaleur, IndiceDivergent, Jauge, Pyramide, Sparkline,
  TableauChaleur, decimal, entier, francs, francsCourts, pct,
} from './graphiques';

/* =========================================================================
   Analyse des consommations santé : quatre onglets (vue d'ensemble, entreprises, prestations, assurés et foyers) sur une seule
   lecture GET /api/consommations/analyse/ (sante/consommations_analyse.py), partagée et filtrée par une barre unique au-dessus des
   onglets. Les chiffres sont ceux de la partie V du rapport Word. Données de santé : droit consommations.view.
   ========================================================================= */

// ------------------------------------------------------------------ lecture partagée
// Une lecture par jeu de filtres ; pendant un rechargement, l'affichage précédent reste en place, atténué (pas de saut de page)
export const useAnalyse = (filtres, actif) => {
  const { error: toastError } = useToast();
  const [etat, setEtat] = useState({ donnees: null, chargement: false, cle: null });
  const cle = JSON.stringify(filtres);
  useEffect(() => {
    if (!actif || etat.cle === cle) return undefined;
    let annule = false;
    setEtat((e) => ({ ...e, chargement: true }));
    consommationsApi.analyse(filtres)
      .then((donnees) => { if (!annule) setEtat({ donnees, chargement: false, cle }); })
      .catch((err) => {
        if (annule) return;
        setEtat((e) => ({ ...e, chargement: false, cle }));
        toastError(`Analyse impossible : ${messageErreurApi(err)}`);
      });
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, actif, etat.cle]);
  return [etat.donnees, etat.chargement, () => setEtat((e) => ({ ...e, cle: null }))];
};

// ------------------------------------------------------------------ briques
const SITUATIONS = {
  'Provision dépassée': { ton: 'critique', icone: CircleAlert, jauge: 'critique' },
  'Dépassement prévu': { ton: 'serieux', icone: TriangleAlert, jauge: 'attention' },
  'À surveiller': { ton: 'attention', icone: Eye, jauge: 'attention' },
  Normale: { ton: 'bon', icone: CircleCheck, jauge: 'normal' },
  'Sans provision': { ton: 'neutre', icone: CircleDashed, jauge: 'normal' },
};
const ORDRE_SITUATIONS = Object.keys(SITUATIONS);
const ICONES_TON = { critique: CircleAlert, attention: TriangleAlert, info: Info, bon: CircleCheck };
const nomEntreprise = (l) => (l.Entreprises?.[0] || l.Police || 'Sans police');

export const BadgeSituation = ({ situation }) => {
  const s = SITUATIONS[situation] || SITUATIONS['Sans provision'];
  const Icone = s.icone;
  return <span className={`cs-etat ton-${s.ton}`}><Icone size={13} aria-hidden="true" />{situation}</span>;
};

const Carte = ({ titre, sousTitre, actions, children, className = '' }) => (
  <section className={`glass-panel cs-carte ${className}`}>
    {(titre || actions) && (
      <header className="cs-carte-entete">
        <div>
          {titre && <h2>{titre}</h2>}
          {sousTitre && <p>{sousTitre}</p>}
        </div>
        {actions}
      </header>
    )}
    {children}
  </section>
);

// Variation signée ; « hausse = mauvais » pour une dépense ou un coût
const Evolution = ({ valeur, mois, hausseMauvaise = true }) => {
  if (valeur === null || valeur === undefined) return null;
  const hausse = valeur > 0;
  const Icone = hausse ? TrendingUp : TrendingDown;
  const ton = Math.abs(valeur) < 0.02 ? 'neutre' : hausse === hausseMauvaise ? 'mauvais' : 'bon';
  return (
    <span className={`cs-evolution ${ton}`} title={`Moyenne des ${mois} derniers mois comparée aux ${mois} mois précédents`}>
      <Icone size={13} aria-hidden="true" />
      <strong>{`${hausse ? '+' : ''}${pct(valeur)}`}</strong>
      <span>{`sur ${mois} mois`}</span>
    </span>
  );
};

const TuileStat = ({ libelle, valeur, detail, serie, libelleSerie, evolution }) => (
  <div className="cs-tuile">
    <div className="cs-tuile-libelle">{libelle}</div>
    <div className="cs-tuile-corps">
      <div className="cs-tuile-valeur">{valeur}</div>
      {serie && <Sparkline valeurs={serie} libelle={libelleSerie || `Évolution mensuelle : ${libelle.toLowerCase()}`} />}
    </div>
    {evolution}
    {detail && <div className="cs-tuile-detail">{detail}</div>}
  </div>
);

/* Constats : `replie` = nombre affiché d'emblée, le reste derrière « Voir les autres constats » ; ce qui demande une action
   (critique, attention) et les deux constats de provision restent toujours visibles. */
const Constats = ({ constats = [], max, replie }) => {
  const [deplie, setDeplie] = useState(false);
  const toujours = constats.filter((c) => c.Ton === 'critique' || c.Ton === 'attention' || ['Provisions', 'Projection'].includes(c.Titre)).length;
  const seuil = replie ? Math.max(replie, toujours) : (max || constats.length);
  const visibles = deplie ? constats : constats.slice(0, seuil);
  return (
    <>
      <ul className={`cs-constats${replie ? ' en-grille' : ''}`}>
        {visibles.map((c) => {
          const Icone = ICONES_TON[c.Ton] || Info;
          return (
            <li key={`${c.Titre}-${c.Texte.slice(0, 20)}`} className={`ton-${c.Ton}`}>
              <Icone size={16} aria-hidden="true" />
              <div><strong>{c.Titre}</strong><p>{c.Texte}</p></div>
            </li>
          );
        })}
      </ul>
      {replie && constats.length > seuil && (
        <button type="button" className="cs-bouton-chiffres cs-plus" aria-expanded={deplie} onClick={() => setDeplie((d) => !d)}>
          {deplie ? 'Replier' : `Voir les ${constats.length - seuil} autres constats`}
        </button>
      )}
    </>
  );
};

const Vide = ({ texte }) => <p className="cs-vide etat-anime">{texte}</p>;

// Mois de la période jusqu'au dernier mois avec des données (graphiques mensuels)
const moisAvecDonnees = (mensuel = []) => {
  const fin = mensuel.map((m) => !m.Futur).lastIndexOf(true);
  return fin < 0 ? [] : mensuel.slice(0, fin + 1);
};

// ------------------------------------------------------------------ barre de filtres (une seule, au-dessus de tous les onglets d'analyse)
export const BarreFiltres = ({ filtres, setFiltres, donnees, chargement }) => {
  const champ = (cle) => (e) => setFiltres((f) => ({ ...f, [cle]: e.target.value, ...(cle === 'garant' ? { police: '' } : {}) }));
  const actifs = Object.values(filtres).some(Boolean);
  const exercices = donnees?.Exercices?.length ? donnees.Exercices : [donnees?.Exercice].filter(Boolean);
  return (
    <div className="glass-panel cs-filtres" role="search" aria-label="Filtres de l'analyse">
      <label className="cs-filtre">
        <span>Exercice</span>
        <select className="form-control" value={filtres.exercice || donnees?.Exercice || ''} onChange={champ('exercice')}>
          {exercices.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <label className="cs-filtre">
        <span>Clôtures du</span>
        <input type="date" className="form-control" value={filtres.du} onChange={champ('du')} />
      </label>
      <label className="cs-filtre">
        <span>au</span>
        <input type="date" className="form-control" value={filtres.au} onChange={champ('au')} />
      </label>
      <label className="cs-filtre">
        <span>Compagnie</span>
        <select className="form-control" value={filtres.garant} onChange={champ('garant')}>
          <option value="">Toutes les compagnies</option>
          {(donnees?.Garants || []).map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </label>
      <label className="cs-filtre large">
        <span>Entreprise</span>
        <select className="form-control" value={filtres.police} onChange={champ('police')}>
          <option value="">Toutes les entreprises</option>
          {(donnees?.Polices || []).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      {actifs && (
        <button type="button" className="btn btn-secondary cs-filtre-bouton" onClick={() => setFiltres({ exercice: '', du: '', au: '', garant: '', police: '' })}>
          <RotateCcw size={14} aria-hidden="true" /> Réinitialiser
        </button>
      )}
      <p className="cs-filtres-note" aria-live="polite">
        {chargement ? <><Loader2 size={13} className="spin" aria-hidden="true" /> Calcul en cours…</>
          : donnees ? `Période du ${dateFr(donnees.Du)} au ${dateFr(donnees.Au)}, selon la date de clôture des relevés.` : ''}
      </p>
    </div>
  );
};

// ------------------------------------------------------------------ vue d'ensemble
export const OngletEnsemble = ({ donnees: a }) => {
  const s = a.Synthese;
  const mois = moisAvecDonnees(a.Mensuel);
  const t = s.Tendance;
  const tonJauge = (s.TauxProvision || 0) > 1 ? 'critique' : (s.TauxProjete || 0) >= 0.8 ? 'attention' : 'normal';
  const seriesTrajectoire = [
    { cle: 'reel', libelle: 'Consommation cumulée', valeurs: a.Mensuel.map((m) => m.Cumul), couleur: 'var(--cs-viz-1)', style: 'plein', aire: true, libelleFin: 'à ce jour', decalageFin: 14 },
    { cle: 'projete', libelle: 'Projection au rythme actuel', valeurs: a.Mensuel.map((m) => m.Projete), couleur: 'var(--cs-viz-1)', style: 'tirets', libelleFin: 'projetée' },
    ...(s.Provision ? [{ cle: 'budget', libelle: 'Provision au prorata', valeurs: a.Mensuel.map((m) => m.Budget), couleur: 'var(--cs-attenue)', style: 'repere', libelleFin: 'provision' }] : []),
  ];
  const d = a.Decomposition;
  return (
    <div className="cs-pile">
      <div className="cs-une">
        <Carte className="cs-heros">
          <div className="cs-heros-libelle">Consommation de la période</div>
          <div className="cs-heros-valeur">{francsCourts(s.Depenses)}</div>
          <div className="cs-heros-detail">
            {`${francs(s.Depenses)} remboursés pour ${entier(s.Actes)} actes`}
            {t && <Evolution valeur={t.Depenses} mois={t.Mois} />}
          </div>
          {s.Provision ? (
            <div className={`cs-heros-provision ton-${tonJauge}`}>
              <div className="cs-heros-ligne">
                <span><strong>{pct(s.TauxProvision, 0)}</strong> des provisions consommées</span>
                <span className="cs-muet">{francsCourts(s.Provision)}</span>
              </div>
              <Jauge taux={s.TauxProvision} projete={s.TauxProjete} repere={s.Attendu} ton={tonJauge}
                libelle={`${pct(s.TauxProvision)} des provisions consommées, ${pct(s.Attendu)} de la période écoulée, projection ${pct(s.TauxProjete)}`} />
              <ul className="cs-heros-cles">
                <li><span className="cs-cle cs-cle-barre" style={{ '--cs-cle': 'var(--cs-jauge)' }} aria-hidden="true" />Consommé</li>
                <li><span className="cs-cle cs-cle-barre leger" style={{ '--cs-cle': 'var(--cs-jauge)' }} aria-hidden="true" />{`Projeté en fin de période : ${pct(s.TauxProjete, 0)}`}</li>
                <li><span className="cs-cle cs-cle-trait" aria-hidden="true" />{`Période écoulée à fin ${(s.DernierMois || '').toLowerCase()} : ${pct(s.Attendu, 0)}`}</li>
              </ul>
            </div>
          ) : (
            <p className="cs-muet">Aucune provision rattachée : importez l'état des cotisations de l'exercice pour comparer la consommation aux provisions.</p>
          )}
        </Carte>
        <div className="cs-tuiles">
          <TuileStat libelle="Bénéficiaires couverts" valeur={entier(s.Effectif)} detail={`${entier(s.Foyers)} foyers, ${decimal(s.TailleFoyer)} personnes par foyer`} />
          <TuileStat libelle="Recours aux soins" valeur={pct(s.TauxRecours, 0)}
            detail={`${entier(s.ConsommantsCouverts)} couverts ont consommé${s.HorsEffectif ? `, ${entier(s.HorsEffectif)} consommants hors effectif` : ''}`} />
          <TuileStat libelle="Actes par mois" valeur={entier(s.Series.Actes.reduce((t, n) => t + n, 0) / Math.max(1, s.Series.Actes.length))} serie={s.Series.Actes}
            evolution={t && <Evolution valeur={t.Actes} mois={t.Mois} />} detail={`${decimal(s.Frequence)} actes par consommant`} />
          <TuileStat libelle="Coût par bénéficiaire couvert" valeur={francs(s.CoutParBeneficiaire)} detail={`${francs(s.CoutParConsommant)} par consommant`} />
          <TuileStat libelle="Coût moyen par acte" valeur={francs(s.CoutParActe)} serie={s.Series.CoutParActe}
            evolution={t && <Evolution valeur={t.CoutParActe} mois={t.Mois} />} />
          <TuileStat libelle="Prise en charge" valeur={pct(s.TauxPriseEnCharge, 0)} detail={`${francsCourts(s.ResteACharge)} restent à la charge des assurés`} />
        </div>
      </div>

      <Carte titre="À retenir" sousTitre="Lecture automatique de la période, de ce qui demande une action au simple constat.">
        <Constats constats={a.Constats} replie={6} />
      </Carte>

      <div className="cs-deux">
        <Carte titre="Trajectoire de la consommation" sousTitre={s.Provision ? 'Consommation cumulée, projection au rythme moyen des mois du relevé et provision répartie sur la période.' : 'Consommation cumulée et projection au rythme moyen des mois du relevé.'}>
          <Cadre
            legende={seriesTrajectoire.map((x) => ({ libelle: x.libelle, couleur: x.couleur, forme: x.style === 'tirets' ? 'tirets' : x.style === 'repere' ? 'repere' : 'ligne' }))}
            tableau={{
              entetes: ['Mois', 'Consommation cumulée', 'Projection', ...(s.Provision ? ['Provision au prorata'] : [])],
              lignes: a.Mensuel.map((m) => [m.LibelleLong, francs(m.Cumul), francs(m.Projete), ...(s.Provision ? [francs(m.Budget)] : [])]),
            }}
            note={`Rythme mensuel moyen : ${francsCourts(s.Rythme)} sur ${entier(s.MoisEcoules)} mois, tous les actes de chaque mois compris.`}>
            <Courbes etiquettes={a.Mensuel.map((m) => ({ cle: m.Cle, libelle: m.Libelle, libelleCourt: m.Libelle.split(' ')[0], libelleLong: m.LibelleLong }))}
              series={seriesTrajectoire} libelleAria="Consommation cumulée, projection et provision par mois" />
          </Cadre>
        </Carte>
        <Carte titre="Dépenses par mois" sousTitre="Mois de clôture du relevé, c'est-à-dire du paiement.">
          <Cadre
            tableau={{ entetes: ['Mois', 'Dépenses', 'Actes', 'Consommants', 'Coût par acte'], lignes: mois.map((m) => [m.LibelleLong, francs(m.Depenses), entier(m.Actes), entier(m.Consommants), francs(m.CoutParActe)]) }}>
            <Colonnes points={mois.map((m) => ({ cle: m.Cle, libelle: m.LibelleLong, libelleCourt: m.Libelle.split(' ')[0], valeur: m.Depenses }))}
              libelleAria="Dépenses par mois de clôture"
              lignesBulle={(p) => {
                const m = mois.find((x) => x.Cle === p.cle);
                return [{ libelle: 'dépenses', valeur: francs(m.Depenses), couleur: 'var(--cs-viz-1)' }, { libelle: 'actes', valeur: entier(m.Actes) },
                  { libelle: 'consommants', valeur: entier(m.Consommants) }, { libelle: 'par acte', valeur: francs(m.CoutParActe) }];
              }} />
          </Cadre>
        </Carte>
      </div>

      <div className="cs-deux">
        <Carte titre="Familles de prestations" sousTitre="Dépenses et part du total, de la plus coûteuse à la moins coûteuse.">
          <BarresClassees lignes={a.Familles.map((f) => ({ cle: f.Famille, libelle: f.Famille, valeur: f.Depenses, valeurAffichee: `${francsCourts(f.Depenses)} - ${pct(f.Part, 0)}`, annexes: [entier(f.Actes), francs(f.CoutParActe)] }))}
            colonnes={['Actes', 'Coût / acte']} />
        </Carte>
        <div className="cs-pile">
        <Carte titre="Du montant réclamé au montant remboursé" sousTitre={`Sur ${francs(d.Reclame)} réclamés par les prestataires.`}>
          <BarreSegmentee parts={[
            { cle: 'rembourse', libelle: 'Remboursé', valeur: d.Rembourse },
            { cle: 'ticket', libelle: 'Ticket modérateur et plafonds', valeur: Math.max(0, d.TicketEtPlafonds) },
            { cle: 'depassements', libelle: 'Dépassements', valeur: d.Depassements },
            { cle: 'exclusions', libelle: 'Exclusions', valeur: d.Exclusions },
          ]} />
          <dl className="cs-chiffres-cles">
            <div><dt>Remboursé</dt><dd>{francs(d.Rembourse)}</dd></div>
            <div><dt>Ticket modérateur et plafonds</dt><dd>{francs(d.TicketEtPlafonds)}</dd></div>
            <div><dt>Dépassements</dt><dd>{francs(d.Depassements)}</dd></div>
            <div><dt>Exclusions</dt><dd>{francs(d.Exclusions)}</dd></div>
          </dl>
        </Carte>
        <Carte titre="Par compagnie" sousTitre="Garant indiqué par le relevé du gestionnaire.">
          <BarresClassees lignes={a.Compagnies.map((c) => ({
            cle: c.Garant, libelle: c.Garant, detail: `${entier(c.Polices)} entreprise${c.Polices > 1 ? 's' : ''}, ${entier(c.Effectif)} bénéficiaires`, valeur: c.Depenses,
            valeurAffichee: `${francsCourts(c.Depenses)} - ${pct(c.Part, 0)}`, annexes: [pct(c.TauxRecours, 0), francs(c.CoutParBeneficiaire)],
          }))} colonnes={['Recours', 'Coût / bénéf.']} />
        </Carte>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ entreprises
const TRIS = [
  ['Depenses', 'Dépenses'], ['TauxProjete', 'Provision projetée'], ['CoutParBeneficiaire', 'Coût par bénéficiaire'], ['Score', 'Score de risque'], ['Nom', 'Nom'],
];

export const OngletEntreprises = ({ donnees: a, onOuvrir }) => {
  const [situation, setSituation] = useState('');
  const [texte, setTexte] = useState('');
  const [tri, setTri] = useState('Depenses');
  const g = a.Gestion;
  const lignes = useMemo(() => {
    const q = texte.trim().toLowerCase();
    const filtre = a.Entreprises.filter((l) => (!situation || l.Situation === situation)
      && (!q || `${l.Police} ${(l.Entreprises || []).join(' ')} ${l.Garant}`.toLowerCase().includes(q)));
    return [...filtre].sort((x, y) => (tri === 'Nom' ? nomEntreprise(x).localeCompare(nomEntreprise(y), 'fr') : (Number(y[tri]) || 0) - (Number(x[tri]) || 0)));
  }, [a.Entreprises, situation, texte, tri]);
  return (
    <div className="cs-pile">
      {a.CotisationsImportees ? (
        <div className="cs-tuiles larges">
          <TuileStat libelle="Provisions pour paiement" valeur={francsCourts(g.Provision)} detail={`${entier(g.Entreprises)} entreprises à l'état des cotisations`} />
          <TuileStat libelle="Consommation" valeur={francsCourts(a.Synthese.Depenses)} detail={`${pct(a.Synthese.TauxProvision, 0)} des provisions`} />
          <TuileStat libelle="Reste sur les provisions" valeur={francsCourts(g.Provision - a.Synthese.Depenses)} detail={`projection : ${francsCourts(a.Synthese.Projection)}`} />
          <TuileStat libelle="Primes HT" valeur={francsCourts(g.PrimeHt)} detail={`cotisations santé pure ${francsCourts(g.CotisationPure)}`} />
          <TuileStat libelle="Honoraires et commissions" valeur={francsCourts(g.Honoraires + g.Commissions)} detail={`apporteurs ${francsCourts(g.Apporteurs)}`} />
        </div>
      ) : (
        <Carte><p className="cs-muet" style={{ margin: 0 }}>Aucun état des cotisations pour {a.Exercice} : importez le fichier ETAT dans l'onglet Imports pour suivre les provisions par entreprise.</p></Carte>
      )}

      <Carte titre={`Entreprises : ${entier(lignes.length)}`}
        sousTitre="Cliquez une entreprise pour ouvrir sa fiche : évolution, familles de prestations, bénéficiaires, plus gros foyers et rattachement à l'état des cotisations.">
        <div className="cs-outils">
          <div className="cs-pastilles" role="group" aria-label="Situation face à la provision">
            <button type="button" className={`cs-pastille${!situation ? ' active' : ''}`} aria-pressed={!situation} onClick={() => setSituation('')}>
              Toutes <span>{entier(a.Entreprises.length)}</span>
            </button>
            {ORDRE_SITUATIONS.filter((s) => g.Situations?.[s]).map((s) => {
              const Icone = SITUATIONS[s].icone;
              return (
                <button key={s} type="button" className={`cs-pastille ton-${SITUATIONS[s].ton}${situation === s ? ' active' : ''}`} aria-pressed={situation === s}
                  onClick={() => setSituation(situation === s ? '' : s)}>
                  <Icone size={13} aria-hidden="true" />{s} <span>{entier(g.Situations[s])}</span>
                </button>
              );
            })}
          </div>
          <div className="cs-outils-droite">
            <label className="cs-recherche">
              <Search size={14} aria-hidden="true" />
              <input className="form-control" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Entreprise, police ou compagnie" aria-label="Rechercher une entreprise" />
            </label>
            <label className="cs-filtre en-ligne">
              <span>Trier par</span>
              <select className="form-control" value={tri} onChange={(e) => setTri(e.target.value)}>
                {TRIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="table-wrapper cs-table-entreprises">
          <table className="data-table">
            <thead>
              <tr>
                <th>Entreprise</th><th className="cs-nombre">Bénéficiaires</th><th className="cs-nombre">Recours</th><th className="cs-nombre">Dépenses par mois</th>
                <th className="cs-nombre">Coût / bénéf.</th><th>Provision : consommé et projeté</th><th>Situation</th><th className="cs-nombre">Score</th><th aria-label="Ouvrir" />
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => {
                const s = SITUATIONS[l.Situation] || SITUATIONS['Sans provision'];
                return (
                  <tr key={l.Cle} className="cs-ligne-cliquable" onClick={() => onOuvrir(l)}>
                    <td>
                      <button type="button" className="cs-lien-ligne" onClick={(e) => { e.stopPropagation(); onOuvrir(l); }}>{nomEntreprise(l)}</button>
                      <div className="cs-sous-texte">{[l.Entreprises?.[0] && l.Police && l.Police !== l.Entreprises[0] ? `police ${l.Police}` : '', l.Garant].filter(Boolean).join(' - ')}</div>
                    </td>
                    <td className="cs-nombre">{entier(l.Effectif)}<div className="cs-sous-texte">{`${l.Assures} A, ${l.Conjoints} C, ${l.Enfants} E`}</div></td>
                    <td className="cs-nombre">{pct(l.TauxRecours, 0)}</td>
                    <td className="cs-nombre">
                      <div className="cs-depenses-cellule">
                        <Sparkline valeurs={l.Serie.slice(0, a.Synthese.MoisEcoules)} largeur={84} hauteur={24} libelle={`Dépenses mensuelles de ${nomEntreprise(l)}, mois complets`} />
                        <span>{francsCourts(l.Depenses)}<span className="cs-sous-texte">{pct(l.Part, 1)}</span></span>
                      </div>
                    </td>
                    <td className="cs-nombre">{francs(l.CoutParBeneficiaire)}</td>
                    <td className="cs-cellule-jauge">
                      {l.Provision ? (
                        <>
                          <Jauge fine taux={l.TauxProvision} projete={l.TauxProjete} repere={a.Synthese.Attendu} ton={s.jauge}
                            libelle={`${pct(l.TauxProvision)} de la provision consommée, ${pct(l.TauxProjete)} projetée`} />
                          <div className="cs-sous-texte">{`${pct(l.TauxProvision, 0)} consommé, ${pct(l.TauxProjete, 0)} projeté`}</div>
                          <div className="cs-sous-texte">{`provision ${francsCourts(l.Provision)}`}</div>
                        </>
                      ) : <span className="cs-muet">Aucune provision</span>}
                    </td>
                    <td><BadgeSituation situation={l.Situation} /></td>
                    <td className="cs-nombre">
                      {l.Score === null || l.Score === undefined ? '-' : (
                        <span className={`cs-score${l.Score >= 1 ? ' critique' : ''}`} title={l.Alertes?.join(', ') || 'Aucune alerte'}>{decimal(l.Score, 2)}</span>
                      )}
                    </td>
                    <td className="cs-nombre"><ChevronRight size={16} className="cs-muet" aria-hidden="true" /></td>
                  </tr>
                );
              })}
              {!lignes.length && <tr><td colSpan={9}><Vide texte="Aucune entreprise ne correspond." /></td></tr>}
            </tbody>
          </table>
        </div>
        <p className="cs-note">
          Situation : la projection prolonge le rythme mensuel de l'entreprise jusqu'à la fin de la période ; « Dépassement prévu » au-delà de la provision, « À surveiller » à partir de 80 %.
          Le trait vertical de la jauge marque la part de la période écoulée. Score de risque : moyenne des rapports à la moyenne du portefeuille du coût par bénéficiaire,
          des actes par bénéficiaire et du coût par acte, critique à partir de 1. Formules proposées, à valider.
        </p>
      </Carte>
    </div>
  );
};

// ------------------------------------------------------------------ fiche d'une entreprise (panneau latéral)
const Tiroir = ({ ouvert, onFermer, titre, sousTitre, children }) => {
  const id = useId();
  const fermer = useRef(null);
  const precedent = useRef(null);
  // Dernière fonction de fermeture reçue : l'effet ne dépend que de l'ouverture (le focus ne saute pas à chaque rendu)
  const surFermeture = useRef(onFermer);
  surFermeture.current = onFermer;
  useEffect(() => {
    if (!ouvert) return undefined;
    precedent.current = document.activeElement;
    fermer.current?.focus();
    const touche = (e) => { if (e.key === 'Escape') surFermeture.current(); };
    document.addEventListener('keydown', touche);
    const debordement = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', touche);
      document.body.style.overflow = debordement;
      precedent.current?.focus?.();
    };
  }, [ouvert]);
  if (!ouvert) return null;
  return ReactDOM.createPortal(
    <div className="cs-tiroir-fond" onMouseDown={(e) => { if (e.target === e.currentTarget) onFermer(); }}>
      <aside className="cs-tiroir" role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="cs-tiroir-entete">
          <div>
            <h2 id={id}><Building2 size={18} aria-hidden="true" />{titre}</h2>
            {sousTitre && <p>{sousTitre}</p>}
          </div>
          <button ref={fermer} type="button" className="cs-tiroir-fermer" onClick={onFermer} aria-label="Fermer la fiche"><X size={18} /></button>
        </header>
        <div className="cs-tiroir-corps">{children}</div>
      </aside>
    </div>,
    document.body,
  );
};

export const FicheEntreprise = ({ ligne, filtres, polices, onFermer, onLie, onAnalyser, onOuvrirFiche }) => {
  const { success, error: toastError } = useToast();
  const peutLier = aLeDroit('consommations.import');
  const filtresFiche = useMemo(() => ({ exercice: filtres.exercice, du: filtres.du, au: filtres.au, police: ligne?.Police || '' }), [filtres, ligne]);
  const [a, chargement, recharger] = useAnalyse(filtresFiche, Boolean(ligne?.Police));
  const lier = async (entreprise, police) => {
    try {
      success((await consommationsApi.lier(entreprise, police)).Message);
      onLie();
      // Rattachée à une autre police, l'entreprise change de ligne : la fiche se ferme sur la liste à jour
      if (police !== (ligne?.Police || '')) onFermer();
      else recharger();
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };
  if (!ligne) return null;
  // Situation, score et provision : ceux de la liste, calculés face à tout le portefeuille (filtrée sur une seule entreprise,
  // l'analyse la comparerait à elle-même) ; les indicateurs et graphiques viennent de l'analyse de l'entreprise
  const l = ligne;
  const s = a?.Synthese;
  const mois = moisAvecDonnees(a?.Mensuel || []);
  const situation = SITUATIONS[l.Situation] || SITUATIONS['Sans provision'];
  return (
    <Tiroir ouvert={Boolean(ligne)} onFermer={onFermer} titre={nomEntreprise(l)}
      sousTitre={[l.Police && `police ${l.Police}`, l.Garant, l.Entreprises?.length ? `état des cotisations : ${l.Entreprises.join(', ')}` : 'aucune entreprise de l\'état rattachée'].filter(Boolean).join(' - ')}>
      <div className="cs-tiroir-situation">
        <BadgeSituation situation={l.Situation} />
        {l.Score !== null && l.Score !== undefined && <span className={`cs-score${l.Score >= 1 ? ' critique' : ''}`}>{`Score ${decimal(l.Score, 2)}`}</span>}
        {(l.Alertes || []).filter((x) => x !== 'Critique').map((x) => <span key={x} className="cs-etat ton-attention"><TriangleAlert size={13} aria-hidden="true" />{x}</span>)}
      </div>

      {l.Provision > 0 && (
        <div className="cs-tiroir-bloc">
          <div className="cs-heros-ligne">
            <span><strong>{pct(l.TauxProvision, 0)}</strong>{` de la provision de ${francs(l.Provision)}`}</span>
            <span className="cs-muet">{`projeté ${pct(l.TauxProjete, 0)}`}</span>
          </div>
          <Jauge taux={l.TauxProvision} projete={l.TauxProjete} repere={s?.Attendu} ton={situation.jauge}
            libelle={`${pct(l.TauxProvision)} de la provision consommée, projection ${pct(l.TauxProjete)}`} />
          <p className="cs-sous-texte">{`Reste ${francs(l.Reste)} ; projection ${francs(l.Projection)} en fin de période. Primes HT ${francs(l.PrimeHt)}, cotisations santé pure ${francs(l.CotisationPure)}.`}</p>
        </div>
      )}

      {peutLier && (l.Entreprises?.length > 0) && (
        <div className="cs-tiroir-bloc">
          <h3>Rattachement à l'état des cotisations</h3>
          {l.Entreprises.map((e) => (
            <label key={e} className="cs-filtre">
              <span>{`Police du gestionnaire pour ${e}`}</span>
              <select className="form-control" value={l.Police || ''} onChange={(ev) => lier(e, ev.target.value)}>
                <option value="">Aucune police</option>
                {polices.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          ))}
          {l.LienPropose && <p className="cs-sous-texte cs-texte-attention">Lien proposé d'après le nom, à confirmer en le choisissant dans la liste.</p>}
        </div>
      )}

      {!l.Police ? (
        <Vide texte="Cette entreprise de l'état des cotisations n'est rattachée à aucune police du gestionnaire : choisissez sa police pour suivre sa consommation." />
      ) : !a ? (
        <p className="cs-muet"><Loader2 size={14} className="spin" aria-hidden="true" /> Analyse de l'entreprise…</p>
      ) : (
        <div className={`cs-pile${chargement ? ' cs-rechargement' : ''}`}>
          <div className="cs-tuiles compactes">
            <TuileStat libelle="Dépenses" valeur={francsCourts(s.Depenses)} detail={`${pct(ligne.Part, 1)} du portefeuille`} serie={s.Series.Depenses} />
            <TuileStat libelle="Bénéficiaires" valeur={entier(s.Effectif)} detail={`${l.Assures} assurés, ${l.Conjoints} conjoints, ${l.Enfants} enfants`} />
            <TuileStat libelle="Recours" valeur={pct(s.TauxRecours, 0)} detail={`${decimal(s.Frequence)} actes par consommant`} />
            <TuileStat libelle="Coût par bénéficiaire" valeur={francs(s.CoutParBeneficiaire)} detail={`${francs(s.CoutParActe)} par acte`} />
          </div>
          <Cadre titre="Dépenses par mois" tableau={{ entetes: ['Mois', 'Dépenses', 'Actes'], lignes: mois.map((m) => [m.LibelleLong, francs(m.Depenses), entier(m.Actes)]) }}>
            <Colonnes hauteur={190} points={mois.map((m) => ({ cle: m.Cle, libelle: m.LibelleLong, libelleCourt: m.Libelle.split(' ')[0], valeur: m.Depenses }))}
              libelleAria={`Dépenses mensuelles de ${nomEntreprise(l)}`} />
          </Cadre>
          {/* la situation face à la provision est déjà affichée en tête de fiche */}
          <Constats constats={a.Constats.filter((c) => !['Provisions dépassées', 'Dépassements prévus', 'Concentration', 'Prise en charge', 'Délais de paiement'].includes(c.Titre))} max={6} />
          <Cadre titre="Familles de prestations">
            <BarresClassees lignes={a.Familles.map((f) => ({ cle: f.Famille, libelle: f.Famille, valeur: f.Depenses, valeurAffichee: `${francsCourts(f.Depenses)} - ${pct(f.Part, 0)}`, annexes: [entier(f.Actes)] }))}
              colonnes={['Actes']} />
          </Cadre>
          <Cadre titre="Par lien de parenté">
            <BarresClassees lignes={a.Profil.Statuts.map((x) => ({ cle: x.Statut, libelle: x.Libelle, detail: `${entier(x.Effectif)} couverts, recours ${pct(x.TauxRecours, 0)}`, valeur: x.Depenses, annexes: [francs(x.CoutParBeneficiaire)] }))}
              colonnes={['Coût / bénéf.']} />
          </Cadre>
          {a.Foyers.Top.length > 0 && (
            <Cadre titre="Foyers les plus consommateurs">
              <BarresClassees onChoisir={(x) => onOuvrirFiche(x.cle)} lignes={a.Foyers.Top.slice(0, 5).map((f) => ({
                cle: f.MatriculeAssure, libelle: f.Nom || `Matricule ${f.MatriculeAssure}`, detail: `${entier(f.Beneficiaires)} bénéficiaires, ${entier(f.Actes)} actes`, valeur: f.Depenses,
                annexes: [f.TauxPlafond === null || f.TauxPlafond === undefined ? '-' : pct(f.TauxPlafond, 0)],
              }))} colonnes={['Plafond utilisé']} />
            </Cadre>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => onAnalyser(l.Police)}>Analyser cette entreprise dans tous les onglets</button>
        </div>
      )}
    </Tiroir>
  );
};

// ------------------------------------------------------------------ prestations
export const OngletPrestations = ({ donnees: a }) => {
  const mois = moisAvecDonnees(a.Mensuel);
  const p = a.Prestataires;
  const d = a.Delais;
  return (
    <div className="cs-pile">
      <div className="cs-tuiles larges">
        <TuileStat libelle="Coût moyen par acte" valeur={francs(a.Synthese.CoutParActe)} serie={a.Synthese.Series.CoutParActe}
          evolution={a.Synthese.Tendance && <Evolution valeur={a.Synthese.Tendance.CoutParActe} mois={a.Synthese.Tendance.Mois} />} />
        <TuileStat libelle="Centres exécutants" valeur={entier(p.Nombre)} detail={`les 10 premiers font ${pct(p.PartTop10, 0)} des dépenses`} />
        <TuileStat libelle="Délai de paiement médian" valeur={d.Mediane === null || d.Mediane === undefined ? '-' : `${entier(d.Mediane)} jours`} detail={`9 soins sur 10 payés en ${entier(d.P90)} jours au plus`} />
        <TuileStat libelle="Paiements tardifs" valeur={entier(d.Tardifs)} detail={`plus de 90 jours après les soins, ${francsCourts(d.DepensesTardives)}`} />
      </div>

      <Carte titre="Familles de prestations" sousTitre="Dépenses, volume, coût moyen et part du montant réclamé effectivement remboursée.">
        <BarresClassees lignes={a.Familles.map((f) => ({
          cle: f.Famille, libelle: f.Famille, detail: f.PrincipauxActes.length ? `principaux actes : ${f.PrincipauxActes.map((x) => x.Acte).join(', ')}` : undefined,
          valeur: f.Depenses, valeurAffichee: `${francsCourts(f.Depenses)} - ${pct(f.Part, 0)}`,
          annexes: [entier(f.Actes), entier(f.Consommants), francs(f.CoutParActe), pct(f.TauxPriseEnCharge, 0)],
        }))} colonnes={['Actes', 'Consommants', 'Coût / acte', 'Prise en charge']} />
      </Carte>

      <Carte titre="Évolution mensuelle par famille" sousTitre="Dépenses de chaque famille par mois de clôture ; la teinte compare les mois d'une même famille." actions={<EchelleChaleur />}>
        <TableauChaleur colonnes={mois.map((m) => ({ cle: m.Cle, libelle: m.Libelle.split(' ')[0], libelleLong: m.LibelleLong }))}
          lignes={a.Familles.map((f) => ({ cle: f.Famille, libelle: f.Famille, valeurs: mois.map((_m, i) => f.Serie[i]) }))} />
      </Carte>

      <div className="cs-deux">
        <Carte titre="Actes les plus coûteux" sousTitre="Code de l'acte du gestionnaire, famille, nombre et montant médian réclamé.">
          <BarresClassees lignes={a.Actes.map((x) => ({ cle: `${x.Famille}-${x.Acte}`, libelle: x.Acte, detail: x.Famille, valeur: x.Depenses, valeurAffichee: `${francsCourts(x.Depenses)} - ${pct(x.Part, 0)}`, annexes: [entier(x.Actes), francs(x.MedianeReclame)] }))}
            colonnes={['Nombre', 'Médiane réclamée']} />
        </Carte>
        <Carte titre="Délai entre les soins et leur paiement" sousTitre="De la date de soins à la clôture du relevé qui les paie.">
          <BarresClassees format={entier} libelleValeur="Prestations" lignes={d.Tranches.map((x) => ({ cle: x.Libelle, libelle: x.Libelle, valeur: x.Actes, valeurAffichee: `${entier(x.Actes)} - ${pct(x.Part, 0)}`, annexes: [francsCourts(x.Depenses)] }))}
            colonnes={['Dépenses']} />
          <p className="cs-note">La date de réception des relevés n'est pas utilisée : elle est inversée ou postérieure à la clôture sur la plupart des lignes du gestionnaire.</p>
        </Carte>
      </div>

      <Carte titre="Centres exécutants les plus sollicités" sousTitre="Indice de coût : montant réclamé rapporté au montant médian des mêmes actes dans le portefeuille ; 100 = médiane.">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>Centre exécutant</th><th className="cs-nombre">Actes</th><th className="cs-nombre">Bénéficiaires</th><th className="cs-nombre">Dépenses</th><th className="cs-nombre">Coût / acte</th><th>Indice de coût à acte égal</th></tr>
            </thead>
            <tbody>
              {p.Centres.map((c) => (
                <tr key={c.Centre}>
                  <td style={{ fontWeight: 600 }}>{c.Centre}</td>
                  <td className="cs-nombre">{entier(c.Actes)}</td>
                  <td className="cs-nombre">{entier(c.Beneficiaires)}</td>
                  <td className="cs-nombre">{francs(c.Depenses)}<div className="cs-sous-texte">{pct(c.Part, 1)}</div></td>
                  <td className="cs-nombre">{francs(c.CoutParActe)}</td>
                  <td>{c.Indice ? <IndiceDivergent indice={c.Indice} /> : <span className="cs-muet" title="Moins de 20 actes comparables">Non calculé</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cs-note">Indice calculé sur les actes vus au moins 10 fois dans le portefeuille, pour les centres d'au moins 20 actes comparables. Au-delà de 130, le centre coûte nettement plus cher à acte égal :
          prix plus élevés ou actes plus lourds, à vérifier avec le gestionnaire.</p>
      </Carte>

      <Carte titre="Centres prescripteurs" sousTitre="Dépenses déclenchées par les prescriptions de chaque centre, exécutées chez lui ou ailleurs.">
        <BarresClassees lignes={p.Prescripteurs.map((c) => ({ cle: c.Centre, libelle: c.Centre, valeur: c.Depenses, valeurAffichee: `${francsCourts(c.Depenses)} - ${pct(c.Part, 0)}`, annexes: [entier(c.Actes), entier(c.Executants)] }))}
          colonnes={['Actes', 'Autres exécutants']} />
      </Carte>
    </div>
  );
};

// ------------------------------------------------------------------ assurés et foyers
export const OngletAssures = ({ donnees: a, onOuvrirFiche }) => {
  const s = a.Synthese;
  const f = a.Foyers;
  const tranches = a.Profil.Tranches;
  const femmes = a.Profil.Genres.find((g) => g.Genre === 'F');
  const hommes = a.Profil.Genres.find((g) => g.Genre === 'M');
  const repere = f.Pareto.find((p) => Math.abs(p.PartFoyers - 0.1) < 1e-9) || null;
  return (
    <div className="cs-pile">
      <div className="cs-tuiles larges">
        <TuileStat libelle="Bénéficiaires couverts" valeur={entier(s.Effectif)} detail={`âge moyen ${s.AgeMoyen ?? '-'} ans`} />
        <TuileStat libelle="Foyers" valeur={entier(f.Total)}
          detail={`${entier(s.Foyers)} dans l'effectif${f.Total > s.Foyers ? `, ${entier(f.Total - s.Foyers)} hors effectif mais consommateurs` : ''} ; ${entier(f.Consommateurs)} ont consommé`} />
        <TuileStat libelle="Femmes" valeur={entier(femmes?.Effectif)}
          detail={`${entier(hommes?.Effectif)} hommes ; coût par bénéficiaire ${francs(femmes?.CoutParBeneficiaire)} contre ${francs(hommes?.CoutParBeneficiaire)}`} />
        <TuileStat libelle="Consommation d'un foyer" valeur={francs(f.Mediane)} detail={`médiane ; moyenne ${francs(f.Moyenne)}`} />
        <TuileStat libelle="Plafonds annuels" valeur={entier(f.PlafondDepasse + f.PlafondAlerte)}
          detail={f.PlafondDepasse + f.PlafondAlerte ? `${entier(f.PlafondDepasse)} dépassés, ${entier(f.PlafondAlerte)} au-delà de 80 %` : 'aucun foyer au-delà de 80 % de son plafond'} />
      </div>

      <div className="cs-deux">
        <Carte titre="Pyramide des âges" sousTitre="Bénéficiaires couverts par tranche d'âge et par sexe, âges à la fin de la période.">
          <Pyramide lignes={[...tranches].reverse().map((t) => ({ cle: t.Tranche, libelle: t.Tranche, gauche: t.Hommes, droite: t.Femmes }))} libelleGauche="Hommes" libelleDroite="Femmes" />
        </Carte>
        <Carte titre="Coût par bénéficiaire selon l'âge" sousTitre="Dépenses de la tranche rapportées à ses bénéficiaires couverts.">
          <BarresClassees lignes={tranches.map((t) => ({ cle: t.Tranche, libelle: t.Tranche, detail: `${entier(t.Effectif)} couverts, recours ${pct(t.TauxRecours, 0)}`, valeur: t.CoutParBeneficiaire || 0, attenue: t.Effectif < 20, annexes: [francsCourts(t.Depenses)] }))}
            colonnes={['Dépenses']} libelleValeur="Coût par bénéficiaire" />
          <p className="cs-note">Tranches de moins de 20 bénéficiaires en gris : coût moyen peu fiable.</p>
        </Carte>
      </div>

      <div className="cs-deux">
        <Carte titre="Par lien de parenté" sousTitre="Assuré principal, conjoint et enfants.">
          <BarresClassees lignes={a.Profil.Statuts.map((x) => ({ cle: x.Statut, libelle: x.Libelle, detail: `${entier(x.Effectif)} couverts, recours ${pct(x.TauxRecours, 0)}`, valeur: x.Depenses, valeurAffichee: `${francsCourts(x.Depenses)} - ${pct(x.Part, 0)}`, annexes: [francs(x.CoutParBeneficiaire)] }))}
            colonnes={['Coût / bénéf.']} />
        </Carte>
        <Carte titre="Concentration des dépenses par foyer" sousTitre="Foyers classés du plus gros au plus petit consommateur ; la diagonale serait une répartition égale.">
          <Cadre tableau={{ entetes: ['Part des foyers', 'Part des dépenses'], lignes: f.Pareto.filter((_, i) => i % 2 === 0).map((p) => [pct(p.PartFoyers, 0), pct(p.PartDepenses, 0)]) }}>
            <CourbeConcentration points={f.Pareto} repere={repere} hauteur={230} />
          </Cadre>
        </Carte>
      </div>

      <div className="cs-deux">
        <Carte titre="Foyers par niveau de consommation" sousTitre="Nombre de foyers et part des dépenses de chaque niveau sur la période.">
          <BarresClassees format={entier} libelleValeur="Foyers" lignes={f.Tranches.map((t) => ({ cle: t.Libelle, libelle: t.Libelle, valeur: t.Foyers, valeurAffichee: `${entier(t.Foyers)} - ${pct(t.PartFoyers, 0)}`, annexes: [francsCourts(t.Depenses), pct(t.PartDepenses, 0)] }))}
            colonnes={['Dépenses', 'Part']} />
        </Carte>
        <Carte titre="Foyers les plus consommateurs" sousTitre="Cliquez un foyer pour ouvrir sa fiche : droits, prestations, plafonds et soldes.">
          <BarresClassees onChoisir={(x) => onOuvrirFiche(x.cle)} lignes={f.Top.map((x) => ({
            cle: x.MatriculeAssure, libelle: x.Nom || `Matricule ${x.MatriculeAssure}`, detail: `${x.Police} - ${entier(x.Beneficiaires)} bénéficiaires, ${entier(x.Actes)} actes`,
            valeur: x.Depenses, annexes: [x.TauxPlafond === null || x.TauxPlafond === undefined ? '-' : pct(x.TauxPlafond, 0)],
          }))} colonnes={['Plafond utilisé']} />
        </Carte>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ onglets d'analyse réunis
export const AnalyseConsommations = ({ onglet, donnees, chargement, filtres, onFiltrer, onRecharger, onOuvrirFiche }) => {
  const [fiche, setFiche] = useState(null);
  if (!donnees) {
    return <div className="glass-panel cs-carte"><p className="cs-muet"><Loader2 size={14} className="spin" aria-hidden="true" /> Calcul de l'analyse…</p></div>;
  }
  if (!donnees.Synthese.Actes && !donnees.Entreprises.length) {
    return <Carte><Vide texte="Aucune donnée sur cette période : importez les relevés du gestionnaire dans l'onglet Imports, ou élargissez les filtres." /></Carte>;
  }
  return (
    <div className={chargement ? 'cs-rechargement' : undefined}>
      {onglet === 'ensemble' && <OngletEnsemble donnees={donnees} />}
      {onglet === 'entreprises' && <OngletEntreprises donnees={donnees} onOuvrir={setFiche} />}
      {onglet === 'prestations' && <OngletPrestations donnees={donnees} />}
      {onglet === 'assures' && <OngletAssures donnees={donnees} onOuvrirFiche={onOuvrirFiche} />}
      {fiche && (
        <FicheEntreprise ligne={fiche} filtres={filtres} polices={donnees.Polices || []} onFermer={() => setFiche(null)} onLie={onRecharger}
          onAnalyser={(police) => { setFiche(null); onFiltrer((f) => ({ ...f, police })); }}
          onOuvrirFiche={(m) => { setFiche(null); onOuvrirFiche(m); }} />
      )}
    </div>
  );
};

export default AnalyseConsommations;
