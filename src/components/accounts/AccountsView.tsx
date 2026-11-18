import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Expense, PaymentMethod } from '../../types';
import { formatCurrency, formatDate, toBnNumber } from '../../utils/formatters';
import {
  Wallet,
  Plus,
  ArrowDownUp,
  CreditCard,
  Building,
  Smartphone,
  X,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Trash2,
} from 'lucide-react';

interface AccountsViewProps {
  isExpenseModalOpen?: boolean;
  onCloseExpenseModal?: () => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({ isExpenseModalOpen: propIsExpenseModalOpen, onCloseExpenseModal: propOnCloseExpenseModal }) => {
  const { accounts, expenses, addAccount, deleteAccount, addExpense, deleteExpense, isAdmin, transferMoney, settings, hasPermission } = useApp();
  const canCreateAccount = isAdmin || hasPermission('cash_management', 'create') || hasPermission('bank_management', 'create');
  const canDeleteAccount = isAdmin || hasPermission('cash_management', 'delete') || hasPermission('bank_management', 'delete');
  const canTransfer = isAdmin || hasPermission('accounts_transactions', 'create');
  const canCreateExpense = isAdmin || hasPermission('expense_management', 'create');
  const canDeleteExpense = isAdmin || hasPermission('expense_management', 'delete');
  const isBn = false;
  const lang = settings.language;

  // Modals
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(propIsExpenseModalOpen || false);
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

  React.useEffect(() => {
    if (propIsExpenseModalOpen === true) {
      setExpCategory('Shop Rent');
      setExpAmount('');
      setExpMethod('cash');
      setExpPaidTo('');
      setExpNote('');
      setIsExpenseModalOpen(true);
    } else if (propIsExpenseModalOpen === false) {
      setIsExpenseModalOpen(false);
    }
  }, [propIsExpenseModalOpen]);

  const closeExpenseModal = () => {
    setIsExpenseModalOpen(false);
    if (propOnCloseExpenseModal) propOnCloseExpenseModal();
  };

  // Expense Form
  const [expCategory, setExpCategory] = useState('Shop Rent');
  const [expAmount, setExpAmount] = useState<number | ''>('');
  const [expAccountId, setExpAccountId] = useState(accounts[0]?.id || '');
  const [expMethod, setExpMethod] = useState<PaymentMethod>('cash');
  const [expPaidTo, setExpPaidTo] = useState('');
  const [expNote, setExpNote] = useState('');

  // Transfer Form
  const [fromAccId, setFromAccId] = useState(accounts[0]?.id || '');
  const [toAccId, setToAccId] = useState(accounts[1]?.id || accounts[0]?.id || '');
  const [tfAmount, setTfAmount] = useState<number | ''>('');
  const [tfNote, setTfNote] = useState('');
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);

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

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  const expenseCategories = [
    'Shop Rent',
    'Electricity',
    'Internet & Utilities',
    'Staff Salary',
    'Food & Refreshment',
    'Transport / Courier',
    'Maintenance',
    'Packaging Bags',
    'Marketing',
    'Other Expenses',
  ];

  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingExpense || !expAmount || Number(expAmount) <= 0) return;

    setIsSavingExpense(true);
    try {
      await addExpense({
        category: expCategory,
        amount: Number(expAmount),
        paymentMethod: expMethod,
        accountId: expAccountId,
        paidTo: expPaidTo.trim() || undefined,
        note: expNote.trim() || undefined,
      });

      closeExpenseModal();
      setExpAmount('');
      setExpPaidTo('');
      setExpNote('');
    } catch (err: any) {
      alert(`Expense save failed: ${err.message || 'Database error'}`);
    } finally {
      setIsSavingExpense(false);
    }
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
            <span>{'Cash & Bank Accounts'}</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {'Manage cash drawer, mobile banking & bank balances'}
          </p>
        </div>

        <div className="flex items-center gap-2">
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
              onClick={() => setIsExpenseModalOpen(true)}
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

      {/* Expense Management Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-rose-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              {'Expense Records'}
            </h3>
          </div>
          <span className="text-xs font-semibold text-rose-700">
            {'Total:'} {formatCurrency(totalExpenses, lang)}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">{'Date'}</th>
                <th className="px-4 py-3 font-semibold">{'Category'}</th>
                <th className="px-4 py-3 font-semibold">{'Paid To'}</th>
                <th className="px-4 py-3 font-semibold">{'Account'}</th>
                <th className="px-4 py-3 font-semibold">{'Note'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Amount'}</th>
                {canDeleteExpense && <th className="px-4 py-3 font-semibold text-right">{'Actions'}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expenses.map(exp => {
                const acc = accounts.find(a => a.id === exp.accountId);
                return (
                  <tr key={exp.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {formatDate(exp.date, lang)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {exp.category}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {exp.paidTo || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {acc?.name || exp.paymentMethod}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {exp.note || '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num font-bold text-rose-700 text-sm">
                      {formatCurrency(exp.amount, lang)}
                    </td>
                    {canDeleteExpense && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => setExpenseToDelete(exp)}
                          className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                          title={'Delete Expense (Authorized Only)'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}

              {expenses.length === 0 && (
                <tr>
                  <td colSpan={canDeleteExpense ? 7 : 6} className="py-12 text-center text-slate-400 text-xs">
                    {'No expenses recorded.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Expense Modal */}
      {isExpenseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSubmitExpense}
            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-rose-600" />
                <span>{'Add Expense'}</span>
              </h3>
              <button
                type="button"
                onClick={closeExpenseModal}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Category *'}</label>
                <select
                  aria-label={'Category'}
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value)}
                  className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                >
                  {expenseCategories.map(cat => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Amount *'}</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 500"
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold text-base text-rose-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Method'}</label>
                  <select
                    aria-label={'Method'}
                    value={expMethod}
                    onChange={(e) => setExpMethod(e.target.value as any)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white capitalize"
                  >
                    <option value="cash">Cash</option>
                    <option value="bkash">bKash</option>
                    <option value="bank">Bank</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Paid From'}</label>
                  <select
                    aria-label={'Paid From Account'}
                    value={expAccountId}
                    onChange={(e) => setExpAccountId(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Paid To'}</label>
                <input
                  type="text"
                  value={expPaidTo}
                  onChange={(e) => setExpPaidTo(e.target.value)}
                  placeholder="e.g. Landlord / Electricity Office"
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
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={closeExpenseModal}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isSavingExpense}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg shadow-xs cursor-pointer"
              >
                {isSavingExpense ? 'Saving...' : 'Save Expense'}
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
                    {expenseToDelete.category}
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
                {'Are you sure you want to delete this expense record? Related account balance will be restored.'}
              </p>
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1 text-rose-900 text-xs">
                <div className="flex justify-between font-semibold">
                  <span>{'Expense Amount'}:</span>
                  <span className="font-mono-num font-bold">{formatCurrency(expenseToDelete.amount, lang)}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>{'Paid To'}:</span>
                  <span>{expenseToDelete.paidTo || '—'}</span>
                </div>
                <p className="pt-1 text-rose-700 text-[11px]">
                  {'⚠ Deleting this expense will restore the spent amount back to the source account.'}
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
                <span>{isDeletingExpense ? ('Deleting...') : ('Delete Expense')}</span>
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
