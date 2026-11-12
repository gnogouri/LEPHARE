import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, Users } from 'lucide-react';
import { rafasApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { messageErreurApi } from '../../../utils/financeUtils';
import { BarresClassees, Jauge, Pyramide } from '../sante/consommations/graphiques';
import { Carte, Tableau, Tiroir, Tuile, dateFr, entier, francs, francsCourts, pct } from './rafasCommun';

/* Effectif de la période (effectif du gestionnaire retenu pour la fin de période) : mouvements sur un an, âges, statuts, zones de
   concentration ; liste des bénéficiaires et fiche de chaque famille (consommation de l'exercice face au plafond annuel). */

export const FicheFamille = ({ id, matricule, onFermer }) => {
  const { error: toastError } = useToast();
  const [f, setF] = useState(null);
  useEffect(() => {
    setF(null);
    if (!matricule) return;
    rafasApi.famille(id, matricule).then(setF).catch((err) => toastError(messageErreurApi(err)));
  }, [id, matricule, toastError]);
  const ton = f?.Taux > 1 ? 'critique' : f?.Taux >= 0.8 ? 'attention' : 'normal';
  return (
    <Tiroir ouvert={Boolean(matricule)} onFermer={onFermer} icone={Users} titre={f ? f.Adherent || `Famille ${matricule}` : 'Famille'}
      sousTitre={f ? `Matricule adhérent ${matricule} - ${f.College} - exercice du ${dateFr(f.Exercice.Du)} au ${dateFr(f.Exercice.Au).slice(3)}` : 'Chargement…'}>
      {!f ? <div className="rafas-chargement"><Loader2 size={20} className="spin" /> Chargement…</div> : (
        <>
          <div className="cs-tiroir-bloc">
            <h3>Plafond annuel de la famille</h3>
            <div className="cs-heros-ligne"><span><strong>{francs(f.Consomme)}</strong> remboursés sur l'exercice</span><span className="cs-muet">{f.Plafond ? `plafond ${francs(f.Plafond)}` : 'plafond non fixé'}</span></div>
            {f.Plafond && <Jauge taux={f.Taux} ton={ton} libelle={`${pct(f.Taux)} du plafond annuel consommé`} />}
          </div>
          <div className="cs-tiroir-bloc">
            <h3>{`Membres de la famille (${f.Membres.length})`}</h3>
            <Tableau compact vide="Famille absente du dernier effectif du gestionnaire." colonnes={[
              { cle: 'Nom', libelle: 'Bénéficiaire' }, { cle: 'Statut', libelle: 'Statut' }, { cle: 'Age', libelle: 'Âge', nombre: true },
              { cle: 'Entree', libelle: 'Entrée', rendu: (m) => dateFr(m.Entree) }, { cle: 'Actes', libelle: 'Actes', nombre: true },
              { cle: 'Depenses', libelle: 'Remboursé', nombre: true, rendu: (m) => francs(m.Depenses) },
            ]} lignes={f.Membres} />
          </div>
          {f.Familles.length > 0 && (
            <div className="cs-tiroir-bloc">
              <h3>Par famille de prestation</h3>
              <BarresClassees lignes={f.Familles.map((x) => ({ cle: x.Famille, libelle: x.Famille || 'Non renseignée', valeur: x.Depenses, annexes: [entier(x.Actes)] }))} colonnes={['Actes']} />
            </div>
          )}
          <div className="cs-tiroir-bloc">
            <h3>{`Prestations de l'exercice (${f.Prestations.length}${f.Prestations.length === 200 ? ' dernières' : ''})`}</h3>
            <Tableau compact max={25} colonnes={[
              { cle: 'Date', libelle: 'Soins', rendu: (p) => dateFr(p.Date) }, { cle: 'Patient', libelle: 'Patient' }, { cle: 'Acte', libelle: 'Acte' },
              { cle: 'Centre', libelle: 'Centre exécutant' }, { cle: 'Rembourse', libelle: 'Remboursé', nombre: true, rendu: (p) => francs(p.Rembourse) },
            ]} lignes={f.Prestations} />
          </div>
        </>
      )}
    </Tiroir>
  );
};

const ListeBeneficiaires = ({ id, donnees, onFamille }) => {
  const { error: toastError } = useToast();
  const [filtres, setFiltres] = useState({ q: '', college: '', lien: '', zone: '', page: 1 });
  const [saisie, setSaisie] = useState('');
  const [liste, setListe] = useState(null);
  const situation = donnees.Situation?.IdImport;
  useEffect(() => {
    const minuterie = setTimeout(() => setFiltres((f) => (f.q === saisie ? f : { ...f, q: saisie, page: 1 })), 300);
    return () => clearTimeout(minuterie);
  }, [saisie]);
  useEffect(() => {
    let annule = false;
    rafasApi.effectif(id, { ...filtres, situation }).then((r) => { if (!annule) setListe(r); }).catch((err) => toastError(messageErreurApi(err)));
    return () => { annule = true; };
  }, [id, filtres, situation, toastError]);
  const pages = liste ? Math.max(1, Math.ceil(liste.Total / liste.Taille)) : 1;
  const champ = (cle) => (e) => setFiltres((f) => ({ ...f, [cle]: e.target.value, page: 1 }));
  return (
    <Carte titre="Bénéficiaires" sousTitre={liste ? `${entier(liste.Total)} bénéficiaires dans l'effectif du ${dateFr(liste.Situation)} ; cliquez une ligne pour ouvrir la fiche de la famille.` : ''}>
      <div className="rafas-filtres-liste">
        <label className="rafas-recherche"><Search size={15} aria-hidden="true" /><input className="form-control" placeholder="Nom, adhérent ou matricule" value={saisie} onChange={(e) => setSaisie(e.target.value)} aria-label="Rechercher un bénéficiaire" /></label>
        <select className="form-control" value={filtres.college} onChange={champ('college')} aria-label="Collège">
          <option value="">Tous les collèges</option>
          {donnees.Colleges.map((c) => <option key={c.Code} value={c.Code}>{c.Libelle}</option>)}
        </select>
        <select className="form-control" value={filtres.lien} onChange={champ('lien')} aria-label="Statut">
          <option value="">Tous les statuts</option><option value="A">Assurés</option><option value="C">Conjoint(e)s</option><option value="E">Enfants</option>
        </select>
        <select className="form-control" value={filtres.zone} onChange={champ('zone')} aria-label="Zone">
          <option value="">Toutes les zones</option>
          {(liste?.Zones || []).map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </div>
      {!liste ? <div className="rafas-chargement"><Loader2 size={20} className="spin" /></div> : (
        <>
          <Tableau compact cle={(b) => b.Matricule} onLigne={(b) => onFamille(b.MatriculeAdherent || Math.floor(b.Matricule / 100))} vide="Aucun bénéficiaire ne correspond." colonnes={[
            { cle: 'Matricule', libelle: 'Matricule', rendu: (b) => String(b.Matricule) }, { cle: 'Nom', libelle: 'Bénéficiaire' }, { cle: 'Statut', libelle: 'Statut' },
            { cle: 'Sexe', libelle: 'Sexe' }, { cle: 'Age', libelle: 'Âge', nombre: true }, { cle: 'College', libelle: 'Collège' }, { cle: 'Zone', libelle: 'Zone' },
            { cle: 'Entree', libelle: 'Entrée', rendu: (b) => dateFr(b.Entree) }, { cle: 'Sortie', libelle: 'Sortie', rendu: (b) => (b.Sortie ? dateFr(b.Sortie) : '') },
          ]} lignes={liste.Lignes} />
          <div className="rafas-pagination">
            <button type="button" className="rafas-icone-bouton" disabled={filtres.page <= 1} onClick={() => setFiltres((f) => ({ ...f, page: f.page - 1 }))} aria-label="Page précédente"><ChevronLeft size={16} /></button>
            <span>{`Page ${filtres.page} sur ${pages}`}</span>
            <button type="button" className="rafas-icone-bouton" disabled={filtres.page >= pages} onClick={() => setFiltres((f) => ({ ...f, page: f.page + 1 }))} aria-label="Page suivante"><ChevronRight size={16} /></button>
          </div>
        </>
      )}
    </Carte>
  );
};

const OngletEffectif = ({ id, donnees: a }) => {
  const e = a.Effectifs;
  const [famille, setFamille] = useState(null);
  const total = e.Mouvements.length ? e.Mouvements[e.Mouvements.length - 1] : null;
  const categories = e.Categories;
  return (
    <div className="cs-pile">
      <div className="cs-tuiles larges">
        <Tuile libelle="Bénéficiaires" valeur={entier(e.Total)} detail={`Effectif du ${dateFr(a.Situation?.Date)}`} />
        <Tuile libelle="Familles" valeur={entier(a.Synthese.Familles)} />
        {total && <Tuile libelle="Nouveaux en un an" valeur={entier(total.Nouveaux)} detail={`Taux d'adhésion ${pct(total.TauxAdhesion)}`} />}
        {total && <Tuile libelle="Sortis en un an" valeur={entier(total.Sortis)} detail={`Taux de sortie ${pct(total.TauxSortie)}`} />}
        {total && <Tuile libelle="Présents les deux années" valeur={entier(total.Presents)} detail={`Taux de maintien ${pct(total.TauxMaintien)}`} />}
      </div>
      {total ? (
        <Carte titre="Effectif consolidé par collège" sousTitre={`Comparé à l'effectif du ${dateFr(a.Reference?.Date)} : présents les deux années, nouveaux et sortis.`}>
          <Tableau colonnes={[
            { cle: 'Libelle', libelle: 'Collège' }, { cle: 'Presents', libelle: 'Présents les deux années', nombre: true }, { cle: 'TotalRef', libelle: 'Total un an plus tôt', nombre: true },
            { cle: 'Nouveaux', libelle: 'Nouveaux', nombre: true }, { cle: 'Sortis', libelle: 'Sortis', nombre: true }, { cle: 'Total', libelle: 'Total à date', nombre: true },
            { cle: 'TauxMaintien', libelle: 'Maintien', nombre: true, rendu: (l) => pct(l.TauxMaintien) }, { cle: 'TauxSortie', libelle: 'Sortie', nombre: true, rendu: (l) => pct(l.TauxSortie) },
            { cle: 'TauxAdhesion', libelle: 'Adhésion', nombre: true, rendu: (l) => pct(l.TauxAdhesion) },
          ]} lignes={e.Mouvements.slice(0, -1)} pied={total} />
        </Carte>
      ) : (
        <Carte titre="Effectif par collège" sousTitre="Importez l'effectif de l'année précédente pour compter les nouveaux et les sortis.">
          <Tableau colonnes={[{ cle: 'Libelle', libelle: 'Collège' }, { cle: 'F', libelle: 'Femmes', nombre: true }, { cle: 'M', libelle: 'Hommes', nombre: true },
            { cle: 'Total', libelle: 'Total', nombre: true }, { cle: 'Part', libelle: '%', nombre: true, rendu: (l) => pct(l.Part) }]} lignes={e.ParCollege.slice(0, -1)} pied={e.ParCollege[e.ParCollege.length - 1]} />
        </Carte>
      )}
      <div className="cs-deux">
        <Carte titre="Pyramide des âges" sousTitre={`Âge au ${a.Periode.AgeAu}, femmes et hommes.`}>
          <Pyramide libelleGauche="Femmes" libelleDroite="Hommes"
            lignes={[...e.ParTranche].reverse().map((t) => ({ cle: t.Tranche, libelle: t.Tranche, gauche: categories.reduce((s, c) => s + (t[c]?.F || 0), 0), droite: categories.reduce((s, c) => s + (t[c]?.M || 0), 0) }))} />
        </Carte>
        <Carte titre="Zones de concentration" sousTitre="Bénéficiaires par zone et par catégorie de collège.">
          <BarresClassees format={entier} libelleValeur="Bénéficiaires" colonnes={categories}
            lignes={e.ParZone.map((z) => ({ cle: z.Zone, libelle: z.Zone, valeur: z.Total, valeurAffichee: `${entier(z.Total)} - ${pct(z.Part, 0)}`, annexes: categories.map((c) => entier(z[c]?.Total)) }))} />
        </Carte>
      </div>
      {e.ParStatut.length > 0 && (
        <Carte titre="Statuts et genres" sousTitre={a.Reference ? "Effectif retenu et effectif de l'année précédente." : 'Effectif retenu.'}>
          <Tableau compact colonnes={[
            { cle: 'Statut', libelle: 'Statut' }, { cle: 'Genre', libelle: 'Genre', rendu: (l) => ({ F: 'Femmes', M: 'Hommes' }[l.Genre] || 'Total') },
            ...(a.Reference ? [{ cle: 'Ref', libelle: 'Un an plus tôt', nombre: true }] : []), { cle: 'Nombre', libelle: 'À date', nombre: true },
            { cle: 'Part', libelle: '%', nombre: true, rendu: (l) => pct(l.Part) },
            ...(a.Reference ? [{ cle: 'Ecart', libelle: 'Écart', nombre: true }, { cle: 'Evolution', libelle: 'Évolution', nombre: true, rendu: (l) => pct(l.Evolution) }] : []),
          ]} lignes={e.ParStatut} />
        </Carte>
      )}
      <ListeBeneficiaires id={id} donnees={a} onFamille={setFamille} />
      <FicheFamille id={id} matricule={famille} onFermer={() => setFamille(null)} />
      <p className="cs-note">{`Coût moyen par bénéficiaire sur la période : ${francsCourts(a.Synthese.CoutParBeneficiaire)}.`}</p>
    </div>
  );
};

export default OngletEffectif;
