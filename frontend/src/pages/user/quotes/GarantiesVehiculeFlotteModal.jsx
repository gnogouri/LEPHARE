import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../../components/common/Modal';
import { AmountInput } from '../../../components/common/AmountInput';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import { trierParLibelle } from '../../../utils/sortUtils';
import {
  calculerTotauxDevisAuto,
  estGarantieCedeao,
  estGarantieRc,
  taxeGarantie,
} from '../../../utils/tarificationAuto';
import { AlertCircle, Check, Edit3, Plus, RotateCcw, Trash2, X } from 'lucide-react';

// Le FGA est une composante de prime (2 % de la RC), jamais une ligne de garantie
const ID_SOUS_GARANTIE_FGA = 2;

const montant = (v) => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} F`;

// Taxe d'une garantie au taux du produit Automobile (fn_calcul_montant_taxe) ; sans la table
// des taux, celle du moteur rapportée à la prime saisie
const calculerTaxe = (g, tauxTaxes) => {
  if (!tauxTaxes) return taxeGarantie(g);
  const taux = tauxTaxes.get(Number(g.id_garantie)) || 0;
  return Math.round(((Number(g.primeNette) || 0) * taux) / 100);
};

// Primes différentes de celles du barème (ou de l'enregistrement) dont la ligne est partie
const estImposee = (g) => !g.is_new_garantie
  && (Number(g.primeNette) !== Number(g.primeNetteRef) || Number(g.primeAnnuelle) !== Number(g.primeAnnuelleRef));

// Lignes telles que chargées : leurs primes deviennent la référence des primes imposées
const avecReference = (garanties) => (garanties || []).map((g) => ({
  ...g,
  primeAnnuelleRef: g.primeAnnuelleRef ?? (Number(g.primeAnnuelle) || 0),
  primeNetteRef: g.primeNetteRef ?? (Number(g.primeNette) || 0),
}));

// Barème recalculé après un changement du véhicule : les retraits, primes imposées et
// garanties ajoutées de l'ancienne personnalisation y sont reportés
const reporterPersonnalisation = (bareme, anciennes) => {
  const parId = new Map(anciennes.map((g) => [Number(g.id_garantie), g]));
  const lignes = bareme.map((b) => {
    const ancienne = parId.get(Number(b.id_garantie));
    if (!ancienne) return b;
    const ligne = { ...b, acquise: ancienne.acquise || estGarantieRc(b) || estGarantieCedeao(b) };
    if (estImposee(ancienne)) {
      ligne.primeAnnuelle = ancienne.primeAnnuelle;
      ligne.primeNette = ancienne.primeNette;
    }
    return ligne;
  });
  const idsBareme = new Set(bareme.map((b) => Number(b.id_garantie)));
  return [...lignes, ...anciennes.filter((g) => g.is_new_garantie && !idsBareme.has(Number(g.id_garantie)))];
};

// Montant saisi dans le tableau : affiché avec séparateurs, sélectionné à l'entrée pour que la
// frappe le remplace, en chiffres seuls une fois la saisie commencée
const MontantCellule = ({ valeur, onChange, label, couleur }) => {
  const [texte, setTexte] = useState(null);
  return (
    <input
      type="text"
      inputMode="numeric"
      className="form-control"
      aria-label={label}
      value={texte ?? Number(valeur || 0).toLocaleString('fr-FR')}
      onFocus={(e) => e.target.select()}
      onBlur={() => setTexte(null)}
      onChange={(e) => {
        const chiffres = e.target.value.replace(/[^\d]/g, '');
        setTexte(chiffres);
        onChange(Number(chiffres) || 0);
      }}
      style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', width: '120px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: couleur, marginLeft: 'auto' }}
    />
  );
};

const FORMULAIRE_AJOUT_VIDE = { idSousGarantie: '', capital: 0, primeAnnuelle: 0, primeNette: 0 };

const ORIGINES = {
  bareme: { libelle: "Barème de l'offre", couleur: 'slate' },
  enregistrees: { libelle: 'Garanties enregistrées', couleur: 'emerald' },
  personnalisees: { libelle: 'Garanties personnalisées', couleur: 'blue' },
};

/**
 * Garanties de l'offre d'un véhicule de flotte : consultation, garanties retirées ou ajoutées,
 * primes imposées. Le résultat est remis à la page (onAppliquer), qui l'enregistre avec le devis :
 *   null      → barème de l'offre (le véhicule est tarifé par la base)
 *   undefined → rien à changer
 *   [lignes]  → garanties personnalisées du véhicule
 *
 * initial : { origine: 'bareme' | 'enregistrees' | 'personnalisees' | 'perimees', garanties }
 * ('perimees' : personnalisation faite avant un changement du véhicule, reportée sur le barème)
 */
export const GarantiesVehiculeFlotteModal = ({
  isOpen,
  onClose,
  vehicule,
  libelleOffre,
  initial,
  chargerBareme,
  sousGaranties,
  tauxTaxes,
  onAppliquer,
}) => {
  const [lignes, setLignes] = useState(null);
  const [lignesChargees, setLignesChargees] = useState([]);
  const [origine, setOrigine] = useState('bareme');
  const [modifie, setModifie] = useState(false);
  const [avertissement, setAvertissement] = useState('');
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);
  const [imposition, setImposition] = useState(false);
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [ajout, setAjout] = useState(FORMULAIRE_AJOUT_VIDE);

  const charger = (nouvelles, nouvelleOrigine, dejaModifie = false) => {
    const reference = avecReference(nouvelles);
    setLignes(reference);
    setLignesChargees(reference);
    setOrigine(nouvelleOrigine);
    setModifie(dejaModifie);
  };

  const chargerDepuisBareme = async (anciennes = null) => {
    setChargement(true);
    setErreur('');
    try {
      const bareme = await chargerBareme();
      if (!bareme.length) {
        setErreur("Aucune garantie n'est configurée pour cette offre avec cette compagnie (à paramétrer dans Offres & Garanties).");
        setLignes([]);
        return;
      }
      if (anciennes) {
        charger(reporterPersonnalisation(avecReference(bareme), anciennes), 'personnalisees', true);
        setLignesChargees(avecReference(bareme));
      } else {
        charger(bareme, 'bareme');
      }
    } catch (e) {
      setErreur(`Garanties de l'offre non calculées : ${e.message}`);
    } finally {
      setChargement(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setImposition(false);
    setAjoutOuvert(false);
    setAjout(FORMULAIRE_AJOUT_VIDE);
    setAvertissement('');
    setErreur('');
    setLignes(null);
    if (initial?.origine === 'perimees') {
      setAvertissement(
        'Le véhicule a changé depuis vos modifications : ses garanties sont recalculées au barème, '
        + 'vos retraits, ajouts et primes imposées y sont reportés. Vérifiez-les puis appliquez.',
      );
      chargerDepuisBareme(initial.garanties);
    } else if (initial?.garanties && initial.origine !== 'bareme') {
      charger(initial.garanties, initial.origine);
    } else {
      chargerDepuisBareme();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Taxe de chaque ligne recalculée ; primeNetteOrigine = prime affichée, pour que les totaux
  // (calculerTotauxDevisAuto) reprennent cette taxe telle quelle
  const avecTaxes = (liste) => (liste || []).map((g) => ({ ...g, taxe: calculerTaxe(g, tauxTaxes), primeNetteOrigine: Number(g.primeNette) || 0 }));
  const lignesTaxees = useMemo(() => avecTaxes(lignes), [lignes, tauxTaxes]); // eslint-disable-line react-hooks/exhaustive-deps
  const totaux = calculerTotauxDevisAuto({ garanties: lignesTaxees });
  const totauxAvant = useMemo(() => calculerTotauxDevisAuto({ garanties: avecTaxes(lignesChargees) }), [lignesChargees, tauxTaxes]); // eslint-disable-line react-hooks/exhaustive-deps

  const modifierLigne = (idx, changements) => {
    setLignes((prec) => prec.map((g, i) => (i === idx ? { ...g, ...changements } : g)));
    setModifie(true);
  };

  const retirerAjout = (idx) => {
    setLignes((prec) => prec.filter((_, i) => i !== idx));
    setModifie(true);
  };

  const presentes = new Set((lignes || []).map((g) => Number(g.id_garantie)));
  const garantiesAjoutables = trierParLibelle(
    (sousGaranties || []).filter((sg) => {
      const id = Number(sg.IdSousGarantie ?? sg.id);
      return id !== ID_SOUS_GARANTIE_FGA && !presentes.has(id) && (sg.SaisieAuto ?? true) && (sg.Active ?? true);
    }),
    (sg) => sg.LibelleSousGarantie || sg.libelle,
  );

  const ajouterGarantie = () => {
    const sg = garantiesAjoutables.find((x) => String(x.IdSousGarantie ?? x.id) === String(ajout.idSousGarantie));
    if (!sg) return;
    const id = Number(sg.IdSousGarantie ?? sg.id);
    const capital = Number(ajout.capital) || 0;
    setLignes((prec) => [...prec, {
      id_garantie: id,
      code: `GAR_${id}`,
      nom: sg.LibelleSousGarantie || sg.libelle,
      acquise: true,
      capital: capital ? `${capital.toLocaleString('fr-FR')} F` : 'Néant',
      capitalMontant: capital,
      franchise: 'Néant',
      primeAnnuelle: Number(ajout.primeAnnuelle) || 0,
      primeNette: Number(ajout.primeNette) || 0,
      primeAnnuelleRef: 0,
      primeNetteRef: 0,
      taxe: 0,
      is_new_garantie: true,
    }]);
    setModifie(true);
    setAjout(FORMULAIRE_AJOUT_VIDE);
    setAjoutOuvert(false);
  };

  const appliquer = () => {
    if (!modifie) {
      onAppliquer(origine === 'bareme' ? null : undefined);
      return;
    }
    onAppliquer(lignesTaxees);
  };

  const nbImposees = (lignes || []).filter((g) => g.acquise && estImposee(g)).length;
  const nbRetirees = (lignes || []).filter((g) => !g.acquise).length;
  const nbAjoutees = (lignes || []).filter((g) => g.is_new_garantie).length;
  const badgeOrigine = ORIGINES[origine] || ORIGINES.bareme;
  const celluleMontant = { padding: '0.55rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Garanties de l'offre"
      subtitle={`Véhicule ${vehicule || '(immatriculation à saisir)'} · ${libelleOffre || 'offre non choisie'}`}
      size="large"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setImposition((v) => !v)}
              disabled={!lignes?.length}
              aria-pressed={imposition}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, ...(imposition ? { background: 'rgba(37, 99, 235, 0.18)', borderColor: '#2563eb', color: '#60a5fa' } : {}) }}
            >
              <Edit3 size={15} /> Imposer les primes
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAjoutOuvert((v) => !v)}
              disabled={!lignes}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}
            >
              <Plus size={15} /> Ajouter une garantie
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setAvertissement(''); chargerDepuisBareme(); }}
              disabled={chargement}
              title="Abandonner les modifications et reprendre les garanties calculées par le barème"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}
            >
              <RotateCcw size={15} className={chargement ? 'spin' : ''} /> Revenir au barème
            </button>
          </div>
          <StatusBadge label={modifie ? 'Modifiées (non appliquées)' : badgeOrigine.libelle} color={modifie ? 'amber' : badgeOrigine.couleur} />
        </div>

        {avertissement && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.65rem 0.8rem', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#f59e0b', fontSize: '0.82rem' }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            {avertissement}
          </div>
        )}

        {ajoutOuvert && (
          <div className="glass-panel" style={{ padding: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
            <div className="form-group" style={{ margin: 0, gridColumn: 'span 2' }}>
              <label className="form-label" htmlFor="ajout-garantie">Garantie à ajouter</label>
              <select
                id="ajout-garantie"
                className="form-control"
                value={ajout.idSousGarantie}
                onChange={(e) => setAjout((a) => ({ ...a, idSousGarantie: e.target.value }))}
              >
                <option value="">-- Choisir une garantie --</option>
                {garantiesAjoutables.map((sg) => (
                  <option key={sg.IdSousGarantie ?? sg.id} value={sg.IdSousGarantie ?? sg.id}>
                    {sg.LibelleSousGarantie || sg.libelle}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="ajout-capital">Capital</label>
              <AmountInput id="ajout-capital" value={ajout.capital} onChange={(v) => setAjout((a) => ({ ...a, capital: v }))} suffix="F" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="ajout-pa">Prime annuelle</label>
              <AmountInput id="ajout-pa" value={ajout.primeAnnuelle} onChange={(v) => setAjout((a) => ({ ...a, primeAnnuelle: v }))} suffix="F" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="ajout-pn">Prime nette</label>
              <AmountInput id="ajout-pn" value={ajout.primeNette} onChange={(v) => setAjout((a) => ({ ...a, primeNette: v }))} suffix="F" />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-primary" onClick={ajouterGarantie} disabled={!ajout.idSousGarantie} style={{ fontWeight: 700 }}>
                Ajouter
              </button>
              <button type="button" className="btn btn-link" onClick={() => setAjoutOuvert(false)} style={{ color: 'var(--text-muted)' }}>
                Fermer
              </button>
            </div>
          </div>
        )}

        {erreur && <p style={{ color: '#f87171', margin: 0, fontSize: '0.85rem' }}>{erreur}</p>}

        {lignes === null && !erreur ? (
          <div style={{ padding: '2.5rem 1rem', display: 'flex', justifyContent: 'center' }}>
            <LoadingSpinner size={32} />
          </div>
        ) : lignes?.length > 0 && (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
              <thead>
                <tr style={{ background: 'rgba(30, 41, 59, 0.9)', color: '#94a3b8', textTransform: 'uppercase', fontSize: '0.72rem', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'left' }}>Garantie</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Acquise</th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'left' }}>Capital</th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'left' }}>Franchise</th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'right' }}>Prime annuelle</th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'right' }}>Prime nette</th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'right' }}>Taxe</th>
                  <th style={{ padding: '0.65rem 0.5rem' }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {lignesTaxees.map((g, idx) => {
                  const verrouillee = estGarantieRc(g) || estGarantieCedeao(g);
                  const imposee = g.acquise && estImposee(g);
                  return (
                    <tr
                      key={g.id_garantie}
                      style={{
                        borderTop: '1px solid var(--border-subtle)',
                        opacity: g.acquise ? 1 : 0.5,
                        background: imposee || g.is_new_garantie ? 'rgba(37, 99, 235, 0.06)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '0.55rem 0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {g.nom}
                        {g.is_new_garantie && <span className="badge badge-blue" style={{ marginLeft: '0.4rem', fontSize: '0.62rem' }}>Ajoutée</span>}
                        {imposee && <span className="badge badge-amber" style={{ marginLeft: '0.4rem', fontSize: '0.62rem' }}>Prime imposée</span>}
                      </td>
                      <td style={{ padding: '0.55rem 0.5rem', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={g.acquise}
                          disabled={verrouillee}
                          onChange={() => modifierLigne(idx, { acquise: !g.acquise })}
                          aria-label={`${g.nom} acquise`}
                          title={verrouillee ? 'Garantie obligatoire' : 'Décocher pour retirer la garantie du véhicule'}
                          style={{ width: '16px', height: '16px', cursor: verrouillee ? 'not-allowed' : 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{g.capital}</td>
                      <td style={{ padding: '0.55rem 0.75rem', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{g.franchise}</td>
                      <td style={celluleMontant}>
                        {imposition && g.acquise && !estGarantieCedeao(g)
                          ? <MontantCellule label={`Prime annuelle ${g.nom}`} valeur={g.primeAnnuelle} onChange={(v) => modifierLigne(idx, { primeAnnuelle: v })} />
                          : montant(g.acquise ? g.primeAnnuelle : 0)}
                      </td>
                      <td style={{ ...celluleMontant, fontWeight: 700, color: '#60a5fa' }}>
                        {imposition && g.acquise && !estGarantieCedeao(g)
                          ? <MontantCellule label={`Prime nette ${g.nom}`} valeur={g.primeNette} onChange={(v) => modifierLigne(idx, { primeNette: v })} couleur="#60a5fa" />
                          : montant(g.acquise ? g.primeNette : 0)}
                      </td>
                      <td style={{ ...celluleMontant, color: 'var(--text-secondary)' }}>{montant(g.acquise ? g.taxe : 0)}</td>
                      <td style={{ padding: '0.55rem 0.5rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {imposee && (
                          <button
                            type="button"
                            className="btn btn-link"
                            onClick={() => modifierLigne(idx, { primeAnnuelle: g.primeAnnuelleRef, primeNette: g.primeNetteRef })}
                            title="Reprendre les primes calculées"
                            aria-label={`Reprendre les primes calculées de ${g.nom}`}
                            style={{ padding: '0.2rem', color: 'var(--text-muted)' }}
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                        {g.is_new_garantie && (
                          <button
                            type="button"
                            className="btn btn-link"
                            onClick={() => retirerAjout(idx)}
                            title="Retirer cette garantie ajoutée"
                            aria-label={`Retirer ${g.nom}`}
                            style={{ padding: '0.2rem', color: '#f87171' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {lignes?.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
            {[
              ['Prime annuelle', totaux.pa, totauxAvant.pa],
              // Prime nette de toutes les garanties de la liste, CEDEAO comprise (pas de case à part)
              ['Prime nette', totaux.pn + totaux.cedeao, totauxAvant.pn + totauxAvant.cedeao],
              ['Taxes', totaux.taxe, totauxAvant.taxe],
              ['FGA', totaux.fga, totauxAvant.fga],
            ].map(([libelle, valeur, avant]) => (
              <div key={libelle} style={{ background: 'var(--bg-surface-elevated)', padding: '0.75rem 0.9rem', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>{libelle}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: libelle === 'Prime nette' ? '#60a5fa' : 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
                  {montant(valeur)}
                </div>
                {modifie && Math.round(valeur) !== Math.round(avant) && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>avant : {montant(avant)}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {lignes?.length > 0 && (
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {[
              nbRetirees && `${nbRetirees} garantie${nbRetirees > 1 ? 's' : ''} retirée${nbRetirees > 1 ? 's' : ''}`,
              nbAjoutees && `${nbAjoutees} ajoutée${nbAjoutees > 1 ? 's' : ''}`,
              nbImposees && `${nbImposees} à prime imposée`,
            ].filter(Boolean).join(' · ') || 'Garanties telles que calculées'}
            {'. '}Primes du véhicule seul, hors accessoire : le récapitulatif du devis est recalculé à l'enregistrement.
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <X size={15} /> Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={appliquer}
            disabled={!lignes?.length || chargement}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}
          >
            <Check size={15} /> Appliquer au véhicule
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default GarantiesVehiculeFlotteModal;
