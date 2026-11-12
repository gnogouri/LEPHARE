import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ADMIN_MENU, entreeActive } from './adminMenu';
import { moduleOuvert } from '../../utils/parametrage';
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  FileText,
  Shield,
  ShieldCheck,
  RefreshCw,
  History,
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
  ListChecks, SearchCheck, HeartPulse, HeartHandshake,
} from 'lucide-react';

// Repère d'un menu déroulant : nombre de pages et chevron dans une pastille, qui se teinte et pivote à l'ouverture
const IndicateurDeroulant = ({ ouvert, nombre }) => (
  <span className={`sidebar-deroulant ${ouvert ? 'ouvert' : ''}`} aria-hidden="true">
    {nombre > 0 && <span className="sidebar-deroulant-nombre">{nombre}</span>}
    <ChevronDown size={13} className="sidebar-deroulant-chevron" />
  </span>
);

// Ligne qui déroule un menu : bouton accessible au clavier (Entrée, Espace), état ouvert annoncé
const proprietesDeroulant = (ouvert, nombre, basculer) => ({
  role: 'button',
  tabIndex: 0,
  'aria-expanded': ouvert,
  title: `${ouvert ? 'Masquer' : 'Afficher'} ${nombre > 1 ? `les ${nombre} pages` : 'la page'} de ce menu`,
  onClick: basculer,
  onKeyDown: (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      basculer();
    }
  },
});

export const Sidebar = ({ isOpen, onClose }) => {
  const { activeSpace, peut } = useAuth();
  const location = useLocation();

  // Sous-menus repliés tant que l'utilisateur ne les a pas déroulés (y compris celui de la page active)
  const [openSubmenus, setOpenSubmenus] = useState({});

  // Groupes de l'espace Administration déroulés par l'utilisateur (tous repliés au départ)
  const [groupesAdminOuverts, setGroupesAdminOuverts] = useState({});
  // Groupe de la page affichée ouvert d'office (écran détaillé d'une branche : groupe de sa branche)
  useEffect(() => {
    const groupe = ADMIN_MENU.find((g) => g.items.some((item) => item.menu !== false && entreeActive(location.pathname, item)));
    if (groupe) setGroupesAdminOuverts((prev) => (prev[groupe.id] ? prev : { ...prev, [groupe.id]: true }));
  }, [location.pathname]);

  const toggleSubmenu = (menu) => {
    setOpenSubmenus((prev) => ({ ...prev, [menu]: !prev[menu] }));
  };
  // Pages du sous-menu « Relations Clients » visibles avec les droits de l'utilisateur
  const nombreCrm = [peut('crm.view'), peut('crm.view'), peut('clients.view'), peut('clients.view')].filter(Boolean).length;

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
            {/* Écrans détaillés d'une branche (menu: false) : ouverts depuis sa page ; branche fermée à la saisie : masquée */}
            {ADMIN_MENU.map((groupe) => ({ ...groupe, items: groupe.items.filter((item) => item.menu !== false && peut(item.droit) && (!item.module || moduleOuvert(item.module))) }))
              .filter((groupe) => groupe.items.length > 0)
              .map((groupe) => {
              const contientPageActive = groupe.items.some((item) => entreeActive(location.pathname, item));
              const ouvert = !!groupesAdminOuverts[groupe.id];
              return (
                <div key={groupe.id}>
                  <div
                    className={`sidebar-section-header deroulant ${ouvert ? 'ouvert' : ''} ${contientPageActive ? 'active' : ''}`}
                    {...proprietesDeroulant(ouvert, groupe.items.length, () => setGroupesAdminOuverts((prev) => ({ ...prev, [groupe.id]: !prev[groupe.id] })))}
                  >
                    <span title={groupe.description}>{groupe.titre}</span>
                    <IndicateurDeroulant ouvert={ouvert} nombre={groupe.items.length} />
                  </div>
                  {ouvert && <div className="sidebar-groupe-contenu">{groupe.items.map((item) => {
                    const Icone = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end
                        title={item.description}
                        className={({ isActive }) => `sidebar-nav-item ${isActive || entreeActive(location.pathname, item) ? 'active' : ''}`}
                      >
                        <Icone size={16} className="nav-icon" />
                        <span>{item.label}</span>
                      </NavLink>
                    );
                  })}</div>}
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

            {peut('cockpit.view') && (
              <NavLink to="/user/dashboard" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
                <LayoutDashboard size={16} className="nav-icon" />
                <span>Cockpit Opérationnel</span>
              </NavLink>
            )}

            {peut(['crm.view', 'clients.view']) && <div>
              <div
                {...proprietesDeroulant(!!openSubmenus.crm, nombreCrm, () => toggleSubmenu('crm'))}
                className={`sidebar-nav-item has-submenu ${openSubmenus.crm ? 'deplie' : ''} ${location.pathname.includes('/user/crm') || location.pathname.includes('/user/clients') ? 'active' : ''}`}
              >
                <Users size={16} className="nav-icon" />
                <span>Relations Clients</span>
                <IndicateurDeroulant ouvert={!!openSubmenus.crm} nombre={nombreCrm} />
              </div>

              {openSubmenus.crm && (
                <div className="sidebar-submenu-tree">
                  {peut('crm.view') && <NavLink to="/user/crm" end className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <TrendingUp size={14} className="nav-icon" />
                    <span>Suivi commercial</span>
                  </NavLink>}
                  {peut('crm.view') && <NavLink to="/user/crm/questionnaires" className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <ClipboardList size={14} className="nav-icon" />
                    <span>Questionnaires prospects</span>
                  </NavLink>}
                  {peut('clients.view') && <NavLink to="/user/crm/360" className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <Contact size={14} className="nav-icon" />
                    <span>Fiche client complète</span>
                  </NavLink>}
                  {peut('clients.view') && <NavLink to="/user/clients" className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <Users size={14} className="nav-icon" />
                    <span>Clientèle</span>
                  </NavLink>}
                </div>
              )}
            </div>}

            {/* 2. PRODUCTION & SOUSCRIPTION */}
            {peut('devis.view') && <NavLink to="/user/quotes" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <FileText size={16} className="nav-icon" />
              <span>Production</span>
            </NavLink>}

            {peut('contrats.view') && <NavLink to="/user/contracts" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <ShieldCheck size={16} className="nav-icon" />
              <span>Contrats</span>
            </NavLink>}

            {peut('contrats.view') && <NavLink to="/user/endorsements" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <RefreshCw size={16} className="nav-icon" />
              <span>Avenants</span>
            </NavLink>}

            {peut('contrats.view') && <NavLink to="/user/reprises" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <History size={16} className="nav-icon" />
              <span>Affaires antérieures</span>
            </NavLink>}

            {/* Régimes autofinancés d'assurance santé : conventions, fonds, dépenses du gestionnaire */}
            {peut('rafas.view') && <NavLink to="/user/rafas" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <HeartHandshake size={16} className="nav-icon" />
              <span>RAFAS</span>
            </NavLink>}

            {/* Grisé en attendant l'ouverture des e-attestations */}
            <span className="sidebar-nav-item disabled" aria-disabled="true" title="Module indisponible pour le moment">
              <Car size={16} className="nav-icon" />
              <span>e-Attestations ASACI Auto</span>
            </span>

            {/* 3. FINANCE & CAISSE (ART. 13) */}
            {peut('encaissements.view') && <div className="sidebar-section-header">
              <span>Caisse (Art. 13)</span>
            </div>}

            {peut('encaissements.view') && <div>
              <div
                {...proprietesDeroulant(!!openSubmenus.cash, 3, () => toggleSubmenu('cash'))}
                className={`sidebar-nav-item has-submenu ${openSubmenus.cash ? 'deplie' : ''} ${location.pathname.includes('/user/cash') || location.pathname.includes('/user/cheques') ? 'active' : ''}`}
              >
                <CreditCard size={16} className="nav-icon" />
                <span>Encaissements</span>
                <IndicateurDeroulant ouvert={!!openSubmenus.cash} nombre={3} />
              </div>

              {openSubmenus.cash && (
                <div className="sidebar-submenu-tree">
                  <NavLink to="/user/cash" end className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <Wallet size={14} className="nav-icon" />
                    <span>Encaisser Primes (Quittances)</span>
                  </NavLink>
                  <NavLink to="/user/cheques" className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <Banknote size={14} className="nav-icon" />
                    <span>Portefeuille des règlements</span>
                  </NavLink>
                  <NavLink to="/user/cash/etat" className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <ListChecks size={14} className="nav-icon" />
                    <span>État des encaissements</span>
                  </NavLink>
                  <NavLink to="/user/cash/recherche" className={({ isActive }) => `sidebar-sublink-item ${isActive ? 'active' : ''}`}>
                    <SearchCheck size={14} className="nav-icon" />
                    <span>Rechercher un règlement</span>
                  </NavLink>
                </div>
              )}
            </div>}

            {/* 4. INDEMNISATION & GED */}
            <div className="sidebar-section-header">
              <span>Indemnisation & Pièces</span>
            </div>

            {peut('sinistres.view') && <NavLink to="/user/claims" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <AlertTriangle size={16} className="nav-icon" />
              <span>Suivi des sinistres</span>
            </NavLink>}

            {peut('consommations.view') && <NavLink to="/user/sante/consommations" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <HeartPulse size={16} className="nav-icon" />
              <span>Consommations santé</span>
            </NavLink>}

            {peut('documents.view') && <NavLink to="/user/documents" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <FolderOpen size={16} className="nav-icon" />
              <span>Documents (GED)</span>
            </NavLink>}

            {peut('approbations.view') && <NavLink to="/user/derogations" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <KeyRound size={16} className="nav-icon" />
              <span>Workflows & Dérogations</span>
            </NavLink>}

            {peut('devis.view') && <NavLink to="/user/archives" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
              <Archive size={16} className="nav-icon" />
              <span>Archives</span>
            </NavLink>}
          </>
        )}
      </nav>
    </aside>
  );
};

export default Sidebar;
