-- ============================================================================
-- Amar Dokan Pro: User Management, Granular RBAC & Backend RLS Migration
-- Tables: user_roles, permissions, role_permissions, employees, user_activity_logs
-- Plus backend permission helpers, sales employee-tracking trigger & RLS policies
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Permissions Master Catalog Table (19 Core Business Modules)
CREATE TABLE IF NOT EXISTS public.permissions (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.permissions (key, name, category, description, sort_order) VALUES
  ('dashboard', 'Dashboard', 'Core Operations', 'Overview metrics, KPIs & live store summary', 1),
  ('pos_new_sale', 'POS / New Sale', 'Core Operations', 'Point of sale billing, cart & checkout', 2),
  ('sales_history', 'Sales History', 'Core Operations', 'View invoices, process refunds/voids & delete sales', 3),
  ('purchase_management', 'Purchase Management', 'Inventory & Supply', 'Supplier purchase orders & landed cost entries', 4),
  ('product_management', 'Product Management', 'Inventory & Supply', 'Manage products, variants, SKUs & pricing', 5),
  ('stock_management', 'Stock Management', 'Inventory & Supply', 'Stock adjustments, transfers & reorder alerts', 6),
  ('customer_management', 'Customer Management', 'Parties & CRM', 'Manage customers & credit limits', 7),
  ('supplier_management', 'Supplier Management', 'Parties & CRM', 'Manage suppliers & vendor balances', 8),
  ('expense_management', 'Expense Management', 'Finance & Accounting', 'Record and manage operational expenses', 9),
  ('cash_management', 'Cash Management', 'Finance & Accounting', 'Cash drawers, cash-in-hand balances & transfers', 10),
  ('bank_management', 'Bank Management', 'Finance & Accounting', 'Bank & mobile banking accounts (bKash/Nagad)', 11),
  ('due_collection', 'Due Collection', 'Finance & Accounting', 'Collect customer dues & pay supplier dues', 12),
  ('accounts_transactions', 'Accounts & Transactions', 'Finance & Accounting', 'Financial account ledger & money transfers', 13),
  ('profit_loss_reports', 'Profit & Loss Reports', 'Reports & Printing', 'Net profit, COGS & margin analytics', 14),
  ('sales_reports', 'Sales Reports', 'Reports & Printing', 'Sales volume, salesman & item-wise reports', 15),
  ('invoice_printing', 'Invoice Printing', 'Reports & Printing', 'Print thermal/A4/A5 sales invoices & PDFs', 16),
  ('barcode_label_printing', 'Barcode & Label Printing', 'Reports & Printing', 'Print barcode tags & price label sheets', 17),
  ('user_management', 'User Management', 'Administration', 'Staff accounts, roles, permissions & audit logs', 18),
  ('application_settings', 'Application Settings', 'Administration', 'Shop settings, VAT, backups & printer defaults', 19)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order;

-- 2. User Roles Table (6 System Default Roles + Custom Roles per Business)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, role_key)
);

-- 3. Role Permissions Matrix Table (View, Create, Edit, Delete, Print, Export)
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.user_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  can_view BOOLEAN NOT NULL DEFAULT FALSE,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  can_print BOOLEAN NOT NULL DEFAULT FALSE,
  can_export BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role_id, permission_key)
);

-- 4. Employees Table (Shared Multi-User Staff Directory & Account Status)
CREATE TABLE IF NOT EXISTS public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_code TEXT,
  name TEXT NOT NULL,
  username TEXT,
  email TEXT,
  mobile TEXT,
  position TEXT NOT NULL DEFAULT 'Staff',
  role TEXT NOT NULL DEFAULT 'salesman',
  role_id UUID REFERENCES public.user_roles(id) ON DELETE SET NULL,
  role_key TEXT NOT NULL DEFAULT 'salesman',
  salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  joining_date DATE DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'active',
  account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'inactive', 'suspended', 'blocked')),
  last_login_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safely ensure columns exist if employees table was created by an earlier migration
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employee_code TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES public.user_roles(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS role_key TEXT NOT NULL DEFAULT 'salesman';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_employees_business_id ON public.employees(business_id);
CREATE INDEX IF NOT EXISTS idx_employees_user_id ON public.employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_username ON public.employees(business_id, username);
CREATE INDEX IF NOT EXISTS idx_employees_code ON public.employees(business_id, employee_code);

-- 5. Immutable User Activity & Login History Logs
CREATE TABLE IF NOT EXISTS public.user_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  employee_code TEXT,
  employee_name TEXT NOT NULL,
  role_key TEXT NOT NULL,
  role_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  module_key TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_business_created ON public.user_activity_logs(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_employee ON public.user_activity_logs(employee_id, created_at DESC);

-- 6. Extend sales table with strict employee tracking columns
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS employee_code TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS employee_name TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_employee_id ON public.sales(business_id, employee_id);

-- ============================================================================
-- SECURITY HELPER FUNCTIONS (BACKEND ENFORCEMENT)
-- ============================================================================

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

CREATE OR REPLACE FUNCTION public.is_business_owner_or_admin(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND COALESCE(bu.status, 'active') = 'active'
      AND public.normalize_rbac_role_key(bu.role) = 'super_admin'
  ) OR EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.business_id = p_business_id
      AND e.user_id = auth.uid()
      AND e.account_status = 'active'
      AND public.normalize_rbac_role_key(COALESCE(e.role_key, e.role)) = 'super_admin'
  ) INTO v_is_admin;

  RETURN v_is_admin;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_active_staff_member(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocked BOOLEAN := FALSE;
  v_member BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Explicitly block inactive, suspended, or blocked employees
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.business_id = p_business_id
      AND e.user_id = auth.uid()
      AND e.account_status IN ('inactive', 'suspended', 'blocked')
  ) OR EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND COALESCE(bu.status, 'active') IN ('inactive', 'suspended', 'blocked')
  ) INTO v_blocked;

  IF v_blocked THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND COALESCE(bu.status, 'active') = 'active'
  ) OR EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.business_id = p_business_id
      AND e.user_id = auth.uid()
      AND e.account_status = 'active'
  ) INTO v_member;

  RETURN v_member;
END;
$$;

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

-- Trigger: Automatically enforce sales permission and record employee metadata on every sale
CREATE OR REPLACE FUNCTION public.enforce_sale_employee_tracking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp RECORD;
  v_profile RECORD;
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.business_id IS NOT NULL THEN
    IF NOT public.has_module_permission(NEW.business_id, 'pos_new_sale', 'create') THEN
      RAISE EXCEPTION 'Permission denied: user lacks POS / New Sale create permission';
    END IF;

    SELECT id, employee_code, name
      INTO v_emp
    FROM public.employees
    WHERE business_id = NEW.business_id
      AND user_id = auth.uid()
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

-- Login helper RPC: returns user's active role, status & resolved permissions (blocks inactive/suspended/blocked accounts)
CREATE OR REPLACE FUNCTION public.get_my_rbac_context()
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

  SELECT * INTO v_emp
  FROM public.employees
  WHERE user_id = v_uid
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT * INTO v_bu
  FROM public.business_users
  WHERE user_id = v_uid
  ORDER BY created_at DESC
  LIMIT 1;

  v_biz_id := COALESCE(v_emp.business_id, v_bu.business_id);
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
    'account_status', v_status
  );
END;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

-- Permissions catalog is readable by authenticated users
DROP POLICY IF EXISTS "permissions_read_all" ON public.permissions;
CREATE POLICY "permissions_read_all" ON public.permissions
  FOR SELECT TO authenticated USING (TRUE);

-- user_roles policies
DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
CREATE POLICY "user_roles_select" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.is_active_staff_member(business_id));

DROP POLICY IF EXISTS "user_roles_admin_manage" ON public.user_roles;
CREATE POLICY "user_roles_admin_manage" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_module_permission(business_id, 'user_management', 'edit') OR public.is_business_owner_or_admin(business_id))
  WITH CHECK (public.has_module_permission(business_id, 'user_management', 'create') OR public.is_business_owner_or_admin(business_id));

-- role_permissions policies
DROP POLICY IF EXISTS "role_permissions_select" ON public.role_permissions;
CREATE POLICY "role_permissions_select" ON public.role_permissions
  FOR SELECT TO authenticated
  USING (public.is_active_staff_member(business_id));

DROP POLICY IF EXISTS "role_permissions_admin_manage" ON public.role_permissions;
CREATE POLICY "role_permissions_admin_manage" ON public.role_permissions
  FOR ALL TO authenticated
  USING (public.has_module_permission(business_id, 'user_management', 'edit') OR public.is_business_owner_or_admin(business_id))
  WITH CHECK (public.has_module_permission(business_id, 'user_management', 'edit') OR public.is_business_owner_or_admin(business_id));

-- employees policies (Staff can view own row; Admin/User Managers manage all)
DROP POLICY IF EXISTS "employees_select" ON public.employees;
CREATE POLICY "employees_select" ON public.employees
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_module_permission(business_id, 'user_management', 'view')
    OR public.is_business_owner_or_admin(business_id)
  );

DROP POLICY IF EXISTS "employees_insert" ON public.employees;
CREATE POLICY "employees_insert" ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_permission(business_id, 'user_management', 'create')
    OR public.is_business_owner_or_admin(business_id)
  );

DROP POLICY IF EXISTS "employees_update" ON public.employees;
CREATE POLICY "employees_update" ON public.employees
  FOR UPDATE TO authenticated
  USING (
    public.has_module_permission(business_id, 'user_management', 'edit')
    OR public.is_business_owner_or_admin(business_id)
  )
  WITH CHECK (
    public.has_module_permission(business_id, 'user_management', 'edit')
    OR public.is_business_owner_or_admin(business_id)
  );

DROP POLICY IF EXISTS "employees_delete" ON public.employees;
CREATE POLICY "employees_delete" ON public.employees
  FOR DELETE TO authenticated
  USING (
    public.has_module_permission(business_id, 'user_management', 'delete')
    OR public.is_business_owner_or_admin(business_id)
  );

-- user_activity_logs policies: IMMUTABLE APPEND-ONLY (No UPDATE or DELETE allowed)
DROP POLICY IF EXISTS "activity_logs_select" ON public.user_activity_logs;
CREATE POLICY "activity_logs_select" ON public.user_activity_logs
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_module_permission(business_id, 'user_management', 'view')
    OR public.is_business_owner_or_admin(business_id)
  );

DROP POLICY IF EXISTS "activity_logs_insert" ON public.user_activity_logs;
CREATE POLICY "activity_logs_insert" ON public.user_activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_staff_member(business_id)
    OR user_id = auth.uid()
  );

-- Strict backend financial & settings RLS reinforcement
DROP POLICY IF EXISTS "sales_rbac_delete" ON public.sales;
CREATE POLICY "sales_rbac_delete" ON public.sales
  FOR DELETE TO authenticated
  USING (public.has_module_permission(business_id, 'sales_history', 'delete'));

DROP POLICY IF EXISTS "purchases_rbac_delete" ON public.purchases;
CREATE POLICY "purchases_rbac_delete" ON public.purchases
  FOR DELETE TO authenticated
  USING (public.has_module_permission(business_id, 'purchase_management', 'delete'));

DROP POLICY IF EXISTS "expenses_rbac_delete" ON public.expenses;
CREATE POLICY "expenses_rbac_delete" ON public.expenses
  FOR DELETE TO authenticated
  USING (public.has_module_permission(business_id, 'expense_management', 'delete'));

DROP POLICY IF EXISTS "accounts_rbac_delete" ON public.accounts;
CREATE POLICY "accounts_rbac_delete" ON public.accounts
  FOR DELETE TO authenticated
  USING (public.has_module_permission(business_id, 'accounts_transactions', 'delete'));

DROP POLICY IF EXISTS "businesses_settings_rbac_update" ON public.businesses;
CREATE POLICY "businesses_settings_rbac_update" ON public.businesses
  FOR UPDATE TO authenticated
  USING (public.has_module_permission(id, 'application_settings', 'edit') OR public.is_business_owner_or_admin(id))
  WITH CHECK (public.has_module_permission(id, 'application_settings', 'edit') OR public.is_business_owner_or_admin(id));
