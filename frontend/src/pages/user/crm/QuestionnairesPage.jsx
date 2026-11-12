import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardList,
  Download,
  FileCheck2,
  History,
  Inbox,
  RotateCcw,
  Search,
  Send,
  Trash2,
  TrendingUp,
  UploadCloud,
  X,
} from 'lucide-react';
import { crmApi, questionnaireApi } from '../../../api/endpoints';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import { confirmer, saisirTexte } from '../../../utils/dialogue';
import { correspondRecherche } from '../../../utils/financeUtils';
import { etapeDe } from './suiviCommercial';
import { DepotQuestionnaireModal } from './DepotQuestionnaireModal';
import { ContenuQuestionnaire } from '../quotes/QuestionnaireDevis';
import {
  A_TRAITER,
  ETAPES_QUESTIONNAIRE,
  IconeFormat,
  dateHeure,
  etapeQuestionnaire,
  messageErreur,
  tailleLisible,
} from './questionnairesOutils';

const PARCOURS = [
  { icone: Download, titre: 'Télécharger', texte: 'Le questionnaire de la branche, enregistré sous son titre.', ton: 'var(--primary-500)' },
  { icone: Send, titre: 'Faire remplir', texte: 'Envoyez-le au client : il le complète dans Word ou Excel, ou à la main.', ton: 'var(--accent-amber)' },
  { icone: UploadCloud, titre: 'Déposer', texte: 'Le fichier rempli est lu aussitôt : questionnaire reconnu, souscripteur et données repris.', ton: 'var(--accent-emerald)' },
  { icone: FileCheck2, titre: 'Établir le devis', texte: "L'écran de devis s'ouvre pré-rempli ; à l'enregistrement, le questionnaire passe « Devis établi ».", ton: 'var(--primary-500)' },
];

const Onglet = ({ actif, onClick, icone: Icone, children, compte, alerte }) => (
  <button type="button" role="tab" aria-selected={actif} className={`btn ${actif ? 'btn-primary' : 'btn-secondary'}`}
    onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
    <Icone size={15} /> {children}
    {compte !== undefined && <span className="qp-puce-compte">{compte}</span>}
    {alerte ? <span className="qp-alerte" title={`${alerte} à traiter`}>{alerte} à traiter</span> : null}
  </button>
);

// Carte d'un questionnaire à télécharger
const CarteModele = ({ modele, rang, etat, recus, aTraiter, onTelecharger, onDeposer, onVoirRecus, peutDeposer }) => (
  <article className={`qp-carte ${modele.format === 'Excel' ? 'excel' : 'word'}`} style={{ '--rang': rang }} data-modele={modele.code}>
    <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'flex-start' }}>
      <IconeFormat extension={modele.extension} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.3rem' }}>
          <span className="qp-branche">{modele.branche}</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{modele.compagnie}</span>
        </div>
        <h3 className="qp-carte-titre">{modele.titre}</h3>
      </div>
    </div>
    <p style={{ margin: 0, fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{modele.description}</p>
    <div>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
        Le client renseigne
      </div>
      <ul className="qp-rubriques">
        {modele.rubriques.slice(0, 4).map((r) => <li key={r}><Check size={13} /> {r}</li>)}
        {modele.rubriques.length > 4 && (
          <li style={{ color: 'var(--text-muted)' }} title={modele.rubriques.slice(4).join(' · ')}>
            <Check size={13} style={{ opacity: 0 }} /> et {modele.rubriques.length - 4} autre(s) rubrique(s)
          </li>
        )}
      </ul>
    </div>
    <div className="qp-carte-pied">
      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
        <div>{modele.format} · {tailleLisible(modele.taille)}{modele.origine !== modele.format ? ` · ${modele.origine}` : ''}</div>
        {recus > 0 ? (
          <button type="button" className="qp-lien" onClick={onVoirRecus}>
            {recus} reçu(s){aTraiter ? ` · ${aTraiter} à traiter` : ''}
          </button>
        ) : <div>Aucun reçu pour l'instant</div>}
      </div>
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        {peutDeposer && (
          <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.6rem' }} onClick={onDeposer}
            title="Déposer ce questionnaire rempli par le client" aria-label={`Déposer « ${modele.titre} » rempli`}>
            <UploadCloud size={15} />
          </button>
        )}
        <button
          type="button"
          className={`btn btn-primary qp-bouton-telecharger${etat === 'fait' ? ' fait' : ''}`}
          aria-busy={etat === 'encours'}
          disabled={etat === 'encours'}
          onClick={onTelecharger}
          title={`Enregistré sous « ${modele.nom_fichier} »`}
        >
          {etat === 'fait' ? <><Check size={15} className="qp-telecharge" /> Téléchargé</> : <>{etat !== 'encours' && <Download size={15} />} Télécharger</>}
        </button>
      </div>
    </div>
  </article>
);

export const QuestionnairesPage = () => {
  const navigate = useNavigate();
  const [parametres, setParametres] = useSearchParams();
  const { peut } = useAuth();
  const { success, error: erreurToast, info } = useToast();
  const peutDeposer = peut('crm.update');

  const [catalogue, setCatalogue] = useState({ modeles: [], extensions: [], taille_max: 0 });
  const [recus, setRecus] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState('');
  const [onglet, setOnglet] = useState(parametres.get('onglet') === 'recus' ? 'recus' : 'modeles');
  const [branche, setBranche] = useState('TOUTES');
  const [recherche, setRecherche] = useState('');
  const [rechercheRecus, setRechercheRecus] = useState('');
  const [filtreEtape, setFiltreEtape] = useState('TOUTES');
  const [filtreModele, setFiltreModele] = useState('');
  const [telechargements, setTelechargements] = useState({});
  const [depot, setDepot] = useState(null);
  const [deplie, setDeplie] = useState(null);
  const [enCours, setEnCours] = useState(null);
  const [surligne, setSurligne] = useState(null);
  // Contenu lu de chaque questionnaire déplié : { [id]: { chargement, donnees, erreur, version } }
  const [lectures, setLectures] = useState({});

  const relire = (q) => {
    setLectures((l) => ({ ...l, [q.id]: { chargement: true, version: q.version } }));
    questionnaireApi.lecture(q.id)
      .then((donnees) => setLectures((l) => ({ ...l, [q.id]: { donnees, version: q.version } })))
      .catch((err) => setLectures((l) => ({ ...l, [q.id]: { erreur: `Lecture impossible : ${messageErreur(err)}`, version: q.version } })));
  };
  const deplier = (q) => {
    setDeplie(q ? q.id : null);
    if (!q || (lectures[q.id] && lectures[q.id].version === q.version && !lectures[q.id].erreur)) return;
    relire(q);
  };

  // Fichier d'un autre questionnaire que celui choisi au dépôt (reconnu d'après son contenu) : le reclasser fait
  // ouvrir le bon écran de devis
  const reclasser = async (q, cible) => {
    setEnCours(q.id);
    try {
      const maj = await questionnaireApi.modifier(q.id, { modele: cible.code });
      const nouveau = { ...q, ...maj };
      setRecus((l) => l.map((x) => (x.id === q.id ? nouveau : x)));
      setSurligne(q.id);
      relire(nouveau);
      success(`Questionnaire de ${q.prospect_nom} reclassé en « ${cible.titre} » : « Établir le devis » ouvre maintenant l'écran de la branche ${cible.branche}.`);
    } catch (err) {
      erreurToast(`Questionnaire non reclassé : ${messageErreur(err)}`);
    } finally {
      setEnCours(null);
    }
  };

  const prospectId = parametres.get('prospect');
  const prospectFiltre = prospects.find((p) => String(p.id) === String(prospectId)) || null;

  const charger = useCallback(async () => {
    setChargement(true);
    setErreurChargement('');
    try {
      const [cat, liste, leads] = await Promise.all([
        questionnaireApi.modeles(),
        questionnaireApi.recus(),
        crmApi.getLeads().catch(() => []),
      ]);
      setCatalogue(cat);
      setRecus(Array.isArray(liste) ? liste : []);
      setProspects(Array.isArray(leads) ? leads : []);
    } catch (err) {
      setErreurChargement(`Les questionnaires n'ont pas pu être chargés : ${messageErreur(err)}`);
    } finally {
      setChargement(false);
    }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  // Surbrillance passagère de la ligne déposée ou modifiée
  useEffect(() => {
    if (!surligne) return undefined;
    const minuterie = setTimeout(() => setSurligne(null), 2600);
    return () => clearTimeout(minuterie);
  }, [surligne]);

  const changerOnglet = (id) => {
    setOnglet(id);
    const suite = new URLSearchParams(parametres);
    if (id === 'recus') suite.set('onglet', 'recus'); else suite.delete('onglet');
    setParametres(suite, { replace: true });
  };
  const retirerFiltreProspect = () => {
    const suite = new URLSearchParams(parametres);
    suite.delete('prospect');
    setParametres(suite, { replace: true });
  };

  // ---------------------------------------------------------------- modèles
  const modeles = catalogue.modeles || [];
  const branches = useMemo(() => [...new Set(modeles.map((m) => m.branche))], [modeles]);
  const parModele = useMemo(() => recus.reduce((acc, q) => {
    const c = acc[q.modele] || (acc[q.modele] = { recus: 0, aTraiter: 0 });
    c.recus += 1;
    if (A_TRAITER.includes(q.statut)) c.aTraiter += 1;
    return acc;
  }, {}), [recus]);
  const modelesAffiches = modeles.filter((m) => (branche === 'TOUTES' || m.branche === branche)
    && correspondRecherche(recherche, [m.titre, m.branche, m.compagnie, m.description, ...m.rubriques]));

  const telecharger = async (modele) => {
    setTelechargements((t) => ({ ...t, [modele.code]: 'encours' }));
    try {
      await questionnaireApi.telechargerModele(modele);
      setTelechargements((t) => ({ ...t, [modele.code]: 'fait' }));
      success(`« ${modele.nom_fichier} » téléchargé. Envoyez-le au client, puis déposez ici le questionnaire rempli.`);
      setTimeout(() => setTelechargements((t) => ({ ...t, [modele.code]: undefined })), 2600);
    } catch (err) {
      setTelechargements((t) => ({ ...t, [modele.code]: undefined }));
      erreurToast(`Téléchargement impossible : ${messageErreur(err)}`);
    }
  };

  // ---------------------------------------------------------------- questionnaires reçus
  const recusDuProspect = prospectFiltre ? recus.filter((q) => q.lead === prospectFiltre.id) : recus;
  const comptesEtapes = ETAPES_QUESTIONNAIRE.reduce((acc, e) => ({ ...acc, [e.id]: recusDuProspect.filter((q) => q.statut === e.id).length }), {});
  const recusAffiches = recusDuProspect.filter((q) => (filtreEtape === 'TOUTES' || q.statut === filtreEtape)
    && (!filtreModele || q.modele === filtreModele)
    && correspondRecherche(rechercheRecus, [q.prospect_nom, q.lead_reference, q.titre, q.branche, q.nom_original, q.note, q.depose_par_nom]));
  const aTraiter = recus.filter((q) => A_TRAITER.includes(q.statut)).length;

  // Étape du prospect changée par un dépôt ou un devis : fiche et lignes de ses autres questionnaires
  const mettreAJourProspect = (id, champs) => {
    setProspects((l) => l.map((p) => (p.id === id ? { ...p, ...champs } : p)));
    if (champs.statut) setRecus((l) => l.map((q) => (q.lead === id ? { ...q, lead_statut: champs.statut } : q)));
  };

  const surDepot = (resultat, estVersion) => {
    const q = estVersion ? resultat : resultat.questionnaire;
    setRecus((l) => [q, ...l.filter((x) => x.id !== q.id)]);
    setSurligne(q.id);
    setFiltreEtape('TOUTES');
    setFiltreModele('');
    changerOnglet('recus');
    if (estVersion) {
      success(`Version ${q.version} de « ${q.titre} » déposée pour ${q.prospect_nom} : l'étape repasse à « Reçu ».`);
      return;
    }
    const p = resultat.prospect;
    setProspects((l) => (l.some((x) => x.id === p.id) ? l.map((x) => (x.id === p.id ? p : x)) : [p, ...l]));
    setRecus((l) => l.map((x) => (x.lead === p.id ? { ...x, lead_statut: p.statut } : x)));
    success([
      `Questionnaire « ${q.titre} » déposé pour ${q.prospect_nom}.`,
      resultat.prospect_cree ? `Prospect ${p.id_lead} créé dans le suivi commercial.` : '',
      resultat.prospect_avance ? 'Le prospect passe à l\'étape « Qualifié ».' : '',
    ].filter(Boolean).join(' '));
  };

  const changerEtape = async (q, statut) => {
    if (statut === q.statut) return;
    let note;
    if (statut === 'À compléter') {
      note = await saisirTexte({
        titre: 'Que doit compléter le client ?',
        message: `« ${q.titre} » de ${q.prospect_nom} : la précision est gardée dans la note du questionnaire.`,
        placeholder: 'Ex. : valeurs vénales des véhicules 3 à 5, signature et cachet manquants…',
        valeur: q.note,
        minimum: 0,
        confirmer: 'Enregistrer',
      });
      if (note === null) return;
    }
    setEnCours(q.id);
    try {
      const maj = await questionnaireApi.modifier(q.id, note !== undefined ? { statut, note } : { statut });
      setRecus((l) => l.map((x) => (x.id === q.id ? { ...x, ...maj } : x)));
      setSurligne(q.id);
      if (maj.lead && maj.prospect_avance) mettreAJourProspect(maj.lead, { statut: maj.lead_statut });
      success(`${q.prospect_nom} : questionnaire « ${statut} ».${maj.prospect_avance ? ` Le prospect passe à « ${maj.lead_statut} ».` : ''}`);
    } catch (err) {
      erreurToast(`Étape non modifiée : ${messageErreur(err)}`);
    } finally {
      setEnCours(null);
    }
  };

  // Le devis s'établit dans le formulaire de la branche ; le questionnaire passe « En étude »
  const etablirDevis = async (q) => {
    if (peutDeposer && q.statut === 'Reçu') {
      try {
        const maj = await questionnaireApi.modifier(q.id, { statut: 'En étude' });
        setRecus((l) => l.map((x) => (x.id === q.id ? { ...x, ...maj } : x)));
      } catch {
        // l'ouverture du formulaire n'en dépend pas
      }
    }
    info(`Devis de ${q.prospect_nom} : les informations du questionnaire sont proposées en haut de l'écran ; il passera « Devis établi » à l'enregistrement du devis.`);
    // L'écran de devis relit le questionnaire (?questionnaire=) : souscripteur, véhicules, assurés, capitaux…
    navigate(`${q.route_devis}?questionnaire=${q.id}`);
  };

  const ouvrirRecu = async (q) => {
    setEnCours(q.id);
    try {
      await questionnaireApi.telechargerRecu(q);
    } catch (err) {
      erreurToast(`Fichier non téléchargé : ${messageErreur(err)}`);
    } finally {
      setEnCours(null);
    }
  };

  const supprimer = async (q) => {
    if (!(await confirmer({
      ton: 'danger',
      titre: `Supprimer le questionnaire de ${q.prospect_nom} ?`,
      message: `« ${q.titre} » (${q.nom_original})${q.version > 1 ? ' et ses versions précédentes' : ''} sera supprimé définitivement. Le prospect reste dans le suivi commercial.`,
      confirmer: 'Supprimer le questionnaire',
    }))) return;
    try {
      await questionnaireApi.supprimer(q.id);
      setRecus((l) => l.filter((x) => x.id !== q.id));
      success(`Questionnaire de ${q.prospect_nom} supprimé.`);
    } catch (err) {
      erreurToast(`Questionnaire non supprimé : ${messageErreur(err)}`);
    }
  };

  const ouvrirDepot = (initial = {}) => setDepot({ leadId: prospectFiltre?.id, ...initial });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* En-tête */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="title-xl">Questionnaires prospects</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem', maxWidth: '62ch' }}>
            Les questionnaires à faire remplir par le client avant la cotation, et ceux qu'il a renvoyés.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/user/crm')} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <TrendingUp size={16} /> Suivi commercial
          </button>
          {peutDeposer && (
            <button type="button" className="btn btn-primary" onClick={() => ouvrirDepot()} disabled={chargement || !!erreurChargement}
              style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <UploadCloud size={16} /> Déposer un questionnaire rempli
            </button>
          )}
        </div>
      </div>

      {/* Le parcours en trois temps */}
      <ol className="qp-parcours" aria-label="Déroulement">
        {PARCOURS.map((e, i) => {
          const Icone = e.icone;
          return (
            <li key={e.titre} className="qp-etape" style={{ '--ton': e.ton }}>
              <span className="qp-etape-numero"><Icone size={16} /></span>
              <span>
                <span className="qp-etape-titre">{i + 1}. {e.titre}</span>
                <span className="qp-etape-texte">{e.texte}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {/* Prospect choisi depuis le suivi commercial */}
      {prospectFiltre && (
        <div className="glass-panel bandeau-anime qp-bandeau">
          <ClipboardList size={18} color="var(--primary-500)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ color: 'var(--text-primary)' }}>{prospectFiltre.nom_prospect}</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}> · {prospectFiltre.id_lead} · {prospectFiltre.branche}</span>
          </div>
          <StatusBadge label={prospectFiltre.statut} color={etapeDe(prospectFiltre.statut).badge} />
          {peutDeposer && (
            <button type="button" className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}
              onClick={() => ouvrirDepot({ leadId: prospectFiltre.id })}>
              <UploadCloud size={14} /> Déposer son questionnaire
            </button>
          )}
          <button type="button" className="modal-close-btn" aria-label="Voir tous les prospects" title="Voir tous les prospects" onClick={retirerFiltreProspect}>
            <X size={15} />
          </button>
        </div>
      )}

      {/* Onglets */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }} role="tablist">
        <Onglet actif={onglet === 'modeles'} onClick={() => changerOnglet('modeles')} icone={ClipboardList} compte={modeles.length}>
          Questionnaires à télécharger
        </Onglet>
        <Onglet actif={onglet === 'recus'} onClick={() => changerOnglet('recus')} icone={Inbox} compte={recusDuProspect.length}
          alerte={prospectFiltre ? 0 : aTraiter}>
          Questionnaires reçus
        </Onglet>
      </div>

      {chargement && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem' }}><LoadingSpinner size={36} /></div>
      )}

      {!chargement && erreurChargement && (
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--accent-rose)' }}>{erreurChargement}</span>
          <button type="button" className="btn btn-secondary" onClick={charger} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <RotateCcw size={14} /> Réessayer
          </button>
        </div>
      )}

      {/* ------------------------------------------------ Questionnaires à télécharger */}
      {!chargement && !erreurChargement && onglet === 'modeles' && (
        <section role="tabpanel" aria-label="Questionnaires à télécharger" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="qp-filtres" role="group" aria-label="Branche">
              {['TOUTES', ...branches].map((b) => (
                <button key={b} type="button" className="qp-puce" aria-pressed={branche === b} onClick={() => setBranche(b)}>
                  {b === 'TOUTES' ? 'Toutes les branches' : b}
                  <span className="qp-puce-compte">{b === 'TOUTES' ? modeles.length : modeles.filter((m) => m.branche === b).length}</span>
                </button>
              ))}
            </div>
            <div style={{ position: 'relative', width: 'min(320px, 100%)' }}>
              <Search size={15} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="text" className="form-control" style={{ paddingLeft: '2.3rem', fontSize: '0.86rem' }} value={recherche}
                onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher un questionnaire, une rubrique…" aria-label="Rechercher un questionnaire" />
            </div>
          </div>

          {modelesAffiches.length === 0 ? (
            <div className="glass-panel etat-anime" style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Search size={28} style={{ marginBottom: '0.5rem' }} />
              <div>Aucun questionnaire ne correspond à « {recherche} ».</div>
            </div>
          ) : (
            <div className="qp-grille">
              {modelesAffiches.map((m, i) => (
                <CarteModele
                  key={m.code}
                  modele={m}
                  rang={i}
                  etat={telechargements[m.code]}
                  recus={parModele[m.code]?.recus || 0}
                  aTraiter={parModele[m.code]?.aTraiter || 0}
                  peutDeposer={peutDeposer}
                  onTelecharger={() => telecharger(m)}
                  onDeposer={() => ouvrirDepot({ modele: m.code })}
                  onVoirRecus={() => { setFiltreModele(m.code); setFiltreEtape('TOUTES'); changerOnglet('recus'); }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------------ Questionnaires reçus */}
      {!chargement && !erreurChargement && onglet === 'recus' && (
        <section role="tabpanel" aria-label="Questionnaires reçus" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="qp-filtres" role="group" aria-label="Étape">
              <button type="button" className="qp-puce" aria-pressed={filtreEtape === 'TOUTES'} onClick={() => setFiltreEtape('TOUTES')}>
                Toutes <span className="qp-puce-compte">{recusDuProspect.length}</span>
              </button>
              {ETAPES_QUESTIONNAIRE.map((e) => (
                <button key={e.id} type="button" className={`qp-puce ton-${e.couleur}`} aria-pressed={filtreEtape === e.id}
                  onClick={() => setFiltreEtape(e.id)} title={e.aide}>
                  {e.id} <span className="qp-puce-compte">{comptesEtapes[e.id]}</span>
                </button>
              ))}
              {filtreModele && (
                <button type="button" className="qp-puce" aria-pressed onClick={() => setFiltreModele('')} title="Retirer ce filtre">
                  {modeles.find((m) => m.code === filtreModele)?.titre || filtreModele} <X size={12} />
                </button>
              )}
            </div>
            <div style={{ position: 'relative', width: 'min(320px, 100%)' }}>
              <Search size={15} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="text" className="form-control" style={{ paddingLeft: '2.3rem', fontSize: '0.86rem' }} value={rechercheRecus}
                onChange={(e) => setRechercheRecus(e.target.value)} placeholder="Rechercher prospect, questionnaire, fichier…" aria-label="Rechercher un questionnaire reçu" />
            </div>
          </div>

          {recusAffiches.length === 0 ? (
            <div className="glass-panel etat-anime" style={{ padding: '2.75rem 1rem', textAlign: 'center', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
              <Inbox size={34} />
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {recusDuProspect.length ? 'Aucun questionnaire ne correspond aux filtres.' : 'Aucun questionnaire reçu pour le moment.'}
              </div>
              {!recusDuProspect.length && (
                <div style={{ fontSize: '0.85rem', maxWidth: '52ch' }}>
                  Quand le client renvoie son questionnaire rempli, déposez-le ici : il sera rattaché à son prospect.
                </div>
              )}
              {peutDeposer && !recusDuProspect.length && (
                <button type="button" className="btn btn-primary" onClick={() => ouvrirDepot()} style={{ marginTop: '0.4rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <UploadCloud size={15} /> Déposer un questionnaire rempli
                </button>
              )}
            </div>
          ) : (
            <div className="glass-panel" style={{ padding: '0.5rem' }}>
              <div className="table-wrapper">
                <table className="data-table qp-table">
                  <thead>
                    <tr>
                      <th aria-label="Détail" style={{ width: '2.2rem' }} />
                      <th>Prospect</th>
                      <th>Questionnaire</th>
                      <th>Reçu le</th>
                      <th>Étape</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recusAffiches.map((q) => {
                      const etape = etapeQuestionnaire(q.statut);
                      const ouvert = deplie === q.id;
                      return (
                        <React.Fragment key={q.id}>
                          <tr className={surligne === q.id ? 'qp-surligne' : ''} data-questionnaire={q.id}>
                            <td>
                              <button type="button" className={`qp-deplier${ouvert ? ' ouvert' : ''}`} aria-expanded={ouvert}
                                aria-label={ouvert ? 'Masquer le détail' : 'Voir le détail et l\'historique'} onClick={() => deplier(ouvert ? null : q)}>
                                <ChevronDown size={15} />
                              </button>
                            </td>
                            <td>
                              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{q.prospect_nom}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                {q.lead_reference ? (
                                  <button type="button" className="qp-lien" title="Voir ses questionnaires"
                                    onClick={() => { const s = new URLSearchParams(parametres); s.set('prospect', q.lead); setParametres(s, { replace: true }); }}>
                                    {q.lead_reference}
                                  </button>
                                ) : 'prospect supprimé'}
                                {q.lead_statut && <span>· {etapeDe(q.lead_statut).label}</span>}
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                                <IconeFormat extension={q.extension} taille={32} />
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{q.titre}</div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    {q.branche} · {tailleLisible(q.taille)}{q.version > 1 ? ` · version ${q.version}` : ''}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                              <div>{dateHeure(q.date_depot)}</div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>{q.depose_par_nom}</div>
                            </td>
                            <td>
                              {peutDeposer ? (
                                <select className={`form-control qp-etape-choix ton-${etape.couleur}`} value={q.statut} disabled={enCours === q.id}
                                  aria-label={`Étape du questionnaire de ${q.prospect_nom}`} title={etape.aide}
                                  onChange={(e) => changerEtape(q, e.target.value)}>
                                  {ETAPES_QUESTIONNAIRE.map((e) => <option key={e.id} value={e.id}>{e.id}</option>)}
                                </select>
                              ) : <StatusBadge label={q.statut} color={etape.couleur} />}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                                <button type="button" className="btn btn-secondary qp-icone" onClick={() => ouvrirRecu(q)} disabled={enCours === q.id}
                                  title={`Télécharger « ${q.nom_telechargement} »`} aria-label={`Télécharger le questionnaire de ${q.prospect_nom}`}>
                                  <Download size={15} />
                                </button>
                                {peutDeposer && (
                                  <button type="button" className="btn btn-secondary qp-icone" onClick={() => setDepot({ version: q })}
                                    title="Le client a renvoyé le questionnaire complété : déposer la nouvelle version" aria-label="Déposer une nouvelle version">
                                    <UploadCloud size={15} />
                                  </button>
                                )}
                                {q.route_devis && q.statut !== 'Devis établi' && peut(['devis.create', 'devis.update']) && (
                                  <button type="button" className="btn btn-primary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}
                                    onClick={() => etablirDevis(q)} title="Ouvrir le formulaire de devis de la branche">
                                    Établir le devis <ArrowRight size={14} />
                                  </button>
                                )}
                                {q.statut === 'Devis établi' && (
                                  <span className="qp-fait" title="Devis établi"><FileCheck2 size={15} /> Devis établi</span>
                                )}
                                {peutDeposer && (
                                  <button type="button" className="btn btn-secondary qp-icone danger" onClick={() => supprimer(q)}
                                    title="Supprimer ce questionnaire" aria-label={`Supprimer le questionnaire de ${q.prospect_nom}`}>
                                    <Trash2 size={15} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {ouvert && (
                            <tr className="qp-detail">
                              <td />
                              <td colSpan={5}>
                                <div className="qp-detail-contenu">
                                  <div>
                                    <div className="qp-detail-titre">Fichier reçu</div>
                                    <div style={{ fontSize: '0.84rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>{q.nom_original}</div>
                                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Téléchargé sous « {q.nom_telechargement} »</div>
                                    <div className="qp-detail-titre" style={{ marginTop: '0.8rem' }}>Note</div>
                                    <div style={{ fontSize: '0.84rem', color: q.note ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'pre-line' }}>
                                      {q.note || 'Aucune note.'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="qp-detail-titre"><History size={13} /> Historique</div>
                                    <ol className="qp-historique">
                                      {[...(q.historique || [])].reverse().map((h, i) => (
                                        <li key={`${h.date}-${i}`}>
                                          <span style={{ color: 'var(--text-primary)' }}>{h.action}</span>
                                          <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}> - {dateHeure(h.date)}, {h.auteur}</span>
                                        </li>
                                      ))}
                                    </ol>
                                  </div>
                                </div>
                                <div style={{ marginTop: '0.9rem' }}>
                                  <div className="qp-detail-titre"><FileCheck2 size={13} /> Contenu lu dans le fichier</div>
                                  {lectures[q.id]?.chargement && (
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                      <LoadingSpinner size={16} /> Lecture du questionnaire…
                                    </div>
                                  )}
                                  {lectures[q.id]?.erreur && <div className="champ-message erreur">{lectures[q.id].erreur}</div>}
                                  {lectures[q.id]?.donnees?.modele_detecte && (
                                    <div className="qp-analyse attention" style={{ marginBottom: '0.7rem' }} role="status">
                                      <div className="qp-analyse-titre">
                                        <AlertTriangle size={16} /> Ce fichier est le questionnaire « {lectures[q.id].donnees.modele_detecte.titre} »
                                      </div>
                                      <div className="qp-analyse-ligne">
                                        Il a été déposé comme « {q.titre} » : il est lu d'après son contenu. Reclassez-le pour que
                                        « Établir le devis » ouvre l'écran de la branche {lectures[q.id].donnees.modele_detecte.branche}.
                                      </div>
                                      {peutDeposer && (
                                        <div>
                                          <button type="button" className="btn btn-primary" disabled={enCours === q.id}
                                            style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}
                                            onClick={() => reclasser(q, lectures[q.id].donnees.modele_detecte)}>
                                            Reclasser en « {lectures[q.id].donnees.modele_detecte.titre} »
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {lectures[q.id]?.donnees && (
                                    <>
                                      {lectures[q.id].donnees.resume && (
                                        <div style={{ fontSize: '0.84rem', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '0.4rem' }}>
                                          {lectures[q.id].donnees.resume}
                                        </div>
                                      )}
                                      <ContenuQuestionnaire lecture={lectures[q.id].donnees} />
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <DepotQuestionnaireModal
        isOpen={Boolean(depot)}
        onClose={() => setDepot(null)}
        modeles={modeles}
        prospects={prospects}
        extensions={catalogue.extensions || []}
        tailleMax={catalogue.taille_max}
        initial={depot}
        onDepose={surDepot}
        onEtablirDevis={etablirDevis}
        peutDevis={peut(['devis.create', 'devis.update'])}
      />
    </div>
  );
};

export default QuestionnairesPage;
