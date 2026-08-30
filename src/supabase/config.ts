import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { localSupabase, demoBackend as localDemoBackend } from './localBackend';

/**
 * Supabase client configuration.
 *
 * Two modes:
 *
 *   1. REAL — `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set to actual
 *      project values. We build the normal browser client; RLS (applied by
 *      supabase/migrations/0001_init.sql) protects the anon key.
 *   2. DEMO  — credentials are missing or still placeholders (.env.example
 *      values). The app switches to a fully local in-memory backend
 *      (src/supabase/localBackend.ts) seeded with a demo hotel, staff
 *      accounts and a live stay, so everything works with zero setup.
 *
 * The service-role key NEVER appears here — it lives server-side only
 * (server.ts / scripts).
 */

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  if (v === 'unconfigured') return true;
  if (/your-project-ref|your-anon-public-key|your-service-role-key|example\.com|xxxx/i.test(v)) return true;
  return false;
}

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

/** True when real, usable Supabase credentials are configured. */
export const realSupabaseConfigured = !isPlaceholder(supabaseUrl) && !isPlaceholder(supabaseAnonKey);

/** True when the app runs against the local demo backend. */
export const isDemoMode = !realSupabaseConfigured;

/**
 * Kept for App.tsx compatibility: true in both modes, since demo mode is a
 * fully working backend (no setup screen needed).
 */
export const isSupabaseConfigured = true;

/** Demo-mode helpers (guest session exchange, admin user creation, ...). */
export const demoBackend = isDemoMode ? localDemoBackend : null;

/** The client the rest of the app imports. */
export const supabase: SupabaseClient = (
  isDemoMode ? localSupabase : createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // we use the SPA's own token routing for QR guests
    },
  })
) as unknown as SupabaseClient;

if (isDemoMode && typeof console !== 'undefined') {
  console.info(
    '[supabase] Demo mode active — using the local in-memory backend. ' +
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (plus SUPABASE_SERVICE_ROLE_KEY in .env) to use a real Supabase project.'
  );
}
