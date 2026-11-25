import React, { useEffect, useMemo, useState } from 'react';
import { X, ShoppingBag, Camera, Layers, Shirt } from 'lucide-react';
import { Product, ProductVariant } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import {
  normalizeColorKey,
  resolveColorImages,
  resolveProductColors,
  resolveProductImage,
} from '../../utils/productImageResolver';
import { QrCodeSvg } from '../barcodes/QrCodeSvg';
import { buildProductQrPayload } from '../../utils/barcodeGenerator';

interface ProductDetailGalleryModalProps {
  product: Product | null;
  initialColorId?: string;
  showcaseMode: boolean;
  canManagePhotos: boolean;
  onClose: () => void;
  onManagePhotos: (productId: string) => void;
  onAddToPOS?: (product: Product, variant?: ProductVariant, colorId?: string) => void;
}

export const ProductDetailGalleryModal: React.FC<ProductDetailGalleryModalProps> = ({
  product,
  initialColorId,
  showcaseMode,
  canManagePhotos,
  onClose,
  onManagePhotos,
  onAddToPOS,
}) => {
  const colors = useMemo(() => resolveProductColors(product), [product]);
  const [selectedColorId, setSelectedColorId] = useState<string>('');
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [activeImgIndex, setActiveImgIndex] = useState<number>(0);

  useEffect(() => {
    if (!product) return;
    if (initialColorId && colors.some(c => c.id === initialColorId)) {
      setSelectedColorId(initialColorId);
    } else if (colors.length > 0) {
      setSelectedColorId(colors[0].id);
    } else {
      setSelectedColorId('');
    }
    setActiveImgIndex(0);
    setSelectedVariantId('');
  }, [product, initialColorId, colors]);

  const activeColor = useMemo(
    () => colors.find(c => c.id === selectedColorId) || null,
    [colors, selectedColorId]
  );

  const colorImages = useMemo(
    () => (product ? resolveColorImages(product, activeColor?.id, activeColor?.colorName) : []),
    [product, activeColor]
  );

  const mainImageUrl = useMemo(() => {
    if (!product) return undefined;
    if (colorImages.length > 0) {
      return (colorImages[activeImgIndex] || colorImages[0]).imageUrl;
    }
    return resolveProductImage(product, {
      colorId: activeColor?.id,
      colorName: activeColor?.colorName,
    });
  }, [product, colorImages, activeImgIndex, activeColor]);

  const variantsForColor = useMemo(() => {
    if (!product?.variants) return [];
    if (!activeColor) return product.variants;
    return product.variants.filter(v => {
      if (v.colorId && activeColor.id && !activeColor.id.startsWith('local-color-')) {
        return v.colorId === activeColor.id;
      }
      return normalizeColorKey(v.color) === normalizeColorKey(activeColor.colorName);
    });
  }, [product, activeColor]);

  useEffect(() => {
    setActiveImgIndex(0);
    if (variantsForColor.length > 0) {
      const firstInStock = variantsForColor.find(v => v.stock > 0) || variantsForColor[0];
      setSelectedVariantId(firstInStock.id);
    } else {
      setSelectedVariantId('');
    }
  }, [selectedColorId, variantsForColor]);

  if (!product) return null;

  const selectedVariant =
    variantsForColor.find(v => v.id === selectedVariantId) ||
    product.variants?.find(v => v.id === selectedVariantId);

  const effectivePrice =
    selectedVariant?.salePrice ??
    (product.salePrice + (selectedVariant?.additionalPrice || 0));

  const effectiveCost = product.totalUnitCost || product.purchasePrice;
  const marginPct =
    effectivePrice > 0
      ? Math.round(((effectivePrice - effectiveCost) / effectivePrice) * 100)
      : 0;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-[#101B35] rounded-2xl border border-slate-200 dark:border-[#1F3158] shadow-2xl w-full max-w-4xl overflow-hidden my-4"
      >
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-[#1F3158] flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#087F8C] dark:text-[#D6AD60]">
              {product.category}
            </div>
            <h3 className="text-base font-bold text-[#172033] dark:text-white">
              {product.name}{' '}
              <span className="text-xs font-mono text-[#64748B] dark:text-slate-400">
                ({product.code})
              </span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#162344] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12">
          {/* Left Gallery Stage */}
          <div className="md:col-span-6 p-5 bg-[#F8FAFC] dark:bg-[#0E182E] border-b md:border-b-0 md:border-r border-slate-100 dark:border-[#1F3158] flex flex-col gap-3">
            <div className="aspect-[4/3] rounded-xl overflow-hidden bg-white dark:bg-[#101B35] border border-slate-200 dark:border-[#1F3158] flex items-center justify-center relative">
              {mainImageUrl ? (
                <img
                  src={mainImageUrl}
                  alt={`${product.name}${activeColor ? ` - ${activeColor.colorName}` : ''}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500 p-6 text-center">
                  <Shirt className="w-12 h-12" strokeWidth={1.4} />
                  <span className="text-xs font-medium">
                    No photo uploaded for {activeColor?.colorName || 'this item'} yet
                  </span>
                </div>
              )}

              {activeColor && (
                <div className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/75 text-white text-[11px] font-semibold">
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-white/60"
                    style={{ backgroundColor: activeColor.colorHex }}
                  />
                  <span>{activeColor.colorName}</span>
                </div>
              )}
            </div>

            {colorImages.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {colorImages.map((img, idx) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setActiveImgIndex(idx)}
                    className={`w-16 h-16 rounded-lg overflow-hidden border-2 shrink-0 cursor-pointer transition-all ${
                      idx === activeImgIndex
                        ? 'border-[#087F8C] ring-2 ring-[#087F8C]/20'
                        : 'border-slate-200 dark:border-[#1F3158] opacity-75 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={img.imageUrl}
                      alt={`${activeColor?.colorName || ''} thumbnail ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right Product Specs, Color Switcher & Actions */}
          <div className="md:col-span-6 p-5 flex flex-col justify-between gap-4">
            <div className="space-y-4">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-slate-400 block">
                    Retail Selling Price
                  </span>
                  <span className="text-2xl font-black font-mono-num text-[#172033] dark:text-white">
                    {formatCurrency(effectivePrice, 'en')}
                  </span>
                </div>

                {!showcaseMode && (
                  <div className="text-right">
                    <span className="text-[11px] text-[#64748B] dark:text-slate-400 block">
                      Cost: <span className="font-mono-num font-bold">{formatCurrency(effectiveCost, 'en')}</span>
                    </span>
                    <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 font-mono-num">
                      Margin: {marginPct}%
                    </span>
                  </div>
                )}
              </div>

              {product.description && (
                <p className="text-xs text-[#64748B] dark:text-slate-400 leading-relaxed">
                  {product.description}
                </p>
              )}

              {/* Color Swatch Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
                    Available Colors ({colors.length})
                  </span>
                  {activeColor && (
                    <span className="text-[11px] font-semibold text-[#087F8C] dark:text-[#5EEAD4]">
                      {colorImages.length} photo{colorImages.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                {colors.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {colors.map(color => {
                      const imgs = resolveColorImages(product, color.id, color.colorName);
                      const isSel = activeColor?.id === color.id;
                      return (
                        <button
                          key={color.id}
                          type="button"
                          onClick={() => setSelectedColorId(color.id)}
                          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                            isSel
                              ? 'border-[#087F8C] bg-[#087F8C]/10 dark:bg-[#087F8C]/25 text-[#087F8C] dark:text-[#5EEAD4]'
                              : 'border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0E182E] text-[#172033] dark:text-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-slate-600 shrink-0"
                            style={{ backgroundColor: color.colorHex }}
                          />
                          <span>{color.colorName}</span>
                          {imgs.length > 0 && (
                            <span className="text-[10px] font-mono opacity-75">({imgs.length})</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Single-style item (no color swatches added yet)
                  </div>
                )}
              </div>

              {/* Variants / Sizes for Selected Color */}
              {variantsForColor.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400 flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5" />
                    <span>Sizes &amp; Stock {activeColor ? `(${activeColor.colorName})` : ''}</span>
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto pr-1">
                    {variantsForColor.map(v => {
                      const isSel = selectedVariantId === v.id;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setSelectedVariantId(v.id)}
                          className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                            isSel
                              ? 'border-[#087F8C] bg-[#087F8C]/10 dark:bg-[#087F8C]/25'
                              : 'border-slate-200 dark:border-[#1F3158] bg-slate-50 dark:bg-[#0E182E]'
                          }`}
                        >
                          <div className="text-xs font-bold text-[#172033] dark:text-white">
                            {v.size || 'Std'}
                          </div>
                          <div className="text-[10px] font-mono text-[#64748B] dark:text-slate-400 truncate">
                            {v.sku}
                          </div>
                          <div
                            className={`text-[10px] font-mono-num font-bold mt-0.5 ${
                              v.stock > 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            Stock: {v.stock}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 dark:border-[#1F3158] flex items-center justify-between gap-3">
                <div className="text-xs text-[#64748B] dark:text-slate-400 space-y-1 min-w-0">
                  <div>
                    Total Stock:{' '}
                    <strong className="font-mono-num text-[#172033] dark:text-white">
                      {product.currentStock} {product.unit}
                    </strong>
                  </div>
                  <div className="font-mono text-[11px] truncate">
                    SKU:{' '}
                    <strong className="text-[#172033] dark:text-white">
                      {selectedVariant?.sku || product.code}
                    </strong>
                  </div>
                  {(selectedVariant?.barcode || product.barcode) && (
                    <div className="font-mono text-[11px] truncate">
                      Barcode:{' '}
                      <strong className="text-[#172033] dark:text-white">
                        {selectedVariant?.barcode || product.barcode}
                      </strong>
                    </div>
                  )}
                  {product.brand && (
                    <div>
                      Brand: <strong>{product.brand}</strong>
                    </div>
                  )}
                </div>

                <div className="p-1.5 rounded-lg bg-white border border-slate-200 shrink-0" title="Product QR Tag">
                  <QrCodeSvg
                    value={buildProductQrPayload(
                      product.id,
                      selectedVariant?.id,
                      selectedVariant?.barcode || product.barcode || product.code
                    )}
                    size={58}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-[#1F3158]">
              {canManagePhotos && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onManagePhotos(product.id);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] border border-slate-200 dark:border-[#1F3158] bg-slate-50 dark:bg-[#0E182E] hover:bg-slate-100 text-xs font-bold text-[#172033] dark:text-white cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5 text-[#087F8C]" />
                  <span>Manage Color Photos</span>
                </button>
              )}

              {onAddToPOS && (
                <button
                  type="button"
                  disabled={product.currentStock <= 0}
                  onClick={() => {
                    onAddToPOS(product, selectedVariant, activeColor?.id);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-[#087F8C] hover:bg-[#066974] text-white text-xs font-bold shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  <span>Send to POS</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
