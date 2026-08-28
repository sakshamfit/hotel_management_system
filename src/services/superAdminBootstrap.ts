import {
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../firebase/config';

/**
 * ONE-TIME SUPER ADMIN BOOTSTRAP
 * ------------------------------
 * The ONLY place in the app where these credentials exist. Runs once per app
 * load, before the login screen appears:
 *
 *  1. Checks the `users` collection for any document with role == "super_admin".
 *  2. If one exists → skip forever (no duplicate admins are ever created).
 *  3. If none exists → creates the FIRST super admin via Firebase Auth
 *     createUserWithEmailAndPassword(), writes a marker doc at users/{uid}
 *     ({ role, email, createdAt }), asks the app server (Admin SDK) to set the
 *     super_admin custom claim, then signs out so the login screen still shows.
 *
 * Hotel accounts are NEVER created here — they only come from the
 * "Add Hotel" wizard in the Super Admin panel.
 */

// The single source of truth for the bootstrap identity.
export const BOOTSTRAP_SUPER_ADMIN_EMAIL = 'ra7650384@gmail.com';
const BOOTSTRAP_SUPER_ADMIN_PASSWORD = '9852120609'; // never exported, never stored anywhere else

export type SuperAdminBootstrapResult = 'exists' | 'created' | 'unavailable';

let bootstrapPromise: Promise<SuperAdminBootstrapResult> | null = null;

async function runBootstrap(): Promise<SuperAdminBootstrapResult> {
  // 1. Does a super_admin already exist? (If yes, skip entirely.)
  try {
    const usersQuery = query(
      collection(db, 'users'),
      where('role', '==', 'super_admin'),
      limit(1)
    );
    const snapshot = await getDocs(usersQuery);
    if (!snapshot.empty) {
      return 'exists';
    }
  } catch (err: any) {
    // Rules not deployed / offline — treat as "cannot bootstrap now".
    console.warn('[super-admin-bootstrap] existence check failed:', err?.code || err?.message);
    return 'unavailable';
  }

  // 2. No super_admin anywhere — create the first one.
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(
      auth,
      BOOTSTRAP_SUPER_ADMIN_EMAIL,
      BOOTSTRAP_SUPER_ADMIN_PASSWORD
    );
  } catch (err: any) {
    if (err?.code === 'auth/email-already-in-use') {
      // Auth user exists but has no users/ marker doc yet — treat as existing.
      return 'exists';
    }
    console.warn('[super-admin-bootstrap] account creation failed:', err?.code || err?.message);
    return 'unavailable';
  }

  // createUserWithEmailAndPassword signs the new admin in — write the marker
  // doc first so the "already exists" check is durable from now on.
  try {
    await setDoc(doc(db, 'users', cred.user.uid), {
      role: 'super_admin',
      email: BOOTSTRAP_SUPER_ADMIN_EMAIL,
      createdAt: serverTimestamp(),
    });
  } catch (err: any) {
    console.warn('[super-admin-bootstrap] marker doc failed:', err?.code || err?.message);
  }

  // Best-effort: have the app server (Firebase Admin SDK) attach the
  // super_admin custom claim so Firestore/Storage rules recognise this account.
  try {
    await fetch('/api/auth/bootstrap-super-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_SUPER_ADMIN_EMAIL }),
    });
  } catch {
    // Static-only deployments without the Node server: sign-in fallback in
    // AuthContext covers claim assignment later. Non-fatal.
  }

  // Bootstrap must never leave the admin signed in — return to the login screen.
  try {
    await signOut(auth);
  } catch {
    // ignore
  }

  return 'created';
}

/**
 * Idempotent per session: the first caller starts the check, every later
 * caller reuses the same promise. Safe to call on every app startup.
 */
export function ensureSuperAdminBootstrapped(): Promise<SuperAdminBootstrapResult> {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap();
  }
  return bootstrapPromise;
}
