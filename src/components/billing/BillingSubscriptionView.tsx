import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  Crown,
  LifeBuoy,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { subscriptionService } from '../../services/subscriptionService';
import { PlatformPayment, SubscriptionPlan, SupportTicket } from '../../types';

export const BillingSubscriptionView: React.FC = () => {
  const {
    activeBusinessId,
    settings,
    activeSubscription,
    availablePlans,
    billingInstructions,
    subscriptionUsage,
    branches,
    products,
    employees,
    refreshSubscription,
    setCreateNewBusinessModalOpen,
    isAuthenticatedAdmin,
  } = useApp();

  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [payments, setPayments] = useState<PlatformPayment[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Payment Submission Modal
  const [payModalPlan, setPayModalPlan] = useState<SubscriptionPlan | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('bkash');
  const [transactionId, setTransactionId] = useState('');
  const [senderNumber, setSenderNumber] = useState('');

  // Support Ticket Form
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketCategory, setTicketCategory] = useState<SupportTicket['category']>('billing');
  const [ticketPriority, setTicketPriority] = useState<SupportTicket['priority']>('medium');
  const [ticketMessage, setTicketMessage] = useState('');

  const loadBillingData = useCallback(async () => {
    if (!activeBusinessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [snap, tktList] = await Promise.all([
        subscriptionService.fetchBusinessBilling(activeBusinessId),
        subscriptionService.fetchTickets(activeBusinessId),
      ]);
      setPayments(snap.payments);
      setTickets(tktList);
      await refreshSubscription();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to load subscription billing history.');
    } finally {
      setLoading(false);
    }
  }, [activeBusinessId, refreshSubscription]);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);

  const currentUsersCount = Math.max(
    employees.filter(e => e.accountStatus === 'active').length + 1,
    subscriptionUsage.users
  );
  const currentBranchesCount = Math.max(branches.length, subscriptionUsage.branches);
  const currentProductsCount = Math.max(products.length, subscriptionUsage.products);

  const periodEndDate = activeSubscription?.currentPeriodEnd
    ? new Date(activeSubscription.currentPeriodEnd)
    : null;
  const daysRemaining = periodEndDate
    ? Math.max(0, Math.ceil((periodEndDate.getTime() - Date.now()) / 86400_000))
    : null;

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModalPlan || !activeBusinessId) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await subscriptionService.submitPayment({
        businessId: activeBusinessId,
        planCode: payModalPlan.code,
        billingCycle,
        paymentMethod,
        transactionId: transactionId.trim(),
        senderNumber: senderNumber.trim() || undefined,
      });
      setNotice(res.message);
      setPayModalPlan(null);
      setTransactionId('');
      setSenderNumber('');
      await loadBillingData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to submit payment verification.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBusinessId || !ticketSubject.trim() || !ticketMessage.trim()) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await subscriptionService.createTicket({
        businessId: activeBusinessId,
        subject: ticketSubject.trim(),
        message: ticketMessage.trim(),
        category: ticketCategory,
        priority: ticketPriority,
      });
      setNotice('Support ticket submitted. Our platform support team will respond shortly.');
      setTicketSubject('');
      setTicketMessage('');
      await loadBillingData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create support ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderUsageRow = (label: string, current: number, limit: number) => {
    const unlimited = limit === 0;
    const pct = unlimited ? 12 : Math.min(100, Math.round((current / Math.max(1, limit)) * 100));
    const overLimit = !unlimited && current >= limit;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-[#172033] dark:text-slate-200">{label}</span>
          <span className={`font-mono-num font-bold ${overLimit ? 'text-rose-500' : 'text-[#087F8C] dark:text-[#5EEAD4]'}`}>
            {current.toLocaleString()} / {unlimited ? 'Unlimited' : limit.toLocaleString()}
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 dark:bg-[#0E182E] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${overLimit ? 'bg-rose-500' : 'bg-[#087F8C]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#172033] dark:text-white flex items-center gap-2">
            <Crown className="w-5 h-5 text-[#D6AD60]" />
            <span>Plan, Billing &amp; Platform Support</span>
          </h1>
          <p className="text-xs text-[#64748B] dark:text-slate-400 mt-0.5">
            Manage subscription tier, quota usage, renewal invoices, and direct support for {settings.shopName || 'your shop'}.
          </p>
        </div>

        {isAuthenticatedAdmin && (
          <button
            type="button"
            onClick={() => setCreateNewBusinessModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-[#101B35] text-white border border-[#D6AD60]/40 text-xs font-bold cursor-pointer self-start"
          >
            <Plus className="w-3.5 h-3.5 text-[#D6AD60]" />
            <span>Add Another Business</span>
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-[12px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/60 text-rose-800 dark:text-rose-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#F06464]" />
            <span>{errorMsg}</span>
          </div>
          <button type="button" onClick={() => setErrorMsg(null)} className="font-bold underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-[12px] bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-700/60 text-emerald-800 dark:text-emerald-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
            <span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice(null)} className="font-bold underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Current Subscription + Quota Usage */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 bg-[#101B35] text-white rounded-[14px] border border-[#D6AD60]/30 p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#D6AD60]">Active Subscription</span>
              <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded-[6px] bg-white/10">
                {activeSubscription?.status || 'trialing'}
              </span>
            </div>
            <div className="mt-2 text-2xl font-extrabold">
              {activeSubscription?.plan?.name || activeSubscription?.planCode || 'Free Trial'}
            </div>
            <div className="mt-1 text-xs text-slate-300 capitalize">
              Billing Cycle: {activeSubscription?.billingCycle || 'trial'}
              {daysRemaining !== null && (
                <span className="ml-2 text-[#D6AD60] font-mono-num font-semibold">
                  · {daysRemaining} day{daysRemaining === 1 ? '' : 's'} remaining
                </span>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-white/15 flex items-center justify-between text-xs text-slate-300">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#D6AD60]" />
              Period Ends: {periodEndDate ? periodEndDate.toLocaleDateString() : '14-Day Trial'}
            </span>
            <span className="flex items-center gap-1.5 text-[#5EEAD4]">
              <ShieldCheck className="w-3.5 h-3.5" />
              Tenant Isolated
            </span>
          </div>
        </div>

        <div className="lg:col-span-7 adp-card p-5 border border-[#E2E8F0] dark:border-[#1F3158] space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#172033] dark:text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#087F8C]" />
              <span>Workspace Resource Usage &amp; Plan Limits</span>
            </h2>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-[#087F8C]" />}
          </div>
          <div className="space-y-3">
            {renderUsageRow('Active Team / Staff Users', currentUsersCount, activeSubscription?.maxUsers ?? 3)}
            {renderUsageRow('Store Branches / Outlets', currentBranchesCount, activeSubscription?.maxBranches ?? 1)}
            {renderUsageRow('Product Catalog Items', currentProductsCount, activeSubscription?.maxProducts ?? 250)}
          </div>
        </div>
      </div>

      {/* Plans Upgrade / Renewal Grid */}
      <div className="adp-card p-5 border border-[#E2E8F0] dark:border-[#1F3158] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#172033] dark:text-white">Subscription Plans &amp; Upgrades</h2>
            <p className="text-xs text-[#64748B] dark:text-slate-400">
              Choose a plan and submit your payment reference to upgrade or extend validity.
            </p>
          </div>
          <div className="inline-flex rounded-[10px] border border-[#E2E8F0] dark:border-[#1F3158] p-1 bg-[#F8FAFC] dark:bg-[#0E182E]">
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              className={`px-3 py-1 rounded-[7px] text-xs font-bold cursor-pointer ${
                billingCycle === 'monthly' ? 'bg-[#087F8C] text-white' : 'text-slate-500'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('yearly')}
              className={`px-3 py-1 rounded-[7px] text-xs font-bold cursor-pointer ${
                billingCycle === 'yearly' ? 'bg-[#087F8C] text-white' : 'text-slate-500'
              }`}
            >
              Yearly (Save ~17%)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {availablePlans
            .filter(p => p.priceMonthly > 0 || p.code === activeSubscription?.planCode)
            .map(plan => {
              const price = billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
              const isCurrent = activeSubscription?.planCode === plan.code;
              return (
                <div
                  key={plan.id}
                  className={`rounded-[12px] p-4 border flex flex-col justify-between gap-4 ${
                    isCurrent
                      ? 'border-[#D6AD60] bg-[#D6AD60]/5'
                      : 'border-[#E2E8F0] dark:border-[#1F3158] bg-white dark:bg-[#0E182E]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-[#172033] dark:text-white">{plan.name}</span>
                      {isCurrent && (
                        <span className="text-[10px] font-bold uppercase text-[#9A7428] dark:text-[#D6AD60]">Current</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-1">{plan.description}</p>
                    <div className="mt-3 text-xl font-extrabold font-mono-num text-[#172033] dark:text-white">
                      {price > 0 ? `৳${price.toLocaleString()}` : 'Free'}
                      {price > 0 && (
                        <span className="text-xs font-normal text-slate-400">
                          /{billingCycle === 'yearly' ? 'yr' : 'mo'}
                        </span>
                      )}
                    </div>
                    <ul className="mt-3 space-y-1 text-[11px] text-[#475569] dark:text-slate-300 font-mono-num">
                      <li>• Staff Users: {plan.maxUsers === 0 ? 'Unlimited' : plan.maxUsers}</li>
                      <li>• Branches: {plan.maxBranches === 0 ? 'Unlimited' : plan.maxBranches}</li>
                      <li>• Products: {plan.maxProducts === 0 ? 'Unlimited' : plan.maxProducts.toLocaleString()}</li>
                    </ul>
                  </div>

                  {price > 0 && isAuthenticatedAdmin && (
                    <button
                      type="button"
                      onClick={() => setPayModalPlan(plan)}
                      className="w-full py-2 rounded-[9px] bg-[#087F8C] hover:brightness-110 text-white text-xs font-bold cursor-pointer"
                    >
                      {isCurrent ? 'Renew Plan' : 'Upgrade to ' + plan.name}
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Payment History + Support Tickets */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Invoices & Payments */}
        <div className="lg:col-span-6 adp-card border border-[#E2E8F0] dark:border-[#1F3158] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E2E8F0] dark:border-[#1F3158] flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#172033] dark:text-white flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[#087F8C]" />
              <span>Subscription Payment History</span>
            </h2>
          </div>
          <div className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158] max-h-96 overflow-y-auto">
            {payments.map(p => (
              <div key={p.id} className="p-3.5 flex items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-mono font-bold text-[#172033] dark:text-white">{p.invoiceNumber}</div>
                  <div className="text-[11px] text-slate-400">
                    {p.gatewayProvider.toUpperCase()} · Trx: {p.transactionId || '—'} · {new Date(p.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono-num font-bold">৳{p.amount.toLocaleString()}</div>
                  <div
                    className={`text-[10.5px] font-bold uppercase ${
                      p.status === 'verified'
                        ? 'text-emerald-600'
                        : p.status === 'pending'
                        ? 'text-amber-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {p.status}
                  </div>
                </div>
              </div>
            ))}
            {payments.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-400">No subscription payment submissions yet.</div>
            )}
          </div>
        </div>

        {/* Support Ticket Box */}
        <div className="lg:col-span-6 adp-card p-5 border border-[#E2E8F0] dark:border-[#1F3158] space-y-4">
          <h2 className="text-sm font-bold text-[#172033] dark:text-white flex items-center gap-2">
            <LifeBuoy className="w-4 h-4 text-[#D6AD60]" />
            <span>Platform Support Desk</span>
          </h2>

          <form onSubmit={handleCreateTicket} className="space-y-2.5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                required
                value={ticketSubject}
                onChange={e => setTicketSubject(e.target.value)}
                placeholder="Subject / Issue title"
                className="sm:col-span-1 p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
              />
              <select
                value={ticketCategory}
                onChange={e => setTicketCategory(e.target.value as any)}
                className="p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
              >
                <option value="billing">Billing &amp; Plan</option>
                <option value="technical">Technical Issue</option>
                <option value="account">Account Access</option>
                <option value="feature_request">Feature Request</option>
                <option value="general">General</option>
              </select>
              <select
                value={ticketPriority}
                onChange={e => setTicketPriority(e.target.value as any)}
                className="p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
              >
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <textarea
              rows={2}
              required
              value={ticketMessage}
              onChange={e => setTicketMessage(e.target.value)}
              placeholder="Describe your request for the Platform Support team..."
              className="w-full p-2.5 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
            />
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#101B35] text-white text-xs font-bold cursor-pointer"
            >
              <Send className="w-3.5 h-3.5 text-[#D6AD60]" />
              <span>Submit Ticket</span>
            </button>
          </form>

          <div className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158] max-h-48 overflow-y-auto text-xs pt-2">
            {tickets.map(t => (
              <div key={t.id} className="py-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#172033] dark:text-white">{t.subject}</span>
                  <span className="text-[10.5px] font-bold uppercase text-[#087F8C]">{t.status.replace('_', ' ')}</span>
                </div>
                <p className="text-[11px] text-slate-400">{t.message}</p>
                {t.adminResponse && (
                  <div className="p-2 rounded-[6px] bg-emerald-50/70 dark:bg-emerald-950/30 text-[11px] text-emerald-800 dark:text-emerald-200">
                    <strong>Support Reply:</strong> {t.adminResponse}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {payModalPlan && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitPayment}
            className="w-full max-w-md bg-white dark:bg-[#101B35] rounded-[14px] border border-[#E2E8F0] dark:border-[#1F3158] p-5 space-y-4 shadow-2xl"
          >
            <h3 className="text-base font-bold text-[#172033] dark:text-white">
              Subscribe to {payModalPlan.name} ({billingCycle})
            </h3>
            <div className="p-3 rounded-[10px] bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] text-xs space-y-1">
              <div className="font-bold text-[#087F8C] font-mono-num text-sm">
                Amount Due: ৳
                {(billingCycle === 'yearly' ? payModalPlan.priceYearly : payModalPlan.priceMonthly).toLocaleString()}
              </div>
              {billingInstructions && (
                <div className="text-[11px] text-[#475569] dark:text-slate-300 space-y-0.5 pt-1">
                  {billingInstructions.bkashNumber && <div>bKash: <strong className="font-mono">{billingInstructions.bkashNumber}</strong></div>}
                  {billingInstructions.nagadNumber && <div>Nagad: <strong className="font-mono">{billingInstructions.nagadNumber}</strong></div>}
                  {billingInstructions.rocketNumber && <div>Rocket: <strong className="font-mono">{billingInstructions.rocketNumber}</strong></div>}
                  {billingInstructions.bankDetails && <div>Bank: {billingInstructions.bankDetails}</div>}
                  {billingInstructions.note && <div className="text-slate-400 pt-0.5">{billingInstructions.note}</div>}
                </div>
              )}
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Payment Channel</label>
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value)}
                  className="w-full p-2.5 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
                >
                  <option value="bkash">bKash</option>
                  <option value="nagad">Nagad</option>
                  <option value="rocket">Rocket</option>
                  <option value="bank">Bank Transfer</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Transaction ID / Reference *</label>
                <input
                  type="text"
                  required
                  value={transactionId}
                  onChange={e => setTransactionId(e.target.value)}
                  placeholder="e.g. TRX8A9B2C1D"
                  className="w-full p-2.5 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Sender Mobile Number</label>
                <input
                  type="text"
                  value={senderNumber}
                  onChange={e => setSenderNumber(e.target.value)}
                  placeholder="017XXXXXXXX"
                  className="w-full p-2.5 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPayModalPlan(null)} className="px-4 py-2 rounded-[8px] border text-xs cursor-pointer">
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-[8px] bg-[#087F8C] text-white text-xs font-bold cursor-pointer"
              >
                {submitting ? 'Submitting...' : 'Submit for Verification'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
