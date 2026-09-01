import { supabase } from '../supabase/config';
import {
  isLocalMode,
  localFetchRows,
  localFetchRow,
  localInsertRow,
  localUpdateRow,
  localDeleteRow,
  localRpc,
  subscribeLocal,
  getStaffToken,
  type LocalFilter,
} from './local/localApi';

/**
 * Small data-access helpers over supabase-js that give the rest of the app a
 * Firestore-like API (subscribe / add / update / delete on a tenant table).
 *
 * Every function transparently switches between:
 *   • Supabase (cloud/hosted edition) — original behaviour, RLS-protected, and
 *   • the local SQLite backend (desktop edition) — same shapes, same filters.
 *
 * Mapping rules (shared by both backends):
 *   • snake_case Postgres/SQLite columns ↔ camelCase app objects,
 *   • ISO-string timestamps (createdAt etc.) instead of Timestamps,
 *   • row `id` folded into the returned object,
 *   • initial fetch + realtime changes delivered through one callback,
 *   • an optional hotel filter on top-level tenant tables.
 */

/** Realtime subscription teardown function (matches the old Firestore Unsubscribe). */
export type UnsubscribeShim = () => void;

type Unsubscribe = () => void;

// Columns that store a Postgres timestamp and must be returned as ISO strings.
const TS_COLUMNS = new Set([
  'created_at', 'updated_at', 'completed_at',
  'actual_check_in_at', 'actual_check_out_at', 'received_at',
]);

function camelize(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function rowToObject<T = any>(row: Record<string, any> | null | undefined): T | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null) {
      if (v === null && (k === 'email' || k === 'actual_check_out_at' || k === 'actual_check_in_at')) {
        out[camelize(k)] = null;
      }
      continue;
    }
    if (TS_COLUMNS.has(k)) {
      out[camelize(k)] = typeof v === 'string' ? v : new Date(v as string).toISOString();
    } else {
      out[camelize(k)] = v;
    }
  }
  return out as T;
}

/** App object (camelCase, maybe extra fields) → Postgres row (snake_case). */
export function objectToRow(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    // camelCase → snake_case for known multi-word fields.
    const col = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    out[col] = v;
  }
  return out;
}

export interface SubscribeOptions {
  /** Tenant filter: WHERE hotel_id = ?. Set for every subcollection-style table. */
  hotelId?: string;
  /** Ordering column (snake_case) + direction. */
  orderBy?: { column: string; ascending?: boolean };
  /** Extra equality (or range) filters. */
  filters?: LocalFilter[];
  /** Limit number of rows. */
  limit?: number;
  /** Postgres realtime event types to listen for. Defaults to all. */
  events?: ('INSERT' | 'UPDATE' | 'DELETE')[];
}

/** Local backend: refetch on every SSE change event for this table. */
function localSubscribe<T>(
  table: string,
  onUpdate: (rows: T[]) => void,
  options: SubscribeOptions,
  onError?: (err: Error) => void
): Unsubscribe {
  let cancelled = false;
  const fetchOnce = async () => {
    try {
      const rows = await localFetchRows<T>(table, options);
      if (!cancelled) onUpdate(rows);
    } catch (err: any) {
      if (!cancelled) {
        if (onError) onError(err as Error);
        else console.error(`subscribe(${table}) error:`, err?.message || err);
      }
    }
  };
  fetchOnce();
  const offChange = subscribeLocal(table, () => fetchOnce());
  return () => {
    cancelled = true;
    offChange();
  };
}

/**
 * Subscribe to a table. `onUpdate` receives the full mapped list on the first
 * load and on every relevant change. Returns an unsubscribe.
 */
export function subscribeTable<T = any>(
  table: string,
  onUpdate: (rows: T[]) => void,
  options: SubscribeOptions = {},
  onError?: (err: Error) => void
): Unsubscribe {
  if (isLocalMode()) return localSubscribe<T>(table, onUpdate, options, onError);

  let cancelled = false;
  const channelName = `rt:${table}:${Math.random().toString(36).slice(2)}`;

  const baseQuery = () => {
    let q = supabase.from(table).select('*');
    if (options.hotelId) q = q.eq('hotel_id', options.hotelId);
    for (const f of options.filters || []) {
      const op = f.op || 'eq';
      q = (q as any)[op](f.column, f.value);
    }
    if (options.orderBy) {
      q = q.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? true });
    }
    if (options.limit) q = q.limit(options.limit);
    return q;
  };

  const emit = async () => {
    try {
      const { data, error } = await baseQuery();
      if (error) throw error;
      if (!cancelled) onUpdate((data || []).map((r) => rowToObject<T>(r) as T));
    } catch (err: any) {
      if (!cancelled && onError) onError(err as Error);
      else if (!cancelled) console.error(`subscribe(${table}) error:`, err?.message || err);
    }
  };

  // Realtime channel scoped to this table (server enforces RLS per event).
  const events = options.events || ['INSERT', 'UPDATE', 'DELETE'];
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      if (!events.includes(payload.eventType as never)) return;
      emit();
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (onError) onError(new Error(`Realtime subscription to ${table} failed (${status})`));
      }
    });

  emit();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

/** Subscribe to a single document by id. */
export function subscribeRow<T = any>(
  table: string,
  id: string,
  onUpdate: (row: T | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (isLocalMode()) {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const row = await localFetchRow<T>(table, id);
        if (!cancelled) onUpdate(row);
      } catch (err: any) {
        if (!cancelled && onError) onError(err as Error);
      }
    };
    fetchOnce();
    const offChange = subscribeLocal(table, () => fetchOnce());
    return () => {
      cancelled = true;
      offChange();
    };
  }

  let cancelled = false;
  const channelName = `rt:${table}:${id}:${Math.random().toString(36).slice(2)}`;

  const emit = async () => {
    try {
      const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!cancelled) onUpdate(rowToObject<T>(data));
    } catch (err: any) {
      if (!cancelled && onError) onError(err as Error);
    }
  };

  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter: `id=eq.${id}` }, () => emit())
    .subscribe();

  emit();
  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

export async function insertRow<T = any>(table: string, data: Record<string, any>): Promise<string> {
  if (isLocalMode()) return localInsertRow(table, data);

  const { data: row, error } = await supabase.from(table).insert(objectToRow(data)).select('id').single();
  if (error) throw new Error(error.message);
  return (row as { id: string }).id;
}

export async function updateRow(
  table: string,
  id: string,
  data: Record<string, any>
): Promise<void> {
  if (isLocalMode()) return localUpdateRow(table, id, data);

  const { error } = await supabase.from(table).update(objectToRow(data)).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Update matching rows by filters (used for bookings/rooms transitions). */
export async function updateWhere(
  table: string,
  where: Array<{ column: string; value: unknown }>,
  data: Record<string, any>
): Promise<void> {
  if (isLocalMode()) {
    const rows = await localFetchRows<{ id: string }>(table, { filters: where });
    for (const row of rows) await localUpdateRow(table, row.id, data);
    return;
  }
  let q = supabase.from(table).update(objectToRow(data));
  for (const f of where) q = q.eq(f.column, f.value);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export async function deleteWhere(
  table: string,
  where: Array<{ column: string; value: unknown }>
): Promise<void> {
  if (isLocalMode()) {
    const rows = await localFetchRows<{ id: string }>(table, { filters: where });
    for (const row of rows) await localDeleteRow(table, row.id);
    return;
  }
  let q = supabase.from(table).delete();
  for (const f of where) q = q.eq(f.column, f.value);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export async function deleteRow(table: string, id: string): Promise<void> {
  if (isLocalMode()) return localDeleteRow(table, id);
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function fetchRows<T = any>(
  table: string,
  options: SubscribeOptions = {}
): Promise<T[]> {
  if (isLocalMode()) return localFetchRows<T>(table, options);

  let q = supabase.from(table).select('*');
  if (options.hotelId) q = q.eq('hotel_id', options.hotelId);
  for (const f of options.filters || []) {
    const op = f.op || 'eq';
    q = (q as any)[op](f.column, f.value);
  }
  if (options.orderBy) q = q.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? true });
  if (options.limit) q = q.limit(options.limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map((r) => rowToObject<T>(r) as T);
}

export async function fetchRow<T = any>(table: string, id: string): Promise<T | null> {
  if (isLocalMode()) return localFetchRow<T>(table, id);
  const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return rowToObject<T>(data);
}

/** RPC call — routed to the right backend. */
export async function rpc(name: string, args: Record<string, any>): Promise<any> {
  if (isLocalMode()) return localRpc(name, args);
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

/** Current staff user id (backend-independent; used for created_by stamps). */
export async function getCurrentUserId(): Promise<string> {
  if (isLocalMode()) return getStaffToken() ? 'local' : '';
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id || '';
}

export { supabase };
