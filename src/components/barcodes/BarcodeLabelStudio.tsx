import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { getBusinessDisplayName } from '../../config/appIdentity';
import { LabelCodeFormat, LabelConfig, LabelTemplateId, PrinterSettings } from '../../types';
import { BarcodeSvg } from './BarcodeSvg';
import { QrCodeSvg } from './QrCodeSvg';
import { formatCurrency } from '../../utils/formatters';
import { buildProductQrPayload } from '../../utils/barcodeGenerator';
import {
  cancelActivePrintJob,
  getPrinterSettings,
  getShopLogo,
  previewProductLabelAsync,
  printProductLabel,
  PrintLabelItem,
  PrintPreviewPayload,
} from '../../utils/printEngine';
import { PrintPreviewModal } from '../printing/PrintPreviewModal';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { inferColorHex, resolveProductImage } from '../../utils/productImageResolver';
import {
  Printer,
  Barcode,
  Layers,
  Sliders,
  CheckSquare,
  Square,
  Sparkles,
  Tag,
  Eye,
  AlertTriangle,
  Loader2,
  X,
  RotateCcw,
} from 'lucide-react';

interface PrintItem {
  id: string;
  productId: string;
  variantId?: string;
  productName: string;
  variantDetails?: string;
  size?: string;
  color?: string;
  thumbnailUrl?: string;
  sku: string;
  barcode: string;
  price: number;
  stock: number;
  copies: number;
  selected: boolean;
}

interface LabelQueueRowProps {
  item: PrintItem;
  isChecked: boolean;
  copies: number;
  onToggle: (id: string, checked: boolean) => void;
  onChangeCopies: (id: string, nextCopies: number) => void;
}

const LabelQueueRow: React.FC<LabelQueueRowProps> = React.memo(
  ({ item, isChecked, copies, onToggle, onChangeCopies }) => {
    return (
      <tr
        className={`hover:bg-purple-50/30 transition-colors ${
          isChecked ? 'bg-white' : 'bg-slate-50/50 opacity-60'
        }`}
      >
        <td className="py-2.5 px-3 text-center">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={e => onToggle(item.id, e.target.checked)}
            className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
          />
        </td>
        <td className="py-2.5 px-3">
          <div className="flex items-center gap-2.5">
            <ProductThumbnail
              src={item.thumbnailUrl}
              alt={item.productName}
              colorHex={item.color ? inferColorHex(item.color) : undefined}
              colorName={item.color}
              size="xs"
            />
            <div>
              <div className="font-bold text-slate-900">{item.productName}</div>
              {item.variantDetails ? (
                <span className="inline-block mt-0.5 px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-medium text-[10px]">
                  {item.variantDetails}
                </span>
              ) : (
                <span className="text-[10px] text-slate-400">Standard Product</span>
              )}
            </div>
          </div>
        </td>
        <td className="py-2.5 px-3 font-mono">
          <div className="font-semibold text-slate-800">{item.sku}</div>
          <div className="text-[10px] text-slate-400">{item.barcode}</div>
        </td>
        <td className="py-2.5 px-3 font-bold text-slate-900 font-mono-num">
          {formatCurrency(item.price, 'en')}
        </td>
        <td className="py-2.5 px-3 font-mono text-slate-600">
          <span
            className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
              item.stock <= 0
                ? 'bg-rose-100 text-rose-700'
                : item.stock <= 5
                ? 'bg-amber-100 text-amber-700'
                : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            {item.stock} pcs
          </span>
        </td>
        <td className="py-2.5 px-3 text-center">
          <div className="inline-flex items-center border border-slate-300 rounded-lg overflow-hidden bg-white">
            <button
              type="button"
              onClick={() => onChangeCopies(item.id, Math.max(1, copies - 1))}
              className="px-2 py-1 hover:bg-slate-100 text-slate-600 font-bold cursor-pointer"
            >
              -
            </button>
            <input
              type="number"
              min="1"
              max="500"
              value={copies}
              onChange={e => onChangeCopies(item.id, Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-12 text-center text-xs font-bold border-x border-slate-300 py-1"
            />
            <button
              type="button"
              onClick={() => onChangeCopies(item.id, copies + 1)}
              className="px-2 py-1 hover:bg-slate-100 text-slate-600 font-bold cursor-pointer"
            >
              +
            </button>
          </div>
        </td>
      </tr>
    );
  }
);

LabelQueueRow.displayName = 'LabelQueueRow';

export const BarcodeLabelStudio: React.FC = () => {
  const { products, settings, pendingLabelSelection, setPendingLabelSelection } = useApp();
  const savedPrinter = useMemo(() => getPrinterSettings(settings), [settings]);
  const shopLogo = getShopLogo(settings);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Label Configuration
  const [config, setConfig] = useState<LabelConfig>(() => ({
    template: savedPrinter.labelTemplate || '40x30',
    customWidthMm: savedPrinter.labelWidthMm || 40,
    customHeightMm: savedPrinter.labelHeightMm || 30,
    showShopName: true,
    showShopLogo: Boolean(shopLogo),
    showProductName: true,
    showVariantDetails: true,
    showPrice: true,
    showSku: true,
    showBarcodeNumber: true,
    barcodeFormat: 'CODE128',
    showQrCode: false,
    qrContentMode: 'product_ref',
    copiesPerItem: 1,
    customFooterText: '',
  }));

  // Studio-level print spacing adjustments (defaults from Admin PrinterSettings)
  const [layoutOverrides, setLayoutOverrides] = useState<Partial<PrinterSettings>>({
    labelMarginMm: savedPrinter.labelMarginMm,
    labelsPerRow: savedPrinter.labelsPerRow,
    labelGapXMm: savedPrinter.labelGapXMm,
    labelGapYMm: savedPrinter.labelGapYMm,
    barcodeHeightPx: savedPrinter.barcodeHeightPx,
  });

  // Preview & Print async job states
  const [isPrinting, setIsPrinting] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [previewProgress, setPreviewProgress] = useState<{ done: number; total: number } | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<PrintPreviewPayload | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [lastFailedAction, setLastFailedAction] = useState<'preview' | 'print' | null>(null);

  const previewAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      previewAbortRef.current?.abort();
      cancelActivePrintJob();
    };
  }, []);

  // Flattened selectable items (Products & Variants)
  const allPrintItems: PrintItem[] = useMemo(() => {
    const list: PrintItem[] = [];

    products.forEach(p => {
      if (p.hasVariants && p.variants && p.variants.length > 0) {
        p.variants.forEach(v => {
          const variantLabel = [v.color, v.size].filter(Boolean).join(' / ');
          list.push({
            id: v.id,
            productId: p.id,
            variantId: v.id,
            productName: p.name,
            variantDetails: variantLabel,
            size: v.size,
            color: v.color,
            thumbnailUrl: resolveProductImage(p, {
              colorId: v.colorId,
              variantId: v.id,
              colorName: v.color,
            }),
            sku: v.sku || `${p.code}-${v.id}`,
            barcode: v.barcode || p.barcode || v.sku || p.code,
            price: v.salePrice !== undefined ? v.salePrice : p.salePrice,
            stock: v.stock,
            copies: 1,
            selected: true,
          });
        });
      } else {
        list.push({
          id: p.id,
          productId: p.id,
          productName: p.name,
          variantDetails: p.size || p.color ? [p.color, p.size].filter(Boolean).join(' / ') : undefined,
          size: p.size,
          color: p.color,
          thumbnailUrl: resolveProductImage(p, { colorName: p.color }),
          sku: p.code,
          barcode: p.barcode || p.code,
          price: p.salePrice,
          stock: p.currentStock,
          copies: 1,
          selected: true,
        });
      }
    });

    return list;
  }, [products]);

  const [itemCopies, setItemCopies] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  React.useEffect(() => {
    setItemCopies(prev => {
      let changed = false;
      const next: Record<string, number> = { ...prev };
      allPrintItems.forEach(item => {
        if (next[item.id] === undefined) {
          next[item.id] = Math.max(1, Math.min(item.stock || 1, 5));
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setSelectedIds(prev => {
      let changed = false;
      const next: Record<string, boolean> = { ...prev };
      allPrintItems.forEach(item => {
        if (next[item.id] === undefined) {
          next[item.id] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [allPrintItems]);

  useEffect(() => {
    if (!pendingLabelSelection) return;
    const { productId, variantId } = pendingLabelSelection;
    const targetProduct = products.find(p => p.id === productId);
    setPendingLabelSelection(null);
    if (!targetProduct) return;

    setSelectedCategory('all');
    setSearchQuery(targetProduct.code || targetProduct.name);

    const matchingIds = new Set(
      allPrintItems
        .filter(item =>
          variantId ? item.id === variantId : item.productId === productId
        )
        .map(item => item.id)
    );

    if (matchingIds.size > 0) {
      setSelectedIds(() => {
        const next: Record<string, boolean> = {};
        allPrintItems.forEach(item => {
          next[item.id] = matchingIds.has(item.id);
        });
        return next;
      });
      setItemCopies(prev => {
        const next = { ...prev };
        matchingIds.forEach(id => {
          if (!next[id] || next[id] < 1) next[id] = 1;
        });
        return next;
      });
    }
  }, [pendingLabelSelection, setPendingLabelSelection, products, allPrintItems]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => p.category && set.add(p.category));
    return ['all', ...Array.from(set)];
  }, [products]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allPrintItems.filter(item => {
      const matchCat =
        selectedCategory === 'all' ||
        products.find(p => p.id === item.productId)?.category === selectedCategory;
      const matchSearch =
        !q ||
        item.productName.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.barcode.includes(q) ||
        (item.variantDetails && item.variantDetails.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [allPrintItems, searchQuery, selectedCategory, products]);

  const queuedPrintItems: PrintLabelItem[] = useMemo(() => {
    return filteredItems
      .filter(item => selectedIds[item.id])
      .map(item => ({
        productId: item.productId,
        variantId: item.variantId,
        productName: item.productName,
        variantDetails: item.variantDetails,
        sku: item.sku,
        barcode: item.barcode || item.sku,
        price: item.price,
        copies: Math.max(1, itemCopies[item.id] || 1),
      }));
  }, [filteredItems, selectedIds, itemCopies]);

  const totalLabelsQueued = useMemo(() => {
    return queuedPrintItems.reduce((sum, item) => sum + item.copies, 0);
  }, [queuedPrintItems]);

  const handleToggleItem = useCallback((id: string, checked: boolean) => {
    setSelectedIds(prev => (prev[id] === checked ? prev : { ...prev, [id]: checked }));
  }, []);

  const handleChangeCopies = useCallback((id: string, nextCopies: number) => {
    const safeCopies = Math.max(1, Math.min(500, nextCopies));
    setItemCopies(prev => (prev[id] === safeCopies ? prev : { ...prev, [id]: safeCopies }));
  }, []);

  const handleSelectAll = useCallback(
    (select: boolean) => {
      setSelectedIds(prev => {
        const updated: Record<string, boolean> = { ...prev };
        filteredItems.forEach(item => {
          updated[item.id] = select;
        });
        return updated;
      });
    },
    [filteredItems]
  );

  const handleMatchStock = useCallback(() => {
    setItemCopies(prev => {
      const updatedCopies: Record<string, number> = { ...prev };
      filteredItems.forEach(item => {
        updatedCopies[item.id] = Math.max(1, item.stock);
      });
      return updatedCopies;
    });
  }, [filteredItems]);

  const dimensions = useMemo(() => {
    switch (config.template) {
      case '30x20':
        return { widthMm: 30, heightMm: 20, widthPx: 148, heightPx: 98 };
      case '40x30':
        return { widthMm: 40, heightMm: 30, widthPx: 188, heightPx: 140 };
      case '50x25':
        return { widthMm: 50, heightMm: 25, widthPx: 224, heightPx: 116 };
      case '50x30':
        return { widthMm: 50, heightMm: 30, widthPx: 224, heightPx: 140 };
      case 'a4_sheet':
        return {
          widthMm: config.customWidthMm || 62,
          heightMm: config.customHeightMm || 34,
          widthPx: 240,
          heightPx: 132,
          isA4: true,
        };
      case 'custom':
      default:
        return {
          widthMm: config.customWidthMm || 40,
          heightMm: config.customHeightMm || 30,
          widthPx: Math.round((config.customWidthMm || 40) * 4.5),
          heightPx: Math.round((config.customHeightMm || 30) * 4.5),
        };
    }
  }, [config.template, config.customWidthMm, config.customHeightMm]);

  const previewPriceClass = useMemo(() => {
    const isCompact = dimensions.heightMm <= 22 || dimensions.widthMm <= 34;
    if (isCompact) {
      if (savedPrinter.labelFontSize === 'small') return 'text-[13px]';
      if (savedPrinter.labelFontSize === 'large') return 'text-[15px]';
      return 'text-[14px]';
    }
    if (savedPrinter.labelFontSize === 'small') return 'text-[18px]';
    if (savedPrinter.labelFontSize === 'large') return 'text-[20px]';
    return 'text-[19px]';
  }, [dimensions.heightMm, dimensions.widthMm, savedPrinter.labelFontSize]);

  const effectiveSettings = useMemo(() => {
    return {
      ...settings,
      printerSettings: {
        ...savedPrinter,
        ...layoutOverrides,
      },
    };
  }, [settings, savedPrinter, layoutOverrides]);

  const handleCancelPreview = useCallback(() => {
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
      previewAbortRef.current = null;
    }
    setIsGeneratingPreview(false);
    setPreviewProgress(null);
  }, []);

  const handlePreviewSheet = useCallback(async () => {
    setJobError(null);
    setLastFailedAction(null);

    if (queuedPrintItems.length === 0) {
      setJobError('Please select at least one item to preview labels.');
      setLastFailedAction('preview');
      return;
    }

    // Cancel any previous unfinished preview job cleanly so rapid/repeated clicks never collide
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
    }
    const controller = new AbortController();
    previewAbortRef.current = controller;

    setIsGeneratingPreview(true);
    setPreviewProgress({ done: 0, total: totalLabelsQueued });
    setPreviewModalOpen(true);

    try {
      const payload = await previewProductLabelAsync(queuedPrintItems, config, effectiveSettings, {
        signal: controller.signal,
        onProgress: (done, total) => {
          if (!controller.signal.aborted) {
            setPreviewProgress({ done, total });
          }
        },
      });
      if (!controller.signal.aborted) {
        setPreviewPayload(payload);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return;
      }
      setJobError(err?.message || 'Failed to generate label preview.');
      setLastFailedAction('preview');
    } finally {
      if (previewAbortRef.current === controller) {
        previewAbortRef.current = null;
      }
      setIsGeneratingPreview(false);
      setPreviewProgress(null);
    }
  }, [queuedPrintItems, totalLabelsQueued, config, effectiveSettings]);

  const handlePrint = useCallback(() => {
    if (isPrinting) return;
    setJobError(null);
    setLastFailedAction(null);

    if (queuedPrintItems.length === 0) {
      setJobError('Please select at least one item to print labels.');
      setLastFailedAction('print');
      return;
    }

    setIsPrinting(true);
    try {
      const res = printProductLabel(queuedPrintItems, config, effectiveSettings);
      if (!res.opened && !res.cancelled) {
        setJobError(res.error || 'Unable to open browser print dialog.');
        setLastFailedAction('print');
      }
    } catch (err: any) {
      setJobError(err?.message || 'Unexpected error while preparing print job.');
      setLastFailedAction('print');
    } finally {
      setIsPrinting(false);
    }
  }, [isPrinting, queuedPrintItems, config, effectiveSettings]);

  const previewItem = useMemo(
    () => filteredItems.find(i => selectedIds[i.id]) || filteredItems[0],
    [filteredItems, selectedIds]
  );

  const handleTestPrint = useCallback(() => {
    if (isPrinting) return;
    setJobError(null);
    setLastFailedAction(null);

    const target = queuedPrintItems[0] || (previewItem
      ? {
          productId: previewItem.productId,
          variantId: previewItem.variantId,
          productName: previewItem.productName,
          variantDetails: previewItem.variantDetails,
          sku: previewItem.sku,
          barcode: previewItem.barcode || previewItem.sku,
          price: previewItem.price,
          copies: 1,
        }
      : null);

    if (!target) {
      setJobError('Select at least one product to run a 1-label test print.');
      setLastFailedAction('print');
      return;
    }

    setIsPrinting(true);
    try {
      const res = printProductLabel([{ ...target, copies: 1 }], config, effectiveSettings);
      if (!res.opened && !res.cancelled) {
        setJobError(res.error || 'Unable to open browser print dialog.');
        setLastFailedAction('print');
      }
    } catch (err: any) {
      setJobError(err?.message || 'Unexpected error while preparing test print.');
      setLastFailedAction('print');
    } finally {
      setIsPrinting(false);
    }
  }, [isPrinting, queuedPrintItems, previewItem, config, effectiveSettings]);

  const previewQrPayload = useMemo(() => {
    if (!previewItem) return '';
    const code = previewItem.barcode || previewItem.sku;
    return config.qrContentMode === 'barcode'
      ? code
      : buildProductQrPayload(previewItem.productId, previewItem.variantId, code);
  }, [previewItem, config.qrContentMode]);

  return (
    <>
      <div className="space-y-6">
        {/* Screen Header */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-purple-50 text-purple-700">
                <Barcode className="w-5 h-5" />
              </span>
              <h1 className="text-xl font-bold text-slate-900">Barcode &amp; QR Label Studio</h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Print Code 128, EAN-13, QR, or combined Barcode + QR labels on thermal rolls or A4 sheets via your browser print dialog.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="text-right mr-1">
              <span className="text-xs text-slate-500 block">Total Labels Queued</span>
              <span className="text-lg font-bold text-emerald-700 font-mono-num">
                {totalLabelsQueued} pcs
              </span>
            </div>

            {isGeneratingPreview ? (
              <button
                type="button"
                onClick={handleCancelPreview}
                className="flex items-center gap-2 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span>Cancel Preview</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePreviewSheet}
                disabled={totalLabelsQueued === 0}
                className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 disabled:opacity-50 text-slate-800 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                <span>Preview Sheet</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleTestPrint}
              disabled={!previewItem || isPrinting}
              title="Open browser print dialog for 1 test label to verify thermal or A4 alignment"
              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-slate-50 border border-purple-300 disabled:opacity-50 text-purple-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Test Print (1)</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={totalLabelsQueued === 0 || isPrinting}
              className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              {isPrinting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Printer className="w-4 h-4" />
              )}
              <span>{isPrinting ? 'Opening Print...' : 'Print Labels Now'}</span>
            </button>
          </div>
        </div>

        {jobError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-xl text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{jobError}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {lastFailedAction && (
                <button
                  type="button"
                  onClick={lastFailedAction === 'preview' ? handlePreviewSheet : handlePrint}
                  className="flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Retry</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setJobError(null);
                  setLastFailedAction(null);
                }}
                className="font-bold text-rose-600 hover:text-rose-800 px-2 py-1 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Main Studio Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Template & Appearance Configuration */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-5">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2 pb-3 border-b">
                <Sliders className="w-4 h-4 text-purple-600" />
                <span>Label Format &amp; Paper Size</span>
              </h2>

              {/* Template Selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700">Label Dimensions</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: '30x20', label: '30 × 20 mm', desc: 'Compact collar tag' },
                    { id: '40x30', label: '40 × 30 mm', desc: 'Standard apparel' },
                    { id: '50x25', label: '50 × 25 mm', desc: 'Wide slim sticker' },
                    { id: '50x30', label: '50 × 30 mm', desc: 'Branded price tag' },
                    { id: 'a4_sheet', label: 'A4 Label Sheet', desc: 'Multi-column sheet' },
                    { id: 'custom', label: 'Custom Size', desc: 'Enter exact mm' },
                  ].map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setConfig(prev => ({ ...prev, template: t.id as LabelTemplateId }))}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        config.template === t.id
                          ? 'border-purple-600 bg-purple-50 text-purple-900 ring-2 ring-purple-600/20'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{t.label}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Barcode & QR Standard Selector */}
              <div className="space-y-2.5 pt-2 border-t">
                <label className="text-xs font-semibold text-slate-700">Code Format</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['CODE128', 'EAN13', 'QR'] as LabelCodeFormat[]).map(fmt => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setConfig(prev => ({ ...prev, barcodeFormat: fmt }))}
                      className={`py-2 px-2 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                        config.barcodeFormat === fmt
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {fmt === 'CODE128' ? 'Code 128' : fmt === 'EAN13' ? 'EAN-13' : 'QR Code'}
                    </button>
                  ))}
                </div>

                {config.barcodeFormat !== 'QR' && (
                  <label className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer text-xs text-slate-700">
                    <span className="font-medium">Include QR Code beside Barcode</span>
                    <input
                      type="checkbox"
                      checked={Boolean(config.showQrCode)}
                      onChange={e => setConfig(prev => ({ ...prev, showQrCode: e.target.checked }))}
                      className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
                    />
                  </label>
                )}

                {(config.barcodeFormat === 'QR' || config.showQrCode) && (
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-600">QR Code Payload</label>
                    <select
                      value={config.qrContentMode || 'product_ref'}
                      onChange={e =>
                        setConfig(prev => ({
                          ...prev,
                          qrContentMode: e.target.value as 'product_ref' | 'barcode',
                        }))
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                    >
                      <option value="product_ref">PROTIVA Product/Variant Reference (Recommended)</option>
                      <option value="barcode">Barcode Value Only</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Custom Dimensions or A4 Grid Settings */}
              {(config.template === 'custom' || config.template === 'a4_sheet') && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600">Label Width (mm)</label>
                    <input
                      type="number"
                      min="20"
                      max="120"
                      value={config.customWidthMm || (config.template === 'a4_sheet' ? 62 : 40)}
                      onChange={e =>
                        setConfig(prev => ({ ...prev, customWidthMm: Number(e.target.value) || 40 }))
                      }
                      className="w-full mt-1 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600">Label Height (mm)</label>
                    <input
                      type="number"
                      min="15"
                      max="120"
                      value={config.customHeightMm || (config.template === 'a4_sheet' ? 34 : 30)}
                      onChange={e =>
                        setConfig(prev => ({ ...prev, customHeightMm: Number(e.target.value) || 30 }))
                      }
                      className="w-full mt-1 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono-num"
                    />
                  </div>

                  {config.template === 'a4_sheet' && (
                    <>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600">Labels / Row</label>
                        <input
                          type="number"
                          min="1"
                          max="6"
                          value={layoutOverrides.labelsPerRow || 3}
                          onChange={e =>
                            setLayoutOverrides(prev => ({
                              ...prev,
                              labelsPerRow: Math.max(1, Math.min(6, Number(e.target.value) || 3)),
                            }))
                          }
                          className="w-full mt-1 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono-num"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600">Gap X / Y (mm)</label>
                        <div className="flex gap-1 mt-1">
                          <input
                            type="number"
                            min="0"
                            max="15"
                            value={layoutOverrides.labelGapXMm ?? 3}
                            onChange={e =>
                              setLayoutOverrides(prev => ({
                                ...prev,
                                labelGapXMm: Number(e.target.value) || 0,
                              }))
                            }
                            className="w-1/2 px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono-num"
                            title="Horizontal gap (mm)"
                          />
                          <input
                            type="number"
                            min="0"
                            max="15"
                            value={layoutOverrides.labelGapYMm ?? 3}
                            onChange={e =>
                              setLayoutOverrides(prev => ({
                                ...prev,
                                labelGapYMm: Number(e.target.value) || 0,
                              }))
                            }
                            className="w-1/2 px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono-num"
                            title="Vertical gap (mm)"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Content Toggles */}
              <div className="space-y-3 pt-3 border-t">
                <label className="text-xs font-semibold text-slate-700">Display Fields on Label</label>

                <div className="space-y-1.5">
                  {[
                    { key: 'showShopName', label: 'Shop Name / Brand Header' },
                    { key: 'showShopLogo', label: 'Shop Logo (if uploaded)' },
                    { key: 'showProductName', label: 'Product Name' },
                    { key: 'showVariantDetails', label: 'Size & Color Badge' },
                    { key: 'showPrice', label: 'Retail Price' },
                    { key: 'showSku', label: 'SKU Code' },
                    { key: 'showBarcodeNumber', label: 'Human-Readable Number' },
                  ].map(opt => (
                    <label
                      key={opt.key}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 cursor-pointer text-xs text-slate-700"
                    >
                      <span>{opt.label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean((config as any)[opt.key])}
                        onChange={e =>
                          setConfig(prev => ({ ...prev, [opt.key]: e.target.checked }))
                        }
                        className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Footer Policy text */}
              <div className="pt-3 border-t space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Footer Tagline / Return Policy</label>
                <input
                  type="text"
                  value={config.customFooterText || ''}
                  onChange={e =>
                    setConfig(prev => ({ ...prev, customFooterText: e.target.value }))
                  }
                  placeholder="e.g. No exchange without tag"
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Live Preview Box */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-purple-600" />
                  <span>Single Label Preview</span>
                </h3>
                <span className="text-[10px] font-mono text-slate-500">{config.barcodeFormat}</span>
              </div>

              <div className="p-4 bg-slate-100 rounded-xl flex items-center justify-center border border-slate-200 overflow-hidden">
                {previewItem ? (
                  <div
                    style={{
                      width: `${dimensions.widthPx}px`,
                      minHeight: `${dimensions.heightPx}px`,
                    }}
                    className="print-paper-white bg-white border-2 border-dashed border-slate-400 p-2 rounded-sm flex flex-col justify-between items-center text-center shadow-md select-none transition-all overflow-hidden"
                  >
                    {config.showShopName && (
                      <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-900 leading-tight max-w-full truncate">
                        {config.showShopLogo && shopLogo && (
                          <img src={shopLogo} alt="" className="h-3 max-w-[20px] object-contain" />
                        )}
                        <span className="truncate">{getBusinessDisplayName(settings)}</span>
                      </div>
                    )}

                    {config.showProductName && (
                      <div className="text-[11px] font-bold text-slate-800 line-clamp-1 mt-0.5 max-w-full">
                        {previewItem.productName}
                      </div>
                    )}

                    {config.showVariantDetails && previewItem.variantDetails && (
                      <div className="inline-block mt-0.5 px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[9px] font-bold font-mono text-slate-700 max-w-full truncate">
                        {previewItem.variantDetails}
                      </div>
                    )}

                    {/* Vector Barcode / QR */}
                    <div className="my-1 w-full flex items-center justify-center gap-1.5 overflow-hidden">
                      {config.barcodeFormat === 'QR' ? (
                        <BarcodeSvg
                          value={previewItem.barcode || previewItem.sku}
                          qrValue={previewQrPayload}
                          width={dimensions.widthPx - 24}
                          height={dimensions.heightPx > 110 ? 44 : 32}
                          showText={config.showBarcodeNumber}
                          format="QR"
                        />
                      ) : config.showQrCode ? (
                        <>
                          <div className="flex-1 min-w-0 flex justify-center overflow-hidden">
                            <BarcodeSvg
                              value={previewItem.barcode || previewItem.sku}
                              width={Math.max(96, dimensions.widthPx - 68)}
                              height={dimensions.heightPx > 110 ? 32 : 22}
                              showText={config.showBarcodeNumber}
                              format={config.barcodeFormat}
                            />
                          </div>
                          <QrCodeSvg
                            value={previewQrPayload}
                            size={dimensions.heightPx > 110 ? 40 : 30}
                            className="shrink-0"
                          />
                        </>
                      ) : (
                        <BarcodeSvg
                          value={previewItem.barcode || previewItem.sku}
                          width={dimensions.widthPx - 24}
                          height={dimensions.heightPx > 110 ? 34 : 24}
                          showText={config.showBarcodeNumber}
                          format={config.barcodeFormat}
                        />
                      )}
                    </div>

                    <div className="w-full flex items-end justify-between font-mono px-1 gap-1.5 shrink-0 pt-0.5">
                      {config.showSku ? (
                        <span className="text-slate-500 text-[9px] truncate min-w-0 flex-1 text-left leading-tight">
                          {previewItem.sku}
                        </span>
                      ) : (
                        <span />
                      )}
                      {config.showPrice && (
                        <span
                          className={`${previewPriceClass} font-black text-black leading-[0.95] tracking-[-0.02em] shrink-0 text-right whitespace-nowrap`}
                        >
                          {formatCurrency(previewItem.price, 'en')}
                        </span>
                      )}
                    </div>

                    {config.customFooterText && (
                      <div className="text-[7px] text-slate-400 tracking-tighter mt-0.5 leading-none truncate max-w-full">
                        {config.customFooterText}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 py-6">No item selected for preview</div>
                )}
              </div>

              <p className="text-[11px] text-slate-500 text-center">
                Target Print Size: {dimensions.widthMm}mm × {dimensions.heightMm}mm
              </p>
            </div>
          </div>

          {/* Right: Product & Variant Queue Selection */}
          <div className="lg:col-span-8 space-y-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-600" />
                    <span>Select Items &amp; Print Quantities</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Check items to print and set label count for each clothing size &amp; color.
                  </p>
                </div>

                {/* Bulk Quick Actions */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectAll(true)}
                    className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckSquare className="w-3.5 h-3.5 text-purple-600" />
                    <span>Select All</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAll(false)}
                    className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 text-slate-400" />
                    <span>Clear</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleMatchStock}
                    className="px-2.5 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
                    title="Set label quantity equal to each variant's current stock"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Match Stock Qty</span>
                  </button>
                </div>
              </div>

              {/* Filter toolbar */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-3 border-t">
                <div className="sm:col-span-8 relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search by product name, SKU, or barcode..."
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                  />
                  <Tag className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                </div>

                <div className="sm:col-span-4">
                  <select
                    value={selectedCategory}
                    onChange={e => setSelectedCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white"
                  >
                    {categories.map(c => (
                      <option key={c} value={c}>
                        {c === 'all' ? 'All Categories' : c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Items Table */}
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="py-2.5 px-3 w-10 text-center">Print</th>
                      <th className="py-2.5 px-3">Product &amp; Variant</th>
                      <th className="py-2.5 px-3">SKU / Barcode</th>
                      <th className="py-2.5 px-3">Price</th>
                      <th className="py-2.5 px-3">Stock</th>
                      <th className="py-2.5 px-3 w-32 text-center">Print Copies</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredItems.map(item => (
                      <LabelQueueRow
                        key={item.id}
                        item={item}
                        isChecked={Boolean(selectedIds[item.id])}
                        copies={itemCopies[item.id] || 1}
                        onToggle={handleToggleItem}
                        onChangeCopies={handleChangeCopies}
                      />
                    ))}
                  </tbody>
                </table>

                {filteredItems.length === 0 && (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    No products or variants found matching your search.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <PrintPreviewModal
        isOpen={previewModalOpen}
        title={previewPayload?.title || 'Label Sheet Print Preview'}
        html={previewPayload?.html || ''}
        paperInfo={previewPayload?.paperInfo}
        showScaleGuidance={previewPayload?.showScaleGuidance ?? true}
        isGenerating={isGeneratingPreview}
        generationProgress={previewProgress}
        generationError={lastFailedAction === 'preview' ? jobError : null}
        onCancelGeneration={handleCancelPreview}
        onRetryGeneration={handlePreviewSheet}
        onClose={() => {
          handleCancelPreview();
          setPreviewModalOpen(false);
        }}
      />
    </>
  );
};
