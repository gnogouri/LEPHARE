import React from 'react';
import { CheckCircle2 } from 'lucide-react';

/* =========================================================================
   PARCOURS D'UN DEVIS : étapes numérotées et résumé permanent « Votre devis »
   Présentation de l'écran MRH, partagée avec la RC et la MRP (demande du 2026-10-27 : « amélioration de UI/UX » des
   parcours MRH et RC) : même en-tête d'étapes, même résumé à droite, quelle que soit la branche.
   ========================================================================= */

// Fond teinté d'une couleur de branche (RC rouge, MRP cyan) ; MRH : couleur principale du thème
const teinte = (couleur) => (couleur ? `color-mix(in srgb, ${couleur} 12%, transparent)` : 'var(--primary-glow)');

/**
 * etapes : [{ num, libelle, icone }] ; etape : numéro affiché ; onAller(num) : changement d'étape (contrôles de
 * l'écran) ; couleur : couleur de la branche, à défaut celle du thème.
 */
export const EtapesDevis = ({ etapes, etape, onAller, couleur }) => {
  const accent = couleur || 'var(--primary-500)';
  return (
    <nav aria-label="Étapes du devis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '0.5rem' }}>
      {etapes.map(({ num, libelle, icone: Icone }) => {
        const actif = etape === num;
        const fait = etape > num;
        return (
          <button key={num} type="button" onClick={() => onAller(num)} aria-current={actif ? 'step' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.9rem', borderRadius: '12px', cursor: 'pointer', textAlign: 'left',
              border: `1px solid ${actif ? accent : 'var(--border-subtle)'}`, background: actif ? teinte(couleur) : 'var(--bg-surface)',
              color: actif ? accent : 'var(--text-secondary)',
            }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: fait ? 'var(--accent-emerald)' : actif ? accent : 'var(--bg-surface-elevated)', color: fait || actif ? '#fff' : 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 800,
            }}>{fait ? <CheckCircle2 size={16} /> : num}</span>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Étape {num}</span>
              <span style={{ fontSize: '0.86rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>{Icone && <Icone size={14} />} {libelle}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
};

const ligne = { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px dashed var(--border-subtle)', fontSize: '0.84rem' };

/**
 * Résumé permanent à droite du formulaire. lignes : [[libellé, valeur]] (valeur vide : « - ») ; montant : prime mise en
 * avant (null : « - ») ; libelleMontant (« Prime TTC ») ; detail : texte sous le montant ; children : contenu ajouté.
 */
export const ResumeDevis = ({ titre = 'Votre devis', icone: Icone, couleur, lignes = [], libelleMontant = 'Prime TTC', montant, detail, children }) => {
  const accent = couleur || 'var(--primary-500)';
  return (
    <aside className="glass-panel" style={{ padding: '1.5rem', borderRadius: '14px', flex: '1 1 280px', maxWidth: '100%', position: 'sticky', top: '1rem' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)' }}>
        {Icone && <Icone size={16} style={{ color: accent }} />} {titre}
      </h2>
      {lignes.filter(Boolean).map(([libelle, valeur]) => (
        <div key={libelle} style={ligne}>
          <span style={{ color: 'var(--text-muted)' }}>{libelle}</span>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right' }}>{valeur || valeur === 0 ? valeur : '-'}</span>
        </div>
      ))}
      {children}
      <div style={{ marginTop: '1rem', padding: '0.9rem', borderRadius: '12px', background: teinte(couleur), border: `1px solid ${accent}` }}>
        <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 800, color: accent }}>{libelleMontant}</div>
        <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--text-primary)' }}>{montant === null || montant === undefined ? '-' : montant}</div>
        {detail && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>{detail}</div>}
      </div>
    </aside>
  );
};
