import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, CheckCircle2, CopyX, History, Loader2, PencilLine, Printer, Search,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { cashApi, contractApi, settingsApi } from '../../api/endpoints';
import { useToast } from '../../context/ToastContext';
import { confirmer } from '../../utils/dialogue';
import { messageErreurApi } from '../../utils/financeUtils';
import { resteAEncaisser } from '../../utils/resteEncaissement';
import { printRecuEncaissement } from '../../utils/exportUtils';
import { ouvrirApercuImpression } from '../../utils/apercuImpression';
import { ChoixBanque } from './BanqueModal';
import { ChampsReglement, champsReglementApi, modesProposes } from './ChampsReglement';

/* =========================================================================
   CORRECTION D'UN ENCAISSEMENT SAISI PAR ERREUR (production/corrections_encaissement.py)
   Trois cas, choisis d'un clic, du plus léger au plus lourd :
   - une référence (n° de chèque, banque, émetteur, dates…) : corrigée sur place, montant et quittances inchangés ;
   - le client, la quittance, le montant ou le mode : la pièce est annulée et le bon encaissement enregistré en une fois
     (tout ou rien), sur le même chèque s'il y en a un ;
   - une saisie en double : la pièce est annulée, sa quittance redevient à encaisser, rien n'est à réencaisser.
   L'auteur corrige sa saisie le jour même ; ensuite, un responsable (droit « Annuler un encaissement »).
   ========================================================================= */

const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
// Libellés des références corrigées (récapitulatif avant l'enregistrement)
const LIBELLES = {
  id_banque: 'banque', numero: 'numéro', nom_emetteur: 'émetteur', montant_initial_cheque: 'montant initial du chèque',
  date_cheque: "date d'émission", date_reception_cheque: 'date de réception', numero_bordereau: 'n° de bordereau',
  numero_recu_operateur: "reçu de l'opérateur", reference_compensation: 'référence de la compensation',
  motif_compensation: 'motif de la compensation', ordre: "ordre du règlement",
};
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '-');
const MOTIF_MIN = 5;

const CAS = [
  { code: 'references', cle: 'References', icone: PencilLine, titre: 'Une référence est fausse',
    texte: 'N° du chèque ou du virement, banque, émetteur, dates, bordereau, reçu… Le montant et la quittance restent.' },
  { code: 'reaffectation', cle: 'Reaffectation', icone: ArrowLeftRight, titre: 'Mauvais client, quittance ou montant',
    texte: "La pièce est annulée et le bon encaissement enregistré en une seule fois, sur le même chèque s'il y en a un." },
  { code: 'annulation', cle: 'Annulation', icone: CopyX, titre: 'Saisie en double ou sans objet',
    texte: "La pièce est annulée et sa quittance redevient à encaisser. Rien n'est à rembourser au client." },
];

// Références de la pièce, dans le format du formulaire
const referencesInitiales = (f) => ({
  id_banque: String(f.References.IdBanque || 1), numero: f.References.Numero || '', nom_emetteur: f.References.NomEmetteur || '',
  montant_initial_cheque: f.Cheque ? String(Math.round(f.Cheque.MontantInitial)) : '', date_cheque: f.References.DateCheque || '',
  date_reception_cheque: f.References.DateReceptionCheque || '', numero_bordereau: f.References.NumeroBordereau || '',
  numero_recu_operateur: f.References.NumeroRecuOperateur || '', reference_compensation: f.References.ReferenceCompensation || '',
  motif_compensation: f.References.MotifCompensation || '', ordre: f.References.Ordre || 'CABINET',
});

// Moyen de paiement de la pièce, au format de ChampsReglement (réaffectation avec un autre moyen)
const reglementInitial = (f) => ({
  idMode: String(f.IdMode), idBanque: String(f.References.IdBanque || ''), numero: f.References.Numero || '',
  montantInitialCheque: f.Cheque ? String(Math.round(f.Cheque.MontantInitial)) : '', numeroBordereau: f.References.NumeroBordereau || '',
  numeroRecuOperateur: f.References.NumeroRecuOperateur || '', referenceCompensation: f.References.ReferenceCompensation || '',
  motifCompensation: f.References.MotifCompensation || '', ordre: f.References.Ordre || 'CABINET', dateCheque: f.References.DateCheque || '',
  dateReceptionCheque: f.References.DateReceptionCheque || '', nomEmetteur: f.References.NomEmetteur || '',
});

const Champ = ({ libelle, avant, modifie, children }) => (
  <div className="form-group" style={{ margin: 0 }}>
    <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
      <span>{libelle}</span>
      {modifie && <span style={{ color: 'var(--accent-amber)', fontWeight: 600, fontSize: '0.72rem' }}>avant : {avant || 'vide'}</span>}
    </label>
    {children}
  </div>
);

export const CorrectionEncaissement = ({ idEncaissement, onClose, onCorrige }) => {
  const { success, error: toastError } = useToast();
  const [fiche, setFiche] = useState(null);
  const [erreur, setErreur] = useState('');
  const [cas, setCas] = useState('');
  const [motif, setMotif] = useState('');
  const [refs, setRefs] = useState(null);
  const [banques, setBanques] = useState([]);
  const [modes, setModes] = useState([]);
  const [contrats, setContrats] = useState(null);
  const [recherche, setRecherche] = useState('');
  const [cible, setCible] = useState(null);
  const [montant, setMontant] = useState('');
  const [autreMoyen, setAutreMoyen] = useState(false);
  const [reglement, setReglement] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState(null);

  useEffect(() => {
    if (!idEncaissement) return undefined;
    let actif = true;
    setFiche(null); setErreur(''); setCas(''); setMotif(''); setResultat(null); setCible(null); setAutreMoyen(false);
    cashApi.ficheCorrection(idEncaissement)
      .then((f) => { if (!actif) return; setFiche(f); setRefs(referencesInitiales(f)); setReglement(reglementInitial(f)); setMontant(String(f.Montant)); })
      .catch((err) => { if (actif) setErreur(messageErreurApi(err)); });
    Promise.all([settingsApi.getBanques(), settingsApi.getModesEncaissement()])
      .then(([b, m]) => { if (actif) { setBanques(Array.isArray(b) ? b : []); setModes(modesProposes(m)); } })
      .catch(() => {});
    return () => { actif = false; };
  }, [idEncaissement]);

  // Quittances à encaisser, chargées au premier besoin (réaffectation) ; les quittances de la pièce d'abord (autre montant)
  useEffect(() => {
    if (cas !== 'reaffectation' || contrats) return;
    contractApi.getContracts({ a_encaisser: 1 })
      .then((liste) => setContrats(Array.isArray(liste) ? liste : []))
      .catch((err) => { setContrats([]); toastError(`Quittances à encaisser non chargées : ${messageErreurApi(err)}`); });
  }, [cas, contrats]); // eslint-disable-line react-hooks/exhaustive-deps

  const propositions = useMemo(() => {
    if (!fiche) return [];
    const propres = fiche.Quittances.map((qt) => ({ numero: qt.Numero, police: qt.Police, client: qt.Client, reste: qt.Montant, propre: true }));
    const vus = new Set(propres.map((p) => p.numero));
    const autres = (contrats || []).map((c) => {
      const numero = c.raw?.idquittance?.numeroquittance || '';
      const due = Number(c.raw?.idquittance?.primettc ?? c.prime_totale) || 0;
      return { numero, police: c.numeropolice, client: c.client_nom, reste: resteAEncaisser(due, c.montant_encaisse), propre: false };
    }).filter((p) => p.numero && p.reste > 0 && !vus.has(p.numero));
    const q = recherche.trim().toLowerCase();
    const trouve = (p) => !q || [p.numero, p.police, p.client].some((v) => String(v || '').toLowerCase().includes(q));
    return [...propres.filter(trouve), ...(q.length >= 2 ? autres.filter(trouve).slice(0, 8) : [])];
  }, [fiche, contrats, recherche]);

  const choisirCible = (p) => {
    setCible(p);
    setMontant(String(Math.min(Number(fiche.Montant), p.reste)));
  };

  if (!idEncaissement) return null;
  const refus = fiche?.Refus || {};
  const motifValide = motif.trim().length >= MOTIF_MIN;
  const bancaire = fiche?.Bancaire;
  const cheque = fiche?.CodeMode === 'CHQ';
  const initiales = fiche ? referencesInitiales(fiche) : {};
  const modifies = refs ? Object.keys(refs).filter((k) => String(refs[k] ?? '') !== String(initiales[k] ?? '')) : [];
  const changer = (cle) => (e) => setRefs((r) => ({ ...r, [cle]: e.target.value }));
  const champ = (cle) => ({ value: refs?.[cle] ?? '', onChange: changer(cle), className: 'form-control' });
  const libelleBanque = (id) => banques.find((b) => String(b.idbanque ?? b.IdBanque ?? b.id) === String(id))?.libelle || '';

  const terminer = (r, message) => {
    setResultat(r);
    success(message);
    onCorrige?.(r);
  };

  const corrigerReferences = async () => {
    setEnvoi(true);
    try {
      const donnees = { motif: motif.trim() };
      modifies.forEach((k) => { donnees[k] = refs[k]; });
      const r = await cashApi.corrigerReferences(fiche.IdEncaissement, donnees);
      terminer(r, r.Message);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  const annuler = async () => {
    const reaffecter = cas === 'reaffectation';
    const mode = modes.find((m) => String(m.idmodeencaissement) === String(reglement?.idMode));
    if (!(await confirmer({
      ton: reaffecter ? 'attention' : 'danger',
      titre: reaffecter ? `Annuler la pièce ${fiche.NumeroPiece} et la réaffecter ?` : `Annuler la pièce ${fiche.NumeroPiece} ?`,
      message: reaffecter
        ? `La pièce de ${fcfa(fiche.Montant)} F est contre-passée, puis ${fcfa(montant)} F sont encaissés sur la quittance ${cible.numero} (${cible.client || cible.police}). Si ce nouvel encaissement est refusé, rien n'est annulé.`
        : `La pièce de ${fcfa(fiche.Montant)} F est contre-passée et ${fiche.Quittances.length > 1 ? 'ses quittances redeviennent' : 'sa quittance redevient'} à encaisser${fiche.Cheque ? ' ; le chèque est libéré' : ''}.`,
      confirmer: reaffecter ? 'Annuler et réaffecter' : 'Annuler la pièce',
    }))) return;
    setEnvoi(true);
    try {
      const donnees = { motif: motif.trim() };
      if (reaffecter) {
        donnees.reaffectation = { liste_quittance: [{ numero_quittance: cible.numero, montant_encaissement: Number(montant) }] };
        if (autreMoyen && mode) donnees.reaffectation.instrument = champsReglementApi(reglement, mode);
      }
      const r = await cashApi.annulerEncaissement(fiche.IdEncaissement, donnees);
      terminer(r, r.Message);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  const imprimerNouveauRecu = async () => {
    const fenetre = ouvrirApercuImpression();
    await printRecuEncaissement(resultat.Nouveau.IdDetailEncaissement, fenetre);
  };

  const montantInvalide = cas === 'reaffectation' && cible && (!(Number(montant) > 0) || Number(montant) > cible.reste);
  // Même quittance, même montant, même moyen de paiement : la réaffectation ne changerait rien
  const sansEffet = cas === 'reaffectation' && cible?.propre && fiche?.Quittances.length === 1 && Number(montant) === Number(fiche.Montant) && !autreMoyen;
  const pret = motifValide && !envoi && (
    (cas === 'references' && modifies.length > 0)
    || (cas === 'reaffectation' && cible && !montantInvalide && !sansEffet)
    || cas === 'annulation');

  return (
    <Modal isOpen={Boolean(idEncaissement)} onClose={onClose} title={fiche ? `Corriger la pièce ${fiche.NumeroPiece}` : "Corriger l'encaissement"}
      subtitle="Choisissez ce qui est faux : la correction est gardée au journal, avec son motif" maxWidth="860px">
      {erreur && <div className="correction-alerte"><AlertTriangle size={16} /> {erreur}</div>}
      {!fiche && !erreur && <div style={{ color: 'var(--text-muted)', display: 'flex', gap: 8 }}><Loader2 size={16} className="spin" /> Lecture de la pièce…</div>}

      {fiche && resultat && (
        <div className="correction-resultat">
          <CheckCircle2 size={34} color="var(--accent-emerald)" />
          <div style={{ fontWeight: 800 }}>{resultat.Message}</div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            {resultat.Nouveau && (
              <button type="button" className="btn btn-primary" onClick={imprimerNouveauRecu}><Printer size={15} /> Imprimer le nouveau reçu</button>
            )}
            {cas === 'references' && fiche.Quittances[0] && (
              <button type="button" className="btn btn-secondary"
                onClick={() => printRecuEncaissement(fiche.Quittances[0].IdDetailEncaissement, ouvrirApercuImpression())}>
                <Printer size={15} /> Réimprimer le reçu corrigé
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>
          </div>
        </div>
      )}

      {fiche && !resultat && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* La pièce telle qu'enregistrée */}
          <div className="correction-piece">
            <div>
              <div className="correction-piece-montant">{fcfa(fiche.Montant)} F</div>
              <div>{fiche.Mode}{fiche.Reference ? ` - ${fiche.Reference}` : ''}{fiche.References.Banque && bancaire ? ` - ${fiche.References.Banque}` : ''}</div>
              <div className="correction-muet">
                Saisie le {dateFr(fiche.DateSaisie)}{fiche.Heure ? ` à ${fiche.Heure}` : ''}{fiche.Operateur ? ` par ${fiche.Operateur}` : ''}
              </div>
            </div>
            <div style={{ flex: '1 1 260px' }}>
              {fiche.Quittances.map((qt) => (
                <div key={qt.IdDetailEncaissement} className="correction-quittance">
                  <strong>{qt.Client || '-'}</strong>
                  <span className="correction-muet">Police {qt.Police} - quittance {qt.Numero}</span>
                  <span>{fcfa(qt.Montant)} F</span>
                </div>
              ))}
              {fiche.Cheque && (
                <div className="correction-muet" style={{ marginTop: 4 }}>
                  Chèque : montant initial {fcfa(fiche.Cheque.MontantInitial)} F, disponible {fcfa(fiche.Cheque.SoldeDisponible)} F
                  {fiche.Cheque.AutresPieces ? `, règle aussi ${fiche.Cheque.AutresPieces} autre(s) pièce(s)` : ''}
                </div>
              )}
            </div>
          </div>

          {/* Que faut-il corriger ? */}
          <div className="correction-cas" role="radiogroup" aria-label="Que faut-il corriger ?">
            {CAS.map((c) => {
              const raison = refus[c.cle];
              const Icone = c.icone;
              return (
                <button key={c.code} type="button" role="radio" aria-checked={cas === c.code} disabled={Boolean(raison)}
                  className={`correction-carte${cas === c.code ? ' choisie' : ''}${c.code === 'annulation' ? ' danger' : ''}`}
                  onClick={() => { setCas(c.code); setCible(null); setRecherche(''); }} title={raison || undefined}>
                  <Icone size={20} />
                  <span className="correction-carte-titre">{c.titre}</span>
                  <span className="correction-carte-texte">{raison || c.texte}</span>
                </button>
              );
            })}
          </div>

          {/* 1. Références */}
          {cas === 'references' && refs && (
            <div className="correction-volet">
              <div className="correction-grille">
                {bancaire && (
                  <Champ libelle="Banque" avant={fiche.References.Banque} modifie={modifies.includes('id_banque')}>
                    <ChoixBanque banques={banques} value={refs.id_banque} onChange={(v) => setRefs((r) => ({ ...r, id_banque: String(v?.target ? v.target.value : v) }))}
                      onBanqueCreee={(b) => setBanques((l) => [...l, b])} />
                  </Champ>
                )}
                {bancaire && (
                  <Champ libelle={cheque ? 'Numéro du chèque' : fiche.CodeMode === 'VIR' ? 'Numéro de virement' : 'Numéro de traite'}
                    avant={fiche.References.Numero} modifie={modifies.includes('numero')}>
                    <input {...champ('numero')} maxLength={50} />
                  </Champ>
                )}
                {cheque && fiche.Cheque && (
                  <Champ libelle="Montant initial du chèque" avant={fcfa(fiche.Cheque.MontantInitial)} modifie={modifies.includes('montant_initial_cheque')}>
                    <input {...champ('montant_initial_cheque')} type="number" min="1" step="any" />
                  </Champ>
                )}
                {cheque && (
                  <Champ libelle="Date d'émission du chèque" avant={dateFr(fiche.References.DateCheque)} modifie={modifies.includes('date_cheque')}>
                    <input {...champ('date_cheque')} type="date" />
                  </Champ>
                )}
                {cheque && (
                  <Champ libelle="Date de réception du chèque" avant={dateFr(fiche.References.DateReceptionCheque)} modifie={modifies.includes('date_reception_cheque')}>
                    <input {...champ('date_reception_cheque')} type="date" max={fiche.DateSaisie} />
                  </Champ>
                )}
                {fiche.CodeMode === 'ESP' && (
                  <Champ libelle="Numéro de bordereau" avant={fiche.References.NumeroBordereau} modifie={modifies.includes('numero_bordereau')}>
                    <input {...champ('numero_bordereau')} maxLength={50} />
                  </Champ>
                )}
                {fiche.CodeMode === 'PYM' && (
                  <Champ libelle="Reçu de l'opérateur" avant={fiche.References.NumeroRecuOperateur} modifie={modifies.includes('numero_recu_operateur')}>
                    <input {...champ('numero_recu_operateur')} maxLength={50} />
                  </Champ>
                )}
                {fiche.Compensation && (
                  <>
                    <Champ libelle="Référence de la compensation" avant={fiche.References.ReferenceCompensation} modifie={modifies.includes('reference_compensation')}>
                      <input {...champ('reference_compensation')} maxLength={50} />
                    </Champ>
                    <Champ libelle="Motif de la compensation" avant={fiche.References.MotifCompensation} modifie={modifies.includes('motif_compensation')}>
                      <input {...champ('motif_compensation')} maxLength={255} />
                    </Champ>
                  </>
                )}
                {bancaire && !/^a la compagnie$/i.test(fiche.Mode.trim()) && (
                  <Champ libelle="À l'ordre de" avant={fiche.References.Ordre === 'COMPAGNIE' ? 'la compagnie' : 'du cabinet'} modifie={modifies.includes('ordre')}>
                    <select {...champ('ordre')}>
                      <option value="CABINET">Du cabinet</option>
                      <option value="COMPAGNIE">De la compagnie</option>
                    </select>
                  </Champ>
                )}
                <Champ libelle="Nom de l'émetteur" avant={fiche.References.NomEmetteur} modifie={modifies.includes('nom_emetteur')}>
                  <input {...champ('nom_emetteur')} maxLength={50} />
                </Champ>
              </div>
              {fiche.Cheque?.AutresPieces > 0 && (modifies.includes('numero') || modifies.includes('id_banque')) && (
                <p className="correction-note">Le n° et la banque sont portés par le chèque : ils seront corrigés aussi sur les {fiche.Cheque.AutresPieces} autre(s) pièce(s) qu'il règle.</p>
              )}
              {modifies.length > 0 && (
                <p className="correction-note">
                  {modifies.length} correction{modifies.length > 1 ? 's' : ''} : {modifies.map((k) => (k === 'id_banque' ? `banque ${libelleBanque(refs.id_banque)}` : LIBELLES[k] || k)).join(', ')}.
                </p>
              )}
            </div>
          )}

          {/* 2. Annuler et réaffecter */}
          {cas === 'reaffectation' && (
            <div className="correction-volet">
              <label className="form-label" htmlFor="correction-recherche">Bonne quittance</label>
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input id="correction-recherche" className="form-control" style={{ paddingLeft: '2rem' }} value={recherche} autoFocus
                  onChange={(e) => setRecherche(e.target.value)} placeholder="Client, police ou n° de quittance à encaisser" />
              </div>
              {contrats === null && <div className="correction-muet"><Loader2 size={13} className="spin" /> Chargement des quittances à encaisser…</div>}
              <div className="correction-propositions">
                {propositions.map((p) => (
                  <button key={p.numero} type="button" className={`correction-proposition${cible?.numero === p.numero ? ' choisie' : ''}`} onClick={() => choisirCible(p)}>
                    <strong>{p.client || '-'}</strong>
                    <span className="correction-muet">Police {p.police} - quittance {p.numero}{p.propre ? ' - même quittance, autre montant' : ''}</span>
                    <span>{p.propre ? `jusqu'à ${fcfa(p.reste)} F` : `reste ${fcfa(p.reste)} F`}</span>
                  </button>
                ))}
                {recherche.trim().length >= 2 && contrats && !propositions.some((p) => !p.propre) && (
                  <div className="correction-muet">Aucune quittance à encaisser ne correspond.</div>
                )}
              </div>
              {cible && (
                <>
                  <div className="correction-grille">
                    <Champ libelle="Montant à encaisser (FCFA)">
                      <input className="form-control" type="number" min="1" step="any" max={cible.reste} value={montant}
                        aria-invalid={montantInvalide} onChange={(e) => setMontant(e.target.value)} />
                    </Champ>
                  </div>
                  {montantInvalide && <p className="correction-alerte" style={{ margin: 0 }}>Le montant doit être positif et ne pas dépasser {fcfa(cible.reste)} F.</p>}
                  {sansEffet && (
                    <p className="correction-note">Même quittance, même montant : choisissez une autre quittance, changez le montant ou corrigez le moyen de paiement.</p>
                  )}
                  <div className="correction-avant-apres">
                    <div><span className="correction-muet">Avant</span><strong>{fiche.Quittances.map((qt) => qt.Client || qt.Numero).join(', ')}</strong><span>{fcfa(fiche.Montant)} F</span></div>
                    <ArrowRight size={18} />
                    <div><span className="correction-muet">Après</span><strong>{cible.client || cible.numero}</strong><span>{fcfa(montant)} F</span></div>
                  </div>
                  <label className="correction-case">
                    <input type="checkbox" checked={autreMoyen} onChange={(e) => setAutreMoyen(e.target.checked)} />
                    Le moyen de paiement était aussi erroné (mode, chèque, banque…)
                  </label>
                  {autreMoyen && reglement && (
                    <ChampsReglement modes={modes} banques={banques} valeurs={reglement} montantAEncaisser={montant}
                      onChange={(c, v) => setReglement((r) => ({ ...r, [c]: v }))} onBanqueCreee={(b) => setBanques((l) => [...l, b])} />
                  )}
                  {fiche.Cheque && !autreMoyen && (
                    <p className="correction-note">Même chèque : il est d'abord libéré de {fcfa(fiche.Montant)} F, puis règle la bonne quittance.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* 3. Annuler */}
          {cas === 'annulation' && (
            <div className="correction-volet">
              <ul className="correction-liste">
                <li>La pièce {fiche.NumeroPiece} est contre-passée (ligne négative) et reste visible, barrée, dans l'état des encaissements.</li>
                <li>{fiche.Quittances.length > 1 ? 'Ses quittances redeviennent' : 'Sa quittance redevient'} à encaisser.</li>
                {fiche.Cheque && <li>Le chèque est libéré de {fcfa(fiche.Montant)} F.</li>}
                <li>Si l'argent a réellement été rendu au client, passez plutôt par le Portefeuille des règlements.</li>
              </ul>
            </div>
          )}

          {cas && (
            <div className="correction-volet" style={{ animationDelay: '60ms' }}>
              <label className="form-label" htmlFor="correction-motif">Motif de la correction (obligatoire)</label>
              <textarea id="correction-motif" className="form-control" rows={2} value={motif} maxLength={200}
                onChange={(e) => setMotif(e.target.value)} placeholder="Ex. : chèque saisi sur le mauvais client" />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.8rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>
                <button type="button" className={`btn ${cas === 'annulation' ? 'btn-danger' : 'btn-primary'}`} disabled={!pret}
                  onClick={cas === 'references' ? corrigerReferences : annuler} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {envoi && <Loader2 size={15} className="spin" />}
                  {cas === 'references' ? 'Enregistrer la correction' : cas === 'reaffectation' ? 'Annuler et réaffecter' : 'Annuler la pièce'}
                </button>
              </div>
            </div>
          )}

          {fiche.Historique?.length > 0 && (
            <details className="correction-historique">
              <summary><History size={14} /> Corrections déjà faites ({fiche.Historique.length})</summary>
              <ul>
                {fiche.Historique.map((h) => (
                  <li key={`${h.Date}-${h.Description}`}>
                    <span className="correction-muet">{dateFr(h.Date)} {String(h.Date).slice(11, 16)} - {h.Auteur}</span> {h.Description}
                    {h.Motif ? <em> ({h.Motif})</em> : null}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
};

export default CorrectionEncaissement;
