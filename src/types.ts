import type { Timestamp } from 'firebase/firestore';

export type UserRole =
  | 'super_admin'
  | 'hotel_admin'
  | 'guest'
  | 'SUPER_ADMIN'
  | 'HOTEL_ADMIN'
  | 'HOTEL_OWNER'
  | 'RECEPTIONIST'
  | 'KITCHEN_STAFF'
  | 'HOUSEKEEPING_STAFF'
  | 'MAINTENANCE_STAFF';

/**
 * Scoped session issued to an anonymous Firebase Auth user after they scan a
 * room QR code. The server sets these as custom claims — the client never
 * decides them, and the room token is never accepted as proof of tenancy
 * without a server round-trip.
 */
export interface GuestClaims {
  role: 'guest';
  hotelId: string;
  roomId: string;
  roomNumber: string;
  /**
   * Display-only: resolved by the server from the active booking so the portal
   * can greet the guest without any read access to bookings or guests.
   */
  guestName?: string;
}

export interface AuthClaims {
  role: 'super_admin' | 'hotel_admin';
  hotelId?: string;
}

export type HotelStatus = 'active' | 'suspended' | 'trial' | 'past_due' | 'ACTIVE' | 'SUSPENDED' | 'TRIAL';

export interface HotelBranding {
  logoUrl: string;
  coverImageUrl: string;
  primaryColor: string; // e.g. #1e293b
  secondaryColor: string; // e.g. #0f172a
  accentColor: string; // e.g. #d97706 or #b45309
  welcomeMessage: string;
  fontFamily: string;
}

export interface HotelModules {
  guestQrSystem: boolean;
  roomService: boolean;
  foodAndBeverage: boolean;
  housekeeping: boolean;
  toiletries: boolean;
  laundry: boolean;
  maintenance: boolean;
  receptionRequests: boolean;
  spaAndWellness: boolean;
  poolAndGym: boolean;
  concierge: boolean;
  guestFeedback: boolean;
  notifications: boolean;
  analytics: boolean;
  dailyReports: boolean;
  autoDailyReset: boolean;
  requireCallConfirmation: boolean;
}

export interface Hotel {
  id: string; // e.g. "tenant_nxr_001"
  hotelCode: string; // e.g. "NXR-GPH-001"
  name: string;
  legalName?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  ownerName?: string;
  ownerPhone?: string;
  ownerWhatsApp?: string;
  currency: string; // "INR", "USD", "AED", "EUR"
  currencySymbol: string; // "₹", "$", "AED ", "€"
  timezone: string; // "Asia/Kolkata", "America/New_York", etc.
  status: HotelStatus | string;
  /** Login email for the hotel's admin account (Firebase Auth). Password is NEVER stored — only in Firebase Auth. */
  loginEmail?: string;
  branding: HotelBranding;
  modules: HotelModules;
  roomsCount?: number;
  adminCredentials?: {
    name: string;
    email: string;
    password?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface User {
  id: string;
  hotelId: string | null; // null for SUPER_ADMIN
  name: string;
  email: string;
  password?: string;
  phone: string;
  role: UserRole;
  token: string;
}

/**
 * FIXED CASING: this union previously carried both `available`/`occupied` and
 * `VACANT`/`OCCUPIED`, so rooms in `cleaning`/`maintenance` matched neither
 * filter and silently vanished from the front desk (audit §4).
 */
export type RoomStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance';

/** hotels/{hotelId}/roomTypes/{roomTypeId} — the rate + inventory definition. */
export interface RoomTypeDefinition {
  id: string;
  hotelId: string;
  name: string; // "Deluxe", "Suite"
  baseRate: number; // nightly, pre-tax
  maxOccupancy: number;
  amenities: string[];
  createdAt?: string;
}

/**
 * Legacy free-text room label (`Room.type`, e.g. "Deluxe King Suite") kept only
 * so the migration can infer room types from existing data. New code reads
 * `roomTypeId`.
 */
export type RoomType = string;

export interface Room {
  id: string;
  hotelId: string;
  roomNumber: string;
  floor: number;
  /** NEW — links the room to its rate/inventory definition. */
  roomTypeId: string;
  roomType?: RoomType;
  type?: string;
  capacity?: number;
  status: RoomStatus;
  permanentToken: string; // Secure token used in QR /room/:permanentToken
  photoUrl?: string; // Uploaded to hotels/{hotelId}/rooms/{roomId}/image.jpg (Firebase Storage)
  createdAt?: string;
  // REMOVED (moved to Guest / Booking by the reservation migration):
  //   guestName, guestPhone, guestEmail, checkedInAt, expectedCheckout,
  //   lastCheckedOutAt, activeGuestSessionId
}

// ===========================================================================
// RESERVATIONS
// ===========================================================================

/**
 * hotels/{hotelId}/guests/{guestId}
 * The booking contact. Deliberately NOT the anonymous portal auth user — a
 * guest profile outlives any single stay and any single QR session.
 */
export interface Guest {
  id: string;
  hotelId: string;
  name: string;
  phone: string;
  email?: string;
  idProofType?: string;
  idProofNumber?: string;
  createdAt?: Timestamp | string;
}

export type BookingStatus = 'RESERVED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';
export type BookingSource = 'walk-in' | 'phone' | 'ota';

/** hotels/{hotelId}/bookings/{bookingId} */
export interface Booking {
  id: string;
  hotelId: string;
  guestId: string;
  roomId: string;
  roomTypeId: string;
  /** Date-only "YYYY-MM-DD". The stay covers [checkInDate, checkOutDate). */
  checkInDate: string;
  checkOutDate: string;
  actualCheckInAt?: Timestamp | string | null;
  actualCheckOutAt?: Timestamp | string | null;
  status: BookingStatus;
  /** Snapshot at booking time — later roomType rate changes must not move it. */
  agreedRate: number;
  numGuests: number;
  source: BookingSource;
  createdBy: string; // staff uid
  createdAt?: Timestamp | string;

  // ---- joined at read time (never stored) ----
  guestName?: string;
  guestPhone?: string;
  roomNumber?: string;
}

/**
 * hotels/{hotelId}/roomNights/{roomId}_{date}
 * THE double-booking lock: the existence of this document means that room is
 * taken on that night. Written inside the same transaction as the booking.
 */
export interface RoomNight {
  id?: string;
  roomId: string;
  date: string; // "YYYY-MM-DD"
  bookingId: string;
}

export type FolioStatus = 'OPEN' | 'CLOSED';

/** hotels/{hotelId}/folios/{bookingId} — one folio per booking, same id. */
export interface Folio {
  id: string; // == bookingId
  bookingId: string;
  status: FolioStatus;
  balance: number;
}

export type ChargeType = 'ROOM' | 'FOOD' | 'SERVICE' | 'TAX' | 'DISCOUNT';

/** hotels/{hotelId}/folios/{bookingId}/charges/{chargeId} */
export interface Charge {
  id: string;
  type: ChargeType;
  description: string;
  amount: number;
  sourceOrderId?: string; // links back to the existing orders collection
  createdAt?: Timestamp | string;
}

export type PaymentMethod = 'cash' | 'card' | 'upi';

/** hotels/{hotelId}/folios/{bookingId}/payments/{paymentId} */
export interface Payment {
  id: string;
  amount: number;
  method: PaymentMethod;
  receivedBy: string;
  receivedAt?: Timestamp | string;
}

/** Input for createBooking — everything the front desk supplies. */
export interface CreateBookingInput {
  guestId: string;
  roomId: string;
  roomTypeId: string;
  checkInDate: string;
  checkOutDate: string;
  agreedRate: number;
  numGuests: number;
  source: BookingSource;
}

export interface ServiceCategory {
  id: string;
  hotelId: string;
  name: string;
  icon?: string;
  displayOrder?: number;
}

export interface HotelService {
  id: string;
  hotelId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number; // 0 for complimentary
  icon?: string;
  estimatedTimeMinutes?: number;
  slaMinutes?: number;
  isAvailable: boolean;
  requiresApproval?: boolean;
  requiresNotes?: boolean;
  displayOrder?: number;
}

export interface FoodCategory {
  id: string;
  hotelId: string;
  name: string;
  displayOrder?: number;
}

export interface ProductVariant {
  id: string;
  name: string; // e.g. "Regular", "Half", "Full", "Large"
  price: number;
}

export interface FoodItem {
  id: string;
  hotelId: string;
  categoryId?: string;
  category?: string;
  name: string;
  description?: string;
  imageUrl?: string;
  dietary?: 'veg' | 'non-veg' | 'vegan' | string;
  isVegetarian?: boolean;
  isVeg?: boolean;
  basePrice?: number;
  price?: number;
  variants?: ProductVariant[];
  isAvailable: boolean;
  prepTimeMinutes?: number;
  preparationTimeMinutes?: number;
  displayOrder?: number;
}

export type RequestStatus =
  | 'NEW'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'received'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'delivering'
  | 'completed'
  | 'cancelled'
  | string;

export interface OrderItem {
  id?: string;
  productId?: string;
  name: string;
  variantName?: string;
  variantId?: string;
  priceAtOrder?: number;
  price?: number;
  quantity: number;
  notes?: string;
}

export interface ServiceRequest {
  id: string;
  hotelId: string;
  roomId?: string;
  roomNumber: string;
  guestSessionId?: string;
  guestName: string;
  guestPhone?: string;
  type: 'food' | 'service' | string;
  serviceId?: string;
  serviceName?: string;
  items?: OrderItem[];
  totalAmount?: number;
  status: RequestStatus;
  priority?: RequestPriority;
  assignedStaffId?: string | null;
  assignedStaffName?: string | null;
  estimatedDeliveryMinutes?: number;
  receptionConfirmed?: boolean;
  callConfirmedRequired?: boolean;
  callConfirmed?: boolean;
  callGuestLogged?: boolean;
  specialNotes?: string;
  instructions?: string;
  statusNote?: string;
  guestFeedback?: {
    rating: number;
    comment?: string;
    submittedAt?: string;
  } | null;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string | null;
}

export interface InAppNotification {
  id: string;
  hotelId: string;
  guestSessionId?: string | null;
  targetRole?: string;
  title: string;
  message: string;
  type?: string;
  isRead?: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  hotelId?: string | null;
  userId?: string;
  userName?: string;
  userRole?: string;
  action: string;
  details?: any;
  timestamp?: string;
  createdAt?: string;
}

export interface DailyReportData {
  hotelId?: string;
  hotelName?: string;
  hotelCode?: string;
  currencySymbol?: string;
  date?: string;
  period?: string;
  totalRevenue?: number;
  foodRevenue?: number;
  serviceRevenue?: number;
  totalOrders?: number;
  totalRequests?: number;
  totalServiceRequests?: number;
  completedRequests?: number;
  cancelledRequests?: number;
  activeGuestsCount?: number;
  checkInsCount?: number;
  checkOutsCount?: number;
  averageRating?: number;
  averageDeliveryMinutes?: number;
  topItems?: { name: string; count: number; revenue: number }[];
  topFoodItems?: { name: string; count: number; revenue: number }[];
  topServices?: { name: string; count: number }[];
  avgCompletionTimeMinutes?: number;
}
