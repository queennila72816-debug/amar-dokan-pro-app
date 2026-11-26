import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  ComboOffer,
  ComboOfferItem,
  OfferType,
  OfferStatus,
  OfferDiscountType,
  MarketplaceComboOrderStatus,
  Product,
  ProductVariant,
} from '../../types';
import { comboOfferService } from '../../services/comboOfferService';
import { normalizeRoleKey } from '../../utils/rbacDefaults';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { ScannerModal } from '../scanner/ScannerModal';
import { useHardwareScanner } from '../../hooks/useHardwareScanner';
import {
  getScannerHidPreferences,
  lookupProductByScannedCode,
  playScanBeep,
  ScannedProductMatch,
} from '../../utils/scannerLookup';
import { inferColorHex, resolveProductImage } from '../../utils/productImageResolver';
import { validateImageFile } from '../../services/catalogImageService';
import {
  ComboPdfFormat,
  ComboPrintFormat,
  downloadComboOfferPdf,
  printComboOffer,
} from '../../utils/comboExport';
import {
  buildAppPreviewComboLink,
  buildMarketplaceSlug,
  resolveComboMarketplaceQrUrl,
} from '../../utils/comboPosterEngine';
import { ComboPosterStudioModal } from './ComboPosterStudioModal';
import { ComboMarketplacePreviewModal } from './ComboMarketplacePreviewModal';
import {
  Tag,
  Plus,
  Search,
  CheckCircle,
  AlertTriangle,
  Layers,
  Percent,
  Gift,
  ShoppingBag,
  TrendingUp,
  DollarSign,
  ShieldAlert,
  Trash2,
  Edit2,
  Copy,
  Archive,
  Play,
  Pause,
  Sparkles,
  BarChart3,
  Download,
  Check,
  X,
  Eye,
  ScanBarcode,
  Image as ImageIcon,
  History,
  Minus,
  Package,
  Calendar,
  Printer,
  FileDown,
  Loader2,
  Globe,
  Link2,
  Wand2,
  Truck,
} from 'lucide-react';

const COMBO_CATEGORY_PRESETS = [
  'Eid Special Combo',
  'Summer Fashion Pack',
  'Winter Bundle',
  'Office Wear Set',
  'Family Value Pack',
  'Festive Deal',
  'Clearance Bundle',
];

const DECIMAL_DISCOUNT_PRESETS = [5, 7.5, 10, 12.5, 15, 20];

const compressCoverImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 640;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('Could not read image preview.'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Failed to load selected image file.'));
    reader.readAsDataURL(file);
  });

export interface ComboOffersViewProps {
  onOpenSettings?: () => void;
  initialMarketplaceComboId?: string | null;
  onConsumeMarketplaceComboId?: () => void;
}

export const ComboOffersView: React.FC<ComboOffersViewProps> = ({
  onOpenSettings,
  initialMarketplaceComboId,
  onConsumeMarketplaceComboId,
}) => {
  const {
    comboOffers,
    comboUsageLogs,
    addComboOffer,
    updateComboOffer,
    toggleOfferStatus,
    archiveComboOffer,
    deleteComboOffer,
    marketplaceOrders,
    createMarketplaceOrder,
    updateMarketplaceOrderStatus,
    products,
    categories,
    branches,
    activeBranchId,
    settings,
    currentUserRole,
    isAuthenticatedAdmin,
    hasPermission,
    sales,
  } = useApp();

  const roleKey = normalizeRoleKey(currentUserRole);
  const isAdmin = isAuthenticatedAdmin || roleKey === 'super_admin';
  const canManageCombos =
    isAdmin ||
    roleKey === 'manager' ||
    hasPermission('product_management', 'create') ||
    hasPermission('product_management', 'edit');
  const canDeleteCombos = isAdmin || hasPermission('product_management', 'delete');
  const canProcessOnlineOrders =
    isAdmin ||
    roleKey === 'manager' ||
    hasPermission('pos_new_sale', 'create') ||
    hasPermission('product_management', 'edit');
  const canViewCosts = isAdmin || roleKey === 'manager' || roleKey === 'accountant';
  const lang = settings.language || 'en';
  const currency = settings.currency || '৳';

  const [activeTab, setActiveTab] = useState<'offers' | 'create' | 'analytics' | 'orders'>('offers');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<string>('all');
  const [selectedComboCategoryFilter, setSelectedComboCategoryFilter] = useState<string>('all');
  const [bannerMessage, setBannerMessage] = useState<{
    tone: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);
  const [isSavingOffer, setIsSavingOffer] = useState(false);

  // Builder State
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formComboCategory, setFormComboCategory] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formImage, setFormImage] = useState('');
  const [formType, setFormType] = useState<OfferType>('fixed_price');
  const [formDiscountType, setFormDiscountType] = useState<OfferDiscountType>('percentage');
  const [formDiscountValue, setFormDiscountValue] = useState<number>(10);
  const [formMinSpendAmount, setFormMinSpendAmount] = useState<number>(0);
  const [formMinQuantity, setFormMinQuantity] = useState<number>(2);
  const [formStartDate, setFormStartDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [formEndDate, setFormEndDate] = useState<string>('');
  const [formBranchId, setFormBranchId] = useState<string>('all');
  const [formStatus, setFormStatus] = useState<OfferStatus>('active');
  const [formMaxUsageTotal, setFormMaxUsageTotal] = useState<number | undefined>(undefined);
  const [formMaxUsagePerCustomer, setFormMaxUsagePerCustomer] = useState<number | undefined>(
    undefined
  );
  const [formPriority, setFormPriority] = useState<number>(10);
  const [formItems, setFormItems] = useState<ComboOfferItem[]>([]);

  // Admin Override for loss-making floor protection
  const [allowBelowFloor, setAllowBelowFloor] = useState<boolean>(false);
  const [overrideReason, setOverrideReason] = useState<string>('');

  // Left Panel Inventory Browser State
  const [builderSearch, setBuilderSearch] = useState('');
  const [builderCategory, setBuilderCategory] = useState('all');
  const [rowVariantChoice, setRowVariantChoice] = useState<Record<string, string>>({});
  const [rowQtyChoice, setRowQtyChoice] = useState<Record<string, number>>({});
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // Modals: Preview, Details + Sales History, Delete Confirmation
  const [previewOffer, setPreviewOffer] = useState<ComboOffer | null>(null);
  const [comboPrintFormat, setComboPrintFormat] = useState<ComboPrintFormat>('a4');
  const [comboPdfFormat, setComboPdfFormat] = useState<ComboPdfFormat>('a4');
  const [isPrintingCombo, setIsPrintingCombo] = useState(false);
  const [isDownloadingComboPdf, setIsDownloadingComboPdf] = useState(false);
  const [previewActionError, setPreviewActionError] = useState<string | null>(null);
  const [detailsOffer, setDetailsOffer] = useState<ComboOffer | null>(null);
  const [deleteTargetOffer, setDeleteTargetOffer] = useState<ComboOffer | null>(null);
  const [isDeletingOffer, setIsDeletingOffer] = useState(false);

  // Poster Studio & Marketplace States
  const [posterStudioOfferId, setPosterStudioOfferId] = useState<string | null>(null);
  const [marketplacePreviewOfferId, setMarketplacePreviewOfferId] = useState<string | null>(null);
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const [processingOrderId, setProcessingOrderId] = useState<string | null>(null);
  const [copiedOfferId, setCopiedOfferId] = useState<string | null>(null);

  React.useEffect(() => {
    if (initialMarketplaceComboId) {
      const exists = comboOffers.some(o => o.id === initialMarketplaceComboId);
      if (exists) {
        setMarketplacePreviewOfferId(initialMarketplaceComboId);
        onConsumeMarketplaceComboId?.();
      }
    }
  }, [initialMarketplaceComboId, comboOffers, onConsumeMarketplaceComboId]);

  const activePosterOffer = useMemo(
    () => comboOffers.find(o => o.id === posterStudioOfferId) || null,
    [comboOffers, posterStudioOfferId]
  );

  const activeMarketplaceOffer = useMemo(
    () => comboOffers.find(o => o.id === marketplacePreviewOfferId) || null,
    [comboOffers, marketplacePreviewOfferId]
  );

  const pendingOnlineOrdersCount = useMemo(
    () => marketplaceOrders.filter(o => o.status === 'pending').length,
    [marketplaceOrders]
  );

  // Analytics Date Filters
  const [analyticsRange, setAnalyticsRange] = useState<
    'today' | 'week' | 'month' | 'all' | 'custom'
  >('month');
  const [analyticsStartDate, setAnalyticsStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [analyticsEndDate, setAnalyticsEndDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  // Branch effective for builder stock display
  const builderStockBranch =
    formBranchId && formBranchId !== 'all' ? formBranchId : activeBranchId;

  const productCategories = useMemo(() => {
    const set = new Set<string>();
    categories.forEach(c => {
      if (c.name) set.add(c.name);
    });
    products.forEach(p => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort();
  }, [categories, products]);

  const comboCategories = useMemo(() => {
    const set = new Set<string>(COMBO_CATEGORY_PRESETS);
    comboOffers.forEach(o => {
      if (o.comboCategory) set.add(o.comboCategory);
    });
    return Array.from(set);
  }, [comboOffers]);

  // Real-time Builder P&L Calculation
  const livePnL = useMemo(() => {
    return comboOfferService.calculateComboPnL(
      formItems,
      formDiscountType,
      formDiscountValue,
      products
    );
  }, [formItems, formDiscountType, formDiscountValue, products]);

  // Equivalent discount percentage displayed even when manually entering final price
  const equivalentDiscountPercent = useMemo(() => {
    if (formDiscountType === 'percentage') {
      return Number(Math.min(100, Math.max(0, formDiscountValue)).toFixed(2));
    }
    return comboOfferService.calculateEquivalentDiscountPercent(
      livePnL.regularTotalPrice,
      livePnL.finalComboPrice
    );
  }, [formDiscountType, formDiscountValue, livePnL.regularTotalPrice, livePnL.finalComboPrice]);

  // Left Panel filtered products
  const builderProducts = useMemo(() => {
    const q = builderSearch.trim().toLowerCase();
    return products.filter(p => {
      if (p.isActive === false) return false;
      if (builderStockBranch && p.branchId && p.branchId !== builderStockBranch) {
        return false;
      }
      if (builderCategory !== 'all' && p.category !== builderCategory) {
        return false;
      }
      if (!q) return true;
      const matchesMain =
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q));
      const matchesVariant = p.variants?.some(
        v =>
          v.sku.toLowerCase().includes(q) ||
          (v.barcode && v.barcode.toLowerCase().includes(q)) ||
          (v.size && v.size.toLowerCase().includes(q)) ||
          (v.color && v.color.toLowerCase().includes(q))
      );
      return Boolean(matchesMain || matchesVariant);
    });
  }, [products, builderCategory, builderSearch, builderStockBranch]);

  // Filtered offers list
  const filteredOffers = useMemo(() => {
    return comboOffers.filter(offer => {
      if (!canManageCombos && offer.status !== 'active') {
        return false;
      }
      if (selectedStatusFilter !== 'all' && offer.status !== selectedStatusFilter) {
        return false;
      }
      if (
        selectedBranchFilter !== 'all' &&
        offer.branchId &&
        offer.branchId !== 'all' &&
        offer.branchId !== selectedBranchFilter
      ) {
        return false;
      }
      if (
        selectedComboCategoryFilter !== 'all' &&
        (offer.comboCategory || '') !== selectedComboCategoryFilter
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = offer.name.toLowerCase().includes(q);
        const matchDesc = offer.description?.toLowerCase().includes(q);
        const matchCat = offer.comboCategory?.toLowerCase().includes(q);
        const matchItem = offer.items.some(
          it =>
            it.productName.toLowerCase().includes(q) ||
            (it.sku && it.sku.toLowerCase().includes(q))
        );
        return Boolean(matchName || matchDesc || matchCat || matchItem);
      }
      return true;
    });
  }, [
    comboOffers,
    canManageCombos,
    selectedStatusFilter,
    selectedBranchFilter,
    selectedComboCategoryFilter,
    searchQuery,
  ]);

  // Unified usage dataset combining persisted comboUsageLogs + fallback synthesis from sales records
  const normalizedUsageRecords = useMemo(() => {
    const activeSalesById = new Map(sales.map(s => [s.id, s]));
    const logKeys = new Set<string>();
    const records: {
      id: string;
      offerId: string;
      offerName: string;
      saleId: string;
      invoiceNumber: string;
      comboQuantity: number;
      customerName: string;
      revenue: number;
      discountGiven: number;
      costOfGoods: number;
      grossProfit: number;
      date: string;
      branchId: string;
      components: {
        productId: string;
        productName: string;
        variantId?: string;
        variantDetails?: string;
        sku?: string;
        qty: number;
        allocatedTotal: number;
      }[];
    }[] = [];

    comboUsageLogs.forEach(log => {
      const linkedSale = activeSalesById.get(log.saleId);
      if (linkedSale && (linkedSale.status === 'voided' || linkedSale.status === 'returned')) {
        return;
      }
      const key = `${log.saleId}::${log.offerId}::${log.comboInstanceId || ''}`;
      logKeys.add(key);

      const saleComboItems = linkedSale
        ? linkedSale.items.filter(
            it =>
              it.comboOfferId === log.offerId &&
              (!log.comboInstanceId || it.comboInstanceId === log.comboInstanceId)
          )
        : [];

      const components =
        log.components && log.components.length > 0
          ? log.components.map(c => ({
              productId: c.productId,
              productName: c.productName,
              variantId: c.variantId,
              variantDetails: c.variantDetails,
              sku: c.sku,
              qty: c.totalQtyDeducted,
              allocatedTotal: c.allocatedTotal,
            }))
          : saleComboItems.map(it => ({
              productId: it.productId,
              productName: it.productName,
              variantId: it.variantId,
              variantDetails: it.variantDetails,
              sku: it.sku,
              qty: it.quantity,
              allocatedTotal: it.total,
            }));

      records.push({
        id: log.id,
        offerId: log.offerId,
        offerName: log.offerName || comboOffers.find(o => o.id === log.offerId)?.name || 'Combo Offer',
        saleId: log.saleId,
        invoiceNumber: log.invoiceNumber,
        comboQuantity: log.comboQuantity || 1,
        customerName: log.customerName || 'Walk-in Customer',
        revenue: log.revenue,
        discountGiven: log.discountGiven,
        costOfGoods: log.costOfGoods,
        grossProfit: log.grossProfit,
        date: log.date,
        branchId: log.branchId,
        components,
      });
    });

    // Also include any sales that carry comboPackages / appliedOffers not yet reflected in comboUsageLogs
    sales.forEach(s => {
      if (s.status === 'voided' || s.status === 'returned') return;
      if (s.comboPackages && s.comboPackages.length > 0) {
        s.comboPackages.forEach(pkg => {
          const key = `${s.id}::${pkg.offerId}::${pkg.instanceId}`;
          const fallbackKey = `${s.id}::${pkg.offerId}::`;
          if (logKeys.has(key) || logKeys.has(fallbackKey)) return;
          const matchingItems = s.items.filter(
            it => it.comboOfferId === pkg.offerId && (!it.comboInstanceId || it.comboInstanceId === pkg.instanceId)
          );
          const cogs = matchingItems.reduce((sum, it) => sum + (it.purchasePrice || 0) * it.quantity, 0);
          records.push({
            id: `syn-${s.id}-${pkg.instanceId}`,
            offerId: pkg.offerId,
            offerName: pkg.offerName,
            saleId: s.id,
            invoiceNumber: s.invoiceNumber,
            comboQuantity: pkg.quantity,
            customerName: s.customerName,
            revenue: pkg.lineTotal,
            discountGiven: pkg.discountTotal,
            costOfGoods: cogs,
            grossProfit: pkg.lineTotal - cogs,
            date: s.date,
            branchId: s.branchId,
            components: pkg.components.map(c => ({
              productId: c.productId,
              productName: c.productName,
              variantId: c.variantId,
              variantDetails: c.variantDetails,
              sku: c.sku,
              qty: c.totalQty,
              allocatedTotal: c.allocatedTotal,
            })),
          });
        });
      } else if (s.appliedOffers && s.appliedOffers.length > 0) {
        s.appliedOffers.forEach(ao => {
          const key = `${s.id}::${ao.offerId}::${ao.comboInstanceId || ''}`;
          if (logKeys.has(key)) return;
          const cogs = s.items.reduce((sum, it) => sum + (it.purchasePrice || 0) * it.quantity, 0);
          records.push({
            id: `syn-${s.id}-${ao.offerId}`,
            offerId: ao.offerId,
            offerName: ao.offerName,
            saleId: s.id,
            invoiceNumber: s.invoiceNumber,
            comboQuantity: ao.comboQuantity || 1,
            customerName: s.customerName,
            revenue: s.total,
            discountGiven: ao.discountAmount,
            costOfGoods: cogs,
            grossProfit: s.total - cogs,
            date: s.date,
            branchId: s.branchId,
            components: s.items.map(it => ({
              productId: it.productId,
              productName: it.productName,
              variantId: it.variantId,
              variantDetails: it.variantDetails,
              sku: it.sku,
              qty: it.quantity,
              allocatedTotal: it.total,
            })),
          });
        });
      }
    });

    return records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [comboUsageLogs, comboOffers, sales]);

  // Analytics Filtered by Date Range
  const analyticsData = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfWeek = startOfToday - 6 * 86400_000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const filteredLogs = normalizedUsageRecords.filter(r => {
      if (selectedBranchFilter !== 'all' && r.branchId && r.branchId !== 'all' && r.branchId !== selectedBranchFilter) {
        return false;
      }
      const ts = new Date(r.date).getTime();
      if (Number.isNaN(ts)) return false;
      if (analyticsRange === 'today') return ts >= startOfToday;
      if (analyticsRange === 'week') return ts >= startOfWeek;
      if (analyticsRange === 'month') return ts >= startOfMonth;
      if (analyticsRange === 'custom') {
        const sTs = analyticsStartDate ? new Date(`${analyticsStartDate}T00:00:00`).getTime() : 0;
        const eTs = analyticsEndDate ? new Date(`${analyticsEndDate}T23:59:59.999`).getTime() : Infinity;
        return ts >= sTs && ts <= eTs;
      }
      return true;
    });

    const totalCombos = comboOffers.filter(o => o.status !== 'archived').length;
    const activeCombos = comboOffers.filter(
      o => comboOfferService.isOfferCurrentlyValid(o, now).valid
    ).length;
    const expiredCombos = comboOffers.filter(o => {
      const check = comboOfferService.isOfferCurrentlyValid(o, now);
      return check.reason === 'expired' || check.reason === 'limit_reached';
    }).length;
    const pausedInactiveCombos = comboOffers.filter(
      o => o.status === 'paused' || o.status === 'draft'
    ).length;

    const totalComboSalesCount = filteredLogs.reduce((s, r) => s + r.comboQuantity, 0);
    const totalComboRevenue = filteredLogs.reduce((s, r) => s + r.revenue, 0);
    const totalComboDiscount = filteredLogs.reduce((s, r) => s + r.discountGiven, 0);
    const totalComboProfit = filteredLogs.reduce((s, r) => s + r.grossProfit, 0);

    // Best-selling Combos
    const byComboMap = new Map<
      string,
      {
        offerId: string;
        offerName: string;
        packagesSold: number;
        ordersCount: number;
        revenue: number;
        discountGiven: number;
        grossProfit: number;
      }
    >();

    filteredLogs.forEach(r => {
      const existing = byComboMap.get(r.offerId) || {
        offerId: r.offerId,
        offerName: r.offerName,
        packagesSold: 0,
        ordersCount: 0,
        revenue: 0,
        discountGiven: 0,
        grossProfit: 0,
      };
      existing.packagesSold += r.comboQuantity;
      existing.ordersCount += 1;
      existing.revenue += r.revenue;
      existing.discountGiven += r.discountGiven;
      existing.grossProfit += r.grossProfit;
      byComboMap.set(r.offerId, existing);
    });

    const bestSellingCombos = Array.from(byComboMap.values()).sort(
      (a, b) => b.packagesSold - a.packagesSold || b.revenue - a.revenue
    );

    // Product-wise Qty Sold Through Combos
    const productBreakdownMap = new Map<
      string,
      {
        productId: string;
        productName: string;
        variantDetails?: string;
        sku?: string;
        qtySold: number;
        allocatedRevenue: number;
      }
    >();

    filteredLogs.forEach(r => {
      const comps =
        r.components.length > 0
          ? r.components
          : (comboOffers.find(o => o.id === r.offerId)?.items || []).map(it => ({
              productId: it.productId,
              productName: it.productName,
              variantId: it.variantId,
              variantDetails: it.variantDetails,
              sku: it.sku,
              qty: it.quantity * r.comboQuantity,
              allocatedTotal: 0,
            }));

      comps.forEach(c => {
        const key = `${c.productId}::${c.variantId || 'std'}`;
        const existing = productBreakdownMap.get(key) || {
          productId: c.productId,
          productName: c.productName,
          variantDetails: c.variantDetails,
          sku: c.sku,
          qtySold: 0,
          allocatedRevenue: 0,
        };
        existing.qtySold += c.qty;
        existing.allocatedRevenue += c.allocatedTotal;
        productBreakdownMap.set(key, existing);
      });
    });

    const productWiseComboBreakdown = Array.from(productBreakdownMap.values()).sort(
      (a, b) => b.qtySold - a.qtySold
    );

    return {
      totalCombos,
      activeCombos,
      pausedInactiveCombos,
      expiredCombos,
      totalComboSalesCount,
      totalComboRevenue,
      totalComboDiscount,
      totalComboProfit,
      bestSellingCombos,
      productWiseComboBreakdown,
      filteredLogs,
    };
  }, [
    comboOffers,
    normalizedUsageRecords,
    selectedBranchFilter,
    analyticsRange,
    analyticsStartDate,
    analyticsEndDate,
  ]);

  // Add or increment product+variant inside Right Panel
  const addProductVariantToCombo = (
    prod: Product,
    variant?: ProductVariant,
    qtyToAdd: number = 1
  ): { ok: boolean; message: string } => {
    const safeQty = Math.max(1, Math.floor(qtyToAdd));
    if (prod.hasVariants && prod.variants && prod.variants.length > 0 && !variant) {
      return { ok: false, message: `Please select a Size/Color variant for "${prod.name}".` };
    }

    const variantDetails = variant
      ? [variant.color, variant.size].filter(Boolean).join(' / ')
      : undefined;

    const unitSalePrice =
      variant?.salePrice !== undefined
        ? variant.salePrice
        : variant?.additionalPrice
        ? prod.salePrice + variant.additionalPrice
        : prod.salePrice;

    const unitPurchaseCost =
      variant?.purchasePrice !== undefined
        ? variant.purchasePrice
        : prod.totalUnitCost || prod.purchasePrice;

    setFormItems(prev => {
      const existingIdx = prev.findIndex(
        it => it.productId === prod.id && (it.variantId || '') === (variant?.id || '')
      );
      if (existingIdx > -1) {
        return prev.map((it, idx) =>
          idx === existingIdx ? { ...it, quantity: it.quantity + safeQty } : it
        );
      }
      return [
        ...prev,
        {
          id: `coi-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          productId: prod.id,
          productName: prod.name,
          variantId: variant?.id,
          variantDetails,
          sku: variant?.sku || prod.code,
          quantity: safeQty,
          isFree: false,
          categoryId: prod.category,
          purchasePrice: unitPurchaseCost,
          salePrice: unitSalePrice,
        },
      ];
    });

    return {
      ok: true,
      message: `Added ${safeQty}x ${prod.name}${variantDetails ? ` (${variantDetails})` : ''} to combo.`,
    };
  };

  // Barcode / QR Scan handler for Custom Combo Builder
  const handleBuilderScannedMatch = (match: ScannedProductMatch): { ok: boolean; message: string } => {
    if (!match.found || !match.product) {
      return { ok: false, message: `No product found for code "${match.rawCode}".` };
    }
    if (match.requiresVariantSelection && match.product.variants?.length) {
      setBuilderSearch(match.product.name);
      return {
        ok: false,
        message: `"${match.product.name}" has multiple variants. Select Size/Color from the list.`,
      };
    }
    const res = addProductVariantToCombo(match.product, match.variant, 1);
    if (res.ok) {
      setBannerMessage({ tone: 'success', text: res.message });
    }
    return res;
  };

  const hidPrefs = getScannerHidPreferences();
  useHardwareScanner({
    enabled: activeTab === 'create' && canManageCombos && !isScannerOpen,
    terminator: hidPrefs.terminator,
    duplicateCooldownMs: hidPrefs.duplicateCooldownMs,
    captureUnfocusedWedge: true,
    onScan: rawCode => {
      const match = lookupProductByScannedCode(rawCode, products, builderStockBranch);
      const outcome = handleBuilderScannedMatch(match);
      if (hidPrefs.beepOnScan) playScanBeep(outcome.ok ? 'success' : 'error');
      if (!outcome.ok) {
        setBannerMessage({ tone: 'warning', text: outcome.message });
      }
    },
  });

  const handleUpdateItemQty = (itemId: string, nextQty: number) => {
    if (nextQty <= 0) {
      setFormItems(prev => prev.filter(i => i.id !== itemId));
      return;
    }
    setFormItems(prev => prev.map(i => (i.id === itemId ? { ...i, quantity: nextQty } : i)));
  };

  const handleToggleItemFree = (itemId: string) => {
    setFormItems(prev => prev.map(i => (i.id === itemId ? { ...i, isFree: !i.isFree } : i)));
  };

  const handleRemoveItem = (itemId: string) => {
    setFormItems(prev => prev.filter(i => i.id !== itemId));
  };

  const handleDiscountPercentChange = (rawPct: number) => {
    const safePct = Math.min(100, Math.max(0, Number.isNaN(rawPct) ? 0 : rawPct));
    setFormDiscountType('percentage');
    setFormDiscountValue(safePct);
  };

  const handleManualFinalPriceChange = (rawFinalPrice: number) => {
    const safeFinal = Math.max(0, Number.isNaN(rawFinalPrice) ? 0 : rawFinalPrice);
    setFormDiscountType('fixed_bundle_price');
    setFormDiscountValue(safeFinal);
  };

  const handleCoverImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setBannerMessage({ tone: 'error', text: validation.error || 'Invalid cover image.' });
      return;
    }
    try {
      const dataUrl = await compressCoverImage(file);
      setFormImage(dataUrl);
      setBannerMessage(null);
    } catch (err: any) {
      setBannerMessage({ tone: 'error', text: err?.message || 'Could not process image.' });
    }
  };

  const resetForm = () => {
    setEditingOfferId(null);
    setFormName('');
    setFormComboCategory('');
    setFormDescription('');
    setFormImage('');
    setFormType('fixed_price');
    setFormDiscountType('percentage');
    setFormDiscountValue(10);
    setFormMinSpendAmount(0);
    setFormMinQuantity(2);
    setFormStartDate(new Date().toISOString().split('T')[0]);
    setFormEndDate('');
    setFormBranchId('all');
    setFormStatus('active');
    setFormMaxUsageTotal(undefined);
    setFormMaxUsagePerCustomer(undefined);
    setFormPriority(10);
    setFormItems([]);
    setAllowBelowFloor(false);
    setOverrideReason('');
    setBannerMessage(null);
  };

  const handleOpenEdit = (offer: ComboOffer) => {
    if (!canManageCombos) return;
    setEditingOfferId(offer.id);
    setFormName(offer.name);
    setFormComboCategory(offer.comboCategory || '');
    setFormDescription(offer.description || '');
    setFormImage(offer.image || '');
    setFormType(offer.offerType);
    setFormDiscountType(offer.discountType);
    setFormDiscountValue(offer.discountValue);
    setFormMinSpendAmount(offer.minSpendAmount || 0);
    setFormMinQuantity(offer.minPurchaseQuantity || 2);
    setFormStartDate(offer.startDate || new Date().toISOString().split('T')[0]);
    setFormEndDate(offer.endDate || '');
    setFormBranchId(offer.branchId || 'all');
    setFormStatus(offer.status);
    setFormMaxUsageTotal(offer.maxUsageLimit);
    setFormMaxUsagePerCustomer(offer.perCustomerLimit);
    setFormPriority(offer.priorityRank);
    setFormItems(offer.items || []);
    setAllowBelowFloor(Boolean(offer.lossApprovedBy));
    setOverrideReason(offer.lossOverrideReason || '');
    setBannerMessage(null);
    setActiveTab('create');
  };

  const handleDuplicate = (offer: ComboOffer) => {
    if (!canManageCombos) return;
    setEditingOfferId(null);
    setFormName(`${offer.name} (Copy)`);
    setFormComboCategory(offer.comboCategory || '');
    setFormDescription(offer.description || '');
    setFormImage(offer.image || '');
    setFormType(offer.offerType);
    setFormDiscountType(offer.discountType);
    setFormDiscountValue(offer.discountValue);
    setFormMinSpendAmount(offer.minSpendAmount || 0);
    setFormMinQuantity(offer.minPurchaseQuantity || 2);
    setFormStartDate(new Date().toISOString().split('T')[0]);
    setFormEndDate(offer.endDate || '');
    setFormBranchId(offer.branchId || 'all');
    setFormStatus('draft');
    setFormMaxUsageTotal(offer.maxUsageLimit);
    setFormMaxUsagePerCustomer(offer.perCustomerLimit);
    setFormPriority(offer.priorityRank);
    setFormItems(
      (offer.items || []).map((i, idx) => ({
        ...i,
        id: `coi-${Date.now()}-${idx}`,
      }))
    );
    setAllowBelowFloor(false);
    setOverrideReason('');
    setBannerMessage({ tone: 'success', text: `Loaded copy of "${offer.name}" into Builder.` });
    setActiveTab('create');
  };

  const buildDraftOfferObject = (): ComboOffer => {
    const existing = editingOfferId ? comboOffers.find(o => o.id === editingOfferId) : undefined;
    const now = new Date().toISOString();
    return {
      id: existing?.id || `preview-${Date.now()}`,
      name: formName.trim() || 'Untitled Custom Combo',
      description: formDescription.trim() || undefined,
      comboCategory: formComboCategory.trim() || undefined,
      image: formImage.trim() || undefined,
      offerType: formType,
      items: formItems,
      minSpendAmount: formType === 'spend_and_save' ? formMinSpendAmount : undefined,
      minPurchaseQuantity: formType === 'quantity_discount' ? formMinQuantity : undefined,
      regularTotalPrice: livePnL.regularTotalPrice,
      discountType: formDiscountType,
      discountValue: formDiscountValue,
      finalComboPrice: livePnL.finalComboPrice,
      totalCostOfGoods: livePnL.totalCostOfGoods,
      allocatedOpEx: livePnL.allocatedOpEx,
      grossProfit: livePnL.grossProfit,
      estimatedNetProfit: livePnL.estimatedNetProfit,
      profitMarginPercent: livePnL.profitMarginPercent,
      isLossMaking: livePnL.isLossMaking,
      minSafeSellingPrice: livePnL.minSafeSellingPrice,
      lossOverrideReason: livePnL.isLossMaking && allowBelowFloor ? overrideReason.trim() : undefined,
      lossApprovedBy: livePnL.isLossMaking && allowBelowFloor ? 'Admin Authorized' : undefined,
      startDate: formStartDate,
      endDate: formEndDate || undefined,
      status: formStatus,
      maxUsageLimit: formMaxUsageTotal || undefined,
      perCustomerLimit: formMaxUsagePerCustomer || undefined,
      usageCount: existing?.usageCount || 0,
      branchId: formBranchId,
      priorityRank: formPriority,
      businessId: existing?.businessId || 'default-business',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  };

  const handleSaveOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageCombos) {
      setBannerMessage({
        tone: 'error',
        text: 'Unauthorized: Only Admin or Store Manager can create or edit combo offers.',
      });
      return;
    }
    if (!formName.trim()) {
      setBannerMessage({ tone: 'error', text: 'Please enter a Combo Offer Name.' });
      return;
    }
    if (formType !== 'spend_and_save' && formItems.length === 0) {
      setBannerMessage({
        tone: 'error',
        text: 'Please select at least one product or variant from the inventory panel.',
      });
      return;
    }
    if (formEndDate && formStartDate && formEndDate < formStartDate) {
      setBannerMessage({
        tone: 'error',
        text: 'Expiry Date cannot be earlier than Start Date.',
      });
      return;
    }
    if (livePnL.isLossMaking) {
      if (!isAdmin) {
        setBannerMessage({
          tone: 'error',
          text: `Offer price (${formatCurrency(livePnL.finalComboPrice, lang)}) is below Safe Floor Price (${formatCurrency(livePnL.minSafeSellingPrice, lang)}). Only Admin can authorize a below-floor combo.`,
        });
        return;
      }
      if (!allowBelowFloor || !overrideReason.trim()) {
        setBannerMessage({
          tone: 'error',
          text: 'Below Safe Floor pricing requires checking Admin Override AND providing a justification reason.',
        });
        return;
      }
    }

    const payload: Omit<ComboOffer, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'> = {
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      comboCategory: formComboCategory.trim() || undefined,
      image: formImage.trim() || undefined,
      offerType: formType,
      items: formItems,
      minSpendAmount: formType === 'spend_and_save' ? formMinSpendAmount : undefined,
      minPurchaseQuantity: formType === 'quantity_discount' ? formMinQuantity : undefined,
      regularTotalPrice: livePnL.regularTotalPrice,
      discountType: formDiscountType,
      discountValue: formDiscountValue,
      finalComboPrice: livePnL.finalComboPrice,
      totalCostOfGoods: livePnL.totalCostOfGoods,
      allocatedOpEx: livePnL.allocatedOpEx,
      grossProfit: livePnL.grossProfit,
      estimatedNetProfit: livePnL.estimatedNetProfit,
      profitMarginPercent: livePnL.profitMarginPercent,
      isLossMaking: livePnL.isLossMaking,
      minSafeSellingPrice: livePnL.minSafeSellingPrice,
      lossOverrideReason: livePnL.isLossMaking && allowBelowFloor ? overrideReason.trim() : undefined,
      lossApprovedBy: livePnL.isLossMaking && allowBelowFloor ? 'Admin Authorized' : undefined,
      startDate: formStartDate,
      endDate: formEndDate || undefined,
      status: formStatus,
      maxUsageLimit: formMaxUsageTotal || undefined,
      perCustomerLimit: formMaxUsagePerCustomer || undefined,
      branchId: formBranchId,
      priorityRank: formPriority,
      businessId: 'default-business',
    };

    setIsSavingOffer(true);
    setBannerMessage(null);
    try {
      if (editingOfferId) {
        await updateComboOffer(editingOfferId, payload);
        setBannerMessage({
          tone: 'success',
          text: `Updated combo "${payload.name}" without affecting inventory stock.`,
        });
      } else {
        await addComboOffer(payload);
        setBannerMessage({
          tone: 'success',
          text: `Saved combo "${payload.name}" cleanly (zero stock deducted until sold).`,
        });
      }
      resetForm();
      setActiveTab('offers');
    } catch (err: any) {
      setBannerMessage({
        tone: 'error',
        text: err?.message || 'Failed to save combo offer.',
      });
    } finally {
      setIsSavingOffer(false);
    }
  };

  const handleConfirmDeleteOffer = async () => {
    if (!deleteTargetOffer || !canDeleteCombos || isDeletingOffer) return;
    setIsDeletingOffer(true);
    try {
      await deleteComboOffer(deleteTargetOffer.id);
      setBannerMessage({
        tone: 'success',
        text: `Deleted combo offer "${deleteTargetOffer.name}".`,
      });
      setDeleteTargetOffer(null);
    } catch (err: any) {
      setBannerMessage({
        tone: 'error',
        text: err?.message || 'Failed to delete combo offer.',
      });
    } finally {
      setIsDeletingOffer(false);
    }
  };

  const exportAnalyticsCSV = () => {
    const headers = [
      'Offer Name',
      'Packages Sold',
      'Invoices',
      'Revenue',
      'Discount Given',
      ...(canViewCosts ? ['Gross Profit'] : []),
    ];
    const rows = analyticsData.bestSellingCombos.map(row => [
      `"${row.offerName.replace(/"/g, '""')}"`,
      row.packagesSold,
      row.ordersCount,
      row.revenue.toFixed(2),
      row.discountGiven.toFixed(2),
      ...(canViewCosts ? [row.grossProfit.toFixed(2)] : []),
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `combo_analytics_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Header & Navigation Bar */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
              Custom Combo Offers &amp; Bundle Engine
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Build multi-product &amp; multi-variant bundles with live margin protection and atomic POS inventory sync.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('offers')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'offers'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Combos ({comboOffers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'orders'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>
              Online Orders ({marketplaceOrders.length})
              {pendingOnlineOrdersCount > 0 ? ` · ${pendingOnlineOrdersCount} Pending` : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'analytics'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Combo Analytics</span>
          </button>

          {canManageCombos && (
            <button
              type="button"
              onClick={() => {
                resetForm();
                setActiveTab('create');
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'create'
                  ? 'bg-teal-700 text-white'
                  : 'bg-teal-600 text-white hover:bg-teal-700'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>{editingOfferId ? 'Editing Combo' : 'Custom Combo Builder'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Notification Banner */}
      {bannerMessage && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
            bannerMessage.tone === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : bannerMessage.tone === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {bannerMessage.tone === 'success' ? (
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{bannerMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="p-1 rounded hover:bg-black/5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ==================== TAB 1: OFFERS LIST ==================== */}
      {activeTab === 'offers' && (
        <div className="space-y-4">
          {/* Quick KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl p-4 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Total Active Combos
              </span>
              <span className="text-2xl font-bold font-mono-num text-slate-900 mt-1 block">
                {analyticsData.activeCombos}
              </span>
              <span className="text-[11px] text-slate-500 mt-0.5 block">
                {analyticsData.totalCombos} non-archived · {analyticsData.expiredCombos} expired
              </span>
            </div>

            <div className="bg-white rounded-xl p-4 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Combo Packages Sold
              </span>
              <span className="text-2xl font-bold font-mono-num text-teal-700 mt-1 block">
                {analyticsData.totalComboSalesCount}
              </span>
              <span className="text-[11px] text-slate-500 mt-0.5 block">In selected analytics window</span>
            </div>

            <div className="bg-white rounded-xl p-4 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Combo Revenue
              </span>
              <span className="text-2xl font-bold font-mono-num text-slate-900 mt-1 block">
                {formatCurrency(analyticsData.totalComboRevenue, lang)}
              </span>
              <span className="text-[11px] text-amber-700 mt-0.5 block font-mono-num">
                Discounts: -{formatCurrency(analyticsData.totalComboDiscount, lang)}
              </span>
            </div>

            <div className="bg-white rounded-xl p-4 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                {canViewCosts ? 'Gross Combo Profit' : 'Active Branch Scope'}
              </span>
              {canViewCosts ? (
                <>
                  <span className="text-2xl font-bold font-mono-num text-emerald-700 mt-1 block">
                    {formatCurrency(analyticsData.totalComboProfit, lang)}
                  </span>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">
                    After exact component COGS
                  </span>
                </>
              ) : (
                <>
                  <span className="text-base font-bold text-slate-900 mt-1 block truncate">
                    {branches.find(b => b.id === activeBranchId)?.name || 'All Branches'}
                  </span>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">
                    Ready for POS checkout
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Search & Filters */}
          <div className="bg-white rounded-xl p-3 border border-slate-200 flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search combo name, product, SKU, or category..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            {canManageCombos && (
              <select
                value={selectedStatusFilter}
                onChange={e => setSelectedStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="draft">Draft</option>
                <option value="expired">Expired</option>
                <option value="archived">Archived</option>
              </select>
            )}

            <select
              value={selectedComboCategoryFilter}
              onChange={e => setSelectedComboCategoryFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700"
            >
              <option value="all">All Combo Categories</option>
              {comboCategories.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              value={selectedBranchFilter}
              onChange={e => setSelectedBranchFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700"
            >
              <option value="all">All Branches</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Offers Grid */}
          {filteredOffers.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 mx-auto flex items-center justify-center text-slate-400">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">No Combo Offers Found</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                {canManageCombos
                  ? 'Create a custom combo pack in the 2-panel Combo Builder by picking any products and variants from your inventory.'
                  : 'No active combo offers are currently scheduled for this branch.'}
              </p>
              {canManageCombos && (
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setActiveTab('create');
                  }}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Open Custom Combo Builder</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredOffers.map(offer => {
                const branchForStock =
                  offer.branchId && offer.branchId !== 'all' ? offer.branchId : activeBranchId;
                const fulfillment = comboOfferService.checkOfferFulfillment(
                  offer,
                  products,
                  1,
                  branchForStock
                );
                const validity = comboOfferService.isOfferCurrentlyValid(offer);
                const discPct = comboOfferService.calculateEquivalentDiscountPercent(
                  offer.regularTotalPrice,
                  offer.finalComboPrice
                );
                const branchName =
                  offer.branchId && offer.branchId !== 'all'
                    ? branches.find(b => b.id === offer.branchId)?.name || 'Branch Scoped'
                    : 'All Branches';

                return (
                  <div
                    key={offer.id}
                    className={`bg-white rounded-2xl border p-4 flex flex-col justify-between gap-4 transition-colors ${
                      offer.status === 'active' && validity.valid
                        ? 'border-slate-200 hover:border-teal-300'
                        : 'border-slate-200 opacity-85 bg-slate-50/40'
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Header with Cover Image & Status */}
                      <div className="flex items-start gap-3">
                        <ProductThumbnail
                          src={
                            offer.image ||
                            resolveProductImage(
                              products.find(p => p.id === offer.items[0]?.productId) ||
                                ({ id: '', name: offer.name } as Product)
                            )
                          }
                          alt={offer.name}
                          size="md"
                          roundedClassName="rounded-xl"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                offer.status === 'active' && validity.valid
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : offer.status === 'paused'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : offer.status === 'expired' || validity.reason === 'expired'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}
                            >
                              {validity.reason === 'expired' ? 'expired' : offer.status}
                            </span>

                            <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-700 text-[10px] font-bold font-mono-num">
                              {discPct > 0 ? `${discPct}% OFF` : 'Bundle'}
                            </span>
                          </div>

                          <h3 className="text-sm font-bold text-slate-900 truncate mt-1">
                            {offer.name}
                          </h3>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-slate-500">
                            {offer.comboCategory && (
                              <span className="font-medium text-teal-700">{offer.comboCategory}</span>
                            )}
                            {offer.comboCategory && <span>·</span>}
                            <span>{branchName}</span>
                          </div>
                        </div>
                      </div>

                      {/* Included Products */}
                      <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-100 space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          <span>Included Products ({offer.items.length})</span>
                          <span
                            className={`font-mono-num ${
                              fulfillment.canFulfill ? 'text-emerald-700' : 'text-rose-600'
                            }`}
                          >
                            {fulfillment.canFulfill
                              ? `Stock OK · Max ${fulfillment.maxCombos}`
                              : 'Insufficient Stock'}
                          </span>
                        </div>
                        <div className="space-y-1 max-h-28 overflow-y-auto">
                          {offer.items.map((item, idx) => (
                            <div
                              key={item.id || idx}
                              className="flex items-center justify-between text-[11px] text-slate-700 gap-2"
                            >
                              <span className="truncate">
                                <strong className="font-mono-num text-slate-900">
                                  {item.quantity}×
                                </strong>{' '}
                                {item.productName}
                                {item.variantDetails && (
                                  <span className="text-slate-500 font-mono text-[10px]">
                                    {' '}
                                    ({item.variantDetails})
                                  </span>
                                )}
                              </span>
                              {item.isFree && (
                                <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[9px] font-bold shrink-0">
                                  FREE
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Pricing Summary */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80">
                          <span className="text-[10px] text-slate-500 block">Regular / Combo Price</span>
                          <div className="flex items-baseline gap-1.5 mt-0.5">
                            <span className="font-extrabold font-mono-num text-slate-900 text-sm">
                              {formatCurrency(offer.finalComboPrice, lang)}
                            </span>
                            {offer.regularTotalPrice > offer.finalComboPrice && (
                              <span className="text-[11px] font-mono-num text-slate-400 line-through">
                                {formatCurrency(offer.regularTotalPrice, lang)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80">
                          <span className="text-[10px] text-slate-500 block">
                            {canViewCosts ? 'Est. Net Profit' : 'Sold Redemptions'}
                          </span>
                          {canViewCosts ? (
                            <div className="flex items-baseline gap-1.5 mt-0.5">
                              <span
                                className={`font-extrabold font-mono-num text-sm ${
                                  offer.estimatedNetProfit >= 0
                                    ? 'text-emerald-700'
                                    : 'text-rose-700'
                                }`}
                              >
                                {formatCurrency(offer.estimatedNetProfit, lang)}
                              </span>
                              <span className="text-[10px] font-mono-num text-slate-500">
                                ({offer.profitMarginPercent}%)
                              </span>
                            </div>
                          ) : (
                            <span className="font-extrabold font-mono-num text-sm text-slate-900 mt-0.5 block">
                              {offer.usageCount} sold
                            </span>
                          )}
                        </div>
                      </div>

                      {canViewCosts && offer.isLossMaking && (
                        <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-[10px] font-semibold text-rose-700 flex items-center gap-1.5">
                          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Below Safe Floor ({formatCurrency(offer.minSafeSellingPrice, lang)})
                            {offer.lossApprovedBy ? ` · Approved` : ''}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Primary Poster & Marketplace Action Strip */}
                    <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPosterStudioOfferId(offer.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#101B3F] hover:bg-[#19295c] text-white text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Wand2 className="w-3.5 h-3.5 text-[#D6AD60]" />
                        <span>CREATE POSTER</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setMarketplacePreviewOfferId(offer.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                      >
                        <Globe className="w-3.5 h-3.5 text-teal-600" />
                        <span>Online Preview</span>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          const qrRes = resolveComboMarketplaceQrUrl(
                            offer,
                            settings,
                            offer.posterConfig?.customQrUrl
                          );
                          const link = qrRes.url || buildAppPreviewComboLink(offer);
                          try {
                            await navigator.clipboard.writeText(link);
                            setCopiedOfferId(offer.id);
                            setTimeout(() => setCopiedOfferId(prev => (prev === offer.id ? null : prev)), 2000);
                          } catch {
                            setBannerMessage({ tone: 'warning', text: `Combo Link: ${link}` });
                          }
                        }}
                        title="Copy Marketplace Offer Link"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                      >
                        {copiedOfferId === offer.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Link2 className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedOfferId === offer.id ? 'Copied' : 'Copy Link'}</span>
                      </button>

                      {canManageCombos && (
                        <button
                          type="button"
                          onClick={async () => {
                            const nextPub = !offer.isPublishedOnline;
                            await updateComboOffer(offer.id, {
                              isPublishedOnline: nextPub,
                              marketplaceSlug: offer.marketplaceSlug || buildMarketplaceSlug(offer),
                            });
                            setBannerMessage({
                              tone: 'success',
                              text: nextPub
                                ? `"${offer.name}" published for Online Marketplace orders.`
                                : `"${offer.name}" unpublished from Online Marketplace.`,
                            });
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                            offer.isPublishedOnline
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                              : 'bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100'
                          }`}
                        >
                          <span>{offer.isPublishedOnline ? 'Unpublish' : 'Publish Online'}</span>
                        </button>
                      )}
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-[11px] font-mono-num text-slate-500">
                        <span>
                          Sold: <strong className="text-slate-800">{offer.usageCount}</strong>
                          {offer.maxUsageLimit ? ` / ${offer.maxUsageLimit}` : ''}
                        </span>
                        {offer.posterImageUrl && (
                          <span className="text-[10px] font-sans font-semibold text-teal-700">
                            · Poster Ready
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPreviewOffer(offer)}
                          title="Preview Customer Bundle Card"
                          className="p-1.5 text-slate-600 hover:text-teal-700 hover:bg-teal-50 rounded-lg cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setDetailsOffer(offer)}
                          title="View Details & Sales History"
                          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>

                        {canManageCombos && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(offer)}
                              title="Edit Combo"
                              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDuplicate(offer)}
                              title="Duplicate Combo"
                              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>

                            {offer.status === 'active' ? (
                              <button
                                type="button"
                                onClick={() => toggleOfferStatus(offer.id, 'paused')}
                                title="Pause Combo"
                                className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg cursor-pointer"
                              >
                                <Pause className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleOfferStatus(offer.id, 'active')}
                                title="Activate Combo"
                                className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer"
                              >
                                <Play className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {offer.status !== 'archived' && (
                              <button
                                type="button"
                                onClick={() => archiveComboOffer(offer.id)}
                                title="Archive Combo"
                                className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg cursor-pointer"
                              >
                                <Archive className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {canDeleteCombos && (
                              <button
                                type="button"
                                onClick={() => setDeleteTargetOffer(offer)}
                                title="Delete Combo (Admin Only)"
                                className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 2: 2-PANEL CUSTOM COMBO BUILDER ==================== */}
      {activeTab === 'create' && canManageCombos && (
        <form onSubmit={handleSaveOffer} className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT PANEL: Product Search, Category Filter, Barcode/QR Scanner & Inventory Picker */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  1. Select Products &amp; Variants from Inventory
                </h2>
                <p className="text-[11px] text-slate-500">
                  Combine any products across categories or distinct variants. Saving creates zero stock deduction.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsScannerOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shrink-0 cursor-pointer"
              >
                <ScanBarcode className="w-3.5 h-3.5" />
                <span>Scan Barcode / QR</span>
              </button>
            </div>

            {/* Search & Category Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <div className="sm:col-span-7 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={builderSearch}
                  onChange={e => setBuilderSearch(e.target.value)}
                  placeholder="Search product name, SKU, barcode, size or color..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              <div className="sm:col-span-5">
                <select
                  aria-label="Filter inventory by category"
                  value={builderCategory}
                  onChange={e => setBuilderCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700"
                >
                  <option value="all">All Categories ({products.filter(p => p.isActive !== false).length})</option>
                  {productCategories.map(cat => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Available Product List */}
            <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-1">
              {builderProducts.length === 0 ? (
                <div className="py-12 text-center border border-dashed border-slate-200 rounded-xl text-xs text-slate-400">
                  No matching active products found in the selected branch/category.
                </div>
              ) : (
                builderProducts.map(prod => {
                  const hasVars = Boolean(prod.hasVariants && prod.variants && prod.variants.length > 0);
                  const chosenVarId =
                    rowVariantChoice[prod.id] ||
                    (hasVars ? prod.variants![0].id : '');
                  const chosenVariant = hasVars
                    ? prod.variants!.find(v => v.id === chosenVarId) || prod.variants![0]
                    : undefined;

                  const liveStock = chosenVariant ? chosenVariant.stock : prod.currentStock;
                  const unitSale =
                    chosenVariant?.salePrice !== undefined
                      ? chosenVariant.salePrice
                      : chosenVariant?.additionalPrice
                      ? prod.salePrice + chosenVariant.additionalPrice
                      : prod.salePrice;
                  const unitCost =
                    chosenVariant?.purchasePrice !== undefined
                      ? chosenVariant.purchasePrice
                      : prod.totalUnitCost || prod.purchasePrice;
                  const qtyInput = rowQtyChoice[prod.id] || 1;
                  const inComboEntry = formItems.find(
                    it =>
                      it.productId === prod.id &&
                      (it.variantId || '') === (chosenVariant?.id || '')
                  );

                  const thumbUrl = resolveProductImage(prod, {
                    colorId: chosenVariant?.colorId,
                    variantId: chosenVariant?.id,
                    colorName: chosenVariant?.color,
                  });

                  return (
                    <div
                      key={prod.id}
                      className={`p-3 rounded-xl border transition-colors ${
                        inComboEntry
                          ? 'bg-teal-50/40 border-teal-300'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <ProductThumbnail
                            src={thumbUrl}
                            alt={prod.name}
                            colorHex={
                              chosenVariant?.color
                                ? inferColorHex(chosenVariant.color, chosenVariant.colorHex)
                                : undefined
                            }
                            colorName={chosenVariant?.color}
                            size="sm"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-slate-900 truncate">
                                {prod.name}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">
                                {prod.category}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-slate-500">
                              <span className="font-mono">
                                SKU: {chosenVariant?.sku || prod.code}
                              </span>
                              <span
                                className={`font-mono-num font-bold ${
                                  liveStock <= 0
                                    ? 'text-rose-600'
                                    : liveStock <= (prod.minStockAlert || 5)
                                    ? 'text-amber-600'
                                    : 'text-emerald-700'
                                }`}
                              >
                                Stock: {liveStock} {prod.unit}
                              </span>
                              <span className="font-mono-num font-bold text-slate-900">
                                Sale: {formatCurrency(unitSale, lang)}
                              </span>
                              {canViewCosts && (
                                <span className="font-mono-num text-slate-500">
                                  Cost: {formatCurrency(unitCost, lang)}
                                </span>
                              )}
                            </div>

                            {hasVars && (
                              <div className="mt-2">
                                <select
                                  aria-label={`Select variant for ${prod.name}`}
                                  value={chosenVariant?.id || ''}
                                  onChange={e =>
                                    setRowVariantChoice(prev => ({
                                      ...prev,
                                      [prod.id]: e.target.value,
                                    }))
                                  }
                                  className="w-full sm:w-auto max-w-full px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-800"
                                >
                                  {prod.variants!.map(v => (
                                    <option key={v.id} value={v.id}>
                                      {[v.color, v.size].filter(Boolean).join(' / ') || 'Variant'} —
                                      SKU: {v.sku} (Stock: {v.stock})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Qty + Add/Remove Action */}
                        <div className="flex items-center gap-2 shrink-0 justify-end">
                          <div className="flex items-center border border-slate-200 rounded-lg bg-slate-50">
                            <span className="text-[10px] text-slate-500 px-2">Qty</span>
                            <input
                              type="number"
                              min={1}
                              max={99}
                              value={qtyInput}
                              onChange={e =>
                                setRowQtyChoice(prev => ({
                                  ...prev,
                                  [prod.id]: Math.max(1, Number(e.target.value) || 1),
                                }))
                              }
                              className="w-12 py-1 px-1.5 bg-white text-center font-mono-num font-bold text-xs rounded-r-lg border-l border-slate-200 focus:outline-none"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              const res = addProductVariantToCombo(
                                prod,
                                chosenVariant,
                                qtyInput
                              );
                              if (!res.ok) {
                                setBannerMessage({ tone: 'warning', text: res.message });
                              }
                            }}
                            className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{inComboEntry ? `Add (+${inComboEntry.quantity})` : 'Add'}</span>
                          </button>

                          {inComboEntry && (
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(inComboEntry.id)}
                              title="Remove from combo"
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg border border-rose-200 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT PANEL: Selected Combo Products, Pricing, Margin Guard & Publish Controls */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  2. Combo Summary &amp; Pricing
                </h2>
                <p className="text-[11px] text-slate-500">
                  Configure offer pricing, schedule, cover photo &amp; safety checks.
                </p>
              </div>
              {editingOfferId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline cursor-pointer"
                >
                  New Blank
                </button>
              )}
            </div>

            {/* Selected Products List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                <span>Selected Combo Products ({formItems.length})</span>
                <span className="font-mono-num text-slate-500">
                  {formItems.reduce((s, i) => s + i.quantity, 0)} total pcs/combo
                </span>
              </div>

              {formItems.length === 0 ? (
                <div className="p-5 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center text-xs text-slate-500">
                  Select products from the inventory list on the left or scan a barcode/QR code.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
                  {formItems.map(item => {
                    const lineRegular = (item.salePrice || 0) * item.quantity;
                    return (
                      <div
                        key={item.id}
                        className="p-2.5 bg-white flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-slate-900 truncate">{item.productName}</div>
                          <div className="text-[10px] text-slate-500 font-mono truncate">
                            {item.variantDetails ? `${item.variantDetails} · ` : ''}
                            {item.sku} · ৳{item.salePrice || 0}/pc
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {formType === 'buy_x_get_y' && (
                            <button
                              type="button"
                              onClick={() => handleToggleItemFree(item.id)}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                                item.isFree
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {item.isFree ? 'FREE' : 'Paid'}
                            </button>
                          )}

                          <div className="inline-flex items-center border border-slate-200 rounded-lg bg-slate-50">
                            <button
                              type="button"
                              onClick={() => handleUpdateItemQty(item.id, item.quantity - 1)}
                              className="px-1.5 py-1 hover:bg-slate-200 rounded-l-lg cursor-pointer"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="px-2 font-mono-num font-bold text-slate-900">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdateItemQty(item.id, item.quantity + 1)}
                              className="px-1.5 py-1 hover:bg-slate-200 rounded-r-lg cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>

                          <span className="font-mono-num font-bold text-slate-900 w-16 text-right">
                            {formatCurrency(lineRegular, lang)}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="p-1 text-rose-500 hover:bg-rose-50 rounded cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pricing & Bidirectional Discount Controls */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-600">Regular Total Value:</span>
                <span className="font-bold font-mono-num text-sm text-slate-900">
                  {formatCurrency(livePnL.regularTotalPrice, lang)}
                </span>
              </div>

              {/* Quick Discount % Presets */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-slate-600 block">
                  Quick Discount % Presets
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {DECIMAL_DISCOUNT_PRESETS.map(pct => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => handleDiscountPercentChange(pct)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-mono-num font-bold border cursor-pointer transition-colors ${
                        formDiscountType === 'percentage' && formDiscountValue === pct
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Discount (%)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    aria-label="Combo Discount Percentage"
                    value={equivalentDiscountPercent}
                    onChange={e => handleDiscountPercentChange(parseFloat(e.target.value))}
                    className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg font-mono-num font-bold text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Final Combo Price ({currency})
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    aria-label="Final Combo Offer Price"
                    value={livePnL.finalComboPrice}
                    onChange={e => handleManualFinalPriceChange(parseFloat(e.target.value))}
                    className="w-full px-2.5 py-2 bg-white border border-teal-300 rounded-lg font-mono-num font-extrabold text-teal-800 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <span className="font-semibold text-slate-700">Customer Savings:</span>
                <span className="font-bold font-mono-num text-emerald-700">
                  -{formatCurrency(livePnL.discountAmount, lang)} ({equivalentDiscountPercent}%)
                </span>
              </div>
            </div>

            {/* RBAC-Protected Financial & Floor Protection Block */}
            {canViewCosts && (
              <div
                className={`p-3.5 rounded-xl border space-y-2 text-xs ${
                  livePnL.isLossMaking
                    ? 'bg-rose-50 border-rose-200'
                    : 'bg-emerald-50/50 border-emerald-200'
                }`}
              >
                <div className="flex items-center justify-between font-bold text-slate-900">
                  <span>Cost, Floor &amp; Profit Margin</span>
                  <span
                    className={`font-mono-num ${
                      livePnL.isLossMaking ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    {livePnL.profitMarginPercent}% margin
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <div className="flex justify-between text-slate-600">
                    <span>Purchase Cost:</span>
                    <span className="font-mono-num font-semibold text-slate-900">
                      {formatCurrency(livePnL.totalCostOfGoods, lang)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Allocated OpEx:</span>
                    <span className="font-mono-num font-semibold text-slate-900">
                      {formatCurrency(livePnL.allocatedOpEx, lang)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Safe Floor Price:</span>
                    <span className="font-mono-num font-bold text-slate-900">
                      {formatCurrency(livePnL.minSafeSellingPrice, lang)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Expected Net Profit:</span>
                    <span
                      className={`font-mono-num font-bold ${
                        livePnL.estimatedNetProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {formatCurrency(livePnL.estimatedNetProfit, lang)}
                    </span>
                  </div>
                </div>

                {livePnL.isLossMaking && (
                  <div className="pt-2 border-t border-rose-200 space-y-2">
                    <div className="flex items-start gap-1.5 text-rose-800 font-semibold text-[11px]">
                      <ShieldAlert className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                      <span>
                        Warning: Offer price is below Safe Floor Price ({formatCurrency(livePnL.minSafeSellingPrice, lang)}).
                      </span>
                    </div>

                    {isAdmin ? (
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-2 text-[11px] font-bold text-rose-900 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allowBelowFloor}
                            onChange={e => setAllowBelowFloor(e.target.checked)}
                            className="rounded border-rose-400 text-rose-600"
                          />
                          <span>Admin Override: Allow below-floor promotional combo</span>
                        </label>
                        {allowBelowFloor && (
                          <input
                            type="text"
                            required
                            value={overrideReason}
                            onChange={e => setOverrideReason(e.target.value)}
                            placeholder="Justification reason (e.g. Seasonal clearance) *"
                            className="w-full px-2.5 py-1.5 bg-white border border-rose-300 rounded-lg text-xs"
                          />
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] font-bold text-rose-700">
                        Only an Admin can authorize a combo below the Safe Floor Price.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Combo Metadata & Scheduling */}
            <div className="space-y-2.5 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Combo Offer Name *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g. Eid Complete Menswear Combo"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Combo Category
                  </label>
                  <input
                    list="combo-category-list"
                    value={formComboCategory}
                    onChange={e => setFormComboCategory(e.target.value)}
                    placeholder="e.g. Eid Special Combo"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                  />
                  <datalist id="combo-category-list">
                    {COMBO_CATEGORY_PRESETS.map(c => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Offer Mode
                  </label>
                  <select
                    value={formType}
                    onChange={e => {
                      const next = e.target.value as OfferType;
                      setFormType(next);
                      if (next === 'buy_x_get_y') setFormDiscountType('free_item');
                      else if (next === 'spend_and_save') setFormDiscountType('fixed_discount');
                      else if (formDiscountType === 'free_item') setFormDiscountType('percentage');
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="fixed_price">Custom Bundle Combo</option>
                    <option value="buy_x_discount">Multi-Item Discount</option>
                    <option value="buy_x_get_y">Buy X Get Y Free</option>
                    <option value="spend_and_save">Spend &amp; Save Threshold</option>
                    <option value="quantity_discount">Quantity Tier Discount</option>
                  </select>
                </div>
              </div>

              {/* Cover Image */}
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 block">
                  Combo Cover Image (Optional URL or Upload)
                </label>
                <div className="flex items-center gap-2">
                  <ProductThumbnail src={formImage} alt={formName || 'Combo cover'} size="sm" />
                  <input
                    type="url"
                    value={formImage}
                    onChange={e => setFormImage(e.target.value)}
                    placeholder="Paste image URL or upload..."
                    className="flex-1 px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                  <label className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-[11px] font-bold text-slate-700 cursor-pointer shrink-0 inline-flex items-center gap-1">
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>Upload</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleCoverImageUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Start Date</label>
                  <input
                    type="date"
                    value={formStartDate}
                    onChange={e => setFormStartDate(e.target.value)}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Expiry Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={formEndDate}
                    onChange={e => setFormEndDate(e.target.value)}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Branch</label>
                  <select
                    value={formBranchId}
                    onChange={e => setFormBranchId(e.target.value)}
                    className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="all">All Branches</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Status</label>
                  <select
                    value={formStatus}
                    onChange={e => setFormStatus(e.target.value as OfferStatus)}
                    className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                    <option value="paused">Paused</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Max Sold Cap</label>
                  <input
                    type="number"
                    min="1"
                    value={formMaxUsageTotal || ''}
                    onChange={e =>
                      setFormMaxUsageTotal(e.target.value ? Number(e.target.value) : undefined)
                    }
                    placeholder="Unlimited"
                    className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono-num"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Description / POS Cashier Note
                </label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="Optional customer-facing bundle notes..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            {/* Footer Save / Preview Buttons */}
            <div className="pt-3 border-t border-slate-100 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setPreviewOffer(buildDraftOfferObject())}
                disabled={formItems.length === 0}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                <span>Preview Combo</span>
              </button>

              <button
                type="submit"
                disabled={isSavingOffer}
                className="flex-1 py-2.5 px-4 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>
                  {isSavingOffer
                    ? 'Saving...'
                    : editingOfferId
                    ? 'Update Combo Offer'
                    : 'Save Combo Offer'}
                </span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ==================== TAB 3: COMBO ANALYTICS & BREAKDOWN ==================== */}
      {activeTab === 'analytics' && (
        <div className="space-y-4">
          {/* Date Filter Bar + CSV Export */}
          <div className="bg-white rounded-xl border border-slate-200 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <div className="flex bg-slate-100 p-0.5 rounded-lg">
                {(
                  [
                    { id: 'today', label: 'Today' },
                    { id: 'week', label: 'This Week' },
                    { id: 'month', label: 'This Month' },
                    { id: 'all', label: 'All Time' },
                    { id: 'custom', label: 'Custom' },
                  ] as const
                ).map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setAnalyticsRange(r.id)}
                    className={`px-2.5 py-1.5 rounded-md font-semibold cursor-pointer ${
                      analyticsRange === r.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              {analyticsRange === 'custom' && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={analyticsStartDate}
                    onChange={e => setAnalyticsStartDate(e.target.value)}
                    className="px-2 py-1 border border-slate-200 rounded-lg font-mono"
                  />
                  <span className="text-slate-400">to</span>
                  <input
                    type="date"
                    value={analyticsEndDate}
                    onChange={e => setAnalyticsEndDate(e.target.value)}
                    className="px-2 py-1 border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              )}

              <select
                value={selectedBranchFilter}
                onChange={e => setSelectedBranchFilter(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50 font-medium"
              >
                <option value="all">All Branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={exportAnalyticsCSV}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>

          {/* 8 KPI Cards (Status counts + Revenue/Discount/Profit) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3.5">
              <span className="text-[11px] font-semibold text-slate-500 block">Total Combos</span>
              <span className="text-xl font-bold font-mono-num text-slate-900 mt-1 block">
                {analyticsData.totalCombos}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5">
              <span className="text-[11px] font-semibold text-emerald-700 block">Active Combos</span>
              <span className="text-xl font-bold font-mono-num text-emerald-700 mt-1 block">
                {analyticsData.activeCombos}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5">
              <span className="text-[11px] font-semibold text-amber-700 block">
                Paused / Inactive
              </span>
              <span className="text-xl font-bold font-mono-num text-amber-700 mt-1 block">
                {analyticsData.pausedInactiveCombos}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5">
              <span className="text-[11px] font-semibold text-rose-700 block">Expired Combos</span>
              <span className="text-xl font-bold font-mono-num text-rose-700 mt-1 block">
                {analyticsData.expiredCombos}
              </span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-3.5">
              <span className="text-[11px] font-semibold text-slate-500 block">
                Total Combo Sales
              </span>
              <span className="text-xl font-bold font-mono-num text-slate-900 mt-1 block">
                {analyticsData.totalComboSalesCount}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5">
              <span className="text-[11px] font-semibold text-slate-500 block">
                Total Combo Revenue
              </span>
              <span className="text-xl font-bold font-mono-num text-teal-700 mt-1 block">
                {formatCurrency(analyticsData.totalComboRevenue, lang)}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5">
              <span className="text-[11px] font-semibold text-slate-500 block">
                Total Combo Discount
              </span>
              <span className="text-xl font-bold font-mono-num text-amber-700 mt-1 block">
                {formatCurrency(analyticsData.totalComboDiscount, lang)}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5">
              <span className="text-[11px] font-semibold text-slate-500 block">
                Total Combo Profit
              </span>
              <span className="text-xl font-bold font-mono-num text-emerald-700 mt-1 block">
                {canViewCosts ? formatCurrency(analyticsData.totalComboProfit, lang) : 'Restricted'}
              </span>
            </div>
          </div>

          {/* 9. Best-Selling Combos & 10. Product-wise Qty Sold Through Combos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Best-Selling Combos */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-teal-700" />
                  <span>Best-Selling Combos</span>
                </h3>
                <span className="text-[11px] text-slate-500 font-mono-num">
                  {analyticsData.bestSellingCombos.length} offers
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Combo Name</th>
                      <th className="py-2.5 px-3 font-semibold text-center">Sold</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Revenue</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Discount</th>
                      {canViewCosts && (
                        <th className="py-2.5 px-3 font-semibold text-right">Profit</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analyticsData.bestSellingCombos.map(row => (
                      <tr key={row.offerId} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-bold text-slate-900">{row.offerName}</td>
                        <td className="py-2.5 px-3 text-center font-mono-num font-bold text-teal-700">
                          {row.packagesSold}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num font-semibold text-slate-900">
                          {formatCurrency(row.revenue, lang)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-amber-700">
                          -{formatCurrency(row.discountGiven, lang)}
                        </td>
                        {canViewCosts && (
                          <td className="py-2.5 px-3 text-right font-mono-num font-bold text-emerald-700">
                            {formatCurrency(row.grossProfit, lang)}
                          </td>
                        )}
                      </tr>
                    ))}
                    {analyticsData.bestSellingCombos.length === 0 && (
                      <tr>
                        <td
                          colSpan={canViewCosts ? 5 : 4}
                          className="py-10 text-center text-slate-400 text-xs"
                        >
                          No combo sales recorded in the selected date window.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Product-wise Qty Sold Through Combos */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-teal-700" />
                  <span>Product-wise Qty Sold Through Combos</span>
                </h3>
                <span className="text-[11px] text-slate-500 font-mono-num">
                  {analyticsData.productWiseComboBreakdown.length} items
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Product &amp; Variant</th>
                      <th className="py-2.5 px-3 font-semibold">SKU</th>
                      <th className="py-2.5 px-3 font-semibold text-center">Qty Sold</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Allocated Sales</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analyticsData.productWiseComboBreakdown.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{item.productName}</div>
                          {item.variantDetails && (
                            <span className="text-[10px] font-mono text-slate-500">
                              {item.variantDetails}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-500">{item.sku || '—'}</td>
                        <td className="py-2.5 px-3 text-center font-mono-num font-bold text-slate-900">
                          {item.qtySold}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num font-semibold text-teal-700">
                          {formatCurrency(item.allocatedRevenue, lang)}
                        </td>
                      </tr>
                    ))}
                    {analyticsData.productWiseComboBreakdown.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-10 text-center text-slate-400 text-xs">
                          No component breakdown available for this date range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 4: ONLINE MARKETPLACE ORDERS ==================== */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Truck className="w-4 h-4 text-teal-600" />
                <span>Online Marketplace Combo Orders</span>
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Confirming a pending order atomically verifies live branch stock and creates a POS invoice once (zero double deduction across later shipping/delivery updates).
              </p>
            </div>

            <select
              aria-label="Filter Online Orders Status"
              value={orderStatusFilter}
              onChange={e => setOrderStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700"
            >
              <option value="all">All Order Statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="processing">Processing</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">Order #</th>
                    <th className="py-2.5 px-3 font-semibold">Combo Package</th>
                    <th className="py-2.5 px-3 font-semibold">Customer &amp; Delivery</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Total</th>
                    <th className="py-2.5 px-3 font-semibold">Inventory Sync</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Workflow Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {marketplaceOrders
                    .filter(o => orderStatusFilter === 'all' || o.status === orderStatusFilter)
                    .map(order => {
                      const branchName =
                        branches.find(b => b.id === order.branchId)?.name || 'Main Branch';
                      const isProcessingThis = processingOrderId === order.id;

                      const handleOrderMove = async (next: MarketplaceComboOrderStatus) => {
                        setProcessingOrderId(order.id);
                        try {
                          const updated = await updateMarketplaceOrderStatus(order.id, next);
                          setBannerMessage({
                            tone: 'success',
                            text: updated.linkedInvoiceNumber
                              ? `Order ${updated.orderNumber} updated to "${next}" · Invoice ${updated.linkedInvoiceNumber}.`
                              : `Order ${updated.orderNumber} updated to "${next}".`,
                          });
                        } catch (err: any) {
                          setBannerMessage({
                            tone: 'error',
                            text: err?.message || 'Failed to update online order status.',
                          });
                        } finally {
                          setProcessingOrderId(null);
                        }
                      };

                      return (
                        <tr key={order.id} className="hover:bg-slate-50">
                          <td className="py-3 px-3 align-top">
                            <div className="font-mono font-bold text-slate-900">
                              {order.orderNumber}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {formatDate(order.createdAt, lang)}
                            </div>
                            <div className="text-[10px] text-teal-700 font-semibold">
                              {branchName}
                            </div>
                          </td>
                          <td className="py-3 px-3 align-top">
                            <div className="font-bold text-slate-900">
                              {order.comboQuantity}× {order.comboOfferName}
                            </div>
                            <div className="text-[10px] text-slate-500 uppercase">
                              {order.paymentMethod.replace(/_/g, ' ')} · {order.paymentStatus}
                            </div>
                          </td>
                          <td className="py-3 px-3 align-top">
                            <div className="font-semibold text-slate-900">{order.customerName}</div>
                            <div className="font-mono text-[11px] text-slate-600">
                              {order.customerPhone}
                            </div>
                            <div className="text-[10px] text-slate-500 max-w-xs truncate">
                              {order.customerAddress}
                            </div>
                          </td>
                          <td className="py-3 px-3 align-top text-right font-mono-num">
                            <div className="font-extrabold text-slate-900">
                              {formatCurrency(order.totalAmount, lang)}
                            </div>
                            {order.discountAmount > 0 && (
                              <div className="text-[10px] text-emerald-700">
                                Saved {formatCurrency(order.discountAmount, lang)}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 align-top">
                            {order.stockDeducted ? (
                              <div>
                                <span className="text-[11px] font-bold text-emerald-700 block">
                                  Stock Deducted
                                </span>
                                {order.linkedInvoiceNumber && (
                                  <span className="text-[10px] font-mono text-slate-500">
                                    {order.linkedInvoiceNumber}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] font-semibold text-amber-700">
                                Not Deducted Yet
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 align-top">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                order.status === 'delivered'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : order.status === 'cancelled'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : order.status === 'pending'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-sky-50 text-sky-700 border border-sky-200'
                              }`}
                            >
                              {order.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 align-top text-right">
                            {canProcessOnlineOrders ? (
                              <div className="inline-flex flex-wrap justify-end gap-1.5">
                                {order.status === 'pending' && (
                                  <button
                                    type="button"
                                    disabled={isProcessingThis}
                                    onClick={() => handleOrderMove('confirmed')}
                                    className="px-2.5 py-1 rounded-lg bg-[#101B3F] hover:bg-[#19295c] text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                                  >
                                    {isProcessingThis ? 'Confirming...' : 'Confirm & Deduct Stock'}
                                  </button>
                                )}
                                {order.status === 'confirmed' && (
                                  <button
                                    type="button"
                                    disabled={isProcessingThis}
                                    onClick={() => handleOrderMove('processing')}
                                    className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold cursor-pointer"
                                  >
                                    Mark Processing
                                  </button>
                                )}
                                {order.status === 'processing' && (
                                  <button
                                    type="button"
                                    disabled={isProcessingThis}
                                    onClick={() => handleOrderMove('shipped')}
                                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold cursor-pointer"
                                  >
                                    Mark Shipped
                                  </button>
                                )}
                                {(order.status === 'confirmed' ||
                                  order.status === 'processing' ||
                                  order.status === 'shipped') && (
                                  <button
                                    type="button"
                                    disabled={isProcessingThis}
                                    onClick={() => handleOrderMove('delivered')}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                                  >
                                    Mark Delivered
                                  </button>
                                )}
                                {order.status === 'pending' && (
                                  <button
                                    type="button"
                                    disabled={isProcessingThis}
                                    onClick={() => handleOrderMove('cancelled')}
                                    className="px-2 py-1 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-[11px] font-semibold cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400">View Only</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  {marketplaceOrders.filter(
                    o => orderStatusFilter === 'all' || o.status === orderStatusFilter
                  ).length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                        No online combo orders yet. Open <strong>Online Preview</strong> on any published combo to test and submit customer orders.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: CUSTOMER PREVIEW ==================== */}
      {previewOffer && (
        <div
          onClick={() => {
            setPreviewActionError(null);
            setPreviewOffer(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <span className="text-xs font-bold uppercase tracking-wider text-teal-700">
                Customer Combo Preview
              </span>
              <button
                type="button"
                onClick={() => {
                  setPreviewActionError(null);
                  setPreviewOffer(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="flex items-start gap-3.5">
                <ProductThumbnail src={previewOffer.image} alt={previewOffer.name} size="lg" />
                <div className="min-w-0 flex-1">
                  {previewOffer.comboCategory && (
                    <span className="inline-block px-2 py-0.5 rounded bg-teal-50 text-teal-700 text-[10px] font-bold uppercase">
                      {previewOffer.comboCategory}
                    </span>
                  )}
                  <h3 className="text-base font-bold text-slate-900 mt-1">{previewOffer.name}</h3>
                  {previewOffer.description && (
                    <p className="text-xs text-slate-500 mt-0.5">{previewOffer.description}</p>
                  )}
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-1.5">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  What&apos;s Included in This Combo
                </span>
                {previewOffer.items.map((it, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="text-slate-800">
                      <strong className="font-mono-num">{it.quantity}×</strong> {it.productName}
                      {it.variantDetails ? ` (${it.variantDetails})` : ''}
                    </span>
                    <span className="font-mono-num text-slate-500">
                      {it.isFree ? 'FREE' : formatCurrency((it.salePrice || 0) * it.quantity, lang)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-xl bg-teal-50 border border-teal-200">
                <div>
                  <span className="text-[11px] text-teal-800 font-semibold block">
                    Special Combo Offer Price
                  </span>
                  {previewOffer.regularTotalPrice > previewOffer.finalComboPrice && (
                    <span className="text-xs font-mono-num text-slate-500 line-through">
                      Regular: {formatCurrency(previewOffer.regularTotalPrice, lang)}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-xl font-extrabold font-mono-num text-teal-900 block">
                    {formatCurrency(previewOffer.finalComboPrice, lang)}
                  </span>
                  <span className="text-[11px] font-bold text-emerald-700 font-mono-num">
                    Save{' '}
                    {formatCurrency(
                      Math.max(0, previewOffer.regularTotalPrice - previewOffer.finalComboPrice),
                      lang
                    )}{' '}
                    (
                    {comboOfferService.calculateEquivalentDiscountPercent(
                      previewOffer.regularTotalPrice,
                      previewOffer.finalComboPrice
                    )}
                    %)
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Print Combo & Download PDF Actions */}
            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/90 space-y-2.5 shrink-0">
              {previewActionError && (
                <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span className="flex-1">{previewActionError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Print Format
                  </label>
                  <select
                    aria-label="Combo Print Format"
                    value={comboPrintFormat}
                    onChange={e => setComboPrintFormat(e.target.value as ComboPrintFormat)}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg text-slate-800"
                  >
                    <option value="a4">A4 Sheet</option>
                    <option value="a5">A5 Half-Sheet</option>
                    <option value="80mm">80mm Thermal</option>
                    <option value="58mm">58mm Thermal</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    PDF Page Size
                  </label>
                  <select
                    aria-label="Combo PDF Page Size"
                    value={comboPdfFormat}
                    onChange={e => setComboPdfFormat(e.target.value as ComboPdfFormat)}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg text-slate-800"
                  >
                    <option value="a4">A4 PDF</option>
                    <option value="a5">A5 PDF</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={isPrintingCombo}
                  onClick={() => {
                    if (isPrintingCombo || !previewOffer) return;
                    setPreviewActionError(null);
                    setIsPrintingCombo(true);
                    try {
                      const activeBranch =
                        branches.find(
                          b =>
                            b.id ===
                            (previewOffer.branchId && previewOffer.branchId !== 'all'
                              ? previewOffer.branchId
                              : activeBranchId)
                        ) || branches[0];
                      const res = printComboOffer(
                        previewOffer,
                        products,
                        settings,
                        comboPrintFormat,
                        activeBranch
                      );
                      if (!res.opened && !res.cancelled) {
                        setPreviewActionError(
                          res.error || 'Could not open browser print dialog.'
                        );
                      }
                    } catch (err: any) {
                      setPreviewActionError(err?.message || 'Failed to print combo.');
                    } finally {
                      setIsPrintingCombo(false);
                    }
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#101B3F] hover:bg-[#1b2d66] disabled:opacity-60 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  {isPrintingCombo ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Printer className="w-4 h-4" />
                  )}
                  <span>{isPrintingCombo ? 'Opening Print...' : 'Print Combo'}</span>
                </button>

                <button
                  type="button"
                  disabled={isDownloadingComboPdf}
                  onClick={async () => {
                    if (isDownloadingComboPdf || !previewOffer) return;
                    setPreviewActionError(null);
                    setIsDownloadingComboPdf(true);
                    try {
                      const activeBranch =
                        branches.find(
                          b =>
                            b.id ===
                            (previewOffer.branchId && previewOffer.branchId !== 'all'
                              ? previewOffer.branchId
                              : activeBranchId)
                        ) || branches[0];
                      const res = await downloadComboOfferPdf(
                        previewOffer,
                        products,
                        settings,
                        comboPdfFormat,
                        activeBranch
                      );
                      if (!res.ok) {
                        setPreviewActionError(res.error || 'Failed to download PDF.');
                      }
                    } catch (err: any) {
                      setPreviewActionError(err?.message || 'Failed to generate combo PDF.');
                    } finally {
                      setIsDownloadingComboPdf(false);
                    }
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  {isDownloadingComboPdf ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4" />
                  )}
                  <span>{isDownloadingComboPdf ? 'Generating PDF...' : 'Download PDF'}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  const targetId = previewOffer.id;
                  setPreviewOffer(null);
                  setPosterStudioOfferId(targetId);
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#D6AD60] bg-[#101B3F]/5 hover:bg-[#101B3F]/10 text-[#101B3F] text-xs font-bold transition-colors cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5 text-[#D6AD60]" />
                <span>Open in Combo Poster Studio (PNG / JPG / PDF)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: DETAILS & SALES HISTORY ==================== */}
      {detailsOffer && (
        <div
          onClick={() => setDetailsOffer(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{detailsOffer.name}</h3>
                <p className="text-[11px] text-slate-500">
                  {detailsOffer.comboCategory || 'Custom Combo'} · Active from{' '}
                  {detailsOffer.startDate}
                  {detailsOffer.endDate ? ` to ${detailsOffer.endDate}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const targetId = detailsOffer.id;
                    setDetailsOffer(null);
                    setPosterStudioOfferId(targetId);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#101B3F] hover:bg-[#19295c] text-white text-xs font-bold cursor-pointer"
                >
                  <Wand2 className="w-3.5 h-3.5 text-[#D6AD60]" />
                  <span>Create Poster</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsOffer(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] text-slate-500 block">Combo Price</span>
                  <span className="font-bold font-mono-num text-sm text-slate-900">
                    {formatCurrency(detailsOffer.finalComboPrice, lang)}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] text-slate-500 block">Total Sold</span>
                  <span className="font-bold font-mono-num text-sm text-teal-700">
                    {detailsOffer.usageCount}
                  </span>
                </div>
                {canViewCosts && (
                  <>
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] text-slate-500 block">Component Cost</span>
                      <span className="font-bold font-mono-num text-sm text-slate-900">
                        {formatCurrency(detailsOffer.totalCostOfGoods, lang)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] text-slate-500 block">Est. Net Profit</span>
                      <span className="font-bold font-mono-num text-sm text-emerald-700">
                        {formatCurrency(detailsOffer.estimatedNetProfit, lang)}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div>
                <h4 className="font-bold text-slate-900 mb-2">Included Products &amp; Stock</h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-2 px-3">Product</th>
                        <th className="py-2 px-3">Variant</th>
                        <th className="py-2 px-3 text-center">Qty / Combo</th>
                        <th className="py-2 px-3 text-right">Live Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detailsOffer.items.map((it, idx) => {
                        const prod = products.find(p => p.id === it.productId);
                        const variant = it.variantId
                          ? prod?.variants?.find(v => v.id === it.variantId)
                          : undefined;
                        const liveStock = variant ? variant.stock : prod?.currentStock ?? 0;
                        return (
                          <tr key={idx}>
                            <td className="py-2 px-3 font-semibold text-slate-900">
                              {it.productName}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-500">
                              {it.variantDetails || 'Standard'}
                            </td>
                            <td className="py-2 px-3 text-center font-mono-num font-bold">
                              {it.quantity}
                            </td>
                            <td className="py-2 px-3 text-right font-mono-num font-bold text-emerald-700">
                              {liveStock}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-900 mb-2">Combo Sales History</h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-2 px-3">Invoice</th>
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Customer</th>
                        <th className="py-2 px-3 text-center">Combos</th>
                        <th className="py-2 px-3 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {normalizedUsageRecords
                        .filter(r => r.offerId === detailsOffer.id)
                        .map(r => (
                          <tr key={r.id}>
                            <td className="py-2 px-3 font-mono font-bold text-slate-900">
                              {r.invoiceNumber}
                            </td>
                            <td className="py-2 px-3 text-slate-500">
                              {formatDate(r.date, lang)}
                            </td>
                            <td className="py-2 px-3 text-slate-800">{r.customerName}</td>
                            <td className="py-2 px-3 text-center font-mono-num font-bold">
                              {r.comboQuantity}
                            </td>
                            <td className="py-2 px-3 text-right font-mono-num font-bold text-teal-700">
                              {formatCurrency(r.revenue, lang)}
                            </td>
                          </tr>
                        ))}
                      {normalizedUsageRecords.filter(r => r.offerId === detailsOffer.id).length ===
                        0 && (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-400">
                            No sales recorded for this combo yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: ADMIN DELETE CONFIRMATION ==================== */}
      {deleteTargetOffer && (
        <div
          onClick={() => !isDeletingOffer && setDeleteTargetOffer(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl border border-rose-200 shadow-2xl w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Delete Combo Offer?</h3>
                <p className="text-xs text-slate-500">{deleteTargetOffer.name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              This permanently removes the combo definition. Past sales invoices and inventory logs are preserved safely. Prefer Archive if you want to keep historical references.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={isDeletingOffer}
                onClick={() => setDeleteTargetOffer(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingOffer}
                onClick={handleConfirmDeleteOffer}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
              >
                {isDeletingOffer ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Embedded Camera / HID Barcode & QR Scanner Modal */}
      <ScannerModal
        isOpen={isScannerOpen}
        mode="pos"
        products={products}
        activeBranchId={builderStockBranch}
        currencyLanguage={lang}
        onClose={() => setIsScannerOpen(false)}
        onResultForPos={handleBuilderScannedMatch}
      />

      {/* ==================== MODAL: COMBO POSTER STUDIO ==================== */}
      {activePosterOffer && (
        <ComboPosterStudioModal
          offer={activePosterOffer}
          products={products}
          settings={settings}
          activeBranch={
            branches.find(
              b =>
                b.id ===
                (activePosterOffer.branchId && activePosterOffer.branchId !== 'all'
                  ? activePosterOffer.branchId
                  : activeBranchId)
            ) || branches[0]
          }
          onClose={() => setPosterStudioOfferId(null)}
          onOpenSettings={onOpenSettings}
          onSaveOfferPosterData={async updates => {
            await updateComboOffer(activePosterOffer.id, updates);
          }}
        />
      )}

      {/* ==================== MODAL: ONLINE MARKETPLACE PREVIEW ==================== */}
      {activeMarketplaceOffer && (
        <ComboMarketplacePreviewModal
          offer={activeMarketplaceOffer}
          products={products}
          settings={settings}
          activeBranch={
            branches.find(
              b =>
                b.id ===
                (activeMarketplaceOffer.branchId && activeMarketplaceOffer.branchId !== 'all'
                  ? activeMarketplaceOffer.branchId
                  : activeBranchId)
            ) || branches[0]
          }
          onClose={() => setMarketplacePreviewOfferId(null)}
          onSubmitOrder={createMarketplaceOrder}
        />
      )}
    </div>
  );
};
