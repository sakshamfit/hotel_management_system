/**
 * NEXORA HOTEL OS — local demo backend.
 *
 * A small, self-contained implementation of the subset of the Supabase client
 * API this app uses (PostgREST-style queries, Auth, Realtime channels, Storage
 * metadata, and the two RPCs). It is used ONLY in demo mode — i.e. when real
 * Supabase credentials are not configured (see src/supabase/config.ts).
 *
 * Goals:
 *   • The app works end-to-end without any network/account setup.
 *   • Emulates the RLS behaviour the app relies on (staff hotel scoping,
 *     guest room scoping, guest-only order creation) well enough that the
 *     same UI code behaves as it does against Supabase.
 *   • Persists to localStorage so state survives reloads in the browser.
 *   • Every write emits postgres_changes events, so the realtime-driven
 *     subscriptions re-query just like they do against Supabase Realtime.
 *
 * Security note: this is explicit demo/dev-only scaffolding. When Supabase
 * credentials are present the real client is used and this module is inert.
 */

import { buildDemoSeed, buildDemoAuthUsers } from './demoSeed';
import type { DemoRow, DemoAuthUser, LocalError } from './localBackendTypes';

const STORAGE_VERSION = 'nexora.demo.v1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DemoSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  user: DemoAuthUser;
}

type Scope =
  | { kind: 'super_admin' }
  | { kind: 'hotel_admin'; hotelId: string }
  | { kind: 'guest'; uid: string; hotelId: string; roomId: string }
  | { kind: 'anon' };

interface ChangeListener {
  channelName: string;
  table: string;
  event: string; // '*', 'INSERT', ...
  filter?: string;
  cb: (payload: any) => void;
}

type AuthListener = (event: string, session: DemoSession | null) => void;

interface DemoState {
  tables: Record<string, DemoRow[]>;
  users: DemoAuthUser[];
  session: { token: string; userId: string } | null;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const hasStorage = typeof localStorage !== 'undefined';

function loadState(): DemoState {
  if (hasStorage) {
    try {
      const raw = localStorage.getItem(STORAGE_VERSION);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === STORAGE_VERSION && parsed.tables && parsed.users) {
          return { tables: parsed.tables, users: parsed.users, session: parsed.session || null };
        }
      }
    } catch {
      /* corrupted — fall through to fresh seed */
    }
  }
  return { tables: buildDemoSeed(), users: buildDemoAuthUsers(), session: null };
}

function saveState(state: DemoState): void {
  if (!hasStorage) return;
  try {
    localStorage.setItem(
      STORAGE_VERSION,
      JSON.stringify({ version: STORAGE_VERSION, tables: state.tables, users: state.users, session: state.session })
    );
  } catch {
    /* quota / private mode — demo keeps working in memory */
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(state: DemoState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(state), 120);
}

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

function makeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const state = loadState();

// Tables without a created_at column in the migration.
const NO_CREATED_AT = new Set(['room_nights', 'folios']);

function directInsert(table: string, row: DemoRow, opts: { emit?: boolean } = {}): DemoRow {
  const rows = state.tables[table] || (state.tables[table] = []);
  const final = { ...row };
  if (final.id === undefined) final.id = uuid();
  if (!NO_CREATED_AT.has(table) && final.created_at === undefined) final.created_at = nowIso();
  if ((table === 'hotels' || table === 'orders') && final.updated_at === undefined) final.updated_at = nowIso();
  rows.push(final);
  scheduleSave(state);
  if (opts.emit !== false) emitChange('INSERT', table, final, null);
  return final;
}

function directUpdate(table: string, id: string, patch: DemoRow): DemoRow | null {
  const rows = state.tables[table] || [];
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const old = rows[idx];
  const next = { ...old, ...patch, updated_at: nowIso() };
  rows[idx] = next;
  scheduleSave(state);
  emitChange('UPDATE', table, next, old);
  return next;
}

function directDelete(table: string, id: string): DemoRow | null {
  const rows = state.tables[table] || [];
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const [removed] = rows.splice(idx, 1);
  scheduleSave(state);
  emitChange('DELETE', table, removed, removed);
  return removed;
}

function findRow(table: string, id: string): DemoRow | null {
  return (state.tables[table] || []).find((r) => r.id === id) || null;
}

// ---------------------------------------------------------------------------
// Realtime channels
// ---------------------------------------------------------------------------

const changeListeners: ChangeListener[] = [];
const authListeners: AuthListener[] = [];

function emitChange(event: 'INSERT' | 'UPDATE' | 'DELETE', table: string, record: DemoRow, old: DemoRow | null): void {
  const eventType = event as string;
  for (const l of changeListeners) {
    if (l.table !== table) continue;
    if (l.event !== '*' && l.event !== eventType) continue;
    if (l.filter) {
      const matched = matchesFilter(l.filter, record);
      if (!matched) continue;
    }
    l.cb({
      eventType,
      schema: 'public',
      table,
      record,
      old_record: old,
      commit_timestamp: nowIso(),
    });
  }
}

function matchesFilter(filter: string, record: DemoRow | null): boolean {
  // Only supports the `column=eq.value` postgres_changes filters we emit.
  const m = filter.match(/^([a-z_]+)=eq\.(.+)$/i);
  if (!m) return true;
  try {
    return record != null && String(record[m[1]]) === decodeURIComponent(m[2]);
  } catch {
    return true;
  }
}

function emitAuthChange(event: string, session: DemoSession | null): void {
  for (const l of authListeners) l(event, session);
}

// ---------------------------------------------------------------------------
// Scope (RLS emulation)
// ---------------------------------------------------------------------------

function getUserByToken(token: string | null): DemoAuthUser | null {
  if (!token || !state.session || state.session.token !== token) return null;
  return state.users.find((u) => u.id === state.session?.userId) || null;
}

function currentUser(): DemoAuthUser | null {
  return getUserByToken(state.session?.token || null);
}

function activeGuestSession(uid: string): DemoRow | null {
  return (
    (state.tables.guest_sessions || []).find((g) => g.id === uid && g.active === true) || null
  );
}

function resolveScope(): Scope {
  const user = currentUser();
  if (!user) return { kind: 'anon' };
  if (user.is_anonymous) {
    const gs = activeGuestSession(user.id);
    if (!gs) return { kind: 'anon' };
    return { kind: 'guest', uid: user.id, hotelId: gs.hotel_id, roomId: gs.room_id };
  }
  const profile = (state.tables.profiles || []).find((p) => p.id === user.id);
  if (profile?.role === 'super_admin') return { kind: 'super_admin' };
  if (profile?.role === 'hotel_admin' && profile.hotel_id) {
    return { kind: 'hotel_admin', hotelId: profile.hotel_id };
  }
  return { kind: 'anon' };
}

/** Mirrors the RLS read rules from supabase/migrations/0001_init.sql. */
function canRead(table: string, row: DemoRow, scope: Scope): boolean {
  if (scope.kind === 'super_admin') return true;
  if (scope.kind === 'hotel_admin') {
    if (table === 'profiles') return true; // staff may read profiles (is_staff())
    if (table === 'hotels') return row.id === scope.hotelId;
    if (table === 'guest_sessions') return false;
    return row.hotel_id === scope.hotelId;
  }
  if (scope.kind === 'guest') {
    switch (table) {
      case 'rooms':
        return row.id === scope.roomId;
      case 'hotels':
        return row.id === scope.hotelId;
      case 'food_items':
      case 'services':
        return row.hotel_id === scope.hotelId;
      case 'orders':
        return row.guest_uid === scope.uid;
      case 'guest_sessions':
        return row.id === scope.uid;
      default:
        return false;
    }
  }
  return false;
}

/** Mirrors the RLS write rules. Guests may only create their own orders. */
function canWriteInsert(table: string, row: DemoRow, scope: Scope): boolean {
  if (scope.kind === 'super_admin') return true;
  if (scope.kind === 'hotel_admin') {
    if (table === 'profiles' || table === 'guest_sessions') return false;
    if (table === 'hotels') return row.id === scope.hotelId;
    return row.hotel_id === scope.hotelId;
  }
  if (scope.kind === 'guest') {
    if (table !== 'orders') return false;
    return (
      row.guest_uid === scope.uid &&
      row.hotel_id === scope.hotelId &&
      (row.room_id === undefined || row.room_id === null || row.room_id === scope.roomId)
    );
  }
  return false;
}

function canWriteRow(table: string, row: DemoRow, scope: Scope): boolean {
  if (scope.kind === 'super_admin') return true;
  if (scope.kind === 'hotel_admin') {
    if (table === 'profiles' || table === 'guest_sessions') return false;
    if (table === 'hotels') return row.id === scope.hotelId;
    return row.hotel_id === scope.hotelId;
  }
  return false; // guests never update/delete
}

// ---------------------------------------------------------------------------
// Query building (PostgREST-style)
// ---------------------------------------------------------------------------

interface FilterOp {
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  column: string;
  value: unknown;
}

function applyMatch(row: DemoRow, op: FilterOp): boolean {
  const a = row[op.column];
  const b = op.value;
  switch (op.op) {
    case 'eq':
      return String(a ?? '') === String(b ?? '');
    case 'neq':
      return String(a ?? '') !== String(b ?? '');
    case 'gt':
      return a != null && b != null && Number(a) > Number(b);
    case 'gte':
      return a != null && b != null && Number(a) >= Number(b);
    case 'lt':
      return a != null && b != null && Number(a) < Number(b);
    case 'lte':
      return a != null && b != null && Number(a) <= Number(b);
    case 'in':
      return Array.isArray(b) && b.map(String).includes(String(a ?? ''));
    default:
      return true;
  }
}

class LocalQuery {
  private filters: FilterOp[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private action: 'insert' | 'update' | 'delete' | 'select' = 'select';
  private insertData: DemoRow | null = null;
  private updateData: DemoRow | null = null;
  private wantSelect = false;
  private singleMode: 'none' | 'maybe' | 'single' = 'none';

  constructor(
    private backend: LocalSupabaseClient,
    private table: string
  ) {}

  select(_columns = '*'): this {
    this.wantSelect = true;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ op: 'eq', column, value });
    return this;
  }

  neq = (column: string, value: unknown): this => {
    this.filters.push({ op: 'neq', column, value });
    return this;
  };

  gt = (column: string, value: unknown): this => {
    this.filters.push({ op: 'gt', column, value });
    return this;
  };

  gte = (column: string, value: unknown): this => {
    this.filters.push({ op: 'gte', column, value });
    return this;
  };

  lt = (column: string, value: unknown): this => {
    this.filters.push({ op: 'lt', column, value });
    return this;
  };

  lte = (column: string, value: unknown): this => {
    this.filters.push({ op: 'lte', column, value });
    return this;
  };

  in = (column: string, value: unknown[]): this => {
    this.filters.push({ op: 'in', column, value });
    return this;
  };

  order(column: string, opts: { ascending?: boolean } = {}): this {
    this.orderBy = { column, ascending: opts.ascending ?? true };
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  maybeSingle(): this {
    this.singleMode = 'maybe';
    return this;
  }

  single(): this {
    this.singleMode = 'single';
    return this;
  }

  insert(data: DemoRow): this {
    this.action = 'insert';
    this.insertData = data || {};
    return this;
  }

  update(data: DemoRow): this {
    this.action = 'update';
    this.updateData = data || {};
    return this;
  }

  delete(): this {
    this.action = 'delete';
    return this;
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private run(): Promise<{ data: any; error: LocalError | null }> {
    const scope = resolveScope();
    const table = this.table;
    const rows = state.tables[table] || [];
    const matches = (row: DemoRow) => this.filters.every((f) => applyMatch(row, f));

    // ---- INSERT ----------------------------------------------------------
    if (this.action === 'insert') {
      const row = { ...(this.insertData || {}) } as DemoRow;
      if (!canWriteInsert(table, row, scope)) {
        return Promise.resolve({
          data: null,
          error: { message: 'new row violates row-level security policy', code: '42501' },
        });
      }
      const saved = directInsert(table, row);
      return Promise.resolve({ data: this.wantSelect ? saved : null, error: null });
    }

    // ---- UPDATE ----------------------------------------------------------
    if (this.action === 'update') {
      const targets = rows.filter((r) => matches(r) && canRead(table, r, scope) && canWriteRow(table, r, scope));
      for (const t of targets) directUpdate(table, t.id, this.updateData || {});
      return Promise.resolve({ data: null, error: null });
    }

    // ---- DELETE ----------------------------------------------------------
    if (this.action === 'delete') {
      const targets = rows.filter((r) => matches(r) && canRead(table, r, scope) && canWriteRow(table, r, scope));
      for (const t of targets) directDelete(table, t.id);
      return Promise.resolve({ data: null, error: null });
    }

    // ---- SELECT ----------------------------------------------------------
    let out = rows.filter((r) => canRead(table, r, scope) && matches(r));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      out = [...out].sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return ascending ? cmp : -cmp;
      });
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);

    if (this.singleMode === 'maybe') {
      return Promise.resolve({ data: out[0] ?? null, error: null });
    }
    if (this.singleMode === 'single') {
      if (out.length === 0) {
        return Promise.resolve({
          data: null,
          error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
        });
      }
      return Promise.resolve({ data: out[0], error: null });
    }
    return Promise.resolve({ data: out, error: null });
  }
}

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------

function rpcCreateBooking(params: Record<string, any>): Promise<{ data: any; error: LocalError | null }> {
  const scope = resolveScope();
  if (scope.kind !== 'super_admin' && scope.kind !== 'hotel_admin') {
    return Promise.resolve({ data: null, error: { message: 'booking/forbidden', code: '42501' } });
  }
  const hotelId = String(params.p_hotel_id || '');
  const roomId = String(params.p_room_id || '');
  const checkIn = String(params.p_check_in || '');
  const checkOut = String(params.p_check_out || '');
  const rate = Number(params.p_rate) || 0;

  if (scope.kind === 'hotel_admin' && scope.hotelId !== hotelId) {
    return Promise.resolve({ data: null, error: { message: 'booking/forbidden', code: '42501' } });
  }
  if (!checkOut || !checkIn || checkOut <= checkIn) {
    return Promise.resolve({ data: null, error: { message: 'booking/invalid-stay', code: '23514' } });
  }
  if (rate < 0 || !Number.isFinite(rate)) {
    return Promise.resolve({ data: null, error: { message: 'booking/invalid-rate', code: '23514' } });
  }

  const clash = (state.tables.room_nights || []).some(
    (rn) => rn.room_id === roomId && String(rn.date) >= checkIn && String(rn.date) < checkOut
  );
  if (clash) {
    return Promise.resolve({ data: null, error: { message: 'booking/room-not-available', code: '23P01' } });
  }

  const bookingId = uuid();
  const booking = {
    id: bookingId,
    hotel_id: hotelId,
    guest_id: String(params.p_guest_id || ''),
    room_id: roomId,
    room_type_id: params.p_room_type_id ? String(params.p_room_type_id) : null,
    check_in_date: checkIn,
    check_out_date: checkOut,
    actual_check_in_at: null,
    actual_check_out_at: null,
    status: 'RESERVED',
    agreed_rate: rate,
    num_guests: Number(params.p_num_guests) || 1,
    source: String(params.p_source || 'walk-in'),
    created_by: String(params.p_created_by || 'unknown'),
    created_at: nowIso(),
  };
  directInsert('bookings', booking);

  // room nights: [checkIn, checkOut)
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    directInsert('room_nights', { hotel_id: hotelId, room_id: roomId, date: d.toISOString().slice(0, 10), booking_id: bookingId });
  }

  directInsert('folios', { id: bookingId, hotel_id: hotelId, booking_id: bookingId, status: 'OPEN', balance: 0 });
  return Promise.resolve({ data: bookingId, error: null });
}

/** Replicates public.post_guest_order_charge() from the migration. */
function localPostGuestOrderCharge(orderId: string): Promise<Record<string, any>> {
  const scope = resolveScope();
  if (scope.kind !== 'guest') return Promise.resolve({ linked: false, reason: 'not-scoped' });

  const order = (state.tables.orders || []).find((o) => o.id === orderId && o.hotel_id === scope.hotelId);
  if (!order) return Promise.resolve({ linked: false, reason: 'order-not-found' });
  if (String(order.guest_uid || '') !== scope.uid || order.room_id !== scope.roomId) {
    return Promise.resolve({ linked: false, reason: 'forbidden' });
  }
  const amount = Number(order.total_amount) || 0;
  if (amount <= 0) return Promise.resolve({ linked: false, reason: 'zero-amount' });

  const existing = (state.tables.charges || []).find((c) => c.source_order_id === orderId);
  if (existing) return Promise.resolve({ linked: true, reason: 'already-linked' });

  const booking = (state.tables.bookings || [])
    .filter((b) => b.room_id === scope.roomId && b.status === 'CHECKED_IN')
    .sort((a, b) => String(b.check_in_date).localeCompare(String(a.check_in_date)))[0];
  if (!booking) return Promise.resolve({ linked: false, reason: 'no-active-booking' });

  const isService = order.type === 'service';
  const items = Array.isArray(order.items) ? order.items : [];
  const description =
    items.length > 0
      ? items.map((it: any) => `${it.quantity ?? 1}x ${it.name || 'Item'}`).join(', ').slice(0, 200)
      : isService
        ? 'Room service request'
        : 'In-room dining order';

  const charge = directInsert('charges', {
    hotel_id: scope.hotelId,
    folio_id: booking.id,
    type: isService ? 'SERVICE' : 'FOOD',
    description,
    amount,
    source_order_id: orderId,
    created_at: nowIso(),
  });

  const folio = (state.tables.folios || []).find((f) => f.id === booking.id);
  if (folio) {
    directUpdate('folios', booking.id, { balance: (Number(folio.balance) || 0) + amount });
  }
  return Promise.resolve({ linked: true, chargeId: charge.id });
}

/** Replicates public.submit_guest_order_feedback() from the 0002 migration. */
function localSubmitGuestOrderFeedback(orderId: string, rating: number, comment: string): Promise<Record<string, any>> {
  const scope = resolveScope();
  if (scope.kind !== 'guest') return Promise.resolve({ ok: false, reason: 'not-scoped' });
  if (!rating || rating < 1 || rating > 5) return Promise.resolve({ ok: false, reason: 'invalid-rating' });

  const order = (state.tables.orders || []).find((o) => o.id === orderId && o.hotel_id === scope.hotelId);
  if (!order) return Promise.resolve({ ok: false, reason: 'order-not-found' });
  if (String(order.guest_uid || '') !== scope.uid || order.room_id !== scope.roomId) {
    return Promise.resolve({ ok: false, reason: 'forbidden' });
  }
  if (!['COMPLETED', 'DELIVERED'].includes(String(order.status || '').toUpperCase())) {
    return Promise.resolve({ ok: false, reason: 'not-completed' });
  }

  directUpdate('orders', orderId, {
    guest_feedback: { rating, comment: (comment || '').slice(0, 500), submittedAt: nowIso() },
  });
  return Promise.resolve({ ok: true });
}

// ---------------------------------------------------------------------------
// Demo-mode helpers used by guestSession/firestoreService (service-role stand-ins)
// ---------------------------------------------------------------------------

function localFindRoomByToken(roomToken: string): DemoRow | null {
  return (state.tables.rooms || []).find((r) => r.permanent_token === roomToken) || null;
}

function localOpenGuestSession(roomToken: string, uid: string): Record<string, any> | null {
  const room = localFindRoomByToken(roomToken);
  if (!room) return null;

  const booking = (state.tables.bookings || [])
    .filter((b) => b.room_id === room.id && b.status === 'CHECKED_IN')
    .sort((a, b) => String(b.check_in_date).localeCompare(String(a.check_in_date)))[0];
  const guest = booking?.guest_id ? findRow('guests', booking.guest_id) : null;

  const row = (state.tables.guest_sessions || []).find((g) => g.id === uid);
  if (row) {
    directUpdate('guest_sessions', uid, {
      hotel_id: room.hotel_id,
      room_id: room.id,
      room_number: room.room_number,
      guest_name: guest?.name || '',
      active: true,
    });
  } else {
    directInsert('guest_sessions', {
      id: uid,
      hotel_id: room.hotel_id,
      room_id: room.id,
      room_number: room.room_number || '',
      guest_name: guest?.name || '',
      active: true,
      created_at: nowIso(),
    });
  }
  return {
    hotelId: room.hotel_id,
    roomId: room.id,
    roomNumber: room.room_number || '',
    guestName: guest?.name || '',
  };
}

function localCreateHotelUser(args: {
  hotelId: string;
  hotelName: string;
  email: string;
  password: string;
  name?: string;
  phone?: string;
}): Promise<Record<string, any>> {
  const email = args.email.toLowerCase().trim();
  const existing = state.users.find((u) => (u.email || '').toLowerCase() === email);
  const displayName = args.name || `${args.hotelName} Admin`;

  let uid: string;
  let isNew = false;
  if (existing) {
    uid = existing.id;
    existing.password = args.password;
    existing.user_metadata = { display_name: displayName, ...(args.phone ? { phone: args.phone } : {}) };
    existing.updated_at = nowIso();
  } else {
    uid = uuid();
    isNew = true;
    state.users.push({
      id: uid,
      email,
      password: args.password,
      is_anonymous: false,
      role: 'authenticated',
      user_metadata: { display_name: displayName, ...(args.phone ? { phone: args.phone } : {}) },
      app_metadata: { provider: 'email' },
      created_at: nowIso(),
      updated_at: nowIso(),
      confirmed_at: nowIso(),
    });
  }

  const profile = (state.tables.profiles || []).find((p) => p.id === uid);
  if (profile) {
    directUpdate('profiles', uid, {
      role: 'hotel_admin',
      hotel_id: args.hotelId,
      email,
      display_name: displayName,
      phone: args.phone || '',
    });
  } else {
    directInsert('profiles', {
      id: uid,
      role: 'hotel_admin',
      hotel_id: args.hotelId,
      email,
      display_name: displayName,
      phone: args.phone || '',
      created_at: nowIso(),
    });
  }

  const hotel = (state.tables.hotels || []).find((h) => h.id === args.hotelId);
  if (hotel) directUpdate('hotels', args.hotelId, { login_email: email });
  scheduleSave(state);

  return Promise.resolve({
    success: true,
    isNew,
    uid,
    email,
    hotelId: args.hotelId,
    role: 'hotel_admin',
    message: `Hotel admin ${email} created/updated for hotel ${args.hotelId}`,
  });
}

function localDeleteHotelUser(email: string): Promise<Record<string, any>> {
  const user = state.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase().trim());
  if (user) {
    directDelete('profiles', user.id);
    const idx = state.users.findIndex((u) => u.id === user.id);
    if (idx !== -1) state.users.splice(idx, 1);
    if (state.session?.userId === user.id) state.session = null;
    scheduleSave(state);
  }
  return Promise.resolve({ success: true, message: 'User deleted (or was already absent).' });
}

function localResetPassword(_email: string): Promise<Record<string, any>> {
  // Demo mode has no mail provider; passwords are set by the admin UI.
  return Promise.resolve({});
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

function publicUser(user: DemoAuthUser): Record<string, any> {
  return {
    id: user.id,
    aud: 'authenticated',
    role: user.role,
    email: user.email || undefined,
    email_confirmed_at: user.confirmed_at || null,
    confirmed_at: user.confirmed_at || null,
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
    identities: [],
    created_at: user.created_at,
    updated_at: user.updated_at,
    is_anonymous: user.is_anonymous,
  };
}

function buildSession(user: DemoAuthUser): DemoSession {
  const token = makeToken();
  state.session = { token, userId: user.id };
  scheduleSave(state);
  return {
    access_token: token,
    refresh_token: makeToken(),
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  };
}

function currentSession(): DemoSession | null {
  const user = currentUser();
  if (!user) return null;
  return {
    access_token: state.session!.token,
    refresh_token: `${state.session!.token}-r`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  };
}

const authApi = {
  getSession: async () => ({ data: { session: currentSession() }, error: null }),

  getUser: async (token?: string) => {
    const user = token ? getUserByToken(token) : currentUser();
    return { data: { user: user ? publicUser(user) : null }, error: null };
  },

  onAuthStateChange: (cb: AuthListener) => {
    authListeners.push(cb);
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            const i = authListeners.indexOf(cb);
            if (i !== -1) authListeners.splice(i, 1);
          },
        },
      },
    };
  },

  signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
    const user = state.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase().trim());
    if (!user || user.password !== password) {
      return {
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials', code: 'invalid_credentials' } as LocalError,
      };
    }
    const session = buildSession(user);
    queueMicrotask(() => emitAuthChange('SIGNED_IN', session));
    return { data: { user: publicUser(user), session }, error: null };
  },

  signInAnonymously: async () => {
    const user: DemoAuthUser = {
      id: uuid(),
      email: null,
      password: '',
      is_anonymous: true,
      role: 'authenticated',
      user_metadata: { display_name: 'In-Room Guest' },
      app_metadata: { provider: 'anonymous', is_anonymous: true },
      created_at: nowIso(),
      updated_at: nowIso(),
      confirmed_at: null,
    };
    state.users.push(user);
    const session = buildSession(user);
    queueMicrotask(() => emitAuthChange('SIGNED_IN', session));
    return { data: { user: publicUser(user), session }, error: null };
  },

  signOut: async () => {
    state.session = null;
    scheduleSave(state);
    queueMicrotask(() => emitAuthChange('SIGNED_OUT', null));
    return { error: null };
  },

  resetPasswordForEmail: async (email: string) => {
    await localResetPassword(email);
    return { data: {}, error: null };
  },

  signInWithOAuth: async () => ({
    data: { provider: 'google', url: '' },
    error: {
      message:
        'Google sign-in is only available with a real Supabase project. In demo mode sign in with a demo email/password below.',
      code: 'oauth/demo-unavailable',
    } as LocalError,
  }),
};

// ---------------------------------------------------------------------------
// Storage metadata (the demo HTTP endpoint is served by server.ts)
// ---------------------------------------------------------------------------

const trackedUploads = new Set<string>();

const storageApi = {
  from: (bucket: string) => ({
    getPublicUrl: (path: string) => ({
      data: { publicUrl: `/demo-storage/${String(path).replace(/^\/+/, '')}` },
    }),
    list: async (prefix: string) => {
      const clean = prefix.replace(/^\/+|\/+$/g, '');
      const files = [...trackedUploads]
        .filter((p) => p.startsWith(clean ? `${clean}/` : ''))
        .map((p) => ({ name: p.slice(clean ? clean.length + 1 : 0), id: p }));
      return { data: files, error: null };
    },
    remove: async (paths: string[]) => {
      for (const p of paths) trackedUploads.delete(String(p).replace(/^\/+/, ''));
      return { data: paths.map((p) => ({ name: p })), error: null };
    },
    upload: async (path: string) => {
      trackedUploads.add(String(path).replace(/^\/+/, ''));
      return { data: { path: null }, error: null };
    },
  }),
};

// ---------------------------------------------------------------------------
// Client surface
// ---------------------------------------------------------------------------

export interface LocalChannel {
  name: string;
  on: (type: string, filter: { event?: string; schema?: string; table: string }, cb: (payload: any) => void) => LocalChannel;
  subscribe: (cb?: (status: string) => void) => LocalChannel;
  unsubscribe: () => void;
}

export class LocalSupabaseClient {
  from(table: string): LocalQuery {
    return new LocalQuery(this, table);
  }

  rpc(fn: string, params: Record<string, any> = {}): Promise<{ data: any; error: LocalError | null }> {
    if (fn === 'create_booking') return rpcCreateBooking(params);
    if (fn === 'post_guest_order_charge') {
      return localPostGuestOrderCharge(String(params.p_order_id || '')).then((data) => ({ data, error: null }));
    }
    if (fn === 'submit_guest_order_feedback') {
      return localSubmitGuestOrderFeedback(
        String(params.p_order_id || ''),
        Number(params.p_rating) || 0,
        String(params.p_comment || '')
      ).then((data) => ({ data, error: null }));
    }
    return Promise.resolve({ data: null, error: { message: `Unknown RPC: ${fn}` } });
  }

  channel(name: string): LocalChannel {
    const listeners: ChangeListener[] = [];
    const ch: LocalChannel = {
      name,
      on: (type, filter, cb) => {
        listeners.push({
          channelName: name,
          table: filter.table,
          event: filter.event ?? '*',
          filter: (filter as any).filter,
          cb,
        });
        return ch;
      },
      subscribe: (cb) => {
        changeListeners.push(...listeners);
        queueMicrotask(() => cb?.('SUBSCRIBED'));
        return ch;
      },
      unsubscribe: () => {
        for (let i = changeListeners.length - 1; i >= 0; i--) {
          if (changeListeners[i].channelName === name) changeListeners.splice(i, 1);
        }
      },
    };
    return ch;
  }

  removeChannel(ch: LocalChannel): Promise<void> {
    ch.unsubscribe();
    return Promise.resolve();
  }

  auth = authApi;
  storage = storageApi;
}

/** Singleton matching the app's existing import pattern. */
export const localSupabase = new LocalSupabaseClient();

export const demoBackend = {
  /** @see localOpenGuestSession */
  openGuestSession: localOpenGuestSession,
  findRoomByToken: localFindRoomByToken,
  createHotelUser: localCreateHotelUser,
  deleteHotelUser: localDeleteHotelUser,
  postGuestOrderCharge: localPostGuestOrderCharge,
  resetPassword: localResetPassword,
};

// Re-export seed constants the UI uses to show demo credentials.
export { DEMO_SUPER_ADMIN_EMAIL, DEMO_SUPER_ADMIN_PASSWORD, DEMO_HOTEL_ADMIN_EMAIL, DEMO_HOTEL_ADMIN_PASSWORD } from './demoSeed';
