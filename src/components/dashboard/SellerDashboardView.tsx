import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { resolveBusinessProfile } from '../../config/appIdentity';
import { Sale } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { getShopLogo } from '../../utils/printEngine';
import { InvoiceModal } from '../pos/InvoiceModal';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { isSalesmanOrCashierRole } from '../../utils/rbacDefaults';
import {
  ShoppingCart,
  Receipt,
  TrendingUp,
  Banknote,
  Smartphone,
  Building2,
  AlertCircle,
  Eye,
  Lock,
  CheckCircle2,
  Sparkles,
  Loader2,
  X,
  CreditCard,
} from 'lucide-react';

interface SellerDashboardViewProps {
  onOpenPOS: () => void;
}

export const SellerDashboardView: React.FC<SellerDashboardViewProps> = ({ onOpenPOS }) => {
  const { sales, user, currentUserRole, currentEmployee, settings, branches, activeBranchId } = useApp();
  const lang = settings.language;

  const [selectedInvoice, setSelectedInvoice] = useState<Sale | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const sellerDisplayName =
    currentEmployee?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || (isSalesmanOrCashierRole(currentUserRole) ? 'Staff' : 'Seller');

  const currentBranch = branches.find(b => b.id === activeBranchId) || branches[0];
  const biz = resolveBusinessProfile(settings, currentBranch);
  const shopLogo = getShopLogo(settings);

  const sellerSales = useMemo(() => {
    return sales.filter(s => {
      if (user?.id && s.sellerId === user.id) return true;
      if (currentEmployee?.id && s.employeeId === currentEmployee.id) return true;
      if (currentEmployee?.employeeCode && s.employeeCode === currentEmployee.employeeCode) return true;
      if (s.employeeName === sellerDisplayName || s.servedBy === sellerDisplayName || s.sellerName === sellerDisplayName) return true;
      if (user?.email && s.servedBy === user.email) return true;
      return false;
    });
  }, [sales, user, currentEmployee, sellerDisplayName]);

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const todaySales = useMemo(() => {
    return sellerSales.filter(s => {
      const saleTime = new Date(s.date).getTime();
      return saleTime >= todayStart && s.status !== 'voided' && s.status !== 'returned';
    });
  }, [sellerSales, todayStart]);

  const todayTotalAmount = useMemo(
    () => todaySales.reduce((acc, curr) => acc + curr.total, 0),
    [todaySales]
  );

  const todayTransactionCount = todaySales.length;
  const todayAvgTicket = todayTransactionCount > 0 ? Math.round(todayTotalAmount / todayTransactionCount) : 0;

  const methodBreakdown = useMemo(() => {
    const breakdown = { cash: 0, bkash: 0, nagad: 0, bank: 0, due: 0 };

    todaySales.forEach(s => {
      if (s.due > 0) breakdown.due += s.due;
      if (s.payments && s.payments.length > 0) {
        s.payments.forEach(p => {
          if (p.method === 'cash') breakdown.cash += p.amount;
          else if (p.method === 'bkash') breakdown.bkash += p.amount;
          else if (p.method === 'nagad') breakdown.nagad += p.amount;
          else if (p.method === 'bank' || p.method === 'card') breakdown.bank += p.amount;
          else breakdown.cash += p.amount;
        });
      } else {
        if (s.paymentMethod === 'cash') breakdown.cash += s.paid;
        else if (s.paymentMethod === 'bkash') breakdown.bkash += s.paid;
        else if (s.paymentMethod === 'nagad') breakdown.nagad += s.paid;
        else if (s.paymentMethod === 'bank' || s.paymentMethod === 'card') breakdown.bank += s.paid;
        else breakdown.cash += s.paid;
      }
    });

    return breakdown;
  }, [todaySales]);

  const recentTransactions = useMemo(() => {
    return [...sellerSales]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 15);
  }, [sellerSales]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);

    if (newPassword.length < 6) {
      setPasswordFeedback({ type: 'error', text: 'Password must be at least 6 characters long.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setIsUpdatingPassword(true);
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
      }
      setPasswordFeedback({ type: 'success', text: 'Password changed successfully!' });
      setTimeout(() => {
        setIsPasswordModalOpen(false);
        setNewPassword('');
        setConfirmPassword('');
        setPasswordFeedback(null);
      }, 1200);
    } catch (err: any) {
      setPasswordFeedback({ type: 'error', text: err.message || 'Failed to update password.' });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Luxury Navy + Gold + Teal Welcome Banner */}
      <div className="bg-[#101B35] bg-gradient-to-r from-[#101B35] via-[#152447] to-[#087F8C] rounded-[14px] p-5 sm:p-6 text-white shadow-lg border border-[#D6AD60]/25 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          {shopLogo && (
            <div className="w-12 h-12 rounded-[10px] bg-white p-1 flex items-center justify-center shrink-0 shadow-xs">
              <img src={shopLogo} alt={biz.shopName} className="max-w-full max-h-full object-contain" />
            </div>
          )}
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-white/10 border border-[#D6AD60]/30 text-[11px] font-semibold text-[#D6AD60] mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{biz.shopName} · {biz.branchName || 'Main Branch'}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Welcome back, {sellerDisplayName}!
            </h1>
            <p className="text-xs text-[#CBD5E1] mt-1">
              Your daily sales summary and counter ledger for {biz.shopName}.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={() => {
              setIsPasswordModalOpen(true);
              setPasswordFeedback(null);
            }}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 active:scale-95 border border-white/20 rounded-[10px] text-xs font-semibold text-white transition-all cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Change Password</span>
          </button>

          <button
            onClick={onOpenPOS}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-[#D6AD60] bg-gradient-to-r from-[#D6AD60] to-[#E6BE73] hover:brightness-105 text-[#0B1428] rounded-[10px] text-xs sm:text-sm font-bold shadow-md active:scale-95 transition-all cursor-pointer"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Open POS / New Sale</span>
          </button>
        </div>
      </div>

      {/* Gradient KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-[14px] p-4 text-white bg-[#10B981] bg-gradient-to-br from-[#10B981] to-[#059669] shadow-md shadow-[#10B981]/20">
          <div className="flex items-center justify-between text-[#ECFDF5] mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Today&apos;s Sales</span>
            <TrendingUp className="w-4 h-4" />
          </div>
          <p className="text-xl sm:text-2xl font-bold font-mono-num">
            {formatCurrency(todayTotalAmount, lang)}
          </p>
          <span className="text-[11px] text-[#ECFDF5] font-medium">Your counter sales today</span>
        </div>

        <div className="rounded-[14px] p-4 text-white bg-[#4169E1] bg-gradient-to-br from-[#4169E1] to-[#284BC2] shadow-md shadow-[#4169E1]/20">
          <div className="flex items-center justify-between text-[#EFF6FF] mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Transactions</span>
            <Receipt className="w-4 h-4" />
          </div>
          <p className="text-xl sm:text-2xl font-bold font-mono-num">
            {todayTransactionCount}
          </p>
          <span className="text-[11px] text-[#EFF6FF] font-medium">Invoices completed</span>
        </div>

        <div className="rounded-[14px] p-4 text-white bg-[#087F8C] bg-gradient-to-br from-[#087F8C] to-[#055B65] shadow-md shadow-[#087F8C]/20">
          <div className="flex items-center justify-between text-[#F0FDFA] mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Cash Collected</span>
            <Banknote className="w-4 h-4" />
          </div>
          <p className="text-xl sm:text-2xl font-bold font-mono-num">
            {formatCurrency(methodBreakdown.cash, lang)}
          </p>
          <span className="text-[11px] text-[#F0FDFA] font-medium">In cash drawer</span>
        </div>

        <div className="rounded-[14px] p-4 text-white bg-[#7357D9] bg-gradient-to-br from-[#7357D9] to-[#563AB8] shadow-md shadow-[#7357D9]/20">
          <div className="flex items-center justify-between text-[#FAF5FF] mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Average Sale</span>
            <Receipt className="w-4 h-4" />
          </div>
          <p className="text-xl sm:text-2xl font-bold font-mono-num">
            {formatCurrency(todayAvgTicket, lang)}
          </p>
          <span className="text-[11px] text-[#FAF5FF] font-medium">Per transaction</span>
        </div>
      </div>

      {/* Payment Method Breakdown */}
      <div className="adp-card p-4 sm:p-5">
        <h3 className="text-xs sm:text-sm font-bold text-[#172033] dark:text-white uppercase tracking-wider mb-3">
          Today&apos;s Sales Breakdown by Payment Method
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="p-3 rounded-[10px] bg-emerald-500/10 border border-emerald-500/25">
            <div className="flex items-center gap-1.5 text-[#10B981] text-xs font-semibold mb-1">
              <Banknote className="w-4 h-4" />
              <span>Cash</span>
            </div>
            <p className="text-base sm:text-lg font-bold text-[#172033] dark:text-white font-mono-num">
              {formatCurrency(methodBreakdown.cash, lang)}
            </p>
          </div>

          <div className="p-3 rounded-[10px] bg-pink-500/10 border border-pink-500/25">
            <div className="flex items-center gap-1.5 text-pink-600 dark:text-pink-400 text-xs font-semibold mb-1">
              <Smartphone className="w-4 h-4" />
              <span>bKash</span>
            </div>
            <p className="text-base sm:text-lg font-bold text-[#172033] dark:text-white font-mono-num">
              {formatCurrency(methodBreakdown.bkash, lang)}
            </p>
          </div>

          <div className="p-3 rounded-[10px] bg-orange-500/10 border border-orange-500/25">
            <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400 text-xs font-semibold mb-1">
              <Smartphone className="w-4 h-4" />
              <span>Nagad</span>
            </div>
            <p className="text-base sm:text-lg font-bold text-[#172033] dark:text-white font-mono-num">
              {formatCurrency(methodBreakdown.nagad, lang)}
            </p>
          </div>

          <div className="p-3 rounded-[10px] bg-[#4169E1]/10 border border-[#4169E1]/25">
            <div className="flex items-center gap-1.5 text-[#4169E1] dark:text-[#93C5FD] text-xs font-semibold mb-1">
              <Building2 className="w-4 h-4" />
              <span>Bank / Card</span>
            </div>
            <p className="text-base sm:text-lg font-bold text-[#172033] dark:text-white font-mono-num">
              {formatCurrency(methodBreakdown.bank, lang)}
            </p>
          </div>

          <div className="p-3 rounded-[10px] bg-[#F59E0B]/10 border border-[#F59E0B]/25">
            <div className="flex items-center gap-1.5 text-[#F59E0B] text-xs font-semibold mb-1">
              <CreditCard className="w-4 h-4" />
              <span>Customer Due</span>
            </div>
            <p className="text-base sm:text-lg font-bold text-[#172033] dark:text-white font-mono-num">
              {formatCurrency(methodBreakdown.due, lang)}
            </p>
          </div>
        </div>
      </div>

      {/* Recent Transactions Table */}
      <div className="adp-card overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-[#E2E8F0] dark:border-[#1F3158] flex items-center justify-between">
          <div>
            <h3 className="font-bold text-[#172033] dark:text-white text-sm sm:text-base">Your Recent Transactions</h3>
            <p className="text-xs text-[#64748B] dark:text-slate-400">Invoices completed under your account</p>
          </div>
          <button
            onClick={onOpenPOS}
            className="flex items-center gap-1.5 text-xs font-bold text-white bg-[#087F8C] hover:brightness-110 px-3 py-1.5 rounded-[10px] transition-all cursor-pointer"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>New Sale</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F8FAFC] dark:bg-[#0E182E] border-b border-[#E2E8F0] dark:border-[#1F3158] text-[#64748B] dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Invoice #</th>
                <th className="px-4 py-3 font-semibold">Date &amp; Time</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold text-right">Total</th>
                <th className="px-4 py-3 font-semibold text-right">Paid</th>
                <th className="px-4 py-3 font-semibold text-right">Due</th>
                <th className="px-4 py-3 font-semibold">Method</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158]">
              {recentTransactions.map(sale => (
                <tr key={sale.id} className="hover:bg-[#F8FAFC] dark:hover:bg-[#162344]/60 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[#172033] dark:text-white">
                    {sale.invoiceNumber}
                  </td>
                  <td className="px-4 py-3 text-[#64748B] dark:text-slate-400 whitespace-nowrap">
                    {formatDate(sale.date, lang)}
                  </td>
                  <td className="px-4 py-3 font-medium text-[#172033] dark:text-slate-200">
                    {sale.customerName}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num font-bold text-[#172033] dark:text-white">
                    {formatCurrency(sale.total, lang)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num text-[#10B981] font-semibold">
                    {formatCurrency(sale.paid, lang)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num font-bold">
                    <span className={sale.due > 0 ? 'text-[#F06464]' : 'text-slate-400'}>
                      {sale.due > 0 ? formatCurrency(sale.due, lang) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 capitalize text-[#64748B] dark:text-slate-300 font-medium">
                    {sale.paymentMethod}
                  </td>
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelectedInvoice(sale)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[#172033] dark:text-slate-200 bg-[#F1F4F9] dark:bg-[#162344] hover:bg-slate-200 dark:hover:bg-[#1F3158] rounded-[8px] font-semibold transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View</span>
                    </button>
                  </td>
                </tr>
              ))}

              {recentTransactions.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[#64748B] dark:text-slate-400">
                    <Receipt className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="font-medium">No sales recorded yet under your account.</p>
                    <button
                      onClick={onOpenPOS}
                      className="mt-2 text-[#087F8C] dark:text-[#D6AD60] font-semibold hover:underline cursor-pointer"
                    >
                      Click here to start a sale at POS
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice Modal */}
      {selectedInvoice && (
        <InvoiceModal
          sale={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          settings={settings}
        />
      )}

      {/* Change Password Modal */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 bg-[#0B1428]/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#101B35] rounded-[14px] shadow-2xl border border-[#E2E8F0] dark:border-[#1F3158] w-full max-w-md overflow-hidden adp-modal-enter">
            <div className="flex items-center justify-between p-4 border-b border-[#E2E8F0] dark:border-[#1F3158] bg-[#101B35] text-white">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#D6AD60]" />
                <h3 className="font-bold text-sm sm:text-base">Change My Password</h3>
              </div>
              <button
                onClick={() => setIsPasswordModalOpen(false)}
                className="text-slate-300 hover:text-white p-1 rounded-[8px] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleChangePassword} className="p-4 sm:p-6 space-y-4">
              {passwordFeedback && (
                <div
                  className={`p-3 text-xs rounded-[10px] flex items-center gap-2 ${
                    passwordFeedback.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-700/60 text-emerald-800 dark:text-emerald-200'
                      : 'bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/60 text-rose-800 dark:text-rose-200'
                  }`}
                >
                  {passwordFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-[#F06464] shrink-0" />
                  )}
                  <span>{passwordFeedback.text}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#172033] dark:text-slate-200 mb-1">New Password</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="adp-input w-full px-3 py-2 text-xs sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172033] dark:text-slate-200 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-type new password"
                  className="adp-input w-full px-3 py-2 text-xs sm:text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0] dark:border-[#1F3158]">
                <button
                  type="button"
                  onClick={() => setIsPasswordModalOpen(false)}
                  className="px-4 py-2 border border-[#E2E8F0] dark:border-[#1F3158] text-[#172033] dark:text-slate-200 rounded-[10px] text-xs font-medium hover:bg-[#F8FAFC] dark:hover:bg-[#162344] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingPassword}
                  className="flex items-center gap-2 px-5 py-2 bg-[#087F8C] hover:brightness-110 text-white rounded-[10px] text-xs font-semibold cursor-pointer"
                >
                  {isUpdatingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Update Password</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
