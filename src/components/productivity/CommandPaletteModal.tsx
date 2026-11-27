import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Boxes,
  Clock,
  Command,
  Focus,
  Keyboard,
  Maximize2,
  PackagePlus,
  Plus,
  Receipt,
  RefreshCw,
  ScanBarcode,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  SunMoon,
  UserPlus,
  Volume2,
  VolumeX,
  Wallet,
  Wifi,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useProductivity } from '../../context/ProductivityContext';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { LegacyAppModule } from '../../utils/rbacDefaults';

interface PaletteItem {
  id: string;
  section: 'Quick Actions' | 'Modules' | 'Inventory Products' | 'Recent Activities';
  title: string;
  subtitle: string;
  shortcut?: string;
  keywords: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}

export const CommandPaletteModal: React.FC = () => {
  const {
    canAccess,
    hasPermission,
    products,
    activityLogs,
    auditLogs,
    sales,
    settings,
    setPendingPosSelection,
    syncNow,
    isOnline,
  } = useApp();
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    navigationHandlers,
    getShortcutCombo,
    triggerQuickAction,
    setPreferencesOpen,
    setSystemStatusOpen,
    setShortcutsHelpOpen,
    prefs,
    toggleMute,
    showToast,
  } = useProductivity();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [commandPaletteOpen]);

  const recentFeed = useMemo(() => {
    const items: Array<{ id: string; title: string; subtitle: string; tab?: string; ts: string }> = [];

    activityLogs.slice(0, 5).forEach(log => {
      items.push({
        id: `act-${log.id}`,
        title: log.details || `${log.eventType} (${log.moduleKey})`,
        subtitle: `${log.employeeName || 'User'} · ${formatDate(log.createdAt, 'en')}`,
        ts: log.createdAt,
      });
    });

    if (items.length === 0) {
      auditLogs.slice(0, 5).forEach(log => {
        items.push({
          id: `aud-${log.id}`,
          title: log.details || log.action,
          subtitle: `${log.entityType} · ${formatDate(log.date, 'en')}`,
          ts: log.date,
        });
      });
    }

    if (items.length < 4) {
      sales.slice(0, 4).forEach(s => {
        items.push({
          id: `sale-${s.id}`,
          title: `Invoice ${s.invoiceNumber} · ${s.customerName}`,
          subtitle: `${formatCurrency(s.total, settings.language)} · ${formatDate(s.date, 'en')}`,
          tab: canAccess('sales') ? 'sales' : undefined,
          ts: s.date,
        });
      });
    }

    return items.slice(0, 6);
  }, [activityLogs, auditLogs, sales, settings.language, canAccess]);

  const allItems = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];
    const closeAndRun = (fn: () => void) => () => {
      setCommandPaletteOpen(false);
      fn();
    };

    // 1. Quick Actions (Permission-aware)
    if (canAccess('pos')) {
      list.push({
        id: 'qa-pos',
        section: 'Quick Actions',
        title: 'Quick POS Billing (New Sale)',
        subtitle: 'Open point-of-sale checkout terminal immediately',
        shortcut: getShortcutCombo('go_pos'),
        keywords: 'pos billing new sale checkout cashier',
        icon: ShoppingCart,
        onSelect: closeAndRun(() => navigationHandlers.onOpenPOS()),
      });
    }
    if (canAccess('scanner')) {
      list.push({
        id: 'qa-scanner',
        section: 'Quick Actions',
        title: 'Barcode & QR Scanner',
        subtitle: 'Scan products using camera or USB scanner',
        shortcut: getShortcutCombo('open_scanner'),
        keywords: 'scan barcode qr camera usb',
        icon: ScanBarcode,
        onSelect: closeAndRun(() => triggerQuickAction('open_scanner')),
      });
    }
    if (canAccess('products') && hasPermission('product_management', 'create')) {
      list.push({
        id: 'qa-new-product',
        section: 'Quick Actions',
        title: 'New Product',
        subtitle: 'Create inventory item, variants & pricing',
        shortcut: getShortcutCombo('new_product'),
        keywords: 'add create product sku inventory',
        icon: PackagePlus,
        onSelect: closeAndRun(() => navigationHandlers.onOpenNewProduct()),
      });
    }
    if (canAccess('customers') && hasPermission('customer_management', 'create')) {
      list.push({
        id: 'qa-new-customer',
        section: 'Quick Actions',
        title: 'New Customer',
        subtitle: 'Register customer account & due ledger',
        shortcut: getShortcutCombo('new_customer'),
        keywords: 'add create customer client due',
        icon: UserPlus,
        onSelect: closeAndRun(() => navigationHandlers.onOpenNewCustomer()),
      });
    }
    if (canAccess('purchases') && hasPermission('purchase_management', 'create')) {
      list.push({
        id: 'qa-new-purchase',
        section: 'Quick Actions',
        title: 'New Purchase Order',
        subtitle: 'Record supplier stock purchase',
        shortcut: getShortcutCombo('new_purchase'),
        keywords: 'add create purchase po supplier restock',
        icon: ShoppingBag,
        onSelect: closeAndRun(() => navigationHandlers.onOpenNewPurchase()),
      });
    }
    if (canAccess('accounts') && hasPermission('expense_management', 'create')) {
      list.push({
        id: 'qa-new-expense',
        section: 'Quick Actions',
        title: 'New Expense',
        subtitle: 'Log operating expense or payment voucher',
        shortcut: getShortcutCombo('new_expense'),
        keywords: 'add create expense cost account voucher',
        icon: Wallet,
        onSelect: closeAndRun(() => navigationHandlers.onOpenNewExpense()),
      });
    }

    // Productivity & Display Actions
    list.push({
      id: 'qa-theme',
      section: 'Quick Actions',
      title: 'Cycle Theme (Light / Dark / System)',
      subtitle: `Current: ${prefs.themeMode}`,
      shortcut: getShortcutCombo('toggle_theme'),
      keywords: 'theme dark light system appearance mode',
      icon: SunMoon,
      onSelect: closeAndRun(() => triggerQuickAction('toggle_theme')),
    });
    list.push({
      id: 'qa-focus',
      section: 'Quick Actions',
      title: prefs.focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode',
      subtitle: 'Hide sidebar for clean, distraction-free billing',
      shortcut: getShortcutCombo('toggle_focus_mode'),
      keywords: 'focus mode zen hide sidebar clean',
      icon: Focus,
      onSelect: closeAndRun(() => triggerQuickAction('toggle_focus_mode')),
    });
    list.push({
      id: 'qa-fullscreen',
      section: 'Quick Actions',
      title: 'Toggle Full Screen',
      subtitle: 'Expand workspace across entire screen',
      shortcut: getShortcutCombo('toggle_fullscreen'),
      keywords: 'fullscreen expand screen maximize',
      icon: Maximize2,
      onSelect: closeAndRun(() => triggerQuickAction('toggle_fullscreen')),
    });
    list.push({
      id: 'qa-mute',
      section: 'Quick Actions',
      title: prefs.sound.muted ? 'Unmute Sound Effects' : 'Mute Sound Effects',
      subtitle: 'Toggle audio feedback quickly',
      keywords: 'sound mute audio beep silent',
      icon: prefs.sound.muted ? VolumeX : Volume2,
      onSelect: closeAndRun(() => toggleMute()),
    });
    list.push({
      id: 'qa-sound-prefs',
      section: 'Quick Actions',
      title: 'Sound, Vibration & Interaction Settings',
      subtitle: 'Adjust volume, test 8 retail sounds & haptics',
      keywords: 'sound effects volume vibration haptic preferences settings',
      icon: Settings,
      onSelect: closeAndRun(() => setPreferencesOpen(true)),
    });
    list.push({
      id: 'qa-shortcuts',
      section: 'Quick Actions',
      title: 'Keyboard Shortcuts & Custom Keys',
      subtitle: 'View & customize F1–F12, Ctrl+K, Ctrl+S, Ctrl+P',
      shortcut: getShortcutCombo('open_shortcuts_help'),
      keywords: 'keyboard shortcuts keymap hotkeys help f1',
      icon: Keyboard,
      onSelect: closeAndRun(() => setShortcutsHelpOpen(true)),
    });
    list.push({
      id: 'qa-status',
      section: 'Quick Actions',
      title: 'System, Cloud Sync & Printer Status',
      subtitle: isOnline ? 'Online · Check Supabase & Printer guidance' : 'Offline Mode',
      shortcut: getShortcutCombo('open_system_status'),
      keywords: 'system status supabase sync internet printer thermal',
      icon: Wifi,
      onSelect: closeAndRun(() => setSystemStatusOpen(true)),
    });
    list.push({
      id: 'qa-sync-now',
      section: 'Quick Actions',
      title: 'Sync Cloud Data Now',
      subtitle: 'Refresh Supabase products, sales & orders immediately',
      keywords: 'sync cloud refresh supabase',
      icon: RefreshCw,
      onSelect: closeAndRun(async () => {
        const res = await syncNow();
        showToast({
          tone: res.success ? 'success' : 'warning',
          title: res.success ? 'Cloud Sync Complete' : 'Sync Notice',
          message: res.message,
        });
      }),
    });

    // 2. Modules
    const modules: Array<{ id: string; label: string; desc: string; mod: LegacyAppModule }> = [
      { id: 'dashboard', label: 'Dashboard', desc: 'Executive KPIs & Charts', mod: 'dashboard' },
      { id: 'sales', label: 'Sales & Invoices', desc: 'View invoices & receipts', mod: 'sales' },
      { id: 'products', label: 'Products & Variants', desc: 'Catalog & SKU pricing', mod: 'products' },
      { id: 'inventory', label: 'Stock & Inventory', desc: 'Stock levels & adjustments', mod: 'stock' },
      { id: 'reorder', label: 'Smart Reorder Alerts', desc: 'Low-stock replenishment', mod: 'reorder' },
      { id: 'combos', label: 'Combo & Bundle Offers', desc: 'Custom combos, posters & orders', mod: 'combos' },
      { id: 'barcodes', label: 'Barcode Label Studio', desc: 'Print 40x30mm barcode & QR labels', mod: 'barcodes' },
      { id: 'customers', label: 'Customers & Due Ledger', desc: 'Balances & collections', mod: 'customers' },
      { id: 'suppliers', label: 'Suppliers', desc: 'Vendor accounts & payables', mod: 'suppliers' },
      { id: 'purchases', label: 'Purchases', desc: 'Purchase orders', mod: 'purchases' },
      { id: 'accounts', label: 'Expenses & Accounts', desc: 'Cash/Bank & expense entries', mod: 'accounts' },
      { id: 'reports', label: 'Reports & Analytics', desc: 'Financial & sales reports', mod: 'reports' },
      { id: 'settings', label: 'Shop Settings', desc: 'Business profile & printer config', mod: 'settings' },
    ];

    modules.forEach(m => {
      if (!canAccess(m.mod)) return;
      list.push({
        id: `mod-${m.id}`,
        section: 'Modules',
        title: `Go to ${m.label}`,
        subtitle: m.desc,
        keywords: `${m.label} ${m.desc} ${m.id} navigate open`,
        icon: ArrowRight,
        onSelect: closeAndRun(() => navigationHandlers.onNavigateTab(m.id)),
      });
    });

    // 3. Matching Products when user types a query
    const q = query.trim().toLowerCase();
    if (q.length >= 2 && (canAccess('pos') || canAccess('products'))) {
      products
        .filter(
          p =>
            p.isActive !== false &&
            (p.name.toLowerCase().includes(q) ||
              (p.code || '').toLowerCase().includes(q) ||
              (p.barcode || '').toLowerCase().includes(q))
        )
        .slice(0, 6)
        .forEach(p => {
          list.push({
            id: `prod-${p.id}`,
            section: 'Inventory Products',
            title: p.name,
            subtitle: `SKU: ${p.code} · Stock: ${p.currentStock} ${p.unit} · ${formatCurrency(p.salePrice, settings.language)}`,
            keywords: `${p.name} ${p.code} ${p.barcode || ''} ${p.category}`,
            icon: Boxes,
            onSelect: closeAndRun(() => {
              if (canAccess('pos') && p.currentStock > 0) {
                setPendingPosSelection({ productId: p.id });
                navigationHandlers.onOpenPOS();
              } else {
                navigationHandlers.onNavigateTab('products');
              }
            }),
          });
        });
    }

    // 4. Recent Activities
    recentFeed.forEach(item => {
      list.push({
        id: item.id,
        section: 'Recent Activities',
        title: item.title,
        subtitle: item.subtitle,
        keywords: `${item.title} ${item.subtitle} recent activity`,
        icon: Activity,
        onSelect: closeAndRun(() => {
          if (item.tab) navigationHandlers.onNavigateTab(item.tab);
        }),
      });
    });

    return list;
  }, [
    canAccess,
    hasPermission,
    products,
    query,
    recentFeed,
    settings.language,
    getShortcutCombo,
    navigationHandlers,
    triggerQuickAction,
    prefs.themeMode,
    prefs.focusMode,
    prefs.sound.muted,
    toggleMute,
    setPreferencesOpen,
    setShortcutsHelpOpen,
    setSystemStatusOpen,
    setCommandPaletteOpen,
    setPendingPosSelection,
    syncNow,
    isOnline,
    showToast,
  ]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Show Quick Actions + Recent Activities by default
      return allItems.filter(
        it => it.section === 'Quick Actions' || it.section === 'Recent Activities'
      );
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    return allItems.filter(it => {
      const hay = `${it.title} ${it.subtitle} ${it.keywords} ${it.section}`.toLowerCase();
      return tokens.every(tok => hay.includes(tok));
    });
  }, [allItems, query]);

  useEffect(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(0);
    }
  }, [filteredItems.length, selectedIndex]);

  if (!commandPaletteOpen) return null;

  const groupedSections = Array.from(new Set(filteredItems.map(i => i.section)));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (filteredItems.length ? (prev + 1) % filteredItems.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev =>
        filteredItems.length ? (prev - 1 + filteredItems.length) % filteredItems.length : 0
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filteredItems[selectedIndex];
      if (target) target.onSelect();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Global Command Palette"
      className="fixed inset-0 z-[85] bg-[#0A122C]/75 backdrop-blur-xs flex items-start justify-center p-3 sm:pt-16 no-print"
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-[#101B3F] text-[#172033] dark:text-white rounded-2xl border border-[#E2E8F0] dark:border-[#243B70] shadow-2xl overflow-hidden flex flex-col max-h-[82vh] adp-modal-enter"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E2E8F0] dark:border-[#243B70]">
          <Search className="w-4 h-4 text-[#087F8C] dark:text-[#FF9D32] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command, quick action, page, or product name / barcode..."
            className="flex-1 bg-transparent text-sm font-medium focus:outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(false)}
            className="px-2 py-1 text-[11px] font-semibold rounded-md bg-slate-100 dark:bg-[#182954] text-slate-600 dark:text-slate-300 hover:bg-slate-200 cursor-pointer shrink-0"
          >
            Esc
          </button>
        </div>

        {/* Quick Action Buttons Strip for Touch / Mouse */}
        <div className="px-4 py-2 bg-[#F8FAFC] dark:bg-[#0D1736] border-b border-[#E2E8F0] dark:border-[#243B70] flex items-center gap-1.5 overflow-x-auto">
          {canAccess('pos') && (
            <button
              type="button"
              onClick={() => {
                setCommandPaletteOpen(false);
                navigationHandlers.onOpenPOS();
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#FF9D32] text-[#101B3F] text-[11px] font-bold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>POS</span>
            </button>
          )}
          {canAccess('products') && hasPermission('product_management', 'create') && (
            <button
              type="button"
              onClick={() => {
                setCommandPaletteOpen(false);
                navigationHandlers.onOpenNewProduct();
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#182954] border border-[#E2E8F0] dark:border-[#243B70] text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#087F8C]" />
              <span>Product</span>
            </button>
          )}
          {canAccess('customers') && hasPermission('customer_management', 'create') && (
            <button
              type="button"
              onClick={() => {
                setCommandPaletteOpen(false);
                navigationHandlers.onOpenNewCustomer();
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#182954] border border-[#E2E8F0] dark:border-[#243B70] text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-600" />
              <span>Customer</span>
            </button>
          )}
          {canAccess('purchases') && hasPermission('purchase_management', 'create') && (
            <button
              type="button"
              onClick={() => {
                setCommandPaletteOpen(false);
                navigationHandlers.onOpenNewPurchase();
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#182954] border border-[#E2E8F0] dark:border-[#243B70] text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-blue-600" />
              <span>Purchase</span>
            </button>
          )}
          {canAccess('accounts') && hasPermission('expense_management', 'create') && (
            <button
              type="button"
              onClick={() => {
                setCommandPaletteOpen(false);
                navigationHandlers.onOpenNewExpense();
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#182954] border border-[#E2E8F0] dark:border-[#243B70] text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-rose-500" />
              <span>Expense</span>
            </button>
          )}
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#64748B] dark:text-slate-400">
              No matching commands, modules, or products for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            groupedSections.map(section => {
              const sectionItems = filteredItems.filter(i => i.section === section);
              return (
                <div key={section}>
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400 flex items-center gap-1.5">
                    {section === 'Recent Activities' ? (
                      <Clock className="w-3 h-3" />
                    ) : section === 'Quick Actions' ? (
                      <Command className="w-3 h-3" />
                    ) : (
                      <Receipt className="w-3 h-3" />
                    )}
                    <span>{section}</span>
                  </div>
                  <div className="space-y-0.5 mt-1">
                    {sectionItems.map(item => {
                      const flatIdx = filteredItems.findIndex(f => f.id === item.id);
                      const isActive = flatIdx === selectedIndex;
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onMouseEnter={() => setSelectedIndex(flatIdx)}
                          onClick={item.onSelect}
                          className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 min-h-[44px] rounded-xl text-left transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-[#087F8C]/12 dark:bg-[#243B70] text-[#087F8C] dark:text-white'
                              : 'hover:bg-slate-50 dark:hover:bg-[#182954] text-[#172033] dark:text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                isActive
                                  ? 'bg-[#087F8C] text-white dark:bg-[#FF9D32] dark:text-[#101B3F]'
                                  : 'bg-slate-100 dark:bg-[#0D1736] text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold truncate">{item.title}</div>
                              <div className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                                {item.subtitle}
                              </div>
                            </div>
                          </div>
                          {item.shortcut && (
                            <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md border border-[#E2E8F0] dark:border-[#243B70] bg-white dark:bg-[#0D1736] text-[10px] font-mono-num font-semibold text-[#64748B] dark:text-slate-300 shrink-0">
                              {item.shortcut}
                            </kbd>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Hints */}
        <div className="px-4 py-2 border-t border-[#E2E8F0] dark:border-[#243B70] bg-[#F8FAFC] dark:bg-[#0D1736] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B] dark:text-slate-400">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>Enter Select</span>
            <span>Esc Close</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setCommandPaletteOpen(false);
              setShortcutsHelpOpen(true);
            }}
            className="font-semibold text-[#087F8C] dark:text-[#FF9D32] hover:underline cursor-pointer"
          >
            All Keyboard Shortcuts ({getShortcutCombo('open_shortcuts_help')})
          </button>
        </div>
      </div>
    </div>
  );
};
