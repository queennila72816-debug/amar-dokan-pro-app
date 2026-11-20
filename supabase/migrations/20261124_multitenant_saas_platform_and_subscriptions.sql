-- ============================================================================
-- Amar Dokan Pro: Multi-Tenant SaaS Platform, Subscriptions, Security & Audit
-- Idempotent, Non-Destructive & Data-Safe Migration
--
-- Features:
-- 1. Strict separation between Platform Level Roles (platform_admins) and
--    Business Level Roles (business_users / employees / user_roles).
-- 2. Controlled bootstrap of initial Platform SUPER_ADMIN (queennila72816@gmail.com)
--    — never assignable via public signup.
-- 3. SaaS Tables:
--    - public.platform_admins
--    - public.subscription_plans (Free Trial, Basic, Standard, Premium, Enterprise)
--    - public.business_subscriptions (trialing, active, grace_period, expired, suspended)
--    - public.payments (billing transactions & verification workflow)
--    - public.support_tickets (business <-> platform support management)
--    - public.platform_audit_logs (immutable platform activity & security log)
--    - public.platform_settings (global SaaS defaults & payment gateway settings)
--    - public.mobile_otp_verifications (server-only hashed OTP store)
-- 4. Multi-Business Support for Single User Accounts:
--    - `get_my_business_memberships()` RPC
--    - `get_my_rbac_context(p_business_id)` business-scoped lookup
--    - Updated `complete_first_time_business_setup(..., p_create_new, p_plan_code, p_billing_cycle)`
-- 5. Hardens all existing 20261118 transactional SECURITY DEFINER RPCs with
--    strict caller auth, cross-tenant business_id & permission checks, and
--    business operational checks (never deletes expired/suspended tenant data).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Non-Destructive Enhancements to Existing Core Tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS mobile_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mobile_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_active_business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill existing businesses.status cleanly without overwriting existing values
UPDATE public.businesses
SET status = CASE WHEN COALESCE(is_active, TRUE) THEN 'active' ELSE 'suspended' END
WHERE status IS NULL OR BTRIM(status) = '';

-- Helper for normalized Business Level Role labels
CREATE OR REPLACE FUNCTION public.normalize_business_role_level(p_raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE LOWER(BTRIM(COALESCE(p_raw, '')))
    WHEN 'owner' THEN 'OWNER'
    WHEN 'super_admin' THEN 'OWNER'
    WHEN 'admin' THEN 'ADMIN'
    WHEN 'manager' THEN 'MANAGER'
    WHEN 'store_manager' THEN 'MANAGER'
    WHEN 'accountant' THEN 'ACCOUNTANT'
    WHEN 'salesman' THEN 'SALESMAN'
    WHEN 'seller' THEN 'SALESMAN'
    WHEN 'cashier' THEN 'SALESMAN'
    WHEN 'storekeeper' THEN 'CUSTOM_ROLE'
    WHEN 'inventory_manager' THEN 'CUSTOM_ROLE'
    ELSE 'CUSTOM_ROLE'
  END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Platform Level Administration & Settings Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT 'Platform Admin',
  role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'SUPPORT_ADMIN', 'BILLING_ADMIN', 'PLATFORM_VIEWER')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_user_id ON public.platform_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_admins_role ON public.platform_admins(role, is_active);

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. Subscription Plans, Tenant Subscriptions, Payments, Support & Audit
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  monthly_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  yearly_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (yearly_price >= 0),
  currency TEXT NOT NULL DEFAULT 'BDT',
  trial_days INTEGER NOT NULL DEFAULT 14 CHECK (trial_days >= 0),
  grace_period_days INTEGER NOT NULL DEFAULT 7 CHECK (grace_period_days >= 0),
  max_users INTEGER,
  max_branches INTEGER,
  max_products INTEGER,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_popular BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.business_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  plan_code TEXT NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'trial' CHECK (billing_cycle IN ('trial', 'monthly', 'yearly')),
  status TEXT NOT NULL DEFAULT 'trialing' CHECK (
    status IN ('trialing', 'active', 'grace_period', 'past_due', 'expired', 'suspended', 'cancelled')
  ),
  trial_starts_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL,
  grace_period_ends_at TIMESTAMPTZ,
  max_users INTEGER,
  max_branches INTEGER,
  max_products INTEGER,
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  last_payment_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_subscriptions_business_id ON public.business_subscriptions(business_id);
CREATE INDEX IF NOT EXISTS idx_business_subscriptions_status ON public.business_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_business_subscriptions_period_end ON public.business_subscriptions(current_period_end);

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.business_subscriptions(id) ON DELETE SET NULL,
  plan_id UUID REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'BDT',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('trial', 'monthly', 'yearly')),
  payment_method TEXT NOT NULL DEFAULT 'bkash',
  transaction_ref TEXT,
  sender_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected', 'refunded')),
  submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  rejection_reason TEXT,
  invoice_number TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_business_status ON public.payments(business_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT NOT NULL UNIQUE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by_email TEXT,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  description TEXT NOT NULL,
  admin_notes TEXT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_business_status ON public.support_tickets(business_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  details TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_created_at ON public.platform_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_business_id ON public.platform_audit_logs(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mobile_otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_otp_user_phone ON public.mobile_otp_verifications(user_id, phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_businesses_status_active ON public.businesses(status, is_active);
CREATE INDEX IF NOT EXISTS idx_businesses_created_by ON public.businesses(created_by);

-- ----------------------------------------------------------------------------
-- 4. Seed Default SaaS Plans & Platform Settings (Idempotent)
-- ----------------------------------------------------------------------------
INSERT INTO public.subscription_plans (
  code, name, description, monthly_price, yearly_price, currency,
  trial_days, grace_period_days, max_users, max_branches, max_products,
  features, is_active, is_popular, sort_order
) VALUES
  (
    'free_trial',
    'Free Trial',
    'Full 14-day trial for new retail & apparel shops to launch POS, inventory, and photo catalog.',
    0, 0, 'BDT', 14, 5, 3, 1, 250,
    '{"pos":true,"inventory":true,"reports":true,"multi_branch":false,"photo_catalog":true,"combo_offers":true,"api_access":false,"priority_support":false}'::jsonb,
    TRUE, FALSE, 1
  ),
  (
    'basic',
    'Basic',
    'Essential POS, billing, due ledger, and inventory control for single-outlet shops.',
    490, 4900, 'BDT', 14, 7, 3, 1, 1000,
    '{"pos":true,"inventory":true,"reports":true,"multi_branch":false,"photo_catalog":true,"combo_offers":false,"api_access":false,"priority_support":false}'::jsonb,
    TRUE, FALSE, 2
  ),
  (
    'standard',
    'Standard',
    'Multi-staff RBAC, Apparel Photo Catalog, Combo Offers & advanced profit analytics.',
    990, 9900, 'BDT', 14, 7, 10, 3, 5000,
    '{"pos":true,"inventory":true,"reports":true,"multi_branch":true,"photo_catalog":true,"combo_offers":true,"api_access":false,"priority_support":false}'::jsonb,
    TRUE, TRUE, 3
  ),
  (
    'premium',
    'Premium',
    'Multi-branch chains, stock transfers, smart pricing, and unlimited catalogs.',
    1990, 19900, 'BDT', 14, 10, 25, 10, 25000,
    '{"pos":true,"inventory":true,"reports":true,"multi_branch":true,"photo_catalog":true,"combo_offers":true,"api_access":true,"priority_support":true}'::jsonb,
    TRUE, FALSE, 4
  ),
  (
    'enterprise',
    'Enterprise',
    'Unlimited branches, unlimited staff roles, dedicated onboarding & SLA priority support.',
    3990, 39900, 'BDT', 30, 14, NULL, NULL, NULL,
    '{"pos":true,"inventory":true,"reports":true,"multi_branch":true,"photo_catalog":true,"combo_offers":true,"api_access":true,"priority_support":true}'::jsonb,
    TRUE, FALSE, 5
  )
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.platform_settings (key, value) VALUES
  (
    'general',
    '{
      "platformName": "Amar Dokan Pro",
      "supportEmail": "queennila72816@gmail.com",
      "supportPhone": "",
      "allowPublicRegistration": true,
      "requireMobileOtpVerification": true,
      "defaultTrialDays": 14,
      "defaultGracePeriodDays": 7,
      "maintenanceMode": false
    }'::jsonb
  ),
  (
    'billing_instructions',
    '{
      "currency": "BDT",
      "bkashMerchant": "Configure in Platform Settings",
      "nagadMerchant": "Configure in Platform Settings",
      "bankDetails": "Configure bank transfer details in Platform Settings",
      "autoApproveTrial": true
    }'::jsonb
  )
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. Controlled Initial Super Admin Bootstrap (queennila72816@gmail.com ONLY)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_admin_uid UUID;
  v_admin_email TEXT;
  v_admin_name TEXT;
BEGIN
  SELECT au.id, au.email, COALESCE(au.raw_user_meta_data->>'full_name', 'Platform Super Admin')
    INTO v_admin_uid, v_admin_email, v_admin_name
  FROM auth.users au
  WHERE LOWER(BTRIM(COALESCE(au.email, ''))) = 'queennila72816@gmail.com'
  ORDER BY au.created_at ASC
  LIMIT 1;

  IF v_admin_uid IS NOT NULL THEN
    INSERT INTO public.platform_admins (user_id, email, full_name, role, is_active, assigned_by)
    VALUES (v_admin_uid, v_admin_email, v_admin_name, 'SUPER_ADMIN', TRUE, v_admin_uid)
    ON CONFLICT (user_id) DO UPDATE SET
      role = 'SUPER_ADMIN',
      is_active = TRUE,
      updated_at = NOW();

    IF NOT EXISTS (
      SELECT 1 FROM public.platform_audit_logs
      WHERE action = 'PLATFORM_SUPER_ADMIN_BOOTSTRAPPED'
        AND target_id = v_admin_uid::TEXT
    ) THEN
      INSERT INTO public.platform_audit_logs (
        actor_user_id, actor_email, actor_role, action, target_type, target_id, details
      ) VALUES (
        v_admin_uid, v_admin_email, 'SUPER_ADMIN',
        'PLATFORM_SUPER_ADMIN_BOOTSTRAPPED', 'platform_admin', v_admin_uid::TEXT,
        'Initial Platform Super Admin bootstrapped for ' || v_admin_email
      );
    END IF;
  END IF;
END $$;

-- Backfill subscriptions for existing businesses cleanly (zero data loss)
DO $$
DECLARE
  v_trial_plan RECORD;
  v_enterprise_plan RECORD;
  v_biz RECORD;
  v_owner_email TEXT;
  v_chosen_plan RECORD;
  v_period_end TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_trial_plan FROM public.subscription_plans WHERE code = 'free_trial' LIMIT 1;
  SELECT * INTO v_enterprise_plan FROM public.subscription_plans WHERE code = 'enterprise' LIMIT 1;

  IF v_trial_plan.id IS NOT NULL THEN
    FOR v_biz IN
      SELECT b.id, b.created_by, b.email
      FROM public.businesses b
      WHERE NOT EXISTS (
        SELECT 1 FROM public.business_subscriptions bs WHERE bs.business_id = b.id
      )
    LOOP
      SELECT LOWER(COALESCE(au.email, ''))
        INTO v_owner_email
      FROM auth.users au
      WHERE au.id = v_biz.created_by
      LIMIT 1;

      IF v_owner_email = 'queennila72816@gmail.com' AND v_enterprise_plan.id IS NOT NULL THEN
        v_chosen_plan := v_enterprise_plan;
        v_period_end := NOW() + INTERVAL '365 days';
        INSERT INTO public.business_subscriptions (
          business_id, plan_id, plan_code, billing_cycle, status,
          current_period_start, current_period_end, max_users, max_branches, max_products, notes
        ) VALUES (
          v_biz.id, v_chosen_plan.id, v_chosen_plan.code, 'yearly', 'active',
          NOW(), v_period_end, v_chosen_plan.max_users, v_chosen_plan.max_branches, v_chosen_plan.max_products,
          'Founder platform owner workspace'
        )
        ON CONFLICT (business_id) DO NOTHING;
      ELSE
        v_chosen_plan := v_trial_plan;
        v_period_end := NOW() + make_interval(days => COALESCE(v_chosen_plan.trial_days, 14));
        INSERT INTO public.business_subscriptions (
          business_id, plan_id, plan_code, billing_cycle, status,
          trial_starts_at, trial_ends_at, current_period_start, current_period_end,
          grace_period_ends_at, max_users, max_branches, max_products, notes
        ) VALUES (
          v_biz.id, v_chosen_plan.id, v_chosen_plan.code, 'trial', 'trialing',
          NOW(), v_period_end, NOW(), v_period_end,
          v_period_end + make_interval(days => COALESCE(v_chosen_plan.grace_period_days, 5)),
          v_chosen_plan.max_users, v_chosen_plan.max_branches, v_chosen_plan.max_products,
          'Auto-enrolled existing business into SaaS Free Trial'
        )
        ON CONFLICT (business_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Non-Recursive Platform & Tenant Operational Security Helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE pa.user_id = v_uid
      AND pa.is_active = TRUE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.has_platform_role(p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_roles IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE pa.user_id = v_uid
      AND pa.is_active = TRUE
      AND pa.role = ANY(p_roles)
  );
END;
$$;

-- Checks whether a tenant business is permitted to execute write operations.
-- Suspended or hard-expired (beyond grace period) businesses remain READABLE so
-- owners never lose data and can submit renewal payments, while blocking writes.
CREATE OR REPLACE FUNCTION public.is_business_operational(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz RECORD;
  v_sub RECORD;
  v_grace_cutoff TIMESTAMPTZ;
BEGIN
  IF p_business_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT id, is_active, status INTO v_biz
  FROM public.businesses
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF COALESCE(v_biz.is_active, TRUE) = FALSE OR COALESCE(v_biz.status, 'active') = 'suspended' THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_sub
  FROM public.business_subscriptions
  WHERE business_id = p_business_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;

  IF v_sub.status IN ('suspended', 'cancelled', 'expired') THEN
    RETURN FALSE;
  END IF;

  IF v_sub.status IN ('active', 'trialing', 'grace_period', 'past_due') THEN
    v_grace_cutoff := COALESCE(v_sub.grace_period_ends_at, v_sub.current_period_end + INTERVAL '7 days');
    IF v_grace_cutoff IS NOT NULL AND NOW() > v_grace_cutoff AND v_sub.plan_code <> 'enterprise' THEN
      RETURN FALSE;
    END IF;
    RETURN TRUE;
  END IF;

  RETURN TRUE;
END;
$$;

-- Controlled bootstrap RPC for verified owner email only (no-op for anyone else)
CREATE OR REPLACE FUNCTION public.bootstrap_platform_super_admin_for_caller()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user RECORD;
  v_existing RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_existing
  FROM public.platform_admins
  WHERE user_id = v_uid AND is_active = TRUE;

  IF FOUND THEN
    RETURN to_jsonb(v_existing);
  END IF;

  SELECT id, email, email_confirmed_at, COALESCE(raw_user_meta_data->>'full_name', 'Platform Super Admin') AS full_name
    INTO v_user
  FROM auth.users
  WHERE id = v_uid;

  IF FOUND
     AND LOWER(BTRIM(COALESCE(v_user.email, ''))) = 'queennila72816@gmail.com'
     AND v_user.email_confirmed_at IS NOT NULL THEN
    INSERT INTO public.platform_admins (user_id, email, full_name, role, is_active, assigned_by)
    VALUES (v_uid, v_user.email, v_user.full_name, 'SUPER_ADMIN', TRUE, v_uid)
    ON CONFLICT (user_id) DO UPDATE SET
      role = 'SUPER_ADMIN',
      is_active = TRUE,
      updated_at = NOW()
    RETURNING * INTO v_existing;

    INSERT INTO public.platform_audit_logs (
      actor_user_id, actor_email, actor_role, action, target_type, target_id, details
    ) VALUES (
      v_uid, v_user.email, 'SUPER_ADMIN',
      'PLATFORM_SUPER_ADMIN_BOOTSTRAPPED', 'platform_admin', v_uid::TEXT,
      'Verified Platform Super Admin bootstrapped via controlled auth check'
    );

    RETURN to_jsonb(v_existing);
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_platform_role(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_platform_role(TEXT[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_business_operational(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_business_operational(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bootstrap_platform_super_admin_for_caller() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_platform_super_admin_for_caller() TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Enable RLS & Strict Isolation Policies on All New SaaS Tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_otp_verifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_admins NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.business_subscriptions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_logs NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_otp_verifications NO FORCE ROW LEVEL SECURITY;

-- platform_admins
DROP POLICY IF EXISTS "platform_admins_select" ON public.platform_admins;
CREATE POLICY "platform_admins_select" ON public.platform_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_platform_role(ARRAY['SUPER_ADMIN']));

DROP POLICY IF EXISTS "platform_admins_manage" ON public.platform_admins;
CREATE POLICY "platform_admins_manage" ON public.platform_admins
  FOR ALL TO authenticated
  USING (public.has_platform_role(ARRAY['SUPER_ADMIN']))
  WITH CHECK (public.has_platform_role(ARRAY['SUPER_ADMIN']));

-- platform_settings (authenticated users can read public config; only SUPER_ADMIN updates)
DROP POLICY IF EXISTS "platform_settings_select" ON public.platform_settings;
CREATE POLICY "platform_settings_select" ON public.platform_settings
  FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "platform_settings_manage" ON public.platform_settings;
CREATE POLICY "platform_settings_manage" ON public.platform_settings
  FOR ALL TO authenticated
  USING (public.has_platform_role(ARRAY['SUPER_ADMIN']))
  WITH CHECK (public.has_platform_role(ARRAY['SUPER_ADMIN']));

-- subscription_plans
DROP POLICY IF EXISTS "subscription_plans_select" ON public.subscription_plans;
CREATE POLICY "subscription_plans_select" ON public.subscription_plans
  FOR SELECT TO authenticated
  USING (is_active = TRUE OR public.is_platform_admin());

DROP POLICY IF EXISTS "subscription_plans_manage" ON public.subscription_plans;
CREATE POLICY "subscription_plans_manage" ON public.subscription_plans
  FOR ALL TO authenticated
  USING (public.has_platform_role(ARRAY['SUPER_ADMIN', 'BILLING_ADMIN']))
  WITH CHECK (public.has_platform_role(ARRAY['SUPER_ADMIN', 'BILLING_ADMIN']));

-- business_subscriptions
DROP POLICY IF EXISTS "business_subscriptions_select" ON public.business_subscriptions;
CREATE POLICY "business_subscriptions_select" ON public.business_subscriptions
  FOR SELECT TO authenticated
  USING (public.is_active_staff_member(business_id) OR public.is_platform_admin());

DROP POLICY IF EXISTS "business_subscriptions_manage" ON public.business_subscriptions;
CREATE POLICY "business_subscriptions_manage" ON public.business_subscriptions
  FOR ALL TO authenticated
  USING (public.has_platform_role(ARRAY['SUPER_ADMIN', 'BILLING_ADMIN']))
  WITH CHECK (public.has_platform_role(ARRAY['SUPER_ADMIN', 'BILLING_ADMIN']));

-- payments
DROP POLICY IF EXISTS "payments_select" ON public.payments;
CREATE POLICY "payments_select" ON public.payments
  FOR SELECT TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_platform_role(ARRAY['SUPER_ADMIN', 'BILLING_ADMIN', 'PLATFORM_VIEWER'])
  );

DROP POLICY IF EXISTS "payments_insert" ON public.payments;
CREATE POLICY "payments_insert" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.is_business_owner_or_admin(business_id)
      AND submitted_by = auth.uid()
      AND status = 'pending'
    )
    OR public.has_platform_role(ARRAY['SUPER_ADMIN', 'BILLING_ADMIN'])
  );

DROP POLICY IF EXISTS "payments_update" ON public.payments;
CREATE POLICY "payments_update" ON public.payments
  FOR UPDATE TO authenticated
  USING (public.has_platform_role(ARRAY['SUPER_ADMIN', 'BILLING_ADMIN']))
  WITH CHECK (public.has_platform_role(ARRAY['SUPER_ADMIN', 'BILLING_ADMIN']));

-- support_tickets
DROP POLICY IF EXISTS "support_tickets_select" ON public.support_tickets;
CREATE POLICY "support_tickets_select" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (public.is_active_staff_member(business_id) OR public.is_platform_admin());

DROP POLICY IF EXISTS "support_tickets_insert" ON public.support_tickets;
CREATE POLICY "support_tickets_insert" ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_staff_member(business_id) AND created_by = auth.uid());

DROP POLICY IF EXISTS "support_tickets_update" ON public.support_tickets;
CREATE POLICY "support_tickets_update" ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_platform_role(ARRAY['SUPER_ADMIN', 'SUPPORT_ADMIN'])
  )
  WITH CHECK (
    created_by = auth.uid()
    OR public.has_platform_role(ARRAY['SUPER_ADMIN', 'SUPPORT_ADMIN'])
  );

-- platform_audit_logs (immutable append-only; only platform admins can read)
DROP POLICY IF EXISTS "platform_audit_logs_select" ON public.platform_audit_logs;
CREATE POLICY "platform_audit_logs_select" ON public.platform_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "platform_audit_logs_insert" ON public.platform_audit_logs;
CREATE POLICY "platform_audit_logs_insert" ON public.platform_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

-- Allow Platform Admins to read business directory & memberships safely without touching tenant operational tables
DROP POLICY IF EXISTS "businesses_select" ON public.businesses;
CREATE POLICY "businesses_select" ON public.businesses
  FOR SELECT TO authenticated
  USING (
    public.is_active_staff_member(id)
    OR created_by = auth.uid()
    OR public.is_platform_admin()
  );

-- ----------------------------------------------------------------------------
-- 8. Multi-Business Membership & SaaS Onboarding RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_business_memberships()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY is_owner DESC, created_at DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT DISTINCT ON (bu.business_id)
      jsonb_build_object(
        'businessId', b.id,
        'businessName', b.name,
        'businessType', b.business_type,
        'businessStatus', COALESCE(b.status, CASE WHEN b.is_active THEN 'active' ELSE 'suspended' END),
        'isActive', COALESCE(b.is_active, TRUE),
        'currency', b.currency,
        'branchId', COALESCE(e.branch_id, bu.branch_id),
        'role', bu.role,
        'roleKey', COALESCE(e.role_key, public.normalize_rbac_role_key(bu.role)),
        'businessRoleLevel', public.normalize_business_role_level(COALESCE(e.role_key, bu.role)),
        'membershipStatus', COALESCE(e.account_status, bu.status, 'active'),
        'subscriptionStatus', bs.status,
        'planCode', bs.plan_code,
        'planName', sp.name,
        'currentPeriodEnd', bs.current_period_end,
        'createdAt', b.created_at
      ) AS row_data,
      (public.normalize_rbac_role_key(bu.role) = 'super_admin') AS is_owner,
      bu.created_at
    FROM public.business_users bu
    JOIN public.businesses b ON b.id = bu.business_id
    LEFT JOIN public.employees e ON e.business_id = bu.business_id AND e.user_id = v_uid
    LEFT JOIN public.business_subscriptions bs ON bs.business_id = b.id
    LEFT JOIN public.subscription_plans sp ON sp.id = bs.plan_id
    WHERE bu.user_id = v_uid
      AND COALESCE(bu.status, 'active') = 'active'
      AND COALESCE(e.account_status, 'active') = 'active'
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_business_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_business_memberships() TO authenticated;

-- Replace 0-arg get_my_rbac_context with optional p_business_id so multi-business
-- staff/owners resolve the exact requested business context deterministically.
DROP FUNCTION IF EXISTS public.get_my_rbac_context();
DROP FUNCTION IF EXISTS public.get_my_rbac_context(UUID);

CREATE OR REPLACE FUNCTION public.get_my_rbac_context(p_business_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_emp RECORD;
  v_bu RECORD;
  v_status TEXT := 'active';
  v_role_key TEXT := 'super_admin';
  v_biz_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('authenticated', FALSE);
  END IF;

  IF p_business_id IS NOT NULL THEN
    SELECT * INTO v_emp
    FROM public.employees
    WHERE user_id = v_uid AND business_id = p_business_id
    ORDER BY created_at DESC
    LIMIT 1;

    SELECT * INTO v_bu
    FROM public.business_users
    WHERE user_id = v_uid AND business_id = p_business_id
    ORDER BY created_at DESC
    LIMIT 1;
  ELSE
    SELECT * INTO v_emp
    FROM public.employees
    WHERE user_id = v_uid
    ORDER BY (account_status = 'active') DESC, created_at DESC
    LIMIT 1;

    SELECT * INTO v_bu
    FROM public.business_users
    WHERE user_id = v_uid
    ORDER BY (COALESCE(status, 'active') = 'active') DESC, created_at DESC
    LIMIT 1;
  END IF;

  v_biz_id := COALESCE(p_business_id, v_bu.business_id, v_emp.business_id);
  v_status := COALESCE(v_emp.account_status, v_bu.status, 'active');
  v_role_key := public.normalize_rbac_role_key(COALESCE(v_emp.role_key, v_emp.role, v_bu.role, 'super_admin'));

  IF v_status IN ('inactive', 'suspended', 'blocked') THEN
    IF v_biz_id IS NOT NULL THEN
      INSERT INTO public.user_activity_logs (
        business_id, user_id, employee_id, employee_code, employee_name,
        role_key, role_name, event_type, module_key, action, details
      ) VALUES (
        v_biz_id, v_uid, v_emp.id, v_emp.employee_code, COALESCE(v_emp.name, 'Staff'),
        v_role_key, v_role_key, 'LOGIN_BLOCKED', 'user_management', 'login',
        'Blocked login attempt for ' || v_status || ' account'
      );
    END IF;

    RETURN jsonb_build_object(
      'authenticated', TRUE,
      'allowed', FALSE,
      'account_status', v_status,
      'reason', 'Your employee account is currently ' || v_status || '. Please contact the Store Admin.'
    );
  END IF;

  IF v_emp.id IS NOT NULL THEN
    UPDATE public.employees SET last_login_at = NOW() WHERE id = v_emp.id;
  END IF;

  RETURN jsonb_build_object(
    'authenticated', TRUE,
    'allowed', TRUE,
    'business_id', v_biz_id,
    'employee_id', v_emp.id,
    'employee_code', v_emp.employee_code,
    'employee_name', v_emp.name,
    'role_id', v_emp.role_id,
    'role_key', v_role_key,
    'business_role_level', public.normalize_business_role_level(v_role_key),
    'account_status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_rbac_context(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_rbac_context(UUID) TO authenticated;

-- Upgrade complete_first_time_business_setup to support creating additional businesses
-- AND initializing the business_subscriptions plan cleanly in the same atomic transaction.
DROP FUNCTION IF EXISTS public.complete_first_time_business_setup(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB
);

CREATE OR REPLACE FUNCTION public.complete_first_time_business_setup(
  p_business_id UUID DEFAULT NULL,
  p_shop_name TEXT DEFAULT '',
  p_owner_name TEXT DEFAULT '',
  p_business_type TEXT DEFAULT 'general',
  p_phone TEXT DEFAULT '',
  p_email TEXT DEFAULT NULL,
  p_address TEXT DEFAULT '',
  p_branch_name TEXT DEFAULT 'Main Branch',
  p_currency TEXT DEFAULT '৳',
  p_financial_year TEXT DEFAULT '',
  p_vat_tax_rate NUMERIC DEFAULT 0,
  p_vat_registration_no TEXT DEFAULT NULL,
  p_initial_accounts JSONB DEFAULT '[]'::jsonb,
  p_create_new BOOLEAN DEFAULT FALSE,
  p_plan_code TEXT DEFAULT 'free_trial',
  p_billing_cycle TEXT DEFAULT 'trial'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_auth_email TEXT := '';
  v_clean_shop_name TEXT := BTRIM(COALESCE(p_shop_name, ''));
  v_clean_owner_name TEXT := BTRIM(COALESCE(p_owner_name, ''));
  v_clean_branch_name TEXT := COALESCE(NULLIF(BTRIM(COALESCE(p_branch_name, '')), ''), 'Main Branch');
  v_clean_email TEXT := NULLIF(LOWER(BTRIM(COALESCE(p_email, ''))), '');
  v_clean_phone TEXT := BTRIM(COALESCE(p_phone, ''));
  v_clean_address TEXT := BTRIM(COALESCE(p_address, ''));
  v_clean_currency TEXT := COALESCE(NULLIF(BTRIM(COALESCE(p_currency, '')), ''), '৳');
  v_clean_fy TEXT := COALESCE(
    NULLIF(BTRIM(COALESCE(p_financial_year, '')), ''),
    TO_CHAR(NOW(), 'YYYY') || '-' || (EXTRACT(YEAR FROM NOW())::INT + 1)::TEXT
  );
  v_biz_id UUID := CASE WHEN COALESCE(p_create_new, FALSE) THEN NULL ELSE p_business_id END;
  v_biz RECORD;
  v_branch RECORD;
  v_acc_item JSONB;
  v_acc_name TEXT;
  v_acc_type TEXT;
  v_acc_num TEXT;
  v_acc_bal_raw TEXT;
  v_acc_bal NUMERIC(14,2);
  v_accounts_json JSONB := '[]'::jsonb;
  v_plan RECORD;
  v_sub RECORD;
  v_period_end TIMESTAMPTZ;
  v_cycle TEXT := LOWER(BTRIM(COALESCE(p_billing_cycle, 'trial')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to complete business setup.';
  END IF;

  IF v_clean_shop_name = '' THEN
    RAISE EXCEPTION 'Business / Shop name is required.';
  END IF;

  IF v_clean_owner_name = '' THEN
    RAISE EXCEPTION 'Owner / Administrator name is required.';
  END IF;

  -- Block deactivated/suspended staff from creating businesses
  IF EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.user_id = v_uid AND e.account_status IN ('inactive', 'suspended', 'blocked')
  ) THEN
    RAISE EXCEPTION 'Your account is currently suspended or inactive. Please contact support.';
  END IF;

  -- If updating an existing setup (not creating a brand new shop), verify ownership/admin role
  IF NOT COALESCE(p_create_new, FALSE) THEN
    IF EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.user_id = v_uid
        AND e.account_status = 'active'
        AND public.normalize_rbac_role_key(COALESCE(e.role_key, e.role)) <> 'super_admin'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.user_id = v_uid
        AND COALESCE(bu.status, 'active') = 'active'
        AND public.normalize_rbac_role_key(bu.role) = 'super_admin'
    ) THEN
      RAISE EXCEPTION 'Only Store Owners or Administrators can run First-Time Business Setup.';
    END IF;
  END IF;

  SELECT COALESCE(au.email, '') INTO v_auth_email
  FROM auth.users au
  WHERE au.id = v_uid;

  -- Step 1: Upsert owner profile
  INSERT INTO public.user_profiles (id, email, full_name, mobile, updated_at)
  VALUES (
    v_uid,
    COALESCE(v_clean_email, NULLIF(LOWER(BTRIM(v_auth_email)), ''), ''),
    v_clean_owner_name,
    NULLIF(v_clean_phone, ''),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    mobile = COALESCE(EXCLUDED.mobile, public.user_profiles.mobile),
    email = CASE WHEN EXCLUDED.email <> '' THEN EXCLUDED.email ELSE public.user_profiles.email END,
    updated_at = NOW();

  -- Step 2: Resolve or create business strictly owned by v_uid
  IF v_biz_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = v_biz_id
        AND (b.created_by = v_uid OR public.is_business_owner_or_admin(b.id))
    ) THEN
      RAISE EXCEPTION 'Permission denied: target business does not belong to the authenticated owner.';
    END IF;
  ELSIF NOT COALESCE(p_create_new, FALSE) THEN
    SELECT bu.business_id INTO v_biz_id
    FROM public.business_users bu
    WHERE bu.user_id = v_uid
      AND COALESCE(bu.status, 'active') = 'active'
      AND public.normalize_rbac_role_key(bu.role) = 'super_admin'
    ORDER BY (bu.branch_id IS NOT NULL) DESC, bu.created_at DESC
    LIMIT 1;
  END IF;

  IF v_biz_id IS NULL THEN
    INSERT INTO public.businesses (
      name, owner_name, tagline, business_type, phone, email, address,
      currency, financial_year, vat_tax_rate, vat_registration_no,
      language, is_active, status, created_by, updated_at
    ) VALUES (
      v_clean_shop_name, v_clean_owner_name, '',
      COALESCE(NULLIF(BTRIM(p_business_type), ''), 'general'),
      v_clean_phone, COALESCE(v_clean_email, NULLIF(LOWER(BTRIM(v_auth_email)), '')),
      v_clean_address, v_clean_currency, v_clean_fy,
      COALESCE(p_vat_tax_rate, 0), NULLIF(BTRIM(COALESCE(p_vat_registration_no, '')), ''),
      'en', TRUE, 'active', v_uid, NOW()
    )
    RETURNING * INTO v_biz;

    v_biz_id := v_biz.id;
  ELSE
    UPDATE public.businesses
    SET name = v_clean_shop_name,
        owner_name = v_clean_owner_name,
        business_type = COALESCE(NULLIF(BTRIM(p_business_type), ''), business_type, 'general'),
        phone = v_clean_phone,
        email = COALESCE(v_clean_email, NULLIF(LOWER(BTRIM(v_auth_email)), ''), email),
        address = v_clean_address,
        currency = v_clean_currency,
        financial_year = v_clean_fy,
        vat_tax_rate = COALESCE(p_vat_tax_rate, 0),
        vat_registration_no = COALESCE(NULLIF(BTRIM(COALESCE(p_vat_registration_no, '')), ''), vat_registration_no),
        is_active = TRUE,
        status = 'active',
        created_by = COALESCE(created_by, v_uid),
        updated_at = NOW()
    WHERE id = v_biz_id
    RETURNING * INTO v_biz;
  END IF;

  -- Step 3: Ensure owner membership exists & is active
  INSERT INTO public.business_users (business_id, user_id, role, status, updated_at)
  VALUES (v_biz_id, v_uid, 'owner', 'active', NOW())
  ON CONFLICT (business_id, user_id) DO UPDATE SET
    role = 'owner',
    status = 'active',
    updated_at = NOW();

  -- Step 4: Reuse or create primary branch
  SELECT * INTO v_branch
  FROM public.branches br
  WHERE br.business_id = v_biz_id
  ORDER BY br.is_main DESC, br.created_at ASC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.branches
    SET name = v_clean_branch_name,
        location = v_clean_address,
        mobile = v_clean_phone,
        is_main = TRUE,
        updated_at = NOW()
    WHERE id = v_branch.id
    RETURNING * INTO v_branch;
  ELSE
    INSERT INTO public.branches (business_id, name, location, mobile, is_main, updated_at)
    VALUES (v_biz_id, v_clean_branch_name, v_clean_address, v_clean_phone, TRUE, NOW())
    RETURNING * INTO v_branch;
  END IF;

  -- Step 5: Link primary branch to owner membership & save last active business
  UPDATE public.business_users
  SET branch_id = v_branch.id, updated_at = NOW()
  WHERE business_id = v_biz_id AND user_id = v_uid;

  UPDATE public.user_profiles
  SET last_active_business_id = v_biz_id, updated_at = NOW()
  WHERE id = v_uid;

  -- Step 6: Create initial payment accounts
  IF p_initial_accounts IS NOT NULL AND jsonb_typeof(p_initial_accounts) = 'array' THEN
    FOR v_acc_item IN SELECT * FROM jsonb_array_elements(p_initial_accounts)
    LOOP
      v_acc_name := BTRIM(COALESCE(v_acc_item->>'name', ''));
      IF v_acc_name = '' THEN CONTINUE; END IF;

      v_acc_type := LOWER(COALESCE(NULLIF(BTRIM(COALESCE(v_acc_item->>'accountType', v_acc_item->>'account_type', '')), ''), 'cash'));
      IF v_acc_type NOT IN ('cash', 'bank', 'mobile_bank') THEN v_acc_type := 'cash'; END IF;

      v_acc_num := NULLIF(BTRIM(COALESCE(v_acc_item->>'accountNumber', v_acc_item->>'account_number', '')), '');
      v_acc_bal_raw := NULLIF(BTRIM(COALESCE(v_acc_item->>'openingBalance', v_acc_item->>'balance', '')), '');
      v_acc_bal := COALESCE(v_acc_bal_raw::NUMERIC, 0);

      IF NOT EXISTS (
        SELECT 1 FROM public.accounts a
        WHERE a.business_id = v_biz_id
          AND LOWER(BTRIM(a.name)) = LOWER(v_acc_name)
          AND a.account_type = v_acc_type
      ) THEN
        INSERT INTO public.accounts (
          business_id, name, account_type, account_number, balance, is_active, updated_at
        ) VALUES (
          v_biz_id, v_acc_name, v_acc_type, v_acc_num, v_acc_bal, TRUE, NOW()
        );
      END IF;
    END LOOP;
  END IF;

  -- Step 7: Initialize SaaS Subscription (Free Trial immediately, or Trial period while paid invoice awaits verification)
  IF NOT EXISTS (SELECT 1 FROM public.business_subscriptions WHERE business_id = v_biz_id) THEN
    SELECT * INTO v_plan
    FROM public.subscription_plans
    WHERE code = LOWER(BTRIM(COALESCE(NULLIF(p_plan_code, ''), 'free_trial')))
      AND is_active = TRUE
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT * INTO v_plan FROM public.subscription_plans WHERE code = 'free_trial' LIMIT 1;
    END IF;

    IF v_plan.id IS NOT NULL THEN
      IF v_cycle NOT IN ('trial', 'monthly', 'yearly') THEN
        v_cycle := 'trial';
      END IF;

      v_period_end := NOW() + make_interval(days => GREATEST(7, COALESCE(v_plan.trial_days, 14)));

      INSERT INTO public.business_subscriptions (
        business_id, plan_id, plan_code, billing_cycle, status,
        trial_starts_at, trial_ends_at, current_period_start, current_period_end,
        grace_period_ends_at, max_users, max_branches, max_products, notes
      ) VALUES (
        v_biz_id, v_plan.id, v_plan.code, v_cycle, 'trialing',
        NOW(), v_period_end, NOW(), v_period_end,
        v_period_end + make_interval(days => COALESCE(v_plan.grace_period_days, 7)),
        v_plan.max_users, v_plan.max_branches, v_plan.max_products,
        'Started during Business Onboarding'
      )
      RETURNING * INTO v_sub;
    END IF;
  ELSE
    SELECT * INTO v_sub FROM public.business_subscriptions WHERE business_id = v_biz_id LIMIT 1;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at ASC), '[]'::jsonb)
    INTO v_accounts_json
  FROM public.accounts a
  WHERE a.business_id = v_biz_id;

  RETURN jsonb_build_object(
    'business', to_jsonb(v_biz),
    'branch', to_jsonb(v_branch),
    'accounts', v_accounts_json,
    'subscription', CASE WHEN v_sub.id IS NOT NULL THEN to_jsonb(v_sub) ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_first_time_business_setup(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, BOOLEAN, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_first_time_business_setup(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, BOOLEAN, TEXT, TEXT
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Security Hardening of Existing Transactional RPCs (Cross-Tenant & Auth Guards)
--    Updates all 12 unprotected 20261118 SECURITY DEFINER RPCs to verify caller
--    identity, business membership/RBAC permissions, and operational status.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_caller_business_permission(
  p_business_id UUID,
  p_module_key TEXT,
  p_action TEXT DEFAULT 'edit',
  p_require_operational BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF v_jwt_role = 'service_role' THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'Missing business_id.';
  END IF;

  IF NOT public.is_active_staff_member(p_business_id) THEN
    RAISE EXCEPTION 'Access denied: you are not an active member of this business.';
  END IF;

  IF p_require_operational AND NOT public.is_business_operational(p_business_id) THEN
    RAISE EXCEPTION 'Business workspace is currently suspended or expired. Please renew your subscription or contact support.';
  END IF;

  IF p_module_key IS NOT NULL AND NOT public.has_module_permission(p_business_id, p_module_key, p_action) THEN
    RAISE EXCEPTION 'Permission denied: missing % % permission.', p_module_key, p_action;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_caller_business_permission(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_caller_business_permission(UUID, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;

-- Harden refund_or_void_sale_transaction
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

-- Harden record_partial_sale_return
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
  PERFORM public.assert_caller_business_permission(p_business_id, 'sales_history', 'edit', TRUE);

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
      FROM public.products WHERE id = v_prod_id AND business_id = p_business_id FOR UPDATE;
      IF FOUND THEN
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
          v_sale.invoice_number, 'Sale return: ' || COALESCE(v_item->>'reason', 'Returned')
        );
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

-- Harden adjust_product_stock
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
  PERFORM public.assert_caller_business_permission(p_business_id, 'stock_management', 'edit', TRUE);

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

-- Harden transfer_branch_stock
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
  PERFORM public.assert_caller_business_permission(p_business_id, 'stock_management', 'edit', TRUE);

  IF p_quantity <= 0 OR p_from_branch_id = p_to_branch_id THEN
    RAISE EXCEPTION 'Invalid transfer quantity or branches';
  END IF;

  SELECT name, current_stock INTO v_prod FROM public.products WHERE id = p_product_id AND business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  SELECT name INTO v_from_name FROM public.branches WHERE id = p_from_branch_id AND business_id = p_business_id;
  SELECT name INTO v_to_name FROM public.branches WHERE id = p_to_branch_id AND business_id = p_business_id;

  IF v_from_name IS NULL OR v_to_name IS NULL THEN
    RAISE EXCEPTION 'Source or destination branch does not belong to this business';
  END IF;

  INSERT INTO public.stock_transfers (
    business_id, product_id, product_name, quantity,
    from_branch_id, from_branch_name, to_branch_id, to_branch_name, reference, note
  ) VALUES (
    p_business_id, p_product_id, v_prod.name, p_quantity,
    p_from_branch_id, v_from_name, p_to_branch_id, v_to_name, v_ref, p_note
  );

  INSERT INTO public.stock_movements (
    business_id, branch_id, product_id, product_name,
    movement_type, quantity, previous_stock, new_stock, reference, note
  ) VALUES
    (p_business_id, p_from_branch_id, p_product_id, v_prod.name, 'transfer_out', -p_quantity, v_prod.current_stock, v_prod.current_stock, v_ref, 'Transfer to ' || v_to_name),
    (p_business_id, p_to_branch_id, p_product_id, v_prod.name, 'transfer_in', p_quantity, v_prod.current_stock, v_prod.current_stock, v_ref, 'Transfer from ' || v_from_name);

  RETURN jsonb_build_object('success', TRUE, 'reference', v_ref);
END;
$$;

-- Harden collect_customer_due_payment
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
  PERFORM public.assert_caller_business_permission(p_business_id, 'due_collection', 'create', TRUE);

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
    SELECT balance, name INTO v_acc_bal, v_acc_name FROM public.accounts WHERE id = v_acc_id AND business_id = p_business_id FOR UPDATE;
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

-- Harden pay_supplier_due_balance
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
  PERFORM public.assert_caller_business_permission(p_business_id, 'due_collection', 'create', TRUE);

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT * INTO v_supp FROM public.suppliers WHERE id = p_supplier_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier not found';
  END IF;

  v_acc_id := public.resolve_business_account(p_business_id, p_account_id, p_payment_method);
  IF v_acc_id IS NOT NULL THEN
    SELECT balance, name INTO v_acc_bal, v_acc_name FROM public.accounts WHERE id = v_acc_id AND business_id = p_business_id FOR UPDATE;
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

-- Harden transfer_account_funds
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
  PERFORM public.assert_caller_business_permission(p_business_id, 'accounts_transactions', 'create', TRUE);

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

-- Harden record_expense_transaction
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
  PERFORM public.assert_caller_business_permission(p_business_id, 'expense_management', 'create', TRUE);

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Expense amount must be greater than zero';
  END IF;

  v_acc_id := public.resolve_business_account(p_business_id, p_account_id, p_payment_method);
  IF v_acc_id IS NOT NULL THEN
    SELECT * INTO v_acc FROM public.accounts WHERE id = v_acc_id AND business_id = p_business_id FOR UPDATE;
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

-- Harden register_seller_profile (must verify user_management create permission!)
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
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.assert_caller_business_permission(p_business_id, 'user_management', 'create', TRUE);

  IF NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = p_seller_id) THEN
    RAISE EXCEPTION 'Invalid seller auth user UUID.';
  END IF;

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

-- Harden increment_offer_usage (must verify caller is active staff of offer's business!)
CREATE OR REPLACE FUNCTION public.increment_offer_usage(p_offer_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer_biz UUID;
BEGIN
  SELECT business_id INTO v_offer_biz FROM public.combo_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM public.assert_caller_business_permission(v_offer_biz, 'pos_new_sale', 'create', FALSE);

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

-- Harden complete_sale_transaction
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
  PERFORM public.assert_caller_business_permission(v_business_id, 'pos_new_sale', 'create', TRUE);

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cannot complete sale without at least one item';
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

  INSERT INTO public.sales (
    business_id, branch_id, invoice_number, customer_id, customer_name, customer_mobile,
    subtotal, discount, combo_discount, applied_offers, vat_tax_rate, vat_tax_amount,
    total, paid, due, payment_method, status, served_by,
    employee_id, employee_code, employee_name, seller_id, seller_name, notes
  ) VALUES (
    v_business_id, v_branch_id, v_invoice_number, v_customer_id,
    COALESCE(NULLIF(p_sale->>'customer_name', ''), 'Walk-in Customer'),
    NULLIF(p_sale->>'customer_mobile', ''),
    v_subtotal, v_discount, v_combo_discount, COALESCE(p_sale->'applied_offers', '[]'::jsonb),
    v_vat_rate, v_vat_amount, v_total, v_paid, v_due, v_payment_method, v_status,
    COALESCE(NULLIF(p_sale->>'served_by', ''), 'Staff'),
    v_employee_id, NULLIF(p_sale->>'employee_code', ''), NULLIF(p_sale->>'employee_name', ''),
    v_seller_id, NULLIF(p_sale->>'seller_name', ''), NULLIF(p_sale->>'notes', '')
  )
  RETURNING id INTO v_sale_id;

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

    SELECT current_stock, name INTO v_prev_stock, v_prod_name
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

    IF v_var_id IS NOT NULL THEN
      SELECT stock INTO v_var_stock
      FROM public.product_variants
      WHERE id = v_var_id AND product_id = v_prod_id AND business_id = v_business_id
      FOR UPDATE;

      IF FOUND THEN
        IF v_var_stock < v_qty THEN
          RAISE EXCEPTION 'Insufficient variant stock for "%" (Available: %, Requested: %)', v_prod_name, v_var_stock, v_qty;
        END IF;
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
      quantity, unit_price, purchase_price, discount, total, combo_offer_id, combo_offer_name, is_free_item
    ) VALUES (
      v_sale_id, v_business_id, v_prod_id, v_var_id,
      COALESCE(NULLIF(v_item->>'product_name', ''), v_prod_name),
      COALESCE(v_item->>'sku', ''), NULLIF(v_item->>'variant_details', ''),
      v_qty, COALESCE((v_item->>'unit_price')::NUMERIC, 0), COALESCE((v_item->>'purchase_price')::NUMERIC, 0),
      COALESCE((v_item->>'discount')::NUMERIC, 0), COALESCE((v_item->>'total')::NUMERIC, 0),
      NULLIF(v_item->>'combo_offer_id', ''), NULLIF(v_item->>'combo_offer_name', ''),
      COALESCE((v_item->>'is_free_item')::BOOLEAN, FALSE)
    );

    INSERT INTO public.stock_movements (
      business_id, branch_id, product_id, product_name,
      movement_type, quantity, previous_stock, new_stock, reference, note
    ) VALUES (
      v_business_id, v_branch_id, v_prod_id,
      COALESCE(NULLIF(v_item->>'product_name', ''), v_prod_name),
      'sale_out', -v_qty, v_prev_stock, v_new_stock, v_invoice_number,
      'Sale invoice ' || v_invoice_number
    );
  END LOOP;

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
    'due', v_due
  );
END;
$$;

-- Harden delete_sale_transaction
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
  PERFORM public.assert_caller_business_permission(p_business_id, 'sales_history', 'delete', TRUE);

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale invoice not found';
  END IF;

  IF v_sale.status NOT IN ('returned', 'voided') THEN
    FOR v_item IN SELECT * FROM public.sale_items WHERE sale_id = p_sale_id
    LOOP
      IF v_item.product_id IS NOT NULL THEN
        SELECT current_stock INTO v_prod_stock FROM public.products WHERE id = v_item.product_id AND business_id = p_business_id FOR UPDATE;
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
            'adjustment', v_item.quantity, v_prod_stock, COALESCE(v_prod_stock, 0) + v_item.quantity,
            v_sale.invoice_number, 'Stock restored after deleting sale ' || v_sale.invoice_number
          );
        END IF;
      END IF;
    END LOOP;

    IF v_sale.customer_id IS NOT NULL THEN
      SELECT * INTO v_cust FROM public.customers WHERE id = v_sale.customer_id AND business_id = p_business_id FOR UPDATE;
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
        SELECT balance INTO v_acc_bal FROM public.accounts WHERE id = v_acc_id AND business_id = p_business_id FOR UPDATE;
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

-- Harden complete_purchase_transaction
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
  PERFORM public.assert_caller_business_permission(v_business_id, 'purchase_management', 'create', TRUE);

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
      SELECT balance, name INTO v_acc_bal, v_acc_name FROM public.accounts WHERE id = v_acc_id AND business_id = v_business_id FOR UPDATE;
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

-- Harden delete_purchase_transaction
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
  PERFORM public.assert_caller_business_permission(p_business_id, 'purchase_management', 'delete', TRUE);

  SELECT * INTO v_pur FROM public.purchases WHERE id = p_purchase_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase record not found';
  END IF;

  FOR v_item IN SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT current_stock INTO v_prod_stock FROM public.products WHERE id = v_item.product_id AND business_id = p_business_id FOR UPDATE;
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

  IF v_pur.supplier_id IS NOT NULL THEN
    SELECT * INTO v_supp FROM public.suppliers WHERE id = v_pur.supplier_id AND business_id = p_business_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.suppliers
      SET total_purchase = GREATEST(0, COALESCE(total_purchase, 0) - COALESCE(v_pur.total, 0)),
          total_paid = GREATEST(0, COALESCE(total_paid, 0) - COALESCE(v_pur.paid, 0)),
          current_due = GREATEST(0, COALESCE(current_due, 0) - COALESCE(v_pur.due, 0)),
          updated_at = NOW()
      WHERE id = v_pur.supplier_id;
    END IF;
  END IF;

  IF COALESCE(v_pur.paid, 0) > 0 THEN
    v_acc_id := public.resolve_business_account(p_business_id, NULL, v_pur.payment_method);
    IF v_acc_id IS NOT NULL THEN
      SELECT balance, name INTO v_acc_bal, v_acc_name FROM public.accounts WHERE id = v_acc_id AND business_id = p_business_id FOR UPDATE;
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

-- Harden update_purchase_transaction
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
  PERFORM public.assert_caller_business_permission(p_business_id, 'purchase_management', 'edit', TRUE);

  SELECT * INTO v_old_pur FROM public.purchases WHERE id = p_purchase_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase record not found';
  END IF;

  FOR v_old_item IN SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id
  LOOP
    IF v_old_item.product_id IS NOT NULL THEN
      SELECT current_stock INTO v_prev_stock FROM public.products WHERE id = v_old_item.product_id AND business_id = p_business_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.products
        SET current_stock = GREATEST(0, COALESCE(v_prev_stock, 0) - v_old_item.quantity),
            updated_at = NOW()
        WHERE id = v_old_item.product_id;
      END IF;
    END IF;
  END LOOP;

  IF v_old_pur.supplier_id IS NOT NULL THEN
    UPDATE public.suppliers
    SET total_purchase = GREATEST(0, COALESCE(total_purchase, 0) - COALESCE(v_old_pur.total, 0)),
        total_paid = GREATEST(0, COALESCE(total_paid, 0) - COALESCE(v_old_pur.paid, 0)),
        current_due = GREATEST(0, COALESCE(current_due, 0) - COALESCE(v_old_pur.due, 0)),
        updated_at = NOW()
    WHERE id = v_old_pur.supplier_id AND business_id = p_business_id;
  END IF;

  IF COALESCE(v_old_pur.paid, 0) > 0 THEN
    v_acc_id := public.resolve_business_account(p_business_id, NULL, v_old_pur.payment_method);
    IF v_acc_id IS NOT NULL THEN
      UPDATE public.accounts
      SET balance = COALESCE(balance, 0) + v_old_pur.paid, updated_at = NOW()
      WHERE id = v_acc_id AND business_id = p_business_id;
    END IF;
  END IF;

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

  IF v_new_supplier_id IS NOT NULL THEN
    UPDATE public.suppliers
    SET total_purchase = COALESCE(total_purchase, 0) + v_new_total,
        total_paid = COALESCE(total_paid, 0) + v_new_paid,
        current_due = COALESCE(current_due, 0) + v_new_due,
        updated_at = NOW()
    WHERE id = v_new_supplier_id AND business_id = p_business_id;
  END IF;

  IF v_new_paid > 0 THEN
    v_acc_id := public.resolve_business_account(p_business_id, NULL, v_new_method);
    IF v_acc_id IS NOT NULL THEN
      SELECT balance INTO v_acc_bal FROM public.accounts WHERE id = v_acc_id AND business_id = p_business_id FOR UPDATE;
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

-- Harden delete_expense_transaction
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
  PERFORM public.assert_caller_business_permission(p_business_id, 'expense_management', 'delete', TRUE);

  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF v_exp.account_id IS NOT NULL THEN
    SELECT * INTO v_acc FROM public.accounts WHERE id = v_exp.account_id AND business_id = p_business_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.accounts SET balance = COALESCE(v_acc.balance, 0) + v_exp.amount, updated_at = NOW() WHERE id = v_acc.id;
    END IF;
  END IF;

  DELETE FROM public.expenses WHERE id = p_expense_id AND business_id = p_business_id;
  RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- Restrict RPC execute permissions explicitly to authenticated + service_role
REVOKE ALL ON FUNCTION public.complete_sale_transaction(JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_sale_transaction(JSONB, JSONB, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.refund_or_void_sale_transaction(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_or_void_sale_transaction(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_partial_sale_return(UUID, UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_partial_sale_return(UUID, UUID, JSONB, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_sale_transaction(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_sale_transaction(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.complete_purchase_transaction(JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_purchase_transaction(JSONB, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_purchase_transaction(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_purchase_transaction(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_purchase_transaction(UUID, UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_purchase_transaction(UUID, UUID, JSONB, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.adjust_product_stock(UUID, UUID, UUID, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_product_stock(UUID, UUID, UUID, NUMERIC, TEXT, TEXT, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.transfer_branch_stock(UUID, UUID, NUMERIC, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_branch_stock(UUID, UUID, NUMERIC, UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.collect_customer_due_payment(UUID, UUID, NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_customer_due_payment(UUID, UUID, NUMERIC, TEXT, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.pay_supplier_due_balance(UUID, UUID, NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_supplier_due_balance(UUID, UUID, NUMERIC, TEXT, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.transfer_account_funds(UUID, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_account_funds(UUID, UUID, UUID, NUMERIC, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_expense_transaction(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_expense_transaction(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_expense_transaction(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_expense_transaction(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.register_seller_profile(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_seller_profile(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.increment_offer_usage(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_offer_usage(TEXT) TO authenticated, service_role;
