/**
 * Local (offline) HTTP API — mounted at /local/api by the desktop/express host.
 *
 * Auth model:
 *   • Staff  → Authorization: Bearer <session token> (from local_sessions)
 *   • Guest  → X-Guest-Token: <opaque token> (from a scanned QR code)
 *
 * All tenant tables are scoped server-side to the caller's hotel; guests only
 * ever reach their own room + hotel menu/services + their own orders.
 */
import express, { type Router, type Request, type Response, type NextFunction } from 'express';
import { LocalStore } from './store';
import { verifyActivationString, issueLicense, loadPrivateKeyPem, generateKeypairFile } from './licensing';

export interface LocalApiOptions {
  store: LocalStore;
  version: string;
  /** When true the setup flow offers a demo activation (dev builds only). */
  demoAvailable?: boolean;
}

type Auth = { kind: 'staff'; staff: ReturnType<LocalStore['getStaffByToken']> } | { kind: 'guest'; guest: ReturnType<LocalStore['getGuestByToken']> };

function rateLimit(max: number, windowMs: number) {
  const buckets = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.reset <= now) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      next();
      return;
    }
    if (b.count >= max) return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
    b.count += 1;
    next();
  };
}

function fail(res: Response, status: number, error: string, code?: string) {
  return res.status(status).json({ error, ...(code ? { code } : {}) });
}

function authOf(req: Request, store: LocalStore): Auth | null {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (bearer) {
    const staff = store.getStaffByToken(bearer);
    if (staff) return { kind: 'staff', staff };
    return null;
  }
  const guestToken = String(req.headers['x-guest-token'] || '').trim();
  if (guestToken) {
    const guest = store.getGuestByToken(guestToken);
    if (guest) return { kind: 'guest', guest };
    return null;
  }
  return null;
}

/** Staff-only middleware. */
function staffOnly(store: LocalStore) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = authOf(req, store);
    if (!auth || auth.kind !== 'staff' || !auth.staff) return fail(res, 401, 'Unauthorized: sign in again.', 'auth/unauthorized');
    (req as any).locals = { auth };
    next();
  };
}

export function createLocalApi(opts: LocalApiOptions): Router {
  const { store, version } = opts;
  const router = express.Router();

  router.use(express.json({ limit: '8mb' })); // media uploads arrive as base64 data URLs

  // ------------------------------------------------------------------ meta
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', mode: 'local', version, activated: store.isActivated() });
  });

  router.get('/meta', (_req: Request, res: Response) => {
    res.json({
      mode: 'local',
      version,
      dataDir: store.dbPath,
      activated: store.isActivated(),
      activation: store.getActivationInfo(),
      demoAvailable: !!opts.demoAvailable,
      lanEnabled: !!process.env.NEXORA_LAN,
    });
  });

  // ------------------------------------------------------------------ setup
  router.get('/setup/status', (_req: Request, res: Response) => {
    const info = store.getActivationInfo();
    res.json({
      activated: store.isActivated(),
      demoAvailable: !!opts.demoAvailable,
      hotelName: info.hotelName,
      code: info.code,
    });
  });

  // Self-serve demo activation — dev builds only (never shipped to customers).
  router.post('/setup/demo', rateLimit(10, 60_000), (_req: Request, res: Response) => {
    if (!opts.demoAvailable) return fail(res, 404, 'Demo activation is not available in this build.', 'license/demo-disabled');
    if (store.isActivated()) return fail(res, 409, 'This installation is already activated.', 'license/already-activated');
    try {
      // Build a signed demo license using the same key pair as the CLI.
      let privatePem = loadPrivateKeyPem();
      if (!privatePem) generateKeypairFile();
      const issued = issueLicense({
        hotelName: 'Demo Hotel',
        ownerName: 'Demo Owner',
        username: 'owner',
        passwordHash: LocalStore.hashPassword('demo1234'),
      });
      const info = store.activate(issued.activationString, 'owner', 'demo1234');
      res.json({ ok: true, ...info, activationString: issued.activationString });
    } catch (err: any) {
      fail(res, 500, err?.message || 'Demo activation failed.', err?.code);
    }
  });

  router.post(
    '/activate',
    rateLimit(10, 60_000),
    (req: Request, res: Response) => {
      const activationString = String(req.body?.activationString || '').trim();
      const username = String(req.body?.username || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!activationString) return fail(res, 400, 'Paste the activation code you received from the seller.', 'license/missing');
      try {
        // Verify first so errors are friendly before touching the DB.
        verifyActivationString(activationString, '');
        const info = store.activate(activationString, username, password);
        res.json({ ok: true, ...info });
      } catch (err: any) {
        fail(res, 401, err?.message || 'Activation failed.', err?.code || 'license/invalid');
      }
    }
  );

  // ------------------------------------------------------------------ auth
  router.post(
    '/auth/login',
    rateLimit(20, 60_000),
    (req: Request, res: Response) => {
      try {
        const { token, info } = store.login(String(req.body?.username || ''), String(req.body?.password || ''));
        res.json({ token, user: info.user, hotel: info.hotel });
      } catch (err: any) {
        fail(res, 401, err?.message || 'Sign-in failed.', err?.code || 'invalid_credentials');
      }
    }
  );

  router.post('/auth/logout', (req: Request, res: Response) => {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (bearer) store.logout(bearer);
    res.json({ ok: true });
  });

  router.get('/auth/session', (req: Request, res: Response) => {
    const auth = authOf(req, store);
    if (!auth || auth.kind !== 'staff' || !auth.staff) return res.json({ user: null, hotel: null });
    res.json({ user: auth.staff.user, hotel: auth.staff.hotel });
  });

  router.post('/auth/password', staffOnly(store), (req: Request, res: Response) => {
    const staff = (req as any).locals.auth.staff;
    try {
      store.changePassword(staff.user.username, String(req.body?.current || ''), String(req.body?.next || ''));
      res.json({ ok: true });
    } catch (err: any) {
      fail(res, 400, err?.message || 'Could not change password.', err?.code);
    }
  });

  // ------------------------------------------------------------------ data (staff OR guest, scoped by which token was sent)
  const safeTable = (table: string): boolean => /^[a-z_]{1,40}$/.test(String(table || ''));

  router.get('/data/:table', (req: Request, res: Response) => {
    const auth = authOf(req, store);
    if (!auth) return fail(res, 401, 'Unauthorized: sign in again.', 'auth/unauthorized');
    const table = String(req.params.table);
    if (!safeTable(table)) return fail(res, 400, 'Unknown table.', 'table/unknown');

    if (auth.kind === 'staff') {
      const staff = auth.staff!;
      try {
        let filters: Array<{ column: string; value: unknown; op?: string }> = [];
        if (req.query.filters) {
          try {
            filters = JSON.parse(String(req.query.filters));
          } catch {
            return fail(res, 400, 'Invalid filters.');
          }
        }
        const hotelId = staff.user.hotelId || (String(req.query.hotel_id || '') || null);
        const rows = store.query(table, {
          hotelId: hotelId || null,
          filters,
          orderBy: req.query.order_by ? String(req.query.order_by) : undefined,
          ascending: req.query.ascending === undefined ? undefined : String(req.query.ascending) === 'true',
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        res.json({ data: rows });
      } catch (err: any) {
        fail(res, 500, err?.message || 'Query failed.', err?.code);
      }
      return;
    }

    // Guest scope
    const guest = auth.guest!;
    if (!['food_items', 'services', 'orders', 'rooms', 'food_categories', 'service_categories', 'hotels'].includes(table)) {
      return fail(res, 403, 'Guests cannot read this table.', 'auth/forbidden');
    }
    try {
      let rows: Array<Record<string, unknown>> = [];
      if (table === 'orders') {
        rows = store.query('orders', { hotelId: guest.hotelId, filters: [{ column: 'guest_uid', value: guest.uid }], orderBy: 'created_at', ascending: false });
      } else if (table === 'rooms') {
        rows = store.query('rooms', { filters: [{ column: 'id', value: guest.roomId }] });
      } else if (table === 'hotels') {
        rows = store.query('hotels', { filters: [{ column: 'id', value: guest.hotelId }] });
      } else {
        rows = store.query(table, { hotelId: guest.hotelId, orderBy: req.query.order_by ? String(req.query.order_by) : 'name', ascending: true });
      }
      res.json({ data: rows });
    } catch (err: any) {
      fail(res, 500, err?.message || 'Query failed.');
    }
  });

  router.post('/data/:table', (req: Request, res: Response) => {
    const auth = authOf(req, store);
    if (!auth) return fail(res, 401, 'Unauthorized: sign in again.', 'auth/unauthorized');
    const table = String(req.params.table);
    if (!safeTable(table)) return fail(res, 400, 'Unknown table.', 'table/unknown');

    if (auth.kind === 'staff') {
      const staff = auth.staff!;
      const row = { ...(req.body || {}) };
      if (staff.user.hotelId) row.hotel_id = staff.user.hotelId; // tenant scoping
      try {
        const id = store.insertRow(table, row);
        res.json({ id });
      } catch (err: any) {
        fail(res, 400, err?.message || 'Insert failed.', err?.code);
      }
      return;
    }

    const guest = auth.guest!;
    if (table !== 'orders') return fail(res, 403, 'Guests can only place orders.', 'auth/forbidden');
    const row = { ...(req.body || {}), hotel_id: guest.hotelId, guest_uid: guest.uid, room_id: guest.roomId, room_number: guest.roomNumber };
    try {
      const id = store.insertRow('orders', row);
      res.json({ id });
    } catch (err: any) {
      fail(res, 400, err?.message || 'Could not place the order.');
    }
  });

  router.put('/data/:table/:id', staffOnly(store), (req: Request, res: Response) => {
    const staff = (req as any).locals.auth.staff;
    const table = String(req.params.table);
    const id = String(req.params.id || '');
    if (!safeTable(table) || !id) return fail(res, 400, 'Bad request.', 'table/unknown');
    // Tenant guard: never allow cross-hotel updates.
    const existing = store.getRowRaw(table, id);
    if (!existing) return fail(res, 404, 'Row not found.');
    if (staff.user.hotelId && existing.hotel_id && String(existing.hotel_id) !== staff.user.hotelId) {
      return fail(res, 403, 'Forbidden: this row belongs to another hotel.', 'auth/forbidden');
    }
    try {
      store.updateRow(table, id, req.body || {});
      res.json({ ok: true });
    } catch (err: any) {
      fail(res, 400, err?.message || 'Update failed.', err?.code);
    }
  });

  router.delete('/data/:table/:id', staffOnly(store), (req: Request, res: Response) => {
    const staff = (req as any).locals.auth.staff;
    const table = String(req.params.table);
    const id = String(req.params.id || '');
    if (!safeTable(table) || !id) return fail(res, 400, 'Bad request.');
    const existing = store.getRowRaw(table, id);
    if (!existing) return res.json({ ok: true });
    if (staff.user.hotelId && existing.hotel_id && String(existing.hotel_id) !== staff.user.hotelId) {
      return fail(res, 403, 'Forbidden: this row belongs to another hotel.', 'auth/forbidden');
    }
    try {
      store.deleteWhere(table, { id });
      res.json({ ok: true });
    } catch (err: any) {
      fail(res, 400, err?.message || 'Delete failed.');
    }
  });

  // ------------------------------------------------------------------ RPCs
  router.post('/rpc/create_booking', staffOnly(store), (req: Request, res: Response) => {
    const staff = (req as any).locals.auth.staff;
    const b = req.body || {};
    try {
      const bookingId = store.createBooking({
        hotelId: staff.user.hotelId || String(b.hotelId || ''),
        guestId: String(b.guestId || ''),
        roomId: String(b.roomId || ''),
        roomTypeId: b.roomTypeId ? String(b.roomTypeId) : null,
        checkInDate: String(b.checkInDate || ''),
        checkOutDate: String(b.checkOutDate || ''),
        rate: Number(b.rate ?? b.agreedRate ?? 0),
        numGuests: Number(b.numGuests ?? 1),
        source: String(b.source || 'walk-in'),
        createdBy: staff.user.username,
      });
      res.json(bookingId);
    } catch (err: any) {
      const status = err?.code === 'booking/room-not-available' || err?.code === 'booking/invalid-stay' || err?.code === 'booking/invalid-rate' ? 409 : 400;
      fail(res, status, err?.message || 'Could not create the booking.', err?.code);
    }
  });

  router.post('/rpc/post_guest_order_charge', (req: Request, res: Response) => {
    const auth = authOf(req, store);
    if (!auth || auth.kind !== 'guest' || !auth.guest) return fail(res, 401, 'Not a room-scoped guest session.', 'guest/not-scoped');
    try {
      const result = store.postGuestOrderCharge(auth.guest.uid, String(req.body?.orderId || ''));
      res.json(result);
    } catch (err: any) {
      fail(res, 500, err?.message || 'Could not link the charge.');
    }
  });

  router.post('/rpc/submit_guest_order_feedback', (req: Request, res: Response) => {
    const auth = authOf(req, store);
    if (!auth || auth.kind !== 'guest' || !auth.guest) return fail(res, 401, 'Not a room-scoped guest session.', 'guest/not-scoped');
    const result = store.submitGuestOrderFeedback(
      auth.guest.uid,
      String(req.body?.orderId || ''),
      Number(req.body?.rating || 0),
      String(req.body?.comment || '')
    );
    res.json(result);
  });

  // ------------------------------------------------------------------ guest portal
  router.post('/guest/session', rateLimit(20, 60_000), (req: Request, res: Response) => {
    const token = String(req.body?.roomToken || '').trim();
    if (!token || token.length > 256) return fail(res, 400, 'A room code is required.', 'guest/invalid-token');
    const session = store.openGuestSession(token);
    if (!session) return fail(res, 404, 'This room code is not recognised.', 'guest/unknown-room');
    res.json({
      hotelId: session.hotelId,
      roomId: session.roomId,
      roomNumber: session.roomNumber,
      guestName: session.guestName,
      uid: session.uid,
      guestToken: session.guestToken,
    });
  });

  // ------------------------------------------------------------------ media
  router.post('/media/upload', staffOnly(store), (req: Request, res: Response) => {
    try {
      const url = store.saveMedia(String(req.body?.path || ''), String(req.body?.dataUrl || ''));
      res.json({ url });
    } catch (err: any) {
      fail(res, 400, err?.message || 'Upload failed.', err?.code);
    }
  });

  router.delete('/media', staffOnly(store), (req: Request, res: Response) => {
    store.deleteMediaByUrl(String(req.body?.url || ''));
    res.json({ ok: true });
  });

  router.post('/media/delete-folder', staffOnly(store), (req: Request, res: Response) => {
    store.deleteMediaFolder(String(req.body?.path || ''));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ backup / misc
  router.post('/backup', staffOnly(store), (_req: Request, res: Response) => {
    try {
      res.json({ backupPath: store.createBackup() });
    } catch (err: any) {
      fail(res, 500, err?.message || 'Backup failed.');
    }
  });

  // ------------------------------------------------------------------ realtime
  router.get('/stream', (req: Request, res: Response) => {
    const token = String(req.query.token || '').trim();
    const auth = token ? store.getStaffByToken(token) : null;
    if (!auth) return fail(res, 401, 'Unauthorized.');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('event: ready\ndata: {}\n\n');
    const unsub = store.subscribe((tables) => {
      res.write(`event: changed\ndata: ${JSON.stringify(tables)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': hb\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsub();
      try {
        res.end();
      } catch {
        /* ignore */
      }
    });
  });

  // Static media (public URLs like /local/media/hotels/{id}/rooms/{id}.jpg)
  router.use('/media', express.static(store.mediaDir, { maxAge: '1h', fallthrough: false }));

  return router;
}
