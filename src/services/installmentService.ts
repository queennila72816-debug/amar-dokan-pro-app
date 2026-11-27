import { supabase, isSupabaseConfigured, sanitizeUuid, isValidUuid } from '../lib/supabase';
import {
  InstallmentAgreement,
  InstallmentPaymentRecord,
  PaymentMethod,
} from '../types';
import {
  recomputeAgreementFromPayments,
  roundMoney,
} from '../utils/installmentUtils';

const AGREEMENTS_LOCAL_PREFIX = 'AMAR_DOKAN_PRO_INSTALLMENT_AGREEMENTS_V1_';
const PAYMENTS_LOCAL_PREFIX = 'AMAR_DOKAN_PRO_INSTALLMENT_PAYMENTS_V1_';

function isMissingInstallmentSchemaError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('installment_agreements') ||
    msg.includes('installment_payments') ||
    msg.includes('collect_installment_payment') ||
    msg.includes('reverse_installment_payment') ||
    msg.includes('schema cache')
  );
}

function readLocalAgreements(businessId: string): InstallmentAgreement[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(`${AGREEMENTS_LOCAL_PREFIX}${businessId || 'default'}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLocalAgreements(businessId: string, rows: InstallmentAgreement[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`${AGREEMENTS_LOCAL_PREFIX}${businessId || 'default'}`, JSON.stringify(rows));
  } catch {
    // ignore storage quota edge cases
  }
}

function readLocalPayments(businessId: string): InstallmentPaymentRecord[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(`${PAYMENTS_LOCAL_PREFIX}${businessId || 'default'}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLocalPayments(businessId: string, rows: InstallmentPaymentRecord[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`${PAYMENTS_LOCAL_PREFIX}${businessId || 'default'}`, JSON.stringify(rows));
  } catch {
    // ignore
  }
}

function mapDbAgreement(row: any): InstallmentAgreement {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id || '',
    agreementCode: row.agreement_code,
    customerId: row.customer_id,
    customerCode: row.customer_code || undefined,
    customerName: row.customer_name,
    customerMobile: row.customer_mobile,
    customerAddress: row.customer_address || undefined,
    customerPhotoUrl: row.customer_photo_url || undefined,
    customerNidNumber: row.customer_nid_number || undefined,
    hasIdentityDocuments: Boolean(row.has_identity_documents),
    saleId: row.sale_id || undefined,
    invoiceNumber: row.invoice_number || undefined,
    items: Array.isArray(row.items) ? row.items : [],
    totalPurchaseAmount: Number(row.total_purchase_amount || 0),
    downPayment: Number(row.down_payment || 0),
    installmentBalance: Number(row.installment_balance || 0),
    durationMonths: Number(row.duration_months || 1) as InstallmentAgreement['durationMonths'],
    monthlyInstallment: Number(row.monthly_installment || 0),
    firstDueDate: String(row.first_due_date || '').slice(0, 10),
    agreementDate: String(row.agreement_date || row.created_at || '').slice(0, 10),
    installmentsPaid: Number(row.installments_paid || 0),
    totalPaidAmount: Number(row.total_paid_amount || 0),
    remainingDue: Number(row.remaining_due || 0),
    lastPaymentDate: row.last_payment_date ? String(row.last_payment_date).slice(0, 10) : undefined,
    nextDueDate: row.next_due_date ? String(row.next_due_date).slice(0, 10) : undefined,
    overdueAmount: 0,
    status: row.status || 'unpaid',
    schedule: Array.isArray(row.schedule) ? row.schedule : [],
    notes: row.notes || undefined,
    createdBy: row.created_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

function mapDbPayment(row: any): InstallmentPaymentRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    agreementId: row.agreement_id,
    agreementCode: row.agreement_code,
    customerId: row.customer_id,
    customerName: row.customer_name,
    paymentDate: String(row.payment_date || '').slice(0, 10),
    amount: Number(row.amount || 0),
    paymentMethod: (row.payment_method || 'cash') as PaymentMethod,
    accountId: row.account_id || '',
    accountName: row.account_name || undefined,
    receiptNumber: row.receipt_number,
    collectedBy: row.collected_by,
    remarks: row.remarks || undefined,
    clientTxId: row.client_tx_id || undefined,
    status: row.status === 'reversed' ? 'reversed' : 'posted',
    reversedAt: row.reversed_at || undefined,
    reversedBy: row.reversed_by || undefined,
    reversalReason: row.reversal_reason || undefined,
    createdAt: row.created_at,
  };
}

export const installmentService = {
  async fetchAll(
    businessId: string
  ): Promise<{ agreements: InstallmentAgreement[]; payments: InstallmentPaymentRecord[] }> {
    const biz = businessId || 'default';
    if (!isSupabaseConfigured || !isValidUuid(biz)) {
      const payments = readLocalPayments(biz);
      const agreements = readLocalAgreements(biz).map(a =>
        recomputeAgreementFromPayments(a, payments)
      );
      return { agreements, payments };
    }

    try {
      const [agrRes, payRes] = await Promise.all([
        supabase
          .from('installment_agreements')
          .select('*')
          .eq('business_id', biz)
          .order('created_at', { ascending: false }),
        supabase
          .from('installment_payments')
          .select('*')
          .eq('business_id', biz)
          .order('created_at', { ascending: false }),
      ]);

      if (agrRes.error) throw agrRes.error;
      if (payRes.error) throw payRes.error;

      const dbPayments = (payRes.data || []).map(mapDbPayment);
      const dbAgreements = (agrRes.data || []).map(mapDbAgreement).map(a =>
        recomputeAgreementFromPayments(a, dbPayments)
      );

      // Merge any local fallback records not yet in DB (e.g. created while migration pending)
      const localAgreements = readLocalAgreements(biz);
      const localPayments = readLocalPayments(biz);
      const dbAgrIds = new Set(dbAgreements.map(a => a.id));
      const dbPayIds = new Set(dbPayments.map(p => p.id));

      const mergedPayments = [
        ...dbPayments,
        ...localPayments.filter(p => !dbPayIds.has(p.id)),
      ];
      const mergedAgreements = [
        ...dbAgreements,
        ...localAgreements.filter(a => !dbAgrIds.has(a.id)),
      ].map(a => recomputeAgreementFromPayments(a, mergedPayments));

      return { agreements: mergedAgreements, payments: mergedPayments };
    } catch (err) {
      if (isMissingInstallmentSchemaError(err)) {
        const payments = readLocalPayments(biz);
        const agreements = readLocalAgreements(biz).map(a =>
          recomputeAgreementFromPayments(a, payments)
        );
        return { agreements, payments };
      }
      throw err;
    }
  },

  async createAgreement(
    agreement: InstallmentAgreement,
    businessId: string
  ): Promise<InstallmentAgreement> {
    const biz = businessId || 'default';
    if (!isSupabaseConfigured || !isValidUuid(biz)) {
      const existing = readLocalAgreements(biz);
      const next = [agreement, ...existing.filter(a => a.id !== agreement.id)];
      writeLocalAgreements(biz, next);
      return agreement;
    }

    try {
      const payload = {
        business_id: biz,
        branch_id: sanitizeUuid(agreement.branchId),
        agreement_code: agreement.agreementCode,
        customer_id: sanitizeUuid(agreement.customerId),
        customer_code: agreement.customerCode || null,
        customer_name: agreement.customerName,
        customer_mobile: agreement.customerMobile,
        customer_address: agreement.customerAddress || null,
        customer_photo_url: agreement.customerPhotoUrl || null,
        customer_nid_number: agreement.customerNidNumber || null,
        has_identity_documents: Boolean(agreement.hasIdentityDocuments),
        sale_id: sanitizeUuid(agreement.saleId),
        invoice_number: agreement.invoiceNumber || null,
        items: agreement.items,
        total_purchase_amount: roundMoney(agreement.totalPurchaseAmount),
        down_payment: roundMoney(agreement.downPayment),
        installment_balance: roundMoney(agreement.installmentBalance),
        duration_months: agreement.durationMonths,
        monthly_installment: roundMoney(agreement.monthlyInstallment),
        first_due_date: agreement.firstDueDate.slice(0, 10),
        agreement_date: agreement.agreementDate.slice(0, 10),
        installments_paid: roundMoney(agreement.installmentsPaid),
        total_paid_amount: roundMoney(agreement.totalPaidAmount),
        remaining_due: roundMoney(agreement.remainingDue),
        last_payment_date: agreement.lastPaymentDate || null,
        next_due_date: agreement.nextDueDate || null,
        status: agreement.status,
        schedule: agreement.schedule,
        notes: agreement.notes || null,
        created_by: agreement.createdBy || null,
      };

      const { data, error } = await supabase
        .from('installment_agreements')
        .insert(payload)
        .select()
        .single();

      if (error) throw error;
      return recomputeAgreementFromPayments(mapDbAgreement(data), []);
    } catch (err) {
      if (isMissingInstallmentSchemaError(err)) {
        const existing = readLocalAgreements(biz);
        const next = [agreement, ...existing.filter(a => a.id !== agreement.id)];
        writeLocalAgreements(biz, next);
        return agreement;
      }
      throw err;
    }
  },

  async collectPayment(
    input: {
      agreement: InstallmentAgreement;
      paymentDate: string;
      amount: number;
      paymentMethod: PaymentMethod;
      accountId: string;
      accountName?: string;
      receiptNumber: string;
      collectedBy: string;
      remarks?: string;
      clientTxId?: string;
    },
    businessId: string
  ): Promise<{ usedCloudRpc: boolean; payment?: InstallmentPaymentRecord }> {
    const biz = businessId || 'default';
    if (!isSupabaseConfigured || !isValidUuid(biz) || !isValidUuid(input.agreement.id)) {
      const payment: InstallmentPaymentRecord = {
        id: `inspay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        businessId: biz,
        agreementId: input.agreement.id,
        agreementCode: input.agreement.agreementCode,
        customerId: input.agreement.customerId,
        customerName: input.agreement.customerName,
        paymentDate: input.paymentDate.slice(0, 10),
        amount: roundMoney(input.amount),
        paymentMethod: input.paymentMethod,
        accountId: input.accountId,
        accountName: input.accountName,
        receiptNumber: input.receiptNumber,
        collectedBy: input.collectedBy,
        remarks: input.remarks,
        clientTxId: input.clientTxId,
        status: 'posted',
        createdAt: new Date().toISOString(),
      };
      const existingPayments = readLocalPayments(biz);
      writeLocalPayments(biz, [payment, ...existingPayments]);

      const updatedAgreements = readLocalAgreements(biz).map(a =>
        a.id === input.agreement.id
          ? recomputeAgreementFromPayments(a, [payment, ...existingPayments])
          : a
      );
      writeLocalAgreements(biz, updatedAgreements);
      return { usedCloudRpc: false, payment };
    }

    try {
      const { error } = await supabase.rpc('collect_installment_payment', {
        p_business_id: biz,
        p_agreement_id: input.agreement.id,
        p_payment_date: input.paymentDate.slice(0, 10),
        p_amount: roundMoney(input.amount),
        p_payment_method: input.paymentMethod,
        p_account_id: sanitizeUuid(input.accountId),
        p_receipt_number: input.receiptNumber,
        p_collected_by: input.collectedBy,
        p_remarks: input.remarks || null,
        p_client_tx_id: input.clientTxId || null,
      });
      if (error) throw error;
      return { usedCloudRpc: true };
    } catch (err) {
      if (isMissingInstallmentSchemaError(err)) {
        const payment: InstallmentPaymentRecord = {
          id: `inspay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          businessId: biz,
          agreementId: input.agreement.id,
          agreementCode: input.agreement.agreementCode,
          customerId: input.agreement.customerId,
          customerName: input.agreement.customerName,
          paymentDate: input.paymentDate.slice(0, 10),
          amount: roundMoney(input.amount),
          paymentMethod: input.paymentMethod,
          accountId: input.accountId,
          accountName: input.accountName,
          receiptNumber: input.receiptNumber,
          collectedBy: input.collectedBy,
          remarks: input.remarks,
          clientTxId: input.clientTxId,
          status: 'posted',
          createdAt: new Date().toISOString(),
        };
        const existingPayments = readLocalPayments(biz);
        writeLocalPayments(biz, [payment, ...existingPayments]);
        const updatedAgreements = readLocalAgreements(biz).map(a =>
          a.id === input.agreement.id
            ? recomputeAgreementFromPayments(a, [payment, ...existingPayments])
            : a
        );
        writeLocalAgreements(biz, updatedAgreements);
        return { usedCloudRpc: false, payment };
      }
      throw err;
    }
  },

  async reversePayment(
    payment: InstallmentPaymentRecord,
    reversedBy: string,
    reason: string,
    businessId: string
  ): Promise<{ usedCloudRpc: boolean }> {
    const biz = businessId || 'default';
    if (!isSupabaseConfigured || !isValidUuid(biz) || !isValidUuid(payment.id)) {
      const existingPayments = readLocalPayments(biz);
      const nextPayments: InstallmentPaymentRecord[] = existingPayments.map(p =>
        p.id === payment.id
          ? {
              ...p,
              status: 'reversed',
              reversedAt: new Date().toISOString(),
              reversedBy,
              reversalReason: reason,
            }
          : p
      );
      writeLocalPayments(biz, nextPayments);
      const nextAgreements = readLocalAgreements(biz).map(a =>
        a.id === payment.agreementId
          ? recomputeAgreementFromPayments(a, nextPayments)
          : a
      );
      writeLocalAgreements(biz, nextAgreements);
      return { usedCloudRpc: false };
    }

    try {
      const { error } = await supabase.rpc('reverse_installment_payment', {
        p_business_id: biz,
        p_payment_id: payment.id,
        p_reversed_by: reversedBy,
        p_reason: reason,
      });
      if (error) throw error;
      return { usedCloudRpc: true };
    } catch (err) {
      if (isMissingInstallmentSchemaError(err)) {
        const existingPayments = readLocalPayments(biz);
        const nextPayments: InstallmentPaymentRecord[] = existingPayments.map(p =>
          p.id === payment.id
            ? {
                ...p,
                status: 'reversed',
                reversedAt: new Date().toISOString(),
                reversedBy,
                reversalReason: reason,
              }
            : p
        );
        writeLocalPayments(biz, nextPayments);
        const nextAgreements = readLocalAgreements(biz).map(a =>
          a.id === payment.agreementId
            ? recomputeAgreementFromPayments(a, nextPayments)
            : a
        );
        writeLocalAgreements(biz, nextAgreements);
        return { usedCloudRpc: false };
      }
      throw err;
    }
  },

  saveLocalSnapshot(
    businessId: string,
    agreements: InstallmentAgreement[],
    payments: InstallmentPaymentRecord[]
  ): void {
    const biz = businessId || 'default';
    writeLocalAgreements(biz, agreements);
    writeLocalPayments(biz, payments);
  },
};
