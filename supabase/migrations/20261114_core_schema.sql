-- ============================================================================
-- Amar Dokan Pro: Core Database Schema Migration (Idempotent & Data-Safe)
-- Run BEFORE 20261115_rbac_staff_management.sql and 20261118_transactional_rpcs_and_rls.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. User Profiles
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT 'User',
  username TEXT,
  mobile TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Businesses
CREATE TABLE IF NOT EXISTS public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_name TEXT,
  tagline TEXT DEFAULT '',
  business_type TEXT NOT NULL DEFAULT 'general',
  phone TEXT DEFAULT '',
  email TEXT,
  address TEXT DEFAULT '',
  currency TEXT NOT NULL DEFAULT '৳',
  financial_year TEXT,
  vat_tax_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
  vat_registration_no TEXT,
  invoice_format TEXT NOT NULL DEFAULT 'thermal',
  language TEXT NOT NULL DEFAULT 'en',
  logo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS tagline TEXT DEFAULT '';
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS financial_year TEXT;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS vat_registration_no TEXT;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS invoice_format TEXT NOT NULL DEFAULT 'thermal';
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 3. Branches
CREATE TABLE IF NOT EXISTS public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT DEFAULT '',
  mobile TEXT DEFAULT '',
  is_main BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branches_business_id ON public.branches(business_id);

-- 4. Business Users Membership
CREATE TABLE IF NOT EXISTS public.business_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_business_users_user_id ON public.business_users(user_id);
CREATE INDEX IF NOT EXISTS idx_business_users_business_id ON public.business_users(business_id);

-- 5. Categories
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT,
  description TEXT,
  overhead_weight NUMERIC(6,2) NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_business_id ON public.categories(business_id);

-- 6. Products & Variants
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  barcode TEXT DEFAULT '',
  category_name TEXT NOT NULL DEFAULT 'General',
  subcategory TEXT,
  brand TEXT,
  description TEXT,
  image_url TEXT,
  purchase_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  wholesale_price NUMERIC(14,2),
  min_sale_price NUMERIC(14,2),
  current_stock NUMERIC(14,2) NOT NULL DEFAULT 0,
  min_stock_alert NUMERIC(14,2) NOT NULL DEFAULT 5,
  unit TEXT NOT NULL DEFAULT 'pcs',
  business_type TEXT NOT NULL DEFAULT 'general',
  has_variants BOOLEAN NOT NULL DEFAULT FALSE,
  model TEXT,
  serial_number TEXT,
  warranty_period TEXT,
  expiry_date TEXT,
  batch_number TEXT,
  landed_cost_per_unit NUMERIC(14,2),
  allocated_opex_per_unit NUMERIC(14,2),
  total_unit_cost NUMERIC(14,2),
  recommended_selling_price NUMERIC(14,2),
  quality_tier TEXT,
  supplier_id UUID,
  supplier_name TEXT,
  lead_time_days INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS subcategory TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS min_sale_price NUMERIC(14,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS serial_number TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS landed_cost_per_unit NUMERIC(14,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS allocated_opex_per_unit NUMERIC(14,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS total_unit_cost NUMERIC(14,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS recommended_selling_price NUMERIC(14,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS quality_tier TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS supplier_id UUID;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS supplier_name TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS lead_time_days INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_products_business_id ON public.products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products(business_id, sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(business_id, barcode);

CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  color TEXT,
  color_hex TEXT,
  size TEXT,
  sku TEXT NOT NULL,
  barcode TEXT,
  stock NUMERIC(14,2) NOT NULL DEFAULT 0,
  additional_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  purchase_price NUMERIC(14,2),
  sale_price NUMERIC(14,2),
  min_stock_alert NUMERIC(14,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS color_hex TEXT;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(14,2);
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS sale_price NUMERIC(14,2);
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS min_stock_alert NUMERIC(14,2);
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_business_id ON public.product_variants(business_id);

-- 7. Customers & Customer Transactions
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL DEFAULT '',
  address TEXT,
  email TEXT,
  customer_type TEXT NOT NULL DEFAULT 'retail',
  opening_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_purchase NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_business_id ON public.customers(business_id);

CREATE TABLE IF NOT EXISTS public.customer_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method TEXT,
  reference_id TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_transactions_customer ON public.customer_transactions(business_id, customer_id, created_at DESC);

-- 8. Suppliers & Supplier Transactions
CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  address TEXT,
  email TEXT,
  opening_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_purchase NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_business_id ON public.suppliers(business_id);

CREATE TABLE IF NOT EXISTS public.supplier_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method TEXT,
  reference_id TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier ON public.supplier_transactions(business_id, supplier_id, created_at DESC);

-- 9. Financial Accounts, Account Transactions & Expenses
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'cash',
  account_number TEXT,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_business_id ON public.accounts(business_id);

CREATE TABLE IF NOT EXISTS public.account_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  account_name TEXT,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL DEFAULT 0,
  reference_id TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.account_transactions ADD COLUMN IF NOT EXISTS account_name TEXT;
CREATE INDEX IF NOT EXISTS idx_account_transactions_business ON public.account_transactions(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  paid_to TEXT,
  note TEXT,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON public.expenses(business_id, created_at DESC);

-- 10. Sales, Sale Items, Sale Payments & Sale Returns
CREATE TABLE IF NOT EXISTS public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT 'Walk-in Customer',
  customer_mobile TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  combo_discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  applied_offers JSONB DEFAULT '[]'::jsonb,
  vat_tax_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
  vat_tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  due NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'paid',
  served_by TEXT NOT NULL DEFAULT 'Staff',
  seller_id UUID,
  seller_name TEXT,
  notes TEXT,
  refunded_amount NUMERIC(14,2) DEFAULT 0,
  refund_reason TEXT,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, invoice_number)
);

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS combo_discount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS applied_offers JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS seller_name TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_sales_business_created ON public.sales(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON public.sales(business_id, customer_id);

CREATE TABLE IF NOT EXISTS public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  sku TEXT DEFAULT '',
  variant_details TEXT,
  quantity NUMERIC(14,2) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  purchase_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL,
  combo_offer_id TEXT,
  combo_offer_name TEXT,
  is_free_item BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS combo_offer_id TEXT;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS combo_offer_name TEXT;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS is_free_item BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON public.sale_items(sale_id);

CREATE TABLE IF NOT EXISTS public.sale_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  payment_method TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  trx_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale_id ON public.sale_payments(sale_id);

CREATE TABLE IF NOT EXISTS public.sale_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  refund_type TEXT NOT NULL DEFAULT 'cash',
  total_refund_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  reason TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sale_returns_business_id ON public.sale_returns(business_id, created_at DESC);

-- 11. Purchases & Purchase Items
CREATE TABLE IF NOT EXISTS public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  transport_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  loading_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  packaging_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  due NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'paid',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, invoice_number)
);

ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS discount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS loading_cost NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS packaging_cost NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_purchases_business_created ON public.purchases(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity NUMERIC(14,2) NOT NULL,
  purchase_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  landed_cost_per_unit NUMERIC(14,2),
  total NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS landed_cost_per_unit NUMERIC(14,2);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON public.purchase_items(purchase_id);

-- 12. Stock Movements & Branch Stock Transfers
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  quantity NUMERIC(14,2) NOT NULL,
  previous_stock NUMERIC(14,2) NOT NULL DEFAULT 0,
  new_stock NUMERIC(14,2) NOT NULL DEFAULT 0,
  reference TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_business ON public.stock_movements(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity NUMERIC(14,2) NOT NULL,
  from_branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  from_branch_name TEXT NOT NULL,
  to_branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  to_branch_name TEXT NOT NULL,
  transferred_by TEXT,
  reference TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_business ON public.stock_transfers(business_id, created_at DESC);

-- 13. Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  user_role TEXT NOT NULL DEFAULT 'staff',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_business ON public.audit_logs(business_id, created_at DESC);

-- 14. Combo & Bundle Offers
CREATE TABLE IF NOT EXISTS public.combo_offers (
  id TEXT PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image TEXT,
  offer_type TEXT NOT NULL,
  min_spend_amount NUMERIC(14,2),
  min_purchase_quantity INTEGER,
  target_category_ids JSONB DEFAULT '[]'::jsonb,
  regular_total_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL,
  discount_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  final_combo_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost_of_goods NUMERIC(14,2) NOT NULL DEFAULT 0,
  allocated_opex NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  estimated_net_profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  profit_margin_percent NUMERIC(8,2) NOT NULL DEFAULT 0,
  is_loss_making BOOLEAN NOT NULL DEFAULT FALSE,
  min_safe_selling_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  loss_override_reason TEXT,
  loss_approved_by TEXT,
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  max_usage_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  per_customer_limit INTEGER,
  branch_id TEXT DEFAULT 'all',
  priority_rank INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.combo_offer_items (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES public.combo_offers(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  variant_id TEXT,
  variant_details TEXT,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  is_free BOOLEAN NOT NULL DEFAULT FALSE,
  purchase_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.combo_offer_usage (
  id TEXT PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES public.combo_offers(id) ON DELETE CASCADE,
  sale_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  customer_id TEXT,
  customer_name TEXT,
  discount_given NUMERIC(14,2) NOT NULL DEFAULT 0,
  revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_of_goods NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  branch_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_combo_offers_business ON public.combo_offers(business_id);
CREATE INDEX IF NOT EXISTS idx_combo_offer_usage_business ON public.combo_offer_usage(business_id, created_at DESC);
