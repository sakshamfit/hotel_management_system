-- ============================================================================
-- Seed data — one demo hotel with room types, rooms, menu and services.
-- Only for local development / a fresh start (you chose "fresh" data).
-- Idempotent: safe to re-run. Staff accounts are NOT created here — use the
-- UI super-admin "create hotel" flow or scripts/create-super-admin-supabase.ts.
-- ============================================================================

-- Fixed uuid prefix so ids are readable and stable across re-seeds.
--  11111111-1111-4111-8111-11111111111x
insert into public.hotels (id, hotel_code, name, city, country, currency, currency_symbol, timezone, status, login_email, branding, modules)
values (
  '11111111-1111-4111-8111-111111111110',
  'DEMO-GPH-001',
  'Grand Plaza Demo',
  'Bettiah', 'IN', 'INR', '₹', 'Asia/Kolkata', 'active', 'admin@grandplaza.demo',
  jsonb_build_object(
    'logoUrl', '', 'coverImageUrl', '',
    'primaryColor', '#1e293b', 'secondaryColor', '#0f172a', 'accentColor', '#d97706',
    'welcomeMessage', 'Welcome to Grand Plaza', 'fontFamily', 'Inter'
  ),
  (
    select jsonb_object_agg(k, true) from unnest(array[
      'guestQrSystem','roomService','foodAndBeverage','housekeeping','toiletries',
      'laundry','maintenance','receptionRequests','spaAndWellness','poolAndGym',
      'concierge','guestFeedback','notifications','analytics','dailyReports'
    ]) k
  )
)
on conflict (id) do nothing;

-- Room types
insert into public.room_types (id, hotel_id, name, base_rate, max_occupancy, amenities)
values
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111110', 'Deluxe', 2000, 2, '["WiFi","AC","TV","Hot Water"]'::jsonb),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111110', 'Suite',  4500, 4, '["WiFi","AC","TV","Mini Bar","Bathtub","Lounge"]'::jsonb),
  ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111110', 'Standard', 1200, 2, '["WiFi","Fan","TV"]'::jsonb)
on conflict (id) do nothing;

-- Rooms (permanentToken is the QR secret — replace with real tokens in prod)
insert into public.rooms (id, hotel_id, room_number, floor, room_type_id, type, capacity, status, permanent_token)
values
  ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111110', '101', 1, '22222222-2222-4222-8222-222222222201', 'Deluxe', 2, 'available',   'tok-demo-101'),
  ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111110', '102', 1, '22222222-2222-4222-8222-222222222201', 'Deluxe', 2, 'available',   'tok-demo-102'),
  ('33333333-3333-4333-8333-333333333303', '11111111-1111-4111-8111-111111111110', '201', 2, '22222222-2222-4222-8222-222222222202', 'Suite',  4, 'available',   'tok-demo-201'),
  ('33333333-3333-4333-8333-333333333304', '11111111-1111-4111-8111-111111111110', '202', 2, '22222222-2222-4222-8222-222222222202', 'Suite',  4, 'maintenance', 'tok-demo-202'),
  ('33333333-3333-4333-8333-333333333305', '11111111-1111-4111-8111-111111111110', '103', 1, '22222222-2222-4222-8222-222222222203', 'Standard', 2, 'cleaning',  'tok-demo-103'),
  ('33333333-3333-4333-8333-333333333306', '11111111-1111-4111-8111-111111111110', '104', 1, '22222222-2222-4222-8222-222222222203', 'Standard', 2, 'available', 'tok-demo-104')
on conflict (id) do nothing;

-- Food categories + items
insert into public.food_categories (id, hotel_id, name, display_order)
values
  ('44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111110', 'Starters', 1),
  ('44444444-4444-4444-8444-444444444402', '11111111-1111-4111-8111-111111111110', 'Main Course', 2),
  ('44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111110', 'Beverages', 3)
on conflict (id) do nothing;

insert into public.food_items (id, hotel_id, category_id, name, description, price, is_veg, is_available, display_order)
values
  ('55555555-5555-4555-8555-555555555501', '11111111-1111-4111-8111-111111111110', '44444444-4444-4444-8444-444444444401', 'Paneer Tikka', 'Char-grilled cottage cheese', 280, true, true, 1),
  ('55555555-5555-4555-8555-555555555502', '11111111-1111-4111-8111-111111111110', '44444444-4444-4444-8444-444444444402', 'Butter Chicken', 'Creamy tomato chicken curry', 380, false, true, 1),
  ('55555555-5555-4555-8555-555555555503', '11111111-1111-4111-8111-111111111110', '44444444-4444-4444-8444-444444444402', 'Dal Makhani', 'Slow-cooked black lentils', 240, true, true, 2),
  ('55555555-5555-4555-8555-555555555504', '11111111-1111-4111-8111-111111111110', '44444444-4444-4444-8444-444444444403', 'Masala Chai', 'Spiced milk tea', 60, true, true, 1),
  ('55555555-5555-4555-8555-555555555505', '11111111-1111-4111-8111-111111111110', '44444444-4444-4444-8444-444444444403', 'Fresh Lime Soda', 'Sweet/salted lime soda', 90, true, true, 2)
on conflict (id) do nothing;

-- Services
insert into public.services (id, hotel_id, name, description, price, is_available, requires_approval, display_order)
values
  ('66666666-6666-4666-8666-666666666601', '11111111-1111-4111-8111-111111111110', 'Extra Towels', 'Fresh bath towels', 0, true, false, 1),
  ('66666666-6666-4666-8666-666666666602', '11111111-1111-4111-8111-111111111110', 'Laundry', 'Same-day wash & fold', 150, true, true, 2),
  ('66666666-6666-4666-8666-666666666603', '11111111-1111-4111-8111-111111111110', 'Room Cleaning', 'On-demand room make-up', 0, true, false, 3),
  ('66666666-6666-4666-8666-666666666604', '11111111-1111-4111-8111-111111111110', 'Wake-up Call', 'Morning alarm call', 0, true, false, 4)
on conflict (id) do nothing;
