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
} from '../types';
import { getFreshAccessToken, isSupabaseConfigured, supabase } from '../lib/supabase';

export interface PlatformOverviewMetrics {
  totalBusinesses: number;
  activeBusinesses: number;
  suspendedBusinesses: number;
  trialBusinesses: number;
  totalUsers: number;
  activeSubscriptions: number;
  expiredSubscriptions: number;
  monthlyRecurringRevenue: number;
  annualRecurringRevenue: number;
  verifiedRevenueTotal: number;
  pendingPaymentsCount: number;
  pendingPaymentsAmount: number;
  openTicketsCount: number;
}

export interface PlatformSystemHealth {
  database: 'healthy' | 'degraded';
  dbLatencyMs: number;
  storage: 'healthy' | 'degraded';
  bucketCount: number;
  authService: 'healthy' | 'degraded';
  checkedAt: string;
}

export interface PlatformBusinessItem {
  id: string;
  name: string;
  ownerName?: string;
  ownerEmail?: string | null;
  ownerMobileVerified?: boolean;
  businessType: string;
  phone?: string;
  email?: string;
  address?: string;
  isActive: boolean;
  status: string;
  suspendedReason?: string | null;
  branchCount: number;
  userCount: number;
  productCount: number;
  createdAt: string;
  subscription?: BusinessSubscription | null;
}

export interface PlatformSecuritySnapshot {
  blockedLogins: Array<{
    id: string;
    business_id: string;
    employee_name: string;
    employee_code?: string;
    role_key: string;
    details: string;
    created_at: string;
  }>;
  unlinkedEmployees: Array<{
    id: string;
    business_id: string;
    name: string;
    employee_code?: string;
    role_key?: string;
    account_status?: string;
  }>;
  suspendedStaff: Array<{
    id: string;
    business_id: string;
    name: string;
    employee_code?: string;
    role_key?: string;
    account_status?: string;
    updated_at?: string;
  }>;
}

export function mapPlanRow(row: any): SubscriptionPlan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description || '',
    priceMonthly: Number(row.price_monthly || 0),
    priceYearly: Number(row.price_yearly || 0),
    currency: row.currency || 'BDT',
    trialDays: Number(row.trial_days ?? 14),
    gracePeriodDays: Number(row.grace_period_days ?? 7),
    maxUsers: Number(row.max_users ?? 0),
    maxBranches: Number(row.max_branches ?? 0),
    maxProducts: Number(row.max_products ?? 0),
    features: row.features && typeof row.features === 'object' ? row.features : {},
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order ?? 10),
  };
}

export function mapSubscriptionRow(row: any): BusinessSubscription {
  return {
    id: row.id,
    businessId: row.business_id,
    planId: row.plan_id || undefined,
    planCode: row.plan_code || row.plan?.code || 'free_trial',
    billingCycle: (row.billing_cycle || 'trial') as BusinessSubscription['billingCycle'],
    status: (row.status || 'trialing') as BusinessSubscription['status'],
    trialEndsAt: row.trial_ends_at || undefined,
    currentPeriodStart: row.current_period_start || undefined,
    currentPeriodEnd: row.current_period_end || undefined,
    gracePeriodEndsAt: row.grace_period_ends_at || undefined,
    maxUsers: Number(row.max_users ?? 0),
    maxBranches: Number(row.max_branches ?? 0),
    maxProducts: Number(row.max_products ?? 0),
    notes: row.notes || undefined,
    plan: row.plan ? mapPlanRow(row.plan) : null,
    business: row.business
      ? {
          id: row.business.id,
          name: row.business.name,
          phone: row.business.phone || undefined,
          email: row.business.email || undefined,
          status: row.business.status || 'active',
          isActive: row.business.is_active !== false,
        }
      : null,
  };
}

export function mapPaymentRow(row: any): PlatformPayment {
  return {
    id: row.id,
    businessId: row.business_id,
    businessName: row.businessName || undefined,
    subscriptionId: row.subscription_id || undefined,
    planId: row.plan_id || undefined,
    planName: row.planName || undefined,
    invoiceNumber: row.invoice_number,
    amount: Number(row.amount || 0),
    currency: row.currency || 'BDT',
    billingCycle: (row.billing_cycle || 'monthly') as PlatformPayment['billingCycle'],
    paymentMethod: row.payment_method || 'bkash',
    gatewayProvider: row.gateway_provider || row.payment_method || 'bkash',
    transactionId: row.transaction_id || undefined,
    senderNumber: row.sender_number || undefined,
    status: (row.status || 'pending') as PlatformPayment['status'],
    adminNote: row.admin_note || undefined,
    submittedBy: row.submitted_by || undefined,
    verifiedBy: row.verified_by || undefined,
    verifiedAt: row.verified_at || undefined,
    createdAt: row.created_at,
  };
}

export function mapTicketRow(row: any): SupportTicket {
  return {
    id: row.id,
    businessId: row.business_id,
    businessName: row.businessName || undefined,
    createdBy: row.created_by || undefined,
    createdByEmail: row.created_by_email || undefined,
    subject: row.subject,
    message: row.message,
    category: (row.category || 'general') as SupportTicket['category'],
    priority: (row.priority || 'medium') as SupportTicket['priority'],
    status: (row.status || 'open') as SupportTicket['status'],
    adminResponse: row.admin_response || undefined,
    resolvedBy: row.resolved_by || undefined,
    resolvedAt: row.resolved_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
  };
}

function mapAdminRow(row: any): PlatformAdmin {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name || undefined,
    role: row.role as PlatformRole,
    isActive: row.is_active !== false,
    assignedBy: row.assigned_by || undefined,
    createdAt: row.created_at || undefined,
    updatedAt: row.updated_at || undefined,
  };
}

function mapAuditRow(row: any): PlatformAuditLog {
  return {
    id: row.id,
    actorUserId: row.actor_user_id || undefined,
    actorEmail: row.actor_email || undefined,
    actorRole: row.actor_role || undefined,
    action: row.action,
    targetType: row.target_type || undefined,
    targetId: row.target_id || undefined,
    targetBusinessId: row.target_business_id || undefined,
    details: row.details || '',
    metadata: row.metadata || undefined,
    createdAt: row.created_at,
  };
}

async function fetchPlatformApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = await getFreshAccessToken();
  const exec = (bearer: string) =>
    fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
        Authorization: `Bearer ${bearer}`,
      },
    });

  let res = await exec(token);
  if (res.status === 401) {
    token = await getFreshAccessToken({ forceRefresh: true });
    res = await exec(token);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `Platform API request failed (${res.status})`);
  }
  return json as T;
}

export const platformAdminService = {
  async fetchMe(): Promise<{ isPlatformAdmin: boolean; admin: PlatformAdmin | null; serviceConfigured: boolean }> {
    if (!isSupabaseConfigured) {
      return { isPlatformAdmin: false, admin: null, serviceConfigured: false };
    }

    try {
      const token = await getFreshAccessToken().catch(() => '');
      if (!token) {
        return { isPlatformAdmin: false, admin: null, serviceConfigured: false };
      }

      const res = await fetch('/api/platform/me', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.serviceConfigured && json?.admin) {
          return {
            isPlatformAdmin: Boolean(json.isPlatformAdmin),
            admin: mapAdminRow(json.admin),
            serviceConfigured: true,
          };
        }
        if (json?.serviceConfigured) {
          return { isPlatformAdmin: false, admin: null, serviceConfigured: true };
        }
      }
    } catch {
      // Fall through to Supabase RLS / bootstrap RPC check
    }

    // Fallback: call controlled bootstrap RPC + read own platform_admins row (RLS allows user_id = auth.uid())
    try {
      try {
        await supabase.rpc('bootstrap_platform_super_admin_for_caller');
      } catch {
        // Ignore if RPC does not exist yet
      }
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) return { isPlatformAdmin: false, admin: null, serviceConfigured: false };

      const { data: row } = await supabase
        .from('platform_admins')
        .select('*')
        .eq('user_id', uid)
        .eq('is_active', true)
        .maybeSingle();

      if (row) {
        return {
          isPlatformAdmin: true,
          admin: mapAdminRow(row),
          serviceConfigured: false,
        };
      }
    } catch {
      // Ignore if migration hasn't run yet
    }

    return { isPlatformAdmin: false, admin: null, serviceConfigured: false };
  },

  async fetchOverview(): Promise<{
    metrics: PlatformOverviewMetrics;
    recentBusinesses: Array<{ id: string; name: string; status?: string; created_at: string; business_type?: string }>;
    systemHealth: PlatformSystemHealth;
  }> {
    return fetchPlatformApi('/api/platform/overview');
  },

  async fetchBusinesses(): Promise<PlatformBusinessItem[]> {
    const data = await fetchPlatformApi<{ businesses: any[] }>('/api/platform/businesses');
    return (data.businesses || []).map(b => ({
      id: b.id,
      name: b.name,
      ownerName: b.owner_name || undefined,
      ownerEmail: b.ownerEmail || b.email || null,
      ownerMobileVerified: Boolean(b.ownerMobileVerified),
      businessType: b.business_type || 'general',
      phone: b.phone || undefined,
      email: b.email || undefined,
      address: b.address || undefined,
      isActive: b.is_active !== false,
      status: b.status || (b.is_active === false ? 'suspended' : 'active'),
      suspendedReason: b.suspended_reason || null,
      branchCount: Number(b.branchCount || 0),
      userCount: Number(b.userCount || 0),
      productCount: Number(b.productCount || 0),
      createdAt: b.created_at,
      subscription: b.subscription ? mapSubscriptionRow(b.subscription) : null,
    }));
  },

  async updateBusinessStatus(businessId: string, status: 'active' | 'suspended', reason?: string): Promise<void> {
    await fetchPlatformApi(`/api/platform/businesses/${businessId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
  },

  async fetchPlans(): Promise<SubscriptionPlan[]> {
    const data = await fetchPlatformApi<{ plans: any[] }>('/api/platform/plans');
    return (data.plans || []).map(mapPlanRow);
  },

  async createPlan(payload: Partial<SubscriptionPlan> & { code: string; name: string }): Promise<SubscriptionPlan> {
    const data = await fetchPlatformApi<{ plan: any }>('/api/platform/plans', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return mapPlanRow(data.plan);
  },

  async updatePlan(planId: string, payload: Partial<SubscriptionPlan>): Promise<SubscriptionPlan> {
    const data = await fetchPlatformApi<{ plan: any }>(`/api/platform/plans/${planId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return mapPlanRow(data.plan);
  },

  async fetchSubscriptions(): Promise<BusinessSubscription[]> {
    const data = await fetchPlatformApi<{ subscriptions: any[] }>('/api/platform/subscriptions');
    return (data.subscriptions || []).map(mapSubscriptionRow);
  },

  async assignSubscription(payload: {
    businessId: string;
    planCode: string;
    billingCycle: 'trial' | 'monthly' | 'yearly' | 'lifetime';
    status: BusinessSubscription['status'];
    durationDays?: number;
    notes?: string;
  }): Promise<BusinessSubscription> {
    const data = await fetchPlatformApi<{ subscription: any }>('/api/platform/subscriptions/assign', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return mapSubscriptionRow(data.subscription);
  },

  async fetchPayments(): Promise<PlatformPayment[]> {
    const data = await fetchPlatformApi<{ payments: any[] }>('/api/platform/payments');
    return (data.payments || []).map(mapPaymentRow);
  },

  async verifyPayment(
    paymentId: string,
    status: 'verified' | 'rejected' | 'refunded',
    adminNote?: string
  ): Promise<PlatformPayment> {
    const data = await fetchPlatformApi<{ payment: any }>(`/api/platform/payments/${paymentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, adminNote }),
    });
    return mapPaymentRow(data.payment);
  },

  async fetchTickets(): Promise<SupportTicket[]> {
    const data = await fetchPlatformApi<{ tickets: any[] }>('/api/platform/tickets');
    return (data.tickets || []).map(mapTicketRow);
  },

  async updateTicket(
    ticketId: string,
    patch: { status?: SupportTicket['status']; priority?: SupportTicket['priority']; adminResponse?: string }
  ): Promise<SupportTicket> {
    const data = await fetchPlatformApi<{ ticket: any }>(`/api/platform/tickets/${ticketId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return mapTicketRow(data.ticket);
  },

  async fetchPlatformAdmins(): Promise<PlatformAdmin[]> {
    const data = await fetchPlatformApi<{ admins: any[] }>('/api/platform/admins');
    return (data.admins || []).map(mapAdminRow);
  },

  async assignPlatformAdmin(payload: { email: string; role: PlatformRole; fullName?: string }): Promise<PlatformAdmin> {
    const data = await fetchPlatformApi<{ admin: any }>('/api/platform/admins', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return mapAdminRow(data.admin);
  },

  async updatePlatformAdmin(
    adminRecordId: string,
    patch: { role?: PlatformRole; isActive?: boolean }
  ): Promise<PlatformAdmin> {
    const data = await fetchPlatformApi<{ admin: any }>(`/api/platform/admins/${adminRecordId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return mapAdminRow(data.admin);
  },

  async fetchPlatformSettings(): Promise<{
    general: PlatformGeneralSettings | null;
    billing: PlatformBillingSettings | null;
  }> {
    const data = await fetchPlatformApi<{ settings: Array<{ key: string; value: any }> }>('/api/platform/settings');
    const map = new Map((data.settings || []).map(s => [s.key, s.value]));
    return {
      general: (map.get('general') as PlatformGeneralSettings) || null,
      billing: (map.get('billing_instructions') as PlatformBillingSettings) || null,
    };
  },

  async savePlatformSettings(key: 'general' | 'billing_instructions', value: Record<string, any>): Promise<void> {
    await fetchPlatformApi('/api/platform/settings', {
      method: 'PATCH',
      body: JSON.stringify({ key, value }),
    });
  },

  async fetchAuditLogs(): Promise<PlatformAuditLog[]> {
    const data = await fetchPlatformApi<{ logs: any[] }>('/api/platform/audit-logs');
    return (data.logs || []).map(mapAuditRow);
  },

  async fetchSecuritySnapshot(): Promise<PlatformSecuritySnapshot> {
    return fetchPlatformApi<PlatformSecuritySnapshot>('/api/platform/security');
  },
};
