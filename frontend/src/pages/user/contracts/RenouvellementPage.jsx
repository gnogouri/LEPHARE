import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Loader2, CalendarRange, ListChecks, AlertTriangle, ExternalLink, Info, FileSpreadsheet } from 'lucide-react';
import { contractApi } from '../../../api/endpoints';
import { AmountInput } from '../../../components/common/AmountInput';
import { messageErreurApi } from '../../../utils/financeUtils';
import { useToast } from '../../../context/ToastContext';

// Renouvellement d'un contrat (compte rendu de la séance du 12-10-2026) : préparation de la nouvelle période
// puis devis de renouvellement sous la même police, ouvert ensuite dans son écran de saisie pour les ajouts,
// les garanties et la tarification. production/renouvellement.py

const montant = (v) => (v === null || v === undefined ? '-' : `${Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`);
const dateFr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const ageTexte = (mois) => (mois === null || mois === undefined ? '' : `${Math.floor(mois / 12)} an${Math.floor(mois / 12) > 1 ? 's' : ''}${mois % 12 ? ` ${mois % 12} mois` : ''}`);
const LIBELLE_AVENANT = { AFN: 'Affaire nouvelle', REN: 'Renouvellement', INC: 'Incorporation', MOD: 'Modification', RET: 'Retrait', ANL: 'Annulation', ANP: 'Annulation' };
const cellule = { padding: '0.55rem 0.6rem', borderTop: '1px solid var(--border-subtle)', verticalAlign: 'top', fontSize: '0.84rem' };
const entete = { padding: '0.55rem 0.6rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', textAlign: 'left', whiteSpace: 'nowrap' };

export const RenouvellementPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  // Ouvert depuis les Affaires antérieures : Retour ramène à cette liste
  const retour = useLocation().state?.retour;
  const { success, error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');
  const [periode, setPeriode] = useState({ DateEffet: '', DateExpiration: '' });
  const [exclus, setExclus] = useState(new Set());
  const [valeurs, setValeurs] = useState({});
  const [chargement, setChargement] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  const charger = async (dates = {}) => {
    setChargement(true);
    setErreur('');
    try {
      const d = await contractApi.preparerRenouvellement(id, dates);
      setDonnees(d);
      setPeriode(d.Periode);
      // Valeur vénale proposée : celle du tableau de dépréciation à la nouvelle date d'effet, sinon celle du contrat
      setValeurs(Object.fromEntries((d.Objets || []).filter((o) => o.ValeurVenaleContrat !== undefined)
        .map((o) => [o.Matricule, o.ValeurVenaleTableau ?? o.ValeurVenaleContrat ?? 0])));
    } catch (err) {
      setErreur(messageErreurApi(err));
    } finally {
      setChargement(false);
    }
  };

  useEffect(() => { charger(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const contrat = donnees?.Contrat;
  // Retraite complémentaire (Vie) : chaque mois se renouvelle avec l'état des cotisations du souscripteur, importé dans l'écran Vie
  const etatMensuel = donnees?.EtatMensuel || null;
  const auto = contrat?.IdProduit === 1;
  const objets = donnees?.Objets || [];
  // Santé : une ligne par famille (adhérent et ayants droit), reconduite avec sa couverture
  const familles = objets.some((o) => o.Famille);
  const libelleObjets = auto ? 'véhicule' : (familles ? 'famille' : 'assuré');
  const retenus = objets.filter((o) => !exclus.has(o.Matricule));
  const basculer = (m) => setExclus((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n; });

  const modifiees = useMemo(() => objets.filter((o) => auto && !exclus.has(o.Matricule)
    && Number(valeurs[o.Matricule]) !== Number(o.ValeurVenaleContrat)).length, [objets, valeurs, exclus, auto]);

  const creer = async () => {
    if (!retenus.length) { toastError('Gardez au moins un objet assuré.'); return; }
    setEnvoi(true);
    try {
      const r = await contractApi.creerRenouvellement(id, {
        DateEffet: periode.DateEffet,
        DateExpiration: periode.DateExpiration,
        Exclure: [...exclus],
        ValeursVenales: auto ? Object.fromEntries(retenus.map((o) => [o.Matricule, Number(valeurs[o.Matricule]) || 0])) : {},
      });
      success(`Devis de renouvellement ${r.NumeroDevis} créé (police ${contrat.NumeroPolice}) : vérifiez-le, enregistrez-le pour le tarifer, puis confirmez-le en contrat.`);
      if (r.Module) navigate(`/user/quotes/${r.Module}?edit=${r.IdDevis}&renouvellement=1`);
      else navigate('/user/quotes');
    } catch (err) {
      toastError(`Renouvellement refusé : ${messageErreurApi(err)}`);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
      <button type="button" className="btn btn-secondary" onClick={() => navigate(retour || `/user/contracts/${id}`)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '1rem' }}>
        <ArrowLeft size={15} /> {retour ? 'Retour aux affaires antérieures' : 'Retour au contrat'}
      </button>
      <h1 style={{ fontSize: '1.35rem', fontWeight: 800, margin: '0 0 0.3rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <RefreshCw size={20} /> Renouvellement {contrat ? `de la police ${contrat.NumeroPolice}` : ''}
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', margin: '0 0 1.25rem', maxWidth: 900 }}>
        {etatMensuel
          ? "La police garde son numéro et se renouvelle chaque mois avec l'état des cotisations envoyé par le souscripteur : importez le fichier du mois, vérifiez-le, puis confirmez-le en contrat."
          : `La police garde son numéro. Préparez la nouvelle période et la liste des ${auto ? 'véhicules' : 'assurés'} (incorporations et retraits de l'année déjà pris en compte),
        puis créez le devis de renouvellement : il s'ouvre dans l'écran de saisie pour les ajouts, les garanties et la tarification, avant sa confirmation en contrat.`}
      </p>

      {erreur && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: '#f87171', marginBottom: '1rem' }}>
          <AlertTriangle size={18} /> {erreur}
        </div>
      )}
      {!donnees && !erreur && <div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Préparation…</div>}

      {donnees && (
        <>
          <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem 1.5rem', fontSize: '0.86rem' }}>
            <div><span style={{ color: 'var(--text-muted)' }}>Client</span><div style={{ fontWeight: 700 }}>{contrat.Client}</div></div>
            <div><span style={{ color: 'var(--text-muted)' }}>Produit</span><div style={{ fontWeight: 700 }}>{contrat.Produit}{contrat.Flotte ? ' (flotte / groupe)' : ''}</div></div>
            <div><span style={{ color: 'var(--text-muted)' }}>Compagnie</span><div style={{ fontWeight: 700 }}>{contrat.Compagnie}</div></div>
            <div><span style={{ color: 'var(--text-muted)' }}>Période qui s'achève</span><div style={{ fontWeight: 700 }}>{dateFr(contrat.DateEffet)} – {dateFr(contrat.DateExpiration)}</div></div>
            <div><span style={{ color: 'var(--text-muted)' }}>Prime TTC de la période</span><div style={{ fontWeight: 700 }}>{montant(contrat.PrimeTtc)}</div></div>
          </div>

          {(donnees.DevisEnCours || []).length > 0 && (
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.7rem 1rem', marginBottom: '1rem', borderRadius: 8, border: '1px solid rgba(245, 158, 11, 0.45)', background: 'rgba(245, 158, 11, 0.08)', fontSize: '0.86rem' }}>
              <AlertTriangle size={16} color="#f59e0b" />
              <span>Un devis de renouvellement est déjà ouvert pour cette police :</span>
              {donnees.DevisEnCours.map((d) => (
                <Link key={d.IdDevis} to={`/user/quotes/${contrat.Module}?edit=${d.IdDevis}&renouvellement=1`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
                  n° {d.NumeroDevis} (effet {dateFr(d.DateEffet)}) <ExternalLink size={13} />
                </Link>
              ))}
              <span style={{ color: 'var(--text-muted)' }}>
                {etatMensuel
                  ? "- ouvrez-le pour y importer ou vérifier l'état du mois, puis confirmez-le : chaque mois renouvelle la police."
                  : "- reprenez-le plutôt que d'en créer un autre."}
              </span>
            </div>
          )}

          {etatMensuel && (
            <div className="glass-panel" style={{ padding: '1.1rem 1.25rem', marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center',
              flexWrap: 'wrap', borderLeft: '4px solid #7c3aed', animation: 'mouvement-apparait 0.35s ease-out both' }}>
              <FileSpreadsheet size={28} color="#7c3aed" style={{ flexShrink: 0 }} />
              <div style={{ flex: '1 1 420px' }}>
                <div style={{ fontWeight: 800, marginBottom: '0.25rem' }}>
                  {etatMensuel.Offre} : état des cotisations de {etatMensuel.LibelleMoisSuivant}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  Dernier mois enregistré : {etatMensuel.LibelleDernierMois}. Le mois suivant se crée avec le fichier des cotisations mensuelles des salariés,
                  jamais en recopiant le mois précédent. Un salarié qui ne cotise pas ce mois peut être absent du fichier ou y figurer à 0 F : il reste suivi
                  par son matricule et reprend ses cotisations à son retour.
                </div>
              </div>
              <button type="button" className="btn btn-primary" disabled={(donnees.DevisEnCours || []).length > 0}
                onClick={() => navigate(`/user/quotes/afa?renouveler=${etatMensuel.IdContrat}`)}
                title={(donnees.DevisEnCours || []).length ? "Confirmez d'abord le mois en cours" : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, padding: '0.6rem 1.2rem', background: '#7c3aed', borderColor: '#7c3aed' }}>
                <FileSpreadsheet size={16} /> Importer l'état de {etatMensuel.LibelleMoisSuivant}
              </button>
            </div>
          )}

          {!etatMensuel && (<>
          <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.75rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}><CalendarRange size={17} /> Nouvelle période</h2>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Date d'effet</label>
                <input type="date" className="form-control" value={periode.DateEffet || ''} onChange={(e) => setPeriode((p) => ({ ...p, DateEffet: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Date d'expiration</label>
                <input type="date" className="form-control" value={periode.DateExpiration || ''} onChange={(e) => setPeriode((p) => ({ ...p, DateExpiration: e.target.value }))} />
              </div>
              {auto && (
                <button type="button" className="btn btn-secondary" disabled={chargement} onClick={() => charger({ dateEffet: periode.DateEffet, dateExpiration: periode.DateExpiration })}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  {chargement ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Recalculer les valeurs vénales à cette date
                </button>
              )}
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Proposée : le lendemain de l'échéance, sur la même durée que la période qui s'achève.
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <ListChecks size={17} /> {auto ? 'Véhicules' : (familles ? 'Familles' : 'Assurés')} à renouveler ({retenus.length} / {objets.length})
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
              Liste de la police à ce jour : {auto ? 'véhicules' : (familles ? 'familles (adhérent et ayants droit, avec leur couverture)' : 'assurés')} de l'affaire nouvelle ou du dernier renouvellement, incorporations et modifications de l'année comprises, retraits écartés.
              Décochez ceux qui ne sont pas reconduits ; les nouveaux s'ajoutent ensuite dans le devis.
              {auto && ' Valeur vénale : tableau de dépréciation à la nouvelle date d\'effet, modifiable.'}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: auto ? 1100 : 700 }}>
                <thead>
                  <tr>
                    <th style={entete}>Renouveler</th>
                    <th style={entete}>{auto ? 'Immatriculation' : (familles ? 'N° adhérent' : 'Matricule')}</th>
                    {familles && (
                      <><th style={entete}>Adhérent</th><th style={entete}>Couverture</th><th style={entete}>Personnes</th><th style={entete}>Date de naissance</th></>
                    )}
                    {familles ? null : auto ? (
                      <>
                        <th style={entete}>Véhicule</th><th style={entete}>Catégorie / offre</th><th style={entete}>1re MEC (âge)</th>
                        <th style={entete}>Valeur neuve</th><th style={entete}>Valeur vénale du contrat</th><th style={entete}>Valeur vénale renouvelée</th>
                      </>
                    ) : (
                      <><th style={entete}>Assuré</th><th style={entete}>Date de naissance</th></>
                    )}
                    <th style={entete}>Depuis</th>
                  </tr>
                </thead>
                <tbody>
                  {objets.map((o) => {
                    const retenu = !exclus.has(o.Matricule);
                    return (
                      <tr key={o.Matricule} style={{ opacity: retenu ? 1 : 0.5 }}>
                        <td style={cellule}><input type="checkbox" checked={retenu} onChange={() => basculer(o.Matricule)} aria-label={`Renouveler ${o.Matricule}`} /></td>
                        <td style={{ ...cellule, fontWeight: 700 }}>{familles ? (o.NumeroAdherent || '-') : o.Matricule}</td>
                        {familles && (
                          <>
                            <td style={cellule}>{o.Assure}</td>
                            <td style={cellule}>{o.Categorie || '-'}</td>
                            <td style={cellule}>{o.Personnes}</td>
                            <td style={cellule}>{dateFr(o.DateNaissance)}</td>
                          </>
                        )}
                        {familles ? null : auto ? (
                          <>
                            <td style={cellule}>{[o.Marque, o.Modele].filter(Boolean).join(' ')}<div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{o.Genre || 'genre non renseigné'} · {o.Places} pl.</div></td>
                            <td style={cellule}>{o.Categorie}<div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{o.Offre}</div></td>
                            <td style={cellule}>{dateFr(o.DateMec)}<div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{ageTexte(o.AgeMois)}</div></td>
                            <td style={{ ...cellule, whiteSpace: 'nowrap' }}>{montant(o.ValeurNeuve)}</td>
                            <td style={{ ...cellule, whiteSpace: 'nowrap' }}>{montant(o.ValeurVenaleContrat)}</td>
                            <td style={{ ...cellule, minWidth: 230 }}>
                              <AmountInput value={valeurs[o.Matricule] ?? 0} onChange={(v) => setValeurs((x) => ({ ...x, [o.Matricule]: v }))} suffix="FCFA" disabled={!retenu} />
                              <div style={{ fontSize: '0.72rem', color: o.ValeurVenaleTableau === null ? '#f59e0b' : 'var(--text-muted)', marginTop: 3 }}>
                                {o.ValeurVenaleTableau === null ? `${o.Explication} : valeur du contrat reprise.` : `Tableau : ${montant(o.ValeurVenaleTableau)} (${o.Explication}).`}
                              </div>
                            </td>
                          </>
                        ) : (
                          <><td style={cellule}>{o.Assure}</td><td style={cellule}>{dateFr(o.DateNaissance)}</td></>
                        )}
                        <td style={cellule}>{LIBELLE_AVENANT[o.Avenant] || o.Avenant}<div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{dateFr(o.Depuis)}</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(donnees.Retraits || []).length > 0 && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.65rem' }}>
                Retirés en cours de période (non reconduits) : {donnees.Retraits.map((r) => `${r.Matricule} (${LIBELLE_AVENANT[r.Avenant] || r.Avenant} du ${dateFr(r.Date)})`).join(', ')}.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Info size={14} /> {retenus.length} {libelleObjets}{retenus.length > 1 ? 's' : ''} reconduit{familles ? 'e' : ''}{retenus.length > 1 ? 's' : ''}{exclus.size ? `, ${exclus.size} retiré${familles ? 'e' : ''}${exclus.size > 1 ? 's' : ''}` : ''}{modifiees ? `, ${modifiees} valeur${modifiees > 1 ? 's' : ''} vénale${modifiees > 1 ? 's' : ''} mise${modifiees > 1 ? 's' : ''} à jour` : ''}.
            </span>
            <button type="button" className="btn btn-primary" onClick={creer} disabled={envoi || !retenus.length}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, padding: '0.6rem 1.2rem' }}>
              {envoi ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Créer le devis de renouvellement
            </button>
          </div>
          </>)}
        </>
      )}
    </div>
  );
};

export default RenouvellementPage;
