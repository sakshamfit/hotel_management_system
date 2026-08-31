/**
 * Client for the OFFLINE backend (/local/api) — used when this build is the
 * Desktop Edition (VITE_RUNTIME=local, or running inside the Electron shell).
 *
 * Mirrors the Supabase calls made elsewhere in the app so the rest of the code
 * (firestoreService, AuthContext, storageService, guestSession) can branch
 * with almost no changes.
 */

declare global {
  interface Window {
    __NEXORA_RUNTIME__?: { mode?: string; version?: string };
  }
}

export interface LocalRuntime {
  mode: string;
  version: string;
}

export function getLocalRuntime(): LocalRuntime | null {
  const global = typeof window !== 'undefined' ? window.__NEXORA_RUNTIME__ : undefined;
  if (global?.mode === 'local') return { mode: 'local', version: global.version || '1.0.0' };
  return null;
}

export function isLocalMode(): boolean {
  // The desktop build is compiled with VITE_RUNTIME=local; the Electron
  // preload also exposes window.__NEXORA_RUNTIME__ for belt-and-braces.
  return (import.meta.env.VITE_RUNTIME as string | undefined) === 'local' || !!getLocalRuntime();
}

export class LocalApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'LocalApiError';
    this.code = code;
  }
}

const STAFF_KEY = 'nexora.local.session';
const GUEST_KEY = 'nexora.local.guest';

export function getStaffToken(): string | null {
  try {
    return localStorage.getItem(STAFF_KEY);
  } catch {
    return null;
  }
}

export function setStaffToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(STAFF_KEY, token);
    else localStorage.removeItem(STAFF_KEY);
  } catch {
    /* ignore */
  }
}

export function getGuestToken(): string | null {
  try {
    return localStorage.getItem(GUEST_KEY);
  } catch {
    return null;
  }
}

export function setGuestToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(GUEST_KEY, token);
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    /* ignore */
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Explicit auth: 'staff' | 'guest' | 'none'. Default: staff, fallback guest. */
  auth?: 'staff' | 'guest' | 'none';
}

async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const staff = getStaffToken();
  const guest = getGuestToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== 'none') {
    if (opts.auth === 'guest' || (!opts.auth && !staff && guest)) headers['X-Guest-Token'] = guest || '';
    else if (opts.auth === 'staff' || (!opts.auth && staff)) headers['Authorization'] = `Bearer ${staff || ''}`;
  }
  const res = await fetch(`/local/api${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new LocalApiError(data?.error || `Request failed (HTTP ${res.status}).`, data?.code);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Setup / activation
// ---------------------------------------------------------------------------
export interface LocalSetupStatus {
  activated: boolean;
  demoAvailable: boolean;
  hotelName?: string | null;
  code?: string | null;
}

export async function fetchSetupStatus(): Promise<LocalSetupStatus> {
  return api<LocalSetupStatus>('/setup/status', { auth: 'none' });
}

export async function activateLocal(
  activationString: string,
  username: string,
  password: string
): Promise<{ user: any; hotel: any }> {
  return api('/activate', { method: 'POST', auth: 'none', body: { activationString, username, password } });
}

export async function activateDemo(): Promise<{ user: any; hotel: any }> {
  return api('/setup/demo', { method: 'POST', auth: 'none', body: {} });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export interface LocalSession {
  user: { id: string; username: string; role: string; hotelId: string | null; displayName: string; email: string } | null;
}

export async function localLogin(username: string, password: string): Promise<{ token: string; user: any; hotel: any }> {
  const res = await api<{ token: string; user: any; hotel: any }>('/auth/login', {
    method: 'POST',
    auth: 'none',
    body: { username, password },
  });
  setStaffToken(res.token);
  setGuestToken(null);
  return res;
}

export async function localLogout(): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST', auth: 'staff', body: {} });
  } catch {
    /* ignore */
  }
  setStaffToken(null);
  setGuestToken(null);
}

export async function localSession(): Promise<{ user: any; hotel: any } | null> {
  if (!getStaffToken()) return null;
  try {
    const res = await api<{ user: any; hotel: any }>('/auth/session', { auth: 'staff' });
    return res.user ? res : null;
  } catch {
    return null;
  }
}

export async function localChangePassword(current: string, next: string): Promise<void> {
  await api('/auth/password', { method: 'POST', auth: 'staff', body: { current, next } });
}

// ---------------------------------------------------------------------------
// Data (same shapes as the Supabase layer)
// ---------------------------------------------------------------------------
export interface LocalFilter {
  column: string;
  value: unknown;
  op?: 'eq' | 'gte' | 'lte' | 'gt' | 'lt' | 'ne';
}

export interface LocalQueryOptions {
  hotelId?: string;
  filters?: LocalFilter[];
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
}

export async function localFetchRows<T = any>(table: string, opts: LocalQueryOptions = {}): Promise<T[]> {
  const params = new URLSearchParams();
  if (opts.hotelId) params.set('hotel_id', opts.hotelId);
  if (opts.orderBy) {
    params.set('order_by', opts.orderBy.column);
    params.set('ascending', String(opts.orderBy.ascending ?? true));
  }
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.filters?.length) params.set('filters', JSON.stringify(opts.filters));
  const qs = params.toString();
  const res = await api<{ data: T[] }>(`/data/${table}${qs ? `?${qs}` : ''}`);
  return res.data || [];
}

export async function localFetchRow<T = any>(table: string, id: string): Promise<T | null> {
  const rows = await localFetchRows<T>(table, { filters: [{ column: 'id', value: id }] });
  return rows[0] || null;
}

export async function localInsertRow(table: string, data: Record<string, any>): Promise<string> {
  const res = await api<{ id: string }>(`/data/${table}`, { method: 'POST', body: data });
  return res.id;
}

export async function localUpdateRow(table: string, id: string, data: Record<string, any>): Promise<void> {
  await api(`/data/${table}/${encodeURIComponent(id)}`, { method: 'PUT', body: data });
}

export async function localDeleteRow(table: string, id: string): Promise<void> {
  await api(`/data/${table}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function localRpc(name: string, args: Record<string, any>): Promise<any> {
  if (name === 'create_booking') {
    return api(`/rpc/create_booking`, {
      method: 'POST',
      body: {
        hotelId: args.p_hotel_id,
        guestId: args.p_guest_id,
        roomId: args.p_room_id,
        roomTypeId: args.p_room_type_id,
        checkInDate: args.p_check_in,
        checkOutDate: args.p_check_out,
        rate: args.p_rate,
        numGuests: args.p_num_guests,
        source: args.p_source,
      },
    });
  }
  if (name === 'post_guest_order_charge') {
    return api('/rpc/post_guest_order_charge', { method: 'POST', auth: 'guest', body: { orderId: args.orderId || args.p_order_id } });
  }
  if (name === 'submit_guest_order_feedback') {
    return api('/rpc/submit_guest_order_feedback', {
      method: 'POST',
      auth: 'guest',
      body: { orderId: args.p_order_id, rating: args.p_rating, comment: args.p_comment },
    });
  }
  throw new LocalApiError(`Unknown RPC: ${name}`, 'rpc/unknown');
}

export async function localGuestSession(roomToken: string): Promise<{
  hotelId: string;
  roomId: string;
  roomNumber: string;
  guestName: string;
  uid: string;
  guestToken: string;
}> {
  const res = await api('/guest/session', { method: 'POST', auth: 'none', body: { roomToken } });
  setGuestToken(res.guestToken);
  return res;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------
export async function localUploadMedia(file: File, path: string): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
  const res = await api<{ url: string }>('/media/upload', { method: 'POST', body: { path, dataUrl } });
  return res.url;
}

export async function localDeleteMediaByUrl(url: string): Promise<void> {
  if (!url.startsWith('/local/media/')) return;
  await api('/media', { method: 'DELETE', body: { url } });
}

export async function localDeleteMediaFolder(pathPrefix: string): Promise<void> {
  await api('/media/delete-folder', { method: 'POST', body: { path: pathPrefix } });
}

export function isLocalMediaUrl(url: string): boolean {
  return url.startsWith('/local/media/');
}

// ---------------------------------------------------------------------------
// Realtime — one shared SSE channel, fan-out per table
// ---------------------------------------------------------------------------
interface Subscriber {
  tables: string[];
  cb: (changedTables: string[]) => void;
}

let streamStarted = false;
let streamRetryTimer: ReturnType<typeof setTimeout> | null = null;
const subscribers = new Set<Subscriber>();

function ensureStream(): void {
  if (streamStarted) return;
  streamStarted = true;
  const connect = () => {
    const token = getStaffToken();
    if (!token) {
      streamStarted = false;
      return;
    }
    const src = new EventSource(`/local/api/stream?token=${encodeURIComponent(token)}`);
    src.addEventListener('changed', (ev) => {
      try {
        const tables: string[] = JSON.parse((ev as MessageEvent).data || '[]');
        for (const sub of Array.from(subscribers)) {
          if (sub.tables.length === 0 || sub.tables.some((t) => tables.includes(t) || tables.includes('media'))) {
            try {
              sub.cb(tables);
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* ignore */
      }
    });
    src.onerror = () => {
      src.close();
      if (streamRetryTimer) clearTimeout(streamRetryTimer);
      streamRetryTimer = setTimeout(connect, 2500);
    };
  };
  connect();
}

export function subscribeLocal(
  table: string,
  onUpdate: (tables: string[]) => void
): () => void {
  const sub: Subscriber = { tables: [table], cb: onUpdate };
  subscribers.add(sub);
  ensureStream();
  return () => {
    subscribers.delete(sub);
  };
}

export async function localBackup(): Promise<string> {
  const res = await api<{ backupPath: string }>('/backup', { method: 'POST', body: {} });
  return res.backupPath;
}

export async function localLanInfo(): Promise<{ enabled: boolean; localUrl: string }> {
  const res = await api<{ enabled: boolean; localUrl?: string }>('/meta');
  return { enabled: !!res.enabled, localUrl: res.localUrl || 'http://127.0.0.1' };
}
