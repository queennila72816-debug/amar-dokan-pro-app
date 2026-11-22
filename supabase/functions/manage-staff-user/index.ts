import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BASE_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-api-version, traceparent, tracestate',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = (req?.headers.get('origin') || '').trim();
  const allowedEnv = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (origin) {
    try {
      const parsed = new URL(origin);
      const isLocal =
        parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
      const isHttps = parsed.protocol === 'https:';
      const isAllowed =
        allowedEnv.length > 0 ? allowedEnv.includes(parsed.origin) : isHttps || isLocal;

      if (isAllowed) {
        return {
          ...BASE_CORS_HEADERS,
          'Access-Control-Allow-Origin': parsed.origin,
          Vary: 'Origin',
        };
      }
    } catch {
      // Ignore malformed origin header
    }
  }

  return BASE_CORS_HEADERS;
}

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

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  req?: Request
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}

async function authorizeBusinessStaffAction(
  supabaseAdmin: ReturnType<typeof createClient>,
  callerId: string,
  businessId: string,
  requiredAction: 'create' | 'edit' | 'admin_only'
): Promise<{ authorized: boolean; reason?: string }> {
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
      return { authorized: true };
    }

    return {
      authorized: false,
      reason: 'Permission denied: you are not a member of this authorized business.',
    };
  }

  const empStatus = empRow?.account_status;
  const buStatus = buRow?.status || 'active';
  if (
    (empStatus && empStatus !== 'active') ||
    ['inactive', 'suspended', 'blocked'].includes(buStatus)
  ) {
    return {
      authorized: false,
      reason: 'Permission denied: your account is currently inactive or suspended.',
    };
  }

  const effectiveRoleKey = normalizeRoleKey(
    empRow?.role_key || empRow?.role || buRow?.role || ''
  );

  // Store Owner / Admin / Super Admin
  if (effectiveRoleKey === 'super_admin') {
    return { authorized: true };
  }

  // Strict Admin-only operations (e.g. direct staff password reset)
  if (requiredAction === 'admin_only') {
    return {
      authorized: false,
      reason: 'Permission denied: only Business Owners / Admins can reset employee passwords.',
    };
  }

  if (['salesman', 'cashier'].includes(effectiveRoleKey)) {
    return {
      authorized: false,
      reason: 'Permission denied: insufficient privileges for user management.',
    };
  }

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

  if (!roleId) {
    return {
      authorized: false,
      reason: 'Permission denied: your role does not have staff management access.',
    };
  }

  const { data: perm } = await supabaseAdmin
    .from('role_permissions')
    .select('can_create, can_edit')
    .eq('role_id', roleId)
    .eq('permission_key', 'user_management')
    .maybeSingle();

  const allowed = requiredAction === 'create' ? Boolean(perm?.can_create) : Boolean(perm?.can_edit);
  return allowed
    ? { authorized: true }
    : { authorized: false, reason: 'Permission denied: missing user_management permission.' };
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

async function listAllAuthUsers(
  supabaseAdmin: ReturnType<typeof createClient>
): Promise<AuthUserLite[]> {
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
  supabaseAdmin: ReturnType<typeof createClient>,
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
  supabaseAdmin: ReturnType<typeof createClient>,
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
  supabaseAdmin: ReturnType<typeof createClient>,
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

  // Fast check via user_profiles + business_users in same business
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

  // Deep verified scan of auth.users
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: getCorsHeaders(req) });
  }

  const respond = (payload: Record<string, unknown>, status = 200) =>
    jsonResponse(payload, status, req);

  if (req.method !== 'POST') {
    return respond({ error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return respond(
        { error: 'Edge Function is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY secret.' },
        500
      );
    }

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return respond({ error: 'Authentication required: missing Bearer token.' }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Verify requesting user's authenticated Supabase session on the server
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(token);
    if (callerErr || !callerData?.user || callerData.user.is_anonymous) {
      return respond({ error: 'Invalid or expired authentication session. Please sign in again.' }, 401);
    }

    const bannedUntil = callerData.user.banned_until ? new Date(callerData.user.banned_until).getTime() : 0;
    if (bannedUntil && bannedUntil > Date.now()) {
      return respond({ error: 'Access denied: your account is currently suspended.' }, 403);
    }

    const caller = callerData.user;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return respond({ error: 'Invalid JSON request payload.' }, 400);
    }

    const action = String(body.action || 'create_employee');
    const businessId = sanitizeUuid(body.businessId);

    if (!businessId) {
      return respond({ error: 'Invalid or missing authorized businessId.' }, 400);
    }

    // =========================================================================
    // ACTION: ADMIN-ONLY EMPLOYEE AUTH LINK AUDIT & REPAIR
    // =========================================================================
    if (action === 'repair_employee_links') {
      const authCheck = await authorizeBusinessStaffAction(
        supabaseAdmin,
        caller.id,
        businessId,
        'admin_only'
      );
      if (!authCheck.authorized) {
        return respond(
          { error: authCheck.reason || 'Permission denied: Admin role required.' },
          403
        );
      }

      const { data: empList, error: empListErr } = await supabaseAdmin
        .from('employees')
        .select('id, business_id, branch_id, user_id, name, employee_code, username, email, mobile, role_key, role, account_status, status')
        .eq('business_id', businessId)
        .order('created_at', { ascending: true });

      if (empListErr) {
        return respond({ error: `Failed to query employees: ${empListErr.message}` }, 500);
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

        // Clear stale invalid user_id if it no longer exists in auth.users
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

      return respond({
        success: true,
        alreadyValidCount,
        repairedCount: repairedEmployees.length,
        unlinkedRemaining: unlinkedEmployees.length,
        repairedEmployees,
        unlinkedEmployees,
      });
    }

    // =========================================================================
    // ACTION: ADMIN-ONLY EMPLOYEE / SELLER PASSWORD RESET (AUTO-LINKS / PROVISIONS)
    // =========================================================================
    if (action === 'reset_password') {
      const authCheck = await authorizeBusinessStaffAction(
        supabaseAdmin,
        caller.id,
        businessId,
        'admin_only'
      );
      if (!authCheck.authorized) {
        return respond(
          { error: authCheck.reason || 'Permission denied: Admin role required.' },
          403
        );
      }

      const employeeId = sanitizeUuid(body.employeeId);
      const targetUserId = sanitizeUuid(body.userId);
      const targetEmailHint = String(body.email || '').trim().toLowerCase();
      const targetUsernameHint = String(body.username || '').trim().toLowerCase().replace(/\s+/g, '_');
      const newPassword = String(body.newPassword || '').trim();

      if (newPassword.length < 6) {
        return respond({ error: 'New password must be at least 6 characters.' }, 400);
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
          return respond({ error: `Failed to verify employee record: ${empErr.message}` }, 500);
        }
        if (!foundEmp) {
          return respond({ error: 'Target employee record was not found.' }, 404);
        }
        if (foundEmp.business_id !== businessId) {
          return respond(
            { error: 'Access denied: target employee does not belong to your authorized business.' },
            403
          );
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

        // If employee has NULL user_id or stale UUID not in auth.users -> match safely or provision confirmed Auth user
        if (!resolvedUserId) {
          const lookup = await findSafeExistingAuthUserForEmployee(
            supabaseAdmin,
            empRow,
            businessId,
            targetEmailHint,
            targetUsernameHint
          );

          if (lookup.conflictError) {
            return respond({ error: lookup.conflictError }, 409);
          }

          if (lookup.authUser) {
            resolvedUserId = lookup.authUser.id;
            finalEmail = (empRow.email || lookup.authUser.email || '').trim().toLowerCase() || null;
            finalUsername =
              empRow.username ||
              (typeof lookup.authUser.user_metadata?.username === 'string'
                ? lookup.authUser.user_metadata.username.trim().toLowerCase()
                : null);

            await syncEmployeeProfileAndMembership(
              supabaseAdmin,
              empRow,
              resolvedUserId,
              finalEmail || '',
              finalUsername,
              businessId
            );
            repaired = true;
          } else {
            // No Auth account exists yet for this legacy employee -> create & link confirmed Auth user now
            const normRoleKey = normalizeRoleKey(empRow.role_key || empRow.role);
            let candidateUsername =
              (empRow.username || targetUsernameHint || slugifyUsername(empRow.name, empRow.id))
                .trim()
                .toLowerCase()
                .replace(/\s+/g, '_');

            // Ensure username uniqueness within the same business
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
                return respond(
                  {
                    error: `Email "${explicitEmail}" is already used by another Supabase Auth user. Update this employee's email to a unique address first.`,
                  },
                  409
                );
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
              return respond(
                {
                  error:
                    createAuthErr?.message ||
                    'Failed to create & link Supabase Auth account for this employee.',
                },
                400
              );
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
              const syncMsg =
                syncErr instanceof Error ? syncErr.message : 'Failed to synchronize employee Auth link.';
              return respond({ error: syncMsg }, 400);
            }

            resolvedUserId = newAuthUserId;
            finalUsername = empRow.username || candidateUsername;
            finalEmail = empRow.email || candidateEmail;
            repaired = true;
            provisionedNewAuthUser = true;
          }
        }
      } else if (targetUserId) {
        // Seller / direct staff reset by user_id: MUST verify target user belongs to the SAME business
        const [{ data: buMember }, { data: empMember }] = await Promise.all([
          supabaseAdmin
            .from('business_users')
            .select('user_id, role')
            .eq('business_id', businessId)
            .eq('user_id', targetUserId)
            .maybeSingle(),
          supabaseAdmin
            .from('employees')
            .select('id, user_id, name, employee_code, username, email, role_key, role')
            .eq('business_id', businessId)
            .eq('user_id', targetUserId)
            .maybeSingle(),
        ]);

        if (!buMember && !empMember) {
          return respond(
            { error: 'Access denied: target staff account does not belong to your authorized business.' },
            403
          );
        }
        resolvedUserId = targetUserId;
        if (empMember?.name) {
          targetLabel = `${empMember.name}${empMember.employee_code ? ` (${empMember.employee_code})` : ''}`;
          finalUsername = empMember.username || null;
          finalEmail = empMember.email || null;
        }
      } else {
        return respond(
          { error: 'Missing target employeeId or userId for password reset.' },
          400
        );
      }

      if (!resolvedUserId) {
        return respond(
          { error: 'Unable to resolve a Supabase Auth account for this employee.' },
          400
        );
      }

      if (!provisionedNewAuthUser) {
        const { data: existingAuthUser, error: fetchAuthErr } =
          await supabaseAdmin.auth.admin.getUserById(resolvedUserId);

        if (fetchAuthErr || !existingAuthUser?.user) {
          return respond(
            {
              error:
                'Linked Supabase Auth user was not found in auth.users. Please retry to re-provision their login account.',
            },
            404
          );
        }

        // Update password via Supabase Admin Auth API and mark email confirmed so login works immediately
        const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(resolvedUserId, {
          password: newPassword,
          email_confirm: true,
        });

        if (updErr) {
          return respond(
            { error: updErr.message || 'Failed to update employee password in Supabase Auth.' },
            400
          );
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

      return respond(
        {
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
        },
        200
      );
    }

    if (action !== 'create_employee' && action !== 'create_seller') {
      return respond({ error: `Unsupported action "${action}".` }, 400);
    }

    const createAuthCheck = await authorizeBusinessStaffAction(
      supabaseAdmin,
      caller.id,
      businessId,
      'create'
    );
    if (!createAuthCheck.authorized) {
      return respond(
        { error: createAuthCheck.reason || 'Permission denied: cannot create staff accounts.' },
        403
      );
    }

    const p = (body.payload || {}) as Record<string, unknown>;
    const fullName = String(p.fullName || '').trim();
    const rawUsername = String(p.username || '').trim();
    const cleanUsername = rawUsername.toLowerCase().replace(/\s+/g, '_');
    const cleanCode = String(p.employeeCode || '').trim().toUpperCase();
    const password = String(p.password || '');
    const phone = String(p.phone || '').trim();
    const emailToUse = (String(p.email || '').trim() || `${cleanUsername}@amardokanpro.internal`).toLowerCase();
    const normRoleKey = normalizeRoleKey(String(p.roleKey || 'salesman'));
    const legacyRole = action === 'create_seller' ? 'seller' : roleKeyToLegacyUserRole(normRoleKey);
    const accountStatus = ['active', 'inactive', 'suspended', 'blocked'].includes(
      String(p.accountStatus || 'active')
    )
      ? String(p.accountStatus || 'active')
      : 'active';

    if (!fullName || !cleanUsername || password.length < 6) {
      return respond(
        { error: 'Full Name, Username, and Password (min 6 chars) are required.' },
        400
      );
    }

    // Check duplicates in business before touching auth.users
    const { data: existingEmpUser } = await supabaseAdmin
      .from('employees')
      .select('id')
      .eq('business_id', businessId)
      .eq('username', cleanUsername)
      .maybeSingle();
    if (existingEmpUser) {
      return respond(
        { error: `Username "${cleanUsername}" is already assigned to another staff member.` },
        409
      );
    }

    const { data: existingEmpEmail } = await supabaseAdmin
      .from('employees')
      .select('id')
      .eq('business_id', businessId)
      .eq('email', emailToUse)
      .maybeSingle();
    if (existingEmpEmail) {
      return respond(
        { error: `An employee account with email "${emailToUse}" already exists in this business.` },
        409
      );
    }

    if (cleanCode) {
      const { data: existingEmpCode } = await supabaseAdmin
        .from('employees')
        .select('id')
        .eq('business_id', businessId)
        .eq('employee_code', cleanCode)
        .maybeSingle();
      if (existingEmpCode) {
        return respond({ error: `Employee ID "${cleanCode}" already exists.` }, 409);
      }
    }

    // Check business_users + user_profiles for duplicate username or email (e.g. Sellers)
    const [{ data: matchingUsernames }, { data: matchingEmails }] = await Promise.all([
      supabaseAdmin.from('user_profiles').select('id').ilike('username', cleanUsername),
      supabaseAdmin.from('user_profiles').select('id').ilike('email', emailToUse),
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
        return respond(
          {
            error: isUsernameMatch
              ? `Username "${cleanUsername}" is already assigned to another account in this business.`
              : `An account with email "${emailToUse}" already exists in this business.`,
          },
          409
        );
      }
    }

    // Verify business status and subscription max_users quota
    const { data: bizExists } = await supabaseAdmin
      .from('businesses')
      .select('id, is_active, status')
      .eq('id', businessId)
      .maybeSingle();

    if (!bizExists) {
      return respond({ error: 'Target business does not exist.' }, 404);
    }
    if (bizExists.is_active === false || bizExists.status === 'suspended') {
      return respond(
        { error: 'Business workspace is currently suspended. Activate the subscription before adding staff.' },
        403
      );
    }

    const [{ data: bizSub }, { count: activeStaffCount }] = await Promise.all([
      supabaseAdmin
        .from('business_subscriptions')
        .select('max_users, status, plan_code')
        .eq('business_id', businessId)
        .maybeSingle(),
      supabaseAdmin
        .from('business_users')
        .select('user_id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('status', 'active'),
    ]);

    if (bizSub) {
      if (['suspended', 'cancelled', 'expired'].includes(String(bizSub.status || ''))) {
        return respond(
          { error: `Subscription is ${bizSub.status}. Please renew your plan to add new staff accounts.` },
          403
        );
      }
      const maxUsers = Number(bizSub.max_users || 0);
      if (maxUsers > 0 && Number(activeStaffCount || 0) >= maxUsers) {
        return respond(
          {
            code: 'PLAN_LIMIT_REACHED',
            error: `Plan limit reached: your current ${bizSub.plan_code} plan supports up to ${maxUsers} active users. Upgrade your subscription to add more staff.`,
          },
          403
        );
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

    // 1. Create authentic, email-confirmed Supabase Auth user (Admin API sends ZERO emails)
    let { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: resolvedAuthEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        username: cleanUsername,
        employee_code: cleanCode || undefined,
        role: action === 'create_seller' ? 'seller' : normRoleKey,
        business_id: businessId,
      },
    });

    if (
      isSyntheticInternalEmail &&
      authErr &&
      authErr.message.toLowerCase().includes('already')
    ) {
      resolvedAuthEmail = `${cleanUsername}.${businessId.slice(0, 6)}.${crypto.randomUUID().slice(0, 4)}@amardokanpro.internal`;
      const retryAuth = await supabaseAdmin.auth.admin.createUser({
        email: resolvedAuthEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          username: cleanUsername,
          employee_code: cleanCode || undefined,
          role: action === 'create_seller' ? 'seller' : normRoleKey,
          business_id: businessId,
        },
      });
      authData = retryAuth.data;
      authErr = retryAuth.error;
    }

    if (authErr || !authData?.user?.id || !isValidUuid(authData.user.id)) {
      const msg = authErr?.message || 'Failed to create Supabase Auth user.';
      const status = msg.toLowerCase().includes('already') ? 409 : 400;
      return respond({ error: msg }, status);
    }

    const authUserId = authData.user.id;
    const now = new Date().toISOString();
    let insertedEmployeeId: string | null = null;
    let createdBusinessUser = false;
    let createdProfile = false;

    const rollback = async () => {
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
        if (createdBusinessUser) {
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
      // 2. Insert user_profiles
      const { error: profErr } = await supabaseAdmin.from('user_profiles').upsert({
        id: authUserId,
        email: resolvedAuthEmail,
        full_name: fullName,
        username: cleanUsername,
        mobile: phone,
        updated_at: now,
      });
      if (profErr) throw new Error(`Failed to create user profile: ${profErr.message}`);
      createdProfile = true;

      // 3. Insert business_users
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
      if (buErr) throw new Error(`Failed to assign business membership: ${buErr.message}`);
      createdBusinessUser = true;

      if (action === 'create_seller') {
        return respond({ userId: authUserId, email: resolvedAuthEmail }, 201);
      }

      // 4. Insert employees with authentic auth.users.id as user_id
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
          joining_date: (p.joiningDate as string) || now.slice(0, 10),
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

      return respond({ employee: empInserted, userId: authUserId }, 201);
    } catch (dbErr: unknown) {
      await rollback();
      const message = dbErr instanceof Error ? dbErr.message : 'Database synchronization failed.';
      const status =
        message.toLowerCase().includes('duplicate') || message.toLowerCase().includes('unique')
          ? 409
          : 400;
      return respond({ error: message }, status);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    return respond({ error: message }, 500);
  }
});
