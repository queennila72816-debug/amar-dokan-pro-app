import React from 'react';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';
import { useProductivity } from '../../context/ProductivityContext';
import { ToastTone } from '../../types';

const TONE_STYLES: Record<
  ToastTone,
  { wrap: string; icon: React.ComponentType<{ className?: string }> }
> = {
  success: {
    wrap: 'bg-white dark:bg-[#101B3F] border-emerald-500/50 text-[#172033] dark:text-white',
    icon: CheckCircle2,
  },
  info: {
    wrap: 'bg-white dark:bg-[#101B3F] border-[#087F8C]/50 text-[#172033] dark:text-white',
    icon: Info,
  },
  warning: {
    wrap: 'bg-white dark:bg-[#101B3F] border-amber-500/50 text-[#172033] dark:text-white',
    icon: AlertTriangle,
  },
  error: {
    wrap: 'bg-white dark:bg-[#101B3F] border-rose-500/60 text-[#172033] dark:text-white',
    icon: XCircle,
  },
};

const ICON_COLORS: Record<ToastTone, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  info: 'text-[#087F8C] dark:text-[#5EEAD4]',
  warning: 'text-amber-600 dark:text-amber-400',
  error: 'text-rose-600 dark:text-rose-400',
};

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useProductivity();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-[90] flex flex-col gap-2 sm:w-96 pointer-events-none no-print"
    >
      {toasts.map(toast => {
        const cfg = TONE_STYLES[toast.tone];
        const Icon = cfg.icon;
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start justify-between gap-3 rounded-xl border px-4 py-3 shadow-xl backdrop-blur-xs adp-modal-enter ${cfg.wrap}`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${ICON_COLORS[toast.tone]}`} />
              <div className="min-w-0">
                <p className="text-xs font-bold leading-snug">{toast.title}</p>
                {toast.message && (
                  <p className="text-[11px] text-[#64748B] dark:text-slate-300 mt-0.5 leading-snug">
                    {toast.message}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
              className="p-1.5 -mr-1 -mt-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
