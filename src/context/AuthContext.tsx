import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../supabase/config';
import { firestoreService } from '../services/firestoreService';
import { ensureGuestSession, clearGuestSessionCache, GuestSessionError } from '../services/guestSession';
import type { GuestSessionInfo } from '../services/guestSession';
import { User, Hotel, UserRole } from '../types';

/** Minimum length enforced by the UI for new/changed passwords. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * A password-recovery request parsed out of the landing URL.
 *
 *   • supabase-session — implicit flow (`#access_token=…&type=recovery`).
 *   • supabase-code    — PKCE flow (`?code=…&type=recovery`).
 *
 * `config.ts` sets `detectSessionInUrl: false`, so nothing here happens
 * automatically — the recovery link has to be exchanged by hand below.
 */
export type RecoveryParams =
  | { kind: 'supabase-session'; accessToken: string; refreshToken: string }
  | { kind: 'supabase-code'; code: string };

/** Reads recovery params from the query string and/or the URL hash. */
export function parseRecoveryParams(loc: Pick<Location, 'search' | 'hash'> = window.location): RecoveryParams | null {
  const query = new URLSearchParams(loc.search);
  const hash = new URLSearchParams(loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash);
  const pick = (key: string): string | null => query.get(key) || hash.get(key) || null;

  if (pick('type') === 'recovery') {
    const accessToken = pick('access_token');
    const refreshToken = pick('refresh_token');
    if (accessToken && refreshToken) return { kind: 'supabase-session', accessToken, refreshToken };
    const code = pick('code');
    if (code) return { kind: 'supabase-code', code };
  }

  return null;
}

/** Removes recovery params from the address bar so a reload does not replay them. */
function stripRecoveryParamsFromUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  for (const key of ['type', 'code', 'access_token', 'refresh_token', 'expires_in', 'token_type']) {
    url.searchParams.delete(key);
  }
  url.hash = '';
  const qs = url.searchParams.toString();
  const next = `${url.pathname}${qs ? `?${qs}` : ''}`;
  window.history.replaceState(window.history.state, '', next);
}

/** Outcome of resolving a Supabase auth user into an app role. */
type ClaimsResult =
  | { ok: true }
  | { ok: false; code: 'no_role' | 'no_hotel'; message: string };

const NO_ROLE_MESSAGE =
  'This email can sign in, but no NEXORA role is provisioned for it yet. ' +
  'Ask the platform owner to run: npm run create-super-admin -- --email you@example.com';

interface AuthContextType {
  user: User | null;
  /** The raw Supabase session/user (kept under the old name for compatibility). */
  firebaseUser: SupabaseUser | null;
  hotel: Hotel | null;
  guestSession: GuestSessionInfo | null;
  guestSessionError: string | null;
  activeExperience: 'super_admin' | 'hotel_os' | 'guest_experience' | 'login';
  setActiveExperience: (exp: 'super_admin' | 'hotel_os' | 'guest_experience' | 'login') => void;
  guestRoomToken: string;
  setGuestRoomToken: (token: string) => void;
  allHotels: Hotel[];
  isLoading: boolean;
  selectedTenantId: string | null;
  setSelectedTenantId: (id: string | null) => void;
  /** Set when a sign-in succeeded at the auth layer but the app rejected it. */
  authError: string | null;
  clearAuthError: () => void;
  /** True when Supabase credentials are present. */
  configured: boolean;
  /** Recovery link found in the URL, if any. */
  recoveryParams: RecoveryParams | null;
  loginWithCredentials: (email: string, pass: string) => Promise<void>;
  /** Emails a Supabase password-reset link for the address. */
  requestPasswordReset: (email: string) => Promise<void>;
  /** Exchanges a Supabase recovery link for a session. Returns the account email. */
  beginPasswordRecovery: () => Promise<{ email: string }>;
  /** Sets the new password for the account being recovered. */
  completePasswordReset: (newPassword: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  switchHotelTenant: (hotelId: string) => Promise<void>;
  refreshClaims: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<SupabaseUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [activeExperience, setActiveExperience] = useState<'super_admin' | 'hotel_os' | 'guest_experience' | 'login'>('login');
  const [guestRoomToken, setGuestRoomToken] = useState<string>('');
  const [allHotels, setAllHotels] = useState<Hotel[]>([]);
  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [guestSession, setGuestSession] = useState<GuestSessionInfo | null>(null);
  const [guestSessionError, setGuestSessionError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [recoveryParams, setRecoveryParams] = useState<RecoveryParams | null>(null);

  // Check URL token for Guest Room QR scan.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setGuestRoomToken(urlToken);
      setActiveExperience('guest_experience');
      return;
    }

    // A password-recovery link takes priority over the login screen.
    const recovery = parseRecoveryParams();
    if (recovery) {
      setRecoveryParams(recovery);
      setActiveExperience('login');
    }
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const signOutClient = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    setUser(null);
    setHotel(null);
    setSelectedTenantIdState(null);
  }, []);

  // Resolve a signed-in auth user into an app User (staff) or guest.
  const processUserClaims = useCallback(
    async (sbUser: SupabaseUser, session: Session | null): Promise<ClaimsResult> => {
      const isAnon = (sbUser as any).is_anonymous === true;
      const urlHasToken = !!new URLSearchParams(window.location.search).get('token');

      if (isAnon) {
        // Anonymous visitors only get access once a room session is established.
        if (!urlHasToken) {
          await signOutClient();
          setGuestSession(null);
          setActiveExperience('login');
          return { ok: true };
        }
        setUser({
          id: sbUser.id,
          hotelId: null,
          name: 'In-Room Guest',
          email: '',
          phone: '',
          role: 'guest' as UserRole,
          token: session?.access_token || '',
        });
        setHotel(null);
        setSelectedTenantIdState(null);
        setActiveExperience('guest_experience');
        return { ok: true };
      }

      // Staff: read role + hotelId from the profiles table.
      const roleDoc = await firestoreService.fetchUserRole(sbUser.id);
      const role = roleDoc?.role;
      const hotelId = roleDoc?.hotelId;

      if (role !== 'super_admin' && role !== 'hotel_admin') {
        // Auth succeeded but this account has no `profiles` row. Fail loudly
        // instead of bouncing back to the login form with no explanation.
        console.warn(`User ${sbUser.id} (${sbUser.email}) has no provisioned role. Signing out.`);
        await signOutClient();
        setAuthError(NO_ROLE_MESSAGE);
        setActiveExperience('login');
        return { ok: false, code: 'no_role', message: NO_ROLE_MESSAGE };
      }

      const normalizedRole: UserRole = role === 'super_admin' ? 'super_admin' : 'hotel_admin';

      setUser({
        id: sbUser.id,
        hotelId: hotelId || null,
        name: sbUser.user_metadata?.display_name || (normalizedRole === 'super_admin' ? 'Super Admin' : 'Hotel Admin'),
        email: sbUser.email || '',
        phone: (sbUser.user_metadata?.phone as string) || '',
        role: normalizedRole,
        token: session?.access_token || '',
      });

      if (normalizedRole === 'super_admin') {
        setActiveExperience('super_admin');
        return { ok: true };
      }
      if (normalizedRole === 'hotel_admin' && hotelId) {
        setSelectedTenantIdState(hotelId);
        setActiveExperience('hotel_os');
        const hotelDoc = await firestoreService.getHotel(hotelId);
        setHotel(hotelDoc);
        return { ok: true };
      }

      const noHotelMessage =
        'This hotel-admin account is not linked to a hotel yet. Ask the platform owner to re-assign it from the Super Admin console.';
      console.warn(`Hotel admin ${sbUser.id} has no hotelId. Signing out.`);
      await signOutClient();
      setAuthError(noHotelMessage);
      setActiveExperience('login');
      return { ok: false, code: 'no_hotel', message: noHotelMessage };
    },
    [signOutClient]
  );

  // Subscribe to Supabase auth state.
  useEffect(() => {
    // No credentials: App.tsx renders the setup screen, so never touch the
    // client (it is a stub whose methods throw by design).
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return;
        setIsLoading(true);
        setFirebaseUser(session?.user ?? null);
        if (session?.user) {
          processUserClaims(session.user, session).finally(() => mounted && setIsLoading(false));
        } else {
          setUser(null);
          setHotel(null);
          setSelectedTenantIdState(null);
          setGuestSession(null);
          clearGuestSessionCache();
          if (!new URLSearchParams(window.location.search).get('token')) setActiveExperience('login');
          setIsLoading(false);
        }
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setFirebaseUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [processUserClaims]);

  // Guest portal: exchange the scanned room token for a room-scoped session.
  useEffect(() => {
    if (!guestRoomToken || !isSupabaseConfigured) return;
    if (firebaseUser && (firebaseUser as any).is_anonymous !== true) {
      // A signed-in staff member previewing keeps their own session.
      setGuestSession(null);
      setGuestSessionError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const session = await ensureGuestSession(guestRoomToken);
        if (cancelled) return;
        setGuestSession(session);
        setGuestSessionError(null);
      } catch (err: any) {
        if (cancelled) return;
        setGuestSession(null);
        setGuestSessionError(err?.message || 'Could not open this room session.');
        console.error('[guest-session]', err?.code || err?.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [guestRoomToken, firebaseUser?.id, (firebaseUser as any)?.is_anonymous]);

  // Super admin: live list of all hotels.
  useEffect(() => {
    if (user?.role === 'super_admin') {
      const unsub = firestoreService.subscribeHotels(
        (hotelsList) => {
          setAllHotels(hotelsList);
          if (selectedTenantId) {
            const current = hotelsList.find((h) => h.id === selectedTenantId);
            if (current) setHotel(current);
          }
        },
        (err) => console.error('Error listening to hotels:', err)
      );
      return () => unsub();
    }
  }, [user?.role, selectedTenantId]);

  // Hotel admin: live single hotel document.
  useEffect(() => {
    if (user?.role === 'hotel_admin' && user.hotelId) {
      const unsub = firestoreService.subscribeHotel(
        user.hotelId,
        (hotelDoc) => setHotel(hotelDoc),
        (err) => console.error('Error listening to hotel doc:', err)
      );
      return () => unsub();
    }
  }, [user?.role, user?.hotelId]);

  const loginWithCredentials = async (email: string, pass: string) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: pass.trim(),
      });
      if (error) throw error;
      if (data.user && data.session) {
        // Surface a rejected-but-authenticated account as an error so the
        // login form can explain it instead of silently doing nothing.
        const result = await processUserClaims(data.user, data.session);
        if (result && result.ok === false) throw new Error(result.message);
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Sign-in failed. Please try again.');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Emails a Supabase password-reset link. The origin must be allow-listed in
   * Auth → URL Configuration → Redirect URLs, or Supabase drops the redirect.
   */
  const requestPasswordReset = async (email: string): Promise<void> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`,
    });
    if (error) throw error;
  };

  /** Exchanges a recovery link for a session (`detectSessionInUrl` is off). */
  const beginPasswordRecovery = async (): Promise<{ email: string }> => {
    if (!recoveryParams) throw new Error('No password reset link was detected.');

    setIsLoading(true);
    try {
      const { data, error } =
        recoveryParams.kind === 'supabase-code'
          ? await supabase.auth.exchangeCodeForSession(recoveryParams.code)
          : await supabase.auth.setSession({
              access_token: recoveryParams.accessToken,
              refresh_token: recoveryParams.refreshToken,
            });
      if (error) throw error;
      return { email: data?.user?.email || '' };
    } finally {
      setIsLoading(false);
    }
  };

  /** Sets the new password, then lands the user in the app. */
  const completePasswordReset = async (newPassword: string) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setRecoveryParams(null);
      stripRecoveryParamsFromUrl();

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        const result = await processUserClaims(session.user, session);
        if (result && result.ok === false) throw new Error(result.message);
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Could not reset the password.');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const refreshClaims = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setIsLoading(true);
      await processUserClaims(session.user, session);
      setIsLoading(false);
    }
  };

  const setSelectedTenantId = (id: string | null) => {
    setSelectedTenantIdState(id);
    if (id && user?.role === 'super_admin') {
      const found = allHotels.find((h) => h.id === id);
      if (found) setHotel(found);
    }
  };

  const switchHotelTenant = async (hotelId: string) => {
    setSelectedTenantId(hotelId || null);
    if (hotelId) {
      const found = allHotels.find((item) => item.id === hotelId);
      if (found) {
        setHotel(found);
        setActiveExperience('hotel_os');
      } else {
        const fetched = await firestoreService.getHotel(hotelId);
        if (fetched) {
          setHotel(fetched);
          setActiveExperience('hotel_os');
        }
      }
    } else {
      setHotel(null);
      if (user?.role === 'super_admin') setActiveExperience('super_admin');
    }
  };

  const logout = async () => {
    await signOutClient();
    setGuestSession(null);
    clearGuestSessionCache();
    setAuthError(null);
    setRecoveryParams(null);
    setActiveExperience('login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        hotel,
        guestSession,
        guestSessionError,
        activeExperience,
        setActiveExperience,
        guestRoomToken,
        setGuestRoomToken,
        allHotels,
        isLoading,
        selectedTenantId,
        setSelectedTenantId,
        authError,
        clearAuthError,
        configured: isSupabaseConfigured,
        recoveryParams,
        loginWithCredentials,
        requestPasswordReset,
        beginPasswordRecovery,
        completePasswordReset,
        loginWithGoogle,
        switchHotelTenant,
        refreshClaims,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
