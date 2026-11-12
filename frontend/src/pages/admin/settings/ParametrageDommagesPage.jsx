import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Layers, Save, Loader2, RotateCcw, Plus, Trash2, ArrowUp, ArrowDown, ShieldCheck, ClipboardList, Copy,
  Percent, Receipt, Coins, Boxes, AlertTriangle, Lock, Search, FileText,
} from 'lucide-react';
import { EnTeteParametrage, SectionParametrage } from '../../../components/admin/EnTeteParametrage';
import { AmountInput } from '../../../components/common/AmountInput';
import { parametrageApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { useToast } from '../../../context/ToastContext';

// Réglages de la branche Dommages (produit 9) : catégories proposées à la saisie et garanties de
// chaque catégorie par compagnie. configuration_api/parametrage_dommages.py

const Interrupteur = ({ actif, onChange, desactive, titre }) => (
  <button type="button" role="switch" aria-checked={actif} title={titre} disabled={desactive} onClick={() => onChange(!actif)}
    style={{ width: 40, height: 22, borderRadius: 999, border: 'none', cursor: desactive ? 'not-allowed' : 'pointer', position: 'relative', background: actif ? 'var(--accent-emerald)' : 'var(--border-medium)', opacity: desactive ? 0.45 : 1, transition: 'background 0.15s', flexShrink: 0 }}>
    <span style={{ position: 'absolute', top: 3, left: actif ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
  </button>
);

// Identifiant technique d'un champ de description du risque, tiré de son libellé
const cleDepuisLibelle = (libelle, existantes) => {
  const base = String(libelle || 'champ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'champ';
  let cle = base;
  for (let i = 2; existantes.includes(cle); i += 1) cle = `${base}_${i}`;
  return cle;
};

// Liste de choix : options éditées en texte, une par ligne
const copieCategorie = (c) => ({
  SaisieOuverte: c.SaisieOuverte, Ordre: c.Ordre, Description: c.Description || '', Prorata: c.Prorata,
  ChampsRisque: (c.ChampsRisque || []).map((x) => ({ ...x, OptionsTexte: (x.Options || []).join('\n') })),
  ObjetGarantie: c.ObjetGarantie || '', ContreGaranties: c.ContreGaranties || '', Exclusions: c.Exclusions || '',
  AnnexeCotation: c.AnnexeCotation !== false, ReferenceFacture: c.ReferenceFacture || '',
});
// Documents de production (ex. « Garantie de soumission ») : copie modifiable
const copieDocuments = (liste) => (liste || []).map((d) => ({ ...d, cle: `doc-${d.Id}` }));
// Champs entre accolades communs à toutes les catégories (frontend/src/utils/exportUtils.js, valeursPiecesDommages)
const CHAMPS_DOCUMENT = [
  ['compagnie', 'compagnie'], ['souscripteur', 'souscripteur (candidat)'], ['assure', 'assuré'],
  ['numero_police', 'n° de police'], ['numero_facture', 'n° de facture'], ['date_effet', "date d'effet"],
  ['date_expiration', "date d'expiration"], ['date_emission', "date d'émission"], ['capital', 'capital garanti'],
  ['capital_lettres', 'capital en lettres'], ['prime_ttc', 'prime TTC'], ['prime_ttc_lettres', 'prime TTC en lettres'],
];
const copieGaranties = (liste) => (liste || []).map((g) => ({
  ...g,
  TauxDefaut: g.TauxDefaut ?? '',
  TauxTaxeSaisi: g.TauxTaxe === null || g.TauxTaxe === undefined ? '' : g.TauxTaxe,
}));
const memesValeurs = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const cellule = { padding: '0.5rem 0.35rem', verticalAlign: 'top' };
const entete = { padding: '0.6rem 0.35rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', textAlign: 'left' };

export const ParametrageDommagesPage = () => {
  const { success, error: toastError } = useToast();
  const [searchParams] = useSearchParams();
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [idTarif, setIdTarif] = useState(Number(searchParams.get('categorie')) || 0);
  const [categorieSaisie, setCategorieSaisie] = useState(null);
  const [idCompagnie, setIdCompagnie] = useState(0);
  const [garantiesSaisies, setGarantiesSaisies] = useState([]);
  const [envoi, setEnvoi] = useState('');
  const [recherche, setRecherche] = useState('');
  const [documentsSaisis, setDocumentsSaisis] = useState([]);

  const charger = async () => {
    setChargement(true);
    try {
      const d = await parametrageApi.getDommages();
      setDonnees(d);
      setIdTarif((t) => (d.Categories.some((c) => c.IdTarif === t) ? t : d.Categories[0]?.IdTarif || 0));
    } catch (err) {
      toastError(`Réglages Dommages non chargés : ${messageErreurApi(err)}`);
    } finally {
      setChargement(false);
    }
  };
  useEffect(() => { charger(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const categorie = donnees?.Categories.find((c) => c.IdTarif === idTarif) || null;
  const nomCompagnie = (id) => donnees?.Compagnies.find((c) => c.IdCompagnie === Number(id))?.RaisonSociale || `Compagnie n° ${id}`;
  const compagniesCategorie = useMemo(() => Object.keys(categorie?.Compagnies || {}).map(Number)
    .sort((a, b) => nomCompagnie(a).localeCompare(nomCompagnie(b))), [categorie]); // eslint-disable-line react-hooks/exhaustive-deps

  // Catégorie choisie : copie modifiable, compagnie par défaut NSIA (sinon la première paramétrée)
  useEffect(() => {
    if (!categorie) return;
    setCategorieSaisie(copieCategorie(categorie));
    setIdCompagnie((cie) => {
      if (cie && categorie.Compagnies[String(cie)]) return cie;
      if (categorie.Compagnies['1']) return 1;
      return compagniesCategorie[0] || cie || 1;
    });
  }, [categorie?.IdTarif, donnees]); // eslint-disable-line react-hooks/exhaustive-deps

  const garantiesEnregistrees = useMemo(() => copieGaranties(categorie?.Compagnies?.[String(idCompagnie)] || []), [categorie, idCompagnie]);
  useEffect(() => { setGarantiesSaisies(garantiesEnregistrees); }, [garantiesEnregistrees]);

  const documentsEnregistres = useMemo(() => copieDocuments(categorie?.Documents), [categorie]);
  useEffect(() => { setDocumentsSaisis(documentsEnregistres); }, [documentsEnregistres]);
  const documentsModifies = !memesValeurs(documentsEnregistres, documentsSaisis);

  const categorieModifiee = categorie && categorieSaisie && !memesValeurs(copieCategorie(categorie), categorieSaisie);
  const garantiesModifiees = !memesValeurs(garantiesEnregistrees, garantiesSaisies);

  // ---------------------------------------------------------------- catégorie
  const changerCategorie = (cle, valeur) => setCategorieSaisie((c) => ({ ...c, [cle]: valeur }));
  const changerChamp = (index, cle, valeur) => setCategorieSaisie((c) => ({
    ...c, ChampsRisque: c.ChampsRisque.map((x, i) => (i === index ? { ...x, [cle]: valeur } : x)),
  }));
  const deplacerChamp = (index, sens) => setCategorieSaisie((c) => {
    const liste = [...c.ChampsRisque];
    const cible = index + sens;
    if (cible < 0 || cible >= liste.length) return c;
    [liste[index], liste[cible]] = [liste[cible], liste[index]];
    return { ...c, ChampsRisque: liste };
  });
  const ajouterChamp = () => setCategorieSaisie((c) => ({
    ...c, ChampsRisque: [...c.ChampsRisque, { Cle: '', Libelle: '', Type: 'texte', Obligatoire: false, nouveau: true }],
  }));

  const enregistrerCategorie = async () => {
    const cles = [];
    const champs = categorieSaisie.ChampsRisque.filter((c) => String(c.Libelle || '').trim()).map((c) => {
      const cle = c.Cle && !c.nouveau ? c.Cle : cleDepuisLibelle(c.Libelle, cles);
      cles.push(cle);
      return {
        Cle: cle, Libelle: c.Libelle.trim(), Type: c.Type, Obligatoire: Boolean(c.Obligatoire),
        ...(c.Type === 'liste' ? { Options: String(c.OptionsTexte || '').split('\n').map((o) => o.trim()).filter(Boolean) } : {}),
      };
    });
    setEnvoi('categorie');
    try {
      const maj = await parametrageApi.modifierCategorieDommages(idTarif, { ...categorieSaisie, ChampsRisque: champs });
      setDonnees((d) => ({ ...d, Categories: d.Categories.map((c) => (c.IdTarif === maj.IdTarif ? maj : c)).sort((a, b) => a.Ordre - b.Ordre || a.Libelle.localeCompare(b.Libelle)) }));
      success(`« ${maj.Libelle} » enregistrée : l'écran de devis Dommages en tient compte immédiatement.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi('');
    }
  };

  const basculerOuverture = async (c) => {
    setEnvoi(`ouverture-${c.IdTarif}`);
    try {
      const maj = await parametrageApi.modifierCategorieDommages(c.IdTarif, { SaisieOuverte: !c.SaisieOuverte });
      setDonnees((d) => ({ ...d, Categories: d.Categories.map((x) => (x.IdTarif === maj.IdTarif ? maj : x)) }));
      success(`« ${maj.Libelle} » ${maj.SaisieOuverte ? 'proposée' : 'retirée'} à la saisie des devis.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi('');
    }
  };

  // ---------------------------------------------------------------- documents de production
  const changerDocument = (index, cle, valeur) => setDocumentsSaisis((l) => l.map((d, i) => (i === index ? { ...d, [cle]: valeur } : d)));
  const ajouterDocument = () => setDocumentsSaisis((l) => [...l, {
    cle: `nouveau-${Date.now()}`, Id: null, IdCompagnie: idCompagnie || 0, Titre: '', ConditionChamp: '', ConditionValeur: '',
    Corps: '', Signataire: '', MentionSignature: '', Actif: true, Ordre: l.length + 1,
  }]);
  const enregistrerDocuments = async () => {
    setEnvoi('documents');
    try {
      const res = await parametrageApi.modifierDocumentsDommages(idTarif, documentsSaisis.map(({ cle, ...d }) => ({ ...d, Ordre: Number(d.Ordre) || 0 })));
      setDonnees((d) => ({ ...d, Categories: d.Categories.map((c) => (c.IdTarif === idTarif ? { ...c, Documents: res.Documents } : c)) }));
      success(`Documents de production de « ${categorie.Libelle} » enregistrés.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi('');
    }
  };

  // ---------------------------------------------------------------- garanties de la compagnie
  const changerGarantie = (index, cle, valeur) => setGarantiesSaisies((l) => l.map((g, i) => (i === index ? { ...g, [cle]: valeur } : g)));
  const retirerGarantie = (index) => setGarantiesSaisies((l) => l.filter((_, i) => i !== index));
  const ajouterGarantie = (sg) => {
    if (garantiesSaisies.some((g) => g.IdSousGarantie === sg.IdSousGarantie)) return;
    // Taxe proposée pour une garantie qui n'en a pas : celle des autres garanties Dommages (14,5 %)
    const tauxCourant = garantiesSaisies.find((g) => g.TauxTaxe !== null && g.TauxTaxe !== undefined)?.TauxTaxe ?? 14.5;
    setGarantiesSaisies((l) => [...l, {
      IdSousGarantie: sg.IdSousGarantie, Libelle: sg.Libelle, LibelleGarantie: sg.LibelleGarantie, TauxFranchise: 0,
      FranchiseMinimum: 0, FranchiseMaximum: 0, Ordre: l.length, TauxTaxe: sg.TauxTaxe, TauxTaxeSaisi: sg.TauxTaxe ?? tauxCourant,
      TauxDefaut: '', Obligatoire: false,
    }]);
    setRecherche('');
  };
  const copierDepuis = (idSource) => {
    const source = categorie?.Compagnies?.[String(idSource)] || [];
    setGarantiesSaisies(copieGaranties(source));
  };

  const enregistrerGaranties = async () => {
    setEnvoi('garanties');
    try {
      const res = await parametrageApi.modifierGarantiesDommages(idTarif, idCompagnie, garantiesSaisies.map((g, i) => ({
        IdSousGarantie: g.IdSousGarantie,
        TauxFranchise: g.TauxFranchise,
        FranchiseMinimum: g.FranchiseMinimum,
        FranchiseMaximum: g.FranchiseMaximum,
        Ordre: Number(g.Ordre) || 0,
        TauxDefaut: g.TauxDefaut === '' ? null : g.TauxDefaut,
        Obligatoire: g.Obligatoire,
        TauxTaxe: g.TauxTaxe === null || g.TauxTaxe === undefined ? g.TauxTaxeSaisi : undefined,
      })));
      setDonnees((d) => ({
        ...d,
        Categories: d.Categories.map((c) => {
          if (c.IdTarif !== idTarif) return c;
          const compagnies = { ...c.Compagnies };
          if (res.Garanties.length) compagnies[String(idCompagnie)] = res.Garanties; else delete compagnies[String(idCompagnie)];
          return { ...c, Compagnies: compagnies };
        }),
      }));
      success(`Garanties « ${categorie.Libelle} » chez ${nomCompagnie(idCompagnie)} enregistrées.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi('');
    }
  };

  const propositions = useMemo(() => {
    const t = recherche.trim().toLowerCase();
    if (t.length < 2 || !donnees) return [];
    return donnees.SousGaranties
      .filter((sg) => !garantiesSaisies.some((g) => g.IdSousGarantie === sg.IdSousGarantie))
      .filter((sg) => `${sg.Libelle} ${sg.LibelleGarantie} ${sg.Code}`.toLowerCase().includes(t))
      .sort((a, b) => Number(b.SaisieRd) - Number(a.SaisieRd) || a.Libelle.localeCompare(b.Libelle))
      .slice(0, 30);
  }, [recherche, donnees, garantiesSaisies]);

  const autresCompagnies = (donnees?.Compagnies || []).filter((c) => !compagniesCategorie.includes(c.IdCompagnie));

  // ---------------------------------------------------------------- affichage
  return (
    <div style={{ padding: '1.5rem' }}>
      <EnTeteParametrage
        icone={Layers}
        titre="Réglages Dommages"
        description="Ce que propose l'écran de devis Dommages : catégories ouvertes à la saisie (Caution, Tous Risques Informatiques, Chantiers, Bris de Machines…), description du risque demandée et garanties de chaque catégorie par compagnie."
        usage="Les primes se calculent garantie par garantie : capital × taux, ou prime saisie, puis réduction, taxe de la garantie et accessoire du barème de la compagnie. Une modification s'applique aux nouveaux calculs ; les devis déjà enregistrés gardent leurs montants."
        actions={(
          <>
            <Link to="/admin/settings/taxes" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Percent size={15} /> Taxes</Link>
            <Link to="/admin/settings/tarifs" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Receipt size={15} /> Accessoires</Link>
            <Link to="/admin/settings/commissions-baremes" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Coins size={15} /> Commissions</Link>
            <Link to="/admin/settings/offres" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Boxes size={15} /> Offres</Link>
          </>
        )}
      />

      {chargement || !donnees ? (
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}><Loader2 className="spin" /> Chargement…</div>
      ) : (
        <div style={{ display: 'flex', gap: '1.1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* CATÉGORIES */}
          <div className="glass-panel" style={{ flex: '1 1 280px', maxWidth: 340, padding: '0.75rem', position: 'sticky', top: '1rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', padding: '0.25rem 0.4rem 0.6rem' }}>
              Catégories ({donnees.Categories.filter((c) => c.SaisieOuverte).length} ouvertes sur {donnees.Categories.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {donnees.Categories.map((c) => {
                const choisie = c.IdTarif === idTarif;
                const nbCies = Object.keys(c.Compagnies).length;
                return (
                  <div key={c.IdTarif} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 0.6rem', borderRadius: 10, cursor: 'pointer', border: `1px solid ${choisie ? 'var(--primary-500)' : 'transparent'}`, background: choisie ? 'var(--primary-glow)' : 'transparent' }}
                    onClick={() => setIdTarif(c.IdTarif)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setIdTarif(c.IdTarif); }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text-primary)', opacity: c.SaisieOuverte ? 1 : 0.55 }}>{c.Libelle}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Code {c.CodeCategorie} • {nbCies ? `${nbCies} compagnie${nbCies > 1 ? 's' : ''}` : <span style={{ color: 'var(--accent-amber)' }}>aucune garantie</span>}
                        {c.NbDevis ? ` • ${c.NbDevis} devis` : ''}
                      </div>
                    </div>
                    <span onClick={(e) => e.stopPropagation()} role="presentation">
                      <Interrupteur actif={c.SaisieOuverte} desactive={envoi === `ouverture-${c.IdTarif}`} onChange={() => basculerOuverture(c)}
                        titre={c.SaisieOuverte ? 'Proposée à la saisie : cliquer pour la retirer' : 'Retirée de la saisie : cliquer pour la proposer'} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DÉTAIL DE LA CATÉGORIE */}
          {categorie && categorieSaisie && (
            <div style={{ flex: '3 1 640px', minWidth: 0 }}>
              <SectionParametrage
                icone={ClipboardList}
                titre={`${categorie.Libelle} - code ${categorie.CodeCategorie}`}
                description={`Offre « ${categorie.LibelleOffre || '-'} » (n° ${categorie.IdOffre || '-'}). Description affichée sous la catégorie dans l'écran de devis, rubriques du risque demandées à la saisie et textes de la fiche de cotation imprimée.`}
                actions={categorieModifiee && (
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button type="button" className="btn btn-secondary" title="Annuler les changements" onClick={() => setCategorieSaisie(copieCategorie(categorie))} style={{ padding: '0.3rem 0.5rem' }}><RotateCcw size={14} /></button>
                    <button type="button" className="btn btn-primary" disabled={envoi === 'categorie'} onClick={enregistrerCategorie} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                      {envoi === 'categorie' ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer
                    </button>
                  </div>
                )}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0.9rem 1.1rem' }}>
                  <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
                    <label className="form-label">Description (écran de devis)</label>
                    <textarea className="form-control" rows={2} maxLength={400} value={categorieSaisie.Description} onChange={(e) => changerCategorie('Description', e.target.value)} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Ordre d'affichage</label>
                    <input type="number" className="form-control" min={0} max={999} value={categorieSaisie.Ordre} onChange={(e) => changerCategorie('Ordre', e.target.value)} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Proposée à la saisie</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '2.4rem' }}>
                      <Interrupteur actif={categorieSaisie.SaisieOuverte} onChange={(v) => changerCategorie('SaisieOuverte', v)} />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{categorieSaisie.SaisieOuverte ? 'Oui' : 'Non (devis existants modifiables)'}</span>
                    </div>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Prime au prorata de la durée</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '2.4rem' }}>
                      <Interrupteur actif={categorieSaisie.Prorata} onChange={(v) => changerCategorie('Prorata', v)} />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{categorieSaisie.Prorata ? 'Jours couverts / 365 si le contrat n\'est pas annuel' : 'Non : prime saisie pour la période'}</span>
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', margin: '1.25rem 0 0.5rem' }}>Description du risque demandée à la saisie</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                    <thead>
                      <tr><th style={entete}>Libellé du champ</th><th style={{ ...entete, width: 190 }}>Type</th><th style={{ ...entete, width: 95 }}>Obligatoire</th><th style={{ ...entete, width: 120 }} /></tr>
                    </thead>
                    <tbody>
                      {categorieSaisie.ChampsRisque.map((c, i) => (
                        <tr key={c.Cle || `nouveau-${i}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td style={cellule}>
                            <input className="form-control" maxLength={80} value={c.Libelle} placeholder="Ex. Bénéficiaire de la caution" onChange={(e) => changerChamp(i, 'Libelle', e.target.value)} />
                            {c.Cle && !c.nouveau && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Identifiant : {c.Cle}</span>}
                            {c.Type === 'liste' && (
                              <textarea className="form-control" rows={Math.min(6, Math.max(2, String(c.OptionsTexte || '').split('\n').length))} value={c.OptionsTexte || ''}
                                placeholder="Choix de la liste, un par ligne" onChange={(e) => changerChamp(i, 'OptionsTexte', e.target.value)}
                                style={{ display: 'block', marginTop: '0.35rem', fontSize: '0.78rem' }} />
                            )}
                          </td>
                          <td style={cellule}>
                            <select className="form-control" value={c.Type} onChange={(e) => changerChamp(i, 'Type', e.target.value)}>
                              {donnees.TypesChamp.map((t) => <option key={t.Code} value={t.Code}>{t.Libelle}</option>)}
                            </select>
                          </td>
                          <td style={cellule}><div style={{ paddingTop: '0.45rem' }}><Interrupteur actif={Boolean(c.Obligatoire)} onChange={(v) => changerChamp(i, 'Obligatoire', v)} /></div></td>
                          <td style={{ ...cellule, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button type="button" className="btn btn-secondary" title="Monter" disabled={i === 0} onClick={() => deplacerChamp(i, -1)} style={{ padding: '0.3rem 0.45rem' }}><ArrowUp size={13} /></button>{' '}
                            <button type="button" className="btn btn-secondary" title="Descendre" disabled={i === categorieSaisie.ChampsRisque.length - 1} onClick={() => deplacerChamp(i, 1)} style={{ padding: '0.3rem 0.45rem' }}><ArrowDown size={13} /></button>{' '}
                            <button type="button" className="btn btn-secondary" title="Retirer ce champ" onClick={() => changerCategorie('ChampsRisque', categorieSaisie.ChampsRisque.filter((_, j) => j !== i))} style={{ padding: '0.3rem 0.45rem', color: 'var(--accent-rose)' }}><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="btn btn-secondary" onClick={ajouterChamp} disabled={categorieSaisie.ChampsRisque.length >= 15} style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  <Plus size={14} /> Ajouter un champ
                </button>

                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', margin: '1.4rem 0 0.5rem' }}>Fiche de cotation imprimée</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '0.9rem 1.1rem' }}>
                  {[
                    ['ObjetGarantie', 'Objet de la garantie', 'Texte de la rubrique « Objet de la garantie »'],
                    ['ContreGaranties', 'Contre-garanties et mesures préalables', 'Pièces demandées, une par ligne'],
                    ['Exclusions', 'Exclusions', 'Une exclusion par ligne'],
                  ].map(([cle, libelle, aide]) => (
                    <div key={cle} className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">{libelle}</label>
                      <textarea className="form-control" rows={4} maxLength={2000} value={categorieSaisie[cle]} placeholder={aide} onChange={(e) => changerCategorie(cle, e.target.value)} />
                    </div>
                  ))}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Tableau des garanties en annexe</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '2.4rem' }}>
                      <Interrupteur actif={categorieSaisie.AnnexeCotation} onChange={(v) => changerCategorie('AnnexeCotation', v)} />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {categorieSaisie.AnnexeCotation ? 'Oui : page « Annexe - tableau des garanties »' : 'Non : garanties citées dans la cotation (une seule page)'}
                      </span>
                    </div>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Référence sur la facture de prime</label>
                    <input className="form-control" maxLength={200} value={categorieSaisie.ReferenceFacture} placeholder="Ex. {numero_appel_offres} {beneficiaire}"
                      onChange={(e) => changerCategorie('ReferenceFacture', e.target.value)} />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Imprimée entre parenthèses après « ASSURANCE {categorie.Libelle.replace(/^ASSURANCE\s+/i, '')} » ; champs du risque entre accolades.</span>
                  </div>
                </div>
              </SectionParametrage>

              <SectionParametrage
                icone={FileText}
                titre="Documents de production"
                description="Documents imprimés depuis la fiche d'un contrat de cette catégorie, en plus de la cotation, du relevé de compte et de la facture de prime (ex. « Garantie de soumission » d'une caution). Le texte reprend les données du contrat et du risque saisi : écrivez un champ entre accolades, il sera remplacé à l'impression (champ vide : pointillés à compléter à la main)."
                actions={documentsModifies && (
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button type="button" className="btn btn-secondary" title="Annuler les changements" onClick={() => setDocumentsSaisis(documentsEnregistres)} style={{ padding: '0.3rem 0.5rem' }}><RotateCcw size={14} /></button>
                    <button type="button" className="btn btn-primary" disabled={envoi === 'documents'} onClick={enregistrerDocuments} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                      {envoi === 'documents' ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer
                    </button>
                  </div>
                )}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.6, padding: '0.6rem 0.8rem', borderRadius: 8, border: '1px solid var(--border-subtle)', marginBottom: '0.9rem' }}>
                  <strong>Champs disponibles :</strong>{' '}
                  {[...CHAMPS_DOCUMENT, ...categorieSaisie.ChampsRisque.filter((c) => c.Cle && !c.nouveau).flatMap((c) => [
                    [c.Cle, c.Libelle.toLowerCase()],
                    ...(c.Type === 'date' || c.Type === 'montant' ? [[`${c.Cle}_lettres`, `${c.Libelle.toLowerCase()} en lettres`]] : []),
                  ])].map(([cle, libelle], i) => (
                    <span key={cle}>{i ? ' • ' : ''}<code style={{ fontSize: '0.72rem' }}>{`{${cle}}`}</code> {libelle}</span>
                  ))}
                  <br />
                  <code style={{ fontSize: '0.72rem' }}>{'{champ:maj}'}</code> : en majuscules • <code style={{ fontSize: '0.72rem' }}>**texte**</code> : en gras •
                  ligne vide : nouveau paragraphe • « a) », « 1. » : liste • espaces en début de ligne : retrait.
                </div>
                {!documentsSaisis.length && <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>Aucun document de production pour cette catégorie.</div>}
                {documentsSaisis.map((d, i) => (
                  <div key={d.cle} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '0.85rem', marginBottom: '0.85rem', opacity: d.Actif ? 1 : 0.65 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '0.75rem 1rem', alignItems: 'end' }}>
                      <div className="form-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                        <label className="form-label">Titre imprimé</label>
                        <input className="form-control" maxLength={120} value={d.Titre} placeholder="Ex. GARANTIE DE SOUMISSION" onChange={(e) => changerDocument(i, 'Titre', e.target.value)} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Compagnie (logo, pied de page)</label>
                        <select className="form-control" value={d.IdCompagnie} onChange={(e) => changerDocument(i, 'IdCompagnie', Number(e.target.value))}>
                          <option value={0}>Toutes les compagnies</option>
                          {donnees.Compagnies.map((c) => <option key={c.IdCompagnie} value={c.IdCompagnie}>{c.RaisonSociale}</option>)}
                        </select>
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Proposé si le champ…</label>
                        <select className="form-control" value={d.ConditionChamp} onChange={(e) => changerDocument(i, 'ConditionChamp', e.target.value)}>
                          <option value="">Toujours proposé</option>
                          {categorieSaisie.ChampsRisque.filter((c) => c.Cle && !c.nouveau).map((c) => <option key={c.Cle} value={c.Cle}>{c.Libelle}</option>)}
                        </select>
                      </div>
                      {d.ConditionChamp && (
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label">…contient</label>
                          <input className="form-control" maxLength={120} value={d.ConditionValeur} placeholder="Ex. SOUMISSION" onChange={(e) => changerDocument(i, 'ConditionValeur', e.target.value)} />
                        </div>
                      )}
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Actif</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minHeight: '2.4rem' }}>
                          <Interrupteur actif={Boolean(d.Actif)} onChange={(v) => changerDocument(i, 'Actif', v)} />
                          <input type="number" className="form-control" min={0} max={999} value={d.Ordre} title="Ordre d'affichage" onChange={(e) => changerDocument(i, 'Ordre', e.target.value)} style={{ width: 70 }} />
                          <button type="button" className="btn btn-secondary" title="Supprimer ce document" onClick={() => setDocumentsSaisis((l) => l.filter((_, j) => j !== i))} style={{ padding: '0.3rem 0.45rem', color: 'var(--accent-rose)' }}><Trash2 size={13} /></button>
                        </div>
                      </div>
                    </div>
                    <div className="form-group" style={{ margin: '0.75rem 0 0' }}>
                      <label className="form-label">Texte</label>
                      <textarea className="form-control" rows={14} maxLength={12000} value={d.Corps} onChange={(e) => changerDocument(i, 'Corps', e.target.value)}
                        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', lineHeight: 1.45 }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '0.75rem 1rem', marginTop: '0.75rem' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Signataire (nom, puis fonction)</label>
                        <textarea className="form-control" rows={2} maxLength={400} value={d.Signataire} onChange={(e) => changerDocument(i, 'Signataire', e.target.value)} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Mention sous la signature</label>
                        <input className="form-control" maxLength={200} value={d.MentionSignature} placeholder="Ex. NSIA ASSURANCES COTE D'IVOIRE" onChange={(e) => changerDocument(i, 'MentionSignature', e.target.value)} />
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary" onClick={ajouterDocument} disabled={documentsSaisis.length >= 10} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  <Plus size={14} /> Ajouter un document
                </button>
              </SectionParametrage>

              <SectionParametrage
                icone={ShieldCheck}
                titre="Garanties par compagnie"
                description="Garanties proposées pour cette catégorie chez la compagnie : taxe d'enregistrement, taux de prime proposé (laisser vide : prime saisie en montant), franchise imprimée sur les Conditions Particulières, garantie obligatoire (toujours retenue)."
                actions={garantiesModifiees && (
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button type="button" className="btn btn-secondary" title="Annuler les changements" onClick={() => setGarantiesSaisies(garantiesEnregistrees)} style={{ padding: '0.3rem 0.5rem' }}><RotateCcw size={14} /></button>
                    <button type="button" className="btn btn-primary" disabled={envoi === 'garanties'} onClick={enregistrerGaranties} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                      {envoi === 'garanties' ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer
                    </button>
                  </div>
                )}
              >
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.9rem' }}>
                  {[...compagniesCategorie, ...(compagniesCategorie.includes(idCompagnie) ? [] : [idCompagnie])].map((id) => (
                    <button key={id} type="button" onClick={() => setIdCompagnie(id)}
                      className={id === idCompagnie ? 'btn btn-primary' : 'btn btn-secondary'} style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
                      {nomCompagnie(id)}{categorie.Compagnies[String(id)] ? ` (${categorie.Compagnies[String(id)].length})` : ' (nouvelle)'}
                    </button>
                  ))}
                  {autresCompagnies.length > 0 && (
                    <select className="form-control" value="" onChange={(e) => e.target.value && setIdCompagnie(Number(e.target.value))} style={{ width: 'auto', minWidth: 210, fontSize: '0.8rem' }}>
                      <option value="">+ Paramétrer une autre compagnie…</option>
                      {autresCompagnies.map((c) => <option key={c.IdCompagnie} value={c.IdCompagnie}>{c.RaisonSociale}</option>)}
                    </select>
                  )}
                </div>

                {!garantiesSaisies.length && (
                  <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start', padding: '0.7rem 0.85rem', borderRadius: 8, border: '1px solid var(--accent-amber)', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                    <AlertTriangle size={16} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />
                    <span>
                      Aucune garantie chez {nomCompagnie(idCompagnie)} : la catégorie n'est pas tarifable pour cette compagnie.
                      {compagniesCategorie.filter((id) => id !== idCompagnie).length > 0 && ' Ajoutez des garanties ou copiez celles d\'une autre compagnie.'}
                    </span>
                  </div>
                )}

                {garantiesSaisies.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                      <thead>
                        <tr>
                          <th style={{ ...entete, width: 58 }}>Ordre</th>
                          <th style={entete}>Garantie</th>
                          <th style={{ ...entete, width: 74 }}>Taxe %</th>
                          <th style={{ ...entete, width: 100 }}>Taux proposé %</th>
                          <th style={{ ...entete, width: 215 }}>Franchise (%, minimum, maximum)</th>
                          <th style={{ ...entete, width: 82 }}>Obligatoire</th>
                          <th style={{ ...entete, width: 42 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {garantiesSaisies.map((g, i) => (
                          <tr key={g.IdSousGarantie} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                            <td style={cellule}><input type="number" className="form-control" min={0} max={999} value={g.Ordre} onChange={(e) => changerGarantie(i, 'Ordre', e.target.value)} style={{ width: 54 }} /></td>
                            <td style={cellule}>
                              <div style={{ fontWeight: 700, fontSize: '0.83rem', color: 'var(--text-primary)' }}>{g.Libelle}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{g.LibelleGarantie} • n° {g.IdSousGarantie}</div>
                            </td>
                            <td style={cellule}>
                              {g.TauxTaxe !== null && g.TauxTaxe !== undefined ? (
                                <div style={{ paddingTop: '0.45rem', fontWeight: 700, fontSize: '0.83rem' }} title="Se modifie dans « Taxes » (période de validité)">{g.TauxTaxe} <Lock size={11} style={{ color: 'var(--text-muted)' }} /></div>
                              ) : (
                                <input type="number" className="form-control" min={0} max={100} step="0.01" value={g.TauxTaxeSaisi} title="Garantie sans taxe Dommages : taux créé à l'enregistrement"
                                  onChange={(e) => changerGarantie(i, 'TauxTaxeSaisi', e.target.value)} style={{ borderColor: 'var(--accent-amber)' }} />
                              )}
                            </td>
                            <td style={cellule}><input type="number" className="form-control" min={0} max={100} step="0.0001" placeholder="montant" value={g.TauxDefaut} onChange={(e) => changerGarantie(i, 'TauxDefaut', e.target.value)} /></td>
                            <td style={cellule}>
                              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-start' }}>
                                <input type="number" className="form-control" min={0} max={100} step="0.01" value={g.TauxFranchise} title="Taux de franchise (% du sinistre)" onChange={(e) => changerGarantie(i, 'TauxFranchise', Number(e.target.value) || 0)} style={{ width: 66, flexShrink: 0 }} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: 1, minWidth: 0 }}>
                                  <AmountInput value={Math.round(g.FranchiseMinimum || 0)} onChange={(v) => changerGarantie(i, 'FranchiseMinimum', v)} suffix="min" />
                                  <AmountInput value={Math.round(g.FranchiseMaximum || 0)} onChange={(v) => changerGarantie(i, 'FranchiseMaximum', v)} suffix="max" />
                                </div>
                              </div>
                            </td>
                            <td style={cellule}><div style={{ paddingTop: '0.45rem' }}><Interrupteur actif={Boolean(g.Obligatoire)} onChange={(v) => changerGarantie(i, 'Obligatoire', v)} /></div></td>
                            <td style={cellule}>
                              <button type="button" className="btn btn-secondary" title="Retirer cette garantie de l'offre" onClick={() => retirerGarantie(i)} style={{ padding: '0.3rem 0.45rem', color: 'var(--accent-rose)' }}><Trash2 size={13} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start', marginTop: '0.85rem' }}>
                  <div style={{ position: 'relative', flex: '1 1 320px', maxWidth: 520 }}>
                    <Search size={15} style={{ position: 'absolute', left: '0.7rem', top: '0.75rem', color: 'var(--text-muted)' }} />
                    <input className="form-control" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Ajouter une garantie : tapez son nom (2 lettres au moins)…" style={{ paddingLeft: '2.1rem' }} />
                    {propositions.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4, maxHeight: 260, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-surface-elevated)', boxShadow: 'var(--shadow-lg)' }}>
                        {propositions.map((sg) => (
                          <div key={sg.IdSousGarantie} role="button" tabIndex={0} onMouseDown={() => ajouterGarantie(sg)}
                            style={{ padding: '0.5rem 0.8rem', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.82rem' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{sg.Libelle}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {sg.LibelleGarantie} • code {sg.Code}{sg.TauxTaxe !== null && sg.TauxTaxe !== undefined ? ` • taxe Dommages ${sg.TauxTaxe} %` : ' • sans taxe Dommages'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {compagniesCategorie.filter((id) => id !== idCompagnie).length > 0 && (
                    <select className="form-control" value="" onChange={(e) => e.target.value && copierDepuis(Number(e.target.value))} style={{ width: 'auto', minWidth: 230 }}>
                      <option value="">Copier les garanties de…</option>
                      {compagniesCategorie.filter((id) => id !== idCompagnie).map((id) => <option key={id} value={id}>{nomCompagnie(id)}</option>)}
                    </select>
                  )}
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.75rem 0 0', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <Copy size={12} /> Une garantie manquante se crée dans « Garanties &amp; sous-garanties ». Retirer une garantie ne change pas les devis déjà enregistrés.
                </p>
              </SectionParametrage>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ParametrageDommagesPage;
