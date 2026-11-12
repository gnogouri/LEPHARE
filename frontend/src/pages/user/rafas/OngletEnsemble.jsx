import React from 'react';
import { ArrowRight, CircleAlert, Info, TriangleAlert, Users, Wallet } from 'lucide-react';
import { BarresClassees, Cadre, Colonnes, Courbes, Jauge } from '../sante/consommations/graphiques';
import { Badge, Carte, Constats, Tuile, decimal, entier, francs, francsCourts, pct } from './rafasCommun';

/* Vue d'ensemble de la période : consommation et enveloppe des sinistres, indicateurs clés, constats, mois comparés à l'année précédente,
   familles de prestation, zones de concentration, fonds du régime et contrôles à traiter. */
const OngletEnsemble = ({ donnees: a, fonds, onOnglet }) => {
  const s = a.Synthese;
  const d = a.Depenses;
  const mensuel = d.Mensuel;
  const comparer = a.Comparatif?.Disponible;
  const mv = a.Effectifs.Mouvements?.length ? a.Effectifs.Mouvements[a.Effectifs.Mouvements.length - 1] : null;
  const tonJauge = (s.TauxEnveloppe || 0) > 1 ? 'critique' : (s.TauxProjete || 0) > 1 ? 'attention' : 'normal';
  const controles = a.Controles.filter((k) => k.Nombre);
  const parGravite = (g) => controles.filter((k) => k.Gravite === g);
  const etiquettes = mensuel.map((m) => ({ cle: m.Mois, libelle: m.Libelle, libelleCourt: m.LibelleCourt, libelleLong: m.Libelle }));
  return (
    <div className="cs-pile">
      <div className="cs-une">
        <Carte className="cs-heros">
          <div className="cs-heros-libelle">Dépenses remboursées de la période</div>
          <div className="cs-heros-valeur">{francsCourts(s.Depenses)}</div>
          <div className="cs-heros-detail">{`${francs(s.Depenses)} pour ${entier(s.Actes)} actes ; ${entier(s.Consommants)} bénéficiaires ont consommé`}</div>
          {s.Enveloppe ? (
            <div className={`cs-heros-provision ton-${tonJauge}`}>
              <div className="cs-heros-ligne">
                <span><strong>{pct(s.TauxEnveloppe, 0)}</strong> de l'enveloppe des sinistres de l'exercice</span>
                <span className="cs-muet">{francsCourts(s.Enveloppe)}</span>
              </div>
              <Jauge taux={s.TauxEnveloppe} projete={s.TauxProjete} repere={s.Attendu} ton={tonJauge}
                libelle={`${pct(s.TauxEnveloppe)} de l'enveloppe consommés, ${pct(s.Attendu)} de l'exercice écoulé, projection ${pct(s.TauxProjete)}`} />
              <ul className="cs-heros-cles">
                <li><span className="cs-cle cs-cle-barre" style={{ '--cs-cle': 'var(--cs-jauge)' }} aria-hidden="true" />{`Consommé sur l'exercice : ${francsCourts(s.ConsommeExercice)}`}</li>
                <li><span className="cs-cle cs-cle-barre leger" style={{ '--cs-cle': 'var(--cs-jauge)' }} aria-hidden="true" />{`Projeté à l'échéance : ${pct(s.TauxProjete, 0)}`}</li>
                <li><span className="cs-cle cs-cle-trait" aria-hidden="true" />{`Exercice écoulé : ${pct(s.Attendu, 0)}`}</li>
              </ul>
              <p className="cs-note">Enveloppe = cotisations des familles de la convention, moins les honoraires du gestionnaire et la commission du cabinet.</p>
            </div>
          ) : <p className="cs-muet">Aucun exercice ne couvre la fin de la période : l'enveloppe des sinistres n'est pas comparée.</p>}
        </Carte>
        <div className="cs-tuiles">
          <Tuile libelle="Bénéficiaires couverts" valeur={entier(s.Effectif)} icone={Users}
            detail={mv ? `${entier(mv.Nouveaux)} nouveaux, ${entier(mv.Sortis)} sortis en un an` : `${entier(s.Familles)} familles`} />
          <Tuile libelle="Familles" valeur={entier(s.Familles)} detail={`${decimal(s.Effectif / Math.max(1, s.Familles))} bénéficiaires par famille`} />
          <Tuile libelle="Recours aux soins" valeur={pct(s.TauxRecours, 1)} detail={`${entier(s.Consommants)} ont exposé des frais${s.HorsEffectif ? `, dont ${entier(s.HorsEffectif)} hors effectif` : ''}`} />
          <Tuile libelle="Coût par bénéficiaire" valeur={francs(s.CoutParBeneficiaire)} detail={`${francs(s.CoutParConsommant)} par consommant`} />
          <Tuile libelle="Coût moyen par acte" valeur={francs(s.CoutParActe)} detail={`${decimal(s.ActesParConsommant)} actes par consommant`} />
          <Tuile libelle="Prise en charge" valeur={pct(s.TauxPriseEnCharge, 0)} detail={`${francsCourts(s.PartPatient)} à la charge des patients`} />
        </div>
      </div>

      {a.Constats.length > 0 && (
        <Carte titre="À retenir" sousTitre="Lecture automatique de la période : effectif, recours, postes de dépense, comparaison et contrôles.">
          <Constats constats={a.Constats} />
        </Carte>
      )}

      <div className="cs-deux">
        <Carte titre="Dépenses par mois" sousTitre={comparer ? "Mois de clôture des relevés, comparés aux mêmes mois de l'année précédente." : 'Mois de clôture des relevés.'}>
          {comparer ? (
            <Cadre legende={[{ libelle: 'Période analysée', couleur: 'var(--cs-viz-1)', forme: 'ligne' }, { libelle: 'Un an plus tôt', couleur: 'var(--cs-viz-2)', forme: 'tirets' }]}
              tableau={{ entetes: ['Mois', 'Dépenses', 'Un an plus tôt', 'Actes', 'Actes un an plus tôt'], lignes: mensuel.map((m) => [m.Libelle, francs(m.Depenses), francs(m.DepensesRef), entier(m.Actes), entier(m.ActesRef)]) }}>
              <Courbes etiquettes={etiquettes} libelleAria="Dépenses mensuelles et mêmes mois de l'année précédente"
                series={[{ cle: 'n', libelle: 'Période analysée', valeurs: mensuel.map((m) => m.Depenses), couleur: 'var(--cs-viz-1)', style: 'plein', aire: true },
                  { cle: 'r', libelle: 'Un an plus tôt', valeurs: mensuel.map((m) => m.DepensesRef), couleur: 'var(--cs-viz-2)', style: 'tirets' }]} />
            </Cadre>
          ) : (
            <Cadre tableau={{ entetes: ['Mois', 'Dépenses', 'Actes', 'Consommants'], lignes: mensuel.map((m) => [m.Libelle, francs(m.Depenses), entier(m.Actes), entier(m.Consommants)]) }}>
              <Colonnes points={mensuel.map((m) => ({ cle: m.Mois, libelle: m.Libelle, libelleCourt: m.LibelleCourt, valeur: m.Depenses }))} libelleAria="Dépenses mensuelles" />
            </Cadre>
          )}
        </Carte>
        <Carte titre="Familles de prestation" sousTitre="Dépenses et part du total, de la plus coûteuse à la moins coûteuse.">
          <BarresClassees colonnes={['Actes', 'Coût / acte']}
            lignes={d.Familles.map((f) => ({ cle: f.Libelle, libelle: f.Libelle, valeur: f.Depenses, valeurAffichee: `${francsCourts(f.Depenses)} - ${pct(f.Part, 0)}`, annexes: [entier(f.Actes), francs(f.CoutParActe)] }))} />
        </Carte>
      </div>

      <div className="cs-deux">
        <Carte titre="Zones de concentration" sousTitre="Dépenses, taux de recours et coût par acte des bénéficiaires de chaque zone.">
          <BarresClassees colonnes={['Recours', 'Coût / acte']}
            lignes={d.Zones.map((z) => ({ cle: z.Libelle, libelle: z.Libelle, detail: `${entier(z.Effectif)} bénéficiaires`, valeur: z.Depenses,
              valeurAffichee: `${francsCourts(z.Depenses)} - ${pct(z.Part, 0)}`, annexes: [pct(z.TauxRecours, 0), francs(z.CoutParActe)] }))} />
        </Carte>
        <div className="cs-pile">
          {fonds && (
            <Carte titre="Fonds du régime" sousTitre="Exercice en cours : versements du souscripteur, dépenses remboursées et honoraires réglés."
              actions={<button type="button" className="btn btn-link rafas-lien" onClick={() => onOnglet('fonds')}>Gérer le fonds <ArrowRight size={14} /></button>}>
              <dl className="cs-chiffres-cles">
                <div><dt>Versements reçus</dt><dd>{francs(fonds.Versements)}</dd></div>
                <div><dt>Dépenses remboursées</dt><dd>{francs(fonds.Depenses)}</dd></div>
                <div><dt>Solde du fonds</dt><dd className={fonds.Solde < 0 ? 'rafas-negatif' : undefined}>{francs(fonds.Solde)}</dd></div>
                <div><dt>Rythme mensuel</dt><dd>{francs(fonds.Rythme)}</dd></div>
              </dl>
              {fonds.Alerte && <Badge ton="critique" icone={Wallet}>{`Appel de fonds conseillé : ${francs(fonds.AppelConseille)}`}</Badge>}
            </Carte>
          )}
          <Carte titre="Contrôles de la période" sousTitre="Incohérences de l'effectif et des dépenses, plafonds du barème."
            actions={<button type="button" className="btn btn-link rafas-lien" onClick={() => onOnglet('controles')}>Voir les contrôles <ArrowRight size={14} /></button>}>
            <div className="rafas-compteurs">
              <div className="ton-critique"><CircleAlert size={18} aria-hidden="true" /><strong>{entier(parGravite('critique').length)}</strong><span>à traiter en priorité</span></div>
              <div className="ton-attention"><TriangleAlert size={18} aria-hidden="true" /><strong>{entier(parGravite('attention').length)}</strong><span>à vérifier</span></div>
              <div className="ton-info"><Info size={18} aria-hidden="true" /><strong>{entier(parGravite('info').length)}</strong><span>pour information</span></div>
            </div>
            <ul className="rafas-liste-courte">
              {controles.filter((k) => k.Gravite !== 'info').slice(0, 5).map((k) => (
                <li key={k.Code}><span>{k.Titre}</span><strong>{entier(k.Nombre)}{k.Montant ? ` - ${francsCourts(k.Montant)}` : ''}</strong></li>
              ))}
            </ul>
          </Carte>
        </div>
      </div>
    </div>
  );
};

export default OngletEnsemble;
