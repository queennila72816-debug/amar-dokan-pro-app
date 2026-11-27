-- ============================================================================
-- PROTIVA / AMAR DOKAN PRO
-- Additive Migration: Installment Sales Management & Optional Customer KYC
-- Safe for existing live databases: additive & idempotent only.
-- ============================================================================

-- 1. Optional private KYC fields on public.customers (strictly protected by business RLS)
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS customer_code TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS nid_number TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS nid_front_url TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS nid_back_url TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS kyc_consent BOOLEAN DEFAULT FALSE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS kyc_consent_at TIMESTAMPTZ;

-- 2. Installment Agreements table
CREATE TABLE IF NOT EXISTS public.installment_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  agreement_code TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  customer_code TEXT,
  customer_name TEXT NOT NULL,
  customer_mobile TEXT NOT NULL,
  customer_address TEXT,
  customer_photo_url TEXT,
  customer_nid_number TEXT,
  has_identity_documents BOOLEAN DEFAULT FALSE,
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  invoice_number TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_purchase_amount NUMERIC(14, 2) NOT NULL CHECK (total_purchase_amount >= 0),
  down_payment NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (down_payment >= 0),
  installment_balance NUMERIC(14, 2) NOT NULL CHECK (installment_balance >= 0),
  duration_months INTEGER NOT NULL CHECK (duration_months BETWEEN 1 AND 6),
  monthly_installment NUMERIC(14, 2) NOT NULL CHECK (monthly_installment >= 0),
  first_due_date DATE NOT NULL,
  agreement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  installments_paid NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (installments_paid >= 0),
  total_paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_paid_amount >= 0),
  remaining_due NUMERIC(14, 2) NOT NULL CHECK (remaining_due >= 0),
  last_payment_date DATE,
  next_due_date DATE,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid')),
  schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, agreement_code)
);

CREATE INDEX IF NOT EXISTS idx_installment_agreements_business
  ON public.installment_agreements (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_installment_agreements_customer
  ON public.installment_agreements (business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_installment_agreements_sale
  ON public.installment_agreements (business_id, sale_id);

-- 3. Installment Payments / Collections ledger (supports immutable audit + reversals)
CREATE TABLE IF NOT EXISTS public.installment_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  agreement_id UUID NOT NULL REFERENCES public.installment_agreements(id) ON DELETE CASCADE,
  agreement_code TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  account_name TEXT,
  receipt_number TEXT NOT NULL,
  collected_by TEXT NOT NULL,
  remarks TEXT,
  client_tx_id TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  reversed_at TIMESTAMPTZ,
  reversed_by TEXT,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, client_tx_id)
);

CREATE INDEX IF NOT EXISTS idx_installment_payments_agreement
  ON public.installment_payments (business_id, agreement_id, created_at DESC);

-- 4. Enable Row Level Security (Strictly isolated to authenticated business members)
ALTER TABLE public.installment_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business_members_select_installment_agreements" ON public.installment_agreements;
CREATE POLICY "business_members_select_installment_agreements"
  ON public.installment_agreements FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS "business_members_insert_installment_agreements" ON public.installment_agreements;
CREATE POLICY "business_members_insert_installment_agreements"
  ON public.installment_agreements FOR INSERT TO authenticated
  WITH CHECK (public.is_business_member(business_id));

DROP POLICY IF EXISTS "business_members_update_installment_agreements" ON public.installment_agreements;
CREATE POLICY "business_members_update_installment_agreements"
  ON public.installment_agreements FOR UPDATE TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

DROP POLICY IF EXISTS "business_members_select_installment_payments" ON public.installment_payments;
CREATE POLICY "business_members_select_installment_payments"
  ON public.installment_payments FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS "business_members_insert_installment_payments" ON public.installment_payments;
CREATE POLICY "business_members_insert_installment_payments"
  ON public.installment_payments FOR INSERT TO authenticated
  WITH CHECK (public.is_business_member(business_id));

DROP POLICY IF EXISTS "business_members_update_installment_payments" ON public.installment_payments;
CREATE POLICY "business_members_update_installment_payments"
  ON public.installment_payments FOR UPDATE TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- 5. Atomic Payment Collection RPC (never double-counts Sales/Profit; updates Customer Due & Account Balance)
CREATE OR REPLACE FUNCTION public.collect_installment_payment(
  p_business_id UUID,
  p_agreement_id UUID,
  p_payment_date DATE,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_account_id UUID,
  p_receipt_number TEXT,
  p_collected_by TEXT,
  p_remarks TEXT DEFAULT NULL,
  p_client_tx_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agreement public.installment_agreements%ROWTYPE;
  v_existing public.installment_payments%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_payment_id UUID;
  v_new_installments_paid NUMERIC(14, 2);
  v_new_remaining_due NUMERIC(14, 2);
  v_new_total_paid NUMERIC(14, 2);
  v_new_cust_due NUMERIC(14, 2);
  v_new_acc_balance NUMERIC(14, 2);
  v_status TEXT;
BEGIN
  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized business access';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  -- Idempotency guard
  IF p_client_tx_id IS NOT NULL AND LENGTH(TRIM(p_client_tx_id)) > 0 THEN
    SELECT * INTO v_existing
    FROM public.installment_payments
    WHERE business_id = p_business_id AND client_tx_id = p_client_tx_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('payment_id', v_existing.id, 'idempotent_hit', true);
    END IF;
  END IF;

  SELECT * INTO v_agreement
  FROM public.installment_agreements
  WHERE id = p_agreement_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Installment agreement not found';
  END IF;

  IF p_amount > v_agreement.remaining_due + 0.01 THEN
    RAISE EXCEPTION 'Payment amount exceeds remaining installment due';
  END IF;

  SELECT * INTO v_customer
  FROM public.customers
  WHERE id = v_agreement.customer_id AND business_id = p_business_id
  FOR UPDATE;

  SELECT * INTO v_account
  FROM public.accounts
  WHERE id = p_account_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit account not found';
  END IF;

  INSERT INTO public.installment_payments (
    business_id, agreement_id, agreement_code, customer_id, customer_name,
    payment_date, amount, payment_method, account_id, account_name,
    receipt_number, collected_by, remarks, client_tx_id, status
  ) VALUES (
    p_business_id, v_agreement.id, v_agreement.agreement_code, v_agreement.customer_id, v_agreement.customer_name,
    COALESCE(p_payment_date, CURRENT_DATE), p_amount, p_payment_method, v_account.id, v_account.name,
    p_receipt_number, p_collected_by, p_remarks, p_client_tx_id, 'posted'
  )
  RETURNING id INTO v_payment_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_new_installments_paid
  FROM public.installment_payments
  WHERE agreement_id = v_agreement.id AND business_id = p_business_id AND status = 'posted';

  v_new_remaining_due := GREATEST(0, ROUND((v_agreement.installment_balance - v_new_installments_paid)::numeric, 2));
  v_new_total_paid := ROUND((v_agreement.down_payment + v_new_installments_paid)::numeric, 2);
  v_status := CASE
    WHEN v_new_remaining_due <= 0.001 THEN 'paid'
    WHEN v_new_total_paid > 0.001 THEN 'partial'
    ELSE 'unpaid'
  END;

  UPDATE public.installment_agreements
  SET
    installments_paid = v_new_installments_paid,
    total_paid_amount = v_new_total_paid,
    remaining_due = v_new_remaining_due,
    last_payment_date = GREATEST(COALESCE(last_payment_date, p_payment_date), p_payment_date),
    status = v_status,
    updated_at = NOW()
  WHERE id = v_agreement.id;

  -- Update customer receivable & ledger
  v_new_cust_due := GREATEST(0, COALESCE(v_customer.current_due, 0) - p_amount);
  UPDATE public.customers
  SET
    current_due = v_new_cust_due,
    total_paid = COALESCE(total_paid, 0) + p_amount,
    updated_at = NOW()
  WHERE id = v_customer.id;

  INSERT INTO public.customer_transactions (
    business_id, customer_id, customer_name, transaction_type, amount,
    balance_after, payment_method, reference_id, note
  ) VALUES (
    p_business_id, v_customer.id, v_customer.name, 'due_collection', p_amount,
    v_new_cust_due, p_payment_method, p_receipt_number,
    CONCAT('Installment payment (', v_agreement.agreement_code, ')', CASE WHEN p_remarks IS NOT NULL AND LENGTH(p_remarks) > 0 THEN CONCAT(': ', p_remarks) ELSE '' END)
  );

  -- Update deposit account & ledger (receivable conversion only, zero sales revenue inflation)
  v_new_acc_balance := COALESCE(v_account.balance, 0) + p_amount;
  UPDATE public.accounts
  SET balance = v_new_acc_balance, updated_at = NOW()
  WHERE id = v_account.id;

  INSERT INTO public.account_transactions (
    business_id, account_id, account_name, transaction_type, amount,
    balance_after, reference_id, note
  ) VALUES (
    p_business_id, v_account.id, v_account.name, 'customer_payment', p_amount,
    v_new_acc_balance, p_receipt_number,
    CONCAT('Installment collected from ', v_customer.name, ' (', v_agreement.agreement_code, ')')
  );

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'idempotent_hit', false,
    'remaining_due', v_new_remaining_due
  );
END;
$$;

-- 6. Atomic Reversal RPC (marks posted payment as reversed, never deletes history)
CREATE OR REPLACE FUNCTION public.reverse_installment_payment(
  p_business_id UUID,
  p_payment_id UUID,
  p_reversed_by TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.installment_payments%ROWTYPE;
  v_agreement public.installment_agreements%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_new_installments_paid NUMERIC(14, 2);
  v_new_remaining_due NUMERIC(14, 2);
  v_new_total_paid NUMERIC(14, 2);
  v_new_cust_due NUMERIC(14, 2);
  v_new_acc_balance NUMERIC(14, 2);
  v_last_date DATE;
  v_status TEXT;
BEGIN
  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized business access';
  END IF;

  SELECT * INTO v_payment
  FROM public.installment_payments
  WHERE id = p_payment_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Installment payment record not found';
  END IF;

  IF v_payment.status = 'reversed' THEN
    RETURN jsonb_build_object('already_reversed', true);
  END IF;

  UPDATE public.installment_payments
  SET
    status = 'reversed',
    reversed_at = NOW(),
    reversed_by = COALESCE(p_reversed_by, 'Admin'),
    reversal_reason = COALESCE(NULLIF(TRIM(p_reason), ''), 'Payment correction/reversal')
  WHERE id = v_payment.id;

  SELECT * INTO v_agreement
  FROM public.installment_agreements
  WHERE id = v_payment.agreement_id AND business_id = p_business_id
  FOR UPDATE;

  SELECT COALESCE(SUM(amount), 0), MAX(payment_date)
  INTO v_new_installments_paid, v_last_date
  FROM public.installment_payments
  WHERE agreement_id = v_agreement.id AND business_id = p_business_id AND status = 'posted';

  v_new_remaining_due := GREATEST(0, ROUND((v_agreement.installment_balance - v_new_installments_paid)::numeric, 2));
  v_new_total_paid := ROUND((v_agreement.down_payment + v_new_installments_paid)::numeric, 2);
  v_status := CASE
    WHEN v_new_remaining_due <= 0.001 THEN 'paid'
    WHEN v_new_total_paid > 0.001 THEN 'partial'
    ELSE 'unpaid'
  END;

  UPDATE public.installment_agreements
  SET
    installments_paid = v_new_installments_paid,
    total_paid_amount = v_new_total_paid,
    remaining_due = v_new_remaining_due,
    last_payment_date = v_last_date,
    status = v_status,
    updated_at = NOW()
  WHERE id = v_agreement.id;

  -- Restore customer due balance via reversing ledger entry
  SELECT * INTO v_customer
  FROM public.customers
  WHERE id = v_payment.customer_id AND business_id = p_business_id
  FOR UPDATE;

  IF FOUND THEN
    v_new_cust_due := COALESCE(v_customer.current_due, 0) + v_payment.amount;
    UPDATE public.customers
    SET
      current_due = v_new_cust_due,
      total_paid = GREATEST(0, COALESCE(total_paid, 0) - v_payment.amount),
      updated_at = NOW()
    WHERE id = v_customer.id;

    INSERT INTO public.customer_transactions (
      business_id, customer_id, customer_name, transaction_type, amount,
      balance_after, payment_method, reference_id, note
    ) VALUES (
      p_business_id, v_customer.id, v_customer.name, 'sale_due', v_payment.amount,
      v_new_cust_due, v_payment.payment_method, v_payment.receipt_number,
      CONCAT('REVERSAL of ', v_payment.receipt_number, ' (', v_agreement.agreement_code, '): ', COALESCE(p_reason, 'Correction'))
    );
  END IF;

  -- Restore account balance via reversing adjustment entry
  IF v_payment.account_id IS NOT NULL THEN
    SELECT * INTO v_account
    FROM public.accounts
    WHERE id = v_payment.account_id AND business_id = p_business_id
    FOR UPDATE;

    IF FOUND THEN
      v_new_acc_balance := COALESCE(v_account.balance, 0) - v_payment.amount;
      UPDATE public.accounts
      SET balance = v_new_acc_balance, updated_at = NOW()
      WHERE id = v_account.id;

      INSERT INTO public.account_transactions (
        business_id, account_id, account_name, transaction_type, amount,
        balance_after, reference_id, note
      ) VALUES (
        p_business_id, v_account.id, v_account.name, 'adjustment', -v_payment.amount,
        v_new_acc_balance, v_payment.receipt_number,
        CONCAT('REVERSAL of installment receipt ', v_payment.receipt_number, ' (', v_agreement.agreement_code, ')')
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'already_reversed', false,
    'remaining_due', v_new_remaining_due
  );
END;
$$;
