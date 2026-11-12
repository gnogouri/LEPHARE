import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import BandeauEtatServeur from './BandeauEtatServeur';
import { ADMIN_MENU } from './adminMenu';
import { useAuth } from '../../context/AuthContext';
import { droitDeLaRoute } from '../../utils/droits';
import { AccesRefuse } from '../securite/AccesRefuse';
import { ChangementMotDePasse } from '../securite/ChangementMotDePasse';
import { EVENEMENT_ACCES_REFUSE } from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';

export const AppLayout = () => {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const location = useLocation();
  const { peut, doitChangerMotDePasse } = useAuth();
  // Droit exigé par l'écran demandé (utils/droits.js et adminMenu.js)
  const droitEcran = droitDeLaRoute(location.pathname, ADMIN_MENU);
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Opération refusée par le serveur : le motif exact (droit manquant, séparation des tâches) est affiché
  useEffect(() => {
    let dernier = { texte: '', instant: 0 };
    const surRefus = (e) => {
      const texte = String(e.detail || '');
      if (!texte || (texte === dernier.texte && Date.now() - dernier.instant < 3000)) return;
      dernier = { texte, instant: Date.now() };
      toastRef.current?.error(texte, { titre: 'Action non autorisée' });
    };
    window.addEventListener(EVENEMENT_ACCES_REFUSE, surRefus);
    return () => window.removeEventListener(EVENEMENT_ACCES_REFUSE, surRefus);
  }, []);
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebarCollapsed') === '1'; } catch { return false; }
  });

  const handleToggleSidebar = () => {
    if (window.innerWidth <= 1024) {
      setMobileSidebarOpen((prev) => !prev);
      return;
    }
    setDesktopCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem('sidebarCollapsed', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className={`app-container ${desktopCollapsed ? 'sidebar-collapsed' : ''}`}>
      {doitChangerMotDePasse && <ChangementMotDePasse obligatoire />}
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <Navbar onToggleMobileSidebar={handleToggleSidebar} />
        <BandeauEtatServeur />
        <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
          {mobileSidebarOpen && (
            <div
              className="sidebar-backdrop"
              onClick={() => setMobileSidebarOpen(false)}
            />
          )}
          <Sidebar
            isOpen={mobileSidebarOpen}
            onClose={() => setMobileSidebarOpen(false)}
          />
          <main className="main-content">
            <div className="content-body">
              {/* Un conteneur par écran : apparition douce à chaque changement d'écran (index.css) */}
              <div key={location.pathname} className="page-transition">
                {peut(droitEcran)
                  ? <Suspense fallback={<div className="page-container" role="status">Chargement de la page…</div>}><Outlet /></Suspense>
                  : <AccesRefuse droit={droitEcran} />}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default AppLayout;
