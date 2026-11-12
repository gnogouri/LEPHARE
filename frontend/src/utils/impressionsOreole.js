/* =========================================================================
   ORÉOLE SANTÉ : documents du package (sante/oreole.py). Aucun modèle OREOLE propre à cette branche n'a été fourni :
   mise en page des imprimés MINENE, chiffres et barème des fichiers tarifs, tous réglés dans l'administration.
   Conditions particulières, barème de soins, liste des adhérents, quittance et facture du package, état des cotisations.
   ========================================================================= */
import { oreoleApi } from '../api/endpoints';
import { logoCabinetEntete, logoCabinetPied, nomCabinet, parametre, villeSignature } from './parametrage';
import { ouvrirApercuImpression } from './apercuImpression';
import { numberToFrenchWords } from './exportUtils';

const echapper = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const montant = (x) => Math.round(Number(x) || 0).toLocaleString('fr-FR').replace(/[   ]/g, ' ');
const dateFr = (x) => (x ? String(x).slice(0, 10).split('-').reverse().join('/') : '');
const absolue = (chemin) => { try { return new URL(chemin, window.location.origin).href; } catch { return chemin; } };

const STYLES = `
  @page { size: A4 portrait; margin: 10mm 14mm 8mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 9.5pt; color: #111; margin: 0 auto; max-width: 182mm; }
  .logo { height: 46px; margin-bottom: 12px; }
  .pied { margin-top: 18px; display: flex; gap: 10px; align-items: center; font-size: 6.8pt; color: #333; border-top: 1px solid #999; padding-top: 4px; }
  .pied img { height: 22px; }
  h1 { background: #1e3a5f; color: #fff; text-align: center; font-size: 12pt; padding: 5px 0; margin: 0 0 10px; }
  h2 { font-size: 10pt; margin: 14px 0 6px; text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #666; padding: 3px 6px; font-size: 9pt; vertical-align: top; }
  th { background: #e5edf6; text-align: left; }
  td.m, th.m { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.total td { background: #1e3a5f; color: #fff; font-weight: 700; }
  .entete td { border: 1px solid #666; width: 50%; }
  p { margin: 5px 0; text-align: justify; line-height: 1.35; }
  .signatures { display: flex; justify-content: space-between; margin-top: 40px; font-weight: 700; text-decoration: underline; }
  .saut { page-break-before: always; }
`;
const PAYSAGE = `@page { size: A4 landscape; margin: 9mm 10mm 8mm; } body { max-width: 277mm; } td, th { font-size: 8pt; padding: 2px 4px; }`;

const documentHtml = (titre, corps, styles = '') => `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8" /><title>${echapper(titre)}</title><style>${STYLES}${styles}</style></head><body>
<img class="logo" src="${absolue(logoCabinetEntete())}" alt="${echapper(nomCabinet())}" />
${corps}
<div class="pied"><img src="${absolue(logoCabinetPied())}" alt="" /><div>${echapper(parametre('documents.mentions_legales', ''))}</div></div>
<script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };</script></body></html>`;

const enTete = (d) => `<table class="entete">
  <tr><td><b>Souscripteur :</b> ${echapper(d.Client)}</td><td><b>Police Santé :</b> ${echapper(d.Produits.Sante.NumeroPolice || `Devis ${d.NumeroDevis}`)}</td></tr>
  <tr><td><b>Période :</b> du ${dateFr(d.DateEffet)} au ${dateFr(d.DateExpiration)}</td><td><b>Familles :</b> ${d.Adherents.length}</td></tr>
</table>`;

const CARENCES = (r) => `<table>
  <tr><td>Maladie et soins dentaires</td><td class="m">${r.Carences.Maladie} mois</td></tr>
  <tr><td>Grossesse et accouchement</td><td class="m">${r.Carences.Maternite} mois</td></tr>
  <tr><td>Prothèses dentaires</td><td class="m">${r.Carences.Protheses} mois</td></tr>
  <tr><td>Lunetterie et optique médicale</td><td class="m">${r.Carences.Optique} mois</td></tr>
  <tr><td>Maladie chronique, si elle survient pour la première fois pendant la période de garantie</td><td class="m">${r.Carences.Chronique} mois</td></tr>
</table>`;

const bareme = (o, r) => `<h2>Barème : cotisation de ${montant(o.Cotisation)} F</h2><table>
  <tr><td>Taux de couverture assurance maladie</td><td>${o.SoinsExternes} % soins externes et ${o.Hospitalisation} % frais d'hospitalisation</td></tr>
  ${o.CapitalIA ? `<tr><td>Capital Individuelle Accidents, décès et invalidité permanente totale</td><td>${montant(o.CapitalIA)} F CFA</td></tr>` : ''}
  ${o.CapitalAFA ? `<tr><td>Capital Assistance funéraire</td><td>${montant(o.CapitalAFA)} F CFA</td></tr>` : ''}
  <tr><td>Étendue territoriale</td><td>Côte d'Ivoire exclusivement</td></tr>
  <tr><th colspan="2">Plafonds de remboursement</th></tr>
  <tr><td>Frais de chambre en hospitalisation</td><td>${montant(o.Chambre)} F CFA par jour</td></tr>
  <tr><td>Frais de transport en ambulance ou SAMU</td><td>${montant(o.Ambulance)} F CFA par cas sur accord préalable</td></tr>
  <tr><td>Frais d'accouchement simple normal</td><td>${montant(o.AccouchementSimple)} F CFA par cas</td></tr>
  <tr><td>Frais d'accouchement gémellaire normal</td><td>${montant(o.AccouchementGemellaire)} F CFA par cas</td></tr>
  <tr><td>Frais d'accouchement par voie chirurgicale</td><td>${montant(o.AccouchementChirurgical)} F CFA par cas</td></tr>
  <tr><td>Forfait accouchement hors structure privée</td><td>${montant(o.AccouchementHorsStructure)} F CFA par cas</td></tr>
  <tr><td>Frais d'optique</td><td>${montant(o.OptiqueAdulte)} F CFA par adulte et ${montant(o.OptiqueEnfant)} F CFA par enfant, tous les 2 ans</td></tr>
  <tr><td>Frais de soins et de prothèse dentaire</td><td>${montant(o.Dentaire)} F CFA par an et par personne, avec accord pour les prothèses</td></tr>
  <tr><td><b>Plafond annuel</b>, par famille, toutes prestations confondues</td><td><b>${montant(o.Plafond)} F CFA</b></td></tr>
  <tr><td>Quota d'alerte automatique</td><td>À partir du ${r.AlerteBons}e bon de prise en charge ; à partir de ${montant(r.AlertePharmacie)} F CFA de frais pharmaceutiques</td></tr>
</table>`;

const offresDu = (d, offres) => {
  const ids = [...new Set(d.Adherents.map((a) => a.IdOffre))];
  return ids.map((id) => offres.find((o) => o.IdOffre === id)).filter(Boolean);
};

const documentCP = (d, offres, r) => documentHtml('Conditions particulières Oreole Santé', `
  <h1>CONDITIONS PARTICULIÈRES : OREOLE SANTÉ</h1>
  ${enTete(d)}
  <h2>Contenu du package</h2>
  <table>
    <tr><th>Assurance</th><th>Compagnie</th><th>Police</th><th class="m">Cotisation TTC</th></tr>
    <tr><td>Santé, gestionnaire ${echapper(r.Gestionnaire)}</td><td>${echapper(d.Produits.Sante.Compagnie)}</td><td>${echapper(d.Produits.Sante.NumeroPolice || '-')}</td><td class="m">${montant(d.Totaux.PartSante)}</td></tr>
    ${d.Produits.IA ? `<tr><td>Individuelle Accidents</td><td>${echapper(d.Produits.IA.Compagnie)}</td><td>${echapper(d.Produits.IA.NumeroPolice || '-')}</td><td class="m">${montant(d.Totaux.PartIA)}</td></tr>` : ''}
    ${d.Produits.AFA ? `<tr><td>Assistance funéraire</td><td>${echapper(d.Produits.AFA.Compagnie)}</td><td>${echapper(d.Produits.AFA.NumeroPolice || '-')}</td><td class="m">${montant(d.Totaux.PartAFA)}</td></tr>` : ''}
    <tr class="total"><td colspan="3">Cotisation totale</td><td class="m">${montant(d.Totaux.Cotisation)}</td></tr>
  </table>
  <p>Chaque cotisation couvre l'assuré principal, son conjoint et quatre enfants. La cotisation est forfaitaire : elle n'est ni proratisée ni remboursée en cours de contrat.</p>
  <p>Offre susceptible de modifications en fonction de certains antécédents médicaux et de l'existence de pathologies chroniques, celles-ci pouvant avoir un impact sur la sinistralité.</p>
  <h2>Délais de carence</h2>
  ${CARENCES(r)}
  ${offresDu(d, offres).map((o, i) => `<div class="${i === 0 ? 'saut' : ''}">${bareme(o, r)}</div>`).join('')}
  <p style="margin-top:14px">Réseau de soins et réseau de pharmacies en annexe. La liste des adhérents est jointe aux présentes.</p>
  <p>Fait à ${echapper(villeSignature())}, le ${dateFr(d.DateEmission)}</p>
  <div class="signatures"><span>Le Souscripteur</span><span>Pour ${echapper(nomCabinet())}</span></div>
`);

const documentBareme = (d, offres, r) => documentHtml('Barème de soins Oreole Santé', `
  <h1>BARÈME DE SOINS : OREOLE SANTÉ</h1>
  ${enTete(d)}
  ${offresDu(d, offres).map((o) => bareme(o, r)).join('')}
  <h2>Délais de carence</h2>
  ${CARENCES(r)}
`);

const documentListe = (d) => documentHtml('Liste des adhérents Oreole Santé', `
  <h1>LISTE DES ADHÉRENTS : OREOLE SANTÉ</h1>
  ${enTete(d)}
  <table style="margin-top:8px">
    <tr><th>N°</th><th>Matricule</th><th>Noms et prénoms</th><th>Date de naissance</th><th class="m">Personnes</th></tr>
    ${d.Adherents.map((a, i) => `<tr><td>${i + 1}</td><td>${echapper(a.Matricule)}</td><td>${echapper(`${a.Nom} ${a.Prenoms}`.trim())}${(a.Ayants || []).map((x) => `<br /><small>${x.Lien === 'C' ? 'Conjoint' : 'Enfant'} : ${echapper(`${x.Nom} ${x.Prenoms}`.trim())}${x.DateNaissance ? `, ${dateFr(x.DateNaissance)}` : ''}</small>`).join('')}</td><td>${dateFr(a.DateNaissance)}</td><td class="m">${a.Personnes}</td></tr>`).join('')}
    <tr class="total"><td colspan="4">Total : ${d.Adherents.length} adhérent${d.Adherents.length > 1 ? 's' : ''}</td><td class="m">${d.Adherents.reduce((t, a) => t + (a.Personnes || 1), 0)}</td></tr>
  </table>
`);

const lignesPackage = (d) => `
    <tr><th>Désignation</th><th>Compagnie</th><th>Police ou devis</th><th class="m">Montant TTC</th></tr>
    <tr><td>Cotisation Santé</td><td>${echapper(d.Produits.Sante.Compagnie)}</td><td>${echapper(d.Produits.Sante.NumeroPolice || d.Produits.Sante.NumeroDevis)}</td><td class="m">${montant(d.Totaux.PartSante)}</td></tr>
    ${d.Produits.IA ? `<tr><td>Individuelle Accidents</td><td>${echapper(d.Produits.IA.Compagnie)}</td><td>${echapper(d.Produits.IA.NumeroPolice || d.Produits.IA.NumeroDevis)}</td><td class="m">${montant(d.Totaux.PartIA)}</td></tr>` : ''}
    ${d.Produits.AFA ? `<tr><td>Assistance funéraire</td><td>${echapper(d.Produits.AFA.Compagnie)}</td><td>${echapper(d.Produits.AFA.NumeroPolice || d.Produits.AFA.NumeroDevis)}</td><td class="m">${montant(d.Totaux.PartAFA)}</td></tr>` : ''}`;

// Une seule quittance pour le client, au numéro de la police Santé : le règlement commun solde les trois polices
const documentQuittance = (d) => {
  const encaisse = ['Sante', 'IA', 'AFA'].reduce((total, p) => total + (d.Produits[p]?.Encaisse || 0), 0);
  return documentHtml('Quittance Oreole Santé', `
  <h1>QUITTANCE DE PRIME N° ${echapper(d.Produits.Sante.NumeroQuittance)} : OREOLE SANTÉ</h1>
  ${enTete(d)}
  <table style="margin-top:8px">
    ${lignesPackage(d)}
    <tr class="total"><td colspan="3">Prime totale</td><td class="m">${montant(d.Totaux.Cotisation)} F CFA</td></tr>
    <tr><td colspan="3">Déjà encaissé</td><td class="m">${montant(encaisse)} F CFA</td></tr>
    <tr class="total"><td colspan="3">Reste à payer</td><td class="m">${montant(d.Totaux.ResteAEncaisser)} F CFA</td></tr>
  </table>
  <p style="margin-top:10px">Arrêtée la présente quittance à la somme de <b>${echapper(numberToFrenchWords(Math.round(d.Totaux.Cotisation)))} francs CFA</b>.</p>
  <p>Fait à ${echapper(villeSignature())}, le ${dateFr(d.DateEmission)}</p>
  <div class="signatures"><span></span><span>Pour ${echapper(nomCabinet())}</span></div>
`);
};

const documentFacture = (d) => documentHtml('Facture du package Oreole Santé', `
  <h1>${d.Produits.Sante.NumeroPolice ? 'FACTURE' : 'FACTURE PROFORMA'} : OREOLE SANTÉ</h1>
  ${enTete(d)}
  <table style="margin-top:8px">
    ${lignesPackage(d)}
    <tr class="total"><td colspan="3">Total à payer</td><td class="m">${montant(d.Totaux.Cotisation)} F CFA</td></tr>
  </table>
  <p style="margin-top:10px">Arrêtée la présente facture à la somme de <b>${echapper(numberToFrenchWords(Math.round(d.Totaux.Cotisation)))} francs CFA</b>.</p>
  <p>Fait à ${echapper(villeSignature())}, le ${dateFr(d.DateEmission)}</p>
  <div class="signatures"><span></span><span>Pour ${echapper(nomCabinet())}</span></div>
`);

const documentCotisations = (d) => documentHtml('État des cotisations Oreole Santé', `
  <h1>ÉTAT DES COTISATIONS : OREOLE SANTÉ</h1>
  ${enTete(d)}
  <table style="margin-top:8px">
    <tr><th>N°</th><th>Matricule</th><th>Noms et prénoms</th><th>Naissance</th><th class="m">Cotisation</th><th class="m">Part Santé</th><th class="m">IA</th><th class="m">AFA</th><th class="m">Prime HT</th><th class="m">Accessoires</th><th class="m">Chargement sinistres</th></tr>
    ${d.Adherents.map((a, i) => `<tr><td>${i + 1}</td><td>${echapper(a.Matricule)}</td><td>${echapper(`${a.Nom} ${a.Prenoms}`.trim())}</td><td>${dateFr(a.DateNaissance)}</td><td class="m">${montant(a.Cotisation)}</td><td class="m">${montant(a.PartSante)}</td><td class="m">${montant(a.PartIA)}</td><td class="m">${montant(a.PartAFA)}</td><td class="m">${montant(a.PrimeHt)}</td><td class="m">${montant(a.Accessoires)}</td><td class="m">${montant(a.FraisCourtiers)}</td></tr>`).join('')}
    <tr class="total"><td colspan="4">Total : ${d.Adherents.length} familles</td>${['Cotisation', 'PartSante', 'PartIA', 'PartAFA', 'PrimeHt', 'Accessoires', 'FraisCourtiers'].map((c) => `<td class="m">${montant(d.Adherents.reduce((t, a) => t + (a[c] || 0), 0))}</td>`).join('')}</tr>
  </table>
  <p style="margin-top:8px">Part de MCI : <b>${montant(d.Totaux.PartMCI)} F</b>. Honoraires OREOLE ${d.TauxHonoraires.Cabinet} % : <b>${montant(d.Totaux.HonoraireCabinet)} F</b>. Honoraires MCI ${d.TauxHonoraires.Gestionnaire} % : <b>${montant(d.Totaux.HonoraireGestionnaire)} F</b>.</p>
`, PAYSAGE);

const GENERATEURS = { cp: documentCP, bareme: documentBareme, liste: documentListe, facture: documentFacture, quittance: documentQuittance, cotisations: documentCotisations };

export const imprimerOreole = async (type, idDevis, fenetre = ouvrirApercuImpression()) => {
  fenetre.document.open();
  fenetre.document.write('Préparation du document…');
  fenetre.document.close();
  try {
    const [donnees, referentiels] = await Promise.all([oreoleApi.lire(idDevis), oreoleApi.referentiels()]);
    fenetre.document.open();
    fenetre.document.write(GENERATEURS[type](donnees, referentiels.Offres, referentiels.Reglages));
    fenetre.document.close();
  } catch (err) {
    fenetre.document.open();
    fenetre.document.write(`Document indisponible : ${echapper(err?.response?.data?.error || err?.message || 'erreur inconnue')}`);
    fenetre.document.close();
  }
};
