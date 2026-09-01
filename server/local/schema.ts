/**
 * Local (offline) schema — mirrors the Supabase production schema 1:1 for the
 * tables the app reads/writes, so the same frontend data layer works against
 * both backends. JSON columns are stored as TEXT and (de)serialized in store.ts.
 */

export interface TableDef {
  name: string;
  /** Columns stored as JSON text (jsonb in Postgres) — parsed on read. */
  jsonColumns: string[];
  /** Columns created by the server / read-only for the client. */
  readonlyColumns?: string[];
}

export const TABLES: TableDef[] = [
  { name: 'hotels', jsonColumns: ['branding', 'modules', 'staff_pins'] },
  { name: 'room_types', jsonColumns: ['amenities'] },
  { name: 'rooms', jsonColumns: [] },
  { name: 'guests', jsonColumns: [] },
  { name: 'bookings', jsonColumns: [] },
  { name: 'room_nights', jsonColumns: [] },
  { name: 'folios', jsonColumns: [] },
  { name: 'charges', jsonColumns: [] },
  { name: 'payments', jsonColumns: [] },
  { name: 'guest_sessions', jsonColumns: [] },
  { name: 'orders', jsonColumns: ['items', 'guest_feedback'] },
  { name: 'food_categories', jsonColumns: [] },
  { name: 'food_items', jsonColumns: ['variants'] },
  { name: 'service_categories', jsonColumns: [] },
  { name: 'services', jsonColumns: [] },
  { name: 'notifications', jsonColumns: [] },
  { name: 'audit_logs', jsonColumns: ['details'] },
];

export const JSON_COLUMNS: Record<string, string[]> = Object.fromEntries(
  TABLES.map((t) => [t.name, t.jsonColumns])
);

const UUID = 'TEXT PRIMARY KEY';
const hotelRef = (table = 'hotels') => `TEXT NOT NULL REFERENCES ${table}(id) ON DELETE CASCADE`;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS local_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS local_users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'hotel_admin',
  hotel_id      TEXT,
  display_name  TEXT NOT NULL DEFAULT '',
  email         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS local_sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotels (
  id              ${UUID},
  hotel_code      TEXT,
  name            TEXT NOT NULL,
  legal_name      TEXT,
  address         TEXT,
  city            TEXT,
  state           TEXT,
  country         TEXT,
  postal_code     TEXT,
  phone           TEXT,
  email           TEXT,
  owner_name      TEXT,
  owner_phone     TEXT,
  owner_whats_app TEXT,
  currency        TEXT NOT NULL DEFAULT 'INR',
  currency_symbol TEXT NOT NULL DEFAULT '₹',
  timezone        TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  status          TEXT NOT NULL DEFAULT 'active',
  login_email     TEXT,
  branding        TEXT NOT NULL DEFAULT '{}',
  modules         TEXT NOT NULL DEFAULT '{}',
  rooms_count     INTEGER,
  gst_percent     REAL NOT NULL DEFAULT 0,
  open_time       TEXT NOT NULL DEFAULT '00:00',
  close_time      TEXT NOT NULL DEFAULT '23:59',
  staff_pins      TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS room_types (
  id            ${UUID},
  hotel_id      ${hotelRef()},
  name          TEXT NOT NULL,
  base_rate     REAL NOT NULL DEFAULT 150,
  max_occupancy INTEGER NOT NULL DEFAULT 2,
  amenities     TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS room_types_hotel_idx ON room_types(hotel_id);

CREATE TABLE IF NOT EXISTS rooms (
  id              ${UUID},
  hotel_id        ${hotelRef()},
  room_number     TEXT NOT NULL,
  floor           INTEGER NOT NULL DEFAULT 0,
  room_type_id    TEXT,
  type            TEXT,
  capacity        INTEGER,
  status          TEXT NOT NULL DEFAULT 'available',
  permanent_token TEXT NOT NULL,
  photo_url       TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS rooms_hotel_idx ON rooms(hotel_id);
CREATE UNIQUE INDEX IF NOT EXISTS rooms_permanent_token_idx ON rooms(permanent_token);

CREATE TABLE IF NOT EXISTS guests (
  id                   ${UUID},
  hotel_id             ${hotelRef()},
  name                 TEXT NOT NULL,
  phone                TEXT NOT NULL DEFAULT '',
  email                TEXT,
  id_proof_type        TEXT,
  id_proof_number      TEXT,
  migrated_from_room_id TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS guests_hotel_idx ON guests(hotel_id);

CREATE TABLE IF NOT EXISTS bookings (
  id                  ${UUID},
  hotel_id            ${hotelRef()},
  guest_id            TEXT NOT NULL,
  room_id             TEXT NOT NULL,
  room_type_id        TEXT,
  check_in_date       TEXT NOT NULL,
  check_out_date      TEXT NOT NULL,
  actual_check_in_at  TEXT,
  actual_check_out_at TEXT,
  status              TEXT NOT NULL DEFAULT 'RESERVED',
  agreed_rate         REAL NOT NULL DEFAULT 0,
  num_guests          INTEGER NOT NULL DEFAULT 1,
  source              TEXT NOT NULL DEFAULT 'walk-in',
  created_by          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS bookings_hotel_idx ON bookings(hotel_id);
CREATE INDEX IF NOT EXISTS bookings_room_idx ON bookings(room_id);

CREATE TABLE IF NOT EXISTS room_nights (
  hotel_id   TEXT NOT NULL,
  room_id    TEXT NOT NULL,
  date       TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  PRIMARY KEY (room_id, date)
);
CREATE INDEX IF NOT EXISTS room_nights_date_idx ON room_nights(date);
CREATE INDEX IF NOT EXISTS room_nights_booking_idx ON room_nights(booking_id);

CREATE TABLE IF NOT EXISTS folios (
  id         TEXT PRIMARY KEY,
  hotel_id   TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'OPEN',
  balance    REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS folios_hotel_idx ON folios(hotel_id);

CREATE TABLE IF NOT EXISTS charges (
  id              ${UUID},
  hotel_id        TEXT NOT NULL,
  folio_id        TEXT NOT NULL,
  type            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  amount          REAL NOT NULL DEFAULT 0,
  source_order_id TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS charges_folio_idx ON charges(folio_id);
CREATE UNIQUE INDEX IF NOT EXISTS charges_source_order_idx ON charges(source_order_id) WHERE source_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payments (
  id          ${UUID},
  hotel_id    TEXT NOT NULL,
  folio_id    TEXT NOT NULL,
  amount      REAL NOT NULL,
  method      TEXT NOT NULL,
  received_by TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS guest_sessions (
  id           TEXT PRIMARY KEY,
  access_token TEXT NOT NULL UNIQUE,
  uid          TEXT NOT NULL,
  hotel_id     TEXT NOT NULL,
  room_id      TEXT NOT NULL,
  room_number  TEXT NOT NULL DEFAULT '',
  guest_name   TEXT NOT NULL DEFAULT '',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS guest_sessions_room_idx ON guest_sessions(room_id);

CREATE TABLE IF NOT EXISTS orders (
  id                        ${UUID},
  hotel_id                  TEXT NOT NULL,
  room_id                   TEXT,
  room_number               TEXT,
  guest_session_id          TEXT,
  guest_uid                 TEXT,
  guest_name                TEXT NOT NULL DEFAULT '',
  guest_phone               TEXT,
  type                      TEXT NOT NULL DEFAULT 'food',
  service_id                TEXT,
  service_name              TEXT,
  items                     TEXT NOT NULL DEFAULT '[]',
  total_amount              REAL NOT NULL DEFAULT 0,
  status                    TEXT NOT NULL DEFAULT 'NEW',
  priority                  TEXT,
  assigned_staff_id         TEXT,
  assigned_staff_name       TEXT,
  estimated_delivery_minutes INTEGER,
  reception_confirmed       INTEGER NOT NULL DEFAULT 0,
  call_confirmed_required   INTEGER NOT NULL DEFAULT 0,
  call_confirmed            INTEGER NOT NULL DEFAULT 0,
  call_guest_logged         INTEGER NOT NULL DEFAULT 0,
  special_notes             TEXT,
  instructions              TEXT,
  status_note               TEXT,
  guest_feedback            TEXT,
  department                TEXT,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at              TEXT
);
CREATE INDEX IF NOT EXISTS orders_hotel_created_idx ON orders(hotel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_guest_uid_idx ON orders(guest_uid);

CREATE TABLE IF NOT EXISTS food_categories (
  id            ${UUID},
  hotel_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS food_items (
  id                       ${UUID},
  hotel_id                 TEXT NOT NULL,
  category_id              TEXT,
  category                 TEXT,
  name                     TEXT NOT NULL,
  description              TEXT,
  image_url                TEXT,
  dietary                  TEXT,
  is_vegetarian            INTEGER,
  is_veg                   INTEGER,
  base_price               REAL,
  price                    REAL,
  variants                 TEXT NOT NULL DEFAULT '[]',
  is_available             INTEGER NOT NULL DEFAULT 1,
  prep_time_minutes        INTEGER,
  preparation_time_minutes INTEGER,
  display_order            INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS food_items_hotel_idx ON food_items(hotel_id);

CREATE TABLE IF NOT EXISTS service_categories (
  id            ${UUID},
  hotel_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  icon          TEXT,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id                     ${UUID},
  hotel_id               TEXT NOT NULL,
  category_id            TEXT,
  name                   TEXT NOT NULL,
  description            TEXT,
  price                  REAL NOT NULL DEFAULT 0,
  icon                   TEXT,
  estimated_time_minutes INTEGER,
  sla_minutes            INTEGER,
  is_available           INTEGER NOT NULL DEFAULT 1,
  requires_approval      INTEGER NOT NULL DEFAULT 0,
  requires_notes         INTEGER NOT NULL DEFAULT 0,
  display_order          INTEGER NOT NULL DEFAULT 0,
  department             TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS services_hotel_idx ON services(hotel_id);

CREATE TABLE IF NOT EXISTS notifications (
  id               ${UUID},
  hotel_id         TEXT NOT NULL,
  guest_session_id TEXT,
  target_role      TEXT,
  title            TEXT NOT NULL,
  message          TEXT NOT NULL DEFAULT '',
  type             TEXT,
  is_read          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS notifications_hotel_idx ON notifications(hotel_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         ${UUID},
  hotel_id   TEXT,
  user_id    TEXT,
  user_name  TEXT,
  user_role  TEXT,
  action     TEXT NOT NULL,
  details    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

/** Coerce SQLite storage values into the JS types the frontend expects. */
export function coerceRow(table: string, row: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!row) return row;
  const out: Record<string, unknown> = { ...row };
  for (const col of JSON_COLUMNS[table] || []) {
    const v = out[col];
    if (typeof v === 'string') {
      try {
        out[col] = JSON.parse(v);
      } catch {
        out[col] = v;
      }
    } else if (v === undefined || v === null) {
      out[col] = null;
    }
  }
  return out;
}
