import {
  BusinessMembershipSummary,
  BusinessRoleLevel,
  BusinessSubscription,
  BusinessType,
  PlatformBillingSettings,
  PlatformPayment,
  SubscriptionPlan,
  SubscriptionStatus,
  SupportTicket,
} from '../types';
import { getFreshAccessToken, isSupabaseConfigured, isValidUuid, supabase } from '../lib/supabase';
import { mapPaymentRow, mapPlanRow, mapSubscriptionRow, mapTicketRow } from './platformAdminService';
import { normalizeRoleKey } from '../utils/rbacDefaults';

function roleToBusinessLevel(rawRole: string): BusinessRoleLevel {
  const norm = normalizeRoleKey(rawRole);
  if (rawRole.toLowerCase() === 'owner' || norm === 'super_admin') return 'OWNER';
  if (rawRole.toLowerCase() === 'admin') return 'ADMIN';
  if (norm === 'store_manager') return 'MANAGER';
  if (norm === 'accountant') return 'ACCOUNTANT';
  if (norm === 'salesman' || norm === 'cashier') return 'SALESMAN';
  return 'CUSTOM_ROLE';
}

export interface BusinessBillingSnapshot {
  subscription: BusinessSubscription | null;
  plans: SubscriptionPlan[];
  payments: PlatformPayment[];
  billingInstructions: PlatformBillingSettings | null;
  usage: {
    users: number;
    branches: number;
    products: number;
  };
}

const DEFAULT_FALLBACK_PLANS: SubscriptionPlan[] = [
  {
    id: 'local-trial',
    code: 'free_trial',
    name: 'Free Trial',
    description: '14-day full-featured evaluation for new shops.',
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'BDT',
    trialDays: 14,
    gracePeriodDays: 3,
    maxUsers: 3,
    maxBranches: 1,
    maxProducts: 250,
    features: { pos: true, inventory: true, reports: true, apparelCatalog: true, barcodePrinting: true },
    isActive: true,
    sortOrder: 1,
  },
  {
    id: 'local-basic',
    code: 'basic',
    name: 'Basic',
    description: 'Single-outlet retail & apparel shops.',
    priceMonthly: 799,
    priceYearly: 7990,
    currency: 'BDT',
    trialDays: 14,
    gracePeriodDays: 7,
    maxUsers: 5,
    maxBranches: 1,
    maxProducts: 1000,
    features: { pos: true, inventory: true, reports: true, apparelCatalog: true, barcodePrinting: true },
    isActive: true,
    sortOrder: 2,
  },
  {
    id: 'local-standard',
    code: 'standard',
    name: 'Standard',
    description: 'Growing multi-branch retail & wholesale stores.',
    priceMonthly: 1499,
    priceYearly: 14990,
    currency: 'BDT',
    trialDays: 14,
    gracePeriodDays: 7,
    maxUsers: 15,
    maxBranches: 3,
    maxProducts: 5000,
    features: {
      pos: true,
      inventory: true,
      multiBranch: true,
      reports: true,
      apparelCatalog: true,
      barcodePrinting: true,
      comboOffers: true,
    },
    isActive: true,
    sortOrder: 3,
  },
  {
    id: 'local-premium',
    code: 'premium',
    name: 'Premium',
    description: 'High-volume multi-outlet chains with custom roles & advanced analytics.',
    priceMonthly: 2999,
    priceYearly: 29990,
    currency: 'BDT',
    trialDays: 14,
    gracePeriodDays: 10,
    maxUsers: 50,
    maxBranches: 10,
    maxProducts: 25000,
    features: {
      pos: true,
      inventory: true,
      multiBranch: true,
      reports: true,
      apparelCatalog: true,
      barcodePrinting: true,
      comboOffers: true,
      prioritySupport: true,
    },
    isActive: true,
    sortOrder: 4,
  },
  {
    id: 'local-enterprise',
    code: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited branches, staff, products & priority SLA support.',
    priceMonthly: 5999,
    priceYearly: 59990,
    currency: 'BDT',
    trialDays: 30,
    gracePeriodDays: 14,
    maxUsers: 0,
    maxBranches: 0,
    maxProducts: 0,
    features: {
      pos: true,
      inventory: true,
      multiBranch: true,
      reports: true,
      apparelCatalog: true,
      barcodePrinting: true,
      comboOffers: true,
      apiAccess: true,
      prioritySupport: true,
    },
    isActive: true,
    sortOrder: 5,
  },
];

export const subscriptionService = {
  async fetchMyBusinessMemberships(userId: string): Promise<BusinessMembershipSummary[]> {
    if (!isSupabaseConfigured || !userId) return [];

    // 1. Prefer SECURITY DEFINER RPC (returns enriched memberships with subscription status)
    try {
      const { data: rpcRows, error: rpcErr } = await supabase.rpc('get_my_business_memberships');
      if (!rpcErr && Array.isArray(rpcRows)) {
        return rpcRows.map((r: any) => ({
          businessId: r.business_id,
          businessName: r.business_name || 'My Shop',
          businessType: (r.business_type || 'general') as BusinessType,
          businessStatus: r.business_status || (r.is_active === false ? 'suspended' : 'active'),
          isActive: r.is_active !== false,
          branchId: r.branch_id || undefined,
          role: r.role || 'owner',
          roleLevel: roleToBusinessLevel(r.role || 'owner'),
          membershipStatus: r.membership_status || 'active',
          planCode: r.plan_code || undefined,
          planName: r.plan_name || undefined,
          subscriptionStatus: (r.subscription_status || undefined) as SubscriptionStatus | undefined,
          currentPeriodEnd: r.current_period_end || undefined,
        }));
      }
    } catch {
      // Fallback below
    }

    // 2. Direct RLS fallback
    const { data: memRows, error } = await supabase
      .from('business_users')
      .select('business_id, branch_id, role, status')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !memRows || memRows.length === 0) return [];

    const bizIds = Array.from(new Set(memRows.map((m: any) => m.business_id).filter(Boolean)));
    const [{ data: businesses }, { data: subs }] = await Promise.all([
      supabase.from('businesses').select('id, name, business_type, is_active, status').in('id', bizIds),
      supabase
        .from('business_subscriptions')
        .select('business_id, plan_code, status, current_period_end')
        .in('business_id', bizIds),
    ]);

    const bizMap = new Map((businesses || []).map((b: any) => [b.id, b]));
    const subMap = new Map((subs || []).map((s: any) => [s.business_id, s]));

    return memRows.map((m: any) => {
      const b = bizMap.get(m.business_id);
      const s = subMap.get(m.business_id);
      return {
        businessId: m.business_id,
        businessName: b?.name || 'My Shop',
        businessType: (b?.business_type || 'general') as BusinessType,
        businessStatus: b?.status || (b?.is_active === false ? 'suspended' : 'active'),
        isActive: b?.is_active !== false,
        branchId: m.branch_id || undefined,
        role: m.role || 'owner',
        roleLevel: roleToBusinessLevel(m.role || 'owner'),
        membershipStatus: m.status || 'active',
        planCode: s?.plan_code || undefined,
        subscriptionStatus: (s?.status || undefined) as SubscriptionStatus | undefined,
        currentPeriodEnd: s?.current_period_end || undefined,
      };
    });
  },

  async fetchPlans(): Promise<{ plans: SubscriptionPlan[]; billingInstructions: PlatformBillingSettings | null }> {
    if (!isSupabaseConfigured) {
      return { plans: DEFAULT_FALLBACK_PLANS, billingInstructions: null };
    }

    try {
      const res = await fetch('/api/saas/plans');
      if (res.ok) {
        const json = await res.json();
        return {
          plans: (json.plans || []).length > 0 ? (json.plans || []).map(mapPlanRow) : DEFAULT_FALLBACK_PLANS,
          billingInstructions: json.billingInstructions || null,
        };
      }
    } catch {
      // Fallback to direct Supabase query
    }

    try {
      const [{ data: plans }, { data: settingRow }] = await Promise.all([
        supabase.from('subscription_plans').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
        supabase.from('platform_settings').select('value').eq('key', 'billing_instructions').maybeSingle(),
      ]);

      return {
        plans: plans && plans.length > 0 ? plans.map(mapPlanRow) : DEFAULT_FALLBACK_PLANS,
        billingInstructions: (settingRow?.value as PlatformBillingSettings) || null,
      };
    } catch {
      return { plans: DEFAULT_FALLBACK_PLANS, billingInstructions: null };
    }
  },

  async sendMobileOtp(phone: string): Promise<{
    success: boolean;
    deliveryMode: 'sms' | 'verification_preview' | 'local_fallback';
    previewCode?: string;
    message: string;
  }> {
    if (!isSupabaseConfigured) {
      const code = String(Math.floor(100000 + Math.random() * 899999));
      return {
        success: true,
        deliveryMode: 'local_fallback',
        previewCode: code,
        message: `Verification code ${code} generated.`,
      };
    }

    let token = await getFreshAccessToken();
    const callSend = (bearer: string) =>
      fetch('/api/saas/send-mobile-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ phone }),
      });

    let res = await callSend(token);
    if (res.status === 401) {
      token = await getFreshAccessToken({ forceRefresh: true });
      res = await callSend(token);
    }

    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.success) {
      return json;
    }
    throw new Error(json?.error || 'Failed to send mobile verification code.');
  },

  async verifyMobileOtp(phone: string, code: string): Promise<{ verified: boolean }> {
    if (!isSupabaseConfigured) {
      return { verified: true };
    }

    let token = await getFreshAccessToken();
    const callVerify = (bearer: string) =>
      fetch('/api/saas/verify-mobile-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ phone, code }),
      });

    let res = await callVerify(token);
    if (res.status === 401) {
      token = await getFreshAccessToken({ forceRefresh: true });
      res = await callVerify(token);
    }

    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.verified) {
      return { verified: true };
    }
    throw new Error(json?.error || 'Invalid or expired OTP code.');
  },

  async fetchBusinessBilling(businessId: string): Promise<BusinessBillingSnapshot> {
    if (!isSupabaseConfigured || !isValidUuid(businessId)) {
      return {
        subscription: null,
        plans: DEFAULT_FALLBACK_PLANS,
        payments: [],
        billingInstructions: null,
        usage: { users: 1, branches: 1, products: 0 },
      };
    }

    try {
      let token = await getFreshAccessToken();
      const exec = (bearer: string) =>
        fetch(`/api/saas/subscription/${businessId}`, {
          headers: { Authorization: `Bearer ${bearer}` },
        });
      let res = await exec(token);
      if (res.status === 401) {
        token = await getFreshAccessToken({ forceRefresh: true });
        res = await exec(token);
      }
      if (res.ok) {
        const json = await res.json();
        return {
          subscription: json.subscription ? mapSubscriptionRow(json.subscription) : null,
          plans: (json.plans || []).length > 0 ? (json.plans || []).map(mapPlanRow) : DEFAULT_FALLBACK_PLANS,
          payments: (json.payments || []).map(mapPaymentRow),
          billingInstructions: json.billingInstructions || null,
          usage: json.usage || { users: 1, branches: 1, products: 0 },
        };
      }
    } catch {
      // Fallback below
    }

    // RLS fallback
    const [
      { data: sub },
      { data: plans },
      { data: payments },
      { count: userCount },
      { count: branchCount },
      { count: productCount },
      { data: billingSetting },
    ] = await Promise.all([
      supabase.from('business_subscriptions').select('*').eq('business_id', businessId).maybeSingle(),
      supabase.from('subscription_plans').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      supabase
        .from('payments')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('business_users')
        .select('user_id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('status', 'active'),
      supabase.from('branches').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
      supabase.from('platform_settings').select('value').eq('key', 'billing_instructions').maybeSingle(),
    ]);

    const mappedPlans = plans && plans.length > 0 ? plans.map(mapPlanRow) : DEFAULT_FALLBACK_PLANS;
    const matchedPlan = sub?.plan_id ? mappedPlans.find(p => p.id === sub.plan_id) || null : null;

    return {
      subscription: sub
        ? {
            ...mapSubscriptionRow(sub),
            plan: matchedPlan,
          }
        : null,
      plans: mappedPlans,
      payments: (payments || []).map(mapPaymentRow),
      billingInstructions: (billingSetting?.value as PlatformBillingSettings) || null,
      usage: {
        users: Number(userCount || 1),
        branches: Number(branchCount || 1),
        products: Number(productCount || 0),
      },
    };
  },

  async submitPayment(payload: {
    businessId: string;
    planCode: string;
    billingCycle: 'monthly' | 'yearly';
    paymentMethod: string;
    transactionId: string;
    senderNumber?: string;
  }): Promise<{ payment: PlatformPayment; message: string }> {
    let token = await getFreshAccessToken();
    const callSubmit = (bearer: string) =>
      fetch('/api/saas/submit-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(payload),
      });

    let res = await callSubmit(token);
    if (res.status === 401) {
      token = await getFreshAccessToken({ forceRefresh: true });
      res = await callSubmit(token);
    }

    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.payment) {
      return {
        payment: mapPaymentRow(json.payment),
        message: json.message || 'Payment submitted for verification.',
      };
    }

    if (res.status !== 404 && res.status !== 501 && json?.code !== 'SERVICE_ROLE_NOT_CONFIGURED') {
      throw new Error(json?.error || 'Failed to submit payment.');
    }

    // RLS fallback if server key is absent
    const { data: planRow } = await supabase
      .from('subscription_plans')
      .select('id, price_monthly, price_yearly, currency')
      .eq('code', payload.planCode)
      .maybeSingle();

    const amount = payload.billingCycle === 'yearly' ? Number(planRow?.price_yearly || 0) : Number(planRow?.price_monthly || 0);
    const invoiceNumber = `SUB-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 8999)}`;

    const { data: userRes } = await supabase.auth.getUser();
    const { data: inserted, error: insErr } = await supabase
      .from('payments')
      .insert({
        business_id: payload.businessId,
        plan_id: planRow?.id || null,
        invoice_number: invoiceNumber,
        amount,
        currency: planRow?.currency || 'BDT',
        billing_cycle: payload.billingCycle,
        payment_method: payload.paymentMethod,
        gateway_provider: payload.paymentMethod,
        transaction_id: payload.transactionId,
        sender_number: payload.senderNumber || null,
        status: 'pending',
        submitted_by: userRes?.user?.id || null,
      })
      .select()
      .single();

    if (insErr || !inserted) {
      throw new Error(insErr?.message || 'Failed to record payment submission.');
    }

    return {
      payment: mapPaymentRow(inserted),
      message: `Payment ${invoiceNumber} submitted for verification.`,
    };
  },

  async fetchTickets(businessId: string): Promise<SupportTicket[]> {
    if (!isSupabaseConfigured || !isValidUuid(businessId)) return [];

    try {
      let token = await getFreshAccessToken();
      const exec = (bearer: string) =>
        fetch(`/api/saas/tickets?businessId=${encodeURIComponent(businessId)}`, {
          headers: { Authorization: `Bearer ${bearer}` },
        });
      let res = await exec(token);
      if (res.status === 401) {
        token = await getFreshAccessToken({ forceRefresh: true });
        res = await exec(token);
      }
      if (res.ok) {
        const json = await res.json();
        return (json.tickets || []).map(mapTicketRow);
      }
    } catch {
      // Fallback below
    }

    const { data } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    return (data || []).map(mapTicketRow);
  },

  async createTicket(payload: {
    businessId: string;
    subject: string;
    message: string;
    category: SupportTicket['category'];
    priority: SupportTicket['priority'];
  }): Promise<SupportTicket> {
    let token = await getFreshAccessToken();
    const exec = (bearer: string) =>
      fetch('/api/saas/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(payload),
      });

    let res = await exec(token);
    if (res.status === 401) {
      token = await getFreshAccessToken({ forceRefresh: true });
      res = await exec(token);
    }

    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.ticket) {
      return mapTicketRow(json.ticket);
    }

    if (res.status !== 404 && res.status !== 501 && json?.code !== 'SERVICE_ROLE_NOT_CONFIGURED') {
      throw new Error(json?.error || 'Failed to submit support ticket.');
    }

    const { data: userRes } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        business_id: payload.businessId,
        created_by: userRes?.user?.id || null,
        created_by_email: userRes?.user?.email || null,
        subject: payload.subject,
        message: payload.message,
        category: payload.category,
        priority: payload.priority,
        status: 'open',
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to create support ticket.');
    }
    return mapTicketRow(data);
  },
};
