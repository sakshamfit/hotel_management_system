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
 *   4. Move stay data OFF the room document: for every currently-occupied room
 *      that still carries guest/stay fields, create a `guests` doc, a
 *      `bookings` doc (CHECKED_IN), its `roomNights` locks, and an OPEN
 *      `folios` doc.
 *   5. Delete the guest fields from the room doc.
 *
 * Occupied rooms with NO guest/stay fields at all are NOT guessed into a
 * placeholder booking. They are written to needs-review.json (in both modes)
 * and skipped — handle them manually, then re-run.
 *
 * Dry-run by default. Re-run with --apply to write. The dry run prints the
 * FULL document payloads it would create for every occupied room, not just a
 * summary line.
 *
 * Usage
 * -----
 *   npm run migrate:reservations              # dry run, prints every doc it WOULD write
 *   npm run migrate:reservations -- --apply   # perform the migration
 *   npm run migrate:reservations -- --apply --hotel hotel_abc_123
 *
 *   npm run report:room-values                # read-only: every distinct room
 *                                             # `type`/`status` string + counts
 *   # (equivalent: npm run migrate:reservations -- --report-values [--hotel id])
 *
 *   # If the report shows type-casing duplicates or ⚠ UNMAPPED statuses, fix
 *   # the SOURCE data first (not this script) — see docs/migration-go-live-runbook.md:
 *   npm run fix:room-values -- --apply        # canonicalise status casing,
 *                                             # merge type label duplicates
 *
 * Prerequisites
 * -------------
 *   export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/sa.json
 *   # or: gcloud auth application-default login
 */

import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const REPORT_VALUES = argv.includes('--report-values');
const hotelArgIndex = argv.indexOf('--hotel');
const ONLY_HOTEL = hotelArgIndex !== -1 ? argv[hotelArgIndex + 1] : undefined;

// ---------------------------------------------------------------------------
// Firebase Admin init
// ---------------------------------------------------------------------------

const appletConfig = JSON.parse(readFileSync(resolve(repoRoot, 'firebase-applet-config.json'), 'utf8'));
const projectId = process.env.FIREBASE_PROJECT_ID || appletConfig.projectId;
const databaseId = appletConfig.firestoreDatabaseId || '(default)';

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
const db = getFirestore(app, databaseId);

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

/** Sentinel rendered in dry-run output where Firestore will stamp a server timestamp. */
const SERVER_TS = '<serverTimestamp() at write time>';

const NEEDS_REVIEW_PATH = resolve(repoRoot, 'needs-review.json');

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
// Small output helpers
// ---------------------------------------------------------------------------

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

function indent(block: string, spaces: number): string {
  const lead = ' '.repeat(spaces);
  return block
    .split('\n')
    .map((line) => lead + line)
    .join('\n');
}

function pretty(value: unknown, spaces: number): string {
  return indent(JSON.stringify(value, null, 2), spaces);
}

function roomHasGuestFields(room: Record<string, any>): boolean {
  return ROOM_GUEST_FIELDS.some((f) => f in room);
}

/**
 * Replaces the SERVER_TS sentinel with a real FieldValue.serverTimestamp()
 * immediately before writing. Dry-run output keeps the sentinel so the reader
 * can see exactly which fields Firestore will stamp.
 */
function withServerTimestamps(data: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v === SERVER_TS ? FieldValue.serverTimestamp() : v])
  );
}

// ---------------------------------------------------------------------------
// Stay plan — the exact guest/booking/roomNights/folio docs a stay becomes.
// Built identically in dry-run and apply mode; only the ids differ (dry-run
// uses placeholders because Firestore generates auto ids at write time).
// ---------------------------------------------------------------------------

interface StayPlan {
  checkInDate: string;
  checkOutDate: string;
  guest: Record<string, unknown>;
  booking: Record<string, unknown>;
  nights: { id: string; data: Record<string, unknown> }[];
  folio: { id: string; data: Record<string, unknown> };
}

// Fresh tokens per plan: cross-document id references must be DISTINCT
// placeholders — a single shared constant would alias, so patching
// booking.guestId after the auto id is known would silently rewrite every
// other reference too.
const autoGuestToken = () => '<auto-id: guests/{docId}>';
const autoBookingToken = () => '<auto-id: bookings/{docId}>';

function buildStayPlan(room: Record<string, any>, roomId: string, roomTypeId: string, fallbackRate: number): StayPlan {
  const checkInDate = dateOnlyFrom(room.checkedInAt, today());
  const checkOutDate = dateOnlyFrom(room.expectedCheckout, addDays(checkInDate, 1));
  const safeCheckOut = utcMs(checkOutDate) > utcMs(checkInDate) ? checkOutDate : addDays(checkInDate, 1);
  const nights = enumerateNights(checkInDate, safeCheckOut);

  return {
    checkInDate,
    checkOutDate: safeCheckOut,
    guest: {
      name: String(room.guestName || 'In-House Guest'),
      phone: String(room.guestPhone || ''),
      email: typeof room.guestEmail === 'string' && room.guestEmail ? room.guestEmail : null,
      createdAt: SERVER_TS,
      migratedFromRoomId: roomId,
    },
    booking: {
      roomId,
      roomTypeId,
      checkInDate,
      checkOutDate: safeCheckOut,
      actualCheckInAt: SERVER_TS,
      actualCheckOutAt: null,
      status: 'CHECKED_IN',
      // Snapshot the room's own rate when it has one; else the rate inferred
      // for its room type (median), else the flat default.
      agreedRate: typeof room.pricePerNight === 'number' ? room.pricePerNight : fallbackRate,
      numGuests: 1,
      source: 'walk-in',
      createdBy: 'migration',
      createdAt: SERVER_TS,
      guestId: autoGuestToken(),
    },
    nights: nights.map((date) => ({
      id: `${roomId}_${date}`,
      data: { roomId, date, bookingId: autoBookingToken() },
    })),
    folio: {
      id: autoBookingToken(), // folio doc id == booking id
      data: { bookingId: autoBookingToken(), status: 'OPEN', balance: 0 },
    },
  };
}

function printStayPlan(roomNumber: unknown, roomId: string, plan: StayPlan) {
  console.log(
    `    ~ room ${roomNumber} (${roomId}): OCCUPIED — would move stay data off the room ` +
      `and create ${plan.nights.length} night(s), ${plan.checkInDate} → ${plan.checkOutDate}:`
  );
  console.log('');

  console.log('      [write] rooms/' + roomId + '  (room update — guest fields deleted):');
  const roomUpdatePreview = { status: 'occupied (normalised)', roomTypeId: plan.booking.roomTypeId };
  ROOM_GUEST_FIELDS.forEach((f) => {
    (roomUpdatePreview as Record<string, unknown>)[f] = '<FieldValue.delete()>';
  });
  console.log(pretty(roomUpdatePreview, 8));
  console.log('');

  console.log('      [create] guests/<auto-id>:');
  console.log(pretty(plan.guest, 8));
  console.log('');

  console.log('      [create] bookings/<auto-id>  (status CHECKED_IN):');
  console.log(pretty(plan.booking, 8));
  console.log('');

  console.log(`      [create] roomNights/  (${plan.nights.length} lock doc(s); ids are deterministic '{roomId}_{date}'):`);
  plan.nights.forEach((n) => {
    console.log(`        roomNights/${n.id}:`);
    console.log(pretty(n.data, 10));
  });
  console.log('');

  console.log('      [create] folios/<auto-id = booking id>  (one OPEN folio, same id as the booking):');
  console.log(pretty(plan.folio.data, 8));
  console.log('');
}

// ---------------------------------------------------------------------------
// Needs-review (occupied rooms with no guest/stay fields — never guessed)
// ---------------------------------------------------------------------------

interface NeedsReviewEntry {
  hotelId: string;
  hotelName: string;
  roomId: string;
  roomNumber: unknown;
  floor?: number;
  rawStatus: unknown;
  normalizedStatus: string;
  rawType: string | null;
  inferredRoomTypeId: string;
  pricePerNight?: number;
  capacity?: number;
  reason: string;
  guestFieldsPresentOnRoom: string[];
  scannedAt: string;
}

const needsReviewEntries: NeedsReviewEntry[] = [];

// ---------------------------------------------------------------------------
// Migration stats
// ---------------------------------------------------------------------------

interface MigrationStats {
  hotels: number;
  roomTypesCreated: number;
  roomsUpdated: number;
  guestsCreated: number;
  bookingsCreated: number;
  roomNightsCreated: number;
  foliosCreated: number;
  needsReview: number;
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
  needsReview: 0,
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

  // Rooms that already have a booking in the new model are migrated (or were
  // booked through the new front desk). On a re-run they must be left alone —
  // an occupied room legitimately carries NO guest fields once migrated, which
  // would otherwise look like the "needs review" case below.
  const bookingsSnap = await bookingsRef.get();
  const bookedRoomIds = new Set<string>();
  bookingsSnap.docs.forEach((d) => {
    const roomId = d.get('roomId');
    if (typeof roomId === 'string') bookedRoomIds.add(roomId);
  });

  console.log(`\n• ${hotelName} (${hotelId}) — ${roomSnap.size} room(s)`);

  // ---- 1. Infer room types ------------------------------------------------
  // Group by SLUG, not raw label: free-text variants like "Suite"/"suite"
  // (or "Deluxe "/"deluxe") collapse to the same rt_suite id and must merge —
  // creating the doc twice would silently clobber its rate on the second set().
  const groups = new Map<
    string,
    { labelCounts: Map<string, number>; ids: string[]; rates: number[]; capacity: number[] }
  >();
  roomSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() as Record<string, any>;
    const label = (typeof data.type === 'string' && data.type.trim()) || 'Standard';
    const slug = slugify(label);
    const group = groups.get(slug) || { labelCounts: new Map(), ids: [], rates: [], capacity: [] };
    group.labelCounts.set(label, (group.labelCounts.get(label) || 0) + 1);
    group.ids.push(docSnap.id);
    if (typeof data.pricePerNight === 'number') group.rates.push(data.pricePerNight);
    if (typeof data.capacity === 'number') group.capacity.push(data.capacity);
    groups.set(slug, group);
  });

  const typeIdByLabel = new Map<string, string>();
  const typeRateBySlug = new Map<string, number>();
  for (const [slug, group] of groups) {
    const id = `rt_${slug}`;
    // Every raw spelling maps onto the merged type id.
    for (const label of group.labelCounts.keys()) typeIdByLabel.set(label, id);
    typeRateBySlug.set(slug, median(group.rates));

    // Display name = most common spelling, ties resolved to first seen.
    let displayLabel = '';
    let bestCount = -1;
    for (const [label, count] of group.labelCounts) {
      if (count > bestCount) {
        displayLabel = label;
        bestCount = count;
      }
    }
    const variants = [...group.labelCounts.keys()];
    const variantNote = variants.length > 1 ? ` (merges ${variants.map((v) => `"${v}"`).join(', ')})` : '';
    const rateLine =
      `${group.ids.length} room(s), baseRate ${median(group.rates)}, ` +
      `sleeps ${group.capacity.length ? Math.max(...group.capacity) : DEFAULT_OCCUPANCY}`;

    const alreadyExists = existingTypes.docs.some((d) => d.id === id);
    if (!alreadyExists) {
      console.log(`    + roomType ${id}: "${displayLabel}"${variantNote} — ${rateLine}`);
      stats.roomTypesCreated += 1;
      if (APPLY) {
        await roomTypesRef.doc(id).set({
          name: displayLabel,
          baseRate: median(group.rates),
          maxOccupancy: group.capacity.length ? Math.max(...group.capacity) : DEFAULT_OCCUPANCY,
          amenities: [],
          createdAt: new Date().toISOString(),
        });
      }
    } else {
      console.log(`    = roomType ${id} already exists — reused for ${variants.map((v) => `"${v}"`).join(', ')}`);
    }
  }

  // ---- 2/3/4/5. Per-room work --------------------------------------------
  for (const roomDoc of roomSnap.docs) {
    const room = roomDoc.data() as Record<string, any>;
    const label = (typeof room.type === 'string' && room.type.trim()) || 'Standard';
    const roomTypeId = typeIdByLabel.get(label) || `rt_${slugify('Standard')}`;
    const fallbackRate = typeRateBySlug.get(slugify(label)) ?? DEFAULT_RATE;

    const rawStatus = room.status === undefined || room.status === null ? '' : String(room.status);
    const nextStatus = STATUS_MAP[rawStatus || 'available'] || 'available';
    const willBeOccupied = nextStatus === 'occupied';

    const hasGuestFields = roomHasGuestFields(room);
    const needsTypeId = !room.roomTypeId;
    const needsStatusFix = rawStatus !== nextStatus;
    const roomWillUpdate = hasGuestFields || needsTypeId || needsStatusFix;

    // Occupied but carrying NO guest/stay data at all AND no existing booking
    // → a legacy room with no stay data. Do not fabricate a same-day
    // placeholder booking — log it for manual handling and skip. An occupied
    // room that already has a booking is simply already migrated.
    const alreadyMigrated = willBeOccupied && !hasGuestFields && bookedRoomIds.has(roomDoc.id);
    const needsReview = willBeOccupied && !hasGuestFields && !bookedRoomIds.has(roomDoc.id);

    if (alreadyMigrated) continue;
    if (!needsReview && !roomWillUpdate) continue;

    stats.roomsUpdated += roomWillUpdate ? 1 : 0;

    // Room update payload (applied to every room we touch).
    const updates: Record<string, unknown> = { roomTypeId, status: nextStatus };
    if (hasGuestFields) {
      ROOM_GUEST_FIELDS.forEach((f) => {
        updates[f] = FieldValue.delete();
      });
    }

    if (needsReview) {
      stats.needsReview += 1;
      needsReviewEntries.push({
        hotelId,
        hotelName,
        roomId: roomDoc.id,
        roomNumber: room.roomNumber,
        floor: typeof room.floor === 'number' ? room.floor : undefined,
        rawStatus: rawStatus || null,
        normalizedStatus: nextStatus,
        rawType: typeof room.type === 'string' && room.type.trim() ? room.type : null,
        inferredRoomTypeId: roomTypeId,
        pricePerNight: typeof room.pricePerNight === 'number' ? room.pricePerNight : undefined,
        capacity: typeof room.capacity === 'number' ? room.capacity : undefined,
        reason:
          'Room is occupied but has none of the guest/stay fields ' +
          `(${ROOM_GUEST_FIELDS.join(', ')}). No guest, booking, roomNights or folio was created. ` +
          'Create the guest + CHECKED_IN booking manually (which also writes the roomNights locks ' +
          'and OPEN folio). Until then the reservation engine sees NO roomNights for this room and ' +
          'considers it bookable — handle before go-live.',
        guestFieldsPresentOnRoom: ROOM_GUEST_FIELDS.filter((f) => f in room),
        scannedAt: new Date().toISOString(),
      });

      console.log(
        `    ⚠ room ${room.roomNumber} (${roomDoc.id}): ${rawStatus ? `status "${rawStatus}" → occupied` : 'occupied'}, ` +
          `but NO guest/stay fields exist — booking SKIPPED, logged to needs-review.json`
      );
      if (!APPLY) {
        const preview: Record<string, unknown> = { roomTypeId, status: nextStatus };
        console.log('      [would write] rooms/' + roomDoc.id + ':');
        console.log(pretty(preview, 8));
        console.log('');
      }
      if (APPLY && roomWillUpdate) {
        await roomDoc.ref.update(updates);
      }
      continue;
    }

    if (willBeOccupied) {
      const plan = buildStayPlan(room, roomDoc.id, roomTypeId, fallbackRate);

      if (!APPLY) {
        printStayPlan(room.roomNumber, roomDoc.id, plan);
        continue;
      }

      await roomDoc.ref.update(updates);

      const guestRef = await guestsRef.add(withServerTimestamps(plan.guest));
      stats.guestsCreated += 1;

      plan.booking.guestId = guestRef.id;
      const bookingRef = await bookingsRef.add(withServerTimestamps(plan.booking));
      stats.bookingsCreated += 1;

      const batch = db.batch();
      plan.nights.forEach((n) => {
        n.data.bookingId = bookingRef.id;
        batch.set(nightsRef.doc(n.id), n.data);
        stats.roomNightsCreated += 1;
      });
      await batch.commit();

      plan.folio.data.bookingId = bookingRef.id;
      await foliosRef.doc(bookingRef.id).set(plan.folio.data);
      stats.foliosCreated += 1;

      console.log(
        `    ✓ room ${room.roomNumber}: guest ${guestRef.id}, booking ${bookingRef.id} ` +
          `(${plan.nights.length} night(s), ${plan.checkInDate} → ${plan.checkOutDate}), folio OPEN`
      );
    } else {
      // Not occupied: link type / normalise status / clear stale guest fields only.
      if (hasGuestFields) {
        console.log(`    ~ room ${room.roomNumber} (${roomDoc.id}): not occupied — clearing stale guest fields, linking type/normalising status`);
      } else {
        console.log(`    ~ room ${room.roomNumber} (${roomDoc.id}): linking room type / normalising status`);
      }
      if (!APPLY) {
        const preview: Record<string, unknown> = { roomTypeId, status: nextStatus };
        ROOM_GUEST_FIELDS.forEach((f) => {
          if (hasGuestFields) preview[f] = '<FieldValue.delete()>';
        });
        console.log(pretty(preview, 6));
      }
      if (APPLY && roomWillUpdate) {
        await roomDoc.ref.update(updates);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// --report-values: every distinct room `type` / `status` string, with counts
// ---------------------------------------------------------------------------

function statusAnnotation(raw: string): string {
  if (raw === '') return "→ 'available' (missing status defaults to available)";
  const target = STATUS_MAP[raw];
  return target ? `→ '${target}'` : "→ ⚠ UNMAPPED — migration falls back to 'available'";
}

function typeAnnotation(raw: string): string {
  const label = raw.trim() || 'Standard';
  return `→ inferred roomType 'rt_${slugify(label)}'${raw.trim() ? '' : ' (blank/missing grouped as "Standard")'}`;
}

function printValueCounts(
  heading: string,
  counts: Map<string, number>,
  annotate: (raw: string) => string
) {
  console.log(`  ${heading}`);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (rows.length === 0) console.log('    (none)');
  for (const [raw, count] of rows) {
    const label = raw === '' ? '(blank/missing)' : `"${raw}"`;
    console.log(`    ${label.padEnd(44)} × ${String(count).padStart(4)}   ${annotate(raw)}`);
  }
  console.log('');
}

async function runValueReport() {
  console.log('\n=== Room field value report (READ-ONLY — nothing is written) ===');
  console.log(`Project: ${projectId}`);
  console.log(`Database: ${databaseId}`);

  const hotelsSnap = ONLY_HOTEL
    ? await db.collection('hotels').doc(ONLY_HOTEL).get().then((d) => (d.exists ? [d] : []))
    : (await db.collection('hotels').get()).docs;

  if (hotelsSnap.length === 0) {
    console.error(`✗ No hotel found${ONLY_HOTEL ? ` with id ${ONLY_HOTEL}` : ''}.`);
    process.exit(1);
  }

  const globalStatus = new Map<string, number>();
  const globalType = new Map<string, number>();
  let globalRooms = 0;
  let globalNeedsReview = 0;

  for (const hotelDoc of hotelsSnap) {
    const data = hotelDoc.data() as { name?: string };
    const hotelName = data?.name || hotelDoc.id;
    const roomSnap = await db.collection('hotels').doc(hotelDoc.id).collection('rooms').get();

    const statusCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    let needsReview = 0;

    // Booked rooms are already in the new model — an occupied room without
    // guest fields there is normal, not a migration problem.
    const hotelBookings = await db
      .collection('hotels')
      .doc(hotelDoc.id)
      .collection('bookings')
      .get();
    const bookedRoomIds = new Set<string>();
    hotelBookings.docs.forEach((d) => {
      const roomId = d.get('roomId');
      if (typeof roomId === 'string') bookedRoomIds.add(roomId);
    });

    roomSnap.docs.forEach((d) => {
      const room = d.data() as Record<string, any>;
      const rawStatus = room.status === undefined || room.status === null ? '' : String(room.status);
      bump(statusCounts, rawStatus);
      bump(globalStatus, rawStatus);

      const rawType = typeof room.type === 'string' ? room.type : '';
      bump(typeCounts, rawType);
      bump(globalType, rawType);

      const normalised = STATUS_MAP[rawStatus || 'available'] || 'available';
      if (normalised === 'occupied' && !roomHasGuestFields(room) && !bookedRoomIds.has(d.id)) {
        needsReview += 1;
      }
    });

    globalRooms += roomSnap.size;
    globalNeedsReview += needsReview;

    console.log(`\n• ${hotelName} (${hotelDoc.id}) — ${roomSnap.size} room(s)`);
    printValueCounts('status values on rooms (raw):', statusCounts, statusAnnotation);
    printValueCounts('type values on rooms (raw free-text):', typeCounts, typeAnnotation);
    console.log(
      `  occupied rooms with NO guest fields → would be logged to needs-review.json ` +
        `and NOT migrated: ${needsReview}`
    );
  }

  console.log('\n=== Combined across all scanned hotels ===');
  console.log(`  hotels: ${hotelsSnap.length}   rooms: ${globalRooms}\n`);
  printValueCounts('status values (raw, all hotels):', globalStatus, statusAnnotation);
  printValueCounts('type values (raw, all hotels):', globalType, typeAnnotation);
  console.log(`  total occupied rooms with no guest fields (needs-review): ${globalNeedsReview}`);
  console.log('\n  Read-only — no data was changed.\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function writeNeedsReviewFile() {
  const payload = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    projectId,
    databaseId,
    count: needsReviewEntries.length,
    note:
      'Occupied rooms with no guest/stay fields. The migration created NO guest, booking, ' +
      'roomNights or folio for these rooms. Create the guest + CHECKED_IN booking manually ' +
      '(roomNights locks + OPEN folio come with it), or fix the source data and re-run. ' +
      'Until a booking exists there are NO roomNights for these rooms, so the reservation ' +
      'engine considers them bookable.',
    entries: needsReviewEntries,
  };

  if (needsReviewEntries.length === 0) {
    // Remove a stale worklist from an earlier run so it can't mislead.
    try {
      unlinkSync(NEEDS_REVIEW_PATH);
    } catch {
      // didn't exist — fine
    }
    return;
  }

  writeFileSync(NEEDS_REVIEW_PATH, JSON.stringify(payload, null, 2) + '\n');
}

async function main() {
  if (REPORT_VALUES) {
    await runValueReport();
    return;
  }

  console.log(`\n=== Reservation migration (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  console.log(`Project: ${projectId}`);
  console.log(`Database: ${databaseId}`);

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

  writeNeedsReviewFile();

  console.log('\n=== Summary ===');
  console.log(`  hotels scanned        : ${stats.hotels}`);
  console.log(`  roomTypes created     : ${stats.roomTypesCreated}`);
  console.log(`  rooms updated         : ${stats.roomsUpdated}`);
  console.log(`  guests created        : ${stats.guestsCreated}`);
  console.log(`  bookings created      : ${stats.bookingsCreated}`);
  console.log(`  roomNights created    : ${stats.roomNightsCreated}`);
  console.log(`  folios created        : ${stats.foliosCreated}`);
  console.log(`  needs-review (skipped): ${stats.needsReview}`);
  if (stats.skipped.length) {
    console.log(`  skipped               : ${stats.skipped.join(', ')}`);
  }
  if (needsReviewEntries.length) {
    console.log(`\n  ⚠ ${needsReviewEntries.length} occupied room(s) had no guest data — no booking was created.`);
    console.log(`    Manual worklist written to: ${NEEDS_REVIEW_PATH}`);
  }

  if (!APPLY) {
    console.log('\n  This was a DRY RUN — Firestore was not touched.');
    if (needsReviewEntries.length) {
      console.log('  (needs-review.json is a local worklist and is written even in dry-run mode.)');
    }
    console.log('  Re-run with --apply to perform the migration.\n');
  } else {
    console.log('\n  Migration applied. Next: deploy the updated firestore.rules.\n');
  }
}

main().catch((err) => {
  console.error('\n✗ Migration failed:', err?.message || err);
  process.exit(1);
});
