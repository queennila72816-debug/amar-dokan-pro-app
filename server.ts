import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PORT = Number(process.env.PORT) || 3000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLATFORM_OWNER_EMAIL = 'queennila72816@gmail.com';
const PLATFORM_ROLES = ['SUPER_ADMIN', 'SUPPORT_ADMIN', 'BILLING_ADMIN', 'PLATFORM_VIEWER'] as const;

// In-memory sliding-window rate limiter for sensitive API routes
const rateLimitStore = new Map<string, number[]>();
function checkRateLimit(
  bucket: string,
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const composite = `${bucket}:${key}`;
  const existing = (rateLimitStore.get(composite) || []).filter(ts => now - ts < windowMs);
  if (existing.length >= maxRequests) {
    const oldest = existing[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    rateLimitStore.set(composite, existing);
    return { allowed: false, retryAfterSec };
  }
  existing.push(now);
  rateLimitStore.set(composite, existing);
  if (rateLimitStore.size > 5000) {
    for (const [k, list] of rateLimitStore.entries()) {
      if (list.every(ts => now - ts >= windowMs)) rateLimitStore.delete(k);
    }
  }
  return { allowed: true };
}

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

  if (!buRow && !empRow) {
    const { data: ownerBiz } = await supabaseAdmin
      .from('businesses')
      .select('id, owner_id, is_active')
      .eq('id', businessId)
      .eq('owner_id', callerId)
      .maybeSingle();

    if (ownerBiz && ownerBiz.is_active !== false) {
      return true;
    }
    return false;
  }

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

interface AuthenticatedCallerUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
}

async function authenticateCaller(
  req: express.Request,
  supabaseAdmin: SupabaseClient
): Promise<{ error: string; status: 401 | 403 | 503; code?: string } | { user: AuthenticatedCallerUser }> {
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

    return { user: data.user as AuthenticatedCallerUser };
  } catch {
    return {
      error: 'Authentication service is temporarily unreachable. Please retry.',
      status: 503,
      code: 'AUTH_SERVICE_UNAVAILABLE',
    };
  }
}

interface PlatformAdminRecord {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: 'SUPER_ADMIN' | 'SUPPORT_ADMIN' | 'BILLING_ADMIN' | 'PLATFORM_VIEWER';
  is_active: boolean;
  created_at?: string;
}

async function resolvePlatformAdmin(
  supabaseAdmin: SupabaseClient,
  caller: AuthenticatedCallerUser
): Promise<PlatformAdminRecord | null> {
  const { data: existing } = await supabaseAdmin
    .from('platform_admins')
    .select('id, user_id, email, full_name, role, is_active, created_at')
    .eq('user_id', caller.id)
    .eq('is_active', true)
    .maybeSingle();

  if (existing) {
    return existing as PlatformAdminRecord;
  }

  // Controlled bootstrap strictly limited to confirmed platform owner email
  const callerEmail = String(caller.email || '').trim().toLowerCase();
  if (callerEmail === PLATFORM_OWNER_EMAIL && Boolean(caller.email_confirmed_at)) {
    const fullName =
      typeof caller.user_metadata?.full_name === 'string' && caller.user_metadata.full_name.trim()
        ? caller.user_metadata.full_name.trim()
        : 'Platform Super Admin';

    const { data: bootstrapped } = await supabaseAdmin
      .from('platform_admins')
      .upsert(
        {
          user_id: caller.id,
          email: callerEmail,
          full_name: fullName,
          role: 'SUPER_ADMIN',
          is_active: true,
          assigned_by: caller.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select('id, user_id, email, full_name, role, is_active, created_at')
      .maybeSingle();

    if (bootstrapped) {
      await supabaseAdmin.from('platform_audit_logs').insert({
        actor_user_id: caller.id,
        actor_email: callerEmail,
        actor_role: 'SUPER_ADMIN',
        action: 'PLATFORM_SUPER_ADMIN_BOOTSTRAPPED',
        target_type: 'platform_admin',
        target_id: caller.id,
        details: 'Verified Platform Super Admin bootstrapped via server auth check',
      });
      return bootstrapped as PlatformAdminRecord;
    }
  }

  return null;
}

async function writePlatformAuditLog(
  supabaseAdmin: SupabaseClient,
  admin: { user_id: string; email?: string | null; role: string },
  entry: {
    action: string;
    targetType: string;
    targetId?: string | null;
    targetBusinessId?: string | null;
    details: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await supabaseAdmin.from('platform_audit_logs').insert({
      actor_user_id: admin.user_id,
      actor_email: admin.email || null,
      actor_role: admin.role,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId || null,
      target_business_id: sanitizeUuid(entry.targetBusinessId),
      details: entry.details,
      metadata: entry.metadata || {},
    });
  } catch (err) {
    console.warn('Audit log insert notice:', err);
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

  // Clean CORS & preflight handling for /api/* routes (including cross-origin previews)
  app.use('/api', (req, res, next) => {
    const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    const allowedEnv = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (requestOrigin) {
      if (allowedEnv.length === 0 || allowedEnv.includes(requestOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        res.setHeader('Vary', 'Origin');
      }
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Client-Info, Apikey, X-Supabase-Client-Platform'
    );

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  });

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

      const { data: existingEmpEmail } = await supabaseAdmin
        .from('employees')
        .select('id')
        .eq('business_id', businessId)
        .eq('email', emailToUse)
        .maybeSingle();

      if (existingEmpEmail) {
        return res.status(409).json({
          error: `An employee account with email "${emailToUse}" already exists in this business.`,
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

      // Check business_users + user_profiles for duplicate username or email (e.g. Sellers)
      const [{ data: matchingUsernames }, { data: matchingEmails }] = await Promise.all([
        supabaseAdmin
          .from('user_profiles')
          .select('id')
          .ilike('username', cleanUsername),
        supabaseAdmin
          .from('user_profiles')
          .select('id')
          .ilike('email', emailToUse),
      ]);

      const candidateUserIds = Array.from(
        new Set([
          ...(matchingUsernames || []).map((r: { id: string }) => r.id),
          ...(matchingEmails || []).map((r: { id: string }) => r.id),
        ])
      );

      if (candidateUserIds.length > 0) {
        const { data: existingMember } = await supabaseAdmin
          .from('business_users')
          .select('user_id')
          .eq('business_id', businessId)
          .in('user_id', candidateUserIds)
          .limit(1)
          .maybeSingle();

        if (existingMember) {
          const isUsernameMatch = (matchingUsernames || []).some(
            (r: { id: string }) => r.id === existingMember.user_id
          );
          return res.status(409).json({
            error: isUsernameMatch
              ? `Username "${cleanUsername}" is already assigned to another account in this business.`
              : `An account with email "${emailToUse}" already exists in this business.`,
          });
        }
      }

      const { data: bizExists } = await supabaseAdmin
        .from('businesses')
        .select('id, is_active, status')
        .eq('id', businessId)
        .maybeSingle();

      if (!bizExists) {
        return res.status(404).json({ error: 'Target business does not exist.' });
      }
      if (bizExists.is_active === false || bizExists.status === 'suspended') {
        return res.status(403).json({
          error: 'Business workspace is currently suspended. Activate the subscription before adding staff.',
        });
      }

      // Enforce subscription max_users limit
      const [{ data: bizSub }, { count: activeStaffCount }] = await Promise.all([
        supabaseAdmin
          .from('business_subscriptions')
          .select('max_users, status, plan_code, current_period_end, grace_period_ends_at')
          .eq('business_id', businessId)
          .maybeSingle(),
        supabaseAdmin
          .from('business_users')
          .select('user_id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('status', 'active'),
      ]);

      if (bizSub) {
        if (['suspended', 'cancelled', 'expired'].includes(bizSub.status)) {
          return res.status(403).json({
            error: `Subscription is ${bizSub.status}. Please renew your plan to add new staff accounts.`,
          });
        }
        const maxUsers = Number(bizSub.max_users || 0);
        if (maxUsers > 0 && Number(activeStaffCount || 0) >= maxUsers) {
          return res.status(403).json({
            code: 'PLAN_LIMIT_REACHED',
            error: `Plan limit reached: your current ${bizSub.plan_code} plan supports up to ${maxUsers} active users. Upgrade your subscription to add more staff.`,
          });
        }
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

      const isSyntheticInternalEmail = emailToUse.endsWith('@amardokanpro.internal');
      let resolvedAuthEmail = emailToUse;
      if (isSyntheticInternalEmail) {
        const { data: globalEmailHit } = await supabaseAdmin
          .from('user_profiles')
          .select('id')
          .ilike('email', resolvedAuthEmail)
          .limit(1)
          .maybeSingle();

        if (globalEmailHit) {
          resolvedAuthEmail = `${cleanUsername}.${businessId.slice(0, 6)}@amardokanpro.internal`;
        }
      }

      // Step 1: Create confirmed Supabase Auth user first (Admin API sends ZERO confirmation emails)
      let { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: resolvedAuthEmail,
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

      if (
        isSyntheticInternalEmail &&
        authErr &&
        authErr.message.toLowerCase().includes('already')
      ) {
        resolvedAuthEmail = `${cleanUsername}.${businessId.slice(0, 6)}.${crypto.randomBytes(2).toString('hex')}@amardokanpro.internal`;
        const retryAuth = await supabaseAdmin.auth.admin.createUser({
          email: resolvedAuthEmail,
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
        authData = retryAuth.data;
        authErr = retryAuth.error;
      }

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
          } else {
            await supabaseAdmin
              .from('employees')
              .delete()
              .eq('business_id', businessId)
              .eq('user_id', authUserId);
          }
        } catch {
          // continue full rollback
        }
        try {
          if (createdMembership) {
            await supabaseAdmin
              .from('business_users')
              .delete()
              .eq('business_id', businessId)
              .eq('user_id', authUserId);
          }
        } catch {
          // continue full rollback
        }
        try {
          if (createdProfile) {
            await supabaseAdmin.from('user_profiles').delete().eq('id', authUserId);
          }
        } catch {
          // continue full rollback
        }
        try {
          await supabaseAdmin.auth.admin.deleteUser(authUserId);
        } catch {
          // best-effort auth user cleanup
        }
      };

      try {
        // Step 2: Persist user_profiles
        const { error: profErr } = await supabaseAdmin.from('user_profiles').upsert({
          id: authUserId,
          email: resolvedAuthEmail,
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
          return res.status(201).json({ userId: authUserId, email: resolvedAuthEmail });
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
            email: resolvedAuthEmail,
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
        const status = message.toLowerCase().includes('duplicate') || message.toLowerCase().includes('unique') ? 409 : 400;
        return res.status(status).json({ error: message });
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

  // ===========================================================================
  // PLATFORM SUPER ADMIN & SAAS MULTI-TENANT ENDPOINTS
  // ===========================================================================
  const requirePlatformAdmin = async (
    req: express.Request,
    res: express.Response,
    allowedRoles?: ReadonlyArray<string>
  ): Promise<{
    supabaseAdmin: SupabaseClient;
    caller: AuthenticatedCallerUser;
    admin: PlatformAdminRecord;
  } | null> => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      res.status(501).json({
        code: 'SERVICE_ROLE_NOT_CONFIGURED',
        error: 'Server SUPABASE_SERVICE_ROLE_KEY is not configured.',
      });
      return null;
    }

    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
      return null;
    }

    const rl = checkRateLimit('platform_api', authResult.user.id, 180, 60_000);
    if (!rl.allowed) {
      res.status(429).json({ error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s.` });
      return null;
    }

    const admin = await resolvePlatformAdmin(supabaseAdmin, authResult.user);
    if (!admin) {
      res.status(403).json({
        error: 'Forbidden: Platform Administrator access is required.',
      });
      return null;
    }

    if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(admin.role)) {
      res.status(403).json({
        error: `Forbidden: requires one of [${allowedRoles.join(', ')}], current role is ${admin.role}.`,
      });
      return null;
    }

    return { supabaseAdmin, caller: authResult.user, admin };
  };

  app.get('/api/platform/me', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(200).json({ isPlatformAdmin: false, admin: null, serviceConfigured: false });
    }
    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
    }
    const admin = await resolvePlatformAdmin(supabaseAdmin, authResult.user);
    return res.status(200).json({
      isPlatformAdmin: Boolean(admin),
      admin,
      serviceConfigured: true,
    });
  });

  app.get('/api/platform/overview', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res);
    if (!ctx) return;
    const { supabaseAdmin } = ctx;

    const healthStart = Date.now();
    try {
      const [
        { data: businesses },
        { data: subs },
        { data: plans },
        { data: payments },
        { data: tickets },
        { data: profiles },
        storageCheck,
      ] = await Promise.all([
        supabaseAdmin.from('businesses').select('id, name, is_active, status, created_at, business_type').order('created_at', { ascending: false }),
        supabaseAdmin.from('business_subscriptions').select('*'),
        supabaseAdmin.from('subscription_plans').select('*'),
        supabaseAdmin.from('payments').select('*').order('created_at', { ascending: false }).limit(200),
        supabaseAdmin.from('support_tickets').select('id, status, priority, created_at'),
        supabaseAdmin.from('user_profiles').select('id', { count: 'exact', head: true }),
        supabaseAdmin.storage.listBuckets(),
      ]);

      const dbLatencyMs = Date.now() - healthStart;
      const bizList = (businesses || []) as Array<{ id: string; name: string; is_active: boolean | null; status: string | null; created_at: string; business_type?: string }>;
      const subList = (subs || []) as Array<Record<string, any>>;
      const planMap = new Map(((plans || []) as Array<Record<string, any>>).map(p => [p.id, p]));
      const payList = (payments || []) as Array<Record<string, any>>;
      const ticketList = (tickets || []) as Array<Record<string, any>>;

      const allAuthUsers = await listAllAuthUsers(supabaseAdmin);
      const totalRegisteredUsers = Math.max(allAuthUsers.length, Number((profiles as any)?.length || 0));

      let activeSubscriptions = 0;
      let trialBusinesses = 0;
      let expiredSubscriptions = 0;
      let suspendedBusinesses = 0;
      let mrr = 0;

      for (const b of bizList) {
        if (b.is_active === false || b.status === 'suspended') {
          suspendedBusinesses += 1;
        }
      }

      for (const s of subList) {
        const plan = planMap.get(s.plan_id);
        const st = String(s.status || '');
        const periodEnd = s.current_period_end ? new Date(s.current_period_end).getTime() : 0;
        const isPastEnd = periodEnd > 0 && periodEnd < Date.now();

        if (st === 'trialing') {
          trialBusinesses += 1;
          if (!isPastEnd) activeSubscriptions += 1;
          else expiredSubscriptions += 1;
        } else if (st === 'active') {
          activeSubscriptions += 1;
          if (plan) {
            const monthlyPrice = Number(plan.price_monthly || 0);
            const yearlyPrice = Number(plan.price_yearly || 0);
            mrr += s.billing_cycle === 'yearly' && yearlyPrice > 0 ? yearlyPrice / 12 : monthlyPrice;
          }
        } else if (st === 'expired' || st === 'cancelled' || st === 'past_due') {
          expiredSubscriptions += 1;
        }
      }

      const verifiedRevenueTotal = payList
        .filter(p => p.status === 'verified')
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const pendingPayments = payList.filter(p => p.status === 'pending');
      const openTicketsCount = ticketList.filter(t => t.status === 'open' || t.status === 'in_progress').length;

      return res.status(200).json({
        metrics: {
          totalBusinesses: bizList.length,
          activeBusinesses: bizList.filter(b => b.is_active !== false && b.status !== 'suspended').length,
          suspendedBusinesses,
          trialBusinesses,
          totalUsers: totalRegisteredUsers,
          activeSubscriptions,
          expiredSubscriptions,
          monthlyRecurringRevenue: Math.round(mrr * 100) / 100,
          annualRecurringRevenue: Math.round(mrr * 12 * 100) / 100,
          verifiedRevenueTotal: Math.round(verifiedRevenueTotal * 100) / 100,
          pendingPaymentsCount: pendingPayments.length,
          pendingPaymentsAmount: pendingPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
          openTicketsCount,
        },
        recentBusinesses: bizList.slice(0, 8),
        systemHealth: {
          database: dbLatencyMs < 1500 ? 'healthy' : 'degraded',
          dbLatencyMs,
          storage: storageCheck.error ? 'degraded' : 'healthy',
          bucketCount: storageCheck.data?.length || 0,
          authService: allAuthUsers ? 'healthy' : 'degraded',
          checkedAt: new Date().toISOString(),
        },
      });
    } catch (err: unknown) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load platform overview.',
      });
    }
  });

  app.get('/api/platform/businesses', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res);
    if (!ctx) return;
    const { supabaseAdmin } = ctx;

    try {
      const [
        { data: businesses, error: bErr },
        { data: subs },
        { data: plans },
        { data: branches },
        { data: buRows },
        { data: prodRows },
        { data: profiles },
      ] = await Promise.all([
        supabaseAdmin.from('businesses').select('*').order('created_at', { ascending: false }),
        supabaseAdmin.from('business_subscriptions').select('*'),
        supabaseAdmin.from('subscription_plans').select('id, code, name, price_monthly, price_yearly'),
        supabaseAdmin.from('branches').select('id, business_id'),
        supabaseAdmin.from('business_users').select('business_id, user_id, role, status'),
        supabaseAdmin.from('products').select('id, business_id'),
        supabaseAdmin.from('user_profiles').select('id, email, full_name, mobile, mobile_verified'),
      ]);

      if (bErr) throw bErr;

      const subByBiz = new Map(((subs || []) as Array<Record<string, any>>).map(s => [s.business_id, s]));
      const planById = new Map(((plans || []) as Array<Record<string, any>>).map(p => [p.id, p]));
      const profileById = new Map(((profiles || []) as Array<Record<string, any>>).map(p => [p.id, p]));

      const branchCountMap = new Map<string, number>();
      for (const br of (branches || []) as Array<{ business_id: string }>) {
        branchCountMap.set(br.business_id, (branchCountMap.get(br.business_id) || 0) + 1);
      }

      const productCountMap = new Map<string, number>();
      for (const pr of (prodRows || []) as Array<{ business_id: string }>) {
        productCountMap.set(pr.business_id, (productCountMap.get(pr.business_id) || 0) + 1);
      }

      const userCountMap = new Map<string, number>();
      const ownerByBiz = new Map<string, string>();
      for (const bu of (buRows || []) as Array<{ business_id: string; user_id: string; role: string; status: string }>) {
        if (!bu.status || bu.status === 'active') {
          userCountMap.set(bu.business_id, (userCountMap.get(bu.business_id) || 0) + 1);
        }
        if (normalizeRoleKey(bu.role) === 'super_admin' && !ownerByBiz.has(bu.business_id)) {
          ownerByBiz.set(bu.business_id, bu.user_id);
        }
      }

      const enriched = ((businesses || []) as Array<Record<string, any>>).map(b => {
        const sub = subByBiz.get(b.id) || null;
        const plan = sub?.plan_id ? planById.get(sub.plan_id) || null : null;
        const ownerUid = b.created_by || ownerByBiz.get(b.id) || null;
        const ownerProf = ownerUid ? profileById.get(ownerUid) || null : null;

        return {
          ...b,
          ownerEmail: ownerProf?.email || b.email || null,
          ownerMobileVerified: Boolean(ownerProf?.mobile_verified),
          branchCount: branchCountMap.get(b.id) || 0,
          userCount: userCountMap.get(b.id) || 0,
          productCount: productCountMap.get(b.id) || 0,
          subscription: sub ? { ...sub, plan } : null,
        };
      });

      return res.status(200).json({ businesses: enriched });
    } catch (err: unknown) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load platform businesses.',
      });
    }
  });

  app.patch('/api/platform/businesses/:id/status', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res, ['SUPER_ADMIN', 'SUPPORT_ADMIN']);
    if (!ctx) return;
    const { supabaseAdmin, admin } = ctx;

    const businessId = sanitizeUuid(req.params.id);
    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();
    if (!businessId || !['active', 'suspended'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Valid business ID and status (active | suspended) required.' });
    }

    const now = new Date().toISOString();
    const isActivating = nextStatus === 'active';
    const { data: updated, error } = await supabaseAdmin
      .from('businesses')
      .update({
        is_active: isActivating,
        status: nextStatus,
        suspended_reason: isActivating ? null : reason || 'Suspended by Platform Administrator',
        suspended_at: isActivating ? null : now,
        suspended_by: isActivating ? null : admin.user_id,
        updated_at: now,
      })
      .eq('id', businessId)
      .select()
      .single();

    if (error || !updated) {
      return res.status(400).json({ error: error?.message || 'Failed to update business status.' });
    }

    if (!isActivating) {
      await supabaseAdmin
        .from('business_subscriptions')
        .update({ status: 'suspended', updated_at: now })
        .eq('business_id', businessId);
    } else {
      await supabaseAdmin
        .from('business_subscriptions')
        .update({ status: 'active', updated_at: now })
        .eq('business_id', businessId)
        .eq('status', 'suspended');
    }

    await writePlatformAuditLog(supabaseAdmin, admin, {
      action: isActivating ? 'BUSINESS_ACTIVATED' : 'BUSINESS_SUSPENDED',
      targetType: 'business',
      targetId: businessId,
      targetBusinessId: businessId,
      details: `${isActivating ? 'Activated' : 'Suspended'} business "${updated.name}"${reason ? ` — Reason: ${reason}` : ''}`,
    });

    return res.status(200).json({ business: updated });
  });

  app.get('/api/platform/plans', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res);
    if (!ctx) return;
    const { data, error } = await ctx.supabaseAdmin
      .from('subscription_plans')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ plans: data || [] });
  });

  app.post('/api/platform/plans', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res, ['SUPER_ADMIN', 'BILLING_ADMIN']);
    if (!ctx) return;
    const p = req.body || {};
    const code = String(p.code || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    const name = String(p.name || '').trim();
    if (!code || !name) {
      return res.status(400).json({ error: 'Plan code and name are required.' });
    }

    const { data, error } = await ctx.supabaseAdmin
      .from('subscription_plans')
      .insert({
        code,
        name,
        description: String(p.description || '').trim(),
        price_monthly: Number(p.priceMonthly ?? p.price_monthly ?? 0),
        price_yearly: Number(p.priceYearly ?? p.price_yearly ?? 0),
        currency: String(p.currency || 'BDT').trim(),
        trial_days: Math.max(0, Number(p.trialDays ?? p.trial_days ?? 14)),
        grace_period_days: Math.max(0, Number(p.gracePeriodDays ?? p.grace_period_days ?? 7)),
        max_users: Math.max(0, Number(p.maxUsers ?? p.max_users ?? 5)),
        max_branches: Math.max(0, Number(p.maxBranches ?? p.max_branches ?? 1)),
        max_products: Math.max(0, Number(p.maxProducts ?? p.max_products ?? 500)),
        features: p.features && typeof p.features === 'object' ? p.features : {},
        is_active: p.isActive !== false,
        sort_order: Number(p.sortOrder ?? p.sort_order ?? 10),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !data) return res.status(400).json({ error: error?.message || 'Failed to create plan.' });

    await writePlatformAuditLog(ctx.supabaseAdmin, ctx.admin, {
      action: 'PLAN_CREATED',
      targetType: 'subscription_plan',
      targetId: data.id,
      details: `Created subscription plan ${data.name} (${data.code})`,
    });

    return res.status(201).json({ plan: data });
  });

  app.patch('/api/platform/plans/:id', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res, ['SUPER_ADMIN', 'BILLING_ADMIN']);
    if (!ctx) return;
    const planId = sanitizeUuid(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Invalid plan ID.' });
    const p = req.body || {};

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (p.name !== undefined) patch.name = String(p.name).trim();
    if (p.description !== undefined) patch.description = String(p.description).trim();
    if (p.priceMonthly !== undefined || p.price_monthly !== undefined) {
      patch.price_monthly = Math.max(0, Number(p.priceMonthly ?? p.price_monthly));
    }
    if (p.priceYearly !== undefined || p.price_yearly !== undefined) {
      patch.price_yearly = Math.max(0, Number(p.priceYearly ?? p.price_yearly));
    }
    if (p.trialDays !== undefined || p.trial_days !== undefined) {
      patch.trial_days = Math.max(0, Number(p.trialDays ?? p.trial_days));
    }
    if (p.gracePeriodDays !== undefined || p.grace_period_days !== undefined) {
      patch.grace_period_days = Math.max(0, Number(p.gracePeriodDays ?? p.grace_period_days));
    }
    if (p.maxUsers !== undefined || p.max_users !== undefined) {
      patch.max_users = Math.max(0, Number(p.maxUsers ?? p.max_users));
    }
    if (p.maxBranches !== undefined || p.max_branches !== undefined) {
      patch.max_branches = Math.max(0, Number(p.maxBranches ?? p.max_branches));
    }
    if (p.maxProducts !== undefined || p.max_products !== undefined) {
      patch.max_products = Math.max(0, Number(p.maxProducts ?? p.max_products));
    }
    if (p.isActive !== undefined || p.is_active !== undefined) {
      patch.is_active = Boolean(p.isActive ?? p.is_active);
    }
    if (p.features && typeof p.features === 'object') {
      patch.features = p.features;
    }

    const { data, error } = await ctx.supabaseAdmin
      .from('subscription_plans')
      .update(patch)
      .eq('id', planId)
      .select()
      .single();

    if (error || !data) return res.status(400).json({ error: error?.message || 'Failed to update plan.' });

    await writePlatformAuditLog(ctx.supabaseAdmin, ctx.admin, {
      action: 'PLAN_UPDATED',
      targetType: 'subscription_plan',
      targetId: planId,
      details: `Updated subscription plan ${data.name} (${data.code})`,
    });

    return res.status(200).json({ plan: data });
  });

  app.get('/api/platform/subscriptions', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res);
    if (!ctx) return;

    const [{ data: subs, error }, { data: plans }, { data: businesses }] = await Promise.all([
      ctx.supabaseAdmin.from('business_subscriptions').select('*').order('updated_at', { ascending: false }),
      ctx.supabaseAdmin.from('subscription_plans').select('*'),
      ctx.supabaseAdmin.from('businesses').select('id, name, phone, email, status, is_active'),
    ]);

    if (error) return res.status(500).json({ error: error.message });

    const planMap = new Map(((plans || []) as Array<Record<string, any>>).map(p => [p.id, p]));
    const bizMap = new Map(((businesses || []) as Array<Record<string, any>>).map(b => [b.id, b]));

    const enriched = ((subs || []) as Array<Record<string, any>>).map(s => ({
      ...s,
      plan: planMap.get(s.plan_id) || null,
      business: bizMap.get(s.business_id) || null,
    }));

    return res.status(200).json({ subscriptions: enriched });
  });

  app.post('/api/platform/subscriptions/assign', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res, ['SUPER_ADMIN', 'BILLING_ADMIN']);
    if (!ctx) return;
    const { supabaseAdmin, admin } = ctx;

    const businessId = sanitizeUuid(req.body?.businessId);
    const planCode = String(req.body?.planCode || '').trim().toLowerCase();
    const billingCycle = ['trial', 'monthly', 'yearly', 'lifetime'].includes(String(req.body?.billingCycle || '').toLowerCase())
      ? String(req.body?.billingCycle).toLowerCase()
      : 'monthly';
    const nextStatus = ['trialing', 'active', 'past_due', 'grace_period', 'suspended', 'expired', 'cancelled'].includes(
      String(req.body?.status || '').toLowerCase()
    )
      ? String(req.body?.status).toLowerCase()
      : 'active';
    const customDays = req.body?.durationDays ? Math.max(1, Number(req.body.durationDays)) : null;
    const notes = String(req.body?.notes || '').trim();

    if (!businessId || !planCode) {
      return res.status(400).json({ error: 'businessId and planCode are required.' });
    }

    const { data: plan } = await supabaseAdmin
      .from('subscription_plans')
      .select('*')
      .eq('code', planCode)
      .maybeSingle();

    if (!plan) {
      return res.status(404).json({ error: `Subscription plan "${planCode}" not found.` });
    }

    const days =
      customDays ??
      (billingCycle === 'lifetime'
        ? 36500
        : billingCycle === 'yearly'
        ? 365
        : billingCycle === 'trial'
        ? Math.max(7, Number(plan.trial_days || 14))
        : 30);

    const nowMs = Date.now();
    const periodEnd = new Date(nowMs + days * 86400_000).toISOString();
    const graceEnd = new Date(
      nowMs + (days + Number(plan.grace_period_days || 7)) * 86400_000
    ).toISOString();

    const { data: sub, error } = await supabaseAdmin
      .from('business_subscriptions')
      .upsert(
        {
          business_id: businessId,
          plan_id: plan.id,
          plan_code: plan.code,
          billing_cycle: billingCycle,
          status: nextStatus,
          current_period_start: new Date(nowMs).toISOString(),
          current_period_end: periodEnd,
          grace_period_ends_at: graceEnd,
          max_users: plan.max_users,
          max_branches: plan.max_branches,
          max_products: plan.max_products,
          notes: notes || `Assigned by ${admin.email}`,
          updated_by: admin.user_id,
          updated_at: new Date(nowMs).toISOString(),
        },
        { onConflict: 'business_id' }
      )
      .select()
      .single();

    if (error || !sub) {
      return res.status(400).json({ error: error?.message || 'Failed to update business subscription.' });
    }

    if (nextStatus === 'active' || nextStatus === 'trialing') {
      await supabaseAdmin
        .from('businesses')
        .update({ is_active: true, status: 'active', suspended_reason: null, suspended_at: null, updated_at: new Date().toISOString() })
        .eq('id', businessId);
    } else if (nextStatus === 'suspended') {
      await supabaseAdmin
        .from('businesses')
        .update({ is_active: false, status: 'suspended', suspended_reason: notes || 'Subscription suspended', suspended_at: new Date().toISOString(), suspended_by: admin.user_id, updated_at: new Date().toISOString() })
        .eq('id', businessId);
    }

    await writePlatformAuditLog(supabaseAdmin, admin, {
      action: 'SUBSCRIPTION_ASSIGNED',
      targetType: 'business_subscription',
      targetId: sub.id,
      targetBusinessId: businessId,
      details: `Assigned plan ${plan.name} (${billingCycle}, status: ${nextStatus})`,
    });

    return res.status(200).json({ subscription: { ...sub, plan } });
  });

  app.get('/api/platform/payments', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res);
    if (!ctx) return;

    const [{ data: payments, error }, { data: businesses }, { data: plans }] = await Promise.all([
      ctx.supabaseAdmin.from('payments').select('*').order('created_at', { ascending: false }).limit(300),
      ctx.supabaseAdmin.from('businesses').select('id, name, phone, email'),
      ctx.supabaseAdmin.from('subscription_plans').select('id, code, name'),
    ]);

    if (error) return res.status(500).json({ error: error.message });

    const bizMap = new Map(((businesses || []) as Array<Record<string, any>>).map(b => [b.id, b]));
    const planMap = new Map(((plans || []) as Array<Record<string, any>>).map(p => [p.id, p]));

    const enriched = ((payments || []) as Array<Record<string, any>>).map(p => ({
      ...p,
      businessName: bizMap.get(p.business_id)?.name || 'Unknown Business',
      planName: p.plan_id ? planMap.get(p.plan_id)?.name || null : null,
    }));

    return res.status(200).json({ payments: enriched });
  });

  app.patch('/api/platform/payments/:id', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res, ['SUPER_ADMIN', 'BILLING_ADMIN']);
    if (!ctx) return;
    const { supabaseAdmin, admin } = ctx;

    const paymentId = sanitizeUuid(req.params.id);
    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    const adminNote = String(req.body?.adminNote || req.body?.admin_note || '').trim();

    if (!paymentId || !['verified', 'rejected', 'refunded'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Valid paymentId and status (verified | rejected | refunded) required.' });
    }

    const { data: existingPay, error: fetchErr } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (fetchErr || !existingPay) {
      return res.status(404).json({ error: 'Payment record not found.' });
    }

    const now = new Date().toISOString();
    const { data: updatedPay, error: updErr } = await supabaseAdmin
      .from('payments')
      .update({
        status: nextStatus,
        admin_note: adminNote || existingPay.admin_note,
        verified_by: admin.user_id,
        verified_at: now,
        updated_at: now,
      })
      .eq('id', paymentId)
      .select()
      .single();

    if (updErr || !updatedPay) {
      return res.status(400).json({ error: updErr?.message || 'Failed to update payment.' });
    }

    // If verified, automatically activate/extend the business subscription and unlock business
    if (nextStatus === 'verified' && existingPay.status !== 'verified') {
      const { data: plan } = existingPay.plan_id
        ? await supabaseAdmin.from('subscription_plans').select('*').eq('id', existingPay.plan_id).maybeSingle()
        : { data: null };

      const { data: curSub } = await supabaseAdmin
        .from('business_subscriptions')
        .select('*')
        .eq('business_id', existingPay.business_id)
        .maybeSingle();

      const durationDays = existingPay.billing_cycle === 'yearly' ? 365 : 30;
      const baseMs = Math.max(
        Date.now(),
        curSub?.current_period_end ? new Date(curSub.current_period_end).getTime() : 0
      );
      const nextEnd = new Date(baseMs + durationDays * 86400_000).toISOString();
      const nextGrace = new Date(
        baseMs + (durationDays + Number(plan?.grace_period_days ?? 7)) * 86400_000
      ).toISOString();

      await supabaseAdmin.from('business_subscriptions').upsert(
        {
          id: curSub?.id,
          business_id: existingPay.business_id,
          plan_id: plan?.id || curSub?.plan_id,
          plan_code: plan?.code || curSub?.plan_code || 'standard',
          billing_cycle: existingPay.billing_cycle || 'monthly',
          status: 'active',
          current_period_start: now,
          current_period_end: nextEnd,
          grace_period_ends_at: nextGrace,
          max_users: plan?.max_users ?? curSub?.max_users ?? 15,
          max_branches: plan?.max_branches ?? curSub?.max_branches ?? 3,
          max_products: plan?.max_products ?? curSub?.max_products ?? 5000,
          updated_by: admin.user_id,
          updated_at: now,
        },
        { onConflict: 'business_id' }
      );

      await supabaseAdmin
        .from('businesses')
        .update({ is_active: true, status: 'active', suspended_reason: null, suspended_at: null, updated_at: now })
        .eq('id', existingPay.business_id);
    }

    await writePlatformAuditLog(supabaseAdmin, admin, {
      action: `PAYMENT_${nextStatus.toUpperCase()}`,
      targetType: 'payment',
      targetId: paymentId,
      targetBusinessId: existingPay.business_id,
      details: `${nextStatus.toUpperCase()} payment ${existingPay.invoice_number} (৳${existingPay.amount}, ${existingPay.gateway_provider})`,
    });

    return res.status(200).json({ payment: updatedPay });
  });

  app.get('/api/platform/tickets', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res);
    if (!ctx) return;

    const [{ data: tickets, error }, { data: businesses }] = await Promise.all([
      ctx.supabaseAdmin.from('support_tickets').select('*').order('created_at', { ascending: false }).limit(200),
      ctx.supabaseAdmin.from('businesses').select('id, name, phone'),
    ]);
    if (error) return res.status(500).json({ error: error.message });

    const bizMap = new Map(((businesses || []) as Array<Record<string, any>>).map(b => [b.id, b]));
    const enriched = ((tickets || []) as Array<Record<string, any>>).map(t => ({
      ...t,
      businessName: bizMap.get(t.business_id)?.name || 'Unknown Business',
    }));

    return res.status(200).json({ tickets: enriched });
  });

  app.patch('/api/platform/tickets/:id', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res, ['SUPER_ADMIN', 'SUPPORT_ADMIN']);
    if (!ctx) return;
    const { supabaseAdmin, admin } = ctx;

    const ticketId = sanitizeUuid(req.params.id);
    if (!ticketId) return res.status(400).json({ error: 'Invalid ticket ID.' });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (req.body?.status && ['open', 'in_progress', 'resolved', 'closed'].includes(String(req.body.status))) {
      patch.status = String(req.body.status);
      if (patch.status === 'resolved' || patch.status === 'closed') {
        patch.resolved_by = admin.user_id;
        patch.resolved_at = new Date().toISOString();
      }
    }
    if (req.body?.priority && ['low', 'medium', 'high', 'urgent'].includes(String(req.body.priority))) {
      patch.priority = String(req.body.priority);
    }
    if (req.body?.adminResponse !== undefined) {
      patch.admin_response = String(req.body.adminResponse).trim();
    }

    const { data, error } = await supabaseAdmin
      .from('support_tickets')
      .update(patch)
      .eq('id', ticketId)
      .select()
      .single();

    if (error || !data) return res.status(400).json({ error: error?.message || 'Failed to update ticket.' });

    await writePlatformAuditLog(supabaseAdmin, admin, {
      action: 'SUPPORT_TICKET_UPDATED',
      targetType: 'support_ticket',
      targetId: ticketId,
      targetBusinessId: data.business_id,
      details: `Updated support ticket "${data.subject}" -> status: ${data.status}`,
    });

    return res.status(200).json({ ticket: data });
  });

  app.get('/api/platform/admins', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res, ['SUPER_ADMIN', 'SUPPORT_ADMIN', 'PLATFORM_VIEWER', 'BILLING_ADMIN']);
    if (!ctx) return;

    const { data, error } = await ctx.supabaseAdmin
      .from('platform_admins')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ admins: data || [] });
  });

  app.post('/api/platform/admins', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res, ['SUPER_ADMIN']);
    if (!ctx) return;
    const { supabaseAdmin, admin } = ctx;

    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = String(req.body?.role || 'SUPPORT_ADMIN').trim().toUpperCase();
    const fullName = String(req.body?.fullName || '').trim();

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid registered user email is required.' });
    }
    if (!PLATFORM_ROLES.includes(role as any)) {
      return res.status(400).json({ error: `Invalid platform role: ${role}` });
    }

    const allAuthUsers = await listAllAuthUsers(supabaseAdmin);
    const targetUser = allAuthUsers.find(u => (u.email || '').trim().toLowerCase() === email);
    if (!targetUser) {
      return res.status(404).json({
        error: `No Supabase Auth account found for ${email}. Ask them to register and verify their email first.`,
      });
    }

    const resolvedName =
      fullName ||
      (typeof targetUser.user_metadata?.full_name === 'string' ? targetUser.user_metadata.full_name : '') ||
      email.split('@')[0];

    const { data, error } = await supabaseAdmin
      .from('platform_admins')
      .upsert(
        {
          user_id: targetUser.id,
          email,
          full_name: resolvedName,
          role,
          is_active: true,
          assigned_by: admin.user_id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error || !data) {
      return res.status(400).json({ error: error?.message || 'Failed to assign platform admin role.' });
    }

    await writePlatformAuditLog(supabaseAdmin, admin, {
      action: 'PLATFORM_ADMIN_ASSIGNED',
      targetType: 'platform_admin',
      targetId: targetUser.id,
      details: `Assigned platform role ${role} to ${email}`,
    });

    return res.status(201).json({ admin: data });
  });

  app.patch('/api/platform/admins/:id', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res, ['SUPER_ADMIN']);
    if (!ctx) return;
    const { supabaseAdmin, admin } = ctx;

    const targetId = sanitizeUuid(req.params.id);
    if (!targetId) return res.status(400).json({ error: 'Invalid admin record ID.' });

    const { data: existing } = await supabaseAdmin
      .from('platform_admins')
      .select('*')
      .eq('id', targetId)
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Platform admin record not found.' });

    if (existing.email.toLowerCase() === PLATFORM_OWNER_EMAIL && (req.body?.isActive === false || (req.body?.role && req.body.role !== 'SUPER_ADMIN'))) {
      return res.status(403).json({
        error: 'Protected account: primary Platform Super Admin cannot be deactivated or demoted.',
      });
    }
    if (existing.user_id === admin.user_id && req.body?.isActive === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own active Super Admin access.' });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (req.body?.role && PLATFORM_ROLES.includes(String(req.body.role).toUpperCase() as any)) {
      patch.role = String(req.body.role).toUpperCase();
    }
    if (req.body?.isActive !== undefined) {
      patch.is_active = Boolean(req.body.isActive);
    }

    const { data, error } = await supabaseAdmin
      .from('platform_admins')
      .update(patch)
      .eq('id', targetId)
      .select()
      .single();

    if (error || !data) return res.status(400).json({ error: error?.message || 'Failed to update platform admin.' });

    await writePlatformAuditLog(supabaseAdmin, admin, {
      action: 'PLATFORM_ADMIN_UPDATED',
      targetType: 'platform_admin',
      targetId: existing.user_id,
      details: `Updated platform admin ${existing.email} (role: ${data.role}, active: ${data.is_active})`,
    });

    return res.status(200).json({ admin: data });
  });

  app.get('/api/platform/settings', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res);
    if (!ctx) return;
    const { data, error } = await ctx.supabaseAdmin.from('platform_settings').select('*');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ settings: data || [] });
  });

  app.patch('/api/platform/settings', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res, ['SUPER_ADMIN']);
    if (!ctx) return;
    const key = String(req.body?.key || '').trim();
    const value = req.body?.value;
    if (!key || !value || typeof value !== 'object') {
      return res.status(400).json({ error: 'Setting key and object value required.' });
    }

    const { data, error } = await ctx.supabaseAdmin
      .from('platform_settings')
      .upsert(
        { key, value, updated_by: ctx.admin.user_id, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
      .select()
      .single();

    if (error || !data) return res.status(400).json({ error: error?.message || 'Failed to save platform settings.' });

    await writePlatformAuditLog(ctx.supabaseAdmin, ctx.admin, {
      action: 'PLATFORM_SETTINGS_UPDATED',
      targetType: 'platform_settings',
      targetId: key,
      details: `Updated platform settings section "${key}"`,
    });

    return res.status(200).json({ setting: data });
  });

  app.get('/api/platform/audit-logs', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res);
    if (!ctx) return;
    const { data, error } = await ctx.supabaseAdmin
      .from('platform_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ logs: data || [] });
  });

  app.get('/api/platform/security', async (req, res) => {
    const ctx = await requirePlatformAdmin(req, res);
    if (!ctx) return;

    const [{ data: blockedLogins }, { data: unlinkedEmployees }, { data: suspendedStaff }] = await Promise.all([
      ctx.supabaseAdmin
        .from('user_activity_logs')
        .select('id, business_id, employee_name, employee_code, role_key, event_type, details, created_at')
        .eq('event_type', 'LOGIN_BLOCKED')
        .order('created_at', { ascending: false })
        .limit(50),
      ctx.supabaseAdmin
        .from('employees')
        .select('id, business_id, name, employee_code, role_key, account_status')
        .is('user_id', null)
        .limit(100),
      ctx.supabaseAdmin
        .from('employees')
        .select('id, business_id, name, employee_code, role_key, account_status, updated_at')
        .in('account_status', ['suspended', 'blocked', 'inactive'])
        .order('updated_at', { ascending: false })
        .limit(50),
    ]);

    return res.status(200).json({
      blockedLogins: blockedLogins || [],
      unlinkedEmployees: unlinkedEmployees || [],
      suspendedStaff: suspendedStaff || [],
    });
  });

  // ===========================================================================
  // SAAS TENANT SELF-SERVICE ENDPOINTS (/api/saas/*)
  // ===========================================================================
  app.get('/api/saas/plans', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(501).json({ code: 'SERVICE_ROLE_NOT_CONFIGURED', error: 'Service key unavailable.' });
    }
    const [{ data: plans, error }, { data: billingSetting }] = await Promise.all([
      supabaseAdmin.from('subscription_plans').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      supabaseAdmin.from('platform_settings').select('value').eq('key', 'billing_instructions').maybeSingle(),
    ]);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({
      plans: plans || [],
      billingInstructions: billingSetting?.value || null,
    });
  });

  app.post('/api/saas/send-mobile-otp', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(501).json({ code: 'SERVICE_ROLE_NOT_CONFIGURED', error: 'Service key unavailable.' });
    }
    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
    }

    const rl = checkRateLimit('mobile_otp_send', authResult.user.id, 5, 10 * 60_000);
    if (!rl.allowed) {
      return res.status(429).json({
        error: `Too many OTP requests. Please wait ${rl.retryAfterSec}s before trying again.`,
      });
    }

    const rawPhone = String(req.body?.phone || '').replace(/[\s-]/g, '').trim();
    if (!/^\+?[0-9]{10,15}$/.test(rawPhone)) {
      return res.status(400).json({ error: 'Please enter a valid mobile number (e.g. 017XXXXXXXX or +88017XXXXXXXX).' });
    }

    const otpCode = String(crypto.randomInt(100000, 999999));
    const salt = crypto.randomBytes(12).toString('hex');
    const otpHash = `${salt}:${crypto.createHash('sha256').update(`${salt}:${otpCode}`).digest('hex')}`;
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

    const { error: insErr } = await supabaseAdmin.from('mobile_otp_verifications').insert({
      user_id: authResult.user.id,
      phone: rawPhone,
      otp_hash: otpHash,
      expires_at: expiresAt,
    });

    if (insErr) {
      return res.status(500).json({ error: `Failed to generate OTP: ${insErr.message}` });
    }

    // Dispatch via configured SMS Gateway URL if present; otherwise provide verification preview fallback
    const smsGatewayUrl = (process.env.SMS_GATEWAY_URL || '').trim();
    if (smsGatewayUrl) {
      try {
        await fetch(smsGatewayUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.SMS_GATEWAY_TOKEN ? { Authorization: `Bearer ${process.env.SMS_GATEWAY_TOKEN}` } : {}),
          },
          body: JSON.stringify({
            to: rawPhone,
            message: `Your PROTIVA verification code is ${otpCode}. Valid for 5 minutes.`,
          }),
        });
        return res.status(200).json({
          success: true,
          deliveryMode: 'sms',
          expiresInSeconds: 300,
          message: `Verification code sent via SMS to ${rawPhone}.`,
        });
      } catch (smsErr) {
        console.warn('SMS gateway delivery fallback:', smsErr);
      }
    }

    return res.status(200).json({
      success: true,
      deliveryMode: 'verification_preview',
      previewCode: otpCode,
      expiresInSeconds: 300,
      message: `SMS Gateway not configured in environment — use verification code ${otpCode} to confirm your mobile number.`,
    });
  });

  app.post('/api/saas/verify-mobile-otp', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(501).json({ code: 'SERVICE_ROLE_NOT_CONFIGURED', error: 'Service key unavailable.' });
    }
    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
    }

    const rl = checkRateLimit('mobile_otp_verify', authResult.user.id, 10, 10 * 60_000);
    if (!rl.allowed) {
      return res.status(429).json({
        error: `Too many failed OTP attempts. Please retry in ${rl.retryAfterSec}s.`,
      });
    }

    const rawPhone = String(req.body?.phone || '').replace(/[\s-]/g, '').trim();
    const code = String(req.body?.code || '').trim();
    if (!rawPhone || !/^[0-9]{6}$/.test(code)) {
      return res.status(400).json({ error: 'Valid phone number and 6-digit OTP code are required.' });
    }

    const { data: otpRow } = await supabaseAdmin
      .from('mobile_otp_verifications')
      .select('*')
      .eq('user_id', authResult.user.id)
      .eq('phone', rawPhone)
      .is('verified_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRow) {
      return res.status(400).json({ error: 'No pending OTP request found for this number. Please request a new code.' });
    }
    if (new Date(otpRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Verification code expired. Please request a fresh OTP.' });
    }
    if (Number(otpRow.attempts || 0) >= 5) {
      return res.status(429).json({ error: 'Maximum OTP verification attempts exceeded. Please request a new OTP.' });
    }

    const [salt, storedHash] = String(otpRow.otp_hash || '').split(':');
    const computedHash = crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');

    if (!salt || !storedHash || computedHash !== storedHash) {
      await supabaseAdmin
        .from('mobile_otp_verifications')
        .update({ attempts: Number(otpRow.attempts || 0) + 1 })
        .eq('id', otpRow.id);
      return res.status(400).json({ error: 'Incorrect 6-digit OTP code. Please check and try again.' });
    }

    const now = new Date().toISOString();
    await Promise.all([
      supabaseAdmin
        .from('mobile_otp_verifications')
        .update({ verified_at: now })
        .eq('id', otpRow.id),
      supabaseAdmin.from('user_profiles').upsert(
        {
          id: authResult.user.id,
          email: authResult.user.email || '',
          full_name:
            typeof authResult.user.user_metadata?.full_name === 'string'
              ? authResult.user.user_metadata.full_name
              : authResult.user.email?.split('@')[0] || 'Business Owner',
          mobile: rawPhone,
          mobile_verified: true,
          mobile_verified_at: now,
          updated_at: now,
        },
        { onConflict: 'id' }
      ),
    ]);

    return res.status(200).json({ verified: true, phone: rawPhone, verifiedAt: now });
  });

  app.get('/api/saas/subscription/:businessId', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(501).json({ code: 'SERVICE_ROLE_NOT_CONFIGURED', error: 'Service key unavailable.' });
    }
    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
    }

    const businessId = sanitizeUuid(req.params.businessId);
    if (!businessId) return res.status(400).json({ error: 'Invalid businessId.' });

    const { data: buRow } = await supabaseAdmin
      .from('business_users')
      .select('business_id, role, status')
      .eq('business_id', businessId)
      .eq('user_id', authResult.user.id)
      .maybeSingle();

    const admin = !buRow ? await resolvePlatformAdmin(supabaseAdmin, authResult.user) : null;
    if (!buRow && !admin) {
      return res.status(403).json({ error: 'Access denied to this business subscription.' });
    }

    const [
      { data: sub },
      { data: plans },
      { data: payments },
      { count: userCount },
      { count: branchCount },
      { count: productCount },
      { data: billingSetting },
    ] = await Promise.all([
      supabaseAdmin.from('business_subscriptions').select('*').eq('business_id', businessId).maybeSingle(),
      supabaseAdmin.from('subscription_plans').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      supabaseAdmin.from('payments').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(50),
      supabaseAdmin.from('business_users').select('user_id', { count: 'exact', head: true }).eq('business_id', businessId).eq('status', 'active'),
      supabaseAdmin.from('branches').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
      supabaseAdmin.from('products').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
      supabaseAdmin.from('platform_settings').select('value').eq('key', 'billing_instructions').maybeSingle(),
    ]);

    const plan = sub?.plan_id ? (plans || []).find((p: any) => p.id === sub.plan_id) || null : null;

    return res.status(200).json({
      subscription: sub ? { ...sub, plan } : null,
      plans: plans || [],
      payments: payments || [],
      billingInstructions: billingSetting?.value || null,
      usage: {
        users: Number(userCount || 0),
        branches: Number(branchCount || 0),
        products: Number(productCount || 0),
      },
    });
  });

  app.post('/api/saas/submit-payment', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(501).json({ code: 'SERVICE_ROLE_NOT_CONFIGURED', error: 'Service key unavailable.' });
    }
    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
    }

    const rl = checkRateLimit('submit_payment', authResult.user.id, 10, 10 * 60_000);
    if (!rl.allowed) {
      return res.status(429).json({ error: `Too many payment submissions. Please retry in ${rl.retryAfterSec}s.` });
    }

    const businessId = sanitizeUuid(req.body?.businessId);
    const planCode = String(req.body?.planCode || '').trim().toLowerCase();
    const billingCycle = String(req.body?.billingCycle || 'monthly').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
    const paymentMethod = String(req.body?.paymentMethod || 'bkash').trim();
    const transactionId = String(req.body?.transactionId || '').trim();
    const senderNumber = String(req.body?.senderNumber || '').trim();

    if (!businessId || !planCode || !transactionId) {
      return res.status(400).json({ error: 'Business ID, Plan, and Transaction ID are required.' });
    }

    const isBizAdmin = await authorizeStaffPermission(supabaseAdmin, authResult.user.id, businessId, 'admin_only');
    if (!isBizAdmin) {
      return res.status(403).json({ error: 'Only the Business Owner or Admin can submit subscription payments.' });
    }

    const { data: plan } = await supabaseAdmin
      .from('subscription_plans')
      .select('*')
      .eq('code', planCode)
      .eq('is_active', true)
      .maybeSingle();

    if (!plan) return res.status(404).json({ error: 'Selected plan not found.' });

    const amount = billingCycle === 'yearly' ? Number(plan.price_yearly || 0) : Number(plan.price_monthly || 0);
    if (amount <= 0) {
      return res.status(400).json({ error: 'Selected plan does not require a payment.' });
    }

    const { data: sub } = await supabaseAdmin
      .from('business_subscriptions')
      .select('id')
      .eq('business_id', businessId)
      .maybeSingle();

    const invoiceNumber = `SUB-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${crypto.randomInt(1000, 9999)}`;

    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .insert({
        business_id: businessId,
        subscription_id: sub?.id || null,
        plan_id: plan.id,
        invoice_number: invoiceNumber,
        amount,
        currency: plan.currency || 'BDT',
        billing_cycle: billingCycle,
        payment_method: paymentMethod,
        gateway_provider: paymentMethod,
        transaction_id: transactionId,
        sender_number: senderNumber || null,
        status: 'pending',
        submitted_by: authResult.user.id,
      })
      .select()
      .single();

    if (error || !payment) {
      return res.status(400).json({ error: error?.message || 'Failed to record payment submission.' });
    }

    return res.status(201).json({
      payment,
      message: `Payment ${invoiceNumber} submitted for verification. Your plan will activate upon billing verification.`,
    });
  });

  app.get('/api/saas/tickets', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(501).json({ code: 'SERVICE_ROLE_NOT_CONFIGURED', error: 'Service key unavailable.' });
    }
    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
    }

    const businessId = sanitizeUuid(req.query?.businessId);
    if (!businessId) return res.status(400).json({ error: 'businessId query parameter is required.' });

    const { data: member } = await supabaseAdmin
      .from('business_users')
      .select('user_id')
      .eq('business_id', businessId)
      .eq('user_id', authResult.user.id)
      .maybeSingle();

    if (!member) return res.status(403).json({ error: 'Access denied to business support tickets.' });

    const { data, error } = await supabaseAdmin
      .from('support_tickets')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tickets: data || [] });
  });

  app.post('/api/saas/tickets', async (req, res) => {
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return res.status(501).json({ code: 'SERVICE_ROLE_NOT_CONFIGURED', error: 'Service key unavailable.' });
    }
    const authResult = await authenticateCaller(req, supabaseAdmin);
    if ('error' in authResult) {
      return res.status(authResult.status).json({ error: authResult.error, code: authResult.code });
    }

    const businessId = sanitizeUuid(req.body?.businessId);
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();
    const category = ['billing', 'technical', 'account', 'feature_request', 'general'].includes(String(req.body?.category || 'general'))
      ? String(req.body?.category)
      : 'general';
    const priority = ['low', 'medium', 'high', 'urgent'].includes(String(req.body?.priority || 'medium'))
      ? String(req.body?.priority)
      : 'medium';

    if (!businessId || !subject || !message) {
      return res.status(400).json({ error: 'businessId, subject, and message are required.' });
    }

    const { data: member } = await supabaseAdmin
      .from('business_users')
      .select('user_id')
      .eq('business_id', businessId)
      .eq('user_id', authResult.user.id)
      .maybeSingle();

    if (!member) return res.status(403).json({ error: 'Access denied.' });

    const { data, error } = await supabaseAdmin
      .from('support_tickets')
      .insert({
        business_id: businessId,
        created_by: authResult.user.id,
        created_by_email: authResult.user.email || null,
        subject,
        message,
        category,
        priority,
        status: 'open',
      })
      .select()
      .single();

    if (error || !data) return res.status(400).json({ error: error?.message || 'Failed to create support ticket.' });
    return res.status(201).json({ ticket: data });
  });

  app.get('/api/public-config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.json(getPublicBrowserConfig());
  });

  // Explicit JSON guards so /api/* never falls through to Vite/static HTML
  app.all('/api/staff/*', (req, res) => {
    return res.status(405).json({ error: `Method ${req.method} is not allowed on ${req.path}. Use POST.` });
  });

  app.use('/api', (_req, res) => {
    return res.status(404).json({ error: 'API endpoint not found.' });
  });

  return app;
}

function getPublicBrowserConfig() {
  const clean = (v?: string) => (v || '').trim().replace(/^['"]+|['"]+$/g, '');
  const url = clean(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
  const anon = clean(
    process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY
  );
  return {
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_ANON_KEY: anon.startsWith('sb_secret_') ? '' : anon,
  };
}

function injectPublicConfigIntoHtml(html: string): string {
  const configJson = JSON.stringify(getPublicBrowserConfig()).replace(/</g, '\\u003c');
  const injection = `<script>window.__PROTIVA_PUBLIC_CONFIG__=${configJson};</script>`;
  return html.includes('</head>') ? html.replace('</head>', `${injection}</head>`) : `${injection}${html}`;
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

    app.use(async (req, res, next) => {
      const reqPath = req.path || '';
      const acceptsHtml = (req.headers.accept || '').includes('text/html');
      const isDirectHtmlRoute = reqPath === '/' || reqPath === '/index.html';
      const isSpaNavigation =
        req.method === 'GET' &&
        acceptsHtml &&
        !reqPath.startsWith('/api/') &&
        !reqPath.startsWith('/src/') &&
        !reqPath.startsWith('/node_modules/') &&
        !reqPath.startsWith('/@') &&
        !path.extname(reqPath);

      if (req.method === 'GET' && (isDirectHtmlRoute || isSpaNavigation)) {
        try {
          const templatePath = path.resolve(process.cwd(), 'index.html');
          const template = fs.readFileSync(templatePath, 'utf8');
          const transformed = await vite.transformIndexHtml(req.originalUrl, template);
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          return res.status(200).type('html').send(injectPublicConfigIntoHtml(transformed));
        } catch (err) {
          return next(err);
        }
      }
      return next();
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');

    app.use(
      express.static(distDir, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.endsWith('.html') || filePath.endsWith('.webmanifest') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
          res.setHeader('X-Content-Type-Options', 'nosniff');
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      const indexPath = path.join(distDir, 'index.html');
      try {
        const html = fs.readFileSync(indexPath, 'utf8');
        res.type('html').send(injectPublicConfigIntoHtml(html));
      } catch {
        res.sendFile(indexPath);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const publicCfg = getPublicBrowserConfig();
    console.log(`PROTIVA server listening on http://0.0.0.0:${PORT}`);
    console.log('[PROTIVA] Server env presence:', {
      VITE_SUPABASE_URL: Boolean(publicCfg.VITE_SUPABASE_URL),
      VITE_SUPABASE_ANON_KEY: Boolean(publicCfg.VITE_SUPABASE_ANON_KEY),
      SUPABASE_SERVICE_ROLE_KEY: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()),
    });
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
