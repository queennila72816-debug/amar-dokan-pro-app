import React, { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  Eye,
  EyeOff,
  Grid as GridIcon,
  Images,
  List,
  Palette,
  Search,
  Shirt,
  ShoppingBag,
  Sparkles,
  Tag,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Product, ProductVariant } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { MODULE_THEMES } from '../../config/moduleTheme';
import { ColorImageWorkspace } from './ColorImageWorkspace';
import { ProductDetailGalleryModal } from './ProductDetailGalleryModal';
import { ProductThumbnail } from '../common/ProductThumbnail';
import {
  getColorUploadCoverage,
  normalizeColorKey,
  resolveProductColors,
  resolveProductImage,
} from '../../utils/productImageResolver';

interface ProductCatalogViewProps {
  onSelectForPOS?: (product: Product, variant?: ProductVariant, colorId?: string) => void;
}

export const ProductCatalogView: React.FC<ProductCatalogViewProps> = ({ onSelectForPOS }) => {
  const {
    products,
    categories,
    hasPermission,
    isAdmin,
    pendingCatalogProductId,
    setPendingCatalogProductId,
  } = useApp();

  const canManageCatalog =
    isAdmin ||
    hasPermission('product_management', 'create') ||
    hasPermission('product_management', 'edit');

  const [activeSubTab, setActiveSubTab] = useState<'gallery' | 'studio'>('gallery');
  const [studioProductId, setStudioProductId] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedColorFilter, setSelectedColorFilter] = useState<string>('All');
  const [selectedSizeFilter, setSelectedSizeFilter] = useState<string>('All');
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'low_stock' | 'out_of_stock'>('all');
  const [photoFilter, setPhotoFilter] = useState<'all' | 'has_photos' | 'missing_photos'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showcaseMode, setShowcaseMode] = useState(false);

  // Per-card active color selection so users can switch color swatches live on any gallery card
  const [cardSelectedColor, setCardSelectedColor] = useState<Record<string, string>>({});
  const [detailModalTarget, setDetailModalTarget] = useState<{
    product: Product;
    colorId?: string;
  } | null>(null);

  // Handle handoff from Products & Variants ("Manage Color Photos")
  useEffect(() => {
    if (pendingCatalogProductId) {
      setStudioProductId(pendingCatalogProductId);
      setActiveSubTab('studio');
      setPendingCatalogProductId(null);
    }
  }, [pendingCatalogProductId, setPendingCatalogProductId]);

  const activeProducts = useMemo(
    () => products.filter(p => p.isActive !== false),
    [products]
  );

  // Aggregate unique colors & sizes across active products for filters
  const availableColors = useMemo(() => {
    const map = new Map<string, { name: string; hex: string }>();
    activeProducts.forEach(p => {
      resolveProductColors(p).forEach(c => {
        const key = normalizeColorKey(c.colorName);
        if (key && !map.has(key)) {
          map.set(key, { name: c.colorName, hex: c.colorHex });
        }
      });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [activeProducts]);

  const availableSizes = useMemo(() => {
    const set = new Set<string>();
    activeProducts.forEach(p => {
      if (p.size) set.add(p.size.trim());
      (p.variants || []).forEach(v => {
        if (v.size?.trim()) set.add(v.size.trim());
      });
    });
    return Array.from(set).sort();
  }, [activeProducts]);

  // Catalog KPI Summary
  const summary = useMemo(() => {
    let totalColors = 0;
    let uploadedColors = 0;
    let totalPhotos = 0;
    let productsWithPhotos = 0;

    activeProducts.forEach(p => {
      const cov = getColorUploadCoverage(p);
      totalColors += cov.totalColors;
      uploadedColors += cov.colorsWithImages;
      totalPhotos += cov.totalImages;
      if (cov.totalImages > 0) productsWithPhotos += 1;
    });

    const missingPhotoProducts = Math.max(0, activeProducts.length - productsWithPhotos);
    const coveragePct =
      activeProducts.length > 0
        ? Math.round((productsWithPhotos / activeProducts.length) * 100)
        : 0;

    return {
      totalProducts: activeProducts.length,
      totalColors,
      uploadedColors,
      totalPhotos,
      missingPhotoProducts,
      coveragePct,
    };
  }, [activeProducts]);

  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return activeProducts.filter(p => {
      const colors = resolveProductColors(p);
      const coverage = getColorUploadCoverage(p);

      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        colors.some(c => c.colorName.toLowerCase().includes(q)) ||
        (p.variants || []).some(
          v =>
            v.sku.toLowerCase().includes(q) ||
            (v.color || '').toLowerCase().includes(q) ||
            (v.size || '').toLowerCase().includes(q)
        );

      const matchesCategory =
        selectedCategory === 'All' || p.category === selectedCategory;

      const matchesColor =
        selectedColorFilter === 'All' ||
        colors.some(
          c => normalizeColorKey(c.colorName) === normalizeColorKey(selectedColorFilter)
        );

      const matchesSize =
        selectedSizeFilter === 'All' ||
        p.size?.trim() === selectedSizeFilter ||
        (p.variants || []).some(v => v.size?.trim() === selectedSizeFilter);

      const matchesStock =
        stockFilter === 'all' ||
        (stockFilter === 'in_stock' && p.currentStock > p.minStockAlert) ||
        (stockFilter === 'low_stock' &&
          p.currentStock > 0 &&
          p.currentStock <= p.minStockAlert) ||
        (stockFilter === 'out_of_stock' && p.currentStock <= 0);

      const matchesPhoto =
        photoFilter === 'all' ||
        (photoFilter === 'has_photos' && coverage.totalImages > 0) ||
        (photoFilter === 'missing_photos' &&
          (coverage.totalImages === 0 || coverage.missingColors > 0));

      return (
        matchesSearch &&
        matchesCategory &&
        matchesColor &&
        matchesSize &&
        matchesStock &&
        matchesPhoto
      );
    });
  }, [
    activeProducts,
    searchTerm,
    selectedCategory,
    selectedColorFilter,
    selectedSizeFilter,
    stockFilter,
    photoFilter,
  ]);

  const openColorStudioForProduct = (productId: string) => {
    setStudioProductId(productId);
    setActiveSubTab('studio');
  };

  return (
    <div className="space-y-4">
      {/* Header & Mode Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1
            className={`text-xl md:text-2xl font-bold flex items-center gap-2 ${MODULE_THEMES.catalog.headerAccentText}`}
          >
            <Images className="w-6 h-6" />
            <span>Apparel Photo Catalog</span>
          </h1>
          <p className="text-xs text-[#64748B] dark:text-slate-400 mt-0.5">
            Color-linked visual lookbook &amp; manual photo management synced across POS, Inventory &amp; Invoices
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sub-tab Switcher */}
          <div className="inline-flex bg-white dark:bg-[#101B35] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] p-1">
            <button
              type="button"
              onClick={() => setActiveSubTab('gallery')}
              className={`px-3 py-1.5 rounded-[7px] text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                activeSubTab === 'gallery'
                  ? 'bg-[#087F8C] text-white'
                  : 'text-[#64748B] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white'
              }`}
            >
              <GridIcon className="w-3.5 h-3.5" />
              <span>Catalog Gallery</span>
            </button>
            {canManageCatalog && (
              <button
                type="button"
                onClick={() => setActiveSubTab('studio')}
                className={`px-3 py-1.5 rounded-[7px] text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                  activeSubTab === 'studio'
                    ? 'bg-[#087F8C] text-white'
                    : 'text-[#64748B] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Color Photo Studio</span>
              </button>
            )}
          </div>

          {activeSubTab === 'gallery' && (
            <button
              type="button"
              onClick={() => setShowcaseMode(prev => !prev)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-xs font-bold border transition-all cursor-pointer ${
                showcaseMode
                  ? 'bg-[#0B1428] border-[#0B1428] text-white shadow-xs'
                  : 'bg-white dark:bg-[#101B35] border-[#E2E8F0] dark:border-[#1F3158] text-[#172033] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162344]'
              }`}
            >
              {showcaseMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{showcaseMode ? 'Customer Showcase (Active)' : 'Showcase Mode'}</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="adp-card p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
            Catalog Styles
          </div>
          <div className="text-xl font-black font-mono-num text-[#172033] dark:text-white mt-1">
            {summary.totalProducts}
          </div>
          <div className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5 font-mono-num">
            {summary.coveragePct}% with photos
          </div>
        </div>

        <div className="adp-card p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
            Color Swatches
          </div>
          <div className="text-xl font-black font-mono-num text-[#087F8C] dark:text-[#5EEAD4] mt-1">
            {summary.uploadedColors} / {summary.totalColors}
          </div>
          <div className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
            Colors linked to images
          </div>
        </div>

        <div className="adp-card p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
            Cloud Photos
          </div>
          <div className="text-xl font-black font-mono-num text-[#172033] dark:text-white mt-1">
            {summary.totalPhotos}
          </div>
          <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
            Permanent product + color IDs
          </div>
        </div>

        <div className="adp-card p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
            Needs Photos
          </div>
          <div className="text-xl font-black font-mono-num text-amber-700 dark:text-amber-400 mt-1">
            {summary.missingPhotoProducts}
          </div>
          <div className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
            Products awaiting upload
          </div>
        </div>
      </div>

      {activeSubTab === 'studio' ? (
        <ColorImageWorkspace initialProductId={studioProductId} />
      ) : (
        <>
          {showcaseMode && (
            <div className="px-4 py-2.5 rounded-xl bg-[#0B1428] text-white text-xs font-medium flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#D6AD60] shrink-0" />
                <span>
                  Customer Showcase Mode active — wholesale costs and profit margins are hidden for safe customer browsing.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowcaseMode(false)}
                className="text-[11px] font-bold text-[#D6AD60] hover:underline cursor-pointer shrink-0"
              >
                Exit
              </button>
            </div>
          )}

          {/* Filter & Search Toolbar */}
          <div className="adp-card p-3.5 space-y-3">
            <div className="flex flex-col lg:flex-row gap-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by product name, code, SKU, barcode, or color..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-xs bg-white dark:bg-[#0E182E] text-[#172033] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#087F8C]/25 focus:border-[#087F8C]"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <select
                  aria-label="Filter by category"
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                  className="px-2.5 py-2 border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-xs bg-white dark:bg-[#0E182E] text-[#172033] dark:text-white"
                >
                  <option value="All">All Categories</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter by color"
                  value={selectedColorFilter}
                  onChange={e => setSelectedColorFilter(e.target.value)}
                  className="px-2.5 py-2 border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-xs bg-white dark:bg-[#0E182E] text-[#172033] dark:text-white"
                >
                  <option value="All">All Colors</option>
                  {availableColors.map(c => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter by size"
                  value={selectedSizeFilter}
                  onChange={e => setSelectedSizeFilter(e.target.value)}
                  className="px-2.5 py-2 border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-xs bg-white dark:bg-[#0E182E] text-[#172033] dark:text-white"
                >
                  <option value="All">All Sizes</option>
                  {availableSizes.map(sz => (
                    <option key={sz} value={sz}>
                      Size: {sz}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter by stock status"
                  value={stockFilter}
                  onChange={e => setStockFilter(e.target.value as any)}
                  className="px-2.5 py-2 border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-xs bg-white dark:bg-[#0E182E] text-[#172033] dark:text-white"
                >
                  <option value="all">All Stock</option>
                  <option value="in_stock">In Stock</option>
                  <option value="low_stock">Low Stock</option>
                  <option value="out_of_stock">Out of Stock</option>
                </select>

                <div className="flex items-center gap-1.5">
                  <select
                    aria-label="Filter by photo status"
                    value={photoFilter}
                    onChange={e => setPhotoFilter(e.target.value as any)}
                    className="flex-1 px-2.5 py-2 border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-xs bg-white dark:bg-[#0E182E] text-[#172033] dark:text-white"
                  >
                    <option value="all">All Photos</option>
                    <option value="has_photos">Has Photos</option>
                    <option value="missing_photos">Missing Photos</option>
                  </select>

                  <div className="inline-flex border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] p-0.5 bg-slate-50 dark:bg-[#0E182E] shrink-0">
                    <button
                      type="button"
                      aria-label="Grid view"
                      onClick={() => setViewMode('grid')}
                      className={`p-1.5 rounded-[7px] cursor-pointer ${
                        viewMode === 'grid'
                          ? 'bg-white dark:bg-[#162344] text-[#087F8C] shadow-xs'
                          : 'text-slate-400'
                      }`}
                    >
                      <GridIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="List view"
                      onClick={() => setViewMode('list')}
                      className={`p-1.5 rounded-[7px] cursor-pointer ${
                        viewMode === 'list'
                          ? 'bg-white dark:bg-[#162344] text-[#087F8C] shadow-xs'
                          : 'text-slate-400'
                      }`}
                    >
                      <List className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Empty State */}
          {filteredProducts.length === 0 ? (
            <div className="adp-card p-12 text-center space-y-2">
              <Shirt className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
              <div className="text-sm font-bold text-[#172033] dark:text-white">
                No matching products in catalog
              </div>
              <p className="text-xs text-[#64748B] dark:text-slate-400">
                Try clearing search or filter criteria, or add products in Products &amp; Variants.
              </p>
            </div>
          ) : viewMode === 'grid' ? (
            /* Grid Gallery View */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredProducts.map(prod => {
                const colors = resolveProductColors(prod);
                const selectedColorId =
                  cardSelectedColor[prod.id] &&
                  colors.some(c => c.id === cardSelectedColor[prod.id])
                    ? cardSelectedColor[prod.id]
                    : colors[0]?.id;
                const activeColor = colors.find(c => c.id === selectedColorId);
                const previewUrl = resolveProductImage(prod, {
                  colorId: activeColor?.id,
                  colorName: activeColor?.colorName,
                });
                const cov = getColorUploadCoverage(prod);

                const effectiveCost = prod.totalUnitCost || prod.purchasePrice;
                const marginPct =
                  prod.salePrice > 0
                    ? Math.round(((prod.salePrice - effectiveCost) / prod.salePrice) * 100)
                    : 0;

                const matchingVariantForPos =
                  activeColor && prod.variants
                    ? prod.variants.find(
                        v =>
                          v.colorId === activeColor.id ||
                          normalizeColorKey(v.color) === normalizeColorKey(activeColor.colorName)
                      )
                    : undefined;

                return (
                  <div
                    key={prod.id}
                    className="adp-card overflow-hidden flex flex-col justify-between transition-all hover:shadow-md"
                  >
                    {/* Card Image Stage */}
                    <div
                      onClick={() =>
                        setDetailModalTarget({ product: prod, colorId: activeColor?.id })
                      }
                      className="relative aspect-[4/3] bg-[#F8FAFC] dark:bg-[#0E182E] border-b border-slate-100 dark:border-[#1F3158] overflow-hidden cursor-pointer group"
                    >
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={`${prod.name}${activeColor ? ` - ${activeColor.colorName}` : ''}`}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-slate-400 dark:text-slate-500 p-4 text-center">
                          <Shirt className="w-10 h-10" strokeWidth={1.4} />
                          <span className="text-[11px] font-medium">No photo uploaded</span>
                        </div>
                      )}

                      {/* Top Overlay Metadata */}
                      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none">
                        <span className="px-2 py-0.5 rounded-md bg-slate-950/75 text-white text-[10px] font-semibold">
                          {prod.category}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-slate-950/75 text-white text-[10px] font-mono-num font-bold">
                          {cov.totalImages} photo{cov.totalImages === 1 ? '' : 's'}
                        </span>
                      </div>

                      {activeColor && (
                        <div className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-950/75 text-white text-[10px] font-semibold pointer-events-none">
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-white/60"
                            style={{ backgroundColor: activeColor.colorHex }}
                          />
                          <span>{activeColor.colorName}</span>
                        </div>
                      )}
                    </div>

                    {/* Card Details */}
                    <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <h3
                            onClick={() =>
                              setDetailModalTarget({ product: prod, colorId: activeColor?.id })
                            }
                            className="text-sm font-bold text-[#172033] dark:text-white leading-snug line-clamp-2 cursor-pointer hover:text-[#087F8C]"
                          >
                            {prod.name}
                          </h3>
                        </div>

                        <div className="text-[11px] text-[#64748B] dark:text-slate-400 font-mono flex items-center justify-between gap-2">
                          <span>{prod.code}</span>
                          <span
                            className={`font-semibold ${
                              prod.currentStock <= 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : prod.currentStock <= prod.minStockAlert
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            Stock: {prod.currentStock}
                          </span>
                        </div>

                        {/* Interactive Color Swatches */}
                        {colors.length > 0 && (
                          <div className="pt-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {colors.map(c => {
                                const isSel = activeColor?.id === c.id;
                                const colorImg = resolveProductImage(prod, {
                                  colorId: c.id,
                                  colorName: c.colorName,
                                  fallbackToProductPrimary: false,
                                });
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    title={`${c.colorName}${colorImg ? ' (Photo linked)' : ' (No photo)'}`}
                                    onClick={() =>
                                      setCardSelectedColor(prev => ({ ...prev, [prod.id]: c.id }))
                                    }
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium cursor-pointer transition-all ${
                                      isSel
                                        ? 'border-[#087F8C] bg-[#087F8C]/10 text-[#087F8C] dark:text-[#5EEAD4]'
                                        : 'border-slate-200 dark:border-[#1F3158] text-[#64748B] dark:text-slate-300 hover:border-slate-300'
                                    }`}
                                  >
                                    <span
                                      className="w-2.5 h-2.5 rounded-full border border-slate-300 dark:border-slate-600 shrink-0"
                                      style={{ backgroundColor: c.colorHex }}
                                    />
                                    <span className="truncate max-w-[68px]">{c.colorName}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-[#1F3158]">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-base font-black font-mono-num text-[#172033] dark:text-white">
                            {formatCurrency(prod.salePrice, 'en')}
                          </span>
                          {!showcaseMode && (
                            <span className="text-[11px] text-[#64748B] dark:text-slate-400 font-mono-num">
                              Cost {formatCurrency(effectiveCost, 'en')} · {marginPct}%
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setDetailModalTarget({ product: prod, colorId: activeColor?.id })
                            }
                            className="flex-1 py-1.5 px-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-slate-50 dark:bg-[#0E182E] hover:bg-slate-100 dark:hover:bg-[#162344] text-[11px] font-bold text-[#172033] dark:text-white cursor-pointer flex items-center justify-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View</span>
                          </button>

                          {canManageCatalog && (
                            <button
                              type="button"
                              onClick={() => openColorStudioForProduct(prod.id)}
                              title="Upload & manage color photos"
                              className="py-1.5 px-2.5 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-white dark:bg-[#101B35] hover:border-[#087F8C] text-[11px] font-bold text-[#087F8C] dark:text-[#5EEAD4] cursor-pointer flex items-center gap-1"
                            >
                              <Camera className="w-3.5 h-3.5" />
                              <span>Photos</span>
                            </button>
                          )}

                          {onSelectForPOS && (
                            <button
                              type="button"
                              disabled={prod.currentStock <= 0}
                              onClick={() =>
                                onSelectForPOS(prod, matchingVariantForPos, activeColor?.id)
                              }
                              title="Send selected product & color to POS"
                              className="py-1.5 px-2.5 rounded-[8px] bg-[#087F8C] hover:bg-[#066974] text-white text-[11px] font-bold cursor-pointer disabled:opacity-45 flex items-center gap-1"
                            >
                              <ShoppingBag className="w-3.5 h-3.5" />
                              <span>POS</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* List View */
            <div className="adp-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F8FAFC] dark:bg-[#0E182E] border-b border-[#E2E8F0] dark:border-[#1F3158] text-[#64748B] dark:text-slate-400">
                      <th className="py-3 px-4 font-bold uppercase text-[11px]">Product</th>
                      <th className="py-3 px-3 font-bold uppercase text-[11px]">Available Colors</th>
                      <th className="py-3 px-3 font-bold uppercase text-[11px] text-center">Photos</th>
                      <th className="py-3 px-3 font-bold uppercase text-[11px] text-right">Stock</th>
                      <th className="py-3 px-3 font-bold uppercase text-[11px] text-right">Price</th>
                      {!showcaseMode && (
                        <th className="py-3 px-3 font-bold uppercase text-[11px] text-right">Cost</th>
                      )}
                      <th className="py-3 px-4 font-bold uppercase text-[11px] text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#1F3158]">
                    {filteredProducts.map(prod => {
                      const colors = resolveProductColors(prod);
                      const selectedColorId =
                        cardSelectedColor[prod.id] &&
                        colors.some(c => c.id === cardSelectedColor[prod.id])
                          ? cardSelectedColor[prod.id]
                          : colors[0]?.id;
                      const activeColor = colors.find(c => c.id === selectedColorId);
                      const thumbUrl = resolveProductImage(prod, {
                        colorId: activeColor?.id,
                        colorName: activeColor?.colorName,
                      });
                      const cov = getColorUploadCoverage(prod);

                      return (
                        <tr
                          key={prod.id}
                          className="hover:bg-[#F8FAFC] dark:hover:bg-[#162344]/60 transition-colors"
                        >
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-3">
                              <ProductThumbnail
                                src={thumbUrl}
                                alt={prod.name}
                                colorHex={activeColor?.colorHex}
                                colorName={activeColor?.colorName}
                                size="sm"
                              />
                              <div>
                                <div className="font-bold text-[#172033] dark:text-white">
                                  {prod.name}
                                </div>
                                <div className="text-[11px] font-mono text-[#64748B] dark:text-slate-400">
                                  {prod.code} · {prod.category}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex flex-wrap gap-1">
                              {colors.length === 0 ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                colors.map(c => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() =>
                                      setCardSelectedColor(prev => ({ ...prev, [prod.id]: c.id }))
                                    }
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] cursor-pointer ${
                                      activeColor?.id === c.id
                                        ? 'border-[#087F8C] bg-[#087F8C]/10 text-[#087F8C] font-bold'
                                        : 'border-slate-200 dark:border-[#1F3158] text-slate-600 dark:text-slate-300'
                                    }`}
                                  >
                                    <span
                                      className="w-2 h-2 rounded-full border border-slate-300"
                                      style={{ backgroundColor: c.colorHex }}
                                    />
                                    <span>{c.colorName}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono-num">
                            <span
                              className={`font-bold ${
                                cov.totalImages > 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {cov.totalImages}
                            </span>
                            {cov.totalColors > 0 && (
                              <span className="text-[10px] text-slate-400 block">
                                {cov.colorsWithImages}/{cov.totalColors} colors
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-num font-bold text-[#172033] dark:text-white">
                            {prod.currentStock} {prod.unit}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-num font-bold text-[#172033] dark:text-white">
                            {formatCurrency(prod.salePrice, 'en')}
                          </td>
                          {!showcaseMode && (
                            <td className="py-2.5 px-3 text-right font-mono-num text-[#64748B] dark:text-slate-400">
                              {formatCurrency(prod.totalUnitCost || prod.purchasePrice, 'en')}
                            </td>
                          )}
                          <td className="py-2.5 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setDetailModalTarget({ product: prod, colorId: activeColor?.id })
                                }
                                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#1F3158] text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-[#162344] cursor-pointer"
                              >
                                Details
                              </button>
                              {canManageCatalog && (
                                <button
                                  type="button"
                                  onClick={() => openColorStudioForProduct(prod.id)}
                                  className="px-2.5 py-1 rounded-lg bg-[#087F8C] text-white text-[11px] font-bold hover:bg-[#066974] cursor-pointer"
                                >
                                  Manage Photos
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Product Gallery Detail Modal */}
      <ProductDetailGalleryModal
        product={detailModalTarget?.product || null}
        initialColorId={detailModalTarget?.colorId}
        showcaseMode={showcaseMode}
        canManagePhotos={canManageCatalog}
        onClose={() => setDetailModalTarget(null)}
        onManagePhotos={productId => openColorStudioForProduct(productId)}
        onAddToPOS={onSelectForPOS}
      />
    </div>
  );
};
