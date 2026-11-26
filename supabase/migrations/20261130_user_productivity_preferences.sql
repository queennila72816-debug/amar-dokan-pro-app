-- ============================================================================
-- PROTIVA: User Smart Interaction & Productivity Preferences (Additive & Safe)
-- Adds a JSONB column `ui_preferences` on `public.user_profiles` to persist
-- per-user theme (light/dark/system), keyboard shortcuts, sound preferences,
-- vibration toggle, focus mode, and dashboard customization safely in Supabase.
-- ============================================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS ui_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.user_profiles.ui_preferences IS
  'Per-user Smart Interaction & Productivity preferences (theme, custom shortcuts, sound controls, dashboard layout).';
