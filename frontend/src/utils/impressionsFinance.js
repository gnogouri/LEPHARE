import { ouvrirApercuImpression } from './apercuImpression';
import { numberToFrenchWords } from './exportUtils';
import { logoCabinetEntete, logoCabinetPied, nomCabinet, parametre } from './parametrage';

/* =========================================================================
   DOCUMENTS D'OREOLE AUX COMPAGNIES (dossier FInance_LEPHARE, 2026-10-19)
   - Bordereau de reversement de prime / de réclamation de commission : identique aux bordereaux 2117 (chèque
     d'OREOLE) et 1175 / 2088 de JCW (chèques du client à l'ordre de NSIA-CI, « Direct ») ; primes soldées et primes
     en arriéré en deux blocs, avec le reste dû.
   - Courrier de règlement de prime : modèle Word du courrier KOUMOUE et courriers JCW (texte composé par le serveur,
     production/views_bordereaux.py).
   - Courrier de réclamation de commission et son bordereau récapitulatif (réclamation de l'écran Commissions).
   - État récapitulatif des commissions payées et en attente de paiement (écran Commissions, 2026-10-20).
   ========================================================================= */

const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Montants des documents d'OREOLE : 1 073 824 (espace simple, imprimée partout)
const f = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const jma = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const taux = (t) => `${Number(t || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}%`;
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateLettres = (iso) => {
  const [a, m, j] = String(iso || '').slice(0, 10).split('-').map(Number);
  return a ? `${String(j).padStart(2, '0')} ${MOIS[m - 1]} ${a}` : '';
};

// Ligne « À l'attention … » des courriers, d'après le réglage de la compagnie (personne ou fonction, article au
// besoin) : « du Directeur de Courtage » / « le Directeur de Courtage » → « À l'attention du Directeur de Courtage » ;
// « Monsieur TANO » → « À l'attention de Monsieur TANO » (même règle : ligne_attention, views_bordereaux.py)
export const ligneAttention = (destinataire) => {
  const texte = String(destinataire || '').replace(/’/g, "'").replace(/\s+/g, ' ').trim();
  const bas = texte.toLowerCase();
  if (!texte || bas.startsWith("à l'attention") || bas.startsWith("a l'attention")) return texte;
  if (['du ', 'des ', "d'"].some((a) => bas.startsWith(a)) || texte.startsWith('de ')) return `À l'attention ${texte}`;
  const contraction = [['le ', 'du '], ['les ', 'des '], ['la ', 'de la '], ["l'", "de l'"]].find(([a]) => bas.startsWith(a));
  return contraction ? `À l'attention ${contraction[1]}${texte.slice(contraction[0].length)}` : `À l'attention de ${texte}`;
};

const ecrire = (titre, styles, corps, paysage = false) => {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8" /><title>${e(titre)}</title>
<style>@page { size: A4 ${paysage ? 'landscape' : 'portrait'}; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Arial, Helvetica, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
${styles}</style></head><body>${corps}</body></html>`;
  const fenetre = ouvrirApercuImpression();
  if (fenetre) {
    fenetre.document.open();
    fenetre.document.write(html);
    fenetre.document.close();
  }
};

/* ------------------------------------------------------------------ bordereau */
const STYLES_BORDEREAU = `
  .brd { box-sizing: border-box; width: 100%; max-width: 297mm; min-height: 189mm; padding: 6mm 7mm 6mm; font-family: Arial, Helvetica, sans-serif; font-size: 8.4pt; }
  .brd-haut { display: grid; grid-template-columns: 62mm 1fr 62mm; align-items: start; }
  .brd-logo { height: 21mm; width: auto; margin: 2mm 0 0 4mm; }
  .brd-titre { justify-self: center; margin-top: 4mm; border: 1.3pt solid #111; padding: 2.2mm 22mm; font-weight: 700; font-size: 10pt; white-space: nowrap; }
  .brd-cie { text-align: center; font-weight: 700; font-size: 10pt; margin: 4mm 0 1mm; }
  .brd-infos { display: grid; grid-template-columns: 40mm 30mm 1fr; row-gap: 4mm; margin: 0 0 4mm 2mm; font-size: 9pt; align-items: center; }
  .brd-infos b { font-size: 9.5pt; }
  .brd-du { font-weight: 700; padding-left: 50mm; }
  table.brd-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .brd-table th { border: 0.9pt solid #111; padding: 2.4mm 0.6mm; font-weight: 700; font-size: 7.9pt; text-align: center; vertical-align: middle; }
  .brd-table td { border: 0.9pt solid #111; padding: 2.6mm 0.8mm; text-align: center; vertical-align: middle; line-height: 1.3; }
  .brd-table td.client { font-size: 8.6pt; }
  .brd-table .petit { display: block; font-size: 7pt; font-weight: 400; margin-top: 0.8mm; }
  .brd-table tr.bloc td { font-weight: 700; text-align: left; padding: 1.6mm 2mm; background: #f1f1f1; letter-spacing: 0.02em; }
  .brd-table tr.sous-total td { font-weight: 700; background: #fafafa; }
  .brd-table tr.total td { font-weight: 700; padding: 3.4mm 0.8mm; }
  .brd-table tr.total td.vide { border: none; }
  .brd-signatures { display: flex; justify-content: space-between; margin: 9mm 14mm 0 2mm; font-weight: 700; text-decoration: underline; font-size: 9pt; }
  .brd-signatures span:last-child { margin-right: 22mm; }
  .brd-cheques { margin: 22mm 0 0 34mm; font-size: 8.4pt; }
  .brd-cheques div { margin-top: 1.2mm; }
  .brd-cheques b { font-size: 9.5pt; margin-left: 4mm; }
`;

const COLONNES_BORDEREAU = [
  ['Nom du client', 9], ['Assurance', 7.4], ['N°Police', 8.4], ['Avt', 3.4], ['Effet', 6], ['Expiration', 6.4],
  ['Prime HT', 6.2], ['Prime TTC', 6.2], ['Encaissement', 7.6], ['Acc. Courtier', 5.4], ['Taux com.(%)', 5],
  ['Commission', 7], ['Frais gestion', 5], ['Com. Déduite', 5], ['Acc. déduits', 5], ['Montant Reversé', 6.6],
];

const celluleReverse = (b, montant) => (b.Direct ? 'Direct' : f(montant));

// Bordereau de réclamation de commission : le reste dû n'est pas répété sous le nom du client, il figure déjà dans
// le titre du bloc « Primes en arriéré » (demande du 2026-10-21)
const ligneBordereau = (b, l) => `<tr>
    <td class="client">${e(l.Client)}${l.Soldee || b.Direct ? '' : `<span class="petit">Reste dû : ${f(l.ResteDu)}</span>`}</td>
    <td>${e(l.Assurance)}</td><td>${e(l.PoliceCompagnie || l.NumeroPolice)}</td><td>${e(l.Avenant)}</td>
    <td>${jma(l.DateEffet)}</td><td>${jma(l.DateExpiration)}</td>
    <td>${f(l.PrimeHT)}</td><td>${f(l.PrimeTtc)}</td><td>${f(l.Encaissement)}</td><td>${f(l.AccCourtier)}</td>
    <td>${taux(l.Taux)}</td><td>${f(l.Commission)}</td><td>0</td><td>0</td><td>0</td><td>${celluleReverse(b, l.MontantReverse)}</td>
  </tr>`;

// Ligne TOTAL du modèle : cellules vides sans cadre sous les quatre premières colonnes, « TOTAL » sous Effet /
// Expiration ; sous-total d'un bloc : libellé sur les six premières colonnes
const ligneTotal = (b, libelle, t, classe = 'total') => {
  const debut = classe === 'total'
    ? `<td class="vide"></td><td class="vide"></td><td class="vide"></td><td class="vide"></td><td colspan="2">${e(libelle)}</td>`
    : `<td colspan="6" style="text-align:left;padding-left:2mm">${e(libelle)}</td>`;
  return `<tr class="${classe}">${debut}
    <td>${f(t.PrimeHT)}</td><td>${f(t.PrimeTtc)}</td><td>${f(t.Encaissement)}</td><td>${f(t.AccCourtier)}</td><td>0</td>
    <td>${f(t.Commission)}</td><td>0</td><td>0</td><td>0</td><td>${celluleReverse(b, t.MontantReverse)}</td>
  </tr>`;
};

export const construireBordereau = (b) => {
  const blocs = b.Blocs || [];
  // Primes soldées et primes en arriéré dissociées (demande du 2026-10-19) ; un bordereau tout soldé garde la
  // présentation d'origine
  const dissocie = blocs.some((bloc) => !bloc.Soldees);
  const corps = dissocie
    ? blocs.map((bloc) => `<tr class="bloc"><td colspan="16">${e(bloc.Titre)}${bloc.Soldees ? '' : ` - reste dû par les clients : ${f(bloc.Totaux.ResteDu)} F`}</td></tr>
        ${bloc.Lignes.map((l) => ligneBordereau(b, l)).join('')}
        ${blocs.length > 1 ? ligneTotal(b, `Sous-total ${bloc.Soldees ? 'primes soldées' : 'primes en arriéré'}`, bloc.Totaux, 'sous-total') : ''}`).join('')
    : (b.Lignes || []).map((l) => ligneBordereau(b, l)).join('');
  // Règlements transmis : « CHÈQUE N° … », « VIREMENT N° … », « ESPÈCES du … » (libellé donné par le serveur)
  const cheques = (b.Cheques || []).map((c) => `<div>${e(c.Libelle || 'CHÈQUE')}${c.Numero ? ` N° <b>${e(c.Numero)}</b>` : ''}${c.Banque ? ` &nbsp; ${e(c.Banque)}` : ''}${c.Date ? ` du ${jma(c.Date)}` : ''} de FCFA ${f(c.Montant)}</div>`).join('');
  return `<div class="brd">
    <div class="brd-haut">
      <img class="brd-logo" src="${e(logoCabinetEntete())}" alt="${e(nomCabinet())}" />
      <div class="brd-titre">${e(b.Titre)}</div><div></div>
    </div>
    <div class="brd-cie">${e(b.NomBordereau || b.Compagnie)}</div>
    <div class="brd-infos">
      <span>Bordereau N°</span><b>${e(b.Numero || b.NumeroReversement)}</b><span></span>
      <span>Montant à reverser</span><b>${f(b.MontantAReverser)}</b><span class="brd-du">du &nbsp;${jma(b.DateBordereau)}</span>
    </div>
    <table class="brd-table">
      <colgroup>${COLONNES_BORDEREAU.map(([, l]) => `<col style="width:${l}%" />`).join('')}</colgroup>
      <tr>${COLONNES_BORDEREAU.map(([t]) => `<th>${e(t)}</th>`).join('')}</tr>
      ${corps}
      ${ligneTotal(b, 'TOTAL', b.Totaux || {})}
    </table>
    <div class="brd-signatures"><span>POUR ${e(nomCabinet().toUpperCase())}</span><span>POUR ${e(b.NomBordereau || b.Compagnie)}</span></div>
    ${cheques ? `<div class="brd-cheques">${cheques}</div>` : ''}
  </div>`;
};

export const imprimerBordereau = (b) => ecrire(`Bordereau ${b.Numero || b.NumeroReversement}`, STYLES_BORDEREAU, construireBordereau(b), true);

/* ------------------------------------------------------------------ courriers */
const STYLES_COURRIER = `
  .crr { position: relative; box-sizing: border-box; width: 100%; max-width: 210mm; min-height: 276mm; padding: 4mm 12mm 2mm 18mm; display: flex; flex-direction: column;
    font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.35; }
  .crr-logo { height: 17mm; width: auto; align-self: flex-start; }
  .crr-dest { margin: 6mm 0 0 52%; white-space: nowrap; }
  .crr-dest .lieu { margin-bottom: 7mm; }
  .crr-dest .nom { font-weight: 700; font-size: 15pt; margin-bottom: 4mm; }
  .crr-dest .service { font-weight: 700; margin-bottom: 4mm; }
  .crr-dest .ville { font-weight: 700; text-decoration: underline; margin-bottom: 1.5mm; }
  .crr-dest .attention { font-weight: 700; text-decoration: underline; }
  .crr-objet { display: grid; grid-template-columns: 22mm 6mm 1fr; margin: 13mm 0 7mm; }
  .crr-objet .titre { font-weight: 400; }
  .crr-objet b { font-weight: 700; }
  .crr-corps p { margin: 0 0 4.5mm; text-align: justify; }
  .crr-corps b.ref { text-decoration: underline; }
  .crr-pj { margin: 0 0 4.5mm 9mm; padding: 0; list-style: none; }
  .crr-pj li { margin-bottom: 2.4mm; font-weight: 700; }
  .crr-pj li::before { content: '-'; display: inline-block; width: 9mm; margin-left: -9mm; font-weight: 400; }
  .crr-signature { margin: 9mm 0 0 55%; text-align: center; width: 72mm; }
  .crr-signature .pour { text-decoration: underline; font-variant: small-caps; font-size: 12pt; }
  .crr-signature .fonction { margin-top: 5mm; }
  .crr-signature .nom { margin-top: 20mm; }
  .crr-marque { position: absolute; left: 1mm; bottom: 80mm; writing-mode: vertical-rl; transform: rotate(180deg); font-size: 8pt; font-weight: 700; white-space: nowrap; }
  .crr-pied { margin-top: auto; padding-top: 10mm; display: flex; gap: 4mm; align-items: flex-end; }
  .crr-pied img { height: 10mm; width: auto; flex-shrink: 0; }
  .crr-pied div { font-size: 5.8pt; line-height: 1.4; font-weight: 700; white-space: pre-line; }
`;

// Référence du chèque soulignée dans le texte, comme sur les courriers JCW
const mettreEnValeur = (texte, references) => {
  let html = e(texte);
  references.filter(Boolean).forEach((ref) => {
    const sansArticle = ref.replace(/^(le |la |l'|notre |les )/, '');
    html = html.split(e(sansArticle)).join(`<b class="ref">${e(sansArticle)}</b>`);
  });
  return html;
};

const piedCourrier = () => {
  const mentions = String(parametre('documents.mentions_legales', '') || '').trim();
  const marque = String(parametre('documents.mention_marque', '') || '').trim();
  return `${marque ? `<div class="crr-marque">${e(marque)}</div>` : ''}
    <div class="crr-pied"><img src="${e(logoCabinetPied())}" alt="" />${mentions ? `<div>${e(mentions)}</div>` : ''}</div>`;
};

const signatureCourrier = (c) => `<div class="crr-signature">
    <div class="pour">Pour ${e(nomCabinet())}</div>
    <div class="fonction">${e(c.Fonction)}</div>
    <div class="nom">${e(c.Signataire)}</div>
  </div>`;

const enteteCourrier = (c) => `<img class="crr-logo" src="${e(logoCabinetEntete())}" alt="${e(nomCabinet())}" />
    <div class="crr-dest">
      <div class="lieu">${e(c.Lieu)}</div>
      <div class="nom">${e(c.Destinataire)}</div>
      ${c.Service ? `<div class="service">${e(c.Service)}</div>` : ''}
      ${c.Ville ? `<div class="ville">${e(c.Ville)}</div>` : ''}
      ${c.AttentionDe ? `<div class="attention">${e(c.AttentionDe)}</div>` : ''}
    </div>`;

export const construireCourrier = (c, references = []) => `<div class="crr">
    ${enteteCourrier(c)}
    <div class="crr-objet">
      <span class="titre">OBJET</span><span>:</span>
      <div>${e(c.Objet)}${c.Branche ? `<br/><b>${e(c.Branche)}</b>` : ''}${c.Periode ? `<br/>${e(c.Periode)}` : ''}${c.PourCompte ? `<br/>${e(c.PourCompte.replace(/^(P\/C )(.*)$/, '$1'))}<b>${e(c.PourCompte.replace(/^P\/C /, ''))}</b>` : ''}</div>
    </div>
    <div class="crr-corps">
      <p>${e(c.Appellation)}</p>
      ${(c.Paragraphes || []).map((p) => `<p>${mettreEnValeur(p, references)}</p>`).join('')}
      <p>Nous joignons également à la présente :</p>
      <ul class="crr-pj">${(c.PiecesJointes || []).map((pj) => `<li>${e(pj)}</li>`).join('')}</ul>
      <p>Nous vous souhaitons bonne réception de la présente.</p>
      <p>${e(c.Salutation)}</p>
      <p>PJ : Ci-dessus citées.</p>
    </div>
    ${signatureCourrier(c)}
    ${piedCourrier()}
  </div>`;

export const imprimerCourrier = (b) => ecrire(
  `Courrier ${b.NomBordereau || b.Compagnie} ${b.Numero || ''}`.trim(),
  STYLES_COURRIER,
  construireCourrier(b.Courrier, (b.Cheques || []).map((x) => x.TexteCourrier)),
);

/* ------------------------------------------------------------------ réclamation de commission */
/**
 * Courrier de réclamation de commission (bordereau récapitulatif de l'écran Commissions) : même en-tête et
 * même signature que les courriers de règlement ; reglages = réglages « Reversements » de la compagnie.
 */
export const imprimerCourrierReclamation = (rc, reglages = {}) => {
  const ville = String(parametre('documents.ville_signature', 'Abidjan') || 'Abidjan').toUpperCase();
  const appellation = reglages.Appellation || 'Monsieur';
  const lignes = rc.Lignes || [];
  const clients = [...new Set(lignes.map((l) => l.Client))];
  const c = {
    Lieu: `${ville}, le ${dateLettres(rc.DateEmission)}`,
    Destinataire: reglages.Destinataire || rc.Compagnie,
    Service: reglages.Service || '',
    Ville: reglages.Ville || 'ABIDJAN',
    AttentionDe: ligneAttention(reglages.AttentionDe),
    Objet: 'RECLAMATION DE COMMISSIONS',
    Branche: `Bordereau récapitulatif N° ${rc.Reference}`,
    Periode: `Période du ${jma(rc.PeriodeDebut)} au ${jma(rc.PeriodeFin)}`,
    PourCompte: clients.length === 1 ? `P/C ${clients[0]}` : 'P/C ASSURES DIVERS',
    Appellation: `${appellation},`,
    Paragraphes: [
      `Nous vous prions de bien vouloir trouver ci-joint le bordereau récapitulatif des primes reversées sur la période du ${jma(rc.PeriodeDebut)} au ${jma(rc.PeriodeFin)}, `
      + `soit ${lignes.length} quittance${lignes.length > 1 ? 's' : ''} pour un montant de FCFA ${f(rc.MontantPrimes)}.`,
      // Selon l'état de la réclamation : rien de réglé, réglée en partie (reste dû), réglée en totalité
      !Number(rc.MontantPaye)
        ? `Au titre de ces affaires, nos commissions s'élèvent à FCFA ${f(rc.MontantCommissions)}. Nous vous saurions gré de bien vouloir procéder à leur règlement par chèque ou par virement.`
        : Number(rc.Reste) > 0
          ? `Au titre de ces affaires, nos commissions s'élèvent à FCFA ${f(rc.MontantCommissions)}, dont FCFA ${f(rc.MontantPaye)} déjà réglés, soit un reste dû de FCFA ${f(rc.Reste)}. Nous vous saurions gré de bien vouloir procéder à son règlement par chèque ou par virement.`
          : `Au titre de ces affaires, nos commissions s'élèvent à FCFA ${f(rc.MontantCommissions)}, réglées en totalité.`,
    ],
    PiecesJointes: ['le bordereau récapitulatif de réclamation de commission.'],
    Salutation: `Veuillez agréer, ${appellation}, nos distinguées salutations.`,
    Signataire: String(parametre('finance.courrier_signataire', 'Yvette DA') || ''),
    Fonction: String(parametre('finance.courrier_fonction', 'LE DIRECTEUR GENERAL') || ''),
  };
  // Montant demandé souligné (reste dû si la réclamation est réglée en partie), comme le chèque des courriers de règlement
  const montantSouligne = `FCFA ${f(Number(rc.MontantPaye) && Number(rc.Reste) > 0 ? rc.Reste : rc.MontantCommissions)}`;
  ecrire(`Reclamation commissions ${rc.Reference}`, STYLES_COURRIER, construireCourrier(c, [montantSouligne]));
};

const STYLES_RECAP = `${STYLES_BORDEREAU}
  .brd-sous-titre { text-align: center; font-weight: 700; font-size: 8.6pt; letter-spacing: 0.04em; margin: -0.5mm 0 3mm; }
  .brd-infos.recap { grid-template-columns: 40mm 42mm 1fr; }
  .brd-table td.g { text-align: left; padding-left: 1.5mm; }
  .brd-table th { font-size: 7.4pt; }
  .brd-table td { padding: 2.2mm 0.6mm; font-size: 7.9pt; }
  .brd-table tr.mois td { font-weight: 700; text-align: left; padding: 1.6mm 2mm; background: #f1f1f1; text-transform: capitalize; }
  .brd-arrete { margin: 5mm 0 0 2mm; font-size: 8.8pt; }
  .brd-arrete b { text-transform: uppercase; }
`;

// Colonnes : celles du bordereau d'OREOLE (client, assurance, police, effet, expiration, primes, taux, commission, acc.
// courtier) et du tableau de reversement COMMI-MOIS (n° et date du bordereau, montant reversé, commission à percevoir,
// commission perçue, solde)
const COLONNES_RECAP = [
  ['N° bord.', 4.6], ['Date', 5.6], ['Nom du client', 10.4], ['Assurance', 7.4], ['N°Police', 8.2], ['Effet', 5.6], ['Expiration', 5.8],
  ['Prime HT', 6.2], ['Prime TTC', 6.2], ['Montant reversé', 6.4], ['Taux com.(%)', 4.4], ['Commission', 6.1], ['Acc. Courtier', 5.2],
  ['Commission à percevoir', 6.6], ['Déjà perçue', 5.4], ['Reste dû', 6],
];

const assuranceRecap = (l) => l.Assurance || String(l.Branche || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

const ligneRecap = (l) => `<tr>
    <td>${e(l.NumeroBordereau || l.NumeroReversement)}</td><td>${jma(l.DateBordereau || l.DateReversement)}</td>
    <td class="g">${e(l.Client)}</td><td>${e(assuranceRecap(l))}</td><td>${e(l.PoliceCompagnie || l.NumeroPolice)}</td>
    <td>${jma(l.DateEffet)}</td><td>${jma(l.DateExpiration)}</td>
    <td>${f(l.PrimeHT)}</td><td>${f(l.PrimeTtc)}</td><td>${f(l.MontantReverse)}</td><td>${taux(l.Taux)}</td>
    <td>${f(l.CommissionHT)}</td><td>${f(l.AccCourtier)}</td><td>${f(l.CommissionDue)}</td><td>${f(l.CommissionPayee)}</td><td><b>${f(l.Reste)}</b></td>
  </tr>`;

const totalRecap = (libelle, ls, classe = 'total') => {
  const s = (cle) => ls.reduce((t, l) => t + (Number(l[cle]) || 0), 0);
  const debut = classe === 'total'
    ? `<td class="vide"></td><td class="vide"></td><td class="vide"></td><td class="vide"></td><td class="vide"></td><td colspan="2">${e(libelle)}</td>`
    : `<td colspan="7" style="text-align:left;padding-left:2mm">${e(libelle)}</td>`;
  return `<tr class="${classe}">${debut}
    <td>${f(s('PrimeHT'))}</td><td>${f(s('PrimeTtc'))}</td><td>${f(s('MontantReverse'))}</td><td></td>
    <td>${f(s('CommissionHT'))}</td><td>${f(s('AccCourtier'))}</td><td>${f(s('CommissionDue'))}</td><td>${f(s('CommissionPayee'))}</td><td>${f(s('Reste'))}</td>
  </tr>`;
};

/**
 * Bordereau récapitulatif de reversement - réclamation de commissions (réclamation de l'écran Commissions).
 * Aucun modèle d'OREOLE n'a été fourni pour ce document : il reprend la présentation des bordereaux 1175 / 2088 / 2117
 * et les colonnes du tableau de reversement, une ligne par quittance réclamée, par mois de bordereau s'il y en a
 * plusieurs, et la somme réclamée arrêtée en lettres.
 */
export const imprimerRecapitulatifReclamation = (rc, reglages = {}) => {
  const lignes = [...(rc.Lignes || [])].sort((a, b) => String(a.DateBordereau || a.DateReversement || '').localeCompare(String(b.DateBordereau || b.DateReversement || ''))
    || String(a.NumeroBordereau || '').localeCompare(String(b.NumeroBordereau || '')));
  const mois = new Map();
  lignes.forEach((l) => {
    const cle = String(l.DateBordereau || l.DateReversement || '').slice(0, 7);
    if (!mois.has(cle)) mois.set(cle, []);
    mois.get(cle).push(l);
  });
  const libelleMois = (cle) => (cle ? `${MOIS[Number(cle.slice(5, 7)) - 1]} ${cle.slice(0, 4)}` : '');
  const corpsTable = mois.size > 1
    ? [...mois.entries()].map(([cle, ls]) => `<tr class="mois"><td colspan="16">${e(libelleMois(cle))}</td></tr>
        ${ls.map(ligneRecap).join('')}${totalRecap(`Sous-total ${libelleMois(cle)}`, ls, 'sous-total')}`).join('')
    : lignes.map(ligneRecap).join('');
  // Somme réclamée : les commissions du bordereau ; règlements déjà reçus et reste dû précisés à la suite
  const reclame = Number(rc.MontantCommissions) || 0;
  const paye = Number(rc.MontantPaye) || 0;
  const lettres = numberToFrenchWords(Math.round(reclame));
  const nom = reglages.NomBordereau || rc.Compagnie;
  const corps = `<div class="brd">
    <div class="brd-haut">
      <img class="brd-logo" src="${e(logoCabinetEntete())}" alt="${e(nomCabinet())}" />
      <div class="brd-titre">BORDEREAU RECAPITULATIF DE REVERSEMENT</div><div></div>
    </div>
    <div class="brd-cie">${e(nom)}</div>
    <div class="brd-sous-titre">RECLAMATION DE COMMISSIONS</div>
    <div class="brd-infos recap">
      <span>Bordereau N°</span><b>${e(rc.Reference)}</b><span class="brd-du">du &nbsp;${jma(rc.DateEmission)}</span>
      <span>Commission réclamée</span><b>${f(reclame)}</b><span class="brd-du">Période du ${jma(rc.PeriodeDebut)} au ${jma(rc.PeriodeFin)}</span>
    </div>
    <table class="brd-table">
      <colgroup>${COLONNES_RECAP.map(([, l]) => `<col style="width:${l}%" />`).join('')}</colgroup>
      <tr>${COLONNES_RECAP.map(([t]) => `<th>${e(t)}</th>`).join('')}</tr>
      ${corpsTable}
      ${totalRecap('TOTAL', lignes)}
    </table>
    <div class="brd-arrete">Arrêté le présent bordereau à la somme de <b>${e(lettres)} francs CFA</b> (${f(reclame)} FCFA), montant des commissions réclamées${!paye ? '' : Number(rc.Reste) > 0 ? ` ; déjà réglé : ${f(paye)} FCFA, reste dû : ${f(rc.Reste)} FCFA` : ', réglé en totalité'}.</div>
    <div class="brd-signatures"><span>POUR ${e(nomCabinet().toUpperCase())}</span><span>POUR ${e(nom)}</span></div>
  </div>`;
  ecrire(`Bordereau recapitulatif ${rc.Reference}`, STYLES_RECAP, corps, true);
};

/* ------------------------------------------------------------------ état récapitulatif des commissions */
const STYLES_ETAT_COMMISSIONS = `${STYLES_BORDEREAU}
  .brd { min-height: 0; }
  .rcm-infos { text-align: center; font-size: 9pt; margin: 0 0 4mm; }
  .rcm-cartes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 0 0 5mm; }
  .rcm-carte { border: 0.9pt solid #111; padding: 2.2mm 3mm; }
  .rcm-carte span { display: block; font-size: 7.4pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
  .rcm-carte b { display: block; font-size: 12pt; margin-top: 1mm; }
  .rcm-carte small { display: block; font-size: 7.2pt; margin-top: 0.6mm; }
  .rcm-section { break-inside: avoid; margin: 0 0 5mm; }
  .rcm-section h2 { font-size: 9pt; margin: 0 0 1.6mm; padding: 1.4mm 2mm; background: #f1f1f1; border: 0.9pt solid #111; letter-spacing: 0.03em; }
  .rcm-section .brd-table th, .rcm-section .brd-table td { padding: 1.7mm 0.8mm; font-size: 7.9pt; }
  .rcm-section .brd-table tr.total td { padding: 2.2mm 0.8mm; }
  .rcm-section .brd-table td.g { text-align: left; padding-left: 1.5mm; }
  .rcm-vide { font-size: 8pt; font-style: italic; margin: 1mm 0 0 2mm; }
  .rcm-pied { display: flex; justify-content: space-between; margin-top: 3mm; font-size: 7.6pt; }
`;

const periodeEtat = (du, au) => {
  if (du && au) return `Primes reversées du ${jma(du)} au ${jma(au)}`;
  if (du) return `Primes reversées depuis le ${jma(du)}`;
  if (au) return `Primes reversées jusqu'au ${jma(au)}`;
  return 'Toutes les primes reversées';
};
const moisEtat = (cle) => (cle ? `${MOIS[Number(cle.slice(5, 7)) - 1]} ${cle.slice(0, 4)}` : '');
const pourcent = (v) => `${Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
const jours = (n) => (n === null || n === undefined ? '' : `${n} j`);

// Tableau d'un état : colonnes [titre, largeur %], lignes déjà composées, ligne TOTAL facultative
const tableEtat = (colonnes, lignes, total = '') => `<table class="brd-table">
    <colgroup>${colonnes.map(([, l]) => `<col style="width:${l}%" />`).join('')}</colgroup>
    <tr>${colonnes.map(([t]) => `<th>${e(t)}</th>`).join('')}</tr>
    ${lignes.join('')}${total}
  </table>`;

const syntheseEtat = (libelle, groupes, total) => {
  const ligne = (etiquette, g, classe = '') => `<tr class="${classe}"><td class="g">${e(etiquette)}</td><td>${g.Nombre}</td>
    <td>${f(g.PrimesReversees)}</td><td><b>${f(g.CommissionDue)}</b></td><td><b>${f(g.CommissionPayee)}</b></td>
    <td>${f(g.EnAttenteReclamee)}</td><td>${f(g.EnAttenteAReclamer)}</td><td><b>${f(g.EnAttente)}</b></td><td>${pourcent(g.TauxRecouvrement)}</td></tr>`;
  return tableEtat(
    [[libelle, 20], ['Quittances', 7], ['Primes reversées', 11], ['Commissions dues', 11], ['Commissions payées', 11],
      ['En attente : réclamées à l\'assureur', 11.5], ['En attente : non encore réclamées', 11.5], ['Total en attente', 10], ['Recouvré', 7]],
    groupes.map(([etiquette, g]) => ligne(etiquette, g)),
    ligne('TOTAL', total, 'total'),
  );
};

/**
 * État récapitulatif des commissions payées et en attente de paiement (écran Commissions) : commissions des primes
 * reversées sur la période, situation au jour de l'édition. Dues = payées + en attente (réclamées à l'assureur ou pas
 * encore réclamées) ; règlements reçus, bordereaux réclamés en attente (ancienneté), commissions à réclamer.
 */
export const imprimerEtatRecapitulatifCommissions = (r) => {
  const t = r.Total || {};
  const somme = (liste, cle) => liste.reduce((s, x) => s + (Number(x[cle]) || 0), 0);
  const reglements = r.Reglements || [];
  const reclamations = r.Reclamations || [];
  const nonReclamees = r.NonReclamees || [];
  const parCompagnie = (r.ParCompagnie || []).length > 1
    ? `<div class="rcm-section"><h2>PAR COMPAGNIE</h2>${syntheseEtat('Compagnie', r.ParCompagnie.map((g) => [g.Compagnie, g]), t)}</div>`
    : '';
  const parMois = (r.ParMois || []).length
    ? `<div class="rcm-section"><h2>PAR MOIS DE REVERSEMENT</h2>${syntheseEtat('Mois', r.ParMois.map((g) => [moisEtat(g.Mois), g]), t)}</div>`
    : '';
  const payees = `<div class="rcm-section"><h2>COMMISSIONS PAYÉES - RÈGLEMENTS REÇUS DES ASSUREURS</h2>${reglements.length
    ? tableEtat(
      [['Date', 7.5], ['Compagnie', 15], ['N° du règlement', 12], ['Bordereau réclamé', 12], ['Mode', 7], ['N° chèque / virement', 12],
        ['Banque', 11], ['Quittances', 6.5], ['Montant du règlement', 8.5], ['Commissions réglées', 8.5]],
      reglements.map((p) => `<tr><td>${jma(p.DatePaiement)}</td><td class="g">${e(p.Compagnie)}</td><td>${e(p.Reference)}</td>
        <td>${e(p.Reclamation)}</td><td>${e(p.Mode)}</td><td>${e(p.ReferencePaiement)}</td><td>${e(p.Banque)}</td><td>${p.Nombre}</td>
        <td>${f(p.MontantReglement)}</td><td><b>${f(p.Montant)}</b></td></tr>`),
      `<tr class="total"><td colspan="7">TOTAL</td><td>${somme(reglements, 'Nombre')}</td><td>${f(somme(reglements, 'MontantReglement'))}</td><td>${f(somme(reglements, 'Montant'))}</td></tr>`,
    )
    : '<div class="rcm-vide">Aucun règlement de commission reçu pour ces quittances.</div>'}</div>`;
  const reclamees = `<div class="rcm-section"><h2>EN ATTENTE DE PAIEMENT - COMMISSIONS RÉCLAMÉES À L'ASSUREUR</h2>${reclamations.length
    ? tableEtat(
      [['N° du bordereau', 14], ['Compagnie', 20], ['Émis le', 9], ['Ancienneté', 8], ['Quittances', 8], ['Commissions réclamées', 14],
        ['Déjà réglé', 13], ['Reste dû', 14]],
      reclamations.map((rc) => `<tr><td>${e(rc.Reference)}</td><td class="g">${e(rc.Compagnie)}</td><td>${jma(rc.DateEmission)}</td>
        <td>${jours(rc.Anciennete)}</td><td>${rc.Nombre}</td><td>${f(rc.CommissionReclamee)}</td><td>${f(rc.CommissionPayee)}</td><td><b>${f(rc.Reste)}</b></td></tr>`),
      `<tr class="total"><td colspan="4">TOTAL</td><td>${somme(reclamations, 'Nombre')}</td><td>${f(somme(reclamations, 'CommissionReclamee'))}</td>
        <td>${f(somme(reclamations, 'CommissionPayee'))}</td><td>${f(somme(reclamations, 'Reste'))}</td></tr>`,
    )
    : '<div class="rcm-vide">Aucun bordereau de réclamation en attente de règlement.</div>'}</div>`;
  const aReclamer = `<div class="rcm-section"><h2>EN ATTENTE DE PAIEMENT - COMMISSIONS NON ENCORE RÉCLAMÉES</h2>${nonReclamees.length
    ? tableEtat(
      [['Compagnie', 34], ['Plus ancien reversement', 16], ['Ancienneté', 14], ['Quittances', 14], ['Montant à réclamer', 22]],
      nonReclamees.map((n) => `<tr><td class="g">${e(n.Compagnie)}</td><td>${jma(n.PlusAncien)}</td><td>${jours(n.Anciennete)}</td>
        <td>${n.Nombre}</td><td><b>${f(n.Montant)}</b></td></tr>`),
      `<tr class="total"><td colspan="3">TOTAL</td><td>${somme(nonReclamees, 'Nombre')}</td><td>${f(somme(nonReclamees, 'Montant'))}</td></tr>`,
    )
    : '<div class="rcm-vide">Toutes les commissions dues ont été réclamées.</div>'}</div>`;
  const corps = `<div class="brd">
    <div class="brd-haut">
      <img class="brd-logo" src="${e(logoCabinetEntete())}" alt="${e(nomCabinet())}" />
      <div class="brd-titre">ETAT RECAPITULATIF DES COMMISSIONS</div><div></div>
    </div>
    <div class="brd-cie">${e(r.Compagnie || 'TOUTES LES COMPAGNIES')}</div>
    <div class="rcm-infos">Commissions payées et en attente de paiement - ${e(periodeEtat(r.Du, r.Au))} - situation au <b>${jma(r.Situation)}</b></div>
    <div class="rcm-cartes">
      <div class="rcm-carte"><span>Commissions dues</span><b>${f(t.CommissionDue)} F</b><small>${t.Nombre || 0} quittance(s) - ${f(t.PrimesReversees)} F reversés</small></div>
      <div class="rcm-carte"><span>Commissions payées</span><b>${f(t.CommissionPayee)} F</b><small>Recouvré : ${pourcent(t.TauxRecouvrement)}</small></div>
      <div class="rcm-carte"><span>En attente : réclamées</span><b>${f(t.EnAttenteReclamee)} F</b><small>${reclamations.length} bordereau(x) en attente de règlement</small></div>
      <div class="rcm-carte"><span>En attente : non réclamées</span><b>${f(t.EnAttenteAReclamer)} F</b><small>Bordereau récapitulatif à émettre</small></div>
    </div>
    ${parCompagnie}${parMois}${payees}${reclamees}${aReclamer}
    <div class="rcm-pied"><span>Total en attente de paiement : <b>${f(t.EnAttente)} F</b></span><span>${e(nomCabinet())} - édité le ${jma(r.Situation)}</span></div>
  </div>`;
  ecrire('Etat recapitulatif des commissions', STYLES_ETAT_COMMISSIONS, corps, true);
};

/* ------------------------------------------------------------------ bordereau récapitulatif des encaissements */
const STYLES_RECAP_ENCAISSEMENTS = `${STYLES_ETAT_COMMISSIONS}
  .brd-arrete { margin: 4mm 0 0 2mm; font-size: 8.8pt; }
  .brd-arrete b { text-transform: uppercase; }
  .rcm-section .brd-table td.hors { color: #8a3b12; text-decoration: line-through; }
  .rcm-recaps { display: grid; grid-template-columns: repeat(auto-fit, minmax(80mm, 1fr)); gap: 5mm; }
`;
const STATUTS_HORS_TOTAL = ['ANNULE', 'IMPAYE'];

/**
 * Bordereau récapitulatif des encaissements d'une période (écran État des encaissements, demande du 2026-10-21) :
 * une ligne par quittance encaissée (n° du bordereau d'encaissement, date de saisie, client, quittance, mode,
 * référence, montant, statut), total sans les encaissements annulés ni les chèques impayés (barrés), récapitulatifs
 * par mode de paiement et par compagnie, somme arrêtée en lettres. Mêmes lignes que l'écran (recherche comprise).
 */
export const imprimerRecapitulatifEncaissements = (etat, { compagnie = '', filtres = '' } = {}) => {
  const lignes = [...(etat.Lignes || [])].sort((a, b) => String(a.DateEncaissement || '').localeCompare(String(b.DateEncaissement || ''))
    || String(a.NumeroPiece || '').localeCompare(String(b.NumeroPiece || '')) || (a.IdDetailEncaissement || 0) - (b.IdDetailEncaissement || 0));
  const valides = lignes.filter((l) => !STATUTS_HORS_TOTAL.includes(l.Statut));
  const total = valides.reduce((s, l) => s + (Number(l.Montant) || 0), 0);
  const grouper = (cle) => Object.values(valides.reduce((acc, l) => {
    const libelle = l[cle] || '-';
    const g = acc[libelle] || { Libelle: libelle, Nombre: 0, Montant: 0 };
    g.Nombre += 1;
    g.Montant += Number(l.Montant) || 0;
    return { ...acc, [libelle]: g };
  }, {})).sort((a, b) => b.Montant - a.Montant);
  const parMode = grouper('Mode');
  const parCompagnie = grouper('Compagnie');
  const avecCompagnie = !compagnie && new Set(lignes.map((l) => l.Compagnie)).size > 1;
  const colonnes = [['N° du bordereau', 11], ['Date de saisie', 7], ['Nom du client', avecCompagnie ? 15 : 19], ...(avecCompagnie ? [['Compagnie', 10]] : []),
    ['N° quittance', 10], ['N° police', 10], ['Mode', 7.5], ['Référence / banque', avecCompagnie ? 12 : 14.5], ['Montant', 8.5], ['Statut', 9]];
  const recap = (titre, groupes) => `<div class="rcm-section"><h2>${e(titre)}</h2>${tableEtat(
    [['Libellé', 55], ['Nombre', 15], ['Montant', 30]],
    groupes.map((g) => `<tr><td class="g">${e(g.Libelle)}</td><td>${g.Nombre}</td><td><b>${f(g.Montant)}</b></td></tr>`),
    `<tr class="total"><td>TOTAL</td><td>${groupes.reduce((s, g) => s + g.Nombre, 0)}</td><td>${f(groupes.reduce((s, g) => s + g.Montant, 0))}</td></tr>`,
  )}</div>`;
  const corps = `<div class="brd">
    <div class="brd-haut">
      <img class="brd-logo" src="${e(logoCabinetEntete())}" alt="${e(nomCabinet())}" />
      <div class="brd-titre">BORDEREAU RECAPITULATIF DES ENCAISSEMENTS</div><div></div>
    </div>
    <div class="brd-cie">${e(compagnie || 'TOUTES LES COMPAGNIES')}</div>
    <div class="rcm-infos">Encaissements du <b>${jma(etat.Du)}</b> au <b>${jma(etat.Au)}</b>${filtres ? ` - ${e(filtres)}` : ''} - ${valides.length} encaissement(s) retenu(s)</div>
    <div class="rcm-section">${tableEtat(
    colonnes,
    lignes.map((l) => {
      const hors = STATUTS_HORS_TOTAL.includes(l.Statut) ? ' class="hors"' : '';
      return `<tr><td>${e(l.NumeroPiece)}</td><td>${jma(l.DateEncaissement)}</td><td class="g">${e(l.Client)}</td>
        ${avecCompagnie ? `<td>${e(l.Compagnie)}</td>` : ''}<td>${e(l.NumeroQuittance)}</td><td>${e(l.NumeroPolice)}</td><td>${e(l.Mode)}</td>
        <td>${e([l.Reference, l.Banque].filter(Boolean).join(' - '))}</td><td${hors}><b>${f(l.Montant)}</b></td><td>${e(l.LibelleStatut)}</td></tr>`;
    }),
    `<tr class="total"><td colspan="${colonnes.length - 2}">TOTAL (hors encaissements annulés et chèques impayés)</td><td>${f(total)}</td><td></td></tr>`,
  )}</div>
    <div class="rcm-recaps">${recap('PAR MODE DE PAIEMENT', parMode)}${parCompagnie.length > 1 ? recap('PAR COMPAGNIE', parCompagnie) : ''}</div>
    <div class="brd-arrete">Arrêté le présent bordereau à la somme de <b>${e(numberToFrenchWords(Math.round(total)))} francs CFA</b> (${f(total)} FCFA).</div>
    <div class="brd-signatures"><span>LE CAISSIER</span><span>VISA DE LA DIRECTION</span></div>
  </div>`;
  ecrire('Bordereau recapitulatif des encaissements', STYLES_RECAP_ENCAISSEMENTS, corps, true);
};
