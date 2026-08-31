-- ============================================================================
-- NEXORA HOTEL OS — purge the legacy "Grand Plaza Demo" tenant
-- ============================================================================
-- The demo hotel was previously shipped via supabase/seed.sql (now removed).
-- This migration cleans up any database that was seeded with it, so a fresh
-- production/development database contains ONLY real hotels. It is safe to
-- re-run: when no demo rows exist it deletes nothing.
--
-- What it removes:
--   • the demo hotel itself (ON DELETE CASCADE wipes its room types, rooms,
--     guests, bookings, room_nights, folios, charges, payments, orders,
--     menu, services, notifications and guest sessions),
--   • profiles scoped to the demo hotel (the demo admin login can no longer
--     sign in),
--   • audit rows referencing the demo hotel,
--   • any media uploaded under hotels/<demo-id>/ (Storage),
--   • the legacy demo auth account admin@grandplaza.demo (best effort —
--     auth.* privileges differ by environment).
-- ============================================================================

-- ---- 1. Capture + remove profiles tied to the demo hotel -------------------
delete from public.profiles p
where p.hotel_id in (
  select id from public.hotels
  where hotel_code = 'DEMO-GPH-001'
     or lower(coalesce(login_email, '')) = 'admin@grandplaza.demo'
     or name = 'Grand Plaza Demo'
);

-- ---- 2. Audit rows referencing the demo hotel ------------------------------
delete from public.audit_logs a
where a.hotel_id in (
  select id from public.hotels
  where hotel_code = 'DEMO-GPH-001'
     or lower(coalesce(login_email, '')) = 'admin@grandplaza.demo'
     or name = 'Grand Plaza Demo'
);

-- ---- 3. Storage objects for the demo hotel -------------------------------
delete from storage.objects
where bucket_id = 'hotel-media'
  and name like 'hotels/11111111-1111-4111-8111-111111111110/%';

-- ---- 4. The demo hotel (cascades to every tenant-scoped row) ---------------
delete from public.hotels h
where h.hotel_code = 'DEMO-GPH-001'
   or lower(coalesce(h.login_email, '')) = 'admin@grandplaza.demo'
   or h.name = 'Grand Plaza Demo';

-- ---- 5. Legacy demo auth account (best effort) ------------------------------
-- Deleting from auth.* requires the schema/role privileges; never let a
-- permission difference fail the migration — the hotel + profile cleanup
-- above already disables the demo login.
do $$
begin
  delete from auth.users u
  where lower(coalesce(u.email, '')) = 'admin@grandplaza.demo';
exception when others then
  raise notice 'Demo auth user cleanup skipped (auth schema not writable from this migration): %', sqlerrm;
end $$;

-- Verify no demo rows remain (will simply return 0 rows when absent).
select 'hotels' as entity, count(*) from public.hotels
  where hotel_code = 'DEMO-GPH-001'
     or lower(coalesce(login_email, '')) = 'admin@grandplaza.demo'
     or name = 'Grand Plaza Demo';
