import { useCallback, useEffect, useRef } from 'react';
import { ScannerHidPreferences } from '../utils/scannerLookup';

interface UseHardwareScannerOptions {
  enabled: boolean;
  terminator: ScannerHidPreferences['terminator'];
  duplicateCooldownMs: number;
  onScan: (code: string) => void;
  /**
   * Optional global wedge listener when NO normal form input/textarea/select is focused.
   * Disabled by default unless explicitly enabled so normal inputs are never hijacked.
   */
  captureUnfocusedWedge?: boolean;
}

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Provides clean duplicate suppression & optional non-hijacking HID wedge support
 * for USB/Bluetooth barcode scanners in Chrome/Edge/Desktop browsers.
 */
export function useHardwareScanner({
  enabled,
  terminator,
  duplicateCooldownMs,
  onScan,
  captureUnfocusedWedge = false,
}: UseHardwareScannerOptions) {
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const emitScan = useCallback(
    (rawCode: string): boolean => {
      const clean = rawCode.trim();
      if (!clean) return false;

      const now = Date.now();
      if (
        duplicateCooldownMs > 0 &&
        lastScanRef.current.code === clean &&
        now - lastScanRef.current.time < duplicateCooldownMs
      ) {
        return false;
      }

      lastScanRef.current = { code: clean, time: now };
      onScanRef.current(clean);
      return true;
    },
    [duplicateCooldownMs]
  );

  const isTerminatorKey = useCallback(
    (key: string): boolean => {
      if (terminator === 'enter') return key === 'Enter';
      if (terminator === 'tab') return key === 'Tab';
      return key === 'Enter' || key === 'Tab';
    },
    [terminator]
  );

  useEffect(() => {
    if (!enabled || !captureUnfocusedWedge) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableElement(document.activeElement)) {
        bufferRef.current = '';
        return;
      }

      const now = Date.now();
      if (now - lastKeyTimeRef.current > 120) {
        bufferRef.current = '';
      }
      lastKeyTimeRef.current = now;

      if (isTerminatorKey(e.key)) {
        if (bufferRef.current.length >= 3) {
          e.preventDefault();
          const scanned = bufferRef.current;
          bufferRef.current = '';
          emitScan(scanned);
        } else {
          bufferRef.current = '';
        }
        return;
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, captureUnfocusedWedge, isTerminatorKey, emitScan]);

  return {
    emitScan,
    isTerminatorKey,
  };
}
