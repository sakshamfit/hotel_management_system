import { signInAnonymously, type User } from 'firebase/auth';
import { auth } from '../firebase/config';
import type { GuestClaims } from '../types';

/**
 * GUEST SESSION (room QR → scoped access)
 * ========================================
 *
 * A guest is NOT a staff member and holds no Firestore role document. Instead:
 *
 *   1. The guest signs in anonymously (Firebase Auth > Sign-in method >
 *      Anonymous must be enabled for the project).
 *   2. The raw room token from the QR code is exchanged server-side
 *      (POST /api/guest/session). The server resolves token → { hotelId,
 *      roomId, roomNumber } using the Admin SDK and attaches them as custom
 *      claims: { role: 'guest', hotelId, roomId, roomNumber }.
 *   3. Firestore rules then scope the guest to that one hotel and one room.
 *
 * The token is never trusted client-side: the client cannot query across
 * hotels, so only the server can answer "which tenant does this token belong
 * to?". Claims (not client state) are what the rules evaluate.
 */

export interface GuestSessionInfo extends GuestClaims {
  /** Anonymous Firebase Auth uid — also stamped onto every order the guest creates. */
  uid: string;
  /**
   * Display name of the in-house guest, resolved server-side from the active
   * booking. Guests cannot read bookings or the guests collection themselves,
   * so the server hands the name over in the claim. Empty when no one is
   * checked in.
   */
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

/**
 * Session cache so a re-render or a StrictMode double-mount does not re-hit the
 * claim endpoint. Keyed by uid + room token, because one browser may scan more
 * than one room over its lifetime.
 */
const sessionCache = new Map<string, GuestSessionInfo>();

async function exchangeRoomToken(roomToken: string): Promise<GuestClaims> {
  const idToken = await auth.currentUser!.getIdToken(true);
  const response = await fetch('/api/guest/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
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
 * Must only be called when NO staff member is signed in — signing in
 * anonymously on the shared auth instance would otherwise replace an admin
 * session. Staff previewing the portal keep their own credentials and are
 * authorized as usual.
 */
export async function ensureGuestSession(roomToken: string): Promise<GuestSessionInfo> {
  let user: User;

  try {
    const credential = await signInAnonymously(auth);
    user = credential.user;
  } catch (err: any) {
    if (
      err?.code === 'auth/operation-not-allowed' ||
      err?.code === 'auth/admin-restricted-operation'
    ) {
      throw new GuestSessionError(
        'Anonymous sign-in is not enabled for this Firebase project. Enable it under ' +
          'Firebase console → Authentication → Sign-in method → Anonymous.',
        'guest/anonymous-disabled'
      );
    }
    throw new GuestSessionError(
      err?.message || 'Could not start a guest session.',
      err?.code || 'guest/anonymous-failed'
    );
  }

  const cacheKey = `${user.uid}::${roomToken}`;
  const cached = sessionCache.get(cacheKey);
  if (cached) return cached;

  const claims = await exchangeRoomToken(roomToken);

  // Claims only become visible to Firestore on a refreshed ID token.
  await user.getIdToken(true);

  const session: GuestSessionInfo = { ...claims, uid: user.uid };
  sessionCache.set(cacheKey, session);
  return session;
}

/** Clears the cached session (used on sign-out). */
export function clearGuestSessionCache(): void {
  sessionCache.clear();
}
