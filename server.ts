import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { issueLicense, generateActivationCode, loadPrivateKeyPem } from './server/local/licensing';
import { LocalStore } from './server/local/store';

// ---------------------------------------------------------------------------
// Supabase admin (service-role) client.
// The service-role key bypasses RLS and is ONLY used server-side, never
// shipped to the browser. Auth users are managed with admin APIs; the
// browser/app still uses the anon key + RLS for its own reads and writes.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

function isPlaceholderValue(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  if (v === 'unconfigured') return true;
  if (/your-project-ref|your-anon-public-key|your-service-role-key|example\.com|xxxx/i.test(v)) return true;
  return false;
}

/**
 * Credentials absent or still placeholders: the API routes below answer 503
 * (see requireSupabaseConfigured) and the browser shows the setup screen, so
 * nothing half-works while `.env` is being filled in.
 */
const CONFIGURED = !isPlaceholderValue(SUPABASE_URL) && !isPlaceholderValue(SUPABASE_SERVICE_KEY);

if (!CONFIGURED) {
  console.warn(
    '[server] SUPABASE url/service-role key missing or still placeholders. Set VITE_SUPABASE_URL ' +
      'and SUPABASE_SERVICE_ROLE_KEY in .env (see .env.example). Guest/admin API routes will 503.'
  );
}

// Lazily created so the server can boot even before .env is filled in.
// API routes respond 503 (see requireSupabaseConfigured) until then.
let _admin: SupabaseClient | null = null;
function getAdmin(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

/** Verify a Supabase JWT sent by the client and return its claims. */
async function verifySupabaseJwt(token: string): Promise<{
  uid: string;
  email?: string;
  role: string;
  isAnonymous: boolean;
} | null> {
  const admin = getAdmin();
  if (!admin) return null;
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) return null;
  return {
    uid: user.id,
    email: user.email || undefined,
    role: user.role || 'authenticated',
    isAnonymous: (user as any).is_anonymous === true || !!user.app_metadata?.is_anonymous,
  };
}

// ---------------------------------------------------------------------------
// Desktop licence helpers — Seller Console (issue credentials Marg-style).
// ---------------------------------------------------------------------------

/** AES-256-GCM vault for customer passwords so the seller can re-share them. */
function encryptSecret(plain: string): string {
  const key = process.env.LICENSE_PASSWORD_KEY;
  if (!key || key.length < 32) return '';
  const keyBuf = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptSecret(enc: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = String(enc || '').split(':');
    if (!ivHex || !tagHex || !dataHex) return null;
    const key = process.env.LICENSE_PASSWORD_KEY;
    if (!key) return null;
    const keyBuf = crypto.createHash('sha256').update(key).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function licensePublicRow(row: Record<string, any>) {
  return {
    id: row.id,
    code: row.code,
    hotelName: row.hotel_name,
    ownerName: row.owner_name,
    username: row.username,
    email: row.email,
    status: row.status,
    issuedAt: row.issued_at,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function registerLicensingRoutes(app: express.Express, requireSuperAdmin: (req: Request, res: Response, next: NextFunction) => void) {
  // List all issued desktop licences (seller console).
  app.get('/api/licenses', requireSuperAdmin, async (req: Request, res: Response) => {
    const admin = requireSupabaseConfigured(res);
    if (!admin) return;
    try {
      const { data, error } = await admin
        .from('desktop_licenses')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      res.json({ data: (data || []).map(licensePublicRow) });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to list licences.' });
    }
  });

  // Issue a licence → credentials + activation string (the "we provide the
  // credentials" step). The plaintext password is returned ONCE here.
  app.post('/api/licenses', requireSuperAdmin, async (req: Request, res: Response) => {
    const admin = requireSupabaseConfigured(res);
    if (!admin) return;
    const { hotelName, ownerName, username, password, email, expiresAt, notes } = req.body || {};
    if (!hotelName || !username?.trim() || !password) {
      return res.status(400).json({ error: 'hotelName, username and password are required.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (!loadPrivateKeyPem()) {
      return res.status(503).json({
        error:
          'No licence signing key configured. Run `npm run keys:generate`, then set LICENSE_SIGNING_PRIVATE_KEY in .env (or keep keys/license-signing-private.pem).',
      });
    }

    const passwordHash = LocalStore.hashPassword(String(password));
    let issued: ReturnType<typeof issueLicense>;
    try {
      issued = issueLicense({
        hotelName: String(hotelName),
        ownerName: String(ownerName || ''),
        username: String(username).trim().toLowerCase(),
        passwordHash,
        email: String(email || ''),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        code: generateActivationCode(),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Could not sign the licence.' });
    }

    const passwordEnc = encryptSecret(String(password));
    const { error } = await admin.from('desktop_licenses').insert({
      code: issued.code,
      hotel_name: issued.payload.hotelName,
      owner_name: issued.payload.ownerName,
      username: issued.payload.username,
      email: issued.payload.email || null,
      password_hash: passwordHash,
      password_enc: passwordEnc || null,
      password_plain: passwordEnc ? null : String(password),
      activation_json: JSON.stringify({ payload: issued.payload, signature: issued.signature }),
      activation_string: issued.activationString,
      status: 'issued',
      issued_at: new Date().toISOString(),
      expires_at: issued.payload.expiresAt || null,
      notes: String(notes || '') || null,
      created_by: (req as any).claims?.uid || null,
    });
    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({
      licence: {
        ...licensePublicRow({
          id: issued.payload.id,
          code: issued.code,
          hotel_name: issued.payload.hotelName,
          owner_name: issued.payload.ownerName,
          username: issued.payload.username,
          email: issued.payload.email,
          status: 'issued',
          issued_at: new Date().toISOString(),
          expires_at: issued.payload.expiresAt,
          notes,
        }),
        activationString: issued.activationString,
      },
      // Given ONCE so the seller can share it with the customer.
      credentials: { username: issued.payload.username, password: String(password) },
    });
  });

  // Download the .nexora activation file.
  app.get('/api/licenses/:id/download', requireSuperAdmin, async (req: Request, res: Response) => {
    const admin = requireSupabaseConfigured(res);
    if (!admin) return;
    const { data, error } = await admin.from('desktop_licenses').select('activation_json, code, hotel_name').eq('id', String(req.params.id)).maybeSingle();
    if (error || !data) return res.status(404).json({ error: 'Licence not found.' });
    const hotelSlug = String(data.hotel_name || 'hotel').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="nexora-${hotelSlug}-${String(data.code).replace(/^NX-/, '')}.nexora"`);
    res.send(data.activation_json || '{}');
  });

  // Re-share credentials (seller support).
  app.get('/api/licenses/:id/credentials', requireSuperAdmin, async (req: Request, res: Response) => {
    const admin = requireSupabaseConfigured(res);
    if (!admin) return;
    const { data, error } = await admin.from('desktop_licenses').select('username,password_enc,password_plain').eq('id', String(req.params.id)).maybeSingle();
    if (error || !data) return res.status(404).json({ error: 'Licence not found.' });
    const password = data.password_enc ? decryptSecret(data.password_enc) : data.password_plain;
    if (!password) {
      return res.status(500).json({
        error: 'The password cannot be recovered for this licence. Set LICENSE_PASSWORD_KEY in .env and issue a new licence.',
      });
    }
    res.json({ username: data.username, password });
  });

  // Status updates (mark activated/revoke/expired) + delete.
  app.post('/api/licenses/:id/status', requireSuperAdmin, async (req: Request, res: Response) => {
    const admin = requireSupabaseConfigured(res);
    if (!admin) return;
    const status = String(req.body?.status || '');
    if (!['issued', 'activated', 'expired', 'revoked'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    const patch: Record<string, any> = { status };
    if (status === 'activated') patch.activated_at = new Date().toISOString();
    const { error } = await admin.from('desktop_licenses').update(patch).eq('id', String(req.params.id));
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  app.delete('/api/licenses/:id', requireSuperAdmin, async (req: Request, res: Response) => {
    const admin = requireSupabaseConfigured(res);
    if (!admin) return;
    const { error } = await admin.from('desktop_licenses').delete().eq('id', String(req.params.id));
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });
}

// ---------------------------------------------------------------------------
// Rate limiting (per-instance, in-memory)
// ---------------------------------------------------------------------------
interface RateBucket {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<string, RateBucket>();

function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || 'unknown'}:${req.path}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (bucket.count >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
      return;
    }
    bucket.count += 1;
    next();
  };
}

/**
 * The CHECKED_IN booking currently occupying a room, if any.
 */
async function findActiveBooking(hotelId: string, roomId: string) {
  const admin = getAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from('bookings')
    .select('id,guest_id,room_id,status')
    .eq('hotel_id', hotelId)
    .eq('room_id', roomId)
    .order('check_in_date', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data || []).find((b) => b.status === 'CHECKED_IN') || null;
}

/** Display name for the in-house guest from guests/{guestId}. */
async function resolveGuestName(hotelId: string, guestId?: string): Promise<string> {
  if (!guestId) return '';
  const admin = getAdmin();
  if (!admin) return '';
  try {
    const { data } = await admin
      .from('guests')
      .select('name')
      .eq('hotel_id', hotelId)
      .eq('id', guestId)
      .maybeSingle();
    return data?.name || '';
  } catch (err) {
    console.warn('Could not resolve guest name:', err);
    return '';
  }
}

/**
 * Super-admin middleware. Supabase has no custom claims, so the role is read
 * from the profiles row (service-role bypasses RLS).
 */
async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const admin = getAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Supabase is not configured on the server (missing service credentials).' });
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }
  try {
    const claims = await verifySupabaseJwt(authHeader.split('Bearer ')[1]);
    if (!claims) return res.status(401).json({ error: 'Invalid or expired token' });

    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', claims.uid)
      .maybeSingle();
    if (profile?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden: Super Admin privileges required' });
    }
    (req as any).claims = claims;
    next();
  } catch (err: any) {
    console.error('Token verification error:', err);
    return res.status(401).json({ error: 'Invalid or expired token', details: err.message });
  }
}

/** Returns the service-role client, or 503s and returns null when unconfigured. */
function requireSupabaseConfigured(res: Response): SupabaseClient | null {
  const admin = getAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Supabase is not configured on the server (missing service credentials).' });
  }
  return admin;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || (process.env.NEXORA_RUNTIME === 'local' ? 3967 : 3000);
  const LOCAL_MODE = process.env.NEXORA_RUNTIME === 'local';
  app.use(express.json({ limit: '64kb' }));

  // ---------------------------------------------------------------------
  // Desktop Edition: mount the OFFLINE backend (SQLite + licensing) and
  // skip every Supabase route. The hotel data lives in NEXORA_DATA_DIR.
  // ---------------------------------------------------------------------
  let localStore: import('./server/local/store').LocalStore | null = null;
  if (LOCAL_MODE) {
    const { createLocalApp } = await import('./server/local/index');
    const dataDir = process.env.NEXORA_DATA_DIR || path.join(process.cwd(), '.nexora-data');
    const { app: localLayer, store } = createLocalApp({
      dataDir,
      version: process.env.npm_package_version || '1.0.0',
      demoAvailable: process.env.NODE_ENV !== 'production',
    });
    localStore = store;
    app.use(localLayer);
    console.log(`[local] Offline backend ready → ${dataDir}`);
  }

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      backend: LOCAL_MODE ? 'local' : 'supabase',
      configured: LOCAL_MODE ? true : CONFIGURED,
    });
  });

  if (LOCAL_MODE) {
    // Everything below is Supabase-only (hosted edition).
    const vite = await setupFrontend(app);
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`NEXORA HOTEL OS (Desktop Edition, offline) running at http://0.0.0.0:${PORT} — data: ${localStore?.dbPath}`);
    });
    return;
  }

  // -----------------------------------------------------------------------
  // Guest session — exchange a room QR token for a room-scoped session row.
  // -----------------------------------------------------------------------
  app.post('/api/guest/session', rateLimit(20, 60_000), async (req: Request, res: Response) => {
    const admin = requireSupabaseConfigured(res);
    if (!admin) return;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const roomToken = typeof req.body?.roomToken === 'string' ? req.body.roomToken.trim() : '';
    if (!roomToken || roomToken.length > 256) {
      return res.status(400).json({ error: 'A room token is required.', code: 'guest/invalid-token' });
    }

    try {
      const claims = await verifySupabaseJwt(authHeader.split('Bearer ')[1]);
      if (!claims) return res.status(401).json({ error: 'Invalid or expired token', code: 'guest/invalid-session' });

      // Anonymous guests only — never touch a staff account's scope.
      if (!claims.isAnonymous) {
        return res.status(403).json({
          error: 'Only anonymous guest sessions can be scoped to a room.',
          code: 'guest/not-anonymous',
        });
      }

      // Resolve token → room server-side (collection-group equivalent: scan by
      // permanent_token, which is globally unique + indexed).
      const { data: room } = await admin
        .from('rooms')
        .select('id,hotel_id,room_number')
        .eq('permanent_token', roomToken)
        .maybeSingle();

      if (!room) {
        return res.status(404).json({ error: 'This room code is not recognised.', code: 'guest/unknown-room' });
      }
      const hotelId = room.hotel_id as string;
      const roomId = room.id as string;
      const roomNumber = (room.room_number as string) || '';

      const booking = await findActiveBooking(hotelId, roomId);
      const guestName = booking?.guest_id ? await resolveGuestName(hotelId, booking.guest_id) : '';

      // Upsert the room-scoped session (replaces custom claims). Re-activating a
      // session re-points it at the room of the newly scanned token.
      const { error: sessionErr } = await admin
        .from('guest_sessions')
        .upsert(
          {
            id: claims.uid,
            hotel_id: hotelId,
            room_id: roomId,
            room_number: roomNumber,
            guest_name: guestName || '',
            active: true,
          },
          { onConflict: 'id' }
        );
      if (sessionErr) throw new Error(sessionErr.message);

      return res.json({ success: true, hotelId, roomId, roomNumber, guestName: guestName || '' });
    } catch (err: any) {
      console.error('Guest session error:', err);
      return res.status(401).json({ error: 'Invalid or expired token', code: 'guest/invalid-session' });
    }
  });

  // -----------------------------------------------------------------------
  // Folio charge for a guest order (runs the post_guest_order_charge RPC).
  // We re-create a client BOUND TO THE GUEST'S JWT so the SECURITY DEFINER
  // RPC sees auth.uid() = the guest and the RLS helpers work; the service
  // client alone would report no auth.uid().
  // -----------------------------------------------------------------------
  app.post(
    '/api/guest/orders/:orderId/charge',
    rateLimit(60, 60_000),
    async (req: Request, res: Response) => {
      const admin = requireSupabaseConfigured(res);
      if (!admin) return;
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
      }
      const orderId = String(req.params.orderId || '').trim();
      if (!orderId || orderId.length > 128) {
        return res.status(400).json({ error: 'A valid order id is required.' });
      }

      const token = authHeader.split('Bearer ')[1];
      const claims = await verifySupabaseJwt(token);
      if (!claims) {
        return res.status(401).json({ error: 'Invalid or expired token', code: 'guest/invalid-session' });
      }
      if (!claims.isAnonymous) {
        return res.status(403).json({ error: 'Not a room-scoped guest session.', code: 'guest/not-scoped' });
      }

      try {
        const guestClient = createClient(SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY || '', {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await guestClient.rpc('post_guest_order_charge', { p_order_id: orderId });
        if (error) {
          return res.status(500).json({ error: error.message || 'Could not post the charge.' });
        }
        return res.json(data || { linked: false });
      } catch (err: any) {
        console.error('Order charge error:', err);
        return res.status(500).json({ error: err?.message || 'Could not post the charge.' });
      }
    }
  );

  // -----------------------------------------------------------------------
  // Create hotel admin user (super admin). Creates the Auth user + profile +
  // hotel ownership. Email confirmations are bypassed (the super admin sets a
  // password directly), matching the old Admin-SDK flow.
  // -----------------------------------------------------------------------
  app.post('/api/admin/create-hotel-user', requireSuperAdmin, async (req: Request, res: Response) => {
    const admin = requireSupabaseConfigured(res);
    if (!admin) return;
    const { hotelId, hotelName, email, password, name, phone } = req.body || {};
    if (!hotelId || !email || !password) {
      return res.status(400).json({ error: 'Missing required parameters: hotelId, email, and password' });
    }
    const trimmedEmail = String(email).toLowerCase().trim();
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    try {
      // Existing user? update password + name; otherwise create.
      let uid: string;
      let isNew = false;
      const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const found = (existing?.users || []).find((u) => (u.email || '').toLowerCase() === trimmedEmail);

      if (found) {
        uid = found.id;
        const { error: updErr } = await admin.auth.admin.updateUserById(uid, {
          password,
          email_confirm: true,
          user_metadata: { display_name: name || `${hotelName} Admin`, ...(phone ? { phone } : {}) },
        });
        if (updErr) throw updErr;
      } else {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: trimmedEmail,
          password,
          email_confirm: true,
          user_metadata: { display_name: name || `${hotelName} Admin`, ...(phone ? { phone } : {}) },
        });
        if (createErr || !created?.user) throw createErr || new Error('User creation failed');
        uid = created.user.id;
        isNew = true;
      }

      // Role lives in profiles (replaces custom claims + users/{uid}).
      const { error: profileErr } = await admin
        .from('profiles')
        .upsert(
          {
            id: uid,
            role: 'hotel_admin',
            hotel_id: hotelId,
            email: trimmedEmail,
            display_name: name || `${hotelName} Admin`,
            phone: phone || '',
          },
          { onConflict: 'id' }
        );
      if (profileErr) throw profileErr;

      // Ensure the hotel points back at this login email (best effort).
      await admin.from('hotels').update({ login_email: trimmedEmail }).eq('id', hotelId);

      return res.json({
        success: true,
        isNew,
        uid,
        email: trimmedEmail,
        hotelId,
        role: 'hotel_admin',
        message: `Hotel admin ${trimmedEmail} created/updated for hotel ${hotelId}`,
      });
    } catch (err: any) {
      console.error('Error creating hotel admin user:', err);
      return res.status(500).json({ error: err.message || 'Failed to create hotel admin user' });
    }
  });

  app.post('/api/admin/delete-hotel-user', requireSuperAdmin, async (req: Request, res: Response) => {
    const admin = requireSupabaseConfigured(res);
    if (!admin) return;
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });
    try {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const found = (list?.users || []).find((u) => (u.email || '').toLowerCase() === String(email).toLowerCase().trim());
      if (found) {
        await admin.from('profiles').delete().eq('id', found.id);
        await admin.auth.admin.deleteUser(found.id);
      }
      return res.json({ success: true, message: 'User deleted (or was already absent).' });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to delete user' });
    }
  });

  app.post(
    '/api/admin/set-user-claims',
    requireSuperAdmin,
    rateLimit(30, 60_000),
    async (req: Request, res: Response) => {
      const admin = requireSupabaseConfigured(res);
      if (!admin) return;
      const { email, role, hotelId } = req.body || {};
      if (!email || !role) return res.status(400).json({ error: 'Email and role are required' });
      try {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const found = (list?.users || []).find(
          (u) => (u.email || '').toLowerCase() === String(email).toLowerCase().trim()
        );
        if (!found) return res.status(404).json({ error: 'User not found' });

        const { error } = await admin
          .from('profiles')
          .upsert(
            {
              id: found.id,
              role: role === 'super_admin' ? 'super_admin' : 'hotel_admin',
              hotel_id: role === 'hotel_admin' && hotelId ? hotelId : null,
              email: found.email,
            },
            { onConflict: 'id' }
          );
        if (error) throw error;
        return res.json({ success: true, uid: found.id, claims: { role, hotelId } });
      } catch (err: any) {
        return res.status(500).json({ error: err.message || 'Failed to set role' });
      }
    }
  );

  // Seller Console — issue/download desktop licences (hosted edition only).
  registerLicensingRoutes(app, requireSuperAdmin);

  const vite = await setupFrontend(app);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `NEXORA HOTEL OS server running at http://0.0.0.0:${PORT} (${CONFIGURED ? 'Supabase backend + licence console' : 'NOT CONFIGURED — set .env'})`
    );
  });
}

/** Vite dev middleware or static dist + SPA fallback (shared by both editions). */
async function setupFrontend(app: express.Express) {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    return vite;
  }
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
  return null;
}

startServer();
