import { createClient } from '@supabase/supabase-js';
import {
  supabase,
  isSupabaseConfigured,
  supabaseUrl,
  supabaseAnonKey,
  isValidUuid,
  sanitizeUuid,
  formatSupabaseError,
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

function mapDbEmployeeRow(
  e: any,
  roleNameFallback?: string,
  branchNameFallback?: string
): Employee {
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
    roleName: roleNameFallback || e.position || getDefaultRoleTemplate(rKey).name,
    salary: Number(e.salary || 0),
    joiningDate:
      e.joining_date ||
      (e.created_at ? String(e.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10)),
    branchId: e.branch_id || '',
    branchName: branchNameFallback,
    status: accStatus === 'active' ? 'active' : 'inactive',
    accountStatus: accStatus,
    lastLoginAt: e.last_login_at || undefined,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}

async function inspectEdgeFunctionError(
  fnErr: any,
  fnData: any
): Promise<{ isUnavailable: boolean; message: string }> {
  if (fnData && typeof fnData === 'object' && typeof fnData.error === 'string' && fnData.error.trim()) {
    return { isUnavailable: false, message: fnData.error.trim() };
  }

  if (!fnErr) {
    return { isUnavailable: false, message: '' };
  }

  const errName = String(fnErr?.name || '');
  const rawMsg = String(fnErr?.message || '');

  // FunctionsHttpError carries a Response object in fnErr.context
  if (fnErr.context && typeof fnErr.context === 'object' && typeof fnErr.context.json === 'function') {
    const status = Number(fnErr.context.status || 0);
    try {
      const cloned = typeof fnErr.context.clone === 'function' ? fnErr.context.clone() : fnErr.context;
      const body = await cloned.json();
      const bodyCode = String(body?.code || '').toUpperCase();
      const bodyMsg = String(body?.error || body?.message || '').trim();

      // Supabase gateway returns 404 NOT_FOUND when the function has not been deployed yet
      if (status === 404 && (bodyCode === 'NOT_FOUND' || bodyMsg.toLowerCase().includes('requested function was not found'))) {
        return { isUnavailable: true, message: bodyMsg || 'Edge Function manage-staff-user is not deployed.' };
      }

      if (bodyMsg) {
        return { isUnavailable: false, message: bodyMsg };
      }
    } catch {
      try {
        const clonedText = typeof fnErr.context.clone === 'function' ? fnErr.context.clone() : fnErr.context;
        const txt = String(await clonedText.text()).trim();
        if (status === 404 && (!txt || txt.toLowerCase().includes('not found'))) {
          return { isUnavailable: true, message: 'Edge Function manage-staff-user is not deployed.' };
        }
        if (txt) {
          return { isUnavailable: false, message: txt };
        }
      } catch {
        // Ignore text parse failures
      }
    }

    if (status === 404) {
      return { isUnavailable: true, message: 'Edge Function manage-staff-user is not deployed.' };
    }
  }

  const lower = rawMsg.toLowerCase();
  const isNetworkOrMissing =
    errName === 'FunctionsFetchError' ||
    errName === 'FunctionsRelayError' ||
    lower.includes('failed to send a request') ||
    lower.includes('requested function was not found') ||
    lower.includes('404');

  return {
    isUnavailable: isNetworkOrMissing,
    message: rawMsg || 'Edge Function invocation failed.',
  };
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

      const mapped: Employee[] = (empRows || []).map((e: any) => mapDbEmployeeRow(e));

      cacheSet(cacheKey, mapped);
      return mapped;
    } catch (err) {
      console.warn('Error loading employees:', err);
      return cacheGet<Employee[]>(cacheKey, []);
    }
  },

  /**
   * Create a new Employee account with a real Supabase Auth user first, then link
   * user_profiles + business_users + employees using the actual auth.users UUID.
   * Prefers server-side/Edge-Function admin provisioning with full rollback on error,
   * and falls back to isolated signUp + atomic DB verification RPC when unavailable.
   */
  async createEmployeeAccount(
    payload: CreateEmployeePayload,
    businessId: string,
    createdByUserId?: string
  ): Promise<Employee> {
    const cleanUsername = payload.username.trim().toLowerCase().replace(/\s+/g, '_');
    const cleanCode = payload.employeeCode.trim().toUpperCase();
    const emailToUse = (payload.email?.trim() || `${cleanUsername}@amardokanpro.internal`).toLowerCase();
    const cleanBranchId = sanitizeUuid(payload.branchId);
    const cleanRoleId = sanitizeUuid(payload.roleId);
    const cleanCreatorId = sanitizeUuid(createdByUserId);
    const now = new Date().toISOString();

    let newEmployee: Employee | null = null;

    if (isSupabaseConfigured && businessId && isValidUuid(businessId)) {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      // 1. Prefer server-side Express admin endpoint (/api/staff/create)
      let handledByPrivilegedApi = false;
      if (accessToken && typeof fetch !== 'undefined') {
        try {
          const res = await fetch('/api/staff/create', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              businessId,
              mode: 'employee',
              payload: {
                ...payload,
                username: cleanUsername,
                employeeCode: cleanCode,
                email: emailToUse,
                branchId: cleanBranchId,
                roleId: cleanRoleId,
              },
            }),
          });

          const json = await res.json().catch(() => null);
          if (res.ok && json?.employee) {
            newEmployee = mapDbEmployeeRow(json.employee, payload.roleName, payload.branchName);
            handledByPrivilegedApi = true;
          } else if (
            res.status !== 404 &&
            res.status !== 501 &&
            json?.code !== 'SERVICE_ROLE_NOT_CONFIGURED'
          ) {
            throw new Error(json?.error || `Failed to create employee account (${res.status}).`);
          }
        } catch (apiErr: any) {
          if (apiErr instanceof Error && !apiErr.message.includes('Failed to fetch')) {
            throw apiErr;
          }
        }
      }

      // 2. Try Supabase Edge Function (`manage-staff-user`) if local server key isn't configured
      if (!handledByPrivilegedApi && accessToken) {
        const { data: fnData, error: fnErr } = await supabase.functions.invoke('manage-staff-user', {
          body: {
            action: 'create_employee',
            businessId,
            payload: {
              ...payload,
              username: cleanUsername,
              employeeCode: cleanCode,
              email: emailToUse,
              branchId: cleanBranchId,
              roleId: cleanRoleId,
            },
          },
        });

        if (!fnErr && fnData?.employee) {
          newEmployee = mapDbEmployeeRow(fnData.employee, payload.roleName, payload.branchName);
          handledByPrivilegedApi = true;
        } else {
          const parsedErr = await inspectEdgeFunctionError(fnErr, fnData);
          if (!parsedErr.isUnavailable && parsedErr.message) {
            throw new Error(parsedErr.message);
          }
        }
      }

      // 3. Controlled fallback via isolated Auth client + verified auth.users UUID check
      if (!handledByPrivilegedApi) {
        // Pre-check duplicates in this business before touching auth.users
        const { data: dupRows } = await supabase
          .from('employees')
          .select('id, username, employee_code, email')
          .eq('business_id', businessId)
          .or(
            [
              `username.eq.${cleanUsername}`,
              cleanCode ? `employee_code.eq.${cleanCode}` : '',
              `email.eq.${emailToUse}`,
            ]
              .filter(Boolean)
              .join(',')
          );

        if (dupRows && dupRows.length > 0) {
          const dup = dupRows[0];
          if ((dup.username || '').toLowerCase() === cleanUsername) {
            throw new Error(`Username "${cleanUsername}" is already assigned to another staff member.`);
          }
          if (cleanCode && (dup.employee_code || '').toUpperCase() === cleanCode) {
            throw new Error(`Employee ID "${cleanCode}" already exists.`);
          }
          throw new Error(`An employee account with email "${emailToUse}" already exists.`);
        }

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
              business_id: businessId,
            },
          },
        });

        if (authErr) {
          if (authErr.message.toLowerCase().includes('already registered')) {
            throw new Error(
              `An account with email "${emailToUse}" or username "${cleanUsername}" already exists in Supabase Auth.`
            );
          }
          throw authErr;
        }

        const signedUpUser = authData?.user;
        // CRITICAL: Supabase returns an obfuscated fake user with identities: [] when an email
        // already exists and email confirmation / anti-enumeration is enabled.
        // That fake UUID does NOT exist in auth.users and causes employees_user_id_fkey!
        if (!signedUpUser?.id || !isValidUuid(signedUpUser.id)) {
          throw new Error('Supabase Auth did not return a valid user UUID for this employee.');
        }
        if (Array.isArray(signedUpUser.identities) && signedUpUser.identities.length === 0) {
          throw new Error(
            `An authentication user with email "${emailToUse}" already exists in Supabase Auth. Please use a different email or username.`
          );
        }

        const authUserId = signedUpUser.id;
        const legacyRole = roleKeyToLegacyUserRole(payload.roleKey);

        // Prefer atomic Postgres RPC that verifies auth.users.id existence before inserting
        const { data: rpcEmp, error: rpcErr } = await supabase.rpc('create_employee_account_synced', {
          p_business_id: businessId,
          p_user_id: authUserId,
          p_branch_id: cleanBranchId,
          p_employee_code: cleanCode || null,
          p_name: payload.fullName.trim(),
          p_username: cleanUsername,
          p_email: emailToUse,
          p_mobile: payload.phone.trim(),
          p_position: payload.position?.trim() || payload.roleName,
          p_role_id: cleanRoleId,
          p_role_key: payload.roleKey,
          p_role: legacyRole,
          p_salary: Number(payload.salary) || 0,
          p_joining_date: payload.joiningDate || now.slice(0, 10),
          p_account_status: payload.accountStatus,
        });

        if (!rpcErr && rpcEmp) {
          newEmployee = mapDbEmployeeRow(rpcEmp, payload.roleName, payload.branchName);
        } else {
          const rpcMissing =
            rpcErr?.code === 'PGRST202' ||
            String(rpcErr?.message || '').toLowerCase().includes('could not find the function');

          if (rpcErr && !rpcMissing) {
            throw new Error(formatSupabaseError(rpcErr, 'Failed to synchronize employee record.'));
          }

          // Direct fallback if 20261120 migration RPC hasn't been applied yet
          let resolvedRoleId = cleanRoleId;
          if (!resolvedRoleId) {
            const { data: roleRow } = await supabase
              .from('user_roles')
              .select('id')
              .eq('business_id', businessId)
              .eq('role_key', normalizeRoleKey(payload.roleKey))
              .maybeSingle();
            resolvedRoleId = roleRow?.id || null;
          }

          let createdBusinessUser = false;
          let createdProfile = false;
          try {
            // Insert business_users BEFORE user_profiles so can_manage_user_profile RLS succeeds
            const { error: buErr } = await supabase.from('business_users').upsert(
              {
                business_id: businessId,
                user_id: authUserId,
                branch_id: cleanBranchId,
                role: legacyRole,
                status: payload.accountStatus === 'active' ? 'active' : 'suspended',
                updated_at: now,
              },
              { onConflict: 'business_id,user_id' }
            );
            if (buErr) {
              throw new Error(formatSupabaseError(buErr, 'Failed to link staff business membership.'));
            }
            createdBusinessUser = true;

            const { error: profErr } = await supabase.from('user_profiles').upsert({
              id: authUserId,
              email: emailToUse,
              full_name: payload.fullName.trim(),
              username: cleanUsername,
              mobile: payload.phone.trim(),
              updated_at: now,
            });
            if (profErr) {
              throw new Error(formatSupabaseError(profErr, 'Failed to save staff profile.'));
            }
            createdProfile = true;

            const { data: empInserted, error: empErr } = await supabase
              .from('employees')
              .insert({
                business_id: businessId,
                branch_id: cleanBranchId,
                user_id: authUserId,
                employee_code: cleanCode || null,
                name: payload.fullName.trim(),
                username: cleanUsername,
                email: emailToUse,
                mobile: payload.phone.trim(),
                position: payload.position?.trim() || payload.roleName,
                role: legacyRole,
                role_id: resolvedRoleId,
                role_key: payload.roleKey,
                salary: Number(payload.salary) || 0,
                joining_date: payload.joiningDate || now.slice(0, 10),
                status: payload.accountStatus === 'active' ? 'active' : 'inactive',
                account_status: payload.accountStatus,
                created_by: cleanCreatorId,
              })
              .select()
              .single();

            if (empErr || !empInserted) {
              throw new Error(formatSupabaseError(empErr, 'Failed to save employee record to database.'));
            }

            newEmployee = mapDbEmployeeRow(empInserted, payload.roleName, payload.branchName);
          } catch (fallbackErr: any) {
            // Rollback partial membership/profile rows on employee creation failure
            if (createdProfile) {
              await supabase.from('user_profiles').delete().eq('id', authUserId);
            }
            if (createdBusinessUser) {
              await supabase
                .from('business_users')
                .delete()
                .eq('business_id', businessId)
                .eq('user_id', authUserId);
            }
            throw fallbackErr;
          }
        }
      }
    } else {
      const empId = `emp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      // Store salted PBKDF2 hash only when offline/local mode (never plaintext!)
      const saltedHash = await hashPasswordWithSalt(payload.password);
      const localHashes = cacheGet<Record<string, { hash: string; empId: string; email: string }>>(
        RBAC_CREDENTIAL_HASH_KEY,
        {}
      );
      localHashes[cleanUsername] = { hash: saltedHash, empId, email: emailToUse };
      cacheSet(RBAC_CREDENTIAL_HASH_KEY, localHashes);

      newEmployee = {
        id: empId,
        employeeCode: cleanCode,
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
    }

    if (!newEmployee) {
      throw new Error('Employee account creation did not return a valid employee record.');
    }

    const cacheKey = `${RBAC_EMPLOYEES_KEY}_${businessId || 'local'}`;
    const existing = cacheGet<Employee[]>(cacheKey, []);
    cacheSet(cacheKey, [newEmployee, ...existing.filter(e => e.id !== newEmployee!.id)]);
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

    if (isSupabaseConfigured && businessId && isValidUuid(businessId)) {
      const dbUpdate: Record<string, any> = {
        updated_at: now,
      };
      if (updates.name !== undefined) dbUpdate.name = updates.name.trim();
      if (updates.employeeCode !== undefined) dbUpdate.employee_code = updates.employeeCode.trim().toUpperCase();
      if (updates.mobile !== undefined) dbUpdate.mobile = updates.mobile.trim();
      if (updates.email !== undefined) dbUpdate.email = updates.email.trim().toLowerCase();
      if (updates.username !== undefined) dbUpdate.username = updates.username.trim().toLowerCase().replace(/\s+/g, '_');
      if (updates.position !== undefined) dbUpdate.position = updates.position.trim();
      if (updates.salary !== undefined) dbUpdate.salary = Number(updates.salary) || 0;
      if (updates.joiningDate !== undefined) dbUpdate.joining_date = updates.joiningDate;
      if (updates.branchId !== undefined) dbUpdate.branch_id = sanitizeUuid(updates.branchId);
      if (updates.roleKey !== undefined) {
        dbUpdate.role_key = nextRoleKey;
        dbUpdate.role = roleKeyToLegacyUserRole(nextRoleKey);
      }
      if (updates.roleId !== undefined) {
        dbUpdate.role_id = sanitizeUuid(updates.roleId);
      }
      if (updates.accountStatus !== undefined) {
        dbUpdate.account_status = nextStatus;
        dbUpdate.status = nextStatus === 'active' ? 'active' : 'inactive';
      }

      if (isValidUuid(employee.id)) {
        const { error: empUpdErr } = await supabase
          .from('employees')
          .update(dbUpdate)
          .eq('id', employee.id)
          .eq('business_id', businessId);
        if (empUpdErr) {
          throw new Error(formatSupabaseError(empUpdErr, 'Failed to update employee record.'));
        }
      }

      if (isValidUuid(employee.userId)) {
        const { error: profUpdErr } = await supabase
          .from('user_profiles')
          .update({
            full_name: updates.name ?? employee.name,
            mobile: updates.mobile ?? employee.mobile,
            username: updates.username !== undefined ? updates.username.trim().toLowerCase().replace(/\s+/g, '_') : employee.username,
            updated_at: now,
          })
          .eq('id', employee.userId);
        if (profUpdErr) {
          console.warn('user_profiles update notice:', profUpdErr.message);
        }

        const { error: buUpdErr } = await supabase
          .from('business_users')
          .update({
            branch_id: sanitizeUuid(updates.branchId !== undefined ? updates.branchId : employee.branchId),
            role: roleKeyToLegacyUserRole(nextRoleKey),
            status: nextStatus === 'active' ? 'active' : 'suspended',
            updated_at: now,
          })
          .eq('business_id', businessId)
          .eq('user_id', employee.userId);
        if (buUpdErr) {
          console.warn('business_users update notice:', buUpdErr.message);
        }
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
    newPassword?: string,
    businessId?: string
  ): Promise<{
    success: boolean;
    message: string;
    repaired?: boolean;
    userId?: string;
    email?: string | null;
    username?: string | null;
    employeeCode?: string | null;
  }> {
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
        message: `Password credentials updated for ${employee.name} (${employee.employeeCode || employee.username || employee.name}).`,
      };
    }

    try {
      const cleanPass = (newPassword || '').trim();
      if (cleanPass.length < 6) {
        return {
          success: false,
          message: 'New password must be at least 6 characters.',
        };
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const validBizId = sanitizeUuid(businessId);

      if (!accessToken) {
        return {
          success: false,
          message: 'Your Admin session has expired. Please sign in again before resetting passwords.',
        };
      }

      if (!validBizId) {
        return {
          success: false,
          message: 'Active business context not found. Please reload and try again.',
        };
      }

      // 1. Try local Express backend endpoint (/api/staff/reset-password) if configured with service key
      if (typeof fetch !== 'undefined') {
        try {
          const res = await fetch('/api/staff/reset-password', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              businessId: validBizId,
              employeeId: sanitizeUuid(employee.id),
              userId: sanitizeUuid(employee.userId),
              email: employee.email,
              username: employee.username,
              newPassword: cleanPass,
            }),
          });
          const json = await res.json().catch(() => null);
          if (res.ok && json?.success) {
            return {
              success: true,
              repaired: Boolean(json.repaired),
              userId: json.userId || employee.userId,
              email: json.email ?? employee.email ?? null,
              username: json.username ?? employee.username ?? null,
              employeeCode: json.employeeCode ?? employee.employeeCode ?? null,
              message:
                json.message ||
                `Password updated successfully for ${employee.name} (${employee.employeeCode || employee.username || ''}).`,
            };
          }
          if (res.status !== 404 && res.status !== 501 && json?.code !== 'SERVICE_ROLE_NOT_CONFIGURED') {
            return { success: false, message: json?.error || 'Failed to update employee password.' };
          }
        } catch {
          // Fall through to Supabase Edge Function
        }
      }

      // 2. Call Supabase Edge Function (`manage-staff-user`) using Admin session JWT
      const { data: fnData, error: fnErr } = await supabase.functions.invoke('manage-staff-user', {
        body: {
          action: 'reset_password',
          businessId: validBizId,
          employeeId: sanitizeUuid(employee.id),
          userId: sanitizeUuid(employee.userId),
          email: employee.email,
          username: employee.username,
          newPassword: cleanPass,
        },
      });

      if (!fnErr && fnData?.success) {
        return {
          success: true,
          repaired: Boolean(fnData.repaired),
          userId: fnData.userId || employee.userId,
          email: fnData.email ?? employee.email ?? null,
          username: fnData.username ?? employee.username ?? null,
          employeeCode: fnData.employeeCode ?? employee.employeeCode ?? null,
          message:
            fnData.message ||
            `Password updated successfully for ${employee.name} (${employee.employeeCode || employee.username || ''}).`,
        };
      }

      const parsedErr = await inspectEdgeFunctionError(fnErr, fnData);
      if (!parsedErr.isUnavailable && parsedErr.message) {
        return {
          success: false,
          message: parsedErr.message,
        };
      }

      // 3. Fallback only when Edge Function is not deployed yet
      if (!email || email.endsWith('@amardokanpro.internal')) {
        return {
          success: false,
          message:
            'Edge Function "manage-staff-user" is not deployed yet (or SUPABASE_SERVICE_ROLE_KEY is missing on the server). Deploy the Edge Function using the Supabase CLI to link & reset staff passwords directly.',
        };
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;

      return {
        success: true,
        message: `Edge Function not deployed yet; sent a password reset link via email to ${email}.`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Failed to initiate password reset.',
      };
    }
  },

  async repairEmployeeAuthLinks(businessId: string): Promise<{
    success: boolean;
    alreadyValidCount: number;
    repairedCount: number;
    unlinkedRemaining: number;
    repairedEmployees: Array<{ id: string; name: string; userId?: string; email?: string }>;
    unlinkedEmployees: Array<{ id: string; name: string; employeeCode?: string | null }>;
    message: string;
  }> {
    const validBizId = sanitizeUuid(businessId);
    if (!isSupabaseConfigured || !validBizId) {
      return {
        success: true,
        alreadyValidCount: 0,
        repairedCount: 0,
        unlinkedRemaining: 0,
        repairedEmployees: [],
        unlinkedEmployees: [],
        message: 'Local mode active; Auth linking applies to Supabase Cloud accounts.',
      };
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      throw new Error('Your Admin session has expired. Please sign in again.');
    }

    // 1. Try local Express backend (/api/staff/repair-links)
    if (typeof fetch !== 'undefined') {
      try {
        const res = await fetch('/api/staff/repair-links', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ businessId: validBizId }),
        });
        const json = await res.json().catch(() => null);
        if (res.ok && json?.success) {
          return {
            success: true,
            alreadyValidCount: Number(json.alreadyValidCount || 0),
            repairedCount: Number(json.repairedCount || 0),
            unlinkedRemaining: Number(json.unlinkedRemaining || 0),
            repairedEmployees: json.repairedEmployees || [],
            unlinkedEmployees: json.unlinkedEmployees || [],
            message: `Synced ${json.alreadyValidCount || 0} valid accounts, repaired ${json.repairedCount || 0} links, ${json.unlinkedRemaining || 0} need initial password setup (use Reset Password).`,
          };
        }
        if (res.status !== 404 && res.status !== 501 && json?.code !== 'SERVICE_ROLE_NOT_CONFIGURED') {
          throw new Error(json?.error || 'Failed to repair employee Auth links.');
        }
      } catch (err: any) {
        if (err instanceof Error && !err.message.includes('Failed to fetch')) {
          throw err;
        }
      }
    }

    // 2. Try Supabase Edge Function (`manage-staff-user`)
    const { data: fnData, error: fnErr } = await supabase.functions.invoke('manage-staff-user', {
      body: { action: 'repair_employee_links', businessId: validBizId },
    });

    if (!fnErr && fnData?.success) {
      return {
        success: true,
        alreadyValidCount: Number(fnData.alreadyValidCount || 0),
        repairedCount: Number(fnData.repairedCount || 0),
        unlinkedRemaining: Number(fnData.unlinkedRemaining || 0),
        repairedEmployees: fnData.repairedEmployees || [],
        unlinkedEmployees: fnData.unlinkedEmployees || [],
        message: `Synced ${fnData.alreadyValidCount || 0} valid accounts, repaired ${fnData.repairedCount || 0} links, ${fnData.unlinkedRemaining || 0} need initial password setup (use Reset Password).`,
      };
    }

    const parsedErr = await inspectEdgeFunctionError(fnErr, fnData);
    if (!parsedErr.isUnavailable && parsedErr.message) {
      throw new Error(parsedErr.message);
    }

    // 3. Fallback to SQL SECURITY DEFINER RPC (`repair_existing_employee_auth_links`)
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('repair_existing_employee_auth_links', {
      p_business_id: validBizId,
    });
    if (rpcErr) {
      throw new Error(
        formatSupabaseError(
          rpcErr,
          'Edge Function "manage-staff-user" is not deployed yet and SQL repair RPC was not found.'
        )
      );
    }

    const repairedCount = Number(rpcRes?.repaired_count || 0);
    const syncedCount = Number(rpcRes?.synced_count || 0);
    const unlinkedRemaining = Number(rpcRes?.unlinked_remaining || 0);
    return {
      success: true,
      alreadyValidCount: syncedCount,
      repairedCount,
      unlinkedRemaining,
      repairedEmployees: (rpcRes?.repaired_employees || []).map((name: string, idx: number) => ({
        id: String(idx),
        name,
      })),
      unlinkedEmployees: (rpcRes?.unlinked_employees || []).map((name: string, idx: number) => ({
        id: String(idx),
        name,
      })),
      message: `Synced ${syncedCount} valid accounts, repaired ${repairedCount} links, ${unlinkedRemaining} still need an initial login password (use Reset Password).`,
    };
  },


  /**
   * Resolves email, username, or Employee ID (e.g. EMP-001) into an email for login.
   * Uses anon-safe SECURITY DEFINER RPC first so staff can log in before authentication.
   */
  async resolveLoginIdentifier(identifier: string): Promise<string> {
    const trimmed = identifier.trim();
    if (!trimmed) return '';

    const cleanLower = trimmed.toLowerCase().replace(/\s+/g, '_');
    const cleanCode = trimmed.toUpperCase();

    if (isSupabaseConfigured) {
      try {
        const { data: resolvedEmail, error: rpcErr } = await supabase.rpc('resolve_staff_login_email', {
          p_identifier: trimmed,
        });
        if (!rpcErr && typeof resolvedEmail === 'string' && resolvedEmail.trim()) {
          return resolvedEmail.trim();
        }
      } catch {
        // Fallback below
      }

      if (trimmed.includes('@')) {
        return trimmed.toLowerCase();
      }

      try {
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('email')
          .eq('username', cleanLower)
          .maybeSingle();
        if (prof?.email) return prof.email;

        const { data: emp } = await supabase
          .from('employees')
          .select('email')
          .or(`employee_code.eq.${cleanCode},username.eq.${cleanLower}`)
          .maybeSingle();
        if (emp?.email) return emp.email;
      } catch {
        // Fallback below
      }
    } else if (trimmed.includes('@')) {
      return trimmed.toLowerCase();
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

    if (isSupabaseConfigured && isValidUuid(businessId)) {
      try {
        await supabase.from('user_activity_logs').insert({
          business_id: businessId,
          user_id: sanitizeUuid(entry.userId),
          employee_id: sanitizeUuid(entry.employeeId),
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
