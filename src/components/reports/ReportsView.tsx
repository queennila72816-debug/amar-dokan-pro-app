import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { resolveBusinessProfile } from '../../config/appIdentity';
import { formatCurrency, formatDate, exportToCSV, toBnNumber } from '../../utils/formatters';
import { getShopLogo, printFinancialReport } from '../../utils/printEngine';
import {
  TrendingUp,
  Download,
  Printer,
} from 'lucide-react';

export const ReportsView: React.FC = () => {
  const { sales, purchases, expenses, products, customers, suppliers, settings, branches, activeBranchId, hasPermission } = useApp();
  const canExportReport = hasPermission('profit_loss_reports', 'export') || hasPermission('sales_reports', 'export');
  const lang = settings.language;
  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];
  const biz = resolveBusinessProfile(settings, activeBranch);
  const shopLogo = getShopLogo(settings);

  const [dateRange, setDateRange] = useState<'today' | '7days' | 'month' | 'year' | 'all'>('month');
  const [reportTab, setReportTab] = useState<'pnl' | 'sales' | 'products' | 'variants' | 'expenses' | 'dues'>('pnl');

  // Filter by Date Range
  const now = new Date();
  const getFilterDate = () => {
    if (dateRange === 'today') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (dateRange === '7days') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    } else if (dateRange === 'month') {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (dateRange === 'year') {
      return new Date(now.getFullYear(), 0, 1);
    }
    return new Date(2000, 0, 1); // all
  };

  const filterDate = getFilterDate();

  const filteredSales = useMemo(() => {
    return sales.filter(s => new Date(s.date) >= filterDate && s.status !== 'voided' && s.status !== 'returned');
  }, [sales, filterDate]);

  const filteredPurchases = useMemo(() => {
    return purchases.filter(p => new Date(p.date) >= filterDate);
  }, [purchases, filterDate]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => new Date(e.date) >= filterDate);
  }, [expenses, filterDate]);

  // Financial Metrics
  const totalSalesRevenue = filteredSales.reduce((sum, s) => sum + Math.max(0, s.total - (s.refundedAmount || 0)), 0);

  // Cost of Goods Sold (COGS)
  const totalCOGS = filteredSales.reduce((sum, s) => {
    const saleCost = s.items.reduce((itemSum, item) => itemSum + (item.purchasePrice * item.quantity), 0);
    return sum + saleCost;
  }, 0);

  const grossProfit = totalSalesRevenue - totalCOGS;
  const totalExpensesAmount = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const netProfit = grossProfit - totalExpensesAmount;

  // Stock Valuation (exclude archived/inactive products)
  const activeProducts = useMemo(() => products.filter(p => p.isActive !== false), [products]);
  const stockCostValue = activeProducts.reduce((sum, p) => sum + (p.currentStock * p.purchasePrice), 0);
  const stockSaleValue = activeProducts.reduce((sum, p) => sum + (p.currentStock * p.salePrice), 0);

  // Customer & Supplier Dues
  const totalCustomerDue = customers.reduce((sum, c) => sum + c.currentDue, 0);
  const totalSupplierDue = suppliers.reduce((sum, s) => sum + s.currentDue, 0);

  // Product-wise sales breakdown
  const productSalesMap = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; profit: number }>();
    filteredSales.forEach(sale => {
      sale.items.forEach(item => {
        const existing = map.get(item.productId) || { name: item.productName, qty: 0, revenue: 0, profit: 0 };
        const itemProfit = item.total - (item.purchasePrice * item.quantity);
        map.set(item.productId, {
          name: item.productName,
          qty: existing.qty + item.quantity,
          revenue: existing.revenue + item.total,
          profit: existing.profit + itemProfit,
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredSales]);

  // Apparel Variant, Size & Color Performance
  const { sizePerformanceMap, colorPerformanceMap, variantSalesList } = useMemo(() => {
    const sizeMap = new Map<string, { qty: number; revenue: number }>();
    const colorMap = new Map<string, { qty: number; revenue: number }>();
    const varMap = new Map<string, { name: string; variantDetails: string; sku: string; qty: number; revenue: number; profit: number }>();

    filteredSales.forEach(sale => {
      sale.items.forEach(item => {
        if (item.variantDetails) {
          const parts = item.variantDetails.split('/').map(s => s.trim());
          const color = parts[0] || '';
          const size = parts[1] || '';

          if (size) {
            const cur = sizeMap.get(size) || { qty: 0, revenue: 0 };
            sizeMap.set(size, { qty: cur.qty + item.quantity, revenue: cur.revenue + item.total });
          }

          if (color) {
            const cur = colorMap.get(color) || { qty: 0, revenue: 0 };
            colorMap.set(color, { qty: cur.qty + item.quantity, revenue: cur.revenue + item.total });
          }

          const vKey = item.variantId || `${item.productId}_${item.variantDetails}`;
          const curVar = varMap.get(vKey) || {
            name: item.productName,
            variantDetails: item.variantDetails,
            sku: item.sku,
            qty: 0,
            revenue: 0,
            profit: 0,
          };
          const profit = item.total - (item.purchasePrice * item.quantity);
          varMap.set(vKey, {
            ...curVar,
            qty: curVar.qty + item.quantity,
            revenue: curVar.revenue + item.total,
            profit: curVar.profit + profit,
          });
        }
      });
    });

    return {
      sizePerformanceMap: Array.from(sizeMap.entries()).sort((a, b) => b[1].qty - a[1].qty),
      colorPerformanceMap: Array.from(colorMap.entries()).sort((a, b) => b[1].qty - a[1].qty),
      variantSalesList: Array.from(varMap.values()).sort((a, b) => b.qty - a.qty),
    };
  }, [filteredSales]);

  // Category-wise Expense breakdown
  const categoryExpenseMap = useMemo(() => {
    const map = new Map<string, number>();
    filteredExpenses.forEach(e => {
      map.set(e.category, (map.get(e.category) || 0) + e.amount);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [filteredExpenses]);

  // Export handler
  const handleExportCSV = () => {
    if (reportTab === 'pnl') {
      const rows = [
        ['Business Name', biz.shopName],
        ['Branch', biz.branchName || 'Main'],
        ['Financial Profit & Loss Statement'],
        ['Generated Date', new Date().toLocaleString()],
        ['Period', dateRange],
        [''],
        ['Metric', 'Amount (BDT)'],
        ['Total Sales Revenue', totalSalesRevenue],
        ['Cost of Goods Sold (COGS)', totalCOGS],
        ['Gross Profit', grossProfit],
        ['Total Operating Expenses', totalExpensesAmount],
        ['Net Profit', netProfit],
        [''],
        ['Total Customer Due Outstanding', totalCustomerDue],
        ['Total Supplier Due Payable', totalSupplierDue],
        ['Inventory Cost Valuation', stockCostValue],
        ['Inventory Retail Valuation', stockSaleValue],
      ];
      exportToCSV(`pnl-report-${Date.now()}`, rows);
    } else if (reportTab === 'products') {
      const rows = [
        ['Business Name', biz.shopName],
        ['Product-wise Sales & Profit Report'],
        ['Product Name', 'Sold Quantity', 'Revenue Generated', 'Net Profit Margin'],
        ...productSalesMap.map(p => [p.name, p.qty, p.revenue, p.profit]),
      ];
      exportToCSV(`product-sales-${Date.now()}`, rows);
    } else if (reportTab === 'expenses') {
      const rows = [
        ['Business Name', biz.shopName],
        ['Expense Category Breakdown'],
        ['Category', 'Total Spent'],
        ...categoryExpenseMap.map(([cat, amt]) => [cat, amt]),
      ];
      exportToCSV(`expense-report-${Date.now()}`, rows);
    } else if (reportTab === 'variants') {
      const rows = [
        ['Business Name', biz.shopName],
        ['Apparel Variant Sales & Profit Report'],
        ['Period', dateRange],
        ['Product Name', 'Variant (Color / Size)', 'SKU', 'Units Sold', 'Revenue', 'Net Profit'],
        ...variantSalesList.map(v => [v.name, v.variantDetails, v.sku, v.qty, v.revenue, v.profit]),
      ];
      exportToCSV(`variant-sales-${Date.now()}`, rows);
    } else if (reportTab === 'dues') {
      const dueCustomers = customers.filter(c => c.currentDue > 0);
      const dueSuppliers = suppliers.filter(s => s.currentDue > 0);
      const rows = [
        ['Business Name', biz.shopName],
        ['Receivable & Payable Due Report'],
        ['Total Customer Receivable Due', totalCustomerDue],
        ['Total Supplier Payable Due', totalSupplierDue],
        [''],
        ['Customer Dues', 'Phone', 'Due Amount'],
        ...dueCustomers.map(c => [c.name, c.mobile, c.currentDue]),
        [''],
        ['Supplier Dues', 'Mobile', 'Payable Amount'],
        ...dueSuppliers.map(s => [s.company, s.mobile, s.currentDue]),
      ];
      exportToCSV(`due-balance-sheet-${Date.now()}`, rows);
    }
  };

  const handlePrintReport = () => {
    const periodLabel = dateRange.toUpperCase();
    if (reportTab === 'products') {
      printFinancialReport(
        'Product-wise Sales & Profit Report',
        periodLabel,
        productSalesMap.map(p => ({
          label: `${p.name} (${p.qty} pcs)`,
          value: `${formatCurrency(p.revenue, lang)} (Net: ${formatCurrency(p.profit, lang)})`,
        })),
        settings,
        activeBranch
      );
      return;
    }

    if (reportTab === 'variants') {
      printFinancialReport(
        'Size & Color Variant Sales Report',
        periodLabel,
        variantSalesList.map(v => ({
          label: `${v.name} — ${v.variantDetails} (${v.qty} pcs)`,
          value: `${formatCurrency(v.revenue, lang)} (Net: ${formatCurrency(v.profit, lang)})`,
        })),
        settings,
        activeBranch
      );
      return;
    }

    if (reportTab === 'expenses') {
      printFinancialReport(
        'Operating Expense Breakdown',
        periodLabel,
        [
          ...categoryExpenseMap.map(([cat, amt]) => ({
            label: cat,
            value: formatCurrency(amt, lang),
          })),
          { label: 'Total Operating Expenses', value: formatCurrency(totalExpensesAmount, lang), highlight: true },
        ],
        settings,
        activeBranch
      );
      return;
    }

    if (reportTab === 'dues') {
      printFinancialReport(
        'Receivable & Payable Balance Summary',
        periodLabel,
        [
          { label: 'Total Customer Receivable Due', value: formatCurrency(totalCustomerDue, lang) },
          { label: 'Total Supplier Payable Due', value: formatCurrency(totalSupplierDue, lang) },
          { label: 'Inventory Cost Valuation', value: formatCurrency(stockCostValue, lang) },
          { label: 'Inventory Retail Valuation', value: formatCurrency(stockSaleValue, lang), highlight: true },
        ],
        settings,
        activeBranch
      );
      return;
    }

    printFinancialReport(
      'Financial Profit & Loss Statement',
      periodLabel,
      [
        { label: `Total Sales Revenue (${filteredSales.length} orders)`, value: formatCurrency(totalSalesRevenue, lang) },
        { label: 'Less: Cost of Goods Sold (COGS)', value: `-${formatCurrency(totalCOGS, lang)}` },
        { label: 'Gross Profit', value: formatCurrency(grossProfit, lang) },
        { label: `Less: Operating Expenses (${filteredExpenses.length} entries)`, value: `-${formatCurrency(totalExpensesAmount, lang)}` },
        { label: 'Net Profit', value: formatCurrency(netProfit, lang), highlight: true },
        { label: 'Customer Receivable Due', value: formatCurrency(totalCustomerDue, lang) },
        { label: 'Supplier Payable Due', value: formatCurrency(totalSupplierDue, lang) },
      ],
      settings,
      activeBranch
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Header & Range Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          {shopLogo && (
            <img
              src={shopLogo}
              alt={biz.shopName}
              className="h-10 max-w-[84px] object-contain shrink-0 rounded-[8px] border border-slate-200 p-0.5 bg-slate-50"
            />
          )}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <span className="p-1.5 rounded-[8px] bg-[#101B3F] text-[#FF9D32]">
                  <TrendingUp className="w-4 h-4" />
                </span>
                <span>{'Profit/Loss & Financial Reports'}</span>
              </h2>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-[6px] bg-[#101B3F]/10 text-[#101B3F] dark:bg-[#FF9D32]/15 dark:text-[#FF9D32] border border-[#FF9D32]/35">
                {biz.shopName}
                {biz.branchName ? ` · ${biz.branchName}` : ''}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              {'Automated P&L accounting, sales & inventory analytics'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Date Range Selector */}
          <div className="flex bg-slate-100 p-0.5 rounded-lg">
            <button
              onClick={() => setDateRange('today')}
              className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                dateRange === 'today' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {'Today'}
            </button>
            <button
              onClick={() => setDateRange('7days')}
              className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                dateRange === '7days' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {'7 Days'}
            </button>
            <button
              onClick={() => setDateRange('month')}
              className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                dateRange === 'month' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {'This Month'}
            </button>
            <button
              onClick={() => setDateRange('year')}
              className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                dateRange === 'year' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {'This Year'}
            </button>
            <button
              onClick={() => setDateRange('all')}
              className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                dateRange === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {'All Time'}
            </button>
          </div>

          <button
            onClick={handlePrintReport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg font-semibold transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{'Print Report'}</span>
          </button>

          {canExportReport && (
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 font-semibold transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-slate-600" />
              <span>{'Export CSV'}</span>
            </button>
          )}
        </div>
      </div>

      {/* P&L Key Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-xs text-slate-500 block">{'Total Revenue'}</span>
          <span className="text-xl md:text-2xl font-bold font-mono-num text-slate-900 mt-1 block">
            {formatCurrency(totalSalesRevenue, lang)}
          </span>
          <span className="text-[11px] text-slate-500 mt-0.5 block">
            {toBnNumber(filteredSales.length, lang)} {'orders'}
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-xs text-slate-500 block">{'Cost of Goods Sold'}</span>
          <span className="text-xl md:text-2xl font-bold font-mono-num text-slate-700 mt-1 block">
            {formatCurrency(totalCOGS, lang)}
          </span>
          <span className="text-[11px] text-slate-500 mt-0.5 block">
            {'Cost of sold items'}
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-xs text-slate-500 block">{'Total Expenses'}</span>
          <span className="text-xl md:text-2xl font-bold font-mono-num text-rose-700 mt-1 block">
            {formatCurrency(totalExpensesAmount, lang)}
          </span>
          <span className="text-[11px] text-slate-500 mt-0.5 block">
            {toBnNumber(filteredExpenses.length, lang)} {'expense entries'}
          </span>
        </div>

        <div className="bg-white rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-xs">
          <span className="text-xs text-emerald-800 font-semibold block">
            {'Net Profit'}
          </span>
          <span className={`text-xl md:text-2xl font-bold font-mono-num mt-1 block ${netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {formatCurrency(netProfit, lang)}
          </span>
          <span className="text-[11px] text-emerald-600 mt-0.5 block">
            {'Gross Margin - Operating Costs'}
          </span>
        </div>
      </div>

      {/* Sub Tab Navigation */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 pb-2 text-xs font-semibold">
        <button
          onClick={() => setReportTab('pnl')}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            reportTab === 'pnl' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {'P&L Statement'}
        </button>
        <button
          onClick={() => setReportTab('products')}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            reportTab === 'products' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {'Product-wise Sales'}
        </button>
        <button
          onClick={() => setReportTab('variants')}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            reportTab === 'variants' ? 'bg-purple-700 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {'Size & Color Variants'}
        </button>
        <button
          onClick={() => setReportTab('expenses')}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            reportTab === 'expenses' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {'Expense Breakdown'}
        </button>
        <button
          onClick={() => setReportTab('dues')}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            reportTab === 'dues' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {'Due & Balance Sheet'}
        </button>
      </div>

      {/* Report Tab Contents */}
      {reportTab === 'pnl' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 max-w-2xl mx-auto space-y-4 text-xs">
          <div className="text-center pb-3 border-b border-slate-200">
            {shopLogo && (
              <img
                src={shopLogo}
                alt={biz.shopName}
                className="h-10 max-w-[110px] object-contain mx-auto mb-1.5"
              />
            )}
            <h3 className="text-base font-bold text-slate-900">{biz.shopName}</h3>
            {biz.tagline && <p className="text-[11px] text-slate-500">{biz.tagline}</p>}
            {biz.branchName && <p className="text-[11px] font-semibold text-emerald-700">Branch: {biz.branchName}</p>}
            {(biz.address || biz.mobile || biz.vatRegistrationNo) && (
              <p className="text-[11px] text-slate-500">
                {[biz.address, biz.mobile ? `Tel: ${biz.mobile}` : '', biz.vatRegistrationNo ? `BIN: ${biz.vatRegistrationNo}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            <p className="text-slate-600 font-semibold mt-1">{'Income Statement'}</p>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
              {'Period:'} {dateRange.toUpperCase()} · {formatDate(now.toISOString(), lang)}
            </p>
          </div>

          <div className="divide-y divide-slate-100 space-y-2">
            {/* Revenue */}
            <div className="pt-2">
              <div className="flex justify-between font-bold text-slate-900 text-sm py-1">
                <span>1. Total Sales Revenue:</span>
                <span className="font-mono-num">{formatCurrency(totalSalesRevenue, lang)}</span>
              </div>
            </div>

            {/* Cost of Goods Sold */}
            <div className="pt-2">
              <div className="flex justify-between text-slate-700 py-1">
                <span>2. Less: Cost of Goods Sold (COGS):</span>
                <span className="font-mono-num font-semibold text-rose-700">-{formatCurrency(totalCOGS, lang)}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-900 py-1.5 bg-slate-50 px-2 rounded">
                <span>Gross Profit:</span>
                <span className="font-mono-num text-emerald-800 text-sm">{formatCurrency(grossProfit, lang)}</span>
              </div>
            </div>

            {/* Operating Expenses */}
            <div className="pt-2 space-y-1">
              <span className="font-semibold text-slate-800 block">3. Operating Expenses:</span>
              {categoryExpenseMap.map(([cat, amt]) => (
                <div key={cat} className="flex justify-between text-slate-600 pl-4 py-0.5">
                  <span>{cat}</span>
                  <span className="font-mono-num">-{formatCurrency(amt, lang)}</span>
                </div>
              ))}
              <div className="flex justify-between font-bold text-slate-800 pt-1 border-t border-slate-200">
                <span>Total Operating Expenses:</span>
                <span className="font-mono-num text-rose-700">-{formatCurrency(totalExpensesAmount, lang)}</span>
              </div>
            </div>

            {/* Net Profit */}
            <div className="pt-3">
              <div className="flex justify-between font-bold text-base text-slate-900 bg-emerald-50/80 p-3 rounded-xl border border-emerald-200">
                <span>Net Profit:</span>
                <span className={`font-mono-num ${netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {formatCurrency(netProfit, lang)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {reportTab === 'products' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">{'Product'}</th>
                <th className="px-4 py-3 font-semibold text-center">{'Sold Qty'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Revenue'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Net Margin'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {productSalesMap.map((p, idx) => (
                <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-900">{p.name}</td>
                  <td className="px-4 py-3 text-center font-mono-num font-bold text-slate-800">{toBnNumber(p.qty, lang)}</td>
                  <td className="px-4 py-3 text-right font-mono-num text-slate-900 font-semibold">{formatCurrency(p.revenue, lang)}</td>
                  <td className="px-4 py-3 text-right font-mono-num font-bold text-emerald-700">{formatCurrency(p.profit, lang)}</td>
                </tr>
              ))}
              {productSalesMap.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400 text-xs">
                    {'No sales records in selected range.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {reportTab === 'expenses' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">{'Category'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Total Spent'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Percentage'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categoryExpenseMap.map(([cat, amt], idx) => {
                const pct = totalExpensesAmount > 0 ? Math.round((amt / totalExpensesAmount) * 100) : 0;
                return (
                  <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 font-semibold text-slate-900">{cat}</td>
                    <td className="px-4 py-3 text-right font-mono-num font-bold text-rose-700">{formatCurrency(amt, lang)}</td>
                    <td className="px-4 py-3 text-right font-mono-num text-slate-600">{toBnNumber(pct, lang)}%</td>
                  </tr>
                );
              })}
              {categoryExpenseMap.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-slate-400 text-xs">
                    {'No expenses in selected range.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {reportTab === 'dues' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="font-bold text-slate-900 text-xs">{'Customer Due'}</span>
              <span className="font-bold font-mono-num text-amber-800 text-sm">{formatCurrency(totalCustomerDue, lang)}</span>
            </div>
            <div className="divide-y max-h-60 overflow-y-auto text-xs">
              {customers.filter(c => c.currentDue > 0).map(c => (
                <div key={c.id} className="py-2 flex justify-between">
                  <span className="text-slate-800 font-medium">{c.name}</span>
                  <span className="font-mono-num font-bold text-amber-800">{formatCurrency(c.currentDue, lang)}</span>
                </div>
              ))}
              {customers.filter(c => c.currentDue > 0).length === 0 && (
                <div className="py-8 text-center text-slate-400 text-xs">
                  {'No outstanding customer dues.'}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="font-bold text-slate-900 text-xs">{'Supplier Due'}</span>
              <span className="font-bold font-mono-num text-rose-800 text-sm">{formatCurrency(totalSupplierDue, lang)}</span>
            </div>
            <div className="divide-y max-h-60 overflow-y-auto text-xs">
              {suppliers.filter(s => s.currentDue > 0).map(s => (
                <div key={s.id} className="py-2 flex justify-between">
                  <span className="text-slate-800 font-medium">{s.company}</span>
                  <span className="font-mono-num font-bold text-rose-800">{formatCurrency(s.currentDue, lang)}</span>
                </div>
              ))}
              {suppliers.filter(s => s.currentDue > 0).length === 0 && (
                <div className="py-8 text-center text-slate-400 text-xs">
                  {'No outstanding supplier dues.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Apparel Variants Report Tab */}
      {reportTab === 'variants' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Size Breakdown */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 border-b pb-2 flex items-center justify-between">
                <span>Top Selling Clothing Sizes</span>
                <span className="text-[11px] text-slate-500 font-normal">By volume (pcs)</span>
              </h3>

              <div className="space-y-2">
                {sizePerformanceMap.length > 0 ? (
                  sizePerformanceMap.map(([size, stat]) => {
                    const totalUnits = sizePerformanceMap.reduce((s, [, st]) => s + st.qty, 0);
                    const pct = totalUnits > 0 ? Math.round((stat.qty / totalUnits) * 100) : 0;

                    return (
                      <div key={size} className="space-y-1 text-xs">
                        <div className="flex justify-between items-center font-mono">
                          <span className="font-bold text-slate-900">Size: {size}</span>
                          <span className="font-semibold text-slate-700">
                            {stat.qty} pcs ({pct}%) · {formatCurrency(stat.revenue, lang)}
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-purple-600 h-2 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-slate-400 text-xs py-6 text-center">
                    No variant sales recorded yet in selected period.
                  </div>
                )}
              </div>
            </div>

            {/* Color Breakdown */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 border-b pb-2 flex items-center justify-between">
                <span>Top Selling Apparel Colors</span>
                <span className="text-[11px] text-slate-500 font-normal">By volume (pcs)</span>
              </h3>

              <div className="space-y-2">
                {colorPerformanceMap.length > 0 ? (
                  colorPerformanceMap.map(([color, stat]) => {
                    const totalUnits = colorPerformanceMap.reduce((s, [, st]) => s + st.qty, 0);
                    const pct = totalUnits > 0 ? Math.round((stat.qty / totalUnits) * 100) : 0;

                    return (
                      <div key={color} className="space-y-1 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-900">{color}</span>
                          <span className="font-semibold text-slate-700 font-mono">
                            {stat.qty} pcs ({pct}%) · {formatCurrency(stat.revenue, lang)}
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-indigo-600 h-2 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-slate-400 text-xs py-6 text-center">
                    No variant sales recorded yet in selected period.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Top Selling Variants Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-3 border-b border-slate-200 bg-slate-50 font-bold text-xs text-slate-900">
              Detailed Variant Sales &amp; Profit Report
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Product Name</th>
                    <th className="py-2.5 px-3">Variant (Color / Size)</th>
                    <th className="py-2.5 px-3">SKU</th>
                    <th className="py-2.5 px-3 text-center">Units Sold</th>
                    <th className="py-2.5 px-3 text-right">Revenue</th>
                    <th className="py-2.5 px-3 text-right">Net Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {variantSalesList.map((v, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-semibold text-slate-900">{v.name}</td>
                      <td className="py-2 px-3 font-mono text-purple-700">{v.variantDetails}</td>
                      <td className="py-2 px-3 font-mono text-slate-500">{v.sku}</td>
                      <td className="py-2 px-3 text-center font-bold font-mono">{v.qty} pcs</td>
                      <td className="py-2 px-3 text-right font-mono-num font-bold text-slate-900">
                        {formatCurrency(v.revenue, lang)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-num font-bold text-emerald-700">
                        {formatCurrency(v.profit, lang)}
                      </td>
                    </tr>
                  ))}
                  {variantSalesList.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                        No apparel variant sales found for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
