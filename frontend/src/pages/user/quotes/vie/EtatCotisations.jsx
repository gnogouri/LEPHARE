import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, History, Loader2, Plus, Search, Trash2, Undo2, UserMinus, Users,
} from 'lucide-react';
import { PAR_PAGE, cleSalarie, compte, cotisantVide, fcfa, fcfaSigne, sansCotisation, totalSalarie } from './vieCommun';

/* =========================================================================
   ÉTAT DES COTISATIONS (offre Retraite complémentaire) : un salarié par ligne, part salariale et part employeur.
   Environ 600 salariés chez CI-ENERGIES : tableau paginé, recherche, filtres (nouveaux, reprises, sans cotisation, montants
   modifiés, à corriger), écart avec l'état du mois précédent ligne par ligne. Un salarié peut ne pas cotiser un mois : absent
   du fichier (liste des absents, réintégrable d'un clic) ou présent à 0 F ; à son retour il « reprend », ce n'est pas un nouveau.
   ========================================================================= */

const norme = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

const LigneSalarie = memo(({ ligne, numero, problemes, ancienne, statut, comparer, lectureSeule, focus, onChanger, onRetirer }) => {
  const total = totalSalarie(ligne);
  const zero = sansCotisation(ligne);
  const ecart = ancienne ? total - totalSalarie(ancienne) : 0;
  const champ = (nom, props = {}) => (
    <input className="form-control" value={ligne[nom] ?? ''} disabled={lectureSeule} aria-label={`${props.libelle || nom} du salarié ${numero}`}
      onChange={(e) => onChanger(ligne.cle, nom, props.majuscules ? e.target.value.toUpperCase() : e.target.value)}
      {...(props.nombre ? { type: 'number', min: 0, step: 1, inputMode: 'numeric' } : {})} autoFocus={props.focus} />
  );
  const avertissements = (ligne.Avertissements || []).filter(Boolean);
  return (
    <>
      <tr className={[problemes ? 'vie-ligne-erreur' : '', statut === 'nouveau' || statut === 'reprise' ? 'vie-ligne-nouvelle' : '',
        statut === 'modifie' ? 'vie-ligne-modifiee' : '', zero ? 'vie-ligne-zero' : ''].join(' ')}>
        <td className="col-num">{numero}</td>
        <td className="col-mat">{champ('Matricule', { libelle: 'Matricule', majuscules: true, focus })}</td>
        <td className="col-nom">{champ('Nom', { libelle: 'Nom', majuscules: true })}</td>
        <td className="col-prenoms">{champ('Prenoms', { libelle: 'Prénoms', majuscules: true })}</td>
        <td className="col-montant">{champ('CotisationSalarie', { libelle: 'Part salariale', nombre: true })}</td>
        <td className="col-montant">{champ('CotisationEmployeur', { libelle: 'Part employeur', nombre: true })}</td>
        <td className="col-total droite">
          {zero && (String(ligne.Nom || '').trim() || String(ligne.Matricule || '').trim())
            ? <span className="vie-etiquette" title="Ce salarié ne cotise pas ce mois : il reste dans l'état, sans prime">Sans cotisation</span>
            : fcfa(total)}
        </td>
        {comparer && (
          <td className="col-ecart droite">
            {statut === 'nouveau' && <span className="vie-etiquette vert">Nouveau</span>}
            {statut === 'reprise' && (
              <span className="vie-etiquette accent" title="Absent de l'état du mois précédent, il avait déjà cotisé avant : il reprend ses cotisations">Reprise</span>
            )}
            {statut === 'modifie' && (
              <span className={`vie-ecart ${ecart > 0 ? 'vie-hausse' : 'vie-baisse'}`} title={`Mois précédent : ${fcfa(totalSalarie(ancienne))} F`}>
                {ecart > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {fcfaSigne(ecart)}
              </span>
            )}
            {statut === 'inchange' && <span style={{ color: 'var(--text-muted)' }}>=</span>}
          </td>
        )}
        <td className="col-obs">{champ('Observation', { libelle: 'Observation' })}</td>
        <td className="col-act">
          {!lectureSeule && (
            <button type="button" className="admin-bouton-icone" onClick={() => onRetirer(ligne.cle)} aria-label={`Retirer le salarié ${numero}`} title="Retirer de l'état">
              <Trash2 size={14} />
            </button>
          )}
        </td>
      </tr>
      {(problemes || avertissements.length > 0) && (
        <tr className="vie-ligne-message">
          <td />
          <td colSpan={comparer ? 9 : 8}>
            {problemes && <span className="vie-message erreur"><AlertTriangle size={12} /> À corriger : {problemes}.</span>}
            {avertissements.map((a) => <span key={a} className="vie-message">{a}</span>)}
          </td>
        </tr>
      )}
    </>
  );
});
LigneSalarie.displayName = 'LigneSalarie';

export const EtatCotisations = ({ cotisants, setCotisants, erreurs, comparaison, precedent, chargementPrecedent, onReprendrePrecedent, lectureSeule }) => {
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState('tous');
  const [page, setPage] = useState(1);
  const [focusCle, setFocusCle] = useState(null);

  const numeros = useMemo(() => new Map(cotisants.map((l, i) => [l.cle, i + 1])), [cotisants]);
  const statut = useCallback((l) => {
    if (!comparaison) return '';
    if (comparaison.entrants.has(l.cle)) return 'nouveau';
    if (comparaison.reprises.has(l.cle)) return 'reprise';
    if (comparaison.modifies.has(l.cle)) return 'modifie';
    return String(l.Nom || l.Matricule || '').trim() ? 'inchange' : '';
  }, [comparaison]);

  const enErreur = cotisants.filter((l) => erreurs[l.cle]?.length).length;
  const aZero = cotisants.filter((l) => sansCotisation(l) && (String(l.Nom || '').trim() || String(l.Matricule || '').trim())).length;
  const filtres = [
    ['tous', 'Tous', cotisants.length],
    ...(comparaison ? [['nouveaux', 'Nouveaux', comparaison.entrants.size], ['reprises', 'Reprises', comparaison.reprises.size],
      ['modifies', 'Montants modifiés', comparaison.modifies.size]] : []),
    ...(aZero ? [['zero', 'Sans cotisation', aZero]] : []),
    ['erreurs', 'À corriger', enErreur],
  ];

  const visibles = useMemo(() => {
    const q = norme(recherche).trim();
    return cotisants.filter((l) => {
      if (filtre === 'nouveaux' && !comparaison?.entrants.has(l.cle)) return false;
      if (filtre === 'reprises' && !comparaison?.reprises.has(l.cle)) return false;
      if (filtre === 'modifies' && !comparaison?.modifies.has(l.cle)) return false;
      if (filtre === 'zero' && !sansCotisation(l)) return false;
      if (filtre === 'erreurs' && !erreurs[l.cle]?.length) return false;
      return !q || norme(`${l.Matricule} ${l.Nom} ${l.Prenoms}`).includes(q);
    });
  }, [cotisants, recherche, filtre, comparaison, erreurs]);

  const pages = Math.max(1, Math.ceil(visibles.length / PAR_PAGE));
  const chercher = (texte) => { setRecherche(texte); setPage(1); };
  const filtrer = (code) => { setFiltre(code); setPage(1); };
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const debut = (Math.min(page, pages) - 1) * PAR_PAGE;
  const pageLignes = visibles.slice(debut, debut + PAR_PAGE);

  const changer = useCallback((cle, champ, valeur) => {
    setCotisants((liste) => liste.map((l) => (l.cle === cle ? { ...l, [champ]: valeur } : l)));
  }, [setCotisants]);
  const retirer = useCallback((cle) => setCotisants((liste) => liste.filter((l) => l.cle !== cle)), [setCotisants]);
  const ajouter = (base = {}) => {
    const ligne = cotisantVide(base);
    setCotisants((liste) => [...liste, ligne]);
    setRecherche('');
    setFiltre('tous');
    setPage(Math.ceil((cotisants.length + 1) / PAR_PAGE));
    setFocusCle(Object.keys(base).length ? null : ligne.cle);
  };

  const totaux = useMemo(() => cotisants.reduce((t, l) => ({
    salarie: t.salarie + (Number(l.CotisationSalarie) || 0), employeur: t.employeur + (Number(l.CotisationEmployeur) || 0),
  }), { salarie: 0, employeur: 0 }), [cotisants]);

  return (
    <div>
      <div className="vie-kpis">
        <div className="vie-kpi"><div className="vie-kpi-libelle">Salariés</div><div className="vie-kpi-valeur">{cotisants.length}</div>
          {comparaison && (
            <div className="vie-kpi-detail">
              {compte(comparaison.entrants.size, 'nouveau', 'nouveaux')}, {compte(comparaison.reprises.size, 'reprise')}, {compte(comparaison.sortants.length, 'absent')}
            </div>
          )}</div>
        <div className="vie-kpi"><div className="vie-kpi-libelle">Part salariale</div><div className="vie-kpi-valeur">{fcfa(totaux.salarie)} F</div></div>
        <div className="vie-kpi"><div className="vie-kpi-libelle">Part employeur</div><div className="vie-kpi-valeur">{fcfa(totaux.employeur)} F</div></div>
        <div className="vie-kpi accent"><div className="vie-kpi-libelle">Total des cotisations</div><div className="vie-kpi-valeur">{fcfa(totaux.salarie + totaux.employeur)} F</div>
          {comparaison && (
            <div className={`vie-kpi-detail ${comparaison.ecart >= 0 ? 'vie-hausse' : 'vie-baisse'}`}>
              {fcfaSigne(comparaison.ecart)} F sur {precedent?.LibelleMois}
            </div>
          )}
        </div>
      </div>

      <div className="vie-outils">
        <label className="vie-recherche">
          <Search size={15} />
          <input type="search" className="form-control" placeholder="Matricule, nom ou prénoms" value={recherche} onChange={(e) => chercher(e.target.value)} aria-label="Rechercher un salarié" />
        </label>
        <div className="vie-filtres" role="group" aria-label="Filtrer les salariés">
          {filtres.map(([code, libelle, nombre]) => (
            <button key={code} type="button" className="vie-filtre" aria-pressed={filtre === code} onClick={() => filtrer(code)}>
              {libelle} <span className="vie-compte">{nombre}</span>
            </button>
          ))}
        </div>
        {!lectureSeule && (
          <div className="vie-outils-droite">
            {precedent && onReprendrePrecedent && (
              <button type="button" className="btn btn-secondary" onClick={onReprendrePrecedent} disabled={chargementPrecedent}
                title={`Reprendre les ${precedent.Cotisants.length} salariés et leurs cotisations de ${precedent.LibelleMois}, puis ajuster`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                {chargementPrecedent ? <Loader2 size={15} className="spin" /> : <History size={15} />} Reprendre {precedent.LibelleMois}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => ajouter()} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <Plus size={15} /> Ajouter un salarié
            </button>
          </div>
        )}
      </div>

      {cotisants.length === 0 ? (
        <div className="vie-table-zone">
          <div className="vie-vide">
            <Users size={30} />
            <strong style={{ color: 'var(--text-primary)' }}>Aucun salarié dans l'état</strong>
            <span>
              {onReprendrePrecedent
                ? `Importez l'état Excel du mois${precedent ? `, reprenez celui de ${precedent.LibelleMois}` : ''} ou ajoutez les salariés un à un.`
                : "Importez l'état Excel du mois reçu du souscripteur : chaque mois se renouvelle avec son fichier."}
            </span>
          </div>
        </div>
      ) : (
        <div className="vie-table-zone">
          <table className="vie-table">
            <thead>
              <tr>
                <th className="col-num">N°</th><th className="col-mat">Matricule</th><th className="col-nom">Nom</th><th className="col-prenoms">Prénoms</th>
                <th className="col-montant droite">Part salariale</th><th className="col-montant droite">Part employeur</th><th className="col-total droite">Total</th>
                {comparaison && <th className="col-ecart droite">Écart sur {precedent?.LibelleMois?.split(' ')[0]}</th>}
                <th className="col-obs">Observation</th><th className="col-act" aria-label="Retirer" />
              </tr>
            </thead>
            <tbody>
              {pageLignes.map((l) => (
                <LigneSalarie key={l.cle} ligne={l} numero={numeros.get(l.cle)} problemes={(erreurs[l.cle] || []).join(', ')}
                  ancienne={comparaison?.modifies.has(l.cle) ? comparaison.parCle.get(cleSalarie(l)) || null : null}
                  statut={statut(l)} comparer={Boolean(comparaison)} lectureSeule={lectureSeule} focus={focusCle === l.cle}
                  onChanger={changer} onRetirer={retirer} />
              ))}
              {pageLignes.length === 0 && (
                <tr><td colSpan={comparaison ? 10 : 9}><div className="vie-vide" style={{ padding: '1.4rem' }}>Aucun salarié ne correspond à la recherche.</div></td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>{cotisants.length} salarié{cotisants.length > 1 ? 's' : ''}</td>
                <td className="droite">{fcfa(totaux.salarie)}</td>
                <td className="droite">{fcfa(totaux.employeur)}</td>
                <td className="droite">{fcfa(totaux.salarie + totaux.employeur)}</td>
                {comparaison && <td className={`droite ${comparaison.ecart >= 0 ? 'vie-hausse' : 'vie-baisse'}`}>{fcfaSigne(comparaison.ecart)}</td>}
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {visibles.length > PAR_PAGE && (
        <nav className="vie-pagination" aria-label="Pages du tableau">
          <span>Salariés {debut + 1} à {Math.min(debut + PAR_PAGE, visibles.length)} sur {visibles.length}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Page précédente"><ChevronLeft size={15} /></button>
            Page {Math.min(page, pages)} / {pages}
            <button type="button" className="btn btn-secondary" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} aria-label="Page suivante"><ChevronRight size={15} /></button>
          </span>
        </nav>
      )}

      {comparaison?.sortants.length > 0 && (
        <details className="vie-sortants">
          <summary>
            <UserMinus size={15} color="var(--accent-rose)" /> {comparaison.sortants.length} salarié{comparaison.sortants.length > 1 ? 's' : ''} de {precedent?.LibelleMois} absent{comparaison.sortants.length > 1 ? 's' : ''} de cet état
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> - sans cotisation ce mois ou sortis ; réintégrez-les seulement s'ils figurent dans l'état du souscripteur</span>
          </summary>
          <ul>
            {comparaison.sortants.map((s) => (
              <li key={`${s.Matricule}-${s.Nom}-${s.Prenoms}`}>
                <span><strong>{s.Nom}</strong> {s.Prenoms}{s.Matricule ? ` - ${s.Matricule}` : ''} <span style={{ color: 'var(--text-muted)' }}>· {fcfa(totalSalarie(s))} F</span></span>
                {!lectureSeule && (
                  <button type="button" className="btn btn-link" style={{ padding: 0, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                    onClick={() => ajouter({ Matricule: s.Matricule, Nom: s.Nom, Prenoms: s.Prenoms, CotisationSalarie: s.CotisationSalarie, CotisationEmployeur: s.CotisationEmployeur })}
                    title={`Remettre ${s.Nom} dans l'état avec ses cotisations de ${precedent?.LibelleMois}`}>
                    <Undo2 size={13} /> Réintégrer
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

export default EtatCotisations;
