import {
  ComboOffer,
  ComboOfferItem,
  ComboOfferUsage,
  ComboUsageComponentLog,
  Product,
  SaleItem,
} from '../types';
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
  branchCompatible: boolean;
  itemStatuses: {
    productId: string;
    productName: string;
    variantId?: string;
    variantDetails?: string;
    requiredQty: number;
    availableStock: number;
    isAvailable: boolean;
  }[];
}

export interface ComboAllocatedComponent {
  productId: string;
  productName: string;
  variantId?: string;
  variantDetails?: string;
  sku: string;
  category?: string;
  imageUrl?: string;
  qtyPerCombo: number;
  totalQty: number;
  isFree: boolean;
  regularUnitPrice: number;
  purchasePrice: number;
  unitCost: number;
  allocatedUnitPrice: number;
  allocatedTotal: number;
  discountTotal: number;
}

export interface AggregateStockValidationResult {
  valid: boolean;
  errors: string[];
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

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

const isColumnSchemaError = (err: any): boolean => {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    msg.includes('column') && (msg.includes('does not exist') || msg.includes('schema cache'))
  );
};

export const comboOfferService = {
  /**
   * Bidirectional helper: compute equivalent discount percentage from Regular Price & Manual Final Price.
   */
  calculateEquivalentDiscountPercent(regularTotalPrice: number, finalComboPrice: number): number {
    if (regularTotalPrice <= 0) return 0;
    const clampedFinal = Math.max(0, finalComboPrice);
    const pct = ((regularTotalPrice - clampedFinal) / regularTotalPrice) * 100;
    return round2(Math.max(0, Math.min(100, pct)));
  },

  /**
   * Calculate precise Profit & Loss for any combo offer.
   * Supports decimal discount percentages and free-item landed costs.
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
      const variant =
        item.variantId && prod?.variants
          ? prod.variants.find(v => v.id === item.variantId)
          : undefined;

      const unitSalePrice =
        variant?.salePrice !== undefined
          ? variant.salePrice
          : item.salePrice !== undefined
          ? item.salePrice
          : prod?.salePrice || 0;

      const unitCost =
        variant?.purchasePrice !== undefined
          ? variant.purchasePrice
          : item.purchasePrice !== undefined
          ? item.purchasePrice
          : prod?.totalUnitCost || prod?.purchasePrice || 0;

      const unitOpEx = prod?.allocatedOpExPerUnit || unitCost * operatingBudgetPercent;

      regularTotalPrice += unitSalePrice * item.quantity;
      totalCostOfGoods += unitCost * item.quantity;
      allocatedOpEx += unitOpEx * item.quantity;
    });

    regularTotalPrice = round2(regularTotalPrice);
    totalCostOfGoods = round2(totalCostOfGoods);
    allocatedOpEx = round2(allocatedOpEx);

    let discountAmount = 0;
    let finalComboPrice = regularTotalPrice;

    if (discountType === 'fixed_bundle_price') {
      finalComboPrice = round2(Math.max(0, discountValue));
      discountAmount = round2(Math.max(0, regularTotalPrice - finalComboPrice));
    } else if (discountType === 'percentage') {
      const pct = Math.min(100, Math.max(0, discountValue));
      discountAmount = round2((regularTotalPrice * pct) / 100);
      finalComboPrice = round2(Math.max(0, regularTotalPrice - discountAmount));
    } else if (discountType === 'fixed_discount') {
      discountAmount = round2(Math.min(regularTotalPrice, Math.max(0, discountValue)));
      finalComboPrice = round2(Math.max(0, regularTotalPrice - discountAmount));
    } else if (discountType === 'free_item') {
      const freeItemsValue = items
        .filter(i => i.isFree)
        .reduce((sum, i) => {
          const prod = products.find(p => p.id === i.productId);
          const v =
            i.variantId && prod?.variants
              ? prod.variants.find(x => x.id === i.variantId)
              : undefined;
          const price =
            v?.salePrice !== undefined
              ? v.salePrice
              : i.salePrice !== undefined
              ? i.salePrice
              : prod?.salePrice || 0;
          return sum + price * i.quantity;
        }, 0);

      discountAmount = round2(freeItemsValue);
      finalComboPrice = round2(Math.max(0, regularTotalPrice - discountAmount));
    }

    const minSafeSellingPrice = round2(totalCostOfGoods + allocatedOpEx);
    const grossProfit = round2(finalComboPrice - totalCostOfGoods);
    const estimatedNetProfit = round2(grossProfit - allocatedOpEx);
    const profitMarginPercent =
      finalComboPrice > 0 ? Number(((grossProfit / finalComboPrice) * 100).toFixed(1)) : 0;

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
   * Proportionally allocate a combo package's final selling price across its component items
   * using exact paisa/cent largest-remainder distribution so component totals sum strictly
   * to `finalComboPrice * comboQuantity` with zero double-counting.
   */
  allocateComboComponentRevenues(
    items: ComboOfferItem[],
    products: Product[],
    finalComboPrice: number,
    comboQuantity: number = 1
  ): ComboAllocatedComponent[] {
    const safeComboQty = Math.max(1, Math.floor(comboQuantity));
    const targetCents = Math.max(0, Math.round(round2(finalComboPrice * safeComboQty) * 100));

    const enriched = items.map(item => {
      const prod = products.find(p => p.id === item.productId);
      const variant =
        item.variantId && prod?.variants
          ? prod.variants.find(v => v.id === item.variantId)
          : undefined;

      const regularUnitPrice =
        variant?.salePrice !== undefined
          ? variant.salePrice
          : item.salePrice !== undefined
          ? item.salePrice
          : prod?.salePrice || 0;

      const purchasePrice =
        variant?.purchasePrice !== undefined
          ? variant.purchasePrice
          : item.purchasePrice !== undefined
          ? item.purchasePrice
          : prod?.purchasePrice || 0;

      const unitCost =
        variant?.purchasePrice !== undefined
          ? variant.purchasePrice
          : prod?.totalUnitCost || purchasePrice;

      const totalQty = item.quantity * safeComboQty;
      const isFree = Boolean(item.isFree);
      const weight = isFree ? 0 : Math.max(0, regularUnitPrice * totalQty);

      return {
        item,
        prod,
        variant,
        regularUnitPrice: round2(regularUnitPrice),
        purchasePrice: round2(purchasePrice),
        unitCost: round2(unitCost),
        totalQty,
        isFree,
        weight,
      };
    });

    let totalWeight = enriched.reduce((s, r) => s + r.weight, 0);
    // Fallback if all items had zero regular price or were marked free
    if (totalWeight <= 0 && targetCents > 0) {
      enriched.forEach(r => {
        r.weight = r.totalQty;
      });
      totalWeight = enriched.reduce((s, r) => s + r.weight, 0);
    }

    const allocationsCents = enriched.map(r => {
      if (targetCents <= 0 || totalWeight <= 0) return { floorCents: 0, rem: 0 };
      const exact = (targetCents * r.weight) / totalWeight;
      const floorCents = Math.floor(exact);
      return { floorCents, rem: exact - floorCents };
    });

    let remainingCents =
      targetCents - allocationsCents.reduce((s, a) => s + a.floorCents, 0);

    if (remainingCents > 0) {
      const order = allocationsCents
        .map((a, idx) => ({ idx, rem: a.rem, weight: enriched[idx].weight }))
        .sort((a, b) => b.rem - a.rem || b.weight - a.weight);

      for (let i = 0; i < remainingCents && i < order.length; i++) {
        allocationsCents[order[i].idx].floorCents += 1;
      }
    }

    return enriched.map((r, idx) => {
      const allocatedTotal = round2(allocationsCents[idx].floorCents / 100);
      const allocatedUnitPrice =
        r.totalQty > 0 ? round2(allocatedTotal / r.totalQty) : 0;
      const regularTotal = round2(r.regularUnitPrice * r.totalQty);
      const discountTotal = round2(Math.max(0, regularTotal - allocatedTotal));

      return {
        productId: r.item.productId,
        productName: r.item.productName || r.prod?.name || 'Item',
        variantId: r.item.variantId,
        variantDetails: r.item.variantDetails,
        sku: r.variant?.sku || r.item.sku || r.prod?.code || '',
        category: r.prod?.category,
        imageUrl: r.prod?.primaryImageUrl || r.prod?.image,
        qtyPerCombo: r.item.quantity,
        totalQty: r.totalQty,
        isFree: r.isFree,
        regularUnitPrice: r.regularUnitPrice,
        purchasePrice: r.purchasePrice,
        unitCost: r.unitCost,
        allocatedUnitPrice,
        allocatedTotal,
        discountTotal,
      };
    });
  },

  /**
   * Check schedule, status, and usage cap validity of an offer.
   */
  isOfferCurrentlyValid(offer: ComboOffer, now: Date = new Date()): {
    valid: boolean;
    reason?: 'paused' | 'draft' | 'archived' | 'expired' | 'not_started' | 'limit_reached';
  } {
    if (offer.status === 'archived') return { valid: false, reason: 'archived' };
    if (offer.status === 'paused') return { valid: false, reason: 'paused' };
    if (offer.status === 'draft') return { valid: false, reason: 'draft' };
    if (offer.status === 'expired') return { valid: false, reason: 'expired' };

    if (offer.startDate) {
      const start = /^\d{4}-\d{2}-\d{2}$/.test(offer.startDate)
        ? new Date(`${offer.startDate}T00:00:00`)
        : new Date(offer.startDate);
      if (!Number.isNaN(start.getTime()) && start > now) {
        return { valid: false, reason: 'not_started' };
      }
    }

    if (offer.endDate) {
      const end = /^\d{4}-\d{2}-\d{2}$/.test(offer.endDate)
        ? new Date(`${offer.endDate}T23:59:59.999`)
        : new Date(offer.endDate);
      if (!Number.isNaN(end.getTime()) && end < now) {
        return { valid: false, reason: 'expired' };
      }
    }

    if (offer.maxUsageLimit && offer.usageCount >= offer.maxUsageLimit) {
      return { valid: false, reason: 'limit_reached' };
    }

    return { valid: true };
  },

  /**
   * Check whether all required variants and products have sufficient branch inventory stock
   * for `requestedCombos` units, including aggregate product-level stock when multiple
   * variants of the same product appear inside one combo.
   */
  checkOfferFulfillment(
    offer: ComboOffer,
    products: Product[],
    requestedCombos: number = 1,
    activeBranchId?: string
  ): ComboFulfillmentStatus {
    const branchCompatible =
      !offer.branchId ||
      offer.branchId === 'all' ||
      !activeBranchId ||
      offer.branchId === activeBranchId;

    // Aggregate per-product quantity inside the combo so multi-variant combos of same product check total stock accurately
    const perProductQtyPerCombo = new Map<string, number>();
    offer.items.forEach(item => {
      perProductQtyPerCombo.set(
        item.productId,
        (perProductQtyPerCombo.get(item.productId) || 0) + item.quantity
      );
    });

    const itemStatuses = offer.items.map(item => {
      const prod = products.find(p => p.id === item.productId);
      const isProductActiveInBranch =
        Boolean(prod) &&
        prod!.isActive !== false &&
        (!activeBranchId || !prod!.branchId || prod!.branchId === activeBranchId);

      const variant =
        item.variantId && prod?.variants
          ? prod.variants.find(v => v.id === item.variantId)
          : undefined;

      const rawStock = !isProductActiveInBranch
        ? 0
        : item.variantId
        ? variant?.stock ?? 0
        : prod?.currentStock ?? 0;

      const requiredQty = item.quantity * Math.max(1, requestedCombos);
      const prodAggregateNeeded =
        (perProductQtyPerCombo.get(item.productId) || item.quantity) *
        Math.max(1, requestedCombos);
      const productTotalStock = isProductActiveInBranch ? prod?.currentStock ?? 0 : 0;

      const isAvailable =
        branchCompatible &&
        isProductActiveInBranch &&
        rawStock >= requiredQty &&
        productTotalStock >= prodAggregateNeeded;

      return {
        productId: item.productId,
        productName: item.productName || prod?.name || 'Item',
        variantId: item.variantId,
        variantDetails: item.variantDetails,
        requiredQty: item.quantity,
        availableStock: rawStock,
        isAvailable,
      };
    });

    const canFulfill =
      branchCompatible && itemStatuses.length > 0 && itemStatuses.every(i => i.isAvailable);

    const perItemMax = itemStatuses.map(i =>
      i.requiredQty > 0 ? Math.floor(i.availableStock / i.requiredQty) : 0
    );

    const perProductMax: number[] = [];
    perProductQtyPerCombo.forEach((qtyPerCombo, prodId) => {
      const prod = products.find(p => p.id === prodId);
      const okBranch =
        Boolean(prod) &&
        prod!.isActive !== false &&
        (!activeBranchId || !prod!.branchId || prod!.branchId === activeBranchId);
      const stock = okBranch ? prod?.currentStock ?? 0 : 0;
      perProductMax.push(qtyPerCombo > 0 ? Math.floor(stock / qtyPerCombo) : 0);
    });

    const maxCombos =
      branchCompatible && itemStatuses.length > 0
        ? Math.max(0, Math.min(...perItemMax, ...perProductMax))
        : 0;

    return {
      canFulfill,
      maxCombos,
      branchCompatible,
      itemStatuses,
    };
  },

  /**
   * Aggregate stock pre-validation across all regular POS items + all combo component items.
   * Ensures zero partial deduction and produces exact product/variant shortage diagnostics.
   */
  validateAggregateCartStock(
    items: {
      productId: string;
      variantId?: string;
      productName: string;
      variantDetails?: string;
      quantity: number;
    }[],
    products: Product[],
    activeBranchId?: string
  ): AggregateStockValidationResult {
    const errors: string[] = [];
    const prodAgg = new Map<string, { name: string; qty: number }>();
    const varAgg = new Map<string, { productId: string; variantId: string; name: string; variantDetails?: string; qty: number }>();

    items.forEach(item => {
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) return;
      const existingP = prodAgg.get(item.productId);
      prodAgg.set(item.productId, {
        name: existingP?.name || item.productName,
        qty: (existingP?.qty || 0) + qty,
      });

      if (item.variantId) {
        const key = `${item.productId}::${item.variantId}`;
        const existingV = varAgg.get(key);
        varAgg.set(key, {
          productId: item.productId,
          variantId: item.variantId,
          name: existingV?.name || item.productName,
          variantDetails: existingV?.variantDetails || item.variantDetails,
          qty: (existingV?.qty || 0) + qty,
        });
      }
    });

    varAgg.forEach(entry => {
      const prod = products.find(p => p.id === entry.productId);
      if (!prod || prod.isActive === false) {
        errors.push(`"${entry.name}" is no longer active in inventory.`);
        return;
      }
      if (activeBranchId && prod.branchId && prod.branchId !== activeBranchId) {
        errors.push(`"${entry.name}" belongs to another branch and cannot be sold from the active branch.`);
        return;
      }
      const variant = prod.variants?.find(v => v.id === entry.variantId);
      if (!variant) {
        errors.push(
          `Variant ${entry.variantDetails ? `(${entry.variantDetails}) ` : ''}for "${entry.name}" was not found.`
        );
        return;
      }
      if (variant.stock < entry.qty) {
        errors.push(
          `Insufficient stock for "${entry.name}"${entry.variantDetails ? ` (${entry.variantDetails})` : ''} — Required: ${entry.qty}, Available: ${variant.stock}`
        );
      }
    });

    prodAgg.forEach((entry, productId) => {
      const prod = products.find(p => p.id === productId);
      if (!prod || prod.isActive === false) {
        if (!errors.some(e => e.includes(`"${entry.name}"`))) {
          errors.push(`"${entry.name}" is unavailable in inventory.`);
        }
        return;
      }
      if (activeBranchId && prod.branchId && prod.branchId !== activeBranchId) {
        if (!errors.some(e => e.includes(`"${entry.name}"`))) {
          errors.push(`"${entry.name}" belongs to another branch.`);
        }
        return;
      }
      if (prod.currentStock < entry.qty) {
        errors.push(
          `Insufficient total stock for "${prod.name}" — Required: ${entry.qty}, Available: ${prod.currentStock}`
        );
      }
    });

    return { valid: errors.length === 0, errors };
  },

  /**
   * Detect applicable active offers based on individual items currently inside the POS cart
   */
  detectApplicableOffers(
    cart: SaleItem[],
    offers: ComboOffer[],
    currentBranchId?: string,
    _customerId?: string,
    products?: Product[]
  ): DetectedOfferMatch[] {
    const now = new Date();
    const activeOffers = offers.filter(o => {
      if (!this.isOfferCurrentlyValid(o, now).valid) return false;
      if (o.branchId && o.branchId !== 'all' && currentBranchId && o.branchId !== currentBranchId) {
        return false;
      }
      return true;
    });

    activeOffers.sort((a, b) => b.priorityRank - a.priorityRank);

    const matches: DetectedOfferMatch[] = [];
    // Only consider non-combo loose cart items for upsell matching
    const looseCart = cart.filter(ci => !ci.comboInstanceId);
    if (looseCart.length === 0) return matches;

    const cartSubtotal = looseCart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    activeOffers.forEach(offer => {
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

      if (offer.offerType === 'quantity_discount') {
        const targetItem = offer.items[0];
        const minQty = offer.minPurchaseQuantity || 3;
        const matchingCartItems = looseCart.filter(ci => {
          if (targetItem?.productId && ci.productId !== targetItem.productId) return false;
          if (targetItem?.variantId && ci.variantId !== targetItem.variantId) return false;
          return true;
        });
        const totalQtyInCart = matchingCartItems.reduce((s, ci) => s + ci.quantity, 0);

        if (totalQtyInCart >= minQty) {
          const discount =
            offer.discountType === 'percentage'
              ? round2((matchingCartItems.reduce((s, ci) => s + ci.total, 0) * offer.discountValue) / 100)
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

      if (
        offer.offerType === 'category_bundle' &&
        offer.targetCategoryIds &&
        offer.targetCategoryIds.length > 0
      ) {
        const presentCategories = new Set(
          looseCart
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

      if (!offer.items || offer.items.length === 0) return;

      let fullyMatches = true;
      const missingItems: DetectedOfferMatch['missingItems'] = [];

      offer.items.forEach(req => {
        const matchingQty = looseCart
          .filter(ci => {
            if (ci.productId !== req.productId) return false;
            if (req.variantId && ci.variantId !== req.variantId) return false;
            return true;
          })
          .reduce((s, ci) => s + ci.quantity, 0);

        if (matchingQty < req.quantity) {
          fullyMatches = false;
          missingItems.push({
            productId: req.productId,
            productName: req.productName,
            variantId: req.variantId,
            variantDetails: req.variantDetails,
            neededQty: req.quantity - matchingQty,
          });
        }
      });

      if (fullyMatches) {
        let disc = 0;
        if (offer.discountType === 'fixed_bundle_price') {
          disc = Math.max(0, offer.regularTotalPrice - offer.finalComboPrice);
        } else if (offer.discountType === 'percentage') {
          disc = round2((offer.regularTotalPrice * offer.discountValue) / 100);
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
        matches.push({
          offer,
          discountAmount: 0,
          description: `Add ${missingItems[0].neededQty}x ${missingItems[0].productName} (${
            missingItems[0].variantDetails || 'Std'
          }) to unlock '${offer.name}'!`,
          isPartialMatch: true,
          missingItems,
        });
      }
    });

    return matches;
  },

  /**
   * Fetch combo offers from Supabase (or localStorage only when unconfigured)
   */
  async fetchOffers(businessId: string): Promise<ComboOffer[]> {
    if (businessId && isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('combo_offers')
        .select('*, combo_offer_items(*)')
        .eq('business_id', businessId)
        .order('priority_rank', { ascending: false });

      if (error) throw error;

      let cachedById = new Map<string, Partial<ComboOffer>>();
      try {
        const rawCached = localStorage.getItem(`${STORAGE_KEY_OFFERS}_${businessId}`);
        if (rawCached) {
          const parsed: ComboOffer[] = JSON.parse(rawCached);
          parsed.forEach(item => cachedById.set(item.id, item));
        }
      } catch {}

      const mapped: ComboOffer[] = (data || []).map((o: any) => {
        const cached = cachedById.get(o.id);
        return {
          id: o.id,
          name: o.name,
          description: o.description || undefined,
          comboCategory: o.combo_category || cached?.comboCategory || undefined,
          image: o.image || undefined,
          posterImageUrl: o.poster_image_url || cached?.posterImageUrl || undefined,
          masterImageType: (o.master_image_type as any) || cached?.masterImageType || undefined,
          posterConfig: o.poster_config || cached?.posterConfig || undefined,
          isPublishedOnline:
            o.is_published_online !== undefined
              ? Boolean(o.is_published_online)
              : Boolean(cached?.isPublishedOnline),
          marketplaceSlug: o.marketplace_slug || cached?.marketplaceSlug || undefined,
          offerType: o.offer_type,
          items: (o.combo_offer_items || []).map((i: any) => ({
            id: i.id,
            productId: i.product_id,
            productName: i.product_name,
            variantId: i.variant_id || undefined,
            variantDetails: i.variant_details || undefined,
            sku: i.sku || undefined,
            quantity: Number(i.quantity || 1),
            isFree: Boolean(i.is_free),
            purchasePrice: i.purchase_price != null ? Number(i.purchase_price) : undefined,
            salePrice: i.sale_price != null ? Number(i.sale_price) : undefined,
          })),
          minSpendAmount: o.min_spend_amount != null ? Number(o.min_spend_amount) : undefined,
          minPurchaseQuantity:
            o.min_purchase_quantity != null ? Number(o.min_purchase_quantity) : undefined,
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
          maxUsageLimit: o.max_usage_limit != null ? Number(o.max_usage_limit) : undefined,
          usageCount: Number(o.usage_count || 0),
          perCustomerLimit: o.per_customer_limit != null ? Number(o.per_customer_limit) : undefined,
          branchId: o.branch_id || 'all',
          priorityRank: Number(o.priority_rank || 1),
          businessId: o.business_id,
          createdAt: o.created_at,
          updatedAt: o.updated_at,
        };
      });

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
   * Save or update combo offer (zero inventory stock is deducted here).
   */
  async saveOffer(offer: ComboOffer, businessId: string): Promise<ComboOffer> {
    const now = new Date().toISOString();
    const updatedOffer: ComboOffer = {
      ...offer,
      businessId,
      updatedAt: now,
    };

    if (businessId && isSupabaseConfigured) {
      const basePayload: Record<string, any> = {
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
      };

      const extendedPayload = {
        ...basePayload,
        combo_category: updatedOffer.comboCategory || null,
        poster_image_url: updatedOffer.posterImageUrl || null,
        master_image_type: updatedOffer.masterImageType || null,
        poster_config: updatedOffer.posterConfig || null,
        is_published_online: Boolean(updatedOffer.isPublishedOnline),
        marketplace_slug: updatedOffer.marketplaceSlug || null,
      };

      const categoryOnlyPayload = {
        ...basePayload,
        combo_category: updatedOffer.comboCategory || null,
      };

      let { error: upsertErr } = await supabase.from('combo_offers').upsert(extendedPayload);
      if (upsertErr && isColumnSchemaError(upsertErr)) {
        const retryCategory = await supabase.from('combo_offers').upsert(categoryOnlyPayload);
        upsertErr = retryCategory.error;
        if (upsertErr && isColumnSchemaError(upsertErr)) {
          const retry = await supabase.from('combo_offers').upsert(basePayload);
          upsertErr = retry.error;
        }
      }
      if (upsertErr) throw upsertErr;

      const { error: delErr } = await supabase
        .from('combo_offer_items')
        .delete()
        .eq('offer_id', updatedOffer.id);
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

      // Sync cache cleanly so extended poster/marketplace configs persist reliably even before schema cache refresh
      try {
        const rawCached = localStorage.getItem(`${STORAGE_KEY_OFFERS}_${businessId}`);
        const parsed: ComboOffer[] = rawCached ? JSON.parse(rawCached) : [];
        const idx = parsed.findIndex(o => o.id === updatedOffer.id);
        const nextCached =
          idx > -1
            ? parsed.map(o => (o.id === updatedOffer.id ? updatedOffer : o))
            : [updatedOffer, ...parsed];
        localStorage.setItem(`${STORAGE_KEY_OFFERS}_${businessId}`, JSON.stringify(nextCached));
      } catch {}

      return updatedOffer;
    }

    try {
      const existing = await this.fetchOffers(businessId);
      const index = existing.findIndex(o => o.id === offer.id);
      const nextList =
        index > -1
          ? existing.map(o => (o.id === offer.id ? updatedOffer : o))
          : [updatedOffer, ...existing];
      localStorage.setItem(`${STORAGE_KEY_OFFERS}_${businessId}`, JSON.stringify(nextList));
    } catch {}

    return updatedOffer;
  },

  /**
   * Hard delete a combo offer (Admin / Store Manager only).
   */
  async deleteOffer(offerId: string, businessId: string): Promise<void> {
    if (businessId && isSupabaseConfigured) {
      const { error: itemErr } = await supabase
        .from('combo_offer_items')
        .delete()
        .eq('offer_id', offerId)
        .eq('business_id', businessId);
      if (itemErr) throw itemErr;

      const { error: offerErr } = await supabase
        .from('combo_offers')
        .delete()
        .eq('id', offerId)
        .eq('business_id', businessId);
      if (offerErr) throw offerErr;
      return;
    }

    try {
      const existing = await this.fetchOffers(businessId);
      const filtered = existing.filter(o => o.id !== offerId);
      localStorage.setItem(`${STORAGE_KEY_OFFERS}_${businessId}`, JSON.stringify(filtered));
    } catch {}
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
    customerName?: string,
    options?: {
      comboQuantity?: number;
      comboInstanceId?: string;
      sellerId?: string;
      clientTxId?: string;
      offerName?: string;
      components?: ComboUsageComponentLog[];
    }
  ): Promise<void> {
    const comboQty = Math.max(1, Math.floor(options?.comboQuantity || 1));
    const grossProfit = round2(revenue - costOfGoods);
    const now = new Date().toISOString();

    const usageRecord: ComboOfferUsage = {
      id: `cou-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      offerId,
      offerName: options?.offerName || 'Combo Offer',
      saleId,
      invoiceNumber,
      comboQuantity: comboQty,
      comboInstanceId: options?.comboInstanceId,
      sellerId: options?.sellerId,
      clientTxId: options?.clientTxId,
      components: options?.components,
      customerId,
      customerName,
      discountGiven: round2(discountGiven),
      revenue: round2(revenue),
      costOfGoods: round2(costOfGoods),
      grossProfit,
      date: now,
      branchId,
    };

    if (businessId && isSupabaseConfigured) {
      const baseInsert: Record<string, any> = {
        id: usageRecord.id,
        business_id: businessId,
        offer_id: offerId,
        sale_id: saleId,
        invoice_number: invoiceNumber,
        customer_id: customerId || null,
        customer_name: customerName || null,
        discount_given: usageRecord.discountGiven,
        revenue: usageRecord.revenue,
        cost_of_goods: round2(costOfGoods),
        gross_profit: grossProfit,
        branch_id: branchId || 'all',
      };

      const extendedInsert = {
        ...baseInsert,
        combo_quantity: comboQty,
        combo_instance_id: options?.comboInstanceId || null,
        seller_id: options?.sellerId || null,
        client_tx_id: options?.clientTxId || null,
        components: options?.components || [],
      };

      let { error: usageErr } = await supabase.from('combo_offer_usage').insert(extendedInsert);
      if (usageErr && isColumnSchemaError(usageErr)) {
        const retry = await supabase.from('combo_offer_usage').insert(baseInsert);
        usageErr = retry.error;
      }
      if (usageErr) throw usageErr;

      let { error: incErr } = await supabase.rpc('increment_offer_usage', {
        p_offer_id: offerId,
        p_quantity: comboQty,
      });
      if (incErr) {
        // Fallback if remote SQL still has 1-arg signature
        const retryInc = await supabase.rpc('increment_offer_usage', { p_offer_id: offerId });
        incErr = retryInc.error;
      }
      if (incErr) throw incErr;
      return;
    }

    try {
      const usageLogs: ComboOfferUsage[] = JSON.parse(
        localStorage.getItem(`${STORAGE_KEY_USAGE}_${businessId}`) || '[]'
      );
      if (
        options?.clientTxId &&
        usageLogs.some(
          u =>
            u.clientTxId === options.clientTxId &&
            u.offerId === offerId &&
            u.comboInstanceId === options?.comboInstanceId
        )
      ) {
        return;
      }

      const offers = await this.fetchOffers(businessId);
      const updated = offers.map(o => {
        if (o.id === offerId) {
          const nextCount = (o.usageCount || 0) + comboQty;
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

      usageLogs.unshift(usageRecord);
      localStorage.setItem(`${STORAGE_KEY_USAGE}_${businessId}`, JSON.stringify(usageLogs));
    } catch {}
  },

  /**
   * Reverse usage log & count on local mode when a sale is voided or deleted
   */
  async reverseOfferUsageForSale(saleId: string, businessId: string): Promise<void> {
    if (isSupabaseConfigured) return; // Handled atomically in PostgreSQL RPC
    try {
      const usageLogs: ComboOfferUsage[] = JSON.parse(
        localStorage.getItem(`${STORAGE_KEY_USAGE}_${businessId}`) || '[]'
      );
      const matching = usageLogs.filter(u => u.saleId === saleId);
      if (matching.length === 0) return;

      const qtyByOffer = new Map<string, number>();
      matching.forEach(m => {
        qtyByOffer.set(m.offerId, (qtyByOffer.get(m.offerId) || 0) + (m.comboQuantity || 1));
      });

      const remainingLogs = usageLogs.filter(u => u.saleId !== saleId);
      localStorage.setItem(`${STORAGE_KEY_USAGE}_${businessId}`, JSON.stringify(remainingLogs));

      const offers = await this.fetchOffers(businessId);
      const updatedOffers = offers.map(o => {
        const dec = qtyByOffer.get(o.id);
        if (!dec) return o;
        const nextCount = Math.max(0, (o.usageCount || 0) - dec);
        const reactivate =
          o.status === 'expired' && o.maxUsageLimit && nextCount < o.maxUsageLimit;
        return {
          ...o,
          usageCount: nextCount,
          status: reactivate ? ('active' as const) : o.status,
        };
      });
      localStorage.setItem(`${STORAGE_KEY_OFFERS}_${businessId}`, JSON.stringify(updatedOffers));
    } catch {}
  },

  /**
   * Fetch usage logs for combo analytics & details history
   */
  async fetchUsageLogs(businessId: string): Promise<ComboOfferUsage[]> {
    if (businessId && isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('combo_offer_usage')
        .select('*, combo_offers(name, offer_type)')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped: ComboOfferUsage[] = (data || []).map((u: any) => ({
        id: u.id,
        offerId: u.offer_id,
        offerName: u.combo_offers?.name || 'Combo Offer',
        saleId: u.sale_id,
        invoiceNumber: u.invoice_number,
        comboQuantity: u.combo_quantity != null ? Number(u.combo_quantity) : 1,
        comboInstanceId: u.combo_instance_id || undefined,
        sellerId: u.seller_id || undefined,
        clientTxId: u.client_tx_id || undefined,
        components: Array.isArray(u.components) ? u.components : undefined,
        customerId: u.customer_id || undefined,
        customerName: u.customer_name || undefined,
        discountGiven: Number(u.discount_given || 0),
        revenue: Number(u.revenue || 0),
        costOfGoods: Number(u.cost_of_goods || 0),
        grossProfit: Number(u.gross_profit || 0),
        date: u.created_at,
        branchId: u.branch_id || 'all',
      }));

      try {
        localStorage.setItem(`${STORAGE_KEY_USAGE}_${businessId}`, JSON.stringify(mapped));
      } catch {}
      return mapped;
    }

    try {
      const logs = localStorage.getItem(`${STORAGE_KEY_USAGE}_${businessId}`);
      if (logs) return JSON.parse(logs);
    } catch {}

    return [];
  },
};
