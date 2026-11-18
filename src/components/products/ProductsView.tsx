import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { getBusinessDisplayName } from '../../config/appIdentity';
import { Product, ProductVariant, BusinessType } from '../../types';
import { formatCurrency, toBnNumber } from '../../utils/formatters';
import {
  Package,
  Plus,
  Search,
  Barcode,
  Edit2,
  Trash2,
  X,
  AlertTriangle,
  RotateCcw,
  Check,
  FolderPlus,
  Archive,
  ChevronDown,
  ChevronUp,
  Printer,
  Sparkles,
  Eye,
} from 'lucide-react';
import { VariantMatrixGenerator } from './VariantMatrixGenerator';
import { BarcodeSvg } from '../barcodes/BarcodeSvg';
import { BarcodeFormat } from '../../utils/barcodeGenerator';
import {
  getPrinterSettings,
  previewProductLabel,
  printProductLabel,
  PrintPreviewPayload,
} from '../../utils/printEngine';
import { PrintPreviewModal } from '../printing/PrintPreviewModal';
import { LabelConfig, LabelTemplateId } from '../../types';

interface ProductsViewProps {
  isAddModalOpen?: boolean;
  onCloseAddModal?: () => void;
}

export const ProductsView: React.FC<ProductsViewProps> = ({ isAddModalOpen: propIsAddModalOpen, onCloseAddModal: propOnCloseAddModal }) => {
  const { products, categories, addCategory, addProduct, updateProduct, deleteProduct, isAdmin, settings, hasPermission } = useApp();
  const canCreateProduct = hasPermission('product_management', 'create');
  const canEditProduct = hasPermission('product_management', 'edit');
  const canDeleteProduct = hasPermission('product_management', 'delete') || isAdmin;
  const canPrintBarcode = hasPermission('barcode_label_printing', 'print');
  const isBn = false;
  const lang = settings.language;

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'normal' | 'low' | 'out'>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [expandedProductIds, setExpandedProductIds] = useState<Record<string, boolean>>({});

  const toggleExpandVariants = (id: string) => {
    setExpandedProductIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(propIsAddModalOpen || false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [barcodeModalProduct, setBarcodeModalProduct] = useState<Product | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('base');
  const [labelCopies, setLabelCopies] = useState<number>(1);
  const [labelTemplate, setLabelTemplate] = useState<LabelTemplateId>(() => getPrinterSettings(settings).labelTemplate || '40x30');
  const [labelFormat, setLabelFormat] = useState<BarcodeFormat>('CODE128');
  const [isPrintingLabel, setIsPrintingLabel] = useState(false);
  const [labelPrintError, setLabelPrintError] = useState<string | null>(null);
  const [labelPreviewPayload, setLabelPreviewPayload] = useState<PrintPreviewPayload | null>(null);
  const [showNewCatInput, setShowNewCatInput] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [isSubmittingProduct, setIsSubmittingProduct] = useState(false);

  // Sync prop changes
  React.useEffect(() => {
    if (propIsAddModalOpen === true) {
      handleOpenAdd();
    } else if (propIsAddModalOpen === false) {
      setIsModalOpen(false);
    }
  }, [propIsAddModalOpen]);

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
    setShowNewCatInput(false);
    if (propOnCloseAddModal) propOnCloseAddModal();
  };

  // Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [barcode, setBarcode] = useState('');
  const [category, setCategory] = useState('Clothing');
  const [subcategory, setSubcategory] = useState('');
  const [brand, setBrand] = useState('');
  const [description, setDescription] = useState('');
  const [purchasePrice, setPurchasePrice] = useState<number | ''>('');
  const [salePrice, setSalePrice] = useState<number | ''>('');
  const [wholesalePrice, setWholesalePrice] = useState<number | ''>('');
  const [minSalePrice, setMinSalePrice] = useState<number | ''>('');
  const [currentStock, setCurrentStock] = useState<number | ''>('');
  const [minStockAlert, setMinStockAlert] = useState<number | ''>(5);
  const [unit, setUnit] = useState('pcs');
  const [businessType, setBusinessType] = useState<BusinessType>(settings.businessType || 'clothing');

  // Clothing Variants
  const [hasVariants, setHasVariants] = useState(false);
  const [variants, setVariants] = useState<ProductVariant[]>([]);

  // Electronics fields
  const [model, setModel] = useState('');
  const [warrantyPeriod, setWarrantyPeriod] = useState('');

  // Grocery fields
  const [expiryDate, setExpiryDate] = useState('');
  const [batchNumber, setBatchNumber] = useState('');

  // Open Add Modal
  const handleOpenAdd = () => {
    setEditingProduct(null);
    setName('');
    const randomCode = `PRD-${Math.floor(100 + Math.random() * 900)}`;
    setCode(randomCode);
    setBarcode(`894${Math.floor(100000 + Math.random() * 900000)}`);
    const defaultCat = categories.length > 0 ? categories[0].name : 'General';
    setCategory(defaultCat);
    setSubcategory('');
    setBrand('');
    setDescription('');
    setPurchasePrice('');
    setSalePrice('');
    setWholesalePrice('');
    setMinSalePrice('');
    setCurrentStock(10);
    setMinStockAlert(5);
    setUnit(settings.businessType === 'grocery' ? 'kg' : 'pcs');
    setBusinessType(settings.businessType || 'clothing');
    setHasVariants(false);
    setVariants([]);
    setModel('');
    setWarrantyPeriod('');
    setExpiryDate('');
    setBatchNumber('');
    setNewCatName('');
    setShowNewCatInput(false);
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (p: Product) => {
    setEditingProduct(p);
    setName(p.name || '');
    setCode(p.code || '');
    setBarcode(p.barcode || '');
    setCategory(p.category || (categories.length > 0 ? categories[0].name : 'General'));
    setSubcategory(p.subcategory || '');
    setBrand(p.brand || '');
    setDescription(p.description || '');
    setPurchasePrice(p.purchasePrice);
    setSalePrice(p.salePrice);
    setWholesalePrice(p.wholesalePrice ?? '');
    setMinSalePrice(p.minSalePrice ?? '');
    setCurrentStock(p.currentStock);
    setMinStockAlert(p.minStockAlert || 5);
    setUnit(p.unit || 'pcs');
    setBusinessType(p.businessType || 'clothing');
    setHasVariants(!!p.hasVariants);
    setVariants(Array.isArray(p.variants) ? p.variants.map(v => ({ ...v })) : []);
    setModel(p.model || '');
    setWarrantyPeriod(p.warrantyPeriod || '');
    setExpiryDate(p.expiryDate || '');
    setBatchNumber(p.batchNumber || '');
    setNewCatName('');
    setShowNewCatInput(false);
    setIsModalOpen(true);
  };

  // Quick Add Category from form
  const handleCreateCategory = async () => {
    const trimmed = newCatName.trim();
    if (!trimmed) {
      alert('Please enter a category name.');
      return;
    }
    try {
      const cat = await addCategory({ name: trimmed });
      setCategory(cat.name);
      setNewCatName('');
      setShowNewCatInput(false);
    } catch (err: any) {
      alert(`Failed to create category: ${err.message || 'Database error'}`);
    }
  };

  // Submit Product
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingProduct) return;

    const cleanName = name.trim();
    const finalCode = code.trim() || `PRD-${Date.now().toString().slice(-4)}`;
    const finalBarcode = barcode.trim() || `${Date.now().toString().slice(-8)}`;
    const parsedPurchase = Number(purchasePrice);
    const parsedSale = Number(salePrice);
    const parsedMinStock = minStockAlert === '' ? 5 : Number(minStockAlert);

    if (!cleanName || purchasePrice === '' || salePrice === '' || Number.isNaN(parsedPurchase) || Number.isNaN(parsedSale)) {
      alert('Name, purchase price, and sale price are required!');
      return;
    }

    if (
      parsedSale < 0 ||
      parsedPurchase < 0 ||
      (wholesalePrice !== '' && Number(wholesalePrice) < 0) ||
      (minSalePrice !== '' && Number(minSalePrice) < 0)
    ) {
      alert('Prices cannot be negative!');
      return;
    }

    if (!hasVariants && Number(currentStock || 0) < 0) {
      alert('Stock quantity cannot be negative!');
      return;
    }

    if (!Number.isFinite(parsedMinStock) || parsedMinStock < 1) {
      alert('Low stock alert threshold must be at least 1.');
      return;
    }

    if (hasVariants && variants.length === 0) {
      alert('Please add at least one Size/Color variant or disable Variants.');
      return;
    }

    // Duplicate SKU check
    const isSkuTaken = products.some(
      p => p.id !== editingProduct?.id && (p.code || '').trim().toLowerCase() === finalCode.toLowerCase()
    );
    if (isSkuTaken) {
      alert(`SKU '${finalCode}' is already taken!`);
      return;
    }

    // Duplicate Barcode check
    const isBarcodeTaken = products.some(
      p => p.id !== editingProduct?.id && (p.barcode || '').trim().toLowerCase() === finalBarcode.toLowerCase()
    );
    if (isBarcodeTaken) {
      alert(`Barcode '${finalBarcode}' is already used!`);
      return;
    }

    let sanitizedVariants: ProductVariant[] = [];
    if (hasVariants) {
      const seenSkus = new Set<string>();
      for (let idx = 0; idx < variants.length; idx++) {
        const v = variants[idx];
        const cleanSku = (v.sku || '').trim() || `${finalCode}-V${idx + 1}`;
        const lowerSku = cleanSku.toLowerCase();
        if (seenSkus.has(lowerSku)) {
          alert(`Duplicate variant SKU '${cleanSku}'. Each variant must have a unique SKU.`);
          return;
        }
        seenSkus.add(lowerSku);

        sanitizedVariants.push({
          ...v,
          color: v.color?.trim() || undefined,
          size: v.size?.trim() || undefined,
          sku: cleanSku,
          barcode: v.barcode?.trim() || undefined,
          stock: Math.max(0, Number(v.stock) || 0),
          purchasePrice:
            v.purchasePrice !== undefined && v.purchasePrice !== null && !Number.isNaN(Number(v.purchasePrice))
              ? Math.max(0, Number(v.purchasePrice))
              : undefined,
          salePrice:
            v.salePrice !== undefined && v.salePrice !== null && !Number.isNaN(Number(v.salePrice))
              ? Math.max(0, Number(v.salePrice))
              : undefined,
        });
      }
    }

    const calculatedStock = hasVariants
      ? sanitizedVariants.reduce((sum, v) => sum + v.stock, 0)
      : Math.max(0, Number(currentStock) || 0);

    setIsSubmittingProduct(true);
    try {
      let finalCategory = (category || '').trim() || 'General';
      if (showNewCatInput && newCatName.trim()) {
        const createdCat = await addCategory({ name: newCatName.trim() });
        finalCategory = createdCat.name;
        setCategory(createdCat.name);
        setNewCatName('');
        setShowNewCatInput(false);
      }

      const productPayload = {
        name: cleanName,
        code: finalCode,
        barcode: finalBarcode,
        category: finalCategory,
        subcategory: subcategory.trim() || undefined,
        brand: brand.trim() || undefined,
        description: description.trim() || undefined,
        purchasePrice: parsedPurchase,
        salePrice: parsedSale,
        wholesalePrice: wholesalePrice !== '' ? Number(wholesalePrice) : undefined,
        minSalePrice: minSalePrice !== '' ? Number(minSalePrice) : undefined,
        currentStock: calculatedStock,
        minStockAlert: parsedMinStock,
        unit,
        businessType,
        hasVariants,
        variants: hasVariants ? sanitizedVariants : [],
        model: model.trim() || undefined,
        warrantyPeriod: warrantyPeriod.trim() || undefined,
        expiryDate: expiryDate || undefined,
        batchNumber: batchNumber.trim() || undefined,
        isActive: editingProduct ? editingProduct.isActive !== false : true,
      };

      if (editingProduct) {
        await updateProduct(editingProduct.id, productPayload);
      } else {
        await addProduct(productPayload);
      }
      closeModal();
    } catch (err: any) {
      alert(`Product save failed: ${err.message || 'Database error'}`);
    } finally {
      setIsSubmittingProduct(false);
    }
  };

  // Variant helper
  const addVariantRow = () => {
    setVariants(prev => [
      ...prev,
      {
        id: `v-${Date.now()}-${prev.length + 1}`,
        color: '',
        size: '',
        sku: `${code}-${prev.length + 1}`,
        stock: 5,
      },
    ]);
  };

  const removeVariantRow = (idx: number) => {
    setVariants(prev => prev.filter((_, i) => i !== idx));
  };

  // Combined Category List
  const categoriesList = useMemo(() => {
    const map = new Map<string, string>();
    const addName = (raw?: string) => {
      const clean = (raw || '').trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (!map.has(key)) map.set(key, clean);
    };
    categories.forEach(c => addName(c.name));
    products.forEach(p => addName(p.category));
    addName(category);
    if (map.size === 0) map.set('general', 'General');
    return Array.from(map.values());
  }, [categories, products, category]);

  const activeProductsCount = useMemo(
    () => products.filter(p => p.isActive !== false).length,
    [products]
  );

  // Filter products
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter(p => {
      // Status filter (active, inactive, all)
      if (statusFilter === 'active' && p.isActive === false) return false;
      if (statusFilter === 'inactive' && p.isActive !== false) return false;

      const matchesSearch =
        !q ||
        (p.name || '').toLowerCase().includes(q) ||
        (p.code || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.subcategory || '').toLowerCase().includes(q) ||
        (p.model || '').toLowerCase().includes(q) ||
        (p.batchNumber || '').toLowerCase().includes(q) ||
        (Array.isArray(p.variants) &&
          p.variants.some(
            v =>
              (v.sku || '').toLowerCase().includes(q) ||
              (v.barcode || '').toLowerCase().includes(q) ||
              (v.color || '').toLowerCase().includes(q) ||
              (v.size || '').toLowerCase().includes(q)
          ));

      const matchesCat =
        selectedCategory === 'all' ||
        (p.category || '').trim().toLowerCase() === selectedCategory.trim().toLowerCase();

      let matchesStock = true;
      if (stockFilter === 'low') matchesStock = p.currentStock > 0 && p.currentStock <= p.minStockAlert;
      else if (stockFilter === 'out') matchesStock = p.currentStock <= 0;
      else if (stockFilter === 'normal') matchesStock = p.currentStock > p.minStockAlert;

      return matchesSearch && matchesCat && matchesStock;
    });
  }, [products, searchQuery, selectedCategory, stockFilter, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Top Header & Actions */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span className="p-1.5 rounded-[8px] bg-[#6366F1]/15 text-[#6366F1]">
              <Package className="w-5 h-5" />
            </span>
            <span>{'Product Catalog & Inventory'}</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {`${activeProductsCount} active · ${products.length} total products · Instantly available for POS sales & stock`}
          </p>
        </div>

        {canCreateProduct && (
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-3.5 py-2 text-xs md:text-sm font-semibold text-white bg-[#6366F1] hover:brightness-110 rounded-[10px] shadow-xs transition-all self-start md:self-auto cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{'Add New Product'}</span>
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-col sm:flex-row items-center gap-2 text-xs">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={'Search by product name, code, barcode...'}
            className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-50/50"
          />
        </div>

        {/* Category Filter */}
        <select
          aria-label={'Filter by category'}
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="w-full sm:w-auto py-1.5 px-3 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium text-slate-700"
        >
          <option value="all">{'All Categories'}</option>
          {categoriesList.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {/* Stock Filter */}
        <select
          aria-label={'Filter by stock status'}
          value={stockFilter}
          onChange={(e) => setStockFilter(e.target.value as any)}
          className="w-full sm:w-auto py-1.5 px-3 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium text-slate-700"
        >
          <option value="all">{'All Stock'}</option>
          <option value="normal">{'Normal Stock'}</option>
          <option value="low">{'Low Stock'}</option>
          <option value="out">{'Out of Stock'}</option>
        </select>

        {/* Status Filter (Active / Inactive) */}
        <select
          aria-label={'Status'}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="w-full sm:w-auto py-1.5 px-3 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium text-slate-700"
        >
          <option value="active">{'Active Products'}</option>
          <option value="inactive">{'Archived / Inactive'}</option>
          <option value="all">{'All'}</option>
        </select>
      </div>

      {/* Product Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">{'Product Info'}</th>
                <th className="px-4 py-3 font-semibold">{'Code / Barcode'}</th>
                <th className="px-4 py-3 font-semibold">{'Category'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Cost'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Price'}</th>
                <th className="px-4 py-3 font-semibold text-center">{'Stock'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.map(product => {
                const isOutOfStock = product.currentStock <= 0;
                const isLowStock = product.currentStock > 0 && product.currentStock <= product.minStockAlert;
                const margin = product.salePrice > 0
                  ? Math.round(((product.salePrice - product.purchasePrice) / product.salePrice) * 100)
                  : 0;

                return (
                  <React.Fragment key={product.id}>
                    <tr
                      className={`transition-colors ${product.isActive === false ? 'bg-slate-50/60 opacity-60' : 'hover:bg-slate-50/80'}`}
                    >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {product.hasVariants && product.variants && product.variants.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleExpandVariants(product.id)}
                            className="p-1 hover:bg-slate-200 rounded text-slate-500 cursor-pointer"
                            title="Expand variant breakdown"
                          >
                            {expandedProductIds[product.id] ? (
                              <ChevronUp className="w-3.5 h-3.5 text-purple-600" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                        <span className="font-semibold text-slate-900 leading-tight">
                          {product.name}
                        </span>
                        {product.isActive === false && (
                          <span className="text-[10px] bg-slate-200 text-slate-700 px-1 py-0.2 rounded font-medium">
                            {'Archived'}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-600 flex items-center gap-2 mt-0.5">
                        {product.brand && <span>Brand: {product.brand}</span>}
                        {product.hasVariants && (
                          <span
                            onClick={() => toggleExpandVariants(product.id)}
                            className="text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-1.5 py-0.2 rounded font-medium text-[10px] cursor-pointer flex items-center gap-1"
                          >
                            <span>{product.variants?.length} Variants</span>
                            {expandedProductIds[product.id] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </span>
                        )}
                        {product.model && <span>Model: {product.model}</span>}
                      </div>
                    </td>

                    <td className="px-4 py-3 font-mono">
                      <span className="font-medium text-slate-800 block">{product.code}</span>
                      <span className="text-[10px] text-slate-600 block">{product.barcode}</span>
                    </td>

                    <td className="px-4 py-3 text-slate-700">
                      <span>{product.category}</span>
                      {product.subcategory && (
                        <span className="text-[10px] text-slate-600 block">{product.subcategory}</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right font-mono-num text-slate-700">
                      {formatCurrency(product.purchasePrice, lang)}
                    </td>

                    <td className="px-4 py-3 text-right font-mono-num font-bold text-slate-900">
                      <div className="flex items-center justify-end gap-1">
                        <span>{formatCurrency(product.salePrice, lang)}</span>
                        {product.salePrice > 0 && product.salePrice < (product.totalUnitCost || product.purchasePrice) && (
                          <span className="text-[9px] bg-rose-100 text-rose-800 px-1 py-0.2 rounded font-bold" title="Priced below break-even cost!">
                            Loss
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-emerald-600 block font-normal">
                        Margin: {margin}%
                      </span>
                      {product.minSalePrice && (
                        <span className="text-[9px] text-slate-500 block font-mono font-normal">
                          Floor: ৳{product.minSalePrice}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 font-mono-num font-bold text-xs px-2 py-0.5 rounded-md ${
                          isOutOfStock
                            ? 'bg-rose-50 text-rose-700'
                            : isLowStock
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {isLowStock && <AlertTriangle className="w-3 h-3" />}
                        {toBnNumber(product.currentStock)} {product.unit}
                      </span>
                      {isOutOfStock && (
                        <span className="block text-[9px] text-rose-600 font-medium mt-0.5">
                          {'Out of stock'}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {canPrintBarcode && (
                          <button
                            onClick={() => {
                              setBarcodeModalProduct(product);
                              setSelectedVariantId(
                                product.hasVariants && product.variants && product.variants.length > 0
                                  ? product.variants[0].id
                                  : 'base'
                              );
                              setLabelCopies(1);
                              setLabelTemplate(getPrinterSettings(settings).labelTemplate || '40x30');
                              setLabelPrintError(null);
                            }}
                            className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                            title={'Barcode & Label'}
                          >
                            <Barcode className="w-4 h-4" />
                          </button>
                        )}
                        {canEditProduct && (
                          <button
                            onClick={() => handleOpenEdit(product)}
                            className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                            title={'Edit'}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        {canDeleteProduct && (
                          product.isActive === false ? (
                            <>
                              <button
                                onClick={async () => {
                                  try {
                                    await updateProduct(product.id, { isActive: true });
                                  } catch (err: any) {
                                    alert(`Failed to reactivate product: ${err.message || 'Database error'}`);
                                  }
                                }}
                                className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded transition-colors"
                                title={'Reactivate'}
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                              <button
                                onClick={async () => {
                                  if (confirm(`Permanently delete '${product.name}'? This cannot be undone.`)) {
                                    try {
                                      await deleteProduct(product.id, true);
                                    } catch (err: any) {
                                      alert(`Failed to permanently delete product: ${err.message || 'Database error'}`);
                                    }
                                  }
                                }}
                                className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                                title={'Delete Permanently'}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={async () => {
                                if (confirm(`Archive '${product.name}'? (You can reactivate or permanently delete it from Archived filter)`)) {
                                  try {
                                    await deleteProduct(product.id);
                                  } catch (err: any) {
                                    alert(`Failed to delete product: ${err.message || 'Database error'}`);
                                  }
                                }
                              }}
                              className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                              title={'Archive / Delete'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                  {product.hasVariants && product.variants && expandedProductIds[product.id] && (
                    <tr key={`${product.id}-variants`} className="bg-purple-50/40 border-b border-purple-200">
                      <td colSpan={7} className="p-3 pl-8">
                        <div className="bg-white rounded-xl border border-purple-200 p-3 shadow-xs space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-purple-950 pb-1 border-b border-purple-100">
                            <span className="flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                              <span>{product.name} — Size &amp; Color Inventory Breakdown</span>
                            </span>
                            <span className="font-mono text-[11px] text-purple-700">
                              Total: {product.currentStock} pcs across {product.variants.length} combinations
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 pt-1">
                            {product.variants.map((v) => (
                              <div
                                key={v.id}
                                className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex flex-col justify-between space-y-1 text-xs"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-slate-900">{v.color || 'Standard'}</span>
                                  <span className="font-mono font-bold text-[10px] px-1.5 py-0.2 bg-purple-100 text-purple-800 rounded">
                                    {v.size || 'Free'}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono truncate" title={v.sku}>
                                  SKU: {v.sku}
                                </div>
                                <div className="flex items-center justify-between pt-1 border-t border-slate-200 text-[11px]">
                                  <span className="font-bold text-slate-900">
                                    ৳{v.salePrice !== undefined ? v.salePrice : product.salePrice}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold font-mono ${
                                      v.stock <= 0
                                        ? 'bg-rose-100 text-rose-700'
                                        : v.stock <= (v.minStockAlert || 5)
                                        ? 'bg-amber-100 text-amber-700'
                                        : 'bg-emerald-100 text-emerald-800'
                                    }`}
                                  >
                                    {v.stock} pcs
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}

              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                    {'No products found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl overflow-hidden my-6">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-sm md:text-base text-slate-900 flex items-center gap-2">
                <Package className="w-5 h-5 text-emerald-600" />
                <span>
                  {editingProduct
                    ? ('Edit Product')
                    : ('Add New Product')}
                </span>
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* Business Type Selector for Adaptive Fields */}
              <div className="p-3 bg-emerald-50/50 border border-emerald-200/80 rounded-xl flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800 block">
                    {'Business Type Adaptive Mode'}
                  </span>
                  <span className="text-[11px] text-slate-600">
                    {'Form fields adapt to your shop category'}
                  </span>
                </div>
                <select
                  aria-label={'Select Business Type'}
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                  className="py-1 px-2.5 bg-white border border-emerald-300 rounded-lg text-xs font-semibold text-emerald-900 focus:outline-none"
                >
                  <option value="clothing">{'Clothing / Fashion'}</option>
                  <option value="grocery">{'Grocery / Super Shop'}</option>
                  <option value="electronics">{'Electronics / Mobile'}</option>
                  <option value="pharmacy">{'Pharmacy'}</option>
                  <option value="general">{'General Retail'}</option>
                </select>
              </div>

              {/* Basic Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    {'Product Name *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Test Product"
                    className="w-full p-2 border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {'Product Code / SKU *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="TEST-001"
                    className="w-full p-2 border border-slate-200 rounded-lg font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {'Barcode *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="894101001"
                    className="w-full p-2 border border-slate-200 rounded-lg font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium text-slate-700">
                      {'Category *'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowNewCatInput(prev => !prev)}
                      className="text-[11px] text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-0.5"
                    >
                      <FolderPlus className="w-3 h-3" />
                      <span>{showNewCatInput ? ('List') : ('+ New Cat')}</span>
                    </button>
                  </div>

                  {showNewCatInput ? (
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleCreateCategory();
                          }
                        }}
                        placeholder={'New category name...'}
                        className="flex-1 p-2 border border-emerald-300 rounded-lg focus:outline-none text-xs"
                      />
                      <button
                        type="button"
                        onClick={handleCreateCategory}
                        className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg font-bold text-xs"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <select
                      aria-label={'Category'}
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full p-2 border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none bg-white font-medium"
                    >
                      {categoriesList.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {'Brand'}
                  </label>
                  <input
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="e.g. Apex, Samsung, Teer"
                    className="w-full p-2 border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Pricing Section */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <span className="font-bold text-slate-800 block">
                  {'Pricing Details'}
                </span>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {'Purchase Cost *'}
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={purchasePrice}
                      onChange={(e) => setPurchasePrice(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="100"
                      className="w-full p-2 border border-slate-200 rounded-lg font-mono-num focus:ring-1 focus:ring-emerald-500 focus:outline-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {'Sale Price *'}
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={salePrice}
                      onChange={(e) => setSalePrice(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="150"
                      className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold text-emerald-800 focus:ring-1 focus:ring-emerald-500 focus:outline-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {'Min Safe Price (Floor)'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={minSalePrice}
                      onChange={(e) => setMinSalePrice(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="120"
                      className="w-full p-2 border border-slate-200 rounded-lg font-mono-num text-rose-800 font-semibold focus:ring-1 focus:ring-rose-500 focus:outline-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {'Wholesale Price'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={wholesalePrice}
                      onChange={(e) => setWholesalePrice(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="130"
                      className="w-full p-2 border border-slate-200 rounded-lg font-mono-num focus:ring-1 focus:ring-emerald-500 focus:outline-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {'Unit'}
                    </label>
                    <select
                      aria-label={'Unit'}
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      className="w-full p-2 border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none bg-white"
                    >
                      <option value="pcs">Pcs</option>
                      <option value="kg">Kg</option>
                      <option value="bag">Bag</option>
                      <option value="bottle">Bottle</option>
                      <option value="box">Box</option>
                      <option value="meter">Meter</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Stock Details */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <span className="font-bold text-slate-800 block">
                  {'Stock Management'}
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {'Opening / Current Stock *'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      disabled={hasVariants}
                      value={hasVariants ? variants.reduce((s, v) => s + (Number(v.stock) || 0), 0) : currentStock}
                      onChange={(e) => setCurrentStock(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="20"
                      className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold focus:ring-1 focus:ring-emerald-500 focus:outline-none bg-white disabled:bg-slate-100"
                    />
                    {hasVariants && (
                      <span className="text-[10px] text-blue-600 mt-0.5 block">
                        {'Sum of variant stocks'}
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {'Low Stock Alert'}
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={minStockAlert}
                      onChange={(e) => setMinStockAlert(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="5"
                      className="w-full p-2 border border-slate-200 rounded-lg font-mono-num focus:ring-1 focus:ring-emerald-500 focus:outline-none bg-white"
                    />
                  </div>
                </div>

                {/* Clothing & Apparel Variants Toggle & Matrix Generator */}
                <div className="pt-2 border-t border-slate-200">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasVariants}
                      onChange={(e) => setHasVariants(e.target.checked)}
                      className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="font-semibold text-slate-800 text-xs flex items-center gap-1.5">
                      <span>Enable Size &amp; Color Variants</span>
                      <span className="px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 text-[10px] font-bold">
                        Apparel Matrix
                      </span>
                    </span>
                  </label>

                  {hasVariants && (
                    <div className="mt-3">
                      <VariantMatrixGenerator
                        productName={name}
                        category={category}
                        basePurchasePrice={Number(purchasePrice) || 0}
                        baseSalePrice={Number(salePrice) || 0}
                        variants={variants}
                        onChange={setVariants}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Action Buttons */}
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  {'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingProduct}
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg shadow-xs cursor-pointer"
                >
                  {isSubmittingProduct
                    ? 'Saving...'
                    : editingProduct
                    ? 'Save Changes'
                    : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Barcode & Label Print Modal */}
      {barcodeModalProduct && (() => {
        const activeVariant =
          barcodeModalProduct.hasVariants && barcodeModalProduct.variants
            ? barcodeModalProduct.variants.find(v => v.id === selectedVariantId)
            : undefined;
        const targetBarcode = activeVariant?.barcode || barcodeModalProduct.barcode || activeVariant?.sku || barcodeModalProduct.code;
        const targetSku = activeVariant?.sku || barcodeModalProduct.code;
        const targetPrice = activeVariant?.salePrice !== undefined ? activeVariant.salePrice : barcodeModalProduct.salePrice;
        const targetVariantLabel = activeVariant
          ? [activeVariant.color, activeVariant.size].filter(Boolean).join(' / ')
          : undefined;

        const printerCfg = getPrinterSettings(settings);
        const modalLabelConfig: LabelConfig = {
          template: labelTemplate,
          customWidthMm: printerCfg.labelWidthMm,
          customHeightMm: printerCfg.labelHeightMm,
          showShopName: true,
          showShopLogo: Boolean(settings.logoUrl),
          showProductName: true,
          showVariantDetails: true,
          showPrice: true,
          showSku: true,
          showBarcodeNumber: true,
          barcodeFormat: labelFormat,
          copiesPerItem: labelCopies,
        };

        const modalPrintItems = [
          {
            productId: barcodeModalProduct.id,
            productName: barcodeModalProduct.name,
            variantDetails: targetVariantLabel,
            sku: targetSku,
            barcode: targetBarcode,
            price: targetPrice,
            copies: Math.max(1, labelCopies),
          },
        ];

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4">
              <div className="flex justify-between items-center border-b pb-2">
                <h3 className="font-bold text-sm text-slate-900 truncate pr-2">
                  {barcodeModalProduct.name}
                </h3>
                <button
                  type="button"
                  onClick={() => setBarcodeModalProduct(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {labelPrintError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{labelPrintError}</span>
                </div>
              )}

              {/* Live Barcode Card */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col items-center justify-center space-y-1.5 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {getBusinessDisplayName(settings)}
                </span>
                {targetVariantLabel && (
                  <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-[10px] font-bold font-mono">
                    {targetVariantLabel}
                  </span>
                )}
                <BarcodeSvg
                  value={targetBarcode}
                  width={220}
                  height={52}
                  showText={true}
                  format={labelFormat}
                />
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-[11px] text-slate-500 font-mono">SKU: {targetSku}</span>
                  <span className="font-bold text-emerald-700 font-mono-num">
                    {formatCurrency(targetPrice, lang)}
                  </span>
                </div>
              </div>

              {/* Print Options */}
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                {barcodeModalProduct.hasVariants && barcodeModalProduct.variants && barcodeModalProduct.variants.length > 0 && (
                  <div className="col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">Variant</label>
                    <select
                      value={selectedVariantId}
                      onChange={e => setSelectedVariantId(e.target.value)}
                      className="w-full p-2 border border-slate-200 rounded-lg bg-white text-xs"
                    >
                      {barcodeModalProduct.variants.map(v => (
                        <option key={v.id} value={v.id}>
                          {[v.color, v.size].filter(Boolean).join(' / ') || 'Variant'} — {v.sku} (Stock: {v.stock})
                        </option>
                      ))}
                      <option value="base">Base Product ({barcodeModalProduct.code})</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Label Size</label>
                  <select
                    value={labelTemplate}
                    onChange={e => setLabelTemplate(e.target.value as LabelTemplateId)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white text-xs"
                  >
                    <option value="30x20">30 × 20 mm Roll</option>
                    <option value="40x30">40 × 30 mm Roll</option>
                    <option value="50x25">50 × 25 mm Roll</option>
                    <option value="50x30">50 × 30 mm Roll</option>
                    <option value="a4_sheet">A4 Sticker Sheet</option>
                    <option value="custom">Custom ({printerCfg.labelWidthMm}×{printerCfg.labelHeightMm}mm)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Barcode Type</label>
                  <select
                    value={labelFormat}
                    onChange={e => setLabelFormat(e.target.value as BarcodeFormat)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white text-xs"
                  >
                    <option value="CODE128">Code 128</option>
                    <option value="EAN13">EAN-13</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Number of Labels</label>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={labelCopies}
                    onChange={e => setLabelCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setBarcodeModalProduct(null)}
                  className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLabelPrintError(null);
                    setLabelPreviewPayload(previewProductLabel(modalPrintItems, modalLabelConfig, settings));
                  }}
                  className="flex items-center justify-center gap-1.5 flex-1 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Preview</span>
                </button>
                <button
                  type="button"
                  disabled={isPrintingLabel}
                  onClick={() => {
                    if (isPrintingLabel) return;
                    setLabelPrintError(null);
                    setIsPrintingLabel(true);
                    try {
                      const res = printProductLabel(modalPrintItems, modalLabelConfig, settings);
                      if (!res.opened && !res.cancelled) {
                        setLabelPrintError(res.error || 'Unable to open browser print dialog.');
                      }
                    } catch (err: any) {
                      setLabelPrintError(err?.message || 'Unexpected error while preparing label print.');
                    } finally {
                      setIsPrintingLabel(false);
                    }
                  }}
                  className="flex items-center justify-center gap-1.5 flex-1 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-60 rounded-lg shadow-xs cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{isPrintingLabel ? 'Preparing...' : 'Print Tag'}</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {labelPreviewPayload && (
        <PrintPreviewModal
          isOpen={Boolean(labelPreviewPayload)}
          title={labelPreviewPayload.title}
          html={labelPreviewPayload.html}
          paperInfo={labelPreviewPayload.paperInfo}
          showScaleGuidance={labelPreviewPayload.showScaleGuidance}
          onClose={() => setLabelPreviewPayload(null)}
        />
      )}
    </div>
  );
};
