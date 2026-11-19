-- ============================================================================
-- Amar Dokan Pro: Permanent Fix for Infinite Recursion in Branches RLS Policies
-- Idempotent & Data-Safe Migration (preserves all existing data & RLS security)
-- ============================================================================

-- 1. Secure SECURITY DEFINER helper functions (fixed search_path, zero recursion)
CREATE OR REPLACE FUNCTION public.can_access_business_branch(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_business_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN public.is_active_staff_member(p_business_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_business_branch(
  p_business_id UUID,
  p_allow_initial_setup BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_is_active_member BOOLEAN := FALSE;
  v_has_branches BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL OR p_business_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Store owners / super admins can always manage branches in their business
  IF public.is_business_owner_or_admin(p_business_id) THEN
    RETURN TRUE;
  END IF;

  -- Active staff with Application Settings edit permission can manage branches
  IF public.has_module_permission(p_business_id, 'application_settings', 'edit') THEN
    RETURN TRUE;
  END IF;

  -- During initial setup only, allow an active member of the business to create
  -- its first branch inside SECURITY DEFINER without triggering recursive RLS
  -- on public.branches.
  IF p_allow_initial_setup THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = p_business_id
        AND bu.user_id = v_uid
        AND COALESCE(bu.status, 'active') = 'active'
    ) INTO v_is_active_member;

    IF v_is_active_member THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.business_id = p_business_id
      ) INTO v_has_branches;

      IF NOT v_has_branches THEN
        RETURN TRUE;
      END IF;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_user_profile(p_target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
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

REVOKE ALL ON FUNCTION public.can_access_business_branch(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_business_branch(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.can_manage_business_branch(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_business_branch(UUID, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.can_manage_user_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_user_profile(UUID) TO authenticated;

-- 2. Drop ALL existing policies on public.branches (removes legacy/recursive "branches_manage" or stale policies)
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'branches'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.branches;', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

-- 3. Separate, explicit, non-recursive RLS policies for public.branches
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
  USING (public.is_business_owner_or_admin(business_id));

-- 4. Verify & harden user_profiles policies without circular dependencies
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_profiles_select" ON public.user_profiles;
CREATE POLICY "user_profiles_select" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "user_profiles_upsert_own" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_insert" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_update" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_delete" ON public.user_profiles;

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
