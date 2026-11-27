import React, { useEffect, useMemo, useState } from 'react';
import {
  Branch,
  Customer,
  InstallmentAgreement,
  InstallmentSlipLanguage,
  ShopSettings,
} from '../../types';
import {
  buildInstallmentSlipHtml,
  downloadInstallmentSlipPdf,
  printInstallmentSlip,
} from '../../utils/installmentSlipExport';
import { cancelActivePrintJob } from '../../utils/printEngine';
import {
  Download,
  Eye,
  Languages,
  Loader2,
  Printer,
  ShieldCheck,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface InstallmentSlipPreviewModalProps {
  isOpen: boolean;
  agreement: InstallmentAgreement | null;
  customer?: Customer | null;
  settings: ShopSettings;
  activeBranch?: Branch | null;
  initialLanguage?: InstallmentSlipLanguage;
  onClose: () => void;
}

const LANGUAGE_OPTIONS: { id: InstallmentSlipLanguage; label: string }[] = [
  { id: 'bn', label: 'বাংলা (Default)' },
  { id: 'en', label: 'English' },
  { id: 'both', label: 'বাংলা + English' },
];

export const InstallmentSlipPreviewModal: React.FC<InstallmentSlipPreviewModalProps> = ({
  isOpen,
  agreement,
  customer,
  settings,
  activeBranch,
  initialLanguage = 'bn',
  onClose,
}) => {
  const [slipLanguage, setSlipLanguage] = useState<InstallmentSlipLanguage>(initialLanguage);
  const [zoom, setZoom] = useState<number>(0.85);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      cancelActivePrintJob();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      cancelActivePrintJob();
      setIsPrinting(false);
    }
  }, [isOpen]);

  const slipHtml = useMemo(() => {
    if (!agreement) return '';
    return buildInstallmentSlipHtml({
      agreement,
      settings,
      activeBranch,
      customer,
      language: slipLanguage,
    });
  }, [agreement, settings, activeBranch, customer, slipLanguage]);

  if (!isOpen || !agreement) return null;

  const handleClose = () => {
    cancelActivePrintJob();
    setIsPrinting(false);
    onClose();
  };

  const handlePrint = () => {
    if (isPrinting) return;
    setActionError(null);
    setIsPrinting(true);
    try {
      const res = printInstallmentSlip({
        agreement,
        settings,
        activeBranch,
        customer,
        language: slipLanguage,
      });
      if (!res.opened && !res.cancelled) {
        setActionError(res.error || 'Could not open system print dialog.');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Could not open system print dialog.');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (isDownloadingPdf) return;
    setActionError(null);
    setIsDownloadingPdf(true);
    try {
      await downloadInstallmentSlipPdf({
        agreement,
        settings,
        activeBranch,
        customer,
        language: slipLanguage,
      });
    } catch (err: any) {
      setActionError(err?.message || 'Failed to generate A4 PDF. Please try printing to PDF.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto no-print">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden">
        {/* Top Toolbar */}
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#0B2A6B] text-white flex items-center justify-center shrink-0">
              <Eye className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">
                Customer Installment Slip · {agreement.agreementCode}
              </h3>
              <p className="text-[11px] text-slate-500 truncate">
                {agreement.customerName} ({agreement.customerMobile || 'No phone'}) · A4 Portrait
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Language Switcher */}
            <div className="flex items-center gap-1 bg-slate-200/80 p-1 rounded-lg">
              <Languages className="w-3.5 h-3.5 text-slate-600 ml-1 mr-0.5 hidden sm:block" />
              {LANGUAGE_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSlipLanguage(opt.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                    slipLanguage === opt.id
                      ? 'bg-[#0B2A6B] text-white shadow-xs'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Zoom Controls */}
            <div className="hidden md:flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1.5 py-0.5">
              <button
                type="button"
                onClick={() => setZoom(z => Math.max(0.6, Number((z - 0.1).toFixed(2))))}
                title="Zoom Out"
                className="p-1 text-slate-600 hover:text-slate-900 rounded cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono font-semibold text-slate-700 w-10 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom(z => Math.min(1.25, Number((z + 0.1).toFixed(2))))}
                title="Zoom In"
                className="p-1 text-slate-600 hover:text-slate-900 rounded cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleClose}
              aria-label="Close Preview"
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Privacy Notice */}
        <div className="px-4 py-1.5 bg-sky-50 border-b border-sky-200 text-sky-900 text-[11px] flex items-center gap-1.5 shrink-0">
          <ShieldCheck className="w-3.5 h-3.5 text-sky-700 shrink-0" />
          <span>
            Customer Copy preserves privacy: NID numbers are masked, raw NID photos are omitted, and internal Last Payment Date / Remaining Due are hidden from printed copies.
          </span>
        </div>

        {actionError && (
          <div className="px-4 py-2 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs font-medium shrink-0">
            {actionError}
          </div>
        )}

        {/* Scrollable A4 Preview Canvas */}
        <div className="flex-1 overflow-auto bg-slate-200/80 p-3 sm:p-5 flex justify-center">
          <div
            style={{
              width: `${Math.round(794 * zoom)}px`,
              minHeight: `${Math.round(1123 * zoom)}px`,
            }}
            className="relative bg-white shadow-xl border border-slate-300 rounded-md overflow-hidden shrink-0"
          >
            <iframe
              title={`Installment Slip Preview - ${agreement.agreementCode}`}
              srcDoc={slipHtml}
              style={{
                width: '794px',
                height: '1123px',
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                border: 'none',
              }}
              className="block bg-white"
            />
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div className="px-4 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-slate-500">
            Duration: <strong className="text-slate-800">{agreement.durationMonths} Month(s)</strong> · Schedule rows auto-synced
          </span>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={handleClose}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isDownloadingPdf}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#0B2A6B] hover:brightness-110 disabled:opacity-60 rounded-lg shadow-xs transition-all cursor-pointer"
            >
              {isDownloadingPdf ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>{isDownloadingPdf ? 'Generating PDF...' : 'Download A4 PDF'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg shadow-xs transition-all cursor-pointer"
            >
              {isPrinting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Printer className="w-4 h-4" />
              )}
              <span>{isPrinting ? 'Opening Print...' : 'Print Slip'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
