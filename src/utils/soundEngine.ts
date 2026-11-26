import { SoundEventType, SoundPreferences } from '../types';

export interface SoundEventMeta {
  id: SoundEventType;
  label: string;
  description: string;
}

export const SOUND_EVENT_META: SoundEventMeta[] = [
  {
    id: 'scan_success',
    label: 'Barcode Scan Success',
    description: 'Crisp scanner beep when a barcode or QR matches inventory',
  },
  {
    id: 'product_not_found',
    label: 'Product Not Found Error',
    description: 'Alert tone when scanned code or SKU has no match',
  },
  {
    id: 'product_added',
    label: 'Product Added to Cart',
    description: 'Subtle chime when an item or combo is added to POS',
  },
  {
    id: 'sale_completed',
    label: 'Sale Completed',
    description: 'Confirmation chord when a POS checkout succeeds',
  },
  {
    id: 'payment_received',
    label: 'Payment Received',
    description: 'Positive chime when customer due payment is collected',
  },
  {
    id: 'low_stock_warning',
    label: 'Low Stock Warning',
    description: 'Gentle double alert when stock drops below threshold',
  },
  {
    id: 'new_order',
    label: 'New Order Notification',
    description: 'Incoming chime when a new marketplace combo order arrives',
  },
  {
    id: 'invoice_print',
    label: 'Invoice Print Feedback',
    description: 'Short chirp when invoice or label print job launches',
  },
];

export const DEFAULT_SOUND_PREFERENCES: SoundPreferences = {
  enabled: true,
  muted: false,
  silentMode: false,
  volume: 0.7,
  events: {
    scan_success: true,
    product_not_found: true,
    product_added: true,
    sale_completed: true,
    payment_received: true,
    low_stock_warning: true,
    new_order: true,
    invoice_print: true,
  },
};

export type HapticPatternKind = 'tap' | 'scan' | 'success' | 'warning' | 'error';

const HAPTIC_PATTERNS: Record<HapticPatternKind, number[]> = {
  tap: [12],
  scan: [25],
  success: [30, 30, 45],
  warning: [40, 30, 40],
  error: [55, 35, 70],
};

// Runtime state synced by ProductivityContext so even utility modules respect prefs immediately
let runtimeSoundPrefs: SoundPreferences = {
  ...DEFAULT_SOUND_PREFERENCES,
  events: { ...DEFAULT_SOUND_PREFERENCES.events },
};
let runtimeVibrationEnabled = true;

// Shared singleton AudioContext unlocked on first user gesture (required by Chrome / Android)
let sharedAudioCtx: AudioContext | null = null;
const lastPlayedTimestamps = new Map<string, number>();

const EVENT_COOLDOWN_MS: Record<SoundEventType, number> = {
  scan_success: 350,
  product_not_found: 420,
  product_added: 300,
  sale_completed: 600,
  payment_received: 600,
  low_stock_warning: 2500,
  new_order: 2000,
  invoice_print: 600,
};

export function syncRuntimeAudioPreferences(
  prefs: SoundPreferences,
  vibrationEnabled = true
): void {
  runtimeSoundPrefs = {
    ...DEFAULT_SOUND_PREFERENCES,
    ...prefs,
    volume: Math.max(0, Math.min(1, Number(prefs.volume ?? 0.7))),
    events: {
      ...DEFAULT_SOUND_PREFERENCES.events,
      ...(prefs.events || {}),
    },
  };
  runtimeVibrationEnabled = vibrationEnabled;
}

export function getRuntimeAudioPreferences(): SoundPreferences {
  return runtimeSoundPrefs;
}

export function isWebAudioSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

export function isVibrationSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function getOrResumeAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Call from initial user pointer/key handlers so Chrome & Android WebAudio unlocks cleanly.
 */
export function unlockAudioEngine(): void {
  getOrResumeAudioContext();
}

export function triggerHaptic(kind: HapticPatternKind = 'tap', forceIgnorePref = false): boolean {
  if (!forceIgnorePref && (!runtimeVibrationEnabled || runtimeSoundPrefs.silentMode)) {
    return false;
  }
  if (!isVibrationSupported()) return false;
  try {
    return Boolean(navigator.vibrate(HAPTIC_PATTERNS[kind] || [20]));
  } catch {
    return false;
  }
}

interface ToneSegment {
  freq: number;
  endFreq?: number;
  offsetSec: number;
  durationSec: number;
  type: OscillatorType;
  gainScale?: number;
}

const SOUND_SCORE: Record<SoundEventType, ToneSegment[]> = {
  scan_success: [
    { freq: 1240, offsetSec: 0, durationSec: 0.055, type: 'sine', gainScale: 0.9 },
    { freq: 1620, offsetSec: 0.05, durationSec: 0.065, type: 'sine', gainScale: 1.0 },
  ],
  product_not_found: [
    { freq: 340, endFreq: 210, offsetSec: 0, durationSec: 0.14, type: 'triangle', gainScale: 1.0 },
    { freq: 240, endFreq: 165, offsetSec: 0.12, durationSec: 0.14, type: 'triangle', gainScale: 0.85 },
  ],
  product_added: [
    { freq: 740, offsetSec: 0, durationSec: 0.05, type: 'sine', gainScale: 0.75 },
    { freq: 980, offsetSec: 0.04, durationSec: 0.07, type: 'sine', gainScale: 0.85 },
  ],
  sale_completed: [
    { freq: 587.33, offsetSec: 0, durationSec: 0.09, type: 'triangle', gainScale: 0.9 },
    { freq: 783.99, offsetSec: 0.08, durationSec: 0.09, type: 'triangle', gainScale: 0.95 },
    { freq: 1046.5, offsetSec: 0.16, durationSec: 0.18, type: 'sine', gainScale: 1.0 },
  ],
  payment_received: [
    { freq: 880, offsetSec: 0, durationSec: 0.08, type: 'sine', gainScale: 0.85 },
    { freq: 1318.5, offsetSec: 0.075, durationSec: 0.16, type: 'sine', gainScale: 1.0 },
  ],
  low_stock_warning: [
    { freq: 480, offsetSec: 0, durationSec: 0.09, type: 'triangle', gainScale: 0.8 },
    { freq: 420, offsetSec: 0.12, durationSec: 0.11, type: 'triangle', gainScale: 0.8 },
  ],
  new_order: [
    { freq: 659.25, offsetSec: 0, durationSec: 0.09, type: 'sine', gainScale: 0.85 },
    { freq: 987.77, offsetSec: 0.09, durationSec: 0.11, type: 'sine', gainScale: 0.95 },
    { freq: 1318.5, offsetSec: 0.19, durationSec: 0.15, type: 'sine', gainScale: 0.9 },
  ],
  invoice_print: [
    { freq: 1040, offsetSec: 0, durationSec: 0.055, type: 'sine', gainScale: 0.7 },
    { freq: 1280, offsetSec: 0.055, durationSec: 0.06, type: 'sine', gainScale: 0.6 },
  ],
};

function renderSoundSegments(event: SoundEventType, volume: number): boolean {
  const ctx = getOrResumeAudioContext();
  if (!ctx) return false;

  const segments = SOUND_SCORE[event];
  if (!segments || segments.length === 0) return false;

  const baseGain = Math.max(0.01, Math.min(0.24, volume * 0.2));
  const now = ctx.currentTime;

  try {
    for (const seg of segments) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startAt = now + seg.offsetSec;
      const peakGain = baseGain * (seg.gainScale ?? 1);

      osc.type = seg.type;
      osc.frequency.setValueAtTime(seg.freq, startAt);
      if (seg.endFreq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(60, seg.endFreq), startAt + seg.durationSec);
      }

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + seg.durationSec);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + seg.durationSec + 0.015);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure deduplication helper (safe for Node unit testing).
 */
export function shouldSuppressDuplicateSound(
  lastPlayedMap: Map<string, number>,
  event: SoundEventType,
  nowMs: number,
  dedupeKey?: string
): boolean {
  const key = dedupeKey ? `${event}:${dedupeKey}` : event;
  const cooldown = EVENT_COOLDOWN_MS[event] ?? 350;
  const prev = lastPlayedMap.get(key) ?? 0;
  if (nowMs - prev < cooldown) {
    return true;
  }

  // Also prevent scan_success and product_added from firing back-to-back within 280ms on a single scan
  if (event === 'product_added') {
    const lastScanSuccess = lastPlayedMap.get('scan_success') ?? 0;
    if (nowMs - lastScanSuccess < 280) {
      return true;
    }
  }

  lastPlayedMap.set(key, nowMs);
  return false;
}

export interface PlaySoundOptions {
  dedupeKey?: string;
  haptic?: HapticPatternKind | false;
}

/**
 * Plays a retail interaction sound if enabled, unmuted, not in silent mode,
 * and not triggered redundantly inside the deduplication window.
 */
export function playAppSound(event: SoundEventType, options: PlaySoundOptions = {}): boolean {
  const prefs = runtimeSoundPrefs;
  const now = Date.now();

  if (shouldSuppressDuplicateSound(lastPlayedTimestamps, event, now, options.dedupeKey)) {
    return false;
  }

  if (options.haptic !== false) {
    const defaultHaptic: HapticPatternKind =
      options.haptic ||
      (event === 'product_not_found'
        ? 'error'
        : event === 'low_stock_warning'
        ? 'warning'
        : event === 'sale_completed' || event === 'payment_received'
        ? 'success'
        : 'scan');
    triggerHaptic(defaultHaptic);
  }

  if (prefs.silentMode || prefs.muted || !prefs.enabled || prefs.volume <= 0) {
    return false;
  }

  if (prefs.events && prefs.events[event] === false) {
    return false;
  }

  return renderSoundSegments(event, prefs.volume);
}

/**
 * Explicit user-triggered "Test Sound" action inside Audio Preferences.
 * Plays regardless of individual event toggle (unless muted/silent, with optional volume).
 */
export function testAppSound(event: SoundEventType, volumeOverride?: number): boolean {
  const prefs = runtimeSoundPrefs;
  const vol = volumeOverride !== undefined ? volumeOverride : prefs.volume || 0.7;
  triggerHaptic('tap', true);
  return renderSoundSegments(event, Math.max(0.15, vol));
}

export function resetSoundDeduplicationCache(): void {
  lastPlayedTimestamps.clear();
}
