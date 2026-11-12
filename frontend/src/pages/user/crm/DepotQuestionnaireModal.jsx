import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw, Search, Sparkles, UploadCloud, UserPlus, Users, X } from 'lucide-react';
import { Modal } from '../../../components/common/Modal';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { questionnaireApi } from '../../../api/endpoints';
import { correspondRecherche } from '../../../utils/financeUtils';
import { ETAPES_OUVERTES, etapeDe } from './suiviCommercial';
import { IconeFormat, devinerModele, extensionDe, messageErreur, tailleLisible } from './questionnairesOutils';

const LIBELLES_EXTENSIONS = 'Word (.docx, .doc), Excel (.xlsx, .xls), PDF ou photo (.jpg, .png)';

// Ce que le système a lu dans le fichier, avant le dépôt
const PanneauAnalyse = ({ analyse, modele, version, onUtiliser }) => {
  if (!analyse) return null;
  if (analyse.etat === 'encours') {
    return (
      <div className="qp-analyse neutre" aria-live="polite">
        <div className="qp-analyse-titre"><LoadingSpinner size={16} /> Lecture du questionnaire…</div>
      </div>
    );
  }
  if (analyse.etat === 'erreur') {
    return (
      <div className="qp-analyse attention" role="status">
        <div className="qp-analyse-titre"><AlertTriangle size={16} /> Le fichier n'a pas pu être lu</div>
        <div className="qp-analyse-ligne">{analyse.message} Le questionnaire peut quand même être déposé.</div>
      </div>
    );
  }
  const d = analyse.donnees || {};
  const s = d.souscripteur || {};
  const reconnu = d.reconnu;
  // Fichier d'un autre questionnaire que celui choisi (nouvelle version, ou type changé à la main après la lecture)
  const ecart = reconnu && (version ? reconnu.code !== version.modele : modele && reconnu.code !== modele.code);
  const route = (modele || version) && (version ? version.route_devis : modele.route_devis);
  return (
    <div className={`qp-analyse${d.lisible && !ecart ? '' : ' attention'}`} role="status">
      <div className="qp-analyse-titre">
        {d.lisible && !ecart ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
        {reconnu ? `Questionnaire reconnu : ${reconnu.titre}` : d.lisible ? 'Questionnaire lu' : 'Lecture automatique impossible'}
      </div>
      {analyse.corrige && !ecart && (
        <div className="qp-analyse-ligne">
          Vous étiez parti de « {analyse.corrige} » : le type a été corrigé d'après le contenu du fichier.
        </div>
      )}
      {ecart && (
        <div className="qp-analyse-ligne">
          {version
            ? <>Ce fichier n'est pas une nouvelle version de « {version.titre} » : déposez-le plutôt comme nouveau questionnaire.</>
            : <>Le questionnaire choisi est « {modele.titre} ». <button type="button" className="qp-lien" onClick={() => onUtiliser(reconnu.code)}>Utiliser « {reconnu.titre} »</button></>}
        </div>
      )}
      {d.lisible ? (
        <>
          {(d.resume || s.nom) && (
            <div className="qp-analyse-ligne">
              {s.nom && <>Souscripteur : <strong>{s.nom}</strong>{s.telephone ? ` · ${s.telephone}` : ''}</>}
              {s.nom && d.resume ? ' - ' : ''}
              {d.resume && <strong>{d.resume}</strong>}
            </div>
          )}
          <div className="qp-analyse-ligne">
            {d.lignes ? `${d.lignes} ligne(s) lue(s) dans le tableau` : `${d.reponses} réponse(s) lue(s)`}
            {route ? ' : elles seront proposées dans l\'écran de devis.' : ' : pas d\'écran de devis pour cette branche, la cotation se fait avec la compagnie.'}
          </div>
        </>
      ) : (
        <div className="qp-analyse-ligne">
          {d.message} Vous pourrez quand même déposer le fichier et établir le devis en reprenant les informations à la main.
        </div>
      )}
      {(d.avertissements || []).slice(0, 3).map((a) => <div key={a} className="qp-analyse-ligne">• {a}</div>)}
    </div>
  );
};

// Dépôt terminé : la suite, établir le devis maintenant ou plus tard
const SuiteDepot = ({ questionnaire: q, peutDevis, onClose, onEtablirDevis }) => (
  <div className="qp-termine">
    <span className="qp-termine-icone"><CheckCircle2 size={30} /></span>
    <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)' }}>« {q.titre} » est déposé pour {q.prospect_nom}</div>
    {q.route_devis ? (
      <p>
        Étape suivante : <strong>établir le devis</strong>. L'écran de devis s'ouvre avec les informations lues dans le
        fichier ; il reste à choisir ou créer le client, reprendre les données proposées, puis enregistrer le devis.
        Le questionnaire passera alors à « Devis établi ».
      </p>
    ) : (
      <p>Cette branche n'a pas d'écran de devis dans l'application : la cotation se fait avec la compagnie.</p>
    )}
    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '0.3rem' }}>
      <button type="button" className="btn btn-secondary" onClick={onClose}>{q.route_devis && peutDevis ? 'Plus tard' : 'Fermer'}</button>
      {q.route_devis && peutDevis && (
        <button type="button" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          onClick={() => { onClose(); onEtablirDevis(q); }}>
          Établir le devis maintenant <ArrowRight size={15} />
        </button>
      )}
    </div>
  </div>
);

/**
 * Dépôt d'un questionnaire rempli par le client (ou nouvelle version d'un questionnaire déjà déposé).
 * initial : { modele, leadId } à l'ouverture depuis une carte ou un prospect ; { version } pour une nouvelle version.
 * Le fichier choisi est lu aussitôt (rien n'est enregistré) : questionnaire reconnu d'après son contenu (le type est
 * corrigé s'il ne correspond pas), souscripteur repris pour un nouveau prospect, résumé de ce qui passera dans le devis.
 * Une fois déposé, la fenêtre propose d'établir le devis tout de suite (onEtablirDevis).
 */
export const DepotQuestionnaireModal = ({
  isOpen, onClose, modeles = [], prospects = [], extensions = [], tailleMax, initial, onDepose, onEtablirDevis, peutDevis = false,
}) => {
  const version = initial?.version || null;
  const champFichier = useRef(null);
  const dernierFichier = useRef(null);
  const courant = useRef({});
  const [fichier, setFichier] = useState(null);
  const [erreurFichier, setErreurFichier] = useState('');
  const [survol, setSurvol] = useState(false);
  const [modeleCode, setModeleCode] = useState('');
  const [reconnu, setReconnu] = useState(false);
  const [modeProspect, setModeProspect] = useState('existant');
  const [leadId, setLeadId] = useState('');
  const [rechercheProspect, setRechercheProspect] = useState('');
  const [nouveau, setNouveau] = useState({ nom: '', contact: '', telephone: '', email: '' });
  const [note, setNote] = useState('');
  const [qualifier, setQualifier] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [progression, setProgression] = useState(null);
  const [erreur, setErreur] = useState('');
  const [tentative, setTentative] = useState(false);
  // Lecture du fichier avant le dépôt : { etat: 'encours' | 'fait' | 'erreur', donnees, corrige, message }
  const [analyse, setAnalyse] = useState(null);
  // Dépôt terminé : { questionnaire } (la suite proposée : établir le devis)
  const [termine, setTermine] = useState(null);
  courant.current = { leadId, modeProspect, nouveau };

  // Remise à zéro à chaque ouverture
  useEffect(() => {
    if (!isOpen) return;
    dernierFichier.current = null;
    setAnalyse(null);
    setTermine(null);
    setFichier(null);
    setErreurFichier('');
    setSurvol(false);
    setModeleCode(initial?.modele || '');
    setReconnu(false);
    setLeadId(initial?.leadId ? String(initial.leadId) : '');
    setModeProspect(initial?.leadId || prospects.length ? 'existant' : 'nouveau');
    setRechercheProspect('');
    setNouveau({ nom: '', contact: '', telephone: '', email: '' });
    setNote('');
    setQualifier(true);
    setEnvoi(false);
    setProgression(null);
    setErreur('');
    setTentative(false);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const modele = modeles.find((m) => m.code === modeleCode) || null;
  const prospect = prospects.find((p) => String(p.id) === String(leadId)) || null;

  // Prospects proposés : affaires en cours d'abord, la branche du questionnaire en tête
  const prospectsProposes = useMemo(() => {
    const rang = (p) => (ETAPES_OUVERTES.includes(p.statut) ? 0 : 1) * 2 + (modele && p.branche === modele.branche ? 0 : 1);
    return prospects
      .filter((p) => correspondRecherche(rechercheProspect, [p.id_lead, p.nom_prospect, p.contact, p.telephone, p.email, p.branche]))
      .sort((a, b) => rang(a) - rang(b) || String(b.date_creation || '').localeCompare(String(a.date_creation || '')))
      .slice(0, 8);
  }, [prospects, rechercheProspect, modele]);

  const choisirFichier = (liste) => {
    const f = liste?.[0];
    if (!f) return;
    const ext = extensionDe(f.name);
    if (!extensions.includes(ext)) {
      setErreurFichier(`Format non accepté (.${ext || '?'}) : ${LIBELLES_EXTENSIONS}.`);
      return;
    }
    if (tailleMax && f.size > tailleMax) {
      setErreurFichier(`Fichier trop volumineux (${tailleLisible(f.size)}) : ${tailleLisible(tailleMax)} au plus.`);
      return;
    }
    if (!f.size) {
      setErreurFichier('Ce fichier est vide.');
      return;
    }
    setErreurFichier(liste.length > 1 ? `Un seul fichier à la fois : « ${f.name} » est retenu.` : '');
    setFichier(f);
    setErreur('');
    let codeDepart = version ? version.modele : modeleCode;
    if (!version && (!modeleCode || reconnu)) {
      const trouve = devinerModele(f.name, modeles);
      if (trouve) {
        setModeleCode(trouve.code);
        setReconnu('nom');
        codeDepart = trouve.code;
      }
    }
    lancerAnalyse(f, codeDepart);
  };

  // Lecture du fichier par le serveur (rien n'est enregistré) : le contenu fait foi pour le type de questionnaire,
  // et le souscripteur lu complète le prospect
  const lancerAnalyse = async (f, codeDepart) => {
    dernierFichier.current = f;
    setAnalyse({ etat: 'encours' });
    try {
      const donnees = await questionnaireApi.analyser(f, codeDepart);
      if (dernierFichier.current !== f) return;
      let corrige = null;
      if (!version && donnees.reconnu && donnees.reconnu.code !== codeDepart) {
        corrige = modeles.find((m) => m.code === codeDepart)?.titre || null;
        setModeleCode(donnees.reconnu.code);
        setReconnu('contenu');
      } else if (!version && donnees.reconnu) {
        setReconnu('contenu');
      }
      const s = donnees.souscripteur || {};
      const { leadId: choisi, modeProspect: mode, nouveau: saisi } = courant.current;
      if (!version && s.nom && !choisi) {
        const connus = prospects.filter((p) => correspondRecherche(s.nom, [p.nom_prospect]));
        if (connus.length) {
          // Prospect déjà suivi : proposé en tête de la liste
          setModeProspect('existant');
          setRechercheProspect(s.nom);
        } else if (mode === 'nouveau' || !saisi.nom.trim()) {
          setModeProspect('nouveau');
          setNouveau((n) => ({
            nom: n.nom.trim() ? n.nom : s.nom,
            contact: n.contact || s.contact || '',
            telephone: n.telephone || s.telephone || '',
            email: n.email || s.email || '',
          }));
        }
      }
      setAnalyse({ etat: 'fait', donnees, corrige });
    } catch (err) {
      if (dernierFichier.current === f) setAnalyse({ etat: 'erreur', message: messageErreur(err) });
    }
  };

  const glisser = (e, dedans) => {
    e.preventDefault();
    e.stopPropagation();
    if (dedans) setSurvol(true);
    else if (!e.currentTarget.contains(e.relatedTarget)) setSurvol(false);
  };

  const manques = [];
  if (!fichier) manques.push('le fichier rempli');
  if (!version) {
    if (!modele) manques.push('le questionnaire');
    if (modeProspect === 'existant' && !prospect) manques.push('le prospect');
    if (modeProspect === 'nouveau' && !nouveau.nom.trim()) manques.push('le nom du prospect');
  }

  const envoyer = async () => {
    setTentative(true);
    if (manques.length) {
      setErreur(`Il manque ${manques.join(', ')}.`);
      return;
    }
    setEnvoi(true);
    setProgression(0);
    setErreur('');
    try {
      const resultat = version
        ? await questionnaireApi.nouvelleVersion(version.id, fichier, setProgression)
        : await questionnaireApi.deposer({
          fichier,
          modele: modeleCode,
          note: note.trim(),
          qualifier: qualifier ? '1' : '0',
          ...(modeProspect === 'existant'
            ? { lead: prospect.id }
            : { prospect_nom: nouveau.nom.trim(), contact: nouveau.contact.trim(), telephone: nouveau.telephone.trim(), email: nouveau.email.trim() }),
        }, setProgression);
      onDepose(resultat, Boolean(version));
      // La fenêtre reste ouverte sur la suite : établir le devis maintenant ou plus tard
      setTermine({ questionnaire: version ? resultat : resultat.questionnaire });
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
      setProgression(null);
    }
  };

  const titre = version ? 'Nouvelle version du questionnaire' : 'Déposer un questionnaire rempli';
  const sousTitre = version
    ? `${version.titre} - ${version.prospect_nom} (version ${version.version} actuellement)`
    : 'Le fichier est lu dès qu\'il est choisi, puis rattaché au prospect ; le devis s\'établit ensuite à partir de ces informations.';

  return (
    <Modal isOpen={isOpen} onClose={envoi ? () => {} : onClose} title={termine ? 'Questionnaire déposé' : titre}
      subtitle={termine ? '' : sousTitre} maxWidth="760px">
      {termine ? (
        <SuiteDepot questionnaire={termine.questionnaire} peutDevis={peutDevis} onClose={onClose} onEtablirDevis={onEtablirDevis} />
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        {/* 1. Le fichier */}
        <section aria-labelledby="qp-depot-fichier">
          <h4 id="qp-depot-fichier" className="qp-section-titre"><span>1</span> Le questionnaire rempli</h4>
          <input
            ref={champFichier}
            type="file"
            hidden
            accept={extensions.map((e) => `.${e}`).join(',')}
            onChange={(e) => { choisirFichier(e.target.files); e.target.value = ''; }}
          />
          {fichier ? (
            <div className="qp-fichier" key={fichier.name + fichier.size}>
              <IconeFormat extension={extensionDe(fichier.name)} taille={40} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fichier.name}>
                  {fichier.name}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{tailleLisible(fichier.size)} · prêt à être déposé</div>
              </div>
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} disabled={envoi}
                onClick={() => champFichier.current?.click()}>
                <RefreshCw size={13} /> Changer
              </button>
              <button type="button" className="modal-close-btn" aria-label="Retirer le fichier" disabled={envoi}
                onClick={() => { setFichier(null); setErreurFichier(''); setAnalyse(null); dernierFichier.current = null; }}>
                <X size={15} />
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              className={`qp-depot${survol ? ' survol' : ''}${erreurFichier ? ' erreur' : ''}${tentative && !fichier ? ' erreur' : ''}`}
              onClick={() => champFichier.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); champFichier.current?.click(); } }}
              onDragEnter={(e) => glisser(e, true)}
              onDragOver={(e) => glisser(e, true)}
              onDragLeave={(e) => glisser(e, false)}
              onDrop={(e) => { glisser(e, false); setSurvol(false); choisirFichier(e.dataTransfer?.files); }}
              aria-describedby="qp-depot-aide"
            >
              <UploadCloud size={34} className="qp-depot-icone" />
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                {survol ? 'Déposez le fichier ici' : 'Glissez le questionnaire rempli ici'}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                ou <span style={{ color: 'var(--primary-500)', fontWeight: 600, textDecoration: 'underline' }}>parcourez vos fichiers</span>
              </div>
              <div id="qp-depot-aide" style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                {LIBELLES_EXTENSIONS} - {tailleLisible(tailleMax)} au plus
              </div>
            </div>
          )}
          {erreurFichier && <div className="champ-message erreur" role="alert">{erreurFichier}</div>}
          {fichier && (
            <PanneauAnalyse analyse={analyse} modele={modele} version={version}
              onUtiliser={(code) => { setModeleCode(code); setReconnu('contenu'); }} />
          )}
        </section>

        {!version && (
          <>
            {/* 2. Le questionnaire */}
            <section aria-labelledby="qp-depot-modele">
              <h4 id="qp-depot-modele" className="qp-section-titre"><span>2</span> Quel questionnaire ?</h4>
              <select
                className="form-control"
                value={modeleCode}
                aria-invalid={tentative && !modele}
                onChange={(e) => { setModeleCode(e.target.value); setReconnu(false); }}
              >
                <option value="">Choisir le questionnaire</option>
                {[...new Set(modeles.map((m) => m.branche))].map((b) => (
                  <optgroup key={b} label={b}>
                    {modeles.filter((m) => m.branche === b).map((m) => <option key={m.code} value={m.code}>{m.titre}</option>)}
                  </optgroup>
                ))}
              </select>
              {reconnu && modele && (
                <div className="qp-indice">
                  <Sparkles size={13} /> {reconnu === 'contenu' ? 'Reconnu d\'après le contenu du fichier' : 'Reconnu d\'après le nom du fichier'} - modifiable
                </div>
              )}
            </section>

            {/* 3. Le prospect */}
            <section aria-labelledby="qp-depot-prospect">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <h4 id="qp-depot-prospect" className="qp-section-titre" style={{ margin: 0 }}><span>3</span> Pour quel prospect ?</h4>
                <div className="qp-segments" role="group" aria-label="Prospect existant ou nouveau">
                  <button type="button" aria-pressed={modeProspect === 'existant'} onClick={() => setModeProspect('existant')} disabled={!prospects.length}>
                    <Users size={13} /> Prospect existant
                  </button>
                  <button type="button" aria-pressed={modeProspect === 'nouveau'} onClick={() => setModeProspect('nouveau')}>
                    <UserPlus size={13} /> Nouveau prospect
                  </button>
                </div>
              </div>

              {modeProspect === 'existant' ? (
                prospect ? (
                  <div className="qp-fichier" style={{ marginTop: '0.6rem' }}>
                    <CheckCircle2 size={20} color="var(--accent-emerald)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{prospect.nom_prospect}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {prospect.id_lead} · {prospect.branche}{prospect.contact ? ` · ${prospect.contact}` : ''}
                      </div>
                    </div>
                    <StatusBadge label={prospect.statut} color={etapeDe(prospect.statut).badge} />
                    <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} onClick={() => setLeadId('')} disabled={envoi}>
                      Changer
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ position: 'relative' }}>
                      <Search size={15} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input
                        type="text"
                        className="form-control"
                        style={{ paddingLeft: '2.3rem' }}
                        placeholder="Rechercher par nom, référence, contact, téléphone…"
                        aria-label="Rechercher un prospect"
                        value={rechercheProspect}
                        onChange={(e) => setRechercheProspect(e.target.value)}
                      />
                    </div>
                    <div className={`qp-liste-prospects${tentative && !prospect ? ' erreur' : ''}`} role="listbox" aria-label="Prospects">
                      {prospectsProposes.length === 0 && (
                        <div style={{ padding: '0.9rem', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          Aucun prospect ne correspond.{' '}
                          <button type="button" className="qp-lien" onClick={() => { setModeProspect('nouveau'); setNouveau((n) => ({ ...n, nom: rechercheProspect.trim() })); }}>
                            Créer « {rechercheProspect.trim() || 'un nouveau prospect'} »
                          </button>
                        </div>
                      )}
                      {prospectsProposes.map((p) => (
                        <button key={p.id} type="button" role="option" aria-selected={false} className="qp-prospect" onClick={() => setLeadId(String(p.id))}>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ fontWeight: 600, display: 'block' }}>{p.nom_prospect}</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {p.id_lead} · {p.branche}{p.contact ? ` · ${p.contact}` : ''}
                            </span>
                          </span>
                          <StatusBadge label={p.statut} color={etapeDe(p.statut).badge} />
                        </button>
                      ))}
                    </div>
                  </div>
                )
              ) : (
                <div className="qp-champs" style={{ marginTop: '0.6rem' }}>
                  <label className="form-group" style={{ gridColumn: '1 / -1', margin: 0 }}>
                    <span className="form-label">Nom ou raison sociale *</span>
                    <input className="form-control" value={nouveau.nom} aria-invalid={tentative && !nouveau.nom.trim()}
                      onChange={(e) => setNouveau({ ...nouveau, nom: e.target.value })} placeholder="Ex. : SOCIÉTÉ IVOIRIENNE DE NÉGOCE" />
                  </label>
                  <label className="form-group" style={{ margin: 0 }}>
                    <span className="form-label">Contact</span>
                    <input className="form-control" value={nouveau.contact} onChange={(e) => setNouveau({ ...nouveau, contact: e.target.value })} />
                  </label>
                  <label className="form-group" style={{ margin: 0 }}>
                    <span className="form-label">Téléphone</span>
                    <input className="form-control" value={nouveau.telephone} inputMode="tel" onChange={(e) => setNouveau({ ...nouveau, telephone: e.target.value })} />
                  </label>
                  <label className="form-group" style={{ gridColumn: '1 / -1', margin: 0 }}>
                    <span className="form-label">Courriel</span>
                    <input className="form-control" type="email" value={nouveau.email} onChange={(e) => setNouveau({ ...nouveau, email: e.target.value })} />
                  </label>
                  <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Le prospect sera créé dans le suivi commercial{modele ? `, branche ${modele.branche}` : ''}.
                  </div>
                </div>
              )}
            </section>

            {/* Note et suite */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <label className="form-group" style={{ margin: 0 }}>
                <span className="form-label">Note (facultatif)</span>
                <textarea className="form-control" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex. : reçu par courriel le 20/10, valeurs des véhicules à confirmer" />
              </label>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.84rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={qualifier} onChange={(e) => setQualifier(e.target.checked)} style={{ marginTop: '0.2rem' }} />
                <span>Faire passer le prospect à l'étape « Qualifié » s'il est encore « Nouveau »</span>
              </label>
            </section>
          </>
        )}

        {erreur && <div className="champ-message erreur" role="alert" style={{ fontSize: '0.84rem' }}>{erreur}</div>}

        {/* Envoi */}
        <div className="qp-actions">
          {progression !== null ? (
            <div style={{ flex: 1, minWidth: 0 }} aria-live="polite">
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                {progression >= 100 ? 'Enregistrement…' : `Envoi du fichier… ${progression ?? ''}${progression !== null ? ' %' : ''}`}
              </div>
              <div className={`qp-progression${progression >= 100 ? ' indetermine' : ''}`}>
                <span style={{ width: progression >= 100 ? undefined : `${Math.max(progression || 0, 4)}%` }} />
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {version ? "L'étape repasse à « Reçu » ; la version précédente reste dans l'historique." : 'Le fichier est conservé dans le dossier du prospect.'}
            </div>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={envoi}>Annuler</button>
          <button type="button" className="btn btn-primary" onClick={envoyer} aria-busy={envoi} disabled={envoi}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {!envoi && <UploadCloud size={15} />} {version ? 'Déposer la nouvelle version' : 'Déposer le questionnaire'}
          </button>
        </div>
      </div>
      )}
    </Modal>
  );
};

export default DepotQuestionnaireModal;
