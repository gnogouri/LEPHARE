import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building2, FileDown, FileUp, HeartHandshake, Loader2, RotateCcw } from 'lucide-react';
import { rafasApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { aLeDroit } from '../../../utils/droits';
import { messageErreurApi } from '../../../utils/financeUtils';
import { Badge, dateFr, libelleRang, moisFr, nomFichier, periode, telecharger } from './rafasCommun';
import OngletEnsemble from './OngletEnsemble';
import OngletFonds from './OngletFonds';
import OngletEffectif from './OngletEffectif';
import OngletDepenses from './OngletDepenses';
import OngletControles from './OngletControles';
import OngletConvention from './OngletConvention';
import OngletImports from './OngletImports';

/* =========================================================================
   RAFAS : espace d'une convention. Pilotage (vue d'ensemble, fonds et honoraires), analyse de la période (effectif, dépenses, contrôles :
   une seule lecture GET /api/rafas/conventions/<id>/analyse/ partagée, filtrée par une barre unique) et gestion (convention et exercices,
   fichiers du gestionnaire). Rapport Word de la période filtrée.
   ========================================================================= */

const GROUPES = [
  { titre: 'Pilotage', onglets: [['ensemble', "Vue d'ensemble"], ['fonds', 'Fonds et honoraires']] },
  { titre: 'Analyse de la période', onglets: [['effectif', 'Effectif'], ['depenses', 'Dépenses'], ['controles', 'Contrôles']] },
  { titre: 'Gestion', onglets: [['convention', 'Convention'], ['imports', 'Fichiers du gestionnaire']] },
];
const AVEC_ANALYSE = new Set(['ensemble', 'effectif', 'depenses', 'controles']);
const SEUILS = [300000, 400000, 500000, 750000, 1000000];
const FILTRES_VIDES = { du: '', au: '', colleges: '', seuil: '' };

const moisDe = (debut, fin) => {
  const liste = [];
  if (!debut || !fin) return liste;
  let [a, m] = debut.slice(0, 7).split('-').map(Number);
  const [af, mf] = fin.slice(0, 7).split('-').map(Number);
  while (a < af || (a === af && m <= mf)) {
    liste.push(`${a}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  return liste;
};

const BarreFiltres = ({ filtres, setFiltres, donnees, convention, chargement }) => {
  const mois = useMemo(() => {
    const ensemble = new Set((convention?.MoisDisponibles || []).map((m) => m.slice(0, 7)));
    (convention?.Exercices || []).forEach((e) => moisDe(e.date_effet, e.date_echeance).forEach((m) => ensemble.add(m)));
    return [...ensemble].sort();
  }, [convention]);
  const disponibles = new Set((convention?.MoisDisponibles || []).map((m) => m.slice(0, 7)));
  const du = filtres.du || donnees?.Periode?.Du?.slice(0, 7) || '';
  const au = filtres.au || donnees?.Periode?.Au?.slice(0, 7) || '';
  const selection = filtres.colleges ? filtres.colleges.split(',') : [];
  // Aucun choix = tous les collèges : un clic retire le collège ; revenir à tous efface le choix
  const basculer = (code) => {
    const tous = (donnees?.Colleges || []).map((c) => c.Code);
    const actuels = selection.length ? selection : tous;
    const suivant = actuels.includes(code) ? actuels.filter((c) => c !== code) : [...actuels, code];
    if (!suivant.length) return;
    setFiltres((f) => ({ ...f, colleges: suivant.length === tous.length ? '' : suivant.join(',') }));
  };
  const appliquerExercice = (id) => {
    const e = (convention?.Exercices || []).find((x) => String(x.idexercice) === id);
    if (e) setFiltres((f) => ({ ...f, du: e.date_effet.slice(0, 7), au: e.date_echeance.slice(0, 7) }));
  };
  const actifs = Object.values(filtres).some(Boolean);
  return (
    <div className="glass-panel cs-filtres" role="search" aria-label="Période et collèges analysés">
      <label className="cs-filtre">
        <span>Exercice</span>
        <select className="form-control" value="" onChange={(e) => appliquerExercice(e.target.value)}>
          <option value="">{donnees?.Exercice ? `${libelleRang(donnees.Exercice.rang)}` : 'Choisir'}</option>
          {(convention?.Exercices || []).map((e) => <option key={e.idexercice} value={e.idexercice}>{`${libelleRang(e.rang)} ${periode(e)}`}</option>)}
        </select>
      </label>
      <label className="cs-filtre">
        <span>Clôtures de</span>
        <select className="form-control" value={du} onChange={(e) => setFiltres((f) => ({ ...f, du: e.target.value, au: au && e.target.value > au ? e.target.value : f.au || au }))}>
          {mois.map((m) => <option key={m} value={m}>{`${moisFr(m)}${disponibles.has(m) ? '' : ' (sans relevé)'}`}</option>)}
        </select>
      </label>
      <label className="cs-filtre">
        <span>à</span>
        <select className="form-control" value={au} onChange={(e) => setFiltres((f) => ({ ...f, au: e.target.value, du: f.du || du }))}>
          {mois.filter((m) => m >= du).map((m) => <option key={m} value={m}>{`${moisFr(m)}${disponibles.has(m) ? '' : ' (sans relevé)'}`}</option>)}
        </select>
      </label>
      <label className="cs-filtre">
        <span>Familles suivies au-delà de</span>
        <select className="form-control" value={filtres.seuil || donnees?.Seuil || 400000} onChange={(e) => setFiltres((f) => ({ ...f, seuil: e.target.value }))}>
          {SEUILS.map((s) => <option key={s} value={s}>{`${s.toLocaleString('fr-FR')} F`}</option>)}
        </select>
      </label>
      <div className="cs-filtre large">
        <span>Collèges analysés</span>
        <div className="rafas-puces" role="group" aria-label="Collèges">
          {(donnees?.Colleges || []).map((c) => (
            <button key={c.Code} type="button" className={`rafas-puce${!selection.length || selection.includes(c.Code) ? ' active' : ''}`} aria-pressed={!selection.length || selection.includes(c.Code)}
              onClick={() => basculer(c.Code)}>{c.Libelle}</button>
          ))}
        </div>
      </div>
      {actifs && (
        <button type="button" className="btn btn-secondary cs-filtre-bouton" onClick={() => setFiltres(FILTRES_VIDES)}>
          <RotateCcw size={14} aria-hidden="true" /> Exercice en cours
        </button>
      )}
      <p className="cs-filtres-note" aria-live="polite">
        {chargement ? <><Loader2 size={13} className="spin" aria-hidden="true" /> Calcul en cours…</>
          : donnees ? `${donnees.Periode.Libelle}, selon le mois de clôture des relevés ; effectif du ${dateFr(donnees.Situation?.Date)}`
            + (donnees.Reference ? `, comparé à celui du ${dateFr(donnees.Reference.Date)}` : ', sans effectif de l\'année précédente') + `. Âges au ${donnees.Periode.AgeAu}.` : ''}
      </p>
    </div>
  );
};

const RafasConventionPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { error: toastError, success } = useToast();
  const [convention, setConvention] = useState(null);
  const [erreur, setErreur] = useState('');
  const [filtres, setFiltres] = useState(FILTRES_VIDES);
  const [analyse, setAnalyse] = useState({ donnees: null, chargement: false, cle: null });
  const [rapport, setRapport] = useState(false);
  const onglet = params.get('onglet') || 'ensemble';
  const choisir = (o) => setParams((p) => { const n = new URLSearchParams(p); n.set('onglet', o); return n; }, { replace: true });

  const recharger = useCallback(() => rafasApi.lire(id).then((c) => { setConvention(c); setErreur(''); return c; })
    .catch((err) => { setErreur(messageErreurApi(err)); toastError(messageErreurApi(err)); }), [id, toastError]);
  useEffect(() => { recharger(); }, [recharger]);

  const cle = JSON.stringify(filtres);
  useEffect(() => {
    if (!AVEC_ANALYSE.has(onglet) || !convention || analyse.cle === cle) return undefined;
    let annule = false;
    setAnalyse((a) => ({ ...a, chargement: true }));
    rafasApi.analyse(id, filtres)
      .then((donnees) => { if (!annule) setAnalyse({ donnees, chargement: false, cle }); })
      .catch((err) => { if (!annule) { setAnalyse((a) => ({ ...a, chargement: false, cle })); toastError(`Analyse impossible : ${messageErreurApi(err)}`); } });
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, onglet, convention, analyse.cle, id]);
  const apresModification = (c) => { setConvention(c); setAnalyse((a) => ({ ...a, cle: null })); };

  const telechargerRapport = async () => {
    setRapport(true);
    try {
      const r = await rafasApi.rapport(id, filtres);
      telecharger(r.data, nomFichier(r, 'RAPPORT RAFAS.docx'));
      success('Rapport Word téléchargé.');
    } catch (err) {
      let message = messageErreurApi(err);
      try { message = JSON.parse(await err.response.data.text()).error || message; } catch { /* corps non JSON */ }
      toastError(`Rapport impossible : ${message}`);
    } finally {
      setRapport(false);
    }
  };

  if (!convention) {
    return (
      <div className="cs-page rafas-page">
        <button type="button" className="btn btn-link rafas-retour" onClick={() => navigate('/user/rafas')}><ArrowLeft size={15} /> Conventions RAFAS</button>
        {erreur ? <p className="rafas-erreur">{erreur}</p> : <div className="rafas-chargement"><Loader2 size={22} className="spin" /> Chargement de la convention…</div>}
      </div>
    );
  }
  const c = convention.Convention;
  const courant = convention.Exercices.find((e) => e.idexercice === convention.ExerciceCourant);
  const a = analyse.donnees;
  const sansDonnees = !convention.Imports.length;
  return (
    <div className="cs-page rafas-page">
      <button type="button" className="btn btn-link rafas-retour" onClick={() => navigate('/user/rafas')}><ArrowLeft size={15} /> Conventions RAFAS</button>
      <div className="cs-entete">
        <div>
          <h1 className="title-xl"><HeartHandshake size={26} aria-hidden="true" />{c.souscripteur}</h1>
          <div className="rafas-convention-badges">
            <Badge ton="neutre" icone={Building2}>{c.gestionnaire}</Badge>
            {c.polices && <Badge ton="neutre">{`Polices ${c.polices}`}</Badge>}
            {courant && <Badge ton="info">{`${libelleRang(courant.rang)} ${periode(courant)}`}</Badge>}
            {c.statut === 'RESILIEE' && <Badge ton="critique">Résiliée</Badge>}
          </div>
        </div>
        <div className="rafas-actions">
          {aLeDroit('rafas.import') && <button type="button" className="btn btn-secondary rafas-bouton" onClick={() => choisir('imports')}><FileUp size={16} /> Importer un fichier</button>}
          <button type="button" className="btn btn-primary rafas-bouton" onClick={telechargerRapport} disabled={rapport || sansDonnees}
            title={sansDonnees ? "Importez d'abord les fichiers du gestionnaire" : 'Rapport Word de la période et des collèges choisis'}>
            {rapport ? <Loader2 size={16} className="spin" /> : <FileDown size={16} />} Rapport Word
          </button>
        </div>
      </div>

      <nav className="cs-onglets" aria-label="Rubriques de la convention">
        {GROUPES.map((g) => (
          <div key={g.titre} className="cs-onglets-groupe">
            <span className="cs-onglets-titre">{g.titre}</span>
            <div className="cs-onglets-boutons" role="tablist">
              {g.onglets.map(([cleOnglet, libelle]) => (
                <button key={cleOnglet} type="button" role="tab" aria-selected={onglet === cleOnglet} className={`cs-onglet${onglet === cleOnglet ? ' actif' : ''}`} onClick={() => choisir(cleOnglet)}>
                  {libelle}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {AVEC_ANALYSE.has(onglet) && !sansDonnees && <BarreFiltres filtres={filtres} setFiltres={setFiltres} donnees={a} convention={convention} chargement={analyse.chargement} />}

      <div className={`cs-contenu${analyse.chargement && a ? ' cs-rechargement' : ''}`} key={onglet}>
        {AVEC_ANALYSE.has(onglet) && sansDonnees && (
          <div className="rafas-vide etat-anime">
            <FileUp size={26} aria-hidden="true" />
            <p>Aucun fichier du gestionnaire pour cette convention : importez l'effectif et les relevés de prestations pour analyser les dépenses.</p>
            <button type="button" className="btn btn-primary rafas-bouton" onClick={() => choisir('imports')}><FileUp size={15} /> Importer un fichier</button>
          </div>
        )}
        {AVEC_ANALYSE.has(onglet) && !sansDonnees && !a && <div className="rafas-chargement"><Loader2 size={22} className="spin" /> Analyse de la période…</div>}
        {onglet === 'ensemble' && a && !sansDonnees && <OngletEnsemble donnees={a} fonds={convention.Fonds} onOnglet={choisir} />}
        {onglet === 'effectif' && a && !sansDonnees && <OngletEffectif id={id} donnees={a} />}
        {onglet === 'depenses' && a && !sansDonnees && <OngletDepenses id={id} donnees={a} />}
        {onglet === 'controles' && a && !sansDonnees && <OngletControles donnees={a} />}
        {onglet === 'fonds' && <OngletFonds id={id} convention={convention} onModifie={recharger} />}
        {onglet === 'convention' && <OngletConvention id={id} convention={convention} onModifie={apresModification} />}
        {onglet === 'imports' && <OngletImports id={id} convention={convention} onModifie={apresModification} />}
      </div>
    </div>
  );
};

export default RafasConventionPage;
