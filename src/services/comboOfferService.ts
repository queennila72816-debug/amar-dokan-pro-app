import { ComboOffer, ComboOfferItem, Product, ProductVariant, SaleItem } from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const STORAGE_KEY_OFFERS = 'AMAR_DOKAN_COMBO_OFFERS_V1';
const STORAGE_KEY_USAGE = 'AMAR_DOKAN_COMBO_USAGE_V1';

export interface ComboPnLCalculation {
  regularTotalPrice: number;
  discountAmount: number;
  finalComboPrice: number;
  totalCostOfGoods: number;
  allocatedOpEx: number;
  grossProfit: number;
  estimatedNetProfit: number;
  profitMarginPercent: number;
  minSafeSellingPrice: number;
  isLossMaking: boolean;
}

export interface ComboFulfillmentStatus {
  canFulfill: boolean;
  maxCombos: number;
  itemStatuses: {
    productId: string;
    productName: string;
    variantDetails?: string;
    requiredQty: number;
    availableStock: number;
    isAvailable: boolean;
  }[];
}

export interface DetectedOfferMatch {
  offer: ComboOffer;
  discountAmount: number;
  description: string;
  isPartialMatch: boolean;
  missingItems?: {
    productId: string;
    productName: string;
    variantId?: string;
    variantDetails?: string;
    neededQty: number;
  }[];
}

export const comboOfferService = {
  /**
   * Calculate precise Profit & Loss for any combo offer
   * Ensures free items in Buy X Get Y include their real inventory landed cost!
   */
  calculateComboPnL(
    items: ComboOfferItem[],
    discountType: ComboOffer['discountType'],
    discountValue: number,
    products: Product[],
    operatingBudgetPercent: number = 0.05
  ): ComboPnLCalculation {
    let regularTotalPrice = 0;
    let totalCostOfGoods = 0;
    let allocatedOpEx = 0;

    items.forEach(item => {
      const prod = products.find(p => p.id === item.productId);
      const variant = item.variantId && prod?.variants
        ? prod.variants.find(v => v.id === item.variantId)
        : undefined;

      const unitSalePrice = variant?.salePrice !== undefined
        ? variant.salePrice
        : (item.salePrice !== undefined ? item.salePrice : (prod?.salePrice || 0));

      const unitCost = variant?.purchasePrice !== undefined
        ? variant.purchasePrice
        : (item.purchasePrice !== undefined ? item.purchasePrice : (prod?.totalUnitCost || prod?.purchasePrice || 0));

      const unitOpEx = prod?.allocatedOpExPerUnit || (unitCost * operatingBudgetPercent);

      regularTotalPrice += unitSalePrice * item.quantity;
      totalCostOfGoods += unitCost * item.quantity;
      allocatedOpEx += unitOpEx * item.quantity;
    });

    let discountAmount = 0;
    let finalComboPrice = regularTotalPrice;

    if (discountType === 'fixed_bundle_price') {
      finalComboPrice = Math.max(0, discountValue);
      discountAmount = Math.max(0, regularTotalPrice - finalComboPrice);
    } else if (discountType === 'percentage') {
      const pct = Math.min(100, Math.max(0, discountValue));
      discountAmount = Math.round((regularTotalPrice * pct) / 100);
      finalComboPrice = Math.max(0, regularTotalPrice - discountAmount);
    } else if (discountType === 'fixed_discount') {
      discountAmount = Math.min(regularTotalPrice, Math.max(0, discountValue));
      finalComboPrice = Math.max(0, regularTotalPrice - discountAmount);
    } else if (discountType === 'free_item') {
      // Find the items flagged as free
      const freeItemsValue = items
        .filter(i => i.isFree)
        .reduce((sum, i) => {
          const prod = products.find(p => p.id === i.productId);
          const v = (i.variantId && prod?.variants) ? prod.variants.find(x => x.id === i.variantId) : undefined;
          const price = v?.salePrice !== undefined ? v.salePrice : (prod?.salePrice || 0);
          return sum + price * i.quantity;
        }, 0);

      discountAmount = freeItemsValue;
      finalComboPrice = Math.max(0, regularTotalPrice - discountAmount);
    }

    const minSafeSellingPrice = totalCostOfGoods + allocatedOpEx;
    const grossProfit = finalComboPrice - totalCostOfGoods;
    // Estimated net profit considers allocated shop operating expenses
    const estimatedNetProfit = grossProfit - allocatedOpEx;
    const profitMarginPercent = finalComboPrice > 0
      ? Math.round((grossProfit / finalComboPrice) * 100)
      : 0;

    const isLossMaking = finalComboPrice < minSafeSellingPrice || grossProfit < 0;

    return {
      regularTotalPrice,
      discountAmount,
      finalComboPrice,
      totalCostOfGoods,
      allocatedOpEx,
      grossProfit,
      estimatedNetProfit,
      profitMarginPercent,
      minSafeSellingPrice,
      isLossMaking,
    };
  },

  /**
   * Check whether all required variants and products have sufficient inventory stock
   */
  checkOfferFulfillment(offer: ComboOffer, products: Product[]): ComboFulfillmentStatus {
    const itemStatuses = offer.items.map(item => {
      const prod = products.find(p => p.id === item.productId);
      const variant = item.variantId && prod?.variants
        ? prod.variants.find(v => v.id === item.variantId)
        : undefined;

      const availableStock = variant !== undefined ? variant.stock : (prod?.currentStock || 0);
      const isAvailable = availableStock >= item.quantity;

      return {
        productId: item.productId,
        productName: item.productName || prod?.name || 'Item',
        variantDetails: item.variantDetails,
        requiredQty: item.quantity,
        availableStock,
        isAvailable,
      };
    });

    const canFulfill = itemStatuses.every(i => i.isAvailable);

    // Calculate maximum combos fulfillable
    const maxCombos = itemStatuses.length > 0
      ? Math.min(...itemStatuses.map(i => Math.floor(i.availableStock / Math.max(1, i.requiredQty))))
      : 0;

    return {
      canFulfill,
      maxCombos,
      itemStatuses,
    };
  },

  /**
   * Detect applicable active offers based on items currently inside the POS cart
   */
  detectApplicableOffers(
    cart: SaleItem[],
    offers: ComboOffer[],
    currentBranchId?: string,
    customerId?: string,
    products?: Product[]
  ): DetectedOfferMatch[] {
    const activeOffers = offers.filter(o => {
      if (o.status !== 'active') return false;
      if (o.branchId && o.branchId !== 'all' && currentBranchId && o.branchId !== currentBranchId) return false;

      // Date check (treat date-only YYYY-MM-DD bounds as full local days)
      const now = new Date();
      if (o.startDate) {
        const start = /^\d{4}-\d{2}-\d{2}$/.test(o.startDate)
          ? new Date(`${o.startDate}T00:00:00`)
          : new Date(o.startDate);
        if (!Number.isNaN(start.getTime()) && start > now) return false;
      }
      if (o.endDate) {
        const end = /^\d{4}-\d{2}-\d{2}$/.test(o.endDate)
          ? new Date(`${o.endDate}T23:59:59.999`)
          : new Date(o.endDate);
        if (!Number.isNaN(end.getTime()) && end < now) return false;
      }

      // Usage limit check
      if (o.maxUsageLimit && o.usageCount >= o.maxUsageLimit) return false;

      return true;
    });

    // Sort by priority rank (highest first), then by final discount
    activeOffers.sort((a, b) => b.priorityRank - a.priorityRank);

    const matches: DetectedOfferMatch[] = [];
    const cartSubtotal = cart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);

    activeOffers.forEach(offer => {
      // 1. Spend & Save
      if (offer.offerType === 'spend_and_save') {
        const threshold = offer.minSpendAmount || 0;
        if (cartSubtotal >= threshold) {
          matches.push({
            offer,
            discountAmount: offer.discountValue,
            description: `Spend ৳${threshold} & Save ৳${offer.discountValue}`,
            isPartialMatch: false,
          });
        }
        return;
      }

      // 2. Quantity Discount
      if (offer.offerType === 'quantity_discount') {
        const targetItem = offer.items[0];
        const minQty = offer.minPurchaseQuantity || 3;
        const matchingCartItems = cart.filter(ci => {
          if (targetItem?.productId && ci.productId !== targetItem.productId) return false;
          if (targetItem?.variantId && ci.variantId !== targetItem.variantId) return false;
          return true;
        });
        const totalQtyInCart = matchingCartItems.reduce((s, ci) => s + ci.quantity, 0);

        if (totalQtyInCart >= minQty) {
          const discount = offer.discountType === 'percentage'
            ? Math.round((matchingCartItems.reduce((s, ci) => s + ci.total, 0) * offer.discountValue) / 100)
            : offer.discountValue;

          matches.push({
            offer,
            discountAmount: discount,
            description: `Buy ${minQty}+ ${targetItem?.productName || 'Items'} - Save ৳${discount}`,
            isPartialMatch: false,
          });
        }
        return;
      }

      // 3. Category Bundle
      if (offer.offerType === 'category_bundle' && offer.targetCategoryIds && offer.targetCategoryIds.length > 0) {
        // Check if cart contains items from every required category
        const presentCategories = new Set(
          cart
            .map(c => c.category || products?.find(p => p.id === c.productId)?.category || '')
            .filter(Boolean)
        );
        const hasAllCats = offer.targetCategoryIds.every(cid => presentCategories.has(cid));

        if (hasAllCats) {
          matches.push({
            offer,
            discountAmount: offer.discountValue,
            description: `Category Bundle Discount Applied: Save ৳${offer.discountValue}`,
            isPartialMatch: false,
          });
        }
        return;
      }

      // 4. Fixed Price Combo / Buy X Get Y / Buy X Get Discount
      // Check items requirement
      let fullyMatches = true;
      const missingItems: DetectedOfferMatch['missingItems'] = [];

      offer.items.forEach(req => {
        const cartItem = cart.find(ci => {
          if (ci.productId !== req.productId) return false;
          if (req.variantId && ci.variantId !== req.variantId) return false;
          return true;
        });

        const inCartQty = cartItem ? cartItem.quantity : 0;
        if (inCartQty < req.quantity) {
          fullyMatches = false;
          missingItems.push({
            productId: req.productId,
            productName: req.productName,
            variantId: req.variantId,
            variantDetails: req.variantDetails,
            neededQty: req.quantity - inCartQty,
          });
        }
      });

      if (fullyMatches) {
        // Calculate exact discount
        let disc = 0;
        if (offer.discountType === 'fixed_bundle_price') {
          disc = Math.max(0, offer.regularTotalPrice - offer.finalComboPrice);
        } else if (offer.discountType === 'percentage') {
          disc = Math.round((offer.regularTotalPrice * offer.discountValue) / 100);
        } else {
          disc = offer.discountValue;
        }

        matches.push({
          offer,
          discountAmount: disc,
          description: `${offer.name} (Save ৳${disc})`,
          isPartialMatch: false,
        });
      } else if (missingItems.length === 1 && missingItems[0].neededQty <= 2) {
        // Near-match suggestion to help sellers upsell!
        matches.push({
          offer,
          discountAmount: 0,
          description: `Add ${missingItems[0].neededQty}x ${missingItems[0].productName} (${missingItems[0].variantDetails || 'Std'}) to unlock '${offer.name}'!`,
          isPartialMatch: true,
          missingItems,
        });
      }
    });

    return matches;
  },

  /**
   * Fetch combo offers with Supabase (or localStorage only when unconfigured)
   */
  async fetchOffers(businessId: string): Promise<ComboOffer[]> {
    if (businessId && isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('combo_offers')
        .select('*, combo_offer_items(*)')
        .eq('business_id', businessId)
        .order('priority_rank', { ascending: false });

      if (error) throw error;

      const mapped = (data || []).map((o: any) => ({
        id: o.id,
        name: o.name,
        description: o.description || undefined,
        image: o.image || undefined,
        offerType: o.offer_type,
        items: (o.combo_offer_items || []).map((i: any) => ({
          id: i.id,
          productId: i.product_id,
          productName: i.product_name,
          variantId: i.variant_id || undefined,
          variantDetails: i.variant_details || undefined,
          sku: i.sku || undefined,
          quantity: i.quantity,
          isFree: Boolean(i.is_free),
          purchasePrice: i.purchase_price,
          salePrice: i.sale_price,
        })),
        minSpendAmount: o.min_spend_amount || undefined,
        minPurchaseQuantity: o.min_purchase_quantity || undefined,
        regularTotalPrice: Number(o.regular_total_price || 0),
        discountType: o.discount_type,
        discountValue: Number(o.discount_value || 0),
        finalComboPrice: Number(o.final_combo_price || 0),
        totalCostOfGoods: Number(o.total_cost_of_goods || 0),
        allocatedOpEx: Number(o.allocated_opex || 0),
        grossProfit: Number(o.gross_profit || 0),
        estimatedNetProfit: Number(o.estimated_net_profit || 0),
        profitMarginPercent: Number(o.profit_margin_percent || 0),
        isLossMaking: Boolean(o.is_loss_making),
        minSafeSellingPrice: Number(o.min_safe_selling_price || 0),
        lossOverrideReason: o.loss_override_reason || undefined,
        lossApprovedBy: o.loss_approved_by || undefined,
        startDate: o.start_date,
        endDate: o.end_date || undefined,
        status: o.status,
        maxUsageLimit: o.max_usage_limit || undefined,
        usageCount: Number(o.usage_count || 0),
        perCustomerLimit: o.per_customer_limit || undefined,
        branchId: o.branch_id || 'all',
        priorityRank: Number(o.priority_rank || 1),
        businessId: o.business_id,
        createdAt: o.created_at,
        updatedAt: o.updated_at,
      }));

      try {
        localStorage.setItem(`${STORAGE_KEY_OFFERS}_${businessId}`, JSON.stringify(mapped));
      } catch {}
      return mapped;
    }

    try {
      const saved = localStorage.getItem(`${STORAGE_KEY_OFFERS}_${businessId}`);
      if (saved) return JSON.parse(saved);
    } catch {}

    return [];
  },

  /**
   * Save or update offer
   */
  async saveOffer(offer: ComboOffer, businessId: string): Promise<ComboOffer> {
    const now = new Date().toISOString();
    const updatedOffer: ComboOffer = {
      ...offer,
      businessId,
      updatedAt: now,
    };

    if (businessId && isSupabaseConfigured) {
      const { error: upsertErr } = await supabase.from('combo_offers').upsert({
        id: updatedOffer.id,
        business_id: businessId,
        name: updatedOffer.name,
        description: updatedOffer.description || null,
        image: updatedOffer.image || null,
        offer_type: updatedOffer.offerType,
        min_spend_amount: updatedOffer.minSpendAmount || null,
        min_purchase_quantity: updatedOffer.minPurchaseQuantity || null,
        regular_total_price: updatedOffer.regularTotalPrice,
        discount_type: updatedOffer.discountType,
        discount_value: updatedOffer.discountValue,
        final_combo_price: updatedOffer.finalComboPrice,
        total_cost_of_goods: updatedOffer.totalCostOfGoods,
        allocated_opex: updatedOffer.allocatedOpEx,
        gross_profit: updatedOffer.grossProfit,
        estimated_net_profit: updatedOffer.estimatedNetProfit,
        profit_margin_percent: updatedOffer.profitMarginPercent,
        is_loss_making: updatedOffer.isLossMaking,
        min_safe_selling_price: updatedOffer.minSafeSellingPrice,
        loss_override_reason: updatedOffer.lossOverrideReason || null,
        loss_approved_by: updatedOffer.lossApprovedBy || null,
        start_date: updatedOffer.startDate,
        end_date: updatedOffer.endDate || null,
        status: updatedOffer.status,
        max_usage_limit: updatedOffer.maxUsageLimit || null,
        usage_count: updatedOffer.usageCount,
        per_customer_limit: updatedOffer.perCustomerLimit || null,
        branch_id: updatedOffer.branchId || 'all',
        priority_rank: updatedOffer.priorityRank,
        updated_at: now,
      });
      if (upsertErr) throw upsertErr;

      const { error: delErr } = await supabase.from('combo_offer_items').delete().eq('offer_id', updatedOffer.id);
      if (delErr) throw delErr;

      if (updatedOffer.items && updatedOffer.items.length > 0) {
        const itemsPayload = updatedOffer.items.map(item => ({
          id: item.id || `coi-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          offer_id: updatedOffer.id,
          business_id: businessId,
          product_id: item.productId,
          product_name: item.productName,
          variant_id: item.variantId || null,
          variant_details: item.variantDetails || null,
          sku: item.sku || null,
          quantity: item.quantity,
          is_free: Boolean(item.isFree),
          purchase_price: item.purchasePrice || 0,
          sale_price: item.salePrice || 0,
        }));
        const { error: itemErr } = await supabase.from('combo_offer_items').insert(itemsPayload);
        if (itemErr) throw itemErr;
      }

      return updatedOffer;
    }

    // Local mode only
    try {
      const existing = await this.fetchOffers(businessId);
      const index = existing.findIndex(o => o.id === offer.id);
      const nextList = index > -1
        ? existing.map(o => o.id === offer.id ? updatedOffer : o)
        : [updatedOffer, ...existing];
      localStorage.setItem(`${STORAGE_KEY_OFFERS}_${businessId}`, JSON.stringify(nextList));
    } catch {}

    return updatedOffer;
  },

  /**
   * Record usage of a combo offer after a successful sale
   */
  async recordOfferUsage(
    offerId: string,
    saleId: string,
    invoiceNumber: string,
    discountGiven: number,
    revenue: number,
    costOfGoods: number,
    businessId: string,
    branchId: string,
    customerId?: string,
    customerName?: string
  ): Promise<void> {
    const grossProfit = revenue - costOfGoods;
    const now = new Date().toISOString();

    const usageRecord = {
      id: `cou-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      offerId,
      saleId,
      invoiceNumber,
      customerId,
      customerName,
      discountGiven,
      revenue,
      costOfGoods,
      grossProfit,
      date: now,
      branchId,
    };

    if (businessId && isSupabaseConfigured) {
      const { error: usageErr } = await supabase.from('combo_offer_usage').insert({
        id: usageRecord.id,
        business_id: businessId,
        offer_id: offerId,
        sale_id: saleId,
        invoice_number: invoiceNumber,
        customer_id: customerId || null,
        customer_name: customerName || null,
        discount_given: discountGiven,
        revenue,
        cost_of_goods: costOfGoods,
        gross_profit: grossProfit,
        branch_id: branchId,
      });
      if (usageErr) throw usageErr;

      const { error: incErr } = await supabase.rpc('increment_offer_usage', { p_offer_id: offerId });
      if (incErr) throw incErr;
      return;
    }

    try {
      const offers = await this.fetchOffers(businessId);
      const updated = offers.map(o => {
        if (o.id === offerId) {
          const nextCount = o.usageCount + 1;
          const isExpired = o.maxUsageLimit && nextCount >= o.maxUsageLimit;
          return {
            ...o,
            usageCount: nextCount,
            status: isExpired ? ('expired' as const) : o.status,
          };
        }
        return o;
      });
      localStorage.setItem(`${STORAGE_KEY_OFFERS}_${businessId}`, JSON.stringify(updated));

      const usageLogs = JSON.parse(localStorage.getItem(`${STORAGE_KEY_USAGE}_${businessId}`) || '[]');
      usageLogs.unshift(usageRecord);
      localStorage.setItem(`${STORAGE_KEY_USAGE}_${businessId}`, JSON.stringify(usageLogs));
    } catch {}
  },

  /**
   * Fetch usage logs for reporting
   */
  async fetchUsageLogs(businessId: string) {
    if (businessId && isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('combo_offer_usage')
        .select('*, combo_offers(name, offer_type)')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map((u: any) => ({
        id: u.id,
        offerId: u.offer_id,
        offerName: u.combo_offers?.name || 'Combo Offer',
        offerType: u.combo_offers?.offer_type || 'fixed_price',
        saleId: u.sale_id,
        invoiceNumber: u.invoice_number,
        customerId: u.customer_id,
        customerName: u.customer_name,
        discountGiven: Number(u.discount_given || 0),
        revenue: Number(u.revenue || 0),
        costOfGoods: Number(u.cost_of_goods || 0),
        grossProfit: Number(u.gross_profit || 0),
        date: u.created_at,
        branchId: u.branch_id,
      }));
    }

    try {
      const logs = localStorage.getItem(`${STORAGE_KEY_USAGE}_${businessId}`);
      if (logs) return JSON.parse(logs);
    } catch {}

    return [];
  },
};
