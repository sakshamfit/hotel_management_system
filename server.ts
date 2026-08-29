import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Supabase admin (service-role) client.
// The service-role key bypasses RLS and is ONLY used server-side, never
// shipped to the browser. Auth users are managed with admin APIs; the
// browser/app still uses the anon key + RLS for its own reads and writes.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn(
    '[server] SUPABASE url/service-role key missing. Set VITE_SUPABASE_URL and ' +
      'SUPABASE_SERVICE_ROLE_KEY in .env (see .env.example). Guest/admin API routes will 503.'
  );
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Verify a Supabase JWT sent by the client and return its claims. */
async function verifySupabaseJwt(token: string): Promise<{
  uid: string;
  email?: string;
  role: string;
  isAnonymous: boolean;
} | null> {
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

function requireSupabaseConfigured(res: Response): boolean {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    res.status(503).json({ error: 'Supabase is not configured on the server (missing service credentials).' });
    return false;
  }
  return true;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), backend: 'supabase' });
  });

  // -----------------------------------------------------------------------
  // Guest session — exchange a room QR token for a room-scoped session row.
  // -----------------------------------------------------------------------
  app.post('/api/guest/session', rateLimit(20, 60_000), async (req: Request, res: Response) => {
    if (!requireSupabaseConfigured(res)) return;
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
      if (!requireSupabaseConfigured(res)) return;
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
    if (!requireSupabaseConfigured(res)) return;
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
    if (!requireSupabaseConfigured(res)) return;
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
      if (!requireSupabaseConfigured(res)) return;
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

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NEXORA HOTEL OS server running at http://0.0.0.0:${PORT} (Supabase backend)`);
  });
}

startServer();
