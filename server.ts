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

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
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
): Promise<{ error: string; status: 401 } | { user: { id: string } }> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return { error: 'Missing Authorization bearer token.', status: 401 };
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { error: 'Invalid or expired authentication session.', status: 401 };
  }
  return { user: data.user };
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
      return res.status(authResult.status).json({ error: authResult.error });
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
      return res.status(authResult.status).json({ error: authResult.error });
    }

    const caller = authResult.user;
    const businessId = sanitizeUuid(req.body?.businessId);
    const employeeId = sanitizeUuid(req.body?.employeeId);
    const targetUserId = sanitizeUuid(req.body?.userId);
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

    if (employeeId) {
      const { data: empRow, error: empErr } = await supabaseAdmin
        .from('employees')
        .select('id, business_id, user_id, name, employee_code')
        .eq('id', employeeId)
        .maybeSingle();

      if (empErr) {
        return res.status(500).json({ error: `Failed to look up employee record: ${empErr.message}` });
      }
      if (!empRow) {
        return res.status(404).json({ error: 'Target employee record was not found.' });
      }
      if (empRow.business_id !== businessId) {
        return res.status(403).json({
          error: 'Access denied: target employee does not belong to your authorized business.',
        });
      }
      resolvedUserId = sanitizeUuid(empRow.user_id);
      if (empRow.name) {
        targetLabel = `${empRow.name}${empRow.employee_code ? ` (${empRow.employee_code})` : ''}`;
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
          .select('id, user_id, name, employee_code')
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
      }
    }

    if (!resolvedUserId) {
      return res.status(400).json({
        error: 'This employee does not have a linked Supabase Auth login account.',
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

    return res.status(200).json({
      success: true,
      userId: resolvedUserId,
      message: `Password updated successfully for ${targetLabel}. The employee can now sign in with their new password.`,
    });
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
