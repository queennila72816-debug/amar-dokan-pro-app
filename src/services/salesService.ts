import { supabase, isSupabaseConfigured, sanitizeUuid } from '../lib/supabase';
import { Sale, SaleReturn } from '../types';

export const salesService = {
  async completeSale(
    sale: Sale,
    businessId: string
  ): Promise<{ success: boolean; saleId?: string; invoiceNumber?: string }> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const { data, error } = await supabase.rpc('complete_sale_transaction', {
      p_sale: {
        business_id: businessId,
        branch_id: sanitizeUuid(sale.branchId),
        invoice_number: sale.invoiceNumber,
        customer_id: sanitizeUuid(sale.customerId),
        customer_name: sale.customerName,
        customer_mobile: sale.customerMobile || null,
        subtotal: sale.subtotal,
        discount: sale.discount,
        combo_discount: sale.comboDiscount || 0,
        applied_offers: sale.appliedOffers || [],
        vat_tax_rate: sale.vatTaxRate,
        vat_tax_amount: sale.vatTaxAmount,
        total: sale.total,
        paid: sale.paid,
        due: sale.due,
        payment_method: sale.paymentMethod,
        status: sale.status,
        served_by: sale.servedBy,
        employee_id: sanitizeUuid(sale.employeeId),
        employee_code: sale.employeeCode || null,
        employee_name: sale.employeeName || sale.sellerName || sale.servedBy || 'Staff',
        seller_id: sanitizeUuid(sale.sellerId),
        seller_name: sale.sellerName || sale.employeeName || sale.servedBy || 'Staff',
        notes: sale.notes || null,
      },
      p_items: sale.items.map(i => ({
        product_id: sanitizeUuid(i.productId),
        variant_id: sanitizeUuid(i.variantId),
        product_name: i.productName,
        sku: i.sku,
        variant_details: i.variantDetails || null,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        purchase_price: i.purchasePrice,
        discount: i.discount,
        total: i.total,
        combo_offer_id: i.comboOfferId || null,
        combo_offer_name: i.comboOfferName || null,
        is_free_item: Boolean(i.isFreeItem),
      })),
      p_payments: sale.payments.map(p => ({
        account_id: sanitizeUuid(p.accountId),
        payment_method: p.method,
        amount: p.amount,
        trx_id: p.trxId || null,
      })),
    });

    if (error) {
      throw error;
    }

    return {
      success: true,
      saleId: data?.sale_id || sale.id,
      invoiceNumber: data?.invoice_number || sale.invoiceNumber,
    };
  },

  async refundSale(
    saleId: string,
    refundData: { amount: number; reason: string },
    businessId: string
  ): Promise<boolean> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const { error } = await supabase.rpc('refund_or_void_sale_transaction', {
      p_business_id: businessId,
      p_sale_id: saleId,
      p_status: 'returned',
      p_reason: refundData.reason || 'Full Refund',
    });

    if (error) throw error;
    return true;
  },

  async voidSale(saleId: string, reason: string, businessId: string): Promise<boolean> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const { error } = await supabase.rpc('refund_or_void_sale_transaction', {
      p_business_id: businessId,
      p_sale_id: saleId,
      p_status: 'voided',
      p_reason: reason || 'Sale voided',
    });

    if (error) throw error;
    return true;
  },

  async recordPartialReturn(
    saleId: string,
    items: SaleReturn['items'],
    refundType: 'cash' | 'adjust_due',
    businessId: string
  ): Promise<boolean> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const { error } = await supabase.rpc('record_partial_sale_return', {
      p_business_id: businessId,
      p_sale_id: saleId,
      p_items: items.map(it => ({
        product_id: sanitizeUuid(it.productId),
        product_name: it.productName,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        total_refund: it.totalRefund,
        reason: it.reason,
      })),
      p_refund_type: refundType,
    });

    if (error) throw error;
    return true;
  },

  async deleteSale(saleId: string, businessId: string): Promise<boolean> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const { error } = await supabase.rpc('delete_sale_transaction', {
      p_business_id: businessId,
      p_sale_id: saleId,
    });

    if (error) throw error;
    return true;
  },

  async fetchSaleReturns(businessId: string): Promise<SaleReturn[]> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const { data, error } = await supabase
      .from('sale_returns')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((r: any) => ({
      id: r.id,
      saleId: r.sale_id,
      invoiceNumber: r.invoice_number,
      date: r.created_at,
      customerId: r.customer_id || undefined,
      customerName: r.customer_name || 'Walk-in Customer',
      items: Array.isArray(r.items)
        ? r.items.map((it: any) => ({
            productId: it.product_id || it.productId,
            productName: it.product_name || it.productName,
            quantity: Number(it.quantity || 0),
            unitPrice: Number(it.unit_price ?? it.unitPrice ?? 0),
            totalRefund: Number(it.total_refund ?? it.totalRefund ?? 0),
            reason: it.reason || 'Returned',
          }))
        : [],
      totalRefundAmount: Number(r.total_refund_amount || 0),
      refundType: r.refund_type === 'adjust_due' ? 'adjust_due' : 'cash',
    }));
  },

  async fetchSales(businessId?: string): Promise<Sale[]> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    let query = supabase
      .from('sales')
      .select('*, sale_items(*), sale_payments(*)')
      .order('created_at', { ascending: false });

    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((s: any) => ({
      id: s.id,
      invoiceNumber: s.invoice_number,
      date: s.created_at,
      customerId: s.customer_id || undefined,
      customerName: s.customer_name,
      customerMobile: s.customer_mobile || undefined,
      items: (s.sale_items || []).map((i: any) => ({
        productId: i.product_id,
        productName: i.product_name,
        sku: i.sku,
        unitPrice: Number(i.unit_price),
        purchasePrice: Number(i.purchase_price),
        quantity: Number(i.quantity),
        discount: Number(i.discount || 0),
        total: Number(i.total),
        variantId: i.variant_id || undefined,
        variantDetails: i.variant_details || undefined,
        comboOfferId: i.combo_offer_id || undefined,
        comboOfferName: i.combo_offer_name || undefined,
        isFreeItem: Boolean(i.is_free_item),
      })),
      subtotal: Number(s.subtotal),
      discount: Number(s.discount || 0),
      comboDiscount: Number(s.combo_discount || 0),
      appliedOffers: Array.isArray(s.applied_offers) ? s.applied_offers : undefined,
      vatTaxRate: Number(s.vat_tax_rate || 0),
      vatTaxAmount: Number(s.vat_tax_amount || 0),
      total: Number(s.total),
      paid: Number(s.paid),
      due: Number(s.due),
      paymentMethod: s.payment_method,
      payments: (s.sale_payments || []).map((p: any) => ({
        method: p.payment_method,
        amount: Number(p.amount),
        accountId: p.account_id || undefined,
        trxId: p.trx_id || undefined,
      })),
      servedBy: s.served_by || s.employee_name || s.seller_name || 'Staff',
      employeeId: s.employee_id || undefined,
      employeeCode: s.employee_code || undefined,
      employeeName: s.employee_name || s.seller_name || s.served_by || 'Staff',
      sellerId: s.seller_id || undefined,
      sellerName: s.seller_name || s.employee_name || s.served_by || 'Staff',
      branchId: s.branch_id,
      status: s.status,
      notes: s.notes || undefined,
      refundedAmount: s.refunded_amount != null ? Number(s.refunded_amount) : undefined,
      refundReason: s.refund_reason || undefined,
      refundedAt: s.refunded_at || undefined,
    }));
  },
};
