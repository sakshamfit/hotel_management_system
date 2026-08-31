/**
 * Generates the Ed25519 signing keypair used for desktop activations.
 *
 *   npm run keys:generate
 *
 * Creates (git-ignored):
 *   keys/license-signing-private.pem  — KEEP SECRET (never commit / never ship)
 *   keys/license-signing-public.pem   — bake into the desktop build:
 *       • paste into LICENSE_PUBLIC_KEY in .env for the cloud seller site, and
 *       • paste the PEM as EMBEDDED_PUBLIC_KEY_PEM in server/local/licensing.ts
 *         (or set LICENSE_PUBLIC_KEY when building) so the shipped app can
 *         verify activations fully offline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { generateKeypairFile } from '../server/local/licensing';

const root = process.cwd();
const out = generateKeypairFile(path.join(root, 'keys'));

console.log('✔ Licence signing keypair created in keys/\n');
console.log('  private → keys/license-signing-private.pem   (KEEP PRIVATE — used by the seller site / CLI)');
console.log('  public  → keys/license-signing-public.pem    (baked into every desktop build)\n');

console.log('--- Public key (paste into server/local/licensing.ts EMBEDDED_PUBLIC_KEY_PEM or .env) ---\n');
console.log(out.publicPem.trim());
console.log('\n--- Private key environment variable (seller site .env) ---\n');
console.log(
  'LICENSE_SIGNING_PRIVATE_KEY="' + out.privatePem.trim().replace(/\n/g, '\\n') + '"'
);
console.log(
  '\nTip: if the key file is present, the seller site and `npm run license:issue`\n' +
    'use it automatically — the env var is only needed on a different machine.\n'
);
