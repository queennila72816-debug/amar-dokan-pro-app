import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Product, ProductVariant, Supplier, ReorderSuggestion, DraftPurchaseOrder, Purchase } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { ComboboxOption, SearchableCombobox } from '../common/SearchableCombobox';
import {
  Bell,
  TrendingUp,
  AlertTriangle,
  Package,
  ShoppingCart,
  Truck,
  Layers,
  Filter,
  CheckCircle2,
  Calendar,
  X,
  FileSpreadsheet,
  Download,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

export const SmartReorderView: React.FC = () => {
  const { products, sales, suppliers, recordPurchase, activeBranchId, branches } = useApp();

  // Settings for formulas
  const [analysisDays, setAnalysisDays] = useState<number>(30); // 7, 14, 30 days
  const [defaultLeadTimeDays, setDefaultLeadTimeDays] = useState<number>(7); // days to deliver
  const [defaultSafetyStockDays, setDefaultSafetyStockDays] = useState<number>(5); // buffer days
  const [orderCycleDays, setOrderCycleDays] = useState<number>(14); // target days of stock

  // Filter
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'critical' | 'low' | 'healthy'>('critical');
  const [selectedSupplierFilter, setSelectedSupplierFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Draft Purchase Order Modal State
  const [isDraftPoModalOpen, setIsDraftPoModalOpen] = useState(false);
  const [draftItems, setDraftItems] = useState<{
    productId: string;
    productName: string;
    variantId?: string;
    variantDetails?: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[]>([]);
  const [poSupplierId, setPoSupplierId] = useState<string>('');
  const [poNotes, setPoNotes] = useState('');
  const [isCreatingPo, setIsCreatingPo] = useState(false);

  const supplierOptions: ComboboxOption[] = useMemo(
    () =>
      suppliers.map(s => ({
        id: s.id,
        label: s.company ? `${s.company} (${s.name})` : s.name,
        sublabel: s.mobile || s.address || undefined,
        badge: s.currentDue > 0 ? `Due: ${formatCurrency(s.currentDue, 'en')}` : undefined,
        searchText: `${s.name} ${s.company || ''} ${s.mobile || ''}`,
      })),
    [suppliers]
  );

  // 1. Calculate sales velocity per product and variant
  // Map of `${productId}_${variantId || 'main'}` -> total units sold in analysis period
  const salesVelocityMap = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - analysisDays);

    const counts: Record<string, number> = {};

    sales.forEach(sale => {
      const saleDate = new Date(sale.date);
      if (saleDate >= cutoffDate) {
        sale.items.forEach(item => {
          const key = item.variantId ? `${item.productId}_${item.variantId}` : `${item.productId}_main`;
          counts[key] = (counts[key] || 0) + item.quantity;
        });
      }
    });

    return counts;
  }, [sales, analysisDays]);

  // 2. Generate Reorder Suggestions for every variant or standalone product
  const reorderSuggestions: ReorderSuggestion[] = useMemo(() => {
    const list: ReorderSuggestion[] = [];

    products.forEach(p => {
      if (p.isActive === false) return;

      const leadDays = p.leadTimeDays || defaultLeadTimeDays;
      const supplier = suppliers.find(s => s.id === p.supplierId) || suppliers[0];

      if (p.hasVariants && p.variants && p.variants.length > 0) {
        p.variants.forEach(v => {
          const key = `${p.id}_${v.id}`;
          const unitsSold = salesVelocityMap[key] || 0;
          const dailySalesRate = Math.round((unitsSold / Math.max(1, analysisDays)) * 100) / 100;

          // Reorder point = (daily sales * lead time) + safety stock
          const safetyStock = Math.ceil(dailySalesRate * defaultSafetyStockDays) || (v.minStockAlert || 5);
          const reorderPoint = Math.ceil(dailySalesRate * leadDays) + safetyStock;

          // Target stock for full cycle
          const targetStock = Math.ceil(dailySalesRate * (leadDays + orderCycleDays)) + safetyStock;
          const suggestedOrderQty = Math.max(0, targetStock - v.stock);

          let status: ReorderSuggestion['status'] = 'healthy';
          if (v.stock <= 0) {
            status = 'out_of_stock';
          } else if (v.stock <= (v.minStockAlert || 5) || v.stock <= reorderPoint) {
            status = 'critical';
          } else if (v.stock > targetStock * 2 && v.stock > 20) {
            status = 'overstocked';
          }

          const unitCost = v.purchasePrice !== undefined ? v.purchasePrice : p.purchasePrice;

          list.push({
            productId: p.id,
            productName: p.name,
            category: p.category,
            variantId: v.id,
            variantDetails: [v.color, v.size].filter(Boolean).join(' / '),
            sku: v.sku || `${p.code}-${v.id}`,
            barcode: v.barcode || p.barcode,
            currentStock: v.stock,
            minStockAlert: v.minStockAlert || 5,
            dailySalesRate,
            leadTimeDays: leadDays,
            safetyStock,
            reorderPoint,
            suggestedOrderQty: suggestedOrderQty > 0 ? suggestedOrderQty : (v.stock <= 0 ? 10 : 0),
            unitPurchasePrice: unitCost,
            estimatedCost: (suggestedOrderQty > 0 ? suggestedOrderQty : (v.stock <= 0 ? 10 : 0)) * unitCost,
            supplierId: p.supplierId || supplier?.id,
            supplierName: supplier?.name || p.supplierName || 'Primary Supplier',
            status,
          });
        });
      } else {
        const key = `${p.id}_main`;
        const unitsSold = salesVelocityMap[key] || 0;
        const dailySalesRate = Math.round((unitsSold / Math.max(1, analysisDays)) * 100) / 100;

        const safetyStock = Math.ceil(dailySalesRate * defaultSafetyStockDays) || p.minStockAlert;
        const reorderPoint = Math.ceil(dailySalesRate * leadDays) + safetyStock;
        const targetStock = Math.ceil(dailySalesRate * (leadDays + orderCycleDays)) + safetyStock;
        const suggestedOrderQty = Math.max(0, targetStock - p.currentStock);

        let status: ReorderSuggestion['status'] = 'healthy';
        if (p.currentStock <= 0) {
          status = 'out_of_stock';
        } else if (p.currentStock <= p.minStockAlert || p.currentStock <= reorderPoint) {
          status = 'critical';
        } else if (p.currentStock > targetStock * 2 && p.currentStock > 20) {
          status = 'overstocked';
        }

        list.push({
          productId: p.id,
          productName: p.name,
          category: p.category,
          variantDetails: p.size || p.color ? [p.color, p.size].filter(Boolean).join(' / ') : undefined,
          sku: p.code,
          barcode: p.barcode,
          currentStock: p.currentStock,
          minStockAlert: p.minStockAlert,
          dailySalesRate,
          leadTimeDays: leadDays,
          safetyStock,
          reorderPoint,
          suggestedOrderQty: suggestedOrderQty > 0 ? suggestedOrderQty : (p.currentStock <= 0 ? 10 : 0),
          unitPurchasePrice: p.purchasePrice,
          estimatedCost: (suggestedOrderQty > 0 ? suggestedOrderQty : (p.currentStock <= 0 ? 10 : 0)) * p.purchasePrice,
          supplierId: p.supplierId || supplier?.id,
          supplierName: supplier?.name || p.supplierName || 'Primary Supplier',
          status,
        });
      }
    });

    return list;
  }, [products, salesVelocityMap, analysisDays, defaultLeadTimeDays, defaultSafetyStockDays, orderCycleDays, suppliers]);

  // Filtered Suggestions
  const filteredSuggestions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return reorderSuggestions.filter(item => {
      const matchSearch =
        !q ||
        item.productName.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.variantDetails && item.variantDetails.toLowerCase().includes(q));

      const matchSupplier =
        selectedSupplierFilter === 'all' || item.supplierId === selectedSupplierFilter;

      const matchUrgency =
        urgencyFilter === 'all' ||
        (urgencyFilter === 'critical' && (item.status === 'out_of_stock' || item.status === 'critical')) ||
        (urgencyFilter === 'low' && item.status === 'low') ||
        (urgencyFilter === 'healthy' && item.status === 'healthy');

      return matchSearch && matchSupplier && matchUrgency;
    });
  }, [reorderSuggestions, searchQuery, selectedSupplierFilter, urgencyFilter]);

  // Critical counts
  const outOfStockCount = reorderSuggestions.filter(s => s.status === 'out_of_stock').length;
  const criticalCount = reorderSuggestions.filter(s => s.status === 'critical' || s.status === 'out_of_stock').length;
  const totalSuggestedCost = filteredSuggestions.reduce((sum, s) => sum + s.estimatedCost, 0);

  // Open Draft PO Generator
  const handleOpenDraftPO = () => {
    const lowStockItems = filteredSuggestions.filter(s => s.status === 'out_of_stock' || s.status === 'critical');
    const itemsToOrder = lowStockItems.map(item => ({
      productId: item.productId,
      productName: item.productName,
      variantId: item.variantId,
      variantDetails: item.variantDetails,
      sku: item.sku,
      quantity: Math.max(5, item.suggestedOrderQty),
      unitPrice: item.unitPurchasePrice,
      total: Math.max(5, item.suggestedOrderQty) * item.unitPurchasePrice,
    }));

    setDraftItems(itemsToOrder);
    setPoSupplierId(suppliers[0]?.id || '');
    setPoNotes('Auto-generated based on sales velocity and minimum stock alert levels.');
    setIsDraftPoModalOpen(true);
  };

  // Convert Draft PO directly into Purchase
  const handleConfirmPurchase = async () => {
    if (draftItems.length === 0 || isCreatingPo) return;

    const supplier = suppliers.find(s => s.id === poSupplierId) || suppliers[0];
    if (!supplier) {
      alert('Please create or select a supplier before creating a Purchase Order.');
      return;
    }

    const subtotal = draftItems.reduce((sum, i) => sum + i.total, 0);

    const purchasePayload = {
      supplierId: supplier.id,
      supplierName: supplier.company || supplier.name,
      items: draftItems.map(item => ({
        productId: item.productId,
        productName: item.productName,
        variantId: item.variantId,
        variantDetails: item.variantDetails,
        quantity: item.quantity,
        purchasePrice: item.unitPrice,
        total: item.total,
      })),
      subtotal,
      discount: 0,
      transportCost: 0,
      otherCost: 0,
      total: subtotal,
      paid: subtotal,
      due: 0,
      paymentMethod: 'cash' as const,
      branchId: activeBranchId || branches[0]?.id || '',
      notes: poNotes,
    };

    setIsCreatingPo(true);
    try {
      await recordPurchase(purchasePayload);
      setIsDraftPoModalOpen(false);
      alert('Purchase successfully created! Product and variant inventory levels have been updated.');
    } catch (err: any) {
      alert(err?.message || 'Failed to create purchase order in database.');
    } finally {
      setIsCreatingPo(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-rose-50 text-rose-700">
              <Bell className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-slate-900">Smart Reorder &amp; Stock Velocity Alert</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Automated procurement calculations based on variant-level sales velocity and supplier lead times.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleOpenDraftPO}
            disabled={criticalCount === 0}
            className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Generate Draft PO ({criticalCount} Low Items)</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Out of Stock Variants
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-rose-600 font-mono-num">
              {outOfStockCount}
            </span>
            <span className="text-xs text-rose-500 font-semibold">Immediate reorder required</span>
          </div>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Critical &amp; Low Stock
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-amber-600 font-mono-num">
              {criticalCount}
            </span>
            <span className="text-xs text-slate-500">Below Reorder Point</span>
          </div>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Avg Velocity Period
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-slate-900 font-mono-num">
              {analysisDays} Days
            </span>
            <span className="text-xs text-indigo-600 font-semibold">Rolling sales history</span>
          </div>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Est. Replenishment Cost
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-emerald-700 font-mono-num">
              {formatCurrency(totalSuggestedCost, 'en')}
            </span>
          </div>
        </div>
      </div>

      {/* Parameters & Filters Bar */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <span>Procurement Planning Parameters:</span>
          </div>

          {/* Quick tuning inputs */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
            <label className="flex items-center gap-1.5">
              <span>Sales History:</span>
              <select
                value={analysisDays}
                onChange={e => setAnalysisDays(Number(e.target.value))}
                className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
              >
                <option value={7}>Last 7 Days</option>
                <option value={14}>Last 14 Days</option>
                <option value={30}>Last 30 Days</option>
                <option value={60}>Last 60 Days</option>
              </select>
            </label>

            <label className="flex items-center gap-1.5">
              <span>Lead Time:</span>
              <input
                type="number"
                min="1"
                max="60"
                value={defaultLeadTimeDays}
                onChange={e => setDefaultLeadTimeDays(Number(e.target.value) || 7)}
                className="w-14 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-center"
              />
              <span>days</span>
            </label>

            <label className="flex items-center gap-1.5">
              <span>Safety Buffer:</span>
              <input
                type="number"
                min="1"
                max="30"
                value={defaultSafetyStockDays}
                onChange={e => setDefaultSafetyStockDays(Number(e.target.value) || 5)}
                className="w-14 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-center"
              />
              <span>days</span>
            </label>
          </div>
        </div>

        {/* Filter inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-6 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search product, SKU, variant..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white"
            />
            <Package className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>

          <div className="sm:col-span-3">
            <select
              value={urgencyFilter}
              onChange={e => setUrgencyFilter(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"
            >
              <option value="critical">Critical / Out of Stock</option>
              <option value="all">All Inventory Statuses</option>
              <option value="healthy">Healthy Stock Only</option>
            </select>
          </div>

          <div className="sm:col-span-3">
            <select
              value={selectedSupplierFilter}
              onChange={e => setSelectedSupplierFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"
            >
              <option value="all">All Preferred Suppliers</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Reorder Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
              <tr>
                <th className="py-3 px-3">Product &amp; Variant</th>
                <th className="py-3 px-3">SKU</th>
                <th className="py-3 px-3">Current Stock</th>
                <th className="py-3 px-3">Daily Velocity</th>
                <th className="py-3 px-3">Reorder Point</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Suggested Order</th>
                <th className="py-3 px-3">Unit Cost</th>
                <th className="py-3 px-3 text-right">Est. Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSuggestions.map((item, idx) => {
                return (
                  <tr key={`${item.productId}-${item.variantId || idx}`} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-900">{item.productName}</div>
                      {item.variantDetails && (
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                          {item.variantDetails}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">{item.sku}</td>
                    <td className="py-2.5 px-3 font-mono">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.currentStock <= 0
                            ? 'bg-rose-100 text-rose-700'
                            : item.currentStock <= item.reorderPoint
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {item.currentStock} pcs
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      {item.dailySalesRate > 0 ? (
                        <span className="font-semibold text-slate-800">
                          {item.dailySalesRate} pcs/day
                        </span>
                      ) : (
                        <span className="text-slate-400">0.0</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">
                      {item.reorderPoint} pcs
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                          item.status === 'out_of_stock'
                            ? 'bg-rose-600 text-white'
                            : item.status === 'critical'
                            ? 'bg-amber-500 text-white'
                            : item.status === 'overstocked'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {item.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-indigo-700">
                      +{item.suggestedOrderQty} pcs
                    </td>
                    <td className="py-2.5 px-3 font-mono-num text-slate-700">
                      {formatCurrency(item.unitPurchasePrice, 'en')}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold font-mono-num text-slate-900">
                      {formatCurrency(item.estimatedCost, 'en')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredSuggestions.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-400">
              No inventory alerts found matching criteria.
            </div>
          )}
        </div>
      </div>

      {/* Draft Purchase Order Modal */}
      {isDraftPoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b">
              <div>
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-rose-600" />
                  <span>Draft Purchase Order Generator</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Review replenishment quantities and supplier details before creating order.
                </p>
              </div>
              <button
                onClick={() => setIsDraftPoModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">Select Supplier</label>
                <SearchableCombobox
                  ariaLabel="Select Supplier"
                  options={supplierOptions}
                  value={poSupplierId}
                  onChange={setPoSupplierId}
                  placeholder="Type to search supplier..."
                  emptyMessage="No matching suppliers found"
                  size="sm"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700">Order Notes / PO Ref</label>
                <input
                  type="text"
                  value={poNotes}
                  onChange={e => setPoNotes(e.target.value)}
                  className="w-full mt-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {/* Editable Item Quantities */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="py-2 px-3">Item / Variant</th>
                    <th className="py-2 px-3 w-28 text-center">Order Qty</th>
                    <th className="py-2 px-3">Cost/pc</th>
                    <th className="py-2 px-3 text-right">Subtotal</th>
                    <th className="py-2 px-3 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draftItems.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-2 px-3">
                        <div className="font-bold text-slate-900">{item.productName}</div>
                        {item.variantDetails && (
                          <span className="text-[10px] text-slate-500 font-mono">
                            {item.variantDetails}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <input
                          type="number"
                          min="1"
                          max="1000"
                          value={item.quantity}
                          onChange={e => {
                            const newQty = Math.max(1, parseInt(e.target.value) || 1);
                            setDraftItems(prev =>
                              prev.map((it, i) =>
                                i === idx ? { ...it, quantity: newQty, total: newQty * it.unitPrice } : it
                              )
                            );
                          }}
                          className="w-16 px-2 py-1 text-center font-bold text-xs border border-slate-300 rounded-lg"
                        />
                      </td>
                      <td className="py-2 px-3 font-mono-num">{formatCurrency(item.unitPrice, 'en')}</td>
                      <td className="py-2 px-3 text-right font-mono-num font-bold">
                        {formatCurrency(item.total, 'en')}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => setDraftItems(prev => prev.filter((_, i) => i !== idx))}
                          className="text-rose-500 hover:text-rose-700"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total */}
            <div className="flex justify-between items-center pt-2">
              <span className="text-xs text-slate-500">
                Total Items: {draftItems.length}
              </span>
              <div className="text-right">
                <span className="text-xs text-slate-500 mr-2">Total Estimated PO:</span>
                <span className="text-base font-extrabold text-slate-900 font-mono-num">
                  {formatCurrency(draftItems.reduce((s, i) => s + i.total, 0), 'en')}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setIsDraftPoModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isCreatingPo}
                onClick={handleConfirmPurchase}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-xs"
              >
                {isCreatingPo ? 'Creating Purchase...' : 'Create Official Purchase Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
