import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Search } from 'lucide-react';
import { ADMIN_MENU } from '../../components/layout/adminMenu';
import { useAuth } from '../../context/AuthContext';

// Recherche sans tenir compte des accents ni des majuscules
const normaliser = (texte) => String(texte || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase();

/**
 * Guide de l'administration : le plan de l'espace Direction, groupe par groupe,
 * avec ce que contient chaque écran (même source que le menu latéral).
 */
export const AdminGuidePage = () => {
  const { peut } = useAuth();
  const [recherche, setRecherche] = useState('');

  const groupes = useMemo(() => {
    const termes = normaliser(recherche).split(/\s+/).filter(Boolean);
    return ADMIN_MENU
      .map((groupe) => ({
        ...groupe,
        items: groupe.items.filter((item) => {
          if (item.droit && !peut(item.droit)) return false;
          const texte = normaliser(`${groupe.titre} ${item.branche || ''} ${item.label} ${item.description}`);
          return termes.length === 0 || termes.every((t) => texte.includes(t));
        }),
      }))
      .filter((groupe) => groupe.items.length > 0);
  }, [peut, recherche]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1200px', margin: '0 auto', paddingBottom: '3rem' }}>
      <div>
        <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Compass size={26} color="#a78bfa" />
          Guide de l'administration
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '760px' }}>
          L'espace administration est rangé en {groupes.length} groupes, dans le même ordre que le menu de gauche.
          Chaque carte explique ce que contient l'écran ; cliquez dessus pour l'ouvrir.
        </p>
      </div>

      <div style={{ position: 'relative', maxWidth: '520px' }}>
        <Search size={16} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          className="form-control"
          placeholder="Que cherchez-vous ? (ex. taxe, reversement, marque, profil…)"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          style={{ paddingLeft: '2.3rem' }}
        />
      </div>

      {groupes.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>Aucun écran ne correspond à « {recherche} ».</p>
      )}

      {groupes.map((groupe, index) => (
        <section key={groupe.id} className="glass-panel" style={{ padding: '1.5rem', borderRadius: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#a78bfa' }}>{ADMIN_MENU.findIndex((g) => g.id === groupe.id) + 1 || index + 1}.</span>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>{groupe.titre}</h2>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{groupe.description}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.85rem' }}>
            {groupe.items.map((item) => {
              const Icone = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  style={{
                    display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.9rem 1rem', borderRadius: '10px',
                    border: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.02)', textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <Icone size={20} color="#a78bfa" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    {item.branche && <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{item.branche}</div>}
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{item.label}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem', lineHeight: 1.4 }}>{item.description}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};

export default AdminGuidePage;
