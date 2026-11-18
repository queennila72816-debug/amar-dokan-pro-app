import { Account, Branch, Customer, Expense, Product, Purchase, Sale, Supplier } from '../types';

export type DashboardTimeRange = 'today' | '7d' | '30d' | 'all';

export interface DailyAnalyticsPoint {
  dateKey: string;
  label: string;
  salesAmount: number;
  salesCount: number;
  purchaseAmount: number;
  purchaseCount: number;
  expenseAmount: number;
  cogsAmount: number;
  netProfit: number;
}

export interface TopSellingProductStat {
  productId: string;
  productName: string;
  sku: string;
  quantitySold: number;
  revenue: number;
}

export interface BranchPerformanceStat {
  branchId: string;
  branchName: string;
  location: string;
  isMain: boolean;
  salesCount: number;
  salesTotal: number;
  purchaseTotal: number;
  dueTotal: number;
}

function getLocalDateKey(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) {
    return typeof isoOrDate === 'string' ? isoOrDate.slice(0, 10) : '';
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isWithinRange(dateStr: string, range: DashboardTimeRange, now = new Date()): boolean {
  if (range === 'all') return true;
  const targetKey = getLocalDateKey(dateStr);
  const todayKey = getLocalDateKey(now);
  if (range === 'today') return targetKey === todayKey;

  const targetTime = new Date(dateStr).getTime();
  if (Number.isNaN(targetTime)) return false;
  const days = range === '7d' ? 7 : 30;
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  return targetTime >= cutoff.getTime();
}

export function buildDailyAnalyticsSeries(
  sales: Sale[],
  purchases: Purchase[],
  expenses: Expense[],
  days = 14,
  now = new Date()
): DailyAnalyticsPoint[] {
  const validSales = sales.filter(s => s.status !== 'voided' && s.status !== 'returned');
  const map = new Map<string, DailyAnalyticsPoint>();
  const orderedKeys: string[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const dateKey = getLocalDateKey(d);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    orderedKeys.push(dateKey);
    map.set(dateKey, {
      dateKey,
      label,
      salesAmount: 0,
      salesCount: 0,
      purchaseAmount: 0,
      purchaseCount: 0,
      expenseAmount: 0,
      cogsAmount: 0,
      netProfit: 0,
    });
  }

  for (const s of validSales) {
    const key = getLocalDateKey(s.date);
    const pt = map.get(key);
    if (!pt) continue;
    pt.salesAmount += Math.max(0, (s.total || 0) - (s.refundedAmount || 0));
    pt.salesCount += 1;
    const cogs = (s.items || []).reduce(
      (sum, item) => sum + (item.purchasePrice || 0) * (item.quantity || 0),
      0
    );
    pt.cogsAmount += cogs;
  }

  for (const p of purchases) {
    const key = getLocalDateKey(p.date);
    const pt = map.get(key);
    if (!pt) continue;
    pt.purchaseAmount += p.total || 0;
    pt.purchaseCount += 1;
  }

  for (const e of expenses) {
    const key = getLocalDateKey(e.date);
    const pt = map.get(key);
    if (!pt) continue;
    pt.expenseAmount += e.amount || 0;
  }

  return orderedKeys.map(k => {
    const pt = map.get(k)!;
    const grossProfit = pt.salesAmount - pt.cogsAmount;
    return {
      ...pt,
      netProfit: grossProfit - pt.expenseAmount,
    };
  });
}

export function computeDashboardMetrics(params: {
  sales: Sale[];
  purchases: Purchase[];
  expenses: Expense[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  accounts: Account[];
  branches: Branch[];
  range: DashboardTimeRange;
  chartDays?: 7 | 14 | 30;
  now?: Date;
}) {
  const {
    sales,
    purchases,
    expenses,
    products,
    customers,
    suppliers,
    accounts,
    branches,
    range,
    chartDays = 14,
    now = new Date(),
  } = params;

  const validAllSales = sales.filter(s => s.status !== 'voided' && s.status !== 'returned');
  const scopedSales = validAllSales.filter(s => isWithinRange(s.date, range, now));
  const scopedPurchases = purchases.filter(p => isWithinRange(p.date, range, now));
  const scopedExpenses = expenses.filter(e => isWithinRange(e.date, range, now));

  const salesTotal = scopedSales.reduce((sum, s) => sum + Math.max(0, (s.total || 0) - (s.refundedAmount || 0)), 0);
  const purchasesTotal = scopedPurchases.reduce((sum, p) => sum + (p.total || 0), 0);
  const expensesTotal = scopedExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  const cogsTotal = scopedSales.reduce((sum, sale) => {
    const saleCost = (sale.items || []).reduce(
      (itemSum, item) => itemSum + (item.purchasePrice || 0) * (item.quantity || 0),
      0
    );
    return sum + saleCost;
  }, 0);

  const grossProfit = salesTotal - cogsTotal;
  const netProfit = grossProfit - expensesTotal;

  const totalCustomerDue = customers.reduce((sum, c) => sum + Math.max(0, c.currentDue || 0), 0);
  const totalSupplierDue = suppliers.reduce((sum, s) => sum + Math.max(0, s.currentDue || 0), 0);
  const dueCustomersCount = customers.filter(c => (c.currentDue || 0) > 0).length;

  const activeProducts = products.filter(p => p.isActive !== false);
  const totalStockValue = activeProducts.reduce(
    (sum, p) => sum + Math.max(0, p.currentStock || 0) * (p.purchasePrice || 0),
    0
  );
  const totalRetailStockValue = activeProducts.reduce(
    (sum, p) => sum + Math.max(0, p.currentStock || 0) * (p.salePrice || 0),
    0
  );
  const totalStockUnits = activeProducts.reduce((sum, p) => sum + Math.max(0, p.currentStock || 0), 0);

  const totalAccountBalance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);

  const lowStockProducts = products
    .filter(p => p.isActive !== false && p.currentStock > 0 && p.currentStock <= p.minStockAlert)
    .sort((a, b) => a.currentStock - b.currentStock);
  const outOfStockProducts = products.filter(p => p.isActive !== false && p.currentStock <= 0);
  const criticalStockProducts = [...outOfStockProducts, ...lowStockProducts];
  const lossMakingProducts = products.filter(
    p => p.isActive !== false && p.salePrice > 0 && p.salePrice < (p.totalUnitCost || p.purchasePrice)
  );

  // Top Selling Products computed strictly from real sales line items
  const productSalesMap = new Map<string, TopSellingProductStat>();
  const productSourceSales = scopedSales.length > 0 ? scopedSales : validAllSales;
  for (const sale of productSourceSales) {
    for (const item of sale.items || []) {
      const existing = productSalesMap.get(item.productId);
      if (existing) {
        existing.quantitySold += item.quantity || 0;
        existing.revenue += item.total || 0;
      } else {
        productSalesMap.set(item.productId, {
          productId: item.productId,
          productName: item.productName,
          sku: item.sku || '',
          quantitySold: item.quantity || 0,
          revenue: item.total || 0,
        });
      }
    }
  }
  const topSellingProducts = Array.from(productSalesMap.values())
    .sort((a, b) => b.revenue - a.revenue || b.quantitySold - a.quantitySold)
    .slice(0, 6);

  // Branch performance computed strictly from real branch sales & purchases
  const branchPerformance: BranchPerformanceStat[] = branches.map(b => {
    const branchSales = validAllSales.filter(s => s.branchId === b.id);
    const branchPurchases = purchases.filter(p => p.branchId === b.id);
    return {
      branchId: b.id,
      branchName: b.name,
      location: b.location,
      isMain: b.isMain,
      salesCount: branchSales.length,
      salesTotal: branchSales.reduce((sum, s) => sum + Math.max(0, (s.total || 0) - (s.refundedAmount || 0)), 0),
      purchaseTotal: branchPurchases.reduce((sum, p) => sum + (p.total || 0), 0),
      dueTotal: branchSales.reduce((sum, s) => sum + (s.due || 0), 0),
    };
  }).sort((a, b) => b.salesTotal - a.salesTotal);

  const dailySeries = buildDailyAnalyticsSeries(sales, purchases, expenses, chartDays, now);

  return {
    salesTotal,
    salesCount: scopedSales.length,
    purchasesTotal,
    purchasesCount: scopedPurchases.length,
    expensesTotal,
    expensesCount: scopedExpenses.length,
    cogsTotal,
    grossProfit,
    netProfit,
    totalCustomerDue,
    totalSupplierDue,
    dueCustomersCount,
    totalStockValue,
    totalRetailStockValue,
    totalStockUnits,
    totalAccountBalance,
    lowStockProducts,
    outOfStockProducts,
    criticalStockProducts,
    lossMakingProducts,
    topSellingProducts,
    branchPerformance,
    dailySeries,
  };
}
