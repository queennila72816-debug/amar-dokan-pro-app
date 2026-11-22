import { Employee, Expense, ExpensePaymentStatus } from '../types';

export const EXPENSE_CATEGORIES = [
  'Staff Salary',
  'Shop Rent',
  'Electricity Bill',
  'Internet Bill',
  'Water Bill',
  'Gas Bill',
  'Other Monthly Expenses',
  'Food & Refreshment',
  'Transport / Courier',
  'Maintenance',
  'Packaging Bags',
  'Marketing',
  'Other Expenses',
] as const;

export const RECURRING_BILL_CATEGORIES = new Set<string>([
  'shop rent',
  'electricity bill',
  'electricity',
  'internet bill',
  'internet & utilities',
  'water bill',
  'gas bill',
  'other monthly expenses',
]);

const MONTH_FORMAT_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_FORMAT_RE = /^\d{4}-\d{2}-\d{2}$/;

export function getCurrentYearMonth(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

export function getTodayDateInput(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function isValidYearMonth(val?: string | null): boolean {
  if (!val) return false;
  return MONTH_FORMAT_RE.test(val.trim());
}

/**
 * Normalizes freeform or ISO month strings (e.g. "2026-11", "October 2026", "2026-11-22")
 * into strict YYYY-MM format when possible.
 */
export function parseYearMonth(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (MONTH_FORMAT_RE.test(trimmed)) return trimmed;
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 7);
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  }
  return null;
}

export function getEffectiveExpenseMonth(exp: Pick<Expense, 'expenseMonth' | 'paymentDate' | 'date'>): string {
  return (
    parseYearMonth(exp.expenseMonth) ||
    parseYearMonth(exp.paymentDate) ||
    parseYearMonth(exp.date) ||
    getCurrentYearMonth()
  );
}

export function getEffectivePaymentDate(exp: Pick<Expense, 'paymentDate' | 'date' | 'paymentStatus'>): string {
  if (exp.paymentDate && DATE_FORMAT_RE.test(exp.paymentDate.slice(0, 10))) {
    return exp.paymentDate.slice(0, 10);
  }
  if (exp.paymentStatus === 'unpaid') {
    return '';
  }
  if (exp.date) {
    const d = new Date(exp.date);
    if (!Number.isNaN(d.getTime())) {
      return getTodayDateInput(d);
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(exp.date)) {
      return exp.date.slice(0, 10);
    }
  }
  return '';
}

export function getEffectivePaymentStatus(exp: Pick<Expense, 'paymentStatus'>): ExpensePaymentStatus {
  return exp.paymentStatus === 'unpaid' ? 'unpaid' : 'paid';
}

export function formatExpenseMonthLabel(ym?: string | null, short = false): string {
  const normalized = parseYearMonth(ym);
  if (!normalized) return '—';
  const [yearStr, monthStr] = normalized.split('-');
  const d = new Date(Number(yearStr), Number(monthStr) - 1, 1);
  if (Number.isNaN(d.getTime())) return normalized;
  return d.toLocaleDateString('en-US', {
    month: short ? 'short' : 'long',
    year: 'numeric',
  });
}

export function canonicalExpenseCategory(category: string): string {
  const lower = category.trim().toLowerCase();
  if (lower === 'electricity') return 'electricity bill';
  if (lower === 'internet & utilities') return 'internet bill';
  return lower;
}

export function isRecurringBillCategory(category: string): boolean {
  return RECURRING_BILL_CATEGORIES.has(canonicalExpenseCategory(category));
}

export function getExpenseStaffDisplay(exp: Expense, employees: Employee[]): string {
  if (exp.staffName && exp.staffName.trim()) {
    return exp.staffName.trim();
  }
  if (exp.employeeId) {
    const matched = employees.find(emp => emp.id === exp.employeeId);
    if (matched) return matched.name;
  }
  if (exp.category.trim().toLowerCase() === 'staff salary' && exp.paidTo) {
    return exp.paidTo.replace(/\s*\([^)]*\)\s*$/, '').trim() || exp.paidTo;
  }
  return '';
}

export interface DuplicateExpenseWarning {
  type: 'salary' | 'recurring_bill';
  title: string;
  message: string;
  matches: Expense[];
}

export function findDuplicateExpenses(
  candidate: {
    category: string;
    expenseMonth: string;
    employeeId?: string;
    staffName?: string;
    paidTo?: string;
  },
  existingExpenses: Expense[],
  employees: Employee[],
  excludeExpenseId?: string
): DuplicateExpenseWarning | null {
  const targetMonth = parseYearMonth(candidate.expenseMonth);
  if (!targetMonth) return null;

  const targetCatCanon = canonicalExpenseCategory(candidate.category);
  const monthLabel = formatExpenseMonthLabel(targetMonth);

  if (targetCatCanon === 'staff salary') {
    const candEmpId = candidate.employeeId?.trim() || '';
    const candStaffNorm = (
      candidate.staffName ||
      (candEmpId ? employees.find(e => e.id === candEmpId)?.name : '') ||
      (candidate.paidTo ? candidate.paidTo.replace(/\s*\([^)]*\)\s*$/, '') : '')
    )
      .trim()
      .toLowerCase();

    if (!candEmpId && !candStaffNorm) return null;

    const matches = existingExpenses.filter(exp => {
      if (excludeExpenseId && exp.id === excludeExpenseId) return false;
      if (canonicalExpenseCategory(exp.category) !== 'staff salary') return false;
      if (getEffectiveExpenseMonth(exp) !== targetMonth) return false;

      if (candEmpId && exp.employeeId && exp.employeeId === candEmpId) return true;
      const expStaff = getExpenseStaffDisplay(exp, employees).toLowerCase();
      return Boolean(candStaffNorm && expStaff && expStaff === candStaffNorm);
    });

    if (matches.length === 0) return null;

    const staffLabel =
      candidate.staffName ||
      employees.find(e => e.id === candEmpId)?.name ||
      candidate.paidTo ||
      'selected staff member';

    return {
      type: 'salary',
      title: 'Duplicate Staff Salary Warning',
      message: `${matches.length} salary entry already exists for ${staffLabel} in ${monthLabel} (${targetMonth}).`,
      matches,
    };
  }

  if (isRecurringBillCategory(candidate.category)) {
    const matches = existingExpenses.filter(exp => {
      if (excludeExpenseId && exp.id === excludeExpenseId) return false;
      if (canonicalExpenseCategory(exp.category) !== targetCatCanon) return false;
      return getEffectiveExpenseMonth(exp) === targetMonth;
    });

    if (matches.length === 0) return null;

    return {
      type: 'recurring_bill',
      title: 'Duplicate Monthly Bill Warning',
      message: `A "${candidate.category}" entry (${matches.length}) already exists for billing month ${monthLabel} (${targetMonth}).`,
      matches,
    };
  }

  return null;
}

export interface MonthlyExpenseReportRow {
  month: string; // YYYY-MM
  label: string;
  count: number;
  paidCount: number;
  unpaidCount: number;
  paidTotal: number;
  unpaidTotal: number;
  total: number;
  salaryTotal: number;
  utilityAndRentTotal: number;
  otherTotal: number;
}

export function buildMonthlyExpenseReport(expenses: Expense[]): MonthlyExpenseReportRow[] {
  const map = new Map<string, MonthlyExpenseReportRow>();

  for (const exp of expenses) {
    const month = getEffectiveExpenseMonth(exp);
    const status = getEffectivePaymentStatus(exp);
    const amount = Number(exp.amount || 0);
    const catCanon = canonicalExpenseCategory(exp.category);

    let row = map.get(month);
    if (!row) {
      row = {
        month,
        label: formatExpenseMonthLabel(month),
        count: 0,
        paidCount: 0,
        unpaidCount: 0,
        paidTotal: 0,
        unpaidTotal: 0,
        total: 0,
        salaryTotal: 0,
        utilityAndRentTotal: 0,
        otherTotal: 0,
      };
      map.set(month, row);
    }

    row.count += 1;
    row.total += amount;
    if (status === 'unpaid') {
      row.unpaidCount += 1;
      row.unpaidTotal += amount;
    } else {
      row.paidCount += 1;
      row.paidTotal += amount;
    }

    if (catCanon === 'staff salary') {
      row.salaryTotal += amount;
    } else if (isRecurringBillCategory(exp.category)) {
      row.utilityAndRentTotal += amount;
    } else {
      row.otherTotal += amount;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month));
}
