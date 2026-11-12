import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Edit2, Handshake, Loader2, Plus, Save, UserMinus, X } from 'lucide-react';
import { apporteurApi } from '../../api/endpoints';
import { StatusBadge } from '../common/StatusBadge';
import { useToast } from '../../context/ToastContext';
import { saisirTexte } from '../../utils/dialogue';
import { aLeDroit } from '../../utils/droits';
import { dateFr, fcfa, messageErreurApi } from '../../utils/financeUtils';

/* =========================================================================
   Apporteurs d'une affaire, sur la fiche devis, la fiche contrat et le module Apporteurs : qui, à quel taux, quelle commission générée
   et où en est son règlement. Le taux saisi ici appartient à l'affaire : changer le taux général de l'apporteur ne le modifie pas.
   ========================================================================= */
export const COULEURS_ETAT = { A_PAYER: 'amber', PARTIELLE: 'amber', PAYEE: 'emerald', ANNULEE: 'rose', EN_ATTENTE: 'blue', AUCUNE: 'blue' };
export const COULEURS_STATUT = { A_PAYER: 'amber', PAYEE: 'emerald', ANNULEE: 'rose' };
// Un taux ou un montant par assuré, jamais les deux : le mode choisi décide du seul champ affiché
export const OPTIONS_ASSIETTE = [['COMMISSION', 'Taux de la commission du cabinet'], ['PRIME_NETTE', 'Taux de la prime nette'], ['PAR_ASSURE', 'Montant par assuré']];
export const conventionAffichee = (a) => {
  if (a.Assiette === 'PAR_ASSURE') return `${fcfa(a.MontantUnitaire ?? a.MontantForfait)} F par assuré`;
  if (a.Assiette === 'FORFAIT') return `${fcfa(a.MontantForfait)} F`;
  return `${Number(a.Taux || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
};
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
// Corps envoyé au serveur : seul le champ du mode choisi
const corpsConvention = (s) => (s.Assiette === 'PAR_ASSURE' ? { Assiette: 'PAR_ASSURE', MontantParAssure: s.MontantParAssure } : { Assiette: s.Assiette, Taux: s.Taux });
const DROITE = { textAlign: 'right' };
const pourcent = (v) => `${Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const nomApporteur = (a) => `${a.Nom || ''} ${a.Prenoms || ''}`.trim();

// Base d'une ligne : nombre d'assurés pour un montant par assuré, montant sinon
export const baseAffichee = (c) => (c.Assiette === 'PAR_ASSURE' ? pluriel(c.Assures ?? 0, 'assuré') : `${fcfa(c.AssietteMontant)} F`);
export const tarifAffiche = (c) => {
  if (c.Assiette === 'PAR_ASSURE') return `${fcfa(c.MontantUnitaire)} F par assuré`;
  return c.Assiette === 'FORFAIT' ? '-' : pourcent(c.Taux);
};

const NombreAssures = ({ ligne, peutCorriger, onCorriger }) => {
  const [saisie, setSaisie] = useState(null);
  if (saisie !== null) {
    return (
      <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
        <input type="number" min="0" step="1" className="form-control" aria-label="Nombre d'assurés" style={{ width: 76, padding: '0.15rem 0.3rem' }} value={saisie} onChange={(e) => setSaisie(e.target.value)} />
        <button type="button" className="btn btn-primary" style={{ padding: '0.15rem 0.35rem' }} aria-label="Enregistrer le nombre d'assurés" onClick={async () => { if (await onCorriger(ligne, saisie)) setSaisie(null); }}><Save size={13} /></button>
        <button type="button" className="btn btn-secondary" style={{ padding: '0.15rem 0.35rem' }} aria-label="Annuler" onClick={() => setSaisie(null)}><X size={13} /></button>
      </span>
    );
  }
  return (
    <span>
      {baseAffichee(ligne)}{ligne.AssuresCorriges && <span title="Nombre corrigé à la main"> (corrigé)</span>}
      {peutCorriger && ligne.Statut === 'A_PAYER' && (
        <button type="button" className="btn btn-secondary" style={{ padding: '0.1rem 0.3rem', marginLeft: '0.3rem' }} title="Corriger le nombre d'assurés" aria-label={`Corriger le nombre d'assurés de la quittance ${ligne.NumeroQuittance}`} onClick={() => setSaisie(String(ligne.Assures ?? 0))}><Edit2 size={12} /></button>
      )}
    </span>
  );
};

const LignesQuittances = ({ lignes, peutCorriger, onCorriger }) => (
  <table className="data-table" style={{ fontSize: '0.78rem' }}>
    <thead>
      <tr><th>Quittance</th><th>Mouvement</th><th>Émission</th><th>Assiette</th><th style={DROITE}>Base</th><th style={DROITE}>Taux ou montant</th><th style={DROITE}>Commission</th><th>Prime du client</th><th>État</th></tr>
    </thead>
    <tbody>
      {lignes.map((c) => (
        <tr key={c.IdCommission}>
          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.NumeroQuittance}</td>
          <td>{c.Mouvement}</td>
          <td>{dateFr(c.DateEmission)}</td>
          <td>{c.LibelleAssiette}</td>
          <td style={DROITE}>{c.Assiette === 'PAR_ASSURE' ? <NombreAssures ligne={c} peutCorriger={peutCorriger} onCorriger={onCorriger} /> : baseAffichee(c)}</td>
          <td style={DROITE}>{tarifAffiche(c)}</td>
          <td style={{ ...DROITE, fontWeight: 700 }}>{fcfa(c.Montant)} F</td>
          <td style={{ color: c.PrimeSoldee ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>{c.PrimeSoldee ? 'Soldée' : `Reste ${fcfa(c.Reste)} F`}</td>
          <td>
            <StatusBadge label={c.LibelleStatut} color={COULEURS_STATUT[c.Statut]} />
            {c.NumeroReglement && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{c.NumeroReglement} du {dateFr(c.DateReglement)}</div>}
            {c.MotifAnnulation && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{c.MotifAnnulation}</div>}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

export default function BlocApporteursAffaire({ idDevis = 0, idContrat = 0, sansCadre = false, onChange }) {
  const { success, error: toastError } = useToast();
  const [affaire, setAffaire] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [indisponible, setIndisponible] = useState('');
  const [catalogue, setCatalogue] = useState([]);
  const [ajout, setAjout] = useState(null);
  const [edition, setEdition] = useState(null);
  const [ouvert, setOuvert] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const peutLire = aLeDroit('apporteurs.view');
  const peutRattacher = aLeDroit('apporteurs.rattacher');

  const charger = useCallback(async () => {
    if (!idDevis && !idContrat) return;
    try {
      setAffaire(await apporteurApi.affaire({ devis: idDevis || undefined, contrat: idContrat || undefined }));
      setIndisponible('');
    } catch (err) {
      setIndisponible(messageErreurApi(err));
    } finally {
      setChargement(false);
    }
  }, [idDevis, idContrat]);

  useEffect(() => { if (peutLire) charger(); }, [peutLire, charger]);

  const choisis = useMemo(() => new Set((affaire?.Apporteurs || []).filter((a) => a.Actif).map((a) => a.IdApporteur)), [affaire]);
  const proposes = useMemo(() => catalogue.filter((a) => a.Actif !== false && !choisis.has(a.IdApporteur)), [catalogue, choisis]);

  if (!peutLire || (!idDevis && !idContrat)) return null;

  const ouvrirAjout = async () => {
    setAjout({ IdApporteur: '', Taux: '', MontantParAssure: '', Assiette: 'COMMISSION' });
    if (catalogue.length) return;
    try {
      const liste = await apporteurApi.liste();
      setCatalogue(Array.isArray(liste) ? liste : []);
    } catch (err) {
      toastError(`Apporteurs non lus : ${messageErreurApi(err)}`);
    }
  };

  const choisirApporteur = (valeur) => {
    const a = catalogue.find((x) => String(x.IdApporteur) === String(valeur));
    // Convention générale de l'apporteur proposée : son montant par assuré, sinon son taux
    const montant = Number(a?.MontantParAssure) > 0 ? a.MontantParAssure : '';
    const taux = a && a.TauxRetrocession !== null && a.TauxRetrocession !== undefined ? a.TauxRetrocession : '';
    // Sans convention générale : mode gardé, valeurs vidées (rien ne reste de l'apporteur choisi avant)
    setAjout((avant) => {
      if (montant) return { ...avant, IdApporteur: valeur, Assiette: 'PAR_ASSURE', MontantParAssure: montant, Taux: '' };
      if (taux !== '') return { ...avant, IdApporteur: valeur, Assiette: avant.Assiette === 'PAR_ASSURE' ? 'COMMISSION' : avant.Assiette, Taux: taux, MontantParAssure: '' };
      return { ...avant, IdApporteur: valeur, Taux: '', MontantParAssure: '' };
    });
  };

  const appliquer = (resultat, message) => {
    setAffaire(resultat);
    success(message);
    onChange?.();
  };

  const rattacher = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const r = await apporteurApi.rattacher({
        IdDevis: idDevis || undefined, IdContrat: idContrat || undefined, IdApporteur: Number(ajout.IdApporteur), ...corpsConvention(ajout),
      });
      appliquer(r, "Apporteur rattaché à l'affaire.");
      setAjout(null);
    } catch (err) {
      toastError(`Apporteur non rattaché : ${messageErreurApi(err)}`);
    } finally {
      setEnvoi(false);
    }
  };

  const enregistrerTaux = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      appliquer(await apporteurApi.modifierRattachement(edition.IdRattachement, corpsConvention(edition)), 'Convention enregistrée. Les commissions déjà payées gardent leur montant.');
      setEdition(null);
    } catch (err) {
      toastError(`Taux non enregistré : ${messageErreurApi(err)}`);
    } finally {
      setEnvoi(false);
    }
  };

  const corriger = async (ligne, valeur) => {
    try {
      appliquer(await apporteurApi.corrigerAssures(ligne.IdCommission, valeur === '' ? null : Number(valeur)), `Quittance ${ligne.NumeroQuittance} : nombre d'assurés enregistré.`);
      return true;
    } catch (err) {
      toastError(`Nombre d'assurés non enregistré : ${messageErreurApi(err)}`);
      return false;
    }
  };

  const retirer = async (a) => {
    const motif = await saisirTexte({
      titre: `Retirer ${a.Apporteur} de cette affaire`,
      message: 'Indiquez le motif du retrait.',
      consequences: `Commissions à payer annulées : ${fcfa(a.APayer)} F. Commissions déjà payées, conservées : ${fcfa(a.Payee)} F. Plus aucune commission sur les mouvements suivants de la police.`,
      minimum: 5, maximum: 300, confirmer: "Retirer l'apporteur", ton: 'danger',
    });
    if (!motif) return;
    try {
      appliquer(await apporteurApi.retirerRattachement(a.IdRattachement, motif), `${a.Apporteur} est retiré de l'affaire.`);
    } catch (err) {
      toastError(`Retrait refusé : ${messageErreurApi(err)}`);
    }
  };

  const contenu = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.7rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Handshake size={15} /> Apporteurs d'affaires
        </div>
        {peutRattacher && affaire && !ajout && (
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={ouvrirAjout}>
            <Plus size={14} /> Rattacher un apporteur
          </button>
        )}
      </div>

      {chargement && <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Loader2 size={14} className="spin" /> Lecture des apporteurs…</div>}
      {indisponible && !chargement && <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>Apporteurs non disponibles : {indisponible}</p>}

      {affaire && !affaire.Apporteurs.length && !ajout && <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)' }}>Aucun apporteur sur cette affaire.</p>}

      {affaire?.Alerte && (
        <p role="alert" style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start', margin: '0 0 0.6rem', fontSize: '0.82rem', color: 'var(--accent-amber)' }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} /> {affaire.Alerte}
        </p>
      )}

      {affaire?.Apporteurs.length > 0 && (
        <div className="table-wrapper">
          <table className="data-table" style={{ fontSize: '0.82rem' }}>
            <thead>
              <tr>
                <th aria-label="Détail" /><th>Apporteur</th><th style={DROITE}>Taux ou montant convenu</th><th>Assiette</th><th style={DROITE}>Commission générée</th><th style={DROITE}>Payée</th><th style={DROITE}>À payer</th><th>État de règlement</th>
                {peutRattacher && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {affaire.Apporteurs.map((a) => (
                <React.Fragment key={a.IdRattachement}>
                  <tr style={a.Actif ? undefined : { opacity: 0.65 }}>
                    <td style={{ width: 28 }}>
                      {a.Lignes.length > 0 && (
                        <button type="button" className="btn btn-secondary" style={{ padding: '0.1rem 0.25rem' }} aria-expanded={ouvert === a.IdRattachement} aria-label="Voir les quittances" onClick={() => setOuvert(ouvert === a.IdRattachement ? null : a.IdRattachement)}>
                          {ouvert === a.IdRattachement ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      )}
                    </td>
                    <td>
                      <b>{a.Apporteur}</b>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{a.Code}</div>
                    </td>
                    <td style={DROITE}>
                      {edition?.IdRattachement === a.IdRattachement ? (
                        edition.Assiette === 'PAR_ASSURE'
                          ? <input type="number" min="1" step="1" className="form-control" aria-label="Montant par assuré" style={{ width: 110, display: 'inline-block', padding: '0.2rem 0.35rem' }} value={edition.MontantParAssure} onChange={(e) => setEdition({ ...edition, MontantParAssure: e.target.value })} />
                          : <input type="number" min="0.01" max="100" step="0.01" className="form-control" aria-label="Taux convenu" style={{ width: 86, display: 'inline-block', padding: '0.2rem 0.35rem' }} value={edition.Taux} onChange={(e) => setEdition({ ...edition, Taux: e.target.value })} />
                      ) : conventionAffichee(a)}
                    </td>
                    <td>
                      {edition?.IdRattachement === a.IdRattachement ? (
                        <select className="form-control" aria-label="Assiette" style={{ padding: '0.2rem 0.35rem' }} value={edition.Assiette} onChange={(e) => setEdition({ ...edition, Assiette: e.target.value, Taux: '', MontantParAssure: '' })}>
                          {OPTIONS_ASSIETTE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      ) : a.LibelleAssiette}
                    </td>
                    <td style={{ ...DROITE, fontWeight: 700 }}>
                      {a.Emis ? `${fcfa(a.CommissionGeneree)} F` : <span title="Calculée sur le devis, générée à l'émission">{fcfa(a.CommissionPrevue)} F prévus</span>}
                    </td>
                    <td style={DROITE}>{fcfa(a.Payee)} F</td>
                    <td style={DROITE}>{fcfa(a.APayer)} F</td>
                    <td>
                      {a.Actif ? <StatusBadge label={a.LibelleEtat} color={COULEURS_ETAT[a.EtatReglement]} /> : <StatusBadge label={`Retiré le ${dateFr(a.DateRetrait)}`} color="rose" />}
                      {!a.Actif && a.MotifRetrait && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{a.MotifRetrait}</div>}
                    </td>
                    {peutRattacher && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {a.Actif && edition?.IdRattachement === a.IdRattachement && (
                          <>
                            <button type="button" className="btn btn-primary" disabled={envoi} style={{ padding: '0.2rem 0.4rem', marginRight: '0.25rem' }} aria-label="Enregistrer le taux" onClick={enregistrerTaux}><Save size={14} /></button>
                            <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.4rem' }} aria-label="Annuler" onClick={() => setEdition(null)}><X size={14} /></button>
                          </>
                        )}
                        {a.Actif && edition?.IdRattachement !== a.IdRattachement && (
                          <>
                            {a.Assiette !== 'FORFAIT' && <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.4rem', marginRight: '0.25rem' }} title="Modifier la convention" aria-label={`Modifier le taux ou le montant de ${a.Apporteur}`} onClick={() => setEdition({ IdRattachement: a.IdRattachement, Taux: a.Assiette === 'PAR_ASSURE' ? '' : a.Taux, MontantParAssure: a.Assiette === 'PAR_ASSURE' ? a.MontantUnitaire : '', Assiette: a.Assiette })}><Edit2 size={14} /></button>}
                            <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.4rem' }} title="Retirer de l'affaire" aria-label={`Retirer ${a.Apporteur}`} onClick={() => retirer(a)}><UserMinus size={14} /></button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                  {ouvert === a.IdRattachement && (
                    <tr><td colSpan={peutRattacher ? 9 : 8} style={{ padding: '0.4rem 0.5rem' }}><LignesQuittances lignes={a.Lignes} peutCorriger={peutRattacher} onCorriger={corriger} /></td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ajout && (
        <form onSubmit={rattacher} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.7rem' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="ba-apporteur">Apporteur</label>
            <select id="ba-apporteur" className="form-control" required value={ajout.IdApporteur} onChange={(e) => choisirApporteur(e.target.value)}>
              <option value="">Choisir</option>
              {proposes.map((a) => <option key={a.IdApporteur} value={a.IdApporteur}>{a.Code} - {nomApporteur(a)}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="ba-assiette">Commission</label>
            <select id="ba-assiette" className="form-control" value={ajout.Assiette} onChange={(e) => setAjout({ ...ajout, Assiette: e.target.value, Taux: '', MontantParAssure: '' })}>
              {OPTIONS_ASSIETTE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {ajout.Assiette === 'PAR_ASSURE' ? (
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="ba-montant">Montant par assuré, en F</label>
              <input id="ba-montant" type="number" min="1" step="1" required className="form-control" value={ajout.MontantParAssure} onChange={(e) => setAjout({ ...ajout, MontantParAssure: e.target.value })} />
            </div>
          ) : (
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="ba-taux">Taux convenu pour cette affaire, en %</label>
              <input id="ba-taux" type="number" min="0.01" max="100" step="0.01" required className="form-control" value={ajout.Taux} onChange={(e) => setAjout({ ...ajout, Taux: e.target.value })} />
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button type="submit" className="btn btn-primary" disabled={envoi} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>{envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Rattacher</button>
            <button type="button" className="btn btn-secondary" onClick={() => setAjout(null)}>Annuler</button>
          </div>
          {!proposes.length && catalogue.length > 0 && <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Aucun autre apporteur actif : créez-le dans Administration, Apporteurs d'affaires.</p>}
        </form>
      )}
    </>
  );

  if (sansCadre) return contenu;
  return <div className="glass-panel" style={{ padding: '1.25rem' }}>{contenu}</div>;
}
