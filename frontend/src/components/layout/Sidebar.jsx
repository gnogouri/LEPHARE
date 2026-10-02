import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ADMIN_MENU, estActif } from './adminMenu';
import {
  LayoutDashboard,
  Users,
  FileText,
  Shield,
  ShieldCheck,
  RefreshCw,
  CreditCard,
  Car,
  KeyRound,
  BarChart3,
  FileSpreadsheet,
  CheckCheck,
  Building2,
  Coins,
  UserCheck,
  ChevronDown,
  TrendingUp,
  AlertTriangle,
  FolderOpen,
  Layers,
  Compass,
  Settings,
  X,
  BadgeCheck,
  Banknote,
  Boxes,
  Briefcase,
  Contact,
  Factory,
  FileSignature,
  MapPin,
  Package,
  Percent,
  Receipt,
  ScrollText,
  Tag,
  TrafficCone,
  Truck,
  UserCog,
  UserPlus,
  Wallet,
  Archive,
} from 'lucide-react';

export const Sidebar = ({ isOpen, onClose }) => {
  const { user, activeSpace } = useAuth();
  const location = useLocation();

  // Collapsible accordion states
  const [openSubmenus, setOpenSubmenus] = useState({
    crm: true,
    cash: true,
    conventions: true,
    compliance: true,
    users: true,
    oreole: true,
  });

  useEffect(() => {
    if (location.pathname.includes('/user/crm') || location.pathname.includes('/user/clients')) {
      setOpenSubmenus((prev) => ({ ...prev, crm: true }));
    }
    if (location.pathname.includes('/user/cash') || location.pathname.includes('/user/cheques')) {
      setOpenSubmenus((prev) => ({ ...prev, cash: true }));
    }
    if (location.pathname.includes('/admin/conventions') || location.pathname.includes('/admin/settings')) {
      setOpenSubmenus((prev) => ({ ...prev, conventions: true }));
    }
    if (location.pathname.includes('/admin/compliance') || location.pathname.includes('/admin/reporting')) {
      setOpenSubmenus((prev) => ({ ...prev, compliance: true }));
    }
    if (
      location.pathname.includes('/admin/users') ||
      location.pathname.includes('/admin/profiles') ||
      location.pathname.includes('/admin/roles-permissions')
    ) {
      setOpenSubmenus((prev) => ({ ...prev, users: true }));
    }
  }, [location.pathname]);

  // Groupes de l'espace Administration repliés par l'utilisateur (tous ouverts au départ)
  const [groupesAdminFermes, setGroupesAdminFermes] = useState({});

  const toggleSubmenu = (menu) => {
    setOpenSubmenus((prev) => ({ ...prev, [menu]: !prev[menu] }));
  };

  const handleLinkClick = () => {
    if (window.innerWidth <= 1024 && onClose) {
      onClose();
    }
  };

  return (
    <aside
      className={`sidebar-drawer ${isOpen ? 'open' : ''}`}
      style={{
        width: 'var(--sidebar-width)',
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - var(--navbar-height))',
        position: 'sticky',
        top: 'var(--navbar-height)',
        overflowY: 'auto',
        padding: '0.85rem 0.65rem 1.5rem 0.65rem',
        userSelect: 'none',
      }}
    >
      {/* Workspace Indicator Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.45rem 0.65rem',
          marginBottom: '0.65rem',
          borderRadius: 'var(--radius-sm)',
          background: activeSpace === 'admin' ? 'rgba(139,92,246,0.06)' : 'rgba(37,99,235,0.06)',
          border: `1px solid ${activeSpace === 'admin' ? 'rgba(139,92,246,0.18)' : 'rgba(37,99,235,0.18)'}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {activeSpace === 'admin' ? (
            <Settings size={14} style={{ color: '#c084fc' }} />
          ) : (
            <Compass size={14} style={{ color: '#60a5fa' }} />
          )}
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            {activeSpace === 'admin' ? 'Direction & Pilotage' : 'Production & Courtage'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span
            style={{
              fontSize: '0.62rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '0.15rem 0.45rem',
              borderRadius: '9999px',
              background: activeSpace === 'admin' ? 'rgba(139,92,246,0.2)' : 'rgba(37,99,235,0.2)',
              color: activeSpace === 'admin' ? '#c084fc' : '#60a5fa',
            }}
          >
            {activeSpace === 'admin' ? 'ADMIN' : 'MÉTIER'}
          </span>

          {onClose && (
            <button
              onClick={onClose}
              className="mobile-toggle-btn"
              style={{ padding: '0.15rem', color: 'var(--text-muted)', border: 'none', background: 'transparent' }}
              title="Fermer le menu"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tree */}
      <nav
        onClick={(e) => {
          if (e.target.closest('a')) handleLinkClick();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}
      >
        {activeSpace === 'admin' ? (
          /* =========================================================================
             ESPACE DIRECTION & ADMINISTRATION : groupes définis dans adminMenu.js
             (même plan que la page « Guide de l'administration »)
             ========================================================================= */
          <>
            {ADMIN_MENU.map((groupe) => {
              const contientPageActive = groupe.items.some((item) => estActif(location.pathname, item.to));
              const ouvert = contientPageActive || !groupesAdminFermes[groupe.id];
              return (
                <div key={groupe.id}>
                  <div
                    className="sidebar-section-header"
                    onClick={() => setGroupesAdminFermes((prev) => ({ ...prev, [groupe.id]: !prev[groupe.id] }))}
                    title={groupe.description}
                    style={{ cursor: 'pointer' }}
                  >
                    <span>{groupe.titre}</span>
                    <ChevronDown
                      size={12}
                      style={{ transform: ouvert ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                    />
                  </div>
                  {ouvert && groupe.items.map((item) => {
                    const Icone = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end
                        title={item.description}
                        className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                      >
                        <Icone size={16} className="nav-icon" />
                        <span>{item.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              );
            })}
          </>
        ) : (
          /* =========================================================================
             ESPACE PRODUCTION & EXPLOITATION (OPÉRATEUR)
             ========================================================================= */
          <>
            {/* 1. GESTION OPÉRATIONNELLE */}
            <div className="sidebar-section-header">
              <span>Gestion Opérationnelle</span>
            </div>

            <NavLink to="/user/dashboard" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <LayoutDashboard size={16} className="nav-icon" />
              <span>Cockpit Opérationnel</span>
            </NavLink>

            <div>
              <div
                onClick={() => toggleSubmenu('crm')}
                className={`sidebar-nav-item ${location.pathname.includes('/user/crm') || location.pathname.includes('/user/clients') ? 'active' : ''}`}
                style={{ justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <Users size={16} className="nav-icon" />
                  <span>Relations Clients</span>
                </div>
                <ChevronDown
                  size={14}
                  style={{
                    transform: openSubmenus.crm ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                    color: 'var(--text-muted)',
                  }}
                />
              </div>

              {openSubmenus.crm && (
                <div className="sidebar-submenu-tree">
                  <NavLink to="/user/crm" end className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <TrendingUp size={14} className="nav-icon" />
                    <span>Suivi commercial</span>
                  </NavLink>
                  <NavLink to="/user/crm/360" className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <Contact size={14} className="nav-icon" />
                    <span>Fiche client complète</span>
                  </NavLink>
                  <NavLink to="/user/clients" className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <Users size={14} className="nav-icon" />
                    <span>Clientèle</span>
                  </NavLink>
                </div>
              )}
            </div>

            {/* 2. PRODUCTION & SOUSCRIPTION */}
            <NavLink to="/user/quotes" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <FileText size={16} className="nav-icon" />
              <span>Production</span>
            </NavLink>

            <NavLink to="/user/contracts" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <ShieldCheck size={16} className="nav-icon" />
              <span>Contrats</span>
            </NavLink>

            <NavLink to="/user/endorsements" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <RefreshCw size={16} className="nav-icon" />
              <span>Avenants</span>
            </NavLink>

            {/* Grisé en attendant l'ouverture des e-attestations */}
            <span className="sidebar-nav-item disabled" aria-disabled="true" title="Module indisponible pour le moment">
              <Car size={16} className="nav-icon" />
              <span>e-Attestations ASACI Auto</span>
            </span>

            {/* 3. FINANCE & CAISSE (ART. 13) */}
            <div className="sidebar-section-header">
              <span>Caisse (Art. 13)</span>
            </div>

            <div>
              <div
                onClick={() => toggleSubmenu('cash')}
                className={`sidebar-nav-item ${location.pathname.includes('/user/cash') || location.pathname.includes('/user/cheques') ? 'active' : ''}`}
                style={{ justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <CreditCard size={16} className="nav-icon" />
                  <span>Encaissements</span>
                </div>
                <ChevronDown
                  size={14}
                  style={{
                    transform: openSubmenus.cash ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                    color: 'var(--text-muted)',
                  }}
                />
              </div>

              {openSubmenus.cash && (
                <div className="sidebar-submenu-tree">
                  <NavLink to="/user/cash" className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <Wallet size={14} className="nav-icon" />
                    <span>Encaisser Primes (Quittances)</span>
                  </NavLink>
                  <NavLink to="/user/cheques" className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <Banknote size={14} className="nav-icon" />
                    <span>Portefeuille Chèques</span>
                  </NavLink>
                </div>
              )}
            </div>

            {/* 4. INDEMNISATION & GED */}
            <div className="sidebar-section-header">
              <span>Indemnisation & Pièces</span>
            </div>

            <NavLink to="/user/claims" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <AlertTriangle size={16} className="nav-icon" />
              <span>Suivi des sinistres</span>
            </NavLink>

            <NavLink to="/user/documents" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <FolderOpen size={16} className="nav-icon" />
              <span>Documents (GED)</span>
            </NavLink>

            <NavLink to="/user/derogations" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <KeyRound size={16} className="nav-icon" />
              <span>Workflows & Dérogations</span>
            </NavLink>

            <NavLink to="/user/archives" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <Archive size={16} className="nav-icon" />
              <span>Archives</span>
            </NavLink>
          </>
        )}
      </nav>
    </aside>
  );
};

export default Sidebar;
