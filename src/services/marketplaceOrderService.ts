import {
  ComboOffer,
  MarketplaceComboOrder,
  MarketplaceComboOrderStatus,
  Product,
} from '../types';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { comboOfferService } from './comboOfferService';

const STORAGE_KEY_MARKETPLACE_ORDERS = 'AMAR_DOKAN_MARKETPLACE_COMBO_ORDERS_V1';

const isTableOrSchemaMissing = (err: any): boolean => {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    code === 'PGRST204' ||
    msg.includes('marketplace_combo_orders') && (msg.includes('does not exist') || msg.includes('schema cache'))
  );
};

export const MARKETPLACE_STATUS_REQUIRES_DEDUCTION: MarketplaceComboOrderStatus[] = [
  'confirmed',
  'processing',
  'shipped',
  'delivered',
];

export const shouldDeductStockForTransition = (
  currentOrder: Pick<MarketplaceComboOrder, 'stockDeducted' | 'status'>,
  nextStatus: MarketplaceComboOrderStatus
): boolean => {
  if (currentOrder.stockDeducted) return false;
  return MARKETPLACE_STATUS_REQUIRES_DEDUCTION.includes(nextStatus);
};

export const generateMarketplaceOrderNumber = (): string => {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `MKT-${ymd}-${rand}`;
};

export const marketplaceOrderService = {
  readLocalOrders(businessId: string): MarketplaceComboOrder[] {
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY_MARKETPLACE_ORDERS}_${businessId}`);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  },

  writeLocalOrders(businessId: string, orders: MarketplaceComboOrder[]): void {
    try {
      localStorage.setItem(
        `${STORAGE_KEY_MARKETPLACE_ORDERS}_${businessId}`,
        JSON.stringify(orders)
      );
    } catch {}
  },

  async fetchOrders(businessId: string): Promise<MarketplaceComboOrder[]> {
    if (!businessId) return [];

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('marketplace_combo_orders')
          .select('*')
          .eq('business_id', businessId)
          .order('created_at', { ascending: false });

        if (error) {
          if (isTableOrSchemaMissing(error)) {
            return this.readLocalOrders(businessId);
          }
          throw error;
        }

        const mapped: MarketplaceComboOrder[] = (data || []).map((row: any) => ({
          id: row.id,
          orderNumber: row.order_number,
          businessId: row.business_id,
          branchId: row.branch_id || 'all',
          comboOfferId: row.combo_offer_id || '',
          comboOfferName: row.combo_offer_name,
          comboQuantity: Number(row.combo_quantity || 1),
          unitComboPrice: Number(row.unit_combo_price || 0),
          regularUnitTotal: Number(row.regular_unit_total || 0),
          discountAmount: Number(row.discount_amount || 0),
          totalAmount: Number(row.total_amount || 0),
          customerName: row.customer_name,
          customerPhone: row.customer_phone,
          customerAddress: row.customer_address,
          paymentMethod: row.payment_method || 'cash_on_delivery',
          paymentStatus: row.payment_status || 'unpaid',
          status: row.status || 'pending',
          stockDeducted: Boolean(row.stock_deducted),
          linkedSaleId: row.linked_sale_id || undefined,
          linkedInvoiceNumber: row.linked_invoice_number || undefined,
          notes: row.notes || undefined,
          orderSource: row.order_source || 'online_storefront',
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));

        this.writeLocalOrders(businessId, mapped);
        return mapped;
      } catch (err) {
        if (isTableOrSchemaMissing(err)) {
          return this.readLocalOrders(businessId);
        }
        throw err;
      }
    }

    return this.readLocalOrders(businessId);
  },

  validateOrderCapacity(
    offer: ComboOffer,
    products: Product[],
    comboQuantity: number,
    branchId?: string
  ): { valid: boolean; maxAvailable: number; error?: string } {
    if (offer.status !== 'active') {
      return { valid: false, maxAvailable: 0, error: 'This combo offer is not currently active.' };
    }
    const targetBranch =
      offer.branchId && offer.branchId !== 'all' ? offer.branchId : branchId;
    const fulfillment = comboOfferService.checkOfferFulfillment(
      offer,
      products,
      comboQuantity,
      targetBranch
    );
    if (!fulfillment.branchCompatible) {
      return {
        valid: false,
        maxAvailable: 0,
        error: 'This combo offer is restricted to a different branch.',
      };
    }
    if (!fulfillment.canFulfill || comboQuantity > fulfillment.maxCombos) {
      return {
        valid: false,
        maxAvailable: fulfillment.maxCombos,
        error: `Only ${fulfillment.maxCombos} combo pack(s) can be fulfilled with current live branch stock.`,
      };
    }
    return { valid: true, maxAvailable: fulfillment.maxCombos };
  },

  async saveOrder(
    order: MarketplaceComboOrder,
    businessId: string
  ): Promise<MarketplaceComboOrder> {
    const now = new Date().toISOString();
    const clean: MarketplaceComboOrder = {
      ...order,
      businessId,
      updatedAt: now,
    };

    if (businessId && isSupabaseConfigured) {
      const payload = {
        id: clean.id,
        order_number: clean.orderNumber,
        business_id: businessId,
        branch_id: clean.branchId || 'all',
        combo_offer_id: clean.comboOfferId || null,
        combo_offer_name: clean.comboOfferName,
        combo_quantity: clean.comboQuantity,
        unit_combo_price: clean.unitComboPrice,
        regular_unit_total: clean.regularUnitTotal,
        discount_amount: clean.discountAmount,
        total_amount: clean.totalAmount,
        customer_name: clean.customerName,
        customer_phone: clean.customerPhone,
        customer_address: clean.customerAddress,
        payment_method: clean.paymentMethod,
        payment_status: clean.paymentStatus,
        status: clean.status,
        stock_deducted: clean.stockDeducted,
        linked_sale_id: clean.linkedSaleId || null,
        linked_invoice_number: clean.linkedInvoiceNumber || null,
        notes: clean.notes || null,
        order_source: clean.orderSource,
        created_at: clean.createdAt,
        updated_at: now,
      };

      const { error } = await supabase.from('marketplace_combo_orders').upsert(payload);
      if (error && !isTableOrSchemaMissing(error)) {
        throw error;
      }
    }

    const existing = this.readLocalOrders(businessId);
    const idx = existing.findIndex(o => o.id === clean.id);
    const next =
      idx > -1
        ? existing.map(o => (o.id === clean.id ? clean : o))
        : [clean, ...existing];
    this.writeLocalOrders(businessId, next);
    return clean;
  },
};
