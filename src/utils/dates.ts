/**
 * Date handling for the reservation engine.
 *
 * Stays are date-only ("2026-09-01") and cover the HALF-OPEN interval
 * [checkInDate, checkOutDate) — the checkout day is not a night, so a guest
 * checking out on the 4th frees the room for someone arriving on the 4th.
 *
 * All arithmetic is done in UTC on the date-only value. Never construct these
 * strings from `new Date()` (local time) and never from `toISOString()` on a
 * local Date — both shift the day for anyone west/east of UTC, which silently
 * corrupts the roomNights lock.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateOnly(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Today as a date-only string, optionally in the hotel's timezone. */
export function todayDateOnly(timeZone?: string): string {
  const now = new Date();
  if (!timeZone) return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    return parts; // en-CA yields YYYY-MM-DD
  } catch {
    return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toUtcMs(dateOnly: string): number {
  return Date.parse(`${dateOnly}T00:00:00Z`);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Adds `days` to a date-only string. */
export function addDays(dateOnly: string, days: number): string {
  return fromUtcMs(toUtcMs(dateOnly) + days * 86_400_000);
}

/**
 * Every night the stay occupies: [checkInDate, checkOutDate).
 * A 1-night stay on 09-01 → 09-02 yields exactly ['2026-09-01'].
 */
export function enumerateNights(checkInDate: string, checkOutDate: string): string[] {
  const nights: string[] = [];
  let cursor = toUtcMs(checkInDate);
  const end = toUtcMs(checkOutDate);
  while (cursor < end) {
    nights.push(fromUtcMs(cursor));
    cursor += 86_400_000;
  }
  return nights;
}

export function nightsBetween(checkInDate: string, checkOutDate: string): number {
  return Math.max(0, Math.round((toUtcMs(checkOutDate) - toUtcMs(checkInDate)) / 86_400_000));
}

/**
 * A plain `{ ok, error }` result rather than a discriminated union: this
 * project does not run with `strictNullChecks`, so TS cannot narrow a
 * `{ok:true} | {ok:false; error}` union at the call site.
 */
export interface StayValidation {
  ok: boolean;
  error: string;
}

export function isValidStay(checkInDate: string, checkOutDate: string): StayValidation {
  if (!isValidDateOnly(checkInDate)) return { ok: false, error: 'Check-in date must be a valid YYYY-MM-DD date.' };
  if (!isValidDateOnly(checkOutDate)) return { ok: false, error: 'Check-out date must be a valid YYYY-MM-DD date.' };
  if (toUtcMs(checkOutDate) <= toUtcMs(checkInDate)) {
    return { ok: false, error: 'Check-out must be at least one night after check-in.' };
  }
  return { ok: true, error: '' };
}

/** Document id for a room-night lock: `{roomId}_{date}`. */
export function roomNightId(roomId: string, date: string): string {
  return `${roomId}_${date}`;
}

/** Coalesces Firestore Timestamp | ISO string | Date into a Date (or null). */
export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const maybe = value as { toDate?: () => Date; seconds?: number };
  if (typeof maybe?.toDate === 'function') return maybe.toDate();
  if (typeof maybe?.seconds === 'number') return new Date(maybe.seconds * 1000);
  return null;
}
