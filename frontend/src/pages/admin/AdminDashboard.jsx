import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  Coins,
  HandCoins,
  Info,
  Landmark,
  Layers,
  Percent,
  PiggyBank,
  PieChart,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react';

import {
  Anime, BoutonVoir, Detail, Evolution, francs, Jauge, nombre, pluriel, pourcent, Repartition, Section, Segments, Tuile,
} from '../../components/common/Cockpit';
import { GraphiqueMensuel } from '../../components/common/GraphiqueMensuel';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { cockpitApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { formatDate, formatDateLisible } from '../../utils/dateUtils';

// Tableau de bord de la direction : chiffres réels d'un exercice (GET /api/tableau-de-bord/), alertes de conformité au jour.
// OREOLE est courtier : son chiffre d'affaires, ce sont ses commissions et accessoires, pas les primes, qui reviennent aux
// compagnies (production/chiffre_affaires.py).
const ICONES_ALERTE = {
  reversements_retard: Banknote,
  cheques_echus: Landmark,
  impayes: Wallet,
  reclamations_anciennes: HandCoins,
  derogations: CheckCheck,
  commissions_a_reclamer: HandCoins,
};

// Sommes perçues par le cabinet, dans l'ordre de la réponse du serveur
const SOURCES_PERCU = [
  ['Compagnies', 'Règlements des compagnies'],
  ['FraisCourtiers', 'Frais courtiers Oreole Santé'],
  ['Reprises', 'Affaires antérieures'],
  ['Rafas', 'Commission RAFAS'],
];

export const AdminDashboard = () => {
  const navigate = useNavigate();
  const { peut } = useAuth();
  const [exercice, setExercice] = useState(null);
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const charger = useCallback(async (annee) => {
    setChargement(true);
    setErreur('');
    try {
      setDonnees(await cockpitApi.tableauDeBord(annee));
    } catch (err) {
      console.error('Erreur chargement du tableau de bord :', err);
      setErreur(err?.response?.data?.detail || 'Les chiffres du tableau de bord n\'ont pas pu être chargés : le serveur ou la base de données ne répond pas.');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(exercice); }, [charger, exercice]);

  const d = donnees;
  const production = d?.Production;
  const encaissements = d?.Encaissements;
  const ca = d?.ChiffreAffaires;
  const situation = d?.Situation;
  const n = d?.Exercice;
  const periode = d && (d.EnCours
    ? `du 1er janvier au ${formatDate(d.Au)}, comparés à la même période de ${n - 1}`
    : `de l'exercice ${n} complet, comparés à ${n - 1}`);

  const totalCaCompagnies = (d?.ParCompagnie || []).reduce((s, c) => s + Math.max(c.ChiffreAffaires, 0), 0);
  const branches = d?.ParBranche || [];
  const alertesVisibles = situation?.Alertes?.filter((alerte) => peut(alerte.Droit)) || [];
  const total = (cle) => branches.reduce((s, b) => s + (b[cle] || 0), 0);
  const tauxTotal = (part, base) => (base ? (part * 100) / base : null);
  const sourcesPercues = ca ? SOURCES_PERCU.filter(([cle]) => ca.Percu[cle]) : [];

  return (
    <div className="cockpit">
      {/* En-tête : exercice et raccourcis */}
      <div className="glass-panel cockpit-entete">
        <div>
          <span className="cockpit-surtitre">
            <CalendarDays size={13} aria-hidden="true" />
            {d ? `Direction · alertes au ${formatDateLisible(d.Jour, { moisLong: true, jourSemaine: true })}` : 'Direction'}
          </span>
          <h1 className="title-xl">Tableau de bord</h1>
          <p>
            {d
              ? `Chiffre d'affaires du cabinet, primes et encaissements ${periode}.`
              : 'Chiffre d\'affaires du cabinet, primes, encaissements et alertes de conformité.'}
          </p>
        </div>
        <div className="cockpit-raccourcis">
          {d && <Segments options={d.Exercices} valeur={n} onChange={setExercice} libelle="Exercice affiché" />}
          {peut('commissions.view') && (
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/commissions')}>
              <HandCoins size={16} /><span>Commissions</span>
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/reporting/cima')}>
            <PieChart size={16} /><span>États CIMA</span>
          </button>
          {peut('reversements.view') && (
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/remittances')}>
              <Banknote size={16} /><span>Reversements</span>
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => charger(exercice)} aria-busy={chargement} title="Recalculer les chiffres">
            <RefreshCw size={16} /><span>Actualiser</span>
          </button>
        </div>
      </div>

      {erreur && (
        <div className="cockpit-erreur" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{erreur}</span>
          <button type="button" className="btn btn-secondary" onClick={() => charger(exercice)}>Réessayer</button>
        </div>
      )}

      {!d && chargement && <LoadingSpinner text="Calcul des chiffres de l'exercice…" />}

      {d && (
        // Changement d'exercice : les chiffres affichés restent en place, atténués, jusqu'aux nouveaux
        <div className={`cockpit${chargement ? ' cockpit-chargement' : ''}`} aria-busy={chargement}>
          {/* Revenu du cabinet : ce qui fait son chiffre d'affaires */}
          <p className="cockpit-bande">Chiffre d'affaires du cabinet</p>
          <div className="cockpit-tuiles">
            <Tuile
              vedette
              titre={`Chiffre d'affaires ${n}`}
              valeur={<Anime valeur={ca.Total} format={francs} />}
              icone={Coins}
              couleur="emerald"
              vers={peut('commissions.view') ? '/admin/commissions' : undefined}
              aide="Revenu du cabinet : commissions et accessoires des actes émis sur la période, contrats annulés exclus, et commission RAFAS facturée. Les primes reviennent aux compagnies."
              evolution={<Evolution actuel={ca.Total} precedent={ca.Precedent} au={d.AuPrecedent} />}
            >
              <Repartition
                libelle="Composition du chiffre d'affaires"
                parts={[
                  { serie: 1, libelle: 'Commissions', valeur: ca.Commissions },
                  { serie: 2, libelle: 'Accessoires et frais courtiers', valeur: ca.Accessoires },
                  { serie: 3, libelle: 'RAFAS', valeur: ca.Rafas },
                ]}
              />
              <dl className="cockpit-chiffres-cles">
                <div><dt>Taux moyen</dt><dd>{pourcent(ca.TauxMoyen)}</dd><dd className="aide">de la prime nette</dd></div>
                <div><dt>Part des primes</dt><dd>{pourcent(ca.PartDesPrimes)}</dd><dd className="aide">des primes TTC émises</dd></div>
                {ca.Apporteurs.Total > 0 ? (
                  <div><dt>Après les apporteurs</dt><dd>{francs(ca.Net)}</dd><dd className="aide">{francs(ca.Apporteurs.Total)} leur reviennent</dd></div>
                ) : (
                  <div><dt>Actes</dt><dd>{nombre(ca.Nombre)}</dd><dd className="aide">émis sur la période</dd></div>
                )}
              </dl>
            </Tuile>
            <Tuile
              titre={`Perçu en ${n}`}
              valeur={<Anime valeur={ca.Percu.Total} format={francs} />}
              icone={PiggyBank}
              couleur="blue"
              vers={peut('commissions.view') ? '/admin/commissions' : undefined}
              aide="Sommes reçues par le cabinet sur la période : règlements des compagnies, frais courtiers gardés à l'encaissement, affaires antérieures déjà réglées, RAFAS"
              evolution={<Evolution actuel={ca.Percu.Total} precedent={ca.PercuPrecedent} au={d.AuPrecedent} />}
              lignes={sourcesPercues.length
                ? sourcesPercues.map(([cle, libelle]) => <Detail libelle={libelle} valeur={francs(ca.Percu[cle])} />)
                : ['Aucun règlement de commission saisi sur la période']}
            />
            <Tuile
              titre="À percevoir"
              valeur={<Anime valeur={ca.EnAttente.Total} format={francs} />}
              icone={HandCoins}
              couleur="amber"
              vers={peut('commissions.view') ? '/admin/commissions' : undefined}
              aide={`Situation au ${formatDate(d.Jour)} : commissions des primes reversées pas encore payées par les compagnies, commission RAFAS facturée non réglée`}
              lignes={[
                <Detail libelle="À réclamer aux compagnies" valeur={francs(ca.EnAttente.AReclamer)} />,
                <Detail libelle="Réclamées, non payées" valeur={francs(ca.EnAttente.Reclamees)} />,
                ca.EnAttente.Rafas > 0 && <Detail libelle="RAFAS non réglée" valeur={francs(ca.EnAttente.Rafas)} />,
              ]}
            />
          </div>

          {/* Primes placées pour le compte des compagnies */}
          <p className="cockpit-bande">Primes pour le compte des compagnies</p>
          <div className="cockpit-tuiles">
            <Tuile
              titre={`Primes émises ${n}`}
              valeur={<Anime valeur={production.PrimeTtc} format={francs} />}
              icone={TrendingUp}
              couleur="purple"
              vers={peut('contrats.view') ? '/user/contracts' : undefined}
              aide="Primes TTC des actes émis sur la période, contrats annulés exclus : elles reviennent aux compagnies"
              evolution={<Evolution actuel={production.PrimeTtc} precedent={production.Precedent.PrimeTtc} au={d.AuPrecedent} />}
              lignes={[
                `${pluriel(production.Nombre, 'acte', 'actes')} : ${nombre(production.AffairesNouvelles)} affaires nouvelles, ${nombre(production.Renouvellements)} renouvellements, ${pluriel(production.Avenants, 'autre avenant', 'autres avenants')}`,
              ]}
            />
            <Tuile
              titre={`Encaissé en ${n}`}
              valeur={<Anime valeur={encaissements.Total} format={francs} />}
              icone={Wallet}
              couleur="emerald"
              vers={peut('encaissements.view') ? '/user/cash/etat' : undefined}
              aide="Encaissements saisis sur la période, pièces annulées exclues, décaissements déduits"
              lignes={[
                <Detail libelle={`Primes de ${n}`} valeur={francs(encaissements.SurExercice)} />,
                <Detail libelle="Exercices antérieurs" valeur={francs(encaissements.SurAnterieurs)} />,
              ]}
            />
            <Tuile
              titre="Recouvrement des émissions"
              valeur={<Anime valeur={encaissements.TauxRecouvrement} format={pourcent} entier={false} />}
              icone={Percent}
              couleur="blue"
              aide={`Part des primes émises en ${n} déjà encaissée à ce jour : la commission ne se perçoit qu'après l'encaissement et le reversement de la prime`}
              lignes={[
                <Jauge taux={encaissements.TauxRecouvrement} libelle="Taux de recouvrement" />,
                <Detail libelle="Encaissé sur les émissions" valeur={francs(encaissements.EncaisseSurEmissions)} />,
                <Detail libelle={`Reste à encaisser, ${pluriel(encaissements.QuittancesImpayees, 'quittance', 'quittances')}`} valeur={francs(encaissements.ResteAEncaisser)} />,
              ]}
            />
          </div>

          <Section
            icone={BarChart3}
            titre="Chiffre d'affaires par mois"
            sousTitre={`Commissions et accessoires des actes émis en ${n} et en ${n - 1}, sommes perçues en ${n}, en francs CFA`}
          >
            <GraphiqueMensuel
              mois={d.ParMois}
              exercice={n}
              titre="Chiffre d'affaires par mois"
              series={[
                { cle: 'ChiffreAffaires', libelle: `Chiffre d'affaires ${n}`, classe: 'n', forme: 'barre' },
                { cle: 'ChiffreAffairesPrecedent', libelle: `Chiffre d'affaires ${n - 1}`, classe: 'n1', forme: 'barre' },
                { cle: 'Percu', libelle: `Perçu en ${n}`, classe: 'enc', forme: 'ligne' },
              ]}
            />
          </Section>

          <div className="cockpit-colonnes">
            {/* Alertes de conformité : situation au jour, quel que soit l'exercice */}
            <Section
              icone={ShieldAlert}
              titre="Alertes de conformité"
              sousTitre={`Situation au ${formatDate(d.Jour)}, d'après la base`}
            >
              {alertesVisibles.length === 0 ? (
                <div className="cockpit-rien">
                  <CheckCircle2 size={18} aria-hidden="true" />
                  <span>{situation?.Alertes?.length ? 'Aucune alerte accessible.' : 'Aucune alerte : reversements, chèques, primes et commissions à jour.'}</span>
                </div>
              ) : (
                <ul className="cockpit-a-traiter">
                  {alertesVisibles.map((a) => {
                    const Icone = ICONES_ALERTE[a.Code] || (a.Ton === 'critique' ? ShieldAlert : Info);
                    return (
                      <li key={a.Code}>
                        <button
                          type="button"
                          className={`ton-${a.Ton}`}
                          onClick={() => navigate(a.Vers)}
                        >
                          <Icone size={16} aria-hidden="true" />
                          <span>
                            {a.Libelle}
                            {a.Nombre !== null && <> : {nombre(a.Nombre)}</>}
                          </span>
                          {a.Montant !== null && <span className="montant-alerte">{francs(a.Montant)}</span>}
                          <ArrowRight size={14} aria-hidden="true" className="fleche" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="cockpit-note">
                Primes à reverser : {francs(situation.Reversements.Montant)}, {pluriel(situation.Reversements.Nombre, 'encaissement', 'encaissements')}
                {situation.Reversements.PlusAncien && <>, le plus ancien du {formatDate(situation.Reversements.PlusAncien)}</>}.
                {' '}Commissions en attente de règlement : {francs(situation.Commissions.AReclamer + situation.Commissions.Reclamees)}.
              </p>
            </Section>

            {/* Chiffre d'affaires par compagnie : une seule mesure pour la part, une seule teinte */}
            <Section icone={Building2} titre={`Chiffre d'affaires ${n} par compagnie`} sousTitre="Commissions et accessoires du cabinet, avec les primes TTC placées">
              {d.ParCompagnie.length === 0 ? (
                <div className="cockpit-rien"><span>Aucun acte émis sur la période.</span></div>
              ) : (
                <div className="table-wrapper">
                  <table className="cockpit-branches">
                    <thead>
                      <tr><th>Compagnie</th><th className="nombre">Chiffre d'affaires</th><th className="nombre">Primes TTC</th><th>Part du CA</th></tr>
                    </thead>
                    <tbody>
                      {d.ParCompagnie.map((c, i) => {
                        const part = totalCaCompagnies ? (Math.max(c.ChiffreAffaires, 0) * 100) / totalCaCompagnies : 0;
                        return (
                          <tr key={c.IdCompagnie ?? c.Compagnie} title={`${c.Compagnie} : ${francs(c.ChiffreAffaires)} de chiffre d'affaires sur ${francs(c.PrimeTtc)} de primes, ${pluriel(c.Nombre, 'acte', 'actes')}`}>
                            <td>
                              <div className="avec-rang">
                                <span className="cockpit-rang" aria-hidden="true">{i + 1}</span>
                                <div>{c.Compagnie}<span className="secondaire">{pluriel(c.Nombre, 'acte', 'actes')}</span></div>
                              </div>
                            </td>
                            <td className="nombre montant">
                              {francs(c.ChiffreAffaires)}
                              {c.ChiffreAffairesPercu > 0 && <span className="secondaire">perçu {francs(c.ChiffreAffairesPercu)}</span>}
                            </td>
                            <td className="nombre montant">{francs(c.PrimeTtc)}</td>
                            <td className="part">
                              <div className="cockpit-barre" aria-hidden="true"><span style={{ width: `${part}%` }} /></div>
                              <span>{part.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>

          <Section
            icone={TrendingUp}
            titre="Primes et encaissements par mois"
            sousTitre={`Primes TTC émises pour les compagnies en ${n} et en ${n - 1}, encaissements saisis en ${n}, en francs CFA`}
          >
            <GraphiqueMensuel mois={d.ParMois} exercice={n} />
          </Section>

          <Section
            icone={Layers}
            titre={`Synthèse ${n} par branche`}
            sousTitre="Chiffre d'affaires du cabinet, primes émises et encaissements, avec la catégorie des états réglementaires CIMA"
            action={<BoutonVoir libelle="États CIMA" vers="/admin/reporting/cima" />}
          >
            {branches.length === 0 ? (
              <div className="cockpit-rien"><span>Aucun mouvement sur la période.</span></div>
            ) : (
              <div className="table-wrapper">
                <table className="cockpit-branches">
                  <thead>
                    <tr>
                      <th>Branche</th>
                      <th className="nombre">Actes</th>
                      <th className="nombre">Chiffre d'affaires</th>
                      <th className="nombre">Perçu</th>
                      <th className="nombre">Primes TTC émises</th>
                      <th className="nombre">Encaissé en {n}</th>
                      <th className="nombre">Recouvrement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branches.map((b, i) => (
                      <tr key={b.IdProduit ?? b.Branche}>
                        <td>
                          <div className="avec-rang">
                            <span className="cockpit-rang" aria-hidden="true">{i + 1}</span>
                            <div>
                              {b.Branche}
                              {b.CategorieCima.toLowerCase() !== b.Branche.toLowerCase() && <span className="secondaire">{b.CategorieCima}</span>}
                            </div>
                          </div>
                        </td>
                        <td className="nombre">{nombre(b.Nombre)}</td>
                        <td className="nombre montant">
                          {francs(b.ChiffreAffaires)}
                          {b.TauxCommission !== null && <span className="secondaire">{pourcent(b.TauxCommission)} {b.LibelleBase || 'de la prime nette'}</span>}
                          {b.Accessoires > 0 && <span className="secondaire">dont accessoires {francs(b.Accessoires)}</span>}
                        </td>
                        <td className="nombre montant">{francs(b.ChiffreAffairesPercu)}</td>
                        <td className="nombre montant">{francs(b.PrimeTtc)}</td>
                        <td className="nombre montant">
                          {francs(b.EncaisseExercice + b.EncaisseAnterieur)}
                          {b.EncaisseAnterieur > 0 && <span className="secondaire">dont {francs(b.EncaisseAnterieur)} antérieurs</span>}
                        </td>
                        <td className="nombre">
                          {pourcent(b.TauxRecouvrement)}
                          {b.ResteAEncaisser > 0 && <span className="secondaire">reste {francs(b.ResteAEncaisser)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Ensemble</td>
                      <td className="nombre">{nombre(total('Nombre'))}</td>
                      <td className="nombre montant">{francs(total('ChiffreAffaires'))}</td>
                      <td className="nombre montant">{francs(total('ChiffreAffairesPercu'))}</td>
                      <td className="nombre montant">{francs(total('PrimeTtc'))}</td>
                      <td className="nombre montant">{francs(total('EncaisseExercice') + total('EncaisseAnterieur'))}</td>
                      <td className="nombre">{pourcent(tauxTotal(total('EncaisseSurEmissions'), total('PrimeEmiseQuittancee')))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <p className="cockpit-note">
              Chiffre d'affaires : commission et accessoires du cabinet de chaque acte émis sur la période ; en Oreole Santé, les frais
              courtiers que le cabinet garde. Perçu : règlements des compagnies saisis dans LE PHARE, frais courtiers gardés à
              l'encaissement des cotisations, affaires antérieures déjà réglées et commission RAFAS réglée.
              Recouvrement : part des primes émises sur la période déjà encaissée à ce jour.
            </p>
          </Section>

          {!peut('contrats.view') && !peut('encaissements.view') && (
            <div className="cockpit-rien"><ShieldCheck size={18} aria-hidden="true" /><span>Chiffres consolidés : le détail des contrats et de la caisse relève d'autres droits.</span></div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
