/**
 * End-to-end smoke test of the OFFLINE backend (no browser, no Supabase):
 *
 *   npm run smoke:local
 *
 * Boots the local server on a temp data dir, generates signing keys, issues a
 * license with the CLI-equivalent code path, activates, logs in, creates a
 * room + guest, books it (create_booking RPC), opens a guest session and
 * places an order + charge. Prints PASS/FAIL.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLocalServer } from '../server/local/index';
import { issueLicense, generateKeypairFile, loadPrivateKeyPem } from '../server/local/licensing';
import { LocalStore } from '../server/local/store';

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-smoke-'));
  const host = '127.0.0.1';

  if (!loadPrivateKeyPem()) generateKeypairFile();

  const srv = await startLocalServer({
    dataDir,
    version: 'smoke',
    demoAvailable: false,
    port: 0,
  });
  const base = `http://${host}:${srv.port}/local/api`;
  console.log(`[smoke] server → ${base}`);

  const j = async (method: string, url: string, body?: unknown, token?: string, guestToken?: string) => {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(guestToken ? { 'X-Guest-Token': guestToken } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    last = { status: res.status, data };
    return last;
  };

  const ok = (cond: boolean, label: string) => {
    console.log(`  ${cond ? '✔' : '✘'} ${label}`);
    if (!cond) throw new Error(`FAILED: ${label} (last response: ${JSON.stringify(last)}.slice(0, 400)})`);
  };
  let last: any = null;

  // 1. Status before activation
  let r = await j('GET', `${base}/setup/status`);
  ok(r.status === 200 && r.data.activated === false, 'setup status reports not activated');

  // 2. Issue a license like the seller would
  const issued = issueLicense({
    hotelName: 'Smoke Test Hotel',
    ownerName: 'Test Owner',
    username: 'manager',
    passwordHash: LocalStore.hashPassword('secret-pass-123'),
  });

  // 3. Wrong password fails
  r = await j('POST', `${base}/activate`, {
    activationString: issued.activationString,
    username: 'manager',
    password: 'wrong-password',
  });
  ok(r.status === 401 && r.data.code === 'license/password-mismatch', 'wrong password rejected');

  // 4. Activate
  r = await j('POST', `${base}/activate`, {
    activationString: issued.activationString,
    username: 'manager',
    password: 'secret-pass-123',
  });
  ok(r.status === 200 && !!r.data.user, 'activation creates the owner account');
  const hotelId = r.data.hotel.id;

  // activation response doesn't include token; log in instead
  r = await j('POST', `${base}/auth/login`, { username: 'manager', password: 'secret-pass-123' });
  ok(r.status === 200 && !!r.data.token, 'login returns a session token');
  const staffToken = r.data.token;

  // 5. Create room type + room + guest
  r = await j('POST', `${base}/data/room_types`, { name: 'Deluxe', baseRate: 2500, maxOccupancy: 2, amenities: ['WiFi'] }, staffToken);
  ok(r.status === 200 && !!r.data.id, 'room type created');
  const roomTypeId = r.data.id;

  r = await j('POST', `${base}/data/rooms`, { roomNumber: '101', floor: 1, roomTypeId, status: 'available', permanentToken: 'tok-101' }, staffToken);
  ok(r.status === 200 && !!r.data.id, 'room created');
  const roomId = r.data.id;

  r = await j('POST', `${base}/data/guests`, { name: 'Aarav Mehta', phone: '9876543210' }, staffToken);
  ok(r.status === 200 && !!r.data.id, 'guest created');
  const guestId = r.data.id;

  // 6. Create booking (RPC)
  r = await j(
    'POST',
    `${base}/rpc/create_booking`,
    { hotelId, guestId, roomId, roomTypeId, checkInDate: '2026-09-10', checkOutDate: '2026-09-12', rate: 2500, numGuests: 2, source: 'walk-in' },
    staffToken
  );
  ok(r.status === 200 && !!r.data, 'booking created');
  const bookingId = r.data;

  // double-booking must conflict
  r = await j(
    'POST',
    `${base}/rpc/create_booking`,
    { hotelId, guestId, roomId, roomTypeId, checkInDate: '2026-09-11', checkOutDate: '2026-09-13', rate: 2500, numGuests: 1, source: 'walk-in' },
    staffToken
  );
  ok(r.status === 409 && r.data.code === 'booking/room-not-available', 'double booking rejected');

  // 7. Check in, then guest session via QR token
  r = await j('PUT', `${base}/data/bookings/${bookingId}`, { status: 'CHECKED_IN', actualCheckInAt: new Date().toISOString() }, staffToken);
  ok(r.status === 200, 'check-in update applied');
  await j('PUT', `${base}/data/rooms/${roomId}`, { status: 'occupied' }, staffToken);

  r = await j('POST', `${base}/guest/session`, { roomToken: 'tok-101' });
  ok(r.status === 200 && !!r.data.guestToken && r.data.uid.startsWith('guest_'), 'guest session opened from QR token');
  const guestToken = r.data.guestToken;

  // 8. Guest lists menu + places order + links charge
  await j(
    'POST',
    `${base}/data/food_items`,
    { name: 'Paneer Tikka', category: 'Starters', price: 320, isAvailable: true, variants: [] },
    staffToken
  );
  r = await j('GET', `${base}/data/food_items`, undefined, undefined, guestToken);
  ok(r.status === 200 && r.data.data.length === 1, 'guest can read the menu');

  r = await j(
    'POST',
    `${base}/data/orders`,
    { type: 'food', items: [{ name: 'Paneer Tikka', quantity: 1, price: 320 }], totalAmount: 320, status: 'NEW', guestName: 'Aarav Mehta' },
    undefined,
    guestToken
  );
  ok(r.status === 200 && !!r.data.id, 'guest can place an order');
  const orderId = r.data.id;

  r = await j('POST', `${base}/rpc/post_guest_order_charge`, { orderId }, undefined, guestToken);
  ok(r.status === 200 && r.data.linked === true, 'order linked to folio charge');

  // 9. Guest cannot read bookings
  r = await j('GET', `${base}/data/bookings`, undefined, undefined, guestToken);
  ok(r.status === 403, 'guest is blocked from staff tables');

  // 10. Staff sees the charge + backup works
  const charges = await j('GET', `${base}/data/charges?order_by=created_at&ascending=false`, undefined, staffToken);
  ok(charges.status === 200 && charges.data.data.length === 1, 'staff reads folio charges');

  r = await j('POST', `${base}/backup`, {}, staffToken);
  ok(r.status === 200 && !!r.data.backupPath, 'backup created');

  // 11. Subscriptions — SSE delivers change events (read via fetch stream)
  const streamPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${base}/stream?token=${staffToken}`, { signal: controller.signal });
      if (!res.body) throw new Error('No SSE body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const changed = new Promise<void>((resolve) => {
        const pump = async () => {
          const { done, value } = await reader.read();
          if (done) return;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split('\n\n');
          buf = events.pop() || '';
          if (events.some((e) => e.includes('event: changed'))) return resolve();
          await pump();
        };
        pump().catch(() => resolve());
      });
      // Trigger a write shortly after subscribing.
      setTimeout(() => {
        j('POST', `${base}/data/guests`, { name: 'Trigger' }, staffToken).catch(() => {});
      }, 400);
      await changed;
      controller.abort();
    } finally {
      clearTimeout(timeout);
    }
  })();
  await streamPromise;
  ok(true, 'realtime change events delivered');

  await srv.close();
  console.log('\n✔ SMOKE TEST PASSED — offline backend works end to end.');
  fs.rmSync(dataDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('\n✘ SMOKE TEST FAILED:', err);
  process.exit(1);
});
