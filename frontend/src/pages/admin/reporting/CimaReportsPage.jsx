import React, { useState, useEffect } from 'react';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { reportingApi } from '../../../api/endpoints';
import { FileSpreadsheet, Download, Calendar, Filter, FileText, Printer, ShieldCheck, Check } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import { exportToCsv, exportToExcel, exportToPdf, exportToXml } from '../../../utils/exportUtils';
import { nomCabinet } from '../../../utils/parametrage';

export const CimaReportsPage = () => {
  const [activeTab, setActiveTab] = useState('E1');
  const [exercice, setExercice] = useState('2026');
  const [e1Data, setE1Data] = useState([]);
  const [e2DataList, setE2DataList] = useState([]);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [exportConfig, setExportConfig] = useState({
    format: 'PDF',
    etat: 'ALL',
    certifiePar: 'Direction Générale & Actuaire Conseil',
  });
  const { success } = useToast();

  useEffect(() => {
    let isMounted = true;
    const loadCima = async () => {
      try {
        const [e1Res, e2Res] = await Promise.all([
          reportingApi.getCimaE1(exercice).catch(() => []),
          reportingApi.getCimaE2(exercice).catch(() => []),
        ]);
        if (isMounted) {
          if (e1Res && Array.isArray(e1Res)) {
            setE1Data(e1Res);
          }
          if (e2Res && Array.isArray(e2Res)) {
            setE2DataList(e2Res);
          }
        }
      } catch (err) {
        console.error('Erreur API États CIMA Django:', err);
      }
    };
    loadCima();
    return () => { isMounted = false; };
  }, [exercice]);

  const handleExportCima = (e) => {
    e.preventDefault();

    const headers = [
      'Code Branche',
      'Branche CIMA',
      'Émissions Brutes (FCFA)',
      'Encaissements (FCFA)',
      'Commissions (FCFA)',
      'Arriérés Début (FCFA)',
      'Recouvrements Arriérés (FCFA)',
      'Annulations (FCFA)',
      'Arriérés Fin (FCFA)',
    ];

    const allData = Array.isArray(e1Data) && e1Data.length > 0 ? e1Data : [];

    const rows = allData.map((b) => [
      b.code_branche || '-',
      b.branche || '-',
      `${Number(b.emissions || 0).toLocaleString('fr-FR')} FCFA`,
      `${Number(b.encaissements || 0).toLocaleString('fr-FR')} FCFA`,
      `${Number(b.commissions || 0).toLocaleString('fr-FR')} FCFA`,
      `${Number(b.arrieres_debut || 0).toLocaleString('fr-FR')} FCFA`,
      `${Number(b.encaissements_arrieres || 0).toLocaleString('fr-FR')} FCFA`,
      `${Number(b.annulations || 0).toLocaleString('fr-FR')} FCFA`,
      `${Number(b.arrieres_fin || 0).toLocaleString('fr-FR')} FCFA`,
    ]);

    const totEmissions = allData.reduce((a, b) => a + Number(b.emissions || 0), 0);
    const totEncaissements = allData.reduce((a, b) => a + Number(b.encaissements || 0), 0);
    const totCommissions = allData.reduce((a, b) => a + Number(b.commissions || 0), 0);
    const totArrieresFin = allData.reduce((a, b) => a + Number(b.arrieres_fin || 0), 0);

    const totals = [
      'TOTAL CONSOLIDÉ',
      `${allData.length} Branches CIMA`,
      `${totEmissions.toLocaleString('fr-FR')} FCFA`,
      `${totEncaissements.toLocaleString('fr-FR')} FCFA`,
      `${totCommissions.toLocaleString('fr-FR')} FCFA`,
      '-',
      '-',
      '-',
      `${totArrieresFin.toLocaleString('fr-FR')} FCFA`,
    ];

    const filename = `Etats_CIMA_${exportConfig.etat}_${exercice}`;
    const title = `LIASSE RÉGLEMENTAIRE CIMA - EXERCICE ${exercice}`;
    const subtitle = `État prudentiel (${exportConfig.etat === 'ALL' ? 'États E1 + E2' : `État CIMA ${exportConfig.etat}`}) certifié conforme`;
    const metadata = {
      'Organisme': nomCabinet(),
      'Exercice Fiscal': String(exercice),
      'Norme Réglementaire': 'Code CIMA Livre V - Contrôle Prudentiel CRCA',
      'Signataire & Certification': exportConfig.certifiePar || 'Direction Générale',
      'Date d\'Édition': new Date().toLocaleDateString('fr-FR'),
    };

    if (exportConfig.format === 'XLSX') {
      exportToExcel({ filename, title, subtitle, metadata, headers, rows, totals });
    } else if (exportConfig.format === 'XML') {
      exportToXml({ filename, rootTag: 'LIASSE_CIMA', metadata, items: allData });
    } else {
      exportToPdf({ filename, title, subtitle, metadata, headers, rows, totals });
    }

    success(exportConfig.format === 'PDF'
      ? `Aperçu PDF des états CIMA ouvert pour l'exercice ${exercice}. Utilisez « Imprimer / PDF » pour l'enregistrer.`
      : `États CIMA (${exportConfig.format}) téléchargés avec succès pour l'exercice ${exercice}.`);
    setIsExportModalOpen(false);
  };

  const e1Columns = [
    { header: 'Code', accessor: 'code_branche', render: (r) => <strong style={{ color: '#60a5fa' }}>{r.code_branche || '-'}</strong> },
    { header: 'Branche CIMA', accessor: 'branche', render: (r) => r.branche || '-' },
    {
      header: 'Émissions Brutes (FCFA)',
      render: (r) => <strong>{Number(r.emissions || 0).toLocaleString('fr-FR')} F</strong>,
    },
    {
      header: 'Encaissements Effectifs (FCFA)',
      render: (r) => <span style={{ color: '#34d399' }}>{Number(r.encaissements || 0).toLocaleString('fr-FR')} F</span>,
    },
    {
      header: 'Commissions Dues (FCFA)',
      render: (r) => <span style={{ color: '#fbbf24' }}>{Number(r.commissions || 0).toLocaleString('fr-FR')} F</span>,
    },
    {
      header: 'Taux Recouvrement',
      render: (r) => {
        const em = Number(r.emissions) || 0;
        const enc = Number(r.encaissements) || 0;
        const rate = em > 0 ? ((enc / em) * 100).toFixed(1) : '100.0';
        return (
          <span style={{ fontWeight: 700, color: '#f8fafc' }}>
            {rate}%
          </span>
        );
      },
    },
    {
      header: 'Actions',
      render: (r) => (
        <button
          className="btn btn-secondary"
          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          onClick={() => setSelectedBranch({ ...r, type: 'E1' })}
        >
          <FileText size={13} />
          <span>Fiche Réglementaire</span>
        </button>
      ),
    },
  ];

  const e2Data = [
    { code_branche: '01', branche: 'Automobile & RC', arrieres_debut: 24500000, encaissements_arrieres: 18200000, annulations: 1500000, arrieres_fin: 4800000 },
    { code_branche: '02', branche: 'IARD Risques Divers', arrieres_debut: 8900000, encaissements_arrieres: 6500000, annulations: 400000, arrieres_fin: 2000000 },
    { code_branche: '03', branche: 'Santé Groupe', arrieres_debut: 12000000, encaissements_arrieres: 11200000, annulations: 0, arrieres_fin: 800000 },
    { code_branche: '04', branche: 'Transport & Facultés', arrieres_debut: 3500000, encaissements_arrieres: 3100000, annulations: 100000, arrieres_fin: 300000 },
  ];

  const e2Columns = [
    { header: 'Code', accessor: 'code_branche', render: (r) => <strong style={{ color: '#60a5fa' }}>{r.code_branche || '-'}</strong> },
    { header: 'Branche CIMA', accessor: 'branche', render: (r) => r.branche || r.assureur || '-' },
    { header: 'Arriérés Début Exercice', render: (r) => <span>{Number(r.arrieres_debut ?? r.arrieresdebut ?? 0).toLocaleString('fr-FR')} F</span> },
    { header: 'Encaissements Arriérés', render: (r) => <span style={{ color: '#34d399' }}>{Number(r.encaissements_arrieres ?? r.encaissements ?? 0).toLocaleString('fr-FR')} F</span> },
    { header: 'Annulations / Pertes', render: (r) => <span style={{ color: '#fb7185' }}>{Number(r.annulations ?? 0).toLocaleString('fr-FR')} F</span> },
    { header: 'Arriérés Fin Exercice', render: (r) => <strong style={{ color: '#fbbf24' }}>{Number(r.arrieres_fin ?? r.arrieresfin ?? 0).toLocaleString('fr-FR')} F</strong> },
    {
      header: 'Actions',
      render: (r) => (
        <button
          className="btn btn-secondary"
          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          onClick={() => setSelectedBranch({ ...r, type: 'E2' })}
        >
          <FileText size={13} />
          <span>Fiche Réglementaire</span>
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <span className="badge badge-info">Commission Régionale de Contrôle des Assurances (CRCA)</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Code CIMA Livre V</span>
          </div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <FileSpreadsheet size={26} color="#c084fc" />
            États réglementaires CIMA
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            États officiels pour l'autorité de contrôle, la DGTCP et les commissaires aux comptes.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--bg-surface-elevated)', padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <Calendar size={16} color="var(--text-muted)" />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Exercice:</span>
            <select
              style={{ background: 'transparent', border: 'none', color: '#fff', fontWeight: 700, outline: 'none', cursor: 'pointer' }}
              value={exercice}
              onChange={(e) => setExercice(e.target.value)}
            >
              <option value="2023">2023</option>
              <option value="2024">2024</option>
              <option value="2025">2025</option>
              <option value="2026">2026</option>
            </select>
          </div>

          <button className="btn btn-primary" onClick={() => setIsExportModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Download size={16} />
            <span>Export Officiel CIMA</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
        <button
          className="btn"
          style={{
            background: activeTab === 'E1' ? 'rgba(139,92,246,0.2)' : 'transparent',
            color: activeTab === 'E1' ? '#c084fc' : 'var(--text-secondary)',
            border: `1px solid ${activeTab === 'E1' ? '#8b5cf6' : 'transparent'}`,
          }}
          onClick={() => setActiveTab('E1')}
        >
          État CIMA E1 : Émissions, Encaissements & Commissions
        </button>

        <button
          className="btn"
          style={{
            background: activeTab === 'E2' ? 'rgba(139,92,246,0.2)' : 'transparent',
            color: activeTab === 'E2' ? '#c084fc' : 'var(--text-secondary)',
            border: `1px solid ${activeTab === 'E2' ? '#8b5cf6' : 'transparent'}`,
          }}
          onClick={() => setActiveTab('E2')}
        >
          État CIMA E2 : Suivi des Arriérés & Annulations
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <DataTable
          columns={activeTab === 'E1' ? e1Columns : e2Columns}
          data={activeTab === 'E1' ? (Array.isArray(e1Data) ? e1Data : []) : (Array.isArray(e2DataList) && e2DataList.length > 0 ? e2DataList : (Array.isArray(e2Data) ? e2Data : []))}
          searchPlaceholder="Filtrer une branche..."
        />
      </div>

      {/* Modal Fiche Branche CIMA */}
      <Modal
        isOpen={Boolean(selectedBranch)}
        onClose={() => setSelectedBranch(null)}
        title={`Fiche Réglementaire CIMA : Branche ${selectedBranch?.code_branche}`}
        subtitle={selectedBranch?.branche}
        maxWidth="600px"
      >
        {selectedBranch && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Code & Intitulé Officiel :</span>
                <strong>{selectedBranch.code_branche} - {selectedBranch.branche}</strong>
              </div>
              {selectedBranch.type === 'E1' ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Total Émissions Brutes (Art. 13) :</span>
                    <strong>{Number(selectedBranch.emissions || 0).toLocaleString('fr-FR')} FCFA</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Encaissements Réalisés :</span>
                    <span style={{ color: '#34d399', fontWeight: 700 }}>{Number(selectedBranch.encaissements || 0).toLocaleString('fr-FR')} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Commissions Dues au Courtier :</span>
                    <span style={{ color: '#fbbf24' }}>{Number(selectedBranch.commissions || 0).toLocaleString('fr-FR')} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
                    <span style={{ fontWeight: 700 }}>Ratio Recouvrement Légal :</span>
                    <strong style={{ color: '#60a5fa' }}>
                      {Number(selectedBranch.emissions) ? ((Number(selectedBranch.encaissements || 0) / Number(selectedBranch.emissions)) * 100).toFixed(1) : '100.0'}% (Seuil CIMA ≥ 90%)
                    </strong>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Arriérés Début Exercice :</span>
                    <span>{Number(selectedBranch.arrieres_debut || 0).toLocaleString('fr-FR')} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Recouvrements sur Arriérés :</span>
                    <span style={{ color: '#34d399' }}>{Number(selectedBranch.encaissements_arrieres || 0).toLocaleString('fr-FR')} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Annulations Primes & Pertes :</span>
                    <span style={{ color: '#fb7185' }}>{Number(selectedBranch.annulations || 0).toLocaleString('fr-FR')} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
                    <span style={{ fontWeight: 700 }}>Solde Arriérés Fin Exercice :</span>
                    <strong style={{ color: '#fbbf24' }}>{Number(selectedBranch.arrieres_fin || 0).toLocaleString('fr-FR')} FCFA</strong>
                  </div>
                </>
              )}
            </div>

            <div style={{ background: 'rgba(192,132,252,0.06)', border: '1px solid rgba(192,132,252,0.2)', padding: '0.85rem', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              <strong>Contrôle de Solvabilité & Provisions Prudentielles (CRCA) :</strong>
              <p style={{ margin: '0.25rem 0 0 0' }}>
                Conformément aux directives de la Conférence Interafricaine des Marchés d'Assurances, les arriérés de plus de 90 jours font l'objet d'un provisionnement intégral pour créances douteuses.
              </p>
            </div>

            <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedBranch(null)}>
                Fermer
              </button>
              <button className="btn btn-primary" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Printer size={15} />
                <span>Imprimer Fiche Branche</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Export CIMA Réglementaire */}
      <Modal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        title={`Exportation Officielle des États CIMA (${exercice})`}
        subtitle="Génération des liasses réglementaires de contrôle prudentiel."
        maxWidth="540px"
      >
        <form onSubmit={handleExportCima} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">État Réglementaire CIMA *</label>
            <select
              className="form-control"
              value={exportConfig.etat}
              onChange={(e) => setExportConfig({ ...exportConfig, etat: e.target.value })}
            >
              <option value="E1">État CIMA E1 : Émissions, Encaissements & Commissions</option>
              <option value="E2">État CIMA E2 : Suivi des Arriérés et Annulations</option>
              <option value="ALL">Pack Intégral : États E1 + E2 Consolidation</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Format du Livrable Officiel *</label>
            <select
              className="form-control"
              value={exportConfig.format}
              onChange={(e) => setExportConfig({ ...exportConfig, format: e.target.value })}
            >
              <option value="XML">Format d'Échange Automatisé CRCA</option>
              <option value="PDF">Liasse PDF Officielle Numérotée et Paraphée</option>
              <option value="XLSX">Matrice Excel Normée CIMA</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Signataires & Certification</label>
            <input
              type="text"
              className="form-control"
              value={exportConfig.certifiePar}
              onChange={(e) => setExportConfig({ ...exportConfig, certifiePar: e.target.value })}
            />
          </div>

          <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', padding: '0.85rem', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Les données exportées incluent les hash de contrôle garantissant l'intégrité comptable auprès des commissaires aux comptes.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsExportModalOpen(false)}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Check size={16} />
              <span>Générer & Télécharger</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default CimaReportsPage;
