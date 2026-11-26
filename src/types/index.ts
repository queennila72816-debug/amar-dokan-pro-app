export type SystemRoleKey =
  | 'super_admin'
  | 'store_manager'
  | 'salesman'
  | 'accountant'
  | 'inventory_manager'
  | 'cashier';

export type UserRole =
  | 'owner'
  | 'admin'
  | 'super_admin'
  | 'manager'
  | 'store_manager'
  | 'salesman'
  | 'seller'
  | 'storekeeper'
  | 'inventory_manager'
  | 'accountant'
  | 'cashier'
  | (string & {});

export type AccountStatus = 'active' | 'inactive' | 'suspended' | 'blocked';

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'print' | 'export';

export type PermissionModuleKey =
  | 'dashboard'
  | 'pos_new_sale'
  | 'sales_history'
  | 'purchase_management'
  | 'product_management'
  | 'stock_management'
  | 'customer_management'
  | 'supplier_management'
  | 'expense_management'
  | 'cash_management'
  | 'bank_management'
  | 'due_collection'
  | 'accounts_transactions'
  | 'profit_loss_reports'
  | 'sales_reports'
  | 'invoice_printing'
  | 'barcode_label_printing'
  | 'user_management'
  | 'application_settings';

export type PermissionActionsMap = Record<PermissionAction, boolean>;
export type RolePermissionMatrix = Record<PermissionModuleKey, PermissionActionsMap>;

export interface PermissionDefinition {
  key: PermissionModuleKey;
  name: string;
  category:
    | 'Core Operations'
    | 'Inventory & Supply'
    | 'Parties & CRM'
    | 'Finance & Accounting'
    | 'Reports & Printing'
    | 'Administration';
  description: string;
}

export interface RoleDefinition {
  id: string;
  businessId?: string;
  roleKey: string;
  name: string;
  description: string;
  isSystemRole: boolean;
  isDefault: boolean;
  permissions: RolePermissionMatrix;
  createdAt: string;
  updatedAt?: string;
}

export interface UserActivityLog {
  id: string;
  businessId?: string;
  userId?: string;
  employeeId?: string;
  employeeCode?: string;
  employeeName: string;
  roleKey: string;
  roleName: string;
  eventType:
    | 'LOGIN_SUCCESS'
    | 'LOGIN_BLOCKED'
    | 'LOGOUT'
    | 'EMPLOYEE_CREATED'
    | 'EMPLOYEE_UPDATED'
    | 'EMPLOYEE_STATUS_CHANGED'
    | 'PASSWORD_RESET'
    | 'ROLE_CREATED'
    | 'ROLE_PERMISSIONS_UPDATED'
    | 'ROLE_DELETED'
    | 'SALE_CREATED'
    | 'SALE_UPDATED'
    | 'FINANCIAL_DELETED'
    | 'SETTINGS_UPDATED'
    | 'PERMISSION_DENIED'
    | 'PRINT_ACTION'
    | 'EXPORT_ACTION'
    | 'SYSTEM_ACTION';
  moduleKey: PermissionModuleKey | string;
  action: PermissionAction | 'login' | 'logout' | 'system';
  entityType?: string;
  entityId?: string;
  details: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export type BusinessType = 'clothing' | 'grocery' | 'electronics' | 'pharmacy' | 'restaurant' | 'general';
export type PaymentMethod = 'cash' | 'bkash' | 'nagad' | 'rocket' | 'bank' | 'card' | 'due' | 'mixed';
export type ExpenseAllocationMethod = 'units_sold' | 'revenue_percent' | 'category' | 'manual';
export type InventoryCostingMethod = 'fifo' | 'weighted_average';
export type QualityTier = 'economy' | 'standard' | 'premium' | 'luxury';

export interface Seller {
  id: string;
  username: string;
  fullName: string;
  phone: string;
  email?: string;
  role: 'seller' | 'salesman';
  branchId?: string;
  branchName?: string;
  status: 'active' | 'inactive';
  totalSalesCount?: number;
  totalSalesAmount?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface ProductColor {
  id: string;
  businessId?: string;
  productId: string;
  colorName: string;
  normalizedName: string;
  colorHex: string;
  sortOrder: number;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductColorImage {
  id: string;
  businessId?: string;
  productId: string;
  colorId: string;
  imageUrl: string;
  storagePath: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  isPrimary: boolean;
  sortOrder: number;
  uploadedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductVariant {
  id: string;
  colorId?: string;
  color?: string;
  colorHex?: string;
  size?: string;
  sku: string;
  barcode?: string;
  stock: number;
  additionalPrice?: number;
  purchasePrice?: number;
  salePrice?: number;
  minStockAlert?: number;
  status?: 'active' | 'inactive';
  images?: string[];
}

export interface DirectPurchaseCostBreakdown {
  transport: number;
  loading: number;
  packaging: number;
  other: number;
}

export interface ProductCostingSheet {
  batchQuantity: number;
  unitPurchasePrice: number;
  totalPurchaseAmount: number;
  directCosts: DirectPurchaseCostBreakdown;
  totalDirectCosts: number;
  landedCost: number;
  landedCostPerUnit: number;
  allocatedOpExPerUnit: number;
  totalUnitCost: number; // Break-even cost
  profitMethod: 'margin_percentage' | 'markup_percentage' | 'fixed_amount';
  profitValue: number;
  desiredProfitPerUnit: number;
  preTaxSellingPrice: number;
  vatRate: number;
  vatAmount: number;
  paymentFeeRate: number; // e.g. bKash 1.5%
  paymentFeeAmount: number;
  recommendedSellingPrice: number;
  minSafeSellingPrice: number; // Absolute floor for seller discount protection
  maxDiscountPercent: number;
  localMarketPrice?: number;
  competitorPrice?: number;
  qualityTier: QualityTier;
}

export interface Product {
  id: string;
  name: string;
  code: string; // SKU or barcode
  barcode: string;
  category: string;
  subcategory?: string;
  brand?: string;
  description?: string;
  image?: string;
  
  // Costing & Pricing
  purchasePrice: number; // Base purchase cost per piece
  salePrice: number; // Configured selling price
  wholesalePrice?: number;
  minSalePrice?: number; // Minimum break-even floor for discount protection
  maxDiscountPercent?: number; // Max discount allowed without admin auth
  
  // Smart Costing additions
  directCosts?: DirectPurchaseCostBreakdown;
  landedCostPerUnit?: number;
  allocatedOpExPerUnit?: number;
  totalUnitCost?: number; // Real unit cost = Landed Cost + Allocated Operating Expenses
  recommendedSellingPrice?: number;
  qualityTier?: QualityTier;
  marketPrice?: number;
  competitorPrice?: number;

  currentStock: number;
  minStockAlert: number;
  unit: string; // pcs, kg, box, meter, ltr
  businessType?: BusinessType;

  // Clothing & Fashion Attributes
  images?: string[];
  productColors?: ProductColor[];
  productImages?: ProductColorImage[];
  primaryImageUrl?: string;
  clothingCategory?: string; // Shirts, Pants, T-Shirts, Three-Piece, Burqa, etc.
  color?: string;
  size?: string;
  hasVariants?: boolean;
  variants?: ProductVariant[];
  supplierId?: string;
  supplierName?: string;
  leadTimeDays?: number; // Days needed for reorder delivery

  // Electronics & Perishables
  model?: string;
  serialNumber?: string;
  warrantyPeriod?: string;
  expiryDate?: string;
  batchNumber?: string;

  createdAt: string;
  updatedAt: string;
  isActive?: boolean;
  branchId?: string;
}

export interface Category {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  overheadWeight?: number; // Proportional weight for category expense allocation (default 1.0)
}

export interface SaleItem {
  productId: string;
  productName: string;
  sku: string;
  unitPrice: number;
  purchasePrice: number; // Landed unit cost for accurate COGS
  unitCost?: number; // Real unit cost with opex for net profit reporting
  quantity: number;
  discount: number; // in BDT
  total: number;
  variantId?: string;
  variantDetails?: string;
  colorId?: string;
  colorName?: string;
  imageUrl?: string;
  category?: string;
  approvedDiscountBy?: string; // If seller discounted with admin approval
  comboOfferId?: string;
  comboOfferName?: string;
  comboInstanceId?: string;
  comboQuantity?: number;
  regularUnitPrice?: number;
  isFreeItem?: boolean;
}

export interface ComboPackageSaleRecord {
  instanceId: string;
  offerId: string;
  offerName: string;
  comboCategory?: string;
  quantity: number;
  regularUnitPrice: number;
  offerUnitPrice: number;
  lineTotal: number;
  discountTotal: number;
  discountAmount?: number;
  components: {
    productId: string;
    productName: string;
    variantId?: string;
    variantDetails?: string;
    sku: string;
    qtyPerCombo: number;
    totalQty: number;
    regularUnitPrice: number;
    allocatedUnitPrice: number;
    allocatedTotal: number;
    isFree?: boolean;
  }[];
}

export interface SalePayment {
  method: PaymentMethod;
  amount: number;
  accountId?: string;
  accountName?: string;
  trxId?: string;
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  date: string;
  customerId?: string;
  customerName: string;
  customerMobile?: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  vatTaxRate: number;
  vatTaxAmount: number;
  total: number;
  paid: number;
  due: number;
  paymentMethod: PaymentMethod;
  payments: SalePayment[];
  servedBy: string;
  employeeId?: string;
  employeeCode?: string;
  employeeName?: string;
  sellerId?: string;
  sellerName?: string;
  branchId: string;
  status: 'paid' | 'due' | 'partial' | 'returned' | 'voided';
  notes?: string;
  refundedAmount?: number;
  refundReason?: string;
  refundedAt?: string;
  discountAuthorizedBy?: string;
  appliedOffers?: {
    offerId: string;
    offerName: string;
    discountAmount: number;
    offerType: string;
    comboQuantity?: number;
    comboInstanceId?: string;
  }[];
  comboPackages?: ComboPackageSaleRecord[];
  comboDiscount?: number;
  clientTxId?: string;
}

export interface SaleReturn {
  id: string;
  saleId: string;
  invoiceNumber: string;
  date: string;
  customerId?: string;
  customerName: string;
  items: {
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    totalRefund: number;
    reason: string;
  }[];
  totalRefundAmount: number;
  refundType: 'cash' | 'adjust_due';
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  variantId?: string;
  variantDetails?: string;
  colorId?: string;
  colorName?: string;
  imageUrl?: string;
  quantity: number;
  purchasePrice: number;
  total: number;
  transportShare?: number;
  loadingShare?: number;
  packagingShare?: number;
  otherCostShare?: number;
  landedCostPerUnit?: number;
}

export interface Purchase {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  date: string;
  items: PurchaseItem[];
  subtotal: number;
  discount: number;
  transportCost: number;
  loadingCost?: number;
  packagingCost?: number;
  otherCost: number;
  total: number;
  paid: number;
  due: number;
  paymentMethod: PaymentMethod;
  branchId: string;
  notes?: string;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  address?: string;
  email?: string;
  customerType: 'retail' | 'wholesale';
  openingDue: number;
  currentDue: number;
  creditLimit: number;
  totalPurchase: number;
  totalPaid: number;
  createdAt: string;
  notes?: string;
}

export interface CustomerTransaction {
  id: string;
  customerId: string;
  customerName: string;
  date: string;
  type: 'sale_due' | 'due_collection' | 'return_adjustment' | 'opening';
  amount: number;
  balanceAfter: number;
  paymentMethod?: PaymentMethod;
  referenceId?: string;
  note?: string;
}

export interface Supplier {
  id: string;
  name: string;
  company: string;
  mobile: string;
  address?: string;
  email?: string;
  openingDue: number;
  currentDue: number;
  totalPurchase: number;
  totalPaid: number;
  createdAt: string;
}

export interface SupplierTransaction {
  id: string;
  supplierId: string;
  supplierName: string;
  date: string;
  type: 'purchase_due' | 'due_payment' | 'return_adjustment' | 'opening';
  amount: number;
  balanceAfter: number;
  paymentMethod?: PaymentMethod;
  referenceId?: string;
  note?: string;
}

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  date: string;
  type: 'purchase_in' | 'sale_out' | 'purchase_return' | 'sale_return' | 'adjustment' | 'transfer';
  quantity: number;
  previousStock: number;
  newStock: number;
  reference?: string;
  branchId: string;
  note?: string;
}

export interface StockAdjustment {
  id: string;
  productId: string;
  productName: string;
  date: string;
  adjustedQty: number;
  reason: 'damaged' | 'expired' | 'lost' | 'inventory_correction' | 'sample';
  note?: string;
  adjustedBy: string;
}

export interface StockTransfer {
  id: string;
  date: string;
  productId: string;
  productName: string;
  quantity: number;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  transferredBy: string;
  note?: string;
}

export interface Account {
  id: string;
  name: string;
  accountType: 'cash' | 'bank' | 'mobile_bank';
  accountNumber?: string;
  balance: number;
}

export type ExpensePaymentStatus = 'paid' | 'unpaid';

export interface Expense {
  id: string;
  date: string;
  expenseMonth?: string; // YYYY-MM billing/salary month
  paymentDate?: string; // YYYY-MM-DD actual payment date
  category: string;
  amount: number;
  paymentMethod: PaymentMethod;
  accountId: string;
  employeeId?: string;
  staffName?: string;
  paymentStatus?: ExpensePaymentStatus; // Defaults to 'paid' for legacy records
  paidTo?: string;
  note?: string;
}

export interface MonthlyOperatingBudget {
  shopRent: number;
  electricity: number;
  staffSalaries: number;
  internetAndMobile: number;
  transportGeneral: number; // General shop transport (distinct from batch purchase transport)
  packagingGeneral: number;
  maintenance: number;
  otherExpenses: number;
  expectedMonthlyUnitsSold: number;
  expectedMonthlyRevenue: number;
  allocationMethod: ExpenseAllocationMethod;
}

export interface Employee {
  id: string;
  employeeCode?: string;
  userId?: string;
  name: string;
  username?: string;
  email?: string;
  mobile: string;
  position: string;
  role: UserRole;
  roleId?: string;
  roleKey?: string;
  roleName?: string;
  salary: number;
  joiningDate: string;
  branchId: string;
  branchName?: string;
  status: 'active' | 'inactive';
  accountStatus?: AccountStatus;
  lastLoginAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Branch {
  id: string;
  name: string;
  location: string;
  mobile: string;
  isMain: boolean;
}

export type InvoicePaperSize = 'thermal' | 'a4' | 'a5';

export interface PrinterSettings {
  invoicePaperSize: InvoicePaperSize;
  invoiceOrientation: 'portrait' | 'landscape';
  invoiceMarginMm: number;
  invoiceFontSize: 'small' | 'medium' | 'large';
  labelTemplate: LabelTemplateId;
  labelWidthMm: number;
  labelHeightMm: number;
  labelOrientation: 'portrait' | 'landscape';
  labelMarginMm: number;
  labelsPerRow: number;
  labelGapXMm: number;
  labelGapYMm: number;
  barcodeHeightPx: number;
  labelFontSize: 'small' | 'medium' | 'large';
  showScaleGuidance: boolean;
}

export interface ShopSettings {
  shopName: string;
  ownerName?: string;
  tagline: string;
  address: string;
  mobile: string;
  email: string;
  logoUrl?: string;
  vatRegistrationNo?: string;
  currency: string;
  financialYear?: string;
  vatTaxRate: number;
  invoiceFormat: InvoicePaperSize;
  businessType: BusinessType;
  language: 'bn' | 'en';
  uiMode: 'easy' | 'advanced';
  isConfigured?: boolean;
  printerSettings?: PrinterSettings;
  
  // Optional Business Web & Marketplace Links
  websiteUrl?: string;
  marketplaceUrl?: string;
  socialMedia?: string;

  // Pricing & Costing Rules
  inventoryCostingMethod?: InventoryCostingMethod; // FIFO or Weighted Average
  expenseAllocationMethod?: ExpenseAllocationMethod;
  defaultExpectedMonthlyUnits?: number;
  defaultTargetMarginPercent?: number;
  strictDiscountProtection?: boolean;
  adminAuthorizationPin?: string;
}

export interface BusinessSetupData {
  shopName: string;
  ownerName: string;
  businessType: BusinessType;
  phone: string;
  email?: string;
  address: string;
  branchName: string;
  currency: string;
  financialYear: string;
  vatTaxRate: number;
  vatRegistrationNo?: string;
  createNew?: boolean;
  planCode?: string;
  billingCycle?: 'trial' | 'monthly' | 'yearly';
  initialAccounts?: {
    name: string;
    accountType: 'cash' | 'bank' | 'mobile_bank';
    accountNumber?: string;
    openingBalance: number;
  }[];
}

export interface AuditLog {
  id: string;
  date: string;
  userRole: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  branchId?: string;
}

export interface AccountTransaction {
  id: string;
  accountId: string;
  accountName: string;
  date: string;
  type: 'sale_payment' | 'purchase_payment' | 'customer_payment' | 'supplier_payment' | 'expense' | 'salary' | 'transfer_in' | 'transfer_out' | 'refund' | 'adjustment';
  amount: number;
  balanceAfter: number;
  referenceId?: string;
  note?: string;
}

// ========================
// APPAREL MODULES ADDITIONS
// ========================

export type LabelTemplateId = '30x20' | '40x30' | '50x30' | '50x25' | 'a4_sheet' | 'custom';

export type LabelCodeFormat = 'CODE128' | 'EAN13' | 'QR';

export interface LabelConfig {
  template: LabelTemplateId;
  customWidthMm?: number;
  customHeightMm?: number;
  showShopName: boolean;
  showShopLogo?: boolean;
  showProductName: boolean;
  showVariantDetails: boolean;
  showPrice: boolean;
  showSku: boolean;
  showBarcodeNumber: boolean;
  barcodeFormat: LabelCodeFormat;
  showQrCode?: boolean;
  qrContentMode?: 'product_ref' | 'barcode';
  copiesPerItem: number;
  customFooterText?: string;
}

export interface RecentScanEntry {
  id: string;
  code: string;
  scannedAt: string;
  source: 'camera' | 'hid' | 'manual';
  mode: 'lookup' | 'pos' | 'stock_check' | 'label';
  found: boolean;
  productId?: string;
  variantId?: string;
  productName?: string;
  sku?: string;
  variantLabel?: string;
  stockAtScan?: number;
  salePrice?: number;
}

export type ItemCondition = 'sellable' | 'damaged';

export interface ReturnExchangeItem {
  productId: string;
  productName: string;
  variantId?: string;
  variantDetails?: string;
  sku: string;
  originalUnitPrice: number;
  effectiveUnitPrice?: number;
  quantity: number;
  totalRefund: number;
  reason: 'wrong_size' | 'defective_damaged' | 'color_mismatch' | 'customer_dislike' | 'other';
  condition: ItemCondition;
  comboOfferId?: string;
  comboOfferName?: string;
  comboInstanceId?: string;
  note?: string;
}

export interface ReplacementItem {
  productId: string;
  productName: string;
  variantId?: string;
  variantDetails?: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  total: number;
}

export interface ExchangeTransaction {
  id: string;
  returnTxId?: string;
  exchangeNumber: string;
  invoiceNumber: string;
  saleId: string;
  date: string;
  customerId?: string;
  customerName: string;
  customerMobile?: string;
  actionType: 'return_only' | 'exchange';
  returnedItems: ReturnExchangeItem[];
  replacementItems: ReplacementItem[];
  totalReturnValue: number;
  totalReplacementValue: number;
  differenceAmount: number; // positive = customer pays extra, negative = store refunds
  settlementMethod?: PaymentMethod;
  accountId?: string;
  servedBy: string;
  branchId: string;
  notes?: string;
}

export interface ReorderSuggestion {
  productId: string;
  productName: string;
  category: string;
  variantId?: string;
  variantDetails?: string;
  sku: string;
  barcode: string;
  currentStock: number;
  minStockAlert: number;
  dailySalesRate: number; // Avg units sold / day
  leadTimeDays: number;
  safetyStock: number;
  reorderPoint: number;
  suggestedOrderQty: number;
  unitPurchasePrice: number;
  estimatedCost: number;
  supplierId?: string;
  supplierName?: string;
  status: 'out_of_stock' | 'critical' | 'low' | 'healthy' | 'overstocked';
}

export interface DraftPurchaseOrder {
  id: string;
  poNumber: string;
  date: string;
  supplierId: string;
  supplierName: string;
  items: {
    productId: string;
    productName: string;
    variantId?: string;
    variantDetails?: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[];
  totalAmount: number;
  branchId: string;
  status: 'draft' | 'approved' | 'received';
  notes?: string;
  createdAt: string;
}

// ========================
// COMBO & BUNDLE OFFERS
// ========================

export type OfferType =
  | 'fixed_price'       // 1 Shirt + 1 Pant = ৳1,050
  | 'buy_x_discount'    // Buy 2 T-Shirts, get 10% off
  | 'buy_x_get_y'       // Buy 2 eligible items, get 1 free
  | 'category_bundle'   // Buy 1 Three-Piece + 1 Burqa, get special discount
  | 'spend_and_save'    // Spend ৳2,000, get ৳100 off
  | 'quantity_discount'; // Buy 3 or more shirts, get specified discount

export type OfferStatus = 'draft' | 'active' | 'paused' | 'expired' | 'archived';
export type OfferDiscountType = 'fixed_bundle_price' | 'percentage' | 'fixed_discount' | 'free_item';

export interface ComboOfferItem {
  id: string;
  productId: string;
  productName: string;
  variantId?: string;
  variantDetails?: string;
  sku?: string;
  quantity: number;
  isFree?: boolean; // For Buy X Get Y (the Y item)
  categoryId?: string; // For category bundles
  purchasePrice?: number;
  salePrice?: number;
}

export type PosterTemplateId =
  | 'style_zone_reference'
  | 'premium_black_gold'
  | 'modern_blue_yellow'
  | 'eid_special'
  | 'festival_sale'
  | 'luxury_fashion'
  | 'winter_collection'
  | 'kids_collection'
  | 'women_fashion'
  | 'men_fashion'
  | 'couple_combo'
  | 'family_combo'
  | 'accessories_combo'
  | 'cosmetics_combo'
  | 'mixed_product_combo'
  | 'minimal_professional';

export type PosterMode =
  | 'ai_creative'
  | 'custom_studio'
  | 'auto'
  | 'template'
  | 'custom';

export type PosterDimensionPreset =
  | 'facebook_square'
  | 'facebook_portrait'
  | 'facebook_story'
  | 'facebook_post'
  | 'instagram_post'
  | 'instagram_story'
  | 'square_social'
  | 'a4_portrait'
  | 'a4_landscape'
  | 'a5_portrait'
  | 'a5_landscape'
  | 'a3_portrait'
  | 'a3_landscape'
  | 'custom';

export type PosterModelCategory =
  | 'auto'
  | 'male'
  | 'female'
  | 'couple'
  | 'family'
  | 'boys'
  | 'girls'
  | 'none';

export type MasterImageType = 'poster' | 'product_composition' | 'custom';

export type PosterFontFamily =
  | 'Plus Jakarta Sans'
  | 'Oswald'
  | 'Playfair Display'
  | 'Hind Siliguri'
  | 'Noto Sans Bengali'
  | 'JetBrains Mono';

export interface PosterCanvasLayerBase {
  id: string;
  name: string;
  type: 'text' | 'image' | 'shape' | 'badge' | 'sticker' | 'qr';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  groupId?: string;
  zIndex: number;
  borderWidth?: number;
  borderColor?: string;
  borderRadius?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

export interface PosterTextLayer extends PosterCanvasLayerBase {
  type: 'text';
  text: string;
  fontFamily: PosterFontFamily | string;
  fontSize: number;
  fontWeight: '400' | '600' | '700' | '800' | '900';
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right';
  color: string;
  backgroundColor?: string;
  backgroundPadding?: number;
  strokeColor?: string;
  strokeWidth?: number;
  strikethrough?: boolean;
  uppercase?: boolean;
  letterSpacing?: number;
  lineHeight?: number;
}

export interface PosterImageLayer extends PosterCanvasLayerBase {
  type: 'image';
  src: string;
  fit: 'contain' | 'cover';
  /** Normalized 0..1 crop window */
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
  brightness?: number; // 50..150, default 100
  contrast?: number; // 50..150, default 100
  removeLightBg?: boolean;
  bgRemovalTolerance?: number; // 10..80, default 36
  backgroundColor?: string;
  tagRole?: 'model' | 'product' | 'logo' | 'background' | 'uploaded';
  linkedProductId?: string;
}

export interface PosterShapeLayer extends PosterCanvasLayerBase {
  type: 'shape';
  shapeKind: 'rectangle' | 'rounded_rect' | 'circle' | 'line' | 'divider';
  fillColor: string;
  gradientEndColor?: string;
}

export interface PosterBadgeLayer extends PosterCanvasLayerBase {
  type: 'badge';
  badgeStyle: 'pill' | 'starburst' | 'ribbon' | 'price_tag' | 'savings_box';
  primaryText: string;
  secondaryText?: string;
  fillColor: string;
  textColor: string;
  fontFamily?: string;
}

export interface PosterStickerLayer extends PosterCanvasLayerBase {
  type: 'sticker';
  stickerKind: 'plus_sign' | 'arrow_right' | 'arrow_down' | 'quality_seal' | 'star_icon' | 'flash_tag';
  fillColor: string;
  accentColor?: string;
  textColor?: string;
  label?: string;
}

export interface PosterQrLayer extends PosterCanvasLayerBase {
  type: 'qr';
  qrValue: string;
  foregroundColor?: string;
  backgroundColor?: string;
  caption?: string;
}

export type PosterCanvasLayer =
  | PosterTextLayer
  | PosterImageLayer
  | PosterShapeLayer
  | PosterBadgeLayer
  | PosterStickerLayer
  | PosterQrLayer;

export interface PosterCustomProject {
  version: 2;
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
  backgroundGradientEnabled?: boolean;
  backgroundGradientEnd?: string;
  backgroundImageUrl?: string;
  layers: PosterCanvasLayer[];
  updatedAt?: string;
}

export interface PosterUserTemplate {
  id: string;
  name: string;
  category: string;
  thumbnailDataUrl?: string;
  project: PosterCustomProject;
  createdAt: string;
}

export interface ComboPosterConfig {
  mode: PosterMode;
  templateId: PosterTemplateId;
  dimensionPreset: PosterDimensionPreset;
  customWidthPx?: number;
  customHeightPx?: number;
  backgroundColor: string;
  secondaryColor: string;
  accentColor: string;
  textColor: string;
  headline: string;
  promoText: string;
  footerText: string;
  fashionSlogan?: string;
  ctaText?: string;
  trustLine?: string;
  modelCategory?: PosterModelCategory;
  customModelImageUrl?: string;
  removeModelBg?: boolean;
  aiGeneratedModelUrl?: string;
  productImageSize: 'compact' | 'standard' | 'large';
  productImagePosition: 'grid' | 'spotlight' | 'showcase';
  productFontSize: 'sm' | 'md' | 'lg';
  showPrices: boolean;
  showDiscountBadge: boolean;
  showShopDetails: boolean;
  showBranchInfo: boolean;
  shopPhoneOverride?: string;
  shopAddressOverride?: string;
  logoPosition: 'top_left' | 'top_center' | 'top_right';
  qrPosition: 'bottom_right' | 'bottom_left' | 'hidden';
  includeQrCode: boolean;
  customQrUrl?: string;
  /** Keyed by `${productId}__${variantId || 'base'}`; never mutates original product images */
  posterProductImages?: Record<string, string>;
  /** Editable full layer project for Custom Design Studio (Mode 2) */
  customDesign?: PosterCustomProject;
  updatedAt?: string;
}

export type MarketplaceComboOrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export interface MarketplaceComboOrder {
  id: string;
  orderNumber: string;
  businessId: string;
  branchId: string;
  comboOfferId: string;
  comboOfferName: string;
  comboQuantity: number;
  unitComboPrice: number;
  regularUnitTotal: number;
  discountAmount: number;
  totalAmount: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  paymentMethod: 'cash_on_delivery' | 'bkash' | 'nagad' | 'card' | 'bank';
  paymentStatus: 'unpaid' | 'paid';
  status: MarketplaceComboOrderStatus;
  stockDeducted: boolean;
  linkedSaleId?: string;
  linkedInvoiceNumber?: string;
  notes?: string;
  orderSource: 'online_storefront' | 'qr_link' | 'admin_test';
  createdAt: string;
  updatedAt: string;
}

export interface ComboOffer {
  id: string;
  name: string;
  description?: string;
  comboCategory?: string;
  image?: string;
  posterImageUrl?: string;
  masterImageType?: MasterImageType;
  posterConfig?: ComboPosterConfig;
  isPublishedOnline?: boolean;
  marketplaceSlug?: string;
  offerType: OfferType;
  items: ComboOfferItem[];

  // Spend & Save or Category constraints
  minSpendAmount?: number; // e.g. Spend ৳2,000
  targetCategoryIds?: string[]; // For category bundle
  minPurchaseQuantity?: number; // For quantity discount (e.g. 3)

  // Pricing & Discount
  regularTotalPrice: number;
  discountType: OfferDiscountType;
  discountValue: number; // e.g. 10 (%) or 250 (৳) or final price 1050
  finalComboPrice: number;

  // Costing & PnL
  totalCostOfGoods: number; // Includes the landed cost of all items + free items!
  allocatedOpEx: number;
  grossProfit: number;
  estimatedNetProfit: number;
  profitMarginPercent: number;
  isLossMaking: boolean;
  minSafeSellingPrice: number;
  lossOverrideReason?: string;
  lossApprovedBy?: string;

  // Schedules & Limits
  startDate: string;
  endDate?: string;
  status: OfferStatus;
  maxUsageLimit?: number; // Total redemptions allowed
  usageCount: number;
  perCustomerLimit?: number;
  branchId?: string; // Specific branch or 'all'
  priorityRank: number; // Higher number = higher priority for overlapping offers

  businessId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComboUsageComponentLog {
  productId: string;
  productName: string;
  variantId?: string;
  variantDetails?: string;
  sku?: string;
  qtyPerCombo: number;
  totalQtyDeducted: number;
  allocatedUnitPrice: number;
  allocatedTotal: number;
}

export interface ComboOfferUsage {
  id: string;
  offerId: string;
  offerName: string;
  saleId: string;
  invoiceNumber: string;
  comboQuantity?: number;
  comboInstanceId?: string;
  sellerId?: string;
  clientTxId?: string;
  components?: ComboUsageComponentLog[];
  customerId?: string;
  customerName?: string;
  discountGiven: number;
  revenue: number;
  costOfGoods: number;
  grossProfit: number;
  date: string;
  branchId: string;
}

// ================================================
// MULTI-TENANT SAAS & PLATFORM SUPER ADMIN TYPES
// ================================================

export type PlatformRole = 'SUPER_ADMIN' | 'SUPPORT_ADMIN' | 'BILLING_ADMIN' | 'PLATFORM_VIEWER';

export type BusinessRoleLevel = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' | 'SALESMAN' | 'CUSTOM_ROLE';

export interface PlatformAdmin {
  id: string;
  userId: string;
  email: string;
  fullName?: string;
  role: PlatformRole;
  isActive: boolean;
  assignedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SubscriptionPlanFeatures {
  pos?: boolean;
  inventory?: boolean;
  multiBranch?: boolean;
  reports?: boolean;
  apparelCatalog?: boolean;
  barcodePrinting?: boolean;
  comboOffers?: boolean;
  apiAccess?: boolean;
  prioritySupport?: boolean;
  [key: string]: boolean | undefined;
}

export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  trialDays: number;
  gracePeriodDays: number;
  maxUsers: number; // 0 = unlimited
  maxBranches: number; // 0 = unlimited
  maxProducts: number; // 0 = unlimited
  features: SubscriptionPlanFeatures;
  isActive: boolean;
  sortOrder: number;
}

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'grace_period'
  | 'suspended'
  | 'expired'
  | 'cancelled';

export interface BusinessSubscription {
  id: string;
  businessId: string;
  planId?: string;
  planCode: string;
  billingCycle: 'trial' | 'monthly' | 'yearly' | 'lifetime';
  status: SubscriptionStatus;
  trialEndsAt?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  gracePeriodEndsAt?: string;
  maxUsers: number;
  maxBranches: number;
  maxProducts: number;
  notes?: string;
  plan?: SubscriptionPlan | null;
  business?: {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    status?: string;
    isActive?: boolean;
  } | null;
}

export interface PlatformPayment {
  id: string;
  businessId: string;
  businessName?: string;
  subscriptionId?: string;
  planId?: string;
  planName?: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  billingCycle: 'monthly' | 'yearly' | 'lifetime' | 'custom';
  paymentMethod: string;
  gatewayProvider: string;
  transactionId?: string;
  senderNumber?: string;
  status: 'pending' | 'verified' | 'rejected' | 'refunded';
  adminNote?: string;
  submittedBy?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  businessId: string;
  businessName?: string;
  createdBy?: string;
  createdByEmail?: string;
  subject: string;
  message: string;
  category: 'billing' | 'technical' | 'account' | 'feature_request' | 'general';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  adminResponse?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PlatformAuditLog {
  id: string;
  actorUserId?: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  targetBusinessId?: string;
  details: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface PlatformGeneralSettings {
  platformName: string;
  supportEmail: string;
  supportPhone: string;
  defaultCurrency: string;
  allowPublicSignup: boolean;
  requireMobileOtp: boolean;
}

export interface PlatformBillingSettings {
  bkashNumber: string;
  nagadNumber: string;
  rocketNumber: string;
  bankDetails: string;
  note: string;
}

export interface BusinessMembershipSummary {
  businessId: string;
  businessName: string;
  businessType: BusinessType;
  businessStatus: string;
  isActive: boolean;
  branchId?: string;
  role: string;
  roleLevel: BusinessRoleLevel;
  membershipStatus: string;
  planCode?: string;
  planName?: string;
  subscriptionStatus?: SubscriptionStatus;
  currentPeriodEnd?: string;
}

// ==================== SMART INTERACTION & PRODUCTIVITY TYPES ====================

export type ThemePreference = 'light' | 'dark' | 'system';

export type SoundEventType =
  | 'scan_success'
  | 'product_not_found'
  | 'product_added'
  | 'sale_completed'
  | 'payment_received'
  | 'low_stock_warning'
  | 'new_order'
  | 'invoice_print';

export interface SoundPreferences {
  enabled: boolean;
  muted: boolean;
  silentMode: boolean;
  volume: number; // 0.0 to 1.0
  events: Record<SoundEventType, boolean>;
}

export type ShortcutActionId =
  | 'open_command_palette'
  | 'open_shortcuts_help'
  | 'save_active'
  | 'print_active'
  | 'go_dashboard'
  | 'go_pos'
  | 'open_scanner'
  | 'new_product'
  | 'new_customer'
  | 'new_purchase'
  | 'new_expense'
  | 'toggle_focus_mode'
  | 'toggle_fullscreen'
  | 'toggle_theme'
  | 'open_system_status'
  | 'pos_focus_barcode'
  | 'pos_focus_search'
  | 'pos_clear_cart'
  | 'pos_complete_sale';

export type ShortcutCategory = 'Global' | 'Navigation' | 'Quick Create' | 'Display' | 'POS';

export type DashboardWidgetId =
  | 'quick_actions'
  | 'kpis'
  | 'alerts'
  | 'charts'
  | 'recent_sales_purchases'
  | 'bottom_insights'
  | 'recent_activities';

export interface DashboardCustomization {
  hiddenWidgets: DashboardWidgetId[];
  widgetOrder: DashboardWidgetId[];
  compactDensity: boolean;
}

export interface UserProductivityPreferences {
  themeMode: ThemePreference;
  sound: SoundPreferences;
  vibrationEnabled: boolean;
  shortcutsEnabled: boolean;
  customShortcuts: Partial<Record<ShortcutActionId, string>>;
  focusMode: boolean;
  dashboard: DashboardCustomization;
  dismissedNotificationIds: string[];
  updatedAt?: string;
}

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastMessage {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
  durationMs?: number;
}

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger' | 'warning';
}

export type SmartNotificationCategory =
  | 'low_stock'
  | 'new_order'
  | 'pending_payment'
  | 'daily_summary'
  | 'system_alert';

export interface SmartNotificationItem {
  id: string;
  category: SmartNotificationCategory;
  title: string;
  detail: string;
  tone: 'coral' | 'amber' | 'teal' | 'emerald' | 'indigo';
  targetTab?: string;
  timestamp?: string;
  actionLabel?: string;
}
