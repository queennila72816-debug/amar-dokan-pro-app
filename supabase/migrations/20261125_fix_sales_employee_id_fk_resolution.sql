-- =============================================================================
-- Safe Non-Destructive Fix: POS Sales Employee Foreign Key Resolution
-- =============================================================================
-- Root cause:
--   public.sales.employee_id references public.employees(id) (nullable, ON DELETE SET NULL).
--   Previously, when a Store Owner / Super Admin or user without an employees row
--   checked out at POS, the client passed auth.users.id as employee_id, violating
--   foreign key constraint "sales_employee_id_fkey".
--
-- Fix:
--   1. Preserve sales_employee_id_fkey and all existing sales/employees data.
--   2. In enforce_sale_employee_tracking() (BEFORE INSERT ON public.sales), validate
--      that any provided NEW.employee_id actually exists in public.employees for
--      NEW.business_id; otherwise clear it to NULL and resolve the authenticated
--      user's matching employee record from public.employees(business_id, user_id).
--   3. If the user is a Store Owner / Super Admin / authorized member with no
--      employees row in that business, keep NEW.employee_id = NULL while still
--      recording seller_id = auth.uid(), seller_name, employee_name, and served_by.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_sale_employee_tracking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp RECORD;
  v_profile RECORD;
  v_validated_emp RECORD;
BEGIN
  IF NEW.business_id IS NOT NULL THEN
    IF auth.uid() IS NOT NULL AND NOT public.has_module_permission(NEW.business_id, 'pos_new_sale', 'create') THEN
      RAISE EXCEPTION 'Permission denied: user lacks POS / New Sale create permission';
    END IF;

    -- Verify any explicitly provided employee_id actually belongs to NEW.business_id
    IF NEW.employee_id IS NOT NULL THEN
      SELECT id, employee_code, name
        INTO v_validated_emp
      FROM public.employees
      WHERE id = NEW.employee_id
        AND business_id = NEW.business_id
      LIMIT 1;

      IF v_validated_emp.id IS NULL THEN
        -- Reject invalid / cross-tenant / auth-user UUIDs before FK check
        NEW.employee_id := NULL;
      ELSE
        NEW.employee_code := COALESCE(NEW.employee_code, v_validated_emp.employee_code);
        NEW.employee_name := COALESCE(NEW.employee_name, v_validated_emp.name);
      END IF;
    END IF;

    IF auth.uid() IS NOT NULL THEN
      SELECT id, employee_code, name
        INTO v_emp
      FROM public.employees
      WHERE business_id = NEW.business_id
        AND user_id = auth.uid()
      ORDER BY (COALESCE(account_status, status, 'active') = 'active') DESC, created_at DESC
      LIMIT 1;

      IF v_emp.id IS NOT NULL THEN
        NEW.employee_id := COALESCE(NEW.employee_id, v_emp.id);
        NEW.employee_code := COALESCE(NEW.employee_code, v_emp.employee_code);
        NEW.employee_name := COALESCE(NEW.employee_name, v_emp.name);
        NEW.seller_id := COALESCE(NEW.seller_id, auth.uid());
        NEW.seller_name := COALESCE(NEW.seller_name, v_emp.name);
        NEW.served_by := COALESCE(NEW.served_by, v_emp.name);
      ELSE
        SELECT full_name INTO v_profile FROM public.user_profiles WHERE id = auth.uid();
        NEW.seller_id := COALESCE(NEW.seller_id, auth.uid());
        NEW.seller_name := COALESCE(NEW.seller_name, v_profile.full_name, 'Admin');
        NEW.employee_name := COALESCE(NEW.employee_name, v_profile.full_name, NEW.served_by, 'Admin');
        NEW.served_by := COALESCE(NEW.served_by, v_profile.full_name, 'Admin');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sale_employee_tracking ON public.sales;
CREATE TRIGGER trg_enforce_sale_employee_tracking
  BEFORE INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sale_employee_tracking();
