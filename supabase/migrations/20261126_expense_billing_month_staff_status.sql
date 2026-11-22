-- =============================================================================
-- Expense Management Upgrade: Billing/Expense Month, Payment Date, Staff & Status
-- =============================================================================
-- Safe, non-destructive, idempotent migration:
--   1. Adds expense_month (YYYY-MM), payment_date (DATE), employee_id (UUID FK),
--      staff_name (TEXT), payment_status ('paid' | 'unpaid'), and updated_at to
--      public.expenses without altering or breaking any existing expense rows.
--   2. Updates record_expense_transaction with backward-compatible optional
--      parameters so paid expenses deduct balances and unpaid bills do not.
--   3. Adds atomic update_expense_transaction RPC to edit expenses or mark
--      unpaid bills as paid with full account balance reconciliation.
--   4. Hardens delete_expense_transaction so unpaid expenses never credit back
--      an account balance upon deletion.
--   5. Preserves strict multi-tenant business isolation and RBAC enforcement.
-- =============================================================================

-- 1. Extend public.expenses non-destructively
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS expense_month TEXT,
  ADD COLUMN IF NOT EXISTS payment_date DATE,
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staff_name TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_expense_month_format_chk'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_expense_month_format_chk
      CHECK (expense_month IS NULL OR expense_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_payment_status_chk'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_payment_status_chk
      CHECK (payment_status IN ('paid', 'unpaid'));
  END IF;
END $$;

-- Helpful indexes for month-wise reports, filters, and staff salary lookups
CREATE INDEX IF NOT EXISTS idx_expenses_business_month
  ON public.expenses(business_id, expense_month DESC, date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_business_payment_date
  ON public.expenses(business_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_business_status
  ON public.expenses(business_id, payment_status);

CREATE INDEX IF NOT EXISTS idx_expenses_business_employee_month
  ON public.expenses(business_id, employee_id, expense_month);

-- Ensure update RLS policy requires expense_management edit permission (or owner/admin)
DROP POLICY IF EXISTS "expenses_biz_update" ON public.expenses;
CREATE POLICY "expenses_biz_update" ON public.expenses
  FOR UPDATE TO authenticated
  USING (
    public.has_module_permission(business_id, 'expense_management', 'edit')
    OR public.is_business_owner_or_admin(business_id)
  )
  WITH CHECK (
    public.has_module_permission(business_id, 'expense_management', 'edit')
    OR public.is_business_owner_or_admin(business_id)
  );

-- 2. Replace record_expense_transaction cleanly (drop legacy 8-arg overload first)
DROP FUNCTION IF EXISTS public.record_expense_transaction(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.record_expense_transaction(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, DATE, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.record_expense_transaction(
  p_business_id UUID,
  p_branch_id UUID,
  p_account_id UUID,
  p_category TEXT,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_paid_to TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_expense_month TEXT DEFAULT NULL,
  p_payment_date DATE DEFAULT NULL,
  p_employee_id UUID DEFAULT NULL,
  p_staff_name TEXT DEFAULT NULL,
  p_payment_status TEXT DEFAULT 'paid'
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
  v_emp RECORD;
  v_status TEXT;
  v_payment_date DATE;
  v_expense_month TEXT;
  v_effective_date TIMESTAMPTZ;
  v_staff_name TEXT;
  v_paid_to TEXT;
BEGIN
  PERFORM public.assert_caller_business_permission(p_business_id, 'expense_management', 'create', TRUE);

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Expense amount must be greater than zero';
  END IF;

  v_status := CASE
    WHEN LOWER(COALESCE(TRIM(p_payment_status), 'paid')) = 'unpaid' THEN 'unpaid'
    ELSE 'paid'
  END;

  v_payment_date := CASE
    WHEN v_status = 'paid' THEN COALESCE(p_payment_date, CURRENT_DATE)
    ELSE p_payment_date
  END;

  v_expense_month := NULLIF(TRIM(COALESCE(p_expense_month, '')), '');
  IF v_expense_month IS NULL THEN
    v_expense_month := TO_CHAR(COALESCE(v_payment_date, CURRENT_DATE), 'YYYY-MM');
  ELSIF v_expense_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Invalid expense_month format "%". Expected YYYY-MM.', v_expense_month;
  END IF;

  IF p_payment_date IS NOT NULL THEN
    v_effective_date := (p_payment_date::TIMESTAMP + TIME '12:00:00') AT TIME ZONE 'UTC';
  ELSE
    v_effective_date := NOW();
  END IF;

  -- Tenant-safe staff lookup when employee_id is supplied
  v_staff_name := NULLIF(TRIM(COALESCE(p_staff_name, '')), '');
  v_paid_to := NULLIF(TRIM(COALESCE(p_paid_to, '')), '');

  IF p_employee_id IS NOT NULL THEN
    SELECT id, name, position
      INTO v_emp
    FROM public.employees
    WHERE id = p_employee_id
      AND business_id = p_business_id
    LIMIT 1;

    IF v_emp.id IS NOT NULL THEN
      v_staff_name := COALESCE(v_staff_name, v_emp.name);
      v_paid_to := COALESCE(
        v_paid_to,
        CASE
          WHEN NULLIF(TRIM(COALESCE(v_emp.position, '')), '') IS NOT NULL
            THEN v_emp.name || ' (' || v_emp.position || ')'
          ELSE v_emp.name
        END
      );
    END IF;
  END IF;

  -- Only deduct account balance and write account ledger entry when payment_status = 'paid'
  IF v_status = 'paid' THEN
    v_acc_id := public.resolve_business_account(p_business_id, p_account_id, p_payment_method);
    IF v_acc_id IS NOT NULL THEN
      SELECT * INTO v_acc FROM public.accounts WHERE id = v_acc_id AND business_id = p_business_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.accounts
           SET balance = COALESCE(v_acc.balance, 0) - p_amount,
               updated_at = NOW()
         WHERE id = v_acc_id;
      END IF;
    END IF;
  ELSE
    -- Store preferred account reference if valid for this business, without deducting balance
    IF p_account_id IS NOT NULL THEN
      SELECT id INTO v_acc_id
      FROM public.accounts
      WHERE id = p_account_id
        AND business_id = p_business_id
      LIMIT 1;
    ELSE
      v_acc_id := NULL;
    END IF;
  END IF;

  INSERT INTO public.expenses (
    business_id,
    branch_id,
    account_id,
    category,
    amount,
    payment_method,
    paid_to,
    note,
    date,
    expense_month,
    payment_date,
    employee_id,
    staff_name,
    payment_status,
    updated_at
  ) VALUES (
    p_business_id,
    p_branch_id,
    v_acc_id,
    TRIM(p_category),
    p_amount,
    COALESCE(NULLIF(TRIM(p_payment_method), ''), 'cash'),
    v_paid_to,
    NULLIF(TRIM(COALESCE(p_note, '')), ''),
    v_effective_date,
    v_expense_month,
    v_payment_date,
    CASE WHEN v_emp.id IS NOT NULL THEN v_emp.id ELSE NULL END,
    v_staff_name,
    v_status,
    NOW()
  )
  RETURNING * INTO v_exp;

  IF v_status = 'paid' AND v_acc.id IS NOT NULL THEN
    INSERT INTO public.account_transactions (
      business_id,
      account_id,
      account_name,
      transaction_type,
      amount,
      balance_after,
      reference_id,
      note
    ) VALUES (
      p_business_id,
      v_acc.id,
      v_acc.name,
      'expense',
      -p_amount,
      COALESCE(v_acc.balance, 0) - p_amount,
      v_exp.id::TEXT,
      'Expense: ' || TRIM(p_category) || ' (' || v_expense_month || ')'
    );
  END IF;

  RETURN to_jsonb(v_exp);
END;
$$;

-- 3. Atomic update_expense_transaction (edit expense details or mark unpaid <-> paid)
DROP FUNCTION IF EXISTS public.update_expense_transaction(UUID, UUID, TEXT, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, DATE, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.update_expense_transaction(
  p_business_id UUID,
  p_expense_id UUID,
  p_category TEXT DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_account_id UUID DEFAULT NULL,
  p_paid_to TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_expense_month TEXT DEFAULT NULL,
  p_payment_date DATE DEFAULT NULL,
  p_employee_id UUID DEFAULT NULL,
  p_staff_name TEXT DEFAULT NULL,
  p_payment_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old RECORD;
  v_old_status TEXT;
  v_new_status TEXT;
  v_new_amount NUMERIC;
  v_new_category TEXT;
  v_new_method TEXT;
  v_new_acc_id UUID;
  v_old_acc RECORD;
  v_new_acc RECORD;
  v_emp RECORD;
  v_new_emp_id UUID;
  v_new_staff_name TEXT;
  v_new_paid_to TEXT;
  v_new_month TEXT;
  v_new_payment_date DATE;
  v_new_date TIMESTAMPTZ;
  v_updated RECORD;
BEGIN
  PERFORM public.assert_caller_business_permission(p_business_id, 'expense_management', 'edit', TRUE);

  SELECT * INTO v_old
  FROM public.expenses
  WHERE id = p_expense_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense record not found';
  END IF;

  v_old_status := CASE WHEN LOWER(COALESCE(v_old.payment_status, 'paid')) = 'unpaid' THEN 'unpaid' ELSE 'paid' END;
  v_new_status := CASE
    WHEN p_payment_status IS NULL THEN v_old_status
    WHEN LOWER(TRIM(p_payment_status)) = 'unpaid' THEN 'unpaid'
    ELSE 'paid'
  END;

  v_new_amount := COALESCE(p_amount, v_old.amount);
  IF v_new_amount <= 0 THEN
    RAISE EXCEPTION 'Expense amount must be greater than zero';
  END IF;

  v_new_category := COALESCE(NULLIF(TRIM(COALESCE(p_category, '')), ''), v_old.category);
  v_new_method := COALESCE(NULLIF(TRIM(COALESCE(p_payment_method, '')), ''), v_old.payment_method, 'cash');

  v_new_month := NULLIF(TRIM(COALESCE(p_expense_month, '')), '');
  IF v_new_month IS NULL THEN
    v_new_month := COALESCE(v_old.expense_month, TO_CHAR(COALESCE(p_payment_date, v_old.payment_date, v_old.date::DATE, CURRENT_DATE), 'YYYY-MM'));
  ELSIF v_new_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Invalid expense_month format "%". Expected YYYY-MM.', v_new_month;
  END IF;

  IF v_new_status = 'paid' THEN
    v_new_payment_date := COALESCE(p_payment_date, v_old.payment_date, CURRENT_DATE);
  ELSE
    v_new_payment_date := p_payment_date;
  END IF;

  IF p_payment_date IS NOT NULL THEN
    v_new_date := (p_payment_date::TIMESTAMP + TIME '12:00:00') AT TIME ZONE 'UTC';
  ELSIF v_old_status = 'unpaid' AND v_new_status = 'paid' AND v_new_payment_date IS NOT NULL THEN
    v_new_date := (v_new_payment_date::TIMESTAMP + TIME '12:00:00') AT TIME ZONE 'UTC';
  ELSE
    v_new_date := v_old.date;
  END IF;

  -- Resolve employee/staff safely within same business
  IF p_employee_id IS NOT NULL THEN
    SELECT id, name, position INTO v_emp
    FROM public.employees
    WHERE id = p_employee_id AND business_id = p_business_id
    LIMIT 1;
    v_new_emp_id := v_emp.id;
  ELSE
    v_new_emp_id := NULL;
  END IF;

  v_new_staff_name := COALESCE(
    NULLIF(TRIM(COALESCE(p_staff_name, '')), ''),
    v_emp.name,
    CASE WHEN p_staff_name IS NULL THEN v_old.staff_name ELSE NULL END
  );
  v_new_paid_to := COALESCE(
    NULLIF(TRIM(COALESCE(p_paid_to, '')), ''),
    CASE WHEN p_paid_to IS NULL THEN v_old.paid_to ELSE NULL END
  );

  -- Reconcile previous paid balance if previously paid
  IF v_old_status = 'paid' AND v_old.account_id IS NOT NULL THEN
    SELECT * INTO v_old_acc
    FROM public.accounts
    WHERE id = v_old.account_id AND business_id = p_business_id
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.accounts
         SET balance = COALESCE(v_old_acc.balance, 0) + v_old.amount,
             updated_at = NOW()
       WHERE id = v_old_acc.id;
    END IF;
  END IF;

  -- Deduct new paid balance if newly paid
  IF v_new_status = 'paid' THEN
    v_new_acc_id := public.resolve_business_account(p_business_id, COALESCE(p_account_id, v_old.account_id), v_new_method);
    IF v_new_acc_id IS NOT NULL THEN
      SELECT * INTO v_new_acc
      FROM public.accounts
      WHERE id = v_new_acc_id AND business_id = p_business_id
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.accounts
           SET balance = COALESCE(v_new_acc.balance, 0) - v_new_amount,
               updated_at = NOW()
         WHERE id = v_new_acc.id;
      END IF;
    END IF;
  ELSE
    v_new_acc_id := COALESCE(p_account_id, v_old.account_id);
  END IF;

  UPDATE public.expenses
     SET category = v_new_category,
         amount = v_new_amount,
         payment_method = v_new_method,
         account_id = v_new_acc_id,
         paid_to = v_new_paid_to,
         note = CASE WHEN p_note IS NULL THEN v_old.note ELSE NULLIF(TRIM(p_note), '') END,
         expense_month = v_new_month,
         payment_date = v_new_payment_date,
         employee_id = v_new_emp_id,
         staff_name = v_new_staff_name,
         payment_status = v_new_status,
         date = v_new_date,
         updated_at = NOW()
   WHERE id = p_expense_id
     AND business_id = p_business_id
  RETURNING * INTO v_updated;

  -- Record ledger audit entry when status transitions or paid amount/account changes
  IF v_old_status = 'unpaid' AND v_new_status = 'paid' AND v_new_acc.id IS NOT NULL THEN
    INSERT INTO public.account_transactions (
      business_id, account_id, account_name, transaction_type, amount, balance_after, reference_id, note
    ) VALUES (
      p_business_id,
      v_new_acc.id,
      v_new_acc.name,
      'expense',
      -v_new_amount,
      COALESCE(v_new_acc.balance, 0) - v_new_amount,
      v_updated.id::TEXT,
      'Expense Paid: ' || v_new_category || ' (' || v_new_month || ')'
    );
  ELSIF v_old_status = 'paid' AND v_new_status = 'unpaid' AND v_old_acc.id IS NOT NULL THEN
    INSERT INTO public.account_transactions (
      business_id, account_id, account_name, transaction_type, amount, balance_after, reference_id, note
    ) VALUES (
      p_business_id,
      v_old_acc.id,
      v_old_acc.name,
      'refund',
      v_old.amount,
      COALESCE(v_old_acc.balance, 0) + v_old.amount,
      v_updated.id::TEXT,
      'Expense Marked Unpaid: ' || v_new_category || ' (' || v_new_month || ')'
    );
  ELSIF v_old_status = 'paid' AND v_new_status = 'paid' AND (
    v_old.amount IS DISTINCT FROM v_new_amount OR v_old.account_id IS DISTINCT FROM v_new_acc_id
  ) THEN
    IF v_old_acc.id IS NOT NULL AND v_old_acc.id IS DISTINCT FROM v_new_acc_id THEN
      INSERT INTO public.account_transactions (
        business_id, account_id, account_name, transaction_type, amount, balance_after, reference_id, note
      ) VALUES (
        p_business_id, v_old_acc.id, v_old_acc.name, 'refund', v_old.amount,
        COALESCE(v_old_acc.balance, 0) + v_old.amount, v_updated.id::TEXT,
        'Expense Account Changed: ' || v_new_category
      );
      IF v_new_acc.id IS NOT NULL THEN
        INSERT INTO public.account_transactions (
          business_id, account_id, account_name, transaction_type, amount, balance_after, reference_id, note
        ) VALUES (
          p_business_id, v_new_acc.id, v_new_acc.name, 'expense', -v_new_amount,
          COALESCE(v_new_acc.balance, 0) - v_new_amount, v_updated.id::TEXT,
          'Expense Updated: ' || v_new_category || ' (' || v_new_month || ')'
        );
      END IF;
    ELSIF v_new_acc.id IS NOT NULL AND (v_old.amount - v_new_amount) <> 0 THEN
      INSERT INTO public.account_transactions (
        business_id, account_id, account_name, transaction_type, amount, balance_after, reference_id, note
      ) VALUES (
        p_business_id,
        v_new_acc.id,
        v_new_acc.name,
        CASE WHEN (v_old.amount - v_new_amount) > 0 THEN 'refund' ELSE 'expense' END,
        v_old.amount - v_new_amount,
        COALESCE(v_new_acc.balance, 0) - v_new_amount,
        v_updated.id::TEXT,
        'Expense Amount Adjusted: ' || v_new_category || ' (' || v_new_month || ')'
      );
    END IF;
  END IF;

  RETURN to_jsonb(v_updated);
END;
$$;

-- 4. Update delete_expense_transaction so unpaid bills never refund cash balances
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
  v_status TEXT;
BEGIN
  PERFORM public.assert_caller_business_permission(p_business_id, 'expense_management', 'delete', TRUE);

  SELECT * INTO v_exp
  FROM public.expenses
  WHERE id = p_expense_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  v_status := CASE WHEN LOWER(COALESCE(v_exp.payment_status, 'paid')) = 'unpaid' THEN 'unpaid' ELSE 'paid' END;

  IF v_status = 'paid' AND v_exp.account_id IS NOT NULL THEN
    SELECT * INTO v_acc
    FROM public.accounts
    WHERE id = v_exp.account_id
      AND business_id = p_business_id
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.accounts
         SET balance = COALESCE(v_acc.balance, 0) + v_exp.amount,
             updated_at = NOW()
       WHERE id = v_acc.id;
    END IF;
  END IF;

  DELETE FROM public.expenses
  WHERE id = p_expense_id
    AND business_id = p_business_id;

  RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- 5. Restrict RPC execute permissions explicitly to authenticated + service_role
REVOKE ALL ON FUNCTION public.record_expense_transaction(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, DATE, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_expense_transaction(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, DATE, UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_expense_transaction(UUID, UUID, TEXT, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, DATE, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_expense_transaction(UUID, UUID, TEXT, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, DATE, UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_expense_transaction(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_expense_transaction(UUID, UUID) TO authenticated, service_role;

-- 6. Safely include expenses & accounts in Supabase Realtime publication for multi-user sync
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.accounts;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
