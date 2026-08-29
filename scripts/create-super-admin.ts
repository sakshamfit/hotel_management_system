#!/usr/bin/env tsx
/**
 * PROVISION THE FIRST SUPER ADMIN — Supabase edition.
 * ===================================================
 *
 * Supabase has no custom claims: a staff role is a `profiles` row. This script
 * uses the service-role key to (1) create the auth user (or reuse an existing
 * email), (2) confirm it, and (3) upsert a profiles row with role
 * 'super_admin'. Nothing is stored in the repo; credentials come from .env.
 *
 * Usage
 * -----
 *   npm run create-super-admin -- --email you@example.com
 *   npm run create-super-admin -- --email you@example.com --password '...'
 *   # or via env: SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD
 *
 * Requires in .env: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

if (!url || !serviceKey) {
  console.error('✗ Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const email = (arg('--email') || process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
let password = arg('--password') || process.env.SUPER_ADMIN_PASSWORD || '';

if (!email) {
  console.error('✗ Provide an email: npm run create-super-admin -- --email you@example.com');
  process.exit(1);
}
if (!password) {
  password = randomBytes(12).toString('base64url');
  console.log('Generated a strong password (save it now — it is shown once).');
}
if (password.length < 6) {
  console.error('✗ Password must be at least 6 characters.');
  process.exit(1);
}

async function main() {
  // Find existing user by email (listUsers is the admin-safe way).
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw listErr;
  const existing = (list?.users || []).find((u) => (u.email || '').toLowerCase() === email);

  let uid: string;
  let isNew = false;

  if (existing) {
    uid = existing.id;
    const { error } = await admin.auth.admin.updateUserById(uid, {
      email_confirm: true,
      password,
      user_metadata: { display_name: 'Super Admin' },
    });
    if (error) throw error;
    console.log(`• Existing user ${email} (${uid}) — password refreshed, email confirmed.`);
  } else {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Super Admin' },
    });
    if (error || !created?.user) throw error || new Error('createUser failed');
    uid = created.user.id;
    isNew = true;
    console.log(`• Created auth user ${email} (${uid}).`);
  }

  const { error: profileErr } = await admin
    .from('profiles')
    .upsert(
      { id: uid, role: 'super_admin', hotel_id: null, email, display_name: 'Super Admin' },
      { onConflict: 'id' }
    );
  if (profileErr) throw profileErr;

  console.log(`\n✓ Super admin ready: ${email}${isNew ? ' (new account)' : ''}`);
  console.log(`  password: ${password}`);
  console.log('  Sign in at the app login screen. The profiles row carries role=super_admin.');
}

main().catch((err) => {
  console.error('\n✗ Failed:', err?.message || err);
  process.exit(1);
});
