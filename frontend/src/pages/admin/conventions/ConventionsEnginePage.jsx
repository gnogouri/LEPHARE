import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ChevronDown, ChevronRight, Clock, Edit3, FileSignature, HandCoins, Loader2, RefreshCw, Search, Wallet,
} from 'lucide-react';
import { conventionsApi } from '../../../api/endpoints';
import { MetricCard } from '../../../components/common/MetricCard';
import { Modal } from '../../../components/common/Modal';
import { AmountInput } from '../../../components/common/AmountInput';
import { Champ } from '../../../components/common/RechercheClient';
import { useToast } from '../../../context/ToastContext';
import { messageErreurApi } from '../../../utils/financeUtils';

/* =========================================================================
   CONVENTIONS AVEC LES COMPAGNIES
   Refaite le 2026-10-28 sur les données réelles (demande : « actualise les informations de cette vue ») : une ligne
   par compagnie du référentiel, avec son code intermédiaire, les taux de commission en vigueur, les primes à
   reverser et les commissions (mêmes montants que les écrans des reversements et des commissions), l'activité de
   l'exercice et les conditions de la convention, saisies ici et enregistrées en base (production/views_conventions.py).
   L'ancienne vue montrait quatre conventions de démonstration et des chiffres écrits dans l'écran.
   ========================================================================= */

const fcfa = (v) => `${Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`;
const nombre = (v) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');
const dateFr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const FILTRES = [
  ['TOUTES', 'Compagnies'],
  ['ACTIVITE', 'Avec activité'],
  ['A_REVERSER', 'Avec primes à reverser'],
  ['CONVENTION', 'Convention renseignée'],
  ['SANS_CONVENTION', 'Convention à renseigner'],
];
const CONDITIONS_VIDES = {
  EncaissementDelegue: true, DelaiReversementJours: 30, PlafondDelegationSinistre: 0,
  ParticipationBeneficiaire: { Active: false, Taux: '', SeuilSp: '' }, DateEffet: '', DateRenouvellement: '', Statut: 'Actif',
};
const aActivite = (c) => c.Activite.ContratsEnVigueur > 0 || c.Activite.ContratsExercice > 0 || c.Activite.AReverser.Montant > 0
  || c.Activite.Commissions.Dues > 0;

const Ligne = ({ libelle, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.35rem 0', borderBottom: '1px dashed var(--border-subtle)', fontSize: '0.82rem' }}>
    <span style={{ color: 'var(--text-muted)' }}>{libelle}</span>
    <span style={{ fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{children}</span>
  </div>
);
const Bloc = ({ titre, children }) => (
  <div style={{ padding: '0.85rem 1rem', borderRadius: '10px', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-elevated)' }}>
    <div style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>{titre}</div>
    {children}
  </div>
);

// ------------------------------------------------------------------ détail d'une compagnie
const DetailCompagnie = ({ c, exercice, onConditions, onFiche }) => {
  const a = c.Activite;
  const conv = c.Convention;
  const pb = conv?.ParticipationBeneficiaire;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '0.75rem', padding: '0.25rem 0 0.5rem' }}>
      <Bloc titre={`Activité ${exercice}`}>
        <Ligne libelle="Polices en vigueur">{nombre(a.ContratsEnVigueur)}</Ligne>
        <Ligne libelle={`Contrats émis en ${exercice}`}>{nombre(a.ContratsExercice)}</Ligne>
        <Ligne libelle="Primes TTC émises">{fcfa(a.PrimesExercice)}</Ligne>
        <Ligne libelle="Dernière émission">{dateFr(a.DerniereEmission)}</Ligne>
      </Bloc>
      <Bloc titre="Reversements et commissions">
        <Ligne libelle="Primes à reverser">{a.AReverser.Montant ? `${fcfa(a.AReverser.Montant)} (${a.AReverser.Nombre})` : '-'}</Ligne>
        <Ligne libelle="Plus ancien encaissement à reverser">{dateFr(a.AReverser.PlusAncien)}</Ligne>
        <Ligne libelle="Commissions dues">{fcfa(a.Commissions.Dues)}</Ligne>
        <Ligne libelle="Commissions payées">{fcfa(a.Commissions.Payees)}{a.Commissions.Dues ? ` (${nombre(a.Commissions.TauxRecouvrement)} %)` : ''}</Ligne>
        <Ligne libelle="En attente de paiement">{fcfa(a.Commissions.EnAttente)}</Ligne>
      </Bloc>
      <Bloc titre="Taux de commission en vigueur">
        {c.Taux.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>Aucun taux en vigueur pour cette compagnie.</p>}
        {c.Taux.map((t) => (
          <Ligne key={t.IdProduit} libelle={t.Branche || `Produit ${t.IdProduit}`}>
            {nombre(t.Taux)} %{t.Forfait ? ` + ${fcfa(t.Forfait)}` : ''}
          </Ligne>
        ))}
        <Ligne libelle="Part du cabinet dans les accessoires">
          {c.PartAccessoiresCabinet === null ? '-' : `${nombre(c.PartAccessoiresCabinet)} %`}
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{c.PartAccessoiresReglee ? ' (fiche compagnie)' : ' (barème du cabinet)'}</span>
        </Ligne>
      </Bloc>
      <Bloc titre="Conditions de la convention">
        {conv ? (
          <>
            <Ligne libelle="Statut">{conv.Statut}</Ligne>
            <Ligne libelle="Mandat d'encaissement">{conv.EncaissementDelegue ? 'Délégué au cabinet' : 'Encaissement par la compagnie'}</Ligne>
            <Ligne libelle="Délai de reversement">{conv.DelaiReversementJours} jours</Ligne>
            <Ligne libelle="Plafond de délégation des sinistres">{conv.PlafondDelegationSinistre ? fcfa(conv.PlafondDelegationSinistre) : 'Aucune délégation'}</Ligne>
            <Ligne libelle="Participation bénéficiaire">
              {pb?.Active ? `${pb.Taux !== null && pb.Taux !== undefined ? `${nombre(pb.Taux)} %` : 'Oui'}${pb.SeuilSp !== null && pb.SeuilSp !== undefined ? `, S/P au plus ${nombre(pb.SeuilSp)} %` : ''}` : 'Non'}
            </Ligne>
            <Ligne libelle="Période">{conv.DateEffet || conv.DateRenouvellement ? `${dateFr(conv.DateEffet)} au ${dateFr(conv.DateRenouvellement)}` : '-'}</Ligne>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>Mise à jour le {dateFr(conv.DateMaj)}{conv.MajPar ? ` par ${conv.MajPar}` : ''}</div>
          </>
        ) : (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>Conditions non renseignées : mandat d'encaissement, délai de reversement, délégation des sinistres.</p>
        )}
      </Bloc>
      <Bloc titre="Coordonnées et courriers">
        <Ligne libelle="Adresse">{c.Coordonnees.Adresse || '-'}</Ligne>
        <Ligne libelle="Téléphone">{[c.Coordonnees.Telephone, c.Coordonnees.Mobile].filter(Boolean).join(', ') || '-'}</Ligne>
        <Ligne libelle="Courriers adressés à">{[c.Courrier.Destinataire, c.Courrier.Service, c.Courrier.Ville].filter(Boolean).join(', ') || '-'}</Ligne>
        {c.Courrier.AttentionDe && <Ligne libelle="À l'attention de">{c.Courrier.AttentionDe}</Ligne>}
        {[['Production Auto', c.Coordonnees.ResponsableProductionAuto], ['Production risques divers', c.Coordonnees.ResponsableProductionRisquesDivers],
          ['Sinistres Auto', c.Coordonnees.ResponsableSinistresAuto], ['Sinistres risques divers', c.Coordonnees.ResponsableSinistresRisquesDivers]]
          .filter(([, v]) => v).map(([l, v]) => <Ligne key={l} libelle={`Responsable ${l}`}>{v}</Ligne>)}
      </Bloc>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={() => onConditions(c)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Edit3 size={15} /> {conv ? 'Modifier les conditions' : 'Renseigner les conditions'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onFiche} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Building2 size={15} /> Fiche compagnie
        </button>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ conditions de la convention
const FormulaireConditions = ({ compagnie, statuts, onFermer, onEnregistre }) => {
  const { success, error: toastError } = useToast();
  const [f, setF] = useState(() => {
    const c = compagnie.Convention;
    if (!c) return CONDITIONS_VIDES;
    return {
      ...c,
      ParticipationBeneficiaire: {
        Active: Boolean(c.ParticipationBeneficiaire?.Active),
        Taux: c.ParticipationBeneficiaire?.Taux ?? '', SeuilSp: c.ParticipationBeneficiaire?.SeuilSp ?? '',
      },
      DateEffet: c.DateEffet || '', DateRenouvellement: c.DateRenouvellement || '',
    };
  });
  const [envoi, setEnvoi] = useState(false);
  const changer = (cle, valeur) => setF((x) => ({ ...x, [cle]: valeur }));
  const changerPb = (cle, valeur) => setF((x) => ({ ...x, ParticipationBeneficiaire: { ...x.ParticipationBeneficiaire, [cle]: valeur } }));
  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const r = await conventionsApi.enregistrerConditions(compagnie.IdCompagnie, f);
      success(r.message);
      onEnregistre(r);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };
  const grille = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '1rem' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={grille}>
        <Champ label="Statut">
          <select className="form-control" value={f.Statut} onChange={(e) => changer('Statut', e.target.value)}>
            {statuts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Champ>
        <Champ label="Mandat d'encaissement">
          <select className="form-control" value={f.EncaissementDelegue ? 'oui' : 'non'} onChange={(e) => changer('EncaissementDelegue', e.target.value === 'oui')}>
            <option value="oui">Délégué au cabinet</option>
            <option value="non">Encaissement par la compagnie</option>
          </select>
        </Champ>
        <Champ label="Délai de reversement (jours)" aide="Après l'encaissement de la prime">
          <input type="number" min="0" max="365" className="form-control" value={f.DelaiReversementJours} onChange={(e) => changer('DelaiReversementJours', e.target.value)} />
        </Champ>
        <Champ label="Plafond de délégation des sinistres" aide="0 : pas de délégation">
          <AmountInput value={f.PlafondDelegationSinistre} onChange={(v) => changer('PlafondDelegationSinistre', v)} suffix="F" />
        </Champ>
        <Champ label="Date d'effet">
          <input type="date" className="form-control" value={f.DateEffet} onChange={(e) => changer('DateEffet', e.target.value)} />
        </Champ>
        <Champ label="Date de renouvellement">
          <input type="date" className="form-control" min={f.DateEffet || undefined} value={f.DateRenouvellement} onChange={(e) => changer('DateRenouvellement', e.target.value)} />
        </Champ>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
        <input type="checkbox" checked={f.ParticipationBeneficiaire.Active} onChange={(e) => changerPb('Active', e.target.checked)} style={{ width: 17, height: 17 }} />
        Participation bénéficiaire prévue par la convention
      </label>
      {f.ParticipationBeneficiaire.Active && (
        <div style={grille}>
          <Champ label="Taux de participation (%)">
            <input type="number" min="0" max="100" step="0.01" className="form-control" value={f.ParticipationBeneficiaire.Taux} onChange={(e) => changerPb('Taux', e.target.value)} />
          </Champ>
          <Champ label="Rapport sinistres / primes au plus (%)">
            <input type="number" min="0" max="100" step="0.01" className="form-control" value={f.ParticipationBeneficiaire.SeuilSp} onChange={(e) => changerPb('SeuilSp', e.target.value)} />
          </Champ>
        </div>
      )}
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
        Le code intermédiaire, les taux de commission et la part du cabinet dans les accessoires se règlent ailleurs : Compagnies partenaires et barèmes de commissions.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
        <button type="button" className="btn btn-secondary" onClick={onFermer} disabled={envoi}>Annuler</button>
        <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={envoi} aria-busy={envoi} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {envoi && <Loader2 size={15} className="spin" />} Enregistrer
        </button>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ page
export const ConventionsEnginePage = () => {
  const navigate = useNavigate();
  const { error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState('TOUTES');
  const [ouverte, setOuverte] = useState(null);
  const [conditionsPour, setConditionsPour] = useState(null);

  const charger = () => {
    setChargement(true);
    conventionsApi.parCompagnie()
      .then(setDonnees)
      .catch((err) => toastError(`Conventions non chargées : ${messageErreurApi(err)}`))
      .finally(() => setChargement(false));
  };
  useEffect(() => { charger(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const compagnies = donnees?.Compagnies || [];
  // Compagnies actives d'abord, puis par activité (polices en vigueur, primes émises), puis par nom
  const liste = useMemo(() => {
    const t = recherche.trim().toLowerCase();
    return compagnies
      .filter((c) => !t || `${c.Compagnie} ${c.CodeIntermediaire}`.toLowerCase().includes(t))
      .filter((c) => (filtre === 'ACTIVITE' ? aActivite(c)
        : filtre === 'A_REVERSER' ? c.Activite.AReverser.Montant > 0
          : filtre === 'CONVENTION' ? Boolean(c.Convention)
            : filtre === 'SANS_CONVENTION' ? !c.Convention : true))
      .sort((a, b) => (Number(b.Active) - Number(a.Active)) || (b.Activite.ContratsEnVigueur - a.Activite.ContratsEnVigueur)
        || (b.Activite.PrimesExercice - a.Activite.PrimesExercice) || a.Compagnie.localeCompare(b.Compagnie, 'fr'));
  }, [compagnies, recherche, filtre]);

  const actives = compagnies.filter((c) => c.Active);
  const avecPolices = compagnies.filter((c) => c.Activite.ContratsEnVigueur > 0);
  const aReverser = compagnies.filter((c) => c.Activite.AReverser.Montant > 0);
  const somme = (cles) => compagnies.reduce((s, c) => s + Number(cles(c) || 0), 0);
  const plusAncien = aReverser.map((c) => c.Activite.AReverser.PlusAncien).filter(Boolean).sort()[0];
  const avecConvention = compagnies.filter((c) => c.Convention).length;

  const th = { textAlign: 'left', padding: '0.55rem 0.6rem', fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-medium)', whiteSpace: 'nowrap' };
  const td = { padding: '0.55rem 0.6rem', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: '0.84rem', verticalAlign: 'middle' };
  const num = { textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <FileSignature size={26} color="#3b82f6" /> Conventions avec les compagnies
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Compagnies partenaires du cabinet : code intermédiaire, taux de commission en vigueur, primes à reverser, commissions et conditions de la convention.
            {donnees && <> Situation au {dateFr(donnees.Situation)}.</>}
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={charger} disabled={chargement} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <RefreshCw size={15} className={chargement ? 'spin' : undefined} /> Actualiser
        </button>
      </div>

      {donnees && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <MetricCard title="Compagnies partenaires" value={nombre(actives.length)} subtitle={`${nombre(avecConvention)} convention${avecConvention > 1 ? 's' : ''} renseignée${avecConvention > 1 ? 's' : ''}`} icon={<Building2 size={22} color="#60a5fa" />} />
          <MetricCard title="Polices en vigueur" value={nombre(somme((c) => c.Activite.ContratsEnVigueur))} subtitle={`chez ${nombre(avecPolices.length)} compagnie${avecPolices.length > 1 ? 's' : ''}`} icon={<Clock size={22} color="#34d399" />} color="emerald" />
          <MetricCard title="Primes à reverser" value={fcfa(somme((c) => c.Activite.AReverser.Montant))} subtitle={aReverser.length ? `${nombre(aReverser.length)} compagnie${aReverser.length > 1 ? 's' : ''}, depuis le ${dateFr(plusAncien)}` : 'Rien à reverser'} icon={<Wallet size={22} color="#fbbf24" />} color="amber" />
          <MetricCard title="Commissions en attente" value={fcfa(somme((c) => c.Activite.Commissions.EnAttente))} subtitle={`Payées : ${fcfa(somme((c) => c.Activite.Commissions.Payees))}`} icon={<HandCoins size={22} color="#c084fc" />} color="purple" />
        </div>
      )}

      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
            <Search size={15} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input type="search" className="form-control" placeholder="Rechercher une compagnie ou un code intermédiaire" value={recherche}
              onChange={(e) => setRecherche(e.target.value)} style={{ paddingLeft: '2.1rem' }} aria-label="Rechercher une compagnie" />
          </div>
          <select className="form-control" value={filtre} onChange={(e) => setFiltre(e.target.value)} style={{ width: 'auto', minWidth: 220 }} aria-label="Filtrer les compagnies">
            {FILTRES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {chargement && !donnees ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}><Loader2 size={15} className="spin" /> Lecture des compagnies…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Compagnie</th>
                  <th style={th}>Code intermédiaire</th>
                  <th style={{ ...th, textAlign: 'right' }}>Polices en vigueur</th>
                  <th style={{ ...th, textAlign: 'right' }}>Primes émises {donnees?.Exercice}</th>
                  <th style={{ ...th, textAlign: 'right' }}>À reverser</th>
                  <th style={{ ...th, textAlign: 'right' }}>Commissions en attente</th>
                  <th style={th}>Convention</th>
                </tr>
              </thead>
              <tbody>
                {liste.length === 0 && (
                  <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>Aucune compagnie pour ce filtre.</td></tr>
                )}
                {liste.map((c) => {
                  const estOuverte = ouverte === c.IdCompagnie;
                  return (
                    <React.Fragment key={c.IdCompagnie}>
                      <tr onClick={() => setOuverte(estOuverte ? null : c.IdCompagnie)} style={{ cursor: 'pointer', opacity: c.Active ? 1 : 0.6 }}
                        aria-expanded={estOuverte}>
                        <td style={{ ...td, fontWeight: 700 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            {estOuverte ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {c.Compagnie}
                          </span>
                          {!c.Active && <span className="badge" style={{ marginLeft: '0.4rem', fontSize: '0.68rem' }}>inactive</span>}
                          {c.Etranger && <span className="badge" style={{ marginLeft: '0.4rem', fontSize: '0.68rem' }}>étrangère</span>}
                        </td>
                        <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{c.CodeIntermediaire || '-'}</td>
                        <td style={{ ...td, ...num }}>{c.Activite.ContratsEnVigueur ? nombre(c.Activite.ContratsEnVigueur) : '-'}</td>
                        <td style={{ ...td, ...num }}>{c.Activite.PrimesExercice ? fcfa(c.Activite.PrimesExercice) : '-'}</td>
                        <td style={{ ...td, ...num, color: c.Activite.AReverser.Montant ? 'var(--accent-amber)' : undefined, fontWeight: c.Activite.AReverser.Montant ? 700 : 400 }}>
                          {c.Activite.AReverser.Montant ? fcfa(c.Activite.AReverser.Montant) : '-'}
                        </td>
                        <td style={{ ...td, ...num }}>{c.Activite.Commissions.EnAttente ? fcfa(c.Activite.Commissions.EnAttente) : '-'}</td>
                        <td style={td}>
                          {c.Convention
                            ? <span className="badge badge-emerald">{c.Convention.Statut}</span>
                            : <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>À renseigner</span>}
                        </td>
                      </tr>
                      {estOuverte && (
                        <tr>
                          <td colSpan={7} style={{ ...td, background: 'var(--bg-surface)' }}>
                            <DetailCompagnie c={c} exercice={donnees.Exercice} onConditions={setConditionsPour} onFiche={() => navigate('/admin/settings/companies')} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={Boolean(conditionsPour)} onClose={() => setConditionsPour(null)} maxWidth="640px"
        title={conditionsPour ? `Convention avec ${conditionsPour.Compagnie}` : ''}
        subtitle={conditionsPour ? `Code intermédiaire ${conditionsPour.CodeIntermediaire || 'non renseigné'}` : ''}>
        {conditionsPour && (
          <FormulaireConditions
            key={conditionsPour.IdCompagnie}
            compagnie={conditionsPour}
            statuts={donnees?.Statuts || ['Actif']}
            onFermer={() => setConditionsPour(null)}
            onEnregistre={(r) => {
              setDonnees((d) => ({ ...d, Compagnies: d.Compagnies.map((x) => (x.IdCompagnie === r.IdCompagnie ? { ...x, Convention: r.Convention } : x)) }));
              setConditionsPour(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
};

export default ConventionsEnginePage;
