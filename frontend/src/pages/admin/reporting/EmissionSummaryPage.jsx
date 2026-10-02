import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import React, { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Download, Calendar, Printer, Loader2, RefreshCw, FileSpreadsheet } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import { exportBordereauPdf, exportBordereauExcel } from '../../../utils/exportUtils';
import { reportingApi } from '../../../api/endpoints';

const emptyTotal = () => ({ primeNette: 0, accessoire: 0, taxe: 0, primeTtc: 0, commission: 0 });

const addToTotal = (total, l) => {
  total.primeNette += Number(l.prime_nette || 0);
  total.accessoire += Number(l.accessoire || 0);
  total.taxe += Number(l.taxe || 0);
  total.primeTtc += Number(l.prime_ttc || 0);
  total.commission += Number(l.commission_intermediaire || 0);
};

/**
 * Regroupe les lignes du bordereau par Compagnie > Client > Branche,
 * avec sous-totaux à chaque niveau, à l'image du bordereau réglementaire de référence.
 */
const buildBordereauGroups = (records) => {
  const compagnieMap = new Map();

  records.forEach((l) => {
    const compagnieKey = l.nom_compagnie || 'Compagnie Non Renseignée';
    const clientKey = l.nom_client || 'Client Non Renseigné';
    const brancheKey = l.libelle_produit || 'Branche Non Renseignée';

    if (!compagnieMap.has(compagnieKey)) {
      compagnieMap.set(compagnieKey, { label: compagnieKey, total: emptyTotal(), clientMap: new Map() });
    }
    const compagnie = compagnieMap.get(compagnieKey);

    if (!compagnie.clientMap.has(clientKey)) {
      compagnie.clientMap.set(clientKey, { label: clientKey, total: emptyTotal(), brancheMap: new Map() });
    }
    const client = compagnie.clientMap.get(clientKey);

    if (!client.brancheMap.has(brancheKey)) {
      client.brancheMap.set(brancheKey, { label: brancheKey, total: emptyTotal(), lines: [] });
    }
    const branche = client.brancheMap.get(brancheKey);

    branche.lines.push(l);
    addToTotal(branche.total, l);
    addToTotal(client.total, l);
    addToTotal(compagnie.total, l);
  });

  const grandTotal = emptyTotal();
  const compagnies = Array.from(compagnieMap.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((compagnie) => {
      addToTotal(grandTotal, {
        prime_nette: compagnie.total.primeNette,
        accessoire: compagnie.total.accessoire,
        taxe: compagnie.total.taxe,
        prime_ttc: compagnie.total.primeTtc,
        commission_intermediaire: compagnie.total.commission,
      });
      return {
        label: compagnie.label,
        total: compagnie.total,
        clients: Array.from(compagnie.clientMap.values()).map((client) => ({
          label: client.label,
          total: client.total,
          branches: Array.from(client.brancheMap.values()).map((branche) => ({
            label: branche.label,
            total: branche.total,
            lines: branche.lines,
          })),
        })),
      };
    });

  return { compagnies, grandTotal };
};

const fmt = (v) => Math.round(Number(v || 0)).toLocaleString('fr-FR');
const fmtDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR');
};

export const EmissionSummaryPage = () => {
  const { success, error: toastError } = useToast();

  const [dateDebut, setDateDebut] = useState('2026-01-01');
  const [dateFin, setDateFin] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [rawRecords, setRawRecords] = useState([]);

  const fetchEmissions = async () => {
    try {
      setLoading(true);
      const data = await reportingApi.getBordereauRecapEmission({
        date_debut: dateDebut,
        date_fin: dateFin,
        type_etat: 1,
      });
      setRawRecords(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Erreur chargement bordereau recap emission:', err);
      toastError?.('Impossible de charger les émissions. Veuillez réessayer.');
      setRawRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateDebut, dateFin]);

  const groups = useMemo(() => buildBordereauGroups(rawRecords), [rawRecords]);

  const periodeLabel = `du ${fmtDate(dateDebut)} au ${fmtDate(dateFin)}`;

  const buildExportPayload = () => ({
    filename: `Bordereau_Emissions_${dateDebut}_${dateFin}`,
    title: `BORDEREAU DES EMISSIONS PAR COMPAGNIE, PAR BRANCHE ET PAR CLIENT ${periodeLabel.toUpperCase()}`,
    subtitle: 'État réglementaire certifié conforme — Code CIMA (CRCA)',
    metadata: {
      'Organisme': 'LE PHARE COURTAGE & GESTION D\'ASSURANCES',
      'Période': periodeLabel,
      'Nombre de Compagnies': String(groups.compagnies.length),
      'Nombre de Polices': String(rawRecords.length),
      'Date d\'Édition': new Date().toLocaleDateString('fr-FR'),
    },
    groups,
  });

  const handleExportPdf = () => {
    exportBordereauPdf(buildExportPayload());
    success('Bordereau des émissions (PDF) téléchargé avec succès.');
  };

  const handleExportExcel = () => {
    exportBordereauExcel(buildExportPayload());
    success('Bordereau des émissions (Excel) téléchargé avec succès.');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <span className="badge badge-success">Émissions Réelles</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Conformité Fiscale & CIMA</span>
          </div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <TrendingUp size={26} color="#34d399" />
            Bordereau des émissions
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Polices émises par compagnie, par branche et par client.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            onClick={fetchEmissions}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span>Actualiser</span>
          </button>
          <button className="btn btn-secondary" onClick={handleExportExcel} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <FileSpreadsheet size={16} />
            <span>Excel</span>
          </button>
          <button className="btn btn-secondary" onClick={handleExportPdf} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Download size={16} />
            <span>PDF</span>
          </button>
          <button className="btn btn-primary" onClick={handlePrint} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Printer size={16} />
            <span>Imprimer</span>
          </button>
        </div>
      </div>

      {/* Barre de filtres de dates : choix de la période */}
      <div className="no-print glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Calendar size={16} color="var(--text-muted)" />
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Du :</span>
          <input
            type="date"
            className="form-control"
            style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', width: 'auto' }}
            value={dateDebut}
            onChange={(e) => setDateDebut(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Au :</span>
          <input
            type="date"
            className="form-control"
            style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', width: 'auto' }}
            value={dateFin}
            onChange={(e) => setDateFin(e.target.value)}
          />
        </div>

        <div style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Total contrats consolidés : <strong style={{ color: '#60a5fa' }}>{rawRecords.length}</strong>
        </div>
      </div>

      {/* Bordereau groupé Compagnie > Client > Branche (aperçu écran + support d'impression) */}
      <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '0.95rem', marginBottom: '1rem', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
          Bordereau des Émissions par Compagnie, par Branche et par Client {periodeLabel}
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : groups.compagnies.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            Aucune émission sur la période sélectionnée.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr>
                {['Numéro Police', 'Numéro quittance', 'Numéro Avenant', 'Date Emission', 'Date Effet', 'Date Expiration', 'Prime Nette', 'Accessoire', 'Taxe', 'Prime TTC', 'Comm. Interm.'].map((h, idx) => (
                  <th key={h} style={{ textAlign: idx > 5 ? 'right' : 'left', padding: '0.4rem 0.55rem', background: '#1e293b', color: '#fff', border: '1px solid #334155', fontSize: '0.68rem', textTransform: 'uppercase' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.compagnies.map((compagnie) => (
                <React.Fragment key={compagnie.label}>
                  <tr>
                    <td colSpan={11} style={{ padding: '0.4rem 0.55rem', background: '#0f172a', color: '#fff', fontWeight: 700, border: '1px solid var(--border-subtle)' }}>
                      {compagnie.label}
                    </td>
                  </tr>
                  {compagnie.clients.map((client) => (
                    <React.Fragment key={client.label}>
                      <tr>
                        <td colSpan={11} style={{ padding: '0.4rem 0.55rem', background: 'var(--bg-surface-elevated)', fontWeight: 700, border: '1px solid var(--border-subtle)' }}>
                          {client.label}
                        </td>
                      </tr>
                      {client.branches.map((branche) => (
                        <React.Fragment key={branche.label}>
                          <tr>
                            <td colSpan={11} style={{ padding: '0.35rem 0.55rem', background: 'var(--bg-surface)', fontWeight: 600, color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                              {branche.label}
                            </td>
                          </tr>
                          {branche.lines.map((l, idx) => (
                            <tr key={`${l.numero_police}-${idx}`}>
                              <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)' }}>{l.numero_police}</td>
                              <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)' }}>{l.numero_quittance}</td>
                              <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)' }}>{l.numero_avenant}</td>
                              <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)' }}>{fmtDate(l.date_emission)}</td>
                              <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)' }}>{fmtDate(l.date_effet)}</td>
                              <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)' }}>{fmtDate(l.date_expiration)}</td>
                              <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(l.prime_nette)}</td>
                              <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(l.accessoire)}</td>
                              <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(l.taxe)}</td>
                              <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(l.prime_ttc)}</td>
                              <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(l.commission_intermediaire)}</td>
                            </tr>
                          ))}
                          <tr style={{ background: 'rgba(59,130,246,0.08)', fontWeight: 700 }}>
                            <td colSpan={6} style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)' }}>TOTAL {branche.label}</td>
                            <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(branche.total.primeNette)}</td>
                            <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(branche.total.accessoire)}</td>
                            <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(branche.total.taxe)}</td>
                            <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(branche.total.primeTtc)}</td>
                            <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(branche.total.commission)}</td>
                          </tr>
                        </React.Fragment>
                      ))}
                      <tr style={{ background: 'rgba(59,130,246,0.14)', fontWeight: 700 }}>
                        <td colSpan={6} style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)' }}>TOTAL {client.label}</td>
                        <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(client.total.primeNette)}</td>
                        <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(client.total.accessoire)}</td>
                        <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(client.total.taxe)}</td>
                        <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(client.total.primeTtc)}</td>
                        <td style={{ padding: '0.3rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(client.total.commission)}</td>
                      </tr>
                    </React.Fragment>
                  ))}
                  <tr style={{ background: 'rgba(59,130,246,0.22)', fontWeight: 800 }}>
                    <td colSpan={6} style={{ padding: '0.35rem 0.55rem', border: '1px solid var(--border-subtle)' }}>TOTAL {compagnie.label}</td>
                    <td style={{ padding: '0.35rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(compagnie.total.primeNette)}</td>
                    <td style={{ padding: '0.35rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(compagnie.total.accessoire)}</td>
                    <td style={{ padding: '0.35rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(compagnie.total.taxe)}</td>
                    <td style={{ padding: '0.35rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(compagnie.total.primeTtc)}</td>
                    <td style={{ padding: '0.35rem 0.55rem', border: '1px solid var(--border-subtle)', textAlign: 'right' }}>{fmt(compagnie.total.commission)}</td>
                  </tr>
                </React.Fragment>
              ))}
              <tr style={{ background: '#0f172a', color: '#fff', fontWeight: 800 }}>
                <td colSpan={6} style={{ padding: '0.5rem 0.55rem', border: '1px solid #0f172a' }}>TOTAL GÉNÉRAL</td>
                <td style={{ padding: '0.5rem 0.55rem', border: '1px solid #0f172a', textAlign: 'right' }}>{fmt(groups.grandTotal.primeNette)}</td>
                <td style={{ padding: '0.5rem 0.55rem', border: '1px solid #0f172a', textAlign: 'right' }}>{fmt(groups.grandTotal.accessoire)}</td>
                <td style={{ padding: '0.5rem 0.55rem', border: '1px solid #0f172a', textAlign: 'right' }}>{fmt(groups.grandTotal.taxe)}</td>
                <td style={{ padding: '0.5rem 0.55rem', border: '1px solid #0f172a', textAlign: 'right' }}>{fmt(groups.grandTotal.primeTtc)}</td>
                <td style={{ padding: '0.5rem 0.55rem', border: '1px solid #0f172a', textAlign: 'right' }}>{fmt(groups.grandTotal.commission)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default EmissionSummaryPage;
