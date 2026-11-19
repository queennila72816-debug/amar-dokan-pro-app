-- ============================================================================
-- Amar Dokan Pro: Audit & Safe Repair of Employee <-> auth.users Links
-- Run AFTER 20261114_core_schema.sql, 20261115_rbac_staff_management.sql,
-- 20261118_transactional_rpcs_and_rls.sql, 20261119_fix_branches_rls_recursion.sql,
-- and 20261120_employee_auth_sync_and_login_lookup.sql.
--
-- Security & Data Integrity Guarantees:
-- 1. NEVER disables foreign key constraints (employees_user_id_fkey stays active).
-- 2. NEVER disables or weakens RLS.
-- 3. NEVER deletes or overwrites employee salaries, roles, joining dates, or sales.
-- 4. NEVER links an employee to another person's or another business's Auth account.
-- 5. Provides audit + repair RPCs for Admin verification and one-click linking.
-- ============================================================================

-- 1. Admin-only audit RPC to inspect every employee's Auth link status
CREATE OR REPLACE FUNCTION public.audit_employee_auth_links(p_business_id UUID)
RETURNS TABLE (
  employee_id UUID,
  employee_code TEXT,
  name TEXT,
  username TEXT,
  email TEXT,
  role_key TEXT,
  user_id UUID,
  link_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_owner_or_admin(p_business_id) THEN
    RAISE EXCEPTION 'Permission denied: only Business Owners / Admins can audit employee Auth links.';
  END IF;

  RETURN QUERY
  SELECT
    e.id AS employee_id,
    e.employee_code,
    e.name,
    e.username,
    e.email,
    COALESCE(e.role_key, e.role) AS role_key,
    e.user_id,
    CASE
      WHEN e.user_id IS NULL THEN 'missing_auth_link'
      WHEN NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = e.user_id) THEN 'invalid_auth_uuid'
      WHEN NOT EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = e.business_id AND bu.user_id = e.user_id
      ) THEN 'missing_membership'
      ELSE 'linked_valid'
    END AS link_status
  FROM public.employees e
  WHERE e.business_id = p_business_id
  ORDER BY e.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_employee_auth_links(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_employee_auth_links(UUID) TO authenticated;

-- 2. Safe, deterministic repair RPC for existing employees whose Auth account already exists
CREATE OR REPLACE FUNCTION public.repair_existing_employee_auth_links(p_business_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_emp RECORD;
  v_matched_uid UUID;
  v_matched_email TEXT;
  v_legacy_role TEXT;
  v_norm_role TEXT;
  v_bu_status TEXT;
  v_repaired_count INT := 0;
  v_synced_count INT := 0;
  v_unlinked_count INT := 0;
  v_repaired_names TEXT[] := ARRAY[]::TEXT[];
  v_unlinked_names TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- If invoked via authenticated client/API, strictly enforce Business Owner/Admin role
  IF auth.uid() IS NOT NULL THEN
    IF p_business_id IS NULL OR NOT public.is_business_owner_or_admin(p_business_id) THEN
      RAISE EXCEPTION 'Permission denied: only Business Owners / Admins can repair employee Auth links.';
    END IF;
  END IF;

  FOR v_emp IN
    SELECT e.*
    FROM public.employees e
    WHERE (p_business_id IS NULL OR e.business_id = p_business_id)
    ORDER BY e.created_at ASC
  LOOP
    v_norm_role := public.normalize_rbac_role_key(COALESCE(NULLIF(BTRIM(v_emp.role_key), ''), v_emp.role, 'salesman'));
    v_legacy_role := CASE v_norm_role
      WHEN 'super_admin' THEN 'owner'
      WHEN 'store_manager' THEN 'manager'
      WHEN 'inventory_manager' THEN 'storekeeper'
      WHEN 'accountant' THEN 'accountant'
      WHEN 'cashier' THEN 'cashier'
      WHEN 'salesman' THEN 'salesman'
      ELSE COALESCE(NULLIF(BTRIM(v_emp.role), ''), v_norm_role)
    END;
    v_bu_status := CASE WHEN COALESCE(v_emp.account_status, v_emp.status, 'active') = 'active' THEN 'active' ELSE 'suspended' END;

    -- Case A: employee already has a valid auth.users UUID -> ensure profile & business_users stay synced
    IF v_emp.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = v_emp.user_id) THEN
      SELECT LOWER(BTRIM(au.email))
        INTO v_matched_email
      FROM auth.users au
      WHERE au.id = v_emp.user_id;

      IF COALESCE(BTRIM(v_emp.email), '') = '' AND v_matched_email IS NOT NULL THEN
        UPDATE public.employees
           SET email = v_matched_email,
               updated_at = NOW()
         WHERE id = v_emp.id;
      END IF;

      INSERT INTO public.user_profiles (id, email, full_name, username, mobile, updated_at)
      VALUES (
        v_emp.user_id,
        COALESCE(NULLIF(LOWER(BTRIM(v_emp.email)), ''), v_matched_email, ''),
        v_emp.name,
        NULLIF(LOWER(BTRIM(COALESCE(v_emp.username, ''))), ''),
        NULLIF(BTRIM(COALESCE(v_emp.mobile, '')), ''),
        NOW()
      )
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.business_users (business_id, user_id, branch_id, role, status, updated_at)
      VALUES (v_emp.business_id, v_emp.user_id, v_emp.branch_id, v_legacy_role, v_bu_status, NOW())
      ON CONFLICT (business_id, user_id) DO NOTHING;

      v_synced_count := v_synced_count + 1;
      CONTINUE;
    END IF;

    -- Case B: employee has NULL or stale/invalid user_id -> find strictly verified matching auth.users row
    v_matched_uid := NULL;
    v_matched_email := NULL;

    SELECT au.id, LOWER(BTRIM(au.email))
      INTO v_matched_uid, v_matched_email
    FROM auth.users au
    WHERE (
      -- Exact email match on the employee record
      (NULLIF(BTRIM(COALESCE(v_emp.email, '')), '') IS NOT NULL
        AND LOWER(BTRIM(au.email)) = LOWER(BTRIM(v_emp.email)))
      -- Exact username + business_id metadata match
      OR (NULLIF(BTRIM(COALESCE(v_emp.username, '')), '') IS NOT NULL
        AND LOWER(COALESCE(au.raw_user_meta_data->>'username', '')) = LOWER(BTRIM(v_emp.username))
        AND (
          au.raw_user_meta_data->>'business_id' IS NULL
          OR au.raw_user_meta_data->>'business_id' = v_emp.business_id::TEXT
        ))
      -- Exact employee_code + business_id metadata match
      OR (NULLIF(BTRIM(COALESCE(v_emp.employee_code, '')), '') IS NOT NULL
        AND UPPER(COALESCE(au.raw_user_meta_data->>'employee_code', '')) = UPPER(BTRIM(v_emp.employee_code))
        AND au.raw_user_meta_data->>'business_id' = v_emp.business_id::TEXT)
    )
    -- Strict Anti-Hijack Safety Guards:
    -- 1. Never link an Auth user already assigned to another employee row
    AND NOT EXISTS (
      SELECT 1 FROM public.employees e2
      WHERE e2.user_id = au.id
        AND e2.id <> v_emp.id
    )
    -- 2. Never link an Auth user belonging to a different business
    AND NOT EXISTS (
      SELECT 1 FROM public.business_users bu2
      WHERE bu2.user_id = au.id
        AND bu2.business_id <> v_emp.business_id
    )
    -- 3. Never link a non-admin employee to an owner/super_admin Auth user
    AND NOT EXISTS (
      SELECT 1 FROM public.business_users bu_adm
      WHERE bu_adm.user_id = au.id
        AND bu_adm.business_id = v_emp.business_id
        AND public.normalize_rbac_role_key(bu_adm.role) = 'super_admin'
        AND v_norm_role <> 'super_admin'
    )
    ORDER BY (au.raw_user_meta_data->>'business_id' = v_emp.business_id::TEXT) DESC, au.created_at ASC
    LIMIT 1;

    IF v_matched_uid IS NOT NULL THEN
      INSERT INTO public.user_profiles (id, email, full_name, username, mobile, updated_at)
      VALUES (
        v_matched_uid,
        COALESCE(NULLIF(LOWER(BTRIM(v_emp.email)), ''), v_matched_email, ''),
        v_emp.name,
        NULLIF(LOWER(BTRIM(COALESCE(v_emp.username, ''))), ''),
        NULLIF(BTRIM(COALESCE(v_emp.mobile, '')), ''),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        full_name = COALESCE(NULLIF(BTRIM(public.user_profiles.full_name), ''), EXCLUDED.full_name),
        username = COALESCE(NULLIF(BTRIM(public.user_profiles.username), ''), EXCLUDED.username),
        updated_at = NOW();

      INSERT INTO public.business_users (business_id, user_id, branch_id, role, status, updated_at)
      VALUES (v_emp.business_id, v_matched_uid, v_emp.branch_id, v_legacy_role, v_bu_status, NOW())
      ON CONFLICT (business_id, user_id) DO NOTHING;

      UPDATE public.employees
         SET user_id = v_matched_uid,
             email = COALESCE(NULLIF(BTRIM(email), ''), v_matched_email),
             updated_at = NOW()
       WHERE id = v_emp.id;

      v_repaired_count := v_repaired_count + 1;
      v_repaired_names := array_append(v_repaired_names, v_emp.name);
    ELSE
      -- Clear stale invalid UUID if it points to a deleted auth.users row so UI accurately flags it
      IF v_emp.user_id IS NOT NULL THEN
        UPDATE public.employees
           SET user_id = NULL,
               updated_at = NOW()
         WHERE id = v_emp.id;
      END IF;
      v_unlinked_count := v_unlinked_count + 1;
      v_unlinked_names := array_append(v_unlinked_names, v_emp.name);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'repaired_count', v_repaired_count,
    'synced_count', v_synced_count,
    'unlinked_remaining', v_unlinked_count,
    'repaired_employees', v_repaired_names,
    'unlinked_employees', v_unlinked_names
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_existing_employee_auth_links(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_existing_employee_auth_links(UUID) TO authenticated;

-- Execute safe non-destructive repair once across existing rows during migration
SELECT public.repair_existing_employee_auth_links(NULL);
