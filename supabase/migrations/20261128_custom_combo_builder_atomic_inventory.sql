-- ==============================================================================
-- PROTIVA — Custom Combo Offer Builder, Atomic Combo Inventory & Security Hardening
-- Non-destructive additive migration preserving all existing data, branches, and POS flows.
-- ==============================================================================

-- 1. Additive Columns for Combo Categories, Package Grouping, and Idempotency
ALTER TABLE public.combo_offers
  ADD COLUMN IF NOT EXISTS combo_category TEXT;

ALTER TABLE public.combo_offer_usage
  ADD COLUMN IF NOT EXISTS combo_quantity INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS combo_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS seller_id UUID,
  ADD COLUMN IF NOT EXISTS client_tx_id TEXT,
  ADD COLUMN IF NOT EXISTS components JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS client_tx_id TEXT,
  ADD COLUMN IF NOT EXISTS combo_packages JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS combo_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS combo_quantity INTEGER;

ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS return_tx_id TEXT,
  ADD COLUMN IF NOT EXISTS branch_id UUID;

-- 2. Partial Unique Indexes for Idempotency & Replay Protection
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_business_client_tx_unique
  ON public.sales (business_id, client_tx_id)
  WHERE client_tx_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_returns_business_return_tx_unique
  ON public.sale_returns (business_id, return_tx_id)
  WHERE return_tx_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_combo_offer_usage_sale_instance_unique
  ON public.combo_offer_usage (business_id, sale_id, offer_id, combo_instance_id)
  WHERE combo_instance_id IS NOT NULL;

-- 3. Tighten RLS Policies on combo_offers & combo_offer_items
-- Sellers/Cashiers can SELECT active combos for POS, while ONLY Admin / Store Manager
-- (or staff explicitly granted product_management write permissions) can create, edit, or delete combos.
DROP POLICY IF EXISTS policy_business_insert ON public.combo_offers;
DROP POLICY IF EXISTS policy_business_update ON public.combo_offers;
DROP POLICY IF EXISTS policy_business_delete ON public.combo_offers;

CREATE POLICY policy_combo_offers_admin_insert ON public.combo_offers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'product_management', 'create')
  );

CREATE POLICY policy_combo_offers_admin_update ON public.combo_offers
  FOR UPDATE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'product_management', 'edit')
  )
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'product_management', 'edit')
  );

CREATE POLICY policy_combo_offers_admin_delete ON public.combo_offers
  FOR DELETE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'product_management', 'delete')
  );

DROP POLICY IF EXISTS policy_business_insert ON public.combo_offer_items;
DROP POLICY IF EXISTS policy_business_update ON public.combo_offer_items;
DROP POLICY IF EXISTS policy_business_delete ON public.combo_offer_items;

CREATE POLICY policy_combo_offer_items_admin_insert ON public.combo_offer_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'product_management', 'create')
  );

CREATE POLICY policy_combo_offer_items_admin_update ON public.combo_offer_items
  FOR UPDATE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'product_management', 'edit')
  )
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'product_management', 'edit')
  );

CREATE POLICY policy_combo_offer_items_admin_delete ON public.combo_offer_items
  FOR DELETE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'product_management', 'delete')
  );

-- 4. Upgrade increment_offer_usage to accept combo quantity
DROP FUNCTION IF EXISTS public.increment_offer_usage(TEXT);

CREATE OR REPLACE FUNCTION public.increment_offer_usage(
  p_offer_id TEXT,
  p_quantity INTEGER DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer_biz UUID;
  v_delta INTEGER := GREATEST(1, COALESCE(p_quantity, 1));
BEGIN
  SELECT business_id INTO v_offer_biz FROM public.combo_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM public.assert_caller_business_permission(v_offer_biz, 'pos_new_sale', 'create', FALSE);

  UPDATE public.combo_offers
  SET usage_count = COALESCE(usage_count, 0) + v_delta,
      status = CASE
        WHEN max_usage_limit IS NOT NULL AND (COALESCE(usage_count, 0) + v_delta) >= max_usage_limit THEN 'expired'
        ELSE status
      END,
      updated_at = NOW()
  WHERE id = p_offer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_offer_usage(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_offer_usage(TEXT, INTEGER) TO authenticated, service_role;

-- 5. Upgrade complete_sale_transaction with:
--    - client_tx_id idempotency protection
--    - Deterministic ordered locking & aggregate stock pre-validation across regular + combo items
--    - Branch isolation verification when product.branch_id is scoped
--    - Combo package metadata & item grouping columns (combo_instance_id, combo_quantity)
CREATE OR REPLACE FUNCTION public.complete_sale_transaction(
  p_sale JSONB,
  p_items JSONB,
  p_payments JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID := public.safe_uuid(p_sale->>'business_id');
  v_branch_id UUID := public.safe_uuid(p_sale->>'branch_id');
  v_customer_id UUID := public.safe_uuid(p_sale->>'customer_id');
  v_employee_id UUID := public.safe_uuid(p_sale->>'employee_id');
  v_seller_id UUID := public.safe_uuid(p_sale->>'seller_id');
  v_invoice_number TEXT := NULLIF(BTRIM(p_sale->>'invoice_number'), '');
  v_client_tx_id TEXT := NULLIF(BTRIM(p_sale->>'client_tx_id'), '');
  v_combo_packages JSONB := COALESCE(p_sale->'combo_packages', '[]'::jsonb);
  v_subtotal NUMERIC(14,2) := COALESCE((p_sale->>'subtotal')::NUMERIC, 0);
  v_discount NUMERIC(14,2) := COALESCE((p_sale->>'discount')::NUMERIC, 0);
  v_combo_discount NUMERIC(14,2) := COALESCE((p_sale->>'combo_discount')::NUMERIC, 0);
  v_vat_rate NUMERIC(6,2) := COALESCE((p_sale->>'vat_tax_rate')::NUMERIC, 0);
  v_vat_amount NUMERIC(14,2) := COALESCE((p_sale->>'vat_tax_amount')::NUMERIC, 0);
  v_total NUMERIC(14,2) := COALESCE((p_sale->>'total')::NUMERIC, 0);
  v_paid NUMERIC(14,2) := COALESCE((p_sale->>'paid')::NUMERIC, 0);
  v_due NUMERIC(14,2) := COALESCE((p_sale->>'due')::NUMERIC, 0);
  v_payment_method TEXT := COALESCE(NULLIF(p_sale->>'payment_method', ''), 'cash');
  v_status TEXT := COALESCE(NULLIF(p_sale->>'status', ''), CASE WHEN v_due <= 0 THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'due' END);

  v_existing_sale RECORD;
  v_sale_id UUID;
  v_agg RECORD;
  v_item JSONB;
  v_pay JSONB;
  v_prod_id UUID;
  v_var_id UUID;
  v_qty NUMERIC(14,2);
  v_prev_stock NUMERIC(14,2);
  v_new_stock NUMERIC(14,2);
  v_var_stock NUMERIC(14,2);
  v_prod_name TEXT;
  v_prod_branch UUID;
  v_cust_row RECORD;
  v_new_cust_due NUMERIC(14,2);
  v_acc_id UUID;
  v_acc_bal NUMERIC(14,2);
  v_acc_name TEXT;
  v_pay_amt NUMERIC(14,2);
  v_pay_method TEXT;
  v_total_payments_processed NUMERIC(14,2) := 0;
BEGIN
  PERFORM public.assert_caller_business_permission(v_business_id, 'pos_new_sale', 'create', TRUE);

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cannot complete sale without at least one item';
  END IF;

  -- Idempotent replay protection on client_tx_id
  IF v_client_tx_id IS NOT NULL THEN
    SELECT id, invoice_number, total, paid, due
      INTO v_existing_sale
    FROM public.sales
    WHERE business_id = v_business_id AND client_tx_id = v_client_tx_id
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing_sale.id,
        'invoice_number', v_existing_sale.invoice_number,
        'total', v_existing_sale.total,
        'paid', v_existing_sale.paid,
        'due', v_existing_sale.due,
        'idempotent_hit', TRUE
      );
    END IF;
  END IF;

  IF v_invoice_number IS NULL THEN
    v_invoice_number := 'INV-' || TO_CHAR(NOW(), 'YYMMDDHH24MISS');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sales
    WHERE business_id = v_business_id AND invoice_number = v_invoice_number
  ) THEN
    RAISE EXCEPTION 'Duplicate invoice number "%" detected. Sale already recorded.', v_invoice_number;
  END IF;

  -- Deterministic sorted pre-validation & row locking across aggregated (product_id, variant_id)
  FOR v_agg IN
    SELECT
      public.safe_uuid(elem->>'product_id') AS product_id,
      SUM(COALESCE((elem->>'quantity')::NUMERIC, 0)) AS total_prod_qty
    FROM jsonb_array_elements(p_items) AS elem
    GROUP BY public.safe_uuid(elem->>'product_id')
    ORDER BY public.safe_uuid(elem->>'product_id')
  LOOP
    IF v_agg.product_id IS NULL THEN
      RAISE EXCEPTION 'Invalid product_id in sale items';
    END IF;
    IF v_agg.total_prod_qty <= 0 THEN
      RAISE EXCEPTION 'Sale item quantity must be greater than zero';
    END IF;

    SELECT current_stock, name, branch_id
      INTO v_prev_stock, v_prod_name, v_prod_branch
    FROM public.products
    WHERE id = v_agg.product_id AND business_id = v_business_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found in active business inventory', v_agg.product_id;
    END IF;

    IF v_branch_id IS NOT NULL AND v_prod_branch IS NOT NULL AND v_prod_branch <> v_branch_id THEN
      RAISE EXCEPTION 'Product "%" belongs to another branch and cannot be deducted from this branch', v_prod_name;
    END IF;

    IF COALESCE(v_prev_stock, 0) < v_agg.total_prod_qty THEN
      RAISE EXCEPTION 'Insufficient stock for "%" (Required: %, Available: %)', v_prod_name, v_agg.total_prod_qty, COALESCE(v_prev_stock, 0);
    END IF;
  END LOOP;

  FOR v_agg IN
    SELECT
      public.safe_uuid(elem->>'product_id') AS product_id,
      public.safe_uuid(elem->>'variant_id') AS variant_id,
      MAX(NULLIF(elem->>'product_name', '')) AS product_name,
      MAX(NULLIF(elem->>'variant_details', '')) AS variant_details,
      SUM(COALESCE((elem->>'quantity')::NUMERIC, 0)) AS total_var_qty
    FROM jsonb_array_elements(p_items) AS elem
    WHERE public.safe_uuid(elem->>'variant_id') IS NOT NULL
    GROUP BY public.safe_uuid(elem->>'product_id'), public.safe_uuid(elem->>'variant_id')
    ORDER BY public.safe_uuid(elem->>'product_id'), public.safe_uuid(elem->>'variant_id')
  LOOP
    SELECT stock INTO v_var_stock
    FROM public.product_variants
    WHERE id = v_agg.variant_id AND product_id = v_agg.product_id AND business_id = v_business_id
    FOR UPDATE;

    IF FOUND AND COALESCE(v_var_stock, 0) < v_agg.total_var_qty THEN
      RAISE EXCEPTION 'Insufficient variant stock for "% %" (Required: %, Available: %)',
        COALESCE(v_agg.product_name, 'Product'),
        COALESCE('(' || v_agg.variant_details || ')', ''),
        v_agg.total_var_qty,
        COALESCE(v_var_stock, 0);
    END IF;
  END LOOP;

  -- Insert canonical Sale header
  INSERT INTO public.sales (
    business_id, branch_id, invoice_number, client_tx_id, customer_id, customer_name, customer_mobile,
    subtotal, discount, combo_discount, applied_offers, combo_packages, vat_tax_rate, vat_tax_amount,
    total, paid, due, payment_method, status, served_by,
    employee_id, employee_code, employee_name, seller_id, seller_name, notes
  ) VALUES (
    v_business_id, v_branch_id, v_invoice_number, v_client_tx_id, v_customer_id,
    COALESCE(NULLIF(p_sale->>'customer_name', ''), 'Walk-in Customer'),
    NULLIF(p_sale->>'customer_mobile', ''),
    v_subtotal, v_discount, v_combo_discount, COALESCE(p_sale->'applied_offers', '[]'::jsonb), v_combo_packages,
    v_vat_rate, v_vat_amount, v_total, v_paid, v_due, v_payment_method, v_status,
    COALESCE(NULLIF(p_sale->>'served_by', ''), 'Staff'),
    v_employee_id, NULLIF(p_sale->>'employee_code', ''), NULLIF(p_sale->>'employee_name', ''),
    v_seller_id, NULLIF(p_sale->>'seller_name', ''), NULLIF(p_sale->>'notes', '')
  )
  RETURNING id INTO v_sale_id;

  -- Deduct exact inventory & insert sale_items + stock_movements
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := public.safe_uuid(v_item->>'product_id');
    v_var_id := public.safe_uuid(v_item->>'variant_id');
    v_qty := COALESCE((v_item->>'quantity')::NUMERIC, 0);

    SELECT current_stock, name INTO v_prev_stock, v_prod_name
    FROM public.products
    WHERE id = v_prod_id AND business_id = v_business_id;

    v_new_stock := v_prev_stock - v_qty;

    IF v_var_id IS NOT NULL THEN
      SELECT stock INTO v_var_stock
      FROM public.product_variants
      WHERE id = v_var_id AND product_id = v_prod_id AND business_id = v_business_id;

      IF FOUND THEN
        UPDATE public.product_variants
        SET stock = v_var_stock - v_qty, updated_at = NOW()
        WHERE id = v_var_id;
      END IF;
    END IF;

    UPDATE public.products
    SET current_stock = v_new_stock, updated_at = NOW()
    WHERE id = v_prod_id;

    INSERT INTO public.sale_items (
      sale_id, business_id, product_id, variant_id, product_name, sku, variant_details,
      quantity, unit_price, purchase_price, discount, total,
      combo_offer_id, combo_offer_name, combo_instance_id, combo_quantity, is_free_item
    ) VALUES (
      v_sale_id, v_business_id, v_prod_id, v_var_id,
      COALESCE(NULLIF(v_item->>'product_name', ''), v_prod_name),
      COALESCE(v_item->>'sku', ''), NULLIF(v_item->>'variant_details', ''),
      v_qty, COALESCE((v_item->>'unit_price')::NUMERIC, 0), COALESCE((v_item->>'purchase_price')::NUMERIC, 0),
      COALESCE((v_item->>'discount')::NUMERIC, 0), COALESCE((v_item->>'total')::NUMERIC, 0),
      NULLIF(v_item->>'combo_offer_id', ''), NULLIF(v_item->>'combo_offer_name', ''),
      NULLIF(v_item->>'combo_instance_id', ''),
      NULLIF(v_item->>'combo_quantity', '')::INTEGER,
      COALESCE((v_item->>'is_free_item')::BOOLEAN, FALSE)
    );

    INSERT INTO public.stock_movements (
      business_id, branch_id, product_id, product_name,
      movement_type, quantity, previous_stock, new_stock, reference, note
    ) VALUES (
      v_business_id, v_branch_id, v_prod_id,
      COALESCE(NULLIF(v_item->>'product_name', ''), v_prod_name),
      'sale_out', -v_qty, v_prev_stock, v_new_stock, v_invoice_number,
      CASE
        WHEN NULLIF(v_item->>'combo_offer_name', '') IS NOT NULL
          THEN 'Combo sale (' || (v_item->>'combo_offer_name') || ') ' || v_invoice_number
        ELSE 'Sale invoice ' || v_invoice_number
      END
    );
  END LOOP;

  -- Update customer ledger & dues
  IF v_customer_id IS NOT NULL THEN
    SELECT id, name, current_due, total_purchase, total_paid
      INTO v_cust_row
    FROM public.customers
    WHERE id = v_customer_id AND business_id = v_business_id
    FOR UPDATE;

    IF FOUND THEN
      v_new_cust_due := GREATEST(0, COALESCE(v_cust_row.current_due, 0) + v_due);
      UPDATE public.customers
      SET total_purchase = COALESCE(total_purchase, 0) + v_total,
          total_paid = COALESCE(total_paid, 0) + v_paid,
          current_due = v_new_cust_due,
          updated_at = NOW()
      WHERE id = v_customer_id;

      IF v_due > 0 THEN
        INSERT INTO public.customer_transactions (
          business_id, customer_id, customer_name, transaction_type,
          amount, balance_after, payment_method, reference_id, note
        ) VALUES (
          v_business_id, v_customer_id, v_cust_row.name, 'sale_due',
          v_due, v_new_cust_due, v_payment_method, v_invoice_number,
          'Credit/Due on Invoice ' || v_invoice_number
        );
      END IF;
    END IF;
  END IF;

  -- Process sale payments & financial accounts
  IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      v_pay_amt := COALESCE((v_pay->>'amount')::NUMERIC, 0);
      v_pay_method := COALESCE(NULLIF(v_pay->>'payment_method', ''), v_payment_method);
      IF v_pay_amt > 0 THEN
        v_acc_id := public.resolve_business_account(v_business_id, public.safe_uuid(v_pay->>'account_id'), v_pay_method);

        INSERT INTO public.sale_payments (
          sale_id, business_id, account_id, payment_method, amount, trx_id
        ) VALUES (
          v_sale_id, v_business_id, v_acc_id, v_pay_method, v_pay_amt, NULLIF(v_pay->>'trx_id', '')
        );

        IF v_acc_id IS NOT NULL THEN
          SELECT balance, name INTO v_acc_bal, v_acc_name
          FROM public.accounts WHERE id = v_acc_id AND business_id = v_business_id FOR UPDATE;
          IF FOUND THEN
            UPDATE public.accounts SET balance = COALESCE(v_acc_bal, 0) + v_pay_amt, updated_at = NOW() WHERE id = v_acc_id;
            INSERT INTO public.account_transactions (
              business_id, account_id, account_name, transaction_type, amount, balance_after, reference_id, note
            ) VALUES (
              v_business_id, v_acc_id, v_acc_name, 'sale_payment',
              v_pay_amt, COALESCE(v_acc_bal, 0) + v_pay_amt, v_invoice_number,
              'Sale payment (' || v_pay_method || ') for ' || v_invoice_number
            );
          END IF;
        END IF;

        v_total_payments_processed := v_total_payments_processed + v_pay_amt;
      END IF;
    END LOOP;
  END IF;

  IF v_paid > 0 AND v_total_payments_processed = 0 THEN
    v_acc_id := public.resolve_business_account(v_business_id, NULL, v_payment_method);
    INSERT INTO public.sale_payments (sale_id, business_id, account_id, payment_method, amount)
    VALUES (v_sale_id, v_business_id, v_acc_id, v_payment_method, v_paid);

    IF v_acc_id IS NOT NULL THEN
      SELECT balance, name INTO v_acc_bal, v_acc_name
      FROM public.accounts WHERE id = v_acc_id AND business_id = v_business_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.accounts SET balance = COALESCE(v_acc_bal, 0) + v_paid, updated_at = NOW() WHERE id = v_acc_id;
        INSERT INTO public.account_transactions (
          business_id, account_id, account_name, transaction_type, amount, balance_after, reference_id, note
        ) VALUES (
          v_business_id, v_acc_id, v_acc_name, 'sale_payment',
          v_paid, COALESCE(v_acc_bal, 0) + v_paid, v_invoice_number,
          'Sale payment for ' || v_invoice_number
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'invoice_number', v_invoice_number,
    'total', v_total,
    'paid', v_paid,
    'due', v_due,
    'idempotent_hit', FALSE
  );
END;
$$;

-- 6. Upgrade record_partial_sale_return with:
--    - return_tx_id idempotency protection
--    - 'sellable' vs 'damaged' condition handling (damaged does NOT restore sellable stock)
--    - Exact variant_id stock restoration
--    - Status only becomes 'returned' once cumulative refunds reach sale.total
DROP FUNCTION IF EXISTS public.record_partial_sale_return(UUID, UUID, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.record_partial_sale_return(
  p_business_id UUID,
  p_sale_id UUID,
  p_items JSONB,
  p_refund_type TEXT DEFAULT 'cash',
  p_return_tx_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_existing_ret RECORD;
  v_item JSONB;
  v_prod_id UUID;
  v_var_id UUID;
  v_qty NUMERIC(14,2);
  v_unit_price NUMERIC(14,2);
  v_condition TEXT;
  v_total_refund NUMERIC(14,2) := 0;
  v_prod_stock NUMERIC(14,2);
  v_prod_name TEXT;
  v_cust RECORD;
  v_acc_id UUID;
  v_acc_bal NUMERIC(14,2);
  v_acc_name TEXT;
  v_next_refunded NUMERIC(14,2);
BEGIN
  PERFORM public.assert_caller_business_permission(p_business_id, 'sales_history', 'edit', TRUE);

  IF NULLIF(BTRIM(p_return_tx_id), '') IS NOT NULL THEN
    SELECT id, total_refund_amount INTO v_existing_ret
    FROM public.sale_returns
    WHERE business_id = p_business_id AND return_tx_id = BTRIM(p_return_tx_id)
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', TRUE, 'total_refund', v_existing_ret.total_refund_amount, 'idempotent_hit', TRUE);
    END IF;
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale invoice not found';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := public.safe_uuid(v_item->>'product_id');
    v_var_id := public.safe_uuid(v_item->>'variant_id');
    v_qty := COALESCE((v_item->>'quantity')::NUMERIC, 0);
    v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
    v_condition := COALESCE(NULLIF(v_item->>'condition', ''), 'sellable');
    v_total_refund := v_total_refund + (v_qty * v_unit_price);

    IF v_prod_id IS NOT NULL AND v_qty > 0 THEN
      SELECT current_stock, name INTO v_prod_stock, v_prod_name
      FROM public.products WHERE id = v_prod_id AND business_id = p_business_id FOR UPDATE;
      IF FOUND THEN
        IF v_condition <> 'damaged' THEN
          UPDATE public.products
          SET current_stock = COALESCE(v_prod_stock, 0) + v_qty, updated_at = NOW()
          WHERE id = v_prod_id;

          IF v_var_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock = COALESCE(stock, 0) + v_qty, updated_at = NOW()
            WHERE id = v_var_id AND product_id = v_prod_id;
          END IF;

          INSERT INTO public.stock_movements (
            business_id, branch_id, product_id, product_name,
            movement_type, quantity, previous_stock, new_stock, reference, note
          ) VALUES (
            p_business_id, v_sale.branch_id, v_prod_id, v_prod_name,
            'sale_return', v_qty, v_prod_stock, COALESCE(v_prod_stock, 0) + v_qty,
            v_sale.invoice_number, 'Sale return (sellable): ' || COALESCE(v_item->>'reason', 'Returned')
          );
        ELSE
          INSERT INTO public.stock_movements (
            business_id, branch_id, product_id, product_name,
            movement_type, quantity, previous_stock, new_stock, reference, note
          ) VALUES (
            p_business_id, v_sale.branch_id, v_prod_id, v_prod_name,
            'adjustment', 0, v_prod_stock, v_prod_stock,
            v_sale.invoice_number, 'Damaged return quarantined (' || v_qty || ' pcs): ' || COALESCE(v_item->>'reason', 'Damaged')
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF p_refund_type = 'adjust_due' AND v_sale.customer_id IS NOT NULL THEN
    SELECT * INTO v_cust FROM public.customers WHERE id = v_sale.customer_id AND business_id = p_business_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.customers
      SET current_due = GREATEST(0, COALESCE(current_due, 0) - v_total_refund), updated_at = NOW()
      WHERE id = v_sale.customer_id;

      INSERT INTO public.customer_transactions (
        business_id, customer_id, customer_name, transaction_type,
        amount, balance_after, payment_method, reference_id, note
      ) VALUES (
        p_business_id, v_sale.customer_id, v_cust.name, 'return_adjustment',
        v_total_refund, GREATEST(0, COALESCE(v_cust.current_due, 0) - v_total_refund),
        'due', v_sale.invoice_number, 'Return adjusted against due (' || v_sale.invoice_number || ')'
      );
    END IF;
  ELSIF v_total_refund > 0 THEN
    v_acc_id := public.resolve_business_account(p_business_id, NULL, v_sale.payment_method);
    IF v_acc_id IS NOT NULL THEN
      SELECT balance, name INTO v_acc_bal, v_acc_name FROM public.accounts WHERE id = v_acc_id AND business_id = p_business_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.accounts
        SET balance = COALESCE(v_acc_bal, 0) - v_total_refund, updated_at = NOW()
        WHERE id = v_acc_id;

        INSERT INTO public.account_transactions (
          business_id, account_id, account_name, transaction_type,
          amount, balance_after, reference_id, note
        ) VALUES (
          p_business_id, v_acc_id, v_acc_name, 'refund',
          -v_total_refund, COALESCE(v_acc_bal, 0) - v_total_refund, v_sale.invoice_number,
          'Cash return refund for ' || v_sale.invoice_number
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO public.sale_returns (
    business_id, branch_id, sale_id, invoice_number, return_tx_id, customer_id, customer_name,
    refund_type, total_refund_amount, items
  ) VALUES (
    p_business_id, v_sale.branch_id, p_sale_id, v_sale.invoice_number, NULLIF(BTRIM(p_return_tx_id), ''),
    v_sale.customer_id, v_sale.customer_name,
    p_refund_type, v_total_refund, p_items
  );

  v_next_refunded := COALESCE(v_sale.refunded_amount, 0) + v_total_refund;

  UPDATE public.sales
  SET status = CASE
        WHEN v_next_refunded >= COALESCE(total, 0) THEN 'returned'
        WHEN p_refund_type = 'adjust_due' AND GREATEST(0, COALESCE(due, 0) - v_total_refund) = 0 AND status IN ('due', 'partial') THEN 'paid'
        ELSE status
      END,
      due = CASE WHEN p_refund_type = 'adjust_due' THEN GREATEST(0, COALESCE(due, 0) - v_total_refund) ELSE due END,
      refunded_amount = v_next_refunded,
      refunded_at = NOW(),
      updated_at = NOW()
  WHERE id = p_sale_id;

  RETURN jsonb_build_object('success', TRUE, 'total_refund', v_total_refund, 'idempotent_hit', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.record_partial_sale_return(UUID, UUID, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_partial_sale_return(UUID, UUID, JSONB, TEXT, TEXT) TO authenticated, service_role;

-- 7. Upgrade refund_or_void_sale_transaction to also reverse combo_offer_usage counts
CREATE OR REPLACE FUNCTION public.refund_or_void_sale_transaction(
  p_business_id UUID,
  p_sale_id UUID,
  p_status TEXT,
  p_reason TEXT DEFAULT 'Full Refund'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_item RECORD;
  v_usage RECORD;
  v_prod_stock NUMERIC(14,2);
  v_acc_id UUID;
  v_acc_bal NUMERIC(14,2);
  v_acc_name TEXT;
  v_cust RECORD;
BEGIN
  PERFORM public.assert_caller_business_permission(p_business_id, 'sales_history', 'edit', TRUE);

  IF p_status NOT IN ('returned', 'voided') THEN
    RAISE EXCEPTION 'Invalid refund/void status: %', p_status;
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale invoice not found';
  END IF;

  IF v_sale.status IN ('returned', 'voided') THEN
    RAISE EXCEPTION 'Sale % is already %', v_sale.invoice_number, v_sale.status;
  END IF;

  FOR v_item IN SELECT * FROM public.sale_items WHERE sale_id = p_sale_id
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT current_stock INTO v_prod_stock
      FROM public.products WHERE id = v_item.product_id AND business_id = p_business_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.products
        SET current_stock = COALESCE(v_prod_stock, 0) + v_item.quantity, updated_at = NOW()
        WHERE id = v_item.product_id;

        IF v_item.variant_id IS NOT NULL THEN
          UPDATE public.product_variants
          SET stock = COALESCE(stock, 0) + v_item.quantity, updated_at = NOW()
          WHERE id = v_item.variant_id AND product_id = v_item.product_id;
        END IF;

        INSERT INTO public.stock_movements (
          business_id, branch_id, product_id, product_name,
          movement_type, quantity, previous_stock, new_stock, reference, note
        ) VALUES (
          p_business_id, v_sale.branch_id, v_item.product_id, v_item.product_name,
          'sale_return', v_item.quantity, v_prod_stock, COALESCE(v_prod_stock, 0) + v_item.quantity,
          v_sale.invoice_number, UPPER(p_status) || ': ' || COALESCE(p_reason, 'Refund')
        );
      END IF;
    END IF;
  END LOOP;

  -- Reverse combo offer usage counts & remove usage rows for voided/full-refunded sale
  FOR v_usage IN
    SELECT offer_id, SUM(GREATEST(1, COALESCE(combo_quantity, 1))) AS qty_sum
    FROM public.combo_offer_usage
    WHERE business_id = p_business_id AND sale_id = p_sale_id
    GROUP BY offer_id
  LOOP
    UPDATE public.combo_offers
    SET usage_count = GREATEST(0, COALESCE(usage_count, 0) - v_usage.qty_sum),
        status = CASE
          WHEN status = 'expired' AND max_usage_limit IS NOT NULL AND GREATEST(0, COALESCE(usage_count, 0) - v_usage.qty_sum) < max_usage_limit THEN 'active'
          ELSE status
        END,
        updated_at = NOW()
    WHERE id = v_usage.offer_id AND business_id = p_business_id;
  END LOOP;

  DELETE FROM public.combo_offer_usage
  WHERE business_id = p_business_id AND sale_id = p_sale_id;

  IF v_sale.customer_id IS NOT NULL AND COALESCE(v_sale.due, 0) > 0 THEN
    SELECT * INTO v_cust FROM public.customers WHERE id = v_sale.customer_id AND business_id = p_business_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.customers
      SET current_due = GREATEST(0, COALESCE(current_due, 0) - v_sale.due), updated_at = NOW()
      WHERE id = v_sale.customer_id;

      INSERT INTO public.customer_transactions (
        business_id, customer_id, customer_name, transaction_type,
        amount, balance_after, payment_method, reference_id, note
      ) VALUES (
        p_business_id, v_sale.customer_id, v_cust.name, 'return_adjustment',
        v_sale.due, GREATEST(0, COALESCE(v_cust.current_due, 0) - v_sale.due),
        v_sale.payment_method, v_sale.invoice_number,
        'Due reversed on ' || p_status || ' (' || v_sale.invoice_number || ')'
      );
    END IF;
  END IF;

  IF COALESCE(v_sale.paid, 0) > 0 THEN
    v_acc_id := public.resolve_business_account(p_business_id, NULL, v_sale.payment_method);
    IF v_acc_id IS NOT NULL THEN
      SELECT balance, name INTO v_acc_bal, v_acc_name
      FROM public.accounts WHERE id = v_acc_id AND business_id = p_business_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.accounts
        SET balance = COALESCE(v_acc_bal, 0) - v_sale.paid, updated_at = NOW()
        WHERE id = v_acc_id;

        INSERT INTO public.account_transactions (
          business_id, account_id, account_name, transaction_type,
          amount, balance_after, reference_id, note
        ) VALUES (
          p_business_id, v_acc_id, v_acc_name, 'refund',
          -v_sale.paid, COALESCE(v_acc_bal, 0) - v_sale.paid, v_sale.invoice_number,
          'Refund for ' || v_sale.invoice_number || ': ' || COALESCE(p_reason, '')
        );
      END IF;
    END IF;
  END IF;

  UPDATE public.sales
  SET status = p_status,
      refunded_amount = v_sale.paid,
      refund_reason = COALESCE(p_reason, 'Refund'),
      refunded_at = NOW(),
      notes = COALESCE(p_reason, notes),
      updated_at = NOW()
  WHERE id = p_sale_id;

  RETURN jsonb_build_object('success', TRUE, 'sale_id', p_sale_id, 'status', p_status);
END;
$$;
