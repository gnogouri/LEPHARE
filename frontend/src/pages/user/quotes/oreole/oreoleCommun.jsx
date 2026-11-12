import React from 'react';
import { CheckCircle2, CircleDashed, HeartPulse, Flower2, ShieldPlus, MinusCircle } from 'lucide-react';
import { oreoleApi } from '../../../../api/endpoints';

/* =========================================================================
   ORÉOLE SANTÉ : éléments communs aux écrans de la branche (sante/oreole.py)
   Une couleur par police liée : Santé cyan, Individuelle Accidents orange, Assistance funéraire violet.
   ========================================================================= */

export const COULEUR = 'var(--accent-cyan)';
export const PRODUITS = {
  Sante: { libelle: 'Santé', long: 'Santé', couleur: 'var(--accent-cyan)', icone: HeartPulse },
  IA: { libelle: 'IA', long: 'Individuelle Accidents', couleur: '#f97316', icone: ShieldPlus },
  AFA: { libelle: 'AFA', long: 'Assistance funéraire', couleur: 'var(--accent-purple)', icone: Flower2 },
};

export const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/[   ]/g, ' ');
export const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '-');
export const ageAu = (naissance, jour) => {
  if (!naissance || !jour) return null;
  const n = new Date(`${String(naissance).slice(0, 10)}T00:00:00`);
  const j = new Date(`${String(jour).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(n.getTime()) || Number.isNaN(j.getTime())) return null;
  return j.getFullYear() - n.getFullYear() - ((j.getMonth() < n.getMonth() || (j.getMonth() === n.getMonth() && j.getDate() < n.getDate())) ? 1 : 0);
};
export const echeanceAnnuelle = (effet) => {
  if (!effet) return '';
  const d = new Date(`${effet}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Répartition à l'échelle de la cotisation entre les trois polices
export const BarreRepartition = ({ sante = 0, ia = 0, afa = 0, hauteur = 8 }) => {
  const total = Number(sante) + Number(ia) + Number(afa) || 1;
  const parts = [[sante, PRODUITS.Sante.couleur, 'Santé'], [ia, PRODUITS.IA.couleur, 'IA'], [afa, PRODUITS.AFA.couleur, 'AFA']].filter(([v]) => Number(v) > 0);
  return (
    <div role="img" aria-label={parts.map(([v, , l]) => `${l} ${fcfa(v)} F`).join(', ')}
      style={{ display: 'flex', gap: 1, height: hauteur, borderRadius: 6, overflow: 'hidden', background: 'var(--bg-surface-elevated)' }}>
      {parts.map(([v, c, l]) => <span key={l} style={{ width: `${(Number(v) / total) * 100}%`, minWidth: 3, background: c, transition: 'width 0.25s ease' }} />)}
    </div>
  );
};

export const LegendeRepartition = ({ sante = 0, ia = 0, afa = 0 }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem 0.8rem', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
    {[['Santé', sante, PRODUITS.Sante.couleur], ['IA', ia, PRODUITS.IA.couleur], ['AFA', afa, PRODUITS.AFA.couleur]].map(([l, v, c]) => (
      <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: c }} /> {l} {fcfa(v)} F
      </span>
    ))}
  </div>
);

// État d'une police liée : émise, en devis, à émettre, absente de l'offre
export const PastilleProduit = ({ produit, etat }) => {
  const p = PRODUITS[produit];
  const emise = etat === 'EMISE';
  const devis = etat === 'DEVIS';
  const Icone = emise ? CheckCircle2 : devis ? CircleDashed : MinusCircle;
  const texte = emise ? 'émise' : devis ? 'en devis' : 'non émise';
  return (
    <span title={`${p.long} : ${texte}`} style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.1rem 0.45rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700,
      color: etat ? p.couleur : 'var(--text-muted)', opacity: etat ? 1 : 0.65,
      background: etat ? `color-mix(in srgb, ${p.couleur} 13%, transparent)` : 'var(--bg-surface-elevated)',
    }}>
      <Icone size={12} /> {p.libelle}
    </span>
  );
};

// Annexes : réseaux MCI par défaut (réponse d'OREOLE), fichiers livrés avec l'application
export const RESEAUX = {
  MCI_80: { libelle: 'Réseau de soins MCI', fichier: '/assets/oreole/reseau-soins-mci-80.pdf' },
  MCI_100: { libelle: 'Réseau de soins MCI', fichier: '/assets/oreole/reseau-soins-mci-80-100.pdf' },
};
export const RESEAU_PHARMACIES = { libelle: 'Réseau de pharmacies MCI-SOGEM', fichier: '/assets/oreole/reseau-pharmacies-mci-sogem.pdf' };

export const carte = { padding: '1.4rem', borderRadius: 14 };
export const titreCarte = { display: 'flex', alignItems: 'center', gap: '0.55rem', margin: '0 0 1rem', fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' };
export const grille = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '1rem 1.25rem', alignItems: 'start' };
export const ligneDetail = { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.35rem 0', borderBottom: '1px dashed var(--border-subtle)', fontSize: '0.84rem' };
export const noteInfo = (couleur = 'var(--accent-cyan)') => ({
  display: 'flex', gap: '0.55rem', alignItems: 'flex-start', padding: '0.6rem 0.85rem', borderRadius: 8, fontSize: '0.82rem', color: 'var(--text-secondary)',
  background: `color-mix(in srgb, ${couleur} 9%, transparent)`, border: `1px solid color-mix(in srgb, ${couleur} 28%, transparent)`,
});

// Écrans Santé, IA et AFA : un devis lié au package s'ouvre dans la branche (leurs calculs ne s'y appliquent pas)
export const redirigerSiOreole = (idDevis, navigate) => {
  if (!Number(idDevis)) return undefined;
  let actif = true;
  oreoleApi.lien(idDevis)
    .then((r) => { if (actif && r?.Oreole) navigate(`/user/quotes/oreole-sante/nouveau?edit=${r.IdDevis}`, { replace: true }); })
    .catch(() => {});
  return () => { actif = false; };
};

// Ligne d'import (classeur des effectifs) -> ligne de saisie
export const ligneDepuisImport = (l) => ({
  Matricule: l.Matricule || '', Nom: l.Nom || '', Prenoms: l.Prenoms || '', DateNaissance: l.DateNaissance || '', Sexe: l.Sexe || '',
  IdOffre: l.IdOffre, CotisationImposee: l.CotisationImposee || 0, PartIA: l.PartIA, PartAFA: l.PartAFA, PartFichier: true, EnfantsEnPlus: l.EnfantsEnPlus || 0,
  Personnes: l.Personnes || 0, Affections: l.Affections || 0, Beneficiaires: l.Beneficiaires || '', Anomalies: l.Anomalies || [], LigneFichier: l.Ligne,
});
