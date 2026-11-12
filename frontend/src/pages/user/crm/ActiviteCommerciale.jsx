import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarClock, CheckCircle2, FileText, Percent, RefreshCw,
} from 'lucide-react';

import {
  cheminDevis, francs, Jauge, nombre, pluriel, pourcent, Section, Tuile,
} from '../../../components/common/Cockpit';
import { DataTable } from '../../../components/common/DataTable';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { cockpitApi } from '../../../api/endpoints';
import { useAuth } from '../../../context/AuthContext';
import { formatDate } from '../../../utils/dateUtils';

// Activité commerciale réelle de l'exercice (GET /api/suivi-commercial/) : devis émis et transformés en contrats,
// par chargé d'affaires et par branche, devis à relancer et renouvellements à préparer
const echeance = (jours, passe, futur) => {
  if (jours < 0) return { label: `${passe} depuis ${pluriel(-jours, 'jour', 'jours')}`, color: 'red' };
  if (jours === 0) return { label: "Aujourd'hui", color: 'amber' };
  return { label: `${futur} ${pluriel(jours, 'jour', 'jours')}`, color: 'amber' };
};

const Contact = ({ telephone, email }) => {
  if (!telephone && !email) return <span style={{ color: 'var(--text-muted)' }}>Non renseigné</span>;
  return (
    <span className="crm-contact">
      {telephone && <a href={`tel:${telephone.replace(/[^\d+]/g, '')}`}>{telephone}</a>}
      {email && <a href={`mailto:${email}`}>{email}</a>}
    </span>
  );
};

const TableauSerie = ({ lignes, colonne, libelle }) => (
  lignes.length === 0 ? (
    <div className="cockpit-rien"><span>Aucun devis émis cette année.</span></div>
  ) : (
    <div className="table-wrapper">
      <table className="cockpit-branches">
        <thead>
          <tr>
            <th>{libelle}</th>
            <th className="nombre">Émis</th>
            <th className="nombre">Confirmés</th>
            <th className="nombre">Transformation</th>
            <th className="nombre">Primes transformées</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l[colonne.cle] ?? l[colonne.libelle]}>
              <td>
                {l[colonne.libelle]}
                {l.EnCours > 0 && <span className="secondaire">{pluriel(l.EnCours, 'devis encore valable', 'devis encore valables')}, {francs(l.PrimeEnCours)}</span>}
              </td>
              <td className="nombre">{nombre(l.Emis)}</td>
              <td className="nombre">{nombre(l.Confirmes)}</td>
              <td className="nombre">{pourcent(l.Taux)}</td>
              <td className="nombre montant">
                {francs(l.PrimeTransformee)}
                <span className="secondaire">sur {francs(l.PrimeProposee)} proposés</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
);

export const ActiviteCommerciale = () => {
  const navigate = useNavigate();
  const { peut } = useAuth();
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    try {
      setDonnees(await cockpitApi.suiviCommercial());
    } catch (err) {
      console.error('Erreur chargement du suivi commercial :', err);
      setErreur(err?.response?.data?.detail || "L'activité commerciale n'a pas pu être chargée : le serveur ou la base de données ne répond pas.");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  if (!donnees && chargement) return <LoadingSpinner text="Calcul de l'activité commerciale…" />;
  if (!donnees) {
    return (
      <div className="cockpit-erreur" role="alert">
        <AlertTriangle size={18} aria-hidden="true" />
        <span>{erreur}</span>
        <button type="button" className="btn btn-secondary" onClick={charger}>Réessayer</button>
      </div>
    );
  }

  const { Devis: devis, ARelancer: relances, Renouvellements: renouvellements, Exercice: n } = donnees;
  const peutDevis = peut('devis.view');
  const peutContrats = peut('contrats.view');

  const colonnesRelances = [
    { header: 'N° Devis', accessor: 'NumeroDevis', render: (r) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{r.NumeroDevis}</strong> },
    { header: 'Client', accessor: 'Client', render: (r) => r.Client || '-' },
    { header: 'Contact', render: (r) => <Contact telephone={r.Telephone} email={r.Email} /> },
    { header: 'Branche', accessor: 'Branche' },
    { header: 'Chargé', accessor: 'Auteur' },
    {
      header: 'Validité', accessor: 'DateExpiration',
      render: (r) => {
        const e = echeance(r.Jours, 'Expiré', 'Expire dans');
        return <div><div>{formatDate(r.DateExpiration)}</div><StatusBadge label={e.label} color={e.color} /></div>;
      },
    },
    { header: 'Prime TTC', accessor: 'PrimeTtc', render: (r) => <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{francs(r.PrimeTtc)}</span> },
    {
      header: 'Action',
      render: (r) => (peutDevis
        ? <button type="button" className="btn btn-secondary cockpit-bouton-ligne" onClick={() => navigate(cheminDevis(r.IdProduit, r.IdDevis))}>Ouvrir</button>
        : null),
    },
  ];

  const colonnesRenouvellements = [
    { header: 'N° Police', accessor: 'NumeroPolice', render: (r) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{r.NumeroPolice}</strong> },
    { header: 'Client', accessor: 'Client', render: (r) => r.Client || '-' },
    { header: 'Contact', render: (r) => <Contact telephone={r.Telephone} /> },
    { header: 'Branche', accessor: 'Branche' },
    { header: 'Compagnie', accessor: 'Compagnie' },
    {
      header: 'Échéance', accessor: 'DateExpiration',
      render: (r) => {
        const e = echeance(r.Jours, 'Échue', 'Dans');
        return <div><div>{formatDate(r.DateExpiration)}</div><StatusBadge label={e.label} color={e.color} /></div>;
      },
    },
    { header: 'Prime TTC', accessor: 'PrimeTtc', render: (r) => <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{francs(r.PrimeTtc)}</span> },
    {
      header: 'Action',
      render: (r) => {
        if (r.DevisEnCours) return <StatusBadge label="Devis préparé" color="emerald" />;
        return peutContrats
          ? <button type="button" className="btn btn-primary cockpit-bouton-ligne" onClick={() => navigate(`/user/contracts/${r.IdContrat}/renouvellement`)}>Renouveler</button>
          : null;
      },
    },
  ];

  return (
    <div className={`cockpit${chargement ? ' cockpit-chargement' : ''}`} aria-busy={chargement}>
      <div className="cockpit-tuiles">
        <Tuile
          titre={`Devis émis en ${n}`}
          valeur={nombre(devis.Emis)}
          icone={FileText}
          couleur="blue"
          vers={peutDevis ? '/user/quotes' : undefined}
          aide="Devis enregistrés (numéro attribué, prime non nulle) depuis le 1er janvier, hors affaires antérieures"
          lignes={[
            `${francs(devis.PrimeProposee)} de primes proposées`,
            `Même période ${n - 1} : ${pluriel(devis.Precedent.Emis, 'devis', 'devis')}`,
          ]}
        />
        <Tuile
          titre="Transformation en contrats"
          valeur={pourcent(devis.Taux)}
          icone={Percent}
          couleur="emerald"
          aide="Devis émis depuis le 1er janvier et déjà confirmés en contrat"
          lignes={[
            `${nombre(devis.Confirmes)} devis confirmés, ${francs(devis.PrimeTransformee)}`,
            <Jauge taux={devis.Taux} libelle="Taux de transformation" />,
            devis.Precedent.Taux !== null && `Même période ${n - 1} : ${pourcent(devis.Precedent.Taux)}`,
          ]}
        />
        <Tuile
          titre="Devis à relancer"
          valeur={nombre(relances.AEcheance + relances.Echus)}
          icone={CalendarClock}
          couleur="amber"
          aide={`Devis non confirmés dont la validité expire dans les ${relances.Jours} jours ou a expiré depuis ${relances.Jours} jours au plus`}
          lignes={[
            `${pluriel(relances.AEcheance, 'expire', 'expirent')} dans les ${relances.Jours} jours`,
            `${pluriel(relances.Echus, 'expiré', 'expirés')} depuis moins de ${relances.Jours} jours`,
            `${francs(relances.PrimeTtc)} de primes en jeu`,
          ]}
        />
        <Tuile
          titre="Renouvellements à préparer"
          valeur={nombre(renouvellements.AEchoir + renouvellements.Echues)}
          icone={RefreshCw}
          couleur="purple"
          vers={peutContrats ? '/user/contracts?statut=a_renouveler' : undefined}
          aide="Polices sans renouvellement enregistré, à échoir ou échues depuis peu"
          lignes={[
            `${pluriel(renouvellements.AEchoir, 'police', 'polices')} à échoir dans les ${renouvellements.AEchoirJours} jours`,
            `${pluriel(renouvellements.Echues, 'police échue', 'polices échues')} depuis moins de ${renouvellements.EchuesDepuisJours} jours`,
            `${francs(renouvellements.PrimeTtc)} de primes, ${pluriel(renouvellements.AvecDevis, 'devis préparé', 'devis préparés')}`,
          ]}
        />
      </div>

      <div className="cockpit-colonnes" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' }}>
        <Section titre="Par chargé d'affaires" sousTitre={`Devis émis en ${n} par leur auteur ; devis importés sans auteur`}>
          <TableauSerie lignes={devis.ParAuteur} colonne={{ cle: 'IdOperateur', libelle: 'Nom' }} libelle="Chargé d'affaires" />
        </Section>
        <Section titre="Par branche" sousTitre={`Devis émis en ${n} et part confirmée en contrat`}>
          <TableauSerie lignes={devis.ParBranche} colonne={{ cle: 'IdProduit', libelle: 'Branche' }} libelle="Branche" />
        </Section>
      </div>

      <Section
        titre="Devis à relancer"
        sousTitre={`Devis non confirmés expirant dans les ${relances.Jours} jours ou expirés depuis ${relances.Jours} jours au plus, les plus urgents d'abord`}
      >
        {relances.Lignes.length === 0
          ? <div className="cockpit-rien"><CheckCircle2 size={18} aria-hidden="true" /><span>Aucun devis à relancer.</span></div>
          : <DataTable columns={colonnesRelances} data={relances.Lignes} searchable={relances.Lignes.length > 8} itemsPerPage={8} />}
      </Section>

      <Section
        titre="Renouvellements à préparer"
        sousTitre={`Polices à échoir dans les ${renouvellements.AEchoirJours} jours ou échues depuis moins de ${renouvellements.EchuesDepuisJours} jours, sans renouvellement enregistré`}
      >
        {renouvellements.Lignes.length === 0
          ? <div className="cockpit-rien"><CheckCircle2 size={18} aria-hidden="true" /><span>Aucun renouvellement à préparer.</span></div>
          : <DataTable columns={colonnesRenouvellements} data={renouvellements.Lignes} searchable={renouvellements.Lignes.length > 8} itemsPerPage={8} />}
      </Section>
    </div>
  );
};

export default ActiviteCommerciale;
