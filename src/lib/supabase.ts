import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? supabaseUrl : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? supabaseAnonKey : 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

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

  if (lower.includes('row-level security') || code === '42501') {
    return 'Permission denied by database security policy (RLS). Ensure your staff role is active or run the latest database migrations.';
  }
  if (code === '23505' || lower.includes('duplicate key') || lower.includes('duplicate invoice')) {
    return rawMsg || 'A duplicate record with this code or invoice number already exists.';
  }
  if (code === '23503' || lower.includes('foreign key')) {
    return 'This record cannot be modified or deleted because it is linked to existing transactions.';
  }
  if (code === 'PGRST116') {
    return 'The requested record was not found in the database.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Network error: Unable to reach Supabase. Please check your internet connection.';
  }
  if (lower.includes('jwt') || lower.includes('not authenticated')) {
    return 'Your session has expired. Please sign in again.';
  }

  return rawMsg || fallback;
};
