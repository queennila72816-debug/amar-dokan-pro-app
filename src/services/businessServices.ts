import { supabase, isSupabaseConfigured, sanitizeUuid } from '../lib/supabase';
import {
  Customer,
  CustomerTransaction,
  Supplier,
  SupplierTransaction,
  Account,
  AccountTransaction,
  Expense,
  Purchase,
  Branch,
  StockMovement,
  StockTransfer,
} from '../types';

const CUSTOMER_KYC_LOCAL_PREFIX = 'AMAR_DOKAN_PRO_CUST_KYC_V1_';

type CustomerKycPatch = Pick<
  Customer,
  'customerCode' | 'photoUrl' | 'nidNumber' | 'nidFrontUrl' | 'nidBackUrl' | 'kycConsent' | 'kycConsentAt'
>;

function readLocalCustomerKycMap(businessId?: string): Record<string, CustomerKycPatch> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const key = `${CUSTOMER_KYC_LOCAL_PREFIX}${businessId || 'default'}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalCustomerKycPatch(
  customerId: string,
  patch: CustomerKycPatch,
  businessId?: string
): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const key = `${CUSTOMER_KYC_LOCAL_PREFIX}${businessId || 'default'}`;
    const existing = readLocalCustomerKycMap(businessId);
    existing[customerId] = { ...(existing[customerId] || {}), ...patch };
    localStorage.setItem(key, JSON.stringify(existing));
  } catch {
    // non-fatal
  }
}

function isMissingColumnError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    (msg.includes('column') && (msg.includes('does not exist') || msg.includes('schema cache')))
  );
}

export const customerService = {
  async fetchCustomers(businessId?: string): Promise<Customer[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    let query = supabase.from('customers').select('*').order('created_at', { ascending: false });
    if (businessId) query = query.eq('business_id', businessId);
    const { data, error } = await query;
    if (error) throw error;
    const localKyc = readLocalCustomerKycMap(businessId);
    return (data || []).map((c: any) => {
      const kyc = localKyc[c.id] || {};
      return {
        id: c.id,
        customerCode: c.customer_code || kyc.customerCode || undefined,
        name: c.name,
        mobile: c.mobile,
        address: c.address || undefined,
        email: c.email || undefined,
        customerType: c.customer_type || 'retail',
        openingDue: Number(c.opening_due || 0),
        currentDue: Number(c.current_due || 0),
        creditLimit: Number(c.credit_limit || 0),
        totalPurchase: Number(c.total_purchase || 0),
        totalPaid: Number(c.total_paid || 0),
        createdAt: c.created_at,
        notes: c.notes || undefined,
        photoUrl: c.photo_url || kyc.photoUrl || undefined,
        nidNumber: c.nid_number || kyc.nidNumber || undefined,
        nidFrontUrl: c.nid_front_url || kyc.nidFrontUrl || undefined,
        nidBackUrl: c.nid_back_url || kyc.nidBackUrl || undefined,
        kycConsent: c.kyc_consent ?? kyc.kycConsent ?? undefined,
        kycConsentAt: c.kyc_consent_at || kyc.kycConsentAt || undefined,
      };
    });
  },

  async fetchCustomerTransactions(businessId: string): Promise<CustomerTransaction[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase
      .from('customer_transactions')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((t: any) => ({
      id: t.id,
      customerId: t.customer_id,
      customerName: t.customer_name || 'Customer',
      date: t.created_at,
      type: t.transaction_type,
      amount: Number(t.amount || 0),
      balanceAfter: Number(t.balance_after || 0),
      paymentMethod: t.payment_method || undefined,
      referenceId: t.reference_id || undefined,
      note: t.note || undefined,
    }));
  },

  async insertCustomer(
    data: Omit<Customer, 'id' | 'createdAt' | 'currentDue' | 'totalPurchase' | 'totalPaid' | 'openingDue'> & {
      openingDue?: number;
    },
    businessId: string
  ): Promise<Customer> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const opDue = Number(data.openingDue || 0);
    const basePayload: any = {
      business_id: businessId,
      name: data.name,
      mobile: data.mobile,
      address: data.address || null,
      email: data.email || null,
      customer_type: data.customerType || 'retail',
      opening_due: opDue,
      current_due: opDue,
      credit_limit: Number(data.creditLimit || 0),
      total_purchase: opDue,
      total_paid: 0,
      notes: data.notes || null,
    };
    const extendedPayload: any = {
      ...basePayload,
      customer_code: data.customerCode || null,
      photo_url: data.photoUrl || null,
      nid_number: data.nidNumber || null,
      nid_front_url: data.nidFrontUrl || null,
      nid_back_url: data.nidBackUrl || null,
      kyc_consent: data.kycConsent ?? false,
      kyc_consent_at: data.kycConsentAt || null,
    };

    let res: any;
    let insertErr: any;
    ({ data: res, error: insertErr } = await supabase
      .from('customers')
      .insert(extendedPayload)
      .select()
      .single());

    if (insertErr && isMissingColumnError(insertErr)) {
      ({ data: res, error: insertErr } = await supabase
        .from('customers')
        .insert(basePayload)
        .select()
        .single());
    }
    if (insertErr) throw insertErr;

    const kycPatch: CustomerKycPatch = {
      customerCode: data.customerCode,
      photoUrl: data.photoUrl,
      nidNumber: data.nidNumber,
      nidFrontUrl: data.nidFrontUrl,
      nidBackUrl: data.nidBackUrl,
      kycConsent: data.kycConsent,
      kycConsentAt: data.kycConsentAt,
    };
    if (
      kycPatch.customerCode ||
      kycPatch.photoUrl ||
      kycPatch.nidNumber ||
      kycPatch.nidFrontUrl ||
      kycPatch.nidBackUrl
    ) {
      saveLocalCustomerKycPatch(res.id, kycPatch, businessId);
    }

    if (opDue > 0) {
      const { error: txErr } = await supabase.from('customer_transactions').insert({
        business_id: businessId,
        customer_id: res.id,
        customer_name: res.name,
        transaction_type: 'opening',
        amount: opDue,
        balance_after: opDue,
        note: 'Opening customer balance',
      });
      if (txErr) throw txErr;
    }

    return {
      id: res.id,
      customerCode: res.customer_code || data.customerCode || undefined,
      name: res.name,
      mobile: res.mobile,
      address: res.address || undefined,
      email: res.email || undefined,
      customerType: res.customer_type || 'retail',
      openingDue: Number(res.opening_due || 0),
      currentDue: Number(res.current_due || 0),
      creditLimit: Number(res.credit_limit || 0),
      totalPurchase: Number(res.total_purchase || 0),
      totalPaid: Number(res.total_paid || 0),
      createdAt: res.created_at,
      notes: res.notes || undefined,
      photoUrl: res.photo_url || data.photoUrl || undefined,
      nidNumber: res.nid_number || data.nidNumber || undefined,
      nidFrontUrl: res.nid_front_url || data.nidFrontUrl || undefined,
      nidBackUrl: res.nid_back_url || data.nidBackUrl || undefined,
      kycConsent: res.kyc_consent ?? data.kycConsent ?? undefined,
      kycConsentAt: res.kyc_consent_at || data.kycConsentAt || undefined,
    };
  },

  async updateCustomer(id: string, data: Partial<Customer>, businessId?: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const basePayload: any = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) basePayload.name = data.name;
    if (data.mobile !== undefined) basePayload.mobile = data.mobile;
    if (data.address !== undefined) basePayload.address = data.address;
    if (data.email !== undefined) basePayload.email = data.email;
    if (data.customerType !== undefined) basePayload.customer_type = data.customerType;
    if (data.currentDue !== undefined) basePayload.current_due = data.currentDue;
    if (data.creditLimit !== undefined) basePayload.credit_limit = data.creditLimit;
    if (data.totalPurchase !== undefined) basePayload.total_purchase = data.totalPurchase;
    if (data.totalPaid !== undefined) basePayload.total_paid = data.totalPaid;
    if (data.notes !== undefined) basePayload.notes = data.notes;

    const extPayload: any = { ...basePayload };
    if (data.customerCode !== undefined) extPayload.customer_code = data.customerCode || null;
    if (data.photoUrl !== undefined) extPayload.photo_url = data.photoUrl || null;
    if (data.nidNumber !== undefined) extPayload.nid_number = data.nidNumber || null;
    if (data.nidFrontUrl !== undefined) extPayload.nid_front_url = data.nidFrontUrl || null;
    if (data.nidBackUrl !== undefined) extPayload.nid_back_url = data.nidBackUrl || null;
    if (data.kycConsent !== undefined) extPayload.kyc_consent = Boolean(data.kycConsent);
    if (data.kycConsentAt !== undefined) extPayload.kyc_consent_at = data.kycConsentAt || null;

    if (
      data.customerCode !== undefined ||
      data.photoUrl !== undefined ||
      data.nidNumber !== undefined ||
      data.nidFrontUrl !== undefined ||
      data.nidBackUrl !== undefined ||
      data.kycConsent !== undefined
    ) {
      saveLocalCustomerKycPatch(
        id,
        {
          customerCode: data.customerCode,
          photoUrl: data.photoUrl,
          nidNumber: data.nidNumber,
          nidFrontUrl: data.nidFrontUrl,
          nidBackUrl: data.nidBackUrl,
          kycConsent: data.kycConsent,
          kycConsentAt: data.kycConsentAt,
        },
        businessId
      );
    }

    let query = supabase.from('customers').update(extPayload).eq('id', id);
    if (businessId) query = query.eq('business_id', businessId);
    let { error } = await query;

    if (error && isMissingColumnError(error)) {
      let fallbackQ = supabase.from('customers').update(basePayload).eq('id', id);
      if (businessId) fallbackQ = fallbackQ.eq('business_id', businessId);
      const resFallback = await fallbackQ;
      error = resFallback.error;
    }
    if (error) throw error;
  },

  async deleteCustomer(id: string, businessId?: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    let query = supabase.from('customers').delete().eq('id', id);
    if (businessId) query = query.eq('business_id', businessId);
    const { error } = await query;
    if (error) throw error;
  },

  async collectDue(
    customerId: string,
    amount: number,
    paymentMethod: string,
    accountId: string,
    businessId: string,
    note?: string
  ): Promise<{ previousDue: number; newDue: number }> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase.rpc('collect_customer_due_payment', {
      p_business_id: businessId,
      p_customer_id: customerId,
      p_amount: amount,
      p_payment_method: paymentMethod,
      p_account_id: sanitizeUuid(accountId),
      p_note: note || null,
    });

    if (error) throw error;

    return {
      previousDue: Number(data.previous_due),
      newDue: Number(data.new_due),
    };
  },
};

export const supplierService = {
  async fetchSuppliers(businessId?: string): Promise<Supplier[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    let query = supabase.from('suppliers').select('*').order('created_at', { ascending: false });
    if (businessId) query = query.eq('business_id', businessId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      company: s.company,
      mobile: s.mobile,
      address: s.address || undefined,
      email: s.email || undefined,
      openingDue: Number(s.opening_due || 0),
      currentDue: Number(s.current_due || 0),
      totalPurchase: Number(s.total_purchase || 0),
      totalPaid: Number(s.total_paid || 0),
      createdAt: s.created_at,
    }));
  },

  async fetchSupplierTransactions(businessId: string): Promise<SupplierTransaction[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase
      .from('supplier_transactions')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((t: any) => ({
      id: t.id,
      supplierId: t.supplier_id,
      supplierName: t.supplier_name || 'Supplier',
      date: t.created_at,
      type: t.transaction_type,
      amount: Number(t.amount || 0),
      balanceAfter: Number(t.balance_after || 0),
      paymentMethod: t.payment_method || undefined,
      referenceId: t.reference_id || undefined,
      note: t.note || undefined,
    }));
  },

  async insertSupplier(
    data: Omit<Supplier, 'id' | 'createdAt' | 'currentDue' | 'totalPurchase' | 'totalPaid' | 'openingDue'> & {
      openingDue?: number;
    },
    businessId: string
  ): Promise<Supplier> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const opDue = Number(data.openingDue || 0);
    const payload = {
      business_id: businessId,
      name: data.name,
      company: data.company,
      mobile: data.mobile,
      address: data.address || null,
      email: data.email || null,
      opening_due: opDue,
      current_due: opDue,
      total_purchase: opDue,
      total_paid: 0,
    };
    const { data: res, error } = await supabase.from('suppliers').insert(payload).select().single();
    if (error) throw error;

    if (opDue > 0) {
      const { error: txErr } = await supabase.from('supplier_transactions').insert({
        business_id: businessId,
        supplier_id: res.id,
        supplier_name: res.name,
        transaction_type: 'opening',
        amount: opDue,
        balance_after: opDue,
        note: 'Opening supplier balance',
      });
      if (txErr) throw txErr;
    }

    return {
      id: res.id,
      name: res.name,
      company: res.company,
      mobile: res.mobile,
      address: res.address || undefined,
      email: res.email || undefined,
      openingDue: Number(res.opening_due || 0),
      currentDue: Number(res.current_due || 0),
      totalPurchase: Number(res.total_purchase || 0),
      totalPaid: Number(res.total_paid || 0),
      createdAt: res.created_at,
    };
  },

  async updateSupplier(id: string, data: Partial<Supplier>, businessId?: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const payload: any = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) payload.name = data.name;
    if (data.company !== undefined) payload.company = data.company;
    if (data.mobile !== undefined) payload.mobile = data.mobile;
    if (data.address !== undefined) payload.address = data.address;
    if (data.email !== undefined) payload.email = data.email;
    if (data.currentDue !== undefined) payload.current_due = data.currentDue;
    if (data.totalPurchase !== undefined) payload.total_purchase = data.totalPurchase;
    if (data.totalPaid !== undefined) payload.total_paid = data.totalPaid;

    let query = supabase.from('suppliers').update(payload).eq('id', id);
    if (businessId) query = query.eq('business_id', businessId);
    const { error } = await query;
    if (error) throw error;
  },

  async deleteSupplier(id: string, businessId?: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    let query = supabase.from('suppliers').delete().eq('id', id);
    if (businessId) query = query.eq('business_id', businessId);
    const { error } = await query;
    if (error) throw error;
  },

  async payDue(
    supplierId: string,
    amount: number,
    paymentMethod: string,
    accountId: string,
    businessId: string,
    note?: string
  ): Promise<{ previousDue: number; newDue: number }> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase.rpc('pay_supplier_due_balance', {
      p_business_id: businessId,
      p_supplier_id: supplierId,
      p_amount: amount,
      p_payment_method: paymentMethod,
      p_account_id: sanitizeUuid(accountId),
      p_note: note || null,
    });

    if (error) throw error;

    return {
      previousDue: Number(data.previous_due),
      newDue: Number(data.new_due),
    };
  },
};

export const financeService = {
  async fetchAccounts(businessId?: string): Promise<Account[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    let query = supabase.from('accounts').select('*').order('created_at', { ascending: true });
    if (businessId) query = query.eq('business_id', businessId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      accountType: a.account_type,
      accountNumber: a.account_number || undefined,
      balance: Number(a.balance || 0),
    }));
  },

  async fetchAccountTransactions(businessId: string): Promise<AccountTransaction[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase
      .from('account_transactions')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((t: any) => ({
      id: t.id,
      accountId: t.account_id,
      accountName: t.account_name || 'Account',
      date: t.created_at,
      type: t.transaction_type,
      amount: Number(t.amount || 0),
      balanceAfter: Number(t.balance_after || 0),
      referenceId: t.reference_id || undefined,
      note: t.note || undefined,
    }));
  },

  async insertAccount(data: Omit<Account, 'id'>, businessId: string): Promise<Account> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const payload = {
      business_id: businessId,
      name: data.name,
      account_type: data.accountType,
      account_number: data.accountNumber || null,
      balance: Number(data.balance) || 0,
      is_active: true,
    };
    const { data: res, error } = await supabase.from('accounts').insert(payload).select().single();
    if (error) throw error;
    return {
      id: res.id,
      name: res.name,
      accountType: res.account_type,
      accountNumber: res.account_number || undefined,
      balance: Number(res.balance || 0),
    };
  },

  async updateAccount(id: string, updates: Partial<Account>, businessId?: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const payload: any = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.accountType !== undefined) payload.account_type = updates.accountType;
    if (updates.accountNumber !== undefined) payload.account_number = updates.accountNumber;
    if (updates.balance !== undefined) payload.balance = updates.balance;
    let query = supabase.from('accounts').update(payload).eq('id', id);
    if (businessId) query = query.eq('business_id', businessId);
    const { error } = await query;
    if (error) throw error;
  },

  async deleteAccount(id: string, businessId?: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    let query = supabase.from('accounts').delete().eq('id', id);
    if (businessId) query = query.eq('business_id', businessId);
    const { error } = await query;
    if (error) throw error;
  },

  async fetchExpenses(businessId?: string): Promise<Expense[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    let query = supabase.from('expenses').select('*').order('created_at', { ascending: false });
    if (businessId) query = query.eq('business_id', businessId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((e: any) => ({
      id: e.id,
      date: e.date || e.created_at,
      expenseMonth: e.expense_month || undefined,
      paymentDate: e.payment_date ? String(e.payment_date).slice(0, 10) : undefined,
      category: e.category,
      amount: Number(e.amount || 0),
      paymentMethod: e.payment_method,
      accountId: e.account_id || '',
      employeeId: e.employee_id || undefined,
      staffName: e.staff_name || undefined,
      paymentStatus: e.payment_status === 'unpaid' ? 'unpaid' : 'paid',
      paidTo: e.paid_to || undefined,
      note: e.note || undefined,
    }));
  },

  async insertExpense(expense: Omit<Expense, 'id' | 'date'>, businessId: string, branchId?: string): Promise<Expense> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const paymentStatus = expense.paymentStatus === 'unpaid' ? 'unpaid' : 'paid';
    const paymentDate = expense.paymentDate ? expense.paymentDate.slice(0, 10) : null;
    const expenseMonth = expense.expenseMonth?.trim() || null;
    const employeeId = sanitizeUuid(expense.employeeId);
    const staffName = expense.staffName?.trim() || null;

    const { data, error } = await supabase.rpc('record_expense_transaction', {
      p_business_id: businessId,
      p_branch_id: sanitizeUuid(branchId),
      p_account_id: sanitizeUuid(expense.accountId),
      p_category: expense.category,
      p_amount: expense.amount,
      p_payment_method: expense.paymentMethod,
      p_paid_to: expense.paidTo || null,
      p_note: expense.note || null,
      p_expense_month: expenseMonth,
      p_payment_date: paymentDate,
      p_employee_id: employeeId,
      p_staff_name: staffName,
      p_payment_status: paymentStatus,
    });

    if (error) {
      const code = String((error as any)?.code || '');
      const msg = String((error as any)?.message || '').toLowerCase();
      const isMissingNewRpc =
        code === 'PGRST202' ||
        code === '42883' ||
        msg.includes('could not find the function public.record_expense_transaction');

      if (isMissingNewRpc) {
        if (paymentStatus === 'unpaid') {
          throw new Error(
            'Database migration required for Unpaid expense tracking. Please run supabase/migrations/20261126_expense_billing_month_staff_status.sql in Supabase SQL Editor.'
          );
        }
        const legacyRes = await supabase.rpc('record_expense_transaction', {
          p_business_id: businessId,
          p_branch_id: sanitizeUuid(branchId),
          p_account_id: sanitizeUuid(expense.accountId),
          p_category: expense.category,
          p_amount: expense.amount,
          p_payment_method: expense.paymentMethod,
          p_paid_to: expense.paidTo || null,
          p_note: expense.note || null,
        });
        if (legacyRes.error) throw legacyRes.error;
        const row = legacyRes.data;
        return {
          id: row.id,
          date: row.date || row.created_at,
          expenseMonth: expenseMonth || undefined,
          paymentDate: paymentDate || undefined,
          category: row.category,
          amount: Number(row.amount),
          paymentMethod: row.payment_method,
          accountId: row.account_id || '',
          employeeId: employeeId || undefined,
          staffName: staffName || undefined,
          paymentStatus: 'paid',
          paidTo: row.paid_to || undefined,
          note: row.note || undefined,
        };
      }
      throw error;
    }

    return {
      id: data.id,
      date: data.date || data.created_at,
      expenseMonth: data.expense_month || expenseMonth || undefined,
      paymentDate: data.payment_date ? String(data.payment_date).slice(0, 10) : paymentDate || undefined,
      category: data.category,
      amount: Number(data.amount),
      paymentMethod: data.payment_method,
      accountId: data.account_id || '',
      employeeId: data.employee_id || employeeId || undefined,
      staffName: data.staff_name || staffName || undefined,
      paymentStatus: data.payment_status === 'unpaid' ? 'unpaid' : 'paid',
      paidTo: data.paid_to || undefined,
      note: data.note || undefined,
    };
  },

  async updateExpense(
    expenseId: string,
    updates: Partial<Omit<Expense, 'id' | 'date'>>,
    businessId: string
  ): Promise<Expense> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase.rpc('update_expense_transaction', {
      p_business_id: businessId,
      p_expense_id: expenseId,
      p_category: updates.category ?? null,
      p_amount: updates.amount ?? null,
      p_payment_method: updates.paymentMethod ?? null,
      p_account_id: updates.accountId !== undefined ? sanitizeUuid(updates.accountId) : null,
      p_paid_to: updates.paidTo !== undefined ? updates.paidTo || '' : null,
      p_note: updates.note !== undefined ? updates.note || '' : null,
      p_expense_month: updates.expenseMonth !== undefined ? updates.expenseMonth || '' : null,
      p_payment_date: updates.paymentDate ? updates.paymentDate.slice(0, 10) : null,
      p_employee_id: updates.employeeId !== undefined ? sanitizeUuid(updates.employeeId) : null,
      p_staff_name: updates.staffName !== undefined ? updates.staffName || '' : null,
      p_payment_status: updates.paymentStatus ?? null,
    });
    if (error) {
      const code = String((error as any)?.code || '');
      const msg = String((error as any)?.message || '').toLowerCase();
      if (code === 'PGRST202' || code === '42883' || msg.includes('update_expense_transaction')) {
        throw new Error(
          'Database migration required to update expense records. Please run supabase/migrations/20261126_expense_billing_month_staff_status.sql in Supabase SQL Editor.'
        );
      }
      throw error;
    }

    return {
      id: data.id,
      date: data.date || data.created_at,
      expenseMonth: data.expense_month || undefined,
      paymentDate: data.payment_date ? String(data.payment_date).slice(0, 10) : undefined,
      category: data.category,
      amount: Number(data.amount),
      paymentMethod: data.payment_method,
      accountId: data.account_id || '',
      employeeId: data.employee_id || undefined,
      staffName: data.staff_name || undefined,
      paymentStatus: data.payment_status === 'unpaid' ? 'unpaid' : 'paid',
      paidTo: data.paid_to || undefined,
      note: data.note || undefined,
    };
  },

  async deleteExpense(expenseId: string, businessId: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { error } = await supabase.rpc('delete_expense_transaction', {
      p_business_id: businessId,
      p_expense_id: expenseId,
    });
    if (error) throw error;
  },

  async transferFunds(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    businessId: string,
    note?: string
  ): Promise<{ success: boolean; referenceId?: string }> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase.rpc('transfer_account_funds', {
      p_business_id: businessId,
      p_from_account_id: fromAccountId,
      p_to_account_id: toAccountId,
      p_amount: amount,
      p_note: note || null,
    });
    if (error) throw error;
    return { success: true, referenceId: data?.reference_id };
  },
};

export const inventoryService = {
  async fetchStockMovements(businessId: string): Promise<StockMovement[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((m: any) => ({
      id: m.id,
      productId: m.product_id,
      productName: m.product_name,
      date: m.created_at,
      type: m.movement_type,
      quantity: Number(m.quantity || 0),
      previousStock: Number(m.previous_stock || 0),
      newStock: Number(m.new_stock || 0),
      reference: m.reference || undefined,
      branchId: m.branch_id || '',
      note: m.note || undefined,
    }));
  },

  async fetchStockTransfers(businessId: string): Promise<StockTransfer[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase
      .from('stock_transfers')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((t: any) => ({
      id: t.id,
      date: t.created_at,
      productId: t.product_id,
      productName: t.product_name,
      quantity: Number(t.quantity || 0),
      fromBranchId: t.from_branch_id || '',
      fromBranchName: t.from_branch_name || 'Source',
      toBranchId: t.to_branch_id || '',
      toBranchName: t.to_branch_name || 'Destination',
      transferredBy: t.transferred_by || 'Staff',
      note: t.note || undefined,
    }));
  },

  async adjustStock(
    productId: string,
    adjustedQty: number,
    reason: string,
    businessId: string,
    branchId: string,
    note?: string,
    variantId?: string
  ): Promise<{ previousStock: number; newStock: number }> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase.rpc('adjust_product_stock', {
      p_business_id: businessId,
      p_branch_id: sanitizeUuid(branchId),
      p_product_id: productId,
      p_adjusted_qty: adjustedQty,
      p_reason: reason,
      p_note: note || null,
      p_variant_id: sanitizeUuid(variantId),
    });

    if (error) throw error;

    return {
      previousStock: Number(data.previous_stock),
      newStock: Number(data.new_stock),
    };
  },

  async transferBranchStock(
    productId: string,
    quantity: number,
    fromBranchId: string,
    toBranchId: string,
    businessId: string,
    note?: string
  ): Promise<{ success: boolean; reference?: string }> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase.rpc('transfer_branch_stock', {
      p_business_id: businessId,
      p_product_id: productId,
      p_quantity: quantity,
      p_from_branch_id: fromBranchId,
      p_to_branch_id: toBranchId,
      p_note: note || null,
    });

    if (error) throw error;
    return { success: true, reference: data?.reference };
  },
};

export const purchaseService = {
  async fetchPurchases(businessId?: string): Promise<Purchase[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    let query = supabase.from('purchases').select('*, purchase_items(*)').order('created_at', { ascending: false });
    if (businessId) query = query.eq('business_id', businessId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((p: any) => ({
      id: p.id,
      invoiceNumber: p.invoice_number,
      supplierId: p.supplier_id || '',
      supplierName: p.supplier_name,
      date: p.created_at,
      items: (p.purchase_items || []).map((i: any) => ({
        productId: i.product_id,
        productName: i.product_name,
        quantity: Number(i.quantity),
        purchasePrice: Number(i.purchase_price),
        total: Number(i.total),
        landedCostPerUnit: i.landed_cost_per_unit != null ? Number(i.landed_cost_per_unit) : undefined,
      })),
      subtotal: Number(p.subtotal),
      discount: Number(p.discount || 0),
      transportCost: Number(p.transport_cost || 0),
      loadingCost: Number(p.loading_cost || 0),
      packagingCost: Number(p.packaging_cost || 0),
      otherCost: Number(p.other_cost || 0),
      total: Number(p.total),
      paid: Number(p.paid),
      due: Number(p.due),
      paymentMethod: p.payment_method,
      branchId: p.branch_id || '',
      notes: p.notes || undefined,
    }));
  },

  async completePurchase(purchase: Purchase, businessId: string): Promise<{ success: boolean; purchaseId?: string }> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const p_purchase = {
      business_id: businessId,
      branch_id: sanitizeUuid(purchase.branchId),
      supplier_id: sanitizeUuid(purchase.supplierId),
      supplier_name: purchase.supplierName,
      invoice_number: purchase.invoiceNumber,
      subtotal: purchase.subtotal,
      discount: purchase.discount || 0,
      transport_cost: purchase.transportCost || 0,
      loading_cost: purchase.loadingCost || 0,
      packaging_cost: purchase.packagingCost || 0,
      other_cost: purchase.otherCost || 0,
      total: purchase.total,
      paid: purchase.paid,
      due: purchase.due,
      payment_method: purchase.paymentMethod,
      notes: purchase.notes || null,
    };

    const p_items = purchase.items.map(i => ({
      product_id: sanitizeUuid(i.productId),
      product_name: i.productName,
      quantity: i.quantity,
      purchase_price: i.purchasePrice,
      sale_price: (i as any).salePrice || 0,
      landed_cost_per_unit: i.landedCostPerUnit ?? i.purchasePrice,
      total: i.total,
    }));

    const { data, error } = await supabase.rpc('complete_purchase_transaction', {
      p_purchase,
      p_items,
    });

    if (error) throw error;
    return { success: true, purchaseId: data?.purchase_id };
  },

  async updatePurchase(
    purchaseId: string,
    purchase: Omit<Purchase, 'id' | 'date'>,
    businessId: string
  ): Promise<{ success: boolean; purchaseId?: string }> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase.rpc('update_purchase_transaction', {
      p_business_id: businessId,
      p_purchase_id: purchaseId,
      p_purchase: {
        supplier_id: sanitizeUuid(purchase.supplierId),
        supplier_name: purchase.supplierName,
        invoice_number: purchase.invoiceNumber,
        subtotal: purchase.subtotal,
        discount: purchase.discount || 0,
        transport_cost: purchase.transportCost || 0,
        loading_cost: purchase.loadingCost || 0,
        packaging_cost: purchase.packagingCost || 0,
        other_cost: purchase.otherCost || 0,
        total: purchase.total,
        paid: purchase.paid,
        due: purchase.due,
        payment_method: purchase.paymentMethod,
        notes: purchase.notes || null,
      },
      p_items: purchase.items.map(i => ({
        product_id: sanitizeUuid(i.productId),
        product_name: i.productName,
        quantity: i.quantity,
        purchase_price: i.purchasePrice,
        sale_price: (i as any).salePrice || 0,
        landed_cost_per_unit: i.landedCostPerUnit ?? i.purchasePrice,
        total: i.total,
      })),
    });
    if (error) throw error;
    return { success: true, purchaseId: data?.purchase_id || purchaseId };
  },

  async deletePurchase(purchaseId: string, businessId: string): Promise<boolean> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { error } = await supabase.rpc('delete_purchase_transaction', {
      p_business_id: businessId,
      p_purchase_id: purchaseId,
    });
    if (error) throw error;
    return true;
  },
};

export const branchService = {
  async fetchBranches(businessId: string): Promise<Branch[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('business_id', businessId)
      .order('is_main', { ascending: false });
    if (error) throw error;
    return (data || []).map((b: any) => ({
      id: b.id,
      name: b.name,
      location: b.location || '',
      mobile: b.mobile || '',
      isMain: Boolean(b.is_main),
    }));
  },

  async insertBranch(branch: Omit<Branch, 'id'>, businessId: string): Promise<Branch> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabase
      .from('branches')
      .insert({
        business_id: businessId,
        name: branch.name,
        location: branch.location,
        mobile: branch.mobile,
        is_main: Boolean(branch.isMain),
      })
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      name: data.name,
      location: data.location || '',
      mobile: data.mobile || '',
      isMain: Boolean(data.is_main),
    };
  },

  async updateBranch(id: string, updates: Partial<Branch>, businessId?: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    const payload: any = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.location !== undefined) payload.location = updates.location;
    if (updates.mobile !== undefined) payload.mobile = updates.mobile;
    if (updates.isMain !== undefined) payload.is_main = updates.isMain;
    let query = supabase.from('branches').update(payload).eq('id', id);
    if (businessId) query = query.eq('business_id', businessId);
    const { error } = await query;
    if (error) throw error;
  },

  async deleteBranch(id: string, businessId?: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase client is not configured.');
    let query = supabase.from('branches').delete().eq('id', id);
    if (businessId) query = query.eq('business_id', businessId);
    const { error } = await query;
    if (error) throw error;
  },
};
