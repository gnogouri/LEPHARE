import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';

// Layout
import AppLayout from './components/layout/AppLayout';

import { premierEcranAdmin } from './components/layout/adminMenu';

const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const UserDashboard = lazy(() => import('./pages/user/UserDashboard'));
const ClientListPage = lazy(() => import('./pages/user/clients/ClientListPage'));
const ClientDetailPage = lazy(() => import('./pages/user/clients/ClientDetailPage'));
const QuoteListPage = lazy(() => import('./pages/user/quotes/QuoteListPage'));
const NewAutoQuotePage = lazy(() => import('./pages/user/quotes/NewAutoQuotePage'));
const NewMrhQuotePage = lazy(() => import('./pages/user/quotes/NewMrhQuotePage'));
const NewSanteQuotePage = lazy(() => import('./pages/user/quotes/NewSanteQuotePage'));
const NewIaQuotePage = lazy(() => import('./pages/user/quotes/NewIaQuotePage'));
const NewRisquesDiversQuotePage = lazy(() => import('./pages/user/quotes/NewRisquesDiversQuotePage'));
const NewTousDommagesQuotePage = lazy(() => import('./pages/user/quotes/NewTousDommagesQuotePage'));
const NewAfaQuotePage = lazy(() => import('./pages/user/quotes/NewAfaQuotePage'));
const NewVoyageQuotePage = lazy(() => import('./pages/user/quotes/NewVoyageQuotePage'));
const NewTransportQuotePage = lazy(() => import('./pages/user/quotes/NewTransportQuotePage'));
const TransportAccueilPage = lazy(() => import('./pages/user/quotes/TransportAccueilPage'));
const NewTransportHorsGucePage = lazy(() => import('./pages/user/quotes/NewTransportHorsGucePage'));
const TransportAbonnementsPage = lazy(() => import('./pages/user/quotes/TransportAbonnementsPage'));
const ContractListPage = lazy(() => import('./pages/user/contracts/ContractListPage'));
const ContractDetailPage = lazy(() => import('./pages/user/contracts/ContractDetailPage'));
const IncorporationFlottePage = lazy(() => import('./pages/user/contracts/IncorporationFlottePage'));
const AdminContractManagementPage = lazy(() => import('./pages/admin/contracts/AdminContractManagementPage'));
const EndorsementPage = lazy(() => import('./pages/user/endorsements/EndorsementPage'));
const RepriseAffairesPage = lazy(() => import('./pages/user/reprises/RepriseAffairesPage'));
const OreoleAccueilPage = lazy(() => import('./pages/user/quotes/oreole/OreoleAccueilPage'));
const NewOreolePage = lazy(() => import('./pages/user/quotes/oreole/NewOreolePage'));
const OreoleFichierPage = lazy(() => import('./pages/user/quotes/oreole/OreoleFichierPage'));
const OreoleCartesPage = lazy(() => import('./pages/user/quotes/oreole/OreoleCartesPage'));
const ConsommationsSantePage = lazy(() => import('./pages/user/sante/ConsommationsSantePage'));
const RafasAccueilPage = lazy(() => import('./pages/user/rafas/RafasAccueilPage'));
const RafasConventionPage = lazy(() => import('./pages/user/rafas/RafasConventionPage'));
const ParametrageOreolePage = lazy(() => import('./pages/admin/settings/ParametrageOreolePage'));
const CashCollectionPage = lazy(() => import('./pages/user/cash/CashCollectionPage'));
const ChequeManagementPage = lazy(() => import('./pages/user/cash/ChequeManagementPage'));
const EtatEncaissementsPage = lazy(() => import('./pages/user/cash/EtatEncaissementsPage'));
const RechercheReglementPage = lazy(() => import('./pages/user/cash/RechercheReglementPage'));
const AsaciPage = lazy(() => import('./pages/user/asaci/AsaciPage'));
const MyDerogationsPage = lazy(() => import('./pages/user/derogations/MyDerogationsPage'));
const ArchivesPage = lazy(() => import('./pages/user/archives/ArchivesPage'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminGuidePage = lazy(() => import('./pages/admin/AdminGuidePage'));
const CimaReportsPage = lazy(() => import('./pages/admin/reporting/CimaReportsPage'));
const EmissionSummaryPage = lazy(() => import('./pages/admin/reporting/EmissionSummaryPage'));
const DecisionalStatesPage = lazy(() => import('./pages/admin/reporting/DecisionalStatesPage'));
const ApprovalCenterPage = lazy(() => import('./pages/admin/approvals/ApprovalCenterPage'));
const CompanyRemittancePage = lazy(() => import('./pages/admin/remittances/CompanyRemittancePage'));
const CommissionDashboardPage = lazy(() => import('./pages/admin/commissions/CommissionDashboardPage'));
const ApporteursPage = lazy(() => import('./pages/admin/apporteurs/ApporteursPage'));
const UserManagementPage = lazy(() => import('./pages/admin/users/UserManagementPage'));
const ProfileManagementPage = lazy(() => import('./pages/admin/users/ProfileManagementPage'));
const RolesPermissionsPage = lazy(() => import('./pages/admin/users/RolesPermissionsPage'));
const JournalAuditPage = lazy(() => import('./pages/admin/users/JournalAuditPage'));
const CatalogCompaniesPage = lazy(() => import('./pages/admin/settings/CatalogCompaniesPage'));
const CatalogProductsPage = lazy(() => import('./pages/admin/settings/CatalogProductsPage'));
const CatalogTarifsPage = lazy(() => import('./pages/admin/settings/CatalogTarifsPage'));
const CabinetSettingsPage = lazy(() => import('./pages/admin/settings/CabinetSettingsPage'));
const VehicleGeoSettingsPage = lazy(() => import('./pages/admin/settings/VehicleGeoSettingsPage'));
const SecteursActivitePage = lazy(() => import('./pages/admin/settings/SecteursActivitePage').then((module) => ({ default: module.SecteursActivitePage })));
const TypeSouscripteurPage = lazy(() => import('./pages/admin/settings/TypeSouscripteurPage').then((module) => ({ default: module.TypeSouscripteurPage })));
const TypeAssurePage = lazy(() => import('./pages/admin/settings/TypeAssurePage').then((module) => ({ default: module.TypeAssurePage })));
const BanquesPage = lazy(() => import('./pages/admin/settings/BanquesPage'));
const ProfessionsPage = lazy(() => import('./pages/admin/settings/ProfessionsPage').then((module) => ({ default: module.ProfessionsPage })));
const ParametrageGarantiesPage = lazy(() => import('./pages/admin/settings/ParametrageGarantiesPage'));
const ParametrageOffresPage = lazy(() => import('./pages/admin/settings/ParametrageOffresPage'));
const ParametrageTaxesPage = lazy(() => import('./pages/admin/settings/ParametrageTaxesPage'));
const ParametrageMarquesPage = lazy(() => import('./pages/admin/settings/ParametrageMarquesPage'));
const ParametrageCommissionsPage = lazy(() => import('./pages/admin/settings/ParametrageCommissionsPage'));
const ParametrageFlottePage = lazy(() => import('./pages/admin/settings/ParametrageFlottePage'));
const ParametrageSecuritePage = lazy(() => import('./pages/admin/settings/ParametrageSecuritePage'));
const ParametrageGrillesVoyagePage = lazy(() => import('./pages/admin/settings/ParametrageGrillesVoyagePage'));
const ParametrageDommagesPage = lazy(() => import('./pages/admin/settings/ParametrageDommagesPage'));
const ReglagesBranchePage = lazy(() => import('./pages/admin/settings/ReglagesBranchePage').then((module) => ({ default: module.ReglagesBranchePage })));
const ReglagesBranchesPage = lazy(() => import('./pages/admin/settings/ReglagesBranchePage').then((module) => ({ default: module.ReglagesBranchesPage })));
const ParametrageSantePage = lazy(() => import('./pages/admin/settings/ParametrageSantePage'));
const ParametrageDepreciationPage = lazy(() => import('./pages/admin/settings/ParametrageDepreciationPage'));
const ParametragePoolTpvPage = lazy(() => import('./pages/admin/settings/ParametragePoolTpvPage'));
const ParametrageTarifsDirectsPage = lazy(() => import('./pages/admin/settings/ParametrageTarifsDirectsPage'));
const ParametrageBaremeAutoPage = lazy(() => import('./pages/admin/settings/ParametrageBaremeAutoPage'));
const ParametrageReglesGarantiesPage = lazy(() => import('./pages/admin/settings/ParametrageReglesGarantiesPage'));
const RenouvellementPage = lazy(() => import('./pages/user/contracts/RenouvellementPage'));
const CrmPipelinePage = lazy(() => import('./pages/user/crm/CrmPipelinePage'));
const Customer360Page = lazy(() => import('./pages/user/crm/Customer360Page'));
const QuestionnairesPage = lazy(() => import('./pages/user/crm/QuestionnairesPage'));
const ClaimsListPage = lazy(() => import('./pages/user/claims/ClaimsListPage'));
const ClaimDetailPage = lazy(() => import('./pages/user/claims/ClaimDetailPage'));
const DocumentManagementPage = lazy(() => import('./pages/user/documents/DocumentManagementPage'));
const ConventionsEnginePage = lazy(() => import('./pages/admin/conventions/ConventionsEnginePage'));
const ComplianceAuditPage = lazy(() => import('./pages/admin/compliance/ComplianceAuditPage'));

// Protected Route Guard
const ProtectedRoute = ({ children }) => {
  const auth = useAuth() || {};
  const { isAuthenticated = false } = auth;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

// Admin / Direction Route Guard (Accès exclusif Directeur ou Administrateur)
const AdminRoute = ({ children }) => {
  const auth = useAuth() || {};
  const { isAuthenticated = false, isDirectorOrAdmin = false } = auth;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (!isDirectorOrAdmin) {
    return <Navigate to="/user/dashboard" replace />;
  }
  return children;
};

const premierePageProduction = (peut) => [
  ['crm.view', '/user/crm'],
  ['clients.view', '/user/clients'],
  ['devis.view', '/user/quotes'],
  ['contrats.view', '/user/contracts'],
  ['encaissements.view', '/user/cash'],
  ['sinistres.view', '/user/claims'],
  ['documents.view', '/user/documents'],
  ['approbations.view', '/user/derogations'],
].find(([droit]) => peut(droit))?.[1];

const CockpitRoute = ({ children }) => {
  const { peut } = useAuth();
  if (peut('cockpit.view')) return children;

  const destination = premierePageProduction(peut);
  if (destination) return <Navigate to={destination} replace />;

  return (
    <main className="page-container" role="alert">
      <h1 className="title-xl">Accès restreint</h1>
      <p>Votre rôle ne vous donne pas accès au Cockpit opérationnel. Demandez à l’administrateur de vous attribuer un rôle autorisé.</p>
    </main>
  );
};

// Default Route Redirector
const DefaultRedirect = () => {
  const auth = useAuth() || {};
  const { activeSpace = 'user', isDirectorOrAdmin = false, peut = () => false } = auth;
  if (!isDirectorOrAdmin) {
    return <Navigate to="/user/dashboard" replace />;
  }
  return <Navigate to={activeSpace === 'admin' ? premierEcranAdmin(peut) : '/user/dashboard'} replace />;
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Suspense fallback={<main className="page-container" role="status">Chargement de la page…</main>}>
            <Routes>
              {/* Public Login */}
              <Route path="/login" element={<LoginPage />} />

              {/* Authenticated Workspace */}
              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/" element={<DefaultRedirect />} />

                {/* ===== ESPACE OPÉRATEUR / UTILISATEUR ===== */}
                <Route path="/user/dashboard" element={<CockpitRoute><UserDashboard /></CockpitRoute>} />
                {/* ===== MODULE C – CRM & RELATION CLIENT ===== */}
                <Route path="/user/crm" element={<CrmPipelinePage />} />
                <Route path="/user/crm/360" element={<Customer360Page />} />
                <Route path="/user/crm/questionnaires" element={<QuestionnairesPage />} />

                {/* ===== MODULE D – PROSPECTION & DEVIS ===== */}
                <Route path="/user/clients" element={<ClientListPage />} />
                <Route path="/user/clients/:id" element={<ClientDetailPage />} />
                <Route path="/user/quotes" element={<QuoteListPage />} />
                <Route path="/user/quotes/auto" element={<NewAutoQuotePage />} />
                <Route path="/user/quotes/mrh" element={<NewMrhQuotePage />} />
                <Route path="/user/quotes/sante" element={<NewSanteQuotePage />} />
                <Route path="/user/quotes/ia" element={<NewIaQuotePage />} />
                <Route path="/user/quotes/rc" element={<NewRisquesDiversQuotePage key="rc" produit={8} />} />
                <Route path="/user/quotes/mrp" element={<NewRisquesDiversQuotePage key="mrp" produit={7} />} />
                <Route path="/user/quotes/tous-dommages" element={<NewTousDommagesQuotePage />} />
                <Route path="/user/quotes/afa" element={<NewAfaQuotePage />} />
                <Route path="/user/quotes/oreole-sante" element={<OreoleAccueilPage />} />
                <Route path="/user/quotes/oreole-sante/nouveau" element={<NewOreolePage />} />
                <Route path="/user/quotes/oreole-sante/fichier" element={<OreoleFichierPage />} />
                <Route path="/user/quotes/oreole-sante/cartes" element={<OreoleCartesPage />} />
                <Route path="/user/sante/consommations" element={<ConsommationsSantePage />} />
                <Route path="/user/rafas" element={<RafasAccueilPage />} />
                <Route path="/user/rafas/:id" element={<RafasConventionPage />} />
                <Route path="/user/quotes/voyage" element={<NewVoyageQuotePage />} />
                <Route path="/user/quotes/transport" element={<TransportAccueilPage />} />
                <Route path="/user/quotes/transport/hors-guce" element={<NewTransportHorsGucePage />} />
                <Route path="/user/quotes/transport/abonnements" element={<TransportAbonnementsPage />} />
                <Route path="/user/quotes/transport/guce" element={<NewTransportQuotePage />} />

                {/* ===== MODULE E – PORTEFEUILLE CONTRATS ===== */}
                <Route path="/user/contracts" element={<ContractListPage />} />
                <Route path="/user/contracts/:id" element={<ContractDetailPage />} />
                <Route path="/user/contracts/:id/renouvellement" element={<RenouvellementPage />} />
                <Route path="/user/contracts/:id/incorporation" element={<IncorporationFlottePage />} />
                <Route path="/user/endorsements" element={<EndorsementPage />} />
                <Route path="/user/reprises" element={<RepriseAffairesPage />} />
                {/* Affaires antérieures : écrans de devis de la Production, sans quitter la vue (utils/navigationDevis.js) */}
                <Route path="/user/reprises/saisie/auto" element={<NewAutoQuotePage />} />
                <Route path="/user/reprises/saisie/mrh" element={<NewMrhQuotePage />} />
                <Route path="/user/reprises/saisie/sante" element={<NewSanteQuotePage />} />
                <Route path="/user/reprises/saisie/ia" element={<NewIaQuotePage />} />
                <Route path="/user/reprises/saisie/rc" element={<NewRisquesDiversQuotePage key="rc-reprise" produit={8} />} />
                <Route path="/user/reprises/saisie/mrp" element={<NewRisquesDiversQuotePage key="mrp-reprise" produit={7} />} />
                <Route path="/user/reprises/saisie/tous-dommages" element={<NewTousDommagesQuotePage />} />
                <Route path="/user/reprises/saisie/voyage" element={<NewVoyageQuotePage />} />
                <Route path="/user/reprises/saisie/transport" element={<NewTransportHorsGucePage />} />
                {/* Branche Vie (AFA, Retraite complémentaire, Temporaire décès), ajoutée aux boutons de saisie communs */}
                <Route path="/user/reprises/saisie/afa" element={<NewAfaQuotePage />} />
                <Route path="/user/asaci" element={<AsaciPage />} />

                {/* ===== MODULE F – ENCAISSEMENT & TRÉSORERIE ===== */}
                <Route path="/user/cash" element={<CashCollectionPage />} />
                <Route path="/user/cheques" element={<ChequeManagementPage />} />
                <Route path="/user/cash/etat" element={<EtatEncaissementsPage />} />
                <Route path="/user/cash/recherche" element={<RechercheReglementPage />} />

                {/* ===== MODULE H – SINISTRES DÉLÉGUÉS ===== */}
                <Route path="/user/claims" element={<ClaimsListPage />} />
                <Route path="/user/claims/detail" element={<ClaimDetailPage />} />

                {/* ===== MODULE J – GED & WORKFLOWS ===== */}
                <Route path="/user/documents" element={<DocumentManagementPage />} />
                <Route path="/user/derogations" element={<MyDerogationsPage />} />

                {/* ===== MODULE K – ARCHIVES (CONSERVATION CIMA) ===== */}
                <Route path="/user/archives" element={<ArchivesPage />} />

                {/* ===== ESPACE ADMINISTRATION / DIRECTION (DIRECTEUR & ADMIN SEULEMENT) ===== */}
                <Route path="/admin/guide" element={<AdminRoute><AdminGuidePage /></AdminRoute>} />
                <Route path="/admin/dashboard" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
                <Route path="/admin/contracts/edit" element={<AdminContractManagementPage />} />
                <Route path="/admin/conventions" element={<AdminRoute><ConventionsEnginePage /></AdminRoute>} />
                <Route path="/admin/compliance" element={<AdminRoute><ComplianceAuditPage /></AdminRoute>} />
                <Route path="/admin/reporting/cima" element={<AdminRoute><CimaReportsPage /></AdminRoute>} />
                <Route path="/admin/reporting/emissions" element={<AdminRoute><EmissionSummaryPage /></AdminRoute>} />
                <Route path="/admin/reporting/etats-decisionnels" element={<AdminRoute><DecisionalStatesPage /></AdminRoute>} />
                <Route path="/admin/approvals" element={<AdminRoute><ApprovalCenterPage /></AdminRoute>} />
                <Route path="/admin/remittances" element={<AdminRoute><CompanyRemittancePage /></AdminRoute>} />
                <Route path="/admin/commissions" element={<AdminRoute><CommissionDashboardPage /></AdminRoute>} />
                <Route path="/admin/apporteurs" element={<AdminRoute><ApporteursPage /></AdminRoute>} />
                <Route path="/admin/users" element={<AdminRoute><UserManagementPage /></AdminRoute>} />
                <Route path="/admin/profiles" element={<AdminRoute><ProfileManagementPage /></AdminRoute>} />
                <Route path="/admin/roles-permissions" element={<AdminRoute><RolesPermissionsPage /></AdminRoute>} />
                <Route path="/admin/audit" element={<AdminRoute><JournalAuditPage /></AdminRoute>} />
                <Route path="/admin/settings/companies" element={<AdminRoute><CatalogCompaniesPage /></AdminRoute>} />
                <Route path="/admin/settings/cabinet" element={<AdminRoute><CabinetSettingsPage /></AdminRoute>} />
                <Route path="/admin/settings/products" element={<AdminRoute><CatalogProductsPage /></AdminRoute>} />
                {/* Ancien onglet « Garanties » des produits : un seul écran de garanties */}
                <Route path="/admin/settings/guarantees" element={<Navigate to="/admin/settings/garanties-oreole" replace />} />
                <Route path="/admin/settings/tarifs" element={<AdminRoute><CatalogTarifsPage /></AdminRoute>} />
                <Route path="/admin/settings/vehicle-geo" element={<AdminRoute><VehicleGeoSettingsPage /></AdminRoute>} />
                <Route path="/admin/settings/secteurs-activite" element={<AdminRoute><SecteursActivitePage /></AdminRoute>} />
                <Route path="/admin/settings/professions" element={<AdminRoute><ProfessionsPage /></AdminRoute>} />
                <Route path="/admin/settings/types-souscripteur" element={<AdminRoute><TypeSouscripteurPage /></AdminRoute>} />
                <Route path="/admin/settings/types-assure" element={<AdminRoute><TypeAssurePage /></AdminRoute>} />
                <Route path="/admin/settings/banques" element={<AdminRoute><BanquesPage /></AdminRoute>} />
                {/* Modules de Paramétrage OREOLE Fidèles */}
                <Route path="/admin/settings/garanties-oreole" element={<AdminRoute><ParametrageGarantiesPage /></AdminRoute>} />
                <Route path="/admin/settings/offres" element={<AdminRoute><ParametrageOffresPage /></AdminRoute>} />
                <Route path="/admin/settings/taxes" element={<AdminRoute><ParametrageTaxesPage /></AdminRoute>} />
                <Route path="/admin/settings/marques" element={<AdminRoute><ParametrageMarquesPage /></AdminRoute>} />
                <Route path="/admin/settings/commissions-baremes" element={<AdminRoute><ParametrageCommissionsPage /></AdminRoute>} />
                <Route path="/admin/settings/flotte" element={<AdminRoute><ParametrageFlottePage /></AdminRoute>} />
                <Route path="/admin/settings/securite-routiere" element={<AdminRoute><ParametrageSecuritePage /></AdminRoute>} />
                <Route path="/admin/settings/grilles-voyage" element={<AdminRoute><ParametrageGrillesVoyagePage /></AdminRoute>} />
                <Route path="/admin/settings/branches" element={<AdminRoute><ReglagesBranchesPage /></AdminRoute>} />
                <Route path="/admin/settings/branches/:module" element={<AdminRoute><ReglagesBranchePage /></AdminRoute>} />
                <Route path="/admin/settings/dommages" element={<AdminRoute><ParametrageDommagesPage /></AdminRoute>} />
                <Route path="/admin/settings/sante" element={<AdminRoute><ParametrageSantePage /></AdminRoute>} />
                <Route path="/admin/settings/oreole-sante" element={<AdminRoute><ParametrageOreolePage /></AdminRoute>} />
                <Route path="/admin/settings/depreciation" element={<AdminRoute><ParametrageDepreciationPage /></AdminRoute>} />
                <Route path="/admin/settings/pool-tpv" element={<AdminRoute><ParametragePoolTpvPage /></AdminRoute>} />
                <Route path="/admin/settings/tarifs-directs" element={<AdminRoute><ParametrageTarifsDirectsPage /></AdminRoute>} />
                <Route path="/admin/settings/bareme-auto" element={<AdminRoute><ParametrageBaremeAutoPage /></AdminRoute>} />
                <Route path="/admin/settings/regles-garanties" element={<AdminRoute><ParametrageReglesGarantiesPage /></AdminRoute>} />

                {/* Alias direct pour compatibilité stricte OREOLE */}
                <Route path="/parametrage/garanties" element={<Navigate to="/admin/settings/garanties-oreole" replace />} />
                <Route path="/parametrage/sous-garanties" element={<Navigate to="/admin/settings/garanties-oreole" replace />} />
                <Route path="/parametrage/offre" element={<Navigate to="/admin/settings/offres" replace />} />
                <Route path="/parametrage/offre-garantie" element={<Navigate to="/admin/settings/offres" replace />} />
                <Route path="/parametrage/taux-taxe" element={<Navigate to="/admin/settings/taxes" replace />} />
                <Route path="/parametrage/marque-vehicule" element={<Navigate to="/admin/settings/marques" replace />} />
                <Route path="/parametrage/taux-commission" element={<Navigate to="/admin/settings/commissions-baremes" replace />} />
                <Route path="/parametrage/reduction-flotte" element={<Navigate to="/admin/settings/flotte" replace />} />
                <Route path="/parametrage/formule-securite" element={<Navigate to="/admin/settings/securite-routiere" replace />} />
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
