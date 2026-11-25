import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Product, ProductVariant, RecentScanEntry } from '../../types';
import { CameraBarcodeScanner } from './CameraBarcodeScanner';
import { HardwareScannerInput } from './HardwareScannerInput';
import { QrCodeSvg } from '../barcodes/QrCodeSvg';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { ProductDetailGalleryModal } from '../catalog/ProductDetailGalleryModal';
import { buildProductQrPayload } from '../../utils/barcodeGenerator';
import {
  clearRecentScans,
  getScannerHidPreferences,
  loadRecentScans,
  lookupProductByScannedCode,
  playScanBeep,
  saveRecentScan,
  ScannedProductMatch,
} from '../../utils/scannerLookup';
import { formatCurrency } from '../../utils/formatters';
import { isSalesmanOrCashierRole } from '../../utils/rbacDefaults';
import { inferColorHex, resolveProductImage } from '../../utils/productImageResolver';
import {
  ScanLine,
  Camera,
  Usb,
  Search,
  ShoppingCart,
  Boxes,
  Printer,
  PackagePlus,
  ExternalLink,
  Trash2,
  History,
  CheckCircle2,
  AlertTriangle,
  X,
  Layers,
  Tag,
} from 'lucide-react';

type ScannerWorkspaceMode = 'lookup' | 'pos' | 'stock_check' | 'label';

interface ScannerViewProps {
  onNavigateTab: (tab: string) => void;
}

export const ScannerView: React.FC<ScannerViewProps> = ({ onNavigateTab }) => {
  const {
    products,
    activeBusinessId,
    activeBranchId,
    branches,
    settings,
    hasPermission,
    currentUserRole,
    setPendingPosSelection,
    setPendingLabelSelection,
    setPendingNewProductBarcode,
    setPendingEditProductId,
  } = useApp();

  const lang = settings.language || 'en';
  const canCreatePos = hasPermission('pos_new_sale', 'create');
  const canCreateProduct = hasPermission('product_management', 'create');
  const canEditProduct = hasPermission('product_management', 'edit');
  const canPrintLabel =
    hasPermission('barcode_label_printing', 'view') ||
    hasPermission('barcode_label_printing', 'print');
  const canViewCost =
    !isSalesmanOrCashierRole(currentUserRole) &&
    (hasPermission('product_management', 'edit') ||
      hasPermission('purchase_management', 'view'));

  const [scanMode, setScanMode] = useState<ScannerWorkspaceMode>('lookup');
  const [inputChannel, setInputChannel] = useState<'camera' | 'hid'>('camera');
  const [manualQuery, setManualQuery] = useState('');
  const [lastMatch, setLastMatch] = useState<ScannedProductMatch | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [recentScans, setRecentScans] = useState<RecentScanEntry[]>(() =>
    loadRecentScans(activeBusinessId, activeBranchId)
  );
  const [detailModalProduct, setDetailModalProduct] = useState<Product | null>(null);

  useEffect(() => {
    setRecentScans(loadRecentScans(activeBusinessId, activeBranchId));
  }, [activeBusinessId, activeBranchId]);

  const activeBranchName = useMemo(() => {
    return branches.find(b => b.id === activeBranchId)?.name || 'Main Branch';
  }, [branches, activeBranchId]);

  const handleScanDetected = (rawCode: string, source: 'camera' | 'hid' | 'manual' = 'camera') => {
    const clean = (rawCode || '').trim();
    if (!clean) return;

    const match = lookupProductByScannedCode(clean, products, activeBranchId);
    setLastMatch(match);

    if (match.variant) {
      setSelectedVariantId(match.variant.id);
    } else if (match.product?.hasVariants && match.product.variants?.length) {
      const firstActive = match.product.variants.find(v => v.status !== 'inactive');
      setSelectedVariantId(firstActive?.id || '');
    } else {
      setSelectedVariantId('');
    }

    const prefs = getScannerHidPreferences();
    if (prefs.beepOnScan) {
      playScanBeep(match.found ? 'success' : 'error');
    }

    const entry: RecentScanEntry = {
      id: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      code: clean,
      scannedAt: new Date().toISOString(),
      source,
      mode: scanMode,
      found: match.found,
      productId: match.product?.id,
      productName: match.product?.name,
      variantId: match.variant?.id,
      sku: match.variant?.sku || match.product?.code,
      variantLabel: match.variant
        ? [match.variant.color, match.variant.size].filter(Boolean).join(' / ')
        : undefined,
      stockAtScan: match.variant ? match.variant.stock : match.product?.currentStock,
      salePrice: match.variant?.salePrice ?? match.product?.salePrice,
    };
    setRecentScans(saveRecentScan(entry, activeBusinessId, activeBranchId));
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualQuery.trim()) return;
    handleScanDetected(manualQuery, 'manual');
    setManualQuery('');
  };

  const handleClearResult = () => {
    setLastMatch(null);
    setSelectedVariantId('');
  };

  const handleClearRecent = () => {
    clearRecentScans(activeBusinessId, activeBranchId);
    setRecentScans([]);
  };

  const matchedProduct = lastMatch?.product;
  const activeVariant: ProductVariant | undefined = useMemo(() => {
    if (!matchedProduct) return undefined;
    if (lastMatch?.variant && (!selectedVariantId || selectedVariantId === lastMatch.variant.id)) {
      return lastMatch.variant;
    }
    if (selectedVariantId && Array.isArray(matchedProduct.variants)) {
      return matchedProduct.variants.find(v => v.id === selectedVariantId);
    }
    return lastMatch?.variant;
  }, [matchedProduct, lastMatch, selectedVariantId]);

  const activeBarcode =
    activeVariant?.barcode ||
    matchedProduct?.barcode ||
    activeVariant?.sku ||
    matchedProduct?.code ||
    '';
  const activeSku = activeVariant?.sku || matchedProduct?.code || '';
  const activePrice =
    activeVariant?.salePrice !== undefined
      ? activeVariant.salePrice
      : activeVariant?.additionalPrice && matchedProduct
      ? matchedProduct.salePrice + activeVariant.additionalPrice
      : matchedProduct?.salePrice ?? 0;
  const activeCost =
    activeVariant?.purchasePrice !== undefined
      ? activeVariant.purchasePrice
      : matchedProduct?.purchasePrice ?? 0;
  const activeStock = activeVariant ? activeVariant.stock : matchedProduct?.currentStock ?? 0;
  const activeMinAlert = activeVariant?.minStockAlert ?? matchedProduct?.minStockAlert ?? 5;

  const isOutOfStock = activeStock <= 0;
  const isLowStock = activeStock > 0 && activeStock <= activeMinAlert;

  const handleAddScannedToPos = () => {
    if (!matchedProduct || !canCreatePos || isOutOfStock) return;
    setPendingPosSelection({
      productId: matchedProduct.id,
      variantId: activeVariant?.id,
      colorId: activeVariant?.colorId,
    });
    onNavigateTab('pos');
  };

  const handlePrintScannedLabel = () => {
    if (!matchedProduct || !canPrintLabel) return;
    setPendingLabelSelection({
      productId: matchedProduct.id,
      variantId: activeVariant?.id,
    });
    onNavigateTab('barcodes');
  };

  const handleOpenProduct = () => {
    if (!matchedProduct) return;
    if (canEditProduct) {
      setPendingEditProductId(matchedProduct.id);
      onNavigateTab('products');
    } else {
      setDetailModalProduct(matchedProduct);
    }
  };

  const handleAddNewWithBarcode = () => {
    if (!lastMatch || !canCreateProduct) return;
    setPendingNewProductBarcode(lastMatch.normalizedCode || lastMatch.rawCode);
    onNavigateTab('products');
  };

  const modeTabs: {
    id: ScannerWorkspaceMode;
    label: string;
    icon: React.FC<{ className?: string }>;
    visible: boolean;
  }[] = [
    { id: 'lookup', label: 'Product Lookup', icon: Search, visible: true },
    { id: 'pos', label: 'Add to Sales', icon: ShoppingCart, visible: canCreatePos },
    { id: 'stock_check', label: 'Check Stock', icon: Boxes, visible: true },
    { id: 'label', label: 'Print Label', icon: Printer, visible: canPrintLabel },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white dark:bg-[#101B35] rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-[#1F3158] shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-[#087F8C]/15 text-[#087F8C] dark:text-[#FF9D32] shrink-0">
            <ScanLine className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold text-[#172033] dark:text-white tracking-tight">
                Barcode &amp; QR Code Scanner
              </h1>
              <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#162344] border border-slate-200 dark:border-[#1F3158] text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Branch: {activeBranchName}
              </span>
            </div>
            <p className="text-xs text-[#64748B] dark:text-slate-400 mt-1">
              Scan EAN-13, Code 128, UPC, or QR labels via mobile camera or USB/Bluetooth HID scanner.
            </p>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex flex-wrap gap-1.5">
          {modeTabs
            .filter(t => t.visible)
            .map(tab => {
              const Icon = tab.icon;
              const active = scanMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setScanMode(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-xs font-bold border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#087F8C] text-white border-[#087F8C] shadow-xs'
                      : 'bg-slate-50 dark:bg-[#0E182E] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-[#1F3158] hover:bg-slate-100 dark:hover:bg-[#162344]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
        </div>
      </div>

      {/* Main Responsive Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Scanner Input & Quick Search */}
        <div className="lg:col-span-6 space-y-5">
          <div className="bg-white dark:bg-[#101B35] rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-[#1F3158] shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-[#0B1428] border border-slate-200 dark:border-[#1F3158]">
                <button
                  type="button"
                  onClick={() => setInputChannel('camera')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    inputChannel === 'camera'
                      ? 'bg-white dark:bg-[#162344] text-[#087F8C] dark:text-[#FF9D32] shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Camera Scan</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputChannel('hid')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    inputChannel === 'hid'
                      ? 'bg-white dark:bg-[#162344] text-[#087F8C] dark:text-[#FF9D32] shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Usb className="w-3.5 h-3.5" />
                  <span>USB / Bluetooth HID</span>
                </button>
              </div>

              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {scanMode === 'pos'
                  ? 'Mode: Add to Sales'
                  : scanMode === 'stock_check'
                  ? 'Mode: Read-Only Stock Check'
                  : scanMode === 'label'
                  ? 'Mode: Print Tag'
                  : 'Mode: Product Lookup'}
              </span>
            </div>

            {inputChannel === 'camera' ? (
              <CameraBarcodeScanner
                active={inputChannel === 'camera'}
                autoStart={false}
                showManualFallback={false}
                onScan={code => handleScanDetected(code, 'camera')}
              />
            ) : (
              <HardwareScannerInput
                autoFocus={true}
                onScan={(code, src) => handleScanDetected(code, src)}
                label="USB / Bluetooth HID Keyboard-Wedge Input"
              />
            )}

            {/* Always-available Manual Search Box */}
            <form onSubmit={handleManualSubmit} className="pt-3 border-t border-slate-100 dark:border-[#1F3158] flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={manualQuery}
                  onChange={e => setManualQuery(e.target.value)}
                  placeholder="Type barcode, SKU, or PROTIVA QR payload..."
                  aria-label="Manual barcode or SKU lookup"
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-[10px] border border-slate-200 dark:border-[#1F3158] bg-slate-50 dark:bg-[#0E182E] text-slate-900 dark:text-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#087F8C]/20 focus:border-[#087F8C]"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-[10px] bg-[#101B3F] hover:bg-[#1C2E63] text-white text-xs font-bold cursor-pointer shrink-0"
              >
                Lookup
              </button>
            </form>
          </div>

          {/* Recent Scans History */}
          <div className="bg-white dark:bg-[#101B35] rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-[#1F3158] shadow-xs space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-[#1F3158]">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-[#087F8C]" />
                <span>Recent Scans ({recentScans.length})</span>
              </h2>
              {recentScans.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearRecent}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear History</span>
                </button>
              )}
            </div>

            {recentScans.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                No recent scans yet in {activeBranchName}. Scan any barcode or QR tag to start.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-[#1F3158] max-h-64 overflow-y-auto">
                {recentScans.slice(0, 12).map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleScanDetected(item.code, 'manual')}
                    className="w-full py-2 px-1.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-[#162344]/60 rounded-lg transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {item.found ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        )}
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {item.productName || 'Unknown Barcode'}
                        </span>
                        {item.variantLabel && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#162344] text-slate-600 dark:text-slate-300 shrink-0">
                            {item.variantLabel}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate pl-5">
                        {item.code}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {new Date(item.scannedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Scanned Product Result & Action Workspace */}
        <div className="lg:col-span-6">
          {!lastMatch ? (
            <div className="bg-white dark:bg-[#101B35] rounded-2xl p-8 border border-slate-200 dark:border-[#1F3158] shadow-xs flex flex-col items-center justify-center text-center min-h-[340px]">
              <div className="w-14 h-14 rounded-2xl bg-[#087F8C]/10 text-[#087F8C] flex items-center justify-center mb-3">
                <ScanLine className="w-7 h-7" />
              </div>
              <h2 className="text-base font-bold text-[#172033] dark:text-white">
                Ready to Scan Product
              </h2>
              <p className="text-xs text-[#64748B] dark:text-slate-400 max-w-sm mt-1.5 leading-relaxed">
                Start the mobile camera, scan with a USB/Bluetooth barcode reader, or type a code on the left to inspect product details, check stock, add to POS invoice, or print tags.
              </p>
            </div>
          ) : !lastMatch.found || !matchedProduct ? (
            <div className="bg-white dark:bg-[#101B35] rounded-2xl p-6 border border-amber-300 dark:border-amber-500/40 shadow-xs space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      Product Not Found
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      No active product or variant in <strong>{activeBranchName}</strong> matched scanned code:
                    </p>
                    <p className="mt-2 inline-block px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#0E182E] border border-slate-200 dark:border-[#1F3158] font-mono text-xs font-bold text-slate-900 dark:text-white break-all">
                      {lastMatch.rawCode}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClearResult}
                  aria-label="Clear scan result"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-[#162344] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-[#1F3158] flex flex-wrap items-center gap-2">
                {canCreateProduct ? (
                  <button
                    type="button"
                    onClick={handleAddNewWithBarcode}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-[#087F8C] hover:bg-[#066974] text-white text-xs font-bold cursor-pointer"
                  >
                    <PackagePlus className="w-4 h-4" />
                    <span>Add New Product with This Barcode</span>
                  </button>
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Ask a store manager or inventory admin to register this barcode.
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleClearResult}
                  className="px-3.5 py-2 rounded-[10px] border border-slate-200 dark:border-[#1F3158] bg-slate-50 dark:bg-[#0E182E] text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-[#101B35] rounded-2xl p-5 border border-slate-200 dark:border-[#1F3158] shadow-xs space-y-4">
              {/* Top Result Header */}
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-[#1F3158]">
                <div className="flex items-start gap-3 min-w-0">
                  <ProductThumbnail
                    src={resolveProductImage(matchedProduct, {
                      colorId: activeVariant?.colorId,
                      variantId: activeVariant?.id,
                      colorName: activeVariant?.color,
                    })}
                    alt={matchedProduct.name}
                    colorHex={
                      activeVariant?.color
                        ? inferColorHex(activeVariant.color, activeVariant.colorHex)
                        : undefined
                    }
                    colorName={activeVariant?.color}
                    size="lg"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
                        Matched ({lastMatch.matchType.replace('_', ' ')})
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        {matchedProduct.category}
                      </span>
                    </div>
                    <h2 className="text-base sm:text-lg font-bold text-[#172033] dark:text-white mt-1 leading-snug">
                      {matchedProduct.name}
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300 mt-1">
                      {matchedProduct.brand && <span>Brand: <strong>{matchedProduct.brand}</strong></span>}
                      <span className="font-mono">SKU: <strong>{activeSku}</strong></span>
                      {activeBarcode && (
                        <span className="font-mono">Barcode: <strong>{activeBarcode}</strong></span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleClearResult}
                    aria-label="Clear scan result"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-[#162344] cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="p-1.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white">
                    <QrCodeSvg
                      value={buildProductQrPayload(
                        matchedProduct.id,
                        activeVariant?.id,
                        activeBarcode
                      )}
                      size={68}
                    />
                  </div>
                </div>
              </div>

              {/* Variant Picker when product has variants */}
              {matchedProduct.hasVariants &&
                Array.isArray(matchedProduct.variants) &&
                matchedProduct.variants.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-[#087F8C]" />
                        <span>
                          {lastMatch.requiresVariantSelection && !activeVariant
                            ? 'Select Variant (Size / Color):'
                            : 'Selected Variant & Stock:'}
                        </span>
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Total All Variants: {matchedProduct.currentStock} {matchedProduct.unit}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto pr-0.5">
                      {matchedProduct.variants
                        .filter(v => v.status !== 'inactive')
                        .map(v => {
                          const isSelected = activeVariant?.id === v.id;
                          return (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => setSelectedVariantId(v.id)}
                              className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                                isSelected
                                  ? 'border-[#087F8C] bg-[#087F8C]/10 dark:bg-[#087F8C]/20 ring-1 ring-[#087F8C]'
                                  : 'border-slate-200 dark:border-[#1F3158] bg-slate-50 dark:bg-[#0E182E] hover:border-slate-300'
                              }`}
                            >
                              <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {[v.color, v.size].filter(Boolean).join(' / ') || 'Standard'}
                              </div>
                              <div className="flex items-center justify-between mt-1 text-[11px] font-mono-num">
                                <span className="text-slate-600 dark:text-slate-300">
                                  {formatCurrency(
                                    v.salePrice !== undefined ? v.salePrice : matchedProduct.salePrice,
                                    lang
                                  )}
                                </span>
                                <span
                                  className={`font-bold ${
                                    v.stock <= 0
                                      ? 'text-rose-600'
                                      : v.stock <= (v.minStockAlert || 5)
                                      ? 'text-amber-600'
                                      : 'text-emerald-600'
                                  }`}
                                >
                                  {v.stock} {matchedProduct.unit}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}

              {/* Metrics Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0E182E] border border-slate-200 dark:border-[#1F3158]">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    Retail Sale Price
                  </span>
                  <span className="text-lg font-extrabold font-mono-num text-[#172033] dark:text-white mt-0.5 block">
                    {formatCurrency(activePrice, lang)}
                  </span>
                  {matchedProduct.wholesalePrice !== undefined && (
                    <span className="text-[10px] text-slate-500 font-mono-num">
                      Wholesale: {formatCurrency(matchedProduct.wholesalePrice, lang)}
                    </span>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0E182E] border border-slate-200 dark:border-[#1F3158]">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    Current Stock ({activeBranchName})
                  </span>
                  <span
                    className={`text-lg font-extrabold font-mono-num mt-0.5 block ${
                      isOutOfStock
                        ? 'text-rose-600 dark:text-rose-400'
                        : isLowStock
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {activeStock} {matchedProduct.unit}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500">
                    {isOutOfStock
                      ? 'Out of stock'
                      : isLowStock
                      ? `Low stock (Alert ≤ ${activeMinAlert})`
                      : 'In stock & ready'}
                  </span>
                </div>

                {canViewCost && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0E182E] border border-slate-200 dark:border-[#1F3158] col-span-2 sm:col-span-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      Cost &amp; Min Safe Price
                    </span>
                    <span className="text-sm font-bold font-mono-num text-slate-800 dark:text-slate-200 mt-1 block">
                      Cost: {formatCurrency(activeCost, lang)}
                    </span>
                    {matchedProduct.minSalePrice !== undefined && (
                      <span className="text-[10px] text-rose-600 dark:text-rose-400 font-mono-num font-semibold">
                        Floor: {formatCurrency(matchedProduct.minSalePrice, lang)}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons (RBAC-Gated) */}
              <div className="pt-3 border-t border-slate-100 dark:border-[#1F3158] flex flex-wrap items-center gap-2">
                {canCreatePos && (
                  <button
                    type="button"
                    disabled={isOutOfStock}
                    onClick={handleAddScannedToPos}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-[#087F8C] hover:bg-[#066974] disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    <span>{isOutOfStock ? 'Out of Stock' : 'Add to Sales'}</span>
                  </button>
                )}

                {canPrintLabel && (
                  <button
                    type="button"
                    onClick={handlePrintScannedLabel}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold cursor-pointer"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>Print Label</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setScanMode('stock_check')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] border border-slate-200 dark:border-[#1F3158] bg-slate-50 dark:bg-[#0E182E] hover:bg-slate-100 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <Boxes className="w-3.5 h-3.5 text-[#087F8C]" />
                  <span>Check Stock</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenProduct}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#162344] hover:bg-slate-50 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Product</span>
                </button>

                <button
                  type="button"
                  onClick={handleClearResult}
                  className="ml-auto px-3 py-2 rounded-[10px] text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                >
                  Clear Scan Result
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Read-only Detail Modal for roles without product_management edit */}
      <ProductDetailGalleryModal
        product={detailModalProduct}
        showcaseMode={!canViewCost}
        canManagePhotos={false}
        onClose={() => setDetailModalProduct(null)}
        onManagePhotos={() => {}}
        onAddToPOS={
          canCreatePos
            ? (prod, variant, colorId) => {
                setPendingPosSelection({
                  productId: prod.id,
                  variantId: variant?.id,
                  colorId: colorId || variant?.colorId,
                });
                onNavigateTab('pos');
              }
            : undefined
        }
      />
    </div>
  );
};
