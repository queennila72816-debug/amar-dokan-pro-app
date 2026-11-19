-- ============================================================================
-- Amar Dokan Pro: Employee Auth Sync, Atomic Provisioning & Login Lookup
-- Run AFTER 20261114_core_schema.sql, 20261115_rbac_staff_management.sql,
-- 20261118_transactional_rpcs_and_rls.sql, and 20261119_fix_branches_rls_recursion.sql
--
-- Fixes:
-- 1. Provides an anon-safe SECURITY DEFINER RPC `resolve_staff_login_email`
--    so staff (Salesman, Accountant, Manager, Inventory Manager, Cashier, custom)
--    can sign in using Username, Employee ID (EMP-001), or Email before auth.
-- 2. Provides an atomic SECURITY DEFINER RPC `create_employee_account_synced`
--    that verifies `p_user_id` exists in `auth.users(id)` before linking
--    `user_profiles`, `business_users`, and `employees` in a single transaction.
-- 3. Hardens `has_module_permission` so employees with `role_id IS NULL`
--    still resolve their assigned `role_key` from `public.user_roles`.
-- 4. Preserves all existing employees, users, salaries, transactions, and RLS.
-- ============================================================================

-- 1. Anon-safe staff login identifier resolution (Email, Username, or Employee ID)
CREATE OR REPLACE FUNCTION public.resolve_staff_login_email(p_identifier TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_raw TEXT := BTRIM(COALESCE(p_identifier, ''));
  v_lower TEXT;
  v_code TEXT;
  v_email TEXT;
BEGIN
  IF v_raw = '' THEN
    RETURN NULL;
  END IF;

  v_lower := LOWER(REPLACE(v_raw, ' ', '_'));
  v_code := UPPER(v_raw);

  -- Direct email lookup (prefer matching auth.users email for exact signInWithPassword match)
  IF POSITION('@' IN v_raw) > 0 THEN
    SELECT au.email
      INTO v_email
    FROM auth.users au
    WHERE LOWER(COALESCE(au.email, '')) = LOWER(v_raw)
    LIMIT 1;

    IF v_email IS NOT NULL AND BTRIM(v_email) <> '' THEN
      RETURN v_email;
    END IF;

    RETURN LOWER(v_raw);
  END IF;

  -- Lookup by Employee Code (e.g. EMP-001) or username in employees
  SELECT COALESCE(NULLIF(BTRIM(au.email), ''), NULLIF(BTRIM(e.email), ''))
    INTO v_email
  FROM public.employees e
  LEFT JOIN auth.users au ON au.id = e.user_id
  WHERE UPPER(COALESCE(e.employee_code, '')) = v_code
     OR LOWER(COALESCE(e.username, '')) = v_lower
  ORDER BY (e.user_id IS NOT NULL) DESC, e.created_at DESC
  LIMIT 1;

  IF v_email IS NOT NULL AND BTRIM(v_email) <> '' THEN
    RETURN v_email;
  END IF;

  -- Lookup by username in user_profiles
  SELECT COALESCE(NULLIF(BTRIM(au.email), ''), NULLIF(BTRIM(up.email), ''))
    INTO v_email
  FROM public.user_profiles up
  LEFT JOIN auth.users au ON au.id = up.id
  WHERE LOWER(COALESCE(up.username, '')) = v_lower
  LIMIT 1;

  IF v_email IS NOT NULL AND BTRIM(v_email) <> '' THEN
    RETURN v_email;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_staff_login_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_staff_login_email(TEXT) TO anon, authenticated;

-- 2. Atomic Employee Account Linking RPC (verifies auth.users FK before inserting)
CREATE OR REPLACE FUNCTION public.create_employee_account_synced(
  p_business_id UUID,
  p_user_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_employee_code TEXT DEFAULT NULL,
  p_name TEXT DEFAULT '',
  p_username TEXT DEFAULT '',
  p_email TEXT DEFAULT '',
  p_mobile TEXT DEFAULT '',
  p_position TEXT DEFAULT 'Staff',
  p_role_id UUID DEFAULT NULL,
  p_role_key TEXT DEFAULT 'salesman',
  p_role TEXT DEFAULT 'salesman',
  p_salary NUMERIC DEFAULT 0,
  p_joining_date DATE DEFAULT CURRENT_DATE,
  p_account_status TEXT DEFAULT 'active'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_clean_username TEXT := LOWER(REGEXP_REPLACE(BTRIM(COALESCE(p_username, '')), '\s+', '_', 'g'));
  v_clean_code TEXT := NULLIF(UPPER(BTRIM(COALESCE(p_employee_code, ''))), '');
  v_clean_email TEXT := LOWER(BTRIM(COALESCE(p_email, '')));
  v_clean_name TEXT := BTRIM(COALESCE(p_name, ''));
  v_norm_role_key TEXT := public.normalize_rbac_role_key(COALESCE(NULLIF(BTRIM(p_role_key), ''), p_role, 'salesman'));
  v_legacy_role TEXT;
  v_resolved_branch_id UUID := NULL;
  v_resolved_role_id UUID := NULL;
  v_acc_status TEXT := LOWER(BTRIM(COALESCE(p_account_status, 'active')));
  v_bu_status TEXT;
  v_emp_status TEXT;
  v_emp RECORD;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to create an employee account.';
  END IF;

  IF p_business_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id) THEN
    RAISE EXCEPTION 'Invalid or missing active business_id.';
  END IF;

  IF NOT (
    public.is_business_owner_or_admin(p_business_id)
    OR public.has_module_permission(p_business_id, 'user_management', 'create')
  ) THEN
    RAISE EXCEPTION 'Permission denied: only authorized administrators can create employee accounts.';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing authentication user UUID (auth.users.id) for employee account.';
  END IF;

  -- Strictly verify the user UUID exists in auth.users before linking employees.user_id
  IF NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = p_user_id) THEN
    RAISE EXCEPTION 'Authentication user UUID (%) does not exist in auth.users. Ensure the Auth user is created and confirmed before saving the employee record.', p_user_id;
  END IF;

  IF v_clean_name = '' THEN
    RAISE EXCEPTION 'Employee full name is required.';
  END IF;

  IF v_acc_status NOT IN ('active', 'inactive', 'suspended', 'blocked') THEN
    v_acc_status := 'active';
  END IF;

  v_bu_status := CASE WHEN v_acc_status = 'active' THEN 'active' ELSE 'suspended' END;
  v_emp_status := CASE WHEN v_acc_status = 'active' THEN 'active' ELSE 'inactive' END;

  v_legacy_role := CASE v_norm_role_key
    WHEN 'super_admin' THEN 'owner'
    WHEN 'store_manager' THEN 'manager'
    WHEN 'inventory_manager' THEN 'storekeeper'
    WHEN 'accountant' THEN 'accountant'
    WHEN 'cashier' THEN 'cashier'
    WHEN 'salesman' THEN 'salesman'
    ELSE COALESCE(NULLIF(BTRIM(p_role), ''), v_norm_role_key)
  END;

  IF p_branch_id IS NOT NULL THEN
    SELECT br.id INTO v_resolved_branch_id
    FROM public.branches br
    WHERE br.id = p_branch_id AND br.business_id = p_business_id
    LIMIT 1;
  END IF;

  IF p_role_id IS NOT NULL THEN
    SELECT ur.id INTO v_resolved_role_id
    FROM public.user_roles ur
    WHERE ur.id = p_role_id AND ur.business_id = p_business_id
    LIMIT 1;
  END IF;

  IF v_resolved_role_id IS NULL THEN
    SELECT ur.id INTO v_resolved_role_id
    FROM public.user_roles ur
    WHERE ur.business_id = p_business_id
      AND ur.role_key = v_norm_role_key
    LIMIT 1;
  END IF;

  IF v_clean_username <> '' AND EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.business_id = p_business_id
      AND LOWER(COALESCE(e.username, '')) = v_clean_username
  ) THEN
    RAISE EXCEPTION 'Username "%" is already assigned to another employee in this business.', v_clean_username;
  END IF;

  IF v_clean_code IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.business_id = p_business_id
      AND UPPER(COALESCE(e.employee_code, '')) = v_clean_code
  ) THEN
    RAISE EXCEPTION 'Employee ID "%" already exists in this business.', v_clean_code;
  END IF;

  -- Step 1: Ensure user_profiles row exists for the real Auth user
  INSERT INTO public.user_profiles (id, email, full_name, username, mobile, updated_at)
  VALUES (
    p_user_id,
    v_clean_email,
    v_clean_name,
    NULLIF(v_clean_username, ''),
    NULLIF(BTRIM(COALESCE(p_mobile, '')), ''),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = CASE WHEN EXCLUDED.email <> '' THEN EXCLUDED.email ELSE public.user_profiles.email END,
    full_name = EXCLUDED.full_name,
    username = COALESCE(EXCLUDED.username, public.user_profiles.username),
    mobile = COALESCE(EXCLUDED.mobile, public.user_profiles.mobile),
    updated_at = NOW();

  -- Step 2: Ensure business_users membership row exists
  INSERT INTO public.business_users (business_id, user_id, branch_id, role, status, updated_at)
  VALUES (p_business_id, p_user_id, v_resolved_branch_id, v_legacy_role, v_bu_status, NOW())
  ON CONFLICT (business_id, user_id) DO UPDATE SET
    branch_id = COALESCE(EXCLUDED.branch_id, public.business_users.branch_id),
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    updated_at = NOW();

  -- Step 3: Insert employees record linked to the real auth.users.id
  INSERT INTO public.employees (
    business_id,
    branch_id,
    user_id,
    employee_code,
    name,
    username,
    email,
    mobile,
    position,
    role,
    role_id,
    role_key,
    salary,
    joining_date,
    status,
    account_status,
    created_by,
    updated_at
  ) VALUES (
    p_business_id,
    v_resolved_branch_id,
    p_user_id,
    v_clean_code,
    v_clean_name,
    NULLIF(v_clean_username, ''),
    NULLIF(v_clean_email, ''),
    COALESCE(BTRIM(p_mobile), ''),
    COALESCE(NULLIF(BTRIM(p_position), ''), v_norm_role_key),
    v_legacy_role,
    v_resolved_role_id,
    v_norm_role_key,
    COALESCE(p_salary, 0),
    COALESCE(p_joining_date, CURRENT_DATE),
    v_emp_status,
    v_acc_status,
    v_actor_id,
    NOW()
  )
  RETURNING * INTO v_emp;

  RETURN to_jsonb(v_emp);
END;
$$;

REVOKE ALL ON FUNCTION public.create_employee_account_synced(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, NUMERIC, DATE, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_employee_account_synced(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, NUMERIC, DATE, TEXT
) TO authenticated;

-- 3. Strengthen has_module_permission fallback when employee.role_id is NULL
CREATE OR REPLACE FUNCTION public.has_module_permission(
  p_business_id UUID,
  p_module_key TEXT,
  p_action TEXT DEFAULT 'view'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id UUID;
  v_role_key TEXT;
  v_allowed BOOLEAN := FALSE;
BEGIN
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
    AND e.user_id = auth.uid()
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
      AND bu.user_id = auth.uid()
      AND COALESCE(bu.status, 'active') = 'active'
    LIMIT 1;
  END IF;

  IF v_role_key = 'super_admin' THEN
    RETURN TRUE;
  END IF;

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
