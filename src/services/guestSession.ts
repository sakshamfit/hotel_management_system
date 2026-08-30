import { supabase, demoBackend } from '../supabase/config';
import type { GuestClaims } from '../types';

/**
 * GUEST SESSION (room QR → scoped access) — Supabase edition.
 * ==========================================================
 *
 * A guest is NOT staff and holds no `profiles` row. Instead:
 *
 *   1. The guest signs in ANONYMOUSLY (Supabase Auth → Anonymous sign-ins must
 *      be enabled). Supabase creates an auth.users row the RLS helper
 *      `active_guest_session()` can key off.
 *   2. The raw room token from the QR code is exchanged server-side
 *      (POST /api/guest/session). The server verifies the anonymous user,
 *      resolves token → { hotelId, roomId, roomNumber, guestName } with the
 *      service-role key, and writes a `guest_sessions` row scoped to that one
 *      room. This replaces Firebase custom claims.
 *   3. Postgres RLS evaluates the guest_sessions row on every query, so the
 *      guest can only see their own room, menu/services for the hotel, and
 *      their own orders.
 *
 * The token is never trusted client-side: the server (service role) performs
 * the permanentToken lookup, so a browser can never enumerate tenants/rooms.
 */

export interface GuestSessionInfo extends GuestClaims {
  /** Anonymous Supabase auth user id — stamped onto every order as guestUid. */
  uid: string;
  guestName?: string;
}

export class GuestSessionError extends Error {
  code: string;
  constructor(message: string, code = 'guest/session-failed') {
    super(message);
    this.name = 'GuestSessionError';
    this.code = code;
  }
}

const sessionCache = new Map<string, GuestSessionInfo>();

async function exchangeRoomToken(roomToken: string, uid: string, accessToken: string): Promise<GuestClaims> {
  // Demo mode: the room token is resolved against the local seed/store — no
  // server round-trip (in demo mode server admin/guest routes are not wired).
  if (demoBackend) {
    const claims = demoBackend.openGuestSession(roomToken, uid);
    if (!claims) {
      throw new GuestSessionError('This room code is not recognised.', 'guest/unknown-room');
    }
    return {
      role: 'guest',
      hotelId: claims.hotelId,
      roomId: claims.roomId,
      roomNumber: claims.roomNumber,
      guestName: typeof claims.guestName === 'string' ? claims.guestName : '',
    };
  }

  const response = await fetch('/api/guest/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ roomToken }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GuestSessionError(
      data?.error || `Could not open this room session (HTTP ${response.status}).`,
      data?.code || 'guest/session-failed'
    );
  }
  return {
    role: 'guest',
    hotelId: data.hotelId,
    roomId: data.roomId,
    roomNumber: data.roomNumber,
    guestName: typeof data.guestName === 'string' ? data.guestName : '',
  };
}

/**
 * Establishes (or reuses) the anonymous, room-scoped guest session.
 *
 * Only called when no staff member is signed in — signing in anonymously on
 * the shared client would otherwise replace an admin session. Staff previewing
 * the portal keep their own session and are authorized as usual.
 */
export async function ensureGuestSession(roomToken: string): Promise<GuestSessionInfo> {
  let uid: string;
  let accessToken: string;

  // Reuse an existing anonymous session if one is present; otherwise create one.
  const {
    data: { session: existing },
  } = await supabase.auth.getSession();
  const isAnonymous = (existing?.user as any)?.is_anonymous === true;

  if (existing && isAnonymous) {
    uid = existing.user.id;
    accessToken = existing.access_token;
  } else {
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      if (!data.session) throw new GuestSessionError('Could not start an anonymous session.');
      uid = data.user!.id;
      accessToken = data.session.access_token;
    } catch (err: any) {
      const status = err?.status || err?.code;
      if (
        err?.message?.toLowerCase().includes('anonymous') ||
        status === 'anonymous_provider_disabled' ||
        status === 400
      ) {
        throw new GuestSessionError(
          'Anonymous sign-in is not enabled. In the Supabase dashboard enable Authentication → ' +
            'Providers → Anonymous, then retry.',
          'guest/anonymous-disabled'
        );
      }
      throw new GuestSessionError(err?.message || 'Could not start a guest session.', 'guest/anonymous-failed');
    }
  }

  const cacheKey = `${uid}::${roomToken}`;
  const cached = sessionCache.get(cacheKey);
  if (cached) return cached;

  const claims = await exchangeRoomToken(roomToken, uid, accessToken);

  const session: GuestSessionInfo = { ...claims, uid };
  sessionCache.set(cacheKey, session);
  return session;
}

export function clearGuestSessionCache(): void {
  sessionCache.clear();
}
