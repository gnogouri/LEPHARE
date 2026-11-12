import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import { contractApi } from '../../../api/endpoints';

const jma = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const NOM_PRODUIT = { IA: "L'IA MINENE", RC: 'La RC chef de famille MINENE' };

// N° de police Santé MINENE d'un devis IA ou RC chef de famille MINENE (police connexe). Propose les polices
// dont le numéro ou le client contient le texte saisi, puis lit la police (période la plus récente : une police
// renouvelée garde son numéro) et la passe une fois à l'écran (onPolice) pour qu'il reprenne ce qu'il a en commun
// avec elle : client, date d'effet, échéance, durée. Signale l'IA ou la RC déjà rattachée (produit : 'IA' | 'RC').
// production/minene_connexes.py (GET /api/minene/police/).
export default function PoliceMineneConnexe({ value, onChange, onPolice, produit, libelle, disabled = false }) {
  const [suggestions, setSuggestions] = useState([]);
  const [ouverte, setOuverte] = useState(false);
  const [police, setPolice] = useState(null);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);
  const transmise = useRef('');
  const surPolice = useRef(onPolice);
  surPolice.current = onPolice;

  // Polices proposées pendant la saisie
  useEffect(() => {
    const texte = String(value || '').trim();
    if (!ouverte || texte.length < 3) { setSuggestions([]); return undefined; }
    let actif = true;
    const minuterie = setTimeout(() => {
      contractApi.rechercherPolicesMinene(texte)
        .then((liste) => { if (actif) setSuggestions(liste); })
        .catch(() => { if (actif) setSuggestions([]); });
    }, 300);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [value, ouverte]);

  // Police saisie : lue puis transmise à l'écran (une fois par numéro)
  useEffect(() => {
    const numero = String(value || '').trim();
    if (numero.length < 8) { setPolice(null); setErreur(''); return undefined; }
    let actif = true;
    const minuterie = setTimeout(() => {
      setChargement(true);
      contractApi.getPoliceMinene(numero)
        .then((p) => {
          if (!actif) return;
          setPolice(p);
          setErreur('');
          if (transmise.current !== p.NumeroPolice) {
            transmise.current = p.NumeroPolice;
            surPolice.current?.(p);
          }
        })
        .catch((err) => {
          if (!actif) return;
          setPolice(null);
          setErreur(err?.response?.status === 404
            ? `Aucun contrat Santé MINENE sous le n° ${numero}.`
            : 'Police Santé MINENE non vérifiée : serveur injoignable.');
        })
        .finally(() => { if (actif) setChargement(false); });
    }, 450);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [value]);

  const dejaLies = police && produit ? (police[produit] || []) : [];

  return (
    <div className="form-group" style={{ position: 'relative' }}>
      <label className="form-label">{libelle || 'N° de police Santé MINENE (* requis)'}</label>
      <div style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          className="form-control"
          style={{ paddingLeft: '2.1rem' }}
          value={value}
          disabled={disabled}
          placeholder="N° de police ou nom du client"
          onChange={(e) => { onChange(e.target.value); setOuverte(true); }}
          onFocus={() => setOuverte(true)}
          onBlur={() => setTimeout(() => setOuverte(false), 150)}
        />
      </div>
      {ouverte && suggestions.length > 0 && !(police && suggestions.length === 1 && suggestions[0].NumeroPolice === police.NumeroPolice) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--bg-surface-elevated, #1e293b)',
          border: '1px solid var(--border-subtle)', borderRadius: '6px', maxHeight: '240px', overflowY: 'auto', marginTop: '4px',
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.35)',
        }}>
          {suggestions.map((s) => (
            <div
              key={s.NumeroPolice}
              role="option"
              aria-selected={false}
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); onChange(s.NumeroPolice); setOuverte(false); }}
              style={{ padding: '0.55rem 0.9rem', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.84rem' }}
            >
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{s.NumeroPolice}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {s.Client} • du {jma(s.DateEffet)} au {jma(s.DateExpiration)} • {s.Adherents} adhérent{s.Adherents > 1 ? 's' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      {chargement && <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Lecture de la police Santé…</small>}
      {!chargement && police && (
        <small style={{ display: 'flex', alignItems: 'flex-start', gap: '0.35rem', color: 'var(--accent-emerald, #10b981)', fontSize: '0.76rem', marginTop: '0.3rem' }}>
          <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {police.Client} - du {jma(police.DateEffet)} au {jma(police.DateExpiration)} - {police.Adherents} adhérent{police.Adherents > 1 ? 's' : ''} :
            client, date d&apos;effet et échéance repris de la police Santé.
          </span>
        </small>
      )}
      {!chargement && dejaLies.length > 0 && (
        <small style={{ display: 'flex', alignItems: 'flex-start', gap: '0.35rem', color: 'var(--accent-amber, #f59e0b)', fontSize: '0.76rem', marginTop: '0.3rem' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {NOM_PRODUIT[produit]} est déjà rattachée à cette police :{' '}
            {dejaLies.map((l) => (l.NumeroPolice ? `contrat ${l.NumeroPolice}` : `devis ${l.NumeroDevis}${l.Confirme ? '' : ' (non confirmé)'}`)).join(', ')}.
          </span>
        </small>
      )}
      {!chargement && erreur && (
        <small style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--accent-amber, #f59e0b)', fontSize: '0.76rem', marginTop: '0.3rem' }}>
          <AlertTriangle size={14} /> {erreur}
        </small>
      )}
    </div>
  );
}
