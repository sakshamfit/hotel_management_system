export type UserRole =
  | 'super_admin'
  | 'hotel_admin'
  | 'SUPER_ADMIN'
  | 'HOTEL_ADMIN'
  | 'HOTEL_OWNER'
  | 'RECEPTIONIST'
  | 'KITCHEN_STAFF'
  | 'HOUSEKEEPING_STAFF'
  | 'MAINTENANCE_STAFF';

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

export type RoomStatus = 'available' | 'occupied' | 'maintenance' | 'cleaning' | 'VACANT' | 'OCCUPIED';
export type RoomType = 'Standard' | 'Deluxe' | 'Premium' | 'Suite' | 'Family' | 'Executive' | 'Presidential' | 'Chalet' | string;

export interface Room {
  id: string;
  hotelId: string;
  roomNumber: string;
  floor: number;
  roomType?: RoomType;
  type?: string;
  capacity?: number;
  status: RoomStatus;
  permanentToken: string; // Secure token used in QR /room/:permanentToken
  photoUrl?: string; // Uploaded to hotels/{hotelId}/rooms/{roomId}/image.jpg (Firebase Storage)
  activeGuestSessionId?: string | null;
  guestName?: string;
  guestPhone?: string;
  guestEmail?: string;
  checkedInAt?: string;
  expectedCheckout?: string;
  lastCheckedOutAt?: string;
  createdAt?: string;
}

export interface GuestSession {
  id: string;
  hotelId: string;
  roomId: string;
  roomNumber: string;
  guestName: string;
  guestPhone: string;
  guestEmail?: string;
  guestCount?: number;
  checkInTime?: string;
  expectedCheckOutTime?: string;
  checkOutDate?: string;
  actualCheckOutTime?: string | null;
  status?: 'active' | 'completed';
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
