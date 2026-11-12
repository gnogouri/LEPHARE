import { ouvrirApercuImpression } from './apercuImpression';
import { numberToFrenchWords } from './exportUtils';
import { logoCabinetEntete, nomCabinet } from './parametrage';

/* =========================================================================
   TRANSPORT HORS GUCE : ressortie mensuelle d'une police d'abonnement (voyages du mois et facture de prime),
   d'après le document OREOLE « TRANSPORTS.docx ». Aperçu dans l'application, impression ou PDF depuis l'aperçu.
   ========================================================================= */

const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const jma = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const moisEnLettres = (mois) => {
  const [a, m] = String(mois || '').split('-').map(Number);
  return a && m ? `${MOIS[m - 1]} ${a}` : '';
};

const STYLES = `
  .rs { box-sizing: border-box; width: 100%; max-width: 297mm; padding: 8mm 9mm; font-size: 8.6pt; }
  .rs-haut { display: grid; grid-template-columns: 60mm 1fr 60mm; align-items: start; }
  .rs-logo { height: 20mm; width: auto; }
  .rs-titre { justify-self: center; text-align: center; border: 1.3pt solid #111; padding: 2.4mm 14mm; font-weight: 700; font-size: 11pt; }
  .rs-titre small { display: block; font-size: 8.5pt; font-weight: 400; margin-top: 1mm; }
  .rs-infos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.5mm 6mm; margin: 6mm 0 4mm; font-size: 8.8pt; }
  .rs-infos span { display: block; color: #555; font-size: 7.6pt; text-transform: uppercase; letter-spacing: 0.03em; }
  .rs-infos b { font-size: 9.4pt; }
  .rs-conditions { margin: 0 0 4mm; font-size: 8.4pt; color: #333; }
  table.rs-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .rs-table th { border: 0.9pt solid #111; padding: 2mm 1mm; font-size: 7.8pt; background: #f1f1f1; }
  .rs-table td { border: 0.9pt solid #111; padding: 1.8mm 1mm; text-align: center; vertical-align: middle; }
  .rs-table td.g { text-align: left; }
  .rs-table td.n { text-align: right; font-variant-numeric: tabular-nums; }
  .rs-table tr.total td { font-weight: 700; background: #fafafa; }
  .rs-facture { display: grid; grid-template-columns: 1fr 80mm; gap: 8mm; margin-top: 6mm; align-items: start; }
  .rs-lettres { font-size: 8.8pt; line-height: 1.5; }
  .rs-decompte { border: 1pt solid #111; }
  .rs-decompte div { display: flex; justify-content: space-between; padding: 1.8mm 3mm; border-bottom: 0.6pt solid #bbb; }
  .rs-decompte div:last-child { border-bottom: none; font-weight: 700; font-size: 10pt; background: #f1f1f1; }
  .rs-pied { display: flex; justify-content: space-between; margin-top: 10mm; font-size: 8pt; color: #444; }
  .rs-signature { margin-top: 10mm; text-align: right; font-weight: 700; text-decoration: underline; padding-right: 20mm; }
`;

/**
 * Ressortie du mois : police d'abonnement (détail de l'écran), ressortie (Mois, NumeroQuittance, montants) et voyages
 * facturés (ceux dont IdDevisRessortie est la ressortie).
 */
export const imprimerRessortie = (police, ressortie, voyages) => {
  const total = (cle) => voyages.reduce((s, v) => s + (Number(v[cle]) || 0), 0);
  const garanties = (police.Garanties || []).map((g) => `${e(g.Libelle)} ${String(g.Taux).replace('.', ',')} %`).join(' + ');
  const lignes = voyages.map((v) => `<tr>
      <td>${v.Numero}</td><td>${jma(v.DateDepart)}</td><td class="g">${e(v.Marchandise)}</td>
      <td class="g">${e(v.LieuDepart)} → ${e(v.LieuArrivee)}</td><td class="g">${e([v.MoyenTransport, v.DocumentTransport].filter(Boolean).join(' · '))}</td>
      <td class="n">${f(v.Valeur)}</td><td class="n">${f(v.PrimeNette)}</td><td class="n">${f(v.Accessoire)}</td>
      <td class="n">${f(v.Taxe)}</td><td class="n"><b>${f(v.PrimeTtc)}</b></td></tr>`).join('');
  const ttc = Number(ressortie.PrimeTtc) || total('PrimeTtc');
  const corps = `<div class="rs">
    <div class="rs-haut">
      <img class="rs-logo" src="${e(logoCabinetEntete())}" alt="${e(nomCabinet())}" />
      <div class="rs-titre">RESSORTIE MENSUELLE - FACTURE DE PRIME<small>Police d'abonnement Transport, ${e(moisEnLettres(ressortie.Mois))}</small></div><div></div>
    </div>
    <div class="rs-infos">
      <div><span>Souscripteur</span><b>${e(police.Client)}</b></div>
      <div><span>Police</span><b>${e(police.NumeroPolice)}</b>${police.NumeroPoliceCompagnie ? ` · ${e(police.NumeroPoliceCompagnie)}` : ''}</div>
      <div><span>Compagnie</span><b>${e(police.Compagnie)}</b></div>
      <div><span>Mode de transport</span><b>${e(police.LibelleMode)}</b></div>
      <div><span>Période facturée</span><b>du ${jma(ressortie.DateEffet)} au ${jma(ressortie.DateExpiration)}</b></div>
      <div><span>Quittance</span><b>${e(ressortie.NumeroQuittance || '-')}</b></div>
    </div>
    <div class="rs-conditions">Conditions de la police : ${garanties || '-'}${police.ExonereTaxe ? ' - affaire exonérée de taxe' : ''}.</div>
    <table class="rs-table">
      <colgroup><col style="width:5%"><col style="width:8%"><col style="width:17%"><col style="width:17%"><col style="width:14%">
        <col style="width:9%"><col style="width:8%"><col style="width:7%"><col style="width:7%"><col style="width:8%"></colgroup>
      <thead><tr><th>N°</th><th>Départ</th><th>Marchandise</th><th>Trajet</th><th>Transport, document</th>
        <th>Valeur assurée</th><th>Prime nette</th><th>Access.</th><th>Taxe</th><th>Prime TTC</th></tr></thead>
      <tbody>${lignes}
        <tr class="total"><td colspan="5">TOTAL : ${voyages.length} voyage${voyages.length > 1 ? 's' : ''}</td><td class="n">${f(total('Valeur'))}</td>
          <td class="n">${f(total('PrimeNette'))}</td><td class="n">${f(total('Accessoire'))}</td><td class="n">${f(total('Taxe'))}</td><td class="n">${f(total('PrimeTtc'))}</td></tr>
      </tbody>
    </table>
    <div class="rs-facture">
      <div class="rs-lettres">Arrêtée la présente facture à la somme de <b>${e(numberToFrenchWords(Math.round(ttc)))} francs CFA</b>
        (${f(ttc)} F), due par le souscripteur au titre des voyages de ${e(moisEnLettres(ressortie.Mois))}.</div>
      <div class="rs-decompte">
        <div><span>Prime nette</span><span>${f(ressortie.PrimeNette ?? total('PrimeNette'))} F</span></div>
        <div><span>Accessoires</span><span>${f(ressortie.Accessoire ?? total('Accessoire'))} F</span></div>
        <div><span>Taxe</span><span>${f(ressortie.Taxe ?? total('Taxe'))} F</span></div>
        <div><span>Prime TTC</span><span>${f(ttc)} F</span></div>
      </div>
    </div>
    <div class="rs-signature">Le Courtier</div>
    <div class="rs-pied"><span>${e(nomCabinet())}</span><span>Édité le ${new Date().toLocaleDateString('fr-FR')}</span></div>
  </div>`;
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8" /><title>Ressortie ${e(police.NumeroPolice)} ${e(ressortie.Mois)}</title>
<style>@page { size: A4 landscape; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Arial, Helvetica, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
${STYLES}</style></head><body>${corps}</body></html>`;
  const fenetre = ouvrirApercuImpression();
  if (fenetre) {
    fenetre.document.open();
    fenetre.document.write(html);
    fenetre.document.close();
  }
};
