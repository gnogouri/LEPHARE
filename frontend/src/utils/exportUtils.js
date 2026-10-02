/**
 * UTILS D'EXPORTATION MULTI-FORMATS LE PHARE (PDF, EXCEL, CSV, XML)
 * Conforme aux exigences réglementaires du Code CIMA et de la comptabilité générale.
 */
import { annexeFlotteApi, cashApi, conditionsParticulieresFlotteApi, conditionsParticulieresMonoApi, contractApi, customerApi, impressionIaApi, impressionMrhApi, impressionVoyageApi, quoteApi, transportApi } from '../api/endpoints';
import { cedeaoDansPrimeNette } from './tarificationAuto';

export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 300);
};

/**
 * Export CSV standard avec BOM UTF-8 pour ouverture parfaite dans Microsoft Excel
 */
export const exportToCsv = ({ filename, title, metadata = {}, headers, rows, totals }) => {
  let csv = '\uFEFF'; // BOM UTF-8
  if (title) {
    csv += `"${title.replace(/"/g, '""')}"\n`;
  }
  Object.entries(metadata).forEach(([k, v]) => {
    csv += `"${k}";"${String(v).replace(/"/g, '""')}"\n`;
  });
  csv += '\n';

  csv += headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(';') + '\n';

  rows.forEach((row) => {
    csv += row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';') + '\n';
  });

  if (totals && totals.length > 0) {
    csv += '\n';
    csv += totals.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';') + '\n';
  }

  const cleanName = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, cleanName);
};

/**
 * Export Excel stylisé (.xls / .xlsx) avec formatage monétaire, totaux et en-tête officiel
 */
export const exportToExcel = ({ filename, title, subtitle, metadata = {}, headers, rows, totals }) => {
  const metaRows = Object.entries(metadata)
    .map(([k, v]) => `<tr><td style="font-weight:bold;color:#475569;padding:3px;">${k} :</td><td colspan="${headers.length - 1}" style="padding:3px;">${v}</td></tr>`)
    .join('');

  const headerCells = headers
    .map((h) => `<th style="background:#1e293b;color:#ffffff;font-weight:bold;padding:8px 10px;border:1px solid #cbd5e1;text-align:left;">${h}</th>`)
    .join('');

  const bodyRows = rows
    .map((row, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      const cells = row
        .map((cell, colIdx) => {
          const isNum = typeof cell === 'number' || (typeof cell === 'string' && /^[0-9\s]+(\s*F(CFA)?)?$/.test(cell.trim()));
          const align = colIdx > 0 && isNum ? 'right' : 'left';
          return `<td style="padding:6px 10px;border:1px solid #cbd5e1;text-align:${align};">${cell ?? ''}</td>`;
        })
        .join('');
      return `<tr style="background:${bg};">${cells}</tr>`;
    })
    .join('');

  const totalRowHtml = totals && totals.length > 0
    ? `<tr style="background:#e2e8f0;font-weight:bold;border-top:2px solid #0f172a;border-bottom:2px solid #0f172a;">
        ${totals.map((t, idx) => `<td style="padding:8px 10px;border:1px solid #94a3b8;text-align:${idx > 0 ? 'right' : 'left'};">${t ?? ''}</td>`).join('')}
       </tr>`
    : '';

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>${(title || 'Export').slice(0, 31)}</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayGridlines/>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8"/>
      </head>
      <body style="font-family:Arial, sans-serif;font-size:10pt;">
        <table style="margin-bottom:12px;">
          <tr>
            <td colspan="${headers.length}" style="font-size:8pt;color:#64748b;font-weight:bold;text-transform:uppercase;">
              RÉPUBLIQUE DE CÔTE D'IVOIRE • MINISTÈRE DES FINANCES • CODE CIMA (CRCA)
            </td>
          </tr>
          <tr>
            <td colspan="${headers.length}" style="font-size:14pt;font-weight:bold;color:#0f172a;padding-bottom:3px;">
              LE PHARE COURTAGE & GESTION D'ASSURANCES
            </td>
          </tr>
          <tr>
            <td colspan="${headers.length}" style="font-size:12pt;font-weight:bold;color:#0284c7;padding-bottom:6px;">
              ${title || 'ÉTAT D\'EXPORTATION OFFICIEL'}
            </td>
          </tr>
          ${subtitle ? `<tr><td colspan="${headers.length}" style="font-size:9pt;color:#475569;padding-bottom:8px;">${subtitle}</td></tr>` : ''}
          ${metaRows}
        </table>
        <table border="1" style="border-collapse:collapse;width:100%;">
          <thead>
            <tr>${headerCells}</tr>
          </thead>
          <tbody>
            ${bodyRows}
            ${totalRowHtml}
          </tbody>
        </table>
        <div style="margin-top:16px;font-size:8pt;color:#64748b;font-style:italic;">
          Document certifié conforme généré automatiquement le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}.
        </div>
      </body>
    </html>
  `;

  const cleanName = filename.endsWith('.xls') || filename.endsWith('.xlsx') ? filename : `${filename}.xls`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  downloadBlob(blob, cleanName);
};

/**
 * Export PDF Officiel Certifié CIMA avec déclenchement direct d'impression PDF et téléchargement.
 * enTete : bloc République / société / titre / sous-titre ; piedDePage : attestation et signatures.
 */
export const exportToPdf = ({ filename, title, subtitle, metadata = {}, headers, rows, totals, enTete = true, piedDePage = true }) => {
  const metaHtml = Object.entries(metadata)
    .map(([k, v]) => `<div><span style="color:#64748b;font-weight:600;">${k} :</span> <strong>${v}</strong></div>`)
    .join('');

  const headerTh = headers
    .map((h, idx) => `<th style="text-align:${idx > 0 ? 'right' : 'left'};padding:8px 10px;background:#f1f5f9;border-bottom:2px solid #0f172a;font-size:8.5pt;text-transform:uppercase;color:#334155;">${h}</th>`)
    .join('');

  const rowsTr = rows
    .map((row, idx) => {
      const cells = row
        .map((cell, colIdx) => {
          const isNum = typeof cell === 'number' || (typeof cell === 'string' && /^[0-9\s]+(\s*F(CFA)?)?$/.test(cell.trim()));
          const align = colIdx > 0 && isNum ? 'right' : 'left';
          const isBold = colIdx === row.length - 1;
          const color = isBold ? '#0f172a' : '#334155';
          return `<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:${align};font-size:9.5pt;font-weight:${isBold ? '700' : '400'};color:${color};">${cell ?? ''}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const totalTr = totals && totals.length > 0
    ? `<tr style="background:#f8fafc;font-weight:800;border-top:2px solid #0f172a;border-bottom:2px solid #0f172a;">
        ${totals.map((t, idx) => `<td style="padding:10px;text-align:${idx > 0 ? 'right' : 'left'};font-size:10pt;color:#0f172a;">${t ?? ''}</td>`).join('')}
       </tr>`
    : '';

  const docHtml = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>${title || 'Export Officiel CIMA'}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 15mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 10px;
      font-size: 10pt;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header-box {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 10px;
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .republic-tag {
      font-size: 7.5pt;
      font-weight: 800;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #475569;
    }
    .company-title {
      font-size: 14pt;
      font-weight: 900;
      color: #0f172a;
      margin-top: 3px;
    }
    .doc-badge {
      margin-left: auto;
      text-align: right;
      font-size: 8pt;
      color: #64748b;
    }
    .doc-badge-status {
      font-weight: 800;
      color: #0284c7;
      margin-top: 2px;
      letter-spacing: 0.5px;
    }
    .meta-box {
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      padding: 10px 14px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 8.5pt;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    .legal-notice {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 8pt;
      color: #166534;
      margin-bottom: 20px;
    }
    .signatures {
      display: flex;
      justify-content: space-between;
      margin-top: 24px;
      padding-top: 14px;
      border-top: 1px dashed #cbd5e1;
      font-size: 8.5pt;
    }
    .sig-col {
      width: 45%;
    }
    .sig-space {
      height: 48px;
      display: flex;
      align-items: flex-end;
      color: #94a3b8;
      font-style: italic;
    }
    @media print {
      .no-print { display: none !important; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="header-box">
    ${enTete ? `<div>
      <div class="republic-tag">RÉPUBLIQUE DE CÔTE D'IVOIRE • MINISTÈRE DES FINANCES • CODE CIMA (CRCA)</div>
      <div class="company-title">LE PHARE COURTAGE & GESTION D'ASSURANCES</div>
      <div style="font-size: 11.5pt; font-weight: 800; color: #0284c7; margin-top: 3px;">${title}</div>
      ${subtitle ? `<div style="font-size: 8.5pt; color: #475569; margin-top: 2px;">${subtitle}</div>` : ''}
    </div>` : ''}
    <div class="doc-badge">
      <div>Édité le ${new Date().toLocaleDateString('fr-FR')}</div>
      <div class="doc-badge-status">DOCUMENT OFFICIEL CERTIFIÉ</div>
    </div>
  </div>

  <div class="meta-box">
    ${metaHtml}
  </div>

  <table>
    <thead>
      <tr>${headerTh}</tr>
    </thead>
    <tbody>
      ${rowsTr}
      ${totalTr}
    </tbody>
  </table>

  ${piedDePage ? `<div class="legal-notice">
    <strong>Attestation de Contrôle & Conformité Fiscale :</strong> Le présent bordereau récapitulatif consolide l'ensemble des émissions de polices, quittances et taxes réglementaires conformément aux dispositions des Articles 13 et suivants du Code CIMA.
  </div>

  <div class="signatures">
    <div class="sig-col">
      <div style="font-weight: 700; color: #334155;">Le Chef de Service Comptabilité & Reporting :</div>
      <div class="sig-space">Visa & Paraphe</div>
    </div>
    <div class="sig-col" style="text-align: right;">
      <div style="font-weight: 700; color: #334155;">Pour la Direction Générale / Visa CIMA :</div>
      <div class="sig-space" style="justify-content: flex-end; color: #0284c7; font-weight: 700;">[ Cachet Officiel ]</div>
    </div>
  </div>` : ''}

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 350);
    };
  </script>
</body>
</html>
  `;

  // 1. Open instant Print-to-PDF Window
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(docHtml);
    printWindow.document.close();
  }

  // 2. Also trigger a direct download of the official certified HTML file as fallback
  const cleanName = filename.endsWith('.pdf') ? filename.replace(/\.pdf$/, '.html') : (filename.endsWith('.html') ? filename : `${filename}.html`);
  const blob = new Blob([docHtml], { type: 'text/html;charset=utf-8;' });
  downloadBlob(blob, cleanName);
};

// Texte inséré dans un document HTML : les caractères spéciaux sont neutralisés
const echapperHtml = (valeur) => String(valeur ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Date et heure d'édition « JJ/MM/AAAA à HH:MM »
const dateHeureEdition = (d = new Date()) => `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

const FICHE_CLIENT_STYLES = `
  /* Une seule page : tailles en em, réduites au besoin par le script d'ajustement */
  .fiche-client { font-size: 9pt; line-height: 1.3; color: #1f2937; }
  .fiche-client .facture-header { margin-bottom: 1.2em; }
  .fc-titre { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.2em; padding-bottom: 0.5em; border-bottom: 1px solid #233778; }
  .fc-titre-doc { font-size: 1.45em; font-weight: 800; letter-spacing: 0.04em; color: #233778; }
  .fc-titre-type { font-size: 0.95em; color: #4b5563; margin-top: 0.1em; }
  .fc-titre-droite { text-align: right; font-size: 0.85em; color: #4b5563; white-space: nowrap; }
  .fc-titre-droite b { color: #1f2937; font-family: 'Courier New', monospace; font-size: 1.1em; }
  .fc-carte { margin: 1em 0 1.1em; padding: 0.7em 1em; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; }
  .fc-carte-nom { font-size: 1.35em; font-weight: 800; text-transform: uppercase; color: #111827; }
  .fc-carte-infos { margin-top: 0.2em; font-size: 0.9em; color: #4b5563; }
  .fc-badge { display: inline-block; margin-left: 0.6em; padding: 0 0.6em; border: 1px solid #233778; border-radius: 1em; font-size: 0.8em; font-weight: 700; color: #233778; }
  .fc-grille { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 8mm; row-gap: 1em; }
  .fc-rubrique { break-inside: avoid; page-break-inside: avoid; }
  .fc-rubrique h2 { margin: 0 0 0.25em; padding-bottom: 0.25em; border-bottom: 1px solid #233778; font-size: 0.95em; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #233778; }
  .fc-champ { display: flex; gap: 0.8em; padding: 0.3em 0; border-bottom: 1px dotted #e5e7eb; }
  .fc-libelle { width: 42%; flex-shrink: 0; font-size: 0.9em; color: #6b7280; }
  .fc-valeur { flex: 1; font-weight: 600; color: #111827; overflow-wrap: anywhere; }
  /* Largeur 0 : les pointillés remplissent la place restante sans élargir la colonne (et la page) */
  .fc-pointilles { width: 0; min-width: 0; overflow: hidden; white-space: nowrap; font-weight: 400; letter-spacing: 0.2em; color: #9ca3af; }
  .fc-vide { padding: 0.3em 0; font-style: italic; color: #9ca3af; }
  .fc-synthese { margin-top: 1.1em; }
  .fc-chiffres { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.8em; margin: 0.5em 0 0.8em; }
  .fc-chiffre { padding: 0.55em 0.8em; border: 1px solid #e2e8f0; border-radius: 4px; }
  .fc-chiffre-libelle { font-size: 0.85em; color: #6b7280; }
  .fc-chiffre-valeur { font-size: 1.3em; font-weight: 800; color: #111827; white-space: nowrap; }
  .fc-chiffre-detail { font-size: 0.85em; color: #4b5563; }
  table.fc-operations { width: 100%; border-collapse: collapse; }
  table.fc-operations th { padding: 0.35em 0.5em; border-bottom: 1px solid #233778; font-size: 0.85em; font-weight: 700; text-align: left; color: #233778; }
  table.fc-operations td { padding: 0.35em 0.5em; border-bottom: 1px dotted #e5e7eb; }
  table.fc-operations .fc-montant { text-align: right; white-space: nowrap; }`;

// Contenu de la fiche client à partir de /api/client/:id/fiche/. Chaque champ a toujours sa
// ligne : la valeur enregistrée en base, ou des pointillés quand elle est absente.
const FICHE_POINTILLES = '.'.repeat(160);
const buildFicheClient = ({ client: c = {}, synthese: s = {}, operations = [] }, matricule) => {
  const texte = (v) => (v === undefined || v === null ? '' : String(v).trim());
  const montant = (v) => `${fcfa(v)} FCFA`;
  const date = (v) => (v ? formatFrDate(v) : '');
  const ligne = (libelle, valeur) => `<div class="fc-champ"><span class="fc-libelle">${libelle}</span>${texte(valeur)
    ? `<span class="fc-valeur">${echapperHtml(texte(valeur))}</span>`
    : `<span class="fc-valeur fc-pointilles">${FICHE_POINTILLES}</span>`}</div>`;
  const rubrique = (titre, lignes) => `
    <section class="fc-rubrique">
      <h2>${titre}</h2>
      ${lignes.join('')}
    </section>`;
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

  const entreprise = Boolean(c.entreprise);
  const nomComplet = [texte(c.nom), texte(c.prenoms)].filter(Boolean).join(' ') || 'Client sans nom';
  const ouiNon = (v) => (v ? 'Oui' : 'Non');

  const identite = entreprise
    ? [
      ligne('Raison sociale', nomComplet),
      ligne('RCCM / Patente', c.piece_identite),
      ligne('Date de création', date(c.date_naissance)),
      ligne('Siège', c.lieu_naissance),
      ligne('Interlocuteur', c.responsable),
    ]
    : [
      ligne('Civilité', c.civilite),
      ligne('Nom & prénoms', nomComplet),
      ligne('Pièce d\'identité', c.piece_identite),
      ligne('Date de naissance', date(c.date_naissance)),
      ligne('Lieu de naissance', c.lieu_naissance),
    ];
  const coordonnees = [
    ligne('Téléphone', c.telephone),
    ligne('Mobile', c.mobile),
    ligne('Fixe', c.fixe),
    ligne('Fax', c.fax),
    ligne('Email', c.email),
    ligne('Adresse', c.adresse),
    ligne('Complément d\'adresse', c.adresse_complement),
    ligne('Ville', c.ville),
    ligne('Code postal', c.code_postal),
  ];
  const activite = [
    ligne(entreprise ? 'Activité' : 'Profession', c.profession),
    ligne('Secteur d\'activité', c.secteur_activite),
    ligne(entreprise ? 'Fonction de l\'interlocuteur' : 'Poste occupé', c.fonction),
  ];
  const finances = [
    ligne('N° compte client', c.numero_compte),
    ligne('RIB', c.rib),
    ligne('Exonéré de taxe', ouiNon(c.exonere_taxes)),
    ligne('Exonéré d\'accessoires', ouiNon(c.exonere_accessoires)),
  ];

  const nombreDevis = Number(s.nombre_devis) || 0;
  const devisDetail = nombreDevis
    ? [`${nombreDevis} devis, dont ${Number(s.devis_en_cours) || 0} en cours`, s.dernier_devis ? `dernier le ${date(s.dernier_devis)}` : ''].filter(Boolean).join(' · ')
    : 'Aucun devis';
  const polices = Number(s.nombre_polices) || 0;
  const policesEnVigueur = Number(s.polices_en_vigueur) || 0;
  const policesDetail = polices
    ? `${pluriel(policesEnVigueur, 'police')} sur ${polices} émise${polices > 1 ? 's' : ''}`
    : 'Aucune police';
  const lignesOperations = operations.map((o) => `
    <tr>
      <td>${echapperHtml(o.nature)}</td>
      <td>${echapperHtml(o.numero)}</td>
      <td>${echapperHtml(o.branche)}</td>
      <td>${date(o.date)}</td>
      <td class="fc-montant">${montant(o.prime_ttc)}</td>
    </tr>`).join('');

  const edition = dateHeureEdition();
  return `
    <style>${FICHE_CLIENT_STYLES}</style>
    <div class="fiche-client">
      ${printDocEntete('')}

      <div class="fc-titre">
        <div>
          <div class="fc-titre-doc">FICHE CLIENT</div>
          <div class="fc-titre-type">${entreprise ? 'Personne morale' : 'Personne physique'}</div>
        </div>
        <div class="fc-titre-droite">
          <div>Matricule <b>${matricule ? echapperHtml(matricule) : '..........'}</b></div>
          <div>Édité le ${edition}</div>
        </div>
      </div>

      <div class="fc-carte">
        <div class="fc-carte-nom">${echapperHtml(nomComplet)}${c.vip ? '<span class="fc-badge">VIP</span>' : ''}</div>
        ${texte(c.categorie) ? `<div class="fc-carte-infos">${echapperHtml(c.categorie)}</div>` : ''}
      </div>

      <div class="fc-grille">
        ${rubrique(entreprise ? 'Identité de l\'entreprise' : 'Identité', identite)}
        ${rubrique('Coordonnées', coordonnees)}
        ${rubrique('Activité professionnelle', activite)}
        ${rubrique('Informations financières', finances)}
      </div>

      <section class="fc-rubrique fc-synthese">
        <h2>Synthèse commerciale</h2>
        <div class="fc-chiffres">
          <div class="fc-chiffre">
            <div class="fc-chiffre-libelle">Devis</div>
            <div class="fc-chiffre-valeur">${montant(s.total_devis)}</div>
            <div class="fc-chiffre-detail">${devisDetail}</div>
          </div>
          <div class="fc-chiffre">
            <div class="fc-chiffre-libelle">Primes des polices en vigueur</div>
            <div class="fc-chiffre-valeur">${montant(s.primes_en_vigueur)}</div>
            <div class="fc-chiffre-detail">${policesDetail}</div>
          </div>
          <div class="fc-chiffre">
            <div class="fc-chiffre-libelle">Total des primes émises</div>
            <div class="fc-chiffre-valeur">${montant(s.total_primes)}</div>
            <div class="fc-chiffre-detail">${s.dernier_contrat ? `dernier contrat le ${date(s.dernier_contrat)}` : 'Aucun contrat'}</div>
          </div>
        </div>
        ${operations.length ? `
          <table class="fc-operations">
            <thead><tr><th>Nature</th><th>N°</th><th>Branche</th><th>Émis le</th><th class="fc-montant">Prime TTC</th></tr></thead>
            <tbody>${lignesOperations}</tbody>
          </table>` : '<div class="fc-vide">Aucun devis ni contrat.</div>'}
      </section>
    </div>
    <script>
      // Contenu plus haut que la page A4 (moins les marges d'impression) : la police est
      // réduite par petits pas plutôt que de laisser la fiche passer sur une deuxième page
      (function () {
        var fiche = document.querySelector('.fiche-client');
        var hauteurUtile = (297 - 28) * 96 / 25.4;
        var taille = 9;
        while (fiche && fiche.scrollHeight > hauteurUtile && taille > 7) {
          taille -= 0.25;
          fiche.style.fontSize = taille + 'pt';
        }
      })();
    </script>
  `;
};

/**
 * Impression de la fiche client (personne physique ou morale) : une page A4, avec l'en-tête des
 * devis, les données réelles du client (/api/client/:id/fiche/) et sa synthèse commerciale.
 * Document d'information : aucune zone de signature ni de cachet. La fenêtre est ouverte dès
 * le clic pour ne pas être bloquée par le navigateur pendant l'appel API.
 */
export const printFicheClient = async (client) => {
  const id = client?.IdClient || client?.id;
  if (!id) return;
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write('<p style="font-family:Arial;padding:20px;">Préparation de la fiche client…</p>');
  }
  try {
    const fiche = await customerApi.getFicheClient(id);
    const matricule = client.codeclient || fiche?.client?.matricule || client.Matricule || '';
    openPrintWindow(`Fiche client ${matricule || id}`, buildFicheClient(fiche || {}, matricule), printWindow);
  } catch (err) {
    console.error('Erreur fiche client :', err);
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write('<p style="font-family:Arial;padding:20px;color:#b91c1c;">Impossible de charger les données du client pour la fiche. Veuillez réessayer.</p>');
      printWindow.document.close();
    }
  }
};

const BORDEREAU_COLUMNS = [
  'Numéro Police', 'Numéro quittance', 'Numéro Avenant', 'Date Emission',
  'Date Effet', 'Date Expiration', 'Prime Nette', 'Accessoire', 'Taxe',
  'Prime TTC', 'Comm. Interm.',
];

const fmtMoney = (v) => Math.round(Number(v || 0)).toLocaleString('fr-FR');
const fmtDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR');
};

/**
 * Construit le corps HTML du tableau groupé Compagnie > Client > Branche
 * (structure identique au bordereau réglementaire de référence OREOLE ASSURANCE).
 */
const buildBordereauGroupsHtml = (groups) => {
  const th = (label, idx) =>
    `<th style="text-align:${idx > 5 ? 'right' : 'left'};padding:6px 8px;background:#1e293b;color:#fff;border:1px solid #334155;font-size:7.5pt;text-transform:uppercase;">${label}</th>`;

  let html = `<thead><tr>${BORDEREAU_COLUMNS.map(th).join('')}</tr></thead><tbody>`;
  const nbCols = BORDEREAU_COLUMNS.length;

  const groupRow = (label, bg, color = '#0f172a', bold = true) =>
    `<tr><td colspan="${nbCols}" style="padding:5px 8px;background:${bg};color:${color};font-weight:${bold ? 700 : 600};font-size:8.5pt;border:1px solid #cbd5e1;">${label}</td></tr>`;

  const totalRow = (label, totals, bg = '#dbeafe') => `
    <tr style="background:${bg};font-weight:700;">
      <td colspan="6" style="padding:5px 8px;border:1px solid #cbd5e1;font-size:8pt;">${label}</td>
      <td style="padding:5px 8px;border:1px solid #cbd5e1;text-align:right;font-size:8pt;">${fmtMoney(totals.primeNette)}</td>
      <td style="padding:5px 8px;border:1px solid #cbd5e1;text-align:right;font-size:8pt;">${fmtMoney(totals.accessoire)}</td>
      <td style="padding:5px 8px;border:1px solid #cbd5e1;text-align:right;font-size:8pt;">${fmtMoney(totals.taxe)}</td>
      <td style="padding:5px 8px;border:1px solid #cbd5e1;text-align:right;font-size:8pt;">${fmtMoney(totals.primeTtc)}</td>
      <td style="padding:5px 8px;border:1px solid #cbd5e1;text-align:right;font-size:8pt;">${fmtMoney(totals.commission)}</td>
    </tr>`;

  groups.compagnies.forEach((compagnie) => {
    html += groupRow(compagnie.label, '#0f172a', '#ffffff');
    compagnie.clients.forEach((client) => {
      html += groupRow(client.label, '#e2e8f0');
      client.branches.forEach((branche) => {
        html += groupRow(branche.label, '#f1f5f9', '#334155', false);
        branche.lines.forEach((l) => {
          html += `<tr>
            <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:7.8pt;">${l.numero_police || ''}</td>
            <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:7.8pt;">${l.numero_quittance || ''}</td>
            <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:7.8pt;">${l.numero_avenant || ''}</td>
            <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:7.8pt;">${fmtDate(l.date_emission)}</td>
            <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:7.8pt;">${fmtDate(l.date_effet)}</td>
            <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:7.8pt;">${fmtDate(l.date_expiration)}</td>
            <td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:right;font-size:7.8pt;">${fmtMoney(l.prime_nette)}</td>
            <td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:right;font-size:7.8pt;">${fmtMoney(l.accessoire)}</td>
            <td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:right;font-size:7.8pt;">${fmtMoney(l.taxe)}</td>
            <td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:right;font-size:7.8pt;">${fmtMoney(l.prime_ttc)}</td>
            <td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:right;font-size:7.8pt;">${fmtMoney(l.commission_intermediaire)}</td>
          </tr>`;
        });
        html += totalRow(`TOTAL ${branche.label}`, branche.total, '#eff6ff');
      });
      html += totalRow(`TOTAL ${client.label}`, client.total, '#dbeafe');
    });
    html += totalRow(`TOTAL ${compagnie.label}`, compagnie.total, '#bfdbfe');
  });

  html += `<tr style="background:#0f172a;color:#fff;font-weight:800;">
      <td colspan="6" style="padding:8px;border:1px solid #0f172a;font-size:9pt;">TOTAL GÉNÉRAL</td>
      <td style="padding:8px;border:1px solid #0f172a;text-align:right;font-size:9pt;">${fmtMoney(groups.grandTotal.primeNette)}</td>
      <td style="padding:8px;border:1px solid #0f172a;text-align:right;font-size:9pt;">${fmtMoney(groups.grandTotal.accessoire)}</td>
      <td style="padding:8px;border:1px solid #0f172a;text-align:right;font-size:9pt;">${fmtMoney(groups.grandTotal.taxe)}</td>
      <td style="padding:8px;border:1px solid #0f172a;text-align:right;font-size:9pt;">${fmtMoney(groups.grandTotal.primeTtc)}</td>
      <td style="padding:8px;border:1px solid #0f172a;text-align:right;font-size:9pt;">${fmtMoney(groups.grandTotal.commission)}</td>
    </tr>`;

  html += '</tbody>';
  return html;
};

/**
 * Export PDF du bordereau des émissions groupé par Compagnie / Client / Branche
 * (mise en page A4 paysage, identique au modèle réglementaire de référence).
 */
export const exportBordereauPdf = ({ filename, title, subtitle, metadata = {}, groups }) => {
  const metaHtml = Object.entries(metadata)
    .map(([k, v]) => `<div><span style="color:#64748b;font-weight:600;">${k} :</span> <strong>${v}</strong></div>`)
    .join('');

  const docHtml = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>${title || 'Bordereau des Émissions'}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 12mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a; background: #ffffff; margin: 0; padding: 8px; font-size: 9pt; line-height: 1.35;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .header-box { border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-start; }
    .republic-tag { font-size: 7pt; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #475569; }
    .company-title { font-size: 12pt; font-weight: 900; color: #0f172a; margin-top: 2px; }
    .doc-badge { text-align: right; font-size: 7.5pt; color: #64748b; }
    .doc-badge-status { font-weight: 800; color: #0284c7; margin-top: 2px; letter-spacing: 0.5px; }
    .meta-box { display: flex; flex-wrap: wrap; gap: 12px; background: #f8fafc; border: 1px solid #cbd5e1; padding: 8px 12px; border-radius: 6px; margin-bottom: 10px; font-size: 7.8pt; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    .legal-notice { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 8px 10px; border-radius: 6px; font-size: 7.5pt; color: #166534; margin-top: 10px; }
    @media print { .no-print { display: none !important; } body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header-box">
    <div>
      <div class="republic-tag">RÉPUBLIQUE DE CÔTE D'IVOIRE • MINISTÈRE DES FINANCES • CODE CIMA (CRCA)</div>
      <div class="company-title">LE PHARE COURTAGE & GESTION D'ASSURANCES</div>
      <div style="font-size: 10pt; font-weight: 800; color: #0284c7; margin-top: 2px;">${title}</div>
      ${subtitle ? `<div style="font-size: 7.8pt; color: #475569; margin-top: 2px;">${subtitle}</div>` : ''}
    </div>
    <div class="doc-badge">
      <div>Édité le ${new Date().toLocaleDateString('fr-FR')}</div>
      <div class="doc-badge-status">DOCUMENT OFFICIEL CERTIFIÉ</div>
    </div>
  </div>

  <div class="meta-box">${metaHtml}</div>

  <table>${buildBordereauGroupsHtml(groups)}</table>

  <div class="legal-notice">
    <strong>Attestation de Contrôle & Conformité Fiscale :</strong> Le présent bordereau consolide, par compagnie, par client et par branche, l'ensemble des émissions de polices et quittances de la période conformément aux dispositions des Articles 13 et suivants du Code CIMA.
  </div>

  <script>
    window.onload = function() { setTimeout(function() { window.print(); }, 350); };
  </script>
</body>
</html>
  `;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(docHtml);
    printWindow.document.close();
  }

  const cleanName = filename.endsWith('.pdf') ? filename.replace(/\.pdf$/, '.html') : (filename.endsWith('.html') ? filename : `${filename}.html`);
  const blob = new Blob([docHtml], { type: 'text/html;charset=utf-8;' });
  downloadBlob(blob, cleanName);
};

/**
 * Export Excel du bordereau des émissions groupé par Compagnie / Client / Branche.
 */
export const exportBordereauExcel = ({ filename, title, subtitle, metadata = {}, groups }) => {
  const metaRows = Object.entries(metadata)
    .map(([k, v]) => `<tr><td style="font-weight:bold;color:#475569;padding:3px;">${k} :</td><td colspan="${BORDEREAU_COLUMNS.length - 1}" style="padding:3px;">${v}</td></tr>`)
    .join('');

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <!--[if gte mso 9]>
        <xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
          <x:Name>${(title || 'Bordereau').slice(0, 31)}</x:Name>
          <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
        </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml>
        <![endif]-->
        <meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8"/>
      </head>
      <body style="font-family:Arial, sans-serif;font-size:10pt;">
        <table style="margin-bottom:12px;">
          <tr><td colspan="${BORDEREAU_COLUMNS.length}" style="font-size:14pt;font-weight:bold;color:#0f172a;">LE PHARE COURTAGE & GESTION D'ASSURANCES</td></tr>
          <tr><td colspan="${BORDEREAU_COLUMNS.length}" style="font-size:12pt;font-weight:bold;color:#0284c7;padding-bottom:6px;">${title || ''}</td></tr>
          ${subtitle ? `<tr><td colspan="${BORDEREAU_COLUMNS.length}" style="font-size:9pt;color:#475569;padding-bottom:8px;">${subtitle}</td></tr>` : ''}
          ${metaRows}
        </table>
        <table border="1" style="border-collapse:collapse;width:100%;">
          ${buildBordereauGroupsHtml(groups)}
        </table>
      </body>
    </html>
  `;

  const cleanName = filename.endsWith('.xls') || filename.endsWith('.xlsx') ? filename : `${filename}.xls`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  downloadBlob(blob, cleanName);
};

/**
 * Export XML Réglementaire CRCA
 */
export const exportToXml = ({ filename, rootTag = 'BORDEREAU_CIMA', metadata = {}, items = [] }) => {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<${rootTag}>\n`;
  xml += '  <ENTETE_OFFICIEL>\n';
  xml += `    <ORGANISME>LE PHARE COURTAGE &amp; GESTION D'ASSURANCES</ORGANISME>\n`;
  xml += `    <PAYS>COTE D IVOIRE</PAYS>\n`;
  xml += `    <CODE_REGULATEUR>CRCA_CIMA</CODE_REGULATEUR>\n`;
  xml += `    <DATE_EDITION>${new Date().toISOString()}</DATE_EDITION>\n`;
  Object.entries(metadata).forEach(([k, v]) => {
    const cleanKey = k.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    xml += `    <${cleanKey}>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</${cleanKey}>\n`;
  });
  xml += '  </ENTETE_OFFICIEL>\n';
  xml += '  <LIGNES_PRODUCTION>\n';
  items.forEach((item, idx) => {
    xml += `    <LIGNE id="${idx + 1}">\n`;
    Object.entries(item).forEach(([k, v]) => {
      const cleanKey = k.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      xml += `      <${cleanKey}>${String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</${cleanKey}>\n`;
    });
    xml += '    </LIGNE>\n';
  });
  xml += '  </LIGNES_PRODUCTION>\n';
  xml += `</${rootTag}>\n`;

  const cleanName = filename.endsWith('.xml') ? filename : `${filename}.xml`;
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' });
  downloadBlob(blob, cleanName);
};

/* =========================================================================
   IMPRESSION DES DEVIS/FACTURES PROFORMA — 3 GABARITS REPRIS D'URANUS
   (Auto, IA/Voyage/Transport, MRH), d'après les modèles PDF fournis par
   OREOLE ASSURANCE. Ouvre une fenêtre d'impression dédiée, indépendante
   du contenu affiché à l'écran.
   ========================================================================= */

const money = (v) => Number(v || 0).toLocaleString('fr-FR');

const formatFrDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Conversion d'un nombre entier (FCFA, pas de décimales) en toutes lettres françaises,
// pour la mention "En votre aimable règlement ... la somme de [montant en toutes lettres]"
// du gabarit Auto (cf. FACTURE AUTO PREFORMA.pdf : "TRENTE MILLE CINQ CENT DIX").
export const numberToFrenchWords = (num) => {
  const n = Math.round(Math.abs(Number(num) || 0));
  if (n === 0) return 'ZERO';

  const unites = ['', 'UN', 'DEUX', 'TROIS', 'QUATRE', 'CINQ', 'SIX', 'SEPT', 'HUIT', 'NEUF', 'DIX',
    'ONZE', 'DOUZE', 'TREIZE', 'QUATORZE', 'QUINZE', 'SEIZE', 'DIX-SEPT', 'DIX-HUIT', 'DIX-NEUF'];
  const dizaines = ['', '', 'VINGT', 'TRENTE', 'QUARANTE', 'CINQUANTE', 'SOIXANTE', 'SOIXANTE', 'QUATRE-VINGT', 'QUATRE-VINGT'];

  // accordPluriel : "CENT" et "QUATRE-VINGT" prennent un "S" lorsqu'ils terminent
  // le nombre ou précèdent MILLION/MILLIARD (noms : "DEUX CENTS MILLIONS"), mais
  // jamais devant MILLE, qui est invariable ("DEUX CENT MILLE", "QUATRE-VINGT MILLE").
  const troisChiffres = (num3, accordPluriel) => {
    let out = '';
    const c = Math.floor(num3 / 100);
    const reste = num3 % 100;
    if (c > 0) {
      out += c > 1 ? `${unites[c]} CENT` : 'CENT';
      if (reste === 0 && c > 1 && accordPluriel) out += 'S';
    }
    if (reste > 0) {
      if (out) out += ' ';
      if (reste < 20) {
        out += unites[reste];
      } else {
        const d = Math.floor(reste / 10);
        const u = reste % 10;
        if (d === 8) {
          // Quatre-vingts (seul) prend un S, quatre-vingt-un/-deux... n'en prend pas.
          out += u > 0 ? `${dizaines[d]}-${unites[u]}` : `${dizaines[d]}${accordPluriel ? 'S' : ''}`;
        } else if (d === 7 || d === 9) {
          // Soixante et onze (71) est la seule exception avec "ET" dans cette tranche.
          out += d === 7 && u === 1 ? `${dizaines[d]} ET ${unites[10 + u]}` : `${dizaines[d]}-${unites[10 + u]}`;
        } else if (u === 1 && d >= 2 && d <= 6) {
          // Vingt et un, trente et un, ..., soixante et un.
          out += `${dizaines[d]} ET UN`;
        } else {
          out += dizaines[d] + (u > 0 ? `-${unites[u]}` : '');
        }
      }
    }
    return out;
  };

  const tranches = [
    { valeur: 1000000000, libelle: 'MILLIARD' },
    { valeur: 1000000, libelle: 'MILLION' },
    { valeur: 1000, libelle: 'MILLE' },
  ];

  let reste = n;
  const parties = [];
  for (const t of tranches) {
    const q = Math.floor(reste / t.valeur);
    if (q > 0) {
      const mot = t.libelle === 'MILLE'
        ? (q === 1 ? 'MILLE' : `${troisChiffres(q, false)} MILLE`)
        : `${troisChiffres(q, true)} ${t.libelle}${q > 1 ? 'S' : ''}`;
      parties.push(mot);
      reste %= t.valeur;
    }
  }
  if (reste > 0) parties.push(troisChiffres(reste, true));

  return parties.join(' ').replace(/\s+/g, ' ').trim();
};

// Relecture d'un montant écrit par numberToFrenchWords : reconvertit le texte en
// nombre pour vérifier qu'il correspond exactement au chiffre affiché.
export const frenchWordsToNumber = (texte) => {
  const valeurs = {
    ZERO: 0, UN: 1, DEUX: 2, TROIS: 3, QUATRE: 4, CINQ: 5, SIX: 6, SEPT: 7, HUIT: 8, NEUF: 9,
    DIX: 10, ONZE: 11, DOUZE: 12, TREIZE: 13, QUATORZE: 14, QUINZE: 15, SEIZE: 16,
    TRENTE: 30, QUARANTE: 40, CINQUANTE: 50, SOIXANTE: 60,
  };
  const echelles = { MILLIARD: 1e9, MILLIARDS: 1e9, MILLION: 1e6, MILLIONS: 1e6, MILLE: 1e3 };
  let total = 0;
  let courant = 0;
  let precedent = null;
  for (const mot of String(texte || '').split(/[\s-]+/).filter(Boolean)) {
    if (mot === 'ET') continue;
    if (mot === 'VINGT' || mot === 'VINGTS') {
      // QUATRE-VINGT(S) = 4 x 20
      courant += precedent === 'QUATRE' ? 76 : 20;
    } else if (mot === 'CENT' || mot === 'CENTS') {
      courant = (courant || 1) * 100;
    } else if (echelles[mot]) {
      total += (courant || 1) * echelles[mot];
      courant = 0;
    } else if (valeurs[mot] !== undefined) {
      courant += valeurs[mot];
    } else {
      return NaN;
    }
    precedent = mot;
  }
  return total + courant;
};

// Code-barres Code 128 (jeu B) en SVG, pour l'identifiant imprimé en pied de document.
// Largeurs barre/espace de chaque symbole (valeurs 0 à 105) puis motif STOP (106).
const CODE128_MOTIFS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const CODE128_START_B = 104;
const CODE128_STOP = 106;

export const code128Svg = (texte, hauteur = 42, module = 1.2) => {
  const codes = [CODE128_START_B];
  for (const ch of String(texte)) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) return null;
    codes.push(c - 32);
  }
  const checksum = codes.reduce((somme, v, i) => somme + v * (i === 0 ? 1 : i), 0) % 103;
  codes.push(checksum, CODE128_STOP);

  const margeSilence = 10;
  let x = margeSilence;
  let barres = '';
  codes.forEach((code) => {
    [...CODE128_MOTIFS[code]].forEach((largeur, j) => {
      const w = Number(largeur);
      if (j % 2 === 0) barres += `<rect x="${x}" y="0" width="${w}" height="${hauteur}"/>`;
      x += w;
    });
  });
  const largeurTotale = x + margeSilence;
  return `<svg class="barcode-svg" xmlns="http://www.w3.org/2000/svg" width="${largeurTotale * module}" height="${hauteur}" viewBox="0 0 ${largeurTotale} ${hauteur}" preserveAspectRatio="none" role="img" aria-label="Code-barres ${texte}"><g fill="#000">${barres}</g></svg>`;
};

const getCompagnieLogoUrl = (compagnieName) => {
  const c = String(compagnieName || '').toLowerCase();
  if (c.includes('nsia')) return '/assets/print/logo-nsia.jpg';
  if (c.includes('sunu')) return '/assets/print/logo-sunu.png';
  return null;
};

// En-tête commun des documents imprimés (devis, factures, conditions particulières, fiche
// client) : logo OREOLE à gauche, logo ou nom de la compagnie à droite
const printDocEntete = (compagnie) => {
  const logo = getCompagnieLogoUrl(compagnie);
  return `
    <div class="facture-header">
      <img src="/assets/print/logo-oreole-entete.png" alt="OREOLE Assurances" class="header-logo-oreole" />
      ${logo
        ? `<img src="${logo}" alt="${compagnie}" class="header-logo-compagnie" />`
        : `<div class="header-compagnie-text">${compagnie || ''}</div>`}
    </div>
  `;
};

const printDocHeader = (quote, docTitle) => `
  ${printDocEntete(quote.compagnie)}
  <div class="facture-title">${docTitle}</div>
`;

const printDocFooter = (withBarcode) => `
  <div class="facture-footer">
    ${withBarcode ? `
      <div class="barcode-block">
        <img src="/assets/print/codebar.png" alt="Code-barres document" />
        <div class="barcode-ref">Réf. document</div>
      </div>
    ` : '<div></div>'}
    <img src="/assets/print/logo-oreole-pied.png" alt="OREOLE Assurances" class="footer-logo-oreole" />
  </div>
`;

// --- GABARIT A : AUTO (facture proforma / facture de prime définitive) — modèle
// NSIA ASSURANCES. Toutes les valeurs viennent du devis brut (quote.raw) : une
// donnée absente laisse la case vide au lieu d'être inventée.
const buildAutoFacture = (quote) => {
  const raw = quote.raw || {};
  const isPolice = Boolean(quote.confirme);
  const txt = (v) => (v === undefined || v === null || String(v).trim() === '' ? VIDE : v);
  const date = (v) => (v ? formatFrDate(v) : VIDE);
  const nomPersonne = (p) => (p && typeof p === 'object' ? `${p.Nom || ''} ${p.Prenoms || ''}`.trim() : '');
  const compagnie = raw.compagnie && typeof raw.compagnie === 'object' ? raw.compagnie.RaisonSociale : raw.compagnie;
  const souscripteur = nomPersonne(raw.client);
  // L'assuré peut différer du souscripteur (idassure / nomassure du devis)
  const assure = nomPersonne(raw.assure) || raw.nomassure;
  const numeroFacture = raw.numero_facture;
  const docTitle = `${isPolice ? 'FACTURE DE PRIME' : 'DEVIS'} N°${txt(numeroFacture)}`;
  const idLabel = isPolice ? 'Id. Police' : 'Id. Devis';
  const numLabel = isPolice ? 'N° Police' : 'N° Devis';

  // Vérification obligatoire : la Prime TTC est recalculée à partir des 5 composantes
  // et comparée au montant enregistré sur le devis
  const montantValide = (v) => v !== undefined && v !== null && v !== '' && !Number.isNaN(Number(v));
  // Modèle Uranus : stddevis.primenette inclut déjà le FGA et la CEDEAO (sp_finalisation_devis) ;
  // la Prime Nette imprimée les retire pour que PN + Accessoire + Taxes + FDG + CEDEAO = Prime TTC.
  // NSIA (compagnie 1) : la TTC peut être arrondie au multiple de 5 supérieur (fn_calculer_primettc,
  // appliqué sur l'historique mais plus rattaché à aucun trigger) : les deux formes sont acceptées.
  const composantes = [raw.primenette, raw.accessoire, raw.taxe, raw.fga, raw.cedeao];
  const idCompagnie = raw.compagnie && typeof raw.compagnie === 'object' ? raw.compagnie.IdCompagnie : raw.idcompagnie;
  const [pnStockee, accessoire, taxe, fga, cedeao] = composantes.map((v) => Math.round(Number(v)));
  const ttcEnregistre = montantValide(raw.primettc) ? Math.round(Number(raw.primettc)) : null;
  const estNsia = Number(idCompagnie) === 1;
  const correspond = (somme) => ttcEnregistre === somme || (estNsia && ttcEnregistre === Math.ceil(somme / 5) * 5);
  // La CEDEAO est incluse dans la prime nette stockée par le parcours tarifé, mais saisie à part
  // par le parcours « prime imposée » (sp_maj_manuelle_primes) : on retient le modèle qui
  // retombe sur la TTC enregistrée, le modèle tarifé par défaut
  let primeNetteAffichee = null;
  if (composantes.every(montantValide)) {
    const cedeaoHorsPrimeNette = !correspond(pnStockee + accessoire + taxe) && correspond(pnStockee + accessoire + taxe + cedeao);
    primeNetteAffichee = pnStockee - fga - (cedeaoHorsPrimeNette ? 0 : cedeao);
  }
  const sommeComposantes = primeNetteAffichee !== null ? primeNetteAffichee + accessoire + taxe + fga + cedeao : null;
  const ttcCalcule = sommeComposantes === null ? null
    : (estNsia && ttcEnregistre === Math.ceil(sommeComposantes / 5) * 5 ? ttcEnregistre : sommeComposantes);
  const ecartTtc = ttcCalcule !== null && ttcEnregistre !== null && ttcCalcule !== ttcEnregistre;
  const montant = (v) => (montantValide(v) ? fcfa(v) : VIDE);

  // Montant en lettres calculé sur la valeur exacte affichée, puis relu (reconversion
  // en nombre) : en cas de doute, on n'imprime pas un montant partiel ou faux
  let montantEnLettres = '[MONTANT MANQUANT]';
  if (ttcCalcule !== null) {
    const lettres = numberToFrenchWords(ttcCalcule);
    if (frenchWordsToNumber(lettres) === ttcCalcule) montantEnLettres = `${lettres} FRANCS CFA`;
  }

  const alerteEcart = ecartTtc ? `
    <div class="alerte-ecart no-print">
      <strong>⚠ Écart détecté sur la Prime TTC.</strong>
      Montant enregistré sur le devis : <strong>${fcfa(ttcEnregistre)} FCFA</strong> —
      somme Prime Nette + Accessoire + Taxes + FDG + CEDEAO : <strong>${fcfa(ttcCalcule)} FCFA</strong>
      (écart de ${fcfa(Math.abs(ttcCalcule - ttcEnregistre))} FCFA).
      La facture affiche le montant recalculé. Vérifiez le devis avant de la transmettre.
      <em>(Ce bandeau n'apparaît pas à l'impression.)</em>
    </div>` : '';

  const html = `
    ${alerteEcart}
    <div class="facture-auto">
    ${printDocHeader({ compagnie }, docTitle)}
    <div class="sous-titre">ASSURANCE ${String(quote.produit || 'AUTOMOBILE').toUpperCase()}</div>

    <table class="cadre-unique facture-cadre">
      <tr><td colspan="6" class="ligne-compagnie">Compagnie <strong>${compagnie ? String(compagnie).toUpperCase() : VIDE}</strong></td></tr>
      <tr>
        <td colspan="3" class="entete-bloc" style="text-align:center;">SOUSCRIPTEUR</td>
        <td colspan="3" class="entete-bloc" style="text-align:center;">ASSURE</td>
      </tr>
      <tr>
        <td colspan="3" style="text-align:center;">
          <strong>${souscripteur ? souscripteur.toUpperCase() : VIDE}</strong>
          ${raw.numeroidentificationclient ? `<br/>N° pièce : <strong>${raw.numeroidentificationclient}</strong>` : ''}
        </td>
        <td colspan="3" style="text-align:center;">
          <strong>${assure ? String(assure).toUpperCase() : VIDE}</strong>
          ${raw.numeroidentificationassure ? `<br/>N° pièce : <strong>${raw.numeroidentificationassure}</strong>` : ''}
        </td>
      </tr>
      <tr class="ligne-labels">
        <td>${idLabel}</td><td>${numLabel}</td><td>Effet</td><td>N° Acte</td><td>Effet Acte</td><td>Expiration</td>
      </tr>
      <tr class="ligne-valeurs">
        <td><strong>${txt(raw.iddevis)}</strong></td>
        <td><strong>${txt(raw.numerodevis)}</strong></td>
        <td><strong>${date(raw.dateeffet)}</strong></td>
        <td><strong>${txt(raw.numeroavenant)}</strong></td>
        <td><strong>${date(raw.dateeffet)}</strong></td>
        <td><strong>${date(raw.dateexpiration)}</strong></td>
      </tr>
      <tr><td colspan="6" style="border:none;height:10px;"></td></tr>
      <tr class="ligne-labels">
        <td>PRIME NETTE</td><td>ACCESSOIRE</td><td>TAXES</td><td>FDG</td><td>CEDEAO</td><td>PRIME TTC</td>
      </tr>
      <tr class="ligne-valeurs facture-montants">
        <td><strong>${primeNetteAffichee !== null ? fcfa(primeNetteAffichee) : VIDE}</strong></td>
        <td><strong>${montant(raw.accessoire)}</strong></td>
        <td><strong>${montant(raw.taxe)}</strong></td>
        <td><strong>${montant(raw.fga)}</strong></td>
        <td><strong>${montant(raw.cedeao)}</strong></td>
        <td><strong>${ttcCalcule !== null ? fcfa(ttcCalcule) : VIDE}</strong></td>
      </tr>
    </table>

    <p class="texte-politesse">
      En votre aimable règlement par chèque à l'ordre de ${compagnie ? String(compagnie).toUpperCase() : VIDE} ou par tout règlement la somme de
      ${montantEnLettres} .
    </p>
    <p class="texte-politesse">Pièces jointes : 3 exemplaires de l'avenant en référence dont 2 à nous retourner après signature.</p>
    <p class="texte-politesse">Dans cette attente, nous vous prions d'agréer l'expression de nos sentiments dévoués.</p>

    <div class="bloc-signature-droite">
      <div>Fait à Abidjan, le <strong>${date(raw.dateemission)}</strong>.</div>
      <div style="margin-top:28px;"><strong>Pour la société</strong></div>
    </div>

    <div class="facture-footer">
      <div class="barcode-block">
        ${numeroFacture ? code128Svg(numeroFacture) || '' : ''}
        <div class="barcode-ref">${txt(numeroFacture)}</div>
      </div>
      <img src="/assets/print/logo-oreole-pied.png" alt="OREOLE Assurances" class="footer-logo-oreole" />
    </div>
    </div>
  `;

  // Relecture finale : aucun résidu technique ne doit apparaître dans le document
  if (/\b(undefined|null|NaN)\b/.test(html.replace(/<[^>]*>/g, ' '))) {
    console.error('Facture proforma : valeur non résolue détectée', raw.iddevis);
    return `<div class="alerte-ecart no-print"><strong>⚠ Donnée non résolue détectée dans la facture</strong> — vérifiez le devis avant impression.</div>${html}`;
  }
  return html;
};

// --- CONDITIONS PARTICULIÈRES — ASSURANCE AUTOMOBILE (modèle NSIA/OREOLE, cf.
// police n°1186201263196A). Structure unique Mono / Flotte : en-tête, références
// client / quittance, tableau des garanties par nature de risque, récapitulatif
// financier et signatures. Les données proviennent de
// /api/devis/:id/conditions-particulieres/ ; toute donnée absente laisse la case
// vide au lieu d'être inventée.
// Donnée absente : la case reste vide (aucune valeur inventée, aucun libellé de substitution)
const VIDE = '';
const ID_GARANTIE_RC = 1;

// Montant FCFA : arrondi sans décimales, séparateur de milliers par espace (insécable)
const fcfa = (v) => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const buildConditionsParticulieres = (quote, cp) => {
  const val = (v) => (v === undefined || v === null || v === '' ? VIDE : v);
  const date = (v) => (v ? formatFrDate(v) : VIDE);
  const client = cp.client || {};
  const q = cp.quittance || {};
  const m = cp.montants || {};
  // Détail par véhicule renvoyé en annexe dès qu'il y a plusieurs véhicules
  const enAnnexe = cp.flotte || cp.nb_vehicules > 1;
  const produit = String(quote.produit || 'AUTOMOBILE').toUpperCase();

  const sommesGaranties = (g) => {
    const capitaux = (g.capitaux || []).filter((c) => Number(c) > 0);
    const isRc = g.id_garantie === ID_GARANTIE_RC;
    // RC : toujours une somme max. exprimée en FCFA/sinistre (identique sur tous les véhicules)
    if (isRc) return capitaux.length === 1 ? `${fcfa(capitaux[0])} FCFA/sinistre` : VIDE;
    if (enAnnexe) return 'Voir Annexes';
    return capitaux.length === 1 ? fcfa(capitaux[0]) : VIDE;
  };

  const franchise = (g) => {
    const franchises = g.franchises || [];
    if (franchises.length === 1 && franchises[0]) return franchises[0];
    if (enAnnexe && franchises.some(Boolean)) return 'Voir Annexes';
    return VIDE;
  };

  const ID_SOUS_GARANTIE_CEDEAO = 3;
  const garanties = (cp.garanties || []).filter((g) => g.id_garantie !== ID_SOUS_GARANTIE_CEDEAO);
  const primeNette = garanties.reduce((t, g) => t + (Number(g.prime_nette) || 0), 0);
  const idCompagnie = quote.raw?.compagnie?.IdCompagnie ?? quote.raw?.idcompagnie;
  const sommeTtc = primeNette + (m.accessoire || 0) + (m.taxe || 0) + (m.fga || 0) + (m.cedeao || 0);
  // NSIA : TTC éventuellement arrondie au multiple de 5 supérieur (historique Uranus) ; on reprend
  // l'arrondi uniquement s'il correspond à la TTC enregistrée sur le devis
  const ttcArrondiNsia = Number(idCompagnie) === 1 ? Math.ceil(sommeTtc / 5) * 5 : null;
  const primeTtc = ttcArrondiNsia !== null && m.prime_ttc_enregistree === ttcArrondiNsia ? ttcArrondiNsia : sommeTtc;
  // Prime imposée ou corrigée : les garanties ne retombent pas sur la TTC enregistrée (celle de la
  // facture) — écart signalé à l'écran, comme sur la facture proforma
  const ttcEnregistree = Number(m.prime_ttc_enregistree) || 0;
  const alerteEcart = ttcEnregistree > 0 && ttcEnregistree !== primeTtc ? `
    <div class="alerte-ecart no-print">
      <strong>⚠ Écart avec la prime enregistrée.</strong>
      Prime TTC enregistrée (facture) : <strong>${fcfa(ttcEnregistree)} FCFA</strong> —
      total recalculé à partir des garanties : <strong>${fcfa(primeTtc)} FCFA</strong>
      (écart de ${fcfa(Math.abs(ttcEnregistree - primeTtc))} FCFA, prime probablement imposée).
      Vérifiez le dossier avant de transmettre ces Conditions Particulières.
      <em>(Ce bandeau n'apparaît pas à l'impression.)</em>
    </div>` : '';

  const ligneGarantie = (g) => `
    <tr>
      <td class="g-lib">${g.nature}</td>
      <td>${enAnnexe ? 'Voir Annexes' : 'ACQUISE'}</td>
      <td class="g-num">${sommesGaranties(g)}</td>
      <td>${franchise(g)}</td>
      <td class="g-num">${fcfa(g.prime_nette)}</td>
    </tr>`;

  return `
    ${alerteEcart}
    ${printDocHeader(quote, '')}

    <div class="titre-cp">
      <div>CONDITIONS PARTICULIÈRES</div>
      <div>ASSURANCE ${produit}</div>
    </div>

    <div class="cp-deux-blocs">
      <div class="cp-colonne">
        <div class="cp-section-bar">Références du client</div>
        <table class="cadre-unique cp-bloc">
          <tr><td class="label">Titre</td><td>${val(client.titre)}</td></tr>
          <tr><td class="label">Nom</td><td><strong>${val(client.nom)}</strong></td></tr>
          <tr><td class="label">Adresse</td><td>${val(client.adresse)}</td></tr>
          <tr><td class="label">Téléphone</td><td>${val(client.telephone)}</td></tr>
          <tr><td class="label">Profession</td><td>${val(client.profession)}</td></tr>
        </table>
        <div class="cp-section-bar">Réseau</div>
        <table class="cadre-unique cp-bloc">
          <tr><td class="label">Intermédiaire</td><td>${cp.intermediaire || 'OREOLE ASSURANCES'}</td></tr>
        </table>
      </div>
      <div class="cp-colonne">
        <div class="cp-section-bar">Références de la quittance</div>
        <table class="cadre-unique cp-bloc">
          <tr><td class="label">N° Police</td><td><strong>${val(q.numero_police)}</strong></td></tr>
          <tr><td class="label">Assuré(e)</td><td>${val(q.assure)}</td></tr>
          <tr><td class="label">Adresse</td><td>${val(q.adresse_assure)}</td></tr>
          <tr><td class="label">Effet</td><td>${date(q.date_effet)}</td></tr>
          <tr><td class="label">Expiration</td><td>${date(q.date_expiration)}</td></tr>
          <tr><td class="label">Offre</td><td>${q.offre ? String(q.offre).toUpperCase() : VIDE}</td></tr>
          <tr><td class="label">Mouvement</td><td>${q.mouvement ? String(q.mouvement).toUpperCase() : VIDE}</td></tr>
          <tr><td class="label">Durée</td><td>${q.duree_jours !== null && q.duree_jours !== undefined ? `${q.duree_jours} Jours` : VIDE}</td></tr>
          <tr><td class="label">Date d'émission</td><td>${date(q.date_emission)}</td></tr>
        </table>
      </div>
    </div>

    <table class="tableau-garanties cp-garanties">
      <tr class="ligne-labels">
        <td>Nature du risque</td><td>Garantie</td><td>Sommes max. garanties</td><td>Franchise</td><td>Prime Nette</td>
      </tr>
      ${garanties.length > 0
        ? garanties.map(ligneGarantie).join('')
        : '<tr><td colspan="5">Aucune garantie acquise enregistrée sur ce devis</td></tr>'}
    </table>

    <div class="cp-bas">
      <div class="cp-mentions">
        <p>Les présentes Conditions Particulières prévalent sur les Conditions Générales ou Conventions Spéciales pour autant qu'elles leur sont contraires.</p>
      </div>
      <table class="cadre-unique cp-recap">
        <tr><td class="label">Prime Nette</td><td class="g-num">${fcfa(primeNette)}</td></tr>
        <tr><td class="label">Accessoire</td><td class="g-num">${fcfa(m.accessoire)}</td></tr>
        <tr><td class="label">Taxe d'enregistrement</td><td class="g-num">${fcfa(m.taxe)}</td></tr>
        <tr><td class="label">FGA</td><td class="g-num">${fcfa(m.fga)}</td></tr>
        <tr><td class="label">CEDEAO</td><td class="g-num">${fcfa(m.cedeao)}</td></tr>
        <tr><td class="label">Prime TTC</td><td class="g-num">${fcfa(primeTtc)}</td></tr>
        <tr class="ligne-total"><td class="label">TOTAL NET A PAYER</td><td class="g-num">${fcfa(primeTtc)} FCFA</td></tr>
      </table>
    </div>

    <div class="signatures-deux-colonnes cp-signatures">
      <div>L'assuré</div>
      <div>Pour la compagnie</div>
    </div>
  `;
};

// --- CONDITIONS PARTICULIÈRES AUTO MONO — mise en page des CP NSIA (police 11862122595290Z) :
// cadres client / quittance, fiche véhicule, garanties (prime annuelle, BNS, autres réductions,
// nette annuelle, prime comptant), capitaux sécurité routière, récapitulatif et signatures.
// Le nombre de lignes de garanties suit l'offre souscrite. Sources : quittancecontrat|quittanceproposition,
// garantiesouscrite*, contratdetail|devisdetail.
// Pied de page légal de NSIA ASSURANCES, tel qu'imprimé sur ses Conditions Particulières
const VISA_NSIA = 'Visa: MEF/DGTCP/DA N°736 DU 31 DECEMBRE 1999';
const PIED_NSIA = [
  'NSIA ASSURANCES',
  'Société Anonyme au capital de F. CFA 7 600 000 000 entièrement libéré. Entreprise régie par le code des Assurances CIMA.',
  'CI - ABJ - 1995 - B - 183449 - Compte Contribuable - 9507932 W - Siège Social: Immeuble Manzi, Avenue Noguès Rue A43 Plateau',
  '01 BP 1571 Abidjan 01 - Tél. : (225) 27 20 27 88 88 / (225) 27 20 31 75 00 - Fax: (225) 27 20 22 76 20 / 27 20 33 25 79',
  "Centre d'Impots: D.G.E / Régime: Réel Normal - Site Web : www.groupensia.com - email : nsiaassurancesci@nsiaassurances.com",
];

const ID_SECURITE_ROUTIERE = 169;
const ID_INDIVIDUELLE_CHAUFFEUR = 16;

// Prime nette du récapitulatif des CP auto : hors FGA (qui a sa ligne), CEDEAO comprise comme dans
// le tableau des garanties (pas de ligne CEDEAO au récapitulatif). Un devis à primes imposées
// (sp_maj_manuelle_primes) enregistre sa prime nette sans la CEDEAO : elle y est alors rajoutée.
const primeNetteRecapAuto = (q, estNsia) => {
  const pnHorsFgaEnregistree = q.PrimeNetteHorsFga ?? (q.PrimeNette !== undefined && q.PrimeNette !== null
    ? Number(q.PrimeNette) - Number(q.Fga || 0) : null);
  if (pnHorsFgaEnregistree === null) return null;
  const cedeaoAbsente = q.PrimeNette != null && q.PrimeTtc != null && !cedeaoDansPrimeNette({
    primenette: q.PrimeNette,
    accessoire: q.Accessoire,
    taxe: q.TaxeEnregistrement,
    cedeao: q.Cedeao,
    primettc: q.PrimeTtc,
    arrondiNsia: estNsia,
  });
  return Number(pnHorsFgaEnregistree) + (cedeaoAbsente ? Number(q.Cedeao || 0) : 0);
};

const buildConditionsParticulieresMono = (quote, cp, { contrat = false } = {}) => {
  const q = cp.quittance || {};
  const v = cp.vehicule || {};
  const toutes = cp.garanties || [];
  const libelle = (g) => String(g?.libellesousgarantie || '').trim().toLowerCase();
  // Lignes techniques « *** » : capitaux de la sécurité routière (imprimés sous le tableau) ;
  // le FGA figure au récapitulatif
  const technique = (g) => libelle(g).startsWith('***');
  const garanties = toutes.filter((g) => !technique(g) && libelle(g) !== 'fga');
  const capitalTechnique = (motCle) => toutes.find((g) => technique(g) && libelle(g).includes(motCle))?.capital;

  const txt = (x) => (x === undefined || x === null || String(x).trim() === '' ? VIDE : String(x).trim());
  const date = (x) => (x ? formatFrDate(x) : VIDE);
  const montant = (x) => (x === undefined || x === null || x === '' ? VIDE : fcfa(x));
  // Caractéristiques absentes de la base (PTAC, poids vide…) : 0, comme sur les CP NSIA
  const technico = (x) => fcfa(x ?? 0);
  const pourcent = (x) => `${Math.round(Number(x) || 0)}%`;
  // Prime annuelle après réductions BNS et commerciale (la prime comptant en est la part à la durée)
  const netteAnnuelle = (g) => Math.round((Number(g.primeannuelle) || 0)
    * (1 - (Number(g.reductionbns) || 0) / 100) * (1 - (Number(g.reductioncommerciale) || 0) / 100));
  const total = (f) => garanties.reduce((t, g) => t + Math.round(Number(f(g)) || 0), 0);

  const compagnie = q.RaisonSociale || quote.compagnie || '';
  const logo = getCompagnieLogoUrl(compagnie);
  const estNsia = /nsia/i.test(compagnie);
  const telephone = [q.TelephoneClient, q.MobileClient].find((t) => t && String(t).trim() && String(t).trim() !== '-');
  const primeNetteHorsFga = primeNetteRecapAuto(q, estNsia);
  // « Véhicule Particulier (Voiture, …) » : le type sans sa description entre parenthèses
  const typeVehicule = txt(String(v.libelletypevehicule || '').replace(/\s*\(.*$/, ''));

  // Capitaux non renseignés sur le devis (tous à 0) : rien n'est imprimé après le libellé
  const capitauxSr = ['décès', 'incapacité', 'frais médicaux'].map(capitalTechnique);
  const securiteRoutiere = garanties.some((g) => g.idsousgarantie === ID_SECURITE_ROUTIERE) && capitauxSr.some((c) => Number(c) > 0)
    ? `Deces : ${technico(capitauxSr[0])} / IPT: ${technico(capitauxSr[1])} / FT : ${technico(capitauxSr[2])}`
    : VIDE;
  const chauffeur = garanties.find((g) => g.idsousgarantie === ID_INDIVIDUELLE_CHAUFFEUR);
  const capitauxChauffeur = chauffeur
    ? ([chauffeur.deces, chauffeur.ipp, chauffeur.ft].some((c) => Number(c) > 0)
      ? `Deces : ${technico(chauffeur.deces)} / IPT: ${technico(chauffeur.ipp)} / FT : ${technico(chauffeur.ft)}`
      : txt(chauffeur.textecapital))
    : VIDE;

  const paire = (label, valeur, classe = '') => `<span class="cpn-paire ${classe}"><span class="l">${label}</span><span class="v">${valeur}</span></span>`;

  // Sécurité routière et individuelle chauffeur : capitaux imprimés sous le tableau, pas en colonne
  const sommesGaranties = (g) => ([ID_SECURITE_ROUTIERE, ID_INDIVIDUELLE_CHAUFFEUR].includes(g.idsousgarantie)
    ? VIDE
    : txt(g.textecapital) || (Number(g.capital) > 0 ? fcfa(g.capital) : VIDE));

  const ligne = (g) => `
    <tr>
      <td>${txt(g.libellesousgarantie)}</td>
      <td>${g.souscrite === false ? 'NON' : 'OUI'}</td>
      <td>${sommesGaranties(g)}</td>
      <td>${txt(g.textefranchise) || 'NEANT'}</td>
      <td>${montant(g.primeannuelle)}</td>
      <td>${pourcent(g.reductionbns)}</td>
      <td>${pourcent(g.reductioncommerciale)}</td>
      <td>${fcfa(netteAnnuelle(g))}</td>
      <td>${montant(g.primenette)}</td>
    </tr>`;

  return `
    <div class="cpn${estNsia ? ' cpn-nsia' : ''}">
      <div class="cpn-haut">
        ${logo ? `<img src="${logo}" alt="${compagnie}" class="cpn-logo" />` : `<div class="cpn-compagnie">${txt(compagnie)}</div>`}
      </div>
      <div class="cpn-titre">Conditions Particulières</div>

      <div class="cpn-entete">
        <div class="cpn-cadre cpn-client">
          <table>
            <tr><td class="l">Numéro</td><td colspan="3">${txt(q.IdClient)}</td></tr>
            <tr><td class="l">Nom</td><td colspan="3">${txt(q.NomClient)}</td></tr>
            <tr class="cpn-saut"><td colspan="4"></td></tr>
            <tr><td class="l">Adresse</td><td colspan="3">${txt(q.AdresseClient)}</td></tr>
            <tr><td class="l">Téléphone</td><td>${txt(telephone)}</td><td class="l">Faxe</td><td>${txt(q.FaxClient)}</td></tr>
            <tr><td class="l">Profession</td><td colspan="3">${txt(q.ProfessionClient)}</td></tr>
            <tr><td class="l">RESEAU</td><td colspan="3">${txt(q.LibelleIntermediaire)}</td></tr>
          </table>
        </div>
        <div class="cpn-cadre cpn-police">
          <table>
            <tr><td class="l">Quittance</td><td colspan="5">${txt(q.NumeroQuittance)}</td></tr>
            <tr><td class="l">${contrat ? 'N° Police' : 'N° Devis'}</td><td colspan="3">${txt(contrat ? q.NumeroPolice : q.NumeroDevis)}</td><td class="l">Avenant</td><td>${txt(q.NumeroAvenant)}</td></tr>
            <tr><td class="l">Assuré(e)</td><td colspan="5">${txt(q.NomAssure)}</td></tr>
            <tr class="cpn-saut"><td colspan="6"></td></tr>
            <tr><td class="l">Adresse</td><td colspan="5">${txt(q.AdresseAssure)}</td></tr>
            <tr><td class="l">Mouvement</td><td colspan="5">${txt(q.LibelleMouvement)}</td></tr>
            <tr><td class="l">Offre</td><td colspan="5">${txt(q.LibelleOffre)}</td></tr>
            <tr><td class="l">Effet</td><td>${date(q.DateEffet)}</td><td class="l">Expiration</td><td>${date(q.DateExpiration)}</td><td class="l">Durée</td><td>${txt(q.Duree)}</td></tr>
          </table>
        </div>
      </div>

      <div class="cpn-cadre cpn-bandeau">CONDITIONS PARTICULIERES</div>

      <div class="cpn-cadre cpn-vehicule">
        <div class="cpn-rangee">
          ${paire('N° Immatriculation', txt(v.matricule))}
          ${paire('Date', VIDE)}
          ${paire('1° mise en circulation', date(v.datemec))}
          ${paire('Energie', txt(v.libelleenergie))}
        </div>
        <div class="cpn-rangee">
          ${paire('Marque', txt(v.libellemarque))}
          ${paire('Genre', txt(v.libellegenrevehicule))}
          ${paire('Carosserie', txt(v.libellecarrosserie))}
          ${paire('Nbre Place', txt(v.nombreplace))}
        </div>
        <div class="cpn-rangee">
          ${paire('Puissance', txt(v.puissancefiscale))}
          ${paire('Puissance Réelle', technico(v.puissancereelle))}
          ${paire('Poids vide', technico(v.poidsvide))}
          ${paire('Charge Utile', technico(v.chargeutile))}
          ${paire('PTAC', technico(v.ptac))}
        </div>
        <div class="cpn-rangee">
          ${paire('Type', typeVehicule)}
          ${paire('N° de Série', txt(v.numchassis))}
          ${paire('Valeur Neuve', technico(v.valeurneuve))}
          ${paire('Valeur Venale', technico(v.valeurvenale))}
        </div>
      </div>

      <div class="cpn-cadre cpn-garanties${garanties.length > 9 ? ' cpn-dense' : ''}">
        <div class="cpn-offre">
          ${paire('Offre', txt(q.LibelleOffre))}
          ${paire('Conducteur habituel', txt(v.conducteur))}
        </div>
        <table>
          <colgroup>
            <col style="width:21%" /><col style="width:6%" /><col style="width:13%" /><col style="width:18%" />
            <col style="width:9%" /><col style="width:5.5%" /><col style="width:6.5%" /><col style="width:10.5%" /><col style="width:10.5%" />
          </colgroup>
          <tr class="entete">
            <td>Garanties</td><td>Etats</td><td>Sommes<br/>Garanties</td><td>Franchise</td><td>Prime<br/>Annuelle</td>
            <td>BNS</td><td>Autres</td><td>Nette<br/>Annuelle</td><td>Prime<br/>Comptant</td>
          </tr>
          ${garanties.map(ligne).join('')}
          <tr class="total">
            <td colspan="4">TOTAL VEHICULE :&nbsp;&nbsp;&nbsp;${txt(v.matricule)}</td>
            <td>${fcfa(total((g) => g.primeannuelle))}</td><td></td><td></td>
            <td>${fcfa(total(netteAnnuelle))}</td>
            <td>${fcfa(total((g) => g.primenette))}</td>
          </tr>
        </table>
      </div>

      <div class="cpn-capitaux">SECURITE ROUTIERE : ${securiteRoutiere}</div>
      <div class="cpn-capitaux">Individuelle Chauffeur : ${capitauxChauffeur}</div>

      <div class="cpn-fin">
      <div class="cpn-bas">
        <div class="cpn-mentions">
          <p>Les présentes Conditions Particulières prévalent sur les Conditions Générales ou Conventions Spéciales pour autant qu'elles leur sont contraire.</p>
          ${estNsia ? `<p class="cpn-visa">${VISA_NSIA}</p>` : ''}
        </div>
        <div class="cpn-recap">
          <table>
            <tr><td>Prime Nette</td><td>${montant(primeNetteHorsFga)}</td></tr>
            <tr><td>Accessoire</td><td>${montant(q.Accessoire)}</td></tr>
            <tr><td>Taxe d'enregistrement</td><td>${montant(q.TaxeEnregistrement)}</td></tr>
            <tr><td>FGA</td><td>${montant(q.Fga)}</td></tr>
            <tr><td>Prime TTC</td><td>${montant(q.PrimeTtc)}</td></tr>
          </table>
          <table class="cpn-net">
            <tr><td>Total net à payer</td><td>${montant(q.PrimeTtc)}</td></tr>
          </table>
        </div>
      </div>

      <div class="cpn-signatures">
        <div class="cpn-sig-assure">L'assuré</div>
        <div class="cpn-sig-compagnie">Pour la compagnie</div>
      </div>
      </div>

      ${estNsia ? `
      <div class="cpn-pied">
        <div class="cpn-pied-texte">${PIED_NSIA.map((l, i) => (i === 0 ? `<strong>${l}</strong>` : l)).join('<br/>')}</div>
        <div class="cpn-pied-ligne"><span></span>${logo ? `<img src="${logo}" alt="NSIA" />` : ''}</div>
        <div class="cpn-pied-depuis">depuis 1995</div>
      </div>` : ''}
    </div>
  `;
};

// --- CONDITIONS PARTICULIÈRES FLOTTE AUTO — « Liste des véhicules en Automobile » (modèle NSIA
// imprimé, A4 paysage) : un tableau par catégorie, trois lignes par véhicule sous chaque garantie
// (prime, état Oui / Non, capital ; capital et franchise pour la RC), totaux par catégorie et
// général, récapitulatif de la quittance. Sources : quittanceproposition|quittancecontrat et
// /devis|contrat/:id/vehicules-flotte/.

// Colonnes de garanties du modèle et sous-garanties (stdsousgarantie) qui y sont comptées ; le
// capital imprimé est celui de la première. La prime nette du véhicule reprend toutes ses garanties.
const COLONNES_CP_FLOTTE = [
  { libelle: 'RC', ids: [1, 163, 165], rc: true, largeur: 62 },
  { libelle: 'CEDEAO', ids: [3], largeur: 36 },
  { libelle: 'Protection Cond.', ids: [ID_SECURITE_ROUTIERE, ID_INDIVIDUELLE_CHAUFFEUR, 17, 18, 19, 20], deces: true, largeur: 48 },
  { libelle: 'Défense Recours', ids: [4], largeur: 40 },
  { libelle: 'Remb. Anticipé', ids: [5], largeur: 40 },
  { libelle: 'Immob.', ids: [21], largeur: 36 },
  { libelle: 'Dommage', ids: [7], largeur: 50 },
  { libelle: 'Collision', ids: [8], largeur: 46 },
  { libelle: 'Recours Express', ids: [6, 173], largeur: 40 },
  { libelle: 'Bris de glace', ids: [9, 172], largeur: 48 },
  { libelle: "Assist'Car", ids: [199, 22, 147, 148, 174, 175, 177, 178, 179], largeur: 46 },
  { libelle: 'Incendie', ids: [10, 11, 164], largeur: 48 },
  { libelle: 'Vol Simple', ids: [12], largeur: 48 },
  { libelle: 'Vol à main A.', ids: [13], largeur: 48 },
  { libelle: 'Vol des Accessoires', ids: [15], largeur: 44 },
  { libelle: 'Vandalisme', ids: [14, 223], largeur: 44 },
];
// N°, Marque / Type, Puiss. / Cu., Immatric. / Energie Zone, Valeurs à neuf / Vénale, Nb. Pl.
const IDENTITE_CP_FLOTTE = [20, 62, 32, 58, 54, 22];
const LARGEUR_PRIME_CP_FLOTTE = 50;

const CP_FLOTTE_STYLES = `
  @page { size: A4 landscape; margin: 0; }
  body { max-width: 281mm; color: #000; }
  @media print { body { padding: 7mm 8mm; } }
  .cpf { font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; }
  .cpf-haut { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
  .cpf-gauche { flex: 1; }
  .cpf-logo-ligne { display: flex; align-items: center; gap: 22px; }
  .cpf-logo { height: 46px; display: block; }
  .cpf-compagnie { font-weight: 800; font-size: 12pt; }
  .cpf-nom { margin-top: 6px; }
  .cpf-refs { border-collapse: collapse; }
  .cpf-refs td { padding: 0 8px 1px 0; white-space: nowrap; vertical-align: top; }
  .cpf-refs td.l { font-weight: 700; }
  .cpf-refs td.e { padding-left: 14px; }
  .cpf-titre { flex: none; width: 76mm; margin-top: 26px; border: 1.5px solid #000; border-radius: 10px; padding: 5px 12px; text-align: center; font-weight: 700; font-size: 15pt; line-height: 1.2; }
  .cpf-droite { flex: 1; display: flex; justify-content: flex-end; }
  table.cpf-table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1px solid #000; margin-bottom: 6px; }
  table.cpf-table td { border-left: 1px solid #000; padding: 0 2px; font-size: 6.3pt; line-height: 1.3; vertical-align: top; overflow: hidden; }
  table.cpf-table td.d { text-align: right; white-space: nowrap; }
  table.cpf-table td.c { text-align: center; vertical-align: middle; }
  table.cpf-table td.n { white-space: nowrap; }
  tr.cpf-categorie td { border-left: none; border-bottom: 1px solid #000; font-size: 8pt; font-weight: 700; padding: 2px 4px; }
  tr.cpf-categorie td.v { font-weight: 400; }
  tr.cpf-entete td { border-bottom: 1px solid #000; font-weight: 700; font-size: 6.3pt; line-height: 1.15; padding: 2px; vertical-align: top; overflow-wrap: anywhere; }
  tr.cpf-entete td.g { text-align: center; vertical-align: middle; }
  .cpf-entete-bas { display: flex; justify-content: space-between; margin-top: 6px; }
  tbody.cpf-vehicule { break-inside: avoid; }
  tbody.cpf-vehicule tr:first-child td { border-top: 1px solid #000; padding-top: 1px; }
  tbody.cpf-vehicule tr:last-child td { padding-bottom: 2px; }
  .cpf-energie { display: flex; justify-content: space-between; }
  tr.cpf-total td { border-top: 1px solid #000; font-weight: 700; font-size: 6.5pt; padding: 3px 2px; vertical-align: middle; }
  tr.cpf-total td.l { font-size: 7.5pt; white-space: nowrap; }
  tr.cpf-general td { border-top: 1.5px solid #000; }
  .cpf-bas { display: flex; justify-content: flex-end; margin-top: 10px; break-inside: avoid; }
  .cpf-recap { border: 1px solid #000; padding: 4px 12px 0; min-width: 72mm; }
  .cpf-recap table { border-collapse: collapse; margin-left: auto; }
  .cpf-recap td { padding: 1px 0; font-size: 9pt; font-weight: 700; white-space: nowrap; }
  .cpf-recap td:first-child { text-align: right; padding-right: 10px; }
  .cpf-recap .cpf-net { border-top: 1px solid #000; margin: 4px -12px 0; padding: 5px 12px; text-align: center; font-weight: 700; font-size: 9.5pt; }
  .cpf-recap .cpf-net span + span { margin-left: 10px; }
`;

const buildConditionsParticulieresFlotte = (quote, { quittance, vehicules }, { contrat = false } = {}) => {
  const q = quittance || {};
  const t = (x) => echapperHtml(x === undefined || x === null ? '' : String(x).trim());
  const date = (x) => (x ? formatFrDate(x) : VIDE);
  const montant = (x) => fcfa(x);
  const compagnie = q.RaisonSociale || quote.compagnie || '';
  const logo = getCompagnieLogoUrl(compagnie);
  const estNsia = /nsia/i.test(compagnie);

  // Type commercial du véhicule, sinon sigle de son type (« Véhicule Particulier (…) » → VP)
  const typeVehicule = (v) => {
    if (String(v.modele || '').trim()) return v.modele;
    const type = String(v.type_vehicule || '').replace(/\s*\(.*$/, '').trim();
    return type.split(/\s+/).filter((m) => m.length > 2).map((m) => m[0].toUpperCase()).join('') || type;
  };
  const energie = (libelle) => String(libelle || '').trim().slice(0, 2);

  // Une colonne d'un véhicule : prime cumulée, état et capital de ses sous-garanties
  const colonne = (v, col) => {
    const garanties = col.ids
      .map((id) => (v.garanties || []).find((g) => g.id_garantie === id && g.acquise))
      .filter(Boolean);
    const principale = garanties[0];
    return {
      prime: garanties.reduce((s, g) => s + (Number(g.prime_nette) || 0), 0),
      acquise: garanties.length > 0,
      capital: principale ? (col.deces ? (principale.deces || principale.capital) : principale.capital) : 0,
      franchise: principale ? principale.franchise : 0,
    };
  };
  const primeVehicule = (v) => (v.garanties || []).filter((g) => g.acquise)
    .reduce((s, g) => s + (Number(g.prime_nette) || 0), 0);
  const idsEnColonne = new Set(COLONNES_CP_FLOTTE.flatMap((c) => c.ids));
  const horsColonnes = (vehicules || []).flatMap((v) => (v.garanties || [])
    .filter((g) => g.acquise && Number(g.prime_nette) && !idsEnColonne.has(g.id_garantie)));
  if (horsColonnes.length) console.warn('CP flotte : garanties sans colonne (comptées dans la prime nette)', horsColonnes);

  // Groupes par catégorie / tarif, dans l'ordre renvoyé (catégorie puis tarif)
  const groupes = [];
  (vehicules || []).forEach((v) => {
    let groupe = groupes.find((g) => g.idTarif === v.id_tarif);
    if (!groupe) groupes.push(groupe = { idTarif: v.id_tarif, code: v.code_categorie, tarif: v.tarif || v.categorie, vehicules: [] });
    groupe.vehicules.push(v);
  });

  const nbColonnes = IDENTITE_CP_FLOTTE.length + COLONNES_CP_FLOTTE.length + 1;
  const unites = [...IDENTITE_CP_FLOTTE, ...COLONNES_CP_FLOTTE.map((c) => c.largeur), LARGEUR_PRIME_CP_FLOTTE];
  const total = unites.reduce((a, b) => a + b, 0);
  const colgroup = `<colgroup>${unites.map((u) => `<col style="width:${((u * 100) / total).toFixed(3)}%">`).join('')}</colgroup>`;

  const entete = (g) => `
    <thead>
      <tr class="cpf-categorie">
        <td colspan="2">Catégorie</td><td colspan="2" class="v">${t(g.code)}</td>
        <td colspan="${nbColonnes - 4}">${t(g.tarif)}</td>
      </tr>
      <tr class="cpf-entete">
        <td>N°</td>
        <td>Marque<div class="cpf-entete-bas"><span>Type</span></div></td>
        <td>Puiss.<div class="cpf-entete-bas"><span>Cu.</span></div></td>
        <td>Immatric.<div class="cpf-entete-bas"><span>Energie</span><span>Zone</span></div></td>
        <td>Valeurs à neuf<div class="cpf-entete-bas"><span>Vénale</span></div></td>
        <td>Nb. Pl.</td>
        ${COLONNES_CP_FLOTTE.map((c) => `<td class="g">${t(c.libelle)}</td>`).join('')}
        <td class="g">Prime Nette</td>
      </tr>
    </thead>`;

  let numero = 0;
  const ligneVehicule = (v) => {
    numero += 1;
    const cellules = COLONNES_CP_FLOTTE.map((col) => ({ col, ...colonne(v, col) }));
    const etat = ({ col, acquise, capital, franchise }) => (col.rc && acquise
      ? `${montant(capital)}<br/>${montant(franchise)}`
      : `${acquise ? 'Oui' : 'Non'}<br/>${montant(capital)}`);
    return `
      <tbody class="cpf-vehicule">
        <tr>
          <td rowspan="2">${numero}</td>
          <td>${t(v.marque)}</td>
          <td class="d">${t(v.puissance)}</td>
          <td class="n">${t(v.immatriculation)}</td>
          <td class="d">${montant(v.valeur_neuve)}</td>
          <td rowspan="2" class="c">${t(v.nombre_places)}</td>
          ${cellules.map((c) => `<td class="d">${montant(c.prime)}</td>`).join('')}
          <td rowspan="2" class="d">${montant(primeVehicule(v))}</td>
        </tr>
        <tr>
          <td>${t(typeVehicule(v))}</td>
          <td class="d">${montant(v.charge_utile)}</td>
          <td><div class="cpf-energie"><span>${t(energie(v.energie))}</span><span></span></div></td>
          <td class="d">${montant(v.valeur_venale)}</td>
          ${cellules.map((c) => `<td class="n">${etat(c)}</td>`).join('')}
        </tr>
      </tbody>`;
  };

  const ligneTotal = (libelle, liste, classe = '') => `
    <tr class="cpf-total ${classe}">
      <td colspan="4" class="l">${libelle}</td>
      <td colspan="2" class="c">${liste.length} Véhicule(s)</td>
      ${COLONNES_CP_FLOTTE.map((col) => `<td class="d">${montant(liste.reduce((s, v) => s + colonne(v, col).prime, 0))}</td>`).join('')}
      <td class="d">${montant(liste.reduce((s, v) => s + primeVehicule(v), 0))}</td>
    </tr>`;

  const tableaux = groupes.length ? groupes.map((g, i) => `
    <table class="cpf-table">
      ${colgroup}
      ${entete(g)}
      ${g.vehicules.map(ligneVehicule).join('')}
      <tbody>
        ${ligneTotal(`Total Catégorie&nbsp;&nbsp;&nbsp;${t(g.code)}`, g.vehicules)}
        ${i === groupes.length - 1 ? ligneTotal('Total Général', vehicules, 'cpf-general') : ''}
      </tbody>
    </table>`).join('') : `
    <table class="cpf-table">${colgroup}${entete({ code: '', tarif: '' })}
      <tbody><tr><td colspan="${nbColonnes}" class="c">Aucun véhicule enregistré.</td></tr></tbody>
    </table>`;

  // Primes imposées sur le récapitulatif : les garanties des véhicules n'y retombent plus
  const primeNetteRecap = primeNetteRecapAuto(q, estNsia);
  const totalGeneral = (vehicules || []).reduce((s, v) => s + primeVehicule(v), 0);
  const alerteEcart = primeNetteRecap !== null && vehicules?.length && Math.abs(primeNetteRecap - totalGeneral) > 1 ? `
    <div class="alerte-ecart no-print">
      <strong>⚠ Écart avec la prime enregistrée.</strong> Total des véhicules : <strong>${montant(totalGeneral)}</strong>
      — prime nette du récapitulatif : <strong>${montant(primeNetteRecap)}</strong> (prime probablement imposée).
      <em>(Ce bandeau n'apparaît pas à l'impression.)</em>
    </div>` : '';

  return `
    <style>${CP_FLOTTE_STYLES}</style>
    ${alerteEcart}
    <div class="cpf">
      <div class="cpf-haut">
        <div class="cpf-gauche">
          <div class="cpf-logo-ligne">
            ${logo ? `<img src="${logo}" alt="${t(compagnie)}" class="cpf-logo" />` : `<div class="cpf-compagnie">${t(compagnie)}</div>`}
            <table class="cpf-refs">
              <tr><td class="l">Numéro</td><td>${t(q.IdClient)}</td></tr>
              <tr><td class="l">Date</td><td>${date(q.DateEmission)}</td></tr>
            </table>
          </div>
          <div class="cpf-nom">${t([q.TitreClient, q.NomClient].filter((x) => x && String(x).trim()).join(' '))}</div>
          <table class="cpf-refs"><tr><td class="l">Adresse</td><td>${t(q.AdresseClient)}</td></tr></table>
        </div>
        <div class="cpf-titre">${contrat ? 'CONDITIONS PARTICULIERES' : 'PROPOSITION'} : Liste des véhicules en Automobile</div>
        <div class="cpf-droite">
          <table class="cpf-refs">
            <tr><td class="l">Quittance N°</td><td>${contrat ? t(q.NumeroQuittance) : 'PROPOSITION'}</td><td class="l e">Emise le</td><td>${date(q.DateEmission)}</td></tr>
            <tr><td class="l">${contrat ? 'N° Police' : 'N° Devis'}</td><td colspan="3">${t(contrat ? q.NumeroPolice : q.NumeroDevis)}</td></tr>
            <tr><td class="l">Assuré(e)</td><td colspan="3">${t(q.NomAssure)}</td></tr>
            <tr><td class="l">Effet</td><td>${date(q.DateEffet)}</td><td class="l e">Expiration</td><td>${date(q.DateExpiration)}</td></tr>
          </table>
        </div>
      </div>

      ${tableaux}

      <div class="cpf-bas">
        <div class="cpf-recap">
          <table>
            <tr><td>Prime Nette</td><td>${primeNetteRecap === null ? VIDE : montant(primeNetteRecap)}</td></tr>
            <tr><td>Accessoire</td><td>${montant(q.Accessoire)}</td></tr>
            <tr><td>Taxe d'enregistrement</td><td>${montant(q.TaxeEnregistrement)}</td></tr>
            <tr><td>FGA</td><td>${montant(q.Fga)}</td></tr>
            <tr><td>Prime TTC</td><td>${montant(q.PrimeTtc)}</td></tr>
          </table>
          <div class="cpf-net"><span>Total net à payer</span><span>${montant(q.PrimeTtc)}</span></div>
        </div>
      </div>
    </div>`;
};

// --- GABARITS IA (Individuelle Accidents), repris d'URANUS -----------------------------------
// Proposition « groupe » (devis flotte), Conditions Particulières individuelles et facture avec
// la liste des assurés et de leurs ayants droit. Données : quittanceproposition, garanties
// souscrites, assureiapardevis et ayantdroitia (voir impressionIaApi).

// Devis IA enregistré en base (produit 2). Contrats et devis seulement locaux : gabarits habituels.
const estDevisIa = (quote) => {
  const raw = quote?.raw || {};
  if (raw.idcontrat || !Number(quote?.iddevis || raw.iddevis)) return false;
  const p = raw.produit;
  const idProduit = Number(p && typeof p === 'object' ? (p.id_produit ?? p.IdProduit) : (raw.idproduit ?? p));
  if (idProduit) return idProduit === 2;
  return /individuelle|accident/i.test(String(quote.produit || quote.branche || ''));
};

// Quittance de la proposition ; si la base n'en renvoie pas, valeurs lues sur le devis lui-même
const quittanceIa = (quote, q) => {
  if (q && Object.keys(q).length > 0) return q;
  const raw = quote.raw || {};
  const client = raw.client && typeof raw.client === 'object' ? raw.client : {};
  const jours = raw.dateeffet && raw.dateexpiration
    ? Math.round((new Date(raw.dateexpiration) - new Date(raw.dateeffet)) / 86400000) + 1
    : '';
  const primeNette = Number(raw.primenette ?? quote.prime_nette ?? 0);
  return {
    NumeroDevis: raw.numerodevis || quote.numerodevis,
    TitreClient: '',
    NomClient: `${client.Nom || ''} ${client.Prenoms || ''}`.trim() || quote.client_nom,
    AdresseClient: client.Adresse1 || '',
    TelephoneClient: client.Telephone || '',
    ProfessionClient: '',
    IdClient: client.IdClient,
    LibelleIntermediaire: raw.intermediaire?.LibelleIntermediaire || '',
    LibelleOffre: raw.offre?.LibelleOffre || '',
    LibelleBareme: '',
    Duree: jours,
    DateEffet: raw.dateeffet || quote.date_effet,
    DateExpiration: raw.dateexpiration || quote.date_expiration,
    DateEmission: raw.dateemission || quote.date_emission,
    PrimeNette: primeNette,
    PrimeNetteHorsFga: primeNette - Number(raw.fga || 0),
    Accessoire: raw.accessoire ?? quote.accessoires,
    TaxeEnregistrement: raw.taxe ?? quote.taxes,
    PrimeTtc: raw.primettc ?? quote.prime_totale,
    LibelleProduit: raw.produit?.libelle_produit || 'INDIVIDUELLE ACCIDENTS',
    LibelleCategorie: quote.categorie || '',
  };
};

// Montants avec une espace ordinaire : l'espace insécable s'imprime trop large en Arial Narrow gras
const fcfaIa = (v) => fcfa(v).replace(/\u00a0/g, ' ');
const dateTiret = (x) => (x ? formatFrDate(x).replace(/\//g, '-') : '');
const dateBarre = (x) => (x ? formatFrDate(x) : '');
const montantIa = (x) => (x !== undefined && x !== null && x !== '' && Number(x) ? fcfaIa(x) : '-');
const texteIa = (x) => (x === undefined || x === null ? '' : String(x).trim());
const categorieIa = (q) => texteIa(q.LibelleCategorie) || 'INDIVIDUELLE ACCIDENTS';
const estCategorieGroupe = (q) => /^(PROPOSITION )?INDIVIDUELLE ACCIDENTS GROUPE$/.test(categorieIa(q).replace(/\s+/g, ' ').toUpperCase());

// Références de la quittance (bloc de droite, commun aux deux documents)
const blocQuittanceIa = (q) => `
  <div class="ia-boite">
    <div class="ia-boite-titre">Références de la Quittance</div>
    <table class="ia-lignes">
      <tr><td class="l">N° Proposition</td><td>${texteIa(q.NumeroDevis)}</td></tr>
      <tr><td class="l">Adresse</td><td>${texteIa(q.AdresseClient)}</td></tr>
      <tr><td class="l">Effet</td><td>${dateTiret(q.DateEffet)}<span class="ia-ecart"></span><b>Expiration</b>&nbsp; ${dateTiret(q.DateExpiration)}</td></tr>
      <tr><td class="l">Offre</td><td>${texteIa(q.LibelleOffre)}</td></tr>
      <tr><td class="l">Mouvement</td><td>Proposition</td></tr>
      <tr><td class="l">Ecriture</td><td>${texteIa(q.LibelleBareme)}<span class="ia-ecart"></span><b>Durée(jours)</b> ${texteIa(q.Duree)}</td></tr>
    </table>
  </div>`;

const paragrapheProposition = (q) => `
  <div class="ia-proposition">
    <div class="ia-proposition-titre">PROPOSITION</div>
    <p>Nous avons l’avantage de vous faire connaître par la présente nos meilleures conditions de garantie et de prime pour la couverture des risques précisés dans l’annexe jointe.</p>
    <p>Les capitaux garantis et la liste des assurés sont ceux mentionnés en annexe ci-joint.</p>
    <p>Les garanties sont consenties pour la période du ${dateTiret(q.DateEffet)} au ${dateTiret(q.DateExpiration)} moyennant une prime de ${fcfaIa(q.PrimeTtc)} FCFA frais et taxes compris suivant décompte ci-dessous :</p>
  </div>`;

const tableauGarantiesIa = (garanties, { capitalTexte = false } = {}) => {
  const nombre = (x) => {
    const n = parseFloat(String(x ?? '').replace(/[^\d.-]/g, ''));
    return Number.isNaN(n) ? '0' : fcfaIa(Math.abs(n));
  };
  const entier = (x) => {
    const n = parseInt(String(x ?? '').replace(/[^\d]/g, ''), 10);
    return Number.isNaN(n) ? '0' : String(n);
  };
  const libre = (x) => texteIa(x) || 'NON SPECIFIE';
  const lignes = (garanties || []).length
    ? garanties.map((g) => `
      <tr>
        <td class="g">${libre(g.libellesousgarantie)}</td>
        <td>${capitalTexte ? (texteIa(g.textecapital) || nombre(g.capital)) : nombre(g.capital)}</td>
        <td>${libre(g.textefranchise)}</td>
        <td>${g.tauxfranchise ? `${parseFloat(g.tauxfranchise) || 0}%` : '0%'}</td>
        <td>${entier(g.minimumfranchise)}</td>
        <td>${entier(g.maximumfranchise)}</td>
        <td class="n">${nombre(g.primenette)}</td>
      </tr>`).join('')
    : `<tr><td class="g">AUCUNE GARANTIE DISPONIBLE</td><td>0</td><td>NON SPECIFIE</td><td>0%</td><td>0</td><td>0</td><td class="n">0</td></tr>`;
  return `
    <div class="ia-garanties-titre">GARANTIES ACCORDEES</div>
    <table class="ia-garanties">
      <tr class="entete">
        <td rowspan="2" style="width:22%">GARANTIES</td>
        <td rowspan="2" style="width:15%">CAPITAUX</td>
        <td colspan="4">FRANCHISES</td>
        <td rowspan="2" style="width:15%">PRIMES NETTES</td>
      </tr>
      <tr class="entete"><td>NATURE</td><td>TAUX(%)</td><td>Minimum (jrs)</td><td>Maximum (jrs)</td></tr>
      ${lignes}
    </table>`;
};

const decompteIa = (q, primeNette) => `
  <div class="ia-decompte">
    <p>Par conséquent, le souscripteur s'engage à payer au comptant à la signature du présent avenant la somme de FCFA ${montantIa(q.PrimeTtc)} décomptée comme suit:</p>
    <table class="ia-montants">
      <tr><td>Prime nette:</td><td>${montantIa(primeNette)}</td></tr>
      <tr><td>Accessoires:</td><td>${montantIa(q.Accessoire)}</td></tr>
      <tr><td>Taxes d'enregistrement:</td><td>${montantIa(q.TaxeEnregistrement)}</td></tr>
      <tr><td>Total à Payer:</td><td>${montantIa(q.PrimeTtc)}</td></tr>
    </table>
    <p>Il n'est pas autrement dérogé au terme du présent contrat</p>
  </div>`;

// Proposition IA « groupe » (devis flotte) — modèle URANUS « PROPOSITION INDIVIDUELLE ACCIDENTS GROUPE »
const buildPropositionIaGroupe = (quote, donnees) => {
  const q = quittanceIa(quote, donnees.quittance);
  return `
    <div class="ia">
      <img src="/assets/print/logo-oreole-entete.png" alt="OREOLE Assurances" class="ia-logo" />
      <div class="ia-titre">PROPOSITION ${categorieIa(q)}</div>
      <div class="ia-refs">
        <div class="ia-boite">
          <div class="ia-boite-titre">Références du Souscripteur</div>
          <table class="ia-lignes">
            <tr><td class="l">Titre</td><td>${texteIa(q.TitreClient)}</td></tr>
            <tr><td class="l">Nom</td><td>${texteIa(q.NomClient)}</td></tr>
            <tr><td class="l">Adresse</td><td>${texteIa(q.AdresseClient)}</td></tr>
            <tr><td class="l">Téléphone</td><td>${texteIa(q.TelephoneClient)}</td></tr>
            <tr><td class="l">Profession</td><td>${texteIa(q.ProfessionClient)}</td></tr>
            <tr><td class="l">Intermédiaire</td><td>${texteIa(q.LibelleIntermediaire)}</td></tr>
            <tr><td class="l">Réseau</td><td>Courtage</td></tr>
          </table>
        </div>
        ${blocQuittanceIa(q)}
      </div>
      ${paragrapheProposition(q)}
      ${estCategorieGroupe(q) ? '' : tableauGarantiesIa(donnees.garanties, { capitalTexte: true })}
      ${decompteIa(q, q.PrimeNetteHorsFga)}
      <div class="ia-fait">Fait à Abidjan, le ${dateTiret(q.DateEmission)}</div>
      <div class="ia-signatures"><div>LE SOUSCRIPTEUR</div><div>POUR LA COMPAGNIE</div></div>
    </div>`;
};

// Conditions Particulières IA individuelle — modèle URANUS (assuré, bénéficiaires, garanties)
const buildConditionsParticulieresIa = (quote, donnees) => {
  const q = quittanceIa(quote, donnees.quittance);
  const groupe = estCategorieGroupe(q);
  const assures = donnees.assures || [];
  const beneficiaires = donnees.ayantsDroit || [];
  const blocAssures = assures.map((a, i) => `
    <table class="ia-lignes ia-assure">
      <tr><td class="l">Nom</td><td>${texteIa(a.Nom)} ${texteIa(a.Prenoms)}</td></tr>
      <tr><td class="l">Adresse</td><td>${texteIa(a.AdressePostale)}</td></tr>
      <tr><td class="l">Profession</td><td>${texteIa(a.Profession)}</td></tr>
      <tr><td class="l">Né(e) le</td><td>${dateBarre(a.DateNaissance)}</td></tr>
      <tr><td class="l">A</td><td>${texteIa(a.LieuNaissance)}</td></tr>
    </table>${i < assures.length - 1 ? '<div class="ia-separateur"></div>' : ''}`).join('');
  const lignesBeneficiaires = beneficiaires.length
    ? beneficiaires.map((b) => `<tr><td>${texteIa(b.nom_ayant_droit)}</td><td>${texteIa(b.prenoms_ayant_droit)}</td><td class="n">${b.part ? `${parseInt(b.part, 10)}%` : ''}</td></tr>`).join('')
    : '<tr><td>&nbsp;</td><td></td><td></td></tr>';
  return `
    <div class="ia">
      <img src="/assets/print/logo-oreole-entete.png" alt="OREOLE Assurances" class="ia-logo" />
      <div class="ia-titre">PROPOSITION ${categorieIa(q)}</div>
      <div class="ia-refs">
        <div class="ia-boite">
          <div class="ia-boite-titre">Références du Client</div>
          <table class="ia-lignes">
            <tr><td class="l">Numéro</td><td>${texteIa(q.IdClient)}<span class="ia-ecart"></span><b>Titre</b>&nbsp; ${texteIa(q.TitreClient)}</td></tr>
            <tr><td class="l">Nom</td><td>${texteIa(q.NomClient)}</td></tr>
            <tr><td class="l">Adresse</td><td>${texteIa(q.AdresseClient)}</td></tr>
            <tr><td class="l">Téléphone</td><td>${texteIa(q.TelephoneClient)}</td></tr>
            <tr><td class="l">Profession</td><td>${texteIa(q.ProfessionClient)}</td></tr>
            <tr><td class="l">Intermédiaire</td><td>${texteIa(q.LibelleIntermediaire)}</td></tr>
            <tr><td class="l">Réseau</td><td>Courtage</td></tr>
          </table>
        </div>
        ${blocQuittanceIa(q)}
      </div>
      ${groupe ? paragrapheProposition(q) : `
      <div class="ia-cp-titre">Conditions Particulières</div>
      <div class="ia-refs">
        <div class="ia-boite">
          <div class="ia-rubrique">ASSURE</div>
          ${blocAssures || '<table class="ia-lignes"><tr><td>&nbsp;</td></tr></table>'}
        </div>
        <div class="ia-boite">
          <div class="ia-rubrique">BENEFICIAIRES EN CAS DE DECES</div>
          <table class="ia-beneficiaires">
            <tr class="entete"><td>Nom</td><td>Prénoms</td><td class="n">Part(%)</td></tr>
            ${lignesBeneficiaires}
          </table>
        </div>
      </div>
      ${tableauGarantiesIa(donnees.garanties)}`}
      ${decompteIa(q, q.PrimeNette)}
      <div class="ia-fait">Fait à Abidjan le ${dateBarre(q.DateEmission)}</div>
      <div class="ia-signatures"><div>Le Souscripteur</div><div>Pour la Compagnie</div></div>
    </div>`;
};

// Facture IA — modèle URANUS « FACTURE N° … » avec assurés et ayants droit
const buildFactureIa = (quote, donnees) => {
  const q = quittanceIa(quote, donnees.quittance);
  const ligneValeur = (libelle, valeur) => `
    <div class="iaf-ligne"><div class="iaf-l">${libelle}</div><div class="iaf-v">${valeur}</div></div>`;
  const assures = (donnees.assures || []).map((a) => `
    <tr><td>${texteIa(a.Nom)}</td><td>${dateTiret(a.DateNaissance)}</td><td>${texteIa(a.Profession)}</td><td>${texteIa(a.AdresseGeographique)}</td><td>${texteIa(a.AdressePostale)}</td></tr>
    <tr class="iaf-ad"><td></td><td>AYANTS DROIT</td><td>Nom et prénoms</td><td>Qualité</td><td>Part</td></tr>
    ${(a.AyantsDroit || []).map((d) => `
    <tr><td></td><td></td><td>${texteIa(d.nom_ayant_droit)} ${texteIa(d.prenoms_ayant_droit)}</td><td>${texteIa(d.libelle_qualite)}</td><td>${parseInt(d.part, 10) || 0} %</td></tr>`).join('')}`).join('');
  return `
    <div class="iaf">
      <div class="ia-titre">FACTURE N° ${texteIa(q.NumeroDevis)}</div>
      <div class="iaf-rubrique">SOUSCRIPTEUR</div>
      ${ligneValeur('Nom', texteIa(q.NomClient))}
      ${ligneValeur('Adresse', texteIa(q.AdresseClient))}
      <div class="iaf-rubrique">ASSURES, AYANTS DROIT</div>
      <table class="iaf-assures">
        <tr class="iaf-entete"><td>Nom</td><td>Date de naissance</td><td>Profession</td><td>Adresse géog.</td><td>Adresse Postale</td></tr>
        ${assures}
      </table>
      <div class="iaf-rubrique">Référence police et périodicité</div>
      ${ligneValeur('Au titre de la police', texteIa(q.LibelleProduit))}
      ${ligneValeur('Numéro Devis', texteIa(q.NumeroDevis))}
      ${ligneValeur('Pour la période allant du', `${dateBarre(q.DateEffet)} Au ${dateBarre(q.DateExpiration)}`)}
      <div class="iaf-rubrique">Détail de la facture</div>
      <div class="iaf-detail">
        <div>Prime Nette : ${fcfaIa(q.PrimeNette)}</div>
        <div>Accessoire : ${fcfaIa(q.Accessoire)}</div>
        <div>Taxe d'enregistrement : ${fcfaIa(q.TaxeEnregistrement)}</div>
        <div>PRIME TOTALE A PAYER: ${fcfaIa(q.PrimeTtc)}</div>
      </div>
      <div class="iaf-cima">Conformément aux dispositions de l’Article 13 et suivants du Code des Assurances (Code CIMA) « La prise d’effet du contrat est subordonnée au paiement intégral de la prime ». « Pour les polices des risques autres que la maladie, l’automobile et les marchandises transportées dont la prime est supérieure à 80 fois le SMIG annuel, un délai maximum du contrat peut être accordé au souscripteur » de paiement de 60 jours à compter de la date de prise d'effet ou de renouvellement « A défaut du paiement de la prime dans le délai convenu, le contrat est résilié de plein droit. La portion de prime courue reste acquise à l’assureur sans préjudice des éventuels frais de poursuite et de recouvrement » « Lorsqu’un chèque ou effet remis en paiement de la prime revient impayé, l’assuré est mis en demeure de régulariser le paiement dans un délai de 8 jours ouvrés à compter de la réception de l’acte ou de la lettre de mise en demeure. A l’expiration de ce délai, si la régularisation n’est pas effectuée, le contrat est résilié de plein droit La portion de prime courue reste acquise</div>
      <div class="iaf-fait">Fait à Abidjan, le <b>${dateBarre(q.DateEmission)}.</b></div>
      <div class="iaf-signatures"><div>LE SOUSCRIPTEUR</div><div>LA COMPAGNIE</div></div>
    </div>`;
};

// Annexe IA — liste des assurés du devis avec capitaux et ayants droit (modèle URANUS)
const buildAnnexeIa = (quote, donnees) => {
  const q = quittanceIa(quote, donnees.quittance);
  // Capitaux en nombre entier sans séparateur, comme sur l'annexe URANUS
  const capital = (x) => {
    if (x === undefined || x === null || x === '') return '';
    const n = parseFloat(x);
    return Number.isNaN(n) ? String(x) : String(Math.round(n));
  };
  const cartes = (donnees.assures || []).map((a) => {
    const ayants = a.AyantsDroit || [];
    const tableAyants = ayants.length
      ? `<table class="iaa-table">
          <tr class="entete"><td style="width:55%">Nom et prénoms</td><td style="width:27%">Qualité</td><td>Part</td></tr>
          ${ayants.map((d, i) => `<tr${i % 2 === 1 ? ' class="alt"' : ''}><td>${texteIa(d.nom_ayant_droit)} ${texteIa(d.prenoms_ayant_droit)}</td><td>${texteIa(d.libelle_qualite)}</td><td>${parseInt(d.part, 10) || 0} %</td></tr>`).join('')}
        </table>`
      : '<div class="iaa-vide">AUCUNE DONNEE</div>';
    return `
      <div class="iaa-carte">
        <div class="iaa-carte-entete">
          <div class="iaa-gauche">
            <div class="iaa-nom">${texteIa(a.Nom)}&nbsp; ${texteIa(a.Prenoms)}</div>
            <div class="iaa-sous">Né(e) le ${dateTiret(a.DateNaissance)}${a.Profession ? ` • ${texteIa(a.Profession)}` : ''}</div>
          </div>
          <div class="iaa-droite">
            ${a.AdresseGeographique ? `<div>${texteIa(a.AdresseGeographique)}</div>` : ''}
            ${a.AdressePostale ? `<div>${texteIa(a.AdressePostale)}</div>` : ''}
          </div>
        </div>
        <div class="iaa-capitaux">
          <b>Capital décès : </b>${capital(a.CapitalDeces)}&nbsp; •&nbsp; <b>Capital infirmité : </b>${capital(a.CapitalInfirmite)}&nbsp; •&nbsp; <b>Capital frais de traitement :</b>${capital(a.CapitalFraisTraitement)}
        </div>
        <div class="iaa-ayants">
          <div class="iaa-ayants-titre">AYANTS DROIT</div>
          ${tableAyants}
        </div>
      </div>`;
  }).join('');
  return `
    <div class="ia iaa">
      <img src="/assets/print/logo-oreole-entete.png" alt="OREOLE Assurances" class="ia-logo" />
      <div class="iaa-corps">
        <div class="iaa-bandeau">
          <div class="iaa-bandeau-titre">ANNEXE – LISTE DES ASSURES INDIVIDUELLE ACCIDENT</div>
          <div class="iaa-badge">N° DEVIS : ${texteIa(q.NumeroDevis)}</div>
        </div>
        ${cartes || '<div class="iaa-carte"><div class="iaa-vide">AUCUN ASSURE ENREGISTRE POUR CE DEVIS</div></div>'}
      </div>
    </div>`;
};

// Ouvre la fenêtre tout de suite (sinon bloquée pendant l'appel API), puis la remplit
const imprimerDocumentIa = async (quote, titre, construire) => {
  const fenetre = window.open('', '_blank');
  if (fenetre) fenetre.document.write('<p style="font-family:Arial;padding:20px;">Préparation du document…</p>');
  try {
    const donnees = await impressionIaApi.get(Number(quote.iddevis || quote.raw?.iddevis));
    openPrintWindow(titre, construire(quote, donnees), fenetre);
  } catch (err) {
    console.error('Erreur impression IA:', err);
    if (fenetre) {
      fenetre.document.open();
      fenetre.document.write('<p style="font-family:Arial;padding:20px;color:#b91c1c;">Impossible de charger les données du devis pour ce document. Veuillez réessayer.</p>');
      fenetre.document.close();
    }
  }
};

// Bouton « Imprimer Annexe » : réservé aux devis IA enregistrés en base
export const estDevisIaImprimable = (quote) => Boolean(quote) && estDevisIa(quote);
export const printAnnexeIa = (quote) => {
  if (!quote) return undefined;
  return imprimerDocumentIa(quote, `Annexe ${quote.numerodevis || ''}`.trim(), buildAnnexeIa);
};

/* =========================================================================
   VOYAGE : Proposition (gabarit URANUS scenes/Products/Documents/Voyage/QuittanceProposition,
   document OREOLE « ASSURANCE VOYAGE PROPOSITION »). URANUS laissait Capital, Franchise et Prime
   prorata vides (noms de champs erronés) : ils sont lus dans les garanties souscrites du devis.
   La date de naissance imprimée est celle retenue par le tarif (saisie sur le devis), à défaut
   celle de la fiche de l'assuré.
   ========================================================================= */
export const estDevisVoyage = (quote) => /voyag/i.test(String(quote?.branche || quote?.produit || ''));

const buildPropositionVoyage = (quote, { quittance: q = {}, garanties = [], voyage = null }) => {
  const jma = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('-') : VIDE);
  const naissance = voyage?.Detail?.DateNaissance || q.DateNaissanceAssure;
  // Franchise enregistrée sur la garantie du devis (32 800 posé par sp_creation_devis_voyage), à défaut
  // le texte de franchise de la base
  const franchise = (g) => {
    const montant = (voyage?.Garanties || []).find((x) => Number(x.IdSousGarantie) === Number(g.idsousgarantie))?.Franchise;
    return Number(montant) > 0 ? fcfa(montant) : (g.textefranchise || VIDE);
  };
  const lignes = garanties.length
    ? garanties.map((g) => `
        <tr>
          <td style="text-align:left;font-weight:600;">${g.libellesousgarantie || ''}</td>
          <td>${Number(g.capital) > 0 ? fcfa(g.capital) : VIDE}</td>
          <td>${franchise(g)}</td>
          <td>${fcfa(g.primeannuelle)}</td>
          <td>${fcfa(g.primenette)}</td>
        </tr>`).join('')
    : '<tr><td colspan="5">Aucune garantie enregistrée sur ce devis</td></tr>';

  return `
    ${printDocHeader({ ...quote, compagnie: q.RaisonSociale || quote.compagnie }, '')}
    <div class="titre-cp">
      <div>${String(q.LibelleCategorie || 'ASSURANCE VOYAGE').toUpperCase()}</div>
      <div>Proposition ${q.RaisonSociale || ''}</div>
    </div>
    <div class="ligne-identifiants">N° CLIENT : ${q.MobileClient || VIDE} | Id. POLICE : ${q.IdDevis || ''} | N° DEVIS : ${q.NumeroDevis || quote.numerodevis || ''}</div>
    <table class="bloc-libre">
      <tr><td style="width:22%;font-weight:700;">SOUSCRIPTEUR :</td><td style="width:28%;">${q.NomClient || VIDE}</td>
          <td style="width:22%;font-weight:700;">ADRESSE :</td><td>${q.AdresseClient || VIDE}</td></tr>
      <tr><td style="font-weight:700;">ASSURE :</td><td>${q.NomAssure || VIDE}</td>
          <td style="font-weight:700;">DATE NAISSANCE ASSURE :</td><td>${jma(naissance)}</td></tr>
      ${voyage?.Complement ? `
      <tr><td style="font-weight:700;">DESTINATION :</td><td>${voyage.Complement.LibellePaysDestination || VIDE}${voyage.LibelleZone ? ` (${voyage.LibelleZone})` : ''}</td>
          <td style="font-weight:700;">N° PASSEPORT :</td><td>${voyage.Complement.NumeroPasseport || VIDE}</td></tr>` : ''}
    </table>
    <div class="ligne-dates" style="display:flex;justify-content:space-between;">
      <span>Du : ${jma(q.DateEffet)}</span><span>au ${jma(q.DateExpiration)} à minuit</span><span>Durée : ${q.Duree ?? VIDE} Jours</span>
    </div>
    <table class="tableau-garanties">
      <tr class="ligne-labels"><td>Garantie</td><td>Capital</td><td>Franchise</td><td>Prime annuelle</td><td>Prime prorata</td></tr>
      ${lignes}
    </table>
    <table class="recap-vertical">
      <tr><td class="label">PRIME NETTE</td><td style="text-align:right;">${fcfa(q.PrimeNette)} FCFA</td></tr>
      <tr><td class="label">TAXES</td><td style="text-align:right;">${fcfa(q.TaxeEnregistrement)} FCFA</td></tr>
      <tr><td class="label">ACCESSOIRE</td><td style="text-align:right;">${fcfa(q.Accessoire)} FCFA</td></tr>
      <tr><td class="label">PRIME TTC</td><td style="text-align:right;">${fcfa(q.PrimeTtc)} FCFA</td></tr>
      <tr class="ligne-total"><td class="label">NET A PAYER</td><td style="text-align:right;">${fcfa(q.PrimeTtc)} FCFA</td></tr>
    </table>
    <div class="mention-courte">
      Cette offre n'est qu'une proposition d'assurance. Elle n'engage en rien la compagnie et a durée de validité
      d'un (1) mois à compter de sa date d'émission.
    </div>
    <div class="bloc-signature-simple">Fait à Abidjan, le <strong>${formatFrDate(q.DateEmission || quote.date_emission)}</strong>.</div>
    ${printDocFooter(false)}
  `;
};

/* =========================================================================
   TRANSPORT : bordereau de ressortie de primes facultés (modèle OREOLE « RESSORTIE DE PRIME
   FACULTES … », 29 colonnes GUCE). Impression sous forme condensée (colonnes principales,
   A4 paysage) ; l'export Excel du bordereau reprend les 29 colonnes. TOTAL GENERAL = prime
   totale diminuée de 500 F par certificat (part AFS-CI), comme le contrat généré.
   ========================================================================= */
const libelleNumeroBordereau = (debutIso) => {
  if (!debutIso) return '';
  const [, mois, jour] = debutIso.split('-').map(Number);
  return String((mois - 1) * 2 + (jour === 1 ? 1 : 2)).padStart(2, '0');
};

const buildBordereauTransport = (donnees) => {
  const certificats = donnees.Certificats || [];
  const t = donnees.Totaux || {};
  const jma = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : VIDE);
  const souscripteurs = [...new Set(certificats.map((c) => c.Souscripteur).filter(Boolean))].join(', ');
  const assureurs = [...new Set(certificats.map((c) => c.Assureur).filter(Boolean))];
  const annee = (donnees.DebutPeriode || '').slice(0, 4);
  const lignes = certificats.map((c) => `
    <tr>
      <td>${c.NumeroRequete || ''}</td>
      <td>${jma(c.DateCertificat)}</td>
      <td>${c.ReferenceCertificat || ''}</td>
      <td style="text-align:left;">${c.Assure || ''}</td>
      <td>${c.MoyenTransport || ''}</td>
      <td style="text-align:left;">${c.Voyage || ''}</td>
      <td style="text-align:left;">${c.DescriptionCommerciale || ''}</td>
      <td class="g-num">${fcfa(c.ValeurAssurance)}</td>
      <td class="g-num">${fcfa(c.PrimeNette)}</td>
      <td class="g-num">${fcfa(c.Accessoire)}</td>
      <td class="g-num">${fcfa(c.Taxe)}</td>
      <td class="g-num">${fcfa(c.PrimeTtc)}</td>
    </tr>`).join('');
  return `
    <style>@page { size: A4 landscape; margin: 0; } body { max-width: 277mm; } table.tableau-garanties td.g-num { text-align: right; white-space: nowrap; }</style>
    ${printDocEntete(assureurs.length === 1 ? assureurs[0] : '')}
    <div class="titre-cp">
      <div>BORDEREAU N°${libelleNumeroBordereau(donnees.DebutPeriode)} DE RESSORTIE DE PRIMES FACULTES ${annee}</div>
      <div style="font-size:10pt;">GUCE P/C ${souscripteurs || VIDE}</div>
    </div>
    <div class="ligne-dates" style="text-align:center;">Période du ${jma(donnees.DebutPeriode)} au ${jma(donnees.FinPeriode)}${assureurs.length ? ` — Assureur : ${assureurs.join(', ')}` : ''}</div>
    <table class="tableau-garanties">
      <tr class="ligne-labels">
        <td>N° requête</td><td>Date certificat</td><td>Réf. certificat</td><td>Assuré</td><td>Moyen de transport</td>
        <td>Voyage</td><td>Description commerciale</td><td>Valeur assurance</td><td>Prime nette</td><td>Accessoires</td><td>Taxe</td><td>Prime totale</td>
      </tr>
      ${lignes || '<tr><td colspan="12">Aucun certificat</td></tr>'}
      <tr class="ligne-total">
        <td colspan="7" style="text-align:left;">TOTAL (${t.Certificats || 0} certificats)</td>
        <td class="g-num">${fcfa(t.ValeurAssurance)}</td><td class="g-num">${fcfa(t.PrimeNette)}</td><td class="g-num">${fcfa(t.Accessoire)}</td>
        <td class="g-num">${fcfa(t.Taxe)}</td><td class="g-num">${fcfa(t.PrimeTtc)}</td>
      </tr>
    </table>
    <table class="recap-vertical" style="margin-left:auto;">
      <tr><td class="label">Prime totale</td><td style="text-align:right;">${fcfa(t.PrimeTtc)} FCFA</td></tr>
      <tr><td class="label">Part AFS-CI (500 F × ${t.Certificats || 0})</td><td style="text-align:right;">- ${fcfa(t.AccessoireClient)} FCFA</td></tr>
      <tr class="ligne-total"><td class="label">TOTAL GENERAL</td><td style="text-align:right;">${fcfa(t.TotalGeneral)} FCFA</td></tr>
    </table>
    <div class="bloc-signature-simple">Fait à Abidjan, le <strong>${formatFrDate(new Date())}</strong>.</div>
  `;
};

// filtres : { idimportation } (bordereau), { iddevis } ou { idcontrat } (contrat issu du bordereau)
export const printBordereauTransport = async (filtres) => {
  const fenetre = window.open('', '_blank');
  if (fenetre) fenetre.document.write('<p style="font-family:Arial;padding:20px;">Préparation du bordereau…</p>');
  try {
    const donnees = await transportApi.getCertificats(filtres);
    openPrintWindow(`Bordereau ${donnees.DebutPeriode || ''} ${donnees.FinPeriode || ''}`.trim(), buildBordereauTransport(donnees), fenetre);
  } catch (err) {
    console.error('Erreur bordereau Transport :', err);
    if (fenetre) {
      fenetre.document.open();
      fenetre.document.write('<p style="font-family:Arial;padding:20px;color:#b91c1c;">Impossible de charger les certificats du bordereau. Veuillez réessayer.</p>');
      fenetre.document.close();
    }
  }
};

export const estDevisTransport = (quote) => /transport|facult/i.test(String(quote?.branche || quote?.produit || ''));

export const printPropositionVoyage = async (quote) => {
  if (!quote) return;
  const fenetre = window.open('', '_blank');
  if (fenetre) fenetre.document.write('<p style="font-family:Arial;padding:20px;">Préparation de la proposition…</p>');
  try {
    const donnees = await impressionVoyageApi.get(quote.iddevis || quote.id);
    openPrintWindow(`Proposition ${quote.numerodevis || ''}`.trim(), buildPropositionVoyage(quote, donnees), fenetre);
  } catch (err) {
    console.error('Erreur proposition Voyage :', err);
    if (fenetre) {
      fenetre.document.open();
      fenetre.document.write('<p style="font-family:Arial;padding:20px;color:#b91c1c;">Impossible de charger le devis pour la proposition. Veuillez réessayer.</p>');
      fenetre.document.close();
    }
  }
};

/* =========================================================================
   ANNEXE D'UN DEVIS FLOTTE AUTO — « Liste des véhicules de la flotte »
   (gabarit URANUS AnnexeFlotteDevis : A4 paysage, primes de chaque véhicule
   par garantie, légende, réductions et décompte de prime du devis)
   ========================================================================= */

// Devis flotte automobile enregistré en base (produit 1)
export const estDevisFlotteAuto = (quote) => {
  const raw = quote?.raw || {};
  if (raw.idcontrat || !Number(quote?.iddevis || raw.iddevis) || !raw.flotte) return false;
  const p = raw.produit;
  const idProduit = Number(p && typeof p === 'object' ? (p.id_produit ?? p.IdProduit) : (raw.idproduit ?? p));
  return idProduit ? idProduit === 1 : quote.branche === 'Auto';
};

// Montants de l'annexe (comme URANUS) : entiers avec espaces ; une garantie à 0 est « Exclu »
const entierAnnexe = (v) => String(Math.round(Math.abs(Number(v) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const garantieAnnexe = (v) => (Math.round(Number(v) || 0) === 0 ? 'Exclu' : entierAnnexe(v));
const tauxAnnexe = (v) => (Math.abs(Number(v) || 0)).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Sigle du type de véhicule (« Véhicule Particulier (…) » → VP), sinon genre sans précision
const sigleVehicule = (v, d) => {
  const type = String(v.LibelleTypeVehicule || '').split('(')[0].trim();
  if (type) return type.split(/\s+/).filter((m) => m.length > 2).map((m) => m[0].toUpperCase()).join('') || type;
  const genre = String(d?.idgenrevehicule?.LibelleGenre || '').split('(')[0].trim();
  return genre || '-';
};
const energieAnnexe = (libelle) => {
  const s = String(libelle || '').trim();
  if (!s) return '-';
  return s.toLowerCase().startsWith('electri') ? 'EL' : s.charAt(0).toUpperCase();
};

// Taux commun à tous les véhicules du détail (bonus, réduction commerciale) ; « Variable » s'ils diffèrent
const tauxCommun = (details, champ) => {
  const taux = [...new Set(details.map((d) => Number(d[champ]) || 0))];
  if (taux.length > 1) return 'Variable';
  return tauxAnnexe(taux[0] || 0);
};

const ANNEXE_FLOTTE_STYLES = `
  @page { size: A4 landscape; margin: 0; }
  body { max-width: 277mm; }
  @media print { body { padding: 9mm 10mm; } }
  .af { font-family: Helvetica, Arial, sans-serif; font-size: 9pt; color: #000; }
  .af-logo { height: 40px; margin-bottom: 14px; }
  .af-badge { text-align: center; margin: 2px 0 10px; }
  .af-badge span { display: inline-block; padding: 5px 12px; border: 1px solid #000; border-radius: 6px; background: #f5f5f5; font-size: 13pt; }
  .af-ligne { display: flex; justify-content: space-between; gap: 12px; font-size: 8.5pt; margin-bottom: 4px; }
  .af-ligne > div { flex: 2; white-space: nowrap; }
  .af-ligne > div:last-child { text-align: right; }
  .af-dates { text-align: center; font-size: 8.5pt; margin: 6px 0 14px; }
  .af-dates b, .af-ligne b { font-weight: 400; margin-left: 4px; margin-right: 18px; }
  table.af-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.af-table th, table.af-table td { border: 1px solid #000; padding: 0; text-align: center; vertical-align: middle; }
  table.af-table th { background: #ededed; font-size: 7.5pt; font-weight: 400; height: 34px; }
  table.af-table thead tr { border-bottom: 2px solid #000; }
  table.af-table td { font-size: 6.8pt; height: 30px; }
  .af-double > div { padding: 2px 0; }
  .af-double > div + div { border-top: 1px solid #000; }
  tr.af-groupe td { border: none; font-size: 9.5pt; height: 28px; }
  .af-nombre { font-size: 8.5pt; margin: 6px 0 16px 6px; }
  .af-bas { display: flex; gap: 20px; align-items: flex-start; }
  .af-legende { flex: 2; font-size: 6.8pt; }
  .af-legende-titre, .af-reduction-titre { font-size: 8.5pt; text-decoration: underline; margin-bottom: 4px; }
  .af-legende div.l { display: flex; margin-bottom: 1px; }
  .af-legende div.l span:first-child { width: 28px; }
  .af-legende div.l span:nth-child(2) { margin-right: 4px; }
  .af-reduction { flex: 1.2; font-size: 7.5pt; }
  .af-reduction div.r { display: flex; justify-content: space-between; margin-bottom: 2px; }
  .af-decompte { flex: 3; border: 1px solid #000; }
  .af-decompte-titre { text-align: center; padding: 6px 0; border-bottom: 1px solid #000; font-size: 9pt; }
  table.af-recap { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.af-recap td { border-right: 1px solid #000; text-align: center; font-size: 8.5pt; }
  table.af-recap td:last-child { border-right: none; }
  table.af-recap tr:first-child td { padding: 6px 2px; border-bottom: 1px solid #000; }
  table.af-recap tr:last-child td { padding: 16px 2px; }
`;

const LEGENDE_ANNEXE_FLOTTE = [
  ['RC', 'Responsabilité civile'], ['D/R', 'Défense et recours'], ['DOM', 'Dommages tous risques'],
  ['DC', 'Dommages collisions'], ['INC', 'Incendie'], ['VAC', 'Vol des accessoires'], ['VOL', 'Vol du véhicule'],
  ['BDG', 'Bris de glace'], ['RA', 'Recours anticipé'], ['IC/SR', 'Individuelle Conducteur / Sécurité Routière'],
  ['VMA', 'Vol a main armée'],
];

// Largeurs des colonnes en unités (comme les flex d'URANUS) : 29 unités au total
const COLONNES_ANNEXE_FLOTTE = [1, 2, 2, 2, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2];

const buildAnnexeFlotte = (quote, { quittance, vehicules, details, tauxReductionFlotte }) => {
  const raw = quote.raw || {};
  const q = quittance || {};
  const t = (v) => echapperHtml(v === undefined || v === null ? '' : String(v).trim());
  const date = (v) => (v ? formatFrDate(v).replace(/\//g, '-') : '');
  const double = (haut, bas) => `<div class="af-double"><div>${haut}</div><div>${bas}</div></div>`;
  const detailDe = (v) => details.find((d) => String(d.matricule || '').trim() === String(v.Immatriculation || '').trim());

  // Lignes groupées par catégorie tarifaire, numérotées à la suite (comme URANUS)
  const groupes = [];
  vehicules.forEach((v) => {
    const libelle = String(v.LibelleTarif || v.LibelleCategorie || '').trim();
    let groupe = groupes.find((g) => g.libelle === libelle);
    if (!groupe) groupes.push(groupe = { libelle, vehicules: [] });
    groupe.vehicules.push(v);
  });
  let numero = 0;
  const lignes = groupes.map((g) => `
    ${g.libelle ? `<tr class="af-groupe"><td colspan="${COLONNES_ANNEXE_FLOTTE.length}">${t(g.libelle)}</td></tr>` : ''}
    ${g.vehicules.map((v) => {
      const d = detailDe(v);
      numero += 1;
      return `<tr>
        <td>${numero}</td>
        <td>${double(t(v.Immatriculation) || '-', t(sigleVehicule(v, d)))}</td>
        <td>${double(t(v.LibelleMarque) || '-', t(d?.modelevehicule) || '-')}</td>
        <td>${double(entierAnnexe(v.ValeurNeuve), entierAnnexe(v.ValeurVenale))}</td>
        <td>${double(energieAnnexe(v.LibelleEnergie), entierAnnexe(v.Puissance))}</td>
        <td>${double(entierAnnexe(v.ChargeUtile), entierAnnexe(v.NombrePlace))}</td>
        <td>${double(v.DateMec ? formatFrDate(v.DateMec) : '-', '&nbsp;')}</td>
        <td>${garantieAnnexe(v.Rc)}</td>
        <td>${garantieAnnexe(v.Recours)}</td>
        <td>${garantieAnnexe(v.Dommages)}</td>
        <td>${garantieAnnexe(v.Collision)}</td>
        <td>${garantieAnnexe(v.Incendie)}</td>
        <td>${garantieAnnexe(v.VolAccessoires)}</td>
        <td>${garantieAnnexe(v.VolSimple)}</td>
        <td>${garantieAnnexe(v.BrisDeGlaces)}</td>
        <td>${garantieAnnexe(v.VolMainsArmees)}</td>
        <td>${garantieAnnexe(v.RecoursAnticipe)}</td>
        <td>${garantieAnnexe(v.PrimeHorsTaxes)}</td>
        <td>${garantieAnnexe(v.Reduction)}</td>
        <td>${double(garantieAnnexe(v.SecuriteRoutiere), garantieAnnexe(v.IndividuelleChauffeur))}</td>
        <td>${garantieAnnexe(v.PrimeNette)}</td>
      </tr>`;
    }).join('')}`).join('');

  // Décompte : quittance de la proposition, sinon montants du devis (prime nette hors FGA)
  const quittanceVide = Object.keys(q).length === 0;
  const primeNette = quittanceVide ? Number(raw.primenette || 0) - Number(raw.fga || 0) : q.PrimeNetteHorsFga;
  const decompte = [
    ['PRIME NETTE', primeNette],
    ['CP', quittanceVide ? raw.accessoire : q.Accessoire],
    ['TAXES', quittanceVide ? raw.taxe : q.TaxeEnregistrement],
    ['FGA', quittanceVide ? raw.fga : q.Fga],
    ['CEDEAO', quittanceVide ? raw.cedeao : q.Cedeao],
    ['PRIME TTC', quittanceVide ? raw.primettc : q.PrimeTtc],
  ];
  const unite = 100 / COLONNES_ANNEXE_FLOTTE.reduce((a, b) => a + b, 0);

  return `
    <style>${ANNEXE_FLOTTE_STYLES}</style>
    <div class="af">
      <img src="/assets/print/logo-oreole-entete.png" alt="OREOLE Assurances" class="af-logo" />
      <div class="af-badge"><span>Liste des véhicules de la flotte</span></div>
      <div class="af-ligne">
        <div>Souscripteur :<b>${t(quittanceVide ? quote.client_nom : q.NomClient)}</b></div>
        <div>Assuré :<b>${t(quittanceVide ? (raw.nomassure || quote.client_nom) : q.NomAssure)}</b></div>
        <div>Compagnie :<b>${t(quittanceVide ? quote.compagnie : q.RaisonSociale)}</b></div>
        <div>Id. Devis :<b>${t(q.NumeroDevis || quote.numerodevis)}</b>N° Avt :<b style="margin-right:0">${t(q.NumeroAvenant || raw.numeroavenant)}</b></div>
      </div>
      <div class="af-dates">Effet :<b>${date(q.DateEffet || raw.dateeffet)}</b>Expiration :<b>${date(q.DateExpiration || raw.dateexpiration)}</b></div>
      <table class="af-table">
        <colgroup>${COLONNES_ANNEXE_FLOTTE.map((n) => `<col style="width:${(n * unite).toFixed(3)}%">`).join('')}</colgroup>
        <thead><tr>
          <th>N°</th>
          <th>${double('N° Immat.', 'Genre')}</th>
          <th>${double('Marque', 'Type')}</th>
          <th>${double('Val. neuf', 'Val. vén.')}</th>
          <th>${double('Ener.', 'Puis.')}</th>
          <th>${double('CU', 'NP')}</th>
          <th>${double('M.E.C.', 'D. entrée')}</th>
          <th>RC</th><th>D/R</th><th>DOM</th><th>DC</th><th>INC</th><th>VAC</th><th>VOL</th><th>BDG</th><th>VMA</th><th>RA</th>
          <th>PRIME HT</th>
          <th>REDUCT</th>
          <th>${double('SR', 'IC')}</th>
          <th>P. NETTE</th>
        </tr></thead>
        <tbody>${lignes || `<tr><td colspan="${COLONNES_ANNEXE_FLOTTE.length}">Aucun véhicule enregistré pour ce devis.</td></tr>`}</tbody>
      </table>
      <div class="af-nombre">Nombre de véhicules : ${vehicules.length}</div>
      <div class="af-bas">
        <div class="af-legende">
          <div class="af-legende-titre">Légende</div>
          ${LEGENDE_ANNEXE_FLOTTE.map(([code, libelle]) => `<div class="l"><span>${code}</span><span>:</span><span>${libelle}</span></div>`).join('')}
        </div>
        <div class="af-reduction">
          <div class="af-reduction-titre">Réduction (%) :</div>
          <div class="r"><span>BNS :</span><span>${tauxCommun(details, 'bns')}</span></div>
          <div class="r"><span>Flotte :</span><span>${tauxAnnexe(tauxReductionFlotte)}</span></div>
          <div class="r"><span>Commerciale :</span><span>${tauxCommun(details, 'taux_reduction')}</span></div>
          <div class="r"><span>Permis :</span><span>${tauxAnnexe(0)}</span></div>
          <div class="r"><span>SP :</span><span>${tauxAnnexe(0)}</span></div>
        </div>
        <div class="af-decompte">
          <div class="af-decompte-titre">Décompte de prime</div>
          <table class="af-recap">
            <tr>${decompte.map(([libelle]) => `<td>${libelle}</td>`).join('')}</tr>
            <tr>${decompte.map(([, valeur]) => `<td>${entierAnnexe(valeur)}</td>`).join('')}</tr>
          </table>
        </div>
      </div>
    </div>`;
};

// Bouton « Imprimer Annexe » d'un devis flotte : la fenêtre s'ouvre dès le clic (sinon bloquée
// pendant les appels API), puis reçoit l'annexe
export const printAnnexeFlotte = async (quote) => {
  const iddevis = Number(quote?.iddevis || quote?.raw?.iddevis);
  if (!iddevis) return;
  const fenetre = window.open('', '_blank');
  if (fenetre) fenetre.document.write('<p style="font-family:Arial;padding:20px;">Préparation de l\'annexe…</p>');
  try {
    const donnees = await annexeFlotteApi.get(iddevis);
    openPrintWindow(`Annexe ${quote.numerodevis || iddevis}`, buildAnnexeFlotte(quote, donnees), fenetre);
  } catch (err) {
    console.error('Erreur annexe flotte :', err);
    if (fenetre) {
      fenetre.document.open();
      fenetre.document.write('<p style="font-family:Arial;padding:20px;color:#b91c1c;">Impossible de charger les véhicules du devis pour l\'annexe. Veuillez réessayer.</p>');
      fenetre.document.close();
    }
  }
};

// --- REÇU D'ENCAISSEMENT (Caisse & Encaissement des Primes) ---
// Gabarit URANUS « Quittance de règlement des primes d'assurance », en deux exemplaires sur la
// page. Données de fn_info_encaissement (/api/infoencaissement/<iddetailencaissement>). URANUS
// écrivait « 1 Avt 0 ()/NSIA CI » en dur : ici, le vrai avenant et la vraie compagnie.
const RECU_ENCAISSEMENT_STYLES = `
  .rq { font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #000; }
  .rq-separateur { border-top: 1px dashed #000; margin: 9mm 0; }
  .rq-entete { display: flex; justify-content: space-between; align-items: flex-start; }
  .rq-logo { height: 42px; }
  .rq-cabinet { text-align: right; font-weight: 700; line-height: 1.6; }
  .rq-titre { border: 1px solid #000; text-align: center; padding: 6px; margin: 10px 0 6px; font-size: 9pt; }
  .rq-recu { margin: 4px 0 8px; }
  .rq-grille { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .rq-grille td { padding: 3px 4px; vertical-align: top; }
  .rq-bas { display: flex; margin-top: 8px; }
  .rq-caisse { width: 50%; text-align: center; padding-top: 4px; }
  .rq-rappel { width: 50%; border: 1px solid #000; padding: 3px 6px; }
  .rq-rappel-titre { text-align: center; margin-bottom: 2px; }
  .rq-rappel div { padding: 1px 0; }
`;

const buildRecuEncaissement = (info) => {
  const t = (v) => echapperHtml(v === undefined || v === null ? '' : String(v).trim());
  const montant = (v) => entierAnnexe(v);
  const cheque = info.NumeroCheque ? ` n° ${t(info.NumeroCheque)}${info.LibelleBanque ? ` (${t(info.LibelleBanque)})` : ''}` : '';
  const exemplaire = `
    <div class="rq-entete">
      <img src="/assets/print/logo-oreole-entete.png" alt="OREOLE Assurances" class="rq-logo" />
      <div class="rq-cabinet">OREOLE ASSURANCES<br />Tél : 27 22 487 218 / Fax : 27 22 487 349</div>
    </div>
    <div class="rq-titre">Quittance de règlement des primes d'assurance</div>
    <div class="rq-recu">Reçu N° : ${t(info.NumeroRecu)}</div>
    <table class="rq-grille">
      <colgroup><col style="width:17%"><col style="width:33%"><col style="width:17%"><col style="width:33%"></colgroup>
      <tr><td>Versement en cours</td><td>${montant(info.MontantEncaissement)}</td><td>Date de paiement</td><td>${formatFrDate(info.DateEncaissement)}</td></tr>
      <tr><td>Assuré(e)</td><td>${t([info.PrenomsAssure, info.NomAssure].filter(Boolean).join(' '))}</td><td>Tel.</td><td>${t(info.TelephoneAssure)}</td></tr>
      <tr>
        <td>Police(s) réglée(s)</td><td>Police Assurance ${t(info.LibelleProduit)} N°-${t(info.NumeroPolice)}</td>
        <td>1 Avt ${t(info.NumeroAvenant)} / ${t(info.NomCompagnie)}</td>
        <td>Date effet : ${formatFrDate(info.DateEffet)} | Date expiration : ${formatFrDate(info.DateExpiration)}</td>
      </tr>
      <tr><td>Montant</td><td>${montant(info.MontantEncaissement)}</td><td>Montant (Lettre)</td><td>${t(info.MontantEncaissementEnLettres)}</td></tr>
      <tr><td>Mode de paiement</td><td>${t(info.LibelleModePaiement)}${cheque}</td><td>Ref</td><td>${t(info.Reference)}</td></tr>
    </table>
    <div class="rq-bas">
      <div class="rq-caisse">LA CAISSE</div>
      <div class="rq-rappel">
        <div class="rq-rappel-titre">RAPPEL IMPORTANT</div>
        <div>Prime totale : ${montant(info.PrimeTotale)}</div>
        <div>Versement en cours : ${montant(info.MontantEncaissement)}</div>
        <div>Versements antérieurs : ${montant(info.VersementAnterieur)}</div>
        <div>Total versement à ce jour : ${montant(info.TotalVersement)}</div>
        <div>Reste à payer : ${montant(info.Solde)}</div>
      </div>
    </div>`;
  return `
    <style>${RECU_ENCAISSEMENT_STYLES}</style>
    <div class="rq">${exemplaire}<div class="rq-separateur"></div>${exemplaire}</div>`;
};

// Reçu d'une ligne d'encaissement. La fenêtre est ouverte par l'appelant au moment du clic
// (ouverte après les appels API, elle serait bloquée par le navigateur).
export const printRecuEncaissement = async (iddetailencaissement, fenetre = null) => {
  const erreur = (message) => {
    if (!fenetre) return;
    fenetre.document.open();
    fenetre.document.write(`<p style="font-family:Arial;padding:20px;color:#b91c1c;">${message}</p>`);
    fenetre.document.close();
  };
  if (!iddetailencaissement) {
    erreur('Aucun règlement enregistré pour cette quittance.');
    return;
  }
  try {
    const reponse = await cashApi.getEncaissementInfo(iddetailencaissement);
    const info = (reponse?.data || [])[0];
    if (!info) {
      erreur('Informations du règlement introuvables.');
      return;
    }
    openPrintWindow(`Quittance ${info.NumeroRecu || ''}`.trim(), buildRecuEncaissement(info), fenetre);
  } catch (err) {
    console.error('Erreur quittance d\'encaissement :', err);
    erreur('Impossible de charger le règlement pour la quittance. Veuillez réessayer.');
  }
};

// --- GABARIT B : IA / VOYAGE / TRANSPORT / SANTE (facture simple à blocs) ---
const buildSimpleFacture = (quote) => {
  const branche = String(quote.branche || quote.produit || '').toLowerCase();
  const isIa = branche.includes('ia') || branche.includes('accident');
  const isVoyage = branche.includes('voyag');
  const numero = quote.numero_police_compagnie || quote.numerodevis;
  const ayantsDroit = quote.raw?.ayants_droit || quote.details?.ayantsDroit || [];

  return `
    ${printDocHeader(quote, `FACTURE N° ${numero}`)}

    <div class="bloc-titre">SOUSCRIPTEUR</div>
    <table class="bloc-cadre">
      <tr><td class="label">Nom</td><td>${(quote.souscripteur || quote.client_nom || '').toUpperCase()}</td></tr>
      <tr><td class="label">Adresse</td><td>${quote.raw?.adresse || '—'}</td></tr>
    </table>

    ${isIa ? `
      <div class="bloc-titre">ASSURES, AYANTS DROIT</div>
      <table class="bloc-cadre bloc-tableau">
        <tr class="ligne-labels"><td>Nom et prénoms</td><td>Qualité</td><td>Part</td></tr>
        ${ayantsDroit.length > 0
          ? ayantsDroit.map((a) => `<tr><td>${a.nom || a.nom_prenoms || '—'}</td><td>${a.qualite || '—'}</td><td>${a.part ? `${a.part}%` : '—'}</td></tr>`).join('')
          : '<tr><td colspan="3" style="text-align:center;color:#94a3b8;">Aucun ayant droit enregistré</td></tr>'}
      </table>
    ` : `
      <div class="bloc-titre">ASSURE</div>
      <table class="bloc-cadre">
        <tr><td class="label">Nom</td><td>${(quote.nomassure || quote.client_nom || '').toUpperCase()}</td></tr>
        <tr><td class="label">Adresse</td><td>${quote.raw?.adresse_assure || '—'}</td></tr>
      </table>
    `}

    <div class="bloc-titre">Référence police et périodicité</div>
    <table class="bloc-cadre">
      <tr><td class="label">Au titre de la police</td><td>${(quote.produit || '').toUpperCase()}</td></tr>
      <tr><td class="label">Numéro Devis</td><td>${numero}</td></tr>
      ${isVoyage ? `<tr><td class="label">Numéro Attestation</td><td>${quote.raw?.numero_attestation || '—'}</td></tr>` : ''}
      <tr><td class="label">Pour la période allant du</td><td>${formatFrDate(quote.date_effet)} Au ${formatFrDate(quote.date_expiration)}</td></tr>
    </table>

    <div class="bloc-titre">Détail de la facture</div>
    <table class="bloc-cadre">
      <tr><td class="label">Prime Nette</td><td>${money(quote.prime_nette)}</td></tr>
      <tr><td class="label">Accessoire</td><td>${money(quote.accessoires)}</td></tr>
      <tr><td class="label">Taxe d'enregistrement</td><td>${money(quote.taxes)}</td></tr>
      <tr class="ligne-total"><td class="label">PRIME TOTALE A PAYER</td><td><strong>${money(quote.prime_totale)}</strong></td></tr>
    </table>

    <div class="mention-cima">
      Conformément à l'Article 13 du Code des Assurances CIMA, la prime doit être payée intégralement et d'avance.
      À défaut de paiement dans les délais réglementaires (60 jours pour les risques autres que Maladie, Automobile
      et Transport de Marchandises), la garantie peut être suspendue puis le contrat résilié de plein droit.
      Tout chèque impayé entraîne la nullité du paiement et un délai de régularisation de 8 jours.
    </div>

    <div class="bloc-signature-simple">
      <div>Fait à Abidjan, le <strong>${formatFrDate(new Date())}</strong>.</div>
      <div class="signatures-deux-colonnes">
        <div>LE SOUSCRIPTEUR</div>
        <div>LA COMPAGNIE</div>
      </div>
    </div>

    ${printDocFooter(false)}
  `;
};

// --- GABARIT C : MRH (proposition d'assurance habitation) ---
export const estDevisMrh = (quote) => /mrh|habit/i.test(String(quote?.branche || quote?.produit || ''));

// Lignes du tableau des garanties, comme URANUS : garanties souscrites cumulées sur les maisons
// (garantiesouscritedevis), capitaux et franchises du résumé financier (saisis par maison : une
// valeur différente d'une maison à l'autre est listée « a / b »)
const lignesGarantiesMrh = (garanties, resume) => {
  const parGarantie = {};
  (resume?.sous_garanties_acquises || []).forEach((g) => {
    (parGarantie[g.id_sous_garantie] = parGarantie[g.id_sous_garantie] || []).push(g);
  });
  const valeurs = (liste, champ) => {
    const vues = [...new Set(liste.map((g) => g[champ]).filter((v) => v != null && Number(v) !== 0).map(Number))];
    return vues.length ? vues : null;
  };
  return (garanties || []).map((g) => {
    const rf = parGarantie[g.idsousgarantie] || [];
    const capitaux = valeurs(rf, 'capital') || (Number(g.capital) ? [Number(g.capital)] : null);
    return {
      libelle: g.libellesousgarantie,
      capitaux,
      franchise: valeurs(rf, 'franchise') || (g.textefranchise && g.textefranchise !== 'NEANT' ? g.textefranchise : null),
      min_franchise: valeurs(rf, 'minfranchise'),
      max_franchise: valeurs(rf, 'maxfranchise'),
      taux_franchise: valeurs(rf, 'tauxfranchise'),
      prime_annuelle: Number(g.primeannuelle) || 0,
      prime_nette: Number(g.primenette) || 0,
    };
  });
};

const buildMrhFacture = (quote) => {
  const numero = quote.numero_police_compagnie || quote.numerodevis;
  const garanties = quote.raw?.garanties || quote.details?.garanties || [];
  // Montant, liste de montants (un par maison) ou texte de la base
  const montants = (v) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
    if (Array.isArray(v)) return v.map((x) => money(x)).join(' / ');
    return typeof v === 'number' || /^[\d.]+$/.test(String(v)) ? (Number(v) ? money(v) : '—') : String(v);
  };
  const dureeJours = quote.raw?.duree_terme_jours
    ?? (quote.date_effet && quote.date_expiration
      ? Math.round((new Date(quote.date_expiration) - new Date(quote.date_effet)) / 86400000)
      : null);

  return `
    ${printDocHeader(quote, '')}
    <div class="titre-mrh">
      <div>Assurance MULTIRISQUES HABITATION</div>
      <div>Proposition ${(quote.compagnie || 'NSIA CI')}</div>
    </div>

    <div class="ligne-identifiants">
      N° CLIENT : ${quote.client_id || '—'} &nbsp;|&nbsp; Id. POLICE : ${quote.iddevis} &nbsp;|&nbsp; N° DEVIS : ${numero}
    </div>

    <table class="bloc-libre">
      <tr>
        <td><strong>SOUSCRIPTEUR:</strong> ${(quote.souscripteur || quote.client_nom || '').toUpperCase()}</td>
        <td><strong>ADRESSE:</strong> ${quote.raw?.adresse || '—'}</td>
      </tr>
      <tr>
        <td><strong>ASSURE:</strong> ${(quote.nomassure || quote.client_nom || '').toUpperCase()}</td>
        <td><strong>DATE NAISSANCE:</strong> ${quote.raw?.date_naissance_assure ? formatFrDate(quote.raw.date_naissance_assure) : '—'}</td>
      </tr>
    </table>

    <div class="ligne-dates">
      Du: ${formatFrDate(quote.date_effet)} &nbsp;&nbsp; au ${formatFrDate(quote.date_expiration)} à minuit &nbsp;&nbsp; Durée: ${dureeJours ?? '—'} Jours
    </div>

    <table class="tableau-garanties">
      <tr class="ligne-labels">
        <td>Garantie</td><td>Capitaux</td><td>Franchise</td><td>Min Franchise</td><td>Max Franchise</td><td>Taux Frch (%)</td><td>Prime Annuelle</td><td>Prime Nette</td>
      </tr>
      ${garanties.length > 0
        ? garanties.map((g) => `
          <tr>
            <td>${g.libelle || g.nom || '—'}</td>
            <td>${montants(g.capitaux || g.capital)}</td>
            <td>${montants(g.franchise)}</td>
            <td>${montants(g.min_franchise)}</td>
            <td>${montants(g.max_franchise)}</td>
            <td>${Array.isArray(g.taux_franchise) ? g.taux_franchise.join(' / ') : (g.taux_franchise ?? '—')}</td>
            <td>${g.prime_annuelle ? money(g.prime_annuelle) : '—'}</td>
            <td>${g.prime_nette ? money(g.prime_nette) : '—'}</td>
          </tr>`).join('')
        : '<tr><td colspan="8" style="text-align:center;color:#94a3b8;">Aucune garantie enregistrée pour ce devis</td></tr>'}
    </table>

    <table class="recap-vertical">
      <tr><td class="label">PRIME NETTE</td><td>: ${money(quote.prime_nette)} FCFA</td></tr>
      <tr><td class="label">TAXES</td><td>: ${money(quote.taxes)} FCFA</td></tr>
      <tr><td class="label">ACCESSOIRE</td><td>: ${money(quote.accessoires)} FCFA</td></tr>
      <tr class="ligne-total"><td class="label">PRIME TTC</td><td>: ${money(quote.prime_totale)} FCFA</td></tr>
      <tr class="ligne-total"><td class="label">NET A PAYER</td><td>: ${money(quote.prime_totale)} FCFA</td></tr>
    </table>

    <div class="mention-courte">
      Cette offre n'est qu'une proposition d'assurance. Elle n'engage en rien la compagnie et a une durée de validité
      d'un (1) mois à compter de sa date d'émission.
    </div>

    ${printDocFooter(false)}
  `;
};

const PRINT_STYLES = `
  /* Marge d'impression à 0 : le navigateur n'a plus de place pour ses en-têtes/pieds de page
     (titre, date, URL « about:blank ») ; la marge réelle est portée par le body à l'impression */
  @page { size: A4 portrait; margin: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #0f172a;
    font-size: 9.5pt;
    line-height: 1.4;
    margin: 0 auto;
    padding: 10px;
    /* Aperçu à l'écran calé sur la largeur réelle d'une page A4 (moins les marges) :
       sans ça, la fenêtre d'impression affiche les tableaux étirés sur toute la largeur
       du navigateur, bien plus grands qu'à l'impression réelle. */
    max-width: 182mm;
  }
  .facture-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .header-logo-oreole { height: 46px; }
  .header-logo-compagnie { height: 40px; }
  .header-compagnie-text { font-weight: 800; font-size: 12pt; }
  .facture-title { text-align: center; font-weight: 800; font-size: 12pt; text-transform: uppercase; margin-bottom: 4px; }
  .sous-titre { font-weight: 700; margin-bottom: 10px; }
  .titre-mrh { text-align: center; font-size: 13pt; margin-bottom: 10px; }
  table.cadre-unique { width: 100%; border-collapse: collapse; border: 1.5px solid #0f172a; margin-bottom: 12px; }
  table.cadre-unique td { border: 1px solid #64748b; padding: 4px 6px; font-size: 8.3pt; }
  .ligne-compagnie { font-size: 8.8pt; }
  .entete-bloc { font-weight: 700; background: #f1f5f9; }
  .ligne-labels td { font-weight: 600; text-align: center; background: #f8fafc; font-size: 7.6pt; text-transform: uppercase; }
  .ligne-valeurs td { text-align: center; }
  .texte-politesse { font-size: 8.8pt; margin: 4px 0; }
  .bloc-signature-droite { text-align: right; margin-top: 20px; font-size: 9.5pt; }
  .bloc-titre { font-weight: 700; background: #eef2ff; border: 1px solid #c7d2fe; padding: 4px 8px; margin-top: 12px; font-size: 9pt; }
  table.bloc-cadre { width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; margin-bottom: 4px; }
  table.bloc-cadre td { border-bottom: 1px solid #e2e8f0; padding: 3px 6px; font-size: 8.3pt; }
  table.bloc-cadre td.label { font-weight: 600; color: #475569; width: 190px; }
  table.bloc-tableau td { text-align: center; }
  .ligne-total td { font-weight: 800; border-top: 2px solid #0f172a !important; }
  .mention-cima { border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 7.6pt; text-align: justify; color: #334155; margin: 14px 0; background: #f8fafc; }
  .mention-courte { font-size: 8.5pt; font-style: italic; color: #475569; margin-top: 14px; }
  .bloc-signature-simple { margin-top: 20px; font-size: 9.5pt; text-align: right; }
  .signatures-deux-colonnes { display: flex; justify-content: space-between; margin-top: 30px; font-weight: 700; text-align: left; }
  .ligne-identifiants { margin-bottom: 8px; font-size: 9pt; }
  table.bloc-libre { width: 100%; margin-bottom: 8px; font-size: 9pt; }
  table.bloc-libre td { padding: 3px 4px; vertical-align: top; }
  .ligne-dates { font-size: 9pt; margin-bottom: 10px; font-weight: 600; }
  table.tableau-garanties { width: 100%; border-collapse: collapse; border: 1px solid #64748b; margin-bottom: 14px; }
  table.tableau-garanties td { border: 1px solid #cbd5e1; padding: 3px 5px; font-size: 7.4pt; text-align: center; }
  table.recap-vertical { border: 1px solid #64748b; padding: 3px; font-size: 8.8pt; }
  table.recap-vertical td { padding: 3px 8px; }
  table.recap-vertical td.label { font-weight: 700; }
  .facture-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 24px; }
  .barcode-block img { height: 46px; }
  .barcode-ref { font-size: 7.5pt; color: #475569; margin-top: 2px; }
  .footer-logo-oreole { height: 22px; opacity: 0.85; }
  .titre-cp { text-align: center; font-weight: 800; font-size: 12pt; text-transform: uppercase; margin-bottom: 10px; line-height: 1.5; }
  .cp-section-bar { background: #eef2ff; border: 1px solid #c7d2fe; border-bottom: none; color: #3730a3; font-weight: 700; font-size: 7.6pt; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 8px; }
  .cp-section-bar + table { margin-top: 0; }
  .cp-courtier-contact { font-size: 6.8pt; color: #64748b; margin-top: 4px; line-height: 1.5; }
  table.cp-info td.label { font-weight: 600; color: #475569; background: #f8fafc; white-space: nowrap; }
  table.cp-garanties td { font-size: 7.5pt; }
  table.cp-recap { width: 290px; margin-top: 4px; }
  .cp-entete { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .cp-entete-logos { flex: 1; }
  .cp-deux-blocs { display: flex; gap: 10px; align-items: stretch; }
  .cp-deux-blocs table { flex: 1; margin-bottom: 8px; }
  table.cp-bloc-client td.label, table.cp-bloc-police td.label { width: 78px; }
  table.cp-garanties td.g-lib { text-align: left; }
  table.cp-garanties td.g-num { text-align: right; white-space: nowrap; }
  table.cp-garanties tr.ligne-total td { background: #f1f5f9; }
  .cp-securite { font-size: 9pt; margin: 4px 0; }
  .cp-bas { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-top: 10px; }
  .cp-mentions { flex: 1; font-size: 9pt; }
  .cp-visa { color: #475569; margin-top: 6px; }
  table.cp-recap td.label { font-weight: 600; }
  .cp-colonne { flex: 1; display: flex; flex-direction: column; }
  .cp-colonne table.cadre-unique { flex: none; margin-bottom: 8px; }
  table.cp-bloc td.label { width: 96px; font-weight: 600; color: #475569; background: #f8fafc; white-space: nowrap; }
  table.cp-recap td.g-num { text-align: right; white-space: nowrap; }
  /* Conditions Particulières Auto : mise en page des CP NSIA (cadres arrondis, filet bleu à
     gauche, pied de page doré). La page occupe toute la hauteur A4 pour que le pied reste en bas. */
  .cpn { font-size: 8.5pt; color: #111; display: flex; flex-direction: column; min-height: 256mm; }
  .cpn-nsia { border-left: 3px solid #1d4f91; padding-left: 12px; }
  .cpn-haut { min-height: 38px; }
  .cpn-logo { height: 40px; display: block; }
  .cpn-compagnie { font-weight: 800; font-size: 12pt; }
  .cpn-titre { text-align: center; font-weight: 700; font-size: 13pt; margin: -4px 0 4px; }
  .cpn-cadre { border: 1px solid #444; border-radius: 9px; }
  .cpn-entete { display: flex; gap: 6px; margin-bottom: 4px; }
  .cpn-entete .cpn-cadre { padding: 4px 10px; }
  .cpn-client { flex: 0.95; }
  .cpn-police { flex: 1.05; }
  .cpn-entete table { width: 100%; border-collapse: collapse; }
  .cpn-entete td { padding: 1px 4px 1px 0; vertical-align: top; }
  .cpn-entete td.l { white-space: nowrap; padding-right: 10px; width: 1%; }
  .cpn-entete tr.cpn-saut td { height: 7px; }
  .cpn-bandeau { text-align: center; font-weight: 700; font-size: 11pt; padding: 2px; margin-bottom: 2px; }
  .cpn-vehicule { padding: 3px 10px; margin-bottom: 5px; }
  .cpn-rangee { display: flex; justify-content: space-between; gap: 10px; padding: 1px 0; }
  .cpn-paire .l { margin-right: 8px; }
  .cpn-garanties { border-radius: 9px 9px 0 0; border-bottom: none; }
  .cpn-offre { display: flex; justify-content: space-between; padding: 3px 10px 2px; }
  .cpn-offre .cpn-paire:last-child { margin-right: 60px; }
  .cpn-garanties table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .cpn-garanties td { padding: 5px 4px; vertical-align: top; text-align: left; word-wrap: break-word; font-size: 8pt; line-height: 1.2; }
  /* Offres à nombreuses garanties : lignes resserrées pour tenir sur une page */
  .cpn-garanties.cpn-dense td { padding: 0 4px; font-size: 7.5pt; line-height: 1.15; }
  .cpn-garanties td:nth-child(n+3):not(:nth-child(4)) { white-space: nowrap; }
  .cpn-garanties tr.entete td { border-top: 1px solid #444; border-bottom: 1px solid #444; border-right: 1px solid #444; line-height: 1.1; vertical-align: middle; padding: 2px 4px; white-space: nowrap; }
  .cpn-garanties tr.entete td:last-child { border-right: none; }
  .cpn-garanties tr.entete + tr td { padding-top: 4px; }
  .cpn-garanties tr:nth-last-child(2):not(.entete) td { padding-bottom: 3px; }
  .cpn-garanties td:nth-child(1), .cpn-garanties td:nth-child(2) { border-right: 1px solid #444; }
  .cpn-garanties tr.total td { border-top: 1px solid #444; border-bottom: 1px solid #444; border-right: none; padding-top: 3px; padding-bottom: 3px; }
  .cpn-garanties tr.total td:first-child { border-left: 1px solid #444; }
  .cpn-capitaux { font-weight: 700; font-size: 9pt; margin-top: 4px; }
  .cpn-bas { display: flex; align-items: flex-start; gap: 18px; margin-top: 4px; }
  .cpn-mentions { flex: 1; font-size: 11pt; line-height: 1.3; padding-top: 8px; }
  .cpn-mentions p { margin: 0 0 8px; }
  .cpn-visa { font-size: 10pt; }
  .cpn-recap { width: 37%; border: 1px solid #444; }
  .cpn-recap table { width: 100%; border-collapse: collapse; }
  .cpn-recap td { padding: 1px 8px; text-align: right; font-size: 9pt; }
  .cpn-recap td + td { width: 34%; }
  .cpn-recap table:first-child td { padding-top: 2px; }
  .cpn-recap .cpn-net { border-top: 1px solid #444; margin-top: 4px; }
  .cpn-recap .cpn-net td { font-weight: 700; font-size: 9.5pt; padding: 6px 8px; }
  .cpn-recap .cpn-net td:first-child { text-align: center; }
  /* Récapitulatif et signatures restent ensemble (jamais coupés entre deux pages) */
  .cpn-fin { break-inside: avoid; }
  .cpn-signatures { display: flex; justify-content: space-between; align-items: flex-start; font-weight: 700; font-style: italic; font-size: 10pt; margin-top: 4px; min-height: 56px; }
  .cpn-sig-assure { margin-top: 26px; padding-left: 50px; }
  .cpn-sig-compagnie { padding-right: 10px; }
  .cpn-pied { margin-top: auto; padding-top: 4px; break-inside: avoid; }
  .cpn-pied-texte { font-size: 6pt; font-weight: 700; line-height: 1.25; padding-left: 70px; }
  .cpn-pied-ligne { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
  .cpn-pied-ligne span { flex: 1; border-top: 3px solid #b8a24a; }
  .cpn-pied-ligne img { height: 18px; }
  .cpn-pied-depuis { text-align: right; font-size: 6pt; color: #666; margin-top: -2px; }
  /* IA (Individuelle Accidents) : proposition / CP / facture, modèles URANUS */
  .ia, .iaf { font-family: 'Arial Narrow', Arial, Helvetica, sans-serif; font-size: 10pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ia-logo { width: 150px; display: block; margin-bottom: 10px; }
  .ia-titre { text-align: center; font-weight: 700; font-size: 13pt; margin: 6px 0 14px; }
  .ia-refs { display: flex; gap: 6px; margin-top: 8px; }
  .ia-boite { flex: 1; border: 1px solid #000; border-radius: 12px; padding-bottom: 6px; }
  .ia-boite-titre { font-weight: 700; font-size: 11pt; text-align: center; border-bottom: 0.8px solid #000; padding: 8px 0; }
  table.ia-lignes { width: 100%; border-collapse: collapse; }
  table.ia-lignes td { font-size: 9pt; padding: 4px; vertical-align: top; }
  table.ia-lignes td.l { font-weight: 700; width: 35%; }
  .ia-ecart { display: inline-block; width: 36px; }
  .ia-proposition { margin-top: 18px; border: 1.2px solid #000; border-radius: 10px; padding: 12px 20px; }
  .ia-proposition-titre { font-weight: 700; font-size: 12pt; text-align: center; margin-bottom: 4px; }
  .ia-proposition p { font-size: 11pt; line-height: 1.4; margin: 8px 0 0; }
  .ia-cp-titre { margin-top: 14px; border: 1px solid #000; border-radius: 8px; text-align: center; font-weight: 700; padding: 5px; }
  .ia-rubrique { font-weight: 700; font-size: 9.5pt; text-align: center; border-bottom: 0.8px solid #000; padding: 6px 0; }
  .ia-separateur { border-top: 1px dashed #64748b; margin: 2px 6px; }
  table.ia-beneficiaires { width: 100%; border-collapse: collapse; }
  table.ia-beneficiaires td { font-size: 9pt; padding: 3px 6px; }
  table.ia-beneficiaires tr.entete td { font-weight: 700; border-bottom: 1px solid #000; }
  table.ia-beneficiaires td.n { text-align: right; }
  .ia-garanties-titre { margin-top: 18px; border: 1px solid #000; border-bottom: none; border-radius: 8px 8px 0 0; text-align: center; font-weight: 700; padding: 4px; }
  table.ia-garanties { width: 100%; border-collapse: collapse; border: 1px solid #000; }
  table.ia-garanties td { border: 1px solid #000; font-size: 8pt; padding: 4px 3px; text-align: center; }
  table.ia-garanties tr.entete td { font-weight: 700; }
  table.ia-garanties td.g { text-align: left; }
  table.ia-garanties td.n { text-align: right; }
  .ia-decompte { margin-top: 26px; font-size: 10pt; }
  .ia-decompte p { margin: 0 0 12px; line-height: 1.4; }
  table.ia-montants { margin: 18px 0 12px 90px; width: 55%; border-collapse: collapse; }
  table.ia-montants td { font-size: 10pt; padding: 2px 0; }
  table.ia-montants td:first-child { font-weight: 700; }
  table.ia-montants td + td { text-align: right; }
  .ia-fait { text-align: center; font-weight: 700; font-size: 9.5pt; margin: 24px 0 26px; }
  .ia-signatures { display: flex; justify-content: space-between; font-weight: 700; font-size: 9.5pt; }
  .iaf-rubrique { display: inline-block; min-width: 200px; margin-top: 18px; padding: 4px; border: 1px solid #000; border-radius: 4px; color: #204DA0; font-weight: 700; font-size: 9pt; }
  .iaf-ligne { display: flex; gap: 0; margin-top: 4px; }
  .iaf-l { width: 30%; border: 1px solid #000; border-radius: 4px; padding: 4px; font-size: 9pt; font-weight: 700; }
  .iaf-v { width: 60%; border: 1px solid #000; border-radius: 4px; padding: 4px; font-size: 10pt; }
  table.iaf-assures { width: 100%; border-collapse: collapse; border: 1px solid #000; margin-top: 8px; }
  table.iaf-assures td { font-size: 7pt; text-align: center; padding: 2px 3px; border-bottom: 1px solid #000; border-right: 1px solid #000; height: 12px; }
  table.iaf-assures tr.iaf-entete td, table.iaf-assures tr.iaf-ad td { background: #D8D8D8; font-weight: 700; }
  table.iaf-assures tr.iaf-ad td:first-child { background: #fff; }
  .iaf-detail { margin-top: 4px; border: 1px solid #000; border-radius: 4px; padding: 4px; font-size: 9pt; font-weight: 700; line-height: 1.8; }
  .iaf-cima { margin: 14px 0 0 60px; border: 1px solid #000; padding: 4px; font-size: 9pt; text-align: justify; break-inside: avoid; }
  .iaf-fait { text-align: right; font-size: 10pt; margin-top: 10px; }
  .iaf-signatures { display: flex; justify-content: space-between; margin: 45px 60px 0; font-weight: 700; font-size: 9pt; text-decoration: underline; }
  .iaa-corps { margin: 12px 36px 0; }
  .iaa-bandeau { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #74747b; border-radius: 3px; }
  .iaa-bandeau-titre { font-size: 11pt; font-weight: 700; color: #fff; text-transform: uppercase; }
  .iaa-badge { padding: 3px 8px; background: #fff; border-radius: 12px; font-size: 8pt; font-weight: 700; color: #74747b; }
  .iaa-carte { margin: 4px 0 6px; padding: 10px; border: 1px solid #000; border-radius: 3px; break-inside: avoid; }
  .iaa-carte-entete { display: flex; justify-content: space-between; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #000; }
  .iaa-gauche { width: 60%; }
  .iaa-droite { width: 40%; text-align: right; font-size: 8pt; color: #444; }
  .iaa-nom { font-size: 13pt; font-weight: 700; color: #111; text-transform: uppercase; }
  .iaa-sous { font-size: 9pt; color: #333; }
  .iaa-capitaux { margin-top: 2px; font-size: 8pt; color: #111; text-align: center; }
  .iaa-capitaux b { font-size: 9pt; }
  .iaa-ayants { margin-top: 6px; border: 1px solid #000; border-radius: 3px; overflow: hidden; }
  .iaa-ayants-titre { background: #222; color: #fff; font-size: 8pt; font-weight: 700; text-align: center; padding: 3px 6px; }
  table.iaa-table { width: 100%; border-collapse: collapse; }
  table.iaa-table td { font-size: 8pt; padding: 2px 4px; }
  table.iaa-table tr.entete td { font-weight: 700; border-bottom: 1px solid #000; }
  table.iaa-table tr.alt td { background: #f3f3f3; }
  .iaa-vide { padding: 6px 4px; text-align: center; font-size: 8pt; color: #777; }
  .alerte-ecart { border: 2px solid #dc2626; background: #fef2f2; color: #7f1d1d; padding: 8px 12px; margin-bottom: 12px; font-size: 9pt; border-radius: 4px; }
  .facture-montants td { white-space: nowrap; }
  /* Facture proforma Auto : mise à l'échelle pour occuper la page A4 (le gabarit
     partagé est calibré pour des documents plus denses) */
  .facture-auto .facture-header { margin-bottom: 26px; }
  .facture-auto .header-logo-oreole { height: 62px; }
  .facture-auto .header-logo-compagnie { height: 54px; }
  .facture-auto .facture-title { font-size: 15pt; margin-bottom: 10px; }
  .facture-auto .sous-titre { font-size: 11.5pt; margin-bottom: 22px; }
  .facture-auto table.cadre-unique { margin-bottom: 30px; }
  .facture-auto table.cadre-unique td { font-size: 10.5pt; padding: 11px 8px; }
  .facture-auto .ligne-compagnie { font-size: 11pt !important; }
  .facture-auto .ligne-labels td { font-size: 9pt; padding: 9px 6px; }
  .facture-auto .facture-montants td { font-size: 11.5pt; padding: 14px 6px; }
  .facture-auto .texte-politesse { font-size: 10.5pt; margin: 12px 0; line-height: 1.6; }
  .facture-auto .bloc-signature-droite { font-size: 10.5pt; margin-top: 44px; }
  .facture-auto .bloc-signature-droite > div + div { margin-top: 70px !important; }
  .facture-auto .facture-footer { margin-top: 90px; }
  .facture-auto .barcode-svg { height: 56px; }
  .facture-auto .barcode-ref { font-size: 9pt; }
  .facture-auto .footer-logo-oreole { height: 30px; }
  .barcode-svg { display: block; }
  .cp-signatures { margin-top: 36px; padding: 0 20px; min-height: 90px; }
  @media print {
    .no-print { display: none !important; }
    body { max-width: none; margin: 0; padding: 14mm 16mm; }
  }
`;

const openPrintWindow = (title, bodyHtml, targetWindow = null) => {
  const docHtml = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  ${bodyHtml}
  <script>
    window.onload = function() { setTimeout(function() { window.print(); }, 400); };
  </script>
</body>
</html>
  `;

  const printWindow = targetWindow || window.open('', '_blank');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(docHtml);
    printWindow.document.close();
  }
};

/**
 * Ouvre une fenêtre d'impression dédiée pour un devis, avec la mise en page
 * fidèle aux 3 gabarits URANUS (Auto / IA-Voyage-Transport-Santé / MRH),
 * logos OREOLE + compagnie et code-barres (Auto uniquement, comme dans les
 * documents sources).
 */
export const printQuoteFacture = (quote) => {
  if (!quote) return;
  if (estDevisIa(quote)) {
    return imprimerDocumentIa(quote, `Facture ${quote.numerodevis || ''}`.trim(), buildFactureIa);
  }
  // Devis Voyage : numéro d'attestation et adresses lus sur le devis (absents de la liste des devis)
  if (estDevisVoyage(quote) && !quote.confirme && (quote.iddevis || quote.id)) {
    const fenetre = window.open('', '_blank');
    impressionVoyageApi.get(quote.iddevis || quote.id)
      .then(({ quittance: q, voyage }) => ({
        ...quote,
        raw: {
          ...(quote.raw || {}),
          numero_attestation: voyage?.Complement?.NumeroAttestation || '',
          adresse: q.AdresseClient || voyage?.Client?.Adresse || '',
          adresse_assure: q.AdresseAssure || voyage?.Assure?.Adresse || '',
        },
        nomassure: q.NomAssure || quote.nomassure,
        souscripteur: q.NomClient || quote.souscripteur,
      }))
      .catch(() => quote)
      .then((devis) => openPrintWindow(devis.numerodevis || 'Devis', buildSimpleFacture(devis), fenetre));
    return;
  }
  // Devis MRH : garanties souscrites, capitaux/franchises, adresse et date de naissance lus sur le devis
  if (estDevisMrh(quote) && !quote.confirme && (quote.iddevis || quote.id)) {
    const fenetre = window.open('', '_blank');
    impressionMrhApi.get(quote.iddevis || quote.id)
      .then(({ quittance: q, garanties, resume }) => ({
        ...quote,
        raw: {
          ...(quote.raw || {}),
          adresse: q.AdresseClient || quote.raw?.adresse || '',
          date_naissance_assure: q.DateNaissanceAssure || quote.raw?.date_naissance_assure || null,
          duree_terme_jours: q.Duree ?? quote.raw?.duree_terme_jours,
          garanties: lignesGarantiesMrh(garanties, resume),
        },
        nomassure: q.NomAssure || quote.nomassure,
        souscripteur: q.NomClient || quote.souscripteur,
      }))
      .catch(() => quote)
      .then((devis) => openPrintWindow(devis.numerodevis || 'Devis', buildMrhFacture(devis), fenetre));
    return;
  }
  const branche = String(quote.branche || quote.produit || '').toLowerCase();
  let bodyHtml;
  if (branche.includes('auto')) {
    bodyHtml = buildAutoFacture(quote);
  } else if (branche.includes('mrh') || branche.includes('habit')) {
    bodyHtml = buildMrhFacture(quote);
  } else {
    bodyHtml = buildSimpleFacture(quote);
  }
  openPrintWindow(quote.numerodevis || 'Devis', bodyHtml);
};

/**
 * Présente un contrat (portefeuille) sous la forme attendue par les gabarits du registre des
 * devis : le serializer Contrat nomme ses relations idcompagnie / idclient / idassure et porte
 * le numéro de police au lieu du numéro de devis.
 */
const contratCommeDevis = (contract) => {
  const bc = contract.raw || {};
  const client = bc.idclient && typeof bc.idclient === 'object' ? bc.idclient : null;
  const idAssure = bc.idassure && typeof bc.idassure === 'object' ? bc.idassure.IdClient : bc.idassure;
  const assureEstClient = client && Number(idAssure) === Number(client.IdClient);
  const produit = bc.idproduit && typeof bc.idproduit === 'object' ? bc.idproduit.libelle_produit : null;
  return {
    ...contract,
    numerodevis: bc.numeropolice || contract.numeropolice,
    iddevis: bc.idcontrat || contract.id,
    produit: produit || contract.produit,
    confirme: true,
    raw: {
      ...bc,
      compagnie: bc.idcompagnie,
      client,
      assure: assureEstClient ? client : (typeof bc.idassure === 'object' ? bc.idassure : null),
      nomassure: typeof bc.assure === 'string' ? bc.assure : null,
      numeroidentificationassure: assureEstClient ? bc.numeroidentificationclient : bc.numeroidentificationassure,
      iddevis: bc.idcontrat,
      numerodevis: bc.numeropolice,
    },
  };
};

// Facture de prime d'un contrat : même gabarit que le registre des devis (titre « FACTURE DE PRIME »)
export const printContratFacture = (contract) => {
  if (!contract) return;
  printQuoteFacture(contratCommeDevis(contract));
};

// Conditions Particulières d'un contrat : même gabarit que le registre des devis
export const printContratConditionsParticulieres = (contract) => {
  if (!contract) return;
  printConditionsParticulieres(contratCommeDevis(contract), { contrat: true });
};

/**
 * Conditions Particulières (modèle NSIA/OREOLE) : récupère les données réelles
 * du devis puis ouvre la fenêtre d'impression (« Enregistrer au format PDF »).
 * La fenêtre est ouverte immédiatement au clic pour ne pas être bloquée par le
 * navigateur pendant l'appel API.
 */
export const printConditionsParticulieres = async (quote, { contrat = false } = {}) => {
  if (!quote) return;
  const title = `Conditions Particulieres ${quote.numerodevis || quote.iddevis || ''}`.trim();
  // Devis Voyage : proposition du modèle URANUS (le contrat est l'imprimé remis par l'assureur)
  if (!contrat && estDevisVoyage(quote)) {
    await printPropositionVoyage(quote);
    return;
  }
  // Devis IA : proposition « groupe » pour une flotte, sinon Conditions Particulières individuelles
  if (!contrat && estDevisIa(quote)) {
    const groupe = Boolean(quote.flotte ?? quote.raw?.flotte);
    await imprimerDocumentIa(quote, title, groupe ? buildPropositionIaGroupe : buildConditionsParticulieresIa);
    return;
  }
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write('<p style="font-family:Arial;padding:20px;">Préparation des Conditions Particulières…</p>');
  }
  try {
    const id = contrat ? (quote.raw?.idcontrat || quote.id) : (quote.iddevis || quote.id);
    const flotte = Boolean(quote.flotte ?? quote.raw?.flotte);
    const auto = /auto/i.test(String(quote.branche || quote.produit || ''));
    if (auto && !flotte) {
      const cp = await conditionsParticulieresMonoApi.get(id, { contrat });
      openPrintWindow(title, buildConditionsParticulieresMono(quote, cp, { contrat }), printWindow);
    } else if (auto) {
      const cp = await conditionsParticulieresFlotteApi.get(id, { contrat });
      openPrintWindow(title, buildConditionsParticulieresFlotte(quote, cp, { contrat }), printWindow);
    } else {
      const cp = contrat
        ? await contractApi.getConditionsParticulieres(id)
        : await quoteApi.getConditionsParticulieres(id);
      openPrintWindow(title, buildConditionsParticulieres(quote, cp), printWindow);
    }
  } catch (err) {
    console.error('Erreur Conditions Particulières:', err);
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write('<p style="font-family:Arial;padding:20px;color:#b91c1c;">Impossible de charger les données du devis pour les Conditions Particulières. Veuillez réessayer.</p>');
      printWindow.document.close();
    }
  }
};


/**
 * Impression Spécialisée et Conforme OREOLE pour les États Décisionnels
 * Adapte automatiquement les colonnes, les regroupements et les totaux selon l'état.
 */
export const printEtatDecisionnelDocument = ({
  etat,
  dateDebut,
  dateFin,
  typeEtat = 2,
  dossiers = [],
}) => {
  if (!etat) return;
  const code = (etat.code_etat || '').toUpperCase().trim();
  const libelle = (etat.libelle_etat || '').trim();
  const typeLabel = Number(typeEtat) === 1 ? 'BORDEREAU' : 'RÉCAPITULATIF';
  
  const isCommission = code.includes('03') || code.includes('04') || libelle.toLowerCase().includes('commission');
  const isEncaissement = code.includes('05') || code.includes('06') || libelle.toLowerCase().includes('encaissement');
  const isArriere = code.includes('07') || code.includes('08') || libelle.toLowerCase().includes('arriéré') || libelle.toLowerCase().includes('arriere');
  const isCimaE1 = code === 'E01' || code === 'E1' || libelle.toLowerCase().includes('cima e1');
  const isCimaE2 = code === 'E02' || code === 'E2' || libelle.toLowerCase().includes('cima e2');

  // Définition dynamique des colonnes selon la nature de l'état
  let columnHeaders = [];
  if (isCommission) {
    columnHeaders = [
      'N° Police', 'N° Quittance', 'N° Avenant', 'Date Émis.', 'Date Effet', 'Date Exp.',
      'Prime Nette', 'Accessoire', 'Taxe', 'Prime TTC', 'Acc. Interm.', 'Comm. Interm.'
    ];
  } else if (isEncaissement) {
    columnHeaders = [
      'N° Police', 'N° Quittance', 'N° Avenant', 'Date Émis.', 'Date Effet', 'Date Exp.',
      'Prime Nette', 'Accessoire', 'Taxe', 'Prime TTC', 'Montant Encaissé', 'Comm. Interm.'
    ];
  } else if (isArriere) {
    columnHeaders = [
      'N° Police', 'N° Quittance', 'N° Avenant', 'Date Émis.', 'Date Effet', 'Date Exp.',
      'Prime Nette', 'Accessoire', 'Taxe', 'Prime TTC', 'Montant Arriéré', 'Comm. Interm.'
    ];
  } else {
    // Émissions standard (C01, C02, D01, D02)
    columnHeaders = [
      'N° Police', 'N° Quittance', 'N° Avenant', 'Date Émis.', 'Date Effet', 'Date Exp.',
      'Prime Nette', 'Accessoire', 'Taxe', 'Prime TTC', 'Comm. Interm.'
    ];
  }

  const fmtMoney = (v) => Math.round(Number(v || 0)).toLocaleString('fr-FR');
  const fmtDate = (v) => {
    if (!v) return '-';
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR');
  };

  // Construction de la structure hiérarchique Compagnie > Client > Branche
  const groups = {};
  const grandTotal = {
    primeNette: 0,
    accessoire: 0,
    taxe: 0,
    primeTtc: 0,
    extra: 0,
    commission: 0,
  };

  dossiers.forEach((d) => {
    const cie = d.nom_compagnie || 'Compagnie non spécifiée';
    const cli = d.nom_client || 'Client Inconnu';
    const prod = d.libelle_produit || d.produit || 'Branche Principale';

    if (!groups[cie]) {
      groups[cie] = {
        nom_compagnie: cie,
        clients: {},
        total: { primeNette: 0, accessoire: 0, taxe: 0, primeTtc: 0, extra: 0, commission: 0 },
      };
    }

    if (!groups[cie].clients[cli]) {
      groups[cie].clients[cli] = {
        nom_client: cli,
        produits: {},
        total: { primeNette: 0, accessoire: 0, taxe: 0, primeTtc: 0, extra: 0, commission: 0 },
      };
    }

    if (!groups[cie].clients[cli].produits[prod]) {
      groups[cie].clients[cli].produits[prod] = {
        libelle_produit: prod,
        items: [],
        total: { primeNette: 0, accessoire: 0, taxe: 0, primeTtc: 0, extra: 0, commission: 0 },
      };
    }

    const pNette = Number(d.prime_nette || 0);
    const acc = Number(d.accessoire || 0);
    const tx = Number(d.taxe || 0);
    const pTtc = Number(d.prime_ttc || 0);
    const com = Number(d.commission_intermediaire || 0);
    const extraVal = isCommission
      ? Number(d.accessoire_intermediaire || 0)
      : isEncaissement
      ? Number(d.montant_encaissement || 0)
      : isArriere
      ? Number(d.montant_arriere || 0)
      : 0;

    // Totaux Produit
    groups[cie].clients[cli].produits[prod].total.primeNette += pNette;
    groups[cie].clients[cli].produits[prod].total.accessoire += acc;
    groups[cie].clients[cli].produits[prod].total.taxe += tx;
    groups[cie].clients[cli].produits[prod].total.primeTtc += pTtc;
    groups[cie].clients[cli].produits[prod].total.extra += extraVal;
    groups[cie].clients[cli].produits[prod].total.commission += com;

    // Totaux Client
    groups[cie].clients[cli].total.primeNette += pNette;
    groups[cie].clients[cli].total.accessoire += acc;
    groups[cie].clients[cli].total.taxe += tx;
    groups[cie].clients[cli].total.primeTtc += pTtc;
    groups[cie].clients[cli].total.extra += extraVal;
    groups[cie].clients[cli].total.commission += com;

    // Totaux Compagnie
    groups[cie].total.primeNette += pNette;
    groups[cie].total.accessoire += acc;
    groups[cie].total.taxe += tx;
    groups[cie].total.primeTtc += pTtc;
    groups[cie].total.extra += extraVal;
    groups[cie].total.commission += com;

    // Grand Total
    grandTotal.primeNette += pNette;
    grandTotal.accessoire += acc;
    grandTotal.taxe += tx;
    grandTotal.primeTtc += pTtc;
    grandTotal.extra += extraVal;
    grandTotal.commission += com;

    groups[cie].clients[cli].produits[prod].items.push(d);
  });

  const numCols = columnHeaders.length;

  const buildTableHtml = () => {
    let rowsHtml = '';

    // En-têtes de colonnes
    const ths = columnHeaders
      .map((col, idx) => `<th style="padding:6px 8px;border:0.5px solid #475569;background:#1e293b;color:#fff;font-size:7.5pt;text-align:${idx >= 6 ? 'right' : 'left'};text-transform:uppercase;">${col}</th>`)
      .join('');

    rowsHtml += `<thead><tr>${ths}</tr></thead><tbody>`;

    Object.keys(groups).forEach((cieName) => {
      const cie = groups[cieName];
      rowsHtml += `<tr><td colspan="${numCols}" style="padding:6px 8px;background:#e2e8f0;color:#0f172a;font-weight:800;font-size:8.5pt;border:0.5px solid #94a3b8;">COMPAGNIE : ${cie.nom_compagnie}</td></tr>`;

      Object.keys(cie.clients).forEach((cliName) => {
        const cli = cie.clients[cliName];
        rowsHtml += `<tr><td colspan="${numCols}" style="padding:5px 8px;background:#f1f5f9;color:#1e293b;font-weight:700;font-size:8pt;border:0.5px solid #cbd5e1;padding-left:16px;">CLIENT : ${cli.nom_client}</td></tr>`;

        Object.keys(cli.produits).forEach((prodName) => {
          const prod = cli.produits[prodName];
          rowsHtml += `<tr><td colspan="${numCols}" style="padding:4px 8px;background:#ffffff;color:#475569;font-weight:600;font-size:7.8pt;border:0.5px solid #e2e8f0;padding-left:28px;">BRANCHE : ${prod.libelle_produit}</td></tr>`;

          prod.items.forEach((item) => {
            rowsHtml += `<tr>
              <td style="padding:3px 6px;border:0.5px solid #cbd5e1;font-size:7.5pt;font-family:monospace;">${item.numero_police || '-'}</td>
              <td style="padding:3px 6px;border:0.5px solid #cbd5e1;font-size:7.5pt;font-family:monospace;">${item.numero_quittance || '-'}</td>
              <td style="padding:3px 6px;border:0.5px solid #cbd5e1;font-size:7.5pt;">${item.numero_avenant || '-'}</td>
              <td style="padding:3px 6px;border:0.5px solid #cbd5e1;font-size:7.5pt;">${fmtDate(item.date_emission)}</td>
              <td style="padding:3px 6px;border:0.5px solid #cbd5e1;font-size:7.5pt;">${fmtDate(item.date_effet)}</td>
              <td style="padding:3px 6px;border:0.5px solid #cbd5e1;font-size:7.5pt;">${fmtDate(item.date_expiration)}</td>
              <td style="padding:3px 6px;border:0.5px solid #cbd5e1;font-size:7.5pt;text-align:right;">${fmtMoney(item.prime_nette)}</td>
              <td style="padding:3px 6px;border:0.5px solid #cbd5e1;font-size:7.5pt;text-align:right;">${fmtMoney(item.accessoire)}</td>
              <td style="padding:3px 6px;border:0.5px solid #cbd5e1;font-size:7.5pt;text-align:right;">${fmtMoney(item.taxe)}</td>
              <td style="padding:3px 6px;border:0.5px solid #cbd5e1;font-size:7.5pt;text-align:right;font-weight:700;">${fmtMoney(item.prime_ttc)}</td>
              ${isCommission || isEncaissement || isArriere ? `<td style="padding:3px 6px;border:0.5px solid #cbd5e1;font-size:7.5pt;text-align:right;">${fmtMoney(isCommission ? item.accessoire_intermediaire : isEncaissement ? item.montant_encaissement : item.montant_arriere)}</td>` : ''}
              <td style="padding:3px 6px;border:0.5px solid #cbd5e1;font-size:7.5pt;text-align:right;color:#6366f1;font-weight:600;">${fmtMoney(item.commission_intermediaire)}</td>
            </tr>`;
          });

          // Sous-total Branche
          rowsHtml += `<tr style="background:#D6E3EC;font-weight:700;font-size:7.8pt;">
            <td colspan="6" style="padding:4px 8px;border:0.5px solid #94a3b8;padding-left:28px;">TOTAL ${prod.libelle_produit}</td>
            <td style="padding:4px 6px;border:0.5px solid #94a3b8;text-align:right;">${fmtMoney(prod.total.primeNette)}</td>
            <td style="padding:4px 6px;border:0.5px solid #94a3b8;text-align:right;">${fmtMoney(prod.total.accessoire)}</td>
            <td style="padding:4px 6px;border:0.5px solid #94a3b8;text-align:right;">${fmtMoney(prod.total.taxe)}</td>
            <td style="padding:4px 6px;border:0.5px solid #94a3b8;text-align:right;">${fmtMoney(prod.total.primeTtc)}</td>
            ${isCommission || isEncaissement || isArriere ? `<td style="padding:4px 6px;border:0.5px solid #94a3b8;text-align:right;">${fmtMoney(prod.total.extra)}</td>` : ''}
            <td style="padding:4px 6px;border:0.5px solid #94a3b8;text-align:right;">${fmtMoney(prod.total.commission)}</td>
          </tr>`;
        });

        // Sous-total Client
        rowsHtml += `<tr style="background:#cbd5e1;font-weight:800;font-size:8pt;">
          <td colspan="6" style="padding:4px 8px;border:0.5px solid #64748b;padding-left:16px;">TOTAL ${cli.nom_client}</td>
          <td style="padding:4px 6px;border:0.5px solid #64748b;text-align:right;">${fmtMoney(cli.total.primeNette)}</td>
          <td style="padding:4px 6px;border:0.5px solid #64748b;text-align:right;">${fmtMoney(cli.total.accessoire)}</td>
          <td style="padding:4px 6px;border:0.5px solid #64748b;text-align:right;">${fmtMoney(cli.total.taxe)}</td>
          <td style="padding:4px 6px;border:0.5px solid #64748b;text-align:right;">${fmtMoney(cli.total.primeTtc)}</td>
          ${isCommission || isEncaissement || isArriere ? `<td style="padding:4px 6px;border:0.5px solid #64748b;text-align:right;">${fmtMoney(cli.total.extra)}</td>` : ''}
          <td style="padding:4px 6px;border:0.5px solid #64748b;text-align:right;">${fmtMoney(cli.total.commission)}</td>
        </tr>`;
      });

      // Sous-total Compagnie
      rowsHtml += `<tr style="background:#94a3b8;color:#0f172a;font-weight:900;font-size:8.2pt;">
        <td colspan="6" style="padding:5px 8px;border:0.5px solid #475569;">TOTAL ${cie.nom_compagnie}</td>
        <td style="padding:5px 6px;border:0.5px solid #475569;text-align:right;">${fmtMoney(cie.total.primeNette)}</td>
        <td style="padding:5px 6px;border:0.5px solid #475569;text-align:right;">${fmtMoney(cie.total.accessoire)}</td>
        <td style="padding:5px 6px;border:0.5px solid #475569;text-align:right;">${fmtMoney(cie.total.taxe)}</td>
        <td style="padding:5px 6px;border:0.5px solid #475569;text-align:right;">${fmtMoney(cie.total.primeTtc)}</td>
        ${isCommission || isEncaissement || isArriere ? `<td style="padding:5px 6px;border:0.5px solid #475569;text-align:right;">${fmtMoney(cie.total.extra)}</td>` : ''}
        <td style="padding:5px 6px;border:0.5px solid #475569;text-align:right;">${fmtMoney(cie.total.commission)}</td>
      </tr>`;
    });

    // Total Général (Exact look OREOLE #284962)
    rowsHtml += `<tr style="background:#284962;color:#ffffff;font-weight:900;font-size:8.5pt;">
      <td colspan="6" style="padding:6px 8px;border:0.5px solid #0f172a;">TOTAL GÉNÉRAL (${dossiers.length} lignes)</td>
      <td style="padding:6px 6px;border:0.5px solid #0f172a;text-align:right;">${fmtMoney(grandTotal.primeNette)}</td>
      <td style="padding:6px 6px;border:0.5px solid #0f172a;text-align:right;">${fmtMoney(grandTotal.accessoire)}</td>
      <td style="padding:6px 6px;border:0.5px solid #0f172a;text-align:right;">${fmtMoney(grandTotal.taxe)}</td>
      <td style="padding:6px 6px;border:0.5px solid #0f172a;text-align:right;">${fmtMoney(grandTotal.primeTtc)}</td>
      ${isCommission || isEncaissement || isArriere ? `<td style="padding:6px 6px;border:0.5px solid #0f172a;text-align:right;">${fmtMoney(grandTotal.extra)}</td>` : ''}
      <td style="padding:6px 6px;border:0.5px solid #0f172a;text-align:right;">${fmtMoney(grandTotal.commission)}</td>
    </tr>`;

    rowsHtml += '</tbody>';
    return rowsHtml;
  };

  const docHtml = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>${typeLabel} : ${libelle}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 8mm 10mm;
    }
    body {
      font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 8pt;
      line-height: 1.3;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header-table {
      width: 100%;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 6px;
      margin-bottom: 8px;
    }
    .republic-text {
      font-size: 6.8pt;
      font-weight: 800;
      letter-spacing: 0.8px;
      color: #475569;
      text-transform: uppercase;
    }
    .cabinet-title {
      font-size: 11pt;
      font-weight: 900;
      color: #0f172a;
      margin: 2px 0;
    }
    .cabinet-sub {
      font-size: 7pt;
      color: #64748b;
    }
    .title-banner {
      background: #284962;
      color: #ffffff;
      text-align: center;
      padding: 6px 10px;
      border-radius: 4px;
      margin-bottom: 8px;
    }
    .title-main {
      font-size: 9.5pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .title-sub {
      font-size: 7.2pt;
      opacity: 0.9;
      margin-top: 2px;
    }
    .kpi-grid {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }
    .kpi-card {
      flex: 1;
      border: 0.5px solid #cbd5e1;
      background: #f8fafc;
      padding: 4px 8px;
      border-radius: 4px;
      text-align: center;
    }
    .kpi-label {
      font-size: 6.2pt;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
    }
    .kpi-val {
      font-size: 8.5pt;
      font-weight: 800;
      color: #0f172a;
      margin-top: 1px;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
    }
    table.data-table th, table.data-table td {
      border: 0.5px solid #cbd5e1;
    }
    .legal-notice {
      background: #f8fafc;
      border: 0.5px solid #cbd5e1;
      padding: 5px 8px;
      border-radius: 4px;
      font-size: 6.8pt;
      color: #334155;
      margin-top: 6px;
    }
    .signatures {
      display: flex;
      justify-content: space-between;
      margin-top: 12px;
      font-size: 7.5pt;
    }
    .sig-block {
      width: 250px;
    }
    .sig-space {
      height: 40px;
      border-bottom: 1px dotted #94a3b8;
      margin-top: 4px;
    }
    @media print {
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <table class="header-table">
    <tr>
      <td style="vertical-align:top;">
        <div class="republic-text">RÉPUBLIQUE DE CÔTE D'IVOIRE • MINISTÈRE DE L'ÉCONOMIE ET DES FINANCES</div>
        <div class="cabinet-title">LE PHARE COURTAGE & GESTION D'ASSURANCES</div>
        <div class="cabinet-sub">Agrément N° 0021 / MEF / DAPS • Siège Social : Abidjan Plateau • Code CIMA CRCA</div>
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div style="font-size:7pt;color:#64748b;">Édition du : <strong>${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong></div>
        <div style="font-size:7.5pt;font-weight:800;color:#0284c7;margin-top:2px;">DOCUMENT OFFICIEL CERTIFIÉ</div>
        <div style="font-size:6.8pt;color:#64748b;">Code État : <strong>${code}</strong></div>
      </td>
    </tr>
  </table>

  <div class="title-banner">
    <div class="title-main">${typeLabel} : ${libelle}</div>
    <div class="title-sub">Période du ${dateDebut} au ${dateFin} • Procédure Postgres fn_bordereau_recap_emission</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Total Quittances</div>
      <div class="kpi-val" style="color:#0284c7;">${dossiers.length.toLocaleString('fr-FR')}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Prime Nette Totale</div>
      <div class="kpi-val">${fmtMoney(grandTotal.primeNette)} F</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Accessoires Totaux</div>
      <div class="kpi-val">${fmtMoney(grandTotal.accessoire)} F</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Taxes Totales</div>
      <div class="kpi-val">${fmtMoney(grandTotal.taxe)} F</div>
    </div>
    <div class="kpi-card" style="background:#ecfdf5;border-color:#a7f3d0;">
      <div class="kpi-label" style="color:#059669;">Prime TTC Totale</div>
      <div class="kpi-val" style="color:#059669;">${fmtMoney(grandTotal.primeTtc)} F</div>
    </div>
    <div class="kpi-card" style="background:#f5f3ff;border-color:#ddd6fe;">
      <div class="kpi-label" style="color:#7c3aed;">Commissions Totales</div>
      <div class="kpi-val" style="color:#7c3aed;">${fmtMoney(grandTotal.commission)} F</div>
    </div>
  </div>

  <table class="data-table">
    ${buildTableHtml()}
  </table>

  <div class="legal-notice">
    <strong>Attestation de Contrôle & Conformité Fiscale :</strong> Le présent bordereau récapitulatif consolide l'ensemble des émissions de polices, quittances et taxes réglementaires conformément aux dispositions des Articles 13 et suivants du Code CIMA.
  </div>

  <div class="signatures">
    <div class="sig-block">
      <div style="font-weight:700;color:#334155;">Le Chef de Service Comptabilité & Reporting :</div>
      <div class="sig-space"></div>
    </div>
    <div class="sig-block" style="text-align:right;">
      <div style="font-weight:700;color:#334155;">Pour la Direction Générale / Visa CIMA :</div>
      <div class="sig-space" style="color:#0284c7;font-weight:700;">[ Cachet Officiel ]</div>
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 350);
    };
  </script>
</body>
</html>
  `;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(docHtml);
    printWindow.document.close();
  }
};
