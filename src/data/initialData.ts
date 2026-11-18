import { Product, Customer, Supplier, Account, Expense, Employee, Branch, ShopSettings, Sale, Purchase, StockMovement, Seller, Category, AuditLog } from '../types';

export const initialSettings: ShopSettings = {
  shopName: '',
  ownerName: '',
  tagline: '',
  address: '',
  mobile: '',
  email: '',
  logoUrl: '',
  vatRegistrationNo: '',
  currency: '৳',
  financialYear: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
  vatTaxRate: 0,
  invoiceFormat: 'thermal',
  businessType: 'general',
  language: 'en',
  uiMode: 'advanced',
  isConfigured: false,
};

export const initialBranches: Branch[] = [];

export const initialAccounts: Account[] = [];

export const initialProducts: Product[] = [];

export const initialCustomers: Customer[] = [];

export const initialSuppliers: Supplier[] = [];

export const initialSales: Sale[] = [];

export const initialPurchases: Purchase[] = [];

export const initialExpenses: Expense[] = [];

export const initialEmployees: Employee[] = [];

export const initialStockMovements: StockMovement[] = [];

export const initialCategories: Category[] = [
  { id: 'cat-clothing', name: 'Clothing', slug: 'clothing' },
  { id: 'cat-grocery', name: 'Grocery', slug: 'grocery' },
  { id: 'cat-electronics', name: 'Electronics', slug: 'electronics' },
  { id: 'cat-pharmacy', name: 'Pharmacy', slug: 'pharmacy' },
  { id: 'cat-general', name: 'General', slug: 'general' },
];

export const initialAuditLogs: AuditLog[] = [];

export const initialSellers: Seller[] = [];
