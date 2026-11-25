-- ============================================================================
-- Amar Dokan Pro / PROTIVA — Phase 1 Read-Only Verification & Conflict Check
-- ============================================================================
-- Strictly READ-ONLY diagnostic script for Supabase SQL Editor.
-- Contains ZERO data modifications and ZERO schema changes.
--
-- Target migration:
--   supabase/migrations/20261127_multi_branch_schema_and_backfill.sql
--
-- Structure:
--   PART 1: PRE-MIGRATION CHECKS
--     Uses ONLY existing pre-migration tables and columns.
--     Safe to run before applying the Phase 1 migration.
--
--   PART 2: POST-MIGRATION CHECKS
--     Verifies new columns, tables, backfill completeness, parent-child
--     branch consistency, staff_branch_access integrity, and unique-index
--     conflict readiness.
--     Every post-migration check validates schema existence first and reports
--     'NOT AVAILABLE' instead of failing if run before migration.
-- ============================================================================


-- ############################################################################
-- PART 1: PRE-MIGRATION CHECKS (Existing Schema Only)
-- ############################################################################

-- ----------------------------------------------------------------------------
-- 1.1 Row Counts Across All Core Operational Tables (Pre-Migration Baseline)
-- ----------------------------------------------------------------------------
SELECT 'businesses' AS table_name, COUNT(*)::BIGINT AS row_count FROM public.businesses
UNION ALL SELECT 'branches', COUNT(*)::BIGINT FROM public.branches
UNION ALL SELECT 'business_users', COUNT(*)::BIGINT FROM public.business_users
UNION ALL SELECT 'employees', COUNT(*)::BIGINT FROM public.employees
UNION ALL SELECT 'categories', COUNT(*)::BIGINT FROM public.categories
UNION ALL SELECT 'products', COUNT(*)::BIGINT FROM public.products
UNION ALL SELECT 'product_variants', COUNT(*)::BIGINT FROM public.product_variants
UNION ALL SELECT 'product_colors', COUNT(*)::BIGINT FROM public.product_colors
UNION ALL SELECT 'product_images', COUNT(*)::BIGINT FROM public.product_images
UNION ALL SELECT 'customers', COUNT(*)::BIGINT FROM public.customers
UNION ALL SELECT 'customer_transactions', COUNT(*)::BIGINT FROM public.customer_transactions
UNION ALL SELECT 'suppliers', COUNT(*)::BIGINT FROM public.suppliers
UNION ALL SELECT 'supplier_transactions', COUNT(*)::BIGINT FROM public.supplier_transactions
UNION ALL SELECT 'accounts', COUNT(*)::BIGINT FROM public.accounts
UNION ALL SELECT 'account_transactions', COUNT(*)::BIGINT FROM public.account_transactions
UNION ALL SELECT 'expenses', COUNT(*)::BIGINT FROM public.expenses
UNION ALL SELECT 'sales', COUNT(*)::BIGINT FROM public.sales
UNION ALL SELECT 'sale_items', COUNT(*)::BIGINT FROM public.sale_items
UNION ALL SELECT 'sale_payments', COUNT(*)::BIGINT FROM public.sale_payments
UNION ALL SELECT 'sale_returns', COUNT(*)::BIGINT FROM public.sale_returns
UNION ALL SELECT 'purchases', COUNT(*)::BIGINT FROM public.purchases
UNION ALL SELECT 'purchase_items', COUNT(*)::BIGINT FROM public.purchase_items
UNION ALL SELECT 'stock_movements', COUNT(*)::BIGINT FROM public.stock_movements
UNION ALL SELECT 'stock_transfers', COUNT(*)::BIGINT FROM public.stock_transfers
UNION ALL SELECT 'audit_logs', COUNT(*)::BIGINT FROM public.audit_logs
UNION ALL SELECT 'user_activity_logs', COUNT(*)::BIGINT FROM public.user_activity_logs
ORDER BY table_name;

-- ----------------------------------------------------------------------------
-- 1.2 Business, Main Branch & Secondary-Branch Activity Readiness
-- ----------------------------------------------------------------------------
SELECT
  b.id AS business_id,
  b.name AS business_name,
  COUNT(br.id) AS total_branches,
  COUNT(br.id) FILTER (WHERE br.is_main = TRUE) AS main_branch_count,
  (SELECT COUNT(*) FROM public.sales s WHERE s.business_id = b.id) AS total_sales,
  (SELECT COUNT(DISTINCT s.branch_id) FROM public.sales s WHERE s.business_id = b.id AND s.branch_id IS NOT NULL) AS distinct_sales_branches,
  (SELECT COUNT(*) FROM public.purchases p WHERE p.business_id = b.id) AS total_purchases,
  (SELECT COUNT(*) FROM public.expenses e WHERE e.business_id = b.id) AS total_expenses,
  (SELECT COUNT(*) FROM public.stock_movements sm WHERE sm.business_id = b.id) AS total_stock_movements,
  CASE
    WHEN COUNT(br.id) = 0 THEN 'NEEDS_MAIN_BRANCH'
    WHEN COUNT(br.id) > 1 AND COUNT(br.id) FILTER (WHERE br.is_main = TRUE) <> 1 THEN 'CONFLICT_AMBIGUOUS_MAIN_BRANCH'
    WHEN COUNT(br.id) > 1 AND (
      EXISTS (
        SELECT 1 FROM public.sales s
        JOIN public.branches br2 ON br2.id = s.branch_id AND br2.business_id = b.id
        WHERE s.business_id = b.id AND br2.is_main = FALSE
      )
      OR EXISTS (
        SELECT 1 FROM public.purchases p
        JOIN public.branches br2 ON br2.id = p.branch_id AND br2.business_id = b.id
        WHERE p.business_id = b.id AND br2.is_main = FALSE
      )
      OR EXISTS (
        SELECT 1 FROM public.expenses e
        JOIN public.branches br2 ON br2.id = e.branch_id AND br2.business_id = b.id
        WHERE e.business_id = b.id AND br2.is_main = FALSE
      )
      OR EXISTS (
        SELECT 1 FROM public.stock_movements sm
        JOIN public.branches br2 ON br2.id = sm.branch_id AND br2.business_id = b.id
        WHERE sm.business_id = b.id AND br2.is_main = FALSE
      )
    ) THEN 'MULTI_BRANCH_ACTIVE_RECORDS_EXIST'
    ELSE 'READY_OR_SINGLE_BRANCH_CLEAN'
  END AS audit_status
FROM public.businesses b
LEFT JOIN public.branches br ON br.business_id = b.id
GROUP BY b.id, b.name, b.created_at
ORDER BY b.created_at ASC;

-- ----------------------------------------------------------------------------
-- 1.3 Multiple Main Branch Detection Per Business (Pre-Migration)
-- ----------------------------------------------------------------------------
SELECT
  b.id AS business_id,
  b.name AS business_name,
  COUNT(br.id) AS total_branches,
  COUNT(br.id) FILTER (WHERE br.is_main = TRUE) AS main_branch_count,
  CASE
    WHEN COUNT(br.id) FILTER (WHERE br.is_main = TRUE) > 1 THEN 'MULTIPLE_MAIN_BRANCHES'
    WHEN COUNT(br.id) > 1 AND COUNT(br.id) FILTER (WHERE br.is_main = TRUE) = 0 THEN 'NO_MAIN_BRANCH_WITH_MULTIPLE_BRANCHES'
    ELSE 'OK'
  END AS conflict_type
FROM public.businesses b
LEFT JOIN public.branches br ON br.business_id = b.id
GROUP BY b.id, b.name
HAVING COUNT(br.id) FILTER (WHERE br.is_main = TRUE) > 1
    OR (COUNT(br.id) > 1 AND COUNT(br.id) FILTER (WHERE br.is_main = TRUE) = 0)
ORDER BY b.name;

-- ----------------------------------------------------------------------------
-- 1.4 Pre-Migration NULL branch_id Counts (Existing Branch-Aware Tables)
-- ----------------------------------------------------------------------------
SELECT 'business_users.branch_id' AS column_ref, COUNT(*) FILTER (WHERE branch_id IS NULL) AS null_count, COUNT(*) AS total_rows FROM public.business_users
UNION ALL
SELECT 'employees.branch_id', COUNT(*) FILTER (WHERE branch_id IS NULL), COUNT(*) FROM public.employees
UNION ALL
SELECT 'expenses.branch_id', COUNT(*) FILTER (WHERE branch_id IS NULL), COUNT(*) FROM public.expenses
UNION ALL
SELECT 'sales.branch_id', COUNT(*) FILTER (WHERE branch_id IS NULL), COUNT(*) FROM public.sales
UNION ALL
SELECT 'purchases.branch_id', COUNT(*) FILTER (WHERE branch_id IS NULL), COUNT(*) FROM public.purchases
UNION ALL
SELECT 'stock_movements.branch_id', COUNT(*) FILTER (WHERE branch_id IS NULL), COUNT(*) FROM public.stock_movements
UNION ALL
SELECT 'audit_logs.branch_id', COUNT(*) FILTER (WHERE branch_id IS NULL), COUNT(*) FROM public.audit_logs
UNION ALL
SELECT 'stock_transfers.from_branch_id', COUNT(*) FILTER (WHERE from_branch_id IS NULL), COUNT(*) FROM public.stock_transfers
UNION ALL
SELECT 'stock_transfers.to_branch_id', COUNT(*) FILTER (WHERE to_branch_id IS NULL), COUNT(*) FROM public.stock_transfers
ORDER BY column_ref;

-- ----------------------------------------------------------------------------
-- 1.5 Pre-Migration Invalid or Cross-Business branch_id References
-- ----------------------------------------------------------------------------
SELECT 'business_users_invalid_branch' AS check_name, COUNT(*) AS issue_count
FROM public.business_users bu
WHERE bu.branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.branches br
    WHERE br.id = bu.branch_id AND br.business_id = bu.business_id
  )
UNION ALL
SELECT 'employees_invalid_branch', COUNT(*)
FROM public.employees emp
WHERE emp.branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.branches br
    WHERE br.id = emp.branch_id AND br.business_id = emp.business_id
  )
UNION ALL
SELECT 'expenses_invalid_branch', COUNT(*)
FROM public.expenses e
WHERE e.branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.branches br
    WHERE br.id = e.branch_id AND br.business_id = e.business_id
  )
UNION ALL
SELECT 'sales_invalid_branch', COUNT(*)
FROM public.sales s
WHERE s.branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.branches br
    WHERE br.id = s.branch_id AND br.business_id = s.business_id
  )
UNION ALL
SELECT 'purchases_invalid_branch', COUNT(*)
FROM public.purchases p
WHERE p.branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.branches br
    WHERE br.id = p.branch_id AND br.business_id = p.business_id
  )
UNION ALL
SELECT 'stock_movements_invalid_branch', COUNT(*)
FROM public.stock_movements sm
WHERE sm.branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.branches br
    WHERE br.id = sm.branch_id AND br.business_id = sm.business_id
  )
UNION ALL
SELECT 'audit_logs_invalid_branch', COUNT(*)
FROM public.audit_logs al
WHERE al.branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.branches br
    WHERE br.id = al.branch_id AND br.business_id = al.business_id
  )
ORDER BY check_name;

-- ----------------------------------------------------------------------------
-- 1.6 Pre-Migration Stock Transfer Source & Destination Branch Validation
-- ----------------------------------------------------------------------------
SELECT 'stock_transfers_null_source_or_dest' AS check_name, COUNT(*) AS issue_count
FROM public.stock_transfers st
WHERE st.from_branch_id IS NULL OR st.to_branch_id IS NULL
UNION ALL
SELECT 'stock_transfers_invalid_or_cross_biz_from_branch', COUNT(*)
FROM public.stock_transfers st
WHERE st.from_branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.branches br
    WHERE br.id = st.from_branch_id AND br.business_id = st.business_id
  )
UNION ALL
SELECT 'stock_transfers_invalid_or_cross_biz_to_branch', COUNT(*)
FROM public.stock_transfers st
WHERE st.to_branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.branches br
    WHERE br.id = st.to_branch_id AND br.business_id = st.business_id
  )
UNION ALL
SELECT 'stock_transfers_same_source_and_dest_branch', COUNT(*)
FROM public.stock_transfers st
WHERE st.from_branch_id IS NOT NULL
  AND st.to_branch_id IS NOT NULL
  AND st.from_branch_id = st.to_branch_id
UNION ALL
SELECT 'stock_transfers_invalid_or_cross_biz_product', COUNT(*)
FROM public.stock_transfers st
WHERE st.product_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = st.product_id AND p.business_id = st.business_id
  )
ORDER BY check_name;

-- ----------------------------------------------------------------------------
-- 1.7 Pre-Migration Employees with Linked Auth User Validation
-- ----------------------------------------------------------------------------
SELECT 'employees_with_valid_auth_user_missing_branch' AS check_name, COUNT(*) AS issue_count
FROM public.employees emp
JOIN auth.users au ON au.id = emp.user_id
WHERE emp.branch_id IS NULL
UNION ALL
SELECT 'employees_with_invalid_auth_user_ref', COUNT(*)
FROM public.employees emp
WHERE emp.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = emp.user_id)
UNION ALL
SELECT 'business_users_missing_branch_id', COUNT(*)
FROM public.business_users bu
JOIN auth.users au ON au.id = bu.user_id
WHERE bu.branch_id IS NULL
ORDER BY check_name;

-- ----------------------------------------------------------------------------
-- 1.8 Pre-Migration Duplicate Risk Checks (Potential Unique-Index Conflicts)
-- ----------------------------------------------------------------------------
-- Summary counts across SKU, Variant SKU, Category Name, Sales & Purchase Invoice
SELECT 'dup_product_sku_within_business' AS check_name, COUNT(*) AS conflict_group_count
FROM (
  SELECT business_id, LOWER(BTRIM(sku))
  FROM public.products
  WHERE NULLIF(BTRIM(sku), '') IS NOT NULL
  GROUP BY business_id, LOWER(BTRIM(sku))
  HAVING COUNT(*) > 1
) t
UNION ALL
SELECT 'dup_variant_sku_within_business', COUNT(*)
FROM (
  SELECT business_id, LOWER(BTRIM(sku))
  FROM public.product_variants
  WHERE NULLIF(BTRIM(sku), '') IS NOT NULL
  GROUP BY business_id, LOWER(BTRIM(sku))
  HAVING COUNT(*) > 1
) t
UNION ALL
SELECT 'dup_category_name_within_business', COUNT(*)
FROM (
  SELECT business_id, LOWER(BTRIM(name))
  FROM public.categories
  WHERE NULLIF(BTRIM(name), '') IS NOT NULL
  GROUP BY business_id, LOWER(BTRIM(name))
  HAVING COUNT(*) > 1
) t
UNION ALL
SELECT 'dup_sales_invoice_within_business_and_branch', COUNT(*)
FROM (
  SELECT business_id, branch_id, LOWER(BTRIM(invoice_number))
  FROM public.sales
  WHERE NULLIF(BTRIM(invoice_number), '') IS NOT NULL
  GROUP BY business_id, branch_id, LOWER(BTRIM(invoice_number))
  HAVING COUNT(*) > 1
) t
UNION ALL
SELECT 'dup_purchases_invoice_within_business_and_branch', COUNT(*)
FROM (
  SELECT business_id, branch_id, LOWER(BTRIM(invoice_number))
  FROM public.purchases
  WHERE NULLIF(BTRIM(invoice_number), '') IS NOT NULL
  GROUP BY business_id, branch_id, LOWER(BTRIM(invoice_number))
  HAVING COUNT(*) > 1
) t
ORDER BY check_name;

-- Detailed Pre-Migration Duplicate Listings (Only returns rows if conflicts exist)
SELECT 'product_sku' AS conflict_scope, business_id, NULL::UUID AS branch_id, LOWER(BTRIM(sku)) AS normalized_value, COUNT(*) AS duplicate_count
FROM public.products
WHERE NULLIF(BTRIM(sku), '') IS NOT NULL
GROUP BY business_id, LOWER(BTRIM(sku))
HAVING COUNT(*) > 1
UNION ALL
SELECT 'product_variant_sku', business_id, NULL::UUID, LOWER(BTRIM(sku)), COUNT(*)
FROM public.product_variants
WHERE NULLIF(BTRIM(sku), '') IS NOT NULL
GROUP BY business_id, LOWER(BTRIM(sku))
HAVING COUNT(*) > 1
UNION ALL
SELECT 'category_name', business_id, NULL::UUID, LOWER(BTRIM(name)), COUNT(*)
FROM public.categories
WHERE NULLIF(BTRIM(name), '') IS NOT NULL
GROUP BY business_id, LOWER(BTRIM(name))
HAVING COUNT(*) > 1
UNION ALL
SELECT 'sales_invoice_number', business_id, branch_id, LOWER(BTRIM(invoice_number)), COUNT(*)
FROM public.sales
WHERE NULLIF(BTRIM(invoice_number), '') IS NOT NULL
GROUP BY business_id, branch_id, LOWER(BTRIM(invoice_number))
HAVING COUNT(*) > 1
UNION ALL
SELECT 'purchase_invoice_number', business_id, branch_id, LOWER(BTRIM(invoice_number)), COUNT(*)
FROM public.purchases
WHERE NULLIF(BTRIM(invoice_number), '') IS NOT NULL
GROUP BY business_id, branch_id, LOWER(BTRIM(invoice_number))
HAVING COUNT(*) > 1
ORDER BY conflict_scope, business_id, normalized_value;


-- ############################################################################
-- PART 2: POST-MIGRATION CHECKS (Schema-Existence Guarded — Safe Anytime)
-- ############################################################################
-- Every check below uses information_schema guards and query_to_xml / DO blocks
-- so that running this script BEFORE Phase 1 migration never fails with
-- "column/relation does not exist" errors and clearly reports 'NOT AVAILABLE'.

-- ----------------------------------------------------------------------------
-- 2.1 Post-Migration Schema Objects & Columns Presence Audit
-- ----------------------------------------------------------------------------
WITH expected_columns(object_type, table_name, column_name) AS (
  VALUES
    ('column', 'branches', 'branch_code'),
    ('column', 'branches', 'is_active'),
    ('column', 'categories', 'branch_id'),
    ('column', 'products', 'branch_id'),
    ('column', 'product_variants', 'branch_id'),
    ('column', 'product_colors', 'branch_id'),
    ('column', 'product_images', 'branch_id'),
    ('column', 'customers', 'branch_id'),
    ('column', 'customer_transactions', 'branch_id'),
    ('column', 'suppliers', 'branch_id'),
    ('column', 'supplier_transactions', 'branch_id'),
    ('column', 'accounts', 'branch_id'),
    ('column', 'account_transactions', 'branch_id'),
    ('column', 'sale_items', 'branch_id'),
    ('column', 'sale_payments', 'branch_id'),
    ('column', 'sale_returns', 'branch_id'),
    ('column', 'purchase_items', 'branch_id'),
    ('column', 'purchase_items', 'variant_id'),
    ('column', 'user_activity_logs', 'branch_id'),
    ('column', 'sales', 'user_id'),
    ('column', 'stock_transfers', 'variant_id'),
    ('column', 'stock_transfers', 'target_product_id'),
    ('column', 'stock_transfers', 'target_variant_id'),
    ('column', 'stock_transfers', 'status')
)
SELECT
  ec.object_type,
  ec.table_name || '.' || ec.column_name AS target_object,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = ec.table_name
        AND c.column_name = ec.column_name
    ) THEN 'AVAILABLE'
    ELSE 'NOT AVAILABLE'
  END AS availability
FROM expected_columns ec
UNION ALL
SELECT
  'table',
  'public.staff_branch_access',
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = 'staff_branch_access'
    ) THEN 'AVAILABLE'
    ELSE 'NOT AVAILABLE'
  END
UNION ALL
SELECT
  'index',
  idx_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_indexes pi
      WHERE pi.schemaname = 'public' AND pi.indexname = idx_name
    ) THEN 'AVAILABLE'
    ELSE 'NOT AVAILABLE'
  END
FROM (
  VALUES
    ('ux_branches_one_main_per_business'),
    ('ux_products_biz_branch_sku'),
    ('ux_product_variants_biz_branch_sku'),
    ('ux_categories_biz_branch_name'),
    ('ux_sales_biz_branch_invoice'),
    ('ux_purchases_biz_branch_invoice')
) AS idxs(idx_name)
ORDER BY object_type, target_object;

-- ----------------------------------------------------------------------------
-- 2.2 Post-Migration NULL branch_id, sales.user_id & branch_code Counts
-- ----------------------------------------------------------------------------
WITH null_checks(check_name, table_name, column_name, sql_text) AS (
  VALUES
    ('branches_null_branch_code', 'branches', 'branch_code', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.branches WHERE NULLIF(BTRIM(COALESCE(branch_code, '')), '') IS NULL$q$),
    ('business_users_null_branch_id', 'business_users', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.business_users WHERE branch_id IS NULL$q$),
    ('employees_null_branch_id', 'employees', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.employees WHERE branch_id IS NULL$q$),
    ('categories_null_branch_id', 'categories', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.categories WHERE branch_id IS NULL$q$),
    ('products_null_branch_id', 'products', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.products WHERE branch_id IS NULL$q$),
    ('product_variants_null_branch_id', 'product_variants', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.product_variants WHERE branch_id IS NULL$q$),
    ('product_colors_null_branch_id', 'product_colors', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.product_colors WHERE branch_id IS NULL$q$),
    ('product_images_null_branch_id', 'product_images', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.product_images WHERE branch_id IS NULL$q$),
    ('customers_null_branch_id', 'customers', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.customers WHERE branch_id IS NULL$q$),
    ('customer_transactions_null_branch_id', 'customer_transactions', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.customer_transactions WHERE branch_id IS NULL$q$),
    ('suppliers_null_branch_id', 'suppliers', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.suppliers WHERE branch_id IS NULL$q$),
    ('supplier_transactions_null_branch_id', 'supplier_transactions', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.supplier_transactions WHERE branch_id IS NULL$q$),
    ('accounts_null_branch_id', 'accounts', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.accounts WHERE branch_id IS NULL$q$),
    ('account_transactions_null_branch_id', 'account_transactions', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.account_transactions WHERE branch_id IS NULL$q$),
    ('expenses_null_branch_id', 'expenses', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.expenses WHERE branch_id IS NULL$q$),
    ('sales_null_branch_id', 'sales', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sales WHERE branch_id IS NULL$q$),
    ('sales_null_user_id', 'sales', 'user_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sales WHERE user_id IS NULL$q$),
    ('sale_items_null_branch_id', 'sale_items', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sale_items WHERE branch_id IS NULL$q$),
    ('sale_payments_null_branch_id', 'sale_payments', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sale_payments WHERE branch_id IS NULL$q$),
    ('sale_returns_null_branch_id', 'sale_returns', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sale_returns WHERE branch_id IS NULL$q$),
    ('purchases_null_branch_id', 'purchases', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.purchases WHERE branch_id IS NULL$q$),
    ('purchase_items_null_branch_id', 'purchase_items', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.purchase_items WHERE branch_id IS NULL$q$),
    ('stock_movements_null_branch_id', 'stock_movements', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.stock_movements WHERE branch_id IS NULL$q$),
    ('audit_logs_null_branch_id', 'audit_logs', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.audit_logs WHERE branch_id IS NULL$q$),
    ('user_activity_logs_null_branch_id', 'user_activity_logs', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.user_activity_logs WHERE branch_id IS NULL$q$)
),
evaluated AS (
  SELECT
    nc.check_name,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = nc.table_name
          AND c.column_name = nc.column_name
      ) THEN 'AVAILABLE'
      ELSE 'NOT AVAILABLE'
    END AS availability,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = nc.table_name
          AND c.column_name = nc.column_name
      ) THEN ((xpath('//cnt/text()', query_to_xml(nc.sql_text, false, true, '')))[1])::TEXT::BIGINT
      ELSE NULL::BIGINT
    END AS null_count
  FROM null_checks nc
)
SELECT
  check_name,
  availability,
  COALESCE(null_count::TEXT, 'NOT AVAILABLE') AS null_count,
  CASE
    WHEN availability = 'NOT AVAILABLE' THEN 'NOT AVAILABLE'
    WHEN null_count = 0 THEN 'OK (0 NULLs)'
    ELSE 'REVIEW_NEEDED'
  END AS status
FROM evaluated
ORDER BY check_name;

-- ----------------------------------------------------------------------------
-- 2.3 Post-Migration Invalid or Cross-Business branch_id & sales.user_id Checks
-- ----------------------------------------------------------------------------
WITH ref_checks(check_name, table_name, column_name, sql_text) AS (
  VALUES
    ('categories_invalid_branch', 'categories', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.categories t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('products_invalid_branch', 'products', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.products t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('product_variants_invalid_branch', 'product_variants', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.product_variants t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('product_colors_invalid_branch', 'product_colors', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.product_colors t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('product_images_invalid_branch', 'product_images', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.product_images t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('customers_invalid_branch', 'customers', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.customers t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('customer_transactions_invalid_branch', 'customer_transactions', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.customer_transactions t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('suppliers_invalid_branch', 'suppliers', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.suppliers t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('supplier_transactions_invalid_branch', 'supplier_transactions', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.supplier_transactions t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('accounts_invalid_branch', 'accounts', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.accounts t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('account_transactions_invalid_branch', 'account_transactions', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.account_transactions t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('expenses_invalid_branch', 'expenses', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.expenses t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('sales_invalid_branch', 'sales', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sales t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('sales_invalid_user_id', 'sales', 'user_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sales s WHERE s.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = s.user_id)$q$),
    ('sale_items_invalid_branch', 'sale_items', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sale_items t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('sale_payments_invalid_branch', 'sale_payments', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sale_payments t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('sale_returns_invalid_branch', 'sale_returns', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sale_returns t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('purchases_invalid_branch', 'purchases', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.purchases t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('purchase_items_invalid_branch', 'purchase_items', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.purchase_items t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('stock_movements_invalid_branch', 'stock_movements', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.stock_movements t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('employees_invalid_branch', 'employees', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.employees t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('business_users_invalid_branch', 'business_users', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.business_users t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('audit_logs_invalid_branch', 'audit_logs', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.audit_logs t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$),
    ('user_activity_logs_invalid_branch', 'user_activity_logs', 'branch_id', $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.user_activity_logs t WHERE t.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = t.branch_id AND br.business_id = t.business_id)$q$)
),
evaluated AS (
  SELECT
    rc.check_name,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = rc.table_name
          AND c.column_name = rc.column_name
      ) THEN 'AVAILABLE'
      ELSE 'NOT AVAILABLE'
    END AS availability,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = rc.table_name
          AND c.column_name = rc.column_name
      ) THEN ((xpath('//cnt/text()', query_to_xml(rc.sql_text, false, true, '')))[1])::TEXT::BIGINT
      ELSE NULL::BIGINT
    END AS issue_count
  FROM ref_checks rc
)
SELECT
  check_name,
  availability,
  COALESCE(issue_count::TEXT, 'NOT AVAILABLE') AS issue_count,
  CASE
    WHEN availability = 'NOT AVAILABLE' THEN 'NOT AVAILABLE'
    WHEN issue_count = 0 THEN 'PASS'
    ELSE 'FAIL'
  END AS status
FROM evaluated
ORDER BY check_name;

-- ----------------------------------------------------------------------------
-- 2.4 Post-Migration Branch & Branch-Scoped Duplicate Conflict Checks
--     (Covers Main Branch, Branch Code, Product SKU, Variant SKU, Category, Invoices)
-- ----------------------------------------------------------------------------
WITH dup_checks(check_name, table_name, column_name, sql_text) AS (
  VALUES
    (
      'multiple_main_branches_per_business',
      'branches',
      'is_main',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM (SELECT business_id FROM public.branches WHERE is_main = TRUE GROUP BY business_id HAVING COUNT(*) > 1) t$q$
    ),
    (
      'duplicate_branch_code_per_business',
      'branches',
      'branch_code',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM (SELECT business_id, LOWER(BTRIM(branch_code)) FROM public.branches WHERE NULLIF(BTRIM(branch_code), '') IS NOT NULL GROUP BY business_id, LOWER(BTRIM(branch_code)) HAVING COUNT(*) > 1) t$q$
    ),
    (
      'duplicate_product_sku_per_business_and_branch',
      'products',
      'branch_id',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM (SELECT business_id, branch_id, LOWER(BTRIM(sku)) FROM public.products WHERE branch_id IS NOT NULL AND NULLIF(BTRIM(sku), '') IS NOT NULL GROUP BY business_id, branch_id, LOWER(BTRIM(sku)) HAVING COUNT(*) > 1) t$q$
    ),
    (
      'duplicate_variant_sku_per_business_and_branch',
      'product_variants',
      'branch_id',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM (SELECT business_id, branch_id, LOWER(BTRIM(sku)) FROM public.product_variants WHERE branch_id IS NOT NULL AND NULLIF(BTRIM(sku), '') IS NOT NULL GROUP BY business_id, branch_id, LOWER(BTRIM(sku)) HAVING COUNT(*) > 1) t$q$
    ),
    (
      'duplicate_category_name_per_business_and_branch',
      'categories',
      'branch_id',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM (SELECT business_id, branch_id, LOWER(BTRIM(name)) FROM public.categories WHERE branch_id IS NOT NULL AND NULLIF(BTRIM(name), '') IS NOT NULL GROUP BY business_id, branch_id, LOWER(BTRIM(name)) HAVING COUNT(*) > 1) t$q$
    ),
    (
      'duplicate_sales_invoice_per_business_and_branch',
      'sales',
      'branch_id',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM (SELECT business_id, branch_id, LOWER(BTRIM(invoice_number)) FROM public.sales WHERE branch_id IS NOT NULL AND NULLIF(BTRIM(invoice_number), '') IS NOT NULL GROUP BY business_id, branch_id, LOWER(BTRIM(invoice_number)) HAVING COUNT(*) > 1) t$q$
    ),
    (
      'duplicate_purchase_invoice_per_business_and_branch',
      'purchases',
      'branch_id',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM (SELECT business_id, branch_id, LOWER(BTRIM(invoice_number)) FROM public.purchases WHERE branch_id IS NOT NULL AND NULLIF(BTRIM(invoice_number), '') IS NOT NULL GROUP BY business_id, branch_id, LOWER(BTRIM(invoice_number)) HAVING COUNT(*) > 1) t$q$
    )
),
evaluated AS (
  SELECT
    dc.check_name,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = dc.table_name
          AND c.column_name = dc.column_name
      ) THEN 'AVAILABLE'
      ELSE 'NOT AVAILABLE'
    END AS availability,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = dc.table_name
          AND c.column_name = dc.column_name
      ) THEN ((xpath('//cnt/text()', query_to_xml(dc.sql_text, false, true, '')))[1])::TEXT::BIGINT
      ELSE NULL::BIGINT
    END AS conflict_groups
  FROM dup_checks dc
)
SELECT
  check_name,
  availability,
  COALESCE(conflict_groups::TEXT, 'NOT AVAILABLE') AS conflict_groups,
  CASE
    WHEN availability = 'NOT AVAILABLE' THEN 'NOT AVAILABLE'
    WHEN conflict_groups = 0 THEN 'PASS'
    ELSE 'CONFLICT'
  END AS status
FROM evaluated
ORDER BY check_name;

-- ----------------------------------------------------------------------------
-- 2.5 Post-Migration Stock Transfer Source, Destination & Target Validation
-- ----------------------------------------------------------------------------
WITH transfer_checks(check_name, req_table, req_column, sql_text) AS (
  VALUES
    (
      'stock_transfers_null_or_invalid_from_branch',
      'stock_transfers',
      'from_branch_id',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.stock_transfers st WHERE st.from_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = st.from_branch_id AND b.business_id = st.business_id)$q$
    ),
    (
      'stock_transfers_null_or_invalid_to_branch',
      'stock_transfers',
      'to_branch_id',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.stock_transfers st WHERE st.to_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = st.to_branch_id AND b.business_id = st.business_id)$q$
    ),
    (
      'stock_transfers_same_from_and_to_branch',
      'stock_transfers',
      'to_branch_id',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.stock_transfers st WHERE st.from_branch_id IS NOT NULL AND st.to_branch_id IS NOT NULL AND st.from_branch_id = st.to_branch_id$q$
    ),
    (
      'stock_transfers_variant_product_mismatch',
      'stock_transfers',
      'variant_id',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.stock_transfers st WHERE st.variant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.id = st.variant_id AND pv.product_id = st.product_id AND pv.business_id = st.business_id)$q$
    ),
    (
      'stock_transfers_target_product_branch_mismatch',
      'stock_transfers',
      'target_product_id',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.stock_transfers st WHERE st.target_product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = st.target_product_id AND p.business_id = st.business_id AND (p.branch_id IS NULL OR p.branch_id = st.to_branch_id))$q$
    ),
    (
      'stock_transfers_target_variant_mismatch',
      'stock_transfers',
      'target_variant_id',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.stock_transfers st WHERE st.target_variant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.id = st.target_variant_id AND pv.business_id = st.business_id AND (st.target_product_id IS NULL OR pv.product_id = st.target_product_id))$q$
    )
),
evaluated AS (
  SELECT
    tc.check_name,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = tc.req_table
          AND c.column_name = tc.req_column
      ) THEN 'AVAILABLE'
      ELSE 'NOT AVAILABLE'
    END AS availability,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = tc.req_table
          AND c.column_name = tc.req_column
      ) THEN ((xpath('//cnt/text()', query_to_xml(tc.sql_text, false, true, '')))[1])::TEXT::BIGINT
      ELSE NULL::BIGINT
    END AS issue_count
  FROM transfer_checks tc
)
SELECT
  check_name,
  availability,
  COALESCE(issue_count::TEXT, 'NOT AVAILABLE') AS issue_count,
  CASE
    WHEN availability = 'NOT AVAILABLE' THEN 'NOT AVAILABLE'
    WHEN issue_count = 0 THEN 'PASS'
    ELSE 'FAIL'
  END AS status
FROM evaluated
ORDER BY check_name;

-- ----------------------------------------------------------------------------
-- 2.6 Post-Migration Parent-Child Branch Consistency Checks
--     Checks all 7 core parent -> child relationships for branch_id / business_id mismatch
-- ----------------------------------------------------------------------------
WITH pc_checks(check_name, parent_table, child_table, sql_text) AS (
  VALUES
    (
      'products_to_product_variants_branch_consistency',
      'products',
      'product_variants',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.product_variants pv LEFT JOIN public.products p ON p.id = pv.product_id WHERE p.id IS NULL OR pv.business_id IS DISTINCT FROM p.business_id OR pv.branch_id IS DISTINCT FROM p.branch_id$q$
    ),
    (
      'products_to_product_colors_branch_consistency',
      'products',
      'product_colors',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.product_colors pc LEFT JOIN public.products p ON p.id = pc.product_id WHERE p.id IS NULL OR pc.business_id IS DISTINCT FROM p.business_id OR pc.branch_id IS DISTINCT FROM p.branch_id$q$
    ),
    (
      'products_to_product_images_branch_consistency',
      'products',
      'product_images',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.product_images pi LEFT JOIN public.products p ON p.id = pi.product_id WHERE p.id IS NULL OR pi.business_id IS DISTINCT FROM p.business_id OR pi.branch_id IS DISTINCT FROM p.branch_id$q$
    ),
    (
      'sales_to_sale_items_branch_consistency',
      'sales',
      'sale_items',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sale_items si LEFT JOIN public.sales s ON s.id = si.sale_id WHERE s.id IS NULL OR si.business_id IS DISTINCT FROM s.business_id OR si.branch_id IS DISTINCT FROM s.branch_id$q$
    ),
    (
      'sales_to_sale_payments_branch_consistency',
      'sales',
      'sale_payments',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sale_payments sp LEFT JOIN public.sales s ON s.id = sp.sale_id WHERE s.id IS NULL OR sp.business_id IS DISTINCT FROM s.business_id OR sp.branch_id IS DISTINCT FROM s.branch_id$q$
    ),
    (
      'sales_to_sale_returns_branch_consistency',
      'sales',
      'sale_returns',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.sale_returns sr LEFT JOIN public.sales s ON s.id = sr.sale_id WHERE s.id IS NULL OR sr.business_id IS DISTINCT FROM s.business_id OR sr.branch_id IS DISTINCT FROM s.branch_id$q$
    ),
    (
      'purchases_to_purchase_items_branch_consistency',
      'purchases',
      'purchase_items',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.purchase_items pi LEFT JOIN public.purchases p ON p.id = pi.purchase_id WHERE p.id IS NULL OR pi.business_id IS DISTINCT FROM p.business_id OR pi.branch_id IS DISTINCT FROM p.branch_id$q$
    )
),
evaluated AS (
  SELECT
    pc.check_name,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns c1
        WHERE c1.table_schema = 'public' AND c1.table_name = pc.parent_table AND c1.column_name = 'branch_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c2
        WHERE c2.table_schema = 'public' AND c2.table_name = pc.child_table AND c2.column_name = 'branch_id'
      ) THEN 'AVAILABLE'
      ELSE 'NOT AVAILABLE'
    END AS availability,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns c1
        WHERE c1.table_schema = 'public' AND c1.table_name = pc.parent_table AND c1.column_name = 'branch_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c2
        WHERE c2.table_schema = 'public' AND c2.table_name = pc.child_table AND c2.column_name = 'branch_id'
      ) THEN ((xpath('//cnt/text()', query_to_xml(pc.sql_text, false, true, '')))[1])::TEXT::BIGINT
      ELSE NULL::BIGINT
    END AS mismatch_count
  FROM pc_checks pc
)
SELECT
  check_name,
  availability,
  COALESCE(mismatch_count::TEXT, 'NOT AVAILABLE') AS mismatch_count,
  CASE
    WHEN availability = 'NOT AVAILABLE' THEN 'NOT AVAILABLE'
    WHEN mismatch_count = 0 THEN 'PASS'
    ELSE 'FAIL'
  END AS status
FROM evaluated
ORDER BY check_name;

-- ----------------------------------------------------------------------------
-- 2.7 Post-Migration staff_branch_access Validation
--     Checks table existence, invalid business/branch/employee/user refs,
--     multiple default branches per user per business, and missing assignments
--     for employees who have a valid linked auth.users account.
-- ----------------------------------------------------------------------------
WITH sba_checks(check_name, sql_text, is_count_metric) AS (
  VALUES
    (
      'staff_branch_access_total_rows',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.staff_branch_access$q$,
      TRUE
    ),
    (
      'staff_branch_access_invalid_or_cross_biz_branch',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.staff_branch_access sba WHERE NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = sba.branch_id AND b.business_id = sba.business_id)$q$,
      FALSE
    ),
    (
      'staff_branch_access_invalid_or_cross_biz_employee',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.staff_branch_access sba WHERE sba.employee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.employees emp WHERE emp.id = sba.employee_id AND emp.business_id = sba.business_id)$q$,
      FALSE
    ),
    (
      'staff_branch_access_invalid_auth_user',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.staff_branch_access sba WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = sba.user_id)$q$,
      FALSE
    ),
    (
      'staff_branch_access_multiple_default_branches_per_user',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM (SELECT business_id, user_id FROM public.staff_branch_access WHERE is_default = TRUE GROUP BY business_id, user_id HAVING COUNT(*) > 1) t$q$,
      FALSE
    ),
    (
      'employees_with_valid_auth_user_missing_branch_id',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.employees emp JOIN auth.users au ON au.id = emp.user_id WHERE emp.branch_id IS NULL$q$,
      FALSE
    ),
    (
      'employees_with_valid_auth_user_missing_staff_branch_access',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.employees emp JOIN auth.users au ON au.id = emp.user_id WHERE NOT EXISTS (SELECT 1 FROM public.staff_branch_access sba WHERE sba.business_id = emp.business_id AND sba.user_id = emp.user_id AND (emp.branch_id IS NULL OR sba.branch_id = emp.branch_id))$q$,
      FALSE
    ),
    (
      'business_users_with_branch_missing_staff_branch_access',
      $q$SELECT COUNT(*)::BIGINT AS cnt FROM public.business_users bu JOIN auth.users au ON au.id = bu.user_id WHERE bu.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.staff_branch_access sba WHERE sba.business_id = bu.business_id AND sba.user_id = bu.user_id AND sba.branch_id = bu.branch_id)$q$,
      FALSE
    )
),
evaluated AS (
  SELECT
    sc.check_name,
    sc.is_count_metric,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_name = 'staff_branch_access'
      ) THEN 'AVAILABLE'
      ELSE 'NOT AVAILABLE'
    END AS availability,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_name = 'staff_branch_access'
      ) THEN ((xpath('//cnt/text()', query_to_xml(sc.sql_text, false, true, '')))[1])::TEXT::BIGINT
      ELSE NULL::BIGINT
    END AS metric_value
  FROM sba_checks sc
)
SELECT
  check_name,
  availability,
  COALESCE(metric_value::TEXT, 'NOT AVAILABLE') AS result_count,
  CASE
    WHEN availability = 'NOT AVAILABLE' THEN 'NOT AVAILABLE'
    WHEN is_count_metric THEN 'INFO'
    WHEN metric_value = 0 THEN 'PASS'
    ELSE 'FAIL'
  END AS status
FROM evaluated
ORDER BY check_name;

-- ----------------------------------------------------------------------------
-- 2.8 Read-Only Detailed Conflict Inspector (RAISE NOTICE / WARNING Only)
--     Prints exact offending business/branch/record identifiers when any
--     post-migration check detects conflicts. Performs ZERO writes.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_rec RECORD;
  v_has_products_branch BOOLEAN;
  v_has_variants_branch BOOLEAN;
  v_has_categories_branch BOOLEAN;
  v_has_branch_code BOOLEAN;
  v_has_sba BOOLEAN;
  v_count BIGINT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'branch_id'
  ) INTO v_has_products_branch;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'product_variants' AND column_name = 'branch_id'
  ) INTO v_has_variants_branch;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'categories' AND column_name = 'branch_id'
  ) INTO v_has_categories_branch;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'branch_code'
  ) INTO v_has_branch_code;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'staff_branch_access'
  ) INTO v_has_sba;

  IF NOT v_has_products_branch AND NOT v_has_branch_code AND NOT v_has_sba THEN
    RAISE NOTICE '[POST-MIGRATION INSPECTOR] Post-migration schema NOT AVAILABLE yet (Pre-migration state). Skipping post-migration conflict detail notices.';
    RETURN;
  END IF;

  IF v_has_branch_code THEN
    FOR v_rec IN EXECUTE $q$
      SELECT business_id, LOWER(BTRIM(branch_code)) AS code, COUNT(*) AS cnt
      FROM public.branches
      WHERE NULLIF(BTRIM(branch_code), '') IS NOT NULL
      GROUP BY business_id, LOWER(BTRIM(branch_code))
      HAVING COUNT(*) > 1
      LIMIT 25
    $q$ LOOP
      RAISE WARNING '[CONFLICT][branches.branch_code] business_id=%, branch_code=%, count=%',
        v_rec.business_id, v_rec.code, v_rec.cnt;
    END LOOP;
  END IF;

  IF v_has_products_branch THEN
    FOR v_rec IN EXECUTE $q$
      SELECT business_id, branch_id, LOWER(BTRIM(sku)) AS val, COUNT(*) AS cnt
      FROM public.products
      WHERE branch_id IS NOT NULL AND NULLIF(BTRIM(sku), '') IS NOT NULL
      GROUP BY business_id, branch_id, LOWER(BTRIM(sku))
      HAVING COUNT(*) > 1
      LIMIT 25
    $q$ LOOP
      RAISE WARNING '[CONFLICT][products.sku] business_id=%, branch_id=%, sku=%, count=%',
        v_rec.business_id, v_rec.branch_id, v_rec.val, v_rec.cnt;
    END LOOP;
  END IF;

  IF v_has_variants_branch THEN
    FOR v_rec IN EXECUTE $q$
      SELECT business_id, branch_id, LOWER(BTRIM(sku)) AS val, COUNT(*) AS cnt
      FROM public.product_variants
      WHERE branch_id IS NOT NULL AND NULLIF(BTRIM(sku), '') IS NOT NULL
      GROUP BY business_id, branch_id, LOWER(BTRIM(sku))
      HAVING COUNT(*) > 1
      LIMIT 25
    $q$ LOOP
      RAISE WARNING '[CONFLICT][product_variants.sku] business_id=%, branch_id=%, sku=%, count=%',
        v_rec.business_id, v_rec.branch_id, v_rec.val, v_rec.cnt;
    END LOOP;
  END IF;

  IF v_has_categories_branch THEN
    FOR v_rec IN EXECUTE $q$
      SELECT business_id, branch_id, LOWER(BTRIM(name)) AS val, COUNT(*) AS cnt
      FROM public.categories
      WHERE branch_id IS NOT NULL AND NULLIF(BTRIM(name), '') IS NOT NULL
      GROUP BY business_id, branch_id, LOWER(BTRIM(name))
      HAVING COUNT(*) > 1
      LIMIT 25
    $q$ LOOP
      RAISE WARNING '[CONFLICT][categories.name] business_id=%, branch_id=%, name=%, count=%',
        v_rec.business_id, v_rec.branch_id, v_rec.val, v_rec.cnt;
    END LOOP;
  END IF;

  IF v_has_sba THEN
    FOR v_rec IN EXECUTE $q$
      SELECT business_id, user_id, COUNT(*) AS cnt
      FROM public.staff_branch_access
      WHERE is_default = TRUE
      GROUP BY business_id, user_id
      HAVING COUNT(*) > 1
      LIMIT 25
    $q$ LOOP
      RAISE WARNING '[CONFLICT][staff_branch_access.is_default] business_id=%, user_id=%, default_count=%',
        v_rec.business_id, v_rec.user_id, v_rec.cnt;
    END LOOP;

    EXECUTE $q$
      SELECT COUNT(*)
      FROM public.employees emp
      JOIN auth.users au ON au.id = emp.user_id
      WHERE emp.branch_id IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM public.staff_branch_access sba
           WHERE sba.business_id = emp.business_id
             AND sba.user_id = emp.user_id
             AND sba.branch_id = emp.branch_id
         )
    $q$ INTO v_count;

    IF v_count > 0 THEN
      RAISE WARNING '[CONFLICT][staff_branch_access] Found % employee(s) with linked auth.users missing branch_id or staff_branch_access row.', v_count;
    END IF;
  END IF;

  RAISE NOTICE '[POST-MIGRATION INSPECTOR] Read-only inspection finished.';
END $$;
