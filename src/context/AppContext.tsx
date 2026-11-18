import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  Product,
  Category,
  Customer,
  Supplier,
  Sale,
  Purchase,
  StockMovement,
  StockAdjustment,
  StockTransfer,
  Account,
  AccountTransaction,
  Expense,
  Employee,
  Branch,
  ShopSettings,
  UserRole,
  PaymentMethod,
  CustomerTransaction,
  SupplierTransaction,
  AuditLog,
  Seller,
  BusinessSetupData,
  ComboOffer,
  OfferStatus,
  AccountStatus,
  PermissionAction,
  PermissionModuleKey,
  RoleDefinition,
  RolePermissionMatrix,
  UserActivityLog,
} from '../types';
import {
  initialSettings,
  initialProducts,
  initialCategories,
} from '../data/initialData';
import { generateInvoiceNumber } from '../utils/formatters';
import { auditService } from '../services/auditService';
import { productService } from '../services/productService';
import { salesService } from '../services/salesService';
import { sellerService } from '../services/sellerService';
import { staffRbacService, CreateEmployeePayload, UpdateEmployeePayload } from '../services/staffRbacService';
import {
  createDefaultRolesForBusiness,
  hasMatrixPermission,
  LegacyAppModule,
  mapLegacyModuleToPermissionKeys,
  normalizeRoleKey,
  roleKeyToLegacyUserRole,
} from '../utils/rbacDefaults';
import {
  customerService,
  supplierService,
  financeService,
  purchaseService,
  inventoryService,
  branchService,
} from '../services/businessServices';
import { comboOfferService } from '../services/comboOfferService';
import { getPrinterSettings, getShopLogo, savePrinterSettings, saveShopLogo } from '../utils/printEngine';
import { supabase, isSupabaseConfigured, formatSupabaseError, sanitizeUuid, isValidUuid } from '../lib/supabase';
import { User, Session } from '@supabase/supabase-js';

interface AppContextType {
  // Auth & Session
  user: User | null;
  session: Session | null;
  activeBusinessId: string;
  signOut: () => Promise<void>;
  isLoading: boolean;
  isMigrated: boolean;
  migrateLegacyData: () => Promise<boolean>;
  dbError: string | null;
  clearDbError: () => void;

  // Business Setup State
  isBusinessConfigured: boolean;
  completeBusinessSetup: (data: BusinessSetupData) => Promise<void>;

  settings: ShopSettings;
  updateSettings: (newSettings: Partial<ShopSettings>) => Promise<void>;
  currentUserRole: UserRole;
  setCurrentUserRole: (role: UserRole) => void;
  activeBranchId: string;
  setActiveBranchId: (branchId: string) => void;
  branches: Branch[];
  addBranch: (branch: Omit<Branch, 'id'>) => Promise<Branch>;
  updateBranch: (id: string, updates: Partial<Branch>) => Promise<void>;
  deleteBranch: (id: string) => Promise<{ success: boolean; message?: string }>;

  // Categories
  categories: Category[];
  addCategory: (category: { name: string; description?: string }) => Promise<Category>;
  deleteCategory: (id: string) => Promise<void>;

  // Products
  products: Product[];
  addProduct: (product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Product>;
  updateProduct: (id: string, product: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string, permanent?: boolean) => Promise<void>;
  reloadProducts: () => Promise<void>;

  // Sales & POS
  sales: Sale[];
  recordSale: (saleData: Omit<Sale, 'id' | 'invoiceNumber' | 'date' | 'status'>) => Promise<Sale>;
  recordSaleReturn: (
    saleId: string,
    items: { productId: string; variantId?: string; quantity: number; unitPrice: number; reason: string }[],
    refundType: 'cash' | 'adjust_due'
  ) => Promise<void>;
  quickRefundSale: (saleId: string, reason?: string) => Promise<boolean>;
  voidSale: (saleId: string, reason?: string) => Promise<boolean>;

  // Purchases
  purchases: Purchase[];
  recordPurchase: (
    purchaseData: Omit<Purchase, 'id' | 'invoiceNumber' | 'date'> & { invoiceNumber?: string }
  ) => Promise<Purchase>;
  updatePurchase: (
    purchaseId: string,
    purchaseData: Omit<Purchase, 'id' | 'date'>
  ) => Promise<void>;
  recordPurchaseReturn: (
    purchaseId: string,
    items: { productId: string; quantity: number; unitPrice: number; reason: string }[]
  ) => Promise<void>;

  // Stock
  stockMovements: StockMovement[];
  stockAdjustments: StockAdjustment[];
  stockTransfers: StockTransfer[];
  adjustStock: (
    productId: string,
    adjustedQty: number,
    reason: StockAdjustment['reason'],
    note?: string,
    variantId?: string
  ) => Promise<void>;
  transferStock: (
    productId: string,
    quantity: number,
    fromBranchId: string,
    toBranchId: string,
    note?: string
  ) => Promise<void>;
  recordExchangeEffects: (params: {
    exchangeNumber: string;
    branchId: string;
    restockedItems: { productId: string; productName: string; quantity: number; previousStock: number; newStock: number }[];
    replacementItems: { productId: string; productName: string; quantity: number; previousStock: number; newStock: number }[];
    differenceAmount: number;
    accountId?: string;
    accountName?: string;
    accountBalanceAfter?: number;
  }) => void;

  // Customers & Due
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  addCustomer: (
    customer: Omit<Customer, 'id' | 'createdAt' | 'currentDue' | 'totalPurchase' | 'totalPaid' | 'openingDue'> & {
      openingDue?: number;
    }
  ) => Promise<Customer>;
  updateCustomer: (id: string, customer: Partial<Customer>) => Promise<void>;
  collectCustomerDue: (
    customerId: string,
    amount: number,
    paymentMethod: PaymentMethod,
    accountId: string,
    note?: string
  ) => Promise<void>;

  // Suppliers & Due
  suppliers: Supplier[];
  supplierTransactions: SupplierTransaction[];
  addSupplier: (
    supplier: Omit<Supplier, 'id' | 'createdAt' | 'currentDue' | 'totalPurchase' | 'totalPaid' | 'openingDue'> & {
      openingDue?: number;
    }
  ) => Promise<Supplier>;
  updateSupplier: (id: string, supplier: Partial<Supplier>) => Promise<void>;
  paySupplierDue: (
    supplierId: string,
    amount: number,
    paymentMethod: PaymentMethod,
    accountId: string,
    note?: string
  ) => Promise<void>;

  // Accounts & Expenses
  accounts: Account[];
  accountTransactions: AccountTransaction[];
  expenses: Expense[];
  addAccount: (accountData: Omit<Account, 'id'>) => Promise<Account>;
  updateAccount: (id: string, updates: Partial<Account>) => Promise<void>;
  deleteAccount: (id: string) => Promise<{ success: boolean; message?: string }>;
  addExpense: (expense: Omit<Expense, 'id' | 'date'>) => Promise<void>;
  transferMoney: (fromAccountId: string, toAccountId: string, amount: number, note?: string) => Promise<void>;

  // Employees & Payroll
  employees: Employee[];
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<void>;
  updateEmployee: (id: string, employee: Partial<Employee>) => Promise<void>;
  disburseSalary: (employeeId: string, month: string, accountId: string, amount: number) => Promise<void>;

  // Sellers & Multi-user Management
  sellers: Seller[];
  addSeller: (sellerData: {
    fullName: string;
    username: string;
    phone: string;
    email?: string;
    password: string;
    branchId?: string;
    branchName?: string;
    status: 'active' | 'inactive';
  }) => Promise<Seller>;
  updateSeller: (
    id: string,
    updates: { fullName?: string; phone?: string; branchId?: string; branchName?: string; status?: 'active' | 'inactive' }
  ) => Promise<void>;
  toggleSellerStatus: (id: string, status: 'active' | 'inactive') => Promise<void>;
  resetSellerPassword: (email: string, newPassword?: string) => Promise<{ success: boolean; message: string }>;
  reloadSellers: () => Promise<void>;

  // Audit Logs
  auditLogs: AuditLog[];
  addAuditLog: (action: string, entityType: string, entityId: string, details: string) => void;

  // RBAC, Staff Accounts & Activity Logs
  roles: RoleDefinition[];
  activeRoleDefinition?: RoleDefinition;
  authenticatedRoleKey: string;
  isAuthenticatedAdmin: boolean;
  currentEmployee: Employee | null;
  activityLogs: UserActivityLog[];
  authBlockedReason: string | null;
  clearAuthBlockedReason: () => void;
  hasPermission: (moduleKey: PermissionModuleKey, action?: PermissionAction) => boolean;
  enforcePermission: (moduleKey: PermissionModuleKey, action: PermissionAction, contextLabel?: string) => boolean;
  createStaffAccount: (payload: CreateEmployeePayload) => Promise<Employee>;
  updateStaffAccount: (employee: Employee, updates: UpdateEmployeePayload) => Promise<void>;
  changeStaffStatus: (employee: Employee, newStatus: AccountStatus) => Promise<void>;
  resetStaffAccountPassword: (employee: Employee, newPassword?: string) => Promise<{ success: boolean; message: string }>;
  createCustomRole: (name: string, description: string, permissions: RolePermissionMatrix) => Promise<RoleDefinition>;
  updateRolePermissionsMatrix: (roleId: string, permissions: RolePermissionMatrix) => Promise<void>;
  deleteCustomRole: (roleId: string) => Promise<{ success: boolean; message?: string }>;
  logUserActivity: (
    eventType: UserActivityLog['eventType'],
    moduleKey: PermissionModuleKey | string,
    action: UserActivityLog['action'],
    details: string,
    entityType?: string,
    entityId?: string
  ) => void;
  reloadRbacData: () => Promise<void>;

  // System Helpers
  isAdmin: boolean;
  deleteSale: (saleId: string) => Promise<boolean>;
  deletePurchase: (purchaseId: string) => Promise<boolean>;
  deleteCustomer: (customerId: string) => Promise<{ success: boolean; message?: string }>;
  deleteSupplier: (supplierId: string) => Promise<{ success: boolean; message?: string }>;
  deleteExpense: (expenseId: string) => Promise<boolean>;
  deleteEmployee: (employeeId: string) => Promise<boolean>;
  backupData: () => string;
  restoreData: (jsonStr: string) => boolean;
  resetToDemoData: () => void;

  // Combo & Bundle Offers
  comboOffers: ComboOffer[];
  addComboOffer: (offer: Omit<ComboOffer, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>) => Promise<ComboOffer>;
  updateComboOffer: (id: string, updates: Partial<ComboOffer>) => Promise<void>;
  toggleOfferStatus: (id: string, status: OfferStatus) => Promise<void>;
  archiveComboOffer: (id: string) => Promise<void>;
  reloadComboOffers: () => Promise<void>;

  canAccess: (module: LegacyAppModule) => boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY = 'AMAR_DOKAN_PRO_STORAGE_V1';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Authentication & Membership State
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [activeBusinessId, setActiveBusinessId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isMigrated, setIsMigrated] = useState<boolean>(false);
  const [dbError, setDbError] = useState<string | null>(null);

  // Business State
  const [isBusinessConfigured, setIsBusinessConfigured] = useState<boolean>(false);
  const [settings, setSettings] = useState<ShopSettings>(initialSettings);
  const [currentUserRole, setCurrentUserRoleState] = useState<UserRole>('owner');
  const [authenticatedRoleKey, setAuthenticatedRoleKey] = useState<string>('super_admin');
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(null);
  const [authBlockedReason, setAuthBlockedReason] = useState<string | null>(null);
  const isAuthenticatedAdmin = authenticatedRoleKey === 'super_admin';
  const isAdmin = normalizeRoleKey(currentUserRole) === 'super_admin';
  const [activeBranchId, setActiveBranchId] = useState<string>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerTransactions, setCustomerTransactions] = useState<CustomerTransaction[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierTransactions, setSupplierTransactions] = useState<SupplierTransaction[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountTransactions, setAccountTransactions] = useState<AccountTransaction[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>(() => createDefaultRolesForBusiness('local'));
  const [activityLogs, setActivityLogs] = useState<UserActivityLog[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [stockAdjustments, setStockAdjustments] = useState<StockAdjustment[]>([]);
  const [stockTransfers, setStockTransfers] = useState<StockTransfer[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [comboOffers, setComboOffers] = useState<ComboOffer[]>([]);

  const clearDbError = useCallback(() => setDbError(null), []);
  const clearAuthBlockedReason = useCallback(() => setAuthBlockedReason(null), []);

  const raiseDbError = useCallback((err: any, fallback: string): Error => {
    const message = formatSupabaseError(err, fallback);
    setDbError(message);
    return new Error(message);
  }, []);

  const ensureCloudContext = useCallback(() => {
    if (isSupabaseConfigured && !activeBusinessId) {
      const msg = 'No active business session found. Please complete business setup or sign in again.';
      setDbError(msg);
      throw new Error(msg);
    }
  }, [activeBusinessId]);

  const setCurrentUserRole = useCallback(
    (role: UserRole) => {
      if (!isAuthenticatedAdmin && isSupabaseConfigured && user) {
        return;
      }
      setCurrentUserRoleState(role);
    },
    [isAuthenticatedAdmin, user]
  );

  // Helper: Selective fast reloads from Supabase so React state matches DB after atomic RPCs
  const refreshAfterSale = useCallback(async (businessId: string) => {
    const [salesList, prods, custs, custTxs, accs, accTxs, moves] = await Promise.all([
      salesService.fetchSales(businessId),
      productService.fetchProducts(businessId),
      customerService.fetchCustomers(businessId),
      customerService.fetchCustomerTransactions(businessId).catch(() => []),
      financeService.fetchAccounts(businessId),
      financeService.fetchAccountTransactions(businessId).catch(() => []),
      inventoryService.fetchStockMovements(businessId).catch(() => []),
    ]);
    setSales(salesList);
    setProducts(prods);
    setCustomers(custs);
    setCustomerTransactions(custTxs);
    setAccounts(accs);
    setAccountTransactions(accTxs);
    setStockMovements(moves);
  }, []);

  const refreshAfterPurchase = useCallback(async (businessId: string) => {
    const [purList, prods, supps, suppTxs, accs, accTxs, moves] = await Promise.all([
      purchaseService.fetchPurchases(businessId),
      productService.fetchProducts(businessId),
      supplierService.fetchSuppliers(businessId),
      supplierService.fetchSupplierTransactions(businessId).catch(() => []),
      financeService.fetchAccounts(businessId),
      financeService.fetchAccountTransactions(businessId).catch(() => []),
      inventoryService.fetchStockMovements(businessId).catch(() => []),
    ]);
    setPurchases(purList);
    setProducts(prods);
    setSuppliers(supps);
    setSupplierTransactions(suppTxs);
    setAccounts(accs);
    setAccountTransactions(accTxs);
    setStockMovements(moves);
  }, []);

  const refreshAfterFinance = useCallback(async (businessId: string) => {
    const [accs, accTxs, exps] = await Promise.all([
      financeService.fetchAccounts(businessId),
      financeService.fetchAccountTransactions(businessId).catch(() => []),
      financeService.fetchExpenses(businessId),
    ]);
    setAccounts(accs);
    setAccountTransactions(accTxs);
    setExpenses(exps);
  }, []);

  // Helper: Load all business data from Supabase
  const loadBusinessData = useCallback(async (businessId: string, currentBranchId?: string) => {
    try {
      setDbError(null);

      // 1. Fetch Business Settings
      const { data: bizData, error: bizErr } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .single();
      if (bizErr) throw bizErr;

      if (bizData) {
        const configured = Boolean(
          bizData.name && bizData.name.trim().length > 0 && bizData.name !== 'My Amar Dokan'
        );
        setIsBusinessConfigured(configured);
        let cachedBizSettings: Partial<ShopSettings> = {};
        try {
          const rawCached = localStorage.getItem(`${STORAGE_KEY}_${businessId}_SETTINGS`);
          if (rawCached) cachedBizSettings = JSON.parse(rawCached);
        } catch {
          cachedBizSettings = {};
        }
        const resolvedLogo =
          bizData.logo_url ||
          getShopLogo(cachedBizSettings.logoUrl !== undefined ? cachedBizSettings : undefined, businessId);
        setSettings({
          ...cachedBizSettings,
          shopName: bizData.name || '',
          ownerName: bizData.owner_name || cachedBizSettings.ownerName || '',
          tagline: bizData.tagline || '',
          address: bizData.address || '',
          mobile: bizData.phone || '',
          email: bizData.email || '',
          currency: bizData.currency || '৳',
          financialYear:
            bizData.financial_year || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
          vatTaxRate: Number(bizData.vat_tax_rate || 0),
          vatRegistrationNo: bizData.vat_registration_no ?? cachedBizSettings.vatRegistrationNo ?? '',
          invoiceFormat: (bizData.invoice_format as any) || 'thermal',
          businessType: (bizData.business_type as any) || 'general',
          language: (bizData.language as any) || 'en',
          uiMode: cachedBizSettings.uiMode || 'advanced',
          isConfigured: configured,
          logoUrl: resolvedLogo,
          printerSettings: getPrinterSettings({
            ...cachedBizSettings,
            invoiceFormat: (bizData.invoice_format as any) || 'thermal',
          }),
        });
      }

      // 2. Fetch Branches
      const { data: branchData, error: brErr } = await supabase
        .from('branches')
        .select('*')
        .eq('business_id', businessId)
        .order('is_main', { ascending: false })
        .order('created_at', { ascending: true });
      if (brErr) throw brErr;

      if (branchData && branchData.length > 0) {
        const loadedBranches: Branch[] = branchData.map((b: any) => ({
          id: b.id,
          name: b.name,
          location: b.location || '',
          mobile: b.mobile || '',
          isMain: Boolean(b.is_main),
        }));
        setBranches(loadedBranches);
        if (!currentBranchId || !loadedBranches.some(b => b.id === currentBranchId)) {
          setActiveBranchId(loadedBranches[0].id);
        }
      } else {
        setBranches([]);
        setActiveBranchId('');
      }

      // 3. Fetch Categories
      const { data: catData } = await supabase
        .from('categories')
        .select('*')
        .eq('business_id', businessId)
        .order('name', { ascending: true });
      if (catData && catData.length > 0) {
        setCategories(
          catData.map((c: any) => ({
            id: c.id,
            name: c.name,
            slug: c.slug || undefined,
            description: c.description || undefined,
          }))
        );
      } else {
        setCategories(initialCategories);
      }

      // 4. Parallel load of all operational tables
      const [
        prodsRes,
        custsRes,
        custTxRes,
        suppsRes,
        suppTxRes,
        accsRes,
        accTxRes,
        expsRes,
        salesRes,
        purRes,
        movesRes,
        transfersRes,
        logsRes,
        offersRes,
        rolesRes,
        employeesRes,
        activityRes,
      ] = await Promise.allSettled([
        productService.fetchProducts(businessId),
        customerService.fetchCustomers(businessId),
        customerService.fetchCustomerTransactions(businessId),
        supplierService.fetchSuppliers(businessId),
        supplierService.fetchSupplierTransactions(businessId),
        financeService.fetchAccounts(businessId),
        financeService.fetchAccountTransactions(businessId),
        financeService.fetchExpenses(businessId),
        salesService.fetchSales(businessId),
        purchaseService.fetchPurchases(businessId),
        inventoryService.fetchStockMovements(businessId),
        inventoryService.fetchStockTransfers(businessId),
        auditService.fetchLogs(businessId),
        comboOfferService.fetchOffers(businessId),
        staffRbacService.fetchRolesAndPermissions(businessId),
        staffRbacService.fetchEmployees(businessId),
        staffRbacService.fetchActivityLogs(businessId),
      ]);

      const loadedSales = salesRes.status === 'fulfilled' ? salesRes.value : [];

      if (prodsRes.status === 'fulfilled') setProducts(prodsRes.value);
      if (custsRes.status === 'fulfilled') setCustomers(custsRes.value);
      if (custTxRes.status === 'fulfilled') setCustomerTransactions(custTxRes.value);
      if (suppsRes.status === 'fulfilled') setSuppliers(suppsRes.value);
      if (suppTxRes.status === 'fulfilled') setSupplierTransactions(suppTxRes.value);
      if (accsRes.status === 'fulfilled') setAccounts(accsRes.value);
      if (accTxRes.status === 'fulfilled') setAccountTransactions(accTxRes.value);
      if (expsRes.status === 'fulfilled') setExpenses(expsRes.value);
      if (salesRes.status === 'fulfilled') setSales(loadedSales);
      if (purRes.status === 'fulfilled') setPurchases(purRes.value);
      if (movesRes.status === 'fulfilled') setStockMovements(movesRes.value);
      if (transfersRes.status === 'fulfilled') setStockTransfers(transfersRes.value);
      if (logsRes.status === 'fulfilled') setAuditLogs(logsRes.value);
      if (offersRes.status === 'fulfilled') setComboOffers(offersRes.value);
      if (rolesRes.status === 'fulfilled') setRoles(rolesRes.value);
      if (employeesRes.status === 'fulfilled') setEmployees(employeesRes.value);
      if (activityRes.status === 'fulfilled') setActivityLogs(activityRes.value);

      // Sellers depend on loadedSales for aggregate totals
      try {
        const sellerList = await sellerService.fetchSellers(businessId, loadedSales);
        setSellers(sellerList);
      } catch (err) {
        console.warn('Could not load sellers from Supabase:', err);
      }

      // Surface critical data load failures cleanly
      const firstCriticalFailure = [prodsRes, accsRes, salesRes, purRes].find(r => r.status === 'rejected');
      if (firstCriticalFailure && firstCriticalFailure.status === 'rejected') {
        setDbError(formatSupabaseError(firstCriticalFailure.reason, 'Failed to sync some cloud records.'));
      }
    } catch (err: any) {
      setDbError(formatSupabaseError(err, 'Error loading business data from Supabase.'));
    }
  }, []);

  // Fallback: Read local storage ONLY when Supabase is NOT configured
  const loadFromLocalStorageFallback = () => {
    try {
      const isConfigured = localStorage.getItem(`${STORAGE_KEY}_IS_CONFIGURED`) === 'true';
      const storedBizId = localStorage.getItem(`${STORAGE_KEY}_CURRENT_BIZ_ID`) || '';

      if (!isConfigured) {
        setIsBusinessConfigured(false);
        setBranches([]);
        setAccounts([]);
        setProducts([]);
        setCustomers([]);
        setCustomerTransactions([]);
        setSuppliers([]);
        setSupplierTransactions([]);
        setSales([]);
        setPurchases([]);
        setExpenses([]);
        setAccountTransactions([]);
        setStockMovements([]);
        setStockAdjustments([]);
        setStockTransfers([]);
        setAuditLogs([]);
        setComboOffers([]);
        setEmployees([]);
        setSellers([]);
        setRoles(createDefaultRolesForBusiness('local'));
        setActivityLogs([]);
        setSettings(initialSettings);
        return;
      }

      setIsBusinessConfigured(true);
      if (storedBizId) setActiveBusinessId(storedBizId);
      staffRbacService.fetchRolesAndPermissions(storedBizId || 'local').then(setRoles);
      staffRbacService.fetchEmployees(storedBizId || 'local').then(setEmployees);
      staffRbacService.fetchActivityLogs(storedBizId || 'local').then(setActivityLogs);
      comboOfferService.fetchOffers(storedBizId || 'default-business').then(setComboOffers);

      const bizPrefix = storedBizId ? `${STORAGE_KEY}_${storedBizId}` : STORAGE_KEY;

      const savedSettings =
        localStorage.getItem(`${bizPrefix}_SETTINGS`) || localStorage.getItem(`${STORAGE_KEY}_SETTINGS`);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        setSettings({
          ...initialSettings,
          ...parsed,
          logoUrl: getShopLogo(parsed, storedBizId || undefined),
          printerSettings: getPrinterSettings(parsed),
        });
      }

      const savedBranches =
        localStorage.getItem(`${bizPrefix}_BRANCHES`) || localStorage.getItem(`${STORAGE_KEY}_BRANCHES`);
      if (savedBranches) {
        const parsed: Branch[] = JSON.parse(savedBranches);
        setBranches(parsed);
        if (parsed.length > 0) setActiveBranchId(parsed[0].id);
      }

      const savedCats =
        localStorage.getItem(`${bizPrefix}_CATEGORIES`) || localStorage.getItem(`${STORAGE_KEY}_CATEGORIES`);
      if (savedCats) setCategories(JSON.parse(savedCats));

      const savedAccounts =
        localStorage.getItem(`${bizPrefix}_ACCOUNTS`) || localStorage.getItem(`${STORAGE_KEY}_ACCOUNTS`);
      if (savedAccounts) setAccounts(JSON.parse(savedAccounts));

      const savedProds =
        localStorage.getItem(`${bizPrefix}_PRODUCTS`) || localStorage.getItem(`${STORAGE_KEY}_PRODUCTS`);
      if (savedProds) setProducts(JSON.parse(savedProds));

      const savedCusts =
        localStorage.getItem(`${bizPrefix}_CUSTOMERS`) || localStorage.getItem(`${STORAGE_KEY}_CUSTOMERS`);
      if (savedCusts) setCustomers(JSON.parse(savedCusts));

      const savedCustTxs =
        localStorage.getItem(`${bizPrefix}_CUSTOMER_TXS`) || localStorage.getItem(`${STORAGE_KEY}_CUSTOMER_TXS`);
      if (savedCustTxs) setCustomerTransactions(JSON.parse(savedCustTxs));

      const savedSupps =
        localStorage.getItem(`${bizPrefix}_SUPPLIERS`) || localStorage.getItem(`${STORAGE_KEY}_SUPPLIERS`);
      if (savedSupps) setSuppliers(JSON.parse(savedSupps));

      const savedSuppTxs =
        localStorage.getItem(`${bizPrefix}_SUPPLIER_TXS`) || localStorage.getItem(`${STORAGE_KEY}_SUPPLIER_TXS`);
      if (savedSuppTxs) setSupplierTransactions(JSON.parse(savedSuppTxs));

      const savedSales =
        localStorage.getItem(`${bizPrefix}_SALES`) || localStorage.getItem(`${STORAGE_KEY}_SALES`);
      if (savedSales) setSales(JSON.parse(savedSales));

      const savedPurchases =
        localStorage.getItem(`${bizPrefix}_PURCHASES`) || localStorage.getItem(`${STORAGE_KEY}_PURCHASES`);
      if (savedPurchases) setPurchases(JSON.parse(savedPurchases));

      const savedExpenses =
        localStorage.getItem(`${bizPrefix}_EXPENSES`) || localStorage.getItem(`${STORAGE_KEY}_EXPENSES`);
      if (savedExpenses) setExpenses(JSON.parse(savedExpenses));

      const savedAccTxs =
        localStorage.getItem(`${bizPrefix}_ACCOUNT_TXS`) || localStorage.getItem(`${STORAGE_KEY}_ACCOUNT_TXS`);
      if (savedAccTxs) setAccountTransactions(JSON.parse(savedAccTxs));

      const savedMoves =
        localStorage.getItem(`${bizPrefix}_STOCK_MOVEMENTS`) || localStorage.getItem(`${STORAGE_KEY}_STOCK_MOVEMENTS`);
      if (savedMoves) setStockMovements(JSON.parse(savedMoves));

      const savedAdj =
        localStorage.getItem(`${bizPrefix}_STOCK_ADJUSTMENTS`) || localStorage.getItem(`${STORAGE_KEY}_STOCK_ADJUSTMENTS`);
      if (savedAdj) setStockAdjustments(JSON.parse(savedAdj));

      const savedTransfers =
        localStorage.getItem(`${bizPrefix}_STOCK_TRANSFERS`) || localStorage.getItem(`${STORAGE_KEY}_STOCK_TRANSFERS`);
      if (savedTransfers) setStockTransfers(JSON.parse(savedTransfers));

      const savedAudits =
        localStorage.getItem(`${bizPrefix}_AUDIT_LOGS`) || localStorage.getItem(`${STORAGE_KEY}_AUDIT_LOGS`);
      if (savedAudits) setAuditLogs(JSON.parse(savedAudits));

      const savedSellers =
        localStorage.getItem(`${bizPrefix}_SELLERS`) || localStorage.getItem(`${STORAGE_KEY}_SELLERS`);
      if (savedSellers) setSellers(JSON.parse(savedSellers));
    } catch (e) {
      console.error('LocalStorage load error:', e);
    }
  };

  // Helper: Initialize or link user's business
  const initializeUserBusiness = useCallback(
    async (authUser: User) => {
      try {
        // 0. Verify employee account status
        const accessCheck = await staffRbacService.verifyEmployeeAccess(authUser.id);
        if (!accessCheck.allowed) {
          setAuthBlockedReason(
            accessCheck.reason ||
              'Your employee account is deactivated or suspended. Please contact the Store Owner.'
          );
          if (isSupabaseConfigured) {
            await supabase.auth.signOut();
          }
          setSession(null);
          setUser(null);
          setActiveBusinessId('');
          setIsBusinessConfigured(false);
          return;
        }

        setAuthBlockedReason(null);
        setCurrentEmployee(accessCheck.employee || null);

        // 1. Ensure user profile exists
        let { data: profile } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', authUser.id)
          .maybeSingle();

        if (!profile) {
          const { data: createdProfile, error: profileErr } = await supabase
            .from('user_profiles')
            .insert({
              id: authUser.id,
              email: authUser.email || '',
              full_name:
                authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Store Owner',
            })
            .select()
            .maybeSingle();

          if (profileErr) {
            console.warn('Notice user_profiles insert:', profileErr.message);
          } else {
            profile = createdProfile;
          }
        }

        // 2. Check business membership
        const { data: memberships, error: memErr } = await supabase
          .from('business_users')
          .select('*, businesses(*), branches(*)')
          .eq('user_id', authUser.id);

        if (memErr) throw memErr;

        if (memberships && memberships.length > 0) {
          const primary = memberships[0];
          if (primary.status && primary.status !== 'active') {
            setAuthBlockedReason(
              `Your staff account is currently ${primary.status}. Please contact the Store Owner.`
            );
            await supabase.auth.signOut();
            setSession(null);
            setUser(null);
            return;
          }

          const bizId = primary.business_id;
          const branchId = accessCheck.employee?.branchId || primary.branch_id || '';
          const rawRoleKey = accessCheck.roleKey || normalizeRoleKey(primary.role);
          const role = roleKeyToLegacyUserRole(rawRoleKey);

          const biz = primary.businesses;
          const isConfigured = Boolean(
            biz && biz.name && biz.name.trim().length > 0 && biz.name !== 'My Amar Dokan'
          );

          setActiveBusinessId(bizId);
          setAuthenticatedRoleKey(rawRoleKey);
          setCurrentUserRoleState(role);
          setIsBusinessConfigured(isConfigured);

          if (isConfigured) {
            if (branchId) setActiveBranchId(branchId);
            await loadBusinessData(bizId, branchId);
            const empName =
              accessCheck.employee?.name ||
              profile?.full_name ||
              authUser.user_metadata?.full_name ||
              authUser.email ||
              'Staff';
            staffRbacService
              .logActivity(
                {
                  userId: authUser.id,
                  employeeId: accessCheck.employee?.id,
                  employeeCode: accessCheck.employee?.employeeCode,
                  employeeName: empName,
                  roleKey: rawRoleKey,
                  roleName: accessCheck.employee?.roleName || rawRoleKey,
                  eventType: 'LOGIN_SUCCESS',
                  moduleKey: 'user_management',
                  action: 'login',
                  details: `${empName} signed in (${rawRoleKey})`,
                },
                bizId
              )
              .then(item => setActivityLogs(prev => [item, ...prev.filter(x => x.id !== item.id)]))
              .catch(() => {});
          } else {
            setBranches([]);
            setAccounts([]);
            setProducts([]);
            setSales([]);
          }
        } else if (
          accessCheck.roleKey ||
          authUser.user_metadata?.role === 'seller' ||
          authUser.user_metadata?.role === 'salesman'
        ) {
          const rawRoleKey = accessCheck.roleKey || normalizeRoleKey(authUser.user_metadata?.role);
          setAuthenticatedRoleKey(rawRoleKey);
          setCurrentUserRoleState(roleKeyToLegacyUserRole(rawRoleKey));
          if (accessCheck.businessId) {
            setActiveBusinessId(accessCheck.businessId);
            setIsBusinessConfigured(true);
            await loadBusinessData(accessCheck.businessId, accessCheck.employee?.branchId);
          } else {
            setIsBusinessConfigured(false);
          }
        } else {
          // Fresh user: trigger Business Setup Wizard
          setAuthenticatedRoleKey('super_admin');
          setCurrentUserRoleState('owner');
          setActiveBusinessId('');
          setActiveBranchId('');
          setIsBusinessConfigured(false);
          setBranches([]);
          setAccounts([]);
          setProducts([]);
          setSales([]);
          setPurchases([]);
          setCustomers([]);
          setSuppliers([]);
          setExpenses([]);
          setEmployees([]);
          setSellers([]);
          setCustomerTransactions([]);
          setSupplierTransactions([]);
          setAccountTransactions([]);
          setStockMovements([]);
          setStockTransfers([]);
        }
      } catch (err: any) {
        setDbError(formatSupabaseError(err, 'Failed to initialize your business account.'));
      } finally {
        setIsLoading(false);
      }
    },
    [loadBusinessData]
  );

  // Initialize Auth & Supabase Session
  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      if (!isSupabaseConfigured) {
        loadFromLocalStorageFallback();
        setIsLoading(false);
        return;
      }

      try {
        const {
          data: { session: initialSession },
          error: sessErr,
        } = await supabase.auth.getSession();
        if (sessErr) throw sessErr;
        if (!isMounted) return;

        setSession(initialSession);
        setUser(initialSession?.user ?? null);

        if (initialSession?.user) {
          await initializeUserBusiness(initialSession.user);
        } else {
          setIsLoading(false);
        }
      } catch (err: any) {
        if (!isMounted) return;
        setDbError(formatSupabaseError(err, 'Unable to connect to Supabase authentication.'));
        setIsLoading(false);
      }
    }

    initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!isMounted) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (event === 'SIGNED_IN' && newSession?.user) {
        setIsLoading(true);
        await initializeUserBusiness(newSession.user);
        if (isMounted) setIsLoading(false);
      } else if (event === 'SIGNED_OUT') {
        setActiveBusinessId('');
        setActiveBranchId('');
        setProducts([]);
        setSales([]);
        setPurchases([]);
        setCustomers([]);
        setSuppliers([]);
        setExpenses([]);
        setCustomerTransactions([]);
        setSupplierTransactions([]);
        setAccountTransactions([]);
        setStockMovements([]);
        setStockTransfers([]);
        setIsBusinessConfigured(false);
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [initializeUserBusiness]);

  const reloadProducts = useCallback(async () => {
    if (activeBusinessId && isSupabaseConfigured) {
      const loaded = await productService.fetchProducts(activeBusinessId);
      setProducts(loaded);
      return;
    }
    try {
      const bizPrefix = activeBusinessId ? `${STORAGE_KEY}_${activeBusinessId}` : STORAGE_KEY;
      const savedProds =
        localStorage.getItem(`${bizPrefix}_PRODUCTS`) || localStorage.getItem(`${STORAGE_KEY}_PRODUCTS`);
      if (savedProds) {
        setProducts(JSON.parse(savedProds));
      }
    } catch {
      // ignore storage read errors
    }
  }, [activeBusinessId]);

  const migrateLegacyData = async (): Promise<boolean> => {
    if (!activeBusinessId || !isSupabaseConfigured) {
      alert('You must be logged in with Supabase configured to migrate data.');
      return false;
    }

    try {
      const localProds = products.length > 0 ? products : initialProducts;
      for (const p of localProds) {
        await productService.insertProduct(p, activeBusinessId);
      }
      for (const c of customers) {
        await customerService.insertCustomer(c, activeBusinessId);
      }
      for (const s of suppliers) {
        await supplierService.insertSupplier(s, activeBusinessId);
      }

      await loadBusinessData(activeBusinessId, activeBranchId);
      setIsMigrated(true);
      localStorage.setItem(`${STORAGE_KEY}_MIGRATED_${activeBusinessId}`, 'true');
      alert('Legacy business data migrated to Supabase successfully!');
      return true;
    } catch (err: any) {
      const msg = formatSupabaseError(err, 'Migration failed.');
      setDbError(msg);
      alert('Migration error: ' + msg);
      return false;
    }
  };

  // Sync local temporary cache ONLY in non-Supabase mode for full offline persistence
  useEffect(() => {
    if (!isLoading && !isSupabaseConfigured) {
      try {
        const entries: [string, unknown][] = [
          ['SETTINGS', settings],
          ['BRANCHES', branches],
          ['CATEGORIES', categories],
          ['PRODUCTS', products],
          ['CUSTOMERS', customers],
          ['CUSTOMER_TXS', customerTransactions],
          ['SUPPLIERS', suppliers],
          ['SUPPLIER_TXS', supplierTransactions],
          ['SALES', sales],
          ['PURCHASES', purchases],
          ['ACCOUNTS', accounts],
          ['ACCOUNT_TXS', accountTransactions],
          ['EXPENSES', expenses],
          ['STOCK_MOVEMENTS', stockMovements],
          ['STOCK_ADJUSTMENTS', stockAdjustments],
          ['STOCK_TRANSFERS', stockTransfers],
          ['AUDIT_LOGS', auditLogs],
          ['SELLERS', sellers],
        ];
        for (const [suffix, value] of entries) {
          const serialized = JSON.stringify(value);
          if (activeBusinessId) {
            localStorage.setItem(`${STORAGE_KEY}_${activeBusinessId}_${suffix}`, serialized);
          }
          localStorage.setItem(`${STORAGE_KEY}_${suffix}`, serialized);
        }
      } catch {
        // ignore storage quota errors
      }
    }
  }, [
    settings,
    branches,
    categories,
    products,
    customers,
    customerTransactions,
    suppliers,
    supplierTransactions,
    sales,
    purchases,
    accounts,
    accountTransactions,
    expenses,
    stockMovements,
    stockAdjustments,
    stockTransfers,
    auditLogs,
    sellers,
    isLoading,
    activeBusinessId,
  ]);

  const activeRoleKey = normalizeRoleKey(currentUserRole);
  const activeRoleDefinition =
    roles.find(r => r.roleKey === activeRoleKey || r.id === currentEmployee?.roleId) ||
    roles.find(r => r.roleKey === 'super_admin') ||
    roles[0];

  const logUserActivity = useCallback(
    (
      eventType: UserActivityLog['eventType'],
      moduleKey: PermissionModuleKey | string,
      action: UserActivityLog['action'],
      details: string,
      entityType?: string,
      entityId?: string
    ) => {
      const actorName =
        currentEmployee?.name ||
        user?.user_metadata?.full_name ||
        user?.email?.split('@')[0] ||
        (activeRoleKey === 'super_admin' ? 'Store Owner' : activeRoleKey);
      staffRbacService
        .logActivity(
          {
            userId: user?.id,
            employeeId: currentEmployee?.id,
            employeeCode: currentEmployee?.employeeCode,
            employeeName: actorName,
            roleKey: activeRoleKey,
            roleName: activeRoleDefinition?.name || activeRoleKey,
            eventType,
            moduleKey,
            action,
            entityType,
            entityId,
            details,
          },
          activeBusinessId || 'local'
        )
        .then(log => {
          setActivityLogs(prev => [log, ...prev.filter(x => x.id !== log.id)].slice(0, 300));
        })
        .catch(() => {});
    },
    [activeBusinessId, activeRoleDefinition, activeRoleKey, currentEmployee, user]
  );

  const hasPermission = useCallback(
    (moduleKey: PermissionModuleKey, action: PermissionAction = 'view'): boolean => {
      const roleObj = roles.find(
        r =>
          r.roleKey === currentUserRole ||
          r.roleKey === activeRoleKey ||
          (currentEmployee?.roleId && r.id === currentEmployee.roleId && activeRoleKey === currentEmployee.roleKey)
      );
      return hasMatrixPermission(roleObj?.permissions, activeRoleKey, moduleKey, action);
    },
    [roles, currentUserRole, activeRoleKey, currentEmployee]
  );

  const enforcePermission = useCallback(
    (moduleKey: PermissionModuleKey, action: PermissionAction, contextLabel?: string): boolean => {
      const allowed = hasPermission(moduleKey, action);
      if (!allowed) {
        logUserActivity(
          'PERMISSION_DENIED',
          moduleKey,
          action,
          `Blocked unauthorized ${action.toUpperCase()} attempt on ${contextLabel || moduleKey}`
        );
      }
      return allowed;
    },
    [hasPermission, logUserActivity]
  );

  const canAccess = useCallback(
    (module: LegacyAppModule): boolean => {
      if (activeRoleKey === 'super_admin') return true;
      const requiredKeys = mapLegacyModuleToPermissionKeys(module);
      return requiredKeys.some(k => hasPermission(k, 'view'));
    },
    [activeRoleKey, hasPermission]
  );

  const signOut = async () => {
    logUserActivity('LOGOUT', 'user_management', 'logout', 'User signed out');
    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setUser(null);
    setCurrentEmployee(null);
    setAuthenticatedRoleKey('super_admin');
    setCurrentUserRoleState('owner');
    setActiveBusinessId('');
    setActiveBranchId('');
    setIsBusinessConfigured(false);
    setDbError(null);
  };

  const addAuditLog = (action: string, entityType: string, entityId: string, details: string) => {
    const newLog: AuditLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      date: new Date().toISOString(),
      userRole: currentUserRole,
      action,
      entityType,
      entityId,
      details,
      branchId: activeBranchId,
    };
    setAuditLogs(prev => [newLog, ...prev]);
    auditService.logAction(newLog, activeBusinessId, user?.id);
  };

  // Settings (Database-first)
  const updateSettings = async (newSettings: Partial<ShopSettings>): Promise<void> => {
    if (!enforcePermission('application_settings', 'edit', 'Application Settings')) {
      throw new Error('Permission denied: You do not have permission to edit Application Settings.');
    }

    if (activeBusinessId && isSupabaseConfigured) {
      const payload: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (newSettings.shopName !== undefined) payload.name = newSettings.shopName;
      if (newSettings.ownerName !== undefined) payload.owner_name = newSettings.ownerName;
      if (newSettings.tagline !== undefined) payload.tagline = newSettings.tagline;
      if (newSettings.address !== undefined) payload.address = newSettings.address;
      if (newSettings.mobile !== undefined) payload.phone = newSettings.mobile;
      if (newSettings.email !== undefined) payload.email = newSettings.email;
      if (newSettings.currency !== undefined) payload.currency = newSettings.currency;
      if (newSettings.financialYear !== undefined) payload.financial_year = newSettings.financialYear;
      if (newSettings.vatTaxRate !== undefined) payload.vat_tax_rate = newSettings.vatTaxRate;
      if (newSettings.vatRegistrationNo !== undefined) payload.vat_registration_no = newSettings.vatRegistrationNo;
      if (newSettings.invoiceFormat !== undefined) payload.invoice_format = newSettings.invoiceFormat;
      if (newSettings.businessType !== undefined) payload.business_type = newSettings.businessType;
      if (newSettings.language !== undefined) payload.language = newSettings.language;
      if (newSettings.logoUrl !== undefined) payload.logo_url = newSettings.logoUrl || null;

      if (Object.keys(payload).length > 1) {
        const { error } = await supabase.from('businesses').update(payload).eq('id', activeBusinessId);
        if (error) {
          throw raiseDbError(error, 'Failed to save shop settings to Supabase.');
        }
      }
    }

    if (newSettings.printerSettings) {
      savePrinterSettings(newSettings.printerSettings);
    }
    if (newSettings.logoUrl !== undefined) {
      saveShopLogo(newSettings.logoUrl, activeBusinessId || undefined);
    }

    setSettings(prev => {
      const merged = { ...prev, ...newSettings };
      try {
        if (activeBusinessId) {
          localStorage.setItem(`${STORAGE_KEY}_${activeBusinessId}_SETTINGS`, JSON.stringify(merged));
        }
        localStorage.setItem(`${STORAGE_KEY}_SETTINGS`, JSON.stringify(merged));
      } catch {}
      return merged;
    });

    addAuditLog('SETTINGS_UPDATED', 'settings', 'shop_settings', 'Business profile & shop settings updated');
    logUserActivity(
      'SETTINGS_UPDATED',
      'application_settings',
      'edit',
      'Updated business profile & store configuration',
      'settings',
      'shop_settings'
    );
  };

  // Business Setup (Strict creation order: businesses -> user_profiles -> business_users -> branches -> accounts)
  const completeBusinessSetup = async (setupData: BusinessSetupData) => {
    setIsLoading(true);
    setDbError(null);
    try {
      let bizId = activeBusinessId;
      let mainBranchId = '';
      const now = new Date().toISOString();

      if (isSupabaseConfigured && user) {
        if (!bizId) {
          const { data: newBiz, error: bErr } = await supabase
            .from('businesses')
            .insert({
              name: setupData.shopName,
              owner_name: setupData.ownerName,
              tagline: '',
              business_type: setupData.businessType,
              phone: setupData.phone,
              email: setupData.email || user.email || null,
              address: setupData.address,
              currency: setupData.currency,
              financial_year: setupData.financialYear,
              vat_tax_rate: setupData.vatTaxRate,
              vat_registration_no: setupData.vatRegistrationNo || null,
              language: 'en',
              is_active: true,
            })
            .select()
            .single();
          if (bErr) throw bErr;
          bizId = newBiz.id;
        } else {
          const { error: uBizErr } = await supabase
            .from('businesses')
            .update({
              name: setupData.shopName,
              owner_name: setupData.ownerName,
              business_type: setupData.businessType,
              phone: setupData.phone,
              email: setupData.email || user.email || null,
              address: setupData.address,
              currency: setupData.currency,
              financial_year: setupData.financialYear,
              vat_tax_rate: setupData.vatTaxRate,
              vat_registration_no: setupData.vatRegistrationNo || null,
              updated_at: now,
            })
            .eq('id', bizId);
          if (uBizErr) throw uBizErr;
        }

        // Upsert user profile
        const { error: profErr } = await supabase.from('user_profiles').upsert({
          id: user.id,
          email: user.email || '',
          full_name: setupData.ownerName,
          mobile: setupData.phone,
          updated_at: now,
        });
        if (profErr) throw profErr;

        // Upsert owner membership FIRST so RLS helper is_business_owner_or_admin(bizId) succeeds immediately
        const { error: memErr } = await supabase.from('business_users').upsert(
          {
            business_id: bizId,
            user_id: user.id,
            role: 'owner',
            status: 'active',
          },
          { onConflict: 'business_id,user_id' }
        );
        if (memErr) throw memErr;

        // Create primary branch
        const { data: newBranch, error: brErr } = await supabase
          .from('branches')
          .insert({
            business_id: bizId,
            name: setupData.branchName,
            location: setupData.address,
            mobile: setupData.phone,
            is_main: true,
          })
          .select()
          .single();
        if (brErr) throw brErr;
        mainBranchId = newBranch.id;

        // Link main branch to membership
        await supabase
          .from('business_users')
          .update({ branch_id: mainBranchId })
          .eq('business_id', bizId)
          .eq('user_id', user.id);

        // Insert initial accounts
        const createdAccounts: Account[] = [];
        if (setupData.initialAccounts && setupData.initialAccounts.length > 0) {
          for (const acc of setupData.initialAccounts) {
            const { data: accRes, error: aErr } = await supabase
              .from('accounts')
              .insert({
                business_id: bizId,
                name: acc.name,
                account_type: acc.accountType,
                account_number: acc.accountNumber || null,
                balance: acc.openingBalance || 0,
                is_active: true,
              })
              .select()
              .single();
            if (aErr) throw aErr;
            if (accRes) {
              createdAccounts.push({
                id: accRes.id,
                name: accRes.name,
                accountType: accRes.account_type,
                accountNumber: accRes.account_number || undefined,
                balance: Number(accRes.balance || 0),
              });
            }
          }
        }

        // Seed default system roles in RBAC table
        try {
          const seededRoles = await staffRbacService.fetchRolesAndPermissions(bizId);
          setRoles(seededRoles);
        } catch {}

        setActiveBusinessId(bizId);
        setActiveBranchId(mainBranchId);
        setBranches([
          {
            id: mainBranchId,
            name: setupData.branchName,
            location: setupData.address,
            mobile: setupData.phone,
            isMain: true,
          },
        ]);
        setAccounts(createdAccounts);
      } else {
        // Local mode
        bizId = `biz-${Date.now()}`;
        mainBranchId = `branch-${Date.now()}`;

        const createdAccounts: Account[] = (setupData.initialAccounts || []).map((a, idx) => ({
          id: `acc-${Date.now()}-${idx}`,
          name: a.name,
          accountType: a.accountType,
          accountNumber: a.accountNumber,
          balance: a.openingBalance || 0,
        }));

        setActiveBusinessId(bizId);
        setActiveBranchId(mainBranchId);
        setBranches([
          {
            id: mainBranchId,
            name: setupData.branchName,
            location: setupData.address,
            mobile: setupData.phone,
            isMain: true,
          },
        ]);
        setAccounts(createdAccounts);
      }

      const updatedSettings: ShopSettings = {
        shopName: setupData.shopName,
        ownerName: setupData.ownerName,
        tagline: '',
        address: setupData.address,
        mobile: setupData.phone,
        email: setupData.email || '',
        logoUrl: getShopLogo(undefined, bizId),
        vatRegistrationNo: setupData.vatRegistrationNo || '',
        currency: setupData.currency,
        financialYear: setupData.financialYear,
        vatTaxRate: setupData.vatTaxRate,
        invoiceFormat: 'thermal',
        businessType: setupData.businessType,
        language: 'en',
        uiMode: 'advanced',
        isConfigured: true,
      };

      setSettings(updatedSettings);
      setIsBusinessConfigured(true);
      setCurrentUserRoleState('owner');
      setAuthenticatedRoleKey('super_admin');

      localStorage.setItem(`${STORAGE_KEY}_IS_CONFIGURED`, 'true');
      localStorage.setItem(`${STORAGE_KEY}_CURRENT_BIZ_ID`, bizId);
      localStorage.setItem(`${STORAGE_KEY}_${bizId}_SETTINGS`, JSON.stringify(updatedSettings));
      localStorage.setItem(
        `${STORAGE_KEY}_${bizId}_BRANCHES`,
        JSON.stringify([
          {
            id: mainBranchId,
            name: setupData.branchName,
            location: setupData.address,
            mobile: setupData.phone,
            isMain: true,
          },
        ])
      );

      setProducts([]);
      setCustomers([]);
      setSuppliers([]);
      setSales([]);
      setPurchases([]);
      setExpenses([]);
      setEmployees([]);
      setSellers([]);
      setCustomerTransactions([]);
      setSupplierTransactions([]);
      setAccountTransactions([]);
      setStockMovements([]);
      setStockAdjustments([]);
      setStockTransfers([]);
      setComboOffers([]);
      setAuditLogs([]);
      setActivityLogs([]);
      try {
        localStorage.removeItem(`AMAR_DOKAN_COMBO_OFFERS_V1_${bizId}`);
        localStorage.removeItem(`AMAR_DOKAN_COMBO_USAGE_V1_${bizId}`);
        localStorage.removeItem(`AMAR_DOKAN_COMBO_OFFERS_V1_default-business`);
        localStorage.removeItem(`AMAR_DOKAN_COMBO_USAGE_V1_default-business`);
      } catch {}

      addAuditLog('BUSINESS_SETUP_COMPLETED', 'business', bizId, `Business setup completed for ${setupData.shopName}`);
    } catch (err: any) {
      throw raiseDbError(err, 'Failed to complete business setup.');
    } finally {
      setIsLoading(false);
    }
  };

  // Branches (Database-first)
  const addBranch = async (branchData: Omit<Branch, 'id'>): Promise<Branch> => {
    ensureCloudContext();
    let newBranch: Branch;
    if (activeBusinessId && isSupabaseConfigured) {
      newBranch = await branchService.insertBranch(branchData, activeBusinessId);
    } else {
      newBranch = { ...branchData, id: `branch-${Date.now()}` };
    }
    setBranches(prev => [...prev, newBranch]);
    if (!activeBranchId) setActiveBranchId(newBranch.id);
    addAuditLog('BRANCH_CREATED', 'branch', newBranch.id, `New branch added: ${newBranch.name}`);
    return newBranch;
  };

  const updateBranch = async (id: string, updates: Partial<Branch>): Promise<void> => {
    ensureCloudContext();
    if (activeBusinessId && isSupabaseConfigured) {
      await branchService.updateBranch(id, updates, activeBusinessId);
    }
    setBranches(prev => prev.map(b => (b.id === id ? { ...b, ...updates } : b)));
    addAuditLog('BRANCH_UPDATED', 'branch', id, `Branch updated: ID ${id}`);
  };

  const deleteBranch = async (id: string): Promise<{ success: boolean; message?: string }> => {
    if (!isAdmin) {
      return { success: false, message: 'Only an Administrator can delete branches.' };
    }
    if (branches.length <= 1) {
      return { success: false, message: 'Cannot delete the only branch. A business must have at least one branch.' };
    }
    const target = branches.find(b => b.id === id);
    if (target?.isMain) {
      return {
        success: false,
        message: 'Cannot delete the primary/main branch. Please set another branch as main first.',
      };
    }
    if (activeBusinessId && isSupabaseConfigured) {
      await branchService.deleteBranch(id, activeBusinessId);
    }
    setBranches(prev => prev.filter(b => b.id !== id));
    if (activeBranchId === id) {
      const nextBranch = branches.find(b => b.id !== id);
      if (nextBranch) setActiveBranchId(nextBranch.id);
    }
    addAuditLog('BRANCH_DELETED', 'branch', id, `Branch deleted: ${target?.name || id}`);
    return { success: true };
  };

  // Categories CRUD (Database-first)
  const addCategory = async (catData: { name: string; description?: string }): Promise<Category> => {
    const trimmed = catData.name.trim();
    if (!trimmed) {
      throw new Error('Category name cannot be empty.');
    }
    const existing = categories.find(c => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;

    const slug = trimmed.toLowerCase().replace(/\s+/g, '-');
    let newCat: Category;

    if (isSupabaseConfigured) {
      ensureCloudContext();
      const { data, error } = await supabase
        .from('categories')
        .insert({
          business_id: activeBusinessId,
          name: trimmed,
          slug,
          description: catData.description || null,
        })
        .select()
        .single();
      if (error) throw raiseDbError(error, 'Failed to create category.');
      newCat = {
        id: data.id,
        name: data.name,
        slug: data.slug || undefined,
        description: data.description || undefined,
      };
    } else {
      newCat = {
        id: `cat-${Date.now()}-${Math.floor(Math.random() * 100)}`,
        name: trimmed,
        slug,
        description: catData.description,
      };
    }

    setCategories(prev => [...prev, newCat]);
    addAuditLog('CATEGORY_CREATED', 'category', newCat.id, `Category created: ${newCat.name}`);
    return newCat;
  };

  const deleteCategory = async (id: string): Promise<void> => {
    const target = categories.find(c => c.id === id);
    if (!target) return;
    if (isSupabaseConfigured) {
      ensureCloudContext();
      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', id)
        .eq('business_id', activeBusinessId);
      if (error) throw raiseDbError(error, 'Failed to delete category.');
    }
    setCategories(prev => prev.filter(c => c.id !== id));
    addAuditLog('CATEGORY_DELETED', 'category', id, `Category deleted: ${target.name}`);
  };

  // Products CRUD (Database-first, returns DB product with real UUID)
  const addProduct = async (
    productData: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Product> => {
    const now = new Date().toISOString();
    const cleanName = (productData.name || '').trim();
    let code = (productData.code || '').trim() || `PRD-${Date.now().toString().slice(-4)}`;
    if (products.some(p => (p.code || '').toLowerCase() === code.toLowerCase())) {
      code = `${code}-${Math.floor(100 + Math.random() * 900)}`;
    }

    let barcode = productData.barcode?.trim() || `894${Math.floor(100000 + Math.random() * 900000)}`;
    if (products.some(p => (p.barcode || '').toLowerCase() === barcode.toLowerCase())) {
      barcode = `${barcode}${Math.floor(10 + Math.random() * 90)}`;
    }

    let cleanCategory = (productData.category || '').trim() || 'General';
    const existingCat = categories.find(c => c.name.toLowerCase() === cleanCategory.toLowerCase());
    if (existingCat) {
      cleanCategory = existingCat.name;
    } else {
      const createdCat = await addCategory({ name: cleanCategory });
      cleanCategory = createdCat.name;
    }

    const normalizedVariants =
      productData.hasVariants && Array.isArray(productData.variants)
        ? productData.variants.map((v, idx) => ({
            ...v,
            sku: (v.sku || '').trim() || `${code}-V${idx + 1}`,
            stock: Math.max(0, Number(v.stock) || 0),
          }))
        : undefined;

    const normalizedStock =
      productData.hasVariants && normalizedVariants
        ? normalizedVariants.reduce((sum, v) => sum + v.stock, 0)
        : Math.max(0, Number(productData.currentStock) || 0);

    const normalizedPayload: Omit<Product, 'id' | 'createdAt' | 'updatedAt'> = {
      ...productData,
      name: cleanName,
      code,
      barcode,
      category: cleanCategory,
      purchasePrice: Math.max(0, Number(productData.purchasePrice) || 0),
      salePrice: Math.max(0, Number(productData.salePrice) || 0),
      currentStock: normalizedStock,
      minStockAlert: Math.max(1, Number(productData.minStockAlert) || 5),
      variants: normalizedVariants,
      isActive: productData.isActive !== false,
    };

    let createdProduct: Product;
    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        createdProduct = await productService.insertProduct(normalizedPayload, activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to save product to Supabase.');
      }
    } else {
      createdProduct = {
        ...normalizedPayload,
        id: `prod-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        createdAt: now,
        updatedAt: now,
      };
      if (createdProduct.currentStock > 0) {
        setStockMovements(prev => [
          {
            id: `sm-${Date.now()}-${createdProduct.id}`,
            productId: createdProduct.id,
            productName: createdProduct.name,
            date: now,
            type: 'adjustment',
            quantity: createdProduct.currentStock,
            previousStock: 0,
            newStock: createdProduct.currentStock,
            reference: createdProduct.code,
            branchId: activeBranchId || branches[0]?.id || 'branch-1',
            note: 'Opening stock on product creation',
          },
          ...prev,
        ]);
      }
    }

    setProducts(prev => [createdProduct, ...prev]);
    addAuditLog('PRODUCT_CREATED', 'product', createdProduct.id, `Product created: ${createdProduct.name} (${createdProduct.code})`);
    return createdProduct;
  };

  const updateProduct = async (id: string, productData: Partial<Product>): Promise<void> => {
    const nextPatch: Partial<Product> = { ...productData };
    if (nextPatch.name !== undefined) {
      nextPatch.name = nextPatch.name.trim();
    }
    if (nextPatch.code !== undefined) {
      nextPatch.code = nextPatch.code.trim();
    }
    if (nextPatch.barcode !== undefined) {
      nextPatch.barcode = nextPatch.barcode.trim();
    }
    if (nextPatch.category !== undefined) {
      const cleanCat = nextPatch.category.trim() || 'General';
      const existingCat = categories.find(c => c.name.toLowerCase() === cleanCat.toLowerCase());
      if (existingCat) {
        nextPatch.category = existingCat.name;
      } else {
        const createdCat = await addCategory({ name: cleanCat });
        nextPatch.category = createdCat.name;
      }
    }

    if (nextPatch.hasVariants === false) {
      nextPatch.variants = [];
    } else if (Array.isArray(nextPatch.variants)) {
      const normalizedVariants = nextPatch.variants.map((v, idx) => ({
        ...v,
        sku: (v.sku || '').trim() || `${nextPatch.code || 'PRD'}-V${idx + 1}`,
        stock: Math.max(0, Number(v.stock) || 0),
      }));
      nextPatch.variants = normalizedVariants;
      nextPatch.currentStock = normalizedVariants.reduce((sum, v) => sum + v.stock, 0);
    }

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        const updatedProd = await productService.updateProduct(id, nextPatch, activeBusinessId);
        setProducts(prev => prev.map(p => (p.id === id ? updatedProd : p)));
      } catch (err) {
        throw raiseDbError(err, 'Failed to update product in Supabase.');
      }
    } else {
      setProducts(prev =>
        prev.map(p => (p.id === id ? { ...p, ...nextPatch, updatedAt: new Date().toISOString() } : p))
      );
    }
    addAuditLog('PRODUCT_UPDATED', 'product', id, `Product updated (ID: ${id})`);
  };

  const deleteProduct = async (id: string, permanent: boolean = false): Promise<void> => {
    if (!isAdmin && !hasPermission('product_management', 'delete')) {
      addAuditLog('UNAUTHORIZED_DELETE_ATTEMPT', 'product', id, `Unauthorized delete attempt by (${currentUserRole})`);
      throw new Error('Permission denied: You do not have permission to delete products.');
    }

    const prod = products.find(p => p.id === id);
    if (!prod) return;

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        if (permanent) {
          await productService.permanentDeleteProduct(id, activeBusinessId);
        } else {
          await productService.softDeleteProduct(id, activeBusinessId);
        }
      } catch (err) {
        throw raiseDbError(err, 'Failed to delete product in Supabase.');
      }
    }

    if (permanent) {
      setProducts(prev => prev.filter(p => p.id !== id));
      addAuditLog('PRODUCT_DELETED', 'product', id, `Product permanently deleted: ${prod.name}`);
    } else {
      setProducts(prev =>
        prev.map(p => (p.id === id ? { ...p, isActive: false, updatedAt: new Date().toISOString() } : p))
      );
      addAuditLog('PRODUCT_DEACTIVATED', 'product', id, `Product archived: ${prod.name}`);
    }
  };

  // Helper: Account ID lookup
  const getAccountIdForMethod = (method: PaymentMethod): string => {
    const found = accounts.find(a => {
      if (method === 'cash') return a.accountType === 'cash';
      if (method === 'bkash' || method === 'nagad' || method === 'rocket') return a.accountType === 'mobile_bank';
      if (method === 'bank' || method === 'card') return a.accountType === 'bank';
      return false;
    });
    return found ? found.id : accounts[0]?.id || '';
  };

  // Sales & POS (Database-first atomic RPC execution)
  const recordSale = async (
    saleData: Omit<Sale, 'id' | 'invoiceNumber' | 'date' | 'status'>
  ): Promise<Sale> => {
    const now = new Date().toISOString();
    const invoiceNumber = generateInvoiceNumber('INV');
    const status: Sale['status'] =
      saleData.due <= 0 ? 'paid' : saleData.paid > 0 ? 'partial' : 'due';

    const currentSellerName =
      saleData.employeeName ||
      saleData.sellerName ||
      currentEmployee?.name ||
      user?.user_metadata?.full_name ||
      user?.email?.split('@')[0] ||
      (isAdmin ? 'Admin' : 'Staff');
    const currentSellerId = saleData.sellerId || user?.id;
    const currentEmployeeId = saleData.employeeId || currentEmployee?.id || user?.id;
    const currentEmployeeCode = saleData.employeeCode || currentEmployee?.employeeCode;

    const draftSale: Sale = {
      ...saleData,
      id: `sale-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      invoiceNumber,
      date: now,
      status,
      employeeId: currentEmployeeId,
      employeeCode: currentEmployeeCode,
      employeeName: currentSellerName,
      sellerId: currentSellerId,
      sellerName: currentSellerName,
      servedBy: saleData.servedBy || currentSellerName,
    };

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        const result = await salesService.completeSale(draftSale, activeBusinessId);
        const persistedSaleId = result.saleId || draftSale.id;
        const persistedInvoice = result.invoiceNumber || invoiceNumber;

        if (draftSale.appliedOffers && draftSale.appliedOffers.length > 0) {
          for (const appOffer of draftSale.appliedOffers) {
            await comboOfferService
              .recordOfferUsage(
                appOffer.offerId,
                persistedSaleId,
                persistedInvoice,
                appOffer.discountAmount,
                draftSale.total,
                draftSale.items.reduce((sum, it) => sum + (it.purchasePrice || 0) * it.quantity, 0),
                activeBusinessId,
                draftSale.branchId,
                draftSale.customerId,
                draftSale.customerName
              )
              .catch(err => console.warn('Offer usage tracking notice:', err));
          }
          const updatedOffers = await comboOfferService.fetchOffers(activeBusinessId).catch(() => comboOffers);
          setComboOffers(updatedOffers);
        }

        await refreshAfterSale(activeBusinessId);
        const canonicalSale: Sale = {
          ...draftSale,
          id: persistedSaleId,
          invoiceNumber: persistedInvoice,
        };

        setSellers(prevSellers =>
          prevSellers.map(s =>
            s.id === currentSellerId || s.fullName === currentSellerName || s.username === currentSellerName
              ? {
                  ...s,
                  totalSalesCount: (s.totalSalesCount || 0) + 1,
                  totalSalesAmount: (s.totalSalesAmount || 0) + canonicalSale.total,
                }
              : s
          )
        );

        addAuditLog(
          'SALE_CREATED',
          'sale',
          canonicalSale.id,
          `Sale completed: ${persistedInvoice}, Total: ৳${canonicalSale.total} by ${currentSellerName}`
        );
        logUserActivity(
          'SALE_CREATED',
          'pos_new_sale',
          'create',
          `Created invoice ${persistedInvoice} · Amount ৳${canonicalSale.total} · Discount ৳${canonicalSale.discount} · ${canonicalSale.paymentMethod.toUpperCase()}`,
          'sale',
          persistedInvoice
        );

        return canonicalSale;
      } catch (err) {
        throw raiseDbError(err, 'Failed to record sale transaction.');
      }
    }

    // Local offline fallback mode (when Supabase is not configured)
    const saleStockMoves: StockMovement[] = [];
    setProducts(prev =>
      prev.map(prod => {
        const matchedItems = draftSale.items.filter(it => it.productId === prod.id);
        if (matchedItems.length === 0) return prod;
        const soldQty = matchedItems.reduce((s, it) => s + it.quantity, 0);
        const nextStock = Math.max(0, prod.currentStock - soldQty);
        saleStockMoves.push({
          id: `sm-${Date.now()}-${prod.id}`,
          productId: prod.id,
          productName: prod.name,
          date: now,
          type: 'sale_out',
          quantity: -soldQty,
          previousStock: prod.currentStock,
          newStock: nextStock,
          reference: invoiceNumber,
          branchId: draftSale.branchId,
          note: `POS sale ${invoiceNumber}`,
        });
        let nextVariants = prod.variants;
        if (prod.hasVariants && prod.variants) {
          nextVariants = prod.variants.map(v => {
            const varSoldQty = matchedItems
              .filter(it => it.variantId === v.id)
              .reduce((s, it) => s + it.quantity, 0);
            return varSoldQty > 0 ? { ...v, stock: Math.max(0, v.stock - varSoldQty) } : v;
          });
        }
        return { ...prod, currentStock: nextStock, variants: nextVariants, updatedAt: now };
      })
    );
    if (saleStockMoves.length > 0) {
      setStockMovements(prev => [...saleStockMoves, ...prev]);
    }
    if (draftSale.customerId) {
      const custTarget = customers.find(c => c.id === draftSale.customerId);
      setCustomers(prev =>
        prev.map(c =>
          c.id === draftSale.customerId
            ? {
                ...c,
                totalPurchase: c.totalPurchase + draftSale.total,
                totalPaid: c.totalPaid + draftSale.paid,
                currentDue: c.currentDue + draftSale.due,
              }
            : c
        )
      );
      if (custTarget && draftSale.due > 0) {
        setCustomerTransactions(prev => [
          {
            id: `ctx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            customerId: custTarget.id,
            customerName: custTarget.name,
            date: now,
            type: 'sale_due',
            amount: draftSale.due,
            balanceAfter: custTarget.currentDue + draftSale.due,
            paymentMethod: draftSale.paymentMethod,
            referenceId: invoiceNumber,
            note: `Invoice ${invoiceNumber} due balance`,
          },
          ...prev,
        ]);
      }
    }
    if (draftSale.paid > 0) {
      const paymentMap = new Map<string, { amount: number; method: PaymentMethod }>();
      if (draftSale.payments && draftSale.payments.length > 0) {
        draftSale.payments.forEach(pmt => {
          if (pmt.amount > 0) {
            const accId = pmt.accountId || getAccountIdForMethod(pmt.method);
            if (accId) {
              const cur = paymentMap.get(accId);
              paymentMap.set(accId, { amount: (cur?.amount || 0) + pmt.amount, method: pmt.method });
            }
          }
        });
      } else {
        const targetAccId = getAccountIdForMethod(draftSale.paymentMethod);
        if (targetAccId) {
          paymentMap.set(targetAccId, { amount: draftSale.paid, method: draftSale.paymentMethod });
        }
      }
      if (paymentMap.size > 0) {
        const newAccTxs: AccountTransaction[] = [];
        accounts.forEach(a => {
          const delta = paymentMap.get(a.id);
          if (!delta) return;
          newAccTxs.push({
            id: `atx-${Date.now()}-${a.id}`,
            accountId: a.id,
            accountName: a.name,
            date: now,
            type: 'sale_payment',
            amount: delta.amount,
            balanceAfter: a.balance + delta.amount,
            referenceId: invoiceNumber,
            note: `POS Sale ${invoiceNumber} (${delta.method})`,
          });
        });
        setAccounts(prev =>
          prev.map(a => {
            const delta = paymentMap.get(a.id);
            return delta ? { ...a, balance: a.balance + delta.amount } : a;
          })
        );
        if (newAccTxs.length > 0) {
          setAccountTransactions(prev => [...newAccTxs, ...prev]);
        }
      }
    }
    if (draftSale.appliedOffers && draftSale.appliedOffers.length > 0) {
      const offerBizId = activeBusinessId || 'default-business';
      const totalCogs = draftSale.items.reduce((sum, it) => sum + (it.purchasePrice || 0) * it.quantity, 0);
      for (const appOffer of draftSale.appliedOffers) {
        await comboOfferService
          .recordOfferUsage(
            appOffer.offerId,
            draftSale.id,
            invoiceNumber,
            appOffer.discountAmount,
            draftSale.total,
            totalCogs,
            offerBizId,
            draftSale.branchId,
            draftSale.customerId,
            draftSale.customerName
          )
          .catch(() => {});
      }
      setComboOffers(prev =>
        prev.map(o => {
          const used = draftSale.appliedOffers?.some(a => a.offerId === o.id);
          if (!used) return o;
          const nextCount = (o.usageCount || 0) + 1;
          const isExpired = o.maxUsageLimit && nextCount >= o.maxUsageLimit;
          return {
            ...o,
            usageCount: nextCount,
            status: isExpired ? ('expired' as const) : o.status,
            updatedAt: now,
          };
        })
      );
    }

    setSellers(prevSellers =>
      prevSellers.map(s =>
        s.id === currentSellerId || s.fullName === currentSellerName || s.username === currentSellerName
          ? {
              ...s,
              totalSalesCount: (s.totalSalesCount || 0) + 1,
              totalSalesAmount: (s.totalSalesAmount || 0) + draftSale.total,
            }
          : s
      )
    );

    setSales(prev => [draftSale, ...prev]);
    addAuditLog(
      'SALE_CREATED',
      'sale',
      draftSale.id,
      `Sale completed: ${invoiceNumber}, Total: ৳${draftSale.total} by ${currentSellerName}`
    );
    logUserActivity(
      'SALE_CREATED',
      'pos_new_sale',
      'create',
      `Created invoice ${invoiceNumber} · Amount ৳${draftSale.total} · Discount ৳${draftSale.discount} · ${draftSale.paymentMethod.toUpperCase()}`,
      'sale',
      invoiceNumber
    );
    return draftSale;
  };

  // Quick Refund Sale
  const quickRefundSale = async (saleId: string, reason?: string): Promise<boolean> => {
    const sale = sales.find(s => s.id === saleId);
    if (!sale || sale.status === 'returned' || sale.status === 'voided') {
      return false;
    }

    const now = new Date().toISOString();
    const refundReason = reason || 'Full Customer Refund';

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await salesService.refundSale(saleId, { amount: sale.paid, reason: refundReason }, activeBusinessId);
        await refreshAfterSale(activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to process sale refund in Supabase.');
      }
    } else {
      const restockMoves: StockMovement[] = [];
      setProducts(prev =>
        prev.map(prod => {
          const matched = sale.items.filter(it => it.productId === prod.id);
          if (matched.length === 0) return prod;
          const restoreQty = matched.reduce((s, it) => s + it.quantity, 0);
          const nextStock = prod.currentStock + restoreQty;
          restockMoves.push({
            id: `sm-${Date.now()}-${prod.id}`,
            productId: prod.id,
            productName: prod.name,
            date: now,
            type: 'sale_return',
            quantity: restoreQty,
            previousStock: prod.currentStock,
            newStock: nextStock,
            reference: sale.invoiceNumber,
            branchId: sale.branchId,
            note: `Refund ${sale.invoiceNumber}: ${refundReason}`,
          });
          let nextVariants = prod.variants;
          if (prod.hasVariants && prod.variants) {
            nextVariants = prod.variants.map(v => {
              const varQty = matched
                .filter(it => it.variantId === v.id)
                .reduce((s, it) => s + it.quantity, 0);
              return varQty > 0 ? { ...v, stock: v.stock + varQty } : v;
            });
          }
          return { ...prod, currentStock: nextStock, variants: nextVariants, updatedAt: now };
        })
      );
      if (restockMoves.length > 0) {
        setStockMovements(prev => [...restockMoves, ...prev]);
      }
      if (sale.customerId) {
        const custTarget = customers.find(c => c.id === sale.customerId);
        setCustomers(prev =>
          prev.map(c =>
            c.id === sale.customerId
              ? {
                  ...c,
                  totalPurchase: Math.max(0, c.totalPurchase - sale.total),
                  totalPaid: Math.max(0, c.totalPaid - sale.paid),
                  currentDue: Math.max(0, c.currentDue - sale.due),
                }
              : c
          )
        );
        if (custTarget && sale.due > 0) {
          setCustomerTransactions(prev => [
            {
              id: `ctx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              customerId: custTarget.id,
              customerName: custTarget.name,
              date: now,
              type: 'return_adjustment',
              amount: sale.due,
              balanceAfter: Math.max(0, custTarget.currentDue - sale.due),
              referenceId: sale.invoiceNumber,
              note: `Refund reversal (${sale.invoiceNumber})`,
            },
            ...prev,
          ]);
        }
      }
      if (sale.paid > 0) {
        const refundMap = new Map<string, number>();
        if (sale.payments && sale.payments.length > 0) {
          sale.payments.forEach(pmt => {
            if (pmt.amount > 0) {
              const accId = pmt.accountId || getAccountIdForMethod(pmt.method);
              if (accId) refundMap.set(accId, (refundMap.get(accId) || 0) + pmt.amount);
            }
          });
        } else {
          const accId = getAccountIdForMethod(sale.paymentMethod);
          if (accId) refundMap.set(accId, sale.paid);
        }
        const refundTxs: AccountTransaction[] = [];
        accounts.forEach(a => {
          const amt = refundMap.get(a.id);
          if (!amt) return;
          refundTxs.push({
            id: `atx-${Date.now()}-${a.id}`,
            accountId: a.id,
            accountName: a.name,
            date: now,
            type: 'refund',
            amount: -amt,
            balanceAfter: Math.max(0, a.balance - amt),
            referenceId: sale.invoiceNumber,
            note: `Sale refund ${sale.invoiceNumber}`,
          });
        });
        setAccounts(prev =>
          prev.map(a => {
            const amt = refundMap.get(a.id);
            return amt ? { ...a, balance: Math.max(0, a.balance - amt) } : a;
          })
        );
        if (refundTxs.length > 0) {
          setAccountTransactions(prev => [...refundTxs, ...prev]);
        }
      }
      setSales(prev =>
        prev.map(s =>
          s.id === saleId ? { ...s, status: 'returned', refundedAmount: sale.paid, refundReason, refundedAt: now } : s
        )
      );
    }

    addAuditLog('SALE_REFUNDED', 'sale', sale.id, `Sale refunded: ${sale.invoiceNumber}`);
    return true;
  };

  const voidSale = async (saleId: string, reason?: string): Promise<boolean> => {
    const sale = sales.find(s => s.id === saleId);
    if (!sale || sale.status === 'returned' || sale.status === 'voided') {
      return false;
    }
    const voidReason = reason || 'Void Sale';

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await salesService.voidSale(saleId, voidReason, activeBusinessId);
        await refreshAfterSale(activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to void sale invoice in Supabase.');
      }
    } else {
      const now = new Date().toISOString();
      const restockMoves: StockMovement[] = [];
      setProducts(prev =>
        prev.map(prod => {
          const matched = sale.items.filter(it => it.productId === prod.id);
          if (matched.length === 0) return prod;
          const restoreQty = matched.reduce((s, it) => s + it.quantity, 0);
          const nextStock = prod.currentStock + restoreQty;
          restockMoves.push({
            id: `sm-${Date.now()}-${prod.id}`,
            productId: prod.id,
            productName: prod.name,
            date: now,
            type: 'sale_return',
            quantity: restoreQty,
            previousStock: prod.currentStock,
            newStock: nextStock,
            reference: sale.invoiceNumber,
            branchId: sale.branchId,
            note: `Voided ${sale.invoiceNumber}: ${voidReason}`,
          });
          let nextVariants = prod.variants;
          if (prod.hasVariants && prod.variants) {
            nextVariants = prod.variants.map(v => {
              const varQty = matched
                .filter(it => it.variantId === v.id)
                .reduce((s, it) => s + it.quantity, 0);
              return varQty > 0 ? { ...v, stock: v.stock + varQty } : v;
            });
          }
          return { ...prod, currentStock: nextStock, variants: nextVariants, updatedAt: now };
        })
      );
      if (restockMoves.length > 0) {
        setStockMovements(prev => [...restockMoves, ...prev]);
      }
      if (sale.customerId) {
        const custTarget = customers.find(c => c.id === sale.customerId);
        setCustomers(prev =>
          prev.map(c =>
            c.id === sale.customerId
              ? {
                  ...c,
                  totalPurchase: Math.max(0, c.totalPurchase - sale.total),
                  totalPaid: Math.max(0, c.totalPaid - sale.paid),
                  currentDue: Math.max(0, c.currentDue - sale.due),
                }
              : c
          )
        );
        if (custTarget && sale.due > 0) {
          setCustomerTransactions(prev => [
            {
              id: `ctx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              customerId: custTarget.id,
              customerName: custTarget.name,
              date: now,
              type: 'return_adjustment',
              amount: sale.due,
              balanceAfter: Math.max(0, custTarget.currentDue - sale.due),
              referenceId: sale.invoiceNumber,
              note: `Voided invoice ${sale.invoiceNumber}`,
            },
            ...prev,
          ]);
        }
      }
      if (sale.paid > 0) {
        const refundMap = new Map<string, number>();
        if (sale.payments && sale.payments.length > 0) {
          sale.payments.forEach(pmt => {
            if (pmt.amount > 0) {
              const accId = pmt.accountId || getAccountIdForMethod(pmt.method);
              if (accId) refundMap.set(accId, (refundMap.get(accId) || 0) + pmt.amount);
            }
          });
        } else {
          const accId = getAccountIdForMethod(sale.paymentMethod);
          if (accId) refundMap.set(accId, sale.paid);
        }
        const refundTxs: AccountTransaction[] = [];
        accounts.forEach(a => {
          const amt = refundMap.get(a.id);
          if (!amt) return;
          refundTxs.push({
            id: `atx-${Date.now()}-${a.id}`,
            accountId: a.id,
            accountName: a.name,
            date: now,
            type: 'refund',
            amount: -amt,
            balanceAfter: Math.max(0, a.balance - amt),
            referenceId: sale.invoiceNumber,
            note: `Void invoice ${sale.invoiceNumber}`,
          });
        });
        setAccounts(prev =>
          prev.map(a => {
            const amt = refundMap.get(a.id);
            return amt ? { ...a, balance: Math.max(0, a.balance - amt) } : a;
          })
        );
        if (refundTxs.length > 0) {
          setAccountTransactions(prev => [...refundTxs, ...prev]);
        }
      }
      setSales(prev =>
        prev.map(s =>
          s.id === saleId ? { ...s, status: 'voided', refundedAmount: sale.paid, refundReason: voidReason, refundedAt: now } : s
        )
      );
    }

    addAuditLog('SALE_VOIDED', 'sale', sale.id, `Sale voided: ${sale.invoiceNumber}`);
    return true;
  };

  const recordSaleReturn = async (
    saleId: string,
    returnItems: { productId: string; variantId?: string; quantity: number; unitPrice: number; reason: string }[],
    refundType: 'cash' | 'adjust_due'
  ): Promise<void> => {
    const sale = sales.find(s => s.id === saleId);
    if (!sale) return;

    const totalRefund = returnItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const now = new Date().toISOString();

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        const mappedItems = returnItems.map(it => {
          const saleItem = sale.items.find(
            si => si.productId === it.productId && (!it.variantId || si.variantId === it.variantId)
          );
          return {
            productId: it.productId,
            productName: saleItem?.productName || 'Item',
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            totalRefund: it.quantity * it.unitPrice,
            reason: it.reason,
          };
        });
        await salesService.recordPartialReturn(saleId, mappedItems, refundType, activeBusinessId);
        await refreshAfterSale(activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to record sale return in Supabase.');
      }
    } else {
      const restockMoves: StockMovement[] = [];
      setProducts(prev =>
        prev.map(prod => {
          const matched = returnItems.filter(it => it.productId === prod.id);
          if (matched.length === 0) return prod;
          const retQty = matched.reduce((s, it) => s + it.quantity, 0);
          const nextStock = prod.currentStock + retQty;
          restockMoves.push({
            id: `sm-${Date.now()}-${prod.id}`,
            productId: prod.id,
            productName: prod.name,
            date: now,
            type: 'sale_return',
            quantity: retQty,
            previousStock: prod.currentStock,
            newStock: nextStock,
            reference: sale.invoiceNumber,
            branchId: sale.branchId,
            note: `Partial return (${sale.invoiceNumber})`,
          });
          let nextVariants = prod.variants;
          if (prod.hasVariants && prod.variants) {
            nextVariants = prod.variants.map(v => {
              const varRetQty = matched
                .filter(it => it.variantId === v.id)
                .reduce((s, it) => s + it.quantity, 0);
              return varRetQty > 0 ? { ...v, stock: v.stock + varRetQty } : v;
            });
          }
          return { ...prod, currentStock: nextStock, variants: nextVariants, updatedAt: now };
        })
      );
      if (restockMoves.length > 0) {
        setStockMovements(prev => [...restockMoves, ...prev]);
      }

      if (refundType === 'adjust_due' && sale.customerId) {
        const custTarget = customers.find(c => c.id === sale.customerId);
        const nextCustomerDue = custTarget ? Math.max(0, custTarget.currentDue - totalRefund) : 0;
        setCustomers(prev =>
          prev.map(c =>
            c.id === sale.customerId
              ? { ...c, currentDue: Math.max(0, c.currentDue - totalRefund) }
              : c
          )
        );
        if (custTarget && totalRefund > 0) {
          setCustomerTransactions(prev => [
            {
              id: `ctx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              customerId: custTarget.id,
              customerName: custTarget.name,
              date: now,
              type: 'return_adjustment',
              amount: totalRefund,
              balanceAfter: nextCustomerDue,
              referenceId: sale.invoiceNumber,
              note: `Return credit adjustment for ${sale.invoiceNumber}`,
            },
            ...prev,
          ]);
        }
      } else if (refundType === 'cash' && totalRefund > 0) {
        const targetAccId = getAccountIdForMethod(sale.paymentMethod === 'due' ? 'cash' : sale.paymentMethod);
        if (targetAccId) {
          const targetAcc = accounts.find(a => a.id === targetAccId);
          setAccounts(prev =>
            prev.map(a => (a.id === targetAccId ? { ...a, balance: Math.max(0, a.balance - totalRefund) } : a))
          );
          if (targetAcc) {
            setAccountTransactions(prev => [
              {
                id: `atx-${Date.now()}-${targetAcc.id}`,
                accountId: targetAcc.id,
                accountName: targetAcc.name,
                date: now,
                type: 'refund',
                amount: -totalRefund,
                balanceAfter: Math.max(0, targetAcc.balance - totalRefund),
                referenceId: sale.invoiceNumber,
                note: `Cash refund for ${sale.invoiceNumber}`,
              },
              ...prev,
            ]);
          }
        }
      }

      const cumulativeRefund = (sale.refundedAmount || 0) + totalRefund;
      const nextDue = refundType === 'adjust_due' ? Math.max(0, sale.due - totalRefund) : sale.due;
      const nextStatus: Sale['status'] =
        cumulativeRefund >= sale.total
          ? 'returned'
          : refundType === 'adjust_due' && nextDue === 0 && (sale.status === 'due' || sale.status === 'partial')
          ? 'paid'
          : sale.status;

      setSales(prev =>
        prev.map(s =>
          s.id === saleId
            ? {
                ...s,
                refundedAmount: cumulativeRefund,
                refundReason: returnItems[0]?.reason || s.refundReason,
                refundedAt: now,
                due: nextDue,
                status: nextStatus,
              }
            : s
        )
      );
    }

    addAuditLog('SALE_PARTIAL_RETURN', 'sale', sale.id, `Sale return: ${sale.invoiceNumber}, Refund: ৳${totalRefund}`);
  };

  // Purchases (Database-first atomic RPC create, update, delete)
  const recordPurchase = async (
    purchaseData: Omit<Purchase, 'id' | 'invoiceNumber' | 'date'> & { invoiceNumber?: string }
  ): Promise<Purchase> => {
    const now = new Date().toISOString();
    const invoiceNumber =
      purchaseData.invoiceNumber && purchaseData.invoiceNumber.trim()
        ? purchaseData.invoiceNumber.trim()
        : generateInvoiceNumber('PUR');

    const newPurchase: Purchase = {
      ...purchaseData,
      id: `pur-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      invoiceNumber,
      date: now,
    };

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        const result = await purchaseService.completePurchase(newPurchase, activeBusinessId);
        await refreshAfterPurchase(activeBusinessId);
        const canonicalPurchase = {
          ...newPurchase,
          id: result.purchaseId || newPurchase.id,
        };
        addAuditLog('PURCHASE_CREATED', 'purchase', canonicalPurchase.id, `Purchase received: ${invoiceNumber}`);
        return canonicalPurchase;
      } catch (err) {
        throw raiseDbError(err, 'Failed to record purchase in Supabase.');
      }
    }

    const purchaseMoves: StockMovement[] = [];
    setProducts(prev =>
      prev.map(prod => {
        const matched = newPurchase.items.filter(it => it.productId === prod.id);
        if (matched.length === 0) return prod;
        const addedQty = matched.reduce((s, it) => s + it.quantity, 0);
        const lastItem = matched[matched.length - 1];
        const nextStock = prod.currentStock + addedQty;
        purchaseMoves.push({
          id: `sm-${Date.now()}-${prod.id}`,
          productId: prod.id,
          productName: prod.name,
          date: now,
          type: 'purchase_in',
          quantity: addedQty,
          previousStock: prod.currentStock,
          newStock: nextStock,
          reference: invoiceNumber,
          branchId: newPurchase.branchId,
          note: `Purchase bill ${invoiceNumber}`,
        });
        let nextVariants = prod.variants;
        if (prod.hasVariants && prod.variants) {
          nextVariants = prod.variants.map(v => {
            const varAdd = matched
              .filter(it => it.variantId === v.id)
              .reduce((s, it) => s + it.quantity, 0);
            return varAdd > 0 ? { ...v, stock: v.stock + varAdd } : v;
          });
        }
        return {
          ...prod,
          currentStock: nextStock,
          purchasePrice: lastItem.purchasePrice,
          variants: nextVariants,
          updatedAt: now,
        };
      })
    );
    if (purchaseMoves.length > 0) {
      setStockMovements(prev => [...purchaseMoves, ...prev]);
    }

    const suppTarget = suppliers.find(s => s.id === newPurchase.supplierId);
    setSuppliers(prev =>
      prev.map(s =>
        s.id === newPurchase.supplierId
          ? {
              ...s,
              totalPurchase: s.totalPurchase + newPurchase.total,
              totalPaid: s.totalPaid + newPurchase.paid,
              currentDue: s.currentDue + newPurchase.due,
            }
          : s
      )
    );
    if (suppTarget && newPurchase.due > 0) {
      setSupplierTransactions(prev => [
        {
          id: `stx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          supplierId: suppTarget.id,
          supplierName: suppTarget.company || suppTarget.name,
          date: now,
          type: 'purchase_due',
          amount: newPurchase.due,
          balanceAfter: suppTarget.currentDue + newPurchase.due,
          paymentMethod: newPurchase.paymentMethod,
          referenceId: invoiceNumber,
          note: `Purchase ${invoiceNumber} payable due`,
        },
        ...prev,
      ]);
    }
    if (newPurchase.paid > 0) {
      const targetAccId = getAccountIdForMethod(newPurchase.paymentMethod);
      const targetAcc = accounts.find(acc => acc.id === targetAccId);
      const nextBalance = targetAcc ? Math.max(0, targetAcc.balance - newPurchase.paid) : 0;
      setAccounts(prev =>
        prev.map(acc => (acc.id === targetAccId ? { ...acc, balance: Math.max(0, acc.balance - newPurchase.paid) } : acc))
      );
      if (targetAcc) {
        setAccountTransactions(prev => [
          {
            id: `atx-${Date.now()}-${targetAcc.id}`,
            accountId: targetAcc.id,
            accountName: targetAcc.name,
            date: now,
            type: 'purchase_payment',
            amount: -newPurchase.paid,
            balanceAfter: nextBalance,
            referenceId: invoiceNumber,
            note: `Purchase payment ${invoiceNumber} (${newPurchase.paymentMethod})`,
          },
          ...prev,
        ]);
      }
    }
    setPurchases(prev => [newPurchase, ...prev]);
    addAuditLog('PURCHASE_CREATED', 'purchase', newPurchase.id, `Purchase received: ${invoiceNumber}`);
    return newPurchase;
  };

  const updatePurchase = async (
    purchaseId: string,
    purchaseData: Omit<Purchase, 'id' | 'date'>
  ): Promise<void> => {
    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await purchaseService.updatePurchase(purchaseId, purchaseData, activeBusinessId);
        await refreshAfterPurchase(activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to update purchase bill in Supabase.');
      }
    } else {
      const existing = purchases.find(p => p.id === purchaseId);
      const now = new Date().toISOString();
      if (existing) {
        const editStockMoves: StockMovement[] = [];
        setProducts(prev =>
          prev.map(prod => {
            const oldMatched = existing.items.filter(it => it.productId === prod.id);
            const oldQty = oldMatched.reduce((s, it) => s + it.quantity, 0);
            const newMatched = purchaseData.items.filter(it => it.productId === prod.id);
            const newQty = newMatched.reduce((s, it) => s + it.quantity, 0);
            const delta = newQty - oldQty;
            if (delta === 0 && newMatched.length === 0) return prod;
            const nextStock = Math.max(0, prod.currentStock + delta);
            if (delta !== 0) {
              editStockMoves.push({
                id: `sm-${Date.now()}-${prod.id}`,
                productId: prod.id,
                productName: prod.name,
                date: now,
                type: delta > 0 ? 'purchase_in' : 'adjustment',
                quantity: delta,
                previousStock: prod.currentStock,
                newStock: nextStock,
                reference: purchaseData.invoiceNumber,
                branchId: purchaseData.branchId,
                note: `Purchase bill updated (${purchaseData.invoiceNumber})`,
              });
            }
            let nextVariants = prod.variants;
            if (prod.hasVariants && prod.variants) {
              nextVariants = prod.variants.map(v => {
                const oldVQty = oldMatched.filter(it => it.variantId === v.id).reduce((s, it) => s + it.quantity, 0);
                const newVQty = newMatched.filter(it => it.variantId === v.id).reduce((s, it) => s + it.quantity, 0);
                const vDelta = newVQty - oldVQty;
                return vDelta !== 0 ? { ...v, stock: Math.max(0, v.stock + vDelta) } : v;
              });
            }
            return {
              ...prod,
              currentStock: nextStock,
              variants: nextVariants,
              purchasePrice: newMatched.length > 0 ? newMatched[newMatched.length - 1].purchasePrice : prod.purchasePrice,
              updatedAt: now,
            };
          })
        );
        if (editStockMoves.length > 0) {
          setStockMovements(prev => [...editStockMoves, ...prev]);
        }
        setSuppliers(prev =>
          prev.map(s => {
            if (s.id === existing.supplierId && s.id === purchaseData.supplierId) {
              return {
                ...s,
                totalPurchase: Math.max(0, s.totalPurchase - existing.total + purchaseData.total),
                totalPaid: Math.max(0, s.totalPaid - existing.paid + purchaseData.paid),
                currentDue: Math.max(0, s.currentDue - existing.due + purchaseData.due),
              };
            }
            if (s.id === existing.supplierId) {
              return {
                ...s,
                totalPurchase: Math.max(0, s.totalPurchase - existing.total),
                totalPaid: Math.max(0, s.totalPaid - existing.paid),
                currentDue: Math.max(0, s.currentDue - existing.due),
              };
            }
            if (s.id === purchaseData.supplierId) {
              return {
                ...s,
                totalPurchase: s.totalPurchase + purchaseData.total,
                totalPaid: s.totalPaid + purchaseData.paid,
                currentDue: s.currentDue + purchaseData.due,
              };
            }
            return s;
          })
        );
        const oldAccId = existing.paid > 0 ? getAccountIdForMethod(existing.paymentMethod) : '';
        const newAccId = purchaseData.paid > 0 ? getAccountIdForMethod(purchaseData.paymentMethod) : '';
        if (oldAccId || newAccId) {
          const editAccTxs: AccountTransaction[] = [];
          setAccounts(prev =>
            prev.map(acc => {
              let bal = acc.balance;
              if (acc.id === oldAccId) bal += existing.paid;
              if (acc.id === newAccId) bal = Math.max(0, bal - purchaseData.paid);
              if (bal !== acc.balance) {
                const netDelta = bal - acc.balance;
                editAccTxs.push({
                  id: `atx-${Date.now()}-${acc.id}`,
                  accountId: acc.id,
                  accountName: acc.name,
                  date: now,
                  type: 'supplier_payment',
                  amount: netDelta,
                  balanceAfter: bal,
                  referenceId: purchaseData.invoiceNumber,
                  note: `Purchase ${purchaseData.invoiceNumber} payment updated`,
                });
                return { ...acc, balance: bal };
              }
              return acc;
            })
          );
          if (editAccTxs.length > 0) {
            setAccountTransactions(prev => [...editAccTxs, ...prev]);
          }
        }
      }
      setPurchases(prev => prev.map(p => (p.id === purchaseId ? { ...p, ...purchaseData } : p)));
    }
    addAuditLog('PURCHASE_UPDATED', 'purchase', purchaseId, `Purchase updated: ${purchaseData.invoiceNumber}`);
  };

  const recordPurchaseReturn = async (
    purchaseId: string,
    returnItems: { productId: string; quantity: number; unitPrice: number; reason: string }[]
  ): Promise<void> => {
    const purchase = purchases.find(p => p.id === purchaseId);
    if (!purchase) return;

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        for (const item of returnItems) {
          await inventoryService.adjustStock(
            item.productId,
            -Math.abs(item.quantity),
            'inventory_correction',
            activeBusinessId,
            activeBranchId,
            `Purchase return (${purchase.invoiceNumber}): ${item.reason}`
          );
        }
        await refreshAfterPurchase(activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to record purchase return in Supabase.');
      }
    } else {
      const now = new Date().toISOString();
      const totalReturnAmount = returnItems.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
      const purRetMoves: StockMovement[] = [];
      setProducts(prev =>
        prev.map(prod => {
          const item = returnItems.find(it => it.productId === prod.id);
          if (!item) return prod;
          const nextStock = Math.max(0, prod.currentStock - item.quantity);
          purRetMoves.push({
            id: `sm-${Date.now()}-${prod.id}`,
            productId: prod.id,
            productName: prod.name,
            date: now,
            type: 'purchase_return',
            quantity: -Math.abs(item.quantity),
            previousStock: prod.currentStock,
            newStock: nextStock,
            reference: purchase.invoiceNumber,
            branchId: purchase.branchId || activeBranchId,
            note: `Purchase return (${purchase.invoiceNumber}): ${item.reason}`,
          });
          return { ...prod, currentStock: nextStock, updatedAt: now };
        })
      );
      if (purRetMoves.length > 0) {
        setStockMovements(prev => [...purRetMoves, ...prev]);
      }

      if (purchase.supplierId && totalReturnAmount > 0) {
        const suppTarget = suppliers.find(s => s.id === purchase.supplierId);
        const nextDue = suppTarget ? Math.max(0, suppTarget.currentDue - totalReturnAmount) : 0;
        setSuppliers(prev =>
          prev.map(s =>
            s.id === purchase.supplierId
              ? {
                  ...s,
                  totalPurchase: Math.max(0, s.totalPurchase - totalReturnAmount),
                  currentDue: Math.max(0, s.currentDue - totalReturnAmount),
                }
              : s
          )
        );
        if (suppTarget) {
          setSupplierTransactions(prev => [
            {
              id: `stx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              supplierId: suppTarget.id,
              supplierName: suppTarget.company || suppTarget.name,
              date: now,
              type: 'return_adjustment',
              amount: totalReturnAmount,
              balanceAfter: nextDue,
              referenceId: purchase.invoiceNumber,
              note: `Purchase return credit (${purchase.invoiceNumber})`,
            },
            ...prev,
          ]);
        }
      }
    }

    addAuditLog('PURCHASE_RETURN', 'purchase', purchase.id, `Purchase return recorded: ${purchase.invoiceNumber}`);
  };

  // Stock Adjustment
  const adjustStock = async (
    productId: string,
    adjustedQty: number,
    reason: StockAdjustment['reason'],
    note?: string,
    variantId?: string
  ): Promise<void> => {
    const prod = products.find(p => p.id === productId);
    if (!prod) return;

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await inventoryService.adjustStock(productId, adjustedQty, reason, activeBusinessId, activeBranchId, note);
        const [prods, moves] = await Promise.all([
          productService.fetchProducts(activeBusinessId),
          inventoryService.fetchStockMovements(activeBusinessId),
        ]);
        setProducts(prods);
        setStockMovements(moves);
      } catch (err) {
        throw raiseDbError(err, 'Failed to adjust stock in Supabase.');
      }
    } else {
      const now = new Date().toISOString();
      const prevStock = prod.currentStock;
      const nextStock = Math.max(0, prevStock + adjustedQty);
      setProducts(prev =>
        prev.map(p => {
          if (p.id !== productId) return p;
          let nextVariants = p.variants;
          if (variantId && p.hasVariants && p.variants) {
            nextVariants = p.variants.map(v =>
              v.id === variantId ? { ...v, stock: Math.max(0, v.stock + adjustedQty) } : v
            );
          }
          return { ...p, currentStock: nextStock, variants: nextVariants, updatedAt: now };
        })
      );
      setStockMovements(prev => [
        {
          id: `sm-${Date.now()}`,
          productId,
          productName: prod.name,
          date: now,
          type: 'adjustment',
          quantity: adjustedQty,
          previousStock: prevStock,
          newStock: nextStock,
          branchId: activeBranchId,
          note: `Manual adjustment (${reason}): ${note || ''}`,
        },
        ...prev,
      ]);
      setStockAdjustments(prev => [
        {
          id: `adj-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          productId,
          productName: prod.name,
          date: now,
          adjustedQty,
          reason,
          note: note || undefined,
          adjustedBy: currentEmployee?.name || user?.user_metadata?.full_name || currentUserRole || 'Admin',
        },
        ...prev,
      ]);
    }

    addAuditLog('STOCK_ADJUSTMENT', 'stock', productId, `Stock adjusted: ${prod.name} (${adjustedQty > 0 ? '+' : ''}${adjustedQty})`);
  };

  // Stock Transfer between branches
  const transferStock = async (
    productId: string,
    quantity: number,
    fromBranchId: string,
    toBranchId: string,
    note?: string
  ): Promise<void> => {
    const prod = products.find(p => p.id === productId);
    if (!prod) return;

    const fromBranch = branches.find(b => b.id === fromBranchId);
    const toBranch = branches.find(b => b.id === toBranchId);

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await inventoryService.transferBranchStock(
          productId,
          quantity,
          fromBranchId,
          toBranchId,
          activeBusinessId,
          note
        );
        const [moves, transfers] = await Promise.all([
          inventoryService.fetchStockMovements(activeBusinessId),
          inventoryService.fetchStockTransfers(activeBusinessId),
        ]);
        setStockMovements(moves);
        setStockTransfers(transfers);
      } catch (err) {
        throw raiseDbError(err, 'Failed to record stock transfer in Supabase.');
      }
    } else {
      const now = new Date().toISOString();
      const transfer: StockTransfer = {
        id: `tf-${Date.now()}`,
        date: now,
        productId,
        productName: prod.name,
        quantity,
        fromBranchId,
        fromBranchName: fromBranch?.name || fromBranchId,
        toBranchId,
        toBranchName: toBranch?.name || toBranchId,
        transferredBy: currentEmployee?.name || currentUserRole,
        note,
      };
      setStockTransfers(prev => [transfer, ...prev]);
      setStockMovements(prev => [
        {
          id: `sm-${Date.now()}-tf`,
          productId,
          productName: prod.name,
          date: now,
          type: 'transfer',
          quantity,
          previousStock: prod.currentStock,
          newStock: prod.currentStock,
          reference: transfer.id,
          branchId: fromBranchId,
          note: `Transfer: ${fromBranch?.name || fromBranchId} → ${toBranch?.name || toBranchId}${note ? ` (${note})` : ''}`,
        },
        ...prev,
      ]);
    }

    addAuditLog(
      'STOCK_TRANSFER',
      'stock',
      productId,
      `Branch transfer: ${prod.name} (${quantity} ${prod.unit}) from ${fromBranch?.name} to ${toBranch?.name}`
    );
  };

  // Customers (Database-first)
  const addCustomer = async (
    data: Omit<Customer, 'id' | 'createdAt' | 'currentDue' | 'totalPurchase' | 'totalPaid' | 'openingDue'> & {
      openingDue?: number;
    }
  ): Promise<Customer> => {
    let createdCustomer: Customer;
    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        createdCustomer = await customerService.insertCustomer(data, activeBusinessId);
        const custTxs = await customerService.fetchCustomerTransactions(activeBusinessId).catch(() => customerTransactions);
        setCustomerTransactions(custTxs);
      } catch (err) {
        throw raiseDbError(err, 'Failed to create customer in Supabase.');
      }
    } else {
      const opDue = data.openingDue || 0;
      const now = new Date().toISOString();
      createdCustomer = {
        ...data,
        id: `cust-${Date.now()}`,
        openingDue: opDue,
        currentDue: opDue,
        totalPurchase: opDue,
        totalPaid: 0,
        createdAt: now,
      };
      if (opDue > 0) {
        setCustomerTransactions(prev => [
          {
            id: `ctx-open-${Date.now()}`,
            customerId: createdCustomer.id,
            customerName: createdCustomer.name,
            date: now,
            type: 'opening',
            amount: opDue,
            balanceAfter: opDue,
            note: 'Opening balance due',
          },
          ...prev,
        ]);
      }
    }

    setCustomers(prev => [createdCustomer, ...prev]);
    addAuditLog('CUSTOMER_CREATED', 'customer', createdCustomer.id, `New customer added: ${createdCustomer.name}`);
    return createdCustomer;
  };

  const updateCustomer = async (id: string, data: Partial<Customer>): Promise<void> => {
    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await customerService.updateCustomer(id, data, activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to update customer in Supabase.');
      }
    }
    setCustomers(prev => prev.map(c => (c.id === id ? { ...c, ...data } : c)));
    addAuditLog('CUSTOMER_UPDATED', 'customer', id, `Customer updated (ID: ${id})`);
  };

  const collectCustomerDue = async (
    customerId: string,
    amount: number,
    paymentMethod: PaymentMethod,
    accountId: string,
    note?: string
  ): Promise<void> => {
    const target = customers.find(c => c.id === customerId);
    if (!target) throw new Error('Customer record not found.');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Collection amount must be greater than zero.');
    if (amount > target.currentDue) throw new Error(`Collection amount cannot exceed customer due (৳${target.currentDue}).`);
    const resolvedAccountId = accountId || accounts[0]?.id || '';
    if (!resolvedAccountId) throw new Error('Please create or select a deposit account first.');

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await customerService.collectDue(customerId, amount, paymentMethod, resolvedAccountId, activeBusinessId, note);
        const [custs, custTxs, accs, accTxs] = await Promise.all([
          customerService.fetchCustomers(activeBusinessId),
          customerService.fetchCustomerTransactions(activeBusinessId).catch(() => []),
          financeService.fetchAccounts(activeBusinessId),
          financeService.fetchAccountTransactions(activeBusinessId).catch(() => []),
        ]);
        setCustomers(custs);
        setCustomerTransactions(custTxs);
        setAccounts(accs);
        setAccountTransactions(accTxs);
      } catch (err) {
        throw raiseDbError(err, 'Failed to collect customer due payment in Supabase.');
      }
    } else {
      const now = new Date().toISOString();
      const nextDue = Math.max(0, target.currentDue - amount);
      const targetAcc = accounts.find(acc => acc.id === resolvedAccountId);
      setCustomers(prev =>
        prev.map(c => (c.id === customerId ? { ...c, currentDue: nextDue, totalPaid: c.totalPaid + amount } : c))
      );
      setAccounts(prev =>
        prev.map(acc => (acc.id === resolvedAccountId ? { ...acc, balance: acc.balance + amount } : acc))
      );
      setCustomerTransactions(prev => [
        {
          id: `ctx-${Date.now()}`,
          customerId,
          customerName: target.name,
          date: now,
          type: 'due_collection',
          amount,
          balanceAfter: nextDue,
          paymentMethod,
          note: note || 'Due payment collection',
        },
        ...prev,
      ]);
      if (targetAcc) {
        setAccountTransactions(prev => [
          {
            id: `atx-${Date.now()}-${targetAcc.id}`,
            accountId: targetAcc.id,
            accountName: targetAcc.name,
            date: now,
            type: 'customer_payment',
            amount,
            balanceAfter: targetAcc.balance + amount,
            note: `Due collected from ${target.name} (${paymentMethod})${note ? `: ${note}` : ''}`,
          },
          ...prev,
        ]);
      }
    }

    addAuditLog('CUSTOMER_DUE_COLLECTED', 'customer', customerId, `Due payment collected from ${target.name}: ৳${amount}`);
  };

  // Suppliers (Database-first)
  const addSupplier = async (
    data: Omit<Supplier, 'id' | 'createdAt' | 'currentDue' | 'totalPurchase' | 'totalPaid' | 'openingDue'> & {
      openingDue?: number;
    }
  ): Promise<Supplier> => {
    let createdSupplier: Supplier;
    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        createdSupplier = await supplierService.insertSupplier(data, activeBusinessId);
        const suppTxs = await supplierService.fetchSupplierTransactions(activeBusinessId).catch(() => supplierTransactions);
        setSupplierTransactions(suppTxs);
      } catch (err) {
        throw raiseDbError(err, 'Failed to create supplier in Supabase.');
      }
    } else {
      const opDue = data.openingDue || 0;
      const now = new Date().toISOString();
      createdSupplier = {
        ...data,
        id: `supp-${Date.now()}`,
        openingDue: opDue,
        currentDue: opDue,
        totalPurchase: opDue,
        totalPaid: 0,
        createdAt: now,
      };
      if (opDue > 0) {
        setSupplierTransactions(prev => [
          {
            id: `stx-open-${Date.now()}`,
            supplierId: createdSupplier.id,
            supplierName: createdSupplier.company || createdSupplier.name,
            date: now,
            type: 'opening',
            amount: opDue,
            balanceAfter: opDue,
            note: 'Opening payable due',
          },
          ...prev,
        ]);
      }
    }

    setSuppliers(prev => [createdSupplier, ...prev]);
    addAuditLog('SUPPLIER_CREATED', 'supplier', createdSupplier.id, `Supplier created: ${createdSupplier.name}`);
    return createdSupplier;
  };

  const updateSupplier = async (id: string, data: Partial<Supplier>): Promise<void> => {
    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await supplierService.updateSupplier(id, data, activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to update supplier in Supabase.');
      }
    }
    setSuppliers(prev => prev.map(s => (s.id === id ? { ...s, ...data } : s)));
    addAuditLog('SUPPLIER_UPDATED', 'supplier', id, `Supplier updated (ID: ${id})`);
  };

  const paySupplierDue = async (
    supplierId: string,
    amount: number,
    paymentMethod: PaymentMethod,
    accountId: string,
    note?: string
  ): Promise<void> => {
    const target = suppliers.find(s => s.id === supplierId);
    if (!target) throw new Error('Supplier record not found.');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero.');
    if (amount > target.currentDue) throw new Error(`Payment amount cannot exceed payable due (৳${target.currentDue}).`);
    const resolvedAccountId = accountId || accounts[0]?.id || '';
    if (!resolvedAccountId) throw new Error('Please create or select a payment account first.');

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await supplierService.payDue(supplierId, amount, paymentMethod, resolvedAccountId, activeBusinessId, note);
        const [supps, suppTxs, accs, accTxs] = await Promise.all([
          supplierService.fetchSuppliers(activeBusinessId),
          supplierService.fetchSupplierTransactions(activeBusinessId).catch(() => []),
          financeService.fetchAccounts(activeBusinessId),
          financeService.fetchAccountTransactions(activeBusinessId).catch(() => []),
        ]);
        setSuppliers(supps);
        setSupplierTransactions(suppTxs);
        setAccounts(accs);
        setAccountTransactions(accTxs);
      } catch (err) {
        throw raiseDbError(err, 'Failed to record supplier payment in Supabase.');
      }
    } else {
      const now = new Date().toISOString();
      const nextDue = Math.max(0, target.currentDue - amount);
      const targetAcc = accounts.find(acc => acc.id === resolvedAccountId);
      setSuppliers(prev =>
        prev.map(s => (s.id === supplierId ? { ...s, currentDue: nextDue, totalPaid: s.totalPaid + amount } : s))
      );
      setAccounts(prev =>
        prev.map(acc => (acc.id === resolvedAccountId ? { ...acc, balance: Math.max(0, acc.balance - amount) } : acc))
      );
      setSupplierTransactions(prev => [
        {
          id: `stx-${Date.now()}`,
          supplierId,
          supplierName: target.company || target.name,
          date: now,
          type: 'due_payment',
          amount,
          balanceAfter: nextDue,
          paymentMethod,
          note: note || 'Supplier due payment',
        },
        ...prev,
      ]);
      if (targetAcc) {
        setAccountTransactions(prev => [
          {
            id: `atx-${Date.now()}-${targetAcc.id}`,
            accountId: targetAcc.id,
            accountName: targetAcc.name,
            date: now,
            type: 'supplier_payment',
            amount: -amount,
            balanceAfter: Math.max(0, targetAcc.balance - amount),
            note: `Paid supplier due to ${target.company || target.name} (${paymentMethod})${note ? `: ${note}` : ''}`,
          },
          ...prev,
        ]);
      }
    }

    addAuditLog('SUPPLIER_DUE_PAID', 'supplier', supplierId, `Supplier due paid: ${target.name}, ৳${amount}`);
  };

  // Accounts & Expenses Management
  const addAccount = async (accountData: Omit<Account, 'id'>): Promise<Account> => {
    let newAccount: Account;
    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        newAccount = await financeService.insertAccount(accountData, activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to create financial account.');
      }
    } else {
      newAccount = {
        ...accountData,
        id: `acc-${Date.now()}`,
        balance: Number(accountData.balance) || 0,
      };
    }
    setAccounts(prev => [...prev, newAccount]);
    addAuditLog('ACCOUNT_CREATED', 'account', newAccount.id, `Financial account added: ${newAccount.name} (${newAccount.accountType})`);
    return newAccount;
  };

  const updateAccount = async (id: string, updates: Partial<Account>): Promise<void> => {
    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await financeService.updateAccount(id, updates, activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to update financial account.');
      }
    }
    setAccounts(prev => prev.map(a => (a.id === id ? { ...a, ...updates } : a)));
    addAuditLog('ACCOUNT_UPDATED', 'account', id, `Account updated: ID ${id}`);
  };

  const deleteAccount = async (id: string): Promise<{ success: boolean; message?: string }> => {
    if (!enforcePermission('accounts_transactions', 'delete', 'Financial Account')) {
      return { success: false, message: 'Permission denied: You do not have permission to delete accounts.' };
    }
    const target = accounts.find(a => a.id === id);
    if (!target) {
      return { success: false, message: 'Account not found.' };
    }
    if (target.balance !== 0) {
      return {
        success: false,
        message: `Cannot delete account with an active balance (${target.balance}). Please transfer or adjust the balance to 0 first.`,
      };
    }
    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await financeService.deleteAccount(id, activeBusinessId);
      } catch (err) {
        return { success: false, message: formatSupabaseError(err, 'Failed to delete account.') };
      }
    }
    setAccounts(prev => prev.filter(a => a.id !== id));
    addAuditLog('ACCOUNT_DELETED', 'account', id, `Account deleted: ${target.name}`);
    return { success: true };
  };

  const addExpense = async (expenseData: Omit<Expense, 'id' | 'date'>): Promise<void> => {
    let createdExp: Expense;
    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        createdExp = await financeService.insertExpense(expenseData, activeBusinessId, activeBranchId);
        await refreshAfterFinance(activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to record expense in Supabase.');
      }
    } else {
      const now = new Date().toISOString();
      const targetAccId = expenseData.accountId || accounts[0]?.id || '';
      if (!targetAccId) throw new Error('Please create or select an account before recording an expense.');
      createdExp = {
        ...expenseData,
        accountId: targetAccId,
        id: `exp-${Date.now()}`,
        date: now,
      };
      const targetAcc = accounts.find(acc => acc.id === targetAccId);
      setExpenses(prev => [createdExp, ...prev]);
      setAccounts(prev =>
        prev.map(acc => (acc.id === targetAccId ? { ...acc, balance: acc.balance - expenseData.amount } : acc))
      );
      if (targetAcc) {
        setAccountTransactions(prev => [
          {
            id: `atx-${Date.now()}-${targetAcc.id}`,
            accountId: targetAcc.id,
            accountName: targetAcc.name,
            date: now,
            type: 'expense',
            amount: -expenseData.amount,
            balanceAfter: targetAcc.balance - expenseData.amount,
            note: `${expenseData.category} (${expenseData.paymentMethod})${expenseData.note ? `: ${expenseData.note}` : ''}`,
          },
          ...prev,
        ]);
      }
    }

    addAuditLog('EXPENSE_CREATED', 'expense', createdExp.id, `Expense recorded: ${createdExp.category}, ৳${createdExp.amount}`);
  };

  const transferMoney = async (
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    note?: string
  ): Promise<void> => {
    if (amount <= 0 || fromAccountId === toAccountId) {
      throw new Error('Select two different accounts and a valid positive transfer amount.');
    }

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await financeService.transferFunds(fromAccountId, toAccountId, amount, activeBusinessId, note);
        await refreshAfterFinance(activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to complete account fund transfer.');
      }
    } else {
      const now = new Date().toISOString();
      const fromAcc = accounts.find(a => a.id === fromAccountId);
      const toAcc = accounts.find(a => a.id === toAccountId);
      if (!fromAcc || !toAcc) throw new Error('Source or destination account not found.');
      if (fromAcc.balance < amount) throw new Error('Insufficient balance in source account.');
      setAccounts(prev =>
        prev.map(acc => {
          if (acc.id === fromAccountId) return { ...acc, balance: acc.balance - amount };
          if (acc.id === toAccountId) return { ...acc, balance: acc.balance + amount };
          return acc;
        })
      );
      setAccountTransactions(prev => [
        {
          id: `atx-in-${Date.now()}`,
          accountId: toAcc.id,
          accountName: toAcc.name,
          date: now,
          type: 'transfer_in',
          amount,
          balanceAfter: toAcc.balance + amount,
          note: `Transfer from ${fromAcc.name}${note ? `: ${note}` : ''}`,
        },
        {
          id: `atx-out-${Date.now()}`,
          accountId: fromAcc.id,
          accountName: fromAcc.name,
          date: now,
          type: 'transfer_out',
          amount: -amount,
          balanceAfter: fromAcc.balance - amount,
          note: `Transfer to ${toAcc.name}${note ? `: ${note}` : ''}`,
        },
        ...prev,
      ]);
    }

    addAuditLog('ACCOUNT_TRANSFER', 'account', `${fromAccountId}->${toAccountId}`, `Account transfer: ৳${amount}`);
  };

  // Employees
  const addEmployee = async (empData: Omit<Employee, 'id'>): Promise<void> => {
    let newEmp: Employee;
    if (isSupabaseConfigured) {
      ensureCloudContext();
      const { data, error } = await supabase
        .from('employees')
        .insert({
          business_id: activeBusinessId,
          branch_id: sanitizeUuid(empData.branchId || activeBranchId),
          name: empData.name,
          mobile: empData.mobile,
          position: empData.position,
          role: empData.role,
          role_key: normalizeRoleKey(empData.role),
          salary: empData.salary,
          joining_date: empData.joiningDate,
          status: empData.status,
          account_status: empData.accountStatus || empData.status || 'active',
        })
        .select()
        .single();
      if (error) throw raiseDbError(error, 'Failed to add employee.');
      newEmp = { ...empData, id: data.id };
    } else {
      newEmp = { ...empData, id: `emp-${Date.now()}` };
    }

    setEmployees(prev => [...prev, newEmp]);
    addAuditLog('EMPLOYEE_CREATED', 'employee', newEmp.id, `Employee added: ${newEmp.name}`);
  };

  const updateEmployee = async (id: string, empData: Partial<Employee>): Promise<void> => {
    if (isSupabaseConfigured && isValidUuid(id)) {
      ensureCloudContext();
      const { error } = await supabase
        .from('employees')
        .update({
          name: empData.name,
          mobile: empData.mobile,
          position: empData.position,
          salary: empData.salary,
          status: empData.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('business_id', activeBusinessId);
      if (error) throw raiseDbError(error, 'Failed to update employee.');
    }
    setEmployees(prev => prev.map(e => (e.id === id ? { ...e, ...empData } : e)));
    addAuditLog('EMPLOYEE_UPDATED', 'employee', id, `Employee updated (ID: ${id})`);
  };

  const disburseSalary = async (
    employeeId: string,
    month: string,
    accountId: string,
    amount: number
  ): Promise<void> => {
    const emp = employees.find(e => e.id === employeeId);
    if (!emp) return;

    await addExpense({
      category: 'Staff Salary',
      amount,
      paymentMethod: 'cash',
      accountId,
      paidTo: `${emp.name} (${emp.position})`,
      note: `Salary payment for ${month}`,
    });

    addAuditLog('SALARY_DISBURSED', 'employee', employeeId, `Salary disbursed to ${emp.name}, ${month}, ৳${amount}`);
  };

  // Sellers Management
  const reloadSellers = useCallback(async () => {
    if (activeBusinessId) {
      const loaded = await sellerService.fetchSellers(activeBusinessId, sales);
      setSellers(loaded);
    }
  }, [activeBusinessId, sales]);

  const addSeller = async (sellerData: {
    fullName: string;
    username: string;
    phone: string;
    email?: string;
    password: string;
    branchId?: string;
    branchName?: string;
    status: 'active' | 'inactive';
  }): Promise<Seller> => {
    const created = await sellerService.createSeller(sellerData, activeBusinessId);
    setSellers(prev => [created, ...prev.filter(s => s.id !== created.id)]);
    addAuditLog('SELLER_CREATED', 'seller', created.id, `Seller account created: ${created.fullName} (${created.username})`);
    return created;
  };

  const updateSeller = async (
    id: string,
    updates: { fullName?: string; phone?: string; branchId?: string; branchName?: string; status?: 'active' | 'inactive' }
  ) => {
    await sellerService.updateSeller(id, updates, activeBusinessId);
    setSellers(prev =>
      prev.map(s => (s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s))
    );
    addAuditLog('SELLER_UPDATED', 'seller', id, `Seller updated: ID ${id}`);
  };

  const toggleSellerStatus = async (id: string, status: 'active' | 'inactive') => {
    await sellerService.toggleSellerStatus(id, status, activeBusinessId);
    setSellers(prev =>
      prev.map(s => (s.id === id ? { ...s, status, updatedAt: new Date().toISOString() } : s))
    );
    addAuditLog('SELLER_STATUS_CHANGED', 'seller', id, `Seller status changed to ${status}`);
  };

  const resetSellerPassword = async (email: string, newPassword?: string) => {
    const res = await sellerService.resetPassword(email, newPassword);
    addAuditLog('SELLER_PASSWORD_RESET', 'seller', email, `Password reset initiated for seller ${email}`);
    return res;
  };

  // RBAC Staff & Role Management Actions
  const reloadRbacData = useCallback(async () => {
    const bizId = activeBusinessId || 'local';
    const [loadedRoles, loadedEmployees, loadedActivity] = await Promise.all([
      staffRbacService.fetchRolesAndPermissions(bizId),
      staffRbacService.fetchEmployees(bizId),
      staffRbacService.fetchActivityLogs(bizId),
    ]);
    setRoles(loadedRoles);
    setEmployees(loadedEmployees);
    setActivityLogs(loadedActivity);
  }, [activeBusinessId]);

  const createStaffAccount = async (payload: CreateEmployeePayload): Promise<Employee> => {
    if (!enforcePermission('user_management', 'create', 'Create Employee Account')) {
      throw new Error('Permission denied: Only authorized Admins can create staff accounts.');
    }
    const created = await staffRbacService.createEmployeeAccount(
      payload,
      activeBusinessId || 'local',
      user?.id
    );
    setEmployees(prev => [created, ...prev.filter(e => e.id !== created.id)]);
    addAuditLog(
      'EMPLOYEE_CREATED',
      'employee',
      created.id,
      `Staff account created: ${created.name} (${created.employeeCode}) · Role: ${created.roleName}`
    );
    logUserActivity(
      'EMPLOYEE_CREATED',
      'user_management',
      'create',
      `Created employee ${created.name} (${created.employeeCode || created.username}) with role ${created.roleName}`,
      'employee',
      created.id
    );
    if (normalizeRoleKey(created.roleKey) === 'salesman') {
      reloadSellers().catch(() => {});
    }
    return created;
  };

  const updateStaffAccount = async (employee: Employee, updates: UpdateEmployeePayload): Promise<void> => {
    if (!enforcePermission('user_management', 'edit', 'Edit Employee Account')) {
      throw new Error('Permission denied: You do not have permission to edit staff accounts.');
    }
    await staffRbacService.updateEmployeeAccount(employee, updates, activeBusinessId || 'local');
    setEmployees(prev =>
      prev.map(e => {
        if (e.id !== employee.id) return e;
        const nextStatus = updates.accountStatus || e.accountStatus || 'active';
        return {
          ...e,
          ...updates,
          status: nextStatus === 'active' ? 'active' : 'inactive',
          accountStatus: nextStatus,
          role: updates.roleKey ? roleKeyToLegacyUserRole(updates.roleKey) : e.role,
          updatedAt: new Date().toISOString(),
        };
      })
    );
    logUserActivity(
      'EMPLOYEE_UPDATED',
      'user_management',
      'edit',
      `Updated profile/role for ${employee.name} (${employee.employeeCode || employee.id})`,
      'employee',
      employee.id
    );
  };

  const changeStaffStatus = async (employee: Employee, newStatus: AccountStatus): Promise<void> => {
    if (!enforcePermission('user_management', 'edit', 'Change Employee Account Status')) {
      throw new Error('Permission denied: You do not have permission to change employee status.');
    }
    await staffRbacService.changeEmployeeStatus(employee, newStatus, activeBusinessId || 'local');
    setEmployees(prev =>
      prev.map(e =>
        e.id === employee.id
          ? {
              ...e,
              accountStatus: newStatus,
              status: newStatus === 'active' ? 'active' : 'inactive',
              updatedAt: new Date().toISOString(),
            }
          : e
      )
    );
    logUserActivity(
      'EMPLOYEE_STATUS_CHANGED',
      'user_management',
      'edit',
      `Changed account status of ${employee.name} (${employee.employeeCode || employee.username}) to ${newStatus.toUpperCase()}`,
      'employee',
      employee.id
    );
  };

  const resetStaffAccountPassword = async (
    employee: Employee,
    newPassword?: string
  ): Promise<{ success: boolean; message: string }> => {
    if (!enforcePermission('user_management', 'edit', 'Reset Employee Password')) {
      return { success: false, message: 'Permission denied: Only Admins can reset employee passwords.' };
    }
    const res = await staffRbacService.resetEmployeePassword(employee, newPassword);
    logUserActivity(
      'PASSWORD_RESET',
      'user_management',
      'edit',
      `Password reset triggered for ${employee.name} (${employee.employeeCode || employee.email})`,
      'employee',
      employee.id
    );
    return res;
  };

  const createCustomRole = async (
    name: string,
    description: string,
    permissions: RolePermissionMatrix
  ): Promise<RoleDefinition> => {
    if (!enforcePermission('user_management', 'create', 'Create Custom Role')) {
      throw new Error('Permission denied: Only Admins can create custom roles.');
    }
    const created = await staffRbacService.createCustomRole(
      { name, description, permissions },
      activeBusinessId || 'local'
    );
    setRoles(prev => [...prev, created]);
    logUserActivity('ROLE_CREATED', 'user_management', 'create', `Created custom role: ${created.name}`, 'role', created.id);
    return created;
  };

  const updateRolePermissionsMatrix = async (
    roleId: string,
    permissions: RolePermissionMatrix
  ): Promise<void> => {
    if (!enforcePermission('user_management', 'edit', 'Update Role Permissions')) {
      throw new Error('Permission denied: Only Admins can modify role permissions.');
    }
    const target = roles.find(r => r.id === roleId);
    await staffRbacService.saveRolePermissions(roleId, permissions, activeBusinessId || 'local');
    setRoles(prev =>
      prev.map(r => (r.id === roleId ? { ...r, permissions, updatedAt: new Date().toISOString() } : r))
    );
    logUserActivity(
      'ROLE_PERMISSIONS_UPDATED',
      'user_management',
      'edit',
      `Updated permission matrix for role: ${target?.name || roleId}`,
      'role',
      roleId
    );
  };

  const deleteCustomRole = async (roleId: string): Promise<{ success: boolean; message?: string }> => {
    if (!enforcePermission('user_management', 'delete', 'Delete Custom Role')) {
      return { success: false, message: 'Permission denied: You cannot delete roles.' };
    }
    const target = roles.find(r => r.id === roleId);
    if (!target) return { success: false, message: 'Role not found.' };
    if (target.isSystemRole) {
      return { success: false, message: 'Default system roles cannot be deleted.' };
    }
    const assignedCount = employees.filter(e => e.roleId === roleId || e.roleKey === target.roleKey).length;
    if (assignedCount > 0) {
      return {
        success: false,
        message: `Cannot delete role "${target.name}" while ${assignedCount} employee(s) are assigned to it.`,
      };
    }
    await staffRbacService.deleteCustomRole(roleId, activeBusinessId || 'local');
    setRoles(prev => prev.filter(r => r.id !== roleId));
    logUserActivity('ROLE_DELETED', 'user_management', 'delete', `Deleted custom role: ${target.name}`, 'role', roleId);
    return { success: true };
  };

  // Protected Financial & Record Deletions (Atomic DB-first reversal)
  const deleteSale = async (saleId: string): Promise<boolean> => {
    if (!enforcePermission('sales_history', 'delete', `Sale #${saleId}`)) return false;
    const target = sales.find(s => s.id === saleId);

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await salesService.deleteSale(saleId, activeBusinessId);
        await refreshAfterSale(activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to delete sale invoice in Supabase.');
      }
    } else {
      if (target && target.status !== 'returned' && target.status !== 'voided') {
        const now = new Date().toISOString();
        setProducts(prev =>
          prev.map(prod => {
            const matched = target.items.filter(it => it.productId === prod.id);
            if (matched.length === 0) return prod;
            const restoreQty = matched.reduce((s, it) => s + it.quantity, 0);
            let nextVariants = prod.variants;
            if (prod.hasVariants && prod.variants) {
              nextVariants = prod.variants.map(v => {
                const varQty = matched
                  .filter(it => it.variantId === v.id)
                  .reduce((s, it) => s + it.quantity, 0);
                return varQty > 0 ? { ...v, stock: v.stock + varQty } : v;
              });
            }
            return { ...prod, currentStock: prod.currentStock + restoreQty, variants: nextVariants, updatedAt: now };
          })
        );
        if (target.customerId) {
          setCustomers(prev =>
            prev.map(c =>
              c.id === target.customerId
                ? {
                    ...c,
                    totalPurchase: Math.max(0, c.totalPurchase - target.total),
                    totalPaid: Math.max(0, c.totalPaid - target.paid),
                    currentDue: Math.max(0, c.currentDue - target.due),
                  }
                : c
            )
          );
        }
        if (target.paid > 0) {
          const revMap = new Map<string, number>();
          if (target.payments && target.payments.length > 0) {
            target.payments.forEach(pmt => {
              if (pmt.amount > 0) {
                const accId = pmt.accountId || getAccountIdForMethod(pmt.method);
                if (accId) revMap.set(accId, (revMap.get(accId) || 0) + pmt.amount);
              }
            });
          } else {
            const accId = getAccountIdForMethod(target.paymentMethod);
            if (accId) revMap.set(accId, target.paid);
          }
          setAccounts(prev =>
            prev.map(a => {
              const rev = revMap.get(a.id);
              return rev ? { ...a, balance: Math.max(0, a.balance - rev) } : a;
            })
          );
        }
      }
      setSales(prev => prev.filter(s => s.id !== saleId));
    }

    logUserActivity(
      'FINANCIAL_DELETED',
      'sales_history',
      'delete',
      `Deleted sale invoice ${target?.invoiceNumber || saleId}`,
      'sale',
      saleId
    );
    return true;
  };

  const deletePurchase = async (purchaseId: string): Promise<boolean> => {
    if (!enforcePermission('purchase_management', 'delete', `Purchase #${purchaseId}`)) return false;
    const target = purchases.find(p => p.id === purchaseId);

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await purchaseService.deletePurchase(purchaseId, activeBusinessId);
        await refreshAfterPurchase(activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to delete purchase in Supabase.');
      }
    } else {
      if (target) {
        const now = new Date().toISOString();
        setProducts(prev =>
          prev.map(prod => {
            const matched = target.items.filter(it => it.productId === prod.id);
            if (matched.length === 0) return prod;
            const qty = matched.reduce((s, it) => s + it.quantity, 0);
            let nextVariants = prod.variants;
            if (prod.hasVariants && prod.variants) {
              nextVariants = prod.variants.map(v => {
                const varQty = matched
                  .filter(it => it.variantId === v.id)
                  .reduce((s, it) => s + it.quantity, 0);
                return varQty > 0 ? { ...v, stock: Math.max(0, v.stock - varQty) } : v;
              });
            }
            return { ...prod, currentStock: Math.max(0, prod.currentStock - qty), variants: nextVariants, updatedAt: now };
          })
        );
        setSuppliers(prev =>
          prev.map(s =>
            s.id === target.supplierId
              ? {
                  ...s,
                  totalPurchase: Math.max(0, s.totalPurchase - target.total),
                  totalPaid: Math.max(0, s.totalPaid - target.paid),
                  currentDue: Math.max(0, s.currentDue - target.due),
                }
              : s
          )
        );
        if (target.paid > 0) {
          const targetAccId = getAccountIdForMethod(target.paymentMethod);
          if (targetAccId) {
            setAccounts(prev =>
              prev.map(a => (a.id === targetAccId ? { ...a, balance: a.balance + target.paid } : a))
            );
          }
        }
      }
      setPurchases(prev => prev.filter(p => p.id !== purchaseId));
    }

    logUserActivity(
      'FINANCIAL_DELETED',
      'purchase_management',
      'delete',
      `Deleted purchase bill ${target?.invoiceNumber || purchaseId}`,
      'purchase',
      purchaseId
    );
    return true;
  };

  const deleteCustomer = async (customerId: string): Promise<{ success: boolean; message?: string }> => {
    if (!enforcePermission('customer_management', 'delete', `Customer #${customerId}`)) {
      return { success: false, message: 'Permission denied: You do not have delete permission for Customers.' };
    }
    const cust = customers.find(c => c.id === customerId);
    if (cust && cust.currentDue > 0) {
      return {
        success: false,
        message: `Customer has outstanding due (৳${cust.currentDue}). Please settle due before deletion.`,
      };
    }

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await customerService.deleteCustomer(customerId, activeBusinessId);
      } catch (err) {
        return { success: false, message: formatSupabaseError(err, 'Failed to delete customer.') };
      }
    }

    setCustomers(prev => prev.filter(c => c.id !== customerId));
    logUserActivity(
      'FINANCIAL_DELETED',
      'customer_management',
      'delete',
      `Deleted customer ${cust?.name || customerId}`,
      'customer',
      customerId
    );
    return { success: true };
  };

  const deleteSupplier = async (supplierId: string): Promise<{ success: boolean; message?: string }> => {
    if (!enforcePermission('supplier_management', 'delete', `Supplier #${supplierId}`)) {
      return { success: false, message: 'Permission denied: You do not have delete permission for Suppliers.' };
    }
    const supp = suppliers.find(s => s.id === supplierId);
    if (supp && supp.currentDue > 0) {
      return {
        success: false,
        message: `Supplier has outstanding due (৳${supp.currentDue}). Please settle due before deletion.`,
      };
    }

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await supplierService.deleteSupplier(supplierId, activeBusinessId);
      } catch (err) {
        return { success: false, message: formatSupabaseError(err, 'Failed to delete supplier.') };
      }
    }

    setSuppliers(prev => prev.filter(s => s.id !== supplierId));
    logUserActivity(
      'FINANCIAL_DELETED',
      'supplier_management',
      'delete',
      `Deleted supplier ${supp?.name || supplierId}`,
      'supplier',
      supplierId
    );
    return { success: true };
  };

  const deleteExpense = async (expenseId: string): Promise<boolean> => {
    if (!enforcePermission('expense_management', 'delete', `Expense #${expenseId}`)) return false;
    const target = expenses.find(e => e.id === expenseId);

    if (isSupabaseConfigured) {
      ensureCloudContext();
      try {
        await financeService.deleteExpense(expenseId, activeBusinessId);
        await refreshAfterFinance(activeBusinessId);
      } catch (err) {
        throw raiseDbError(err, 'Failed to delete expense in Supabase.');
      }
    } else {
      if (target && target.accountId && target.amount > 0) {
        const now = new Date().toISOString();
        const targetAcc = accounts.find(a => a.id === target.accountId);
        setAccounts(prev =>
          prev.map(a => (a.id === target.accountId ? { ...a, balance: a.balance + target.amount } : a))
        );
        if (targetAcc) {
          setAccountTransactions(prev => [
            {
              id: `atx-${Date.now()}-${targetAcc.id}`,
              accountId: targetAcc.id,
              accountName: targetAcc.name,
              date: now,
              type: 'refund',
              amount: target.amount,
              balanceAfter: targetAcc.balance + target.amount,
              note: `Reversed deleted expense (${target.category})`,
            },
            ...prev,
          ]);
        }
      }
      setExpenses(prev => prev.filter(e => e.id !== expenseId));
    }

    logUserActivity(
      'FINANCIAL_DELETED',
      'expense_management',
      'delete',
      `Deleted expense ${target?.category || expenseId} (৳${target?.amount || 0})`,
      'expense',
      expenseId
    );
    return true;
  };

  const deleteEmployee = async (employeeId: string): Promise<boolean> => {
    if (!enforcePermission('user_management', 'delete', `Employee #${employeeId}`)) return false;
    const target = employees.find(e => e.id === employeeId);

    if (isSupabaseConfigured && isValidUuid(employeeId)) {
      ensureCloudContext();
      const { error } = await supabase
        .from('employees')
        .delete()
        .eq('id', employeeId)
        .eq('business_id', activeBusinessId);
      if (error) throw raiseDbError(error, 'Failed to delete employee record in Supabase.');
    }

    setEmployees(prev => prev.filter(e => e.id !== employeeId));
    logUserActivity(
      'FINANCIAL_DELETED',
      'user_management',
      'delete',
      `Removed employee record ${target?.name || employeeId}`,
      'employee',
      employeeId
    );
    return true;
  };

  // Backup & Restore
  const backupData = (): string => {
    const data = {
      settings,
      branches,
      categories,
      products,
      customers,
      customerTransactions,
      suppliers,
      supplierTransactions,
      sales,
      purchases,
      accounts,
      accountTransactions,
      expenses,
      employees,
      sellers,
      stockMovements,
      stockAdjustments,
      stockTransfers,
      comboOffers,
      roles,
      activityLogs,
      auditLogs,
      exportDate: new Date().toISOString(),
    };
    return JSON.stringify(data, null, 2);
  };

  const restoreData = (jsonStr: string): boolean => {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.categories) setCategories(parsed.categories);
      if (parsed.products) setProducts(parsed.products);
      if (parsed.customers) setCustomers(parsed.customers);
      if (parsed.customerTransactions) setCustomerTransactions(parsed.customerTransactions);
      if (parsed.suppliers) setSuppliers(parsed.suppliers);
      if (parsed.supplierTransactions) setSupplierTransactions(parsed.supplierTransactions);
      if (parsed.sales) setSales(parsed.sales);
      if (parsed.purchases) setPurchases(parsed.purchases);
      if (parsed.accounts) setAccounts(parsed.accounts);
      if (parsed.accountTransactions) setAccountTransactions(parsed.accountTransactions);
      if (parsed.expenses) setExpenses(parsed.expenses);
      if (parsed.settings) setSettings(parsed.settings);
      if (parsed.branches) {
        setBranches(parsed.branches);
        if (parsed.branches.length > 0 && !activeBranchId) {
          setActiveBranchId(parsed.branches[0].id);
        }
      }
      if (parsed.employees) setEmployees(parsed.employees);
      if (parsed.sellers) setSellers(parsed.sellers);
      if (parsed.stockMovements) setStockMovements(parsed.stockMovements);
      if (parsed.stockAdjustments) setStockAdjustments(parsed.stockAdjustments);
      if (parsed.stockTransfers) setStockTransfers(parsed.stockTransfers);
      if (parsed.comboOffers) {
        setComboOffers(parsed.comboOffers);
        try {
          const offerBizId = activeBusinessId || localStorage.getItem(`${STORAGE_KEY}_CURRENT_BIZ_ID`) || 'default-business';
          localStorage.setItem(`AMAR_DOKAN_COMBO_OFFERS_V1_${offerBizId}`, JSON.stringify(parsed.comboOffers));
        } catch {}
      }
      if (parsed.roles) setRoles(parsed.roles);
      if (parsed.activityLogs) setActivityLogs(parsed.activityLogs);
      if (parsed.auditLogs) setAuditLogs(parsed.auditLogs);
      setIsBusinessConfigured(true);
      try {
        localStorage.setItem(`${STORAGE_KEY}_IS_CONFIGURED`, 'true');
      } catch {}
      addAuditLog('DATA_RESTORED', 'system', 'backup', 'System backup restore completed successfully');
      return true;
    } catch {
      return false;
    }
  };

  const resetToDemoData = () => {
    setProducts([]);
    setCustomers([]);
    setCustomerTransactions([]);
    setSuppliers([]);
    setSupplierTransactions([]);
    setSales([]);
    setPurchases([]);
    setAccounts([]);
    setAccountTransactions([]);
    setExpenses([]);
    setEmployees([]);
    setSellers([]);
    setStockMovements([]);
    setStockAdjustments([]);
    setStockTransfers([]);
    setComboOffers([]);
    setAuditLogs([]);
    setActivityLogs([]);
    try {
      const offerBizId = activeBusinessId || localStorage.getItem(`${STORAGE_KEY}_CURRENT_BIZ_ID`) || 'default-business';
      localStorage.removeItem(`AMAR_DOKAN_COMBO_OFFERS_V1_${offerBizId}`);
      localStorage.removeItem(`AMAR_DOKAN_COMBO_USAGE_V1_${offerBizId}`);
    } catch {}
  };

  const recordExchangeEffects: AppContextType['recordExchangeEffects'] = ({
    exchangeNumber,
    branchId,
    restockedItems,
    replacementItems,
    differenceAmount,
    accountId,
    accountName,
    accountBalanceAfter,
  }) => {
    const now = new Date().toISOString();
    const moves: StockMovement[] = [
      ...restockedItems.map((it, idx) => ({
        id: `sm-exc-in-${Date.now()}-${idx}`,
        productId: it.productId,
        productName: it.productName,
        date: now,
        type: 'sale_return' as const,
        quantity: it.quantity,
        previousStock: it.previousStock,
        newStock: it.newStock,
        reference: exchangeNumber,
        branchId,
        note: `Exchange return restock (${exchangeNumber})`,
      })),
      ...replacementItems.map((it, idx) => ({
        id: `sm-exc-out-${Date.now()}-${idx}`,
        productId: it.productId,
        productName: it.productName,
        date: now,
        type: 'sale_out' as const,
        quantity: -Math.abs(it.quantity),
        previousStock: it.previousStock,
        newStock: it.newStock,
        reference: exchangeNumber,
        branchId,
        note: `Exchange replacement issued (${exchangeNumber})`,
      })),
    ];
    if (moves.length > 0) {
      setStockMovements(prev => [...moves, ...prev]);
    }
    if (differenceAmount !== 0 && accountId && accountBalanceAfter !== undefined) {
      setAccountTransactions(prev => [
        {
          id: `atx-exc-${Date.now()}`,
          accountId,
          accountName: accountName || 'Cash Account',
          date: now,
          type: differenceAmount > 0 ? 'sale_payment' : 'refund',
          amount: differenceAmount,
          balanceAfter: accountBalanceAfter,
          referenceId: exchangeNumber,
          note:
            differenceAmount > 0
              ? `Exchange net payment collected (${exchangeNumber})`
              : `Exchange/return refund paid (${exchangeNumber})`,
        },
        ...prev,
      ]);
    }
  };

  // Combo & Bundle Offers
  const addComboOffer = async (
    offerData: Omit<ComboOffer, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>
  ): Promise<ComboOffer> => {
    const businessId = activeBusinessId || 'default-business';
    const now = new Date().toISOString();
    const offerPayload: ComboOffer = {
      ...offerData,
      id: `offer-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      businessId,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const newOffer = await comboOfferService.saveOffer(offerPayload, businessId);
      setComboOffers(prev => [newOffer, ...prev]);
      addAuditLog('COMBO_OFFER_CREATED', 'combo_offer', newOffer.id, `Created combo offer: ${newOffer.name} (${newOffer.offerType})`);
      return newOffer;
    } catch (err) {
      throw raiseDbError(err, 'Failed to save combo offer.');
    }
  };

  const updateComboOffer = async (id: string, updates: Partial<ComboOffer>) => {
    const businessId = activeBusinessId || 'default-business';
    const existing = comboOffers.find(o => o.id === id);
    if (!existing) return;
    const merged: ComboOffer = { ...existing, ...updates, id, businessId, updatedAt: new Date().toISOString() };
    try {
      const updated = await comboOfferService.saveOffer(merged, businessId);
      setComboOffers(prev => prev.map(o => (o.id === id ? updated : o)));
      addAuditLog('COMBO_OFFER_UPDATED', 'combo_offer', id, `Updated combo offer: ${updated.name}`);
    } catch (err) {
      throw raiseDbError(err, 'Failed to update combo offer.');
    }
  };

  const toggleOfferStatus = async (id: string, status: OfferStatus) => {
    const businessId = activeBusinessId || 'default-business';
    const existing = comboOffers.find(o => o.id === id);
    if (!existing) return;
    const merged: ComboOffer = { ...existing, status, updatedAt: new Date().toISOString() };
    try {
      const updated = await comboOfferService.saveOffer(merged, businessId);
      setComboOffers(prev => prev.map(o => (o.id === id ? updated : o)));
      addAuditLog('COMBO_OFFER_STATUS_CHANGED', 'combo_offer', id, `Changed combo offer status to: ${status}`);
    } catch (err) {
      throw raiseDbError(err, 'Failed to update combo offer status.');
    }
  };

  const archiveComboOffer = async (id: string) => {
    const businessId = activeBusinessId || 'default-business';
    const existing = comboOffers.find(o => o.id === id);
    if (!existing) return;
    const merged: ComboOffer = { ...existing, status: 'archived', updatedAt: new Date().toISOString() };
    try {
      const updated = await comboOfferService.saveOffer(merged, businessId);
      setComboOffers(prev => prev.map(o => (o.id === id ? updated : o)));
      addAuditLog('COMBO_OFFER_ARCHIVED', 'combo_offer', id, `Archived combo offer: ${id}`);
    } catch (err) {
      throw raiseDbError(err, 'Failed to archive combo offer.');
    }
  };

  const reloadComboOffers = async () => {
    if (!activeBusinessId) return;
    const offers = await comboOfferService.fetchOffers(activeBusinessId);
    setComboOffers(offers);
  };

  return (
    <AppContext.Provider
      value={{
        user,
        session,
        activeBusinessId,
        signOut,
        isLoading,
        isMigrated,
        migrateLegacyData,
        dbError,
        clearDbError,
        isBusinessConfigured,
        completeBusinessSetup,
        settings,
        updateSettings,
        currentUserRole,
        setCurrentUserRole,
        activeBranchId,
        setActiveBranchId,
        branches,
        addBranch,
        updateBranch,
        deleteBranch,
        categories,
        addCategory,
        deleteCategory,
        products,
        addProduct,
        updateProduct,
        deleteProduct,
        reloadProducts,
        sales,
        recordSale,
        recordSaleReturn,
        quickRefundSale,
        voidSale,
        purchases,
        recordPurchase,
        updatePurchase,
        recordPurchaseReturn,
        stockMovements,
        stockAdjustments,
        stockTransfers,
        adjustStock,
        transferStock,
        recordExchangeEffects,
        customers,
        customerTransactions,
        addCustomer,
        updateCustomer,
        collectCustomerDue,
        suppliers,
        supplierTransactions,
        addSupplier,
        updateSupplier,
        paySupplierDue,
        accounts,
        accountTransactions,
        addAccount,
        updateAccount,
        deleteAccount,
        expenses,
        addExpense,
        transferMoney,
        employees,
        addEmployee,
        updateEmployee,
        disburseSalary,
        sellers,
        addSeller,
        updateSeller,
        toggleSellerStatus,
        resetSellerPassword,
        reloadSellers,
        auditLogs,
        addAuditLog,
        roles,
        activeRoleDefinition,
        authenticatedRoleKey,
        isAuthenticatedAdmin,
        currentEmployee,
        activityLogs,
        authBlockedReason,
        clearAuthBlockedReason,
        hasPermission,
        enforcePermission,
        createStaffAccount,
        updateStaffAccount,
        changeStaffStatus,
        resetStaffAccountPassword,
        createCustomRole,
        updateRolePermissionsMatrix,
        deleteCustomRole,
        logUserActivity,
        reloadRbacData,
        isAdmin,
        deleteSale,
        deletePurchase,
        deleteCustomer,
        deleteSupplier,
        deleteExpense,
        deleteEmployee,
        backupData,
        restoreData,
        resetToDemoData,
        canAccess,
        comboOffers,
        addComboOffer,
        updateComboOffer,
        toggleOfferStatus,
        archiveComboOffer,
        reloadComboOffers,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
