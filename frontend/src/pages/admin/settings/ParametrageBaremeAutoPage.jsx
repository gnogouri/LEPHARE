import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calculator, Table2, SlidersHorizontal, Grid3x3, Search, Save, Loader2, RotateCcw } from 'lucide-react';
import { EnTeteParametrage, SectionParametrage } from '../../../components/admin/EnTeteParametrage';
import { LigneParametre } from '../../../components/admin/LigneParametre';
import { TableBareme } from '../../../components/admin/TableBareme';
import { AmountInput } from '../../../components/common/AmountInput';
import { parametrageApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { useToast } from '../../../context/ToastContext';

// Tarif Automobile de chaque compagnie (demande du 2026-10-24 : « les tarifs pour tous les produits doivent être
// paramétrables depuis l'admin ») :
// - Barème par catégorie (stdtarifdetail) : primes RC par puissance et énergie, CEDEAO, recours, taux des dommages,
//   du bris de glace, de l'incendie et du vol, primes minimums… lus par le moteur (fn_garantie_offre_cat*) ;
// - Montants du moteur (auto.moteur.<compagnie>.<groupe>.<code>, fn_lephare_auto_constante) : montants et taux écrits
//   jusqu'ici dans les fonctions du moteur, dont la grille vol et incendie par tranche de valeur de la catégorie 3.

const normaliser = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const francs = (v) => `${Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`;
const estAuto = (t) => String(t.code || '').startsWith('2');

const COLONNES_BAREME = [
  { champ: 'IdTarif', titre: 'Catégorie tarifaire', type: 'tarif', requis: true, filtre: true, options: estAuto },
  { champ: 'IdGarantie', titre: 'Garantie', type: 'sousgarantie', requis: true, filtre: true },
  { champ: 'PuissanceMin', titre: 'Puissance de', type: 'entier', requis: true, min: 0, aide: 'Chevaux fiscaux.' },
  { champ: 'PuissanceMax', titre: 'Puissance à', type: 'entier', requis: true, min: 0 },
  { champ: 'CodeCarburant', titre: 'Énergie', type: 'entier', requis: true, min: 0, aide: '1 essence, 2 diesel ; RC des catégories 202 et 203 : 3 pour toutes les énergies.' },
  { champ: 'Taux', titre: 'Taux', type: 'nombre', requis: true, min: 0, aide: 'Pour mille de la valeur garantie (valeur neuve, vénale ou des accessoires) ; NSIA Auto + : pour cent de la valeur vénale.' },
  { champ: 'PrimeMin', titre: 'Prime minimum', type: 'montant', requis: true, min: 0 },
  { champ: 'PrimeGar', titre: 'Prime forfaitaire', type: 'montant', requis: true, min: 0, aide: 'RC, CEDEAO, recours : prime annuelle de la ligne.' },
  { champ: 'TonnageMin', titre: 'Charge utile de', type: 'entier', requis: true, min: 0, masquee: true, aide: 'Kilogrammes.' },
  { champ: 'TonnageMax', titre: 'Charge utile à', type: 'entier', requis: true, min: 0, masquee: true },
  { champ: 'CapitalMin', titre: 'Valeur de', type: 'montant', requis: true, min: 0, masquee: true },
  { champ: 'CapitalMax', titre: 'Valeur à', type: 'montant', requis: true, min: 0, masquee: true },
  { champ: 'NombrePlacesMin', titre: 'Places de', type: 'entier', requis: true, min: 0, masquee: true },
  { champ: 'NombrePlacesMax', titre: 'Places à', type: 'entier', requis: true, min: 0, masquee: true },
  { champ: 'AgeVehiculeMin', titre: 'Âge du véhicule de', type: 'entier', requis: true, min: 0, masquee: true },
  { champ: 'AgeVehiculeMax', titre: 'Âge du véhicule à', type: 'entier', requis: true, min: 0, masquee: true },
  { champ: 'AgeConducteurMin', titre: 'Âge du conducteur de', type: 'entier', requis: true, min: 0, masquee: true },
  { champ: 'AgeConducteurMax', titre: 'Âge du conducteur à', type: 'entier', requis: true, min: 0, masquee: true },
  { champ: 'PlacesGrat', titre: 'Places gratuites', type: 'entier', requis: true, min: 0, masquee: true },
  { champ: 'PrimePlace', titre: 'Prime par place', type: 'montant', requis: true, min: 0, masquee: true },
  { champ: 'Deces', titre: 'Capital décès', type: 'montant', requis: true, min: 0, masquee: true },
  { champ: 'Ipp', titre: 'Capital invalidité', type: 'montant', requis: true, min: 0, masquee: true },
  { champ: 'FraisMed', titre: 'Frais médicaux', type: 'montant', requis: true, min: 0, masquee: true },
  { champ: 'FranchiseMin', titre: 'Franchise de', type: 'montant', requis: true, min: 0, masquee: true },
  { champ: 'FranchiseMax', titre: 'Franchise à', type: 'montant', requis: true, min: 0, masquee: true },
  { champ: 'FranchiseMinimale', titre: 'Franchise minimale', type: 'montant', requis: true, min: 0, masquee: true },
  { champ: 'MinProrata', titre: 'Minimum au prorata', type: 'montant', requis: true, min: 0, masquee: true },
];
const DEFAUTS_BAREME = {
  PuissanceMin: 0, PuissanceMax: 30000, CodeCarburant: 1, Taux: 0, PrimeMin: 0, PrimeGar: 0, TonnageMin: 0, TonnageMax: 30000,
  CapitalMin: 0, CapitalMax: 9999999999, NombrePlacesMin: 0, NombrePlacesMax: 30000, AgeVehiculeMin: 0, AgeVehiculeMax: 30000,
  AgeConducteurMin: 0, AgeConducteurMax: 30000, PlacesGrat: 0, PrimePlace: 0, Deces: 0, Ipp: 0, FraisMed: 0,
  FranchiseMin: 0, FranchiseMax: 999999999, FranchiseMinimale: 0, MinProrata: 0,
};
const controleBareme = (l) => {
  const paires = [['PuissanceMin', 'PuissanceMax', 'puissance'], ['TonnageMin', 'TonnageMax', 'charge utile'], ['CapitalMin', 'CapitalMax', 'valeur'],
    ['NombrePlacesMin', 'NombrePlacesMax', 'places'], ['AgeVehiculeMin', 'AgeVehiculeMax', 'âge du véhicule'], ['FranchiseMin', 'FranchiseMax', 'franchise']];
  const fausse = paires.find(([a, b]) => Number(l[a]) > Number(l[b]));
  return fausse ? `La ${fausse[2]} « de » doit être inférieure ou égale à la ${fausse[2]} « à ».` : null;
};

// ------------------------------------------------------------------ grille vol et incendie (catégorie 3)
const COLONNES_GRILLE = [
  ['10', 'neuf', 'Incendie, récent'], ['10', 'ancien', 'Incendie, ancien'],
  ['12', 'neuf', 'Vol, récent'], ['12', 'ancien', 'Vol, ancien'],
  ['13', 'neuf', 'Vol à mains armées, récent'], ['13', 'ancien', 'Vol à mains armées, ancien'],
];

const GrilleVolIncendie = ({ parametres, onEnregistre }) => {
  const { success, error: toastError } = useToast();
  const parCode = useMemo(() => Object.fromEntries(parametres.map((p) => [p.Code, p])), [parametres]);
  const [saisie, setSaisie] = useState({});
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => setSaisie(Object.fromEntries(parametres.map((p) => [p.Code, p.Valeur]))), [parametres]);
  const modifies = parametres.filter((p) => String(saisie[p.Code] ?? '') !== String(p.Valeur ?? ''));
  const differents = parametres.filter((p) => String(p.Valeur ?? '') !== String(p.ValeurOrigine ?? ''));
  const borne = (n) => (n === 1 ? 0 : Number(saisie[`tranche_${n}`]) || 0);

  const envoyer = async (retour) => {
    setEnvoi(true);
    try {
      const liste = retour ? differents : modifies;
      for (const p of liste) {
        // eslint-disable-next-line no-await-in-loop
        const maj = retour ? await parametrageApi.retablirMoteurAuto(p.Cle) : await parametrageApi.modifierMoteurAuto(p.Cle, saisie[p.Code]);
        onEnregistre(maj);
      }
      success(retour ? 'Grille vol et incendie : valeurs d\'origine rétablies.' : `Grille vol et incendie : ${liste.length} montant${liste.length > 1 ? 's' : ''} enregistré${liste.length > 1 ? 's' : ''}.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  const cellule = (code) => parCode[code] && (
    <div>
      <AmountInput value={saisie[code] === '' || !Number.isFinite(Number(saisie[code])) ? '' : Math.round(Number(saisie[code]))}
        onChange={(n) => setSaisie((s) => ({ ...s, [code]: String(n) }))} suffix="F" />
      {String(parCode[code].Valeur) !== String(parCode[code].ValeurOrigine) && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>Origine : {francs(parCode[code].ValeurOrigine)}</div>
      )}
    </div>
  );

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', margin: '0.4rem 0' }}>Vol et incendie par tranche de valeur vénale</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
        Prime annuelle selon la tranche de la valeur vénale ; « récent » : véhicule qui n'a pas dépassé l'âge réglé juste au-dessus.
        Le début de chaque tranche se modifie dans la première colonne.
      </div>
      <div className="table-wrapper" style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th>Tranche (valeur vénale)</th>
              {COLONNES_GRILLE.map(([, , titre]) => <th key={titre}>{titre}</th>)}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5].map((n) => (
              <tr key={n}>
                <td style={{ minWidth: 190 }}>
                  {n === 1 ? <span>Dès 0 F</span> : (
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>À partir de</span>
                      {cellule(`tranche_${n}`)}
                    </div>
                  )}
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {n < 5 ? `jusqu'à ${francs(borne(n + 1) - 1)}` : 'et au-delà'}
                  </div>
                </td>
                {COLONNES_GRILLE.map(([sg, etat]) => <td key={`${sg}${etat}`}>{cellule(`grille_${sg}_${etat}_${n}`)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.7rem' }}>
        {differents.length > 0 && (
          <button type="button" className="btn btn-secondary" disabled={envoi} onClick={() => envoyer(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <RotateCcw size={14} /> Rétablir la grille d'origine
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={!modifies.length || envoi} onClick={() => envoyer(false)} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer la grille{modifies.length ? ` (${modifies.length})` : ''}
        </button>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ montants du moteur
const estGrille = (code) => /^(tranche_\d|grille_)/.test(code);

const MontantsMoteur = () => {
  const { error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [compagnie, setCompagnie] = useState(null);
  const [recherche, setRecherche] = useState('');
  useEffect(() => {
    parametrageApi.getMoteurAuto()
      .then((d) => { setDonnees(d); setCompagnie(d.Compagnies[0]?.IdCompagnie ?? null); })
      .catch((err) => toastError(`Montants du moteur non chargés : ${messageErreurApi(err)}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!donnees) return <div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Chargement…</div>;
  const remplacer = (maj) => setDonnees((d) => ({ ...d, Parametres: d.Parametres.map((p) => (p.Cle === maj.Cle ? maj : p)) }));
  const terme = normaliser(recherche.trim());
  const deLaCompagnie = donnees.Parametres.filter((p) => p.IdCompagnie === compagnie);
  const modifies = deLaCompagnie.filter((p) => String(p.Valeur) !== String(p.ValeurOrigine)).length;

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {donnees.Compagnies.map((c) => (
            <button key={c.IdCompagnie} type="button" onClick={() => setCompagnie(c.IdCompagnie)}
              className={`btn ${compagnie === c.IdCompagnie ? 'btn-primary' : 'btn-secondary'}`}>{c.Nom}</button>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
          <label className="form-label" htmlFor="recherche-moteur">Rechercher</label>
          <Search size={14} style={{ position: 'absolute', left: 10, bottom: 10, color: 'var(--text-muted)' }} />
          <input id="recherche-moteur" className="form-control" style={{ paddingLeft: '1.9rem' }} placeholder="FGA, remorque, vol, franchise…"
            value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </div>
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 0 }}>
        {deLaCompagnie.length} montants et taux pour cette compagnie{modifies ? `, dont ${modifies} modifié${modifies > 1 ? 's' : ''}` : ', tous à leur valeur d\'origine'}.
        Un réglage sans garantie correspondante dans les offres de la compagnie n'a pas d'effet.
      </p>
      {donnees.Groupes.map((g) => {
        const lignes = deLaCompagnie.filter((p) => p.GroupeMoteur === g.Code);
        const visibles = lignes.filter((p) => !estGrille(p.Code) && (!terme || normaliser(`${p.Libelle} ${p.Aide}`).includes(terme)));
        const grille = lignes.filter((p) => estGrille(p.Code));
        const grilleVisible = grille.length > 0 && (!terme || normaliser('grille vol et incendie par tranche de valeur venale').includes(terme));
        if (!visibles.length && !grilleVisible) return null;
        return (
          <SectionParametrage key={g.Code} icone={SlidersHorizontal} titre={`${g.Libelle} (${g.Categories})`}>
            {visibles.map((p) => (
              <LigneParametre key={p.Cle} parametre={p} onEnregistre={remplacer}
                modifier={parametrageApi.modifierMoteurAuto} retablir={parametrageApi.retablirMoteurAuto} />
            ))}
            {grilleVisible && <GrilleVolIncendie parametres={grille} onEnregistre={remplacer} />}
          </SectionParametrage>
        );
      })}
    </div>
  );
};

// ------------------------------------------------------------------ page
const ONGLETS = [
  { id: 'bareme', libelle: 'Barème par catégorie', icone: Table2 },
  { id: 'moteur', libelle: 'Montants du moteur', icone: Grid3x3 },
];

export const ParametrageBaremeAutoPage = () => {
  const [parametresUrl] = useSearchParams();
  const [onglet, setOnglet] = useState(parametresUrl.get('onglet') === 'moteur' ? 'moteur' : 'bareme');
  return (
    <div style={{ padding: '1.5rem' }}>
      <EnTeteParametrage
        icone={Calculator}
        titre="Barème automobile"
        description="Tout ce qui fixe la prime calculée d'un devis Automobile : le barème de chaque catégorie (RC, CEDEAO, recours, taux des garanties) et les montants du moteur de chaque compagnie (surprimes, FGA, défense-recours, taux et franchises, grille vol et incendie)."
        usage="Chaque modification s'applique aux prochains calculs et est inscrite au journal d'audit ; les devis déjà enregistrés ne changent pas. Les tarifs à lecture directe, les règles des garanties, la sécurité routière et le Pool TPV ont leur propre écran."
      />
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        {ONGLETS.map((o) => (
          <button key={o.id} type="button" onClick={() => setOnglet(o.id)} className={`btn ${onglet === o.id ? 'btn-primary' : 'btn-secondary'}`} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <o.icone size={15} /> {o.libelle}
          </button>
        ))}
      </div>
      {onglet === 'bareme' ? (
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 0 }}>
            Une ligne par catégorie tarifaire et garantie (et par tranche de puissance et d'énergie pour la RC). Une catégorie peut servir à plusieurs compagnies (ex. « PROMENADE ET AFFAIRES » : NSIA, AMSA et SUNU) : la modifier change le calcul de chacune ; les tarifs TECK, ACCACIA, BAOBAB, EBENE et VTC sont propres à NSIA.
          </p>
          <TableBareme route="tarifdetail" cle="IdDetail" libelle="Ligne du barème automobile" colonnes={COLONNES_BAREME}
            valeursParDefaut={DEFAUTS_BAREME} controle={controleBareme}
            tri={(a, b) => Number(a.IdTarif) - Number(b.IdTarif) || Number(a.IdGarantie) - Number(b.IdGarantie) || Number(a.CodeCarburant) - Number(b.CodeCarburant) || Number(a.PuissanceMin) - Number(b.PuissanceMin)} />
        </div>
      ) : <MontantsMoteur />}
    </div>
  );
};

export default ParametrageBaremeAutoPage;
