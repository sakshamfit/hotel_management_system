/**
 * Data + auth service for the app.
 *
 * HISTORY: this module originally wrapped Firestore (`firestoreService`). It now
 * wraps Supabase — Postgres + RLS + Realtime + Supabase Auth. The exported name
 * `firestoreService` and every method signature / returned object shape is kept
 * identical so the UI components do not change.
 *
 * Tables (snake_case) map to camelCase app objects in src/services/db.ts.
 */
import { supabase } from '../supabase/config';
import {
  subscribeTable,
  subscribeRow,
  insertRow,
  updateRow,
  deleteRow,
  fetchRow,
  rowToObject,
  objectToRow,
  type UnsubscribeShim,
} from './db';
import type {
  Hotel,
  Room,
  RoomTypeDefinition,
  Guest,
  Booking,
  BookingStatus,
  CreateBookingInput,
  Folio,
  Charge,
  FoodItem,
  HotelService,
  ServiceRequest,
} from '../types';
import { enumerateNights, isValidStay, nightsBetween } from '../utils/dates';

export type { UnsubscribeShim as Unsubscribe };

export interface RoomAvailability {
  room: Room;
  available: boolean;
  conflictBookingId?: string;
  conflictDates?: string[];
}

/** Stable error code so the UI can distinguish double-booking from validation. */
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

// App expects an unsubscribe function; db.ts returns () => void.
type Unsub = () => void;

export const firestoreService = {
  // ==========================================
  // USERS — staff role lives in `profiles`
  // ==========================================

  fetchUserRole: async (uid: string): Promise<{ role: string | null; hotelId: string | null } | null> => {
    try {
      const row = await fetchRow<{ role: string; hotelId: string | null }>('profiles', uid);
      if (!row) return null;
      return { role: row.role || null, hotelId: row.hotelId || null };
    } catch (err) {
      console.warn(`Failed to read profiles/${uid}:`, err);
      return null;
    }
  },

  // Create a hotel admin login via the SERVER (service-role key creates the
  // Auth user + profile). Signups are disabled client-side; this is the only
  // path and it does not log the super admin out.
  createHotelLogin: async (
    hotelId: string,
    hotelName: string,
    email: string,
    password: string,
    name?: string,
    phone?: string
  ): Promise<{ success: boolean; uid: string; email: string; role: string; hotelId: string }> => {
    return firestoreService.createHotelUserAuth(hotelId, hotelName, email, password, name, phone);
  },

  // ==========================================
  // HOTELS
  // ==========================================
  subscribeHotels: (onUpdate: (hotels: Hotel[]) => void, onError?: (err: Error) => void): Unsub =>
    subscribeTable<Hotel>('hotels', onUpdate, { orderBy: { column: 'created_at', ascending: false } }, onError),

  subscribeHotel: (
    hotelId: string,
    onUpdate: (hotel: Hotel | null) => void,
    onError?: (err: Error) => void
  ): Unsub => subscribeRow<Hotel>('hotels', hotelId, onUpdate, onError),

  getHotel: (hotelId: string) => fetchRow<Hotel>('hotels', hotelId) as Promise<Hotel | null>,

  createHotelDoc: async (hotelId: string, data: Omit<Hotel, 'id'>): Promise<string> => {
    // Caller provides a pre-generated id (UUID — hotels.id is a uuid column);
    // insert with that id by passing it explicitly. adminCredentials is a UI
    // convenience and has no hotels table column (login_email holds the email).
    // IMPORTANT: the payload must be mapped camelCase → snake_case like every
    // other write. Sending `currencySymbol`, `loginEmail`, `hotelCode`, etc.
    // verbatim makes PostgREST fail with
    //   Could not find the 'currencySymbol' column of 'hotels' in the schema cache.
    const { adminCredentials: _adminCredentials, ...row } = data as Record<string, any>;
    const { error } = await supabase
      .from('hotels')
      .insert({ id: hotelId, ...objectToRow(row), created_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return hotelId;
  },

  updateHotelDoc: async (hotelId: string, data: Partial<Hotel>): Promise<void> => {
    // Same camelCase → snake_case mapping as createHotelDoc (branding/modules
    // stay plain objects — they are jsonb columns).
    const { error } = await supabase
      .from('hotels')
      .update({ ...objectToRow(data as Record<string, any>), updated_at: new Date().toISOString() })
      .eq('id', hotelId);
    if (error) throw new Error(error.message);
  },

  deleteHotelDoc: async (hotelId: string): Promise<void> => {
    // ON DELETE CASCADE removes every tenant row. Just delete the hotel.
    await supabase.from('hotels').delete().eq('id', hotelId);
  },

  // ==========================================
  // ROOMS
  // ==========================================
  subscribeRooms: (
    hotelId: string,
    onUpdate: (rooms: Room[]) => void,
    onError?: (err: Error) => void
  ): Unsub =>
    subscribeTable<Room>(
      'rooms',
      (rows) => onUpdate(rows.map((r) => ({ ...r, hotelId }))),
      { hotelId, orderBy: { column: 'room_number', ascending: true } },
      onError
    ),

  /** Single-room listener for the guest portal (RLS only returns their room). */
  subscribeRoom: (
    hotelId: string,
    roomId: string,
    onUpdate: (room: Room | null) => void,
    onError?: (err: Error) => void
  ): Unsub =>
    subscribeRow<Room>(
      'rooms',
      roomId,
      (room) => onUpdate(room ? { ...room, hotelId } : null),
      onError
    ),

  addRoom: (hotelId: string, roomData: Omit<Room, 'id' | 'hotelId'>) =>
    insertRow('rooms', { ...(roomData as object), hotelId }),

  updateRoom: (hotelId: string, roomId: string, data: Partial<Room>) =>
    updateRow('rooms', roomId, data as Record<string, unknown>),

  deleteRoom: (hotelId: string, roomId: string) => deleteRow('rooms', roomId),

  // ==========================================
  // FOOD MENU
  // ==========================================
  subscribeFoodItems: (
    hotelId: string,
    onUpdate: (items: FoodItem[]) => void,
    onError?: (err: Error) => void
  ): Unsub =>
    subscribeTable<FoodItem>(
      'food_items',
      (rows) => onUpdate(rows.map((r) => ({ ...r, hotelId }))),
      { hotelId, orderBy: { column: 'name', ascending: true } },
      onError
    ),

  addFoodItem: (hotelId: string, itemData: Omit<FoodItem, 'id' | 'hotelId'>) =>
    insertRow('food_items', { ...(itemData as object), hotelId }),

  updateFoodItem: (hotelId: string, itemId: string, data: Partial<FoodItem>) =>
    updateRow('food_items', itemId, data as Record<string, unknown>),

  deleteFoodItem: (hotelId: string, itemId: string) => deleteRow('food_items', itemId),

  // ==========================================
  // SERVICES
  // ==========================================
  subscribeServices: (
    hotelId: string,
    onUpdate: (services: HotelService[]) => void,
    onError?: (err: Error) => void
  ): Unsub =>
    subscribeTable<HotelService>(
      'services',
      (rows) => onUpdate(rows.map((r) => ({ ...r, hotelId }))),
      { hotelId, orderBy: { column: 'name', ascending: true } },
      onError
    ),

  addService: (hotelId: string, serviceData: Omit<HotelService, 'id' | 'hotelId'>) =>
    insertRow('services', { ...(serviceData as object), hotelId }),

  updateService: (hotelId: string, serviceId: string, data: Partial<HotelService>) =>
    updateRow('services', serviceId, data as Record<string, unknown>),

  deleteService: (hotelId: string, serviceId: string) => deleteRow('services', serviceId),

  // ==========================================
  // ORDERS / REQUESTS
  // ==========================================
  subscribeOrders: (
    hotelId: string,
    onUpdate: (orders: ServiceRequest[]) => void,
    onError?: (err: Error) => void
  ): Unsub =>
    subscribeTable<ServiceRequest>(
      'orders',
      (rows) => onUpdate(rows.map((r) => ({ ...r, hotelId }))),
      { hotelId, orderBy: { column: 'created_at', ascending: false } },
      onError
    ),

  subscribeGuestOrders: (
    hotelId: string,
    guestUid: string,
    onUpdate: (orders: ServiceRequest[]) => void,
    onError?: (err: Error) => void
  ): Unsub =>
    subscribeTable<ServiceRequest>(
      'orders',
      (rows) => {
        const sorted = rows
          .map((r) => ({ ...r, hotelId }))
          .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        onUpdate(sorted);
      },
      { hotelId, filters: [{ column: 'guest_uid', value: guestUid }] },
      onError
    ),

  // Real-time NEW-order stream for the alert center. Emits added docs, skipping
  // the initial load (isFirst) just like the Firestore docChanges version.
  subscribeOrderChanges: (
    hotelId: string,
    onChanges: (added: Array<{ id: string; data: any }>, isFirst: boolean) => void,
    onError?: (err: Error) => void
  ): Unsub => {
    let isFirst = true;
    let seen = new Set<string>();
    return subscribeTable<ServiceRequest>(
      'orders',
      (rows) => {
        // Firestore delivered "added" changes; approximate by diffing against
        // the set of ids we have already emitted.
        const added = rows
          .filter((r) => !seen.has(r.id))
          .map((r) => ({ id: r.id, data: { ...r, hotelId } }));
        rows.forEach((r) => seen.add(r.id));
        onChanges(added, isFirst);
        isFirst = false;
      },
      { hotelId, orderBy: { column: 'created_at', ascending: false } },
      onError
    );
  },

  createOrder: async (hotelId: string, orderData: any): Promise<string> => {
    return insertRow('orders', {
      ...orderData,
      hotelId,
      createdAt: orderData.createdAt || new Date().toISOString(),
    });
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
    const payload: Record<string, unknown> = { status, ...(extra || {}) };
    if (status === 'COMPLETED' || status === 'completed') {
      payload.completedAt = new Date().toISOString();
    }
    await updateRow('orders', orderId, payload);
  },

  /**
   * Guest 5-star feedback on a completed order. Guests have no general UPDATE
   * grant on `orders` (RLS), so this goes through the same ownership-checked
   * RPC pattern as `linkOrderCharge` — only `guest_feedback` is ever touched.
   */
  submitGuestOrderFeedback: async (
    orderId: string,
    rating: number,
    comment?: string
  ): Promise<{ ok: boolean; reason?: string }> => {
    try {
      const { data, error } = await supabase.rpc('submit_guest_order_feedback', {
        p_order_id: orderId,
        p_rating: rating,
        p_comment: comment || '',
      });
      if (error) return { ok: false, reason: error.message };
      return (data as { ok: boolean; reason?: string }) || { ok: false, reason: 'no-response' };
    } catch (err: any) {
      return { ok: false, reason: err?.message || 'network-error' };
    }
  },

  // ==========================================
  // ROOM TYPES
  // ==========================================
  subscribeRoomTypes: (
    hotelId: string,
    onUpdate: (types: RoomTypeDefinition[]) => void,
    onError?: (err: Error) => void
  ): Unsub =>
    subscribeTable<RoomTypeDefinition>(
      'room_types',
      (rows) => onUpdate(rows.map((r) => ({ ...r, hotelId }))),
      { hotelId, orderBy: { column: 'name', ascending: true } },
      onError
    ),

  addRoomType: (hotelId: string, data: Omit<RoomTypeDefinition, 'id' | 'hotelId'>) =>
    insertRow('room_types', {
      ...(data as object),
      baseRate: (data as any).baseRate,
      maxOccupancy: (data as any).maxOccupancy,
      hotelId,
    }),

  updateRoomType: (hotelId: string, roomTypeId: string, data: Partial<RoomTypeDefinition>) =>
    updateRow('room_types', roomTypeId, data as Record<string, unknown>),

  // ==========================================
  // GUESTS
  // ==========================================
  subscribeGuests: (
    hotelId: string,
    onUpdate: (guests: Guest[]) => void,
    onError?: (err: Error) => void
  ): Unsub =>
    subscribeTable<Guest>(
      'guests',
      (rows) => onUpdate(rows.map((r) => ({ ...r, hotelId }))),
      { hotelId, orderBy: { column: 'name', ascending: true } },
      onError
    ),

  createGuest: (hotelId: string, data: Omit<Guest, 'id' | 'hotelId'>) =>
    insertRow('guests', { ...(data as object), hotelId }),

  updateGuest: (hotelId: string, guestId: string, data: Partial<Guest>) =>
    updateRow('guests', guestId, data as Record<string, unknown>),

  // ==========================================
  // BOOKINGS
  // ==========================================
  subscribeBookings: (
    hotelId: string,
    onUpdate: (bookings: Booking[]) => void,
    onError?: (err: Error) => void
  ): Unsub =>
    subscribeTable<Booking>(
      'bookings',
      (rows) => onUpdate(rows.map((r) => ({ ...r, hotelId }))),
      { hotelId, orderBy: { column: 'check_in_date', ascending: false } },
      onError
    ),

  /** Availability for a stay window — reads room_nights locks and rooms. */
  findAvailableRooms: async (
    hotelId: string,
    checkInDate: string,
    checkOutDate: string
  ): Promise<RoomAvailability[]> => {
    const stay = isValidStay(checkInDate, checkOutDate);
    if (!stay.ok) throw new BookingConflictError(stay.error, 'booking/invalid-stay');

    const [nightsRes, roomsRes] = await Promise.all([
      supabase
        .from('room_nights')
        .select('room_id,date,booking_id')
        .eq('hotel_id', hotelId)
        .gte('date', checkInDate)
        .lt('date', checkOutDate),
      supabase.from('rooms').select('*').eq('hotel_id', hotelId).order('room_number', { ascending: true }),
    ]);
    if (nightsRes.error) throw new Error(nightsRes.error.message);
    if (roomsRes.error) throw new Error(roomsRes.error.message);

    const taken = new Map<string, { bookingId: string; dates: string[] }>();
    (nightsRes.data || []).forEach((n: any) => {
      const entry = taken.get(n.room_id) || { bookingId: n.booking_id, dates: [] };
      entry.dates.push(n.date);
      taken.set(n.room_id, entry);
    });

    const rooms = (roomsRes.data || []).map((r) => rowToObject<Room>(r) as Room);
    return rooms
      .map((room) => {
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
   * Creates a booking + room-night locks + folio atomically via the
   * create_booking() RPC (double-booking safe; SECURITY DEFINER, staff only).
   */
  createBooking: async (hotelId: string, input: CreateBookingInput): Promise<string> => {
    const { guestId, roomId, roomTypeId, checkInDate, checkOutDate, agreedRate, numGuests, source } = input;

    const stay = isValidStay(checkInDate, checkOutDate);
    if (!stay.ok) throw new BookingConflictError(stay.error, 'booking/invalid-stay');
    const nights = enumerateNights(checkInDate, checkOutDate);
    if (nights.length === 0) {
      throw new BookingConflictError('A booking must cover at least one night.', 'booking/invalid-stay');
    }
    if (agreedRate < 0 || !Number.isFinite(agreedRate)) {
      throw new BookingConflictError('Agreed rate must be a positive number.', 'booking/invalid-rate');
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase.rpc('create_booking', {
      p_hotel_id: hotelId,
      p_guest_id: guestId,
      p_room_id: roomId,
      p_room_type_id: roomTypeId,
      p_check_in: checkInDate,
      p_check_out: checkOutDate,
      p_rate: agreedRate,
      p_num_guests: numGuests,
      p_source: source,
      p_created_by: user?.id || 'unknown',
    });

    if (error) {
      if (error.message.includes('booking/room-not-available')) {
        // Fetch the conflicting nights for a precise message.
        const { data: conflictNights } = await supabase
          .from('room_nights')
          .select('date')
          .eq('room_id', roomId)
          .gte('date', checkInDate)
          .lt('date', checkOutDate);
        const dates = (conflictNights || []).map((n: any) => n.date).sort();
        throw new BookingConflictError(
          `Room is already booked for ${dates.length} of the requested night(s)` +
            ` (${dates.slice(0, 3).join(', ')}${dates.length > 3 ? '…' : ''}). Choose another room or dates.`,
          'booking/room-not-available',
          dates
        );
      }
      if (error.message.includes('booking/')) {
        throw new BookingConflictError(error.message, error.message.split(' ')[0]);
      }
      throw new Error(error.message);
    }
    return data as string;
  },

  checkInGuest: async (hotelId: string, bookingId: string, roomId: string): Promise<void> => {
    const now = new Date().toISOString();
    const { error: bErr } = await supabase
      .from('bookings')
      .update({ status: 'CHECKED_IN' as BookingStatus, actual_check_in_at: now, actual_check_out_at: null })
      .eq('id', bookingId)
      .eq('hotel_id', hotelId);
    if (bErr) throw new Error(bErr.message);
    const { error: rErr } = await supabase
      .from('rooms')
      .update({ status: 'occupied' })
      .eq('id', roomId)
      .eq('hotel_id', hotelId);
    if (rErr) throw new Error(rErr.message);
  },

  checkOutGuest: async (hotelId: string, bookingId: string, roomId: string): Promise<void> => {
    const now = new Date().toISOString();
    await supabase
      .from('bookings')
      .update({ status: 'CHECKED_OUT' as BookingStatus, actual_check_out_at: now })
      .eq('id', bookingId)
      .eq('hotel_id', hotelId);
    // Room goes to cleaning — housekeeping clears it (matches Firestore behaviour).
    await supabase.from('rooms').update({ status: 'cleaning' }).eq('id', roomId).eq('hotel_id', hotelId);
  },

  /** Releases room-night locks so the room can be resold. */
  cancelBooking: async (hotelId: string, bookingId: string): Promise<void> => {
    const booking = await fetchRow<Booking>('bookings', bookingId);
    if (!booking) throw new Error('Booking not found.');
    if (booking.status === 'CANCELLED' || booking.status === 'CHECKED_OUT') return;

    const wasCheckedIn = booking.status === 'CHECKED_IN';
    const nights = enumerateNights(booking.checkInDate, booking.checkOutDate);

    // Delete locks, then update booking, then set room to cleaning if it was in-house.
    for (const date of nights) {
      await supabase.from('room_nights').delete().eq('room_id', booking.roomId).eq('date', date);
    }
    await supabase
      .from('bookings')
      .update({ status: 'CANCELLED' as BookingStatus })
      .eq('id', bookingId)
      .eq('hotel_id', hotelId);
    if (wasCheckedIn) {
      await supabase.from('rooms').update({ status: 'cleaning' }).eq('id', booking.roomId);
    }
  },

  markNoShow: async (hotelId: string, bookingId: string): Promise<void> => {
    const booking = await fetchRow<Booking>('bookings', bookingId);
    if (!booking) throw new Error('Booking not found.');
    if (booking.status !== 'RESERVED') return;
    for (const date of enumerateNights(booking.checkInDate, booking.checkOutDate)) {
      await supabase.from('room_nights').delete().eq('room_id', booking.roomId).eq('date', date);
    }
    await supabase
      .from('bookings')
      .update({ status: 'NO_SHOW' as BookingStatus })
      .eq('id', bookingId)
      .eq('hotel_id', hotelId);
  },

  // ==========================================
  // FOLIOS
  // ==========================================
  subscribeFolio: (
    hotelId: string,
    bookingId: string,
    onUpdate: (folio: Folio | null) => void,
    onError?: (err: Error) => void
  ): Unsub => subscribeRow<Folio>('folios', bookingId, onUpdate, onError),

  getFolio: (hotelId: string, bookingId: string) => fetchRow<Folio>('folios', bookingId) as Promise<Folio | null>,

  subscribeCharges: (
    hotelId: string,
    bookingId: string,
    onUpdate: (charges: Charge[]) => void,
    onError?: (err: Error) => void
  ): Unsub =>
    subscribeTable<Charge>(
      'charges',
      onUpdate,
      {
        hotelId,
        filters: [{ column: 'folio_id', value: bookingId }],
        orderBy: { column: 'created_at', ascending: false },
      },
      onError
    ),

  /**
   * Links an order to its booking's folio. Guests can't write folios (RLS), so
   * the request goes through the Express server, which calls the
   * post_guest_order_charge() RPC. Advisory — failures never block the order.
   */
  linkOrderCharge: async (orderId: string): Promise<{ linked: boolean; reason?: string }> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return { linked: false, reason: 'no-session' };

    try {
      const response = await fetch(`/api/guest/orders/${encodeURIComponent(orderId)}/charge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { linked: false, reason: data?.code || `http-${response.status}` };
      return { linked: !!data.linked, reason: data.reason };
    } catch (err: any) {
      return { linked: false, reason: err?.message || 'network-error' };
    }
  },

  nightsBetween,

  // ---- Server admin calls (super admin) -----------------------------------
  createHotelUserAuth: async (
    hotelId: string,
    hotelName: string,
    email: string,
    password: string,
    name?: string,
    phone?: string
  ) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Not authenticated. Please sign in as Super Admin.');
    }

    const response = await fetch('/api/admin/create-hotel-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ hotelId, hotelName, email, password, name, phone }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.details || 'Failed to create hotel admin user');
    return data;
  },

  deleteHotelUserAuth: async (email: string) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch('/api/admin/delete-hotel-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email }),
    });
  },

  /** Emails a password reset link (Supabase Auth; the raw password is never stored). */
  sendHotelPasswordReset: async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`,
    });
    if (error) throw new Error(error.message);
  },
};
