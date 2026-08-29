# Reservation engine — data model & behaviour

Implements the agreed schema. Everything below is what the code actually does;
where it differs from the schema, it is called out.

## Collections

| Path | Purpose | Who can read/write |
|---|---|---|
| `hotels/{hotelId}/roomTypes/{typeId}` | Rate + inventory definition | staff |
| `hotels/{hotelId}/rooms/{roomId}` | Physical room. `roomTypeId` + `status` only | staff read/write, guest reads **own room** |
| `hotels/{hotelId}/guests/{guestId}` | Booking contact (outlives a stay) | staff |
| `hotels/{hotelId}/bookings/{bookingId}` | The stay | staff |
| `hotels/{hotelId}/roomNights/{roomId}_{date}` | **The double-booking lock** | staff |
| `hotels/{hotelId}/folios/{bookingId}` | One folio per booking (same id) | staff |
| `…/folios/{bookingId}/charges/{chargeId}` | Bill lines | staff |
| `…/folios/{bookingId}/payments/{paymentId}` | Settlements (schema only — no UI yet) | staff |

Guests have **no** access to any of these. They touch `orders` only, and the
server raises folio charges on their behalf with the Admin SDK.

## Invariants

1. **A room is taken on a night iff `roomNights/{roomId}_{date}` exists.** No
   other field is authoritative for availability.
2. **Stays are half-open `[checkInDate, checkOutDate)`.** The check-out day is
   not a night, so a guest leaving on the 4th frees the room for an arrival on
   the 4th. All date maths runs in UTC on date-only strings — see
   `src/utils/dates.ts` and `npm run check:dates` (17 cases, incl. month/year
   boundaries and a leap day).
3. **`agreedRate` is a snapshot.** Changing a room type's `baseRate` never
   moves an existing booking.
4. **Stay data lives on the booking, never on the room.** The room carries only
   physical state.
5. **A folio is created with its booking**, `status: 'OPEN'`, `balance: 0`.

## Booking creation (atomic)

`firestoreService.createBooking()` runs one `runTransaction`:

1. Read **every** `roomNights/{roomId}_{date}` for the stay (all reads before
   any write — a Firestore transaction requirement).
2. If any exists → throw `BookingConflictError('booking/room-not-available')`
   with the conflicting dates. **Nothing is written** — no booking, no nights,
   no folio.
3. Otherwise write, in the same transaction: the booking (`RESERVED`), one
   roomNight per night, and the folio.

Contention (two staff booking the same last room) is safe: Firestore retries
the transaction and the loser's second attempt sees the winner's roomNight.

## Front desk

| Action | Effect |
|---|---|
| **New reservation** | Creates a `guests` doc, then `createBooking`. Rate defaults to the room type's `baseRate`, editable → `agreedRate`. |
| **Check in** | Booking → `CHECKED_IN` + `actualCheckInAt`; room → `occupied` |
| **Check out** | Booking → `CHECKED_OUT` + `actualCheckOutAt`; room → **`cleaning`** |
| **Mark clean** | Housekeeping board: room → `available` |
| **Cancel / No-show** | Deletes the booking's roomNights (frees the room) → `CANCELLED` / `NO_SHOW` |

Check-out deliberately does **not** set `available` — housekeeping clears it.
The room-status board in **Housekeeping → Room Status Board** is the other half
of that loop; without it, checked-out rooms would never return to sellable
inventory (the bug flagged in audit §4).

## Order → folio charge

1. Guest places an order exactly as before (untouched).
2. The client calls `POST /api/guest/orders/:orderId/charge`.
3. The server verifies the token is an anonymous guest session, confirms the
   order's `guestUid` is the caller and its `roomId` matches the session's
   room, finds the active `CHECKED_IN` booking, then writes a `FOOD` or
   `SERVICE` charge and increments `folio.balance` in one transaction.

Idempotent (one charge per `sourceOrderId`). Best-effort: a failure here is
logged and never blocks the guest's order.

## Migration

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/sa.json
npm run migrate:reservations             # dry run
npm run migrate:reservations -- --apply  # write
npm run migrate:reservations -- --apply --hotel hotel_abc_123

# Read-only: every distinct raw `type` and `status` string on rooms, with counts
npm run report:room-values
npm run migrate:reservations -- --report-values --hotel hotel_abc_123
```

Per hotel it:

1. Groups rooms by the legacy free-text `type` (grouped by **slug**, so
   `"Suite"`/`"suite"` merge into one `rt_suite` rather than two writes that
   clobber each other) → one `roomTypes` doc (`baseRate` = median
   `pricePerNight`, `maxOccupancy` = max `capacity`, else defaults 150 / 2;
   display name = most common spelling). A hotel with no type info gets one
   **"Standard"** type.
2. Stamps `roomTypeId` on every room.
3. Normalises status casing (`VACANT`→`available`, `OCCUPIED`→`occupied`). Any
   unmapped status (e.g. a typo) falls back to `available` and is surfaced by
   `npm run report:room-values`.
4. For each occupied room that **carries guest/stay fields**, creates a
   `guests` doc, a `CHECKED_IN` booking (dates from `checkedInAt`/
   `expectedCheckout`, defaulting to today→tomorrow; `agreedRate` = the room's
   `pricePerNight`, else the inferred type rate, else 150), its roomNights, and
   an OPEN folio.
5. Deletes the guest fields from the room doc.

**Dry run detail.** The dry run prints the *full* guest / booking / roomNights
/ folio document payloads it would create for every occupied room (server
timestamps shown as `<serverTimestamp() at write time>`, Firestore auto ids as
`<auto-id…>`, roomNight ids are deterministic `{roomId}_{date}`), plus the room
update with each deleted field marked `<FieldValue.delete()>` — not just a
summary line.

**Occupied rooms with no guest data are NOT guessed.** An occupied legacy room
with *none* of the guest/stay fields is written to `needs-review.json` (repo
root, git-ignored; generated in both dry-run and apply) and **no** guest,
booking, roomNights or folio is created for it. The room still gets its
`roomTypeId` and normalised status. Handle these manually — create the guest +
CHECKED_IN booking through the app, which writes the roomNights locks and OPEN
folio — because until a booking exists there are **no roomNights**, so the
reservation engine considers the room bookable. Re-running leaves any room that
already has a booking in the new model untouched.

Removed from `Room`: `guestName`, `guestPhone`, `guestEmail`, `checkedInAt`,
`expectedCheckout`, `lastCheckedOutAt`, `activeGuestSessionId`.
(The schema named the first three; the other four are booking-derived and were
removed for the same reason — say the word if you want any kept.)

Re-runnable: rooms that already have a booking in the new model (or have
`roomTypeId` and no guest fields and are not occupied) are left alone, and
existing room types are reused rather than duplicated.

## Known gaps (deliberate — next iteration)

- **Room-night charges are not raised.** Folios open at 0 and stay there until
  F&B/service orders land. Night audit / posting room + tax charges is the next
  piece (the `ROOM` and `TAX` charge types already exist).
- **No payments UI.** The `payments` subcollection is in the schema and in the
  rules, but nothing writes it yet.
- **Early check-out doesn't release future nights.** Check-out marks the booking
  `CHECKED_OUT` but leaves its roomNights in place, so the room stays blocked
  until the original departure date. Cancel does release them. Needs a policy
  decision (release vs. keep for history).
- **Charge linkage is non-atomic.** If the client fails between writing the
  order and calling the charge endpoint, the folio misses that charge. Closing
  this properly needs a Cloud Function (Blaze) or a night-audit sweep.
- **No rate calendar.** `roomTypes.baseRate` is a single nightly rate — no
  seasons, packages or day-of-week pricing.
- **No modification flow.** Date/room changes are cancel + rebook.
