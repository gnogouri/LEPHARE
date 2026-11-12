import { Car, Plane, Ship, Home, Building2, Layers, HeartHandshake, HeartPulse, UserPlus, Shield } from 'lucide-react';

/**
 * Branches de production et ce que l'administration règle pour chacune (Réglages par branche) :
 * - parametres : règles de gestion de la branche (lephare_parametre), modifiables sur sa page ;
 * - section : réglages propres affichés sur la page (Transport, IA, MRH, RC) ;
 * - pages : écrans de réglage détaillés de la branche (adresses du menu d'administration, menu: false) ;
 * - brancheCima : code de la branche CIMA (filtre de l'écran Offres).
 * Les tables communes à toutes les branches (offres, taxes, commissions, accessoires) s'ouvrent filtrées sur la branche.
 * Seules les branches dont la saisie est ouverte (Administration > Produits) apparaissent dans le menu.
 */
export const BRANCHES = [
  {
    module: 'auto', idProduit: 1, libelle: 'Automobile', icone: Car, brancheCima: '200',
    description: "Barème et montants du moteur de chaque compagnie, tarifs à lecture directe, règles entre garanties, dépréciation et âge des véhicules, Pool TPV, réductions flotte, sécurité routière, marques et listes véhicules.",
    parametres: ['devis.reduction_max_auto'],
    pages: ['/admin/settings/bareme-auto', '/admin/settings/tarifs-directs', '/admin/settings/regles-garanties', '/admin/settings/depreciation', '/admin/settings/pool-tpv',
      '/admin/settings/flotte', '/admin/settings/securite-routiere', '/admin/settings/marques', '/admin/settings/vehicle-geo'],
  },
  {
    module: 'voyage', idProduit: 3, libelle: 'Voyage', icone: Plane, brancheCima: '100',
    description: 'Primes, accessoires et taxes Voyage par compagnie, offres proposées par zone, zone de chaque pays de destination, réduction maximale.',
    parametres: ['voyage.taux_reduction_max'],
    pages: ['/admin/settings/grilles-voyage'],
  },
  {
    module: 'transport', idProduit: 6, libelle: 'Transport', icone: Ship, brancheCima: '600',
    description: 'Cotation hors GUCE : garanties et taux proposés par mode de transport, primes minimums, coûts de police, taxe, modes et listes de saisie ; part AFS-CI des bordereaux GUCE.',
    parametres: ['transport.part_afs_ci'],
    section: 'transport',
  },
  {
    module: 'mrh', idProduit: 4, libelle: 'Multirisque Habitation', icone: Home, brancheCima: '300',
    description: "Usages d'habitation : coefficients de la prime de base, garanties comprises et leur part, options et garanties à prime forfaitaire.",
    section: 'mrh',
  },
  {
    module: 'mrp', idProduit: 7, libelle: 'Multirisque Professionnelle', icone: Building2, brancheCima: '300',
    description: 'Offres, garanties, taxes et commissions de la Multirisque Professionnelle.',
  },
  {
    module: 'tous-dommages', idProduit: 9, libelle: 'Dommages', icone: Layers, brancheCima: '400',
    description: 'Caution, Tous Risques Informatiques, Chantiers, Bris de Machines… : catégories proposées, description du risque, garanties par compagnie, documents de production.',
    pages: ['/admin/settings/dommages'],
  },
  {
    module: 'sante', idProduit: 5, libelle: 'Santé', icone: HeartPulse, brancheCima: '120',
    description: 'Gestionnaire des contrats Santé, seuils du contrat groupe (Santé classique et micro) ; MINENE SANTÉ : formules, barème de soins, surprimes, IA et RC chef de famille, répartition de la prime.',
    parametres: ['sante.gestionnaire', 'sante.groupe_adherents', 'sante.groupe_affilies'],
    pages: ['/admin/settings/sante', '/admin/settings/oreole-sante'],
  },
  {
    module: 'afa', idProduit: 10, libelle: 'Vie', icone: HeartHandshake,
    description: "Offres commerciales du devis Vie : AFA et Temporaire décès, assurés avec capital, prime et bénéficiaires ; Retraite complémentaire, état mensuel des cotisations salarié et employeur. Compagnie proposée (SANLAM), commissions et accessoires de la branche.",
    section: 'vie',
  },
  {
    module: 'ia', idProduit: 2, libelle: 'Individuelle Accidents', icone: UserPlus, brancheCima: '100',
    description: "Tarif NSIA par classe d'activité, accessoires selon la prime nette, primes et capitaux des offres forfaitaires (CGA, CI-ÉNERGIES), barème des autres compagnies, clauses d'âge et d'indemnité, réduction maximale.",
    parametres: ['devis.reduction_max_ia', 'ia.nsia_age_max', 'ia.nsia_indemnite_max'],
    section: 'ia',
  },
  {
    module: 'rc', idProduit: 8, libelle: 'Responsabilité civile', icone: Shield, brancheCima: '500',
    description: "Domaines d'activité proposés à la saisie, réduction maximale ; RC chef de famille MINENE dans la branche Santé.",
    parametres: ['devis.reduction_max_rc'],
    section: 'rc',
  },
];

export const brancheDuModule = (module) => BRANCHES.find((b) => b.module === module) || null;
export const adresseBranche = (module) => `/admin/settings/branches/${module}`;
