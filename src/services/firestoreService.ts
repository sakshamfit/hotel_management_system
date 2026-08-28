import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { initializeApp, deleteApp, FirebaseApp } from 'firebase/app';
import { getAuth as getSecondaryAuth, createUserWithEmailAndPassword, signOut as signOutFromSecondary } from 'firebase/auth';
import { db, auth, firebaseConfig } from '../firebase/config';
import {
  Hotel,
  Room,
  FoodItem,
  HotelService,
  ServiceRequest,
  GuestSession,
  DailyReportData,
} from '../types';

export const firestoreService = {
  // ==========================================
  // USERS (Root Collection: users)
  // Stores role + hotelId for every Firebase Auth user.
  // Used instead of custom claims so the Super Admin's session
  // is never affected when creating a new hotel admin (free tier, no Blaze).
  // ==========================================

  // Read a user's role document (role + hotelId) from Firestore.
  // Returns null if the doc is missing or the read is denied.
  fetchUserRole: async (uid: string): Promise<{ role: string | null; hotelId: string | null } | null> => {
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (!snap.exists()) return null;
      const data = snap.data();
      return {
        role: (data.role as string) || null,
        hotelId: (data.hotelId as string) || null,
      };
    } catch (err) {
      console.warn(`Failed to read users/${uid} role document:`, err);
      return null;
    }
  },

  // Create a hotel admin login using a temporary SECONDARY Firebase app instance.
  // This is the free-tier strategy: it creates the Firebase Auth user WITHOUT
  // logging out the currently signed-in Super Admin (no Admin SDK / no Cloud Function),
  // and persists the role in a users/{uid} Firestore document.
  // Falls back to the server Admin SDK endpoint if the client-side signup is blocked.
  createHotelLogin: async (
    hotelId: string,
    hotelName: string,
    email: string,
    password: string,
    name?: string,
    phone?: string
  ): Promise<{ success: boolean; uid: string; email: string; role: string; hotelId: string }> => {
    const trimmedEmail = email.toLowerCase().trim();

    try {
      // ---- PRIMARY: Secondary app instance (free tier, no server needed) ----
      const appName = `SecondaryHotelLoginApp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      let secondaryApp: FirebaseApp | null = null;
      try {
        secondaryApp = initializeApp(firebaseConfig, appName);
        const secondaryAuth = getSecondaryAuth(secondaryApp);
        const userCred = await createUserWithEmailAndPassword(secondaryAuth, trimmedEmail, password);
        const newUid = userCred.user.uid;

        // Persist role + hotelId in Firestore (custom claims can't be set client-side)
        await setDoc(doc(db, 'users', newUid), {
          role: 'hotel_admin',
          hotelId,
          email: trimmedEmail,
          displayName: name || `${hotelName} Admin`,
          phone: phone || '',
          createdAt: new Date().toISOString(),
        });

        // Clear the secondary session and clean up the temporary app
        await signOutFromSecondary(secondaryAuth);

        return { success: true, uid: newUid, email: trimmedEmail, role: 'hotel_admin', hotelId };
      } finally {
        if (secondaryApp) {
          try {
            await deleteApp(secondaryApp);
          } catch (delErr) {
            console.warn('Could not delete secondary Firebase app:', delErr);
          }
        }
      }
    } catch (primaryErr: any) {
      // ---- FALLBACK: Admin SDK endpoint (server) — also writes the users/{uid} doc ----
      console.warn('Secondary-app signup failed, falling back to Admin SDK endpoint:', primaryErr);
      return firestoreService.createHotelUserAuth(
        hotelId,
        hotelName,
        trimmedEmail,
        password,
        name,
        phone
      );
    }
  },

  // ==========================================
  // HOTELS (Root Collection: hotels)
  // ==========================================

  // Get all hotels (Super Admin only)
  subscribeHotels: (onUpdate: (hotels: Hotel[]) => void, onError?: (err: Error) => void): Unsubscribe => {
    const hotelsCol = collection(db, 'hotels');
    const q = query(hotelsCol, orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const hotels: Hotel[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as Hotel[];
        onUpdate(hotels);
      },
      (error) => {
        console.error('Error subscribing to hotels:', error);
        if (onError) onError(error);
      }
    );
  },

  // Get single hotel by ID
  subscribeHotel: (
    hotelId: string,
    onUpdate: (hotel: Hotel | null) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const hotelRef = doc(db, 'hotels', hotelId);
    return onSnapshot(
      hotelRef,
      (docSnap) => {
        if (docSnap.exists()) {
          onUpdate({ id: docSnap.id, ...docSnap.data() } as Hotel);
        } else {
          onUpdate(null);
        }
      },
      (error) => {
        console.error(`Error subscribing to hotel ${hotelId}:`, error);
        if (onError) onError(error);
      }
    );
  },

  getHotel: async (hotelId: string): Promise<Hotel | null> => {
    const hotelRef = doc(db, 'hotels', hotelId);
    const snap = await getDoc(hotelRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as Hotel;
  },

  createHotelDoc: async (hotelId: string, data: Omit<Hotel, 'id'>): Promise<string> => {
    const hotelRef = doc(db, 'hotels', hotelId);
    const payload = {
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await setDoc(hotelRef, payload);
    return hotelId;
  },

  updateHotelDoc: async (hotelId: string, data: Partial<Hotel>): Promise<void> => {
    const hotelRef = doc(db, 'hotels', hotelId);
    await updateDoc(hotelRef, {
      ...data,
      updatedAt: new Date().toISOString(),
    });
  },

  deleteHotelDoc: async (hotelId: string): Promise<void> => {
    // Delete subcollections documents first
    const subcollections = ['rooms', 'foodItems', 'services', 'orders', 'bookings', 'staff'];
    for (const sub of subcollections) {
      try {
        const subCol = collection(db, 'hotels', hotelId, sub);
        const subSnap = await getDocs(subCol);
        for (const docItem of subSnap.docs) {
          await deleteDoc(doc(db, 'hotels', hotelId, sub, docItem.id));
        }
      } catch (e) {
        console.warn(`Could not clear subcollection ${sub}:`, e);
      }
    }
    const hotelRef = doc(db, 'hotels', hotelId);
    await deleteDoc(hotelRef);
  },

  // ==========================================
  // ROOMS (Subcollection: hotels/{hotelId}/rooms)
  // ==========================================

  subscribeRooms: (
    hotelId: string,
    onUpdate: (rooms: Room[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const roomsCol = collection(db, 'hotels', hotelId, 'rooms');
    const q = query(roomsCol, orderBy('roomNumber', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const rooms: Room[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          hotelId,
          ...docSnap.data(),
        })) as Room[];
        onUpdate(rooms);
      },
      (error) => {
        console.error(`Error subscribing to rooms for hotel ${hotelId}:`, error);
        if (onError) onError(error);
      }
    );
  },

  addRoom: async (hotelId: string, roomData: Omit<Room, 'id' | 'hotelId'>): Promise<string> => {
    const roomsCol = collection(db, 'hotels', hotelId, 'rooms');
    const newDoc = await addDoc(roomsCol, {
      ...roomData,
      createdAt: new Date().toISOString(),
    });
    return newDoc.id;
  },

  updateRoom: async (hotelId: string, roomId: string, data: Partial<Room>): Promise<void> => {
    const roomRef = doc(db, 'hotels', hotelId, 'rooms', roomId);
    await updateDoc(roomRef, data);
  },

  deleteRoom: async (hotelId: string, roomId: string): Promise<void> => {
    const roomRef = doc(db, 'hotels', hotelId, 'rooms', roomId);
    await deleteDoc(roomRef);
  },

  // ==========================================
  // FOOD MENU ITEMS (Subcollection: hotels/{hotelId}/foodItems)
  // ==========================================

  subscribeFoodItems: (
    hotelId: string,
    onUpdate: (items: FoodItem[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const col = collection(db, 'hotels', hotelId, 'foodItems');
    const q = query(col, orderBy('name', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const items: FoodItem[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          hotelId,
          ...docSnap.data(),
        })) as FoodItem[];
        onUpdate(items);
      },
      (error) => {
        console.error(`Error subscribing to foodItems for hotel ${hotelId}:`, error);
        if (onError) onError(error);
      }
    );
  },

  addFoodItem: async (hotelId: string, itemData: Omit<FoodItem, 'id' | 'hotelId'>): Promise<string> => {
    const col = collection(db, 'hotels', hotelId, 'foodItems');
    const newDoc = await addDoc(col, {
      ...itemData,
      createdAt: new Date().toISOString(),
    });
    return newDoc.id;
  },

  updateFoodItem: async (hotelId: string, itemId: string, data: Partial<FoodItem>): Promise<void> => {
    const itemRef = doc(db, 'hotels', hotelId, 'foodItems', itemId);
    await updateDoc(itemRef, data);
  },

  deleteFoodItem: async (hotelId: string, itemId: string): Promise<void> => {
    const itemRef = doc(db, 'hotels', hotelId, 'foodItems', itemId);
    await deleteDoc(itemRef);
  },

  // ==========================================
  // SERVICES (Subcollection: hotels/{hotelId}/services)
  // ==========================================

  subscribeServices: (
    hotelId: string,
    onUpdate: (services: HotelService[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const col = collection(db, 'hotels', hotelId, 'services');
    const q = query(col, orderBy('name', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const services: HotelService[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          hotelId,
          ...docSnap.data(),
        })) as HotelService[];
        onUpdate(services);
      },
      (error) => {
        console.error(`Error subscribing to services for hotel ${hotelId}:`, error);
        if (onError) onError(error);
      }
    );
  },

  addService: async (hotelId: string, serviceData: Omit<HotelService, 'id' | 'hotelId'>): Promise<string> => {
    const col = collection(db, 'hotels', hotelId, 'services');
    const newDoc = await addDoc(col, {
      ...serviceData,
      createdAt: new Date().toISOString(),
    });
    return newDoc.id;
  },

  updateService: async (hotelId: string, serviceId: string, data: Partial<HotelService>): Promise<void> => {
    const serviceRef = doc(db, 'hotels', hotelId, 'services', serviceId);
    await updateDoc(serviceRef, data);
  },

  deleteService: async (hotelId: string, serviceId: string): Promise<void> => {
    const serviceRef = doc(db, 'hotels', hotelId, 'services', serviceId);
    await deleteDoc(serviceRef);
  },

  // ==========================================
  // ORDERS & REQUESTS (Subcollection: hotels/{hotelId}/orders)
  // ==========================================

  subscribeOrders: (
    hotelId: string,
    onUpdate: (orders: ServiceRequest[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const col = collection(db, 'hotels', hotelId, 'orders');
    const q = query(col, orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const orders: ServiceRequest[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          hotelId,
          ...docSnap.data(),
        })) as ServiceRequest[];
        onUpdate(orders);
      },
      (error) => {
        console.error(`Error subscribing to orders for hotel ${hotelId}:`, error);
        if (onError) onError(error);
      }
    );
  },

  // Stream DOC CHANGES for a hotel's orders collection so callers can detect
  // genuinely NEW documents (snapshot.docChanges() with type === "added").
  // - The very first snapshot reports every existing doc as "added", so the
  //   `isFirst` flag lets callers skip the initial load / pre-existing orders.
  // - Subsequent callbacks only carry real-time additions.
  subscribeOrderChanges: (
    hotelId: string,
    onChanges: (added: Array<{ id: string; data: any }>, isFirst: boolean) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const col = collection(db, 'hotels', hotelId, 'orders');
    const q = query(col, orderBy('createdAt', 'desc'));
    let isFirst = true;
    return onSnapshot(
      q,
      (snapshot) => {
        const added = snapshot
          .docChanges()
          .filter((change) => change.type === 'added')
          .map((change) => ({ id: change.doc.id, data: change.doc.data() }));
        onChanges(added, isFirst);
        isFirst = false;
      },
      (error) => {
        console.error(`Error subscribing to order changes for hotel ${hotelId}:`, error);
        if (onError) onError(error);
      }
    );
  },

  createOrder: async (hotelId: string, orderData: any): Promise<string> => {
    const col = collection(db, 'hotels', hotelId, 'orders');
    const newDoc = await addDoc(col, {
      ...orderData,
      createdAt: orderData.createdAt || new Date().toISOString(),
    });
    return newDoc.id;
  },

  addOrder: async (hotelId: string, orderData: any): Promise<string> => {
    return firestoreService.createOrder(hotelId, orderData);
  },

  updateOrderStatus: async (
    hotelId: string,
    orderId: string,
    status: ServiceRequest['status'],
    extra?: Partial<ServiceRequest>
  ): Promise<void> => {
    const orderRef = doc(db, 'hotels', hotelId, 'orders', orderId);
    await updateDoc(orderRef, {
      status,
      ...extra,
      updatedAt: new Date().toISOString(),
      ...(status === 'COMPLETED' || status === 'completed' ? { completedAt: new Date().toISOString() } : {}),
    });
  },

  // ==========================================
  // BOOKINGS / CHECK-INS (Subcollection: hotels/{hotelId}/bookings)
  // ==========================================

  subscribeBookings: (
    hotelId: string,
    onUpdate: (bookings: GuestSession[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const col = collection(db, 'hotels', hotelId, 'bookings');
    const q = query(col, orderBy('checkInTime', 'desc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const bookings: GuestSession[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          hotelId,
          ...docSnap.data(),
        })) as GuestSession[];
        onUpdate(bookings);
      },
      (error) => {
        console.error(`Error subscribing to bookings for hotel ${hotelId}:`, error);
        if (onError) onError(error);
      }
    );
  },

  createBooking: async (
    hotelId: string,
    bookingData: Omit<GuestSession, 'id' | 'hotelId'>
  ): Promise<string> => {
    const col = collection(db, 'hotels', hotelId, 'bookings');
    const newDoc = await addDoc(col, {
      ...bookingData,
      status: 'active',
      checkInTime: bookingData.checkInTime || new Date().toISOString(),
    });

    // Also update room status to occupied
    if (bookingData.roomId) {
      await firestoreService.updateRoom(hotelId, bookingData.roomId, {
        status: 'occupied',
        activeGuestSessionId: newDoc.id,
      });
    }
    return newDoc.id;
  },

  checkOutGuest: async (hotelId: string, bookingId: string, roomId?: string): Promise<void> => {
    const bookingRef = doc(db, 'hotels', hotelId, 'bookings', bookingId);
    await updateDoc(bookingRef, {
      status: 'completed',
      actualCheckOutTime: new Date().toISOString(),
    });

    if (roomId) {
      await firestoreService.updateRoom(hotelId, roomId, {
        status: 'cleaning',
        activeGuestSessionId: null,
      });
    }
  },

  // Server API calls helper (with Super Admin ID token)
  // Free-tier fallback: uses the Firebase Admin SDK server endpoint,
  // which sets custom claims AND writes the users/{uid} role document.
  createHotelUserAuth: async (
    hotelId: string,
    hotelName: string,
    email: string,
    password: string,
    name?: string,
    phone?: string
  ) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Not authenticated. Please sign in as Super Admin.');
    }

    const idToken = await currentUser.getIdToken(true);
    const response = await fetch('/api/admin/create-hotel-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        hotelId,
        hotelName,
        email,
        password,
        name,
        phone,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.details || 'Failed to create hotel admin user via Admin SDK');
    }
    return data;
  },

  deleteHotelUserAuth: async (email: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const idToken = await currentUser.getIdToken();
    await fetch('/api/admin/delete-hotel-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ email }),
    });
  },

  bootstrapSuperAdmin: async (email?: string, password?: string) => {
    const response = await fetch('/api/auth/bootstrap-super-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to setup super admin');
    }
    return data;
  },

  /**
   * Emails a password reset link to a hotel admin account. Works on the free
   * plan (no Cloud Functions needed) — the raw password is never known to the
   * app; only Firebase Auth can reset it.
   */
  sendHotelPasswordReset: async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  },
};
