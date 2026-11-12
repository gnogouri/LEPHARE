import React from 'react';
import { AlertTriangle, ArrowLeftRight, Building2, CalendarDays, FileSpreadsheet, ShieldCheck, X } from 'lucide-react';
import { Modal } from '../../../../components/common/Modal';
import { compte, fcfa, fcfaSigne, libelleMois } from './vieCommun';

/* Résultat de la lecture d'un état des cotisations (POST /api/afa/retraite/analyse/) : rien n'est enregistré avant
   « Enregistrer le devis ». Mois, souscripteur et police reconnus, totaux, écarts avec l'état précédent, contrôles. */

const Liste = ({ titre, lignes, rendu }) => (lignes?.length ? (
  <details>
    <summary>{titre} · {lignes.length}</summary>
    <ol>{lignes.slice(0, 200).map((l) => <li key={`${l.Matricule}-${l.Nom}-${l.Prenoms}`}>{rendu(l)}</li>)}</ol>
  </details>
) : null);

export const ImportEtatModal = ({ analyse, onFermer, onReprendre, lignesActuelles }) => {
  const a = analyse;
  const police = a?.Polices?.find((p) => p.Mensuelle) || null;
  const c = a?.Comparaison;
  return (
    <Modal isOpen={Boolean(a)} onClose={onFermer} title="État des cotisations importé"
      subtitle={a ? `${a.Titre || a.Feuille} - rien n'est enregistré avant « Enregistrer le devis »` : ''} maxWidth="940px">
      {a && (
        // Fenêtre affichée hors de la page : les couleurs de la branche (--vie) sont redéfinies ici
        <div className="vie-page" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div className="vie-kpis">
            <div className="vie-kpi accent"><div className="vie-kpi-libelle">Mois</div><div className="vie-kpi-valeur" style={{ textTransform: 'capitalize' }}>{a.LibelleMois || 'À choisir'}</div></div>
            <div className="vie-kpi"><div className="vie-kpi-libelle">Salariés</div><div className="vie-kpi-valeur">{a.Totaux.Salaries}</div></div>
            <div className="vie-kpi"><div className="vie-kpi-libelle">Part salariale</div><div className="vie-kpi-valeur">{fcfa(a.Totaux.Salarie)} F</div></div>
            <div className="vie-kpi"><div className="vie-kpi-libelle">Part employeur</div><div className="vie-kpi-valeur">{fcfa(a.Totaux.Employeur)} F</div></div>
            <div className="vie-kpi accent"><div className="vie-kpi-libelle">Total</div><div className="vie-kpi-valeur">{fcfa(a.Totaux.Total)} F</div></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '0.65rem', fontSize: '0.84rem' }}>
            <div className="vie-suggestion" style={{ animation: 'none' }}>
              <Building2 size={18} color="var(--vie)" />
              <span>
                Souscripteur : <strong>{a.Souscripteur?.Nom || a.Employeur || 'non indiqué'}</strong>
                {a.Souscripteur?.IdClient ? ` - client n° ${a.Souscripteur.IdClient}` : a.Employeur ? ' - aucun client à ce nom : choisissez-le' : ' - choisissez-le à l\'écran'}
              </span>
            </div>
            <div className="vie-suggestion" style={{ animation: 'none' }}>
              <ShieldCheck size={18} color="var(--vie)" />
              <span>
                {police ? (
                  <>Police <strong>{police.NumeroPolice}</strong> - {police.Compagnie}, dernier mois {libelleMois(police.DateEffet)} : l'état la renouvelle pour {a.LibelleMois || 'le mois choisi'}.</>
                ) : 'Aucune police mensuelle pour ce souscripteur : le devis sera une affaire nouvelle.'}
              </span>
            </div>
          </div>

          {c ? (
            <div className="vie-comparaison">
              <div className="vie-comparaison-titre">
                <ArrowLeftRight size={16} color="var(--vie)" /> Comparé à l'état de {c.LibelleMois}
                <span className="vie-etiquette">{c.NumeroDevis}{c.Confirme ? ' · confirmé' : ''}</span>
              </div>
              <div className="vie-offre-etiquettes">
                <span className="vie-etiquette vert">{compte(c.Entrants.length, 'nouveau', 'nouveaux')}</span>
                <span className="vie-etiquette accent" title="Absents de l'état précédent, ils avaient déjà cotisé avant">{compte((c.Reprises || []).length, 'reprise')}</span>
                <span className="vie-etiquette rose" title="Dans l'état précédent, absents de celui-ci : sans cotisation ce mois ou sortis">{compte(c.Sortants.length, 'absent')}</span>
                {(c.SansCotisation || []).length > 0 && <span className="vie-etiquette">{compte(c.SansCotisation.length, 'salarié')} à 0 F</span>}
                <span className="vie-etiquette ambre">{c.Modifies.length} montant{c.Modifies.length > 1 ? 's' : ''} modifié{c.Modifies.length > 1 ? 's' : ''}</span>
                <span className={`vie-etiquette ${c.Ecart >= 0 ? 'vert' : 'rose'}`}>
                  {fcfaSigne(c.Ecart)} F{c.Total ? ` · ${(c.Ecart / c.Total * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1, signDisplay: 'always' })} %` : ''}
                </span>
              </div>
              <Liste titre="Nouveaux salariés" lignes={c.Entrants} rendu={(l) => `${l.Nom} ${l.Prenoms} - ${l.Matricule || 'sans matricule'}`} />
              <Liste titre="Reprises des cotisations" lignes={c.Reprises} rendu={(l) => `${l.Nom} ${l.Prenoms} - ${l.Matricule || 'sans matricule'}`} />
              <Liste titre="Absents de cet état, sans cotisation ce mois ou sortis" lignes={c.Sortants} rendu={(l) => `${l.Nom} ${l.Prenoms} - ${l.Matricule || 'sans matricule'}`} />
              <Liste titre="Présents sans cotisation (0 F)" lignes={c.SansCotisation} rendu={(l) => `${l.Nom} ${l.Prenoms} - ${l.Matricule || 'sans matricule'}`} />
              <Liste titre="Montants modifiés" lignes={c.Modifies}
                rendu={(l) => `${l.Nom} ${l.Prenoms} : salarié ${fcfa(l.AncienneSalarie)} → ${fcfa(l.CotisationSalarie)}, employeur ${fcfa(l.AncienneEmployeur)} → ${fcfa(l.CotisationEmployeur)}`} />
            </div>
          ) : (
            <p className="vie-depot-aide" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <CalendarDays size={14} /> Aucun état précédent enregistré pour ce souscripteur : la comparaison mois par mois commencera avec celui-ci.
            </p>
          )}

          {[...a.Erreurs.map((m) => ['erreur', m]), ...a.Avertissements.map((m) => ['', m])].map(([ton, m]) => (
            <p key={m} className={`vie-message ${ton}`} style={{ margin: 0, display: 'flex' }}><AlertTriangle size={13} /> {m}</p>
          ))}

          {a.Lignes.some((l) => l.Erreurs.length || l.Avertissements.length) && (
            <div className="vie-table-zone" style={{ maxHeight: 220 }}>
              <table className="vie-table">
                <thead><tr><th>Ligne</th><th>Salarié</th><th>Contrôles</th></tr></thead>
                <tbody>
                  {a.Lignes.filter((l) => l.Erreurs.length || l.Avertissements.length).map((l) => (
                    <tr key={l.Ligne}>
                      <td>{l.Ligne}</td>
                      <td>{`${l.Nom} ${l.Prenoms}`.trim() || '-'}{l.Matricule ? ` - ${l.Matricule}` : ''}</td>
                      <td>
                        {l.Erreurs.map((m) => <div key={m} className="vie-message erreur">{m}</div>)}
                        {l.Avertissements.map((m) => <div key={m} className="vie-message">{m}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={onFermer} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><X size={15} /> Fermer</button>
            {lignesActuelles > 0 && (
              <button type="button" className="btn btn-secondary" onClick={() => onReprendre(false)}>Ajouter à l'état actuel</button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => onReprendre(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: 'var(--vie)', borderColor: 'var(--vie)' }}>
              <FileSpreadsheet size={15} /> {lignesActuelles ? "Remplacer l'état" : "Reprendre l'état"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default ImportEtatModal;
