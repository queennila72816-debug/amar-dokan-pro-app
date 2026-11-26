import {
  DashboardWidgetId,
  ThemePreference,
  UserProductivityPreferences,
} from '../types';
import { DEFAULT_SOUND_PREFERENCES } from './soundEngine';
import { supabase, isSupabaseConfigured, sanitizeUuid } from '../lib/supabase';

const USER_PREFS_STORAGE_PREFIX = 'PROTIVA_USER_PREFS_V1';

export const DEFAULT_WIDGET_ORDER: DashboardWidgetId[] = [
  'quick_actions',
  'kpis',
  'alerts',
  'charts',
  'recent_sales_purchases',
  'bottom_insights',
  'recent_activities',
];

export function getDefaultProductivityPreferences(
  themeMode: ThemePreference = 'light'
): UserProductivityPreferences {
  return {
    themeMode,
    sound: {
      ...DEFAULT_SOUND_PREFERENCES,
      events: { ...DEFAULT_SOUND_PREFERENCES.events },
    },
    vibrationEnabled: true,
    shortcutsEnabled: true,
    customShortcuts: {},
    focusMode: false,
    dashboard: {
      hiddenWidgets: [],
      widgetOrder: [...DEFAULT_WIDGET_ORDER],
      compactDensity: false,
    },
    dismissedNotificationIds: [],
  };
}

export function mergeProductivityPreferences(
  raw: unknown,
  fallbackTheme: ThemePreference = 'light'
): UserProductivityPreferences {
  const base = getDefaultProductivityPreferences(fallbackTheme);
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, any>;

  const validTheme: ThemePreference =
    obj.themeMode === 'light' || obj.themeMode === 'dark' || obj.themeMode === 'system'
      ? obj.themeMode
      : base.themeMode;

  const soundObj = obj.sound && typeof obj.sound === 'object' ? obj.sound : {};
  const soundEventsObj =
    soundObj.events && typeof soundObj.events === 'object' ? soundObj.events : {};

  const dashObj = obj.dashboard && typeof obj.dashboard === 'object' ? obj.dashboard : {};
  const rawOrder: DashboardWidgetId[] = Array.isArray(dashObj.widgetOrder)
    ? dashObj.widgetOrder.filter((id: unknown): id is DashboardWidgetId =>
        DEFAULT_WIDGET_ORDER.includes(id as DashboardWidgetId)
      )
    : [];
  const fullOrder = [...rawOrder];
  for (const w of DEFAULT_WIDGET_ORDER) {
    if (!fullOrder.includes(w)) fullOrder.push(w);
  }

  const hiddenWidgets: DashboardWidgetId[] = Array.isArray(dashObj.hiddenWidgets)
    ? dashObj.hiddenWidgets.filter((id: unknown): id is DashboardWidgetId =>
        DEFAULT_WIDGET_ORDER.includes(id as DashboardWidgetId)
      )
    : [];

  const customShortcuts: UserProductivityPreferences['customShortcuts'] = {};
  if (obj.customShortcuts && typeof obj.customShortcuts === 'object') {
    for (const [k, v] of Object.entries(obj.customShortcuts)) {
      if (typeof v === 'string' && v.trim()) {
        (customShortcuts as Record<string, string>)[k] = v.trim();
      }
    }
  }

  return {
    themeMode: validTheme,
    sound: {
      enabled: soundObj.enabled !== undefined ? Boolean(soundObj.enabled) : base.sound.enabled,
      muted: Boolean(soundObj.muted),
      silentMode: Boolean(soundObj.silentMode),
      volume:
        typeof soundObj.volume === 'number' && Number.isFinite(soundObj.volume)
          ? Math.max(0, Math.min(1, soundObj.volume))
          : base.sound.volume,
      events: {
        scan_success: soundEventsObj.scan_success !== false,
        product_not_found: soundEventsObj.product_not_found !== false,
        product_added: soundEventsObj.product_added !== false,
        sale_completed: soundEventsObj.sale_completed !== false,
        payment_received: soundEventsObj.payment_received !== false,
        low_stock_warning: soundEventsObj.low_stock_warning !== false,
        new_order: soundEventsObj.new_order !== false,
        invoice_print: soundEventsObj.invoice_print !== false,
      },
    },
    vibrationEnabled:
      obj.vibrationEnabled !== undefined ? Boolean(obj.vibrationEnabled) : base.vibrationEnabled,
    shortcutsEnabled:
      obj.shortcutsEnabled !== undefined ? Boolean(obj.shortcutsEnabled) : base.shortcutsEnabled,
    customShortcuts,
    focusMode: Boolean(obj.focusMode),
    dashboard: {
      hiddenWidgets,
      widgetOrder: fullOrder,
      compactDensity: Boolean(dashObj.compactDensity),
    },
    dismissedNotificationIds: Array.isArray(obj.dismissedNotificationIds)
      ? obj.dismissedNotificationIds.filter((s: unknown): s is string => typeof s === 'string').slice(-50)
      : [],
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
  };
}

function getStorageKey(userId?: string | null): string {
  return `${USER_PREFS_STORAGE_PREFIX}_${userId || 'guest'}`;
}

export function loadLocalUserPreferences(
  userId?: string | null,
  fallbackTheme: ThemePreference = 'light'
): UserProductivityPreferences {
  if (typeof window === 'undefined') return getDefaultProductivityPreferences(fallbackTheme);
  try {
    const raw =
      localStorage.getItem(getStorageKey(userId)) ||
      localStorage.getItem(getStorageKey(null));
    if (!raw) return getDefaultProductivityPreferences(fallbackTheme);
    return mergeProductivityPreferences(JSON.parse(raw), fallbackTheme);
  } catch {
    return getDefaultProductivityPreferences(fallbackTheme);
  }
}

export function saveLocalUserPreferences(
  prefs: UserProductivityPreferences,
  userId?: string | null
): void {
  if (typeof window === 'undefined') return;
  try {
    const serialized = JSON.stringify({ ...prefs, updatedAt: new Date().toISOString() });
    localStorage.setItem(getStorageKey(userId), serialized);
    localStorage.setItem(getStorageKey(null), serialized);
  } catch {
    // ignore storage quota errors
  }
}

export async function loadUserPreferencesFromSupabase(
  userId: string,
  fallbackTheme: ThemePreference = 'light'
): Promise<{ prefs: UserProductivityPreferences | null; remoteSupported: boolean }> {
  const safeId = sanitizeUuid(userId);
  if (!safeId || !isSupabaseConfigured) {
    return { prefs: null, remoteSupported: false };
  }

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('ui_preferences')
      .eq('id', safeId)
      .maybeSingle();

    if (error) {
      const code = String(error.code || '');
      const msg = String(error.message || '').toLowerCase();
      if (code === '42703' || code === 'PGRST204' || msg.includes('ui_preferences')) {
        return { prefs: null, remoteSupported: false };
      }
      return { prefs: null, remoteSupported: true };
    }

    if (data && data.ui_preferences && Object.keys(data.ui_preferences).length > 0) {
      return {
        prefs: mergeProductivityPreferences(data.ui_preferences, fallbackTheme),
        remoteSupported: true,
      };
    }

    return { prefs: null, remoteSupported: true };
  } catch {
    return { prefs: null, remoteSupported: false };
  }
}

export async function saveUserPreferencesToSupabase(
  userId: string,
  prefs: UserProductivityPreferences
): Promise<{ saved: boolean; remoteSupported: boolean; error?: string }> {
  const safeId = sanitizeUuid(userId);
  if (!safeId || !isSupabaseConfigured) {
    return { saved: false, remoteSupported: false };
  }

  try {
    const payload = {
      ...prefs,
      updatedAt: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('user_profiles')
      .update({
        ui_preferences: payload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', safeId);

    if (error) {
      const code = String(error.code || '');
      const msg = String(error.message || '').toLowerCase();
      if (code === '42703' || code === 'PGRST204' || msg.includes('ui_preferences')) {
        return { saved: false, remoteSupported: false };
      }
      return { saved: false, remoteSupported: true, error: error.message };
    }

    return { saved: true, remoteSupported: true };
  } catch (err: any) {
    return {
      saved: false,
      remoteSupported: true,
      error: err?.message || 'Unable to sync preferences to cloud.',
    };
  }
}
