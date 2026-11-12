import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Car, FileText, HeartHandshake, HeartPulse, Home, Layers, Plane, Printer, Shield, Ship, UserPlus } from 'lucide-react';
import { moduleActif, TITRE_MODULE_INACTIF } from '../../utils/modulesActifs';

/* =========================================================================
   BRANCHES COMME DANS LA GESTION DES DEVIS
   Boutons « Devis Auto », « Devis Voyage »… et onglets de branches (icône, nombre, impression facultative),
   partagés par la Gestion des devis et les Affaires antérieures pour que les deux vues se présentent pareil
   (demande du 2026-10-26 : « pour ne pas être dépaysé »).
   ========================================================================= */

// Formulaires de devis par branche, dans l'ordre de la Gestion des devis
export const BRANCHES_DEVIS = [
  ['auto', Car, 'Devis Auto'],
  ['voyage', Plane, 'Devis Voyage'],
  ['transport', Ship, 'Devis Transport'],
  ['mrh', Home, 'Devis MRH'],
  ['sante', HeartPulse, 'Devis Santé'],
  // Branche Vie : AFA, Retraite complémentaire, Temporaire décès… choisis dans la liste des offres commerciales du devis
  ['afa', HeartHandshake, 'Devis Vie'],
  ['ia', UserPlus, 'Devis IA'],
  ['rc', Shield, 'Devis RC'],
  ['mrp', Building2, 'Devis MRP'],
  ['tous-dommages', Layers, 'Devis Dommages'],
];

// Icône d'un onglet du registre selon son code (onglets réglés dans Administration > Produits)
export const ICONES_ONGLET = {
  AUTO: <Car size={13} />,
  VOYAGE: <Plane size={13} color="#60a5fa" />,
  TRANSPORT: <Ship size={13} color="#38bdf8" />,
  MRH: <Home size={13} />,
  SANTE: <HeartPulse size={13} />,
  VIE: <HeartHandshake size={13} />,
  IA: <UserPlus size={13} />,
  RC: <Shield size={13} />,
  MRP: <Building2 size={13} />,
  DOMMAGES: <Layers size={13} />,
};
export const iconeOnglet = (id) => ICONES_ONGLET[id] || <FileText size={13} />;

/** Boutons de saisie par branche ; lien(module) donne l'adresse du formulaire (vue Production ou mode reprise). */
export const BoutonsNouveauDevis = ({ lien = (module) => `/user/quotes/${module}`, titre }) => {
  const navigate = useNavigate();
  return BRANCHES_DEVIS.map(([module, Icone, libelle]) => (
    <button
      key={module}
      type="button"
      className={`btn btn-secondary${moduleActif(module) ? '' : ' module-ferme'}`}
      onClick={() => navigate(lien(module))}
      disabled={!moduleActif(module)}
      title={moduleActif(module) ? (titre ? titre(libelle) : undefined) : TITRE_MODULE_INACTIF}
    >
      <Icone size={16} />
      <span>{libelle}</span>
    </button>
  ));
};

/**
 * Onglets de branches : [{ id, label, count, icon }] ; onImprimer(id) ajoute le bouton d'impression de la liste
 * de l'onglet (registre des devis). libelle(tab) : infobulle de l'onglet.
 */
export const OngletsBranches = ({ onglets, actif, onChoisir, onImprimer, libelle = (tab) => `Afficher : ${tab.label}` }) => (
  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }} role="tablist" aria-label="Branches">
    {onglets.map((tab) => {
      const isActive = actif === tab.id;
      return (
        <div
          key={tab.id}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            border: isActive ? '1px solid #3b82f6' : '1px solid var(--border-subtle)',
            background: isActive ? 'var(--primary)' : 'var(--surface-sunken)',
            boxShadow: isActive ? '0 0 12px rgba(59, 130, 246, 0.3)' : 'none',
            transition: 'all 0.2s ease',
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChoisir(tab.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.4rem 0.65rem',
              fontSize: '0.8rem',
              fontWeight: 600,
              border: 'none',
              background: 'transparent',
              color: isActive ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            title={libelle(tab)}
          >
            {tab.icon}
            <span>{tab.label}</span>
            <span
              style={{
                fontSize: '0.72rem',
                padding: '0.1rem 0.35rem',
                borderRadius: '999px',
                background: isActive ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                color: isActive ? '#fff' : 'var(--text-muted)',
                marginLeft: '0.2rem',
              }}
            >
              {Number(tab.count || 0).toLocaleString('fr-FR')}
            </span>
          </button>

          {onImprimer && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onImprimer(tab.id);
              }}
              title={`Imprimer directement la liste : ${tab.label}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.4rem 0.45rem',
                border: 'none',
                borderLeft: isActive ? '1px solid rgba(255,255,255,0.2)' : '1px solid var(--border-subtle)',
                background: 'transparent',
                color: isActive ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <Printer size={12} />
            </button>
          )}
        </div>
      );
    })}
  </div>
);
