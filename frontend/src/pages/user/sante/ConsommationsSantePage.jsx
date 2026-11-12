import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2, ChevronDown, FileText, Gauge, HeartPulse, LayoutDashboard, ListChecks, Loader2, Save, Search, ShieldAlert, Stethoscope, Upload, UserSearch, Users,
} from 'lucide-react';
import { consommationsApi } from '../../../api/endpoints';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { useToast } from '../../../context/ToastContext';
import { confirmer } from '../../../utils/dialogue';
import { aLeDroit } from '../../../utils/droits';
import { downloadBlob } from '../../../utils/exportUtils';
import { dateFr, fcfa, messageErreurApi } from '../../../utils/financeUtils';
import { AnalyseConsommations, BarreFiltres, useAnalyse } from './consommations/AnalyseConsommations';

/* =========================================================================
   Suivi des consommations santé : relevés du gestionnaire (MCI CARE) importés, droits, plafonds et soldes de chaque assuré et de ses
   bénéficiaires, statistiques par entreprise, contrôles des données et détection des anomalies.
   Trois groupes d'onglets (refonte du 2026-11-09) :
   - Analyse : vue d'ensemble, entreprises, prestations, assurés et foyers, sur une seule lecture filtrée (consommations/AnalyseConsommations.jsx,
     calculs sante/consommations_analyse.py) ;
   - Suivi : fiche assuré, plafonds, contrôles, anomalies (sante/consommations.py ; « fraude » renommée « anomalie » le 2026-11-11) ;
   - Données : imports des relevés, effectifs et états des cotisations.
   Données de santé : chaque onglet suit son droit (consommations.view, consommations.fraude, consommations.import).
   ========================================================================= */
const DROITE = { textAlign: 'right' };
const MONO = { fontFamily: 'var(--font-mono)', fontSize: '0.78rem' };
const pourcent = (v) => (v === null || v === undefined ? '-' : `${(Number(v) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);
const montant = (v) => (v === null || v === undefined ? '-' : `${fcfa(v)} F`);
const COULEUR_SITUATION = { Normal: 'emerald', Alerte: 'amber', 'Plafond dépassé': 'rose', 'Barème inconnu': 'slate' };
const COULEUR_NIVEAU = { Élevé: 'rose', Moyen: 'amber', Faible: 'blue' };
const COULEUR_GRAVITE = { Élevée: 'rose', Moyenne: 'amber', Faible: 'slate' };
const COULEUR_INSTRUCTION = { A_INSTRUIRE: 'blue', JUSTIFIE: 'emerald', FRAUDE: 'rose', SANS_SUITE: 'slate' };
const DECISIONS = [['A_INSTRUIRE', 'À instruire'], ['JUSTIFIE', 'Justifié'], ['FRAUDE', 'Anomalie avérée'], ['SANS_SUITE', 'Sans suite']];

const Tuile = ({ libelle, valeur, detail, couleur = 'var(--text-primary)' }) => (
  <div className="glass-panel" style={{ padding: '0.9rem 1.05rem' }}>
    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-muted)' }}>{libelle}</div>
    <div style={{ fontSize: '1.25rem', fontWeight: 900, color: couleur, marginTop: '0.15rem' }}>{valeur}</div>
    {detail && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>{detail}</div>}
  </div>
);

const Grille = ({ children, min = 190 }) => <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: '0.75rem' }}>{children}</div>;

const Panneau = ({ titre, children, actions }) => (
  <section className="glass-panel" style={{ padding: '0.95rem 1.05rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
    {(titre || actions) && (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
        {titre && <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>{titre}</h2>}
        {actions}
      </div>
    )}
    {children}
  </section>
);

const Vide = ({ colonnes, chargement, texte }) => (
  <tr><td colSpan={colonnes} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.4rem' }}>{chargement ? <><Loader2 size={14} className="spin" /> Lecture…</> : texte}</td></tr>
);

const Champ = ({ id, libelle, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 160 }}>
    <label className="form-label" htmlFor={id} style={{ margin: 0 }}>{libelle}</label>
    {children}
  </div>
);

// Charge une lecture du serveur à chaque changement de paramètres ; erreur affichée une fois
const useLecture = (lire, dependances) => {
  const { error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      setDonnees(await lire());
    } catch (err) {
      toastError(`Lecture impossible : ${messageErreurApi(err)}`);
    } finally {
      setChargement(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependances);
  useEffect(() => { recharger(); }, [recharger]);
  return [donnees, chargement, recharger];
};

// Nature des fichiers importés (onglet Imports)
const NATURES = {
  PRESTATIONS: 'Prestations', EFFECTIF: 'Effectif', EFFECTIF_PERIODES: 'Effectif, exercice précédent et actuel',
  EFFECTIF_PRECEDENT: "Effectif de l'exercice précédent", COTISATIONS: 'État des cotisations',
};

// ------------------------------------------------------------------ fiche assuré
const FicheFamille = ({ fiche }) => {
  const d = fiche.Droits;
  const signaux = fiche.Signaux;
  return (
    <>
      <Panneau titre={`${fiche.Nom || 'Assuré principal'} - matricule ${fiche.MatriculeAssure}`}>
        <div style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
          <span>Police <strong style={{ color: 'var(--text-primary)' }}>{fiche.Police || '-'}</strong></span>
          <span>Garant <strong style={{ color: 'var(--text-primary)' }}>{fiche.Garant || '-'}</strong></span>
          <span>Collège <strong style={{ color: 'var(--text-primary)' }}>{fiche.College || '-'}</strong></span>
          <span>{fiche.LibelleBareme}</span>
        </div>
        <Grille>
          <Tuile libelle={`Plafond annuel ${fiche.Exercice}`} valeur={montant(d.PlafondAnnuel)} detail="par famille" />
          <Tuile libelle="Consommé sur l'exercice" valeur={montant(d.ConsommeExercice)} detail={`${pourcent(d.Taux)} du plafond`} />
          <Tuile libelle="Solde disponible" valeur={montant(d.Solde)} couleur={d.Situation === 'Plafond dépassé' ? 'var(--danger-500, #e11d48)' : 'var(--primary-500)'} />
          <div className="glass-panel" style={{ padding: '0.9rem 1.05rem' }}>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-muted)' }}>Situation</div>
            <div style={{ marginTop: '0.35rem' }}><StatusBadge label={d.Situation} color={COULEUR_SITUATION[d.Situation]} /></div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>{`${fcfa(fiche.Totaux.Prestations)} prestations, reste à charge ${montant(fiche.Totaux.ResteACharge)}`}</div>
          </div>
        </Grille>
      </Panneau>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '0.75rem' }}>
        <Panneau titre="Droits du barème">
          {fiche.Garanties.length ? (
            <div className="table-wrapper"><table className="data-table" style={{ fontSize: '0.83rem' }}>
              <thead><tr><th>Garantie</th><th style={DROITE}>Plafond</th><th>Unité</th></tr></thead>
              <tbody>{fiche.Garanties.map((g) => <tr key={g.Garantie}><td>{g.Garantie}</td><td style={DROITE}>{montant(g.Plafond)}</td><td>{g.Unite}</td></tr>)}</tbody>
            </table></div>
          ) : <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Information non déterminable : le collège n'a pas de barème connu.</p>}
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Carences : {fiche.Carences.map((c) => `${c.Famille.toLowerCase()} ${c.Mois} mois`).join(', ')}. Barème déduit du collège, à confirmer avec le contrat.
          </p>
        </Panneau>
        <Panneau titre="Consommation par famille de prestations">
          <div className="table-wrapper"><table className="data-table" style={{ fontSize: '0.83rem' }}>
            <thead><tr><th>Famille</th><th style={DROITE}>Prestations</th><th style={DROITE}>Remboursé</th><th style={DROITE}>Part</th></tr></thead>
            <tbody>
              {fiche.ParFamille.map((f) => <tr key={f.Famille}><td>{f.Famille}</td><td style={DROITE}>{fcfa(f.Prestations)}</td><td style={DROITE}>{montant(f.Rembourse)}</td><td style={DROITE}>{pourcent(f.Part)}</td></tr>)}
              {!fiche.ParFamille.length && <Vide colonnes={4} texte="Aucune prestation." />}
            </tbody>
          </table></div>
        </Panneau>
      </div>
      <Panneau titre="Bénéficiaires, plafonds individuels et soldes">
        <div className="table-wrapper"><table className="data-table" style={{ fontSize: '0.82rem' }}>
          <thead><tr><th>Lien</th><th>Nom</th><th>Naissance</th><th>Effet</th><th>Situation</th><th style={DROITE}>Prestations</th><th style={DROITE}>Remboursé</th>
            <th style={DROITE}>Solde dentaire</th><th style={DROITE}>Solde optique</th><th>Alertes</th>{signaux && <th>Anomalie</th>}</tr></thead>
          <tbody>{fiche.Beneficiaires.map((b) => (
            <tr key={b.Matricule}>
              <td>{b.Lien}</td>
              <td style={{ fontWeight: 600 }}>{b.Nom}<div style={{ ...MONO, color: 'var(--text-muted)' }}>{b.Matricule}</div></td>
              <td>{dateFr(b.DateNaissance)}</td>
              <td>{dateFr(b.DateEffet)}</td>
              <td>{b.HorsEffectif ? <StatusBadge label="Absent de l'effectif" color="rose" /> : b.Actif ? <StatusBadge label="Couvert" color="emerald" /> : <StatusBadge label={`Sorti le ${dateFr(b.DateSortie)}`} color="slate" />}</td>
              <td style={DROITE}>{fcfa(b.Prestations)}</td>
              <td style={DROITE}>{montant(b.Rembourse)}</td>
              <td style={DROITE}>{montant(b.SoldeDentaire)}<div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>sur {montant(b.PlafondDentaire)}</div></td>
              <td style={DROITE}>{montant(b.SoldeOptique)}<div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>sur {montant(b.PlafondOptique)}</div></td>
              <td>{[b.AlerteBons && '15 bons ou plus', b.AlertePharmacie && 'Pharmacie 200 000 F ou plus'].filter(Boolean).join(', ') || '-'}</td>
              {signaux && <td>{b.Niveau ? <StatusBadge label={`${b.Niveau} - ${b.Score}`} color={COULEUR_NIVEAU[b.Niveau]} /> : '-'}</td>}
            </tr>
          ))}</tbody>
        </table></div>
      </Panneau>
      {signaux && signaux.length > 0 && (
        <Panneau titre={`Signaux d'anomalie de la famille : ${signaux.length}`}>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Un signal est à instruire : ce n'est pas la preuve d'une anomalie.</p>
          <TableSignaux signaux={signaux} />
        </Panneau>
      )}
      <Panneau titre="Historique des prestations">
        <div className="table-wrapper" style={{ maxHeight: 460, overflow: 'auto' }}><table className="data-table" style={{ fontSize: '0.8rem' }}>
          <thead><tr><th>Soins</th><th>Bénéficiaire</th><th>Famille</th><th>Acte</th><th>Centre</th><th style={DROITE}>Réclamé</th><th style={DROITE}>Base</th><th style={DROITE}>TM</th><th style={DROITE}>Remboursé</th><th>Type</th></tr></thead>
          <tbody>
            {fiche.Prestations.map((p) => (
              <tr key={p.Numero}>
                <td>{dateFr(p.DateSoins)}{p.DateSoinsOrigine !== p.DateSoins && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }} title="Jour et mois inversés dans le relevé">relevé : {dateFr(p.DateSoinsOrigine)}</div>}</td>
                <td>{p.Beneficiaire}</td><td>{p.Famille}</td><td style={MONO}>{p.Acte}</td><td>{p.Centre}</td>
                <td style={DROITE}>{fcfa(p.Reclame)}</td><td style={DROITE}>{fcfa(p.Base)}</td><td style={DROITE}>{fcfa(p.TicketModerateur)} %</td><td style={DROITE}>{fcfa(p.Rembourse)}</td><td>{p.Type}</td>
              </tr>
            ))}
            {!fiche.Prestations.length && <Vide colonnes={10} texte="Aucune prestation." />}
          </tbody>
        </table></div>
      </Panneau>
    </>
  );
};

const OngletFiche = ({ matriculeInitial }) => {
  const { error: toastError } = useToast();
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState([]);
  const [fiche, setFiche] = useState(null);
  const [chargement, setChargement] = useState(false);

  const ouvrir = useCallback(async (matricule) => {
    setChargement(true);
    try {
      setFiche(await consommationsApi.famille(matricule));
    } catch (err) {
      toastError(`Fiche non lue : ${messageErreurApi(err)}`);
    } finally {
      setChargement(false);
    }
  }, [toastError]);

  useEffect(() => { if (matriculeInitial) ouvrir(matriculeInitial); }, [matriculeInitial, ouvrir]);
  useEffect(() => {
    if (q.trim().length < 2) { setResultats([]); return undefined; }
    const minuteur = setTimeout(async () => {
      try { setResultats((await consommationsApi.rechercher(q.trim())).Lignes); } catch (err) { toastError(`Recherche impossible : ${messageErreurApi(err)}`); }
    }, 300);
    return () => clearTimeout(minuteur);
  }, [q, toastError]);

  return (
    <>
      <Panneau>
        <label className="form-label" htmlFor="fiche-recherche" style={{ margin: 0 }}>Assuré ou bénéficiaire</label>
        <div style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
          <input id="fiche-recherche" className="form-control" style={{ paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, matricule ou police" />
        </div>
        {resultats.length > 0 && (
          <div className="table-wrapper"><table className="data-table" style={{ fontSize: '0.83rem' }}>
            <thead><tr><th>Assuré principal</th><th>Matricule</th><th>Police</th><th style={DROITE}>Bénéficiaires</th><th /></tr></thead>
            <tbody>{resultats.map((r) => (
              <tr key={r.MatriculeAssure}>
                <td style={{ fontWeight: 600 }}>{r.Nom}</td><td style={MONO}>{r.MatriculeAssure}</td><td>{r.Police}</td><td style={DROITE}>{r.Beneficiaires}</td>
                <td style={DROITE}><button type="button" className="btn btn-primary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }} onClick={() => { setResultats([]); ouvrir(r.MatriculeAssure); }}>Ouvrir la fiche</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panneau>
      {chargement && <Panneau><span><Loader2 size={14} className="spin" /> Lecture de la fiche…</span></Panneau>}
      {!chargement && fiche && <FicheFamille fiche={fiche} />}
      {!chargement && !fiche && <Panneau><p style={{ margin: 0, color: 'var(--text-secondary)' }}>Recherchez un assuré : la fiche réunit ses droits, les prestations de toute la famille, les plafonds utilisés et les soldes disponibles.</p></Panneau>}
    </>
  );
};

// ------------------------------------------------------------------ plafonds
const OngletPlafonds = ({ onOuvrir }) => {
  const [situation, setSituation] = useState('');
  const [donnees, chargement] = useLecture(() => consommationsApi.plafonds({ situation }), [situation]);
  const lignes = donnees?.Lignes || [];
  return (
    <Panneau titre={`Plafonds de l'exercice ${donnees?.Exercice || ''}`} actions={(
      <select aria-label="Situation" className="form-control" style={{ maxWidth: 260 }} value={situation} onChange={(e) => setSituation(e.target.value)}>
        <option value="">Toutes les situations</option>
        {Object.entries(donnees?.Situations || {}).map(([s, n]) => <option key={s} value={s}>{`${s} - ${n}`}</option>)}
      </select>
    )}>
      <div className="table-wrapper" style={{ maxHeight: 560, overflow: 'auto' }}><table className="data-table" style={{ fontSize: '0.82rem' }}>
        <thead><tr><th>Niveau</th><th>Garantie</th><th>Assuré ou bénéficiaire</th><th>Police</th><th style={DROITE}>Plafond</th><th style={DROITE}>Consommé</th><th style={DROITE}>Taux</th><th style={DROITE}>Solde</th><th>Situation</th></tr></thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={`${l.Niveau}${l.Garantie}${l.Matricule}`}>
              <td>{l.Niveau}</td><td>{l.Garantie}</td>
              <td><button type="button" className="btn btn-secondary" title="Ouvrir la fiche de la famille" style={{ fontSize: '0.78rem', padding: '0.2rem 0.55rem' }} onClick={() => onOuvrir(l.MatriculeAssure)}>{l.Nom || l.Matricule}</button></td>
              <td>{l.Police}</td><td style={DROITE}>{montant(l.Plafond)}</td><td style={DROITE}>{montant(l.Consomme)}</td><td style={DROITE}>{pourcent(l.Taux)}</td><td style={DROITE}>{montant(l.Solde)}</td>
              <td><StatusBadge label={l.Situation} color={COULEUR_SITUATION[l.Situation]} /></td>
            </tr>
          ))}
          {!lignes.length && <Vide colonnes={9} chargement={chargement} texte="Aucune consommation sur l'exercice." />}
        </tbody>
      </table></div>
    </Panneau>
  );
};

// ------------------------------------------------------------------ contrôles
const OngletControles = () => {
  const [code, setCode] = useState('');
  const [donnees, chargement] = useLecture(() => consommationsApi.controles(code), [code]);
  const lignes = donnees?.Lignes || [];
  return (
    <>
      <Panneau titre={`Anomalies des données : ${fcfa(donnees?.Total || 0)}`}>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Contrôles de qualité des relevés et de l'effectif. Les comportements suspects relèvent de l'onglet Anomalie.</p>
        <div className="table-wrapper"><table className="data-table" style={{ fontSize: '0.83rem' }}>
          <thead><tr><th>Anomalie</th><th>Gravité</th><th style={DROITE}>Nombre</th><th style={DROITE}>Montant concerné</th><th /></tr></thead>
          <tbody>
            {(donnees?.Synthese || []).map((s) => (
              <tr key={s.Code}>
                <td>{s.Anomalie}</td><td><StatusBadge label={s.Gravite} color={COULEUR_GRAVITE[s.Gravite]} /></td><td style={DROITE}>{fcfa(s.Nombre)}</td><td style={DROITE}>{montant(s.Montant)}</td>
                <td style={DROITE}><button type="button" className={`btn ${code === s.Code ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.76rem', padding: '0.2rem 0.6rem' }} onClick={() => setCode(code === s.Code ? '' : s.Code)}>{code === s.Code ? 'Tout voir' : 'Détail'}</button></td>
              </tr>
            ))}
            {!(donnees?.Synthese || []).length && <Vide colonnes={5} chargement={chargement} texte="Aucune anomalie." />}
          </tbody>
        </table></div>
      </Panneau>
      {lignes.length > 0 && (
        <Panneau titre="Détail">
          <div className="table-wrapper" style={{ maxHeight: 520, overflow: 'auto' }}><table className="data-table" style={{ fontSize: '0.8rem' }}>
            <thead><tr><th>Anomalie</th><th>Prestation</th><th>Matricule</th><th>Police</th><th>Explication</th><th style={DROITE}>Montant</th></tr></thead>
            <tbody>{lignes.slice(0, 500).map((l, n) => (
              <tr key={`${l.Code}${l.NumeroPrestation}${l.Matricule}${n}`}>
                <td>{l.Anomalie}</td><td style={MONO}>{l.NumeroPrestation || '-'}</td><td style={MONO}>{l.Matricule || '-'}</td><td>{l.Police}</td><td>{l.Explication}</td><td style={DROITE}>{montant(l.Montant)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panneau>
      )}
    </>
  );
};

// ------------------------------------------------------------------ anomalies (anciennement « fraude »)
const TableSignaux = ({ signaux }) => (
  <div className="table-wrapper" style={{ maxHeight: 420, overflow: 'auto' }}><table className="data-table" style={{ fontSize: '0.8rem' }}>
    <thead><tr><th>Règle</th><th>Prestation</th><th>Soins</th><th>Famille</th><th>Centre</th><th>Constat</th><th style={DROITE}>Montant</th></tr></thead>
    <tbody>{signaux.map((s, n) => (
      <tr key={`${s.Code}${s.NumeroPrestation}${n}`}>
        <td><span style={MONO}>{s.Code}</span> {s.Regle}</td><td style={MONO}>{s.NumeroPrestation}</td><td>{dateFr(s.Date)}</td><td>{s.Famille}</td><td>{s.Centre}</td><td>{s.Detail}</td><td style={DROITE}>{montant(s.Montant)}</td>
      </tr>
    ))}</tbody>
  </table></div>
);

const Instruction = ({ suspicion, onEnregistree }) => {
  const { success, error: toastError } = useToast();
  const [statut, setStatut] = useState(suspicion.Instruction);
  const [observation, setObservation] = useState(suspicion.Observation || '');
  const [envoi, setEnvoi] = useState(false);
  const enregistrer = async () => {
    if (statut === 'FRAUDE' && !(await confirmer({ titre: 'Anomalie avérée', message: "Confirmer que l'instruction établit une anomalie ? La décision et son auteur sont conservés.", confirmer: "Confirmer l'anomalie", ton: 'danger' }))) return;
    setEnvoi(true);
    try {
      success((await consommationsApi.instruire(suspicion.MatriculeBeneficiaire, { Statut: statut, Observation: observation })).Message);
      onEnregistree();
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <Champ id="instr-statut" libelle="Décision">
        <select id="instr-statut" className="form-control" value={statut} onChange={(e) => setStatut(e.target.value)}>
          {DECISIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Champ>
      <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <label className="form-label" htmlFor="instr-observation" style={{ margin: 0 }}>Observation</label>
        <input id="instr-observation" className="form-control" maxLength={500} value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Constat du médecin-conseil ou du gestionnaire" />
      </div>
      <button type="button" className="btn btn-primary" disabled={envoi} onClick={enregistrer} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        {envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer la décision
      </button>
      {suspicion.InstruitPar && <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{`Dernière décision par ${suspicion.InstruitPar} le ${dateFr(suspicion.InstruitLe)}`}</span>}
    </div>
  );
};

const OngletFraude = ({ onOuvrir }) => {
  const [filtres, setFiltres] = useState({ niveau: '', instruction: '', q: '' });
  const [recherche, setRecherche] = useState('');
  const [donnees, chargement, recharger] = useLecture(() => consommationsApi.fraude(filtres), [filtres]);
  const [ouverte, setOuverte] = useState(null);
  const [detail, setDetail] = useState(null);
  useEffect(() => { const m = setTimeout(() => setFiltres((f) => ({ ...f, q: recherche })), 350); return () => clearTimeout(m); }, [recherche]);

  const ouvrir = async (s) => {
    if (ouverte === s.MatriculeBeneficiaire) { setOuverte(null); return; }
    setOuverte(s.MatriculeBeneficiaire);
    setDetail(null);
    setDetail(await consommationsApi.fraudeBeneficiaire(s.MatriculeBeneficiaire));
  };
  const n = donnees?.Niveaux || {};
  return (
    <>
      <Grille>
        <Tuile libelle="Niveau élevé" valeur={fcfa(n['Élevé'] || 0)} couleur="#e11d48" detail="score de 15 et plus" />
        <Tuile libelle="Niveau moyen" valeur={fcfa(n.Moyen || 0)} couleur="#d97706" detail="score de 8 à 14" />
        <Tuile libelle="Niveau faible" valeur={fcfa(n.Faible || 0)} detail="moins de 8" />
        <Tuile libelle="Anomalies avérées" valeur={fcfa(donnees?.Instructions?.FRAUDE || 0)} detail={`${fcfa(donnees?.Instructions?.JUSTIFIE || 0)} justifiés, ${fcfa(donnees?.Instructions?.SANS_SUITE || 0)} sans suite`} />
      </Grille>
      <Panneau titre="Règles de détection">
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Chaque règle produit des signaux à instruire par un gestionnaire ou un médecin-conseil : un signal n'est jamais une preuve et ne bloque aucune prise en charge.
          Le score d'un bénéficiaire additionne le poids des règles déclenchées, au plus trois signaux comptés par règle.
        </p>
        <div className="table-wrapper"><table className="data-table" style={{ fontSize: '0.82rem' }}>
          <thead><tr><th>Règle</th><th>Critère</th><th style={DROITE}>Poids</th><th style={DROITE}>Signaux</th><th style={DROITE}>Bénéficiaires</th><th style={DROITE}>Remboursé concerné</th></tr></thead>
          <tbody>
            {(donnees?.Regles || []).map((r) => (
              <tr key={r.Code}><td><span style={MONO}>{r.Code}</span> {r.Regle}</td><td>{r.Critere}</td><td style={DROITE}>{r.Poids}</td><td style={DROITE}>{fcfa(r.Signaux)}</td><td style={DROITE}>{fcfa(r.Beneficiaires)}</td><td style={DROITE}>{montant(r.Montant)}</td></tr>
            ))}
            {!(donnees?.Regles || []).length && <Vide colonnes={6} chargement={chargement} texte="Aucune règle." />}
          </tbody>
        </table></div>
      </Panneau>
      <Panneau titre={`Bénéficiaires signalés : ${fcfa(donnees?.Total || 0)}`} actions={(
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input aria-label="Rechercher un bénéficiaire" className="form-control" style={{ maxWidth: 240 }} value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Nom, matricule ou police" />
          <select aria-label="Niveau" className="form-control" style={{ maxWidth: 190 }} value={filtres.niveau} onChange={(e) => setFiltres((f) => ({ ...f, niveau: e.target.value }))}>
            <option value="">Tous les niveaux</option><option value="Élevé">Élevé</option><option value="Moyen">Moyen</option><option value="Faible">Faible</option>
          </select>
          <select aria-label="Instruction" className="form-control" style={{ maxWidth: 210 }} value={filtres.instruction} onChange={(e) => setFiltres((f) => ({ ...f, instruction: e.target.value }))}>
            <option value="">Toutes les décisions</option>
            {DECISIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      )}>
        <div className="table-wrapper"><table className="data-table" style={{ fontSize: '0.82rem' }}>
          <thead><tr><th style={DROITE}>Score</th><th>Niveau</th><th>Bénéficiaire</th><th>Police</th><th>Règles déclenchées</th><th style={DROITE}>Montant concerné</th><th>Instruction</th><th /></tr></thead>
          <tbody>
            {(donnees?.Suspicions || []).map((s) => (
              <React.Fragment key={s.MatriculeBeneficiaire}>
                <tr>
                  <td style={{ ...DROITE, fontWeight: 800 }}>{s.Score}</td>
                  <td><StatusBadge label={s.Niveau} color={COULEUR_NIVEAU[s.Niveau]} /></td>
                  <td style={{ fontWeight: 600 }}>{s.Beneficiaire}<div style={{ ...MONO, color: 'var(--text-muted)' }}>{s.MatriculeBeneficiaire}</div></td>
                  <td>{s.Police}</td>
                  <td style={MONO}>{Object.entries(s.Regles).map(([c, k]) => `${c} x${k}`).join('  ')}</td>
                  <td style={DROITE}>{montant(s.Montant)}</td>
                  <td><StatusBadge label={s.LibelleInstruction} color={COULEUR_INSTRUCTION[s.Instruction]} /></td>
                  <td style={DROITE}><button type="button" className={`btn ${ouverte === s.MatriculeBeneficiaire ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.76rem', padding: '0.2rem 0.6rem' }} onClick={() => ouvrir(s)}>Instruire</button></td>
                </tr>
                {ouverte === s.MatriculeBeneficiaire && (
                  <tr><td colSpan={8} style={{ background: 'var(--bg-secondary, rgba(0,0,0,0.03))' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', padding: '0.4rem 0.2rem' }}>
                      {detail ? <TableSignaux signaux={detail.Signaux} /> : <span><Loader2 size={14} className="spin" /> Lecture des signaux…</span>}
                      <div><button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem' }} onClick={() => onOuvrir(s.MatriculeAssure)}>Voir la fiche de la famille</button></div>
                      <Instruction suspicion={s} onEnregistree={recharger} />
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
            {!(donnees?.Suspicions || []).length && <Vide colonnes={8} chargement={chargement} texte="Aucun bénéficiaire signalé." />}
          </tbody>
        </table></div>
      </Panneau>
    </>
  );
};

// ------------------------------------------------------------------ imports
// Effectif complété par les souscriptions Oreole Santé de LE PHARE (demande du 2026-11-10) : personnes des contrats Oreole Santé que
// l'effectif du gestionnaire ne connaît pas encore, reconnues par leur matricule ; l'effectif du gestionnaire fait foi
const LIBELLES_STATUT = { A: 'Assuré', C: 'Conjoint(e)', E: 'Enfant' };
const PanneauSouscriptions = ({ onAjout }) => {
  const { success, error: toastError } = useToast();
  const [apercu, setApercu] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const verifier = async () => {
    setEnvoi(true);
    try { setApercu(await consommationsApi.souscriptions()); } catch (err) { toastError(messageErreurApi(err)); } finally { setEnvoi(false); }
  };
  const aEcrire = apercu ? apercu.AAjouter.length + apercu.AMettreAJour + apercu.Retirees : 0;
  const ajouter = async () => {
    const message = `${fcfa(apercu.AAjouter.length)} personne${apercu.AAjouter.length > 1 ? 's' : ''} souscrite${apercu.AAjouter.length > 1 ? 's' : ''} à Oreole Santé seront ajoutées à l'effectif`
      + (apercu.AMettreAJour ? `, ${fcfa(apercu.AMettreAJour)} mises à jour` : '') + (apercu.Retirees ? `, ${fcfa(apercu.Retirees)} sorties` : '')
      + ". Les personnes que l'effectif du gestionnaire connaît déjà ne sont pas modifiées.";
    if (!(await confirmer({ titre: "Compléter l'effectif", message, confirmer: 'Ajouter à l\'effectif' }))) return;
    setEnvoi(true);
    try {
      const r = await consommationsApi.ajouterSouscriptions();
      success(`Effectif complété : ${fcfa(r.Ajoutees)} personne${r.Ajoutees > 1 ? 's' : ''} ajoutée${r.Ajoutees > 1 ? 's' : ''}`
        + (r.MisesAJour ? `, ${fcfa(r.MisesAJour)} mises à jour` : '') + (r.Sorties ? `, ${fcfa(r.Sorties)} sorties` : '') + '.');
      setApercu(await consommationsApi.souscriptions());
      onAjout?.();
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };
  const ligne = (p) => (
    <tr key={`${p.PoliceLePhare}-${p.Matricule || `${p.Nom}-${p.Prenoms}`}`}>
      <td>{p.Entreprise}</td><td>{p.PoliceLePhare}</td><td>{`${p.Nom} ${p.Prenoms}`.trim()}</td><td>{LIBELLES_STATUT[p.Statut] || p.Statut}</td>
      <td>{p.Matricule || '-'}</td><td>{dateFr(p.DateEffet)}</td><td>{p.Actif ? 'Couvert' : `Sorti le ${dateFr(p.DateSortie)}`}</td>
    </tr>
  );
  const entetes = <tr><th>Entreprise</th><th>Police LE PHARE</th><th>Nom et prénoms</th><th>Lien</th><th>Matricule</th><th>Adhésion</th><th>Situation</th></tr>;
  return (
    <Panneau titre="Compléter l'effectif avec les souscriptions Oreole Santé"
      actions={<button type="button" className="btn btn-secondary" disabled={envoi} onClick={verifier} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        {envoi && !apercu ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Vérifier</button>}>
      <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        Les adhérents et ayants droit des contrats Oreole Santé de LE PHARE portent le matricule du gestionnaire. Ceux que l'effectif importé ne connaît
        pas encore, une incorporation récente par exemple, y sont ajoutés avec l'entreprise, le garant et le collège des autres personnes de leur police.
        L'effectif du gestionnaire fait foi : une personne qu'il connaît n'est pas modifiée, et son prochain fichier met à jour les personnes ajoutées ici.
      </p>
      {apercu && !apercu.Disponible && <p style={{ margin: 0, color: '#d97706', fontSize: '0.82rem' }}>{apercu.Message}</p>}
      {apercu?.Disponible && (
        <>
          <Grille min={160}>
            <Tuile libelle="Personnes souscrites" valeur={fcfa(apercu.Personnes)} detail={`${fcfa(apercu.Polices)} police${apercu.Polices > 1 ? 's' : ''} en cours`} />
            <Tuile libelle="Déjà dans l'effectif" valeur={fcfa(apercu.DejaConnues)} detail="reconnues par leur matricule" />
            <Tuile libelle="À ajouter" valeur={fcfa(apercu.AAjouter.length)} couleur="var(--primary-500)" detail={apercu.AMettreAJour || apercu.Retirees ? `${fcfa(apercu.AMettreAJour)} à mettre à jour, ${fcfa(apercu.Retirees)} sorties` : 'absentes de l\'effectif importé'} />
            <Tuile libelle="Sans matricule" valeur={fcfa(apercu.SansMatricule.length)} couleur={apercu.SansMatricule.length ? '#d97706' : undefined} detail="à compléter dans le contrat" />
          </Grille>
          {apercu.AAjouter.length > 0 && (
            <div className="table-wrapper"><table className="data-table" style={{ fontSize: '0.8rem' }}>
              <thead>{entetes}</thead><tbody>{apercu.AAjouter.slice(0, 100).map(ligne)}</tbody>
            </table></div>
          )}
          {apercu.AAjouter.length > 100 && <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>{`Et ${fcfa(apercu.AAjouter.length - 100)} autres personnes.`}</p>}
          {apercu.SansMatricule.length > 0 && (
            <>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#d97706' }}>Sans matricule du gestionnaire, ces personnes ne peuvent pas être rapprochées du relevé : saisissez leur matricule dans le contrat Oreole Santé.</p>
              <div className="table-wrapper"><table className="data-table" style={{ fontSize: '0.8rem' }}>
                <thead>{entetes}</thead><tbody>{apercu.SansMatricule.map(ligne)}</tbody>
              </table></div>
            </>
          )}
          <div>
            <button type="button" className="btn btn-primary" disabled={envoi || !aEcrire} onClick={ajouter} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {envoi ? <Loader2 size={14} className="spin" /> : <Users size={14} />} {aEcrire ? "Ajouter à l'effectif" : "L'effectif est à jour"}
            </button>
          </div>
        </>
      )}
    </Panneau>
  );
};

const OngletImports = () => {
  const { success, error: toastError } = useToast();
  const [fichier, setFichier] = useState(null);
  const [situation, setSituation] = useState('');
  const [exercice, setExercice] = useState('');
  const [analyse, setAnalyse] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [donnees, chargement, recharger] = useLecture(() => consommationsApi.synthese({}), []);

  const choisir = (e) => { setFichier(e.target.files?.[0] || null); setAnalyse(null); };
  const analyser = async () => {
    setEnvoi(true);
    try { setAnalyse(await consommationsApi.analyser(fichier, exercice)); } catch (err) { toastError(messageErreurApi(err)); } finally { setEnvoi(false); }
  };
  const importer = async () => {
    const message = analyse.Cotisations
      ? `L'état des cotisations ${analyse.Exercice} (${fcfa(analyse.Cotisations)} entreprises) remplacera celui de cet exercice.`
      : `${fcfa(analyse.Nouvelles)} prestations nouvelles et ${fcfa(analyse.Effectif)} bénéficiaires d'effectif seront enregistrés`
        + (analyse.EffectifPrecedent ? `, ainsi que ${fcfa(analyse.EffectifPrecedent)} bénéficiaires de l'exercice précédent comme effectif de référence` : '')
        + '. Les prestations déjà connues ne sont pas réécrites.';
    if (!(await confirmer({ titre: 'Importer le fichier', message, confirmer: 'Importer' }))) return;
    setEnvoi(true);
    try {
      const r = await consommationsApi.importer(fichier, situation, exercice);
      success(r.Cotisations ? `État des cotisations ${r.Exercice} importé : ${fcfa(r.Cotisations)} entreprises.`
        : `Relevé importé : ${fcfa(r.Nouvelles)} prestations nouvelles${r.Sorties ? `, ${fcfa(r.Sorties)} bénéficiaires sortis` : ''}`
          + (r.EffectifPrecedent ? `, effectif de référence au ${dateFr(r.SituationPrecedent)} : ${fcfa(r.EffectifPrecedent)} bénéficiaires` : '')
          + (r.Anterieur ? `. Effectif plus ancien que l'effectif courant du ${dateFr(r.Anterieur)} : gardé comme effectif de référence, l'effectif courant n'est pas modifié` : '')
          + (r.MatriculesEnDouble ? `. ${fcfa(r.MatriculesEnDouble)} matricule(s) bénéficiaire(s) en double dans le fichier : première ligne gardée, cas listés dans l'onglet Contrôles et le rapport` : '')
          + '.');
      setAnalyse(null);
      setFichier(null);
      recharger();
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };
  const releves = donnees?.Releves || [];
  return (
    <>
      <Panneau titre="Importer un fichier du gestionnaire">
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Relevé de prestations (colonne NUMERO_PREST), effectif (colonne MATBENEF) ou état des cotisations (fichier ETAT, feuille des données par entreprise),
          au format Excel, toutes feuilles lues. Les relevés sont cumulatifs :
          une prestation déjà importée n'est jamais réécrite et un montant changé est signalé. Une date de soins postérieure à la clôture, jour et mois inversés, est corrigée et la date du relevé conservée.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Champ id="imp-fichier" libelle="Fichier Excel"><input id="imp-fichier" type="file" accept=".xlsx,.xls" className="form-control" onChange={choisir} /></Champ>
          <Champ id="imp-situation" libelle="Effectif à jour au"><input id="imp-situation" type="date" className="form-control" value={situation} onChange={(e) => setSituation(e.target.value)} /></Champ>
          <Champ id="imp-exercice" libelle="Exercice de l'état"><input id="imp-exercice" type="number" min="2000" max="2100" className="form-control" style={{ maxWidth: 120 }} placeholder="d'après le nom" value={exercice} onChange={(e) => setExercice(e.target.value)} /></Champ>
          <button type="button" className="btn btn-secondary" disabled={!fichier || envoi} onClick={analyser} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {envoi && !analyse ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Analyser
          </button>
          {analyse && <button type="button" className="btn btn-primary" disabled={envoi} onClick={importer} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {envoi ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} Importer
          </button>}
        </div>
        <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)' }}>La date de l'effectif date la sortie des bénéficiaires absents du nouvel effectif ; laissée vide, la date du jour est retenue.
          Chaque effectif est gardé à sa date : pour compter les sortants et les nouveaux entrants du rapport, importez aussi l'effectif de l'exercice précédent,
          daté par exemple du 31/12 ; plus ancien que l'effectif courant, il sert de référence sans le modifier. Dans les classeurs d'analyse d'OREOLE (ANALYSE DES SORTANT, base unifiée),
          les lignes de PERIODE « EXERCICE PRECEDENT » et la feuille BASE EFFECTIF PRECEDENT forment cet effectif de référence, daté du 31/12 de l'année précédente.
          L'exercice d'un état des cotisations se lit dans le nom du fichier (ETAT 2026) ; saisissez-le s'il n'y figure pas.</p>
        {analyse && (
          <Grille min={170}>
            <Tuile libelle="Prestations lues" valeur={fcfa(analyse.Prestations)} detail={analyse.ClotureDu ? `clôtures du ${dateFr(analyse.ClotureDu)} au ${dateFr(analyse.ClotureAu)}` : ''} />
            <Tuile libelle="Nouvelles" valeur={fcfa(analyse.Nouvelles)} couleur="var(--primary-500)" detail={`${fcfa(analyse.Connues)} déjà connues`} />
            <Tuile libelle="Montants changés" valeur={fcfa(analyse.MontantsChanges)} detail="signalés, non réécrits" />
            <Tuile libelle="Dates corrigées" valeur={fcfa(analyse.DatesCorrigees)} detail="jour et mois inversés" />
            <Tuile libelle="Effectif lu" valeur={fcfa(analyse.Effectif)} detail={analyse.Garants.join(', ')} />
            {analyse.EffectifPrecedent > 0 && <Tuile libelle="Effectif de l'exercice précédent" valeur={fcfa(analyse.EffectifPrecedent)} detail="référence des sortants et des nouveaux entrants" />}
            <Tuile libelle="Remboursé du fichier" valeur={montant(analyse.Rembourse)} />
            {analyse.Cotisations > 0 && <Tuile libelle={`État des cotisations ${analyse.Exercice}`} valeur={`${fcfa(analyse.Cotisations)} entreprises`} detail={`provisions ${montant(analyse.Provisions)}`} />}
          </Grille>
        )}
        {analyse && (
          <div className="table-wrapper"><table className="data-table" style={{ fontSize: '0.8rem' }}>
            <thead><tr><th>Feuille</th><th>Nature</th><th style={DROITE}>Lignes</th></tr></thead>
            <tbody>{analyse.Feuilles.map((f) => <tr key={f.Feuille}><td>{f.Feuille}</td><td>{NATURES[f.Nature] || f.Nature}</td><td style={DROITE}>{fcfa(f.Lignes)}</td></tr>)}</tbody>
          </table></div>
        )}
        {analyse?.ColonnesManquantes?.length > 0 && <p style={{ margin: 0, color: '#d97706', fontSize: '0.8rem' }}>Feuilles écartées, colonnes absentes : {analyse.ColonnesManquantes.join(' ; ')}</p>}
      </Panneau>
      <PanneauSouscriptions onAjout={recharger} />
      <Panneau titre="Fichiers importés">
        <div className="table-wrapper"><table className="data-table" style={{ fontSize: '0.82rem' }}>
          <thead><tr><th>Date</th><th>Fichier</th><th>Nature</th><th>Garants</th><th>Clôtures</th><th style={DROITE}>Lignes</th><th style={DROITE}>Nouvelles</th><th style={DROITE}>Montants changés</th><th>Par</th></tr></thead>
          <tbody>
            {releves.map((r) => (
              <tr key={r.Id}>
                <td>{dateFr(r.Date)}</td><td>{r.Fichier}</td><td>{NATURES[r.Nature] || r.Nature}</td><td>{r.Garants}</td>
                <td>{r.ClotureDu ? `${dateFr(r.ClotureDu)} au ${dateFr(r.ClotureAu)}` : r.Situation ? `effectif au ${dateFr(r.Situation)}` : '-'}</td><td style={DROITE}>{fcfa(r.Lignes)}</td><td style={DROITE}>{fcfa(r.Nouvelles)}</td><td style={DROITE}>{fcfa(r.Modifiees)}</td><td>{r.Operateur}</td>
              </tr>
            ))}
            {!releves.length && <Vide colonnes={9} chargement={chargement} texte="Aucun fichier importé." />}
          </tbody>
        </table></div>
      </Panneau>
    </>
  );
};


// ------------------------------------------------------------------ page
const ONGLETS = [
  { groupe: 'Analyse', cle: 'ensemble', libelle: "Vue d'ensemble", icone: LayoutDashboard },
  { groupe: 'Analyse', cle: 'entreprises', libelle: 'Entreprises', icone: Building2 },
  { groupe: 'Analyse', cle: 'prestations', libelle: 'Prestations', icone: Stethoscope },
  { groupe: 'Analyse', cle: 'assures', libelle: 'Assurés et foyers', icone: Users },
  { groupe: 'Suivi', cle: 'fiche', libelle: 'Fiche assuré', icone: UserSearch },
  { groupe: 'Suivi', cle: 'plafonds', libelle: 'Plafonds', icone: Gauge },
  { groupe: 'Suivi', cle: 'controles', libelle: 'Contrôles', icone: ListChecks },
  { groupe: 'Suivi', cle: 'fraude', libelle: 'Anomalie', icone: ShieldAlert, droit: 'consommations.fraude' },
  { groupe: 'Données', cle: 'imports', libelle: 'Imports', icone: Upload, droit: 'consommations.import' },
];
const GROUPES = ['Analyse', 'Suivi', 'Données'];
// Rapports Word (sante/consommations_rapport.py, TYPES_RAPPORT)
const RAPPORTS = [
  { type: 'effectifs', titre: 'Rapport des effectifs', detail: "Indicateurs, structure par entreprise, statut et âge, contrôle de cohérence et anomalies." },
  { type: 'depenses', titre: 'Rapport des dépenses de santé', detail: 'Indicateurs par entreprise, structure des dépenses, top 20 des centres et des médecins.' },
  { type: 'global', titre: 'Rapport global', detail: 'Effectifs et dépenses, puis analyse ciblée des entreprises à risque et analyses complémentaires.' },
];
const ANALYSE = new Set(['ensemble', 'entreprises', 'prestations', 'assures']);
const FILTRES_VIDES = { exercice: '', du: '', au: '', garant: '', police: '' };

export default function ConsommationsSantePage() {
  const { success, error: toastError } = useToast();
  const [onglet, setOnglet] = useState('ensemble');
  const [matricule, setMatricule] = useState(null);
  const [filtres, setFiltres] = useState(FILTRES_VIDES);
  const [exportEnCours, setExportEnCours] = useState(false);
  const enAnalyse = ANALYSE.has(onglet);
  // Une seule lecture pour les quatre onglets d'analyse ; elle n'est faite qu'à l'ouverture de l'un d'eux
  const [donnees, chargement, recharger] = useAnalyse(filtres, enAnalyse);
  const visibles = ONGLETS.filter((o) => !o.droit || aLeDroit(o.droit));
  const ouvrirFiche = (m) => { setMatricule(m); setOnglet('fiche'); };
  const changer = (cle) => { setMatricule(null); setOnglet(cle); };

  // Rapport Word, seul export du suivi : exercice, période et compagnie choisis (le filtre d'entreprise ne s'y applique pas). Attentes de
  // l'équipe actuariat (2026-11-11) : un rapport des effectifs, un des dépenses de santé, et un rapport global qui les regroupe
  const [menuRapport, setMenuRapport] = useState(false);
  useEffect(() => {
    if (!menuRapport) return undefined;
    const fermer = (e) => { if (!e.target.closest?.('.cs-export-zone')) setMenuRapport(false); };
    const echap = (e) => { if (e.key === 'Escape') setMenuRapport(false); };
    document.addEventListener('mousedown', fermer);
    document.addEventListener('keydown', echap);
    return () => { document.removeEventListener('mousedown', fermer); document.removeEventListener('keydown', echap); };
  }, [menuRapport]);
  const exporterRapport = async (type) => {
    setMenuRapport(false);
    setExportEnCours(true);
    try {
      const { police: _police, ...parametres } = filtres;
      const reponse = await consommationsApi.rapport({ ...parametres, type });
      const entete = reponse.headers?.['content-disposition'] || '';
      const nom = decodeURIComponent((entete.match(/filename="?([^";]+)"?/) || [])[1] || `rapport-consommations-${donnees?.Exercice || ''}.docx`);
      downloadBlob(reponse.data, nom);
      success('Rapport exporté.');
    } catch (err) {
      let message = messageErreurApi(err);
      if (err?.response?.data instanceof Blob) {
        try { message = JSON.parse(await err.response.data.text()).error || message; } catch { /* message par défaut */ }
      }
      toastError(`Rapport non produit : ${message}`);
    } finally {
      setExportEnCours(false);
    }
  };

  return (
    <div className="cs-page">
      <header className="cs-entete">
        <div>
          <h1 className="title-xl"><HeartPulse size={26} aria-hidden="true" /> Consommations santé</h1>
          <p>
            Dépenses de santé des relevés du gestionnaire, analysées par compagnie, entreprise, famille de prestations, profil des bénéficiaires et foyer ;
            droits, plafonds et soldes de chaque assuré. Données de santé à ne pas diffuser.
          </p>
        </div>
        <div className="cs-export-zone">
          <button type="button" className="btn btn-primary cs-export" disabled={exportEnCours} aria-busy={exportEnCours} aria-haspopup="menu"
            aria-expanded={menuRapport} onClick={() => setMenuRapport((o) => !o)} title="Rapport Word de l'exercice, de la période et de la compagnie choisis">
            {exportEnCours ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />} Exporter un rapport
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {menuRapport && (
            <div className="cs-export-menu" role="menu">
              {RAPPORTS.map((r) => (
                <button key={r.type} type="button" role="menuitem" onClick={() => exporterRapport(r.type)}>
                  <strong>{r.titre}</strong>
                  <span>{r.detail}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <nav className="cs-onglets" aria-label="Rubriques des consommations santé">
        {GROUPES.map((g) => {
          const siens = visibles.filter((o) => o.groupe === g);
          if (!siens.length) return null;
          return (
            <div key={g} className="cs-onglets-groupe">
              <span className="cs-onglets-titre">{g}</span>
              <div className="cs-onglets-boutons" role="tablist" aria-label={g}>
                {siens.map((o) => {
                  const Icone = o.icone;
                  return (
                    <button key={o.cle} type="button" role="tab" aria-selected={onglet === o.cle} className={`cs-onglet${onglet === o.cle ? ' actif' : ''}`} onClick={() => changer(o.cle)}>
                      <Icone size={15} aria-hidden="true" />{o.libelle}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {enAnalyse && <BarreFiltres filtres={filtres} setFiltres={setFiltres} donnees={donnees} chargement={chargement} />}

      <div key={onglet} className="cs-contenu" role="tabpanel">
        {enAnalyse && (
          <AnalyseConsommations onglet={onglet} donnees={donnees} chargement={chargement} filtres={filtres} onFiltrer={setFiltres} onRecharger={recharger} onOuvrirFiche={ouvrirFiche} />
        )}
        {onglet === 'fiche' && <OngletFiche matriculeInitial={matricule} />}
        {onglet === 'plafonds' && <OngletPlafonds onOuvrir={ouvrirFiche} />}
        {onglet === 'controles' && <OngletControles />}
        {onglet === 'fraude' && aLeDroit('consommations.fraude') && <OngletFraude onOuvrir={ouvrirFiche} />}
        {onglet === 'imports' && aLeDroit('consommations.import') && <OngletImports />}
      </div>
    </div>
  );
}
