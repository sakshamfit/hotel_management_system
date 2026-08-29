import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { auth } from '../firebase/config';
import { firestoreService } from '../services/firestoreService';
import { ensureGuestSession, clearGuestSessionCache, GuestSessionError } from '../services/guestSession';
import type { GuestSessionInfo } from '../services/guestSession';
import { User, Hotel, UserRole } from '../types';

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  hotel: Hotel | null;
  /**
   * Room-scoped session for an anonymous guest (present only when the guest
   * portal is open and no staff member is signed in). Null for staff.
   */
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
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [activeExperience, setActiveExperience] = useState<'super_admin' | 'hotel_os' | 'guest_experience' | 'login'>('login');
  const [guestRoomToken, setGuestRoomToken] = useState<string>('');
  const [allHotels, setAllHotels] = useState<Hotel[]>([]);
  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [guestSession, setGuestSession] = useState<GuestSessionInfo | null>(null);
  const [guestSessionError, setGuestSessionError] = useState<string | null>(null);

  // Check URL token for Guest Room QR scan
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setGuestRoomToken(urlToken);
      setActiveExperience('guest_experience');
    }
  }, []);

  // Process role/claims from Firebase User.
  // PRIMARY: read role + hotelId from the Firestore users/{uid} document (free-tier approach).
  // FALLBACK: custom claims on the ID token (kept so existing Admin SDK users still work).
  const processUserClaims = useCallback(async (fbUser: FirebaseUser, forceRefresh = true) => {
    try {
      // Force token refresh to ensure custom claims are fetched (fallback source)
      let tokenResult = await fbUser.getIdTokenResult(forceRefresh);
      const claimRole = tokenResult.claims.role as string | undefined;
      const claimHotelId = tokenResult.claims.hotelId as string | undefined;

      // Guests are anonymous users carrying a server-issued { role: 'guest',
      // hotelId, roomId, roomNumber } claim. They hold no users/{uid} role
      // document, so they must never fall through to the staff path (which
      // would sign them straight back out).
      if (fbUser.isAnonymous || claimRole === 'guest') {
        // An anonymous session with no room token has nothing it may access.
        if (!new URLSearchParams(window.location.search).get('token')) {
          await signOut(auth);
          setUser(null);
          setHotel(null);
          setSelectedTenantIdState(null);
          setActiveExperience('login');
          return;
        }
        setUser({
          id: fbUser.uid,
          hotelId: claimHotelId || null,
          name: 'In-Room Guest',
          email: '',
          phone: '',
          role: 'guest' as UserRole,
          token: tokenResult.token,
        });
        setHotel(null);
        setSelectedTenantIdState(null);
        setActiveExperience('guest_experience');
        return;
      }

      // PRIMARY: read role + hotelId from the Firestore users/{uid} document.
      const docUser = await firestoreService.fetchUserRole(fbUser.uid);
      let role = (docUser?.role as string | undefined) || claimRole;
      let hotelId = docUser?.hotelId || claimHotelId;

      // Handle edge case: freshly created user whose role hasn't propagated yet
      if (!role) {
        await new Promise((r) => setTimeout(r, 600));
        tokenResult = await fbUser.getIdTokenResult(true);
        role = (docUser?.role as string | undefined) || (tokenResult.claims.role as string | undefined);
        hotelId = docUser?.hotelId || (tokenResult.claims.hotelId as string | undefined);
      }

      // A valid role MUST come from the Firestore users/{uid} doc or the ID token.
      // No other email fallbacks. Users without a role are signed out.
      if (role !== 'super_admin' && role !== 'hotel_admin') {
        console.warn(`User ${fbUser.uid} (${fbUser.email}) has no provisioned role. Signing out.`);
        await signOut(auth);
        setUser(null);
        setHotel(null);
        setSelectedTenantIdState(null);
        setActiveExperience('login');
        return;
      }

      const normalizedRole: UserRole = (role === 'super_admin' ? 'super_admin' : 'hotel_admin');

      const appUser: User = {
        id: fbUser.uid,
        hotelId: hotelId || null,
        name: fbUser.displayName || (normalizedRole === 'super_admin' ? 'Super Admin' : 'Hotel Admin'),
        email: fbUser.email || '',
        phone: fbUser.phoneNumber || '',
        role: normalizedRole,
        token: tokenResult.token,
      };

      setUser(appUser);

      if (normalizedRole === 'super_admin') {
        setActiveExperience('super_admin');
      } else if (normalizedRole === 'hotel_admin' && hotelId) {
        setSelectedTenantIdState(hotelId);
        setActiveExperience('hotel_os');
        const hotelDoc = await firestoreService.getHotel(hotelId);
        setHotel(hotelDoc);
      } else {
        // hotel_admin without an assigned hotel has no valid tenant — reject access
        console.warn(`Hotel admin ${fbUser.uid} has no hotelId. Signing out.`);
        await signOut(auth);
        setUser(null);
        setHotel(null);
        setSelectedTenantIdState(null);
        setActiveExperience('login');
        return;
      }
    } catch (err) {
      console.error('Error processing Firebase user claims:', err);
    }
  }, []);

  // Subscribe to Firebase Auth state
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (fbUser) => {
      setIsLoading(true);
      setFirebaseUser(fbUser);

      if (fbUser) {
        await processUserClaims(fbUser, true);
      } else {
        setUser(null);
        setHotel(null);
        setSelectedTenantIdState(null);
        setGuestSession(null);
        clearGuestSessionCache();
        const params = new URLSearchParams(window.location.search);
        if (!params.get('token')) {
          setActiveExperience('login');
        }
      }
      setIsLoading(false);
    });

    return () => unsubscribeAuth();
  }, [processUserClaims]);

  // Guest portal: exchange the scanned room token for a room-scoped session.
  // Only runs for anonymous visitors — a signed-in staff member previewing the
  // portal keeps their own (higher-privilege) session untouched, so their
  // super_admin / hotel_admin claims are never overwritten with guest claims.
  useEffect(() => {
    if (!guestRoomToken) return;
    // Wait for auth state to settle before deciding whether this is a guest.
    if (firebaseUser && !firebaseUser.isAnonymous) {
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
  }, [guestRoomToken, firebaseUser?.uid, firebaseUser?.isAnonymous]);

  // Subscribe to real-time hotels collection when user is Super Admin
  useEffect(() => {
    if (user?.role === 'super_admin') {
      const unsubscribeHotels = firestoreService.subscribeHotels(
        (hotelsList) => {
          setAllHotels(hotelsList);
          if (selectedTenantId) {
            const current = hotelsList.find((h) => h.id === selectedTenantId);
            if (current) setHotel(current);
          }
        },
        (err) => console.error('Error listening to hotels:', err)
      );
      return () => unsubscribeHotels();
    }
  }, [user?.role, selectedTenantId]);

  // Subscribe to single hotel document when hotel_admin is logged in
  useEffect(() => {
    if (user?.role === 'hotel_admin' && user.hotelId) {
      const unsubscribeHotel = firestoreService.subscribeHotel(
        user.hotelId,
        (hotelDoc) => {
          setHotel(hotelDoc);
        },
        (err) => console.error('Error listening to hotel doc:', err)
      );
      return () => unsubscribeHotel();
    }
  }, [user?.role, user?.hotelId]);

  const loginWithCredentials = async (email: string, pass: string) => {
    setIsLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), pass.trim());
      await processUserClaims(cred.user, true);
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setIsLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      await processUserClaims(cred.user, true);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshClaims = async () => {
    if (auth.currentUser) {
      setIsLoading(true);
      await processUserClaims(auth.currentUser, true);
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
      if (user?.role === 'super_admin') {
        setActiveExperience('super_admin');
      }
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn('Sign out error:', e);
    }
    setUser(null);
    setHotel(null);
    setSelectedTenantIdState(null);
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
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
