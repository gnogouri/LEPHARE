import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { Modal } from '../../../components/common/Modal';
import { quoteApi } from '../../../api/endpoints';
import { sortUniqueBy } from '../../../utils/sortUtils';

const MODELE = '/assets/modeles/modele_flotte_automobile.xlsx';
// Formulaire assurance auto d'OREOLE (compte rendu du 12-10-2026), rempli par le client : mono ou flotte
const FORMULAIRE = '/assets/modeles/formulaire_assurance_auto.xlsx';
const f = (v) => (v || v === 0 ? Number(v).toLocaleString('fr-FR') : '-');
const messageErreur = (err) => err?.response?.data?.error || err?.response?.data?.detail || err?.message || 'erreur du serveur';
// « 2644 EN 01 », « 2644-en-01 » et « 2644EN01 » désignent le même véhicule
const immat = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Import des véhicules depuis un fichier Excel : « Formulaire assurance auto » d'OREOLE (un véhicule :
 * devis mono, plusieurs : flotte ; valeur vénale contrôlée par le tableau de dépréciation) ou liste NSIA
 * « Liste des véhicules en Automobile » (garanties Oui / Non). Le serveur lit le fichier sans rien
 * enregistrer ; les véhicules retenus remplacent ceux de la flotte (par défaut) ou s'y ajoutent.
 */
export const ImportFlotteModal = ({
  isOpen, onClose, idCompagnie, nomCompagnie, idTarif, idOffre, marques, vehiculesFlotte = [], dateEffet, onImporter,
  fichierInitial = null,
}) => {
  const [fichier, setFichier] = useState(null);
  const [analyse, setAnalyse] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [import_, setImport] = useState(false);
  const [exclus, setExclus] = useState(new Set());
  // Marque du fichier absente du référentiel → marque choisie (id)
  const [correspondances, setCorrespondances] = useState({});
  // Le fichier remplace la flotte, sauf choix contraire : réimporter un fichier corrigé ne cumule plus
  const [mode, setMode] = useState('remplacer');
  const flotteNonVide = vehiculesFlotte.length > 0;
  const remplacer = !flotteNonVide || mode === 'remplacer';
  const dejaEnregistres = vehiculesFlotte.filter((v) => v.enregistre && v.idDevisDetail).length;

  const fermer = () => {
    if (import_) return;
    setFichier(null);
    setAnalyse(null);
    setErreur('');
    setExclus(new Set());
    setCorrespondances({});
    setMode('remplacer');
    onClose();
  };

  const analyser = async (aLire = fichier) => {
    if (!aLire) return;
    setEnCours(true);
    setErreur('');
    setAnalyse(null);
    try {
      const resultat = await quoteApi.analyserImportFlotte(aLire, { idCompagnie, idTarif, idOffre, dateEffet });
      setAnalyse(resultat);
      setExclus(new Set());
      setCorrespondances({});
    } catch (err) {
      setErreur(`Fichier non analysé : ${messageErreur(err)}`);
    } finally {
      setEnCours(false);
    }
  };

  // Fichier du questionnaire prospect (écran ouvert depuis « Établir le devis ») : repris et analysé d'office
  useEffect(() => {
    if (!isOpen || !fichierInitial) return;
    setFichier(fichierInitial);
    analyser(fichierInitial);
  }, [isOpen, fichierInitial]); // eslint-disable-line react-hooks/exhaustive-deps

  const marquesInconnues = useMemo(() => [...new Set((analyse?.Vehicules || [])
    .filter((v) => !v.Vehicule.idMarque && v.Fichier.Marque)
    .map((v) => v.Fichier.Marque.toUpperCase()))], [analyse]);

  // Lignes telles qu'elles seront importées : marque corrigée ; en ajout, véhicules déjà dans la flotte
  // écartés ; une immatriculation présente deux fois dans le fichier n'est importée qu'une fois
  const lignes = useMemo(() => {
    const existantes = new Set(remplacer ? [] : vehiculesFlotte.map((v) => immat(v.immatriculation)).filter(Boolean));
    const premiereLigne = new Map();
    return (analyse?.Vehicules || []).map((v) => {
      const erreurs = v.Erreurs.filter((e) => !/^Marque « .* » inconnue/.test(e));
      let vehicule = v.Vehicule;
      if (!vehicule.idMarque && v.Fichier.Marque) {
        const choisie = marques.find((m) => Number(m.id) === Number(correspondances[v.Fichier.Marque.toUpperCase()]));
        if (choisie) vehicule = { ...vehicule, idMarque: Number(choisie.id), marqueVehicule: choisie.libelle };
        else erreurs.push(`Marque « ${v.Fichier.Marque} » inconnue : choisissez-la ci-dessus.`);
      }
      const cle = immat(vehicule.immatriculation);
      if (cle && existantes.has(cle)) erreurs.push('Déjà dans la flotte.');
      if (cle && premiereLigne.has(cle)) erreurs.push(`Immatriculation déjà lue ligne ${premiereLigne.get(cle)} du fichier.`);
      else if (cle) premiereLigne.set(cle, v.Ligne);
      return { ...v, Vehicule: vehicule, ErreursAffichees: erreurs };
    });
  }, [analyse, marques, correspondances, vehiculesFlotte, remplacer]);

  const retenues = lignes.filter((l) => !l.ErreursAffichees.length && !exclus.has(l.Ligne));
  const basculer = (ligne) => setExclus((s) => {
    const n = new Set(s);
    if (n.has(ligne)) n.delete(ligne); else n.add(ligne);
    return n;
  });

  const importer = async () => {
    if (!retenues.length) return;
    setImport(true);
    try {
      await onImporter(retenues, { remplacer, format: analyse?.Format });
      setImport(false);
      fermer();
    } catch (err) {
      setErreur(`Import interrompu : ${messageErreur(err)}`);
      setImport(false);
    }
  };

  const cellule = { padding: '0.45rem 0.55rem', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top' };
  const nombre = { ...cellule, textAlign: 'right', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' };

  return (
    <Modal isOpen={isOpen} onClose={fermer} title="Importer les véhicules (formulaire Excel)" subtitle={nomCompagnie ? `Compagnie : ${nomCompagnie}` : undefined} maxWidth="1200px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <strong>Formulaire assurance auto</strong> rempli par le client : un véhicule donne un devis mono, plusieurs un devis flotte.
          La catégorie et l'offre sont celles de l'écran (garanties de l'offre, sans celles que la compagnie n'admet pas pour l'âge du véhicule) ; la valeur vénale
          du fichier est comparée au tableau de dépréciation et proposée par lui si elle manque.
        </p>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Accepté aussi : la « Liste des véhicules en Automobile » (NSIA) : une ligne « Catégorie 201 … » par bloc,
          l'en-tête N° / Marque / Type / Puissance / CU / Immatriculation / Énergie / Zone / Valeurs / Nombre de places puis
          une colonne par garantie (Oui / Non). Un véhicule tient sur une ligne (valeurs séparées par « / ») ou sur trois
          (prime, Oui / Non, capital). L'offre de chaque véhicule est choisie d'après ses garanties « Oui » ; celles marquées « Non » lui sont retirées.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', margin: 0 }}>
            <FileSpreadsheet size={16} />
            {fichier ? fichier.name : 'Choisir le fichier Excel…'}
            <input type="file" accept=".xlsx,.xlsm" style={{ display: 'none' }}
              onChange={(e) => { setFichier(e.target.files?.[0] || null); setAnalyse(null); setErreur(''); e.target.value = ''; }} />
          </label>
          <button type="button" className="btn btn-primary" disabled={!fichier || enCours} onClick={() => analyser()}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {enCours ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} Analyser le fichier
          </button>
          <a href={FORMULAIRE} download="Formulaire_assurance_auto.xlsx" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: '#3b82f6' }}>
            <Download size={15} /> Formulaire assurance auto (vierge)
          </a>
          <a href={MODELE} download="Modele_flotte_automobile.xlsx" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <Download size={14} /> Liste NSIA (vierge)
          </a>
        </div>

        {flotteNonVide && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '0.65rem 0.9rem', fontSize: '0.86rem' }}>
            <span style={{ fontWeight: 700 }}>La flotte compte déjà {vehiculesFlotte.length} véhicule{vehiculesFlotte.length > 1 ? 's' : ''} :</span>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name="mode-import-flotte" checked={mode === 'remplacer'} onChange={() => setMode('remplacer')} />
              Remplacer les véhicules de la flotte par ceux du fichier
              {dejaEnregistres > 0 && (
                <span style={{ color: '#f59e0b' }}>
                  ({dejaEnregistres} déjà enregistré{dejaEnregistres > 1 ? 's' : ''}, supprimé{dejaEnregistres > 1 ? 's' : ''} du devis à l'enregistrement)
                </span>
              )}
            </label>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name="mode-import-flotte" checked={mode === 'ajouter'} onChange={() => setMode('ajouter')} />
              Ajouter les véhicules du fichier à ceux de la flotte
            </label>
          </div>
        )}

        {erreur && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: '#f87171', fontSize: '0.9rem' }}>
            <AlertTriangle size={18} /> {erreur}
          </div>
        )}

        {analyse && (
          <>
            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.88rem' }}>
              <span><strong>{lignes.length}</strong> véhicule{lignes.length > 1 ? 's' : ''} lu{lignes.length > 1 ? 's' : ''}</span>
              <span style={{ color: '#34d399' }}><strong>{retenues.length}</strong> à importer</span>
              {lignes.some((l) => l.ErreursAffichees.length) && (
                <span style={{ color: '#f87171' }}><strong>{lignes.filter((l) => l.ErreursAffichees.length).length}</strong> à corriger (non importés)</span>
              )}
              {(analyse.Avertissements || []).map((a) => <span key={a} style={{ color: '#f59e0b' }}>{a}</span>)}
            </div>

            {marquesInconnues.length > 0 && (
              <div style={{ border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: 8, padding: '0.75rem 1rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem', color: '#f59e0b' }}>
                  Marques absentes du référentiel : choisissez la marque correspondante (ou créez-la avec « + » à l'écran Véhicule, puis réanalysez)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.5rem 1rem' }}>
                  {marquesInconnues.map((m) => (
                    <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                      <span style={{ minWidth: 110, fontWeight: 700 }}>{m}</span>
                      <select className="form-control" value={correspondances[m] || ''}
                        onChange={(e) => setCorrespondances((c) => ({ ...c, [m]: e.target.value }))}>
                        <option value="">Choisir</option>
                        {sortUniqueBy(marques, (x) => x.libelle).map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div style={{ overflow: 'auto', maxHeight: '48vh' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', position: 'sticky', top: 0, background: 'var(--bg-card, #0f172a)' }}>
                    <th style={cellule} />
                    <th style={cellule}>Ligne</th>
                    <th style={cellule}>Immatriculation</th>
                    <th style={cellule}>Catégorie</th>
                    <th style={cellule}>Marque / Type</th>
                    <th style={cellule}>Puiss. / CU</th>
                    {analyse.Format === 'formulaire' && <th style={cellule}>1re MEC</th>}
                    <th style={cellule}>Énergie</th>
                    <th style={{ ...cellule, textAlign: 'right' }}>Neuf / Vénale</th>
                    <th style={cellule}>Pl.</th>
                    <th style={cellule}>Offre retenue</th>
                    <th style={{ ...cellule, textAlign: 'right' }}>PN fichier</th>
                    <th style={cellule}>Remarques</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => {
                    const v = l.Vehicule;
                    const bloquee = l.ErreursAffichees.length > 0;
                    const retenue = !bloquee && !exclus.has(l.Ligne);
                    return (
                      <tr key={l.Ligne} style={{ opacity: retenue ? 1 : 0.55 }}>
                        <td style={cellule}>
                          <input type="checkbox" checked={retenue} disabled={bloquee} onChange={() => basculer(l.Ligne)}
                            aria-label={`Importer ${v.immatriculation || `la ligne ${l.Ligne}`}`} />
                        </td>
                        <td style={cellule}>{l.Ligne}{l.Numero ? ` (n° ${l.Numero})` : ''}</td>
                        <td style={{ ...cellule, fontWeight: 700, color: '#38bdf8' }}>{v.immatriculation || '-'}</td>
                        <td style={cellule}>{v.codeCategorie} {v.categorieContrat}</td>
                        <td style={cellule}>{v.marqueVehicule}<div style={{ color: 'var(--text-muted)' }}>{l.Fichier.Type} → {v.genreVehicule}</div></td>
                        <td style={cellule}>{v.puissanceFiscale || '-'} CV{v.chargeUtile ? ` / ${f(v.chargeUtile)} kg` : ''}</td>
                        {analyse.Format === 'formulaire' && <td style={cellule}>{l.Fichier.DateMec ? l.Fichier.DateMec.split('-').reverse().join('/') : '-'}</td>}
                        <td style={cellule}>{v.energie}</td>
                        <td style={nombre}>
                          {f(v.valeurNeuf)}<div>{f(v.valeurVenale)}</div>
                          {l.Fichier.ValeurVenaleTableau !== undefined && l.Fichier.ValeurVenaleTableau !== null && Number(l.Fichier.ValeurVenaleTableau) !== Number(v.valeurVenale) && (
                            <div style={{ color: '#f59e0b', fontSize: '0.72rem' }} title={l.Fichier.ExplicationTableau || ''}>tableau : {f(l.Fichier.ValeurVenaleTableau)}</div>
                          )}
                        </td>
                        <td style={cellule}>{v.nombrePlace}</td>
                        <td style={cellule}>
                          {v.offreSelectionnee || '-'}
                          {l.ColonnesRetirees?.length > 0 && <div style={{ color: 'var(--text-muted)' }}>sans {l.ColonnesRetirees.join(', ')}</div>}
                          {v.codeFormuleSecuriteRoutiere && v.codeFormuleSecuriteRoutiere !== 'AUCUNE' && <div style={{ color: 'var(--text-muted)' }}>SR {v.codeFormuleSecuriteRoutiere}</div>}
                        </td>
                        <td style={nombre}>{f(l.Fichier.PrimeNette)}</td>
                        <td style={{ ...cellule, minWidth: 220 }}>
                          {l.ErreursAffichees.map((e) => <div key={e} style={{ color: '#f87171' }}>{e}</div>)}
                          {l.Avertissements.map((a) => <div key={a} style={{ color: '#f59e0b' }}>{a}</div>)}
                          {!l.ErreursAffichees.length && !l.Avertissements.length && <CheckCircle size={14} color="#34d399" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Les véhicules importés sont tarifés puis enregistrés avec le devis (bouton d'enregistrement habituel).
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={fermer} disabled={import_}>Fermer</button>
            <button type="button" className="btn btn-primary" disabled={!retenues.length || import_} onClick={importer}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {import_ ? <Loader2 size={16} className="spin" /> : <CheckCircle size={16} />}
              {analyse?.Format === 'formulaire' && retenues.length === 1 && !flotteNonVide
                ? 'Reprendre ce véhicule (devis mono)'
                : remplacer && flotteNonVide
                  ? `Remplacer la flotte par ${retenues.length} véhicule${retenues.length > 1 ? 's' : ''}`
                  : `Ajouter ${retenues.length} véhicule${retenues.length > 1 ? 's' : ''} à la flotte`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
