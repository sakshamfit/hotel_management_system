/**
 * LocalStore — the offline "database" for one hotel installation.
 *
 * Holds the SQLite file + media folder, provisions it from a signed activation
 * payload, and implements the same operations the Supabase backend provides
 * (tables CRUD, the booking/charge/feedback RPCs, guest sessions, auth).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto, { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { openSqlite, type SqlDatabase } from './driver';
import { SCHEMA_SQL, TABLES, coerceRow } from './schema';
import { verifyActivationString, type LicensePayload } from './licensing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface LocalUser {
  id: string;
  username: string;
  role: string;
  hotelId: string | null;
  displayName: string;
  email: string;
}

export interface StaffInfo {
  user: LocalUser;
  hotel: Record<string, unknown> | null;
}

const BOOLEAN_COLUMNS: Record<string, string[]> = {
  guest_sessions: ['active'],
  orders: ['reception_confirmed', 'call_confirmed_required', 'call_confirmed', 'call_guest_logged'],
  food_items: ['is_vegetarian', 'is_veg', 'is_available'],
  services: ['is_available', 'requires_approval', 'requires_notes'],
  notifications: ['is_read'],
};

const TABLE_NAMES = new Set(TABLES.map((t) => t.name));

export class LocalStore {
  readonly dbPath: string;
  readonly mediaDir: string;
  readonly backupDir: string;
  private db: SqlDatabase;
  private columns: Map<string, string[]> = new Map();

  constructor(private dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dbPath = path.join(dataDir, 'nexora.db');
    this.mediaDir = path.join(dataDir, 'media');
    this.backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.db = openSqlite(this.dbPath);
    this.db.exec(SCHEMA_SQL);
    this.loadColumns();
  }

  private loadColumns(): void {
    for (const table of TABLE_NAMES) {
      const rows = this.db.prepare(`PRAGMA table_info(${table})`).all();
      this.columns.set(
        table,
        rows.map((r) => String(r.name))
      );
    }
    this.columns.set('local_users', ['id', 'username', 'password_hash', 'role', 'hotel_id', 'display_name', 'email', 'created_at']);
    this.columns.set('local_sessions', ['token', 'user_id', 'created_at', 'expires_at']);
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* ignore */
    }
  }

  // -------------------------------------------------------------------------
  // Meta
  // -------------------------------------------------------------------------
  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO local_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM local_meta WHERE key = ?').get(key);
    return row ? String(row.value) : null;
  }

  isActivated(): boolean {
    return !!this.getMeta('activated_at');
  }

  getActivationInfo(): { hotelName: string | null; code: string | null; activatedAt: string | null } {
    return {
      hotelName: this.getMeta('license_hotel_name'),
      code: this.getMeta('license_code'),
      activatedAt: this.getMeta('activated_at'),
    };
  }

  // -------------------------------------------------------------------------
  // Auth helpers
  // -------------------------------------------------------------------------
  static hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  static verifyPassword(password: string, stored: string): boolean {
    const [salt, expected] = String(stored || '').split(':');
    if (!salt || !expected) return false;
    const actual = scryptSync(password, salt, 64).toString('hex');
    const a = Buffer.from(actual, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // -------------------------------------------------------------------------
  // Activation
  // -------------------------------------------------------------------------
  /**
   * Provisions the installation from a signed activation string. Verifies the
   * Ed25519 signature (offline), then creates: hotels row, admin user, staff
   * session. Refuses to run twice (re-activation requires a fresh data dir).
   */
  activate(activationString: string, username: string, password: string): StaffInfo {
    if (this.isActivated()) {
      throw Object.assign(new Error('This installation is already activated.'), { code: 'license/already-activated' });
    }
    if (username.length < 3) throw Object.assign(new Error('Username must be at least 3 characters.'), { code: 'auth/weak-username' });
    if (password.length < 8) {
      throw Object.assign(new Error(`Password must be at least 8 characters (you entered ${password.length}).`), { code: 'auth/weak-password' });
    }

    let payload: LicensePayload;
    try {
      payload = verifyActivationString(activationString, '');
    } catch (err: any) {
      throw err; // LicenseError already carries a friendly message + code
    }

    if (payload.username !== username.trim().toLowerCase()) {
      throw Object.assign(
        new Error(`The username you entered does not match the one on this activation (${payload.username}).`),
        { code: 'license/username-mismatch' }
      );
    }
    if (!LocalStore.verifyPassword(password, payload.passwordHash)) {
      throw Object.assign(new Error('The password does not match this activation. Ask the seller to re-share the correct credentials.'), {
        code: 'license/password-mismatch',
      });
    }

    const hotelId = randomUUID();
    const userId = randomUUID();
    const now = new Date().toISOString();

    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO hotels (id, hotel_code, name, owner_name, email, status, currency, currency_symbol,
             timezone, branding, modules, staff_pins, gst_percent, open_time, close_time, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', 'INR', '₹', 'Asia/Kolkata', ?, ?, ?, 0, '00:00', '23:59', ?, ?)`
        )
        .run(
          hotelId,
          `NXR-${payload.code.split('-')[1] || '0000'}`,
          payload.hotelName,
          payload.ownerName,
          payload.email || null,
          '{}',
          '{}',
          '{}',
          now,
          now
        );

      this.db
        .prepare(
          `INSERT INTO local_users (id, username, password_hash, role, hotel_id, display_name, email, created_at)
           VALUES (?, ?, ?, 'hotel_admin', ?, ?, ?, ?)`
        )
        .run(
          userId,
          payload.username,
          payload.passwordHash,
          hotelId,
          `${payload.ownerName || 'Hotel'} — Owner`,
          payload.email || '',
          now
        );

      this.setMeta('activated_at', now);
      this.setMeta('license_code', payload.code);
      this.setMeta('license_hotel_name', payload.hotelName);
      this.setMeta('license_owner_name', payload.ownerName);
      this.setMeta('license_id', payload.id);
      this.setMeta('license_issued_at', payload.issuedAt);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    const user: LocalUser = { id: userId, username: payload.username, role: 'hotel_admin', hotelId, displayName: `${payload.ownerName || 'Hotel'} — Owner`, email: payload.email || '' };
    const token = this.createSession(userId);
    return { user, hotel: this.getRow('hotels', hotelId) };
  }

  // -------------------------------------------------------------------------
  // Staff sessions
  // -------------------------------------------------------------------------
  private createSession(userId: string): string {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    this.db.prepare('INSERT INTO local_sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
    return token;
  }

  login(username: string, password: string): { token: string; info: StaffInfo } {
    const row = this.db.prepare('SELECT * FROM local_users WHERE username = ?').get(username.trim().toLowerCase()) as
      | Record<string, unknown>
      | undefined;
    if (!row || !LocalStore.verifyPassword(password, String(row.password_hash || ''))) {
      throw Object.assign(new Error('Invalid username or password.'), { code: 'invalid_credentials' });
    }
    const user = this.toLocalUser(row);
    const token = this.createSession(user.id);
    return { token, info: { user, hotel: user.hotelId ? this.getRow('hotels', user.hotelId) : null } };
  }

  getStaffByToken(token: string): StaffInfo | null {
    const row = this.db
      .prepare(
        `SELECT u.* FROM local_sessions s JOIN local_users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`
      )
      .get(token, new Date().toISOString()) as Record<string, unknown> | undefined;
    if (!row) return null;
    const user = this.toLocalUser(row);
    return { user, hotel: user.hotelId ? this.getRow('hotels', user.hotelId) : null };
  }

  logout(token: string): void {
    this.db.prepare('DELETE FROM local_sessions WHERE token = ?').run(token);
  }

  changePassword(username: string, current: string, next: string): void {
    const row = this.db.prepare('SELECT * FROM local_users WHERE username = ?').get(username.toLowerCase()) as
      | Record<string, unknown>
      | undefined;
    if (!row || !LocalStore.verifyPassword(current, String(row.password_hash || ''))) {
      throw Object.assign(new Error('Current password is incorrect.'), { code: 'invalid_credentials' });
    }
    if (next.length < 8) throw Object.assign(new Error('Password must be at least 8 characters.'), { code: 'auth/weak-password' });
    this.db.prepare('UPDATE local_users SET password_hash = ? WHERE id = ?').run(LocalStore.hashPassword(next), String(row.id));
  }

  private toLocalUser(row: Record<string, unknown>): LocalUser {
    return {
      id: String(row.id),
      username: String(row.username || ''),
      role: String(row.role || 'hotel_admin'),
      hotelId: row.hotel_id ? String(row.hotel_id) : null,
      displayName: String(row.display_name || ''),
      email: String(row.email || ''),
    };
  }

  // -------------------------------------------------------------------------
  // Row CRUD (staff only — API layer enforces scoping)
  // -------------------------------------------------------------------------
  assertTable(table: string): void {
    if (!TABLE_NAMES.has(table) || table === 'guest_sessions') {
      // guest_sessions is managed server-side only.
      throw Object.assign(new Error(`Unknown or restricted table: ${table}`), { code: 'table/unknown' });
    }
  }

  private toStorage(table: string, row: Record<string, unknown>): Record<string, unknown> {
    const allowed = new Set(this.columns.get(table) || []);
    const out: Record<string, unknown> = {};
    for (const [rawKey, val] of Object.entries(row)) {
      if (val === undefined) continue;
      // Accept camelCase (app shape) or snake_case (row shape).
      const key = rawKey.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      if (!allowed.has(key)) continue;
      if ((JSON_COLUMNS_OF(table) || []).includes(key)) {
        out[key] = typeof val === 'string' ? val : JSON.stringify(val ?? null);
        continue;
      }
      if ((BOOLEAN_COLUMNS[table] || []).includes(key)) {
        out[key] = val ? 1 : 0;
        continue;
      }
      out[key] = val;
    }
    return out;
  }

  private toApp(table: string, row: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!row) return row;
    const out: Record<string, unknown> = { ...row };
    for (const col of JSON_COLUMNS_OF(table) || []) {
      const v = out[col];
      if (typeof v === 'string') {
        try {
          out[col] = JSON.parse(v);
        } catch {
          out[col] = v;
        }
      }
    }
    for (const col of BOOLEAN_COLUMNS[table] || []) {
      out[col] = out[col] ? true : false;
    }
    return out;
  }

  insertRow(table: string, row: Record<string, unknown>): string {
    this.assertTable(table);
    const storage = this.toStorage(table, { id: randomUUID(), ...row });
    const cols = Object.keys(storage);
    const placeholders = cols.map(() => '?').join(', ');
    this.db
      .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`)
      .run(...cols.map((c) => storage[c]));
    this.notify(table);
    return String(storage.id);
  }

  updateRow(table: string, id: string, patch: Record<string, unknown>): void {
    this.assertTable(table);
    const storage = this.toStorage(table, patch);
    const cols = Object.keys(storage);
    if (!cols.length) return;
    this.db
      .prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => storage[c]), id);
    this.notify(table);
  }

  deleteWhere(table: string, where: Record<string, unknown>): number {
    this.assertTable(table);
    const pairs = Object.entries(where).map(([k, v]) => [k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`), v]);
    if (!pairs.length) return 0;
    const res = this.db
      .prepare(`DELETE FROM ${table} WHERE ${pairs.map(([k]) => `${k} = ?`).join(' AND ')}`)
      .run(...pairs.map(([, v]) => v));
    if (res.changes > 0) this.notify(table);
    return res.changes;
  }

  getRow(table: string, id: string): Record<string, unknown> | null {
    this.assertTable(table);
    return (this.toApp(table, this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)) as Record<string, unknown>) || null;
  }

  getRowRaw(table: string, id: string): Record<string, unknown> | null {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    return row ? (row as Record<string, unknown>) : null;
  }

  query(table: string, opts: {
    hotelId?: string | null;
    filters?: Array<{ column: string; value: unknown; op?: string }>;
    orderBy?: string;
    ascending?: boolean;
    limit?: number;
  } = {}): Array<Record<string, unknown>> {
    this.assertTable(table);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.hotelId) {
      clauses.push('hotel_id = ?');
      params.push(opts.hotelId);
    }
    const OPS: Record<string, string> = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<', ne: '!=' };
    for (const f of opts.filters || []) {
      const op = OPS[f.op || 'eq'] || '=';
      const col = f.column.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      if (!(this.columns.get(table) || []).includes(col)) continue;
      clauses.push(`${col} ${op} ?`);
      params.push(f.value);
    }
    let sql = `SELECT * FROM ${table}`;
    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
    const orderCol = opts.orderBy ? opts.orderBy : null;
    if (orderCol && (this.columns.get(table) || []).includes(orderCol)) {
      sql += ` ORDER BY ${orderCol} ${opts.ascending === false ? 'DESC' : 'ASC'}`;
    }
    if (opts.limit && opts.limit > 0) sql += ` LIMIT ${Math.min(Math.floor(opts.limit), 1000)}`;
    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r) => this.toApp(table, r) as Record<string, unknown>);
  }

  // -------------------------------------------------------------------------
  // RPCs
  // -------------------------------------------------------------------------
  createBooking(args: {
    hotelId: string;
    guestId: string;
    roomId: string;
    roomTypeId?: string | null;
    checkInDate: string;
    checkOutDate: string;
    rate: number;
    numGuests?: number;
    source?: string;
    createdBy?: string;
  }): string {
    const { hotelId, guestId, roomId } = args;
    const { checkInDate, checkOutDate } = args;
    if (checkOutDate <= checkInDate) {
      throw Object.assign(new Error('Check-out must be after check-in.'), { code: 'booking/invalid-stay' });
    }
    if (args.rate < 0 || !Number.isFinite(args.rate)) {
      throw Object.assign(new Error('Agreed rate must be a positive number.'), { code: 'booking/invalid-rate' });
    }
    const conflict = this.db
      .prepare('SELECT date FROM room_nights WHERE room_id = ? AND date >= ? AND date < ? ORDER BY date')
      .all(args.roomId, checkInDate, checkOutDate);
    if (conflict.length) {
      const dates = conflict.map((r) => String(r.date)).sort();
      throw Object.assign(
        new Error(`Room is already booked for ${dates.length} night(s) (${dates.slice(0, 3).join(', ')}${dates.length > 3 ? '…' : ''}).`),
        { code: 'booking/room-not-available', conflictDates: dates }
      );
    }

    const bookingId = randomUUID();
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO bookings (id, hotel_id, guest_id, room_id, room_type_id, check_in_date, check_out_date,
             status, agreed_rate, num_guests, source, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?, ?, ?)`
        )
        .run(
          bookingId,
          hotelId,
          guestId,
          args.roomId,
          args.roomTypeId || null,
          checkInDate,
          checkOutDate,
          args.rate,
          args.numGuests || 1,
          args.source || 'walk-in',
          args.createdBy || '',
          now
        );

      // One room_nights row per night.
      const start = new Date(`${checkInDate}T00:00:00Z`);
      const end = new Date(`${checkOutDate}T00:00:00Z`);
      const insertNight = this.db.prepare('INSERT INTO room_nights (hotel_id, room_id, date, booking_id) VALUES (?, ?, ?, ?)');
      for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
        insertNight.run(hotelId, args.roomId, d.toISOString().slice(0, 10), bookingId);
      }

      this.db
        .prepare('INSERT INTO folios (id, hotel_id, booking_id, status, balance) VALUES (?, ?, ?, \'OPEN\', 0)')
        .run(bookingId, hotelId, bookingId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.notify('bookings');
    this.notify('room_nights');
    this.notify('folios');
    return bookingId;
  }

  /** Guest order → folio charge (idempotent per order). */
  postGuestOrderCharge(guestUid: string, orderId: string): { linked: boolean; reason?: string; chargeId?: string } {
    const order = this.db
      .prepare('SELECT * FROM orders WHERE id = ?')
      .get(orderId) as Record<string, unknown> | undefined;
    if (!order) return { linked: false, reason: 'order-not-found' };
    if (String(order.guest_uid || '') !== guestUid) return { linked: false, reason: 'forbidden' };
    const amount = Number(order.total_amount || 0);
    if (amount <= 0) return { linked: false, reason: 'zero-amount' };

    const existing = this.db.prepare('SELECT id FROM charges WHERE source_order_id = ?').get(orderId);
    if (existing) return { linked: true, reason: 'already-linked', chargeId: String(existing.id) };

    const session = this.db
      .prepare('SELECT * FROM guest_sessions WHERE uid = ? AND active = 1')
      .get(guestUid) as Record<string, unknown> | undefined;
    if (!session) return { linked: false, reason: 'not-scoped' };

    const booking = this.db
      .prepare(
        `SELECT * FROM bookings WHERE room_id = ? AND status = 'CHECKED_IN' ORDER BY check_in_date DESC LIMIT 1`
      )
      .get(String(session.room_id)) as Record<string, unknown> | undefined;
    if (!booking) return { linked: false, reason: 'no-active-booking' };

    const items = Array.isArray(order.items) ? (order.items as any[]) : [];
    const summary = items.length
      ? items
          .map((it) => `${it?.quantity || 1}x ${it?.name || 'Item'}`)
          .join(', ')
          .slice(0, 200)
      : String(order.type === 'service' ? 'Room service request' : 'In-room dining order');

    const chargeId = randomUUID();
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO charges (id, hotel_id, folio_id, type, description, amount, source_order_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          chargeId,
          String(session.hotel_id),
          String(booking.id),
          String(order.type === 'service' ? 'SERVICE' : 'FOOD'),
          summary,
          amount,
          orderId,
          now
        );
      this.db
        .prepare(
          `INSERT INTO folios (id, hotel_id, booking_id, status, balance) VALUES (?, ?, ?, 'OPEN', ?)
           ON CONFLICT(id) DO UPDATE SET balance = balance + excluded.balance`
        )
        .run(String(booking.id), String(session.hotel_id), String(booking.id), amount);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.notify('charges');
    this.notify('folios');
    return { linked: true, chargeId };
  }

  submitGuestOrderFeedback(guestUid: string, orderId: string, rating: number, comment: string): { ok: boolean; reason?: string } {
    if (!rating || rating < 1 || rating > 5) return { ok: false, reason: 'invalid-rating' };
    const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, unknown> | undefined;
    if (!order) return { ok: false, reason: 'order-not-found' };
    if (String(order.guest_uid || '') !== guestUid) return { ok: false, reason: 'forbidden' };
    if (!['COMPLETED', 'DELIVERED', 'completed', 'delivered'].includes(String(order.status))) {
      return { ok: false, reason: 'not-completed' };
    }
    const feedback = { rating, comment: (comment || '').slice(0, 500), submittedAt: new Date().toISOString() };
    this.db.prepare('UPDATE orders SET guest_feedback = ? WHERE id = ?').run(JSON.stringify(feedback), orderId);
    this.notify('orders');
    return { ok: true };
  }

  /** Creates the guest session row for a scanned QR token → claims. */
  openGuestSession(roomToken: string): {
    hotelId: string;
    roomId: string;
    roomNumber: string;
    guestName: string;
    uid: string;
    guestToken: string;
  } | null {
    const room = this.db
      .prepare('SELECT * FROM rooms WHERE permanent_token = ?')
      .get(roomToken.trim()) as Record<string, unknown> | undefined;
    if (!room) return null;
    const hotelId = String(room.hotel_id);
    const roomId = String(room.id);
    const booking = this.db
      .prepare(`SELECT * FROM bookings WHERE room_id = ? AND status = 'CHECKED_IN' ORDER BY check_in_date DESC LIMIT 1`)
      .get(roomId) as Record<string, unknown> | undefined;
    let guestName = '';
    if (booking?.guest_id) {
      const guest = this.db.prepare('SELECT name FROM guests WHERE id = ?').get(String(booking.guest_id)) as
        | { name?: string }
        | undefined;
      guestName = guest?.name || '';
    }
    const uid = `guest_${randomBytes(12).toString('hex')}`;
    const guestToken = randomBytes(32).toString('hex');
    this.db
      .prepare(
        `INSERT INTO guest_sessions (id, access_token, uid, hotel_id, room_id, room_number, guest_name, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(randomUUID(), guestToken, uid, hotelId, roomId, String(room.room_number || ''), guestName, new Date().toISOString());
    this.notify('guest_sessions');
    return { hotelId, roomId, roomNumber: String(room.room_number || ''), guestName, uid, guestToken };
  }

  getGuestByToken(guestToken: string): {
    uid: string;
    hotelId: string;
    roomId: string;
    roomNumber: string;
    guestName: string;
  } | null {
    const row = this.db
      .prepare('SELECT * FROM guest_sessions WHERE access_token = ? AND active = 1')
      .get(guestToken) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      uid: String(row.uid),
      hotelId: String(row.hotel_id),
      roomId: String(row.room_id),
      roomNumber: String(row.room_number || ''),
      guestName: String(row.guest_name || ''),
    };
  }

  // -------------------------------------------------------------------------
  // Media (local filesystem)
  // -------------------------------------------------------------------------
  saveMedia(relPath: string, dataUrl: string): string {
    const clean = relPath.replace(/^\/+/, '').replace(/\.\./g, '');
    if (!/^hotels\/[\w-]+\/(rooms|menu)\/[\w.-]+$/.test(clean)) {
      throw Object.assign(new Error('Invalid media path.'), { code: 'media/invalid-path' });
    }
    const matches = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '');
    if (!matches) throw Object.assign(new Error('Invalid image data.'), { code: 'media/invalid-data' });
    const filePath = path.join(this.mediaDir, clean);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
    this.notify('media');
    return `/local/media/${clean}`;
  }

  deleteMediaByUrl(url: string): void {
    const marker = '/local/media/';
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const rel = url.slice(idx + marker.length).replace(/\.\./g, '');
    const filePath = path.join(this.mediaDir, rel);
    if (filePath.startsWith(this.mediaDir) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    this.notify('media');
  }

  deleteMediaFolder(relPath: string): void {
    const clean = relPath.replace(/^\/+|\/+$/g, '').replace(/\.\./g, '');
    const dir = path.join(this.mediaDir, clean);
    if (dir.startsWith(this.mediaDir) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    this.notify('media');
  }

  mediaPathFor(relPath: string): string {
    const clean = relPath.replace(/^\/+/, '').replace(/\.\./g, '');
    return path.join(this.mediaDir, clean);
  }

  // -------------------------------------------------------------------------
  // Backup
  // -------------------------------------------------------------------------
  createBackup(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(this.backupDir, stamp);
    fs.mkdirSync(dir, { recursive: true });
    // WAL checkpoint keeps the copy consistent.
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* ignore */
    }
    fs.copyFileSync(this.dbPath, path.join(dir, 'nexora.db'));
    if (fs.existsSync(this.mediaDir)) {
      fs.cpSync(this.mediaDir, path.join(dir, 'media'), { recursive: true });
    }
    return dir;
  }

  // -------------------------------------------------------------------------
  // Change notification (SSE fan-out)
  // -------------------------------------------------------------------------
  private listeners = new Set<(tables: string[]) => void>();
  private dirty = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;

  subscribe(listener: (tables: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(...tables: string[]): void {
    for (const t of tables) this.dirty.add(t === 'media' ? 'media' : t);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const batch = Array.from(this.dirty);
      this.dirty.clear();
      for (const l of this.listeners) {
        try {
          l(batch);
        } catch {
          /* ignore */
        }
      }
    }, 120);
  }
}

function JSON_COLUMNS_OF(table: string): string[] {
  const def = TABLES.find((t) => t.name === table);
  return def ? def.jsonColumns : [];
}
