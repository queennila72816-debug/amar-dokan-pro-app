import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ConfirmDialogOptions,
  DashboardCustomization,
  DashboardWidgetId,
  ShortcutActionId,
  SmartNotificationItem,
  SoundEventType,
  SoundPreferences,
  ThemePreference,
  ToastMessage,
  ToastTone,
  UserProductivityPreferences,
} from '../types';
import { useApp } from './AppContext';
import { useTheme } from './ThemeContext';
import {
  DEFAULT_WIDGET_ORDER,
  getDefaultProductivityPreferences,
  loadLocalUserPreferences,
  loadUserPreferencesFromSupabase,
  saveLocalUserPreferences,
  saveUserPreferencesToSupabase,
} from '../utils/userPreferencesService';
import {
  SHORTCUT_DEFINITIONS,
  matchesKeyCombo,
  resolveShortcutCombo,
  shouldIgnoreShortcutEvent,
} from '../utils/keyboardShortcuts';
import {
  PlaySoundOptions,
  playAppSound,
  syncRuntimeAudioPreferences,
  testAppSound,
  triggerHaptic,
  unlockAudioEngine,
} from '../utils/soundEngine';
import { formatCurrency } from '../utils/formatters';
import { isSupabaseConfigured } from '../lib/supabase';

export interface ProductivityActionHandlers {
  activeTab: string;
  onNavigateTab: (tab: string) => void;
  onOpenPOS: () => void;
  onOpenNewProduct: () => void;
  onOpenNewCustomer: () => void;
  onOpenNewPurchase: () => void;
  onOpenNewExpense: () => void;
}

interface PendingConfirmState {
  options: ConfirmDialogOptions;
  resolve: (accepted: boolean) => void;
}

interface ProductivityContextValue {
  prefs: UserProductivityPreferences;
  isPrefsSaving: boolean;
  remotePrefsSupported: boolean;
  lastPrefsSavedAt: string | null;

  // Theme & Viewport modes
  themeMode: ThemePreference;
  setThemePreference: (mode: ThemePreference) => void;
  cycleThemePreference: () => void;
  focusMode: boolean;
  setFocusMode: (enabled: boolean) => void;
  toggleFocusMode: () => void;
  isFullscreen: boolean;
  fullscreenSupported: boolean;
  toggleFullscreen: () => Promise<void>;

  // Sound & Vibration
  playSound: (event: SoundEventType, options?: PlaySoundOptions) => boolean;
  testSound: (event: SoundEventType) => boolean;
  updateSoundPreferences: (patch: Partial<SoundPreferences>) => void;
  toggleSoundEvent: (event: SoundEventType, enabled: boolean) => void;
  toggleMute: () => void;
  toggleSilentMode: () => void;
  toggleVibration: () => void;

  // Shortcuts
  updateShortcutBinding: (actionId: ShortcutActionId, combo: string) => void;
  resetAllShortcuts: () => void;
  toggleShortcutsEnabled: (enabled: boolean) => void;
  getShortcutCombo: (actionId: ShortcutActionId) => string;

  // Dashboard Customization
  updateDashboardCustomization: (patch: Partial<DashboardCustomization>) => void;
  toggleDashboardWidget: (widgetId: DashboardWidgetId) => void;
  moveDashboardWidget: (widgetId: DashboardWidgetId, direction: 'up' | 'down') => void;
  resetDashboardCustomization: () => void;

  // Notifications
  notifications: SmartNotificationItem[];
  unreadNotificationCount: number;
  dismissNotification: (id: string) => void;
  clearDismissedNotifications: () => void;

  // Overlay Modals
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  shortcutsHelpOpen: boolean;
  setShortcutsHelpOpen: (open: boolean) => void;
  preferencesOpen: boolean;
  setPreferencesOpen: (open: boolean) => void;
  systemStatusOpen: boolean;
  setSystemStatusOpen: (open: boolean) => void;

  // Global UX Feedback (Toast + Confirm Dialog)
  toasts: ToastMessage[];
  showToast: (params: {
    tone?: ToastTone;
    title: string;
    message?: string;
    durationMs?: number;
  }) => void;
  dismissToast: (id: string) => void;
  confirmDialog: (options: ConfirmDialogOptions) => Promise<boolean>;
  pendingConfirm: PendingConfirmState | null;
  resolveConfirm: (accepted: boolean) => void;

  // Global Action Dispatcher for Command Palette & Shortcuts
  triggerQuickAction: (action: ShortcutActionId) => void;
  navigationHandlers: ProductivityActionHandlers;
}

const ProductivityContext = createContext<ProductivityContextValue | undefined>(undefined);

export const ProductivityProvider: React.FC<{
  children: React.ReactNode;
  handlers: ProductivityActionHandlers;
}> = ({ children, handlers }) => {
  const {
    user,
    products,
    sales,
    customers,
    marketplaceOrders,
    settings,
    isOnline,
    isSyncing,
    lastSyncError,
    businessStatusBanner,
    canAccess,
    hasPermission,
  } = useApp();
  const { themeMode, setThemeMode, cycleThemeMode } = useTheme();

  const [prefs, setPrefs] = useState<UserProductivityPreferences>(() =>
    loadLocalUserPreferences(user?.id, themeMode)
  );
  const [isPrefsSaving, setIsPrefsSaving] = useState(false);
  const [remotePrefsSupported, setRemotePrefsSupported] = useState(true);
  const [lastPrefsSavedAt, setLastPrefsSavedAt] = useState<string | null>(null);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [systemStatusOpen, setSystemStatusOpen] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmState | null>(null);

  const fullscreenSupported =
    typeof document !== 'undefined' &&
    Boolean(
      document.documentElement?.requestFullscreen ||
        (document.documentElement as unknown as { webkitRequestFullscreen?: () => Promise<void> })
          ?.webkitRequestFullscreen
    );
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const saveTimerRef = useRef<number | null>(null);
  const seenPendingOrdersRef = useRef<Set<string> | null>(null);
  const prevLowStockCountRef = useRef<number | null>(null);

  const showToast = useCallback(
    ({
      tone = 'info',
      title,
      message,
      durationMs = 3600,
    }: {
      tone?: ToastTone;
      title: string;
      message?: string;
      durationMs?: number;
    }) => {
      const id = `toast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts(prev => [...prev.slice(-4), { id, tone, title, message, durationMs }]);
      if (durationMs > 0 && typeof window !== 'undefined') {
        window.setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== id));
        }, durationMs);
      }
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const confirmDialog = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      setPendingConfirm({ options, resolve });
    });
  }, []);

  const resolveConfirm = useCallback((accepted: boolean) => {
    setPendingConfirm(prev => {
      if (prev) prev.resolve(accepted);
      return null;
    });
  }, []);

  // Unlock shared WebAudio engine on first pointer or key interaction (Chrome / Android autoplay policy)
  useEffect(() => {
    const unlock = () => unlockAudioEngine();
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Sync fullscreen status with browser native F11 / Esc / exit
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Load user preferences from local cache + Supabase user_profiles.ui_preferences when user logs in
  useEffect(() => {
    let active = true;
    const local = loadLocalUserPreferences(user?.id, themeMode);
    setPrefs(local);
    syncRuntimeAudioPreferences(local.sound, local.vibrationEnabled);
    if (local.themeMode !== themeMode) {
      setThemeMode(local.themeMode);
    }

    if (!user?.id || !isSupabaseConfigured) {
      return () => {
        active = false;
      };
    }

    loadUserPreferencesFromSupabase(user.id, local.themeMode).then(res => {
      if (!active) return;
      setRemotePrefsSupported(res.remoteSupported);
      if (res.prefs) {
        setPrefs(res.prefs);
        saveLocalUserPreferences(res.prefs, user.id);
        syncRuntimeAudioPreferences(res.prefs.sound, res.prefs.vibrationEnabled);
        setThemeMode(res.prefs.themeMode);
      }
    });

    return () => {
      active = false;
    };
    // Only re-hydrate when authenticated user changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Keep runtime sound engine synchronized on every prefs change
  useEffect(() => {
    syncRuntimeAudioPreferences(prefs.sound, prefs.vibrationEnabled);
  }, [prefs.sound, prefs.vibrationEnabled]);

  const persistPreferences = useCallback(
    (updater: (prev: UserProductivityPreferences) => UserProductivityPreferences) => {
      setPrefs(prev => {
        const next: UserProductivityPreferences = {
          ...updater(prev),
          updatedAt: new Date().toISOString(),
        };
        saveLocalUserPreferences(next, user?.id);

        if (user?.id && isSupabaseConfigured) {
          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
          }
          saveTimerRef.current = window.setTimeout(async () => {
            setIsPrefsSaving(true);
            const res = await saveUserPreferencesToSupabase(user.id, next);
            setIsPrefsSaving(false);
            setRemotePrefsSupported(res.remoteSupported);
            if (res.saved) {
              setLastPrefsSavedAt(new Date().toISOString());
            }
          }, 450);
        }

        return next;
      });
    },
    [user?.id]
  );

  const setThemePreference = useCallback(
    (mode: ThemePreference) => {
      setThemeMode(mode);
      persistPreferences(prev => ({ ...prev, themeMode: mode }));
      showToast({
        tone: 'info',
        title: `Theme: ${mode === 'system' ? 'System Auto' : mode === 'dark' ? 'Dark Mode' : 'Light Mode'}`,
        durationMs: 2200,
      });
    },
    [setThemeMode, persistPreferences, showToast]
  );

  const cycleThemePreference = useCallback(() => {
    const next: ThemePreference =
      themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'light';
    cycleThemeMode();
    persistPreferences(prev => ({ ...prev, themeMode: next }));
    showToast({
      tone: 'info',
      title: `Theme: ${next === 'system' ? 'System Auto' : next === 'dark' ? 'Dark Mode' : 'Light Mode'}`,
      durationMs: 2000,
    });
  }, [themeMode, cycleThemeMode, persistPreferences, showToast]);

  const setFocusMode = useCallback(
    (enabled: boolean) => {
      persistPreferences(prev => ({ ...prev, focusMode: enabled }));
      triggerHaptic('tap');
      showToast({
        tone: 'info',
        title: enabled ? 'Focus Mode Enabled' : 'Focus Mode Exited',
        message: enabled ? 'Press F10 or click Exit Focus to restore full navigation.' : undefined,
        durationMs: 2400,
      });
    },
    [persistPreferences, showToast]
  );

  const toggleFocusMode = useCallback(() => {
    setFocusMode(!prefs.focusMode);
  }, [prefs.focusMode, setFocusMode]);

  const toggleFullscreen = useCallback(async () => {
    if (!fullscreenSupported) {
      showToast({
        tone: 'warning',
        title: 'Full Screen Unavailable',
        message: 'Your browser or preview frame restricts Full Screen API.',
      });
      return;
    }
    try {
      if (!document.fullscreenElement) {
        const el = document.documentElement as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void>;
        };
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        }
      } else {
        await document.exitFullscreen();
      }
      triggerHaptic('tap');
    } catch {
      showToast({
        tone: 'warning',
        title: 'Full Screen Blocked',
        message: 'Browser frame blocked Full Screen request. Press browser F11 or expand window.',
      });
    }
  }, [fullscreenSupported, showToast]);

  const updateSoundPreferences = useCallback(
    (patch: Partial<SoundPreferences>) => {
      persistPreferences(prev => ({
        ...prev,
        sound: {
          ...prev.sound,
          ...patch,
          events: patch.events ? { ...prev.sound.events, ...patch.events } : prev.sound.events,
        },
      }));
    },
    [persistPreferences]
  );

  const toggleSoundEvent = useCallback(
    (event: SoundEventType, enabled: boolean) => {
      persistPreferences(prev => ({
        ...prev,
        sound: {
          ...prev.sound,
          events: {
            ...prev.sound.events,
            [event]: enabled,
          },
        },
      }));
    },
    [persistPreferences]
  );

  const toggleMute = useCallback(() => {
    const nextMuted = !prefs.sound.muted;
    updateSoundPreferences({ muted: nextMuted });
    showToast({
      tone: 'info',
      title: nextMuted ? 'Sound Effects Muted' : 'Sound Effects Unmuted',
      durationMs: 2000,
    });
  }, [prefs.sound.muted, updateSoundPreferences, showToast]);

  const toggleSilentMode = useCallback(() => {
    const nextSilent = !prefs.sound.silentMode;
    updateSoundPreferences({ silentMode: nextSilent });
    showToast({
      tone: 'info',
      title: nextSilent ? 'Silent Mode Active' : 'Silent Mode Off',
      message: nextSilent ? 'All sound effects and vibration cues suppressed.' : undefined,
      durationMs: 2200,
    });
  }, [prefs.sound.silentMode, updateSoundPreferences, showToast]);

  const toggleVibration = useCallback(() => {
    const nextVib = !prefs.vibrationEnabled;
    persistPreferences(prev => ({ ...prev, vibrationEnabled: nextVib }));
    if (nextVib) triggerHaptic('tap', true);
  }, [prefs.vibrationEnabled, persistPreferences]);

  const updateShortcutBinding = useCallback(
    (actionId: ShortcutActionId, combo: string) => {
      persistPreferences(prev => ({
        ...prev,
        customShortcuts: {
          ...prev.customShortcuts,
          [actionId]: combo,
        },
      }));
    },
    [persistPreferences]
  );

  const resetAllShortcuts = useCallback(() => {
    persistPreferences(prev => ({ ...prev, customShortcuts: {} }));
    showToast({ tone: 'success', title: 'Shortcuts Restored to Defaults' });
  }, [persistPreferences, showToast]);

  const toggleShortcutsEnabled = useCallback(
    (enabled: boolean) => {
      persistPreferences(prev => ({ ...prev, shortcutsEnabled: enabled }));
    },
    [persistPreferences]
  );

  const getShortcutCombo = useCallback(
    (actionId: ShortcutActionId) => resolveShortcutCombo(actionId, prefs.customShortcuts),
    [prefs.customShortcuts]
  );

  const updateDashboardCustomization = useCallback(
    (patch: Partial<DashboardCustomization>) => {
      persistPreferences(prev => ({
        ...prev,
        dashboard: {
          ...prev.dashboard,
          ...patch,
        },
      }));
    },
    [persistPreferences]
  );

  const toggleDashboardWidget = useCallback(
    (widgetId: DashboardWidgetId) => {
      persistPreferences(prev => {
        const exists = prev.dashboard.hiddenWidgets.includes(widgetId);
        return {
          ...prev,
          dashboard: {
            ...prev.dashboard,
            hiddenWidgets: exists
              ? prev.dashboard.hiddenWidgets.filter(id => id !== widgetId)
              : [...prev.dashboard.hiddenWidgets, widgetId],
          },
        };
      });
    },
    [persistPreferences]
  );

  const moveDashboardWidget = useCallback(
    (widgetId: DashboardWidgetId, direction: 'up' | 'down') => {
      persistPreferences(prev => {
        const order = [...prev.dashboard.widgetOrder];
        const idx = order.indexOf(widgetId);
        if (idx === -1) return prev;
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= order.length) return prev;
        [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
        return {
          ...prev,
          dashboard: {
            ...prev.dashboard,
            widgetOrder: order,
          },
        };
      });
    },
    [persistPreferences]
  );

  const resetDashboardCustomization = useCallback(() => {
    persistPreferences(prev => ({
      ...prev,
      dashboard: {
        hiddenWidgets: [],
        widgetOrder: [...DEFAULT_WIDGET_ORDER],
        compactDensity: false,
      },
    }));
    showToast({ tone: 'success', title: 'Dashboard Layout Restored' });
  }, [persistPreferences, showToast]);

  // Compute Smart Notifications from real Supabase business state + RBAC rules
  const allNotifications = useMemo<SmartNotificationItem[]>(() => {
    const list: SmartNotificationItem[] = [];
    const lang = settings.language;

    // 1. Low Stock & Out of Stock
    if (canAccess('reorder') || canAccess('stock')) {
      const activeProds = products.filter(p => p.isActive !== false);
      const outCount = activeProds.filter(p => p.currentStock <= 0).length;
      const lowCount = activeProds.filter(
        p => p.currentStock > 0 && p.currentStock <= p.minStockAlert
      ).length;
      if (outCount > 0 || lowCount > 0) {
        list.push({
          id: `low-stock-${outCount}-${lowCount}`,
          category: 'low_stock',
          title: `${outCount + lowCount} Stock Alert${outCount + lowCount === 1 ? '' : 's'}`,
          detail: `${outCount} out of stock · ${lowCount} at/below reorder point`,
          tone: outCount > 0 ? 'coral' : 'amber',
          targetTab: canAccess('reorder') ? 'reorder' : 'inventory',
          actionLabel: 'Review Stock',
        });
      }
    }

    // 2. New Online / Marketplace Orders
    if (canAccess('combos')) {
      const pendingOrders = marketplaceOrders.filter(o => o.status === 'pending');
      if (pendingOrders.length > 0) {
        const latest = pendingOrders[0];
        list.push({
          id: `new-orders-${pendingOrders.length}-${latest.id}`,
          category: 'new_order',
          title: `${pendingOrders.length} New Online Combo Order${pendingOrders.length === 1 ? '' : 's'}`,
          detail: `Latest: ${latest.orderNumber} (${latest.customerName})`,
          tone: 'teal',
          targetTab: 'combos',
          timestamp: latest.createdAt,
          actionLabel: 'View Orders',
        });
      }
    }

    // 3. Pending Payments / Customer Dues
    if (canAccess('customers')) {
      const dueCustomers = customers.filter(c => c.currentDue > 0);
      if (dueCustomers.length > 0) {
        const totalDue = dueCustomers.reduce((s, c) => s + c.currentDue, 0);
        list.push({
          id: `pending-dues-${dueCustomers.length}-${Math.round(totalDue)}`,
          category: 'pending_payment',
          title: `${dueCustomers.length} Pending Customer Payment${dueCustomers.length === 1 ? '' : 's'}`,
          detail: `${formatCurrency(totalDue, lang)} total receivable open`,
          tone: 'amber',
          targetTab: 'customers',
          actionLabel: 'Collect Due',
        });
      }
    }

    // 4. Daily Sales Summary (respecting permission & always helpful on counter)
    if (canAccess('sales') || canAccess('pos')) {
      const todayKey = new Date().toISOString().slice(0, 10);
      const todaySales = sales.filter(
        s => (s.date || '').slice(0, 10) === todayKey && s.status !== 'voided' && s.status !== 'returned'
      );
      const todayRevenue = todaySales.reduce((s, row) => s + (row.total || 0), 0);
      const todayPaid = todaySales.reduce((s, row) => s + (row.paid || 0), 0);
      list.push({
        id: `daily-summary-${todayKey}-${todaySales.length}`,
        category: 'daily_summary',
        title: `Today's Sales Summary (${todaySales.length} Invoice${todaySales.length === 1 ? '' : 's'})`,
        detail: `Sales: ${formatCurrency(todayRevenue, lang)} · Collected: ${formatCurrency(todayPaid, lang)}`,
        tone: 'emerald',
        targetTab: canAccess('sales') ? 'sales' : 'pos',
        actionLabel: 'Open Sales',
      });
    }

    // 5. Important System Alerts
    if (!isOnline) {
      list.push({
        id: 'system-offline',
        category: 'system_alert',
        title: 'Offline Connection Detected',
        detail: 'Cloud sync paused until internet connection returns.',
        tone: 'coral',
        actionLabel: 'System Status',
      });
    }
    if (lastSyncError) {
      list.push({
        id: `system-sync-err-${lastSyncError.slice(0, 24)}`,
        category: 'system_alert',
        title: 'Cloud Sync Warning',
        detail: lastSyncError,
        tone: 'coral',
        actionLabel: 'System Status',
      });
    }
    if (businessStatusBanner) {
      list.push({
        id: `system-biz-banner-${businessStatusBanner.title}`,
        category: 'system_alert',
        title: businessStatusBanner.title,
        detail: businessStatusBanner.message,
        tone: businessStatusBanner.tone === 'danger' ? 'coral' : 'amber',
        targetTab: canAccess('billing') ? 'billing' : undefined,
        actionLabel: 'View Billing',
      });
    }

    return list;
  }, [
    products,
    marketplaceOrders,
    customers,
    sales,
    settings.language,
    isOnline,
    lastSyncError,
    businessStatusBanner,
    canAccess,
  ]);

  const notifications = useMemo(() => {
    const dismissed = new Set(prefs.dismissedNotificationIds || []);
    return allNotifications.filter(n => !dismissed.has(n.id));
  }, [allNotifications, prefs.dismissedNotificationIds]);

  const unreadNotificationCount = notifications.filter(
    n => n.category !== 'daily_summary'
  ).length;

  const dismissNotification = useCallback(
    (id: string) => {
      persistPreferences(prev => ({
        ...prev,
        dismissedNotificationIds: Array.from(
          new Set([...(prev.dismissedNotificationIds || []), id])
        ).slice(-50),
      }));
    },
    [persistPreferences]
  );

  const clearDismissedNotifications = useCallback(() => {
    persistPreferences(prev => ({ ...prev, dismissedNotificationIds: [] }));
  }, [persistPreferences]);

  // Trigger real audio notifications ONLY on new arrivals after initial load (no noisy sound on startup)
  useEffect(() => {
    const pendingIds = marketplaceOrders.filter(o => o.status === 'pending').map(o => o.id);
    if (seenPendingOrdersRef.current === null) {
      seenPendingOrdersRef.current = new Set(pendingIds);
      return;
    }
    const newlyArrived = pendingIds.filter(id => !seenPendingOrdersRef.current!.has(id));
    if (newlyArrived.length > 0) {
      newlyArrived.forEach(id => seenPendingOrdersRef.current!.add(id));
      playAppSound('new_order', { dedupeKey: newlyArrived[0] });
      showToast({
        tone: 'info',
        title: 'New Marketplace Order',
        message: `${newlyArrived.length} new combo order received.`,
      });
    }
  }, [marketplaceOrders, showToast]);

  useEffect(() => {
    const activeLowCount = products.filter(
      p => p.isActive !== false && p.currentStock <= p.minStockAlert
    ).length;
    if (prevLowStockCountRef.current === null) {
      prevLowStockCountRef.current = activeLowCount;
      return;
    }
    if (activeLowCount > prevLowStockCountRef.current) {
      playAppSound('low_stock_warning');
    }
    prevLowStockCountRef.current = activeLowCount;
  }, [products]);

  const triggerQuickAction = useCallback(
    (action: ShortcutActionId) => {
      const h = handlersRef.current;

      const denyModule = (label: string) => {
        showToast({
          tone: 'warning',
          title: 'Permission Required',
          message: `Your current role cannot access ${label}.`,
        });
      };

      switch (action) {
        case 'open_command_palette':
          setShortcutsHelpOpen(false);
          setPreferencesOpen(false);
          setSystemStatusOpen(false);
          setCommandPaletteOpen(prev => !prev);
          return;
        case 'open_shortcuts_help':
          setCommandPaletteOpen(false);
          setShortcutsHelpOpen(prev => !prev);
          return;
        case 'open_system_status':
          setCommandPaletteOpen(false);
          setSystemStatusOpen(prev => !prev);
          return;
        case 'save_active': {
          const ev = new CustomEvent('protiva:save', { cancelable: true });
          const notCancelled = window.dispatchEvent(ev);
          if (notCancelled) {
            showToast({
              tone: 'info',
              title: 'Changes Synced',
              message: 'No active unsaved dialog detected — workspace preferences saved.',
              durationMs: 2200,
            });
          }
          return;
        }
        case 'print_active': {
          const ev = new CustomEvent('protiva:print', { cancelable: true });
          const notCancelled = window.dispatchEvent(ev);
          if (notCancelled) {
            playAppSound('invoice_print');
            window.print();
          }
          return;
        }
        case 'go_dashboard':
          if (!canAccess('dashboard')) return denyModule('Dashboard');
          h.onNavigateTab('dashboard');
          return;
        case 'go_pos':
          if (!canAccess('pos')) return denyModule('POS Billing');
          h.onOpenPOS();
          return;
        case 'open_scanner':
          if (!canAccess('scanner')) return denyModule('Barcode & QR Scanner');
          if (h.activeTab === 'pos') {
            window.dispatchEvent(new CustomEvent('protiva:pos-open-scanner'));
          } else {
            h.onNavigateTab('scanner');
          }
          return;
        case 'new_product':
          if (!canAccess('products') || !hasPermission('product_management', 'create')) {
            return denyModule('New Product');
          }
          h.onOpenNewProduct();
          return;
        case 'new_customer':
          if (!canAccess('customers') || !hasPermission('customer_management', 'create')) {
            return denyModule('New Customer');
          }
          h.onOpenNewCustomer();
          return;
        case 'new_purchase':
          if (!canAccess('purchases') || !hasPermission('purchase_management', 'create')) {
            return denyModule('New Purchase');
          }
          h.onOpenNewPurchase();
          return;
        case 'new_expense':
          if (!canAccess('accounts') || !hasPermission('expense_management', 'create')) {
            return denyModule('New Expense');
          }
          h.onOpenNewExpense();
          return;
        case 'toggle_focus_mode':
          toggleFocusMode();
          return;
        case 'toggle_fullscreen':
          toggleFullscreen();
          return;
        case 'toggle_theme':
          cycleThemePreference();
          return;
        case 'pos_focus_barcode':
        case 'pos_focus_search':
        case 'pos_clear_cart':
        case 'pos_complete_sale':
          if (!canAccess('pos')) return denyModule('POS');
          if (h.activeTab !== 'pos') {
            h.onOpenPOS();
            window.setTimeout(() => {
              window.dispatchEvent(new CustomEvent(`protiva:${action}`));
            }, 80);
          } else {
            window.dispatchEvent(new CustomEvent(`protiva:${action}`));
          }
          return;
      }
    },
    [canAccess, hasPermission, showToast, toggleFocusMode, toggleFullscreen, cycleThemePreference]
  );

  // Global Keyboard Shortcut Manager (handles Esc, Ctrl+K, Ctrl+S, Ctrl+P, F1-F12 safely)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Esc always closes active productivity overlays or confirmation dialogs first
      if (e.key === 'Escape') {
        if (pendingConfirm) {
          e.preventDefault();
          resolveConfirm(false);
          return;
        }
        if (commandPaletteOpen) {
          e.preventDefault();
          setCommandPaletteOpen(false);
          return;
        }
        if (shortcutsHelpOpen) {
          e.preventDefault();
          setShortcutsHelpOpen(false);
          return;
        }
        if (preferencesOpen) {
          e.preventDefault();
          setPreferencesOpen(false);
          return;
        }
        if (systemStatusOpen) {
          e.preventDefault();
          setSystemStatusOpen(false);
          return;
        }
        // Broadcast cancelable Escape event for open page modals (POS, Invoice, Preview, etc.)
        const ev = new CustomEvent('protiva:escape', { cancelable: true });
        window.dispatchEvent(ev);
        return;
      }

      if (!prefs.shortcutsEnabled) return;

      for (const def of SHORTCUT_DEFINITIONS) {
        const combo = resolveShortcutCombo(def.id, prefs.customShortcuts);
        if (!combo || !matchesKeyCombo(e, combo)) continue;

        if (shouldIgnoreShortcutEvent(e, def.allowInInputs)) {
          return;
        }

        // Prevent native browser actions for overridden combos (Ctrl+K, Ctrl+S, Ctrl+P, F1, F3, F6, F11, etc.)
        e.preventDefault();
        triggerQuickAction(def.id);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    prefs.shortcutsEnabled,
    prefs.customShortcuts,
    pendingConfirm,
    resolveConfirm,
    commandPaletteOpen,
    shortcutsHelpOpen,
    preferencesOpen,
    systemStatusOpen,
    triggerQuickAction,
  ]);

  const playSound = useCallback(
    (event: SoundEventType, options?: PlaySoundOptions) => playAppSound(event, options),
    []
  );
  const testSound = useCallback(
    (event: SoundEventType) => testAppSound(event, prefs.sound.volume),
    [prefs.sound.volume]
  );

  const value: ProductivityContextValue = {
    prefs,
    isPrefsSaving,
    remotePrefsSupported,
    lastPrefsSavedAt,
    themeMode,
    setThemePreference,
    cycleThemePreference,
    focusMode: prefs.focusMode,
    setFocusMode,
    toggleFocusMode,
    isFullscreen,
    fullscreenSupported,
    toggleFullscreen,
    playSound,
    testSound,
    updateSoundPreferences,
    toggleSoundEvent,
    toggleMute,
    toggleSilentMode,
    toggleVibration,
    updateShortcutBinding,
    resetAllShortcuts,
    toggleShortcutsEnabled,
    getShortcutCombo,
    updateDashboardCustomization,
    toggleDashboardWidget,
    moveDashboardWidget,
    resetDashboardCustomization,
    notifications,
    unreadNotificationCount,
    dismissNotification,
    clearDismissedNotifications,
    commandPaletteOpen,
    setCommandPaletteOpen,
    shortcutsHelpOpen,
    setShortcutsHelpOpen,
    preferencesOpen,
    setPreferencesOpen,
    systemStatusOpen,
    setSystemStatusOpen,
    toasts,
    showToast,
    dismissToast,
    confirmDialog,
    pendingConfirm,
    resolveConfirm,
    triggerQuickAction,
    navigationHandlers: handlers,
  };

  return (
    <ProductivityContext.Provider value={value}>
      {children}
      {/* Hidden live indicator value consumed by System Status */}
      {isSyncing && <span className="sr-only" aria-live="polite">Synchronizing cloud data</span>}
    </ProductivityContext.Provider>
  );
};

export function useProductivity(): ProductivityContextValue {
  const ctx = useContext(ProductivityContext);
  if (!ctx) {
    throw new Error('useProductivity must be used within a ProductivityProvider');
  }
  return ctx;
}
