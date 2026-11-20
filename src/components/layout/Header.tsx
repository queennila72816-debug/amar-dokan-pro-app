import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { UserRole } from '../../types';
import { normalizeRoleKey, roleKeyToLegacyUserRole } from '../../utils/rbacDefaults';
import { APP_IDENTITY } from '../../config/appIdentity';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  Store,
  ShoppingCart,
  Globe,
  Shield,
  SlidersHorizontal,
  Building2,
  LogOut,
  Lock,
  Bell,
  Sun,
  Moon,
  AlertTriangle,
  Boxes,
  Users,
  Menu,
  X,
  ChevronRight,
  Cloud,
  HardDrive,
  Crown,
  Plus,
  Briefcase,
} from 'lucide-react';

interface HeaderProps {
  onOpenPOS: () => void;
  onNavigateTab: (tab: string) => void;
  activeTab: string;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenPOS,
  onNavigateTab,
  activeTab,
  isSidebarOpen = false,
  onToggleSidebar,
}) => {
  const {
    settings,
    updateSettings,
    currentUserRole,
    setCurrentUserRole,
    isAuthenticatedAdmin,
    roles,
    activeRoleDefinition,
    currentEmployee,
    hasPermission,
    branches,
    activeBranchId,
    setActiveBranchId,
    products,
    customers,
    user,
    signOut,
    isPlatformAdmin,
    platformViewActive,
    setPlatformViewActive,
    userBusinesses,
    activeBusinessId,
    switchBusiness,
    setCreateNewBusinessModalOpen,
    activeSubscription,
  } = useApp();

  const { theme, toggleTheme } = useTheme();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const normalizedRole = normalizeRoleKey(currentUserRole);
  const canOpenPOS = hasPermission('pos_new_sale', 'view');
  const displayName =
    currentEmployee?.name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    (normalizedRole === 'super_admin' ? 'Store Admin' : activeRoleDefinition?.name || 'Staff');
  const displayRoleLabel =
    activeRoleDefinition?.name || (normalizedRole === 'super_admin' ? 'Super Admin' : currentUserRole);

  // Real database alert notifications
  const alerts = useMemo(() => {
    const outOfStock = products.filter(p => p.isActive !== false && p.currentStock <= 0).length;
    const lowStock = products.filter(p => p.isActive !== false && p.currentStock > 0 && p.currentStock <= p.minStockAlert).length;
    const dueCustomers = customers.filter(c => c.currentDue > 0).length;
    const lossMaking = products.filter(
      p => p.isActive !== false && p.salePrice > 0 && p.salePrice < (p.totalUnitCost || p.purchasePrice)
    ).length;

    const list: {
      id: string;
      title: string;
      detail: string;
      tab: string;
      tone: 'coral' | 'amber' | 'purple';
    }[] = [];

    if (outOfStock > 0 || lowStock > 0) {
      list.push({
        id: 'stock',
        title: `${outOfStock + lowStock} Inventory Stock Alert${outOfStock + lowStock === 1 ? '' : 's'}`,
        detail: `${outOfStock} out of stock, ${lowStock} low stock`,
        tab: 'reorder',
        tone: outOfStock > 0 ? 'coral' : 'amber',
      });
    }
    if (lossMaking > 0) {
      list.push({
        id: 'pricing',
        title: `${lossMaking} Below Break-Even Product${lossMaking === 1 ? '' : 's'}`,
        detail: 'Review pricing in Smart Price Calculator',
        tab: 'pricing-calculator',
        tone: 'coral',
      });
    }
    if (dueCustomers > 0) {
      list.push({
        id: 'dues',
        title: `${dueCustomers} Customer Due Account${dueCustomers === 1 ? '' : 's'}`,
        detail: 'Pending receivable balances ready for collection',
        tab: 'customers',
        tone: 'amber',
      });
    }
    return list;
  }, [products, customers]);

  useEffect(() => {
    if (!notificationsOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [notificationsOpen]);

  return (
    <header className="h-14 sm:h-16 shrink-0 bg-[#101B35] text-white border-b border-[#D6AD60]/25 px-3 sm:px-4 md:px-6 flex items-center justify-between gap-2 sticky top-0 z-40 select-none shadow-sm">
      {/* Zone 1: Fixed Application Identity & Mobile Menu Trigger */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={isSidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="lg:hidden p-2 rounded-[10px] bg-white/10 hover:bg-white/15 border border-white/15 text-white transition-colors cursor-pointer"
          >
            {isSidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            if (platformViewActive && userBusinesses.length > 0) {
              setPlatformViewActive(false);
            }
            onNavigateTab('dashboard');
          }}
          className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-[11px] bg-gradient-to-br from-[#D6AD60] to-[#B68936] flex items-center justify-center text-[#0B1428] shadow-md shadow-black/25 shrink-0 transition-transform duration-150 group-hover:scale-[1.03]">
            {platformViewActive ? (
              <Crown className="w-5 h-5 stroke-[2.2]" />
            ) : (
              <Store className="w-5 h-5 stroke-[2.2]" />
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm sm:text-base font-bold tracking-tight text-white leading-tight truncate whitespace-nowrap">
              {APP_IDENTITY.name}
            </span>
            <span className="text-[10.5px] font-medium text-[#D6AD60] hidden sm:inline truncate tracking-wide">
              {platformViewActive ? 'Platform Super Admin Console' : APP_IDENTITY.subtitle}
            </span>
          </div>
        </button>
      </div>

      {/* Zone 2: Multi-Business Switcher, Branch, Mode, Role Preview & Language */}
      <div className="hidden lg:flex items-center gap-2">
        {!platformViewActive ? (
          <>
            {/* Multi-Business Switcher + New Business */}
            {(userBusinesses.length > 0 || isAuthenticatedAdmin) && (
              <div className="flex items-center gap-1 px-2 py-1.5 bg-[#0B1428]/70 rounded-[10px] border border-white/15 text-xs text-slate-200 hover:border-[#D6AD60]/45 transition-colors">
                <Briefcase className="w-3.5 h-3.5 text-[#D6AD60] shrink-0" />
                <select
                  aria-label="Switch Business"
                  value={activeBusinessId}
                  onChange={(e) => switchBusiness(e.target.value)}
                  className="bg-transparent font-semibold text-white focus:outline-none cursor-pointer pr-1 max-w-[135px] truncate [&>option]:bg-[#101B35] [&>option]:text-white"
                >
                  {userBusinesses.length === 0 ? (
                    <option value={activeBusinessId || ''}>{settings.shopName || 'Current Shop'}</option>
                  ) : (
                    userBusinesses.map(b => (
                      <option key={b.businessId} value={b.businessId}>
                        {b.businessName}
                      </option>
                    ))
                  )}
                </select>
                {isAuthenticatedAdmin && (
                  <button
                    type="button"
                    onClick={() => setCreateNewBusinessModalOpen(true)}
                    title="Create additional business / shop"
                    className="ml-0.5 p-1 rounded-[7px] bg-[#D6AD60]/20 hover:bg-[#D6AD60]/35 text-[#F5DC9F] transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            {/* Branch Selector */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0B1428]/70 rounded-[10px] border border-white/15 text-xs text-slate-200 hover:border-[#D6AD60]/45 transition-colors">
              <Building2 className="w-3.5 h-3.5 text-[#D6AD60] shrink-0" />
              <span className="text-slate-400 text-[11px]">Branch:</span>
              <select
                aria-label="Select Branch"
                value={activeBranchId}
                onChange={(e) => setActiveBranchId(e.target.value)}
                className="bg-transparent font-semibold text-white focus:outline-none cursor-pointer pr-1 max-w-[120px] [&>option]:bg-[#101B35] [&>option]:text-white"
              >
                {branches.length === 0 ? (
                  <option value="">No Branch</option>
                ) : (
                  branches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Active SaaS Plan Trigger */}
            {activeSubscription && (
              <button
                type="button"
                onClick={() => onNavigateTab('billing')}
                title="View SaaS Plan, Quota & Support"
                className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] border border-[#D6AD60]/35 bg-[#D6AD60]/12 hover:bg-[#D6AD60]/22 text-[#F5DC9F] text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer"
              >
                <Crown className="w-3.5 h-3.5 text-[#D6AD60]" />
                <span>{activeSubscription.plan?.name || activeSubscription.planCode}</span>
              </button>
            )}

            {/* Advanced Settings / UI Mode Toggle */}
            <button
              type="button"
              onClick={() => updateSettings({ uiMode: settings.uiMode === 'easy' ? 'advanced' : 'easy' })}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                settings.uiMode === 'easy'
                  ? 'bg-[#D6AD60]/20 text-[#F5DC9F] border-[#D6AD60]/50 hover:bg-[#D6AD60]/30'
                  : 'bg-[#0B1428]/70 text-slate-200 border-white/15 hover:border-[#087F8C]'
              }`}
              title="Toggle Easy / Advanced interface mode"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#D6AD60]" />
              <span>{settings.uiMode === 'easy' ? 'Easy Mode' : 'Advanced'}</span>
            </button>

            {/* Role Preview (Admin only) */}
            {isAuthenticatedAdmin ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0B1428]/70 rounded-[10px] border border-white/15 text-xs hover:border-[#D6AD60]/45 transition-colors">
                <Shield className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                <span className="text-slate-400 text-[11px]">Role:</span>
                <select
                  aria-label="Select User Role"
                  value={normalizedRole}
                  onChange={(e) => setCurrentUserRole(roleKeyToLegacyUserRole(e.target.value) as UserRole)}
                  className="bg-transparent font-semibold text-white focus:outline-none cursor-pointer pr-1 [&>option]:bg-[#101B35] [&>option]:text-white"
                >
                  {roles.map(r => (
                    <option key={r.id} value={r.roleKey}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0B1428]/70 rounded-[10px] border border-white/15 text-xs text-slate-200"
                title="Role is enforced by Store Administrator"
              >
                <Lock className="w-3.5 h-3.5 text-[#D6AD60]" />
                <span className="font-semibold whitespace-nowrap">{displayRoleLabel}</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-[10px] bg-[#D6AD60]/15 border border-[#D6AD60]/40 text-xs font-semibold text-[#F5DC9F]">
            <Crown className="w-3.5 h-3.5 text-[#D6AD60]" />
            <span>Multi-Tenant Platform Governance Mode</span>
          </div>
        )}

        {/* Language Selector */}
        <div className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-[10px] text-slate-200 bg-[#0B1428]/70 border border-white/15 hover:border-[#087F8C] transition-colors">
          <Globe className="w-3.5 h-3.5 text-[#087F8C] shrink-0" />
          <select
            aria-label="Select Language"
            value={settings.language || 'en'}
            onChange={(e) => updateSettings({ language: e.target.value as 'en' | 'bn' })}
            className="bg-transparent font-medium text-white focus:outline-none cursor-pointer [&>option]:bg-[#101B35] [&>option]:text-white"
          >
            <option value="en">English</option>
            <option value="bn">বাংলা</option>
          </select>
        </div>

        {/* Storage Mode Status Indicator */}
        {isSupabaseConfigured ? (
          <div
            className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] border border-[#10B981]/35 bg-[#10B981]/10 text-[#6EE7B7] text-[11px] font-semibold whitespace-nowrap"
            title="Connected to Supabase cloud database"
          >
            <Cloud className="w-3.5 h-3.5 shrink-0" />
            <span>Cloud Synced</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onNavigateTab('settings')}
            className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] border border-[#F59E0B]/40 bg-[#F59E0B]/15 text-[#FDE68A] text-[11px] font-semibold whitespace-nowrap hover:bg-[#F59E0B]/25 transition-colors cursor-pointer"
            title="Temporary local browser storage active — Supabase environment variables not configured"
          >
            <HardDrive className="w-3.5 h-3.5 shrink-0" />
            <span>Local Mode (Browser Only)</span>
          </button>
        )}
      </div>

      {/* Zone 3: Platform Toggle, Theme, Notifications, New Sale CTA, Profile & Logout */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {isPlatformAdmin && (
          platformViewActive ? (
            userBusinesses.length > 0 ? (
              <button
                type="button"
                onClick={() => setPlatformViewActive(false)}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-bold rounded-[10px] bg-[#0B1428]/80 hover:bg-[#1B2C52] text-[#F5DC9F] border border-[#D6AD60]/45 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Store className="w-3.5 h-3.5 text-[#D6AD60]" />
                <span className="hidden sm:inline">My Shop</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCreateNewBusinessModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-bold rounded-[10px] bg-[#0B1428]/80 hover:bg-[#1B2C52] text-[#F5DC9F] border border-[#D6AD60]/45 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#D6AD60]" />
                <span className="hidden sm:inline">Create Shop</span>
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => setPlatformViewActive(true)}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-bold rounded-[10px] bg-[#D6AD60] hover:brightness-105 text-[#0B1428] transition-all whitespace-nowrap cursor-pointer"
            >
              <Crown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Platform Console</span>
            </button>
          )
        )}

        {/* Light / Dark Theme Switcher */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="p-2 rounded-[10px] bg-[#0B1428]/70 hover:bg-[#1B2C52] border border-white/15 hover:border-[#D6AD60]/50 text-[#D6AD60] transition-colors cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Notifications Bell (Real Database Alerts) */}
        {!platformViewActive && (
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setNotificationsOpen(v => !v)}
              aria-label="Notifications"
              title="Operational Notifications"
              className="relative p-2 rounded-[10px] bg-[#0B1428]/70 hover:bg-[#1B2C52] border border-white/15 hover:border-[#D6AD60]/50 text-slate-200 transition-colors cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {alerts.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#F06464] text-white text-[9.5px] font-bold flex items-center justify-center shadow-xs">
                  {alerts.length}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div className="adp-dropdown-enter absolute right-0 mt-2 w-80 bg-white dark:bg-[#101B35] text-[#172033] dark:text-white rounded-[14px] border border-[#E2E8F0] dark:border-[#1F3158] shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 bg-[#101B35] text-white border-b border-[#D6AD60]/25 flex items-center justify-between">
                  <span className="text-xs font-bold tracking-wide">Business Alerts</span>
                  <span className="text-[10px] font-semibold text-[#D6AD60]">
                    {alerts.length} active
                  </span>
                </div>
                <div className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158] max-h-72 overflow-y-auto">
                  {alerts.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#64748B] dark:text-slate-400">
                      All inventory, pricing, and accounts look healthy.
                    </div>
                  ) : (
                    alerts.map(al => (
                      <button
                        key={al.id}
                        type="button"
                        onClick={() => {
                          onNavigateTab(al.tab);
                          setNotificationsOpen(false);
                        }}
                        className="w-full p-3 text-left flex items-start justify-between gap-2.5 hover:bg-slate-50 dark:hover:bg-[#162344] transition-colors cursor-pointer"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div
                            className={`w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0 mt-0.5 ${
                              al.tone === 'coral'
                                ? 'bg-[#F06464]/15 text-[#F06464]'
                                : 'bg-[#F59E0B]/15 text-[#F59E0B]'
                            }`}
                          >
                            {al.id === 'stock' ? (
                              <Boxes className="w-3.5 h-3.5" />
                            ) : al.id === 'dues' ? (
                              <Users className="w-3.5 h-3.5" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold truncate">{al.title}</div>
                            <div className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                              {al.detail}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Primary POS CTA */}
        {!platformViewActive && canOpenPOS && (
          activeTab !== 'pos' ? (
            <button
              type="button"
              onClick={onOpenPOS}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 text-xs font-bold text-white bg-gradient-to-r from-[#087F8C] to-[#10B981] hover:brightness-110 active:scale-[0.98] transition-all rounded-[10px] shadow-md shadow-black/25 border border-[#D6AD60]/35 whitespace-nowrap cursor-pointer"
            >
              <ShoppingCart className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">New Sale (POS)</span>
              <span className="sm:hidden">POS</span>
            </button>
          ) : (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#087F8C]/30 text-[#5EEAD4] border border-[#087F8C] rounded-[10px] text-xs font-semibold whitespace-nowrap">
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>POS Active</span>
            </span>
          )
        )}

        {/* User Profile */}
        <div className="flex items-center gap-2 px-2 py-1 rounded-[10px] bg-[#0B1428]/70 border border-white/15">
          <div className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-[#D6AD60] to-[#B68936] text-[#0B1428] font-extrabold text-xs flex items-center justify-center shrink-0">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="hidden md:flex flex-col min-w-0 text-left">
            <span className="text-xs font-semibold text-white truncate max-w-[110px] leading-tight">
              {displayName}
            </span>
            <span className="text-[10px] text-[#D6AD60] truncate max-w-[110px] leading-tight">
              {normalizedRole === 'super_admin' ? 'Admin' : displayRoleLabel}
            </span>
          </div>
        </div>

        {/* Logout */}
        <button
          type="button"
          onClick={() => signOut()}
          title={user ? `Signed in as ${user.email}. Click to Logout` : 'Logout'}
          className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:bg-[#F06464]/20 hover:border-[#F06464]/50 rounded-[10px] border border-white/15 bg-[#0B1428]/60 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden xl:inline">Logout</span>
        </button>
      </div>
    </header>
  );
};
