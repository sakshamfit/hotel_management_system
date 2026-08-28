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
import { User, Hotel, UserRole } from '../types';

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  hotel: Hotel | null;
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
  loginAsDevRole: (role: 'super_admin' | 'hotel_admin', targetHotelId?: string) => void;
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

  // Check URL token for Guest Room QR scan
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setGuestRoomToken(urlToken);
      setActiveExperience('guest_experience');
    }
  }, []);

  // Process custom claims from Firebase User
  const processUserClaims = useCallback(async (fbUser: FirebaseUser, forceRefresh = true) => {
    try {
      // Force token refresh to ensure custom claims are fetched
      let tokenResult = await fbUser.getIdTokenResult(forceRefresh);
      let role = tokenResult.claims.role as string | undefined;
      let hotelId = tokenResult.claims.hotelId as string | undefined;

      // Handle edge case: freshly created user whose claim hasn't propagated to client token yet
      if (!role) {
        await new Promise((r) => setTimeout(r, 600));
        tokenResult = await fbUser.getIdTokenResult(true);
        role = tokenResult.claims.role as string | undefined;
        hotelId = tokenResult.claims.hotelId as string | undefined;
      }

      // Default role fallback if email is super admin email
      if (!role && (fbUser.email?.toLowerCase() === 'admin@raees.com' || fbUser.email?.toLowerCase() === 'ra7650384@gmail.com')) {
        try {
          await firestoreService.bootstrapSuperAdmin(fbUser.email);
          tokenResult = await fbUser.getIdTokenResult(true);
          role = tokenResult.claims.role as string | undefined;
        } catch (e) {
          console.warn('Auto-bootstrap error:', e);
        }
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
        // Default to super admin for owner email or show super admin view
        setActiveExperience('super_admin');
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
        const params = new URLSearchParams(window.location.search);
        if (!params.get('token')) {
          setActiveExperience('login');
        }
      }
      setIsLoading(false);
    });

    return () => unsubscribeAuth();
  }, [processUserClaims]);

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

  // Direct Dev Preview Mode (in case Identity Toolkit propagation is pending on GCP)
  const loginAsDevRole = (role: 'super_admin' | 'hotel_admin', targetHotelId?: string) => {
    const devUser: User = {
      id: role === 'super_admin' ? 'usr_super_admin_dev' : 'usr_hotel_admin_dev',
      hotelId: targetHotelId || (allHotels[0]?.id || 'hotel_demo_1'),
      name: role === 'super_admin' ? 'Super Admin (Master)' : 'Grand Plaza Admin',
      email: role === 'super_admin' ? 'admin@raees.com' : 'hotel@admin.com',
      phone: '+1 555 0192',
      role,
      token: 'tok_dev_preview_token',
    };
    setUser(devUser);
    if (role === 'super_admin') {
      setActiveExperience('super_admin');
    } else {
      setSelectedTenantIdState(devUser.hotelId);
      const found = allHotels.find((h) => h.id === devUser.hotelId);
      if (found) setHotel(found);
      setActiveExperience('hotel_os');
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
    setActiveExperience('login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        hotel,
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
        loginAsDevRole,
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
