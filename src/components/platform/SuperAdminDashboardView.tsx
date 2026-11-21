import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  CreditCard,
  Crown,
  Database,
  FileText,
  HardDrive,
  LifeBuoy,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Store,
  TrendingUp,
  Users,
  XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  PlatformBusinessItem,
  PlatformOverviewMetrics,
  PlatformSecuritySnapshot,
  PlatformSystemHealth,
  platformAdminService,
} from '../../services/platformAdminService';
import {
  BusinessSubscription,
  PlatformAdmin,
  PlatformAuditLog,
  PlatformBillingSettings,
  PlatformGeneralSettings,
  PlatformPayment,
  PlatformRole,
  SubscriptionPlan,
  SupportTicket,
} from '../../types';

type PlatformTab =
  | 'overview'
  | 'businesses'
  | 'subscriptions'
  | 'plans'
  | 'payments'
  | 'tickets'
  | 'team'
  | 'security';

const TABS: { id: PlatformTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: TrendingUp },
  { id: 'businesses', label: 'Businesses', icon: Building2 },
  { id: 'subscriptions', label: 'Subscriptions', icon: Crown },
  { id: 'plans', label: 'Plans', icon: CreditCard },
  { id: 'payments', label: 'Payments', icon: FileText },
  { id: 'tickets', label: 'Support Tickets', icon: LifeBuoy },
  { id: 'team', label: 'Team & Settings', icon: Settings },
  { id: 'security', label: 'Security & Audit', icon: ShieldAlert },
];

export const SuperAdminDashboardView: React.FC = () => {
  const { platformAdmin, userBusinesses, switchBusiness, setPlatformViewActive, setCreateNewBusinessModalOpen } = useApp();

  const [tab, setTab] = useState<PlatformTab>('overview');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  // Core Data
  const [metrics, setMetrics] = useState<PlatformOverviewMetrics | null>(null);
  const [health, setHealth] = useState<PlatformSystemHealth | null>(null);
  const [recentBusinesses, setRecentBusinesses] = useState<
    Array<{ id: string; name: string; status?: string; created_at: string; business_type?: string }>
  >([]);
  const [businesses, setBusinesses] = useState<PlatformBusinessItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<BusinessSubscription[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [payments, setPayments] = useState<PlatformPayment[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [admins, setAdmins] = useState<PlatformAdmin[]>([]);
  const [auditLogs, setAuditLogs] = useState<PlatformAuditLog[]>([]);
  const [securitySnap, setSecuritySnap] = useState<PlatformSecuritySnapshot | null>(null);
  const [generalSettings, setGeneralSettings] = useState<PlatformGeneralSettings>({
    platformName: 'PROTIVA',
    supportEmail: 'support@protiva.app',
    supportPhone: '',
    defaultCurrency: 'BDT',
    allowPublicSignup: true,
    requireMobileOtp: true,
  });
  const [billingSettings, setBillingSettings] = useState<PlatformBillingSettings>({
    bkashNumber: '',
    nagadNumber: '',
    rocketNumber: '',
    bankDetails: '',
    note: '',
  });

  // Filters
  const [bizSearch, setBizSearch] = useState('');
  const [bizFilter, setBizFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [payFilter, setPayFilter] = useState<'all' | 'pending' | 'verified' | 'rejected'>('all');
  const [ticketFilter, setTicketFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved'>('all');

  // Interactive Modals
  const [statusModal, setStatusModal] = useState<{ biz: PlatformBusinessItem; nextStatus: 'active' | 'suspended' } | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [assignSubModal, setAssignSubModal] = useState<{
    businessId: string;
    businessName: string;
    planCode: string;
    billingCycle: 'trial' | 'monthly' | 'yearly' | 'lifetime';
    status: BusinessSubscription['status'];
    durationDays: string;
    notes: string;
  } | null>(null);

  const [planModal, setPlanModal] = useState<{
    id?: string;
    code: string;
    name: string;
    description: string;
    priceMonthly: number;
    priceYearly: number;
    trialDays: number;
    gracePeriodDays: number;
    maxUsers: number;
    maxBranches: number;
    maxProducts: number;
    isActive: boolean;
  } | null>(null);

  const [payVerifyModal, setPayVerifyModal] = useState<{
    payment: PlatformPayment;
    nextStatus: 'verified' | 'rejected';
    adminNote: string;
  } | null>(null);

  const [ticketModal, setTicketModal] = useState<{
    ticket: SupportTicket;
    status: SupportTicket['status'];
    priority: SupportTicket['priority'];
    adminResponse: string;
  } | null>(null);

  const [newAdminForm, setNewAdminForm] = useState<{ email: string; fullName: string; role: PlatformRole }>({
    email: '',
    fullName: '',
    role: 'SUPPORT_ADMIN',
  });

  const [submitting, setSubmitting] = useState(false);

  const role = platformAdmin?.role || 'PLATFORM_VIEWER';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const canManageBilling = isSuperAdmin || role === 'BILLING_ADMIN';
  const canManageSupport = isSuperAdmin || role === 'SUPPORT_ADMIN';

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [ov, bizList, subsList, planList, payList, tktList, admList, setRes, logList, secRes] =
        await Promise.all([
          platformAdminService.fetchOverview(),
          platformAdminService.fetchBusinesses(),
          platformAdminService.fetchSubscriptions(),
          platformAdminService.fetchPlans(),
          platformAdminService.fetchPayments(),
          platformAdminService.fetchTickets(),
          platformAdminService.fetchPlatformAdmins().catch(() => [] as PlatformAdmin[]),
          platformAdminService.fetchPlatformSettings().catch(() => ({ general: null, billing: null })),
          platformAdminService.fetchAuditLogs().catch(() => [] as PlatformAuditLog[]),
          platformAdminService.fetchSecuritySnapshot().catch(() => null),
        ]);
      setMetrics(ov.metrics);
      setHealth(ov.systemHealth);
      setRecentBusinesses(ov.recentBusinesses || []);
      setBusinesses(bizList);
      setSubscriptions(subsList);
      setPlans(planList);
      setPayments(payList);
      setTickets(tktList);
      setAdmins(admList);
      if (setRes.general) setGeneralSettings(setRes.general);
      if (setRes.billing) setBillingSettings(setRes.billing);
      setAuditLogs(logList);
      setSecuritySnap(secRes);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load Platform Super Admin console. Ensure SUPABASE_SERVICE_ROLE_KEY is configured.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filteredBusinesses = useMemo(() => {
    const q = bizSearch.trim().toLowerCase();
    return businesses.filter(b => {
      if (bizFilter === 'active' && (!b.isActive || b.status === 'suspended')) return false;
      if (bizFilter === 'suspended' && b.isActive && b.status !== 'suspended') return false;
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        (b.ownerEmail || '').toLowerCase().includes(q) ||
        (b.phone || '').toLowerCase().includes(q) ||
        (b.subscription?.planCode || '').toLowerCase().includes(q)
      );
    });
  }, [businesses, bizFilter, bizSearch]);

  const filteredPayments = useMemo(() => {
    if (payFilter === 'all') return payments;
    return payments.filter(p => p.status === payFilter);
  }, [payments, payFilter]);

  const filteredTickets = useMemo(() => {
    if (ticketFilter === 'all') return tickets;
    return tickets.filter(t => t.status === ticketFilter);
  }, [tickets, ticketFilter]);

  const handleToggleBusinessStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModal) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await platformAdminService.updateBusinessStatus(statusModal.biz.id, statusModal.nextStatus, statusReason);
      setNoticeMsg(
        `Business "${statusModal.biz.name}" is now ${statusModal.nextStatus}. All business data remains preserved.`
      );
      setStatusModal(null);
      setStatusReason('');
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update business status.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignSubModal) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await platformAdminService.assignSubscription({
        businessId: assignSubModal.businessId,
        planCode: assignSubModal.planCode,
        billingCycle: assignSubModal.billingCycle,
        status: assignSubModal.status,
        durationDays: assignSubModal.durationDays ? Number(assignSubModal.durationDays) : undefined,
        notes: assignSubModal.notes || undefined,
      });
      setNoticeMsg(`Updated subscription for "${assignSubModal.businessName}".`);
      setAssignSubModal(null);
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to assign subscription.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planModal) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      if (planModal.id) {
        await platformAdminService.updatePlan(planModal.id, {
          name: planModal.name,
          description: planModal.description,
          priceMonthly: planModal.priceMonthly,
          priceYearly: planModal.priceYearly,
          trialDays: planModal.trialDays,
          gracePeriodDays: planModal.gracePeriodDays,
          maxUsers: planModal.maxUsers,
          maxBranches: planModal.maxBranches,
          maxProducts: planModal.maxProducts,
          isActive: planModal.isActive,
        });
        setNoticeMsg(`Plan "${planModal.name}" updated.`);
      } else {
        await platformAdminService.createPlan({
          code: planModal.code,
          name: planModal.name,
          description: planModal.description,
          priceMonthly: planModal.priceMonthly,
          priceYearly: planModal.priceYearly,
          trialDays: planModal.trialDays,
          gracePeriodDays: planModal.gracePeriodDays,
          maxUsers: planModal.maxUsers,
          maxBranches: planModal.maxBranches,
          maxProducts: planModal.maxProducts,
          isActive: planModal.isActive,
        });
        setNoticeMsg(`Plan "${planModal.name}" created.`);
      }
      setPlanModal(null);
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save plan.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payVerifyModal) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await platformAdminService.verifyPayment(
        payVerifyModal.payment.id,
        payVerifyModal.nextStatus,
        payVerifyModal.adminNote
      );
      setNoticeMsg(
        payVerifyModal.nextStatus === 'verified'
          ? `Payment ${payVerifyModal.payment.invoiceNumber} verified — business subscription activated.`
          : `Payment ${payVerifyModal.payment.invoiceNumber} marked as rejected.`
      );
      setPayVerifyModal(null);
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to verify payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketModal) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await platformAdminService.updateTicket(ticketModal.ticket.id, {
        status: ticketModal.status,
        priority: ticketModal.priority,
        adminResponse: ticketModal.adminResponse,
      });
      setNoticeMsg(`Support ticket "${ticketModal.ticket.subject}" updated.`);
      setTicketModal(null);
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update support ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddPlatformAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await platformAdminService.assignPlatformAdmin(newAdminForm);
      setNoticeMsg(`Assigned ${newAdminForm.role} access to ${newAdminForm.email}.`);
      setNewAdminForm({ email: '', fullName: '', role: 'SUPPORT_ADMIN' });
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to assign platform role.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleAdminActive = async (adm: PlatformAdmin) => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await platformAdminService.updatePlatformAdmin(adm.id, { isActive: !adm.isActive });
      setNoticeMsg(`${adm.email} is now ${!adm.isActive ? 'active' : 'disabled'}.`);
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update platform admin.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveSettings = async (key: 'general' | 'billing_instructions', val: Record<string, any>) => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await platformAdminService.savePlatformSettings(key, val);
      setNoticeMsg(`Saved platform ${key === 'general' ? 'general settings' : 'billing instructions'}.`);
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save platform settings.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 pb-10">
      {/* Platform Header Bar */}
      <div className="bg-[#101B3F] text-white rounded-[14px] border border-[#FF9D32]/30 p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-[12px] bg-white p-1 flex items-center justify-center shrink-0 shadow-md">
            <img
              src="/protiva-symbol.png"
              alt="PROTIVA"
              className="w-full h-full object-contain"
            />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight">PROTIVA Super Admin Console</h1>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-[6px] bg-[#FF9D32]/20 text-[#FF9D32] border border-[#FF9D32]/40">
                {role}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Multi-Tenant SaaS Control Plane · Businesses, Subscriptions, Revenue Verification &amp; Platform Governance
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {userBusinesses.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setPlatformViewActive(false);
                switchBusiness(userBusinesses[0].businessId);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold cursor-pointer"
            >
              <Store className="w-3.5 h-3.5 text-[#5EEAD4]" />
              <span>Return to My Shop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCreateNewBusinessModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#FF9D32]" />
              <span>Open a Shop Workspace</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => loadAll()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-[#243B70] hover:brightness-110 text-white border border-[#FF9D32]/35 text-xs font-bold cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Console Sub-Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {TABS.map(item => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-xs font-semibold border whitespace-nowrap transition-colors cursor-pointer ${
                active
                  ? 'bg-[#101B3F] text-white border-[#FF9D32]/60 shadow-xs'
                  : 'bg-white dark:bg-[#101B3F] text-[#475569] dark:text-slate-300 border-[#E2E8F0] dark:border-[#243B70] hover:border-[#243B70]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#FF9D32]' : 'text-slate-400'}`} />
              <span>{item.label}</span>
              {item.id === 'payments' && (metrics?.pendingPaymentsCount || 0) > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-[6px] bg-[#FF9D32] text-[#101B3F] text-[10px] font-bold font-mono-num">
                  {metrics?.pendingPaymentsCount}
                </span>
              )}
              {item.id === 'tickets' && (metrics?.openTicketsCount || 0) > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-[6px] bg-rose-500 text-white text-[10px] font-bold font-mono-num">
                  {metrics?.openTicketsCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-[12px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/60 text-rose-800 dark:text-rose-200 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#F06464] shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-xs font-bold underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {noticeMsg && (
        <div className="p-3.5 rounded-[12px] bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-700/60 text-emerald-800 dark:text-emerald-200 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
            <span>{noticeMsg}</span>
          </div>
          <button type="button" onClick={() => setNoticeMsg(null)} className="text-xs font-bold underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {loading && !metrics ? (
        <div className="adp-card p-12 flex flex-col items-center justify-center gap-3 text-xs text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin text-[#087F8C]" />
          <span>Loading Platform SaaS Telemetry...</span>
        </div>
      ) : (
        <>
          {/* TAB 1: OVERVIEW */}
          {tab === 'overview' && metrics && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="adp-card p-4 border border-[#E2E8F0] dark:border-[#1F3158]">
                  <div className="flex items-center justify-between text-xs text-[#64748B] dark:text-slate-400">
                    <span>Total Tenant Businesses</span>
                    <Building2 className="w-4 h-4 text-[#087F8C]" />
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono-num text-[#172033] dark:text-white">
                    {metrics.totalBusinesses}
                  </div>
                  <div className="mt-1 text-[11px] text-[#64748B] dark:text-slate-400">
                    {metrics.activeBusinesses} active · {metrics.suspendedBusinesses} suspended
                  </div>
                </div>

                <div className="adp-card p-4 border border-[#E2E8F0] dark:border-[#1F3158]">
                  <div className="flex items-center justify-between text-xs text-[#64748B] dark:text-slate-400">
                    <span>Active Subscriptions</span>
                    <Crown className="w-4 h-4 text-[#D6AD60]" />
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono-num text-[#172033] dark:text-white">
                    {metrics.activeSubscriptions}
                  </div>
                  <div className="mt-1 text-[11px] text-[#64748B] dark:text-slate-400">
                    {metrics.trialBusinesses} trials · {metrics.expiredSubscriptions} expired
                  </div>
                </div>

                <div className="adp-card p-4 border border-[#E2E8F0] dark:border-[#1F3158]">
                  <div className="flex items-center justify-between text-xs text-[#64748B] dark:text-slate-400">
                    <span>Monthly Recurring Revenue</span>
                    <TrendingUp className="w-4 h-4 text-[#10B981]" />
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono-num text-[#172033] dark:text-white">
                    ৳{metrics.monthlyRecurringRevenue.toLocaleString()}
                  </div>
                  <div className="mt-1 text-[11px] text-[#64748B] dark:text-slate-400">
                    ARR: ৳{metrics.annualRecurringRevenue.toLocaleString()} · Collected: ৳{metrics.verifiedRevenueTotal.toLocaleString()}
                  </div>
                </div>

                <div className="adp-card p-4 border border-[#E2E8F0] dark:border-[#1F3158]">
                  <div className="flex items-center justify-between text-xs text-[#64748B] dark:text-slate-400">
                    <span>Registered Platform Users</span>
                    <Users className="w-4 h-4 text-indigo-500" />
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono-num text-[#172033] dark:text-white">
                    {metrics.totalUsers}
                  </div>
                  <div className="mt-1 text-[11px] text-[#64748B] dark:text-slate-400">
                    {metrics.pendingPaymentsCount} pending payments · {metrics.openTicketsCount} open tickets
                  </div>
                </div>
              </div>

              {/* System Health Strip */}
              {health && (
                <div className="adp-card p-4 border border-[#E2E8F0] dark:border-[#1F3158] flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#172033] dark:text-white">
                    <Activity className="w-4 h-4 text-[#10B981]" />
                    <span>System Health Telemetry</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-[#475569] dark:text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-[#087F8C]" />
                      PostgreSQL: <strong className="text-[#10B981] uppercase">{health.database}</strong> ({health.dbLatencyMs}ms)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-[#087F8C]" />
                      Storage: <strong className="text-[#10B981] uppercase">{health.storage}</strong> ({health.bucketCount} buckets)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#087F8C]" />
                      Auth Service: <strong className="text-[#10B981] uppercase">{health.authService}</strong>
                    </span>
                  </div>
                </div>
              )}

              {/* Recent Businesses */}
              <div className="adp-card border border-[#E2E8F0] dark:border-[#1F3158] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#E2E8F0] dark:border-[#1F3158] flex items-center justify-between">
                  <h2 className="text-sm font-bold text-[#172033] dark:text-white">Recently Registered Businesses</h2>
                  <button
                    type="button"
                    onClick={() => setTab('businesses')}
                    className="text-xs font-semibold text-[#087F8C] dark:text-[#D6AD60] hover:underline cursor-pointer"
                  >
                    View all businesses →
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[#F8FAFC] dark:bg-[#0E182E] text-[#64748B] dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Shop Name</th>
                        <th className="px-4 py-2.5 font-semibold">Category</th>
                        <th className="px-4 py-2.5 font-semibold">Status</th>
                        <th className="px-4 py-2.5 font-semibold">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158]">
                      {recentBusinesses.map(b => (
                        <tr key={b.id} className="hover:bg-slate-50/70 dark:hover:bg-[#162344]/50">
                          <td className="px-4 py-2.5 font-semibold text-[#172033] dark:text-white">{b.name}</td>
                          <td className="px-4 py-2.5 capitalize text-[#64748B] dark:text-slate-400">{b.business_type || 'general'}</td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`text-[11px] font-bold uppercase ${
                                b.status === 'suspended' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {b.status || 'active'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-[#64748B] dark:text-slate-400 font-mono-num">
                            {new Date(b.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                      {recentBusinesses.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                            No tenant businesses found yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: BUSINESSES DIRECTORY */}
          {tab === 'businesses' && (
            <div className="adp-card border border-[#E2E8F0] dark:border-[#1F3158] overflow-hidden">
              <div className="p-4 border-b border-[#E2E8F0] dark:border-[#1F3158] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={bizSearch}
                    onChange={e => setBizSearch(e.target.value)}
                    placeholder="Search shop name, owner email, phone, or plan..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px]"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  {(['all', 'active', 'suspended'] as const).map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setBizFilter(f)}
                      className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold capitalize border cursor-pointer ${
                        bizFilter === f
                          ? 'bg-[#101B35] text-white border-[#D6AD60]/50'
                          : 'bg-transparent text-slate-500 border-[#E2E8F0] dark:border-[#1F3158]'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-[#F8FAFC] dark:bg-[#0E182E] text-[#64748B] dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Business &amp; Owner</th>
                      <th className="px-4 py-3 font-semibold">Scale (Users / Br / Prod)</th>
                      <th className="px-4 py-3 font-semibold">Subscription</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158]">
                    {filteredBusinesses.map(b => {
                      const suspended = !b.isActive || b.status === 'suspended';
                      return (
                        <tr key={b.id} className="hover:bg-slate-50/70 dark:hover:bg-[#162344]/50">
                          <td className="px-4 py-3">
                            <div className="font-bold text-[#172033] dark:text-white">{b.name}</div>
                            <div className="text-[11px] text-[#64748B] dark:text-slate-400">
                              {b.ownerName || 'Owner'} · {b.ownerEmail || b.phone || '—'}
                              {b.ownerMobileVerified && ' · OTP Verified'}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono-num text-[#172033] dark:text-slate-200">
                            {b.userCount} users · {b.branchCount} br · {b.productCount} prod
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-[#172033] dark:text-white">
                              {b.subscription?.plan?.name || b.subscription?.planCode || 'free_trial'}
                            </div>
                            <div className="text-[11px] text-[#64748B] dark:text-slate-400">
                              {b.subscription?.status || 'trialing'}
                              {b.subscription?.currentPeriodEnd
                                ? ` · Exp ${new Date(b.subscription.currentPeriodEnd).toLocaleDateString()}`
                                : ''}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-[11px] font-bold uppercase ${
                                suspended ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {suspended ? 'Suspended' : 'Active'}
                            </span>
                            {suspended && b.suspendedReason && (
                              <div className="text-[10.5px] text-rose-500 max-w-[180px] truncate">{b.suspendedReason}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                            {canManageBilling && (
                              <button
                                type="button"
                                onClick={() =>
                                  setAssignSubModal({
                                    businessId: b.id,
                                    businessName: b.name,
                                    planCode: b.subscription?.planCode || 'standard',
                                    billingCycle: (b.subscription?.billingCycle as any) || 'monthly',
                                    status: b.subscription?.status || 'active',
                                    durationDays: '',
                                    notes: '',
                                  })
                                }
                                className="px-2.5 py-1.5 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] hover:border-[#087F8C] text-[11px] font-semibold cursor-pointer"
                              >
                                Assign Plan
                              </button>
                            )}
                            {canManageSupport && (
                              <button
                                type="button"
                                onClick={() => {
                                  setStatusReason('');
                                  setStatusModal({ biz: b, nextStatus: suspended ? 'active' : 'suspended' });
                                }}
                                className={`px-2.5 py-1.5 rounded-[8px] text-[11px] font-bold cursor-pointer ${
                                  suspended
                                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                    : 'bg-rose-600 text-white hover:bg-rose-700'
                                }`}
                              >
                                {suspended ? 'Activate' : 'Suspend'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredBusinesses.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                          No businesses match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: SUBSCRIPTIONS */}
          {tab === 'subscriptions' && (
            <div className="adp-card border border-[#E2E8F0] dark:border-[#1F3158] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E2E8F0] dark:border-[#1F3158] flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#172033] dark:text-white">Tenant Subscriptions</h2>
                <span className="text-xs text-slate-400 font-mono-num">{subscriptions.length} total</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-[#F8FAFC] dark:bg-[#0E182E] text-[#64748B] dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Business</th>
                      <th className="px-4 py-3 font-semibold">Plan &amp; Cycle</th>
                      <th className="px-4 py-3 font-semibold">Limits (U / Br / Prod)</th>
                      <th className="px-4 py-3 font-semibold">Status &amp; Period End</th>
                      <th className="px-4 py-3 font-semibold text-right">Manage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158]">
                    {subscriptions.map(sub => (
                      <tr key={sub.id} className="hover:bg-slate-50/70 dark:hover:bg-[#162344]/50">
                        <td className="px-4 py-3 font-semibold text-[#172033] dark:text-white">
                          {sub.business?.name || sub.businessId}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-bold">{sub.plan?.name || sub.planCode}</span>{' '}
                          <span className="text-[#64748B] capitalize">({sub.billingCycle})</span>
                        </td>
                        <td className="px-4 py-3 font-mono-num">
                          {sub.maxUsers || '∞'} / {sub.maxBranches || '∞'} / {sub.maxProducts || '∞'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-bold uppercase text-[#087F8C] dark:text-[#D6AD60]">{sub.status}</span>
                          {sub.currentPeriodEnd && (
                            <span className="ml-2 text-[#64748B] font-mono-num">
                              {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canManageBilling && (
                            <button
                              type="button"
                              onClick={() =>
                                setAssignSubModal({
                                  businessId: sub.businessId,
                                  businessName: sub.business?.name || sub.businessId,
                                  planCode: sub.planCode,
                                  billingCycle: sub.billingCycle,
                                  status: sub.status,
                                  durationDays: '',
                                  notes: sub.notes || '',
                                })
                              }
                              className="px-3 py-1.5 rounded-[8px] bg-[#087F8C] text-white text-[11px] font-bold cursor-pointer"
                            >
                              Update Plan
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: PLANS */}
          {tab === 'plans' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#172033] dark:text-white">SaaS Subscription Plans</h2>
                  <p className="text-xs text-[#64748B] dark:text-slate-400">
                    Configure monthly/yearly pricing, trial durations, grace days, and resource quotas (0 = unlimited).
                  </p>
                </div>
                {canManageBilling && (
                  <button
                    type="button"
                    onClick={() =>
                      setPlanModal({
                        code: '',
                        name: '',
                        description: '',
                        priceMonthly: 999,
                        priceYearly: 9990,
                        trialDays: 14,
                        gracePeriodDays: 7,
                        maxUsers: 10,
                        maxBranches: 2,
                        maxProducts: 2000,
                        isActive: true,
                      })
                    }
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-[#087F8C] text-white text-xs font-bold cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>New Plan</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {plans.map(p => (
                  <div key={p.id} className="adp-card p-5 border border-[#E2E8F0] dark:border-[#1F3158] flex flex-col justify-between gap-4">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-[#172033] dark:text-white">{p.name}</span>
                        <span className="text-[10.5px] font-mono font-bold px-2 py-0.5 rounded-[6px] bg-slate-100 dark:bg-[#0E182E]">
                          {p.code}
                        </span>
                      </div>
                      <p className="text-xs text-[#64748B] dark:text-slate-400 mt-1">{p.description}</p>
                      <div className="mt-3 flex items-baseline gap-3 font-mono-num">
                        <span className="text-xl font-extrabold text-[#172033] dark:text-white">
                          ৳{p.priceMonthly.toLocaleString()}/mo
                        </span>
                        <span className="text-xs text-[#64748B]">৳{p.priceYearly.toLocaleString()}/yr</span>
                      </div>
                      <div className="mt-3 pt-3 border-t border-[#E2E8F0] dark:border-[#1F3158] space-y-1 text-xs text-[#475569] dark:text-slate-300 font-mono-num">
                        <div>Users Limit: {p.maxUsers === 0 ? 'Unlimited' : p.maxUsers}</div>
                        <div>Branches Limit: {p.maxBranches === 0 ? 'Unlimited' : p.maxBranches}</div>
                        <div>Products Limit: {p.maxProducts === 0 ? 'Unlimited' : p.maxProducts.toLocaleString()}</div>
                        <div>Trial / Grace: {p.trialDays}d trial · {p.gracePeriodDays}d grace</div>
                      </div>
                    </div>
                    {canManageBilling && (
                      <button
                        type="button"
                        onClick={() =>
                          setPlanModal({
                            id: p.id,
                            code: p.code,
                            name: p.name,
                            description: p.description,
                            priceMonthly: p.priceMonthly,
                            priceYearly: p.priceYearly,
                            trialDays: p.trialDays,
                            gracePeriodDays: p.gracePeriodDays,
                            maxUsers: p.maxUsers,
                            maxBranches: p.maxBranches,
                            maxProducts: p.maxProducts,
                            isActive: p.isActive,
                          })
                        }
                        className="w-full py-2 rounded-[10px] border border-[#E2E8F0] dark:border-[#1F3158] hover:border-[#087F8C] text-xs font-bold cursor-pointer"
                      >
                        Edit Plan Quotas &amp; Pricing
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: PAYMENTS */}
          {tab === 'payments' && (
            <div className="adp-card border border-[#E2E8F0] dark:border-[#1F3158] overflow-hidden">
              <div className="p-4 border-b border-[#E2E8F0] dark:border-[#1F3158] flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[#172033] dark:text-white">Payment &amp; Billing Verification Queue</h2>
                <div className="flex items-center gap-1.5">
                  {(['all', 'pending', 'verified', 'rejected'] as const).map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setPayFilter(f)}
                      className={`px-3 py-1 rounded-[8px] text-xs font-semibold capitalize border cursor-pointer ${
                        payFilter === f
                          ? 'bg-[#101B35] text-white border-[#D6AD60]/50'
                          : 'border-[#E2E8F0] dark:border-[#1F3158] text-slate-500'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-[#F8FAFC] dark:bg-[#0E182E] text-[#64748B] dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Invoice &amp; Date</th>
                      <th className="px-4 py-3 font-semibold">Business &amp; Plan</th>
                      <th className="px-4 py-3 font-semibold">Gateway / TrxID</th>
                      <th className="px-4 py-3 font-semibold">Amount</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Verify</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158]">
                    {filteredPayments.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-[#162344]/50">
                        <td className="px-4 py-3">
                          <div className="font-mono font-bold">{p.invoiceNumber}</div>
                          <div className="text-[11px] text-slate-400">{new Date(p.createdAt).toLocaleString()}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-[#172033] dark:text-white">{p.businessName}</div>
                          <div className="text-[11px] text-slate-400">
                            {p.planName || 'Plan'} ({p.billingCycle})
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="uppercase font-semibold">{p.gatewayProvider}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            Trx: {p.transactionId || '—'} {p.senderNumber ? `· ${p.senderNumber}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-num font-bold">৳{p.amount.toLocaleString()}</td>
                        <td className="px-4 py-3 font-bold uppercase">
                          <span
                            className={
                              p.status === 'verified'
                                ? 'text-emerald-600'
                                : p.status === 'pending'
                                ? 'text-amber-600'
                                : 'text-rose-600'
                            }
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                          {canManageBilling && p.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setPayVerifyModal({ payment: p, nextStatus: 'verified', adminNote: '' })}
                                className="px-2.5 py-1 rounded-[8px] bg-emerald-600 text-white text-[11px] font-bold cursor-pointer"
                              >
                                Approve &amp; Activate
                              </button>
                              <button
                                type="button"
                                onClick={() => setPayVerifyModal({ payment: p, nextStatus: 'rejected', adminNote: '' })}
                                className="px-2.5 py-1 rounded-[8px] bg-rose-600 text-white text-[11px] font-bold cursor-pointer"
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredPayments.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                          No payment records found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: SUPPORT TICKETS */}
          {tab === 'tickets' && (
            <div className="adp-card border border-[#E2E8F0] dark:border-[#1F3158] overflow-hidden">
              <div className="p-4 border-b border-[#E2E8F0] dark:border-[#1F3158] flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[#172033] dark:text-white">Tenant Support Inbox</h2>
                <div className="flex items-center gap-1.5">
                  {(['all', 'open', 'in_progress', 'resolved'] as const).map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setTicketFilter(f)}
                      className={`px-3 py-1 rounded-[8px] text-xs font-semibold capitalize border cursor-pointer ${
                        ticketFilter === f
                          ? 'bg-[#101B35] text-white border-[#D6AD60]/50'
                          : 'border-[#E2E8F0] dark:border-[#1F3158] text-slate-500'
                      }`}
                    >
                      {f.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158]">
                {filteredTickets.map(t => (
                  <div key={t.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-[#172033] dark:text-white">{t.subject}</span>
                        <span className="text-[10.5px] font-bold uppercase text-[#087F8C]">{t.status.replace('_', ' ')}</span>
                        <span className="text-[10.5px] text-slate-400">Priority: {t.priority}</span>
                      </div>
                      <p className="text-xs text-[#475569] dark:text-slate-300">{t.message}</p>
                      <div className="text-[11px] text-slate-400">
                        {t.businessName} · {t.createdByEmail || 'Owner'} · {new Date(t.createdAt).toLocaleString()}
                      </div>
                      {t.adminResponse && (
                        <div className="mt-1.5 p-2 rounded-[8px] bg-emerald-50/70 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-200">
                          <strong>Platform Reply:</strong> {t.adminResponse}
                        </div>
                      )}
                    </div>
                    {canManageSupport && (
                      <button
                        type="button"
                        onClick={() =>
                          setTicketModal({
                            ticket: t,
                            status: t.status,
                            priority: t.priority,
                            adminResponse: t.adminResponse || '',
                          })
                        }
                        className="px-3 py-1.5 rounded-[8px] bg-[#087F8C] text-white text-xs font-bold shrink-0 cursor-pointer"
                      >
                        Respond / Update
                      </button>
                    )}
                  </div>
                ))}
                {filteredTickets.length === 0 && (
                  <div className="p-8 text-center text-xs text-slate-400">No support tickets in this view.</div>
                )}
              </div>
            </div>
          )}

          {/* TAB 7: TEAM & SETTINGS */}
          {tab === 'team' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Platform Team */}
              <div className="adp-card p-5 border border-[#E2E8F0] dark:border-[#1F3158] space-y-4">
                <div>
                  <h2 className="text-sm font-bold text-[#172033] dark:text-white flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#D6AD60]" />
                    <span>Platform Admin Team (Strictly Separate from Shop Roles)</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Platform roles grant access to this control plane only. Only SUPER_ADMIN can assign or revoke team roles.
                  </p>
                </div>

                {isSuperAdmin && (
                  <form onSubmit={handleAddPlatformAdmin} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <input
                      type="email"
                      required
                      value={newAdminForm.email}
                      onChange={e => setNewAdminForm(p => ({ ...p, email: e.target.value }))}
                      placeholder="Registered user email"
                      className="sm:col-span-5 px-3 py-2 text-xs bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[8px]"
                    />
                    <select
                      value={newAdminForm.role}
                      onChange={e => setNewAdminForm(p => ({ ...p, role: e.target.value as PlatformRole }))}
                      className="sm:col-span-4 px-2 py-2 text-xs bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[8px]"
                    >
                      <option value="SUPPORT_ADMIN">SUPPORT_ADMIN</option>
                      <option value="BILLING_ADMIN">BILLING_ADMIN</option>
                      <option value="PLATFORM_VIEWER">PLATFORM_VIEWER</option>
                      <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                    </select>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="sm:col-span-3 px-3 py-2 rounded-[8px] bg-[#087F8C] text-white text-xs font-bold cursor-pointer"
                    >
                      Assign Role
                    </button>
                  </form>
                )}

                <div className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158]">
                  {admins.map(a => (
                    <div key={a.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                      <div>
                        <div className="font-semibold text-[#172033] dark:text-white">{a.email}</div>
                        <div className="text-[11px] text-slate-400">
                          {a.fullName || 'Admin'} · <strong>{a.role}</strong> · {a.isActive ? 'Active' : 'Disabled'}
                        </div>
                      </div>
                      {isSuperAdmin && a.email.toLowerCase() !== 'queennila72816@gmail.com' && (
                        <button
                          type="button"
                          onClick={() => handleToggleAdminActive(a)}
                          className="px-2.5 py-1 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] text-[11px] font-semibold cursor-pointer"
                        >
                          {a.isActive ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Platform General & Billing Settings */}
              <div className="space-y-5">
                <div className="adp-card p-5 border border-[#E2E8F0] dark:border-[#1F3158] space-y-3">
                  <h3 className="text-sm font-bold text-[#172033] dark:text-white">Billing Payment Instructions</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                    <div>
                      <label className="block font-semibold mb-1">bKash Merchant</label>
                      <input
                        type="text"
                        value={billingSettings.bkashNumber}
                        onChange={e => setBillingSettings(p => ({ ...p, bkashNumber: e.target.value }))}
                        className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Nagad Merchant</label>
                      <input
                        type="text"
                        value={billingSettings.nagadNumber}
                        onChange={e => setBillingSettings(p => ({ ...p, nagadNumber: e.target.value }))}
                        className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Rocket Account</label>
                      <input
                        type="text"
                        value={billingSettings.rocketNumber}
                        onChange={e => setBillingSettings(p => ({ ...p, rocketNumber: e.target.value }))}
                        className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                      />
                    </div>
                  </div>
                  <div className="text-xs">
                    <label className="block font-semibold mb-1">Bank Transfer Details</label>
                    <input
                      type="text"
                      value={billingSettings.bankDetails}
                      onChange={e => setBillingSettings(p => ({ ...p, bankDetails: e.target.value }))}
                      className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
                    />
                  </div>
                  <div className="text-xs">
                    <label className="block font-semibold mb-1">Payment Note for Owners</label>
                    <input
                      type="text"
                      value={billingSettings.note}
                      onChange={e => setBillingSettings(p => ({ ...p, note: e.target.value }))}
                      className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
                    />
                  </div>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleSaveSettings('billing_instructions', billingSettings)}
                      className="px-4 py-2 rounded-[8px] bg-[#087F8C] text-white text-xs font-bold cursor-pointer"
                    >
                      Save Billing Instructions
                    </button>
                  )}
                </div>

                <div className="adp-card p-5 border border-[#E2E8F0] dark:border-[#1F3158] space-y-3">
                  <h3 className="text-sm font-bold text-[#172033] dark:text-white">Platform General Governance</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    <div>
                      <label className="block font-semibold mb-1">Support Email</label>
                      <input
                        type="email"
                        value={generalSettings.supportEmail}
                        onChange={e => setGeneralSettings(p => ({ ...p, supportEmail: e.target.value }))}
                        className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Support Phone</label>
                      <input
                        type="text"
                        value={generalSettings.supportPhone}
                        onChange={e => setGeneralSettings(p => ({ ...p, supportPhone: e.target.value }))}
                        className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={generalSettings.requireMobileOtp}
                        onChange={e => setGeneralSettings(p => ({ ...p, requireMobileOtp: e.target.checked }))}
                      />
                      <span>Require Mobile OTP during Business Setup</span>
                    </label>
                  </div>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleSaveSettings('general', generalSettings)}
                      className="px-4 py-2 rounded-[8px] bg-[#101B35] text-white text-xs font-bold cursor-pointer"
                    >
                      Save General Settings
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: SECURITY & AUDIT */}
          {tab === 'security' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="adp-card p-5 border border-[#E2E8F0] dark:border-[#1F3158] space-y-3">
                <h2 className="text-sm font-bold text-[#172033] dark:text-white flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#F06464]" />
                  <span>Security Monitoring Across Tenants</span>
                </h2>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-3 rounded-[10px] bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158]">
                    <div className="text-lg font-bold font-mono-num">{securitySnap?.blockedLogins.length ?? 0}</div>
                    <div className="text-[11px] text-slate-400">Blocked Logins</div>
                  </div>
                  <div className="p-3 rounded-[10px] bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158]">
                    <div className="text-lg font-bold font-mono-num">{securitySnap?.unlinkedEmployees.length ?? 0}</div>
                    <div className="text-[11px] text-slate-400">Unlinked Staff</div>
                  </div>
                  <div className="p-3 rounded-[10px] bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158]">
                    <div className="text-lg font-bold font-mono-num">{securitySnap?.suspendedStaff.length ?? 0}</div>
                    <div className="text-[11px] text-slate-400">Suspended Staff</div>
                  </div>
                </div>
                <div className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158] max-h-72 overflow-y-auto text-xs">
                  {(securitySnap?.blockedLogins || []).map(ev => (
                    <div key={ev.id} className="py-2">
                      <div className="font-semibold text-rose-600">{ev.employee_name} ({ev.role_key})</div>
                      <div className="text-[11px] text-slate-400">{ev.details} · {new Date(ev.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                  {(securitySnap?.blockedLogins || []).length === 0 && (
                    <div className="py-6 text-center text-slate-400">No blocked login incidents logged.</div>
                  )}
                </div>
              </div>

              <div className="adp-card p-5 border border-[#E2E8F0] dark:border-[#1F3158] space-y-3">
                <h2 className="text-sm font-bold text-[#172033] dark:text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#10B981]" />
                  <span>Immutable Platform Audit Logs</span>
                </h2>
                <div className="divide-y divide-[#E2E8F0] dark:divide-[#1F3158] max-h-80 overflow-y-auto text-xs">
                  {auditLogs.map(log => (
                    <div key={log.id} className="py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-[#087F8C]">{log.action}</span>
                        <span className="text-[10.5px] text-slate-400 font-mono-num">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-[#172033] dark:text-slate-200 mt-0.5">{log.details}</div>
                      <div className="text-[11px] text-slate-400">
                        Actor: {log.actorEmail || 'system'} ({log.actorRole || 'SUPER_ADMIN'})
                      </div>
                    </div>
                  ))}
                  {auditLogs.length === 0 && (
                    <div className="py-6 text-center text-slate-400">No platform governance logs recorded yet.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL: Suspend / Activate Business */}
      {statusModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleToggleBusinessStatus}
            className="w-full max-w-md bg-white dark:bg-[#101B35] rounded-[14px] border border-[#E2E8F0] dark:border-[#1F3158] p-5 space-y-4 shadow-2xl"
          >
            <h3 className="text-base font-bold text-[#172033] dark:text-white">
              {statusModal.nextStatus === 'suspended' ? 'Suspend Business Workspace' : 'Activate Business Workspace'}
            </h3>
            <p className="text-xs text-[#64748B] dark:text-slate-300">
              {statusModal.nextStatus === 'suspended'
                ? `Suspending "${statusModal.biz.name}" pauses new sales/writes while preserving 100% of business data safely.`
                : `Re-activating "${statusModal.biz.name}" restores full POS, Inventory, and Staff access immediately.`}
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Audit Reason</label>
              <input
                type="text"
                required={statusModal.nextStatus === 'suspended'}
                value={statusReason}
                onChange={e => setStatusReason(e.target.value)}
                placeholder="e.g. Overdue subscription invoice or owner request"
                className="w-full p-2.5 text-xs rounded-[10px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStatusModal(null)}
                className="px-4 py-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={`px-4 py-2 rounded-[8px] text-white text-xs font-bold cursor-pointer ${
                  statusModal.nextStatus === 'suspended' ? 'bg-rose-600' : 'bg-emerald-600'
                }`}
              >
                {submitting ? 'Updating...' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Assign Subscription */}
      {assignSubModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAssignSubscription}
            className="w-full max-w-md bg-white dark:bg-[#101B35] rounded-[14px] border border-[#E2E8F0] dark:border-[#1F3158] p-5 space-y-4 shadow-2xl"
          >
            <h3 className="text-base font-bold text-[#172033] dark:text-white">
              Assign Plan: {assignSubModal.businessName}
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Plan</label>
                <select
                  value={assignSubModal.planCode}
                  onChange={e => setAssignSubModal(p => (p ? { ...p, planCode: e.target.value } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
                >
                  {plans.map(pl => (
                    <option key={pl.id} value={pl.code}>
                      {pl.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Billing Cycle</label>
                <select
                  value={assignSubModal.billingCycle}
                  onChange={e => setAssignSubModal(p => (p ? { ...p, billingCycle: e.target.value as any } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
                >
                  <option value="trial">Trial</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="lifetime">Lifetime</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Status</label>
                <select
                  value={assignSubModal.status}
                  onChange={e => setAssignSubModal(p => (p ? { ...p, status: e.target.value as any } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
                >
                  <option value="active">active</option>
                  <option value="trialing">trialing</option>
                  <option value="grace_period">grace_period</option>
                  <option value="expired">expired</option>
                  <option value="suspended">suspended</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Custom Days (opt)</label>
                <input
                  type="number"
                  min={1}
                  value={assignSubModal.durationDays}
                  onChange={e => setAssignSubModal(p => (p ? { ...p, durationDays: e.target.value } : p))}
                  placeholder="Default"
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
                />
              </div>
            </div>
            <div className="text-xs">
              <label className="block font-semibold mb-1">Notes</label>
              <input
                type="text"
                value={assignSubModal.notes}
                onChange={e => setAssignSubModal(p => (p ? { ...p, notes: e.target.value } : p))}
                className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAssignSubModal(null)} className="px-4 py-2 rounded-[8px] border text-xs cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="px-4 py-2 rounded-[8px] bg-[#087F8C] text-white text-xs font-bold cursor-pointer">
                {submitting ? 'Saving...' : 'Save Subscription'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Create / Edit Plan */}
      {planModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSavePlan}
            className="w-full max-w-lg bg-white dark:bg-[#101B35] rounded-[14px] border border-[#E2E8F0] dark:border-[#1F3158] p-5 space-y-4 shadow-2xl"
          >
            <h3 className="text-base font-bold text-[#172033] dark:text-white">
              {planModal.id ? `Edit Plan: ${planModal.name}` : 'Create Subscription Plan'}
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Code *</label>
                <input
                  type="text"
                  required
                  disabled={Boolean(planModal.id)}
                  value={planModal.code}
                  onChange={e => setPlanModal(p => (p ? { ...p, code: e.target.value } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Name *</label>
                <input
                  type="text"
                  required
                  value={planModal.name}
                  onChange={e => setPlanModal(p => (p ? { ...p, name: e.target.value } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-semibold mb-1">Description</label>
                <input
                  type="text"
                  value={planModal.description}
                  onChange={e => setPlanModal(p => (p ? { ...p, description: e.target.value } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Monthly Price (৳)</label>
                <input
                  type="number"
                  min={0}
                  value={planModal.priceMonthly}
                  onChange={e => setPlanModal(p => (p ? { ...p, priceMonthly: Number(e.target.value) } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Yearly Price (৳)</label>
                <input
                  type="number"
                  min={0}
                  value={planModal.priceYearly}
                  onChange={e => setPlanModal(p => (p ? { ...p, priceYearly: Number(e.target.value) } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Max Users (0=∞)</label>
                <input
                  type="number"
                  min={0}
                  value={planModal.maxUsers}
                  onChange={e => setPlanModal(p => (p ? { ...p, maxUsers: Number(e.target.value) } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Max Branches (0=∞)</label>
                <input
                  type="number"
                  min={0}
                  value={planModal.maxBranches}
                  onChange={e => setPlanModal(p => (p ? { ...p, maxBranches: Number(e.target.value) } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Max Products (0=∞)</label>
                <input
                  type="number"
                  min={0}
                  value={planModal.maxProducts}
                  onChange={e => setPlanModal(p => (p ? { ...p, maxProducts: Number(e.target.value) } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Trial Days / Grace Days</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={0}
                    value={planModal.trialDays}
                    onChange={e => setPlanModal(p => (p ? { ...p, trialDays: Number(e.target.value) } : p))}
                    className="w-1/2 p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                  />
                  <input
                    type="number"
                    min={0}
                    value={planModal.gracePeriodDays}
                    onChange={e => setPlanModal(p => (p ? { ...p, gracePeriodDays: Number(e.target.value) } : p))}
                    className="w-1/2 p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] font-mono"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPlanModal(null)} className="px-4 py-2 rounded-[8px] border text-xs cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="px-4 py-2 rounded-[8px] bg-[#087F8C] text-white text-xs font-bold cursor-pointer">
                {submitting ? 'Saving...' : 'Save Plan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Verify Payment */}
      {payVerifyModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleVerifyPayment}
            className="w-full max-w-md bg-white dark:bg-[#101B35] rounded-[14px] border border-[#E2E8F0] dark:border-[#1F3158] p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center gap-2">
              {payVerifyModal.nextStatus === 'verified' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              ) : (
                <XCircle className="w-5 h-5 text-rose-500" />
              )}
              <h3 className="text-base font-bold text-[#172033] dark:text-white">
                {payVerifyModal.nextStatus === 'verified' ? 'Approve Payment & Activate Plan' : 'Reject Payment'}
              </h3>
            </div>
            <p className="text-xs text-[#475569] dark:text-slate-300">
              Invoice <strong>{payVerifyModal.payment.invoiceNumber}</strong> ·{' '}
              <strong>৳{payVerifyModal.payment.amount.toLocaleString()}</strong> via{' '}
              {payVerifyModal.payment.gatewayProvider} (TrxID: {payVerifyModal.payment.transactionId || '—'}).
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Admin Verification Note</label>
              <input
                type="text"
                value={payVerifyModal.adminNote}
                onChange={e => setPayVerifyModal(p => (p ? { ...p, adminNote: e.target.value } : p))}
                placeholder={payVerifyModal.nextStatus === 'verified' ? 'Verified in merchant portal' : 'Reason for rejection'}
                className="w-full p-2.5 text-xs rounded-[10px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPayVerifyModal(null)} className="px-4 py-2 rounded-[8px] border text-xs cursor-pointer">
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={`px-4 py-2 rounded-[8px] text-white text-xs font-bold cursor-pointer ${
                  payVerifyModal.nextStatus === 'verified' ? 'bg-emerald-600' : 'bg-rose-600'
                }`}
              >
                {submitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Update Support Ticket */}
      {ticketModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleUpdateTicket}
            className="w-full max-w-md bg-white dark:bg-[#101B35] rounded-[14px] border border-[#E2E8F0] dark:border-[#1F3158] p-5 space-y-4 shadow-2xl"
          >
            <h3 className="text-base font-bold text-[#172033] dark:text-white">Update Support Ticket</h3>
            <div className="p-3 rounded-[10px] bg-[#F8FAFC] dark:bg-[#0E182E] text-xs">
              <div className="font-bold">{ticketModal.ticket.subject}</div>
              <p className="text-slate-500 mt-1">{ticketModal.ticket.message}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Status</label>
                <select
                  value={ticketModal.status}
                  onChange={e => setTicketModal(p => (p ? { ...p, status: e.target.value as any } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
                >
                  <option value="open">open</option>
                  <option value="in_progress">in_progress</option>
                  <option value="resolved">resolved</option>
                  <option value="closed">closed</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Priority</label>
                <select
                  value={ticketModal.priority}
                  onChange={e => setTicketModal(p => (p ? { ...p, priority: e.target.value as any } : p))}
                  className="w-full p-2 rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="urgent">urgent</option>
                </select>
              </div>
            </div>
            <div className="text-xs">
              <label className="block font-semibold mb-1">Admin Response</label>
              <textarea
                rows={3}
                value={ticketModal.adminResponse}
                onChange={e => setTicketModal(p => (p ? { ...p, adminResponse: e.target.value } : p))}
                placeholder="Write a helpful response visible to the business owner..."
                className="w-full p-2.5 rounded-[10px] border border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setTicketModal(null)} className="px-4 py-2 rounded-[8px] border text-xs cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="px-4 py-2 rounded-[8px] bg-[#087F8C] text-white text-xs font-bold cursor-pointer">
                {submitting ? 'Saving...' : 'Update Ticket'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
