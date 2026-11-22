import {
  supabase,
  getFreshAccessToken,
  isSupabaseConfigured,
  isValidUuid,
  sanitizeUuid,
} from '../lib/supabase';
import { Seller, Sale } from '../types';
import { initialSellers } from '../data/initialData';

const SELLERS_STORAGE_KEY = 'AMAR_DOKAN_PRO_SELLERS';

function isPrivilegedApiUnavailable(res: Response, json: any): boolean {
  if (
    res.status === 404 ||
    res.status === 405 ||
    res.status === 501 ||
    res.status === 502 ||
    res.status === 503 ||
    res.status === 504
  ) {
    return true;
  }
  if (json?.code === 'SERVICE_ROLE_NOT_CONFIGURED') {
    return true;
  }
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (json === null && !contentType.includes('application/json')) {
    return true;
  }
  return false;
}

function isFetchConnectivityError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('fetch failed') ||
    msg.includes('abort')
  );
}

async function inspectEdgeFunctionError(
  fnErr: any,
  fnData: any
): Promise<{ isUnavailable: boolean; message: string; status?: number }> {
  if (fnData && typeof fnData === 'object' && typeof fnData.error === 'string' && fnData.error.trim()) {
    return { isUnavailable: false, message: fnData.error.trim() };
  }
  if (!fnErr) {
    return { isUnavailable: false, message: '' };
  }

  const errName = String(fnErr?.name || '');
  const rawMsg = String(fnErr?.message || '');

  if (fnErr.context && typeof fnErr.context === 'object' && typeof fnErr.context.json === 'function') {
    const status = Number(fnErr.context.status || 0);
    try {
      const cloned = typeof fnErr.context.clone === 'function' ? fnErr.context.clone() : fnErr.context;
      const body = await cloned.json();
      const bodyCode = String(body?.code || '').toUpperCase();
      const bodyMsg = String(body?.error || body?.message || '').trim();

      if (
        status === 404 &&
        (bodyCode === 'NOT_FOUND' || bodyMsg.toLowerCase().includes('requested function was not found'))
      ) {
        return { isUnavailable: true, status, message: bodyMsg || 'Edge Function manage-staff-user is not deployed.' };
      }
      if (status === 405 || status === 502 || status === 503 || status === 504) {
        return { isUnavailable: true, status, message: bodyMsg || `Edge Function unavailable (${status}).` };
      }
      if (bodyMsg) {
        return { isUnavailable: false, status, message: bodyMsg };
      }
    } catch {
      try {
        const clonedText = typeof fnErr.context.clone === 'function' ? fnErr.context.clone() : fnErr.context;
        const txt = String(await clonedText.text()).trim();
        if (status === 404 && (!txt || txt.toLowerCase().includes('not found'))) {
          return { isUnavailable: true, status, message: 'Edge Function manage-staff-user is not deployed.' };
        }
        if (status === 405 || status === 502 || status === 503 || status === 504) {
          return { isUnavailable: true, status, message: txt || `Edge Function unavailable (${status}).` };
        }
        if (txt) {
          return { isUnavailable: false, status, message: txt };
        }
      } catch {
        // Ignore parse failures
      }
    }

    if (status === 404 || status === 405 || status === 502 || status === 503 || status === 504) {
      return { isUnavailable: true, status, message: `Edge Function manage-staff-user unavailable (${status}).` };
    }
  }

  const lower = rawMsg.toLowerCase();
  const isNetworkOrMissing =
    errName === 'FunctionsFetchError' ||
    errName === 'FunctionsRelayError' ||
    lower.includes('failed to send a request') ||
    lower.includes('requested function was not found') ||
    lower.includes('404');

  return {
    isUnavailable: isNetworkOrMissing,
    message: rawMsg || 'Edge Function invocation failed.',
  };
}

async function invokeManageStaffEdgeFunction(
  body: Record<string, unknown>,
  initialToken: string
): Promise<{ data: any; error: any }> {
  let token = initialToken;
  let result = await supabase.functions.invoke('manage-staff-user', {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  const status = Number(result.error?.context?.status || 0);
  if (result.error && status === 401) {
    try {
      token = await getFreshAccessToken({ forceRefresh: true });
      result = await supabase.functions.invoke('manage-staff-user', {
        body,
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Keep original 401 response if refresh fails
    }
  }

  return result;
}

export const sellerService = {
  /**
   * Fetch all sellers for a business, enriched with sales count and amount
   */
  async fetchSellers(businessId: string, currentSales?: Sale[]): Promise<Seller[]> {
    if (!isSupabaseConfigured || !businessId) {
      return this.getLocalSellers(businessId, currentSales);
    }

    try {
      // 1. Query business_users with user_profiles and branches
      const { data: members, error } = await supabase
        .from('business_users')
        .select(`
          user_id,
          branch_id,
          role,
          status,
          created_at,
          updated_at,
          user_profiles (
            id,
            email,
            full_name,
            username,
            mobile
          ),
          branches (
            id,
            name
          )
        `)
        .eq('business_id', businessId)
        .in('role', ['seller', 'salesman']);

      if (error || !members || members.length === 0) {
        console.warn('Could not fetch sellers from Supabase or table empty, using local cache:', error?.message);
        return this.getLocalSellers(businessId, currentSales);
      }

      // 2. Map Supabase rows to Seller interface
      const sellers: Seller[] = members.map((m: any) => {
        const profile = m.user_profiles || {};
        const branch = m.branches || {};
        const sellerId = m.user_id;

        // Calculate sales count and amount from current sales if available
        let count = 0;
        let amount = 0;
        if (currentSales && currentSales.length > 0) {
          const sellerSales = currentSales.filter(
            s => s.sellerId === sellerId || s.servedBy === profile.full_name || s.servedBy === profile.email
          );
          count = sellerSales.length;
          amount = sellerSales.reduce((acc, curr) => acc + (curr.status !== 'voided' && curr.status !== 'returned' ? curr.total : 0), 0);
        }

        return {
          id: sellerId,
          username: profile.username || profile.email?.split('@')[0] || `seller_${sellerId.slice(0, 5)}`,
          fullName: profile.full_name || 'Seller',
          phone: profile.mobile || '',
          email: profile.email || '',
          role: m.role === 'salesman' ? 'salesman' : 'seller',
          branchId: m.branch_id || undefined,
          branchName: branch.name || undefined,
          status: m.status === 'suspended' ? 'inactive' : (m.status || 'active'),
          totalSalesCount: count,
          totalSalesAmount: amount,
          createdAt: m.created_at || new Date().toISOString(),
          updatedAt: m.updated_at,
        };
      });

      // Save to local cache
      try {
        localStorage.setItem(`${SELLERS_STORAGE_KEY}_${businessId}`, JSON.stringify(sellers));
      } catch {}

      return sellers;
    } catch (err) {
      console.error('Error fetching sellers from Supabase:', err);
      return this.getLocalSellers(businessId, currentSales);
    }
  },

  /**
   * Helper: Get local sellers from localStorage or initial seed
   */
  getLocalSellers(businessId?: string, currentSales?: Sale[]): Seller[] {
    try {
      const key = businessId ? `${SELLERS_STORAGE_KEY}_${businessId}` : SELLERS_STORAGE_KEY;
      const stored = localStorage.getItem(key);
      let list: Seller[] = stored ? JSON.parse(stored) : initialSellers;

      // Enrich with sales stats if currentSales are passed
      if (currentSales && currentSales.length > 0) {
        list = list.map(seller => {
          const sellerSales = currentSales.filter(
            s => s.sellerId === seller.id || s.servedBy === seller.fullName || s.servedBy === seller.username
          );
          const count = sellerSales.length > 0 ? sellerSales.length : (seller.totalSalesCount || 0);
          const amount = sellerSales.length > 0
            ? sellerSales.reduce((acc, curr) => acc + (curr.status !== 'voided' && curr.status !== 'returned' ? curr.total : 0), 0)
            : (seller.totalSalesAmount || 0);

          return {
            ...seller,
            totalSalesCount: count,
            totalSalesAmount: amount,
          };
        });
      }

      return list;
    } catch {
      return initialSellers;
    }
  },

  /**
   * Admin creates a new Seller account securely
   * Uses an isolated Supabase client to avoid terminating or replacing the Admin's session!
   */
  async createSeller(
    payload: {
      fullName: string;
      username: string;
      phone: string;
      email?: string;
      password: string;
      branchId?: string;
      branchName?: string;
      status: 'active' | 'inactive';
    },
    businessId: string
  ): Promise<Seller> {
    const cleanUsername = payload.username.trim().toLowerCase().replace(/\s+/g, '_');
    const emailToUse = (payload.email?.trim() || `${cleanUsername}@amardokanpro.internal`).toLowerCase();
    const cleanBranchId = sanitizeUuid(payload.branchId);
    const tempId = `seller-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    let createdId = tempId;

    if (isSupabaseConfigured && isValidUuid(businessId)) {
      let accessToken = await getFreshAccessToken().catch(() => '');

      let handledByPrivilegedApi = false;
      if (accessToken && typeof fetch !== 'undefined') {
        const postSellerCreate = (token: string) =>
          fetch('/api/staff/create', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              businessId,
              mode: 'seller',
              payload: {
                ...payload,
                username: cleanUsername,
                email: emailToUse,
                branchId: cleanBranchId,
                accountStatus: payload.status,
              },
            }),
          });
        try {
          let res = await postSellerCreate(accessToken);
          if (res.status === 401) {
            accessToken = await getFreshAccessToken({ forceRefresh: true });
            res = await postSellerCreate(accessToken);
          }
          const json = await res.json().catch(() => null);
          if (res.ok && isValidUuid(json?.userId)) {
            createdId = json.userId;
            handledByPrivilegedApi = true;
          } else if (!isPrivilegedApiUnavailable(res, json)) {
            throw new Error(json?.error || `Failed to create seller account (${res.status}).`);
          }
        } catch (apiErr: any) {
          if (apiErr instanceof Error && !isFetchConnectivityError(apiErr)) {
            throw apiErr;
          }
        }
      }

      if (!handledByPrivilegedApi && accessToken) {
        const { data: fnData, error: fnErr } = await invokeManageStaffEdgeFunction(
          {
            action: 'create_seller',
            businessId,
            payload: {
              ...payload,
              username: cleanUsername,
              email: emailToUse,
              branchId: cleanBranchId,
              accountStatus: payload.status,
            },
          },
          accessToken
        );

        if (!fnErr && isValidUuid(fnData?.userId)) {
          createdId = fnData.userId;
          handledByPrivilegedApi = true;
        } else {
          const parsedErr = await inspectEdgeFunctionError(fnErr, fnData);
          if (!parsedErr.isUnavailable && parsedErr.message) {
            throw new Error(parsedErr.message);
          }
        }
      }

      if (!handledByPrivilegedApi) {
        throw new Error(
          'Unable to create confirmed seller account: the server Admin API (/api/staff/create with SUPABASE_SERVICE_ROLE_KEY) and the Supabase Edge Function "manage-staff-user" are currently unavailable. Deploy "manage-staff-user" or configure SUPABASE_SERVICE_ROLE_KEY on the backend so accounts can be created with email_confirm: true without sending confirmation emails.'
        );
      }
    }

    const newSeller: Seller = {
      id: createdId,
      username: cleanUsername,
      fullName: payload.fullName,
      phone: payload.phone,
      email: emailToUse,
      role: 'seller',
      branchId: payload.branchId,
      branchName: payload.branchName,
      status: payload.status,
      totalSalesCount: 0,
      totalSalesAmount: 0,
      createdAt: new Date().toISOString(),
    };

    // Update local cache
    const existing = this.getLocalSellers(businessId);
    const updated = [newSeller, ...existing.filter(s => s.id !== newSeller.id && s.username !== newSeller.username)];
    try {
      const key = businessId ? `${SELLERS_STORAGE_KEY}_${businessId}` : SELLERS_STORAGE_KEY;
      localStorage.setItem(key, JSON.stringify(updated));
    } catch {}

    return newSeller;
  },

  /**
   * Update seller details (Name, Phone, Branch, Status)
   */
  async updateSeller(
    id: string,
    payload: {
      fullName?: string;
      phone?: string;
      branchId?: string;
      branchName?: string;
      status?: 'active' | 'inactive';
    },
    businessId: string
  ): Promise<void> {
    if (isSupabaseConfigured && businessId) {
      try {
        if (payload.fullName || payload.phone) {
          await supabase
            .from('user_profiles')
            .update({
              full_name: payload.fullName,
              mobile: payload.phone,
              updated_at: new Date().toISOString(),
            })
            .eq('id', id);
        }

        if (payload.branchId !== undefined || payload.status) {
          await supabase
            .from('business_users')
            .update({
              branch_id: payload.branchId || null,
              status: payload.status,
              updated_at: new Date().toISOString(),
            })
            .eq('business_id', businessId)
            .eq('user_id', id);
        }
      } catch (err) {
        console.warn('Error updating seller in Supabase:', err);
      }
    }

    // Update local storage
    const current = this.getLocalSellers(businessId);
    const updated = current.map(s => {
      if (s.id === id) {
        return {
          ...s,
          ...payload,
          updatedAt: new Date().toISOString(),
        };
      }
      return s;
    });

    try {
      const key = businessId ? `${SELLERS_STORAGE_KEY}_${businessId}` : SELLERS_STORAGE_KEY;
      localStorage.setItem(key, JSON.stringify(updated));
    } catch {}
  },

  /**
   * Quick toggle seller active/inactive status
   */
  async toggleSellerStatus(id: string, newStatus: 'active' | 'inactive', businessId: string): Promise<void> {
    return this.updateSeller(id, { status: newStatus }, businessId);
  },

  /**
   * Reset seller password via Admin API / Edge Function
   */
  async resetPassword(
    email: string,
    newPassword?: string,
    sellerUserId?: string,
    businessId?: string
  ): Promise<{ success: boolean; message: string }> {
    if (!isSupabaseConfigured) {
      return {
        success: true,
        message: 'Password reset successfully (Local mode). Seller can sign in with the new password.',
      };
    }

    try {
      const cleanPass = (newPassword || '').trim();
      const validBizId = sanitizeUuid(businessId);
      const validUserId = sanitizeUuid(sellerUserId);
      let accessToken = await getFreshAccessToken().catch(() => '');

      if (cleanPass.length >= 6 && accessToken && validBizId && validUserId) {
        if (typeof fetch !== 'undefined') {
          const postSellerReset = (token: string) =>
            fetch('/api/staff/reset-password', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                businessId: validBizId,
                userId: validUserId,
                newPassword: cleanPass,
              }),
            });
          try {
            let res = await postSellerReset(accessToken);
            if (res.status === 401) {
              accessToken = await getFreshAccessToken({ forceRefresh: true });
              res = await postSellerReset(accessToken);
            }
            const json = await res.json().catch(() => null);
            if (res.ok && json?.success) {
              return {
                success: true,
                message: json.message || 'Seller password updated in Supabase Auth.',
              };
            }
            if (!isPrivilegedApiUnavailable(res, json)) {
              return { success: false, message: json?.error || `Failed to update seller password (${res.status}).` };
            }
          } catch {
            // Fall through to Edge Function
          }
        }

        const { data: fnData, error: fnErr } = await invokeManageStaffEdgeFunction(
          {
            action: 'reset_password',
            businessId: validBizId,
            userId: validUserId,
            newPassword: cleanPass,
          },
          accessToken
        );
        if (!fnErr && fnData?.success) {
          return {
            success: true,
            message: fnData.message || 'Seller password updated in Supabase Auth.',
          };
        }
        const parsedErr = await inspectEdgeFunctionError(fnErr, fnData);
        if (!parsedErr.isUnavailable && parsedErr.message) {
          return { success: false, message: parsedErr.message };
        }
      }

      if (email.includes('@amardokanpro.internal')) {
        return {
          success: false,
          message:
            'Edge Function "manage-staff-user" is not deployed yet (or SUPABASE_SERVICE_ROLE_KEY is missing on the server). Deploy the Edge Function to reset internal seller passwords.',
        };
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });

      if (error) {
        if (String(error.message || '').toLowerCase().includes('rate limit')) {
          throw new Error(
            'Supabase email rate limit exceeded while sending password reset email. Deploy Edge Function "manage-staff-user" (or configure custom SMTP) to reset seller passwords directly without sending emails.'
          );
        }
        throw error;
      }

      return {
        success: true,
        message: `Password reset email sent to ${email}.`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to send password reset request.',
      };
    }
  },
};
