#!/usr/bin/env tsx
/**
 * ONE-OFF SUPER ADMIN PROVISIONING
 * =================================
 *
 * Run this by hand, once per environment, to create the platform owner
 * account. It replaces the old client-side bootstrap (which had a real email
 * and password committed to the repo and shipped in the JS bundle).
 *
 * Credentials are supplied by YOU at run time (argv or environment) — nothing
 * is stored in the repository, and nothing is baked into the app bundle.
 *
 * Usage
 * -----
 *   # Recommended: let the script generate a strong random password
 *   npm run create-super-admin -- --email you@example.com
 *
 *   # Or supply your own (must be >= 6 chars)
 *   npm run create-super-admin -- --email you@example.com --password '***'
 *
 *   # Env-var form (handy in CI / secret managers)
 *   SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='***' \
 *     npm run create-super-admin
 *
 *   # Promote an EXISTING Firebase Auth user without touching their password
 *   npm run create-super-admin -- --email you@example.com --no-password-change
 *
 * What it does
 * ------------
 *   1. Creates the Firebase Auth user if missing (else reuses it).
 *   2. Sets/refreshes the password only when one is supplied or generated.
 *   3. Attaches the custom claim { role: 'super_admin' }.
 *   4. Writes the matching users/{uid} role document used by firestore.rules.
 *
 * Prerequisites
 * -------------
 *   Firebase Admin SDK credentials via Application Default Credentials —
 *   either run on a machine with `gcloud auth application-default login`, or
 *   point GOOGLE_APPLICATION_CREDENTIALS at a service-account JSON:
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/sa.json
 *   export FIREBASE_PROJECT_ID=your-project-id   # optional, defaults to firebase-applet-config.json
 *
 * The service account needs: Firebase Authentication Admin + Cloud Datastore
 * User (i.e. "Firebase Admin SDK Administrator Service Agent" or Editor).
 */

import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Argument / environment parsing
// ---------------------------------------------------------------------------

function readArg(name: string): string | undefined {
  const flag = `--${name}=`;
  const exact = process.argv.find((a) => a.startsWith(flag));
  if (exact) return exact.slice(flag.length);
  // support `--email value`
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return undefined;
}

const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const email = (readArg('email') || process.env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();
const suppliedPassword = readArg('password') || process.env.SUPER_ADMIN_PASSWORD || '';
const keepExistingPassword = hasFlag('no-password-change');
const displayName = readArg('name') || process.env.SUPER_ADMIN_NAME || 'Platform Super Admin';

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('\n✗ A valid --email you@example.com is required.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Firebase Admin init (ADC — no credentials live in this repo)
// ---------------------------------------------------------------------------

const repoRoot = resolve(__dirname, '..');
const appletConfig = JSON.parse(
  readFileSync(resolve(repoRoot, 'firebase-applet-config.json'), 'utf8')
);

const projectId = process.env.FIREBASE_PROJECT_ID || appletConfig.projectId;

function initAdmin() {
  if (getApps().length) return getApps()[0]!;
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (serviceAccountPath) {
    const sa = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    return initializeApp({ credential: cert(sa), projectId: sa.project_id || projectId });
  }
  return initializeApp({ credential: applicationDefault(), projectId });
}

let app;
try {
  app = initAdmin();
} catch (err: any) {
  console.error('\n✗ Could not initialize the Firebase Admin SDK:', err?.message);
  console.error(
    '  Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json\n' +
      '  or run: gcloud auth application-default login\n'
  );
  process.exit(1);
}

const adminAuth = getAuth(app);
// Named (non-default) Firestore database, matching src/firebase/config.ts
const db = getFirestore(app, appletConfig.firestoreDatabaseId || '(default)');

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n• Project : ${projectId}`);
  console.log(`• Database: ${appletConfig.firestoreDatabaseId || '(default)'}`);
  console.log(`• Email   : ${email}\n`);

  let uid: string;
  let isNew = false;
  let generatedPassword: string | null = null;

  try {
    const existing = await adminAuth.getUserByEmail(email);
    uid = existing.uid;
    console.log(`• Existing Firebase Auth user found (uid=${uid})`);
  } catch (err: any) {
    if (err?.code !== 'auth/user-not-found') throw err;

    let password = suppliedPassword;
    if (!password) {
      // 20 chars from a CSPRNG — never printed to a log file, only to stdout.
      generatedPassword = randomBytes(15).toString('base64url');
      password = generatedPassword;
    }
    if (password.length < 6) {
      console.error('\n✗ Password must be at least 6 characters.\n');
      process.exit(1);
    }

    const created = await adminAuth.createUser({
      email,
      password,
      displayName,
      emailVerified: true,
    });
    uid = created.uid;
    isNew = true;
    console.log(`• Created Firebase Auth user (uid=${uid})`);
  }

  // Set/rotate the password when one was supplied or generated.
  if (!keepExistingPassword && (suppliedPassword || generatedPassword)) {
    await adminAuth.updateUser(uid, { password: suppliedPassword || generatedPassword! });
    console.log(`• Password ${suppliedPassword ? 'set from input' : 'set to a generated value'}`);
  } else if (keepExistingPassword) {
    console.log('• Password left unchanged (--no-password-change)');
  }

  // Custom claim — this is what server.ts and firestore.rules trust.
  await adminAuth.setCustomUserClaims(uid, { role: 'super_admin' });
  console.log("• Custom claim set: { role: 'super_admin' }");

  // Mirror the role into Firestore (the free-tier primary role source).
  await db
    .collection('users')
    .doc(uid)
    .set(
      {
        role: 'super_admin',
        hotelId: null,
        email,
        displayName,
        phone: '',
        createdAt: new Date().toISOString(),
      },
      { merge: true }
    );
  console.log(`• Role document written: users/${uid}`);

  console.log('\n✓ Super admin ready. Sign in at the app login screen.\n');
  if (generatedPassword) {
    console.log('  Generated password (shown ONCE, not stored anywhere):');
    console.log(`    ${generatedPassword}`);
    console.log('  Store it in your password manager now. If you lose it, re-run this');
    console.log('  script to set a new one — there is no other reset path.\n');
  }
}

main().catch((err: any) => {
  console.error('\n✗ Failed:', err?.message || err);
  process.exit(1);
});
