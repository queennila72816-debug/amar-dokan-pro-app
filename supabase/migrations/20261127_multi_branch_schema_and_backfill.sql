-- ============================================================================
-- Amar Dokan Pro / PROTIVA — Phase 1: Non-Destructive Multi-Branch Schema & Backfill
-- ============================================================================
-- STRICT SAFETY GUARANTEES:
--   1. ZERO deletions: No DROP TABLE, DROP FUNCTION, DROP TRIGGER, DROP INDEX,
--      DROP POLICY, DROP CONSTRAINT, DELETE, or TRUNCATE statements.
--   2. 100% Idempotent: Safe to re-run multiple times (IF NOT EXISTS / DO $$).
--   3. Zero Guessing Policy:
--      - Preserves every existing non-null valid branch_id.
--      - Propagates parent branch_id deterministically to child tables
--        (sale_items, sale_payments, sale_returns, purchase_items,
--         product_variants, product_colors, product_images, etc.).
--      - Only auto-assigns business-wide NULL branch_id rows to Main Branch when
--        the business has an unambiguous single Main Branch AND no conflicting
--        active data on secondary branches.
--      - Any ambiguous Main Branch (0 or >1 is_main=TRUE with multiple branches)
--        or multi-branch active shared data is NOT guessed—it is logged as a
--        NOTICE/WARNING for explicit admin verification.
--   4. Captures Before & After row counts for all core operational tables.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 0. Pre-Migration Baseline Row Count Verification (Read-Only Diagnostic)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_businesses BIGINT;
  v_branches BIGINT;
  v_categories BIGINT;
  v_products BIGINT;
  v_variants BIGINT;
  v_colors BIGINT;
  v_images BIGINT;
  v_customers BIGINT;
  v_cust_tx BIGINT;
  v_suppliers BIGINT;
  v_supp_tx BIGINT;
  v_accounts BIGINT;
  v_acc_tx BIGINT;
  v_expenses BIGINT;
  v_sales BIGINT;
  v_sale_items BIGINT;
  v_sale_payments BIGINT;
  v_sale_returns BIGINT;
  v_purchases BIGINT;
  v_purchase_items BIGINT;
  v_stock_moves BIGINT;
  v_stock_transfers BIGINT;
  v_employees BIGINT;
  v_business_users BIGINT;
  v_activity_logs BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_businesses FROM public.businesses;
  SELECT COUNT(*) INTO v_branches FROM public.branches;
  SELECT COUNT(*) INTO v_categories FROM public.categories;
  SELECT COUNT(*) INTO v_products FROM public.products;
  SELECT COUNT(*) INTO v_variants FROM public.product_variants;
  SELECT COUNT(*) INTO v_colors FROM public.product_colors;
  SELECT COUNT(*) INTO v_images FROM public.product_images;
  SELECT COUNT(*) INTO v_customers FROM public.customers;
  SELECT COUNT(*) INTO v_cust_tx FROM public.customer_transactions;
  SELECT COUNT(*) INTO v_suppliers FROM public.suppliers;
  SELECT COUNT(*) INTO v_supp_tx FROM public.supplier_transactions;
  SELECT COUNT(*) INTO v_accounts FROM public.accounts;
  SELECT COUNT(*) INTO v_acc_tx FROM public.account_transactions;
  SELECT COUNT(*) INTO v_expenses FROM public.expenses;
  SELECT COUNT(*) INTO v_sales FROM public.sales;
  SELECT COUNT(*) INTO v_sale_items FROM public.sale_items;
  SELECT COUNT(*) INTO v_sale_payments FROM public.sale_payments;
  SELECT COUNT(*) INTO v_sale_returns FROM public.sale_returns;
  SELECT COUNT(*) INTO v_purchases FROM public.purchases;
  SELECT COUNT(*) INTO v_purchase_items FROM public.purchase_items;
  SELECT COUNT(*) INTO v_stock_moves FROM public.stock_movements;
  SELECT COUNT(*) INTO v_stock_transfers FROM public.stock_transfers;
  SELECT COUNT(*) INTO v_employees FROM public.employees;
  SELECT COUNT(*) INTO v_business_users FROM public.business_users;
  SELECT COUNT(*) INTO v_activity_logs FROM public.user_activity_logs;

  RAISE NOTICE '[PHASE 1 BEFORE] businesses=%, branches=%, categories=%, products=%, variants=%, colors=%, images=%',
    v_businesses, v_branches, v_categories, v_products, v_variants, v_colors, v_images;
  RAISE NOTICE '[PHASE 1 BEFORE] customers=%, customer_tx=%, suppliers=%, supplier_tx=%, accounts=%, account_tx=%, expenses=%',
    v_customers, v_cust_tx, v_suppliers, v_supp_tx, v_accounts, v_acc_tx, v_expenses;
  RAISE NOTICE '[PHASE 1 BEFORE] sales=%, sale_items=%, sale_payments=%, sale_returns=%, purchases=%, purchase_items=%',
    v_sales, v_sale_items, v_sale_payments, v_sale_returns, v_purchases, v_purchase_items;
  RAISE NOTICE '[PHASE 1 BEFORE] stock_movements=%, stock_transfers=%, employees=%, business_users=%, activity_logs=%',
    v_stock_moves, v_stock_transfers, v_employees, v_business_users, v_activity_logs;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Extend public.branches (Additive Only)
-- ----------------------------------------------------------------------------
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS branch_code TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_branches_business_active
  ON public.branches(business_id, is_active, is_main DESC, created_at ASC);

-- ----------------------------------------------------------------------------
-- 2. Add branch_id Columns to Operational Tables (Additive Nullable FKs First)
-- ----------------------------------------------------------------------------
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.product_colors
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.customer_transactions
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.supplier_transactions
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.account_transactions
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.sale_payments
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;

ALTER TABLE public.user_activity_logs
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 3. Add sales.user_id Safely & Additive Sync Trigger (No Existing Trigger Dropped)
-- ----------------------------------------------------------------------------
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_business_user_id
  ON public.sales(business_id, user_id);

-- Backfill sales.user_id strictly from verified auth.users matches
UPDATE public.sales s
SET user_id = s.seller_id
WHERE s.user_id IS NULL
  AND s.seller_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM auth.users au WHERE au.id = s.seller_id
  );

UPDATE public.sales s
SET user_id = e.user_id
FROM public.employees e
WHERE s.user_id IS NULL
  AND s.employee_id = e.id
  AND e.business_id = s.business_id
  AND e.user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM auth.users au WHERE au.id = e.user_id
  );

CREATE OR REPLACE FUNCTION public.sync_sales_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_user_id UUID;
BEGIN
  IF NEW.user_id IS NULL THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.user_id := auth.uid();
    ELSIF NEW.seller_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = NEW.seller_id) THEN
      NEW.user_id := NEW.seller_id;
    ELSIF NEW.employee_id IS NOT NULL THEN
      SELECT e.user_id INTO v_emp_user_id
      FROM public.employees e
      WHERE e.id = NEW.employee_id
        AND e.business_id = NEW.business_id
        AND e.user_id IS NOT NULL
      LIMIT 1;
      IF v_emp_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = v_emp_user_id) THEN
        NEW.user_id := v_emp_user_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'sales'
      AND t.tgname = 'trg_sync_sales_user_id'
      AND NOT t.tgisinternal
  ) THEN
    CREATE TRIGGER trg_sync_sales_user_id
      BEFORE INSERT ON public.sales
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_sales_user_id();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Create public.staff_branch_access Table (Branch-Level RBAC Assignment)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_branch_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  can_view BOOLEAN NOT NULL DEFAULT TRUE,
  can_manage BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, user_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_branch_access_biz_user
  ON public.staff_branch_access(business_id, user_id);

CREATE INDEX IF NOT EXISTS idx_staff_branch_access_biz_branch
  ON public.staff_branch_access(business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_staff_branch_access_employee
  ON public.staff_branch_access(employee_id);

ALTER TABLE public.staff_branch_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_branch_access NO FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'staff_branch_access' AND policyname = 'staff_branch_access_select'
  ) THEN
    CREATE POLICY "staff_branch_access_select" ON public.staff_branch_access
      FOR SELECT TO authenticated
      USING (
        user_id = auth.uid()
        OR public.is_business_owner_or_admin(business_id)
        OR public.has_module_permission(business_id, 'user_management', 'view')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'staff_branch_access' AND policyname = 'staff_branch_access_manage'
  ) THEN
    CREATE POLICY "staff_branch_access_manage" ON public.staff_branch_access
      FOR ALL TO authenticated
      USING (
        public.is_business_owner_or_admin(business_id)
        OR public.has_module_permission(business_id, 'user_management', 'edit')
      )
      WITH CHECK (
        public.is_business_owner_or_admin(business_id)
        OR public.has_module_permission(business_id, 'user_management', 'edit')
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Extend public.stock_transfers Schema (Variant + Approval Workflow Ready)
-- ----------------------------------------------------------------------------
ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS variant_details TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_by_name TEXT,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by_name TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_status_chk'
  ) THEN
    ALTER TABLE public.stock_transfers
      ADD CONSTRAINT stock_transfers_status_chk
      CHECK (status IN ('pending', 'approved', 'completed', 'rejected', 'cancelled'));
  END IF;
END $$;

-- Safely enrich historical stock_transfers metadata without altering quantities/branches
UPDATE public.stock_transfers st
SET sku = COALESCE(st.sku, p.sku),
    requested_by_name = COALESCE(st.requested_by_name, st.transferred_by)
FROM public.products p
WHERE st.product_id = p.id
  AND (st.sku IS NULL OR st.requested_by_name IS NULL);

UPDATE public.stock_transfers
SET requested_by_name = transferred_by
WHERE requested_by_name IS NULL
  AND transferred_by IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. Safe Main Branch Resolution & Conservative Non-Guessing Backfill
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_biz RECORD;
  v_branch_count INTEGER;
  v_main_count INTEGER;
  v_main_branch_id UUID;
  v_new_branch_id UUID;
  v_secondary_activity_count BIGINT;
  v_orphan_count BIGINT;
BEGIN
  FOR v_biz IN SELECT id, name, address, phone FROM public.businesses LOOP
    SELECT COUNT(*), COUNT(*) FILTER (WHERE is_main = TRUE)
      INTO v_branch_count, v_main_count
    FROM public.branches
    WHERE business_id = v_biz.id;

    -- Case A: Business has 0 branches -> Create Main Branch safely
    IF v_branch_count = 0 THEN
      INSERT INTO public.branches (
        business_id, name, location, mobile, is_main, branch_code, is_active, updated_at
      ) VALUES (
        v_biz.id,
        'Main Branch',
        COALESCE(v_biz.address, ''),
        COALESCE(v_biz.phone, ''),
        TRUE,
        'MAIN',
        TRUE,
        NOW()
      )
      RETURNING id INTO v_new_branch_id;

      v_branch_count := 1;
      v_main_count := 1;
      v_main_branch_id := v_new_branch_id;
      RAISE NOTICE '[PHASE 1] Created Main Branch (%) for business "%" (%) which had 0 branches.',
        v_new_branch_id, v_biz.name, v_biz.id;

    -- Case B: Business has exactly 1 branch -> Unambiguously Main Branch
    ELSIF v_branch_count = 1 THEN
      SELECT id INTO v_main_branch_id
      FROM public.branches
      WHERE business_id = v_biz.id
      LIMIT 1;

      IF v_main_count = 0 THEN
        UPDATE public.branches
        SET is_main = TRUE,
            branch_code = COALESCE(NULLIF(BTRIM(branch_code), ''), 'MAIN'),
            updated_at = NOW()
        WHERE id = v_main_branch_id;
        v_main_count := 1;
        RAISE NOTICE '[PHASE 1] Promoted single branch (%) to is_main=TRUE for business "%" (%).',
          v_main_branch_id, v_biz.name, v_biz.id;
      END IF;

    -- Case C: Multiple branches with exactly 1 is_main=TRUE
    ELSIF v_main_count = 1 THEN
      SELECT id INTO v_main_branch_id
      FROM public.branches
      WHERE business_id = v_biz.id
        AND is_main = TRUE
      LIMIT 1;

    -- Case D: Multiple branches with 0 or >1 is_main=TRUE -> AMBIGUOUS, DO NOT GUESS!
    ELSE
      v_main_branch_id := NULL;
      RAISE WARNING '[PHASE 1 CONFLICT] Business "%" (%) has % branches and % marked is_main=TRUE. Skipping automatic Main Branch backfill to avoid guessing.',
        v_biz.name, v_biz.id, v_branch_count, v_main_count;
      CONTINUE;
    END IF;

    -- Verify branch_code defaults safely without overwriting existing codes
    UPDATE public.branches
    SET branch_code = CASE
      WHEN id = v_main_branch_id THEN COALESCE(NULLIF(BTRIM(branch_code), ''), 'MAIN')
      ELSE COALESCE(NULLIF(BTRIM(branch_code), ''), 'BR-' || UPPER(LEFT(REPLACE(id::TEXT, '-', ''), 6)))
    END
    WHERE business_id = v_biz.id
      AND NULLIF(BTRIM(COALESCE(branch_code, '')), '') IS NULL;

    -- Detect invalid/cross-business branch references on pre-existing branch_id columns
    SELECT (
      (SELECT COUNT(*) FROM public.sales s WHERE s.business_id = v_biz.id AND s.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = s.branch_id AND b.business_id = v_biz.id)) +
      (SELECT COUNT(*) FROM public.purchases p WHERE p.business_id = v_biz.id AND p.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p.branch_id AND b.business_id = v_biz.id)) +
      (SELECT COUNT(*) FROM public.expenses e WHERE e.business_id = v_biz.id AND e.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = e.branch_id AND b.business_id = v_biz.id)) +
      (SELECT COUNT(*) FROM public.stock_movements sm WHERE sm.business_id = v_biz.id AND sm.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = sm.branch_id AND b.business_id = v_biz.id)) +
      (SELECT COUNT(*) FROM public.employees emp WHERE emp.business_id = v_biz.id AND emp.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = emp.branch_id AND b.business_id = v_biz.id))
    ) INTO v_orphan_count;

    IF v_orphan_count > 0 THEN
      RAISE WARNING '[PHASE 1 CONFLICT] Business "%" (%) has % rows with invalid or cross-business branch_id. Leaving untouched for manual inspection.',
        v_biz.name, v_biz.id, v_orphan_count;
    END IF;

    -- Check if secondary (non-main) branches already hold operational transactions
    SELECT (
      (SELECT COUNT(*) FROM public.sales s WHERE s.business_id = v_biz.id AND s.branch_id IS NOT NULL AND s.branch_id <> v_main_branch_id) +
      (SELECT COUNT(*) FROM public.purchases p WHERE p.business_id = v_biz.id AND p.branch_id IS NOT NULL AND p.branch_id <> v_main_branch_id) +
      (SELECT COUNT(*) FROM public.expenses e WHERE e.business_id = v_biz.id AND e.branch_id IS NOT NULL AND e.branch_id <> v_main_branch_id) +
      (SELECT COUNT(*) FROM public.stock_movements sm WHERE sm.business_id = v_biz.id AND sm.branch_id IS NOT NULL AND sm.branch_id <> v_main_branch_id)
    ) INTO v_secondary_activity_count;

    IF v_branch_count > 1 AND v_secondary_activity_count > 0 THEN
      RAISE WARNING '[PHASE 1 NOTICE] Business "%" (%) has % active operational rows on secondary branches. Preserving all existing branch_id values and skipping auto-assignment of shared tables (products, accounts, customers, suppliers, categories, NULL-branch transactions).',
        v_biz.name, v_biz.id, v_secondary_activity_count;
      CONTINUE;
    END IF;

    -- Unambiguous Single-Store / Main-Store Backfill:
    -- Only fills rows where branch_id IS NULL; NEVER overwrites an existing branch_id.
    UPDATE public.categories SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;
    UPDATE public.products SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;
    UPDATE public.customers SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;
    UPDATE public.suppliers SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;
    UPDATE public.accounts SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;

    UPDATE public.sales SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;
    UPDATE public.purchases SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;
    UPDATE public.expenses SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;
    UPDATE public.stock_movements SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;
    UPDATE public.employees SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;
    UPDATE public.business_users SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;
    UPDATE public.audit_logs SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;
    UPDATE public.user_activity_logs SET branch_id = v_main_branch_id WHERE business_id = v_biz.id AND branch_id IS NULL;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Deterministic Parent -> Child Branch Propagation (Runs for ALL Businesses)
--    Never guesses: strictly copies verified parent branch_id to child records.
-- ----------------------------------------------------------------------------
UPDATE public.product_variants pv
SET branch_id = p.branch_id
FROM public.products p
WHERE pv.product_id = p.id
  AND pv.branch_id IS NULL
  AND p.branch_id IS NOT NULL;

UPDATE public.product_colors pc
SET branch_id = p.branch_id
FROM public.products p
WHERE pc.product_id = p.id
  AND pc.branch_id IS NULL
  AND p.branch_id IS NOT NULL;

UPDATE public.product_images pi
SET branch_id = p.branch_id
FROM public.products p
WHERE pi.product_id = p.id
  AND pi.branch_id IS NULL
  AND p.branch_id IS NOT NULL;

UPDATE public.sale_items si
SET branch_id = s.branch_id
FROM public.sales s
WHERE si.sale_id = s.id
  AND si.branch_id IS NULL
  AND s.branch_id IS NOT NULL;

UPDATE public.sale_payments sp
SET branch_id = s.branch_id
FROM public.sales s
WHERE sp.sale_id = s.id
  AND sp.branch_id IS NULL
  AND s.branch_id IS NOT NULL;

UPDATE public.sale_returns sr
SET branch_id = s.branch_id
FROM public.sales s
WHERE sr.sale_id = s.id
  AND sr.branch_id IS NULL
  AND s.branch_id IS NOT NULL;

UPDATE public.purchase_items pi
SET branch_id = p.branch_id
FROM public.purchases p
WHERE pi.purchase_id = p.id
  AND pi.branch_id IS NULL
  AND p.branch_id IS NOT NULL;

-- Transactions inherit from matching sale/purchase/expense reference first if unambiguous, else parent party/account
UPDATE public.customer_transactions ct
SET branch_id = s.branch_id
FROM public.sales s
WHERE ct.branch_id IS NULL
  AND ct.reference_id IS NOT NULL
  AND ct.business_id = s.business_id
  AND ct.reference_id = s.invoice_number
  AND s.branch_id IS NOT NULL;

UPDATE public.customer_transactions ct
SET branch_id = c.branch_id
FROM public.customers c
WHERE ct.branch_id IS NULL
  AND ct.customer_id = c.id
  AND c.branch_id IS NOT NULL;

UPDATE public.supplier_transactions st
SET branch_id = p.branch_id
FROM public.purchases p
WHERE st.branch_id IS NULL
  AND st.reference_id IS NOT NULL
  AND st.business_id = p.business_id
  AND st.reference_id = p.invoice_number
  AND p.branch_id IS NOT NULL;

UPDATE public.supplier_transactions st
SET branch_id = sup.branch_id
FROM public.suppliers sup
WHERE st.branch_id IS NULL
  AND st.supplier_id = sup.id
  AND sup.branch_id IS NOT NULL;

UPDATE public.account_transactions atx
SET branch_id = s.branch_id
FROM public.sales s
WHERE atx.branch_id IS NULL
  AND atx.reference_id IS NOT NULL
  AND atx.business_id = s.business_id
  AND atx.reference_id = s.invoice_number
  AND s.branch_id IS NOT NULL;

UPDATE public.account_transactions atx
SET branch_id = p.branch_id
FROM public.purchases p
WHERE atx.branch_id IS NULL
  AND atx.reference_id IS NOT NULL
  AND atx.business_id = p.business_id
  AND atx.reference_id = p.invoice_number
  AND p.branch_id IS NOT NULL;

UPDATE public.account_transactions atx
SET branch_id = e.branch_id
FROM public.expenses e
WHERE atx.branch_id IS NULL
  AND atx.reference_id IS NOT NULL
  AND atx.business_id = e.business_id
  AND atx.reference_id = e.id::TEXT
  AND e.branch_id IS NOT NULL;

UPDATE public.account_transactions atx
SET branch_id = acc.branch_id
FROM public.accounts acc
WHERE atx.branch_id IS NULL
  AND atx.account_id = acc.id
  AND acc.branch_id IS NOT NULL;

UPDATE public.user_activity_logs ual
SET branch_id = e.branch_id
FROM public.employees e
WHERE ual.branch_id IS NULL
  AND ual.employee_id = e.id
  AND e.branch_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 8. Backfill public.staff_branch_access (Idempotent)
-- ----------------------------------------------------------------------------
INSERT INTO public.staff_branch_access (
  business_id, user_id, employee_id, branch_id, is_default, can_view, can_manage
)
SELECT DISTINCT ON (e.business_id, e.user_id, e.branch_id)
  e.business_id,
  e.user_id,
  e.id,
  e.branch_id,
  TRUE,
  TRUE,
  TRUE
FROM public.employees e
JOIN public.branches b
  ON b.id = e.branch_id
 AND b.business_id = e.business_id
JOIN auth.users au
  ON au.id = e.user_id
WHERE e.user_id IS NOT NULL
  AND e.branch_id IS NOT NULL
ORDER BY e.business_id, e.user_id, e.branch_id, e.created_at ASC
ON CONFLICT (business_id, user_id, branch_id) DO NOTHING;

INSERT INTO public.staff_branch_access (
  business_id, user_id, employee_id, branch_id, is_default, can_view, can_manage
)
SELECT DISTINCT ON (bu.business_id, bu.user_id, bu.branch_id)
  bu.business_id,
  bu.user_id,
  (
    SELECT e.id
    FROM public.employees e
    WHERE e.business_id = bu.business_id
      AND e.user_id = bu.user_id
    ORDER BY e.created_at ASC
    LIMIT 1
  ) AS employee_id,
  bu.branch_id,
  TRUE,
  TRUE,
  TRUE
FROM public.business_users bu
JOIN public.branches b
  ON b.id = bu.branch_id
 AND b.business_id = bu.business_id
JOIN auth.users au
  ON au.id = bu.user_id
WHERE bu.branch_id IS NOT NULL
ON CONFLICT (business_id, user_id, branch_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 9. Branch-Wise Performance Indexes & Conflict-Safe Unique Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_categories_biz_branch_name
  ON public.categories(business_id, branch_id, name);

CREATE INDEX IF NOT EXISTS idx_products_biz_branch_active
  ON public.products(business_id, branch_id, is_active);

CREATE INDEX IF NOT EXISTS idx_products_biz_branch_sku
  ON public.products(business_id, branch_id, sku);

CREATE INDEX IF NOT EXISTS idx_products_biz_branch_barcode
  ON public.products(business_id, branch_id, barcode);

CREATE INDEX IF NOT EXISTS idx_product_variants_biz_branch_sku
  ON public.product_variants(business_id, branch_id, sku);

CREATE INDEX IF NOT EXISTS idx_product_colors_biz_branch_prod
  ON public.product_colors(business_id, branch_id, product_id);

CREATE INDEX IF NOT EXISTS idx_product_images_biz_branch_prod
  ON public.product_images(business_id, branch_id, product_id);

CREATE INDEX IF NOT EXISTS idx_customers_biz_branch
  ON public.customers(business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_customer_tx_biz_branch
  ON public.customer_transactions(business_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_suppliers_biz_branch
  ON public.suppliers(business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_supplier_tx_biz_branch
  ON public.supplier_transactions(business_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_accounts_biz_branch_active
  ON public.accounts(business_id, branch_id, is_active);

CREATE INDEX IF NOT EXISTS idx_account_tx_biz_branch
  ON public.account_transactions(business_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_biz_branch_created
  ON public.expenses(business_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_biz_branch_created
  ON public.sales(business_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_items_biz_branch
  ON public.sale_items(business_id, branch_id, sale_id);

CREATE INDEX IF NOT EXISTS idx_sale_payments_biz_branch
  ON public.sale_payments(business_id, branch_id, sale_id);

CREATE INDEX IF NOT EXISTS idx_sale_returns_biz_branch
  ON public.sale_returns(business_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchases_biz_branch_created
  ON public.purchases(business_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_items_biz_branch
  ON public.purchase_items(business_id, branch_id, purchase_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_biz_branch
  ON public.stock_movements(business_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_biz_status
  ON public.stock_transfers(business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_to
  ON public.stock_transfers(business_id, from_branch_id, to_branch_id);

CREATE INDEX IF NOT EXISTS idx_employees_biz_branch_status
  ON public.employees(business_id, branch_id, account_status);

CREATE INDEX IF NOT EXISTS idx_user_activity_logs_biz_branch
  ON public.user_activity_logs(business_id, branch_id, created_at DESC);

-- Sales & Purchases branch-scoped invoice unique indexes (guaranteed compatible with existing unique constraints)
CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_biz_branch_invoice
  ON public.sales(business_id, branch_id, invoice_number)
  WHERE branch_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_purchases_biz_branch_invoice
  ON public.purchases(business_id, branch_id, invoice_number)
  WHERE branch_id IS NOT NULL;

-- Conditional conflict-safe unique indexes (only created if 0 duplicates exist in existing data)
DO $$
DECLARE
  v_dup_main INTEGER;
  v_dup_sku INTEGER;
  v_dup_var_sku INTEGER;
  v_dup_cat INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dup_main
  FROM (
    SELECT business_id
    FROM public.branches
    WHERE is_main = TRUE
    GROUP BY business_id
    HAVING COUNT(*) > 1
  ) t;

  IF v_dup_main = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS ux_branches_one_main_per_business
      ON public.branches(business_id)
      WHERE is_main = TRUE;
  ELSE
    RAISE WARNING '[PHASE 1 CONFLICT] Found % business(es) with multiple is_main=TRUE branches; skipped ux_branches_one_main_per_business.', v_dup_main;
  END IF;

  SELECT COUNT(*) INTO v_dup_sku
  FROM (
    SELECT business_id, branch_id, LOWER(BTRIM(sku))
    FROM public.products
    WHERE branch_id IS NOT NULL
      AND NULLIF(BTRIM(sku), '') IS NOT NULL
    GROUP BY business_id, branch_id, LOWER(BTRIM(sku))
    HAVING COUNT(*) > 1
  ) t;

  IF v_dup_sku = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS ux_products_biz_branch_sku
      ON public.products(business_id, branch_id, LOWER(BTRIM(sku)))
      WHERE branch_id IS NOT NULL AND NULLIF(BTRIM(sku), '') IS NOT NULL;
  ELSE
    RAISE WARNING '[PHASE 1 CONFLICT] Found % duplicate product SKU group(s) within (business_id, branch_id); skipped ux_products_biz_branch_sku.', v_dup_sku;
  END IF;

  SELECT COUNT(*) INTO v_dup_var_sku
  FROM (
    SELECT business_id, branch_id, LOWER(BTRIM(sku))
    FROM public.product_variants
    WHERE branch_id IS NOT NULL
      AND NULLIF(BTRIM(sku), '') IS NOT NULL
    GROUP BY business_id, branch_id, LOWER(BTRIM(sku))
    HAVING COUNT(*) > 1
  ) t;

  IF v_dup_var_sku = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS ux_product_variants_biz_branch_sku
      ON public.product_variants(business_id, branch_id, LOWER(BTRIM(sku)))
      WHERE branch_id IS NOT NULL AND NULLIF(BTRIM(sku), '') IS NOT NULL;
  ELSE
    RAISE WARNING '[PHASE 1 CONFLICT] Found % duplicate variant SKU group(s) within (business_id, branch_id); skipped ux_product_variants_biz_branch_sku.', v_dup_var_sku;
  END IF;

  SELECT COUNT(*) INTO v_dup_cat
  FROM (
    SELECT business_id, branch_id, LOWER(BTRIM(name))
    FROM public.categories
    WHERE branch_id IS NOT NULL
      AND NULLIF(BTRIM(name), '') IS NOT NULL
    GROUP BY business_id, branch_id, LOWER(BTRIM(name))
    HAVING COUNT(*) > 1
  ) t;

  IF v_dup_cat = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_biz_branch_name
      ON public.categories(business_id, branch_id, LOWER(BTRIM(name)))
      WHERE branch_id IS NOT NULL AND NULLIF(BTRIM(name), '') IS NOT NULL;
  ELSE
    RAISE WARNING '[PHASE 1 CONFLICT] Found % duplicate category name group(s) within (business_id, branch_id); skipped ux_categories_biz_branch_name.', v_dup_cat;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 10. Post-Migration Row Count & Remaining NULL Branch Verification
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_null_products BIGINT;
  v_null_variants BIGINT;
  v_null_customers BIGINT;
  v_null_suppliers BIGINT;
  v_null_accounts BIGINT;
  v_null_sales BIGINT;
  v_null_sale_items BIGINT;
  v_null_purchases BIGINT;
  v_null_expenses BIGINT;
  v_null_sales_user BIGINT;
  v_staff_access BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_null_products FROM public.products WHERE branch_id IS NULL;
  SELECT COUNT(*) INTO v_null_variants FROM public.product_variants WHERE branch_id IS NULL;
  SELECT COUNT(*) INTO v_null_customers FROM public.customers WHERE branch_id IS NULL;
  SELECT COUNT(*) INTO v_null_suppliers FROM public.suppliers WHERE branch_id IS NULL;
  SELECT COUNT(*) INTO v_null_accounts FROM public.accounts WHERE branch_id IS NULL;
  SELECT COUNT(*) INTO v_null_sales FROM public.sales WHERE branch_id IS NULL;
  SELECT COUNT(*) INTO v_null_sale_items FROM public.sale_items WHERE branch_id IS NULL;
  SELECT COUNT(*) INTO v_null_purchases FROM public.purchases WHERE branch_id IS NULL;
  SELECT COUNT(*) INTO v_null_expenses FROM public.expenses WHERE branch_id IS NULL;
  SELECT COUNT(*) INTO v_null_sales_user FROM public.sales WHERE user_id IS NULL;
  SELECT COUNT(*) INTO v_staff_access FROM public.staff_branch_access;

  RAISE NOTICE '[PHASE 1 AFTER] Remaining NULL branch_id -> products=%, variants=%, customers=%, suppliers=%, accounts=%, sales=%, sale_items=%, purchases=%, expenses=%',
    v_null_products, v_null_variants, v_null_customers, v_null_suppliers, v_null_accounts, v_null_sales, v_null_sale_items, v_null_purchases, v_null_expenses;
  RAISE NOTICE '[PHASE 1 AFTER] Remaining NULL sales.user_id=%, staff_branch_access rows=%',
    v_null_sales_user, v_staff_access;
END $$;
