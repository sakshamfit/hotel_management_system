/**
 * Issue a desktop activation for one customer — the "we provide the credentials"
 * workflow, fully offline (no website needed).
 *
 *   npm run license:issue -- \
 *     --hotel "The Grand Palace" \
 *     --owner "Rahul Sharma" \
 *     --username "grandpalace" \
 *     --password "StrongPass123" \
 *     [--email owner@example.com] [--expires 2027-01-01] [--out grandpalace.nexora]
 *
 * Prints the credentials + one-line activation string, and optionally writes
 * the .nexora file to send to the customer.
 */
import { generateActivationCode, issueLicense, loadPrivateKeyPem, generateKeypairFile } from '../server/local/licensing';
import { LocalStore } from '../server/local/store';
import fs from 'node:fs';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function required(name: string): string {
  const v = arg(name);
  if (!v) {
    console.error(`Missing required argument --${name}`);
    process.exit(1);
  }
  return v;
}

const hotel = required('hotel');
const owner = required('owner');
const username = required('username').trim().toLowerCase();
const password = required('password');
const email = arg('email') || undefined;
const expires = arg('expires') || undefined;
const out = arg('out') || `${username || 'license'}.nexora`;

if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

// Auto-create the keypair on first run (dev convenience) — production should
// run `npm run keys:generate` deliberately and protect the private key.
if (!loadPrivateKeyPem()) {
  console.warn('No signing key found — generating keys/license-signing-*.pem now. Run `npm run keys:generate` to do this deliberately.');
  generateKeypairFile();
}

const passwordHash = LocalStore.hashPassword(password);
const issued = issueLicense({
  hotelName: hotel,
  ownerName: owner,
  username,
  passwordHash,
  email,
  expiresAt: expires ? new Date(`${expires}T23:59:59Z`).toISOString() : null,
  code: generateActivationCode(),
});

const file = JSON.stringify({ payload: issued.payload, signature: issued.signature }, null, 2);
if (out !== 'none') {
  fs.writeFileSync(out, file);
}

console.log('──────────────────────────────────────────────────────────────');
console.log('  NEXORA DESKTOP LICENSE');
console.log('──────────────────────────────────────────────────────────────');
console.log(`  License code : ${issued.code}`);
console.log(`  Hotel        : ${hotel}`);
console.log(`  Owner        : ${owner}`);
console.log(`  Username     : ${username}`);
console.log(`  Password     : ${password}`);
console.log(`  Expires      : ${expires || 'never'}`);
console.log('');
console.log(`  Activation string (send this + username + password):\n`);
console.log(issued.activationString);
console.log('');
if (out !== 'none') console.log(`  Activation file saved → ${out}`);
console.log('──────────────────────────────────────────────────────────────');
console.log('  Customer does: 1) download & install NEXORA  2) open the app');
console.log('  3) paste the activation string  4) enter username + password\n');
