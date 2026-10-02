import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';
import { customerApi } from '../../api/endpoints';

// Champ de formulaire, recherche de client côté serveur (clientrecherche, comme URANUS : sans charger
// toute la clientèle) et fiche du client choisi. Utilisés par les devis Voyage et MRH.

const jour = (v) => (v ? String(v).slice(0, 10) : '');
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

const stylesChamp = {
  aide: { fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' },
  erreur: { fontSize: '0.75rem', color: 'var(--accent-rose)', marginTop: '0.3rem', fontWeight: 600 },
  listeDeroulante: {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--bg-surface-elevated)',
    border: '1px solid var(--border-medium)', borderRadius: '8px', maxHeight: '240px', overflowY: 'auto',
    marginTop: '4px', boxShadow: 'var(--shadow-lg)',
  },
  elementListe: { padding: '0.55rem 0.85rem', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.84rem' },
};

// Client renvoyé par clientrecherche, un devis ou la fiche client normalisée -> personne affichée
export const personneDepuisClient = (c) => {
  if (!c) return null;
  const telephone = [c.Telephone, c.Mobile].find((t) => t && t.length > 2 && t !== 'NA') || '';
  return {
    IdClient: Number(c.IdClient || c.id),
    Nom: (c.Nom && c.Prenoms ? `${c.Nom} ${c.Prenoms}` : (c.Nom || c.nomcomplet || '')).trim(),
    Telephone: c.Telephone !== undefined ? telephone : (c.telephone || c.mobile || ''),
    Adresse: c.Adresse ?? c.Adresse1 ?? c.adresse ?? '',
    AdresseGeographique: c.AdresseGeographique ?? c.Adresse2 ?? '',
    DateNaissance: jour(c.DateNaissance || c.date_naissance),
  };
};

export const Champ = ({ label, requis, aide, erreur, children, large }) => (
  <div className="form-group" style={{ margin: 0, ...(large ? { gridColumn: '1 / -1' } : {}) }}>
    <label className="form-label">{label}{requis && <span style={{ color: 'var(--accent-rose)' }}> *</span>}</label>
    {children}
    {erreur ? <div style={stylesChamp.erreur}>{erreur}</div> : aide ? <div style={stylesChamp.aide}>{aide}</div> : null}
  </div>
);

export const RechercheClient = ({ label, personne, onChoisir, onNouveau, erreur }) => {
  const [terme, setTerme] = useState(personne?.Nom || '');
  const [resultats, setResultats] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState(false);
  const zone = useRef(null);

  useEffect(() => { setTerme(personne?.Nom || ''); }, [personne?.IdClient, personne?.Nom]);

  useEffect(() => {
    const t = terme.trim();
    if (t.length < 2 || t === (personne?.Nom || '')) { setResultats([]); return undefined; }
    let actif = true;
    const minuterie = setTimeout(async () => {
      setRecherche(true);
      try {
        const liste = await customerApi.searchClient(encodeURIComponent(t));
        if (actif) { setResultats(Array.isArray(liste) ? liste.slice(0, 40) : []); setOuvert(true); }
      } catch {
        if (actif) setResultats([]);
      } finally {
        if (actif) setRecherche(false);
      }
    }, 350);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [terme, personne?.Nom]);

  useEffect(() => {
    const fermer = (e) => { if (zone.current && !zone.current.contains(e.target)) setOuvert(false); };
    document.addEventListener('mousedown', fermer);
    return () => document.removeEventListener('mousedown', fermer);
  }, []);

  return (
    <Champ label={label} requis erreur={erreur} aide={personne ? `Client n° ${personne.IdClient}` : 'Saisissez au moins 2 lettres du nom'}>
      <div ref={zone} style={{ position: 'relative', display: 'flex', gap: '0.5rem' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text"
            className="form-control"
            value={terme}
            onChange={(e) => { setTerme(e.target.value); if (!e.target.value) onChoisir(null); }}
            onFocus={() => resultats.length && setOuvert(true)}
            placeholder="Rechercher un client…"
            style={{ paddingRight: '2.2rem' }}
          />
          <span style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}>
            {recherche ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
          </span>
          {ouvert && resultats.length > 0 && (
            <div style={stylesChamp.listeDeroulante}>
              {resultats.map((c) => (
                <div key={c.IdClient} style={stylesChamp.elementListe} onMouseDown={() => { onChoisir(personneDepuisClient(c)); setOuvert(false); }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{`${c.Nom || ''} ${c.Prenoms || ''}`.trim()}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    {[c.Mobile && c.Mobile !== 'NA' ? c.Mobile : null, c.Adresse1, c.DateNaissance ? `né(e) le ${dateFr(c.DateNaissance)}` : null].filter(Boolean).join(' • ') || `Client n° ${c.IdClient}`}
                  </div>
                </div>
              ))}
            </div>
          )}
          {ouvert && !recherche && terme.trim().length >= 2 && resultats.length === 0 && terme !== personne?.Nom && (
            <div style={{ ...stylesChamp.listeDeroulante, padding: '0.7rem 0.85rem', fontSize: '0.84rem', color: 'var(--text-muted)' }}>Aucun client trouvé.</div>
          )}
        </div>
        {onNouveau && (
          <button type="button" className="btn btn-secondary" onClick={onNouveau} title="Nouveau client" style={{ padding: '0 0.75rem' }}>
            <Plus size={16} />
          </button>
        )}
      </div>
    </Champ>
  );
};

export const FichePersonne = ({ personne }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '0.5rem 1rem', padding: '0.85rem 1rem', borderRadius: '10px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', fontSize: '0.82rem' }}>
    <div><span style={{ color: 'var(--text-muted)' }}>Téléphone</span><div style={{ fontWeight: 600 }}>{personne.Telephone ? `+225 ${personne.Telephone}` : '—'}</div></div>
    <div><span style={{ color: 'var(--text-muted)' }}>Adresse</span><div style={{ fontWeight: 600 }}>{personne.Adresse || '—'}</div></div>
    <div><span style={{ color: 'var(--text-muted)' }}>Adresse géographique</span><div style={{ fontWeight: 600 }}>{personne.AdresseGeographique || '—'}</div></div>
    <div><span style={{ color: 'var(--text-muted)' }}>Date de naissance</span><div style={{ fontWeight: 600 }}>{dateFr(personne.DateNaissance)}</div></div>
  </div>
);
