import React, { useState } from 'react';
import { ChevronDown, CircleCheck } from 'lucide-react';
import { Badge, TONS, decimal, entier, francsCourts } from './rafasCommun';

/* Contrôles de la période (partie IV de l'étude : incohérences de l'effectif et des dépenses, médecins et patients atypiques) et plafonds
   du barème sur l'exercice. Chaque constat est à instruire avec le gestionnaire : aucun n'est une décision. */

const FILTRES = [['tous', 'Tous'], ['critique', 'À traiter en priorité'], ['attention', 'À vérifier'], ['info', 'Pour information']];
const ORDRE = { critique: 0, attention: 1, info: 2 };

const valeur = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? entier(v) : decimal(v, 2)) : v);

const Controle = ({ k, ouvert, onBasculer }) => {
  const ton = TONS[k.Gravite] || TONS.info;
  return (
    <section className={`glass-panel rafas-controle ton-${k.Gravite}${ouvert ? ' ouvert' : ''}`}>
      <button type="button" className="rafas-controle-tete" onClick={onBasculer} aria-expanded={ouvert}>
        <ton.icone size={18} aria-hidden="true" />
        <span className="rafas-controle-titre"><strong>{k.Titre}</strong><span>{k.Description}</span></span>
        <span className="rafas-controle-chiffres">
          <strong>{entier(k.Nombre)}</strong>
          {k.Montant ? <span>{francsCourts(k.Montant)}</span> : null}
        </span>
        <ChevronDown size={18} className="rafas-controle-chevron" aria-hidden="true" />
      </button>
      {ouvert && (
        <div className="rafas-controle-corps">
          <p className="rafas-action"><strong>Action à mener :</strong> {k.Action}</p>
          <div className="table-wrapper rafas-tableau compact">
            <table className="data-table">
              <thead><tr>{k.Colonnes.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{k.Lignes.map((l, i) => <tr key={i}>{l.map((v, j) => <td key={j} className={typeof v === 'number' ? 'cs-nombre' : undefined}>{valeur(v)}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {k.Tronque && <p className="cs-note">{`${entier(k.Lignes.length)} premiers cas affichés sur ${entier(k.Nombre)}.`}</p>}
        </div>
      )}
    </section>
  );
};

const OngletControles = ({ donnees: a }) => {
  const [filtre, setFiltre] = useState('tous');
  const [ouverts, setOuverts] = useState({});
  const avec = a.Controles.filter((k) => k.Nombre).sort((x, y) => ORDRE[x.Gravite] - ORDRE[y.Gravite]);
  const sans = a.Controles.filter((k) => !k.Nombre);
  const visibles = avec.filter((k) => filtre === 'tous' || k.Gravite === filtre);
  return (
    <div className="cs-pile">
      <div className="glass-panel cs-filtres">
        <div className="rafas-puces" role="group" aria-label="Gravité">
          {FILTRES.map(([cle, libelle]) => (
            <button key={cle} type="button" className={`rafas-puce${filtre === cle ? ' active' : ''}`} aria-pressed={filtre === cle} onClick={() => setFiltre(cle)}>
              {`${libelle} (${cle === 'tous' ? avec.length : avec.filter((k) => k.Gravite === cle).length})`}
            </button>
          ))}
        </div>
        <p className="cs-filtres-note">Effectif et dépenses de la période ; plafonds de la famille, de l'optique et du dentaire, et quota d'alerte, sur l'exercice de la fin de période.</p>
      </div>
      {visibles.map((k) => <Controle key={k.Code} k={k} ouvert={!!ouverts[k.Code]} onBasculer={() => setOuverts((o) => ({ ...o, [k.Code]: !o[k.Code] }))} />)}
      {sans.length > 0 && (
        <div className="glass-panel cs-carte">
          <h2 className="rafas-sous-titre" style={{ margin: 0 }}>Sans constat sur la période</h2>
          <div className="rafas-convention-badges">{sans.map((k) => <Badge key={k.Code} ton="bon" icone={CircleCheck}>{k.Titre}</Badge>)}</div>
        </div>
      )}
    </div>
  );
};

export default OngletControles;
