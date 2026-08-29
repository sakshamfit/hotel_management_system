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
  limit,
  onSnapshot,
  runTransaction,
  writeBatch,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { initializeApp, deleteApp, FirebaseApp } from 'firebase/app';
import { getAuth as getSecondaryAuth, createUserWithEmailAndPassword, signOut as signOutFromSecondary } from 'firebase/auth';
import { db, auth, firebaseConfig } from '../firebase/config';
import {
  Hotel,
  Room,
  RoomTypeDefinition,
  Guest,
  Booking,
  BookingStatus,
  CreateBookingInput,
  RoomNight,
  Folio,
  Charge,
  FoodItem,
  HotelService,
  ServiceRequest,
  DailyReportData,
} from '../types';
import { enumerateNights, isValidStay, roomNightId, nightsBetween } from '../utils/dates';

export interface RoomAvailability {
  room: Room;
  available: boolean;
  /** Set when `available` is false — the booking holding one of these nights. */
  conflictBookingId?: string;
  /** Nights in the requested window that are already taken. */
  conflictDates?: string[];
}

/**
 * Thrown when the stay cannot be booked. Carries a stable `code` so the UI can
 * distinguish a genuine double-booking from a validation problem.
 */
export class BookingConflictError extends Error {
  code: string;
  conflictDates?: string[];
  constructor(message: string, code = 'booking/conflict', conflictDates?: string[]) {
    super(message);
    this.name = 'BookingConflictError';
    this.code = code;
    this.conflictDates = conflictDates;
  }
}

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

  /**
   * Single-room listener — used by the guest portal.
   *
   * Guests are scoped to ONE room (their own) by firestore.rules, so they must
   * read by document id rather than listing the whole rooms collection
   * (which also carries other guests' names and phone numbers).
   */
  subscribeRoom: (
    hotelId: string,
    roomId: string,
    onUpdate: (room: Room | null) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const roomRef = doc(db, 'hotels', hotelId, 'rooms', roomId);
    return onSnapshot(
      roomRef,
      (docSnap) => {
        if (docSnap.exists()) {
          onUpdate({ id: docSnap.id, hotelId, ...docSnap.data() } as Room);
        } else {
          onUpdate(null);
        }
      },
      (error) => {
        console.error(`Error subscribing to room ${roomId} for hotel ${hotelId}:`, error);
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

  /**
   * Orders belonging to ONE guest, identified by the anonymous uid stamped onto
   * the order at creation time (see GuestRoomView / the `orders` rules).
   *
   * Deliberately a single equality filter with no orderBy: a composite index
   * would otherwise be required. Sorting newest-first happens client-side.
   */
  subscribeGuestOrders: (
    hotelId: string,
    guestUid: string,
    onUpdate: (orders: ServiceRequest[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const col = collection(db, 'hotels', hotelId, 'orders');
    const q = query(col, where('guestUid', '==', guestUid));
    return onSnapshot(
      q,
      (snapshot) => {
        const orders: ServiceRequest[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          hotelId,
          ...docSnap.data(),
        })) as ServiceRequest[];
        orders.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        onUpdate(orders);
      },
      (error) => {
        console.error(`Error subscribing to guest orders for hotel ${hotelId}:`, error);
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
  // ROOM TYPES (Subcollection: hotels/{hotelId}/roomTypes)
  // ==========================================

  subscribeRoomTypes: (
    hotelId: string,
    onUpdate: (types: RoomTypeDefinition[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const col = collection(db, 'hotels', hotelId, 'roomTypes');
    const q = query(col, orderBy('name', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const types: RoomTypeDefinition[] = snapshot.docs.map((d) => ({
          id: d.id,
          hotelId,
          ...d.data(),
        })) as RoomTypeDefinition[];
        onUpdate(types);
      },
      (error) => {
        console.error(`Error subscribing to roomTypes for hotel ${hotelId}:`, error);
        if (onError) onError(error);
      }
    );
  },

  addRoomType: async (
    hotelId: string,
    data: Omit<RoomTypeDefinition, 'id' | 'hotelId'>
  ): Promise<string> => {
    const col = collection(db, 'hotels', hotelId, 'roomTypes');
    const newDoc = await addDoc(col, { ...data, createdAt: new Date().toISOString() });
    return newDoc.id;
  },

  updateRoomType: async (
    hotelId: string,
    roomTypeId: string,
    data: Partial<RoomTypeDefinition>
  ): Promise<void> => {
    await updateDoc(doc(db, 'hotels', hotelId, 'roomTypes', roomTypeId), data);
  },

  // ==========================================
  // GUESTS (Subcollection: hotels/{hotelId}/guests)
  // The booking contact — deliberately NOT the anonymous portal auth user.
  // ==========================================

  subscribeGuests: (
    hotelId: string,
    onUpdate: (guests: Guest[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const col = collection(db, 'hotels', hotelId, 'guests');
    const q = query(col, orderBy('name', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const guests: Guest[] = snapshot.docs.map((d) => ({
          id: d.id,
          hotelId,
          ...d.data(),
        })) as Guest[];
        onUpdate(guests);
      },
      (error) => {
        console.error(`Error subscribing to guests for hotel ${hotelId}:`, error);
        if (onError) onError(error);
      }
    );
  },

  createGuest: async (
    hotelId: string,
    data: Omit<Guest, 'id' | 'hotelId'>
  ): Promise<string> => {
    const col = collection(db, 'hotels', hotelId, 'guests');
    const newDoc = await addDoc(col, {
      ...data,
      createdAt: serverTimestamp(),
    });
    return newDoc.id;
  },

  updateGuest: async (
    hotelId: string,
    guestId: string,
    data: Partial<Guest>
  ): Promise<void> => {
    await updateDoc(doc(db, 'hotels', hotelId, 'guests', guestId), data);
  },

  // ==========================================
  // BOOKINGS / RESERVATIONS (Subcollection: hotels/{hotelId}/bookings)
  // ==========================================

  subscribeBookings: (
    hotelId: string,
    onUpdate: (bookings: Booking[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const col = collection(db, 'hotels', hotelId, 'bookings');
    const q = query(col, orderBy('checkInDate', 'desc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const bookings: Booking[] = snapshot.docs.map((d) => ({
          id: d.id,
          hotelId,
          ...d.data(),
        })) as Booking[];
        onUpdate(bookings);
      },
      (error) => {
        console.error(`Error subscribing to bookings for hotel ${hotelId}:`, error);
        if (onError) onError(error);
      }
    );
  },

  /**
   * Availability for a stay window.
   *
   * Reads every roomNight in [checkInDate, checkOutDate) with a single range
   * query on the date-only field (ISO dates sort lexicographically, so no
   * composite index is needed) and subtracts those rooms from inventory.
   * Rooms under maintenance are never offered.
   */
  findAvailableRooms: async (
    hotelId: string,
    checkInDate: string,
    checkOutDate: string
  ): Promise<RoomAvailability[]> => {
    const stay = isValidStay(checkInDate, checkOutDate);
    if (!stay.ok) throw new BookingConflictError(stay.error, 'booking/invalid-stay');

    const nightsQuery = query(
      collection(db, 'hotels', hotelId, 'roomNights'),
      where('date', '>=', checkInDate),
      where('date', '<', checkOutDate)
    );
    const [nightSnap, roomSnap] = await Promise.all([
      getDocs(nightsQuery),
      getDocs(query(collection(db, 'hotels', hotelId, 'rooms'), orderBy('roomNumber', 'asc'))),
    ]);

    const taken = new Map<string, { bookingId: string; dates: string[] }>();
    nightSnap.docs.forEach((d) => {
      const night = d.data() as RoomNight;
      if (!night?.roomId) return;
      const entry = taken.get(night.roomId) || { bookingId: night.bookingId, dates: [] };
      if (night.date) entry.dates.push(night.date);
      taken.set(night.roomId, entry);
    });

    return roomSnap.docs
      .map((d) => {
        const room = { id: d.id, hotelId, ...d.data() } as Room;
        const conflict = taken.get(room.id);
        const outOfService = room.status === 'maintenance';
        return {
          room,
          available: !conflict && !outOfService,
          ...(conflict
            ? { conflictBookingId: conflict.bookingId, conflictDates: conflict.dates.sort() }
            : {}),
        };
      })
      .filter((entry) => entry.room.status !== 'occupied' || entry.conflictBookingId);
  },

  /**
   * Creates a booking, its room-night locks, and its folio — atomically.
   *
   * The roomNights read is the double-booking check: the existence of a
   * `roomNights/{roomId}_{date}` document means that room is taken that night.
   * All reads happen before any write (Firestore transaction requirement), and
   * a conflict throws BookingConflictError so nothing at all is written.
   */
  createBooking: async (
    hotelId: string,
    input: CreateBookingInput
  ): Promise<string> => {
    const { guestId, roomId, roomTypeId, checkInDate, checkOutDate, agreedRate, numGuests, source } =
      input;

    const stay = isValidStay(checkInDate, checkOutDate);
    if (!stay.ok) throw new BookingConflictError(stay.error, 'booking/invalid-stay');

    const nights = enumerateNights(checkInDate, checkOutDate);
    if (nights.length === 0) {
      throw new BookingConflictError('A booking must cover at least one night.', 'booking/invalid-stay');
    }
    if (agreedRate < 0 || !Number.isFinite(agreedRate)) {
      throw new BookingConflictError('Agreed rate must be a positive number.', 'booking/invalid-rate');
    }

    const bookingRef = doc(collection(db, 'hotels', hotelId, 'bookings'));
    const folioRef = doc(db, 'hotels', hotelId, 'folios', bookingRef.id);
    const nightRefs = nights.map((date) => doc(db, 'hotels', hotelId, 'roomNights', roomNightId(roomId, date)));

    await runTransaction(db, async (tx) => {
      // 1. Reads first.
      const nightSnaps = await Promise.all(nightRefs.map((ref) => tx.get(ref)));
      const conflicts = nightSnaps
        .map((snap, i) => (snap.exists() ? nights[i] : null))
        .filter((d): d is string => d !== null);

      if (conflicts.length > 0) {
        const first = nightSnaps.find((s) => s.exists());
        const holder = first?.data() as RoomNight | undefined;
        throw new BookingConflictError(
          `Room is already booked for ${conflicts.length} of the requested night(s)` +
            ` (${conflicts.slice(0, 3).join(', ')}${conflicts.length > 3 ? '…' : ''}). Choose another room or dates.`,
          'booking/room-not-available',
          conflicts
        );
      }

      // 2. Writes.
      tx.set(bookingRef, {
        guestId,
        roomId,
        roomTypeId,
        checkInDate,
        checkOutDate,
        actualCheckInAt: null,
        actualCheckOutAt: null,
        status: 'RESERVED' as BookingStatus,
        agreedRate,
        numGuests,
        source,
        createdBy: auth.currentUser?.uid || 'unknown',
        createdAt: serverTimestamp(),
      });

      nights.forEach((date, i) => {
        tx.set(nightRefs[i], {
          roomId,
          date,
          bookingId: bookingRef.id,
        });
      });

      // One folio per booking, same document id — OPEN with a zero balance.
      // Room-night charges are raised by night audit / checkout (not yet built).
      tx.set(folioRef, {
        bookingId: bookingRef.id,
        status: 'OPEN',
        balance: 0,
      });
    });

    return bookingRef.id;
  },

  /**
   * Front-desk check-in. Operates on the BOOKING, not the room document: the
   * stay data lives on the booking, and the room only carries its physical
   * status.
   */
  checkInGuest: async (hotelId: string, bookingId: string, roomId: string): Promise<void> => {
    const batch = writeBatch(db);
    batch.update(doc(db, 'hotels', hotelId, 'bookings', bookingId), {
      status: 'CHECKED_IN' as BookingStatus,
      actualCheckInAt: serverTimestamp(),
      actualCheckOutAt: null,
    });
    batch.update(doc(db, 'hotels', hotelId, 'rooms', roomId), { status: 'occupied' });
    await batch.commit();
  },

  /**
   * Front-desk check-out. The room goes to `cleaning`, NOT `available` —
   * housekeeping clears it from there (HousekeepingTab room-status board).
   */
  checkOutGuest: async (hotelId: string, bookingId: string, roomId: string): Promise<void> => {
    const batch = writeBatch(db);
    batch.update(doc(db, 'hotels', hotelId, 'bookings', bookingId), {
      status: 'CHECKED_OUT' as BookingStatus,
      actualCheckOutAt: serverTimestamp(),
    });
    batch.update(doc(db, 'hotels', hotelId, 'rooms', roomId), { status: 'cleaning' });
    await batch.commit();
  },

  /** Releases the room-night locks so the room can be resold. */
  cancelBooking: async (hotelId: string, bookingId: string): Promise<void> => {
    const bookingRef = doc(db, 'hotels', hotelId, 'bookings', bookingId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(bookingRef);
      if (!snap.exists()) throw new Error('Booking not found.');
      const booking = { id: snap.id, ...snap.data() } as Booking;
      if (booking.status === 'CANCELLED' || booking.status === 'CHECKED_OUT') return;

      for (const date of enumerateNights(booking.checkInDate, booking.checkOutDate)) {
        tx.delete(doc(db, 'hotels', hotelId, 'roomNights', roomNightId(booking.roomId, date)));
      }
      tx.update(bookingRef, { status: 'CANCELLED' as BookingStatus });
      if (booking.status === 'CHECKED_IN') {
        tx.update(doc(db, 'hotels', hotelId, 'rooms', booking.roomId), { status: 'cleaning' });
      }
    });
  },

  markNoShow: async (hotelId: string, bookingId: string): Promise<void> => {
    const bookingRef = doc(db, 'hotels', hotelId, 'bookings', bookingId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(bookingRef);
      if (!snap.exists()) throw new Error('Booking not found.');
      const booking = { id: snap.id, ...snap.data() } as Booking;
      if (booking.status !== 'RESERVED') return;
      for (const date of enumerateNights(booking.checkInDate, booking.checkOutDate)) {
        tx.delete(doc(db, 'hotels', hotelId, 'roomNights', roomNightId(booking.roomId, date)));
      }
      tx.update(bookingRef, { status: 'NO_SHOW' as BookingStatus });
    });
  },

  // ==========================================
  // FOLIOS (hotels/{hotelId}/folios/{bookingId})
  // Staff-only: guests never read or write folios directly.
  // ==========================================

  subscribeFolio: (
    hotelId: string,
    bookingId: string,
    onUpdate: (folio: Folio | null) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    return onSnapshot(
      doc(db, 'hotels', hotelId, 'folios', bookingId),
      (snap) => {
        if (snap.exists()) {
          onUpdate({ id: snap.id, ...snap.data() } as Folio);
        } else {
          onUpdate(null);
        }
      },
      (error) => {
        console.error(`Error subscribing to folio for booking ${bookingId}:`, error);
        if (onError) onError(error);
      }
    );
  },

  getFolio: async (hotelId: string, bookingId: string): Promise<Folio | null> => {
    const snap = await getDoc(doc(db, 'hotels', hotelId, 'folios', bookingId));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Folio) : null;
  },

  subscribeCharges: (
    hotelId: string,
    bookingId: string,
    onUpdate: (charges: Charge[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe => {
    const q = query(
      collection(db, 'hotels', hotelId, 'folios', bookingId, 'charges'),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const charges: Charge[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as Charge[];
        onUpdate(charges);
      },
      (error) => {
        console.error(`Error subscribing to charges for booking ${bookingId}:`, error);
        if (onError) onError(error);
      }
    );
  },

  /**
   * Links an order to its booking's folio as a charge.
   *
   * The guest has no Firestore access to folios (by design — see the rules),
   * so the write is performed by the server with the Admin SDK. Failure here
   * must never break the guest's order, so callers should treat the result as
   * advisory.
   */
  linkOrderCharge: async (
    orderId: string
  ): Promise<{ linked: boolean; reason?: string }> => {
    const currentUser = auth.currentUser;
    if (!currentUser) return { linked: false, reason: 'no-session' };

    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch(`/api/guest/orders/${encodeURIComponent(orderId)}/charge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { linked: false, reason: data?.code || `http-${response.status}` };
      }
      return { linked: !!data.linked, reason: data.reason };
    } catch (err: any) {
      return { linked: false, reason: err?.message || 'network-error' };
    }
  },

  /** Nights in a stay — re-exported for UI use (stay total on the folio). */
  nightsBetween,

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

  /**
   * Emails a password reset link to a hotel admin account. Works on the free
   * plan (no Cloud Functions needed) — the raw password is never known to the
   * app; only Firebase Auth can reset it.
   */
  sendHotelPasswordReset: async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  },
};
