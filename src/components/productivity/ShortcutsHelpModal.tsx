import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Keyboard,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useProductivity } from '../../context/ProductivityContext';
import {
  SHORTCUT_DEFINITIONS,
  detectShortcutConflict,
  eventToKeyCombo,
  formatComboDisplay,
  resolveShortcutCombo,
} from '../../utils/keyboardShortcuts';
import { ShortcutActionId, ShortcutCategory } from '../../types';

const CATEGORIES: ShortcutCategory[] = ['Global', 'Navigation', 'Quick Create', 'Display', 'POS'];

export const ShortcutsHelpModal: React.FC = () => {
  const { canAccess } = useApp();
  const {
    shortcutsHelpOpen,
    setShortcutsHelpOpen,
    prefs,
    updateShortcutBinding,
    resetAllShortcuts,
    toggleShortcutsEnabled,
    showToast,
  } = useProductivity();

  const [capturingId, setCapturingId] = useState<ShortcutActionId | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    if (!shortcutsHelpOpen) {
      setCapturingId(null);
      setCaptureError(null);
    }
  }, [shortcutsHelpOpen]);

  useEffect(() => {
    if (!capturingId) return;

    const onCaptureKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setCapturingId(null);
        setCaptureError(null);
        return;
      }

      const combo = eventToKeyCombo(e);
      if (!combo) return;

      const conflict = detectShortcutConflict(capturingId, combo, prefs.customShortcuts);
      if (conflict?.reservedReason) {
        setCaptureError(conflict.reservedReason);
        return;
      }
      if (conflict?.conflictLabel) {
        setCaptureError(`"${combo}" is already assigned to "${conflict.conflictLabel}".`);
        return;
      }

      updateShortcutBinding(capturingId, combo);
      setCapturingId(null);
      setCaptureError(null);
      showToast({
        tone: 'success',
        title: 'Shortcut Updated',
        message: `Assigned ${combo} and saved to your user preferences.`,
        durationMs: 2400,
      });
    };

    window.addEventListener('keydown', onCaptureKeyDown, true);
    return () => window.removeEventListener('keydown', onCaptureKeyDown, true);
  }, [capturingId, prefs.customShortcuts, updateShortcutBinding, showToast]);

  const visibleDefs = useMemo(
    () =>
      SHORTCUT_DEFINITIONS.filter(
        def => !def.requiredModule || canAccess(def.requiredModule)
      ),
    [canAccess]
  );

  if (!shortcutsHelpOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="protiva-shortcuts-title"
      className="fixed inset-0 z-[85] bg-[#0A122C]/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 no-print"
      onClick={() => setShortcutsHelpOpen(false)}
    >
      <div
        className="w-full max-w-3xl bg-white dark:bg-[#101B3F] text-[#172033] dark:text-white rounded-2xl border border-[#E2E8F0] dark:border-[#243B70] shadow-2xl flex flex-col max-h-[88vh] overflow-hidden adp-modal-enter"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#101B3F] text-white border-b border-[#FF9D32]/30 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#FF9D32]/20 border border-[#FF9D32]/40 text-[#FF9D32] flex items-center justify-center shrink-0">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h2 id="protiva-shortcuts-title" className="text-sm sm:text-base font-bold">
                Keyboard Shortcuts &amp; Custom Keymap
              </h2>
              <p className="text-[11px] text-slate-300">
                Click any shortcut key to customize · Input-field safe &amp; browser-conflict guarded
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.shortcutsEnabled}
                onChange={e => toggleShortcutsEnabled(e.target.checked)}
                className="w-3.5 h-3.5 accent-[#FF9D32]"
              />
              <span>Enabled</span>
            </label>
            <button
              type="button"
              onClick={resetAllShortcuts}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset Defaults</span>
            </button>
            <button
              type="button"
              onClick={() => setShortcutsHelpOpen(false)}
              aria-label="Close shortcuts panel"
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Info & Conflict Notice */}
        {captureError && (
          <div className="px-5 py-2.5 bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{captureError}</span>
          </div>
        )}

        {/* Shortcuts Categories */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <div className="p-3 rounded-xl bg-[#F8FAFC] dark:bg-[#0D1736] border border-[#E2E8F0] dark:border-[#243B70] flex items-start gap-2.5 text-xs text-[#64748B] dark:text-slate-300">
            <ShieldCheck className="w-4 h-4 text-[#087F8C] dark:text-[#5EEAD4] shrink-0 mt-0.5" />
            <div>
              Shortcuts automatically pause while typing inside text inputs (except explicit counter actions like <strong className="text-[#172033] dark:text-white">Esc</strong>, <strong className="text-[#172033] dark:text-white">Ctrl+K</strong>, <strong className="text-[#172033] dark:text-white">Ctrl+S</strong>, <strong className="text-[#172033] dark:text-white">Ctrl+P</strong>, and <strong className="text-[#172033] dark:text-white">F1–F9</strong>). Critical browser tabs/copy/paste keys remain untouched.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {CATEGORIES.map(category => {
              const rows = visibleDefs.filter(d => d.category === category);
              if (rows.length === 0) return null;
              return (
                <div key={category} className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
                    {category}
                  </h3>
                  <div className="rounded-xl border border-[#E2E8F0] dark:border-[#243B70] divide-y divide-[#E2E8F0] dark:divide-[#243B70] overflow-hidden">
                    {rows.map(def => {
                      const activeCombo = resolveShortcutCombo(def.id, prefs.customShortcuts);
                      const isCustom = Boolean(prefs.customShortcuts[def.id]);
                      const isCapturing = capturingId === def.id;
                      const keys = formatComboDisplay(activeCombo);

                      return (
                        <div
                          key={def.id}
                          className="p-3 bg-white dark:bg-[#101B3F] flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold flex items-center gap-1.5">
                              <span className="truncate">{def.label}</span>
                              {isCustom && (
                                <span className="text-[10px] font-semibold text-[#087F8C] dark:text-[#FF9D32]">
                                  · Custom
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                              {def.description}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setCaptureError(null);
                              setCapturingId(isCapturing ? null : def.id);
                            }}
                            title="Click and press a key combination to customize"
                            className={`shrink-0 px-2.5 py-1.5 min-h-[34px] rounded-lg border text-[11px] font-mono-num font-bold transition-all cursor-pointer ${
                              isCapturing
                                ? 'bg-[#FF9D32] text-[#101B3F] border-[#FF9D32] animate-pulse'
                                : 'bg-[#F8FAFC] dark:bg-[#0D1736] border-[#E2E8F0] dark:border-[#243B70] hover:border-[#087F8C] dark:hover:border-[#FF9D32]'
                            }`}
                          >
                            {isCapturing ? 'Press keys...' : keys.join(' + ')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
