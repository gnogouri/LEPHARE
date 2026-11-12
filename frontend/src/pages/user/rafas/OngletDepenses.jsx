import React, { useState } from 'react';
import { BarresClassees, Cadre, Colonnes, CourbeConcentration, EchelleChaleur, TableauChaleur } from '../sante/consommations/graphiques';
import { Carte, Tableau, decimal, entier, francs, francsCourts, pct } from './rafasCommun';
import { FicheFamille } from './OngletEffectif';

/* Dépenses de la période au plan de l'étude d'OREOLE : recours par collège et statut, tranches d'âge, mois, zones, localités et centres,
   affections, familles de prestation, actes, familles les plus dépensières et concentration des dépenses. */

const colonnesRecours = [
  { cle: 'Libelle', libelle: 'Statut' }, { cle: 'Consommants', libelle: 'Ayant exposé', nombre: true }, { cle: 'Actes', libelle: 'Actes', nombre: true },
  { cle: 'NonConsommants', libelle: "N'ayant pas exposé", nombre: true }, { cle: 'Effectif', libelle: 'Effectif', nombre: true },
  { cle: 'TauxRecours', libelle: 'Recours', nombre: true, rendu: (l) => pct(l.TauxRecours) }, { cle: 'Ratio', libelle: 'Actes / bénéf.', nombre: true, rendu: (l) => decimal(l.Ratio, 2) },
  { cle: 'Depenses', libelle: 'Dépenses', nombre: true, rendu: (l) => francs(l.Depenses) },
];
const colonnesCentres = (libelle) => [
  { cle: 'Libelle', libelle }, { cle: 'Localite', libelle: 'Localité' }, { cle: 'Depenses', libelle: 'Dépenses', nombre: true, rendu: (l) => francs(l.Depenses) },
  { cle: 'Part', libelle: '%', nombre: true, rendu: (l) => pct(l.Part) }, { cle: 'Actes', libelle: 'Actes', nombre: true },
  { cle: 'CoutParActe', libelle: 'Coût / acte', nombre: true, rendu: (l) => francs(l.CoutParActe) },
];
const barres = (lignes, avecActes = true) => lignes.map((l) => ({
  cle: l.Libelle, libelle: l.Libelle, detail: l.Localite || undefined, valeur: l.Depenses, valeurAffichee: `${francsCourts(l.Depenses)} - ${pct(l.Part, 0)}`,
  annexes: avecActes ? [entier(l.Actes), francs(l.CoutParActe)] : [],
}));

const OngletDepenses = ({ id, donnees: a }) => {
  const d = a.Depenses;
  const s = a.Synthese;
  const [famille, setFamille] = useState(null);
  const mois = a.Periode.Mois;
  const colonnesMois = mois.map((m) => ({ cle: m.Mois, libelle: m.LibelleCourt, libelleLong: m.Libelle }));
  const statuts = ['Assuré', 'Conjoint(e)', 'Enfant'];
  const fs = d.FamillesSeuil;
  const repere = d.Concentration.find((p) => p.PartFoyers >= 0.1) || d.Concentration[0];
  return (
    <div className="cs-pile">
      <Carte titre="Bénéficiaires ayant exposé des frais" sousTitre={`Sur ${entier(d.RecoursTotal.Effectif)} bénéficiaires, ${entier(d.RecoursTotal.Consommants)} ont exposé des frais : taux de recours ${pct(d.RecoursTotal.TauxRecours)}, ${decimal(s.ActesParConsommant)} actes par consommant.`}>
        {d.Recours.map((bloc) => (
          <div key={bloc.Code || bloc.College} className="rafas-bloc">
            <h3 className="rafas-sous-titre">{bloc.College}</h3>
            <Tableau compact colonnes={colonnesRecours} lignes={bloc.Lignes} pied={bloc.Total} />
          </div>
        ))}
      </Carte>

      <div className="cs-deux">
        <Carte titre="Dépenses par statut" sousTitre="Part de l'effectif, des consommants et des dépenses.">
          <Tableau compact colonnes={[
            { cle: 'Libelle', libelle: 'Statut' }, { cle: 'PartEffectif', libelle: "% de l'effectif", nombre: true, rendu: (l) => pct(l.PartEffectif) },
            { cle: 'Consommants', libelle: 'Ayant exposé', nombre: true }, { cle: 'Depenses', libelle: 'Dépenses', nombre: true, rendu: (l) => francs(l.Depenses) },
            { cle: 'Part', libelle: '% des dépenses', nombre: true, rendu: (l) => pct(l.Part) }, { cle: 'Actes', libelle: 'Actes', nombre: true },
            { cle: 'CoutParActe', libelle: 'Coût / acte', nombre: true, rendu: (l) => francs(l.CoutParActe) },
          ]} lignes={d.ParStatut} />
        </Carte>
        <Carte titre="Dépenses par tranche d'âge" sousTitre={`Âge au ${a.Periode.AgeAu} ; taux de recours et coût moyen par acte.`}>
          <BarresClassees colonnes={['Recours', 'Coût / acte']}
            lignes={d.Tranches.filter((t) => t.Actes).map((t) => ({ cle: t.Libelle, libelle: t.Libelle, detail: `${entier(t.Effectif)} bénéficiaires`, valeur: t.Depenses,
              valeurAffichee: `${francsCourts(t.Depenses)} - ${pct(t.Part, 0)}`, annexes: [pct(t.TauxRecours, 0), francs(t.CoutParActe)] }))} />
        </Carte>
      </div>

      <div className="cs-deux">
        <Carte titre="Dépenses par mois" sousTitre="Par mois de clôture des relevés.">
          <Cadre tableau={{ entetes: ['Mois', ...a.Colleges.filter((c) => d.Mensuel.some((m) => m.ParCollege[c.Code])).map((c) => c.Libelle), 'Total', 'Actes'],
            lignes: d.Mensuel.map((m) => [m.Libelle, ...a.Colleges.filter((c) => d.Mensuel.some((x) => x.ParCollege[c.Code])).map((c) => francs(m.ParCollege[c.Code])), francs(m.Depenses), entier(m.Actes)]) }}>
            <Colonnes points={d.Mensuel.map((m) => ({ cle: m.Mois, libelle: m.Libelle, libelleCourt: m.LibelleCourt, valeur: m.Depenses }))} libelleAria="Dépenses par mois de clôture"
              lignesBulle={(p) => { const m = d.Mensuel.find((x) => x.Mois === p.cle); return [{ libelle: 'dépenses', valeur: francs(m.Depenses), couleur: 'var(--cs-viz-1)' }, { libelle: 'actes', valeur: entier(m.Actes) }, { libelle: 'consommants', valeur: entier(m.Consommants) }]; }} />
          </Cadre>
        </Carte>
        <Carte titre="Concentration des dépenses" sousTitre={repere ? `${pct(repere.PartFoyers, 0)} des ${entier(d.Foyers)} familles ayant consommé font ${pct(repere.PartDepenses, 0)} des dépenses.` : ''}>
          <CourbeConcentration points={[{ PartFoyers: 0, PartDepenses: 0 }, ...d.Concentration]} repere={repere} libelleX="familles" />
        </Carte>
      </div>

      <Carte titre="Zones de concentration, mois par mois" sousTitre="Intensité rapportée au mois le plus élevé de chaque zone.">
        <Tableau compact colonnes={[
          { cle: 'Libelle', libelle: 'Zone' }, { cle: 'Consommants', libelle: 'Ayant exposé', nombre: true }, { cle: 'Effectif', libelle: 'Effectif', nombre: true },
          { cle: 'TauxRecours', libelle: 'Recours', nombre: true, rendu: (l) => pct(l.TauxRecours) }, { cle: 'Actes', libelle: 'Actes', nombre: true },
          { cle: 'Depenses', libelle: 'Dépenses', nombre: true, rendu: (l) => francs(l.Depenses) }, { cle: 'Part', libelle: '%', nombre: true, rendu: (l) => pct(l.Part) },
          { cle: 'CoutParActe', libelle: 'Coût / acte', nombre: true, rendu: (l) => francs(l.CoutParActe) },
        ]} lignes={d.Zones} />
        <TableauChaleur colonnes={colonnesMois} libelleLigne="Zone" lignes={d.Zones.map((z) => ({ cle: z.Libelle, libelle: z.Libelle, valeurs: z.Mensuel }))} />
        <EchelleChaleur />
      </Carte>

      <div className="cs-deux">
        <Carte titre="Localités des centres prescripteurs" sousTitre="Dix premières localités.">
          <BarresClassees colonnes={['Actes', 'Coût / acte']} lignes={barres(d.LocalitesPrescripteurs.slice(0, 10))} />
        </Carte>
        <Carte titre="Localités des centres exécutants" sousTitre="Dix premières localités.">
          <BarresClassees colonnes={['Actes', 'Coût / acte']} lignes={barres(d.LocalitesExecutants.slice(0, 10))} />
        </Carte>
      </div>
      <div className="cs-deux">
        <Carte titre="20 premiers centres prescripteurs"><Tableau compact max={10} colonnes={colonnesCentres('Centre prescripteur')} lignes={d.Prescripteurs} /></Carte>
        <Carte titre="20 premiers centres exécutants"><Tableau compact max={10} colonnes={colonnesCentres('Centre exécutant')} lignes={d.Executants} /></Carte>
      </div>

      <div className="cs-deux">
        <Carte titre="Affections" sousTitre="Dépenses par type d'affection et par statut.">
          <Tableau compact max={10} colonnes={[
            { cle: 'Affection', libelle: 'Affection' },
            ...statuts.map((st) => ({ cle: st, libelle: st, nombre: true, rendu: (l) => francs(l[st].Depenses) })),
            { cle: 'Total', libelle: 'Total', nombre: true, rendu: (l) => francs(l.Total.Depenses) },
            { cle: 'Actes', libelle: 'Actes', nombre: true, rendu: (l) => entier(l.Total.Actes) },
          ]} lignes={d.AffectionStatut} />
        </Carte>
        <Carte titre="Les 20 actes les plus remboursés">
          <BarresClassees colonnes={['Actes', 'Coût / acte']} lignes={barres(d.Actes)} />
        </Carte>
      </div>

      <Carte titre="Familles de prestation, mois par mois" sousTitre="Dépenses de chaque famille de prestation ; intensité rapportée au mois le plus élevé de la ligne.">
        <TableauChaleur colonnes={colonnesMois} lignes={d.FamillesMois.map((f) => ({ cle: f.Famille, libelle: f.Famille, valeurs: f.Valeurs }))} />
        <EchelleChaleur />
      </Carte>

      <div className="cs-deux">
        <Carte titre="Les 5 familles les plus dépensières" sousTitre="Cliquez une famille pour ouvrir sa fiche.">
          <Tableau compact cle={(f) => f.Matricule} onLigne={(f) => setFamille(f.Matricule)} colonnes={[
            { cle: 'Assure', libelle: 'Assuré principal' }, { cle: 'Matricule', libelle: 'Matricule', rendu: (f) => String(f.Matricule) },
            { cle: 'Patients', libelle: 'Patients', nombre: true, rendu: (f) => entier(new Set(f.Lignes.map((l) => l.Patient)).size) },
            { cle: 'Actes', libelle: 'Actes', nombre: true }, { cle: 'Depenses', libelle: 'Dépenses', nombre: true, rendu: (f) => francs(f.Depenses) },
          ]} lignes={d.TopFamilles} />
        </Carte>
        <Carte titre={`Familles au-delà de ${francs(fs.Seuil)} (${fs.Familles.length})`} sousTitre={fs.Familles.length ? `${francs(fs.Depenses)}, soit ${pct(fs.Part)} des dépenses pour ${pct(fs.PartActes)} des actes ; coût moyen par acte ${francs(fs.CoutParActe)}.` : 'Aucune famille au-delà du seuil.'}>
          <Tableau compact max={10} cle={(f) => f.Matricule} onLigne={(f) => setFamille(f.Matricule)} colonnes={[
            { cle: 'Assure', libelle: 'Assuré principal' }, { cle: 'Depenses', libelle: 'Dépenses', nombre: true, rendu: (f) => francs(f.Depenses) },
            { cle: 'Part', libelle: '%', nombre: true, rendu: (f) => pct(f.Part) }, { cle: 'Actes', libelle: 'Actes', nombre: true },
            { cle: 'CoutParActe', libelle: 'Coût / acte', nombre: true, rendu: (f) => francs(f.CoutParActe) },
          ]} lignes={fs.Familles} />
        </Carte>
      </div>
      <FicheFamille id={id} matricule={famille} onFermer={() => setFamille(null)} />
    </div>
  );
};

export default OngletDepenses;
