import React, { useState, useEffect, useMemo } from 'react';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { Receipt, Plus, Trash2, AlertTriangle, RotateCcw, Ban, BellRing } from 'lucide-react';
import { cashApi, customerApi, settingsApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { formatDate } from '../../../utils/dateUtils';
import { printRecuEncaissement } from '../../../utils/exportUtils';
import {
  ChampsReglement,
  champsReglementApi,
  modesProposes,
  natureMode,
  reglementVide,
} from '../../../components/cash/ChampsReglement';

const fcfa = (v) => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} F`;

// Date du jour au format du champ date (AAAA-MM-JJ), en heure locale
const aujourdhui = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const versJjMmAaaa = (iso) => iso.split('-').reverse().join('-');

// Statuts du chèque (stdcheque.statut)
const STATUTS = [
  { code: 'A_DEPOSER', libelle: 'À déposer', couleur: 'blue' },
  { code: 'ENCAISSE', libelle: 'Encaissé', couleur: 'emerald' },
  { code: 'IMPAYE', libelle: 'Impayé', couleur: 'rose' },
  { code: 'REENCAISSE', libelle: 'Réencaissé', couleur: 'amber' },
];
const statut = (code) => STATUTS.find((s) => s.code === code) || STATUTS[1];

// Échéancier : alerte un mois avant la date de dépôt, rappel quinze jours après l'alerte
const ALERTES = {
  ALERTE: { libelle: 'Alerte', couleur: 'amber' },
  RAPPEL: { libelle: 'Rappel', couleur: 'rose' },
  ECHU: { libelle: 'Échu', couleur: 'rose' },
};

// Message d'erreur d'API : { erreur, details } ou erreurs de validation DRF
const messageErreur = (err, defaut) => {
  const d = err.response?.data;
  if (d?.erreur) return d.details ? `${d.erreur} ${d.details}` : d.erreur;
  if (d?.detail) return d.detail;
  if (d && typeof d === 'object') {
    const premier = Object.values(d).flat(Infinity)[0];
    if (typeof premier === 'string') return premier;
  }
  return defaut;
};

const ligneVide = () => ({ numero: '', montant: '', date: '' });

// Portefeuille des chèques (stdcheque) : chèques reçus en caisse et chèques remis d'avance par
// un client avec un échéancier de dépôt ; suivi des impayés (décaissement puis réencaissement).
export const ChequeManagementPage = () => {
  const { success, error: toastError } = useToast();
  const [cheques, setCheques] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filtre, setFiltre] = useState('TOUS');
  const [banques, setBanques] = useState([]);
  const [modes, setModes] = useState([]);
  const [envoi, setEnvoi] = useState(false);

  const chargerCheques = async () => {
    setIsLoading(true);
    try {
      const data = await cashApi.getCheques();
      setCheques((Array.isArray(data) ? data : []).map((ch) => {
        const montant = Number(ch.montant_initial) || 0;
        const solde = Number(ch.solde_disponible) || 0;
        return {
          ...ch,
          id: ch.id_cheque,
          montant,
          solde,
          affecte: ch.statut === 'A_DEPOSER' ? 0 : montant - solde,
          // Clés lues par la recherche du DataTable : client puis n° de chèque
          client_nom: ch.client_nom || ch.clients || '',
          police: ch.numero_cheque,
        };
      }));
    } catch (err) {
      console.error('Erreur chargement chèques :', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    chargerCheques();
    Promise.all([settingsApi.getBanques(), settingsApi.getModesEncaissement()])
      .then(([listeBanques, listeModes]) => {
        setBanques(Array.isArray(listeBanques) ? listeBanques : []);
        setModes(modesProposes(listeModes));
      })
      .catch((err) => console.error('Erreur chargement banques / modes :', err));
  }, []);

  const alertes = useMemo(
    () => cheques.filter((c) => c.niveau_alerte).sort((a, b) => String(a.date_echeance).localeCompare(String(b.date_echeance))),
    [cheques],
  );
  const chequesAffiches = filtre === 'TOUS' ? cheques : cheques.filter((c) => c.statut === filtre);
  const soldeTotal = cheques.filter((c) => c.statut === 'ENCAISSE').reduce((s, c) => s + c.solde, 0);

  // ---------------------------------------------------------------------------------------------
  // Échéancier : plusieurs chèques d'un client, chacun avec sa date de dépôt
  // ---------------------------------------------------------------------------------------------
  const [echeancierOuvert, setEcheancierOuvert] = useState(false);
  const [clients, setClients] = useState([]);
  const [chargementClients, setChargementClients] = useState(false);
  const [rechercheClient, setRechercheClient] = useState('');
  const [echeancier, setEcheancier] = useState({ idClient: '', idBanque: '', observation: '', lignes: [ligneVide()] });

  const ouvrirEcheancier = () => {
    setEcheancier({ idClient: '', idBanque: '', observation: '', lignes: [ligneVide(), ligneVide(), ligneVide()] });
    setRechercheClient('');
    setEcheancierOuvert(true);
    if (clients.length === 0 && !chargementClients) {
      setChargementClients(true);
      customerApi.getClients()
        .then((liste) => setClients((Array.isArray(liste) ? liste : []).map((c) => ({
          id: c.IdClient ?? c.id,
          nom: c.nomcomplet || `${c.Nom || c.nom || ''} ${c.Prenoms || c.prenom || ''}`.trim(),
        })).filter((c) => c.id && c.nom).sort((a, b) => a.nom.localeCompare(b.nom))))
        .catch((err) => console.error('Erreur chargement clients :', err))
        .finally(() => setChargementClients(false));
    }
  };
  const clientsFiltres = useMemo(() => {
    const q = rechercheClient.trim().toLowerCase();
    return (q ? clients.filter((c) => c.nom.toLowerCase().includes(q)) : clients).slice(0, 200);
  }, [clients, rechercheClient]);
  const changerLigne = (index, champ, valeur) => setEcheancier((prev) => ({
    ...prev,
    lignes: prev.lignes.map((l, i) => (i === index ? { ...l, [champ]: valeur } : l)),
  }));
  const lignesSaisies = echeancier.lignes.filter((l) => l.numero.trim() || l.montant || l.date);
  const totalEcheancier = lignesSaisies.reduce((s, l) => s + (Number(l.montant) || 0), 0);

  const enregistrerEcheancier = async (e) => {
    e.preventDefault();
    if (envoi) return;
    if (!echeancier.idClient) {
      toastError('Choisissez le client qui remet les chèques.');
      return;
    }
    if (lignesSaisies.length === 0 || lignesSaisies.some((l) => !l.numero.trim() || !(Number(l.montant) > 0) || !l.date)) {
      toastError('Chaque chèque doit avoir un numéro, un montant et une date de dépôt.');
      return;
    }
    setEnvoi(true);
    try {
      const res = await cashApi.enregistrerEcheancier({
        id_client: Number(echeancier.idClient),
        id_banque: Number(echeancier.idBanque),
        observation: echeancier.observation.trim(),
        cheques: lignesSaisies.map((l) => ({ numero_cheque: l.numero.trim(), montant: Number(l.montant), date_echeance: l.date })),
      });
      success(res.data?.message || 'Échéancier enregistré.');
      setEcheancierOuvert(false);
      chargerCheques();
    } catch (err) {
      toastError(messageErreur(err, "L'échéancier n'a pas pu être enregistré."));
    } finally {
      setEnvoi(false);
    }
  };

  const retirerCheque = async (cheque) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Retirer le chèque n° ${cheque.numero_cheque} de l'échéancier ?`)) return;
    try {
      await cashApi.supprimerCheque(cheque.id);
      success(`Chèque n° ${cheque.numero_cheque} retiré de l'échéancier.`);
      chargerCheques();
    } catch (err) {
      toastError(messageErreur(err, 'Le chèque n\'a pas pu être retiré.'));
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Chèque impayé : décaissement (motif), puis réencaissement (références)
  // ---------------------------------------------------------------------------------------------
  const [decaissement, setDecaissement] = useState(null); // { cheque, motif, date }

  const enregistrerDecaissement = async (e) => {
    e.preventDefault();
    if (envoi) return;
    setEnvoi(true);
    try {
      const res = await cashApi.decaisserCheque(decaissement.cheque.id, {
        motif: decaissement.motif.trim(),
        date_decaissement: decaissement.date,
      });
      success(res.data?.message || 'Chèque déclaré impayé.');
      setDecaissement(null);
      chargerCheques();
    } catch (err) {
      toastError(messageErreur(err, "Le décaissement n'a pas pu être enregistré."));
    } finally {
      setEnvoi(false);
    }
  };

  const [reencaissement, setReencaissement] = useState(null); // { cheque, quittances, references, date, reglement }

  const ouvrirReencaissement = async (cheque) => {
    try {
      const quittances = await cashApi.getQuittancesCheque(cheque.id);
      const reste = (Number(cheque.montant_impaye) || 0) - (Number(cheque.montant_reencaisse) || 0);
      // Montant à réencaisser réparti sur les quittances réglées par le chèque, dans l'ordre
      let aRepartir = reste > 0 ? reste : (Number(cheque.montant_impaye) || 0);
      const lignes = (Array.isArray(quittances) ? quittances : []).map((q) => {
        const montant = Math.min(Number(q.montant) || 0, aRepartir);
        aRepartir -= montant;
        return { numero: q.numero_quittance, client: q.client, montant: String(Math.round(montant)) };
      });
      const especes = modes.find((m) => natureMode(m).especes);
      setReencaissement({
        cheque,
        quittances: lignes,
        references: '',
        date: aujourdhui(),
        reglement: { ...reglementVide(String(cheque.client_nom || '').slice(0, 50)), idMode: String((especes || modes[0])?.idmodeencaissement || '') },
      });
    } catch (err) {
      toastError(messageErreur(err, 'Les quittances de ce chèque sont introuvables.'));
    }
  };
  const totalReencaissement = (reencaissement?.quittances || []).reduce((s, q) => s + (Number(q.montant) || 0), 0);

  const enregistrerReencaissement = async (e) => {
    e.preventDefault();
    if (envoi || !reencaissement) return;
    const liste = reencaissement.quittances.filter((q) => Number(q.montant) > 0);
    if (liste.length === 0) {
      toastError('Indiquez le montant réencaissé sur au moins une quittance.');
      return;
    }
    // Fenêtre du reçu ouverte au clic : ouverte après les appels API, le navigateur la bloquerait
    const fenetre = window.open('', '_blank');
    if (fenetre) fenetre.document.write('<p style="font-family:Arial;padding:20px;">Enregistrement du réencaissement…</p>');
    setEnvoi(true);
    try {
      const mode = modes.find((m) => String(m.idmodeencaissement) === String(reencaissement.reglement.idMode));
      const res = await cashApi.collectPremium({
        ...champsReglementApi(reencaissement.reglement, mode),
        date_encaissement: versJjMmAaaa(reencaissement.date),
        montant_total: liste.reduce((s, q) => s + Number(q.montant), 0),
        liste_quittance: liste.map((q) => ({ numero_quittance: q.numero, montant_encaissement: Number(q.montant) })),
        reference_reencaissement: reencaissement.references.trim(),
        id_cheque_impaye: reencaissement.cheque.id,
      });
      success(res.data?.message || 'Réencaissement enregistré.');
      setReencaissement(null);
      chargerCheques();
      const [ligne] = await cashApi.getDetailsEncaissement(res.data?.id_encaissement);
      await printRecuEncaissement(ligne?.iddetailencaissement, fenetre);
    } catch (err) {
      if (fenetre) fenetre.close();
      toastError(messageErreur(err, "Le réencaissement n'a pas pu être enregistré."));
    } finally {
      setEnvoi(false);
    }
  };

  // ---------------------------------------------------------------------------------------------
  const columns = [
    { header: 'N° Chèque', accessor: 'numero_cheque', render: (row) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{row.numero_cheque}</strong> },
    { header: 'Banque', accessor: 'nom_banque' },
    { header: 'Client', accessor: 'client_nom' },
    {
      header: 'Dépôt',
      render: (row) => (row.statut === 'A_DEPOSER'
        ? <span>Prévu le <strong>{formatDate(row.date_echeance)}</strong></span>
        : formatDate(row.date_depot || row.date_saisie)),
    },
    { header: 'Montant', render: (row) => <strong>{fcfa(row.montant)}</strong> },
    {
      header: 'Affecté / Solde',
      render: (row) => (row.statut === 'A_DEPOSER' ? '—' : (
        <span>
          <span style={{ color: '#34d399' }}>{fcfa(row.affecte)}</span>
          {' / '}
          <span style={{ color: row.solde > 0 ? '#fbbf24' : 'var(--text-muted)' }}>{fcfa(row.solde)}</span>
        </span>
      )),
    },
    { header: 'Quittance(s)', accessor: 'quittances_reglees', render: (row) => <span style={{ fontFamily: 'var(--font-mono)' }}>{row.quittances_reglees || '—'}</span> },
    {
      header: 'Statut',
      accessor: 'statut_libelle',
      render: (row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
          <StatusBadge label={statut(row.statut).libelle} color={statut(row.statut).couleur} />
          {row.niveau_alerte && <StatusBadge label={ALERTES[row.niveau_alerte].libelle} color={ALERTES[row.niveau_alerte].couleur} />}
          {row.statut === 'IMPAYE' && Number(row.montant_reencaisse) > 0 && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Réencaissé : {fcfa(row.montant_reencaisse)} / {fcfa(row.montant_impaye)}</span>
          )}
        </div>
      ),
    },
    {
      header: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {row.statut === 'ENCAISSE' && Number(row.nombre_operations) > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem', color: '#f87171' }}
              title="Chèque revenu impayé : annule ses encaissements"
              onClick={() => setDecaissement({ cheque: row, motif: '', date: aujourdhui() })}
            >
              <Ban size={13} /> Impayé
            </button>
          )}
          {row.statut === 'IMPAYE' && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem' }}
              title="Réencaisser les quittances réglées par ce chèque"
              onClick={() => ouvrirReencaissement(row)}
            >
              <RotateCcw size={13} /> Réencaisser
            </button>
          )}
          {row.statut === 'A_DEPOSER' && Number(row.nombre_operations) === 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem' }}
              title="Retirer ce chèque de l'échéancier"
              onClick={() => retirerCheque(row)}
            >
              <Trash2 size={13} /> Retirer
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Receipt size={26} color="#fbbf24" />
            Portefeuille des Chèques
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Chèques reçus en caisse, échéanciers de chèques à déposer et suivi des chèques impayés.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={ouvrirEcheancier}>
          <Plus size={16} /> Nouvel échéancier
        </button>
      </div>

      {alertes.length > 0 && (
        <div className="glass-panel" style={{ padding: '1rem 1.25rem', border: '1px solid rgba(245, 158, 11, 0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, marginBottom: '0.6rem', color: '#fbbf24' }}>
            <BellRing size={18} /> {alertes.length} chèque{alertes.length > 1 ? 's' : ''} à déposer
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem' }}>
            {alertes.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <StatusBadge label={ALERTES[c.niveau_alerte].libelle} color={ALERTES[c.niveau_alerte].couleur} />
                <span>
                  Chèque <strong style={{ fontFamily: 'var(--font-mono)' }}>{c.numero_cheque}</strong> ({c.nom_banque}) de <strong>{c.client_nom}</strong>,
                  {' '}{fcfa(c.montant)} — {c.niveau_alerte === 'ECHU' ? 'à déposer depuis le' : 'dépôt prévu le'} <strong>{formatDate(c.date_echeance)}</strong>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {[{ code: 'TOUS', libelle: 'Tous' }, ...STATUTS].map((s) => {
            const nombre = s.code === 'TOUS' ? cheques.length : cheques.filter((c) => c.statut === s.code).length;
            return (
              <button
                key={s.code}
                type="button"
                className={`btn ${filtre === s.code ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                onClick={() => setFiltre(s.code)}
              >
                {s.libelle} ({nombre})
              </button>
            );
          })}
        </div>
        {!isLoading && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Solde disponible des chèques encaissés : <strong>{fcfa(soldeTotal)}</strong>.
            {' '}Un chèque de l'échéancier s'encaisse depuis « Encaisser primes » avec son numéro et sa banque.
          </p>
        )}
        <DataTable columns={columns} data={chequesAffiches} loading={isLoading} searchPlaceholder="Rechercher par client ou n° de chèque..." />
      </div>

      {/* Échéancier de chèques d'un client */}
      <Modal isOpen={echeancierOuvert} onClose={() => setEcheancierOuvert(false)} title="Nouvel échéancier de chèques" size="large">
        <form onSubmit={enregistrerEcheancier}>
          <div className="responsive-form-row">
            <div className="form-group">
              <label className="form-label">Client (* requis)</label>
              <input
                type="text"
                className="form-control"
                placeholder="Rechercher un client…"
                value={rechercheClient}
                onChange={(e) => setRechercheClient(e.target.value)}
                style={{ marginBottom: '0.4rem' }}
              />
              <select
                className="form-control"
                required
                value={echeancier.idClient}
                onChange={(e) => setEcheancier((prev) => ({ ...prev, idClient: e.target.value }))}
              >
                <option value="">{chargementClients ? 'Chargement des clients…' : '— Choisir —'}</option>
                {clientsFiltres.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Banque des chèques (* requis)</label>
              <select
                className="form-control"
                required
                value={echeancier.idBanque}
                onChange={(e) => setEcheancier((prev) => ({ ...prev, idBanque: e.target.value }))}
              >
                <option value="">— Choisir —</option>
                {banques.map((b) => <option key={b.idbanque} value={b.idbanque}>{b.libelle}</option>)}
              </select>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', margin: '0.5rem 0 0.75rem' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '0.35rem' }}>N° du chèque</th>
                <th style={{ padding: '0.35rem' }}>Montant (FCFA)</th>
                <th style={{ padding: '0.35rem' }}>Date de dépôt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {echeancier.lignes.map((l, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  <td style={{ padding: '0.25rem' }}>
                    <input type="text" className="form-control" maxLength={50} value={l.numero}
                      onChange={(e) => changerLigne(i, 'numero', e.target.value.replace(/[^\p{L}\p{N} \-/._]/gu, ''))} />
                  </td>
                  <td style={{ padding: '0.25rem' }}>
                    <input type="number" className="form-control" min="1" value={l.montant} onChange={(e) => changerLigne(i, 'montant', e.target.value)} />
                  </td>
                  <td style={{ padding: '0.25rem' }}>
                    <input type="date" className="form-control" value={l.date} onChange={(e) => changerLigne(i, 'date', e.target.value)} />
                  </td>
                  <td style={{ padding: '0.25rem', width: '1%' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.45rem' }}
                      title="Retirer cette ligne"
                      disabled={echeancier.lignes.length === 1}
                      onClick={() => setEcheancier((prev) => ({ ...prev, lignes: prev.lignes.filter((_, j) => j !== i) }))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}
              onClick={() => setEcheancier((prev) => ({ ...prev, lignes: [...prev.lignes, ligneVide()] }))}>
              <Plus size={14} /> Ajouter un chèque
            </button>
            <span style={{ fontSize: '0.85rem' }}>{lignesSaisies.length} chèque(s) · total <strong>{fcfa(totalEcheancier)}</strong></span>
          </div>
          <div className="form-group">
            <label className="form-label">Observation</label>
            <input type="text" className="form-control" maxLength={255} value={echeancier.observation}
              onChange={(e) => setEcheancier((prev) => ({ ...prev, observation: e.target.value }))} />
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Une alerte signale chaque chèque un mois avant sa date de dépôt, puis un rappel quinze jours plus tard.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setEcheancierOuvert(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={envoi}>{envoi ? 'Enregistrement…' : "Enregistrer l'échéancier"}</button>
          </div>
        </form>
      </Modal>

      {/* Décaissement d'un chèque impayé */}
      <Modal isOpen={Boolean(decaissement)} onClose={() => setDecaissement(null)} title="Chèque impayé : décaissement">
        {decaissement && (
          <form onSubmit={enregistrerDecaissement}>
            <div style={{ display: 'flex', gap: '0.6rem', padding: '0.85rem', borderRadius: 'var(--radius-md)', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', marginBottom: '1rem', fontSize: '0.85rem' }}>
              <AlertTriangle size={18} color="#f87171" style={{ flexShrink: 0 }} />
              <div>
                Chèque <strong>{decaissement.cheque.numero_cheque}</strong> ({decaissement.cheque.nom_banque}) de {fcfa(decaissement.cheque.montant)}.
                {' '}Les encaissements qu'il a réglés ({decaissement.cheque.quittances_reglees || '—'}) seront annulés : les quittances redeviennent à encaisser.
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Motif du décaissement (* requis)</label>
              <textarea
                className="form-control"
                required
                rows={3}
                maxLength={255}
                placeholder="Ex. : rejet pour provision insuffisante, avis de la banque du …"
                value={decaissement.motif}
                onChange={(e) => setDecaissement((prev) => ({ ...prev, motif: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Date du décaissement</label>
              <input type="date" className="form-control" required value={decaissement.date}
                onChange={(e) => setDecaissement((prev) => ({ ...prev, date: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setDecaissement(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={envoi} style={{ background: '#dc2626', borderColor: '#dc2626' }}>
                {envoi ? 'Enregistrement…' : 'Déclarer impayé'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Réencaissement d'un chèque impayé */}
      <Modal isOpen={Boolean(reencaissement)} onClose={() => setReencaissement(null)} title="Réencaissement d'un chèque impayé" size="large">
        {reencaissement && (
          <form onSubmit={enregistrerReencaissement}>
            <div style={{ padding: '0.85rem', borderRadius: 'var(--radius-md)', background: 'rgba(30, 41, 59, 0.6)', marginBottom: '1rem', fontSize: '0.85rem' }}>
              Chèque impayé <strong>{reencaissement.cheque.numero_cheque}</strong> ({reencaissement.cheque.nom_banque}) —
              {' '}décaissé le {formatDate(reencaissement.cheque.date_decaissement)} : « {reencaissement.cheque.motif_decaissement} ».
              {' '}Montant impayé : <strong>{fcfa(reencaissement.cheque.montant_impaye)}</strong>
              {Number(reencaissement.cheque.montant_reencaisse) > 0 && <>, déjà réencaissé : {fcfa(reencaissement.cheque.montant_reencaisse)}</>}.
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: '1rem' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.35rem' }}>Quittance</th>
                  <th style={{ padding: '0.35rem' }}>Client</th>
                  <th style={{ padding: '0.35rem' }}>Montant réencaissé (FCFA)</th>
                </tr>
              </thead>
              <tbody>
                {reencaissement.quittances.map((q, i) => (
                  <tr key={q.numero}>
                    <td style={{ padding: '0.3rem', fontFamily: 'var(--font-mono)' }}>{q.numero}</td>
                    <td style={{ padding: '0.3rem' }}>{q.client || '—'}</td>
                    <td style={{ padding: '0.3rem' }}>
                      <input type="number" className="form-control" min="0" value={q.montant}
                        onChange={(e) => setReencaissement((prev) => ({
                          ...prev,
                          quittances: prev.quittances.map((x, j) => (j === i ? { ...x, montant: e.target.value } : x)),
                        }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>Total réencaissé : <strong>{fcfa(totalReencaissement)}</strong></p>

            <div className="responsive-form-row">
              <div className="form-group">
                <label className="form-label">Références du réencaissement (* requis)</label>
                <input
                  type="text"
                  className="form-control"
                  required
                  maxLength={100}
                  placeholder="Ex. : régularisation par virement, avis n° …"
                  value={reencaissement.references}
                  onChange={(e) => setReencaissement((prev) => ({ ...prev, references: e.target.value.replace(/[^\p{L}\p{N} \-/._:,']/gu, '') }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Date du réencaissement</label>
                <input type="date" className="form-control" required value={reencaissement.date}
                  onChange={(e) => setReencaissement((prev) => ({ ...prev, date: e.target.value }))} />
              </div>
            </div>
            <ChampsReglement
              modes={modes}
              banques={banques}
              valeurs={reencaissement.reglement}
              onChange={(champ, valeur) => setReencaissement((prev) => ({ ...prev, reglement: { ...prev.reglement, [champ]: valeur } }))}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setReencaissement(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Valider le réencaissement'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};

export default ChequeManagementPage;
