# Reservation migration — go-live runbook

Ordered, safe path to applying the rooms → room-types + bookings migration.
Read this together with [reservation-model.md](./reservation-model.md) (data
model & invariants). Every command takes the same credentials:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/sa.json
#   or: gcloud auth application-default login
```

All scripts are **dry-run by default**; nothing writes without `--apply`.

---

## 1. Survey production data (read-only)

```bash
npm run report:room-values
# one hotel only:
npm run report:room-values -- --hotel hotel_abc_123
```

For every hotel (and a combined total) it prints each distinct raw `status`
and free-text `type` string with counts, plus:

- `→ 'occupied' / 'available' / …` — how the migration maps it.
- `⚠ UNMAPPED` — a status the migration doesn't know; it would fall back to
  `available`. **Do not proceed until each of these is resolved** (step 2).
- an inferred roomType id for each type, and a preview **needs-review count**.

Save this output — it is your before/after record.

## 2. Fix dirty data ON THE ROOM DOCS (optional, but do it first)

If the report shows type-casing duplicates (`"Suite"` vs `"suite"`) or
`⚠ UNMAPPED` statuses, fix the **source data**, not the migration:

```bash
npm run fix:room-values                       # dry run — shows every change
npm run fix:room-values -- --apply            # write canonicalisations
```

It automatically (and conservatively):

- maps known status variants to canonical lowercase (`VACANT`→`available`,
  `OCCUPIED`→`occupied`; already-canonical values untouched);
- rewrites type-casing/whitespace duplicates to the most common spelling
  (e.g. `"suite"`→`"Suite"`), reporting each merged slug.

It **never guesses** an unrecognised status. Each is listed with its room and
must be resolved by a human — fix it in the Firebase console, **or** re-run
with an explicit, hand-confirmed remap:

```bash
npm run fix:room-values -- --status-map 'Maintnance=maintenance' --apply
```

Blank types and missing statuses are left alone (the migration groups blank
types as "Standard" and defaults missing status to available) and are only
reported. After applying, re-run `npm run report:room-values` and confirm no
`⚠ UNMAPPED` lines remain and the type list is clean.

## 3. Full dry run (non-destructive — read everything)

```bash
npm run migrate:reservations 2>&1 | tee migration-dryrun.log
```

For **every** occupied room this prints the full guest / booking /
roomNights / folio documents it would create (server timestamps and Firestore
auto-ids are marked as placeholders; roomNight ids are deterministic). Read
it all, not just a sample, and verify per occupied room:

- **Dates:** `checkInDate` → `checkOutDate` match the real stay; the number
  of roomNights equals the nights; the checkout day is **not** locked
  (half-open `[in, out)`). Rooms with no dates default to today→tomorrow.
- **Rate:** `agreedRate` is the room's `pricePerNight`, else the inferred
  room-type rate, else 150.
- **Guest:** name/phone/email carried over (empty phone / null email when the
  legacy room had none).
- **needs-review:** the count equals only rooms that are occupied yet carry
  none of the guest/stay fields. Each is logged to `needs-review.json`.

Write nothing to production in this step.

## 4. Own the `needs-review.json` worklist

`needs-review.json` (repo root, **git-ignored** — it holds production data)
is written in both dry-run and apply. Copy it somewhere the team will not
lose it **before** it can be regenerated away (a re-run with zero entries
deletes the file). Assign:

| Question to answer per entry | If true | If false |
|---|---|---|
| Is a guest really in the room right now? | Create the **guest + CHECKED_IN booking** through the app (this writes the roomNights locks + OPEN folio). Use the real arrival date and rate. | The room is actually **vacant** — set its `status` to `available` (it currently says occupied but has no stay). |

⚠️ Until resolved, these rooms have **no roomNights**, so the reservation
engine treats them as **bookable** — an occupied-but-untracked room could be
double-sold. Target: clear the list **on go-live day**, before staff take new
reservations. Each entry carries hotel id/name, room id/number, raw &
normalised status, inferred room type, rate and capacity to speed triage.

## 5. Staged rollout — one hotel, verify, then the rest

**a. Pilot one hotel (pick a low-occupancy one):**

```bash
npm run migrate:reservations -- --apply --hotel <pilot-hotel-id>
```

**b. Verify the pilot in the app, end to end, before continuing:**

- Front desk shows the migrated in-house guests as **Checked-in** bookings
  with correct room, dates and rate.
- Each migrated occupied room shows as occupied and is **not** bookable on its
  past/current nights (roomNights exist); future nights behave as expected.
- Folios exist (OPEN, balance 0); a test food/service order raises a charge.
- Check-in / check-out / mark-clean cycle works; housekeeping board reflects
  statuses.
- Walk through every `needs-review.json` entry for this hotel.

**c. Roll out to the rest**, then confirm:

```bash
npm run migrate:reservations -- --apply
npm run report:room-values     # expect: no UNMAPPED, needs-review only = the
                               # guest-less occupied rooms being triaged
```

The migration is **idempotent** — rooms that already have a booking (or are
fully stamped) are skipped, so re-running is safe. After all hotels look
right, deploy the updated `firestore.rules`.

**Rollback note:** the migration deletes the legacy guest fields off room
docs. If a pilot must be rolled back, those values are preserved verbatim in
the `guests`/`bookings` docs created (guest name/phone/email; dates on the
booking) and in the dry-run log — restore manually for the affected hotel.
Take a Firestore export of the pilot hotel before `--apply` if you want a
point-in-time snapshot.
