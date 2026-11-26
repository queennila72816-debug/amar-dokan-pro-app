import React, { useEffect } from 'react';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';
import { useProductivity } from '../../context/ProductivityContext';

export const ConfirmDialogModal: React.FC = () => {
  const { pendingConfirm, resolveConfirm } = useProductivity();

  useEffect(() => {
    if (!pendingConfirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        resolveConfirm(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingConfirm, resolveConfirm]);

  if (!pendingConfirm) return null;
  const { options } = pendingConfirm;
  const tone = options.tone || 'default';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="protiva-confirm-title"
      className="fixed inset-0 z-[95] bg-[#0A122C]/75 backdrop-blur-xs flex items-center justify-center p-4 no-print"
      onClick={() => resolveConfirm(false)}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-[#101B3F] text-[#172033] dark:text-white rounded-2xl border border-[#E2E8F0] dark:border-[#243B70] shadow-2xl p-5 space-y-4 adp-modal-enter"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                tone === 'danger'
                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                  : tone === 'warning'
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'bg-[#087F8C]/15 text-[#087F8C] dark:text-[#5EEAD4]'
              }`}
            >
              {tone === 'default' ? (
                <HelpCircle className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 id="protiva-confirm-title" className="text-sm font-bold leading-snug">
                {options.title}
              </h3>
              <p className="text-xs text-[#64748B] dark:text-slate-300 mt-1 leading-relaxed">
                {options.message}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => resolveConfirm(false)}
            aria-label="Close confirmation dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E2E8F0] dark:border-[#243B70]">
          <button
            type="button"
            onClick={() => resolveConfirm(false)}
            className="px-4 py-2 min-h-[40px] rounded-xl border border-[#E2E8F0] dark:border-[#243B70] text-xs font-semibold text-[#172033] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#182954] transition-colors cursor-pointer"
          >
            {options.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => resolveConfirm(true)}
            className={`px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold text-white transition-all cursor-pointer ${
              tone === 'danger'
                ? 'bg-rose-600 hover:bg-rose-700'
                : tone === 'warning'
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-[#087F8C] hover:bg-[#066974]'
            }`}
          >
            {options.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};
