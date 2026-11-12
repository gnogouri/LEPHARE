import React, { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, ListChecks, Loader2, PencilLine, Printer, RefreshCw, Search, X } from 'lucide-react';
import { financeApi, settingsApi } from '../../../api/endpoints';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { CorrectionEncaissement } from '../../../components/cash/CorrectionEncaissement';
import { aLeDroit } from '../../../utils/droits';
import { useToast } from '../../../context/ToastContext';
import {
  aujourdhui, correspondRecherche, dateFr, exporterEtatEncaissements, fcfa, messageErreurApi, recentsDabord,
} from '../../../utils/financeUtils';
import { imprimerRecapitulatifEncaissements } from '../../../utils/impressionsFinance';
import { trierParLibelle } from '../../../utils/sortUtils';

// État récapitulatif des encaissements : montant, mode, référence et statut de chaque quittance
// encaissée, par compagnie (GET /api/finance/encaissements/). Statut : à reverser, reversé
// (partiellement ou en entier) à la compagnie, annulé, chèque impayé, repris d'URANUS. Un
// décaissement (prime mal affectée) est compté en négatif et déduit du reste à reverser de sa quittance.
const COULEURS = { A_REVERSER: 'amber', PARTIEL: 'amber', REVERSE: 'emerald', ANNULE: 'rose', IMPAYE: 'rose', DECAISSEMENT: 'rose', DEDUIT: 'slate', REPRIS: 'slate' };
const STATUTS = [
  ['', 'Tous les statuts'], ['A_REVERSER', 'À reverser'], ['PARTIEL', 'Partiellement reversé'], ['REVERSE', 'Reversé à la compagnie'],
  ['DECAISSEMENT', 'Décaissement'], ['DEDUIT', 'Couvert par un décaissement'],
  ['ANNULE', 'Annulé'], ['IMPAYE', 'Chèque impayé'], ['REPRIS', 'Importé'],
];

const Carte = ({ libelle, valeur, detail, couleur = 'var(--text-primary)' }) => (
  <div className="glass-panel" style={{ padding: '1rem 1.1rem' }}>
    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-muted)' }}>{libelle}</div>
    <div style={{ fontSize: '1.3rem', fontWeight: 900, color: couleur, marginTop: '0.2rem' }}>{valeur}</div>
    {detail && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{detail}</div>}
  </div>
);

export const EtatEncaissementsPage = () => {
  const { error: toastError } = useToast();
  const [compagnies, setCompagnies] = useState([]);
  const [modes, setModes] = useState([]);
  const [filtres, setFiltres] = useState({ du: `${new Date().getFullYear()}-01-01`, au: aujourdhui(), compagnie: '', mode: '', statut: '' });
  const [etat, setEtat] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [recherche, setRecherche] = useState('');
  // Correction d'une pièce saisie par erreur (référence, client, doublon) ; le serveur dit ce qui est permis
  const [aCorriger, setACorriger] = useState(null);
  const peutCorriger = aLeDroit('encaissements.create') || aLeDroit('encaissements.cancel');
  const corrigeable = (l) => peutCorriger && l.Montant > 0 && !['ANNULE', 'IMPAYE', 'DECAISSEMENT'].includes(l.Statut);

  useEffect(() => {
    settingsApi.getCompanies().then((l) => setCompagnies(Array.isArray(l) ? l : [])).catch(() => {});
    settingsApi.getModesEncaissement().then((l) => setModes(Array.isArray(l) ? l : [])).catch(() => {});
  }, []);

  const charger = () => {
    setChargement(true);
    const params = Object.fromEntries(Object.entries(filtres).filter(([, v]) => v !== ''));
    financeApi.etatEncaissements(params)
      .then(setEtat)
      .catch((err) => toastError(`État des encaissements indisponible : ${messageErreurApi(err)}`))
      .finally(() => setChargement(false));
  };
  useEffect(charger, []); // eslint-disable-line react-hooks/exhaustive-deps

  const libelleCompagnie = useMemo(
    () => compagnies.find((c) => String(c.IdCompagnie ?? c.id) === String(filtres.compagnie))?.RaisonSociale || '',
    [compagnies, filtres.compagnie],
  );
  const champ = (cle) => (e) => setFiltres((f) => ({ ...f, [cle]: e.target.value }));

  // Recherche libre dans les lignes chargées (client, quittance, pièce, chèque, banque, date, montant…), du plus récent
  // au plus ancien ; totaux et exports portent sur les lignes trouvées
  const lignesVisibles = useMemo(() => (etat?.Lignes || [])
    .filter((l) => correspondRecherche(recherche, [
      l.Client, l.NumeroQuittance, l.NumeroPolice, l.NumeroPiece, l.Compagnie, l.Branche, l.Mode, l.Reference, l.Banque,
      l.LibelleStatut, l.MotifAnnulation, dateFr(l.DateEncaissement), l.Montant,
    ]))
    .sort(recentsDabord((l) => l.DateEncaissement, (l) => l.IdDetailEncaissement)), [etat, recherche]);
  const filtre = Boolean(recherche.trim());
  const valides = lignesVisibles.filter((l) => !['ANNULE', 'IMPAYE'].includes(l.Statut));
  const somme = (ls, cle) => ls.reduce((t, l) => t + (Number(l[cle]) || 0), 0);
  const etatAffiche = etat && filtre ? {
    ...etat,
    Lignes: lignesVisibles,
    Total: { Nombre: valides.length, Montant: somme(valides, 'Montant'), Reverse: somme(valides, 'MontantReverse'), ResteAReverser: somme(valides, 'ResteAReverser') },
    ParMode: Object.values(valides.reduce((acc, l) => {
      const g = acc[l.Mode || '-'] || { Libelle: l.Mode || '-', Nombre: 0, Montant: 0, Reverse: 0 };
      g.Nombre += 1; g.Montant += l.Montant; g.Reverse += l.MontantReverse;
      return { ...acc, [g.Libelle]: g };
    }, {})),
  } : (etat && { ...etat, Lignes: lignesVisibles });
  const exporter = (format) => etatAffiche && exporterEtatEncaissements(etatAffiche, { libelleCompagnie }, format);

  // Bordereau récapitulatif des encaissements de la période : imprimé (lignes affichées, recherche comprise) ou en
  // Excel (filtres de période, compagnie, mode et statut, totaux en formules)
  const [telechargement, setTelechargement] = useState(false);
  const libelleFiltres = () => [
    filtres.mode && `Mode : ${modes.find((m) => String(m.idmodeencaissement) === String(filtres.mode))?.libellemodepaiement || ''}`,
    filtres.statut && `Statut : ${STATUTS.find(([v]) => v === filtres.statut)?.[1] || ''}`,
    filtre && `Recherche : « ${recherche.trim()} »`,
  ].filter(Boolean).join(' - ');
  const imprimerRecapitulatif = () => etatAffiche && imprimerRecapitulatifEncaissements(etatAffiche, { compagnie: libelleCompagnie, filtres: libelleFiltres() });
  const telechargerRecapitulatif = async () => {
    setTelechargement(true);
    try {
      const params = Object.fromEntries(Object.entries(filtres).filter(([, v]) => v !== ''));
      await financeApi.telechargerRecapitulatifEncaissements(params,
        `Bordereau recapitulatif des encaissements ${libelleCompagnie || 'toutes compagnies'} du ${dateFr(filtres.du)} au ${dateFr(filtres.au)}.xlsx`.replace(/\//g, '-'));
    } catch (err) {
      toastError(`Excel non téléchargé : ${messageErreurApi(err)}`);
    } finally {
      setTelechargement(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', paddingBottom: '2rem' }}>
      <div>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', margin: 0 }}>
          <ListChecks size={26} style={{ color: 'var(--primary-500)' }} /> État des encaissements
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.3rem 0 0' }}>
          Chaque quittance encaissée avec son montant, son mode de règlement, sa référence et son statut, par compagnie.
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '0.75rem', alignItems: 'end' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="ee-du">Du</label>
          <input id="ee-du" type="date" className="form-control" value={filtres.du} onChange={champ('du')} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="ee-au">Au</label>
          <input id="ee-au" type="date" className="form-control" value={filtres.au} onChange={champ('au')} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="ee-cie">Compagnie</label>
          <select id="ee-cie" className="form-control" value={filtres.compagnie} onChange={champ('compagnie')}>
            <option value="">Toutes les compagnies</option>
            {trierParLibelle(compagnies, (c) => c.RaisonSociale).map((c) => (
              <option key={c.IdCompagnie ?? c.id} value={c.IdCompagnie ?? c.id}>{c.RaisonSociale}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="ee-mode">Mode</label>
          <select id="ee-mode" className="form-control" value={filtres.mode} onChange={champ('mode')}>
            <option value="">Tous les modes</option>
            {modes.map((m) => <option key={m.idmodeencaissement} value={m.idmodeencaissement}>{m.libellemodepaiement}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="ee-statut">Statut</label>
          <select id="ee-statut" className="form-control" value={filtres.statut} onChange={champ('statut')}>
            {STATUTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={charger} disabled={chargement} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {chargement ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Afficher
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => exporter('excel')} disabled={!etat} title="Exporter en Excel (lignes affichées)"><FileSpreadsheet size={15} /></button>
          <button type="button" className="btn btn-secondary" onClick={() => exporter('pdf')} disabled={!etat} title="Imprimer / PDF"><FileText size={15} /></button>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px dashed var(--border-subtle)', paddingTop: '0.75rem' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginRight: 'auto' }}>
            Bordereau récapitulatif des encaissements du {dateFr(filtres.du)} au {dateFr(filtres.au)}{libelleCompagnie ? ` - ${libelleCompagnie}` : ''}
          </span>
          <button type="button" className="btn btn-primary" onClick={imprimerRecapitulatif} disabled={!etat || chargement}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Printer size={15} /> Bordereau récapitulatif
          </button>
          <button type="button" className="btn btn-secondary" onClick={telechargerRecapitulatif} disabled={!etat || telechargement || filtre}
            title={filtre ? 'Retirez la recherche : l\'Excel reprend les filtres de période, compagnie, mode et statut' : 'Bordereau récapitulatif en Excel (totaux en formules)'}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {telechargement ? <Loader2 size={15} className="spin" /> : <FileSpreadsheet size={15} />} En Excel
          </button>
        </div>
      </div>

      {etat && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '0.75rem' }}>
            <Carte libelle="Montant encaissé net" valeur={`${fcfa(etat.Total.Montant)} F`} detail={`${etat.Total.Nombre} ligne(s), décaissements déduits, hors annulés et impayés`} />
            <Carte libelle="Reversé aux compagnies" valeur={`${fcfa(etat.Total.Reverse)} F`} couleur="var(--accent-emerald)" />
            <Carte libelle="Reste à reverser" valeur={`${fcfa(etat.Total.ResteAReverser)} F`} couleur="var(--accent-amber)" detail={`Encaissements depuis le ${dateFr(etat.DebutReversements)}`} />
            {(etat.ParStatut || []).filter((s) => ['DECAISSEMENT', 'ANNULE', 'IMPAYE'].includes(s.Statut)).map((s) => (
              <Carte key={s.Statut} libelle={s.Libelle} valeur={`${fcfa(s.Montant)} F`} couleur="var(--accent-rose)" detail={`${s.Nombre} ligne(s)`} />
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: '0.75rem' }}>
            {[['Par mode de règlement', etat.ParMode], ['Par compagnie', etat.ParCompagnie]].map(([titre, groupes]) => (
              <div key={titre} className="glass-panel" style={{ padding: '1rem 1.1rem' }}>
                <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>{titre}</div>
                <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr><th>{titre === 'Par compagnie' ? 'Compagnie' : 'Mode'}</th><th style={{ textAlign: 'right' }}>Lignes</th><th style={{ textAlign: 'right' }}>Encaissé</th><th style={{ textAlign: 'right' }}>Reversé</th></tr></thead>
                  <tbody>
                    {groupes.map((g) => (
                      <tr key={g.Libelle}><td>{g.Libelle}</td><td style={{ textAlign: 'right' }}>{g.Nombre}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fcfa(g.Montant)}</td><td style={{ textAlign: 'right' }}>{fcfa(g.Reverse)}</td></tr>
                    ))}
                    {!groupes.length && <tr><td colSpan={4} style={{ color: 'var(--text-muted)' }}>Aucun encaissement.</td></tr>}
                  </tbody>
                </table>
                </div>
              </div>
            ))}
          </div>

          <div className="glass-panel" style={{ padding: '1rem 1.1rem' }}>
            <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 280 }}>
                <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input type="text" className="form-control" style={{ paddingLeft: '2rem', paddingRight: '2rem' }} value={recherche}
                  onChange={(e) => setRecherche(e.target.value)} aria-label="Rechercher dans les encaissements"
                  placeholder="Rechercher : client, quittance, n° de pièce, chèque, banque, date (jj/mm/aaaa), montant…" />
                {recherche && (
                  <button type="button" onClick={() => setRecherche('')} aria-label="Effacer la recherche"
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex' }}>
                    <X size={15} />
                  </button>
                )}
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {filtre ? `${lignesVisibles.length} ligne(s) sur ${etat.Lignes.length} - encaissé net ${fcfa(etatAffiche.Total.Montant)} F` : `${etat.Lignes.length} ligne(s)`} - du plus récent au plus ancien
              </span>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date de saisie</th><th>N° pièce</th><th>Compagnie</th><th>Client</th><th>Branche</th><th>Quittance</th>
                    <th>Mode</th><th>Référence</th><th style={{ textAlign: 'right' }}>Montant</th><th>Statut</th>
                    {peutCorriger && <th aria-label="Corriger" />}
                  </tr>
                </thead>
                <tbody>
                  {lignesVisibles.map((l) => (
                    <tr key={l.IdDetailEncaissement}>
                      <td>{dateFr(l.DateEncaissement)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{l.NumeroPiece}</td>
                      <td>{l.Compagnie}</td>
                      <td>{l.Client}</td>
                      <td>{l.Branche}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{l.NumeroQuittance}</td>
                      <td>{l.Mode}</td>
                      <td>
                        {[l.Reference, l.Banque].filter(Boolean).join(' - ') || '-'}
                        {(l.DateCheque || l.DateReceptionCheque) && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {[l.DateCheque && `émis le ${dateFr(l.DateCheque)}`, l.DateReceptionCheque && `reçu le ${dateFr(l.DateReceptionCheque)}`].filter(Boolean).join(' - ')}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: l.Montant < 0 ? 'var(--accent-rose)' : undefined }}>{fcfa(l.Montant)}</td>
                      <td title={l.MotifAnnulation || undefined} style={{ whiteSpace: 'nowrap' }}><StatusBadge label={l.LibelleStatut} color={COULEURS[l.Statut]} /></td>
                      {peutCorriger && (
                        <td>
                          {corrigeable(l) && (
                            <button type="button" className="admin-bouton-icone" onClick={() => setACorriger(l.IdEncaissement)}
                              title={`Corriger la pièce ${l.NumeroPiece} : référence, client, quittance ou doublon`} aria-label={`Corriger la pièce ${l.NumeroPiece}`}>
                              <PencilLine size={15} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {!lignesVisibles.length && (
                    <tr><td colSpan={peutCorriger ? 11 : 10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                      {etat.Lignes.length ? 'Aucun encaissement ne correspond à la recherche.' : 'Aucun encaissement pour ces critères.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {aCorriger && <CorrectionEncaissement idEncaissement={aCorriger} onClose={() => setACorriger(null)} onCorrige={charger} />}
    </div>
  );
};

export default EtatEncaissementsPage;
