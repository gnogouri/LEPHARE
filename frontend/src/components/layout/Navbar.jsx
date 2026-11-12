import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Shield, LogOut, Compass, Settings, Menu, Sun, Moon, KeyRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cashApi, cockpitApi } from '../../api/endpoints';
import { ChangementMotDePasse } from '../securite/ChangementMotDePasse';
import { premierEcranAdmin } from './adminMenu';
import { ClocheNotifications } from './ClocheNotifications';

export const Navbar = ({ onToggleMobileSidebar }) => {
  const { user, activeSpace, switchSpace, logout, accesAdministration, peut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [changementMotDePasse, setChangementMotDePasse] = useState(false);
  const voitCaisse = peut('encaissements.view');

  // Chèques de l'échéancier à déposer d'ici un mois ou échus, relus toutes les 10 minutes
  const [alertesCheques, setAlertesCheques] = useState(0);
  useEffect(() => {
    if (!voitCaisse) return undefined;
    let actif = true;
    const charger = () => cashApi.getChequesAlertes()
      .then((liste) => { if (actif) setAlertesCheques(Array.isArray(liste) ? liste.length : 0); })
      .catch(() => {});
    charger();
    const minuterie = setInterval(charger, 10 * 60 * 1000);
    return () => { actif = false; clearInterval(minuterie); };
  }, [voitCaisse]);

  // Devis arrivant à échéance ou échus récemment (cloche) : relus toutes les 5 minutes, au retour sur l'onglet et
  // à chaque changement d'écran (un devis confirmé ou modifié sort de la liste)
  const voitDevis = peut('devis.view');
  const { pathname } = useLocation();
  const [alertesDevis, setAlertesDevis] = useState(null);
  useEffect(() => {
    if (!voitDevis) { setAlertesDevis(null); return undefined; }
    let actif = true;
    const charger = () => cockpitApi.alertes()
      .then((d) => { if (actif) setAlertesDevis(d?.Devis || null); })
      .catch(() => {});
    charger();
    const minuterie = setInterval(charger, 5 * 60 * 1000);
    const auRetour = () => { if (document.visibilityState === 'visible') charger(); };
    document.addEventListener('visibilitychange', auRetour);
    return () => { actif = false; clearInterval(minuterie); document.removeEventListener('visibilitychange', auRetour); };
  }, [voitDevis, pathname]);

  // Bascule Production / Administration : seulement si au moins un écran d'administration est permis
  const isPrivileged = accesAdministration;

  const handleSpaceChange = (space) => {
    switchSpace(space);
    if (space === 'admin') {
      navigate(premierEcranAdmin(peut));
    } else {
      navigate('/user/dashboard');
    }
  };

  return (
    <header
      className="navbar-container"
      style={{
        height: 'var(--navbar-height)',
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.75rem',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      {/* Left: Hamburger (mobile) + Brand Identity + Space Switcher */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {/* Mobile Sidebar Hamburger Toggle */}
        <button
          className="mobile-toggle-btn sidebar-toggle-btn"
          onClick={onToggleMobileSidebar}
          aria-label="Afficher / masquer le menu"
          title="Afficher / masquer le menu"
        >
          <Menu size={22} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer' }} onClick={() => navigate('/')}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 2px 6px rgba(37,99,235,0.3)',
              flexShrink: 0,
            }}
          >
            <Shield size={18} />
          </div>
          <div className="brand-nom">
            <span style={{ fontWeight: 800, fontSize: '0.975rem', letterSpacing: '-0.02em', color: 'var(--text-primary)', display: 'block', lineHeight: 1.1 }}>
              LE PHARE
            </span>
            <div className="brand-subtext" style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: '2px' }}>
              Courtage & Sinistres Délégués
            </div>
          </div>
        </div>

        {/* Global Workspace Mode Switcher - Réservé exclusivement au Directeur ou Administrateur */}
        {isPrivileged && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--bg-surface-elevated)',
              padding: '2px',
              borderRadius: '9999px',
              border: '1px solid var(--border-medium)',
              marginLeft: '0.75rem',
            }}
          >
            <button
              className="nav-space-btn"
              onClick={() => handleSpaceChange('user')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                border: 'none',
                fontSize: '0.725rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s',
                background: activeSpace === 'user' ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : 'transparent',
                color: activeSpace === 'user' ? '#fff' : 'var(--text-secondary)',
                boxShadow: activeSpace === 'user' ? '0 1px 4px rgba(37,99,235,0.3)' : 'none',
              }}
            >
              <Compass size={13} />
              <span>Opérateur</span>
            </button>

            <button
              className="nav-space-btn"
              onClick={() => handleSpaceChange('admin')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                border: 'none',
                fontSize: '0.725rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s',
                background: activeSpace === 'admin' ? 'linear-gradient(135deg, #8b5cf6, #6d28d9)' : 'transparent',
                color: activeSpace === 'admin' ? '#fff' : 'var(--text-secondary)',
                boxShadow: activeSpace === 'admin' ? '0 1px 4px rgba(139,92,246,0.3)' : 'none',
              }}
            >
              <Settings size={13} />
              <span>Admin</span>
            </button>
          </div>
        )}
      </div>

      {/* Right: Theme Toggle, Notifications & User Profile */}
      <div className="nav-droite" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
        {/* Theme Toggle Button (Light / Dark) */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
          aria-label="Basculer le thème clair / sombre"
          style={{
            position: 'relative',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            width: '32px',
            height: '32px',
            borderRadius: '9999px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'all var(--transition-fast)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {theme === 'dark' ? (
            <Sun size={15} color="#fbbf24" />
          ) : (
            <Moon size={15} color="#6366f1" />
          )}
        </button>

        {/* Cloche : messages de la session (chaque notification l'incrémente) et chèques à déposer */}
        <ClocheNotifications alertesCheques={alertesCheques} voitCaisse={voitCaisse} alertesDevis={alertesDevis} />

        {/* User Card */}
        <div
          className="nav-carte-utilisateur"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.55rem',
            padding: '0.2rem 0.55rem',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: isPrivileged ? 'linear-gradient(135deg, #8b5cf6, #3b82f6)' : 'linear-gradient(135deg, #059669, #0ea5e9)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '0.7rem',
              flexShrink: 0,
            }}
          >
            {user?.avatar || 'LP'}
          </div>

          <div className="nav-user-text" style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.775rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              {user ? (user.name || user.email) : 'Invité'}
            </span>
            <span style={{ fontSize: '0.625rem', color: isPrivileged ? '#c084fc' : '#60a5fa' }}>
              {user?.role_label || 'Aucun rôle'}
            </span>
          </div>

          <button
            onClick={() => setChangementMotDePasse(true)}
            title="Changer mon mot de passe"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', marginLeft: '0.2rem', padding: '0.15rem', borderRadius: '4px' }}
          >
            <KeyRound size={14} />
          </button>
          <button
            onClick={async () => { await logout(); navigate('/login', { replace: true }); }}
            title="Déconnexion"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              marginLeft: '0.2rem',
              padding: '0.15rem',
              borderRadius: '4px',
            }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
      {changementMotDePasse && <ChangementMotDePasse onFermer={() => setChangementMotDePasse(false)} />}
    </header>
  );
};

export default Navbar;
