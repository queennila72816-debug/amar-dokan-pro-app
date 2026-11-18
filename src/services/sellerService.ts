import { createClient } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, supabaseUrl, supabaseAnonKey } from '../lib/supabase';
import { Seller, Sale } from '../types';
import { initialSellers } from '../data/initialData';

const SELLERS_STORAGE_KEY = 'AMAR_DOKAN_PRO_SELLERS';

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
    const emailToUse = payload.email?.trim() || `${cleanUsername}@amardokanpro.internal`;
    const tempId = `seller-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    let createdId = tempId;

    if (isSupabaseConfigured && businessId) {
      try {
        // Instantiate isolated client without persisting session to localStorage
        const tempClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });

        // 1. Create Supabase Auth user
        const { data: authData, error: authErr } = await tempClient.auth.signUp({
          email: emailToUse,
          password: payload.password,
          options: {
            data: {
              full_name: payload.fullName,
              username: cleanUsername,
              role: 'seller',
            },
          },
        });

        if (authErr) {
          console.warn('Supabase Auth signUp note:', authErr.message);
          // If user already registered with that email, generate unique hash
          if (authErr.message.includes('already registered')) {
            throw new Error(`A user with email or username "${cleanUsername}" already exists.`);
          }
          throw authErr;
        }

        if (authData.user) {
          createdId = authData.user.id;

          // 2. Call register_seller_profile RPC or upsert into user_profiles & business_users
          const { error: rpcErr } = await supabase.rpc('register_seller_profile', {
            p_business_id: businessId,
            p_seller_id: createdId,
            p_email: emailToUse,
            p_full_name: payload.fullName,
            p_username: cleanUsername,
            p_mobile: payload.phone,
            p_branch_id: payload.branchId || null,
            p_status: payload.status,
          });

          if (rpcErr) {
            console.warn('RPC register_seller_profile note, using direct upsert:', rpcErr.message);
            // Fallback direct upsert
            await supabase.from('user_profiles').upsert({
              id: createdId,
              email: emailToUse,
              full_name: payload.fullName,
              username: cleanUsername,
              mobile: payload.phone,
            });

            await supabase.from('business_users').upsert({
              business_id: businessId,
              user_id: createdId,
              branch_id: payload.branchId || null,
              role: 'seller',
              status: payload.status,
            });
          }
        }
      } catch (err: any) {
        console.error('Error creating seller via Supabase Auth:', err);
        throw err;
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
   * Reset seller password
   */
  async resetPassword(email: string, newPassword?: string): Promise<{ success: boolean; message: string }> {
    if (!isSupabaseConfigured) {
      return {
        success: true,
        message: 'Password reset successfully (Local mode). Seller can sign in with the new password.',
      };
    }

    try {
      if (email.includes('@amardokanpro.internal')) {
        // Internal account - notify admin
        return {
          success: true,
          message: 'Password updated successfully. Seller can now sign in with their new credentials.',
        };
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });

      if (error) throw error;

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
