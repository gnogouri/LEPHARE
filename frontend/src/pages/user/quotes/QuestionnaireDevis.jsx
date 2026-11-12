import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useNavigate } from '../../../utils/navigationDevis';
import { AlertTriangle, ChevronDown, ClipboardList, Download, FileCheck2, Search, UserPlus, X } from 'lucide-react';
import { questionnaireApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { etapeQuestionnaire, messageErreur } from '../crm/questionnairesOutils';

/**
 * Devis établi à partir d'un questionnaire prospect (« Établir le devis » de l'écran Questionnaires prospects :
 * ?questionnaire=<id> dans l'adresse). Le questionnaire est relu par le serveur (lecture_questionnaires.py) :
 * souscripteur, réponses, tableaux et données que l'écran de la branche reprend (véhicules, assurés, capitaux…).
 */
export const useQuestionnaireDevis = () => {
  const [parametres, setParametres] = useSearchParams();
  const { success, error: erreurToast } = useToast();
  const id = Number(parametres.get('questionnaire')) || 0;
  const [questionnaire, setQuestionnaire] = useState(null);
  const [lecture, setLecture] = useState(null);
  const [chargement, setChargement] = useState(Boolean(id));
  const [erreur, setErreur] = useState('');
  const [relecture, setRelecture] = useState(0);
  const naviguer = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!id) {
      setQuestionnaire(null);
      setLecture(null);
      setChargement(false);
      return undefined;
    }
    let actif = true;
    setChargement(true);
    setErreur('');
    Promise.all([questionnaireApi.recu(id), questionnaireApi.lecture(id)])
      .then(([q, l]) => { if (actif) { setQuestionnaire(q); setLecture(l); } })
      .catch((err) => { if (actif) setErreur(`Questionnaire non chargé : ${messageErreur(err)}`); })
      .finally(() => { if (actif) setChargement(false); });
    return () => { actif = false; };
  }, [id, relecture]);

  // Fichier d'un autre questionnaire que celui choisi au dépôt (reconnu d'après son contenu) : reclassé, puis le devis
  // s'établit dans l'écran de la bonne branche
  const reclasser = useCallback(async () => {
    const cible = lecture?.modele_detecte;
    if (!questionnaire || !cible) return;
    try {
      await questionnaireApi.modifier(questionnaire.id, { modele: cible.code });
      success(`Questionnaire reclassé en « ${cible.titre} ».`);
      if (cible.route_devis && !pathname.startsWith(cible.route_devis)) {
        naviguer(`${cible.route_devis}?questionnaire=${questionnaire.id}`);
      } else {
        setRelecture((n) => n + 1);
      }
    } catch (err) {
      erreurToast(`Questionnaire non reclassé : ${messageErreur(err)}`);
    }
  }, [questionnaire, lecture, pathname, naviguer, success, erreurToast]);

  const fichier = useCallback(() => questionnaireApi.fichierRecu(questionnaire), [questionnaire]);

  const fermer = () => {
    const suite = new URLSearchParams(parametres);
    suite.delete('questionnaire');
    setParametres(suite, { replace: true });
  };

  // Devis enregistré : le questionnaire passe « Devis établi » (et le prospect à « Proposition »)
  const devisEtabli = useCallback(async (numero) => {
    if (!questionnaire || questionnaire.statut === 'Devis établi') return;
    try {
      const note = [questionnaire.note, numero ? `Devis ${numero}` : ''].filter(Boolean).join('\n');
      const maj = await questionnaireApi.modifier(questionnaire.id, { statut: 'Devis établi', note });
      setQuestionnaire((q) => ({ ...q, ...maj }));
      success(`Questionnaire de ${questionnaire.prospect_nom} : « Devis établi »${maj.prospect_avance ? ', prospect en « Proposition »' : ''}.`);
    } catch (err) {
      erreurToast(`Questionnaire non mis à jour : ${messageErreur(err)}`);
    }
  }, [questionnaire, success, erreurToast]);

  const souscripteur = lecture?.souscripteur || {};
  // Fiche client pré-remplie (QuickAddClientModal)
  const client = lecture ? {
    typeclient: souscripteur.type === 'Entreprise' ? 'Entreprise' : 'Particulier',
    nom: souscripteur.nom || '',
    telephone: souscripteur.telephone || '',
    email: souscripteur.email || '',
    adresse: souscripteur.adresse || '',
    // Noms des champs de stdclient : contact = représentant légal, RCCM dans le champ pièce / RCCM
    Responsable: souscripteur.contact || '',
    CniPat: souscripteur.registre_commerce || '',
  } : null;

  return {
    id, actif: Boolean(id), questionnaire, lecture, chargement, erreur, fichier, fermer, devisEtabli, reclasser,
    devis: lecture?.devis || null, souscripteur, client,
  };
};

// Réponses lues, par rubrique, et tableaux (véhicules, assurés, personnel…)
export const ContenuQuestionnaire = ({ lecture, max = 400 }) => {
  if (!lecture) return null;
  const sections = lecture.sections || [];
  const tableaux = (lecture.tableaux || []).filter((t) => t.lignes?.length);
  if (!sections.length && !tableaux.length) {
    return <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{lecture.message || 'Aucune réponse lue.'}</div>;
  }
  let reste = max;
  return (
    <div className="qd-contenu">
      {sections.map((s, i) => {
        const reponses = s.reponses.slice(0, Math.max(reste, 0));
        reste -= reponses.length;
        if (!reponses.length) return null;
        return (
          <div key={`${s.titre}-${i}`} className="qd-section">
            <div className="qp-detail-titre">{s.titre}</div>
            <dl>
              {reponses.map((r, k) => (
                <React.Fragment key={`${r.libelle}-${k}`}>
                  <dt>{r.libelle || '-'}</dt>
                  <dd>{r.genre === 'choix' ? <span className="qd-choix">{r.valeur}</span> : r.valeur}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        );
      })}
      {tableaux.map((t) => (
        <div key={t.titre} className="qd-section qd-section-large">
          <div className="qp-detail-titre">{t.titre} ({t.lignes.length})</div>
          <div className="table-wrapper">
            <table className="data-table qd-tableau">
              <thead><tr>{t.colonnes.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {t.lignes.slice(0, 60).map((l, k) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <tr key={k}>{t.colonnes.map((c) => (
                    <td key={c}>{typeof l[c] === 'number' && c !== 'Ligne' ? l[c].toLocaleString('fr-FR') : String(l[c] ?? '')}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

const CHAMPS_SOUSCRIPTEUR = [
  ['nom', 'Souscripteur'], ['adresse', 'Adresse'], ['telephone', 'Téléphone'], ['email', 'E-mail'], ['contact', 'Contact'],
  ['activite', 'Activité'],
];

/**
 * Bandeau des écrans de devis : ce que le questionnaire apporte et les reprises possibles.
 * actions : [{ libelle, icone, onClick, disabled, titre, principal }] propres à la branche.
 */
export const BandeauQuestionnaire = ({ qd, onChercherClient, onCreerClient, actions = [], children }) => {
  const [ouvert, setOuvert] = useState(false);
  const [telechargement, setTelechargement] = useState(false);
  const { error: erreurToast } = useToast();
  const { pathname } = useLocation();
  if (!qd?.actif) return null;
  const { questionnaire: q, lecture, souscripteur } = qd;
  // Questionnaire reconnu d'après son contenu, différent de celui choisi : son devis est-il dans un autre écran ?
  const detecte = lecture?.modele_detecte;
  const autreEcran = Boolean(detecte?.route_devis && !pathname.startsWith(detecte.route_devis));
  const telecharger = async () => {
    setTelechargement(true);
    try {
      await questionnaireApi.telechargerRecu(q);
    } catch (err) {
      erreurToast(`Fichier non téléchargé : ${messageErreur(err)}`);
    } finally {
      setTelechargement(false);
    }
  };
  return (
    <section className="glass-panel bandeau-anime qd-bandeau" aria-label="Questionnaire du prospect">
      <div className="qd-entete">
        <span className="qd-icone"><ClipboardList size={18} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="qd-titre">Devis à partir du questionnaire{q ? ` « ${q.titre} »` : ''}</div>
          {q && (
            <div className="qd-sous-titre">
              {q.prospect_nom}{q.lead_reference ? ` · ${q.lead_reference}` : ''} · reçu le {new Date(q.date_depot).toLocaleDateString('fr-FR')}
              {lecture?.resume ? ` · ${lecture.resume}` : ''}
            </div>
          )}
        </div>
        {q && <StatusBadge label={q.statut} color={etapeQuestionnaire(q.statut).couleur} />}
        <button type="button" className="modal-close-btn" onClick={qd.fermer} aria-label="Fermer le questionnaire" title="Continuer sans le questionnaire">
          <X size={15} />
        </button>
      </div>

      {qd.chargement && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <LoadingSpinner size={18} /> Lecture du questionnaire…
        </div>
      )}
      {qd.erreur && <div className="champ-message erreur">{qd.erreur}</div>}

      {!qd.chargement && lecture && (
        <>
          {lecture.modele_detecte && (
            <div className="qp-analyse attention" role="status">
              <div className="qp-analyse-titre">
                <AlertTriangle size={16} /> Ce fichier est le questionnaire « {lecture.modele_detecte.titre} »
              </div>
              <div className="qp-analyse-ligne">
                Il a été déposé comme « {q?.titre} » : il est lu d'après son contenu.
                {autreEcran ? ` Son devis s'établit dans l'écran de la branche ${detecte.branche}.` : ''}
              </div>
              <div>
                <button type="button" className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem' }} onClick={qd.reclasser}>
                  Reclasser{autreEcran ? ` et ouvrir le devis ${detecte.branche}` : ''}
                </button>
              </div>
            </div>
          )}
          {!lecture.lisible && lecture.message && (
            <div className="qd-alerte"><AlertTriangle size={15} /> {lecture.message}</div>
          )}
          <div className="qd-souscripteur">
            {CHAMPS_SOUSCRIPTEUR.filter(([cle]) => souscripteur[cle]).map(([cle, libelle]) => (
              <div key={cle}>
                <span>{libelle}</span>
                <strong title={souscripteur[cle]}>{souscripteur[cle]}</strong>
              </div>
            ))}
          </div>
          {(lecture.avertissements || []).filter((a) => !lecture.modele_detecte || !a.startsWith('Ce fichier est le questionnaire')).length > 0 && (
            <ul className="qd-avertissements">
              {lecture.avertissements.filter((a) => !lecture.modele_detecte || !a.startsWith('Ce fichier est le questionnaire'))
                .slice(0, 8).map((a) => <li key={a}><AlertTriangle size={13} /> {a}</li>)}
            </ul>
          )}

          {/* Du questionnaire au devis, en trois étapes */}
          <ol className="qd-etapes" aria-label="Établir le devis à partir du questionnaire">
            <li className="qd-etape">
              <span className="qd-etape-numero">1</span>
              <div>
                <div className="qd-etape-titre">Le client</div>
                <div className="qd-etape-aide">
                  {onChercherClient || onCreerClient
                    ? 'Le prospect est peut-être déjà client : cherchez-le ; sinon créez sa fiche, pré-remplie avec le questionnaire.'
                    : 'Choisissez ou créez le client dans le formulaire ci-dessous.'}
                </div>
                {(onChercherClient || onCreerClient) && (
                  <div className="qd-actions">
                    {onChercherClient && souscripteur.nom && (
                      <button type="button" className="btn btn-secondary" onClick={() => onChercherClient(souscripteur.nom)}
                        title="Le prospect est peut-être déjà client : le chercher dans la liste des clients">
                        <Search size={14} /> Chercher « {souscripteur.nom.length > 28 ? `${souscripteur.nom.slice(0, 28)}…` : souscripteur.nom} »
                      </button>
                    )}
                    {onCreerClient && (
                      <button type="button" className="btn btn-secondary" onClick={onCreerClient} title="Fiche client pré-remplie avec les informations du questionnaire">
                        <UserPlus size={14} /> Créer le client
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
            <li className="qd-etape">
              <span className="qd-etape-numero">2</span>
              <div>
                <div className="qd-etape-titre">Les données du questionnaire</div>
                <div className="qd-etape-aide">
                  {autreEcran
                    ? `Reclassez d'abord le questionnaire (ci-dessus) : ses données se reprennent dans l'écran de la branche ${detecte.branche}.`
                    : actions.length
                      ? 'Reprenez-les dans le devis en un clic.'
                      : 'Rien à reprendre automatiquement pour cette branche : reportez les réponses utiles dans le formulaire.'}
                </div>
                {children}
                <div className="qd-actions">
                  {actions.map((a) => {
                    const Icone = a.icone;
                    return (
                      <button key={a.libelle} type="button" className={`btn ${a.principal ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={a.onClick} disabled={a.disabled} title={a.titre} aria-busy={a.occupe || undefined}>
                        {Icone && !a.occupe && <Icone size={14} />} {a.libelle}
                      </button>
                    );
                  })}
                  <button type="button" className="btn btn-secondary" onClick={telecharger} aria-busy={telechargement} disabled={telechargement || !q}>
                    {!telechargement && <Download size={14} />} Fichier du client
                  </button>
                  {(lecture.sections?.length > 0 || lecture.tableaux?.some((t) => t.lignes?.length)) && (
                    <button type="button" className={`qd-deplier${ouvert ? ' ouvert' : ''}`} onClick={() => setOuvert((v) => !v)} aria-expanded={ouvert}>
                      {ouvert ? 'Masquer' : 'Voir'} les réponses{lecture.reponses ? ` (${lecture.reponses})` : ''} <ChevronDown size={14} />
                    </button>
                  )}
                </div>
                {ouvert && <ContenuQuestionnaire lecture={lecture} />}
              </div>
            </li>
            <li className="qd-etape">
              <span className="qd-etape-numero">3</span>
              <div>
                <div className="qd-etape-titre">Compléter et enregistrer le devis</div>
                <div className="qd-etape-aide">
                  Vérifiez les garanties, calculez puis enregistrez : le questionnaire passe alors seul à « Devis établi »
                  et le prospect à « Proposition ».
                </div>
                {q && q.statut !== 'Devis établi' && (
                  <div className="qd-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => qd.devisEtabli('')}
                      title="Devis fait en dehors de cet écran : marquer le questionnaire « Devis établi »">
                      <FileCheck2 size={14} /> Marquer « Devis établi » sans enregistrer ici
                    </button>
                  </div>
                )}
              </div>
            </li>
          </ol>
        </>
      )}
    </section>
  );
};

export default BandeauQuestionnaire;
