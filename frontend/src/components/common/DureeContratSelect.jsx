import React from 'react';
import { DUREES_CONTRAT, ID_DUREE_LIBRE, estDureeLibre } from '../../utils/termesContrat';
import { trierParLibelle } from '../../utils/sortUtils';

// Menu « Durée du contrat » commun à tous les devis : Mensuelle, Trimestrielle, Semestrielle,
// Annuelle. Avec le terme « Autre », la durée est libre (date d'expiration saisie) : le menu est
// alors grisé. value / onChange portent l'id de durée (stddevis.idduree). idsAutorises restreint
// les durées proposées (ex. IA MINENE : Annuelle seulement).
export const DureeContratSelect = ({ value, onChange, className = 'form-control', idsAutorises = null, ...props }) => {
  const libre = estDureeLibre(value);
  const durees = idsAutorises ? DUREES_CONTRAT.filter((d) => idsAutorises.includes(d.id)) : DUREES_CONTRAT;
  return (
    <select
      className={className}
      value={Number(value) || ''}
      disabled={libre}
      title={libre ? "Terme « Autre » : saisissez la date d'expiration" : undefined}
      onChange={(e) => onChange(Number(e.target.value))}
      {...props}
    >
      {libre && <option value={ID_DUREE_LIBRE}>Libre</option>}
      {trierParLibelle(durees, (d) => d.libelle).map((d) => (
        <option key={d.id} value={d.id}>
          {d.libelle}
        </option>
      ))}
    </select>
  );
};

export default DureeContratSelect;
