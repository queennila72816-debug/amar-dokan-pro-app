import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  ComboOffer,
  ComboOfferItem,
  OfferType,
  OfferStatus,
  OfferDiscountType,
  ProductVariant,
} from '../../types';
import { comboOfferService } from '../../services/comboOfferService';
import { normalizeRoleKey } from '../../utils/rbacDefaults';
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
} from 'lucide-react';

export const ComboOffersView: React.FC = () => {
  const {
    comboOffers,
    addComboOffer,
    updateComboOffer,
    toggleOfferStatus,
    archiveComboOffer,
    products,
    branches,
    settings,
    currentUserRole,
    isAuthenticatedAdmin,
    sales,
    activeBusinessId,
  } = useApp();

  const isAdmin = isAuthenticatedAdmin || normalizeRoleKey(currentUserRole) === 'super_admin';
  const [isSavingOffer, setIsSavingOffer] = useState(false);
  const currency = settings.currency || '৳';

  // Navigation tabs: 'offers' | 'create' | 'analytics'
  const [activeTab, setActiveTab] = useState<'offers' | 'create' | 'analytics'>('offers');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<string>('all');

  // Editing state
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formType, setFormType] = useState<OfferType>('fixed_price');
  const [formDiscountType, setFormDiscountType] = useState<OfferDiscountType>('fixed_bundle_price');
  const [formDiscountValue, setFormDiscountValue] = useState<number>(1050);
  const [formMinSpendAmount, setFormMinSpendAmount] = useState<number>(0);
  const [formMinQuantity, setFormMinQuantity] = useState<number>(2);
  const [formStartDate, setFormStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [formEndDate, setFormEndDate] = useState<string>('');
  const [formBranchId, setFormBranchId] = useState<string>('all');
  const [formMaxUsageTotal, setFormMaxUsageTotal] = useState<number | undefined>(undefined);
  const [formMaxUsagePerCustomer, setFormMaxUsagePerCustomer] = useState<number | undefined>(undefined);
  const [formPriority, setFormPriority] = useState<number>(10);
  const [formItems, setFormItems] = useState<ComboOfferItem[]>([]);

  // Admin Override
  const [allowBelowFloor, setAllowBelowFloor] = useState<boolean>(false);
  const [overrideReason, setOverrideReason] = useState<string>('');

  // Item selector modal state
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState<string>('all');
  const [pickerQuantity, setPickerQuantity] = useState<number>(1);
  const [pickerIsFree, setPickerIsFree] = useState<boolean>(false);

  // Filtered offers list
  const filteredOffers = useMemo(() => {
    return comboOffers.filter(offer => {
      if (selectedStatusFilter !== 'all' && offer.status !== selectedStatusFilter) {
        return false;
      }
      if (selectedBranchFilter !== 'all' && offer.branchId && offer.branchId !== 'all' && offer.branchId !== selectedBranchFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = offer.name.toLowerCase().includes(q);
        const matchDesc = offer.description?.toLowerCase().includes(q);
        const matchType = offer.offerType.toLowerCase().includes(q);
        return matchName || matchDesc || matchType;
      }
      return true;
    });
  }, [comboOffers, selectedStatusFilter, selectedBranchFilter, searchQuery]);

  // Performance metrics
  const performanceStats = useMemo(() => {
    let totalCombosSold = 0;
    let totalDiscountsGiven = 0;
    let totalComboSalesAmount = 0;

    sales.forEach(sale => {
      if (sale.appliedOffers && sale.appliedOffers.length > 0) {
        sale.appliedOffers.forEach(app => {
          totalCombosSold++;
          totalDiscountsGiven += Number(app.discountAmount || 0);
        });
        totalComboSalesAmount += Number(sale.total || 0);
      } else if (sale.comboDiscount && sale.comboDiscount > 0) {
        totalDiscountsGiven += Number(sale.comboDiscount);
        totalComboSalesAmount += Number(sale.total || 0);
      }
    });

    return {
      activeOffersCount: comboOffers.filter(o => o.status === 'active').length,
      totalCombosSold,
      totalDiscountsGiven,
      totalComboSalesAmount,
    };
  }, [sales, comboOffers]);

  // Live PnL calculation for the current form
  const formPnL = useMemo(() => {
    return comboOfferService.calculateComboPnL(
      formItems,
      formDiscountType,
      formDiscountValue,
      products
    );
  }, [formItems, formDiscountType, formDiscountValue, products]);

  // Reset form to blank
  const resetForm = () => {
    setEditingOfferId(null);
    setFormName('');
    setFormDescription('');
    setFormType('fixed_price');
    setFormDiscountType('fixed_bundle_price');
    setFormDiscountValue(1050);
    setFormMinSpendAmount(0);
    setFormMinQuantity(2);
    setFormStartDate(new Date().toISOString().split('T')[0]);
    setFormEndDate('');
    setFormBranchId('all');
    setFormMaxUsageTotal(undefined);
    setFormMaxUsagePerCustomer(undefined);
    setFormPriority(10);
    setFormItems([]);
    setAllowBelowFloor(false);
    setOverrideReason('');
  };

  // Open Edit Offer
  const startEditOffer = (offer: ComboOffer) => {
    setEditingOfferId(offer.id || null);
    setFormName(offer.name);
    setFormDescription(offer.description || '');
    setFormType(offer.offerType);
    setFormDiscountType(offer.discountType);
    setFormDiscountValue(offer.discountValue);
    setFormMinSpendAmount(offer.minSpendAmount || 0);
    setFormMinQuantity(offer.minPurchaseQuantity || 2);
    setFormStartDate(offer.startDate ? offer.startDate.split('T')[0] : '');
    setFormEndDate(offer.endDate ? offer.endDate.split('T')[0] : '');
    setFormBranchId(offer.branchId || 'all');
    setFormMaxUsageTotal(offer.maxUsageLimit);
    setFormMaxUsagePerCustomer(offer.perCustomerLimit);
    setFormPriority(offer.priorityRank || 10);
    setFormItems(offer.items || []);
    setAllowBelowFloor(Boolean(offer.lossApprovedBy));
    setOverrideReason(offer.lossOverrideReason || '');
    setActiveTab('create');
  };

  // Add item into form
  const handleAddItemToForm = () => {
    const prod = products.find(p => p.id === selectedProductId);
    if (!prod) return;

    let variantInfo: ProductVariant | undefined = undefined;
    let unitSellingPrice = prod.salePrice;
    let unitPurchaseCost = prod.totalUnitCost || prod.purchasePrice || 0;

    if (selectedVariantId !== 'all' && prod.variants) {
      variantInfo = prod.variants.find(v => v.id === selectedVariantId);
      if (variantInfo) {
        if (variantInfo.salePrice !== undefined) unitSellingPrice = variantInfo.salePrice;
        if (variantInfo.purchasePrice !== undefined) unitPurchaseCost = variantInfo.purchasePrice;
      }
    }

    const variantDetails = variantInfo
      ? [variantInfo.color, variantInfo.size].filter(Boolean).join(' / ')
      : undefined;

    const newItem: ComboOfferItem = {
      id: `coi-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      productId: prod.id,
      productName: prod.name,
      variantId: selectedVariantId !== 'all' ? selectedVariantId : undefined,
      variantDetails,
      sku: variantInfo?.sku || prod.code,
      quantity: Math.max(1, pickerQuantity),
      salePrice: unitSellingPrice,
      purchasePrice: unitPurchaseCost,
      isFree: pickerIsFree,
      categoryId: prod.category,
    };

    setFormItems(prev => [...prev, newItem]);
    setShowItemPicker(false);
    setSelectedProductId('');
    setSelectedVariantId('all');
    setPickerQuantity(1);
    setPickerIsFree(false);
  };

  const handleRemoveFormItem = (index: number) => {
    setFormItems(prev => prev.filter((_, i) => i !== index));
  };

  // Preset offer template helper
  const applyPresetTemplate = (type: OfferType) => {
    setFormType(type);
    if (type === 'fixed_price') {
      setFormDiscountType('fixed_bundle_price');
      setFormName('Shirt + Pant Special Combo');
      setFormDescription("Get 1 Men's Shirt and 1 Chino Pant for a special combo price");
      setFormDiscountValue(1050);
    } else if (type === 'buy_x_discount') {
      setFormDiscountType('percentage');
      setFormName('Buy 2 T-Shirts Get 10% Off');
      setFormDescription('Purchase any 2 eligible T-Shirts and receive an instant 10% bundle discount');
      setFormDiscountValue(10);
      setFormMinQuantity(2);
    } else if (type === 'buy_x_get_y') {
      setFormDiscountType('free_item');
      setFormName('Buy 2 Get 1 FREE');
      setFormDescription('Buy 2 eligible items and get 1 matching item completely FREE');
      setFormDiscountValue(0);
      setFormMinQuantity(2);
    } else if (type === 'category_bundle') {
      setFormDiscountType('fixed_discount');
      setFormName('Festive Three-Piece + Burqa Bundle');
      setFormDescription('Buy 1 Three-Piece and 1 Burqa together to save ৳200 instantly');
      setFormDiscountValue(200);
    } else if (type === 'spend_and_save') {
      setFormDiscountType('fixed_discount');
      setFormName('Spend ৳2,000 Save ৳100');
      setFormDescription('Save ৳100 automatically on any order over ৳2,000');
      setFormMinSpendAmount(2000);
      setFormDiscountValue(100);
    } else if (type === 'quantity_discount') {
      setFormDiscountType('percentage');
      setFormName('Volume Discount: 3+ Shirts 15% Off');
      setFormDescription('Buy 3 or more shirts and unlock 15% bulk discount');
      setFormDiscountValue(15);
      setFormMinQuantity(3);
    }
  };

  // Submit Offer
  const handleSaveOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingOffer) return;

    if (!formName.trim()) {
      alert('Please enter an offer name.');
      return;
    }

    if (formType !== 'spend_and_save' && formItems.length === 0) {
      alert('Please add at least one product or variant to this combo offer.');
      return;
    }

    // Floor price protection check
    if (formPnL.isLossMaking && formType !== 'spend_and_save') {
      if (!isAdmin) {
        alert('Selling price is below the safe break-even floor cost! Only an Admin or Store Owner can authorize this loss-leading offer.');
        return;
      }
      if (!allowBelowFloor) {
        alert('This offer price is below the safe minimum floor price! If you intend to run this as an authorized loss-leader, check the "Authorize Selling Below Safe Floor Price" box.');
        return;
      }
      if (!overrideReason.trim()) {
        alert('Please enter a business justification/reason for overriding the minimum safe price.');
        return;
      }
    }

    const offerPayload: Omit<ComboOffer, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'> = {
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      offerType: formType,
      items: formItems,
      minSpendAmount: formType === 'spend_and_save' ? Number(formMinSpendAmount || 0) : undefined,
      minPurchaseQuantity: formMinQuantity ? Number(formMinQuantity) : undefined,
      regularTotalPrice: formPnL.regularTotalPrice,
      discountType: formDiscountType,
      discountValue: Number(formDiscountValue || 0),
      finalComboPrice: formPnL.finalComboPrice,
      totalCostOfGoods: formPnL.totalCostOfGoods,
      allocatedOpEx: formPnL.allocatedOpEx,
      grossProfit: formPnL.grossProfit,
      estimatedNetProfit: formPnL.estimatedNetProfit,
      profitMarginPercent: formPnL.profitMarginPercent,
      isLossMaking: formPnL.isLossMaking,
      minSafeSellingPrice: formPnL.minSafeSellingPrice,
      lossOverrideReason: formPnL.isLossMaking ? overrideReason.trim() : undefined,
      lossApprovedBy: formPnL.isLossMaking && allowBelowFloor ? (currentUserRole || 'admin') : undefined,
      startDate: formStartDate,
      endDate: formEndDate || undefined,
      status: 'active',
      maxUsageLimit: formMaxUsageTotal ? Number(formMaxUsageTotal) : undefined,
      perCustomerLimit: formMaxUsagePerCustomer ? Number(formMaxUsagePerCustomer) : undefined,
      branchId: formBranchId !== 'all' ? formBranchId : 'all',
      priorityRank: Number(formPriority || 10),
      businessId: activeBusinessId || 'default-business',
    };

    setIsSavingOffer(true);
    try {
      if (editingOfferId) {
        await updateComboOffer(editingOfferId, offerPayload);
      } else {
        await addComboOffer(offerPayload);
      }
      resetForm();
      setActiveTab('offers');
    } catch (err: any) {
      console.error('Failed to save offer:', err);
      alert('Could not save combo offer: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSavingOffer(false);
    }
  };

  // Helper labels
  const getOfferTypeBadge = (type: OfferType) => {
    switch (type) {
      case 'fixed_price':
        return { label: 'Fixed Price Combo', color: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: DollarSign };
      case 'buy_x_discount':
        return { label: 'Buy X Get Discount', color: 'bg-blue-100 text-blue-800 border-blue-300', icon: Percent };
      case 'buy_x_get_y':
        return { label: 'Buy X Get Y Free', color: 'bg-purple-100 text-purple-800 border-purple-300', icon: Gift };
      case 'category_bundle':
        return { label: 'Category Bundle', color: 'bg-indigo-100 text-indigo-800 border-indigo-300', icon: Layers };
      case 'spend_and_save':
        return { label: 'Spend & Save', color: 'bg-amber-100 text-amber-800 border-amber-300', icon: TrendingUp };
      case 'quantity_discount':
        return { label: 'Quantity Tier', color: 'bg-rose-100 text-rose-800 border-rose-300', icon: Tag };
      default:
        return { label: String(type), color: 'bg-slate-100 text-slate-800 border-slate-300', icon: Tag };
    }
  };

  const getStatusBadge = (status: OfferStatus) => {
    switch (status) {
      case 'active':
        return { label: 'Active', color: 'bg-emerald-500 text-white' };
      case 'paused':
        return { label: 'Paused', color: 'bg-amber-500 text-white' };
      case 'expired':
        return { label: 'Expired', color: 'bg-slate-500 text-white' };
      case 'draft':
        return { label: 'Draft', color: 'bg-blue-500 text-white' };
      case 'archived':
        return { label: 'Archived', color: 'bg-gray-400 text-white' };
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-600 text-white rounded-lg shadow-sm">
              <Gift className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Combo &amp; Bundle Offers
              </h1>
              <p className="text-sm text-slate-500">
                Create apparel bundles, volume deals, Buy X Get Y offers with live Profit &amp; Loss protection.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeTab !== 'create' ? (
            <button
              onClick={() => {
                resetForm();
                setActiveTab('create');
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-sm shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Offer</span>
            </button>
          ) : (
            <button
              onClick={() => {
                resetForm();
                setActiveTab('offers');
              }}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-lg text-sm transition-colors"
            >
              <span>Back to Offers</span>
            </button>
          )}
        </div>
      </div>

      {/* Top Stat Summary Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Active Offers</p>
            <p className="text-2xl font-bold text-slate-900">{performanceStats.activeOffersCount}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Combos Sold</p>
            <p className="text-2xl font-bold text-slate-900">{performanceStats.totalCombosSold}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Total Combo Sales</p>
            <p className="text-2xl font-bold text-slate-900">{currency}{performanceStats.totalComboSalesAmount.toLocaleString()}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
            <Tag className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Discounts Given</p>
            <p className="text-2xl font-bold text-slate-900">{currency}{performanceStats.totalDiscountsGiven.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('offers')}
          className={`py-3 px-5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'offers'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>All Combo Offers ({comboOffers.length})</span>
        </button>

        <button
          onClick={() => {
            if (activeTab !== 'create') resetForm();
            setActiveTab('create');
          }}
          className={`py-3 px-5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'create'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Plus className="w-4 h-4" />
          <span>{editingOfferId ? 'Edit Combo Offer' : 'Create Offer Wizard'}</span>
        </button>

        <button
          onClick={() => setActiveTab('analytics')}
          className={`py-3 px-5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'analytics'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Offer Performance &amp; Analytics</span>
        </button>
      </div>

      {/* VIEW 1: OFFERS LIST */}
      {activeTab === 'offers' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search offer by name, type, description..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg text-xs font-medium">
                {['all', 'active', 'paused', 'expired', 'archived'].map(status => (
                  <button
                    key={status}
                    onClick={() => setSelectedStatusFilter(status)}
                    className={`px-3 py-1.5 rounded-md capitalize transition-colors ${
                      selectedStatusFilter === status
                        ? 'bg-white text-slate-900 shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>

              {branches.length > 1 && (
                <select
                  value={selectedBranchFilter}
                  onChange={e => setSelectedBranchFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="all">All Branches</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Cards Grid */}
          {filteredOffers.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                <Gift className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-1">No Combo Offers Found</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
                {searchQuery || selectedStatusFilter !== 'all'
                  ? 'No offers match your search or filter criteria. Try clearing filters.'
                  : 'Boost your apparel sales by creating attractive combos like 1 Shirt + 1 Pant for ৳1,050 or Buy 2 Get 1 Free!'}
              </p>
              <button
                onClick={() => {
                  resetForm();
                  setActiveTab('create');
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg text-sm shadow-sm hover:bg-emerald-700"
              >
                <Plus className="w-4 h-4" />
                <span>Create Your First Combo Offer</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredOffers.map(offer => {
                const typeBadge = getOfferTypeBadge(offer.offerType);
                const statusBadge = getStatusBadge(offer.status);
                const pnl = comboOfferService.calculateComboPnL(
                  offer.items || [],
                  offer.discountType,
                  offer.discountValue,
                  products
                );
                const fulfillment = comboOfferService.checkOfferFulfillment(offer, products);
                const insufficientItems = fulfillment.itemStatuses
                  .filter(s => !s.isAvailable)
                  .map(s => `${s.productName}${s.variantDetails ? ` (${s.variantDetails})` : ''}: need ${s.requiredQty}, stock ${s.availableStock}`);

                const TypeIcon = typeBadge.icon;

                return (
                  <div
                    key={offer.id}
                    className="bg-white rounded-xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between overflow-hidden"
                  >
                    {/* Top banner / header */}
                    <div className="p-4 border-b border-slate-100">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${typeBadge.color}`}>
                          <TypeIcon className="w-3.5 h-3.5" />
                          <span>{typeBadge.label}</span>
                        </span>

                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusBadge.color}`}>
                          {statusBadge.label}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-slate-900 line-clamp-1">{offer.name}</h3>
                      {offer.description && (
                        <p className="text-xs text-slate-500 line-clamp-2 mt-1">{offer.description}</p>
                      )}
                    </div>

                    {/* Middle: Items & Stock fulfillment */}
                    <div className="p-4 space-y-3 flex-1 bg-slate-50/50">
                      {/* Products included */}
                      <div>
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                          Included Products ({offer.items?.length || 0})
                        </p>
                        <div className="space-y-1">
                          {offer.items && offer.items.length > 0 ? (
                            offer.items.map((item, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between text-xs bg-white p-2 rounded-lg border border-slate-200"
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  <span className="font-semibold text-slate-700">{item.quantity}x</span>
                                  <span className="truncate text-slate-800">{item.productName}</span>
                                  {item.variantDetails && (
                                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                                      {item.variantDetails}
                                    </span>
                                  )}
                                </div>
                                {item.isFree ? (
                                  <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">
                                    FREE GIFT
                                  </span>
                                ) : (
                                  <span className="text-slate-500 font-mono text-[11px]">
                                    {currency}{((item.salePrice || 0) * item.quantity).toLocaleString()}
                                  </span>
                                )}
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-slate-500 italic">
                              {offer.offerType === 'spend_and_save'
                                ? `Any cart order above ${currency}${offer.minSpendAmount}`
                                : 'No specific items defined'}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Stock availability status */}
                      {offer.offerType !== 'spend_and_save' && (
                        <div className="p-2.5 rounded-lg border text-xs">
                          {fulfillment.canFulfill ? (
                            <div className="flex items-center justify-between text-emerald-800 bg-emerald-50/60 p-1.5 rounded">
                              <span className="flex items-center gap-1.5 font-medium">
                                <CheckCircle className="w-4 h-4 text-emerald-600" />
                                <span>Stock Available</span>
                              </span>
                              <span className="font-bold">
                                Can Fulfill: {fulfillment.maxCombos} combos
                              </span>
                            </div>
                          ) : (
                            <div className="space-y-1 text-rose-800 bg-rose-50/60 p-1.5 rounded">
                              <div className="flex items-center gap-1.5 font-medium">
                                <AlertTriangle className="w-4 h-4 text-rose-600" />
                                <span>Stock Shortage</span>
                              </div>
                              <p className="text-[11px] text-rose-700">
                                {insufficientItems.join(', ')}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Financial breakdown */}
                      <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5 text-xs">
                        <div className="flex justify-between text-slate-500">
                          <span>Regular Total:</span>
                          <span className="line-through">{currency}{pnl.regularTotalPrice.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between font-bold text-slate-900 text-sm">
                          <span>Combo Offer Price:</span>
                          <span className="text-emerald-600">{currency}{pnl.finalComboPrice.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-slate-600 pt-1 border-t border-slate-100">
                          <span>Discount Given:</span>
                          <span className="text-rose-600 font-medium">-{currency}{pnl.discountAmount.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-slate-500 text-[11px]">
                          <span>COGS + Free Items:</span>
                          <span>{currency}{pnl.totalCostOfGoods.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-slate-500 text-[11px]">
                          <span>Operating Expense:</span>
                          <span>{currency}{pnl.allocatedOpEx.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between font-semibold pt-1 border-t border-slate-100">
                          <span>Estimated Net Profit:</span>
                          <span className={pnl.estimatedNetProfit >= 0 ? 'text-emerald-700' : 'text-rose-600 font-bold'}>
                            {currency}{pnl.estimatedNetProfit.toLocaleString()} ({pnl.profitMarginPercent}%)
                          </span>
                        </div>

                        {pnl.isLossMaking && offer.offerType !== 'spend_and_save' && (
                          <div className="mt-2 p-1.5 bg-rose-50 border border-rose-200 rounded text-[11px] text-rose-800 flex items-center gap-1.5">
                            <ShieldAlert className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                            <span>
                              Priced below safe floor ({currency}{pnl.minSafeSellingPrice}). {offer.lossApprovedBy ? 'Admin override authorized.' : 'Loss risk.'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Usage and dates info */}
                      <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                        <span>Used: <strong className="text-slate-700">{offer.usageCount || 0}</strong> {offer.maxUsageLimit ? `/ ${offer.maxUsageLimit}` : 'times'}</span>
                        <span>
                          {offer.endDate ? `Ends ${new Date(offer.endDate).toLocaleDateString()}` : 'No expiry'}
                        </span>
                      </div>
                    </div>

                    {/* Bottom Actions */}
                    <div className="p-3 border-t border-slate-100 bg-white flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        {offer.status === 'active' ? (
                          <button
                            onClick={() => toggleOfferStatus(offer.id, 'paused')}
                            title="Pause Offer"
                            className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-md transition-colors"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        ) : offer.status === 'paused' ? (
                          <button
                            onClick={() => toggleOfferStatus(offer.id, 'active')}
                            title="Activate Offer"
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        ) : null}

                        <button
                          onClick={() => startEditOffer(offer)}
                          title="Edit Offer"
                          className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => {
                            const duplicated: ComboOffer = {
                              ...offer,
                              id: '',
                              name: `${offer.name} (Copy)`,
                              createdAt: '',
                              updatedAt: '',
                              usageCount: 0,
                            };
                            startEditOffer(duplicated);
                          }}
                          title="Duplicate Offer"
                          className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>

                      {offer.status !== 'archived' && (
                        <button
                          onClick={() => {
                            if (confirm(`Archive combo offer "${offer.name}"? Past invoice records will remain intact.`)) {
                              archiveComboOffer(offer.id);
                            }
                          }}
                          className="text-xs text-slate-500 hover:text-rose-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-rose-50 transition-colors"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          <span>Archive</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: CREATE / EDIT WIZARD */}
      {activeTab === 'create' && (
        <form onSubmit={handleSaveOffer} className="space-y-6">
          {!editingOfferId && (
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">
                Quick Setup Templates
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {[
                  { type: 'fixed_price' as OfferType, label: 'Fixed Price Combo', desc: '1 Shirt + 1 Pant for ৳1,050', icon: DollarSign, color: 'text-emerald-600' },
                  { type: 'buy_x_discount' as OfferType, label: 'Buy X Get % Off', desc: 'Buy 2 T-Shirts Get 10% Off', icon: Percent, color: 'text-blue-600' },
                  { type: 'buy_x_get_y' as OfferType, label: 'Buy X Get Y Free', desc: 'Buy 2 Get 1 Free (COGS tracked)', icon: Gift, color: 'text-purple-600' },
                  { type: 'category_bundle' as OfferType, label: 'Category Bundle', desc: 'Three-Piece + Burqa ৳200 Off', icon: Layers, color: 'text-indigo-600' },
                  { type: 'spend_and_save' as OfferType, label: 'Spend & Save', desc: 'Spend ৳2,000 Save ৳100', icon: TrendingUp, color: 'text-amber-600' },
                  { type: 'quantity_discount' as OfferType, label: 'Volume Tier', desc: 'Buy 3+ Shirts Get 15% Off', icon: Tag, color: 'text-rose-600' },
                ].map(tmpl => {
                  const Icon = tmpl.icon;
                  const isSelected = formType === tmpl.type;
                  return (
                    <button
                      key={tmpl.type}
                      type="button"
                      onClick={() => applyPresetTemplate(tmpl.type)}
                      className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/20'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <Icon className={`w-5 h-5 ${tmpl.color}`} />
                        {isSelected && <Check className="w-4 h-4 text-emerald-600" />}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800">{tmpl.label}</p>
                        <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{tmpl.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: Offer Details & Item Selection */}
            <div className="lg:col-span-2 space-y-6">
              {/* Basic Info Card */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
                <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
                  1. Offer Details &amp; Validity
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Offer Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Eid Mega Shirt + Chino Pant Combo"
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Offer Pitch / Customer Description
                    </label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Buy any casual shirt with a chino pant and get the entire set for ৳1,050 only!"
                      value={formDescription}
                      onChange={e => setFormDescription(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Branch Eligibility
                    </label>
                    <select
                      value={formBranchId}
                      onChange={e => setFormBranchId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="all">All Branches (Global Offer)</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Priority Ranking (Higher = Evaluated First)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={formPriority}
                      onChange={e => setFormPriority(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={formStartDate}
                      onChange={e => setFormStartDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      End Date (Optional)
                    </label>
                    <input
                      type="date"
                      value={formEndDate}
                      onChange={e => setFormEndDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Max Total Usage Limit (Optional)
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 50 (first 50 customers)"
                      value={formMaxUsageTotal ?? ''}
                      onChange={e => setFormMaxUsageTotal(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Max Usage Per Customer (Optional)
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 1 (one per customer)"
                      value={formMaxUsagePerCustomer ?? ''}
                      onChange={e => setFormMaxUsagePerCustomer(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Product & Variant Inclusion Card */}
              {formType !== 'spend_and_save' && (
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        2. Included Products &amp; Variants
                      </h3>
                      <p className="text-xs text-slate-500">
                        Specify the exact apparel variants (size, color, SKU) or whole products required.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowItemPicker(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold rounded-lg text-xs border border-emerald-200 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Product / Variant</span>
                    </button>
                  </div>

                  {formItems.length === 0 ? (
                    <div className="p-8 border-2 border-dashed border-slate-200 rounded-xl text-center">
                      <ShoppingBag className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs font-semibold text-slate-600">No products added yet</p>
                      <p className="text-[11px] text-slate-400 mb-3">Add items to configure bundle pricing and check stock availability.</p>
                      <button
                        type="button"
                        onClick={() => setShowItemPicker(true)}
                        className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium"
                      >
                        Select Products
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {formItems.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800 text-sm">
                                {item.quantity}x {item.productName}
                              </span>
                              {item.variantDetails && (
                                <span className="bg-white border border-slate-300 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-700">
                                  {item.variantDetails}
                                </span>
                              )}
                              {item.isFree && (
                                <span className="bg-purple-100 text-purple-800 font-bold px-1.5 py-0.5 rounded text-[10px] border border-purple-300">
                                  FREE GIFT ITEM
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-slate-500">
                              <span>Regular Price: {currency}{item.salePrice || 0}/pc</span>
                              <span>•</span>
                              <span>Landed Cost: {currency}{item.purchasePrice || 0}/pc</span>
                              {item.sku && <span>• SKU: {item.sku}</span>}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <p className="font-bold text-slate-800">
                                {item.isFree ? 'FREE' : `${currency}${((item.salePrice || 0) * item.quantity).toLocaleString()}`}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                Total Cost: {currency}{((item.purchasePrice || 0) * item.quantity).toLocaleString()}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveFormItem(idx)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Pricing & Discount Type Configuration */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
                <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
                  3. Pricing &amp; Discount Configuration
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Offer Type
                    </label>
                    <select
                      value={formType}
                      onChange={e => {
                        const newType = e.target.value as OfferType;
                        setFormType(newType);
                        if (newType === 'fixed_price') setFormDiscountType('fixed_bundle_price');
                        if (newType === 'buy_x_discount') setFormDiscountType('percentage');
                        if (newType === 'buy_x_get_y') setFormDiscountType('free_item');
                        if (newType === 'category_bundle') setFormDiscountType('fixed_discount');
                        if (newType === 'spend_and_save') setFormDiscountType('fixed_discount');
                        if (newType === 'quantity_discount') setFormDiscountType('percentage');
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-medium"
                    >
                      <option value="fixed_price">Fixed Price Combo (e.g. 1 Shirt + 1 Pant = ৳1,050)</option>
                      <option value="buy_x_discount">Buy X Get Discount (e.g. Buy 2 T-Shirts get 10% off)</option>
                      <option value="buy_x_get_y">Buy X Get Y Free (e.g. Buy 2 get 1 FREE)</option>
                      <option value="category_bundle">Category Bundle (e.g. Three-Piece + Burqa Discount)</option>
                      <option value="spend_and_save">Spend &amp; Save (e.g. Spend ৳2,000 get ৳100 off)</option>
                      <option value="quantity_discount">Quantity Volume Discount (e.g. Buy 3+ shirts get 15% off)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Discount Calculation Model
                    </label>
                    <select
                      value={formDiscountType}
                      onChange={e => setFormDiscountType(e.target.value as OfferDiscountType)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="fixed_bundle_price">Fixed Final Combo Price (৳)</option>
                      <option value="fixed_discount">Flat Discount Amount Off (৳)</option>
                      <option value="percentage">Percentage Discount Off (%)</option>
                      <option value="free_item">Free Item Included (100% off gift)</option>
                    </select>
                  </div>

                  {formDiscountType === 'fixed_bundle_price' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Final Combo Price (৳) *
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        required
                        value={formDiscountValue}
                        onChange={e => setFormDiscountValue(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold text-emerald-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">Customer pays exactly this total amount for the package.</p>
                    </div>
                  )}

                  {formDiscountType === 'fixed_discount' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Discount Amount Off (৳) *
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        required
                        value={formDiscountValue}
                        onChange={e => setFormDiscountValue(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold text-rose-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  )}

                  {formDiscountType === 'percentage' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Percentage Discount (%) *
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="0.5"
                        required
                        value={formDiscountValue}
                        onChange={e => setFormDiscountValue(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold text-blue-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  )}

                  {formType === 'spend_and_save' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Minimum Cart Spend Required (৳) *
                      </label>
                      <input
                        type="number"
                        min="100"
                        value={formMinSpendAmount}
                        onChange={e => setFormMinSpendAmount(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  )}

                  {(formType === 'quantity_discount' || formType === 'buy_x_discount' || formType === 'buy_x_get_y') && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Minimum Units / Threshold (X)
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={formMinQuantity}
                        onChange={e => setFormMinQuantity(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Live Profit & Loss Protection & Summary */}
            <div className="space-y-6">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                  <TrendingUp className="w-5 h-5 text-emerald-600" />
                  <h3 className="text-base font-bold text-slate-900">
                    Profit &amp; Loss Protection
                  </h3>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Regular Combined Price:</span>
                    <span className="font-semibold">{currency}{formPnL.regularTotalPrice.toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between text-rose-600 font-medium">
                    <span>Total Discount:</span>
                    <span>-{currency}{formPnL.discountAmount.toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between text-slate-900 font-bold text-sm pt-2 border-t border-slate-100">
                    <span>Final Combo Selling Price:</span>
                    <span className="text-emerald-700">{currency}{formPnL.finalComboPrice.toLocaleString()}</span>
                  </div>

                  <div className="pt-2 border-t border-slate-100 space-y-1 text-slate-500 text-[11px]">
                    <div className="flex justify-between">
                      <span>Total COGS (Inventory Landed Cost):</span>
                      <span className="font-mono">{currency}{formPnL.totalCostOfGoods.toLocaleString()}</span>
                    </div>
                    {formType === 'buy_x_get_y' && (
                      <p className="text-[10px] text-purple-600 italic">
                        * Includes full landed cost of all free gift items
                      </p>
                    )}
                    <div className="flex justify-between">
                      <span>Allocated OpEx (Rent, Bills, Staff):</span>
                      <span className="font-mono">{currency}{formPnL.allocatedOpEx.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-slate-700 pt-1 border-t border-dashed border-slate-200">
                      <span>Minimum Safe Floor Price:</span>
                      <span className="font-mono">{currency}{formPnL.minSafeSellingPrice.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-200 space-y-1">
                    <div className="flex justify-between text-xs font-semibold">
                      <span>Gross Profit:</span>
                      <span className={formPnL.grossProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                        {currency}{formPnL.grossProfit.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-bold">
                      <span>Estimated Net Profit:</span>
                      <span className={formPnL.estimatedNetProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                        {currency}{formPnL.estimatedNetProfit.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Net Margin:</span>
                      <span className={`font-bold ${formPnL.profitMarginPercent >= 15 ? 'text-emerald-600' : formPnL.profitMarginPercent >= 0 ? 'text-amber-600' : 'text-rose-600'}`}>
                        {formPnL.profitMarginPercent}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Below-floor warning & Admin Loss Override */}
                {formPnL.isLossMaking && formType !== 'spend_and_save' ? (
                  <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl space-y-3">
                    <div className="flex items-start gap-2 text-rose-800 text-xs">
                      <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block font-bold">Selling Below Safe Floor Price!</strong>
                        <span>
                          The final combo price ({currency}{formPnL.finalComboPrice}) is lower than the safe break-even floor ({currency}{formPnL.minSafeSellingPrice}). This deal will incur a net loss.
                        </span>
                      </div>
                    </div>

                    {isAdmin ? (
                      <div className="space-y-2 pt-2 border-t border-rose-200 text-xs">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allowBelowFloor}
                            onChange={e => setAllowBelowFloor(e.target.checked)}
                            className="rounded text-rose-600 focus:ring-rose-500"
                          />
                          <span className="font-semibold text-rose-900">
                            Authorize selling below safe floor price (Admin Override)
                          </span>
                        </label>

                        {allowBelowFloor && (
                          <div>
                            <label className="block text-[11px] font-semibold text-rose-900 mb-1">
                              Recorded Reason for Loss-Leader Override *
                            </label>
                            <input
                              type="text"
                              required
                              placeholder="e.g. Seasonal inventory clearance or new customer acquisition"
                              value={overrideReason}
                              onChange={e => setOverrideReason(e.target.value)}
                              className="w-full px-2.5 py-1.5 border border-rose-300 rounded text-xs bg-white focus:outline-hidden focus:ring-2 focus:ring-rose-500"
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-2 bg-white rounded border border-rose-200 text-[11px] text-rose-700">
                        Only an Admin or Store Owner can override the safe floor price. Sellers cannot configure loss-leading offers.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-800 text-xs">
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Safe pricing confirmed. Net profit margin is {formPnL.profitMarginPercent}%.</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
                <button
                  type="submit"
                  disabled={isSavingOffer || (formPnL.isLossMaking && formType !== 'spend_and_save' && !allowBelowFloor)}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold rounded-lg text-sm shadow-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  <span>{isSavingOffer ? 'Saving...' : editingOfferId ? 'Update Combo Offer' : 'Save & Publish Offer'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setActiveTab('offers');
                  }}
                  className="px-4 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* VIEW 3: ANALYTICS & PERFORMANCE TAB */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4 mb-6">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Combo &amp; Bundle Sales Performance
                </h3>
                <p className="text-sm text-slate-500">
                  Track how promotions drive revenue, units moved, and gross profitability.
                </p>
              </div>

              <button
                onClick={() => {
                  const headers = ['Offer Name', 'Type', 'Status', 'Usage Count', 'Regular Price', 'Combo Price', 'Total Sales Approx'];
                  const rows = comboOffers.map(o => {
                    const pnl = comboOfferService.calculateComboPnL(
                      o.items || [],
                      o.discountType,
                      o.discountValue,
                      products
                    );
                    return [
                      `"${o.name}"`,
                      o.offerType,
                      o.status,
                      o.usageCount || 0,
                      pnl.regularTotalPrice,
                      pnl.finalComboPrice,
                      (o.usageCount || 0) * pnl.finalComboPrice,
                    ];
                  });
                  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
                  const encodedUri = encodeURI(csvContent);
                  const link = document.createElement('a');
                  link.setAttribute('href', encodedUri);
                  link.setAttribute('download', `combo_offers_report_${new Date().toISOString().split('T')[0]}.csv`);
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-300 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Export Report (CSV)</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                    <th className="py-3 px-4">Offer Name</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-center">Times Redeemed</th>
                    <th className="py-3 px-4 text-right">Regular Total</th>
                    <th className="py-3 px-4 text-right">Combo Price</th>
                    <th className="py-3 px-4 text-right">Est. Revenue Generated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {comboOffers.map(offer => {
                    const pnl = comboOfferService.calculateComboPnL(
                      offer.items || [],
                      offer.discountType,
                      offer.discountValue,
                      products
                    );
                    const typeBadge = getOfferTypeBadge(offer.offerType);
                    const statusBadge = getStatusBadge(offer.status);
                    const count = offer.usageCount || 0;
                    const approxRev = count * pnl.finalComboPrice;

                    return (
                      <tr key={offer.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4 font-semibold text-slate-800">
                          {offer.name}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${typeBadge.color}`}>
                            {typeBadge.label}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${statusBadge.color}`}>
                            {statusBadge.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-bold text-slate-700">
                          {count}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-500">
                          {currency}{pnl.regularTotalPrice.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-emerald-700">
                          {currency}{pnl.finalComboPrice.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900">
                          {currency}{approxRev.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ITEM PICKER MODAL */}
      {showItemPicker && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Select Product / Apparel Variant
              </h3>
              <button
                onClick={() => setShowItemPicker(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Choose Product *
              </label>
              <select
                value={selectedProductId}
                onChange={e => {
                  setSelectedProductId(e.target.value);
                  setSelectedVariantId('all');
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">-- Choose from inventory --</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.category || 'General'}) - {currency}{p.salePrice} (Stock: {p.currentStock})
                  </option>
                ))}
              </select>
            </div>

            {selectedProductId && (() => {
              const prod = products.find(p => p.id === selectedProductId);
              const hasVariants = prod && prod.variants && prod.variants.length > 0;

              return (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Variant (Color / Size / SKU)
                  </label>
                  <select
                    value={selectedVariantId}
                    onChange={e => setSelectedVariantId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="all">Any Variant / Base Product</option>
                    {hasVariants && prod.variants!.map(v => (
                      <option key={v.id} value={v.id}>
                        {[v.color, v.size].filter(Boolean).join(' - ')} | SKU: {v.sku} | Stock: {v.stock} | {currency}{v.salePrice !== undefined ? v.salePrice : prod.salePrice}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })()}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Required Quantity (Units)
                </label>
                <input
                  type="number"
                  min="1"
                  value={pickerQuantity}
                  onChange={e => setPickerQuantity(Math.max(1, Number(e.target.value)))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {formType === 'buy_x_get_y' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Is this the Free Item?
                  </label>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pickerIsFree}
                      onChange={e => setPickerIsFree(e.target.checked)}
                      className="rounded text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-xs font-semibold text-purple-800">
                      Yes, free gift item (Y)
                    </span>
                  </label>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowItemPicker(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedProductId}
                onClick={handleAddItemToForm}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold"
              >
                Add Item to Offer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
