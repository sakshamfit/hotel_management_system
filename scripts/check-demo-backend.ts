/**
 * Smoke test for the local demo backend (src/supabase/localBackend.ts).
 *
 * Exercises the same query/auth/realtime surface the UI uses:
 * staff login, tenant scoping, insert/update/delete, create_booking RPC,
 * anonymous guest session, guest order + folio charge, admin user creation.
 *
 * Run: npm run check:demo
 */

import { localSupabase, demoBackend } from '../src/supabase/localBackend';

let failures = 0;

function ok(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`);
  }
}

async function main() {
  const supabase = localSupabase as any;

  // ---- 1. Super admin login ---------------------------------------------
  console.log('1. Super admin login + hotel read');
  const login = await supabase.auth.signInWithPassword({
    email: 'admin@nexora.test',
    password: 'nexora123',
  });
  ok(!login.error && login.data.session, 'super admin sign in');
  const adminUid: string = login.data.user.id;

  const hotels: any = await supabase.from('hotels').select('*').order('created_at', { ascending: false });
  ok(!hotels.error && hotels.data?.length === 1, 'super admin sees all hotels');
  const hotelId = hotels.data[0].id;

  const profile: any = await supabase.from('profiles').select('*').eq('id', adminUid).maybeSingle();
  ok(profile.data?.role === 'super_admin', 'profile role resolved');

  // ---- 2. CRUD ------------------------------------------------------------
  console.log('2. Insert / update / delete');
  const inserted: any = await supabase
    .from('food_items')
    .insert({ hotel_id: hotelId, name: 'Smoke Test Item', price: 99, is_available: true })
    .select('id')
    .single();
  ok(!inserted.error && !!inserted.data?.id, 'insert with select().single()');

  const updated: any = await supabase.from('food_items').update({ price: 125 }).eq('id', inserted.data.id);
  ok(!updated.error, 'update by id');

  const readBack: any = await supabase.from('food_items').select('*').eq('id', inserted.data.id).maybeSingle();
  ok(readBack.data?.price === 125, 'updated row readable');

  const deleted: any = await supabase.from('food_items').delete().eq('id', inserted.data.id);
  const afterDelete: any = await supabase.from('food_items').select('*').eq('id', inserted.data.id).maybeSingle();
  ok(!deleted.error && afterDelete.data === null, 'delete by id');

  // ---- 3. create_booking RPC ---------------------------------------------
  console.log('3. create_booking RPC (availability + folio)');
  const guest: any = await supabase.from('guests').select('*').order('name', { ascending: true }).limit(1);
  const guestRow = guest.data[0];
  const rooms: any = await supabase.from('rooms').select('*').eq('hotel_id', hotelId);
  const room102 = rooms.data.find((r: any) => r.room_number === '102');
  const roomType = await supabase
    .from('room_types')
    .select('*')
    .eq('id', room102.room_type_id)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const inTwo = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const booking: any = await supabase.rpc('create_booking', {
    p_hotel_id: hotelId,
    p_guest_id: guestRow.id,
    p_room_id: room102.id,
    p_room_type_id: roomType.data.id,
    p_check_in: today,
    p_check_out: inTwo,
    p_rate: 2000,
    p_num_guests: 2,
    p_source: 'walk-in',
    p_created_by: adminUid,
  });
  ok(!booking.error && typeof booking.data === 'string', 'booking created');
  const nights: any = await supabase.from('room_nights').select('*').eq('booking_id', booking.data);
  ok(nights.data?.length === 2, 'room_nights locks created');
  const folio: any = await supabase.from('folios').select('*').eq('id', booking.data).maybeSingle();
  ok(folio.data?.status === 'OPEN' && folio.data?.balance === 0, 'folio created');

  const clash: any = await supabase.rpc('create_booking', {
    p_hotel_id: hotelId,
    p_guest_id: guestRow.id,
    p_room_id: room102.id,
    p_room_type_id: roomType.data.id,
    p_check_in: today,
    p_check_out: inTwo,
    p_rate: 2000,
    p_num_guests: 1,
    p_source: 'walk-in',
    p_created_by: adminUid,
  });
  ok(!!clash.error && clash.error.message.includes('booking/room-not-available'), 'double booking rejected');

  // ---- 4. Realtime channel -----------------------------------------------
  console.log('4. Realtime channel');
  let fired = false;
  supabase
    .channel('rt:smoke')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'services' }, () => {
      fired = true;
    })
    .subscribe();
  await supabase.from('services').insert({ hotel_id: hotelId, name: 'Smoke Service', price: 0, is_available: true });
  await new Promise((r) => setTimeout(r, 50));
  ok(fired, 'change event emitted on insert');
  const svc = await supabase.from('services').select('*').eq('name', 'Smoke Service').maybeSingle();
  await supabase.from('services').delete().eq('id', svc.data.id);

  // ---- 5. Guest session (anonymous + QR token) ----------------------------
  console.log('5. Guest session + scoping + folio charge');
  await supabase.auth.signOut();
  const anon: any = await supabase.auth.signInAnonymously();
  ok(!anon.error && anon.data.session, 'anonymous sign in');
  const guestUid = anon.data.user.id;

  const claims = demoBackend!.openGuestSession('tok-demo-101', guestUid);
  ok(claims?.hotelId === hotelId && claims?.roomId, 'room token exchanged to claims');

  const guestRoom: any = await supabase.from('rooms').select('*').eq('id', claims!.roomId).maybeSingle();
  ok(guestRoom.data?.room_number === '101', 'guest sees only their room');
  const guestBookings: any = await supabase.from('bookings').select('*');
  ok(guestBookings.data?.length === 0, 'guest cannot read bookings');
  const menu: any = await supabase.from('food_items').select('*');
  ok(menu.data?.length > 0, 'guest sees hotel menu');

  const order: any = await supabase
    .from('orders')
    .insert({
      hotel_id: hotelId,
      room_id: claims!.roomId,
      room_number: '101',
      guest_uid: guestUid,
      guest_name: 'Priya Sharma',
      type: 'food',
      items: [{ name: 'Paneer Tikka', quantity: 1, priceAtOrder: 280 }],
      total_amount: 280,
      status: 'NEW',
    })
    .select('id')
    .single();
  ok(!order.error && !!order.data?.id, 'guest can create their own order');

  const forbidden: any = await supabase
    .from('orders')
    .insert({
      hotel_id: hotelId,
      room_id: claims!.roomId,
      room_number: '101',
      guest_uid: 'someone-else',
      guest_name: 'Nope',
      type: 'food',
      items: [],
      total_amount: 1,
      status: 'NEW',
    })
    .select('id')
    .single();
  ok(!!forbidden.error, 'guest cannot create another user\u2019s order (RLS)');

  const charge = await demoBackend!.postGuestOrderCharge(order.data.id);
  ok(charge.linked === true, 'order charged to folio');

  // Folios/charges are staff-only (RLS) — verify as the hotel admin.
  await supabase.auth.signOut();
  const staffLogin = await supabase.auth.signInWithPassword({
    email: 'admin@grandplaza.demo',
    password: 'nexora123',
  });
  ok(!staffLogin.error, 'hotel admin re-signed in');
  const charges: any = await supabase.from('charges').select('*').eq('source_order_id', order.data.id).maybeSingle();
  ok(charges.data?.amount === 280, 'charge row exists (staff view)');
  const activeFolio: any = await supabase
    .from('folios')
    .select('*')
    .eq('id', '88888888-8888-4888-8888-888888888801')
    .maybeSingle();
  ok(activeFolio.data?.balance === 4900, 'folio balance updated');
  await supabase.auth.signOut();

  // ---- 6. Hotel admin creation/delete -------------------------------------
  console.log('6. Demo hotel admin user creation');
  await supabase.auth.signOut();
  const sa = await supabase.auth.signInWithPassword({ email: 'admin@nexora.test', password: 'nexora123' });
  ok(!sa.error, 're-signed in as super admin');

  const newHotelId = crypto.randomUUID();
  await supabase.from('hotels').insert({
    id: newHotelId,
    name: 'Smoke Hotel',
    hotel_code: 'SMK-001',
    currency: 'INR',
    currency_symbol: '₹',
    timezone: 'Asia/Kolkata',
    status: 'active',
    branding: {},
    modules: {},
  });
  const created = await demoBackend!.createHotelUser({
    hotelId: newHotelId,
    hotelName: 'Smoke Hotel',
    email: 'admin@smoke.demo',
    password: 'smoke123',
    name: 'Smoke Admin',
  });
  ok(created.success && created.role === 'hotel_admin', 'hotel admin user created');

  await supabase.auth.signOut();
  const ha = await supabase.auth.signInWithPassword({ email: 'admin@smoke.demo', password: 'smoke123' });
  ok(!ha.error, 'hotel admin can sign in');
  const scopedHotels: any = await supabase.from('hotels').select('*');
  ok(scopedHotels.data?.length === 1 && scopedHotels.data[0].id === newHotelId, 'hotel admin only sees own hotel');

  const ho = await supabase.from('hotels').select('*').eq('id', hotelId).maybeSingle();
  ok(ho.data === null, 'hotel admin cannot read another hotel');

  await demoBackend!.deleteHotelUser('admin@smoke.demo');
  await supabase.from('hotels').delete().eq('id', newHotelId);

  console.log('');
  if (failures === 0) {
    console.log('ALL DEMO BACKEND CHECKS PASSED');
  } else {
    console.error(`${failures} CHECK(S) FAILED`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exitCode = 1;
});
