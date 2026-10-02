// Termes du contrat (stddevis.idterme), identiques à la liste de l'API /terme/
// (configuration_api.TermeViewSet) : il n'existe pas de table en base, les ids sont fixes.
export const TERMES_CONTRAT = [
  { id: 1, libelle: 'Tacite reconduction' },
  { id: 2, libelle: 'Ferme' },
  { id: 3, libelle: 'Autre' },
];

export const ID_TERME_PAR_DEFAUT = 1;
// Terme « Autre » : la durée est libre, la date d'expiration est saisie à l'écran
export const ID_TERME_AUTRE = 3;

// Id de terme enregistrable : un id inconnu (ou absent) retombe sur Tacite reconduction
export const idTermeValide = (id) => (TERMES_CONTRAT.some((t) => t.id === Number(id)) ? Number(id) : ID_TERME_PAR_DEFAUT);

export const libelleTerme = (id) => TERMES_CONTRAT.find((t) => t.id === idTermeValide(id)).libelle;

// Durées du contrat proposées (stddevis.idduree). La durée libre (id 5, l'ancienne « Divers »)
// n'est pas dans cette liste : elle s'obtient en choisissant le terme « Autre ».
export const DUREES_CONTRAT = [
  { id: 1, mois: 1, libelle: 'Mensuelle' },
  { id: 2, mois: 3, libelle: 'Trimestrielle' },
  { id: 3, mois: 6, libelle: 'Semestrielle' },
  { id: 4, mois: 12, libelle: 'Annuelle' },
];
export const ID_DUREE_LIBRE = 5;
export const ID_DUREE_PAR_DEFAUT = 4;

export const estDureeLibre = (idDuree) => Number(idDuree) === ID_DUREE_LIBRE;

// Durée après un changement de terme : « Autre » ouvre la durée libre ; en quittant « Autre »,
// la durée redevient Annuelle (une durée standard déjà choisie est conservée)
export const dureeSelonTerme = (idTerme, idDuree) => {
  if (Number(idTerme) === ID_TERME_AUTRE) return ID_DUREE_LIBRE;
  return DUREES_CONTRAT.some((d) => d.id === Number(idDuree)) ? Number(idDuree) : ID_DUREE_PAR_DEFAUT;
};

// Terme et durée d'un devis rouvert, rendus cohérents : une durée libre (ou inconnue) va avec le
// terme « Autre », et un terme « Autre » avec une durée libre (la date d'expiration enregistrée
// est alors reprise telle quelle)
export const termeEtDureeEnregistres = (idTerme, idDuree) => {
  const dureeStandard = DUREES_CONTRAT.some((d) => d.id === Number(idDuree));
  const libre = Number(idTerme) === ID_TERME_AUTRE || (Number(idDuree) > 0 && !dureeStandard);
  if (libre) return { termeId: ID_TERME_AUTRE, dureeId: ID_DUREE_LIBRE };
  return { termeId: idTermeValide(idTerme), dureeId: dureeStandard ? Number(idDuree) : ID_DUREE_PAR_DEFAUT };
};
