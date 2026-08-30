-- ============================================================================
-- NEXORA HOTEL OS — settings, department routing, staff PINs, guest feedback
-- ============================================================================
-- Adds only what the app actually uses (no unused scaffolding):
--   • hotels: GST %, operating hours, per-department staff PINs (shared-device
--     tab lock — default '1234', editable from the new Settings tab).
--   • services: a `department` classifier so Housekeeping/Maintenance dispatch
--     can route a request reliably instead of regex-guessing free text.
--   • orders: a denormalized `department` copy (set at order time) so the
--     dispatch queues don't need a live join back to `services`.
--   • RPC `submit_guest_order_feedback`: the ONLY way a guest can attach a
--     rating/comment to their own completed order — guests have no general
--     UPDATE grant on `orders`, so this mirrors the existing
--     `post_guest_order_charge` pattern (SECURITY DEFINER, ownership-checked,
--     one field touched).
-- ============================================================================

alter table public.hotels
  add column if not exists gst_percent numeric not null default 0,
  add column if not exists open_time   text not null default '00:00',
  add column if not exists close_time  text not null default '23:59',
  add column if not exists staff_pins  jsonb not null default
    '{"RECEPTION":"1234","KITCHEN":"1234","HOUSEKEEPING":"1234","MAINTENANCE":"1234"}'::jsonb;

alter table public.services
  add column if not exists department text
    check (department in ('HOUSEKEEPING','WATER_BEVERAGES','AMENITIES','MAINTENANCE','RECEPTION'));

alter table public.orders
  add column if not exists department text;

-- Guest feedback on a completed order. Ownership + status checked inside;
-- only `guest_feedback` is ever written, so a guest can never touch anything
-- else on their order this way (unlike a general "guest update own row" RLS
-- policy would allow).
create or replace function public.submit_guest_order_feedback(
  p_order_id uuid,
  p_rating   int,
  p_comment  text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session guest_sessions;
  v_order   orders;
begin
  v_session := public.active_guest_session();
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not-scoped');
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'reason', 'invalid-rating');
  end if;

  select * into v_order from orders where id = p_order_id and hotel_id = v_session.hotel_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order-not-found');
  end if;
  if v_order.guest_uid <> auth.uid()::text or v_order.room_id <> v_session.room_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if upper(v_order.status) not in ('COMPLETED', 'DELIVERED') then
    return jsonb_build_object('ok', false, 'reason', 'not-completed');
  end if;

  update orders
    set guest_feedback = jsonb_build_object(
          'rating', p_rating,
          'comment', coalesce(left(p_comment, 500), ''),
          'submittedAt', now()
        )
    where id = p_order_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.submit_guest_order_feedback(uuid, int, text) to authenticated;
