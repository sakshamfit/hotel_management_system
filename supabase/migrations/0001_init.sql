-- ============================================================================
-- NEXORA HOTEL OS — Supabase schema (replaces Firestore + firestore.rules)
-- ============================================================================
-- Multi-tenant hotel management. Every tenant-scoped row carries hotel_id.
--
-- Roles:
--   • Staff  : a row in `profiles` with role 'super_admin' (all hotels) or
--              'hotel_admin' (one hotel_id). Authenticates with email/password.
--   • Guests: anonymous Supabase Auth users (is_anonymous). A row in
--             `guest_sessions` scopes them to ONE room after they scan a QR and
--             the server exchanges the room token. RLS evaluates that row —
--             there are no custom claims.
--
-- The Postgres role for BOTH staff and anonymous guests is `authenticated`;
-- staff vs. guest is decided by the helper functions below, never by role.
-- ============================================================================

create extension if not exists pgcrypto;

-- NOTE: the auth-helper functions (is_staff, is_super_admin, staff_hotel_id,
-- staff_can_touch, active_guest_session, is_guest_in_hotel) are defined AFTER
-- the tables — they are LANGUAGE sql, whose bodies are validated at creation
-- time, so the tables they reference must already exist.

-- ===========================================================================
-- TABLES
-- ===========================================================================

-- ---- Users / staff roles (one row per auth.users id) ----------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('super_admin', 'hotel_admin')),
  hotel_id     uuid,
  email        text,
  display_name text,
  phone        text,
  created_at   timestamptz not null default now()
);

-- ---- Hotels (tenants) -----------------------------------------------------
create table public.hotels (
  id              uuid primary key default gen_random_uuid(),
  hotel_code      text,
  name            text not null,
  legal_name      text,
  address         text,
  city            text,
  state           text,
  country         text,
  postal_code     text,
  phone           text,
  email           text,
  owner_name      text,
  owner_phone     text,
  owner_whats_app text,
  currency        text not null default 'INR',
  currency_symbol text not null default '₹',
  timezone        text not null default 'Asia/Kolkata',
  status          text not null default 'active',
  login_email     text,
  branding        jsonb not null default '{}'::jsonb,
  modules         jsonb not null default '{}'::jsonb,
  rooms_count     int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---- Room types (rate + inventory definition) ----------------------------
create table public.room_types (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  name           text not null,
  base_rate      numeric not null default 150,
  max_occupancy  int not null default 2,
  amenities      jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);
create index room_types_hotel_idx on public.room_types(hotel_id);

-- ---- Rooms (physical) -----------------------------------------------------
create table public.rooms (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  room_number     text not null,
  floor           int not null default 0,
  room_type_id    uuid references public.room_types(id),
  type            text,                       -- legacy free-text label
  capacity        int,
  status          text not null default 'available'
                  check (status in ('available','occupied','cleaning','maintenance')),
  permanent_token text not null,              -- QR secret
  photo_url       text,
  created_at      timestamptz not null default now()
);
create index rooms_hotel_idx on public.rooms(hotel_id);
create unique index rooms_permanent_token_idx on public.rooms(permanent_token);
-- One room may hold a given night at most (the double-booking lock lives in
-- room_nights; this backs it with a hard constraint).
create index rooms_token_lookup_idx on public.rooms(permanent_token);

-- ---- Guests (booking contacts; outlive a stay) ----------------------------
create table public.guests (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null references public.hotels(id) on delete cascade,
  name                 text not null,
  phone                text not null default '',
  email                text,
  id_proof_type        text,
  id_proof_number      text,
  migrated_from_room_id text,
  created_at           timestamptz not null default now()
);
create index guests_hotel_idx on public.guests(hotel_id);

-- ---- Bookings (the stay) --------------------------------------------------
create table public.bookings (
  id                 uuid primary key default gen_random_uuid(),
  hotel_id           uuid not null references public.hotels(id) on delete cascade,
  guest_id           uuid not null references public.guests(id) on delete cascade,
  room_id            uuid not null references public.rooms(id) on delete cascade,
  room_type_id       uuid references public.room_types(id),
  check_in_date      date not null,
  check_out_date     date not null,
  actual_check_in_at timestamptz,
  actual_check_out_at timestamptz,
  status             text not null default 'RESERVED'
                     check (status in ('RESERVED','CHECKED_IN','CHECKED_OUT','CANCELLED','NO_SHOW')),
  agreed_rate        numeric not null default 0,
  num_guests         int not null default 1,
  source             text not null default 'walk-in',
  created_by         text,
  created_at         timestamptz not null default now()
);
create index bookings_hotel_idx on public.bookings(hotel_id);
create index bookings_room_idx on public.bookings(room_id);

-- ---- Room nights (THE availability lock) ----------------------------------
create table public.room_nights (
  hotel_id   uuid not null references public.hotels(id) on delete cascade,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  date       date not null,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  primary key (room_id, date)
);
create index room_nights_date_idx on public.room_nights(date);
create index room_nights_booking_idx on public.room_nights(booking_id);

-- ---- Folios (one per booking, same id) ------------------------------------
create table public.folios (
  id         uuid primary key,                       -- == bookings.id
  hotel_id   uuid not null references public.hotels(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  status     text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  balance    numeric not null default 0
);
create index folios_hotel_idx on public.folios(hotel_id);

create table public.charges (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  folio_id        uuid not null references public.folios(id) on delete cascade,
  type            text not null check (type in ('ROOM','FOOD','SERVICE','TAX','DISCOUNT')),
  description     text not null default '',
  amount          numeric not null default 0,
  source_order_id uuid,
  created_at      timestamptz not null default now()
);
create index charges_folio_idx on public.charges(folio_id);
create unique index charges_source_order_idx on public.charges(source_order_id) where source_order_id is not null;

create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  folio_id    uuid not null references public.folios(id) on delete cascade,
  amount      numeric not null,
  method      text not null check (method in ('cash','card','upi')),
  received_by text,
  received_at timestamptz not null default now()
);

-- ---- Guest sessions (anonymous QR-scoped access) --------------------------
create table public.guest_sessions (
  id          uuid primary key references auth.users(id) on delete cascade,
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  room_number text not null default '',
  guest_name  text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index guest_sessions_room_idx on public.guest_sessions(room_id);

-- ---- Orders / service requests --------------------------------------------
create table public.orders (
  id                        uuid primary key default gen_random_uuid(),
  hotel_id                  uuid not null references public.hotels(id) on delete cascade,
  room_id                   uuid,
  room_number               text,
  guest_session_id          uuid,
  guest_uid                 text,                       -- anon auth uid
  guest_name                text not null default '',
  guest_phone               text,
  type                      text not null default 'food',
  service_id                text,
  service_name              text,
  items                     jsonb not null default '[]'::jsonb,
  total_amount              numeric not null default 0,
  status                    text not null default 'NEW',
  priority                  text,
  assigned_staff_id         text,
  assigned_staff_name       text,
  estimated_delivery_minutes int,
  reception_confirmed       boolean not null default false,
  call_confirmed_required   boolean not null default false,
  call_confirmed            boolean not null default false,
  call_guest_logged         boolean not null default false,
  special_notes             text,
  instructions              text,
  status_note               text,
  guest_feedback            jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  completed_at              timestamptz
);
create index orders_hotel_created_idx on public.orders(hotel_id, created_at desc);
create index orders_guest_uid_idx on public.orders(guest_uid);

-- ---- Menu -----------------------------------------------------------------
create table public.food_categories (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  name          text not null,
  display_order int not null default 0
);

create table public.food_items (
  id                     uuid primary key default gen_random_uuid(),
  hotel_id               uuid not null references public.hotels(id) on delete cascade,
  category_id            uuid,
  category               text,
  name                   text not null,
  description            text,
  image_url              text,
  dietary                text,
  is_vegetarian          boolean,
  is_veg                 boolean,
  base_price             numeric,
  price                  numeric,
  variants               jsonb not null default '[]'::jsonb,
  is_available           boolean not null default true,
  prep_time_minutes      int,
  preparation_time_minutes int,
  display_order          int not null default 0,
  created_at             timestamptz not null default now()
);
create index food_items_hotel_idx on public.food_items(hotel_id);

create table public.service_categories (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  name          text not null,
  icon          text,
  display_order int not null default 0
);

create table public.services (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null references public.hotels(id) on delete cascade,
  category_id          uuid,
  name                 text not null,
  description          text,
  price                numeric not null default 0,
  icon                 text,
  estimated_time_minutes int,
  sla_minutes          int,
  is_available         boolean not null default true,
  requires_approval    boolean not null default false,
  requires_notes       boolean not null default false,
  display_order        int not null default 0,
  created_at           timestamptz not null default now()
);
create index services_hotel_idx on public.services(hotel_id);

-- ---- Notifications & audit ------------------------------------------------
create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  hotel_id         uuid not null references public.hotels(id) on delete cascade,
  guest_session_id uuid,
  target_role      text,
  title            text not null,
  message          text not null default '',
  type             text,
  is_read          boolean not null default false,
  created_at       timestamptz not null default now()
);
create index notifications_hotel_idx on public.notifications(hotel_id);

create table public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid,
  user_id    text,
  user_name  text,
  user_role  text,
  action     text not null,
  details    jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Auth helper functions (SECURITY DEFINER so they read profiles/sessions
-- regardless of the caller's RLS). Defined here — after every table exists —
-- because LANGUAGE sql bodies are validated at creation time.
-- ---------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('super_admin', 'hotel_admin')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'super_admin'
  );
$$;

-- The hotel_id of a hotel_admin, or NULL for super_admin (=> all hotels).
create or replace function public.staff_hotel_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select p.hotel_id from public.profiles p
  where p.id = auth.uid() and p.role = 'hotel_admin';
$$;

-- True when a staff member may touch a row belonging to hotel `h`
-- (super_admin may touch every hotel).
create or replace function public.staff_can_touch(h uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and (
    public.is_super_admin() or h = public.staff_hotel_id()
  );
$$;

-- ---- Guest auth helpers (declared after guest_sessions exists) -------------
create or replace function public.active_guest_session()
returns public.guest_sessions
language sql stable security definer set search_path = public as $$
  select gs.* from public.guest_sessions gs
  where gs.id = auth.uid() and gs.active = true
  limit 1;
$$;

create or replace function public.is_guest_in_hotel(h uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.guest_sessions gs
    where gs.id = auth.uid() and gs.active = true and gs.hotel_id = h
  );
$$;

-- ---- updated_at maintenance ------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger hotels_touch before update on public.hotels
  for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- ROW LEVEL SECURITY
-- ===========================================================================

alter table public.profiles         enable row level security;
alter table public.hotels           enable row level security;
alter table public.room_types       enable row level security;
alter table public.rooms            enable row level security;
alter table public.guests           enable row level security;
alter table public.bookings         enable row level security;
alter table public.room_nights      enable row level security;
alter table public.folios           enable row level security;
alter table public.charges          enable row level security;
alter table public.payments         enable row level security;
alter table public.guest_sessions   enable row level security;
alter table public.orders           enable row level security;
alter table public.food_categories  enable row level security;
alter table public.food_items       enable row level security;
alter table public.service_categories enable row level security;
alter table public.services         enable row level security;
alter table public.notifications    enable row level security;
alter table public.audit_logs       enable row level security;

-- ---- profiles -------------------------------------------------------------
create policy "profiles: read self or staff" on public.profiles
  for select to authenticated
  using (id = auth.uid() or is_staff());
-- Writes go through the server (service role), which bypasses RLS.

-- ---- hotels ---------------------------------------------------------------
create policy "hotels: staff read" on public.hotels
  for select to authenticated
  using (staff_can_touch(id) or is_guest_in_hotel(id));
create policy "hotels: staff write" on public.hotels
  for all to authenticated
  using (staff_can_touch(id))
  with check (staff_can_touch(id));

-- ---- Generic tenant tables: staff full access scoped to their hotel -------
-- room_types, rooms, guests, bookings, room_nights, folios, charges, payments,
-- notifications, audit_logs, food_categories, service_categories.
do $$
declare t text;
begin
  foreach t in array array[
    'room_types','guests','bookings','room_nights','folios','charges','payments',
    'notifications','audit_logs','food_categories','service_categories'
  ]
  loop
    execute format('
      create policy "%1$s: staff read" on public.%1$s
        for select to authenticated using (staff_can_touch(hotel_id));
      create policy "%1$s: staff write" on public.%1$s
        for all to authenticated
        using (staff_can_touch(hotel_id))
        with check (staff_can_touch(hotel_id));
    ', t);
  end loop;
end $$;

-- ---- rooms: staff + the one guest scoped to that room ---------------------
create policy "rooms: staff read" on public.rooms
  for select to authenticated
  using (
    staff_can_touch(hotel_id)
    or exists (select 1 from public.guest_sessions gs
               where gs.id = auth.uid() and gs.active and gs.room_id = rooms.id)
  );
create policy "rooms: staff write" on public.rooms
  for all to authenticated
  using (staff_can_touch(hotel_id))
  with check (staff_can_touch(hotel_id));

-- ---- menu / services: staff write, staff + in-hotel guests read -----------
do $$
declare t text;
begin
  foreach t in array array['food_items','services']
  loop
    execute format('
      create policy "%1$s: read" on public.%1$s
        for select to authenticated
        using (staff_can_touch(hotel_id) or is_guest_in_hotel(hotel_id));
      create policy "%1$s: staff write" on public.%1$s
        for all to authenticated
        using (staff_can_touch(hotel_id))
        with check (staff_can_touch(hotel_id));
    ', t);
  end loop;
end $$;

-- ---- guest_sessions: a user sees only their own session -------------------
create policy "guest_sessions: read own" on public.guest_sessions
  for select to authenticated
  using (id = auth.uid());
-- Insert/update is done by the server with the service-role key (bypasses RLS).

-- ---- orders: staff full access; guests read/create their own --------------
create policy "orders: staff read" on public.orders
  for select to authenticated
  using (staff_can_touch(hotel_id));
create policy "orders: guest read own" on public.orders
  for select to authenticated
  using (guest_uid = auth.uid()::text);
create policy "orders: staff write" on public.orders
  for all to authenticated
  using (staff_can_touch(hotel_id))
  with check (staff_can_touch(hotel_id));
create policy "orders: guest create" on public.orders
  for insert to authenticated
  with check (
    guest_uid = auth.uid()::text
    and exists (
      select 1 from public.guest_sessions gs
      where gs.id = auth.uid() and gs.active
        and gs.hotel_id = orders.hotel_id
        and (orders.room_id is null or gs.room_id = orders.room_id)
    )
  );

-- ===========================================================================
-- RPC: atomic booking (double-booking safe) + guest folio charge
-- ===========================================================================

-- Staff-only. Validates the stay, rejects if any night is taken, then writes
-- the booking + room_nights + folio in one transaction. Returns booking id.
create or replace function public.create_booking(
  p_hotel_id      uuid,
  p_guest_id      uuid,
  p_room_id       uuid,
  p_room_type_id  uuid,
  p_check_in      date,
  p_check_out     date,
  p_rate          numeric,
  p_num_guests    int,
  p_source        text,
  p_created_by    text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_booking_id uuid;
  v_night date;
begin
  if not is_staff() then
    raise exception 'booking/forbidden' using errcode = '42501';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'booking/invalid-stay' using errcode = '23514';
  end if;
  if p_rate < 0 then
    raise exception 'booking/invalid-rate' using errcode = '23514';
  end if;

  if exists (
    select 1 from room_nights rn
    where rn.room_id = p_room_id and rn.date >= p_check_in and rn.date < p_check_out
  ) then
    raise exception 'booking/room-not-available' using errcode = '23P01';
  end if;

  insert into bookings (
    hotel_id, guest_id, room_id, room_type_id, check_in_date, check_out_date,
    actual_check_in_at, actual_check_out_at, status, agreed_rate, num_guests,
    source, created_by
  ) values (
    p_hotel_id, p_guest_id, p_room_id, p_room_type_id, p_check_in, p_check_out,
    null, null, 'RESERVED', p_rate, coalesce(p_num_guests, 1),
    coalesce(p_source, 'walk-in'), coalesce(p_created_by, auth.uid()::text)
  ) returning id into v_booking_id;

  for v_night in
    select generate_series(p_check_in, p_check_out - interval '1 day', interval '1 day')::date
  loop
    insert into room_nights (hotel_id, room_id, date, booking_id)
    values (p_hotel_id, p_room_id, v_night, v_booking_id);
  end loop;

  insert into folios (id, hotel_id, booking_id, status, balance)
  values (v_booking_id, p_hotel_id, v_booking_id, 'OPEN', 0);

  return v_booking_id;
end;
$$;

-- Guest-only. Called (through the Express server) after a guest places an
-- order. Verifies the caller owns the order and is scoped to its room, finds
-- the active CHECKED_IN booking, and idempotently posts a FOOD/SERVICE charge
-- and increments the folio balance. Returns a small JSON status.
create or replace function public.post_guest_order_charge(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session guest_sessions;
  v_order   orders;
  v_booking bookings;
  v_charge_id uuid;
  v_amount numeric;
  v_desc text;
  v_type text;
begin
  v_session := public.active_guest_session();
  if v_session.id is null then
    return jsonb_build_object('linked', false, 'reason', 'not-scoped');
  end if;

  select * into v_order from orders where id = p_order_id and hotel_id = v_session.hotel_id;
  if not found then
    return jsonb_build_object('linked', false, 'reason', 'order-not-found');
  end if;
  if v_order.guest_uid <> auth.uid()::text or v_order.room_id <> v_session.room_id then
    return jsonb_build_object('linked', false, 'reason', 'forbidden');
  end if;

  v_amount := coalesce(v_order.total_amount, 0);
  if v_amount <= 0 then
    return jsonb_build_object('linked', false, 'reason', 'zero-amount');
  end if;

  -- Idempotent: one charge per source order.
  if exists (select 1 from charges c where c.source_order_id = p_order_id) then
    return jsonb_build_object('linked', true, 'reason', 'already-linked');
  end if;

  select * into v_booking from bookings b
  where b.room_id = v_session.room_id and b.status = 'CHECKED_IN'
  order by b.check_in_date desc limit 1;
  if not found then
    return jsonb_build_object('linked', false, 'reason', 'no-active-booking');
  end if;

  v_type := case when v_order.type = 'service' then 'SERVICE' else 'FOOD' end;
  v_desc := case
    when jsonb_array_length(coalesce(v_order.items, '[]'::jsonb)) > 0
      then (
        select left(string_agg(
                 coalesce((it->>'quantity'), '1') || 'x ' || coalesce(it->>'name', 'Item'),
                 ', '
               ), 200)
        from jsonb_array_elements(v_order.items) it
      )
    when v_order.type = 'service' then 'Room service request'
    else 'In-room dining order'
  end;

  insert into charges (hotel_id, folio_id, type, description, amount, source_order_id)
  values (v_session.hotel_id, v_booking.id, v_type, v_desc, v_amount, p_order_id)
  returning id into v_charge_id;

  insert into folios (id, hotel_id, booking_id, status, balance)
  values (v_booking.id, v_session.hotel_id, v_booking.id, 'OPEN', v_amount)
  on conflict (id) do update set balance = folios.balance + excluded.balance;

  return jsonb_build_object('linked', true, 'chargeId', v_charge_id);
end;
$$;

-- ===========================================================================
-- REALTIME — expose change events to authenticated clients
-- ===========================================================================
-- The publication always exists in Supabase; add each table only if it isn't a
-- member yet so the migration is idempotent / safe to re-run.
do $$
declare t text;
begin
  foreach t in array array[
    'hotels','room_types','rooms','guests','bookings','room_nights','folios',
    'charges','orders','food_items','services','notifications','food_categories',
    'service_categories'
  ]
  loop
    execute format('alter table public.%1$s replica identity full;', t);
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%1$s;', t);
    end if;
  end loop;
end $$;

-- ===========================================================================
-- STORAGE BUCKET for images (room photos, menu images). Public read so the
-- app can use plain URLs; writes restricted to staff (policy in next migration
-- / dashboard). Object paths mirror the old Firebase layout:
--   hotels/{hotelId}/rooms/{roomId}.jpg , hotels/{hotelId}/menu/{itemId}.jpg
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('hotel-media', 'hotel-media', true)
on conflict (id) do nothing;

create policy "media: public read" on storage.objects
  for select using (bucket_id = 'hotel-media');
create policy "media: staff write" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'hotel-media' and public.is_staff()
  );
create policy "media: staff update/delete" on storage.objects
  for update to authenticated using (
    bucket_id = 'hotel-media' and public.is_staff()
  );
create policy "media: staff delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'hotel-media' and public.is_staff()
  );
