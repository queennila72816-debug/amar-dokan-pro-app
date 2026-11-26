import { LegacyAppModule } from './rbacDefaults';
import { ShortcutActionId, ShortcutCategory } from '../types';

export interface ShortcutDefinition {
  id: ShortcutActionId;
  label: string;
  description: string;
  category: ShortcutCategory;
  defaultCombo: string;
  allowInInputs: boolean;
  customizable: boolean;
  requiredModule?: LegacyAppModule;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: 'open_command_palette',
    label: 'Global Command Palette',
    description: 'Search pages, products, actions, and recent activities',
    category: 'Global',
    defaultCombo: 'Ctrl+K',
    allowInInputs: true,
    customizable: true,
  },
  {
    id: 'open_shortcuts_help',
    label: 'Keyboard Shortcuts Help',
    description: 'Open shortcut reference & customize key bindings',
    category: 'Global',
    defaultCombo: 'F1',
    allowInInputs: true,
    customizable: true,
  },
  {
    id: 'save_active',
    label: 'Save Active Form / Changes',
    description: 'Save current form or settings cleanly without opening browser Save Page',
    category: 'Global',
    defaultCombo: 'Ctrl+S',
    allowInInputs: true,
    customizable: true,
  },
  {
    id: 'print_active',
    label: 'Print Active View / Invoice',
    description: 'Print open invoice, preview modal, or report cleanly',
    category: 'Global',
    defaultCombo: 'Ctrl+P',
    allowInInputs: true,
    customizable: true,
  },
  {
    id: 'go_pos',
    label: 'Open POS Billing',
    description: 'Jump directly to New Sale (POS) counter',
    category: 'Navigation',
    defaultCombo: 'F2',
    allowInInputs: false,
    customizable: true,
    requiredModule: 'pos',
  },
  {
    id: 'open_scanner',
    label: 'Open Barcode / QR Scanner',
    description: 'Launch live camera & USB scanner workspace',
    category: 'Navigation',
    defaultCombo: 'F3',
    allowInInputs: false,
    customizable: true,
    requiredModule: 'scanner',
  },
  {
    id: 'go_dashboard',
    label: 'Go to Dashboard',
    description: 'Return to executive KPIs and live overview',
    category: 'Navigation',
    defaultCombo: 'Alt+D',
    allowInInputs: false,
    customizable: true,
    requiredModule: 'dashboard',
  },
  {
    id: 'open_system_status',
    label: 'System & Printer Status',
    description: 'Check Supabase cloud sync, internet, and printer setup guide',
    category: 'Navigation',
    defaultCombo: 'F12',
    allowInInputs: false,
    customizable: true,
  },
  {
    id: 'new_product',
    label: 'New Product',
    description: 'Open Create Product dialog (with permission)',
    category: 'Quick Create',
    defaultCombo: 'Alt+P',
    allowInInputs: false,
    customizable: true,
    requiredModule: 'products',
  },
  {
    id: 'new_customer',
    label: 'New Customer',
    description: 'Open Add Customer dialog',
    category: 'Quick Create',
    defaultCombo: 'Alt+C',
    allowInInputs: false,
    customizable: true,
    requiredModule: 'customers',
  },
  {
    id: 'new_purchase',
    label: 'New Purchase',
    description: 'Open Record Purchase dialog',
    category: 'Quick Create',
    defaultCombo: 'Alt+B',
    allowInInputs: false,
    customizable: true,
    requiredModule: 'purchases',
  },
  {
    id: 'new_expense',
    label: 'New Expense',
    description: 'Open Record Expense dialog',
    category: 'Quick Create',
    defaultCombo: 'Alt+E',
    allowInInputs: false,
    customizable: true,
    requiredModule: 'accounts',
  },
  {
    id: 'toggle_focus_mode',
    label: 'Toggle Focus Mode',
    description: 'Collapse chrome & sidebar for distraction-free counter work',
    category: 'Display',
    defaultCombo: 'F10',
    allowInInputs: false,
    customizable: true,
  },
  {
    id: 'toggle_fullscreen',
    label: 'Toggle Full Screen',
    description: 'Expand PROTIVA to full screen on PC & supported Android browsers',
    category: 'Display',
    defaultCombo: 'F11',
    allowInInputs: false,
    customizable: true,
  },
  {
    id: 'toggle_theme',
    label: 'Cycle Theme (Light / Dark / System)',
    description: 'Switch between Light, Dark, and System appearance',
    category: 'Display',
    defaultCombo: 'Alt+T',
    allowInInputs: false,
    customizable: true,
  },
  {
    id: 'pos_focus_barcode',
    label: 'Focus POS Barcode Input',
    description: 'Place cursor into POS barcode/SKU box immediately',
    category: 'POS',
    defaultCombo: 'F4',
    allowInInputs: true,
    customizable: true,
    requiredModule: 'pos',
  },
  {
    id: 'pos_focus_search',
    label: 'Focus POS Product Search',
    description: 'Search inventory inside POS quickly',
    category: 'POS',
    defaultCombo: 'F6',
    allowInInputs: true,
    customizable: true,
    requiredModule: 'pos',
  },
  {
    id: 'pos_clear_cart',
    label: 'Clear POS Cart',
    description: 'Prompt to clear active POS cart safely',
    category: 'POS',
    defaultCombo: 'F8',
    allowInInputs: false,
    customizable: true,
    requiredModule: 'pos',
  },
  {
    id: 'pos_complete_sale',
    label: 'Complete POS Sale',
    description: 'Submit checkout & generate invoice when POS cart is ready',
    category: 'POS',
    defaultCombo: 'F9',
    allowInInputs: true,
    customizable: true,
    requiredModule: 'pos',
  },
];

// Native browser critical shortcuts we should NEVER allow custom override to hijack blindly
export const RESERVED_BROWSER_COMBOS = new Set([
  'Ctrl+W',
  'Ctrl+T',
  'Ctrl+N',
  'Ctrl+R',
  'Ctrl+L',
  'Ctrl+Shift+I',
  'Ctrl+Shift+J',
  'Ctrl+C',
  'Ctrl+V',
  'Ctrl+X',
  'Ctrl+A',
  'Ctrl+Z',
  'Ctrl+Y',
]);

export interface KeyEventLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function normalizeKeyName(rawKey: string): string {
  const key = (rawKey || '').trim();
  if (!key) return '';
  if (/^f([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  if (key.toLowerCase() === 'escape' || key.toLowerCase() === 'esc') return 'Esc';
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key[0].toUpperCase() + key.slice(1);
}

export function normalizeKeyCombo(combo: string): string {
  if (!combo || typeof combo !== 'string') return '';
  const parts = combo
    .split('+')
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';

  let ctrl = false;
  let alt = false;
  let shift = false;
  let mainKey = '';

  for (const part of parts) {
    const low = part.toLowerCase();
    if (low === 'ctrl' || low === 'control' || low === 'cmd' || low === 'meta') {
      ctrl = true;
    } else if (low === 'alt' || low === 'option') {
      alt = true;
    } else if (low === 'shift') {
      shift = true;
    } else {
      mainKey = normalizeKeyName(part);
    }
  }

  if (!mainKey) return '';
  const ordered: string[] = [];
  if (ctrl) ordered.push('Ctrl');
  if (alt) ordered.push('Alt');
  if (shift) ordered.push('Shift');
  ordered.push(mainKey);
  return ordered.join('+');
}

export function eventToKeyCombo(e: KeyEventLike): string {
  const keyName = normalizeKeyName(e.key);
  if (
    !keyName ||
    keyName === 'Control' ||
    keyName === 'Shift' ||
    keyName === 'Alt' ||
    keyName === 'Meta'
  ) {
    return '';
  }

  const ordered: string[] = [];
  if (e.ctrlKey || e.metaKey) ordered.push('Ctrl');
  if (e.altKey) ordered.push('Alt');
  if (e.shiftKey) ordered.push('Shift');
  ordered.push(keyName);
  return ordered.join('+');
}

export function matchesKeyCombo(e: KeyEventLike, combo: string): boolean {
  const expected = normalizeKeyCombo(combo);
  const actual = eventToKeyCombo(e);
  return Boolean(expected && actual && expected === actual);
}

export function isEditableElementTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (typeof el.getAttribute === 'function' && el.getAttribute('role') === 'textbox') return true;
  return false;
}

export function shouldIgnoreShortcutEvent(
  e: KeyEventLike & { target?: EventTarget | null },
  allowInInputs: boolean
): boolean {
  if (!isEditableElementTarget(e.target ?? null)) return false;
  if (allowInInputs) return false;
  return true;
}

export function resolveShortcutCombo(
  actionId: ShortcutActionId,
  customShortcuts?: Partial<Record<ShortcutActionId, string>>
): string {
  const custom = customShortcuts?.[actionId];
  if (custom && normalizeKeyCombo(custom)) {
    return normalizeKeyCombo(custom);
  }
  const def = SHORTCUT_DEFINITIONS.find(d => d.id === actionId);
  return def ? normalizeKeyCombo(def.defaultCombo) : '';
}

export function buildEffectiveShortcutMap(
  customShortcuts?: Partial<Record<ShortcutActionId, string>>
): Record<ShortcutActionId, string> {
  const map = {} as Record<ShortcutActionId, string>;
  for (const def of SHORTCUT_DEFINITIONS) {
    map[def.id] = resolveShortcutCombo(def.id, customShortcuts);
  }
  return map;
}

export function detectShortcutConflict(
  actionId: ShortcutActionId,
  candidateCombo: string,
  customShortcuts?: Partial<Record<ShortcutActionId, string>>
): { conflictWithId?: ShortcutActionId; conflictLabel?: string; reservedReason?: string } | null {
  const normalized = normalizeKeyCombo(candidateCombo);
  if (!normalized) {
    return { reservedReason: 'Invalid key combination.' };
  }
  if (RESERVED_BROWSER_COMBOS.has(normalized)) {
    return {
      reservedReason: `${normalized} is reserved for critical browser/editing actions.`,
    };
  }
  for (const def of SHORTCUT_DEFINITIONS) {
    if (def.id === actionId) continue;
    const existing = resolveShortcutCombo(def.id, customShortcuts);
    if (existing === normalized) {
      return {
        conflictWithId: def.id,
        conflictLabel: def.label,
      };
    }
  }
  return null;
}

export function formatComboDisplay(combo: string): string[] {
  const norm = normalizeKeyCombo(combo);
  if (!norm) return [];
  return norm.split('+');
}
