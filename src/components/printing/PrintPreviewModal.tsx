import React, { useEffect, useRef, useState } from 'react';
import {
  Printer,
  X,
  ZoomIn,
  ZoomOut,
  AlertTriangle,
  Info,
  FileText,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { cancelActivePrintJob, printDocument } from '../../utils/printEngine';

interface PrintPreviewModalProps {
  isOpen: boolean;
  title: string;
  html: string;
  paperInfo?: string;
  showScaleGuidance?: boolean;
  isGenerating?: boolean;
  generationProgress?: { done: number; total: number } | null;
  generationError?: string | null;
  onCancelGeneration?: () => void;
  onRetryGeneration?: () => void;
  onClose: () => void;
}

export const PrintPreviewModal: React.FC<PrintPreviewModalProps> = ({
  isOpen,
  title,
  html,
  paperInfo,
  showScaleGuidance = true,
  isGenerating = false,
  generationProgress = null,
  generationError = null,
  onCancelGeneration,
  onRetryGeneration,
  onClose,
}) => {
  const [zoom, setZoom] = useState<number>(100);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isPreviewLoaded, setIsPreviewLoaded] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setPrintError(null);
    if (!isOpen || !html) {
      setIsPreviewLoaded(false);
      return;
    }

    setIsPreviewLoaded(false);
    // Fallback check in case srcDoc finishes synchronously or onLoad already fired
    const checkReady = () => {
      try {
        const doc = previewIframeRef.current?.contentDocument;
        if (doc && doc.readyState === 'complete' && doc.body && doc.body.innerHTML.length > 0) {
          setIsPreviewLoaded(true);
        }
      } catch {
        // ignore cross-origin access edge cases
      }
    };
    const t1 = window.setTimeout(checkReady, 30);
    const t2 = window.setTimeout(() => setIsPreviewLoaded(true), 600);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [html, isOpen]);

  if (!isOpen) return null;

  const handlePrint = () => {
    if (isPrinting || isGenerating || !html || !isPreviewLoaded) return;
    setPrintError(null);
    setIsPrinting(true);

    try {
      const res = printDocument(html, title);
      if (!res.opened && !res.cancelled) {
        setPrintError(res.error || 'Could not launch browser print dialog.');
      }
    } catch (err: any) {
      setPrintError(err?.message || 'Unexpected error while opening browser print dialog.');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleClose = () => {
    if (isGenerating && onCancelGeneration) {
      onCancelGeneration();
    }
    cancelActivePrintJob();
    setIsPrinting(false);
    onClose();
  };

  const activeError = generationError || printError;
  const canPrint = !isGenerating && Boolean(html) && isPreviewLoaded && !isPrinting;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-[#0A122C]/80 backdrop-blur-xs no-print">
      <div className="bg-white dark:bg-[#101B3F] rounded-[14px] shadow-2xl border border-[#E2E8F0] dark:border-[#243B70] w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden adp-modal-enter">
        {/* Top Toolbar */}
        <div className="px-4 py-3 border-b border-[#243B70] bg-[#101B3F] text-white flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 truncate">
              <FileText className="w-4 h-4 text-[#FF9D32] shrink-0" />
              <span className="truncate">{title}</span>
            </h3>
            {paperInfo && (
              <p className="text-[11px] text-slate-300 font-medium mt-0.5 truncate">
                {paperInfo}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Zoom Controls */}
            <div className="flex items-center bg-[#243B70]/70 border border-white/15 rounded-[8px] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setZoom(z => Math.max(50, z - 25))}
                className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-mono font-bold text-[#FF9D32] min-w-[46px] text-center">
                {zoom}%
              </span>
              <button
                type="button"
                onClick={() => setZoom(z => Math.min(150, z + 25))}
                className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={handlePrint}
              disabled={!canPrint}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[#101B3F] bg-[#FF9D32] hover:brightness-105 disabled:opacity-50 rounded-[10px] shadow-xs transition-all cursor-pointer"
            >
              {isPrinting || (Boolean(html) && !isGenerating && !isPreviewLoaded) ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Printer className="w-4 h-4" />
              )}
              <span>
                {isPrinting
                  ? 'Opening Print...'
                  : Boolean(html) && !isGenerating && !isPreviewLoaded
                  ? 'Loading Preview...'
                  : 'Print / Save PDF'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-[8px] transition-colors cursor-pointer"
              title="Close Preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scale Guidance & Error Banner */}
        {showScaleGuidance && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-[11px] flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>
              In the browser print dialog, set <strong>Scale: 100% (Actual size)</strong>, <strong>Margins: None / Minimum</strong>, and choose <strong>Save as PDF</strong> to generate a PDF without a physical printer.
            </span>
          </div>
        )}

        {activeError && (
          <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="truncate">{activeError}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {generationError && onRetryGeneration ? (
                <button
                  type="button"
                  onClick={onRetryGeneration}
                  className="flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-semibold cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Retry</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePrint}
                  className="flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-semibold cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Retry Print</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Exact Standalone Print Document Viewport */}
        <div className="flex-1 overflow-auto bg-slate-200/80 p-4 sm:p-6 flex justify-center items-start relative">
          {isGenerating ? (
            <div className="my-auto bg-white border border-slate-200 rounded-2xl shadow-lg p-6 max-w-sm w-full text-center space-y-3">
              <Loader2 className="w-8 h-8 text-purple-600 animate-spin mx-auto" />
              <div>
                <h4 className="text-sm font-bold text-slate-900">Generating Label Preview...</h4>
                <p className="text-xs text-slate-500 mt-1">
                  {generationProgress && generationProgress.total > 0
                    ? `Rendered ${generationProgress.done} of ${generationProgress.total} labels`
                    : 'Preparing barcodes and page layout...'}
                </p>
              </div>
              {onCancelGeneration && (
                <button
                  type="button"
                  onClick={onCancelGeneration}
                  className="px-4 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel Preview
                </button>
              )}
            </div>
          ) : html ? (
            <div
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'top center',
                width: zoom < 100 ? `${Math.round(10000 / zoom)}%` : '100%',
              }}
              className="flex justify-center transition-transform"
            >
              <iframe
                ref={previewIframeRef}
                title={title}
                srcDoc={html}
                onLoad={() => setIsPreviewLoaded(true)}
                data-loaded={isPreviewLoaded ? 'true' : 'false'}
                className="w-full max-w-3xl min-h-[70vh] bg-white rounded-lg shadow-lg border border-slate-300"
                style={{ height: '72vh' }}
              />
            </div>
          ) : (
            <div className="my-auto text-xs text-slate-500">
              No preview document available.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
