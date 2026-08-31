import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client configuration.
 *
 * The app runs on a real Supabase project — Postgres + RLS + Realtime + Auth +
 * Storage. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are bundled into
 * the browser client (safe: RLS protects the data); the service-role key stays
 * server-side in server.ts.
 *
 * When the credentials are missing or still hold the `.env.example`
 * placeholders, `isSupabaseConfigured` is false and App.tsx renders the setup
 * screen instead of a half-working console. `supabase` below is then a stub
 * whose every method throws a message naming the variables to set, so a stray
 * call fails loudly instead of silently returning empty data.
 */

const NOT_CONFIGURED_MESSAGE =
  'Supabase is not configured. Copy .env.example to .env and set VITE_SUPABASE_URL and ' +
  'VITE_SUPABASE_ANON_KEY (plus SUPABASE_SERVICE_ROLE_KEY for the server) — see docs/supabase-setup.md.';

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
export const isSupabaseConfigured = !isPlaceholder(supabaseUrl) && !isPlaceholder(supabaseAnonKey);

/** The project URL, for callers that build absolute Storage/API URLs. */
export const supabaseProjectUrl = supabaseUrl.replace(/\/$/, '');

function notConfigured(): never {
  throw new Error(NOT_CONFIGURED_MESSAGE);
}

/** Namespace whose every member throws (`supabase.auth.getSession()` etc.). */
const throwingNamespace = new Proxy({} as Record<string, unknown>, {
  get: () => notConfigured,
});

/** Stands in for the client so imports stay valid before credentials exist. */
const unconfiguredStub = {
  auth: throwingNamespace,
  storage: throwingNamespace,
  from: notConfigured,
  rpc: notConfigured,
  channel: notConfigured,
  removeChannel: notConfigured,
};

/** The client the rest of the app imports. */
export const supabase: SupabaseClient = (
  isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false, // the SPA exchanges recovery/OAuth links itself
        },
      })
    : unconfiguredStub
) as unknown as SupabaseClient;

if (!isSupabaseConfigured && typeof console !== 'undefined') {
  console.warn(`[supabase] ${NOT_CONFIGURED_MESSAGE}`);
}
