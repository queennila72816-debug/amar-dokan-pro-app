-- ============================================================================
-- Amar Dokan Pro: Permanent Non-Recursive RLS & Atomic Business Setup Fix
-- Idempotent & Data-Safe Migration (Zero data deletion, RLS remains ENABLED)
--
-- Root Causes Addressed:
-- 1. Eliminates ALL direct/indirect queries to public.branches inside branches
--    RLS helper functions (previous can_manage_business_branch queried branches
--    during branches INSERT, risking self-recursion if FORCE RLS or non-bypass
--    roles were active).
-- 2. Sweeps ALL existing/legacy policies across pg_policies on branches AND all
--    related membership/RBAC tables (businesses, business_users, user_profiles,
--    employees, user_roles, role_permissions, user_activity_logs, accounts) so
--    no leftover OR-combined policy can trigger 42P17 infinite recursion.
-- 3. Ensures NO FORCE ROW LEVEL SECURITY on all tables so SECURITY DEFINER
--    helpers (with fixed search_path = public) cleanly evaluate membership/RBAC
--    without re-entering table RLS policies.
-- 4. Adds businesses.created_by (nullable, default auth.uid()) and tightens
--    business_users INSERT/DELETE policies so new owners can set up their own
--    business without allowing cross-business membership hijacking.
-- 5. Provides atomic SECURITY DEFINER RPC `complete_first_time_business_setup`
--    so Business, Owner Membership, Primary Branch, and Initial Accounts save
--    in one transaction with zero orphaned partial state.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Schema Safeguards (Non-destructive)
-- ----------------------------------------------------------------------------
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.businesses
  ALTER COLUMN created_by SET DEFAULT auth.uid();

-- ----------------------------------------------------------------------------
-- 2. Ensure RLS is ENABLED (and NO FORCE RLS blocks SECURITY DEFINER helpers)
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_profiles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.businesses NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.branches NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.business_users NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.employees NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_logs NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.accounts NO FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 3. Hardened, Non-Recursive SECURITY DEFINER Helper Functions
--    (NONE of these query public.branches!)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_rbac_role_key(p_raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE LOWER(COALESCE(p_raw, ''))
    WHEN 'owner' THEN 'super_admin'
    WHEN 'admin' THEN 'super_admin'
    WHEN 'super_admin' THEN 'super_admin'
    WHEN 'manager' THEN 'store_manager'
    WHEN 'store_manager' THEN 'store_manager'
    WHEN 'seller' THEN 'salesman'
    WHEN 'salesman' THEN 'salesman'
    WHEN 'storekeeper' THEN 'inventory_manager'
    WHEN 'inventory_manager' THEN 'inventory_manager'
    WHEN 'accountant' THEN 'accountant'
    WHEN 'cashier' THEN 'cashier'
    ELSE LOWER(COALESCE(p_raw, 'salesman'))
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_active_staff_member(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_blocked BOOLEAN := FALSE;
  v_member BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL OR p_business_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Explicitly deny inactive, suspended, or blocked accounts
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.business_id = p_business_id
      AND e.user_id = v_uid
      AND e.account_status IN ('inactive', 'suspended', 'blocked')
  ) OR EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = v_uid
      AND COALESCE(bu.status, 'active') IN ('inactive', 'suspended', 'blocked')
  ) INTO v_blocked;

  IF v_blocked THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = v_uid
      AND COALESCE(bu.status, 'active') = 'active'
  ) OR EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.business_id = p_business_id
      AND e.user_id = v_uid
      AND e.account_status = 'active'
  ) INTO v_member;

  RETURN v_member;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_business_owner_or_admin(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_blocked BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL OR p_business_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.business_id = p_business_id
      AND e.user_id = v_uid
      AND e.account_status IN ('inactive', 'suspended', 'blocked')
  ) OR EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = v_uid
      AND COALESCE(bu.status, 'active') IN ('inactive', 'suspended', 'blocked')
  ) INTO v_blocked;

  IF v_blocked THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = v_uid
      AND COALESCE(bu.status, 'active') = 'active'
      AND public.normalize_rbac_role_key(bu.role) = 'super_admin'
  ) OR EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.business_id = p_business_id
      AND e.user_id = v_uid
      AND e.account_status = 'active'
      AND public.normalize_rbac_role_key(COALESCE(e.role_key, e.role)) = 'super_admin'
  ) INTO v_is_admin;

  RETURN v_is_admin;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_module_permission(
  p_business_id UUID,
  p_module_key TEXT,
  p_action TEXT DEFAULT 'view'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role_id UUID;
  v_role_key TEXT;
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL OR p_business_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT public.is_active_staff_member(p_business_id) THEN
    RETURN FALSE;
  END IF;

  IF public.is_business_owner_or_admin(p_business_id) THEN
    RETURN TRUE;
  END IF;

  SELECT e.role_id, public.normalize_rbac_role_key(COALESCE(e.role_key, e.role))
    INTO v_role_id, v_role_key
  FROM public.employees e
  WHERE e.business_id = p_business_id
    AND e.user_id = v_uid
    AND e.account_status = 'active'
  LIMIT 1;

  IF v_role_id IS NULL AND v_role_key IS NOT NULL THEN
    SELECT ur.id
      INTO v_role_id
    FROM public.user_roles ur
    WHERE ur.business_id = p_business_id
      AND ur.role_key = v_role_key
    LIMIT 1;
  END IF;

  IF v_role_id IS NULL THEN
    SELECT ur.id, public.normalize_rbac_role_key(bu.role)
      INTO v_role_id, v_role_key
    FROM public.business_users bu
    LEFT JOIN public.user_roles ur
      ON ur.business_id = bu.business_id
     AND ur.role_key = public.normalize_rbac_role_key(bu.role)
    WHERE bu.business_id = p_business_id
      AND bu.user_id = v_uid
      AND COALESCE(bu.status, 'active') = 'active'
    LIMIT 1;
  END IF;

  IF v_role_key = 'super_admin' THEN
    RETURN TRUE;
  END IF;

  -- Never allow salesmen or cashiers to access Admin Settings or User Management
  IF v_role_key IN ('salesman', 'cashier') AND p_module_key IN ('application_settings', 'user_management') THEN
    RETURN FALSE;
  END IF;

  IF v_role_id IS NOT NULL THEN
    SELECT CASE p_action
      WHEN 'view' THEN rp.can_view
      WHEN 'create' THEN rp.can_create
      WHEN 'edit' THEN rp.can_edit
      WHEN 'delete' THEN rp.can_delete
      WHEN 'print' THEN rp.can_print
      WHEN 'export' THEN rp.can_export
      ELSE FALSE
    END
    INTO v_allowed
    FROM public.role_permissions rp
    WHERE rp.role_id = v_role_id
      AND rp.permission_key = p_module_key
    LIMIT 1;

    IF v_allowed IS NOT NULL THEN
      RETURN v_allowed;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

-- Branch helpers: NEVER query public.branches!
CREATE OR REPLACE FUNCTION public.can_access_business_branch(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_business_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.is_active_staff_member(p_business_id) THEN
    RETURN TRUE;
  END IF;

  -- Allow creator during initial setup window before membership row is read back
  RETURN EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.id = p_business_id
      AND b.created_by = v_uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_business_branch(
  p_business_id UUID,
  p_allow_initial_setup BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_business_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.is_business_owner_or_admin(p_business_id) THEN
    RETURN TRUE;
  END IF;

  IF public.has_module_permission(p_business_id, 'application_settings', 'edit')
     OR (p_allow_initial_setup AND public.has_module_permission(p_business_id, 'application_settings', 'create')) THEN
    RETURN TRUE;
  END IF;

  -- Allow initial creator of the business to insert its primary branch
  -- without ever querying public.branches
  IF p_allow_initial_setup THEN
    IF EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = p_business_id
        AND b.created_by = v_uid
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_insert_business_membership(
  p_business_id UUID,
  p_target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_business_id IS NULL OR p_target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Existing owners/admins or user managers can add staff to their business
  IF public.is_business_owner_or_admin(p_business_id)
     OR public.has_module_permission(p_business_id, 'user_management', 'create') THEN
    RETURN TRUE;
  END IF;

  -- Self-registration as initial owner is ONLY allowed when the authenticated
  -- user created the business or the business has no members yet
  IF p_target_user_id = v_uid THEN
    IF EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = p_business_id
        AND (
          b.created_by = v_uid
          OR NOT EXISTS (
            SELECT 1
            FROM public.business_users bu
            WHERE bu.business_id = p_business_id
          )
        )
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_user_profile(p_target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF p_target_user_id = v_uid THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.business_users target_bu
    JOIN public.business_users actor_bu
      ON actor_bu.business_id = target_bu.business_id
    WHERE target_bu.user_id = p_target_user_id
      AND actor_bu.user_id = v_uid
      AND COALESCE(actor_bu.status, 'active') = 'active'
      AND public.normalize_rbac_role_key(actor_bu.role) = 'super_admin'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_active_staff_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_staff_member(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.is_business_owner_or_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_business_owner_or_admin(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.has_module_permission(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_module_permission(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.can_access_business_branch(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_business_branch(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.can_manage_business_branch(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_business_branch(UUID, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.can_insert_business_membership(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_insert_business_membership(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.can_manage_user_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_user_profile(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Sweep & Recreate ALL Policies on Core, Branch, Membership & RBAC Tables
--    Guarantees zero leftover recursive policies remain on any related table.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'user_profiles',
        'businesses',
        'business_users',
        'branches',
        'user_roles',
        'role_permissions',
        'employees',
        'user_activity_logs',
        'accounts'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- user_profiles
CREATE POLICY "user_profiles_select" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (TRUE);

CREATE POLICY "user_profiles_insert" ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_user_profile(id));

CREATE POLICY "user_profiles_update" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (public.can_manage_user_profile(id))
  WITH CHECK (public.can_manage_user_profile(id));

CREATE POLICY "user_profiles_delete" ON public.user_profiles
  FOR DELETE TO authenticated
  USING (public.can_manage_user_profile(id));

-- businesses
CREATE POLICY "businesses_select" ON public.businesses
  FOR SELECT TO authenticated
  USING (
    public.is_active_staff_member(id)
    OR created_by = auth.uid()
  );

CREATE POLICY "businesses_insert" ON public.businesses
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (created_by IS NULL OR created_by = auth.uid())
  );

CREATE POLICY "businesses_update" ON public.businesses
  FOR UPDATE TO authenticated
  USING (
    public.is_business_owner_or_admin(id)
    OR public.has_module_permission(id, 'application_settings', 'edit')
  )
  WITH CHECK (
    public.is_business_owner_or_admin(id)
    OR public.has_module_permission(id, 'application_settings', 'edit')
  );

CREATE POLICY "businesses_delete" ON public.businesses
  FOR DELETE TO authenticated
  USING (public.is_business_owner_or_admin(id));

-- business_users
CREATE POLICY "business_users_select" ON public.business_users
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_active_staff_member(business_id)
  );

CREATE POLICY "business_users_insert" ON public.business_users
  FOR INSERT TO authenticated
  WITH CHECK (public.can_insert_business_membership(business_id, user_id));

CREATE POLICY "business_users_update" ON public.business_users
  FOR UPDATE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'edit')
  )
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'edit')
  );

CREATE POLICY "business_users_delete" ON public.business_users
  FOR DELETE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'delete')
  );

-- branches (explicit per-command, non-recursive)
CREATE POLICY "branches_select" ON public.branches
  FOR SELECT TO authenticated
  USING (public.can_access_business_branch(business_id));

CREATE POLICY "branches_insert" ON public.branches
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_business_branch(business_id, TRUE));

CREATE POLICY "branches_update" ON public.branches
  FOR UPDATE TO authenticated
  USING (public.can_manage_business_branch(business_id, FALSE))
  WITH CHECK (public.can_manage_business_branch(business_id, FALSE));

CREATE POLICY "branches_delete" ON public.branches
  FOR DELETE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'application_settings', 'delete')
  );

-- user_roles (explicit per-command, replaces FOR ALL)
CREATE POLICY "user_roles_select" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.is_active_staff_member(business_id));

CREATE POLICY "user_roles_insert" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'create')
  );

CREATE POLICY "user_roles_update" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'edit')
  )
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'edit')
  );

CREATE POLICY "user_roles_delete" ON public.user_roles
  FOR DELETE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'delete')
  );

-- role_permissions (explicit per-command, replaces FOR ALL)
CREATE POLICY "role_permissions_select" ON public.role_permissions
  FOR SELECT TO authenticated
  USING (public.is_active_staff_member(business_id));

CREATE POLICY "role_permissions_insert" ON public.role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'edit')
  );

CREATE POLICY "role_permissions_update" ON public.role_permissions
  FOR UPDATE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'edit')
  )
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'edit')
  );

CREATE POLICY "role_permissions_delete" ON public.role_permissions
  FOR DELETE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'delete')
  );

-- employees
CREATE POLICY "employees_select" ON public.employees
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'view')
  );

CREATE POLICY "employees_insert" ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'create')
  );

CREATE POLICY "employees_update" ON public.employees
  FOR UPDATE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'edit')
  )
  WITH CHECK (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'edit')
  );

CREATE POLICY "employees_delete" ON public.employees
  FOR DELETE TO authenticated
  USING (
    public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'delete')
  );

-- user_activity_logs (immutable append-only: no UPDATE or DELETE)
CREATE POLICY "activity_logs_select" ON public.user_activity_logs
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_business_owner_or_admin(business_id)
    OR public.has_module_permission(business_id, 'user_management', 'view')
  );

CREATE POLICY "activity_logs_insert" ON public.user_activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_staff_member(business_id)
    OR user_id = auth.uid()
  );

-- accounts
CREATE POLICY "accounts_biz_select" ON public.accounts
  FOR SELECT TO authenticated
  USING (public.is_active_staff_member(business_id));

CREATE POLICY "accounts_biz_insert" ON public.accounts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_staff_member(business_id)
    OR public.is_business_owner_or_admin(business_id)
  );

CREATE POLICY "accounts_biz_update" ON public.accounts
  FOR UPDATE TO authenticated
  USING (public.is_active_staff_member(business_id))
  WITH CHECK (public.is_active_staff_member(business_id));

CREATE POLICY "accounts_rbac_delete" ON public.accounts
  FOR DELETE TO authenticated
  USING (public.has_module_permission(business_id, 'accounts_transactions', 'delete'));

-- ----------------------------------------------------------------------------
-- 5. Atomic Transactional First-Time Business Setup RPC
--    Creates/updates user_profiles, businesses, business_users, branches, and
--    initial accounts in a single ACID transaction with strict caller checks.
-- ----------------------------------------------------------------------------
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
  p_initial_accounts JSONB DEFAULT '[]'::jsonb
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
  v_clean_fy TEXT := COALESCE(NULLIF(BTRIM(COALESCE(p_financial_year, '')), ''), TO_CHAR(NOW(), 'YYYY') || '-' || (EXTRACT(YEAR FROM NOW())::INT + 1)::TEXT);
  v_biz_id UUID := p_business_id;
  v_biz RECORD;
  v_branch RECORD;
  v_acc_item JSONB;
  v_acc_name TEXT;
  v_acc_type TEXT;
  v_acc_num TEXT;
  v_acc_bal NUMERIC(14,2);
  v_accounts_json JSONB := '[]'::jsonb;
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

  -- Prevent blocked/inactive or non-owner staff accounts from running business setup
  IF EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.user_id = v_uid
      AND e.account_status IN ('inactive', 'suspended', 'blocked')
  ) OR EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.user_id = v_uid
      AND COALESCE(bu.status, 'active') IN ('inactive', 'suspended', 'blocked')
  ) THEN
    RAISE EXCEPTION 'Your account is currently suspended or inactive. Please contact the Store Owner.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.user_id = v_uid
      AND e.account_status = 'active'
      AND public.normalize_rbac_role_key(COALESCE(e.role_key, e.role)) <> 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only Store Owners or Administrators can run First-Time Business Setup.';
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

  -- Step 2: Resolve or create business owned by v_uid
  IF v_biz_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = v_biz_id
        AND (
          b.created_by = v_uid
          OR public.is_business_owner_or_admin(b.id)
          OR NOT EXISTS (
            SELECT 1 FROM public.business_users bu WHERE bu.business_id = b.id
          )
        )
    ) THEN
      RAISE EXCEPTION 'Permission denied: target business does not belong to the authenticated owner.';
    END IF;
  ELSE
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
      name,
      owner_name,
      tagline,
      business_type,
      phone,
      email,
      address,
      currency,
      financial_year,
      vat_tax_rate,
      vat_registration_no,
      language,
      is_active,
      created_by,
      updated_at
    ) VALUES (
      v_clean_shop_name,
      v_clean_owner_name,
      '',
      COALESCE(NULLIF(BTRIM(p_business_type), ''), 'general'),
      v_clean_phone,
      COALESCE(v_clean_email, NULLIF(LOWER(BTRIM(v_auth_email)), '')),
      v_clean_address,
      v_clean_currency,
      v_clean_fy,
      COALESCE(p_vat_tax_rate, 0),
      NULLIF(BTRIM(COALESCE(p_vat_registration_no, '')), ''),
      'en',
      TRUE,
      v_uid,
      NOW()
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
    INSERT INTO public.branches (
      business_id,
      name,
      location,
      mobile,
      is_main,
      updated_at
    ) VALUES (
      v_biz_id,
      v_clean_branch_name,
      v_clean_address,
      v_clean_phone,
      TRUE,
      NOW()
    )
    RETURNING * INTO v_branch;
  END IF;

  -- Step 5: Link primary branch to owner membership
  UPDATE public.business_users
  SET branch_id = v_branch.id,
      updated_at = NOW()
  WHERE business_id = v_biz_id
    AND user_id = v_uid;

  -- Step 6: Create initial payment accounts (skip duplicates on retry)
  IF p_initial_accounts IS NOT NULL AND jsonb_typeof(p_initial_accounts) = 'array' THEN
    FOR v_acc_item IN SELECT * FROM jsonb_array_elements(p_initial_accounts)
    LOOP
      v_acc_name := BTRIM(COALESCE(v_acc_item->>'name', ''));
      IF v_acc_name = '' THEN
        CONTINUE;
      END IF;

      v_acc_type := COALESCE(NULLIF(BTRIM(COALESCE(v_acc_item->>'accountType', v_acc_item->>'account_type', '')), ''), 'cash');
      v_acc_num := NULLIF(BTRIM(COALESCE(v_acc_item->>'accountNumber', v_acc_item->>'account_number', '')), '');
      v_acc_bal := COALESCE((COALESCE(v_acc_item->>'openingBalance', v_acc_item->>'balance', '0'))::NUMERIC, 0);

      IF NOT EXISTS (
        SELECT 1
        FROM public.accounts a
        WHERE a.business_id = v_biz_id
          AND LOWER(BTRIM(a.name)) = LOWER(v_acc_name)
          AND a.account_type = v_acc_type
      ) THEN
        INSERT INTO public.accounts (
          business_id,
          name,
          account_type,
          account_number,
          balance,
          is_active,
          updated_at
        ) VALUES (
          v_biz_id,
          v_acc_name,
          v_acc_type,
          v_acc_num,
          v_acc_bal,
          TRUE,
          NOW()
        );
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at ASC), '[]'::jsonb)
    INTO v_accounts_json
  FROM public.accounts a
  WHERE a.business_id = v_biz_id;

  RETURN jsonb_build_object(
    'business', to_jsonb(v_biz),
    'branch', to_jsonb(v_branch),
    'accounts', v_accounts_json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_first_time_business_setup(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_first_time_business_setup(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB
) TO authenticated;
