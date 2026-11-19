import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        { error: 'Edge Function is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY secret.' },
        500
      );
    }

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return jsonResponse({ error: 'Authentication required: missing Bearer token.' }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Verify requesting user's authenticated Supabase session on the server
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(token);
    if (callerErr || !callerData?.user) {
      return jsonResponse({ error: 'Invalid or expired authentication session. Please sign in again.' }, 401);
    }

    const caller = callerData.user;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'Invalid JSON request payload.' }, 400);
    }

    const action = String(body.action || 'create_employee');
    const businessId = sanitizeUuid(body.businessId);

    if (!businessId) {
      return jsonResponse({ error: 'Invalid or missing authorized businessId.' }, 400);
    }

    // =========================================================================
    // ACTION: ADMIN-ONLY EMPLOYEE / SELLER PASSWORD RESET
    // =========================================================================
    if (action === 'reset_password') {
      const authCheck = await authorizeBusinessStaffAction(
        supabaseAdmin,
        caller.id,
        businessId,
        'admin_only'
      );
      if (!authCheck.authorized) {
        return jsonResponse(
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
        return jsonResponse({ error: 'New password must be at least 6 characters.' }, 400);
      }

      let resolvedUserId: string | null = null;
      let targetLabel = 'Staff member';
      let empRow: {
        id: string;
        business_id: string;
        user_id: string | null;
        name: string;
        employee_code: string | null;
        username: string | null;
        email: string | null;
        role_key: string | null;
        role: string | null;
      } | null = null;

      if (employeeId) {
        const { data: foundEmp, error: empErr } = await supabaseAdmin
          .from('employees')
          .select('id, business_id, user_id, name, employee_code, username, email, role_key, role')
          .eq('id', employeeId)
          .maybeSingle();

        if (empErr) {
          return jsonResponse({ error: `Failed to verify employee record: ${empErr.message}` }, 500);
        }
        if (!foundEmp) {
          return jsonResponse({ error: 'Target employee record was not found.' }, 404);
        }
        if (foundEmp.business_id !== businessId) {
          return jsonResponse(
            { error: 'Access denied: target employee does not belong to your authorized business.' },
            403
          );
        }

        empRow = foundEmp;
        targetLabel = `${foundEmp.name}${foundEmp.employee_code ? ` (${foundEmp.employee_code})` : ''}`;
        resolvedUserId = sanitizeUuid(foundEmp.user_id);

        // If an older employee record had user_id = NULL, resolve safely only within the SAME business
        if (!resolvedUserId) {
          const emailLookup = (foundEmp.email || targetEmailHint || '').trim().toLowerCase();
          const usernameLookup = (foundEmp.username || targetUsernameHint || '').trim().toLowerCase();

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
              resolvedUserId = buMatch.user_id;
              await supabaseAdmin
                .from('employees')
                .update({ user_id: resolvedUserId, updated_at: new Date().toISOString() })
                .eq('id', foundEmp.id)
                .eq('business_id', businessId);
            }
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
            .select('id, user_id, name, employee_code, role_key, role')
            .eq('business_id', businessId)
            .eq('user_id', targetUserId)
            .maybeSingle(),
        ]);

        if (!buMember && !empMember) {
          return jsonResponse(
            { error: 'Access denied: target staff account does not belong to your authorized business.' },
            403
          );
        }
        resolvedUserId = targetUserId;
        if (empMember?.name) {
          targetLabel = `${empMember.name}${empMember.employee_code ? ` (${empMember.employee_code})` : ''}`;
        }
      } else {
        return jsonResponse(
          { error: 'Missing target employeeId or userId for password reset.' },
          400
        );
      }

      if (!resolvedUserId) {
        return jsonResponse(
          {
            error:
              'This employee does not have a linked Supabase Auth login account yet. Create their staff account via "Add Employee Account" first.',
          },
          400
        );
      }

      // Verify target Auth user exists in auth.users before updating
      const { data: existingAuthUser, error: fetchAuthErr } =
        await supabaseAdmin.auth.admin.getUserById(resolvedUserId);

      if (fetchAuthErr || !existingAuthUser?.user) {
        return jsonResponse(
          {
            error:
              'Linked Supabase Auth user was not found in auth.users. Re-link or recreate this staff login account.',
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
        return jsonResponse(
          { error: updErr.message || 'Failed to update employee password in Supabase Auth.' },
          400
        );
      }

      return jsonResponse(
        {
          success: true,
          userId: resolvedUserId,
          employeeId: empRow?.id || employeeId || null,
          message: `Password updated successfully for ${targetLabel}. The employee can now sign in with their new password.`,
        },
        200
      );
    }

    if (action !== 'create_employee' && action !== 'create_seller') {
      return jsonResponse({ error: `Unsupported action "${action}".` }, 400);
    }

    const createAuthCheck = await authorizeBusinessStaffAction(
      supabaseAdmin,
      caller.id,
      businessId,
      'create'
    );
    if (!createAuthCheck.authorized) {
      return jsonResponse(
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
      return jsonResponse(
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
      return jsonResponse(
        { error: `Username "${cleanUsername}" is already assigned to another staff member.` },
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
        return jsonResponse({ error: `Employee ID "${cleanCode}" already exists.` }, 409);
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

    // 1. Create authentic, email-confirmed Supabase Auth user
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: emailToUse,
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

    if (authErr || !authData?.user?.id) {
      const msg = authErr?.message || 'Failed to create Supabase Auth user.';
      const status = msg.toLowerCase().includes('already') ? 409 : 400;
      return jsonResponse({ error: msg }, status);
    }

    const authUserId = authData.user.id;
    const now = new Date().toISOString();
    let insertedEmployeeId: string | null = null;
    let createdBusinessUser = false;
    let createdProfile = false;

    const rollback = async () => {
      if (insertedEmployeeId) {
        await supabaseAdmin.from('employees').delete().eq('id', insertedEmployeeId);
      }
      if (createdBusinessUser) {
        await supabaseAdmin
          .from('business_users')
          .delete()
          .eq('business_id', businessId)
          .eq('user_id', authUserId);
      }
      if (createdProfile) {
        await supabaseAdmin.from('user_profiles').delete().eq('id', authUserId);
      }
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
    };

    try {
      // 2. Insert user_profiles
      const { error: profErr } = await supabaseAdmin.from('user_profiles').upsert({
        id: authUserId,
        email: emailToUse,
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
        return jsonResponse({ userId: authUserId, email: emailToUse }, 201);
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
          email: emailToUse,
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

      return jsonResponse({ employee: empInserted, userId: authUserId }, 201);
    } catch (dbErr: unknown) {
      await rollback();
      const message = dbErr instanceof Error ? dbErr.message : 'Database synchronization failed.';
      return jsonResponse({ error: message }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    return jsonResponse({ error: message }, 500);
  }
});
