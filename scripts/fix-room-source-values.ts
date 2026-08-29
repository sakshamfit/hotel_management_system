#!/usr/bin/env tsx
/**
 * OPTIONAL PRE-MIGRATION SOURCE CLEANUP — fixes ROOM DOCS directly.
 * ==================================================================
 *
 * Run this AFTER `npm run report:room-values` if the report shows:
 *   • type-casing duplicates ("Suite" vs "suite") on rooms, or
 *   • status values the migration doesn't recognise (⚠ UNMAPPED).
 *
 * The migration script deliberately does NOT grow more special-casing for
 * dirty data — the data itself is fixed here, on the room documents.
 *
 * What it fixes automatically (safe canonicalisation — dry-run shows all):
 *   • status: trims whitespace and maps known casing/legacy variants to the
 *     canonical lowercase values:  VACANT/vacant → available,
 *     OCCUPIED → occupied (already-canonical available/occupied/cleaning/
 *     maintenance are left as-is).
 *   • type:   casing/whitespace variants that resolve to the same room-type
 *     slug are rewritten to the most common spelling, e.g. "suite" → "Suite"
 *     (2 rooms say "Suite", 1 says "suite"). Blank/missing types are left
 *     untouched (the migration groups them as "Standard") and only reported.
 *
 * What it NEVER guesses:
 *   • A status value it does not recognise (a typo or unexpected value) is
 *     reported for a human decision and is NOT written. Fix it in the Firebase
 *     console, OR pass an explicit, hand-confirmed remap on the command line:
 *
 *       npm run fix:room-values -- --status-map 'Maintnance=maintenance'
 *       npm run fix:room-values -- --status-map 'availabel=available' --apply
 *
 *     Each --status-map is one '<raw>=<canonical>' pair; the canonical side
 *     must be one of available | occupied | cleaning | maintenance.
 *
 * Dry-run by default. Re-run with --apply to write. Only the status/type
 * fields are ever touched.
 *
 * Usage
 * -----
 *   npm run fix:room-values                       # dry run — prints every change
 *   npm run fix:room-values -- --apply            # write the fixes
 *   npm run fix:room-values -- --hotel hotel_abc  # one hotel
 *
 * Prerequisites
 * -------------
 *   export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/sa.json
 *   # or: gcloud auth application-default login
 */

import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Canonical values
// ---------------------------------------------------------------------------

const CANONICAL_STATUSES = ['available', 'occupied', 'cleaning', 'maintenance'] as const;

/** Lowercased legacy/casing variants → canonical status. */
const STATUS_ALIASES: Record<string, string> = {
  available: 'available',
  vacant: 'available',
  occupied: 'occupied',
  cleaning: 'cleaning',
  maintenance: 'maintenance',
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const hotelArgIndex = argv.indexOf('--hotel');
const ONLY_HOTEL = hotelArgIndex !== -1 ? argv[hotelArgIndex + 1] : undefined;

// Explicit, operator-confirmed status remaps: raw (as it appears, trimmed) → canonical.
const explicitStatusMap = new Map<string, string>();
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--status-map') {
    const pair = argv[i + 1] || '';
    const eq = pair.indexOf('=');
    if (eq === -1) {
      console.error(`✗ --status-map expects '<raw>=<canonical>', got: "${pair}"`);
      process.exit(1);
    }
    const raw = pair.slice(0, eq).trim();
    const target = pair.slice(eq + 1).trim();
    if (!CANONICAL_STATUSES.includes(target as (typeof CANONICAL_STATUSES)[number])) {
      console.error(
        `✗ --status-map target "${target}" is not a canonical status ` +
          `(available | occupied | cleaning | maintenance).`
      );
      process.exit(1);
    }
    explicitStatusMap.set(raw, target);
    i += 1;
  }
}

// ---------------------------------------------------------------------------
// Firebase Admin init (same as the migration script)
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
// Status / type canonicalisation
// ---------------------------------------------------------------------------

type StatusResolution =
  | { kind: 'canonical'; value: string; changed: boolean }
  | { kind: 'missing' }
  | { kind: 'unknown' };

/**
 * Resolve a raw room status to a canonical value.
 * An explicit --status-map wins; otherwise known casing/legacy aliases map.
 * Anything else is unknown and is NEVER written by this script.
 */
function resolveStatus(raw: unknown): StatusResolution {
  if (raw === undefined || raw === null) return { kind: 'missing' };
  const trimmed = String(raw).trim();
  if (trimmed === '') return { kind: 'missing' };

  const explicit = explicitStatusMap.get(trimmed);
  if (explicit) return { kind: 'canonical', value: explicit, changed: explicit !== trimmed };

  const aliased = STATUS_ALIASES[trimmed.toLowerCase()];
  if (aliased) return { kind: 'canonical', value: aliased, changed: aliased !== trimmed };

  return { kind: 'unknown' };
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'standard';
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

interface FixStats {
  hotels: number;
  roomsScanned: number;
  statusCanonicalized: number;
  typeCanonicalized: number;
  blankTypes: number;
  missingStatus: number;
  unknownStatuses: { hotel: string; room: string; raw: string }[];
}

const stats: FixStats = {
  hotels: 0,
  roomsScanned: 0,
  statusCanonicalized: 0,
  typeCanonicalized: 0,
  blankTypes: 0,
  missingStatus: 0,
  unknownStatuses: [],
};

async function fixHotel(hotelId: string, hotelName: string) {
  const roomsRef = db.collection('hotels').doc(hotelId).collection('rooms');
  const roomSnap = await roomsRef.get();

  if (roomSnap.empty) {
    console.log(`\n• ${hotelName} (${hotelId}) — no rooms, skipping`);
    return;
  }

  console.log(`\n• ${hotelName} (${hotelId}) — ${roomSnap.size} room(s)`);

  // ---- Pick the canonical type label per slug (most common spelling) ------
  // Keyed by TRIMMED label so trailing whitespace also cleans up.
  const slugLabels = new Map<string, Map<string, number>>();
  roomSnap.docs.forEach((d) => {
    const t = d.data().type;
    if (typeof t !== 'string') return;
    const label = t.trim();
    if (!label) return;
    const slug = slugify(label);
    const labels = slugLabels.get(slug) || new Map<string, number>();
    labels.set(label, (labels.get(label) || 0) + 1);
    slugLabels.set(slug, labels);
  });

  const canonicalLabelBySlug = new Map<string, string>();
  for (const [slug, labels] of slugLabels) {
    let best = '';
    let bestCount = -1;
    for (const [label, count] of labels) {
      if (count > bestCount) {
        best = label;
        bestCount = count;
      }
    }
    canonicalLabelBySlug.set(slug, best);
    const variants = [...labels.keys()];
    if (variants.length > 1) {
      console.log(
        `    type slug "${slug}" has ${variants.length} spellings ${variants.map((v) => `"${v}"×${labels.get(v)}`).join(', ')} ` +
          `→ canonicalising to "${best}"`
      );
    }
  }

  // ---- Per-room fixes ------------------------------------------------------
  for (const roomDoc of roomSnap.docs) {
    const room = roomDoc.data() as Record<string, any>;
    stats.roomsScanned += 1;

    const updates: Record<string, unknown> = {};
    const notes: string[] = [];

    // status
    const statusResult = resolveStatus(room.status);
    if (statusResult.kind === 'unknown') {
      stats.unknownStatuses.push({
        hotel: hotelId,
        room: `${room.roomNumber ?? '?'} (${roomDoc.id})`,
        raw: String(room.status),
      });
      console.log(
        `    ⚠ room ${room.roomNumber ?? '?'} (${roomDoc.id}): UNKNOWN status "${room.status}" ` +
          `— NOT changed. Decide what it means and fix in the console or pass ` +
          `--status-map '${String(room.status).trim()}=<canonical>'`
      );
    } else if (statusResult.kind === 'missing') {
      stats.missingStatus += 1;
      // Leave it — the migration defaults missing status to available.
    } else if (statusResult.changed) {
      updates.status = statusResult.value;
      notes.push(`status "${String(room.status).trim()}" → "${statusResult.value}"`);
      stats.statusCanonicalized += 1;
    }

    // type
    if (typeof room.type === 'string') {
      const label = room.type.trim();
      if (!label) {
        stats.blankTypes += 1;
        // Leave blank types alone (migration groups them as "Standard").
      } else {
        const canonical = canonicalLabelBySlug.get(slugify(label));
        if (canonical && room.type !== canonical) {
          updates.type = canonical;
          notes.push(`type "${room.type}" → "${canonical}"`);
          stats.typeCanonicalized += 1;
        }
      }
    }

    if (Object.keys(updates).length === 0) continue;

    if (!APPLY) {
      console.log(`    ~ room ${room.roomNumber ?? '?'} (${roomDoc.id}) [would write]: ${notes.join('; ')}`);
      console.log(
        JSON.stringify(updates, null, 2)
          .split('\n')
          .map((l) => `        ${l}`)
          .join('\n')
      );
    } else {
      await roomDoc.ref.update(updates);
      console.log(`    ✓ room ${room.roomNumber ?? '?'} (${roomDoc.id}): ${notes.join('; ')}`);
    }
  }
}

async function main() {
  console.log(`\n=== Room source-value cleanup (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  console.log(`Project: ${projectId}`);
  console.log(`Database: ${databaseId}`);
  if (explicitStatusMap.size) {
    console.log('Explicit status remaps:');
    for (const [raw, target] of explicitStatusMap) console.log(`  "${raw}" → "${target}"`);
  }

  const hotelsSnap = ONLY_HOTEL
    ? await db.collection('hotels').doc(ONLY_HOTEL).get().then((d) => (d.exists ? [d] : []))
    : (await db.collection('hotels').get()).docs;

  if (hotelsSnap.length === 0) {
    console.error(`✗ No hotel found${ONLY_HOTEL ? ` with id ${ONLY_HOTEL}` : ''}.`);
    process.exit(1);
  }

  for (const hotelDoc of hotelsSnap) {
    stats.hotels += 1;
    const data = hotelDoc.data() as { name?: string };
    await fixHotel(hotelDoc.id, data?.name || hotelDoc.id);
  }

  console.log('\n=== Summary ===');
  console.log(`  hotels scanned          : ${stats.hotels}`);
  console.log(`  rooms scanned           : ${stats.roomsScanned}`);
  console.log(`  statuses canonicalised  : ${stats.statusCanonicalized}`);
  console.log(`  types canonicalised     : ${stats.typeCanonicalized}`);
  console.log(`  blank/missing types     : ${stats.blankTypes} (left as-is; migration groups as "Standard")`);
  console.log(`  missing statuses        : ${stats.missingStatus} (left as-is; migration defaults to available)`);
  console.log(`  UNKNOWN statuses        : ${stats.unknownStatuses.length} (NOT changed — manual decision)`);

  if (stats.unknownStatuses.length) {
    console.log('\n  ⚠ Unrecognised status values — these were NOT written. For each, confirm what the');
    console.log('    room actually is, then either fix it in the Firebase console or re-run with an');
    console.log('    explicit remap, e.g.:');
    const byValue = new Map<string, number>();
    stats.unknownStatuses.forEach((u) => byValue.set(u.raw, (byValue.get(u.raw) || 0) + 1));
    for (const [raw, count] of byValue) {
      console.log(`      --status-map '${raw.trim()}=<available|occupied|cleaning|maintenance>'   (×${count})`);
    }
    stats.unknownStatuses.forEach((u) => {
      console.log(`        • ${u.hotel} room ${u.room}: "${u.raw}"`);
    });
  }

  if (!APPLY) {
    console.log('\n  This was a DRY RUN — Firestore was not touched.');
    console.log('  Re-run with --apply to write the canonicalisations above.\n');
  } else {
    console.log('\n  Cleanup applied. Re-run `npm run report:room-values` to confirm, then run the migration.\n');
  }
}

main().catch((err) => {
  console.error('\n✗ Cleanup failed:', err?.message || err);
  process.exit(1);
});
