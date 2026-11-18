import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { resolveBusinessProfile } from '../../config/appIdentity';
import {
  Sale,
  SaleItem,
  Product,
  ProductVariant,
  PaymentMethod,
  ExchangeTransaction,
  ReturnExchangeItem,
  ReplacementItem,
  ItemCondition,
} from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { getShopLogo, printDocument } from '../../utils/printEngine';
import {
  RotateCcw,
  RefreshCw,
  Search,
  Receipt,
  AlertTriangle,
  CheckCircle2,
  Package,
  Layers,
  ArrowRight,
  Printer,
  X,
  CreditCard,
  User,
  ShoppingBag,
  Clock,
  ShieldCheck,
  Check,
} from 'lucide-react';

export const ExchangeReturnView: React.FC = () => {
  const {
    sales,
    products,
    customers,
    accounts,
    updateProduct,
    updateAccount,
    settings,
    branches,
    activeBranchId,
    activeBusinessId,
    currentUserRole,
    user,
    addAuditLog,
    adjustStock,
    recordExchangeEffects,
  } = useApp();

  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];
  const biz = resolveBusinessProfile(settings, activeBranch);
  const shopLogo = getShopLogo(settings, activeBusinessId);

  const [activeTab, setActiveTab] = useState<'process' | 'history'>('process');

  // Lookup state
  const [searchInvoiceQuery, setSearchInvoiceQuery] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  // Return items selection state
  // key: productId or variantId, value: quantity to return
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnReasons, setReturnReasons] = useState<Record<string, ReturnExchangeItem['reason']>>({});
  const [returnConditions, setReturnConditions] = useState<Record<string, ItemCondition>>({});

  // Mode: 'exchange' or 'return_only'
  const [actionMode, setActionMode] = useState<'exchange' | 'return_only'>('exchange');

  // Replacement items in exchange
  const [replacementItems, setReplacementItems] = useState<ReplacementItem[]>([]);
  const [isAddingReplacement, setIsAddingReplacement] = useState(false);
  const [repSearchQuery, setRepSearchQuery] = useState('');
  const [repSelectedProduct, setRepSelectedProduct] = useState<Product | null>(null);
  const [repSelectedVariant, setRepSelectedVariant] = useState<ProductVariant | null>(null);
  const [repQty, setRepQty] = useState<number>(1);
  const [isProcessing, setIsProcessing] = useState(false);

  // Settlement details
  const [settlementMethod, setSettlementMethod] = useState<PaymentMethod>('cash');
  const [settlementAccountId, setSettlementAccountId] = useState<string>(accounts[0]?.id || '');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if ((!settlementAccountId || !accounts.some(a => a.id === settlementAccountId)) && accounts.length > 0) {
      setSettlementAccountId(accounts[0].id);
    }
  }, [accounts, settlementAccountId]);

  const exchangeStorageKey = activeBusinessId ? `AMAR_DOKAN_EXCHANGES_${activeBusinessId}` : 'AMAR_DOKAN_EXCHANGES';

  // Exchange History state (locally persistent)
  const [exchangeHistory, setExchangeHistory] = useState<ExchangeTransaction[]>(() => {
    try {
      const saved =
        localStorage.getItem(exchangeStorageKey) ||
        localStorage.getItem('AMAR_DOKAN_EXCHANGES');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      const saved =
        localStorage.getItem(exchangeStorageKey) ||
        localStorage.getItem('AMAR_DOKAN_EXCHANGES');
      setExchangeHistory(saved ? JSON.parse(saved) : []);
    } catch {
      setExchangeHistory([]);
    }
  }, [exchangeStorageKey]);

  // Receipt Modal State
  const [completedExchange, setCompletedExchange] = useState<ExchangeTransaction | null>(null);

  // Search invoice
  const handleSearchInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInvoiceQuery.trim().toLowerCase();
    if (!q) return;

    const matched = sales.find(
      s =>
        s.invoiceNumber.toLowerCase() === q ||
        (s.customerMobile && s.customerMobile.includes(q)) ||
        (s.customerName && s.customerName.toLowerCase().includes(q))
    );

    if (matched) {
      setSelectedSale(matched);
      // Reset return state
      const initialQty: Record<string, number> = {};
      const initialReasons: Record<string, ReturnExchangeItem['reason']> = {};
      const initialConds: Record<string, ItemCondition> = {};
      matched.items.forEach(item => {
        const key = item.variantId ? `${item.productId}_${item.variantId}` : item.productId;
        initialQty[key] = 0;
        initialReasons[key] = 'wrong_size';
        initialConds[key] = 'sellable';
      });
      setReturnQuantities(initialQty);
      setReturnReasons(initialReasons);
      setReturnConditions(initialConds);
      setReplacementItems([]);
    } else {
      alert(`No invoice found matching '${searchInvoiceQuery}'`);
    }
  };

  // Calculate return value
  const returnedItemsList: ReturnExchangeItem[] = useMemo(() => {
    if (!selectedSale) return [];

    const list: ReturnExchangeItem[] = [];
    selectedSale.items.forEach(item => {
      const key = item.variantId ? `${item.productId}_${item.variantId}` : item.productId;
      const qty = returnQuantities[key] || 0;
      if (qty > 0) {
        list.push({
          productId: item.productId,
          productName: item.productName,
          variantId: item.variantId,
          variantDetails: item.variantDetails,
          sku: item.sku,
          originalUnitPrice: item.unitPrice,
          quantity: qty,
          totalRefund: qty * item.unitPrice,
          reason: returnReasons[key] || 'wrong_size',
          condition: returnConditions[key] || 'sellable',
        });
      }
    });

    return list;
  }, [selectedSale, returnQuantities, returnReasons, returnConditions]);

  const totalReturnValue = useMemo(() => {
    return returnedItemsList.reduce((sum, item) => sum + item.totalRefund, 0);
  }, [returnedItemsList]);

  const totalReplacementValue = useMemo(() => {
    return replacementItems.reduce((sum, item) => sum + item.total, 0);
  }, [replacementItems]);

  // Difference: Positive = Customer pays extra, Negative = Shop refunds
  const differenceAmount = totalReplacementValue - totalReturnValue;

  // Add replacement item
  const handleAddReplacement = () => {
    if (!repSelectedProduct) return;
    if (repSelectedProduct.hasVariants && repSelectedProduct.variants && repSelectedProduct.variants.length > 0 && !repSelectedVariant) {
      alert('Please select a Size / Color variant for this replacement item.');
      return;
    }

    const qty = Math.max(1, Number(repQty) || 1);
    const variantLabel = repSelectedVariant
      ? [repSelectedVariant.color, repSelectedVariant.size].filter(Boolean).join(' / ')
      : undefined;

    const unitPrice =
      repSelectedVariant?.salePrice !== undefined
        ? repSelectedVariant.salePrice
        : repSelectedProduct.salePrice;

    const newItem: ReplacementItem = {
      productId: repSelectedProduct.id,
      productName: repSelectedProduct.name,
      variantId: repSelectedVariant?.id,
      variantDetails: variantLabel,
      sku: repSelectedVariant?.sku || repSelectedProduct.code,
      unitPrice,
      quantity: qty,
      total: unitPrice * qty,
    };

    setReplacementItems(prev => [...prev, newItem]);
    setRepSelectedProduct(null);
    setRepSelectedVariant(null);
    setRepQty(1);
    setIsAddingReplacement(false);
  };

  // Submit Return or Exchange
  const handleProcessTransaction = async () => {
    if (!selectedSale || isProcessing) return;
    if (returnedItemsList.length === 0) {
      alert('Please select at least one item and quantity to return.');
      return;
    }

    if (actionMode === 'exchange' && replacementItems.length === 0) {
      alert('Please select at least one replacement item for the exchange, or switch mode to Return for Refund.');
      return;
    }

    const exchangeNo = `EXC-${Date.now().toString().slice(-6)}`;
    const now = new Date().toISOString();

    const transaction: ExchangeTransaction = {
      id: `exc-${Date.now()}`,
      exchangeNumber: exchangeNo,
      invoiceNumber: selectedSale.invoiceNumber,
      saleId: selectedSale.id,
      date: now,
      customerId: selectedSale.customerId,
      customerName: selectedSale.customerName,
      customerMobile: selectedSale.customerMobile,
      actionType: actionMode,
      returnedItems: returnedItemsList,
      replacementItems,
      totalReturnValue,
      totalReplacementValue: actionMode === 'exchange' ? totalReplacementValue : 0,
      differenceAmount: actionMode === 'exchange' ? differenceAmount : -totalReturnValue,
      settlementMethod: differenceAmount !== 0 ? settlementMethod : undefined,
      accountId: settlementAccountId || undefined,
      servedBy: user?.user_metadata?.full_name || 'Staff',
      branchId: activeBranchId || selectedSale.branchId,
      notes,
    };

    setIsProcessing(true);
    try {
      const restockedMoves: { productId: string; productName: string; quantity: number; previousStock: number; newStock: number }[] = [];
      const replacementMoves: { productId: string; productName: string; quantity: number; previousStock: number; newStock: number }[] = [];

      // 1. Restock returned items if 'sellable'
      for (const item of returnedItemsList) {
        const prod = products.find(p => p.id === item.productId);
        if (!prod) continue;

        if (item.condition === 'sellable') {
          const prevStock = prod.currentStock;
          let nextTotalStock = prevStock + item.quantity;
          if (prod.hasVariants && prod.variants && item.variantId) {
            const nextVariants = prod.variants.map(v =>
              v.id === item.variantId ? { ...v, stock: v.stock + item.quantity } : v
            );
            nextTotalStock = nextVariants.reduce((s, v) => s + v.stock, 0);
            await updateProduct(prod.id, { variants: nextVariants, currentStock: nextTotalStock });
          } else {
            await updateProduct(prod.id, { currentStock: nextTotalStock });
          }
          restockedMoves.push({
            productId: prod.id,
            productName: prod.name,
            quantity: item.quantity,
            previousStock: prevStock,
            newStock: nextTotalStock,
          });
        } else {
          // Damaged item: log stock adjustment as damaged
          await adjustStock(prod.id, 0, 'damaged', `Returned damaged (${exchangeNo}): ${item.reason}`, item.variantId);
        }
      }

      // 2. Decrement stock for replacement items
      if (actionMode === 'exchange') {
        for (const item of replacementItems) {
          const prod = products.find(p => p.id === item.productId);
          if (!prod) continue;

          const prevStock = prod.currentStock;
          let nextTotalStock = Math.max(0, prevStock - item.quantity);
          if (prod.hasVariants && prod.variants && item.variantId) {
            const nextVariants = prod.variants.map(v =>
              v.id === item.variantId ? { ...v, stock: Math.max(0, v.stock - item.quantity) } : v
            );
            nextTotalStock = nextVariants.reduce((s, v) => s + v.stock, 0);
            await updateProduct(prod.id, { variants: nextVariants, currentStock: nextTotalStock });
          } else {
            await updateProduct(prod.id, { currentStock: nextTotalStock });
          }
          replacementMoves.push({
            productId: prod.id,
            productName: prod.name,
            quantity: item.quantity,
            previousStock: prevStock,
            newStock: nextTotalStock,
          });
        }
      }

      // 3. Adjust financial account balance for net price difference / cash refund
      let targetAccName: string | undefined;
      let targetAccBalanceAfter: number | undefined;
      if (transaction.differenceAmount !== 0 && settlementAccountId) {
        const targetAcc = accounts.find(a => a.id === settlementAccountId);
        if (targetAcc) {
          const nextBalance = Math.max(0, targetAcc.balance + transaction.differenceAmount);
          await updateAccount(targetAcc.id, { balance: nextBalance });
          targetAccName = targetAcc.name;
          targetAccBalanceAfter = nextBalance;
        }
      }

      // 3b. Record ledger movements for stock and cash/bank accounts
      recordExchangeEffects({
        exchangeNumber: exchangeNo,
        branchId: activeBranchId || selectedSale.branchId,
        restockedItems: restockedMoves,
        replacementItems: replacementMoves,
        differenceAmount: transaction.differenceAmount,
        accountId: settlementAccountId || undefined,
        accountName: targetAccName,
        accountBalanceAfter: targetAccBalanceAfter,
      });

      // 4. Save to local history
      const nextHistory = [transaction, ...exchangeHistory];
      setExchangeHistory(nextHistory);
      try {
        localStorage.setItem(exchangeStorageKey, JSON.stringify(nextHistory));
      } catch {}

      // 5. Audit Log
      addAuditLog(
        actionMode === 'exchange' ? 'EXCHANGE_PROCESSED' : 'SALE_RETURN_PROCESSED',
        'exchange',
        transaction.id,
        `${actionMode === 'exchange' ? 'Exchange' : 'Return'} voucher ${exchangeNo} for invoice ${selectedSale.invoiceNumber}. Difference: ৳${transaction.differenceAmount}`
      );

      // Show completed voucher
      setCompletedExchange(transaction);
      setSelectedSale(null);
    } catch (err: any) {
      alert(err?.message || 'Failed to save return/exchange to database. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-amber-50 text-amber-700">
              <RotateCcw className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-slate-900">Exchange, Return &amp; Refund Desk</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Process apparel size/color exchanges, defective returns, and price difference settlements.
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button
            onClick={() => setActiveTab('process')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              activeTab === 'process'
                ? 'bg-white shadow-xs text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Process New Exchange
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              activeTab === 'history'
                ? 'bg-white shadow-xs text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Exchange History ({exchangeHistory.length})
          </button>
        </div>
      </div>

      {activeTab === 'process' ? (
        <div className="space-y-6">
          {/* Step 1: Invoice Lookup */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Search className="w-4 h-4 text-amber-600" />
              <span>Step 1: Look Up Original Sale Invoice</span>
            </h2>

            <form onSubmit={handleSearchInvoice} className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={searchInvoiceQuery}
                  onChange={e => setSearchInvoiceQuery(e.target.value)}
                  placeholder="Enter Invoice Number (e.g. INV-2026-0001) or customer phone..."
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                />
                <Receipt className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              </div>
              <button
                type="submit"
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                Find Invoice
              </button>
            </form>
          </div>

          {/* Step 2: Invoice Line Items & Return Selection */}
          {selectedSale && (
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900 text-sm">
                      {selectedSale.invoiceNumber}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                      {selectedSale.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Date: {formatDate(selectedSale.date, 'en')} | Customer: {selectedSale.customerName} (
                    {selectedSale.customerMobile || 'No phone'})
                  </div>
                </div>

                {/* Mode Selector */}
                <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setActionMode('exchange')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      actionMode === 'exchange'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Size / Garment Exchange
                  </button>
                  <button
                    type="button"
                    onClick={() => setActionMode('return_only')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      actionMode === 'return_only'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Return for Refund
                  </button>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-800 block">
                  Select Item(s) Being Returned by Customer:
                </label>

                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">Item / Variant</th>
                        <th className="py-2.5 px-3">Sold Qty</th>
                        <th className="py-2.5 px-3">Unit Price</th>
                        <th className="py-2.5 px-3 w-28">Return Qty</th>
                        <th className="py-2.5 px-3">Return Reason</th>
                        <th className="py-2.5 px-3">Item Condition</th>
                        <th className="py-2.5 px-3 text-right">Return Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedSale.items.map(item => {
                        const key = item.variantId ? `${item.productId}_${item.variantId}` : item.productId;
                        const returnQty = returnQuantities[key] || 0;

                        return (
                          <tr key={key} className={returnQty > 0 ? 'bg-amber-50/40' : ''}>
                            <td className="py-2.5 px-3">
                              <div className="font-bold text-slate-900">{item.productName}</div>
                              {item.variantDetails && (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono">
                                  {item.variantDetails}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono">{item.quantity} pcs</td>
                            <td className="py-2.5 px-3 font-mono-num font-semibold">
                              {formatCurrency(item.unitPrice, 'en')}
                            </td>
                            <td className="py-2.5 px-3">
                              <select
                                value={returnQty}
                                onChange={e =>
                                  setReturnQuantities({
                                    ...returnQuantities,
                                    [key]: Number(e.target.value),
                                  })
                                }
                                className="w-full px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-bold"
                              >
                                {Array.from({ length: item.quantity + 1 }, (_, i) => (
                                  <option key={i} value={i}>
                                    {i === 0 ? '0 (None)' : `${i} pcs`}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2.5 px-3">
                              {returnQty > 0 && (
                                <select
                                  value={returnReasons[key] || 'wrong_size'}
                                  onChange={e =>
                                    setReturnReasons({
                                      ...returnReasons,
                                      [key]: e.target.value as any,
                                    })
                                  }
                                  className="w-full px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs"
                                >
                                  <option value="wrong_size">Wrong Size</option>
                                  <option value="color_mismatch">Color Mismatch</option>
                                  <option value="defective_damaged">Defective / Damaged</option>
                                  <option value="customer_dislike">Customer Dislike</option>
                                  <option value="other">Other Reason</option>
                                </select>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              {returnQty > 0 && (
                                <select
                                  value={returnConditions[key] || 'sellable'}
                                  onChange={e =>
                                    setReturnConditions({
                                      ...returnConditions,
                                      [key]: e.target.value as any,
                                    })
                                  }
                                  className={`w-full px-2 py-1 border rounded-lg text-xs font-bold ${
                                    returnConditions[key] === 'damaged'
                                      ? 'border-rose-400 bg-rose-50 text-rose-700'
                                      : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                  }`}
                                >
                                  <option value="sellable">Sellable (Restock)</option>
                                  <option value="damaged">Damaged (Quarantine)</option>
                                </select>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-slate-900 font-mono-num">
                              {formatCurrency(returnQty * item.unitPrice, 'en')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Subtotal of returns */}
                <div className="flex justify-end pt-2">
                  <div className="text-right">
                    <span className="text-xs text-slate-500 mr-2">Total Returned Credit:</span>
                    <span className="text-base font-extrabold text-rose-700 font-mono-num">
                      {formatCurrency(totalReturnValue, 'en')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Step 3: If Exchange, Select Replacement Products */}
              {actionMode === 'exchange' && (
                <div className="pt-4 border-t space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <RefreshCw className="w-4 h-4 text-indigo-600" />
                        <span>Step 3: Select Replacement Apparel (New Size / Color / Garment)</span>
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Customer can take a different size of the same shirt or pick any alternative clothing item.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsAddingReplacement(true)}
                      className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold rounded-lg cursor-pointer"
                    >
                      + Add Replacement Garment
                    </button>
                  </div>

                  {/* Replacement items table */}
                  {replacementItems.length > 0 ? (
                    <div className="overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                          <tr>
                            <th className="py-2 px-3">Garment &amp; Variant</th>
                            <th className="py-2 px-3">SKU</th>
                            <th className="py-2 px-3">Unit Price</th>
                            <th className="py-2 px-3 w-24">Qty</th>
                            <th className="py-2 px-3 text-right">Subtotal</th>
                            <th className="py-2 px-3 w-10"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {replacementItems.map((item, idx) => (
                            <tr key={idx}>
                              <td className="py-2 px-3">
                                <div className="font-bold text-slate-900">{item.productName}</div>
                                {item.variantDetails && (
                                  <span className="text-[10px] text-indigo-700 font-mono">
                                    {item.variantDetails}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-500">{item.sku}</td>
                              <td className="py-2 px-3 font-mono-num">{formatCurrency(item.unitPrice, 'en')}</td>
                              <td className="py-2 px-3 font-mono font-bold">{item.quantity} pcs</td>
                              <td className="py-2 px-3 text-right font-bold font-mono-num">
                                {formatCurrency(item.total, 'en')}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setReplacementItems(prev => prev.filter((_, i) => i !== idx))
                                  }
                                  className="text-rose-500 hover:text-rose-700"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center text-xs text-slate-500">
                      No replacement garments selected yet. Click '+ Add Replacement Garment' above.
                    </div>
                  )}

                  {/* Modal to pick replacement product */}
                  {isAddingReplacement && (
                    <div className="p-4 bg-indigo-50/50 border border-indigo-200 rounded-2xl space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-indigo-900">Choose Replacement Garment</h4>
                        <button
                          type="button"
                          onClick={() => setIsAddingReplacement(false)}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Select Product */}
                        <div>
                          <label className="text-[11px] font-semibold text-slate-700">Select Product</label>
                          <select
                            value={repSelectedProduct?.id || ''}
                            onChange={e => {
                              const found = products.find(p => p.id === e.target.value) || null;
                              setRepSelectedProduct(found);
                              setRepSelectedVariant(null);
                            }}
                            className="w-full mt-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                          >
                            <option value="">-- Choose Product --</option>
                            {products
                              .filter(p => p.isActive !== false)
                              .map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name} (৳{p.salePrice}) - Stock: {p.currentStock}
                                </option>
                              ))}
                          </select>
                        </div>

                        {/* Select Variant if product has variants */}
                        {repSelectedProduct?.hasVariants && repSelectedProduct.variants && (
                          <div>
                            <label className="text-[11px] font-semibold text-slate-700">
                              Select Size / Color
                            </label>
                            <select
                              value={repSelectedVariant?.id || ''}
                              onChange={e => {
                                const v = repSelectedProduct.variants?.find(
                                  x => x.id === e.target.value
                                ) || null;
                                setRepSelectedVariant(v);
                              }}
                              className="w-full mt-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                            >
                              <option value="">-- Choose Size &amp; Color --</option>
                              {repSelectedProduct.variants.map(v => (
                                <option key={v.id} value={v.id}>
                                  {[v.color, v.size].filter(Boolean).join(' / ')} - Stock: {v.stock} pcs (৳
                                  {v.salePrice || repSelectedProduct.salePrice})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] font-semibold text-slate-700">Qty:</label>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={repQty}
                            onChange={e => setRepQty(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-16 px-2 py-1 text-xs border border-slate-300 rounded-lg text-center font-bold"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handleAddReplacement}
                          disabled={!repSelectedProduct}
                          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-xs"
                        >
                          Confirm Replacement Item
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Settlement Summary */}
              <div className="pt-4 border-t bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-4">
                <h3 className="text-xs font-bold text-slate-900">Exchange / Return Settlement</h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block">
                      Total Returned Value
                    </span>
                    <span className="text-base font-bold text-rose-600 font-mono-num">
                      {formatCurrency(totalReturnValue, 'en')}
                    </span>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block">
                      Total Replacement Value
                    </span>
                    <span className="text-base font-bold text-indigo-700 font-mono-num">
                      {formatCurrency(actionMode === 'exchange' ? totalReplacementValue : 0, 'en')}
                    </span>
                  </div>

                  <div
                    className={`p-3 rounded-xl border ${
                      differenceAmount > 0
                        ? 'bg-amber-50 border-amber-300 text-amber-950'
                        : differenceAmount < 0
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                        : 'bg-slate-100 border-slate-300 text-slate-800'
                    }`}
                  >
                    <span className="text-[10px] uppercase font-semibold block">
                      {differenceAmount > 0
                        ? 'Customer Pays Extra'
                        : differenceAmount < 0
                        ? 'Shop Refunds Customer'
                        : 'Even Exchange (No balance)'}
                    </span>
                    <span className="text-lg font-black font-mono-num">
                      {formatCurrency(Math.abs(differenceAmount), 'en')}
                    </span>
                  </div>
                </div>

                {/* Settlement Account & Method if there is a difference */}
                {differenceAmount !== 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-700">
                        {differenceAmount > 0 ? 'Customer Payment Method' : 'Refund Payout Method'}
                      </label>
                      <select
                        value={settlementMethod}
                        onChange={e => setSettlementMethod(e.target.value as PaymentMethod)}
                        className="w-full mt-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="cash">Cash in Hand</option>
                        <option value="bkash">bKash Merchant</option>
                        <option value="nagad">Nagad</option>
                        <option value="bank">Bank Card / Transfer</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-700">Financial Account</label>
                      <select
                        value={settlementAccountId}
                        onChange={e => setSettlementAccountId(e.target.value)}
                        className="w-full mt-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        {accounts.map(acc => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} (Balance: ৳{acc.balance})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Optional notes or reason description..."
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                </div>

                {/* Final Process Button */}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSale(null)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={handleProcessTransaction}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    {isProcessing
                      ? 'Saving...'
                      : actionMode === 'exchange'
                      ? 'Complete Apparel Exchange & Print Slip'
                      : 'Process Return & Issue Refund'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* History Tab */
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Exchange &amp; Return Vouchers</h2>
            <span className="text-xs text-slate-500">{exchangeHistory.length} recorded</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Voucher No</th>
                  <th className="py-2.5 px-3">Original Invoice</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Customer</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Returned Items</th>
                  <th className="py-2.5 px-3">Replacements</th>
                  <th className="py-2.5 px-3 text-right">Settlement</th>
                  <th className="py-2.5 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {exchangeHistory.map(exc => (
                  <tr key={exc.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                      {exc.exchangeNumber}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">{exc.invoiceNumber}</td>
                    <td className="py-2.5 px-3 text-slate-500">{formatDate(exc.date, 'en')}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800">{exc.customerName}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          exc.actionType === 'exchange'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {exc.actionType === 'exchange' ? 'Exchange' : 'Return'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      {exc.returnedItems.map((r, i) => (
                        <div key={i} className="text-[11px] text-slate-700">
                          {r.quantity}x {r.productName} ({r.variantDetails || 'Std'})
                        </div>
                      ))}
                    </td>
                    <td className="py-2.5 px-3">
                      {exc.replacementItems.length > 0 ? (
                        exc.replacementItems.map((rep, i) => (
                          <div key={i} className="text-[11px] text-indigo-700">
                            {rep.quantity}x {rep.productName} ({rep.variantDetails || 'Std'})
                          </div>
                        ))
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num font-bold">
                      {exc.differenceAmount > 0 ? (
                        <span className="text-emerald-700">+৳{exc.differenceAmount}</span>
                      ) : exc.differenceAmount < 0 ? (
                        <span className="text-rose-700">-৳{Math.abs(exc.differenceAmount)}</span>
                      ) : (
                        <span className="text-slate-500">৳0 (Even)</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => setCompletedExchange(exc)}
                        className="p-1 hover:bg-slate-200 rounded text-slate-600"
                        title="Print Voucher Slip"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {exchangeHistory.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-400">
                No exchange or return vouchers recorded yet.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Completed Exchange Printable Voucher Slip Modal */}
      {completedExchange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-sm text-slate-900">Exchange / Return Voucher</h3>
              </div>
              <button
                onClick={() => setCompletedExchange(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Voucher printable body */}
            <div id="exchange-slip-print" className="print-paper-white p-4 bg-white border border-slate-200 rounded-2xl text-slate-900 text-xs space-y-3 font-mono">
              <div className="text-center pb-2 border-b border-dashed border-slate-300">
                {shopLogo && (
                  <img src={shopLogo} alt={biz.shopName} className="h-8 max-w-[100px] object-contain mx-auto mb-1" />
                )}
                <div className="font-black text-sm uppercase">{biz.shopName}</div>
                {biz.branchName && (
                  <div className="text-[10px] text-slate-600 font-semibold">Branch: {biz.branchName}</div>
                )}
                {biz.address && <div className="text-[10px] text-slate-500">{biz.address}</div>}
                {biz.mobile && <div className="text-[10px] text-slate-500">Mobile: {biz.mobile}</div>}
                {biz.vatRegistrationNo && <div className="text-[10px] text-slate-500">VAT/BIN: {biz.vatRegistrationNo}</div>}
                <div className="text-[10px] text-slate-500">Voucher: {completedExchange.exchangeNumber}</div>
                <div className="text-[10px] text-slate-500">Orig Inv: {completedExchange.invoiceNumber}</div>
              </div>

              <div>
                <span className="font-bold text-slate-700 block">Returned Item(s):</span>
                {completedExchange.returnedItems.map((r, i) => (
                  <div key={i} className="flex justify-between text-[11px] text-rose-700">
                    <span>
                      {r.quantity}x {r.productName} ({r.variantDetails || 'Std'})
                    </span>
                    <span>৳{r.totalRefund}</span>
                  </div>
                ))}
              </div>

              {completedExchange.replacementItems.length > 0 && (
                <div>
                  <span className="font-bold text-slate-700 block">Replacement Item(s):</span>
                  {completedExchange.replacementItems.map((rep, i) => (
                    <div key={i} className="flex justify-between text-[11px] text-indigo-700">
                      <span>
                        {rep.quantity}x {rep.productName} ({rep.variantDetails || 'Std'})
                      </span>
                      <span>৳{rep.total}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-2 border-t border-dashed border-slate-300 space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Return Credit:</span>
                  <span>৳{completedExchange.totalReturnValue}</span>
                </div>
                {completedExchange.replacementItems.length > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Replacement Total:</span>
                    <span>৳{completedExchange.totalReplacementValue}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-slate-900 text-sm pt-1 border-t">
                  <span>Settlement Balance:</span>
                  <span>
                    {completedExchange.differenceAmount > 0
                      ? `+৳${completedExchange.differenceAmount} (Paid)`
                      : completedExchange.differenceAmount < 0
                      ? `-৳${Math.abs(completedExchange.differenceAmount)} (Refunded)`
                      : '৳0 (Even Exchange)'}
                  </span>
                </div>
              </div>

              <div className="text-center pt-2 text-[9px] text-slate-400">
                Served by: {completedExchange.servedBy} | {formatDate(completedExchange.date, 'en')}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCompletedExchange(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const exc = completedExchange;
                  const slipEl = document.getElementById('exchange-slip-print');
                  const innerHtml = slipEl ? slipEl.innerHTML : '';
                  const docHtml = `<!DOCTYPE html><html><head><title>Voucher ${exc.exchangeNumber}</title><style>@page{size:80mm auto;margin:4mm;}body{font-family:monospace;font-size:11px;color:#000;margin:0;padding:8px;}</style></head><body><div>${innerHtml}</div></body></html>`;
                  const res = printDocument(docHtml, `Voucher ${exc.exchangeNumber}`);
                  if (!res.opened && res.error) {
                    alert(res.error);
                  }
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Print Slip</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
