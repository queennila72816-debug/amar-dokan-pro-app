import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PORT = Number(process.env.PORT) || 3000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(val: unknown): val is string {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

function sanitizeUuid(val: unknown): string | null {
  return isValidUuid(val) ? val.trim() : null;
}

function normalizeRoleKey(raw?: string | null): string {
  const val = (raw || '').trim().toLowerCase();
  if (val === 'owner' || val === 'admin' || val === 'super_admin') return 'super_admin';
  if (val === 'manager' || val === 'store_manager') return 'store_manager';
  if (val === 'seller' || val === 'salesman') return 'salesman';
  if (val === 'storekeeper' || val === 'inventory_manager') return 'inventory_manager';
  if (val === 'accountant') return 'accountant';
  if (val === 'cashier') return 'cashier';
  return val || 'salesman';
}

function roleKeyToLegacyUserRole(roleKey: string): string {
  const normalized = normalizeRoleKey(roleKey);
  if (normalized === 'super_admin') return 'owner';
  if (normalized === 'store_manager') return 'manager';
  if (normalized === 'salesman') return 'salesman';
  if (normalized === 'inventory_manager') return 'storekeeper';
  if (normalized === 'accountant') return 'accountant';
  if (normalized === 'cashier') return 'cashier';
  return roleKey;
}

let cachedAdminClient: SupabaseClient | null = null;
let cachedAdminKeyFingerprint = '';

function getSupabaseAdminClient(): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/rest\/v1\/?$/, '')
    .replace(/\/+$/, '');
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (
    !url ||
    !serviceRoleKey ||
    url.includes('placeholder.supabase.co') ||
    url.includes('your-project-ref') ||
    serviceRoleKey.includes('your-supabase-')
  ) {
    return null;
  }

  const fingerprint = `${url}::${serviceRoleKey}`;
  if (!cachedAdminClient || cachedAdminKeyFingerprint !== fingerprint) {
    cachedAdminClient = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    cachedAdminKeyFingerprint = fingerprint;
  }

  return cachedAdminClient;
}

async function authorizeStaffPermission(
  supabaseAdmin: SupabaseClient,
  callerId: string,
  businessId: string,
  requiredAction: 'create' | 'edit' | 'admin_only'
): Promise<boolean> {
  const [{ data: buRow }, { data: empRow }] = await Promise.all([
    supabaseAdmin
      .from('business_users')
      .select('role, status')
      .eq('business_id', businessId)
      .eq('user_id', callerId)
      .maybeSingle(),
    supabaseAdmin
      .from('employees')
      .select('role, role_id, role_key, account_status')
      .eq('business_id', businessId)
      .eq('user_id', callerId)
      .maybeSingle(),
  ]);

  if (!buRow && !empRow) return false;

  const empStatus = empRow?.account_status;
  const buStatus = buRow?.status || 'active';
  if (
    (empStatus && empStatus !== 'active') ||
    ['inactive', 'suspended', 'blocked'].includes(buStatus)
  ) {
    return false;
  }

  const effectiveRoleKey = normalizeRoleKey(
    empRow?.role_key || empRow?.role || buRow?.role || ''
  );
  if (effectiveRoleKey === 'super_admin') return true;
  if (requiredAction === 'admin_only') return false;
  if (['salesman', 'cashier'].includes(effectiveRoleKey)) return false;

  let roleId = empRow?.role_id || null;
  if (!roleId && effectiveRoleKey) {
    const { data: ur } = await supabaseAdmin
      .from('user_roles')
      .select('id')
      .eq('business_id', businessId)
      .eq('role_key', effectiveRoleKey)
      .maybeSingle();
    roleId = ur?.id || null;
  }

  if (!roleId) return false;

  const { data: perm } = await supabaseAdmin
    .from('role_permissions')
    .select('can_create, can_edit')
    .eq('role_id', roleId)
    .eq('permission_key', 'user_management')
    .maybeSingle();

  return requiredAction === 'create' ? Boolean(perm?.can_create) : Boolean(perm?.can_edit);
}

async function authenticateCaller(
  req: express.Request,
  supabaseAdmin: SupabaseClient
): Promise<{ error: string; status: 401 | 403 | 503; code?: string } | { user: { id: string } }> {
  const authHeader = String(req.headers.authorization || '').trim();
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = bearerMatch ? bearerMatch[1].trim() : '';

  if (!token || token === 'null' || token === 'undefined') {
    return {
      error: 'Missing Authorization bearer token.',
      status: 401,
      code: 'SESSION_EXPIRED',
    };
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (
        msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('timeout') ||
        msg.includes('econnreset')
      ) {
        return {
          error: 'Authentication service is temporarily unreachable. Please retry.',
          status: 503,
          code: 'AUTH_SERVICE_UNAVAILABLE',
        };
      }
      return {
        error: 'Invalid or expired authentication session.',
        status: 401,
        code: 'SESSION_EXPIRED',
      };
    }

    if (!data?.user || data.user.is_anonymous) {
      return {
        error: 'Invalid or expired authentication session.',
        status: 401,
        code: 'SESSION_EXPIRED',
      };
    }

    const bannedUntil = data.user.banned_until ? new Date(data.user.banned_until).getTime() : 0;
    if (bannedUntil && bannedUntil > Date.now()) {
      return {
        error: 'Access denied: your account is currently suspended.',
        status: 403,
        code: 'ACCOUNT_SUSPENDED',
      };
    }

    return { user: data.user };
  } catch {
    return {
      error: 'Authentication service is temporarily unreachable. Please retry.',
      status: 503,
      code: 'AUTH_SERVICE_UNAVAILABLE',
    };
  }
}

interface EmpLinkRow {
  id: string;
  business_id: string;
  branch_id: string | null;
  user_id: string | null;
  name: string;
  employee_code: string | null;
  username: string | null;
  email: string | null;
  mobile: string | null;
  role_key: string | null;
  role: string | null;
  account_status: string | null;
  status: string | null;
}

interface AuthUserLite {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}

function slugifyUsername(name: string, fallbackId: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || `staff_${fallbackId.slice(0, 6)}`;
}

async function listAllAuthUsers(supabaseAdmin: SupabaseClient): Promise<AuthUserLite[]> {
  const all: AuthUserLite[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users || data.users.length === 0) break;
    all.push(...(data.users as AuthUserLite[]));
    if (data.users.length < 1000) break;
  }
  return all;
}

async function canSafelyLinkAuthUserToEmployee(
  supabaseAdmin: SupabaseClient,
  authUser: AuthUserLite,
  empRow: EmpLinkRow,
  businessId: string
): Promise<{ safe: boolean; reason?: string }> {
  const normEmpRole = normalizeRoleKey(empRow.role_key || empRow.role);
  const metaBizId = sanitizeUuid(authUser.user_metadata?.business_id);
  if (metaBizId && metaBizId !== businessId) {
    return { safe: false, reason: 'Account belongs to another business.' };
  }

  const [{ data: otherEmp }, { data: buRows }] = await Promise.all([
    supabaseAdmin
      .from('employees')
      .select('id, name')
      .eq('user_id', authUser.id)
      .neq('id', empRow.id)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('business_users')
      .select('business_id, role')
      .eq('user_id', authUser.id),
  ]);

  if (otherEmp) {
    return {
      safe: false,
      reason: `Auth user is already linked to another employee (${otherEmp.name || otherEmp.id}).`,
    };
  }

  const memberships = (buRows || []) as Array<{ business_id: string; role: string }>;
  if (memberships.some(m => m.business_id !== businessId)) {
    return { safe: false, reason: 'Auth user belongs to a different business.' };
  }

  const sameBizMembership = memberships.find(m => m.business_id === businessId);
  if (
    sameBizMembership &&
    normalizeRoleKey(sameBizMembership.role) === 'super_admin' &&
    normEmpRole !== 'super_admin'
  ) {
    return {
      safe: false,
      reason: 'Auth user is the Business Owner / Super Admin and cannot be linked to a non-admin employee.',
    };
  }

  return { safe: true };
}

async function syncEmployeeProfileAndMembership(
  supabaseAdmin: SupabaseClient,
  empRow: EmpLinkRow,
  authUserId: string,
  resolvedEmail: string,
  resolvedUsername: string | null,
  businessId: string
): Promise<void> {
  const now = new Date().toISOString();
  const normRoleKey = normalizeRoleKey(empRow.role_key || empRow.role);
  const legacyRole = roleKeyToLegacyUserRole(normRoleKey);
  const isActive = (empRow.account_status || empRow.status || 'active') === 'active';

  const { error: profErr } = await supabaseAdmin.from('user_profiles').upsert({
    id: authUserId,
    email: resolvedEmail,
    full_name: empRow.name,
    username: resolvedUsername || undefined,
    mobile: empRow.mobile || '',
    updated_at: now,
  });
  if (profErr) {
    throw new Error(`Failed to sync user_profiles: ${profErr.message}`);
  }

  const { error: buErr } = await supabaseAdmin.from('business_users').upsert(
    {
      business_id: businessId,
      user_id: authUserId,
      branch_id: sanitizeUuid(empRow.branch_id),
      role: legacyRole,
      status: isActive ? 'active' : 'suspended',
      updated_at: now,
    },
    { onConflict: 'business_id,user_id' }
  );
  if (buErr) {
    throw new Error(`Failed to sync business_users: ${buErr.message}`);
  }

  const empUpdate: Record<string, unknown> = {
    user_id: authUserId,
    updated_at: now,
  };
  if (!empRow.email && resolvedEmail) empUpdate.email = resolvedEmail;
  if (!empRow.username && resolvedUsername) empUpdate.username = resolvedUsername;

  const { error: empUpdErr } = await supabaseAdmin
    .from('employees')
    .update(empUpdate)
    .eq('id', empRow.id)
    .eq('business_id', businessId);
  if (empUpdErr) {
    throw new Error(`Failed to link employees.user_id: ${empUpdErr.message}`);
  }
}

async function findSafeExistingAuthUserForEmployee(
  supabaseAdmin: SupabaseClient,
  empRow: EmpLinkRow,
  businessId: string,
  emailHint = '',
  usernameHint = '',
  cachedAuthUsers?: AuthUserLite[]
): Promise<{
  authUser: AuthUserLite | null;
  allUsers: AuthUserLite[];
  conflictError?: string;
}> {
  const emailLookup = (empRow.email || emailHint || '').trim().toLowerCase();
  const usernameLookup = (empRow.username || usernameHint || '').trim().toLowerCase();

  if (emailLookup || usernameLookup) {
    let candidateProfIds: string[] = [];
    if (emailLookup) {
      const { data: profsByEmail } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .ilike('email', emailLookup);
      candidateProfIds = (profsByEmail || []).map((p: { id: string }) => p.id);
    }
    if (candidateProfIds.length === 0 && usernameLookup) {
      const { data: profsByUser } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .ilike('username', usernameLookup);
      candidateProfIds = (profsByUser || []).map((p: { id: string }) => p.id);
    }
    if (candidateProfIds.length > 0) {
      const { data: buMatch } = await supabaseAdmin
        .from('business_users')
        .select('user_id')
        .eq('business_id', businessId)
        .in('user_id', candidateProfIds)
        .limit(1)
        .maybeSingle();

      if (buMatch?.user_id) {
        const { data: verifiedUser } = await supabaseAdmin.auth.admin.getUserById(buMatch.user_id);
        if (verifiedUser?.user) {
          const safety = await canSafelyLinkAuthUserToEmployee(
            supabaseAdmin,
            verifiedUser.user as AuthUserLite,
            empRow,
            businessId
          );
          if (safety.safe) {
            return {
              authUser: verifiedUser.user as AuthUserLite,
              allUsers: cachedAuthUsers || [],
            };
          }
        }
      }
    }
  }

  const allUsers = cachedAuthUsers || (await listAllAuthUsers(supabaseAdmin));
  const empCode = (empRow.employee_code || '').trim().toUpperCase();

  const candidates = allUsers.filter(u => {
    const uEmail = (u.email || '').trim().toLowerCase();
    const uMetaUser = String(u.user_metadata?.username || '').trim().toLowerCase();
    const uMetaCode = String(u.user_metadata?.employee_code || '').trim().toUpperCase();
    const uMetaBiz = sanitizeUuid(u.user_metadata?.business_id);

    if (emailLookup && uEmail === emailLookup) return true;
    if (usernameLookup && uMetaUser === usernameLookup && (!uMetaBiz || uMetaBiz === businessId)) {
      return true;
    }
    if (empCode && uMetaCode === empCode && uMetaBiz === businessId) return true;
    return false;
  });

  for (const cand of candidates) {
    const safety = await canSafelyLinkAuthUserToEmployee(supabaseAdmin, cand, empRow, businessId);
    if (safety.safe) {
      return { authUser: cand, allUsers };
    }
    if (emailLookup && (cand.email || '').trim().toLowerCase() === emailLookup) {
      return {
        authUser: null,
        allUsers,
        conflictError: `Email "${emailLookup}" already belongs to another account (${safety.reason}). Set a unique email for ${empRow.name} first.`,
      };
    }
  }

  return { authUser: null, allUsers };
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/staff/create', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(501).json({
        code: 'SERVICE_ROLE_NOT_CONFIGURED',
        error: 'Server SUPABASE_SERVICE_ROLE_KEY is not configured.',
      });
    }

    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
    }

    const caller = authResult.user;
    const businessId = sanitizeUuid(req.body?.businessId);
    const mode = req.body?.mode === 'seller' ? 'seller' : 'employee';
    const p = req.body?.payload || {};

    if (!businessId) {
      return res.status(400).json({ error: 'Invalid or missing active businessId.' });
    }

    const authorized = await authorizeStaffPermission(supabaseAdmin, caller.id, businessId, 'create');
    if (!authorized) {
      return res.status(403).json({
        error: 'Permission denied: only authorized administrators can create staff accounts.',
      });
    }

    const fullName = String(p.fullName || '').trim();
    const cleanUsername = String(p.username || '').trim().toLowerCase().replace(/\s+/g, '_');
    const cleanCode = String(p.employeeCode || '').trim().toUpperCase();
    const password = String(p.password || '');
    const phone = String(p.phone || '').trim();
    const emailToUse = (String(p.email || '').trim() || `${cleanUsername}@amardokanpro.internal`).toLowerCase();
    const normRoleKey = normalizeRoleKey(p.roleKey || 'salesman');
    const legacyRole = mode === 'seller' ? 'seller' : roleKeyToLegacyUserRole(normRoleKey);
    const accountStatus = ['active', 'inactive', 'suspended', 'blocked'].includes(String(p.accountStatus || 'active'))
      ? String(p.accountStatus || 'active')
      : 'active';

    if (!fullName || !cleanUsername || password.length < 6) {
      return res.status(400).json({
        error: 'Full Name, Username, and Password (minimum 6 characters) are required.',
      });
    }

    try {
      // Pre-flight duplicate checks inside business before provisioning auth.users
      const { data: existingUsername } = await supabaseAdmin
        .from('employees')
        .select('id')
        .eq('business_id', businessId)
        .eq('username', cleanUsername)
        .maybeSingle();

      if (existingUsername) {
        return res.status(409).json({
          error: `Username "${cleanUsername}" is already assigned to another staff member.`,
        });
      }

      if (cleanCode) {
        const { data: existingCode } = await supabaseAdmin
          .from('employees')
          .select('id')
          .eq('business_id', businessId)
          .eq('employee_code', cleanCode)
          .maybeSingle();

        if (existingCode) {
          return res.status(409).json({
            error: `Employee ID "${cleanCode}" already exists.`,
          });
        }
      }

      const { data: bizExists } = await supabaseAdmin
        .from('businesses')
        .select('id')
        .eq('id', businessId)
        .maybeSingle();

      if (!bizExists) {
        return res.status(404).json({ error: 'Target business does not exist.' });
      }

      let resolvedBranchId = sanitizeUuid(p.branchId);
      if (resolvedBranchId) {
        const { data: brRow } = await supabaseAdmin
          .from('branches')
          .select('id')
          .eq('id', resolvedBranchId)
          .eq('business_id', businessId)
          .maybeSingle();
        if (!brRow) resolvedBranchId = null;
      }

      let resolvedRoleId = sanitizeUuid(p.roleId);
      if (resolvedRoleId) {
        const { data: roleRow } = await supabaseAdmin
          .from('user_roles')
          .select('id')
          .eq('id', resolvedRoleId)
          .eq('business_id', businessId)
          .maybeSingle();
        if (!roleRow) resolvedRoleId = null;
      }
      if (!resolvedRoleId) {
        const { data: roleByKey } = await supabaseAdmin
          .from('user_roles')
          .select('id')
          .eq('business_id', businessId)
          .eq('role_key', normRoleKey)
          .maybeSingle();
        resolvedRoleId = roleByKey?.id || null;
      }

      // Step 1: Create confirmed Supabase Auth user first to obtain authentic auth.users.id UUID
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: emailToUse,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          username: cleanUsername,
          employee_code: cleanCode || undefined,
          role: mode === 'seller' ? 'seller' : normRoleKey,
          business_id: businessId,
        },
      });

      if (authErr || !authData?.user?.id || !isValidUuid(authData.user.id)) {
        const msg = authErr?.message || 'Failed to create Supabase Auth user.';
        const status = msg.toLowerCase().includes('already') ? 409 : 400;
        return res.status(status).json({ error: msg });
      }

      const authUserId = authData.user.id;
      const now = new Date().toISOString();
      let createdProfile = false;
      let createdMembership = false;
      let insertedEmployeeId: string | null = null;

      const rollbackCreatedAccount = async () => {
        try {
          if (insertedEmployeeId) {
            await supabaseAdmin.from('employees').delete().eq('id', insertedEmployeeId);
          }
          if (createdMembership) {
            await supabaseAdmin
              .from('business_users')
              .delete()
              .eq('business_id', businessId)
              .eq('user_id', authUserId);
          }
          if (createdProfile) {
            await supabaseAdmin.from('user_profiles').delete().eq('id', authUserId);
          }
        } finally {
          await supabaseAdmin.auth.admin.deleteUser(authUserId);
        }
      };

      try {
        // Step 2: Persist user_profiles
        const { error: profErr } = await supabaseAdmin.from('user_profiles').upsert({
          id: authUserId,
          email: emailToUse,
          full_name: fullName,
          username: cleanUsername,
          mobile: phone,
          updated_at: now,
        });
        if (profErr) {
          throw new Error(`Failed to create user profile: ${profErr.message}`);
        }
        createdProfile = true;

        // Step 3: Persist business_users
        const { error: buErr } = await supabaseAdmin.from('business_users').upsert(
          {
            business_id: businessId,
            user_id: authUserId,
            branch_id: resolvedBranchId,
            role: legacyRole,
            status: accountStatus === 'active' ? 'active' : 'suspended',
            updated_at: now,
          },
          { onConflict: 'business_id,user_id' }
        );
        if (buErr) {
          throw new Error(`Failed to link business membership: ${buErr.message}`);
        }
        createdMembership = true;

        if (mode === 'seller') {
          return res.status(201).json({ userId: authUserId, email: emailToUse });
        }

        // Step 4: Persist employees record with exact auth.users.id UUID
        const { data: empInserted, error: empErr } = await supabaseAdmin
          .from('employees')
          .insert({
            business_id: businessId,
            branch_id: resolvedBranchId,
            user_id: authUserId,
            employee_code: cleanCode || null,
            name: fullName,
            username: cleanUsername,
            email: emailToUse,
            mobile: phone,
            position: String(p.position || p.roleName || normRoleKey).trim(),
            role: legacyRole,
            role_id: resolvedRoleId,
            role_key: normRoleKey,
            salary: Number(p.salary) || 0,
            joining_date: p.joiningDate || now.slice(0, 10),
            status: accountStatus === 'active' ? 'active' : 'inactive',
            account_status: accountStatus,
            created_by: caller.id,
            updated_at: now,
          })
          .select()
          .single();

        if (empErr || !empInserted) {
          throw new Error(empErr?.message || 'Failed to insert employee record.');
        }
        insertedEmployeeId = empInserted.id;

        return res.status(201).json({
          employee: empInserted,
          userId: authUserId,
        });
      } catch (dbErr: unknown) {
        await rollbackCreatedAccount();
        const message = dbErr instanceof Error ? dbErr.message : 'Failed to synchronize employee record.';
        return res.status(400).json({ error: message });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unexpected server error while creating staff account.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/staff/reset-password', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(501).json({
        code: 'SERVICE_ROLE_NOT_CONFIGURED',
        error: 'Server SUPABASE_SERVICE_ROLE_KEY is not configured.',
      });
    }

    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
    }

    const caller = authResult.user;
    const businessId = sanitizeUuid(req.body?.businessId);
    const employeeId = sanitizeUuid(req.body?.employeeId);
    const targetUserId = sanitizeUuid(req.body?.userId);
    const targetEmailHint = String(req.body?.email || '').trim().toLowerCase();
    const targetUsernameHint = String(req.body?.username || '').trim().toLowerCase().replace(/\s+/g, '_');
    const newPassword = String(req.body?.newPassword || '').trim();

    if (!businessId) {
      return res.status(400).json({ error: 'Invalid or missing businessId.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const authorized = await authorizeStaffPermission(supabaseAdmin, caller.id, businessId, 'admin_only');
    if (!authorized) {
      return res.status(403).json({
        error: 'Permission denied: only Business Owners / Admins can reset employee passwords.',
      });
    }

    let resolvedUserId: string | null = null;
    let targetLabel = 'Staff member';
    let empRow: EmpLinkRow | null = null;
    let repaired = false;
    let provisionedNewAuthUser = false;
    let finalUsername: string | null = null;
    let finalEmail: string | null = null;

    if (employeeId) {
      const { data: foundEmp, error: empErr } = await supabaseAdmin
        .from('employees')
        .select('id, business_id, branch_id, user_id, name, employee_code, username, email, mobile, role_key, role, account_status, status')
        .eq('id', employeeId)
        .maybeSingle();

      if (empErr) {
        return res.status(500).json({ error: `Failed to look up employee record: ${empErr.message}` });
      }
      if (!foundEmp) {
        return res.status(404).json({ error: 'Target employee record was not found.' });
      }
      if (foundEmp.business_id !== businessId) {
        return res.status(403).json({
          error: 'Access denied: target employee does not belong to your authorized business.',
        });
      }

      empRow = foundEmp as EmpLinkRow;
      targetLabel = `${empRow.name}${empRow.employee_code ? ` (${empRow.employee_code})` : ''}`;
      finalUsername = empRow.username;
      finalEmail = empRow.email;

      const candidateUid = sanitizeUuid(empRow.user_id);
      if (candidateUid) {
        const { data: existingAuthUser, error: fetchAuthErr } =
          await supabaseAdmin.auth.admin.getUserById(candidateUid);
        if (!fetchAuthErr && existingAuthUser?.user) {
          resolvedUserId = candidateUid;
          finalEmail = empRow.email || existingAuthUser.user.email || null;
        }
      }

      if (!resolvedUserId) {
        const lookup = await findSafeExistingAuthUserForEmployee(
          supabaseAdmin,
          empRow,
          businessId,
          targetEmailHint,
          targetUsernameHint
        );

        if (lookup.conflictError) {
          return res.status(409).json({ error: lookup.conflictError });
        }

        if (lookup.authUser) {
          resolvedUserId = lookup.authUser.id;
          finalEmail = (empRow.email || lookup.authUser.email || '').trim().toLowerCase() || null;
          finalUsername =
            empRow.username ||
            (typeof lookup.authUser.user_metadata?.username === 'string'
              ? lookup.authUser.user_metadata.username.trim().toLowerCase()
              : null);

          try {
            await syncEmployeeProfileAndMembership(
              supabaseAdmin,
              empRow,
              resolvedUserId,
              finalEmail || '',
              finalUsername,
              businessId
            );
          } catch (syncErr: unknown) {
            return res.status(400).json({
              error: syncErr instanceof Error ? syncErr.message : 'Failed to link existing Auth user.',
            });
          }
          repaired = true;
        } else {
          const normRoleKey = normalizeRoleKey(empRow.role_key || empRow.role);
          let candidateUsername =
            (empRow.username || targetUsernameHint || slugifyUsername(empRow.name, empRow.id))
              .trim()
              .toLowerCase()
              .replace(/\s+/g, '_');

          const { data: usernameCollision } = await supabaseAdmin
            .from('employees')
            .select('id')
            .eq('business_id', businessId)
            .eq('username', candidateUsername)
            .neq('id', empRow.id)
            .maybeSingle();

          if (usernameCollision) {
            candidateUsername = `${candidateUsername}_${empRow.id.slice(0, 4)}`;
          }

          const explicitEmail = (empRow.email || targetEmailHint || '').trim().toLowerCase();
          let candidateEmail = explicitEmail || `${candidateUsername}@amardokanpro.internal`;
          const takenEmails = new Set(
            lookup.allUsers.map(u => (u.email || '').trim().toLowerCase()).filter(Boolean)
          );

          if (takenEmails.has(candidateEmail)) {
            if (explicitEmail) {
              return res.status(409).json({
                error: `Email "${explicitEmail}" is already used by another Supabase Auth user. Update this employee's email to a unique address first.`,
              });
            }
            candidateUsername = `${candidateUsername}_${empRow.id.slice(0, 4)}`;
            candidateEmail = `${candidateUsername}.${empRow.id.slice(0, 6)}@amardokanpro.internal`;
          }

          const { data: createdAuth, error: createAuthErr } =
            await supabaseAdmin.auth.admin.createUser({
              email: candidateEmail,
              password: newPassword,
              email_confirm: true,
              user_metadata: {
                full_name: empRow.name,
                username: candidateUsername,
                employee_code: empRow.employee_code || undefined,
                role: normRoleKey,
                business_id: businessId,
              },
            });

          if (createAuthErr || !createdAuth?.user?.id) {
            return res.status(400).json({
              error:
                createAuthErr?.message ||
                'Failed to create & link Supabase Auth account for this employee.',
            });
          }

          const newAuthUserId = createdAuth.user.id;
          try {
            await syncEmployeeProfileAndMembership(
              supabaseAdmin,
              empRow,
              newAuthUserId,
              candidateEmail,
              candidateUsername,
              businessId
            );
          } catch (syncErr: unknown) {
            await supabaseAdmin.auth.admin.deleteUser(newAuthUserId);
            return res.status(400).json({
              error:
                syncErr instanceof Error ? syncErr.message : 'Failed to synchronize employee Auth link.',
            });
          }

          resolvedUserId = newAuthUserId;
          finalUsername = empRow.username || candidateUsername;
          finalEmail = empRow.email || candidateEmail;
          repaired = true;
          provisionedNewAuthUser = true;
        }
      }
    } else if (targetUserId) {
      const [{ data: buMember }, { data: empMember }] = await Promise.all([
        supabaseAdmin
          .from('business_users')
          .select('user_id')
          .eq('business_id', businessId)
          .eq('user_id', targetUserId)
          .maybeSingle(),
        supabaseAdmin
          .from('employees')
          .select('id, user_id, name, employee_code, username, email')
          .eq('business_id', businessId)
          .eq('user_id', targetUserId)
          .maybeSingle(),
      ]);
      if (!buMember && !empMember) {
        return res.status(403).json({
          error: 'Access denied: target staff account does not belong to your authorized business.',
        });
      }
      resolvedUserId = targetUserId;
      if (empMember?.name) {
        targetLabel = `${empMember.name}${empMember.employee_code ? ` (${empMember.employee_code})` : ''}`;
        finalUsername = empMember.username || null;
        finalEmail = empMember.email || null;
      }
    } else {
      return res.status(400).json({
        error: 'Missing target employeeId or userId for password reset.',
      });
    }

    if (!resolvedUserId) {
      return res.status(400).json({
        error: 'Unable to resolve a Supabase Auth account for this employee.',
      });
    }

    if (!provisionedNewAuthUser) {
      const { data: existingAuthUser, error: fetchAuthErr } =
        await supabaseAdmin.auth.admin.getUserById(resolvedUserId);

      if (fetchAuthErr || !existingAuthUser?.user) {
        return res.status(404).json({
          error: 'Linked Supabase Auth user was not found in auth.users. Re-link or recreate this staff login account.',
        });
      }

      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(resolvedUserId, {
        password: newPassword,
        email_confirm: true,
      });

      if (updErr) {
        return res.status(400).json({
          error: updErr.message || 'Failed to update employee password in Supabase Auth.',
        });
      }

      if (!finalEmail && existingAuthUser.user.email) {
        finalEmail = existingAuthUser.user.email;
      }
    }

    const loginHint = [
      finalUsername ? `Username: ${finalUsername}` : null,
      empRow?.employee_code ? `Employee ID: ${empRow.employee_code}` : null,
      finalEmail ? `Email: ${finalEmail}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return res.status(200).json({
      success: true,
      repaired,
      userId: resolvedUserId,
      employeeId: empRow?.id || employeeId || null,
      username: finalUsername,
      email: finalEmail,
      employeeCode: empRow?.employee_code || null,
      message: provisionedNewAuthUser
        ? `Created & linked Supabase Auth login account for ${targetLabel} and set their password.${loginHint ? ` (${loginHint})` : ''}`
        : repaired
        ? `Linked existing Supabase Auth account & updated password for ${targetLabel}.${loginHint ? ` (${loginHint})` : ''}`
        : `Password updated successfully for ${targetLabel}. The employee can now sign in with their new password.${loginHint ? ` (${loginHint})` : ''}`,
    });
  });

  app.post('/api/staff/repair-links', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(501).json({
        code: 'SERVICE_ROLE_NOT_CONFIGURED',
        error: 'Server SUPABASE_SERVICE_ROLE_KEY is not configured.',
      });
    }

    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
    }

    const caller = authResult.user;
    const businessId = sanitizeUuid(req.body?.businessId);
    if (!businessId) {
      return res.status(400).json({ error: 'Invalid or missing businessId.' });
    }

    const authorized = await authorizeStaffPermission(supabaseAdmin, caller.id, businessId, 'admin_only');
    if (!authorized) {
      return res.status(403).json({
        error: 'Permission denied: only Business Owners / Admins can repair employee Auth links.',
      });
    }

    const { data: empList, error: empListErr } = await supabaseAdmin
      .from('employees')
      .select('id, business_id, branch_id, user_id, name, employee_code, username, email, mobile, role_key, role, account_status, status')
      .eq('business_id', businessId)
      .order('created_at', { ascending: true });

    if (empListErr) {
      return res.status(500).json({ error: `Failed to query employees: ${empListErr.message}` });
    }

    const allAuthUsers = await listAllAuthUsers(supabaseAdmin);
    const authUserMap = new Map(allAuthUsers.map(u => [u.id, u]));
    const repairedEmployees: Array<{ id: string; name: string; userId: string; email: string }> = [];
    const unlinkedEmployees: Array<{ id: string; name: string; employeeCode: string | null }> = [];
    let alreadyValidCount = 0;

    for (const row of (empList || []) as EmpLinkRow[]) {
      const currentUid = sanitizeUuid(row.user_id);
      if (currentUid && authUserMap.has(currentUid)) {
        const authUser = authUserMap.get(currentUid)!;
        await syncEmployeeProfileAndMembership(
          supabaseAdmin,
          row,
          currentUid,
          (row.email || authUser.email || '').trim().toLowerCase(),
          row.username || (typeof authUser.user_metadata?.username === 'string' ? authUser.user_metadata.username : null),
          businessId
        );
        alreadyValidCount += 1;
        continue;
      }

      if (currentUid && !authUserMap.has(currentUid)) {
        await supabaseAdmin
          .from('employees')
          .update({ user_id: null, updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('business_id', businessId);
        row.user_id = null;
      }

      const found = await findSafeExistingAuthUserForEmployee(
        supabaseAdmin,
        row,
        businessId,
        '',
        '',
        allAuthUsers
      );

      if (found.authUser) {
        const resolvedEmail = (row.email || found.authUser.email || '').trim().toLowerCase();
        const resolvedUsername =
          row.username ||
          (typeof found.authUser.user_metadata?.username === 'string'
            ? found.authUser.user_metadata.username.trim().toLowerCase()
            : null);
        await syncEmployeeProfileAndMembership(
          supabaseAdmin,
          row,
          found.authUser.id,
          resolvedEmail,
          resolvedUsername,
          businessId
        );
        repairedEmployees.push({
          id: row.id,
          name: row.name,
          userId: found.authUser.id,
          email: resolvedEmail,
        });
      } else {
        unlinkedEmployees.push({
          id: row.id,
          name: row.name,
          employeeCode: row.employee_code,
        });
      }
    }

    return res.status(200).json({
      success: true,
      alreadyValidCount,
      repairedCount: repairedEmployees.length,
      unlinkedRemaining: unlinkedEmployees.length,
      repairedEmployees,
      unlinkedEmployees,
    });
  });

  const authorizeCatalogPermission = async (
    supabaseAdmin: SupabaseClient,
    callerId: string,
    businessId: string,
    action: 'can_create' | 'can_edit' | 'can_delete'
  ): Promise<boolean> => {
    const [{ data: buRow }, { data: empRow }] = await Promise.all([
      supabaseAdmin
        .from('business_users')
        .select('role, status')
        .eq('business_id', businessId)
        .eq('user_id', callerId)
        .maybeSingle(),
      supabaseAdmin
        .from('employees')
        .select('role, role_id, role_key, account_status')
        .eq('business_id', businessId)
        .eq('user_id', callerId)
        .maybeSingle(),
    ]);

    if (!buRow && !empRow) return false;
    const empStatus = empRow?.account_status;
    const buStatus = buRow?.status || 'active';
    if (
      (empStatus && empStatus !== 'active') ||
      ['inactive', 'suspended', 'blocked'].includes(buStatus)
    ) {
      return false;
    }

    const effectiveRoleKey = normalizeRoleKey(
      empRow?.role_key || empRow?.role || buRow?.role || ''
    );
    if (effectiveRoleKey === 'super_admin') return true;
    if (['salesman', 'cashier'].includes(effectiveRoleKey)) return false;

    let roleId = empRow?.role_id || null;
    if (!roleId && effectiveRoleKey) {
      const { data: ur } = await supabaseAdmin
        .from('user_roles')
        .select('id')
        .eq('business_id', businessId)
        .eq('role_key', effectiveRoleKey)
        .maybeSingle();
      roleId = ur?.id || null;
    }
    if (!roleId) return false;

    const { data: perm } = await supabaseAdmin
      .from('role_permissions')
      .select('can_create, can_edit, can_delete')
      .eq('role_id', roleId)
      .eq('permission_key', 'product_management')
      .maybeSingle();

    if (!perm) return false;
    return Boolean(perm[action] || perm.can_edit);
  };

  app.post('/api/catalog/ensure-bucket', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(501).json({
        code: 'SERVICE_ROLE_NOT_CONFIGURED',
        error: 'Server SUPABASE_SERVICE_ROLE_KEY is not configured.',
      });
    }

    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
    }

    const businessId = sanitizeUuid(req.body?.businessId);
    if (!businessId) {
      return res.status(400).json({ error: 'Invalid or missing active businessId.' });
    }

    const authorized = await authorizeCatalogPermission(
      supabaseAdmin,
      authResult.user.id,
      businessId,
      'can_edit'
    );
    if (!authorized) {
      return res.status(403).json({
        error: 'Permission denied: you do not have permission to manage product catalog media.',
      });
    }

    try {
      const { data: existing } = await supabaseAdmin.storage.getBucket('product-images');
      if (!existing) {
        const { error: createErr } = await supabaseAdmin.storage.createBucket('product-images', {
          public: true,
          fileSizeLimit: 5 * 1024 * 1024,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        });
        if (createErr && !createErr.message.toLowerCase().includes('already exists')) {
          return res.status(500).json({ error: createErr.message });
        }
      }
      return res.status(200).json({ success: true, bucket: 'product-images' });
    } catch (err: unknown) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to verify product-images storage bucket.',
      });
    }
  });

  app.post(
    '/api/catalog/upload-image',
    express.raw({
      type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
      limit: '6mb',
    }),
    async (req, res) => {
      const supabaseAdmin = getSupabaseAdminClient();
      if (!supabaseAdmin) {
        return res.status(501).json({
          code: 'SERVICE_ROLE_NOT_CONFIGURED',
          error: 'Server SUPABASE_SERVICE_ROLE_KEY is not configured.',
        });
      }

      const authResult = await authenticateCaller(req, supabaseAdmin);
      if ('error' in authResult) {
        return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
      }

      const businessId = sanitizeUuid(req.headers['x-business-id']);
      const storagePath = String(req.headers['x-storage-path'] || '').replace(/^\/+/, '');
      const mimeType = String(req.headers['x-file-mime'] || req.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();

      if (!businessId || !storagePath || !storagePath.startsWith(`${businessId}/`)) {
        return res.status(400).json({ error: 'Invalid businessId or storage path.' });
      }

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        return res.status(400).json({
          error: 'Unsupported image format. Only JPG, JPEG, PNG, and WEBP are allowed.',
        });
      }

      const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
      if (bodyBuffer.length === 0 || bodyBuffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({
          error: 'Image size must be greater than 0 bytes and at most 5 MB.',
        });
      }

      const authorized = await authorizeCatalogPermission(
        supabaseAdmin,
        authResult.user.id,
        businessId,
        'can_create'
      );
      if (!authorized) {
        return res.status(403).json({
          error: 'Permission denied: you do not have permission to upload product photos.',
        });
      }

      try {
        const { data: existing } = await supabaseAdmin.storage.getBucket('product-images');
        if (!existing) {
          await supabaseAdmin.storage.createBucket('product-images', {
            public: true,
            fileSizeLimit: 5 * 1024 * 1024,
            allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          });
        }

        const { error: uploadErr } = await supabaseAdmin.storage
          .from('product-images')
          .upload(storagePath, bodyBuffer, {
            contentType: mimeType,
            upsert: true,
            cacheControl: '3600',
          });

        if (uploadErr) {
          return res.status(500).json({ error: uploadErr.message });
        }

        const { data: urlData } = supabaseAdmin.storage
          .from('product-images')
          .getPublicUrl(storagePath);

        return res.status(200).json({
          success: true,
          storagePath,
          publicUrl: urlData.publicUrl,
        });
      } catch (err: unknown) {
        return res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to upload product image.',
        });
      }
    }
  );

  app.post('/api/catalog/delete-storage-object', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(501).json({
        code: 'SERVICE_ROLE_NOT_CONFIGURED',
        error: 'Server SUPABASE_SERVICE_ROLE_KEY is not configured.',
      });
    }

    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
    }

    const businessId = sanitizeUuid(req.body?.businessId);
    const storagePath = String(req.body?.storagePath || '').replace(/^\/+/, '');
    if (!businessId || !storagePath || !storagePath.startsWith(`${businessId}/`)) {
      return res.status(400).json({ error: 'Invalid businessId or storagePath.' });
    }

    const authorized = await authorizeCatalogPermission(
      supabaseAdmin,
      authResult.user.id,
      businessId,
      'can_delete'
    );
    if (!authorized) {
      return res.status(403).json({
        error: 'Permission denied to delete product images.',
      });
    }

    const { error } = await supabaseAdmin.storage.from('product-images').remove([storagePath]);
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Amar Dokan Pro server listening on http://0.0.0.0:${PORT}`);
  });
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('server.ts');

if (isDirectExecution) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
