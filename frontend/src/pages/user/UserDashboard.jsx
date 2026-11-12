import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarClock,
  CalendarDays,
  CalendarX,
  CheckCircle2,
  ClipboardList,
  Coins,
  CreditCard,
  FilePlus,
  FileText,
  HandCoins,
  History,
  Landmark,
  Layers,
  ListChecks,
  Percent,
  PiggyBank,
  Receipt,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Wallet,
} from 'lucide-react';

import {
  Anime, BoutonVoir, cheminDevis, Detail, Evolution, francs, Jauge, MiniBarres, nombre, pluriel, pourcent, Repartition, Section, Tuile,
} from '../../components/common/Cockpit';
import { DataTable } from '../../components/common/DataTable';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { StatusBadge } from '../../components/common/StatusBadge';
import { cockpitApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { formatDate, formatDateLisible } from '../../utils/dateUtils';

// Cockpit opérationnel : chiffres réels de la base (GET /api/cockpit/), chaque bloc selon les droits de l'utilisateur.
// OREOLE est courtier : son chiffre d'affaires, ce sont ses commissions et accessoires (droit commissions.view ou
// reporting.view), les primes reviennent aux compagnies.
const SOURCES_PERCU = [
  ['Compagnies', 'Règlements des compagnies'],
  ['FraisCourtiers', 'Frais courtiers Oreole Santé'],
  ['Reprises', 'Affaires antérieures'],
  ['Rafas', 'RAFAS'],
];
const MOIS = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleDateString('fr-FR', { month: 'long' }));

export const UserDashboard = () => {
  const navigate = useNavigate();
  const { peut, isDirectorOrAdmin, user } = useAuth();
  const prenom = String(user?.first_name || user?.name || '').trim().split(/\s+/)[0];
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    try {
      setDonnees(await cockpitApi.lire());
    } catch (err) {
      console.error('Erreur chargement du cockpit :', err);
      setErreur('Les chiffres du cockpit n\'ont pas pu être chargés : le serveur ou la base de données ne répond pas.');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const production = donnees?.Production;
  const devis = donnees?.Devis;
  const caisse = donnees?.Caisse;
  const reversements = donnees?.Reversements;
  const commissions = donnees?.Commissions;
  const ca = donnees?.ChiffreAffaires;
  const exercice = donnees?.Exercice || new Date().getFullYear();
  const sourcesPercues = ca ? SOURCES_PERCU.filter(([cle]) => ca.Percu[cle]) : [];

  const ouvrirDevis = (d) => navigate(cheminDevis(d.IdProduit, d.IdDevis));

  // Points en attente : seulement ceux qui comptent au moins un élément
  const aTraiter = [
    peut('contrats.view') && production?.Echeances?.Echues > 0 && {
      icone: CalendarX, ton: 'critique', vers: '/user/contracts?statut=echu',
      libelle: `${pluriel(production.Echeances.Echues, 'police échue', 'polices échues')} depuis moins de 30 jours, sans renouvellement`,
    },
    peut('contrats.view') && production?.Echeances?.AEchoir > 0 && {
      icone: CalendarClock, ton: 'attention', vers: '/user/contracts?statut=a_renouveler',
      libelle: `${pluriel(production.Echeances.AEchoir, 'police arrive', 'polices arrivent')} à échéance dans les 30 jours`,
    },
    peut('devis.view') && devis?.Expires > 0 && {
      icone: FileText, ton: 'attention', vers: '/user/quotes?onglet=EXPIRED',
      libelle: `${pluriel(devis.Expires, 'devis expiré', 'devis expirés')} depuis le ${formatDate(devis.ExpiresDepuis)} à relancer ou modifier`,
    },
    peut('encaissements.view') && caisse?.Cheques?.ADeposer > 0 && {
      icone: Landmark, ton: caisse.Cheques.Echus > 0 ? 'critique' : 'attention', vers: '/user/cheques',
      libelle: `${pluriel(caisse.Cheques.ADeposer, 'chèque', 'chèques')} à déposer d'ici un mois pour ${francs(caisse.Cheques.Montant)}${caisse.Cheques.Echus > 0 ? `, dont ${nombre(caisse.Cheques.Echus)} en retard` : ''}`,
    },
    reversements?.Nombre > 0 && isDirectorOrAdmin && peut('reversements.view') && {
      icone: Banknote, ton: 'info', vers: '/admin/remittances',
      libelle: `${francs(reversements.Montant)} de primes encaissées à reverser à ${pluriel(reversements.Compagnies, 'compagnie', 'compagnies')}`,
    },
    commissions?.AReclamer > 0 && isDirectorOrAdmin && peut('commissions.view') && {
      icone: HandCoins, ton: 'info', vers: '/admin/commissions',
      libelle: `${francs(commissions.AReclamer)} de commissions à réclamer aux compagnies`,
    },
    peut('sinistres.view') && donnees?.Sinistres?.Ouverts > 0 && {
      icone: AlertTriangle, ton: 'attention', vers: '/user/claims',
      libelle: `${pluriel(donnees.Sinistres.Ouverts, 'sinistre en cours', 'sinistres en cours')} de traitement, ${francs(donnees.Sinistres.MontantReclame)} réclamés`,
    },
    peut('crm.view') && donnees?.Questionnaires?.ATraiter > 0 && {
      icone: ClipboardList, ton: 'info', vers: '/user/crm/questionnaires',
      libelle: `${pluriel(donnees.Questionnaires.ATraiter, 'questionnaire prospect', 'questionnaires prospects')} en attente de devis`,
    },
  ].filter(Boolean);

  // Part de chaque branche : dans le chiffre d'affaires du cabinet quand il est visible, sinon dans les primes
  const mesurePart = ca ? 'ChiffreAffaires' : 'PrimeTtc';
  const totalBranches = (production?.ParBranche || []).reduce((s, b) => s + Math.max(b[mesurePart] || 0, 0), 0);
  const colonneCa = (libelle) => (ca ? [{
    header: libelle, accessor: 'ChiffreAffaires',
    render: (l) => <span style={{ fontFamily: 'var(--font-mono)' }}>{francs(l.ChiffreAffaires)}</span>,
  }] : []);

  const colonnesEcheances = [
    { header: 'N° Police', accessor: 'NumeroPolice', render: (e) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{e.NumeroPolice}</strong> },
    { header: 'Client', accessor: 'Client' },
    { header: 'Branche', accessor: 'Produit' },
    { header: 'Compagnie', accessor: 'Compagnie' },
    {
      header: 'Échéance', accessor: 'DateExpiration',
      render: (e) => (
        <div>
          <div>{formatDate(e.DateExpiration)}</div>
          <StatusBadge
            label={e.Jours < 0 ? `Échue depuis ${pluriel(-e.Jours, 'jour', 'jours')}` : e.Jours === 0 ? 'Échéance aujourd\'hui' : `Dans ${pluriel(e.Jours, 'jour', 'jours')}`}
            color={e.Jours < 0 ? 'red' : 'amber'}
          />
        </div>
      ),
    },
    { header: 'Prime TTC', accessor: 'PrimeTtc', render: (e) => <span style={{ fontFamily: 'var(--font-mono)' }}>{francs(e.PrimeTtc)}</span> },
    ...colonneCa('Commission en jeu'),
    {
      header: 'Action',
      render: (e) => (e.DevisEnCours
        ? peut('devis.view') && <button type="button" className="btn btn-secondary cockpit-bouton-ligne" onClick={() => navigate('/user/quotes')}>Devis préparé</button>
        : peut('contrats.view') && peut('contrats.avenant') && <button type="button" className="btn btn-primary cockpit-bouton-ligne" onClick={() => navigate(`/user/contracts/${e.IdContrat}/renouvellement`)}>Renouveler</button>),
    },
  ];

  const colonnesDevis = [
    { header: 'N° Devis', accessor: 'NumeroDevis', render: (d) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{d.NumeroDevis}</strong> },
    { header: 'Client', accessor: 'Client', render: (d) => d.Client || '-' },
    { header: 'Branche', accessor: 'Produit' },
    { header: 'Valable jusqu\'au', accessor: 'DateExpiration', render: (d) => formatDate(d.DateExpiration) },
    { header: 'Prime TTC', accessor: 'PrimeTtc', render: (d) => <span style={{ fontFamily: 'var(--font-mono)' }}>{francs(d.PrimeTtc)}</span> },
    { header: 'Action', render: (d) => peut(['devis.create', 'devis.update']) && <button type="button" className="btn btn-secondary cockpit-bouton-ligne" onClick={() => ouvrirDevis(d)}>Ouvrir</button> },
  ];

  const colonnesContrats = [
    { header: 'N° Police', accessor: 'NumeroPolice', render: (c) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{c.NumeroPolice}</strong> },
    { header: 'Client', accessor: 'Client' },
    { header: 'Branche', accessor: 'Produit' },
    { header: 'Émis le', accessor: 'DateEmission', render: (c) => formatDate(c.DateEmission) },
    { header: 'Prime TTC', accessor: 'PrimeTtc', render: (c) => <span style={{ fontFamily: 'var(--font-mono)' }}>{francs(c.PrimeTtc)}</span> },
    ...colonneCa('Commission'),
    {
      header: 'Règlement', accessor: 'Reste',
      render: (c) => (c.Reste > 0
        ? <StatusBadge label={`Reste ${francs(c.Reste)}`} color="amber" />
        : <StatusBadge label="Soldé" color="emerald" />),
    },
    { header: 'Action', render: (c) => peut('contrats.view') && <button type="button" className="btn btn-secondary cockpit-bouton-ligne" onClick={() => navigate(`/user/contracts/${c.IdContrat}`)}>Ouvrir</button> },
  ];

  return (
    <div className="cockpit">
      {/* En-tête et raccourcis */}
      <div className="glass-panel cockpit-entete">
        <div>
          <span className="cockpit-surtitre">
            <CalendarDays size={13} aria-hidden="true" />
            {donnees ? `${formatDateLisible(donnees.Jour, { moisLong: true, jourSemaine: true })} · exercice ${exercice}` : 'Exercice en cours'}
          </span>
          <h1 className="title-xl">Cockpit opérationnel</h1>
          <p>
            {`${prenom ? `Bonjour ${prenom}, voici` : 'Voici'} le chiffre d'affaires, la production, les devis, la caisse et les échéances du cabinet.`}
          </p>
        </div>
        <div className="cockpit-raccourcis">
          {peut('devis.create') && peut('devis.view') && (
            <button type="button" className="btn btn-primary" onClick={() => navigate('/user/quotes')}>
              <FilePlus size={16} /><span>Nouveau devis</span>
            </button>
          )}
          {peut('clients.create') && peut('clients.view') && (
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/user/clients')}>
              <UserPlus size={16} /><span>Nouveau client</span>
            </button>
          )}
          {peut('encaissements.create') && peut('encaissements.view') && (
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/user/cash')}>
              <CreditCard size={16} /><span>Encaisser une prime</span>
            </button>
          )}
          {peut('contrats.reprise') && peut('contrats.view') && (
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/user/reprises')}>
              <History size={16} /><span>Affaires antérieures</span>
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={charger} aria-busy={chargement} title="Recalculer les chiffres">
            <RefreshCw size={16} /><span>Actualiser</span>
          </button>
        </div>
      </div>

      {erreur && (
        <div className="cockpit-erreur" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{erreur}</span>
          <button type="button" className="btn btn-secondary" onClick={charger}>Réessayer</button>
        </div>
      )}

      {!donnees && chargement && <LoadingSpinner text="Calcul des chiffres du cabinet…" />}

      {donnees && (
        <>
          {/* Chiffre d'affaires du cabinet : commissions et accessoires, ce qui fait le revenu du courtier */}
          {ca && (
            <>
              <p className="cockpit-bande">Chiffre d'affaires du cabinet</p>
              <div className="cockpit-tuiles">
                <Tuile
                  vedette
                  titre={`Chiffre d'affaires ${exercice}`}
                  valeur={<Anime valeur={ca.Total} format={francs} />}
                  icone={Coins}
                  couleur="emerald"
                  vers={isDirectorOrAdmin && peut('reporting.view') ? '/admin/dashboard' : undefined}
                  aide="Revenu du cabinet : commissions et accessoires des actes émis depuis le 1er janvier, contrats annulés exclus, et commission RAFAS facturée. Les primes reviennent aux compagnies."
                  evolution={<Evolution actuel={ca.Total} precedent={ca.Precedent} au={ca.AuPrecedent} />}
                >
                  <Repartition
                    libelle="Composition du chiffre d'affaires"
                    parts={[
                      { serie: 1, libelle: 'Commissions', valeur: ca.Commissions },
                      { serie: 2, libelle: 'Accessoires et frais courtiers', valeur: ca.Accessoires },
                      { serie: 3, libelle: 'RAFAS', valeur: ca.Rafas },
                    ]}
                  />
                  {ca.Mensuel && (
                    <MiniBarres
                      titre="Chiffre d'affaires"
                      valeurs={ca.Mensuel}
                      libelles={MOIS}
                      actuel={Number(String(donnees.Jour).slice(5, 7)) - 1}
                    />
                  )}
                  <Detail libelle="Taux moyen sur la prime nette" valeur={pourcent(ca.TauxMoyen)} />
                  {ca.Apporteurs.Total > 0 && <Detail libelle="Après les apporteurs d'affaires" valeur={francs(ca.Net)} />}
                </Tuile>
                <Tuile
                  titre={`Perçu en ${exercice}`}
                  valeur={<Anime valeur={ca.Percu.Total} format={francs} />}
                  icone={PiggyBank}
                  couleur="blue"
                  vers={isDirectorOrAdmin && peut('commissions.view') ? '/admin/commissions' : undefined}
                  aide="Sommes reçues par le cabinet depuis le 1er janvier : règlements des compagnies, frais courtiers gardés à l'encaissement, affaires antérieures déjà réglées, RAFAS"
                  lignes={[
                    ...(sourcesPercues.length
                      ? sourcesPercues.map(([cle, libelle]) => <Detail libelle={libelle} valeur={francs(ca.Percu[cle])} />)
                      : ['Aucun règlement de commission saisi cette année']),
                    <Detail libelle="Ce mois-ci" valeur={francs(ca.Mois.Percu)} />,
                  ]}
                />
                <Tuile
                  titre="À percevoir"
                  valeur={<Anime valeur={ca.EnAttente.Total} format={francs} />}
                  icone={HandCoins}
                  couleur="amber"
                  vers={isDirectorOrAdmin && peut('commissions.view') ? '/admin/commissions' : undefined}
                  aide="Commissions des primes reversées pas encore payées par les compagnies, commission RAFAS facturée non réglée"
                  lignes={[
                    <Detail libelle="À réclamer aux compagnies" valeur={francs(ca.EnAttente.AReclamer)} />,
                    <Detail
                      libelle={`Réclamées non payées${commissions?.BordereauxEnAttente ? `, ${pluriel(commissions.BordereauxEnAttente, 'bordereau', 'bordereaux')}` : ''}`}
                      valeur={francs(ca.EnAttente.Reclamees)}
                    />,
                    ca.EnAttente.Rafas > 0 && <Detail libelle="RAFAS non réglée" valeur={francs(ca.EnAttente.Rafas)} />,
                  ]}
                />
              </div>
            </>
          )}

          {/* Production et devis */}
          {(production || devis) && ca && <p className="cockpit-bande">Production et devis</p>}
          {(production || devis) && (
            <div className="cockpit-tuiles">
              {production && (
                <Tuile
                  titre={`Primes émises ${exercice}`}
                  valeur={<Anime valeur={production.Annee.PrimeTtc} format={francs} />}
                  icone={TrendingUp}
                  couleur="purple"
                  vers={peut('contrats.view') ? '/user/contracts' : undefined}
                  aide="Primes TTC des actes émis depuis le 1er janvier, contrats annulés exclus : elles reviennent aux compagnies"
                  evolution={<Evolution actuel={production.Annee.PrimeTtc} precedent={production.AnneePrecedente.PrimeTtc} au={production.AnneePrecedente.Au} />}
                  lignes={[
                    `${pluriel(production.Annee.Nombre, 'acte', 'actes')} : ${nombre(production.Annee.AffairesNouvelles)} affaires nouvelles, ${nombre(production.Annee.Renouvellements)} renouvellements`,
                    <Detail libelle={`Ce mois-ci, ${pluriel(production.Mois.Nombre, 'acte', 'actes')}`} valeur={francs(production.Mois.PrimeTtc)} />,
                  ]}
                />
              )}
              {production && (
                <Tuile
                  titre="Polices en vigueur"
                  valeur={<Anime valeur={production.PolicesEnVigueur} format={nombre} />}
                  icone={ShieldCheck}
                  couleur="emerald"
                  vers={peut('contrats.view') ? '/user/contracts?statut=en_cours' : undefined}
                  aide="Polices dont la période d'affaire nouvelle ou de renouvellement couvre aujourd'hui, résiliations exclues"
                  lignes={[
                    <Detail libelle="Échéances dans les 30 jours" valeur={nombre(production.Echeances.AEchoir)} />,
                    <Detail libelle="Échues depuis moins de 30 jours" valeur={nombre(production.Echeances.Echues)} />,
                    production.Echeances.ChiffreAffaires > 0 && <Detail libelle="Commissions en jeu" valeur={francs(production.Echeances.ChiffreAffaires)} />,
                  ]}
                />
              )}
              {devis && (
                <Tuile
                  titre="Devis en cours"
                  valeur={<Anime valeur={devis.EnCours} format={nombre} />}
                  icone={FileText}
                  couleur="blue"
                  vers={peut('devis.view') ? '/user/quotes' : undefined}
                  aide="Devis ni confirmés ni archivés, encore valables"
                  lignes={[
                    <Detail libelle="Primes proposées" valeur={francs(devis.PrimeTtcEnCours)} />,
                    <Detail libelle={`Expirés depuis le ${formatDate(devis.ExpiresDepuis)}`} valeur={nombre(devis.Expires)} />,
                  ]}
                />
              )}
              {devis && (
                <Tuile
                  titre={`Transformation ${exercice}`}
                  valeur={<Anime valeur={devis.TauxTransformation} format={pourcent} entier={false} />}
                  icone={Percent}
                  couleur="amber"
                  vers={peut('devis.view') ? '/user/quotes' : undefined}
                  aide="Devis émis depuis le 1er janvier et déjà confirmés en contrat"
                  lignes={[
                    <Jauge taux={devis.TauxTransformation} libelle="Taux de transformation" />,
                    `${nombre(devis.ConfirmesAnnee)} devis confirmés sur ${nombre(devis.EmisAnnee)} émis`,
                  ]}
                />
              )}
            </div>
          )}

          {/* Caisse et flux financiers : primes pour le compte des compagnies */}
          {(caisse || reversements) && ca && <p className="cockpit-bande">Caisse et compagnies</p>}
          {(caisse || reversements || (commissions && !ca)) && (
            <div className="cockpit-tuiles">
              {caisse && (
                <Tuile
                  titre={`Encaissé en ${exercice}`}
                  valeur={<Anime valeur={caisse.Annee.Montant} format={francs} />}
                  icone={Wallet}
                  couleur="emerald"
                  vers={peut('encaissements.view') ? '/user/cash/etat' : undefined}
                  aide="Encaissements saisis depuis le 1er janvier, pièces annulées exclues, décaissements déduits"
                  lignes={[
                    `${pluriel(caisse.Annee.Pieces, 'pièce de caisse', 'pièces de caisse')}`,
                    <Detail libelle={`Ce mois-ci, ${pluriel(caisse.Mois.Pieces, 'pièce', 'pièces')}`} valeur={francs(caisse.Mois.Montant)} />,
                  ]}
                />
              )}
              {caisse && (
                <Tuile
                  titre="Reste à encaisser"
                  valeur={<Anime valeur={caisse.ResteAEncaisser.Montant} format={francs} />}
                  icone={CreditCard}
                  couleur="rose"
                  vers={peut('encaissements.view') ? '/user/cash' : undefined}
                  aide="Quittances non soldées des contrats en vigueur ou échus, émises depuis le 1er janvier"
                  lignes={[
                    `${pluriel(caisse.ResteAEncaisser.Nombre, 'quittance', 'quittances')} de l'exercice`,
                    caisse.ResteAEncaisser.NombreAnterieur > 0 && (
                      <Detail
                        libelle={`Années antérieures, ${pluriel(caisse.ResteAEncaisser.NombreAnterieur, 'quittance', 'quittances')}`}
                        valeur={francs(caisse.ResteAEncaisser.MontantAnterieur)}
                      />
                    ),
                  ]}
                />
              )}
              {reversements && (
                <Tuile
                  titre="À reverser aux compagnies"
                  valeur={<Anime valeur={reversements.Montant} format={francs} />}
                  icone={Banknote}
                  couleur="blue"
                  vers={isDirectorOrAdmin && peut('reversements.view') ? '/admin/remittances' : undefined}
                  aide="Primes encaissées pas encore reversées, prime entière (Code CIMA)"
                  lignes={[
                    `${pluriel(reversements.Nombre, 'encaissement', 'encaissements')}, ${pluriel(reversements.Compagnies, 'compagnie', 'compagnies')}`,
                    reversements.PlusAncien && `Le plus ancien du ${formatDate(reversements.PlusAncien)}`,
                  ]}
                />
              )}
              {commissions && !ca && (
                <Tuile
                  titre="Commissions en attente"
                  valeur={francs(commissions.AReclamer + commissions.Reclamees)}
                  icone={HandCoins}
                  couleur="purple"
                  vers={isDirectorOrAdmin && peut('commissions.view') ? '/admin/commissions' : undefined}
                  aide="Commissions des primes reversées pas encore payées par les compagnies"
                  lignes={[
                    `À réclamer : ${francs(commissions.AReclamer)}`,
                    `Réclamées non payées : ${francs(commissions.Reclamees)}${commissions.BordereauxEnAttente ? `, ${pluriel(commissions.BordereauxEnAttente, 'bordereau', 'bordereaux')}` : ''}`,
                  ]}
                />
              )}
            </div>
          )}

          <div className="cockpit-colonnes">
            {/* Points en attente */}
            <Section icone={ListChecks} titre="À traiter" sousTitre="Ce qui attend une action, d'après la base">
              {aTraiter.length === 0 ? (
                <div className="cockpit-rien">
                  <CheckCircle2 size={18} aria-hidden="true" />
                  <span>Rien en attente.</span>
                </div>
              ) : (
                <ul className="cockpit-a-traiter">
                  {aTraiter.map(({ icone: Icone, ton, vers, libelle }) => (
                    <li key={libelle}>
                      <button type="button" className={`ton-${ton}`} onClick={() => navigate(vers)}>
                        <Icone size={16} aria-hidden="true" />
                        <span>{libelle}</span>
                        <ArrowRight size={14} aria-hidden="true" className="fleche" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Production par branche : une seule mesure, une seule teinte */}
            {production && (
              <Section
                icone={Layers}
                titre={ca ? `Chiffre d'affaires ${exercice} par branche` : `Production ${exercice} par branche`}
                sousTitre={ca ? 'Commissions et accessoires du cabinet, primes TTC émises depuis le 1er janvier' : 'Primes TTC émises depuis le 1er janvier'}
              >
                {production.ParBranche.length === 0 ? (
                  <div className="cockpit-rien"><span>Aucun acte émis cette année.</span></div>
                ) : (
                  <div className="table-wrapper">
                    <table className="cockpit-branches">
                      <thead>
                        <tr><th>Branche</th><th>Actes</th>{ca && <th>Chiffre d'affaires</th>}<th>Prime TTC</th><th>{ca ? 'Part du CA' : 'Part'}</th></tr>
                      </thead>
                      <tbody>
                        {production.ParBranche.map((b, i) => {
                          const part = totalBranches ? (Math.max(b[mesurePart] || 0, 0) * 100) / totalBranches : 0;
                          return (
                            <tr key={b.IdProduit ?? b.Branche} title={`${b.Branche} : ${ca ? `${francs(b.ChiffreAffaires)} de chiffre d'affaires, ` : ''}${francs(b.PrimeTtc)} de primes, ${pluriel(b.Nombre, 'acte', 'actes')}`}>
                              <td><div className="avec-rang"><span className="cockpit-rang" aria-hidden="true">{i + 1}</span><div>{b.Branche}</div></div></td>
                              <td>{nombre(b.Nombre)}</td>
                              {ca && <td className="montant">{francs(b.ChiffreAffaires)}</td>}
                              <td className="montant">{francs(b.PrimeTtc)}</td>
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
            )}
          </div>

          {production && (
            <Section
              icone={CalendarClock}
              titre="Échéances à suivre"
              sousTitre="Polices échues depuis moins de 30 jours ou à échoir dans les 30 jours, sans renouvellement enregistré"
              action={peut('contrats.view') && <BoutonVoir libelle="Toutes les échéances" vers="/user/contracts?statut=a_renouveler" />}
            >
              {production.Echeances.Lignes.length === 0
                ? <div className="cockpit-rien"><CheckCircle2 size={18} aria-hidden="true" /><span>Aucune échéance à suivre.</span></div>
                : <DataTable columns={colonnesEcheances} data={production.Echeances.Lignes} searchable={false} itemsPerPage={8} />}
            </Section>
          )}

          {devis && (
            <Section
              icone={FileText}
              titre="Derniers devis en cours"
              sousTitre="Devis encore valables, à confirmer en contrat"
              action={peut('devis.view') && <BoutonVoir libelle="Tous les devis" vers="/user/quotes" />}
            >
              {devis.Derniers.length === 0
                ? <div className="cockpit-rien"><span>Aucun devis en cours.</span></div>
                : <DataTable columns={colonnesDevis} data={devis.Derniers} searchable={false} itemsPerPage={8} />}
            </Section>
          )}

          {production && (
            <Section
              icone={Receipt}
              titre="Derniers contrats émis"
              sousTitre="Polices et avenants les plus récents, avec leur règlement"
              action={peut('contrats.view') && <BoutonVoir libelle="Tous les contrats" vers="/user/contracts" />}
            >
              <DataTable columns={colonnesContrats} data={production.Derniers} searchable={false} itemsPerPage={8} />
            </Section>
          )}

          {!ca && !production && !devis && !caisse && !reversements && !commissions && (
            <div className="cockpit-rien"><span>Vos droits ne donnent accès à aucun chiffre du cockpit.</span></div>
          )}
        </>
      )}
    </div>
  );
};

export default UserDashboard;
