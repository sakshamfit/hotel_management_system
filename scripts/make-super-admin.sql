-- ============================================================================
-- One-time: promote an existing Supabase Auth user to NEXORA super_admin.
-- ============================================================================
-- Run this in Supabase Dashboard → SQL Editor (or `supabase db execute`).
-- It looks the user up by email in auth.users — no password or service key
-- needed, and it's safe to re-run (idempotent upsert).
--
-- Replace the email below only if it's not the one you signed up with.
-- ============================================================================

insert into public.profiles (id, role, hotel_id, email, display_name)
select
  u.id,
  'super_admin',
  null,
  u.email,
  'Super Admin'
from auth.users u
where lower(u.email) = lower('sakshamfitz@gmail.com')
on conflict (id) do update
  set role = 'super_admin',
      hotel_id = null,
      email = excluded.email;

-- Verify:
select id, role, hotel_id, email, display_name from public.profiles
where lower(email) = lower('sakshamfitz@gmail.com');
