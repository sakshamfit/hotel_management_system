import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client configuration.
 *
 * Public values — Vite exposes only vars prefixed with VITE_ to the browser.
 * These are safe to ship: the anon key is protected by Row Level Security
 * (see supabase/migrations/0001_init.sql). The service-role key NEVER appears
 * here — it lives server-side only (server.ts / scripts).
 */
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

/** False until VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set in .env. */
export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

if (!isSupabaseConfigured) {
  // Surface a clear message instead of a cryptic fetch failure.
  console.error(
    '[supabase] Missing credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
      'in a .env file (see .env.example). The app shows a setup screen until then.'
  );
}

/**
 * Single browser client. `persistSession`/`autoRefreshToken` keep staff and
 * anonymous-guest sessions in localStorage; RLS is enforced per request using
 * the access token the SDK attaches automatically.
 *
 * When credentials are missing we still construct a (placeholder) client so
 * importing this module never throws — App.tsx renders a setup screen
 * instead of touching the client.
 */
export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? supabaseUrl : 'https://unconfigured.supabase.co',
  isSupabaseConfigured ? supabaseAnonKey : 'unconfigured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // we use the SPA's own token routing for QR guests
    },
  }
);
