import {
  Hotel,
  User,
  Room,
  GuestSession,
  ServiceCategory,
  HotelService,
  FoodCategory,
  FoodItem,
  ServiceRequest,
  InAppNotification,
  AuditLog,
  DailyReportData,
} from '../types';

let currentAuthToken: string | null = localStorage.getItem('nexora_token') || 'tok_super_admin_secret_9988';
let targetTenantId: string | null = localStorage.getItem('nexora_target_tenant') || null;

export const setAuthToken = (token: string | null) => {
  currentAuthToken = token;
  if (token) {
    localStorage.setItem('nexora_token', token);
  } else {
    localStorage.removeItem('nexora_token');
  }
};

export const setTargetTenantId = (tenantId: string | null) => {
  targetTenantId = tenantId;
  if (tenantId) {
    localStorage.setItem('nexora_target_tenant', tenantId);
  } else {
    localStorage.removeItem('nexora_target_tenant');
  }
};

export const getTargetTenantId = () => targetTenantId;

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (currentAuthToken) {
    headers['Authorization'] = `Bearer ${currentAuthToken}`;
  }

  if (targetTenantId) {
    headers['x-target-hotel-id'] = targetTenantId;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP error ${response.status}`);
  }

  return data;
}

export const api = {
  // Guest Room Token Resolution & Order Submission
  resolveRoomToken: (token: string) =>
    request<{
      hotel: Hotel;
      room: Room;
      activeSession: GuestSession | null;
      serviceCategories: ServiceCategory[];
      services: HotelService[];
      foodCategories: FoodCategory[];
      foodItems: FoodItem[];
      activeRequests: ServiceRequest[];
      notifications: InAppNotification[];
    }>(`/api/guest/resolve/${token}`),

  submitGuestRequest: (payload: {
    token: string;
    type: 'food' | 'service';
    serviceId?: string;
    items?: Array<{ productId: string; variantId?: string; quantity: number; notes?: string; name: string }>;
    specialNotes?: string;
    guestNameOverride?: string;
  }) =>
    request<{ success: boolean; request: ServiceRequest; message: string }>('/api/guest/request', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitFeedback: (payload: { requestId: string; rating: number; comment?: string }) =>
    request<{ success: boolean; message: string }>('/api/guest/feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Auth
  getDemoUsers: () => request<{ users: any[] }>('/api/auth/demo-users'),
  login: (email: string, password?: string) =>
    request<{ user: User; hotel: Hotel | null }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  getMe: () => request<{ user: User; hotel: Hotel | null }>('/api/auth/me'),

  // Super Admin
  getSuperHotels: () => request<{ hotels: any[] }>('/api/super/hotels'),
  createHotelTenant: (payload: any) =>
    request<{ success: boolean; hotel: Hotel; adminUser: User; message: string }>('/api/super/hotels', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateHotelTenant: (id: string, payload: any) =>
    request<{ success: boolean; hotel: Hotel }>(`/api/super/hotels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteHotelTenant: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/super/hotels/${id}`, {
      method: 'DELETE',
    }),
  getSuperAuditLogs: () => request<{ logs: AuditLog[] }>('/api/super/audit-logs'),

  // Hotel Admin Operations
  getHotelDashboard: () =>
    request<{
      hotel: Hotel;
      kpis: any;
      recentRequests: ServiceRequest[];
      recentFeedback: any[];
    }>('/api/hotel/dashboard'),

  getHotelRooms: () => request<{ rooms: (Room & { activeGuest: any })[] }>('/api/hotel/rooms'),
  createRooms: (payload: any) => request<{ success: boolean; count: number; createdRooms: Room[] }>('/api/hotel/rooms', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  regenerateRoomQr: (roomId: string) =>
    request<{ success: boolean; room: Room }>(`/api/hotel/rooms/${roomId}/regenerate-qr`, {
      method: 'POST',
    }),
  checkInGuest: (payload: any) =>
    request<{ success: boolean; session: GuestSession; room: Room }>('/api/hotel/guests/checkin', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  checkOutGuest: (payload: { roomId: string }) =>
    request<{ success: boolean; message: string; room: Room }>('/api/hotel/guests/checkout', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Requests / Orders Board
  getHotelRequests: () => request<{ requests: ServiceRequest[] }>('/api/hotel/requests'),
  updateRequestStatus: (id: string, payload: any) =>
    request<{ success: boolean; request: ServiceRequest }>(`/api/hotel/requests/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Food Menu
  getFoodMenu: () => request<{ categories: FoodCategory[]; items: FoodItem[] }>('/api/hotel/food-menu'),
  saveFoodItem: (payload: any) =>
    request<{ success: boolean; item: FoodItem }>('/api/hotel/food-menu/items', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  toggleFoodAvailability: (id: string, isAvailable: boolean) =>
    request<{ success: boolean; item: FoodItem }>(`/api/hotel/food-menu/items/${id}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable }),
    }),

  // Services Catalog
  getHotelServices: () => request<{ categories: ServiceCategory[]; services: HotelService[] }>('/api/hotel/services'),
  saveHotelService: (payload: any) =>
    request<{ success: boolean; service: HotelService }>('/api/hotel/services', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  toggleServiceAvailability: (id: string, isAvailable: boolean) =>
    request<{ success: boolean; service: HotelService }>(`/api/hotel/services/${id}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable }),
    }),

  // Reports
  getDailyReport: () => request<{ report: DailyReportData }>('/api/hotel/reports/daily'),
  triggerDailyReset: () => request<{ success: boolean; resetCount: number; message: string }>('/api/hotel/actions/daily-reset', {
    method: 'POST',
  }),
  sendWhatsAppReport: (recipientPhone?: string) =>
    request<{ success: boolean; recipientPhone: string; formattedSummary: string; whatsappDirectUrl: string; status: string }>(
      '/api/hotel/reports/send-whatsapp',
      {
        method: 'POST',
        body: JSON.stringify({ recipientPhone }),
      }
    ),
};
