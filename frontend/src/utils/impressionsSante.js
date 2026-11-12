/* =========================================================================
   SANTÉ MINENE : Conditions Particulières, barème, liste des assurés et liste des ayants droit.
   Modèles OREOLE (Desktop\_OREOLE ASSURANCE\SANTE : cp_MINENE.pdf, BAREME_70-80.pdf, BAREMES DE SOINS-
   MINENE SANTE- 80% Tous actes.docx) et gabarits URANUS (scenes/Products/Documents/Sante : CPMinene,
   BaremeMinene, AffiliesList, AyantsDroitsList). Montants, plafonds, délais et clauses : Administration >
   Réglages Santé MINENE (URANUS imprimait le barème 70 %-80 % pour toutes les formules).
   Données : quittance de la proposition ou du contrat, saisie Santé du devis (couvertures,
   adhérents, affiliés) et, pour un contrat, ayants droit de l'IA MINENE rattachée à la police.
   ========================================================================= */
import { impressionSanteApi } from '../api/endpoints';
import { formuleSante, logoCabinetEntete, logoCabinetPied, nomCabinet, parametre, reglagesMinene, villeSignature } from './parametrage';
import { ouvrirApercuImpression } from './apercuImpression';
import { numberToFrenchWords } from './exportUtils';

const TARIFS_MINENE = [87, 102, 153];

const MENTIONS_LEGALES = "SARL Unipersonnelle au capital de 5 000 000 FCFA I C.B : SGCI : CI008 01111 011157481298 32 I C.C : 1005723 Y I RCCM : CI-ABJ-01-2009-B13-06768 Centre des impôts de Cocody Contrat R C N°1186583100012N I Siège social : Cocody cité des arts, Bd Latrille, face SODEMI, Imm. « LES 7 COLONNES » BP : 27 B.P 112 Abj 27 Agrément N° 141/MEF/DGTCP/DA du 24 MARS 2010 Tél : +225 27 22 48 76 86 / + 225 27 22 48 73 49 / +225 27 22 48 71 24 / +225 27 22 22 13 57 Cel : +2250102938218 Site web : oreoleassurances-ci.com";

export const estDevisSante = (quote) => /sant/i.test(String(quote?.branche || quote?.produit || ''));

const echapper = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const texte = (x) => echapper(String(x ?? '').trim());
const montant = (x) => Math.round(Number(x) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const date = (x) => {
  const m = String(x || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const annee = (x) => Number(String(x || '').slice(0, 4)) || new Date().getFullYear();
// Lendemain de l'échéance en lettres : « 1er janvier 2027 » pour une échéance au 31 décembre, « 16 avril 2026 » au 15 avril
const lendemainEnLettres = (x) => {
  const m = String(x || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const jour = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  const quantieme = jour.getUTCDate();
  return `${quantieme === 1 ? '1er' : quantieme} ${jour.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' })} ${jour.getUTCFullYear()}`;
};
const nombre = (x) => Number(x || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');
const MILLIONS = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'];
// « deux (02) millions » comme sur les CP OREOLE ; autre montant : en chiffres
const enLettres = (x) => {
  const n = Number(x) / 1000000;
  if (Number.isInteger(n) && n >= 1 && n < MILLIONS.length) return `${MILLIONS[n]} (${String(n).padStart(2, '0')}) million${n > 1 ? 's' : ''}`;
  return `${montant(x)} F CFA`;
};
const mois = (n) => String(Math.round(Number(n) || 0)).padStart(2, '0');

// Quittance reconstituée depuis la saisie du devis quand fn_quittance_proposition ne renvoie rien
// (devis 24697 par exemple)
const quittanceDepuisSaisie = (devis) => {
  if (!devis) return {};
  const jours = devis.dateeffet && devis.dateexpiration
    ? Math.round((new Date(devis.dateexpiration) - new Date(devis.dateeffet)) / 86400000) : 0;
  return {
    IdDevis: devis.iddevis, NumeroDevis: devis.numerodevis, RaisonSociale: devis.compagnie, LibelleIntermediaire: 'OREOLE ASSURANCES',
    NomClient: devis.client_nom, NomAssure: devis.client_nom, TypeAssure: 'Personne Physique',
    DateEffet: devis.dateeffet, DateExpiration: devis.dateexpiration, Duree: jours,
    PrimeNette: devis.primenette, PrimeNetteHorsFga: devis.primenette, Accessoire: devis.accessoire,
    TaxeEnregistrement: devis.taxe, FraisGestion: 0, PrimeTtc: devis.primettc,
  };
};

/** Données d'impression d'un devis ({ iddevis }) ou d'un contrat ({ idcontrat }) Santé. */
const charger = async (ids) => {
  const d = await impressionSanteApi.get(ids);
  if (!Object.keys(d.quittance || {}).length) d.quittance = quittanceDepuisSaisie(d.saisie?.devis);
  const detail = d.saisie?.detail || {};
  const filiales = d.saisie?.filiales || [];
  const adherents = d.saisie?.adherents || [];
  const formuleFiliale = Object.fromEntries(filiales.map((f) => [Number(f.idfiliale), f]));
  // Formule de chaque famille : celle de sa couverture, à défaut celle du devis
  const formuleAdherent = Object.fromEntries(adherents.map((a) => {
    const f = formuleFiliale[Number(a.idfiliale)];
    return [Number(a.idadherent), { id: Number(f?.idoffresante || detail.idoffre) || 0, libelle: f?.libelle_offre || detail.libelle_offre || '' }];
  }));
  const formules = [...new Set(Object.values(formuleAdherent).map((f) => f.id).filter(Boolean))];
  if (!formules.length && detail.idoffre) formules.push(Number(detail.idoffre));
  const minene = TARIFS_MINENE.includes(Number(detail.idtarif)) || String(detail.codecategorie || '') === '123'
    || /MINENE/i.test(`${detail.libelle_tarif || ''} ${d.quittance?.LibelleCategorie || ''}`);
  return {
    ...d,
    detail,
    formuleAdherent,
    formules,
    minene,
    // Option imprimée : la formule si elle est unique, sinon « VOIR LISTE » (liste des assurés en annexe)
    option: formules.length > 1 ? 'VOIR LISTE' : (d.quittance?.LibelleOffre || detail.libelle_offre || ''),
  };
};

const STYLES = `
  @page { size: A4 portrait; margin: 10mm 14mm 8mm; }
  * { box-sizing: border-box; }
  /* Fenêtre d'impression calée sur la largeur utile d'une page A4 portrait (210 mm moins les marges) :
     sans ça, le document s'étire sur toute la largeur de l'écran et paraît en paysage */
  body { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 9.5pt; color: #111; margin: 0 auto; max-width: 182mm; }
  /* Chaque section est un tableau : l'en-tête (logo) et l'espace du pied se répètent sur chaque page
     imprimée, le pied (mentions légales) est fixé en bas de chaque page */
  .feuille { width: 100%; border-collapse: collapse; page-break-after: always; }
  .feuille:last-of-type { page-break-after: auto; }
  .feuille > thead td, .feuille > tfoot td, .feuille > tbody > tr > td { padding: 0; border: none; }
  .logo { height: 46px; margin-bottom: 12px; }
  .espace-pied { height: 17mm; }
  .pied { position: fixed; bottom: 0; left: 0; right: 0; max-width: 182mm; margin: 0 auto; display: flex; gap: 10px; align-items: center; font-size: 6.2pt; color: #333; }
  .pied img { height: 24px; }
  .bandeau { background: #2a7dd1; color: #fff; text-align: center; font-weight: 700; font-size: 11pt; padding: 3px 0; }
  .titre-bareme { background: #dbeafe; text-align: center; font-weight: 700; font-size: 12pt; padding: 4px 0; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; }
  .cadre { border: 1px solid #555; }
  .entete td { padding: 4px 8px; vertical-align: top; width: 50%; }
  .entete b { font-weight: 700; }
  .periode td { border: 1px solid #555; padding: 4px 8px; }
  .primes { margin-top: 8px; }
  .primes td { border: 1px solid #555; padding: 4px 8px; font-weight: 700; }
  .rubrique { font-weight: 700; text-decoration: underline; margin: 14px 0 6px; }
  p { margin: 6px 0; text-align: justify; line-height: 1.35; }
  p.mention-avenants { font-size: 8.5pt; font-style: italic; margin: 5px 0 8px; }
  .ajustement td { border: 1px solid #555; padding: 3px 8px; font-weight: 700; font-size: 9pt; }
  .signatures { display: flex; justify-content: space-between; margin-top: 46px; font-weight: 700; text-decoration: underline; }
  .bareme td { border: 1px solid #777; padding: 5px 8px; vertical-align: top; font-weight: 700; font-size: 9pt; }
  .bareme td:first-child { width: 50%; }
  .bareme .section td { background: #1e3a5f; color: #fff; text-align: center; font-size: 10pt; }
  .rouge { color: #d00; }
  .liste th, .liste td { border: 1px solid #777; padding: 4px 6px; text-align: left; font-size: 9pt; }
  .liste th { background: #e5e7eb; }
  .liste .famille td { background: #f3f4f6; font-weight: 700; }
  .titre-liste { text-align: center; font-weight: 700; font-size: 12pt; margin: 6px 0 12px; }
`;

// Adresse absolue : la fenêtre d'impression (about:blank) ne résout pas les chemins relatifs
const absolue = (chemin) => { try { return new URL(chemin, window.location.origin).href; } catch { return chemin; } };
const page = (corps) => `<table class="feuille">
  <thead><tr><td><img class="logo" src="${absolue(logoCabinetEntete())}" alt="OREOLE Assurances" /></td></tr></thead>
  <tfoot><tr><td><div class="espace-pied"></div></td></tr></tfoot>
  <tbody><tr><td>${corps}</td></tr></tbody></table>`;
// Bordereau des primes par assuré : A4 paysage (14 colonnes)
const PAYSAGE = `
  @page { size: A4 landscape; margin: 9mm 10mm 8mm; }
  body, .pied { max-width: 277mm; }
  .bordereau th, .bordereau td { border: 1px solid #777; padding: 3px 4px; font-size: 7.6pt; }
  .bordereau th { background: #1e3a5f; color: #fff; text-align: center; font-weight: 700; }
  .bordereau td.m { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .bordereau tr.principal td { border-top: 1.6px solid #333; }
  .bordereau tr.total td { background: #1e3a5f; color: #fff; font-weight: 700; }
  .recap { display: flex; justify-content: flex-end; gap: 24px; margin-top: 12px; }
  .recap table { width: auto; min-width: 260px; }
  .recap td { padding: 2px 8px; font-size: 9pt; }
  .recap .titre td { background: #1e3a5f; color: #fff; font-weight: 700; }
  .recap td.m { text-align: right; font-weight: 700; white-space: nowrap; }
  .ecart { margin-top: 10px; padding: 6px 10px; border: 1px solid #d97706; color: #92400e; font-size: 8.5pt; }
`;
const documentHtml = (titre, pages, styles = '') => `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8" /><title>${echapper(titre)}</title>
<style>${STYLES}${styles}</style></head><body>
<div class="pied"><img src="${absolue(logoCabinetPied())}" alt="" /><div>${echapper(parametre('documents.mentions_legales', MENTIONS_LEGALES))}</div></div>
${pages.join('')}
<script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };</script></body></html>`;

// ------------------------------------------------------------------ Conditions Particulières
// Contrat de base d'une période qui a des avenants (incorporation d'un membre, changement de formule…) : documents à jour
// de ces avenants, primes de la période (production/periode_contrat.py), avenants rappelés sous le tableau des primes
const mentionAvenants = (periode, debut = 'Primes de la période, avenants compris') => {
  if (!periode?.EstBase || !periode.Mouvements?.length) return '';
  const avenants = periode.Mouvements.map((m) => `avenant${m.NumeroAvenant ? ` n° ${texte(m.NumeroAvenant)}` : ''} `
    + `(${texte((m.LibelleAvenant || m.Avenant).toLowerCase())}) du ${date(m.DateEffet)} : ${montant(m.PrimeTtc)} F TTC`);
  return `<p class="mention-avenants">${debut} : ${avenants.join(' ; ')}.</p>`;
};

const pagesCp = (d) => {
  const q = d.quittance || {};
  const r = reglagesMinene();
  const physique = String(q.TypeAssure || 'Personne Physique').toLowerCase().includes('physique');
  const naissance = [date(q.DateNaissanceAssure), q.LieuNaissanceAssure].filter(Boolean).join(' à ');
  const duree = Number(q.Duree) ? Math.max(1, Math.round(Number(q.Duree) / 30.42)) : 12;
  const ligne = (l1, v1, l2, v2) => `<tr><td><b>${l1} :</b> ${v1}</td><td><b>${l2} :</b> ${v2}</td></tr>`;
  const numero = q.NumeroPolice || q.NumeroDevis || '';
  // Réduction (négative) ou majoration (positive) de l'année, si le détail recalculé retrouve la prime enregistrée
  const ajustement = d.bordereau?.Minene && !Number(d.bordereau.Recap?.Ecart) ? Number(d.bordereau.Recap?.Ajustement) || 0 : 0;
  // Imprimées depuis un avenant (incorporation…) : primes de l'avenant, familles à sa date
  const avenant = Boolean(d.periode && !d.periode.EstBase);
  const page1 = `
    <div class="bandeau">${q.NumeroPolice ? `CONDITIONS PARTICULIERES${avenant ? ` - AVENANT N° ${texte(q.NumeroAvenant)} -` : ''} POLICE` : 'DEVIS'} N° ${texte(numero)}</div>
    <table class="cadre entete">
      ${ligne('Compagnie', texte(q.RaisonSociale), physique ? 'Nom et Prénoms assuré' : 'Raison Sociale', texte(q.NomAssure || q.NomClient))}
      ${ligne('Nature du risque', 'MINENE SANTE', physique ? 'Date et lieu de naissance' : 'Numéro registre de commerce', texte(naissance))}
      ${ligne('Souscripteur', texte(q.NomClient), physique ? 'Profession' : 'Activité', texte(q.ProfessionClient))}
      ${ligne('Intermédiaire', texte(q.LibelleIntermediaire || 'OREOLE ASSURANCES'), 'Adresse Postale', texte(q.AdresseClient))}
      ${ligne('Gestionnaire Santé', texte(d.detail.gestionnairesante || 'VITALIS SANTE'), 'Adresse Mail', texte(q.EmailClient))}
      ${ligne('Type de Client', texte(q.TypeAssure || 'Personne Physique'), 'Numéro Mobile', texte(q.MobileClient || q.TelephoneClient))}
      ${ligne('Option', texte(d.option), physique ? 'Adresse Géographique' : 'Localisation', texte(q.AdresseGeographique))}
    </table>
    <table class="periode"><tr>
      <td>Date d'effet : <b>${date(q.DateEffet)}</b></td><td>Date d'écheance : <b>${date(q.DateExpiration)}</b></td><td>Durée : <b>${duree} Mois</b></td>
    </tr></table>
    <table class="primes">
      <tr>${ajustement ? `<td>Prime Nette avant ajustement</td><td>${libelleAjustement(d.bordereau.TauxAjustement)}</td>` : ''}<td>Prime Nette</td><td>Accessoires</td><td>Taxe</td><td>Frais de Gestion</td><td>Prime TTC</td></tr>
      <tr>${ajustement ? `<td>${montant(d.bordereau.Recap.PrimeNetteAvantAjustement)}</td><td>${ajustement < 0 ? '- ' : '+ '}${montant(Math.abs(ajustement))}</td>` : ''}<td>${montant(q.PrimeNetteHorsFga ?? q.PrimeNette)}</td><td>${montant(q.Accessoire)}</td><td>${montant(q.TaxeEnregistrement)}</td><td>${montant(q.FraisGestion)}</td><td>${montant(q.PrimeTtc)}</td></tr>
    </table>
    ${mentionAvenants(d.periode)}
    <div class="rubrique">OBJET DU CONTRAT</div>
    <p><b>MINÉNÉ SANTÉ</b> est une offre composée de 3 produits d’assurances indissociables les uns des autres.<br />
    Se sont :<b>L’assurance Santé, L’assurance Individuelle, L’assurance Responsabilité Civile chef de famille</b></p>
    <div class="rubrique">NATURE DES GARANTIES</div>
    <p><b>MINÉNÉ SANTÉ</b> donne droit aux garanties suivantes conformément au barème en annexe :</p>
    <p><b>Au titre de la santé :</b></p>
    <p>- Le remboursement des frais engagés par l’Assuré pour les actes ci-après : Frais Médicaux, Frais Pharmaceutiques, Frais d’Hospitalisation, Frais Chirurgicaux, Frais de Soins Dentaires, Frais d’Optique, Frais d’Examens Médicaux</p>
    <p><b>Au titre de l’individuelle accident :</b></p>
    <p>- Le paiement à l’assuré principal d’une indemnité déterminé en fonction du <b>taux d’incapacité retenu par le Médecin- Expert en cas d’incapacité partielle.</b></p>
    <p>- Le paiement d’une indemnité de ${enLettres(r.ia.ipt)} <b>à l’Assuré principal en cas d’incapacité permanente totale</b> à la suite d’un accident survenu après la prise d’effet du contrat;</p>
    <p>- Le paiement d’un capital de ${enLettres(r.ia.deces)} aux ayants-droits ou au bénéficiaire désigné au contrat conformément à la liste en annexe en cas de <b>décès par accident de l’assuré principal.</b></p>
    <p><b>Au titre de la Responsabilité Civile Chef de Famille :</b></p>
    <p>- La prise en charge des conséquences pécuniaires de la Responsabilité Civile délictuelle ou quasi-délictuelle pouvant incomber à l’assuré principal, Chef de Famille, en vertu des articles 1382 à 1386 du Code Civil, en raison des Dommages Corporels, Matériels et Immatériels consécutifs à des dommages couverts causés aux tiers par un accident dont l’assuré lui-même, son conjoint, ses enfants mineurs ou enfants à charge poursuivant des études, le personnel de maison, les choses ou animaux qu’il a sous sa garde sont responsables.</p>
    <div class="rubrique">EFFET ET DUREE DU CONTRAT</div>
    <p>Conformément à l’article 13 Nouveau du code CIMA, la prise d’effet du contrat est subordonnée au paiement intégral de la prime correspondante.<br />
    Le présent contrat prend effet à sa souscription au <b>${date(q.DateEffet)}.</b><br />
    Son échéance est fixée au <b>${date(q.DateExpiration)}.</b> Il se renouvellera au <b>${lendemainEnLettres(q.DateExpiration) || `1er janvier ${annee(q.DateEffet) + 1}`}</b> à zéro heure pour une durée de 12 mois.</p>
    <p><b>Il est convenu d’accord partie que le barème en annexe fait partie intégrante des présentes conditions particulières.</b></p>`;
  const page2 = `
    <div class="rubrique">DELAI DE CARENCE</div>
    <p>• <b>${mois(r.carence.soinsCourants)}</b> mois pour les soins courants (consultations, pharmacie, analyse biologique et radiologique)<br />
    • <b>${mois(r.carence.soinsDentaires)}</b> mois pour les soins dentaires<br />
    • <b>${mois(r.carence.optique)}</b> mois pour les frais de lunetteries et d’optique médicale<br />
    • <b>${mois(r.carence.maternite)}</b> mois pour la maternité (assuré(e) ou conjoint(e)s)<br />
    • <b>${mois(r.carence.protheses)}</b> mois pour les prothèses dentaires (autres prothèses)<br />
    • <b>${mois(r.carence.maladiesChroniques)}</b> mois pour toute maladie chronique : maladie du foie et des voies biliaires, du rein et des voies urinaires, des yeux (cataracte, glaucome, etc.) du sang, maladies cardiovasculaires, des ganglions, du système nerveux, des glandes endocrines (diabète, thyroïde, pancréas, etc.), végétations, myxomatose utérine, tumeurs, etc., si elle survient pour la première fois pendant la période de garantie.</p>
    <div class="rubrique">ASSURÉS BENEFICIARES DES GARANTIES</div>
    <p>Sont assurées au titre de la présente police, les personnes figurant sur la liste jointe en annexe, ayant rempli et retourné à <b>OREOLE ASSURANCES</b> pour visa, un bulletin d'adhésion.</p>
    <p>Cette liste peut être modifiée en cours de contrat <b>pour les formules Famille et Famille Plus</b> par :</p>
    <p>• Incorporation, après accord préalable de la Compagnie sur le <b>bulletin d'adhésion dûment rempli</b> et paiement intégral ou au moins 50% de la prime d'incorporation avant l'émission.</p>
    <p>• Retrait, suite à la notification écrite du Souscripteur à l'Assureur avec retour de la carte d'assuré en cas de tiers payant, <b>étant précisé que les retraits ne donnent pas lieu au versement d'une ristourne.</b></p>
    <div class="rubrique">BENEFICIAIRES</div>
    <p>Pourra bénéficier des garanties de <b>MINÉNÉ SANTÉ</b> Toute personne vivant en Côte d’Ivoire et âgée de ${r.surprimes.ageMaxAdulte} maximum pour les adultes <b>conformément au barème annexé</b> et de ${r.surprimes.ageMaxEnfant} an maximum pour les enfants. Toutefois cet âge peut être porté à ${r.surprimes.ageMaxEnfantCertificat} ans sur <b>présentation du certificat de scolarité de l’année de l’assurance ou un rapport médical pour l’enfant en situation de handicap réduisant totalement sa mobilité</b></p>
    <p><b>Les pièces à fournir pour la souscription sont :</b><br />
    • Adulte : 01 photo d’identité + 01 copie de la Carte Nationale d’Identité<br />
    • Enfant : 01 photo d’identité + 01 copie de l’extrait d’acte de naissance<br />
    • Un bulletin d’adhésion dument renseigné et signé</p>
    <div class="rubrique">SURPRIMES POUR RISQUES AGGRAVÉS</div>
    <p>Les maladies antérieures à la date d’effet du contrat sont exclues. Toutefois, elles peuvent être couvertes par la présente police moyennant surprime pour risque aggravé après avis du médecin conseil.</p>
    <p><b>Un taux de ${nombre(r.surprimes.affection)}%</b> de surprime sera appliqué pour chaque affection chronique, avec un maximum de ${r.surprimes.affectionsMax} affections acceptées.</p>
    <p>Par conséquent la prime serait susceptible de changer après analyses et le prospect en sera informé pour validation.</p>
    <div class="rubrique">CLAUSE D’AJUSTEMENT APPLICABLE AUX CONTRATS D’ASSURANCE SANTÉ</div>
    <p>Les primes santé feront l'objet, dans les conditions fixées ci-après, d'un ajustement calculé selon le rapport Sinistres / Primes (S/P) définitif au 30 septembre de l'exercice, majoré de la simulation rapportée au 4ème trimestre, déterminé au plus tard dans un délai de 2 mois après cette échéance, dans lequel :</p>
    <p>- Les Sinistres (S) représentent le montant total <b>des factures des dépenses de santé réglées aux prestataires, sur 12 mois,</b> pendant la période du 1er janvier au 30 septembre de l’année n + une extrapolation sur le dernier trimestre de l’année N en tenant compte de la tendance</p>`;
  // Clause d'ajustement réglée : « de x à y : » comme sur cp_MINENE.pdf
  const lignesClause = r.clause.map(({ rapport, ajustement }) => [/^de\s/i.test(rapport) && !/:\s*$/.test(rapport) ? `${rapport} :` : rapport, ajustement]);
  const page3 = `
    <p>- Les les Primes (cotisations) (P) représentent le montant total des primes nettes de taxes et de frais ; émises pendant la période du 1er janvier au 31 décembre de l’année de l'exercice N. Cet Ajustement est effectué sur les bases suivantes :</p>
    <table class="ajustement">
      <tr><td>Rapport S/P de :</td><td>Pourcentage d'ajustement</td></tr>
      ${lignesClause.map(([sp, ajustement]) => `<tr><td>${texte(sp)}</td><td>${texte(ajustement)}</td></tr>`).join('')}
    </table>
    <p>L'ajustement est calculé <b>à la fin de chaque exercice d'assurance fixée au 31 décembre.</b><br />
    La modification des primes résultant de l'application de la présente clause d'ajustement est notifiée par l'assureur au Souscripteur, <b>au plus tard le 30 novembre de l’année de l’exercice</b> en cours et doit s'appliquer dès le <b>1er janvier de l'exercice suivant.</b><br />
    Si le Souscripteur refuse le nouveau montant de primes ainsi ajusté, le contrat sera résilié de plein droit et sans autre avis, à la date d'échéance fixée aux conditions particulières. <b>Soit le 1er janvier de l’année N+1.</b></p>
    <div class="rubrique">SYSTEME DE PRISE EN CHARGE DES FRAIS EXPOSES</div>
    <p>D'un commun accord entre les Parties, il est convenu que les assurés seront pris en charge selon le système " tiers payant " à charge pour eux de s’adresser au réseau de prestataires conventionnés par ${texte(d.detail.gestionnairesante || 'VITALIS SANTÉ')}, dont liste jointe</p>
    <p>Sur présentation de leur carte, ils s’acquitteront du ticket modérateur tel que prévu au contrat</p>
    <p><b>Lorsqu’ils s’adresseront à des prestataires non conventionnés, ils devront s’acquitter des frais et seront remboursés par l’assureur sur présentation des justificatifs selon les termes et dans les limites prévues au contrat.</b></p>
    <p>Il en sera de même lorsque :<br /><b>- Le taux de sinistralité de l’Assuré atteint le seuil de ${nombre(r.gestion.seuilSinistralite)}%</b><br />
    - L’assuré ne sera pas à jour du paiement de ses primes. Il ne pourra dans ce cas prétendre au remboursement des frais engagés qu’après paiement intégrale de la prime.</p>
    <p>Les demandes de remboursement doivent être adressées à OREOLE ASSUANCES dans un délai maximum de trois (3) mois après le dépôt des pièces justificatives. Ou alors directement sur la plateforme de ${texte(d.detail.gestionnairesante || 'VITALIS SANTÉ')} pour remboursement dans un délai de 72H.</p>
    <p>Les frais médicaux exposés par l'Assuré hors les centres conventionnés seront remboursés à hauteur du taux de couverture de l'assuré et dans la limite des plafonds définis dans la présente police et ce sur présentation des justificatifs acquittés (note d'honoraires, factures acquittées normalisées, tickets de caisse, etc.) dans un délai maximum de trois (3) jours (72 h) ouvrés après le dépôt des pièces justificatives.</p>
    <div class="signatures"><div>LE SOUSCRIPTEUR</div><div>LA COMPAGNIE</div></div>`;
  return [page(page1), page(page2), page(page3)];
};

// ------------------------------------------------------------------ Barème
// Plafonds de soins de la formule (Réglages Santé MINENE) : une section SANTÉ par barème différent
// parmi les formules du devis (options du document OREOLE 80 %, une seule pour le 70 %-80 %)
const CHAMPS_BAREME = ['TauxSoinsExternes', 'TauxHospitalisation', 'ChambreParJour', 'AmbulanceParCas', 'AccouchementSimple',
  'AccouchementGemellaire', 'AccouchementChirurgical', 'AccouchementHorsStructure', 'OptiqueAdulte', 'OptiqueEnfant',
  'DentaireParPersonne', 'PlafondAnnuel'];
const personnes = (f) => (Number(f.PersonnesMin) === Number(f.PersonnesMax) || !f.PersonnesMin
  ? `${f.PersonnesMax} personne${Number(f.PersonnesMax) > 1 ? 's' : ''}` : `${f.PersonnesMin} à ${f.PersonnesMax} personnes`);

const sectionsSante = (d) => {
  const ids = d.formules?.length ? d.formules : [Number(d.detail?.idoffre) || 0];
  const groupes = [];
  // Dans l'ordre des options (SOLO, FAMILLE, FAMILLE PLUS), pas dans celui de la saisie des familles
  ids.map((id) => formuleSante(id)).filter(Boolean).sort((a, b) => (a.Ordre ?? 0) - (b.Ordre ?? 0)).forEach((f) => {
    const cle = CHAMPS_BAREME.map((c) => Number(f[c])).join('|');
    const g = groupes.find((x) => x.cle === cle);
    if (!g) groupes.push({ cle, formules: [f] });
    else if (!g.formules.some((x) => x.Option === f.Option)) g.formules.push(f);
  });
  return groupes;
};

const pageBareme = (d) => {
  const r = reglagesMinene();
  const s = r.surprimes;
  const l = (libelle, valeur) => `<tr><td>${libelle}</td><td>${valeur}</td></tr>`;
  const sante = (f, titre) => `
      <tr class="section"><td colspan="2">${texte(titre)}</td></tr>
      ${l('Taux de couverture assurance Maladie', `${nombre(f.TauxSoinsExternes)} % soins externes et ${nombre(f.TauxHospitalisation)} % frais d'hospitalisations`)}${l('Etendue territoriale', texte(r.gestion.etendue))}
      ${l('Plafond de remboursements :<br /><br />Frais de chambre en hospitalisation<br />Frais de transport en ambulance/SAMU<br />Frais d\'accouchement simple normal<br />Frais d\'accouchement gémellaire normal<br />Frais d\'accouchement par voie chirurgicale<br />Forfait accouchement hors structure privée',
    `<br /><br />${montant(f.ChambreParJour)} F CFA par jour<br />${montant(f.AmbulanceParCas)} F CFA par cas sur accord préalable<br />${montant(f.AccouchementSimple)} F CFA par cas<br />${montant(f.AccouchementGemellaire)} F CFA par cas<br />${montant(f.AccouchementChirurgical)} F CFA par cas<br />${montant(f.AccouchementHorsStructure)} F CFA par cas`)}
      ${l('Frais d\'optique', `${montant(f.OptiqueAdulte)} F CFA/Adulte &amp; ${montant(f.OptiqueEnfant)} F CFA/enfant chaque ${r.gestion.optiquePeriodicite} ans`)}
      ${l('Frais de soins et de prothèse dentaire', `${montant(f.DentaireParPersonne)} F CFA/an/personne avec accord pour les prothèses`)}
      ${l('Plafond annuel :<br /><br />Par famille toutes prestations confondue', `${montant(f.PlafondAnnuel)} F CFA<br /><br />(Il s'agit de la garantie maximale annuelle que prendra en charge l'assureur pour l'assuré et sa famille. Et non ce que l'assuré a le droit d'exposer comme frais)`)}
      ${l('Quota d\'alerte automatique', `A partir du ${r.gestion.quotaBons} ème bon de prise en charge<br />A partir de ${montant(r.gestion.quotaPharmacie)} F CFA de frais pharmaceutique`)}
      ${l('Surveillance du portefeuille', `Basculement systématique en mode remboursement en cours de contrat, si le taux de sinistralité du client est supérieur ou égal à <span class="rouge">${nombre(r.gestion.seuilSinistralite)} %</span>`)}`;
  const groupes = sectionsSante(d);
  const santes = groupes.length <= 1
    ? sante(groupes[0]?.formules[0] || formuleSante(17) || {}, 'SANTE')
    : groupes.map((g) => sante(g.formules[0], `SANTE - OPTION ${g.formules.map((f) => `${f.Option} : ${personnes(f)}`).join(' / ')}`)).join('');
  return page(`
    <div class="titre-bareme">BAREME</div>
    <table class="bareme">
      <tr class="section"><td colspan="2">CAPITAL INDIVIDUELLE-ACCIDENTS</td></tr>
      ${l('Décès', `${montant(r.ia.deces)} F CFA`)}${l('IPT', `${montant(r.ia.ipt)} F CFA`)}${l('Frais Médicaux', `${montant(r.ia.fraisMedicaux)} F CFA`)}
      <tr class="section"><td colspan="2">RC CHEF DE FAMILLE</td></tr>
      ${l('Dommages corporels', `${montant(r.rc.corporels)} Franchise néant`)}${l('Intoxications alimentaires', `${montant(r.rc.intoxications)} Franchise néant`)}
      ${l('Dommages matériels', `${montant(r.rc.materiels)} / Franchise: ${nombre(r.rc.franchiseTaux)}% minimum ${montant(r.rc.franchiseMin)} &amp; maximum ${montant(r.rc.franchiseMax)}`)}
      ${santes}
      ${l('DELAIS DE CARENCE', `- Les délais de carence sont les suivants<br />- <span class="rouge">${mois(r.carence.soinsCourants)}</span> mois pour les soins courants (consultations, pharmacie, analyse biologique et radiologique) ;<br />- ${mois(r.carence.soinsDentaires)} mois pour les soins dentaires<br />- ${mois(r.carence.optique)} mois pour la lunetterie (verres et montures);<br />- ${mois(r.carence.maternite)} mois pour la maternité (assuré(e) ou conjoint(e)s)<br />- ${mois(r.carence.protheses)} mois pour les prothèses dentaires (autres prothèses)<br />- ${mois(r.carence.maladiesChroniques)} mois pour toutes les maladies chroniques (autres prothèses)`)}
      ${l(`Surprime pour chaque affection chronique. (Maxi ${s.affectionsMax} affections)`, `<span class="rouge">${nombre(s.affection)} %</span>`)}
      ${l(`Surprime d'âge : de ${s.age1Debut} à ${s.age2Debut} ans`, `<span class="rouge">${nombre(s.age1Taux)} %</span>`)}
      ${l(`Surprime d'âge : de ${s.age2Debut} à ${s.ageMaxAdulte} ans`, `<span class="rouge">${nombre(s.age2Taux)} %</span>`)}
    </table>`);
};

// ------------------------------------------------------------------ Liste des assurés (affiliés)
const pageAffilies = (d) => {
  const q = d.quittance || {};
  const affilies = d.affilies || [];
  const plusieursFormules = new Set(Object.values(d.formuleAdherent).map((f) => f.id)).size > 1;
  let famille = null;
  const lignes = affilies.map((a) => {
    let entete = '';
    if (Number(a.idadherent) !== famille) {
      famille = Number(a.idadherent);
      const formule = d.formuleAdherent[famille];
      entete = plusieursFormules && formule ? `<tr class="famille"><td colspan="5">${texte(formule.libelle)}</td></tr>` : '';
    }
    return `${entete}<tr><td>${texte(a.lienparente || a.lien)}</td><td>${texte(a.nom)}</td><td>${texte(a.prenom)}</td><td>${date(a.datenaissance)}</td><td>${texte(a.numerocmu)}</td></tr>`;
  }).join('');
  return page(`
    <div class="titre-liste">LISTE DES ASSURÉS - ${q.NumeroPolice ? 'POLICE' : 'DEVIS'} N° ${texte(q.NumeroPolice || q.NumeroDevis)}</div>
    <p><b>Souscripteur :</b> ${texte(q.NomClient)} &nbsp;-&nbsp; <b>Option :</b> ${texte(d.option)}</p>
    ${mentionAvenants(d.periode, 'Liste à jour')}
    <table class="liste">
      <tr><th>Statut</th><th>Nom</th><th>Prénoms</th><th>Date de naissance</th><th>Numéro CMU</th></tr>
      ${lignes || '<tr><td colspan="5">Aucun affilié enregistré pour ce devis.</td></tr>'}
    </table>`);
};

// ------------------------------------------------------------------ Bordereau des primes par assuré
// Modèle de l'état des assurés de la compagnie (une ligne par personne, récapitulatif de la liste), avec la réduction
// ou la majoration de l'année (taux d'ajustement de la clause S/P) : sante.utils.bordereau_primes_sante
const libelleAjustement = (taux) => (Number(taux) < 0 ? `Réduction ${nombre(-taux)} %` : Number(taux) > 0 ? `Majoration ${nombre(taux)} %` : 'Réduction / majoration');
const pageBordereau = (d) => {
  const q = d.quittance || {};
  const b = d.bordereau || { Lignes: [], Recap: {} };
  const r = b.Recap || {};
  const avecAge = b.Minene;
  const avecAjustement = b.Minene && (Number(b.TauxAjustement) !== 0 || Number(r.Ajustement) !== 0);
  const somme = (cle) => b.Lignes.reduce((t, l) => t + Number(l[cle] || 0), 0);
  const m = (x, vide = '-') => (Number(x) ? montant(x) : vide);
  const lignes = b.Lignes.map((l) => `<tr class="${l.Lien === 'A' ? 'principal' : ''}">
      <td>${l.Numero}</td><td>${texte(l.Carte)}</td><td>${texte(l.Filiation)}</td><td>${texte(l.Formule)}</td>
      <td>${texte(l.Nom)}</td><td>${texte(l.Prenoms)}</td><td>${date(l.DateNaissance)}</td><td>${texte(l.Sexe)}</td><td>${date(l.DateEntree)}</td>
      <td class="m">${m(l.PrimeBase)}</td>${avecAge ? `<td class="m">${m(l.SurprimeAge)}</td>` : ''}<td class="m">${m(l.SurprimeAffection)}</td>
      ${avecAjustement ? `<td class="m">${Number(l.Ajustement) ? (Number(l.Ajustement) < 0 ? '- ' : '+ ') + montant(Math.abs(l.Ajustement)) : '-'}</td>` : ''}
      <td class="m"><b>${m(l.PrimeNette)}</b></td></tr>`).join('');
  const colonnesIdentite = 9;
  // Récapitulatif : prime avant ajustement et ajustement seulement si le détail retrouve la prime enregistrée
  const ajustementRecap = Number(r.Ecart) ? 0 : Number(r.Ajustement) || 0;
  // Option : formules des couvertures des familles (celle de l'en-tête du devis peut différer)
  const formules = [...new Set(b.Lignes.map((l) => l.LibelleOffre).filter(Boolean))];
  const option = formules.length === 1 ? formules[0] : formules.length > 1 ? 'VOIR LISTE' : d.option;
  return page(`
    <div class="titre-liste">BORDEREAU RÉCAPITULATIF DES PRIMES PAR ASSURÉ</div>
    <table class="cadre entete"><tr>
      <td><b>Souscripteur :</b> ${texte(q.NomClient)}<br /><b>Compagnie :</b> ${texte(q.RaisonSociale)}<br /><b>Option :</b> ${texte(option)}</td>
      <td><b>${q.NumeroPolice ? 'Police' : 'Devis'} N° :</b> ${texte(q.NumeroPolice || q.NumeroDevis || b.NumeroDevis)}<br />
        <b>Période :</b> du ${date(q.DateEffet)} au ${date(q.DateExpiration)}<br /><b>Intermédiaire :</b> ${texte(q.LibelleIntermediaire || 'OREOLE ASSURANCES')}</td>
    </tr></table>
    <table class="bordereau" style="margin-top:8px">
      <tr><th>N°</th><th>N° carte</th><th>Filiation</th><th>Formule</th><th>Nom</th><th>Prénoms</th><th>Date de naissance</th><th>Sexe</th>
        <th>Date d'entrée</th><th>${b.Minene ? 'Prime de base' : 'Prime nette'}</th>${avecAge ? "<th>Surprime d'âge</th>" : ''}
        <th>${b.Minene ? 'Surprime affection' : 'Surprime'}</th>${avecAjustement ? `<th>${libelleAjustement(b.TauxAjustement)}</th>` : ''}<th>Prime nette totale</th></tr>
      ${lignes || `<tr><td colspan="${colonnesIdentite + 3 + (avecAge ? 1 : 0) + (avecAjustement ? 1 : 0)}">Aucun assuré enregistré.</td></tr>`}
      <tr class="total"><td colspan="${colonnesIdentite}" style="text-align:center">TOTAL</td><td class="m">${montant(somme('PrimeBase'))}</td>
        ${avecAge ? `<td class="m">${montant(somme('SurprimeAge'))}</td>` : ''}<td class="m">${montant(somme('SurprimeAffection'))}</td>
        ${avecAjustement ? `<td class="m">${ajustementRecap < 0 ? '- ' : '+ '}${montant(Math.abs(ajustementRecap))}</td>` : ''}<td class="m">${montant(somme('PrimeNette'))}</td></tr>
    </table>
    ${b.PrimeGlobale ? '<p><b>Prime globale :</b> la prime nette du contrat n\'est pas ventilée par assuré ; seules les surprimes individuelles figurent ci-dessus.</p>' : ''}
    <div class="recap">
      <table class="cadre">
        <tr class="titre"><td>Effectif total</td><td class="m">${r.Effectif || 0}</td></tr>
        <tr><td><i>dont</i> Assurés principaux</td><td class="m">${r.AssuresPrincipaux || '-'}</td></tr>
        <tr><td>Conjoints</td><td class="m">${r.Conjoints || '-'}</td></tr>
        <tr><td>Enfants</td><td class="m">${r.Enfants || '-'}</td></tr>
      </table>
      <table class="cadre">
        ${ajustementRecap ? `<tr><td>Prime nette avant ajustement</td><td class="m">${montant(Number(r.PrimeNette) - ajustementRecap)}</td></tr>
        <tr><td>${libelleAjustement(b.TauxAjustement)}</td><td class="m">${ajustementRecap < 0 ? '- ' : '+ '}${montant(Math.abs(ajustementRecap))}</td></tr>` : ''}
        ${b.Avenant ? `
        <tr><td>PRIME NETTE ANNUELLE - nouvelle composition</td><td class="m">${montant(r.PrimeNette)}</td></tr>
        <tr><td>Prime annuelle avant modification</td><td class="m">${montant(b.Avenant.PrimeAnnuellePrecedente)}</td></tr>
        <tr class="titre"><td colspan="2">AVENANT DU ${date(b.Avenant.DateEffet)} AU ${date(b.Avenant.DateExpiration)} - ${b.Avenant.Jours} j sur ${b.Avenant.JoursPeriode}</td></tr>
        <tr><td>PRIME NETTE DE L'AVENANT</td><td class="m">${montant(b.Avenant.PrimeNette)}</td></tr>
        <tr><td>ACCESSOIRES</td><td class="m">${montant(b.Avenant.Accessoire)}</td></tr>
        <tr><td>TAXES</td><td class="m">${montant(b.Avenant.Taxe)}</td></tr>
        <tr class="titre"><td>PRIME TTC DE L'AVENANT</td><td class="m">${montant(b.Avenant.PrimeTtc)}</td></tr>` : `
        <tr><td>PRIME NETTE TOTALE</td><td class="m">${montant(r.PrimeNette)}</td></tr>
        <tr><td>ACCESSOIRES</td><td class="m">${montant(r.Accessoire)}</td></tr>
        <tr><td>TAXES</td><td class="m">${montant(r.Taxe)}</td></tr>
        ${Number(r.FraisGestion) ? `<tr><td>FRAIS DE GESTION</td><td class="m">${montant(r.FraisGestion)}</td></tr>` : ''}
        <tr class="titre"><td>PRIME TTC</td><td class="m">${montant(r.PrimeTtc)}</td></tr>`}
      </table>
    </div>
    ${Number(r.Ecart) ? `<div class="ecart">Écart de ${montant(r.Ecart)} F entre la prime nette enregistrée (${montant(r.PrimeNette)} F) et le détail par assuré recalculé avec le barème en vigueur (${montant(r.TotalLignes)} F) : ${q.NumeroPolice ? 'contrat émis avec un calcul antérieur' : 'enregistrez de nouveau le devis pour mettre à jour ses primes'}.</div>` : ''}`);
};

// ------------------------------------------------------------------ État des cotisations MINENE Santé
// Modèle d'OREOLE « ETATS DES COTISATIONS MINENE SANTE » (demande du 2026-10-27) : un bloc par famille, ses montants
// fusionnés sur ses assurés ; réduction ou majoration de l'année ajoutée avant la prime nette totale ; encaissement,
// nature, solde et statut du contrat sur toutes les familles (un contrat par devis dans LE PHARE) :
// sante.utils._etat_cotisations. Récapitulatif de la prime sous le tableau.
const ETAT = `
  @page { size: A4 landscape; margin: 8mm 8mm 8mm; }
  body, .pied { max-width: 281mm; }
  .titre-etat { text-align: center; font-weight: 800; font-size: 13pt; text-decoration: underline; margin: 2px 0 8px; color: #000; }
  .titre-etat span { color: #000; }
  .reference-etat { font-size: 8pt; margin-bottom: 6px; }
  /* Grand tableau en noir sur blanc ; Encaissement et Solde sur le bleu des tableaux du récapitulatif (2026-10-27) */
  .etat th, .etat td { border: 1px solid #555; padding: 2px 3px; font-size: 6.7pt; vertical-align: middle; color: #000; background: #fff; }
  .etat th { font-weight: 700; text-align: center; font-size: 6.1pt; line-height: 1.15; }
  .etat th.bleu, .etat td.bleu { background: #1e3a5f; color: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .etat td.m { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .etat td.c { text-align: center; }
  .etat tr.total td { font-weight: 700; }
  .etat td.nature { font-size: 6.2pt; text-align: center; }
  .notes-etat { font-size: 7.5pt; margin-top: 6px; }
`;
const pageEtatCotisations = (d) => {
  const q = d.quittance || {};
  const b = d.bordereau;
  const e = b.Etat;
  const r = b.Recap || {};
  const signe = (x) => (Number(x) < 0 ? `- ${montant(Math.abs(x))}` : Number(x) > 0 ? `+ ${montant(x)}` : '0');
  const personnes = e.Familles.reduce((s, f) => s + f.Assures.length, 0);
  const contrat = Boolean(e.Contrat);
  let numero = 0;
  const lignes = e.Familles.map((f, i) => f.Assures.map((a, j) => {
    numero += 1;
    const n = f.Assures.length;
    const famille = j > 0 ? '' : `
      <td rowspan="${n}" class="c">${texte(f.Option)}</td><td rowspan="${n}" class="c">${f.Effectif}</td>
      <td rowspan="${n}" class="c">${date(e.DateEffet)} au ${date(e.DateExpiration)}</td>
      <td rowspan="${n}" class="m"><b>${montant(f.PrimeBase)}</b></td><td rowspan="${n}" class="m">${montant(f.SurprimePathologie)}</td>
      <td rowspan="${n}" class="m">${montant(f.SurprimeAge)}</td><td rowspan="${n}" class="m">${montant(f.SurprimeEnfants)}</td>
      <td rowspan="${n}" class="m">${signe(f.Ajustement)}</td><td rowspan="${n}" class="m"><b>${montant(f.PrimeNette)}</b></td>
      <td rowspan="${n}" class="m">${montant(f.PrimeTtcSante)}</td><td rowspan="${n}" class="m">${montant(f.PrimeTtcIa)}</td>
      <td rowspan="${n}" class="m">${montant(f.PrimeTtcRc)}</td><td rowspan="${n}" class="m"><b>${montant(f.PrimeTotaleTtc)}</b></td>`;
    // Encaissement, nature, solde et statut : ceux du contrat, sur toutes les familles
    const situation = i > 0 || j > 0 ? '' : `
      <td rowspan="${personnes}" class="m bleu"><b>${contrat ? montant(e.Encaissement) : '-'}</b></td>
      <td rowspan="${personnes}" class="nature">${texte(e.Nature) || '-'}</td>
      <td rowspan="${personnes}" class="m bleu"><b>${montant(e.Solde)}</b></td>
      <td rowspan="${personnes}" class="c">${texte(e.Statut)}</td>`;
    return `<tr><td class="c">${numero}</td>${j === 0 ? `<td rowspan="${n}">${texte(f.Souscripteur)}</td>` : ''}
      <td>${texte(a.Nom)}</td><td class="c">${date(a.DateNaissance)}</td>${famille}${situation}</tr>`;
  }).join('')).join('');
  const somme = (cle) => e.Familles.reduce((s, f) => s + Number(f[cle] || 0), 0);
  // Récapitulatif de la prime : réduction ou majoration seulement si le détail retrouve la prime enregistrée
  const ajustementRecap = Number(r.Ecart) ? 0 : Number(r.Ajustement) || 0;
  const adherents = e.Familles.length;
  return page(`
    <div class="titre-etat">ETATS DES COTISATIONS <span>MINENE SANTE</span> ${e.Annee || ''}</div>
    <div class="reference-etat"><b>${contrat ? 'Police' : 'Devis'} N° :</b> ${texte(e.Contrat || q.NumeroDevis || b.NumeroDevis)}
      &nbsp;·&nbsp; <b>Client :</b> ${texte(q.NomClient)} &nbsp;·&nbsp; <b>Compagnie :</b> ${texte(q.RaisonSociale)}</div>
    <table class="etat">
      <tr><th>N°Ordre</th><th>Souscripteur</th><th>Assuré</th><th>Date de naissance</th><th>Option</th><th>Effectif</th><th>Période</th>
        <th>Prime de base</th><th>Surprime pour pathologie</th><th>Surprime d'âge</th>
        <th>Surprime enfants supplémentaires</th><th>${libelleAjustement(b.TauxAjustement)}</th>
        <th>Prime nette totale</th><th>Prime TTC Santé</th><th>Prime TTC Individuelle Accidents</th>
        <th>Prime TTC RC chef de famille</th><th>Prime totale TTC</th><th class="bleu">Encaissement</th>
        <th>Nature de l'encaissement</th><th class="bleu">Solde</th><th>Statut</th></tr>
      ${lignes}
      <tr class="total"><td colspan="4" class="c">TOTAL</td><td></td><td class="c">${personnes}</td><td></td>
        <td class="m">${montant(somme('PrimeBase'))}</td><td class="m">${montant(somme('SurprimePathologie'))}</td>
        <td class="m">${montant(somme('SurprimeAge'))}</td><td class="m">${montant(somme('SurprimeEnfants'))}</td>
        <td class="m">${signe(somme('Ajustement'))}</td><td class="m">${montant(somme('PrimeNette'))}</td>
        <td class="m">${montant(somme('PrimeTtcSante'))}</td><td class="m">${montant(somme('PrimeTtcIa'))}</td>
        <td class="m">${montant(somme('PrimeTtcRc'))}</td><td class="m">${montant(somme('PrimeTotaleTtc'))}</td>
        <td class="m bleu">${contrat ? montant(e.Encaissement) : '-'}</td><td></td><td class="m bleu">${montant(e.Solde)}</td><td></td></tr>
    </table>
    <div class="recap">
      <table class="cadre">
        <tr class="titre"><td colspan="2">RÉCAPITULATIF DE LA PRIME SANTÉ</td></tr>
        ${ajustementRecap ? `<tr><td>Prime nette avant ajustement</td><td class="m">${montant(Number(r.PrimeNette) - ajustementRecap)}</td></tr>
        <tr><td>${libelleAjustement(b.TauxAjustement)}</td><td class="m">${signe(ajustementRecap)}</td></tr>` : ''}
        <tr><td>Prime nette totale</td><td class="m">${montant(r.PrimeNette)}</td></tr>
        <tr><td>Accessoires</td><td class="m">${montant(r.Accessoire)}</td></tr>
        <tr><td>Taxes</td><td class="m">${montant(r.Taxe)}</td></tr>
        ${Number(r.FraisGestion) ? `<tr><td>Frais de gestion</td><td class="m">${montant(r.FraisGestion)}</td></tr>` : ''}
        <tr class="titre"><td>PRIME TTC SANTÉ</td><td class="m">${montant(r.PrimeTtc)}</td></tr>
      </table>
      <table class="cadre">
        <tr class="titre"><td colspan="2">MINENE SANTÉ : ${adherents} adhérent${adherents > 1 ? 's' : ''}, ${personnes} assuré${personnes > 1 ? 's' : ''}</td></tr>
        <tr><td>Prime TTC Santé</td><td class="m">${montant(somme('PrimeTtcSante'))}</td></tr>
        <tr><td>Prime TTC Individuelle Accidents</td><td class="m">${montant(somme('PrimeTtcIa'))}</td></tr>
        <tr><td>Prime TTC RC chef de famille</td><td class="m">${montant(somme('PrimeTtcRc'))}</td></tr>
        <tr class="titre"><td>PRIME TOTALE TTC</td><td class="m">${montant(somme('PrimeTotaleTtc'))}</td></tr>
        ${contrat ? `<tr><td>Encaissement</td><td class="m">${montant(e.Encaissement)}</td></tr>` : ''}
        <tr><td><b>Solde</b></td><td class="m">${montant(e.Solde)}</td></tr>
      </table>
    </div>
    ${Number(r.Ecart) ? `<div class="ecart">Écart de ${montant(r.Ecart)} F entre la prime nette enregistrée (${montant(r.PrimeNette)} F) et le détail par famille recalculé avec le barème en vigueur (${montant(r.TotalLignes)} F) : ${contrat ? 'contrat émis avec un calcul antérieur ; la prime TTC Santé facturée est répartie entre les familles' : 'enregistrez de nouveau le devis pour mettre à jour ses primes'}.</div>` : ''}`);
};

// ------------------------------------------------------------------ Facture MINENE
// Facture des trois assurances indissociables de l'offre (Santé, Individuelle Accidents, RC chef de famille), au
// modèle de la facture de prime OREOLE, avec les coordonnées du client et le récapitulatif de l'état des cotisations
// (demande du 2026-10-28) : mêmes montants que l'état, IA et RC au forfait MINENE par adhérent.
const FACTURE = `
  .fm-titre { text-align: center; font-weight: 700; font-size: 13pt; margin: 4mm 0 2mm; }
  .fm-objet { text-align: center; font-weight: 700; font-size: 10pt; margin: 0 0 5mm; }
  .fm-proforma { text-align: center; font-size: 8.5pt; margin: -3mm 0 4mm; }
  .fm-table td, .fm-table th { border: 0.75pt solid #222; padding: 2mm 1.5mm; text-align: center; vertical-align: middle; font-size: 9pt; }
  .fm-table th { font-weight: 700; background: #f1f5f9; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .fm-table td.cie { text-align: left; padding-left: 2mm; }
  .fm-table td.pers { text-align: left; line-height: 1.45; padding: 3mm; font-size: 9pt; }
  .fm-table td.pers b { font-size: 9.5pt; }
  .fm-table td.v { font-weight: 700; }
  .fm-familles { margin-top: 5mm; }
  .fm-familles td, .fm-familles th { border: 0.75pt solid #555; padding: 1.5mm; font-size: 8.5pt; }
  .fm-familles th { background: #f1f5f9; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .fm-familles td.m { text-align: right; white-space: nowrap; }
  .fm-recap { width: 62%; margin: 6mm 0 0 auto; border: 1px solid #555; }
  .fm-recap td { padding: 1.6mm 3mm; font-size: 10pt; }
  .fm-recap td.m { text-align: right; font-weight: 700; white-space: nowrap; }
  .fm-recap tr.titre td { background: #1e3a5f; color: #fff; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .fm-recap tr.solde td { font-weight: 700; border-top: 1px solid #555; }
  .fm-texte { margin: 6mm 0 0; line-height: 1.4; font-size: 10pt; }
  .fm-cima { margin-top: 4mm; font-size: 8.5pt; font-style: italic; }
  .fm-fait { text-align: right; margin-top: 8mm; font-size: 10pt; }
  .fm-signe { text-align: right; margin: 5mm 14mm 0 0; font-weight: 700; font-size: 10pt; }
`;
// Valeur d'un champ du client : les valeurs de remplissage des fiches (« - », « NA ») ne sont pas imprimées
const renseigne = (x) => {
  const v = String(x ?? '').trim();
  return /^(-+|NA|N\/A|NEANT|NÉANT|\.)$/i.test(v) ? '' : v;
};
const pageFactureMinene = (d) => {
  const q = d.quittance || {};
  // Avenant : sa date d'incorporation, effet et « Fait à », la date d'émission n'est pas imprimée (demande du 2026-11-03).
  // Sinon la date d'émission, la même à chaque impression et sur les autres documents de la police.
  const avenant = d.periode && !d.periode.EstBase ? (d.periode.Mouvements || []).find((m) => m.IdContrat === d.periode.IdContrat) : null;
  const e = d.bordereau.Etat;
  const contrat = Boolean(e.Contrat);
  const somme = (cle) => e.Familles.reduce((s, f) => s + Number(f[cle] || 0), 0);
  const total = somme('PrimeTotaleTtc');
  const personnes = e.Familles.reduce((s, f) => s + f.Assures.length, 0);
  const adherents = e.Familles.length;
  const coordonnees = (nom, adresse, telephone, email, extra = []) => [
    nom && `<b>${texte(nom)}</b>`,
    ...extra,
    renseigne(adresse) && texte(adresse),
    renseigne(telephone) && `Tél. : ${texte(telephone)}`,
    renseigne(email) && texte(email),
  ].filter(Boolean).join('<br/>');
  const telephoneClient = [renseigne(q.MobileClient), renseigne(q.TelephoneClient)].filter(Boolean).filter((t, i, l) => l.indexOf(t) === i).join(' / ');
  const souscripteur = coordonnees(q.NomClient, renseigne(q.AdresseClient) || renseigne(q.AdresseGeographique), telephoneClient, q.EmailClient,
    [renseigne(q.ProfessionClient) && texte(q.ProfessionClient)]);
  const memePersonne = !renseigne(q.NomAssure) || String(q.NomAssure).trim() === String(q.NomClient || '').trim();
  const assure = memePersonne ? souscripteur : coordonnees(q.NomAssure, q.AdresseAssure, '', '');
  const polices = (liste, prevue) => (liste?.length ? liste.map(texte).join(', ') : prevue);
  const numero = q.NumeroFacture || q.NumeroPolice || q.NumeroDevis || d.bordereau.NumeroDevis || '';
  const lettres = numberToFrenchWords(Math.round(total));
  const familles = adherents > 1 ? `
    <table class="fm-familles">
      <tr><th>Adhérent</th><th>Option</th><th>Assurés</th><th>Prime TTC Santé</th><th>Prime TTC IA</th><th>Prime TTC RC</th><th>Prime totale TTC</th></tr>
      ${e.Familles.map((f) => `<tr><td>${texte(f.Souscripteur)}</td><td>${texte(f.Option)}</td><td class="m">${f.Effectif}</td>
        <td class="m">${montant(f.PrimeTtcSante)}</td><td class="m">${montant(f.PrimeTtcIa)}</td><td class="m">${montant(f.PrimeTtcRc)}</td>
        <td class="m"><b>${montant(f.PrimeTotaleTtc)}</b></td></tr>`).join('')}
    </table>` : '';
  return page(`
    <div class="fm-titre">FACTURE MINENE N° ${texte(numero)}</div>
    <div class="fm-objet">MINENE SANTÉ : SANTÉ, INDIVIDUELLE ACCIDENTS ET RESPONSABILITÉ CIVILE CHEF DE FAMILLE</div>
    ${contrat ? '' : `<div class="fm-proforma">Facture proforma du devis N° ${texte(q.NumeroDevis || d.bordereau.NumeroDevis)}, non encore confirmé en contrat</div>`}
    <table class="fm-table">
      <colgroup><col style="width:20%"/><col style="width:16%"/><col style="width:16%"/><col style="width:16%"/><col style="width:16%"/><col style="width:16%"/></colgroup>
      <tr><td class="cie" colspan="6">Compagnie : <b>${texte(q.RaisonSociale)}</b> &nbsp;·&nbsp; Intermédiaire : <b>${texte(q.LibelleIntermediaire || nomCabinet())}</b></td></tr>
      <tr><th colspan="3">SOUSCRIPTEUR</th><th colspan="3">ASSURÉ PRINCIPAL</th></tr>
      <tr><td class="pers" colspan="3">${souscripteur}</td><td class="pers" colspan="3">${assure}</td></tr>
      <tr><th>${contrat ? 'Police Santé' : 'Devis Santé'}</th><th>Police IA</th><th>Police RC</th><th>Effet</th><th>Échéance</th><th>Effectif</th></tr>
      <tr><td class="v">${texte(e.Contrat || q.NumeroDevis || d.bordereau.NumeroDevis)}</td>
        <td class="v">${polices(e.PolicesIa, 'À émettre')}</td><td class="v">${polices(e.PolicesRc, 'À émettre')}</td>
        <td class="v">${date(avenant?.DateEffet || e.DateEffet || q.DateEffet)}</td><td class="v">${date(e.DateExpiration || q.DateExpiration)}</td>
        <td class="v">${adherents} adh. / ${personnes} ass.</td></tr>
    </table>
    ${familles}
    <table class="fm-recap">
      <tr class="titre"><td colspan="2">MINENE SANTÉ : ${adherents} adhérent${adherents > 1 ? 's' : ''}, ${personnes} assuré${personnes > 1 ? 's' : ''}</td></tr>
      <tr><td>Prime TTC Santé</td><td class="m">${montant(somme('PrimeTtcSante'))}</td></tr>
      ${avenant ? `<tr><td>dont prime nette</td><td class="m">${montant(q.PrimeNette)}</td></tr>
      <tr><td>dont accessoire</td><td class="m">${montant(q.Accessoire)}</td></tr>
      <tr><td>dont taxes</td><td class="m">${montant(Number(q.PrimeTtc) - Number(q.PrimeNette) - Number(q.Accessoire))}</td></tr>` : ''}
      <tr><td>Prime TTC Individuelle Accidents</td><td class="m">${montant(somme('PrimeTtcIa'))}</td></tr>
      <tr><td>Prime TTC RC chef de famille</td><td class="m">${montant(somme('PrimeTtcRc'))}</td></tr>
      <tr class="titre"><td>PRIME TOTALE TTC</td><td class="m">${montant(total)}</td></tr>
      <tr><td>Encaissement</td><td class="m">${montant(contrat ? e.Encaissement : 0)}</td></tr>
      <tr class="solde"><td>Solde à payer</td><td class="m">${montant(e.Solde)}</td></tr>
    </table>
    <div class="fm-texte">Arrêtée la présente facture à la somme de <b>${texte(lettres)} FRANCS CFA</b> (${montant(total)} F CFA)${Number(e.Solde) > 0 && Number(e.Solde) !== total ? `, dont <b>${montant(e.Solde)} F CFA</b> restant à régler` : Number(e.Solde) <= 0 ? ', entièrement réglée' : ''}.</div>
    ${e.Nature ? `<div class="fm-texte">Encaissements : ${texte(e.Nature)}.</div>` : ''}
    <div class="fm-cima">Conformément à l'article 13 du Code CIMA, la prise d'effet des garanties est subordonnée au paiement intégral de la prime.</div>
    <div class="fm-texte">Dans cette attente, nous vous prions d'agréer, nos distinguées salutations.</div>
    <div class="fm-fait">Fait à ${texte(villeSignature())}, le ${date(avenant?.DateEffet || q.DateEmission) || new Date().toLocaleDateString('fr-FR')}</div>
    <div class="fm-signe">Pour la société</div>`);
};

// ------------------------------------------------------------------ Ayants droit (IA MINENE)
const pageAyantsDroit = (d) => {
  const ayants = d.ayantsDroit || [];
  // Part : colonne seulement si l'assuré en a précisé une (0 en base = non précisée)
  const avecParts = ayants.some((a) => Number(a.part) > 0);
  return page(`
    <div class="titre-liste">LISTES DES AYANT DROITS - POLICE N° ${texte(d.quittance?.NumeroPolice)}</div>
    <table class="liste">
      <tr><th>Qualité</th><th>Nom</th><th>Prénoms</th>${avecParts ? '<th>Part</th>' : ''}</tr>
      ${ayants.map((a) => `<tr><td>${texte(a.libelle_qualite)}</td><td>${texte(a.nom_ayant_droit)}</td><td>${texte(a.prenoms_ayant_droit)}</td>${avecParts ? `<td>${Number(a.part) > 0 ? `${a.part} %` : ''}</td>` : ''}</tr>`).join('')
      || `<tr><td colspan="${avecParts ? 4 : 3}">Aucun ayant droit enregistré sur l'IA MINENE de cette police.</td></tr>`}
    </table>`);
};

const DOCUMENTS = {
  cp: { titre: 'Conditions Particulieres', pages: (d) => [...pagesCp(d), pageBareme(d), pageAffilies(d)] },
  bareme: { titre: 'Bareme MINENE', pages: (d) => [pageBareme(d)] },
  affilies: { titre: 'Liste des assures', pages: (d) => [pageAffilies(d)] },
  ayants: { titre: 'Liste des ayants droit', pages: (d) => [pageAyantsDroit(d)] },
  // Facture MINENE : Santé, IA et RC chef de famille, à l'en-tête du client (récapitulatif de l'état des cotisations)
  facture: { titre: 'Facture MINENE', pages: (d) => [pageFactureMinene(d)], styles: FACTURE },
  // MINENE : état des cotisations au modèle d'OREOLE ; autres offres et avenants : bordereau par assuré
  bordereau: {
    titre: 'Bordereau des primes',
    pages: (d) => [d.bordereau?.Etat ? pageEtatCotisations(d) : pageBordereau(d)],
    styles: PAYSAGE,
  },
};

/**
 * Imprime un document Santé MINENE d'un devis ({ iddevis }) ou d'un contrat ({ idcontrat }).
 * L'aperçu d'impression est ouvert au clic et rempli à la fin de l'appel API. Renvoie false si le devis
 * n'est pas un devis MINENE et que le document lui est réservé (CP, barème) : l'appelant imprime alors
 * son document générique dans l'aperçu fourni.
 */
export const imprimerDocumentSante = async (type, ids, fenetre = ouvrirApercuImpression()) => {
  const doc = DOCUMENTS[type];
  if (fenetre) fenetre.document.write('<p style="font-family:Arial;padding:20px;">Préparation du document…</p>');
  try {
    const d = await charger(ids);
    // Bordereau des primes par assuré ; CP MINENE : réduction ou majoration de l'année au tableau des primes
    if (type === 'bordereau' || type === 'facture' || (type === 'cp' && d.minene)) {
      const idDevis = Number(d.quittance?.IdDevis || d.saisie?.devis?.iddevis || ids.iddevis) || 0;
      // Contrat : familles et primes de sa période, incorporations comprises (facture MINENE : toute la période)
      d.bordereau = await impressionSanteApi.bordereau(idDevis, ids.idcontrat ? { idcontrat: ids.idcontrat, document: type } : {}).catch((err) => {
        if (type === 'bordereau' || type === 'facture') throw err;
        return null;
      });
    }
    // Facture MINENE : seulement pour une offre MINENE dont les familles sont enregistrées
    if (type === 'facture' && !d.bordereau?.Etat) {
      if (fenetre) {
        fenetre.document.open();
        fenetre.document.write('<p style="font-family:Arial;padding:20px;">La facture MINENE ne concerne que les devis et polices MINENE SANTÉ dont les adhérents sont enregistrés.</p>');
        fenetre.document.close();
      }
      return true;
    }
    if (!d.minene && (type === 'cp' || type === 'bareme')) {
      if (type === 'bareme' && fenetre) {
        fenetre.document.open();
        fenetre.document.write('<p style="font-family:Arial;padding:20px;">Le barème MINENE ne concerne que les offres MINENE SANTÉ.</p>');
        fenetre.document.close();
      }
      return false;
    }
    // Conditions Particulières d'un devis : « Devis <n°> » (une proposition est un devis)
    // Bordereau MINENE : état des cotisations (titre et mise en page du modèle d'OREOLE)
    const etat = type === 'bordereau' && Boolean(d.bordereau?.Etat);
    const titre = type === 'cp' && !d.quittance?.NumeroPolice ? 'Devis' : etat ? 'Etat des cotisations MINENE' : doc.titre;
    const numeroDocument = type === 'facture' ? (d.quittance?.NumeroFacture || d.quittance?.NumeroPolice || d.quittance?.NumeroDevis) : null;
    const html = documentHtml(`${titre} ${numeroDocument || d.quittance?.NumeroPolice || d.quittance?.NumeroDevis || ''}`.trim(), doc.pages(d),
      etat ? `${doc.styles}${ETAT}` : doc.styles);
    if (fenetre) {
      fenetre.document.open();
      fenetre.document.write(html);
      fenetre.document.close();
    }
  } catch (err) {
    console.error('Erreur impression Santé :', err);
    if (fenetre) {
      fenetre.document.open();
      fenetre.document.write('<p style="font-family:Arial;padding:20px;color:#b91c1c;">Impossible de charger les données Santé pour ce document. Veuillez réessayer.</p>');
      fenetre.document.close();
    }
  }
  return true;
};
