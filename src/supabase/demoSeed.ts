/**
 * NEXORA HOTEL OS — demo mode seed data.
 *
 * Used ONLY when real Supabase credentials are not configured (see
 * src/supabase/config.ts). Mirrors supabase/seed.sql, plus the demo staff
 * accounts and a small "live" property (active stay, folio, orders) so every
 * part of the OS works out of the box:
 *
 *   Super Admin : admin@nexora.test   / nexora123
 *   Hotel Admin : admin@grandplaza.demo / nexora123
 *   Guest QR    : ?token=tok-demo-101 (Room 101, checked-in stay)
 *
 * Nothing here runs against a real database; it is a purely local, in-memory
 * store persisted to localStorage so the preview survives reloads.
 */

import type { DemoRow, DemoAuthUser } from './localBackendTypes';

export const DEMO_SUPER_ADMIN_EMAIL = 'admin@nexora.test';
export const DEMO_SUPER_ADMIN_PASSWORD = 'nexora123';
export const DEMO_HOTEL_ADMIN_EMAIL = 'admin@grandplaza.demo';
export const DEMO_HOTEL_ADMIN_PASSWORD = 'nexora123';

export const DEMO_HOTEL_ID = '11111111-1111-4111-8111-111111111110';
export const DEMO_FOOD_ROOM_ID = '33333333-3333-4333-8333-333333333301'; // Room 101
export const DEMO_FOOD_ROOM_TOKEN = 'tok-demo-101';

/** ISO string for `daysFromNow` days from now (negative = past). */
function iso(daysFromNow: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** Date-only "YYYY-MM-DD" for `daysFromNow` days from now. */
function dateOnly(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

const DEMO_MODULES = {
  guestQrSystem: true,
  roomService: true,
  foodAndBeverage: true,
  housekeeping: true,
  toiletries: true,
  laundry: true,
  maintenance: true,
  receptionRequests: true,
  spaAndWellness: true,
  poolAndGym: true,
  concierge: true,
  guestFeedback: true,
  notifications: true,
  analytics: true,
  dailyReports: true,
  autoDailyReset: true,
  requireCallConfirmation: false,
};

/**
 * Builds the initial demo database. Called once; subsequent state is loaded
 * from localStorage when available.
 */
export function buildDemoSeed(): Record<string, DemoRow[]> {
  const hotelId = DEMO_HOTEL_ID;
  const room101 = '33333333-3333-4333-8333-333333333301';
  const room102 = '33333333-3333-4333-8333-333333333302';
  const room201 = '33333333-3333-4333-8333-333333333303';
  const room202 = '33333333-3333-4333-8333-333333333304';
  const room103 = '33333333-3333-4333-8333-333333333305';
  const room104 = '33333333-3333-4333-8333-333333333306';
  const guestPriya = '77777777-7777-4777-8777-777777777701';
  const guestArjun = '77777777-7777-4777-8777-777777777702';
  const booking101 = '88888888-8888-4888-8888-888888888801';
  const booking102 = '88888888-8888-4888-8888-888888888802';
  const folio101 = booking101;
  const folio102 = booking102;

  const foodItem = (
    id: string,
    name: string,
    description: string,
    price: number,
    category: string,
    isVeg: boolean,
    displayOrder: number,
    prepTimeMinutes = 15
  ): DemoRow => ({
    id,
    hotel_id: hotelId,
    category,
    category_id: null,
    name,
    description,
    price,
    base_price: price,
    is_veg: isVeg,
    is_vegetarian: isVeg,
    dietary: isVeg ? 'veg' : 'non-veg',
    variants: [],
    is_available: true,
    prep_time_minutes: prepTimeMinutes,
    preparation_time_minutes: prepTimeMinutes,
    display_order: displayOrder,
    created_at: iso(-20),
  });

  const service = (
    id: string,
    name: string,
    description: string,
    price: number,
    displayOrder: number,
    requiresApproval = false,
    slaMinutes = 20
  ): DemoRow => ({
    id,
    hotel_id: hotelId,
    category_id: null,
    name,
    description,
    price,
    icon: null,
    estimated_time_minutes: slaMinutes,
    sla_minutes: slaMinutes,
    is_available: true,
    requires_approval: requiresApproval,
    requires_notes: false,
    display_order: displayOrder,
    created_at: iso(-20),
  });

  return {
    hotels: [
      {
        id: hotelId,
        hotel_code: 'DEMO-GPH-001',
        name: 'Grand Plaza Demo',
        legal_name: 'Grand Plaza Demo Pvt. Ltd.',
        address: '12 Station Road',
        city: 'Bettiah',
        state: 'Bihar',
        country: 'IN',
        postal_code: '845438',
        phone: '+91 98765 43210',
        email: 'stay@grandplaza.demo',
        owner_name: 'Demo Owner',
        owner_phone: '+91 98765 43210',
        owner_whats_app: '+91 98765 43210',
        currency: 'INR',
        currency_symbol: '₹',
        timezone: 'Asia/Kolkata',
        status: 'active',
        login_email: DEMO_HOTEL_ADMIN_EMAIL,
        branding: {
          logoUrl: '',
          coverImageUrl: '',
          primaryColor: '#0066cc',
          secondaryColor: '#1d1d1f',
          accentColor: '#0066cc',
          welcomeMessage: 'Welcome to Grand Plaza. Whatever you need, we are a tap away.',
          fontFamily: 'Inter, sans-serif',
        },
        modules: DEMO_MODULES,
        gst_percent: 5,
        open_time: '00:00',
        close_time: '23:59',
        staff_pins: { RECEPTION: '1234', KITCHEN: '1234', HOUSEKEEPING: '1234', MAINTENANCE: '1234' },
        rooms_count: 6,
        admin_credentials: { name: 'Grand Plaza Admin', email: DEMO_HOTEL_ADMIN_EMAIL },
        created_at: iso(-30),
        updated_at: iso(-1),
      },
    ],

    profiles: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        role: 'super_admin',
        hotel_id: null,
        email: DEMO_SUPER_ADMIN_EMAIL,
        display_name: 'Nexora Super Admin',
        phone: '',
        created_at: iso(-30),
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        role: 'hotel_admin',
        hotel_id: hotelId,
        email: DEMO_HOTEL_ADMIN_EMAIL,
        display_name: 'Grand Plaza Admin',
        phone: '+91 98765 43210',
        created_at: iso(-30),
      },
    ],

    room_types: [
      {
        id: '22222222-2222-4222-8222-222222222201',
        hotel_id: hotelId,
        name: 'Deluxe',
        base_rate: 2000,
        max_occupancy: 2,
        amenities: ['WiFi', 'AC', 'TV', 'Hot Water'],
        created_at: iso(-30),
      },
      {
        id: '22222222-2222-4222-8222-222222222202',
        hotel_id: hotelId,
        name: 'Suite',
        base_rate: 4500,
        max_occupancy: 4,
        amenities: ['WiFi', 'AC', 'TV', 'Mini Bar', 'Bathtub', 'Lounge'],
        created_at: iso(-30),
      },
      {
        id: '22222222-2222-4222-8222-222222222203',
        hotel_id: hotelId,
        name: 'Standard',
        base_rate: 1200,
        max_occupancy: 2,
        amenities: ['WiFi', 'Fan', 'TV'],
        created_at: iso(-30),
      },
    ],

    rooms: [
      { id: room101, hotel_id: hotelId, room_number: '101', floor: 1, room_type_id: '22222222-2222-4222-8222-222222222201', type: 'Deluxe', capacity: 2, status: 'occupied', permanent_token: 'tok-demo-101', photo_url: null, created_at: iso(-30) },
      { id: room102, hotel_id: hotelId, room_number: '102', floor: 1, room_type_id: '22222222-2222-4222-8222-222222222201', type: 'Deluxe', capacity: 2, status: 'available', permanent_token: 'tok-demo-102', photo_url: null, created_at: iso(-30) },
      { id: room201, hotel_id: hotelId, room_number: '201', floor: 2, room_type_id: '22222222-2222-4222-8222-222222222202', type: 'Suite', capacity: 4, status: 'available', permanent_token: 'tok-demo-201', photo_url: null, created_at: iso(-30) },
      { id: room202, hotel_id: hotelId, room_number: '202', floor: 2, room_type_id: '22222222-2222-4222-8222-222222222202', type: 'Suite', capacity: 4, status: 'maintenance', permanent_token: 'tok-demo-202', photo_url: null, created_at: iso(-30) },
      { id: room103, hotel_id: hotelId, room_number: '103', floor: 1, room_type_id: '22222222-2222-4222-8222-222222222203', type: 'Standard', capacity: 2, status: 'cleaning', permanent_token: 'tok-demo-103', photo_url: null, created_at: iso(-30) },
      { id: room104, hotel_id: hotelId, room_number: '104', floor: 1, room_type_id: '22222222-2222-4222-8222-222222222203', type: 'Standard', capacity: 2, status: 'available', permanent_token: 'tok-demo-104', photo_url: null, created_at: iso(-30) },
    ],

    guests: [
      { id: guestPriya, hotel_id: hotelId, name: 'Priya Sharma', phone: '+91 90000 11111', email: 'priya@example.com', id_proof_type: 'Aadhaar', id_proof_number: 'XXXX-XXXX-2222', migrated_from_room_id: null, created_at: iso(-2) },
      { id: guestArjun, hotel_id: hotelId, name: 'Arjun Mehta', phone: '+91 90000 22222', email: 'arjun@example.com', id_proof_type: 'Passport', id_proof_number: 'N1234567', migrated_from_room_id: null, created_at: iso(-12) },
    ],

    bookings: [
      {
        id: booking101,
        hotel_id: hotelId,
        guest_id: guestPriya,
        room_id: room101,
        room_type_id: '22222222-2222-4222-8222-222222222201',
        check_in_date: dateOnly(-1),
        check_out_date: dateOnly(1),
        actual_check_in_at: iso(-1, 14),
        actual_check_out_at: null,
        status: 'CHECKED_IN',
        agreed_rate: 2000,
        num_guests: 2,
        source: 'walk-in',
        created_by: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        created_at: iso(-2),
      },
      {
        id: booking102,
        hotel_id: hotelId,
        guest_id: guestArjun,
        room_id: room102,
        room_type_id: '22222222-2222-4222-8222-222222222201',
        check_in_date: dateOnly(-10),
        check_out_date: dateOnly(-8),
        actual_check_in_at: iso(-10, 12),
        actual_check_out_at: iso(-8, 11),
        status: 'CHECKED_OUT',
        agreed_rate: 2000,
        num_guests: 1,
        source: 'phone',
        created_by: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        created_at: iso(-11),
      },
    ],

    room_nights: [
      { hotel_id: hotelId, room_id: room101, date: dateOnly(-1), booking_id: booking101 },
      { hotel_id: hotelId, room_id: room101, date: dateOnly(0), booking_id: booking101 },
      { hotel_id: hotelId, room_id: room102, date: dateOnly(-10), booking_id: booking102 },
      { hotel_id: hotelId, room_id: room102, date: dateOnly(-9), booking_id: booking102 },
    ],

    folios: [
      { id: folio101, hotel_id: hotelId, booking_id: booking101, status: 'OPEN', balance: 4620 },
      { id: folio102, hotel_id: hotelId, booking_id: booking102, status: 'CLOSED', balance: 4000 },
    ],

    charges: [
      { id: '99999999-9999-4999-8999-999999999901', hotel_id: hotelId, folio_id: folio101, type: 'ROOM', description: 'Room — Deluxe (2 nights × ₹2,000)', amount: 4000, source_order_id: null, created_at: iso(-1, 14) },
      { id: '99999999-9999-4999-8999-999999999902', hotel_id: hotelId, folio_id: folio101, type: 'FOOD', description: '2x Paneer Tikka, 1x Masala Chai', amount: 620, source_order_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01', created_at: iso(0, 9) },
      { id: '99999999-9999-4999-8999-999999999903', hotel_id: hotelId, folio_id: folio102, type: 'ROOM', description: 'Room — Deluxe (2 nights × ₹2,000)', amount: 4000, source_order_id: null, created_at: iso(-10) },
    ],

    payments: [
      { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01', hotel_id: hotelId, folio_id: folio102, amount: 4000, method: 'upi', received_by: 'Grand Plaza Admin', received_at: iso(-8, 11) },
    ],

    guest_sessions: [],

    orders: [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
        hotel_id: hotelId,
        room_id: room101,
        room_number: '101',
        guest_session_id: null,
        guest_uid: null,
        guest_name: 'Priya Sharma',
        guest_phone: '+91 90000 11111',
        type: 'food',
        service_id: null,
        service_name: null,
        items: [
          { id: 'i1', product_id: '55555555-5555-4555-8555-555555555501', name: 'Paneer Tikka', priceAtOrder: 280, price: 280, quantity: 2 },
          { id: 'i2', product_id: '55555555-5555-4555-8555-555555555504', name: 'Masala Chai', priceAtOrder: 60, price: 60, quantity: 1 },
        ],
        total_amount: 620,
        status: 'COMPLETED',
        priority: 'normal',
        assigned_staff_id: null,
        assigned_staff_name: null,
        estimated_delivery_minutes: 25,
        reception_confirmed: true,
        call_confirmed_required: false,
        call_confirmed: false,
        call_guest_logged: false,
        special_notes: '',
        instructions: '',
        status_note: '',
        guest_feedback: { rating: 5, comment: 'Lovely paneer tikka!', submittedAt: iso(0, 9) },
        created_at: iso(0, 8),
        updated_at: iso(0, 9),
        completed_at: iso(0, 9),
      },
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
        hotel_id: hotelId,
        room_id: room101,
        room_number: '101',
        guest_session_id: null,
        guest_uid: null,
        guest_name: 'Priya Sharma',
        guest_phone: '+91 90000 11111',
        type: 'service',
        service_id: '66666666-6666-4666-8666-666666666601',
        service_name: 'Extra Towels',
        items: [{ id: 'i3', product_id: null, name: 'Extra Towels', priceAtOrder: 0, price: 0, quantity: 2 }],
        total_amount: 0,
        status: 'NEW',
        priority: 'normal',
        assigned_staff_id: null,
        assigned_staff_name: null,
        estimated_delivery_minutes: 15,
        reception_confirmed: false,
        call_confirmed_required: false,
        call_confirmed: false,
        call_guest_logged: false,
        special_notes: 'Please bring 4 fresh towels.',
        instructions: '',
        status_note: '',
        guest_feedback: null,
        created_at: iso(0, 9),
        updated_at: iso(0, 9),
        completed_at: null,
      },
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc03',
        hotel_id: hotelId,
        room_id: room102,
        room_number: '102',
        guest_session_id: null,
        guest_uid: null,
        guest_name: 'Arjun Mehta',
        guest_phone: '+91 90000 22222',
        type: 'food',
        service_id: null,
        service_name: null,
        items: [
          { id: 'i4', product_id: '55555555-5555-4555-8555-555555555503', name: 'Dal Makhani', priceAtOrder: 240, price: 240, quantity: 1 },
          { id: 'i5', product_id: '55555555-5555-4555-8555-555555555505', name: 'Fresh Lime Soda', priceAtOrder: 90, price: 90, quantity: 1 },
        ],
        total_amount: 330,
        status: 'COMPLETED',
        priority: 'normal',
        assigned_staff_id: null,
        assigned_staff_name: null,
        estimated_delivery_minutes: 20,
        reception_confirmed: true,
        call_confirmed_required: false,
        call_confirmed: false,
        call_guest_logged: false,
        special_notes: '',
        instructions: '',
        status_note: '',
        guest_feedback: { rating: 4, comment: 'Good food, quick delivery.', submittedAt: iso(-9, 13) },
        created_at: iso(-9, 12),
        updated_at: iso(-9, 13),
        completed_at: iso(-9, 13),
      },
    ],

    food_items: [
      foodItem('55555555-5555-4555-8555-555555555501', 'Paneer Tikka', 'Char-grilled cottage cheese with mint chutney', 280, 'Starters', true, 1, 25),
      foodItem('55555555-5555-4555-8555-555555555502', 'Butter Chicken', 'Creamy tomato chicken curry', 380, 'Main Course', false, 1, 30),
      foodItem('55555555-5555-4555-8555-555555555503', 'Dal Makhani', 'Slow-cooked black lentils', 240, 'Main Course', true, 2, 20),
      foodItem('55555555-5555-4555-8555-555555555504', 'Masala Chai', 'Spiced milk tea', 60, 'Beverages', true, 1, 10),
      foodItem('55555555-5555-4555-8555-555555555505', 'Fresh Lime Soda', 'Sweet or salted lime soda', 90, 'Beverages', true, 2, 5),
    ],

    services: [
      service('66666666-6666-4666-8666-666666666601', 'Extra Towels', 'Fresh bath towels delivered to your room', 0, 1, false, 15),
      service('66666666-6666-4666-8666-666666666602', 'Laundry', 'Same-day wash and fold', 150, 2, true, 120),
      service('66666666-6666-4666-8666-666666666603', 'Room Cleaning', 'On-demand room make-up', 0, 3, false, 30),
      service('66666666-6666-4666-8666-666666666604', 'Wake-up Call', 'Morning alarm call', 0, 4, false, 5),
    ],

    notifications: [
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
        hotel_id: hotelId,
        guest_session_id: null,
        target_role: 'hotel_admin',
        title: 'Welcome to demo mode',
        message: 'NEXORA is running on the local demo backend. Add Supabase credentials to go live.',
        type: 'system',
        is_read: false,
        created_at: iso(0, 8),
      },
    ],

    audit_logs: [],

    // Kept for schema parity; the app does not currently query them.
    food_categories: [],
    service_categories: [],
  };
}

/** Demo auth users — staff only; anonymous guests are created on demand. */
export function buildDemoAuthUsers(): DemoAuthUser[] {
  return [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: DEMO_SUPER_ADMIN_EMAIL,
      password: DEMO_SUPER_ADMIN_PASSWORD,
      is_anonymous: false,
      role: 'authenticated',
      user_metadata: { display_name: 'Nexora Super Admin' },
      app_metadata: { provider: 'email' },
      created_at: iso(-30),
      updated_at: iso(-30),
      confirmed_at: iso(-30),
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: DEMO_HOTEL_ADMIN_EMAIL,
      password: DEMO_HOTEL_ADMIN_PASSWORD,
      is_anonymous: false,
      role: 'authenticated',
      user_metadata: { display_name: 'Grand Plaza Admin', phone: '+91 98765 43210' },
      app_metadata: { provider: 'email' },
      created_at: iso(-30),
      updated_at: iso(-30),
      confirmed_at: iso(-30),
    },
  ];
}
