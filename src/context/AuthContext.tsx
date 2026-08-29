import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../supabase/config';
import { firestoreService } from '../services/firestoreService';
import { ensureGuestSession, clearGuestSessionCache, GuestSessionError } from '../services/guestSession';
import type { GuestSessionInfo } from '../services/guestSession';
import { User, Hotel, UserRole } from '../types';

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
  loginWithCredentials: (email: string, pass: string) => Promise<void>;
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

  // Check URL token for Guest Room QR scan.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setGuestRoomToken(urlToken);
      setActiveExperience('guest_experience');
    }
  }, []);

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
    async (sbUser: SupabaseUser, session: Session | null) => {
      const isAnon = (sbUser as any).is_anonymous === true;
      const urlHasToken = !!new URLSearchParams(window.location.search).get('token');

      if (isAnon) {
        // Anonymous visitors only get access once a room session is established.
        if (!urlHasToken) {
          await signOutClient();
          setGuestSession(null);
          setActiveExperience('login');
          return;
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
        return;
      }

      // Staff: read role + hotelId from the profiles table.
      const roleDoc = await firestoreService.fetchUserRole(sbUser.id);
      const role = roleDoc?.role;
      const hotelId = roleDoc?.hotelId;

      if (role !== 'super_admin' && role !== 'hotel_admin') {
        console.warn(`User ${sbUser.id} (${sbUser.email}) has no provisioned role. Signing out.`);
        await signOutClient();
        setActiveExperience('login');
        return;
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
      } else if (normalizedRole === 'hotel_admin' && hotelId) {
        setSelectedTenantIdState(hotelId);
        setActiveExperience('hotel_os');
        const hotelDoc = await firestoreService.getHotel(hotelId);
        setHotel(hotelDoc);
      } else {
        console.warn(`Hotel admin ${sbUser.id} has no hotelId. Signing out.`);
        await signOutClient();
        setActiveExperience('login');
      }
    },
    [signOutClient]
  );

  // Subscribe to Supabase auth state.
  useEffect(() => {
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
    if (!guestRoomToken) return;
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
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: pass.trim(),
      });
      if (error) throw error;
      if (data.user && data.session) await processUserClaims(data.user, data.session);
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
        loginWithCredentials,
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
