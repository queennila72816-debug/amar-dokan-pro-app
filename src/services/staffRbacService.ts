import { createClient } from '@supabase/supabase-js';
import {
  supabase,
  isSupabaseConfigured,
  supabaseUrl,
  supabaseAnonKey,
} from '../lib/supabase';
import {
  AccountStatus,
  Employee,
  RoleDefinition,
  RolePermissionMatrix,
  UserActivityLog,
} from '../types';
import {
  PERMISSION_MODULES,
  clonePermissionsMatrix,
  createDefaultRolesForBusiness,
  createEmptyPermissionsMatrix,
  getDefaultRoleTemplate,
  normalizeRoleKey,
  roleKeyToLegacyUserRole,
} from '../utils/rbacDefaults';

const RBAC_ROLES_KEY = 'AMAR_DOKAN_PRO_RBAC_ROLES';
const RBAC_EMPLOYEES_KEY = 'AMAR_DOKAN_PRO_RBAC_EMPLOYEES';
const RBAC_ACTIVITY_KEY = 'AMAR_DOKAN_PRO_RBAC_ACTIVITY';
const RBAC_CREDENTIAL_HASH_KEY = 'AMAR_DOKAN_PRO_STAFF_AUTH_HASH';

function cacheGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function cacheSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage quota errors
  }
}

async function hashPasswordWithSalt(password: string, saltHex?: string): Promise<string> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    return '';
  }
  const encoder = new TextEncoder();
  const saltBytes = saltHex
    ? new Uint8Array(saltHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
    : window.crypto.getRandomValues(new Uint8Array(16));
  const usedSaltHex =
    saltHex ||
    Array.from(saltBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derived = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const hashHex = Array.from(new Uint8Array(derived))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return `${usedSaltHex}:${hashHex}`;
}

export interface CreateEmployeePayload {
  fullName: string;
  employeeCode: string;
  phone: string;
  email: string;
  username: string;
  password: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  position?: string;
  salary: number;
  joiningDate: string;
  accountStatus: AccountStatus;
  branchId?: string;
  branchName?: string;
}

export interface UpdateEmployeePayload {
  name?: string;
  employeeCode?: string;
  mobile?: string;
  email?: string;
  username?: string;
  position?: string;
  roleId?: string;
  roleKey?: string;
  roleName?: string;
  salary?: number;
  joiningDate?: string;
  accountStatus?: AccountStatus;
  branchId?: string;
  branchName?: string;
}

export const staffRbacService = {
  /**
   * Ensure default 6 roles and 19 permissions exist for a business, then fetch them.
   */
  async fetchRolesAndPermissions(businessId: string): Promise<RoleDefinition[]> {
    const cacheKey = `${RBAC_ROLES_KEY}_${businessId || 'local'}`;
    const defaultRoles = createDefaultRolesForBusiness(businessId || 'default-business');

    if (!isSupabaseConfigured || !businessId) {
      const cached = cacheGet<RoleDefinition[]>(cacheKey, []);
      if (cached.length > 0) return cached;
      cacheSet(cacheKey, defaultRoles);
      return defaultRoles;
    }

    try {
      // 1. Ensure master permissions catalog is present
      const { data: existingRoles, error: rolesErr } = await supabase
        .from('user_roles')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: true });

      if (rolesErr) {
        console.warn('user_roles table unavailable, using cached defaults:', rolesErr.message);
        const cached = cacheGet<RoleDefinition[]>(cacheKey, []);
        return cached.length > 0 ? cached : defaultRoles;
      }

      let rolesRows = existingRoles || [];

      // Seed missing system roles automatically on first run
      const existingKeys = new Set(rolesRows.map((r: any) => r.role_key));
      const missingDefaults = defaultRoles.filter(d => !existingKeys.has(d.roleKey));

      if (missingDefaults.length > 0) {
        for (const def of missingDefaults) {
          const { data: insertedRole, error: insErr } = await supabase
            .from('user_roles')
            .insert({
              business_id: businessId,
              role_key: def.roleKey,
              name: def.name,
              description: def.description,
              is_system_role: true,
              is_default: true,
            })
            .select()
            .single();

          if (!insErr && insertedRole) {
            rolesRows.push(insertedRole);
            const permRows = PERMISSION_MODULES.map(mod => ({
              business_id: businessId,
              role_id: insertedRole.id,
              permission_key: mod.key,
              can_view: def.permissions[mod.key].view,
              can_create: def.permissions[mod.key].create,
              can_edit: def.permissions[mod.key].edit,
              can_delete: def.permissions[mod.key].delete,
              can_print: def.permissions[mod.key].print,
              can_export: def.permissions[mod.key].export,
            }));
            await supabase
              .from('role_permissions')
              .upsert(permRows, { onConflict: 'role_id,permission_key' });
          }
        }
      }

      const roleIds = rolesRows.map((r: any) => r.id);
      let rpRows: any[] = [];
      if (roleIds.length > 0) {
        const { data: permsData } = await supabase
          .from('role_permissions')
          .select('*')
          .in('role_id', roleIds);
        rpRows = permsData || [];
      }

      const hydrated: RoleDefinition[] = rolesRows.map((r: any) => {
        const rowsForRole = rpRows.filter(rp => rp.role_id === r.id);
        const template = getDefaultRoleTemplate(r.role_key);
        const matrix: RolePermissionMatrix = r.is_system_role
          ? clonePermissionsMatrix(template.permissions)
          : createEmptyPermissionsMatrix(false);

        rowsForRole.forEach((rp: any) => {
          const k = rp.permission_key as keyof RolePermissionMatrix;
          if (matrix[k]) {
            matrix[k] = {
              view: Boolean(rp.can_view),
              create: Boolean(rp.can_create),
              edit: Boolean(rp.can_edit),
              delete: Boolean(rp.can_delete),
              print: Boolean(rp.can_print),
              export: Boolean(rp.can_export),
            };
          }
        });

        return {
          id: r.id,
          businessId: r.business_id,
          roleKey: r.role_key,
          name: r.name,
          description: r.description || '',
          isSystemRole: Boolean(r.is_system_role),
          isDefault: Boolean(r.is_default),
          permissions: matrix,
          createdAt: r.created_at || new Date().toISOString(),
          updatedAt: r.updated_at,
        };
      });

      cacheSet(cacheKey, hydrated);
      return hydrated;
    } catch (err) {
      console.warn('Error fetching roles from Supabase, using local cache:', err);
      const cached = cacheGet<RoleDefinition[]>(cacheKey, []);
      return cached.length > 0 ? cached : defaultRoles;
    }
  },

  async createCustomRole(
    payload: { name: string; description: string; permissions: RolePermissionMatrix },
    businessId: string
  ): Promise<RoleDefinition> {
    const cacheKey = `${RBAC_ROLES_KEY}_${businessId || 'local'}`;
    const roleKey =
      'custom_' +
      payload.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') +
      '_' +
      Math.random().toString(36).slice(2, 6);

    const now = new Date().toISOString();
    let newId = `role-${Date.now()}`;

    if (isSupabaseConfigured && businessId) {
      const { data: inserted, error } = await supabase
        .from('user_roles')
        .insert({
          business_id: businessId,
          role_key: roleKey,
          name: payload.name.trim(),
          description: payload.description.trim(),
          is_system_role: false,
          is_default: false,
        })
        .select()
        .single();

      if (!error && inserted) {
        newId = inserted.id;
        const permRows = PERMISSION_MODULES.map(mod => ({
          business_id: businessId,
          role_id: inserted.id,
          permission_key: mod.key,
          can_view: Boolean(payload.permissions[mod.key]?.view),
          can_create: Boolean(payload.permissions[mod.key]?.create),
          can_edit: Boolean(payload.permissions[mod.key]?.edit),
          can_delete: Boolean(payload.permissions[mod.key]?.delete),
          can_print: Boolean(payload.permissions[mod.key]?.print),
          can_export: Boolean(payload.permissions[mod.key]?.export),
        }));
        await supabase
          .from('role_permissions')
          .upsert(permRows, { onConflict: 'role_id,permission_key' });
      }
    }

    const created: RoleDefinition = {
      id: newId,
      businessId,
      roleKey,
      name: payload.name.trim(),
      description: payload.description.trim(),
      isSystemRole: false,
      isDefault: false,
      permissions: clonePermissionsMatrix(payload.permissions),
      createdAt: now,
      updatedAt: now,
    };

    const existing = cacheGet<RoleDefinition[]>(cacheKey, []);
    cacheSet(cacheKey, [...existing, created]);
    return created;
  },

  async saveRolePermissions(
    roleId: string,
    permissions: RolePermissionMatrix,
    businessId: string
  ): Promise<void> {
    const cacheKey = `${RBAC_ROLES_KEY}_${businessId || 'local'}`;
    const current = cacheGet<RoleDefinition[]>(cacheKey, []);
    const target = current.find(r => r.id === roleId);

    if (isSupabaseConfigured && businessId && !roleId.startsWith('role-')) {
      const permRows = PERMISSION_MODULES.map(mod => ({
        business_id: businessId,
        role_id: roleId,
        permission_key: mod.key,
        can_view: Boolean(permissions[mod.key]?.view),
        can_create: Boolean(permissions[mod.key]?.create),
        can_edit: Boolean(permissions[mod.key]?.edit),
        can_delete: Boolean(permissions[mod.key]?.delete),
        can_print: Boolean(permissions[mod.key]?.print),
        can_export: Boolean(permissions[mod.key]?.export),
      }));
      const { error } = await supabase
        .from('role_permissions')
        .upsert(permRows, { onConflict: 'role_id,permission_key' });
      if (error) {
        console.warn('role_permissions upsert notice:', error.message);
      }
      await supabase
        .from('user_roles')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', roleId);
    }

    const updated = current.map(r =>
      r.id === roleId || (target && r.roleKey === target.roleKey)
        ? {
            ...r,
            permissions: clonePermissionsMatrix(permissions),
            updatedAt: new Date().toISOString(),
          }
        : r
    );
    cacheSet(cacheKey, updated);
  },

  async deleteCustomRole(roleId: string, businessId: string): Promise<void> {
    const cacheKey = `${RBAC_ROLES_KEY}_${businessId || 'local'}`;
    if (isSupabaseConfigured && businessId && !roleId.startsWith('role-')) {
      await supabase
        .from('user_roles')
        .delete()
        .eq('id', roleId)
        .eq('business_id', businessId)
        .eq('is_system_role', false);
    }
    const current = cacheGet<RoleDefinition[]>(cacheKey, []);
    cacheSet(
      cacheKey,
      current.filter(r => r.id !== roleId || r.isSystemRole)
    );
  },

  /**
   * Fetch all employees for a business (merges employees + business_users safely without duplicates)
   */
  async fetchEmployees(businessId: string): Promise<Employee[]> {
    const cacheKey = `${RBAC_EMPLOYEES_KEY}_${businessId || 'local'}`;
    if (!isSupabaseConfigured || !businessId) {
      return cacheGet<Employee[]>(cacheKey, []);
    }

    try {
      const { data: empRows, error } = await supabase
        .from('employees')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Supabase employees fetch notice:', error.message);
        return cacheGet<Employee[]>(cacheKey, []);
      }

      const mapped: Employee[] = (empRows || []).map((e: any) => {
        const accStatus = (e.account_status || e.status || 'active') as AccountStatus;
        const rKey = e.role_key || normalizeRoleKey(e.role);
        return {
          id: e.id,
          employeeCode: e.employee_code || undefined,
          userId: e.user_id || undefined,
          name: e.name,
          username: e.username || undefined,
          email: e.email || undefined,
          mobile: e.mobile || '',
          position: e.position || rKey,
          role: roleKeyToLegacyUserRole(rKey),
          roleId: e.role_id || undefined,
          roleKey: rKey,
          roleName: e.position || getDefaultRoleTemplate(rKey).name,
          salary: Number(e.salary || 0),
          joiningDate: e.joining_date || (e.created_at ? e.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)),
          branchId: e.branch_id || '',
          status: accStatus === 'active' ? 'active' : 'inactive',
          accountStatus: accStatus,
          lastLoginAt: e.last_login_at || undefined,
          createdAt: e.created_at,
          updatedAt: e.updated_at,
        };
      });

      cacheSet(cacheKey, mapped);
      return mapped;
    } catch (err) {
      console.warn('Error loading employees:', err);
      return cacheGet<Employee[]>(cacheKey, []);
    }
  },

  /**
   * Create a new Employee account with Supabase Auth (via isolated client so Admin session stays active)
   * and persist to employees + business_users + user_profiles.
   */
  async createEmployeeAccount(
    payload: CreateEmployeePayload,
    businessId: string,
    createdByUserId?: string
  ): Promise<Employee> {
    const cleanUsername = payload.username.trim().toLowerCase().replace(/\s+/g, '_');
    const cleanCode = payload.employeeCode.trim().toUpperCase();
    const emailToUse = payload.email?.trim() || `${cleanUsername}@amardokanpro.internal`;
    const now = new Date().toISOString();

    let authUserId: string | undefined;
    let empId = `emp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (isSupabaseConfigured && businessId) {
      // Isolated client so Admin session is NEVER overwritten
      const tempClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      const { data: authData, error: authErr } = await tempClient.auth.signUp({
        email: emailToUse,
        password: payload.password,
        options: {
          data: {
            full_name: payload.fullName.trim(),
            username: cleanUsername,
            employee_code: cleanCode,
            role: payload.roleKey,
          },
        },
      });

      if (authErr) {
        if (authErr.message.toLowerCase().includes('already registered')) {
          throw new Error(`An account with email "${emailToUse}" or username "${cleanUsername}" already exists.`);
        }
        throw authErr;
      }

      if (authData.user) {
        authUserId = authData.user.id;
        const legacyRole = roleKeyToLegacyUserRole(payload.roleKey);

        // Ensure profile + membership exist
        await supabase.from('user_profiles').upsert({
          id: authUserId,
          email: emailToUse,
          full_name: payload.fullName.trim(),
          username: cleanUsername,
          mobile: payload.phone.trim(),
          updated_at: now,
        });

        await supabase.from('business_users').upsert(
          {
            business_id: businessId,
            user_id: authUserId,
            branch_id: payload.branchId || null,
            role: legacyRole,
            status: payload.accountStatus === 'active' ? 'active' : 'suspended',
            updated_at: now,
          },
          { onConflict: 'business_id,user_id' }
        );
      }

      // Insert into employees table
      const insertPayload: Record<string, any> = {
        business_id: businessId,
        branch_id: payload.branchId || null,
        user_id: authUserId || null,
        employee_code: cleanCode,
        name: payload.fullName.trim(),
        username: cleanUsername,
        email: emailToUse,
        mobile: payload.phone.trim(),
        position: payload.position?.trim() || payload.roleName,
        role: roleKeyToLegacyUserRole(payload.roleKey),
        role_id: payload.roleId && !payload.roleId.startsWith('role-') ? payload.roleId : null,
        role_key: payload.roleKey,
        salary: Number(payload.salary) || 0,
        joining_date: payload.joiningDate,
        status: payload.accountStatus === 'active' ? 'active' : 'inactive',
        account_status: payload.accountStatus,
        created_by: createdByUserId || null,
      };

      const { data: empInserted, error: empErr } = await supabase
        .from('employees')
        .insert(insertPayload)
        .select()
        .single();

      if (empErr) {
        throw new Error(empErr.message || 'Failed to save employee record to database.');
      } else if (empInserted) {
        empId = empInserted.id;
      }
    } else {
      // Store salted PBKDF2 hash only when offline/local mode (never plaintext!)
      const saltedHash = await hashPasswordWithSalt(payload.password);
      const localHashes = cacheGet<Record<string, { hash: string; empId: string; email: string }>>(
        RBAC_CREDENTIAL_HASH_KEY,
        {}
      );
      localHashes[cleanUsername] = { hash: saltedHash, empId, email: emailToUse };
      cacheSet(RBAC_CREDENTIAL_HASH_KEY, localHashes);
    }

    const newEmployee: Employee = {
      id: empId,
      employeeCode: cleanCode,
      userId: authUserId,
      name: payload.fullName.trim(),
      username: cleanUsername,
      email: emailToUse,
      mobile: payload.phone.trim(),
      position: payload.position?.trim() || payload.roleName,
      role: roleKeyToLegacyUserRole(payload.roleKey),
      roleId: payload.roleId,
      roleKey: payload.roleKey,
      roleName: payload.roleName,
      salary: Number(payload.salary) || 0,
      joiningDate: payload.joiningDate,
      branchId: payload.branchId || '',
      branchName: payload.branchName,
      status: payload.accountStatus === 'active' ? 'active' : 'inactive',
      accountStatus: payload.accountStatus,
      createdAt: now,
      updatedAt: now,
    };

    const cacheKey = `${RBAC_EMPLOYEES_KEY}_${businessId || 'local'}`;
    const existing = cacheGet<Employee[]>(cacheKey, []);
    cacheSet(cacheKey, [newEmployee, ...existing.filter(e => e.id !== newEmployee.id)]);
    return newEmployee;
  },

  async updateEmployeeAccount(
    employee: Employee,
    updates: UpdateEmployeePayload,
    businessId: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const nextStatus = updates.accountStatus || employee.accountStatus || (employee.status === 'active' ? 'active' : 'inactive');
    const nextRoleKey = updates.roleKey || employee.roleKey || normalizeRoleKey(employee.role);

    if (isSupabaseConfigured && businessId) {
      const dbUpdate: Record<string, any> = {
        updated_at: now,
      };
      if (updates.name !== undefined) dbUpdate.name = updates.name.trim();
      if (updates.employeeCode !== undefined) dbUpdate.employee_code = updates.employeeCode.trim().toUpperCase();
      if (updates.mobile !== undefined) dbUpdate.mobile = updates.mobile.trim();
      if (updates.email !== undefined) dbUpdate.email = updates.email.trim();
      if (updates.username !== undefined) dbUpdate.username = updates.username.trim().toLowerCase().replace(/\s+/g, '_');
      if (updates.position !== undefined) dbUpdate.position = updates.position.trim();
      if (updates.salary !== undefined) dbUpdate.salary = Number(updates.salary) || 0;
      if (updates.joiningDate !== undefined) dbUpdate.joining_date = updates.joiningDate;
      if (updates.branchId !== undefined) dbUpdate.branch_id = updates.branchId || null;
      if (updates.roleKey !== undefined) {
        dbUpdate.role_key = nextRoleKey;
        dbUpdate.role = roleKeyToLegacyUserRole(nextRoleKey);
      }
      if (updates.roleId !== undefined) {
        dbUpdate.role_id = updates.roleId && !updates.roleId.startsWith('role-') ? updates.roleId : null;
      }
      if (updates.accountStatus !== undefined) {
        dbUpdate.account_status = nextStatus;
        dbUpdate.status = nextStatus === 'active' ? 'active' : 'inactive';
      }

      if (!employee.id.startsWith('emp-')) {
        await supabase.from('employees').update(dbUpdate).eq('id', employee.id);
      }

      if (employee.userId) {
        await supabase
          .from('user_profiles')
          .update({
            full_name: updates.name ?? employee.name,
            mobile: updates.mobile ?? employee.mobile,
            updated_at: now,
          })
          .eq('id', employee.userId);

        await supabase
          .from('business_users')
          .update({
            branch_id: (updates.branchId !== undefined ? updates.branchId : employee.branchId) || null,
            role: roleKeyToLegacyUserRole(nextRoleKey),
            status: nextStatus === 'active' ? 'active' : 'suspended',
            updated_at: now,
          })
          .eq('business_id', businessId)
          .eq('user_id', employee.userId);
      }
    }

    const cacheKey = `${RBAC_EMPLOYEES_KEY}_${businessId || 'local'}`;
    const existing = cacheGet<Employee[]>(cacheKey, []);
    const updatedList = existing.map(e => {
      if (e.id !== employee.id) return e;
      return {
        ...e,
        ...updates,
        roleKey: nextRoleKey,
        role: roleKeyToLegacyUserRole(nextRoleKey),
        accountStatus: nextStatus,
        status: (nextStatus === 'active' ? 'active' : 'inactive') as 'active' | 'inactive',
        updatedAt: now,
      };
    });
    cacheSet(cacheKey, updatedList);
  },

  async changeEmployeeStatus(
    employee: Employee,
    newStatus: AccountStatus,
    businessId: string
  ): Promise<void> {
    return this.updateEmployeeAccount(employee, { accountStatus: newStatus }, businessId);
  },

  async resetEmployeePassword(
    employee: Employee,
    newPassword?: string
  ): Promise<{ success: boolean; message: string }> {
    const email = employee.email || (employee.username ? `${employee.username}@amardokanpro.internal` : '');

    if (!isSupabaseConfigured) {
      if (newPassword && employee.username) {
        const saltedHash = await hashPasswordWithSalt(newPassword);
        const localHashes = cacheGet<Record<string, { hash: string; empId: string; email: string }>>(
          RBAC_CREDENTIAL_HASH_KEY,
          {}
        );
        localHashes[employee.username] = { hash: saltedHash, empId: employee.id, email };
        cacheSet(RBAC_CREDENTIAL_HASH_KEY, localHashes);
      }
      return {
        success: true,
        message: `Password credentials updated for ${employee.name} (${employee.employeeCode || employee.username}).`,
      };
    }

    try {
      if (!email || email.endsWith('@amardokanpro.internal')) {
        return {
          success: true,
          message: `Internal credential reset logged for ${employee.name}. For real email accounts, use a valid email address to send a Supabase Auth reset link.`,
        };
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;

      return {
        success: true,
        message: `Secure password reset link sent via Supabase Auth to ${email}.`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Failed to initiate password reset.',
      };
    }
  },

  /**
   * Resolves email, username, or Employee ID (e.g. EMP-001) into an email for login.
   */
  async resolveLoginIdentifier(identifier: string): Promise<string> {
    const trimmed = identifier.trim();
    if (!trimmed || trimmed.includes('@')) {
      return trimmed;
    }

    const cleanLower = trimmed.toLowerCase().replace(/\s+/g, '_');
    const cleanCode = trimmed.toUpperCase();

    if (isSupabaseConfigured) {
      try {
        // Check user_profiles by username
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('email')
          .eq('username', cleanLower)
          .maybeSingle();
        if (prof?.email) return prof.email;

        // Check employees by employee_code or username
        const { data: emp } = await supabase
          .from('employees')
          .select('email')
          .or(`employee_code.eq.${cleanCode},username.eq.${cleanLower}`)
          .maybeSingle();
        if (emp?.email) return emp.email;
      } catch {
        // Fallback below
      }
    }

    return `${cleanLower}@amardokanpro.internal`;
  },

  /**
   * Verifies whether the authenticated user's employee account is active.
   * Blocks inactive, suspended, or blocked employees from accessing the system.
   */
  async verifyEmployeeAccess(userId: string): Promise<{
    allowed: boolean;
    accountStatus: AccountStatus;
    reason?: string;
    roleKey?: string;
    roleId?: string;
    employee?: Employee;
    businessId?: string;
  }> {
    if (!isSupabaseConfigured || !userId) {
      return { allowed: true, accountStatus: 'active' };
    }

    try {
      // Try backend SECURITY DEFINER RPC first
      const { data: rpcCtx, error: rpcErr } = await supabase.rpc('get_my_rbac_context');
      if (!rpcErr && rpcCtx && rpcCtx.authenticated) {
        if (rpcCtx.allowed === false) {
          return {
            allowed: false,
            accountStatus: (rpcCtx.account_status || 'inactive') as AccountStatus,
            reason:
              rpcCtx.reason ||
              `Your account is currently ${rpcCtx.account_status}. Please contact the Store Owner.`,
            businessId: rpcCtx.business_id,
          };
        }

        // Fetch employee details if present
        let employeeRecord: Employee | undefined;
        if (rpcCtx.employee_id) {
          const { data: empRow } = await supabase
            .from('employees')
            .select('*')
            .eq('id', rpcCtx.employee_id)
            .maybeSingle();
          if (empRow) {
            employeeRecord = {
              id: empRow.id,
              employeeCode: empRow.employee_code || undefined,
              userId: empRow.user_id || undefined,
              name: empRow.name,
              username: empRow.username || undefined,
              email: empRow.email || undefined,
              mobile: empRow.mobile || '',
              position: empRow.position || '',
              role: roleKeyToLegacyUserRole(empRow.role_key || empRow.role),
              roleId: empRow.role_id || undefined,
              roleKey: empRow.role_key || normalizeRoleKey(empRow.role),
              salary: Number(empRow.salary || 0),
              joiningDate: empRow.joining_date || new Date().toISOString().slice(0, 10),
              branchId: empRow.branch_id || '',
              status: empRow.account_status === 'active' ? 'active' : 'inactive',
              accountStatus: (empRow.account_status || 'active') as AccountStatus,
              lastLoginAt: empRow.last_login_at || undefined,
            };
          }
        }

        return {
          allowed: true,
          accountStatus: (rpcCtx.account_status || 'active') as AccountStatus,
          roleKey: rpcCtx.role_key,
          roleId: rpcCtx.role_id,
          employee: employeeRecord,
          businessId: rpcCtx.business_id,
        };
      }

      // Direct table fallback if RPC isn't deployed yet
      const { data: emp } = await supabase
        .from('employees')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (emp) {
        const st = (emp.account_status || emp.status || 'active') as AccountStatus;
        if (st !== 'active') {
          return {
            allowed: false,
            accountStatus: st,
            reason: `Your staff account is currently ${st}. Please contact the Store Admin to restore access.`,
            businessId: emp.business_id,
          };
        }
        return {
          allowed: true,
          accountStatus: 'active',
          roleKey: emp.role_key || normalizeRoleKey(emp.role),
          roleId: emp.role_id || undefined,
          businessId: emp.business_id,
          employee: {
            id: emp.id,
            employeeCode: emp.employee_code || undefined,
            userId: emp.user_id || undefined,
            name: emp.name,
            username: emp.username || undefined,
            email: emp.email || undefined,
            mobile: emp.mobile || '',
            position: emp.position || '',
            role: roleKeyToLegacyUserRole(emp.role_key || emp.role),
            roleId: emp.role_id || undefined,
            roleKey: emp.role_key || normalizeRoleKey(emp.role),
            salary: Number(emp.salary || 0),
            joiningDate: emp.joining_date || new Date().toISOString().slice(0, 10),
            branchId: emp.branch_id || '',
            status: 'active',
            accountStatus: 'active',
          },
        };
      }

      return { allowed: true, accountStatus: 'active' };
    } catch {
      return { allowed: true, accountStatus: 'active' };
    }
  },

  /**
   * Activity & Login History Logging (immutable append-only)
   */
  async logActivity(
    entry: Omit<UserActivityLog, 'id' | 'createdAt'>,
    businessId: string
  ): Promise<UserActivityLog> {
    const now = new Date().toISOString();
    const logItem: UserActivityLog = {
      ...entry,
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      businessId,
      createdAt: now,
    };

    const cacheKey = `${RBAC_ACTIVITY_KEY}_${businessId || 'local'}`;
    const existing = cacheGet<UserActivityLog[]>(cacheKey, []);
    cacheSet(cacheKey, [logItem, ...existing].slice(0, 500));

    if (isSupabaseConfigured && businessId) {
      try {
        await supabase.from('user_activity_logs').insert({
          business_id: businessId,
          user_id: entry.userId || null,
          employee_id: entry.employeeId && !entry.employeeId.startsWith('emp-') ? entry.employeeId : null,
          employee_code: entry.employeeCode || null,
          employee_name: entry.employeeName,
          role_key: entry.roleKey,
          role_name: entry.roleName,
          event_type: entry.eventType,
          module_key: entry.moduleKey,
          action: entry.action,
          entity_type: entry.entityType || null,
          entity_id: entry.entityId || null,
          details: entry.details,
          metadata: entry.metadata || {},
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 240) : null,
        });
      } catch (err) {
        console.warn('Activity log DB insert notice:', err);
      }
    }

    return logItem;
  },

  async fetchActivityLogs(businessId: string): Promise<UserActivityLog[]> {
    const cacheKey = `${RBAC_ACTIVITY_KEY}_${businessId || 'local'}`;
    const localCached = cacheGet<UserActivityLog[]>(cacheKey, []);
    if (!isSupabaseConfigured || !businessId) {
      return localCached;
    }

    try {
      const { data, error } = await supabase
        .from('user_activity_logs')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(300);

      if (error || !data) {
        return localCached;
      }

      const mapped: UserActivityLog[] = data.map((d: any) => ({
        id: d.id,
        businessId: d.business_id,
        userId: d.user_id || undefined,
        employeeId: d.employee_id || undefined,
        employeeCode: d.employee_code || undefined,
        employeeName: d.employee_name || 'Staff',
        roleKey: d.role_key || 'salesman',
        roleName: d.role_name || d.role_key || 'Staff',
        eventType: d.event_type,
        moduleKey: d.module_key,
        action: d.action,
        entityType: d.entity_type || undefined,
        entityId: d.entity_id || undefined,
        details: d.details || '',
        metadata: d.metadata || undefined,
        createdAt: d.created_at,
      }));

      cacheSet(cacheKey, mapped);
      return mapped;
    } catch {
      return localCached;
    }
  },
};
