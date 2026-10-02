import { isRegistryQuote } from '../../../utils/quoteRegistry';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { crmApi, customerApi, contractApi, quoteApi, cashApi, claimsApi } from '../../../api/endpoints';
import { dataStore } from '../../../api/dataStore';
import { MetricCard } from '../../../components/common/MetricCard';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { useToast } from '../../../context/ToastContext';
import { sortUniqueBy } from '../../../utils/sortUtils';
import { formatDate } from '../../../utils/dateUtils';
import {
  User,
  Building2,
  Phone,
  Mail,
  MapPin,
  FileText,
  Shield,
  AlertTriangle,
  CreditCard,
  History,
  FolderOpen,
  Plus,
  Calendar,
  Banknote,
  CheckCircle,
  Clock,
  ArrowRight,
  Search,
  ExternalLink,
} from 'lucide-react';

export const Customer360Page = () => {
  const navigate = useNavigate();
  const { success } = useToast();
  const [searchParams] = useSearchParams();
  const initialClientId = searchParams.get('clientId') || '1';

  const [clientsList, setClientsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contractsList, setContractsList] = useState(() => dataStore.getContracts());
  const [claimsList, setClaimsList] = useState(() => dataStore.getClaims());
  const [quotesList, setQuotesList] = useState(() => dataStore.getQuotes());
  const [quittancesList, setQuittancesList] = useState(() => dataStore.getQuittances());
    const [selectedClientId, setSelectedClientId] = useState(initialClientId);
  const [clientSearch, setClientSearch] = useState('');
  const [activeTab, setActiveTab] = useState('contracts'); // 'contracts', 'claims', 'quotes', 'finance', 'history', 'documents'

  useEffect(() => {
    let isMounted = true;
    const loadRealData = async () => {
      try {
        // ?tape 1 : Charger d'abord les clients pour d?bloquer imm?diatement l'interface (< 1s)
        const cls = await customerApi.getClients().catch(() => []);
        if (isMounted && cls && cls.length > 0) {
          setClientsList(cls);
          setLoading(false); // L'interface s'affiche instantan?ment !
        }

        // ?tape 2 : Charger les donn?es m?tier en arri?re-plan sans bloquer l'utilisateur
        const [ctrs, qts, quitts, clms] = await Promise.all([
          contractApi.getContracts().catch(() => []),
          quoteApi.getQuotes().catch(() => []),
          cashApi.getQuittances().catch(() => []),
          claimsApi.getClaims().catch(() => []),
        ]);

        if (isMounted) {
          if (ctrs && ctrs.length > 0) setContractsList(ctrs);
          if (qts && qts.length > 0) setQuotesList(qts);
          if (quitts && quitts.length > 0) setQuittancesList(quitts);
          if (clms && clms.length > 0) setClaimsList(clms);
        }
      } catch (err) {
        console.error('Erreur chargement CRM 360 Django:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadRealData();
    return () => { isMounted = false; };
  }, []);

    const displayedClients = useMemo(() => {
    if (!clientSearch.trim()) return clientsList.slice(0, 150);
    const term = clientSearch.toLowerCase();
    return clientsList
      .filter((c) =>
        (c.nomcomplet || c.nom || '').toLowerCase().includes(term) ||
        (c.codeclient || '').toLowerCase().includes(term)
      )
      .slice(0, 150);
  }, [clientsList, clientSearch]);

  const client = clientsList.find((c) => String(c.id) === String(selectedClientId) || c.codeclient === selectedClientId) || clientsList[0] || {};
  const clientNameLower = (client.nom || client.nomcomplet || '').toLowerCase();

  // Related data from reactive store
  const clientContracts = contractsList.filter(
    (ctr) => clientNameLower && String(ctr.client_nom || ctr.souscripteur || '').toLowerCase().includes(clientNameLower)
  );
  const clientClaims = claimsList.filter(
    (cl) =>
      (cl.police_num && clientContracts.some((c) => c.numeropolice === cl.police_num)) ||
      (clientNameLower && String(cl.assure_nom || cl.nom_assure || '').toLowerCase().includes(clientNameLower))
  );
  const clientQuotes = quotesList.filter(isRegistryQuote).filter((q) =>
    (q.client_id && String(q.client_id) === String(client.id)) ||
    (clientNameLower && String(q.client_nom || '').toLowerCase().includes(clientNameLower)) ||
    (clientNameLower && clientNameLower.includes(String(q.client_nom || '').toLowerCase()))
  );
  const clientReceipts = quittancesList
    .filter(
      (r) => {
        const subscriberName = String(r.souscripteur || (typeof r.client === 'string' ? r.client : r.client?.nom || '')).toLowerCase();
        const policeNum = String(r.police_num || r.police_number || r.police || '');

        return (
          (clientNameLower && subscriberName && subscriberName.includes(clientNameLower)) ||
          clientContracts.some((c) => c.numeropolice && c.numeropolice === policeNum)
        );
      }
    )
    .map((r) => ({
      id: r.id || r.idquittance,
      receipt_number: r.receipt_number || r.numero_quittance || r.numeroquittance,
      police_number: r.police_number || r.police_num || r.police,
      payment_date: r.payment_date || r.date_encaissement || r.dateeffet,
      amount: r.amount || r.montant_encaisse || r.mt_encaisse || r.primenette,
      payment_method: r.payment_method || r.mode_paiement || 'VIREMENT / CH?QUE / ESP?CES',
    }));

  // Interaction logs (CRM)
  const [interactionLogs, setInteractionLogs] = useState([
    {
      id: 1,
      date: '2026-09-02',
      auteur: 'Koffi Serge',
      type: 'Appel Téléphonique',
      sujet: 'Point sur le renouvellement de la flotte automobile',
      note: 'Le client demande un devis comparatif avec inclusion de l assistance 0km.',
    },
    {
      id: 2,
      date: '2026-08-15',
      auteur: 'Yao Marc',
      type: 'Email',
      sujet: 'Transmission de la quittance d encaissement N° REC-2026-089',
      note: 'Quittance envoyée suite au virement bancaire SGCI.',
    },
    {
      id: 3,
      date: '2026-06-20',
      auteur: 'Kouadio Estelle',
      type: 'Visite Agence',
      sujet: 'Déclaration du sinistre bris de glace',
      note: 'Dépôt des pièces justificatives et orientation vers le garage partenaire.',
    },
  ]);

  const [newLog, setNewLog] = useState({ type: 'Appel Téléphonique', sujet: '', note: '' });
  const [showLogModal, setShowLogModal] = useState(false);

  const handleAddLog = async (e) => {
    e.preventDefault();
    const item = {
      id: Date.now(),
      date: new Date().toISOString().split('T')[0],
      auteur: 'Opérateur LE PHARE',
      ...newLog,
    };
    try {
      await crmApi.addInteraction({
        client_nom: client.nomcomplet || client.nom,
        type_interaction: newLog.type,
        resume: `${newLog.sujet} - ${newLog.note}`,
        auteur: 'Opérateur LE PHARE'
      });
    } catch (err) {
      console.warn('Fallback CRM interaction');
    }
    setInteractionLogs([item, ...interactionLogs]);
    setShowLogModal(false);
    setNewLog({ type: 'Appel Téléphonique', sujet: '', note: '' });
    success('Échange consigné dans le dossier CRM 360° du client.');
  };

  // Metrics calculation
  const totalPrimes = clientContracts.reduce((acc, c) => acc + (c.prime_totale || 0), 0);
  const totalImpayes = clientContracts
    .filter((c) => c.statut_encaissement !== 'Soldé')
    .reduce((acc, c) => acc + (c.prime_totale || 0), 0);

  if (loading) {
    return (
      <div style={{ padding: "5rem 1rem", display: "flex", justifyContent: "center", alignItems: "center" }}>
        <LoadingSpinner size={42} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Header & Client Switcher */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <span className="badge badge-info">Module C – CRM Fiche 360°</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Vue Institutionnelle Unique</span>
          </div>
          <h1 className="title-xl">Fiche client complète</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Tout sur un client : devis, contrats, sinistres et paiements.
          </p>
        </div>

        {/* Client quick selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '300px' }}>
          <User size={18} color="var(--text-muted)" />
          <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
            <input
              type="text"
              className="form-control"
              placeholder="Filtrer client..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              style={{ maxWidth: '160px', fontSize: '0.85rem' }}
            />
            <select
              className="form-control"
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              style={{ fontWeight: 600, flex: 1 }}
            >
              {sortUniqueBy(displayedClients, (c) => c.nomcomplet || `${c.nom} ${c.prenom || ''}`.trim()).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nomcomplet || `${c.nom} ${c.prenom || ''}`.trim()} ({c.codeclient || c.id})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Client Profile Card */}
      <div
        className="glass-panel"
        style={{
          padding: '1.75rem',
          borderRadius: 'var(--radius-xl)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.5rem',
          borderLeft: '5px solid #2563eb',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'rgba(37,99,235,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#60a5fa',
              }}
            >
              {client.type === 'Entreprise' ? <Building2 size={26} /> : <User size={26} />}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h2 className="title-lg" style={{ margin: 0 }}>
                  {client.nomcomplet || `${client.nom} ${client.prenom || ''}`.trim()}
                </h2>
                <span className={`badge ${client.typeclient === 'Entreprise' || client.type === 'Entreprise' ? 'badge-primary' : 'badge-neutral'}`}>
                  {client.typeclient || client.type || 'Particulier'}
                </span>
                {(client.Vip === 'V' || client.is_vip) && (
                  <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                    Client VIP
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                N° Assuré CIMA : <strong style={{ color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>{client.numero_assure || client.codeclient || client.id}</strong> • Matricule : <strong>{client.codeclient || client.Matricule || client.id}</strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
              <Phone size={14} color="#60a5fa" />
              <span>{client.mobile || client.telephone || client.Telephone || 'Non renseigné'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
              <Mail size={14} color="#60a5fa" />
              <span>{client.email || client.Email || 'Non renseigné'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
              <MapPin size={14} color="#60a5fa" />
              <span>{client.adresse || client.Adresse1 || 'Abidjan'}, {client.ville || 'Abidjan'}</span>
            </div>
            {client.profession && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', paddingLeft: '1.4rem' }}>
                Activité : {client.profession || client.libelleprofession}
              </div>
            )}
          </div>
        </div>

        {/* Regulatory & Legal identifiers */}
        <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Données Légales & Conformité CIMA
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                {client.typeclient === 'Entreprise' ? 'RCCM / Patente :' : 'CNI / Pièce :'}
              </span>
              <div style={{ fontWeight: 600, color: '#fbbf24' }}>{client.CniPat || 'Non renseigné'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>RIB Bancaire (24 car.) :</span>
              <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: client.Rib ? '#34d399' : 'var(--text-muted)' }}>
                {client.Rib || 'Non renseigné'}
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Statut KYC / CIMA :</span>
              <div style={{ color: client.Statut === 'V' ? '#34d399' : '#f87171', fontWeight: 700 }}>
                {client.Statut === 'V' ? 'Conforme & Validé' : client.Statut === 'S' ? 'Suspendu' : 'Actif'}
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Régime Fiscal :</span>
              <div style={{ fontWeight: 600 }}>
                {client.ExonereDeTaxes ? 'Exonéré de Taxes' : 'Taxable (CIMA)'}
              </div>
            </div>
          </div>
        </div>

        {/* Financial Highlights */}
        <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Primes Annuelle Émises</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#34d399' }}>
              {totalPrimes.toLocaleString('fr-FR')} FCFA
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Impayés / En attente</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: totalImpayes > 0 ? '#fbbf24' : '#34d399' }}>
                {totalImpayes.toLocaleString('fr-FR')} FCFA
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sinistres Déclarés</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: clientClaims.length > 0 ? '#f87171' : '#34d399' }}>
                {clientClaims.length} dossier(s)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 360 Tabs Navigation */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
        {[
          { id: 'contracts', label: `Contrats (${clientContracts.length})`, icon: <Shield size={16} /> },
          { id: 'claims', label: `Sinistres Délégués (${clientClaims.length})`, icon: <AlertTriangle size={16} /> },
          { id: 'quotes', label: `Devis (${clientQuotes.length})`, icon: <FileText size={16} /> },
          { id: 'finance', label: 'Encaissements', icon: <CreditCard size={16} /> },
          { id: 'history', label: `Journal Échanges CRM (${interactionLogs.length})`, icon: <History size={16} /> },
          { id: 'documents', label: 'Pièces Justificatives', icon: <FolderOpen size={16} /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.6rem 1rem',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: activeTab === tab.id ? 'var(--primary-color)' : 'transparent',
              color: activeTab === tab.id ? '#fff' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content 1: Contracts */}
      {activeTab === 'contracts' && (
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 className="title-md">Polices d'assurance souscrites</h3>
            <button className="btn btn-primary" onClick={() => navigate('/user/contracts')}>
              <Plus size={16} style={{ marginRight: '0.35rem' }} /> Nouvelle Souscription
            </button>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>N° Police</th>
                  <th>Branche / Produit</th>
                  <th>Compagnie Assureur</th>
                  <th>Période de Garantie</th>
                  <th>Prime TTC</th>
                  <th>Encaissement</th>
                  <th>Statut Contrat</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {clientContracts.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                      Aucun contrat actif associé à ce client.
                    </td>
                  </tr>
                ) : (
                  clientContracts.map((ctr) => (
                    <tr key={ctr.id}>
                      <td><strong style={{ color: '#34d399' }}>{ctr.numeropolice}</strong></td>
                      <td><strong>{ctr.branche || 'Automobile'}</strong></td>
                      <td>{ctr.compagnie}</td>
                      <td>{formatDate(ctr.date_effet)} au {formatDate(ctr.date_expiration)}</td>
                      <td><strong>{ctr.prime_totale?.toLocaleString('fr-FR')} FCFA</strong></td>
                      <td>
                        <StatusBadge
                          label={ctr.statut_encaissement}
                          color={ctr.statut_encaissement === 'Soldé' ? 'emerald' : 'amber'}
                        />
                      </td>
                      <td>
                        <StatusBadge label={ctr.statut} color={ctr.statut === 'Actif' ? 'emerald' : 'sky'} />
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                          onClick={() => navigate('/user/contracts')}
                        >
                          Consulter
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab Content 2: Claims */}
      {activeTab === 'claims' && (
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 className="title-md">Sinistres Délégués</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Gestion selon conventions et mandats de règlement LE PHARE.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => navigate('/user/claims')}>
              <Plus size={16} style={{ marginRight: '0.35rem' }} /> Déclarer un Sinistre
            </button>
          </div>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>N° Sinistre</th>
                  <th>Date Survenance</th>
                  <th>Police Rattachée</th>
                  <th>Nature du Sinistre</th>
                  <th>Montant Réclamé</th>
                  <th>Indemnité Accordée</th>
                  <th>Délégation LE PHARE</th>
                  <th>Statut Dossier</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {clientClaims.length === 0 ? (
                  <tr>
                    <td colSpan="9" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                      Aucun sinistre déclaré pour ce client. Sinistralité exemplaire (S/P = 0%).
                    </td>
                  </tr>
                ) : (
                  clientClaims.map((claim) => (
                    <tr key={claim.id}>
                      <td><strong style={{ color: '#f87171' }}>{claim.numero_sinistre}</strong></td>
                      <td>{formatDate(claim.date_survenance)}</td>
                      <td>{claim.police_num}</td>
                      <td>{claim.nature}</td>
                      <td>{claim.montant_reclame?.toLocaleString('fr-FR')} FCFA</td>
                      <td><strong style={{ color: '#34d399' }}>{claim.montant_indemnise?.toLocaleString('fr-FR')} FCFA</strong></td>
                      <td>
                        <span className={`badge ${claim.delegation_respectee ? 'badge-success' : 'badge-warning'}`}>
                          {claim.delegation_respectee ? 'Conforme Mandat' : 'Accord Cie Requis'}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-info">{claim.statut}</span>
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                          onClick={() => navigate(`/user/claims/detail?id=${claim.id}`)}
                        >
                          Détails
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab Content 3: Quotes */}
      {activeTab === 'quotes' && (
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 className="title-md">Devis</h3>
            <button className="btn btn-primary" onClick={() => navigate('/user/quotes')}>
              <Plus size={16} style={{ marginRight: '0.35rem' }} /> Émettre un Devis
            </button>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>N° Devis</th>
                  <th>Branche</th>
                  <th>Compagnie Cible</th>
                  <th>Date Création</th>
                  <th>Prime Annuelle</th>
                  <th>Statut</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {clientQuotes.map((q) => (
                  <tr key={q.id}>
                    <td><strong style={{ color: '#60a5fa' }}>{q.numerodevis}</strong></td>
                    <td>{q.produit}</td>
                    <td>{q.compagnie}</td>
                    <td>{q.date_emission || q.date_creation || '-'}</td>
                    <td><strong>{Number(q.prime_totale || 0).toLocaleString('fr-FR')} FCFA</strong></td>
                    <td><StatusBadge label={q.statut} color={q.statut_badge} /></td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                        onClick={() => navigate('/user/quotes')}
                      >
                        Transformer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab Content 4: Finance & Receipts */}
      {activeTab === 'finance' && (
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <h3 className="title-md" style={{ marginBottom: '1rem' }}>Quittances & Historique des Règlements</h3>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>N° Quittance</th>
                  <th>Police Rattachée</th>
                  <th>Date Émission</th>
                  <th>Montant Réglé</th>
                  <th>Mode Paiement</th>
                  <th>Statut Reversement Compagnie</th>
                </tr>
              </thead>
              <tbody>
                {clientReceipts.map((rcpt) => (
                  <tr key={rcpt.id}>
                    <td><strong style={{ color: '#fbbf24' }}>{rcpt.receipt_number}</strong></td>
                    <td>{rcpt.police_number}</td>
                    <td>{rcpt.payment_date}</td>
                    <td><strong>{rcpt.amount?.toLocaleString('fr-FR')} FCFA</strong></td>
                    <td><span className="badge badge-neutral">{rcpt.payment_method}</span></td>
                    <td>
                      <span className="badge badge-success">Reversé sous 30 jours (CIMA)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab Content 5: CRM Interaction History */}
      {activeTab === 'history' && (
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 className="title-md">Journal des Échanges</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Historique des sollicitations, appels, réunions et réclamations (CRM-02, CRM-03).
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => setShowLogModal(true)}>
              <Plus size={16} style={{ marginRight: '0.35rem' }} /> Consigner un Échange
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
            {interactionLogs.map((log) => (
              <div
                key={log.id}
                style={{
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  gap: '1rem',
                }}
              >
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    background: 'rgba(37,99,235,0.1)',
                    color: '#60a5fa',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Clock size={18} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                      {log.sujet}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{log.date}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>{log.type}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>par {log.auteur}</span>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                    {log.note}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab Content 6: Documents & GED */}
      {activeTab === 'documents' && (
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <h3 className="title-md" style={{ marginBottom: '0.5rem' }}>Pièces Justificatives</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Stockage légal des pièces d'identification, conformité CIMA et documents probants.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            {[
              { nom: 'Extrait Registre de Commerce (RCCM)', statut: 'Validé', date: '10/01/2026', type: 'PDF' },
              { nom: 'Déclaration Fiscale d Existence (DFE)', statut: 'Validé', date: '10/01/2026', type: 'PDF' },
              { nom: 'Pièce d Identité Dirigeant (CNI)', statut: 'Validé', date: '12/01/2026', type: 'PDF' },
              { nom: 'Relevé d Identité Bancaire (RIB)', statut: 'Validé', date: '15/01/2026', type: 'PDF' },
              { nom: 'Fiche Connaissance Client (KYC CIMA)', statut: 'Conforme', date: '15/01/2026', type: 'PDF' },
            ].map((doc, idx) => (
              <div
                key={idx}
                style={{
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                }}
              >
                <FileText size={28} color="#60a5fa" />
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    {doc.nom}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {doc.date} • {doc.type}
                  </div>
                </div>
                <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>
                  {doc.statut}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal: Consigner un échange */}
      <Modal
        isOpen={showLogModal}
        onClose={() => setShowLogModal(false)}
        title="Consigner un Échange / Réclamation"
        subtitle="Historisation dans la fiche 360° du client"
        maxWidth="540px"
      >
        <form onSubmit={handleAddLog} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Canal de Communication</label>
            <select
              className="form-control"
              value={newLog.type}
              onChange={(e) => setNewLog({ ...newLog, type: e.target.value })}
            >
              <option value="Appel Téléphonique">Appel Téléphonique</option>
              <option value="Email">Email</option>
              <option value="Réclamation Écrite">Réclamation Écrite (SLA 48h)</option>
              <option value="Réunion Clientèle">Réunion Clientèle</option>
              <option value="Visite Agence">Visite Agence</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Objet de l'Échange</label>
            <input
              type="text"
              className="form-control"
              required
              placeholder="ex: Demande de révision de franchise auto"
              value={newLog.sujet}
              onChange={(e) => setNewLog({ ...newLog, sujet: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Compte-rendu & Prochaines étapes</label>
            <textarea
              className="form-control"
              rows="4"
              required
              placeholder="Détails de l'entretien et engagements pris..."
              value={newLog.note}
              onChange={(e) => setNewLog({ ...newLog, note: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowLogModal(false)}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary">
              Enregistrer l'Échange
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Customer360Page;
