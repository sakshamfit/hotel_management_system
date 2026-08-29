import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client configuration.
 *
 * Public values — Vite exposes only vars prefixed with VITE_ to the browser.
 * These are safe to ship: the anon key is protected by Row Level Security
 * (see supabase/migrations/0001_init.sql). The service-role key NEVER appears
 * here — it lives server-side only (server.ts / scripts).
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  // Surface a clear message instead of a cryptic fetch failure.
  console.error(
    '[supabase] Missing credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
      'in a .env file (see .env.example).'
  );
}

/**
 * Single browser client. `persistSession`/`autoRefreshToken` keep staff and
 * anonymous-guest sessions in localStorage; RLS is enforced per request using
 * the access token the SDK attaches automatically.
 */
export const supabase: SupabaseClient = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // we use the SPA's own token routing for QR guests
  },
});
