import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Product, ProductVariant } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { isSalesmanOrCashierRole } from '../../utils/rbacDefaults';
import {
  Grid,
  List,
  Eye,
  EyeOff,
  Search,
  Filter,
  Package,
  Layers,
  Sparkles,
  ShoppingBag,
  Maximize2,
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  Tag,
  ShieldAlert,
  Percent,
} from 'lucide-react';

interface ProductCatalogViewProps {
  onSelectForPOS?: (product: Product, variant?: ProductVariant) => void;
}

export const ProductCatalogView: React.FC<ProductCatalogViewProps> = ({ onSelectForPOS }) => {
  const { products, categories, settings, isAdmin, currentUserRole } = useApp();

  // Mode: Grid vs List
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Customer Showcase Mode (Default true for sales floor safety)
  const [isShowcaseMode, setIsShowcaseMode] = useState<boolean>(() => {
    if (isSalesmanOrCashierRole(currentUserRole)) return true;
    return false;
  });

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSize, setSelectedSize] = useState<string>('all');
  const [selectedColor, setSelectedColor] = useState<string>('all');
  const [stockAvailability, setStockAvailability] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');

  // Photo Lightbox modal state
  const [activeGalleryProduct, setActiveGalleryProduct] = useState<Product | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);

  // Clothing standard sizes & colors extracted from products
  const availableSizes = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => {
      if (p.size) set.add(p.size);
      if (p.variants) {
        p.variants.forEach(v => v.size && set.add(v.size));
      }
    });
    return ['all', ...Array.from(set)];
  }, [products]);

  const availableColors = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => {
      if (p.color) set.add(p.color);
      if (p.variants) {
        p.variants.forEach(v => v.color && set.add(v.color));
      }
    });
    return ['all', ...Array.from(set)];
  }, [products]);

  // Filtered Products
  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return products.filter(p => {
      if (p.isActive === false) return false;

      const matchCat = selectedCategory === 'all' || p.category === selectedCategory;

      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.barcode.includes(q) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.variants && p.variants.some(v => (v.color && v.color.toLowerCase().includes(q)) || (v.size && v.size.toLowerCase().includes(q))));

      const matchSize =
        selectedSize === 'all' ||
        p.size === selectedSize ||
        (p.variants && p.variants.some(v => v.size === selectedSize));

      const matchColor =
        selectedColor === 'all' ||
        p.color?.toLowerCase() === selectedColor.toLowerCase() ||
        (p.variants && p.variants.some(v => v.color?.toLowerCase() === selectedColor.toLowerCase()));

      const matchStock =
        stockAvailability === 'all' ||
        (stockAvailability === 'in_stock' && p.currentStock > 0) ||
        (stockAvailability === 'out_of_stock' && p.currentStock <= 0);

      return matchCat && matchSearch && matchSize && matchColor && matchStock;
    });
  }, [products, searchQuery, selectedCategory, selectedSize, selectedColor, stockAvailability]);

  // Open Image Gallery Lightbox
  const handleOpenGallery = (prod: Product, startIndex: number = 0) => {
    setActiveGalleryProduct(prod);
    setActiveImageIndex(startIndex);
  };

  // Get product image list
  const getProductImages = (prod: Product): string[] => {
    if (prod.images && prod.images.length > 0) {
      return prod.images;
    }
    if (prod.image) {
      return [prod.image];
    }
    // High quality aesthetic fallback for apparel
    return ['https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=600&q=80'];
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Customer Showcase Toggle */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-indigo-50 text-indigo-700">
              <ShoppingBag className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-slate-900">Apparel Visual Catalog</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Browse collection photos, size curves, and colorways. Safe to present to customers in Showcase Mode.
          </p>
        </div>

        {/* Showcase Mode Toggle */}
        <div className="flex items-center gap-3">
          <div
            onClick={() => {
              if (!isSalesmanOrCashierRole(currentUserRole)) {
                setIsShowcaseMode(!isShowcaseMode);
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-bold transition-all ${
              isSalesmanOrCashierRole(currentUserRole) ? 'cursor-not-allowed' : 'cursor-pointer'
            } ${
              isShowcaseMode
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-2 ring-emerald-500/20'
                : 'bg-slate-100 text-slate-700 border-slate-300'
            }`}
          >
            {isShowcaseMode ? (
              <>
                <Eye className="w-4 h-4 text-emerald-600" />
                <span>Showcase Mode (Customer-Safe)</span>
              </>
            ) : (
              <>
                <EyeOff className="w-4 h-4 text-slate-500" />
                <span>Admin View (Costs &amp; Margins Visible)</span>
              </>
            )}
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg text-xs transition-colors ${
                viewMode === 'grid' ? 'bg-white shadow-xs text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg text-xs transition-colors ${
                viewMode === 'list' ? 'bg-white shadow-xs text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
          {/* Search */}
          <div className="lg:col-span-4 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search shirt, panjabi, color, SKU..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>

          {/* Category Filter */}
          <div className="lg:col-span-2">
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white"
            >
              <option value="all">All Categories</option>
              {categories.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Size Filter */}
          <div className="lg:col-span-2">
            <select
              value={selectedSize}
              onChange={e => setSelectedSize(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white"
            >
              <option value="all">All Sizes</option>
              {availableSizes.filter(s => s !== 'all').map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Color Filter */}
          <div className="lg:col-span-2">
            <select
              value={selectedColor}
              onChange={e => setSelectedColor(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white"
            >
              <option value="all">All Colors</option>
              {availableColors.filter(c => c !== 'all').map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Stock Filter */}
          <div className="lg:col-span-2">
            <select
              value={stockAvailability}
              onChange={e => setStockAvailability(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white"
            >
              <option value="all">All Stock Status</option>
              <option value="in_stock">In Stock Only</option>
              <option value="out_of_stock">Out of Stock</option>
            </select>
          </div>
        </div>
      </div>

      {/* Catalog Display */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredProducts.map(product => {
            const images = getProductImages(product);
            const mainImg = images[0];
            const hasStock = product.currentStock > 0;

            return (
              <div
                key={product.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col group"
              >
                {/* Photo Header */}
                <div className="relative aspect-4/3 bg-slate-100 overflow-hidden cursor-pointer" onClick={() => handleOpenGallery(product)}>
                  <img
                    src={mainImg}
                    alt={product.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />

                  {/* Multiple Photos Badge */}
                  {images.length > 1 && (
                    <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-xs text-white text-[10px] font-semibold flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      <span>{images.length} photos</span>
                    </span>
                  )}

                  {/* Stock Badge */}
                  <span
                    className={`absolute top-2 left-2 px-2.5 py-1 rounded-full text-[10px] font-bold shadow-xs ${
                      product.currentStock <= 0
                        ? 'bg-rose-600 text-white'
                        : product.currentStock <= product.minStockAlert
                        ? 'bg-amber-500 text-white'
                        : 'bg-emerald-600 text-white'
                    }`}
                  >
                    {product.currentStock <= 0 ? 'Out of Stock' : `${product.currentStock} in stock`}
                  </span>

                  {/* Expand preview button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenGallery(product);
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-white/80 hover:bg-white text-slate-700 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Details */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span>{product.category}</span>
                      <span>{product.code}</span>
                    </div>

                    <h3 className="font-bold text-sm text-slate-900 line-clamp-1 mt-1">
                      {product.name}
                    </h3>

                    {/* Variant tags */}
                    {product.hasVariants && product.variants && product.variants.length > 0 ? (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex flex-wrap gap-1">
                          {Array.from(new Set(product.variants.map(v => v.size).filter(Boolean))).map(s => (
                            <span key={s} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold font-mono">
                              {s}
                            </span>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {Array.from(new Set(product.variants.map(v => v.color).filter(Boolean))).map(c => (
                            <span key={c} className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-medium">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 text-[11px] text-slate-500">
                        {product.color && <span className="mr-2">Color: {product.color}</span>}
                        {product.size && <span>Size: {product.size}</span>}
                      </div>
                    )}
                  </div>

                  {/* Pricing Section */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Retail Price</span>
                      <span className="text-base font-extrabold text-slate-900 font-mono-num">
                        {formatCurrency(product.salePrice, 'en')}
                      </span>
                    </div>

                    {/* Internal Cost info (ONLY IF NOT IN SHOWCASE MODE) */}
                    {!isShowcaseMode && (
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 block">Landed Cost</span>
                        <span className="text-xs font-semibold text-slate-600 font-mono-num">
                          {formatCurrency(product.totalUnitCost || product.purchasePrice, 'en')}
                        </span>
                        {product.salePrice > (product.totalUnitCost || product.purchasePrice) && (
                          <span className="text-[9px] text-emerald-600 font-bold block">
                            +{Math.round(((product.salePrice - (product.totalUnitCost || product.purchasePrice)) / product.salePrice) * 100)}% margin
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List Mode */
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-3 px-4">Photo</th>
                  <th className="py-3 px-4">Product Name</th>
                  <th className="py-3 px-4">SKU / Code</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Available Variants</th>
                  <th className="py-3 px-4">Selling Price</th>
                  {!isShowcaseMode && <th className="py-3 px-4">Unit Cost</th>}
                  <th className="py-3 px-4">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map(p => {
                  const imgs = getProductImages(p);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-4">
                        <img
                          src={imgs[0]}
                          alt={p.name}
                          onClick={() => handleOpenGallery(p)}
                          className="w-12 h-12 object-cover rounded-lg border border-slate-200 cursor-pointer hover:scale-105 transition-transform"
                        />
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-slate-900">{p.name}</div>
                        {p.brand && <div className="text-[10px] text-slate-400">{p.brand}</div>}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-medium text-slate-700">
                        {p.code}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">
                        {p.category}
                      </td>
                      <td className="py-2.5 px-4">
                        {p.hasVariants && p.variants ? (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {p.variants.slice(0, 4).map(v => (
                              <span key={v.id} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono">
                                {[v.color, v.size].filter(Boolean).join('-')}
                              </span>
                            ))}
                            {p.variants.length > 4 && (
                              <span className="text-[10px] text-slate-400">+{p.variants.length - 4} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-bold text-slate-900 font-mono-num">
                        {formatCurrency(p.salePrice, 'en')}
                      </td>
                      {!isShowcaseMode && (
                        <td className="py-2.5 px-4 font-mono text-slate-600">
                          {formatCurrency(p.totalUnitCost || p.purchasePrice, 'en')}
                        </td>
                      )}
                      <td className="py-2.5 px-4 font-mono">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            p.currentStock <= 0
                              ? 'bg-rose-100 text-rose-700'
                              : p.currentStock <= p.minStockAlert
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {p.currentStock} pcs
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Photo Lightbox Modal */}
      {activeGalleryProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-white rounded-3xl overflow-hidden max-w-4xl w-full max-h-[90vh] flex flex-col md:flex-row shadow-2xl border border-slate-200">
            {/* Gallery Image Display */}
            <div className="flex-1 bg-black flex flex-col items-center justify-center relative min-h-[350px] p-4">
              {(() => {
                const images = getProductImages(activeGalleryProduct);
                const currentImg = images[activeImageIndex] || images[0];

                return (
                  <>
                    <img
                      src={currentImg}
                      alt={activeGalleryProduct.name}
                      className="max-h-[70vh] max-w-full object-contain rounded-xl"
                    />

                    {/* Navigation buttons */}
                    {images.length > 1 && (
                      <div className="absolute inset-y-0 inset-x-2 flex items-center justify-between pointer-events-none">
                        <button
                          onClick={() => setActiveImageIndex((activeImageIndex - 1 + images.length) % images.length)}
                          className="pointer-events-auto p-2 rounded-full bg-white/20 hover:bg-white/40 text-white backdrop-blur-xs transition-colors"
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => setActiveImageIndex((activeImageIndex + 1) % images.length)}
                          className="pointer-events-auto p-2 rounded-full bg-white/20 hover:bg-white/40 text-white backdrop-blur-xs transition-colors"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </div>
                    )}

                    {/* Image thumbnails bar */}
                    {images.length > 1 && (
                      <div className="flex items-center gap-2 mt-4 overflow-x-auto max-w-full pb-1">
                        {images.map((img, i) => (
                          <img
                            key={i}
                            src={img}
                            alt=""
                            onClick={() => setActiveImageIndex(i)}
                            className={`w-12 h-12 object-cover rounded-lg cursor-pointer border-2 transition-all ${
                              activeImageIndex === i ? 'border-indigo-500 scale-105' : 'border-transparent opacity-60 hover:opacity-100'
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Sidebar Details */}
            <div className="w-full md:w-80 p-6 flex flex-col justify-between space-y-4 bg-white overflow-y-auto">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <span className="text-[11px] font-mono text-slate-400">
                    {activeGalleryProduct.code}
                  </span>
                  <button
                    onClick={() => setActiveGalleryProduct(null)}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="mt-3">
                  <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                    {activeGalleryProduct.category}
                  </span>
                  <h2 className="text-lg font-bold text-slate-900 mt-1">
                    {activeGalleryProduct.name}
                  </h2>
                </div>

                {activeGalleryProduct.description && (
                  <p className="text-xs text-slate-600 mt-2 line-clamp-3">
                    {activeGalleryProduct.description}
                  </p>
                )}

                {/* Variants Curve */}
                {activeGalleryProduct.hasVariants && activeGalleryProduct.variants && (
                  <div className="mt-4 space-y-2">
                    <label className="text-xs font-bold text-slate-800 block">Available Sizes &amp; Colors</label>
                    <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                      {activeGalleryProduct.variants.map(v => (
                        <div
                          key={v.id}
                          className="p-2 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between text-[11px]"
                        >
                          <div>
                            <div className="font-bold text-slate-900">{v.color || 'Standard'}</div>
                            <div className="text-[10px] font-mono text-slate-500">Size: {v.size || 'Free'}</div>
                          </div>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              v.stock <= 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {v.stock} pcs
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Price & Action */}
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Customer Price</span>
                  <span className="text-xl font-extrabold text-slate-900 font-mono-num">
                    {formatCurrency(activeGalleryProduct.salePrice, 'en')}
                  </span>
                </div>

                <button
                  onClick={() => setActiveGalleryProduct(null)}
                  className="w-full py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  Close Showcase View
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
