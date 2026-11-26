-- ==============================================================================
-- PROTIVA — Combo Poster Studio, Business Web Links & Marketplace Orders
-- Non-destructive additive migration preserving all existing tables, data, and RLS.
-- Prerequisites: 20261114_core_schema.sql, 20261122_permanent_rls_recursion_and_setup_fix.sql,
--                20261128_custom_combo_builder_atomic_inventory.sql
-- ==============================================================================

-- 1. Optional Web, Marketplace & Social Media fields on Businesses (additive nullable)
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS marketplace_url TEXT,
  ADD COLUMN IF NOT EXISTS social_media TEXT;

-- 2. Combo Poster Studio & Online Marketplace metadata on combo_offers (additive only)
ALTER TABLE public.combo_offers
  ADD COLUMN IF NOT EXISTS poster_config JSONB,
  ADD COLUMN IF NOT EXISTS poster_image_url TEXT,
  ADD COLUMN IF NOT EXISTS master_image_type TEXT,
  ADD COLUMN IF NOT EXISTS is_published_online BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketplace_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_combo_offers_published_online
  ON public.combo_offers (business_id, is_published_online)
  WHERE is_published_online = TRUE;

-- 3. Marketplace Combo Orders table (Tenant Isolated, Historical Audit Preserved, Idempotent)
CREATE TABLE IF NOT EXISTS public.marketplace_combo_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL DEFAULT 'all',
  combo_offer_id TEXT REFERENCES public.combo_offers(id) ON DELETE SET NULL,
  combo_offer_name TEXT NOT NULL,
  combo_quantity INTEGER NOT NULL DEFAULT 1 CHECK (combo_quantity > 0),
  unit_combo_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_combo_price >= 0),
  regular_unit_total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (regular_unit_total >= 0),
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash_on_delivery'
    CHECK (payment_method IN ('cash_on_delivery', 'bkash', 'nagad', 'card', 'bank')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  stock_deducted BOOLEAN NOT NULL DEFAULT FALSE,
  linked_sale_id TEXT,
  linked_invoice_number TEXT,
  notes TEXT,
  order_source TEXT NOT NULL DEFAULT 'online_storefront'
    CHECK (order_source IN ('online_storefront', 'qr_link', 'admin_test')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_combo_orders_business_status
  ON public.marketplace_combo_orders (business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_combo_orders_offer
  ON public.marketplace_combo_orders (business_id, combo_offer_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_combo_orders_order_number_unique
  ON public.marketplace_combo_orders (business_id, order_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_combo_orders_linked_sale_unique
  ON public.marketplace_combo_orders (business_id, linked_sale_id)
  WHERE linked_sale_id IS NOT NULL;

ALTER TABLE public.marketplace_combo_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_combo_orders NO FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS policy_marketplace_orders_select ON public.marketplace_combo_orders;
CREATE POLICY policy_marketplace_orders_select ON public.marketplace_combo_orders
  FOR SELECT TO authenticated
  USING (public.is_active_staff_member(business_id));

DROP POLICY IF EXISTS policy_marketplace_orders_insert ON public.marketplace_combo_orders;
CREATE POLICY policy_marketplace_orders_insert ON public.marketplace_combo_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'pos_new_sale', 'create')
    OR public.has_module_permission(business_id, 'product_management', 'edit')
  );

DROP POLICY IF EXISTS policy_marketplace_orders_update ON public.marketplace_combo_orders;
CREATE POLICY policy_marketplace_orders_update ON public.marketplace_combo_orders
  FOR UPDATE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'pos_new_sale', 'create')
    OR public.has_module_permission(business_id, 'product_management', 'edit')
  )
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'pos_new_sale', 'create')
    OR public.has_module_permission(business_id, 'product_management', 'edit')
  );

DROP POLICY IF EXISTS policy_marketplace_orders_delete ON public.marketplace_combo_orders;
CREATE POLICY policy_marketplace_orders_delete ON public.marketplace_combo_orders
  FOR DELETE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'product_management', 'delete')
  );
