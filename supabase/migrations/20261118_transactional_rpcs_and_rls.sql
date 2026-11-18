-- ============================================================================
-- Amar Dokan Pro: Transactional RPCs & Comprehensive RLS Policies
-- Run AFTER 20261114_core_schema.sql and 20261115_rbac_staff_management.sql
-- ============================================================================

-- Helper: Safe UUID text cast returning NULL on blank/non-UUID strings
CREATE OR REPLACE FUNCTION public.safe_uuid(p_val TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_val IS NULL OR BTRIM(p_val) = '' THEN
    RETURN NULL;
  END IF;
  RETURN BTRIM(p_val)::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Helper: Resolve account by explicit ID or payment method
CREATE OR REPLACE FUNCTION public.resolve_business_account(
  p_business_id UUID,
  p_account_id UUID,
  p_payment_method TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc_id UUID;
  v_target_type TEXT;
BEGIN
  IF p_account_id IS NOT NULL THEN
    SELECT id INTO v_acc_id
    FROM public.accounts
    WHERE id = p_account_id AND business_id = p_business_id
    LIMIT 1;
    IF v_acc_id IS NOT NULL THEN
      RETURN v_acc_id;
    END IF;
  END IF;

  v_target_type := CASE LOWER(COALESCE(p_payment_method, 'cash'))
    WHEN 'bkash' THEN 'mobile_bank'
    WHEN 'nagad' THEN 'mobile_bank'
    WHEN 'rocket' THEN 'mobile_bank'
    WHEN 'bank' THEN 'bank'
    WHEN 'card' THEN 'bank'
    ELSE 'cash'
  END;

  SELECT id INTO v_acc_id
  FROM public.accounts
  WHERE business_id = p_business_id
    AND account_type = v_target_type
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_acc_id IS NULL THEN
    SELECT id INTO v_acc_id
    FROM public.accounts
    WHERE business_id = p_business_id
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  RETURN v_acc_id;
END;
$$;

-- ============================================================================
-- 1. ATOMIC SALE CHECKOUT RPC: complete_sale_transaction
-- ============================================================================
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

  v_sale_id UUID;
  v_item JSONB;
  v_pay JSONB;
  v_prod_id UUID;
  v_var_id UUID;
  v_qty NUMERIC(14,2);
  v_prev_stock NUMERIC(14,2);
  v_new_stock NUMERIC(14,2);
  v_var_stock NUMERIC(14,2);
  v_prod_name TEXT;
  v_cust_row RECORD;
  v_new_cust_due NUMERIC(14,2);
  v_acc_id UUID;
  v_acc_bal NUMERIC(14,2);
  v_acc_name TEXT;
  v_pay_amt NUMERIC(14,2);
  v_pay_method TEXT;
  v_total_payments_processed NUMERIC(14,2) := 0;
BEGIN
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Missing valid business_id for sale transaction';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.has_module_permission(v_business_id, 'pos_new_sale', 'create') THEN
    RAISE EXCEPTION 'Permission denied: missing POS / New Sale create permission';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cannot complete sale without at least one item';
  END IF;

  IF v_invoice_number IS NULL THEN
    v_invoice_number := 'INV-' || TO_CHAR(NOW(), 'YYMMDDHH24MISS');
  END IF;

  -- Prevent duplicate invoice submission
  IF EXISTS (
    SELECT 1 FROM public.sales
    WHERE business_id = v_business_id AND invoice_number = v_invoice_number
  ) THEN
    RAISE EXCEPTION 'Duplicate invoice number "%" detected. Sale already recorded.', v_invoice_number;
  END IF;

  -- Insert master sale row
  INSERT INTO public.sales (
    business_id,
    branch_id,
    invoice_number,
    customer_id,
    customer_name,
    customer_mobile,
    subtotal,
    discount,
    combo_discount,
    applied_offers,
    vat_tax_rate,
    vat_tax_amount,
    total,
    paid,
    due,
    payment_method,
    status,
    served_by,
    employee_id,
    employee_code,
    employee_name,
    seller_id,
    seller_name,
    notes
  ) VALUES (
    v_business_id,
    v_branch_id,
    v_invoice_number,
    v_customer_id,
    COALESCE(NULLIF(p_sale->>'customer_name', ''), 'Walk-in Customer'),
    NULLIF(p_sale->>'customer_mobile', ''),
    v_subtotal,
    v_discount,
    v_combo_discount,
    COALESCE(p_sale->'applied_offers', '[]'::jsonb),
    v_vat_rate,
    v_vat_amount,
    v_total,
    v_paid,
    v_due,
    v_payment_method,
    v_status,
    COALESCE(NULLIF(p_sale->>'served_by', ''), 'Staff'),
    v_employee_id,
    NULLIF(p_sale->>'employee_code', ''),
    NULLIF(p_sale->>'employee_name', ''),
    v_seller_id,
    NULLIF(p_sale->>'seller_name', ''),
    NULLIF(p_sale->>'notes', '')
  )
  RETURNING id INTO v_sale_id;

  -- Process each item atomically with row-level lock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := public.safe_uuid(v_item->>'product_id');
    v_var_id := public.safe_uuid(v_item->>'variant_id');
    v_qty := COALESCE((v_item->>'quantity')::NUMERIC, 0);

    IF v_prod_id IS NULL THEN
      RAISE EXCEPTION 'Invalid product_id in sale items';
    END IF;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Sale item quantity must be greater than zero';
    END IF;

    SELECT current_stock, name
      INTO v_prev_stock, v_prod_name
    FROM public.products
    WHERE id = v_prod_id AND business_id = v_business_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found in active business inventory', v_prod_id;
    END IF;

    IF v_prev_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for "%" (Available: %, Requested: %)', v_prod_name, v_prev_stock, v_qty;
    END IF;

    v_new_stock := v_prev_stock - v_qty;

    -- Lock & decrement variant stock if variant_id provided
    IF v_var_id IS NOT NULL THEN
      SELECT stock INTO v_var_stock
      FROM public.product_variants
      WHERE id = v_var_id AND product_id = v_prod_id
      FOR UPDATE;

      IF FOUND THEN
        IF v_var_stock < v_qty THEN
          RAISE EXCEPTION 'Insufficient variant stock for "%" (Available: %, Requested: %)', v_prod_name, v_var_stock, v_qty;
        END IF;
        UPDATE public.product_variants
        SET stock = v_var_stock - v_qty,
            updated_at = NOW()
        WHERE id = v_var_id;
      END IF;
    END IF;

    UPDATE public.products
    SET current_stock = v_new_stock,
        updated_at = NOW()
    WHERE id = v_prod_id;

    INSERT INTO public.sale_items (
      sale_id,
      business_id,
      product_id,
      variant_id,
      product_name,
      sku,
      variant_details,
      quantity,
      unit_price,
      purchase_price,
      discount,
      total,
      combo_offer_id,
      combo_offer_name,
      is_free_item
    ) VALUES (
      v_sale_id,
      v_business_id,
      v_prod_id,
      v_var_id,
      COALESCE(NULLIF(v_item->>'product_name', ''), v_prod_name),
      COALESCE(v_item->>'sku', ''),
      NULLIF(v_item->>'variant_details', ''),
      v_qty,
      COALESCE((v_item->>'unit_price')::NUMERIC, 0),
      COALESCE((v_item->>'purchase_price')::NUMERIC, 0),
      COALESCE((v_item->>'discount')::NUMERIC, 0),
      COALESCE((v_item->>'total')::NUMERIC, 0),
      NULLIF(v_item->>'combo_offer_id', ''),
      NULLIF(v_item->>'combo_offer_name', ''),
      COALESCE((v_item->>'is_free_item')::BOOLEAN, FALSE)
    );

    INSERT INTO public.stock_movements (
      business_id,
      branch_id,
      product_id,
      product_name,
      movement_type,
      quantity,
      previous_stock,
      new_stock,
      reference,
      note
    ) VALUES (
      v_business_id,
      v_branch_id,
      v_prod_id,
      COALESCE(NULLIF(v_item->>'product_name', ''), v_prod_name),
      'sale_out',
      -v_qty,
      v_prev_stock,
      v_new_stock,
      v_invoice_number,
      'Sale invoice ' || v_invoice_number
    );
  END LOOP;

  -- Update customer balance and record customer transaction
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

  -- Record sale payments & credit financial accounts
  IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      v_pay_amt := COALESCE((v_pay->>'amount')::NUMERIC, 0);
      v_pay_method := COALESCE(NULLIF(v_pay->>'payment_method', ''), v_payment_method);
      IF v_pay_amt > 0 THEN
        v_acc_id := public.resolve_business_account(
          v_business_id,
          public.safe_uuid(v_pay->>'account_id'),
          v_pay_method
        );

        INSERT INTO public.sale_payments (
          sale_id, business_id, account_id, payment_method, amount, trx_id
        ) VALUES (
          v_sale_id, v_business_id, v_acc_id, v_pay_method, v_pay_amt, NULLIF(v_pay->>'trx_id', '')
        );

        IF v_acc_id IS NOT NULL THEN
          SELECT balance, name INTO v_acc_bal, v_acc_name
          FROM public.accounts WHERE id = v_acc_id FOR UPDATE;
          IF FOUND THEN
            UPDATE public.accounts
            SET balance = COALESCE(v_acc_bal, 0) + v_pay_amt,
                updated_at = NOW()
            WHERE id = v_acc_id;

            INSERT INTO public.account_transactions (
              business_id, account_id, account_name, transaction_type,
              amount, balance_after, reference_id, note
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

  -- Fallback account credit if v_paid > 0 and no explicit p_payments lines processed
  IF v_paid > 0 AND v_total_payments_processed = 0 THEN
    v_acc_id := public.resolve_business_account(v_business_id, NULL, v_payment_method);
    INSERT INTO public.sale_payments (
      sale_id, business_id, account_id, payment_method, amount
    ) VALUES (
      v_sale_id, v_business_id, v_acc_id, v_payment_method, v_paid
    );
    IF v_acc_id IS NOT NULL THEN
      SELECT balance, name INTO v_acc_bal, v_acc_name
      FROM public.accounts WHERE id = v_acc_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.accounts
        SET balance = COALESCE(v_acc_bal, 0) + v_paid,
            updated_at = NOW()
        WHERE id = v_acc_id;

        INSERT INTO public.account_transactions (
          business_id, account_id, account_name, transaction_type,
          amount, balance_after, reference_id, note
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
    'due', v_due
  );
END;
$$;

-- ============================================================================
-- 2. ATOMIC REFUND / VOID / DELETE SALE RPCs
-- ============================================================================
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
  v_prod_stock NUMERIC(14,2);
  v_acc_id UUID;
  v_acc_bal NUMERIC(14,2);
  v_acc_name TEXT;
  v_cust RECORD;
BEGIN
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

  -- Restore stock for every item
  FOR v_item IN SELECT * FROM public.sale_items WHERE sale_id = p_sale_id
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT current_stock INTO v_prod_stock
      FROM public.products WHERE id = v_item.product_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.products
        SET current_stock = COALESCE(v_prod_stock, 0) + v_item.quantity,
            updated_at = NOW()
        WHERE id = v_item.product_id;

        IF v_item.variant_id IS NOT NULL THEN
          UPDATE public.product_variants
          SET stock = COALESCE(stock, 0) + v_item.quantity,
              updated_at = NOW()
          WHERE id = v_item.variant_id;
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

  -- Reverse customer due if customer had due on this sale
  IF v_sale.customer_id IS NOT NULL AND COALESCE(v_sale.due, 0) > 0 THEN
    SELECT * INTO v_cust FROM public.customers WHERE id = v_sale.customer_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.customers
      SET current_due = GREATEST(0, COALESCE(current_due, 0) - v_sale.due),
          updated_at = NOW()
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

  -- Refund paid amount from account
  IF COALESCE(v_sale.paid, 0) > 0 THEN
    v_acc_id := public.resolve_business_account(p_business_id, NULL, v_sale.payment_method);
    IF v_acc_id IS NOT NULL THEN
      SELECT balance, name INTO v_acc_bal, v_acc_name
      FROM public.accounts WHERE id = v_acc_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.accounts
        SET balance = COALESCE(v_acc_bal, 0) - v_sale.paid,
            updated_at = NOW()
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

CREATE OR REPLACE FUNCTION public.record_partial_sale_return(
  p_business_id UUID,
  p_sale_id UUID,
  p_items JSONB,
  p_refund_type TEXT DEFAULT 'cash'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_item JSONB;
  v_prod_id UUID;
  v_var_id UUID;
  v_qty NUMERIC(14,2);
  v_unit_price NUMERIC(14,2);
  v_total_refund NUMERIC(14,2) := 0;
  v_prod_stock NUMERIC(14,2);
  v_prod_name TEXT;
  v_cust RECORD;
  v_acc_id UUID;
  v_acc_bal NUMERIC(14,2);
  v_acc_name TEXT;
BEGIN
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
    v_total_refund := v_total_refund + (v_qty * v_unit_price);

    IF v_prod_id IS NOT NULL AND v_qty > 0 THEN
      SELECT current_stock, name INTO v_prod_stock, v_prod_name
      FROM public.products WHERE id = v_prod_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.products
        SET current_stock = COALESCE(v_prod_stock, 0) + v_qty,
            updated_at = NOW()
        WHERE id = v_prod_id;

        IF v_var_id IS NOT NULL THEN
          UPDATE public.product_variants
          SET stock = COALESCE(stock, 0) + v_qty, updated_at = NOW()
          WHERE id = v_var_id;
        END IF;

        INSERT INTO public.stock_movements (
          business_id, branch_id, product_id, product_name,
          movement_type, quantity, previous_stock, new_stock, reference, note
        ) VALUES (
          p_business_id, v_sale.branch_id, v_prod_id, v_prod_name,
          'sale_return', v_qty, v_prod_stock, COALESCE(v_prod_stock, 0) + v_qty,
          v_sale.invoice_number, 'Sale return: ' || COALESCE(v_item->>'reason', 'Returned')
        );
      END IF;
    END IF;
  END LOOP;

  IF p_refund_type = 'adjust_due' AND v_sale.customer_id IS NOT NULL THEN
    SELECT * INTO v_cust FROM public.customers WHERE id = v_sale.customer_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.customers
      SET current_due = GREATEST(0, COALESCE(current_due, 0) - v_total_refund),
          updated_at = NOW()
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
      SELECT balance, name INTO v_acc_bal, v_acc_name FROM public.accounts WHERE id = v_acc_id FOR UPDATE;
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
    business_id, sale_id, invoice_number, customer_id, customer_name,
    refund_type, total_refund_amount, items
  ) VALUES (
    p_business_id, p_sale_id, v_sale.invoice_number, v_sale.customer_id, v_sale.customer_name,
    p_refund_type, v_total_refund, p_items
  );

  UPDATE public.sales
  SET status = 'returned',
      refunded_amount = COALESCE(refunded_amount, 0) + v_total_refund,
      refunded_at = NOW(),
      updated_at = NOW()
  WHERE id = p_sale_id;

  RETURN jsonb_build_object('success', TRUE, 'total_refund', v_total_refund);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_sale_transaction(
  p_business_id UUID,
  p_sale_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_item RECORD;
  v_prod_stock NUMERIC(14,2);
  v_acc_id UUID;
  v_acc_bal NUMERIC(14,2);
  v_cust RECORD;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_module_permission(p_business_id, 'sales_history', 'delete') THEN
    RAISE EXCEPTION 'Permission denied: missing Sales History delete permission';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale invoice not found';
  END IF;

  -- Reverse stock & balances only if sale wasn't already returned/voided
  IF v_sale.status NOT IN ('returned', 'voided') THEN
    FOR v_item IN SELECT * FROM public.sale_items WHERE sale_id = p_sale_id
    LOOP
      IF v_item.product_id IS NOT NULL THEN
        SELECT current_stock INTO v_prod_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;
        IF FOUND THEN
          UPDATE public.products
          SET current_stock = COALESCE(v_prod_stock, 0) + v_item.quantity, updated_at = NOW()
          WHERE id = v_item.product_id;

          IF v_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock = COALESCE(stock, 0) + v_item.quantity, updated_at = NOW()
            WHERE id = v_item.variant_id;
          END IF;

          INSERT INTO public.stock_movements (
            business_id, branch_id, product_id, product_name,
            movement_type, quantity, previous_stock, new_stock, reference, note
          ) VALUES (
            p_business_id, v_sale.branch_id, v_item.product_id, v_item.product_name,
            'adjustment', v_item.quantity, v_prod_stock, COALESCE(v_prod_stock, 0) + v_item.quantity,
            v_sale.invoice_number, 'Stock restored after deleting sale ' || v_sale.invoice_number
          );
        END IF;
      END IF;
    END LOOP;

    IF v_sale.customer_id IS NOT NULL THEN
      SELECT * INTO v_cust FROM public.customers WHERE id = v_sale.customer_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.customers
        SET total_purchase = GREATEST(0, COALESCE(total_purchase, 0) - COALESCE(v_sale.total, 0)),
            total_paid = GREATEST(0, COALESCE(total_paid, 0) - COALESCE(v_sale.paid, 0)),
            current_due = GREATEST(0, COALESCE(current_due, 0) - COALESCE(v_sale.due, 0)),
            updated_at = NOW()
        WHERE id = v_sale.customer_id;
      END IF;
    END IF;

    IF COALESCE(v_sale.paid, 0) > 0 THEN
      v_acc_id := public.resolve_business_account(p_business_id, NULL, v_sale.payment_method);
      IF v_acc_id IS NOT NULL THEN
        SELECT balance INTO v_acc_bal FROM public.accounts WHERE id = v_acc_id FOR UPDATE;
        IF FOUND THEN
          UPDATE public.accounts
          SET balance = COALESCE(v_acc_bal, 0) - v_sale.paid, updated_at = NOW()
          WHERE id = v_acc_id;
        END IF;
      END IF;
    END IF;
  END IF;

  DELETE FROM public.sales WHERE id = p_sale_id AND business_id = p_business_id;
  RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- ============================================================================
-- 3. ATOMIC PURCHASE CREATE / UPDATE / DELETE RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_transaction(
  p_purchase JSONB,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID := public.safe_uuid(p_purchase->>'business_id');
  v_branch_id UUID := public.safe_uuid(p_purchase->>'branch_id');
  v_supplier_id UUID := public.safe_uuid(p_purchase->>'supplier_id');
  v_invoice_number TEXT := NULLIF(BTRIM(p_purchase->>'invoice_number'), '');
  v_subtotal NUMERIC(14,2) := COALESCE((p_purchase->>'subtotal')::NUMERIC, 0);
  v_discount NUMERIC(14,2) := COALESCE((p_purchase->>'discount')::NUMERIC, 0);
  v_transport NUMERIC(14,2) := COALESCE((p_purchase->>'transport_cost')::NUMERIC, 0);
  v_loading NUMERIC(14,2) := COALESCE((p_purchase->>'loading_cost')::NUMERIC, 0);
  v_packaging NUMERIC(14,2) := COALESCE((p_purchase->>'packaging_cost')::NUMERIC, 0);
  v_other NUMERIC(14,2) := COALESCE((p_purchase->>'other_cost')::NUMERIC, 0);
  v_total NUMERIC(14,2) := COALESCE((p_purchase->>'total')::NUMERIC, 0);
  v_paid NUMERIC(14,2) := COALESCE((p_purchase->>'paid')::NUMERIC, 0);
  v_due NUMERIC(14,2) := COALESCE((p_purchase->>'due')::NUMERIC, 0);
  v_payment_method TEXT := COALESCE(NULLIF(p_purchase->>'payment_method', ''), 'cash');
  v_purchase_id UUID;
  v_item JSONB;
  v_prod_id UUID;
  v_qty NUMERIC(14,2);
  v_p_price NUMERIC(14,2);
  v_landed NUMERIC(14,2);
  v_prev_stock NUMERIC(14,2);
  v_new_stock NUMERIC(14,2);
  v_prod_name TEXT;
  v_supp RECORD;
  v_acc_id UUID;
  v_acc_bal NUMERIC(14,2);
  v_acc_name TEXT;
BEGIN
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Missing valid business_id for purchase transaction';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Purchase must include at least one item';
  END IF;

  IF v_invoice_number IS NULL THEN
    v_invoice_number := 'PUR-' || TO_CHAR(NOW(), 'YYMMDDHH24MISS');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.purchases WHERE business_id = v_business_id AND invoice_number = v_invoice_number
  ) THEN
    RAISE EXCEPTION 'Duplicate purchase invoice number "%"', v_invoice_number;
  END IF;

  INSERT INTO public.purchases (
    business_id, branch_id, supplier_id, supplier_name, invoice_number,
    subtotal, discount, transport_cost, loading_cost, packaging_cost, other_cost,
    total, paid, due, payment_method, status, notes
  ) VALUES (
    v_business_id, v_branch_id, v_supplier_id,
    COALESCE(NULLIF(p_purchase->>'supplier_name', ''), 'Supplier'),
    v_invoice_number,
    v_subtotal, v_discount, v_transport, v_loading, v_packaging, v_other,
    v_total, v_paid, v_due, v_payment_method,
    CASE WHEN v_due <= 0 THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'due' END,
    NULLIF(p_purchase->>'notes', '')
  )
  RETURNING id INTO v_purchase_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := public.safe_uuid(v_item->>'product_id');
    v_qty := COALESCE((v_item->>'quantity')::NUMERIC, 0);
    v_p_price := COALESCE((v_item->>'purchase_price')::NUMERIC, 0);
    v_landed := COALESCE((v_item->>'landed_cost_per_unit')::NUMERIC, v_p_price);

    IF v_prod_id IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid product or quantity in purchase items';
    END IF;

    SELECT current_stock, name INTO v_prev_stock, v_prod_name
    FROM public.products
    WHERE id = v_prod_id AND business_id = v_business_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found in business', v_prod_id;
    END IF;

    v_new_stock := COALESCE(v_prev_stock, 0) + v_qty;

    UPDATE public.products
    SET current_stock = v_new_stock,
        purchase_price = v_p_price,
        landed_cost_per_unit = v_landed,
        updated_at = NOW()
    WHERE id = v_prod_id;

    INSERT INTO public.purchase_items (
      purchase_id, business_id, product_id, product_name,
      quantity, purchase_price, sale_price, landed_cost_per_unit, total
    ) VALUES (
      v_purchase_id, v_business_id, v_prod_id,
      COALESCE(NULLIF(v_item->>'product_name', ''), v_prod_name),
      v_qty, v_p_price, COALESCE((v_item->>'sale_price')::NUMERIC, 0), v_landed,
      COALESCE((v_item->>'total')::NUMERIC, v_qty * v_p_price)
    );

    INSERT INTO public.stock_movements (
      business_id, branch_id, product_id, product_name,
      movement_type, quantity, previous_stock, new_stock, reference, note
    ) VALUES (
      v_business_id, v_branch_id, v_prod_id,
      COALESCE(NULLIF(v_item->>'product_name', ''), v_prod_name),
      'purchase_in', v_qty, v_prev_stock, v_new_stock, v_invoice_number,
      'Purchase shipment ' || v_invoice_number
    );
  END LOOP;

  IF v_supplier_id IS NOT NULL THEN
    SELECT * INTO v_supp FROM public.suppliers WHERE id = v_supplier_id AND business_id = v_business_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.suppliers
      SET total_purchase = COALESCE(total_purchase, 0) + v_total,
          total_paid = COALESCE(total_paid, 0) + v_paid,
          current_due = COALESCE(current_due, 0) + v_due,
          updated_at = NOW()
      WHERE id = v_supplier_id;

      IF v_due > 0 THEN
        INSERT INTO public.supplier_transactions (
          business_id, supplier_id, supplier_name, transaction_type,
          amount, balance_after, payment_method, reference_id, note
        ) VALUES (
          v_business_id, v_supplier_id, v_supp.name, 'purchase_due',
          v_due, COALESCE(v_supp.current_due, 0) + v_due, v_payment_method,
          v_invoice_number, 'Purchase bill ' || v_invoice_number
        );
      END IF;
    END IF;
  END IF;

  IF v_paid > 0 THEN
    v_acc_id := public.resolve_business_account(v_business_id, NULL, v_payment_method);
    IF v_acc_id IS NOT NULL THEN
      SELECT balance, name INTO v_acc_bal, v_acc_name FROM public.accounts WHERE id = v_acc_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.accounts
        SET balance = GREATEST(0, COALESCE(v_acc_bal, 0) - v_paid), updated_at = NOW()
        WHERE id = v_acc_id;

        INSERT INTO public.account_transactions (
          business_id, account_id, account_name, transaction_type,
          amount, balance_after, reference_id, note
        ) VALUES (
          v_business_id, v_acc_id, v_acc_name, 'purchase_payment',
          -v_paid, GREATEST(0, COALESCE(v_acc_bal, 0) - v_paid), v_invoice_number,
          'Purchase payment for ' || v_invoice_number
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('purchase_id', v_purchase_id, 'invoice_number', v_invoice_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_purchase_transaction(
  p_business_id UUID,
  p_purchase_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pur RECORD;
  v_item RECORD;
  v_prod_stock NUMERIC(14,2);
  v_supp RECORD;
  v_acc_id UUID;
  v_acc_bal NUMERIC(14,2);
  v_acc_name TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_module_permission(p_business_id, 'purchase_management', 'delete') THEN
    RAISE EXCEPTION 'Permission denied: missing Purchase Management delete permission';
  END IF;

  SELECT * INTO v_pur FROM public.purchases WHERE id = p_purchase_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase record not found';
  END IF;

  -- Deduct purchased quantities from product stock
  FOR v_item IN SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT current_stock INTO v_prod_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.products
        SET current_stock = GREATEST(0, COALESCE(v_prod_stock, 0) - v_item.quantity),
            updated_at = NOW()
        WHERE id = v_item.product_id;

        INSERT INTO public.stock_movements (
          business_id, branch_id, product_id, product_name,
          movement_type, quantity, previous_stock, new_stock, reference, note
        ) VALUES (
          p_business_id, v_pur.branch_id, v_item.product_id, v_item.product_name,
          'adjustment', -v_item.quantity, v_prod_stock, GREATEST(0, COALESCE(v_prod_stock, 0) - v_item.quantity),
          v_pur.invoice_number, 'Stock reversed on deleting purchase ' || v_pur.invoice_number
        );
      END IF;
    END IF;
  END LOOP;

  -- Reverse supplier balances
  IF v_pur.supplier_id IS NOT NULL THEN
    SELECT * INTO v_supp FROM public.suppliers WHERE id = v_pur.supplier_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.suppliers
      SET total_purchase = GREATEST(0, COALESCE(total_purchase, 0) - COALESCE(v_pur.total, 0)),
          total_paid = GREATEST(0, COALESCE(total_paid, 0) - COALESCE(v_pur.paid, 0)),
          current_due = GREATEST(0, COALESCE(current_due, 0) - COALESCE(v_pur.due, 0)),
          updated_at = NOW()
      WHERE id = v_pur.supplier_id;
    END IF;
  END IF;

  -- Restore paid amount back to account
  IF COALESCE(v_pur.paid, 0) > 0 THEN
    v_acc_id := public.resolve_business_account(p_business_id, NULL, v_pur.payment_method);
    IF v_acc_id IS NOT NULL THEN
      SELECT balance, name INTO v_acc_bal, v_acc_name FROM public.accounts WHERE id = v_acc_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.accounts
        SET balance = COALESCE(v_acc_bal, 0) + v_pur.paid, updated_at = NOW()
        WHERE id = v_acc_id;

        INSERT INTO public.account_transactions (
          business_id, account_id, account_name, transaction_type,
          amount, balance_after, reference_id, note
        ) VALUES (
          p_business_id, v_acc_id, v_acc_name, 'adjustment',
          v_pur.paid, COALESCE(v_acc_bal, 0) + v_pur.paid, v_pur.invoice_number,
          'Restored payment from deleted purchase ' || v_pur.invoice_number
        );
      END IF;
    END IF;
  END IF;

  DELETE FROM public.purchases WHERE id = p_purchase_id AND business_id = p_business_id;
  RETURN jsonb_build_object('success', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_purchase_transaction(
  p_business_id UUID,
  p_purchase_id UUID,
  p_purchase JSONB,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_pur RECORD;
  v_old_item RECORD;
  v_item JSONB;
  v_prod_id UUID;
  v_qty NUMERIC(14,2);
  v_p_price NUMERIC(14,2);
  v_landed NUMERIC(14,2);
  v_prev_stock NUMERIC(14,2);
  v_new_stock NUMERIC(14,2);
  v_prod_name TEXT;
  v_new_supplier_id UUID := public.safe_uuid(p_purchase->>'supplier_id');
  v_new_total NUMERIC(14,2) := COALESCE((p_purchase->>'total')::NUMERIC, 0);
  v_new_paid NUMERIC(14,2) := COALESCE((p_purchase->>'paid')::NUMERIC, 0);
  v_new_due NUMERIC(14,2) := COALESCE((p_purchase->>'due')::NUMERIC, 0);
  v_new_method TEXT := COALESCE(NULLIF(p_purchase->>'payment_method', ''), 'cash');
  v_acc_id UUID;
  v_acc_bal NUMERIC(14,2);
BEGIN
  SELECT * INTO v_old_pur FROM public.purchases WHERE id = p_purchase_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase record not found';
  END IF;

  -- 1. Reverse old items stock
  FOR v_old_item IN SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id
  LOOP
    IF v_old_item.product_id IS NOT NULL THEN
      SELECT current_stock INTO v_prev_stock FROM public.products WHERE id = v_old_item.product_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.products
        SET current_stock = GREATEST(0, COALESCE(v_prev_stock, 0) - v_old_item.quantity),
            updated_at = NOW()
        WHERE id = v_old_item.product_id;
      END IF;
    END IF;
  END LOOP;

  -- 2. Reverse old supplier balance
  IF v_old_pur.supplier_id IS NOT NULL THEN
    UPDATE public.suppliers
    SET total_purchase = GREATEST(0, COALESCE(total_purchase, 0) - COALESCE(v_old_pur.total, 0)),
        total_paid = GREATEST(0, COALESCE(total_paid, 0) - COALESCE(v_old_pur.paid, 0)),
        current_due = GREATEST(0, COALESCE(current_due, 0) - COALESCE(v_old_pur.due, 0)),
        updated_at = NOW()
    WHERE id = v_old_pur.supplier_id;
  END IF;

  -- 3. Restore old paid amount to account
  IF COALESCE(v_old_pur.paid, 0) > 0 THEN
    v_acc_id := public.resolve_business_account(p_business_id, NULL, v_old_pur.payment_method);
    IF v_acc_id IS NOT NULL THEN
      UPDATE public.accounts
      SET balance = COALESCE(balance, 0) + v_old_pur.paid, updated_at = NOW()
      WHERE id = v_acc_id;
    END IF;
  END IF;

  -- 4. Replace purchase header and items
  DELETE FROM public.purchase_items WHERE purchase_id = p_purchase_id;

  UPDATE public.purchases
  SET supplier_id = v_new_supplier_id,
      supplier_name = COALESCE(NULLIF(p_purchase->>'supplier_name', ''), v_old_pur.supplier_name),
      invoice_number = COALESCE(NULLIF(p_purchase->>'invoice_number', ''), v_old_pur.invoice_number),
      subtotal = COALESCE((p_purchase->>'subtotal')::NUMERIC, 0),
      discount = COALESCE((p_purchase->>'discount')::NUMERIC, 0),
      transport_cost = COALESCE((p_purchase->>'transport_cost')::NUMERIC, 0),
      loading_cost = COALESCE((p_purchase->>'loading_cost')::NUMERIC, 0),
      packaging_cost = COALESCE((p_purchase->>'packaging_cost')::NUMERIC, 0),
      other_cost = COALESCE((p_purchase->>'other_cost')::NUMERIC, 0),
      total = v_new_total,
      paid = v_new_paid,
      due = v_new_due,
      payment_method = v_new_method,
      status = CASE WHEN v_new_due <= 0 THEN 'paid' WHEN v_new_paid > 0 THEN 'partial' ELSE 'due' END,
      notes = NULLIF(p_purchase->>'notes', ''),
      updated_at = NOW()
  WHERE id = p_purchase_id;

  -- 5. Apply new items stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := public.safe_uuid(v_item->>'product_id');
    v_qty := COALESCE((v_item->>'quantity')::NUMERIC, 0);
    v_p_price := COALESCE((v_item->>'purchase_price')::NUMERIC, 0);
    v_landed := COALESCE((v_item->>'landed_cost_per_unit')::NUMERIC, v_p_price);

    SELECT current_stock, name INTO v_prev_stock, v_prod_name
    FROM public.products WHERE id = v_prod_id AND business_id = p_business_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found', v_prod_id;
    END IF;
    v_new_stock := COALESCE(v_prev_stock, 0) + v_qty;

    UPDATE public.products
    SET current_stock = v_new_stock,
        purchase_price = v_p_price,
        landed_cost_per_unit = v_landed,
        updated_at = NOW()
    WHERE id = v_prod_id;

    INSERT INTO public.purchase_items (
      purchase_id, business_id, product_id, product_name,
      quantity, purchase_price, sale_price, landed_cost_per_unit, total
    ) VALUES (
      p_purchase_id, p_business_id, v_prod_id,
      COALESCE(NULLIF(v_item->>'product_name', ''), v_prod_name),
      v_qty, v_p_price, COALESCE((v_item->>'sale_price')::NUMERIC, 0), v_landed,
      COALESCE((v_item->>'total')::NUMERIC, v_qty * v_p_price)
    );
  END LOOP;

  -- 6. Apply new supplier balances
  IF v_new_supplier_id IS NOT NULL THEN
    UPDATE public.suppliers
    SET total_purchase = COALESCE(total_purchase, 0) + v_new_total,
        total_paid = COALESCE(total_paid, 0) + v_new_paid,
        current_due = COALESCE(current_due, 0) + v_new_due,
        updated_at = NOW()
    WHERE id = v_new_supplier_id;
  END IF;

  -- 7. Deduct new paid amount
  IF v_new_paid > 0 THEN
    v_acc_id := public.resolve_business_account(p_business_id, NULL, v_new_method);
    IF v_acc_id IS NOT NULL THEN
      SELECT balance INTO v_acc_bal FROM public.accounts WHERE id = v_acc_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.accounts
        SET balance = GREATEST(0, COALESCE(v_acc_bal, 0) - v_new_paid), updated_at = NOW()
        WHERE id = v_acc_id;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'purchase_id', p_purchase_id);
END;
$$;

-- ============================================================================
-- 4. INVENTORY, DUE COLLECTION, SUPPLIER PAYMENT, EXPENSE & TRANSFER RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_business_id UUID,
  p_branch_id UUID,
  p_product_id UUID,
  p_adjusted_qty NUMERIC,
  p_reason TEXT,
  p_note TEXT DEFAULT NULL,
  p_variant_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev NUMERIC(14,2);
  v_next NUMERIC(14,2);
  v_name TEXT;
BEGIN
  SELECT current_stock, name INTO v_prev, v_name
  FROM public.products
  WHERE id = p_product_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found in business';
  END IF;

  v_next := GREATEST(0, COALESCE(v_prev, 0) + COALESCE(p_adjusted_qty, 0));

  UPDATE public.products
  SET current_stock = v_next, updated_at = NOW()
  WHERE id = p_product_id;

  IF p_variant_id IS NOT NULL THEN
    UPDATE public.product_variants
    SET stock = GREATEST(0, COALESCE(stock, 0) + COALESCE(p_adjusted_qty, 0)),
        updated_at = NOW()
    WHERE id = p_variant_id AND product_id = p_product_id;
  END IF;

  INSERT INTO public.stock_movements (
    business_id, branch_id, product_id, product_name,
    movement_type, quantity, previous_stock, new_stock, note
  ) VALUES (
    p_business_id, p_branch_id, p_product_id, v_name,
    'adjustment', p_adjusted_qty, v_prev, v_next,
    'Adjustment (' || COALESCE(p_reason, 'correction') || ')' || CASE WHEN p_note IS NOT NULL AND p_note <> '' THEN ': ' || p_note ELSE '' END
  );

  RETURN jsonb_build_object('previous_stock', v_prev, 'new_stock', v_next);
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_branch_stock(
  p_business_id UUID,
  p_product_id UUID,
  p_quantity NUMERIC,
  p_from_branch_id UUID,
  p_to_branch_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod RECORD;
  v_from_name TEXT;
  v_to_name TEXT;
  v_ref TEXT := 'TF-' || TO_CHAR(NOW(), 'YYMMDDHH24MISS');
BEGIN
  IF p_quantity <= 0 OR p_from_branch_id = p_to_branch_id THEN
    RAISE EXCEPTION 'Invalid transfer quantity or branches';
  END IF;

  SELECT name, current_stock INTO v_prod FROM public.products WHERE id = p_product_id AND business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  SELECT name INTO v_from_name FROM public.branches WHERE id = p_from_branch_id;
  SELECT name INTO v_to_name FROM public.branches WHERE id = p_to_branch_id;

  INSERT INTO public.stock_transfers (
    business_id, product_id, product_name, quantity,
    from_branch_id, from_branch_name, to_branch_id, to_branch_name, reference, note
  ) VALUES (
    p_business_id, p_product_id, v_prod.name, p_quantity,
    p_from_branch_id, COALESCE(v_from_name, 'Source'), p_to_branch_id, COALESCE(v_to_name, 'Destination'), v_ref, p_note
  );

  INSERT INTO public.stock_movements (
    business_id, branch_id, product_id, product_name,
    movement_type, quantity, previous_stock, new_stock, reference, note
  ) VALUES
    (p_business_id, p_from_branch_id, p_product_id, v_prod.name, 'transfer_out', -p_quantity, v_prod.current_stock, v_prod.current_stock, v_ref, 'Transfer to ' || COALESCE(v_to_name, 'Branch')),
    (p_business_id, p_to_branch_id, p_product_id, v_prod.name, 'transfer_in', p_quantity, v_prod.current_stock, v_prod.current_stock, v_ref, 'Transfer from ' || COALESCE(v_from_name, 'Branch'));

  RETURN jsonb_build_object('success', TRUE, 'reference', v_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.collect_customer_due_payment(
  p_business_id UUID,
  p_customer_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_account_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust RECORD;
  v_prev_due NUMERIC(14,2);
  v_new_due NUMERIC(14,2);
  v_acc_id UUID;
  v_acc_bal NUMERIC(14,2);
  v_acc_name TEXT;
  v_ref TEXT := 'DUE-' || TO_CHAR(NOW(), 'YYMMDDHH24MISS');
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Collection amount must be greater than zero';
  END IF;

  SELECT * INTO v_cust FROM public.customers WHERE id = p_customer_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  v_prev_due := COALESCE(v_cust.current_due, 0);
  v_new_due := GREATEST(0, v_prev_due - p_amount);

  UPDATE public.customers
  SET current_due = v_new_due,
      total_paid = COALESCE(total_paid, 0) + p_amount,
      updated_at = NOW()
  WHERE id = p_customer_id;

  INSERT INTO public.customer_transactions (
    business_id, customer_id, customer_name, transaction_type,
    amount, balance_after, payment_method, reference_id, note
  ) VALUES (
    p_business_id, p_customer_id, v_cust.name, 'due_collection',
    p_amount, v_new_due, p_payment_method, v_ref, COALESCE(p_note, 'Due payment collection')
  );

  v_acc_id := public.resolve_business_account(p_business_id, p_account_id, p_payment_method);
  IF v_acc_id IS NOT NULL THEN
    SELECT balance, name INTO v_acc_bal, v_acc_name FROM public.accounts WHERE id = v_acc_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.accounts
      SET balance = COALESCE(v_acc_bal, 0) + p_amount, updated_at = NOW()
      WHERE id = v_acc_id;

      INSERT INTO public.account_transactions (
        business_id, account_id, account_name, transaction_type,
        amount, balance_after, reference_id, note
      ) VALUES (
        p_business_id, v_acc_id, v_acc_name, 'customer_payment',
        p_amount, COALESCE(v_acc_bal, 0) + p_amount, v_ref,
        'Due collection from ' || v_cust.name
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('previous_due', v_prev_due, 'new_due', v_new_due, 'reference_id', v_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_supplier_due_balance(
  p_business_id UUID,
  p_supplier_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_account_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supp RECORD;
  v_prev_due NUMERIC(14,2);
  v_new_due NUMERIC(14,2);
  v_acc_id UUID;
  v_acc_bal NUMERIC(14,2);
  v_acc_name TEXT;
  v_ref TEXT := 'SPAY-' || TO_CHAR(NOW(), 'YYMMDDHH24MISS');
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT * INTO v_supp FROM public.suppliers WHERE id = p_supplier_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier not found';
  END IF;

  v_acc_id := public.resolve_business_account(p_business_id, p_account_id, p_payment_method);
  IF v_acc_id IS NOT NULL THEN
    SELECT balance, name INTO v_acc_bal, v_acc_name FROM public.accounts WHERE id = v_acc_id FOR UPDATE;
    IF FOUND THEN
      IF COALESCE(v_acc_bal, 0) < p_amount THEN
        RAISE EXCEPTION 'Insufficient balance in account "%"', v_acc_name;
      END IF;
      UPDATE public.accounts
      SET balance = COALESCE(v_acc_bal, 0) - p_amount, updated_at = NOW()
      WHERE id = v_acc_id;

      INSERT INTO public.account_transactions (
        business_id, account_id, account_name, transaction_type,
        amount, balance_after, reference_id, note
      ) VALUES (
        p_business_id, v_acc_id, v_acc_name, 'supplier_payment',
        -p_amount, COALESCE(v_acc_bal, 0) - p_amount, v_ref,
        'Due payment to ' || v_supp.name
      );
    END IF;
  END IF;

  v_prev_due := COALESCE(v_supp.current_due, 0);
  v_new_due := GREATEST(0, v_prev_due - p_amount);

  UPDATE public.suppliers
  SET current_due = v_new_due,
      total_paid = COALESCE(total_paid, 0) + p_amount,
      updated_at = NOW()
  WHERE id = p_supplier_id;

  INSERT INTO public.supplier_transactions (
    business_id, supplier_id, supplier_name, transaction_type,
    amount, balance_after, payment_method, reference_id, note
  ) VALUES (
    p_business_id, p_supplier_id, v_supp.name, 'due_payment',
    p_amount, v_new_due, p_payment_method, v_ref, COALESCE(p_note, 'Supplier due payment')
  );

  RETURN jsonb_build_object('previous_due', v_prev_due, 'new_due', v_new_due, 'reference_id', v_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_account_funds(
  p_business_id UUID,
  p_from_account_id UUID,
  p_to_account_id UUID,
  p_amount NUMERIC,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from RECORD;
  v_to RECORD;
  v_ref TEXT := 'TRF-' || TO_CHAR(NOW(), 'YYMMDDHH24MISS');
BEGIN
  IF p_amount <= 0 OR p_from_account_id = p_to_account_id THEN
    RAISE EXCEPTION 'Invalid transfer accounts or amount';
  END IF;

  SELECT * INTO v_from FROM public.accounts WHERE id = p_from_account_id AND business_id = p_business_id FOR UPDATE;
  SELECT * INTO v_to FROM public.accounts WHERE id = p_to_account_id AND business_id = p_business_id FOR UPDATE;

  IF NOT FOUND OR v_from.id IS NULL OR v_to.id IS NULL THEN
    RAISE EXCEPTION 'Source or destination account not found';
  END IF;

  IF COALESCE(v_from.balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance in %', v_from.name;
  END IF;

  UPDATE public.accounts SET balance = v_from.balance - p_amount, updated_at = NOW() WHERE id = p_from_account_id;
  UPDATE public.accounts SET balance = v_to.balance + p_amount, updated_at = NOW() WHERE id = p_to_account_id;

  INSERT INTO public.account_transactions (
    business_id, account_id, account_name, transaction_type, amount, balance_after, reference_id, note
  ) VALUES
    (p_business_id, p_from_account_id, v_from.name, 'transfer_out', -p_amount, v_from.balance - p_amount, v_ref, COALESCE(p_note, 'Transfer to ' || v_to.name)),
    (p_business_id, p_to_account_id, v_to.name, 'transfer_in', p_amount, v_to.balance + p_amount, v_ref, COALESCE(p_note, 'Transfer from ' || v_from.name));

  RETURN jsonb_build_object('success', TRUE, 'reference_id', v_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_expense_transaction(
  p_business_id UUID,
  p_branch_id UUID,
  p_account_id UUID,
  p_category TEXT,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_paid_to TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc_id UUID;
  v_acc RECORD;
  v_exp RECORD;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Expense amount must be greater than zero';
  END IF;

  v_acc_id := public.resolve_business_account(p_business_id, p_account_id, p_payment_method);
  IF v_acc_id IS NOT NULL THEN
    SELECT * INTO v_acc FROM public.accounts WHERE id = v_acc_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.accounts SET balance = COALESCE(v_acc.balance, 0) - p_amount, updated_at = NOW() WHERE id = v_acc_id;
    END IF;
  END IF;

  INSERT INTO public.expenses (
    business_id, branch_id, account_id, category, amount, payment_method, paid_to, note, date
  ) VALUES (
    p_business_id, p_branch_id, v_acc_id, p_category, p_amount, p_payment_method, p_paid_to, p_note, NOW()
  )
  RETURNING * INTO v_exp;

  IF v_acc.id IS NOT NULL THEN
    INSERT INTO public.account_transactions (
      business_id, account_id, account_name, transaction_type, amount, balance_after, reference_id, note
    ) VALUES (
      p_business_id, v_acc.id, v_acc.name, 'expense', -p_amount, COALESCE(v_acc.balance, 0) - p_amount, v_exp.id::TEXT, 'Expense: ' || p_category
    );
  END IF;

  RETURN to_jsonb(v_exp);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_expense_transaction(
  p_business_id UUID,
  p_expense_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp RECORD;
  v_acc RECORD;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_module_permission(p_business_id, 'expense_management', 'delete') THEN
    RAISE EXCEPTION 'Permission denied: missing Expense Management delete permission';
  END IF;

  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF v_exp.account_id IS NOT NULL THEN
    SELECT * INTO v_acc FROM public.accounts WHERE id = v_exp.account_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.accounts SET balance = COALESCE(v_acc.balance, 0) + v_exp.amount, updated_at = NOW() WHERE id = v_acc.id;
    END IF;
  END IF;

  DELETE FROM public.expenses WHERE id = p_expense_id AND business_id = p_business_id;
  RETURN jsonb_build_object('success', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_seller_profile(
  p_business_id UUID,
  p_seller_id UUID,
  p_email TEXT,
  p_full_name TEXT,
  p_username TEXT,
  p_mobile TEXT,
  p_branch_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT 'active'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, username, mobile, updated_at)
  VALUES (p_seller_id, p_email, p_full_name, p_username, p_mobile, NOW())
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    username = EXCLUDED.username,
    mobile = EXCLUDED.mobile,
    updated_at = NOW();

  INSERT INTO public.business_users (business_id, user_id, branch_id, role, status, updated_at)
  VALUES (p_business_id, p_seller_id, p_branch_id, 'seller', COALESCE(p_status, 'active'), NOW())
  ON CONFLICT (business_id, user_id) DO UPDATE SET
    branch_id = EXCLUDED.branch_id,
    role = 'seller',
    status = COALESCE(p_status, 'active'),
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_offer_usage(p_offer_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.combo_offers
  SET usage_count = COALESCE(usage_count, 0) + 1,
      status = CASE
        WHEN max_usage_limit IS NOT NULL AND (COALESCE(usage_count, 0) + 1) >= max_usage_limit THEN 'expired'
        ELSE status
      END,
      updated_at = NOW()
  WHERE id = p_offer_id;
END;
$$;

-- ============================================================================
-- 5. COMPREHENSIVE ROW LEVEL SECURITY (RLS) POLICIES FOR ALL TABLES
-- ============================================================================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_offer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_offer_usage ENABLE ROW LEVEL SECURITY;

-- user_profiles
DROP POLICY IF EXISTS "user_profiles_select" ON public.user_profiles;
CREATE POLICY "user_profiles_select" ON public.user_profiles
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "user_profiles_upsert_own" ON public.user_profiles;
CREATE POLICY "user_profiles_upsert_own" ON public.user_profiles
  FOR ALL TO authenticated
  USING (id = auth.uid() OR EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.user_id = auth.uid() AND public.is_business_owner_or_admin(bu.business_id)))
  WITH CHECK (id = auth.uid() OR EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.user_id = auth.uid() AND public.is_business_owner_or_admin(bu.business_id)));

-- businesses (allow any authenticated user to create their initial business, active members can read)
DROP POLICY IF EXISTS "businesses_select" ON public.businesses;
CREATE POLICY "businesses_select" ON public.businesses
  FOR SELECT TO authenticated
  USING (public.is_active_staff_member(id));

DROP POLICY IF EXISTS "businesses_insert" ON public.businesses;
CREATE POLICY "businesses_insert" ON public.businesses
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- business_users
DROP POLICY IF EXISTS "business_users_select" ON public.business_users;
CREATE POLICY "business_users_select" ON public.business_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_active_staff_member(business_id));

DROP POLICY IF EXISTS "business_users_insert_self_or_admin" ON public.business_users;
CREATE POLICY "business_users_insert_self_or_admin" ON public.business_users
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_business_owner_or_admin(business_id));

DROP POLICY IF EXISTS "business_users_update_admin" ON public.business_users;
CREATE POLICY "business_users_update_admin" ON public.business_users
  FOR UPDATE TO authenticated
  USING (public.is_business_owner_or_admin(business_id))
  WITH CHECK (public.is_business_owner_or_admin(business_id));

-- branches (allow creator during setup when business has no branches yet, or active admin)
DROP POLICY IF EXISTS "branches_select" ON public.branches;
CREATE POLICY "branches_select" ON public.branches
  FOR SELECT TO authenticated
  USING (public.is_active_staff_member(business_id));

DROP POLICY IF EXISTS "branches_manage" ON public.branches;
CREATE POLICY "branches_manage" ON public.branches
  FOR ALL TO authenticated
  USING (public.is_business_owner_or_admin(business_id))
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.business_id = branches.business_id)
  );

-- Standard business-scoped operational tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories',
    'products',
    'product_variants',
    'customers',
    'customer_transactions',
    'suppliers',
    'supplier_transactions',
    'accounts',
    'account_transactions',
    'expenses',
    'sales',
    'sale_items',
    'sale_payments',
    'sale_returns',
    'purchases',
    'purchase_items',
    'stock_movements',
    'stock_transfers',
    'audit_logs',
    'combo_offers',
    'combo_offer_items',
    'combo_offer_usage'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_biz_select" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "%s_biz_select" ON public.%I FOR SELECT TO authenticated USING (public.is_active_staff_member(business_id));', t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_biz_insert" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "%s_biz_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_staff_member(business_id));', t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_biz_update" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "%s_biz_update" ON public.%I FOR UPDATE TO authenticated USING (public.is_active_staff_member(business_id)) WITH CHECK (public.is_active_staff_member(business_id));', t, t);

    IF t NOT IN ('sales', 'purchases', 'expenses', 'accounts') THEN
      EXECUTE format('DROP POLICY IF EXISTS "%s_biz_delete" ON public.%I;', t, t);
      EXECUTE format('CREATE POLICY "%s_biz_delete" ON public.%I FOR DELETE TO authenticated USING (public.is_active_staff_member(business_id));', t, t);
    END IF;
  END LOOP;
END $$;

-- Accounts insert also allowed during initial business setup before membership row exists
DROP POLICY IF EXISTS "accounts_biz_insert" ON public.accounts;
CREATE POLICY "accounts_biz_insert" ON public.accounts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_staff_member(business_id)
    OR public.is_business_owner_or_admin(business_id)
  );
