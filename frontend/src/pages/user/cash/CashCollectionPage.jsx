import React, { useState, useEffect } from 'react';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { cashApi, contractApi, settingsApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { CreditCard, Check, Receipt } from 'lucide-react';
import { formatDate } from '../../../utils/dateUtils';
import { printRecuEncaissement } from '../../../utils/exportUtils';
import {
  ChampsReglement,
  champsReglementApi,
  modesProposes,
  natureMode,
  reglementVide,
} from '../../../components/cash/ChampsReglement';

// Date du jour au format du champ date (AAAA-MM-JJ), en heure locale
const aujourdhui = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Quittance générée à la confirmation du devis (sp_confirmation_devis → sp_generation_quittance)
const numeroQuittance = (contract) => contract?.raw?.idquittance?.numeroquittance || '';

// Fenêtre du reçu ouverte au clic : ouverte après les appels API, le navigateur la bloquerait
const ouvrirFenetreRecu = (message) => {
  const fenetre = window.open('', '_blank');
  if (fenetre) fenetre.document.write(`<p style="font-family:Arial;padding:20px;">${message}</p>`);
  return fenetre;
};

// Message d'erreur de /api/enregistrementencaissement : { erreur, details } ou erreurs de validation
const messageErreurEncaissement = (err) => {
  const d = err.response?.data;
  if (d?.erreur) return d.details ? `${d.erreur} ${d.details}` : d.erreur;
  if (d?.detail) return d.detail;
  if (d && typeof d === 'object') {
    const premier = Object.values(d).flat()[0];
    if (typeof premier === 'string') return premier;
  }
  return "L'encaissement n'a pas pu être enregistré. Veuillez réessayer.";
};

export const CashCollectionPage = () => {
  const [contracts, setContracts] = useState([]);
  const [selectedContract, setSelectedContract] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modes, setModes] = useState([]);
  const [banques, setBanques] = useState([]);
  const { success, error: toastError } = useToast();

  const loadContracts = async () => {
    try {
      // Contrats dont la quittance reste à encaisser, derniers confirmés en tête
      const data = await contractApi.getContracts({ a_encaisser: 1 });
      if (Array.isArray(data)) {
        setContracts(data);
      }
    } catch (err) {
      console.error('Erreur chargement contrats caisse Django:', err);
    }
  };

  useEffect(() => {
    loadContracts();
    Promise.all([settingsApi.getModesEncaissement(), settingsApi.getBanques()])
      .then(([listeModes, listeBanques]) => {
        setModes(modesProposes(listeModes));
        setBanques(Array.isArray(listeBanques) ? listeBanques : []);
      })
      .catch((err) => console.error('Erreur chargement modes de paiement / banques :', err));
  }, []);

  // Payment Form State
  const [montantEncaisse, setMontantEncaisse] = useState(0);
  const [dateEncaissement, setDateEncaissement] = useState(aujourdhui());
  const [reglement, setReglement] = useState(reglementVide());
  const [enregistrement, setEnregistrement] = useState(false);
  const changerReglement = (champ, valeur) => setReglement((prev) => ({ ...prev, [champ]: valeur }));

  const handleOpenPayment = (contract) => {
    setSelectedContract(contract);
    const reste = contract.prime_totale - (contract.montant_encaisse || 0);
    setMontantEncaisse(reste > 0 ? reste : contract.prime_totale);
    const especes = modes.find((m) => natureMode(m).especes);
    setReglement({
      ...reglementVide(String(contract.client_nom || '').slice(0, 50)),
      idMode: String((especes || modes[0])?.idmodeencaissement || ''),
    });
    setDateEncaissement(aujourdhui());
    setIsModalOpen(true);
  };

  // Réimpression du reçu du dernier règlement de la quittance
  const handleShowQuittance = async (contract) => {
    const fenetre = ouvrirFenetreRecu('Préparation de la quittance…');
    try {
      const reglement = await cashApi.getDernierReglementQuittance(numeroQuittance(contract));
      await printRecuEncaissement(reglement?.iddetailencaissement, fenetre);
    } catch (err) {
      console.error('Erreur recherche du dernier règlement :', err);
      if (fenetre) fenetre.close();
      toastError('Le dernier règlement de cette quittance est introuvable.');
    }
  };

  const handleSavePayment = async (e) => {
    e.preventDefault();
    if (!selectedContract || enregistrement) return;
    const quittance = numeroQuittance(selectedContract);
    if (!quittance) {
      toastError("Ce contrat n'a pas de quittance : encaissement impossible.");
      return;
    }

    const fenetre = ouvrirFenetreRecu("Enregistrement de l'encaissement…");
    setEnregistrement(true);
    try {
      const [annee, mois, jour] = dateEncaissement.split('-');
      const mode = modes.find((m) => String(m.idmodeencaissement) === String(reglement.idMode));
      const res = await cashApi.collectPremium({
        ...champsReglementApi(reglement, mode),
        date_encaissement: `${jour}-${mois}-${annee}`,
        montant_total: Number(montantEncaisse),
        liste_quittance: [{ numero_quittance: quittance, montant_encaissement: Number(montantEncaisse) }],
      });
      setIsModalOpen(false);
      loadContracts();
      success(res.data?.message || `Règlement de ${Number(montantEncaisse).toLocaleString('fr-FR')} FCFA enregistré.`);
      const [ligne] = await cashApi.getDetailsEncaissement(res.data?.id_encaissement);
      await printRecuEncaissement(ligne?.iddetailencaissement, fenetre);
    } catch (err) {
      console.error('Erreur encaissement :', err.response?.data || err);
      if (fenetre) fenetre.close();
      toastError(messageErreurEncaissement(err));
    } finally {
      setEnregistrement(false);
    }
  };

  const columns = [
    {
      header: 'N° Police',
      accessor: 'numeropolice',
      render: (row) => <strong style={{ color: '#34d399', fontFamily: 'var(--font-mono)' }}>{row.numeropolice}</strong>,
    },
    { header: 'Souscripteur', accessor: 'client_nom' },
    { header: 'Compagnie', accessor: 'compagnie' },
    {
      // Date réelle du contrat en base : normalizeContrat met le 01/01/2026 quand elle manque
      header: "Date d'émission",
      render: (row) => formatDate(row.raw ? (row.raw.dateemission || row.raw.date_emission) : row.date_emission),
    },
    {
      header: 'Prime Totale',
      render: (row) => <span>{row.prime_totale.toLocaleString('fr-FR')} F</span>,
    },
    {
      header: 'Déjà Encaissé',
      render: (row) => <span style={{ color: '#34d399' }}>{row.montant_encaisse.toLocaleString('fr-FR')} F</span>,
    },
    {
      header: 'Reste à Encaisser',
      render: (row) => {
        const reste = row.prime_totale - row.montant_encaisse;
        return (
          <strong style={{ color: reste > 0 ? '#fb7185' : '#34d399', fontFamily: 'var(--font-mono)' }}>
            {reste.toLocaleString('fr-FR')} F
          </strong>
        );
      },
    },
    {
      header: 'Statut',
      accessor: 'statut_encaissement',
      render: (row) => <StatusBadge label={row.statut_encaissement} color={row.statut_encaissement === 'Soldé' ? 'emerald' : 'amber'} />,
    },
    {
      header: 'Action',
      render: (row) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            className="btn btn-primary"
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
            onClick={() => handleOpenPayment(row)}
          >
            <CreditCard size={14} /> Encaisser
          </button>
          {row.montant_encaisse > 0 && (
            <button
              className="btn btn-secondary"
              style={{ padding: '0.35rem 0.55rem', fontSize: '0.75rem' }}
              title="Réimprimer la quittance du dernier règlement"
              onClick={() => handleShowQuittance(row)}
            >
              <Receipt size={14} /> Quittance
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <CreditCard size={26} color="#10b981" />
          Encaissement des Primes
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Enregistrement des règlements (espèces, chèques, virements, Wave / Orange Money DistriPay) et émission des quittances.
        </p>
      </div>

      {/* CIMA Article 13 Rule Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(59, 130, 246, 0.08) 100%)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: 'var(--radius-lg)',
          padding: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: 'rgba(16, 185, 129, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#34d399',
            }}
          >
            <Receipt size={22} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              Dispositif Réglementaire – Article 13 du Code CIMA
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
              <strong>« Pas de prime, pas d'assurance »</strong> : La prise d'effet des garanties et la délivrance des attestations sont subordonnées au paiement préalable effectif.
            </div>
          </div>
        </div>
        <span className="badge badge-success" style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}>
          Conformité CIMA 100% Active
        </span>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <DataTable
          columns={columns}
          data={contracts}
          searchPlaceholder="Rechercher un contrat ou souscripteur à encaisser..."
        />
      </div>

      {/* Payment Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Enregistrement d'un Encaissement">
        {selectedContract && (
          <form onSubmit={handleSavePayment}>
            <div style={{ padding: '1rem', borderRadius: 'var(--radius-md)', background: 'rgba(30, 41, 59, 0.6)', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                <span>Police: <strong>{selectedContract.numeropolice}</strong></span>
                <span>Assuré: <strong>{selectedContract.client_nom}</strong></span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginTop: '0.35rem' }}>
                <span>Quittance: <strong>{numeroQuittance(selectedContract) || '—'}</strong></span>
                <span>Prime globale: {selectedContract.prime_totale.toLocaleString('fr-FR')} F</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.875rem', marginTop: '0.35rem' }}>
                <span>Reste dû: <strong style={{ color: '#fb7185' }}>{(selectedContract.prime_totale - selectedContract.montant_encaisse).toLocaleString('fr-FR')} F</strong></span>
              </div>
            </div>

            <div className="responsive-form-row">
              <div className="form-group">
                <label className="form-label">Montant perçu (FCFA)</label>
                <input
                  type="number"
                  className="form-control"
                  required
                  min="1"
                  value={montantEncaisse}
                  onChange={(e) => setMontantEncaisse(parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Date de paiement</label>
                <input
                  type="date"
                  className="form-control"
                  required
                  value={dateEncaissement}
                  onChange={(e) => setDateEncaissement(e.target.value)}
                />
              </div>
            </div>

            <ChampsReglement modes={modes} banques={banques} valeurs={reglement} onChange={changerReglement} />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
                Annuler
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={enregistrement}
                style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}
              >
                <Check size={18} /> {enregistrement ? 'Enregistrement…' : "Valider l'Encaissement"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};

export default CashCollectionPage;
