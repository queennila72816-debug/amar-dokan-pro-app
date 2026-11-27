import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Package,
  Boxes,
  Truck,
  Users,
  Building,
  Wallet,
  TrendingUp,
  UserCheck,
  UserCog,
  GitFork,
  Settings,
  Calculator,
  Barcode,
  Images,
  RotateCcw,
  Bell,
  Gift,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Crown,
  ScanBarcode,
  CalendarClock,
} from 'lucide-react';
import { LegacyAppModule } from '../../utils/rbacDefaults';
import { getBusinessDisplayName } from '../../config/appIdentity';
import { getModuleTheme } from '../../config/moduleTheme';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, isOpen, setIsOpen }) => {
  const { settings, products, customers, installmentAgreements, canAccess, currentUserRole, activeRoleDefinition, branches, activeBranchId } = useApp();
  const [collapsed, setCollapsed] = useState(false);

  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];
  const lowStockCount = products.filter(p => p.isActive !== false && p.currentStock <= p.minStockAlert).length;
  const dueCustomerCount = customers.filter(c => c.currentDue > 0).length;
  const overdueInstallmentCount = installmentAgreements.filter(a => a.status !== 'paid' && a.overdueAmount > 0).length;

  interface NavItem {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    moduleKey: LegacyAppModule;
    group: string;
  }

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, moduleKey: 'dashboard', group: 'Overview' },
    { id: 'pos', label: 'POS / New Sale', icon: ShoppingCart, moduleKey: 'pos', group: 'Sales & POS' },
    { id: 'scanner', label: 'Barcode & QR Scanner', icon: ScanBarcode, moduleKey: 'scanner', group: 'Sales & POS' },
    { id: 'sales', label: 'Sales & Invoices', icon: Receipt, moduleKey: 'sales', group: 'Sales & POS' },
    { id: 'installments', label: 'Installment Sales', icon: CalendarClock, badge: overdueInstallmentCount > 0 ? overdueInstallmentCount : undefined, moduleKey: 'installments', group: 'Sales & POS' },
    { id: 'returns', label: 'Exchange & Returns', icon: RotateCcw, moduleKey: 'returns', group: 'Sales & POS' },
    { id: 'products', label: 'Products & Variants', icon: Package, moduleKey: 'products', group: 'Catalog & Pricing' },
    { id: 'catalog', label: 'Apparel Photo Catalog', icon: Images, moduleKey: 'catalog', group: 'Catalog & Pricing' },
    { id: 'barcodes', label: 'Barcode Label Studio', icon: Barcode, moduleKey: 'barcodes', group: 'Catalog & Pricing' },
    { id: 'reorder', label: 'Smart Reorder Alerts', icon: Bell, badge: lowStockCount > 0 ? lowStockCount : undefined, moduleKey: 'reorder', group: 'Inventory & Stock' },
    { id: 'pricing-calculator', label: 'Smart Price Calculator', icon: Calculator, moduleKey: 'pricing', group: 'Catalog & Pricing' },
    { id: 'combos', label: 'Combo & Bundle Offers', icon: Gift, moduleKey: 'combos', group: 'Catalog & Pricing' },
    { id: 'inventory', label: 'Stock & Inventory', icon: Boxes, moduleKey: 'stock', group: 'Inventory & Stock' },
    { id: 'purchases', label: 'Purchases', icon: Truck, moduleKey: 'purchases', group: 'Supply & Parties' },
    { id: 'customers', label: 'Customers & Due Ledger', icon: Users, badge: dueCustomerCount > 0 ? dueCustomerCount : undefined, moduleKey: 'customers', group: 'Supply & Parties' },
    { id: 'suppliers', label: 'Suppliers', icon: Building, moduleKey: 'suppliers', group: 'Supply & Parties' },
    { id: 'accounts', label: 'Expenses & Accounts', icon: Wallet, moduleKey: 'accounts', group: 'Finance & Reports' },
    { id: 'reports', label: 'Reports & Analytics', icon: TrendingUp, moduleKey: 'reports', group: 'Finance & Reports' },
    { id: 'users', label: 'User Roles & Permissions', icon: ShieldCheck, moduleKey: 'users', group: 'Team & Settings' },
    { id: 'employees', label: 'Employees & Staff', icon: UserCheck, moduleKey: 'employees', group: 'Team & Settings' },
    { id: 'sellers', label: 'Seller Management', icon: UserCog, moduleKey: 'sellers', group: 'Team & Settings' },
    { id: 'branches', label: 'Branches & Transfer', icon: GitFork, moduleKey: 'branches', group: 'Team & Settings' },
    { id: 'settings', label: 'Shop Settings', icon: Settings, moduleKey: 'settings', group: 'Team & Settings' },
    { id: 'billing', label: 'Plan & Support', icon: Crown, moduleKey: 'billing', group: 'Team & Settings' },
  ];

  const visibleItems = navItems.filter(item => canAccess(item.moduleKey));

  const groups = Array.from(new Set(visibleItems.map(i => i.group)));

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-[#0A122C]/70 z-40 lg:hidden backdrop-blur-xs"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Deep Navy Collapsible Sidebar */}
      <aside
        className={`fixed lg:static top-14 sm:top-16 bottom-0 left-0 z-40 lg:h-full min-h-0 overflow-hidden overscroll-contain bg-[#101B3F] border-r border-[#243B70]/70 text-[#E2E8F0] flex flex-col transition-all duration-200 ease-in-out shrink-0 ${
          collapsed ? 'w-[76px]' : 'w-64'
        } ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Navigation List */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain adp-navy-scroll pt-3 pb-3 px-2.5 space-y-4">
          {groups.map(groupName => {
            const groupItems = visibleItems.filter(i => i.group === groupName);
            return (
              <div key={groupName} className="space-y-1">
                {!collapsed && (
                  <div className="px-2.5 pb-1 text-[10px] font-semibold tracking-wider text-[#94A3B8]">
                    {groupName}
                  </div>
                )}
                {groupItems.map(item => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  const modTheme = getModuleTheme(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={collapsed ? item.label : undefined}
                      onClick={() => {
                        setActiveTab(item.id);
                        setIsOpen(false);
                      }}
                      className={`group w-full flex items-center ${
                        collapsed ? 'justify-center px-2' : 'justify-between px-3'
                      } py-2.5 rounded-[10px] text-xs md:text-[13px] font-medium transition-all duration-150 cursor-pointer border ${
                        isActive
                          ? `bg-[#243B70] ${modTheme.sidebarActiveBg} ${modTheme.sidebarActiveBorder} text-white font-semibold shadow-sm`
                          : 'border-transparent text-[#CBD5E1] hover:text-white hover:bg-[#192A56]'
                      }`}
                    >
                      <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} min-w-0`}>
                        <Icon
                          className={`w-4 h-4 shrink-0 transition-transform duration-150 group-hover:scale-105 ${
                            isActive ? modTheme.sidebarIconColor : 'text-[#94A3B8] group-hover:text-[#E2E8F0]'
                          }`}
                        />
                        {!collapsed && (
                          <span className="truncate whitespace-nowrap">{item.label}</span>
                        )}
                      </div>

                      {!collapsed && item.badge !== undefined && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-[6px] shrink-0 font-mono-num ${modTheme.sidebarBadgeBg}`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Bottom Active Business & Role Info */}
        <div className="shrink-0 p-3 border-t border-[#243B70]/70 bg-[#0B1536]">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                aria-label="Expand sidebar"
                title="Expand sidebar"
                className="hidden lg:flex w-8 h-8 rounded-[8px] items-center justify-center text-[#94A3B8] hover:text-[#FF9D32] hover:bg-[#243B70] transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <div
                className="w-9 h-9 mx-auto rounded-[10px] bg-[#243B70] border border-[#FF9D32]/35 flex items-center justify-center text-[#FF9D32] font-bold text-xs"
                title={`${getBusinessDisplayName(settings)} (${activeBranch?.name || 'Main'})`}
              >
                {getBusinessDisplayName(settings).slice(0, 1).toUpperCase()}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <div className="text-[10px] font-semibold tracking-wider text-[#FF9D32]">
                  Active Business
                </div>
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  aria-label="Collapse sidebar"
                  title="Collapse sidebar"
                  className="hidden lg:flex w-6 h-6 rounded-[7px] items-center justify-center text-[#94A3B8] hover:text-[#FF9D32] hover:bg-[#243B70] transition-colors cursor-pointer shrink-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
              <div className="text-xs text-white font-semibold truncate">
                {getBusinessDisplayName(settings)}
              </div>
              {activeBranch && (
                <div className="mt-0.5 text-[11px] text-[#94A3B8] truncate">
                  Branch: {activeBranch.name}
                </div>
              )}
              <div className="mt-2 pt-2 border-t border-[#243B70]/70 text-[11px] text-[#94A3B8] flex items-center justify-between gap-2">
                <span className="shrink-0">Role:</span>
                <span className="font-semibold text-white truncate">
                  {activeRoleDefinition?.name || currentUserRole}
                </span>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
};
