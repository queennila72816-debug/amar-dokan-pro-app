import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { APP_IDENTITY } from '../../config/appIdentity';

export const PWAInstallButton: React.FC = () => {
  const { canInstall, isIOSDevice, promptInstall } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (!canInstall && !isIOSDevice) return null;

  const handleClick = async () => {
    if (canInstall) {
      await promptInstall();
    } else if (isIOSDevice) {
      setShowIOSGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={`Install ${APP_IDENTITY.name} App`}
        aria-label={`Install ${APP_IDENTITY.name} App`}
        className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-[10px] bg-[#243B70]/70 hover:bg-[#243B70] text-white border border-[#FF9D32]/40 transition-colors whitespace-nowrap cursor-pointer"
      >
        <Download className="w-3.5 h-3.5 text-[#FF9D32]" />
        <span className="hidden xl:inline">Install App</span>
      </button>

      {showIOSGuide && (
        <div
          className="fixed inset-0 z-[80] bg-[#101B3F]/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-4"
          onClick={() => setShowIOSGuide(false)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-[#101B3F] text-[#172033] dark:text-white rounded-[16px] border border-[#E2E8F0] dark:border-[#243B70] p-5 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-[10px] bg-white border border-[#E2E8F0] p-1 flex items-center justify-center shrink-0">
                  <img
                    src={APP_IDENTITY.symbolPath}
                    alt={APP_IDENTITY.name}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Install {APP_IDENTITY.name}</h3>
                  <p className="text-[11px] text-[#64748B] dark:text-slate-300">
                    {APP_IDENTITY.subtitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="p-1.5 rounded-[8px] text-slate-400 hover:text-[#101B3F] dark:hover:text-white cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#475569] dark:text-slate-300 leading-relaxed">
              Add {APP_IDENTITY.name} to your iPhone or iPad Home Screen for fast full-screen access:
            </p>
            <ol className="space-y-1.5 text-xs text-[#172033] dark:text-slate-200 list-decimal pl-4">
              <li>
                Tap the <Share className="w-3.5 h-3.5 inline-block mx-0.5 text-[#243B70] dark:text-[#FF9D32]" />{' '}
                <strong>Share</strong> button in Safari.
              </li>
              <li>
                Scroll down and select <strong>Add to Home Screen</strong>.
              </li>
              <li>
                Tap <strong>Add</strong> in the top-right corner.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-2.5 rounded-[10px] bg-[#101B3F] hover:bg-[#243B70] text-white text-xs font-bold cursor-pointer transition-colors"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
