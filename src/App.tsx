import React, { useState, useEffect, useRef } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { ThemeProvider } from './context/ThemeContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardView } from './components/dashboard/DashboardView';
import { POSView } from './components/pos/POSView';
import { SalesHistoryView } from './components/sales/SalesHistoryView';
import { ProductsView } from './components/products/ProductsView';
import { InventoryView } from './components/inventory/InventoryView';
import { PurchasesView } from './components/purchases/PurchasesView';
import { CustomersView } from './components/customers/CustomersView';
import { SuppliersView } from './components/suppliers/SuppliersView';
import { AccountsView } from './components/accounts/AccountsView';
import { ReportsView } from './components/reports/ReportsView';
import { EmployeesView } from './components/employees/EmployeesView';
import { BranchesView } from './components/branches/BranchesView';
import { SettingsView } from './components/settings/SettingsView';
import { SellerManagementView } from './components/sellers/SellerManagementView';
import { SellerDashboardView } from './components/dashboard/SellerDashboardView';
import { BusinessSetupWizard } from './components/setup/BusinessSetupWizard';
import { SmartPricingCalculatorView } from './components/pricing/SmartPricingCalculatorView';
import { BarcodeLabelStudio } from './components/barcodes/BarcodeLabelStudio';
import { ProductCatalogView } from './components/catalog/ProductCatalogView';
import { ExchangeReturnView } from './components/returns/ExchangeReturnView';
import { SmartReorderView } from './components/inventory/SmartReorderView';
import { ComboOffersView } from './components/combos/ComboOffersView';
import { UserStaffManagementView } from './components/users/UserStaffManagementView';
import { AuthModal } from './components/auth/AuthModal';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { APP_IDENTITY } from './config/appIdentity';
import { isSalesmanOrCashierRole, LegacyAppModule, normalizeRoleKey } from './utils/rbacDefaults';
import { Loader2, Store, LogOut, ShieldAlert, AlertTriangle, X } from 'lucide-react';

const TAB_TO_MODULE_MAP: Record<string, LegacyAppModule> = {
  dashboard: 'dashboard',
  pos: 'pos',
  sales: 'sales',
  products: 'products',
  inventory: 'stock',
  purchases: 'purchases',
  customers: 'customers',
  suppliers: 'suppliers',
  accounts: 'accounts',
  reports: 'reports',
  users: 'users',
  employees: 'employees',
  sellers: 'sellers',
  branches: 'branches',
  settings: 'settings',
  'pricing-calculator': 'pricing',
  returns: 'returns',
  catalog: 'catalog',
  barcodes: 'barcodes',
  reorder: 'reorder',
  combos: 'combos',
};

const MainLayout: React.FC = () => {
  const { canAccess, currentUserRole, user, isLoading, isBusinessConfigured, isAuthenticatedAdmin, signOut, dbError, clearDbError, initError, retryInitialization } = useApp();

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const mainScrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeTab]);

  // Password recovery state.
  const [isRecovery, setIsRecovery] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;

    const hashParams = new URLSearchParams(
      window.location.hash.replace(/^#/, '')
    );

    const queryParams = new URLSearchParams(window.location.search);

    return (
      hashParams.get('type') === 'recovery' ||
      queryParams.get('type') === 'recovery'
    );
  });

  // Quick Action Modal Triggers
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [isNewPurchaseOpen, setIsNewPurchaseOpen] = useState(false);
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);

  const handleTabChange = (nextTab: string) => {
    setActiveTab(nextTab);
    if (nextTab !== 'products') setIsAddProductOpen(false);
    if (nextTab !== 'customers') setIsAddCustomerOpen(false);
    if (nextTab !== 'purchases') setIsNewPurchaseOpen(false);
    if (nextTab !== 'accounts') setIsAddExpenseOpen(false);
  };

  // Listen for Supabase password recovery events.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Keep browser tab title permanently set to Application Identity
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = APP_IDENTITY.fullTitle;
    }
  }, []);

  // Validate active tab with current user RBAC permissions & safely redirect if unauthorized
  useEffect(() => {
    const targetModule = TAB_TO_MODULE_MAP[activeTab] || 'dashboard';
    if (!canAccess(targetModule)) {
      const preferredOrder = isSalesmanOrCashierRole(currentUserRole)
        ? ['pos', 'sales', 'dashboard', 'customers', 'products']
        : ['dashboard', 'pos', 'sales', 'products', 'inventory', 'purchases', 'accounts', 'reports'];
      const fallbackTab = preferredOrder.find(tab => canAccess(TAB_TO_MODULE_MAP[tab]));
      if (fallbackTab && fallbackTab !== activeTab) {
        setActiveTab(fallbackTab);
      }
    }
  }, [currentUserRole, activeTab, canAccess]);

  // Loading screen while the session and initial data are loading.
  if (isLoading && !isRecovery) {
    return (
      <div className="min-h-screen bg-[#0B1428] flex flex-col items-center justify-center p-4 text-white">
        <div className="w-16 h-16 rounded-[14px] bg-gradient-to-br from-[#D6AD60] to-[#B68936] text-[#0B1428] flex items-center justify-center mb-4 shadow-xl shadow-black/30">
          <Store className="w-8 h-8 stroke-[2.2]" />
        </div>

        <h1 className="text-xl font-bold tracking-tight mb-0.5 text-white">
          {APP_IDENTITY.name}
        </h1>
        <p className="text-xs text-[#D6AD60] mb-5">
          {APP_IDENTITY.subtitle}
        </p>

        <div className="w-56 space-y-2 mb-4">
          <div className="h-2.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full w-2/3 bg-gradient-to-r from-[#087F8C] via-[#10B981] to-[#D6AD60] animate-pulse rounded-full" />
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
          <Loader2 className="w-4 h-4 animate-spin text-[#D6AD60]" />
          <span>Loading your workspace...</span>
        </div>
      </div>
    );
  }

  // Show the password form when the user opens a recovery link.
  if (isSupabaseConfigured && isRecovery) {
    return (
      <AuthModal
        key="password-recovery"
        initialMode="recovery"
        onSuccess={() => {}}
        onRecoveryComplete={() => {
          setIsRecovery(false);
        }}
      />
    );
  }

  // If Supabase is configured and the user is not authenticated, show login/signup screen.
  if (isSupabaseConfigured && !user) {
    return <AuthModal onSuccess={() => {}} />;
  }

  // If initialization failed while checking existing business membership, show retry screen instead of forcing setup
  if (isSupabaseConfigured && user && !isBusinessConfigured && initError) {
    return (
      <div className="min-h-screen bg-[#0B1428] flex flex-col items-center justify-center p-4 text-white text-center">
        <div className="w-16 h-16 rounded-[14px] bg-rose-500/15 text-[#F06464] border border-rose-500/30 flex items-center justify-center mb-4">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold mb-2">Unable to Load Business Workspace</h2>
        <p className="text-sm text-slate-300 max-w-md mb-6">{initError}</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => retryInitialization()}
            className="px-5 py-2.5 bg-gradient-to-r from-[#087F8C] to-[#10B981] hover:brightness-110 text-white text-xs font-bold rounded-[10px] transition-all cursor-pointer"
          >
            Retry Connection
          </button>
          <button
            type="button"
            onClick={() => signOut()}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#101B35] hover:bg-[#1B2C52] text-white text-xs font-semibold rounded-[10px] border border-white/15 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    );
  }

  // If business is not yet configured, show First-Time Business Setup Wizard only to Store Admin
  if (!isBusinessConfigured) {
    if (!isAuthenticatedAdmin || normalizeRoleKey(currentUserRole) !== 'super_admin') {
      return (
        <div className="min-h-screen bg-[#0B1428] flex flex-col items-center justify-center p-4 text-white text-center">
          <div className="w-16 h-16 rounded-[14px] bg-[#D6AD60]/15 text-[#D6AD60] border border-[#D6AD60]/30 flex items-center justify-center mb-4">
            <Store className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold mb-2">Store Setup Pending</h2>
          <p className="text-sm text-slate-300 max-w-md">
            Please ask your store administrator or owner to log in and complete the first-time business setup.
          </p>
          <button
            onClick={() => signOut()}
            className="mt-6 flex items-center gap-2 px-4 py-2 bg-[#101B35] hover:bg-[#1B2C52] text-white text-xs font-semibold rounded-[10px] border border-white/15 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      );
    }
    return <BusinessSetupWizard onCompleted={() => setActiveTab('dashboard')} />;
  }

  const renderContent = () => {
    const activeModule = TAB_TO_MODULE_MAP[activeTab] || 'dashboard';
    if (!canAccess(activeModule)) {
      return (
        <div className="adp-card p-8 text-center max-w-md mx-auto mt-10">
          <div className="w-12 h-12 rounded-[12px] bg-[#F06464]/15 text-[#F06464] flex items-center justify-center mx-auto mb-3">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-[#172033] dark:text-white">Access Denied</h3>
          <p className="text-xs text-[#64748B] dark:text-slate-400 mt-1">
            Your assigned role does not have permission to view this module. Contact the Store Owner to request access.
          </p>
        </div>
      );
    }

    switch (activeTab) {
      case 'dashboard':
        if (isSalesmanOrCashierRole(currentUserRole)) {
          return <SellerDashboardView onOpenPOS={() => handleTabChange('pos')} />;
        }
        return (
          <DashboardView
            onNavigate={handleTabChange}
            onOpenPOS={() => handleTabChange('pos')}
            onOpenAddProduct={() => {
              handleTabChange('products');
              setIsAddProductOpen(true);
            }}
            onOpenAddCustomer={() => {
              handleTabChange('customers');
              setIsAddCustomerOpen(true);
            }}
            onOpenNewPurchase={() => {
              handleTabChange('purchases');
              setIsNewPurchaseOpen(true);
            }}
            onOpenAddExpense={() => {
              handleTabChange('accounts');
              setIsAddExpenseOpen(true);
            }}
          />
        );

      case 'pos':
        return <POSView />;

      case 'sales':
        return <SalesHistoryView />;

      case 'products':
        return (
          <ProductsView
            isAddModalOpen={isAddProductOpen}
            onCloseAddModal={() => setIsAddProductOpen(false)}
          />
        );

      case 'inventory':
        return <InventoryView />;

      case 'purchases':
        return (
          <PurchasesView
            isAddModalOpen={isNewPurchaseOpen}
            onCloseAddModal={() => setIsNewPurchaseOpen(false)}
          />
        );

      case 'customers':
        return (
          <CustomersView
            isAddModalOpen={isAddCustomerOpen}
            onCloseAddModal={() => setIsAddCustomerOpen(false)}
          />
        );

      case 'suppliers':
        return <SuppliersView />;

      case 'accounts':
        return (
          <AccountsView
            isExpenseModalOpen={isAddExpenseOpen}
            onCloseExpenseModal={() => setIsAddExpenseOpen(false)}
          />
        );

      case 'reports':
        return <ReportsView />;

      case 'users':
        return <UserStaffManagementView />;

      case 'employees':
        return <EmployeesView />;

      case 'sellers':
        return <SellerManagementView />;

      case 'branches':
        return <BranchesView />;

      case 'settings':
        return <SettingsView />;

      case 'pricing-calculator':
        return <SmartPricingCalculatorView />;

      case 'returns':
        return <ExchangeReturnView />;

      case 'catalog':
        return <ProductCatalogView onSelectForPOS={() => setActiveTab('pos')} />;

      case 'barcodes':
        return <BarcodeLabelStudio />;

      case 'reorder':
        return <SmartReorderView />;

      case 'combos':
        return <ComboOffersView />;

      default:
        if (isSalesmanOrCashierRole(currentUserRole)) {
          return <SellerDashboardView onOpenPOS={() => handleTabChange('pos')} />;
        }
        return (
          <DashboardView
            onNavigate={handleTabChange}
            onOpenPOS={() => handleTabChange('pos')}
            onOpenAddProduct={() => {
              handleTabChange('products');
              setIsAddProductOpen(true);
            }}
            onOpenAddCustomer={() => {
              handleTabChange('customers');
              setIsAddCustomerOpen(true);
            }}
            onOpenNewPurchase={() => {
              handleTabChange('purchases');
              setIsNewPurchaseOpen(true);
            }}
            onOpenAddExpense={() => {
              handleTabChange('accounts');
              setIsAddExpenseOpen(true);
            }}
          />
        );
    }
  };

  return (
    <div className="h-screen supports-[height:100dvh]:h-dvh overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)] flex flex-col transition-colors duration-200">
      {/* Top Header */}
      <Header
        onOpenPOS={() => handleTabChange('pos')}
        onNavigateTab={handleTabChange}
        activeTab={activeTab}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(prev => !prev)}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={handleTabChange}
          isOpen={isSidebarOpen}
          setIsOpen={setIsSidebarOpen}
        />

        {/* Main Content Viewport */}
        <main
          ref={mainScrollRef}
          className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-auto overscroll-contain p-3 sm:p-5 md:p-6"
        >
          <div className="max-w-[1600px] mx-auto w-full">
            {dbError && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800 shadow-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span className="font-medium truncate">{dbError}</span>
                </div>
                <button
                  type="button"
                  onClick={clearDbError}
                  aria-label="Dismiss database error"
                  className="p-1 rounded-md text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <MainLayout />
      </AppProvider>
    </ThemeProvider>
  );
}
