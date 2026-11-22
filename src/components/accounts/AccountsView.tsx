import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Expense, ExpensePaymentStatus, PaymentMethod } from '../../types';
import { exportToCSV, formatCurrency, formatDate } from '../../utils/formatters';
import {
  EXPENSE_CATEGORIES,
  buildMonthlyExpenseReport,
  findDuplicateExpenses,
  formatExpenseMonthLabel,
  getCurrentYearMonth,
  getEffectiveExpenseMonth,
  getEffectivePaymentDate,
  getEffectivePaymentStatus,
  getExpenseStaffDisplay,
  getTodayDateInput,
  isValidYearMonth,
  parseYearMonth,
} from '../../utils/expenseHelpers';
import {
  Wallet,
  Plus,
  ArrowDownUp,
  Building,
  Smartphone,
  X,
  TrendingDown,
  Trash2,
  Search,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Pencil,
  RotateCcw,
  Download,
  Users,
} from 'lucide-react';

interface AccountsViewProps {
  isExpenseModalOpen?: boolean;
  onCloseExpenseModal?: () => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({
  isExpenseModalOpen: propIsExpenseModalOpen,
  onCloseExpenseModal: propOnCloseExpenseModal,
}) => {
  const {
    accounts,
    expenses,
    employees,
    addAccount,
    deleteAccount,
    addExpense,
    updateExpense,
    deleteExpense,
    isAdmin,
    transferMoney,
    settings,
    hasPermission,
  } = useApp();

  const canCreateAccount =
    isAdmin || hasPermission('cash_management', 'create') || hasPermission('bank_management', 'create');
  const canDeleteAccount =
    isAdmin || hasPermission('cash_management', 'delete') || hasPermission('bank_management', 'delete');
  const canTransfer = isAdmin || hasPermission('accounts_transactions', 'create');
  const canCreateExpense = isAdmin || hasPermission('expense_management', 'create');
  const canEditExpense = isAdmin || hasPermission('expense_management', 'edit');
  const canDeleteExpense = isAdmin || hasPermission('expense_management', 'delete');
  const lang = settings.language;

  // Modals
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(propIsExpenseModalOpen || false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const [isDeletingExpense, setIsDeletingExpense] = useState(false);

  // New Account Form
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState<'cash' | 'bank' | 'mobile_bank'>('cash');
  const [newAccNumber, setNewAccNumber] = useState('');
  const [newAccBalance, setNewAccBalance] = useState<number | ''>(0);
  const [isSavingAccount, setIsSavingAccount] = useState(false);

  // Expense Entry / Edit Form
  const [expCategory, setExpCategory] = useState<string>('Shop Rent');
  const [expMonth, setExpMonth] = useState<string>(getCurrentYearMonth());
  const [expPaymentDate, setExpPaymentDate] = useState<string>(getTodayDateInput());
  const [expPaymentStatus, setExpPaymentStatus] = useState<ExpensePaymentStatus>('paid');
  const [expEmployeeId, setExpEmployeeId] = useState<string>('');
  const [expStaffName, setExpStaffName] = useState<string>('');
  const [expAmount, setExpAmount] = useState<number | ''>('');
  const [expAccountId, setExpAccountId] = useState(accounts[0]?.id || '');
  const [expMethod, setExpMethod] = useState<PaymentMethod>('cash');
  const [expPaidTo, setExpPaidTo] = useState('');
  const [expNote, setExpNote] = useState('');
  const [confirmDuplicateSave, setConfirmDuplicateSave] = useState(false);

  // Expense Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterPaymentDate, setFilterPaymentDate] = useState('');
  const [filterStaffName, setFilterStaffName] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [showMonthlyBreakdown, setShowMonthlyBreakdown] = useState(true);

  // Transfer Form
  const [fromAccId, setFromAccId] = useState(accounts[0]?.id || '');
  const [toAccId, setToAccId] = useState(accounts[1]?.id || accounts[0]?.id || '');
  const [tfAmount, setTfAmount] = useState<number | ''>('');
  const [tfNote, setTfNote] = useState('');
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);

  const resetExpenseFormForCreate = () => {
    setEditingExpense(null);
    setExpCategory('Shop Rent');
    setExpMonth(getCurrentYearMonth());
    setExpPaymentDate(getTodayDateInput());
    setExpPaymentStatus('paid');
    setExpEmployeeId('');
    setExpStaffName('');
    setExpAmount('');
    setExpMethod('cash');
    setExpAccountId(accounts[0]?.id || '');
    setExpPaidTo('');
    setExpNote('');
    setConfirmDuplicateSave(false);
  };

  useEffect(() => {
    if (propIsExpenseModalOpen === true) {
      resetExpenseFormForCreate();
      setIsExpenseModalOpen(true);
    } else if (propIsExpenseModalOpen === false) {
      setIsExpenseModalOpen(false);
    }
  }, [propIsExpenseModalOpen]);

  const closeExpenseModal = () => {
    setIsExpenseModalOpen(false);
    setEditingExpense(null);
    setConfirmDuplicateSave(false);
    if (propOnCloseExpenseModal) propOnCloseExpenseModal();
  };

  useEffect(() => {
    if ((!expAccountId || !accounts.some(a => a.id === expAccountId)) && accounts.length > 0) {
      setExpAccountId(accounts[0].id);
    }
    if ((!fromAccId || !accounts.some(a => a.id === fromAccId)) && accounts.length > 0) {
      setFromAccId(accounts[0].id);
    }
    if ((!toAccId || !accounts.some(a => a.id === toAccId)) && accounts.length > 0) {
      setToAccId(accounts[1]?.id || accounts[0].id);
    }
  }, [accounts, expAccountId, fromAccId, toAccId]);

  const openAddExpenseModal = () => {
    resetExpenseFormForCreate();
    setIsExpenseModalOpen(true);
  };

  const openEditExpenseModal = (exp: Expense, forceStatus?: ExpensePaymentStatus) => {
    const resolvedStatus = forceStatus || getEffectivePaymentStatus(exp);
    const resolvedPaymentDate =
      getEffectivePaymentDate(exp) || (resolvedStatus === 'paid' ? getTodayDateInput() : '');
    const resolvedStaff = getExpenseStaffDisplay(exp, employees);

    setEditingExpense(exp);
    setExpCategory(exp.category);
    setExpMonth(getEffectiveExpenseMonth(exp));
    setExpPaymentDate(resolvedPaymentDate);
    setExpPaymentStatus(resolvedStatus);
    setExpEmployeeId(exp.employeeId || '');
    setExpStaffName(resolvedStaff);
    setExpAmount(exp.amount);
    setExpMethod(exp.paymentMethod || 'cash');
    setExpAccountId(exp.accountId || accounts[0]?.id || '');
    setExpPaidTo(exp.paidTo || '');
    setExpNote(exp.note || '');
    setConfirmDuplicateSave(false);
    setIsExpenseModalOpen(true);
  };

  // All available categories (preserves legacy categories present in data)
  const categoryOptions = useMemo(() => {
    const set = new Set<string>(EXPENSE_CATEGORIES);
    expenses.forEach(e => {
      if (e.category?.trim()) set.add(e.category.trim());
    });
    return Array.from(set);
  }, [expenses]);

  // Distinct expense months & staff names for quick filtering
  const availableExpenseMonths = useMemo(() => {
    const set = new Set<string>();
    expenses.forEach(e => set.add(getEffectiveExpenseMonth(e)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [expenses]);

  const availableStaffNames = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(emp => {
      if (emp.name?.trim()) set.add(emp.name.trim());
    });
    expenses.forEach(exp => {
      const staff = getExpenseStaffDisplay(exp, employees);
      if (staff) set.add(staff);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [employees, expenses]);

  // Filtered expense records
  const filteredExpenses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const monthFilterNorm = parseYearMonth(filterMonth);

    return expenses.filter(exp => {
      const effMonth = getEffectiveExpenseMonth(exp);
      const effDate = getEffectivePaymentDate(exp);
      const effStatus = getEffectivePaymentStatus(exp);
      const effStaff = getExpenseStaffDisplay(exp, employees);

      if (filterCategory !== 'all' && exp.category !== filterCategory) return false;
      if (monthFilterNorm && effMonth !== monthFilterNorm) return false;
      if (filterPaymentDate && effDate !== filterPaymentDate) return false;
      if (filterStatus !== 'all' && effStatus !== filterStatus) return false;
      if (filterStaffName !== 'all' && effStaff.toLowerCase() !== filterStaffName.toLowerCase()) return false;

      if (q) {
        const accName = accounts.find(a => a.id === exp.accountId)?.name || '';
        const haystack = [
          exp.category,
          effMonth,
          formatExpenseMonthLabel(effMonth),
          effDate,
          effStaff,
          exp.paidTo || '',
          exp.note || '',
          effStatus,
          accName,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [
    expenses,
    employees,
    accounts,
    searchQuery,
    filterCategory,
    filterMonth,
    filterPaymentDate,
    filterStaffName,
    filterStatus,
  ]);

  const paidFilteredTotal = useMemo(
    () =>
      filteredExpenses
        .filter(e => getEffectivePaymentStatus(e) === 'paid')
        .reduce((sum, e) => sum + e.amount, 0),
    [filteredExpenses]
  );

  const unpaidFilteredTotal = useMemo(
    () =>
      filteredExpenses
        .filter(e => getEffectivePaymentStatus(e) === 'unpaid')
        .reduce((sum, e) => sum + e.amount, 0),
    [filteredExpenses]
  );

  const totalFilteredExpenses = paidFilteredTotal + unpaidFilteredTotal;

  // Month-wise expense summary across all (or category/staff-filtered) expenses
  const monthlyExpenseSummary = useMemo(() => buildMonthlyExpenseReport(filteredExpenses), [filteredExpenses]);

  // Duplicate check for current Expense Form inputs
  const duplicateWarning = useMemo(() => {
    if (!isExpenseModalOpen) return null;
    const normalizedMonth = parseYearMonth(expMonth);
    if (!normalizedMonth) return null;
    return findDuplicateExpenses(
      {
        category: expCategory,
        expenseMonth: normalizedMonth,
        employeeId: expCategory === 'Staff Salary' ? expEmployeeId : undefined,
        staffName: expCategory === 'Staff Salary' ? expStaffName : undefined,
        paidTo: expPaidTo,
      },
      expenses,
      employees,
      editingExpense?.id
    );
  }, [
    isExpenseModalOpen,
    expCategory,
    expMonth,
    expEmployeeId,
    expStaffName,
    expPaidTo,
    expenses,
    employees,
    editingExpense,
  ]);

  useEffect(() => {
    setConfirmDuplicateSave(false);
  }, [expCategory, expMonth, expEmployeeId, expStaffName, expPaidTo, editingExpense?.id]);

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
      filterCategory !== 'all' ||
      filterMonth ||
      filterPaymentDate ||
      filterStaffName !== 'all' ||
      filterStatus !== 'all'
  );

  const clearFilters = () => {
    setSearchQuery('');
    setFilterCategory('all');
    setFilterMonth('');
    setFilterPaymentDate('');
    setFilterStaffName('all');
    setFilterStatus('all');
  };

  const handleSelectStaffMember = (empId: string) => {
    setExpEmployeeId(empId);
    const emp = employees.find(e => e.id === empId);
    if (emp) {
      setExpStaffName(emp.name);
      setExpPaidTo(`${emp.name}${emp.position ? ` (${emp.position})` : ''}`);
      if (!editingExpense && (!expAmount || employees.some(other => other.salary === expAmount))) {
        if (emp.salary > 0) setExpAmount(emp.salary);
      }
      if (!expNote.trim() || expNote.startsWith('Salary payment for ')) {
        const ym = parseYearMonth(expMonth) || getCurrentYearMonth();
        setExpNote(`Salary payment for ${ym}`);
      }
    } else if (!empId) {
      setExpStaffName('');
    }
  };

  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingExpense || !expAmount || Number(expAmount) <= 0) return;

    const normalizedMonth = parseYearMonth(expMonth);
    if (!normalizedMonth || !isValidYearMonth(normalizedMonth)) {
      alert('Please enter a valid Expense / Billing Month in YYYY-MM format (e.g., 2026-11).');
      return;
    }

    if (expPaymentStatus === 'paid' && !expPaymentDate) {
      alert('Please select a Payment Date for a Paid expense.');
      return;
    }

    if (expPaymentStatus === 'paid' && !expAccountId && accounts.length === 0) {
      alert('Please add a Cash or Bank account first before recording a Paid expense.');
      return;
    }

    if (duplicateWarning && !confirmDuplicateSave) {
      alert('Duplicate entry detected for this month. Please review the warning and check the confirmation box to proceed.');
      return;
    }

    const isSalary = expCategory === 'Staff Salary';
    const resolvedStaffName = isSalary ? expStaffName.trim() || expPaidTo.trim() || '' : '';
    const resolvedEmployeeId = isSalary && expEmployeeId ? expEmployeeId : '';

    setIsSavingExpense(true);
    try {
      const payload = {
        category: expCategory,
        amount: Number(expAmount),
        paymentMethod: expMethod,
        accountId: expAccountId || accounts[0]?.id || '',
        expenseMonth: normalizedMonth,
        paymentDate: expPaymentDate || undefined,
        paymentStatus: expPaymentStatus,
        employeeId: resolvedEmployeeId || undefined,
        staffName: resolvedStaffName || undefined,
        paidTo: expPaidTo.trim() || resolvedStaffName || undefined,
        note: expNote.trim() || undefined,
      };

      if (editingExpense) {
        await updateExpense(editingExpense.id, {
          ...payload,
          employeeId: resolvedEmployeeId,
          staffName: resolvedStaffName,
        });
      } else {
        await addExpense(payload);
      }

      closeExpenseModal();
      resetExpenseFormForCreate();
    } catch (err: any) {
      alert(`Expense save failed: ${err.message || 'Database error'}`);
    } finally {
      setIsSavingExpense(false);
    }
  };

  const handleExportExpensesCSV = () => {
    const rows = [
      ['Expense Month', 'Billing Month Label', 'Payment Date', 'Category', 'Staff Member', 'Paid To', 'Status', 'Method', 'Account', 'Amount (BDT)', 'Note'],
      ...filteredExpenses.map(exp => {
        const effMonth = getEffectiveExpenseMonth(exp);
        const effDate = getEffectivePaymentDate(exp);
        const effStatus = getEffectivePaymentStatus(exp);
        const effStaff = getExpenseStaffDisplay(exp, employees);
        const acc = accounts.find(a => a.id === exp.accountId);
        return [
          effMonth,
          formatExpenseMonthLabel(effMonth),
          effDate || 'Pending',
          exp.category,
          effStaff || '—',
          exp.paidTo || '—',
          effStatus.toUpperCase(),
          exp.paymentMethod,
          acc?.name || exp.paymentMethod,
          exp.amount,
          exp.note || '',
        ];
      }),
    ];
    exportToCSV(`expenses-${filterMonth || 'all'}-${Date.now()}`, rows);
  };

  const handleSubmitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isTransferring) return;
    if (!tfAmount || Number(tfAmount) <= 0 || !fromAccId || !toAccId || fromAccId === toAccId) {
      alert('Invalid accounts or transfer amount!');
      return;
    }

    const fromAcc = accounts.find(a => a.id === fromAccId);
    if (fromAcc && fromAcc.balance < Number(tfAmount)) {
      alert('Insufficient balance in source account!');
      return;
    }

    setIsTransferring(true);
    try {
      await transferMoney(fromAccId, toAccId, Number(tfAmount), tfNote);
      setIsTransferModalOpen(false);
      setTfAmount('');
      setTfNote('');
    } catch (err: any) {
      alert(`Transfer failed: ${err.message || 'Database error'}`);
    } finally {
      setIsTransferring(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    setIsSavingAccount(true);
    try {
      await addAccount({
        name: newAccName.trim(),
        accountType: newAccType,
        accountNumber: newAccNumber.trim() || undefined,
        balance: Number(newAccBalance) || 0,
      });
      setIsAddAccountModalOpen(false);
      setNewAccName('');
      setNewAccNumber('');
      setNewAccBalance(0);
    } catch (err: any) {
      alert(`Failed to add account: ${err.message || 'Database error'}`);
    } finally {
      setIsSavingAccount(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner & Accounts List */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-600" />
            <span>{'Cash & Bank Accounts & Expenses'}</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {'Manage cash drawer, mobile banking, bank balances & monthly operating expenses'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreateAccount && (
            <button
              onClick={() => setIsAddAccountModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs md:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{'Add Account'}</span>
            </button>
          )}
          {canTransfer && (
            <button
              onClick={() => setIsTransferModalOpen(true)}
              disabled={accounts.length < 2}
              className="flex items-center gap-1.5 px-3 py-2 text-xs md:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 transition-colors disabled:opacity-50"
            >
              <ArrowDownUp className="w-4 h-4 text-slate-600" />
              <span>{'Transfer Money'}</span>
            </button>
          )}
          {canCreateExpense && (
            <button
              onClick={openAddExpenseModal}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs md:text-sm font-semibold text-white bg-[#F06464] hover:brightness-110 rounded-[10px] shadow-xs transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{'Add Expense'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Account Cards Grid or Empty State */}
      {accounts.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm">No Accounts Configured</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-0.5">
              Add your store cash drawer, bank account, or mobile banking (bKash/Nagad) accounts to start recording balances.
            </p>
          </div>
          {canCreateAccount && (
            <button
              onClick={() => setIsAddAccountModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Configure First Account</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {accounts.map(acc => (
            <div key={acc.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 truncate">{acc.name}</span>
                  <div className="flex items-center gap-1">
                    {acc.accountType === 'cash' ? (
                      <Wallet className="w-4 h-4 text-emerald-600" />
                    ) : acc.accountType === 'mobile_bank' ? (
                      <Smartphone className="w-4 h-4 text-pink-600" />
                    ) : (
                      <Building className="w-4 h-4 text-blue-600" />
                    )}
                    {canDeleteAccount && acc.balance === 0 && (
                      <button
                        onClick={async () => {
                          if (confirm(`Delete account "${acc.name}"?`)) {
                            const res = await deleteAccount(acc.id);
                            if (!res.success) alert(res.message);
                          }
                        }}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                        title="Delete empty account"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-xl font-bold font-mono-num text-slate-900">
                  {formatCurrency(acc.balance, lang)}
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 font-mono truncate">
                {acc.accountNumber || (acc.accountType === 'cash' ? 'Cash in Drawer' : 'No Account #')}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Month-wise Expense Summary Strip */}
      {monthlyExpenseSummary.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#243B70]" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                Month-wise Expense Overview
              </h3>
              <span className="text-[11px] text-slate-500">
                (Click a month card to filter records)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowMonthlyBreakdown(v => !v)}
              className="text-[11px] font-semibold text-[#243B70] hover:underline cursor-pointer"
            >
              {showMonthlyBreakdown ? 'Hide Summary' : 'Show Summary'}
            </button>
          </div>

          {showMonthlyBreakdown && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {monthlyExpenseSummary.slice(0, 8).map(m => {
                const isSelected = filterMonth === m.month;
                return (
                  <button
                    key={m.month}
                    type="button"
                    onClick={() => setFilterMonth(isSelected ? '' : m.month)}
                    className={`text-left p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-[#101B3F] bg-[#101B3F]/5 ring-1 ring-[#101B3F]'
                        : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">{m.label}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                        {m.month}
                      </span>
                    </div>
                    <div className="mt-1.5 text-sm font-bold font-mono-num text-rose-700">
                      {formatCurrency(m.total, lang)}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-slate-600">
                      <span className="text-emerald-700 font-semibold">
                        Paid: {formatCurrency(m.paidTotal, lang)}
                      </span>
                      {m.unpaidTotal > 0 ? (
                        <span className="text-amber-700 font-semibold">
                          Unpaid: {formatCurrency(m.unpaidTotal, lang)}
                        </span>
                      ) : (
                        <span>{m.count} entries</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Expense Management Table & Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-rose-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                {'Expense Records'}
              </h3>
              <span className="text-[11px] font-mono text-slate-500">
                ({filteredExpenses.length} of {expenses.length})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold font-mono-num">
                Paid: {formatCurrency(paidFilteredTotal, lang)}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-semibold font-mono-num">
                Unpaid: {formatCurrency(unpaidFilteredTotal, lang)}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-bold font-mono-num">
                Total: {formatCurrency(totalFilteredExpenses, lang)}
              </span>
              <button
                type="button"
                onClick={handleExportExpensesCSV}
                disabled={filteredExpenses.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-semibold disabled:opacity-50 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
            </div>
          </div>

          {/* Search & Multi-Field Filter Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 text-xs">
            <div className="relative lg:col-span-2">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search category, month (YYYY-MM), staff, note..."
                className="w-full pl-8 pr-2.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#243B70]/20"
              />
            </div>

            <div>
              <select
                aria-label="Filter by Expense Category"
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white"
              >
                <option value="all">All Categories</option>
                {categoryOptions.map(cat => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <input
                type="month"
                aria-label="Filter by Expense Month"
                value={filterMonth}
                onChange={e => setFilterMonth(e.target.value)}
                title="Filter by Expense Month (YYYY-MM)"
                list="expense-month-datalist"
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white font-mono"
              />
              <datalist id="expense-month-datalist">
                {availableExpenseMonths.map(ym => (
                  <option key={ym} value={ym}>
                    {formatExpenseMonthLabel(ym)}
                  </option>
                ))}
              </datalist>
            </div>

            <div>
              <input
                type="date"
                aria-label="Filter by Payment Date"
                value={filterPaymentDate}
                onChange={e => setFilterPaymentDate(e.target.value)}
                title="Filter by Payment Date"
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white font-mono"
              />
            </div>

            <div className="flex gap-1.5">
              <select
                aria-label="Filter by Staff Name"
                value={filterStaffName}
                onChange={e => setFilterStaffName(e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 border border-slate-200 rounded-lg bg-white"
              >
                <option value="all">All Staff</option>
                {availableStaffNames.map(staff => (
                  <option key={staff} value={staff}>
                    {staff}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by Payment Status"
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value as 'all' | 'paid' | 'unpaid')}
                className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg bg-white"
              >
                <option value="all">All Status</option>
                <option value="paid">Paid</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </div>
          </div>

          {hasActiveFilters && (
            <div className="flex items-center justify-between text-[11px] text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
              <span>
                Active filters applied
                {filterMonth ? ` · Expense Month: ${formatExpenseMonthLabel(filterMonth)} (${filterMonth})` : ''}
                {filterPaymentDate ? ` · Payment Date: ${filterPaymentDate}` : ''}
                {filterStaffName !== 'all' ? ` · Staff: ${filterStaffName}` : ''}
              </span>
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:underline cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Filters</span>
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">{'Expense Month'}</th>
                <th className="px-4 py-3 font-semibold">{'Payment Date'}</th>
                <th className="px-4 py-3 font-semibold">{'Category'}</th>
                <th className="px-4 py-3 font-semibold">{'Staff / Paid To'}</th>
                <th className="px-4 py-3 font-semibold">{'Status'}</th>
                <th className="px-4 py-3 font-semibold">{'Account'}</th>
                <th className="px-4 py-3 font-semibold">{'Note'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Amount'}</th>
                {(canEditExpense || canDeleteExpense) && (
                  <th className="px-4 py-3 font-semibold text-right">{'Actions'}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredExpenses.map(exp => {
                const acc = accounts.find(a => a.id === exp.accountId);
                const effMonth = getEffectiveExpenseMonth(exp);
                const effPaymentDate = getEffectivePaymentDate(exp);
                const effStatus = getEffectivePaymentStatus(exp);
                const staffDisplay = getExpenseStaffDisplay(exp, employees);

                return (
                  <tr key={exp.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-semibold text-slate-900">
                        {formatExpenseMonthLabel(effMonth, true)}
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">{effMonth}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {effPaymentDate ? (
                        formatDate(effPaymentDate, lang)
                      ) : (
                        <span className="text-amber-700 italic text-[11px]">Pending Payment</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {exp.category}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {staffDisplay ? (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 font-semibold text-[11px]">
                            <Users className="w-3 h-3" />
                            <span>{staffDisplay}</span>
                          </span>
                          {exp.paidTo && exp.paidTo !== staffDisplay && (
                            <div className="text-[10px] text-slate-500">{exp.paidTo}</div>
                          )}
                        </div>
                      ) : (
                        exp.paidTo || '—'
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {effStatus === 'paid' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[11px]">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Paid</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300 font-semibold text-[11px]">
                          <Clock className="w-3 h-3" />
                          <span>Unpaid</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {effStatus === 'unpaid'
                        ? acc?.name
                          ? `${acc.name} (Pending)`
                          : 'Unpaid / Payable'
                        : acc?.name || exp.paymentMethod}
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate" title={exp.note || ''}>
                      {exp.note || '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num font-bold text-rose-700 text-sm whitespace-nowrap">
                      {formatCurrency(exp.amount, lang)}
                    </td>
                    {(canEditExpense || canDeleteExpense) && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          {canEditExpense && effStatus === 'unpaid' && (
                            <button
                              type="button"
                              onClick={() => openEditExpenseModal(exp, 'paid')}
                              className="px-2 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded transition-colors cursor-pointer"
                              title="Mark this expense as Paid"
                            >
                              Mark Paid
                            </button>
                          )}
                          {canEditExpense && (
                            <button
                              type="button"
                              onClick={() => openEditExpenseModal(exp)}
                              className="p-1 text-slate-500 hover:text-[#243B70] hover:bg-slate-100 rounded transition-colors cursor-pointer"
                              title="Edit Expense"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDeleteExpense && (
                            <button
                              type="button"
                              onClick={() => setExpenseToDelete(exp)}
                              className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                              title={'Delete Expense (Authorized Only)'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}

              {filteredExpenses.length === 0 && (
                <tr>
                  <td colSpan={canEditExpense || canDeleteExpense ? 9 : 8} className="py-12 text-center text-slate-400 text-xs">
                    {hasActiveFilters
                      ? 'No expense records match the selected filters.'
                      : 'No expenses recorded.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Expense Modal */}
      {isExpenseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <form
            onSubmit={handleSubmitExpense}
            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg p-5 space-y-4 my-auto"
          >
            <div className="flex items-center justify-between border-b pb-2.5">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-rose-600" />
                <span>{editingExpense ? 'Edit Expense Record' : 'Add Expense'}</span>
              </h3>
              <button
                type="button"
                onClick={closeExpenseModal}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Expense Category *'}</label>
                  <select
                    aria-label={'Category'}
                    value={expCategory}
                    onChange={(e) => {
                      const nextCat = e.target.value;
                      setExpCategory(nextCat);
                      if (nextCat !== 'Staff Salary') {
                        setExpEmployeeId('');
                        setExpStaffName('');
                      }
                    }}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {categoryOptions.map(cat => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {expCategory === 'Staff Salary' ? 'Salary Month (YYYY-MM) *' : 'Expense / Billing Month (YYYY-MM) *'}
                  </label>
                  <input
                    type="month"
                    required
                    aria-label="Expense Month"
                    value={expMonth}
                    onChange={(e) => setExpMonth(e.target.value)}
                    placeholder="YYYY-MM"
                    pattern="\d{4}-(0[1-9]|1[0-2])"
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white font-mono"
                  />
                  {isValidYearMonth(expMonth) && (
                    <span className="text-[10px] text-[#243B70] font-semibold mt-0.5 block">
                      Billing Period: {formatExpenseMonthLabel(expMonth)} ({expMonth})
                    </span>
                  )}
                </div>
              </div>

              {/* Staff Member selector for Staff Salary */}
              {expCategory === 'Staff Salary' && (
                <div className="p-3 rounded-xl bg-indigo-50/60 border border-indigo-200 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-semibold text-indigo-950 mb-1">
                        {'Select Staff Member'}
                      </label>
                      <select
                        aria-label="Select Staff Member"
                        value={expEmployeeId}
                        onChange={(e) => handleSelectStaffMember(e.target.value)}
                        className="w-full p-2 border border-indigo-200 rounded-lg bg-white"
                      >
                        <option value="">-- Select Registered Staff --</option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name} ({emp.position}) — ৳{emp.salary}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-indigo-950 mb-1">
                        {'Staff Name'}
                      </label>
                      <input
                        type="text"
                        value={expStaffName}
                        onChange={(e) => {
                          setExpStaffName(e.target.value);
                          if (!expPaidTo || expPaidTo === expStaffName) {
                            setExpPaidTo(e.target.value);
                          }
                        }}
                        placeholder="Staff full name"
                        className="w-full p-2 border border-indigo-200 rounded-lg bg-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Payment Status + Separate Payment Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Payment Status *'}</label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => {
                        setExpPaymentStatus('paid');
                        if (!expPaymentDate) setExpPaymentDate(getTodayDateInput());
                      }}
                      className={`py-1.5 rounded-md font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        expPaymentStatus === 'paid'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white/60'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Paid</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setExpPaymentStatus('unpaid');
                      }}
                      className={`py-1.5 rounded-md font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        expPaymentStatus === 'unpaid'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white/60'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Unpaid</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {expPaymentStatus === 'paid' ? 'Payment Date *' : 'Payment / Due Date (Optional)'}
                  </label>
                  <input
                    type="date"
                    required={expPaymentStatus === 'paid'}
                    aria-label="Payment Date"
                    value={expPaymentDate}
                    onChange={(e) => setExpPaymentDate(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Amount *'}</label>
                <input
                  type="number"
                  required
                  min="1"
                  step="any"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 5000"
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold text-base text-rose-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Method'}</label>
                  <select
                    aria-label={'Method'}
                    value={expMethod}
                    onChange={(e) => setExpMethod(e.target.value as PaymentMethod)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white capitalize"
                  >
                    <option value="cash">Cash</option>
                    <option value="bkash">bKash</option>
                    <option value="bank">Bank</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {expPaymentStatus === 'paid' ? 'Paid From Account' : 'Preferred Account'}
                  </label>
                  <select
                    aria-label={'Paid From Account'}
                    value={expAccountId}
                    onChange={(e) => setExpAccountId(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {accounts.length === 0 && <option value="">No Account</option>}
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {expPaymentStatus === 'unpaid' && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  Unpaid expenses are tracked in Monthly Expense Reports as pending bills/salaries without deducting cash or bank balances until marked as Paid.
                </p>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Paid To / Vendor'}</label>
                <input
                  type="text"
                  value={expPaidTo}
                  onChange={(e) => setExpPaidTo(e.target.value)}
                  placeholder="e.g. Landlord / DESCO / Staff Name"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Note'}</label>
                <input
                  type="text"
                  value={expNote}
                  onChange={(e) => setExpNote(e.target.value)}
                  placeholder="Enter expense details"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              {/* Duplicate Salary / Recurring Bill Warning */}
              {duplicateWarning && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-bold text-xs">{duplicateWarning.title}</p>
                      <p className="text-[11px] text-amber-900">{duplicateWarning.message}</p>
                      <div className="space-y-1 pt-1">
                        {duplicateWarning.matches.slice(0, 3).map(m => (
                          <div
                            key={m.id}
                            className="text-[11px] bg-white/80 border border-amber-200 rounded px-2 py-1 flex items-center justify-between gap-2"
                          >
                            <span>
                              {m.category} · {getEffectivePaymentStatus(m).toUpperCase()}
                              {getEffectivePaymentDate(m) ? ` (${getEffectivePaymentDate(m)})` : ''}
                            </span>
                            <span className="font-mono-num font-bold text-rose-700">
                              {formatCurrency(m.amount, lang)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 pt-1 text-[11px] font-semibold text-amber-950 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmDuplicateSave}
                      onChange={(e) => setConfirmDuplicateSave(e.target.checked)}
                      className="rounded border-amber-400"
                    />
                    <span>I understand this month already has a matching entry — save anyway</span>
                  </label>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={closeExpenseModal}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                {'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isSavingExpense || (Boolean(duplicateWarning) && !confirmDuplicateSave)}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg shadow-xs cursor-pointer"
              >
                {isSavingExpense
                  ? 'Saving...'
                  : editingExpense
                  ? 'Update Expense'
                  : 'Save Expense'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Transfer Modal */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSubmitTransfer}
            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <ArrowDownUp className="w-4 h-4 text-emerald-600" />
                <span>{'Transfer Balance'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'From'}</label>
                  <select
                    aria-label={'From Account'}
                    value={fromAccId}
                    onChange={(e) => setFromAccId(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name} (৳{a.balance})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'To'}</label>
                  <select
                    aria-label={'To Account'}
                    value={toAccId}
                    onChange={(e) => setToAccId(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name} (৳{a.balance})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Amount *'}</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={tfAmount}
                  onChange={(e) => setTfAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 10000"
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold text-base"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Note'}</label>
                <input
                  type="text"
                  value={tfNote}
                  onChange={(e) => setTfNote(e.target.value)}
                  placeholder="e.g. Transfer from Cash to Bank"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isTransferring}
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg shadow-xs cursor-pointer"
              >
                {isTransferring ? 'Transferring...' : 'Confirm Transfer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Expense Confirmation Modal */}
      {expenseToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-rose-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    {'Delete Expense?'}
                  </h3>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {expenseToDelete.category} · {getEffectiveExpenseMonth(expenseToDelete)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExpenseToDelete(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-700">
              <p className="font-medium text-slate-800">
                {getEffectivePaymentStatus(expenseToDelete) === 'paid'
                  ? 'Are you sure you want to delete this paid expense record? Related account balance will be restored.'
                  : 'Are you sure you want to delete this unpaid expense record? Account balances will remain unchanged.'}
              </p>
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1 text-rose-900 text-xs">
                <div className="flex justify-between font-semibold">
                  <span>{'Expense Amount'}:</span>
                  <span className="font-mono-num font-bold">{formatCurrency(expenseToDelete.amount, lang)}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>{'Expense Month'}:</span>
                  <span>
                    {formatExpenseMonthLabel(getEffectiveExpenseMonth(expenseToDelete))} (
                    {getEffectiveExpenseMonth(expenseToDelete)})
                  </span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>{'Paid To'}:</span>
                  <span>{expenseToDelete.paidTo || '—'}</span>
                </div>
                <p className="pt-1 text-rose-700 text-[11px]">
                  {getEffectivePaymentStatus(expenseToDelete) === 'paid'
                    ? '⚠ Deleting this paid expense will restore the spent amount back to the source account.'
                    : 'This unpaid bill has not been deducted from any account yet.'}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isDeletingExpense}
                onClick={() => setExpenseToDelete(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
              >
                {'Cancel'}
              </button>
              <button
                type="button"
                disabled={isDeletingExpense}
                onClick={async () => {
                  setIsDeletingExpense(true);
                  try {
                    await deleteExpense(expenseToDelete.id);
                    setExpenseToDelete(null);
                  } catch (err: any) {
                    alert(`Failed to delete expense: ${err.message || 'Database error'}`);
                  } finally {
                    setIsDeletingExpense(false);
                  }
                }}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingExpense ? 'Deleting...' : 'Delete Expense'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Account Modal */}
      {isAddAccountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleCreateAccount}
            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-600" />
                <span>{'Add New Financial Account'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsAddAccountModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Account Name *'}</label>
                <input
                  type="text"
                  required
                  value={newAccName}
                  onChange={e => setNewAccName(e.target.value)}
                  placeholder="e.g. Cash in Hand / Islami Bank / bKash Merchant"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Account Type *'}</label>
                <select
                  value={newAccType}
                  onChange={e => setNewAccType(e.target.value as any)}
                  className="w-full p-2 border border-slate-200 rounded-lg bg-white capitalize"
                >
                  <option value="cash">Cash (Drawer / Register)</option>
                  <option value="bank">Bank Account</option>
                  <option value="mobile_bank">Mobile Banking (bKash / Nagad / Rocket)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  {'Account / Mobile / Card Number'}
                </label>
                <input
                  type="text"
                  value={newAccNumber}
                  onChange={e => setNewAccNumber(e.target.value)}
                  placeholder="e.g. 017xxxxxxxx or 2050112233..."
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Opening Balance (৳)'}</label>
                <input
                  type="number"
                  min="0"
                  value={newAccBalance}
                  onChange={e => setNewAccBalance(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="0"
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold text-sm text-emerald-700"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Initial funds available in this account.
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setIsAddAccountModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isSavingAccount}
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors"
              >
                {isSavingAccount ? 'Saving...' : 'Create Account'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
