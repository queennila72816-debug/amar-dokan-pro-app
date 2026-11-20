import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Product, ProductVariant, SaleItem, PaymentMethod, Sale, SalePayment } from '../../types';
import { formatCurrency, toBnNumber } from '../../utils/formatters';
import { InvoiceModal } from './InvoiceModal';
import { SearchableCombobox, ComboboxOption } from '../common/SearchableCombobox';
import { ProductThumbnail } from '../common/ProductThumbnail';
import {
  inferColorHex,
  normalizeColorKey,
  resolveColorIdForVariant,
  resolveProductColors,
  resolveProductImage,
} from '../../utils/productImageResolver';
import {
  Search,
  Barcode,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  UserPlus,
  CreditCard,
  X,
  Layers,
  Banknote,
  Smartphone,
  Landmark,
  ArrowRight,
  ArrowLeft,
  Check,
  Receipt,
  ShoppingBag,
  AlertTriangle,
  ShieldCheck,
  Lock,
  Gift,
  Sparkles,
  Percent,
} from 'lucide-react';
import { comboOfferService, DetectedOfferMatch } from '../../services/comboOfferService';

export const POSView: React.FC = () => {
  const { products, categories: appCategories, customers, accounts, addCustomer, recordSale, settings, activeBranchId, currentUserRole, user, isAdmin, currentEmployee, addAuditLog, comboOffers, pendingPosSelection, setPendingPosSelection } = useApp();
  const isBn = false;
  const lang = settings.language;

  // Active products only (excluding soft-deleted)
  const activeProducts = useMemo(() => {
    return products.filter(p => p.isActive !== false);
  }, [products]);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [barcodeInput, setBarcodeInput] = useState('');

  // Cart
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
  const [mobileCheckoutTab, setMobileCheckoutTab] = useState<'cart' | 'checkout'>('cart');

  // Customer
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustMobile, setNewCustMobile] = useState('');

  const customerOptions = useMemo<ComboboxOption[]>(() => {
    const walkIn: ComboboxOption = {
      id: '',
      label: 'Walk-in Customer (Cash)',
      sublabel: 'Default retail cash counter',
      searchText: 'walk in cash default retail',
    };
    const list = customers.map(c => ({
      id: c.id,
      label: c.name,
      sublabel: [c.mobile, c.address].filter(Boolean).join(' · ') || 'Registered customer',
      badge: c.currentDue > 0 ? `Due: ৳${c.currentDue}` : undefined,
      searchText: `${c.name} ${c.mobile || ''} ${c.address || ''}`,
    }));
    return [walkIn, ...list];
  }, [customers]);

  // Bill & Payment
  const [orderDiscount, setOrderDiscount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [tenderedAmount, setTenderedAmount] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);

  // Mixed Payment Split Inputs
  const [mixedCash, setMixedCash] = useState<number | ''>('');
  const [mixedBkash, setMixedBkash] = useState<number | ''>('');
  const [mixedNagad, setMixedNagad] = useState<number | ''>('');
  const [mixedBank, setMixedBank] = useState<number | ''>('');

  // Variant Modal & Color Filter inside Variant Modal
  const [variantProduct, setVariantProduct] = useState<Product | null>(null);
  const [variantModalColorFilter, setVariantModalColorFilter] = useState<string>('all');

  // Completed Invoice Modal
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);

  // Discount Protection & Admin Auth Modal
  const [isAdminAuthModalOpen, setIsAdminAuthModalOpen] = useState(false);
  const [adminAuthPin, setAdminAuthPin] = useState('');
  const [adminAuthError, setAdminAuthError] = useState<string | null>(null);
  const [approvedAdminName, setApprovedAdminName] = useState<string | null>(null);

  // Applied Combo / Bundle Offers
  const [appliedOffers, setAppliedOffers] = useState<{ offerId: string; offerName: string; discountAmount: number; offerType: string }[]>([]);

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Categories extraction (unified from appCategories and active products)
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    appCategories.forEach(c => c.name && set.add(c.name));
    activeProducts.forEach(p => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [appCategories, activeProducts]);

  // Filtered Products
  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return activeProducts.filter(p => {
      const matchSearch =
        !q ||
        (p.name || '').toLowerCase().includes(q) ||
        (p.code || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (Array.isArray(p.variants) &&
          p.variants.some(
            v =>
              (v.sku || '').toLowerCase().includes(q) ||
              (v.barcode || '').toLowerCase().includes(q) ||
              [v.color, v.size].filter(Boolean).join(' ').toLowerCase().includes(q)
          ));

      const matchCategory = selectedCategory === 'all' || p.category === selectedCategory;

      return matchSearch && matchCategory;
    });
  }, [activeProducts, searchQuery, selectedCategory]);

  // Handle Barcode Scan & SKU direct search
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = barcodeInput.trim();
    if (!query) return;
    const qLower = query.toLowerCase();

    // 1. Direct match on product barcode or SKU
    const matchedProduct = activeProducts.find(
      p => (p.barcode || '').toLowerCase() === qLower || (p.code || '').toLowerCase() === qLower
    );

    if (matchedProduct) {
      if (matchedProduct.hasVariants && matchedProduct.variants && matchedProduct.variants.length > 0) {
        setVariantProduct(matchedProduct);
      } else {
        addToCart(matchedProduct);
      }
      setBarcodeInput('');
      return;
    }

    // 2. Direct match on variant SKU or barcode
    for (const prod of activeProducts) {
      if (prod.hasVariants && prod.variants) {
        const matchedVariant = prod.variants.find(
          v => (v.sku || '').toLowerCase() === qLower || (v.barcode || '').toLowerCase() === qLower
        );
        if (matchedVariant) {
          addToCart(prod, matchedVariant);
          setBarcodeInput('');
          return;
        }
      }
    }

    alert(
      `No active product found with barcode or SKU '${query}'`
    );
  };

  // Add Product to Cart
  const addToCart = (product: Product, variant?: ProductVariant) => {
    const availableStock = variant ? variant.stock : product.currentStock;
    if (availableStock <= 0) {
      alert('This product is currently out of stock!');
      return;
    }

    setCart(prev => {
      const existingIndex = prev.findIndex(item =>
        item.productId === product.id && (variant ? item.variantId === variant.id : !item.variantId)
      );

      if (existingIndex > -1) {
        const item = prev[existingIndex];
        if (item.quantity >= availableStock) {
          alert(`Only ${availableStock} available in stock!`);
          return prev;
        }
        const updated = [...prev];
        const newQty = item.quantity + 1;
        updated[existingIndex] = {
          ...item,
          quantity: newQty,
          total: (newQty * item.unitPrice) - item.discount,
        };
        return updated;
      }

      const unitPrice =
        variant?.salePrice !== undefined
          ? variant.salePrice
          : variant?.additionalPrice
          ? product.salePrice + variant.additionalPrice
          : product.salePrice;

      const purchasePrice =
        variant?.purchasePrice !== undefined
          ? variant.purchasePrice
          : product.purchasePrice;

      const variantDetails = variant
        ? [variant.color, variant.size].filter(Boolean).join(' / ')
        : undefined;
      const resolvedColorId = variant
        ? resolveColorIdForVariant(product, variant)
        : resolveProductColors(product)[0]?.id;
      const resolvedImageUrl = resolveProductImage(product, {
        colorId: resolvedColorId,
        variantId: variant?.id,
        colorName: variant?.color,
      });

      const newItem: SaleItem = {
        productId: product.id,
        productName: product.name,
        sku: variant ? variant.sku : product.code,
        unitPrice,
        purchasePrice,
        quantity: 1,
        discount: 0,
        total: unitPrice,
        variantId: variant?.id,
        variantDetails,
        colorId: resolvedColorId,
        colorName: variant?.color,
        imageUrl: resolvedImageUrl,
        category: product.category,
      };

      return [...prev, newItem];
    });

    setVariantProduct(null);
  };

  // Handle item handoff from Apparel Photo Catalog
  useEffect(() => {
    if (!pendingPosSelection) return;
    const prod = activeProducts.find(p => p.id === pendingPosSelection.productId);
    setPendingPosSelection(null);
    if (!prod || prod.currentStock <= 0) return;

    if (pendingPosSelection.variantId && prod.variants) {
      const matchedVariant = prod.variants.find(v => v.id === pendingPosSelection.variantId);
      if (matchedVariant && matchedVariant.stock > 0) {
        addToCart(prod, matchedVariant);
        return;
      }
    }

    if (prod.hasVariants && prod.variants && prod.variants.length > 0) {
      setVariantModalColorFilter(pendingPosSelection.colorId || 'all');
      setVariantProduct(prod);
    } else {
      addToCart(prod);
    }
  }, [pendingPosSelection, activeProducts]);

  // Update Cart Item Quantity
  const updateQuantity = (index: number, newQty: number) => {
    if (newQty <= 0) {
      removeFromCart(index);
      return;
    }

    setCart(prev => {
      const updated = [...prev];
      const item = updated[index];
      const prod = activeProducts.find(p => p.id === item.productId);
      const maxStock = item.variantId && prod?.variants
        ? (prod.variants.find(v => v.id === item.variantId)?.stock || 0)
        : (prod?.currentStock || 0);

      if (newQty > maxStock) {
        alert(`Only ${maxStock} items available in stock!`);
        return prev;
      }

      updated[index] = {
        ...item,
        quantity: newQty,
        total: (newQty * item.unitPrice) - item.discount,
      };
      return updated;
    });
  };

  // Remove Item
  const removeFromCart = (index: number) => {
    setCart(prev => prev.filter((_, i) => i !== index));
  };

  // Clear Cart
  const clearCart = () => {
    if (cart.length === 0) return;
    if (confirm('Clear shopping cart?')) {
      setCart([]);
      setOrderDiscount(0);
      setTenderedAmount('');
      setMixedCash('');
      setMixedBkash('');
      setMixedNagad('');
      setMixedBank('');
      setAppliedOffers([]);
    }
  };

  // Auto-detect applicable combo offers for current cart
  const detectedComboOffers = useMemo(() => {
    return comboOfferService.detectApplicableOffers(
      cart,
      comboOffers,
      activeBranchId,
      selectedCustomerId,
      products
    );
  }, [cart, comboOffers, activeBranchId, selectedCustomerId, products]);

  // Re-validate applied combo offers whenever cart/branch/customer eligibility changes
  useEffect(() => {
    setAppliedOffers(prev => {
      if (prev.length === 0) return prev;
      const eligibleMap = new Map<string, DetectedOfferMatch>();
      detectedComboOffers.forEach(d => {
        if (!d.isPartialMatch && d.discountAmount > 0) {
          eligibleMap.set(d.offer.id, d);
        }
      });
      let changed = false;
      const next: NonNullable<Sale['appliedOffers']> = [];
      for (const applied of prev) {
        const match = eligibleMap.get(applied.offerId);
        if (!match) {
          changed = true;
          continue;
        }
        if (match.discountAmount !== applied.discountAmount) {
          changed = true;
        }
        next.push({
          ...applied,
          discountAmount: match.discountAmount,
        });
      }
      return changed ? next : prev;
    });
  }, [detectedComboOffers]);

  // Combined discount from applied combo offers
  const comboDiscountTotal = useMemo(() => {
    return appliedOffers.reduce((sum, o) => sum + (o.discountAmount || 0), 0);
  }, [appliedOffers]);

  const handleApplyComboOffer = (detected: DetectedOfferMatch) => {
    if (detected.isPartialMatch || detected.discountAmount <= 0) return;
    if (appliedOffers.some(o => o.offerId === detected.offer.id)) return;
    setAppliedOffers(prev => [
      ...prev,
      {
        offerId: detected.offer.id,
        offerName: detected.offer.name,
        discountAmount: detected.discountAmount,
        offerType: detected.offer.offerType,
      },
    ]);
  };

  const handleRemoveComboOffer = (offerId: string) => {
    setAppliedOffers(prev => prev.filter(o => o.offerId !== offerId));
  };

  // Bill Calculations
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  const itemsDiscount = cart.reduce((sum, item) => sum + item.discount, 0);
  const totalDiscount = itemsDiscount + (orderDiscount || 0) + comboDiscountTotal;
  const taxableAmount = Math.max(0, subtotal - totalDiscount);
  const vatTaxRate = settings.vatTaxRate || 0;
  const vatTaxAmount = Math.round((taxableAmount * vatTaxRate) / 100);
  const grandTotal = Math.max(0, taxableAmount + vatTaxAmount);

  // Mixed Payment Total
  const mixedTotal = (Number(mixedCash) || 0) + (Number(mixedBkash) || 0) + (Number(mixedNagad) || 0) + (Number(mixedBank) || 0);

  // Paid & Due amounts
  let effectivePaid = 0;
  if (paymentMethod === 'due') {
    effectivePaid = 0;
  } else if (paymentMethod === 'mixed') {
    effectivePaid = mixedTotal;
  } else {
    effectivePaid = tenderedAmount === '' ? grandTotal : Math.max(0, Number(tenderedAmount) || 0);
  }

  const changeReturn = effectivePaid > grandTotal ? effectivePaid - grandTotal : 0;
  const dueAmount = effectivePaid < grandTotal ? grandTotal - effectivePaid : 0;

  // Selected Customer details
  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  // Total Landed / Break-even Cost of items in cart
  const cartTotalCost = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.purchasePrice * item.quantity), 0);
  }, [cart]);

  const cartMinSafeFloor = useMemo(() => {
    return cart.reduce((sum, item) => {
      const prod = activeProducts.find(p => p.id === item.productId);
      const minP = prod?.minSalePrice || prod?.totalUnitCost || prod?.purchasePrice || item.purchasePrice;
      return sum + (minP * item.quantity);
    }, 0);
  }, [cart, activeProducts]);

  const isBelowSafeFloor = cart.length > 0 && grandTotal < cartMinSafeFloor;

  // Complete Sale
  const handleCompleteSale = async (adminNameOverride?: string) => {
    if (isSubmittingSale) return;
    if (cart.length === 0) {
      alert('Cart is empty!');
      return;
    }

    if (dueAmount > 0 && !selectedCustomerId) {
      alert('Customer selection required for due/credit sales!');
      return;
    }

    // Discount Protection Check: Prevent selling below break-even safe floor without Admin Authorization
    let effectiveAdminApprover = adminNameOverride || approvedAdminName;
    if (isBelowSafeFloor && !effectiveAdminApprover) {
      if (!isAdmin) {
        setIsAdminAuthModalOpen(true);
        return;
      } else {
        const proceed = confirm(
          `Discount Warning: This order grand total (${formatCurrency(grandTotal, lang)}) is below the minimum break-even cost (${formatCurrency(cartMinSafeFloor, lang)}).\n\nDo you want to authorize this loss-making sale as Administrator?`
        );
        if (!proceed) return;
        effectiveAdminApprover = user?.user_metadata?.full_name || 'Admin';
        setApprovedAdminName(effectiveAdminApprover);
      }
    }

    setIsSubmittingSale(true);

    try {
      // Build Payments array dynamically from user's configured accounts
      const payments: SalePayment[] = [];
      const actualPaid = Math.min(effectivePaid, grandTotal);

      const cashAcc = accounts.find(a => a.accountType === 'cash') || accounts[0];
      const bkashAcc = accounts.find(a => a.accountType === 'mobile_bank' && a.name.toLowerCase().includes('bkash')) || accounts.find(a => a.accountType === 'mobile_bank');
      const nagadAcc = accounts.find(a => a.accountType === 'mobile_bank' && a.name.toLowerCase().includes('nagad')) || accounts.find(a => a.accountType === 'mobile_bank');
      const bankAcc = accounts.find(a => a.accountType === 'bank') || accounts[0];

      if (paymentMethod === 'mixed') {
        let cashAmt = Math.max(0, Number(mixedCash) || 0);
        let bkashAmt = Math.max(0, Number(mixedBkash) || 0);
        let nagadAmt = Math.max(0, Number(mixedNagad) || 0);
        let bankAmt = Math.max(0, Number(mixedBank) || 0);

        // If customer over-tendered in mixed mode, deduct returned change from cash first, then remaining methods
        let excess = cashAmt + bkashAmt + nagadAmt + bankAmt - actualPaid;
        if (excess > 0) {
          const deductCash = Math.min(cashAmt, excess);
          cashAmt -= deductCash;
          excess -= deductCash;
        }
        if (excess > 0) {
          const deductBkash = Math.min(bkashAmt, excess);
          bkashAmt -= deductBkash;
          excess -= deductBkash;
        }
        if (excess > 0) {
          const deductNagad = Math.min(nagadAmt, excess);
          nagadAmt -= deductNagad;
          excess -= deductNagad;
        }
        if (excess > 0) {
          bankAmt = Math.max(0, bankAmt - excess);
        }

        if (cashAmt > 0) payments.push({ method: 'cash', amount: cashAmt, accountId: cashAcc?.id, accountName: cashAcc?.name || 'Cash in Hand' });
        if (bkashAmt > 0) payments.push({ method: 'bkash', amount: bkashAmt, accountId: bkashAcc?.id, accountName: bkashAcc?.name || 'bKash' });
        if (nagadAmt > 0) payments.push({ method: 'nagad', amount: nagadAmt, accountId: nagadAcc?.id, accountName: nagadAcc?.name || 'Nagad' });
        if (bankAmt > 0) payments.push({ method: 'bank', amount: bankAmt, accountId: bankAcc?.id, accountName: bankAcc?.name || 'Bank' });
      } else if (paymentMethod !== 'due' && actualPaid > 0) {
        const targetAcc =
          paymentMethod === 'cash'
            ? cashAcc
            : paymentMethod === 'bkash'
            ? bkashAcc
            : paymentMethod === 'nagad'
            ? nagadAcc
            : bankAcc;
        payments.push({
          method: paymentMethod,
          amount: actualPaid,
          accountId: targetAcc?.id,
          accountName: targetAcc?.name,
        });
      }

      const firstAppliedOffer = appliedOffers[0];

      const saleRecord = await recordSale({
        customerId: selectedCustomer?.id,
        customerName: selectedCustomer ? selectedCustomer.name : ('Walk-in Customer'),
        customerMobile: selectedCustomer?.mobile || '',
        items: cart.map(item => ({
          ...item,
          comboOfferId: item.comboOfferId || firstAppliedOffer?.offerId,
          comboOfferName: item.comboOfferName || firstAppliedOffer?.offerName,
          approvedDiscountBy: effectiveAdminApprover || undefined,
        })),
        subtotal,
        discount: totalDiscount,
        comboDiscount: comboDiscountTotal > 0 ? comboDiscountTotal : undefined,
        appliedOffers: appliedOffers.length > 0 ? appliedOffers : undefined,
        vatTaxRate,
        vatTaxAmount,
        total: grandTotal,
        paid: actualPaid,
        due: dueAmount,
        paymentMethod,
        payments,
        servedBy: currentEmployee?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || (currentUserRole === 'seller' || currentUserRole === 'salesman' ? 'Seller' : 'Admin'),
        sellerId: user?.id,
        sellerName: currentEmployee?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || (currentUserRole === 'seller' || currentUserRole === 'salesman' ? 'Seller' : 'Admin'),
        employeeId: currentEmployee?.id || user?.id,
        employeeCode: currentEmployee?.employeeCode,
        employeeName: currentEmployee?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Admin',
        branchId: activeBranchId,
        notes: effectiveAdminApprover ? `${notes ? notes + ' | ' : ''}Discount approved by Admin: ${effectiveAdminApprover}` : notes,
      });

      if (effectiveAdminApprover) {
        addAuditLog('DISCOUNT_AUTHORIZED', 'sale', saleRecord.id, `Loss-making/deep discount authorized by Admin (${effectiveAdminApprover}) for Invoice ${saleRecord.invoiceNumber}`);
      }

      // Reset Form
      setCart([]);
      setOrderDiscount(0);
      setTenderedAmount('');
      setMixedCash('');
      setMixedBkash('');
      setMixedNagad('');
      setMixedBank('');
      setSelectedCustomerId('');
      setNotes('');
      setApprovedAdminName(null);
      setAppliedOffers([]);

      // Open Invoice & Close mobile drawer
      setCompletedSale(saleRecord);
      setIsMobileCartOpen(false);
    } catch (err: any) {
      alert(`Sale checkout failed: ${err.message || 'Database transaction error'}`);
    } finally {
      setIsSubmittingSale(false);
    }
  };

  // Quick Customer Creation
  const handleQuickAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;

    try {
      const created = await addCustomer({
        name: newCustName.trim(),
        mobile: newCustMobile.trim(),
        customerType: 'retail',
        creditLimit: 10000,
      });

      setSelectedCustomerId(created.id);
      setNewCustName('');
      setNewCustMobile('');
      setShowAddCustomerModal(false);
    } catch (err: any) {
      alert(`Failed to add customer: ${err.message || 'Database error'}`);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 min-h-[calc(100vh-7rem)] lg:h-[calc(100vh-5.5rem)]">
      {/* Left Column: Product Search, Category Filters, & Product Grid (7 cols on desktop, full width on mobile) */}
      <div className="lg:col-span-7 flex flex-col bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden min-h-[calc(100vh-9rem)] lg:min-h-0">
        {/* Search & Barcode Header */}
        <div className="p-2.5 sm:p-3 border-b border-slate-200 bg-slate-50/70 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* Product Name Search */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={'Search by name, SKU or brand...'}
                className="w-full pl-9 pr-8 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Direct Barcode Scanner Input */}
            <form onSubmit={handleBarcodeSubmit} className="relative flex">
              <Barcode className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                ref={barcodeInputRef}
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder={'Scan / enter barcode...'}
                className="w-full pl-9 pr-14 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
              />
              <button
                type="submit"
                className="absolute right-1 top-1 bottom-1 px-2.5 bg-slate-800 text-white text-[10px] font-semibold rounded-md hover:bg-slate-900 transition-colors"
              >
                {'Enter'}
              </button>
            </form>
          </div>

          {/* Category Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar select-none">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-[9px] whitespace-nowrap transition-colors font-medium text-xs shrink-0 cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-[#087F8C] text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {'All Items'} ({activeProducts.length})
            </button>
            {allCategories.map(cat => {
              const count = activeProducts.filter(p => p.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-[9px] whitespace-nowrap transition-colors font-medium text-xs shrink-0 cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-[#087F8C] text-white shadow-xs'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Product Cards Grid: 2 columns on mobile, 3-4 on tablet/desktop */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-3 pb-24 lg:pb-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-2.5 content-start">
          {filteredProducts.map(product => {
            const isOutOfStock = product.currentStock <= 0;
            const isLowStock = product.currentStock > 0 && product.currentStock <= product.minStockAlert;
            const inCartQty = cart
              .filter(item => item.productId === product.id)
              .reduce((sum, item) => sum + item.quantity, 0);

            return (
              <div
                key={product.id}
                onClick={() => {
                  if (isOutOfStock) return;
                  if (product.hasVariants && product.variants && product.variants.length > 0) {
                    setVariantModalColorFilter('all');
                    setVariantProduct(product);
                  } else {
                    addToCart(product);
                  }
                }}
                className={`relative flex flex-col justify-between p-2.5 sm:p-3 rounded-xl border text-left transition-all ${
                  isOutOfStock
                    ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                    : inCartQty > 0
                    ? 'bg-emerald-50/25 border-emerald-500 shadow-xs cursor-pointer active:scale-[0.98]'
                    : 'bg-white border-slate-200 hover:border-emerald-500 hover:shadow-xs cursor-pointer active:scale-[0.98]'
                }`}
              >
                {/* In Cart Indicator Badge */}
                {inCartQty > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 z-10 bg-emerald-600 text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center shadow-xs">
                    {inCartQty}
                  </span>
                )}

                <div>
                  <div className="flex items-start gap-2 mb-1.5">
                    <ProductThumbnail
                      src={resolveProductImage(product)}
                      alt={product.name}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1 mb-0.5">
                        <span className="text-[10px] text-slate-500 font-mono truncate max-w-[70px]">
                          {product.code}
                        </span>
                        {product.hasVariants ? (
                          <span className="text-[9px] font-semibold text-blue-700 bg-blue-50 px-1 py-0.5 rounded shrink-0">
                            {'Variants'}
                          </span>
                        ) : (
                          <span
                            className={`text-[9px] font-medium px-1 py-0.5 rounded shrink-0 ${
                              isOutOfStock
                                ? 'bg-rose-100 text-rose-800'
                                : isLowStock
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {isOutOfStock
                              ? ('Out')
                              : `${'Stock:'} ${toBnNumber(product.currentStock)}`}
                          </span>
                        )}
                      </div>
                      <h4 className="text-xs font-semibold text-slate-900 line-clamp-2 leading-tight min-h-[2rem]">
                        {product.name}
                      </h4>
                    </div>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-xs sm:text-sm font-bold text-emerald-700 font-mono-num block">
                      {formatCurrency(product.salePrice, lang)}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={isOutOfStock}
                    className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${
                      isOutOfStock
                        ? 'bg-slate-100 text-slate-400'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs'
                    }`}
                    title="Add to cart"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {filteredProducts.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-400 text-xs">
              {'No products match your search.'}
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Active Cart, Customer Selection & Checkout Summary (Desktop Only: hidden on mobile, lg:flex) */}
      <div className="hidden lg:flex lg:col-span-5 flex-col bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Cart Header & Customer Selector */}
        <div className="p-3 border-b border-slate-200 bg-slate-50/70 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-[#087F8C]" />
              <h3 className="text-sm font-bold text-slate-900">
                {'Active Cart'} ({toBnNumber(cart.length)})
              </h3>
            </div>
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                className="text-[11px] font-medium text-[#F06464] hover:brightness-110 transition-colors cursor-pointer"
              >
                {'Clear'}
              </button>
            )}
          </div>

          {/* Searchable Customer Selection Row */}
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <SearchableCombobox
                ariaLabel="Select Customer"
                options={customerOptions}
                value={selectedCustomerId}
                onChange={setSelectedCustomerId}
                placeholder="Search customer by name or mobile..."
                emptyMessage="No matching customers found"
                size="sm"
              />
            </div>
            <button
              onClick={() => setShowAddCustomerModal(true)}
              className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-[8px] border border-slate-200 transition-colors cursor-pointer shrink-0"
              title={'Add new customer'}
            >
              <UserPlus className="w-4 h-4" />
            </button>
          </div>

          {/* Customer Due Alert if customer has past due */}
          {selectedCustomer && selectedCustomer.currentDue > 0 && (
            <div className="text-[11px] bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 text-amber-800 flex items-center justify-between">
              <span>{'Previous Due:'}</span>
              <span className="font-bold font-mono-num">{formatCurrency(selectedCustomer.currentDue, lang)}</span>
            </div>
          )}
        </div>

        {/* Cart Item Table */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {/* Applied Combo Offers Banner */}
          {appliedOffers.map(applied => (
            <div
              key={`applied-${applied.offerId}`}
              className="p-2 bg-purple-50 border border-purple-200 rounded-lg flex items-center justify-between text-xs animate-in fade-in"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Gift className="w-4 h-4 text-purple-600 shrink-0" />
                <div className="truncate">
                  <span className="font-bold text-purple-900 block truncate">{applied.offerName}</span>
                  <span className="text-[10px] text-purple-700">Applied Bundle Discount</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-bold text-purple-800 bg-purple-100 px-2 py-0.5 rounded text-xs font-mono">
                  -৳{applied.discountAmount}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveComboOffer(applied.offerId)}
                  className="text-purple-400 hover:text-rose-600 p-1 rounded hover:bg-purple-100 transition-colors"
                  title="Remove combo offer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          {/* Detected Eligible Combo Offers Banner */}
          {detectedComboOffers
            .filter(det => !appliedOffers.some(a => a.offerId === det.offer.id))
            .map(det => (
              <div
                key={`detected-${det.offer.id}`}
                className="p-2.5 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border border-emerald-300 rounded-lg flex items-center justify-between gap-2 text-xs shadow-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-900 truncate">
                    <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="truncate">{det.offer.name}</span>
                  </div>
                  <p className="text-[11px] text-emerald-700 mt-0.5">
                    {det.isPartialMatch ? (
                      <span>{det.description}</span>
                    ) : (
                      <>Save <strong className="font-mono">৳{det.discountAmount}</strong> with this bundle!</>
                    )}
                  </p>
                </div>
                {!det.isPartialMatch && (
                  <button
                    type="button"
                    onClick={() => handleApplyComboOffer(det)}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shrink-0 shadow-xs transition-colors flex items-center gap-1"
                  >
                    <Gift className="w-3.5 h-3.5" />
                    <span>Apply Offer</span>
                  </button>
                )}
              </div>
            ))
          }

          {cart.map((item, idx) => {
            const matchedProd = products.find(p => p.id === item.productId);
            const itemImg =
              item.imageUrl ||
              resolveProductImage(matchedProd, {
                colorId: item.colorId,
                variantId: item.variantId,
                colorName: item.colorName,
              });
            return (
            <div
              key={`${item.productId}-${item.variantId || 'base'}-${idx}`}
              className="p-2 bg-slate-50/70 border border-slate-200 rounded-lg text-xs flex items-center justify-between gap-2"
            >
              <ProductThumbnail
                src={itemImg}
                alt={item.productName}
                colorHex={item.colorName ? inferColorHex(item.colorName) : undefined}
                colorName={item.colorName}
                size="xs"
              />
              <div className="flex-1 min-w-0">
                <h5 className="font-semibold text-slate-900 truncate leading-tight">
                  {item.productName}
                </h5>
                <div className="text-[10px] text-slate-600 flex items-center gap-2 mt-0.5">
                  {item.variantDetails && (
                    <span className="text-blue-700 font-medium">{item.variantDetails}</span>
                  )}
                  <span>@{formatCurrency(item.unitPrice, lang)}</span>
                  {item.discount > 0 && (
                    <span className="text-emerald-600">Discount: -৳{item.discount}</span>
                  )}
                </div>
              </div>

              {/* Quantity Controls */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => updateQuantity(idx, item.quantity - 1)}
                  className="w-5 h-5 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="w-6 text-center font-bold font-mono-num text-xs">
                  {toBnNumber(item.quantity)}
                </span>
                <button
                  onClick={() => updateQuantity(idx, item.quantity + 1)}
                  className="w-5 h-5 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              {/* Line Total & Remove */}
              <div className="text-right pl-2">
                <span className="font-bold font-mono-num text-slate-900 block">
                  {formatCurrency(item.total, lang)}
                </span>
                <button
                  onClick={() => removeFromCart(idx)}
                  className="text-rose-500 hover:text-rose-700 p-0.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            );
          })}

          {cart.length === 0 && (
            <div className="py-16 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
              <ShoppingCart className="w-8 h-8 text-slate-300" />
              <span>{'Cart is empty. Select products.'}</span>
            </div>
          )}
        </div>

        {/* Bill Summary & Payment Section */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 space-y-2 text-xs">
          {/* Subtotal, Discount & Tax */}
          <div className="space-y-1 text-slate-600 pb-2 border-b border-slate-200">
            <div className="flex justify-between">
              <span>{'Subtotal'}:</span>
              <span className="font-mono-num font-semibold text-slate-800">{formatCurrency(subtotal, lang)}</span>
            </div>

            <div className="flex items-center justify-between">
              <span>{'Manual Discount (৳)'}:</span>
              <input
                type="number"
                min="0"
                value={orderDiscount || ''}
                onChange={(e) => setOrderDiscount(Math.max(0, Number(e.target.value) || 0))}
                placeholder="0"
                className="w-20 text-right py-0.5 px-1.5 border border-slate-200 rounded bg-white font-mono-num text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {comboDiscountTotal > 0 && (
              <div className="flex justify-between text-purple-700 font-semibold">
                <span className="flex items-center gap-1">
                  <Gift className="w-3.5 h-3.5" />
                  <span>Combo / Bundle Savings:</span>
                </span>
                <span className="font-mono-num">-৳{comboDiscountTotal}</span>
              </div>
            )}

            {vatTaxRate > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>{`VAT/Tax (${vatTaxRate}%)`}:</span>
                <span className="font-mono-num">+{formatCurrency(vatTaxAmount, lang)}</span>
              </div>
            )}

            <div className="flex justify-between text-sm font-bold text-slate-900 pt-1 border-t border-slate-200">
              <span>{'Grand Total'}:</span>
              <span className="font-mono-num text-emerald-700 text-base">{formatCurrency(grandTotal, lang)}</span>
            </div>

            {isBelowSafeFloor && (
              <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[11px] font-semibold flex items-center gap-1.5 mt-1">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>
                  Below Safe Break-even Floor ({formatCurrency(cartMinSafeFloor, lang)}). {approvedAdminName ? `Approved by ${approvedAdminName}.` : 'Admin authorization required.'}
                </span>
              </div>
            )}
            {approvedAdminName && !isBelowSafeFloor && (
              <div className="p-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-[11px] font-semibold flex items-center gap-1 mt-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Discount Approved by Admin ({approvedAdminName})</span>
              </div>
            )}
          </div>

          {/* Payment Method Selector */}
          <div>
            <span className="text-[11px] font-semibold text-slate-700 block mb-1">
              {'Payment Method'}
            </span>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-1">
              {(['cash', 'bkash', 'nagad', 'bank', 'due', 'mixed'] as PaymentMethod[]).map(method => (
                <button
                  key={method}
                  onClick={() => setPaymentMethod(method)}
                  className={`py-1 text-[11px] font-medium rounded-md border capitalize transition-colors ${
                    paymentMethod === method
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {method === 'due'
                    ? ('Due')
                    : method === 'mixed'
                    ? ('Mixed')
                    : method}
                </button>
              ))}
            </div>
          </div>

          {/* Payment Inputs for Single vs Mixed */}
          {paymentMethod === 'mixed' ? (
            /* Mixed Split Payment Inputs */
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-2.5 space-y-2 text-xs">
              <span className="text-[11px] font-bold text-emerald-900 block">
                {'Split / Mixed Payment Breakdown:'}
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-600 font-medium block">
                    {'Cash (৳)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={mixedCash}
                    onChange={(e) => setMixedCash(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0"
                    className="w-full py-1 px-2 border border-slate-200 rounded bg-white font-mono-num font-semibold text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-600 font-medium block">
                    {'bKash (৳)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={mixedBkash}
                    onChange={(e) => setMixedBkash(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0"
                    className="w-full py-1 px-2 border border-slate-200 rounded bg-white font-mono-num font-semibold text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-600 font-medium block">
                    {'Nagad (৳)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={mixedNagad}
                    onChange={(e) => setMixedNagad(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0"
                    className="w-full py-1 px-2 border border-slate-200 rounded bg-white font-mono-num font-semibold text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-600 font-medium block">
                    {'Bank / Card (৳)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={mixedBank}
                    onChange={(e) => setMixedBank(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0"
                    className="w-full py-1 px-2 border border-slate-200 rounded bg-white font-mono-num font-semibold text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-between font-bold pt-1 border-t border-emerald-200 text-xs">
                <span>{'Total Received:'}</span>
                <span className="font-mono-num text-emerald-800">{formatCurrency(mixedTotal, lang)}</span>
              </div>
            </div>
          ) : paymentMethod !== 'due' ? (
            /* Single Tendered Input & Quick Cash Buttons */
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-slate-700">
                  {'Tendered'}:
                </span>
                <input
                  type="number"
                  min="0"
                  value={tenderedAmount}
                  onChange={(e) => setTenderedAmount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
                  placeholder={grandTotal.toString()}
                  className="w-28 text-right py-1 px-2 border border-slate-200 rounded-md bg-white font-mono-num font-bold text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Quick Cash Buttons */}
              <div className="flex items-center gap-1 justify-end">
                {[500, 1000, 2000, 5000].map(amt => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setTenderedAmount(amt)}
                    className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded text-[10px] font-mono-num font-medium transition-colors"
                  >
                    ৳{amt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Change & Due Display */}
          {changeReturn > 0 && (
            <div className="flex justify-between text-xs font-bold text-blue-700 bg-blue-50 px-2 py-1 rounded">
              <span>{'Change Return:'}</span>
              <span className="font-mono-num">{formatCurrency(changeReturn, lang)}</span>
            </div>
          )}
          {dueAmount > 0 && (
            <div className="flex justify-between text-xs font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded">
              <span>{'Pending Due:'}</span>
              <span className="font-mono-num">{formatCurrency(dueAmount, lang)}</span>
            </div>
          )}

          {/* Checkout Button with Double-Submission Prevention */}
          <button
            type="button"
            onClick={() => handleCompleteSale()}
            disabled={cart.length === 0 || isSubmittingSale}
            className={`w-full py-2.5 rounded-lg text-xs md:text-sm font-bold text-white shadow-xs transition-all flex items-center justify-center gap-2 ${
              cart.length === 0 || isSubmittingSale
                ? 'bg-slate-300 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99]'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>
              {isSubmittingSale
                ? ('Processing...')
                : 'Complete Sale & Print'}
              {grandTotal > 0 && ` (${formatCurrency(grandTotal, lang)})`}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Fixed Bottom Cart Bar (lg:hidden) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2.5 shadow-xl flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setMobileCheckoutTab('cart');
            setIsMobileCartOpen(true);
          }}
          className="flex items-center gap-2.5 min-w-0 text-left focus:outline-none"
        >
          <div className="relative w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-sm">
            <ShoppingCart className="w-5 h-5 text-emerald-400" />
            {cartItemCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-xs border-2 border-white">
                {cartItemCount}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block leading-tight">
              {cartItemCount} Item{cartItemCount === 1 ? '' : 's'}
            </span>
            <span className="text-sm font-extrabold text-slate-900 font-mono-num truncate block leading-tight">
              {formatCurrency(grandTotal, lang)}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            if (cart.length === 0) {
              setMobileCheckoutTab('cart');
            } else {
              setMobileCheckoutTab('checkout');
            }
            setIsMobileCartOpen(true);
          }}
          disabled={cart.length === 0}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-white flex items-center gap-1.5 shadow-sm active:scale-[0.98] transition-all whitespace-nowrap ${
            cart.length === 0
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-700/20'
          }`}
        >
          <span>{cart.length === 0 ? 'View Cart' : 'Checkout'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Mobile Cart & Checkout Full-Height Bottom Sheet / Drawer (lg:hidden) */}
      {isMobileCartOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex flex-col justify-end bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-lg mx-auto h-[94vh] sm:h-[90vh] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-200 border-t sm:border border-slate-200">
            {/* Drawer Header */}
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <ShoppingBag className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 truncate">
                    {mobileCheckoutTab === 'cart' ? 'Shopping Cart' : 'Payment & Checkout'}
                  </h3>
                  <span className="text-[11px] text-slate-500 block truncate">
                    {cartItemCount} item{cartItemCount === 1 ? '' : 's'} · Total: <strong className="text-emerald-700 font-mono-num">{formatCurrency(grandTotal, lang)}</strong>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {cart.length > 0 && mobileCheckoutTab === 'cart' && (
                  <button
                    type="button"
                    onClick={clearCart}
                    className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 px-2 py-1 rounded hover:bg-rose-50 transition-colors"
                  >
                    Clear All
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsMobileCartOpen(false)}
                  className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
                  aria-label="Close cart"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Mobile Tab Switcher */}
            <div className="grid grid-cols-2 border-b border-slate-200 bg-white shrink-0 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setMobileCheckoutTab('cart')}
                className={`py-2.5 text-center flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                  mobileCheckoutTab === 'cart'
                    ? 'border-emerald-600 text-emerald-700 bg-emerald-50/40'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                <span>Cart Items ({cartItemCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileCheckoutTab('checkout')}
                className={`py-2.5 text-center flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                  mobileCheckoutTab === 'checkout'
                    ? 'border-emerald-600 text-emerald-700 bg-emerald-50/40'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Payment &amp; Finalize</span>
              </button>
            </div>

            {/* Mobile Content Area - Tab 1: Cart Items */}
            {mobileCheckoutTab === 'cart' ? (
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* Customer Selection Row */}
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <span className="text-[11px] font-semibold text-slate-700 block">
                    Customer Details
                  </span>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-0">
                      <SearchableCombobox
                        ariaLabel="Select Customer"
                        options={customerOptions}
                        value={selectedCustomerId}
                        onChange={setSelectedCustomerId}
                        placeholder="Search customer by name or mobile..."
                        emptyMessage="No matching customers found"
                        size="md"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddCustomerModal(true)}
                      className="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200 transition-colors shrink-0"
                      title="Add new customer"
                    >
                      <UserPlus className="w-4 h-4" />
                    </button>
                  </div>
                  {selectedCustomer && selectedCustomer.currentDue > 0 && (
                    <div className="text-[11px] bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 text-amber-800 flex items-center justify-between">
                      <span>Previous Due:</span>
                      <span className="font-bold font-mono-num">{formatCurrency(selectedCustomer.currentDue, lang)}</span>
                    </div>
                  )}
                </div>

                {/* Cart Items List */}
                <div className="space-y-2">
                  {/* Mobile Applied Combo Offers */}
                  {appliedOffers.map(applied => (
                    <div
                      key={`mob-applied-${applied.offerId}`}
                      className="p-2 bg-purple-50 border border-purple-200 rounded-xl flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Gift className="w-4 h-4 text-purple-600 shrink-0" />
                        <span className="font-bold text-purple-900 truncate">{applied.offerName}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-bold text-purple-800 bg-purple-100 px-1.5 py-0.5 rounded text-[11px] font-mono">
                          -৳{applied.discountAmount}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveComboOffer(applied.offerId)}
                          className="text-purple-400 hover:text-rose-600 p-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Mobile Detected Combo Offers */}
                  {detectedComboOffers
                    .filter(det => !appliedOffers.some(a => a.offerId === det.offer.id))
                    .map(det => (
                      <div
                        key={`mob-detected-${det.offer.id}`}
                        className="p-2.5 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-300 rounded-xl flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 font-bold text-emerald-900 truncate">
                            <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="truncate">{det.offer.name}</span>
                          </div>
                          <p className="text-[10px] text-emerald-700">
                            {det.isPartialMatch ? det.description : `Save ৳${det.discountAmount} with bundle`}
                          </p>
                        </div>
                        {!det.isPartialMatch && (
                          <button
                            type="button"
                            onClick={() => handleApplyComboOffer(det)}
                            className="px-2.5 py-1 bg-emerald-600 text-white font-bold rounded-lg text-xs shrink-0"
                          >
                            Apply
                          </button>
                        )}
                      </div>
                    ))
                  }

                  {cart.map((item, idx) => {
                    const matchedProd = products.find(p => p.id === item.productId);
                    const itemImg =
                      item.imageUrl ||
                      resolveProductImage(matchedProd, {
                        colorId: item.colorId,
                        variantId: item.variantId,
                        colorName: item.colorName,
                      });
                    return (
                    <div
                      key={`mobile-${item.productId}-${item.variantId || 'base'}-${idx}`}
                      className="p-2.5 bg-white border border-slate-200 rounded-xl text-xs flex flex-col gap-2 shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <ProductThumbnail
                          src={itemImg}
                          alt={item.productName}
                          colorHex={item.colorName ? inferColorHex(item.colorName) : undefined}
                          colorName={item.colorName}
                          size="xs"
                        />
                        <div className="min-w-0 flex-1">
                          <h5 className="font-semibold text-slate-900 leading-snug">
                            {item.productName}
                          </h5>
                          <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                            {item.variantDetails && (
                              <span className="text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded font-medium text-[10px]">
                                {item.variantDetails}
                              </span>
                            )}
                            <span>@{formatCurrency(item.unitPrice, lang)}</span>
                            {item.discount > 0 && (
                              <span className="text-emerald-600 font-medium">-৳{item.discount}</span>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeFromCart(idx)}
                          className="text-slate-400 hover:text-rose-600 p-1 rounded-lg hover:bg-rose-50 transition-colors shrink-0"
                          title="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Quantity & Item Total Row */}
                      <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
                        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                          <button
                            type="button"
                            onClick={() => updateQuantity(idx, item.quantity - 1)}
                            className="w-7 h-7 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-100 active:scale-95 transition-all"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-8 text-center font-bold font-mono-num text-xs text-slate-900">
                            {toBnNumber(item.quantity)}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(idx, item.quantity + 1)}
                            className="w-7 h-7 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-100 active:scale-95 transition-all"
                            aria-label="Increase quantity"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="text-right">
                          <span className="text-[10px] text-slate-400 block uppercase">Subtotal</span>
                          <span className="font-extrabold text-sm font-mono-num text-emerald-700">
                            {formatCurrency(item.total, lang)}
                          </span>
                        </div>
                      </div>
                    </div>
                    );
                  })}

                  {cart.length === 0 && (
                    <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                        <ShoppingCart className="w-6 h-6" />
                      </div>
                      <p className="font-medium text-slate-600">Your shopping cart is empty.</p>
                      <button
                        type="button"
                        onClick={() => setIsMobileCartOpen(false)}
                        className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded-xl text-xs hover:bg-emerald-700 transition-colors shadow-xs"
                      >
                        Browse Products
                      </button>
                    </div>
                  )}
                </div>

                {/* Order Summary Card */}
                {cart.length > 0 && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs text-slate-600">
                    <div className="flex justify-between">
                      <span>Subtotal:</span>
                      <span className="font-mono-num font-semibold text-slate-800">{formatCurrency(subtotal, lang)}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span>Manual Discount (৳):</span>
                      <input
                        type="number"
                        min="0"
                        value={orderDiscount || ''}
                        onChange={(e) => setOrderDiscount(Math.max(0, Number(e.target.value) || 0))}
                        placeholder="0"
                        className="w-24 text-right py-1 px-2 border border-slate-200 rounded-md bg-white font-mono-num text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>

                    {comboDiscountTotal > 0 && (
                      <div className="flex justify-between text-purple-700 font-semibold">
                        <span className="flex items-center gap-1">
                          <Gift className="w-3.5 h-3.5" />
                          <span>Combo Savings:</span>
                        </span>
                        <span className="font-mono-num">-৳{comboDiscountTotal}</span>
                      </div>
                    )}

                    {vatTaxRate > 0 && (
                      <div className="flex justify-between">
                        <span>VAT/Tax ({vatTaxRate}%):</span>
                        <span className="font-mono-num">+{formatCurrency(vatTaxAmount, lang)}</span>
                      </div>
                    )}

                    <div className="flex justify-between text-sm font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                      <span>Grand Total:</span>
                      <span className="font-mono-num text-emerald-700 text-base">{formatCurrency(grandTotal, lang)}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Mobile Content Area - Tab 2: Checkout & Payment */
              <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
                {/* Order Summary Snapshot */}
                <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-emerald-900 uppercase tracking-wide">
                      Order Summary ({cartItemCount} items)
                    </span>
                    <button
                      type="button"
                      onClick={() => setMobileCheckoutTab('cart')}
                      className="text-[11px] text-emerald-700 underline font-semibold"
                    >
                      Edit Items
                    </button>
                  </div>
                  <div className="flex items-baseline justify-between pt-1">
                    <span className="text-xs text-slate-600">Grand Total Payable:</span>
                    <span className="text-lg font-extrabold font-mono-num text-emerald-800">
                      {formatCurrency(grandTotal, lang)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 flex justify-between">
                    <span>Subtotal: {formatCurrency(subtotal, lang)}</span>
                    {totalDiscount > 0 && <span className="text-rose-600">Discount: -{formatCurrency(totalDiscount, lang)}</span>}
                    {vatTaxRate > 0 && <span>Tax: +{formatCurrency(vatTaxAmount, lang)}</span>}
                  </div>
                </div>

                {/* Customer Details */}
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <span className="text-[11px] font-semibold text-slate-700 block">
                    Customer Selection
                  </span>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-0">
                      <SearchableCombobox
                        ariaLabel="Select Customer"
                        options={customerOptions}
                        value={selectedCustomerId}
                        onChange={setSelectedCustomerId}
                        placeholder="Search customer by name or mobile..."
                        emptyMessage="No matching customers found"
                        size="md"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddCustomerModal(true)}
                      className="p-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-[10px] transition-colors shrink-0 cursor-pointer"
                      title="Add new customer"
                    >
                      <UserPlus className="w-4 h-4" />
                    </button>
                  </div>
                  {selectedCustomer && selectedCustomer.currentDue > 0 && (
                    <div className="text-[11px] bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 text-amber-800 flex items-center justify-between">
                      <span>Previous Customer Due:</span>
                      <span className="font-bold font-mono-num">{formatCurrency(selectedCustomer.currentDue, lang)}</span>
                    </div>
                  )}
                </div>

                {/* Payment Method Selector Grid */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-700 block">
                    Payment Method *
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'cash', label: 'Cash', icon: Banknote },
                        { id: 'bkash', label: 'bKash', icon: Smartphone },
                        { id: 'nagad', label: 'Nagad', icon: Smartphone },
                        { id: 'bank', label: 'Bank', icon: Landmark },
                        { id: 'due', label: 'Due / Credit', icon: Receipt },
                        { id: 'mixed', label: 'Mixed', icon: Layers },
                      ] as const
                    ).map(m => {
                      const Icon = m.icon;
                      const isSelected = paymentMethod === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setPaymentMethod(m.id as PaymentMethod)}
                          className={`py-2 px-1.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                            isSelected
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs font-bold'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 font-medium'
                          }`}
                        >
                          <Icon className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-slate-500'}`} />
                          <span className="text-[11px] truncate">{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Payment Input Details */}
                {paymentMethod === 'mixed' ? (
                  <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 space-y-2.5">
                    <span className="text-[11px] font-bold text-emerald-900 block">
                      Mixed Payment Breakdown (৳)
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-600 font-medium block mb-0.5">Cash</label>
                        <input
                          type="number"
                          min="0"
                          value={mixedCash}
                          onChange={(e) => setMixedCash(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
                          placeholder="0"
                          className="w-full py-1.5 px-2 border border-slate-200 rounded-lg bg-white font-mono-num font-semibold text-xs focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-600 font-medium block mb-0.5">bKash</label>
                        <input
                          type="number"
                          min="0"
                          value={mixedBkash}
                          onChange={(e) => setMixedBkash(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
                          placeholder="0"
                          className="w-full py-1.5 px-2 border border-slate-200 rounded-lg bg-white font-mono-num font-semibold text-xs focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-600 font-medium block mb-0.5">Nagad</label>
                        <input
                          type="number"
                          min="0"
                          value={mixedNagad}
                          onChange={(e) => setMixedNagad(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
                          placeholder="0"
                          className="w-full py-1.5 px-2 border border-slate-200 rounded-lg bg-white font-mono-num font-semibold text-xs focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-600 font-medium block mb-0.5">Bank / Card</label>
                        <input
                          type="number"
                          min="0"
                          value={mixedBank}
                          onChange={(e) => setMixedBank(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
                          placeholder="0"
                          className="w-full py-1.5 px-2 border border-slate-200 rounded-lg bg-white font-mono-num font-semibold text-xs focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="flex justify-between font-bold pt-1.5 border-t border-emerald-200 text-xs">
                      <span>Total Received:</span>
                      <span className="font-mono-num text-emerald-800">{formatCurrency(mixedTotal, lang)}</span>
                    </div>
                  </div>
                ) : paymentMethod !== 'due' ? (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-slate-700">
                        Tendered Amount:
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tenderedAmount}
                        onChange={(e) => setTenderedAmount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
                        placeholder={grandTotal.toString()}
                        className="w-32 text-right py-1.5 px-2.5 border border-slate-200 rounded-lg bg-white font-mono-num font-bold text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>

                    {/* Quick Amount Buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => setTenderedAmount(grandTotal)}
                        className="px-2 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-md text-[11px] font-semibold transition-colors"
                      >
                        Exact (৳{grandTotal})
                      </button>
                      {[500, 1000, 2000, 5000].map(amt => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setTenderedAmount(amt)}
                          className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-md text-[11px] font-mono-num font-medium transition-colors"
                        >
                          ৳{amt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 space-y-1">
                    <p className="font-semibold text-xs">Due / Credit Sale Selected</p>
                    <p className="text-[11px]">
                      The full invoice total ({formatCurrency(grandTotal, lang)}) will be recorded as pending customer due.
                    </p>
                    {!selectedCustomerId && (
                      <p className="text-[11px] font-bold text-rose-700 mt-1">
                        * Please select a registered customer to enable Due sale.
                      </p>
                    )}
                  </div>
                )}

                {/* Change Return / Pending Due Feedback */}
                {changeReturn > 0 && (
                  <div className="flex justify-between text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-3 py-2 rounded-xl">
                    <span>Change to Return:</span>
                    <span className="font-mono-num">{formatCurrency(changeReturn, lang)}</span>
                  </div>
                )}
                {dueAmount > 0 && paymentMethod !== 'due' && (
                  <div className="flex justify-between text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl">
                    <span>Pending Due Amount:</span>
                    <span className="font-mono-num">{formatCurrency(dueAmount, lang)}</span>
                  </div>
                )}

                {/* Order Notes */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Sale Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Delivered to home, special packaging..."
                    className="w-full py-1.5 px-2.5 border border-slate-200 rounded-lg bg-white text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>
            )}

            {/* Bottom Actions Footer */}
            <div className="p-3 border-t border-slate-200 bg-slate-50 shrink-0 space-y-2">
              {mobileCheckoutTab === 'cart' ? (
                <button
                  type="button"
                  onClick={() => setMobileCheckoutTab('checkout')}
                  disabled={cart.length === 0}
                  className={`w-full py-3 rounded-xl text-xs sm:text-sm font-bold text-white shadow-xs transition-all flex items-center justify-center gap-2 ${
                    cart.length === 0
                      ? 'bg-slate-300 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] shadow-emerald-700/20'
                  }`}
                >
                  <span>Proceed to Payment ({formatCurrency(grandTotal, lang)})</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => handleCompleteSale()}
                    disabled={cart.length === 0 || isSubmittingSale || (dueAmount > 0 && !selectedCustomerId)}
                    className={`w-full py-3 rounded-xl text-xs sm:text-sm font-bold text-white shadow-xs transition-all flex items-center justify-center gap-2 ${
                      cart.length === 0 || isSubmittingSale || (dueAmount > 0 && !selectedCustomerId)
                        ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] shadow-emerald-700/20'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>
                      {isSubmittingSale ? 'Processing...' : 'Complete Sale & Print'}
                      {grandTotal > 0 && ` (${formatCurrency(grandTotal, lang)})`}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMobileCheckoutTab('cart')}
                    className="w-full py-1.5 text-slate-600 hover:text-slate-900 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Cart Items</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Clothing Variant Selector Modal */}
      {variantProduct && (() => {
        const modalColors = resolveProductColors(variantProduct);
        const activeFilterColor = modalColors.find(c => c.id === variantModalColorFilter);
        const modalVariants = (variantProduct.variants || []).filter(v => {
          if (!activeFilterColor) return true;
          if (v.colorId && !activeFilterColor.id.startsWith('local-color-')) {
            return v.colorId === activeFilterColor.id;
          }
          return normalizeColorKey(v.color) === normalizeColorKey(activeFilterColor.colorName);
        });
        const headerPreviewUrl = resolveProductImage(variantProduct, {
          colorId: activeFilterColor?.id,
          colorName: activeFilterColor?.colorName,
        });

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg p-5 space-y-3.5">
              <div className="flex items-center justify-between border-b pb-2.5 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <ProductThumbnail
                    src={headerPreviewUrl}
                    alt={variantProduct.name}
                    colorHex={activeFilterColor?.colorHex}
                    colorName={activeFilterColor?.colorName}
                    size="md"
                  />
                  <div className="min-w-0">
                    <h3 className="font-bold text-sm text-slate-900 truncate">{variantProduct.name}</h3>
                    <span className="text-xs text-slate-500">
                      {activeFilterColor ? `Showing Color: ${activeFilterColor.colorName}` : 'Select Color & Size Variant'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setVariantProduct(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {modalColors.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setVariantModalColorFilter('all')}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                      variantModalColorFilter === 'all'
                        ? 'border-[#087F8C] bg-[#087F8C]/10 text-[#087F8C]'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    All Colors
                  </button>
                  {modalColors.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setVariantModalColorFilter(c.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                        variantModalColorFilter === c.id
                          ? 'border-[#087F8C] bg-[#087F8C]/10 text-[#087F8C]'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-slate-300"
                        style={{ backgroundColor: c.colorHex }}
                      />
                      <span>{c.colorName}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                {modalVariants.map(v => {
                  const isOut = v.stock <= 0;
                  const price =
                    v.salePrice !== undefined
                      ? v.salePrice
                      : v.additionalPrice
                      ? variantProduct.salePrice + v.additionalPrice
                      : variantProduct.salePrice;
                  const variantImg = resolveProductImage(variantProduct, {
                    colorId: v.colorId,
                    variantId: v.id,
                    colorName: v.color,
                  });

                  return (
                    <button
                      key={v.id}
                      disabled={isOut}
                      onClick={() => addToCart(variantProduct, v)}
                      className={`p-3 rounded-xl border text-left flex flex-col justify-between space-y-2 transition-all cursor-pointer ${
                        isOut
                          ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                          : 'bg-white hover:border-purple-500 hover:bg-purple-50/40 border-slate-200 shadow-xs'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 w-full">
                        <ProductThumbnail
                          src={variantImg}
                          alt={`${variantProduct.name} ${v.color || ''}`}
                          colorHex={v.color ? inferColorHex(v.color, v.colorHex) : undefined}
                          colorName={v.color}
                          size="sm"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold text-slate-900 text-xs truncate">
                              {v.color || 'Standard'}
                            </span>
                            <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 text-[10px] font-mono font-bold shrink-0">
                              {v.size || 'Free'}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                            SKU: {v.sku}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between w-full pt-1.5 border-t border-slate-100 text-xs">
                        <span className="font-extrabold text-slate-900 font-mono-num">
                          {formatCurrency(price, lang)}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            isOut
                              ? 'bg-rose-100 text-rose-700'
                              : v.stock <= (v.minStockAlert || 5)
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {isOut ? 'Out of Stock' : `${v.stock} in stock`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Quick Add Customer Modal */}
      {showAddCustomerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <form
            onSubmit={handleQuickAddCustomer}
            className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-sm p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-sm text-slate-900">
                {'Quick Add Customer'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddCustomerModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Name *'}</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="e.g. John Doe / Customer Name"
                  className="w-full p-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Mobile'}</label>
                <input
                  type="text"
                  value={newCustMobile}
                  onChange={(e) => setNewCustMobile(e.target.value)}
                  placeholder="017xxxxxxxx"
                  className="w-full p-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowAddCustomerModal(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {'Cancel'}
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
              >
                {'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Completed Invoice Modal */}
      {completedSale && (
        <InvoiceModal
          sale={completedSale}
          onClose={() => setCompletedSale(null)}
          settings={settings}
        />
      )}

      {/* Admin Authorization Modal for Discount Protection */}
      {isAdminAuthModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-rose-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    Admin Authorization Required
                  </h3>
                  <span className="text-[11px] text-rose-600 font-semibold">
                    Loss-Making Sale Protection
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAdminAuthModalOpen(false);
                  setAdminAuthError(null);
                  setAdminAuthPin('');
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1.5 text-rose-900">
                <div className="flex justify-between font-semibold">
                  <span>Grand Total Offered:</span>
                  <span className="font-mono-num font-bold text-rose-700">{formatCurrency(grandTotal, lang)}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>Break-even Safe Floor:</span>
                  <span className="font-mono-num font-bold">{formatCurrency(cartMinSafeFloor, lang)}</span>
                </div>
                <p className="text-[11px] text-rose-700 pt-1 border-t border-rose-200">
                  This transaction is priced below product landed costs and shop operating expenses. An authorized store manager or owner must approve this sale.
                </p>
              </div>

              {adminAuthError && (
                <div className="p-2 bg-rose-100 text-rose-800 rounded-lg text-xs font-semibold">
                  {adminAuthError}
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Enter Admin Authorization PIN or Master Password
                </label>
                <input
                  type="password"
                  value={adminAuthPin}
                  onChange={e => {
                    setAdminAuthPin(e.target.value);
                    setAdminAuthError(null);
                  }}
                  placeholder="Admin PIN (default: 1234 or Admin Password)"
                  className="w-full p-2.5 border border-slate-200 rounded-lg font-mono text-center tracking-widest text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => {
                  setIsAdminAuthModalOpen(false);
                  setAdminAuthError(null);
                  setAdminAuthPin('');
                }}
                className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
              >
                Cancel Sale
              </button>
              <button
                type="button"
                onClick={() => {
                  const configuredPin = settings.adminAuthorizationPin?.trim() || '1234';
                  if (adminAuthPin.trim() === configuredPin) {
                    const approverName = user?.user_metadata?.full_name || 'Admin Authorized';
                    setApprovedAdminName(approverName);
                    setIsAdminAuthModalOpen(false);
                    setAdminAuthPin('');
                    setAdminAuthError(null);
                    handleCompleteSale(approverName);
                  } else {
                    setAdminAuthError('Invalid Admin Authorization PIN. Please contact store owner.');
                  }
                }}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Approve &amp; Complete Sale</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
