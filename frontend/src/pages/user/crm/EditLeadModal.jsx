import React, { useState, useEffect } from 'react';
import { Modal } from '../../../components/common/Modal';
import { AmountInput } from '../../../components/common/AmountInput';
import { Users, Phone, Mail, Calendar, Briefcase, Save } from 'lucide-react';
import { BRANCHES_PROSPECT, ETAPES, dansJours, montantProspect } from './suiviCommercial';
import { echeanceEnClair, formatDateLisible } from '../../../utils/dateUtils';

const VIDE = {
  nom_prospect: '',
  contact: '',
  telephone: '',
  email: '',
  branche: 'Automobile',
  prime_estimee: 0,
  statut: 'Nouveau',
  commercial_attribue: '',
  prochaine_action: '',
  date_action: '',
};

const Libelle = ({ htmlFor, children }) => (
  <label className="form-label" htmlFor={htmlFor} style={{ fontSize: '0.8rem', fontWeight: 600 }}>{children}</label>
);

const AvecIcone = ({ icone: Icone, children }) => (
  <div style={{ position: 'relative' }}>
    <Icone size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
    {children}
  </div>
);

/**
 * Prospect du suivi commercial, en création (lead absent) ou en modification.
 * onSave(donnees) enregistre en base et renvoie true si c'est fait : la fenêtre se ferme alors.
 */
export const EditLeadModal = ({ isOpen, onClose, lead, onSave, commerciaux = [], commercialParDefaut = '' }) => {
  const [formData, setFormData] = useState(VIDE);
  const [enregistrement, setEnregistrement] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFormData(lead
      ? {
        nom_prospect: lead.nom_prospect || '',
        contact: lead.contact || '',
        telephone: lead.telephone || '',
        email: lead.email || '',
        branche: lead.branche || 'Automobile',
        prime_estimee: montantProspect(lead.prime_estimee),
        statut: lead.statut || 'Nouveau',
        commercial_attribue: lead.commercial_attribue || '',
        prochaine_action: lead.prochaine_action || '',
        date_action: lead.date_action || '',
      }
      : { ...VIDE, commercial_attribue: commercialParDefaut, date_action: dansJours(7) });
  }, [isOpen, lead, commercialParDefaut]);

  if (!isOpen) return null;

  const champ = (nom) => ({
    id: `prospect-${nom}`,
    value: formData[nom],
    onChange: (e) => setFormData((f) => ({ ...f, [nom]: e.target.value })),
  });
  // Une valeur enregistrée hors des listes reste proposée (pas de changement à l'insu de l'utilisateur)
  const branches = BRANCHES_PROSPECT.includes(formData.branche) || !formData.branche
    ? BRANCHES_PROSPECT
    : [formData.branche, ...BRANCHES_PROSPECT];
  const listeCommerciaux = !formData.commercial_attribue || commerciaux.includes(formData.commercial_attribue)
    ? commerciaux
    : [formData.commercial_attribue, ...commerciaux];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setEnregistrement(true);
    const fait = await onSave({
      ...formData,
      nom_prospect: formData.nom_prospect.trim(),
      prime_estimee: montantProspect(formData.prime_estimee),
      date_action: formData.date_action || null,
    });
    setEnregistrement(false);
    if (fait) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={lead ? `Modifier le prospect ${lead.id_lead || ''}` : 'Nouveau prospect'}
      subtitle={lead ? lead.nom_prospect : 'Opportunité commerciale enregistrée dans le suivi commercial.'}
      size="medium"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
          <div>
            <Libelle htmlFor="prospect-nom_prospect">Prospect / entreprise *</Libelle>
            <AvecIcone icone={Briefcase}>
              <input type="text" className="form-control" style={{ paddingLeft: '2.25rem' }} required placeholder="ex : IVOIRE LOGISTIQUE SARL" {...champ('nom_prospect')} />
            </AvecIcone>
          </div>
          <div>
            <Libelle htmlFor="prospect-contact">Interlocuteur</Libelle>
            <AvecIcone icone={Users}>
              <input type="text" className="form-control" style={{ paddingLeft: '2.25rem' }} {...champ('contact')} />
            </AvecIcone>
          </div>
          <div>
            <Libelle htmlFor="prospect-telephone">Téléphone</Libelle>
            <AvecIcone icone={Phone}>
              <input type="tel" className="form-control" style={{ paddingLeft: '2.25rem' }} placeholder="+225 …" {...champ('telephone')} />
            </AvecIcone>
          </div>
          <div>
            <Libelle htmlFor="prospect-email">E-mail</Libelle>
            <AvecIcone icone={Mail}>
              <input type="email" className="form-control" style={{ paddingLeft: '2.25rem' }} {...champ('email')} />
            </AvecIcone>
          </div>
          <div>
            <Libelle htmlFor="prospect-branche">Branche ciblée</Libelle>
            <select className="form-control" {...champ('branche')}>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <Libelle htmlFor="prospect-prime_estimee">Prime estimée</Libelle>
            <AmountInput
              id="prospect-prime_estimee"
              value={formData.prime_estimee}
              onChange={(v) => setFormData((f) => ({ ...f, prime_estimee: v }))}
            />
          </div>
          <div>
            <Libelle htmlFor="prospect-statut">Étape</Libelle>
            <select className="form-control" {...champ('statut')}>
              {ETAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <Libelle htmlFor="prospect-commercial_attribue">Commercial</Libelle>
            <select className="form-control" {...champ('commercial_attribue')}>
              <option value="">— À attribuer —</option>
              {listeCommerciaux.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <Libelle htmlFor="prospect-date_action">Prochaine relance</Libelle>
            <AvecIcone icone={Calendar}>
              <input type="date" lang="fr-FR" className="form-control" style={{ paddingLeft: '2.25rem' }} {...champ('date_action')} />
            </AvecIcone>
            {formData.date_action && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                {(() => {
                  const date = formatDateLisible(formData.date_action, { jourSemaine: true });
                  return `${date.charAt(0).toUpperCase()}${date.slice(1)} · ${echeanceEnClair(formData.date_action)}`;
                })()}
              </div>
            )}
          </div>
        </div>

        <div>
          <Libelle htmlFor="prospect-prochaine_action">Prochaine action</Libelle>
          <input type="text" className="form-control" placeholder="ex : envoi de l'offre tarifaire et recueil du RCCM" {...champ('prochaine_action')} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={enregistrement}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={enregistrement} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Save size={16} />
            <span>{enregistrement ? 'Enregistrement…' : lead ? 'Enregistrer les modifications' : 'Enregistrer le prospect'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default EditLeadModal;
