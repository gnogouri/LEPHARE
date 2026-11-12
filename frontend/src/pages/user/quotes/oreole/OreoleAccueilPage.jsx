import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileSpreadsheet, HeartPulse, Loader2, Plus, RefreshCw, Search, User, Users, CreditCard } from 'lucide-react';
import { oreoleApi } from '../../../../api/endpoints';
import { useToast } from '../../../../context/ToastContext';
import { aLeDroit } from '../../../../utils/droits';
import { messageErreurApi } from '../../../../utils/financeUtils';
import { COULEUR, PastilleProduit, carte, dateFr, fcfa, titreCarte } from './oreoleCommun';

/* =========================================================================
   ORÉOLE SANTÉ : accueil de la branche. Trois entrées (une famille, un groupe, le classeur des effectifs)
   et la liste des polices avec ce qui reste à émettre sur chacune.
   ========================================================================= */

const ENTREES = (particuliers, entreprises) => [
  { cle: 'P', icone: User, titre: 'Une famille', texte: particuliers ? `Particuliers : ${particuliers}, assuré principal, conjoint et 4 enfants.` : 'Assuré principal, conjoint et 4 enfants.', action: 'Souscrire', vers: '/user/quotes/oreole-sante/nouveau?cible=P' },
  { cle: 'E', icone: Users, titre: 'Un groupe', texte: entreprises ? `Entreprises : ${entreprises}.` : 'Grille entreprises et prix négociés.', action: 'Souscrire', vers: '/user/quotes/oreole-sante/nouveau?cible=E' },
  { cle: 'F', icone: FileSpreadsheet, titre: 'Renouveler par fichier', texte: 'Le classeur des effectifs prépare un devis par entreprise, les anomalies sont signalées avant tout enregistrement.', action: 'Ouvrir', vers: '/user/quotes/oreole-sante/fichier' },
];

export default function OreoleAccueilPage() {
  const navigate = useNavigate();
  const { error: toastError } = useToast();
  const [polices, setPolices] = useState([]);
  const [offres, setOffres] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState('');

  useEffect(() => {
    oreoleApi.referentiels().then((r) => setOffres(r.Offres)).catch(() => {});
  }, []);

  useEffect(() => {
    let actif = true;
    const minuterie = setTimeout(() => {
      setChargement(true);
      oreoleApi.polices(recherche.trim())
        .then((r) => { if (actif) setPolices(r.Polices); })
        .catch((err) => { if (actif) toastError(`Polices indisponibles : ${messageErreurApi(err)}`); })
        .finally(() => { if (actif) setChargement(false); });
    }, 250);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [recherche]); // eslint-disable-line react-hooks/exhaustive-deps

  const fourchette = (cible) => {
    const prix = offres.filter((o) => o.Cible === cible).map((o) => o.Cotisation).sort((a, b) => a - b);
    if (!prix.length) return '';
    return prix.length === 1 ? `${fcfa(prix[0])} F` : `de ${fcfa(prix[0])} à ${fcfa(prix[prix.length - 1])} F`;
  };
  const entrees = useMemo(() => ENTREES(fourchette('P'), fourchette('E')), [offres]); // eslint-disable-line react-hooks/exhaustive-deps
  const ouvrir = (p) => navigate(p.IdContrat ? `/user/contracts/${p.IdContrat}` : `/user/quotes/oreole-sante/nouveau?edit=${p.IdDevis}`);

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}><HeartPulse size={26} color={COULEUR} /> Oreole Santé</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: 760, lineHeight: 1.55 }}>
            Un seul parcours pour la Santé MCI, l'Individuelle Accidents NSIA et l'Assistance funéraire ALLIANZ CI VIE : on saisit une fois, les trois polices sortent ensemble.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/user/quotes/oreole-sante/cartes')} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <CreditCard size={16} /> Cartes facturées
          </button>
          {aLeDroit('devis.create') && (
            <button type="button" className="btn btn-primary" onClick={() => navigate('/user/quotes/oreole-sante/nouveau')} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Plus size={16} /> Nouvelle souscription
            </button>
          )}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '0.8rem' }}>
        {entrees.filter(() => aLeDroit('devis.create')).map(({ cle, icone: Icone, titre, texte, action, vers }) => (
          <button key={cle} type="button" className="glass-panel carte-oreole" onClick={() => navigate(vers)} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', textAlign: 'left', padding: '1.05rem 1.1rem', borderRadius: 14, cursor: 'pointer', color: 'var(--text-primary)' }}>
            <Icone size={21} color={COULEUR} />
            <b style={{ fontSize: '0.98rem' }}>{titre}</b>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.45 }}>{texte}</span>
            <span style={{ marginTop: 'auto', paddingTop: '0.3rem', color: COULEUR, fontWeight: 700, fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>{action} <ArrowRight size={14} /></span>
          </button>
        ))}
      </div>
      <style>{`.carte-oreole { transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s; } .carte-oreole:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: ${COULEUR}; } @media (prefers-reduced-motion: reduce) { .carte-oreole { transition: none; } .carte-oreole:hover { transform: none; } }`}</style>

      <section className="glass-panel" style={carte}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.9rem' }}>
          <h2 style={{ ...titreCarte, margin: 0 }}><RefreshCw size={17} color={COULEUR} /> Polices et produits liés</h2>
          <div style={{ position: 'relative', flex: '0 1 300px' }}>
            <Search size={15} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="form-control" style={{ paddingLeft: '2rem' }} placeholder="Client, police ou devis" aria-label="Rechercher une police" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
          </div>
        </div>
        <div className="tableau-defilant" style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
          <table className="data-table" style={{ minWidth: 760, fontSize: '0.83rem' }}>
            <thead><tr><th>Souscripteur</th><th>Police ou devis</th><th>Offre</th><th style={{ textAlign: 'right' }}>Familles</th><th style={{ textAlign: 'right' }}>Cotisation</th><th>Période</th><th>Produits</th><th aria-label="Ouvrir" /></tr></thead>
            <tbody>
              {chargement && polices.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: '1.5rem' }}><Loader2 size={20} className="spin" style={{ color: COULEUR }} /></td></tr>}
              {!chargement && polices.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '1.8rem', color: 'var(--text-muted)' }}>
                  {recherche ? 'Aucune police ne correspond à cette recherche.' : 'Aucune souscription pour le moment : commencez par une famille, un groupe ou le classeur des effectifs.'}
                </td></tr>
              )}
              {polices.map((p) => (
                <tr key={p.IdDevis} onClick={() => ouvrir(p)} style={{ cursor: 'pointer' }}>
                  <td><b>{p.Client}</b></td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>{p.NumeroPolice || p.NumeroDevis}</td>
                  <td>{p.Offre}</td>
                  <td style={{ textAlign: 'right' }}>{p.Adherents}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fcfa(p.Cotisation)} F</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{dateFr(p.DateEffet)} au {dateFr(p.DateExpiration)}</td>
                  <td><span style={{ display: 'inline-flex', gap: '0.25rem' }}><PastilleProduit produit="Sante" etat={p.Sante} /><PastilleProduit produit="IA" etat={p.IA} /><PastilleProduit produit="AFA" etat={p.AFA} /></span></td>
                  <td style={{ textAlign: 'right' }}><ArrowRight size={15} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
