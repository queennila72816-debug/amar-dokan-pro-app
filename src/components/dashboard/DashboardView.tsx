import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { resolveBusinessProfile } from '../../config/appIdentity';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { getShopLogo } from '../../utils/printEngine';
import {
  computeDashboardMetrics,
  DailyAnalyticsPoint,
  DashboardTimeRange,
} from '../../utils/dashboardMetrics';
import {
  TrendingUp,
  ShoppingBag,
  AlertTriangle,
  Users,
  Wallet,
  Boxes,
  ArrowUpRight,
  ArrowDownRight,
  ShoppingCart,
  Receipt,
  Calculator,
  Store,
  BarChart3,
  Building2,
  PackageCheck,
  ArrowRightLeft,
  Flame,
} from 'lucide-react';

interface DashboardViewProps {
  onNavigate: (tab: string) => void;
  onOpenPOS: () => void;
  onOpenAddProduct: () => void;
  onOpenAddCustomer: () => void;
  onOpenNewPurchase: () => void;
  onOpenAddExpense: () => void;
}

const RANGE_OPTIONS: { id: DashboardTimeRange; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 Days' },
  { id: '30d', label: '30 Days' },
  { id: 'all', label: 'All Time' },
];

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigate,
  onOpenPOS,
  onOpenAddProduct,
  onOpenAddCustomer,
  onOpenNewPurchase,
  onOpenAddExpense,
}) => {
  const {
    settings,
    products,
    sales,
    purchases,
    expenses,
    customers,
    suppliers,
    accounts,
    accountTransactions,
    branches,
    activeBranchId,
    currentUserRole,
    hasPermission,
  } = useApp();

  const [timeRange, setTimeRange] = useState<DashboardTimeRange>('today');
  const [chartDays, setChartDays] = useState<7 | 14 | 30>(14);
  const [hoveredChartIdx, setHoveredChartIdx] = useState<number | null>(null);

  const canViewProfit = hasPermission('profit_loss_reports', 'view');
  const isStaffMasked = !canViewProfit || currentUserRole === 'salesman' || currentUserRole === 'cashier';
  const lang = settings.language;
  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];
  const biz = resolveBusinessProfile(settings, activeBranch);
  const shopLogo = getShopLogo(settings);
  const isEasyMode = settings.uiMode === 'easy';

  const metrics = useMemo(
    () =>
      computeDashboardMetrics({
        sales,
        purchases,
        expenses,
        products,
        customers,
        suppliers,
        accounts,
        branches,
        range: timeRange,
        chartDays,
      }),
    [sales, purchases, expenses, products, customers, suppliers, accounts, branches, timeRange, chartDays]
  );

  // Unified recent transactions strictly from real sales, purchases, expenses, and account transactions
  const recentTransactions = useMemo(() => {
    const items: {
      id: string;
      date: string;
      title: string;
      subtitle: string;
      amount: number;
      direction: 'in' | 'out';
      badge: string;
      badgeClass: string;
    }[] = [];

    if (accountTransactions.length > 0) {
      accountTransactions.slice(0, 8).forEach(tx => {
        const isIn =
          tx.type === 'sale_payment' ||
          tx.type === 'customer_payment' ||
          tx.type === 'transfer_in';
        items.push({
          id: tx.id,
          date: tx.date,
          title: tx.accountName || 'Account Entry',
          subtitle: tx.note || tx.type.replace(/_/g, ' '),
          amount: Math.abs(tx.amount),
          direction: isIn ? 'in' : 'out',
          badge: tx.type.replace(/_/g, ' '),
          badgeClass: isIn
            ? 'bg-emerald-50 text-[#10B981] dark:bg-emerald-950/50'
            : 'bg-rose-50 text-[#F06464] dark:bg-rose-950/50',
        });
      });
    } else {
      sales.slice(0, 4).forEach(s => {
        items.push({
          id: `s-${s.id}`,
          date: s.date,
          title: `Sale ${s.invoiceNumber}`,
          subtitle: s.customerName,
          amount: s.paid || s.total,
          direction: 'in',
          badge: 'Sale',
          badgeClass: 'bg-emerald-50 text-[#10B981] dark:bg-emerald-950/50',
        });
      });
      purchases.slice(0, 3).forEach(p => {
        items.push({
          id: `p-${p.id}`,
          date: p.date,
          title: `PO ${p.invoiceNumber}`,
          subtitle: p.supplierName,
          amount: p.paid || p.total,
          direction: 'out',
          badge: 'Purchase',
          badgeClass: 'bg-blue-50 text-[#4169E1] dark:bg-blue-950/50',
        });
      });
      expenses.slice(0, 3).forEach(e => {
        items.push({
          id: `e-${e.id}`,
          date: e.date,
          title: e.category,
          subtitle: e.paidTo || e.note || e.paymentMethod,
          amount: e.amount,
          direction: 'out',
          badge: 'Expense',
          badgeClass: 'bg-rose-50 text-[#F06464] dark:bg-rose-950/50',
        });
      });
    }

    return items
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 7);
  }, [accountTransactions, sales, purchases, expenses]);

  const maxSalesChartVal = useMemo(
    () => Math.max(1, ...metrics.dailySeries.map(d => d.salesAmount)),
    [metrics.dailySeries]
  );
  const maxPurchaseChartVal = useMemo(
    () => Math.max(1, ...metrics.dailySeries.map(d => d.purchaseAmount)),
    [metrics.dailySeries]
  );
  const maxPLChartVal = useMemo(
    () =>
      Math.max(
        1,
        ...metrics.dailySeries.map(d =>
          Math.max(d.salesAmount, d.cogsAmount + d.expenseAmount, Math.abs(d.netProfit))
        )
      ),
    [metrics.dailySeries]
  );

  const hasSalesSeriesData = metrics.dailySeries.some(d => d.salesAmount > 0);
  const hasPurchaseSeriesData = metrics.dailySeries.some(d => d.purchaseAmount > 0);
  const hasPLSeriesData = metrics.dailySeries.some(
    d => d.salesAmount > 0 || d.expenseAmount > 0 || d.cogsAmount > 0
  );

  const rangeLabel = RANGE_OPTIONS.find(r => r.id === timeRange)?.label || 'Today';

  return (
    <div className="space-y-6">
      {/* Top Executive Banner / Business Identity Header */}
      <div className="adp-card p-5 md:p-6 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          {shopLogo ? (
            <div className="w-12 h-12 rounded-[12px] border border-[#E2E8F0] dark:border-[#243B70] bg-[#F5F7FC] dark:bg-[#0D1736] flex items-center justify-center overflow-hidden shrink-0">
              <img src={shopLogo} alt={biz.shopName} className="max-w-full max-h-full object-contain p-1" />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-[12px] bg-[#101B3F] bg-gradient-to-br from-[#101B3F] to-[#243B70] border border-[#FF9D32]/45 text-[#FF9D32] flex items-center justify-center shrink-0 shadow-sm">
              <Store className="w-6 h-6" />
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-bold text-[#172033] dark:text-white tracking-tight truncate">
                {biz.shopName}
              </h1>
              {biz.branchName && (
                <span className="text-[11px] font-semibold text-[#087F8C] dark:text-[#5EEAD4] bg-[#087F8C]/10 border border-[#087F8C]/25 px-2.5 py-0.5 rounded-[8px]">
                  {biz.branchName}
                </span>
              )}
              {isEasyMode && (
                <span className="text-[11px] font-semibold text-[#D97706] dark:text-[#FBBF24] bg-amber-500/10 border border-amber-500/25 px-2.5 py-0.5 rounded-[8px]">
                  Easy Mode
                </span>
              )}
            </div>
            {(biz.tagline || biz.address || biz.mobile || biz.vatRegistrationNo) && (
              <p className="text-xs text-[#64748B] dark:text-slate-400 mt-0.5 truncate">
                {[
                  biz.tagline,
                  biz.address,
                  biz.mobile ? `Tel: ${biz.mobile}` : '',
                  biz.vatRegistrationNo ? `BIN: ${biz.vatRegistrationNo}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            <p className="text-xs text-[#64748B] dark:text-slate-400 mt-1">
              {`Today: ${formatDate(new Date().toISOString(), 'en')} · Live Financial & Inventory Intelligence`}
            </p>
          </div>
        </div>

        {/* Quick Action Shortcut Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onOpenPOS}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-[#087F8C] bg-gradient-to-r from-[#087F8C] to-[#10B981] hover:brightness-110 rounded-[10px] shadow-sm shadow-[#087F8C]/25 transition-all cursor-pointer"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>New Sale</span>
          </button>
          <button
            onClick={onOpenNewPurchase}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#4169E1] dark:text-[#93C5FD] bg-[#4169E1]/10 hover:bg-[#4169E1]/15 rounded-[10px] border border-[#4169E1]/25 transition-colors cursor-pointer"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Purchase</span>
          </button>
          <button
            onClick={() => onNavigate('pricing-calculator')}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#087F8C] dark:text-[#5EEAD4] bg-[#087F8C]/10 hover:bg-[#087F8C]/15 rounded-[10px] border border-[#087F8C]/25 transition-colors cursor-pointer"
          >
            <Calculator className="w-4 h-4" />
            <span>Price Calculator</span>
          </button>
          <button
            onClick={onOpenAddProduct}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#6366F1] dark:text-[#A5B4FC] bg-[#6366F1]/10 hover:bg-[#6366F1]/15 rounded-[10px] border border-[#6366F1]/25 transition-colors cursor-pointer"
          >
            <Boxes className="w-4 h-4" />
            <span>Add Product</span>
          </button>
          <button
            onClick={onOpenAddCustomer}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#06B6D4] dark:text-[#67E8F9] bg-[#06B6D4]/10 hover:bg-[#06B6D4]/15 rounded-[10px] border border-[#06B6D4]/25 transition-colors cursor-pointer"
          >
            <Users className="w-4 h-4" />
            <span>Customer</span>
          </button>
          <button
            onClick={onOpenAddExpense}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#F06464] dark:text-[#FCA5A5] bg-[#F06464]/10 hover:bg-[#F06464]/15 rounded-[10px] border border-[#F06464]/25 transition-colors cursor-pointer"
          >
            <Wallet className="w-4 h-4" />
            <span>Expense</span>
          </button>
        </div>
      </div>

      {/* Period Filter Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
            Executive KPIs ({rangeLabel})
          </span>
        </div>
        <div className="inline-flex items-center p-1 rounded-[10px] bg-white dark:bg-[#101B35] border border-[#E2E8F0] dark:border-[#1F3158] shadow-2xs">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setTimeRange(opt.id)}
              className={`px-3 py-1 rounded-[8px] text-xs font-semibold transition-all cursor-pointer ${
                timeRange === opt.id
                  ? 'bg-[#101B35] dark:bg-[#D6AD60] text-white dark:text-[#0B1428] shadow-xs'
                  : 'text-[#64748B] dark:text-slate-400 hover:text-[#172033] dark:hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 6 GRADIENT KPI CARDS (100% Real Database Calculations) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {/* 1. Total Sales (Emerald) */}
        <button
          type="button"
          onClick={() => onNavigate('sales')}
          className="text-left rounded-[14px] p-4 text-white bg-[#10B981] bg-gradient-to-br from-[#10B981] to-[#059669] shadow-md shadow-[#10B981]/20 hover:translate-y-[-2px] transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#ECFDF5]">
              Total Sales
            </span>
            <span className="p-1.5 rounded-[8px] bg-white/20">
              <TrendingUp className="w-4 h-4 text-white" />
            </span>
          </div>
          <div className="mt-2.5 text-xl font-bold font-mono-num tracking-tight">
            {formatCurrency(metrics.salesTotal, lang)}
          </div>
          <div className="mt-1.5 text-[11px] text-[#ECFDF5] font-medium">
            {metrics.salesCount} {metrics.salesCount === 1 ? 'invoice' : 'invoices'} · {rangeLabel}
          </div>
        </button>

        {/* 2. Total Purchases (Royal Blue) */}
        <button
          type="button"
          onClick={() => onNavigate('purchases')}
          className="text-left rounded-[14px] p-4 text-white bg-[#4169E1] bg-gradient-to-br from-[#4169E1] to-[#284BC2] shadow-md shadow-[#4169E1]/20 hover:translate-y-[-2px] transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#EFF6FF]">
              Total Purchases
            </span>
            <span className="p-1.5 rounded-[8px] bg-white/20">
              <ShoppingBag className="w-4 h-4 text-white" />
            </span>
          </div>
          <div className="mt-2.5 text-xl font-bold font-mono-num tracking-tight">
            {formatCurrency(metrics.purchasesTotal, lang)}
          </div>
          <div className="mt-1.5 text-[11px] text-[#EFF6FF] font-medium">
            {metrics.purchasesCount} PO{metrics.purchasesCount === 1 ? '' : 's'} · {rangeLabel}
          </div>
        </button>

        {/* 3. Total Profit (Teal) */}
        <button
          type="button"
          onClick={() => onNavigate('reports')}
          className="text-left rounded-[14px] p-4 text-white bg-[#087F8C] bg-gradient-to-br from-[#087F8C] to-[#055B65] shadow-md shadow-[#087F8C]/20 hover:translate-y-[-2px] transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#F0FDFA]">
              Total Profit
            </span>
            <span className="p-1.5 rounded-[8px] bg-white/20">
              <ArrowUpRight className="w-4 h-4 text-white" />
            </span>
          </div>
          <div className="mt-2.5 text-xl font-bold font-mono-num tracking-tight">
            {isStaffMasked ? '•••' : formatCurrency(metrics.netProfit, lang)}
          </div>
          <div className="mt-1.5 text-[11px] text-[#F0FDFA] font-medium">
            {isStaffMasked ? 'Restricted access' : `Gross: ${formatCurrency(metrics.grossProfit, lang)}`}
          </div>
        </button>

        {/* 4. Total Expenses (Coral) */}
        <button
          type="button"
          onClick={() => onNavigate('accounts')}
          className="text-left rounded-[14px] p-4 text-white bg-[#E24E4E] bg-gradient-to-br from-[#F06464] to-[#D44444] shadow-md shadow-[#F06464]/20 hover:translate-y-[-2px] transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#FFF1F2]">
              Total Expenses
            </span>
            <span className="p-1.5 rounded-[8px] bg-white/20">
              <ArrowDownRight className="w-4 h-4 text-white" />
            </span>
          </div>
          <div className="mt-2.5 text-xl font-bold font-mono-num tracking-tight">
            {formatCurrency(metrics.expensesTotal, lang)}
          </div>
          <div className="mt-1.5 text-[11px] text-[#FFF1F2] font-medium">
            {metrics.expensesCount} entries · {rangeLabel}
          </div>
        </button>

        {/* 5. Total Due (Amber) */}
        <button
          type="button"
          onClick={() => onNavigate('customers')}
          className="text-left rounded-[14px] p-4 text-white bg-[#D97706] bg-gradient-to-br from-[#F59E0B] to-[#D97706] shadow-md shadow-[#F59E0B]/20 hover:translate-y-[-2px] transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#FFFBEB]">
              Total Due
            </span>
            <span className="p-1.5 rounded-[8px] bg-white/20">
              <Users className="w-4 h-4 text-white" />
            </span>
          </div>
          <div className="mt-2.5 text-xl font-bold font-mono-num tracking-tight">
            {formatCurrency(metrics.totalCustomerDue, lang)}
          </div>
          <div className="mt-1.5 text-[11px] text-[#FFFBEB] font-medium truncate">
            {metrics.dueCustomersCount} due · Payable {formatCurrency(metrics.totalSupplierDue, lang)}
          </div>
        </button>

        {/* 6. Total Stock Value (Royal Purple) */}
        <button
          type="button"
          onClick={() => onNavigate('inventory')}
          className="text-left rounded-[14px] p-4 text-white bg-[#7357D9] bg-gradient-to-br from-[#7357D9] to-[#563AB8] shadow-md shadow-[#7357D9]/20 hover:translate-y-[-2px] transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#FAF5FF]">
              Stock Value
            </span>
            <span className="p-1.5 rounded-[8px] bg-white/20">
              <Boxes className="w-4 h-4 text-white" />
            </span>
          </div>
          <div className="mt-2.5 text-xl font-bold font-mono-num tracking-tight">
            {formatCurrency(metrics.totalStockValue, lang)}
          </div>
          <div className="mt-1.5 text-[11px] text-[#FAF5FF] font-medium truncate">
            {metrics.totalStockUnits} pcs · Retail {formatCurrency(metrics.totalRetailStockValue, lang)}
          </div>
        </button>
      </div>

      {/* Critical Alerts (Loss-Making Pricing & Stock Alerts) */}
      {(metrics.lossMakingProducts.length > 0 ||
        metrics.lowStockProducts.length > 0 ||
        metrics.outOfStockProducts.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {metrics.lossMakingProducts.length > 0 && (
            <div className="adp-card p-4 bg-rose-50/90 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-[10px] bg-[#F06464]/15 text-[#F06464] shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-rose-950 dark:text-rose-100">
                    Loss-Making Pricing Alert · {metrics.lossMakingProducts.length} Product{metrics.lossMakingProducts.length === 1 ? '' : 's'}
                  </h4>
                  <p className="text-xs text-rose-800 dark:text-rose-200/80 mt-0.5">
                    Priced below total unit break-even cost. Review fair selling price now.
                  </p>
                </div>
              </div>
              <button
                onClick={() => onNavigate('pricing-calculator')}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#F06464] hover:brightness-110 rounded-[10px] self-start sm:self-auto transition-all whitespace-nowrap cursor-pointer"
              >
                Open Price Calculator
              </button>
            </div>
          )}

          {(metrics.lowStockProducts.length > 0 || metrics.outOfStockProducts.length > 0) && (
            <div className="adp-card p-4 bg-amber-50/90 dark:bg-amber-950/25 border-amber-300 dark:border-amber-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-[10px] bg-[#F59E0B]/15 text-[#D97706] dark:text-[#FBBF24] shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-amber-950 dark:text-amber-100">
                    Inventory Stock Alert
                  </h4>
                  <p className="text-xs text-amber-800 dark:text-amber-200/80 mt-0.5">
                    {metrics.lowStockProducts.length} items low in stock · {metrics.outOfStockProducts.length} items out of stock.
                  </p>
                </div>
              </div>
              <button
                onClick={() => onNavigate('reorder')}
                className="px-3.5 py-1.5 text-xs font-bold text-amber-950 dark:text-amber-100 bg-amber-200/70 dark:bg-amber-900/50 hover:bg-amber-300/70 rounded-[10px] border border-amber-400/40 self-start sm:self-auto transition-all whitespace-nowrap cursor-pointer"
              >
                Smart Reorder
              </button>
            </div>
          )}
        </div>
      )}

      {/* 3 REAL-DATA ANALYTICS CHARTS */}
      <div className="adp-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-[8px] bg-[#101B35] text-[#D6AD60]">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#172033] dark:text-white">
                Financial &amp; Operations Analytics
              </h2>
              <p className="text-[11px] text-[#64748B] dark:text-slate-400">
                Real-time daily trends calculated from your recorded sales, purchases, and expenses
              </p>
            </div>
          </div>

          <div className="inline-flex items-center p-1 rounded-[10px] bg-[#F1F4F9] dark:bg-[#0B1428] border border-[#E2E8F0] dark:border-[#1F3158]">
            {([7, 14, 30] as const).map(days => (
              <button
                key={days}
                type="button"
                onClick={() => setChartDays(days)}
                className={`px-2.5 py-1 rounded-[7px] text-[11px] font-semibold transition-all cursor-pointer ${
                  chartDays === days
                    ? 'bg-[#087F8C] text-white shadow-2xs'
                    : 'text-[#64748B] dark:text-slate-400 hover:text-[#172033] dark:hover:text-white'
                }`}
              >
                {days}D
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 pt-1">
          {/* Chart 1: Sales Analytics */}
          <AnalyticsBarChartCard
            title="Sales Analytics"
            subtitle={`Last ${chartDays} days revenue`}
            accentColor="#10B981"
            secondaryColor="#059669"
            hasData={hasSalesSeriesData}
            emptyLabel="No sales recorded in this period yet"
            series={metrics.dailySeries}
            maxValue={maxSalesChartVal}
            hoveredIdx={hoveredChartIdx}
            onHover={setHoveredChartIdx}
            getValue={d => d.salesAmount}
            formatVal={v => formatCurrency(v, lang)}
            getDetail={d => `${d.salesCount} order${d.salesCount === 1 ? '' : 's'}`}
          />

          {/* Chart 2: Purchase Analytics */}
          <AnalyticsBarChartCard
            title="Purchase Analytics"
            subtitle={`Last ${chartDays} days procurement`}
            accentColor="#4169E1"
            secondaryColor="#284BC2"
            hasData={hasPurchaseSeriesData}
            emptyLabel="No purchase orders in this period yet"
            series={metrics.dailySeries}
            maxValue={maxPurchaseChartVal}
            hoveredIdx={hoveredChartIdx}
            onHover={setHoveredChartIdx}
            getValue={d => d.purchaseAmount}
            formatVal={v => formatCurrency(v, lang)}
            getDetail={d => `${d.purchaseCount} PO${d.purchaseCount === 1 ? '' : 's'}`}
          />

          {/* Chart 3: Profit & Loss Chart */}
          <div className="rounded-[12px] p-4 bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] flex flex-col justify-between">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-bold text-[#172033] dark:text-white">
                  Profit &amp; Loss Overview
                </h3>
                <p className="text-[11px] text-[#64748B] dark:text-slate-400">
                  Revenue vs Cost + Expenses
                </p>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-semibold">
                <span className="inline-flex items-center gap-1 text-[#10B981]">
                  <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                  Rev
                </span>
                <span className="inline-flex items-center gap-1 text-[#F06464]">
                  <span className="w-2 h-2 rounded-full bg-[#F06464]" />
                  Cost
                </span>
              </div>
            </div>

            {isStaffMasked ? (
              <div className="h-40 flex flex-col items-center justify-center text-center text-xs text-[#64748B] dark:text-slate-400 border border-dashed border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px]">
                <span>Profit &amp; Loss chart hidden for current role</span>
              </div>
            ) : !hasPLSeriesData ? (
              <div className="h-40 flex flex-col items-center justify-center text-center text-xs text-[#64748B] dark:text-slate-400 border border-dashed border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] px-4">
                <span>No revenue or expense activity in this period yet</span>
              </div>
            ) : (
              <div>
                <div className="h-36 flex items-end gap-1 pt-2">
                  {metrics.dailySeries.map((pt, idx) => {
                    const revPct = Math.round((pt.salesAmount / maxPLChartVal) * 100);
                    const costTotal = pt.cogsAmount + pt.expenseAmount;
                    const costPct = Math.round((costTotal / maxPLChartVal) * 100);
                    const isHovered = hoveredChartIdx === idx;
                    return (
                      <div
                        key={pt.dateKey}
                        onMouseEnter={() => setHoveredChartIdx(idx)}
                        onMouseLeave={() => setHoveredChartIdx(null)}
                        className="flex-1 h-full flex flex-col justify-end items-center gap-0.5 group relative cursor-pointer"
                        title={`${pt.label} | Rev: ${formatCurrency(pt.salesAmount, lang)} | Cost+Exp: ${formatCurrency(costTotal, lang)} | Net: ${formatCurrency(pt.netProfit, lang)}`}
                      >
                        <div className="w-full h-full flex items-end justify-center gap-[2px]">
                          <div
                            style={{ height: `${Math.max(pt.salesAmount > 0 ? 6 : 2, revPct)}%` }}
                            className={`flex-1 rounded-t-[3px] transition-all ${
                              isHovered ? 'bg-[#10B981]' : 'bg-[#10B981]/80'
                            }`}
                          />
                          <div
                            style={{ height: `${Math.max(costTotal > 0 ? 6 : 2, costPct)}%` }}
                            className={`flex-1 rounded-t-[3px] transition-all ${
                              isHovered ? 'bg-[#F06464]' : 'bg-[#F06464]/75'
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#64748B] dark:text-slate-400 mt-2 font-mono-num">
                  <span>{metrics.dailySeries[0]?.label}</span>
                  <span>
                    {hoveredChartIdx !== null && metrics.dailySeries[hoveredChartIdx]
                      ? `${metrics.dailySeries[hoveredChartIdx].label}: Net ${formatCurrency(
                          metrics.dailySeries[hoveredChartIdx].netProfit,
                          lang
                        )}`
                      : `Avg Net: ${formatCurrency(
                          metrics.dailySeries.reduce((s, d) => s + d.netProfit, 0) /
                            Math.max(1, metrics.dailySeries.length),
                          lang
                        )}/day`}
                  </span>
                  <span>{metrics.dailySeries[metrics.dailySeries.length - 1]?.label}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Operational Grid: Recent Sales & Recent Purchases */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Sales */}
        <div className="adp-card overflow-hidden">
          <div className="p-4 border-b border-[#E2E8F0] dark:border-[#1F3158] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-[8px] bg-[#10B981]/15 text-[#10B981]">
                <Receipt className="w-4 h-4" />
              </span>
              <h3 className="text-sm font-bold text-[#172033] dark:text-white">Recent Sales</h3>
            </div>
            <button
              onClick={() => onNavigate('sales')}
              className="text-xs font-semibold text-[#10B981] hover:underline cursor-pointer"
            >
              View All →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F8FAFC] dark:bg-[#0E182E] border-b border-[#E2E8F0] dark:border-[#1F3158] text-[#64748B] dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Invoice #</th>
                  <th className="px-4 py-2.5 font-semibold">Customer</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Due</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158]">
                {sales.slice(0, 5).map(sale => (
                  <tr key={sale.id} className="hover:bg-[#F8FAFC] dark:hover:bg-[#162344]/60 transition-colors">
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#172033] dark:text-white whitespace-nowrap">
                      {sale.invoiceNumber}
                    </td>
                    <td className="px-4 py-2.5 text-[#172033] dark:text-slate-200 truncate max-w-[140px]">
                      {sale.customerName}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono-num font-bold text-[#172033] dark:text-white">
                      {formatCurrency(sale.total, lang)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono-num text-[#F59E0B]">
                      {sale.due > 0 ? formatCurrency(sale.due, lang) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-[6px] uppercase ${
                          sale.status === 'paid'
                            ? 'bg-emerald-500/15 text-[#10B981]'
                            : sale.status === 'due'
                            ? 'bg-rose-500/15 text-[#F06464]'
                            : sale.status === 'partial'
                            ? 'bg-amber-500/15 text-[#F59E0B]'
                            : 'bg-slate-500/15 text-slate-500'
                        }`}
                      >
                        {sale.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {sales.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[#64748B] dark:text-slate-400">
                      No sales recorded yet. Create your first invoice from POS.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Purchases */}
        <div className="adp-card overflow-hidden">
          <div className="p-4 border-b border-[#E2E8F0] dark:border-[#1F3158] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-[8px] bg-[#4169E1]/15 text-[#4169E1]">
                <ShoppingBag className="w-4 h-4" />
              </span>
              <h3 className="text-sm font-bold text-[#172033] dark:text-white">Recent Purchases</h3>
            </div>
            <button
              onClick={() => onNavigate('purchases')}
              className="text-xs font-semibold text-[#4169E1] hover:underline cursor-pointer"
            >
              View All →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F8FAFC] dark:bg-[#0E182E] border-b border-[#E2E8F0] dark:border-[#1F3158] text-[#64748B] dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">PO #</th>
                  <th className="px-4 py-2.5 font-semibold">Supplier</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Due</th>
                  <th className="px-4 py-2.5 font-semibold">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158]">
                {purchases.slice(0, 5).map(po => (
                  <tr key={po.id} className="hover:bg-[#F8FAFC] dark:hover:bg-[#162344]/60 transition-colors">
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#172033] dark:text-white whitespace-nowrap">
                      {po.invoiceNumber}
                    </td>
                    <td className="px-4 py-2.5 text-[#172033] dark:text-slate-200 truncate max-w-[140px]">
                      {po.supplierName}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono-num font-bold text-[#172033] dark:text-white">
                      {formatCurrency(po.total, lang)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono-num text-[#F06464]">
                      {po.due > 0 ? formatCurrency(po.due, lang) : '—'}
                    </td>
                    <td className="px-4 py-2.5 capitalize text-[#64748B] dark:text-slate-400">
                      {po.paymentMethod}
                    </td>
                  </tr>
                ))}
                {purchases.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[#64748B] dark:text-slate-400">
                      No purchase orders recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bottom Operational Row: Low Stock, Top Selling Products, Branch Performance & Recent Transactions / Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Top Selling Products */}
        <div className="adp-card p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0] dark:border-[#1F3158]">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-[8px] bg-[#6366F1]/15 text-[#6366F1]">
                  <Flame className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-bold text-[#172033] dark:text-white">Top Selling Products</h3>
              </div>
              <button
                onClick={() => onNavigate('products')}
                className="text-xs font-semibold text-[#6366F1] hover:underline cursor-pointer"
              >
                Catalog →
              </button>
            </div>
            <div className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158] mt-1">
              {metrics.topSellingProducts.map((item, idx) => (
                <div key={item.productId} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-5 h-5 rounded-[6px] bg-[#101B35] text-[#D6AD60] font-mono-num text-[10px] font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-[#172033] dark:text-white truncate">
                        {item.productName}
                      </p>
                      <p className="text-[10px] text-[#64748B] dark:text-slate-400 font-mono-num">
                        {item.quantitySold} sold {item.sku ? `· ${item.sku}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono-num font-bold text-[#10B981] shrink-0">
                    {formatCurrency(item.revenue, lang)}
                  </span>
                </div>
              ))}
              {metrics.topSellingProducts.length === 0 && (
                <div className="py-8 text-center text-xs text-[#64748B] dark:text-slate-400">
                  Top products appear automatically after sales are recorded.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Low Stock Products */}
        <div className="adp-card p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0] dark:border-[#1F3158]">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-[8px] bg-[#7357D9]/15 text-[#7357D9]">
                  <PackageCheck className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-bold text-[#172033] dark:text-white">Low Stock Products</h3>
              </div>
              <button
                onClick={() => onNavigate('inventory')}
                className="text-xs font-semibold text-[#7357D9] hover:underline cursor-pointer"
              >
                Inventory →
              </button>
            </div>

            <div className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158] mt-1">
              {metrics.criticalStockProducts.slice(0, 6).map(prod => (
                <div key={prod.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#172033] dark:text-white truncate">{prod.name}</p>
                    <p className="text-[10px] text-[#64748B] dark:text-slate-400">
                      {prod.category} · Min alert: {prod.minStockAlert} {prod.unit}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-[6px] font-mono-num text-[11px] font-bold shrink-0 ${
                      prod.currentStock <= 0
                        ? 'bg-rose-500/15 text-[#F06464]'
                        : 'bg-amber-500/15 text-[#F59E0B]'
                    }`}
                  >
                    {prod.currentStock} {prod.unit}
                  </span>
                </div>
              ))}
              {metrics.criticalStockProducts.length === 0 && (
                <div className="py-8 text-center text-xs text-[#64748B] dark:text-slate-400">
                  All active products are well stocked above minimum alert levels.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Recent Transactions & Cash/Bank Snapshot */}
        <div className="adp-card p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0] dark:border-[#1F3158]">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-[8px] bg-[#087F8C]/15 text-[#087F8C]">
                  <ArrowRightLeft className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-bold text-[#172033] dark:text-white">Recent Transactions</h3>
              </div>
              <button
                onClick={() => onNavigate('accounts')}
                className="text-xs font-semibold text-[#087F8C] hover:underline cursor-pointer"
              >
                Ledger →
              </button>
            </div>

            <div className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158] mt-1">
              {recentTransactions.slice(0, 5).map(tx => (
                <div key={tx.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-[#172033] dark:text-white truncate">
                        {tx.title}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${tx.badgeClass}`}>
                        {tx.badge}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#64748B] dark:text-slate-400 truncate">
                      {tx.subtitle} · {formatDate(tx.date, lang)}
                    </p>
                  </div>
                  <span
                    className={`font-mono-num font-bold shrink-0 ${
                      tx.direction === 'in' ? 'text-[#10B981]' : 'text-[#F06464]'
                    }`}
                  >
                    {tx.direction === 'in' ? '+' : '-'}{formatCurrency(tx.amount, lang)}
                  </span>
                </div>
              ))}
              {recentTransactions.length === 0 && (
                <div className="py-8 text-center text-xs text-[#64748B] dark:text-slate-400">
                  No financial transactions recorded yet.
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-[#E2E8F0] dark:border-[#1F3158] mt-3">
            <div className="flex items-center justify-between text-xs font-bold text-[#172033] dark:text-white">
              <span>Liquid Cash &amp; Bank ({accounts.length})</span>
              <span className="font-mono-num text-[#10B981] text-sm">
                {formatCurrency(metrics.totalAccountBalance, lang)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Branch Performance Table */}
      <div className="adp-card overflow-hidden">
        <div className="p-4 border-b border-[#E2E8F0] dark:border-[#1F3158] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-[8px] bg-[#101B35] text-[#D6AD60]">
              <Building2 className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-[#172033] dark:text-white">Branch Performance</h3>
              <p className="text-[11px] text-[#64748B] dark:text-slate-400">
                Revenue, order volume, and payables across configured outlets
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('branches')}
            className="text-xs font-semibold text-[#087F8C] hover:underline cursor-pointer"
          >
            Manage Branches →
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F8FAFC] dark:bg-[#0E182E] border-b border-[#E2E8F0] dark:border-[#1F3158] text-[#64748B] dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Branch</th>
                <th className="px-4 py-2.5 font-semibold">Location</th>
                <th className="px-4 py-2.5 font-semibold text-right">Orders</th>
                <th className="px-4 py-2.5 font-semibold text-right">Total Sales</th>
                <th className="px-4 py-2.5 font-semibold text-right">Total Purchases</th>
                <th className="px-4 py-2.5 font-semibold text-right">Outstanding Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158]">
              {metrics.branchPerformance.map(b => (
                <tr key={b.branchId} className="hover:bg-[#F8FAFC] dark:hover:bg-[#162344]/60 transition-colors">
                  <td className="px-4 py-3 font-semibold text-[#172033] dark:text-white">
                    <div className="flex items-center gap-2">
                      <span>{b.branchName}</span>
                      {b.isMain && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#D6AD60]/20 text-[#9A7222] dark:text-[#D6AD60]">
                          Main
                        </span>
                      )}
                      {b.branchId === activeBranchId && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#087F8C]/15 text-[#087F8C] dark:text-[#5EEAD4]">
                          Active
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#64748B] dark:text-slate-400">{b.location || '—'}</td>
                  <td className="px-4 py-3 text-right font-mono-num text-[#172033] dark:text-slate-200">
                    {b.salesCount}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num font-bold text-[#10B981]">
                    {formatCurrency(b.salesTotal, lang)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num font-semibold text-[#4169E1]">
                    {formatCurrency(b.purchaseTotal, lang)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num text-[#F59E0B]">
                    {formatCurrency(b.dueTotal, lang)}
                  </td>
                </tr>
              ))}
              {metrics.branchPerformance.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-[#64748B] dark:text-slate-400">
                    No branches configured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

interface AnalyticsBarChartCardProps {
  title: string;
  subtitle: string;
  accentColor: string;
  secondaryColor: string;
  hasData: boolean;
  emptyLabel: string;
  series: DailyAnalyticsPoint[];
  maxValue: number;
  hoveredIdx: number | null;
  onHover: (idx: number | null) => void;
  getValue: (d: DailyAnalyticsPoint) => number;
  formatVal: (v: number) => string;
  getDetail: (d: DailyAnalyticsPoint) => string;
}

const AnalyticsBarChartCard: React.FC<AnalyticsBarChartCardProps> = ({
  title,
  subtitle,
  accentColor,
  hasData,
  emptyLabel,
  series,
  maxValue,
  hoveredIdx,
  onHover,
  getValue,
  formatVal,
  getDetail,
}) => {
  const totalInSeries = series.reduce((s, d) => s + getValue(d), 0);

  return (
    <div className="rounded-[12px] p-4 bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] flex flex-col justify-between">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-xs font-bold text-[#172033] dark:text-white">{title}</h3>
          <p className="text-[11px] text-[#64748B] dark:text-slate-400">{subtitle}</p>
        </div>
        <span className="font-mono-num text-xs font-bold" style={{ color: accentColor }}>
          {formatVal(totalInSeries)}
        </span>
      </div>

      {!hasData ? (
        <div className="h-40 flex items-center justify-center text-center text-xs text-[#64748B] dark:text-slate-400 border border-dashed border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] px-4">
          <span>{emptyLabel}</span>
        </div>
      ) : (
        <div>
          <div className="h-36 flex items-end gap-1 pt-2">
            {series.map((pt, idx) => {
              const val = getValue(pt);
              const pct = Math.round((val / maxValue) * 100);
              const isHovered = hoveredIdx === idx;
              return (
                <div
                  key={pt.dateKey}
                  onMouseEnter={() => onHover(idx)}
                  onMouseLeave={() => onHover(null)}
                  className="flex-1 h-full flex items-end justify-center cursor-pointer"
                  title={`${pt.label}: ${formatVal(val)} (${getDetail(pt)})`}
                >
                  <div
                    style={{
                      height: `${Math.max(val > 0 ? 7 : 3, pct)}%`,
                      backgroundColor: accentColor,
                      opacity: isHovered ? 1 : val > 0 ? 0.82 : 0.16,
                    }}
                    className="w-full rounded-t-[4px] transition-all duration-150"
                  />
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[10px] text-[#64748B] dark:text-slate-400 mt-2 font-mono-num">
            <span>{series[0]?.label}</span>
            <span>
              {hoveredIdx !== null && series[hoveredIdx]
                ? `${series[hoveredIdx].label}: ${formatVal(getValue(series[hoveredIdx]))}`
                : `Peak: ${formatVal(Math.max(...series.map(getValue)))}`}
            </span>
            <span>{series[series.length - 1]?.label}</span>
          </div>
        </div>
      )}
    </div>
  );
};
