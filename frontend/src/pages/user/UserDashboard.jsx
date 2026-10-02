import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MetricCard } from '../../components/common/MetricCard';
import { DataTable } from '../../components/common/DataTable';
import { StatusBadge } from '../../components/common/StatusBadge';
import { quoteApi, contractApi } from '../../api/endpoints';
import {
  FileText,
  ShieldCheck,
  CreditCard,
  Car,
  PlusCircle,
  Home,
  Users,
  ArrowUpRight,
  TrendingUp,
} from 'lucide-react';

import { isRegistryQuote } from '../../utils/quoteRegistry';
import { moduleActif, TITRE_MODULE_INACTIF } from '../../utils/modulesActifs';
import { formatDate } from '../../utils/dateUtils';
export const UserDashboard = () => {
  const navigate = useNavigate();

  const [quotes, setQuotes] = useState([]);
  const [contracts, setContracts] = useState([]);

  useEffect(() => {
    let isMounted = true;
    const loadDashboardData = async () => {
      try {
        const [qList, cList] = await Promise.all([
          quoteApi.getQuotes(),
          contractApi.getContracts(),
        ]);
        if (isMounted) {
          if (Array.isArray(qList)) setQuotes(qList.filter(isRegistryQuote));
          if (Array.isArray(cList)) setContracts(cList);
        }
      } catch (err) {
        console.error('Erreur chargement dashboard:', err);
      }
    };
    loadDashboardData();
    return () => { isMounted = false; };
  }, []);

  const totalPrimes = contracts.reduce((acc, c) => acc + (c.prime_totale || 0), 0);

  const quoteColumns = [
    { header: 'N° Devis', accessor: 'numerodevis', render: (row) => <strong style={{ color: '#60a5fa' }}>{row.numerodevis}</strong> },
    { header: 'Client', accessor: 'client_nom' },
    { header: 'Branche / Produit', accessor: 'produit' },
    { header: 'Compagnie', accessor: 'compagnie' },
    {
      header: 'Prime Totale',
      accessor: 'prime_totale',
      render: (row) => <span>{Number(row.prime_totale || 0).toLocaleString('fr-FR')} FCFA</span>,
    },
    {
      header: 'Statut',
      accessor: 'statut',
      render: (row) => <StatusBadge label={row.statut} color={row.statut_badge} />,
    },
    {
      header: 'Action',
      render: (row) => (
        <button
          className="btn btn-secondary"
          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
          onClick={() => navigate('/user/quotes')}
        >
          Consulter
        </button>
      ),
    },
  ];

  const contractColumns = [
    { header: 'N° Police', accessor: 'numeropolice', render: (row) => <strong style={{ color: '#34d399' }}>{row.numeropolice}</strong> },
    { header: 'Client', accessor: 'client_nom' },
    { header: 'Compagnie', accessor: 'compagnie' },
    { header: 'Période', render: (row) => `${formatDate(row.date_effet)} au ${formatDate(row.date_expiration)}` },
    {
      header: 'Prime',
      accessor: 'prime_totale',
      render: (row) => <span>{Number(row.prime_totale || 0).toLocaleString('fr-FR')} FCFA</span>,
    },
    {
      header: 'Règlement',
      accessor: 'statut_encaissement',
      render: (row) => <StatusBadge label={row.statut_encaissement} color={row.statut_encaissement === 'Soldé' ? 'emerald' : 'amber'} />,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Top Banner & Quick Actions */}
      <div
        className="glass-panel"
        style={{
          padding: '1.75rem 2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1.25rem',
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
        }}
      >
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            Exploitation & Souscription
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.35rem' }}>
            Portail de gestion des polices, cotations, attestations et encaissements.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => navigate('/user/quotes/auto')}>
            <Car size={16} />
            <span>Nouveau Devis Auto</span>
          </button>
          <button
            className={`btn btn-secondary${moduleActif('mrh') ? '' : ' module-ferme'}`}
            onClick={() => navigate('/user/quotes/mrh')}
            disabled={!moduleActif('mrh')}
            title={moduleActif('mrh') ? undefined : TITRE_MODULE_INACTIF}
          >
            <Home size={16} />
            <span>Devis MRH</span>
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/user/clients')}>
            <Users size={16} />
            <span>Nouveau Client</span>
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/user/cash')}>
            <CreditCard size={16} />
            <span>Encaisser Prime</span>
          </button>
        </div>
      </div>

      {/* KPI Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
        <MetricCard
          title="Devis En Cours"
          value={quotes.length}
          subtext="À confirmer"
          trend="+12% cette semaine"
          icon={FileText}
          color="blue"
        />
        <MetricCard
          title="Contrats Actifs"
          value={contracts.length}
          subtext="Polices en vigueur"
          trend="+8 nouvelles polices"
          icon={ShieldCheck}
          color="emerald"
        />
        <MetricCard
          title="Primes Émises"
          value={`${Number(totalPrimes || 0).toLocaleString('fr-FR')} F`}
          subtext="Total production courante"
          trend="+18.4%"
          icon={TrendingUp}
          color="purple"
        />
        <MetricCard
          title="Attestations ASACI"
          value={`${contracts.length} délivrées`}
          subtext="Taux de conformité 100%"
          trend="En direct ASACI"
          icon={Car}
          color="amber"
        />
      </div>

      {/* Main Section: Recent Quotes & Recent Contracts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
        {/* Recent Quotes */}
        <div className="glass-panel" style={{ padding: '1.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div>
              <h2 className="title-md" style={{ color: '#fff' }}>Derniers Devis</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Propositions prêtes à être converties en police</p>
            </div>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
              onClick={() => navigate('/user/quotes')}
            >
              Voir tous les devis
              <ArrowUpRight size={14} />
            </button>
          </div>
          <DataTable columns={quoteColumns} data={quotes} searchable={false} itemsPerPage={5} />
        </div>

        {/* Recent Contracts */}
        <div className="glass-panel" style={{ padding: '1.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div>
              <h2 className="title-md" style={{ color: '#fff' }}>Derniers Contrats Émis</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Polices confirmées dans le portefeuille LE PHARE</p>
            </div>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
              onClick={() => navigate('/user/contracts')}
            >
              Voir tous les contrats
              <ArrowUpRight size={14} />
            </button>
          </div>
          <DataTable columns={contractColumns} data={contracts} searchable={false} itemsPerPage={5} />
        </div>
      </div>
    </div>
  );
};

export default UserDashboard;
