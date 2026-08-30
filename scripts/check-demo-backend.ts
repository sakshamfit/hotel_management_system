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

  // Cleanup must run as super admin: deleteHotelUser() drops the smoke admin's
  // session, and an anonymous caller is not allowed to delete the hotel row.
  await supabase.auth.signOut();
  const saCleanup = await supabase.auth.signInWithPassword({ email: 'admin@nexora.test', password: 'nexora123' });
  ok(!saCleanup.error, 're-signed in as super admin for cleanup');
  await demoBackend!.deleteHotelUser('admin@smoke.demo');
  const smokeDeleted = await supabase.from('hotels').delete().eq('id', newHotelId);
  ok(!smokeDeleted.error, 'smoke hotel removed');

  // ---- 7. Self-service sign-up + password recovery --------------------------
  console.log('7. Sign-up, sign-in and password recovery');
  await supabase.auth.signOut();

  const OWNER_EMAIL = 'sakshamfitz@gmail.com';
  const missing = await supabase.auth.signInWithPassword({ email: OWNER_EMAIL, password: 'whatever123' });
  ok(!!missing.error && missing.error.code === 'invalid_credentials', 'unknown email is rejected before sign-up');

  const weak = await supabase.auth.signUp({ email: OWNER_EMAIL, password: '123' });
  ok(!!weak.error && weak.error.code === 'weak_password', 'short password rejected on sign-up');

  const badEmail = await supabase.auth.signUp({ email: 'not-an-email', password: 'owner12345' });
  ok(!!badEmail.error && badEmail.error.code === 'invalid_email', 'malformed email rejected on sign-up');

  const signup = await supabase.auth.signUp({
    email: OWNER_EMAIL,
    password: 'owner12345',
    options: { data: { display_name: 'Saksham' } },
  });
  ok(!signup.error && !!signup.data.session, 'self-service sign-up creates a session');
  const ownerUid: string = signup.data.user.id;

  const ownerProfile: any = await supabase
    .from('profiles')
    .select('*')
    .eq('id', ownerUid)
    .maybeSingle();
  ok(ownerProfile.data?.role === 'super_admin', 'signed-up account is provisioned as super_admin');

  const duplicate = await supabase.auth.signUp({ email: OWNER_EMAIL.toUpperCase(), password: 'owner12345' });
  ok(!!duplicate.error && duplicate.error.code === 'user_already_exists', 'duplicate email rejected (case-insensitive)');

  await supabase.auth.signOut();
  const ownerLogin = await supabase.auth.signInWithPassword({ email: OWNER_EMAIL, password: 'owner12345' });
  ok(!ownerLogin.error && !!ownerLogin.data.session, 'signed-up account can sign in');
  ok(ownerLogin.data.user.user_metadata?.display_name === 'Saksham', 'display name stored in user_metadata');
  const ownerHotels: any = await supabase.from('hotels').select('*');
  ok(ownerHotels.data?.length === 1, 'new super admin can read all hotels');
  await supabase.auth.signOut();

  // Forgot password: no mail provider in demo mode, so a reset URL is returned.
  const unknownReset = demoBackend!.startPasswordReset('nobody@nowhere.test');
  ok(unknownReset.emailExists === false && unknownReset.resetUrl === null, 'unknown email gets no reset link');

  const reset = demoBackend!.startPasswordReset(OWNER_EMAIL);
  ok(!!reset.resetToken && !!reset.resetUrl, 'reset link issued for an existing account');
  ok(
    !!reset.resetUrl && reset.resetUrl.includes('type=recovery') && !/[?&]token=/.test(reset.resetUrl),
    'reset URL uses reset_token (never the guest QR `token` param)'
  );

  const wrongToken = demoBackend!.completePasswordReset('not-a-real-token', 'brandnew123');
  ok(wrongToken.success === false, 'bogus reset token rejected');

  const tooShort = demoBackend!.completePasswordReset(reset.resetToken!, 'abc');
  ok(tooShort.success === false, 'short new password rejected');

  const applied = demoBackend!.completePasswordReset(reset.resetToken!, 'brandnew123');
  ok(applied.success === true && applied.email === OWNER_EMAIL, 'password reset applied');

  const replay = demoBackend!.completePasswordReset(reset.resetToken!, 'anotherone1');
  ok(replay.success === false, 'reset token is single-use');

  const oldPassword = await supabase.auth.signInWithPassword({ email: OWNER_EMAIL, password: 'owner12345' });
  ok(!!oldPassword.error, 'old password no longer works');

  const newPassword = await supabase.auth.signInWithPassword({ email: OWNER_EMAIL, password: 'brandnew123' });
  ok(!newPassword.error && !!newPassword.data.session, 'sign-in works with the new password');

  // updateUser() path (used by the real-Supabase recovery screen).
  const pwdUpdate = await supabase.auth.updateUser({ password: 'rotated999' });
  ok(!pwdUpdate.error, 'updateUser changes the password while signed in');
  await supabase.auth.signOut();
  const rotated = await supabase.auth.signInWithPassword({ email: OWNER_EMAIL, password: 'rotated999' });
  ok(!rotated.error, 'sign-in works after updateUser');

  await demoBackend!.deleteHotelUser(OWNER_EMAIL);
  const gone = await supabase.auth.signInWithPassword({ email: OWNER_EMAIL, password: 'rotated999' });
  ok(!!gone.error, 'account removal cleans up the demo store');
  await supabase.auth.signOut();

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
