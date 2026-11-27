import {
  PermissionAction,
  PermissionActionsMap,
  PermissionDefinition,
  PermissionModuleKey,
  RoleDefinition,
  RolePermissionMatrix,
  SystemRoleKey,
  UserRole,
} from '../types';

export const PERMISSION_ACTIONS: { key: PermissionAction; label: string }[] = [
  { key: 'view', label: 'View' },
  { key: 'create', label: 'Create' },
  { key: 'edit', label: 'Edit' },
  { key: 'delete', label: 'Delete' },
  { key: 'print', label: 'Print' },
  { key: 'export', label: 'Export' },
];

export const PERMISSION_MODULES: PermissionDefinition[] = [
  {
    key: 'dashboard',
    name: 'Dashboard',
    category: 'Core Operations',
    description: 'Overview metrics, KPI cards & live business summary',
  },
  {
    key: 'pos_new_sale',
    name: 'POS / New Sale',
    category: 'Core Operations',
    description: 'Create POS sales, apply offers & collect billing payments',
  },
  {
    key: 'sales_history',
    name: 'Sales History',
    category: 'Core Operations',
    description: 'Inspect invoices, process refunds/returns & manage sales records',
  },
  {
    key: 'purchase_management',
    name: 'Purchase Management',
    category: 'Inventory & Supply',
    description: 'Record supplier purchase bills & landed costs',
  },
  {
    key: 'product_management',
    name: 'Product Management',
    category: 'Inventory & Supply',
    description: 'Create/edit products, apparel variants, pricing & catalog',
  },
  {
    key: 'stock_management',
    name: 'Stock Management',
    category: 'Inventory & Supply',
    description: 'Adjust stock, branch transfers & reorder alerts',
  },
  {
    key: 'customer_management',
    name: 'Customer Management',
    category: 'Parties & CRM',
    description: 'Manage customer profiles, credit limits & ledgers',
  },
  {
    key: 'supplier_management',
    name: 'Supplier Management',
    category: 'Parties & CRM',
    description: 'Manage supplier profiles & payable ledgers',
  },
  {
    key: 'expense_management',
    name: 'Expense Management',
    category: 'Finance & Accounting',
    description: 'Record & manage daily business expenses',
  },
  {
    key: 'cash_management',
    name: 'Cash Management',
    category: 'Finance & Accounting',
    description: 'Manage cash drawers & cash-in-hand balances',
  },
  {
    key: 'bank_management',
    name: 'Bank Management',
    category: 'Finance & Accounting',
    description: 'Manage bank & mobile financial accounts (bKash/Nagad)',
  },
  {
    key: 'due_collection',
    name: 'Due Collection',
    category: 'Finance & Accounting',
    description: 'Collect customer dues & pay supplier dues',
  },
  {
    key: 'accounts_transactions',
    name: 'Accounts & Transactions',
    category: 'Finance & Accounting',
    description: 'Account transfers, payroll disbursements & cash ledger',
  },
  {
    key: 'profit_loss_reports',
    name: 'Profit & Loss Reports',
    category: 'Reports & Printing',
    description: 'Net profit, COGS, margin & financial analytics',
  },
  {
    key: 'sales_reports',
    name: 'Sales Reports',
    category: 'Reports & Printing',
    description: 'Sales performance, employee sales & product analytics',
  },
  {
    key: 'invoice_printing',
    name: 'Invoice Printing',
    category: 'Reports & Printing',
    description: 'Print & export PDF sales invoices (thermal/A4/A5)',
  },
  {
    key: 'barcode_label_printing',
    name: 'Barcode & Label Printing',
    category: 'Reports & Printing',
    description: 'Generate & print barcode price labels',
  },
  {
    key: 'user_management',
    name: 'User Management',
    category: 'Administration',
    description: 'Staff accounts, roles, permissions & permanent audit logs',
  },
  {
    key: 'application_settings',
    name: 'Application Settings',
    category: 'Administration',
    description: 'Shop profile, VAT, branches, printer setup & system backup',
  },
];

function fullActions(enabled = true): PermissionActionsMap {
  return {
    view: enabled,
    create: enabled,
    edit: enabled,
    delete: enabled,
    print: enabled,
    export: enabled,
  };
}

function makeActions(partial: Partial<PermissionActionsMap>): PermissionActionsMap {
  return {
    view: Boolean(partial.view),
    create: Boolean(partial.create),
    edit: Boolean(partial.edit),
    delete: Boolean(partial.delete),
    print: Boolean(partial.print),
    export: Boolean(partial.export),
  };
}

export function createEmptyPermissionsMatrix(defaultVal = false): RolePermissionMatrix {
  const matrix = {} as RolePermissionMatrix;
  for (const mod of PERMISSION_MODULES) {
    matrix[mod.key] = fullActions(defaultVal);
  }
  return matrix;
}

export function clonePermissionsMatrix(source: RolePermissionMatrix): RolePermissionMatrix {
  const cloned = createEmptyPermissionsMatrix(false);
  for (const mod of PERMISSION_MODULES) {
    const src = source[mod.key];
    if (src) {
      cloned[mod.key] = {
        view: Boolean(src.view),
        create: Boolean(src.create),
        edit: Boolean(src.edit),
        delete: Boolean(src.delete),
        print: Boolean(src.print),
        export: Boolean(src.export),
      };
    }
  }
  return cloned;
}

function buildMatrix(overrides: Partial<Record<PermissionModuleKey, PermissionActionsMap>>): RolePermissionMatrix {
  const base = createEmptyPermissionsMatrix(false);
  for (const [key, val] of Object.entries(overrides) as [PermissionModuleKey, PermissionActionsMap][]) {
    base[key] = { ...val };
  }
  return base;
}

export interface DefaultRoleTemplate {
  roleKey: SystemRoleKey;
  name: string;
  description: string;
  permissions: RolePermissionMatrix;
}

export const DEFAULT_ROLE_TEMPLATES: DefaultRoleTemplate[] = [
  {
    roleKey: 'super_admin',
    name: 'Super Admin / Store Owner',
    description: 'Full unrestricted control over all store modules, staff accounts, roles, financials & settings.',
    permissions: createEmptyPermissionsMatrix(true),
  },
  {
    roleKey: 'store_manager',
    name: 'Store Manager',
    description: 'Manages daily store operations, sales, purchases, inventory, customers, reports & label printing.',
    permissions: buildMatrix({
      dashboard: makeActions({ view: true, export: true }),
      pos_new_sale: makeActions({ view: true, create: true, edit: true, print: true }),
      sales_history: makeActions({ view: true, edit: true, print: true, export: true }),
      purchase_management: makeActions({ view: true, create: true, edit: true, print: true, export: true }),
      product_management: makeActions({ view: true, create: true, edit: true, print: true, export: true }),
      stock_management: makeActions({ view: true, create: true, edit: true, print: true, export: true }),
      customer_management: makeActions({ view: true, create: true, edit: true, export: true }),
      supplier_management: makeActions({ view: true, create: true, edit: true, export: true }),
      expense_management: makeActions({ view: true, create: true, edit: true }),
      cash_management: makeActions({ view: true }),
      bank_management: makeActions({ view: true }),
      due_collection: makeActions({ view: true, create: true, print: true }),
      accounts_transactions: makeActions({ view: true, print: true, export: true }),
      profit_loss_reports: makeActions({ view: true, print: true, export: true }),
      sales_reports: makeActions({ view: true, print: true, export: true }),
      invoice_printing: makeActions({ view: true, print: true, export: true }),
      barcode_label_printing: makeActions({ view: true, create: true, print: true, export: true }),
      user_management: makeActions({ view: true }),
      application_settings: makeActions({ view: false }),
    }),
  },
  {
    roleKey: 'salesman',
    name: 'Salesman',
    description: 'Handles POS billing, own sales history, customer registration & invoice printing. Blocked from Admin settings & financials.',
    permissions: buildMatrix({
      dashboard: makeActions({ view: true }),
      pos_new_sale: makeActions({ view: true, create: true, print: true }),
      sales_history: makeActions({ view: true, print: true }),
      product_management: makeActions({ view: true }),
      stock_management: makeActions({ view: true }),
      customer_management: makeActions({ view: true, create: true }),
      invoice_printing: makeActions({ view: true, print: true }),
      // Strictly disabled for Salesman:
      user_management: fullActions(false),
      application_settings: fullActions(false),
    }),
  },
  {
    roleKey: 'accountant',
    name: 'Accountant',
    description: 'Manages cash & bank accounts, expenses, due collections, P&L statements & financial exports.',
    permissions: buildMatrix({
      dashboard: makeActions({ view: true, export: true }),
      sales_history: makeActions({ view: true, print: true, export: true }),
      purchase_management: makeActions({ view: true, print: true, export: true }),
      customer_management: makeActions({ view: true, edit: true, export: true }),
      supplier_management: makeActions({ view: true, edit: true, export: true }),
      expense_management: makeActions({ view: true, create: true, edit: true, print: true, export: true }),
      cash_management: makeActions({ view: true, create: true, edit: true, export: true }),
      bank_management: makeActions({ view: true, create: true, edit: true, export: true }),
      due_collection: makeActions({ view: true, create: true, edit: true, print: true, export: true }),
      accounts_transactions: makeActions({ view: true, create: true, edit: true, print: true, export: true }),
      profit_loss_reports: makeActions({ view: true, print: true, export: true }),
      sales_reports: makeActions({ view: true, print: true, export: true }),
      invoice_printing: makeActions({ view: true, print: true, export: true }),
    }),
  },
  {
    roleKey: 'inventory_manager',
    name: 'Inventory Manager',
    description: 'Controls products, variants, purchases, stock adjustments, suppliers & barcode label printing.',
    permissions: buildMatrix({
      dashboard: makeActions({ view: true }),
      purchase_management: makeActions({ view: true, create: true, edit: true, print: true, export: true }),
      product_management: makeActions({ view: true, create: true, edit: true, print: true, export: true }),
      stock_management: makeActions({ view: true, create: true, edit: true, print: true, export: true }),
      supplier_management: makeActions({ view: true, create: true, edit: true, export: true }),
      barcode_label_printing: makeActions({ view: true, create: true, print: true, export: true }),
    }),
  },
  {
    roleKey: 'cashier',
    name: 'Cashier',
    description: 'Operates POS checkout counter, collects customer dues, views daily cash drawer & prints receipts.',
    permissions: buildMatrix({
      dashboard: makeActions({ view: true }),
      pos_new_sale: makeActions({ view: true, create: true, print: true }),
      sales_history: makeActions({ view: true, print: true }),
      customer_management: makeActions({ view: true, create: true }),
      cash_management: makeActions({ view: true }),
      due_collection: makeActions({ view: true, create: true, print: true }),
      invoice_printing: makeActions({ view: true, print: true }),
      user_management: fullActions(false),
      application_settings: fullActions(false),
    }),
  },
];

export function normalizeRoleKey(raw?: string | null): string {
  const val = (raw || '').trim().toLowerCase();
  if (val === 'owner' || val === 'admin' || val === 'super_admin') return 'super_admin';
  if (val === 'manager' || val === 'store_manager') return 'store_manager';
  if (val === 'seller' || val === 'salesman') return 'salesman';
  if (val === 'storekeeper' || val === 'inventory_manager') return 'inventory_manager';
  if (val === 'accountant') return 'accountant';
  if (val === 'cashier') return 'cashier';
  return val || 'salesman';
}

export function roleKeyToLegacyUserRole(roleKey: string): UserRole {
  const normalized = normalizeRoleKey(roleKey);
  if (normalized === 'super_admin') return 'owner';
  if (normalized === 'store_manager') return 'manager';
  if (normalized === 'salesman') return 'salesman';
  if (normalized === 'inventory_manager') return 'storekeeper';
  if (normalized === 'accountant') return 'accountant';
  if (normalized === 'cashier') return 'cashier';
  return roleKey;
}

export function getDefaultRoleTemplate(roleKey: string): DefaultRoleTemplate {
  const normalized = normalizeRoleKey(roleKey);
  return (
    DEFAULT_ROLE_TEMPLATES.find(t => t.roleKey === normalized) ||
    DEFAULT_ROLE_TEMPLATES.find(t => t.roleKey === 'salesman')!
  );
}

export function createDefaultRolesForBusiness(businessId: string): RoleDefinition[] {
  const now = new Date().toISOString();
  return DEFAULT_ROLE_TEMPLATES.map(tpl => ({
    id: `role-${tpl.roleKey}`,
    businessId,
    roleKey: tpl.roleKey,
    name: tpl.name,
    description: tpl.description,
    isSystemRole: true,
    isDefault: true,
    permissions: clonePermissionsMatrix(tpl.permissions),
    createdAt: now,
    updatedAt: now,
  }));
}

export type LegacyAppModule =
  | 'dashboard'
  | 'pos'
  | 'sales'
  | 'products'
  | 'stock'
  | 'purchases'
  | 'customers'
  | 'suppliers'
  | 'accounts'
  | 'reports'
  | 'employees'
  | 'branches'
  | 'settings'
  | 'sellers'
  | 'pricing'
  | 'barcodes'
  | 'catalog'
  | 'returns'
  | 'reorder'
  | 'combos'
  | 'users'
  | 'billing'
  | 'scanner'
  | 'installments';

export function mapLegacyModuleToPermissionKeys(module: LegacyAppModule): PermissionModuleKey[] {
  switch (module) {
    case 'dashboard':
      return ['dashboard'];
    case 'pos':
      return ['pos_new_sale'];
    case 'scanner':
      return ['pos_new_sale', 'product_management', 'stock_management', 'barcode_label_printing'];
    case 'sales':
    case 'returns':
      return ['sales_history'];
    case 'products':
    case 'catalog':
    case 'pricing':
    case 'combos':
      return ['product_management'];
    case 'stock':
    case 'reorder':
      return ['stock_management'];
    case 'purchases':
      return ['purchase_management'];
    case 'customers':
    case 'installments':
      return ['customer_management', 'due_collection'];
    case 'suppliers':
      return ['supplier_management', 'due_collection'];
    case 'accounts':
      return ['cash_management', 'bank_management', 'expense_management', 'accounts_transactions'];
    case 'reports':
      return ['profit_loss_reports', 'sales_reports'];
    case 'barcodes':
      return ['barcode_label_printing'];
    case 'employees':
    case 'sellers':
    case 'users':
      return ['user_management'];
    case 'branches':
    case 'settings':
      return ['application_settings'];
    case 'billing':
      return ['application_settings', 'accounts_transactions'];
    default:
      return ['dashboard'];
  }
}

export function isSalesmanOrCashierRole(roleKey?: string): boolean {
  const normalized = normalizeRoleKey(roleKey);
  return normalized === 'salesman' || normalized === 'cashier';
}

export function hasMatrixPermission(
  matrix: RolePermissionMatrix | undefined,
  roleKey: string,
  moduleKey: PermissionModuleKey,
  action: PermissionAction = 'view'
): boolean {
  const normalized = normalizeRoleKey(roleKey);
  if (normalized === 'super_admin') return true;

  // Hard backend-mirrored security guard: Salesman and Cashier can never access Admin settings or User management
  if (
    isSalesmanOrCashierRole(normalized) &&
    (moduleKey === 'application_settings' || moduleKey === 'user_management')
  ) {
    return false;
  }

  const resolvedMatrix = matrix || getDefaultRoleTemplate(normalized).permissions;
  const entry = resolvedMatrix[moduleKey];
  if (!entry) return false;
  return Boolean(entry[action]);
}
