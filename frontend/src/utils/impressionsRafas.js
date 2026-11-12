/* =========================================================================
   RAFAS : imprimés de la branche (sante/rafas.py). Mise en page des documents OREOLE de la convention RAFAS EXAT AGRICULTURE
   (conditions particulières, effectif assuré, cotisation annuelle par collège, honoraires, barème en annexe), lettre d'appel de fonds et
   facture de commission ou d'honoraires. Aperçu dans l'application (apercuImpression.js).
   ========================================================================= */
import { logoCabinetEntete, logoCabinetPied, nomCabinet, parametre, villeSignature } from './parametrage';
import { ouvrirApercuImpression } from './apercuImpression';
import { numberToFrenchWords } from './exportUtils';

const echapper = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const montant = (x) => Math.round(Number(x) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const dateFr = (x) => (x ? String(x).slice(0, 10).split('-').reverse().join('/') : '');
const absolue = (chemin) => { try { return new URL(chemin, window.location.origin).href; } catch { return chemin; } };
const taux = (x) => `${String(Number(x) || 0).replace('.', ',')} %`;
const aujourdhui = () => new Date().toISOString().slice(0, 10);

const STYLES = `
  @page { size: A4 portrait; margin: 12mm 15mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 10pt; color: #111; margin: 0 auto; max-width: 180mm; }
  .logo { height: 48px; margin-bottom: 12px; }
  .pied { margin-top: 18px; display: flex; gap: 10px; align-items: center; font-size: 6.8pt; color: #333; border-top: 1px solid #999; padding-top: 4px; }
  .pied img { height: 22px; }
  .titre { border: 2px solid #1e3a5f; border-radius: 14px; padding: 16px; text-align: center; margin: 14px 0; }
  .titre h1 { margin: 0; font-size: 15pt; color: #1e3a5f; }
  .titre .sous { margin-top: 6px; font-size: 13pt; font-weight: 700; color: #2f7d32; }
  h2 { font-size: 10.5pt; margin: 14px 0 6px; text-decoration: underline; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
  td, th { border: 1px solid #555; padding: 3px 6px; font-size: 9.5pt; vertical-align: middle; }
  th { background: #dce6f1; text-align: center; }
  td.m, th.m { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.c { text-align: center; }
  tr.total td { background: #dce6f1; font-weight: 700; }
  tr.rubrique td { background: #365f91; color: #fff; font-weight: 700; }
  p { margin: 5px 0; text-align: justify; line-height: 1.35; }
  ul { margin: 4px 0 6px 18px; padding: 0; }
  .signatures { display: flex; justify-content: space-between; margin-top: 34px; font-weight: 700; }
  .signatures div { width: 45%; text-align: center; text-decoration: underline; }
  .saut { page-break-before: always; }
  .encadre { border: 1px solid #1e3a5f; background: #f3f7fb; padding: 8px 10px; margin: 8px 0; }
  .grand { font-size: 13pt; font-weight: 700; }
`;

const documentHtml = (titre, corps) => `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8" /><title>${echapper(titre)}</title><style>${STYLES}</style></head><body>
<img class="logo" src="${absolue(logoCabinetEntete())}" alt="${echapper(nomCabinet())}" />
${corps}
<div class="pied"><img src="${absolue(logoCabinetPied())}" alt="" /><div>${echapper(parametre('documents.mentions_legales', ''))}</div></div>
</body></html>`;

const imprimer = (titre, corps) => {
  const fenetre = ouvrirApercuImpression();
  fenetre.document.open();
  fenetre.document.write(documentHtml(titre, corps));
  fenetre.document.close();
};

const cotisationsParCollege = (colleges) => {
  const total = colleges.reduce((s, c) => s + (Number(c.cotisation) || 0) * (Number(c.familles) || 0), 0);
  return { total, familles: colleges.reduce((s, c) => s + (Number(c.familles) || 0), 0) };
};

const bareme = (c) => {
  let rubrique = '';
  const lignes = (c.bareme || []).map((l) => {
    const entete = l.Rubrique !== rubrique ? `<tr class="rubrique"><td>${echapper(l.Rubrique)}</td><td class="c">${l.Taux ? `${l.Taux} %` : ''}</td><td>Plafonds et observations</td></tr>` : '';
    rubrique = l.Rubrique;
    const plafond = [l.Plafond ? `Plafond ${montant(l.Plafond)} F CFA` : '', l.Observation].filter(Boolean).join(' - ');
    return `${entete}<tr><td>${echapper(l.Prestation)}</td><td class="c">${l.Garanti && l.Taux ? `${l.Taux} %` : ''}</td><td>${echapper(plafond || (l.Garanti ? '' : 'Non garanti'))}${l.Accord ? ' (accord préalable)' : ''}</td></tr>`;
  }).join('');
  return `<h2>Barème de prestations : ${echapper(c.libelle)}</h2>
  <table><tr><th>Nature des prestations</th><th>Taux</th><th>Plafonds et observations</th></tr>${lignes}
  <tr class="total"><td>Plafond annuel de remboursement par famille</td><td></td><td>${c.plafond_famille ? `${montant(c.plafond_famille)} F CFA` : 'Non fixé'}</td></tr></table>`;
};

/** Conditions particulières de la convention (rang 0) ou de l'avenant de renouvellement, avec le barème de chaque collège en annexe. */
export const imprimerConditions = (convention, exercice) => {
  const avenant = Number(exercice.rang) > 0;
  const { total, familles } = cotisationsParCollege(exercice.colleges);
  const cabinet = nomCabinet();
  const corps = `
  <div class="titre"><h1>${avenant ? `AVENANT N°${exercice.rang} DE RENOUVELLEMENT - ` : ''}CONVENTION RÉGIME AUTOFINANCÉ ASSURANCE SANTÉ (RAFAS)</h1>
    <div class="sous">P/C ${echapper(convention.souscripteur)}</div><div>Exercice du ${dateFr(exercice.date_effet)} au ${dateFr(exercice.date_echeance)}</div></div>
  <h2>Conditions particulières${avenant ? ` : avenant de renouvellement n°${exercice.rang}` : ' : contrat de base'}</h2>
  <table>
    <tr><th>Souscripteur</th><td>${echapper(convention.souscripteur)}</td><th>Effet</th><th>Échéance</th></tr>
    <tr><th>Adresse postale</th><td>${echapper(convention.adresse)}</td><td class="c" rowspan="4">${dateFr(exercice.date_effet)}</td><td class="c" rowspan="4">${dateFr(exercice.date_echeance)}</td></tr>
    <tr><th>Contact</th><td>${echapper(convention.contact)}</td></tr>
    <tr><th>N° client</th><td>${echapper(convention.numero_client)}</td></tr>
    <tr><th>N° police</th><td>${echapper(convention.polices)}</td></tr>
    <tr><th>Nature du risque</th><td>${echapper(convention.nature_risque)}</td><th>Taux de couverture</th><td>${convention.taux_soins} % soins externes et ${convention.taux_hospitalisation} % hospitalisations</td></tr>
    <tr><th>Gestionnaire</th><td>${echapper(convention.gestionnaire)}</td><th>Collèges</th><td>${echapper(exercice.colleges.map((c) => c.libelle).join(', '))}</td></tr>
  </table>
  ${avenant ? `<p>À la demande du souscripteur, et d'accord parties, les garanties du présent contrat sont renouvelées dans tous leurs effets pour une durée ferme d'un an à compter du ${dateFr(exercice.date_effet)}. Il n'est dérogé aux autres clauses et conditions du contrat.</p>` : ''}
  <h2>Objet</h2>
  <p>La présente ${avenant ? 'convention, renouvelée par avenant,' : 'convention'} a pour objet de garantir la mise en place de la procédure visant à la bonne gestion du Régime Autofinancé d'Assurance Santé (RAFAS) de ${echapper(convention.souscripteur)}.</p>
  <h2>Effet et durée</h2>
  <p>Période de 12 mois allant du ${dateFr(exercice.date_effet)} au ${dateFr(exercice.date_echeance)} à minuit (heure GMT). À l'échéance, la convention se renouvelle d'année en année par tacite reconduction, sauf dénonciation par l'une des parties par lettre recommandée ou contresignée moyennant un préavis de ${convention.preavis_mois} mois au moins avant l'échéance.</p>
  <h2>Gestion du contrat</h2>
  <p>La gestion est confiée à ${echapper(convention.gestionnaire)} : gestion des bénéficiaires, traitement et remboursement des sinistres, cartes d'accès au réseau de soins, accords en ligne, états statistiques. ${echapper(cabinet)} reste le courtier et le conseil en assurance chargé de veiller à la bonne gestion du contrat et à l'analyse des dépenses.</p>
  <h2>Effectif assuré</h2>
  <table><tr><th>Souscripteur</th><th>Collège</th><th>Nombre de familles</th></tr>
    ${exercice.colleges.map((c, i) => `<tr>${i === 0 ? `<td rowspan="${exercice.colleges.length}" class="c">${echapper(convention.souscripteur)}</td>` : ''}<td>Collège ${echapper(c.libelle)}</td><td class="m">${montant(c.familles)}</td></tr>`).join('')}
    <tr class="total"><td colspan="2">TOTAL</td><td class="m">${montant(familles)}</td></tr></table>
  <p>La famille est composée de ${echapper(convention.composition_famille)}. Ne bénéficient plus des garanties au 31 janvier de l'année d'assurance au cours de laquelle les événements se réalisent : les adultes qui ont atteint ${convention.age_adulte} ans, les enfants qui ont atteint ${convention.age_enfant} ans. Sur présentation d'un certificat de fréquentation, la couverture est prorogée jusqu'à ${convention.age_etudiant} ans pour l'enfant qui poursuit des études et reste à la charge du parent assuré.</p>
  <h2>Cotisation annuelle par collège</h2>
  <table><tr><th>Collège</th><th>Cotisation par famille (F CFA)</th><th>Familles</th><th>Cotisations (F CFA)</th></tr>
    ${exercice.colleges.map((c) => `<tr><td>Collège ${echapper(c.libelle)}</td><td class="m">${montant(c.cotisation)}</td><td class="m">${montant(c.familles)}</td><td class="m">${montant((Number(c.cotisation) || 0) * (Number(c.familles) || 0))}</td></tr>`).join('')}
    <tr class="total"><td colspan="2">TOTAL</td><td class="m">${montant(familles)}</td><td class="m">${montant(total)}</td></tr></table>
  <p>Les cotisations ci-dessus permettent de régler les sinistres et les honoraires de gestion. Par appel de fonds, il faut entendre la provision que ${echapper(convention.souscripteur)} met à la disposition de ${echapper(cabinet)} pour faire face aux dépenses de santé : demandée en début d'année, elle est ajustée au fur et à mesure de l'évolution des dépenses.</p>
  <h2>Honoraires de gestion</h2>
  <ul><li>Pour ${echapper(convention.gestionnaire)} : ${taux(exercice.taux_honoraires)} des cotisations ci-dessus sur l'ensemble des familles bénéficiant des prestations.</li>
    <li>Pour ${echapper(cabinet)} : commission de courtage de ${taux(exercice.taux_commission)} des cotisations ci-dessus sur l'ensemble des familles bénéficiant des prestations.</li></ul>
  <p style="text-align:right">Fait à ${echapper(villeSignature())}, le ${dateFr(exercice.date_signature || exercice.date_effet)}</p>
  <div class="signatures"><div>Pour ${echapper(convention.souscripteur)}</div><div>Pour ${echapper(cabinet)}</div></div>
  ${exercice.colleges.map((c) => `<div class="saut"></div>${bareme(c)}`).join('')}`;
  imprimer(`${avenant ? `Avenant ${exercice.rang}` : 'Convention'} RAFAS ${convention.souscripteur}`, corps);
};

/** Lettre d'appel de fonds au souscripteur, avec la situation du fonds de l'exercice. */
export const imprimerAppel = (convention, fonds, appel) => {
  const cabinet = nomCabinet();
  const corps = `
  <p style="text-align:right">${echapper(villeSignature())}, le ${dateFr(appel.date_appel || aujourdhui())}</p>
  <p><b>${echapper(convention.souscripteur)}</b><br/>${echapper(convention.adresse)}${convention.representant ? `<br/>À l'attention de ${echapper(convention.representant)}` : ''}</p>
  <div class="titre"><h1>APPEL DE FONDS N° ${echapper(appel.numero)}</h1><div class="sous">Régime autofinancé d'assurance santé (RAFAS)</div>
    <div>Exercice du ${dateFr(fonds.Exercice.date_effet)} au ${dateFr(fonds.Exercice.date_echeance)}</div></div>
  <p>Madame, Monsieur,</p>
  <p>Conformément à la convention de gestion de votre régime autofinancé d'assurance santé, nous vous prions de bien vouloir mettre à notre disposition la provision suivante pour faire face aux dépenses de santé de votre personnel, traitées par ${echapper(convention.gestionnaire)} :</p>
  <div class="encadre"><div>Objet : ${echapper(appel.objet)}</div><div class="grand">Montant : ${montant(appel.montant)} F CFA</div>
    <div>Soit : ${echapper(numberToFrenchWords(Math.round(Number(appel.montant) || 0)))} francs CFA</div>${appel.date_limite ? `<div>À verser au plus tard le ${dateFr(appel.date_limite)}</div>` : ''}</div>
  <h2>Situation du fonds au ${dateFr(aujourdhui())}</h2>
  <table>
    <tr><td>Versements reçus sur l'exercice</td><td class="m">${montant(fonds.Versements)} F</td></tr>
    <tr><td>Dépenses de santé remboursées (relevés du gestionnaire, ${fonds.MoisAvecDonnees} mois)</td><td class="m">${montant(fonds.Depenses)} F</td></tr>
    <tr><td>Honoraires réglés</td><td class="m">${montant((fonds.HonorairesRegles?.GESTIONNAIRE || 0) + (fonds.HonorairesRegles?.COURTIER || 0))} F</td></tr>
    <tr class="total"><td>Solde du fonds avant cet appel</td><td class="m">${montant(fonds.Solde)} F</td></tr>
    <tr><td>Rythme mensuel moyen des dépenses</td><td class="m">${montant(fonds.Rythme)} F</td></tr>
  </table>
  <p>Nous restons à votre disposition pour tout renseignement et vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.</p>
  <div class="signatures"><div></div><div>Pour ${echapper(cabinet)}</div></div>`;
  imprimer(`Appel de fonds ${appel.numero}`, corps);
};

/** Facture de commission de courtage (chiffre d'affaires du cabinet) ou relevé d'honoraires du gestionnaire. */
export const imprimerFacture = (convention, exercice, h) => {
  const cabinet = nomCabinet();
  const courtier = h.beneficiaire === 'COURTIER';
  const corps = `
  <p style="text-align:right">${echapper(villeSignature())}, le ${dateFr(h.date_emission)}</p>
  <p><b>${echapper(convention.souscripteur)}</b><br/>${echapper(convention.adresse)}</p>
  <div class="titre"><h1>${courtier ? 'FACTURE DE COMMISSION DE COURTAGE' : 'HONORAIRES DE GESTION'} N° ${echapper(h.numero)}</h1>
    <div class="sous">Régime autofinancé d'assurance santé (RAFAS)</div><div>${courtier ? echapper(cabinet) : echapper(convention.gestionnaire)}</div></div>
  <table>
    <tr><th>Désignation</th><th>Période</th><th>Base : cotisations</th><th>Taux</th><th>Montant (F CFA)</th></tr>
    <tr><td>${courtier ? 'Commission de courtage' : 'Honoraires de gestion'} sur les cotisations du régime, exercice du ${dateFr(exercice.date_effet)} au ${dateFr(exercice.date_echeance)}</td>
      <td class="c">du ${dateFr(h.periode_du)} au ${dateFr(h.periode_au)}</td><td class="m">${montant(h.base)}</td><td class="c">${taux(h.taux)}</td><td class="m">${montant(h.montant)}</td></tr>
    <tr class="total"><td colspan="4">TOTAL</td><td class="m">${montant(h.montant)}</td></tr>
  </table>
  <p>Arrêté${courtier ? 'e' : 's'} à la somme de ${echapper(numberToFrenchWords(Math.round(Number(h.montant) || 0)))} francs CFA.</p>
  <p>Base : cotisations annuelles par famille de chaque collège de la convention, sur l'ensemble des familles bénéficiant des prestations.</p>
  ${h.date_paiement ? `<p><b>Réglé le ${dateFr(h.date_paiement)}</b>${h.mode ? ` par ${echapper(h.mode.toLowerCase())}` : ''}${h.reference ? `, référence ${echapper(h.reference)}` : ''}.</p>` : ''}
  <div class="signatures"><div></div><div>Pour ${echapper(courtier ? cabinet : convention.gestionnaire)}</div></div>`;
  imprimer(`${courtier ? 'Facture de commission' : 'Honoraires'} ${h.numero}`, corps);
};
