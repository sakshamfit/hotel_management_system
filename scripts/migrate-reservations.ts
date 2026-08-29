#!/usr/bin/env tsx
/**
 * ONE-TIME MIGRATION — rooms → room types + bookings
 * ==================================================
 *
 * Prepares existing hotels for the reservation engine:
 *
 *   1. Infer a `roomTypes` collection from current room data
 *      (grouped by the legacy free-text `type` field), or create one default
 *      type per hotel when there is nothing to infer from.
 *   2. Stamp `roomTypeId` onto every room.
 *   3. Normalise `room.status` casing ('VACANT'→'available',
 *      'OCCUPIED'→'occupied').
 *   4. Move stay data OFF the room document: for every currently-occupied room,
 *      create a `guests` doc, a `bookings` doc (CHECKED_IN), its `roomNights`
 *      locks, and an OPEN `folios` doc.
 *   5. Delete the guest fields from the room doc.
 *
 * Dry-run by default. Re-run with --apply to write.
 *
 * Usage
 * -----
 *   npm run migrate:reservations              # dry run, prints a plan
 *   npm run migrate:reservations -- --apply   # perform the migration
 *   npm run migrate:reservations -- --apply --hotel hotel_abc_123
 *
 * Prerequisites
 * -------------
 *   export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/sa.json
 *   # or: gcloud auth application-default login
 */

import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const hotelArgIndex = argv.indexOf('--hotel');
const ONLY_HOTEL = hotelArgIndex !== -1 ? argv[hotelArgIndex + 1] : undefined;

// ---------------------------------------------------------------------------
// Firebase Admin init
// ---------------------------------------------------------------------------

const appletConfig = JSON.parse(readFileSync(resolve(repoRoot, 'firebase-applet-config.json'), 'utf8'));
const projectId = process.env.FIREBASE_PROJECT_ID || appletConfig.projectId;

function initAdmin() {
  if (getApps().length) return getApps()[0]!;
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (saPath) {
    const sa = JSON.parse(readFileSync(saPath, 'utf8'));
    return initializeApp({ credential: cert(sa), projectId: sa.project_id || projectId });
  }
  return initializeApp({ credential: applicationDefault(), projectId });
}

const app = initAdmin();
const db = getFirestore(app, appletConfig.firestoreDatabaseId || '(default)');

function credentialsHint() {
  console.error('\n✗ Firebase Admin credentials not found.');
  console.error('  export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/to/service-account.json');
  console.error('  or run: gcloud auth application-default login\n');
  process.exit(1);
}

process.on('unhandledRejection', (err: any) => {
  const message = String(err?.message || '');
  if (message.includes('credentials') || message.includes('Could not load')) {
    credentialsHint();
  }
  console.error('\n✗ Unhandled error:', err?.message || err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Guest fields being removed from the room document (they move to Booking/Guest). */
const ROOM_GUEST_FIELDS = [
  'guestName',
  'guestPhone',
  'guestEmail',
  'checkedInAt',
  'expectedCheckout',
  'lastCheckedOutAt',
  'activeGuestSessionId',
] as const;

const STATUS_MAP: Record<string, string> = {
  available: 'available',
  vacant: 'available',
  VACANT: 'available',
  occupied: 'occupied',
  OCCUPIED: 'occupied',
  cleaning: 'cleaning',
  maintenance: 'maintenance',
};

const DEFAULT_RATE = 150;
const DEFAULT_OCCUPANCY = 2;

// ---------------------------------------------------------------------------
// Date helpers (UTC on date-only strings — mirrors src/utils/dates.ts)
// ---------------------------------------------------------------------------

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

function utcMs(dateOnly: string): number {
  return Date.parse(`${dateOnly}T00:00:00Z`);
}

function addDays(dateOnly: string, days: number): string {
  return new Date(utcMs(dateOnly) + days * 86_400_000).toISOString().slice(0, 10);
}

function enumerateNights(checkIn: string, checkOut: string): string[] {
  const nights: string[] = [];
  let cursor = utcMs(checkIn);
  const end = utcMs(checkOut);
  while (cursor < end) {
    nights.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return nights;
}

function dateOnlyFrom(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  // Accepts "2026-09-01", a full ISO timestamp, or a Firestore Timestamp.
  const asString = (value as unknown as { toDate?: () => Date })?.toDate
    ? (value as unknown as { toDate: () => Date }).toDate().toISOString()
    : value;
  const match = String(asString).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(match) ? match : fallback;
}

function today(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'standard';
}

function median(values: number[]): number {
  if (values.length === 0) return DEFAULT_RATE;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

interface MigrationStats {
  hotels: number;
  roomTypesCreated: number;
  roomsUpdated: number;
  guestsCreated: number;
  bookingsCreated: number;
  roomNightsCreated: number;
  foliosCreated: number;
  skipped: string[];
}

const stats: MigrationStats = {
  hotels: 0,
  roomTypesCreated: 0,
  roomsUpdated: 0,
  guestsCreated: 0,
  bookingsCreated: 0,
  roomNightsCreated: 0,
  foliosCreated: 0,
  skipped: [],
};

async function migrateHotel(hotelId: string, hotelName: string) {
  const hotelRef = db.collection('hotels').doc(hotelId);
  const roomsRef = hotelRef.collection('rooms');
  const roomTypesRef = hotelRef.collection('roomTypes');
  const guestsRef = hotelRef.collection('guests');
  const bookingsRef = hotelRef.collection('bookings');
  const nightsRef = hotelRef.collection('roomNights');
  const foliosRef = hotelRef.collection('folios');

  const roomSnap = await roomsRef.get();
  const existingTypes = await roomTypesRef.get();

  if (roomSnap.empty) {
    stats.skipped.push(`${hotelId}: no rooms`);
    return;
  }

  console.log(`\n• ${hotelName} (${hotelId}) — ${roomSnap.size} room(s)`);

  // ---- 1. Infer room types ------------------------------------------------
  const groups = new Map<string, { ids: string[]; rates: number[]; capacity: number[] }>();
  roomSnap.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const label = (typeof data.type === 'string' && data.type.trim()) || 'Standard';
    const group = groups.get(label) || { ids: [], rates: [], capacity: [] };
    group.ids.push(docSnap.id);
    if (typeof data.pricePerNight === 'number') group.rates.push(data.pricePerNight);
    if (typeof data.capacity === 'number') group.capacity.push(data.capacity);
    groups.set(label, group);
  });

  const typeIdByLabel = new Map<string, string>();
  for (const [label, group] of groups) {
    const slug = slugify(label);
    const id = `rt_${slug}`;
    typeIdByLabel.set(label, id);

    const alreadyExists = existingTypes.docs.some((d) => d.id === id);
    if (!alreadyExists) {
      console.log(
        `    + roomType ${id}: "${label}" — ${group.ids.length} room(s), ` +
          `baseRate ${median(group.rates)}, sleeps ${group.capacity.length ? Math.max(...group.capacity) : DEFAULT_OCCUPANCY}`
      );
      stats.roomTypesCreated += 1;
      if (APPLY) {
        await roomTypesRef.doc(id).set({
          name: label,
          baseRate: median(group.rates),
          maxOccupancy: group.capacity.length ? Math.max(...group.capacity) : DEFAULT_OCCUPANCY,
          amenities: [],
          createdAt: new Date().toISOString(),
        });
      }
    } else {
      console.log(`    = roomType ${id} already exists`);
    }
  }

  // ---- 2/3/4/5. Per-room work --------------------------------------------
  for (const roomDoc of roomSnap.docs) {
    const room = roomDoc.data();
    const label = (typeof room.type === 'string' && room.type.trim()) || 'Standard';
    const roomTypeId = typeIdByLabel.get(label) || `rt_${slugify('Standard')}`;
    const nextStatus = STATUS_MAP[String(room.status || 'available')] || 'available';

    const hasGuestFields = ROOM_GUEST_FIELDS.some((f) => f in room);
    const needsTypeId = !room.roomTypeId;
    const needsStatusFix = room.status !== nextStatus;

    if (!hasGuestFields && !needsTypeId && !needsStatusFix) continue;
    stats.roomsUpdated += 1;

    const updates: Record<string, unknown> = {
      roomTypeId,
      status: nextStatus,
    };
    ROOM_GUEST_FIELDS.forEach((f) => {
      updates[f] = FieldValue.delete();
    });

    if (hasGuestFields) {
      console.log(`    ~ room ${room.roomNumber}: moving stay data to a booking`);
    } else {
      console.log(`    ~ room ${room.roomNumber}: linking type + normalising status`);
    }

    if (!APPLY) continue;

    await roomDoc.ref.update(updates);

    // Occupied rooms become live CHECKED_IN bookings so the front desk keeps
    // working the moment the new UI ships.
    const wasOccupied = nextStatus === 'occupied' || String(room.status) === 'OCCUPIED';
    if (!wasOccupied) continue;

    const checkInDate = dateOnlyFrom(room.checkedInAt, today());
    const checkOutDate = dateOnlyFrom(room.expectedCheckout, addDays(checkInDate, 1));
    const safeCheckOut = utcMs(checkOutDate) > utcMs(checkInDate) ? checkOutDate : addDays(checkInDate, 1);
    const nights = enumerateNights(checkInDate, safeCheckOut);

    const guestRef = await guestsRef.add({
      name: String(room.guestName || 'In-House Guest'),
      phone: String(room.guestPhone || ''),
      email: typeof room.guestEmail === 'string' && room.guestEmail ? room.guestEmail : null,
      createdAt: FieldValue.serverTimestamp(),
      migratedFromRoomId: roomDoc.id,
    });
    stats.guestsCreated += 1;

    const bookingRef = await bookingsRef.add({
      guestId: guestRef.id,
      roomId: roomDoc.id,
      roomTypeId,
      checkInDate,
      checkOutDate: safeCheckOut,
      actualCheckInAt: FieldValue.serverTimestamp(),
      actualCheckOutAt: null,
      status: 'CHECKED_IN',
      agreedRate: typeof room.pricePerNight === 'number' ? room.pricePerNight : median([]),
      numGuests: 1,
      source: 'walk-in',
      createdBy: 'migration',
      createdAt: FieldValue.serverTimestamp(),
    });
    stats.bookingsCreated += 1;

    const batch = db.batch();
    nights.forEach((date) => {
      batch.set(nightsRef.doc(`${roomDoc.id}_${date}`), {
        roomId: roomDoc.id,
        date,
        bookingId: bookingRef.id,
      });
      stats.roomNightsCreated += 1;
    });
    await batch.commit();

    await foliosRef.doc(bookingRef.id).set({
      bookingId: bookingRef.id,
      status: 'OPEN',
      balance: 0,
    });
    stats.foliosCreated += 1;
  }
}

async function main() {
  console.log(`\n=== Reservation migration (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  console.log(`Project: ${projectId}`);
  console.log(`Database: ${appletConfig.firestoreDatabaseId || '(default)'}`);

  const hotelsSnap = ONLY_HOTEL
    ? await db.collection('hotels').doc(ONLY_HOTEL).get().then((d) => (d.exists ? [d] : []))
    : (await db.collection('hotels').get()).docs;

  if (APPLY && hotelsSnap.length === 0) {
    console.error(`✗ No hotel found${ONLY_HOTEL ? ` with id ${ONLY_HOTEL}` : ''}.`);
    process.exit(1);
  }

  for (const hotelDoc of hotelsSnap) {
    stats.hotels += 1;
    const data = hotelDoc.data() as { name?: string };
    await migrateHotel(hotelDoc.id, data?.name || hotelDoc.id);
  }

  console.log('\n=== Summary ===');
  console.log(`  hotels scanned        : ${stats.hotels}`);
  console.log(`  roomTypes created     : ${stats.roomTypesCreated}`);
  console.log(`  rooms updated         : ${stats.roomsUpdated}`);
  console.log(`  guests created        : ${stats.guestsCreated}`);
  console.log(`  bookings created      : ${stats.bookingsCreated}`);
  console.log(`  roomNights created    : ${stats.roomNightsCreated}`);
  console.log(`  folios created        : ${stats.foliosCreated}`);
  if (stats.skipped.length) {
    console.log(`  skipped               : ${stats.skipped.join(', ')}`);
  }

  if (!APPLY) {
    console.log('\n  This was a DRY RUN — nothing was written.');
    console.log('  Re-run with --apply to perform the migration.\n');
  } else {
    console.log('\n  Migration applied. Next: deploy the updated firestore.rules.\n');
  }
}

main().catch((err) => {
  console.error('\n✗ Migration failed:', err?.message || err);
  process.exit(1);
});
