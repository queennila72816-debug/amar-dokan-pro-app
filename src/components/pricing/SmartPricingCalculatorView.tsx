import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  BusinessType,
  ExpenseAllocationMethod,
  QualityTier,
  ProductCostingSheet,
  DirectPurchaseCostBreakdown,
  MonthlyOperatingBudget,
} from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { pricingService, defaultMonthlyBudget } from '../../services/pricingService';
import { printFinancialReport } from '../../utils/printEngine';
import {
  Calculator,
  Save,
  Printer,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Percent,
  Coins,
  ArrowRight,
  Info,
  ShieldCheck,
  Scale,
  Building,
  Truck,
  Package,
  Layers,
  HelpCircle,
} from 'lucide-react';

export const SmartPricingCalculatorView: React.FC = () => {
  const { products, addProduct, updateProduct, categories, settings, isAdmin, expenses } = useApp();
  const lang = settings.language;

  // Selected existing product or new calculation
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [productName, setProductName] = useState('');
  const [productSku, setProductSku] = useState('');
  const [productCategory, setProductCategory] = useState('Shirt');
  const [qualityTier, setQualityTier] = useState<QualityTier>('standard');

  // Purchase Batch inputs
  const [batchQuantity, setBatchQuantity] = useState<number>(50);
  const [unitPurchasePrice, setUnitPurchasePrice] = useState<number>(450);
  
  // Direct purchase costs breakdown
  const [transportCost, setTransportCost] = useState<number>(1000);
  const [loadingCost, setLoadingCost] = useState<number>(300);
  const [packagingCost, setPackagingCost] = useState<number>(500);
  const [otherCost, setOtherCost] = useState<number>(200);

  // Operating Expenses Budget
  const [monthlyBudget, setMonthlyBudget] = useState<MonthlyOperatingBudget>(() => {
    // If real business expenses exist, populate rent and salaries from actual expenses
    const rentExp = expenses.filter(e => e.category.toLowerCase().includes('rent')).reduce((s, e) => s + e.amount, 0);
    const salaryExp = expenses.filter(e => e.category.toLowerCase().includes('salary')).reduce((s, e) => s + e.amount, 0);
    return {
      ...defaultMonthlyBudget,
      shopRent: rentExp > 0 ? rentExp : defaultMonthlyBudget.shopRent,
      staffSalaries: salaryExp > 0 ? salaryExp : defaultMonthlyBudget.staffSalaries,
      allocationMethod: settings.expenseAllocationMethod || 'units_sold',
      expectedMonthlyUnitsSold: settings.defaultExpectedMonthlyUnits || 1000,
    };
  });

  const [showBudgetEditor, setShowBudgetEditor] = useState(false);
  const [allocationMethod, setAllocationMethod] = useState<ExpenseAllocationMethod>(
    settings.expenseAllocationMethod || 'units_sold'
  );
  const [manualOpExPerUnit, setManualOpExPerUnit] = useState<number>(40);

  // Profit Strategy
  const [profitMethod, setProfitMethod] = useState<'margin_percentage' | 'markup_percentage' | 'fixed_amount'>('margin_percentage');
  const [profitValue, setProfitValue] = useState<number>(settings.defaultTargetMarginPercent || 25); // 25% margin default

  // Tax & Selling Fees
  const [vatRate, setVatRate] = useState<number>(settings.vatTaxRate || 0);
  const [paymentFeeRate, setPaymentFeeRate] = useState<number>(0); // e.g. 1.5% for bKash or card

  // Market & Competitor Comparison
  const [localMarketPrice, setLocalMarketPrice] = useState<number | ''>(750);
  const [competitorPrice, setCompetitorPrice] = useState<number | ''>(800);
  const [plannedSellingPrice, setPlannedSellingPrice] = useState<number | ''>('');

  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [isSavingProduct, setIsSavingProduct] = useState(false);

  const availableCategories = useMemo(() => {
    const base = [
      'Shirt',
      'Pant',
      'T-Shirt',
      'Three-Piece',
      'Burqa',
      'Panjabi',
      'Saree',
      'Footwear',
      'Clothing',
      'General',
    ];
    const set = new Set<string>(base);
    categories.forEach(c => c.name && set.add(c.name));
    if (productCategory) set.add(productCategory);
    return Array.from(set);
  }, [categories, productCategory]);

  // Populate when an existing product is selected
  const handleSelectProduct = (productId: string) => {
    setSelectedProductId(productId);
    if (!productId) {
      setProductName('');
      setProductSku('');
      return;
    }
    const p = products.find(prod => prod.id === productId);
    if (p) {
      setProductName(p.name);
      setProductSku(p.code);
      setProductCategory(p.category || 'Shirt');
      setUnitPurchasePrice(p.purchasePrice || 0);
      if (p.directCosts) {
        setTransportCost(p.directCosts.transport || 0);
        setLoadingCost(p.directCosts.loading || 0);
        setPackagingCost(p.directCosts.packaging || 0);
        setOtherCost(p.directCosts.other || 0);
      }
      if (p.marketPrice) setLocalMarketPrice(p.marketPrice);
      if (p.competitorPrice) setCompetitorPrice(p.competitorPrice);
      if (p.qualityTier) setQualityTier(p.qualityTier);
      if (p.salePrice) setPlannedSellingPrice(p.salePrice);
    }
  };

  // Direct costs object
  const directCosts: DirectPurchaseCostBreakdown = useMemo(() => ({
    transport: Number(transportCost) || 0,
    loading: Number(loadingCost) || 0,
    packaging: Number(packagingCost) || 0,
    other: Number(otherCost) || 0,
  }), [transportCost, loadingCost, packagingCost, otherCost]);

  // Compute full pricing breakdown
  const costingSheet: ProductCostingSheet = useMemo(() => {
    return pricingService.computeFullPricing({
      batchQuantity: Number(batchQuantity) || 1,
      unitPurchasePrice: Number(unitPurchasePrice) || 0,
      directCosts,
      monthlyBudget,
      allocationMethod,
      manualOpExPerUnit: Number(manualOpExPerUnit) || 0,
      profitMethod,
      profitValue: Number(profitValue) || 0,
      vatRate: Number(vatRate) || 0,
      paymentFeeRate: Number(paymentFeeRate) || 0,
      localMarketPrice: localMarketPrice === '' ? undefined : Number(localMarketPrice),
      competitorPrice: competitorPrice === '' ? undefined : Number(competitorPrice),
      qualityTier,
      targetSellingPrice: plannedSellingPrice === '' ? undefined : Number(plannedSellingPrice),
    });
  }, [
    batchQuantity,
    unitPurchasePrice,
    directCosts,
    monthlyBudget,
    allocationMethod,
    manualOpExPerUnit,
    profitMethod,
    profitValue,
    vatRate,
    paymentFeeRate,
    localMarketPrice,
    competitorPrice,
    qualityTier,
    plannedSellingPrice,
  ]);

  // Effective selling price used for evaluation
  const effectivePrice = plannedSellingPrice !== '' ? Number(plannedSellingPrice) : costingSheet.recommendedSellingPrice;

  // Market comparison evaluation
  const comparison = useMemo(() => {
    return pricingService.evaluateComparison(
      costingSheet.recommendedSellingPrice,
      localMarketPrice === '' ? undefined : Number(localMarketPrice),
      competitorPrice === '' ? undefined : Number(competitorPrice),
      costingSheet.totalUnitCost,
      effectivePrice
    );
  }, [costingSheet, localMarketPrice, competitorPrice, effectivePrice]);

  // Save / Apply calculated pricing to catalog
  const handleSaveToCatalog = async () => {
    if (isSavingProduct) return;
    setSaveSuccessMsg(null);
    if (!productName.trim()) {
      alert('Please specify a product name before saving to catalog.');
      return;
    }

    const existingProd = selectedProductId ? products.find(p => p.id === selectedProductId) : undefined;
    const basePricingPayload = {
      name: productName.trim(),
      code: productSku.trim() || existingProd?.code || `PRD-${Date.now().toString().slice(-4)}`,
      category: productCategory,
      purchasePrice: costingSheet.landedCostPerUnit, // Landed cost as real stock purchase price
      salePrice: effectivePrice,
      minSalePrice: costingSheet.minSafeSellingPrice, // Minimum break-even floor for seller protection
      maxDiscountPercent: costingSheet.maxDiscountPercent,
      directCosts,
      landedCostPerUnit: costingSheet.landedCostPerUnit,
      allocatedOpExPerUnit: costingSheet.allocatedOpExPerUnit,
      totalUnitCost: costingSheet.totalUnitCost,
      recommendedSellingPrice: costingSheet.recommendedSellingPrice,
      qualityTier,
      marketPrice: localMarketPrice === '' ? undefined : Number(localMarketPrice),
      competitorPrice: competitorPrice === '' ? undefined : Number(competitorPrice),
    };

    setIsSavingProduct(true);
    try {
      if (selectedProductId && existingProd) {
        await updateProduct(selectedProductId, basePricingPayload);
        setSaveSuccessMsg(`Product "${productName}" pricing updated (existing stock preserved)!`);
      } else {
        await addProduct({
          ...basePricingPayload,
          barcode: `${Date.now().toString().slice(-8)}`,
          currentStock: Math.max(0, Number(batchQuantity) || 0),
          minStockAlert: 5,
          unit: 'pcs',
          businessType: (settings.businessType || 'clothing') as BusinessType,
          isActive: true,
        });
        setSaveSuccessMsg(`New product "${productName}" added to catalog with calculated fair pricing!`);
      }
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    } catch (err: any) {
      alert(`Failed to save product: ${err.message || 'Database error'}`);
    } finally {
      setIsSavingProduct(false);
    }
  };

  // Printable report sheet
  const handlePrintCostingSheet = () => {
    const res = printFinancialReport(
      `Product Costing Sheet: ${productName || 'New Item'}`,
      `Batch ${batchQuantity} pcs · ${qualityTier} grade`,
      [
        { label: '1. Supplier Purchase Price / Piece', value: formatCurrency(costingSheet.unitPurchasePrice, lang) },
        { label: '2. Direct Landed Costs / Piece (Transport, Loading, Packaging)', value: formatCurrency(costingSheet.landedCostPerUnit - costingSheet.unitPurchasePrice, lang) },
        { label: 'Landed Cost Per Unit', value: formatCurrency(costingSheet.landedCostPerUnit, lang), highlight: true },
        { label: '3. Allocated Monthly Shop Overhead / Piece', value: formatCurrency(costingSheet.allocatedOpExPerUnit, lang) },
        { label: 'Total Unit Cost (Break-Even Floor)', value: formatCurrency(costingSheet.totalUnitCost, lang), highlight: true },
        { label: '4. Desired Net Profit / Piece', value: formatCurrency(costingSheet.desiredProfitPerUnit, lang) },
        { label: `5. VAT / Tax (${costingSheet.vatRate}%)`, value: formatCurrency(costingSheet.vatAmount, lang) },
        { label: 'Recommended Fair Selling Price', value: formatCurrency(costingSheet.recommendedSellingPrice, lang), highlight: true },
        { label: 'Minimum Safe Selling Price', value: formatCurrency(costingSheet.minSafeSellingPrice, lang) },
        { label: 'Maximum Safe Discount %', value: `${costingSheet.maxDiscountPercent}%` },
      ],
      settings
    );
    if (!res.opened && res.error) {
      alert(res.error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm shadow-emerald-700/20 shrink-0">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <span>Smart Product Costing &amp; Fair Price Calculator</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                Landed Cost + OpEx Allocation
              </span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Calculate exact break-even costs, allocate shop overhead, define fair margins, and protect against loss-making sales.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrintCostingSheet}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl border border-slate-200 transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4 text-slate-600" />
            <span>Print Sheet</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              disabled={isSavingProduct}
              onClick={handleSaveToCatalog}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl shadow-sm shadow-emerald-700/20 active:scale-[0.98] transition-all cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isSavingProduct ? 'Saving...' : 'Apply & Save to Catalog'}</span>
            </button>
          )}
        </div>
      </div>

      {saveSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-2 no-print">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* Main Grid: Inputs Column (7 cols) + Live Costing & Price Breakdown (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: Inputs & Breakdown Steps */}
        <div className="lg:col-span-7 space-y-5">
          {/* Section 1: Product Selection / Identification */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-600" />
                <span>1. Product Details &amp; Category</span>
              </h2>
              {products.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-500">Load Existing:</span>
                  <select
                    value={selectedProductId}
                    onChange={e => handleSelectProduct(e.target.value)}
                    className="text-xs py-1 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">-- New Product Costing --</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Product Name *</label>
                <input
                  type="text"
                  required
                  value={productName}
                  onChange={e => setProductName(e.target.value)}
                  placeholder="e.g. Men's Cotton Formal Shirt / Slim Fit Pant"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Product Category *</label>
                <select
                  value={productCategory}
                  onChange={e => setProductCategory(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {availableCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">SKU / Code</label>
                <input
                  type="text"
                  value={productSku}
                  onChange={e => setProductSku(e.target.value)}
                  placeholder="e.g. SHIRT-101"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Fabric &amp; Quality Tier</label>
                <select
                  value={qualityTier}
                  onChange={e => setQualityTier(e.target.value as QualityTier)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 capitalize focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="economy">Economy (Budget)</option>
                  <option value="standard">Standard (Retail Quality)</option>
                  <option value="premium">Premium (Export Grade)</option>
                  <option value="luxury">Luxury / Exclusive Boutique</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Batch Purchase Quantity (Pcs) *</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={batchQuantity}
                  onChange={e => setBatchQuantity(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono-num font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Direct Purchase Costs & Landed Cost */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Truck className="w-4 h-4 text-emerald-600" />
                  <span>2. Purchase Batch &amp; Direct Landed Costs</span>
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Direct costs incurred specifically to bring this batch to the store.
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                Landed: ৳{costingSheet.landedCostPerUnit.toFixed(1)}/pc
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Supplier Purchase Price Per Piece (৳) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-bold">৳</span>
                  <input
                    type="number"
                    min="0"
                    required
                    value={unitPurchasePrice}
                    onChange={e => setUnitPurchasePrice(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono-num font-bold text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  Base invoice: ৳{(batchQuantity * unitPurchasePrice).toLocaleString()} total
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Batch Transport (৳)</label>
                <input
                  type="number"
                  min="0"
                  value={transportCost}
                  onChange={e => setTransportCost(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="0"
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-mono-num text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  ৳{(Number(transportCost) / batchQuantity).toFixed(1)}/pc
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Loading/Unloading (৳)</label>
                <input
                  type="number"
                  min="0"
                  value={loadingCost}
                  onChange={e => setLoadingCost(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="0"
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-mono-num text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  ৳{(Number(loadingCost) / batchQuantity).toFixed(1)}/pc
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Poly / Tags / Packaging (৳)</label>
                <input
                  type="number"
                  min="0"
                  value={packagingCost}
                  onChange={e => setPackagingCost(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="0"
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-mono-num text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  ৳{(Number(packagingCost) / batchQuantity).toFixed(1)}/pc
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Other Direct Costs (৳)</label>
                <input
                  type="number"
                  min="0"
                  value={otherCost}
                  onChange={e => setOtherCost(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="0"
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-mono-num text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  ৳{(Number(otherCost) / batchQuantity).toFixed(1)}/pc
                </span>
              </div>

              <div className="col-span-2 sm:col-span-4 p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                <div className="space-y-0.5">
                  <span className="font-semibold text-slate-800">Landed Cost Calculation:</span>
                  <p className="text-[11px] text-slate-500">
                    Base: ৳{(batchQuantity * unitPurchasePrice).toLocaleString()} + Direct Costs: ৳{costingSheet.totalDirectCosts.toLocaleString()} = ৳{costingSheet.landedCost.toLocaleString()} Total
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Landed Cost / Piece</span>
                  <span className="text-base font-extrabold text-emerald-800 font-mono-num">
                    ৳{costingSheet.landedCostPerUnit.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Monthly Operating Expenses Allocation */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Building className="w-4 h-4 text-emerald-600" />
                  <span>3. Monthly Operating Overhead Allocation</span>
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Covers rent, electricity, staff salary &amp; utilities without double-counting direct purchase costs.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBudgetEditor(prev => !prev)}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer"
              >
                {showBudgetEditor ? 'Hide Budget Details' : 'Edit Monthly Budget'}
              </button>
            </div>

            {/* Allocation Method Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
              <div
                onClick={() => setAllocationMethod('units_sold')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  allocationMethod === 'units_sold'
                    ? 'bg-emerald-50/70 border-emerald-500 ring-2 ring-emerald-500/20'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between font-bold text-slate-900 mb-1">
                  <span>Units Sold Model</span>
                  {allocationMethod === 'units_sold' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                </div>
                <p className="text-[11px] text-slate-500">
                  Total OpEx ÷ Expected monthly units sold.
                </p>
              </div>

              <div
                onClick={() => setAllocationMethod('revenue_percent')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  allocationMethod === 'revenue_percent'
                    ? 'bg-emerald-50/70 border-emerald-500 ring-2 ring-emerald-500/20'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between font-bold text-slate-900 mb-1">
                  <span>Revenue % Model</span>
                  {allocationMethod === 'revenue_percent' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                </div>
                <p className="text-[11px] text-slate-500">
                  Overhead as percentage of monthly turnover.
                </p>
              </div>

              <div
                onClick={() => setAllocationMethod('manual')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  allocationMethod === 'manual'
                    ? 'bg-emerald-50/70 border-emerald-500 ring-2 ring-emerald-500/20'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between font-bold text-slate-900 mb-1">
                  <span>Manual Fixed (৳/pc)</span>
                  {allocationMethod === 'manual' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                </div>
                <p className="text-[11px] text-slate-500">
                  Enter an explicit overhead allocation per item.
                </p>
              </div>
            </div>

            {/* Manual OpEx input if manual is selected */}
            {allocationMethod === 'manual' && (
              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs space-y-2">
                <label className="block font-bold text-amber-900">
                  Manual Operating Expense Allocated Per Unit (৳)
                </label>
                <input
                  type="number"
                  min="0"
                  value={manualOpExPerUnit}
                  onChange={e => setManualOpExPerUnit(Math.max(0, Number(e.target.value) || 0))}
                  className="w-36 p-2 bg-white border border-amber-300 rounded-lg font-mono-num font-bold text-slate-900"
                />
                <p className="text-[11px] text-amber-800">
                  This fixed amount covers general shop rent, electric bills, and staff overhead per piece.
                </p>
              </div>
            )}

            {/* Expandable Monthly Budget Editor */}
            {showBudgetEditor && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 text-xs">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="font-bold text-slate-800">Shop Monthly Budget Inputs</span>
                  <span className="text-[11px] font-mono font-bold text-emerald-700">
                    Total: ৳
                    {(
                      monthlyBudget.shopRent +
                      monthlyBudget.electricity +
                      monthlyBudget.staffSalaries +
                      monthlyBudget.internetAndMobile +
                      monthlyBudget.transportGeneral +
                      monthlyBudget.packagingGeneral +
                      monthlyBudget.maintenance +
                      monthlyBudget.otherExpenses
                    ).toLocaleString()}/month
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Shop Rent (৳)</label>
                    <input
                      type="number"
                      value={monthlyBudget.shopRent}
                      onChange={e => setMonthlyBudget(b => ({ ...b, shopRent: Number(e.target.value) || 0 }))}
                      className="w-full p-1.5 border border-slate-200 rounded-lg bg-white font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Electricity (৳)</label>
                    <input
                      type="number"
                      value={monthlyBudget.electricity}
                      onChange={e => setMonthlyBudget(b => ({ ...b, electricity: Number(e.target.value) || 0 }))}
                      className="w-full p-1.5 border border-slate-200 rounded-lg bg-white font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Staff Salaries (৳)</label>
                    <input
                      type="number"
                      value={monthlyBudget.staffSalaries}
                      onChange={e => setMonthlyBudget(b => ({ ...b, staffSalaries: Number(e.target.value) || 0 }))}
                      className="w-full p-1.5 border border-slate-200 rounded-lg bg-white font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Internet &amp; Phone (৳)</label>
                    <input
                      type="number"
                      value={monthlyBudget.internetAndMobile}
                      onChange={e => setMonthlyBudget(b => ({ ...b, internetAndMobile: Number(e.target.value) || 0 }))}
                      className="w-full p-1.5 border border-slate-200 rounded-lg bg-white font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Maintenance (৳)</label>
                    <input
                      type="number"
                      value={monthlyBudget.maintenance}
                      onChange={e => setMonthlyBudget(b => ({ ...b, maintenance: Number(e.target.value) || 0 }))}
                      className="w-full p-1.5 border border-slate-200 rounded-lg bg-white font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Other OpEx (৳)</label>
                    <input
                      type="number"
                      value={monthlyBudget.otherExpenses}
                      onChange={e => setMonthlyBudget(b => ({ ...b, otherExpenses: Number(e.target.value) || 0 }))}
                      className="w-full p-1.5 border border-slate-200 rounded-lg bg-white font-mono-num"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-500 block mb-0.5">Expected Monthly Units Sold</label>
                    <input
                      type="number"
                      value={monthlyBudget.expectedMonthlyUnitsSold}
                      onChange={e => setMonthlyBudget(b => ({ ...b, expectedMonthlyUnitsSold: Math.max(1, Number(e.target.value) || 1) }))}
                      className="w-full p-1.5 border border-slate-200 rounded-lg bg-white font-mono-num font-bold"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-slate-700">
                  Allocated Shop Overhead: <strong>৳{costingSheet.allocatedOpExPerUnit.toFixed(2)}/piece</strong>
                </span>
              </div>
              <span className="text-[11px] text-emerald-800 font-medium">
                Zero Double-Counting
              </span>
            </div>
          </div>

          {/* Section 4: Profit Strategy & Target Margin */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
            <div className="pb-2 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Coins className="w-4 h-4 text-emerald-600" />
                <span>4. Desired Profit Strategy &amp; Selling Fees</span>
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Set fair profit without confusing Markup % with true Profit Margin %.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Profit Mode</label>
                <select
                  value={profitMethod}
                  onChange={e => setProfitMethod(e.target.value as any)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="margin_percentage">Profit Margin % on Price</option>
                  <option value="markup_percentage">Markup % on Total Cost</option>
                  <option value="fixed_amount">Fixed Profit (৳ / piece)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {profitMethod === 'fixed_amount' ? 'Profit Amount (৳)' : 'Profit Rate (%)'}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-bold">
                    {profitMethod === 'fixed_amount' ? '৳' : '%'}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={profitMethod === 'margin_percentage' ? 95 : 1000}
                    value={profitValue}
                    onChange={e => setProfitValue(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono-num font-bold text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">VAT / Tax Rate (%)</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={vatRate}
                  onChange={e => setVatRate(Number(e.target.value) || 0)}
                  placeholder="0"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono-num text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Formula explanation note */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-slate-800">
                <Info className="w-3.5 h-3.5 text-blue-600" />
                <span>Pricing Formula In Use:</span>
              </div>
              {profitMethod === 'margin_percentage' ? (
                <p className="text-[11px] font-mono text-emerald-800 bg-white p-1.5 rounded border border-slate-200">
                  Selling Price = Total Unit Cost (৳{costingSheet.totalUnitCost}) ÷ (1 - {profitValue}%) = ৳{costingSheet.preTaxSellingPrice}
                </p>
              ) : profitMethod === 'markup_percentage' ? (
                <p className="text-[11px] font-mono text-emerald-800 bg-white p-1.5 rounded border border-slate-200">
                  Selling Price = Total Unit Cost (৳{costingSheet.totalUnitCost}) × (1 + {profitValue}%) = ৳{costingSheet.preTaxSellingPrice}
                </p>
              ) : (
                <p className="text-[11px] font-mono text-emerald-800 bg-white p-1.5 rounded border border-slate-200">
                  Selling Price = Total Unit Cost (৳{costingSheet.totalUnitCost}) + Desired Profit (৳{profitValue}) = ৳{costingSheet.preTaxSellingPrice}
                </p>
              )}
            </div>
          </div>

          {/* Section 5: Market Comparison & Planned Selling Price */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
            <div className="pb-2 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Scale className="w-4 h-4 text-emerald-600" />
                <span>5. Local Market &amp; Competitor Comparison</span>
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Benchmark against local market and test your own planned selling price.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Local Market Price (৳)</label>
                <input
                  type="number"
                  min="0"
                  value={localMarketPrice}
                  onChange={e => setLocalMarketPrice(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 750"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono-num text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Competitor Price (৳)</label>
                <input
                  type="number"
                  min="0"
                  value={competitorPrice}
                  onChange={e => setCompetitorPrice(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 800"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono-num text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Your Planned Price (৳) <span className="text-slate-400 font-normal">(Optional Override)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  value={plannedSellingPrice}
                  onChange={e => setPlannedSellingPrice(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={`Recommended: ৳${costingSheet.recommendedSellingPrice}`}
                  className={`w-full p-2.5 border rounded-xl font-mono-num font-bold text-sm focus:outline-none ${
                    comparison.isLossMaking
                      ? 'bg-rose-50 border-rose-300 text-rose-800'
                      : 'bg-emerald-50/50 border-emerald-300 text-emerald-900'
                  }`}
                />
              </div>
            </div>

            {/* Comparison Feedback Alert */}
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                comparison.isLossMaking
                  ? 'bg-rose-50 border-rose-200 text-rose-900'
                  : comparison.status === 'competitive'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-slate-50 border-slate-200 text-slate-800'
              }`}
            >
              {comparison.isLossMaking ? (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <span className="font-bold block">
                  {comparison.isLossMaking ? 'LOSS-MAKING SALE WARNING' : 'Market Competitiveness Analysis'}
                </span>
                <p className="text-[11px] leading-relaxed">{comparison.summary}</p>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Real-Time Cost & Selling Price Summary Card */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-md p-5 sm:p-6 sticky top-20 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                  Fair Price Breakdown
                </span>
                <h3 className="text-base font-extrabold text-slate-900 truncate">
                  {productName || 'Costing Sheet'}
                </h3>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-bold capitalize bg-slate-100 text-slate-800 border border-slate-200">
                {qualityTier} Grade
              </span>
            </div>

            {/* Recommended Selling Price Hero Card */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-700/20 text-center space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-emerald-100 font-semibold block">
                Recommended Fair Selling Price
              </span>
              <div className="text-3xl sm:text-4xl font-extrabold font-mono-num tracking-tight">
                ৳{costingSheet.recommendedSellingPrice}
              </div>
              <span className="text-xs text-emerald-100/90 block">
                Includes all landed costs, shop rent/salary overhead + {profitValue}% desired profit
              </span>
            </div>

            {/* Cost Breakdown Waterfall */}
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100 text-slate-600">
                <span>1. Supplier Base Purchase Cost:</span>
                <span className="font-mono-num font-semibold text-slate-800">
                  ৳{costingSheet.unitPurchasePrice.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-100 text-slate-600">
                <span>2. Direct Costs (Transport/Loading/Tags):</span>
                <span className="font-mono-num font-semibold text-slate-800">
                  +৳{(costingSheet.landedCostPerUnit - costingSheet.unitPurchasePrice).toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between py-2 bg-slate-50 px-2.5 rounded-lg text-slate-800 font-semibold">
                <span>Landed Cost Per Unit:</span>
                <span className="font-mono-num text-emerald-800">
                  ৳{costingSheet.landedCostPerUnit.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-100 text-slate-600">
                <span>3. Allocated Monthly Shop Overhead:</span>
                <span className="font-mono-num font-semibold text-slate-800">
                  +৳{costingSheet.allocatedOpExPerUnit.toFixed(2)}
                </span>
              </div>

              {/* Total Unit Cost (Break-even) */}
              <div className="flex justify-between py-2.5 bg-amber-50/80 border border-amber-200 px-3 rounded-xl text-amber-900 font-bold">
                <div>
                  <span className="block">Total Unit Cost (Break-even):</span>
                  <span className="text-[10px] text-amber-700 font-normal">
                    Minimum safe floor. Selling below this causes a loss.
                  </span>
                </div>
                <span className="text-sm font-mono-num text-amber-950">
                  ৳{costingSheet.totalUnitCost.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-100 text-emerald-700 font-medium">
                <span>4. Desired Net Profit / Piece:</span>
                <span className="font-mono-num font-bold">
                  +৳{costingSheet.desiredProfitPerUnit.toFixed(2)}
                </span>
              </div>

              {costingSheet.vatAmount > 0 && (
                <div className="flex justify-between py-1.5 border-b border-slate-100 text-slate-600">
                  <span>5. VAT / Tax ({costingSheet.vatRate}%):</span>
                  <span className="font-mono-num">
                    +৳{costingSheet.vatAmount.toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            {/* Discount Protection Gauge */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs">
              <div className="flex items-center justify-between font-bold text-slate-900">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Discount Protection Threshold</span>
                </span>
                <span className="font-mono-num text-rose-700 font-bold">
                  Max: {costingSheet.maxDiscountPercent}%
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Minimum Safe Selling Price:</span>
                <strong className="text-slate-800 font-mono-num">৳{costingSheet.minSafeSellingPrice}</strong>
              </div>
              <p className="text-[10px] text-slate-500 leading-tight">
                Staff and sellers cannot offer discounts that reduce the price below <strong>৳{costingSheet.minSafeSellingPrice}</strong> without Admin approval.
              </p>
            </div>

            {/* Actions Buttons */}
            <div className="space-y-2 pt-2">
              {isAdmin && (
                <button
                  type="button"
                  disabled={isSavingProduct}
                  onClick={handleSaveToCatalog}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 active:scale-[0.98] text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-emerald-700/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSavingProduct ? 'Saving...' : 'Apply & Save to Product Catalog'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handlePrintCostingSheet}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold border border-slate-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4 text-slate-600" />
                <span>Print Costing Calculation Report</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
