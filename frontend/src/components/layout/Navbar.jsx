import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Shield, User, LogOut, Bell, Compass, Settings, Menu, Sun, Moon, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { dataStore } from '../../api/dataStore';
import { authApi, cashApi } from '../../api/endpoints';
import { sortUniqueBy } from '../../utils/sortUtils';

export const Navbar = ({ onToggleMobileSidebar }) => {
  const { user, activeSpace, switchSpace, logout, isDirectorOrAdmin, canSwitchSpace, switchUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [availableUsers, setAvailableUsers] = useState(() => dataStore.getUsers());
  // Chèques de l'échéancier à déposer d'ici un mois ou échus, relus toutes les 10 minutes
  const [alertesCheques, setAlertesCheques] = useState(0);
  useEffect(() => {
    let actif = true;
    const charger = () => cashApi.getChequesAlertes()
      .then((liste) => { if (actif) setAlertesCheques(Array.isArray(liste) ? liste.length : 0); })
      .catch(() => {});
    charger();
    const minuterie = setInterval(charger, 10 * 60 * 1000);
    return () => { actif = false; clearInterval(minuterie); };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadRealUsers = async () => {
      try {
        const list = await authApi.getProfiles();
        if (isMounted && Array.isArray(list) && list.length > 0) {
          const mapped = list.map((u) => ({
            id: u.id,
            username: u.email || u.nom,
            first_name: u.nom || (u.email ? u.email.split('@')[0] : 'Utilisateur'),
            role_code: u.is_admin ? 'ADMIN' : 'USER',
            role: u.is_admin ? 'Directeur / Admin' : 'Opérateur',
            role_label: u.is_admin ? 'Directeur Général & Administrateur' : 'Opérateur Guichet',
            is_admin: Boolean(u.is_admin),
            email: u.email,
          }));
          setAvailableUsers(mapped);
        }
      } catch (e) {}
    };
    loadRealUsers();
    return () => { isMounted = false; };
  }, []);

  // Seul le directeur ou l'administrateur peut voir le sélecteur et naviguer entre Opérateur et Admin
  const isPrivileged = Boolean(
    canSwitchSpace ||
    isDirectorOrAdmin ||
    (user && (
      user.role === 'ADMIN' ||
      user.role === 'DIRECTEUR' ||
      user.role === 'DIR_GEN' ||
      user.is_admin === true ||
      user.is_superuser === true ||
      user.is_staff === true ||
      user.role_label?.toLowerCase().includes('directeur') ||
      user.role_label?.toLowerCase().includes('admin') ||
      user.username?.toLowerCase().includes('admin') ||
      user.username?.toLowerCase().includes('directeur')
    ))
  );

  const handleSpaceChange = (space) => {
    switchSpace(space);
    if (space === 'admin') {
      navigate('/admin/dashboard');
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
          <div>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
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

        {/* Cloche : chèques de l'échéancier à déposer (alerte un mois avant, rappel 15 jours après) */}
        <button
          type="button"
          onClick={() => navigate('/user/cheques')}
          title={alertesCheques > 0
            ? `${alertesCheques} chèque${alertesCheques > 1 ? 's' : ''} à déposer (échéancier)`
            : 'Aucun chèque à déposer'}
          style={{
            position: 'relative',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
            width: '32px',
            height: '32px',
            borderRadius: '9999px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Bell size={15} />
          {alertesCheques > 0 && (
            <span
              style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                minWidth: '16px',
                height: '16px',
                padding: '0 4px',
                borderRadius: '9999px',
                background: '#f43f5e',
                color: '#fff',
                fontSize: '0.62rem',
                fontWeight: 700,
                lineHeight: '16px',
                textAlign: 'center',
              }}
            >
              {alertesCheques}
            </span>
          )}
        </button>

        {/* Role & Habilitation Quick Switcher (Mode Démo & Audit Métier) */}
        <div className="nav-profil-switch" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <select
            value={user?.username || ''}
            onChange={(e) => {
              const target = availableUsers.find((u) => (u.username || u.email) === e.target.value);
              if (target && switchUser) {
                switchUser(target);
              }
            }}
            title="Changer de profil d'habilitation (Démonstration & Audit RBAC)"
            style={{
              fontSize: '0.75rem',
              padding: '0.25rem 0.5rem',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface-elevated)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontWeight: 500,
              maxWidth: '180px',
            }}
          >
            {sortUniqueBy(availableUsers, (u) => u.first_name || u.username || '').map((u) => (
              <option key={u.username || u.id} value={u.username || u.email}>
                👤 {u.first_name} ({u.role_code || u.role || 'Utilisateur'})
              </option>
            ))}
          </select>
        </div>

        {/* User Card */}
        <div
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
              {user ? `${user.first_name || ''} ${user.last_name || user.username}` : 'Invité'}
            </span>
            <span style={{ fontSize: '0.625rem', color: isPrivileged ? '#c084fc' : '#60a5fa' }}>
              {user?.role_label || (isPrivileged ? 'Directeur / Admin' : 'Opérateur')}
            </span>
          </div>

          <button
            onClick={logout}
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
    </header>
  );
};

export default Navbar;
