import React, { useEffect, useRef, useState } from 'react';
import {
  getScannerHidPreferences,
  saveScannerHidPreferences,
  ScannerHidPreferences,
} from '../../utils/scannerLookup';
import { useHardwareScanner } from '../../hooks/useHardwareScanner';
import { Barcode, CheckCircle2, Settings2, Usb } from 'lucide-react';

interface HardwareScannerInputProps {
  onScan: (code: string, source: 'hid' | 'manual') => void;
  autoFocus?: boolean;
  placeholder?: string;
  showPreferences?: boolean;
  compact?: boolean;
  label?: string;
}

export const HardwareScannerInput: React.FC<HardwareScannerInputProps> = ({
  onScan,
  autoFocus = false,
  placeholder = 'Click here & scan with USB / Bluetooth barcode scanner...',
  showPreferences = true,
  compact = false,
  label,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [prefs, setPrefs] = useState<ScannerHidPreferences>(() => getScannerHidPreferences());

  const { emitScan, isTerminatorKey } = useHardwareScanner({
    enabled: true,
    terminator: prefs.terminator,
    duplicateCooldownMs: prefs.duplicateCooldownMs,
    onScan: code => onScan(code, 'hid'),
    captureUnfocusedWedge: false,
  });

  useEffect(() => {
    if (autoFocus) {
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 80);
      return () => window.clearTimeout(timer);
    }
  }, [autoFocus]);

  const updatePrefs = (patch: Partial<ScannerHidPreferences>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveScannerHidPreferences(next);
  };

  const handleSubmitBuffer = (source: 'hid' | 'manual') => {
    const clean = value.trim();
    if (!clean) return;
    setValue('');
    if (source === 'hid') {
      emitScan(clean);
    } else {
      onScan(clean, 'manual');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Protect against accidental browser shortcuts triggered by scanner prefixes while focused here
    if ((e.ctrlKey || e.metaKey) && ['j', 'k', 'l', 's', 'p'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }

    if (isTerminatorKey(e.key)) {
      e.preventDefault();
      handleSubmitBuffer('hid');
    }
  };

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Usb className="w-3.5 h-3.5 text-[#087F8C]" />
            <span>{label}</span>
          </span>
          <span
            className={`text-[11px] font-semibold flex items-center gap-1 ${
              isFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            <span>{isFocused ? 'Scanner Input Ready' : 'Click input to focus scanner'}</span>
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Barcode className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            aria-label="USB or Bluetooth HID Barcode Scanner Input"
            autoComplete="off"
            spellCheck={false}
            className={`w-full pl-9 pr-20 ${
              compact ? 'py-2' : 'py-2.5'
            } text-xs font-mono rounded-[10px] border transition-colors bg-white dark:bg-[#0E182E] text-slate-900 dark:text-white focus:outline-none ${
              isFocused
                ? 'border-[#087F8C] ring-2 ring-[#087F8C]/20'
                : 'border-slate-200 dark:border-[#1F3158]'
            }`}
          />
          <button
            type="button"
            onClick={() => handleSubmitBuffer('manual')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-md bg-[#101B3F] hover:bg-[#1E2E68] text-white text-[11px] font-bold cursor-pointer"
          >
            Scan
          </button>
        </div>

        {showPreferences && (
          <button
            type="button"
            onClick={() => setShowSettings(prev => !prev)}
            title="Configure USB / Bluetooth HID Suffix & Cooldown"
            className={`p-2.5 rounded-[10px] border text-xs cursor-pointer transition-colors shrink-0 ${
              showSettings
                ? 'border-[#087F8C] bg-[#087F8C]/10 text-[#087F8C]'
                : 'border-slate-200 dark:border-[#1F3158] bg-slate-50 dark:bg-[#0E182E] text-slate-600 dark:text-slate-300 hover:bg-slate-100'
            }`}
          >
            <Settings2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {showPreferences && showSettings && (
        <div className="p-3 rounded-xl border border-slate-200 dark:border-[#1F3158] bg-slate-50 dark:bg-[#0E182E] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Scanner Suffix Key
            </label>
            <select
              value={prefs.terminator}
              onChange={e =>
                updatePrefs({ terminator: e.target.value as ScannerHidPreferences['terminator'] })
              }
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#101B35] text-xs"
            >
              <option value="both">Enter or Tab (Recommended)</option>
              <option value="enter">Enter Key Only</option>
              <option value="tab">Tab Key Only</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Duplicate Scan Cooldown
            </label>
            <select
              value={prefs.duplicateCooldownMs}
              onChange={e => updatePrefs({ duplicateCooldownMs: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#101B35] text-xs"
            >
              <option value={0}>Off (Allow Rapid Same-Item Rescan)</option>
              <option value={600}>0.6 sec</option>
              <option value={1200}>1.2 sec (Recommended)</option>
              <option value={2000}>2.0 sec</option>
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer py-1.5 text-slate-700 dark:text-slate-200 font-medium">
              <input
                type="checkbox"
                checked={prefs.beepOnScan}
                onChange={e => updatePrefs({ beepOnScan: e.target.checked })}
                className="rounded text-[#087F8C] focus:ring-[#087F8C]"
              />
              <span>Audio beep on scan</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
