import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';

const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const rawUrl = (viteEnv.VITE_SUPABASE_URL || '').trim();
export const supabaseUrl = rawUrl
  .replace(/\/rest\/v1\/?$/, '')
  .replace(/\/+$/, '');

export const supabaseAnonKey = (
  viteEnv.VITE_SUPABASE_ANON_KEY ||
  viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  ''
).trim();

const isValidHttpUrl = (value: string): boolean => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      Boolean(parsed.hostname) &&
      !parsed.hostname.includes('placeholder.supabase.co') &&
      !parsed.hostname.includes('your-project-ref')
    );
  } catch {
    return false;
  }
};

export const isSupabaseConfigured =
  isValidHttpUrl(supabaseUrl) &&
  supabaseAnonKey.length > 0 &&
  !supabaseAnonKey.startsWith('placeholder-') &&
  !supabaseAnonKey.includes('your-supabase-');

const globalScope = globalThis as typeof globalThis & {
  __adpSupabaseClient?: SupabaseClient;
  __adpEphemeralAuthClient?: SupabaseClient;
};

const resolvedUrl = isSupabaseConfigured ? supabaseUrl : 'https://placeholder.supabase.co';
const resolvedKey = isSupabaseConfigured ? supabaseAnonKey : 'placeholder-anon-key';

if (!globalScope.__adpSupabaseClient) {
  globalScope.__adpSupabaseClient = createClient(resolvedUrl, resolvedKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

/**
 * Single shared Supabase client instance across the entire frontend runtime.
 */
export const supabase: SupabaseClient = globalScope.__adpSupabaseClient;

/**
 * Isolated, non-persisting auth client used exclusively for creating staff/seller Auth accounts
 * when the privileged server/Edge Function is unavailable, without touching the Admin session
 * or spawning duplicate storage-backed GoTrueClient instances.
 */
export function getEphemeralAuthClient(): SupabaseClient {
  if (!globalScope.__adpEphemeralAuthClient) {
    globalScope.__adpEphemeralAuthClient = createClient(resolvedUrl, resolvedKey, {
      auth: {
        storageKey: 'adp-ephemeral-staff-signup',
        storage: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        },
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return globalScope.__adpEphemeralAuthClient;
}

let refreshInFlightPromise: Promise<Session | null> | null = null;
let sessionExpiredHandler: ((reason: string) => void) | null = null;

export function registerSessionExpiredHandler(handler: ((reason: string) => void) | null): void {
  sessionExpiredHandler = handler;
}

export function notifySessionExpired(
  reason = 'Your login session has expired. Please sign in again to continue.'
): void {
  if (sessionExpiredHandler) {
    sessionExpiredHandler(reason);
  }
}

export function isAuthSessionError(err: unknown): boolean {
  if (!err) return false;
  const obj = err as Record<string, unknown>;
  const status = Number(obj?.status || obj?.statusCode || 0);
  const code = String(obj?.code || '').toUpperCase();
  const msg =
    typeof err === 'string'
      ? err.toLowerCase()
      : String(obj?.message || obj?.error || obj?.error_description || '').toLowerCase();

  if (status === 401 || code === 'PGRST301' || code === 'SESSION_EXPIRED') {
    return true;
  }

  return (
    msg.includes('invalid or expired authentication session') ||
    msg.includes('missing authorization bearer token') ||
    msg.includes('jwt expired') ||
    msg.includes('invalid jwt') ||
    msg.includes('invalid claim') ||
    msg.includes('session has expired') ||
    msg.includes('not authenticated') ||
    msg.includes('auth session missing') ||
    msg.includes('invalid refresh token') ||
    msg.includes('refresh_token_not_found')
  );
}

function isTransientNetworkError(err: unknown): boolean {
  if (!err) return false;
  const obj = err as Record<string, unknown>;
  const status = Number(obj?.status || obj?.statusCode || 0);
  if (status >= 500 && status < 600) return true;

  const msg =
    typeof err === 'string'
      ? err.toLowerCase()
      : String(obj?.message || obj?.error || '').toLowerCase();

  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('fetch failed') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('econnreset')
  );
}

function isHardRefreshTokenError(err: unknown): boolean {
  if (!err || isTransientNetworkError(err)) return false;
  const obj = err as Record<string, unknown>;
  const status = Number(obj?.status || obj?.statusCode || 0);
  const msg =
    typeof err === 'string'
      ? err.toLowerCase()
      : String(obj?.message || obj?.error_description || obj?.error || '').toLowerCase();

  if (
    msg.includes('invalid refresh token') ||
    msg.includes('refresh_token_not_found') ||
    msg.includes('invalid_grant') ||
    msg.includes('token has expired') ||
    msg.includes('already used') ||
    msg.includes('session not found') ||
    msg.includes('auth session missing') ||
    msg.includes('user not found') ||
    msg.includes('user is banned')
  ) {
    return true;
  }

  return status === 400 || status === 401 || status === 403;
}

const EXPIRY_BUFFER_MS = 60_000;

function isSessionNearExpiry(session: Session | null): boolean {
  if (!session?.access_token) return true;
  if (!session.expires_at) return false;
  return session.expires_at * 1000 - Date.now() <= EXPIRY_BUFFER_MS;
}

async function performSingleFlightRefresh(): Promise<Session | null> {
  if (refreshInFlightPromise) {
    return refreshInFlightPromise;
  }

  refreshInFlightPromise = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        if (isHardRefreshTokenError(error)) {
          notifySessionExpired('Your login session has expired. Please sign in again to continue.');
          return null;
        }
        throw error;
      }
      if (!data?.session?.access_token) {
        notifySessionExpired('Your login session has expired. Please sign in again to continue.');
        return null;
      }
      return data.session;
    } finally {
      refreshInFlightPromise = null;
    }
  })();

  return refreshInFlightPromise;
}

/**
 * Ensures the active Supabase session has a valid, non-expired access token.
 * Automatically refreshes via refresh token when expired or within 60s of expiry,
 * deduplicating concurrent refresh calls to prevent refresh-token rotation collisions.
 * Only notifies session expiration when re-authentication is genuinely required.
 */
export async function ensureValidSession(options?: {
  forceRefresh?: boolean;
  verifyWithServer?: boolean;
}): Promise<Session | null> {
  if (!isSupabaseConfigured) return null;

  const {
    data: { session },
    error: sessErr,
  } = await supabase.auth.getSession();

  if (sessErr && isTransientNetworkError(sessErr)) {
    throw sessErr;
  }

  if (!session) {
    return null;
  }

  let activeSession: Session = session;

  if (options?.forceRefresh || isSessionNearExpiry(session)) {
    if (!session.refresh_token) {
      notifySessionExpired('Your login session has expired. Please sign in again to continue.');
      return null;
    }
    const refreshed = await performSingleFlightRefresh();
    if (!refreshed) return null;
    activeSession = refreshed;
  }

  if (options?.verifyWithServer) {
    const { data: userData, error: userErr } = await supabase.auth.getUser(activeSession.access_token);
    if (userErr || !userData?.user) {
      if (userErr && isTransientNetworkError(userErr)) {
        // Do NOT log out authenticated users on transient connectivity issues
        return activeSession;
      }

      // Access token rejected by Auth server (e.g. clock skew or revoked); try one refresh
      if (activeSession.refresh_token) {
        const refreshed = await performSingleFlightRefresh();
        if (!refreshed) return null;
        const { data: recheckData, error: recheckErr } = await supabase.auth.getUser(refreshed.access_token);
        if (recheckErr || !recheckData?.user) {
          if (recheckErr && isTransientNetworkError(recheckErr)) {
            return refreshed;
          }
          notifySessionExpired('Your login session has expired. Please sign in again to continue.');
          return null;
        }
        return refreshed;
      }

      notifySessionExpired('Your login session has expired. Please sign in again to continue.');
      return null;
    }
  }

  return activeSession;
}

/**
 * Returns a fresh Bearer access token, automatically refreshing if expired or near expiry.
 */
export async function getFreshAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
  const session = await ensureValidSession(options);
  if (!session?.access_token) {
    throw new Error('Your login session has expired. Please sign in again to continue.');
  }
  return session.access_token;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidUuid = (value?: string | null): value is string => {
  if (!value || typeof value !== 'string') return false;
  return UUID_REGEX.test(value.trim());
};

export const sanitizeUuid = (value?: string | null): string | null => {
  return isValidUuid(value) ? value.trim() : null;
};

export const formatSupabaseError = (
  err: any,
  fallback = 'Database operation failed. Please try again.'
): string => {
  if (!err) return fallback;

  const rawMsg =
    typeof err === 'string'
      ? err
      : err.message || err.error_description || err.details || err.hint || '';
  const code = err?.code || '';

  if (!rawMsg && !code) return fallback;

  const lower = rawMsg.toLowerCase();

  if (code === '42P17' || lower.includes('infinite recursion')) {
    return `${rawMsg} — Run supabase/migrations/20261122_permanent_rls_recursion_and_setup_fix.sql (or 20261119_fix_branches_rls_recursion.sql) in Supabase SQL Editor to apply the non-recursive RLS fix.`;
  }
  if (lower.includes('row-level security') || code === '42501') {
    return 'Permission denied by database security policy (RLS). Ensure your staff role is active or run the latest database migrations.';
  }
  if (code === '23505' || lower.includes('duplicate key') || lower.includes('duplicate invoice')) {
    return rawMsg || 'A duplicate record with this code or invoice number already exists.';
  }
  if (code === '23503' || lower.includes('foreign key')) {
    if (lower.includes('employees_user_id_fkey')) {
      return 'Employee authentication user could not be linked because the Auth user UUID does not exist in auth.users. Ensure the Supabase Auth user is created before saving the employee record.';
    }
    if (lower.includes('insert or update')) {
      return `Invalid reference while saving record: ${rawMsg}`;
    }
    return 'This record cannot be modified or deleted because it is linked to existing transactions.';
  }
  if (code === 'PGRST116') {
    return 'The requested record was not found in the database.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Network error: Unable to reach Supabase. Please check your internet connection.';
  }
  if (
    code === 'PGRST301' ||
    code === 'SESSION_EXPIRED' ||
    lower.includes('jwt') ||
    lower.includes('not authenticated') ||
    lower.includes('invalid or expired authentication session') ||
    lower.includes('auth session missing') ||
    lower.includes('session has expired')
  ) {
    return 'Your session has expired. Please sign in again.';
  }

  return rawMsg || fallback;
};
