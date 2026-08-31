/**
 * Offline licensing/activation.
 *
 * A license is a signed JSON payload (Ed25519). The desktop app embeds the
 * PUBLIC key; the seller signs with the PRIVATE key (env or keys/ file). The
 * activation never needs the internet: the signed payload carries the hotel
 * name + the scrypt hash of the customer's password, and the desktop app
 * verifies the signature locally before provisioning the database.
 *
 * Two presentation formats, both signed:
 *   • .nexora file  — { payload, signature } JSON (the download from the site)
 *   • activation string — base64url of the same object (one line to WhatsApp)
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const nodeRequire =
  typeof require !== 'undefined' ? require : createRequire(import.meta.url);


export const SCHEMA_VERSION = 1;

/** The public key BAKED INTO THIS BUILD. Replace via `npm run keys:generate`
 *  (also writes desktop/license-public-key.pem). Runtime lookup order:
 *  env LICENSE_PUBLIC_KEY → this constant → keys/license-signing-public.pem. */
export const EMBEDDED_PUBLIC_KEY_PEM = process.env.LICENSE_PUBLIC_KEY || '';

function repoRoot(): string {
  // Dev/CLI always run from the repo root (npm scripts). In the packaged
  // desktop app the public key is embedded, so the keys/ file is never needed.
  return process.cwd();
}

function defaultPrivateKeyPath(): string {
  return path.join(repoRoot(), 'keys', 'license-signing-private.pem');
}

function defaultPublicKeyPath(): string {
  return path.join(repoRoot(), 'keys', 'license-signing-public.pem');
}

export function loadPrivateKeyPem(): string | null {
  const fromEnv = (process.env.LICENSE_SIGNING_PRIVATE_KEY || '').trim();
  if (fromEnv) return fromEnv.replace(/\\n/g, '\n');
  try {
    return fs.readFileSync(defaultPrivateKeyPath(), 'utf8');
  } catch {
    return null;
  }
}

export function loadPublicKeyPem(): string | null {
  const fromEnv = (process.env.LICENSE_PUBLIC_KEY || '').trim();
  if (fromEnv) return fromEnv.replace(/\\n/g, '\n');
  if (EMBEDDED_PUBLIC_KEY_PEM) return EMBEDDED_PUBLIC_KEY_PEM;
  try {
    return fs.readFileSync(defaultPublicKeyPath(), 'utf8');
  } catch {
    return null;
  }
}

/** Write a fresh Ed25519 keypair to keys/. Run once; keep the PRIVATE key safe. */
export function generateKeypairFile(keysDir = path.join(repoRoot(), 'keys')): {
  privatePem: string;
  publicPem: string;
} {
  const { privateKey, publicKey } = generateKeypair();
  fs.mkdirSync(keysDir, { recursive: true });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  fs.writeFileSync(path.join(keysDir, 'license-signing-private.pem'), privatePem, { mode: 0o600 });
  fs.writeFileSync(path.join(keysDir, 'license-signing-public.pem'), publicPem);
  return { privatePem, publicPem };
}

export function generateKeypair(): {
  privateKey: ReturnType<typeof createPrivateKey>;
  publicKey: ReturnType<typeof createPublicKey>;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey };
}

// ---------------------------------------------------------------------------
// Activation code
// ---------------------------------------------------------------------------
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

export function generateActivationCode(): string {
  const bytes = randomBytes(24);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `NX-${s.slice(0, 8)}-${s.slice(8, 16)}-${s.slice(16, 24)}`;
}

export function normalizeActivationCode(code: string): string {
  return (code || '').trim().toUpperCase().replace(/\s+/g, '');
}

// ---------------------------------------------------------------------------
// Payload + signature
// ---------------------------------------------------------------------------
export interface LicensePayload {
  v: number;
  id: string;
  code: string;
  hotelName: string;
  ownerName: string;
  username: string;
  passwordHash: string;
  email?: string;
  issuedAt: string;
  expiresAt?: string | null;
}

/** Canonical serialization — MUST stay identical on issue + verify. */
export function canonicalize(payload: LicensePayload): string {
  return JSON.stringify({
    v: payload.v,
    id: payload.id,
    code: payload.code,
    hotelName: payload.hotelName,
    ownerName: payload.ownerName,
    username: payload.username,
    passwordHash: payload.passwordHash,
    email: payload.email || '',
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt || '',
  });
}

export function signPayload(payload: LicensePayload, privatePem: string): string {
  const key = createPrivateKey(privatePem);
  return edSign(null, Buffer.from(canonicalize(payload), 'utf8'), key).toString('base64');
}

export function verifyPayload(payload: LicensePayload, signatureB64: string, publicPem: string): boolean {
  try {
    const key = createPublicKey(publicPem);
    return edVerify(null, Buffer.from(canonicalize(payload), 'utf8'), key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

export interface IssuedLicense {
  payload: LicensePayload;
  signature: string;
  code: string;
  /** One-line base64 payload the customer can paste into the setup wizard. */
  activationString: string;
}

export function issueLicense(input: {
  hotelName: string;
  ownerName?: string;
  username: string;
  passwordHash: string;
  email?: string;
  expiresAt?: string | null;
  code?: string;
  id?: string;
}): IssuedLicense {
  const privatePem = loadPrivateKeyPem();
  if (!privatePem) {
    throw new Error(
      'No license signing key configured. Run `npm run keys:generate` (creates keys/), then set ' +
        'LICENSE_SIGNING_PRIVATE_KEY in .env (or keep the keys/ file).'
    );
  }
  const payload: LicensePayload = {
    v: SCHEMA_VERSION,
    id: input.id || randomUUID(),
    code: normalizeActivationCode(input.code || generateActivationCode()),
    hotelName: input.hotelName,
    ownerName: input.ownerName || '',
    username: input.username.trim().toLowerCase(),
    passwordHash: input.passwordHash,
    email: input.email || '',
    issuedAt: new Date().toISOString(),
    expiresAt: input.expiresAt || null,
  };
  const signature = signPayload(payload, privatePem);
  const activationString = Buffer.from(JSON.stringify({ payload, signature }), 'utf8').toString('base64url');
  return { payload, signature, code: payload.code, activationString };
}

export interface ParsedActivation {
  payload: LicensePayload;
  signature: string;
}

export function parseActivationString(activationString: string): ParsedActivation | null {
  try {
    const s = (activationString || '').trim();
    const json = Buffer.from(s, 'base64url').toString('utf8');
    const obj = JSON.parse(json) as ParsedActivation;
    if (!obj?.payload?.code || !obj?.payload?.passwordHash || !obj?.signature) return null;
    return obj;
  } catch {
    return null;
  }
}

export class LicenseError extends Error {
  code: string;
  constructor(message: string, code = 'license/invalid') {
    super(message);
    this.name = 'LicenseError';
    this.code = code;
  }
}

/** Verifies signature + expiry and returns the payload (throws LicenseError). */
export function verifyActivationString(
  activationString: string,
  publicPem: string
): LicensePayload {
  const parsed = parseActivationString(activationString);
  if (!parsed) throw new LicenseError('This activation code is not readable. Please re-copy it from the seller.', 'license/parse');
  const publicKey = publicPem?.trim() ? publicPem : loadPublicKeyPem();
  if (!publicKey) {
    throw new LicenseError(
      'This build has no licence public key. Ask the vendor to rebuild with keys/license-signing-public.pem baked in.',
      'license/no-public-key'
    );
  }
  if (!verifyPayload(parsed.payload, parsed.signature, publicKey)) {
    throw new LicenseError('This activation code is not valid or has been tampered with.', 'license/signature');
  }
  if (parsed.payload.v !== SCHEMA_VERSION) {
    throw new LicenseError('This activation was issued for a different version of NEXORA.', 'license/version');
  }
  if (parsed.payload.expiresAt && new Date(parsed.payload.expiresAt).getTime() < Date.now()) {
    throw new LicenseError('This activation has expired. Please contact the seller for a renewal.', 'license/expired');
  }
  return parsed.payload;
}

/** Loads bundled (or dev keys) public PEM; null when unavailable. */
export function getPublicKeyPem(): string | null {
  return loadPublicKeyPem();
}
