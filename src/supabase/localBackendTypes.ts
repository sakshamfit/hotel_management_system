/**
 * Shared types for the local demo backend (src/supabase/localBackend.ts) and
 * its seed module (src/supabase/demoSeed.ts).
 */

/** A generic Postgres-shaped row stored in the demo store (snake_case keys). */
export type DemoRow = Record<string, any>;

/** A demo Auth user (subset of the supabase-js User + password for login). */
export interface DemoAuthUser {
  id: string;
  email: string | null;
  password: string;
  is_anonymous: boolean;
  role: string;
  user_metadata: Record<string, any>;
  app_metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  confirmed_at?: string | null;
}

/** Shape of the error object returned by supabase-js (postgrest-style). */
export interface LocalError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

/**
 * A demo-mode password reset request. Demo mode has no mail provider, so the
 * reset link is returned to the UI instead of being emailed.
 */
export interface DemoPasswordReset {
  email: string;
  token: string;
  expiresAt: number;
}
