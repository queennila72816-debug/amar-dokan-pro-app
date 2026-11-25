import React, { useState } from 'react';
import { Product, ProductVariant } from '../../types';
import { CameraBarcodeScanner } from './CameraBarcodeScanner';
import { HardwareScannerInput } from './HardwareScannerInput';
import {
  getScannerHidPreferences,
  lookupProductByScannedCode,
  playScanBeep,
  ScannedProductMatch,
} from '../../utils/scannerLookup';
import { formatCurrency } from '../../utils/formatters';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { inferColorHex, resolveProductImage } from '../../utils/productImageResolver';
import {
  Camera,
  Usb,
  X,
  CheckCircle2,
  AlertTriangle,
  PackageSearch,
  ExternalLink,
  ShoppingCart,
} from 'lucide-react';

interface ScannerModalProps {
  isOpen: boolean;
  mode: 'pos' | 'stock_check';
  products: Product[];
  activeBranchId?: string;
  currencyLanguage?: 'en' | 'bn';
  onClose: () => void;
  onResultForPos?: (match: ScannedProductMatch) => { ok: boolean; message: string };
  onOpenProductDetails?: (product: Product) => void;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  mode,
  products,
  activeBranchId,
  currencyLanguage = 'en',
  onClose,
  onResultForPos,
  onOpenProductDetails,
}) => {
  const [inputMode, setInputMode] = useState<'camera' | 'hid'>('camera');
  const [lastMatch, setLastMatch] = useState<ScannedProductMatch | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);

  if (!isOpen) return null;

  const handleDetectedCode = (rawCode: string) => {
    const match = lookupProductByScannedCode(rawCode, products, activeBranchId);
    setLastMatch(match);

    const prefs = getScannerHidPreferences();
    if (!match.found || !match.product) {
      if (prefs.beepOnScan) playScanBeep('error');
      setFeedback({
        tone: 'error',
        text: `No active product found for code "${rawCode}".`,
      });
      return;
    }

    if (mode === 'pos' && onResultForPos) {
      const outcome = onResultForPos(match);
      if (prefs.beepOnScan) playScanBeep(outcome.ok ? 'success' : 'error');
      setFeedback({
        tone: outcome.ok ? 'success' : 'warning',
        text: outcome.message,
      });
      return;
    }

    // Stock check mode (read-only)
    if (prefs.beepOnScan) playScanBeep('success');
    const stockCount = match.variant ? match.variant.stock : match.product.currentStock;
    setFeedback({
      tone: stockCount > 0 ? 'success' : 'warning',
      text: `${match.product.name}${match.variant ? ` (${[match.variant.color, match.variant.size].filter(Boolean).join(' / ')})` : ''} — ${stockCount} ${match.product.unit} in stock`,
    });
  };

  const matchedProduct = lastMatch?.product;
  const matchedVariant: ProductVariant | undefined = lastMatch?.variant;
  const displayStock = matchedVariant ? matchedVariant.stock : matchedProduct?.currentStock ?? 0;
  const displayPrice =
    matchedVariant?.salePrice !== undefined
      ? matchedVariant.salePrice
      : matchedVariant?.additionalPrice && matchedProduct
      ? matchedProduct.salePrice + matchedVariant.additionalPrice
      : matchedProduct?.salePrice ?? 0;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-[#101B35] rounded-2xl border border-slate-200 dark:border-[#1F3158] shadow-2xl w-full max-w-2xl overflow-hidden my-4"
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[#1F3158] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-2 rounded-xl bg-[#087F8C]/15 text-[#087F8C] shrink-0">
              {mode === 'pos' ? <ShoppingCart className="w-4 h-4" /> : <PackageSearch className="w-4 h-4" />}
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-[#172033] dark:text-white truncate">
                {mode === 'pos' ? 'Scan Product to Add to Invoice' : 'Scan Product to Check Stock'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {mode === 'pos'
                  ? 'Supports mobile camera, USB/Bluetooth HID scanner, and QR labels'
                  : 'Instant read-only stock verification without modifying inventory'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#162344] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Input Mode Switcher */}
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-[#0B1428] border border-slate-200 dark:border-[#1F3158]">
            <button
              type="button"
              onClick={() => setInputMode('camera')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                inputMode === 'camera'
                  ? 'bg-white dark:bg-[#162344] text-[#087F8C] dark:text-[#FF9D32] shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Camera Scanner</span>
            </button>
            <button
              type="button"
              onClick={() => setInputMode('hid')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                inputMode === 'hid'
                  ? 'bg-white dark:bg-[#162344] text-[#087F8C] dark:text-[#FF9D32] shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Usb className="w-3.5 h-3.5" />
              <span>USB / Bluetooth HID</span>
            </button>
          </div>

          {inputMode === 'camera' ? (
            <CameraBarcodeScanner
              active={isOpen && inputMode === 'camera'}
              autoStart={true}
              compact={true}
              onScan={handleDetectedCode}
            />
          ) : (
            <HardwareScannerInput
              autoFocus={true}
              onScan={code => handleDetectedCode(code)}
              label="USB / Bluetooth Barcode Scanner"
            />
          )}

          {/* Non-blocking Status Feedback */}
          {feedback && (
            <div
              className={`px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                feedback.tone === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                  : feedback.tone === 'warning'
                  ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300'
                  : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300'
              }`}
            >
              {feedback.tone === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span className="flex-1">{feedback.text}</span>
            </div>
          )}

          {/* Scanned Product Snapshot Card */}
          {matchedProduct && (
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-[#1F3158] bg-slate-50 dark:bg-[#0B1428] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <ProductThumbnail
                  src={resolveProductImage(matchedProduct, {
                    colorId: matchedVariant?.colorId,
                    variantId: matchedVariant?.id,
                    colorName: matchedVariant?.color,
                  })}
                  alt={matchedProduct.name}
                  colorHex={
                    matchedVariant?.color
                      ? inferColorHex(matchedVariant.color, matchedVariant.colorHex)
                      : undefined
                  }
                  colorName={matchedVariant?.color}
                  size="md"
                />
                <div className="min-w-0">
                  <div className="font-bold text-sm text-slate-900 dark:text-white truncate">
                    {matchedProduct.name}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-2.5 gap-y-0.5 mt-0.5">
                    <span>{matchedProduct.category}</span>
                    <span className="font-mono">SKU: {matchedVariant?.sku || matchedProduct.code}</span>
                    {(matchedVariant?.barcode || matchedProduct.barcode) && (
                      <span className="font-mono">
                        Barcode: {matchedVariant?.barcode || matchedProduct.barcode}
                      </span>
                    )}
                    {matchedVariant && (matchedVariant.color || matchedVariant.size) && (
                      <span className="font-semibold text-[#087F8C] dark:text-[#5EEAD4]">
                        {[matchedVariant.color, matchedVariant.size].filter(Boolean).join(' / ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-xs font-extrabold font-mono-num text-slate-900 dark:text-white">
                    {formatCurrency(displayPrice, currencyLanguage)}
                  </div>
                  <div
                    className={`text-[11px] font-bold font-mono-num ${
                      displayStock <= 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : displayStock <= (matchedVariant?.minStockAlert || matchedProduct.minStockAlert || 5)
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    Stock: {displayStock} {matchedProduct.unit}
                  </div>
                </div>

                {onOpenProductDetails && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenProductDetails(matchedProduct);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#162344] text-xs font-bold text-slate-700 dark:text-white hover:bg-slate-100 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
